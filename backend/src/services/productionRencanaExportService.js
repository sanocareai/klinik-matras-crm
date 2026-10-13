// Export Excel Rencana Produksi — pemuat data SERVER (baca-saja). Memakai fungsi papan yang SAMA (loadRuns + viewsOf -> toRunView): status global, tahap, status bahan, PIC,
// urutan manual (stationSequence), target kartu atau tanggal papan, riwayat jadwal. Tidak menulis apa pun, tidak membuat Run/jadwal. Harga hanya dimuat bila pemanggil
// ADMIN/OWNER DAN meminta (query terpisah; field tidak pernah di-select selain itu).
import { BOARD_DEFAULTS, parseProductionDate, todayWib } from "../lib/domain/productionBoard.js";
import { buildCornerRequest } from "../lib/domain/productionCorner.js";
import { EXPORT_MAX_ROWS, columnsFor, exportRowOf, exportRowOfUnit, periodLabel, sortExportRows, summaryOf, wibStamp, exportFileName } from "../lib/domain/productionRencanaExport.js";
import { priorityDisplay, storedPriorityLevel } from "../lib/domain/productionDisplay.js";
import { loadOpenComplaintsByUnit } from "./productionComplaints.js";
import { COMPLAINT_LABEL, loadRuns, viewsOf } from "./productionExperienceReadService.js";
import { globalStatusMapFor } from "./workshopMilestoneEvidence.js";
import { produkUnit } from "../lib/domain/unitKategori.js";
import { PILIH_KREDIT, nilaiBersih } from "./orderNilaiBersih.js";

const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];
const CHUNK = 25; const PARALLEL = 4;

async function viewsInChunks(prisma, runs, opts) {
  const chunks = []; for (let i = 0; i < runs.length; i += CHUNK) chunks.push(runs.slice(i, i + CHUNK));
  const out = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL);
    const res = await Promise.all(batch.map((c) => viewsOf(prisma, c, opts)));
    res.forEach((r, k) => { out[i + k] = r; });
  }
  return out.flat();
}

/**
 * @param {{ cohortUnitIds: string[]|null, query: ReturnType<import("../lib/domain/productionRencanaExport.js").normalizeExportQuery>, canIncludeValue: boolean, now?: Date }} p
 */
