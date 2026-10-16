// POSTING "TERAPKAN UANG MUKA SUPPLIER KE FAKTUR" (Okt 2026) — sisi faktur (FinSupplierBill) dari alur DP yang sudah ada (posting/purchaseAdvance.js menangani sisi pembelian mode UTANG).
//
// Urutan akuntansi uang muka supplier (satu akun aset: 1-1500 "Uang Muka Pembelian (DP)", tampil sebagai Uang Muka Supplier):
//   1. PO dibuat/disetujui ........ TIDAK ada jurnal, utang, atau stok.
//   2. Bayar uang muka ............ Dr Uang Muka Supplier 1-1500 / Cr Kas-Bank (+ Dr Beban Administrasi Bank bila ada biaya admin)  → posting/purchase.js (alur LANGSUNG yang sudah ada).
//   3. Barang tiba ................ hanya mencatat kedatangan; stok TIDAK bertambah.
//   4. Simpan ke Stok (putaway) ... Dr Persediaan / Cr GRNI (barang baik yang benar-benar disimpan).
//   5. Faktur disetujui ........... Dr GRNI ± Selisih Harga / Cr Utang Usaha.
//   6. Terapkan uang muka ......... Dr Utang Usaha / Cr Uang Muka Supplier  ← FILE INI (dikonfirmasi Finance; sebagian/beberapa kali boleh).
//   7. Pelunasan sisa ............. Dr Utang Usaha / Cr Kas-Bank (alur pembayaran supplier yang sudah ada).
// Pembayaran TIDAK PERNAH menambah stok.

import { postJournal, findEntryByKey, todayBookDateWIB } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../accounts.js";
import { toMoney } from "../money.js";

export const KEY = {
  // Dasar kunci = header Idempotency-Key request (BUKAN id baris aplikasi): jurnal harus punya kunci stabil SEBELUM baris dibuat, supaya dua request kembar menghasilkan SATU jurnal.
  terapkanKeFaktur: (idemKey) => `FAKTUR_TERAPKAN_UANG_MUKA:${idemKey}`,
};

/**
 * @param {object} opts
 * @param {string} opts.idemKey   header Idempotency-Key
 * @param {string} opts.sourceId  id baris FinSupplierBillAdvanceApplication
 * @param {{ id: string, purchaseNumber: string, supplierId: string }} opts.advance  DP sumber
 * @param {{ id: string, billNumber: string, supplierId: string }} opts.bill          faktur tujuan
 */
export async function postUangMukaDiterapkanKeFaktur(tx, { idemKey, sourceId, advance, bill, amount, userId = null, date = null }) {
  const journalKey = KEY.terapkanKeFaktur(idemKey);
  const sudahAda = await findEntryByKey(tx, journalKey);
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const utangUsaha = await resolveAccount(tx, SYSTEM_KEYS.UTANG_USAHA);
  const uangMuka = await resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_PEMBELIAN);
  const nominal = toMoney(amount);

  const { entry, created } = await postJournal(tx, {
    date: date || todayBookDateWIB(),
    description: `Terapkan uang muka ${advance.purchaseNumber} ke faktur ${bill.billNumber}`,
    source: "TERAPKAN_UANG_MUKA",
    sourceId,
    idempotencyKey: journalKey,
    userId,
    lines: [
      { accountId: utangUsaha.id, debit: nominal, description: `Utang faktur ${bill.billNumber} dikurangi uang muka ${advance.purchaseNumber}`, supplierId: bill.supplierId },
      { accountId: uangMuka.id, credit: nominal, description: `Uang muka ${advance.purchaseNumber} diterapkan ke faktur ${bill.billNumber}`, supplierId: advance.supplierId },
    ],
  });
  return { posted: true, entry, created };
}
