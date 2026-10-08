// Simplifikasi Production slice 3 — Catatan Komponen kanonis per unit (Sebelum -> Sesudah). Modul MURNI (tanpa DB): definisi seksi, validasi + normalisasi
// payload, dan pembangun perbandingan. Catatan komponen adalah INFORMASI/dokumentasi: bukan BOM, bukan pemakaian, bukan retur, tidak memotong stok
// (lihat productionComponentNoteService.js). Bahan boleh ditautkan ke katalog resmi (materialId), diketik manual (label "Bahan manual"), atau "Tidak diketahui".
// Fase 2 Produksi LAYANAN (QC sebelum bongkar): dua seksi PENGUJIAN ditambahkan — hasil uji TERPISAH dari catatan komponen:
//   WHOLE_TEST_BEFORE      = uji KASUR UTUH sebelum bongkar (PIC QC): kesesuaian keluhan, feel awal, berat penguji aktual, titik/metode, penurunan kasur utuh (cm)
//   FOUNDATION_TEST_BEFORE = uji FONDASI awal (PIC QC): sistem fondasi, tinggi tanpa beban/dibebani, berat penguji aktual, titik/metode; penurunan dihitung SERVER
// Fase 3 Produksi LAYANAN (analisis & racikan): seksi RENCANA ditambahkan —
//   PLAN_RACIKAN = racikan fondasi + lapisan hasil yang DIRENCANAKAN PIC Meja / PIC QC (dipertahankan / diperbaiki / diganti; lapisan ATAS -> BAWAH; ketebalan tiap lapisan + total tinggi).
//   Bentuknya sama dengan AFTER (hasil AKTUAL) sehingga rencana vs aktual dapat dibandingkan tanpa salinan paralel; rencana TIDAK memotong stok, tidak membuat BOM, tidak menggantikan pemakaian aktual.
// Tiga pengukuran (kasur utuh / lapisan / fondasi) tidak pernah dijumlahkan (menghitung dua kali) dan tidak otomatis menetapkan kategori "amblas".
export const COMPONENT_SECTIONS = Object.freeze({
  LAYERS_BEFORE: { key: "LAYERS_BEFORE", label: "Lapisan sebelum dibongkar", phase: "BEFORE" },
  FOUNDATION_BEFORE: { key: "FOUNDATION_BEFORE", label: "Fondasi sebelum dibongkar", phase: "BEFORE" },
  AFTER: { key: "AFTER", label: "Sesudah pengerjaan", phase: "AFTER" },
  WHOLE_TEST_BEFORE: { key: "WHOLE_TEST_BEFORE", label: "QC sebelum bongkar (uji kasur utuh)", phase: "BEFORE", qc: true, minMedia: 1 },
  FOUNDATION_TEST_BEFORE: { key: "FOUNDATION_TEST_BEFORE", label: "Uji fondasi awal", phase: "BEFORE", qc: true, minMedia: 1 },
  // Fase 4 (LAYANAN, perakitan -> uji hasil): pengujian SETELAH perbaikan ditulis PIC QC (pola sama dengan uji awal Fase 2). Pengukuran tidak pernah dijumlahkan; perbandingan dengan uji awal HANYA bila sebanding.
  FOUNDATION_TEST_AFTER: { key: "FOUNDATION_TEST_AFTER", label: "Uji fondasi baru", phase: "AFTER", qc: true, minMedia: 1 },
  WHOLE_TEST_AFTER: { key: "WHOLE_TEST_AFTER", label: "Uji kasur jadi", phase: "AFTER", qc: true, minMedia: 1 },
  PLAN_RACIKAN: { key: "PLAN_RACIKAN", label: "Racikan rencana", phase: "PLAN" },
});
// Seksi PENGUJIAN: hanya pemegang izin QC (PIC QC) yang boleh menulis — ditegakkan di route (bukan penugasan Meja).
export const QC_SECTION_KEYS = Object.freeze(Object.keys(COMPONENT_SECTIONS).filter((k) => COMPONENT_SECTIONS[k].qc));
export const isQcSection = (key) => QC_SECTION_KEYS.includes(key);
export const COMPONENT_SECTION_KEYS = Object.freeze(Object.keys(COMPONENT_SECTIONS));

