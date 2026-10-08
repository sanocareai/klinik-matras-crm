// Simplifikasi Production slice 3 — Catatan Komponen kanonis per unit (Sebelum -> Sesudah): command tulis + bacaan.
//
// KEPEMILIKAN: satu-satunya penulis tabel unit_component_entries_v2. Append-only (koreksi = versi baru dengan alasan; baris lama tidak pernah diubah).
// INFORMASI/DOKUMENTASI saja: TIDAK menulis stok, reservasi, BOM, material issue, pemakaian, retur, fase/status run/unit, maupun revisi run (diaudit di tes).
// Command: Idempotency-Key per (actor, kunci) lewat v2_commands + hash isi (replay = respons sama, isi beda = 409). Baris unit dikunci SEBELUM replay-check
// sehingga dua penulis bersamaan serial; expectedVersion per seksi menolak penimpaan diam-diam (409 COMPONENT_VERSION_CONFLICT). Writer cohort fail-closed.
import { createHash, randomUUID } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { isProductionReaderEnabledFor, isProductionWriterEnabledFor, loadV2Flags, resolveProductionReaderState, resolveProductionWriterState } from "./v2FeatureFlags.js";
import { evidenceFileExists } from "../lib/productionEvidenceStore.js";
import { mediaKindOf } from "../lib/domain/productionSteps.js";
import { signEvidenceUrl } from "../routes/productionEvidenceMedia.js";
import {
  COMPONENT_SECTIONS, COMPONENT_SECTION_KEYS, LIMITS, MATERIAL_KINDS, buildComparison, detectDeviation, buildMeasurements, componentError, normalizeMediaItems, normalizeSectionData, materialLabel, summarizeLayers, summarizeResultLayers,
} from "../lib/domain/productionComponents.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// JSON kanonis (kunci terurut): jsonb Postgres mengurutkan ulang kunci, jadi perbandingan isi tidak boleh bergantung pada urutan kunci.
const canon = (v) => JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val));
const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");

// ---------------------------------------------------------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------------------------------------------------------
function signedMedia(media) {
  return (Array.isArray(media) ? media : []).map((m) => ({ url: m.url, kind: m.kind || "image", caption: m.caption ?? null, order: m.order ?? null, layerOrder: m.layerOrder ?? null, previewUrl: signEvidenceUrl(m.url) }));
}

const entryView = (row, actors) => ({
  version: row.version, data: row.payload, media: signedMedia(row.media), at: row.createdAt, runId: row.runId,
  actor: row.actorId ? { id: row.actorId, name: actors.get(row.actorId) ?? null } : null, correctionReason: row.reason ?? null,
});

/** Entri versi terbaru per seksi (dalam satu bacaan). */
export async function loadComponentEntries(client, unitId) {
  const rows = await client.unitComponentEntry.findMany({ where: { unitId }, orderBy: [{ section: "asc" }, { version: "asc" }] });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))];
  const users = actorIds.length ? await client.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const actors = new Map(users.map((u) => [u.id, u.name]));
  const current = {}; const history = [];
  for (const row of rows) {
    current[row.section] = row; // urut naik -> yang terakhir = terbaru
    history.push(row);
  }
  return { current, history, actors };
}

/** Konteks dari Sales untuk PIC QC (keluhan, request, berat customer) — rujukan BACA-SAJA; tidak pernah mengisi berat penguji aktual. */
export async function loadSalesContext(client, unitId) {
  const unit = await client.unit.findUnique({ where: { id: unitId }, select: { order: { select: { notes: true, complaintCategory: true, beratBadan: true, orderNumber: true } } } });
  const o = unit?.order;
  if (!o) return null;
  return { orderNumber: o.orderNumber ?? null, complaints: o.complaintCategory ?? [], request: o.notes ?? null, customerWeightKg: o.beratBadan ?? null };
}

