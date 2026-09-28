// Command owner custody unit fisik Delivery <-> Gudang (Production Workshop + Warehouse V2, slice P1–P2).
// SATU-SATUNYA penulis `unit_custody_handoffs_v2` (lihat scripts/production-delivery-v2/audit-custody-writers.js).
//
// Kontrak:
//  - Writer di balik flag `production_v2_writer` dengan cohort `config.unitIds` (fail-closed: unit di luar cohort = V1-only).
//  - Penawaran dibuat DI DALAM transaksi V1 pickup selesai / pengiriman gagal, sehingga V1 dan V2 commit atau batal bersama.
//  - Setiap command: v2_commands (idempotency) + perubahan state + domain_outbox + activity audit dalam satu transaksi.
//  - Accept/reject: kunci baris handoff (SELECT ... FOR UPDATE), status harus OFFERED, revisi harus cocok.
//  - Perilaku V1 tidak berubah: Unit.status tetap ditulis oleh jalur V1 (pickup selesai -> RECEIVED).
import { createHash, randomUUID } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { isUnitPathDoneInTx, markUnitReadyForDeliveryInTx } from "./unitStageEngine.js";
import { assertNoOpenRunException, assertRunConsistent } from "./productionRunGuards.js";
import {
  isProductionWriterEnabledFor, loadV2Flags, productionWriterEnabledForUnit, resolveProductionWriterState,
} from "./v2FeatureFlags.js";

export const CUSTODY_DIRECTION = Object.freeze({ INBOUND: "INBOUND", RETURN: "RETURN", FINISHED_GOODS: "FINISHED_GOODS" });
const ACTIVE_STATUSES = ["OFFERED", "ACCEPTED"];
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,128}$/;

// Jenis lokasi yang sah sebagai tujuan custody. Tanpa StorageLocation valid, unit tidak boleh diterima.
export const ALLOWED_LOCATION_TYPES = Object.freeze({
  INBOUND: Object.freeze(["RECEIVING_AREA", "WIP_AREA", "QUARANTINE_AREA"]),
  RETURN: Object.freeze(["RETURN_AREA", "FINISHED_GOODS_AREA", "DISPATCH_AREA", "QUARANTINE_AREA"]),
  // P6: barang jadi dari Produksi -> Gudang barang jadi / area dispatch.
  FINISHED_GOODS: Object.freeze(["FINISHED_GOODS_AREA", "DISPATCH_AREA"]),
});

function custodyError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}

const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

export function assertIdempotencyKey(key) {
  if (!key || !IDEMPOTENCY_KEY.test(key)) {
    throw custodyError("Idempotency-Key wajib diisi (12-128 karakter)", 400, "IDEMPOTENCY_KEY_INVALID");
  }
}

export function assertExpectedRevision(value) {
  const revision = Number(value);
  if (value == null || value === "" || !Number.isInteger(revision) || revision < 1) {
    throw custodyError("expectedRevision wajib diisi (angka bulat positif)", 400, "EXPECTED_REVISION_REQUIRED");
  }
  return revision;
}

// Aturan transisi murni (diuji unit): hanya OFFERED yang dapat diterima/ditolak.
export function assertCanDecide(handoff, expectedRevision) {
  if (handoff.status !== "OFFERED") {
    throw custodyError(`Handoff sudah berstatus ${handoff.status}; tidak dapat diproses lagi`, 409, "CUSTODY_NOT_OFFERED", { status: handoff.status, revision: handoff.revision });
  }
  if (handoff.revision !== expectedRevision) {
    throw custodyError(`Revisi handoff berubah: diharapkan ${expectedRevision}, sekarang ${handoff.revision}. Muat ulang antrean.`, 409, "CUSTODY_REVISION_CONFLICT", { revision: handoff.revision });
  }
}

export function assertLocationAllowed(direction, location) {
  if (!location || location.active !== true) {
    throw custodyError("Lokasi penyimpanan tidak valid atau sudah nonaktif", 422, "CUSTODY_LOCATION_INVALID");
  }
  if (!ALLOWED_LOCATION_TYPES[direction].includes(location.locationType)) {
    throw custodyError(`Lokasi ${location.code} (${location.locationType}) tidak sesuai untuk serah-terima ${direction === "INBOUND" ? "unit masuk" : direction === "FINISHED_GOODS" ? "barang jadi" : "unit kembali"}`, 422, "CUSTODY_LOCATION_TYPE_INVALID");
  }
}

