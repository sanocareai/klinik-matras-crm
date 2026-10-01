// Matriks DOKUMENTASI produksi V2 (P10B) — SATU kontrak kanonis yang dipakai Aplikasi Meja/Corner, QC, Aplikasi Dokumentasi,
// Unit 360 dan Laporan Produksi. Modul MURNI (tanpa database): definisi kategori, aturan "kurang", dan perakit matriks.
//
// Penyimpanan: baris dokumentasi ditulis ke production_step_evidence_v2 (tabel yang SAMA dengan bukti tahap; media di store V2 yang
// SAMA, URL bertanda-tangan yang SAMA) dengan penanda stepCode "DOC_<KATEGORI>" dan versi >= DOC_VERSION_BASE. Penanda itu membuat
// baris dokumentasi TIDAK PERNAH dihitung stage engine/lifecycle (loadStepContext memisahkannya) — dokumentasi tidak menyelesaikan
// tahap, tidak menaikkan revisi run, dan tidak mengubah status produksi. Tahap yang mewajibkan foto tetap ditutup command owner
// tahap (productionStepCommandService) setelah gate buktinya terpenuhi.
//
// Foto yang sudah ada dari tahap/QC/driver DIHITUNG ke kategori yang sesuai (sumber ditampilkan), bukan disalin ulang.

export const DOC_STEP_CODE_PREFIX = "DOC_";
export const DOC_VERSION_BASE = 1000; // versi bukti tahap asli < 1000; baris dokumentasi >= 1000 (unik per run+stepNo)
export const DOC_MAX_ITEMS = 12;
export const DOC_CAPTION_MAX = 200;
export const DOC_REASON_MIN = 3;

export const DOC_GROUPS = Object.freeze({ BEFORE: "Before", PROCESS: "Proses", AFTER: "After" });
export const DOC_SOURCES = Object.freeze({
  DRIVER_PICKUP: "Driver Pickup", PRODUKSI: "Produksi", QC: "QC", CORNER: "Corner", GUDANG: "Gudang", MANUAL: "Manual",
});

// storeStepNo: nomor tahap (1–12) tempat baris dokumentasi disimpan (CHECK tabel 1..12) — hanya penyimpanan, bukan lifecycle.
// stepSources: bukti TAHAP yang otomatis dihitung ke kategori ini. due: kapan kategori mulai dituntut ("kurang").
//   {step:n} = setelah bukti tahap n tercatat · {modulesDone:true} = setelah tahap modul terakhir yang berlaku tercatat
//   {qc:true} = setelah QC tercatat · {runCompleted:true} = setelah run selesai · {always:true} = sejak run ada
export const DOC_CATEGORIES = Object.freeze([
  { key: "PICKUP_ARRIVAL", label: "Pickup / tiba", group: "BEFORE", min: 1, storeStepNo: 1, stepSources: [], pickupPhoto: true, requiresPickupOrigin: true, due: { always: true } },
  { key: "INITIAL_CONDITION", label: "Kondisi awal", group: "BEFORE", min: 1, storeStepNo: 2, stepSources: [2], due: { step: 2 } },
  { key: "BEFORE_TEARDOWN", label: "Sebelum bongkar", group: "BEFORE", min: 2, storeStepNo: 1, stepSources: [1], due: { step: 1 } },
  { key: "TEARDOWN_DIAGNOSIS", label: "Hasil bongkar / diagnosis", group: "BEFORE", min: 2, storeStepNo: 3, stepSources: [3], diagnosisPhotos: true, due: { step: 3 } },
  { key: "FOUNDATION", label: "Fondasi", group: "PROCESS", min: 2, storeStepNo: 6, stepSources: [4, 6], needsStep: 6, due: { step: 6 } },
  { key: "LAYER_COMPONENT", label: "Lapisan / komponen", group: "PROCESS", min: 2, storeStepNo: 7, stepSources: [7], needsStep: 7, due: { step: 7 } },
  { key: "PROCESS", label: "Proses", group: "PROCESS", min: 1, storeStepNo: 7, stepSources: [], due: { modulesDone: true } },
  { key: "TEXTURE_TEST", label: "Uji tekstur", group: "AFTER", min: 1, storeStepNo: 8, stepSources: [8], due: { step: 8 } },
  { key: "QC", label: "QC", group: "AFTER", min: 1, storeStepNo: 8, stepSources: [], qcPhotos: true, due: { qc: true } },
  { key: "CORNER", label: "Corner", group: "AFTER", min: 2, storeStepNo: 11, stepSources: [9, 11], due: { step: 11 } },
  { key: "FINAL_RESULT", label: "Hasil akhir", group: "AFTER", min: 2, storeStepNo: 12, stepSources: [12], due: { step: 12 } },
  { key: "READY_TO_SHIP", label: "Siap kirim", group: "AFTER", min: 1, storeStepNo: 12, stepSources: [], due: { runCompleted: true } },
]);
export const DOC_CATEGORY_BY_KEY = Object.freeze(Object.fromEntries(DOC_CATEGORIES.map((c) => [c.key, c])));