/** Fakta untuk gerbang tahap (Meja): versi terbaru tiap seksi yang ditulis untuk Run ini (atau sebelum Run ada). Seksi dari Run lama yang dibatalkan tidak dihitung. */
export async function loadPreTeardownFacts(client, { unitId, runId }) {
  const rows = await client.unitComponentEntry.findMany({
    where: { unitId, section: { in: ["WHOLE_TEST_BEFORE", "LAYERS_BEFORE", "FOUNDATION_TEST_BEFORE"] }, OR: [{ runId }, { runId: null }] },
    orderBy: [{ section: "asc" }, { version: "asc" }], select: { section: true, version: true, payload: true, media: true },
  });
  const latest = {};
  for (const r of rows) latest[r.section] = r;
  // mediaUrls = foto/video PIC QC yang SUDAH tersimpan: dipakai sebagai dasar penutupan tahap routing (yang mewajibkan foto) — tidak ada unggahan ulang/angka disalin.
  const v = (k) => (latest[k] ? { version: latest[k].version, mediaUrls: (Array.isArray(latest[k].media) ? latest[k].media : []).map((m) => m.url) } : null);
  return { wholeTest: v("WHOLE_TEST_BEFORE"), layers: latest.LAYERS_BEFORE ? { version: latest.LAYERS_BEFORE.version, layersUnknown: !!latest.LAYERS_BEFORE.payload?.layersUnknown } : null, foundationTest: v("FOUNDATION_TEST_BEFORE") };
}

/**
 * Fakta gerbang PERAKITAN (Fase 4), diukur terhadap waktu di Run ini — bukan sekadar "pernah ada" — supaya putaran rework butuh catatan BARU:
 *  - foundationTestAfter.ok : uji fondasi baru ditulis SETELAH bukti tahap 6 terakhir (merakit ulang fondasi = uji ulang);
 *  - after.ok               : hasil aktual (AFTER) ditulis/diperbarui SETELAH uji fondasi baru dan SETELAH putusan QC gagal terakhir;
 *  - wholeTestAfter.ok      : uji kasur jadi ditulis SETELAH bukti tahap 7 terakhir dan setelah putusan QC gagal terakhir.
 * step6At/step7At = ms dari bukti Meja terakhir (null bila belum ada). Seksi dari Run lain tidak dihitung (hanya entri Run ini atau tanpa Run).
 */
export async function loadAssemblyFacts(client, { unitId, runId, step6At = null, step7At = null }) {
  const [rows, lastFail] = await Promise.all([
    client.unitComponentEntry.findMany({
      where: { unitId, section: { in: ["FOUNDATION_TEST_AFTER", "AFTER", "WHOLE_TEST_AFTER"] }, OR: [{ runId }, { runId: null }] },
      orderBy: [{ section: "asc" }, { version: "asc" }], select: { section: true, version: true, createdAt: true, media: true },
    }),
    client.qualityInspection.findFirst({ where: { runId, result: "FAIL_REWORK" }, orderBy: { inspectedAt: "desc" }, select: { inspectedAt: true, createdAt: true } }),
  ]);
  const latest = {}; for (const r of rows) latest[r.section] = r;
  const t = (r) => (r ? new Date(r.createdAt).getTime() : null);
  const failAt = lastFail ? new Date(lastFail.inspectedAt || lastFail.createdAt).getTime() : 0;
  const mediaUrls = (r) => (Array.isArray(r?.media) ? r.media : []).map((m) => m.url);
  const fta = latest.FOUNDATION_TEST_AFTER; const aft = latest.AFTER; const wta = latest.WHOLE_TEST_AFTER;
  const ftaOk = !!fta && (step6At == null || t(fta) > step6At);
  const aftOk = !!aft && t(aft) > Math.max(t(fta) ?? 0, failAt);
  const wtaOk = !!wta && t(wta) > Math.max(step7At ?? 0, step6At ?? 0, failAt); // putaran ini: lebih baru dari bukti modul terakhir (fondasi/lapisan) DAN putusan gagal terakhir
  return {
    foundationTestAfter: fta ? { version: fta.version, ok: ftaOk, mediaUrls: mediaUrls(fta) } : null,
    after: aft ? { version: aft.version, ok: aftOk } : null,
    wholeTestAfter: wta ? { version: wta.version, ok: wtaOk, mediaUrls: mediaUrls(wta) } : null,
  };
}

