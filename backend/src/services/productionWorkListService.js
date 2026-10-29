// DAFTAR KERJA STATUS PRODUKSI (GET /api/production/work-list) — satu baris per ORDER, unit di dalamnya. BACA-SAJA.
//
// Memakai pengayaan unit yang SAMA dengan daftar Order Produksi (perkayaBarisUnit: posisi · status kerja · target · PIC · tindakan berikutnya) dan menambah:
//   • status ORDER Sales apa adanya (bukan turunan status unit),
//   • ringkasan tahap Produksi (Meja) HANYA bila unit punya pekerjaan di alur itu (tidak pernah ditebak dari status lain),
//   • perhatian utama per unit/order (lib/domain/productionWorkList.js).
// Scope: "aktif" (default) = order yang masih punya unit belum Terkirim/Dibatalkan; "riwayat" = order yang seluruh unitnya Terkirim/Dibatalkan.
// Order selesai tidak memenuhi antrean aktif. Order batal, pelanggan SPAM/internal tidak ditampilkan (sama dengan daftar Order Produksi "nyata").
import { UNIT_INCLUDE, perkayaBarisUnit } from "./productionOrderList.js";
import { displayStatusOfOrder, displayStatusOfUnit } from "../lib/domain/productionDisplay.js";
import {
  ATTENTION, UNIT_SELESAI, WORK_FILTER_KEYS, isUnitAktif, tindakanTersedia, WORK_SORT_KEYS, hitungFilter, lolosFilter, perhatianUnit, ringkasOrder, urutkanOrder,
} from "../lib/domain/productionWorkList.js";

export const BATAS_UNIT_AKTIF = 2500;
export const PHASE_LABEL = Object.freeze({ INTAKE: "Penerimaan", DIAGNOSIS: "Diagnosis", PROCESS: "Pengerjaan", QC: "QC", HANDOFF: "Serah ke Gudang" });
export const RUN_STATUS_LABEL = Object.freeze({ PENDING_ARRIVAL: "Menunggu unit diterima", ACTIVE: "Berjalan", BLOCKED: "Tertahan" });

const ORDER_NYATA = { status: { not: "CANCELLED" }, customer: { is: { pipelineStage: { not: "SPAM" }, isInternalStaff: false } } };

