// Reporting & KPI Production–Warehouse (P11) — BACA-SAJA. Satu loader BULK (jumlah query KONSTAN, tidak bergantung jumlah unit: tanpa N+1)
// membangun "fakta unit" dari data kanonis P1–P10; semua metrik/laporan dihitung dari fakta itu lewat lib/domain/productionMetrics.js.
//
// Sumber data (semua production_*_v2 / ledger yang SUDAH ADA — tidak ada tabel baru):
//   production_runs_v2 (+unit, order, layanan) · production_run_plans_v2 (jadwal, meja, PIC, prioritas, target selesai, urutan manual)
//   production_operation_runs_v2 + unit_stage_logs (durasi aktif/jeda/blokir) · production_step_evidence_v2 (tahap tercatat, bahan terpakai,
//   tanggal selesai; baris DOC_* = dokumentasi) · quality_inspections_v2 (QC pertama, rework) · production_material_shortages_v2 ·
//   material_issues(+lines) + planned_bom_lines_v2 · production_material_returns_v2 · stock_movements (WASTE/RETURN tertaut unit) ·
//   unit_custody_handoffs_v2 (tiba = INBOUND diterima; barang jadi = FINISHED_GOODS) · production_run_exceptions_v2.
// V1 TIDAK dibaca sama sekali. Tidak ada harga/pembayaran/HPP. Tidak ada tulisan apa pun (read-only; dijaga writer audit).
import { loadStepContextRouting } from "./productionReportingRouting.js";
import { formatCell } from "./productionReportExport.js";
import { resolveUnitPhotosBulk } from "./productionUnitPhotoService.js";
import { usedQtyByMaterial } from "./productionUnitOverviewService.js";
import { applicableStepsFor } from "./productionStepCommandService.js";
import { BOARD_DEFAULTS, PRIORITY_LABEL, stationLabel } from "../lib/domain/productionBoard.js";
import { STEP_BY_NO, isSkippedEvidence, stepNoForStage } from "../lib/domain/productionSteps.js";
import { buildDocumentationMatrix, deriveNextStepNo, isDocumentationRow, LEGACY_PHOTO_PREFIX, parseDocRows } from "../lib/domain/productionDocumentation.js";
import {
  DATE_BASES, METRICS, MIN_SAMPLE, SLA, SLA_NOTE, STATUS_BUCKETS, activeFilterLabels, bucketKey, computeMetrics, drillRows, formatMinutes, inPeriod, keyInPeriod,
  makeFact, matchesFilters, minutesBetween, normalizeFilters, operatorReport, parsePeriod, periodError, round1, stationReport, statusBucketOf, trendSeries, warehouseReport,
  dateKeyOfDateColumn, wibKey, GRANULARITY, buildTargetResolver, describeTargets,
} from "../lib/domain/productionMetrics.js";

export const MAX_UNIT_ROWS = 5000;
const OPEN_RUN = ["PENDING_ARRIVAL", "ACTIVE", "BLOCKED"];
const STEP_OPERATOR = (stepNo) => (stepNo >= 10 ? "CORNER" : "MEJA");

function stageTiming(logs, op, now) {
  // logs: unit_stage_logs untuk (unit, stage) urut naik. pause = PAUSE -> RESUME; blocked = FAIL -> START berikutnya.
  let pause = 0; let blocked = 0; let pausedAt = null; let failedAt = null;
  const end = op.completedAt || now;
  for (const l of logs) {
    const t = l.createdAt;
    if (op.startedAt && t < op.startedAt) continue;
    if (l.action === "PAUSE") pausedAt = t;
    else if (l.action === "RESUME" && pausedAt) { pause += minutesBetween(pausedAt, t) || 0; pausedAt = null; }
    else if (l.action === "FAIL") failedAt = t;
    else if (l.action === "START" && failedAt) { blocked += minutesBetween(failedAt, t) || 0; failedAt = null; }
  }
  if (pausedAt && op.status === "PAUSED") pause += minutesBetween(pausedAt, end) || 0;
  if (failedAt && op.status === "BLOCKED") blocked += minutesBetween(failedAt, end) || 0;
  const elapsed = op.startedAt ? minutesBetween(op.startedAt, end) : null;
  return { elapsedMin: elapsed, pauseMin: pause, blockedMin: blocked, activeMin: elapsed == null ? 0 : Math.max(0, elapsed - pause - blocked) };
}