/** Saran (read-only, TIDAK tersimpan) dari bahan yang dipakai di tahap 6/7 — hanya mempermudah mengisi "Sesudah"; bukan data komponen sampai disimpan operator. */
async function loadSuggestions(client, unitId) {
  const run = await client.productionRun.findFirst({ where: { unitId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!run) return { foundation: [], layers: [] };
  const rows = await client.productionStepEvidence.findMany({ where: { runId: run.id, stepNo: { in: [6, 7] }, stepCode: { not: { startsWith: "DOC_" } } }, orderBy: { createdAt: "asc" } });
  const latest = new Map();
  for (const r of rows) if (!(r.payload && r.payload.outcome === "SKIPPED")) latest.set(r.stepNo, r);
  const ids = new Set();
  for (const r of latest.values()) for (const m of r.payload?.materials || []) if (m?.materialId) ids.add(m.materialId);
  const mats = ids.size ? await client.material.findMany({ where: { id: { in: [...ids] } }, select: { id: true, code: true, name: true, unit: true } }) : [];
  const byId = new Map(mats.map((m) => [m.id, m]));
  const toRef = (m) => { const x = byId.get(m.materialId); return x ? { kind: MATERIAL_KINDS.CATALOG, materialId: x.id, code: x.code, name: x.name, unit: x.unit } : null; };
  const pick = (stepNo) => (latest.get(stepNo)?.payload?.materials || []).map(toRef).filter(Boolean);
  return { foundation: pick(6), layers: pick(7) };
}

/** Bacaan kanonis satu unit (dipakai Meja, Corner, Dokumentasi, Unit 360, laporan). Cohort/izin diputuskan pemanggil (route). */
export async function getComponentNotes(client, unitId, { includeSuggestions = true } = {}) {
  if (!UUID.test(String(unitId))) return null;
  const unit = await client.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true } });
  if (!unit) return null;
  const { current, history, actors } = await loadComponentEntries(client, unitId);
  const sections = Object.fromEntries(COMPONENT_SECTION_KEYS.map((k) => [k, current[k] ? entryView(current[k], actors) : null]));
  if (sections.LAYERS_BEFORE) sections.LAYERS_BEFORE.summary = summarizeLayers(sections.LAYERS_BEFORE.data); // total dihitung dari ketebalan yang diketahui; kosong = belum lengkap
  for (const k of ["PLAN_RACIKAN", "AFTER"]) if (sections[k]) sections[k].summary = summarizeResultLayers(sections[k].data, sections.LAYERS_BEFORE?.data ?? null); // rencana / aktual: total tinggi atas->bawah
  const comparison = buildComparison({
    layersBefore: sections.LAYERS_BEFORE ? { data: sections.LAYERS_BEFORE.data, version: sections.LAYERS_BEFORE.version } : null,
    foundationBefore: sections.FOUNDATION_BEFORE ? { data: sections.FOUNDATION_BEFORE.data, version: sections.FOUNDATION_BEFORE.version } : null,
    after: sections.AFTER ? { data: sections.AFTER.data, version: sections.AFTER.version } : null,
    plan: sections.PLAN_RACIKAN ? { data: sections.PLAN_RACIKAN.data, version: sections.PLAN_RACIKAN.version } : null,
  });
  const measurements = buildMeasurements({
    wholeTest: sections.WHOLE_TEST_BEFORE ? { data: sections.WHOLE_TEST_BEFORE.data, version: sections.WHOLE_TEST_BEFORE.version } : null,
    foundationTest: sections.FOUNDATION_TEST_BEFORE ? { data: sections.FOUNDATION_TEST_BEFORE.data, version: sections.FOUNDATION_TEST_BEFORE.version } : null,
    layersBefore: sections.LAYERS_BEFORE ? { data: sections.LAYERS_BEFORE.data, version: sections.LAYERS_BEFORE.version } : null,
    wholeAfter: sections.WHOLE_TEST_AFTER ? { data: sections.WHOLE_TEST_AFTER.data, version: sections.WHOLE_TEST_AFTER.version } : null,
    foundationAfter: sections.FOUNDATION_TEST_AFTER ? { data: sections.FOUNDATION_TEST_AFTER.data, version: sections.FOUNDATION_TEST_AFTER.version } : null,
  });
  return {
    unitId: unit.id, unitCode: unit.unitCode, sections, comparison, measurements, salesContext: await loadSalesContext(client, unitId),
    history: history.map((r) => ({
      section: r.section, sectionLabel: COMPONENT_SECTIONS[r.section]?.label ?? r.section, version: r.version, at: r.createdAt, runId: r.runId, reason: r.reason ?? null,
      actor: r.actorId ? { id: r.actorId, name: actors.get(r.actorId) ?? null } : null, mediaCount: Array.isArray(r.media) ? r.media.length : 0, data: r.payload,
      superseded: current[r.section]?.version !== r.version,
    })),
    suggestions: includeSuggestions ? await loadSuggestions(client, unitId) : undefined,
  };
}

