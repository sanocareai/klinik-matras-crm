// ITEM PENJUALAN & PEMENUHAN TERPADU — satu daftar item untuk Finance (harga/total/jurnal) DAN operasional (Order CRM, Produksi, Delivery/Pickup).
//
// Masukan satu baris: { pemenuhan, kategori|kategoriId, produkId, produkNama, jumlah, harga, panjang, lebar, tebal, tinggi, spesifikasi, perluDikirim, komponen? }
// (item tanpa unit — Ambil dari Stok / Tanpa Operasional — memakai `nama` sebagai nama item dan boleh tanpa kategori).
//
// siapkanTerpadu() menghasilkan, dari BARIS YANG SAMA:
//   • baris Finance      : nama, jumlah, harga satuan, subtotal + kolom kanonis (kategori/produk/pemenuhan/ukuran/spesifikasi/kirim) -> fin_penjualan_karyawan_items,
//   • item operasional   : keluaran siapkanItems (rute Produksi dihitung per item; Set Kasur Lengkap dipecah menjadi komponen) dengan saleItemId = id baris Finance,
//   • item tanpa unit    : daftar nama/jumlah (tanpa harga) untuk catatan order.
// Harga TIDAK PERNAH ikut ke sisi operasional: keluaran operasional (opItems, nonProduksi) tidak memuat harga/subtotal/total sama sekali.
import { randomUUID } from "node:crypto";
import { hitungItems } from "./finance/penjualanKaryawanManual.js";
import { siapkanItems, bangunPratinjau } from "./penjualanKaryawanItem.js";
import { BENTUK, ItemPkrError, kurangItem, angkaCm, pilihanKirim, validasiHimpunan as validasiHimpunanItem } from "../lib/domain/pkrItem.js";
import { PenjualanItemError, PEMENUHAN, punyaUnit, periksaPemenuhan, namaItem, NAMA_ITEM_MAKS } from "../lib/domain/pkrPenjualanItem.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAKS_BARIS = 50;
const gagal = (m, c, e) => new PenjualanItemError(m, c, e);
const errHarga = (m) => new PenjualanItemError(m, "HARGA_JUMLAH_TIDAK_VALID");

