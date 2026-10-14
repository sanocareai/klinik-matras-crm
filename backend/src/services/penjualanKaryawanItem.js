// ITEM PRODUKSI PENJUALAN KARYAWAN — katalog (dikelola Admin), normalisasi dari DB, pratinjau, dan pembuatan unit per item.
//
// Aturan murni (bentuk isian, validasi, kelengkapan, label, pemecahan bundel, pemetaan rute) ada di lib/domain/pkrItem.js. File ini hanya menambahkan akses DB:
//   • katalog kategori/produk (baris data; Admin menambah/menonaktifkan/memetakan rute — bukan enum di kode),
//   • siapkanItems : masukan mentah -> item ternormalisasi (kategori/produk dicari di katalog AKTIF; bundel dipecah jadi komponen; produk tanpa pemetaan rute DIBLOKIR),
//   • pratinjau    : apa yang AKAN dibuat (unit, pickup, pengiriman, kelengkapan, rute) TANPA menulis apa pun — memakai fungsi yang sama dengan pembuatan,
//   • lahirkanItemDanUnit : dalam transaksi pemanggil, buat baris item + unit per item lewat jalur BAKU createUnitsForOrder (tidak ada jalur Produksi/Delivery baru),
//   • ubahItemOrder : perubahan spesifikasi/pilihan kirim per item setelah order ada (struktur — kategori & jumlah — hanya lewat Koreksi Item: penjualanKaryawanKoreksi.js).
// TIDAK ADA uang di sini: tidak ada Payment, invoice, pendapatan, jurnal, atau OrderItem (trigger DB menolak yang terakhir untuk order PKR).
import { PkrOrderError } from "./pkrGuard.js";
import { ACTIVE_JOB_STATUSES } from "./jobStatus.js";
import { createUnitsForOrder } from "./unitProvisioning.js";
import { tryProvisionUnitRoute } from "./productionRouting.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { bacaNotesOrder } from "../lib/domain/pkrSpesifikasi.js";
import { classifyProduct, FAMILY_OF_TYPE } from "../lib/domain/productionBuildTrack.js";
import { PEMENUHAN } from "../lib/domain/pkrPenjualanItem.js";
import { tulisRevisi, snapshotItems, revisiTerakhir } from "./pkrItemRevisi.js";
import {
  BENTUK, MAKS_ITEM, ItemPkrError, normalisasiItem, validasiHimpunan, kategoriOrderDariItems, perluDikirimDariItems, peringatanHimpunan, cerminanItem,
  deskripsiUnit, kelengkapanItems, kunciDuplikat, ukuranLabel, pecahBundel, pemetaanRute,
} from "../lib/domain/pkrItem.js";
import { bacaModeRute, MODE_RUTE, ruteBelumDipetakanBoleh } from "./produksiRuteMode.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const gagal = (m, s = 400, c = null, e = null) => new PkrOrderError(m, s, c, e);
const STATUS_UNIT_BELUM_MULAI = ["AWAITING_PICKUP", "RECEIVED"];
const LABEL_KIRIM = (v) => (v === true ? "Dikirim" : v === false ? "Diambil sendiri" : "Belum ditentukan");
const TIDAK_DIBUAT = Object.freeze(["Pembayaran (Payment)", "Invoice", "Pendapatan / jurnal baru", "Item order bernilai (OrderItem)"]);
const LINI = Object.freeze(["KASUR", "SOFA", "DIVAN"]);
export const JENIS_PRODUK = Object.freeze(Object.keys(FAMILY_OF_TYPE));
const LABEL_KATEGORI_ORDER = Object.freeze({ BARU: "Produk baru", LAYANAN: "Service/Upgrade", CAMPURAN: "Campuran (produk baru + service)" });

// ── KATALOG ────────────────────────────────────────────────────────────────────────────────────────────

/** Definisi bentuk untuk klien (field kontekstual per bentuk). Dibaca layar — tidak ada salinan di frontend. */
export function definisiBentuk() {
  return Object.fromEntries(Object.entries(BENTUK).map(([k, v]) => [k, {
    label: v.label, produk: v.produk, dimensi: v.dimensi, spesifikasi: v.spesifikasi, bundel: Boolean(v.bundel),
  }]));
}

const kategoriUntukRute = (c) => ({ code: c.code, name: c.name, productLine: c.productLine ?? null, productType: c.productType ?? null, productionServiceId: c.productionServiceId ?? null });
const produkUntukRute = (p) => ({ id: p.id, name: p.name, productLine: p.productLine ?? null, productType: p.productType ?? null, productionServiceId: p.productionServiceId ?? null });
const ringkasRute = (r) => ({ ok: r.ok, kode: r.kode ?? null, pesan: r.pesan ?? null, alur: r.alur ?? null, alurLabel: r.alurLabel ?? null, productLine: r.productLine ?? null, productType: r.productType ?? null });

/** Katalog untuk form (hanya yang aktif) atau pengelolaan Admin (`semua: true` memuat nonaktif juga). */
export async function muatKatalogItem(db, { semua = false } = {}) {
  const kategori = await db.pkrItemCategory.findMany({
    where: semua ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      productionService: { select: { id: true, code: true, labelId: true } },
      products: { where: semua ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { productionService: { select: { id: true, code: true, labelId: true } } } },
      komposisi: {
        orderBy: [{ sortOrder: "asc" }],
        include: { componentCategory: { select: { id: true, code: true, name: true, shape: true, active: true } }, componentProduct: { select: { id: true, name: true, active: true } } },
      },
    },
  });
  const belumDipetakan = [];
  const hasil = kategori.map((c) => {
    const bundel = Boolean(BENTUK[c.shape]?.bundel);
    const komposisiRows = c.komposisi.filter((k) => semua || k.componentCategory.active);
    const komposisi = (bundleProductId) => komposisiRows.filter((k) => (k.bundleProductId ?? null) === bundleProductId).map((k) => ({
      id: k.id, urutan: k.sortOrder, jumlah: k.qty, kategoriId: k.componentCategory.id, kategoriKode: k.componentCategory.code, kategoriNama: k.componentCategory.name,
      bentuk: k.componentCategory.shape, produkId: k.componentProduct?.id ?? null, produkNama: k.componentProduct?.name ?? null, aktif: k.componentCategory.active,
    }));
    const ruteKategori = bundel
      ? { ok: komposisi(null).length > 0, kode: komposisi(null).length ? null : "BUNDEL_TANPA_KOMPOSISI", pesan: komposisi(null).length ? null : "Set belum punya komposisi komponen." }
      : ringkasRute(pemetaanRute({ kategori: kategoriUntukRute(c), jenisKerja: c.workKind }, classifyProduct));
    if (c.active && !ruteKategori.ok && !bundel) belumDipetakan.push({ tipe: "KATEGORI", kode: c.code, nama: c.name, pesan: ruteKategori.pesan });
    return {
      id: c.id, kode: c.code, nama: c.name, bentuk: c.shape, jenisKerja: c.workKind, aktif: c.active, urutan: c.sortOrder, bundel,
      pemetaan: {
        productLine: c.productLine, productType: c.productType,
        layananProduksi: c.productionService ? { id: c.productionService.id, kode: c.productionService.code, nama: c.productionService.labelId } : null,
      },
      rute: ruteKategori,
      komposisi: komposisi(null),
      produk: c.products.map((p) => {
        const rute = bundel ? { ok: true, pesan: null, alur: null, alurLabel: null, productLine: null, productType: null }
          : ringkasRute(pemetaanRute({ kategori: kategoriUntukRute(c), produk: produkUntukRute(p), jenisKerja: c.workKind }, classifyProduct));
        if (p.active && c.active && !rute.ok) belumDipetakan.push({ tipe: "PRODUK", kode: p.code, nama: p.name, kategori: c.name, pesan: rute.pesan });
        return {
          id: p.id, kode: p.code, nama: p.name, aktif: p.active, urutan: p.sortOrder,
          layananProduksi: p.productionService ? { id: p.productionService.id, kode: p.productionService.code, nama: p.productionService.labelId } : null,
          pemetaan: { productLine: p.productLine, productType: p.productType },
          rute, komposisi: komposisi(p.id),
        };
      }),
    };
  });
  // pemenuhan: pilihan cara pemenuhan item penjualan (dibaca layar; tidak ada salinan di frontend).
  const pemenuhan = Object.values(PEMENUHAN).map((p) => ({ kode: p.kode, label: p.label, unit: p.unit, jenisKerja: p.jenisKerja }));
  return { bentuk: definisiBentuk(), pemenuhan, kategori: hasil, ringkasan: { belumDipetakan }, opsi: { lini: LINI, jenisProduk: JENIS_PRODUK, familiJenis: FAMILY_OF_TYPE } };
}

