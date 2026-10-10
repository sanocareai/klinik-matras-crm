// Command owner PENGATURAN & CATATAN BAHAN jalur Pengerjaan Pesanan (order BARU/custom, Production Run WORKSHOP_BORN).
// SATU-SATUNYA penulis production_run_build_settings_v2 dan production_build_material_records_v2 (lihat tests/productionBuildTrack.test.js — audit penulis).
//
// Tiga command (semuanya: Idempotency-Key, expectedRevision Run, writer cohort fail-closed, tanpa konflik terbuka, outbox + audit aktivitas — commit/batal bersama):
//  1. setBuildMaterialOperator  — Lead/Admin menetapkan PIC BAHAN per pekerjaan (operator produksi yang SAH; bukan akun/peran baru, tanpa perluasan izin).
//  2. confirmBuildCorner        — Lead/Admin mengonfirmasi kebutuhan Corner pada rencana (true | false+alasan). Corner TIDAK diturunkan dari jenis produk. Tidak diperlukan =
//                                 jalur tanpa tahap Jahit Corner (tahap 9–11 "tidak berlaku" beralasan), BUKAN selesai palsu. Hanya sebelum gerbang QC dilewati.
//  3. recordBuildMaterials      — PIC Bahan (atau ADMIN/OWNER lewat PRODUCTION_EXECUTE_ANY) mencatat racikan + pemakaian AKTUAL. Pemakaian hanya dari bahan yang SAH diserahkan
//                                 Gudang (tidak boleh melebihi). Tidak menulis stok: stok keluar tepat SATU kali, saat Gudang menyerahkan bahan (Material Issue P4); sisa menjadi retur.
// Penulis tahap/fase/run tetap helper P5 (bumpRunRevisionInTx). Bukti P8 dan rencana P3 tidak disentuh.
import { createHash } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { normalizeMaterialLines } from "../lib/domain/productionSteps.js";
import { PRODUCT_FLOW } from "../lib/domain/productionBuildTrack.js";
import { assertNoOpenRunException } from "./productionRunGuards.js";
import { bumpRunRevisionInTx, loadRunForWrite, mayExecuteAnyUnit } from "./productionWorkshopExecutionCommandService.js";
import { assertExpectedRevision, assertIdempotencyKey, cornerDecisionLocked, issuedQtyByMaterial, loadStepContext } from "./productionStepCommandService.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";
import { setPlannedBOM } from "./productionPlanningCommandService.js";
import { requestReworkMaterial } from "./productionQcHandoffCommandService.js";

const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
function buildError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}
const text = (value, label, { min = 0, max = 400 } = {}) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw buildError(`${label} tidak valid`, 400, "BUILD_INPUT_INVALID");
  const t = value.trim();
  if (t.length > max) throw buildError(`${label} terlalu panjang (maksimal ${max} karakter)`, 400, "BUILD_INPUT_INVALID");
  if (t && t.length < min) throw buildError(`${label} minimal ${min} karakter`, 400, "BUILD_INPUT_INVALID");
  return t || null;
};

async function beginCommand(tx, { actor, idempotencyKey, commandType, aggregateId, requestHash, expectedRevision }) {
  return tx.v2Command.create({ data: { domain: "PRODUCTION", actorId: actor, idempotencyKey, commandType, aggregateType: "ProductionRun", aggregateId, expectedRevision, requestHash } });
}
const finishCommand = (tx, command, appliedRevision, response) => tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision, response, completedAt: new Date() } });
async function findReplay(tx, actor, idempotencyKey, requestHash) {
  const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
  if (!replay) return null;
  if (replay.requestHash !== requestHash) throw buildError("Idempotency-Key dipakai untuk isian berbeda", 409, "IDEMPOTENCY_CONFLICT");
  if (replay.status !== "APPLIED") throw buildError("Perintah sebelumnya masih diproses", 409, "COMMAND_IN_PROGRESS");
  return { replayed: true, ...replay.response };
}
const outbox = (tx, { eventType, aggregateId, revision, dedupeKey, payload }) => tx.domainOutbox.create({
  data: { domain: "PRODUCTION", eventType, aggregateType: "ProductionRun", aggregateId, aggregateRevision: revision, dedupeKey, payload },
});

