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
import { diagnoseUnitPhotosBulk } from "./productionUnitPhotoService.js";
import { RENCANA_ACTION, photoNoteOf } from "../lib/domain/productionRencana.js";
import { BUILD_CATEGORIES, classifyProduct } from "../lib/domain/productionBuildTrack.js";
import { classifyUnitRow, cohortStatesOf } from "./productionRencanaService.js";
import { loadV2Flags } from "./v2FeatureFlags.js";
import { PKR_ORDER_SELECT, rujukanPkrDariOrder } from "./pkrProduksiGuard.js";

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

// `states` = { reader, writer } hasil cohortStatesOf(flags) — kelayakan tiap unit (onboarding/aktivasi) dihitung dari flag SEBENARNYA. `cohortUnitIds` (lama) hanya untuk
// pemanggil/tes lama: dianggap cohort reader DAN writer sekaligus. Tanpa keduanya, flag dibaca dari DB.
function statesFrom({ states, cohortUnitIds }) {
  if (states) return states;
  const ids = new Set((cohortUnitIds || []).map((x) => String(x).toLowerCase()));
  const cohort = { mode: ids.size ? "COHORT" : "OFF", unitIds: ids, diagnostic: null };
  return { reader: cohort, writer: cohort };
}

export async function listBacklog(prisma, { cohortUnitIds = null, states = null, status = "DIPROSES", page = 1, pageSize = BACKLOG_PAGE_SIZE_DEFAULT, q = "", now = new Date() } = {}) {
  const where = whereFor(status, q);
  const st = states || (cohortUnitIds ? statesFrom({ cohortUnitIds }) : cohortStatesOf(await loadV2Flags(prisma)));
  const cohort = new Set([...st.reader.unitIds].filter((id) => st.writer.unitIds.has(id))); // Run + jadwal butuh reader DAN writer
  const rows = await prisma.unit.findMany({
    where, take: BACKLOG_MAX_CANDIDATES + 1,
    select: {
      id: true, orderId: true, createdAt: true, priority: true, status: true, currentStageId: true, _count: { select: { stageLogs: true } },
      order: { select: { status: true, ...PKR_ORDER_SELECT, customer: { select: { pipelineStage: true, isInternalStaff: true } } } },
      productionRunsV2: { where: { status: { notIn: TERMINAL_RUN } }, select: { id: true, plan: { select: { priority: true } } } },
    },
  });
  const truncated = rows.length > BACKLOG_MAX_CANDIDATES;
  const candidates = truncated ? rows.slice(0, BACKLOG_MAX_CANDIDATES) : rows;
  const complaints = await loadOpenComplaintsByUnit(prisma, candidates.map((r) => ({ id: r.id, orderId: r.orderId })));
  const storedById = new Map();
  const classById = new Map();
  const rencanaCounts = {};
  const ranked = candidates.map((r) => {
    const cls = classifyUnitRow(r, st); classById.set(r.id, cls); rencanaCounts[cls.action] = (rencanaCounts[cls.action] || 0) + 1;
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
      order: { select: { orderNumber: true, status: true, category: true, productLine: true, productType: true, ...PKR_ORDER_SELECT, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, customer: { select: { name: true, city: true } } } },
      jobUnits: { where: { job: { type: "PICKUP" } }, select: { id: true }, take: 1 }, // pickup nyata = jalur custody (bukan lahir di workshop)
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
  const noPhotoIds = pageIds.filter((id) => !photos.get(id));
  const photoDiag = noPhotoIds.length ? await diagnoseUnitPhotosBulk(prisma, noPhotoIds) : new Map();
  const items = pageIds.map((id) => {
    const u = byId.get(id); if (!u) return null;
    const run = u.productionRunsV2[0] || null;
    const view = run && cohort.has(u.id) ? viewByRun.get(run.id) || null : null;
    const prio = priorityDisplay({ stored: storedById.get(id) ?? 0, complaintCases: complaints.get(u.id) || [] });
    const cls = classById.get(id);
    // Order Penjualan Karyawan: rujukan tampil di kartu TANPA bergantung flag V2 (dihitung dari order, bukan dari Run); belum lengkap = tidak boleh dijadwalkan walau sudah punya Run.
    const pkr = rujukanPkrDariOrder(u.order);
    const pkrBlokir = !!pkr && !pkr.lengkap;
    return {
      unitId: u.id, schedulable: !!view && !pkrBlokir, view: pkrBlokir ? null : view,
      // Aksi berikutnya yang JELAS per kartu (server = otoritas): SCHEDULE | ONBOARD_SCHEDULE (Jadwalkan membuka Run) | AWAIT_ACTIVATION | WAIT_PICKUP | EXCEPTION.
      // `onboardable` = kartu boleh dijadwalkan/diseret walau belum punya Run; `view` null — formulir jadwal mengirim unitId.
      rencana: {
        action: view && !pkrBlokir ? RENCANA_ACTION.SCHEDULE : cls.action, code: cls.code, message: cls.message, next: cls.next, onboardable: !view && cls.action === RENCANA_ACTION.ONBOARD_SCHEDULE,
        // Jalur Pengerjaan Pesanan (BARU/custom, lahir di workshop): modal Jadwalkan menampilkan "Corner diperlukan?" + kebutuhan konfirmasi jenis produk. null = bukan jalur ini.
        build: !view && cls.action === RENCANA_ACTION.ONBOARD_SCHEDULE && BUILD_CATEGORIES.includes(u.order?.category) && !(u.jobUnits?.length) ? (() => { const p = classifyProduct({ productLine: u.order?.productLine, productType: u.order?.productType }); return { product: { class: p.productClass, flow: p.flow, problem: p.problem } }; })() : null,
      },
      card: {
        penjualanKaryawan: pkr,
        photoNote: photoNoteOf({ photoUrl: photos.get(u.id) ?? null, diagnosis: photoDiag.get(u.id) }),
        unit: { id: u.id, unitCode: u.unitCode, merk: u.merk, ukuran: u.ukuran, photoUrl: photos.get(u.id) ?? null },
        customer: { name: u.order?.customer?.name ?? null, orderNumber: u.order?.orderNumber ?? null, salesServices: (u.order?.items || []).map((i) => i.layananName).filter(Boolean) },
        orderStatus: displayStatusOfOrder(u.order?.status), unitStatus: displayStatusOfUnit(u.status),
        presence: physicalPresenceOf({ unitStatus: u.status, runStatus: run?.status ?? null, runOrigin: run?.origin ?? null, inboundAccepted: !!run?.custodyHandoffs?.some((h) => h.direction === "INBOUND" && h.status === "ACCEPTED") }),
        priority: { key: prio.key, label: prio.label, rank: prio.rank, complaintCases: prio.complaintCases },
      },
    };
  }).filter(Boolean);
  return { status, page, pageSize, total, hasMore: offset + pageIds.length < total, truncated, counts, rencanaCounts, items };
}
