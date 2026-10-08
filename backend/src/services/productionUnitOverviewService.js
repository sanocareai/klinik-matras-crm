// P9C — Unit 360: satu bacaan kanonis per unit untuk kartu Status Produksi & Rencana Produksi (setara "detail Resi").
// BACA-SAJA, TIDAK ADA tabel/command baru — seluruhnya diturunkan dari sumber yang SUDAH ADA (P1-P9B.1):
// Unit/Order/Customer (Sales), UnitCustodyHandoff+Job (pickup), ProductionRun+ProductionRunPlan (planning),
// loadStepContext (tahap/evidence, sumber SAMA dengan getProductionReport), MaterialIssueLine/MaterialReservation
// (bahan), QualityInspection (QC), UnitStageLog+ProductionBlocker (aktivitas/pause), UnitPhoto resolver (foto).
//
// HARUS BEKERJA untuk unit TANPA Run sama sekali (mis. Kadarwati — OFFERED, 0 run): bagian production/materials/
// evidence/qc dikembalikan sebagai "belum dimulai", BUKAN error. Untuk multi-unit order: field bertingkat ORDER
// (nomor order, nama pelanggan, keluhan, request, berat badan) SAMA untuk semua unit sodara (skema saat ini
// menyimpannya di Order, bukan per-Unit) — ditandai eksplisit `scope: "ORDER"` di setiap field itu supaya
// pemanggil TIDAK menyangka itu unik per unit. Field yang genuinely per-unit (foto, plan, evidence, BOM, QC,
// custody) SELALU difilter lewat runId/unitId spesifik unit ini — tidak pernah "milik order", mencegah
// kebocoran antar-unit bersaudara (lihat resolveUnitPhoto yang sudah menolak atribusi job multi-unit).
import { COMPLAINT_LABEL, RUN_VIEW_INCLUDE, STYLE_LABEL, VERDICT_LABEL, customerOf, indicatorsOf, latestOf, materialStatusOf, minutesBetween, nameOf, stepStatuses, warningsOf, cornerAndLifecycleOf } from "./productionExperienceReadService.js";
import { loadCornerView, loadStepContext } from "./productionStepCommandService.js";
import { buildRunDocumentation, documentationBuckets } from "./productionDocumentationRead.js";
import { sourceOfStep } from "../lib/domain/productionDocumentation.js";
import { formatProductionDate, stationLabel } from "../lib/domain/productionBoard.js";
import { arrivalConfirmedByStaff, displayStatusOfOrder, displayStatusOfUnit, physicalPresenceOf, priorityDisplay } from "../lib/domain/productionDisplay.js";
import { loadOpenComplaintsByUnit } from "./productionComplaints.js";
import { STEP_BY_NO, isSkippedEvidence } from "../lib/domain/productionSteps.js";
import { signEvidenceUrl } from "../routes/productionEvidenceMedia.js";
import { signUnitPhotoUrlIfAny } from "../routes/productionUnitPhoto.js";
import { getDiagnosisState } from "./productionDiagnosisCommandService.js";

const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];

const QC_RESULT_LABEL = Object.freeze({ PENDING: "Menunggu", PASS: "Lulus", FAIL_REWORK: "Gagal — Rework", OVERRIDDEN: "Diloloskan Manual (Waived)" });
const CUSTODY_STATUS_LABEL = Object.freeze({ OFFERED: "Ditawarkan ke Gudang", ACCEPTED: "Diterima Gudang", REJECTED: "Ditolak Gudang", CANCELLED: "Dibatalkan", SUPERSEDED: "Digantikan" });

function unitOverviewError(message, status, code) {
  return Object.assign(new Error(message), { statusCode: status, code });
}

// Data dictionary §5 — field yang secara skema BERADA DI ORDER (bukan Unit), jadi SAMA untuk semua unit sodara
// dalam satu order (order multi-unit). Ditandai per-field, bukan diam-diam disamakan dengan data unit.
function orderScopedField(value) {
  return { value, scope: "ORDER" };
}
function unitScopedField(value) {
  return { value, scope: "UNIT" };
}