export const CONDITIONS = Object.freeze([
  { key: "BAIK", label: "Baik" }, { key: "CUKUP", label: "Cukup / masih layak" }, { key: "AUS", label: "Aus / menipis" }, { key: "KEMPES", label: "Kempes / amblas" },
  { key: "RUSAK", label: "Rusak" }, { key: "KOTOR", label: "Kotor / berjamur" }, { key: "TIDAK_DIKETAHUI", label: "Tidak diketahui" },
]);
export const FOUNDATION_SYSTEMS = Object.freeze([
  { key: "BONNELL", label: "Per bonnell" }, { key: "POCKET_SPRING", label: "Pocket spring" }, { key: "BUSA_FONDASI", label: "Busa fondasi" },
  { key: "PAPAN_KAYU", label: "Papan / rangka kayu" }, { key: "LAINNYA", label: "Lainnya" }, { key: "TIDAK_DIKETAHUI", label: "Tidak diketahui" },
]);
export const COMPLAINT_MATCHES = Object.freeze([
  { key: "SESUAI", label: "Sesuai keluhan" }, { key: "SEBAGIAN", label: "Sebagian sesuai" }, { key: "TIDAK_SESUAI", label: "Tidak sesuai keluhan" }, { key: "TIDAK_DAPAT_DINILAI", label: "Tidak dapat dinilai" },
]);
export const COMPONENT_ACTIONS = Object.freeze([
  { key: "KEEP", label: "Dipertahankan" }, { key: "REPAIR", label: "Diperbaiki" }, { key: "REPLACE", label: "Diganti" },
]);
export const MATERIAL_KINDS = Object.freeze({ CATALOG: "CATALOG", MANUAL: "MANUAL", UNKNOWN: "UNKNOWN" });
export const MANUAL_MATERIAL_LABEL = "Bahan manual";
export const UNKNOWN_LABEL = "Tidak diketahui";
export const NOT_RECORDED_LABEL = "Belum dicatat";

export const LIMITS = Object.freeze({ MAX_LAYERS: 12, NOTE: 500, ITEM_NOTE: 300, MANUAL_TEXT: 120, MAX_MEDIA: 8, MAX_MEDIA_QC: 12, MAX_MEDIA_LAYERS: 24, CAPTION: 200, REASON_MIN: 3, REASON_MAX: 300, MAX_THICKNESS_CM: 100, MAX_WEIGHT_KG: 300, TEST_TEXT: 200 });
// Batas foto/video per seksi (seksi lama tetap 8).
export const maxMediaFor = (section) => (section === "LAYERS_BEFORE" ? LIMITS.MAX_MEDIA_LAYERS : isQcSection(section) ? LIMITS.MAX_MEDIA_QC : LIMITS.MAX_MEDIA);

const COND_BY_KEY = Object.fromEntries(CONDITIONS.map((c) => [c.key, c]));
const SYS_BY_KEY = Object.fromEntries(FOUNDATION_SYSTEMS.map((c) => [c.key, c]));
const ACT_BY_KEY = Object.fromEntries(COMPONENT_ACTIONS.map((c) => [c.key, c]));
const MATCH_BY_KEY = Object.fromEntries(COMPLAINT_MATCHES.map((c) => [c.key, c]));
export const complaintMatchLabel = (k) => MATCH_BY_KEY[k]?.label ?? null;
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

// Atribut bahan yang BENAR-BENAR tersedia (snapshot katalog saat dicatat). Nilai kosong tidak ditampilkan dan tidak dikarang; Densitas & ketebalan katalog (Material.density/thicknessCm, opsional)
// hanya muncul bila master memilikinya — kosong tidak ditampilkan dan tidak dikarang. Bahan manual / tidak diketahui tetap sah dan ditandai apa adanya.
export function materialAttributes(ref) {
  if (!ref) return [];
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
  if (ref.kind === MATERIAL_KINDS.CATALOG) {
    return [["code", "Kode", ref.code], ["name", "Nama", ref.name], ["unit", "Satuan", ref.unit], ["supplier", "Supplier", ref.supplier], ["itemGroup", "Kelompok", ref.itemGroup],
      ["density", "Densitas", ref.density], ["thicknessCm", "Ketebalan katalog (cm)", ref.thicknessCm]].filter(([, , v]) => has(v)).map(([key, label, value]) => ({ key, label, value: String(value) }));
  }
  if (ref.kind === MATERIAL_KINDS.MANUAL) return [{ key: "manual", label: MANUAL_MATERIAL_LABEL, value: ref.text }, { key: "catalog", label: "Katalog", value: "Belum terhubung katalog" }];
  return [{ key: "unknown", label: "Bahan", value: UNKNOWN_LABEL }];
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
  if (section === "WHOLE_TEST_BEFORE") return normalizeWholeTest(data, note);
  if (section === "FOUNDATION_TEST_BEFORE") return normalizeFoundationTest(data, note);
  // Fase 4: uji SETELAH perbaikan = bentuk yang sama + penanda QC "titik & metode sama dengan uji awal" (dasar kesebandingan; bukan tebakan dari teks bebas).
  if (section === "WHOLE_TEST_AFTER") return { ...normalizeWholeTest(data, note), sameMethodAsBefore: data.sameMethodAsBefore === true };
  if (section === "FOUNDATION_TEST_AFTER") return { ...normalizeFoundationTest(data, note), sameMethodAsBefore: data.sameMethodAsBefore === true };
  // AFTER (hasil aktual) dan PLAN_RACIKAN (rencana) berbentuk sama — satu normalizer, tanpa salinan paralel.
  return normalizeResultShape(data, note, { planned: section === "PLAN_RACIKAN" });
}