async function beginCommand(tx, { actor, idempotencyKey, commandType, aggregateId, requestHash, expectedRevision = null }) {
  return tx.v2Command.create({
    data: {
      domain: "WAREHOUSE", actorId: actor, idempotencyKey, commandType, aggregateType: "UnitCustodyHandoff",
      aggregateId, expectedRevision, requestHash,
    },
  });
}

async function finishCommand(tx, command, appliedRevision, response) {
  await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision, response, completedAt: new Date() } });
}

async function outbox(tx, { eventType, aggregateType = "UnitCustodyHandoff", aggregateId, revision, dedupeKey, payload, domain = "WAREHOUSE" }) {
  return tx.domainOutbox.create({
    data: { domain, eventType, aggregateType, aggregateId, aggregateRevision: revision, dedupeKey, payload },
  });
}

// ---------------------------------------------------------------------------
// Penawaran (dipanggil di dalam transaksi V1 pickup selesai / delivery gagal)
// ---------------------------------------------------------------------------
async function offerOne(tx, { direction, unitId, jobId, actorId }) {
  await lockRowForUpdate(tx, "units", unitId);
  const existing = await tx.unitCustodyHandoff.findUnique({ where: { deliveryJobId_unitId: { deliveryJobId: jobId, unitId } } });
  if (existing) return { handoff: existing, replayed: true };

  const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, orderId: true } });
  if (!unit) throw custodyError("Unit tidak ditemukan", 404, "UNIT_NOT_FOUND");

  // Handoff aktif sebelumnya (arah sama) tergantikan; riwayat dipertahankan sebagai SUPERSEDED.
  const active = await tx.unitCustodyHandoff.findMany({ where: { unitId, direction, status: { in: ACTIVE_STATUSES } } });
  for (const old of active) {
    const nextRevision = old.revision + 1;
    await tx.unitCustodyHandoff.update({
      where: { id: old.id },
      data: { status: "SUPERSEDED", revision: nextRevision, reason: `Digantikan oleh handoff untuk job ${jobId}` },
    });
    await outbox(tx, {
      eventType: "warehouse.custody.superseded", aggregateId: old.id, revision: nextRevision,
      dedupeKey: `warehouse-custody-superseded:${old.id}:${nextRevision}`,
      payload: { handoffId: old.id, unitId, orderId: unit.orderId, direction, revision: nextRevision, occurredAt: new Date().toISOString() },
    });
  }

  const handoffId = randomUUID();
  const actor = actorId || "SYSTEM";
  const commandType = direction === "INBOUND" ? "OFFER_INBOUND_CUSTODY" : "OFFER_RETURN_CUSTODY";
  const command = await beginCommand(tx, {
    actor, idempotencyKey: `internal:${commandType}:${jobId}:${unitId}`, commandType, aggregateId: handoffId,
    requestHash: hash({ commandType, jobId, unitId }),
  });
  const handoff = await tx.unitCustodyHandoff.create({
    data: { id: handoffId, unitId, deliveryJobId: jobId, direction, status: "OFFERED", offeredById: actorId || null, revision: 1, commandId: command.id },
  });
  await outbox(tx, {
    eventType: "warehouse.custody.offered", aggregateId: handoffId, revision: 1, dedupeKey: `warehouse-custody-offered:${handoffId}`,
    payload: { handoffId, unitId, orderId: unit.orderId, deliveryJobId: jobId, direction, revision: 1, occurredAt: new Date().toISOString(), actorId: actorId || null },
  });
  await recordActivity(tx, {
    entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.CUSTODY_OFFERED, actorId: actorId || null,
    metadata: { unitCode: unit.unitCode, direction, handoffId, jobId },
  });
  await finishCommand(tx, command, 1, { handoffId, status: "OFFERED", revision: 1 });
  return { handoff, replayed: false };
}

// Mengembalikan handoff yang dibuat (kosong bila writer OFF / unit di luar cohort => perilaku V1 murni).
export async function offerUnitCustody(tx, { direction, unitIds, jobId, actorId = null }) {
  if (!CUSTODY_DIRECTION[direction] || direction === "FINISHED_GOODS") throw new TypeError("direction custody tidak dikenal (barang jadi memakai offerFinishedGoodsCustodyInTx)");
  if (!jobId) throw new TypeError("jobId wajib diisi");
  const ids = [...new Set((unitIds || []).filter(Boolean))].sort();
  if (!ids.length) return [];
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  const results = [];
  for (const unitId of ids) {
    if (!isProductionWriterEnabledFor(state, unitId)) continue;
    results.push(await offerOne(tx, { direction, unitId, jobId, actorId }));
  }
  return results;
}