// Pra-syarat bersama (di dalam transaksi): kunci unit -> run, writer cohort, tanpa konflik terbuka, revisi cocok, jalur pengerjaan.
async function loadBuildRun(tx, { runId, expectedRevision, forMaterials = false, allowRestoration = false }) {
  const run = await loadRunForWrite(tx, runId);
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  if (!isProductionWriterEnabledFor(state, run.unitId)) throw buildError("Unit ini belum diaktifkan untuk alur produksi baru; kerjakan lewat bagian Pekerjaan unit (alur biasa)", 503, "BUILD_WRITER_OFF");
  await assertNoOpenRunException(tx, run.id);
  if (expectedRevision != null && run.revision !== expectedRevision) throw buildError(`Data unit sudah berubah (revisi ${run.revision}, Anda memakai ${expectedRevision}). Muat ulang kartu lalu ulangi.`, 409, "STEP_REVISION_CONFLICT", { revision: run.revision });
  if (!["RECEIVED", "IN_PRODUCTION"].includes(run.unit.status)) throw buildError(`Unit berstatus ${run.unit.status}; bukan pekerjaan workshop`, 409, "BUILD_UNIT_NOT_IN_PRODUCTION", { unitStatus: run.unit.status });
  const ctx = await loadStepContext(tx, run);
  // Fase 3: PIC Bahan per pekerjaan + pemakaian aktual juga untuk LAYANAN (restorasi) — command & tabel yang SAMA; racikan LAYANAN tetap di Catatan Komponen (bukan salinan teks di sini).
  if (!ctx.state.buildTrack && !(allowRestoration && ctx.state.materialPicRestoration)) throw buildError("Hanya untuk pesanan BARU/custom (Pengerjaan Pesanan) atau LAYANAN (PIC Bahan per pekerjaan)", 409, "BUILD_NOT_APPLICABLE");
  void forMaterials;
  return { run, ctx };
}

async function upsertSetting(tx, run, data, actorId) {
  const existing = await tx.productionRunBuildSetting.findUnique({ where: { runId: run.id } });
  if (!existing) return tx.productionRunBuildSetting.create({ data: { runId: run.id, ...data, updatedById: actorId || null } });
  return tx.productionRunBuildSetting.update({ where: { id: existing.id }, data: { ...data, revision: existing.revision + 1, updatedById: actorId || null, updatedAt: new Date() } });
}

const hasStep6Materials = (ctx) => ctx.evidence.some((e) => (ctx.state.buildTrack ? e.stepNo === 6 : [6, 7].includes(e.stepNo)) && (e.payload?.materials || []).length > 0);

