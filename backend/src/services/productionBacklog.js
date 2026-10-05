// Backlog Rencana Produksi (simplifikasi slice 1): daftar unit "Belum Dijadwalkan" dengan FILTER dan PAGINASI di server — tidak berhenti di 500 unit.
//
// Default = unit dari order NYATA berstatus Diproses (order Diproses DAN unit Diproses; pelanggan bukan SPAM/staf internal; order tidak dibatalkan).
// Siap Kirim / Terkirim tidak pernah masuk backlog (histori tetap utuh di Order Produksi/laporan). "Pengambilan" tersedia sebagai filter eksplisit.
// Satu daftar untuk semua unit: unit yang punya Run dalam cohort reader -> `schedulable` + `view` (kartu Rencana penuh); selain itu kartu ringkas
// tanpa tombol jadwal. Urutan: Komplain (ComplaintCase resmi terbuka) -> Tinggi -> Normal, lalu FIFO (createdAt). Urutan meja manual TIDAK disentuh.
//
// Skala: kandidat diambil sebagai baris ringan (id, createdAt, prioritas) lalu diurut & dipotong per halaman di memori; hanya halaman yang diminta yang
// dimuat penuh. BATAS KERAS kandidat 20.000 baris (di atasnya `truncated: true` dikembalikan, bukan diam-diam dipangkas).
import { displayStatusOfOrder, displayStatusOfUnit, physicalPresenceOf, priorityDisplay, storedPriorityLevel } from "../lib/domain/productionDisplay.js";
import { loadOpenComplaintsByUnit } from "./productionComplaints.js";
import { loadRuns, viewsOf } from "./productionExperienceReadService.js";
import { signUnitPhotoUrlsBulk } from "../routes/productionUnitPhoto.js";

export const BACKLOG_STATUSES = Object.freeze(["DIPROSES", "PENGAMBILAN"]);
const UNIT_STATUS_FOR = Object.freeze({ DIPROSES: ["RECEIVED", "IN_PRODUCTION"], PENGAMBILAN: ["AWAITING_PICKUP", "IN_TRANSIT_IN"] });
const ORDER_STATUS_FOR = Object.freeze({ DIPROSES: ["PROCESSING"], PENGAMBILAN: ["PENDING", "PICKUP"] });
const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];
export const BACKLOG_MAX_CANDIDATES = 20_000;
export const BACKLOG_PAGE_SIZE_DEFAULT = 25;
export const BACKLOG_PAGE_SIZE_MAX = 100;

export function parseBacklogQuery(raw = {}) {
  const status = BACKLOG_STATUSES.includes(String(raw.status || "").toUpperCase()) ? String(raw.status).toUpperCase() : "DIPROSES";
  const pageSize = Math.min(Math.max(parseInt(raw.pageSize, 10) || BACKLOG_PAGE_SIZE_DEFAULT, 1), BACKLOG_PAGE_SIZE_MAX);
  const page = Math.max(parseInt(raw.page, 10) || 1, 1);
  const q = String(raw.q || "").trim().slice(0, 80);
  return { status, page, pageSize, q };
}

function whereFor(status, q) {
  return {
    status: { in: UNIT_STATUS_FOR[status] },
    order: {
      status: { in: ORDER_STATUS_FOR[status] },
      customer: { pipelineStage: { not: "SPAM" }, isInternalStaff: false },
    },
    // Belum dijadwalkan = tidak punya rencana aktif yang sudah menempel ke meja.
    NOT: { productionRunsV2: { some: { status: { notIn: TERMINAL_RUN }, plan: { is: { stationCode: { not: null }, status: { not: "CANCELLED" } } } } } },
    ...(q ? { OR: [
      { unitCode: { contains: q, mode: "insensitive" } },
      { order: { orderNumber: { contains: q, mode: "insensitive" } } },
      { order: { customer: { name: { contains: q, mode: "insensitive" } } } },
    ] } : {}),
  };
}

