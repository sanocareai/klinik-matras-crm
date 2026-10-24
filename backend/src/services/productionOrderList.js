// Daftar ORDER PRODUKSI (GET /api/production/work-orders dan ekspor Excel) — SATU sumber untuk filter + pengayaan baris, supaya ekspor persis sama dengan daftar yang difilter.
// Dipindahkan dari routes/production.js (isi tidak berubah) dan DITAMBAH kontrak tiga sumbu status (lib/domain/productionWorkStatus.js): status order · posisi unit · status kerja,
// target selesai, PIC, tindakan berikutnya. Semua tambahan ADITIF (field baru di bawah `adopsi`); field lama tetap.
import { ringkasCatatanUnits } from "./catatanPemakaianHistoris.js";
import { loadLastCurrentStageLogs, loadOpenBlockersByUnit } from "./unitStageEngine.js";
import { deriveProductionStatus, describeProductionStatus } from "../lib/domain/productionState.js";
import { deriveStageLogStatus, OPEN_WORK_ACTIONS as EXECUTION_OPEN_WORK_ACTIONS } from "../lib/domain/stageExecution.js";
import { loadCurrentStageAssignments } from "./productionRouting.js";
import { PRODUCTION_READER_MODE, loadV2Flags, resolveProductionReaderState } from "./v2FeatureFlags.js";
import { DISPLAY_STATUS_UNIT_FILTER, displayStatusCountsOf, displayStatusOfOrder, displayStatusOfUnit, physicalPresenceOf, priorityDisplay } from "../lib/domain/productionDisplay.js";
import { GLOBAL_STATUS, GLOBAL_STATUS_FLOW, milestoneOf } from "../lib/domain/workshopMilestone.js";
import { countByGlobalStatus, loadMilestoneEvidence, unitWhereForGlobalStatuses } from "./workshopMilestoneEvidence.js";
import { loadOpenComplaintsByUnit } from "./productionComplaints.js";
import { PKR_ORDER_SELECT, PKR_UNIT_ITEM_SELECT, rujukanPkrDariOrder } from "./pkrProduksiGuard.js";
import { WORK_STATUS, effectiveWorkStatus, posisiUnitOf, tindakanBerikutnya } from "../lib/domain/productionWorkStatus.js";
import { loadAppEvidence, loadLatestManual } from "./productionAdoptionService.js";

export const UNIT_STATUS_VALUES = Object.freeze(["AWAITING_PICKUP", "IN_TRANSIT_IN", "RECEIVED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED", "CANCELLED"]); // = enum UnitStatus
export const BATAS_EKSPOR = 5000;

const csv = (v) => String(v || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);

/** Bangun filter `where` Prisma dari query string (status, displayStatus, globalStatus, statusIn, real, serviceLine, q). */
export function buildWorkOrderWhere(query = {}) {
  const { status, serviceLine, q } = query;
  const displayFilter = csv(query.displayStatus).filter((k) => k in DISPLAY_STATUS_UNIT_FILTER);
  const displayUnitStatuses = displayFilter.length ? [...new Set(displayFilter.flatMap((k) => DISPLAY_STATUS_UNIT_FILTER[k]))] : null;
  const globalKeys = csv(query.globalStatus).filter((k) => k in GLOBAL_STATUS);
  const globalWhere = globalKeys.length && !status ? unitWhereForGlobalStatuses(globalKeys) : null;
  const statusIn = csv(query.statusIn).filter((k) => UNIT_STATUS_VALUES.includes(k));
  return {
    ...(status && { status }),
    ...(displayUnitStatuses && !status ? { status: { in: displayUnitStatuses } } : {}),
    ...(statusIn.length && !status && !displayUnitStatuses ? { status: { in: statusIn } } : {}),
    ...(globalWhere ? { AND: [globalWhere] } : {}),
    ...(query.real === "1" ? { order: { status: { not: "CANCELLED" }, customer: { pipelineStage: { not: "SPAM" }, isInternalStaff: false } } } : {}),
    ...(serviceLine && { serviceLine }),
    ...(q?.trim() && {
      OR: [
        { unitCode: { contains: q.trim(), mode: "insensitive" } },
        { order: { orderNumber: { contains: q.trim(), mode: "insensitive" } } },
        { order: { customer: { name: { contains: q.trim(), mode: "insensitive" } } } },
      ],
    }),
  };
}

