// Retur sisa bahan produksi -> Gudang (antrean retur WAJIB).
//
// Kontrak:
//  - Saat tahap 12 selesai (handoff barang jadi dibuat) `createLeftoverReturnsInTx` menghitung SISA tiap bahan unit itu:
//      sisa = diserahkan (material_issue_lines.issuedQty, issue ISSUED) − terpakai (bukti tahap 6/7/10 payload.materials)
//             − waste − retur (stock_movements WASTE/RETURN bertaut unit)
//    dan membuat satu baris PENDING per bahan (sisa > 0). Satu baris per (run, material) (unique).
//  - Barang jadi TIDAK bisa diterima Gudang selama ada baris PENDING (`assertNoPendingReturnsInTx`, dipanggil dari
//    acceptUnitCustody barang jadi): 409 RETURN_PENDING.
//  - Gudang menerima fisik sisa bahan lewat `receiveMaterialReturn`: satu transaksi = baris dikunci -> stock_movements RETURN
//    (ledger kanonis, tertaut unit) -> RECEIVED. Diterima kurang dari sisa wajib catatan (selisih TIDAK dibukukan otomatis —
//    Gudang mencatat waste manual). Idempoten (v2_commands per actor+key); revisi dicek.
//  - Writer di balik flag production_v2_writer (cohort unitIds, fail-closed).
import { createHash } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockRowForUpdate, postStockMovement } from "./inventoryLedger.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,128}$/;
const EPS = 1e-6;
const round4 = (n) => Math.round(n * 10000) / 10000;
const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
function returnError(message, statusCode, code, details) { return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) }); }

// Murni: hitung sisa per material dari angka mentah (diuji unit).
export function computeLeftovers({ issued, used, wasted, returned }) {
  const out = [];
  for (const [materialId, issuedQty] of issued) {
    const left = round4(issuedQty - (used.get(materialId) || 0) - (wasted.get(materialId) || 0) - (returned.get(materialId) || 0));
    if (left > EPS) out.push({ materialId, qty: left });
  }
  return out.sort((a, b) => a.materialId.localeCompare(b.materialId));
}

// Sisa bahan run saat ini (BACA-SAJA; dipakai pembuatan retur DAN pratinjau "Selesaikan Produksi"). null bila run belum punya rencana.
export async function computeRunLeftovers(client, run) {
  const plan = await client.productionRunPlan.findUnique({ where: { runId: run.id }, select: { id: true } });
  if (!plan) return null;
  const [issueLines, evidence, moves, buildRecord] = await Promise.all([
    client.materialIssueLine.findMany({ where: { materialIssue: { productionPlanId: plan.id, status: "ISSUED" } }, select: { materialId: true, issuedQty: true } }),
    client.productionStepEvidence.findMany({ where: { runId: run.id, stepNo: { in: [6, 7, 10] }, NOT: { stepCode: { startsWith: "DOC_" } } }, select: { payload: true } }),
    client.stockMovement.findMany({ where: { unitId: run.unitId, type: { in: ["WASTE", "RETURN"] } }, select: { materialId: true, type: true, qty: true } }),
    // Jalur pengerjaan: pemakaian aktual yang dicatat PIC Bahan (versi TERBARU = keadaan sekarang; satu sumber dengan bukti PIC Meja — dijaga command).
    client.productionBuildMaterialRecord.findFirst({ where: { runId: run.id }, orderBy: { version: "desc" }, select: { materials: true } }),
  ]);
  const sum = (m, id, v) => m.set(id, (m.get(id) || 0) + v);
  const issued = new Map(), used = new Map(), wasted = new Map(), returned = new Map();
  for (const l of issueLines) sum(issued, l.materialId, Number(l.issuedQty || 0));
  for (const e of evidence) for (const l of e.payload?.materials || []) sum(used, l.materialId, Number(l.qty || 0));
  for (const l of buildRecord?.materials || []) sum(used, l.materialId, Number(l.qty || 0));
  for (const m of moves) sum(m.type === "WASTE" ? wasted : returned, m.materialId, Math.abs(Number(m.qty)));
  return computeLeftovers({ issued, used, wasted, returned });
}

