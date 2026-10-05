// "Lanjutkan Pekerjaan" — SATU aksi server yang atomik dan idempoten untuk SEMUA pekerjaan (di papan maupun di luar papan).
//  - Pekerjaan DI PAPAN (unit dimiliki run V2): resumeProductionWork (productionStepCommandService.js) — lanjut jeda/tunda; menunggu bahan hanya terbuka setelah Gudang
//    menyelesaikan kekurangan bahan (409 RESUME_WAITING_MATERIAL).
//  - Pekerjaan DI LUAR papan (jalur lama): satu transaksi — gerbang kepemilikan/penugasan, lalu mulai-ulang tahap (otomatis menutup penundaan) ATAU lanjutkan jeda. Penundaan
//    "Menunggu bahan" hanya boleh dilanjutkan pemegang izin Gudang (INVENTORY_WRITE) atau ADMIN/OWNER — masalah bahan harus selesai dulu.
//  - Idempotency-Key (v2_commands): ulangan kunci sama = respons sama tanpa tulisan baru. Pekerjaan yang sudah berjalan = alreadyActive (tanpa tulisan).
// Penulis ledger tahap/blokir tetap stage engine; file ini tidak menulis tabel tahap sendiri.
import { createHash } from "node:crypto";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { hasPermission } from "../middleware/authorize.js";
import { EVENT_TYPES, recordActivity } from "../lib/activityLog.js";
import { delayReasonOfBlock } from "../lib/domain/productionDisplay.js";
import { assertV1StageActorInTx, pathForUnit, resolveCurrentTarget, resumeStageInTx, startStageInTx } from "./unitStageEngine.js";
import { UnitConcurrentChangeError, UnitV2OwnedError, guardV1UnitWrite } from "./unitV2Ownership.js";
import { resumeProductionWork } from "./productionStepCommandService.js";
import { assertIdempotencyKey } from "./productionStepCommandService.js";

const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
const err = (message, statusCode, code, details) => Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });

export async function resumeWork(prisma, { unitId, user, idempotencyKey, expectedRevision = null }) {
  assertIdempotencyKey(idempotencyKey);
  const actorId = user?.id;
  const run = await prisma.productionRun.findFirst({ where: { unitId, status: { in: ["ACTIVE", "BLOCKED"] } }, select: { id: true, plan: { select: { workCenterId: true } } } });
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } });
  if (!unit) throw err("Unit tidak ditemukan", 404, "UNIT_NOT_FOUND");
  if (run) {
    try {
      return { path: "PAPAN", ...(await resumeProductionWork(prisma, { runId: run.id, actorId, idempotencyKey, expectedRevision, workCenterId: run.plan?.workCenterId ?? null })) };
    } catch (e) {
      // Writer papan MATI / unit di luar cohort: pekerjaan memang di luar papan -> jalur lama (tidak ada tulisan V2 yang terjadi sebelum 503).
      if (e?.code !== "STEP_WRITER_OFF") throw e;
    }
  }
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RESUME_WORK_V1", unitId });
  return prisma.$transaction(async (tx) => {
    const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw err("Idempotency-Key dipakai untuk isian berbeda", 409, "IDEMPOTENCY_CONFLICT");
      if (replay.status !== "APPLIED") throw err("Perintah sebelumnya masih diproses", 409, "COMMAND_IN_PROGRESS");
      return { replayed: true, ...replay.response };
    }
    try {
      await guardV1UnitWrite(tx, unitId, { what: "lanjutkan pekerjaan", actorId, reject: true });
    } catch (e) {
      if (e instanceof UnitV2OwnedError) throw err("Pekerjaan unit ini sudah di papan produksi — lanjutkan lewat Aplikasi Meja/Corner", 409, "UNIT_V2_OWNED");
      if (e instanceof UnitConcurrentChangeError) throw err(e.message, 409, "UNIT_CONFLICT");
      throw e;
    }
    const u = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    const path = await pathForUnit(tx, u).catch(() => null);
    if (!path) throw err("Rute pengerjaan unit belum ditentukan", 409, "RESUME_NO_ROUTE");
    const { stage, state } = await resolveCurrentTarget(tx, u, path);
    if (!stage) throw err("Tidak ada pekerjaan yang bisa dilanjutkan", 409, "RESUME_NOTHING_TO_RESUME");
    const command = await tx.v2Command.create({ data: { domain: "PRODUCTION", actorId: actor, idempotencyKey, commandType: "RESUME_WORK_V1", aggregateType: "Unit", aggregateId: unitId, requestHash } });
    const finish = async (response) => { await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision: null, response, completedAt: new Date() } }); return { replayed: false, ...response }; };
    if (state === "IN_PROGRESS") return finish({ unitId, status: "ACTIVE", resumed: false, alreadyActive: true, path: "LUAR_PAPAN" });
    if (!["BLOCKED", "PAUSED"].includes(state)) throw err("Pekerjaan ini tidak sedang tertunda atau dijeda", 409, "RESUME_NOTHING_TO_RESUME", { state });
    try { await assertV1StageActorInTx(tx, unitId, { actorId, stageId: stage.id }); }
    catch (e) { if (typeof e.statusCode === "number") throw Object.assign(e, { code: e.code || "RESUME_FORBIDDEN" }); throw e; }
    let previous = null;
    if (state === "BLOCKED") {
      const blocker = await tx.productionBlocker.findFirst({ where: { unitId, resolvedAt: null } });
      previous = blocker ? delayReasonOfBlock(blocker.reason) : null;
      if (blocker?.reason === "MATERIAL_SHORTAGE" && !hasPermission(user, P.INVENTORY_WRITE)) {
        throw err("Menunggu bahan: hanya Gudang yang bisa menandai masalah bahan selesai. Pekerjaan baru bisa dilanjutkan setelah itu.", 409, "RESUME_WAITING_MATERIAL", { waitingFor: "GUDANG" });
      }
      await startStageInTx(tx, unitId, { actorId }); // menulis START + menutup penundaan (satu transaksi)
    } else {
      await resumeStageInTx(tx, unitId, stage.id, { actorId });
    }
    await recordActivity(tx, { entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_WORK_RESUMED, actorId: actorId || null, metadata: { unitCode: u.unitCode, reasonLabel: previous?.label ?? null } });
    return finish({ unitId, status: "ACTIVE", resumed: true, alreadyActive: false, path: "LUAR_PAPAN", stage: { id: stage.id, label: stage.labelId } });
  }, { timeout: 15_000 });
}