/** Ringkasan untuk laporan run: perbandingan + foto before/after (URL bertanda tangan). */
export async function getComponentReportBlock(client, unitId) {
  const notes = await getComponentNotes(client, unitId, { includeSuggestions: false });
  if (!notes) return null;
  const { sections } = notes;
  const before = [...(sections.LAYERS_BEFORE?.media ?? []), ...(sections.FOUNDATION_BEFORE?.media ?? [])];
  // Fase 4: media uji setelah perbaikan (fondasi baru + kasur jadi) ikut paket "sesudah".
  const after = [...(sections.AFTER?.media ?? []), ...(sections.FOUNDATION_TEST_AFTER?.media ?? []), ...(sections.WHOLE_TEST_AFTER?.media ?? [])];
  // Fase 2: media pengujian awal (kasur utuh + fondasi) ikut paket "sebelum"; pengukuran tampil TERPISAH (tidak dijumlahkan).
  const testMedia = [...(sections.WHOLE_TEST_BEFORE?.media ?? []), ...(sections.FOUNDATION_TEST_BEFORE?.media ?? [])];
  return { comparison: notes.comparison, measurements: notes.measurements, layersSummary: sections.LAYERS_BEFORE?.summary ?? null, status: notes.comparison.status, media: { before: [...before, ...testMedia], after }, mediaCount: before.length + testMedia.length + after.length };
}

/** Baris pesan untuk pengujian awal: tiga jenis pengukuran dilaporkan TERPISAH, tanpa dijumlahkan dan tanpa kategori otomatis. Data kosong = "Belum dicatat". */
export function measurementMessageLines(m) {
  if (!m?.recorded || !(m.recorded.whole || m.recorded.foundation || m.recorded.layers)) return [];
  const lines = ["🧪 PENGUJIAN AWAL (SEBELUM BONGKAR):"];
  const w = m.whole;
  lines.push(w
    ? `• Uji Kasur Utuh : ${w.complaintMatchLabel}; feel awal "${w.feelNote}"; beban ${w.testerWeightKg} kg (${w.testMethod}); penurunan kasur utuh ${w.wholeDropCm} cm`
    : "• Uji Kasur Utuh : Belum dicatat");
  const l = m.layers;
  lines.push(l ? `• Lapisan Awal   : ${l.label}` : "• Lapisan Awal   : Belum dicatat");
  const f = m.foundation;
  lines.push(f
    ? `• Uji Fondasi    : ${[f.systemLabel, f.material].filter(Boolean).join(" · ")}; ${f.unloadedHeightCm} cm tanpa beban → ${f.loadedHeightCm} cm dibebani ${f.testerWeightKg} kg (${f.testMethod}); penurunan fondasi ${f.dropCm} cm`
    : "• Uji Fondasi    : Belum dicatat");
  lines.push("• Catatan        : pengukuran kasur utuh, lapisan, dan fondasi berbeda dan tidak dijumlahkan.");
  return lines;
}

/** Ringkasan HASIL UJI SETELAH PERBAIKAN untuk pesan Sales (Fase 4): uji fondasi baru + uji kasur jadi, dengan perbandingan terhadap uji awal HANYA bila sebanding. Kosong = "Belum dicatat". Tidak dijumlahkan, tanpa label "amblas". */
export function assemblyMessageLines(m, { always = false } = {}) {
  const rec = m?.recorded || {};
  if (!rec.foundationAfter && !rec.wholeAfter && !always) return [];
  const fa = m?.foundationAfter; const wa = m?.wholeAfter; const cf = m?.comparisons?.foundation; const cw = m?.comparisons?.whole;
  const lines = ["🧪 HASIL UJI SETELAH PERBAIKAN:"];
  lines.push(fa ? `• Uji Fondasi Baru : ${[fa.systemLabel, fa.material].filter(Boolean).join(" · ")}; ${fa.unloadedHeightCm} cm tanpa beban → ${fa.loadedHeightCm} cm dibebani ${fa.testerWeightKg} kg (${fa.testMethod}); penurunan fondasi ${fa.dropCm} cm` : "• Uji Fondasi Baru : Belum dicatat");
  if (fa && cf?.text) lines.push(`   ↳ ${cf.text}`);
  lines.push(wa ? `• Uji Kasur Jadi  : ${wa.complaintMatchLabel}; feel "${wa.feelNote}"; beban ${wa.testerWeightKg} kg (${wa.testMethod}); penurunan kasur utuh ${wa.wholeDropCm} cm` : "• Uji Kasur Jadi  : Belum dicatat");
  if (wa && cw?.text) lines.push(`   ↳ ${cw.text}`);
  lines.push("• Catatan         : penurunan fondasi dan kasur utuh berbeda dan tidak dijumlahkan.");
  return lines;
}

