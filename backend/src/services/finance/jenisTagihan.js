// JENIS TAGIHAN SUPPLIER (B3.3) — menentukan akun debit saat tagihan DISETUJUI dan menjaga persediaan tidak terjurnal dua kali.
//
//   BAHAN_BAKU               + penerimaan barang : Dr Utang Barang Belum Ditagih 2-1150 (GRNI) ± Selisih Harga / Cr Utang Usaha
//                             tanpa penerimaan   : METODE PERIODIK (tanggal tagihan sebelum cutover, B3.5): Dr Beban Pokok Bahan Baku 5-1100 / Cr Utang Usaha;
//                                                  persediaan akhir lewat stok opname. Setelah cutover (PERPETUAL): DITOLAK — wajib menaut penerimaan.
//                             (Gudang menjurnal Dr Persediaan / Cr GRNI saat putaway — lihat posting/supplier.js.
//                              Karena itu tagihan yang menaut penerimaan TIDAK mendebet Persediaan lagi.)
//   JASA_OPERASIONAL         : Dr akun beban kategori biaya (tipe BEBAN) / Cr Utang Usaha
//   BIAYA_PRODUKSI_NON_STOK  : Dr akun beban pokok kategori biaya produksi (tipe BEBAN_POKOK, bukan bahan baku) / Cr Utang Usaha
//   MESIN_PERALATAN          : Dr aset tetap (kategori pembelian ASET_PERALATAN/ASET_KENDARAAN) / Cr Utang Usaha
//   UANG_MUKA_PEMBELIAN      : Dr Uang Muka Pembelian 1-1500 (kategori pembelian UANG_MUKA_PEMBELIAN) / Cr Utang Usaha
//
// Tagihan lama (bill_type NULL) tidak diubah otomatis. Yang BELUM disetujui wajib dipilihkan jenisnya dulu sebelum bisa disetujui.

import { findEntryByKey } from "./journal.js";
import { ambilKebijakanPersediaan, metodeUntukTanggal, METODE_PERSEDIAAN, pesanPerpetual } from "./inventoryMethod.js";

export class JenisTagihanError extends Error {
  constructor(message, statusCode = 422, code) { super(message); this.statusCode = statusCode; if (code) this.code = code; }
}

export const JENIS_TAGIHAN = Object.freeze({
  BAHAN_BAKU: "Bahan Baku / Stok",
  JASA_OPERASIONAL: "Jasa / Operasional",
  MESIN_PERALATAN: "Mesin / Peralatan",
  UANG_MUKA_PEMBELIAN: "Uang Muka Pembelian",
  BIAYA_PRODUKSI_NON_STOK: "Biaya Produksi Non-Stok",
});

