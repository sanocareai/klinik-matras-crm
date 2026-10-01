// Aplikasi Dokumentasi produksi V2 (P10B): antrean, detail matriks, dan command tulis (tambah / koreksi) dokumentasi foto.
//
// Penulisan memakai tabel bukti yang SUDAH ADA (production_step_evidence_v2, immutable) dengan penanda stepCode "DOC_<KATEGORI>" dan
// versi >= 1000 — TIDAK ada tabel/penyimpanan paralel. Dokumentasi TIDAK menyelesaikan tahap, TIDAK menaikkan revisi run, TIDAK memutasi
// status produksi/unit/plan (loadStepContext memisahkan baris DOC_ dari lifecycle). Tahap yang mewajibkan foto tetap ditutup command owner
// tahap (productionStepCommandService) setelah gate buktinya terpenuhi.
//
// Command: idempotency per (actor, kunci) lewat v2_commands + hash isi (replay = respons sama; isi beda = 409); run dikunci baris
// (lockRowForUpdate) SEBELUM replay-check sehingga dua submit bersamaan serial dan yang kedua melihat hasil yang pertama.
// Koreksi = baris BARU (supersedes) dengan alasan, pengunggah, waktu; baris lama tetap ada (histori). Writer di balik production_v2_writer
// (cohort unitIds, fail-closed) + permission PRODUCTION_DOCUMENTATION_WRITE (route). Tidak ada pembatasan PIC: peran dokumentasi
// khusus memang untuk semua unit cohort; IDOR dicegah oleh cohort + pengikatan berkas ke satu unit.
import { createHash, randomUUID } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";
import { loadStepContext } from "./productionStepCommandService.js";
import { RUN_VIEW_INCLUDE, toRunView } from "./productionExperienceReadService.js";
import { buildRunDocumentation, summarizeMatrix } from "./productionDocumentationRead.js";
import { signUnitPhotoUrlsBulk } from "../routes/productionUnitPhoto.js";
import { evidenceFileExists } from "../lib/productionEvidenceStore.js";
import {
  DOC_CATEGORY_BY_KEY, DOC_QUEUE_FILTERS, isUuid, DOC_REASON_MIN, DOC_STEP_CODE_PREFIX, DOC_VERSION_BASE, docError, docStepCode, deriveDocSource,
  matchesDocFilter, normalizeDocItems, parseDocRows,
} from "../lib/domain/productionDocumentation.js";
import { mediaKindOf, STEP_BY_NO } from "../lib/domain/productionSteps.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,128}$/;
const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
const TERMINAL_HIDDEN = ["CANCELLED"];

// ---------------------------------------------------------------------------------------------------------------------------
// Baca
// ---------------------------------------------------------------------------------------------------------------------------
function cardOf(view, matrix, photoUrl) {
  const c = view.customer;
  return {
    runId: view.runId, status: view.status,
    unit: { id: view.unit.id, unitCode: view.unit.unitCode, merk: view.unit.merk, ukuran: view.unit.ukuran, photoUrl: photoUrl ?? null },
    customerName: c.name, orderNumber: c.orderNumber,
    services: { sales: c.salesServices, technical: view.unit.service?.label ?? null },
    step: view.next?.stepNo ? { stepNo: view.next.stepNo, label: STEP_BY_NO[view.next.stepNo]?.label ?? null } : null,
    bucket: view.bucket, bucketLabel: view.bucketLabel,
    station: view.plan?.stationLabel ?? null, stationCode: view.plan?.stationCode ?? null,
    pic: { table: view.plan?.operator?.name ?? null, corner: view.plan?.cornerOperator?.name ?? null },
    progress: view.progress,
    docs: summarizeMatrix(matrix),
  };
}

