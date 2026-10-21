// Rencana Admin — jadwal produksi per unit TANPA Production Run (aturan murni: lib/domain/productionRencanaAdmin.js).
// COMMAND (di dalam transaksi): jadwalkan / pindahkan / ubah target-prioritas, keluarkan dari jadwal, undo, ambil-alih saat aktivasi V2. Semuanya HANYA menulis
// production_unit_schedules + production_unit_schedule_events + (bila diubah) Unit.priority/productionDueAt + activity log. TIDAK ADA Run, tahap, QC, penerimaan,
// serah-terima, pemakaian bahan, stok, jurnal, outbox, maupun pesan pelanggan.
// BACAAN: kalender mingguan (hari + meja, rencana Admin dan V2 pada kalender yang sama) dan antrean kerja per tindakan.
import { BOARD_DEFAULTS, assertStationCapacity } from "../lib/domain/productionBoard.js";
import {
  ANTREAN_SORT, ANTREAN_TAB, ANTREAN_TABS, HARI, JADWAL_EVENT, JADWAL_STATUS, JADWAL_SUMBER, SUMBER_DAMPAK, SUMBER_LABEL, addDays, formatProductionDate, jadwalError, kapasitasHari,
  mondayOf, normalizeJadwalInput, parseProductionDate, penghalangJadwal, stationLabel, tabAntrean, targetAtOf, targetKeyOf, todayWib, weekDays,
} from "../lib/domain/productionRencanaAdmin.js";
import { guardV1UnitWrite } from "./unitV2Ownership.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { PKR_ORDER_SELECT, PKR_UNIT_ITEM_SELECT, rujukanPkrDariOrder } from "./pkrProduksiGuard.js";
import { statusOrderEfektif } from "../lib/domain/unitKategori.js";
import { UNIT_INCLUDE, perkayaBarisUnit } from "./productionOrderList.js";
import { signUnitPhotoUrlsBulk } from "../routes/productionUnitPhoto.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";
import { loadMilestoneEvidence } from "./workshopMilestoneEvidence.js";
import { storedPriorityLevel } from "../lib/domain/productionDisplay.js";

const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const FINISHED_UNIT = ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"];
const INACTIVE_UNIT = INACTIVE_UNIT_CORE;
const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];
import { INACTIVE_UNIT as INACTIVE_UNIT_CORE, adoptJadwalAdminInTx, lockSlot, slotOccupied, stateOf, writeEvent } from "./productionJadwalCore.js";
export { adoptJadwalAdminInTx, slotOccupied };
const dkey = (d) => formatProductionDate(d);

function assertKey(k) { if (typeof k !== "string" || !KEY_RE.test(k)) throw jadwalError("Idempotency-Key wajib (8–128 karakter: huruf, angka, . _ : -)", 400, "IDEMPOTENCY_KEY_INVALID"); }

async function loadUnitForWrite(tx, unitId) {
  const u = await tx.unit.findUnique({
    where: { id: unitId },
    select: {
      id: true, unitCode: true, status: true, priority: true, productionDueAt: true, ...PKR_UNIT_ITEM_SELECT,
      order: { select: { status: true, category: true, ...PKR_ORDER_SELECT, customer: { select: { pipelineStage: true, isInternalStaff: true } } } },
      productionRunsV2: { where: { status: { notIn: TERMINAL_RUN } }, select: { id: true }, take: 1 },
    },
  });
  if (!u) throw jadwalError("Unit tidak ditemukan", 404, "JADWAL_UNIT_TIDAK_ADA");
  return u;
}

function assertBolehDijadwalkan(u) {
  const pkr = rujukanPkrDariOrder(u.order, { unit: u });
  const h = penghalangJadwal({
    unitStatus: u.status, orderStatus: statusOrderEfektif(u.order, u), isInternal: !!u.order?.customer?.isInternalStaff, customerStage: u.order?.customer?.pipelineStage ?? null,
    pkrKurang: pkr && !pkr.lengkap ? { nomor: pkr.nomor, kurang: pkr.kurang } : null, v2Owned: false, runOutsideCohort: u.productionRunsV2.length > 0,
  });
  if (h) throw jadwalError(`${h.message} ${h.next}`, 422, `JADWAL_${h.code}`, { code: h.code });
}

