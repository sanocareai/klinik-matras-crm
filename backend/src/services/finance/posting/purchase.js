// POSTING PEMBELIAN — FinPurchase (bahan baku manual / aset tetap / aset
// tak berwujud / uang muka pembelian, TANPA tagihan resmi supplier).
//
// Struktur & alur jurnal SENGAJA identik dengan posting/expense.js
// (postExpenseApproved/postExpensePaid) — satu-satunya beda adalah akun
// debitnya bisa ASET (lihat FinPurchaseCategory), bukan cuma BEBAN. Kalau
// mengubah pola di sini, cek juga apakah expense.js perlu diubah senada,
// supaya dua modul yang secara struktur kembar ini tidak diam-diam drift.
//
// ── JURNAL PER MODE PEMBELIAN ─────────────────────────────────────────────
//   LANGSUNG       Dr akunKategori     Cr Kas/Bank
//   REIMBURSEMENT  Dr akunKategori     Cr Utang Reimbursement Karyawan
//                  (saat dibayar:)  Dr Utang Reimbursement   Cr Kas/Bank
//   UTANG          Dr akunKategori     Cr Utang Usaha
//                  (saat dibayar:)  Dr Utang Usaha           Cr Kas/Bank
//
// akunKategori == 1-1500 "Uang Muka Pembelian" untuk kategori
// UANG_MUKA_PEMBELIAN — jurnalnya jadi Dr ASET, bukan Dr BEBAN, TANPA logic
// khusus tambahan di sini: category.accountId sudah menunjuk ke akun yang
// benar. Penyelesaian saldo Uang Muka (saat barang/jasa akhirnya diterima)
// SENGAJA tidak diotomasi — dilakukan manual lewat Jurnal Umum (Dr akun
// tujuan sebenarnya / Cr Uang Muka Pembelian), lihat catatan di model
// FinPurchase (schema.prisma).
//
// ⚠️ BUKAN pengganti FinSupplierBill (Tagihan Supplier, Finance > Supplier
// & Utang) — itu tetap satu-satunya jalur pembelian BERTAGIHAN resmi.

import { postJournal, findEntryByKey } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS, AccountError } from "../accounts.js";
import { toMoney, sumMoney, ZERO } from "../money.js";

export const KEY = {
  // `suffix` (opsional) — dipakai SATU-SATUNYA oleh alur Koreksi, pola
  // persis KEY di posting/expense.js (lihat komentar di sana untuk alasan
  // lengkapnya: jurnal asli tetap key polos, jurnal pengganti butuh key baru).
  purchase: (id, suffix = "") => `PEMBELIAN:${id}${suffix}`,
  purchasePaid: (id, suffix = "") => `PEMBELIAN_DIBAYAR:${id}${suffix}`,
};

/**
 * Total DP AKTIF (status ACTIVE, belum dibatalkan) yang sudah diterapkan ke
 * SATU pembelian target. Diekspor supaya route /purchases/:id/pay bisa
 * memutuskan APAKAH rekening kas masih wajib diisi (tidak wajib kalau DP
 * sudah menutupi seluruh utangnya) TANPA menduplikasi query ini.
 */
export async function totalDpDiterapkan(tx, targetPurchaseId) {
  const aktif = await tx.finPurchaseAdvanceApplication.findMany({
    where: { targetPurchaseId, status: "ACTIVE" },
    select: { amount: true },
  });
  return aktif.length === 0 ? ZERO : sumMoney(aktif.map((a) => a.amount));
}

/**
 * Jurnal PENGAKUAN sebuah FinPurchase — dipanggil saat pembelian DISETUJUI,
 * bukan saat dibuat. Draft & pengajuan yang masih menunggu approval sengaja
 * tidak menyentuh buku besar sama sekali.
 */