// ---------------------------------------------------------------------------
// 1. PIC Bahan per pekerjaan.
// ---------------------------------------------------------------------------
export async function setBuildMaterialOperator(prisma, { runId, operatorId = null, actorId, idempotencyKey, expectedRevision }) {
  if (!runId) throw buildError("runId wajib diisi", 400, "BUILD_RUN_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  if (operatorId != null && typeof operatorId !== "string") throw buildError("operatorId tidak valid", 400, "BUILD_INPUT_INVALID");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "SET_BUILD_MATERIAL_OPERATOR", runId, operatorId: operatorId || null, expectedRevision: revisionExpected });
  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const { run, ctx } = await loadBuildRun(tx, { runId, expectedRevision: revisionExpected, allowRestoration: true });
    let operator = null;
    if (operatorId) {
      operator = await tx.productionOperator.findUnique({ where: { id: operatorId }, include: { user: { select: { name: true } } } });
      if (!operator || !operator.active) throw buildError("Operator produksi tidak ditemukan atau tidak aktif — daftarkan lebih dulu di Pengaturan > Operator (tidak dibuat otomatis)", 422, "BUILD_OPERATOR_INVALID");
      if (hasStep6Materials(ctx)) throw buildError("Pemakaian bahan sudah tercatat pada bukti pengerjaan; PIC Bahan tidak dapat ditetapkan (hindari hitung ganda)", 409, "BUILD_USAGE_ALREADY_IN_EVIDENCE");
    }
    const current = ctx.buildSetting?.materialOperatorId ?? null;
    if (current === (operatorId || null)) return { replayed: false, runId, revision: run.revision, changed: false, materialOperator: operator ? { id: operator.id, name: operator.user?.name ?? null } : null };
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "SET_BUILD_MATERIAL_OPERATOR", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const now = new Date();
    await upsertSetting(tx, run, { materialOperatorId: operator?.id ?? null }, actorId);
    const revision = await bumpRunRevisionInTx(tx, run);
    await outbox(tx, {
      eventType: "production.build.material_operator_set", aggregateId: run.id, revision, dedupeKey: `production-build-material-operator:${run.id}:${revision}`,
      payload: { runId: run.id, unitId: run.unitId, operatorId: operator?.id ?? null, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, { entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_BUILD_MATERIAL_OPERATOR_SET, actorId: actorId || null, metadata: { unitCode: run.unit.unitCode, runId: run.id, operatorName: operator?.user?.name ?? null } });
    const response = { runId, revision, changed: true, materialOperator: operator ? { id: operator.id, name: operator.user?.name ?? null } : null };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 2. Kebutuhan Corner yang dikonfirmasi pada rencana.
// ---------------------------------------------------------------------------
// Validasi + normalisasi pilihan Corner (murni; dipakai command Unit 360 DAN modal Jadwalkan — kontrak server yang sama). Mengembalikan { required, reason }.
export function normalizeCornerInput({ required, reason = null } = {}) {
  if (typeof required !== "boolean") throw buildError("Kebutuhan Corner wajib dipilih (diperlukan / tidak diperlukan)", 400, "BUILD_CORNER_REQUIRED_CHOICE");
  const cleanReason = text(reason, "Alasan", { min: 3, max: 300 });
  if (required === false && !cleanReason) throw buildError("Corner tidak diperlukan wajib beralasan (minimal 3 karakter) — mis. tidak ada pekerjaan kain/jahit", 400, "BUILD_CORNER_REASON_REQUIRED");
  return { required, reason: required ? null : cleanReason };
}

export async function confirmBuildCorner(prisma, { runId, required, reason = null, actorId, idempotencyKey, expectedRevision }) {
  if (!runId) throw buildError("runId wajib diisi", 400, "BUILD_RUN_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const choice = normalizeCornerInput({ required, reason });
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "CONFIRM_BUILD_CORNER", runId, required: choice.required, reason: choice.reason, expectedRevision: revisionExpected });
  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    return confirmBuildCornerInTx(tx, { runId, choice, actorId, idempotencyKey, requestHash, expectedRevision: revisionExpected });
  });
}

// Inti perintah Corner di dalam transaksi pemanggil (Unit 360: command sendiri; modal Jadwalkan: dalam transaksi onboarding+jadwal — atomik). expectedRevision=null = Run baru dibuka transaksi yang sama.
export async function confirmBuildCornerInTx(tx, { runId, choice, actorId, idempotencyKey, requestHash = null, expectedRevision = null }) {
  const actor = actorId || "SYSTEM";
  const required = choice.required; const cleanReason = choice.reason;
  const hashValue = requestHash || hash({ commandType: "CONFIRM_BUILD_CORNER", runId, required, reason: cleanReason, expectedRevision });
  {
    const { run, ctx } = await loadBuildRun(tx, { runId, expectedRevision });
    // Jalur Corner ditentukan sebelum gerbang QC dilewati: setelah unit melewati gerbang / masuk tahap Jahit Corner atau Finish, keputusan dikunci (satu sumber: cornerDecisionLocked).
    if (await cornerDecisionLocked(tx, run)) throw buildError("Kebutuhan Corner tidak dapat diubah lagi: unit sudah melewati gerbang QC / masuk tahap setelahnya", 409, "BUILD_CORNER_LOCKED");
    const same = ctx.buildSetting && ctx.buildSetting.cornerRequired === required && (required || (ctx.buildSetting.cornerReason || null) === cleanReason);
    if (same) return { replayed: false, runId, revision: run.revision, changed: false, corner: { required, reason: cleanReason } };
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "CONFIRM_BUILD_CORNER", aggregateId: runId, requestHash: hashValue, expectedRevision });
    const now = new Date();
    await upsertSetting(tx, run, { cornerRequired: required, cornerReason: required ? null : cleanReason }, actorId);
    const revision = await bumpRunRevisionInTx(tx, run);
    await outbox(tx, {
      eventType: "production.build.corner_confirmed", aggregateId: run.id, revision, dedupeKey: `production-build-corner:${run.id}:${revision}`,
      payload: { runId: run.id, unitId: run.unitId, required, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, { entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_BUILD_CORNER_CONFIRMED, actorId: actorId || null, metadata: { unitCode: run.unit.unitCode, runId: run.id, required, reason: required ? null : cleanReason } });
    const response = { runId, revision, changed: true, corner: { required, reason: required ? null : cleanReason } };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  }
}

// ---------------------------------------------------------------------------
// 3. Racikan + pemakaian aktual oleh PIC Bahan.
// ---------------------------------------------------------------------------
export function normalizeRacikan(input) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw buildError("Racikan tidak valid", 400, "BUILD_INPUT_INVALID");
  const fondasi = text(input.fondasi, "Racikan fondasi", { min: 3, max: 400 });
  const lapisan = text(input.lapisan, "Racikan lapisan", { min: 3, max: 400 });
  return fondasi || lapisan ? { fondasi, lapisan } : null;
}

