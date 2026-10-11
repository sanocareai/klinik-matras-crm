// ITEM PRODUKSI PENJUALAN KARYAWAN — katalog (dikelola Admin), normalisasi dari DB, pratinjau, dan pembuatan unit per item.
//
// Aturan murni (bentuk isian, validasi, kelengkapan, label) ada di lib/domain/pkrItem.js. File ini hanya menambahkan akses DB:
//   • katalog kategori/produk (baris data; Admin menambah/menonaktifkan — bukan enum di kode),
//   • siapkanItems : masukan mentah -> item ternormalisasi (kategori/produk dicari di katalog AKTIF),
//   • pratinjau    : apa yang AKAN dibuat (unit, pickup, pengiriman, kelengkapan) TANPA menulis apa pun — memakai fungsi yang sama dengan pembuatan,
//   • lahirkanItemDanUnit : dalam transaksi pemanggil, buat baris item + unit per item lewat jalur BAKU createUnitsForOrder (tidak ada jalur Produksi/Delivery baru),
//   • ubahItemOrder : perubahan spesifikasi/pilihan kirim per item setelah order ada (struktur — kategori & jumlah — terkunci).
// TIDAK ADA uang di sini: tidak ada Payment, invoice, pendapatan, jurnal, atau OrderItem (trigger DB menolak yang terakhir untuk order PKR).
import { PkrOrderError } from "./pkrGuard.js";
import { ACTIVE_JOB_STATUSES } from "./jobStatus.js";
import { createUnitsForOrder } from "./unitProvisioning.js";
import { tryProvisionUnitRoute } from "./productionRouting.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { bacaNotesOrder } from "../lib/domain/pkrSpesifikasi.js";
import {
  BENTUK, MAKS_ITEM, ItemPkrError, normalisasiItem, validasiHimpunan, kategoriOrderDariItems, perluDikirimDariItems, peringatanHimpunan, cerminanItem,
  deskripsiUnit, kelengkapanItems, kunciDuplikat, ukuranLabel, pilihanKirim,
} from "../lib/domain/pkrItem.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const gagal = (m, s = 400, c = null, e = null) => new PkrOrderError(m, s, c, e);
const STATUS_UNIT_BELUM_MULAI = ["AWAITING_PICKUP", "RECEIVED"];
const LABEL_KIRIM = (v) => (v === true ? "Dikirim" : v === false ? "Diambil sendiri" : "Belum ditentukan");
const TIDAK_DIBUAT = Object.freeze(["Pembayaran (Payment)", "Invoice", "Pendapatan / jurnal baru", "Item order bernilai (OrderItem)"]);

// ── KATALOG ────────────────────────────────────────────────────────────────────────────────────────────

/** Definisi bentuk untuk klien (field kontekstual per bentuk). Dibaca layar — tidak ada salinan di frontend. */
export function definisiBentuk() {
  return Object.fromEntries(Object.entries(BENTUK).map(([k, v]) => [k, {
    label: v.label, produk: v.produk, dimensi: v.dimensi, spesifikasi: v.spesifikasi,
  }]));
}

/** Katalog untuk form (hanya yang aktif) atau pengelolaan Admin (`semua: true` memuat nonaktif juga). */
export async function muatKatalogItem(db, { semua = false } = {}) {
  const kategori = await db.pkrItemCategory.findMany({
    where: semua ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { products: { where: semua ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { productionService: { select: { id: true, code: true, labelId: true } } } } },
  });
  return {
    bentuk: definisiBentuk(),
    kategori: kategori.map((c) => ({
      id: c.id, kode: c.code, nama: c.name, bentuk: c.shape, jenisKerja: c.workKind, aktif: c.active, urutan: c.sortOrder,
      produk: c.products.map((p) => ({ id: p.id, kode: p.code, nama: p.name, aktif: p.active, urutan: p.sortOrder, layananProduksi: p.productionService ? { id: p.productionService.id, kode: p.productionService.code, nama: p.productionService.labelId } : null })),
    })),
  };
}

// ── NORMALISASI MASUKAN ────────────────────────────────────────────────────────────────────────────────