/** Komposisi AKTIF bundel: baris khusus produk bila ada, selain itu komposisi bawaan kategori. Urut. */
export async function muatKomposisi(db, kategoriId, produkId = null) {
  const ambil = (bundleProductId) => db.pkrBundleComponent.findMany({
    where: { bundleCategoryId: kategoriId, bundleProductId }, orderBy: [{ sortOrder: "asc" }],
    include: { componentCategory: true, componentProduct: true },
  });
  let rows = produkId ? await ambil(produkId) : [];
  if (rows.length === 0) rows = await ambil(null);
  return rows;
}

// ── NORMALISASI MASUKAN ────────────────────────────────────────────────────────────────────────────────

/**
 * Masukan mentah [{ kategori (kode) | kategoriId, produkId?, produkNama?, jumlah, panjang, lebar, tebal, tinggi, spesifikasi, perluDikirim }] -> item ternormalisasi.
 * Kategori & produk dicari di katalog AKTIF (nonaktif tidak bisa dipakai untuk item baru). Kategori BUNDEL (Set Kasur Lengkap) dipecah menjadi komponen operasional sesuai
 * komposisi katalog; tiap komponen = item biasa dengan bentuk kategorinya sendiri. Item/produk tanpa pemetaan rute Produksi DIBLOKIR (kode RUTE_*) — tidak menebak.
 * Melempar ItemPkrError (400).
 * @param {{ izinNonaktif?: boolean, periksaRute?: boolean, noAwal?: number, validasi?: boolean, bundelAwal?: number }} [opsi]
 */
