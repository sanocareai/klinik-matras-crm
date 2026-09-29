// Read-model Production Experience V2 (P8): papan Planner, kartu pekerja (Table/Corner), Andon, antrean Gudang produksi, laporan Sales.
// BACA-SAJA. Semua keadaan tahap diturunkan dari data P1–P6 + bukti P8 lewat loadStepContext (sumber yang sama dengan command) —
// tidak ada status UI yang disimpan terpisah. Pemanggil (routes) wajib memfilter unitIds dari reader cohort; unit di luar cohort tidak pernah
// dimuat. Data customer seperlunya: nama, berat badan, keluhan, request — tanpa telepon/alamat.
import {
  ANDON_BUCKETS, STEP_BY_NO, STEPS, andonBucketOf, stepNoForStage,
} from "../lib/domain/productionSteps.js";
import { BOARD_DEFAULTS, PRIORITY_LABEL, formatProductionDate, parseProductionDate, stationLabel, todayWib } from "../lib/domain/productionBoard.js";
import { applicableStepsFor, loadStepContext } from "./productionStepCommandService.js";
import { listEligibleUnitsForPlanning } from "./productionPlanningCommandService.js";
import { signEvidenceUrl } from "../routes/productionEvidenceMedia.js";

const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];
const COMPLAINT_LABEL = Object.freeze({
  KEPALA_PUSING: "Kepala pusing", SAKIT_PINGGANG: "Sakit pinggang", SAKIT_PUNGGUNG: "Sakit punggung", SAKIT_LEHER: "Sakit leher",
  BAHU: "Bahu", PEGAL_PEGAL: "Pegal-pegal", SARAF_KEJEPIT: "Saraf kejepit", SKOLIOSIS: "Skoliosis", LAINNYA: "Lainnya",
});
const STYLE_LABEL = Object.freeze({ BIASA: "Kasur Biasa", PLUSHTOP: "Plushtop", PILLOWTOP: "Pillowtop" });
const VERDICT_LABEL = Object.freeze({ PAS: "PAS", TERLALU_KERAS: "Terlalu Keras", TERLALU_EMPUK: "Terlalu Empuk" });

export const RUN_VIEW_INCLUDE = {
  unit: {
    select: {
      id: true, unitCode: true, orderId: true, serviceId: true, status: true, currentStageId: true, merk: true, ukuran: true,
      service: { select: { code: true, labelId: true } },
      order: {
        select: {
          orderNumber: true, category: true, beratBadan: true, notes: true, complaintCategory: true, customerPromiseDate: true,
          weightEntries: { select: { label: true, beratKg: true }, orderBy: { sortOrder: "asc" } },
          customer: { select: { name: true, assignedSales: { select: { id: true, name: true } } } },
        },
      },
    },
  },
  plan: {
    include: {
      bomLines: { where: { status: "ACTIVE" }, include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
      workCenter: { select: { id: true, code: true, name: true } },
      cornerWorkCenter: { select: { id: true, code: true, name: true } },
      operator: { select: { id: true, userId: true, active: true, user: { select: { name: true } } } },
      cornerOperator: { select: { id: true, userId: true, active: true, user: { select: { name: true } } } },
      materialIssues: { select: { id: true, issueNumber: true, status: true, reworkInspectionId: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: "asc" } },
    },
  },
  phases: true,
  operations: { orderBy: { sequence: "asc" } },
  custodyHandoffs: { select: { id: true, direction: true, status: true, revision: true, acceptedAt: true, offeredAt: true }, orderBy: { offeredAt: "asc" } },
};

const nameOf = (op) => op?.user?.name ?? null;
const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));

function materialStatusOf(plan, material, shortage) {
  if (shortage) return { key: "KEKURANGAN", label: "Kekurangan bahan" };
  if (!plan) return { key: "BELUM_ADA_RENCANA", label: "Belum ada rencana" };
  if (!plan.bomLines.length) return { key: "BOM_BELUM_ADA", label: "BOM belum dibuat" };
  if (material.ready) return { key: "SUDAH_DISERAHKAN", label: "Sudah diserahkan" };
  const issues = plan.materialIssues.filter((i) => i.status !== "CANCELLED");
  if (issues.some((i) => i.status === "READY_TO_PICK")) return { key: "SIAP_DIAMBIL", label: "Menunggu diserahkan Gudang" };
  if (plan.status === "MATERIAL_RESERVED") return { key: "MENUNGGU_DISIAPKAN", label: "Direservasi — menunggu permintaan bahan" };
  return { key: "BELUM_DIRESERVASI", label: "BOM belum direservasi" };
}

