// Read-model Production Experience V2 (P8): papan Planner, kartu pekerja (Table/Corner), Andon, antrean Gudang produksi, laporan Sales.
// BACA-SAJA. Semua keadaan tahap diturunkan dari data P1–P6 + bukti P8 lewat loadStepContext (sumber yang sama dengan command) —
// tidak ada status UI yang disimpan terpisah. Pemanggil (routes) wajib memfilter unitIds dari reader cohort; unit di luar cohort tidak pernah
// dimuat. Data customer seperlunya: nama, berat badan, keluhan, request — tanpa telepon/alamat.
import {
  ANDON_BUCKETS, COMMAND_CENTER_COLUMNS, STEP_BY_NO, STEPS, andonBucketOf, commandCenterColumn, isSkippedEvidence, stepNoForStage,
} from "../lib/domain/productionSteps.js";
import { listMaterialReturns } from "./productionMaterialReturnService.js";
import { BOARD_DEFAULTS, compareStationOrder, formatProductionDate, parseProductionDate, stationLabel, todayWib } from "../lib/domain/productionBoard.js";
import { applicableStepsFor, loadStepContext } from "./productionStepCommandService.js";
import { buildRunDocumentation, documentationBuckets } from "./productionDocumentationRead.js";
import { sourceOfStep } from "../lib/domain/productionDocumentation.js";
import { listEligibleUnitsForPlanning } from "./productionPlanningCommandService.js";
import { signEvidenceUrl } from "../routes/productionEvidenceMedia.js";
import { signUnitPhotoUrlIfAny, signUnitPhotoUrlsBulk } from "../routes/productionUnitPhoto.js";
import { delayReasonOfBlock, displayStatusOfOrder, displayStatusOfUnit, isFinishedUnitStatus, physicalPresenceOf, priorityDisplay } from "../lib/domain/productionDisplay.js";
import { loadOpenComplaintsByUnit } from "./productionComplaints.js";

const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];
export const COMPLAINT_LABEL = Object.freeze({
  KEPALA_PUSING: "Kepala pusing", SAKIT_PINGGANG: "Sakit pinggang", SAKIT_PUNGGUNG: "Sakit punggung", SAKIT_LEHER: "Sakit leher",
  BAHU: "Bahu", PEGAL_PEGAL: "Pegal-pegal", SARAF_KEJEPIT: "Saraf kejepit", SKOLIOSIS: "Skoliosis", LAINNYA: "Lainnya",
});
export const STYLE_LABEL = Object.freeze({ BIASA: "Kasur Biasa", PLUSHTOP: "Plushtop", PILLOWTOP: "Pillowtop" });
export const VERDICT_LABEL = Object.freeze({ PAS: "PAS", TERLALU_KERAS: "Terlalu Keras", TERLALU_EMPUK: "Terlalu Empuk" });