export async function siapkanItems(db, raw, { izinNonaktif = false, periksaRute = true, noAwal = 1, validasi = true, bundelAwal = 0, modeRute = null } = {}) {
  // Mode transisi (services/produksiRuteMode.js): item tanpa rute Produksi TIDAK ditolak — ditandai item.rute.ok=false ("Menunggu penentuan alur Produksi"). Mode KETAT = perilaku lama.
  const transisi = periksaRute ? (modeRute ?? await bacaModeRute(db)) === MODE_RUTE.TRANSISI : true;
  if (!Array.isArray(raw) || raw.length === 0) throw new ItemPkrError("Tambahkan minimal satu item produksi", "ITEM_KOSONG");
  if (raw.length > MAKS_ITEM) throw new ItemPkrError(`Maksimal ${MAKS_ITEM} item produksi per penjualan`, "ITEM_TERLALU_BANYAK");
  raw.forEach((r, i) => { if (!r || typeof r !== "object" || Array.isArray(r)) throw new ItemPkrError(`Item ${i + 1}: isian tidak valid`); });
  const idProduk = [...new Set(raw.map((r) => r.produkId).filter((v) => v !== undefined && v !== null && v !== ""))];
  if (idProduk.some((v) => typeof v !== "string" || !UUID.test(v))) throw new ItemPkrError("Produk/varian tidak valid");

  // Fase 1: kategori masukan (kode/id) -> baris katalog; kategori bundel -> komposisi -> masukan komponen.
  const kode = [...new Set(raw.map((r) => (typeof r.kategori === "string" ? r.kategori.trim() : "")).filter(Boolean))];
  const idKat = [...new Set(raw.map((r) => r.kategoriId).filter((v) => typeof v === "string" && UUID.test(v)))];
  const kategoriRows = kode.length || idKat.length ? await db.pkrItemCategory.findMany({ where: { OR: [{ code: { in: kode } }, { id: { in: idKat } }] } }) : [];
  const cariKategori = (r, no) => {
    const k = kategoriRows.find((c) => (r.kategori && c.code === String(r.kategori).trim()) || (r.kategoriId && c.id === r.kategoriId));
    if (!k) throw new ItemPkrError(`Item ${no}: pilih kategori item`, "KATEGORI_WAJIB");
    return k;
  };
  const produkRows = idProduk.length ? await db.pkrItemProduct.findMany({ where: { id: { in: idProduk } } }) : [];

  const mentah = []; // { r, bundleNo, bundleCode, bundleName, asalNo }
  let bundleNo = bundelAwal;
  for (let idx = 0; idx < raw.length; idx += 1) {
    const r = raw[idx];
    const kat = cariKategori(r, idx + 1);
    if (!BENTUK[kat.shape]?.bundel) { mentah.push({ r, bundleNo: null, komponenSeq: 1, komponenQty: 1 }); continue; }
    if (!kat.active && !izinNonaktif) throw new ItemPkrError(`Item ${idx + 1}: kategori "${kat.name}" sudah dinonaktifkan Admin`, "KATEGORI_NONAKTIF");
    let produkSet = null;
    if (r.produkId) {
      produkSet = produkRows.find((p) => p.id === r.produkId);
      if (!produkSet || produkSet.categoryId !== kat.id) throw new ItemPkrError(`Item ${idx + 1}: produk tidak termasuk kategori "${kat.name}"`, "PRODUK_TIDAK_SESUAI");
      if (!produkSet.active && !izinNonaktif) throw new ItemPkrError(`Item ${idx + 1}: produk "${produkSet.name}" sudah dinonaktifkan Admin`, "PRODUK_NONAKTIF");
    }
    const komposisi = await muatKomposisi(db, kat.id, produkSet?.id ?? null);
    const nonaktif = komposisi.find((k) => !k.componentCategory.active);
    if (nonaktif && !izinNonaktif) throw new ItemPkrError(`Item ${idx + 1}: komponen "${nonaktif.componentCategory.name}" pada set "${produkSet?.name || kat.name}" sudah dinonaktifkan Admin. Minta Admin memperbarui komposisi set.`, "KOMPONEN_BUNDEL_NONAKTIF");
    bundleNo += 1;
    let komponen;
    try {
      komponen = pecahBundel(r, komposisi.map((k) => ({ kategoriId: k.componentCategoryId, kategoriCode: k.componentCategory.code, produkId: k.componentProductId, qty: k.qty })), { nama: produkSet?.name || kat.name, kode: kat.code });
    } catch (e) { if (e instanceof ItemPkrError) throw new ItemPkrError(`Item ${idx + 1}: ${e.message}`, e.code); throw e; }
    // Tautan ke baris penjualan (saleItemId/pemenuhan) ikut ke tiap komponen; komponenSeq = urutan komposisi, komponenQty = jumlah komponen per set.
    komponen.forEach((k, ki) => mentah.push({
      r: { ...k, saleItemId: r.saleItemId, pemenuhan: r.pemenuhan }, bundleNo, bundleCode: kat.code, bundleName: produkSet?.name || kat.name, bundleKategoriId: kat.id,
      bundleProdukId: produkSet?.id ?? null, komponenSeq: ki + 1, komponenQty: komposisi[ki].qty,
    }));
  }
  if (mentah.length > MAKS_ITEM) throw new ItemPkrError(`Maksimal ${MAKS_ITEM} item produksi per penjualan (set dihitung per komponen)`, "ITEM_TERLALU_BANYAK");

  // Fase 2: kategori/produk komponen yang belum dimuat.
  const kurangKat = [...new Set(mentah.map((m) => m.r.kategoriId).filter((v) => v && !kategoriRows.some((c) => c.id === v)))];
  if (kurangKat.length) kategoriRows.push(...(await db.pkrItemCategory.findMany({ where: { id: { in: kurangKat } } })));
  const kurangProduk = [...new Set(mentah.map((m) => m.r.produkId).filter((v) => v && !produkRows.some((p) => p.id === v)))];
  if (kurangProduk.length) produkRows.push(...(await db.pkrItemProduct.findMany({ where: { id: { in: kurangProduk } } })));

  const gagalRute = [];
  const items = mentah.map((m, idx) => {
    const r = m.r; const no = noAwal + idx;
    const kategori = cariKategori(r, no);
    if (BENTUK[kategori.shape]?.bundel) throw new ItemPkrError(`Item ${no}: komposisi set tidak boleh berisi set lain`, "BUNDEL_BERSARANG");
    if (!kategori.active && !izinNonaktif) throw new ItemPkrError(`Item ${no}: kategori "${kategori.name}" sudah dinonaktifkan Admin`, "KATEGORI_NONAKTIF");
    let produk = null;
    if (r.produkId) {
      produk = produkRows.find((p) => p.id === r.produkId);
      if (!produk || produk.categoryId !== kategori.id) throw new ItemPkrError(`Item ${no}: produk tidak termasuk kategori "${kategori.name}"`, "PRODUK_TIDAK_SESUAI");
      if (!produk.active && !izinNonaktif) throw new ItemPkrError(`Item ${no}: produk "${produk.name}" sudah dinonaktifkan Admin`, "PRODUK_NONAKTIF");
    }
    const item = normalisasiItem(r, {
      kategori: { id: kategori.id, code: kategori.code, name: kategori.name, shape: kategori.shape, workKind: kategori.workKind },
      produk: produk && { id: produk.id, name: produk.name, productionServiceId: produk.productionServiceId }, no,
    });
    const rute = pemetaanRute({ kategori: kategoriUntukRute(kategori), produk: produk && produkUntukRute(produk), jenisKerja: kategori.workKind }, classifyProduct);
    item.rute = rute;
    item.productLine = rute.productLine ?? null; item.productType = rute.productType ?? null;
    item.productionServiceId = kategori.workKind === "LAYANAN" ? (rute.serviceId ?? null) : null;
    if (m.bundleNo != null) {
      item.bundleNo = m.bundleNo; item.bundleCategoryCode = m.bundleCode; item.bundleName = m.bundleName;
      item.bundleKategoriId = m.bundleKategoriId ?? null; item.bundleProdukId = m.bundleProdukId ?? null;
    }
    // Tautan ke baris penjualan (null = jalur lama): lahirkanItemRows menuliskannya ke pkr_order_items.
    item.saleItemId = r.saleItemId ?? null; item.pemenuhan = r.pemenuhan ?? null; item.komponenSeq = m.komponenSeq ?? 1; item.komponenQty = m.komponenQty ?? 1;
    if (!rute.ok) gagalRute.push({ no, produk: item.produkNama || item.kategoriNama, kode: rute.kode, pesan: rute.pesan });
    return item;
  });
  if (periksaRute && !transisi && gagalRute.length) {
    const sisa = gagalRute.length - 1;
    throw new ItemPkrError(`Item ${gagalRute[0].no}: ${gagalRute[0].pesan}${sisa > 0 ? ` (dan ${sisa} item lain belum dipetakan)` : ""}`, gagalRute[0].kode, { rute: gagalRute, aksi: "Pengaturan Produksi › Katalog Item PKR" });
  }
  if (validasi) validasiHimpunan(items);
  return items;
}

// ── PRATINJAU (tanpa menulis) ──────────────────────────────────────────────────────────────────────────

/** Rencana unit per item — fungsi yang SAMA dipakai pembuatan dan pratinjau. */
export function rencanaUnit(items, { awalNomor = 0 } = {}) {
  let u = awalNomor;
  return items.map((i) => {
    const d = deskripsiUnit(i);
    const nomor = Array.from({ length: i.jumlah }, () => `U${++u}`);
    const layanan = i.jenisKerja === "LAYANAN";
    return {
      no: i.no, jumlah: i.jumlah, nomorUnit: nomor, merk: d.merk, ukuran: d.ukuran, kategoriKerja: i.jenisKerja,
      statusAwal: layanan ? "AWAITING_PICKUP" : "RECEIVED",
      statusAwalLabel: layanan ? "Menunggu pengambilan (job pickup dibuat)" : "Langsung di workshop (siap produksi)",
    };
  });
}

/** Ringkas per item untuk pratinjau/koreksi (bentuk yang sama di kedua layar). */
export function ringkasItemPratinjau(i, rencana) {
  return {
    no: i.no, kategori: i.kategoriCode, kategoriNama: i.kategoriNama, bentuk: i.bentuk, jenisKerja: i.jenisKerja, produk: i.produkNama, jumlah: i.jumlah, ukuran: i.ukuranLabel || null,
    spesifikasi: i.spesifikasi, perluDikirim: i.perluDikirim, kirimLabel: LABEL_KIRIM(i.perluDikirim), kurang: i.kurang,
    bundel: i.bundleNo != null ? { no: i.bundleNo, nama: i.bundleName ?? null, kode: i.bundleCategoryCode ?? null } : null,
    rute: i.rute ? ringkasRute(i.rute) : null, menungguAlur: !!(i.rute && i.rute.ok === false),
    layananProduksiOtomatis: !!i.productionServiceId, unit: rencana?.find((r) => r.no === i.no) ?? null,
  };
}