export async function listBacklog(prisma, { cohortUnitIds = null, status = "DIPROSES", page = 1, pageSize = BACKLOG_PAGE_SIZE_DEFAULT, q = "", now = new Date() } = {}) {
  const where = whereFor(status, q);
  const cohort = new Set(cohortUnitIds || []);
  const rows = await prisma.unit.findMany({
    where, take: BACKLOG_MAX_CANDIDATES + 1,
    select: {
      id: true, orderId: true, createdAt: true, priority: true,
      productionRunsV2: { where: { status: { notIn: TERMINAL_RUN } }, select: { id: true, plan: { select: { priority: true } } } },
    },
  });
  const truncated = rows.length > BACKLOG_MAX_CANDIDATES;
  const candidates = truncated ? rows.slice(0, BACKLOG_MAX_CANDIDATES) : rows;
  const complaints = await loadOpenComplaintsByUnit(prisma, candidates.map((r) => ({ id: r.id, orderId: r.orderId })));
  const storedById = new Map();
  const ranked = candidates.map((r) => {
    const stored = Math.max(storedPriorityLevel(r.priority), ...r.productionRunsV2.map((run) => storedPriorityLevel(run.plan?.priority ?? 0)), 0);
    storedById.set(r.id, stored);
    return { id: r.id, createdAt: r.createdAt.getTime(), rank: complaints.has(r.id) ? 2 : stored };
  }).sort((a, b) => b.rank - a.rank || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  const total = ranked.length;
  const offset = (page - 1) * pageSize;
  const pageIds = ranked.slice(offset, offset + pageSize).map((r) => r.id);

  // Hitungan per status (untuk chip filter) — query count ringan, mengikuti pencarian yang sama.
  const counts = {};
  for (const s of BACKLOG_STATUSES) counts[s] = s === status ? total : await prisma.unit.count({ where: whereFor(s, q) });

  const units = pageIds.length ? await prisma.unit.findMany({
    where: { id: { in: pageIds } },
    select: {
      id: true, unitCode: true, orderId: true, status: true, merk: true, ukuran: true, createdAt: true,
      order: { select: { orderNumber: true, status: true, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, customer: { select: { name: true, city: true } } } },
      productionRunsV2: { where: { status: { notIn: TERMINAL_RUN } }, select: { id: true, origin: true, status: true, custodyHandoffs: { select: { direction: true, status: true } } }, take: 1, orderBy: { createdAt: "desc" } },
    },
  }) : [];
  const byId = new Map(units.map((u) => [u.id, u]));
  const schedulableRunIds = pageIds.map((id) => byId.get(id)).filter((u) => u && cohort.has(u.id) && u.productionRunsV2[0]).map((u) => u.productionRunsV2[0].id);
  const viewByRun = new Map();
  if (schedulableRunIds.length) {
    const runs = await loadRuns(prisma, { id: { in: schedulableRunIds } });
    for (const v of await viewsOf(prisma, runs, { now })) viewByRun.set(v.runId, v);
  }
  const photos = await signUnitPhotoUrlsBulk(prisma, pageIds);
  const items = pageIds.map((id) => {
    const u = byId.get(id); if (!u) return null;
    const run = u.productionRunsV2[0] || null;
    const view = run && cohort.has(u.id) ? viewByRun.get(run.id) || null : null;
    const prio = priorityDisplay({ stored: storedById.get(id) ?? 0, complaintCases: complaints.get(u.id) || [] });
    return {
      unitId: u.id, schedulable: !!view, view,
      card: {
        unit: { id: u.id, unitCode: u.unitCode, merk: u.merk, ukuran: u.ukuran, photoUrl: photos.get(u.id) ?? null },
        customer: { name: u.order?.customer?.name ?? null, orderNumber: u.order?.orderNumber ?? null, salesServices: (u.order?.items || []).map((i) => i.layananName).filter(Boolean) },
        orderStatus: displayStatusOfOrder(u.order?.status), unitStatus: displayStatusOfUnit(u.status),
        presence: physicalPresenceOf({ unitStatus: u.status, runStatus: run?.status ?? null, runOrigin: run?.origin ?? null, inboundAccepted: !!run?.custodyHandoffs?.some((h) => h.direction === "INBOUND" && h.status === "ACCEPTED") }),
        priority: { key: prio.key, label: prio.label, rank: prio.rank, complaintCases: prio.complaintCases },
      },
    };
  }).filter(Boolean);
  return { status, page, pageSize, total, hasMore: offset + pageIds.length < total, truncated, counts, items };
}
