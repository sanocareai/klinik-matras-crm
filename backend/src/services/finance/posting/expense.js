// POSTING PENGELUARAN — FinExpense (input finance/divisi) + DUA sumber yang
// SUDAH ADA di sistem dan TIDAK dipindahkan ke sini: VehicleExpense
// (Armada > Biaya, D-035) dan AdSpend (belanja iklan bulanan).
//
// ⚠️ KENAPA DUA SUMBER LAMA TIDAK DISALIN JADI FinExpense. Aturan 1 di
// kepala blok finance (schema.prisma): tidak ada sumber data tandingan.
// Dispatcher & admin iklan sudah menginput di tempatnya masing-masing dan
// merekalah yang paling tahu angkanya. Menyuruh finance mengetik ulang akan
// menghasilkan dua angka untuk satu pengeluaran yang sama, dan yang kedua
// PASTI akan tertinggal. Jadi yang dilakukan di sini cuma MEMBACA baris
// mereka dan menurunkan jurnalnya — idempoten, jadi aman dijalankan ulang
// kapan pun (mis. setelah bagan akun diperbaiki).
//
// ── JURNAL PER MODE PENGELUARAN ──────────────────────────────────────────
//   LANGSUNG       Dr Beban X          Cr Kas/Bank
//   REIMBURSEMENT  Dr Beban X          Cr Utang Reimbursement Karyawan
//                  (saat dibayar:)  Dr Utang Reimbursement   Cr Kas/Bank
//   UTANG          Dr Beban X          Cr Utang Usaha
//                  (saat dibayar:)  Dr Utang Usaha           Cr Kas/Bank
//
// Pemisahan "beban diakui" dan "uang keluar" itu bukan formalitas: beban
// yang ditalangi karyawan bulan ini TETAP beban bulan ini walau baru
// diganti bulan depan. Kalau digabung jadi satu jurnal saat pembayaran,
// laba rugi bulan berjalan akan selalu terlihat lebih bagus dari kenyataan.

import { postJournal, recordPostingGap, findEntryByKey } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS, AccountError } from "../accounts.js";
import { toMoney } from "../money.js";
import { barisBiayaAdmin } from "../transferFee.js";

// Cutover Pengajuan Biaya Lintas Divisi (D-181, 24 September 2026) — rapat
// ulang arsitektur pilot Delivery: VehicleExpense/VehicleService BERHENTI
// jadi jalur posting mandiri untuk baris BARU mulai tanggal ini. Baris yang
// SUDAH ADA sebelum cutover (dan baris manapun yang ditaut ke ExpenseSubmission
// — lihat guard `expenseSubmission` di postVehicleExpense) tetap bisa
// diposting lewat Sync/gap-resolution SEPERTI SEBELUMNYA, tidak ada
// regresi/backfill data lama. Baris BARU tanpa tautan harus lewat
// ExpenseSubmission (satu-satunya sumber transaksi Finance baru) — VehicleExpense/
// VehicleService jadi murni konteks operasional (odometer/liter/bengkel),
// TIDAK PERNAH membuat jurnal paralel lagi.
const CUTOVER_PENGAJUAN_BIAYA = new Date("2026-09-24T00:00:00+07:00");

export const KEY = {
  // `suffix` (opsional) — dipakai SATU-SATUNYA oleh alur Koreksi
  // (routes/financeTransactions.js, POST /expenses/:id/koreksi). Jurnal
  // asli TETAP idempotencyKey polos (kompatibel dengan seluruh data yang
  // sudah terposting); setelah dikoreksi, jurnal PENGGANTI butuh key BARU
  // supaya tidak bentrok UNIQUE constraint dengan jurnal lama yang sudah
  // REVERSED (findEntryByKey tidak peduli status — lihat komentar panjang
  // di POST /expenses/:id/koreksi).
  expense: (id, suffix = "") => `PENGELUARAN:${id}${suffix}`,
  expensePaid: (id, suffix = "") => `PENGELUARAN_DIBAYAR:${id}${suffix}`,
  vehicleExpense: (id) => `BIAYA_KENDARAAN:${id}`,
  vehicleService: (id) => `BIAYA_SERVIS_KENDARAAN:${id}`,
  adSpend: (id) => `BIAYA_IKLAN:${id}`,
};