// Status per tahap untuk UI: NA (tidak berlaku di jalur), DONE (bukti tercatat), CURRENT (aksi berikutnya), WAITING (menunggu pihak lain), PENDING.
function stepStatuses(ctx) {
  const applicable = applicableStepsFor(ctx.split);
  const recorded = new Map();
  for (const e of ctx.evidence) recorded.set(e.stepNo, e);
  const next = ctx.next || {};
  return STEPS.map((step) => {
    const e = recorded.get(step.no);
    let status;
    if (!applicable.includes(step.no)) status = "NA";
    else if (next.wait === "COMPLETED") status = "DONE";
    else if (step.no === next.stepNo && next.action !== "WAIT") status = "CURRENT";
    else if (step.no === next.stepNo && next.action === "WAIT" && !e) status = "WAITING";
    else if (e) status = "DONE";
    else status = "PENDING";
    return { no: step.no, code: step.code, label: step.label, actor: step.actor, status, at: e?.createdAt ?? null, version: e?.version ?? null };
  });
}

function indicatorsOf(run, ctx, materialStatus) {
  const inbound = run.custodyHandoffs.filter((h) => h.direction === "INBOUND").at(-1);
  const fg = run.custodyHandoffs.filter((h) => h.direction === "FINISHED_GOODS").at(-1);
  const qc = ctx.latestInspection;
  return {
    custody: inbound ? (inbound.status === "ACCEPTED" ? "OK" : inbound.status) : (run.origin === "WORKSHOP_BORN" ? "LAHIR_DI_WORKSHOP" : "BELUM"),
    service: run.unit.serviceId ? "OK" : "BELUM",
    bom: run.plan?.bomLines.length ? "OK" : "BELUM",
    material: materialStatus.key,
    workshop: ctx.state.activeOp ? (ctx.state.activeOp.status === "PAUSED" ? "DIJEDA" : "BERJALAN") : (run.operations.length ? "MENUNGGU" : "BELUM_MULAI"),
    qc: qc ? (qc.result === "PASS" ? "LULUS" : qc.result === "FAIL_REWORK" ? "REWORK" : qc.result === "OVERRIDDEN" ? "WAIVED" : qc.result) : "BELUM",
    handoff: fg ? fg.status : "BELUM",
  };
}

function warningsOf(run, ctx, materialStatus) {
  const w = [];
  if (!run.plan?.operatorId) w.push({ code: "OPERATOR_BELUM", text: "PIC meja belum ditetapkan" });
  if (!run.unit.serviceId) w.push({ code: "LAYANAN_BELUM", text: "Layanan unit belum ditetapkan (ditetapkan setelah diagnosa)" });
  const diagnosed = ctx.evidence.some((e) => e.stepNo === 5);
  if (diagnosed && !run.plan?.bomLines.length) w.push({ code: "BOM_BELUM", text: "Diagnosa selesai — BOM belum dibuat" });
  if (["BOM_BELUM_ADA", "BELUM_DIRESERVASI", "MENUNGGU_DISIAPKAN", "SIAP_DIAMBIL"].includes(materialStatus.key) && diagnosed) w.push({ code: "BAHAN_BELUM", text: materialStatus.label });
  if (ctx.openShortage) w.push({ code: "KEKURANGAN", text: "Menunggu bahan baku dari Gudang" });
  if (ctx.pathError) w.push({ code: "JALUR", text: ctx.pathError });
  if (run.plan?.targetCompleteAt && !TERMINAL_RUN.includes(run.status) && run.currentPhase !== "HANDOFF" && new Date(run.plan.targetCompleteAt).getTime() < Date.now()) {
    w.push({ code: "TERLAMBAT", text: "Melewati target selesai" });
  }
  return w;
}

function customerOf(run) {
  const order = run.unit.order;
  return {
    orderNumber: order?.orderNumber ?? null,
    category: order?.category ?? null,
    name: order?.customer?.name ?? null,
    weightKg: order?.beratBadan ?? null,
    weightEntries: order?.weightEntries ?? [],
    complaints: (order?.complaintCategory || []).map((c) => COMPLAINT_LABEL[c] || c),
    request: order?.notes ?? null,
    sleepPosition: null, // belum ditangkap Sales (gap P8)
    promiseDate: order?.customerPromiseDate ?? null,
    salesName: order?.customer?.assignedSales?.name ?? null,
  };
}

