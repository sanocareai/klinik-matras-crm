// P12B.5 — model murni aksi V1 untuk unit NON-V2 di drawer Unit 360 (layanan teknis, prioritas, target, blokir). Tanpa JSX/jaringan supaya diuji `node --test`.
// Endpoint & izin = yang SUDAH ADA (PATCH /units/:id/service, PATCH /units/:id/production = UNIT_ROUTING_WRITE; POST /units/:id/blockers/:id/resolve = UNIT_STAGE_WRITE).
// Peran di bawah hanya CERMIN untuk menyembunyikan tombol yang pasti ditolak server (diuji terhadap backend/src/constants/permissions.js); server tetap penegak.
export const V1_ROUTING_ROLES = Object.freeze(["ADMIN", "OWNER", "PRODUCTION_LEAD"]); // UNIT_ROUTING_WRITE
export const V1_STAGE_ROLES = Object.freeze(["PRODUCTION_WORKER", "PRODUCTION_LEAD", "QC_LEAD", "ADMIN", "OWNER"]); // UNIT_STAGE_WRITE
export const canRouteV1 = (roles = []) => (roles || []).some((r) => V1_ROUTING_ROLES.includes(r));
export const canResolveBlockerV1 = (roles = []) => (roles || []).some((r) => V1_STAGE_ROLES.includes(r));

const WIB_MS = 7 * 3600_000;
// Tanggal kalender WIB dari ISO UTC — BUKAN iso.slice(0,10): "2026-10-20T00:00:00+07:00" tersimpan 2026-10-19T17:00Z (slice menampilkan 19, salah sehari).
export const wibDateOf = (iso) => (iso ? new Date(new Date(iso).getTime() + WIB_MS).toISOString().slice(0, 10) : "");
// Kirim dengan offset WIB eksplisit (tidak ada DST) — server tidak menebak zona waktu browser.
export const dueIsoOf = (dateStr) => (dateStr ? `${dateStr}T00:00:00+07:00` : null);

export const draftOf = (unit) => ({ priority: unit?.priority || "NORMAL", due: wibDateOf(unit?.productionDueAt) });
export const isDraftDirty = (draft, unit) => { const base = draftOf(unit); return draft.priority !== base.priority || draft.due !== base.due; };
export const productionPatchOf = (draft, unit) => {
  const base = draftOf(unit); const body = {};
  if (draft.priority !== base.priority) body.priority = draft.priority;
  if (draft.due !== base.due) body.productionDueAt = dueIsoOf(draft.due);
  return body;
};

// Konflik "data berubah di tengah jalan": bandingkan data saat drawer dimuat (loaded) dengan bacaan terbaru tepat sebelum menulis (latest).
// Mengembalikan daftar nama bidang yang berbeda. (Tanpa kunci revisi di server → ini pemeriksaan-lalu-tulis, bukan atomik; celah kecil tetap ada.)
const CONFLICT_FIELDS = { service: (t) => t?.unit?.serviceId ?? null, priority: (t) => t?.unit?.priority ?? "NORMAL", due: (t) => (t?.unit?.productionDueAt ? new Date(t.unit.productionDueAt).toISOString() : null), blocker: (t) => t?.activeBlocker?.id ?? null };
export function detectConflict(loaded, latest, fields = Object.keys(CONFLICT_FIELDS)) {
  return fields.filter((f) => CONFLICT_FIELDS[f] && CONFLICT_FIELDS[f](loaded) !== CONFLICT_FIELDS[f](latest));
}
export const FIELD_LABEL = { service: "layanan teknis", priority: "prioritas", due: "target selesai", blocker: "blokir produksi" };
export const conflictMessage = (fields) => `Data unit sudah diubah orang lain (${fields.map((f) => FIELD_LABEL[f] || f).join(", ")}). Tampilan dimuat ulang — periksa lalu simpan lagi.`;

// ---------------------------------------------------------------------------------------------------------------------------------------
// P12B.6 — aksi harian V1 lanjutan (tahap, QC, bahan, penugasan) + matriks keputusan seluruh aksi halaman Unit lama.
// Peran = cermin izin backend (diuji terhadap permissions.js): PRODUCTION_ASSIGNMENT_WRITE / QC_WRITE / UNIT_MATERIAL_WRITE.
export const V1_ASSIGN_ROLES = Object.freeze(["ADMIN", "OWNER", "PRODUCTION_LEAD"]);
export const V1_QC_ROLES = Object.freeze(["QC_LEAD", "ADMIN", "OWNER"]);
export const V1_MATERIAL_ROLES = Object.freeze(["PRODUCTION_WORKER", "PRODUCTION_LEAD", "WAREHOUSE", "ADMIN", "OWNER"]);
const has = (roles, list) => (roles || []).some((r) => list.includes(r));
export const canAssignV1 = (roles) => has(roles, V1_ASSIGN_ROLES);
export const canQcV1 = (roles) => has(roles, V1_QC_ROLES);
export const canMaterialV1 = (roles) => has(roles, V1_MATERIAL_ROLES);
export const canStageV1 = canResolveBlockerV1; // UNIT_STAGE_WRITE yang sama dengan menyelesaikan blokir

