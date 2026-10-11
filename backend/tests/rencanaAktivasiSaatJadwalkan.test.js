// Aktivasi unit SAAT dijadwalkan (seret-lepas / Jadwalkan) — logika murni + transaksi tiruan (tanpa DB):
//  - activatableOnDrop: siapa yang BOLEH diaktifkan otomatis, siapa yang tetap ditolak (progres V1, tak eligible);
//  - activateRencanaUnitInTx: hanya MENAMBAH unit ke cohort reader+writer (cohort lama utuh), flag MATI = berhenti tanpa menulis, jejak aktivitas tercatat;
//  - planAndScheduleUnit: activateUnit=true tanpa izin ADMIN/OWNER = 403 SEBELUM menyentuh DB.
// Versi HTTP + DB sungguhan ada di tests/integration/rencanaAktivasiSaatJadwalkan.integration.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { RENCANA_ACTION as A, RENCANA_EXCEPTION as E, activatableOnDrop, classifyRencanaUnit } from "../src/lib/domain/productionRencana.js";
import { activateRencanaUnitInTx, planAndScheduleUnit } from "../src/services/productionRencanaService.js";
import { BOARD_DEFAULTS } from "../src/lib/domain/productionBoard.js";
import { EVENT_TYPES } from "../src/lib/activityLog.js";

const UNIT = "11111111-1111-4111-8111-111111111111";
const LAIN = "22222222-2222-4222-8222-222222222222";
const LAIN2 = "33333333-3333-4333-8333-333333333333";
const base = { unitStatus: "RECEIVED", orderStatus: "PROCESSING", customerStage: "NEW", isInternalStaff: false, hasActiveRun: false, stageLogCount: 0, hasCurrentStage: false, readerEnabled: false, writerEnabled: false };
const prog = (over) => ({ stageLogCount: 0, hasCurrentStage: false, ...over });

test("activatableOnDrop: menunggu aktivasi, aktivasi sebagian, dan Run V2 di luar cohort tanpa progres V1 = BOLEH", () => {
  assert.equal(activatableOnDrop(classifyRencanaUnit(base), prog()), true);
  const sebagian = classifyRencanaUnit({ ...base, readerEnabled: true });
  assert.equal(sebagian.code, E.PARTIAL_ACTIVATION); assert.equal(activatableOnDrop(sebagian, prog()), true);
  const runLuar = classifyRencanaUnit({ ...base, hasActiveRun: true });
  assert.equal(runLuar.code, E.RUN_OUTSIDE_COHORT); assert.equal(activatableOnDrop(runLuar, prog()), true);
});

test("activatableOnDrop: progres tahap V1, spam/internal, dibatalkan, Siap Kirim, belum diambil, order bukan Diproses, PKR belum lengkap = TETAP DITOLAK", () => {
  const runLuar = classifyRencanaUnit({ ...base, hasActiveRun: true });
  assert.equal(activatableOnDrop(runLuar, prog({ stageLogCount: 2 })), false, "Run di luar cohort DENGAN riwayat V1 tidak boleh diaktifkan (riwayat harus dipindahkan resmi)");
  assert.equal(activatableOnDrop(runLuar, prog({ hasCurrentStage: true })), false);
  for (const over of [
    { isInternalStaff: true }, { customerStage: "SPAM" }, { unitStatus: "CANCELLED" }, { unitStatus: "DELIVERED" }, { unitStatus: "AWAITING_PICKUP" },
    { orderStatus: "READY" }, { stageLogCount: 1 }, { hasCurrentStage: true }, { pkrKurang: { nomor: "PKR-1", kurang: ["alamat"] } },
  ]) {
    const cls = classifyRencanaUnit({ ...base, ...over });
    assert.equal(activatableOnDrop(cls, prog({ stageLogCount: over.stageLogCount || 0, hasCurrentStage: !!over.hasCurrentStage })), false, JSON.stringify(over));
  }
  // yang sudah aktif bukan "activatable" (tidak perlu aktivasi)
  assert.equal(activatableOnDrop(classifyRencanaUnit({ ...base, readerEnabled: true, writerEnabled: true }), prog()), false);
  assert.equal(activatableOnDrop(null), false);
});