export const isDocumentationStepCode = (stepCode) => typeof stepCode === "string" && stepCode.startsWith(DOC_STEP_CODE_PREFIX);
export const isDocumentationRow = (row) => isDocumentationStepCode(row?.stepCode);
export const docStepCode = (category) => `${DOC_STEP_CODE_PREFIX}${category}`;

function docError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}
export { docError };
export const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Sumber foto tahap: tahap 1–9 dikerjakan PIC meja (Produksi), 10–12 PIC Corner.
export const sourceOfStep = (stepNo) => (stepNo >= 10 ? "CORNER" : "PRODUKSI");

// Sumber unggahan dokumentasi — diturunkan SERVER dari peran/penugasan pengunggah (tidak diterima dari klien, tidak bisa dipalsukan).
export function deriveDocSource({ category, isTableOperator = false, isCornerOperator = false, hasQcWrite = false, hasInventoryWrite = false }) {
  if (category === "QC" && hasQcWrite) return "QC";
  if (hasInventoryWrite && (category === "PICKUP_ARRIVAL" || category === "READY_TO_SHIP")) return "GUDANG";
  if (isCornerOperator && ["CORNER", "FINAL_RESULT"].includes(category)) return "CORNER";
  if (isTableOperator) return "PRODUKSI";
  return "MANUAL";
}