export async function loadFacts(prisma, { unitIds, now = new Date() }) {
  const empty = { facts: [], warehouse: { issues: [], returns: [], shortages: [], finishedGoods: [], waste: [] }, coverage: { cohortUnits: unitIds.length, runsInCohort: 0 } };
  if (!unitIds.length) return empty;
  const runs = await prisma.productionRun.findMany({
    where: { unitId: { in: unitIds }, status: { notIn: ["CANCELLED", "MIGRATION_REVIEW"] } },
    orderBy: { createdAt: "asc" },
    include: {
      unit: { select: { id: true, unitCode: true, serviceId: true, status: true, order: { select: { orderNumber: true } }, service: { select: { code: true, labelId: true } } } },
      plan: { include: { operator: { select: { id: true, user: { select: { name: true } } } }, cornerOperator: { select: { id: true, user: { select: { name: true } } } }, bomLines: { where: { status: "ACTIVE" }, include: { material: { select: { id: true, code: true, name: true, unit: true } } } } } },
      phases: { select: { phase: true, status: true, startedAt: true, completedAt: true } },
      operations: { orderBy: { sequence: "asc" } },
      inspections: { orderBy: { version: "asc" }, include: { items: { select: { photoUrls: true } } } },
      custodyHandoffs: { select: { direction: true, status: true, offeredAt: true, acceptedAt: true } },
      exceptions: { where: { status: "OPEN" }, select: { id: true } },
      materialShortages: { select: { id: true, status: true, reportedAt: true, resolvedAt: true } },
    },
  });
  if (!runs.length) return { ...empty, coverage: { cohortUnits: unitIds.length, runsInCohort: 0 } };
  const runIds = runs.map((r) => r.id);
  const planIds = runs.map((r) => r.plan?.id).filter(Boolean);
  const uIds = [...new Set(runs.map((r) => r.unitId))];
  const serviceIds = [...new Set(runs.map((r) => r.unit.serviceId).filter(Boolean))];

  const [evidence, stageLogs, routing, issues, diagnoses, returns, moves, photos] = await Promise.all([
    prisma.productionStepEvidence.findMany({ where: { runId: { in: runIds } }, orderBy: [{ createdAt: "asc" }, { version: "asc" }], select: { id: true, runId: true, stepNo: true, stepCode: true, version: true, payload: true, media: true, actorId: true, createdAt: true } }),
    prisma.unitStageLog.findMany({ where: { unitId: { in: uIds } }, orderBy: { createdAt: "asc" }, select: { unitId: true, stageId: true, action: true, createdAt: true } }),
    loadStepContextRouting(prisma, serviceIds),
    planIds.length ? prisma.materialIssue.findMany({ where: { productionPlanId: { in: planIds }, status: { not: "CANCELLED" } }, select: { id: true, issueNumber: true, productionPlanId: true, status: true, createdAt: true, issuedAt: true, reworkInspectionId: true, lines: { select: { materialId: true, issuedQty: true, material: { select: { code: true, name: true, unit: true } } } } } }) : [],
    prisma.diagnosisReport.findMany({ where: { runId: { in: runIds } }, orderBy: { createdAt: "asc" }, select: { runId: true, photoUrls: true } }),
    prisma.productionMaterialReturn.findMany({ where: { runId: { in: runIds } }, select: { runId: true, materialId: true, qty: true, status: true, requestedAt: true, receivedAt: true, receivedQty: true, material: { select: { code: true, name: true, unit: true } } } }),
    prisma.stockMovement.findMany({ where: { unitId: { in: uIds }, type: { in: ["WASTE", "RETURN"] } }, select: { unitId: true, materialId: true, type: true, qty: true, createdAt: true, material: { select: { code: true, name: true, unit: true } } } }),
    resolveUnitPhotosBulk(prisma, uIds),
  ]);

  const evByRun = new Map(); for (const e of evidence) (evByRun.get(e.runId) || evByRun.set(e.runId, []).get(e.runId)).push(e);
  const logsBy = new Map(); for (const l of stageLogs) { const k = `${l.unitId}:${l.stageId}`; (logsBy.get(k) || logsBy.set(k, []).get(k)).push(l); }
  const issuesByPlan = new Map(); for (const i of issues) (issuesByPlan.get(i.productionPlanId) || issuesByPlan.set(i.productionPlanId, []).get(i.productionPlanId)).push(i);
  const diagByRun = new Map(); for (const d of diagnoses) diagByRun.set(d.runId, d); // terbaru menimpa
  const retByRun = new Map(); for (const r of returns) (retByRun.get(r.runId) || retByRun.set(r.runId, []).get(r.runId)).push(r);
  const movesByUnit = new Map(); for (const m of moves) (movesByUnit.get(m.unitId) || movesByUnit.set(m.unitId, []).get(m.unitId)).push(m);

  const facts = [];
  const wh = { issues: [], returns: [], shortages: [], finishedGoods: [], waste: [] };
  for (const run of runs) {
    const plan = run.plan; const unit = run.unit;
    const ev = evByRun.get(run.id) || [];
    const stepEv = ev.filter((e) => !isDocumentationRow(e));
    const docEv = ev.filter((e) => isDocumentationRow(e));
    const recorded = new Set(stepEv.map((e) => e.stepNo));
    const inbound = run.custodyHandoffs.filter((h) => h.direction === "INBOUND" && h.status === "ACCEPTED" && h.acceptedAt).sort((a, b) => a.acceptedAt - b.acceptedAt)[0];
    const fg = run.custodyHandoffs.filter((h) => h.direction === "FINISHED_GOODS");
    const fgAccepted = fg.filter((h) => h.status === "ACCEPTED" && h.acceptedAt).sort((a, b) => b.acceptedAt - a.acceptedAt)[0];
    const fgOffered = fg.filter((h) => h.status === "OFFERED").sort((a, b) => b.offeredAt - a.offeredAt)[0];
    const handoffPhase = run.phases.find((p) => p.phase === "HANDOFF");
    // Tahap yang DILEWATI (mode adaptasi) bukan pekerjaan: tidak dihitung sebagai penyelesaian tahap 12 maupun durasi; QC tidak dilakukan bukan lulus/gagal.
    const step12 = stepEv.filter((e) => e.stepNo === 12 && !isSkippedEvidence(e)).at(-1);
    const skippedSteps = [...new Set(stepEv.filter(isSkippedEvidence).map((e) => e.stepNo))].length;
    const qcNotPerformed = !!run.adaptationPolicy && run.operations.some((o) => o.status === "SKIPPED" && o.planSnapshot?.qcNotPerformed) && run.inspections.filter((q) => q.result !== "PENDING").length === 0;
    const finishedAt = step12?.createdAt ?? handoffPhase?.startedAt ?? null;
    const readyAt = fgAccepted?.acceptedAt ?? (run.status === "COMPLETED" ? run.completedAt : null) ?? null;
    const arrivedAt = inbound?.acceptedAt ?? (run.origin === "WORKSHOP_BORN" ? run.createdAt : null);
    const opsStarted = run.operations.filter((o) => o.startedAt).sort((a, b) => a.startedAt - b.startedAt);
    const startedAt = opsStarted[0]?.startedAt ?? run.startedAt ?? null;
    const activeOp = run.operations.find((o) => ["ACTIVE", "PAUSED", "BLOCKED"].includes(o.status));
    const openShortage = run.materialShortages.some((s) => s.status === "OPEN");
    const planIssues = plan ? issuesByPlan.get(plan.id) || [] : [];
    const waitingIssue = planIssues.some((i) => !i.issuedAt && ["READY_TO_PICK", "APPROVED", "PICKED"].includes(i.status));
    const retRows = retByRun.get(run.id) || [];
    const pendingRet = retRows.filter((r) => r.status === "PENDING");

    // --- QC
    const insp = run.inspections.filter((q) => q.result !== "PENDING");
    const qc = { count: insp.length, first: insp[0] ? (insp[0].result === "FAIL_REWORK" ? "FAIL" : insp[0].result) : null, firstAt: insp[0]?.inspectedAt ?? insp[0]?.createdAt ?? null, fails: insp.filter((q) => q.result === "FAIL_REWORK").length };

    // --- tahap (durasi aktif/jeda/blokir) dari operasi V2 + stage logs
    const stages = [];
    const timing = { activeMin: 0, pauseMin: 0, blockedMin: 0, elapsedMin: finishedAt && startedAt ? minutesBetween(startedAt, finishedAt) : null };
    for (const op of run.operations) {
      if (!op.startedAt) continue;
      const stage = routing.stageById.get(op.stageId);
      const stepNo = stage ? stepNoForStage(stage) : null;
      const t = stageTiming(logsBy.get(`${run.unitId}:${op.stageId}`) || [], op, now);
      timing.activeMin += t.activeMin; timing.pauseMin += t.pauseMin; timing.blockedMin += t.blockedMin;
      if (stepNo) stages.push({ key: `S${String(stepNo).padStart(2, "0")}`, label: STEP_BY_NO[stepNo]?.label || op.stageLabel, stepNo, operator: STEP_OPERATOR(stepNo), startedAt: op.startedAt, completedAt: op.completedAt, ...t });
    }

    // --- bahan
    const used = usedQtyByMaterial(stepEv);
    const issuedBy = new Map(); const issuedMeta = new Map();
    for (const i of planIssues.filter((x) => x.status === "ISSUED")) for (const l of i.lines) { issuedBy.set(l.materialId, (issuedBy.get(l.materialId) || 0) + Number(l.issuedQty || 0)); issuedMeta.set(l.materialId, l.material); }
    const mv = movesByUnit.get(run.unitId) || [];
    const sumMv = (type, mid) => mv.filter((m) => m.type === type && m.materialId === mid).reduce((s, m) => s + Math.abs(Number(m.qty)), 0);
    const materials = (plan?.bomLines || []).map((b) => ({ materialId: b.materialId, code: b.material.code, name: b.material.name, uom: b.material.unit, planned: Number(b.qty), issued: issuedBy.get(b.materialId) ?? 0, used: used.has(b.materialId) ? used.get(b.materialId) : null, returned: sumMv("RETURN", b.materialId), waste: sumMv("WASTE", b.materialId), supplemental: !!b.supplementalInspectionId }));
    const waste = mv.filter((m) => m.type === "WASTE").map((m) => ({ materialId: m.materialId, qty: Math.abs(Number(m.qty)) }));

    // --- dokumentasi (matriks kanonis, sama dengan Aplikasi Dokumentasi/Unit 360)
    const split = routing.pathFor(unit.serviceId);
    const stepMedia = new Map(); for (const e of stepEv) stepMedia.set(e.stepNo, [...(stepMedia.get(e.stepNo) || []), ...(Array.isArray(e.media) ? e.media : []).map((m) => ({ url: m.url, kind: m.kind || "image" }))]);
    const diag = diagByRun.get(run.id);
    const qcUrls = [...new Set(run.inspections.flatMap((q) => q.items.flatMap((i) => (i.photoUrls || []).filter((u) => LEGACY_PHOTO_PREFIX.test(u)))))];
    const matrix = buildDocumentationMatrix({
      applicableSteps: applicableStepsFor(split), recordedSteps: recorded, nextStepNo: deriveNextStepNo(recorded), started: run.status !== "PENDING_ARRIVAL" && (run.operations.length > 0 || stepEv.length > 0),
      run: { origin: run.origin, status: run.status }, qcDone: run.inspections.length > 0, stepMedia,
      extra: { pickupPhoto: photos.get(run.unitId) ? { url: "pickup" } : null, diagnosisPhotos: (diag?.photoUrls || []).map((u) => ({ url: u, kind: "image" })), qcPhotos: qcUrls.map((u) => ({ url: u, kind: "image" })) },
      docRows: parseDocRows(docEv),
    });

    const planned = plan?.productionDate ? dateKeyOfDateColumn(plan.productionDate) : null;
    const phase = run.currentPhase;
    const opStatus = activeOp?.status ?? null;
    const statusBucket = statusBucketOf({ readyAt, finishedAt, runStatus: run.status, opStatus, openShortage, phase, plannedDate: planned, startedAt });
    const delayReason = openShortage ? "kekurangan bahan" : opStatus === "PAUSED" ? "dijeda" : opStatus === "BLOCKED" || run.status === "BLOCKED" ? "terblokir" : null;
    const fact = makeFact({
      runId: run.id, unitId: run.unitId, unitCode: unit.unitCode, orderNumber: unit.order?.orderNumber ?? null, origin: run.origin, runStatus: run.status, phase, runOpen: OPEN_RUN.includes(run.status),
      serviceCode: unit.service?.code ?? null, serviceLabel: unit.service?.labelId ?? null, stationCode: plan?.stationCode ?? null, stationSequence: plan?.stationSequence ?? null, priority: plan?.priority ?? 0,
      plannedDate: planned, arrivedAt, startedAt, finishedAt, readyAt, targetCompleteAt: plan?.targetCompleteAt ?? null,
      operatorId: plan?.operator?.id ?? null, operatorName: plan?.operator?.user?.name ?? null, cornerOperatorId: plan?.cornerOperator?.id ?? null, cornerOperatorName: plan?.cornerOperator?.user?.name ?? null,
      currentStepNo: deriveNextStepNo(recorded) && !finishedAt ? Math.min(12, deriveNextStepNo(recorded)) : (recorded.size ? Math.max(...recorded) : (run.status === "PENDING_ARRIVAL" ? null : 1)),
      statusBucket, delayReason, waitingMaterial: openShortage || waitingIssue, openException: run.exceptions.length > 0,
      adaptation: !!run.adaptationPolicy, skippedSteps, qcNotPerformed,
      qc, docs: { required: matrix.totals.required, satisfied: matrix.totals.satisfied, missingTotal: matrix.missingTotal, lengkap: matrix.flags.lengkap, photos: matrix.totals.photos },
      materials, extraMaterial: materials.some((m) => m.supplemental) || planIssues.some((i) => i.reworkInspectionId), waste,
      returns: { pending: pendingRet.length, partial: retRows.filter((r) => r.status === "RECEIVED" && r.receivedQty != null && Number(r.receivedQty) < Number(r.qty) - 1e-9).length, done: retRows.filter((r) => r.status === "RECEIVED").length, oldestPendingAt: pendingRet.map((r) => r.requestedAt).sort((a, b) => a - b)[0] ?? null },
      fgOfferedAt: fgOffered?.offeredAt ?? null, timing, stages,
      textureRetests: stepEv.filter((e) => e.stepNo === 8 && e.payload?.verdict && e.payload.verdict !== "PAS").length,
    });
    facts.push(fact);

    // --- baris Gudang (disaring meja/PIC/layanan/prioritas lewat fakta unit yang sama)
    for (const i of planIssues) {
      const supplemental = !!i.reworkInspectionId;
      const hadShortage = run.materialShortages.some((s) => s.reportedAt >= i.createdAt && (!i.issuedAt || s.reportedAt <= i.issuedAt));
      wh.issues.push({ id: i.id, runId: run.id, issueNumber: i.issueNumber, status: i.status, createdAt: i.createdAt, issuedAt: i.issuedAt, responseMin: i.issuedAt ? minutesBetween(i.createdAt, i.issuedAt) : null, supplemental, cause: supplemental ? "Permintaan tambahan (rework QC)" : hadShortage ? "Kekurangan bahan dilaporkan" : "Belum diproses Gudang" });
    }
    for (const r of retRows) wh.returns.push({ runId: run.id, materialId: r.materialId, code: r.material.code, name: r.material.name, uom: r.material.unit, qty: Number(r.qty), status: r.status, requestedAt: r.requestedAt, receivedAt: r.receivedAt, receivedQty: r.receivedQty != null ? Number(r.receivedQty) : null });
    for (const s of run.materialShortages) wh.shortages.push({ runId: run.id, status: s.status, reportedAt: s.reportedAt, resolvedAt: s.resolvedAt });
    for (const h of fg) wh.finishedGoods.push({ runId: run.id, status: h.status, offeredAt: h.offeredAt, acceptedAt: h.acceptedAt });
    for (const m of mv.filter((x) => x.type === "WASTE")) wh.waste.push({ runId: run.id, materialId: m.materialId, code: m.material.code, name: m.material.name, uom: m.material.unit, qty: Math.abs(Number(m.qty)), at: m.createdAt });
  }
  return { facts, warehouse: wh, coverage: { cohortUnits: unitIds.length, runsInCohort: runs.length } };
}

