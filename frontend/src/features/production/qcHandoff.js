// Logika murni antrean QC Production V2 (Production Workshop + Warehouse V2, P6). Dipisah dari halaman JSX supaya bisa diuji dengan node --test
// biasa. Cermin aturan backend (productionQcHandoffCommandService.js) — server tetap menegakkan ulang semuanya (izin, foto, revisi, konflik).

export const QC_TABS = Object.freeze([
  { key: "AWAITING_QC", label: "Menunggu QC" },
  { key: "REWORK", label: "Rework" },
  { key: "HANDOFF", label: "Menunggu Gudang" },
  { key: "REJECTED", label: "Ditolak Gudang" },
  { key: "CONFLICT", label: "Konflik" },
]);

export const QC_STATE_BADGE = Object.freeze({
  AWAITING_QC: { variant: "warning", label: "Menunggu QC" },
  REWORK: { variant: "info", label: "Sedang Rework" },
  HANDOFF: { variant: "accent", label: "Menunggu Gudang" },
  REJECTED: { variant: "danger", label: "Ditolak Gudang" },
  CONFLICT: { variant: "danger", label: "Konflik Status" },
});

export function qcStateBadgeFor(state) {
  return QC_STATE_BADGE[state] || { variant: "neutral", label: state || "—" };
}

export const INSPECTION_RESULT_LABEL = Object.freeze({
  PASS: { variant: "success", label: "Lulus" },
  FAIL_REWORK: { variant: "danger", label: "Gagal — Rework" },
  OVERRIDDEN: { variant: "warning", label: "QC Di-waive" },
  PENDING: { variant: "neutral", label: "Menunggu" },
});

export function inspectionBadgeFor(result) {
  return INSPECTION_RESULT_LABEL[result] || { variant: "neutral", label: result || "—" };
}

export const FIT_VERDICTS = Object.freeze([
  { value: "PAS", label: "Pas" },
  { value: "TERLALU_KERAS", label: "Terlalu keras" },
  { value: "TERLALU_EMPUK", label: "Terlalu empuk" },
]);
export const FAIL_VERDICTS = Object.freeze(FIT_VERDICTS.filter((v) => v.value !== "PAS"));
export const PREFERENCE_OVERRIDES = Object.freeze([
  { value: "LEBIH_KERAS", label: "Customer minta lebih keras" },
  { value: "LEBIH_EMPUK", label: "Customer minta lebih empuk" },
]);

export const QC_MODES = Object.freeze([
  { key: "PASS", label: "Lulus" },
  { key: "FAIL", label: "Gagal (Rework)" },
  { key: "WAIVED", label: "Waive QC" },
]);

export const MIN_WAIVE_REASON = 10;

export const CONFLICT_KIND_LABEL = Object.freeze({
  UNIT_CANCELLED: "Unit dibatalkan manual (di luar rencana produksi)",
  UNIT_MARKED_READY: "Unit ditandai Siap Kirim manual (di luar rencana produksi)",
  UNIT_SHIPPED: "Unit sudah dikirim/keluar gudang (di luar rencana produksi)",
});

export const RESOLUTION_LABEL = Object.freeze({
  RESTORE_UNIT_STATUS: { label: "Pulihkan status unit", hint: "Kembalikan unit ke status Diproses; rencana produksi dilanjutkan." },
  CANCEL_RUN: { label: "Batalkan Production Run", hint: "Run ditutup sebagai dibatalkan; status unit tidak diubah." },
  ACCEPT_OVERRIDE: { label: "Terima override (tanpa QC/custody)", hint: "Run ditutup TANPA bukti QC/custody. Hanya ADMIN/OWNER (QC_WAIVE)." },
  NO_LONGER_APPLICABLE: { label: "Tidak berlaku lagi", hint: "Status unit sudah konsisten; tutup catatan konflik." },
});

export function conflictKindLabel(kind) { return CONFLICT_KIND_LABEL[kind] || kind || "—"; }
export function resolutionLabel(resolution) { return RESOLUTION_LABEL[resolution]?.label || resolution || "—"; }

// Tahap yang boleh dipilih sebagai tahap rework: SEBELUM gerbang QC (unit wajib kembali diuji). Urutan mengikuti jalur.
export function reworkStageOptions(run) {
  const stages = run?.stages || [];
  const gate = stages.find((s) => s.isQcGate);
  if (!gate) return [];
  return stages.filter((s) => !s.isQcGate && s.order < gate.order);
}

export function canRecordInspection(run) {
  return run?.state === "AWAITING_QC" && !run?.conflict;
}

