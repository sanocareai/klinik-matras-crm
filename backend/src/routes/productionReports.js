// Reporting & KPI Production–Warehouse (P11) — /api/production-v2/reports/*. BACA-SAJA (tidak ada mutasi). requireAuth sudah dipasang di
// productionExperienceRouter. Semua query mengikuti production_v2_reader (cohort unitIds; OFF -> respons kosong readerMode OFF) dan hanya
// membaca unit V2 dalam cohort (unit lain / V1 tidak pernah dimuat -> tidak ada IDOR lintas unit).
// Izin: PRODUCTION_REPORT_READ (ADMIN/OWNER/PRODUCTION_LEAD) = seluruh laporan; PRODUCTION_REPORT_WAREHOUSE (WAREHOUSE + pemegang READ) = laporan
// Gudang; PRODUCTION_REPORT_SELF (PIC/dokumentasi/QC) = hanya ringkasan pekerjaan sendiri. Finance/Sales/Driver: tidak ada.
import express from "express";
import { prisma } from "../db.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { BOARD_DEFAULTS, PRIORITY_LABEL, stationLabel } from "../lib/domain/productionBoard.js";
import { DATE_BASES, DOC_FILTERS, GRANULARITY, METRICS, MIN_SAMPLE, QC_FILTERS, SLA, SLA_NOTE, STATUS_BUCKETS } from "../lib/domain/productionMetrics.js";
import { PRODUCTION_READER_MODE, loadV2Flags, resolveProductionReaderState } from "../services/v2FeatureFlags.js";
import { buildReportContext, drillReport, mySummary, operatorListDoc, operatorsDoc, stationListDoc, stationsDoc, summaryReport, unitDetailDoc, unitsDoc, warehouseDoc } from "../services/productionReportingService.js";
import { buildPdf, buildXlsx, exportFileName } from "../services/productionReportExport.js";

export const productionReportsRouter = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const caps = (user) => {
  const full = hasPermission(user, P.PRODUCTION_REPORT_READ);
  const warehouse = full || hasPermission(user, P.PRODUCTION_REPORT_WAREHOUSE);
  const self = hasPermission(user, P.PRODUCTION_REPORT_SELF);
  return { full, warehouse, self, any: full || warehouse || self };
};
function deny(res, message = "Anda tidak punya akses ke laporan ini", code = "REPORT_FORBIDDEN") { return res.status(403).json({ error: message, code }); }
function handleErr(err, res) {
  if (Number.isInteger(err?.statusCode)) return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  console.error("Production report error:", err);
  return res.status(500).json({ error: "Terjadi kesalahan di server" });
}
async function readerCohort() {
  const state = resolveProductionReaderState(await loadV2Flags(prisma));
  if (state.mode === PRODUCTION_READER_MODE.OFF) return null;
  const ids = [...state.unitIds];
  return ids.length ? ids : null;
}
const OFF = (extra = {}) => ({ readerMode: "OFF", message: "Laporan produksi belum aktif — laporan terisi setelah Production Lead mengaktifkannya untuk unit terkait.", ...extra });
const query = (req) => ({ from: req.query.from, to: req.query.to, station: req.query.station, operator: req.query.operator, step: req.query.step, status: req.query.status, priority: req.query.priority, service: req.query.service, qc: req.query.qc, docs: req.query.docs, granularity: req.query.granularity });