// ----------------------------------------------------------------------------------------------------------------------------------
// Konteks laporan: periode + filter + fakta tersaring + (cakupan). SATU jalur untuk dashboard, drill-down, laporan, dan export.
// ----------------------------------------------------------------------------------------------------------------------------------
export async function buildReportContext(prisma, { unitIds, query = {}, now = new Date(), config = BOARD_DEFAULTS }) {
  const period = parsePeriod({ from: query.from, to: query.to, now });
  const filters = normalizeFilters(query);
  const granularity = GRANULARITY.includes(query.granularity) ? query.granularity : "day";
  const loaded = await loadFacts(prisma, { unitIds, now });
  const facts = loaded.facts.filter((f) => matchesFilters(f, filters));
  const factsByRun = new Map(facts.map((f) => [f.runId, f]));
  const runSet = new Set(factsByRun.keys());
  const wh = {
    issues: loaded.warehouse.issues.filter((x) => runSet.has(x.runId)), returns: loaded.warehouse.returns.filter((x) => runSet.has(x.runId)), shortages: loaded.warehouse.shortages.filter((x) => runSet.has(x.runId)),
    finishedGoods: loaded.warehouse.finishedGoods.filter((x) => runSet.has(x.runId)), waste: loaded.warehouse.waste.filter((x) => runSet.has(x.runId)),
  };
  // Target harian tersimpan historis (tabel kecil, append-only): satu query; hari tanpa target tercatat memakai konfigurasi sistem.
  const targetRows = (await prisma.productionDailyTarget.findMany({ select: { effectiveFrom: true, targetUnits: true, createdAt: true } })).map((r) => ({ effectiveFrom: dateKeyOfDateColumn(r.effectiveFrom), targetUnits: r.targetUnits, createdAt: r.createdAt }));
  const resolver = buildTargetResolver(targetRows, config.dailyTarget);
  const targets = { resolver, ...describeTargets(resolver, period) };
  const [totalV2] = await prisma.$queryRaw`SELECT count(DISTINCT unit_id)::int AS units, count(*)::int AS runs FROM production_runs_v2`;
  const operatorNames = new Map(); for (const f of loaded.facts) { if (f.operatorId) operatorNames.set(f.operatorId, f.operatorName); if (f.cornerOperatorId) operatorNames.set(f.cornerOperatorId, f.cornerOperatorName); }
  const serviceLabels = new Map(loaded.facts.filter((f) => f.serviceCode).map((f) => [f.serviceCode, f.serviceLabel]));
  const coverage = {
    scope: "Produksi V2 (reader cohort) — unit V1 tidak termasuk", cohortUnits: unitIds.length, runsInCohort: loaded.coverage.runsInCohort, runsAfterFilters: facts.length,
    totalV2Units: totalV2.units, totalV2Runs: totalV2.runs, period: { from: period.from, to: period.to, days: period.days }, timezone: "WIB (UTC+7)",
  };
  return { period, filters, granularity, facts, factsByRun, wh, coverage, now, config, targets, operatorNames, serviceLabels, allFacts: loaded.facts,
    filterLabels: activeFilterLabels(filters, { stationLabel, operatorName: (id) => operatorNames.get(id) || id, serviceLabel: (c) => serviceLabels.get(c) || c }) };
}

