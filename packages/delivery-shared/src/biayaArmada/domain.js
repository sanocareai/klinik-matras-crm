// DOMAIN BIAYA ARMADA di sisi klien.
//
// PENTING: ini BUKAN ledger dan BUKAN backend baru. Seluruh biaya armada memakai
// kontrak yang sudah ada: Pengajuan Biaya Lintas Divisi (ExpenseSubmission,
// workspace DELIVERY) yang menjadi FinExpense lewat service Finance. Delivery TIDAK
// membuat transaksi/jurnal Finance sendiri. File ini hanya menerjemahkan status
// backend ke istilah yang dipakai tim, dan menentukan aksi apa yang boleh tampil
// (server tetap penentu akhir).

export const WORKSPACE = "DELIVERY";

// Status backend (enum ExpenseSubmissionStatus).
export const BACKEND_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  DIAJUKAN: "DIAJUKAN",
  MENUNGGU_PERSETUJUAN: "MENUNGGU_PERSETUJUAN",
  OTOMATIS_DISETUJUI: "OTOMATIS_DISETUJUI",
  DISETUJUI: "DISETUJUI",
  DIBAYAR: "DIBAYAR",
  DITOLAK: "DITOLAK",
  DIBATALKAN: "DIBATALKAN",
});

// Alur yang diminta tim: DRAF, DIAJUKAN, PERLU_REVISI, DISETUJUI, DITOLAK, DIBAYAR.
// PERLU_REVISI BELUM ada di backend (enum tidak punya nilai itu). Sampai backend
// mendukungnya, "revisi" = pemohon menarik pengajuan (status MENUNGGU_PERSETUJUAN),
// mengedit, lalu mengajukan ulang. Jangan menampilkan PERLU_REVISI sebagai status
// nyata sebelum backend menyediakannya.
export const PERLU_REVISI_DIDUKUNG_BACKEND = false;

const INFO = {
  DRAFT: { stage: "DRAF", label: "Draf", tone: "neutral", terminal: false },
  DIAJUKAN: { stage: "DIAJUKAN", label: "Diajukan", tone: "accent", terminal: false },
  MENUNGGU_PERSETUJUAN: { stage: "DIAJUKAN", label: "Menunggu persetujuan", tone: "accent", terminal: false },
  OTOMATIS_DISETUJUI: { stage: "DISETUJUI", label: "Disetujui otomatis", tone: "green", terminal: false },
  DISETUJUI: { stage: "DISETUJUI", label: "Disetujui", tone: "green", terminal: false },
  DIBAYAR: { stage: "DIBAYAR", label: "Dibayar", tone: "green", terminal: true },
  DITOLAK: { stage: "DITOLAK", label: "Ditolak", tone: "red", terminal: true },
  DIBATALKAN: { stage: "DITOLAK", label: "Dibatalkan", tone: "neutral", terminal: true },
};

export function statusInfo(status) {
  return INFO[status] || { stage: "TIDAK_DIKENAL", label: String(status || "-"), tone: "neutral", terminal: false };
}

// Kelompok tab daftar (mengikuti alur tim).
export const STAGES = ["DRAF", "DIAJUKAN", "DISETUJUI", "DIBAYAR", "DITOLAK"];

/**
 * Aksi yang BOLEH TAMPIL untuk satu pengajuan. Aturan status mengikuti service
 * backend (expenseSubmission/service.js): edit & ajukan hanya DRAFT, tarik hanya
 * MENUNGGU_PERSETUJUAN, batalkan DRAFT atau MENUNGGU_PERSETUJUAN. Persetujuan,
 * penolakan, dan pembayaran dijalankan di FinExpense terkait (izin Finance).
 */
export function allowedActions(submission, abilities, userId) {
  const none = { edit: false, ajukan: false, tarik: false, batalkan: false, uploadBukti: false, verifikasiBukti: false, setujui: false, tolak: false, bayar: false };
  if (!submission || !abilities) return none;
  const s = submission.status;
  const mine = [submission.requestedById, submission.createdById].includes(userId);
  const canOwn = abilities.submit && mine;
  const hasFin = !!submission.finExpenseId || !!submission.finExpense;
  const proof = submission.finExpense?.receiptUrl || submission.proofs?.length;
  return {
    edit: s === "DRAFT" && canOwn,
    ajukan: s === "DRAFT" && canOwn,
    tarik: s === "MENUNGGU_PERSETUJUAN" && canOwn,
    batalkan: ["DRAFT", "MENUNGGU_PERSETUJUAN"].includes(s) && canOwn,
    uploadBukti: !INFO[s]?.terminal && canOwn,
    verifikasiBukti: abilities.verify && hasFin && !!proof && !submission.finExpense?.receiptVerifiedAt && !INFO[s]?.terminal,
    setujui: abilities.approve && s === "MENUNGGU_PERSETUJUAN",
    tolak: abilities.approve && s === "MENUNGGU_PERSETUJUAN",
    bayar: abilities.pay && ["DISETUJUI", "OTOMATIS_DISETUJUI"].includes(s),
  };
}

const RUPIAH_MAX = 1_000_000_000;

/**
 * Validasi ringan di HP sebelum mengirim (agar draf offline tidak antre dengan data
 * jelas keliru). Validasi yang menentukan tetap di server.
 * config = respons GET /finance/expense-submissions/config untuk workspace DELIVERY
 * (jenis biaya & field metadata datang dari server, TIDAK disalin ke klien).
 */
export function validateDraft(draft, config) {
  const errors = {};
  const types = (config?.expenseTypes || []).map((t) => t.code);
  if (!draft?.expenseType) errors.expenseType = "Pilih jenis biaya";
  else if (types.length && !types.includes(draft.expenseType)) errors.expenseType = "Jenis biaya tidak dikenal";
  const amount = Number(draft?.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Nominal harus lebih dari 0";
  else if (amount > RUPIAH_MAX) errors.amount = "Nominal terlalu besar";
  if (!draft?.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "Tanggal wajib diisi";
  const fields = config?.metadataFields?.[draft?.expenseType] || [];
  for (const f of fields) {
    if (f.required && (draft?.metadata?.[f.key] === undefined || draft?.metadata?.[f.key] === "" || draft?.metadata?.[f.key] === null)) {
      errors[`metadata.${f.key}`] = `${f.label} wajib diisi`;
    }
  }
  const odo = draft?.metadata?.odometerKm;
  if (odo !== undefined && odo !== "" && odo !== null && (!Number.isFinite(Number(odo)) || Number(odo) < 0)) {
    errors["metadata.odometerKm"] = "Odometer harus angka positif";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// Body POST /expense-submissions dari draf (hanya field yang dikenal backend).
export function toCreateBody(draft, workspace = WORKSPACE) {
  const pick = ["expenseType", "amount", "date", "description", "notes", "vendorName", "vehicleId", "routeId", "jobId", "driverId", "helperId", "sumberDana", "metadata", "sourceNote", "urgentReason"];
  const body = { workspace };
  for (const k of pick) if (draft?.[k] !== undefined && draft[k] !== "" && draft[k] !== null) body[k] = draft[k];
  return body;
}