export async function buildRencanaExport(prisma, { cohortUnitIds, query, canIncludeValue = false, now = new Date() }) {
  const todayKey = todayWib(now);
  const includeValue = !!(canIncludeValue && query.includeValue);
  const cohort = cohortUnitIds || [];
  const notCancelled = { status: { not: "CANCELLED" } };

  // 1) Run yang masuk cakupan
  let runWhere = null;
  const orWhere = [];
  if (query.visibleOnly) {
    if (query.runIds.length && cohort.length) runWhere = { unitId: { in: cohort }, id: { in: query.runIds }, ...notCancelled };
  } else if (cohort.length) {
    const planBase = { status: { not: "CANCELLED" }, productionDate: { gte: parseProductionDate(query.from), lte: parseProductionDate(query.to) }, ...(query.stations.length ? { stationCode: { in: query.stations } } : {}) };
    orWhere.push({ ...notCancelled, plan: { is: planBase } });
    if (query.includeUnscheduled) orWhere.push({ status: { notIn: TERMINAL_RUN }, plan: { is: { productionDate: null, status: { not: "CANCELLED" } } } });
    runWhere = { unitId: { in: cohort }, OR: orWhere };
  }
  let runs = runWhere ? await loadRuns(prisma, runWhere) : [];
  // Siap Kirim/Terkirim (unit selesai) tidak tampil di papan; export mengikuti papan — kecuali kartu yang sedang terlihat (tetap memuat apa yang ada di layar).
  let truncated = false;
  if (runs.length > EXPORT_MAX_ROWS) { runs = runs.slice(0, EXPORT_MAX_ROWS); truncated = true; }
  const views = await viewsInChunks(prisma, runs, { now });
  const runById = new Map(runs.map((r) => [r.id, r]));

  // 2) Data tambahan (batch): riwayat jadwal, inspektur QC, nilai order
  const planIds = views.map((v) => v.plan?.id).filter(Boolean);
  const runIds = views.map((v) => v.runId);
  const [eventRows, inspections] = await Promise.all([
    planIds.length ? prisma.productionPlanScheduleEvent.findMany({ where: { planId: { in: planIds } }, orderBy: { createdAt: "asc" }, select: { planId: true, kind: true, missedTarget: true, reasonCode: true, note: true, createdAt: true } }) : [],
    runIds.length ? prisma.qualityInspection.findMany({ where: { runId: { in: runIds }, inspectorId: { not: null } }, orderBy: { version: "asc" }, select: { runId: true, inspectorId: true } }) : [],
  ]);
  const eventsByPlan = new Map(); for (const e of eventRows) { if (!eventsByPlan.has(e.planId)) eventsByPlan.set(e.planId, []); eventsByPlan.get(e.planId).push(e); }
  const inspectorByRun = new Map(inspections.map((i) => [i.runId, i.inspectorId]));
  const inspectorIds = [...new Set(inspectorByRun.values())];
  const inspectorNames = inspectorIds.length ? new Map((await prisma.user.findMany({ where: { id: { in: inspectorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map();

  // 3) Unit tanpa Run (kartu backlog ringkas yang sedang terlihat)
  const covered = new Set(views.map((v) => v.unit?.id));
  const wantUnits = query.visibleOnly ? query.unitIds.filter((id) => !covered.has(id)) : [];
  const unitRows = wantUnits.length ? await prisma.unit.findMany({
    where: { id: { in: wantUnits }, status: { notIn: ["DELIVERED", "CANCELLED"] } },
    select: {
      id: true, unitCode: true, orderId: true, status: true, merk: true, ukuran: true, priority: true, createdAt: true, productLine: true, productType: true, workCategory: true,
      order: { select: { orderNumber: true, category: true, productLine: true, productType: true, notes: true, beratBadan: true, complaintCategory: true, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, customer: { select: { name: true, assignedSales: { select: { name: true } } } } } },
    },
  }) : [];
  const unitGlobals = unitRows.length ? await globalStatusMapFor(prisma, unitRows) : new Map();
  const unitComplaints = unitRows.length ? await loadOpenComplaintsByUnit(prisma, unitRows.map((u) => ({ id: u.id, orderId: u.orderId }))) : new Map();

  // 4) Nilai order — hanya bila diizinkan DAN diminta
  const orderIds = [...new Set([...views.map((v) => runById.get(v.runId)?.unit?.orderId), ...unitRows.map((u) => u.orderId)].filter(Boolean))];
  const valueByOrder = includeValue && orderIds.length ? new Map((await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, value: true, ...PILIH_KREDIT } })).map((o) => [o.id, nilaiBersih(o)])) : new Map();

  const rows = [];
  for (const v of views) {
    const run = runById.get(v.runId);
    const eff = produkUnit(run.unit, run.unit.order);
    const items = (v.customer?.salesServices || []).map((layananName) => ({ layananName }));
    rows.push(exportRowOf({
      view: v, todayKey, includeValue,
      extras: {
        productLine: eff.productLine, productType: eff.productType, merk: run.unit.merk, ukuran: run.unit.ukuran, salesName: v.customer?.salesName,
        gantiKain: buildCornerRequest({ items, orderNotes: v.customer?.request ?? null }).fabricChangeRequested,
        picQc: inspectorNames.get(inspectorByRun.get(v.runId)) || null,
        events: eventsByPlan.get(v.plan?.id) || [], orderValue: valueByOrder.get(run.unit.orderId),
      },
    }));
  }
  for (const u of unitRows) {
    const eff = produkUnit(u, u.order);
    const salesServices = (u.order?.items || []).map((i) => i.layananName).filter(Boolean);
    const prio = priorityDisplay({ stored: storedPriorityLevel(u.priority), complaintCases: unitComplaints.get(u.id) || [] });
    rows.push(exportRowOfUnit({
      unit: u, globalStatus: unitGlobals.get(u.id) || null, includeValue,
      extras: {
        productLine: eff.productLine, productType: eff.productType, orderNumber: u.order?.orderNumber, customerName: u.order?.customer?.name, salesName: u.order?.customer?.assignedSales?.name,
        salesServices, weightKg: u.order?.beratBadan, request: u.order?.notes, complaints: (u.order?.complaintCategory || []).map((c) => COMPLAINT_LABEL[c] || c),
        gantiKain: buildCornerRequest({ items: salesServices.map((layananName) => ({ layananName })), orderNotes: u.order?.notes ?? null }).fabricChangeRequested,
        priorityLabel: prio.label, priorityKey: prio.key, priorityRank: prio.rank, orderValue: valueByOrder.get(u.orderId), createdAt: u.createdAt,
      },
    }));
  }
  const sorted = sortExportRows(rows);
  const stations = BOARD_DEFAULTS.stations;
  return {
    meta: {
      generatedAt: now.toISOString(), generatedLabel: `Data dibuat: ${wibStamp(now)}`, from: query.from, to: query.to, periodLabel: periodLabel(query),
      scopeLabel: query.visibleOnly ? "Hanya kartu yang sedang terlihat (sesuai filter)" : query.stations.length ? `Meja: ${query.stations.map((s) => s.replace("TABLE_", "Meja ")).join(", ")}` : "Semua Meja",
      stations: query.stations, visibleOnly: query.visibleOnly, includeValue, fileName: exportFileName(query), truncated, maxRows: EXPORT_MAX_ROWS,
      readOnlyNote: "Snapshot baca-saja. Jadwal tidak dapat diubah dari file ini dan file ini tidak untuk diimpor kembali.",
    },
    summary: summaryOf(sorted, { stations }),
    columns: columnsFor({ includeValue }),
    rows: sorted,
  };
}