const iso = (d) => (d ? new Date(d).toISOString() : null);
export const UNIT_COLUMNS = [
  { key: "unitCode", header: "Kode Unit", tipe: "teks" }, { key: "orderNumber", header: "Resi/Order", tipe: "teks" }, { key: "service", header: "Layanan", tipe: "teks" },
  { key: "station", header: "Meja", tipe: "teks" }, { key: "pic", header: "PIC Meja", tipe: "teks" }, { key: "corner", header: "PIC Corner", tipe: "teks" }, { key: "priority", header: "Prioritas", tipe: "teks" },
  { key: "status", header: "Status", tipe: "teks" }, { key: "step", header: "Tahap", tipe: "angka" },
  { key: "planned", header: "Direncanakan", tipe: "tanggal" }, { key: "arrived", header: "Masuk", tipe: "waktu" }, { key: "started", header: "Mulai", tipe: "waktu" }, { key: "finished", header: "Selesai", tipe: "waktu" }, { key: "ready", header: "Siap Kirim", tipe: "waktu" },
  { key: "target", header: "Target Selesai", tipe: "waktu" }, { key: "tatMin", header: "TAT Masuk→Siap (mnt)", tipe: "angka" }, { key: "late", header: "Terlambat", tipe: "teks" },
  { key: "completion", header: "Cara Selesai", tipe: "teks" }, { key: "skippedSteps", header: "Tahap Dilewati", tipe: "angka" },
  { key: "qcFirst", header: "QC Pertama", tipe: "teks" }, { key: "qcFails", header: "QC Gagal (x)", tipe: "angka" }, { key: "docPct", header: "Dokumentasi (%)", tipe: "angka" }, { key: "docMissing", header: "Foto Kurang", tipe: "angka" },
  { key: "returnPending", header: "Retur Pending", tipe: "angka" }, { key: "wasteQty", header: "Waste (qty)", tipe: "angka" }, { key: "extraMaterial", header: "Tambahan Bahan", tipe: "teks" },
  { key: "activeMin", header: "Aktif (mnt)", tipe: "angka" }, { key: "pauseMin", header: "Jeda (mnt)", tipe: "angka" }, { key: "blockedMin", header: "Tertunda (mnt)", tipe: "angka" },
];
export function unitRow(f, now) {
  const lateOpen = f.lateOpen(now); const lateFin = f.finishedAt && f.targetCompleteAt && f.finishedAt > f.targetCompleteAt;
  return {
    runId: f.runId, unitId: f.unitId, unitCode: f.unitCode, orderNumber: f.orderNumber, service: f.serviceLabel, station: f.stationCode ? stationLabel(f.stationCode) : null, pic: f.operatorName, corner: f.cornerOperatorName,
    priority: PRIORITY_LABEL[f.priority] || "Normal", status: STATUS_BUCKETS[f.statusBucket], step: f.currentStepNo, planned: f.plannedDate, arrived: iso(f.arrivedAt), started: iso(f.startedAt), finished: iso(f.finishedAt), ready: iso(f.readyAt), target: iso(f.targetCompleteAt),
    tatMin: f.readyAt && f.arrivedAt ? minutesBetween(f.arrivedAt, f.readyAt) : null, late: lateOpen ? "Ya (belum selesai)" : lateFin ? "Ya (selesai terlambat)" : f.targetCompleteAt ? "Tidak" : "—",
    completion: f.adaptation ? (f.runStatus === "COMPLETED" ? "Adaptasi (tahap dilewati)" : "Mode adaptasi") : "Proses lengkap", skippedSteps: f.skippedSteps ?? 0,
    qcFirst: f.qcNotPerformed ? "Tidak dilakukan" : f.qc.first === "PASS" ? "Lulus" : f.qc.first === "FAIL" ? "Gagal" : f.qc.first || "Belum QC", qcFails: f.qc.fails, docPct: f.docs.required ? round1((f.docs.satisfied / f.docs.required) * 100) : null, docMissing: f.docs.missingTotal,
    returnPending: f.returns.pending, wasteQty: Math.round(f.waste.reduce((s, w) => s + w.qty, 0) * 10000) / 10000, extraMaterial: f.extraMaterial ? "Ya" : "Tidak",
    activeMin: f.timing.activeMin, pauseMin: f.timing.pauseMin, blockedMin: f.timing.blockedMin,
  };
}

