// Simplifikasi Production slice 3 — model murni Catatan Komponen (tanpa React): label, draf formulir <-> payload server, validasi ramah operator, fokus per tahap.
// Konstanta mengikuti backend/src/lib/domain/productionComponents.js (dijaga tes paritas). Server tetap otoritas validasi.
export const SECTIONS = Object.freeze([
  { key: "LAYERS_BEFORE", label: "Lapisan sebelum dibongkar", short: "Lapisan sebelum", phase: "BEFORE" },
  { key: "FOUNDATION_BEFORE", label: "Fondasi sebelum dibongkar", short: "Fondasi sebelum", phase: "BEFORE" },
  { key: "AFTER", label: "Sesudah pengerjaan", short: "Sesudah", phase: "AFTER" },
]);
export const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));
export const CONDITIONS = Object.freeze([
  { key: "BAIK", label: "Baik" }, { key: "CUKUP", label: "Cukup / masih layak" }, { key: "AUS", label: "Aus / menipis" }, { key: "KEMPES", label: "Kempes / amblas" },
  { key: "RUSAK", label: "Rusak" }, { key: "KOTOR", label: "Kotor / berjamur" }, { key: "TIDAK_DIKETAHUI", label: "Tidak diketahui" },
]);
export const FOUNDATION_SYSTEMS = Object.freeze([
  { key: "BONNELL", label: "Per bonnell" }, { key: "POCKET_SPRING", label: "Pocket spring" }, { key: "BUSA_FONDASI", label: "Busa fondasi" },
  { key: "PAPAN_KAYU", label: "Papan / rangka kayu" }, { key: "LAINNYA", label: "Lainnya" }, { key: "TIDAK_DIKETAHUI", label: "Tidak diketahui" },
]);
export const ACTIONS = Object.freeze([{ key: "KEEP", label: "Dipertahankan" }, { key: "REPAIR", label: "Diperbaiki" }, { key: "REPLACE", label: "Diganti" }]);
export const MANUAL_LABEL = "Bahan manual";
export const UNKNOWN_LABEL = "Tidak diketahui";
export const NOT_RECORDED = "Belum dicatat";
export const MAX_LAYERS = 12;
export const MAX_MEDIA = 8;
export const OUTCOME_LABEL = Object.freeze({ KEPT: "Tetap digunakan", REPAIRED: "Diperbaiki", REPLACED: "Diganti", UNRECORDED: NOT_RECORDED, NOT_IN_FINAL: "Tidak tercatat di hasil akhir" });

const labelOf = (list, key) => list.find((x) => x.key === key)?.label ?? null;
export const conditionLabel = (k) => labelOf(CONDITIONS, k);
export const systemLabel = (k) => labelOf(FOUNDATION_SYSTEMS, k);
export const actionLabel = (k) => labelOf(ACTIONS, k);

export function materialText(ref) {
  if (!ref) return null;
  if (ref.kind === "CATALOG") return ref.name ? `${ref.name}${ref.code ? ` (${ref.code})` : ""}` : (ref.code || "Bahan katalog");
  if (ref.kind === "MANUAL") return `${MANUAL_LABEL}: ${ref.text}`;
  return UNKNOWN_LABEL;
}

// Fokus per tahap (nomor tahap blueprint 1–12): bongkar/uji/diagnosis -> catat SEBELUM; pengerjaan pengganti & seterusnya -> catat SESUDAH. Tidak pernah menjadi syarat tahap.
export function focusFor(stepNo) {
  const n = Number(stepNo);
  if (!Number.isInteger(n) || n < 1) return [];
  if (n <= 5) return ["LAYERS_BEFORE", "FOUNDATION_BEFORE"];
  return ["AFTER"];
}
export function focusCopy(stepNo) {
  const f = focusFor(stepNo);
  if (!f.length) return null;
  return f[0] === "AFTER"
    ? { title: "Catat hasil pengerjaan", text: "Setelah lapisan/fondasi pengganti dikerjakan, catat apa yang dipertahankan, diperbaiki, atau diganti." }
    : { title: "Catat kondisi sebelum dibongkar", text: "Saat membongkar, catat lapisan dan fondasi lama (jenis, urutan, kondisi). Boleh “Tidak diketahui”." };
}