function normalizeResultShape(data, note, { planned }) {
  const word = planned ? "rencana" : "sesudah";
  const f = data.foundation;
  let foundation = null;
  if (f != null) {
    if (typeof f !== "object" || Array.isArray(f)) throw bad(`Fondasi ${word} tidak valid`);
    const action = normalizeAction(f.action, "Fondasi");
    foundation = {
      action, system: normalizeSystem(f.system, "Fondasi", { required: action === "REPLACE" }),
      material: normalizeMaterialRef(f.material, { field: "Fondasi", required: false }), note: cleanText(f.note, LIMITS.ITEM_NOTE, "Fondasi: catatan"),
    };
  }
  const rows = data.layers == null ? [] : data.layers;
  if (!Array.isArray(rows)) throw bad("Daftar lapisan tidak valid");
  if (rows.length > LIMITS.MAX_LAYERS) throw bad(`Maksimal ${LIMITS.MAX_LAYERS} lapisan`, "COMPONENT_TOO_MANY_LAYERS");
  if (!foundation && rows.length === 0) throw bad(planned ? "Isi minimal fondasi atau satu lapisan pada racikan rencana" : "Isi minimal fondasi atau satu lapisan hasil akhir", planned ? "COMPONENT_PLAN_EMPTY" : "COMPONENT_AFTER_EMPTY");
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
  // Fase 4: alasan perbedaan hasil aktual dari racikan rencana (opsional di normalizer; WAJIB bila ada perbedaan — ditegakkan service terhadap PLAN_RACIKAN). Hanya ada di AFTER; entri lama tanpa kunci ini tidak berubah.
  const deviationNote = planned ? null : cleanText(data.deviationNote, LIMITS.NOTE, "Alasan perbedaan");
  return { foundation, layers, ...(deviationNote ? { deviationNote } : {}), note };
}

// Seksi lama: hanya FOTO (perilaku slice 3 dipertahankan). Seksi PENGUJIAN dan LAYERS_BEFORE (fase 2): foto ATAU video; LAYERS_BEFORE boleh menautkan media ke satu lapisan (layerOrder 1..jumlah lapisan).
export function normalizeMediaItems(items, { kindOf, section = null, layerCount = 0 } = {}) {
  if (items == null) return [];
  const allowVideo = section === "LAYERS_BEFORE" || isQcSection(section);
  const max = section ? maxMediaFor(section) : LIMITS.MAX_MEDIA;
  if (!Array.isArray(items)) throw bad("Daftar foto tidak valid", "COMPONENT_MEDIA_INVALID");
  if (items.length > max) throw bad(`Maksimal ${max} ${allowVideo ? "foto/video" : "foto"} per catatan`, "COMPONENT_TOO_MANY_MEDIA");
  const seen = new Set();
  return items.map((it, i) => {
    const url = typeof it === "string" ? it : it?.url;
    const kind = typeof url === "string" ? kindOf(url) : null;
    if (!kind || (kind !== "image" && !(allowVideo && kind === "video"))) throw bad(allowVideo ? "Foto/video tidak valid — unggah ulang dari aplikasi" : "Foto tidak valid — unggah ulang dari aplikasi", "COMPONENT_MEDIA_INVALID");
    if (seen.has(url)) throw bad("Foto yang sama dikirim dua kali", "COMPONENT_MEDIA_DUPLICATE");
    seen.add(url);
    const out = { url, kind, caption: cleanText(typeof it === "object" ? it.caption : null, LIMITS.CAPTION, "Keterangan foto"), order: i + 1 };
    const lo = typeof it === "object" ? it.layerOrder : null;
    if (lo != null && lo !== "") {
      if (section !== "LAYERS_BEFORE") throw bad("Tautan lapisan hanya untuk catatan lapisan sebelum dibongkar", "COMPONENT_MEDIA_LAYER_INVALID");
      const n = Number(lo);
      if (!Number.isInteger(n) || n < 1 || n > layerCount) throw bad(`Media ditautkan ke lapisan ${lo} yang tidak ada`, "COMPONENT_MEDIA_LAYER_INVALID");
      out.layerOrder = n;
    }
    return out;
  });
}