/** CAS pada kolom Unit (priority, productionDueAt): nilai yang DILIHAT klien harus sama dengan di database. */
async function ubahUnitDenganCas(tx, unit, { priority, targetAt }, seen) {
  const data = {};
  if (priority !== undefined && priority !== unit.priority) data.priority = priority;
  if (targetAt !== undefined && String(targetAt?.toISOString?.() ?? null) !== String(unit.productionDueAt?.toISOString?.() ?? null)) data.productionDueAt = targetAt;
  if (!Object.keys(data).length) return false;
  const seenDue = seen && "productionDueAt" in seen ? (seen.productionDueAt ? new Date(seen.productionDueAt) : null) : unit.productionDueAt;
  const guard = { priority: seen && seen.priority !== undefined ? seen.priority : unit.priority, productionDueAt: seenDue };
  const r = await tx.unit.updateMany({ where: { id: unit.id, ...guard }, data });
  if (r.count === 0) throw jadwalError("Prioritas/target unit ini baru saja diubah orang lain — muat ulang lalu coba lagi.", 409, "JADWAL_UNIT_BERUBAH");
  return true;
}

/**
 * Jadwalkan / pindahkan / ubah target-prioritas SATU unit (Rencana Admin). Idempoten (Idempotency-Key per unit); revisi basi ditolak 409; kapasitas meja ditegakkan
 * dengan kunci slot yang SAMA dengan penjadwalan V2 sehingga dua jalur tidak pernah melampaui kapasitas bersama.
 */
export async function jadwalkanUnitInTx(tx, { unitId, actorId, idempotencyKey, expectedRevision = 0, input = {}, expectedUnit = null, config = BOARD_DEFAULTS, now = new Date() }) {
  assertKey(idempotencyKey);
  const data = normalizeJadwalInput(input, { config, now });
  const rev = Number.isInteger(expectedRevision) && expectedRevision >= 0 ? expectedRevision : (() => { throw jadwalError("expectedRevision harus bilangan bulat ≥ 0", 400, "JADWAL_REVISI_INVALID"); })();
  const replay = await tx.productionUnitScheduleEvent.findFirst({ where: { unitId, idempotencyKey } });
  if (replay) {
    const cur = await tx.productionUnitSchedule.findUnique({ where: { unitId } });
    if (dkey(replay.toDate) !== data.dateKey || (replay.toStation ?? null) !== data.stationCode) throw jadwalError("Idempotency-Key sama dipakai untuk isian berbeda", 409, "IDEMPOTENCY_KEY_REUSED");
    return { replayed: true, eventId: replay.id, kind: replay.kind, ...stateOf(cur) };
  }
  await guardV1UnitWrite(tx, unitId, { what: "jadwal produksi", actorId, reject: true });
  const unit = await loadUnitForWrite(tx, unitId);
  assertBolehDijadwalkan(unit);
  const cur = await tx.productionUnitSchedule.findUnique({ where: { unitId } });
  if ((cur?.revision ?? 0) !== rev) throw jadwalError("Jadwal unit ini sudah berubah sejak Anda membukanya — muat ulang lalu periksa lagi.", 409, "JADWAL_REVISI_BASI", { currentRevision: cur?.revision ?? 0 });

  const aktif = cur?.status === JADWAL_STATUS.ACTIVE;
  const slotBerubah = !aktif || dkey(cur.productionDate) !== data.dateKey || (cur.stationCode ?? null) !== data.stationCode;
  if (slotBerubah && data.stationCode) {
    await lockSlot(tx, data.dateKey, data.stationCode);
    assertStationCapacity(await slotOccupied(tx, { productionDate: data.productionDate, stationCode: data.stationCode, excludeUnitId: unitId }), config);
  }
  const targetAt = data.targetKey === undefined ? undefined : targetAtOf(data.targetKey, config);
  const unitUbah = await ubahUnitDenganCas(tx, unit, { priority: data.priority, targetAt }, expectedUnit);
  if (!slotBerubah && !unitUbah) return { replayed: false, noChange: true, ...stateOf(cur) };

  const revision = (cur?.revision ?? 0) + 1;
  const schedule = cur
    ? await tx.productionUnitSchedule.update({ where: { id: cur.id }, data: { productionDate: data.productionDate, stationCode: data.stationCode, status: JADWAL_STATUS.ACTIVE, adoptedPlanId: null, revision, updatedById: actorId } })
    : await tx.productionUnitSchedule.create({ data: { unitId, productionDate: data.productionDate, stationCode: data.stationCode, revision, status: JADWAL_STATUS.ACTIVE, createdById: actorId, updatedById: actorId } });
  const kind = !aktif ? JADWAL_EVENT.SCHEDULED : slotBerubah ? JADWAL_EVENT.RESCHEDULED : JADWAL_EVENT.TARGET_CHANGED;
  const nextTarget = targetAt === undefined ? unit.productionDueAt : targetAt;
  const nextPriority = data.priority === undefined ? unit.priority : data.priority;
  const ev = await writeEvent(tx, {
    schedule, unitId, kind, revision, idempotencyKey, actorId, note: data.note,
    from: { date: aktif ? cur.productionDate : null, station: aktif ? cur.stationCode : null, priority: unit.priority, targetAt: unit.productionDueAt },
    to: { date: data.productionDate, station: data.stationCode, priority: nextPriority, targetAt: nextTarget },
  });
  await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_ADMIN_SCHEDULE_SET, actorId, metadata: { unitCode: unit.unitCode, kind, toDate: data.dateKey, toStation: stationLabel(data.stationCode), fromDate: aktif ? dkey(cur.productionDate) : null, scheduleId: schedule.id } });
  return { replayed: false, eventId: ev.id, kind, ...stateOf(schedule) };
}