const KATEGORI_PEMBELIAN = {
  MESIN_PERALATAN: ["ASET_PERALATAN", "ASET_KENDARAAN"],
  UANG_MUKA_PEMBELIAN: ["UANG_MUKA_PEMBELIAN"],
};
// Kategori biaya yang SEJATINYA bahan baku — tidak boleh dipakai jenis lain (itulah jalan salah catat ke beban).
const KATEGORI_BIAYA_BAHAN = ["BAHAN_BAKU_MANUAL"];
const KEY_GR = (id) => `PENERIMAAN_BAHAN:${id}`;
const STATUS_AKTIF = ["DRAFT", "MENUNGGU_APPROVAL", "DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];

const norm = (t) => String(t || "").trim().toLowerCase().replace(/\s+/g, " ");

/** Bahan baku TANPA penerimaan hanya sah pada metode PERIODIK (tanggal tagihan sebelum cutover). Selain itu ditolak. */
export async function pastikanPeriodikBerlaku(db, billDate) {
  const kebijakan = await ambilKebijakanPersediaan(db);
  if (metodeUntukTanggal(kebijakan, billDate) !== METODE_PERSEDIAAN.PERIODIK) {
    throw new JenisTagihanError(pesanPerpetual(kebijakan), 422, "BAHAN_BAKU_TANPA_PENERIMAAN_PERPETUAL");
  }
}

/**
 * Validasi isian & kembalikan kolom yang disimpan (billType, goodsReceiptId, expenseCategoryId, purchaseCategoryId).
 * Dipanggil saat BUAT dan UBAH (draf/menunggu). Tidak menulis apa pun.
 */
export async function siapkanJenisTagihan(db, { billType, goodsReceiptId, expenseCategoryId, purchaseCategoryId, billDate }) {
  if (!billType) throw new JenisTagihanError("Jenis tagihan wajib dipilih (Bahan Baku, Jasa/Operasional, Mesin/Peralatan, Uang Muka Pembelian, atau Biaya Produksi Non-Stok)");
  if (!JENIS_TAGIHAN[billType]) throw new JenisTagihanError(`Jenis tagihan "${billType}" tidak dikenal`, 400);

  if (billType === "BAHAN_BAKU") {
    if (expenseCategoryId || purchaseCategoryId) throw new JenisTagihanError("Tagihan bahan baku tidak memakai kategori biaya — nilainya masuk Persediaan Bahan Baku");
    if (goodsReceiptId) {
      const gr = await db.goodsReceipt.findUnique({ where: { id: goodsReceiptId }, select: { id: true } });
      if (!gr) throw new JenisTagihanError("Dokumen penerimaan barang tidak ditemukan", 404);
    }
    if (!goodsReceiptId && billDate) await pastikanPeriodikBerlaku(db, billDate);
    return { billType, goodsReceiptId: goodsReceiptId || null, expenseCategoryId: null, purchaseCategoryId: null };
  }

  if (goodsReceiptId) throw new JenisTagihanError("Hanya tagihan Bahan Baku yang boleh menaut penerimaan barang");

  if (billType === "MESIN_PERALATAN" || billType === "UANG_MUKA_PEMBELIAN") {
    if (expenseCategoryId) throw new JenisTagihanError(`${JENIS_TAGIHAN[billType]} dicatat sebagai aset, bukan kategori biaya — pilih jenis aset`);
    if (!purchaseCategoryId) throw new JenisTagihanError(billType === "MESIN_PERALATAN" ? "Pilih jenis aset (Peralatan & Mesin atau Kendaraan)" : "Kategori Uang Muka Pembelian wajib dipilih");
    const k = await db.finPurchaseCategory.findUnique({ where: { id: purchaseCategoryId }, select: { code: true, active: true } });
    if (!k || !k.active) throw new JenisTagihanError("Kategori aset tidak ditemukan atau nonaktif", 404);
    if (!KATEGORI_PEMBELIAN[billType].includes(k.code)) throw new JenisTagihanError(`Kategori itu tidak cocok untuk jenis ${JENIS_TAGIHAN[billType]}`);
    return { billType, goodsReceiptId: null, expenseCategoryId: null, purchaseCategoryId };
  }

  // JASA_OPERASIONAL & BIAYA_PRODUKSI_NON_STOK — kategori biaya
  if (purchaseCategoryId) throw new JenisTagihanError(`${JENIS_TAGIHAN[billType]} memakai kategori biaya, bukan kategori aset`);
  if (!expenseCategoryId) throw new JenisTagihanError("Kategori biaya wajib dipilih");
  const kat = await db.finExpenseCategory.findUnique({ where: { id: expenseCategoryId }, select: { code: true, active: true, account: { select: { type: true, code: true } } } });
  if (!kat || !kat.active) throw new JenisTagihanError("Kategori biaya tidak ditemukan atau nonaktif", 404);
  if (KATEGORI_BIAYA_BAHAN.includes(kat.code)) {
    throw new JenisTagihanError("Kategori ini untuk bahan baku — pilih jenis tagihan Bahan Baku / Stok supaya nilainya masuk Persediaan, bukan beban");
  }
  const tipeWajib = billType === "JASA_OPERASIONAL" ? "BEBAN" : "BEBAN_POKOK";
  if (kat.account?.type !== tipeWajib) {
    throw new JenisTagihanError(billType === "JASA_OPERASIONAL"
      ? "Kategori ini adalah biaya produksi — pilih jenis Biaya Produksi Non-Stok"
      : "Kategori ini bukan biaya produksi — pilih jenis Jasa / Operasional");
  }
  return { billType, goodsReceiptId: null, expenseCategoryId, purchaseCategoryId: null };
}

/**
 * Penjaga saat MENYETUJUI (jurnal akan lahir). Melempar 409/422 dengan penjelasan bila berisiko menjurnal persediaan dua kali.
 */
export async function pastikanAmanDisetujui(tx, bill) {
  if (!bill.billType) {
    throw new JenisTagihanError(
      "Tagihan ini belum punya Jenis Tagihan. Edit dan pilih jenisnya dulu (mis. Bahan Baku untuk kain/busa) supaya tidak salah tercatat sebagai beban.",
      422, "JENIS_TAGIHAN_WAJIB",
    );
  }
  await siapkanJenisTagihan(tx, bill); // aturan kategori tetap berlaku saat approve (kategori bisa dinonaktifkan sejak dibuat)

  // Nomor faktur supplier yang sama tidak boleh ditagihkan dua kali.
  if (bill.supplierRef?.trim()) {
    const dobel = await tx.finSupplierBill.findFirst({
      where: { id: { not: bill.id }, supplierId: bill.supplierId, supplierRef: { equals: bill.supplierRef.trim(), mode: "insensitive" }, status: { in: STATUS_AKTIF } },
      select: { billNumber: true },
    });
    if (dobel) throw new JenisTagihanError(`Faktur ${bill.supplierRef} dari supplier ini sudah tercatat di ${dobel.billNumber}`, 409, "FAKTUR_GANDA");
  }

  // Tagihan yang tampak mengulang tagihan lain yang SUDAH masuk buku besar (supplier & tanggal sama, uraian sama) tidak disetujui otomatis.
  const mirip = await cariTagihanMirip(tx, bill);
  if (mirip) {
    throw new JenisTagihanError(
      `Tagihan ini tampak mengulang ${mirip.billNumber} (supplier, tanggal, dan uraian sama) yang sudah masuk buku besar — menyetujuinya akan menggandakan utang dan biaya. ` +
      "Periksa faktur asli supplier. Bila memang duplikat, tolak/batalkan tagihan ini; bila pengiriman terpisah, isi Nomor Faktur Supplier yang berbeda.",
      409, "TAGIHAN_DIDUGA_DUPLIKAT",
    );
  }

  if (bill.billType !== "BAHAN_BAKU") return;

  if (bill.goodsReceiptId) {
    // Penerimaan harus SUDAH dibukukan ke Persediaan (Dr Persediaan / Cr GRNI); kalau belum, mendebet GRNI akan membuat saldo GRNI terbalik.
    const jurnalGr = await findEntryByKey(tx, KEY_GR(bill.goodsReceiptId));
    if (!jurnalGr || jurnalGr.status !== "POSTED") {
      throw new JenisTagihanError("Penerimaan barang ini belum dibukukan ke Persediaan. Lengkapi harga di Gudang dan posting ulang Penerimaan Barang (Finance › Data Belum Lengkap) sebelum menyetujui tagihan.", 409, "PENERIMAAN_BELUM_DIBUKUKAN");
    }
    const lain = await tx.finSupplierBill.findFirst({
      where: { id: { not: bill.id }, goodsReceiptId: bill.goodsReceiptId, status: { in: STATUS_AKTIF } },
      select: { billNumber: true },
    });
    if (lain) throw new JenisTagihanError(`Penerimaan barang ini sudah ditagih di ${lain.billNumber} — persediaan akan tercatat dua kali`, 409, "PENERIMAAN_SUDAH_DITAGIH");
    return;
  }

  // Bahan baku TANPA penerimaan: tolak bila supplier yang sama punya penerimaan barang yang sudah dibukukan tetapi belum ditagih —
  // barang itu sudah masuk Persediaan lewat Gudang, jadi tagihannya harus menaut penerimaan tersebut.
  const sup = await tx.finSupplier.findUnique({ where: { id: bill.supplierId }, select: { name: true, aliases: true } });
  const nama = [sup?.name, ...(sup?.aliases || [])].map(norm).filter(Boolean);
  if (nama.length === 0) return;
  const grs = await tx.goodsReceipt.findMany({ where: { finSupplierBills: { none: { status: { in: STATUS_AKTIF } } } }, select: { id: true, receiptNumber: true, supplier: true } });
  for (const gr of grs.filter((g) => nama.includes(norm(g.supplier)))) {
    const j = await findEntryByKey(tx, KEY_GR(gr.id));
    if (j && j.status === "POSTED") {
      throw new JenisTagihanError(`Ada penerimaan barang ${gr.receiptNumber} dari supplier ini yang sudah masuk Persediaan tetapi belum ditagih. Tautkan tagihan ke penerimaan itu supaya persediaan tidak tercatat dua kali.`, 409, "ADA_PENERIMAAN_BELUM_DITAGIH");
    }
  }
}

const STATUS_MASUK_BUKU = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];