function kpiTable(metrics) {
  return {
    key: "kpi", title: "Ringkasan KPI",
    columns: [{ key: "group", header: "Kelompok", tipe: "teks" }, { key: "label", header: "Metrik", tipe: "teks" }, { key: "value", header: "Nilai", tipe: "angka" }, { key: "unit", header: "Satuan", tipe: "teks" }, { key: "n", header: "Sampel (n)", tipe: "angka" }, { key: "basis", header: "Dasar Tanggal", tipe: "teks" }, { key: "note", header: "Catatan", tipe: "teks" }],
    rows: metrics.map((m) => ({ metric: m.key, group: m.group, label: m.label, value: m.value, unit: m.unit, n: m.n, basis: m.snapshot ? "Posisi saat laporan dibuat" : (DATE_BASES[m.basis] || (m.basis === "qc_first" ? "Tanggal QC pertama" : m.basis === "active" ? "Unit aktif dalam periode" : m.basis)), note: m.reason || m.note || (m.key === "target_vs_done" ? `Target ${m.target} (${m.dailyTarget}/hari × ${m.activeDays} hari aktif) — tercapai ${m.achievementPct ?? "—"}%` : null) })),
  };
}

export function metricsOf(ctx) { return computeMetrics(ctx.facts, ctx.period, { dailyTarget: ctx.config.dailyTarget, targetFor: ctx.targets.resolver.targetFor, now: ctx.now }); }

export function reportBase(ctx, kind, title) {
  return {
    kind, title, generatedAt: ctx.now.toISOString(), timezone: "WIB (UTC+7)", period: ctx.coverage.period, filters: ctx.filterLabels, coverage: ctx.coverage,
    targetPerHari: ctx.targets.perDay, targetNote: ctx.targets.note, minSample: MIN_SAMPLE,
    dateBases: DATE_BASES, sla: { ...SLA, note: SLA_NOTE }, tables: [], definitions: [],
  };
}
const defsFor = (keys) => METRICS.filter((m) => !keys || keys.includes(m.key)).map((m) => ({ key: m.key, label: m.label, formula: m.formula, basis: m.snapshot ? "Posisi saat ini" : (DATE_BASES[m.basis] || m.basis), note: m.note || null }));

export function summaryReport(ctx) {
  const metricsMap = metricsOf(ctx); const metrics = METRICS.map((d) => metricsMap[d.key]);
  const doc = reportBase(ctx, "summary", "Ringkasan Kinerja Produksi");
  doc.metrics = metrics.map(({ members, ...m }) => ({ ...m, drillCount: members.length }));
  doc.tables = [
    kpiTable(metrics),
    { key: "trend", title: `Tren per ${{ day: "hari", week: "minggu (Senin)", month: "bulan" }[ctx.granularity]}`, columns: [{ key: "bucket", header: "Periode", tipe: "teks" }, { key: "masuk", header: "Masuk", tipe: "angka" }, { key: "terjadwal", header: "Terjadwal", tipe: "angka" }, { key: "selesai", header: "Selesai Produksi", tipe: "angka" }, { key: "siapKirim", header: "Siap Kirim", tipe: "angka" }], rows: trendSeries(ctx.facts, ctx.period, ctx.granularity) },
    attentionTable(ctx, metricsMap.attention),
    materialTable(ctx),
  ];
  doc.definitions = defsFor();
  return doc;
}
function attentionTable(ctx, metric) {
  const rows = metric.members.map((m) => ({ ...unitRow(ctx.factsByRun.get(m.runId), ctx.now), reason: m.flag })).sort((a, b) => String(a.unitCode).localeCompare(String(b.unitCode)));
  return { key: "attention", title: "Perlu perhatian (drill-down ke Unit 360)", columns: [{ key: "unitCode", header: "Kode Unit", tipe: "teks" }, { key: "orderNumber", header: "Resi/Order", tipe: "teks" }, { key: "station", header: "Meja", tipe: "teks" }, { key: "status", header: "Status", tipe: "teks" }, { key: "reason", header: "Alasan", tipe: "teks" }], rows, empty: "Tidak ada unit yang perlu perhatian." };
}
function materialTable(ctx) {
  const by = new Map();
  for (const f of ctx.facts.filter((x) => x.activeInPeriod(ctx.period))) for (const l of f.materials) { const a = by.get(l.materialId) || { code: l.code, name: l.name, uom: l.uom, planned: 0, issued: 0, used: 0, returned: 0, waste: 0, units: 0 }; a.planned += l.planned; a.issued += l.issued; a.used += l.used ?? 0; a.returned += l.returned; a.waste += l.waste; a.units += 1; by.set(l.materialId, a); }
  const r4 = (n) => Math.round(n * 10000) / 10000;
  return { key: "materials", title: "Bahan: rencana vs aktual (per bahan, unit aktif dalam periode)", columns: [{ key: "code", header: "Kode", tipe: "teks" }, { key: "name", header: "Bahan", tipe: "teks" }, { key: "uom", header: "Satuan", tipe: "teks" }, { key: "units", header: "Unit", tipe: "angka" }, { key: "planned", header: "Rencana", tipe: "angka" }, { key: "issued", header: "Diserahkan", tipe: "angka" }, { key: "used", header: "Terpakai", tipe: "angka" }, { key: "returned", header: "Retur", tipe: "angka" }, { key: "waste", header: "Waste", tipe: "angka" }],
    rows: [...by.values()].map((a) => ({ ...a, planned: r4(a.planned), issued: r4(a.issued), used: r4(a.used), returned: r4(a.returned), waste: r4(a.waste) })).sort((a, b) => a.code.localeCompare(b.code)), empty: "Belum ada data bahan pada periode ini.", note: "Qty dijumlah per bahan (satuan sama); bahan berbeda tidak dijumlahkan." };
}