let seq = 0;
export const rowId = () => `r${Date.now().toString(36)}${++seq}`;
const toText = (v) => (v == null ? "" : String(v));
export const emptyLayerBefore = () => ({ id: rowId(), material: null, thickness: "", condition: "", note: "" });
export const emptyLayerAfter = () => ({ id: rowId(), action: "", fromOrder: "", material: null, thickness: "", note: "" });
const mediaItems = (media) => (media || []).map((m, i) => ({ id: `srv-${i}-${rowId()}`, kind: "image", status: "done", progress: 100, url: m.url, previewUrl: m.previewUrl || m.url, caption: m.caption || "" }));
const stripRef = (r) => (r ? (r.kind === "CATALOG" ? { kind: "CATALOG", materialId: r.materialId, code: r.code, name: r.name, unit: r.unit } : r.kind === "MANUAL" ? { kind: "MANUAL", text: r.text } : { kind: "UNKNOWN" }) : null);

/** Draf formulir dari entri server (atau kosong). */
export function draftFromEntry(section, entry, suggestions = null) {
  const d = entry?.data;
  if (section === "LAYERS_BEFORE") {
    return {
      layersUnknown: !!d?.layersUnknown, note: toText(d?.note), media: mediaItems(entry?.media), reason: "",
      layers: (d?.layers || []).map((l) => ({ id: rowId(), material: stripRef(l.material), thickness: toText(l.thicknessCm), condition: l.condition || "", note: toText(l.note) })),
    };
  }
  if (section === "FOUNDATION_BEFORE") {
    return { system: d?.system || "", material: stripRef(d?.material), condition: d?.condition || "", note: toText(d?.note), media: mediaItems(entry?.media), reason: "" };
  }
  const f = d?.foundation;
  return {
    foundationOn: d ? !!f : true, foundation: { action: f?.action || "", system: f?.system || "", material: stripRef(f?.material), note: toText(f?.note) },
    layers: (d?.layers || []).map((l) => ({ id: rowId(), action: l.action || "", fromOrder: toText(l.fromOrder), material: stripRef(l.material), thickness: toText(l.thicknessCm), note: toText(l.note) })),
    note: toText(d?.note), media: mediaItems(entry?.media), reason: "", suggestions,
  };
}

const num = (v) => { const t = toText(v).trim().replace(",", "."); return t === "" ? null : Number(t); };

/** Payload server dari draf (tanpa id UI). */
export function payloadFromDraft(section, draft) {
  const note = draft.note?.trim() || null;
  if (section === "LAYERS_BEFORE") {
    return {
      layersUnknown: !!draft.layersUnknown, note,
      layers: draft.layersUnknown ? [] : draft.layers.map((l) => ({ material: l.material, thicknessCm: num(l.thickness), condition: l.condition, note: l.note?.trim() || null })),
    };
  }
  if (section === "FOUNDATION_BEFORE") return { system: draft.system, material: draft.material || null, condition: draft.condition, note };
  return {
    foundation: draft.foundationOn ? { action: draft.foundation.action, system: draft.foundation.system || null, material: draft.foundation.material || null, note: draft.foundation.note?.trim() || null } : null,
    layers: draft.layers.map((l) => ({ action: l.action, fromOrder: l.fromOrder === "" ? null : Number(l.fromOrder), material: l.material || null, thicknessCm: num(l.thickness), note: l.note?.trim() || null })),
    note,
  };
}
export const mediaPayload = (draft) => (draft.media || []).filter((m) => m.status === "done").map((m) => ({ url: m.url, caption: m.caption?.trim() || null }));
export const hasPendingUploads = (draft) => (draft.media || []).some((m) => m.status === "uploading");

const materialOk = (m) => !!m && (m.kind === "UNKNOWN" || (m.kind === "MANUAL" && (m.text || "").trim().length >= 2) || (m.kind === "CATALOG" && !!m.materialId));
const thicknessOk = (v) => { const n = num(v); return n === null || (Number.isFinite(n) && n > 0 && n <= 100); };