// ---------------------------------------------------------------------------
// P6 — Custody BARANG JADI (Produksi -> Gudang). Penawaran dibuat command Production V2 (P5: tahap `finished` selesai; P6: penawaran ulang
// setelah penolakan) di TRANSAKSI-nya sendiri. Pemanggil SUDAH mengunci unit lalu run (urutan yang sama dengan P1–P5). Syarat handoff:
// run ACTIVE di fase HANDOFF (ACTIVE), QC fase COMPLETED dengan inspeksi terakhir PASS/OVERRIDDEN(WAIVED), seluruh tahap jalur unit
// selesai, unit IN_PRODUCTION, tidak ada exception OPEN, dan belum ada penawaran barang jadi yang menunggu.
// ---------------------------------------------------------------------------
export async function offerFinishedGoodsCustodyInTx(tx, { runId, actorId = null }) {
  const run = await tx.productionRun.findUnique({
    where: { id: runId },
    include: { phases: true, unit: { select: { id: true, unitCode: true, orderId: true, status: true } }, inspections: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!run) throw custodyError("Production Run tidak ditemukan", 404, "CUSTODY_RUN_NOT_FOUND");
  if (run.status !== "ACTIVE") throw custodyError("Production Run tidak aktif; handoff barang jadi tidak dapat dibuat", 409, "CUSTODY_RUN_NOT_ACTIVE", { status: run.status });
  assertRunConsistent(run, run.unit);
  await assertNoOpenRunException(tx, run.id);
  const phase = (name) => run.phases.find((p) => p.phase === name);
  if (run.currentPhase !== "HANDOFF" || phase("HANDOFF")?.status !== "ACTIVE") {
    throw custodyError("Handoff barang jadi hanya dapat dibuat saat run berada di fase Handoff", 409, "CUSTODY_RUN_NOT_IN_HANDOFF", { currentPhase: run.currentPhase });
  }
  const latest = run.inspections[0];
  if (phase("QC")?.status !== "COMPLETED" || !latest || !["PASS", "OVERRIDDEN"].includes(latest.result)) {
    throw custodyError("Handoff barang jadi wajib didahului QC lulus (atau QC di-waive oleh pihak berwenang)", 409, "CUSTODY_QC_NOT_SATISFIED");
  }
  if (!(await isUnitPathDoneInTx(tx, run.unitId))) {
    throw custodyError("Seluruh tahap produksi (termasuk tahap setelah QC) harus selesai sebelum handoff barang jadi", 409, "CUSTODY_PROCESS_NOT_FINISHED");
  }
  const waiting = await tx.unitCustodyHandoff.findFirst({ where: { unitId: run.unitId, direction: "FINISHED_GOODS", status: "OFFERED" }, select: { id: true } });
  if (waiting) throw custodyError("Sudah ada penawaran barang jadi yang menunggu keputusan Gudang", 409, "CUSTODY_ALREADY_OFFERED", { handoffId: waiting.id });

  // Handoff barang jadi lama yang sudah ACCEPTED (siklus produksi sebelumnya) digantikan; riwayat dipertahankan sebagai SUPERSEDED.
  const previous = await tx.unitCustodyHandoff.findMany({ where: { unitId: run.unitId, direction: "FINISHED_GOODS", status: { in: ACTIVE_STATUSES } } });
  for (const old of previous) {
    const nextRevision = old.revision + 1;
    await tx.unitCustodyHandoff.update({ where: { id: old.id }, data: { status: "SUPERSEDED", revision: nextRevision, reason: `Digantikan oleh handoff barang jadi run ${run.id}` } });
    await outbox(tx, {
      eventType: "warehouse.custody.superseded", aggregateId: old.id, revision: nextRevision, dedupeKey: `warehouse-custody-superseded:${old.id}:${nextRevision}`,
      payload: { handoffId: old.id, unitId: run.unitId, orderId: run.unit.orderId, direction: "FINISHED_GOODS", revision: nextRevision, occurredAt: new Date().toISOString() },
    });
  }

  const cycle = (await tx.unitCustodyHandoff.count({ where: { productionRunId: run.id, direction: "FINISHED_GOODS" } })) + 1;
  const handoffId = randomUUID();
  const actor = actorId || "SYSTEM";
  const command = await beginCommand(tx, {
    actor, idempotencyKey: `internal:OFFER_FINISHED_GOODS_CUSTODY:${run.id}:${cycle}`, commandType: "OFFER_FINISHED_GOODS_CUSTODY", aggregateId: handoffId,
    requestHash: hash({ commandType: "OFFER_FINISHED_GOODS_CUSTODY", runId: run.id, cycle }),
  });
  const handoff = await tx.unitCustodyHandoff.create({
    data: { id: handoffId, unitId: run.unitId, deliveryJobId: null, direction: "FINISHED_GOODS", status: "OFFERED", productionRunId: run.id, offeredById: actorId || null, revision: 1, commandId: command.id },
  });
  const qcBasis = latest.result === "OVERRIDDEN" ? "QC_WAIVED" : "QC_PASS";
  await outbox(tx, {
    eventType: "warehouse.custody.offered", aggregateId: handoffId, revision: 1, dedupeKey: `warehouse-custody-offered:${handoffId}`,
    payload: { handoffId, unitId: run.unitId, orderId: run.unit.orderId, productionRunId: run.id, direction: "FINISHED_GOODS", qcBasis, revision: 1, occurredAt: new Date().toISOString(), actorId: actorId || null },
  });
  await recordActivity(tx, {
    entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.CUSTODY_OFFERED, actorId: actorId || null,
    metadata: { unitCode: run.unit.unitCode, direction: "FINISHED_GOODS", handoffId, runId: run.id, qcBasis },
  });
  await finishCommand(tx, command, 1, { handoffId, status: "OFFERED", revision: 1 });
  return { handoff, qcBasis };
}

// Pembatalan penawaran barang jadi yang masih menunggu (run dibatalkan / ditutup lewat rekonsiliasi). Pemanggil SUDAH mengunci baris handoff
// (handoff -> unit -> run) — riwayat dipertahankan sebagai CANCELLED, tidak dihapus.
export async function cancelOfferedFinishedGoodsCustodyInTx(tx, { unitId, actor, reason }) {
  const open = await tx.unitCustodyHandoff.findMany({ where: { unitId, direction: "FINISHED_GOODS", status: "OFFERED" }, include: { unit: { select: { unitCode: true } } } });
  const cancelled = [];
  for (const handoff of open) {
    const revision = handoff.revision + 1;
    const now = new Date();
    await tx.unitCustodyHandoff.update({ where: { id: handoff.id }, data: { status: "CANCELLED", revision, cancelledById: actor, cancelledAt: now, reason } });
    await outbox(tx, {
      eventType: "warehouse.custody.cancelled", aggregateId: handoff.id, revision, dedupeKey: `warehouse-custody-cancelled:${handoff.id}:${revision}`,
      payload: { handoffId: handoff.id, unitId, direction: "FINISHED_GOODS", revision, reason, occurredAt: now.toISOString(), actorId: actor },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.CUSTODY_ROLLED_BACK, actorId: actor === "SYSTEM" ? null : actor,
      metadata: { unitCode: handoff.unit.unitCode, direction: "FINISHED_GOODS", handoffId: handoff.id, reason },
    });
    cancelled.push(handoff.id);
  }
  return cancelled;
}

// Kunci unit lalu run (urutan P1–P5; handoff sudah dikunci decide()) dan validasi run untuk keputusan Gudang atas barang jadi.
async function prepareFinishedGoodsDecision(tx, handoff) {
  if (!handoff.productionRunId) throw custodyError("Handoff barang jadi tidak terhubung ke Production Run", 409, "CUSTODY_RUN_MISSING");
  await lockRowForUpdate(tx, "units", handoff.unitId);
  await lockRowForUpdate(tx, "production_runs_v2", handoff.productionRunId);
  const run = await tx.productionRun.findUnique({ where: { id: handoff.productionRunId }, include: { phases: true, unit: { select: { id: true, unitCode: true, orderId: true, status: true } } } });
  if (!run || run.status !== "ACTIVE") throw custodyError("Production Run tidak aktif; keputusan Gudang atas barang jadi tidak dapat diproses", 409, "CUSTODY_RUN_NOT_ACTIVE", { status: run?.status ?? null });
  assertRunConsistent(run, run.unit);
  await assertNoOpenRunException(tx, run.id);
  const handoffPhase = run.phases.find((p) => p.phase === "HANDOFF");
  if (run.currentPhase !== "HANDOFF" || handoffPhase?.status !== "ACTIVE") {
    throw custodyError("Production Run tidak berada di fase Handoff", 409, "CUSTODY_RUN_NOT_IN_HANDOFF", { currentPhase: run.currentPhase });
  }
  return run;
}

// ---------------------------------------------------------------------------
// Production Intake V2 (dibuka saat custody INBOUND diterima)
// ---------------------------------------------------------------------------
function productionKind(category, hasStageLogs) {
  if (category === "SEWA") return "FULFILLMENT_ONLY";
  if (category === "BARU") return hasStageLogs ? "NEW_PRODUCT" : "FULFILLMENT_ONLY";
  return "RESTORATION";
}

const PHASES = ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"];

export async function openProductionIntakeV2(tx, { unitId, actorId = null }) {
  await lockRowForUpdate(tx, "units", unitId);
  const now = new Date();
  const active = await tx.productionRun.findFirst({ where: { unitId, status: { notIn: ["COMPLETED", "CANCELLED"] } }, orderBy: { createdAt: "desc" } });
  if (active) {
    if (active.status !== "PENDING_ARRIVAL") return { run: active, opened: false };
    const revision = active.revision + 1;
    const run = await tx.productionRun.update({
      where: { id: active.id }, data: { status: "ACTIVE", currentPhase: "INTAKE", startedAt: active.startedAt || now, revision },
    });
    await tx.productionPhaseRun.upsert({
      where: { runId_phase: { runId: run.id, phase: "INTAKE" } },
      create: { runId: run.id, phase: "INTAKE", status: "ACTIVE", sequence: 1, startedAt: now },
      update: { status: "ACTIVE", startedAt: now },
    });
    await outbox(tx, {
      domain: "PRODUCTION", eventType: "production.run.opened", aggregateType: "ProductionRun", aggregateId: run.id, revision,
      dedupeKey: `production-run-opened:${run.id}:${revision}`,
      payload: { runId: run.id, unitId, kind: run.kind, revision, occurredAt: now.toISOString(), actorId },
    });
    return { run, opened: true };
  }

  const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { order: { select: { category: true } }, stageLogs: { select: { id: true }, take: 1 } } });
  const last = await tx.productionRun.findFirst({ where: { unitId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const kind = last ? "REWORK" : productionKind(unit?.order?.category, (unit?.stageLogs?.length || 0) > 0);
  const notApplicable = kind === "FULFILLMENT_ONLY" ? new Set(["DIAGNOSIS", "PROCESS", "QC"]) : new Set();
  const run = await tx.productionRun.create({
    data: {
      unitId, kind, origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "INTAKE", startedAt: now, revision: 1, parentRunId: last?.id || null,
      phases: {
        create: PHASES.map((phase, index) => ({
          phase, sequence: index + 1,
          status: phase === "INTAKE" ? "ACTIVE" : notApplicable.has(phase) ? "NOT_APPLICABLE" : "NOT_STARTED",
          reason: notApplicable.has(phase) ? "Fulfillment tanpa proses restorasi" : null,
          startedAt: phase === "INTAKE" ? now : null,
        })),
      },
    },
  });
  await outbox(tx, {
    domain: "PRODUCTION", eventType: "production.run.opened", aggregateType: "ProductionRun", aggregateId: run.id, revision: 1,
    dedupeKey: `production-run-opened:${run.id}:1`,
    payload: { runId: run.id, unitId, kind, revision: 1, occurredAt: now.toISOString(), actorId },
  });
  return { run, opened: true };
}

// ---------------------------------------------------------------------------
// Keputusan Gudang: terima / tolak
// ---------------------------------------------------------------------------
async function decide(prisma, { handoffId, actorId, idempotencyKey, expectedRevision, commandType, payload, apply }) {
  if (!handoffId) throw custodyError("handoffId wajib diisi", 400, "HANDOFF_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ handoffId, commandType, expectedRevision: revisionExpected, ...payload });

  return prisma.$transaction(async (tx) => {
    // Kunci baris handoff LEBIH DULU: dua petugas yang menerima handoff yang sama diserialkan di sini.
    await lockRowForUpdate(tx, "unit_custody_handoffs_v2", handoffId);
    const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw custodyError("Idempotency-Key dipakai untuk payload berbeda", 409, "IDEMPOTENCY_CONFLICT");
      if (replay.status !== "APPLIED") throw custodyError("Command masih diproses", 409, "COMMAND_IN_PROGRESS");
      return { replayed: true, ...replay.response };
    }
    const handoff = await tx.unitCustodyHandoff.findUnique({
      where: { id: handoffId }, include: { unit: { select: { id: true, unitCode: true, orderId: true } } },
    });
    if (!handoff) throw custodyError("Handoff custody tidak ditemukan", 404, "CUSTODY_NOT_FOUND");
    if (!await productionWriterEnabledForUnit(tx, handoff.unitId)) {
      throw custodyError("Custody V2 tidak aktif untuk unit ini; gunakan alur V1", 503, "CUSTODY_WRITER_OFF");
    }
    assertCanDecide(handoff, revisionExpected);
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType, aggregateId: handoffId, requestHash, expectedRevision: revisionExpected });
    const response = await apply(tx, { handoff, actor, actorId, command });
    await finishCommand(tx, command, response.revision, response);
    return { replayed: false, ...response };
  });
}

export async function acceptUnitCustody(prisma, { handoffId, actorId, idempotencyKey, expectedRevision, locationId }) {
  if (!locationId) throw custodyError("Lokasi penyimpanan wajib dipilih", 400, "CUSTODY_LOCATION_REQUIRED");
  return decide(prisma, {
    handoffId, actorId, idempotencyKey, expectedRevision, commandType: "ACCEPT_CUSTODY", payload: { locationId },
    apply: async (tx, { handoff, actorId: actor }) => {
      const location = await tx.storageLocation.findUnique({ where: { id: locationId } });
      assertLocationAllowed(handoff.direction, location);
      const now = new Date();
      let run = null;
      // Barang jadi (P6): validasi + kunci run SEBELUM menulis apa pun; efek ke run/unit di bawah, setelah lokasi diproyeksikan.
      const finishedRun = handoff.direction === "FINISHED_GOODS" ? await prepareFinishedGoodsDecision(tx, handoff) : null;
      if (handoff.direction === "INBOUND") run = (await openProductionIntakeV2(tx, { unitId: handoff.unitId, actorId: actor })).run;
      const revision = handoff.revision + 1;
      await tx.unitCustodyHandoff.update({
        where: { id: handoff.id },
        data: { status: "ACCEPTED", revision, acceptedById: actor || null, acceptedAt: now, locationId, productionRunId: run?.id ?? handoff.productionRunId ?? null },
      });
      // Proyeksi legacy V1 (ProductionUnitDetail.jsx "Lokasi Simpan") dari StorageLocation kanonis — locationId tetap
      // source of truth; kolom teks bebas ini HANYA disalin di sini, tidak pernah diterima langsung dari client.
      // Berjalan sekali per command (idempotency di atas mencegah replay memanggil apply() lagi).
      await tx.unit.update({ where: { id: handoff.unitId }, data: { storageLocation: location.code } });
      let completedRunRevision = null;
      if (finishedRun) {
        // Urutan: lokasi (legacy + kanonis) sudah tertulis -> fase HANDOFF selesai -> run COMPLETED -> BARU unit READY_FOR_DELIVERY.
        await tx.productionPhaseRun.update({ where: { runId_phase: { runId: finishedRun.id, phase: "HANDOFF" } }, data: { status: "COMPLETED", completedAt: now } });
        completedRunRevision = finishedRun.revision + 1;
        await tx.productionRun.update({ where: { id: finishedRun.id }, data: { status: "COMPLETED", completedAt: now, revision: completedRunRevision } });
        await markUnitReadyForDeliveryInTx(tx, handoff.unitId);
        await outbox(tx, {
          domain: "PRODUCTION", eventType: "production.run.completed", aggregateType: "ProductionRun", aggregateId: finishedRun.id, revision: completedRunRevision,
          dedupeKey: `production-run-completed:${finishedRun.id}:${completedRunRevision}`,
          payload: { runId: finishedRun.id, unitId: handoff.unitId, handoffId: handoff.id, locationId, revision: completedRunRevision, occurredAt: now.toISOString(), actorId: actor || null },
        });
        await recordActivity(tx, {
          entityType: "unit", entityId: handoff.unitId, eventType: EVENT_TYPES.PRODUCTION_RUN_COMPLETED, actorId: actor || null,
          metadata: { unitCode: handoff.unit.unitCode, runId: finishedRun.id, locationCode: location.code },
        });
      }
      await outbox(tx, {
        eventType: "warehouse.custody.accepted", aggregateId: handoff.id, revision, dedupeKey: `warehouse-custody-accepted:${handoff.id}:${revision}`,
        payload: { handoffId: handoff.id, unitId: handoff.unitId, orderId: handoff.unit.orderId, direction: handoff.direction, locationId, productionRunId: run?.id ?? null, revision, occurredAt: now.toISOString(), actorId: actor || null },
      });
      await recordActivity(tx, {
        entityType: "unit", entityId: handoff.unitId, eventType: EVENT_TYPES.CUSTODY_ACCEPTED, actorId: actor || null,
        metadata: { unitCode: handoff.unit.unitCode, direction: handoff.direction, handoffId: handoff.id, locationCode: location.code },
      });
      return { handoffId: handoff.id, unitId: handoff.unitId, status: "ACCEPTED", revision, locationId, productionRunId: run?.id ?? handoff.productionRunId ?? null, ...(finishedRun ? { runStatus: "COMPLETED", runRevision: completedRunRevision, unitStatus: "READY_FOR_DELIVERY" } : {}) };
    },
  });
}

export async function rejectUnitCustody(prisma, { handoffId, actorId, idempotencyKey, expectedRevision, reason }) {
  const cleaned = String(reason ?? "").trim();
  if (cleaned.length < 3) throw custodyError("Alasan penolakan wajib diisi (minimal 3 karakter)", 400, "CUSTODY_REASON_REQUIRED");
  return decide(prisma, {
    handoffId, actorId, idempotencyKey, expectedRevision, commandType: "REJECT_CUSTODY", payload: { reason: cleaned },
    apply: async (tx, { handoff, actorId: actor }) => {
      const now = new Date();
      const finishedRun = handoff.direction === "FINISHED_GOODS" ? await prepareFinishedGoodsDecision(tx, handoff) : null;
      const revision = handoff.revision + 1;
      await tx.unitCustodyHandoff.update({
        where: { id: handoff.id },
        data: { status: "REJECTED", revision, rejectedById: actor || null, rejectedAt: now, reason: cleaned },
      });
      let returnedRunRevision = null;
      if (finishedRun) {
        // Kasus kembali ke Production: fase HANDOFF BLOCKED (alasan tercatat), run tetap ACTIVE. Tindakan koreksi lewat command Production
        // (tawarkan ulang / rework) — histori penolakan tetap di baris handoff ini.
        await tx.productionPhaseRun.update({ where: { runId_phase: { runId: finishedRun.id, phase: "HANDOFF" } }, data: { status: "BLOCKED", reason: `Ditolak Gudang: ${cleaned}` } });
        returnedRunRevision = finishedRun.revision + 1;
        await tx.productionRun.update({ where: { id: finishedRun.id }, data: { revision: returnedRunRevision } });
        await outbox(tx, {
          domain: "PRODUCTION", eventType: "production.handoff.rejected", aggregateType: "ProductionRun", aggregateId: finishedRun.id, revision: returnedRunRevision,
          dedupeKey: `production-handoff-rejected:${finishedRun.id}:${returnedRunRevision}`,
          payload: { runId: finishedRun.id, unitId: handoff.unitId, handoffId: handoff.id, reason: cleaned, revision: returnedRunRevision, occurredAt: now.toISOString(), actorId: actor || null },
        });
      }
      await outbox(tx, {
        eventType: "warehouse.custody.rejected", aggregateId: handoff.id, revision, dedupeKey: `warehouse-custody-rejected:${handoff.id}:${revision}`,
        payload: { handoffId: handoff.id, unitId: handoff.unitId, orderId: handoff.unit.orderId, direction: handoff.direction, revision, occurredAt: now.toISOString(), actorId: actor || null },
      });
      await recordActivity(tx, {
        entityType: "unit", entityId: handoff.unitId, eventType: EVENT_TYPES.CUSTODY_REJECTED, actorId: actor || null,
        metadata: { unitCode: handoff.unit.unitCode, direction: handoff.direction, handoffId: handoff.id, reason: cleaned },
      });
      return { handoffId: handoff.id, unitId: handoff.unitId, status: "REJECTED", revision, reason: cleaned, ...(finishedRun ? { runRevision: returnedRunRevision, runPhase: "HANDOFF", returnedToProduction: true } : {}) };
    },
  });
}

// ---------------------------------------------------------------------------
// Rollback writer: membatalkan penawaran OFFERED milik cohort saat writer dimatikan (dokumentasi lengkap di
// docs/PRODUCTION-WAREHOUSE-V2-P1P2-INBOUND-CUSTODY.md § Rollback). Owner command, idempoten per (actorId, idempotencyKey)
// DAN aman diulang dengan key berbeda — hanya menyentuh baris yang MASIH OFFERED (no-op untuk sisanya).
// Tidak menghapus histori: transisi ke CANCELLED, offeredById/At tetap ada. Setelah rollback, handoff tidak lagi
// muncul di antrean OFFERED — reaktivasi writer tidak menampilkannya sebagai pekerjaan baru.
export async function rollbackUnitCustodyOffers(prisma, { unitIds, actorId, idempotencyKey, reason }) {
  assertIdempotencyKey(idempotencyKey);
  const ids = [...new Set((unitIds || []).filter(Boolean))].sort();
  if (!ids.length) throw custodyError("unitIds wajib diisi", 400, "CUSTODY_ROLLBACK_UNITS_REQUIRED");
  const cleaned = String(reason ?? "").trim();
  if (cleaned.length < 3) throw custodyError("Alasan rollback wajib diisi (minimal 3 karakter)", 400, "CUSTODY_ROLLBACK_REASON_REQUIRED");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "ROLLBACK_CUSTODY_OFFERS", unitIds: ids, reason: cleaned });

  return prisma.$transaction(async (tx) => {
    const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw custodyError("Idempotency-Key dipakai untuk payload berbeda", 409, "IDEMPOTENCY_CONFLICT");
      if (replay.status !== "APPLIED") throw custodyError("Command masih diproses", 409, "COMMAND_IN_PROGRESS");
      return { replayed: true, ...replay.response };
    }
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "ROLLBACK_CUSTODY_OFFERS", aggregateId: idempotencyKey, requestHash });

    const cancelled = [];
    for (const unitId of ids) {
      // Kunci baris Unit dulu supaya tidak berebut dengan offerUnitCustody/accept/reject yang sedang berjalan untuk unit ini.
      await lockRowForUpdate(tx, "units", unitId);
      const open = await tx.unitCustodyHandoff.findMany({ where: { unitId, status: "OFFERED" }, include: { unit: { select: { unitCode: true } } } });
      for (const handoff of open) {
        const revision = handoff.revision + 1;
        const now = new Date();
        await tx.unitCustodyHandoff.update({
          where: { id: handoff.id },
          data: { status: "CANCELLED", revision, cancelledById: actor, cancelledAt: now, reason: cleaned },
        });
        await outbox(tx, {
          eventType: "warehouse.custody.cancelled", aggregateId: handoff.id, revision, dedupeKey: `warehouse-custody-cancelled:${handoff.id}:${revision}`,
          payload: { handoffId: handoff.id, unitId, direction: handoff.direction, revision, reason: cleaned, occurredAt: now.toISOString(), actorId: actor },
        });
        await recordActivity(tx, {
          entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.CUSTODY_ROLLED_BACK, actorId: actor,
          metadata: { unitCode: handoff.unit.unitCode, direction: handoff.direction, handoffId: handoff.id, reason: cleaned },
        });
        cancelled.push({ handoffId: handoff.id, unitId, direction: handoff.direction, revision });
      }
    }
    const response = { cancelledCount: cancelled.length, cancelled };
    await finishCommand(tx, command, cancelled.length, response);
    return { replayed: false, ...response };
  });
}