/**
 * Masukan mentah [{ kategori (kode) | kategoriId, produkId?, produkNama?, jumlah, panjang, lebar, tebal, tinggi, spesifikasi, perluDikirim }] -> item ternormalisasi.
 * Kategori & produk dicari di katalog AKTIF (kategori/produk nonaktif tidak bisa dipakai untuk item baru). Melempar ItemPkrError (400) untuk masukan salah.
 */
export async function siapkanItems(db, raw, { izinNonaktif = false } = {}) {
  if (!Array.isArray(raw) || raw.length === 0) throw new ItemPkrError("Tambahkan minimal satu item produksi", "ITEM_KOSONG");
  if (raw.length > MAKS_ITEM) throw new ItemPkrError(`Maksimal ${MAKS_ITEM} item produksi per penjualan`, "ITEM_TERLALU_BANYAK");
  raw.forEach((r, i) => { if (!r || typeof r !== "object" || Array.isArray(r)) throw new ItemPkrError(`Item ${i + 1}: isian tidak valid`); });
  const kode = [...new Set(raw.map((r) => (typeof r.kategori === "string" ? r.kategori.trim() : "")).filter(Boolean))];
  const idKat = [...new Set(raw.map((r) => r.kategoriId).filter((v) => typeof v === "string" && UUID.test(v)))];
  const idProduk = [...new Set(raw.map((r) => r.produkId).filter((v) => v !== undefined && v !== null && v !== ""))];
  if (idProduk.some((v) => typeof v !== "string" || !UUID.test(v))) throw new ItemPkrError("Produk/varian tidak valid");
  const kategoriRows = kode.length || idKat.length ? await db.pkrItemCategory.findMany({ where: { OR: [{ code: { in: kode } }, { id: { in: idKat } }] } }) : [];
  const produkRows = idProduk.length ? await db.pkrItemProduct.findMany({ where: { id: { in: idProduk } } }) : [];
  const items = raw.map((r, idx) => {
    const no = idx + 1;
    const kategori = kategoriRows.find((c) => (r.kategori && c.code === String(r.kategori).trim()) || (r.kategoriId && c.id === r.kategoriId));
    if (!kategori) throw new ItemPkrError(`Item ${no}: pilih kategori item`, "KATEGORI_WAJIB");
    if (!kategori.active && !izinNonaktif) throw new ItemPkrError(`Item ${no}: kategori "${kategori.name}" sudah dinonaktifkan Admin`, "KATEGORI_NONAKTIF");
    let produk = null;
    if (r.produkId) {
      produk = produkRows.find((p) => p.id === r.produkId);
      if (!produk || produk.categoryId !== kategori.id) throw new ItemPkrError(`Item ${no}: produk tidak termasuk kategori "${kategori.name}"`, "PRODUK_TIDAK_SESUAI");
      if (!produk.active && !izinNonaktif) throw new ItemPkrError(`Item ${no}: produk "${produk.name}" sudah dinonaktifkan Admin`, "PRODUK_NONAKTIF");
    }
    return normalisasiItem(r, { kategori: { id: kategori.id, code: kategori.code, name: kategori.name, shape: kategori.shape, workKind: kategori.workKind }, produk: produk && { id: produk.id, name: produk.name, productionServiceId: produk.productionServiceId }, no });
  });
  validasiHimpunan(items);
  return items;
}

// ── PRATINJAU (tanpa menulis) ──────────────────────────────────────────────────────────────────────────