// Normalisasi item kiriman klien: [{ url, caption?, order? }] -> daftar berurutan. Hanya foto (jpg/png/webp) dari store V2.
export function normalizeDocItems(items, { urlKind }) {
  if (!Array.isArray(items) || items.length === 0) throw docError("Pilih minimal satu foto untuk dikirim", 400, "DOC_ITEMS_REQUIRED");
  if (items.length > DOC_MAX_ITEMS) throw docError(`Maksimal ${DOC_MAX_ITEMS} foto per pengiriman`, 400, "DOC_ITEMS_TOO_MANY");
  const seen = new Set();
  const normalized = items.map((raw, index) => {
    const url = typeof raw === "string" ? raw : raw?.url;
    const kind = urlKind(url);
    if (kind !== "image") throw docError("Dokumentasi hanya menerima foto yang diunggah lewat Aplikasi Dokumentasi", 400, "DOC_MEDIA_INVALID");
    if (seen.has(url)) throw docError("Foto yang sama terkirim dua kali", 400, "DOC_MEDIA_DUPLICATE_IN_REQUEST");
    seen.add(url);
    const captionRaw = typeof raw === "object" && raw ? raw.caption : null;
    if (captionRaw != null && typeof captionRaw !== "string") throw docError("Keterangan foto tidak valid", 400, "DOC_CAPTION_INVALID");
    const caption = (captionRaw || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (caption.length > DOC_CAPTION_MAX) throw docError(`Keterangan foto maksimal ${DOC_CAPTION_MAX} karakter`, 400, "DOC_CAPTION_TOO_LONG");
    const order = Number.isFinite(Number(raw?.order)) ? Number(raw.order) : index;
    return { url, kind, caption: caption || null, order, index };
  });
  return normalized.sort((a, b) => a.order - b.order || a.index - b.index).map((it, i) => ({ url: it.url, kind: it.kind, caption: it.caption, order: i + 1 }));
}

// Baris dokumentasi (dari DB) -> struktur ringkas. `supersededIds` = id baris yang digantikan koreksi.
export function parseDocRows(rows) {
  const parsed = rows.map((row) => {
    const d = row.payload?.documentation || {};
    const media = Array.isArray(row.media) ? row.media : [];
    const meta = new Map((Array.isArray(d.items) ? d.items : []).map((it) => [it.url, it]));
    return {
      evidenceId: row.id, category: d.category, source: d.source || "MANUAL", actorId: row.actorId ?? null, createdAt: row.createdAt,
      supersedesEvidenceId: d.supersedesEvidenceId || null, reason: d.reason || null, note: d.note || null,
      items: media.map((m, i) => ({ url: m.url, kind: m.kind, caption: meta.get(m.url)?.caption ?? null, order: meta.get(m.url)?.order ?? i + 1 })),
    };
  }).filter((r) => DOC_CATEGORY_BY_KEY[r.category]);
  const superseded = new Set(parsed.map((r) => r.supersedesEvidenceId).filter(Boolean));
  return parsed.map((r) => ({ ...r, superseded: superseded.has(r.evidenceId) }));
}

// Perakit matriks. Input (semuanya sudah diturunkan service dari data kanonis):
//   applicableSteps: number[] · recordedSteps: Set<number> · nextStepNo: number|null · started: boolean
//   run: { origin, status } · qcDone: boolean · stepMedia: Map<stepNo, [{ url, kind, evidenceId, actorName, createdAt }]>
//   extra: { pickupPhoto?: {url,createdAt}|null, diagnosisPhotos?: [{url,kind}], qcPhotos?: [{url,kind}] }
//   docRows: hasil parseDocRows (+ actorName pada tiap baris)
export function buildDocumentationMatrix({ applicableSteps, recordedSteps, nextStepNo = null, started, run, qcDone, stepMedia, extra = {}, docRows = [] }) {
  const applicable = new Set(applicableSteps || []);
  const done = (n) => recordedSteps.has(n) || (nextStepNo != null && nextStepNo > n) || run.status === "COMPLETED";
  const moduleSteps = [6, 7].filter((n) => applicable.has(n));
  const modulesDone = moduleSteps.length ? moduleSteps.every(done) : done(5);
  const categories = DOC_CATEGORIES.map((cat) => {
    const items = [];
    for (const n of cat.stepSources) {
      for (const m of stepMedia.get(n) || []) items.push({ ...m, source: sourceOfStep(n), origin: "STEP", stepNo: n, caption: null, correctable: false });
    }
    if (cat.pickupPhoto && extra.pickupPhoto) items.push({ url: extra.pickupPhoto.url, kind: "image", source: "DRIVER_PICKUP", origin: "PICKUP", caption: null, createdAt: extra.pickupPhoto.createdAt ?? null, correctable: false });
    if (cat.diagnosisPhotos) for (const m of extra.diagnosisPhotos || []) items.push({ url: m.url, kind: m.kind || "image", source: "PRODUKSI", origin: "DIAGNOSIS", caption: null, createdAt: m.createdAt ?? null, correctable: false });
    if (cat.qcPhotos) for (const m of extra.qcPhotos || []) items.push({ url: m.url, kind: m.kind || "image", source: "QC", origin: "QC", caption: null, createdAt: m.createdAt ?? null, correctable: false });
    const docs = docRows.filter((r) => r.category === cat.key);
    for (const r of docs.filter((x) => !x.superseded)) {
      for (const it of r.items) items.push({ url: it.url, kind: it.kind, source: r.source, origin: "DOC", caption: it.caption, order: it.order, evidenceId: r.evidenceId, actorName: r.actorName ?? null, createdAt: r.createdAt, correctable: true });
    }
    const history = docs.filter((x) => x.superseded).map((r) => {
      const by = docs.find((d) => d.supersedesEvidenceId === r.evidenceId);
      // versi lama: siapa/kapan mengunggah; koreksi yang menggantikannya: siapa/kapan/mengapa
      return {
        evidenceId: r.evidenceId, source: r.source, actorName: r.actorName ?? null, createdAt: r.createdAt, items: r.items,
        supersededBy: by?.evidenceId ?? null, reason: by?.reason ?? null, correctedBy: by?.actorName ?? null, correctedAt: by?.createdAt ?? null,
      };
    });
    let applicableCat = true;
    if (cat.needsStep && !applicable.has(cat.needsStep)) applicableCat = false;
    if (cat.requiresPickupOrigin && run.origin !== "CUSTODY_PICKUP") applicableCat = false;
    const d = cat.due;
    const due = !applicableCat ? false : !started && !d.always ? false
      : d.always ? true : d.step != null ? done(d.step) : d.modulesDone ? modulesDone : d.qc ? qcDone : d.runCompleted ? run.status === "COMPLETED" : false;
    const count = items.length;
    const missing = applicableCat && due ? Math.max(0, cat.min - count) : 0;
    const status = !applicableCat ? "NA" : count >= cat.min ? "LENGKAP" : due ? "KURANG" : "MENUNGGU";
    return { key: cat.key, label: cat.label, group: cat.group, groupLabel: DOC_GROUPS[cat.group], min: cat.min, applicable: applicableCat, due, count, missing, status, items, history };
  });
  const missingBy = { BEFORE: 0, PROCESS: 0, AFTER: 0 };
  const missingList = [];
  for (const c of categories) if (c.missing > 0) { missingBy[c.group] += c.missing; missingList.push({ key: c.key, label: c.label, group: c.group, missing: c.missing, min: c.min, count: c.count }); }
  const applicableCats = categories.filter((c) => c.applicable);
  const complete = applicableCats.every((c) => c.count >= c.min);
  return {
    categories, missing: missingList, missingBy, missingTotal: missingList.reduce((s, m) => s + m.missing, 0),
    totals: { photos: categories.reduce((s, c) => s + c.count, 0), required: applicableCats.reduce((s, c) => s + c.min, 0), satisfied: applicableCats.reduce((s, c) => s + Math.min(c.count, c.min), 0) },
    flags: {
      belumDimulai: !started,
      beforeKurang: missingBy.BEFORE > 0, prosesKurang: missingBy.PROCESS > 0, afterKurang: missingBy.AFTER > 0,
      lengkap: started && complete,
    },
  };
}

export const DOC_QUEUE_FILTERS = Object.freeze(["ALL", "BELUM_DIMULAI", "BEFORE_KURANG", "PROSES_KURANG", "AFTER_KURANG", "LENGKAP"]);
export function matchesDocFilter(flags, filter) {
  switch (filter) {
    case "BELUM_DIMULAI": return flags.belumDimulai;
    case "BEFORE_KURANG": return flags.beforeKurang;
    case "PROSES_KURANG": return flags.prosesKurang;
    case "AFTER_KURANG": return flags.afterKurang;
    case "LENGKAP": return flags.lengkap;
    default: return true;
  }
}
