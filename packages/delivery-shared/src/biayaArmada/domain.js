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
  PERLU_REVISI: "PERLU_REVISI",
});

// Alur tim: DRAF, DIAJUKAN, PERLU_REVISI, DISETUJUI, DITOLAK, DIBAYAR.
// PERLU_REVISI didukung backend (migrasi 20260924110000): reviewer meminta perbaikan
// dengan alasan wajib; pemilik edit lalu mengajukan ulang. BEDA dari "Ditarik" (aksi
// pemilik, kembali ke DRAF) dan "Dibatalkan" (mengakhiri).
export const PERLU_REVISI_DIDUKUNG_BACKEND = true;

const INFO = {
  DRAFT: { stage: "DRAF", label: "Draf", tone: "neutral", terminal: false },
  DIAJUKAN: { stage: "DIAJUKAN", label: "Diajukan", tone: "accent", terminal: false },
  MENUNGGU_PERSETUJUAN: { stage: "DIAJUKAN", label: "Menunggu persetujuan", tone: "accent", terminal: false },
  OTOMATIS_DISETUJUI: { stage: "DISETUJUI", label: "Disetujui otomatis", tone: "green", terminal: false },
  DISETUJUI: { stage: "DISETUJUI", label: "Disetujui", tone: "green", terminal: false },
  DIBAYAR: { stage: "DIBAYAR", label: "Dibayar", tone: "green", terminal: true },
  DITOLAK: { stage: "DITOLAK", label: "Ditolak", tone: "red", terminal: true },
  DIBATALKAN: { stage: "DITOLAK", label: "Dibatalkan", tone: "neutral", terminal: true },
  PERLU_REVISI: { stage: "PERLU_REVISI", label: "Perlu revisi", tone: "orange", terminal: false },
};

export function statusInfo(status) {
  return INFO[status] || { stage: "TIDAK_DIKENAL", label: String(status || "-"), tone: "neutral", terminal: false };
}

// Kelompok tab daftar (mengikuti alur tim).
export const STAGES = ["DRAF", "PERLU_REVISI", "DIAJUKAN", "DISETUJUI", "DIBAYAR", "DITOLAK"];
export const STAGE_LABEL = { DRAF: "Draf", PERLU_REVISI: "Perlu revisi", DIAJUKAN: "Diajukan", DISETUJUI: "Disetujui", DIBAYAR: "Dibayar", DITOLAK: "Ditolak" };

// Status backend per tahap — dipakai sebagai filter server (?status=A,B).
export function statusesForStage(stage) {
  return Object.keys(INFO).filter((k) => INFO[k].stage === stage);
}

/**
 * Aksi yang BOLEH TAMPIL untuk satu pengajuan. Aturan status mengikuti service
 * backend (expenseSubmission/service.js): edit & ajukan hanya DRAFT, tarik hanya
 * MENUNGGU_PERSETUJUAN, batalkan DRAFT atau MENUNGGU_PERSETUJUAN. Persetujuan,
 * penolakan, dan pembayaran dijalankan di FinExpense terkait (izin Finance).
 */
export function allowedActions(submission, abilities, userId) {
  const none = { edit: false, ajukan: false, tarik: false, batalkan: false, uploadBukti: false, mintaRevisi: false, setujui: false, tolak: false, verifikasiBukti: false, bayar: false };
  if (!submission || !abilities) return none;
  const s = submission.status;
  const mine = [submission.requestedById, submission.createdById].includes(userId);
  const canOwn = abilities.submit && mine;
  const editable = s === "DRAFT" || s === "PERLU_REVISI";
  const menunggu = s === "MENUNGGU_PERSETUJUAN";
  const fe = submission.finExpense;
  return {
    edit: editable && canOwn,
    ajukan: editable && canOwn,
    tarik: menunggu && canOwn,
    batalkan: (editable || menunggu) && canOwn,
    uploadBukti: editable && canOwn,
    // Reviewer bukan pemohon: minta revisi (alasan wajib), setujui, tolak.
    mintaRevisi: abilities.requestRevision && menunggu && !mine,
    setujui: abilities.approve && menunggu && !mine,
    tolak: abilities.approve && menunggu && !mine,
    // Verifikasi bukti (finance:admin): ada bukti di FinExpense, belum diverifikasi, dan BUKAN pembuat FinExpense-nya
    // (server menolak verifikasi sendiri — tombol disembunyikan agar tidak menjanjikan aksi yang pasti gagal).
    verifikasiBukti: !!(abilities.verify && fe && fe.adaBukti && !fe.receiptVerifiedAt && fe.createdById !== userId
      && !["DITOLAK", "DIBATALKAN"].includes(s)),
    // Bayar (finance:post): hanya FinExpense berstatus DISETUJUI (server mengunci baris & menolak status lain).
    bayar: !!(abilities.pay && fe && fe.status === "DISETUJUI"),
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
  const fields = metadataFieldsFor(config, draft?.expenseType);
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
  const pick = ["expenseType", "amount", "date", "description", "notes", "vendorName", "vehicleId", "routeId", "jobId", "driverId", "helperId", "sumberDana", "advanceId", "metadata", "sourceNote", "urgentReason"];
  const body = { workspace };
  for (const k of pick) if (draft?.[k] !== undefined && draft[k] !== "" && draft[k] !== null) body[k] = draft[k];
  return body;
}

/** Field metadata terstruktur untuk satu jenis biaya, dari config SERVER (metadataFieldsByType). */
export function metadataFieldsFor(config, expenseType) {
  return config?.metadataFieldsByType?.[expenseType] || config?.metadataFields?.[expenseType] || [];
}

export function emptyDraft(today) {
  return { expenseType: "", amount: "", date: today, description: "", notes: "", vehicleId: "", routeId: "", jobId: "", metadata: {}, sumberDana: "" };
}

export function formatRupiah(n) {
  return "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");
}

/** Kalimat Indonesia untuk satu baris audit (timeline). */
export function describeAudit(a) {
  const alasan = a.reason ? ` — ${a.reason}` : "";
  if (a.field === "status") {
    if (a.after === "PERLU_REVISI") return `Diminta revisi${alasan}`;
    if (a.after === "MENUNGGU_PERSETUJUAN") return a.before === "PERLU_REVISI" ? "Diajukan ulang setelah revisi" : "Diajukan";
    if (a.after === "DRAFT") return a.before === null || a.before === undefined ? "Draf dibuat" : "Ditarik kembali oleh pemohon";
    if (a.after === "DIBATALKAN") return `Dibatalkan${alasan}`;
    if (a.after === "OTOMATIS_DISETUJUI") return `Disetujui otomatis${alasan}`;
    return `Status menjadi ${statusInfo(a.after).label}${alasan}`;
  }
  if (a.field === "draft") return a.reason === "Perbaikan setelah diminta revisi" ? "Diperbaiki setelah diminta revisi" : "Draf diubah";
  if (a.field === "bukti") return `Foto struk diunggah${a.after ? ` (${a.after})` : ""}`;
  return `Koreksi ${a.field}${alasan}`;
}