async function loadPickup(prisma, unitId) {
  const handoff = await prisma.unitCustodyHandoff.findFirst({
    where: { unitId, direction: "INBOUND" },
    orderBy: { offeredAt: "desc" },
    select: {
      id: true, status: true, offeredAt: true, acceptedAt: true, rejectedAt: true, reason: true,
      deliveryJob: {
        select: {
          id: true, scheduledDate: true, completedAt: true, arrivedAt: true, proofRecipientName: true,
          driver: { select: { name: true } }, helper: { select: { name: true } },
          route: { select: { code: true, date: true } },
          units: { select: { id: true }, take: 2 }, // hanya untuk deteksi single/multi-unit (lihat komentar file header)
        },
      },
    },
  });
  if (!handoff) {
    // Tanpa handoff: kedatangan bisa tetap dikonfirmasi PETUGAS (unit order nyata tanpa pickup tercatat). Dibaca dari catatan aktivitas asli (siapa, kapan, lokasi) — bukan bukti pickup/custody.
    const ev = await prisma.activityEvent.findFirst({ where: { entityType: "unit", entityId: unitId, eventType: "PRODUCTION_ARRIVAL_CONFIRMED_NO_CUSTODY" }, orderBy: { createdAt: "desc" }, select: { actorId: true, createdAt: true, metadata: true } });
    const who = ev?.actorId ? await prisma.user.findUnique({ where: { id: ev.actorId }, select: { name: true } }) : null;
    return {
      exists: false, custodyStatus: null, custodyStatusLabel: null,
      job: null, isSingleUnitJob: null, pickupCompletedAt: null, arrivedAtWorkshop: null,
      staffArrival: ev ? { confirmedAt: ev.createdAt, confirmedByName: who?.name ?? null, locationCode: ev.metadata?.locationCode ?? null } : null,
    };
  }
  const job = handoff.deliveryJob;
  return {
    exists: true,
    custodyStatus: handoff.status, custodyStatusLabel: CUSTODY_STATUS_LABEL[handoff.status] || handoff.status,
    offeredAt: handoff.offeredAt, acceptedAt: handoff.acceptedAt, rejectedAt: handoff.rejectedAt, rejectReason: handoff.reason,
    job: job ? {
      id: job.id, routeCode: job.route?.code ?? null, scheduledDate: job.route?.date ?? null,
      driverName: job.driver?.name ?? null, helperName: job.helper?.name ?? null,
      recipientName: job.proofRecipientName ?? null,
    } : null,
    // Job dengan >1 unit -> foto TIDAK boleh diatribusikan (sama aturan dengan resolveUnitPhoto P9B.1) — dipakai
    // frontend untuk menjelaskan MENGAPA foto pickup kosong padahal job-nya sendiri punya foto.
    isSingleUnitJob: job ? job.units.length === 1 : null,
    pickupCompletedAt: job?.completedAt ?? null,
    // "Tiba di workshop" = saat Gudang menerima custody (ACCEPTED) — tidak ada timestamp arrival fisik terpisah
    // di skema saat ini (gap, lihat data dictionary).
    arrivedAtWorkshop: handoff.acceptedAt,
  };
}

// Terpakai = jumlah yang DICATAT PIC di bukti tahap (6/7/10, payload.materials); Sisa = diserahkan − terpakai − waste − retur;
// Waste/Retur = pergerakan stok WASTE/RETURN yang ditautkan ke unit ini oleh Gudang. consumedQty (lama) = reservasi sudah
// dikonsumsi saat Gudang menyerahkan (BUKAN pemakaian aktual) — dipertahankan untuk kompatibilitas.
export function usedQtyByMaterial(evidence) {
  const m = new Map();
  for (const e of evidence || []) {
    if (![6, 7, 10].includes(e.stepNo)) continue;
    for (const l of e.payload?.materials || []) m.set(l.materialId, (m.get(l.materialId) || 0) + Number(l.qty || 0));
  }
  return m;
}