export function toRunView(run, ctx, { now = new Date() } = {}) {
  const shortage = ctx.openShortage;
  const materialStatus = materialStatusOf(run.plan, ctx.material, shortage);
  const steps = stepStatuses(ctx);
  const applicable = steps.filter((s) => s.status !== "NA");
  const started = run.operations.length > 0 || ctx.evidence.length > 0;
  const firstStart = run.operations[0]?.startedAt ?? null;
  const op = ctx.state.activeOp;
  const next = ctx.next;
  const bucket = andonBucketOf({ next, started });
  return {
    runId: run.id, revision: run.revision, status: run.status, currentPhase: run.currentPhase, origin: run.origin,
    unit: { id: run.unit.id, unitCode: run.unit.unitCode, merk: run.unit.merk, ukuran: run.unit.ukuran, status: run.unit.status, service: run.unit.service ? { code: run.unit.service.code, label: run.unit.service.labelId } : null },
    customer: customerOf(run),
    plan: run.plan ? {
      id: run.plan.id, status: run.plan.status, revision: run.plan.revision,
      productionDate: formatProductionDate(run.plan.productionDate), stationCode: run.plan.stationCode, stationLabel: stationLabel(run.plan.stationCode),
      priority: run.plan.priority, priorityLabel: PRIORITY_LABEL[run.plan.priority] || "Normal",
      workCenter: run.plan.workCenter, cornerWorkCenter: run.plan.cornerWorkCenter,
      operator: run.plan.operator ? { id: run.plan.operator.id, userId: run.plan.operator.userId, name: nameOf(run.plan.operator) } : null,
      cornerOperator: run.plan.cornerOperator ? { id: run.plan.cornerOperator.id, userId: run.plan.cornerOperator.userId, name: nameOf(run.plan.cornerOperator) } : null,
      targetStartAt: run.plan.targetStartAt, targetCompleteAt: run.plan.targetCompleteAt,
      bomCount: run.plan.bomLines.length,
    } : null,
    next, bucket, bucketLabel: ANDON_BUCKETS.find((b) => b.key === bucket)?.label ?? bucket,
    progress: { done: applicable.filter((s) => s.status === "DONE").length, total: applicable.length },
    steps,
    activeOp: op ? { stageLabel: op.stageLabel, status: op.status, startedAt: op.startedAt } : null,
    timer: {
      startedAt: firstStart, stepStartedAt: op?.startedAt ?? null,
      elapsedMinutes: firstStart ? minutesBetween(firstStart, TERMINAL_RUN.includes(run.status) ? run.completedAt || now : now) : 0,
      stepElapsedMinutes: op?.startedAt ? minutesBetween(op.startedAt, now) : 0,
      late: !!(run.plan?.targetCompleteAt && !TERMINAL_RUN.includes(run.status) && run.currentPhase !== "HANDOFF" && new Date(run.plan.targetCompleteAt).getTime() < now.getTime()),
    },
    materialStatus,
    indicators: indicatorsOf(run, ctx, materialStatus),
    warnings: warningsOf(run, ctx, materialStatus),
    shortage: shortage ? { id: shortage.id, revision: shortage.revision, items: shortage.items, note: shortage.note, reportedAt: shortage.reportedAt } : null,
    qc: ctx.latestInspection ? { version: ctx.latestInspection.version, result: ctx.latestInspection.result, at: ctx.latestInspection.inspectedAt } : null,
  };
}

async function loadRuns(prisma, where) {
  return prisma.productionRun.findMany({ where, include: RUN_VIEW_INCLUDE, orderBy: [{ createdAt: "asc" }] });
}
async function viewsOf(prisma, runs, opts) {
  const views = [];
  for (const run of runs) views.push(toRunView(run, await loadStepContext(prisma, run), opts));
  return views;
}