// Validasi form (mirror server; pesan Indonesia). form: { mode, photoUrls, referenceWeightKg, fitVerdict, customerPreferenceOverride, educationGiven,
// note, reworkStageId, reason, materials:[{materialId, qty}] }.
export function validateInspectionForm(form, { profile = "KASUR" } = {}) {
  if (profile === "GENERIC") return validateGenericInspection(form);
  const errors = [];
  const photos = form.photoUrls || [];
  if (form.mode === "WAIVED") {
    if (String(form.reason || "").trim().length < MIN_WAIVE_REASON) errors.push(`Alasan waive wajib diisi (minimal ${MIN_WAIVE_REASON} karakter)`);
    return { valid: errors.length === 0, errors };
  }
  if (photos.length === 0) errors.push("Foto bukti wajib untuk hasil Lulus/Gagal");
  const weight = Number(form.referenceWeightKg);
  if (!Number.isInteger(weight) || weight <= 0) errors.push("Berat acuan (kg, bilangan bulat) wajib diisi");
  if (form.mode === "PASS") {
    const verdict = form.fitVerdict || "PAS";
    if (verdict !== "PAS" && !(form.customerPreferenceOverride && form.educationGiven)) errors.push("Lulus hanya untuk hasil Pas, atau override preferensi customer disertai konfirmasi edukasi");
  } else if (form.mode === "FAIL") {
    if (!FAIL_VERDICTS.some((v) => v.value === form.fitVerdict)) errors.push("Pilih hasil uji: terlalu keras atau terlalu empuk");
    if (String(form.note || "").trim().length < 3) errors.push("Catatan temuan wajib diisi (minimal 3 karakter)");
    if (!form.reworkStageId) errors.push("Tahap rework wajib dipilih");
    const materials = form.materials || [];
    const seen = new Set();
    for (const line of materials) {
      if (!line.materialId) errors.push("Pilih bahan untuk setiap baris bahan tambahan");
      else if (seen.has(line.materialId)) errors.push("Satu bahan tidak boleh muncul dua kali");
      seen.add(line.materialId);
      if (!(Number(line.qty) > 0)) errors.push("Jumlah bahan tambahan harus lebih dari nol");
    }
  }
  return { valid: errors.length === 0, errors };
}

// Profil GENERIC = pemeriksaan hasil produk NON-kasur (divan/sofa) oleh PIC QC: foto + catatan + lulus/gagal; TANPA berat acuan/uji berat badan/tekstur kasur (server menolak bila dikirim).
function validateGenericInspection(form) {
  const errors = [];
  if (form.mode === "WAIVED") {
    if (String(form.reason || "").trim().length < MIN_WAIVE_REASON) errors.push(`Alasan waive wajib diisi (minimal ${MIN_WAIVE_REASON} karakter)`);
    return { valid: errors.length === 0, errors };
  }
  if ((form.photoUrls || []).length === 0) errors.push("Foto bukti wajib untuk hasil Lulus/Gagal");
  if (form.mode === "FAIL") {
    if (String(form.note || "").trim().length < 3) errors.push("Catatan temuan wajib diisi (minimal 3 karakter)");
    if (!form.reworkStageId) errors.push("Tahap rework wajib dipilih");
    const seen = new Set();
    for (const line of form.materials || []) {
      if (!line.materialId) errors.push("Pilih bahan untuk setiap baris bahan tambahan");
      else if (seen.has(line.materialId)) errors.push("Satu bahan tidak boleh muncul dua kali");
      seen.add(line.materialId);
      if (!(Number(line.qty) > 0)) errors.push("Jumlah bahan tambahan harus lebih dari nol");
    }
  }
  return { valid: errors.length === 0, errors };
}

// Body yang dikirim ke server dari state form (hanya field yang relevan per mode).
export function buildInspectionBody(form, expectedRevision, { profile = "KASUR" } = {}) {
  const base = { expectedRevision, result: form.mode };
  if (profile === "GENERIC" && form.mode !== "WAIVED") {
    const body = { ...base, photoUrls: form.photoUrls || [], note: String(form.note || "").trim() || undefined };
    if (form.mode === "FAIL") {
      body.reworkStageId = form.reworkStageId;
      const materials = (form.materials || []).filter((m) => m.materialId).map((m) => ({ materialId: m.materialId, qty: Number(m.qty) }));
      if (materials.length) body.supplementalMaterials = materials;
    }
    return body;
  }
  if (form.mode === "WAIVED") return { ...base, reason: String(form.reason || "").trim() };
  const body = { ...base, photoUrls: form.photoUrls || [], referenceWeightKg: Number(form.referenceWeightKg), note: String(form.note || "").trim() || undefined };
  if (form.mode === "PASS") {
    body.fitVerdict = form.fitVerdict || "PAS";
    if (body.fitVerdict !== "PAS") { body.customerPreferenceOverride = form.customerPreferenceOverride; body.educationGiven = true; }
  } else {
    body.fitVerdict = form.fitVerdict;
    body.reworkStageId = form.reworkStageId;
    const materials = (form.materials || []).filter((m) => m.materialId).map((m) => ({ materialId: m.materialId, qty: Number(m.qty) }));
    if (materials.length) body.supplementalMaterials = materials;
  }
  return body;
}