/** Ringkasan RACIKAN RENCANA vs HASIL AKTUAL untuk pesan Sales (Fase 3). Data kosong = "Belum dicatat" (tidak dikarang). `always` = tampilkan bagian ini walau keduanya kosong (LAYANAN). */
export function planVsActualMessageLines(comparison, { always = false } = {}) {
  const plan = comparison?.plan ?? null; const actual = comparison?.actual ?? null;
  if (!plan && !actual && !always) return [];
  const item = (l) => `${l.actionLabel} ${l.label}${l.thicknessCm ? ` ${l.thicknessCm} cm` : ""}`;
  const lines = ["📐 RACIKAN RENCANA vs HASIL AKTUAL:"];
  const fPlan = plan ? (plan.foundation ? `${plan.foundation.actionLabel} ${plan.foundation.label}` : "tidak ada perubahan fondasi dicatat") : "Belum dicatat";
  const fAct = actual ? (actual.foundation ? `${actual.foundation.actionLabel} ${actual.foundation.label}` : "tidak ada perubahan fondasi dicatat") : "Belum dicatat";
  lines.push(`• Fondasi : rencana ${fPlan} → aktual ${fAct}`);
  const n = Math.max(plan?.layers?.length ?? 0, actual?.layers?.length ?? 0);
  for (let i = 0; i < n; i++) {
    const p = plan?.layers?.[i]; const a = actual?.layers?.[i];
    lines.push(`• Lapisan ${i + 1}: rencana ${p ? item(p) : (plan ? "tidak direncanakan" : "Belum dicatat")} → aktual ${a ? item(a) : (actual ? "tidak ada" : "Belum dicatat")}`);
  }
  if (!n && (plan || actual)) lines.push("• Lapisan : tidak ada lapisan dicatat");
  lines.push(`• Total tinggi lapisan: rencana ${plan?.summary?.totalThicknessCm != null ? `${plan.summary.totalThicknessCm} cm${plan.summary.totalComplete ? "" : " (belum lengkap)"}` : "Belum dicatat"} · aktual ${actual?.summary?.totalThicknessCm != null ? `${actual.summary.totalThicknessCm} cm${actual.summary.totalComplete ? "" : " (belum lengkap)"}` : "Belum dicatat"}${comparison?.planVsActual?.total?.differenceCm != null ? ` · selisih ${comparison.planVsActual.total.differenceCm > 0 ? "+" : ""}${comparison.planVsActual.total.differenceCm} cm` : ""}`);
  return lines;
}

/** Teks ringkas "Sebelum -> Sesudah" untuk pesan Sales. Data belum dicatat disebut jelas, bukan dikarang. */
export function componentMessageLines(comparison) {
  if (!comparison?.recordedAny) return [];
  const lines = ["🧩 KOMPONEN SEBELUM → SESUDAH:"];
  const f = comparison.foundation;
  if (f) lines.push(`• Fondasi : ${f.before ? [f.before.systemLabel, f.before.material].filter(Boolean).join(" · ") : "belum dicatat"} → ${f.final ? `${f.final.label} (${f.actionLabel})` : "belum dicatat"}`);
  for (const l of comparison.layers) {
    const b = l.before ? `${l.before.material || "—"}${l.before.thicknessCm ? ` ${l.before.thicknessCm} cm` : ""}` : "belum dicatat";
    const a = l.final ? `${l.final.label}${l.final.thicknessCm ? ` ${l.final.thicknessCm} cm` : ""} (${l.actionLabel})` : (l.outcome === "NOT_IN_FINAL" ? "tidak tercatat di hasil akhir" : "belum dicatat");
    lines.push(`• Lapisan ${l.order}: ${b} → ${a}`);
  }
  if (comparison.kept.length) lines.push(`• Tetap digunakan: ${comparison.kept.join("; ")}`);
  for (const g of comparison.gaps) lines.push(`• ${g.text}`);
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------------------------------------------------------
async function writerGate(tx, unitId) {
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  if (!isProductionWriterEnabledFor(state, unitId)) throw componentError("Produksi V2 tidak aktif untuk unit ini; catatan komponen belum bisa disimpan", 503, "COMPONENT_WRITER_OFF");
}

/** Untuk route unggah foto: kenali unit + writer cohort SEBELUM menerima berkas apa pun. */
export async function assertCanUploadComponentMedia(prisma, { unitId }) {
  if (!UUID.test(String(unitId))) throw componentError("Unit tidak ditemukan", 404, "COMPONENT_UNIT_NOT_FOUND");
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } });
  if (!unit) throw componentError("Unit tidak ditemukan", 404, "COMPONENT_UNIT_NOT_FOUND");
  await writerGate(prisma, unitId);
  return unit;
}

