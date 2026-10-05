// Simplifikasi Production slice 3 — Catatan Komponen kanonis per unit (Sebelum -> Sesudah). Modul MURNI (tanpa DB): definisi seksi, validasi + normalisasi
// payload, dan pembangun perbandingan. Catatan komponen adalah INFORMASI/dokumentasi: bukan BOM, bukan pemakaian, bukan retur, tidak memotong stok
// (lihat productionComponentNoteService.js). Bahan boleh ditautkan ke katalog resmi (materialId), diketik manual (label "Bahan manual"), atau "Tidak diketahui".
export const COMPONENT_SECTIONS = Object.freeze({
  LAYERS_BEFORE: { key: "LAYERS_BEFORE", label: "Lapisan sebelum dibongkar", phase: "BEFORE" },
  FOUNDATION_BEFORE: { key: "FOUNDATION_BEFORE", label: "Fondasi sebelum dibongkar", phase: "BEFORE" },
  AFTER: { key: "AFTER", label: "Sesudah pengerjaan", phase: "AFTER" },
});
export const COMPONENT_SECTION_KEYS = Object.freeze(Object.keys(COMPONENT_SECTIONS));

export const CONDITIONS = Object.freeze([
  { key: "BAIK", label: "Baik" }, { key: "CUKUP", label: "Cukup / masih layak" }, { key: "AUS", label: "Aus / menipis" }, { key: "KEMPES", label: "Kempes / amblas" },
  { key: "RUSAK", label: "Rusak" }, { key: "KOTOR", label: "Kotor / berjamur" }, { key: "TIDAK_DIKETAHUI", label: "Tidak diketahui" },
]);
export const FOUNDATION_SYSTEMS = Object.freeze([
  { key: "BONNELL", label: "Per bonnell" }, { key: "POCKET_SPRING", label: "Pocket spring" }, { key: "BUSA_FONDASI", label: "Busa fondasi" },
  { key: "PAPAN_KAYU", label: "Papan / rangka kayu" }, { key: "LAINNYA", label: "Lainnya" }, { key: "TIDAK_DIKETAHUI", label: "Tidak diketahui" },
]);
export const COMPONENT_ACTIONS = Object.freeze([
  { key: "KEEP", label: "Dipertahankan" }, { key: "REPAIR", label: "Diperbaiki" }, { key: "REPLACE", label: "Diganti" },
]);
export const MATERIAL_KINDS = Object.freeze({ CATALOG: "CATALOG", MANUAL: "MANUAL", UNKNOWN: "UNKNOWN" });
export const MANUAL_MATERIAL_LABEL = "Bahan manual";
export const UNKNOWN_LABEL = "Tidak diketahui";
export const NOT_RECORDED_LABEL = "Belum dicatat";

export const LIMITS = Object.freeze({ MAX_LAYERS: 12, NOTE: 500, ITEM_NOTE: 300, MANUAL_TEXT: 120, MAX_MEDIA: 8, CAPTION: 200, REASON_MIN: 3, REASON_MAX: 300, MAX_THICKNESS_CM: 100 });

const COND_BY_KEY = Object.fromEntries(CONDITIONS.map((c) => [c.key, c]));
const SYS_BY_KEY = Object.fromEntries(FOUNDATION_SYSTEMS.map((c) => [c.key, c]));
const ACT_BY_KEY = Object.fromEntries(COMPONENT_ACTIONS.map((c) => [c.key, c]));
export const conditionLabel = (k) => COND_BY_KEY[k]?.label ?? null;
export const systemLabel = (k) => SYS_BY_KEY[k]?.label ?? null;
export const actionLabel = (k) => ACT_BY_KEY[k]?.label ?? null;

export function componentError(message, statusCode = 400, code = "COMPONENT_INVALID", details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}
const bad = (message, code = "COMPONENT_INVALID") => componentError(message, 422, code);
const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const cleanText = (v, max, field) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") throw bad(`${field} harus berupa teks`);
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) throw bad(`${field} terlalu panjang (maksimal ${max} karakter)`, "COMPONENT_TEXT_TOO_LONG");
  return t;
};