async function loadMaterials(prisma, plan, { evidence = [], unitId = null } = {}) {
  if (!plan) return { lines: [], shortageOpen: false, shortageItems: [] };
  const materialIds = [...new Set(plan.bomLines.map((l) => l.materialId))];
  const usedBy = usedQtyByMaterial(evidence);
  const adjustments = unitId && materialIds.length
    ? await prisma.stockMovement.findMany({ where: { unitId, materialId: { in: materialIds }, type: { in: ["WASTE", "RETURN"] } }, select: { materialId: true, type: true, qty: true } })
    : [];
  const [issueLines, reservations, returnRows] = await Promise.all([
    materialIds.length
      ? prisma.materialIssueLine.findMany({
          where: { materialId: { in: materialIds }, materialIssue: { productionPlanId: plan.id, status: { not: "CANCELLED" } } },
          select: { materialId: true, requestedQty: true, issuedQty: true, materialIssue: { select: { status: true } } },
        })
      : [],
    materialIds.length
      ? prisma.materialReservation.findMany({ where: { planId: plan.id, status: { not: "CANCELLED" } }, select: { materialId: true, qty: true, status: true, consumedAt: true } })
      : [],
    prisma.productionMaterialReturn.findMany({ where: { runId: plan.runId }, select: { materialId: true, status: true } }),
  ]);
  const lines = plan.bomLines.map((l) => {
    const issued = issueLines.filter((i) => i.materialId === l.materialId);
    const reserved = reservations.filter((r) => r.materialId === l.materialId);
    const issuedQty = issued.reduce((sum, i) => sum + (i.issuedQty != null ? Number(i.issuedQty) : 0), 0);
    const reservedQty = reserved.filter((r) => r.status === "ACTIVE").reduce((sum, r) => sum + Number(r.qty), 0);
    const consumedQty = reserved.filter((r) => r.consumedAt).reduce((sum, r) => sum + Number(r.qty), 0);
    const plannedQty = Number(l.qty);
    const usedQty = usedBy.get(l.materialId) || 0;
    const wasteQty = adjustments.filter((a) => a.materialId === l.materialId && a.type === "WASTE").reduce((sum, a) => sum + Math.abs(Number(a.qty)), 0);
    const returnedQty = adjustments.filter((a) => a.materialId === l.materialId && a.type === "RETURN").reduce((sum, a) => sum + Math.abs(Number(a.qty)), 0);
    const leftoverQty = Math.max(0, Math.round((issuedQty - usedQty - wasteQty - returnedQty) * 10000) / 10000);
    let status = "BELUM_DIRESERVASI";
    if (consumedQty > 0) status = "TERPAKAI";
    else if (issuedQty > 0) status = "SUDAH_DISERAHKAN";
    else if (reservedQty > 0) status = "DIRESERVASI";
    return {
      materialId: l.materialId, code: l.material.code, name: l.material.name, uom: l.material.unit,
      plannedQty, reservedQty, issuedQty, consumedQty, usedQty, wasteQty, returnedQty, leftoverQty, status,
      returnStatus: returnRows.find((r) => r.materialId === l.materialId)?.status ?? null, // antrean retur Gudang: PENDING = sisa belum diterima
      supplemental: !!l.supplementalInspectionId, // baris tambahan dari rework QC, bukan BOM awal
    };
  });
  const shortage = await prisma.productionMaterialShortage.findFirst({ where: { runId: plan.runId, status: "OPEN" }, select: { items: true, note: true, reportedAt: true } });
  return { lines, shortageOpen: !!shortage, shortageItems: shortage?.items ?? [], shortageNote: shortage?.note ?? null };
}