async function otherUnitUsesFile(tx, unitId, url) {
  const needle = JSON.stringify([{ url }]);
  const a = await tx.$queryRaw`SELECT 1 AS x FROM production_step_evidence_v2 e JOIN production_runs_v2 r ON r.id = e.run_id WHERE r.unit_id <> ${unitId}::uuid AND e.media @> ${needle}::jsonb LIMIT 1`;
  if (a.length) return true;
  const b = await tx.$queryRaw`SELECT 1 AS x FROM unit_component_entries_v2 c WHERE c.unit_id <> ${unitId}::uuid AND c.media @> ${needle}::jsonb LIMIT 1`;
  return b.length > 0;
}

// Atribut snapshot yang ditambahkan Fase 3 (supplier, kelompok) tidak dihitung saat menilai "isi sama dengan versi terkini" — entri lama tanpa atribut itu tidak memicu versi baru hanya karena snapshot diperkaya.
const SNAPSHOT_EXTRAS = new Set(["supplier", "itemGroup"]);
function stripSnapshotExtras(v) {
  if (Array.isArray(v)) return v.map(stripSnapshotExtras);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !SNAPSHOT_EXTRAS.has(k)).map(([k, x]) => [k, stripSnapshotExtras(x)]));
  return v;
}

// Fase 4: hasil aktual yang MENYIMPANG dari racikan rencana wajib disertai alasan (dicatat sebagai bagian dari revisi berversi). Tanpa racikan rencana = tidak ada yang dibandingkan (perilaku lama).
async function assertDeviationExplained(tx, unitId, afterData) {
  if (afterData.deviationNote) return;
  const latestOf = (section) => tx.unitComponentEntry.findFirst({ where: { unitId, section }, orderBy: { version: "desc" }, select: { payload: true, version: true } });
  const [plan, layersBefore, foundationBefore] = await Promise.all([latestOf("PLAN_RACIKAN"), latestOf("LAYERS_BEFORE"), latestOf("FOUNDATION_BEFORE")]);
  if (!plan) return;
  const dev = detectDeviation({ plan: { data: plan.payload, version: plan.version }, after: { data: afterData, version: null }, layersBefore: layersBefore ? { data: layersBefore.payload } : null, foundationBefore: foundationBefore ? { data: foundationBefore.payload } : null });
  if (dev.hasDeviation) throw componentError("Hasil aktual berbeda dari racikan rencana — tulis alasan perbedaannya", 422, "COMPONENT_DEVIATION_REASON_REQUIRED", { items: dev.items });
}

// Ganti ref katalog dengan snapshot server (kode/nama/satuan); bahan harus ada & aktif. Tidak ada klien yang bisa memalsukan nama katalog.
async function resolveMaterialRefs(tx, data) {
  const refs = [];
  const visit = (holder, key) => { if (holder?.[key]?.kind === MATERIAL_KINDS.CATALOG) refs.push([holder, key]); };
  visit(data, "material");
  for (const l of data.layers || []) visit(l, "material");
  visit(data.foundation, "material");
  if (!refs.length) return data;
  const ids = [...new Set(refs.map(([h, k]) => h[k].materialId))];
  const mats = await tx.material.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, code: true, name: true, unit: true, vendor: true, itemGroup: true } });
  const byId = new Map(mats.map((m) => [m.id, m]));
  for (const [h, k] of refs) {
    const m = byId.get(h[k].materialId);
    if (!m) throw componentError("Bahan katalog tidak ditemukan atau tidak aktif — pilih bahan lain atau “Bahan manual”", 422, "COMPONENT_MATERIAL_NOT_FOUND");
    h[k] = { kind: MATERIAL_KINDS.CATALOG, materialId: m.id, code: m.code, name: m.name, unit: m.unit, ...(m.vendor ? { supplier: m.vendor } : {}), ...(m.itemGroup ? { itemGroup: m.itemGroup } : {}) };
  }
  return data;
}