// ---- perbandingan Sebelum -> Sesudah ----------------------------------------------------------------------------------------
const layerView = (l) => (l ? { material: materialLabel(l.material), thicknessCm: l.thicknessCm ?? null, condition: l.condition, conditionLabel: conditionLabel(l.condition), note: l.note ?? null } : null);

// Komponen hasil akhir satu lapisan (KEEP/REPAIR mewarisi ketebalan catatan awal bila tidak diisi — dibaca dari SATU sumber, tidak disalin).
function layerFinal(a, b) {
  if (a.action === "KEEP") return { label: b ? materialLabel(b.material) : "Dipertahankan (bahan lama belum dicatat)", thicknessCm: a.thicknessCm ?? b?.thicknessCm ?? null, source: "KEPT" };
  if (a.action === "REPAIR") return { label: a.material ? materialLabel(a.material) : (b ? `${materialLabel(b.material)} (diperbaiki)` : "Diperbaiki (bahan belum dicatat)"), thicknessCm: a.thicknessCm ?? b?.thicknessCm ?? null, source: "REPAIRED" };
  return { label: materialLabel(a.material), thicknessCm: a.thicknessCm ?? null, source: "NEW" };
}
const thicknessSource = (a, b, fin) => (typeof a.thicknessCm === "number" ? "DICATAT" : fin.thicknessCm != null && b && typeof b.thicknessCm === "number" ? "DARI_CATATAN_AWAL" : null);

/** Ringkasan lapisan RENCANA / AKTUAL (atas -> bawah): ketebalan efektif per lapisan + total tinggi. Total hanya dari yang diketahui; ada yang kosong -> "belum lengkap" (bukan 0). Dibaca, tidak disimpan. */
export function summarizeResultLayers(data, beforeData = null) {
  if (!data) return null;
  const layers = Array.isArray(data.layers) ? data.layers : [];
  const bLayers = Array.isArray(beforeData?.layers) ? beforeData.layers : [];
  const perLayer = layers.map((a, i) => {
    const b = bLayers[(a.fromOrder ?? i + 1) - 1] ?? null;
    const fin = layerFinal(a, b);
    return { order: i + 1, thicknessCm: typeof fin.thicknessCm === "number" && fin.thicknessCm > 0 ? fin.thicknessCm : null, source: thicknessSource(a, b, fin) };
  });
  const known = perLayer.filter((l) => l.thicknessCm != null);
  const unknownCount = perLayer.length - known.length;
  const total = known.length ? round(known.reduce((s, l) => s + l.thicknessCm, 0)) : null;
  const totalComplete = perLayer.length > 0 && unknownCount === 0;
  const label = !perLayer.length ? "Tidak ada lapisan dicatat"
    : total == null ? "Total tinggi lapisan belum dicatat"
      : totalComplete ? `Total tinggi lapisan ${total} cm (${perLayer.length} lapisan)` : `Total tinggi lapisan belum lengkap — ${total} cm dari ${known.length} lapisan yang diketahui; ${unknownCount} lapisan belum diukur`;
  return { count: perLayer.length, knownCount: known.length, unknownThicknessCount: unknownCount, totalThicknessCm: total, totalComplete, perLayer, label };
}

