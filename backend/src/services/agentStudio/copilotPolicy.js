// ─── AI STUDIO — ATURAN COPILOT (MURNI) ─────────────────────────────────────
// Siapa boleh memakai copilot, batas pemakaian, dan validasi input dari sales.
// Lihat docs/AI-STUDIO-MVP2-COPILOT.md §6–§7 & §12.

export const PERAN_PILOT = ["ADMIN", "OWNER"]; // Tahap A
export const OUTCOME_AKHIR = ["USED_AS_IS", "USED_EDITED", "IGNORED"];
export const ALASAN_ABAIKAN = ["SALAH_INFO", "TERLALU_PANJANG", "TIDAK_NATURAL", "SALAH_TAHAP", "LAINNYA"];
export const BATAS_DRAFT_PER_JAM = 30;
export const BATAS_HARIAN_USD = () => Number(process.env.STUDIO_COPILOT_DAILY_USD || 3);

// Pilot: role ADMIN/OWNER, atau id user ada di StudioAgent.config.copilotUsers (Tahap B).
export function bolehCopilot(roles = [], userId, config = {}) {
  if (roles.some((r) => PERAN_PILOT.includes(r))) return true;
  const daftar = Array.isArray(config?.copilotUsers) ? config.copilotUsers : [];
  return !!userId && daftar.includes(userId);
}

// Hanya chat INDIVIDUAL customer — bukan grup, bukan Kontak Tim.
export function alasanPercakapanDitolak(conv) {
  if (!conv) return "Percakapan tidak ditemukan";
  if (conv.type !== "INDIVIDUAL") return "Copilot hanya untuk chat customer, bukan grup";
  if (!conv.customer) return "Percakapan belum terhubung ke customer";
  if (conv.customer.isInternalStaff) return "Copilot tidak dipakai untuk Kontak Tim";
  return null;
}

// { outcome, ignoreReason?, sentText? } → data update, atau { error }.
export function validasiOutcome(body = {}) {
  const outcome = body.outcome;
  if (!OUTCOME_AKHIR.includes(outcome)) return { error: `outcome harus salah satu dari ${OUTCOME_AKHIR.join(", ")}` };
  const sentText = typeof body.sentText === "string" ? body.sentText.trim().slice(0, 4000) : "";
  if (outcome !== "IGNORED" && !sentText) return { error: "sentText wajib diisi bila draft dipakai" };
  const ignoreReason = outcome === "IGNORED" && ALASAN_ABAIKAN.includes(body.ignoreReason) ? body.ignoreReason : null;
  return { data: { outcome, ignoreReason, sentText: sentText || null, outcomeAt: new Date() } };
}

// Tag keluhan → slug pendek konsisten dengan tag lain di CRM ("sakit-pinggang").
export function slugTag(teks = "") {
  return String(teks)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40)
    .replace(/^-|-$/g, "");
}

// Hanya 3 field: city, tag (append ke Customer.tags), note. Field lain DITOLAK
// (khususnya pipelineStage — tetap keputusan sales). → { data } | { error }.
const FIELD_CRM = ["city", "tag", "note"];
export function validasiCrm(body = {}, customerTags = []) {
  const asing = Object.keys(body || {}).filter((k) => !FIELD_CRM.includes(k));
  if (asing.length) return { error: `Field tidak boleh disimpan dari copilot: ${asing.join(", ")}` };
  const city = typeof body.city === "string" ? body.city.trim().slice(0, 80) : "";
  const tag = typeof body.tag === "string" ? slugTag(body.tag) : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (!city && !tag && !note) return { error: "Tidak ada data untuk disimpan" };

  const customer = {};
  if (city) customer.city = city;
  if (tag && !customerTags.includes(tag)) customer.tags = [...customerTags, tag];
  return { data: { customer, note: note || null, disimpan: { ...(city && { city }), ...(tag && { tag }), ...(note && { note }) } } };
}

// Ringkasan pemakaian dari baris draft (untuk GET /copilot/stats).
export function ringkasStats(drafts = [], namaUser = {}) {
  const kosong = () => ({ total: 0, USED_AS_IS: 0, USED_EDITED: 0, IGNORED: 0, SHOWN: 0, costUsd: 0 });
  const total = kosong();
  const perSales = {};
  for (const d of drafts) {
    for (const t of [total, (perSales[d.salesUserId] ||= kosong())]) {
      t.total++;
      t[d.outcome] = (t[d.outcome] || 0) + 1;
      t.costUsd += d.costUsd || 0;
    }
  }
  const persen = (t) => {
    const diputuskan = t.USED_AS_IS + t.USED_EDITED + t.IGNORED;
    return { ...t, persenDipakai: diputuskan ? Math.round(((t.USED_AS_IS + t.USED_EDITED) / diputuskan) * 100) : null };
  };
  return {
    total: persen(total),
    perSales: Object.entries(perSales)
      .map(([id, t]) => ({ salesUserId: id, nama: namaUser[id] || "—", ...persen(t) }))
      .sort((a, b) => b.total - a.total),
  };
}