/** Ringkasan pekerjaan di alur Meja per unit: hanya yang benar-benar ada (Run non-terminal). */
async function muatAlurMeja(prisma, unitIds) {
  const map = new Map();
  if (!unitIds.length) return map;
  const runs = await prisma.productionRun.findMany({
    where: { unitId: { in: unitIds }, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: { id: true, unitId: true, status: true, currentPhase: true, plan: { select: { stationCode: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
  for (const r of runs) {
    if (map.has(r.unitId)) continue;
    map.set(r.unitId, {
      runId: r.id, status: r.status, statusLabel: RUN_STATUS_LABEL[r.status] ?? r.status,
      tahap: r.status === "PENDING_ARRIVAL" ? null : (PHASE_LABEL[r.currentPhase] ?? null), meja: r.plan?.status !== "CANCELLED" ? (r.plan?.stationCode ?? null) : null,
    });
  }
  return map;
}

function bentukUnit(row, alur, now) {
  const perhatian = perhatianUnit({ ...row, alurMeja: alur ?? null }, { now });
  const a = row.adopsi;
  return {
    id: row.id, unitCode: row.unitCode, merk: row.merk ?? null, ukuran: row.ukuran ?? null, status: row.status, statusUnit: displayStatusOfUnit(row.status)?.label ?? null,
    posisi: a.posisi, kerja: a.kerja, tindakan: tindakanTersedia(a), targetSelesai: a.targetSelesai, pic: a.pic, meja: a.meja, jadwal: a.jadwal ?? null,
    rencanaBahanAda: a.rencanaBahanAda, aktualBahanAda: a.aktualBahanAda, buktiAplikasi: a.buktiAplikasi,
    receivedBasisLabel: row.receivedBasisLabel ?? null, prioritas: row.priorityDisplay ? { key: row.priorityDisplay.key, label: row.priorityDisplay.label } : null,
    // Unit sudah Terkirim/Dibatalkan tetapi pekerjaan Meja-nya belum ditutup = data tidak konsisten: JANGAN tampil sebagai tahap aktif; tandai jujur agar ditinjau.
    alurMeja: isUnitAktif(row.status) ? (alur ?? null) : null,
    anomali: !isUnitAktif(row.status) && alur ? { kode: "PEKERJAAN_MEJA_BELUM_DITUTUP", teks: "Unit sudah selesai/dibatalkan, tetapi pekerjaan di alur Meja belum ditutup — perlu ditinjau Kepala Produksi." } : null,
    inProductionV2: !!row.inProductionV2, perhatian,
  };
}

function bentukOrder(order, unitRows, alurByUnit, now) {
  const units = unitRows.map((r) => bentukUnit(r, alurByUnit.get(r.id), now));
  const ringkas = ringkasOrder(units.map((u) => ({ ...u, adopsi: { posisi: u.posisi, kerja: u.kerja, tindakan: u.tindakan, targetSelesai: u.targetSelesai, pic: u.pic }, order: { status: order.status } })), { now });
  const tampil = displayStatusOfOrder(order.status);
  return {
    orderId: order.id, orderNumber: order.orderNumber, dibuatAt: order.createdAt,
    pelanggan: { id: order.customer?.id ?? null, nama: order.customer?.name ?? null },
    layanan: (order.items || []).map((i) => i.layananName).filter(Boolean),
    statusOrder: { key: tampil?.key ?? null, label: tampil?.label ?? String(order.status), detail: tampil?.detail ?? null, mentah: order.status, terkunci: !!order.statusLocked },
    units, ringkas,
  };
}

const ORDER_SELECT = { id: true, orderNumber: true, status: true, statusLocked: true, createdAt: true, customer: { select: { id: true, name: true } }, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } } };

function whereCari(q) {
  const t = typeof q === "string" ? q.trim().slice(0, 80) : "";
  if (!t) return null;
  return { OR: [
    { unitCode: { contains: t, mode: "insensitive" } },
    { order: { is: { orderNumber: { contains: t, mode: "insensitive" } } } },
    { order: { is: { customer: { is: { name: { contains: t, mode: "insensitive" } } } } } },
    { order: { is: { items: { some: { layananName: { contains: t, mode: "insensitive" } } } } } },
  ] };
}

/**
 * @param {{ scope?: "aktif"|"riwayat", q?: string, filter?: string, sort?: string, page?: number|string, pageSize?: number|string }} query
 */
export async function listWorkList(prisma, query = {}, { now = new Date() } = {}) {
  const scope = query.scope === "riwayat" ? "riwayat" : "aktif";
  const filter = WORK_FILTER_KEYS.includes(query.filter) ? query.filter : "SEMUA";
  const sort = WORK_SORT_KEYS.includes(query.sort) ? query.sort : "PERHATIAN";
  const pageSize = Math.min(Math.max(parseInt(query.pageSize, 10) || 25, 1), 100);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const cari = whereCari(query.q);

  // Hitungan ringkas dua antrean (selalu jujur dari server): aktif vs riwayat.
  const adaAktif = { status: { notIn: [...UNIT_SELESAI] } };
  const whereOrderAktif = { ...ORDER_NYATA, units: { some: adaAktif } };
  const whereOrderRiwayat = { ...ORDER_NYATA, units: { some: {}, none: adaAktif } };
  const [jumlahAktif, jumlahRiwayat] = await Promise.all([prisma.order.count({ where: whereOrderAktif }), prisma.order.count({ where: whereOrderRiwayat })]);

  if (scope === "riwayat") {
    const where = { ...ORDER_NYATA, AND: [{ units: { some: {}, none: adaAktif } }, ...(cari ? [{ units: { some: cari } }] : [])] };
    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({ where, select: ORDER_SELECT, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const units = await prisma.unit.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, include: UNIT_INCLUDE, orderBy: [{ seq: "asc" }, { id: "asc" }] });
    const rows = await perkayaBarisUnit(prisma, units, { kelengkapan: false });
    const alur = await muatAlurMeja(prisma, units.map((u) => u.id)); // hanya untuk mendeteksi pekerjaan Meja yang belum ditutup
    const byOrder = new Map(); for (const r of rows) { if (!byOrder.has(r.orderId)) byOrder.set(r.orderId, []); byOrder.get(r.orderId).push(r); }
    return {
      scope, filter: "SEMUA", sort: "TERBARU", orders: orders.map((o) => bentukOrder(o, byOrder.get(o.id) || [], alur, now)),
      counts: { aktif: jumlahAktif, riwayat: jumlahRiwayat }, filterCounts: null, page, pageSize, total, hasMore: page * pageSize < total,
    };
  }

  // AKTIF: semua order yang punya unit aktif (dan cocok pencarian) dimuat → diperkaya → disaring/diurutkan di memori → dipaginasi per order.
  const orderIdsKandidat = (await prisma.order.findMany({ where: { ...ORDER_NYATA, AND: [{ units: { some: adaAktif } }, ...(cari ? [{ units: { some: cari } }] : [])] }, select: { id: true }, take: BATAS_UNIT_AKTIF + 1 })).map((o) => ({ orderId: o.id }));
  if (orderIdsKandidat.length > BATAS_UNIT_AKTIF) { const e = new Error(`Terlalu banyak order aktif (${BATAS_UNIT_AKTIF}+). Persempit dengan pencarian.`); e.statusCode = 413; e.code = "TERLALU_BANYAK"; throw e; }
  const ids = orderIdsKandidat.map((x) => x.orderId);
  const [orders, units] = await Promise.all([
    prisma.order.findMany({ where: { id: { in: ids } }, select: ORDER_SELECT }),
    prisma.unit.findMany({ where: { orderId: { in: ids } }, include: UNIT_INCLUDE, orderBy: [{ seq: "asc" }, { id: "asc" }] }),
  ]);
  const rows = await perkayaBarisUnit(prisma, units, { kelengkapan: false });
  const alurByUnit = await muatAlurMeja(prisma, rows.map((r) => r.id));
  const byOrder = new Map(); for (const r of rows) { if (!byOrder.has(r.orderId)) byOrder.set(r.orderId, []); byOrder.get(r.orderId).push(r); }
  const semua = orders.map((o) => bentukOrder(o, byOrder.get(o.id) || [], alurByUnit, now));
  const filterCounts = hitungFilter(semua, { now });
  const disaring = urutkanOrder(semua.filter((o) => lolosFilter(filter, o, { now })), sort);
  const halaman = disaring.slice((page - 1) * pageSize, page * pageSize);
  return {
    scope, filter, sort, orders: halaman, counts: { aktif: jumlahAktif, riwayat: jumlahRiwayat }, filterCounts, page, pageSize, total: disaring.length, hasMore: page * pageSize < disaring.length,
    ringkas: { unitAktif: semua.reduce((n, o) => n + o.ringkas.jumlahAktif, 0), perluTindakan: filterCounts.PERLU_TINDAKAN, tingkatTinggi: semua.filter((o) => o.ringkas.perhatianLevel >= ATTENTION.HIGH).length },
  };
}