// Tampilan satu seksi hasil (rencana / aktual) + ringkasan total tinggi.
function resultView(entry, layersBefore, foundationBefore) {
  if (!entry) return null;
  const d = entry.data ?? {}; const bLayers = layersBefore?.data?.layers ?? []; const fb = foundationBefore?.data ?? null;
  const summary = summarizeResultLayers(d, layersBefore?.data ?? null);
  const layers = (d.layers ?? []).map((a, i) => {
    const b = bLayers[(a.fromOrder ?? i + 1) - 1] ?? null; const fin = layerFinal(a, b);
    return { order: i + 1, action: a.action, actionLabel: actionLabel(a.action), label: fin.label, thicknessCm: summary.perLayer[i].thicknessCm, thicknessSource: summary.perLayer[i].source, note: a.note ?? null, fromOrder: a.fromOrder ?? null };
  });
  let foundation = null;
  if (d.foundation) {
    const fa = d.foundation; const sysTxt = fa.system && fa.system !== "TIDAK_DIKETAHUI" ? systemLabel(fa.system) : null;
    const baseBefore = fb ? [fb.system === "TIDAK_DIKETAHUI" ? null : systemLabel(fb.system), materialLabel(fb.material)].filter(Boolean).join(" · ") || systemLabel(fb.system) : null;
    const label = fa.action === "KEEP" ? (baseBefore || "Dipertahankan (fondasi lama belum dicatat)")
      : [sysTxt, materialLabel(fa.material)].filter(Boolean).join(" · ") || (fa.action === "REPAIR" ? (baseBefore ? `${baseBefore} (diperbaiki)` : "Diperbaiki (belum dicatat)") : UNKNOWN_LABEL);
    foundation = { action: fa.action, actionLabel: actionLabel(fa.action), label, note: fa.note ?? null };
  }
  return { version: entry.version ?? null, foundation, layers, summary, note: d.note ?? null };
}

// Rencana vs aktual per lapisan (indeks yang sama, atas -> bawah). Hanya membandingkan bila KEDUANYA tercatat; yang satu tercatat saja = disebut apa adanya.
function planVsActualOf(plan, actual) {
  if (!plan || !actual) return { available: false, reason: !plan && !actual ? "Rencana dan hasil aktual belum dicatat" : !plan ? "Racikan rencana belum dicatat" : "Hasil aktual belum dicatat", layers: [], foundation: null, total: null };
  const n = Math.max(plan.layers.length, actual.layers.length);
  const layers = [];
  for (let i = 0; i < n; i++) {
    const p = plan.layers[i] ?? null; const a = actual.layers[i] ?? null;
    if (p && !a) { layers.push({ order: i + 1, status: "HANYA_RENCANA", plan: p, actual: null, diffs: [] }); continue; }
    if (!p && a) { layers.push({ order: i + 1, status: "HANYA_AKTUAL", plan: null, actual: a, diffs: [] }); continue; }
    const diffs = [];
    if (p.action !== a.action) diffs.push("TINDAKAN");
    if (p.label !== a.label) diffs.push("BAHAN");
    if (p.thicknessCm != null && a.thicknessCm != null && p.thicknessCm !== a.thicknessCm) diffs.push("KETEBALAN");
    layers.push({ order: i + 1, status: diffs.length ? "BERBEDA" : "SAMA", plan: p, actual: a, diffs });
  }
  let foundation = null;
  if (plan.foundation || actual.foundation) {
    const p = plan.foundation; const a = actual.foundation;
    foundation = !p ? { status: "HANYA_AKTUAL", plan: null, actual: a, diffs: [] } : !a ? { status: "HANYA_RENCANA", plan: p, actual: null, diffs: [] }
      : { status: p.action === a.action && p.label === a.label ? "SAMA" : "BERBEDA", plan: p, actual: a, diffs: [p.action !== a.action ? "TINDAKAN" : null, p.label !== a.label ? "BAHAN" : null].filter(Boolean) };
  }
  const pt = plan.summary?.totalThicknessCm ?? null; const at = actual.summary?.totalThicknessCm ?? null;
  const total = { planCm: pt, actualCm: at, planComplete: !!plan.summary?.totalComplete, actualComplete: !!actual.summary?.totalComplete, differenceCm: pt != null && at != null ? round(at - pt) : null };
  return { available: true, reason: null, layers, foundation, total };
}

/** @param {{layersBefore?:object|null, foundationBefore?:object|null, after?:object|null, plan?:object|null}} entries  entri = { data, version, media } atau null (belum dicatat) */
export function buildComparison({ layersBefore = null, foundationBefore = null, after = null, plan = null } = {}) {
  const status = { layersBefore: !!layersBefore, foundationBefore: !!foundationBefore, after: !!after, plan: !!plan };
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
  const finalOf = layerFinal;
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
  // Fase 3: rencana (PLAN_RACIKAN) dan hasil aktual (AFTER) sebagai tampilan terpisah + perbandingan; `gaps`/`complete` lama TIDAK berubah (rencana belum dicatat bukan celah laporan lama).
  const planView = resultView(plan, layersBefore, foundationBefore);
  const actualView = resultView(after, layersBefore, foundationBefore);
  return {
    status, recordedAny, complete: status.layersBefore && status.foundationBefore && status.after, gaps, foundation, layers, kept, final: { foundation: foundation?.final?.label ?? null, layers: finalLayers },
    plan: planView, actual: actualView, planVsActual: planVsActualOf(planView, actualView),
  };
}