export async function getDocumentationQueue(prisma, { unitIds, filter = "ALL", q = "", limit = 150 }) {
  const f = DOC_QUEUE_FILTERS.includes(filter) ? filter : "ALL";
  const runs = await prisma.productionRun.findMany({
    where: { unitId: { in: unitIds }, status: { notIn: TERMINAL_HIDDEN } }, include: RUN_VIEW_INCLUDE, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(Number(limit) || 150, 1), 300),
  });
  const photoByUnit = await signUnitPhotoUrlsBulk(prisma, runs.map((r) => r.unitId));
  const needle = String(q || "").trim().toLowerCase().slice(0, 80);
  const cards = [];
  for (const run of runs) {
    const ctx = await loadStepContext(prisma, run);
    const view = toRunView(run, ctx, { photoUrl: photoByUnit.get(run.unitId) ?? null });
    if (needle) {
      const hay = [view.customer.name, view.customer.orderNumber, view.unit.unitCode].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    cards.push(cardOf(view, await buildRunDocumentation(prisma, run, ctx), photoByUnit.get(run.unitId)));
  }
  const counts = Object.fromEntries(DOC_QUEUE_FILTERS.map((k) => [k, cards.filter((c) => matchesDocFilter(c.docs.flags, k)).length]));
  // Urut: yang paling kurang dulu (kerja yang paling perlu), lalu kode unit.
  const items = cards.filter((c) => matchesDocFilter(c.docs.flags, f)).sort((a, b) => b.docs.missingTotal - a.docs.missingTotal || a.unit.unitCode.localeCompare(b.unit.unitCode));
  return { filter: f, counts, items };
}