export async function postPurchaseApproved(tx, { purchaseId, userId = null, keySuffix = "" }) {
  const p = await tx.finPurchase.findUnique({
    where: { id: purchaseId },
    include: {
      category: { select: { id: true, name: true, accountId: true } },
      cashAccount: { select: { id: true, name: true, accountId: true } },
      supplier: { select: { id: true, name: true } },
      reimburseTo: { select: { id: true, name: true } },
    },
  });
  if (!p) throw new Error(`Pembelian ${purchaseId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.purchase(purchaseId, keySuffix));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const amount = toMoney(p.amount);
  const akunKategori = p.category.accountId;

  let akunLawanId;
  let keteranganLawan;
  let cashAccountId = null;
  let supplierId = null;

  if (p.mode === "LANGSUNG") {
    if (!p.cashAccount) {
      throw new AccountError(
        "Pembelian mode LANGSUNG wajib memilih rekening kas/bank sumber dananya sebelum bisa disetujui",
        400
      );
    }
    akunLawanId = p.cashAccount.accountId;
    keteranganLawan = `Uang keluar — ${p.cashAccount.name}`;
    cashAccountId = p.cashAccount.id;
  } else if (p.mode === "REIMBURSEMENT") {
    const utangReimburse = await resolveAccount(tx, SYSTEM_KEYS.UTANG_REIMBURSEMENT);
    akunLawanId = utangReimburse.id;
    keteranganLawan = `Ditalangi ${p.reimburseTo?.name || "karyawan"} — belum diganti`;
  } else {
    const utangUsaha = await resolveAccount(tx, SYSTEM_KEYS.UTANG_USAHA);
    akunLawanId = utangUsaha.id;
    keteranganLawan = `Utang ke ${p.supplier?.name || p.payeeName || "pihak ketiga"}`;
    supplierId = p.supplierId;
  }

  const { entry, created } = await postJournal(tx, {
    date: p.date,
    description: `${p.purchaseNumber} — ${p.description}`,
    source: "PEMBELIAN",
    sourceId: purchaseId,
    idempotencyKey: KEY.purchase(purchaseId, keySuffix),
    userId,
    lines: [
      {
        accountId: akunKategori,
        debit: amount,
        description: `${p.category.name} (${p.division})`,
        supplierId,
      },
      {
        accountId: akunLawanId,
        credit: amount,
        description: keteranganLawan,
        cashAccountId,
        supplierId,
      },
    ],
  });
  return { posted: true, entry, created };
}

/**
 * Jurnal PELUNASAN pembelian mode REIMBURSEMENT/UTANG — saat uangnya benar-
 * benar keluar. Mode LANGSUNG tidak pernah melewati fungsi ini.
 *
 * ⚠️ Sejak "Terapkan Uang Muka" (D-XXX, 22 September 2026): untuk mode UTANG,
 * nominal yang benar-benar dibayar TUNAI adalah `amount - Σ DP aktif yang
 * sudah diterapkan` (lihat FinPurchaseAdvanceApplication), BUKAN `amount`
 * mentah — DP yang sudah diterapkan sudah mengurangi Utang Usaha lewat
 * jurnalnya sendiri (posting/purchaseAdvance.js), jadi membayar tunai
 * sejumlah `amount` penuh di sini akan MENGHITUNG DUA KALI pengurangan utang
 * yang sama. Kalau DP menutupi SELURUH utang (sisa <= 0), TIDAK ADA jurnal
 * kas yang perlu diposting sama sekali — dokumen tetap boleh pindah status
 * DIBAYAR (lihat route), tapi fungsi ini mengembalikan `posted:false`. Baris
 * lama (dibuat sebelum fitur ini ada, jadi totalDp selalu 0) TIDAK berubah
 * perilakunya sama sekali — `amount - 0 = amount`, persis seperti semula.
 */
export async function postPurchasePaid(tx, { purchaseId, userId = null, keySuffix = "" }) {
  const p = await tx.finPurchase.findUnique({
    where: { id: purchaseId },
    include: {
      cashAccount: { select: { id: true, name: true, accountId: true } },
      reimburseTo: { select: { name: true } },
      supplier: { select: { id: true, name: true } },
    },
  });
  if (!p) throw new Error(`Pembelian ${purchaseId} tidak ditemukan`);
  if (p.mode === "LANGSUNG") return { posted: false, reason: "mode_langsung" };

  const sudahAda = await findEntryByKey(tx, KEY.purchasePaid(purchaseId, keySuffix));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const totalDp = await totalDpDiterapkan(tx, purchaseId);
  const amount = toMoney(p.amount).minus(totalDp);

  if (amount.lessThanOrEqualTo(0)) {
    // Uang Muka sudah menutupi SELURUH utangnya — tidak ada kas yang keluar.
    return { posted: false, reason: "lunas_via_dp" };
  }

  if (!p.cashAccount) {
    throw new AccountError("Pilih rekening kas/bank sumber pembayaran sebelum menandai pembelian ini dibayar", 400);
  }

  const akunUtang = await resolveAccount(
    tx,
    p.mode === "REIMBURSEMENT" ? SYSTEM_KEYS.UTANG_REIMBURSEMENT : SYSTEM_KEYS.UTANG_USAHA
  );

  const { entry, created } = await postJournal(tx, {
    date: p.paidAt || p.date,
    description: `Pembayaran ${p.purchaseNumber} — ${p.description}`,
    source: "PEMBELIAN",
    sourceId: purchaseId,
    idempotencyKey: KEY.purchasePaid(purchaseId, keySuffix),
    userId,
    lines: [
      {
        accountId: akunUtang.id,
        debit: amount,
        description: p.mode === "REIMBURSEMENT"
          ? `Penggantian ke ${p.reimburseTo?.name || "karyawan"}`
          : `Pelunasan utang ke ${p.supplier?.name || p.payeeName || "pihak ketiga"}`,
        supplierId: p.supplierId,
      },
      {
        accountId: p.cashAccount.accountId,
        credit: amount,
        description: `Uang keluar — ${p.cashAccount.name}`,
        cashAccountId: p.cashAccount.id,
      },
    ],
  });
  return { posted: true, entry, created };
}