// ---- Fase 2: uji kasur utuh + uji fondasi awal + ringkasan lapisan ---------------------------------------------------------------------------
const round = (n, d = 2) => { const k = 10 ** d; return Math.round(n * k) / k; };
function numberField(v, field, { min = 0, max, allowZero = false, code } = {}) {
  if (v == null || (typeof v === "string" && v.trim() === "")) throw bad(`${field} wajib diisi`, code || "COMPONENT_NUMBER_REQUIRED");
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max || (!allowZero && n <= 0)) {
    throw bad(`${field} harus angka ${allowZero ? min : "lebih dari 0"}–${max}`, code || "COMPONENT_NUMBER_INVALID");
  }
  return round(n);
}
const requiredText = (v, field, min, max, code) => {
  const t = cleanText(v, max, field);
  if (!t || t.length < min) throw bad(`${field} wajib diisi (minimal ${min} karakter)`, code);
  return t;
};

// Berat penguji AKTUAL wajib diketik petugas — tidak pernah diisi/dianggap berat customer dari Sales.
export function normalizeWholeTest(data, note) {
  if (!MATCH_BY_KEY[data.complaintMatch]) throw bad("Pilih kesesuaian dengan keluhan customer (atau “Tidak dapat dinilai”)", "COMPONENT_COMPLAINT_MATCH_REQUIRED");
  if (data.qcInFrame !== true) throw bad("Konfirmasi dulu bahwa foto/video memperlihatkan PIC QC sedang menguji kasur", "COMPONENT_QC_IN_FRAME_REQUIRED");
  return {
    complaintMatch: data.complaintMatch,
    complaintNote: cleanText(data.complaintNote, LIMITS.ITEM_NOTE, "Catatan keluhan"),
    feelNote: requiredText(data.feelNote, "Feel awal", 3, LIMITS.NOTE, "COMPONENT_FEEL_REQUIRED"),
    testerWeightKg: numberField(data.testerWeightKg, "Berat penguji aktual (kg)", { max: LIMITS.MAX_WEIGHT_KG, code: "COMPONENT_TESTER_WEIGHT_REQUIRED" }),
    testMethod: requiredText(data.testMethod, "Titik/metode pengujian", 3, LIMITS.TEST_TEXT, "COMPONENT_TEST_METHOD_REQUIRED"),
    wholeDropCm: numberField(data.wholeDropCm, "Penurunan kasur utuh (cm)", { min: 0, max: LIMITS.MAX_THICKNESS_CM, allowZero: true, code: "COMPONENT_WHOLE_DROP_REQUIRED" }),
    qcInFrame: true,
    note,
  };
}

// Penurunan = tinggi tanpa beban − tinggi dengan beban, DIHITUNG SERVER (nilai dari klien diabaikan). Tinggi dengan beban tidak boleh lebih tinggi dari tanpa beban.
export function normalizeFoundationTest(data, note) {
  const unloadedHeightCm = numberField(data.unloadedHeightCm, "Tinggi tanpa beban (cm)", { max: LIMITS.MAX_THICKNESS_CM, code: "COMPONENT_UNLOADED_HEIGHT_REQUIRED" });
  const loadedHeightCm = numberField(data.loadedHeightCm, "Tinggi saat dibebani (cm)", { max: LIMITS.MAX_THICKNESS_CM, code: "COMPONENT_LOADED_HEIGHT_REQUIRED" });
  if (loadedHeightCm > unloadedHeightCm) throw bad("Tinggi saat dibebani tidak boleh lebih besar dari tinggi tanpa beban", "COMPONENT_LOADED_TALLER");
  return {
    system: normalizeSystem(data.system, "Fondasi", { required: true }),
    material: normalizeMaterialRef(data.material, { field: "Fondasi", required: false }),
    unloadedHeightCm, loadedHeightCm, dropCm: round(unloadedHeightCm - loadedHeightCm),
    testerWeightKg: numberField(data.testerWeightKg, "Berat penguji aktual (kg)", { max: LIMITS.MAX_WEIGHT_KG, code: "COMPONENT_TESTER_WEIGHT_REQUIRED" }),
    testMethod: requiredText(data.testMethod, "Titik/metode pengujian", 3, LIMITS.TEST_TEXT, "COMPONENT_TEST_METHOD_REQUIRED"),
    note,
  };
}