/** Rencana unit per item — fungsi yang SAMA dipakai pembuatan dan pratinjau. */
export function rencanaUnit(items) {
  let u = 0;
  return items.map((i) => {
    const d = deskripsiUnit(i);
    const nomor = Array.from({ length: i.jumlah }, () => `U${++u}`);
    return {
      no: i.no, jumlah: i.jumlah, nomorUnit: nomor, merk: d.merk, ukuran: d.ukuran,
      statusAwal: i.jenisKerja === "LAYANAN" ? "AWAITING_PICKUP" : "RECEIVED",
      statusAwalLabel: i.jenisKerja === "LAYANAN" ? "Menunggu pengambilan (job pickup dibuat)" : "Langsung di workshop (siap produksi)",
    };
  });
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
  const rencana = rencanaUnit(items);
  const kel = kelengkapanItems(items, { alamat });
  const dikirim = items.filter((i) => i.perluDikirim === true).map((i) => i.no);
  const diambil = items.filter((i) => i.perluDikirim === false).map((i) => i.no);
  const belum = items.filter((i) => i.perluDikirim === null).map((i) => i.no);
  const layanan = items.filter((i) => i.jenisKerja === "LAYANAN").map((i) => i.no);
  const totalUnit = items.reduce((a, i) => a + i.jumlah, 0);
  return {
    valid: true, sudahAdaOrder: sudahAda,
    order: { kategori: kategoriOrderDariItems(items), jumlahItem: items.length, jumlahUnit: totalUnit, nilai: 0, perluDikirim: perluDikirimDariItems(items) },
    items: items.map((i) => ({
      no: i.no, kategori: i.kategoriCode, kategoriNama: i.kategoriNama, bentuk: i.bentuk, jenisKerja: i.jenisKerja, produk: i.produkNama, jumlah: i.jumlah, ukuran: i.ukuranLabel || null,
      spesifikasi: i.spesifikasi, perluDikirim: i.perluDikirim, kirimLabel: LABEL_KIRIM(i.perluDikirim), kurang: i.kurang,
      layananProduksiOtomatis: !!i.productionServiceId, unit: rencana.find((r) => r.no === i.no),
    })),
    produksi: { lengkap: kel.lengkap, kurang: kel.kurang, status: kel.lengkap ? "Siap diproduksi" : "Perlu dilengkapi (Produksi belum bisa memulai)" },
    pickup: { adaJob: layanan.length > 0, itemNo: layanan },
    delivery: { adaJobPengiriman: dikirim.length > 0, itemDikirim: dikirim, itemDiambilSendiri: diambil, itemBelumDitentukan: belum, jobGanda: false,
      catatan: dikirim.length ? "Semua item yang dikirim diangkut dalam SATU job pengiriman per order (unit yang siap bergabung ke job yang sama)." : null },
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
 * Buat baris item + unit per item untuk order yang SUDAH dibuat (tanpa unit). Di dalam transaksi pemanggil; order sudah terkunci. Unit lahir lewat createUnitsForOrder:
 *   • item BARU    -> unit langsung RECEIVED (di workshop);
 *   • item LAYANAN -> unit AWAITING_PICKUP + job pickup (jalur baku ensurePickupJobForOrder).
 * Merk/ukuran unit = deskripsi item. Produk yang dipetakan Admin ke layanan produksi -> layanan + rute unit ditetapkan (satu-satunya pilihan; Produksi tidak memilih lagi).
 */
export async function lahirkanItemDanUnit(tx, { pkrId, orderId, items, userId = null }) {
  const idLayanan = [...new Set(items.map((i) => i.productionServiceId).filter(Boolean))];
  const layanan = new Map((idLayanan.length ? await tx.serviceCatalog.findMany({ where: { id: { in: idLayanan } } }) : []).map((s) => [s.id, s]));
  const hasil = [];
  for (const it of items) {
    const row = await tx.pkrOrderItem.create({
      data: {
        penjualanId: pkrId, orderId, seq: it.no, categoryId: it.kategoriId, productId: it.produkId, categoryCode: it.kategoriCode, categoryName: it.kategoriNama,
        shape: it.bentuk, workKind: it.jenisKerja, productName: it.produkNama, qty: it.jumlah,
        lengthCm: it.panjang, widthCm: it.lebar, thicknessCm: it.tebal, heightCm: it.tinggi, specNotes: it.spesifikasi, perluDikirim: it.perluDikirim,
      },
    });
    // Order dimuat ULANG tiap item: createUnitsForOrder membaca status/kategori order (D-051) dan item sebelumnya sudah memajukan statusnya.
    const order = await tx.order.findUnique({ where: { id: orderId } });
    const units = await createUnitsForOrder(tx, { order, count: it.jumlah, statusOverride: it.jenisKerja === "LAYANAN" ? "AWAITING_PICKUP" : "RECEIVED" });
    const d = deskripsiUnit(it);
    const ids = units.map((u) => u.id);
    await tx.unit.updateMany({ where: { id: { in: ids } }, data: { merk: d.merk, ukuran: d.ukuran } });
    const svc = it.productionServiceId ? layanan.get(it.productionServiceId) : null;
    if (svc) {
      await tx.unit.updateMany({ where: { id: { in: ids } }, data: { serviceId: svc.id, serviceLine: svc.serviceLine } });
      for (const id of ids) await tryProvisionUnitRoute(tx, id, svc.id, userId);
    }
    await tx.pkrOrderItemUnit.createMany({ data: ids.map((unitId) => ({ itemId: row.id, unitId })) });
    hasil.push({ no: it.no, itemId: row.id, unit: units.map((u) => u.unitCode) });
  }
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
  };
  item.ukuranLabel = ukuranLabel(item);
  return item;
}

// ── UBAH ITEM SETELAH ORDER ADA ────────────────────────────────────────────────────────────────────────

/**
 * Ubah spesifikasi/pilihan kirim per item (diidentifikasi `no`). Kategori & jumlah TERKUNCI (409) — menambah/mengurangi item atau unit bukan bagian alur ini.
 * Isian tidak dikirim = tidak berubah; "" / null = dikosongkan. Spesifikasi tidak bisa diubah setelah Produksi memulai unit item itu; pilihan kirim boleh kecuali
 * kirim -> ambil sendiri ketika unit item itu sudah masuk job pengiriman. Dipanggil di dalam transaksi pemanggil dengan order terkunci.
 * @returns {{ perubahan: object[], data: object, perluKirimBaru: boolean }}
 */
export async function ubahItemOrder(tx, { order, masukan }) {
  if (!Array.isArray(masukan) || masukan.length === 0) throw gagal("Daftar item yang diubah kosong");
  const rows = await tx.pkrOrderItem.findMany({
    where: { orderId: order.id }, orderBy: { seq: "asc" },
    include: { units: { include: { unit: { select: { id: true, status: true, currentStageId: true, merk: true, ukuran: true, jobUnits: { where: { job: { type: "DELIVERY", status: { in: ACTIVE_JOB_STATUSES } } }, select: { id: true } } } } } } },
  });
  const perubahan = [];
  let perluKirimBaru = false;
  const idProduk = [...new Set(masukan.map((m) => m?.produkId).filter(Boolean))];
  const produkRows = idProduk.length ? await tx.pkrItemProduct.findMany({ where: { id: { in: idProduk } } }) : [];
  for (const m of masukan) {
    if (!m || typeof m !== "object") throw gagal("Isian item tidak valid");
    const row = rows.find((r) => r.seq === Number(m.no));
    if (!row) throw gagal(`Item ${m.no ?? "?"} tidak ditemukan pada order ini`, 404);
    if (m.kategori !== undefined && m.kategori !== row.categoryCode) throw gagal(`Item ${row.seq}: kategori tidak bisa diubah setelah order dibuat`, 409, "ITEM_STRUKTUR_TERKUNCI");
    if (m.jumlah !== undefined && Number(m.jumlah) !== row.qty) throw gagal(`Item ${row.seq}: jumlah tidak bisa diubah setelah order dibuat — batalkan order lalu buat ulang bila memang berubah`, 409, "ITEM_STRUKTUR_TERKUNCI");

    const lama = itemDariRow(row);
    const mentah = { jumlah: lama.jumlah, panjang: lama.panjang, lebar: lama.lebar, tebal: lama.tebal, tinggi: lama.tinggi, spesifikasi: lama.spesifikasi, perluDikirim: lama.perluDikirim, produkNama: lama.produkNama, produkId: lama.produkId };
    for (const k of ["panjang", "lebar", "tebal", "tinggi", "spesifikasi", "produkNama", "perluDikirim", "produkId"]) if (k in m) mentah[k] = m[k];
    let produk = null;
    if (mentah.produkId) {
      const p = produkRows.find((x) => x.id === mentah.produkId) ?? (mentah.produkId === lama.produkId ? { id: row.productId, name: row.productName, productionServiceId: null, categoryId: row.categoryId, active: true } : null);
      if (!p || p.categoryId !== row.categoryId) throw gagal(`Item ${row.seq}: produk tidak termasuk kategori ${row.categoryName}`, 400, "PRODUK_TIDAK_SESUAI");
      if (!p.active && mentah.produkId !== lama.produkId) throw gagal(`Item ${row.seq}: produk "${p.name}" sudah dinonaktifkan Admin`, 400, "PRODUK_NONAKTIF");
      produk = { id: p.id, name: p.name, productionServiceId: p.productionServiceId ?? null };
    }
    const baru = normalisasiItem(mentah, { kategori: { id: row.categoryId, code: row.categoryCode, name: row.categoryName, shape: row.shape, workKind: row.workKind }, produk, no: row.seq });
    const produkIdBaru = produk ? produk.id : ("produkId" in m ? null : row.productId);

    const beda = {};
    const cek = (k, a, b) => { if ((a ?? null) !== (b ?? null)) beda[k] = { sebelum: a ?? null, sesudah: b ?? null }; };
    for (const k of ["panjang", "lebar", "tebal", "tinggi", "spesifikasi", "produkNama", "perluDikirim"]) cek(k, lama[k], baru[k]);
    if (Object.keys(beda).length === 0) continue;

    const unitAktif = row.units.map((x) => x.unit).filter((u) => u.status !== "CANCELLED");
    const sudahMulai = unitAktif.some((u) => u.currentStageId != null || !STATUS_UNIT_BELUM_MULAI.includes(u.status));
    const hanyaKirim = Object.keys(beda).every((k) => k === "perluDikirim");
    if (sudahMulai && !hanyaKirim) throw gagal(`Item ${row.seq}: Produksi sudah mulai mengerjakan unit — spesifikasi tidak bisa diubah`, 409, "ITEM_SUDAH_DIPRODUKSI");
    if (beda.perluDikirim && lama.perluDikirim === true && baru.perluDikirim !== true && unitAktif.some((u) => u.jobUnits.length > 0)) {
      throw gagal(`Item ${row.seq}: unit sudah masuk job pengiriman. Batalkan atau ubah lewat Delivery dulu sebelum menandai item ini diambil sendiri.`, 409, "ITEM_SUDAH_DI_JOB_KIRIM");
    }
    if (beda.perluDikirim && baru.perluDikirim === true) perluKirimBaru = true;

    await tx.pkrOrderItem.update({
      where: { id: row.id },
      data: {
        lengthCm: baru.panjang, widthCm: baru.lebar, thicknessCm: baru.tebal, heightCm: baru.tinggi, specNotes: baru.spesifikasi, perluDikirim: baru.perluDikirim,
        productId: produkIdBaru, productName: baru.produkNama,
      },
    });
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
  const sesudah = (await tx.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" } })).map(itemDariRow);
  const info = bacaNotesOrder(order.notes);
  const data = {};
  if (perubahan.length) {
    data.notes = JSON.stringify({ ...info, pkrItems: susunCerminan(sesudah) });
    data.pkrPerluDikirim = perluDikirimDariItems(sesudah);
  }
  return { perubahan, data, perluKirimBaru, itemsSesudah: sesudah };
}

// ── PENGELOLAAN KATALOG (Admin) ────────────────────────────────────────────────────────────────────────

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

export async function buatKategori(tx, { kode, nama, bentuk, jenisKerja, urutan: u, userId }) {
  const code = String(kode ?? "").trim().toUpperCase();
  if (!KODE_RE.test(code)) throw gagal("Kode kategori: huruf besar/angka/_ (2–60 karakter), mis. DIVAN_LACI");
  if (!BENTUK[bentuk]) throw gagal(`Bentuk isian harus salah satu dari: ${Object.keys(BENTUK).join(", ")}`);
  if (!["BARU", "LAYANAN"].includes(jenisKerja)) throw gagal("Jenis pekerjaan harus BARU atau LAYANAN");
  if (await tx.pkrItemCategory.findUnique({ where: { code }, select: { id: true } })) throw gagal(`Kode kategori ${code} sudah dipakai`, 409, "KODE_SUDAH_ADA");
  const c = await tx.pkrItemCategory.create({ data: { code, name: teksWajib(nama, 100, "Nama kategori"), shape: bentuk, workKind: jenisKerja, sortOrder: urutan(u) ?? 100 } });
  await audit(tx, { entityId: c.id, userId, aksi: "kategori_dibuat", metadata: { kode: code, nama: c.name, bentuk, jenisKerja } });
  return c;
}

export async function ubahKategori(tx, { id, nama, aktif, urutan: u, userId }) {
  if (!UUID.test(String(id))) throw gagal("Kategori tidak ditemukan", 404);
  const lama = await tx.pkrItemCategory.findUnique({ where: { id } });
  if (!lama) throw gagal("Kategori tidak ditemukan", 404);
  const data = {};
  if (nama !== undefined) data.name = teksWajib(nama, 100, "Nama kategori");
  if (aktif !== undefined) { if (typeof aktif !== "boolean") throw gagal("Status aktif tidak valid"); data.active = aktif; }
  const uu = urutan(u); if (uu !== undefined) data.sortOrder = uu;
  if (Object.keys(data).length === 0) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  const c = await tx.pkrItemCategory.update({ where: { id }, data });
  await audit(tx, { entityId: id, userId, aksi: "kategori_diubah", metadata: { kode: lama.code, sebelum: { nama: lama.name, aktif: lama.active, urutan: lama.sortOrder }, sesudah: { nama: c.name, aktif: c.active, urutan: c.sortOrder } } });
  return c;
}

export async function buatProduk(tx, { kategoriId, kode, nama, layananProduksiId = null, urutan: u, userId }) {
  if (!UUID.test(String(kategoriId))) throw gagal("Kategori tidak ditemukan", 404);
  const kat = await tx.pkrItemCategory.findUnique({ where: { id: kategoriId } });
  if (!kat) throw gagal("Kategori tidak ditemukan", 404);
  const code = String(kode ?? "").trim().toUpperCase();
  if (!KODE_RE.test(code)) throw gagal("Kode produk: huruf besar/angka/_ (2–60 karakter), mis. DIVAN_LACI_180");
  if (await tx.pkrItemProduct.findUnique({ where: { code }, select: { id: true } })) throw gagal(`Kode produk ${code} sudah dipakai`, 409, "KODE_SUDAH_ADA");
  if (layananProduksiId) await pastikanLayananAda(tx, layananProduksiId);
  const p = await tx.pkrItemProduct.create({ data: { categoryId: kat.id, code, name: teksWajib(nama, 160, "Nama produk"), productionServiceId: layananProduksiId || null, sortOrder: urutan(u) ?? 100 } });
  await audit(tx, { entityId: p.id, userId, aksi: "produk_dibuat", metadata: { kode: code, nama: p.name, kategori: kat.code, layananProduksiId: p.productionServiceId } });
  return p;
}

async function pastikanLayananAda(tx, id) {
  if (!UUID.test(String(id))) throw gagal("Layanan produksi tidak ditemukan", 404);
  const s = await tx.serviceCatalog.findUnique({ where: { id }, select: { id: true, active: true } });
  if (!s) throw gagal("Layanan produksi tidak ditemukan", 404);
  if (!s.active) throw gagal("Layanan produksi itu nonaktif", 409);
}

export async function ubahProduk(tx, { id, nama, aktif, urutan: u, layananProduksiId, userId }) {
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
  if (Object.keys(data).length === 0) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  const p = await tx.pkrItemProduct.update({ where: { id }, data });
  await audit(tx, { entityId: id, userId, aksi: "produk_diubah", metadata: { kode: lama.code, sebelum: { nama: lama.name, aktif: lama.active, layananProduksiId: lama.productionServiceId }, sesudah: { nama: p.name, aktif: p.active, layananProduksiId: p.productionServiceId } } });
  return p;
}