export async function createLeftoverReturnsInTx(tx, { run, actorId, commandId = null }) {
  const leftovers = await computeRunLeftovers(tx, run);
  if (!leftovers) return { created: 0 };
  for (const l of leftovers) {
    const existing = await tx.productionMaterialReturn.findUnique({ where: { runId_materialId: { runId: run.id, materialId: l.materialId } } });
    if (!existing) {
      await tx.productionMaterialReturn.create({ data: { runId: run.id, unitId: run.unitId, materialId: l.materialId, qty: l.qty, commandId } });
    } else if (existing.status === "PENDING") {
      if (Math.abs(Number(existing.qty) - l.qty) > EPS) await tx.productionMaterialReturn.update({ where: { id: existing.id }, data: { qty: l.qty, revision: existing.revision + 1, commandId } });
    } else {
      // Rework/siklus kedua menghasilkan sisa baru setelah retur sebelumnya diterima: buka lagi (revisi naik), jangan hilangkan jejak.
      await tx.productionMaterialReturn.update({ where: { id: existing.id }, data: { status: "PENDING", qty: l.qty, revision: existing.revision + 1, receivedById: null, receivedAt: null, receivedQty: null, note: null, commandId } });
    }
  }
  if (leftovers.length) {
    await tx.domainOutbox.create({
      data: {
        domain: "PRODUCTION", eventType: "production.material_return.requested", aggregateType: "ProductionRun", aggregateId: run.id, aggregateRevision: 1,
        dedupeKey: `production-material-return-requested:${run.id}:${commandId || Date.now()}`,
        payload: { runId: run.id, unitId: run.unitId, lines: leftovers, occurredAt: new Date().toISOString(), actorId: actorId || null },
      },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_MATERIAL_RETURN_REQUESTED, actorId: actorId || null,
      metadata: { unitCode: run.unit?.unitCode, runId: run.id, lineCount: leftovers.length },
    });
  }
  return { created: leftovers.length };
}

// Dipanggil dari acceptUnitCustody (barang jadi) SEBELUM menulis apa pun.
export async function assertNoPendingReturnsInTx(tx, runId) {
  const pending = await tx.productionMaterialReturn.findMany({ where: { runId, status: "PENDING" }, select: { id: true, qty: true, material: { select: { code: true } } } });
  if (pending.length) {
    throw returnError(`Retur sisa bahan belum diterima Gudang (${pending.map((p) => `${p.material.code} ${Number(p.qty)}`).join(", ")}). Terima retur di Antrean Produksi dulu.`, 409, "RETURN_PENDING", { count: pending.length });
  }
}