/** Ringkasan lapisan awal (dibaca, tidak disimpan): total dihitung dari ketebalan YANG DIKETAHUI; ada yang kosong -> "total belum lengkap". Kosong = Belum dicatat, bukan 0. */
export function summarizeLayers(data) {
  if (!data) return null;
  if (data.layersUnknown) return { layersUnknown: true, count: 0, knownCount: 0, unknownThicknessCount: 0, totalThicknessCm: null, totalComplete: false, label: "Lapisan tidak diketahui — total tinggi belum dicatat" };
  const layers = Array.isArray(data.layers) ? data.layers : [];
  const known = layers.filter((l) => typeof l.thicknessCm === "number" && l.thicknessCm > 0);
  const unknownThicknessCount = layers.length - known.length;
  const total = known.length ? round(known.reduce((a, l) => a + l.thicknessCm, 0)) : null;
  const totalComplete = layers.length > 0 && unknownThicknessCount === 0;
  const label = total == null
    ? "Total tinggi lapisan belum dicatat"
    : totalComplete ? `Total tinggi lapisan ${total} cm (${layers.length} lapisan)` : `Total tinggi lapisan belum lengkap — ${total} cm dari ${known.length} lapisan yang diketahui; ${unknownThicknessCount} lapisan belum diukur`;
  return { layersUnknown: false, count: layers.length, knownCount: known.length, unknownThicknessCount, totalThicknessCm: total, totalComplete, label };
}

export const SEPARATION_NOTE = "Penurunan kasur utuh, lapisan terpisah, dan fondasi adalah pengukuran berbeda dan TIDAK dijumlahkan (menghindari hitung ganda). Kategori kondisi tidak ditetapkan otomatis dari angka.";

/** Tampilan terpisah tiga jenis pengukuran. Estimasi gabungan hanya bila ada pengukuran komponen terpisah dengan metode sejenis — belum ada data seperti itu, jadi selalu null (tidak dikarang). */
export function buildMeasurements({ wholeTest = null, foundationTest = null, layersBefore = null, wholeAfter = null, foundationAfter = null } = {}) {
  const w = wholeTest?.data ?? null; const f = foundationTest?.data ?? null; const l = layersBefore?.data ?? null;
  const wView = (e) => (e ? { version: e.version, complaintMatch: e.data.complaintMatch, complaintMatchLabel: complaintMatchLabel(e.data.complaintMatch), complaintNote: e.data.complaintNote ?? null, feelNote: e.data.feelNote, testerWeightKg: e.data.testerWeightKg, testMethod: e.data.testMethod, wholeDropCm: e.data.wholeDropCm, qcInFrame: e.data.qcInFrame ?? null, sameMethodAsBefore: e.data.sameMethodAsBefore ?? null, note: e.data.note ?? null } : null);
  const fView = (e) => (e ? { version: e.version, system: e.data.system, systemLabel: systemLabel(e.data.system), material: materialLabel(e.data.material), unloadedHeightCm: e.data.unloadedHeightCm, loadedHeightCm: e.data.loadedHeightCm, dropCm: e.data.dropCm, testerWeightKg: e.data.testerWeightKg, testMethod: e.data.testMethod, sameMethodAsBefore: e.data.sameMethodAsBefore ?? null, note: e.data.note ?? null } : null);
  const wb = wView(wholeTest); const fb = fView(foundationTest); const wa = wView(wholeAfter); const fa = fView(foundationAfter);
  return {
    whole: wb, foundation: fb,
    layers: l ? { version: layersBefore.version, ...summarizeLayers(l) } : null,
    wholeAfter: wa, foundationAfter: fa,
    comparisons: { foundation: compareTests(fb, fa, "dropCm", "fondasi"), whole: compareTests(wb, wa, "wholeDropCm", "kasur utuh") },
    recorded: { whole: !!w, foundation: !!f, layers: !!l, wholeAfter: !!wa, foundationAfter: !!fa },
    combinedEstimate: null, // tidak ada pengukuran komponen terpisah yang metodenya sepadan; tidak ada estimasi gabungan
    separationNote: SEPARATION_NOTE,
  };
}