export function validateNoteForm({ note, action, reworkStageId }) {
  if (String(note || "").trim().length < 3) return { valid: false, error: "Catatan tindakan koreksi wajib diisi (minimal 3 karakter)" };
  if (action === "REWORK" && !reworkStageId) return { valid: false, error: "Tahap rework wajib dipilih" };
  return { valid: true, error: null };
}

export function nextInspectionSummary(response) {
  if (!response) return "";
  if (response.replayed) return "Perintah ini sudah diproses sebelumnya (tidak ada perubahan ganda).";
  if (response.result === "FAIL") return `QC gagal — rework dibuka pada tahap ${response.reworkStage?.label || "yang dipilih"}${response.supplementalIssue ? "; menunggu Gudang menyerahkan bahan tambahan" : ""}.`;
  if (response.result === "WAIVED") return "QC di-waive oleh pihak berwenang — lanjut ke tahap setelah QC.";
  return response.nextPhase === "HANDOFF" ? "QC lulus — barang jadi ditawarkan ke Gudang." : "QC lulus — lanjutkan tahap setelah QC (mis. Jahit Corner, Finish) di Antrean Kerja.";
}

export function qcErrorMessage(error) {
  switch (error?.code) {
    case "QC_REVISION_CONFLICT":
    case "QC_EXCEPTION_REVISION_CONFLICT": return "Data sudah berubah (mungkin diproses petugas lain) — muat ulang detail.";
    case "QC_NOT_AWAITING": return "Run ini tidak sedang menunggu QC (mungkin sudah diputuskan petugas lain).";
    case "PRODUCTION_RUN_INCONSISTENT": return "Status unit tidak konsisten dengan Production Run (kemungkinan diubah manual di luar rencana produksi). Catat konflik lalu selesaikan lewat rekonsiliasi.";
    case "PRODUCTION_RUN_EXCEPTION_OPEN": return "Ada konflik rekonsiliasi yang belum diselesaikan untuk run ini.";
    case "QC_WAIVE_FORBIDDEN": return "Hanya pihak berwenang (ADMIN/OWNER) yang boleh mem-waive QC atau menerima override.";
    case "QC_WRITE_REQUIRED": return "Anda tidak berwenang memutuskan hasil QC.";
    case "PLAN_MATERIAL_SHORTAGE": return `Stok bahan tambahan tidak cukup — QC belum dicatat. ${error.message || ""}`.trim();
    case "QC_WRITER_OFF": return "QC belum aktif untuk unit ini.";
    case "QC_REWORK_MATERIAL_EXISTS": return "Bahan tambahan untuk inspeksi ini sudah diajukan.";
    case "QC_REWORK_ALREADY_STARTED": return "Rework sudah dimulai; bahan tambahan tidak dapat diajukan lagi.";
    case "QC_NO_REJECTION": return "Tidak ada penolakan Gudang yang perlu ditindaklanjuti untuk run ini.";
    case "QC_RESOLUTION_NOT_ALLOWED": return error.message || "Resolusi ini tidak berlaku untuk konflik tersebut.";
    case "QC_RUN_CONSISTENT": return "Status unit sudah konsisten dengan Production Run — tidak ada konflik yang perlu dicatat.";
    default: return error?.message || "Gagal memproses perintah";
  }
}

export function emptyStateCopy({ readerMode, tab }) {
  if (readerMode === "OFF") {
    return {
      title: "Antrean QC belum diaktifkan",
      description: "Fitur ini sedang dalam tahap uji coba (canary). Hubungi Admin bila Anda seharusnya sudah melihat antrean di sini.",
      belumAktif: true,
    };
  }
  const label = QC_TABS.find((t) => t.key === tab)?.label?.toLowerCase() || "tab ini";
  return { title: `Tidak ada unit di tab ${label}`, description: "Unit yang menyelesaikan seluruh tahap sebelum gerbang QC akan muncul di sini.", belumAktif: false };
}