/**
 * Pratinjau "Buat/Tautkan Order CRM" untuk masukan multi-item. Hanya MEMBACA. Mengembalikan { valid, galat?, ... }: masukan salah bukan error HTTP — layar menampilkannya.
 * `penjualanId` (opsional) = PKR yang sudah ada: bila order-nya sudah ada, pratinjau menyatakan tidak ada order baru yang dibuat (idempoten).
 */
export async function pratinjauItems(db, { penjualanId = null, items: raw, alamat = null } = {}) {
  let sudahAda = null;
  if (penjualanId) {
    if (!UUID.test(penjualanId)) throw gagal("Penjualan karyawan tidak ditemukan", 404);
    const pkr = await db.finPenjualanKaryawan.findUnique({ where: { id: penjualanId }, select: { id: true, nomor: true, status: true, orderCrm: { select: { id: true, orderNumber: true } } } });
    if (!pkr) throw gagal("Penjualan karyawan tidak ditemukan", 404);
    if (pkr.status !== "AKTIF") return { valid: false, galat: { pesan: `${pkr.nomor} sudah dibatalkan — order CRM tidak dibuat`, kode: "PKR_DIBATALKAN" } };
    if (pkr.orderCrm) sudahAda = { orderId: pkr.orderCrm.id, nomor: pkr.orderCrm.orderNumber };
  }
  let items;
  try { items = await siapkanItems(db, raw); } catch (e) {
    if (e instanceof ItemPkrError) return { valid: false, galat: { pesan: e.message, kode: e.code, ...(e.extra ?? {}) } };
    throw e;
  }
  return bangunPratinjau(items, { alamat, sudahAda });
}

/** Bagian pratinjau yang hanya bergantung pada item yang SUDAH siap (dipakai jalur lama dan jalur terpadu). */
export function bangunPratinjau(items, { alamat = null, sudahAda = null } = {}) {
  const rencana = rencanaUnit(items);
  const kel = kelengkapanItems(items, { alamat });
  const dikirim = items.filter((i) => i.perluDikirim === true).map((i) => i.no);
  const diambil = items.filter((i) => i.perluDikirim === false).map((i) => i.no);
  const belum = items.filter((i) => i.perluDikirim === null).map((i) => i.no);
  const layanan = items.filter((i) => i.jenisKerja === "LAYANAN").map((i) => i.no);
  const totalUnit = items.reduce((a, i) => a + i.jumlah, 0);
  const kategori = kategoriOrderDariItems(items);
  return {
    valid: true, sudahAdaOrder: sudahAda,
    order: { kategori, kategoriLabel: LABEL_KATEGORI_ORDER[kategori], jumlahItem: items.length, jumlahUnit: totalUnit, nilai: 0, perluDikirim: perluDikirimDariItems(items) },
    items: items.map((i) => ringkasItemPratinjau(i, rencana)),
    produksi: { lengkap: kel.lengkap, kurang: kel.kurang, status: kel.lengkap ? "Siap diproduksi" : "Perlu dilengkapi (item yang belum lengkap belum bisa dijadwalkan/dimulai Produksi)" },
    pickup: { adaJob: layanan.length > 0, itemNo: layanan },
    delivery: {
      adaJobPengiriman: dikirim.length > 0, itemDikirim: dikirim, itemDiambilSendiri: diambil, itemBelumDitentukan: belum, jobGanda: false,
      catatan: dikirim.length
        ? "Delivery menunggu SELURUH unit yang dikirim siap, lalu membuat SATU job pengiriman. Tidak ada job kedua otomatis; pengiriman sebagian hanya lewat aksi eksplisit di Delivery (unit dipilih + alasan)."
        : null,
    },
    peringatan: peringatanHimpunan(items),
    tidakDibuat: TIDAK_DIBUAT,
  };
}

// ── PEMBUATAN ──────────────────────────────────────────────────────────────────────────────────────────

/** Cerminan item untuk Order.notes (dipanggil saat membuat order dan setiap kali item berubah). */
export const susunCerminan = (items) => items.map(cerminanItem);

/** Himpunan item order -> kunci pembanding (replay dengan isi sama = idempoten; isi beda = konflik). */
export const kunciHimpunan = (items) => JSON.stringify(items.map((i) => [kunciDuplikat(i), i.jumlah]).sort());

/** Order.productLine turunan: semua item divan/sandaran -> DIVAN; selain itu KASUR. */
export const productLineDariItems = (items) => (items.every((i) => i.bentuk === "DIVAN" || i.bentuk === "SANDARAN") ? "DIVAN" : "KASUR");

/**
 * Buat baris item + unit per item untuk order yang SUDAH dibuat. Di dalam transaksi pemanggil; order sudah terkunci. Nomor item = `it.no` (seq). Unit lahir lewat createUnitsForOrder:
 *   • item BARU    -> unit langsung RECEIVED (di workshop);
 *   • item LAYANAN -> unit AWAITING_PICKUP + job pickup (jalur baku ensurePickupJobForOrder).
 * Tiap unit DISTEMPEL kategori kerja + jenis produk itemnya (units.work_category/product_line/product_type) — rute Produksi dihitung per unit, bukan per order. Merk/ukuran unit =
 * deskripsi item. Item LAYANAN yang dipetakan ke layanan produksi -> layanan + rute unit ditetapkan (satu-satunya pilihan; Produksi tidak memilih lagi).
 */
export async function lahirkanItemRows(tx, { pkrId, orderId, items, userId = null }) {
  const idLayanan = [...new Set(items.map((i) => i.productionServiceId).filter(Boolean))];
  const layanan = new Map((idLayanan.length ? await tx.serviceCatalog.findMany({ where: { id: { in: idLayanan } } }) : []).map((s) => [s.id, s]));
  const hasil = [];
  for (const it of items) {
    const row = await tx.pkrOrderItem.create({
      data: {
        penjualanId: pkrId, orderId, seq: it.no, categoryId: it.kategoriId, productId: it.produkId, categoryCode: it.kategoriCode, categoryName: it.kategoriNama,
        shape: it.bentuk, workKind: it.jenisKerja, productName: it.produkNama, qty: it.jumlah,
        lengthCm: it.panjang, widthCm: it.lebar, thicknessCm: it.tebal, heightCm: it.tinggi, specNotes: it.spesifikasi, perluDikirim: it.perluDikirim,
        bundleNo: it.bundleNo ?? null, bundleCategoryCode: it.bundleCategoryCode ?? null, bundleName: it.bundleName ?? null,
        ...(it.saleItemId && { saleItemId: it.saleItemId, componentSeq: it.komponenSeq ?? 1, componentQty: it.komponenQty ?? 1, fulfillment: it.pemenuhan }),
      },
    });
    const unit = await lahirkanUnitItem(tx, { orderId, it, rowId: row.id, layanan, userId });
    hasil.push({ no: it.no, itemId: row.id, unit });
  }
  return hasil;
}