export const UNIT_INCLUDE = {
  currentStage: { select: { id: true, code: true, labelId: true, phase: true, requiresQc: true, defaultWorkCenter: { select: { id: true, code: true, name: true } } } },
  service: { select: { id: true, code: true, labelId: true, serviceLine: true } },
  order: {
    select: {
      id: true, orderNumber: true, status: true, ...PKR_ORDER_SELECT,
      items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, // Layanan Sales (satu-satunya layanan yang ditampilkan)
      customer: { select: { id: true, name: true } },
    },
  },
  ...PKR_UNIT_ITEM_SELECT,
};

/** Pengayaan baris: status turunan, milestone, posisi, status kerja efektif, target, PIC, tindakan berikutnya. */
export async function perkayaBarisUnit(prisma, units) {
  const unitIds = units.map((u) => u.id);
  const [lastLogByUnitId, blockerByUnitId, assignmentByUnitId] = await Promise.all([loadLastCurrentStageLogs(units), loadOpenBlockersByUnit(unitIds), loadCurrentStageAssignments(units)]);
  const readerState = resolveProductionReaderState(await loadV2Flags(prisma));
  const v2Units = readerState.mode === PRODUCTION_READER_MODE.OFF ? new Set() : new Set(readerState.unitIds);
  const complaintsByUnit = await loadOpenComplaintsByUnit(prisma, units.map((u) => ({ id: u.id, orderId: u.orderId })));
  const catatanHistorisByUnit = await ringkasCatatanUnits(prisma, unitIds); // catatan pemakaian historis (Excel): terpisah dari pemakaian aktual & status kerja
  const [milestoneEvidence, plannedRows, appEvidence, manualByUnit, rencanaRows, aktualRows, adminJadwalRows, komponenPakaiRows, sementaraRows] = await Promise.all([
    loadMilestoneEvidence(prisma, unitIds),
    unitIds.length ? prisma.productionRun.findMany({
      where: { unitId: { in: unitIds }, status: { notIn: ["COMPLETED", "CANCELLED"] }, plan: { is: { stationCode: { not: null }, status: { not: "CANCELLED" } } } },
      select: { unitId: true, plan: { select: { stationCode: true, productionDate: true, targetCompleteAt: true, operator: { select: { user: { select: { name: true } } } } } } },
    }) : [],
    loadAppEvidence(prisma, unitIds),
    loadLatestManual(prisma, unitIds),
    unitIds.length ? prisma.productionUnitMaterialPlan.findMany({ where: { unitId: { in: unitIds } }, select: { unitId: true, revision: true } }) : [],
    unitIds.length ? prisma.stockMovement.groupBy({ by: ["unitId"], where: { unitId: { in: unitIds }, type: "ISSUE" }, _count: { _all: true }, _min: { createdAt: true }, _max: { createdAt: true } }) : [],
    // Rencana Admin: jadwal tanggal+meja per unit TANPA Run (satu sumber; jadwal V2 dibaca dari rencana Run di atas)
    unitIds.length ? prisma.productionUnitSchedule.findMany({ where: { unitId: { in: unitIds }, status: "ACTIVE" }, select: { unitId: true, productionDate: true, stationCode: true, revision: true } }) : [],
    // Komponen lama yang pernah dicatat 'dipakai kembali' (CREATED/CORRECTED hasil REUSED; baris riwayat tidak dihapus, jadi fakta tidak hilang walau dikoreksi/dibatalkan)
    unitIds.length ? prisma.unitComponentReuseEntry.findMany({ where: { unitId: { in: unitIds }, outcome: "REUSED", kind: { in: ["CREATED", "CORRECTED"] } }, select: { unitId: true, itemId: true, createdAt: true } }) : [],
    // Pemakaian SEMENTARA (bahan belum di katalog; BUKAN Material Issue): fakta pekerjaan, dengan sumber sendiri. Yang dibatalkan (salah input) tidak dihitung.
    unitIds.length ? prisma.unitProvisionalUsage.findMany({ where: { unitId: { in: unitIds }, status: { in: ["PERLU_REKONSILIASI", "DIREKONSILIASI"] } }, select: { unitId: true, status: true, usedAt: true, recordedAt: true } }) : [],
  ]);
  const adminJadwalByUnit = new Map(adminJadwalRows.map((r) => [r.unitId, r]));
  const planByUnit = new Map(plannedRows.map((r) => [r.unitId, r.plan]));
  const rencanaUnit = new Set(rencanaRows.map((r) => r.unitId));
  const aktualUnit = new Set(aktualRows.map((r) => r.unitId));
  // PEMAKAIAN AKTUAL yang berhasil tercatat (dua sumber TERPISAH): bahan baru = pergerakan ISSUE resmi; komponen lama = hasil 'dipakai kembali'. Dasar status kerja "Sudah dikerjakan".
  const pemakaianByUnit = new Map();
  const ambilP = (id) => { if (!pemakaianByUnit.has(id)) pemakaianByUnit.set(id, { baru: 0, lama: new Set(), sementaraPerlu: 0, sementaraSelesai: 0, pertamaAt: null, terakhirAt: null }); return pemakaianByUnit.get(id); };
  const geser = (p, a, b) => { if (a && (!p.pertamaAt || a < p.pertamaAt)) p.pertamaAt = a; if (b && (!p.terakhirAt || b > p.terakhirAt)) p.terakhirAt = b; };
  for (const r of aktualRows) { const p = ambilP(r.unitId); p.baru = r._count._all; geser(p, r._min.createdAt, r._max.createdAt); }
  for (const r of komponenPakaiRows) { const p = ambilP(r.unitId); p.lama.add(r.itemId); geser(p, r.createdAt, r.createdAt); }
  for (const r of sementaraRows) { const p = ambilP(r.unitId); if (r.status === "PERLU_REKONSILIASI") p.sementaraPerlu++; else p.sementaraSelesai++; geser(p, r.usedAt, r.recordedAt); }
  return units.map((u) => {
    const prio = priorityDisplay({ stored: u.priority, complaintCases: complaintsByUnit.get(u.id) || [] });
    const ev = milestoneEvidence.get(u.id) || { receivedBasis: null, started: false, pickupCompleted: false };
    // DIJADWALKAN = ada jadwal AKTIF dari salah satu sumber: rencana Meja (Pelaksanaan Meja, punya meja+tanggal) ATAU Rencana Admin ACTIVE (tanpa Run). CLEARED tidak dihitung; ADOPTED dihitung lewat rencana Mejanya (planByUnit).
    // SATU aturan ini dipakai status kerja, status jadwal (milestone), tindakan berikutnya, daftar/filter, panel unit, dan ekspor Order Produksi (ekspor Rencana sudah berlabel "Rencana Admin") — jadwal saja TIDAK pernah menjadi 'Sudah dikerjakan'.
    const scheduled = planByUnit.has(u.id) || adminJadwalByUnit.has(u.id);
    const milestone = milestoneOf({ unitStatus: u.status, ...ev, scheduled });
    const lastLog = lastLogByUnitId[u.id] || null; const blocker = blockerByUnitId[u.id] || null; const assignment = assignmentByUnitId[u.id] || null;
    const productionStatus = deriveProductionStatus({ unit: u, lastLog, hasOpenBlocker: !!blocker, currentStageRequiresQc: !!u.currentStage?.requiresQc });
    // ── tiga sumbu status (kontrak adopsi Admin)
    const bukti = appEvidence.get(u.id) || { started: false, firstEvidenceAt: null };
    const manual = manualByUnit.get(u.id) || null;
    const pakai = pemakaianByUnit.get(u.id) || null;
    const kerja = effectiveWorkStatus({ unitStatus: u.status, productionStatus, appStarted: bukti.started, scheduled, manual, pemakaian: pakai ? { terakhirAt: pakai.terakhirAt, pertamaAt: pakai.pertamaAt, hanyaSementara: pakai.sementaraPerlu > 0 && pakai.baru === 0 && pakai.lama.size === 0 && pakai.sementaraSelesai === 0 } : null, punyaJadwal: scheduled || adminJadwalByUnit.has(u.id) });
    const posisi = posisiUnitOf({ unitStatus: u.status, receivedBasis: ev.receivedBasis, receivedBasisLabel: milestone.receivedBasisLabel, pickupCompleted: ev.pickupCompleted, pickupInProgress: ev.pickupInProgress, started: bukti.started || ev.started });
    const plan = planByUnit.get(u.id) || null;
    const targetAt = u.productionDueAt ?? plan?.targetCompleteAt ?? null;
    const picNama = assignment?.operator?.user?.name ?? plan?.operator?.user?.name ?? null;
    const tindakan = tindakanBerikutnya({ unitStatus: u.status, posisi, kerja, adaTarget: !!targetAt, rencanaBahanAda: rencanaUnit.has(u.id), aktualAda: aktualUnit.has(u.id) || (pakai?.sementaraPerlu ?? 0) + (pakai?.sementaraSelesai ?? 0) > 0 });
    return {
      ...u, inProductionV2: v2Units.has(u.id), productionStatus,
      penjualanKaryawan: rujukanPkrDariOrder(u.order, { unit: u }),
      orderStatusDisplay: displayStatusOfOrder(u.order?.status), unitStatusDisplay: displayStatusOfUnit(u.status),
      presence: physicalPresenceOf({ unitStatus: u.status, runStatus: null, runOrigin: null, inboundAccepted: ev.receivedBasis === "CUSTODY", staffConfirmed: ev.receivedBasis === "STAFF_CONFIRMED", workshopReceipt: ev.receivedBasis === "WORKSHOP_RECEIPT" }),
      globalStatus: milestone.globalStatus, receivedBasis: milestone.receivedBasis, receivedBasisLabel: milestone.receivedBasisLabel, scheduleStatus: milestone.scheduleStatus,
      priorityDisplay: { key: prio.key, label: prio.label, rank: prio.rank, complaintCases: prio.complaintCases },
      productionStatusReason: describeProductionStatus(productionStatus, lastLog, blocker),
      workCenter: assignment?.workCenter || u.currentStage?.defaultWorkCenter || null,
      assignedOperator: assignment?.operator ? { id: assignment.operator.id, name: assignment.operator.user.name } : null,
      executionState: lastLog ? deriveStageLogStatus(lastLog.action) : "NOT_STARTED",
      currentSegmentStartedAt: EXECUTION_OPEN_WORK_ACTIONS.has(lastLog?.action) ? lastLog.createdAt : null,
      adopsi: {
        statusOrder: u.unitStatusDisplay ?? displayStatusOfUnit(u.status), statusOrderOrder: displayStatusOfOrder(u.order?.status),
        posisi, kerja, tindakan,
        targetSelesai: targetAt ? { at: targetAt, sumber: u.productionDueAt ? "UNIT" : "RENCANA" } : null,
        pic: picNama ? { nama: picNama, sumber: assignment?.operator ? "TAHAP" : "RENCANA" } : null, meja: plan?.stationCode ?? adminJadwalByUnit.get(u.id)?.stationCode ?? null,
        jadwal: plan?.productionDate ? { sumber: "V2", tanggal: plan.productionDate.toISOString().slice(0, 10), meja: plan.stationCode ?? null, revisi: null } : adminJadwalByUnit.has(u.id) ? { sumber: "ADMIN", tanggal: adminJadwalByUnit.get(u.id).productionDate.toISOString().slice(0, 10), meja: adminJadwalByUnit.get(u.id).stationCode ?? null, revisi: adminJadwalByUnit.get(u.id).revision } : null,
        rencanaBahanAda: rencanaUnit.has(u.id), aktualBahanAda: aktualUnit.has(u.id), buktiAplikasi: bukti.started,
        catatanHistoris: catatanHistorisByUnit.get(u.id) ?? { total: 0, perluDicek: 0, siapPosting: 0, tercatatDiStok: 0, diposting: 0 },
        pemakaianBahan: { baruCatatan: pakai?.baru ?? 0, komponenLamaDipakaiKembali: pakai?.lama.size ?? 0, sementaraPerluRekonsiliasi: pakai?.sementaraPerlu ?? 0, sementaraSudahDirekonsiliasi: pakai?.sementaraSelesai ?? 0, pertamaAt: pakai?.pertamaAt ?? null, terakhirAt: pakai?.terakhirAt ?? null }, // dua sumber terpisah (tidak dijumlahkan)
      },
    };
  });
}

