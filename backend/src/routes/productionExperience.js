// Production Experience V2 (P8): Planner papan meja, PIC Table/Corner (PWA), Andon, antrean Gudang produksi, laporan Sales.
// Bacaan digerbang production_v2_reader (cohort unitIds; OFF -> respons kosong readerMode OFF, bukan error). Mutasi digerbang
// production_v2_writer di dalam command owner (P3 SCHEDULE_PLAN, P8 bukti tahap/kekurangan bahan). Server = otoritas izin; UI hanya
// menyembunyikan aksi. Pesan berbahasa Indonesia.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAnyPermission, requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { createProductionPlan, scheduleProductionPlan } from "../services/productionPlanningCommandService.js";
import { recordProductionStep, reportMaterialShortage, resolveMaterialShortage } from "../services/productionStepCommandService.js";
import { confirmUnitArrival, listReceivingLocations } from "../services/unitCustodyCommandService.js";
import {
  getAndonBoard, getProductionBoard, getProductionReport, getRunCard, getWarehouseProductionQueue, listWorkerQueue,
} from "../services/productionExperienceReadService.js";
import { productionEvidenceUploadRouter } from "./productionEvidenceMedia.js";
import { PRODUCTION_READER_MODE, loadV2Flags, resolveProductionReaderState } from "../services/v2FeatureFlags.js";
import { BOARD_DEFAULTS } from "../lib/domain/productionBoard.js";

export const productionExperienceRouter = express.Router();
productionExperienceRouter.use(requireAuth);

const READ_PERMS = [P.UNIT_READ, P.INVENTORY_READ];

function handleErr(err, res) {
  if (Number.isInteger(err?.statusCode)) {
    return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.details ? { details: err.details } : {}) });
  }
  if (err?.code === "P2002") return res.status(409).json({ error: "Data yang sama sedang diproses — muat ulang lalu coba lagi", code: "PRODUCTION_V2_DUPLICATE" });
  if (err?.code === "P2028" || err?.code === "P2034") return res.status(409).json({ error: "Server sedang sibuk memproses perintah lain untuk unit ini — coba lagi", code: "PRODUCTION_V2_BUSY" });
  console.error("Production experience error:", err);
  return res.status(500).json({ error: "Terjadi kesalahan di server" });
}

// Reader gate: OFF -> null (pemanggil mengirim respons kosong). Tanpa GLOBAL (kontrak fail-closed hotfix pra-P7B).
async function readerCohort() {
  const state = resolveProductionReaderState(await loadV2Flags(prisma));
  if (state.mode === PRODUCTION_READER_MODE.OFF) return null;
  const unitIds = [...state.unitIds];
  return unitIds.length ? unitIds : null;
}
const inert = (res, extra = {}) => res.json({ readerMode: "OFF", ...extra });
const idem = (req) => req.get("Idempotency-Key") || req.body?.idempotencyKey;

// ---- Bacaan ------------------------------------------------------------------------------------------------------------------
productionExperienceRouter.get("/config", requireAnyPermission(...READ_PERMS), async (_req, res) => {
  try {
    const unitIds = await readerCohort();
    res.json({ readerMode: unitIds ? "COHORT" : "OFF", board: { dailyTarget: BOARD_DEFAULTS.dailyTarget, stations: BOARD_DEFAULTS.stations, capacityPerStation: BOARD_DEFAULTS.capacityPerStation } });
  } catch (err) { handleErr(err, res); }
});

// GET /api/production-v2/board?date=YYYY-MM-DD
productionExperienceRouter.get("/board", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const unitIds = await readerCohort();
    if (!unitIds) return inert(res, { stations: [], unscheduled: { plans: [], units: [] } });
    res.json({ readerMode: "COHORT", ...(await getProductionBoard(prisma, { date: req.query.date ? String(req.query.date) : null, unitIds })) });
  } catch (err) { handleErr(err, res); }
});