// ---- bahan -----------------------------------------------------------------------------------------------------------------
// Klien hanya mengirim {kind, materialId} / {kind, text} / {kind}; snapshot katalog (kode, nama, satuan) DIISI server saat tulis.
export function normalizeMaterialRef(raw, { field, required = true } = {}) {
  if (raw == null) {
    if (required) throw bad(`${field}: pilih bahan, ketik “${MANUAL_MATERIAL_LABEL}”, atau pilih “${UNKNOWN_LABEL}”`, "COMPONENT_MATERIAL_REQUIRED");
    return null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) throw bad(`${field}: bahan tidak valid`);
  if (raw.kind === MATERIAL_KINDS.UNKNOWN) return { kind: MATERIAL_KINDS.UNKNOWN };
  if (raw.kind === MATERIAL_KINDS.MANUAL) {
    const text = cleanText(raw.text, LIMITS.MANUAL_TEXT, `${field}: ${MANUAL_MATERIAL_LABEL}`);
    if (!text || text.length < 2) throw bad(`${field}: tulis nama ${MANUAL_MATERIAL_LABEL.toLowerCase()} (minimal 2 huruf)`, "COMPONENT_MANUAL_TEXT_REQUIRED");
    return { kind: MATERIAL_KINDS.MANUAL, text };
  }
  if (raw.kind === MATERIAL_KINDS.CATALOG) {
    if (!isUuid(raw.materialId)) throw bad(`${field}: bahan katalog tidak valid`, "COMPONENT_MATERIAL_INVALID");
    return { kind: MATERIAL_KINDS.CATALOG, materialId: raw.materialId.toLowerCase() };
  }
  throw bad(`${field}: jenis bahan tidak dikenal`, "COMPONENT_MATERIAL_KIND_INVALID");
}

export function materialLabel(ref) {
  if (!ref) return null;
  if (ref.kind === MATERIAL_KINDS.CATALOG) return ref.name ? `${ref.name}${ref.code ? ` (${ref.code})` : ""}` : (ref.code || "Bahan katalog");
  if (ref.kind === MATERIAL_KINDS.MANUAL) return `${MANUAL_MATERIAL_LABEL}: ${ref.text}`;
  return UNKNOWN_LABEL;
}

function normalizeThickness(v, field) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > LIMITS.MAX_THICKNESS_CM) throw bad(`${field}: ketebalan harus angka 0–${LIMITS.MAX_THICKNESS_CM} cm (kosongkan bila tidak diketahui)`, "COMPONENT_THICKNESS_INVALID");
  return Math.round(n * 100) / 100;
}
function normalizeCondition(v, field) {
  if (!COND_BY_KEY[v]) throw bad(`${field}: pilih kondisi (atau “${UNKNOWN_LABEL}”)`, "COMPONENT_CONDITION_REQUIRED");
  return v;
}
function normalizeAction(v, field) {
  if (!ACT_BY_KEY[v]) throw bad(`${field}: pilih dipertahankan / diperbaiki / diganti`, "COMPONENT_ACTION_REQUIRED");
  return v;
}
function normalizeSystem(v, field, { required }) {
  if (v == null || v === "") { if (required) throw bad(`${field}: pilih jenis/sistem fondasi (atau “${UNKNOWN_LABEL}”)`, "COMPONENT_SYSTEM_REQUIRED"); return null; }
  if (!SYS_BY_KEY[v]) throw bad(`${field}: jenis fondasi tidak dikenal`, "COMPONENT_SYSTEM_INVALID");
  return v;
}