// Dokumen laporan menurut jenis + izin. Satu fungsi dipakai JSON dan export -> layar = berkas.
async function documentFor(kind, req, { metric = null, runId = null } = {}) {
  const c = caps(req.user);
  const unitIds = await readerCohort();
  if (!unitIds) return { off: true };
  const needFull = ["summary", "stations", "operators", "units", "drill", "unit"].includes(kind);
  if (needFull && !c.full) return { forbidden: true };
  if (kind === "warehouse" && !c.warehouse) return { forbidden: true };
  const ctx = await buildReportContext(prisma, { unitIds, query: query(req) });
  switch (kind) {
    case "summary": return { doc: summaryReport(ctx) };
    case "stations": return { doc: stationsDoc(ctx) };
    case "operators": return { doc: operatorsDoc(ctx) };
    case "warehouse": return { doc: warehouseDoc(ctx) };
    case "units": return { doc: unitsDoc(ctx) };
    case "drill": return { doc: drillReport(ctx, metric) };
    case "unit": { if (!UUID.test(runId || "")) return { notFound: true }; const d = unitDetailDoc(ctx, runId); return d ? { doc: d } : { notFound: true }; }
    default: return { notFound: true };
  }
}
const strip = (doc) => { const { runIds, ...rest } = doc; return rest; };
const send = (res, r) => {
  if (r.off) return res.json(OFF());
  if (r.forbidden) return deny(res);
  if (r.notFound) return res.status(404).json({ error: "Laporan tidak ditemukan atau di luar cohort", code: "REPORT_NOT_FOUND" });
  return res.json({ readerMode: "COHORT", ...strip(r.doc) });
};

productionReportsRouter.get("/meta", async (req, res) => {
  try {
    const c = caps(req.user);
    if (!c.any) return deny(res);
    const unitIds = await readerCohort();
    const base = { capabilities: { targetWrite: hasPermission(req.user, P.PRODUCTION_TARGET_WRITE), summary: c.full, stations: c.full, operators: c.full, units: c.full, warehouse: c.warehouse, self: c.self }, minSample: MIN_SAMPLE, granularities: GRANULARITY, dateBases: DATE_BASES, sla: { ...SLA, note: SLA_NOTE } };
    if (!unitIds) return res.json({ ...OFF(), ...base });
    const meta = { ...base, readerMode: "COHORT", targetPerHari: BOARD_DEFAULTS.dailyTarget, targetNote: "Target harian = konfigurasi sistem (belum ada target tercatat).",
      stations: BOARD_DEFAULTS.stations.map((code) => ({ code, label: stationLabel(code) })), capacityPerStation: BOARD_DEFAULTS.capacityPerStation,
      statuses: Object.entries(STATUS_BUCKETS).map(([key, label]) => ({ key, label })), priorities: [{ key: 0, label: PRIORITY_LABEL[0] }, { key: 1, label: PRIORITY_LABEL[1] }], qcFilters: QC_FILTERS, docFilters: DOC_FILTERS,
      metrics: METRICS.map((m) => ({ key: m.key, group: m.group, label: m.label, unit: m.unit, kind: m.kind, formula: m.formula, basis: m.basis === "snapshot" ? "Posisi saat ini" : (DATE_BASES[m.basis] || m.basis), note: m.note || null })) };
    if (c.full) {
      const ctx = await buildReportContext(prisma, { unitIds, query: {} });
      meta.operators = [...ctx.operatorNames].map(([id, name]) => ({ id, name })).sort((a, b) => String(a.name).localeCompare(String(b.name), "id"));
      meta.services = [...ctx.serviceLabels].map(([code, label]) => ({ code, label })).sort((a, b) => String(a.label).localeCompare(String(b.label), "id"));
      meta.coverage = ctx.coverage;
      meta.targetPerHari = ctx.targets.perDay; meta.targetNote = ctx.targets.note;
    }
    return res.json(meta);
  } catch (err) { return handleErr(err, res); }
});

for (const kind of ["summary", "stations", "operators", "warehouse", "units"]) {
  productionReportsRouter.get(`/${kind}`, async (req, res) => { try { send(res, await documentFor(kind, req)); } catch (err) { handleErr(err, res); } });
}
productionReportsRouter.get("/drill/:metric", async (req, res) => { try { send(res, await documentFor("drill", req, { metric: req.params.metric })); } catch (err) { handleErr(err, res); } });
productionReportsRouter.get("/units/:runId", async (req, res) => { try { send(res, await documentFor("unit", req, { runId: req.params.runId })); } catch (err) { handleErr(err, res); } });