async function loadQc(prisma, runId) {
  // QualityInspection.inspectorId adalah scalar TANPA relasi Prisma bernama — resolve nama lewat lookup terpisah
  // (pola sama dengan actorName di getProductionReport), bukan include relasi yang tidak ada di skema.
  const inspections = await prisma.qualityInspection.findMany({
    where: { runId }, orderBy: { version: "asc" }, include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  const inspectorIds = [...new Set(inspections.map((q) => q.inspectorId).filter(Boolean))];
  const inspectors = inspectorIds.length ? await prisma.user.findMany({ where: { id: { in: inspectorIds } }, select: { id: true, name: true } }) : [];
  const inspectorName = new Map(inspectors.map((u) => [u.id, u.name]));
  return inspections.map((q) => ({
    version: q.version, result: q.result, resultLabel: QC_RESULT_LABEL[q.result] || q.result,
    inspectorName: inspectorName.get(q.inspectorId) ?? null, disposition: q.disposition, overrideReason: q.overrideReason,
    inspectedAt: q.inspectedAt,
    items: q.items.map((i) => ({ itemCode: i.itemCode, label: i.label, result: i.result, note: i.note, photoUrls: (i.photoUrls || []).map((u) => signEvidenceUrl(u)).filter(Boolean) })),
  }));
}

async function loadActivity(prisma, { unit, run, ctx, pickup }) {
  const events = [];
  if (pickup.exists) {
    events.push({ at: pickup.offeredAt, kind: "CUSTODY_OFFERED", label: "Unit ditawarkan ke Gudang (pickup selesai)" });
    if (pickup.acceptedAt) events.push({ at: pickup.acceptedAt, kind: "CUSTODY_ACCEPTED", label: "Diterima Gudang (tiba di workshop)" });
    if (pickup.rejectedAt) events.push({ at: pickup.rejectedAt, kind: "CUSTODY_REJECTED", label: `Ditolak Gudang${pickup.rejectReason ? `: ${pickup.rejectReason}` : ""}` });
  }
  if (run) {
    const stageLogs = await prisma.unitStageLog.findMany({
      where: { unitId: unit.id }, orderBy: { createdAt: "asc" },
      select: { createdAt: true, action: true, note: true, pauseReason: true, blockReason: true, actor: { select: { name: true } }, stage: { select: { labelId: true } } },
    });
    for (const log of stageLogs) {
      events.push({ at: log.createdAt, kind: `STAGE_${log.action}`, label: `${log.stage?.labelId ?? "Tahap"} — ${log.action}${log.note ? `: ${log.note}` : ""}`, actor: log.actor?.name ?? null });
    }
    for (const e of ctx.evidence) {
      events.push({ at: e.createdAt, kind: "EVIDENCE", label: `Bukti tahap ${e.stepNo} (${STEP_BY_NO[e.stepNo]?.label ?? e.stepNo}) tercatat`, actor: null });
    }
  }
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return events;
}

// Overview minimal untuk unit TANPA Run sama sekali (mis. Kadarwati: OFFERED, 0 run) — TIDAK memanggil
// loadStepContext (butuh run). Semua bagian produksi ditandai "belum dimulai", bukan error/ditebak.
async function buildNoRunOverview(prisma, unit, { canSeeValue }) {
  const pickup = await loadPickup(prisma, unit.id);
  const photoUrl = await signUnitPhotoUrlIfAny(prisma, unit.id);
  const order = unit.order;
  const warnings = [];
  const complaintsByUnit = await loadOpenComplaintsByUnit(prisma, [{ id: unit.id, orderId: unit.orderId }]);
  const prioNoRun = priorityDisplay({ stored: unit.priority ?? "NORMAL", complaintCases: complaintsByUnit.get(unit.id) || [] });
  if (!pickup.exists) warnings.push({ code: "CUSTODY_TIDAK_DITEMUKAN", text: "Tidak ada catatan custody masuk untuk unit ini" });
  warnings.push({ code: "BELUM_ADA_RUN", text: "Unit belum masuk proses produksi (belum ada Production Run)" });

  return {
    identity: {
      unitId: unit.id, unitCode: unit.unitCode, orderId: unit.orderId, orderNumber: order?.orderNumber ?? null,
      merk: unit.merk, ukuran: unit.ukuran, status: unit.status, photoUrl,
      orderStatus: displayStatusOfOrder(order?.status) || null, unitStatus: displayStatusOfUnit(unit.status) || null,
      presence: physicalPresenceOf({ unitStatus: unit.status, runStatus: null, runOrigin: null, inboundAccepted: pickup?.status === "ACCEPTED" }),
      priority: { key: prioNoRun.key, label: prioNoRun.label, rank: prioNoRun.rank, complaintCases: prioNoRun.complaintCases },
      target: { productionDate: null, priority: null, priorityLabel: prioNoRun.label, targetCompleteAt: null, late: false },
      pic: { table: null, corner: null }, station: { code: null, label: "Belum dijadwalkan" },
      bucket: "ANTREAN", bucketLabel: "Belum masuk produksi",
    },
    customer: {
      name: orderScopedField(order?.customer?.name ?? null), city: orderScopedField(order?.customer?.city ?? null),
      salesName: orderScopedField(order?.customer?.assignedSales?.name ?? null),
    },
    salesContext: {
      complaints: orderScopedField((order?.complaintCategory || []).map((c) => COMPLAINT_LABEL[c] || c)),
      request: orderScopedField(order?.notes ?? null),
      weightKg: orderScopedField(order?.beratBadan ?? null),
      weightEntries: orderScopedField(order?.weightEntries ?? []),
      salesServices: orderScopedField((order?.items || []).map((i) => i.layananName).filter(Boolean)),
      promiseDate: orderScopedField(order?.customerPromiseDate ?? null),
      category: orderScopedField(order?.category ?? null),
      dataGaps: !order?.beratBadan ? ["Berat badan customer belum dicatat Sales"] : [],
    },
    service: { code: unit.service?.code ?? null, label: unit.service?.labelId ?? null, set: !!unit.serviceId },
    pickup,
    planning: null,
    production: { runId: null, runStatus: null, currentPhase: null, started: false, steps: [], progress: { done: 0, skipped: 0, remaining: 12, total: 12 }, adaptation: null, qcStatus: "BELUM", timer: null, activeOp: null },
    materials: { lines: [], shortageOpen: false, shortageItems: [] },
    evidence: { before: [], process: [], after: [] },
    qc: [],
    diagnosis: null, // P9D — belum ada run sama sekali, jadi belum mungkin ada diagnosis (keyed by runId)
    deliveryReadiness: { unitStatus: unit.status, finishedGoodsHandoff: null, readyForDelivery: false },
    activity: await loadActivity(prisma, { unit, run: null, ctx: null, pickup }),
    warnings,
    permissions: { canSeeValue },
    ...(canSeeValue ? { orderValue: order?.value ?? null } : {}),
  };
}

// Bentuk LENGKAP unit+order (weightEntries, customer, notes, dll) — HANYA dipakai di jalur TANPA run
// (buildNoRunOverview), sebab di jalur ITU tidak ada RUN_VIEW_INCLUDE yang sudah membawa data yang sama.
// JANGAN dipakai lagi di jalur run-exists — akan dobel-fetch unit/order/customer/weightEntries yang
// sama persis dengan yang sudah datang lewat run.unit.order (RUN_VIEW_INCLUDE), diukur nyata: 4 query
// SQL duplikat per request (diagnostik P9C audit N+1/query-count, 30 Sep 2026).
const UNIT_FULL_SELECT = {
  id: true, unitCode: true, orderId: true, serviceId: true, status: true, priority: true, merk: true, ukuran: true,
  service: { select: { code: true, labelId: true } },
  order: {
    select: {
      orderNumber: true, status: true, category: true, productLine: true, productType: true, beratBadan: true, notes: true,
      complaintCategory: true, customerPromiseDate: true, value: true,
      weightEntries: { select: { label: true, beratKg: true }, orderBy: { sortOrder: "asc" } },
      items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } },
      customer: { select: { name: true, city: true, assignedSales: { select: { name: true } } } },
    },
  },
};