// P9A — unit dengan custody INBOUND masih OFFERED (pickup sukses, TAPI belum
// dikonfirmasi tiba) dan BELUM PERNAH punya Production Run sama sekali. Ini
// khusus kasus WARISAN (mis. unit canary yang di-OFFER sebelum P9A ada) —
// jalur BARU (openPendingArrivalIntakeV2InTx) langsung membuat run
// PENDING_ARRIVAL saat offer, jadi sudah tercakup listEligibleUnitsForPlanning.
// BACA-SAJA: tidak menyentuh/membuat apa pun, murni supaya kartu tetap
// terlihat tanpa memaksa mutasi pada custody yang sudah ada.
async function listAwaitingArrivalNoRunUnits(prisma, unitIds) {
  const handoffs = await prisma.unitCustodyHandoff.findMany({
    // PENTING: handoff.productionRunId TIDAK BISA dipakai sebagai filter di sini — kolom itu TETAP null untuk SEMUA
    // handoff OFFERED (jalur BARU maupun lama), baru diproyeksikan saat ACCEPT (lihat acceptUnitCustody). Kartu
    // warisan sejati dibedakan lewat unit.productionRunsV2: { none: {} } — benar-benar TIDAK punya Run sama sekali —
    // supaya unit dari jalur BARU (yang sudah punya Run PENDING_ARRIVAL sejak offer) tidak ikut kehitung dua kali
    // di papan (sekali dari sini, sekali lagi dari listEligibleUnitsForPlanning).
    where: { direction: "INBOUND", status: "OFFERED", unitId: { in: unitIds }, unit: { is: { productionRunsV2: { none: {} } } } },
    include: {
      unit: { select: { id: true, unitCode: true, merk: true, ukuran: true, storageLocation: true, order: { select: { orderNumber: true } } } },
    },
    orderBy: [{ offeredAt: "asc" }],
  });
  return handoffs.map((h) => ({
    runId: null, handoffId: h.id,
    unit: { id: h.unit.id, unitCode: h.unit.unitCode, merk: h.unit.merk, ukuran: h.unit.ukuran, storageLocation: h.unit.storageLocation, orderNumber: h.unit.order?.orderNumber ?? null },
    kind: "AWAITING_ARRIVAL_LEGACY", isLegacyException: false, inTransit: true,
  }));
}