/** Keluarkan unit dari jadwal Admin (status CLEARED). Riwayat tetap; bukan penghapusan. */
export async function batalkanJadwalInTx(tx, { unitId, actorId, idempotencyKey, expectedRevision, note = null }) {
  assertKey(idempotencyKey);
  const replay = await tx.productionUnitScheduleEvent.findFirst({ where: { unitId, idempotencyKey } });
  if (replay) return { replayed: true, eventId: replay.id, kind: replay.kind, ...stateOf(await tx.productionUnitSchedule.findUnique({ where: { unitId } })) };
  await guardV1UnitWrite(tx, unitId, { what: "jadwal produksi", actorId, reject: true });
  const cur = await tx.productionUnitSchedule.findUnique({ where: { unitId }, include: { unit: { select: { unitCode: true, priority: true, productionDueAt: true } } } });
  if (!cur || cur.status !== JADWAL_STATUS.ACTIVE) throw jadwalError("Unit ini tidak sedang dijadwalkan (Rencana Admin).", 409, "JADWAL_TIDAK_AKTIF");
  if (cur.revision !== expectedRevision) throw jadwalError("Jadwal unit ini sudah berubah — muat ulang lalu periksa lagi.", 409, "JADWAL_REVISI_BASI", { currentRevision: cur.revision });
  const revision = cur.revision + 1;
  const schedule = await tx.productionUnitSchedule.update({ where: { id: cur.id }, data: { status: JADWAL_STATUS.CLEARED, revision, updatedById: actorId } });
  const ev = await writeEvent(tx, { schedule, unitId, kind: JADWAL_EVENT.UNSCHEDULED, revision, idempotencyKey, actorId, note: note ? String(note).slice(0, 500) : null, from: { date: cur.productionDate, station: cur.stationCode, priority: cur.unit.priority, targetAt: cur.unit.productionDueAt } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_ADMIN_SCHEDULE_SET, actorId, metadata: { unitCode: cur.unit.unitCode, kind: "UNSCHEDULED", fromDate: dkey(cur.productionDate), scheduleId: schedule.id } });
  return { replayed: false, eventId: ev.id, kind: JADWAL_EVENT.UNSCHEDULED, ...stateOf(schedule) };
}

/**
 * UNDO perubahan terakhir. Hanya bila: event itu adalah yang TERAKHIR, revisi jadwal masih = hasil event itu (belum diubah siapa pun), jadwal belum diambil alih V2, dan
 * unit tidak dimiliki V2. Mengembalikan tanggal/meja (+ prioritas/target) ke nilai lama; kapasitas slot lama ditegakkan lagi. Dicatat sebagai event UNDONE.
 */
