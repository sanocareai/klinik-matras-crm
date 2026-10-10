// Pagar kepemilikan Production Run V2 (Production Workshop + Warehouse V2, P6). BACA-SAJA: modul ini tidak menulis apa pun.
//
//  - detectRunInconsistency: deteksi (murni) unit yang statusnya diubah manual di V1 saat run V2 masih aktif.
//  - assertRunConsistent / assertNoOpenRunException: dipakai command P5/P6 supaya FAIL-CLOSED — tidak ada command yang melanjutkan
//    state yang tidak konsisten atau yang punya exception rekonsiliasi OPEN.
//  - findV2OwnedUnitIds / assertOrderUnitsNotV2Owned: pagar jalur V1 di sisi Sales/Order (dropdown status, batalkan, buka kembali) untuk
//    unit COHORT yang punya run aktif. Writer OFF / non-cohort / tanpa run => tidak ada efek (perilaku V1 identik).
import { findV1Drift } from "./unitV2Ownership.js";
import { PRODUCTION_WRITER_MODE, isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";

export const RUN_TERMINAL_STATUSES = Object.freeze(["COMPLETED", "CANCELLED"]);
// Run yang "dimiliki" V2 dan masih berjalan (BLOCKED = terhenti tapi belum selesai).
// PENDING_ARRIVAL (P9A, One-Location Production Intake) ikut dihitung "dimiliki" —
// unit yang pickup-nya sudah berhasil tapi belum dikonfirmasi tiba di workshop TETAP
// milik V2 (kartu sudah tampil di Production); mutasi status unit manual dari V1 saat
// run masih PENDING_ARRIVAL harus TETAP terdeteksi sebagai inkonsistensi, sama seperti
// ACTIVE/BLOCKED — bukan celah yang diam-diam lolos guard ini.
export const RUN_OWNED_STATUSES = Object.freeze(["PENDING_ARRIVAL", "ACTIVE", "BLOCKED"]);

const UNIT_STATUS_KIND = Object.freeze({
  CANCELLED: "UNIT_CANCELLED",
  READY_FOR_DELIVERY: "UNIT_MARKED_READY",
  READY_ON_CUSTOMER_HOLD: "UNIT_MARKED_READY",
  IN_TRANSIT_OUT: "UNIT_SHIPPED",
  DELIVERED: "UNIT_SHIPPED",
});

// Resolusi yang sah per jenis konflik. RESTORE tidak berlaku bila unit sudah keluar gudang (UNIT_SHIPPED): kondisi fisik tidak bisa ditebak.
export const ALLOWED_RESOLUTIONS = Object.freeze({
  UNIT_CANCELLED: Object.freeze(["CANCEL_RUN", "RESTORE_UNIT_STATUS"]),
  UNIT_MARKED_READY: Object.freeze(["RESTORE_UNIT_STATUS", "ACCEPT_OVERRIDE"]),
  UNIT_SHIPPED: Object.freeze(["ACCEPT_OVERRIDE"]),
});

export function guardError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}

// run: { status, currentPhase, revision }, unit: { status }. Mengembalikan null bila konsisten.
export function detectRunInconsistency({ run, unit }) {
  if (!run || !unit || !RUN_OWNED_STATUSES.includes(run.status)) return null;
  const kind = UNIT_STATUS_KIND[unit.status];
  if (!kind) return null;
  return { kind, unitStatus: unit.status, runPhase: run.currentPhase ?? null, runRevision: run.revision };
}

export function assertRunConsistent(run, unit) {
  const found = detectRunInconsistency({ run, unit });
  if (found) {
    throw guardError(
      `Status unit (${unit.status}) tidak konsisten dengan Production Run yang masih berjalan — kemungkinan diubah manual di V1. Catat konflik lalu selesaikan lewat rekonsiliasi.`,
      409, "PRODUCTION_RUN_INCONSISTENT", found,
    );
  }
}