/** Lahirkan `jumlah` unit untuk satu item yang barisnya sudah ada (dipakai pembuatan dan Koreksi: tambah item / tambah jumlah). */
export async function lahirkanUnitItem(tx, { orderId, it, rowId, layanan = new Map(), userId = null, jumlah = it.jumlah }) {
  // Order dimuat ULANG tiap item: createUnitsForOrder membaca status/kategori order (D-051) dan item sebelumnya sudah memajukan statusnya.
  const order = await tx.order.findUnique({ where: { id: orderId } });
  const units = await createUnitsForOrder(tx, { order, count: jumlah, statusOverride: it.jenisKerja === "LAYANAN" ? "AWAITING_PICKUP" : "RECEIVED" });
  const d = deskripsiUnit(it);
  const ids = units.map((u) => u.id);
  await tx.unit.updateMany({
    where: { id: { in: ids } },
    data: { merk: d.merk, ukuran: d.ukuran, workCategory: it.jenisKerja, ...(it.productLine && { productLine: it.productLine }), ...(it.productType && { productType: it.productType }) },
  });
  const svc = it.jenisKerja === "LAYANAN" && it.productionServiceId ? (layanan.get(it.productionServiceId) ?? await tx.serviceCatalog.findUnique({ where: { id: it.productionServiceId } })) : null;
  if (svc) {
    await tx.unit.updateMany({ where: { id: { in: ids } }, data: { serviceId: svc.id, serviceLine: svc.serviceLine } });
    for (const id of ids) await tryProvisionUnitRoute(tx, id, svc.id, userId);
  }
  await tx.pkrOrderItemUnit.createMany({ data: ids.map((unitId) => ({ itemId: rowId, unitId })) });
  return units.map((u) => u.unitCode);
}

/** Pembuatan awal: baris item + unit + revisi 1 (DIBUAT). */
export async function lahirkanItemDanUnit(tx, { pkrId, orderId, items, userId = null }) {
  const hasil = await lahirkanItemRows(tx, { pkrId, orderId, items, userId });
  await tulisRevisi(tx, { orderId, penjualanId: pkrId, kind: "DIBUAT", after: await snapshotItems(tx, orderId), userId, expected: 0 });
  return hasil;
}

// ── BACA ───────────────────────────────────────────────────────────────────────────────────────────────

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Baris pkr_order_items -> bentuk domain (angka biasa). */
export function itemDariRow(r) {
  const item = {
    no: r.seq, kategoriId: r.categoryId, kategoriCode: r.categoryCode, kategoriNama: r.categoryName, bentuk: r.shape, jenisKerja: r.workKind,
    produkId: r.productId, produkNama: r.productName, jumlah: r.qty, panjang: num(r.lengthCm), lebar: num(r.widthCm), tebal: num(r.thicknessCm), tinggi: num(r.heightCm),
    spesifikasi: r.specNotes, perluDikirim: r.perluDikirim,
    bundleNo: r.bundleNo ?? null, bundleCategoryCode: r.bundleCategoryCode ?? null, bundleName: r.bundleName ?? null,
  };
  item.ukuranLabel = ukuranLabel(item);
  return item;
}

/** Filter item AKTIF (belum dihapus lunak lewat Koreksi Item). */
export const ITEM_AKTIF = Object.freeze({ removedAt: null });

// ── UBAH ITEM SETELAH ORDER ADA ────────────────────────────────────────────────────────────────────────

/**
 * Ubah spesifikasi/pilihan kirim per item (diidentifikasi `no`). Kategori & jumlah TERKUNCI (409) di jalur ini — menambah/menghapus item atau mengubah jumlah memakai Koreksi Item
 * (alasan wajib, pratinjau dampak, revisi optimistis). Isian tidak dikirim = tidak berubah; "" / null = dikosongkan. Spesifikasi tidak bisa diubah setelah Produksi memulai unit
 * item itu; pilihan kirim boleh kecuali kirim -> ambil sendiri ketika unit item itu sudah masuk job pengiriman. Dipanggil di dalam transaksi pemanggil dengan order terkunci.
 * Perubahan menulis SATU revisi (DILENGKAPI) di buku revisi.
 * @returns {{ perubahan: object[], data: object, perluKirimBaru: boolean }}
 */
