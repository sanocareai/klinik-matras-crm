// Corner di Rencana Produksi (Tahap A: papan baca; Tahap B: command "Tetapkan/Ganti PIC Corner").
//
// BACA (getCornerBoard): satu read-model server — kelompok dari cornerStatusOf, hambatan + siapa yang perlu bertindak (lib/domain/productionCornerBoard.js), permintaan Sales
// (buildCornerRequest: kain/motif/warna dari layanan Sales + catatan pesanan apa adanya), keadaan QC, PIC, status global milestone. Tidak ada urutan/kapasitas/target Corner
// (belum ada kontrak server) dan TIDAK ada aksi eksekusi tahap (Aplikasi Corner tetap tempat PIC mencatat pekerjaan/bukti).
//
// TULIS (setCornerOperator): HANYA mengubah ProductionRunPlan.cornerOperatorId. Tidak menyentuh Meja, tanggal, target, PIC Meja, urutan, atau work center Corner. Dikunci (baris
// rencana lalu baris run), expected revision rencana (409 PLAN_REVISION_CONFLICT bila Meja/jadwal/PIC berubah oleh orang lain), Idempotency-Key (replay tidak menggandakan riwayat).
// Riwayat penugasan: v2_commands (SET_CORNER_OPERATOR + PIC lama/baru) + activity log unit + outbox — BUKAN entri "jadwal ulang" (tanggal tidak berubah).
import { createHash } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { buildCornerRequest } from "../lib/domain/productionCorner.js";
import { CORNER_GROUPS, canReassignCorner, cornerBlockersOf, cornerGroupOf, qcStateOf } from "../lib/domain/productionCornerBoard.js";
import { effectiveTargetKey, formatProductionDate, stationLabel } from "../lib/domain/productionBoard.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { loadRuns, viewsOf, RUN_VIEW_INCLUDE, cornerAndLifecycleOf } from "./productionExperienceReadService.js";
import { assertExpectedRevision, assertIdempotencyKey, loadStepContext } from "./productionStepCommandService.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";
import { bukanAdminOwner } from "./productionRencanaService.js";

const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];
export const CORNER_DONE_WINDOW_DAYS = 7;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
const cornerError = (message, statusCode, code, details) => Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });

// ---------------------------------------------------------------------------------------------------------------------------------------
// BACA
// ---------------------------------------------------------------------------------------------------------------------------------------
/** Kartu Corner dari satu view papan (toRunView). Murni terhadap view (tanpa DB) — dipakai papan Corner dan tes. */
export function cornerCardOf(view, { todayKey } = {}) {
  const status = view.corner?.status;
  const group = cornerGroupOf(status);
  const buildTrack = view.track === "BUILD";
  const cornerRequired = view.cornerDecision ? view.cornerDecision.required : null;
  const request = buildCornerRequest({ items: (view.customer?.salesServices || []).map((layananName) => ({ layananName })), orderNotes: view.customer?.request ?? null });
  const qc = qcStateOf({ qcIndicator: view.indicators?.qc, next: view.next, qcResult: view.qc?.result ?? null });
  const picCornerName = view.plan?.cornerOperator?.name ?? null;
  const { blockers, primary, needsAction } = cornerBlockersOf({
    group, runStatus: view.status, next: view.next, qc, cornerRequired, buildTrack, picCornerName, request,
    shortageOpen: !!view.shortage,
  });
  const reassign = canReassignCorner({ cornerStatus: status, buildTrack, cornerRequired, runStatus: view.status, planStatus: view.plan?.status, hasPlan: !!view.plan });
  return {
    runId: view.runId, group,
    unit: { id: view.unit.id, unitCode: view.unit.unitCode, merk: view.unit.merk, ukuran: view.unit.ukuran, photoUrl: view.unit.photoUrl ?? null },
    customer: { name: view.customer?.name ?? null, orderNumber: view.customer?.orderNumber ?? null, salesServices: view.customer?.salesServices || [] },
    priority: view.priority, globalStatus: view.globalStatus ?? null, scheduleStatus: view.scheduleStatus ?? null,
    corner: { status, label: view.corner?.label ?? null, applies: view.corner?.applies !== false, decision: view.cornerDecision ? { required: view.cornerDecision.required, reason: view.cornerDecision.reason, decidedBy: view.cornerDecision.decidedBy, decidedAt: view.cornerDecision.decidedAt } : null },
    request: { fabricChangeRequested: request.fabricChangeRequested, fabricItems: request.fabricItems, notes: request.notes, missing: request.missing, needsSalesConfirmation: request.needsSalesConfirmation, statusLabel: request.statusLabel, hint: request.hint },
    qc, pic: { corner: view.plan?.cornerOperator ? { id: view.plan.cornerOperator.id, name: view.plan.cornerOperator.name } : null, table: view.plan?.operator ? { id: view.plan.operator.id, name: view.plan.operator.name } : null, material: view.build?.materialOperator?.name ?? view.materialPic?.materialOperator?.name ?? null },
    plan: view.plan ? {
      id: view.plan.id, revision: view.plan.revision, stationCode: view.plan.stationCode, stationLabel: view.plan.stationCode ? stationLabel(view.plan.stationCode) : null,
      productionDate: view.plan.productionDate, targetEffective: effectiveTargetKey({ targetDate: view.plan.targetDate, productionDate: view.plan.productionDate }), targetMissed: !!view.plan.targetMissed,
    } : null,
    blockers, primaryBlocker: primary, needsAction,
    assign: { allowed: reassign.allowed && group !== null, code: reassign.code, reason: reassign.reason },
    step: view.next?.stepNo ?? null, todayKey: todayKey ?? null,
  };
}