// ---- Fase 4: kesebandingan uji awal vs uji setelah perbaikan -------------------------------------------------------------------------------------------------
// Sebanding HANYA bila PIC QC MENGONFIRMASI (sameMethodAsBefore = true) bahwa metode/titik/kondisi pengujian sebanding dengan uji awal. TIDAK ada aturan otomatis dari selisih berat.
// Belum dikonfirmasi: kedua angka mentah (beserta berat & metode masing-masing) tampil, TANPA selisih dan tanpa kesimpulan. Sudah dikonfirmasi: selisih tampil; bila berat penguji berbeda,
// perbedaan itu tetap disebut ("dikonfirmasi sebanding oleh PIC QC") — penilaian ada di PIC QC, bukan di sistem.
function compareTests(before, after, dropKey, noun) {
  const raw = (v) => (v ? `turun ${v[dropKey]} cm (berat ${v.testerWeightKg} kg; ${v.testMethod})` : null);
  if (!before || !after) {
    return { available: false, comparable: false, reasons: [], text: !before && !after ? `Uji awal dan uji setelah perbaikan ${NOT_RECORDED_LABEL.toLowerCase()}` : !before ? `Uji awal ${noun} ${NOT_RECORDED_LABEL.toLowerCase()} — tidak bisa dibandingkan` : `Uji setelah perbaikan ${noun} ${NOT_RECORDED_LABEL.toLowerCase()}`, beforeDropCm: before?.[dropKey] ?? null, afterDropCm: after?.[dropKey] ?? null, beforeRaw: raw(before), afterRaw: raw(after), differenceCm: null };
  }
  const comparable = after.sameMethodAsBefore === true;
  const reasons = comparable ? [] : ["METODE_BELUM_DIKONFIRMASI_SEBANDING"];
  const bd = before[dropKey]; const ad = after[dropKey];
  const differenceCm = comparable ? round(bd - ad) : null; // positif = penurunan berkurang
  const weightNote = comparable && Number(before.testerWeightKg) !== Number(after.testerWeightKg) ? ` — berat penguji berbeda (awal ${before.testerWeightKg} kg, baru ${after.testerWeightKg} kg), dikonfirmasi sebanding oleh PIC QC` : "";
  return {
    available: true, comparable, reasons, beforeDropCm: bd, afterDropCm: ad, differenceCm, beforeRaw: raw(before), afterRaw: raw(after),
    text: comparable
      ? `Sebanding dengan uji awal (dikonfirmasi PIC QC): turun ${bd} cm → ${ad} cm${differenceCm > 0 ? ` (${differenceCm} cm lebih sedikit)` : differenceCm < 0 ? ` (${Math.abs(differenceCm)} cm lebih banyak)` : " (sama)"}${weightNote}`
      : `Perbandingan langsung belum valid: PIC QC belum mengonfirmasi metode pengujian sebanding dengan uji awal. Awal ${raw(before)} · sekarang ${raw(after)} — kedua angka ditampilkan apa adanya, tanpa selisih.`,
  };
}

// ---- Fase 4: perbedaan hasil aktual (AFTER) dari racikan rencana (PLAN_RACIKAN) --------------------------------------------------------------------------------
// Bagian yang BELUM dicatat di AFTER (fondasi null / lapisan kosong) tidak dihitung sebagai perbedaan (mis. fondasi dicatat lebih dulu, lapisan menyusul). Dipakai service untuk mewajibkan alasan.
export function detectDeviation({ plan = null, after = null, layersBefore = null, foundationBefore = null } = {}) {
  if (!plan || !after) return { hasDeviation: false, items: [] };
  const pv = resultView({ data: plan.data ?? plan, version: plan.version ?? null }, layersBefore, foundationBefore);
  const av = resultView({ data: after.data ?? after, version: after.version ?? null }, layersBefore, foundationBefore);
  const cmpRes = planVsActualOf(pv, av);
  const items = [];
  const hasFoundationActual = !!av?.foundation; const hasLayersActual = (av?.layers?.length ?? 0) > 0;
  if (cmpRes.foundation && hasFoundationActual && cmpRes.foundation.status !== "SAMA") items.push({ part: "FONDASI", status: cmpRes.foundation.status, diffs: cmpRes.foundation.diffs });
  if (hasLayersActual) for (const l of cmpRes.layers) if (l.status !== "SAMA") items.push({ part: `LAPISAN_${l.order}`, status: l.status, diffs: l.diffs });
  return { hasDeviation: items.length > 0, items };
}