export async function assertNoOpenRunException(tx, runId) {
  const open = await tx.productionRunException.findFirst({ where: { runId, status: "OPEN" }, select: { id: true, kind: true } });
  if (open) {
    throw guardError("Pekerjaan produksi ini punya konflik data yang belum diselesaikan — selesaikan dulu sebelum melanjutkan.", 409, "PRODUCTION_RUN_EXCEPTION_OPEN", { exceptionId: open.id, kind: open.kind });
  }
  await assertNoV1Drift(tx, { runId });
}

// Rollback writer OFF -> aksi V1 -> writer ON kembali: aksi V1 yang ditulis saat Run non-terminal ada (penanda PRODUCTION_V1_WRITE_ON_V2_RUN, satu transaksi dengan
// mutasinya) membuat proyeksi V2 (operasi, Planned BOM, reservasi, rencana) TIDAK lagi dijamin sama dengan state V1. SELURUH command V2 yang memuat run/plan/issue
// berhenti (409) — tidak ada yang melanjutkan state lama diam-diam. Rekonsiliasi = batalkan Run (CANCEL_RUN, command resmi QC/Run — loader-nya sengaja TIDAK
// memakai gerbang ini); unit lalu dikerjakan lewat V1 dan Run baru dibuka lewat alur custody/rework yang sah. Menerima + menyinkronkan state V1 ke proyeksi V2
// BELUM ada (butuh keputusan desain) — tidak ditebak di sini.
export async function assertNoV1Drift(tx, { runId, unitId = null }) {
  const uid = unitId ?? (await tx.productionRun.findUnique({ where: { id: runId }, select: { unitId: true } }))?.unitId;
  if (!uid) return;
  const drift = await findV1Drift(tx, { runId, unitId: uid });
  if (drift) {
    throw guardError(
      "Production Run ini punya aksi V1 yang dikerjakan saat V2 tidak memegang eksekusi (writer dimatikan) — proyeksi V2 bisa berbeda dari state V1. Command V2 dihentikan sampai direkonsiliasi (batalkan Run lalu lanjutkan lewat V1/Run baru).",
      409, "PRODUCTION_RUN_V1_DRIFT", { runId, count: drift.count, kinds: drift.kinds, lastAt: drift.lastAt },
    );
  }
}

// Unit (dari daftar) yang writer-nya aktif DAN punya run V2 non-terminal.
export async function findV2OwnedUnitIds(tx, unitIds) {
  const ids = [...new Set((unitIds || []).filter(Boolean))];
  if (ids.length === 0) return [];
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  if (state.mode === PRODUCTION_WRITER_MODE.OFF) return [];
  const candidates = ids.filter((id) => isProductionWriterEnabledFor(state, id));
  if (candidates.length === 0) return [];
  const runs = await tx.productionRun.findMany({ where: { unitId: { in: candidates }, status: { notIn: [...RUN_TERMINAL_STATUSES] } }, select: { unitId: true } });
  return [...new Set(runs.map((run) => run.unitId))];
}

// Pagar mutasi unit langsung dari jalur Order V1 (dropdown Sales dst). Melempar 409 bila ada unit order yang dimiliki V2.
export async function assertOrderUnitsNotV2Owned(tx, orderId, actionLabel) {
  const units = await tx.unit.findMany({ where: { orderId }, select: { id: true, unitCode: true } });
  const owned = new Set(await findV2OwnedUnitIds(tx, units.map((unit) => unit.id)));
  if (owned.size === 0) return;
  const codes = units.filter((unit) => owned.has(unit.id)).map((unit) => unit.unitCode).join(", ");
  throw guardError(
    `${actionLabel} ditolak: unit ${codes} sedang dalam proses Production V2. Selesaikan lewat antrean QC/Gudang, atau batalkan Production Run-nya lebih dulu (Production Lead).`,
    409, "PRODUCTION_V2_OWNED", { unitCodes: codes.split(", ") },
  );
}