/**
 * Tagihan lain (sudah masuk buku besar) dari supplier & tanggal tagihan yang sama dengan uraian yang sama/berisi satu sama lain.
 * Bila kedua tagihan punya nomor faktur yang BERBEDA dianggap pengiriman terpisah (bukan duplikat).
 */
export async function cariTagihanMirip(tx, bill) {
  const uraian = norm(bill.description);
  if (uraian.length < 8 || !bill.billDate) return null;
  const hari = new Date(bill.billDate);
  const awal = new Date(Date.UTC(hari.getUTCFullYear(), hari.getUTCMonth(), hari.getUTCDate()));
  const akhir = new Date(awal.getTime() + 86400000);
  const kandidat = await tx.finSupplierBill.findMany({
    where: { id: { not: bill.id }, supplierId: bill.supplierId, status: { in: STATUS_MASUK_BUKU }, billDate: { gte: awal, lt: akhir } },
    select: { billNumber: true, description: true, supplierRef: true },
  });
  const refIni = norm(bill.supplierRef);
  for (const k of kandidat) {
    const u = norm(k.description);
    if (u.length < 8 || !(u.includes(uraian) || uraian.includes(u))) continue;
    const refLain = norm(k.supplierRef);
    if (refIni && refLain && refIni !== refLain) continue;
    return k;
  }
  return null;
}

/** Jenis turunan untuk tagihan lama (hanya tampilan; data tidak diubah). */
export function jenisTampilan(bill) {
  if (bill.billType) return { kode: bill.billType, label: JENIS_TAGIHAN[bill.billType], lama: false };
  return { kode: null, label: bill.goodsReceiptId ? "Bahan Baku (lama)" : "Belum dipilih (tagihan lama)", lama: true };
}