// ── transaksi tiruan ──────────────────────────────────────────────────────────────────────────────────────────────
const unitRow = (over = {}) => ({
  id: UNIT, unitCode: "RES-11102026-001-U1", status: "RECEIVED", currentStageId: null,
  order: { id: "o-1", orderNumber: "RES-11102026-001", status: "PROCESSING", category: "LAYANAN", penjualanKaryawanId: null, customer: { name: "Bu Uji", pipelineStage: "NEW", isInternalStaff: false } },
  _count: { stageLogs: 0 }, productionRunsV2: [], ...over,
});
function fakeTx({ reader = [LAIN], writer = [LAIN], readerOn = true, writerOn = true, row = unitRow() } = {}) {
  const flags = {
    production_v2_reader: { key: "production_v2_reader", enabled: readerOn, scope: "GLOBAL", config: { unitIds: [...reader] }, reason: "awal" },
    production_v2_writer: { key: "production_v2_writer", enabled: writerOn, scope: "GLOBAL", config: { unitIds: [...writer] }, reason: "awal" },
  };
  const log = { writes: [], activity: [], locks: 0 };
  return {
    flags, log,
    $queryRawUnsafe: async (sql) => { if (/FOR UPDATE/.test(sql)) log.locks += 1; return []; },
    v2FeatureFlag: {
      findMany: async () => Object.values(flags).map((f) => ({ ...f })),
      findUniqueOrThrow: async ({ where }) => ({ ...flags[where.key] }),
      update: async ({ where, data }) => { log.writes.push({ key: where.key, ...data }); flags[where.key] = { ...flags[where.key], ...data }; return flags[where.key]; },
    },
    unit: { findUnique: async () => row },
    activityEvent: { create: async ({ data }) => { log.activity.push(data); return data; } },
  };
}

test("aktivasi: menambah unit ke reader DAN writer, cohort lama utuh, satu jejak aktivitas atas nama pemutus", async () => {
  const tx = fakeTx({ reader: [LAIN2, LAIN], writer: [LAIN, LAIN2] });
  const r = await activateRencanaUnitInTx(tx, { unitId: UNIT, actorId: "admin-1", idempotencyKey: "kunci-aktivasi-0001" });
  assert.equal(r.activated, true); assert.equal(r.previous, A.AWAIT_ACTIVATION); assert.equal(r.hadRun, false);
  assert.deepEqual(tx.flags.production_v2_reader.config.unitIds, [UNIT, LAIN, LAIN2].sort());
  assert.deepEqual(tx.flags.production_v2_writer.config.unitIds, [UNIT, LAIN, LAIN2].sort());
  assert.equal(tx.log.writes.length, 2); assert.equal(tx.log.locks, 1, "baris flag dikunci");
  for (const w of tx.log.writes) assert.match(w.reason, /rencana-drop/);
  assert.equal(tx.flags.production_v2_reader.enabled, true); // flag tidak dinyalakan/dimatikan
  assert.equal(tx.log.activity.length, 1);
  assert.equal(tx.log.activity[0].eventType, EVENT_TYPES.PRODUCTION_RENCANA_UNIT_ACTIVATED);
  assert.equal(tx.log.activity[0].actorId, "admin-1"); assert.equal(tx.log.activity[0].entityId, UNIT);
});

test("aktivasi: unit yang SUDAH aktif = tidak ada perubahan (idempoten), tanpa tulisan", async () => {
  const tx = fakeTx({ reader: [LAIN, UNIT], writer: [LAIN, UNIT] });
  const r = await activateRencanaUnitInTx(tx, { unitId: UNIT, actorId: "admin-1" });
  assert.deepEqual({ activated: r.activated, reason: r.reason }, { activated: false, reason: "SUDAH_AKTIF" });
  assert.equal(tx.log.writes.length, 0); assert.equal(tx.log.activity.length, 0);
});

test("aktivasi: flag reader/writer MATI atau cohort tidak sah = berhenti 503 tanpa menulis apa pun (menyalakan flag keputusan terpisah)", async () => {
  for (const opts of [{ readerOn: false }, { writerOn: false }, { reader: [], writer: [] }]) {
    const tx = fakeTx(opts);
    await assert.rejects(activateRencanaUnitInTx(tx, { unitId: UNIT, actorId: "admin-1" }), (e) => e.statusCode === 503 && e.code === "RENCANA_ACTIVATION_FLAGS_OFF");
    assert.equal(tx.log.writes.length, 0); assert.equal(tx.log.activity.length, 0);
  }
});

