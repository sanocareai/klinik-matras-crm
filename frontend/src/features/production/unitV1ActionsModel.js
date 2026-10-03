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