export async function recordBuildMaterials(prisma, { runId, actorId, canExecuteAny = false, idempotencyKey, expectedRevision, racikan = null, materials = [], note = null }) {
  if (!runId) throw buildError("runId wajib diisi", 400, "BUILD_RUN_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  if (materials != null && !Array.isArray(materials)) throw buildError("Daftar bahan tidak valid", 400, "BUILD_INPUT_INVALID");
  const cleanRacikan = normalizeRacikan(racikan);
  const cleanNote = text(note, "Catatan", { max: 500 });
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RECORD_BUILD_MATERIALS", runId, expectedRevision: revisionExpected, racikan: cleanRacikan, materials: (materials || []).map((m) => [m?.materialId, Number(m?.qty)]).sort(), note: cleanNote });
  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const { run, ctx } = await loadBuildRun(tx, { runId, expectedRevision: revisionExpected, forMaterials: true, allowRestoration: true });
    if (!ctx.state.buildTrack && cleanRacikan) throw buildError("Racikan pekerjaan LAYANAN dicatat PIC Meja/PIC QC di Catatan Komponen (Racikan rencana); PIC Bahan hanya mencatat pemakaian aktual", 422, "BUILD_RACIKAN_NOT_APPLICABLE_LAYANAN");
    // Otorisasi: PIC Bahan yang DITUGASKAN pada pekerjaan ini (operator aktif) atau pemegang PRODUCTION_EXECUTE_ANY (ADMIN/OWNER). Tidak ada izin/peran baru.
    if (!canExecuteAny) {
      const operator = actorId ? await tx.productionOperator.findUnique({ where: { userId: actorId }, select: { id: true, active: true } }) : null;
      const assigned = ctx.buildSetting?.materialOperatorId ?? null;
      if (!assigned) throw buildError("Pekerjaan ini belum punya PIC Bahan — Lead perlu menetapkannya lebih dulu", 403, "BUILD_NO_MATERIAL_OPERATOR");
      if (!operator || !operator.active || operator.id !== assigned) throw buildError("Anda bukan PIC Bahan yang ditugaskan pada pekerjaan ini", 403, "BUILD_MATERIAL_OPERATOR_MISMATCH");
    }
    if (hasStep6Materials(ctx)) throw buildError("Pemakaian bahan sudah tercatat pada bukti pengerjaan PIC Meja; tidak dapat dicatat ganda", 409, "BUILD_USAGE_ALREADY_IN_EVIDENCE");
    const returned = await tx.productionMaterialReturn.count({ where: { runId: run.id } });
    if (run.currentPhase === "HANDOFF" || returned > 0) throw buildError("Pemakaian bahan sudah dikunci (produksi selesai / retur sisa sudah dibuat)", 409, "BUILD_MATERIALS_LOCKED");
    const flow = ctx.state.productFlow;
    if (cleanRacikan && ctx.state.buildTrack) {
      if (flow === PRODUCT_FLOW.UNCONFIRMED) throw buildError("Jenis produk belum jelas — racikan kasur ditahan sampai Sales mengonfirmasi jenis produk pada order", 409, "PRODUCT_TYPE_UNCONFIRMED");
      if (flow === PRODUCT_FLOW.NON_KASUR) throw buildError("Produk non-kasur (divan/sofa) tidak memakai racikan kasur", 422, "BUILD_RACIKAN_NOT_APPLICABLE");
    }
    const issued = await issuedQtyByMaterial(tx, run.plan?.id);
    const lines = normalizeMaterialLines(materials, { issuedQtyByMaterial: issued, required: false, label: "Pemakaian bahan" }); // bahan HARUS dari yang diserahkan Gudang; tidak boleh melebihi
    if (!cleanRacikan && !lines.length) throw buildError("Isi racikan dan/atau pemakaian bahan", 400, "BUILD_NOTHING_TO_RECORD");
    const latest = ctx.buildRecord;
    const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const prevLines = (latest?.materials || []).map((m) => ({ materialId: m.materialId, qty: Number(m.qty) }));
    if (latest && sameJson(latest.racikan, cleanRacikan) && sameJson(prevLines, lines) && (latest.note || null) === cleanNote) {
      return { replayed: false, runId, revision: run.revision, version: latest.version, changed: false };
    }
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "RECORD_BUILD_MATERIALS", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const now = new Date();
    const version = (latest?.version ?? 0) + 1;
    const record = await tx.productionBuildMaterialRecord.create({ data: { runId: run.id, version, actorId: actorId || null, racikan: cleanRacikan, materials: lines, note: cleanNote, commandId: command.id } });
    const revision = await bumpRunRevisionInTx(tx, run);
    await outbox(tx, {
      eventType: "production.build.materials_recorded", aggregateId: run.id, revision, dedupeKey: `production-build-materials:${run.id}:${version}`,
      payload: { runId: run.id, unitId: run.unitId, version, materialCount: lines.length, hasRacikan: !!cleanRacikan, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, { entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_BUILD_MATERIALS_RECORDED, actorId: actorId || null, metadata: { unitCode: run.unit.unitCode, runId: run.id, version, materialCount: lines.length } });
    const response = { runId, revision, version, recordId: record.id, changed: true };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 4. Rencana bahan (BOM) oleh PIC Bahan yang DITUGASKAN pada pekerjaan ini (Fase 3). Memakai command planning yang SAMA (setPlannedBOM: revisi rencana, idempotensi, tolak bila bahan sudah
//    diserahkan/ada permintaan ambil aktif, reservasi dilepas bila BOM berubah) — hanya aturan akses yang berbeda: PIC Bahan per pekerjaan (atau ADMIN/OWNER lewat PRODUCTION_EXECUTE_ANY).
//    Tidak memberi akses BOM luas kepada Lead/Gudang/Meja; tidak menulis stok (reservasi/serah tetap oleh Gudang).
// ---------------------------------------------------------------------------
export async function setBuildPlannedBOM(prisma, { runId, actorId, canExecuteAny = false, idempotencyKey, expectedRevision, lines }) {
  if (!runId) throw buildError("runId wajib diisi", 400, "BUILD_RUN_REQUIRED");
  if (!Array.isArray(lines)) throw buildError("Daftar bahan tidak valid", 400, "BUILD_INPUT_INVALID");
  const plan = await prisma.productionRunPlan.findUnique({ where: { runId }, select: { id: true } });
  if (!plan) throw buildError("Pekerjaan ini belum punya rencana produksi", 404, "BUILD_PLAN_NOT_FOUND");
  return setPlannedBOM(prisma, {
    planId: plan.id, actorId, idempotencyKey, expectedRevision, lines,
    authorize: async (tx) => {
      if (canExecuteAny) return;
      const operator = actorId ? await tx.productionOperator.findUnique({ where: { userId: actorId }, select: { id: true, active: true } }) : null;
      const setting = await tx.productionRunBuildSetting.findUnique({ where: { runId }, select: { materialOperatorId: true } });
      if (!setting?.materialOperatorId) throw buildError("Pekerjaan ini belum punya PIC Bahan — Lead perlu menetapkannya lebih dulu", 403, "BUILD_NO_MATERIAL_OPERATOR");
      if (!operator || !operator.active || operator.id !== setting.materialOperatorId) throw buildError("Anda bukan PIC Bahan yang ditugaskan pada pekerjaan ini", 403, "BUILD_MATERIAL_OPERATOR_MISMATCH");
    },
  });
}

// ---------------------------------------------------------------------------
// 5. Permintaan bahan REWORK oleh PIC Bahan yang DITUGASKAN (Fase 4), setelah putusan QC gagal dan sebelum rework dimulai. Memakai command QC yang SAMA (requestReworkMaterial: reservasi
//    + Material Issue tambahan READY_TO_PICK, satu permintaan per inspeksi, idempoten, revisi Run); Gudang menyerahkan lewat pick yang sudah ada (stok keluar tepat sekali di sana).
//    Tidak menulis stok di sini; hanya aturan akses (PIC Bahan per pekerjaan atau ADMIN/OWNER lewat PRODUCTION_EXECUTE_ANY) yang berbeda.
// ---------------------------------------------------------------------------
export async function requestBuildReworkMaterial(prisma, { runId, actorId, canExecuteAny = false, idempotencyKey, expectedRevision, lines }) {
  if (!runId) throw buildError("runId wajib diisi", 400, "BUILD_RUN_REQUIRED");
  return requestReworkMaterial(prisma, {
    runId, actorId, idempotencyKey, expectedRevision, lines,
    authorize: async (tx) => {
      if (canExecuteAny) return;
      const operator = actorId ? await tx.productionOperator.findUnique({ where: { userId: actorId }, select: { id: true, active: true } }) : null;
      const setting = await tx.productionRunBuildSetting.findUnique({ where: { runId }, select: { materialOperatorId: true } });
      if (!setting?.materialOperatorId) throw buildError("Pekerjaan ini belum punya PIC Bahan — Lead perlu menetapkannya lebih dulu", 403, "BUILD_NO_MATERIAL_OPERATOR");
      if (!operator || !operator.active || operator.id !== setting.materialOperatorId) throw buildError("Anda bukan PIC Bahan yang ditugaskan pada pekerjaan ini", 403, "BUILD_MATERIAL_OPERATOR_MISMATCH");
    },
  });
}

export { mayExecuteAnyUnit };
