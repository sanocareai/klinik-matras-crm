// CAPABILITIES — ringkasan kemampuan pengguna untuk klien (web & mobile),
// diturunkan dari role/permission AKTUAL di constants/permissions.js.
//
// Klien TIDAK boleh menyalin peta role→izin (itu jadi dua sumber kebenaran).
// Ia cukup membaca objek ini untuk menampilkan/menyembunyikan tombol. Server
// tetap penentu akhir: route memakai requirePermission seperti biasa.

import { hasPermission, rolesOf } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";

export function capabilitiesFor(user) {
  const roles = rolesOf(user);
  const financeRead = hasPermission(user, P.FINANCE_READ);
  const financePost = hasPermission(user, P.FINANCE_POST);
  const financeApprove = hasPermission(user, P.FINANCE_APPROVE);
  const financeAdmin = hasPermission(user, P.FINANCE_ADMIN);
  const paymentRead = hasPermission(user, P.PAYMENT_READ);
  const paymentWrite = hasPermission(user, P.PAYMENT_WRITE);
  const expenseSubmit = hasPermission(user, P.FINANCE_EXPENSE_SUBMIT);
  // Snapshot Insentif (24 September 2026) — dipakai Admin UI Snapshot utk
  // menampilkan/menyembunyikan tombol Buat/Review/Setujui/Tolak.
  const incentiveSnapshotCreate = hasPermission(user, P.INCENTIVE_SNAPSHOT_CREATE);
  const incentiveSnapshotReview = hasPermission(user, P.INCENTIVE_SNAPSHOT_REVIEW);
  const incentiveSnapshotApprove = hasPermission(user, P.INCENTIVE_SNAPSHOT_APPROVE);
  const incentiveSnapshotRead = hasPermission(user, P.INCENTIVE_SNAPSHOT_READ);
  // Pembayaran Insentif (24 September 2026) — dipakai Admin UI Pembayaran
  // utk menampilkan/menyembunyikan tombol Catat Pembayaran/Batalkan.
  const incentivePayoutRead = hasPermission(user, P.INCENTIVE_PAYOUT_READ);
  const incentivePayoutCreate = hasPermission(user, P.INCENTIVE_PAYOUT_CREATE);
  const incentivePayoutVoid = hasPermission(user, P.INCENTIVE_PAYOUT_VOID);

  // Sano Delivery Control (aplikasi Admin/Owner armada). Diturunkan dari izin
  // AKTUAL, bukan nama role: job:read penuh = boleh melihat SEMUA job/driver
  // (ADMIN, OWNER, DISPATCHER, LEADER_DRIVER). DRIVER/HELPER hanya punya
  // job:own sehingga TIDAK PERNAH lolos. Empat izin biaya armada dipisah:
  // mengajukan (sama dengan gerbang route pengajuan), memverifikasi bukti
  // (finance:admin, sama dengan route verifikasi-bukti), menyetujui, dan membayar.
  const deliveryControlApp = hasPermission(user, P.JOB_READ);
  const deliveryExpense = {
    submit: expenseSubmit || financePost || financeAdmin,
    verify: financeAdmin,
    approve: financeApprove,
    pay: financePost,
  };

  // Preset = petunjuk TATA LETAK awal aplikasi (bukan izin).
  let preset = "NONE";
  if (roles.includes("FINANCE")) preset = "FINANCE";
  else if (roles.includes("OWNER") || roles.includes("ADMIN")) preset = "OWNER";
  else if (roles.includes("APPROVER")) preset = "APPROVER";
  else if (roles.includes("ACCOUNTANT")) preset = "ACCOUNTANT";
  else if (financeApprove && !financePost) preset = "APPROVER";
  else if (financeRead) preset = "ACCOUNTANT";
  else if (expenseSubmit) preset = "SUBMITTER";

  return {
    financeRead,
    financePost,
    financeApprove,
    financeAdmin,
    paymentRead,
    paymentWrite,
    expenseSubmit,
    incentiveSnapshotCreate, incentiveSnapshotReview, incentiveSnapshotApprove, incentiveSnapshotRead,
    incentivePayoutRead, incentivePayoutCreate, incentivePayoutVoid,
    deliveryControlApp, deliveryExpense,
    // Boleh memakai aplikasi Finance? (dipakai login mobile). SENGAJA tidak
    // memakai paymentRead: SALES juga memegangnya (lihat riwayat pembayaran order
    // sendiri) tetapi bukan tim Finance.
    financeApp: financeRead || financePost || financeApprove,
    preset,
  };
}