/**
 * Daftar Order Produksi. Mode halaman: filter + skip/take di server. Mode `semua` (ekspor) atau filter `statusKerja`: seluruh unit yang cocok dimuat (maks BATAS_EKSPOR),
 * status kerja dihitung, difilter, lalu dipaginasi di memori — angka total tetap jujur.
 */
export async function listWorkOrders(prisma, query = {}, { semua = false } = {}) {
  const pageSize = Math.min(Math.max(parseInt(query.pageSize, 10) || 100, 1), 200);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const where = buildWorkOrderWhere(query);
  const kerjaFilter = csv(query.statusKerja).filter((k) => k in WORK_STATUS);
  const penuh = semua || kerjaFilter.length > 0;
  const orderBy = [{ createdAt: "desc" }, { id: "asc" }];
  let units; let total;
  if (penuh) {
    units = await prisma.unit.findMany({ where, include: UNIT_INCLUDE, orderBy, take: BATAS_EKSPOR + 1 });
    if (units.length > BATAS_EKSPOR) { const e = new Error(`Terlalu banyak unit (${BATAS_EKSPOR}+). Persempit filter atau pencarian.`); e.statusCode = 413; e.code = "TERLALU_BANYAK"; throw e; }
  } else {
    units = await prisma.unit.findMany({ where, include: UNIT_INCLUDE, orderBy, skip: (page - 1) * pageSize, take: pageSize });
    total = await prisma.unit.count({ where });
  }
  let rows = await perkayaBarisUnit(prisma, units);
  if (kerjaFilter.length) rows = rows.filter((r) => kerjaFilter.includes(r.adopsi.kerja.key));
  if (penuh) total = rows.length;
  const hasil = semua ? rows : penuh ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;
  const statusCounts = await prisma.unit.groupBy({ by: ["status"], _count: { _all: true } });
  return {
    units: hasil,
    statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count._all })),
    displayStatusCounts: displayStatusCountsOf(statusCounts.map((s) => ({ status: s.status, count: s._count._all }))),
    globalStatusCounts: await countByGlobalStatus(prisma, {}),
    globalStatusFlow: GLOBAL_STATUS_FLOW,
    page, pageSize, total, hasMore: !semua && (page - 1) * pageSize + hasil.length < total,
    filterDipakai: { q: query.q?.trim() || null, displayStatus: csv(query.displayStatus), globalStatus: csv(query.globalStatus), statusKerja: kerjaFilter, scope: query.scope || null },
  };
}