const HISTORY_STATUSES = ["ACCEPTED", "REJECTED", "CANCELLED", "SUPERSEDED"];

// Antrean Gudang. status=REJECTED berfungsi sebagai antrean exception (riwayat penolakan yang belum ditindaklanjuti).
// status="HISTORY" (tab Riwayat) = seluruh handoff yang sudah selesai, terbaru dulu.
// Tanpa direction eksplisit antrean lama (INBOUND/RETURN) TIDAK memuat barang jadi — barang jadi hanya tampil bila direction=FINISHED_GOODS.
export async function listCustodyHandoffs(prisma, { status = "OFFERED", direction = null, limit = 100, unitIds = null } = {}) {
  const isHistory = status === "HISTORY";
  const statuses = isHistory ? HISTORY_STATUSES : [status];
  const rows = await prisma.unitCustodyHandoff.findMany({
    where: { status: { in: statuses }, direction: direction ? direction : { not: "FINISHED_GOODS" }, ...(unitIds ? { unitId: { in: unitIds } } : {}) },
    orderBy: isHistory ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ offeredAt: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(Number(limit) || 100, 1), 200),
    include: {
      unit: { select: { id: true, unitCode: true, merk: true, ukuran: true, order: { select: { orderNumber: true } } } },
      location: { select: { id: true, code: true, zone: true, locationType: true } },
      deliveryJob: { select: { id: true, type: true, status: true } },
      productionRun: { select: { id: true, revision: true, status: true, currentPhase: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id, revision: row.revision, status: row.status, direction: row.direction, offeredAt: row.offeredAt,
    acceptedAt: row.acceptedAt, rejectedAt: row.rejectedAt, cancelledAt: row.cancelledAt, reason: row.reason,
    unit: { id: row.unit.id, unitCode: row.unit.unitCode, merk: row.unit.merk, ukuran: row.unit.ukuran, orderNumber: row.unit.order?.orderNumber ?? null },
    location: row.location, deliveryJob: row.deliveryJob, productionRunId: row.productionRunId,
    productionRun: row.productionRun ? { id: row.productionRun.id, revision: row.productionRun.revision, status: row.productionRun.status, currentPhase: row.productionRun.currentPhase } : null,
  }));
}