export async function ubahItemOrder(tx, { order, masukan, userId = null }) {
  if (!Array.isArray(masukan) || masukan.length === 0) throw gagal("Daftar item yang diubah kosong");
  const sebelumSnapshot = await snapshotItems(tx, order.id);
  const rows = await tx.pkrOrderItem.findMany({
    where: { orderId: order.id, ...ITEM_AKTIF }, orderBy: { seq: "asc" },
    include: { units: { include: { unit: { select: { id: true, status: true, currentStageId: true, serviceId: true, merk: true, ukuran: true, jobUnits: { where: { job: { type: "DELIVERY", status: { in: ACTIVE_JOB_STATUSES } } }, select: { id: true } } } } } } },
  });
  const perubahan = [];
  let perluKirimBaru = false;
  const idProduk = [...new Set(masukan.map((m) => m?.produkId).filter(Boolean))];
  const produkRows = idProduk.length ? await tx.pkrItemProduct.findMany({ where: { id: { in: idProduk } } }) : [];
  for (const m of masukan) {
    if (!m || typeof m !== "object") throw gagal("Isian item tidak valid");
    const row = rows.find((r) => r.seq === Number(m.no));
    if (!row) throw gagal(`Item ${m.no ?? "?"} tidak ditemukan pada order ini`, 404);
    if (m.kategori !== undefined && m.kategori !== row.categoryCode) throw gagal(`Item ${row.seq}: kategori tidak bisa diubah di sini — pakai Koreksi Item (hapus lalu tambah item)`, 409, "ITEM_STRUKTUR_TERKUNCI");
    if (m.jumlah !== undefined && Number(m.jumlah) !== row.qty) throw gagal(`Item ${row.seq}: jumlah tidak bisa diubah di sini — pakai Koreksi Item (alasan wajib + pratinjau dampak)`, 409, "ITEM_STRUKTUR_TERKUNCI");

    const lama = itemDariRow(row);
    const mentah = { jumlah: lama.jumlah, panjang: lama.panjang, lebar: lama.lebar, tebal: lama.tebal, tinggi: lama.tinggi, spesifikasi: lama.spesifikasi, perluDikirim: lama.perluDikirim, produkNama: lama.produkNama, produkId: lama.produkId };
    for (const k of ["panjang", "lebar", "tebal", "tinggi", "spesifikasi", "produkNama", "perluDikirim", "produkId"]) if (k in m) mentah[k] = m[k];
    let produk = null;
    if (mentah.produkId) {
      const p = produkRows.find((x) => x.id === mentah.produkId) ?? (mentah.produkId === lama.produkId ? await tx.pkrItemProduct.findUnique({ where: { id: row.productId } }) : null);
      if (!p || p.categoryId !== row.categoryId) throw gagal(`Item ${row.seq}: produk tidak termasuk kategori ${row.categoryName}`, 400, "PRODUK_TIDAK_SESUAI");
      if (!p.active && mentah.produkId !== lama.produkId) throw gagal(`Item ${row.seq}: produk "${p.name}" sudah dinonaktifkan Admin`, 400, "PRODUK_NONAKTIF");
      produk = p;
    }
    const baru = normalisasiItem(mentah, {
      kategori: { id: row.categoryId, code: row.categoryCode, name: row.categoryName, shape: row.shape, workKind: row.workKind },
      produk: produk && { id: produk.id, name: produk.name, productionServiceId: produk.productionServiceId }, no: row.seq,
    });
    const produkIdBaru = produk ? produk.id : ("produkId" in m ? null : row.productId);
    const produkBerubah = (produkIdBaru ?? null) !== (row.productId ?? null);

    const beda = {};
    const cek = (k, a, b) => { if ((a ?? null) !== (b ?? null)) beda[k] = { sebelum: a ?? null, sesudah: b ?? null }; };
    for (const k of ["panjang", "lebar", "tebal", "tinggi", "spesifikasi", "produkNama", "perluDikirim"]) cek(k, lama[k], baru[k]);
    if (Object.keys(beda).length === 0 && !produkBerubah) continue;

    const unitAktif = row.units.map((x) => x.unit).filter((u) => u.status !== "CANCELLED");
    const sudahMulai = unitAktif.some((u) => u.currentStageId != null || !STATUS_UNIT_BELUM_MULAI.includes(u.status));
    const hanyaKirim = Object.keys(beda).every((k) => k === "perluDikirim") && !produkBerubah;
    if (sudahMulai && !hanyaKirim) throw gagal(`Item ${row.seq}: Produksi sudah mulai mengerjakan unit — spesifikasi tidak bisa diubah. Untuk perubahan besar, ajukan pembatalan resmi lalu catat ulang.`, 409, "ITEM_SUDAH_DIPRODUKSI");
    if (beda.perluDikirim && lama.perluDikirim === true && baru.perluDikirim !== true && unitAktif.some((u) => u.jobUnits.length > 0)) {
      throw gagal(`Item ${row.seq}: unit sudah masuk job pengiriman. Batalkan atau ubah lewat Delivery dulu sebelum menandai item ini diambil sendiri.`, 409, "ITEM_SUDAH_DI_JOB_KIRIM");
    }
    if (beda.perluDikirim && baru.perluDikirim === true) perluKirimBaru = true;

    // Produk berganti: rute Produksi dihitung ulang dari pemetaan produk baru (BLOK bila belum dipetakan; layanan produksi tidak boleh berubah lewat jalur ini).
    let stempel = null;
    if (produkBerubah) {
      const kategoriRow = await tx.pkrItemCategory.findUnique({ where: { id: row.categoryId } });
      const rute = pemetaanRute({ kategori: kategoriUntukRute(kategoriRow), produk: produk && produkUntukRute(produk), jenisKerja: row.workKind }, classifyProduct);
      if (!rute.ok && !(await ruteBelumDipetakanBoleh(tx))) throw gagal(`Item ${row.seq}: ${rute.pesan}`, 422, rute.kode);
      if (row.workKind === "LAYANAN" && unitAktif.some((u) => (u.serviceId ?? null) !== (rute.serviceId ?? null))) {
        throw gagal(`Item ${row.seq}: produk baru memakai layanan produksi yang berbeda. Hapus item ini lalu tambahkan item baru lewat Koreksi Item.`, 409, "LAYANAN_BERBEDA");
      }
      stempel = { productLine: rute.productLine ?? null, productType: rute.productType ?? null };
      beda.produkId = { sebelum: row.productId ?? null, sesudah: produkIdBaru ?? null };
    }

    await tx.pkrOrderItem.update({
      where: { id: row.id },
      data: {
        lengthCm: baru.panjang, widthCm: baru.lebar, thicknessCm: baru.tebal, heightCm: baru.tinggi, specNotes: baru.spesifikasi, perluDikirim: baru.perluDikirim,
        productId: produkIdBaru, productName: baru.produkNama,
      },
    });
    // Baris penjualan yang TERTAUT (non-bundel) adalah sumber kanonis yang sama: cerminkan nama/ukuran/spesifikasi/kirim ke sana dalam transaksi ini supaya tidak ada dua nilai.
    // (Komponen Set menyimpan spesifikasi PER KOMPONEN sebagai snapshot operasional; baris penjualannya hanya memegang nama set + harga.)
    if (row.saleItemId && row.bundleNo == null) {
      if (!baru.produkNama) throw gagal(`Item ${row.seq}: nama item tidak boleh dikosongkan`, 400, "NAMA_ITEM_WAJIB");
      await tx.finPenjualanKaryawanItem.update({
        where: { id: row.saleItemId },
        data: { name: baru.produkNama, productId: produkIdBaru ?? null, lengthCm: baru.panjang, widthCm: baru.lebar, thicknessCm: baru.tebal, heightCm: baru.tinggi, specNotes: baru.spesifikasi, perluDikirim: baru.perluDikirim },
      });
    }
    if (stempel && unitAktif.length) await tx.unit.updateMany({ where: { id: { in: unitAktif.map((u) => u.id) } }, data: stempel });
    // Unit: merk/ukuran mengikuti deskripsi item HANYA bila belum diubah manual (sama dengan deskripsi lama atau kosong) — pola sinkronUkuranUnit.
    const dLama = deskripsiUnit(lama); const dBaru = deskripsiUnit(baru);
    const idUnit = unitAktif.map((u) => u.id);
    if (idUnit.length && (dLama.merk !== dBaru.merk || dLama.ukuran !== dBaru.ukuran)) {
      if (dLama.merk !== dBaru.merk) await tx.unit.updateMany({ where: { id: { in: idUnit }, OR: [{ merk: null }, { merk: dLama.merk }] }, data: { merk: dBaru.merk } });
      if (dLama.ukuran !== dBaru.ukuran) await tx.unit.updateMany({ where: { id: { in: idUnit }, OR: [{ ukuran: null }, { ukuran: dLama.ukuran ?? "" }] }, data: { ukuran: dBaru.ukuran } });
    }
    perubahan.push({ no: row.seq, produk: row.productName ?? row.categoryName, ...beda });
  }

  // Cerminan di Order.notes + turunan tingkat order dari baris SESUDAH perubahan (satu sumber: tabel).
  const sesudah = (await tx.pkrOrderItem.findMany({ where: { orderId: order.id, ...ITEM_AKTIF }, orderBy: { seq: "asc" } })).map(itemDariRow);
  const info = bacaNotesOrder(order.notes);
  const data = {};
  if (perubahan.length) {
    data.notes = JSON.stringify({ ...info, pkrItems: susunCerminan(sesudah) });
    data.pkrPerluDikirim = perluDikirimDariItems(sesudah);
    if (order.penjualanKaryawanId) {
      await tulisRevisi(tx, { orderId: order.id, penjualanId: order.penjualanKaryawanId, kind: "DILENGKAPI", before: sebelumSnapshot, after: await snapshotItems(tx, order.id), impact: { perubahan }, userId });
    }
  }
  return { perubahan, data, perluKirimBaru, itemsSesudah: sesudah };
}