// ---- normalisasi per seksi (hasil = bentuk kanonis; urutan kunci tetap -> JSON stabil untuk hash/replay) -----------------------------------
export function normalizeSectionData(section, data) {
  if (!COMPONENT_SECTIONS[section]) throw componentError("Seksi catatan komponen tidak dikenal", 400, "COMPONENT_SECTION_INVALID");
  if (data == null || typeof data !== "object" || Array.isArray(data)) throw bad("Isi catatan komponen tidak valid");
  const note = cleanText(data.note, LIMITS.NOTE, "Catatan");
  if (section === "LAYERS_BEFORE") {
    const layersUnknown = data.layersUnknown === true;
    const rows = data.layers == null ? [] : data.layers;
    if (!Array.isArray(rows)) throw bad("Daftar lapisan tidak valid");
    if (rows.length > LIMITS.MAX_LAYERS) throw bad(`Maksimal ${LIMITS.MAX_LAYERS} lapisan`, "COMPONENT_TOO_MANY_LAYERS");
    if (layersUnknown && rows.length) throw bad("Pilih “lapisan tidak diketahui” ATAU isi daftar lapisan, tidak keduanya");
    if (!layersUnknown && rows.length === 0) throw bad("Tambahkan minimal satu lapisan, atau tandai “lapisan tidak diketahui”", "COMPONENT_LAYERS_REQUIRED");
    return {
      layersUnknown,
      layers: rows.map((r, i) => {
        const f = `Lapisan ${i + 1}`;
        if (r == null || typeof r !== "object") throw bad(`${f}: tidak valid`);
        return {
          material: normalizeMaterialRef(r.material, { field: f }), thicknessCm: normalizeThickness(r.thicknessCm, f),
          condition: normalizeCondition(r.condition, f), note: cleanText(r.note, LIMITS.ITEM_NOTE, `${f}: catatan`),
        };
      }),
      note,
    };
  }
  if (section === "FOUNDATION_BEFORE") {
    return {
      system: normalizeSystem(data.system, "Fondasi", { required: true }),
      material: normalizeMaterialRef(data.material, { field: "Fondasi", required: false }),
      condition: normalizeCondition(data.condition, "Fondasi"), note,
    };
  }
  // AFTER
  const f = data.foundation;
  let foundation = null;
  if (f != null) {
    if (typeof f !== "object" || Array.isArray(f)) throw bad("Fondasi sesudah tidak valid");
    const action = normalizeAction(f.action, "Fondasi");
    foundation = {
      action, system: normalizeSystem(f.system, "Fondasi", { required: action === "REPLACE" }),
      material: normalizeMaterialRef(f.material, { field: "Fondasi", required: false }), note: cleanText(f.note, LIMITS.ITEM_NOTE, "Fondasi: catatan"),
    };
  }
  const rows = data.layers == null ? [] : data.layers;
  if (!Array.isArray(rows)) throw bad("Daftar lapisan tidak valid");
  if (rows.length > LIMITS.MAX_LAYERS) throw bad(`Maksimal ${LIMITS.MAX_LAYERS} lapisan`, "COMPONENT_TOO_MANY_LAYERS");
  if (!foundation && rows.length === 0) throw bad("Isi minimal fondasi atau satu lapisan hasil akhir", "COMPONENT_AFTER_EMPTY");
  const layers = rows.map((r, i) => {
    const fld = `Lapisan ${i + 1}`;
    if (r == null || typeof r !== "object") throw bad(`${fld}: tidak valid`);
    const action = normalizeAction(r.action, fld);
    let fromOrder = null;
    if (r.fromOrder != null && r.fromOrder !== "") {
      const n = Number(r.fromOrder);
      if (!Number.isInteger(n) || n < 1 || n > LIMITS.MAX_LAYERS) throw bad(`${fld}: urutan lapisan lama tidak valid`);
      fromOrder = n;
    }
    return {
      action, fromOrder, material: normalizeMaterialRef(r.material, { field: fld, required: action !== "KEEP" }),
      thicknessCm: normalizeThickness(r.thicknessCm, fld), note: cleanText(r.note, LIMITS.ITEM_NOTE, `${fld}: catatan`),
    };
  });
  return { foundation, layers, note };
}

export function normalizeMediaItems(items, { kindOf }) {
  if (items == null) return [];
  if (!Array.isArray(items)) throw bad("Daftar foto tidak valid", "COMPONENT_MEDIA_INVALID");
  if (items.length > LIMITS.MAX_MEDIA) throw bad(`Maksimal ${LIMITS.MAX_MEDIA} foto per catatan`, "COMPONENT_TOO_MANY_MEDIA");
  const seen = new Set();
  return items.map((it, i) => {
    const url = typeof it === "string" ? it : it?.url;
    if (typeof url !== "string" || kindOf(url) !== "image") throw bad("Foto tidak valid — unggah ulang dari aplikasi", "COMPONENT_MEDIA_INVALID");
    if (seen.has(url)) throw bad("Foto yang sama dikirim dua kali", "COMPONENT_MEDIA_DUPLICATE");
    seen.add(url);
    return { url, kind: "image", caption: cleanText(typeof it === "object" ? it.caption : null, LIMITS.CAPTION, "Keterangan foto"), order: i + 1 };
  });
}

// ---- perbandingan Sebelum -> Sesudah ----------------------------------------------------------------------------------------
const layerView = (l) => (l ? { material: materialLabel(l.material), thicknessCm: l.thicknessCm ?? null, condition: l.condition, conditionLabel: conditionLabel(l.condition), note: l.note ?? null } : null);