export async function listMaterialReturns(prisma, { status = "PENDING", unitIds = null } = {}) {
  const rows = await prisma.productionMaterialReturn.findMany({
    where: { ...(status ? { status } : {}), ...(unitIds ? { unitId: { in: unitIds } } : {}) },
    orderBy: { requestedAt: "asc" },
    include: { material: { select: { id: true, code: true, name: true, unit: true } }, run: { select: { unit: { select: { id: true, unitCode: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id, revision: r.revision, runId: r.runId, status: r.status, qty: Number(r.qty), receivedQty: r.receivedQty != null ? Number(r.receivedQty) : null,
    requestedAt: r.requestedAt, receivedAt: r.receivedAt,
    material: r.material, unit: { id: r.run.unit.id, unitCode: r.run.unit.unitCode },
  }));
}

export async function receiveMaterialReturn(prisma, { returnId, actorId, idempotencyKey, expectedRevision, qty = null, note = null }) {
  if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) throw returnError("Idempotency-Key wajib diisi (12-128 karakter)", 400, "IDEMPOTENCY_KEY_INVALID");
  const rev = Number(expectedRevision);
  if (!Number.isInteger(rev) || rev < 1) throw returnError("expectedRevision wajib diisi", 400, "EXPECTED_REVISION_REQUIRED");
  const actor = actorId || "SYSTEM";
  const qtyIn = qty == null || qty === "" ? null : Number(qty);
  if (qtyIn != null && (!Number.isFinite(qtyIn) || qtyIn <= 0)) throw returnError("Jumlah diterima harus lebih dari 0", 400, "RETURN_QTY_INVALID");
  const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 300) : null;
  const requestHash = hash({ commandType: "RECEIVE_MATERIAL_RETURN", returnId, expectedRevision: rev, qty: qtyIn, note: cleanNote });

  return prisma.$transaction(async (tx) => {
    const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw returnError("Idempotency-Key dipakai untuk payload berbeda", 409, "IDEMPOTENCY_CONFLICT");
      if (replay.status !== "APPLIED") throw returnError("Command masih diproses", 409, "COMMAND_IN_PROGRESS");
      return { replayed: true, ...replay.response };
    }
    await lockRowForUpdate(tx, "production_material_returns_v2", returnId);
    const row = await tx.productionMaterialReturn.findUnique({ where: { id: returnId }, include: { material: { select: { code: true } }, run: { select: { unit: { select: { unitCode: true } } } } } });
    if (!row) throw returnError("Retur tidak ditemukan", 404, "RETURN_NOT_FOUND");
    const state = resolveProductionWriterState(await loadV2Flags(tx));
    if (!isProductionWriterEnabledFor(state, row.unitId)) throw returnError("Unit ini belum diaktifkan untuk alur produksi baru", 503, "RETURN_WRITER_OFF");
    if (row.status !== "PENDING") throw returnError("Retur ini sudah diterima", 409, "RETURN_ALREADY_RECEIVED", { revision: row.revision });
    if (row.revision !== rev) throw returnError(`Revisi retur berubah: diharapkan ${rev}, sekarang ${row.revision}. Muat ulang.`, 409, "RETURN_REVISION_CONFLICT", { revision: row.revision });
    const requested = Number(row.qty);
    const receivedQty = qtyIn == null ? requested : round4(qtyIn);
    if (receivedQty > requested + EPS) throw returnError(`Jumlah diterima (${receivedQty}) melebihi sisa yang diajukan (${requested})`, 422, "RETURN_QTY_EXCEEDS");
    if (receivedQty < requested - EPS && !cleanNote) throw returnError("Diterima kurang dari sisa: catatan wajib diisi (selisih dicatat Gudang sebagai waste manual)", 422, "RETURN_NOTE_REQUIRED");

    const command = await tx.v2Command.create({ data: { domain: "WAREHOUSE", actorId: actor, idempotencyKey, commandType: "RECEIVE_MATERIAL_RETURN", aggregateType: "ProductionMaterialReturn", aggregateId: returnId, expectedRevision: rev, requestHash } });
    const movement = await postStockMovement(tx, {
      materialId: row.materialId, type: "RETURN", qty: receivedQty, unitId: row.unitId, note: `Retur sisa produksi ${row.run.unit.unitCode}${cleanNote ? ` — ${cleanNote}` : ""}`, createdById: actorId || null,
    });
    const revision = row.revision + 1;
    const now = new Date();
    await tx.productionMaterialReturn.update({ where: { id: returnId }, data: { status: "RECEIVED", revision, receivedById: actorId || null, receivedAt: now, receivedQty, note: cleanNote, commandId: command.id } });
    await tx.domainOutbox.create({
      data: {
        domain: "WAREHOUSE", eventType: "warehouse.material_return.received", aggregateType: "ProductionMaterialReturn", aggregateId: returnId, aggregateRevision: revision,
        dedupeKey: `warehouse-material-return-received:${returnId}:${revision}`,
        payload: { returnId, runId: row.runId, unitId: row.unitId, materialId: row.materialId, qty: receivedQty, movementId: movement?.id ?? null, occurredAt: now.toISOString(), actorId: actorId || null },
      },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: row.unitId, eventType: EVENT_TYPES.PRODUCTION_MATERIAL_RETURN_RECEIVED, actorId: actorId || null,
      metadata: { unitCode: row.run.unit.unitCode, materialCode: row.material.code, qty: receivedQty },
    });
    const response = { returnId, status: "RECEIVED", revision, qty: receivedQty, requestedQty: requested };
    await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision: revision, response, completedAt: now } });
    return { replayed: false, ...response };
  });
}