// ── PENGELOLAAN KATALOG (Admin: izin pkr_catalog:manage) ───────────────────────────────────────────────

const KODE_RE = /^[A-Z0-9][A-Z0-9_:.-]{1,59}$/;
const teksWajib = (v, maks, nama) => {
  const t = String(v ?? "").trim().replace(/\s+/g, " ");
  if (t.length < 2) throw gagal(`${nama} wajib diisi (minimal 2 karakter)`);
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`);
  return t;
};
const urutan = (v) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw gagal("Urutan harus bilangan bulat 0–9999");
  return n;
};
const audit = (tx, { entityId, userId, aksi, metadata }) => recordActivity(tx, { entityType: ENTITY_TYPES.PKR_KATALOG, entityId, eventType: EVENT_TYPES.PKR_KATALOG_DIUBAH, actorId: userId, metadata: { aksi, ...metadata } });

/** Pemetaan opsional dari masukan Admin. undefined = tidak diubah; null/"" = dikosongkan. */
function bacaPemetaan(m) {
  const out = {};
  if (m.productLine !== undefined) {
    if (m.productLine === null || m.productLine === "") out.productLine = null;
    else if (LINI.includes(m.productLine)) out.productLine = m.productLine;
    else throw gagal(`Lini produk harus salah satu dari: ${LINI.join(", ")}`, 400, "LINI_TIDAK_VALID");
  }
  if (m.productType !== undefined) {
    if (m.productType === null || m.productType === "") out.productType = null;
    else if (JENIS_PRODUK.includes(m.productType)) out.productType = m.productType;
    else throw gagal("Jenis produk tidak dikenal", 400, "JENIS_TIDAK_VALID");
  }
  const lini = out.productLine; const jenis = out.productType;
  if (lini && jenis && FAMILY_OF_TYPE[jenis] !== lini) throw gagal(`Jenis produk ${jenis} termasuk lini ${FAMILY_OF_TYPE[jenis]}, bukan ${lini}`, 400, "LINI_JENIS_TIDAK_SESUAI");
  return out;
}

export async function buatKategori(tx, { kode, nama, bentuk, jenisKerja, urutan: u, userId, productLine, productType, layananProduksiId }) {
  const code = String(kode ?? "").trim().toUpperCase();
  if (!KODE_RE.test(code)) throw gagal("Kode kategori: huruf besar/angka/_ (2–60 karakter), mis. DIVAN_LACI");
  if (!BENTUK[bentuk]) throw gagal(`Bentuk isian harus salah satu dari: ${Object.keys(BENTUK).join(", ")}`);
  if (!["BARU", "LAYANAN"].includes(jenisKerja)) throw gagal("Jenis pekerjaan harus BARU atau LAYANAN");
  if (await tx.pkrItemCategory.findUnique({ where: { code }, select: { id: true } })) throw gagal(`Kode kategori ${code} sudah dipakai`, 409, "KODE_SUDAH_ADA");
  const peta = bacaPemetaan({ productLine, productType });
  if (layananProduksiId) await pastikanLayananAda(tx, layananProduksiId);
  const c = await tx.pkrItemCategory.create({
    data: { code, name: teksWajib(nama, 100, "Nama kategori"), shape: bentuk, workKind: jenisKerja, sortOrder: urutan(u) ?? 100, ...peta, productionServiceId: layananProduksiId || null },
  });
  await audit(tx, { entityId: c.id, userId, aksi: "kategori_dibuat", metadata: { kode: code, nama: c.name, bentuk, jenisKerja, ...peta, layananProduksiId: c.productionServiceId } });
  return c;
}

export async function ubahKategori(tx, { id, nama, aktif, urutan: u, userId, productLine, productType, layananProduksiId }) {
  if (!UUID.test(String(id))) throw gagal("Kategori tidak ditemukan", 404);
  const lama = await tx.pkrItemCategory.findUnique({ where: { id } });
  if (!lama) throw gagal("Kategori tidak ditemukan", 404);
  const data = {};
  if (nama !== undefined) data.name = teksWajib(nama, 100, "Nama kategori");
  if (aktif !== undefined) { if (typeof aktif !== "boolean") throw gagal("Status aktif tidak valid"); data.active = aktif; }
  const uu = urutan(u); if (uu !== undefined) data.sortOrder = uu;
  const peta = bacaPemetaan({ productLine, productType });
  // Lini + jenis diperiksa gabungan dengan nilai yang sudah ada (mis. hanya jenis dikirim).
  const lini = "productLine" in peta ? peta.productLine : lama.productLine; const jenis = "productType" in peta ? peta.productType : lama.productType;
  if (lini && jenis && FAMILY_OF_TYPE[jenis] !== lini) throw gagal(`Jenis produk ${jenis} termasuk lini ${FAMILY_OF_TYPE[jenis]}, bukan ${lini}`, 400, "LINI_JENIS_TIDAK_SESUAI");
  Object.assign(data, peta);
  if (layananProduksiId !== undefined) {
    if (layananProduksiId) await pastikanLayananAda(tx, layananProduksiId);
    data.productionServiceId = layananProduksiId || null;
  }
  if (Object.keys(data).length === 0) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  const c = await tx.pkrItemCategory.update({ where: { id }, data });
  await audit(tx, {
    entityId: id, userId, aksi: "kategori_diubah",
    metadata: {
      kode: lama.code,
      sebelum: { nama: lama.name, aktif: lama.active, urutan: lama.sortOrder, productLine: lama.productLine, productType: lama.productType, layananProduksiId: lama.productionServiceId },
      sesudah: { nama: c.name, aktif: c.active, urutan: c.sortOrder, productLine: c.productLine, productType: c.productType, layananProduksiId: c.productionServiceId },
    },
  });
  return c;
}

export async function buatProduk(tx, { kategoriId, kode, nama, layananProduksiId = null, urutan: u, userId, productLine, productType }) {
  if (!UUID.test(String(kategoriId))) throw gagal("Kategori tidak ditemukan", 404);
  const kat = await tx.pkrItemCategory.findUnique({ where: { id: kategoriId } });
  if (!kat) throw gagal("Kategori tidak ditemukan", 404);
  const code = String(kode ?? "").trim().toUpperCase();
  if (!KODE_RE.test(code)) throw gagal("Kode produk: huruf besar/angka/_ (2–60 karakter), mis. DIVAN_LACI_180");
  if (await tx.pkrItemProduct.findUnique({ where: { code }, select: { id: true } })) throw gagal(`Kode produk ${code} sudah dipakai`, 409, "KODE_SUDAH_ADA");
  if (layananProduksiId) await pastikanLayananAda(tx, layananProduksiId);
  const peta = bacaPemetaan({ productLine, productType });
  const p = await tx.pkrItemProduct.create({ data: { categoryId: kat.id, code, name: teksWajib(nama, 160, "Nama produk"), productionServiceId: layananProduksiId || null, sortOrder: urutan(u) ?? 100, ...peta } });
  await audit(tx, { entityId: p.id, userId, aksi: "produk_dibuat", metadata: { kode: code, nama: p.name, kategori: kat.code, layananProduksiId: p.productionServiceId, ...peta } });
  return p;
}

async function pastikanLayananAda(tx, id) {
  if (!UUID.test(String(id))) throw gagal("Layanan produksi tidak ditemukan", 404);
  const s = await tx.serviceCatalog.findUnique({ where: { id }, select: { id: true, active: true } });
  if (!s) throw gagal("Layanan produksi tidak ditemukan", 404);
  if (!s.active) throw gagal("Layanan produksi itu nonaktif", 409);
}

export async function ubahProduk(tx, { id, nama, aktif, urutan: u, layananProduksiId, userId, productLine, productType }) {
  if (!UUID.test(String(id))) throw gagal("Produk tidak ditemukan", 404);
  const lama = await tx.pkrItemProduct.findUnique({ where: { id } });
  if (!lama) throw gagal("Produk tidak ditemukan", 404);
  const data = {};
  if (nama !== undefined) data.name = teksWajib(nama, 160, "Nama produk");
  if (aktif !== undefined) { if (typeof aktif !== "boolean") throw gagal("Status aktif tidak valid"); data.active = aktif; }
  const uu = urutan(u); if (uu !== undefined) data.sortOrder = uu;
  if (layananProduksiId !== undefined) {
    if (layananProduksiId) await pastikanLayananAda(tx, layananProduksiId);
    data.productionServiceId = layananProduksiId || null;
  }
  const peta = bacaPemetaan({ productLine, productType });
  const lini = "productLine" in peta ? peta.productLine : lama.productLine; const jenis = "productType" in peta ? peta.productType : lama.productType;
  if (lini && jenis && FAMILY_OF_TYPE[jenis] !== lini) throw gagal(`Jenis produk ${jenis} termasuk lini ${FAMILY_OF_TYPE[jenis]}, bukan ${lini}`, 400, "LINI_JENIS_TIDAK_SESUAI");
  Object.assign(data, peta);
  if (Object.keys(data).length === 0) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  const p = await tx.pkrItemProduct.update({ where: { id }, data });
  await audit(tx, {
    entityId: id, userId, aksi: "produk_diubah",
    metadata: {
      kode: lama.code,
      sebelum: { nama: lama.name, aktif: lama.active, layananProduksiId: lama.productionServiceId, productLine: lama.productLine, productType: lama.productType },
      sesudah: { nama: p.name, aktif: p.active, layananProduksiId: p.productionServiceId, productLine: p.productLine, productType: p.productType },
    },
  });
  return p;
}

/**
 * Ganti SELURUH komposisi bundel (kategori bundel, atau satu produknya bila `produkId` diisi) dalam satu transaksi, dengan audit sebelum/sesudah.
 * `komponen` = [{ kategoriId, produkId?, jumlah }] urut. Kosong = komposisi dikosongkan (produk: kembali memakai komposisi kategori; kategori: set tidak bisa dipakai).
 */
export async function simpanKomposisi(tx, { kategoriId, produkId = null, komponen, userId }) {
  if (!UUID.test(String(kategoriId))) throw gagal("Kategori tidak ditemukan", 404);
  const kat = await tx.pkrItemCategory.findUnique({ where: { id: kategoriId } });
  if (!kat) throw gagal("Kategori tidak ditemukan", 404);
  if (!BENTUK[kat.shape]?.bundel) throw gagal(`Kategori "${kat.name}" bukan bundel (bentuk Set) — komposisi hanya untuk kategori bentuk Set`, 409, "BUKAN_BUNDEL");
  if (produkId) {
    const p = await tx.pkrItemProduct.findUnique({ where: { id: produkId } });
    if (!p || p.categoryId !== kat.id) throw gagal("Produk tidak termasuk kategori ini", 404);
  }
  if (!Array.isArray(komponen) || komponen.length > 10) throw gagal("Komposisi maksimal 10 komponen");
  const lihat = new Set();
  const baru = [];
  for (let i = 0; i < komponen.length; i += 1) {
    const k = komponen[i] || {};
    if (!UUID.test(String(k.kategoriId))) throw gagal(`Komponen ${i + 1}: pilih kategori`, 400, "KOMPONEN_TIDAK_VALID");
    const jumlah = Number(k.jumlah ?? 1);
    if (!Number.isInteger(jumlah) || jumlah < 1 || jumlah > 20) throw gagal(`Komponen ${i + 1}: jumlah harus bilangan bulat 1–20`);
    const kc = await tx.pkrItemCategory.findUnique({ where: { id: k.kategoriId } });
    if (!kc) throw gagal(`Komponen ${i + 1}: kategori tidak ditemukan`, 404);
    if (BENTUK[kc.shape]?.bundel) throw gagal(`Komponen ${i + 1}: set tidak boleh berisi set lain`, 409, "BUNDEL_BERSARANG");
    if (!kc.active) throw gagal(`Komponen ${i + 1}: kategori "${kc.name}" nonaktif`, 409);
    let kp = null;
    if (k.produkId) {
      kp = await tx.pkrItemProduct.findUnique({ where: { id: k.produkId } });
      if (!kp || kp.categoryId !== kc.id) throw gagal(`Komponen ${i + 1}: produk tidak termasuk kategori "${kc.name}"`, 400, "PRODUK_TIDAK_SESUAI");
    }
    const kunci = `${kc.id}:${kp?.id ?? ""}`;
    if (lihat.has(kunci)) throw gagal(`Komponen ${i + 1}: kombinasi kategori/produk yang sama sudah ada — naikkan jumlahnya`, 409, "KOMPONEN_GANDA");
    lihat.add(kunci);
    baru.push({ kategoriId: kc.id, produkId: kp?.id ?? null, jumlah, urut: (i + 1) * 10, label: `${kc.name}${kp ? ` · ${kp.name}` : ""} ×${jumlah}` });
  }
  const lama = await tx.pkrBundleComponent.findMany({ where: { bundleCategoryId: kat.id, bundleProductId: produkId }, orderBy: { sortOrder: "asc" }, include: { componentCategory: { select: { name: true } }, componentProduct: { select: { name: true } } } });
  await tx.pkrBundleComponent.deleteMany({ where: { bundleCategoryId: kat.id, bundleProductId: produkId } });
  for (const b of baru) {
    await tx.pkrBundleComponent.create({ data: { bundleCategoryId: kat.id, bundleProductId: produkId, componentCategoryId: b.kategoriId, componentProductId: b.produkId, qty: b.jumlah, sortOrder: b.urut } });
  }
  await audit(tx, {
    entityId: produkId ?? kat.id, userId, aksi: "komposisi_diubah",
    metadata: {
      kategori: kat.code, produkId,
      sebelum: lama.map((l) => `${l.componentCategory.name}${l.componentProduct ? ` · ${l.componentProduct.name}` : ""} ×${l.qty}`),
      sesudah: baru.map((b) => b.label),
    },
  });
  return { jumlah: baru.length };
}

export { revisiTerakhir };