export async function undoJadwalInTx(tx, { unitId, eventId, actorId, idempotencyKey, config = BOARD_DEFAULTS }) {
  assertKey(idempotencyKey);
  const replay = await tx.productionUnitScheduleEvent.findFirst({ where: { unitId, idempotencyKey } });
  if (replay) return { replayed: true, eventId: replay.id, kind: replay.kind, ...stateOf(await tx.productionUnitSchedule.findUnique({ where: { unitId } })) };
  await guardV1UnitWrite(tx, unitId, { what: "jadwal produksi", actorId, reject: true });
  const cur = await tx.productionUnitSchedule.findUnique({ where: { unitId }, include: { unit: { select: { id: true, unitCode: true, priority: true, productionDueAt: true } } } });
  if (!cur) throw jadwalError("Unit ini belum pernah dijadwalkan.", 404, "JADWAL_TIDAK_ADA");
  const last = await tx.productionUnitScheduleEvent.findFirst({ where: { scheduleId: cur.id }, orderBy: [{ resultingRevision: "desc" }, { createdAt: "desc" }] });
  const target = last && last.id === eventId ? last : null;
  const tolak = (why, code = "JADWAL_UNDO_TIDAK_BISA") => { throw jadwalError(`Tidak bisa dibatalkan: ${why}`, 409, code); };
  if (!target) tolak("sudah ada perubahan sesudahnya.");
  if ([JADWAL_EVENT.UNDONE, JADWAL_EVENT.ADOPTED].includes(target.kind)) tolak(target.kind === JADWAL_EVENT.ADOPTED ? "jadwal sudah dipakai rencana V2." : "perubahan itu sudah dibatalkan.");
  if (cur.status === JADWAL_STATUS.ADOPTED || cur.revision !== target.resultingRevision) tolak("jadwal sudah berubah sejak perubahan itu.");
  const sebelumnya = target.fromDate ? { date: target.fromDate, station: target.fromStation } : null; // null = sebelumnya belum dijadwalkan (atau sudah dikeluarkan)
  const revision = cur.revision + 1;
  let schedule;
  if (sebelumnya) {
    if (sebelumnya.station) { await lockSlot(tx, dkey(sebelumnya.date), sebelumnya.station); assertStationCapacity(await slotOccupied(tx, { productionDate: sebelumnya.date, stationCode: sebelumnya.station, excludeUnitId: unitId }), config); }
    schedule = await tx.productionUnitSchedule.update({ where: { id: cur.id }, data: { productionDate: sebelumnya.date, stationCode: sebelumnya.station, status: JADWAL_STATUS.ACTIVE, revision, updatedById: actorId } });
  } else {
    schedule = await tx.productionUnitSchedule.update({ where: { id: cur.id }, data: { status: JADWAL_STATUS.CLEARED, revision, updatedById: actorId } });
  }
  // prioritas/target dikembalikan hanya bila nilai saat ini masih = nilai hasil event itu (tidak menimpa perubahan orang lain di jalur lain)
  const sama = (a, b) => String(a?.toISOString?.() ?? a ?? null) === String(b?.toISOString?.() ?? b ?? null);
  const unitData = {};
  if (target.toPriority && target.fromPriority && target.toPriority !== target.fromPriority && cur.unit.priority === target.toPriority) unitData.priority = target.fromPriority;
  if (!sama(target.fromTargetAt, target.toTargetAt) && sama(cur.unit.productionDueAt, target.toTargetAt)) unitData.productionDueAt = target.fromTargetAt;
  if (Object.keys(unitData).length) await tx.unit.update({ where: { id: unitId }, data: unitData });
  const ev = await writeEvent(tx, {
    schedule, unitId, kind: JADWAL_EVENT.UNDONE, revision, idempotencyKey, actorId, undoOf: target.id,
    from: { date: target.toDate, station: target.toStation, priority: target.toPriority, targetAt: target.toTargetAt }, to: { date: target.fromDate, station: target.fromStation, priority: target.fromPriority, targetAt: target.fromTargetAt },
  });
  await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_ADMIN_SCHEDULE_SET, actorId, metadata: { unitCode: cur.unit.unitCode, kind: "UNDONE", scheduleId: schedule.id, toDate: sebelumnya ? dkey(sebelumnya.date) : null, toStation: sebelumnya ? stationLabel(sebelumnya.station) : null } });
  return { replayed: false, eventId: ev.id, kind: JADWAL_EVENT.UNDONE, ...stateOf(schedule) };
}