/**
 * Simpan satu seksi (versi baru). expectedVersion = versi terakhir yang dilihat klien (0 = belum ada). Koreksi (expectedVersion >= 1) wajib beralasan.
 * Isi sama dengan versi terkini -> tidak menulis baris baru (unchanged:true). Respons replay identik tanpa penulisan.
 */
export async function recordComponentSection(prisma, { unitId, section, actor, idempotencyKey, expectedVersion, data, media = [], reason = null }) {
  if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) throw componentError("Idempotency-Key wajib diisi (12-128 karakter)", 400, "IDEMPOTENCY_KEY_INVALID");
  if (!UUID.test(String(unitId))) throw componentError("Unit tidak ditemukan", 404, "COMPONENT_UNIT_NOT_FOUND");
  if (!COMPONENT_SECTIONS[section]) throw componentError("Seksi catatan komponen tidak dikenal", 400, "COMPONENT_SECTION_INVALID");
  const exp = Number(expectedVersion);
  if (!Number.isInteger(exp) || exp < 0) throw componentError("expectedVersion wajib diisi (0 bila belum ada catatan)", 400, "COMPONENT_VERSION_REQUIRED");
  const normalized = normalizeSectionData(section, data);
  const items = normalizeMediaItems(media, { kindOf: mediaKindOf, section, layerCount: Array.isArray(normalized.layers) ? normalized.layers.length : 0 });
  const minMedia = COMPONENT_SECTIONS[section].minMedia ?? 0;
  if (items.length < minMedia) throw componentError(section === "FOUNDATION_TEST_BEFORE" ? "Lampirkan foto/video yang memperlihatkan pengukuran fondasi dengan beban" : "Lampirkan foto/video kondisi sebelum bongkar yang memperlihatkan PIC QC sedang menguji kasur", 422, "COMPONENT_MEDIA_REQUIRED");
  const correcting = exp >= 1;
  const cleanReason = typeof reason === "string" ? reason.trim() : "";
  if (correcting && cleanReason.length < LIMITS.REASON_MIN) throw componentError(`Alasan koreksi wajib diisi (minimal ${LIMITS.REASON_MIN} karakter)`, 400, "COMPONENT_REASON_REQUIRED");
  if (cleanReason.length > LIMITS.REASON_MAX) throw componentError(`Alasan koreksi terlalu panjang (maksimal ${LIMITS.REASON_MAX} karakter)`, 400, "COMPONENT_REASON_TOO_LONG");
  const actorKey = actor.id || "SYSTEM";
  const requestHash = hash({ commandType: "COMPONENT_RECORD", unitId, section, expectedVersion: exp, data: normalized, media: items.map((i) => [i.url, i.caption, i.layerOrder ?? null]), reason: correcting ? cleanReason : null });

  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "units", unitId);
    const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actorKey, idempotencyKey } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw componentError("Idempotency-Key dipakai untuk isi berbeda", 409, "IDEMPOTENCY_CONFLICT");
      if (replay.status !== "APPLIED") throw componentError("Perintah masih diproses", 409, "COMMAND_IN_PROGRESS");
      return { replayed: true, ...replay.response };
    }
    const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true } });
    if (!unit) throw componentError("Unit tidak ditemukan", 404, "COMPONENT_UNIT_NOT_FOUND");
    await writerGate(tx, unitId);
    const latest = await tx.unitComponentEntry.findFirst({ where: { unitId, section }, orderBy: { version: "desc" } });
    const currentVersion = latest?.version ?? 0;
    if (exp !== currentVersion) {
      throw componentError("Catatan ini sudah diubah orang lain — muat ulang lalu periksa sebelum menyimpan", 409, "COMPONENT_VERSION_CONFLICT", { currentVersion, expectedVersion: exp });
    }
    for (const it of items) {
      if (!evidenceFileExists(it.url)) throw componentError("Ada foto yang belum selesai terunggah — unggah ulang lalu simpan", 422, "COMPONENT_MEDIA_NOT_FOUND");
      if (await otherUnitUsesFile(tx, unitId, it.url)) throw componentError("Foto ini sudah dipakai sebagai bukti unit lain dan tidak bisa dipakai di sini", 409, "COMPONENT_MEDIA_OTHER_UNIT");
    }
    const resolved = await resolveMaterialRefs(tx, normalized);
    // Perbedaan dari rencana dibandingkan setelah ref katalog di-resolve ke snapshot server (kode/nama) — rencana menyimpan snapshot yang sama; sebelum resolve, bahan katalog yang identik terbaca "berbeda".
    if (section === "AFTER") await assertDeviationExplained(tx, unitId, resolved);
    const mediaJson = items.map((i) => ({ url: i.url, kind: i.kind, caption: i.caption, order: i.order, ...(i.layerOrder ? { layerOrder: i.layerOrder } : {}) }));
    const command = await tx.v2Command.create({
      data: { domain: "PRODUCTION", actorId: actorKey, idempotencyKey, commandType: "COMPONENT_RECORD", aggregateType: "Unit", aggregateId: unitId, expectedRevision: exp, requestHash },
    });

    // Tanpa perubahan bermakna -> tidak ada versi baru (jangan menggandakan histori dengan salinan identik).
    // Pengecualian: hasil aktual (AFTER) yang dikonfirmasi ULANG dengan alasan koreksi (mis. setelah rework hasilnya ternyata sama) tetap menjadi versi baru — gerbang putaran berikutnya menuntut
    // catatan yang lebih baru dari putusan gagal; tanpa ini PIC Meja tidak bisa melanjutkan.
    if (latest && !(correcting && section === "AFTER") && canon(stripSnapshotExtras(latest.payload)) === canon(stripSnapshotExtras(resolved)) && canon(latest.media) === canon(mediaJson)) {
      const response = { unitId, section, version: latest.version, unchanged: true };
      await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision: latest.version, response, completedAt: new Date() } });
      return { replayed: false, ...response };
    }

    const run = await tx.productionRun.findFirst({ where: { unitId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const row = await tx.unitComponentEntry.create({
      data: { id: randomUUID(), unitId, runId: run?.id ?? null, section, version: currentVersion + 1, payload: resolved, media: mediaJson, reason: correcting ? cleanReason : null, actorId: actor.id || null, commandId: command.id },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: unitId, eventType: correcting ? EVENT_TYPES.PRODUCTION_COMPONENT_CORRECTED : EVENT_TYPES.PRODUCTION_COMPONENT_RECORDED, actorId: actor.id || null,
      metadata: { unitCode: unit.unitCode, runId: run?.id ?? null, section, sectionLabel: COMPONENT_SECTIONS[section].label, version: row.version, mediaCount: mediaJson.length, ...(correcting ? { reason: cleanReason } : {}) },
    });
    const response = { unitId, section, version: row.version, corrected: correcting, unchanged: false, mediaCount: mediaJson.length };
    await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision: row.version, response, completedAt: new Date() } });
    return { replayed: false, ...response };
  });
}

/** Pencarian katalog bahan untuk formulir (tanpa harga/stok): id, kode, nama, satuan + supplier & kelompok bila ada di master (tidak dikarang). */
export async function searchComponentMaterials(client, q) {
  const needle = String(q || "").trim().slice(0, 60);
  const where = { active: true, ...(needle ? { OR: [{ code: { contains: needle, mode: "insensitive" } }, { name: { contains: needle, mode: "insensitive" } }] } : {}) };
  const rows = await client.material.findMany({ where, orderBy: [{ name: "asc" }], take: 25, select: { id: true, code: true, name: true, unit: true, vendor: true, itemGroup: true } });
  return rows.map((m) => ({ kind: MATERIAL_KINDS.CATALOG, materialId: m.id, code: m.code, name: m.name, unit: m.unit, supplier: m.vendor || null, itemGroup: m.itemGroup || null, label: materialLabel({ kind: MATERIAL_KINDS.CATALOG, code: m.code, name: m.name }) }));
}

// Cohort baca: pemanggil memastikan unit ada di reader cohort sebelum membaca.
export async function isUnitReadable(prisma, unitId) {
  const state = resolveProductionReaderState(await loadV2Flags(prisma));
  return isProductionReaderEnabledFor(state, unitId);
}