/** Corner TIDAK_BERLAKU: info untuk kartu Meja (alasan + pemutus) — tetap di Meja, bukan pekerjaan Corner. */
export function cornerNotRequiredOf(view) {
  if (view.corner?.status !== "TIDAK_BERLAKU") return null;
  return { reason: view.corner.reason ?? view.cornerDecision?.reason ?? null, decidedBy: view.cornerDecision?.decidedBy ?? null, decidedAt: view.cornerDecision?.decidedAt ?? null, byLead: view.cornerDecision?.required === false };
}

export async function getCornerBoard(prisma, { unitIds, now = new Date() }) {
  const since = new Date(now.getTime() - CORNER_DONE_WINDOW_DAYS * 86_400_000);
  const runs = unitIds.length ? await loadRuns(prisma, {
    unitId: { in: unitIds },
    OR: [{ status: { notIn: TERMINAL_RUN } }, { status: "COMPLETED", completedAt: { gte: since } }],
    plan: { is: { status: { not: "CANCELLED" } } },
  }) : [];
  const views = await viewsOf(prisma, runs, { now });
  const groups = new Map(CORNER_GROUPS.map((g) => [g.key, []]));
  let notApplicable = 0;
  for (const v of views) {
    const card = cornerCardOf(v);
    if (!card.group) { notApplicable += 1; continue; } // TIDAK_BERLAKU tetap di Meja
    groups.get(card.group).push(card);
  }
  const byUnit = (a, b) => String(a.unit.unitCode).localeCompare(String(b.unit.unitCode), "id", { numeric: true });
  return {
    groups: CORNER_GROUPS.map((g) => ({ key: g.key, label: g.label, count: groups.get(g.key).length, items: groups.get(g.key).sort(byUnit) })),
    notApplicable, doneWindowDays: CORNER_DONE_WINDOW_DAYS,
    note: "Tanpa urutan, kapasitas, atau target Corner (belum ada kontrak server). Pekerjaan dicatat di Aplikasi Corner.",
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// TULIS — Tetapkan/Ganti PIC Corner
// ---------------------------------------------------------------------------------------------------------------------------------------
export async function setCornerOperator(prisma, { runId, operatorId, expectedRevision, actorId, idempotencyKey }) {
  if (!runId || !UUID_RE.test(String(runId))) throw cornerError("Pekerjaan produksi tidak valid", 400, "CORNER_RUN_REQUIRED");
  if (!operatorId || !UUID_RE.test(String(operatorId))) throw cornerError("Pilih PIC Corner", 400, "CORNER_OPERATOR_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "SET_CORNER_OPERATOR", runId, operatorId, expectedRevision: revisionExpected });

  return prisma.$transaction(async (tx) => {
    const pre = await tx.productionRun.findUnique({ where: { id: runId }, select: { id: true, plan: { select: { id: true } } } });
    if (!pre) throw cornerError("Pekerjaan produksi tidak ditemukan", 404, "CORNER_RUN_NOT_FOUND");
    if (!pre.plan) throw cornerError("Unit belum punya rencana produksi", 409, "CORNER_PLAN_MISSING");
    // Urutan kunci: rencana LEBIH DULU (sama dengan command jadwal/penugasan), lalu run. Dua Lead bersamaan diserialkan di baris rencana.
    await lockRowForUpdate(tx, "production_run_plans_v2", pre.plan.id);
    await lockRowForUpdate(tx, "production_runs_v2", runId);
    const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw cornerError("Idempotency-Key dipakai untuk isian berbeda", 409, "IDEMPOTENCY_CONFLICT");
      if (replay.status !== "APPLIED") throw cornerError("Perintah sebelumnya masih diproses", 409, "COMMAND_IN_PROGRESS");
      return { replayed: true, ...replay.response };
    }
    const run = await tx.productionRun.findUnique({ where: { id: runId }, include: RUN_VIEW_INCLUDE });
    if (!run?.plan) throw cornerError("Unit belum punya rencana produksi", 409, "CORNER_PLAN_MISSING");
    const writer = resolveProductionWriterState(await loadV2Flags(tx));
    if (!isProductionWriterEnabledFor(writer, run.unitId)) throw cornerError("Unit ini belum diaktifkan untuk alur produksi baru", 503, "CORNER_WRITER_OFF");
    const plan = run.plan;
    if (plan.revision !== revisionExpected) {
      throw cornerError(`Rencana sudah berubah (revisi ${plan.revision}, Anda memakai ${revisionExpected}). Muat ulang lalu ulangi.`, 409, "PLAN_REVISION_CONFLICT", {
        revision: plan.revision, currentCornerOperatorId: plan.cornerOperatorId ?? null,
      });
    }
    const ctx = await loadStepContext(tx, run);
    const { corner } = cornerAndLifecycleOf(run, ctx);
    const rule = canReassignCorner({
      cornerStatus: corner.status, buildTrack: !!ctx.state?.buildTrack, cornerRequired: ctx.state?.buildTrack ? (ctx.buildSetting?.cornerRequired ?? null) : null,
      runStatus: run.status, planStatus: plan.status, hasPlan: true,
    });
    if (!rule.allowed) throw cornerError(rule.reason, 409, rule.code, { cornerStatus: corner.status });
    // Tahap Corner yang sedang aktif/dijeda (sabuk pengaman terhadap aturan pengalihan PLAN_RUN_IN_PROGRESS yang sudah ada).
    const running = await tx.productionOperationRun.count({ where: { runId, status: { in: ["ACTIVE", "PAUSED"] }, stageCode: { in: ["corner_sewing", "finished"] } } });
    if (running > 0) throw cornerError("Tahap Corner sedang dikerjakan/dijeda; selesaikan dulu sebelum mengganti PIC", 409, "PLAN_RUN_IN_PROGRESS");

    const operator = await tx.productionOperator.findFirst({
      where: { id: operatorId, active: true, user: { AND: [bukanAdminOwner, { active: true }] } },
      select: { id: true, user: { select: { name: true } } },
    });
    if (!operator) throw cornerError("PIC Corner tidak valid: operator harus aktif dan bukan akun Admin/Owner", 422, "CORNER_OPERATOR_INVALID");

    const previous = plan.cornerOperatorId ? await tx.productionOperator.findUnique({ where: { id: plan.cornerOperatorId }, select: { id: true, user: { select: { name: true } } } }) : null;
    const command = await tx.v2Command.create({ data: { domain: "PRODUCTION", actorId: actor, idempotencyKey, commandType: "SET_CORNER_OPERATOR", aggregateType: "ProductionRunPlan", aggregateId: plan.id, expectedRevision: revisionExpected, requestHash } });
    const unchanged = plan.cornerOperatorId === operatorId;
    const now = new Date();
    let revision = plan.revision;
    if (!unchanged) {
      revision = plan.revision + 1;
      // HANYA cornerOperatorId (+ penanda revisi/command). Meja, tanggal, target, PIC Meja, urutan, work center tidak disentuh.
      await tx.productionRunPlan.update({ where: { id: plan.id }, data: { cornerOperatorId: operatorId, revision, commandId: command.id } });
      await tx.domainOutbox.create({
        data: {
          domain: "PRODUCTION", eventType: "production.plan.corner-operator-set", aggregateType: "ProductionRunPlan", aggregateId: plan.id, aggregateRevision: revision,
          dedupeKey: `production-plan-corner-operator:${plan.id}:${revision}`,
          payload: { planId: plan.id, runId, unitId: run.unitId, fromOperatorId: plan.cornerOperatorId ?? null, toOperatorId: operatorId, revision, occurredAt: now.toISOString(), actorId: actorId || null },
        },
      });
      await recordActivity(tx, {
        entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_CORNER_OPERATOR_SET, actorId: actorId || null,
        metadata: { unitCode: run.unit.unitCode, planId: plan.id, fromOperatorId: plan.cornerOperatorId ?? null, fromName: previous?.user?.name ?? null, toOperatorId: operatorId, toName: operator.user.name, revision },
      });
    }
    const response = {
      runId, planId: plan.id, revision, changed: !unchanged,
      cornerOperator: { id: operator.id, name: operator.user.name }, previousCornerOperator: previous ? { id: previous.id, name: previous.user?.name ?? null } : null,
      productionDate: plan.productionDate ? formatProductionDate(plan.productionDate) : null, stationCode: plan.stationCode ?? null,
    };
    await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision: revision, response, completedAt: now } });
    return { replayed: false, ...response };
  });
}