export async function riwayatJadwal(client, unitId) {
  const sch = await client.productionUnitSchedule.findUnique({ where: { unitId } });
  if (!sch) return { schedule: null, events: [] };
  const events = await client.productionUnitScheduleEvent.findMany({ where: { scheduleId: sch.id }, orderBy: [{ resultingRevision: "asc" }, { createdAt: "asc" }] });
  const names = new Map((await client.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.actorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const terakhir = events.length ? events[events.length - 1] : null;
  return {
    schedule: stateOf(sch),
    events: events.map((e) => ({
      id: e.id, kind: e.kind, at: e.createdAt, actor: names.get(e.actorId) ?? null, note: e.note, revision: e.resultingRevision,
      dari: e.fromDate ? { tanggal: dkey(e.fromDate), meja: e.fromStation } : null, ke: e.toDate ? { tanggal: dkey(e.toDate), meja: e.toStation } : null,
      undoable: !!terakhir && terakhir.id === e.id && ![JADWAL_EVENT.UNDONE, JADWAL_EVENT.ADOPTED].includes(e.kind) && sch.status !== JADWAL_STATUS.ADOPTED && sch.revision === e.resultingRevision,
    })),
  };
}

// ────────────────────────────── BACAAN ──────────────────────────────

const UNIT_LITE = {
  id: true, unitCode: true, status: true, priority: true, productionDueAt: true, ukuran: true, merk: true,
  order: { select: { id: true, orderNumber: true, status: true, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, customer: { select: { name: true, pipelineStage: true, isInternalStaff: true } } } },
};

/** Kesiapan bahan per unit (jujur): TIDAK_ADA_RENCANA | KURANG (saldo stok total < kebutuhan; reservasi lain tidak dihitung) | LENGKAP. Tidak mengubah apa pun. */
async function bahanReadiness(prisma, unitIds) {
  const out = new Map(unitIds.map((id) => [id, { key: "TIDAK_ADA_RENCANA", label: "Rencana bahan belum disusun", kurang: [] }]));
  if (!unitIds.length) return out;
  const plans = await prisma.productionUnitMaterialPlan.findMany({ where: { unitId: { in: unitIds } }, select: { unitId: true, lines: true } });
  const matIds = [...new Set(plans.flatMap((p) => (Array.isArray(p.lines) ? p.lines : []).map((l) => l.materialId)).filter(Boolean))];
  const saldo = matIds.length ? new Map((await prisma.stockMovement.groupBy({ by: ["materialId"], where: { materialId: { in: matIds } }, _sum: { qty: true } })).map((r) => [r.materialId, Number(r._sum.qty ?? 0)])) : new Map();
  const nama = matIds.length ? new Map((await prisma.material.findMany({ where: { id: { in: matIds } }, select: { id: true, name: true } })).map((m) => [m.id, m.name])) : new Map();
  for (const p of plans) {
    const lines = Array.isArray(p.lines) ? p.lines : [];
    if (!lines.length) continue;
    const kurang = lines.filter((l) => Number(l.qty) > (saldo.get(l.materialId) ?? 0)).map((l) => nama.get(l.materialId) ?? "Bahan");
    out.set(p.unitId, kurang.length ? { key: "KURANG", label: `Stok kurang: ${kurang.slice(0, 2).join(", ")}${kurang.length > 2 ? ` +${kurang.length - 2}` : ""}`, kurang } : { key: "LENGKAP", label: "Bahan lengkap", kurang: [] });
  }
  return out;
}

async function picPerSlot(prisma, dates) {
  const rows = await prisma.productionStationDayPic.findMany({
    where: { productionDate: { in: dates.map((d) => parseProductionDate(d)) } },
    select: { productionDate: true, stationCode: true, operatorId: true, operator: { select: { active: true, user: { select: { name: true, active: true } } } } },
  });
  return new Map(rows.map((r) => [`${dkey(r.productionDate)}|${r.stationCode}`, { operatorId: r.operatorId, nama: r.operator?.user?.name ?? null, aktif: !!(r.operator?.active && r.operator?.user?.active) }]));
}

const prioritasLabel = (...vals) => (Math.max(0, ...vals.map((v) => storedPriorityLevel(v))) >= 1 ? { key: "HIGH", label: "Tinggi" } : { key: "NORMAL", label: "Normal" });

/** Item kalender (kartu ringkas) untuk rencana V2 dan jadwal Admin pada rentang tanggal. */
async function muatItemKalender(prisma, { from, to, now }) {
  const fromD = parseProductionDate(from); const toD = parseProductionDate(to);
  const [v2Plans, adminRows] = await Promise.all([
    prisma.productionRunPlan.findMany({
      where: { productionDate: { gte: fromD, lte: toD }, status: { not: "CANCELLED" }, run: { status: { not: "CANCELLED" } } },
      select: {
        id: true, productionDate: true, stationCode: true, priority: true, targetDate: true, revision: true, stationSequence: true, operator: { select: { user: { select: { name: true } } } },
        run: { select: { id: true, status: true, unit: { select: UNIT_LITE } } },
      },
    }),
    prisma.productionUnitSchedule.findMany({
      where: { productionDate: { gte: fromD, lte: toD }, status: JADWAL_STATUS.ACTIVE, unit: { status: { notIn: INACTIVE_UNIT }, order: { status: { not: "CANCELLED" } } } },
      select: { id: true, unitId: true, productionDate: true, stationCode: true, revision: true, unit: { select: UNIT_LITE } },
    }),
  ]);
  const units = [...new Map([...v2Plans.map((p) => p.run.unit), ...adminRows.map((a) => a.unit)].filter(Boolean).map((u) => [u.id, u])).values()];
  const unitIds = units.map((u) => u.id);
  const [bahan, evidence] = await Promise.all([bahanReadiness(prisma, unitIds), loadMilestoneEvidence(prisma, unitIds)]);
  const today = todayWib(now); const besok = addDays(today, 1);
  const bangun = (sumber, base) => {
    const { unit } = base;
    const ev = evidence.get(unit.id) || { receivedBasis: null };
    const diterima = !!ev.receivedBasis;
    const efTarget = unit.productionDueAt ? targetKeyOf(unit.productionDueAt) : base.targetKey ?? null;
    const tanggal = dkey(base.productionDate);
    const b = bahan.get(unit.id);
    const flags = [];
    if (!diterima && tanggal <= besok) flags.push({ code: "BELUM_DITERIMA", text: "Belum diterima di workshop" });
    if (b.key !== "LENGKAP" && tanggal <= besok) flags.push({ code: b.key === "KURANG" ? "BAHAN_KURANG" : "BAHAN_BELUM_ADA", text: b.label });
    if (efTarget && efTarget < today && !FINISHED_UNIT.includes(unit.status)) flags.push({ code: "LEWAT_TARGET", text: `Lewat target ${efTarget}` });
    if (base.stationCode && !base.pic && sumber === JADWAL_SUMBER.V2) flags.push({ code: "TANPA_PIC", text: "PIC meja belum ditetapkan" });
    return {
      sumber, sumberLabel: SUMBER_LABEL[sumber], dampak: SUMBER_DAMPAK[sumber], unitId: unit.id, unitCode: unit.unitCode, orderId: unit.order?.id ?? null, orderNumber: unit.order?.orderNumber ?? null,
      customerName: unit.order?.customer?.name ?? null, pekerjaan: (unit.order?.items || []).map((i) => i.layananName).filter(Boolean), ukuran: unit.ukuran ?? null,
      tanggal, meja: base.stationCode ?? null, mejaLabel: base.stationCode ? stationLabel(base.stationCode) : "Tanpa meja", revisi: base.revision, targetSelesai: efTarget, pic: base.pic ?? null,
      prioritas: prioritasLabel(unit.priority, base.priorityNum ?? 0), bahan: b, diterima, perhatian: flags,
      v2: sumber === JADWAL_SUMBER.V2 ? { planId: base.planId, runId: base.runId, runStatus: base.runStatus } : null, urutan: base.stationSequence ?? null,
    };
  };
  const items = [
    ...adminRows.map((a) => bangun(JADWAL_SUMBER.ADMIN, { unit: a.unit, productionDate: a.productionDate, stationCode: a.stationCode, revision: a.revision })),
    ...v2Plans.map((p) => bangun(JADWAL_SUMBER.V2, {
      unit: p.run.unit, productionDate: p.productionDate, stationCode: p.stationCode, revision: p.revision, planId: p.id, runId: p.run.id, runStatus: p.run.status, pic: p.operator?.user?.name ?? null,
      targetKey: p.targetDate ? dkey(p.targetDate) : dkey(p.productionDate), priorityNum: p.priority, stationSequence: p.stationSequence,
    })),
  ];
  return items;
}

/** Kalender mingguan: per hari kapasitas, jumlah terencana (Admin/V2), target selesai, perhatian — tanpa panel besar untuk hari/meja kosong. */
export async function getMinggu(prisma, { start, config = BOARD_DEFAULTS, now = new Date() }) {
  const today = todayWib(now);
  const startKey = mondayOf(parseProductionDate(start) ? start : today);
  const days = weekDays(startKey); const to = days[6];
  const items = await muatItemKalender(prisma, { from: startKey, to, now });
  const pics = await picPerSlot(prisma, days);
  // target selesai per hari: unit AKTIF dengan target pada hari itu (target unit; bila kosong, target rencana V2) — set per unit agar tidak dobel
  const dueUnits = await prisma.unit.findMany({
    where: { productionDueAt: { gte: new Date(`${startKey}T00:00:00+07:00`), lt: new Date(`${addDays(to, 1)}T00:00:00+07:00`) }, status: { notIn: INACTIVE_UNIT }, order: { status: { not: "CANCELLED" }, customer: { isInternalStaff: false, pipelineStage: { not: "SPAM" } } } },
    select: { id: true, productionDueAt: true },
  });
  const targetPerHari = new Map();
  const tandai = (key, unitId) => { if (!targetPerHari.has(key)) targetPerHari.set(key, new Set()); targetPerHari.get(key).add(unitId); };
  for (const u of dueUnits) tandai(targetKeyOf(u.productionDueAt), u.id);
  for (const it of items.filter((i) => i.sumber === JADWAL_SUMBER.V2 && i.targetSelesai && !dueUnits.some((u) => u.id === i.unitId))) tandai(it.targetSelesai, it.unitId);
  const kap = kapasitasHari(config);
  const outDays = days.map((d) => {
    const hari = items.filter((i) => i.tanggal === d);
    const stations = config.stations.map((code) => {
      const its = hari.filter((i) => i.meja === code);
      return { code, label: stationLabel(code), count: its.length, capacity: config.capacityPerStation, pic: pics.get(`${d}|${code}`) ?? null };
    });
    const tanpaMeja = hari.filter((i) => !i.meja).length;
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return {
      date: d, hari: HARI[dow], isToday: d === today, isPast: d < today, isWeekend: dow === 0,
      kapasitas: kap.total, terencana: hari.length, admin: hari.filter((i) => i.sumber === JADWAL_SUMBER.ADMIN).length, v2: hari.filter((i) => i.sumber === JADWAL_SUMBER.V2).length,
      penuh: hari.length >= kap.total, targetSelesai: targetPerHari.get(d)?.size ?? 0, perhatian: hari.filter((i) => i.perhatian.length).length, tanpaMeja, stations,
    };
  });
  return { start: startKey, end: to, today, kapasitas: kap, days: outDays };
}

/** Rincian satu hari: meja + daftar unit (Admin dan V2 pada satu kalender, label berbeda). Meja kosong tetap muncul ringkas (kapasitas tersisa). */
export async function getHari(prisma, { date, config = BOARD_DEFAULTS, now = new Date() }) {
  const key = parseProductionDate(date) ? date : todayWib(now);
  const items = await muatItemKalender(prisma, { from: key, to: key, now });
  const pics = await picPerSlot(prisma, [key]);
  const fotos = await signUnitPhotoUrlsBulk(prisma, [...new Set(items.map((i) => i.unitId))]);
  for (const i of items) i.photoUrl = fotos.get(i.unitId) ?? null;
  const urut = (a, b) => (a.urutan ?? 1e9) - (b.urutan ?? 1e9) || (b.prioritas.key === "HIGH") - (a.prioritas.key === "HIGH") || a.unitCode.localeCompare(b.unitCode);
  return {
    date: key, today: todayWib(now), kapasitas: kapasitasHari(config),
    stations: config.stations.map((code) => ({ code, label: stationLabel(code), capacity: config.capacityPerStation, pic: pics.get(`${key}|${code}`) ?? null, items: items.filter((i) => i.meja === code).sort(urut) })),
    tanpaMeja: items.filter((i) => !i.meja).sort(urut),
  };
}

export function parseAntreanQuery(raw = {}) {
  const tab = ANTREAN_TABS.includes(raw.tab) ? raw.tab : ANTREAN_TAB.SIAP;
  const sort = Object.values(ANTREAN_SORT).includes(raw.sort) ? raw.sort : ANTREAN_SORT.PRIORITAS;
  const page = Math.max(parseInt(raw.page, 10) || 1, 1); const pageSize = Math.min(Math.max(parseInt(raw.pageSize, 10) || 25, 1), 100);
  return { tab, sort, page, pageSize, q: typeof raw.q === "string" ? raw.q.trim().slice(0, 80) : "" };
}

/** Antrean kerja menurut tindakan: Siap dijadwalkan · Butuh keputusan · Menunggu unit tiba (+ Terjadwal/Semua). Setiap kartu membawa ALASAN konkret. */
export async function getAntrean(prisma, { query, config = BOARD_DEFAULTS, now = new Date() }) {
  const { tab, sort, page, pageSize, q } = query;
  const where = {
    status: { notIn: INACTIVE_UNIT },
    order: { status: { not: "CANCELLED" }, customer: { isInternalStaff: false, pipelineStage: { not: "SPAM" } } },
    ...(q ? { OR: [{ unitCode: { contains: q, mode: "insensitive" } }, { order: { orderNumber: { contains: q, mode: "insensitive" } } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }] } : {}),
  };
  const MAX = 1500;
  const units = await prisma.unit.findMany({ where, include: UNIT_INCLUDE, take: MAX + 1, orderBy: { createdAt: "asc" } });
  const truncated = units.length > MAX; const cand = truncated ? units.slice(0, MAX) : units;
  const rows = await perkayaBarisUnit(prisma, cand);
  const unitIds = rows.map((r) => r.id);
  const writerState = resolveProductionWriterState(await loadV2Flags(prisma));
  const [schedules, plans, bahan, activeRuns] = await Promise.all([
    prisma.productionUnitSchedule.findMany({ where: { unitId: { in: unitIds } } }), // semua status: revisi dibutuhkan walau jadwal sudah dikeluarkan (CLEARED)
    prisma.productionRunPlan.findMany({ where: { run: { unitId: { in: unitIds }, status: { notIn: TERMINAL_RUN } }, productionDate: { not: null }, status: { not: "CANCELLED" } }, select: { productionDate: true, stationCode: true, run: { select: { unitId: true } } } }),
    bahanReadiness(prisma, unitIds),
    prisma.productionRun.findMany({ where: { unitId: { in: unitIds }, status: { notIn: TERMINAL_RUN } }, select: { unitId: true } }),
  ]);
  const runUnits = new Set(activeRuns.map((r) => r.unitId));
  const schedBy = new Map(schedules.map((s) => [s.unitId, s])); const planBy = new Map(plans.map((p) => [p.run.unitId, p]));
  const complaintRank = (r) => r.priorityDisplay?.rank ?? 0;
  const all = rows.map((r) => {
    const pkr = rujukanPkrDariOrder(r.order, { unit: r });
    const diterima = r.adopsi.posisi?.key === "DI_WORKSHOP";
    const schAny = schedBy.get(r.id); const sch = schAny?.status === JADWAL_STATUS.ACTIVE ? schAny : null; const v2 = planBy.get(r.id);
    const v2Owned = runUnits.has(r.id) && isProductionWriterEnabledFor(writerState, r.id); // dikelola V2: jadwal lewat rencana V2 (jalur V2)
    const terjadwal = !!sch || !!v2;
    const orderEf = statusOrderEfektif(r.order, r);
    let pg = penghalangJadwal({ unitStatus: r.status, orderStatus: orderEf, isInternal: false, customerStage: null, pkrKurang: pkr && !pkr.lengkap ? { nomor: pkr.nomor, kurang: pkr.kurang } : null, v2Owned: false, runOutsideCohort: runUnits.has(r.id) && !v2Owned });
    if (!pg && diterima && orderEf === "PICKUP") pg = { code: "ORDER_MASIH_PENGAMBILAN", message: "Unit sudah diterima di workshop, tetapi status order masih Pengambilan.", next: "Ubah status order ke Diproses di Status Produksi, lalu jadwalkan." };
    const tabUnit = tabAntrean({ terjadwal, penghalang: pg, diterima });
    const jadwal = sch ? { sumber: JADWAL_SUMBER.ADMIN, tanggal: dkey(sch.productionDate), meja: sch.stationCode, revisi: sch.revision } : v2 ? { sumber: JADWAL_SUMBER.V2, tanggal: dkey(v2.productionDate), meja: v2.stationCode, revisi: null } : null;
    const targetKey = r.productionDueAt ? targetKeyOf(r.productionDueAt) : null;
    const alasan = terjadwal ? `Dijadwalkan ${jadwal.tanggal}${jadwal.meja ? ` · ${stationLabel(jadwal.meja)}` : ""}` : pg ? pg.message : diterima ? "Sudah diterima di workshop — siap dijadwalkan." : `${r.adopsi.posisi?.label ?? "Belum diterima"} — bisa dijadwalkan lebih awal; kerja menunggu unit tiba.`;
    const next = terjadwal ? null : pg ? pg.next : null;
    return {
      unitId: r.id, unitCode: r.unitCode, orderId: r.orderId, orderNumber: r.order?.orderNumber ?? null, customerName: r.order?.customer?.name ?? null,
      pekerjaan: (r.order?.items || []).map((i) => i.layananName).filter(Boolean), ukuran: r.ukuran ?? null, tab: tabUnit, alasan, tindakanBerikut: next,
      boleh: !terjadwal && (!pg || false), perluKeputusan: !!pg, posisi: { key: r.adopsi.posisi?.key, label: r.adopsi.posisi?.label }, diterima,
      orderStatus: r.orderStatusDisplay ?? null, targetSelesai: targetKey, prioritas: { ...r.priorityDisplay, key: r.priorityDisplay?.key }, pic: r.adopsi.pic?.nama ?? null, meja: r.adopsi.meja ?? null,
      bahan: bahan.get(r.id), jadwal, jalur: v2Owned ? "V2" : "ADMIN", revisiJadwal: schAny?.revision ?? 0, v2: v2Owned || !!v2, unitCas: { priority: r.priority, productionDueAt: r.productionDueAt }, _rank: complaintRank(r), _created: new Date(r.createdAt).getTime(),
    };
  });
  const counts = Object.fromEntries(ANTREAN_TABS.map((t) => [t, t === ANTREAN_TAB.SEMUA ? all.length : all.filter((x) => x.tab === t).length]));
  let list = tab === ANTREAN_TAB.SEMUA ? all : all.filter((x) => x.tab === tab);
  const byTarget = (a, b) => (a.targetSelesai ?? "9999") < (b.targetSelesai ?? "9999") ? -1 : (a.targetSelesai ?? "9999") > (b.targetSelesai ?? "9999") ? 1 : 0;
  list = list.sort(sort === ANTREAN_SORT.TARGET ? (a, b) => byTarget(a, b) || a._created - b._created : sort === ANTREAN_SORT.TERLAMA ? (a, b) => a._created - b._created : (a, b) => b._rank - a._rank || byTarget(a, b) || a._created - b._created);
  const total = list.length; const offset = (page - 1) * pageSize; const pageItems = list.slice(offset, offset + pageSize);
  const photos = await signUnitPhotoUrlsBulk(prisma, pageItems.map((i) => i.unitId));
  return { tab, sort, q, page, pageSize, total, hasMore: offset + pageItems.length < total, truncated, counts, items: pageItems.map(({ _rank, _created, ...i }) => ({ ...i, photoUrl: photos.get(i.unitId) ?? null })) };
}