export async function getUnitOverview(prisma, unitId, { unitIds, canSeeValue = false, now = new Date() } = {}) {
  // PENTING: cek cohort di JS, BUKAN menaruh dua kunci "id" di satu object literal Prisma where (mis.
  // { id: unitId, ...(unitIds ? { id: { in: unitIds } } : {}) }) — kunci kedua diam-diam MENIMPA yang pertama
  // (semantik object literal JS biasa), membuat query mengabaikan unitId yang diminta sama sekali dan malah
  // mengembalikan unit LAIN yang kebetulan ada di cohort. Ditemukan lewat test integrasi non-cohort P9C.
  if (unitIds && !unitIds.includes(unitId)) return null;

  const run = await prisma.productionRun.findFirst({ where: { unitId }, include: RUN_VIEW_INCLUDE, orderBy: { createdAt: "desc" } });

  if (!run) {
    // Tanpa run, RUN_VIEW_INCLUDE tidak pernah jalan — query "lengkap" di bawah ini SATU-SATUNYA sumber
    // unit/order untuk jalur ini, jadi tidak ada duplikasi.
    const unit = await prisma.unit.findFirst({ where: { id: unitId }, select: UNIT_FULL_SELECT });
    if (!unit) return null;
    return buildNoRunOverview(prisma, unit, { canSeeValue });
  }
  if (!run.unit) return null; // unit terhapus/tidak konsisten — seharusnya tidak terjadi (FK), jaga-jaga saja

  // run.unit.order SUDAH punya orderNumber/category/beratBadan/notes/complaintCategory/customerPromiseDate/
  // weightEntries/customer lewat RUN_VIEW_INCLUDE (lihat customerOf() di productionExperienceReadService.js).
  // Hanya productLine/productType/value yang TIDAK diseleksi RUN_VIEW_INCLUDE (dipakai banyak read-path lain,
  // menambah field di sana akan membesarkan payload SEMUA pemanggil) — ambil 3 field itu saja secara terpisah,
  // BUKAN unit lengkap lagi.
  const orderExtra = run.unit.orderId
    ? await prisma.order.findUnique({ where: { id: run.unit.orderId }, select: { productLine: true, productType: true, value: true } })
    : null;

  const ctx = await loadStepContext(prisma, run);
  const materialStatus = materialStatusOf(run.plan, ctx.material, ctx.openShortage);
  const steps = stepStatuses(ctx);
  const applicableSteps = steps.filter((s) => s.status !== "NA");
  const [pickup, materials, qc, diagnosis] = await Promise.all([
    loadPickup(prisma, unitId),
    loadMaterials(prisma, run.plan, { evidence: [...ctx.evidence, ...(ctx.buildRecord ? [{ stepNo: 6, payload: { materials: ctx.buildRecord.materials } }] : [])], unitId }),
    loadQc(prisma, run.id),
    getDiagnosisState(prisma, run.id),
  ]);
  const photoUrl = await signUnitPhotoUrlIfAny(prisma, unitId);
  const customer = customerOf(run);
  const warnings = warningsOf(run, ctx, materialStatus);
  const indicators = indicatorsOf(run, ctx, materialStatus);
  const complaintsByUnit = await loadOpenComplaintsByUnit(prisma, [{ id: unitId, orderId: run.unit.orderId }]);
  const prio = priorityDisplay({ stored: run.plan?.priority ?? 0, complaintCases: complaintsByUnit.get(unitId) || [] });
  const inboundAccepted = run.custodyHandoffs.some((h) => h.direction === "INBOUND" && h.status === "ACCEPTED") || arrivalConfirmedByStaff(run.phases);

  const mediaOf = (stepNos) => ctx.evidence.filter((e) => stepNos.includes(e.stepNo))
    .flatMap((e) => (Array.isArray(e.media) ? e.media : []).map((m) => ({ stepNo: e.stepNo, stepLabel: STEP_BY_NO[e.stepNo]?.label, kind: m.kind, url: signEvidenceUrl(m.url), source: sourceOfStep(e.stepNo) })))
    .filter((m) => m.url);

  // P10B — matriks dokumentasi kanonis; foto dokumentasi langsung masuk bucket before/process/after yang sudah dipakai layar.
  const documentation = await buildRunDocumentation(prisma, run, ctx);
  const docBuckets = documentationBuckets(documentation);
  const fgHandoff = run.custodyHandoffs.filter((h) => h.direction === "FINISHED_GOODS").at(-1) ?? null;
  const firstStart = run.operations[0]?.startedAt ?? null;
  const op = ctx.state.activeOp;
  const bucket = run.status === "COMPLETED" ? "SELESAI" : (ctx.next?.wait === "PENDING_ARRIVAL" ? "DALAM_PERJALANAN" : (op ? (op.status === "PAUSED" ? "DIJEDA" : "BERJALAN") : "ANTREAN"));

  const dataGaps = [];
  if (!run.unit.order?.beratBadan) dataGaps.push("Berat badan customer belum dicatat Sales");
  if (!run.plan?.operatorId) dataGaps.push("PIC meja belum ditetapkan");

  return {
    identity: {
      unitId: run.unit.id, unitCode: run.unit.unitCode, orderId: run.unit.orderId, orderNumber: customer.orderNumber,
      merk: run.unit.merk, ukuran: run.unit.ukuran, status: run.unit.status, photoUrl,
      orderStatus: displayStatusOfOrder(run.unit.order?.status) || null, unitStatus: displayStatusOfUnit(run.unit.status) || null,
      presence: physicalPresenceOf({ unitStatus: run.unit.status, runStatus: run.status, runOrigin: run.origin, inboundAccepted }),
      priority: { key: prio.key, label: prio.label, rank: prio.rank, complaintCases: prio.complaintCases },
      target: {
        productionDate: run.plan?.productionDate ? formatProductionDate(run.plan.productionDate) : null,
        priority: run.plan?.priority ?? null, priorityLabel: prio.label,
        targetCompleteAt: run.plan?.targetCompleteAt ?? null,
        late: !!(run.plan?.targetCompleteAt && !TERMINAL_RUN.includes(run.status) && run.currentPhase !== "HANDOFF" && new Date(run.plan.targetCompleteAt).getTime() < now.getTime()),
      },
      pic: { table: nameOf(run.plan?.operator), corner: nameOf(run.plan?.cornerOperator) },
      station: { code: run.plan?.stationCode ?? null, label: run.plan?.stationCode ? stationLabel(run.plan.stationCode) : "Belum dijadwalkan" },
      bucket, bucketLabel: { DALAM_PERJALANAN: "Dalam perjalanan ke workshop", SELESAI: "Selesai", DIJEDA: "Dijeda", BERJALAN: "Sedang dikerjakan", ANTREAN: "Antrean" }[bucket] ?? bucket,
    },
    customer: {
      name: orderScopedField(customer.name), city: orderScopedField(customer.city), salesName: orderScopedField(customer.salesName),
    },
    salesContext: {
      complaints: orderScopedField(customer.complaints), request: orderScopedField(customer.request),
      weightKg: orderScopedField(customer.weightKg), weightEntries: orderScopedField(customer.weightEntries),
      salesServices: orderScopedField(customer.salesServices),
      promiseDate: orderScopedField(customer.promiseDate), category: orderScopedField(customer.category),
      productLine: orderScopedField(orderExtra?.productLine ?? null), productType: orderScopedField(orderExtra?.productType ?? null),
      dataGaps,
    },
    // Jalur pengerjaan (BARU/custom): layanan teknis & Diagnosis TIDAK BERLAKU — spesifikasi + layanan Sales (salesContext) adalah acuan.
    service: { code: run.unit.service?.code ?? null, label: run.unit.service?.labelId ?? null, set: !!run.unit.serviceId, applicable: !ctx.state.buildTrack },
    pickup,
    planning: run.plan ? {
      planId: run.plan.id, status: run.plan.status, revision: run.plan.revision,
      productionDate: formatProductionDate(run.plan.productionDate), stationCode: run.plan.stationCode, stationLabel: stationLabel(run.plan.stationCode),
      priority: run.plan.priority, priorityLabel: prio.label,
      workCenter: run.plan.workCenter, operator: run.plan.operator ? { id: run.plan.operator.id, name: nameOf(run.plan.operator) } : null,
      cornerWorkCenter: run.plan.cornerWorkCenter, cornerOperator: run.plan.cornerOperator ? { id: run.plan.cornerOperator.id, name: nameOf(run.plan.cornerOperator) } : null,
      materialReservedAt: run.plan.materialReservedAt, targetStartAt: run.plan.targetStartAt, targetCompleteAt: run.plan.targetCompleteAt,
    } : null,
    production: {
      ...cornerAndLifecycleOf(run, ctx), cornerView: await loadCornerView(prisma, run, ctx), // Fase 5: status yang sama dengan Meja/Corner/Status Produksi/laporan
      runId: run.id, revision: run.revision, track: ctx.state.buildTrack ? "BUILD" : "RESTORATION", product: ctx.state.buildTrack ? { class: ctx.state.productClass, flow: ctx.state.productFlow, problem: ctx.state.productProblem } : null,
      racikan: ctx.state.buildTrack ? (ctx.evidence.filter((e) => e.stepNo === 6 && !isSkippedEvidence(e)).at(-1)?.payload?.racikan ?? ctx.buildRecord?.racikan ?? null) : null, build: ctx.buildView ?? null, runStatus: run.status, currentPhase: run.currentPhase, started: run.operations.length > 0 || ctx.evidence.length > 0,
      // dikerjakan (done) / dilewati (skipped) / tersisa (remaining) — tahap dilewati (mode adaptasi) bukan pekerjaan.
      steps, progress: (() => {
        const worked = applicableSteps.filter((s) => s.status === "DONE").length; const skipped = applicableSteps.filter((s) => s.status === "SKIPPED").length;
        return { done: worked, skipped, remaining: applicableSteps.length - worked - skipped, total: applicableSteps.length };
      })(),
      adaptation: run.adaptationPolicy ? { policy: run.adaptationPolicy } : null,
      qcStatus: ctx.latestInspection ? "DILAKUKAN" : (run.adaptationPolicy && run.operations.some((o) => o.status === "SKIPPED" && o.planSnapshot?.qcNotPerformed) ? "TIDAK_DILAKUKAN" : "BELUM"),
      timer: {
        startedAt: firstStart, stepStartedAt: op?.startedAt ?? null,
        elapsedMinutes: firstStart ? minutesBetween(firstStart, TERMINAL_RUN.includes(run.status) ? run.completedAt || now : now) : 0,
        stepElapsedMinutes: op?.startedAt ? minutesBetween(op.startedAt, now) : 0,
      },
      activeOp: op ? { stageLabel: op.stageLabel, status: op.status, startedAt: op.startedAt, delayKind: op.delayKind ?? null, delayNote: op.delayNote ?? null } : null,
      indicators,
    },
    materials,
    evidence: { before: [...mediaOf([1, 2, 3]), ...docBuckets.before], process: [...mediaOf([4, 6, 7]), ...docBuckets.process], after: [...mediaOf([8, 9, 11, 12]), ...docBuckets.after] },
    documentation,
    qc,
    diagnosis: {
      ...diagnosis,
      current: diagnosis.current ? {
        ...diagnosis.current,
        photoUrls: (diagnosis.current.photoUrls || []).map((u) => signEvidenceUrl(u)).filter(Boolean),
      } : null,
    },
    deliveryReadiness: {
      unitStatus: run.unit.status,
      finishedGoodsHandoff: fgHandoff ? { status: fgHandoff.status, offeredAt: fgHandoff.offeredAt, acceptedAt: fgHandoff.acceptedAt } : null,
      readyForDelivery: run.unit.status === "READY_FOR_DELIVERY" || run.unit.status === "DELIVERED",
    },
    activity: await loadActivity(prisma, { unit: run.unit, run, ctx, pickup }),
    warnings,
    permissions: { canSeeValue },
    ...(canSeeValue ? { orderValue: orderExtra?.value ?? null } : {}),
  };
}