const LIST_KEYS = ["unitCode", "orderNumber", "service", "station", "pic", "status", "step", "planned", "finished", "ready"];
// Arti nilai per unit pada daftar drill-down (satuan eksplisit; metrik hitungan murni tidak punya nilai per unit).
const DRILL_VALUE_LABEL = { late_open: "Terlambat (mnt)", on_time: "Terlambat dari target (mnt)", tat_arrival_ready: "Turnaround (mnt)", rework_rate: "QC gagal (kali)", doc_completeness: "Kelengkapan (%)", material_adherence: "Pakai - rencana (qty)", waste_units: "Waste (qty)" };
export function drillReport(ctx, key) {
  const def = METRICS.find((m) => m.key === key);
  if (!def) throw Object.assign(new Error("Metrik tidak dikenal"), { statusCode: 404, code: "REPORT_METRIC_UNKNOWN" });
  const metric = metricsOf(ctx)[key];
  const rows = drillRows(metric, ctx.factsByRun).map((r) => ({ ...unitRow(ctx.factsByRun.get(r.runId), ctx.now), termasuk: r.termasuk ? "Ya" : "Tidak", nilai: r.nilai, catatan: r.catatan }));
  const doc = reportBase(ctx, "drill", `Daftar unit: ${def.label}`);
  doc.metric = { key: def.key, label: def.label, unit: def.unit, kind: def.kind, formula: def.formula, value: metric.value, n: metric.n, denominator: metric.denominator, sufficient: metric.sufficient, reason: metric.reason, snapshot: metric.snapshot,
    countedUnits: new Set(metric.members.filter((m) => m.counted).map((m) => m.runId)).size, listedUnits: rows.length };
  const valueLabel = DRILL_VALUE_LABEL[key]; // nilai per unit hanya bila bermakna (menit terlambat, % kelengkapan, ...); selain itu kolom dibuang
  doc.tables = [{ key: "units", title: def.label, columns: [...UNIT_COLUMNS.filter((c) => LIST_KEYS.includes(c.key)), { key: "termasuk", header: "Membentuk angka", tipe: "teks" }, ...(valueLabel ? [{ key: "nilai", header: valueLabel, tipe: "angka" }] : []), { key: "catatan", header: "Catatan", tipe: "teks" }], rows, empty: "Tidak ada unit." }];
  doc.definitions = defsFor([key]);
  return doc;
}

export function stationsDoc(ctx) {
  const rows = stationReport(ctx.facts, ctx.period, { stations: ctx.config.stations, capacityPerStation: ctx.config.capacityPerStation, dailyTarget: ctx.config.dailyTarget, now: ctx.now, stationLabel });
  const doc = reportBase(ctx, "stations", "Performa Meja");
  doc.stations = rows.map(({ runIds, stages, ...r }) => r);
  const fmt = (v) => (v == null ? null : v);
  doc.tables = [
    { key: "stations", title: "Meja 1–4", columns: [
      { key: "label", header: "Meja", tipe: "teks" }, { key: "capacityPerDay", header: "Kapasitas/hari", tipe: "angka" }, { key: "activeDays", header: "Hari aktif", tipe: "angka" }, { key: "scheduled", header: "Unit masuk (terjadwal)", tipe: "angka" }, { key: "finished", header: "Selesai", tipe: "angka" },
      { key: "utilizationPct", header: "Utilisasi (%)", tipe: "angka" }, { key: "avgDurationMin", header: "Rata-rata durasi (mnt)", tipe: "angka" }, { key: "durationN", header: "n durasi", tipe: "angka" }, { key: "activeMin", header: "Aktif (mnt)", tipe: "angka" }, { key: "pauseMin", header: "Jeda (mnt)", tipe: "angka" }, { key: "blockedMin", header: "Tertunda (mnt)", tipe: "angka" },
      { key: "lateFinished", header: "Selesai terlambat", tipe: "angka" }, { key: "lateOpen", header: "Terlambat (berjalan)", tipe: "angka" }, { key: "manualOrderUnits", header: "Unit urutan manual", tipe: "angka" }, { key: "manualOrderPct", header: "Urutan manual (%)", tipe: "angka" }, { key: "bottleneck", header: "Bottleneck tahap", tipe: "teks" }],
      rows: rows.map(({ runIds, stages, ...r }) => ({ ...r, utilizationPct: fmt(r.utilizationPct), bottleneck: r.bottleneck ? `${r.bottleneck.label} (${formatMinutes(r.bottleneck.avgMin)}, n=${r.bottleneck.n})` : `Data belum cukup (n<${MIN_SAMPLE} per tahap)` })),
      note: "Utilisasi = unit terjadwal ÷ (kapasitas/hari × hari aktif). Hari aktif = hari berjadwal dalam periode (semua meja). Sel kosong = Data belum cukup." },
    { key: "stages", title: "Durasi per tahap (tahap selesai dalam periode)", columns: [{ key: "station", header: "Meja", tipe: "teks" }, { key: "stage", header: "Tahap", tipe: "teks" }, { key: "n", header: "n", tipe: "angka" }, { key: "avgMin", header: "Rata-rata (mnt)", tipe: "angka" }, { key: "pauseMin", header: "Jeda (mnt)", tipe: "angka" }, { key: "blockedMin", header: "Tertunda (mnt)", tipe: "angka" }],
      rows: rows.flatMap((r) => r.stages.sort((a, b) => a.stepNo - b.stepNo).map((s) => ({ station: r.label, stage: `${s.stepNo}. ${s.label}`, n: s.n, avgMin: s.n >= MIN_SAMPLE ? s.avgMin : null, pauseMin: s.pauseMin, blockedMin: s.blockedMin }))), empty: "Belum ada tahap selesai pada periode ini." },
  ];
  doc.definitions = defsFor(["target_vs_done", "on_time"]).concat([{ key: "utilisasi", label: "Utilisasi meja", formula: "Unit terjadwal ÷ (kapasitas per hari × hari aktif).", basis: DATE_BASES.planned, note: null }]);
  doc.runIds = Object.fromEntries(rows.map((r) => [r.code, r.runIds]));
  return doc;
}