const teksOpsional = (v, maks, nama) => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`);
  return t;
};

/**
 * Normalisasi + validasi seluruh daftar. Tidak menulis apa pun (aman untuk pratinjau). Melempar PenjualanItemError / ItemPkrError.
 * @param {*} db  klien Prisma atau tx
 * @param {object[]} raw
 * @param {{ noAwalOperasional?: number, bundelAwal?: number, nomorBarisAwal?: number, validasiHimpunan?: boolean, izinNonaktif?: boolean }} [opsi]
 */
export async function siapkanTerpadu(db, raw, { noAwalOperasional = 1, bundelAwal = 0, nomorBarisAwal = 1, validasiHimpunan = true, izinNonaktif = false } = {}) {
  if (!Array.isArray(raw) || raw.length === 0) throw gagal("Tambahkan minimal satu item penjualan", "ITEM_KOSONG");
  if (raw.length > MAKS_BARIS) throw gagal(`Terlalu banyak item (maksimal ${MAKS_BARIS})`, "ITEM_TERLALU_BANYAK");
  raw.forEach((r, i) => { if (!r || typeof r !== "object" || Array.isArray(r)) throw gagal(`Item ${nomorBarisAwal + i}: isian tidak valid`); });

  // Satu id per baris dibuat DI SINI: sama dipakai baris Finance dan tautan item operasional (tidak ada pencocokan berdasarkan urutan/teks).
  const lines = raw.map((r, i) => ({ r, no: nomorBarisAwal + i, id: r.id && UUID.test(String(r.id)) ? String(r.id) : randomUUID() }));
  for (const l of lines) {
    if (l.r.orderCrm !== undefined) throw gagal(`Item ${l.no}: isian "orderCrm" per item tidak dipakai — satu daftar item sudah mencakup penjualan dan pemenuhan`, "INPUT_GANDA");
    periksaPemenuhan({ no: l.no, pemenuhan: l.r.pemenuhan, jenisKerja: null, adaKategori: Boolean(l.r.kategori || l.r.kategoriId) });
    l.p = PEMENUHAN[l.r.pemenuhan];
  }

  // 1. Baris yang melahirkan unit -> masukan operasional (rute, bundel, kelengkapan dihitung siapkanItems yang sudah ada).
  const opLines = lines.filter((l) => l.p.unit);
  const opRaw = opLines.map((l) => ({
    saleItemId: l.id, pemenuhan: l.p.kode,
    kategori: l.r.kategori, kategoriId: l.r.kategoriId, produkId: l.r.produkId, produkNama: l.r.produkNama ?? l.r.nama,
    jumlah: l.r.jumlah, panjang: l.r.panjang, lebar: l.r.lebar, tebal: l.r.tebal, tinggi: l.r.tinggi, spesifikasi: l.r.spesifikasi, perluDikirim: l.r.perluDikirim, komponen: l.r.komponen,
  }));
  let opItems = [];
  if (opRaw.length) {
    try {
      opItems = await siapkanItems(db, opRaw, { noAwal: noAwalOperasional, bundelAwal, validasi: false, izinNonaktif });
    } catch (e) {
      // siapkanItems memberi nomor "Item k" menurut urutan item operasional; terjemahkan ke nomor BARIS penjualan supaya pesannya menunjuk baris yang dilihat pengguna.
      if (e instanceof ItemPkrError && opLines.length !== lines.length) e.message = e.message.replace(/^Item (\d+)/, (_, n) => `Item ${opLines[Math.min(Number(n) - noAwalOperasional, opLines.length - 1)]?.no ?? n}`);
      throw e;
    }
  }

  // 2. Per baris Finance: nama (selalu dari sumber yang sama dengan item operasionalnya), kategori/produk snapshot, kolom kanonis.
  const katIds = new Set();
  for (const it of opItems) if (it.bundleKategoriId) katIds.add(it.bundleKategoriId);
  const katBundel = katIds.size ? new Map((await db.pkrItemCategory.findMany({ where: { id: { in: [...katIds] } } })).map((k) => [k.id, k])) : new Map();

  const baris = []; const nonProduksi = [];
  for (const l of lines) {
    const kolom = { id: l.id, no: l.no, pemenuhan: l.p.kode };
    if (l.p.unit) {
      const items = opItems.filter((i) => i.saleItemId === l.id);
      const kepala = items[0];
      periksaItemPemenuhan(l, items);
      if (kepala.bundleNo != null) {
        const kat = katBundel.get(kepala.bundleKategoriId);
        const nama = String(kepala.bundleName ?? kat?.name ?? "").trim().slice(0, NAMA_ITEM_MAKS);
        if (!nama) throw gagal(`Item ${l.no}: nama set tidak ditemukan`, "NAMA_ITEM_WAJIB");
        Object.assign(kolom, {
          name: nama, categoryId: kat?.id ?? kepala.bundleKategoriId, categoryCode: kepala.bundleCategoryCode, categoryName: kat?.name ?? nama, productId: kepala.bundleProdukId ?? null,
          perluDikirim: pilihanKirimAman(l.r.perluDikirim, l.no), lengthCm: null, widthCm: null, thicknessCm: null, heightCm: null, specNotes: teksOpsional(l.r.spesifikasi, 1000, "Spesifikasi"),
        });
      } else {
        const kategoriBentuk = BENTUK[kepala.bentuk];
        const nama = namaItem({ produkNama: kepala.produkNama, kategoriNama: kepala.kategoriNama, produkWajib: Boolean(kategoriBentuk?.produk.wajib) });
        if (!nama) throw gagal(`Item ${l.no}: ${kategoriBentuk?.produk.label ?? "nama produk"} wajib diisi — jadi nama item di tagihan`, "NAMA_ITEM_WAJIB");
        // Nama item operasional = nama baris penjualan (dijaga trigger DB): samakan, lalu hitung ulang kelengkapan.
        kepala.produkNama = nama; kepala.kurang = kurangItem(kepala);
        Object.assign(kolom, {
          name: nama, categoryId: kepala.kategoriId, categoryCode: kepala.kategoriCode, categoryName: kepala.kategoriNama, productId: kepala.produkId ?? null,
          perluDikirim: kepala.perluDikirim ?? null, lengthCm: kepala.panjang ?? null, widthCm: kepala.lebar ?? null, thicknessCm: kepala.tebal ?? null, heightCm: kepala.tinggi ?? null,
          specNotes: kepala.spesifikasi ?? null,
        });
      }
      kolom.jumlah = l.r.jumlah;
    } else {
      // Tanpa unit: nama wajib; kategori opsional (bila diisi harus ada di katalog). Tidak ada dimensi; "dikirim" tidak berlaku (tidak ada unit).
      const nama = teksOpsional(l.r.nama ?? l.r.produkNama, NAMA_ITEM_MAKS, "Nama item");
      if (!nama || nama.length < 2) throw gagal(`Item ${l.no}: nama item wajib diisi`, "NAMA_ITEM_WAJIB");
      if (pilihanKirim(l.r.perluDikirim) === true) throw gagal(`Item ${l.no}: ${l.p.label} tidak punya unit untuk dikirim — pilih "Produksi Baru" bila barang harus dibuat dan dikirim`, "KIRIM_TANPA_UNIT");
      for (const d of ["panjang", "lebar", "tebal", "tinggi"]) if (l.r[d] !== undefined && l.r[d] !== null && l.r[d] !== "") angkaCm(l.r[d], d);
      let kat = null;
      if (l.r.kategori || l.r.kategoriId) {
        kat = await db.pkrItemCategory.findFirst({ where: { OR: [...(l.r.kategori ? [{ code: String(l.r.kategori) }] : []), ...(l.r.kategoriId && UUID.test(String(l.r.kategoriId)) ? [{ id: String(l.r.kategoriId) }] : [])] } });
        if (!kat) throw gagal(`Item ${l.no}: kategori tidak dikenal`, "KATEGORI_TIDAK_DIKENAL");
        if (!kat.active && !izinNonaktif) throw gagal(`Item ${l.no}: kategori "${kat.name}" sudah dinonaktifkan Admin`, "KATEGORI_NONAKTIF");
      }
      Object.assign(kolom, {
        name: nama, categoryId: kat?.id ?? null, categoryCode: kat?.code ?? null, categoryName: kat?.name ?? null, productId: null, perluDikirim: null,
        lengthCm: null, widthCm: null, thicknessCm: null, heightCm: null, specNotes: teksOpsional(l.r.spesifikasi, 1000, "Spesifikasi"),
      });
      kolom.jumlah = l.r.jumlah;
    }
    baris.push({ ...kolom, harga: l.r.harga });
  }

  // 3. Angka uang: SATU aturan (Decimal, HALF_UP per baris) — sama dengan jalur lama. Operasional tidak menerima angka ini.
  const hitung = hitungItems(baris.map((b) => ({ name: b.name, quantity: b.jumlah, unitPrice: b.harga })), errHarga);
  const final = baris.map((b, i) => {
    const h = hitung.items[i];
    if (b.pemenuhan && punyaUnit(b.pemenuhan) && !h.quantity.isInteger()) throw gagal(`Item ${b.no}: jumlah untuk ${PEMENUHAN[b.pemenuhan].label} harus bilangan bulat`, "JUMLAH_HARUS_BULAT");
    const { jumlah, harga, ...selain } = b;
    return { ...selain, quantity: h.quantity, unitPrice: h.unitPrice, subtotal: h.subtotal, sortOrder: i + (nomorBarisAwal - 1) };
  });
  for (const b of final) if (!punyaUnit(b.pemenuhan)) nonProduksi.push({ no: b.no, nama: b.name, jumlah: Number(b.quantity), pemenuhan: b.pemenuhan, kategori: b.categoryName ?? null });

  if (validasiHimpunan && opItems.length) validasiHimpunanItem(opItems);
  return { baris: final, total: hitung.total, opItems, nonProduksi };
}

function pilihanKirimAman(v, no) {
  try { return pilihanKirim(v); } catch (e) { if (e instanceof ItemPkrError) throw gagal(`Item ${no}: ${e.message}`, e.code); throw e; }
}

/** Pemenuhan harus cocok dengan jenis kerja SEMUA komponen hasil katalog (Set: semua komponen sejenis). */
function periksaItemPemenuhan(l, items) {
  for (const it of items) periksaPemenuhan({ no: l.no, pemenuhan: l.p.kode, jenisKerja: it.jenisKerja, kategoriNama: it.bundleName ?? it.kategoriNama, adaKategori: true });
}

/** Tulis baris Finance (dengan id yang sudah ditentukan) di dalam transaksi pemanggil. Kolom uang dan kolom kanonis dalam satu penulisan. */
export async function tulisBarisPenjualan(tx, penjualanId, baris) {
  for (const b of baris) {
    await tx.finPenjualanKaryawanItem.create({ data: dataBaris(penjualanId, b) });
  }
}

export function dataBaris(penjualanId, b) {
  return {
    id: b.id, penjualanId, name: b.name, quantity: b.quantity, unitPrice: b.unitPrice, sortOrder: b.sortOrder,
    categoryId: b.categoryId ?? null, productId: b.productId ?? null, categoryCode: b.categoryCode ?? null, categoryName: b.categoryName ?? null, fulfillment: b.pemenuhan,
    perluDikirim: b.perluDikirim ?? null, lengthCm: b.lengthCm ?? null, widthCm: b.widthCm ?? null, thicknessCm: b.thicknessCm ?? null, heightCm: b.heightCm ?? null, specNotes: b.specNotes ?? null,
  };
}

// ── PRATINJAU (tanpa menulis) ───────────────────────────────────────────────────────────────────────

/**
 * Pratinjau daftar item terpadu: apa yang akan dicatat Finance (total, tanpa jurnal di sini), apa yang dibuat operasional (unit, pickup, pengiriman), dan apa yang TIDAK dibuat.
 * Hanya MEMBACA. Masukan salah dikembalikan sebagai { valid:false, galat } supaya layar menampilkannya. Endpoint ini dijaga izin Finance — bagian `keuangan` memuat harga.
 */
export async function pratinjauTerpadu(db, { penjualanId = null, items: raw, alamat = null } = {}) {
  let sudahAda = null;
  if (penjualanId) {
    const pkr = await db.finPenjualanKaryawan.findUnique({ where: { id: penjualanId }, select: { id: true, nomor: true, status: true, orderCrm: { select: { id: true, orderNumber: true } } } });
    if (!pkr) return { valid: false, galat: { pesan: "Penjualan karyawan tidak ditemukan", kode: "PKR_TIDAK_ADA" } };
    if (pkr.status !== "AKTIF") return { valid: false, galat: { pesan: `${pkr.nomor} sudah dibatalkan`, kode: "PKR_DIBATALKAN" } };
    if (pkr.orderCrm) sudahAda = { orderId: pkr.orderCrm.id, nomor: pkr.orderCrm.orderNumber };
  }
  let s;
  try { s = await siapkanTerpadu(db, raw); } catch (e) {
    if (e instanceof PenjualanItemError || e instanceof ItemPkrError) return { valid: false, galat: { pesan: e.message, kode: e.code, ...(e.extra ?? {}) } };
    throw e;
  }
  const dasar = s.opItems.length ? bangunPratinjau(s.opItems, { alamat, sudahAda }) : null;
  return {
    valid: true, sudahAdaOrder: sudahAda,
    keuangan: {
      total: Number(s.total), jumlahBaris: s.baris.length, nilaiOrderCrm: 0,
      baris: s.baris.map((b) => ({ no: b.no, nama: b.name, jumlah: Number(b.quantity), harga: Number(b.unitPrice), subtotal: Number(b.subtotal), pemenuhan: b.pemenuhan })),
      catatan: "Total, piutang, dan jurnal dicatat di Penjualan Karyawan. Order CRM tidak membawa uang (nilai Rp0, tanpa pembayaran/invoice/pendapatan/jurnal).",
    },
    adaOrder: s.opItems.length > 0 || Boolean(sudahAda),
    order: dasar?.order ?? null, items: dasar?.items ?? [], produksi: dasar?.produksi ?? null, pickup: dasar?.pickup ?? null, delivery: dasar?.delivery ?? null,
    peringatan: dasar?.peringatan ?? [], tidakDibuat: dasar?.tidakDibuat ?? [],
    nonProduksi: s.nonProduksi,
    pemenuhanBaris: s.baris.map((b) => ({ no: b.no, pemenuhan: b.pemenuhan, label: PEMENUHAN[b.pemenuhan].label, unit: punyaUnit(b.pemenuhan) })),
    tanpaOrder: s.opItems.length === 0 ? "Tidak ada item yang memerlukan Produksi/Pickup — Order CRM tidak dibuat; penjualan hanya tercatat di Finance." : null,
  };
}