// Daftar unit pembentuk angka Meja / PIC (klik angka di kartu). Izin penuh; himpunan dari laporan yang sama -> jumlah = angka.
productionReportsRouter.get("/stations/:code/units/:list", async (req, res) => {
  try {
    if (!caps(req.user).full) return deny(res);
    const unitIds = await readerCohort(); if (!unitIds) return res.json(OFF());
    const doc = stationListDoc(await buildReportContext(prisma, { unitIds, query: query(req) }), req.params.code, req.params.list);
    return doc ? res.json({ readerMode: "COHORT", ...strip(doc) }) : res.status(404).json({ error: "Daftar tidak ditemukan", code: "REPORT_NOT_FOUND" });
  } catch (err) { return handleErr(err, res); }
});
productionReportsRouter.get("/operators/:key/units/:list", async (req, res) => {
  try {
    if (!caps(req.user).full) return deny(res);
    const unitIds = await readerCohort(); if (!unitIds) return res.json(OFF());
    const doc = operatorListDoc(await buildReportContext(prisma, { unitIds, query: query(req) }), req.params.key, req.params.list);
    return doc ? res.json({ readerMode: "COHORT", ...strip(doc) }) : res.status(404).json({ error: "Daftar tidak ditemukan", code: "REPORT_NOT_FOUND" });
  } catch (err) { return handleErr(err, res); }
});

// Daftar unit pembentuk angka Gudang (tanpa PIC/harga) — izin Gudang cukup.
productionReportsRouter.get("/warehouse/units/:list", async (req, res) => {
  try {
    const c = caps(req.user); if (!c.warehouse) return deny(res);
    const unitIds = await readerCohort(); if (!unitIds) return res.json(OFF());
    const ctx = await buildReportContext(prisma, { unitIds, query: query(req) });
    const doc = warehouseDoc(ctx);
    const ids = doc.runIds?.[req.params.list];
    if (!ids) return res.status(404).json({ error: "Daftar Gudang tidak dikenal", code: "REPORT_NOT_FOUND" });
    const rows = ids.map((id) => ctx.factsByRun.get(id)).filter(Boolean).map((f) => ({ runId: f.runId, unitId: f.unitId, unitCode: f.unitCode, orderNumber: f.orderNumber, station: f.stationCode ? stationLabel(f.stationCode) : null }));
    return res.json({ readerMode: "COHORT", list: req.params.list, period: doc.coverage.period, rows });
  } catch (err) { return handleErr(err, res); }
});

productionReportsRouter.get("/my-summary", async (req, res) => {
  try {
    const c = caps(req.user); if (!c.self && !c.full) return deny(res);
    const unitIds = await readerCohort(); if (!unitIds) return res.json(OFF());
    return res.json({ readerMode: "COHORT", ...(await mySummary(prisma, { user: req.user, unitIds, query: query(req) })) });
  } catch (err) { return handleErr(err, res); }
});

// GET /export?report=summary|stations|operators|warehouse|units|drill|unit&format=xlsx|pdf[&metric=][&runId=] + filter yang sama.
productionReportsRouter.get("/export", async (req, res) => {
  try {
    const kind = String(req.query.report || "summary"); const format = String(req.query.format || "xlsx");
    if (!["xlsx", "pdf"].includes(format)) return res.status(400).json({ error: "Format harus xlsx atau pdf", code: "REPORT_FORMAT_INVALID" });
    const r = await documentFor(kind, req, { metric: req.query.metric, runId: req.query.runId });
    if (r.off) return res.status(409).json({ ...OFF(), code: "PRODUCTION_V2_READER_OFF" });
    if (r.forbidden) return deny(res);
    if (r.notFound) return res.status(404).json({ error: "Laporan tidak ditemukan atau di luar cohort", code: "REPORT_NOT_FOUND" });
    const now = new Date(r.doc.generatedAt);
    const name = exportFileName(r.doc, format, now);
    const buf = format === "xlsx" ? await buildXlsx(r.doc, { pengekspor: req.user.name || "", now }) : await buildPdf(r.doc, { pengekspor: req.user.name || "" });
    res.setHeader("Content-Type", format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(buf);
  } catch (err) { return handleErr(err, res); }
});