export async function getDocumentationDetail(prisma, runId, { unitIds }) {
  if (!isUuid(runId)) return null;
  const run = await prisma.productionRun.findFirst({ where: { id: runId, unitId: { in: unitIds } }, include: RUN_VIEW_INCLUDE });
  if (!run) return null;
  const ctx = await loadStepContext(prisma, run);
  const photoByUnit = await signUnitPhotoUrlsBulk(prisma, [run.unitId]);
  const view = toRunView(run, ctx, { photoUrl: photoByUnit.get(run.unitId) ?? null });
  const matrix = await buildRunDocumentation(prisma, run, ctx);
  return { ...cardOf(view, matrix, photoByUnit.get(run.unitId)), categories: matrix.categories, totals: matrix.totals };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------------------------------------------------------
async function writerGate(tx, unitId) {
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  if (!isProductionWriterEnabledFor(state, unitId)) throw docError("Produksi V2 tidak aktif untuk unit ini; dokumentasi belum bisa dikirim", 503, "DOC_WRITER_OFF");
}

// actor: { id, hasQcWrite, hasInventoryWrite } — dihitung route dari req.user (server = otoritas izin).
// Hubungan pengunggah dengan unit hanya dipakai untuk MENENTUKAN SUMBER foto (Produksi/Corner), bukan untuk membatasi.
export function documentationActorRelation(actor, plan) {
  return {
    isTableOperator: !!plan?.operator?.userId && plan.operator.userId === actor.id,
    isCornerOperator: !!plan?.cornerOperator?.userId && plan.cornerOperator.userId === actor.id,
  };
}

// Untuk route unggah: kenali run + writer cohort SEBELUM menerima berkas apa pun.
export async function assertCanUploadDocumentation(prisma, { runId }) {
  if (!runId) throw docError("runId wajib diisi", 400, "DOC_RUN_REQUIRED");
  if (!isUuid(runId)) throw docError("Production Run tidak ditemukan", 404, "DOC_RUN_NOT_FOUND");
  const run = await prisma.productionRun.findUnique({ where: { id: String(runId || "") }, select: { id: true, unitId: true, status: true } });
  if (!run) throw docError("Production Run tidak ditemukan", 404, "DOC_RUN_NOT_FOUND");
  await writerGate(prisma, run.unitId);
  if (TERMINAL_HIDDEN.includes(run.status)) throw docError("Produksi unit ini dibatalkan", 409, "DOC_RUN_CANCELLED");
  return run;
}

async function otherUnitUsesFile(tx, runId, url) {
  const rows = await tx.$queryRaw`SELECT 1 AS x FROM production_step_evidence_v2 e WHERE e.run_id <> ${runId}::uuid AND e.media @> ${JSON.stringify([{ url }])}::jsonb LIMIT 1`;
  return rows.length > 0;
}

export async function recordDocumentation(prisma, { runId, actor, idempotencyKey, category, items, note = null, supersedesEvidenceId = null, reason = null }) {
  if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) throw docError("Idempotency-Key wajib diisi (12-128 karakter)", 400, "IDEMPOTENCY_KEY_INVALID");
  if (!isUuid(runId)) throw docError("Production Run tidak ditemukan", 404, "DOC_RUN_NOT_FOUND");
  const cat = DOC_CATEGORY_BY_KEY[category];
  if (!cat) throw docError("Kategori dokumentasi tidak dikenal", 400, "DOC_CATEGORY_INVALID");
  const normalized = normalizeDocItems(items, { urlKind: mediaKindOf });
  const correcting = supersedesEvidenceId != null && supersedesEvidenceId !== "";
  const cleanReason = typeof reason === "string" ? reason.trim() : "";
  if (correcting && cleanReason.length < DOC_REASON_MIN) throw docError(`Alasan koreksi wajib diisi (minimal ${DOC_REASON_MIN} karakter)`, 400, "DOC_REASON_REQUIRED");
  if (correcting && cleanReason.length > 300) throw docError("Alasan koreksi terlalu panjang (maksimal 300 karakter)", 400, "DOC_REASON_TOO_LONG");
  const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 300) : null;
  const requestHash = hash({ commandType: correcting ? "DOCUMENT_CORRECT" : "DOCUMENT_ADD", runId, category, items: normalized.map((i) => [i.url, i.caption, i.order]), note: cleanNote, supersedesEvidenceId: correcting ? supersedesEvidenceId : null, reason: correcting ? cleanReason : null });
  const actorKey = actor.id || "SYSTEM";

  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "production_runs_v2", runId);
    const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actorKey, idempotencyKey } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw docError("Idempotency-Key dipakai untuk isi berbeda", 409, "IDEMPOTENCY_CONFLICT");
      if (replay.status !== "APPLIED") throw docError("Perintah masih diproses", 409, "COMMAND_IN_PROGRESS");
      return { replayed: true, ...replay.response };
    }
    const run = await tx.productionRun.findUnique({ where: { id: runId }, select: { id: true, unitId: true, status: true, unit: { select: { unitCode: true } }, plan: { select: { operator: { select: { userId: true } }, cornerOperator: { select: { userId: true } } } } } });
    if (!run) throw docError("Production Run tidak ditemukan", 404, "DOC_RUN_NOT_FOUND");
    await writerGate(tx, run.unitId);
    if (TERMINAL_HIDDEN.includes(run.status)) throw docError("Produksi unit ini dibatalkan", 409, "DOC_RUN_CANCELLED");
    const ownership = documentationActorRelation(actor, run.plan);

    for (const it of normalized) {
      if (!evidenceFileExists(it.url)) throw docError("Ada foto yang belum selesai terunggah — unggah ulang lalu kirim", 422, "DOC_MEDIA_NOT_FOUND");
      if (await otherUnitUsesFile(tx, runId, it.url)) throw docError("Foto ini sudah dipakai sebagai bukti unit lain dan tidak bisa dipakai di sini", 409, "DOC_MEDIA_OTHER_UNIT");
    }
    const rows = await tx.productionStepEvidence.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
    const docRows = parseDocRows(rows.filter((r) => String(r.stepCode).startsWith(DOC_STEP_CODE_PREFIX)));
    let target = null;
    if (correcting) {
      target = docRows.find((r) => r.evidenceId === supersedesEvidenceId);
      if (!target) throw docError("Dokumentasi yang dikoreksi tidak ditemukan di unit ini", 404, "DOC_CORRECTION_TARGET_NOT_FOUND");
      if (target.category !== category) throw docError("Kategori koreksi harus sama dengan dokumentasi yang dikoreksi", 409, "DOC_CORRECTION_CATEGORY_MISMATCH");
      if (target.superseded) throw docError("Dokumentasi ini sudah dikoreksi — koreksi versi terbaru", 409, "DOC_ALREADY_SUPERSEDED");
    }
    // Duplikat: foto yang sudah tercatat (bukti tahap atau dokumentasi aktif) di unit ini tidak boleh dikirim lagi; foto dari baris yang
    // sedang dikoreksi boleh dipakai ulang (mis. hanya mengganti keterangan).
    const taken = new Set();
    for (const r of rows) if (!String(r.stepCode).startsWith(DOC_STEP_CODE_PREFIX)) for (const m of Array.isArray(r.media) ? r.media : []) taken.add(m.url);
    for (const r of docRows) if (!r.superseded && r.evidenceId !== target?.evidenceId) for (const it of r.items) taken.add(it.url);
    if (normalized.some((it) => taken.has(it.url))) throw docError("Foto ini sudah tercatat sebagai dokumentasi/bukti unit ini", 409, "DOC_MEDIA_ALREADY_SUBMITTED");

    const source = deriveDocSource({ category, isTableOperator: ownership.isTableOperator, isCornerOperator: ownership.isCornerOperator, hasQcWrite: !!actor.hasQcWrite, hasInventoryWrite: !!actor.hasInventoryWrite });
    const maxVersion = rows.filter((r) => r.stepNo === cat.storeStepNo && r.version >= DOC_VERSION_BASE).reduce((m, r) => Math.max(m, r.version), DOC_VERSION_BASE - 1);
    const command = await tx.v2Command.create({
      data: { domain: "PRODUCTION", actorId: actorKey, idempotencyKey, commandType: correcting ? "DOCUMENT_CORRECT" : "DOCUMENT_ADD", aggregateType: "ProductionRun", aggregateId: runId, expectedRevision: null, requestHash },
    });
    const evidence = await tx.productionStepEvidence.create({
      data: {
        id: randomUUID(), runId, operationRunId: null, stageId: null, stepNo: cat.storeStepNo, stepCode: docStepCode(category), version: maxVersion + 1,
        payload: { documentation: { category, source, items: normalized.map((i) => ({ url: i.url, caption: i.caption, order: i.order })), note: cleanNote, ...(correcting ? { supersedesEvidenceId, reason: cleanReason } : {}) } },
        media: normalized.map((i) => ({ url: i.url, kind: i.kind })),
        actorId: actor.id || null, commandId: command.id,
      },
    });
    await tx.domainOutbox.create({
      data: {
        domain: "PRODUCTION", eventType: "production.documentation.recorded", aggregateType: "ProductionRun", aggregateId: runId, aggregateRevision: evidence.version,
        dedupeKey: `production-documentation-recorded:${command.id}`,
        payload: { runId, unitId: run.unitId, evidenceId: evidence.id, category, source, count: normalized.length, corrected: correcting, occurredAt: new Date().toISOString(), actorId: actor.id || null },
      },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: correcting ? EVENT_TYPES.PRODUCTION_DOCUMENTATION_CORRECTED : EVENT_TYPES.PRODUCTION_DOCUMENTATION_ADDED, actorId: actor.id || null,
      metadata: { unitCode: run.unit.unitCode, runId, category, categoryLabel: cat.label, count: normalized.length, source, ...(correcting ? { reason: cleanReason } : {}) },
    });
    const response = { evidenceId: evidence.id, category, version: evidence.version, count: normalized.length, source, corrected: correcting };
    await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision: evidence.version, response, completedAt: new Date() } });
    return { replayed: false, ...response };
  });
}