// Keadaan tahap SEKARANG dari timeline (murni, diuji) — menentukan tombol apa yang boleh tampil. Tidak ada "lewati tahap"/"ubah rute" (sengaja dihentikan).
export function stageStateOf(data) {
  const unit = data?.unit; const path = data?.path || [];
  if (!unit) return { kind: "NONE", current: null };
  if (data.needsService) return { kind: "NEEDS_SERVICE", current: null };
  const current = path.find((p) => p.isCurrent) || null;
  if (!unit.currentStageId) return { kind: path.length ? "NOT_STARTED" : "NEEDS_SERVICE", current: null, first: path[0]?.stage || null };
  if (!current) return { kind: "ALL_DONE", current: null };
  const qc = !!current.stage.requiresQc;
  if (current.status === "BLOCKED") return { kind: "BLOCKED", current };
  if (current.status === "PAUSED") return { kind: "PAUSED", current };
  if (current.status === "IN_PROGRESS") return { kind: qc ? "IN_PROGRESS_QC" : "IN_PROGRESS", current };
  return { kind: "READY", current };
}
export const needsPhotoOf = (stateOrStage) => !!(stateOrStage?.current?.stage?.requiresPhoto ?? stateOrStage?.requiresPhoto);

// Validasi form (cermin validasi server supaya tombol tidak aktif percuma; server tetap penegak).
export const failFormValid = ({ reason, note }) => !!reason && (reason !== "OTHER" || String(note || "").trim().length >= 3);
export const pauseFormValid = ({ reason, note }) => !!reason && (reason !== "OTHER" || String(note || "").trim().length >= 3);
export const qcFormValid = ({ verdict, referenceWeightKg, override, educationGiven, needsPhoto, photos }) => !!verdict && Number(referenceWeightKg) > 0 && (!override || !!educationGiven) && (!needsPhoto || (photos || []).length > 0);
export const completeFormValid = ({ needsPhoto, photos }) => !needsPhoto || (photos || []).length > 0;

// MATRIKS KEPUTUSAN — setiap aksi halaman Unit lama: TERSEDIA (di drawer non-V2), DIBATASI (peran/syarat), atau SENGAJA DIHENTIKAN (alasan + guard yang dibutuhkan bila dibuka lagi).
export const V1_ACTION_MATRIX = Object.freeze([
  { key: "service", label: "Tetapkan layanan teknis", status: "TERSEDIA", roles: V1_ROUTING_ROLES, api: "PATCH /units/:id/service", cohort: "Diagnosis (V2)" },
  { key: "production", label: "Prioritas & target produksi", status: "TERSEDIA", roles: V1_ROUTING_ROLES, api: "PATCH /units/:id/production", cohort: "Rencana Produksi (V2)" },
  { key: "start", label: "Mulai tahap", status: "TERSEDIA", roles: V1_STAGE_ROLES, api: "POST /units/:id/stages/start", cohort: "Aplikasi Meja/Corner (V2)" },
  { key: "complete", label: "Selesaikan tahap + foto/catatan (dokumentasi V1)", status: "TERSEDIA", roles: V1_STAGE_ROLES, api: "POST /units/:id/stages/:id/complete", cohort: "Aplikasi Meja/Corner + Dokumentasi (V2)" },
  { key: "pause", label: "Jeda / lanjutkan tahap", status: "TERSEDIA", roles: V1_STAGE_ROLES, api: "POST …/pause · …/resume", cohort: "Aplikasi Meja (V2)" },
  { key: "fail", label: "Tandai terhambat", status: "TERSEDIA", roles: V1_STAGE_ROLES, api: "POST …/fail", cohort: "Menunggu Bahan Baku (V2)" },
  { key: "resolveBlocker", label: "Selesaikan blokir", status: "TERSEDIA", roles: V1_STAGE_ROLES, api: "POST /units/:id/blockers/:id/resolve", cohort: "Gudang menutup kekurangan (V2)" },
  { key: "qc", label: "Putusan QC (Uji Berat Badan)", status: "DIBATASI", roles: V1_QC_ROLES, api: "POST …/qc", cohort: "Antrean QC (V2)", note: "hanya QC_WRITE; hanya saat tahap gerbang QC berjalan" },
  { key: "material", label: "Catat pemakaian bahan", status: "DIBATASI", roles: V1_MATERIAL_ROLES, api: "POST /units/:id/materials", cohort: "Material Issue (V2)", note: "menulis ledger stok (negatif ditolak server)" },
  { key: "assign", label: "Tugaskan work center / operator", status: "DIBATASI", roles: V1_ASSIGN_ROLES, api: "POST …/assign", cohort: "Rencana Produksi (V2)", note: "hanya saat ada tahap berjalan/siap" },
  { key: "skip", label: "Lewati tahap opsional", status: "SENGAJA_DIHENTIKAN", roles: [], api: "POST /units/:id/stages/skip", note: "mengubah jalur kerja tanpa jejak alasan terstruktur; bila dibuka: izin UNIT_ROUTING_WRITE + alasan wajib + konfirmasi + hanya tahap isOptional + jejak audit" },
  { key: "route", label: "Tetapkan / ubah rute produksi", status: "SENGAJA_DIHENTIKAN", roles: [], api: "POST /units/:id/route", note: "rute otomatis dibuat saat layanan ditetapkan (provisioning); bila dibuka: UNIT_ROUTING_WRITE + hanya unit tanpa riwayat eksekusi (server sudah menolak 409) + konfirmasi" },
  { key: "scopeRevision", label: "Usul revisi lingkup (harga/layanan)", status: "SENGAJA_DIHENTIKAN", roles: [], api: "POST /scope-revisions (multipart)", note: "butuh foto bukti + nilai delta harga + keputusan Sales; ditunda ke slice terpisah (tetap bisa dibaca/diputuskan di Komplain & Revisi)" },
  { key: "adminBypass", label: "Bypass produksi admin", status: "SENGAJA_DIHENTIKAN", roles: [], api: "(engine adminBypassProduction)", note: "tidak pernah punya UI di halaman lama; tetap tidak dibuka" },
]);