// GET /api/production-v2/andon?date=YYYY-MM-DD — kiosk TV (read-only, tetap wajib login).
productionExperienceRouter.get("/andon", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const unitIds = await readerCohort();
    if (!unitIds) return inert(res, { stations: [], counts: {} });
    res.json({ readerMode: "COHORT", ...(await getAndonBoard(prisma, { date: req.query.date ? String(req.query.date) : null, unitIds })) });
  } catch (err) { handleErr(err, res); }
});

// GET /api/production-v2/runs/:runId/card — kartu kerja satu unit (pekerja/Planner).
productionExperienceRouter.get("/runs/:runId/card", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const unitIds = await readerCohort();
    if (!unitIds) return res.status(404).json({ error: "Kartu produksi tidak tersedia", code: "PRODUCTION_V2_READER_OFF" });
    const card = await getRunCard(prisma, req.params.runId, { unitIds });
    if (!card) return res.status(404).json({ error: "Kartu produksi tidak ditemukan", code: "RUN_NOT_FOUND" });
    res.json({ readerMode: "COHORT", ...card });
  } catch (err) { handleErr(err, res); }
});

// GET /api/production-v2/worker/:lane (table|corner) — antrean milik operator yang login.
productionExperienceRouter.get("/worker/:lane", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const lane = req.params.lane === "corner" ? "CORNER" : req.params.lane === "table" ? "TABLE" : null;
    if (!lane) return res.status(404).json({ error: "Antrean tidak dikenal" });
    const unitIds = await readerCohort();
    if (!unitIds) return inert(res, { items: [], operator: null });
    res.json({ readerMode: "COHORT", lane, ...(await listWorkerQueue(prisma, { unitIds, userId: req.user.id, lane })) });
  } catch (err) { handleErr(err, res); }
});

// GET /api/production-v2/warehouse/queue — kebutuhan bahan, kekurangan, unit masuk, barang jadi.
productionExperienceRouter.get("/warehouse/queue", requirePermission(P.INVENTORY_READ), async (_req, res) => {
  try {
    const unitIds = await readerCohort();
    if (!unitIds) return inert(res, { shortages: [], materialNeeds: [], inbound: [], finishedGoods: [], kpi: {} });
    res.json({ readerMode: "COHORT", ...(await getWarehouseProductionQueue(prisma, { unitIds })) });
  } catch (err) { handleErr(err, res); }
});

// GET /api/production-v2/runs/:runId/report — paket laporan before–process–after (Sales/Production).
productionExperienceRouter.get("/runs/:runId/report", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const unitIds = await readerCohort();
    if (!unitIds) return res.status(404).json({ error: "Laporan produksi tidak tersedia", code: "PRODUCTION_V2_READER_OFF" });
    const report = await getProductionReport(prisma, req.params.runId, { unitIds });
    if (!report) return res.status(404).json({ error: "Laporan tidak ditemukan", code: "RUN_NOT_FOUND" });
    res.json({ readerMode: "COHORT", ...report });
  } catch (err) { handleErr(err, res); }
});