/** @param {{layersBefore?:object|null, foundationBefore?:object|null, after?:object|null}} entries  entri = { data, version, media } atau null (belum dicatat) */
export function buildComparison({ layersBefore = null, foundationBefore = null, after = null } = {}) {
  const status = { layersBefore: !!layersBefore, foundationBefore: !!foundationBefore, after: !!after };
  const gaps = [];
  if (!layersBefore) gaps.push({ section: "LAYERS_BEFORE", text: `${COMPONENT_SECTIONS.LAYERS_BEFORE.label} ${NOT_RECORDED_LABEL.toLowerCase()}` });
  if (!foundationBefore) gaps.push({ section: "FOUNDATION_BEFORE", text: `${COMPONENT_SECTIONS.FOUNDATION_BEFORE.label} ${NOT_RECORDED_LABEL.toLowerCase()}` });
  if (!after) gaps.push({ section: "AFTER", text: `${COMPONENT_SECTIONS.AFTER.label} ${NOT_RECORDED_LABEL.toLowerCase()}` });

  const bLayers = layersBefore?.data?.layers ?? [];
  const aLayers = after?.data?.layers ?? [];
  const layers = [];
  const kept = [];
  const used = new Set();
  const finalLayers = [];
  const finalOf = (a, b) => {
    // komponen hasil akhir satu lapisan
    if (a.action === "KEEP") return { label: b ? materialLabel(b.material) : "Dipertahankan (bahan lama belum dicatat)", thicknessCm: a.thicknessCm ?? b?.thicknessCm ?? null, source: "KEPT" };
    if (a.action === "REPAIR") return { label: a.material ? materialLabel(a.material) : (b ? `${materialLabel(b.material)} (diperbaiki)` : "Diperbaiki (bahan belum dicatat)"), thicknessCm: a.thicknessCm ?? b?.thicknessCm ?? null, source: "REPAIRED" };
    return { label: materialLabel(a.material), thicknessCm: a.thicknessCm ?? null, source: "NEW" };
  };
  if (after) {
    aLayers.forEach((a, i) => {
      const order = i + 1; const bi = (a.fromOrder ?? order) - 1; const b = bLayers[bi] ?? null;
      if (b) used.add(bi);
      const fin = finalOf(a, b);
      layers.push({ order, before: layerView(b), beforeRecorded: !!layersBefore, action: a.action, actionLabel: actionLabel(a.action), afterNote: a.note ?? null, final: fin, outcome: a.action === "KEEP" ? "KEPT" : a.action === "REPAIR" ? "REPAIRED" : "REPLACED" });
      finalLayers.push(fin.label);
      if (a.action === "KEEP") kept.push(`Lapisan ${order}: ${fin.label}`);
    });
    bLayers.forEach((b, bi) => {
      if (used.has(bi)) return;
      layers.push({ order: layers.length + 1, before: layerView(b), beforeRecorded: true, action: null, actionLabel: null, afterNote: null, final: null, outcome: "NOT_IN_FINAL" });
    });
  } else {
    bLayers.forEach((b, bi) => layers.push({ order: bi + 1, before: layerView(b), beforeRecorded: true, action: null, actionLabel: null, afterNote: null, final: null, outcome: "UNRECORDED" }));
  }

  const fb = foundationBefore?.data ?? null;
  const fa = after?.data?.foundation ?? null;
  let foundation = null;
  if (fb || fa) {
    const beforeView = fb ? { system: fb.system, systemLabel: systemLabel(fb.system), material: materialLabel(fb.material), condition: fb.condition, conditionLabel: conditionLabel(fb.condition), note: fb.note ?? null } : null;
    let final = null; let outcome = "UNRECORDED";
    if (fa) {
      outcome = fa.action === "KEEP" ? "KEPT" : fa.action === "REPAIR" ? "REPAIRED" : "REPLACED";
      const sysTxt = fa.system && fa.system !== "TIDAK_DIKETAHUI" ? systemLabel(fa.system) : null; // sistem “Tidak diketahui” tidak dicetak bila bahan sudah jelas
      const baseBefore = beforeView ? [beforeView.system === "TIDAK_DIKETAHUI" ? null : beforeView.systemLabel, beforeView.material].filter(Boolean).join(" · ") || beforeView.systemLabel : null;
      if (fa.action === "KEEP") final = { label: baseBefore || "Dipertahankan (fondasi lama belum dicatat)", source: "KEPT" };
      else if (fa.action === "REPAIR") final = { label: [sysTxt, materialLabel(fa.material)].filter(Boolean).join(" · ") || (baseBefore ? `${baseBefore} (diperbaiki)` : "Diperbaiki (belum dicatat)"), source: "REPAIRED" };
      else final = { label: [sysTxt, materialLabel(fa.material)].filter(Boolean).join(" · ") || UNKNOWN_LABEL, source: "NEW" };
      if (fa.action === "KEEP") kept.push(`Fondasi: ${final.label}`);
    }
    foundation = { before: beforeView, beforeRecorded: !!foundationBefore, action: fa?.action ?? null, actionLabel: fa ? actionLabel(fa.action) : null, afterNote: fa?.note ?? null, final, outcome };
  }
  const recordedAny = status.layersBefore || status.foundationBefore || status.after;
  return { status, recordedAny, complete: status.layersBefore && status.foundationBefore && status.after, gaps, foundation, layers, kept, final: { foundation: foundation?.final?.label ?? null, layers: finalLayers } };
}