/** Pesan galat pertama yang mudah dipahami, atau null. Mengikuti aturan server (layanan memvalidasi ulang). */
export function validateDraft(section, draft, { correcting = false } = {}) {
  if (correcting && (draft.reason || "").trim().length < 3) return "Tulis alasan koreksi (minimal 3 huruf).";
  if (section === "LAYERS_BEFORE") {
    if (draft.layersUnknown) return null;
    if (!draft.layers.length) return "Tambahkan minimal satu lapisan, atau pilih “Lapisan tidak diketahui”.";
    for (const [i, l] of draft.layers.entries()) {
      if (!materialOk(l.material)) return `Lapisan ${i + 1}: pilih bahan, ketik “${MANUAL_LABEL}”, atau pilih “${UNKNOWN_LABEL}”.`;
      if (!l.condition) return `Lapisan ${i + 1}: pilih kondisi (boleh “${UNKNOWN_LABEL}”).`;
      if (!thicknessOk(l.thickness)) return `Lapisan ${i + 1}: ketebalan harus angka 0–100 cm atau dikosongkan.`;
    }
    return null;
  }
  if (section === "FOUNDATION_BEFORE") {
    if (!draft.system) return `Pilih jenis/sistem fondasi (boleh “${UNKNOWN_LABEL}”).`;
    if (!draft.condition) return `Pilih kondisi fondasi (boleh “${UNKNOWN_LABEL}”).`;
    if (draft.material && !materialOk(draft.material)) return "Lengkapi bahan fondasi atau kosongkan.";
    return null;
  }
  if (!draft.foundationOn && !draft.layers.length) return "Isi fondasi atau minimal satu lapisan hasil akhir.";
  if (draft.foundationOn) {
    if (!draft.foundation.action) return "Fondasi: pilih dipertahankan / diperbaiki / diganti.";
    if (draft.foundation.action === "REPLACE" && !draft.foundation.system) return `Fondasi diganti: pilih jenis fondasi baru (boleh “${UNKNOWN_LABEL}”).`;
    if (draft.foundation.material && !materialOk(draft.foundation.material)) return "Lengkapi bahan fondasi atau kosongkan.";
  }
  for (const [i, l] of draft.layers.entries()) {
    if (!l.action) return `Lapisan ${i + 1}: pilih dipertahankan / diperbaiki / diganti.`;
    if (l.action !== "KEEP" && !materialOk(l.material)) return `Lapisan ${i + 1}: pilih bahan, “${MANUAL_LABEL}”, atau “${UNKNOWN_LABEL}”.`;
    if (l.material && !materialOk(l.material)) return `Lapisan ${i + 1}: lengkapi bahan atau kosongkan.`;
    if (!thicknessOk(l.thickness)) return `Lapisan ${i + 1}: ketebalan harus angka 0–100 cm atau dikosongkan.`;
  }
  return null;
}

/** Saran "AFTER" dari bahan terpakai (read-only dari server) -> baris lapisan/fondasi baru bertanda diganti. Hanya mengisi formulir; belum tersimpan. */
export function applySuggestions(draft, suggestions) {
  if (!suggestions) return draft;
  const next = { ...draft, layers: [...draft.layers] };
  if (suggestions.foundation?.length && !draft.foundation.material) next.foundation = { ...draft.foundation, action: draft.foundation.action || "REPLACE", system: draft.foundation.system || "TIDAK_DIKETAHUI", material: stripRef(suggestions.foundation[0]) };
  if (!draft.layers.length) for (const m of suggestions.layers || []) next.layers.push({ ...emptyLayerAfter(), action: "REPLACE", material: stripRef(m) });
  return next;
}

export const sectionStatusText = (entry) => (entry ? `Versi ${entry.version}${entry.actor?.name ? ` · ${entry.actor.name}` : ""}` : NOT_RECORDED);
export function fmtStamp(iso) {
  if (!iso) return "";
  try { return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(iso)); } catch { return ""; }
}
export function friendlyComponentError(e) {
  if (e?.code === "COMPONENT_VERSION_CONFLICT") return "Catatan ini sudah diubah orang lain. Muat ulang untuk melihat versi terbaru sebelum menyimpan.";
  if (e?.code === "DEMO_READ_ONLY") return e.message;
  return e?.message || "Catatan komponen gagal disimpan. Coba lagi.";
}