/**
 * Jurnal PENGAKUAN BEBAN sebuah FinExpense — dipanggil saat pengeluaran
 * DISETUJUI, bukan saat dibuat. Draft & pengajuan yang masih menunggu
 * approval sengaja tidak menyentuh buku besar sama sekali: pengajuan yang
 * belum tentu disetujui bukan beban.
 */
export async function postExpenseApproved(tx, { expenseId, userId = null, keySuffix = "" }) {
  const e = await tx.finExpense.findUnique({
    where: { id: expenseId },
    include: {
      category: { select: { id: true, name: true, accountId: true } },
      cashAccount: { select: { id: true, name: true, accountId: true } },
      supplier: { select: { id: true, name: true } },
      reimburseTo: { select: { id: true, name: true } },
      advance: { select: { advanceNumber: true } },
    },
  });
  if (!e) throw new Error(`Pengeluaran ${expenseId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.expense(expenseId, keySuffix));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const amount = toMoney(e.amount);
  const akunBeban = e.category.accountId;

  let akunLawanId;
  let keteranganLawan;
  let cashAccountId = null;
  let supplierId = null;
  // Biaya admin transfer HANYA relevan saat uang benar-benar keluar di jurnal
  // ini (LANGSUNG). Mode lain membayar belakangan di postExpensePaid.
  let biayaAdmin = toMoney(0);
  let barisAdmin = [];
  // Mode UANG_MUKA: lawan beban terbagi — sebagian Cr Uang Muka Operasional (saldo yang dipakai),
  // selisih Cr Utang Reimbursement ke pemegang. TIDAK ada baris kas sama sekali.
  let lawanBanyak = null;

  if (e.mode === "LANGSUNG") {
    if (!e.cashAccount) {
      throw new AccountError(
        "Pengeluaran mode LANGSUNG wajib memilih rekening kas/bank sumber dananya sebelum bisa disetujui",
        400
      );
    }
    akunLawanId = e.cashAccount.accountId;
    keteranganLawan = `Uang keluar — ${e.cashAccount.name}`;
    cashAccountId = e.cashAccount.id;
    biayaAdmin = toMoney(e.transferFeeAmount || 0);
    barisAdmin = await barisBiayaAdmin(tx, { fee: biayaAdmin, cashAccount: e.cashAccount });
  } else if (e.mode === "UANG_MUKA") {
    const um = await resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_OPERASIONAL);
    const dipakai = toMoney(e.advanceAppliedAmount || 0);
    const selisih = amount.minus(dipakai);
    lawanBanyak = [];
    if (dipakai.greaterThan(0)) {
      lawanBanyak.push({
        accountId: um.id, credit: dipakai, orderId: e.orderId,
        description: `Dipertanggungjawabkan dari uang muka ${e.advance?.advanceNumber || ""}`.trim(),
      });
    }
    if (selisih.greaterThan(0)) {
      const utangReimburse = await resolveAccount(tx, SYSTEM_KEYS.UTANG_REIMBURSEMENT);
      lawanBanyak.push({
        accountId: utangReimburse.id, credit: selisih, orderId: e.orderId,
        description: `Melebihi saldo uang muka — utang ke ${e.reimburseTo?.name || "pemegang"}`,
      });
    }
  } else if (e.mode === "REIMBURSEMENT") {
    const utangReimburse = await resolveAccount(tx, SYSTEM_KEYS.UTANG_REIMBURSEMENT);
    akunLawanId = utangReimburse.id;
    keteranganLawan = `Ditalangi ${e.reimburseTo?.name || "karyawan"} — belum diganti`;
  } else {
    const utangUsaha = await resolveAccount(tx, SYSTEM_KEYS.UTANG_USAHA);
    akunLawanId = utangUsaha.id;
    keteranganLawan = `Utang ke ${e.supplier?.name || e.payeeName || "pihak ketiga"}`;
    supplierId = e.supplierId;
  }

  const { entry, created } = await postJournal(tx, {
    date: e.date,
    description: `${e.expenseNumber} — ${e.description}`,
    source: "PENGELUARAN",
    sourceId: expenseId,
    idempotencyKey: KEY.expense(expenseId, keySuffix),
    userId,
    lines: [
      {
        accountId: akunBeban,
        debit: amount,
        description: `${e.category.name} (${e.division})`,
        orderId: e.orderId,
        unitId: e.unitId,
        supplierId,
      },
      ...(lawanBanyak || [{
        accountId: akunLawanId,
        credit: amount.plus(biayaAdmin),
        description: biayaAdmin.greaterThan(0) ? `${keteranganLawan} (termasuk biaya admin transfer)` : keteranganLawan,
        cashAccountId,
        supplierId,
        orderId: e.orderId,
      }]),
      ...barisAdmin,
    ],
  });
  return { posted: true, entry, created };
}

/**
 * Jurnal PELUNASAN pengeluaran mode REIMBURSEMENT/UTANG — saat uangnya
 * benar-benar keluar. Mode LANGSUNG tidak pernah melewati fungsi ini
 * (uangnya sudah keluar di jurnal pengakuan bebannya).
 */
export async function postExpensePaid(tx, { expenseId, userId = null, keySuffix = "" }) {
  const e = await tx.finExpense.findUnique({
    where: { id: expenseId },
    include: {
      cashAccount: { select: { id: true, name: true, accountId: true } },
      reimburseTo: { select: { name: true } },
      supplier: { select: { id: true, name: true } },
    },
  });
  if (!e) throw new Error(`Pengeluaran ${expenseId} tidak ditemukan`);
  if (e.mode === "LANGSUNG") return { posted: false, reason: "mode_langsung" };

  const sudahAda = await findEntryByKey(tx, KEY.expensePaid(expenseId, keySuffix));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  if (!e.cashAccount) {
    throw new AccountError("Pilih rekening kas/bank sumber pembayaran sebelum menandai pengeluaran ini dibayar", 400);
  }

  const akunUtang = await resolveAccount(
    tx,
    e.mode === "REIMBURSEMENT" || e.mode === "UANG_MUKA" ? SYSTEM_KEYS.UTANG_REIMBURSEMENT : SYSTEM_KEYS.UTANG_USAHA
  );
  // Mode UANG_MUKA: yang dibayar tunai HANYA selisih di atas saldo uang muka (bagian yang dipakai
  // sudah lunas lewat Uang Muka — membayarnya lagi = uang keluar dua kali).
  const amount = e.mode === "UANG_MUKA" ? toMoney(e.amount).minus(toMoney(e.advanceAppliedAmount || 0)) : toMoney(e.amount);
  if (amount.lessThanOrEqualTo(0)) return { posted: false, reason: "lunas_via_uang_muka" };
  const biayaAdmin = toMoney(e.transferFeeAmount || 0);
  const barisAdmin = await barisBiayaAdmin(tx, { fee: biayaAdmin, cashAccount: e.cashAccount });

  const { entry, created } = await postJournal(tx, {
    date: e.paidAt || e.date,
    description: `Pembayaran ${e.expenseNumber} — ${e.description}`,
    source: "PENGELUARAN",
    sourceId: expenseId,
    idempotencyKey: KEY.expensePaid(expenseId, keySuffix),
    userId,
    lines: [
      {
        accountId: akunUtang.id,
        debit: amount,
        description: e.mode === "REIMBURSEMENT" || e.mode === "UANG_MUKA"
          ? `Penggantian ke ${e.reimburseTo?.name || "karyawan"}`
          : `Pelunasan utang ke ${e.supplier?.name || e.payeeName || "pihak ketiga"}`,
        supplierId: e.supplierId,
      },
      {
        accountId: e.cashAccount.accountId,
        credit: amount.plus(biayaAdmin),
        description: biayaAdmin.greaterThan(0) ? `Uang keluar — ${e.cashAccount.name} (termasuk biaya admin transfer)` : `Uang keluar — ${e.cashAccount.name}`,
        cashAccountId: e.cashAccount.id,
      },
      ...barisAdmin,
    ],
  });
  return { posted: true, entry, created };
}

// ── Sumber lama: biaya kendaraan & belanja iklan ─────────────────────────

/** Cari kategori biaya dari kunci pemetaan otomatis (lihat accounts.js). */
async function kategoriOtomatis(tx, autoMapKey) {
  const kat = await tx.finExpenseCategory.findUnique({
    where: { autoMapKey },
    select: { id: true, name: true, accountId: true, active: true, division: true },
  });
  if (!kat || !kat.active) {
    throw new AccountError(
      `Kategori biaya untuk "${autoMapKey}" belum ada/nonaktif. Buka Finance > Kategori Biaya untuk memetakannya ke akun yang benar.`,
      409
    );
  }
  return kat;
}

/**
 * Biaya kendaraan (BBM/tol/parkir/cuci/denda) dari Armada.
 *
 * ⚠️ VehicleExpense TIDAK punya kolom "dibayar dari rekening mana" — di
 * lapangan supir membayar tunai dan menyetorkan struk. Jadi jurnalnya
 * memakai akun KAS sistem (uang tunai perusahaan yang dipegang di lapangan),
 * BUKAN salah satu FinCashAccount tertentu: menebak rekening bank untuk
 * uang tunai yang keluar dari kantong supir akan merusak rekonsiliasi bank.
 * Kalau kelak Armada mencatat sumber dananya, ganti baris kredit di bawah —
 * bukan menambah input ganda di Finance.
 */
export async function postVehicleExpense(tx, { vehicleExpenseId, userId = null }) {
  const ve = await tx.vehicleExpense.findUnique({
    where: { id: vehicleExpenseId },
    include: {
      vehicle: { select: { plateNumber: true } },
      driver: { select: { name: true } },
      expenseSubmission: { select: { id: true } },
    },
  });
  if (!ve) throw new Error(`Biaya kendaraan ${vehicleExpenseId} tidak ditemukan`);

  // Baris ini ditaut ke Pengajuan Biaya Lintas Divisi (ExpenseSubmission) —
  // VehicleExpense di sini cuma konteks operasional (odometer/liter), FinExpense
  // dari pengajuan itu yang jadi SATU-SATUNYA sumber approval/pembayaran/jurnal.
  // Memposting di sini juga akan membukukan biaya yang sama dua kali.
  if (ve.expenseSubmission) return { posted: false, skipped: true, reason: "tertaut_pengajuan_biaya" };

  // Baris BARU (lahir setelah cutover) yang TIDAK ditaut ke pengajuan mana pun —
  // harus lewat ExpenseSubmission dulu, bukan diam-diam terposting dari sini.
  // Baris lama (sebelum cutover) tetap jalan seperti biasa (lihat catatan cutover
  // di atas) — TIDAK ada regresi untuk data yang sudah ada.
  if (ve.createdAt >= CUTOVER_PENGAJUAN_BIAYA) return { posted: false, skipped: true, reason: "wajib_lewat_pengajuan_biaya" };

  const sudahAda = await findEntryByKey(tx, KEY.vehicleExpense(vehicleExpenseId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  try {
    const kat = await kategoriOtomatis(tx, `VEHICLE:${ve.category}`);
    const kas = await resolveAccount(tx, SYSTEM_KEYS.KAS);
    const amount = toMoney(ve.amount);

    const { entry, created } = await postJournal(tx, {
      date: ve.date,
      description:
        `Biaya ${kat.name} — kendaraan ${ve.vehicle?.plateNumber || "-"}` +
        (ve.driver?.name ? ` (${ve.driver.name})` : ""),
      source: "BIAYA_KENDARAAN",
      sourceId: vehicleExpenseId,
      idempotencyKey: KEY.vehicleExpense(vehicleExpenseId),
      userId,
      lines: [
        { accountId: kat.accountId, debit: amount, description: ve.notes || kat.name },
        { accountId: kas.id, credit: amount, description: "Kas lapangan (tunai supir)" },
      ],
    });
    return { posted: true, entry, created };
  } catch (err) {
    if (!(err instanceof AccountError)) throw err;
    await recordPostingGap(tx, {
      source: "BIAYA_KENDARAAN",
      sourceId: vehicleExpenseId,
      reason: "AKUN_SISTEM_BELUM_SIAP",
      detail: `Biaya kendaraan ${ve.date.toISOString().slice(0, 10)} belum dibukukan: ${err.message}`,
      metadata: { vehicleExpenseId, amount: String(ve.amount), category: ve.category },
    });
    return { posted: false, gap: true };
  }
}

/** Servis & perawatan kendaraan (VehicleService) — pola sama dengan di atas. */
export async function postVehicleService(tx, { vehicleServiceId, userId = null }) {
  const vs = await tx.vehicleService.findUnique({
    where: { id: vehicleServiceId },
    include: { vehicle: { select: { plateNumber: true } } },
  });
  if (!vs) throw new Error(`Servis kendaraan ${vehicleServiceId} tidak ditemukan`);

  // Sama dengan VehicleExpense di atas — servis BARU (lahir setelah cutover)
  // harus lewat ExpenseSubmission (jenis biaya SERVIS), bukan lagi posting
  // mandiri dari sini. Baris lama tetap jalan seperti biasa.
  if (vs.createdAt >= CUTOVER_PENGAJUAN_BIAYA) return { posted: false, skipped: true, reason: "wajib_lewat_pengajuan_biaya" };

  const sudahAda = await findEntryByKey(tx, KEY.vehicleService(vehicleServiceId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  try {
    const kat = await kategoriOtomatis(tx, "VEHICLE_SERVICE");
    const kas = await resolveAccount(tx, SYSTEM_KEYS.KAS);
    const amount = toMoney(vs.cost);

    const { entry, created } = await postJournal(tx, {
      date: vs.date,
      description: `Servis ${vs.type} — kendaraan ${vs.vehicle?.plateNumber || "-"}${vs.workshop ? ` di ${vs.workshop}` : ""}`,
      source: "BIAYA_KENDARAAN",
      sourceId: vehicleServiceId,
      idempotencyKey: KEY.vehicleService(vehicleServiceId),
      userId,
      lines: [
        { accountId: kat.accountId, debit: amount, description: vs.description || kat.name },
        { accountId: kas.id, credit: amount, description: "Kas lapangan (tunai)" },
      ],
    });
    return { posted: true, entry, created };
  } catch (err) {
    if (!(err instanceof AccountError)) throw err;
    await recordPostingGap(tx, {
      source: "BIAYA_KENDARAAN",
      sourceId: vehicleServiceId,
      reason: "AKUN_SISTEM_BELUM_SIAP",
      detail: `Servis kendaraan belum dibukukan: ${err.message}`,
      metadata: { vehicleServiceId, amount: String(vs.cost) },
    });
    return { posted: false, gap: true };
  }
}

/**
 * Belanja iklan bulanan (AdSpend). SATU baris = satu platform satu bulan —
 * tanggal bukunya diambil AKHIR bulan yang bersangkutan, bukan tanggal
 * input: angka ini memang rekap sebulan penuh, dan menaruhnya di tanggal
 * input akan memindahkan beban September ke Oktober kalau admin baru
 * mengisinya awal bulan berikutnya.
 */
export async function postAdSpend(tx, { adSpendId, userId = null }) {
  const ad = await tx.adSpend.findUnique({ where: { id: adSpendId } });
  if (!ad) throw new Error(`AdSpend ${adSpendId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.adSpend(adSpendId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  try {
    const kat = await kategoriOtomatis(tx, "ADSPEND");
    const kasBank = await resolveAccount(tx, SYSTEM_KEYS.BANK);
    const amount = toMoney(ad.amount);

    // Akhir bulan: tanggal 0 bulan berikutnya = hari terakhir bulan ini.
    const tanggalBuku = new Date(Date.UTC(ad.year, ad.month, 0));

    const { entry, created } = await postJournal(tx, {
      date: tanggalBuku,
      description: `Belanja iklan ${ad.source} — ${String(ad.month).padStart(2, "0")}/${ad.year}`,
      source: "BIAYA_IKLAN",
      sourceId: adSpendId,
      idempotencyKey: KEY.adSpend(adSpendId),
      userId,
      lines: [
        { accountId: kat.accountId, debit: amount, description: `Iklan ${ad.source}` },
        // Belanja iklan platform SELALU lewat kartu/rekening, tidak pernah
        // tunai — itu sebabnya lawannya akun Bank, bukan Kas.
        { accountId: kasBank.id, credit: amount, description: "Pembayaran platform iklan" },
      ],
    });
    return { posted: true, entry, created };
  } catch (err) {
    if (!(err instanceof AccountError)) throw err;
    await recordPostingGap(tx, {
      source: "BIAYA_IKLAN",
      sourceId: adSpendId,
      reason: "AKUN_SISTEM_BELUM_SIAP",
      detail: `Belanja iklan ${ad.source} ${ad.month}/${ad.year} belum dibukukan: ${err.message}`,
      metadata: { adSpendId, amount: String(ad.amount) },
    });
    return { posted: false, gap: true };
  }
}
