// GUARD ANTI DOUBLE-COUNTING Pengajuan Biaya (C1).
//
// Pengajuan Biaya hanya untuk biaya operasional NON-STOK. Nilai barang yang masuk/keluar/berpindah/rusak/disesuaikan sudah
// dicatat oleh Inventory (stock ledger) dan Pembelian/Tagihan Supplier — mencatat dokumen yang sama lagi sebagai pengajuan biaya
// membuat beban terhitung dua kali. Guard ini berjalan di TIGA titik (buat, ubah draf, ajukan), jadi draf tidak bisa menyelundupkannya.
//
// Aturan:
//  1. Nomor dokumen PEMBELIAN / TAGIHAN SUPPLIER / TRANSFER KAS yang ADA di sistem, di kolom apa pun, ditolak. (Bukan biaya / sudah dijurnal di sana.)
//  2. Nomor dokumen INVENTORY (GR, MI, TRF-stok, DMG, ADJ, CC) yang ADA di sistem ditolak di teks bebas. Di kolom "nomor dokumen"
//     hanya boleh sebagai REFERENSI konteks untuk jenis biaya yang memang biaya pendamping dokumen itu (Kurir/logistik untuk GR/TRF-stok).
//  3. Nomor dokumen eksternal (mis. surat jalan vendor) yang sama tidak boleh dipakai dua pengajuan aktif.

import { SubmissionError } from "./errors.js";

const POLA = /\b(GR|MI|TRF|DMG|ADJ|CC|PUR|BILL|EXP|KSB|UMO)-\d{6,8}-\d{2,3}\b/gi;

// Jenis biaya yang boleh merujuk dokumen inventory sebagai konteks (biaya pendamping, nilainya BUKAN nilai barang).
const REFERENSI_INVENTORY_BOLEH = { KURIR_LOGISTIK: ["GR", "TRF"] };

const MODUL = {
  GR: { label: "Penerimaan Barang", ke: "Gudang › Penerimaan Barang" },
  MI: { label: "Pengeluaran Material", ke: "Gudang › Pengeluaran Material" },
  TRF: { label: "Transfer Stok", ke: "Gudang › Transfer Stok" },
  DMG: { label: "Barang Rusak", ke: "Gudang › Penyesuaian Stok" },
  ADJ: { label: "Penyesuaian Stok", ke: "Gudang › Penyesuaian Stok" },
  CC: { label: "Stock Opname", ke: "Gudang › Stock Opname" },
  PUR: { label: "Pembelian", ke: "Finance › Pembelian" },
  BILL: { label: "Tagihan Supplier", ke: "Finance › Supplier & Utang" },
  EXP: { label: "Pengeluaran", ke: "Finance › Pengeluaran (koreksi lewat Edit & Koreksi Aman)" },
  KSB: { label: "Kasbon", ke: "Finance › Kasbon" },
  UMO: { label: "Uang Muka Operasional", ke: "pilihan Sumber dana \"Uang muka operasional\" pada pengajuan (bukan sebagai nomor dokumen)" },
  TRFKAS: { label: "Transfer Kas", ke: "Finance › Kas & Bank" },
};

/** Kumpulkan semua nomor dokumen yang tampak di sekumpulan teks. */
export function ekstrakNomorDokumen(...teks) {
  const hasil = new Set();
  for (const t of teks.flat(Infinity)) {
    if (t === null || t === undefined) continue;
    const isi = typeof t === "object" ? JSON.stringify(t) : String(t);
    for (const m of isi.matchAll(POLA)) hasil.add(m[0].toUpperCase());
  }
  return [...hasil];
}