test("aktivasi: progres V1 / dibatalkan / spam ditolak berkode, TANPA mengubah cohort", async () => {
  const kasus = [
    [unitRow({ _count: { stageLogs: 3 } }), "RENCANA_HAS_V1_PROGRESS", 422],
    [unitRow({ status: "CANCELLED" }), "RENCANA_UNIT_CANCELLED", 422],
    [unitRow({ order: { ...unitRow().order, customer: { name: "x", pipelineStage: "SPAM", isInternalStaff: false } } }), "RENCANA_INTERNAL_OR_SPAM", 422],
    [unitRow({ status: "AWAITING_PICKUP" }), "RENCANA_WAIT_PICKUP", 409],
  ];
  for (const [row, code, status] of kasus) {
    const tx = fakeTx({ row });
    await assert.rejects(activateRencanaUnitInTx(tx, { unitId: UNIT, actorId: "admin-1" }), (e) => e.code === code && e.statusCode === status, code);
    assert.equal(tx.log.writes.length, 0); assert.equal(tx.log.activity.length, 0);
  }
});

test("aktivasi: Run di luar cohort TANPA progres V1 diaktifkan (memakai Run yang sama); DENGAN progres V1 ditolak", async () => {
  const run = [{ id: "run-1", status: "PENDING_ARRIVAL", plan: null }];
  const ok = fakeTx({ row: unitRow({ productionRunsV2: run }) });
  const r = await activateRencanaUnitInTx(ok, { unitId: UNIT, actorId: "admin-1" });
  assert.equal(r.activated, true); assert.equal(r.previous, E.RUN_OUTSIDE_COHORT); assert.equal(r.hadRun, true);
  assert.ok(ok.flags.production_v2_writer.config.unitIds.includes(UNIT));
  const tolak = fakeTx({ row: unitRow({ productionRunsV2: run, _count: { stageLogs: 1 } }) });
  await assert.rejects(activateRencanaUnitInTx(tolak, { unitId: UNIT, actorId: "admin-1" }), (e) => e.code === `RENCANA_${E.RUN_OUTSIDE_COHORT}`);
  assert.equal(tolak.log.writes.length, 0);
});

test("aktivasi sebagian (reader saja) dilengkapi: kedua daftar berisi unit sesudahnya", async () => {
  const tx = fakeTx({ reader: [LAIN, UNIT], writer: [LAIN] });
  const r = await activateRencanaUnitInTx(tx, { unitId: UNIT, actorId: "admin-1" });
  assert.equal(r.activated, true); assert.equal(r.previous, E.PARTIAL_ACTIVATION);
  assert.deepEqual(tx.flags.production_v2_writer.config.unitIds, [UNIT, LAIN].sort());
  assert.deepEqual(tx.flags.production_v2_reader.config.unitIds, [UNIT, LAIN].sort());
});

test("planAndScheduleUnit: activateUnit=true tanpa izin ADMIN/OWNER = 403 sebelum menyentuh DB; tanpa activateUnit perilaku lama tidak berubah", async () => {
  const prisma = { $transaction: async () => { throw new Error("DB tersentuh padahal izin ditolak"); } };
  const input = { productionDate: "2026-10-12", stationCode: BOARD_DEFAULTS.stations[0], priority: 0 };
  await assert.rejects(
    planAndScheduleUnit(prisma, { unitId: UNIT, actorId: "lead-1", idempotencyKey: "kunci-aktivasi-0002", input: { ...input, activateUnit: true }, canActivate: false }),
    (e) => e.statusCode === 403 && e.code === "RENCANA_ACTIVATION_FORBIDDEN",
  );
  // izin ada + activateUnit tidak true (mis. "true" sebagai string) -> bukan aktivasi: lanjut ke transaksi (di sini DB tiruan melempar)
  await assert.rejects(
    planAndScheduleUnit(prisma, { unitId: UNIT, actorId: "admin-1", idempotencyKey: "kunci-aktivasi-0003", input: { ...input, activateUnit: "true" }, canActivate: true }),
    /DB tersentuh/,
  );
});