// ---------------------------------------------------------------------------
// Papan Planner H-1: kolom meja untuk tanggal produksi + unit belum dijadwalkan.
// ---------------------------------------------------------------------------
export async function getProductionBoard(prisma, { date, unitIds, config = BOARD_DEFAULTS, now = new Date() }) {
  const day = parseProductionDate(date || todayWib(now)) || parseProductionDate(todayWib(now));
  const cohort = { unitId: { in: unitIds } };
  const [scheduledRuns, unscheduledRuns, eligible, awaitingArrivalNoRun] = await Promise.all([
    loadRuns(prisma, { ...cohort, status: { not: "CANCELLED" }, plan: { is: { productionDate: day, status: { not: "CANCELLED" } } } }),
    loadRuns(prisma, { ...cohort, status: { notIn: TERMINAL_RUN }, plan: { is: { productionDate: null, status: { not: "CANCELLED" } } } }),
    listEligibleUnitsForPlanning(prisma, { unitIds }),
    listAwaitingArrivalNoRunUnits(prisma, unitIds),
  ]);
  const scheduled = await viewsOf(prisma, scheduledRuns, { now });
  const unscheduled = await viewsOf(prisma, unscheduledRuns, { now });
  const stations = config.stations.map((code) => {
    const items = scheduled.filter((v) => v.plan?.stationCode === code).sort((a, b) => (b.plan.priority - a.plan.priority));
    const operatorNames = [...new Set(items.map((v) => v.plan?.operator?.name).filter(Boolean))];
    return { code, label: stationLabel(code), capacity: config.capacityPerStation, count: items.length, operatorNames, items };
  });
  const completed = scheduled.filter((v) => ["HANDOFF", "SELESAI"].includes(v.bucket)).length;
  return {
    date: formatProductionDate(day), config: { dailyTarget: config.dailyTarget, stations: config.stations, capacityPerStation: config.capacityPerStation },
    kpi: { target: config.dailyTarget, planned: scheduled.length, completed, waitingMaterial: scheduled.filter((v) => v.bucket === "MENUNGGU_BAHAN").length, late: scheduled.filter((v) => v.timer.late).length },
    stations,
    unscheduled: {
      plans: unscheduled,
      units: [
        ...eligible.map((e) => ({ runId: e.runId, unit: e.unit, kind: e.kind, isLegacyException: e.isLegacyException, inTransit: !!e.inTransit })),
        ...awaitingArrivalNoRun,
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Kartu satu unit (pekerja/Planner): view + bukti (media bertanda tangan) + bahan yang sudah diserahkan (untuk tahap 6/7/10).
// ---------------------------------------------------------------------------
export async function getRunCard(prisma, runId, { unitIds, now = new Date() } = {}) {
  const run = await prisma.productionRun.findFirst({ where: { id: runId, unitId: { in: unitIds } }, include: RUN_VIEW_INCLUDE });
  if (!run) return null;
  const ctx = await loadStepContext(prisma, run);
  const view = toRunView(run, ctx, { now });
  const issuedLines = run.plan
    ? await prisma.materialIssueLine.findMany({
        where: { materialIssue: { productionPlanId: run.plan.id, status: "ISSUED" } },
        select: { materialId: true, issuedQty: true, material: { select: { code: true, name: true, unit: true } } },
      })
    : [];
  const issued = new Map();
  for (const line of issuedLines) {
    const cur = issued.get(line.materialId) || { materialId: line.materialId, code: line.material.code, name: line.material.name, uom: line.material.unit, qty: 0 };
    cur.qty += Number(line.issuedQty || 0);
    issued.set(line.materialId, cur);
  }
  const actorIds = [...new Set(ctx.evidence.map((e) => e.actorId).filter(Boolean))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));
  return {
    ...view,
    bom: (run.plan?.bomLines || []).map((l) => ({ id: l.id, materialId: l.materialId, code: l.material.code, name: l.material.name, qty: Number(l.qty), uom: l.material.unit, supplemental: !!l.supplementalInspectionId })),
    issuedMaterials: [...issued.values()],
    evidence: ctx.evidence.map((e) => ({
      id: e.id, stepNo: e.stepNo, stepLabel: STEP_BY_NO[e.stepNo]?.label, version: e.version, payload: e.payload, createdAt: e.createdAt,
      actor: actorName.get(e.actorId) || null,
      media: (Array.isArray(e.media) ? e.media : []).map((m) => ({ kind: m.kind, url: signEvidenceUrl(m.url) })).filter((m) => m.url),
    })),
    workCenterId: view.next?.actor === "CORNER" ? (run.plan?.cornerOperatorId ? (run.plan.cornerWorkCenterId || run.plan.workCenterId) : run.plan?.workCenterId) : run.plan?.workCenterId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Antrean pekerja: PIC Table = rencana dengan operator = saya; PIC Corner = rencana dengan PIC Corner = saya (atau operator meja bila
// Corner tidak ditugaskan) yang sudah melewati tahap 9. Satu kartu aktif per unit; urut prioritas lalu target mulai.
// ---------------------------------------------------------------------------
export async function listWorkerQueue(prisma, { unitIds, userId, lane, now = new Date() }) {
  const operator = userId ? await prisma.productionOperator.findUnique({ where: { userId }, select: { id: true, active: true } }) : null;
  if (!operator || !operator.active) return { operator: null, items: [] };
  const planWhere = lane === "CORNER"
    ? { OR: [{ cornerOperatorId: operator.id }, { cornerOperatorId: null, operatorId: operator.id }] }
    : { operatorId: operator.id };
  const runs = await loadRuns(prisma, {
    unitId: { in: unitIds }, status: { notIn: TERMINAL_RUN },
    plan: { is: { ...planWhere, status: { not: "CANCELLED" } } },
  });
  const views = await viewsOf(prisma, runs, { now });
  const items = views
    .filter((v) => (lane === "CORNER"
      ? v.next?.actor === "CORNER" || (v.next?.stepNo >= 10 && v.next?.stepNo <= 12)
      : v.next?.stepNo == null || v.next.stepNo <= 9 || v.next?.wait === "AWAITING_QC"))
    .sort((a, b) => (b.plan?.priority ?? 0) - (a.plan?.priority ?? 0)
      || new Date(a.plan?.targetStartAt || 0).getTime() - new Date(b.plan?.targetStartAt || 0).getTime());
  return { operator: { id: operator.id }, items };
}

// ---------------------------------------------------------------------------
// Andon TV: seluruh unit papan hari ini + ringkasan per bucket.
// ---------------------------------------------------------------------------
export async function getAndonBoard(prisma, { date, unitIds, config = BOARD_DEFAULTS, now = new Date() }) {
  const board = await getProductionBoard(prisma, { date, unitIds, config, now });
  const all = board.stations.flatMap((s) => s.items);
  const counts = Object.fromEntries(ANDON_BUCKETS.map((b) => [b.key, all.filter((v) => v.bucket === b.key).length]));
  return {
    date: board.date, generatedAt: now.toISOString(), kpi: board.kpi, buckets: ANDON_BUCKETS, counts,
    stations: board.stations.map((s) => ({
      code: s.code, label: s.label, capacity: s.capacity, operatorNames: s.operatorNames,
      items: s.items.map((v) => ({
        runId: v.runId, unitCode: v.unit.unitCode, customerName: v.customer.name, merk: v.unit.merk, ukuran: v.unit.ukuran,
        bucket: v.bucket, bucketLabel: v.bucketLabel, stepNo: v.next?.stepNo ?? null, stepLabel: v.next?.stepNo ? STEP_BY_NO[v.next.stepNo]?.label : null,
        progress: v.progress, timer: v.timer, priority: v.plan?.priority ?? 0, operatorName: v.plan?.operator?.name ?? null,
        cornerName: v.plan?.cornerOperator?.name ?? null, shortage: v.shortage ? v.shortage.items.map((i) => i.name) : null,
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Antrean Gudang produksi: kebutuhan bahan dari planning/reservasi (P3/P4), kekurangan bahan (P8), unit masuk (P1-P2), barang jadi (P6).
// Stok TIDAK berkurang di sini — penyerahan tetap lewat Material Issue P4 (pick).
// ---------------------------------------------------------------------------
export async function getWarehouseProductionQueue(prisma, { unitIds, now = new Date() }) {
  const [plans, shortages, inbound, finished] = await Promise.all([
    prisma.productionRunPlan.findMany({
      where: { status: { not: "CANCELLED" }, run: { unitId: { in: unitIds }, status: { notIn: TERMINAL_RUN } }, bomLines: { some: { status: "ACTIVE" } } },
      include: {
        run: { select: { id: true, unit: { select: { unitCode: true, order: { select: { orderNumber: true, customer: { select: { name: true } } } } } } } },
        bomLines: { where: { status: "ACTIVE" }, include: { material: { select: { code: true, name: true, unit: true } } } },
        materialIssues: { where: { status: { not: "CANCELLED" } }, select: { id: true, issueNumber: true, status: true, revision: true, reworkInspectionId: true } },
        operator: { select: { user: { select: { name: true } } } },
      },
      orderBy: [{ productionDate: "asc" }, { priority: "desc" }],
    }),
    prisma.productionMaterialShortage.findMany({
      where: { status: "OPEN", unitId: { in: unitIds } },
      include: { unit: { select: { unitCode: true, order: { select: { orderNumber: true, customer: { select: { name: true } } } } } }, run: { select: { plan: { select: { stationCode: true } } } } },
      orderBy: { reportedAt: "asc" },
    }),
    prisma.unitCustodyHandoff.findMany({
      where: { status: "OFFERED", direction: "INBOUND", unitId: { in: unitIds } },
      select: { id: true, revision: true, offeredAt: true, unit: { select: { unitCode: true, order: { select: { customer: { select: { name: true } } } } } } },
      orderBy: { offeredAt: "asc" },
    }),
    prisma.unitCustodyHandoff.findMany({
      where: { status: "OFFERED", direction: "FINISHED_GOODS", unitId: { in: unitIds } },
      select: { id: true, revision: true, offeredAt: true, productionRunId: true, unit: { select: { unitCode: true, order: { select: { customer: { select: { name: true } } } } } } },
      orderBy: { offeredAt: "asc" },
    }),
  ]);
  const materialNeeds = plans.map((plan) => {
    const issues = plan.materialIssues;
    const statusKey = issues.some((i) => i.status === "ISSUED") && !issues.some((i) => i.status === "READY_TO_PICK")
      ? "SUDAH_DISERAHKAN"
      : issues.some((i) => i.status === "READY_TO_PICK") ? "SIAP_DIAMBIL"
        : plan.status === "MATERIAL_RESERVED" ? "MENUNGGU_PERMINTAAN" : "MENUNGGU_DISIAPKAN";
    const hasShortage = shortages.some((s) => s.runId === plan.runId);
    return {
      planId: plan.id, runId: plan.runId, unitCode: plan.run.unit.unitCode, customerName: plan.run.unit.order?.customer?.name ?? null,
      orderNumber: plan.run.unit.order?.orderNumber ?? null, stationLabel: stationLabel(plan.stationCode), productionDate: formatProductionDate(plan.productionDate),
      operatorName: plan.operator?.user?.name ?? null, planStatus: plan.status, planRevision: plan.revision,
      // Status kebutuhan = status Material Issue rencana; laporan kekurangan (bisa bahan di luar BOM) tampil sebagai kartu terpisah.
      status: statusKey, hasShortage,
      lines: plan.bomLines.map((l) => ({ materialId: l.materialId, code: l.material.code, name: l.material.name, qty: Number(l.qty), uom: l.material.unit, supplemental: !!l.supplementalInspectionId })),
      issues: issues.map((i) => ({ id: i.id, issueNumber: i.issueNumber, status: i.status, revision: i.revision, supplemental: !!i.reworkInspectionId })),
    };
  });
  return {
    generatedAt: now.toISOString(),
    kpi: { inbound: inbound.length, materialRequests: materialNeeds.filter((m) => m.status !== "SUDAH_DISERAHKAN").length, shortages: shortages.length, finishedGoods: finished.length },
    shortages: shortages.map((s) => ({
      id: s.id, revision: s.revision, runId: s.runId, unitCode: s.unit.unitCode, customerName: s.unit.order?.customer?.name ?? null,
      stationLabel: stationLabel(s.run.plan?.stationCode), items: s.items, note: s.note, reportedAt: s.reportedAt, waitingMinutes: minutesBetween(s.reportedAt, now),
    })),
    materialNeeds,
    inbound: inbound.map((h) => ({ handoffId: h.id, revision: h.revision, unitCode: h.unit.unitCode, customerName: h.unit.order?.customer?.name ?? null, offeredAt: h.offeredAt })),
    finishedGoods: finished.map((h) => ({ handoffId: h.id, revision: h.revision, runId: h.productionRunId, unitCode: h.unit.unitCode, customerName: h.unit.order?.customer?.name ?? null, offeredAt: h.offeredAt })),
  };
}

// ---------------------------------------------------------------------------
// Paket laporan (before–process–after) untuk Sales. Media bertanda tangan (akses aman, 60 menit). Status broadcast = baris outbox
// `production.report.ready` (PENDING sampai consumer mengirim; tidak pernah dikarang terkirim).
// ---------------------------------------------------------------------------
const latestOf = (evidence, stepNo) => evidence.filter((e) => e.stepNo === stepNo).at(-1) || null;

export function buildReportMessage(report) {
  const lines = [];
  lines.push("✅ [LAPORAN PRODUKSI SELESAI — KLINIK MATRAS]");
  lines.push(`Order      : ${report.order.orderNumber || "—"} — ${report.order.customerName || "—"}`);
  lines.push(`Merk/Ukuran: ${[report.unit.merk, report.unit.ukuran].filter(Boolean).join(" ") || "—"}`);
  lines.push(`PIC Meja   : ${report.pic.table || "—"} | PIC Corner: ${report.pic.corner || "—"}`);
  lines.push(`PIC Sales  : ${report.pic.sales || "—"}`);
  lines.push("");
  lines.push("🔍 RINGKASAN DIAGNOSA & TEMUAN BONGKAR:");
  if (report.order.complaints.length) lines.push(`• Keluhan Customer : ${report.order.complaints.join(", ")}`);
  if (report.measurement) lines.push(`• Uji Fondasi Lama : Diuji beban ${report.measurement.testerWeightKg} kg, turun dari ${report.measurement.heightBeforeCm} cm ke ${report.measurement.heightCompressedCm} cm (amblas ${report.measurement.dropCm} cm).`);
  if (report.diagnosis) lines.push(`• Diagnosa Teknis  : ${report.diagnosis}`);
  lines.push("");
  lines.push("🛠️ TINDAKAN RESTORASI & KOMPONEN BARU (TERCATAT DI WAREHOUSE):");
  if (report.materials.foundation.length) lines.push(`• Fondasi Baru : ${report.materials.foundation.map((m) => `${m.name} (${m.code})`).join(" + ")}`);
  if (report.materials.layer.length) lines.push(`• Lapisan Baru : ${report.materials.layer.map((m) => `${m.name} (${m.code})`).join(" + ")}`);
  if (report.finalTest) lines.push(`• Uji Akhir    : Diuji beban ${report.finalTest.testerWeightKg} kg -> Hasil Tekstur ${VERDICT_LABEL[report.finalTest.verdict] || report.finalTest.verdict}`);
  if (report.finishing) lines.push(`• Finishing    : Model ${STYLE_LABEL[report.finishing.mattressStyle] || report.finishing.mattressStyle} | Kain ${report.finishing.fabricSpec} | List ${report.finishing.borderColor}`);
  lines.push("");
  lines.push(`📸 PAKET DOKUMENTASI BEFORE - PROSES - AFTER (${report.mediaCount} MEDIA):`);
  lines.push(`🔗 ${report.reportPath}`);
  lines.push("");
  lines.push(report.handoffStatus === "ACCEPTED"
    ? "Status saat ini: READY FOR DELIVERY HANDOFF. Silakan konfirmasi jadwal kirim ke customer."
    : "Status saat ini: menunggu diterima Gudang (barang jadi). Jadwal kirim dikonfirmasi setelah Gudang menerima.");
  return lines.join("\n");
}

export async function getProductionReport(prisma, runId, { unitIds } = {}) {
  const run = await prisma.productionRun.findFirst({ where: { id: runId, unitId: { in: unitIds } }, include: RUN_VIEW_INCLUDE });
  if (!run) return null;
  const ctx = await loadStepContext(prisma, run);
  const evidence = ctx.evidence;
  const materialIds = [...new Set(evidence.filter((e) => [6, 7, 10].includes(e.stepNo)).flatMap((e) => (e.payload?.materials || []).map((m) => m.materialId)))];
  const materials = materialIds.length ? await prisma.material.findMany({ where: { id: { in: materialIds } }, select: { id: true, code: true, name: true, unit: true } }) : [];
  const matById = new Map(materials.map((m) => [m.id, m]));
  const linesOf = (stepNo) => {
    const rows = evidence.filter((e) => e.stepNo === stepNo);
    const latestPerOp = new Map();
    for (const r of rows) latestPerOp.set(r.operationRunId || r.id, r);
    return [...latestPerOp.values()].flatMap((e) => (e.payload?.materials || []).map((m) => ({ ...m, code: matById.get(m.materialId)?.code ?? "—", name: matById.get(m.materialId)?.name ?? "—", uom: matById.get(m.materialId)?.unit ?? null })));
  };
  const actorIds = [...new Set(evidence.map((e) => e.actorId).filter(Boolean))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));
  const tableActor = latestOf(evidence, 5)?.actorId || latestOf(evidence, 1)?.actorId;
  const cornerActor = latestOf(evidence, 11)?.actorId || latestOf(evidence, 10)?.actorId;
  const mediaOf = (stepNos) => evidence.filter((e) => stepNos.includes(e.stepNo)).flatMap((e) => (Array.isArray(e.media) ? e.media : []).map((m) => ({ stepNo: e.stepNo, stepLabel: STEP_BY_NO[e.stepNo]?.label, kind: m.kind, url: signEvidenceUrl(m.url) }))).filter((m) => m.url);
  const measurement = latestOf(evidence, 4)?.payload ?? null;
  const finalTests = evidence.filter((e) => e.stepNo === 8);
  const finalPass = [...finalTests].reverse().find((e) => e.payload?.verdict === "PAS");
  const fg = run.custodyHandoffs.filter((h) => h.direction === "FINISHED_GOODS").at(-1);
  const outboxRow = await prisma.domainOutbox.findFirst({
    where: { eventType: "production.report.ready", aggregateId: run.id }, orderBy: { id: "desc" },
    select: { status: true, deliveredAt: true, attempts: true, lastError: true, createdAt: true },
  });
  const report = {
    runId: run.id, status: run.status, reportPath: `/bengkel/production-v2/laporan/${run.id}`,
    ready: !!latestOf(evidence, 12),
    unit: { unitCode: run.unit.unitCode, merk: run.unit.merk, ukuran: run.unit.ukuran, service: run.unit.service?.labelId ?? null },
    order: { orderNumber: run.unit.order?.orderNumber ?? null, customerName: run.unit.order?.customer?.name ?? null, complaints: (run.unit.order?.complaintCategory || []).map((c) => COMPLAINT_LABEL[c] || c), request: run.unit.order?.notes ?? null, weightKg: run.unit.order?.beratBadan ?? null },
    pic: {
      table: actorName.get(tableActor) || nameOf(run.plan?.operator) || null,
      corner: actorName.get(cornerActor) || nameOf(run.plan?.cornerOperator) || null,
      sales: run.unit.order?.customer?.assignedSales?.name ?? null,
      station: stationLabel(run.plan?.stationCode),
    },
    beforeFeel: latestOf(evidence, 2)?.payload?.feelNote ?? null,
    oldMaterials: latestOf(evidence, 3)?.payload?.oldMaterials ?? [],
    measurement,
    diagnosis: latestOf(evidence, 5)?.payload?.diagnosis ?? null,
    materials: { foundation: linesOf(6), layer: linesOf(7), finishing: linesOf(10) },
    textureTests: finalTests.map((e) => ({ version: e.version, verdict: e.payload?.verdict, testerWeightKg: e.payload?.testerWeightKg, at: e.createdAt })),
    finalTest: finalPass ? finalPass.payload : null,
    qc: ctx.latestInspection ? { result: ctx.latestInspection.result, version: ctx.latestInspection.version, at: ctx.latestInspection.inspectedAt } : null,
    finishing: latestOf(evidence, 10)?.payload ?? null,
    cornerChecklist: latestOf(evidence, 11)?.payload?.checklist ?? null,
    media: { before: mediaOf([1, 2, 3]), process: mediaOf([4, 6, 7]), after: mediaOf([8, 9, 11, 12]) },
    handoffStatus: fg?.status ?? null,
    broadcast: outboxRow
      ? { status: outboxRow.status, deliveredAt: outboxRow.deliveredAt, attempts: outboxRow.attempts, lastError: outboxRow.lastError, queuedAt: outboxRow.createdAt, consumerAvailable: false }
      : { status: "BELUM_ADA", consumerAvailable: false },
  };
  report.mediaCount = report.media.before.length + report.media.process.length + report.media.after.length;
  report.message = buildReportMessage(report);
  return report;
}

export { stepNoForStage };