/** Cari dokumen yang PERSIS bernomor ini. Mengembalikan { kunci, nomor } atau null. */
async function cariDokumen(db, nomor) {
  const awalan = nomor.split("-")[0];
  const cek = async (kunci, fn) => ((await fn()) ? { kunci, nomor } : null);
  switch (awalan) {
    case "GR": return cek("GR", () => db.goodsReceipt.findFirst({ where: { receiptNumber: nomor }, select: { id: true } }));
    case "MI": return cek("MI", () => db.materialIssue.findFirst({ where: { issueNumber: nomor }, select: { id: true } }));
    case "DMG": return cek("DMG", () => db.damagedStockRecord.findFirst({ where: { recordNumber: nomor }, select: { id: true } }));
    case "ADJ": return cek("ADJ", () => db.stockAdjustmentRequest.findFirst({ where: { adjustmentNumber: nomor }, select: { id: true } }));
    case "CC": return cek("CC", () => db.stockCount.findFirst({ where: { countNumber: nomor }, select: { id: true } }));
    case "PUR": return cek("PUR", () => db.finPurchase.findFirst({ where: { purchaseNumber: nomor }, select: { id: true } }));
    case "BILL": return cek("BILL", () => db.finSupplierBill.findFirst({ where: { billNumber: nomor }, select: { id: true } }));
    case "EXP": return cek("EXP", () => db.finExpense.findFirst({ where: { expenseNumber: nomor }, select: { id: true } }));
    case "KSB": return cek("KSB", () => db.finKasbon.findFirst({ where: { kasbonNumber: nomor }, select: { id: true } }));
    case "UMO": return cek("UMO", () => db.finOperationalAdvance.findFirst({ where: { advanceNumber: nomor }, select: { id: true } }));
    case "TRF":
      return (await cek("TRF", () => db.stockTransfer.findFirst({ where: { transferNumber: nomor }, select: { id: true } })))
        || (await cek("TRFKAS", () => db.finCashTransfer.findFirst({ where: { transferNumber: nomor }, select: { id: true } })));
    default: return null;
  }
}

function tolak(dok) {
  const m = MODUL[dok.kunci];
  return new SubmissionError(
    `Dokumen ${dok.nomor} (${m.label}) sudah tercatat di modulnya. Nilainya tidak boleh dicatat lagi sebagai Pengajuan Biaya (akan terhitung dua kali) — gunakan ${m.ke}.`,
    409,
  );
}

/**
 * @param db            prisma / tx
 * @param opsi.expenseType  jenis biaya pengajuan
 * @param opsi.documentRef  isi kolom "nomor dokumen" (boleh kosong)
 * @param opsi.teks         teks bebas yang ikut diperiksa (keterangan, catatan, vendor, sourceNote, metadata)
 * @param opsi.excludeId    id pengajuan sendiri (saat ubah/ajukan)
 */
export async function pastikanBukanDokumenInventory(db, { expenseType, documentRef, teks = [], excludeId = null }) {
  const ref = documentRef?.trim() ? documentRef.trim().toUpperCase() : null;
  const nomorRef = ref ? ekstrakNomorDokumen(ref) : [];
  const nomorTeks = ekstrakNomorDokumen(teks).filter((n) => !nomorRef.includes(n));

  // Teks bebas: dokumen apa pun yang ada di sistem ditolak.
  for (const n of nomorTeks) {
    const dok = await cariDokumen(db, n);
    if (dok) throw tolak(dok);
  }
  // Kolom nomor dokumen: pembelian/tagihan/transfer kas ditolak; inventory hanya sebagai konteks untuk jenis tertentu.
  for (const n of nomorRef) {
    const dok = await cariDokumen(db, n);
    if (!dok) continue;
    const awalan = dok.kunci === "TRFKAS" ? "TRFKAS" : dok.kunci;
    const boleh = (REFERENSI_INVENTORY_BOLEH[expenseType] || []).includes(awalan);
    if (!boleh) throw tolak(dok);
  }
  // Dokumen eksternal yang sama tidak boleh dipakai dua pengajuan aktif.
  if (ref) {
    const dobel = await db.expenseSubmission.findFirst({
      where: { documentRef: { equals: ref, mode: "insensitive" }, status: { notIn: ["DIBATALKAN", "DITOLAK"] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { submissionNumber: true },
    });
    if (dobel) throw new SubmissionError(`Nomor dokumen ${ref} sudah dipakai pada pengajuan ${dobel.submissionNumber}. Satu dokumen tidak boleh dicatat dua kali.`, 409);
  }
}