// ---- Mutasi ------------------------------------------------------------------------------------------------------------------
// POST /api/production-v2/plans { runId, productionDate, stationCode, priority, workCenterId, operatorId, cornerOperatorId?, cornerWorkCenterId? }
// "Rencanakan unit": buat rencana (P3) lalu jadwalkan ke meja (P3 SCHEDULE_PLAN). Dua command idempoten dengan kunci turunan —
// aman diulang setelah galat jaringan (replay tidak menggandakan).
productionExperienceRouter.post("/plans", requirePermission(P.PRODUCTION_ASSIGNMENT_WRITE), async (req, res) => {
  try {
    const key = idem(req);
    if (!key || key.length > 110) return res.status(400).json({ error: "Idempotency-Key wajib diisi (12-110 karakter)", code: "IDEMPOTENCY_KEY_INVALID" });
    const created = await createProductionPlan(prisma, { runId: req.body?.runId, actorId: req.user.id, idempotencyKey: `${key}:create` });
    const scheduled = await scheduleProductionPlan(prisma, {
      planId: created.planId, actorId: req.user.id, idempotencyKey: `${key}:schedule`, expectedRevision: created.revision,
      productionDate: req.body?.productionDate, stationCode: req.body?.stationCode, priority: req.body?.priority,
      workCenterId: req.body?.workCenterId, operatorId: req.body?.operatorId,
      cornerWorkCenterId: req.body?.cornerWorkCenterId, cornerOperatorId: req.body?.cornerOperatorId,
    });
    res.status(201).json({ ...scheduled, created: !created.replayed });
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-v2/plans/:id/schedule { expectedRevision, productionDate|null, stationCode|null, priority, workCenterId, operatorId, ... }
productionExperienceRouter.post("/plans/:id/schedule", requirePermission(P.PRODUCTION_ASSIGNMENT_WRITE), async (req, res) => {
  try {
    res.json(await scheduleProductionPlan(prisma, {
      planId: req.params.id, actorId: req.user.id, idempotencyKey: idem(req), expectedRevision: req.body?.expectedRevision,
      productionDate: req.body?.productionDate ?? null, stationCode: req.body?.stationCode ?? null, priority: req.body?.priority,
      workCenterId: req.body?.workCenterId, operatorId: req.body?.operatorId,
      cornerWorkCenterId: req.body?.cornerWorkCenterId, cornerOperatorId: req.body?.cornerOperatorId,
    }));
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-v2/runs/:runId/steps/:stepNo { expectedRevision, workCenterId, payload, media }
productionExperienceRouter.post("/runs/:runId/steps/:stepNo", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    res.json(await recordProductionStep(prisma, {
      runId: req.params.runId, stepNo: Number(req.params.stepNo), actorId: req.user.id, idempotencyKey: idem(req),
      expectedRevision: req.body?.expectedRevision, workCenterId: req.body?.workCenterId, payload: req.body?.payload ?? {}, media: req.body?.media ?? [],
    }));
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-v2/runs/:runId/material-shortage { expectedRevision, workCenterId, items: [{materialId, qty?, note?}], note? }
productionExperienceRouter.post("/runs/:runId/material-shortage", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    res.status(201).json(await reportMaterialShortage(prisma, {
      runId: req.params.runId, actorId: req.user.id, idempotencyKey: idem(req), expectedRevision: req.body?.expectedRevision,
      workCenterId: req.body?.workCenterId, items: req.body?.items, note: req.body?.note,
    }));
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-v2/material-shortages/:id/resolve { expectedRevision, note? } — Gudang (bahan sudah diserahkan lewat Material Issue P4).
productionExperienceRouter.post("/material-shortages/:id/resolve", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    res.json(await resolveMaterialShortage(prisma, {
      shortageId: req.params.id, actorId: req.user.id, idempotencyKey: idem(req), expectedRevision: req.body?.expectedRevision, note: req.body?.note,
    }));
  } catch (err) { handleErr(err, res); }
});

// GET /api/production-v2/receiving-locations — pemilih lokasi untuk kartu "Unit Tiba di Workshop" (Production, bukan Gudang).
productionExperienceRouter.get("/receiving-locations", requirePermission(P.UNIT_STAGE_WRITE), async (_req, res) => {
  try {
    res.json({ locations: await listReceivingLocations(prisma) });
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-v2/units/:unitId/confirm-arrival { locationId } — "Unit Tiba di Workshop".
// Izin UNIT_STAGE_WRITE (Production) — sengaja DIPISAH dari alur terima custody Gudang (INVENTORY_WRITE); tidak perlu buka workspace Gudang.
// Tidak ada expectedRevision dari klien: confirmUnitArrival menemukan handoff OFFERED unit ini dan memakai revisinya sendiri.
productionExperienceRouter.post("/units/:unitId/confirm-arrival", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    res.json(await confirmUnitArrival(prisma, {
      unitId: req.params.unitId, actorId: req.user.id, idempotencyKey: idem(req), locationId: req.body?.locationId,
    }));
  } catch (err) { handleErr(err, res); }
});

// Unggah bukti (multipart) — izin & cohort diperiksa di router media.
productionExperienceRouter.use(productionEvidenceUploadRouter);