export function operatorsDoc(ctx, { onlyOperatorUserId = null } = {}) {
  const rows = operatorReport(ctx.facts, ctx.period, { now: ctx.now });
  const doc = reportBase(ctx, "operators", "Performa PIC");
  doc.operators = rows.map(({ runIds, stages, ...r }) => r);
  doc.tables = [
    { key: "operators", title: "PIC (urut nama — tanpa ranking tunggal; volume & periode sebagai konteks)", columns: [
      { key: "name", header: "PIC", tipe: "teks" }, { key: "role", header: "Peran", tipe: "teks" }, { key: "assigned", header: "Penugasan", tipe: "angka" }, { key: "finished", header: "Selesai", tipe: "angka" }, { key: "active", header: "Aktif", tipe: "angka" }, { key: "late", header: "Terlambat", tipe: "angka" },
      { key: "pauseMin", header: "Jeda (mnt)", tipe: "angka" }, { key: "blockedMin", header: "Tertunda (mnt)", tipe: "angka" }, { key: "qcN", header: "n QC", tipe: "angka" }, { key: "firstPassPct", header: "Lulus QC pertama (%)", tipe: "angka" }, { key: "reworkPct", header: "Rework (%)", tipe: "angka" }, { key: "docN", header: "n dok.", tipe: "angka" }, { key: "docPct", header: "Kelengkapan dok. (%)", tipe: "angka" }],
      rows: rows.map(({ runIds, stages, ...r }) => ({ ...r, role: r.role === "MEJA" ? "PIC Meja" : "PIC Corner" })), note: `Persentase hanya tampil bila n ≥ ${MIN_SAMPLE}; selain itu "Data belum cukup". Rework/QC hanya untuk PIC Meja.`, empty: "Belum ada penugasan PIC pada filter ini." },
    { key: "operatorStages", title: "Durasi per tahap per PIC", columns: [{ key: "name", header: "PIC", tipe: "teks" }, { key: "stage", header: "Tahap", tipe: "teks" }, { key: "n", header: "n", tipe: "angka" }, { key: "avgMin", header: "Rata-rata (mnt)", tipe: "angka" }], rows: rows.flatMap((r) => r.stages.map((s) => ({ name: r.name, stage: `${s.stepNo}. ${s.label}`, n: s.n, avgMin: s.avgMin }))), empty: "Belum ada tahap selesai pada periode ini." },
  ];
  doc.definitions = defsFor(["on_time", "qc_first_pass", "rework_rate", "doc_completeness"]);
  doc.runIds = Object.fromEntries(rows.map((r) => [`${r.role}:${r.id}`, r.runIds]));
  return doc;
}

export function warehouseDoc(ctx) {
  const w = warehouseReport(ctx.wh, ctx.period, { now: ctx.now });
  const doc = reportBase(ctx, "warehouse", "Kinerja Gudang untuk Produksi");
  doc.warehouse = { ...w, runIds: undefined };
  const stat = (s) => (s.sufficient ? null : `Data belum cukup (n=${s.n})`);
  const row = (label, value, note) => ({ label, value, note: note ?? null });
  doc.tables = [
    { key: "warehouse_kpi", title: "Ringkasan Gudang", columns: [{ key: "label", header: "Indikator", tipe: "teks" }, { key: "value", header: "Nilai", tipe: "angka" }, { key: "note", header: "Catatan", tipe: "teks" }], rows: [
      row("Permintaan bahan (dalam periode)", w.request.requested), row("Permintaan selesai diserahkan", w.request.issued), row("Permintaan menunggu (saat ini)", w.request.openNow, w.request.oldestOpenMin != null ? `tertua ${formatMinutes(w.request.oldestOpenMin)}` : null),
      row("Waktu respons rata-rata (mnt)", w.request.response.avgMin, stat(w.request.response)), row("Waktu respons median (mnt)", w.request.response.medianMin, stat(w.request.response)), row("Waktu respons P90 (mnt)", w.request.response.p90Min, stat(w.request.response)),
      row(`Dalam SLA ${formatMinutes(w.request.slaMin)} (%)`, w.request.withinSlaPct, w.request.response.sufficient ? SLA_NOTE : `Data belum cukup (n=${w.request.issued})`), row("Permintaan tambahan bahan (rework)", w.request.supplemental),
      row("Retur pending", w.returns.pending, w.returns.oldestPendingMin != null ? `tertua ${formatMinutes(w.returns.oldestPendingMin)}` : null), row("Retur parsial", w.returns.partial), row("Retur selesai", w.returns.done), row("Waktu terima retur rata-rata (mnt)", w.returns.receive.avgMin, stat(w.returns.receive)),
      row("Kekurangan bahan dilaporkan", w.shortages.reported), row("Kekurangan bahan terbuka (saat ini)", w.shortages.openNow), row("Waktu selesai kekurangan rata-rata (mnt)", w.shortages.resolve.avgMin, stat(w.shortages.resolve)),
      row("Barang jadi menunggu diterima (saat ini)", w.finishedGoods.waiting, w.finishedGoods.oldestWaitingMin != null ? `tertua ${formatMinutes(w.finishedGoods.oldestWaitingMin)}` : null), row("Barang jadi diterima (dalam periode)", w.finishedGoods.accepted), row("Waktu terima barang jadi rata-rata (mnt)", w.finishedGoods.accept.avgMin, stat(w.finishedGoods.accept)),
    ], note: "Semua waktu WIB. SLA bawaan konfigurasi sistem." },
    { key: "delay_causes", title: "Penyebab keterlambatan (melewati SLA permintaan bahan)", columns: [{ key: "cause", header: "Penyebab", tipe: "teks" }, { key: "count", header: "Jumlah", tipe: "angka" }], rows: w.delayCauses, empty: "Tidak ada permintaan yang melewati SLA." },
    { key: "waste", title: "Waste per bahan (dalam periode)", columns: [{ key: "code", header: "Kode", tipe: "teks" }, { key: "name", header: "Bahan", tipe: "teks" }, { key: "uom", header: "Satuan", tipe: "teks" }, { key: "qty", header: "Qty", tipe: "angka" }, { key: "units", header: "Unit", tipe: "angka" }, { key: "movements", header: "Pergerakan", tipe: "angka" }], rows: w.waste, empty: "Tidak ada waste pada periode ini." },
  ];
  doc.definitions = [
    { key: "wh_response", label: "Waktu respons permintaan bahan", formula: "Waktu diserahkan (issue ISSUED) − waktu permintaan dibuat; hanya permintaan yang sudah diserahkan.", basis: "Tanggal permintaan dibuat", note: null },
    { key: "wh_returns", label: "Retur pending/parsial/selesai", formula: "PENDING = belum diterima Gudang; parsial = diterima kurang dari sisa; selesai = diterima penuh.", basis: "Tanggal retur diajukan", note: null },
    { key: "wh_sla", label: "SLA", formula: `Permintaan bahan ${SLA.materialResponseMin} mnt; retur ${SLA.returnReceiveMin} mnt; barang jadi ${SLA.finishedGoodsAcceptMin} mnt.`, basis: SLA_NOTE, note: null },
  ];
  doc.runIds = w.runIds;
  return doc;
}