export const RUN_VIEW_INCLUDE = {
  unit: {
    select: {
      id: true, unitCode: true, orderId: true, serviceId: true, status: true, currentStageId: true, merk: true, ukuran: true,
      service: { select: { code: true, labelId: true } },
      order: {
        select: {
          orderNumber: true, status: true, category: true, productType: true, beratBadan: true, notes: true, complaintCategory: true, customerPromiseDate: true,
          // P9 UX — nama layanan yang DIPESAN di Sales (snapshot OrderItem.layananName). SENGAJA hanya nama: harga tidak di-select.
          items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } },
          weightEntries: { select: { label: true, beratKg: true }, orderBy: { sortOrder: "asc" } },
          customer: { select: { name: true, city: true, pipelineStage: true, isInternalStaff: true, assignedSales: { select: { id: true, name: true } } } },
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

export const nameOf = (op) => op?.user?.name ?? null;
export const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));

export function materialStatusOf(plan, material, shortage) {
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
export function stepStatuses(ctx) {
  const applicable = applicableStepsFor(ctx.split);
  const recorded = new Map();
  for (const e of ctx.evidence) recorded.set(e.stepNo, e);
  const next = ctx.next || {};
  return STEPS.map((step) => {
    const e = recorded.get(step.no);
    let status;
    if (!applicable.includes(step.no)) status = "NA";
    else if (e && isSkippedEvidence(e)) status = "SKIPPED"; // dilewati (mode adaptasi) — BUKAN dikerjakan; tanpa foto/hasil uji
    else if (next.wait === "COMPLETED") status = "DONE";
    else if (step.no === next.stepNo && next.action !== "WAIT") status = "CURRENT";
    else if (step.no === next.stepNo && next.action === "WAIT" && !e) status = "WAITING";
    else if (e) status = "DONE";
    else status = "PENDING";
    return { no: step.no, code: step.code, label: step.label, actor: step.actor, status, at: e?.createdAt ?? null, version: e?.version ?? null };
  });
}

export function indicatorsOf(run, ctx, materialStatus) {
  const inbound = run.custodyHandoffs.filter((h) => h.direction === "INBOUND").at(-1);
  const fg = run.custodyHandoffs.filter((h) => h.direction === "FINISHED_GOODS").at(-1);
  const qc = ctx.latestInspection;
  return {
    custody: inbound ? (inbound.status === "ACCEPTED" ? "OK" : inbound.status) : (run.origin === "WORKSHOP_BORN" ? "LAHIR_DI_WORKSHOP" : "BELUM"),
    service: run.unit.serviceId ? "OK" : "BELUM",
    bom: run.plan?.bomLines.length ? "OK" : "BELUM",
    material: materialStatus.key,
    workshop: ctx.state.activeOp ? (ctx.state.activeOp.status === "PAUSED" ? "DIJEDA" : "BERJALAN") : (run.operations.length ? "MENUNGGU" : "BELUM_MULAI"),
    qc: qc ? (qc.result === "PASS" ? "LULUS" : qc.result === "FAIL_REWORK" ? "REWORK" : qc.result === "OVERRIDDEN" ? "WAIVED" : qc.result)
      : (run.adaptationPolicy && run.operations.some((o) => o.status === "SKIPPED" && o.planSnapshot?.qcNotPerformed) ? "TIDAK_DILAKUKAN" : "BELUM"),
    handoff: fg ? fg.status : "BELUM",
  };
}

export function warningsOf(run, ctx, materialStatus) {
  const w = [];
  if (!run.plan?.operatorId) w.push({ code: "OPERATOR_BELUM", text: "PIC meja belum ditetapkan" });
  const diagnosed = ctx.evidence.some((e) => e.stepNo === 5 && !isSkippedEvidence(e)); // tahap dilewati (adaptasi) bukan diagnosa yang selesai
  if (diagnosed && !run.plan?.bomLines.length) w.push({ code: "BOM_BELUM", text: "Diagnosa selesai — BOM belum dibuat" });
  if (["BOM_BELUM_ADA", "BELUM_DIRESERVASI", "MENUNGGU_DISIAPKAN", "SIAP_DIAMBIL"].includes(materialStatus.key) && diagnosed) w.push({ code: "BAHAN_BELUM", text: materialStatus.label });
  if (ctx.openShortage) w.push({ code: "KEKURANGAN", text: "Menunggu bahan baku dari Gudang" });
  if (ctx.pathError) w.push({ code: "JALUR", text: ctx.pathError });
  if (run.plan?.targetCompleteAt && !TERMINAL_RUN.includes(run.status) && run.currentPhase !== "HANDOFF" && new Date(run.plan.targetCompleteAt).getTime() < Date.now()) {
    w.push({ code: "TERLAMBAT", text: "Melewati target selesai" });
  }
  return w;
}

export function customerOf(run) {
  const order = run.unit.order;
  return {
    orderNumber: order?.orderNumber ?? null,
    category: order?.category ?? null,
    productType: order?.productType ?? null,
    name: order?.customer?.name ?? null,
    city: order?.customer?.city ?? null,
    weightKg: order?.beratBadan ?? null,
    weightEntries: order?.weightEntries ?? [],
    complaints: (order?.complaintCategory || []).map((c) => COMPLAINT_LABEL[c] || c),
    request: order?.notes ?? null,
    salesServices: (order?.items || []).map((i) => i.layananName).filter(Boolean),
    sleepPosition: null, // belum ditangkap Sales (gap P8)
    promiseDate: order?.customerPromiseDate ?? null,
    salesName: order?.customer?.assignedSales?.name ?? null,
  };
}

export function toRunView(run, ctx, { now = new Date(), photoUrl = null, complaints = [] } = {}) {
  const shortage = ctx.openShortage;
  const materialStatus = materialStatusOf(run.plan, ctx.material, shortage);
  const steps = stepStatuses(ctx);
  const applicable = steps.filter((s) => s.status !== "NA");
  const started = run.operations.length > 0 || ctx.evidence.length > 0;
  const firstStart = run.operations[0]?.startedAt ?? null;
  const op = ctx.state.activeOp;
  const next = ctx.next;
  const bucket = andonBucketOf({ next, started });
  const prio = priorityDisplay({ stored: run.plan?.priority ?? 0, complaintCases: complaints });
  const inboundAccepted = run.custodyHandoffs.some((h) => h.direction === "INBOUND" && h.status === "ACCEPTED");
  return {
    runId: run.id, revision: run.revision, status: run.status, currentPhase: run.currentPhase, origin: run.origin,
    // Tiga sumbu terpisah (simplifikasi slice 1): status order, keberadaan fisik, tahap (next/bucket). service (teknis) tetap ada di payload sebagai data historis; UI hanya menampilkan Layanan Sales.
    orderStatus: displayStatusOfOrder(run.unit.order?.status) || null,
    unitStatus: displayStatusOfUnit(run.unit.status) || null,
    presence: physicalPresenceOf({ unitStatus: run.unit.status, runStatus: run.status, runOrigin: run.origin, inboundAccepted }),
    priority: { key: prio.key, label: prio.label, rank: prio.rank, complaintCases: prio.complaintCases },
    unit: { id: run.unit.id, orderId: run.unit.orderId, unitCode: run.unit.unitCode, merk: run.unit.merk, ukuran: run.unit.ukuran, status: run.unit.status, service: run.unit.service ? { code: run.unit.service.code, label: run.unit.service.labelId } : null, photoUrl },
    customer: customerOf(run),
    plan: run.plan ? {
      id: run.plan.id, status: run.plan.status, revision: run.plan.revision,
      productionDate: formatProductionDate(run.plan.productionDate), stationCode: run.plan.stationCode, stationLabel: stationLabel(run.plan.stationCode),
      stationSequence: run.plan.stationSequence ?? null,
      priority: run.plan.priority, priorityLabel: prio.label, priorityKey: prio.key, priorityRank: prio.complaintCases.length ? 3 : (run.plan.priority ?? 0), // rank untuk URUTAN bawaan: Komplain > nilai tersimpan (Mendesak lama tetap di atas Tinggi)
      workCenter: run.plan.workCenter, cornerWorkCenter: run.plan.cornerWorkCenter,
      operator: run.plan.operator ? { id: run.plan.operator.id, userId: run.plan.operator.userId, name: nameOf(run.plan.operator) } : null,
      cornerOperator: run.plan.cornerOperator ? { id: run.plan.cornerOperator.id, userId: run.plan.cornerOperator.userId, name: nameOf(run.plan.cornerOperator) } : null,
      targetStartAt: run.plan.targetStartAt, targetCompleteAt: run.plan.targetCompleteAt,
      bomCount: run.plan.bomLines.length,
    } : null,
    next, bucket, bucketLabel: ANDON_BUCKETS.find((b) => b.key === bucket)?.label ?? bucket,
    // Progres membedakan dikerjakan (done) / dilewati (skipped) / tersisa (remaining). KPI & kunci 12/12 hanya menghitung "done" sebagai pekerjaan.
    progress: (() => {
      const worked = applicable.filter((s) => s.status === "DONE").length; const skipped = applicable.filter((s) => s.status === "SKIPPED").length;
      return { done: worked, skipped, remaining: applicable.length - worked - skipped, total: applicable.length };
    })(),
    adaptation: run.adaptationPolicy ? { policy: run.adaptationPolicy } : null,
    steps,
    activeOp: op ? { stageLabel: op.stageLabel, status: op.status, startedAt: op.startedAt, delayKind: op.delayKind ?? null, delayNote: op.delayNote ?? null } : null,
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

export async function loadRuns(prisma, where) {
  return prisma.productionRun.findMany({ where, include: RUN_VIEW_INCLUDE, orderBy: [{ createdAt: "asc" }] });
}
export async function viewsOf(prisma, runs, opts) {
  const photoByUnit = await signUnitPhotoUrlsBulk(prisma, runs.map((r) => r.unitId));
  const complaintsByUnit = await loadOpenComplaintsByUnit(prisma, runs.map((r) => ({ id: r.unitId, orderId: r.unit?.orderId ?? null })));
  const views = [];
  for (const run of runs) views.push(toRunView(run, await loadStepContext(prisma, run), { ...opts, photoUrl: photoByUnit.get(run.unitId) ?? null, complaints: complaintsByUnit.get(run.unitId) || [] }));
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
      unit: { select: { id: true, unitCode: true, merk: true, ukuran: true, storageLocation: true, order: { select: { orderNumber: true, productType: true, notes: true, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, customer: { select: { name: true, city: true } } } } } },
    },
    orderBy: [{ offeredAt: "asc" }],
  });
  return handoffs.map((h) => ({
    runId: null, handoffId: h.id,
    unit: { id: h.unit.id, unitCode: h.unit.unitCode, merk: h.unit.merk, ukuran: h.unit.ukuran, storageLocation: h.unit.storageLocation, orderNumber: h.unit.order?.orderNumber ?? null },
    // P9 kontrak layanan: kartu warisan juga membawa pelanggan + Layanan DIPESAN Sales (nama saja, tanpa harga) — read-only dari order.
    customer: { name: h.unit.order?.customer?.name ?? null, city: h.unit.order?.customer?.city ?? null, productType: h.unit.order?.productType ?? null, request: h.unit.order?.notes ?? null, salesServices: (h.unit.order?.items || []).map((i) => i.layananName).filter(Boolean) },
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
  const unscheduledAll = await viewsOf(prisma, unscheduledRuns, { now });
  // Siap Kirim/Terkirim (status unit) tidak tampil di meja maupun backlog; datanya tetap utuh dan KPI hari itu tetap menghitung seluruh rencana.
  const workable = (v) => !isFinishedUnitStatus(v.unit.status);
  const unscheduled = unscheduledAll.filter(workable);
  const stations = config.stations.map((code) => {
    const items = scheduled.filter((v) => v.plan?.stationCode === code && workable(v)).sort((a, b) => compareStationOrder(a.plan, b.plan));
    const operatorNames = [...new Set(items.map((v) => v.plan?.operator?.name).filter(Boolean))];
    return { code, label: stationLabel(code), capacity: config.capacityPerStation, count: items.length, operatorNames, items };
  });
  const completed = scheduled.filter((v) => ["HANDOFF", "SELESAI"].includes(v.bucket)).length;
  return {
    date: formatProductionDate(day), config: { dailyTarget: config.dailyTarget, stations: config.stations, capacityPerStation: config.capacityPerStation },
    hiddenFinished: scheduled.filter((v) => !workable(v)).length,
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
// P9B — Command Center: Ringkasan Produksi (KPI + Butuh Perhatian) DAN kolom pipeline Rencana Produksi, dari SATU sumber
// data (views hasil toRunView atas SELURUH run non-terminal cohort + kartu warisan tanpa run + pickup yang akan masuk) —
// setiap angka KPI = panjang salah satu daftar yang JUGA dikirim ke klien (tidak ada penghitungan bayangan terpisah).
// BACA-SAJA, tanpa mutasi apa pun. Aman untuk unit warisan OFFERED tanpa run (mis. canary) — masuk lewat
// listAwaitingArrivalNoRunUnits yang sama dipakai getProductionBoard, TIDAK dipaksa masuk toRunView (yang butuh Run).
// order.value HANYA disertakan bila canSeeValue true (ORDER_PRICE_READ) — query terpisah, field TIDAK PERNAH di-select
// dari Prisma saat false (bukan cuma disaring di respons).
// ---------------------------------------------------------------------------
function attentionItemsFrom(views, { today }) {
  const items = [];
  const push = (v, severity, code, text) => items.push({
    severity, code, text, unitCode: v.unit.unitCode, runId: v.runId, customerName: v.customer.name, orderNumber: v.customer.orderNumber,
  });
  for (const v of views) {
    const label = `${v.unit.unitCode} (${v.customer.name || "pelanggan tanpa nama"})`;
    // Target hari ini belum dimulai: dijadwalkan hari ini, belum ada bukti tahap tercatat, dan tidak sedang berjalan.
    if (v.plan?.productionDate === today && v.progress.done === 0 && !v.activeOp) push(v, "critical", "TARGET_BELUM_MULAI", `${label}: target hari ini, belum dimulai`);
    if (v.warnings.some((w) => w.code === "TERLAMBAT")) push(v, "critical", "TERLAMBAT", `${label}: melewati target selesai`);
    if (v.shortage) push(v, "critical", "KEKURANGAN_BAHAN", `${label}: menunggu bahan baku dari Gudang`);
    if (v.bucket === "TERHENTI") push(v, "critical", "TERHENTI", `${label}: proses terhenti — perlu tindakan Production Lead`);
    // Data Sales penting belum lengkap — definisi konservatif: berat badan customer (satu-satunya field kuantitatif wajib
    // untuk diagnosa/fondasi yang SUDAH dimodelkan Order.beratBadan) belum diisi.
    if (v.customer.weightKg == null) push(v, "warning", "DATA_SALES_BELUM_LENGKAP", `${label}: berat badan customer belum diisi Sales`);
    // PIC/meja belum ada — HANYA untuk unit yang SUDAH dijadwalkan ke meja+tanggal tapi PIC belum ditetapkan (unit yang
    // memang belum dijadwalkan sama sekali sudah terhitung tersendiri di KPI "Belum Dijadwalkan", tidak diulang di sini).
    if (v.plan?.stationCode && !v.plan?.operator) push(v, "warning", "PIC_BELUM_ADA", `${label}: sudah dijadwalkan tapi PIC meja belum ditetapkan`);
  }
  const rank = { critical: 0, warning: 1 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export async function getProductionCommandCenter(prisma, { unitIds, now = new Date(), canSeeValue = false, config = BOARD_DEFAULTS } = {}) {
  const today = todayWib(now);
  const startOfTodayUtc = new Date(`${today}T00:00:00.000Z`);
  const cohort = { unitId: { in: unitIds } };
  const [activeRuns, completedTodayRuns, awaitingArrivalNoRun, upcomingJobs] = await Promise.all([
    loadRuns(prisma, { ...cohort, status: { notIn: TERMINAL_RUN } }),
    loadRuns(prisma, { ...cohort, status: "COMPLETED", completedAt: { gte: startOfTodayUtc } }),
    listAwaitingArrivalNoRunUnits(prisma, unitIds),
    prisma.job.findMany({
      where: { type: "PICKUP", status: { notIn: ["COMPLETED", "FAILED", "RESCHEDULED"] }, units: { some: { unitId: { in: unitIds } } } },
      select: {
        id: true, status: true, scheduledDate: true, driver: { select: { name: true } },
        units: {
          where: { unitId: { in: unitIds } },
          select: { unit: { select: { id: true, unitCode: true, merk: true, ukuran: true, order: { select: { orderNumber: true, productType: true, notes: true, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, customer: { select: { name: true, city: true } } } } } } },
        },
      },
      orderBy: [{ scheduledDate: "asc" }],
    }),
  ]);
  const viewsAll = await viewsOf(prisma, activeRuns, { now });
  const views = viewsAll.filter((v) => !isFinishedUnitStatus(v.unit.status)); // Siap Kirim/Terkirim tidak tampil di papan/backlog
  const completedToday = await viewsOf(prisma, completedTodayRuns, { now });

  let valueByOrderId = new Map();
  if (canSeeValue) {
    const orderIds = [...new Set(views.map((v) => v.unit.orderId).filter(Boolean))];
    if (orderIds.length) {
      const orders = await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, value: true } });
      valueByOrderId = new Map(orders.map((o) => [o.id, Number(o.value ?? 0)]));
    }
  }
  const withValue = (v) => (canSeeValue ? { ...v, orderValue: valueByOrderId.get(v.unit.orderId) ?? null } : v);

  const akanMasuk = upcomingJobs.flatMap((job) => job.units.map((ju) => ({
    kind: "UPCOMING_PICKUP", jobId: job.id, jobStatus: job.status, scheduledDate: job.scheduledDate ? formatProductionDate(job.scheduledDate) : null,
    driverName: job.driver?.name ?? null,
    unit: { id: ju.unit.id, unitCode: ju.unit.unitCode, merk: ju.unit.merk, ukuran: ju.unit.ukuran, orderNumber: ju.unit.order?.orderNumber ?? null },
    customer: { name: ju.unit.order?.customer?.name ?? null, city: ju.unit.order?.customer?.city ?? null, productType: ju.unit.order?.productType ?? null, request: ju.unit.order?.notes ?? null, salesServices: (ju.unit.order?.items || []).map((i) => i.layananName).filter(Boolean) },
  })));
  // Dedup per unit (satu unit idealnya satu Job pickup aktif; kalau ada anomali data lama dengan >1, tampilkan sekali saja berdasar yang paling awal terjadwal).
  const akanMasukByUnit = new Map();
  for (const item of akanMasuk) if (!akanMasukByUnit.has(item.unit.id)) akanMasukByUnit.set(item.unit.id, item);
  const akanMasukList = [...akanMasukByUnit.values()];

  // Foto identitas untuk dua daftar non-Run di atas (kartu Run sudah dapat dari viewsOf) — satu panggilan batch,
  // bukan per kartu, supaya tetap tidak N+1 walau daftarnya digabung dari dua sumber berbeda.
  const extraPhotoUnitIds = [...akanMasukList.map((i) => i.unit.id), ...awaitingArrivalNoRun.map((i) => i.unit.id)];
  const extraPhotoByUnit = await signUnitPhotoUrlsBulk(prisma, extraPhotoUnitIds);
  for (const item of akanMasukList) item.unit.photoUrl = extraPhotoByUnit.get(item.unit.id) ?? null;
  for (const item of awaitingArrivalNoRun) item.unit.photoUrl = extraPhotoByUnit.get(item.unit.id) ?? null;

  const columns = Object.fromEntries(COMMAND_CENTER_COLUMNS.map((c) => [c.key, []]));
  for (const v of views) {
    const col = commandCenterColumn(v);
    if (col) columns[col].push(withValue(v));
  }
  columns.AKAN_MASUK = akanMasukList;
  // P9B.1 — unit warisan (OFFERED, tanpa Run sama sekali) secara fisik SAMA dengan "pickup selesai, belum
  // dikonfirmasi tiba" — masuk kolom DALAM_PERJALANAN, bukan lagi kolom "Belum Dijadwalkan" yang sudah dihapus.
  columns.DALAM_PERJALANAN = [...columns.DALAM_PERJALANAN, ...awaitingArrivalNoRun];

  const dalamPerjalanan = views.filter((v) => v.bucket === "DALAM_PERJALANAN").length + awaitingArrivalNoRun.length;
  const belumDijadwalkan = views.filter((v) => !v.plan?.stationCode).length + awaitingArrivalNoRun.length;
  const dijadwalkanHariIni = views.filter((v) => v.plan?.productionDate === today).length;
  const sedangDikerjakan = views.filter((v) => v.activeOp?.status === "ACTIVE").length;
  const menungguBahan = views.filter((v) => v.bucket === "MENUNGGU_BAHAN").length;
  const menungguQc = views.filter((v) => v.bucket === "QC").length;
  const terlambat = views.filter((v) => v.timer.late).length;
  const siapKirim = views.filter((v) => v.bucket === "HANDOFF").length;
  const selesaiHariIni = completedToday.length;

  // Aktivitas PIC & meja hari ini: PIC yang punya unit aktif (plan hari ini ATAU sedang dikerjakan) atau menyelesaikan unit hari ini.
  const picMap = new Map();
  const bumpPic = (name, station, field) => {
    if (!name) return;
    const key = name;
    const row = picMap.get(key) || { name, stationLabel: station || null, active: 0, completedToday: 0 };
    row[field] += 1;
    if (station) row.stationLabel = station;
    picMap.set(key, row);
  };
  for (const v of views) if (v.plan?.productionDate === today || v.activeOp) bumpPic(v.plan?.operator?.name, v.plan?.stationLabel, "active");
  for (const v of completedToday) bumpPic(v.plan?.operator?.name, v.plan?.stationLabel, "completedToday");
  const picActivity = [...picMap.values()].sort((a, b) => (b.active + b.completedToday) - (a.active + a.completedToday));

  return {
    date: today, generatedAt: now.toISOString(),
    kpi: {
      akanMasuk: akanMasukList.length, dalamPerjalanan, belumDijadwalkan, dijadwalkanHariIni, sedangDikerjakan,
      menungguBahan, menungguQc, terlambat, siapKirim,
      target: config.dailyTarget, selesaiHariIni, sisaPekerjaan: Math.max(0, config.dailyTarget - selesaiHariIni),
    },
    attention: attentionItemsFrom(views, { today }),
    picActivity,
    columns: COMMAND_CENTER_COLUMNS.map((c) => ({ key: c.key, label: c.label, count: columns[c.key].length, items: columns[c.key] })),
    completedToday: completedToday.map(withValue),
    canSeeValue,
  };
}

// ---------------------------------------------------------------------------
// Kartu satu unit (pekerja/Planner): view + bukti (media bertanda tangan) + bahan yang sudah diserahkan (untuk tahap 6/7/10).
// ---------------------------------------------------------------------------
export async function getRunCard(prisma, runId, { unitIds, now = new Date() } = {}) {
  const run = await prisma.productionRun.findFirst({ where: { id: runId, unitId: { in: unitIds } }, include: RUN_VIEW_INCLUDE });
  if (!run) return null;
  const ctx = await loadStepContext(prisma, run);
  const view = toRunView(run, ctx, { now, photoUrl: await signUnitPhotoUrlIfAny(prisma, run.unitId) });
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
// all=true (ADMIN/OWNER dengan PRODUCTION_EXECUTE_ANY, keputusan owner 4 Okt 2026): antrean SEMUA PIC pada lane itu, bukan hanya milik sendiri.
export async function listWorkerQueue(prisma, { unitIds, userId, lane, all = false, now = new Date() }) {
  const operator = !all && userId ? await prisma.productionOperator.findUnique({ where: { userId }, select: { id: true, active: true } }) : null;
  if (!all && (!operator || !operator.active)) return { operator: null, items: [] };
  const planWhere = all
    ? { operatorId: { not: null } }
    : lane === "CORNER"
      ? { OR: [{ cornerOperatorId: operator.id }, { cornerOperatorId: null, operatorId: operator.id }] }
      : { operatorId: operator.id };
  const runs = await loadRuns(prisma, {
    unitId: { in: unitIds }, status: { notIn: TERMINAL_RUN },
    plan: { is: { ...planWhere, status: { not: "CANCELLED" } } },
  });
  const views = (await viewsOf(prisma, runs, { now })).filter((v) => !isFinishedUnitStatus(v.unit.status));
  const items = views
    .filter((v) => (lane === "CORNER"
      ? v.next?.actor === "CORNER" || (v.next?.stepNo >= 10 && v.next?.stepNo <= 12)
      : v.next?.stepNo == null || v.next.stepNo <= 9 || v.next?.wait === "AWAITING_QC"))
    // Hari lebih awal dulu, lalu per meja, lalu urutan meja (manual menang atas prioritas — sama dengan papan Rencana).
    .sort((a, b) => String(a.plan?.productionDate || "9999").localeCompare(String(b.plan?.productionDate || "9999"))
      || String(a.plan?.stationCode || "").localeCompare(String(b.plan?.stationCode || ""))
      || compareStationOrder(a.plan, b.plan));
  return { operator: all ? { id: null, all: true } : { id: operator.id }, items };
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
        progress: v.progress, timer: v.timer, priority: v.plan?.priorityRank ?? 0, priorityLabel: v.plan?.priorityLabel ?? "Normal", operatorName: v.plan?.operator?.name ?? null,
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
  const [plans, shortages, inbound, finished, returns] = await Promise.all([
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
    listMaterialReturns(prisma, { status: "PENDING", unitIds }),
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
    kpi: { inbound: inbound.length, materialRequests: materialNeeds.filter((m) => m.status !== "SUDAH_DISERAHKAN").length, shortages: shortages.length, finishedGoods: finished.length, returns: returns.length },
    shortages: shortages.map((s) => ({
      id: s.id, revision: s.revision, runId: s.runId, unitCode: s.unit.unitCode, customerName: s.unit.order?.customer?.name ?? null,
      stationLabel: stationLabel(s.run.plan?.stationCode), items: s.items, note: s.note, reportedAt: s.reportedAt, waitingMinutes: minutesBetween(s.reportedAt, now),
    })),
    materialNeeds,
    returns,
    inbound: inbound.map((h) => ({ handoffId: h.id, revision: h.revision, unitCode: h.unit.unitCode, customerName: h.unit.order?.customer?.name ?? null, offeredAt: h.offeredAt })),
    finishedGoods: finished.map((h) => ({ handoffId: h.id, revision: h.revision, runId: h.productionRunId, unitCode: h.unit.unitCode, customerName: h.unit.order?.customer?.name ?? null, offeredAt: h.offeredAt, returnPending: returns.filter((r) => r.runId === h.productionRunId).length })),
  };
}

// ---------------------------------------------------------------------------
// Paket laporan (before–process–after) untuk Sales. Media bertanda tangan (akses aman, 60 menit). Status broadcast = baris outbox
// `production.report.ready` (PENDING sampai consumer mengirim; tidak pernah dikarang terkirim).
// ---------------------------------------------------------------------------
export const latestOf = (evidence, stepNo) => evidence.filter((e) => e.stepNo === stepNo).at(-1) || null;

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
  if (report.skippedSteps?.length) lines.push(`• Tahap dilewati (Adaptasi sistem): ${report.skippedSteps.map((s) => s.label).join(", ")} — tidak dikerjakan, tanpa foto/hasil uji`);
  if (report.qcStatus === "TIDAK_DILAKUKAN") lines.push("• QC          : tidak dilakukan (mode adaptasi) — bukan lulus");
  lines.push("");
  lines.push(`📸 PAKET DOKUMENTASI BEFORE - PROSES - AFTER (${report.mediaCount} MEDIA):`);
  lines.push(`🔗 ${report.reportPath}`);
  lines.push("");
  lines.push(report.adaptation && report.status === "COMPLETED" && !report.handoffStatus
    ? "Status saat ini: SIAP KIRIM (mode adaptasi — QC dan penerimaan barang jadi Gudang tidak diwajibkan). Silakan konfirmasi jadwal kirim ke customer."
    : report.handoffStatus === "ACCEPTED"
    ? "Status saat ini: READY FOR DELIVERY HANDOFF. Silakan konfirmasi jadwal kirim ke customer."
    : "Status saat ini: menunggu diterima Gudang (barang jadi). Jadwal kirim dikonfirmasi setelah Gudang menerima.");
  return lines.join("\n");
}

export async function getProductionReport(prisma, runId, { unitIds } = {}) {
  const run = await prisma.productionRun.findFirst({ where: { id: runId, unitId: { in: unitIds } }, include: RUN_VIEW_INCLUDE });
  if (!run) return null;
  const ctx = await loadStepContext(prisma, run);
  // Bukti SKIPPED (mode adaptasi) BUKAN pekerjaan: tidak boleh mengisi PIC, hasil uji, bahan, finishing, media, maupun status "siap". Dilaporkan terpisah sebagai tahap dilewati.
  const skippedEvidence = ctx.evidence.filter((e) => isSkippedEvidence(e));
  const evidence = ctx.evidence.filter((e) => !isSkippedEvidence(e));
  const materialIds = [...new Set(evidence.filter((e) => [6, 7, 10].includes(e.stepNo)).flatMap((e) => (e.payload?.materials || []).map((m) => m.materialId)))];
  const materials = materialIds.length ? await prisma.material.findMany({ where: { id: { in: materialIds } }, select: { id: true, code: true, name: true, unit: true } }) : [];
  const matById = new Map(materials.map((m) => [m.id, m]));
  const linesOf = (stepNo) => {
    const rows = evidence.filter((e) => e.stepNo === stepNo);
    const latestPerOp = new Map();
    for (const r of rows) latestPerOp.set(r.operationRunId || r.id, r);
    return [...latestPerOp.values()].flatMap((e) => (e.payload?.materials || []).map((m) => ({ ...m, code: matById.get(m.materialId)?.code ?? "—", name: matById.get(m.materialId)?.name ?? "—", uom: matById.get(m.materialId)?.unit ?? null })));
  };
  const actorIds = [...new Set(ctx.evidence.map((e) => e.actorId).filter(Boolean))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));
  const tableActor = latestOf(evidence, 5)?.actorId || latestOf(evidence, 1)?.actorId;
  const cornerActor = latestOf(evidence, 11)?.actorId || latestOf(evidence, 10)?.actorId;
  const mediaOf = (stepNos) => evidence.filter((e) => stepNos.includes(e.stepNo)).flatMap((e) => (Array.isArray(e.media) ? e.media : []).map((m) => ({ stepNo: e.stepNo, stepLabel: STEP_BY_NO[e.stepNo]?.label, kind: m.kind, url: signEvidenceUrl(m.url), source: sourceOfStep(e.stepNo) }))).filter((m) => m.url);
  const measurement = latestOf(evidence, 4)?.payload ?? null;
  const finalTests = evidence.filter((e) => e.stepNo === 8);
  const finalPass = [...finalTests].reverse().find((e) => e.payload?.verdict === "PAS");
  const fg = run.custodyHandoffs.filter((h) => h.direction === "FINISHED_GOODS").at(-1);
  const outboxRow = await prisma.domainOutbox.findFirst({
    where: { eventType: "production.report.ready", aggregateId: run.id }, orderBy: { id: "desc" },
    select: { status: true, deliveredAt: true, attempts: true, lastError: true, createdAt: true },
  });
  const documentation = await buildRunDocumentation(prisma, run, ctx);
  const docBuckets = documentationBuckets(documentation);
  const report = {
    runId: run.id, status: run.status, reportPath: `/bengkel/production-v2/laporan/${run.id}`,
    ready: !!latestOf(evidence, 12) || (!!run.adaptationPolicy && run.status === "COMPLETED"),
    adaptation: !!run.adaptationPolicy,
    skippedSteps: [...new Map(skippedEvidence.map((e) => [e.stepNo, e])).values()].sort((a, b) => a.stepNo - b.stepNo).map((e) => ({ stepNo: e.stepNo, label: STEP_BY_NO[e.stepNo]?.label ?? `Tahap ${e.stepNo}`, reason: e.payload?.reason ?? null, at: e.createdAt, by: actorName.get(e.actorId) ?? null })),
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
    qcStatus: ctx.latestInspection ? "DILAKUKAN" : (run.adaptationPolicy && run.operations.some((o) => o.status === "SKIPPED" && o.planSnapshot?.qcNotPerformed) ? "TIDAK_DILAKUKAN" : "BELUM"),
    finishing: latestOf(evidence, 10)?.payload ?? null,
    cornerChecklist: latestOf(evidence, 11)?.payload?.checklist ?? null,
    media: { before: [...mediaOf([1, 2, 3]), ...docBuckets.before], process: [...mediaOf([4, 6, 7]), ...docBuckets.process], after: [...mediaOf([8, 9, 11, 12]), ...docBuckets.after] },
    documentation,
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