// Daftar unit pembentuk satu angka Meja/PIC (klik angka -> daftar). Himpunan run berasal dari laporan yang SAMA (stationsDoc/operatorsDoc.runIds),
// jadi jumlah baris = angka di kartu. Kolom ringkas; rincian lengkap lewat Unit 360 / laporan per unit.
export function unitListDoc(ctx, title, runIds) {
  const facts = (runIds || []).map((id) => ctx.factsByRun.get(id)).filter(Boolean);
  const doc = reportBase(ctx, "list", title);
  doc.tables = [{ key: "units", title, columns: UNIT_COLUMNS.filter((c) => LIST_KEYS.includes(c.key)), rows: facts.map((f) => unitRow(f, ctx.now)).sort((a, b) => String(a.unitCode).localeCompare(String(b.unitCode))), empty: "Tidak ada unit pada daftar ini." }];
  doc.listedUnits = facts.length;
  return doc;
}
export function stationListDoc(ctx, code, list) {
  const doc = stationsDoc(ctx); const ids = doc.runIds?.[code]?.[list];
  if (!ids) return null;
  const st = doc.stations.find((s) => s.code === code);
  return unitListDoc(ctx, `${st.label} — ${list === "scheduled" ? "unit terjadwal" : "unit selesai"}`, ids);
}
export function operatorListDoc(ctx, key, list) {
  const doc = operatorsDoc(ctx); const ids = doc.runIds?.[key]?.[list];
  if (!ids) return null;
  const op = doc.operators.find((o) => `${o.role}:${o.id}` === key);
  return unitListDoc(ctx, `${op.name} — ${list === "assigned" ? "unit ditugaskan" : "unit selesai"}`, ids);
}

export function unitsDoc(ctx) {
  const facts = ctx.facts.filter((f) => f.activeInPeriod(ctx.period) || f.runOpen);
  if (facts.length > MAX_UNIT_ROWS) throw Object.assign(new Error(`Laporan melebihi ${MAX_UNIT_ROWS} unit — persempit periode atau filter.`), { statusCode: 413, code: "REPORT_TOO_LARGE" });
  const doc = reportBase(ctx, "units", "Laporan Per Unit");
  doc.tables = [{ key: "units", title: "Unit", columns: UNIT_COLUMNS, rows: facts.map((f) => unitRow(f, ctx.now)).sort((a, b) => String(a.unitCode).localeCompare(String(b.unitCode))), empty: "Tidak ada unit pada periode dan filter ini.", note: "Unit aktif = salah satu tanggal (direncanakan/masuk/mulai/selesai/siap kirim) jatuh dalam periode, atau masih berjalan." }];
  doc.definitions = defsFor(["tat_arrival_ready", "on_time", "qc_first_pass", "doc_completeness"]);
  return doc;
}

// Laporan satu unit lengkap (rincian tahap, QC, bahan, retur, dokumentasi, Gudang). Memakai fakta yang SAMA dengan dashboard.
export function unitDetailDoc(ctx, runId) {
  const f = ctx.allFacts.find((x) => x.runId === runId);
  if (!f) return null;
  const doc = reportBase(ctx, "unit", `Laporan Unit ${f.unitCode}`);
  const row = unitRow(f, ctx.now);
  doc.unit = { runId: f.runId, unitId: f.unitId, unitCode: f.unitCode };
  doc.tables = [
    { key: "unit", title: "Ringkasan unit", columns: [{ key: "label", header: "Indikator", tipe: "teks" }, { key: "value", header: "Nilai", tipe: "teks" }], rows: UNIT_COLUMNS.map((c) => ({ label: c.header, value: formatCell(row[c.key], c.tipe) })) }, // sudah diformat (waktu WIB, angka id-ID): layar = berkas
    { key: "stages", title: "Rincian tahap (WIB)", columns: [{ key: "stage", header: "Tahap", tipe: "teks" }, { key: "operator", header: "PIC", tipe: "teks" }, { key: "startedAt", header: "Mulai", tipe: "waktu" }, { key: "completedAt", header: "Selesai", tipe: "waktu" }, { key: "elapsedMin", header: "Durasi (mnt)", tipe: "angka" }, { key: "activeMin", header: "Aktif (mnt)", tipe: "angka" }, { key: "pauseMin", header: "Jeda (mnt)", tipe: "angka" }, { key: "blockedMin", header: "Tertunda (mnt)", tipe: "angka" }],
      rows: f.stages.sort((a, b) => a.stepNo - b.stepNo).map((s) => ({ stage: `${s.stepNo}. ${s.label}`, operator: s.operator === "CORNER" ? f.cornerOperatorName : f.operatorName, startedAt: iso(s.startedAt), completedAt: iso(s.completedAt), elapsedMin: s.elapsedMin, activeMin: s.activeMin, pauseMin: s.pauseMin, blockedMin: s.blockedMin })), empty: "Belum ada tahap dikerjakan." },
    { key: "materials", title: "Bahan: rencana vs aktual", columns: [{ key: "code", header: "Kode", tipe: "teks" }, { key: "name", header: "Bahan", tipe: "teks" }, { key: "uom", header: "Satuan", tipe: "teks" }, { key: "planned", header: "Rencana", tipe: "angka" }, { key: "issued", header: "Diserahkan", tipe: "angka" }, { key: "used", header: "Terpakai", tipe: "angka" }, { key: "returned", header: "Retur", tipe: "angka" }, { key: "waste", header: "Waste", tipe: "angka" }, { key: "supplemental", header: "Tambahan", tipe: "teks" }],
      rows: f.materials.map((m) => ({ ...m, supplemental: m.supplemental ? "Ya" : "Tidak" })), empty: "Tidak ada rencana bahan." },
  ];
  doc.definitions = defsFor(["tat_arrival_ready", "on_time", "doc_completeness"]);
  return doc;
}

export async function mySummary(prisma, { user, unitIds, now = new Date(), query = {} }) {
  const period = parsePeriod({ from: query.from, to: query.to, now });
  const { facts } = await loadFacts(prisma, { unitIds, now });
  const uid = user.id;
  const ops = await prisma.productionOperator.findUnique({ where: { userId: uid }, select: { id: true } });
  const mine = ops ? facts.filter((f) => f.operatorId === ops.id || f.cornerOperatorId === ops.id) : [];
  const evid = await prisma.productionStepEvidence.findMany({ where: { actorId: uid, createdAt: { gte: period.start, lt: period.endExclusive } }, select: { stepCode: true, runId: true } });
  const inspections = await prisma.qualityInspection.count({ where: { inspectorId: uid, inspectedAt: { gte: period.start, lt: period.endExclusive } } });
  const docRuns = new Set(evid.filter((e) => isDocumentationRow(e)).map((e) => e.runId));
  return {
    period: { from: period.from, to: period.to, days: period.days }, timezone: "WIB (UTC+7)", scope: "Ringkasan pekerjaan Anda sendiri",
    pekerjaan: { ditugaskan: mine.length, selesai: mine.filter((f) => inPeriod(f.finishedAt, period)).length, berjalan: mine.filter((f) => f.runOpen && !f.finishedAt).length, terlambat: mine.filter((f) => f.lateOpen(now)).length },
    dokumentasi: { pengirimanDokumentasi: evid.filter((e) => isDocumentationRow(e)).length, unitDidokumentasi: docRuns.size },
    qc: { inspeksiDilakukan: inspections },
    unit: mine.filter((f) => f.runOpen).map((f) => ({ runId: f.runId, unitId: f.unitId, unitCode: f.unitCode, status: STATUS_BUCKETS[f.statusBucket] })),
  };
}
