// P12B.6 — kepemilikan V2 atas unit. SATU definisi dipakai engine tahap/QC/blokir (assertNotV2ExecutionOwned) DAN endpoint V1 layanan/prioritas/target/rute/penugasan/bahan:
//   unit DIMILIKI V2 = flag writer aktif untuk unit itu DAN punya Production Run non-terminal (COMPLETED/CANCELLED = terminal).
// Alasannya: command owner V2 (Diagnosis, Rencana Produksi, Material Issue, Workshop, QC) semuanya butuh writer ON + Run. Selama salah satunya tidak ada
// (writer OFF / reader-only / cohort belum punya Run / Run sudah selesai), TIDAK ADA jalur V2 yang sah — jalur V1 tetap bekerja supaya unit tidak terkunci.
// Selama V2 memilikinya, jalur V1 DITOLAK 409 (UNIT_V2_OWNED) agar diagnosis, rencana (revision/idempotency/outbox V2) dan Material Issue tidak terlewati.
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

// Kunci kepemilikan unit: UPDATE nyata (bukan sekadar FOR UPDATE) pada baris unit. Selain mengunci (READ COMMITTED menunggu lalu melihat Run yang baru commit),
// UPDATE nyata membuat transaksi SERIALIZABLE (engine tahap) yang snapshot-nya lebih tua dari pembukaan Run GAGAL (P2034 -> 409 coba lagi) — bukan menulis diam-diam.
// Dipakai oleh gerbang tulis V1 DAN pembuka Run V2 (openProductionIntakeV2, openPendingArrivalIntakeV2InTx, registerWorkshopBornRun): satu kunci, satu urutan.
export class UnitConcurrentChangeError extends Error {
  constructor() {
    super("Unit sedang diubah proses lain (mis. Production V2 baru saja dibuka) — muat ulang lalu coba lagi.");
    this.name = "UnitConcurrentChangeError"; this.statusCode = 409; this.code = "UNIT_CONCURRENT_CHANGE";
  }
}
export async function lockUnitOwnership(tx, unitId) {
  try {
    await tx.$executeRawUnsafe("UPDATE units SET updated_at = now() WHERE id = $1::uuid", unitId);
  } catch (err) {
    // 40001 (SERIALIZABLE, snapshot lebih tua dari pembukaan Run) = kalah lomba -> 409 jelas, TANPA tulisan; ulang akan melihat Run dan ditolak.
    if (/40001|could not serialize/i.test(String(err?.message || ""))) throw new UnitConcurrentChangeError();
    throw err;
  }
}

// Run non-terminal = belum COMPLETED/CANCELLED (PENDING_ARRIVAL/ACTIVE/BLOCKED).
const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];
const activeRunOf = (client, unitId) => client.productionRun.findFirst({ where: { unitId, status: { notIn: TERMINAL_RUN } }, select: { id: true, status: true, revision: true } });

export class UnitV2OwnedError extends Error {
  constructor(what) {
    super(`Unit ini dikelola Production V2 — ${what} diubah lewat jalur V2 (Diagnosis untuk layanan teknis, Rencana Produksi untuk prioritas/target/penugasan, Material Issue untuk bahan).`);
    this.name = "UnitV2OwnedError"; this.statusCode = 409; this.code = "UNIT_V2_OWNED";
  }
}

export async function isUnitV2ExecutionOwned(client, unitId) {
  if (!isProductionWriterEnabledFor(resolveProductionWriterState(await loadV2Flags(client)), unitId)) return false;
  return !!(await activeRunOf(client, unitId));
}

export async function assertUnitNotV2Owned(client, unitId, what = "data ini") {
  if (await isUnitV2ExecutionOwned(client, unitId)) throw new UnitV2OwnedError(what);
}

// GERBANG TULIS V1 (SATU-SATUNYA pintu untuk layanan/prioritas/target/rute/penugasan/bahan/tahap/QC). WAJIB dipanggil di DALAM transaksi yang sama dengan
// mutasinya. Urutan kunci KONSISTEN dengan seluruh command V2 (unit -> run -> ...): kunci baris unit DULU, baru evaluasi kepemilikan, baru mutasi.
// Pembuka Run V2 (openProductionIntakeV2 / openPendingArrivalIntakeV2InTx / registerWorkshopBornRun) memegang kunci unit yang SAMA, sehingga:
//   - Run terbentuk lebih dulu -> V1 menunggu kunci, lalu melihat Run -> ditolak 409 (tak ada tulisan V1 setelah V2 memiliki unit).
//   - V1 lebih dulu -> mutasi V1 commit sebelum Run ada (urutan serial yang sah); Run baru lahir sesudahnya.
// Bila V2 TIDAK memegang eksekusi tetapi unit punya Run non-terminal (writer dimatikan / rollback), mutasi V1 diizinkan TETAPI meninggalkan penanda drift
// (PRODUCTION_V1_WRITE_ON_V2_RUN, satu transaksi dengan mutasinya) — command V2 menolak melanjutkan Run itu sampai direkonsiliasi (assertNoV1Drift).
// reject=false: hanya mencatat penanda (mis. penyelesaian blokir V1 yang tidak punya padanan V2).
export async function guardV1UnitWrite(tx, unitId, { what = "data ini", actorId = null, reject = true } = {}) {
  await lockUnitOwnership(tx, unitId);
  const writerOn = isProductionWriterEnabledFor(resolveProductionWriterState(await loadV2Flags(tx)), unitId);
  const run = await activeRunOf(tx, unitId);
  if (!run) return { run: null, drift: false };
  if (writerOn && reject) throw new UnitV2OwnedError(what);
  if (writerOn) return { run, drift: false };
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_V1_WRITE_ON_V2_RUN, actorId,
    metadata: { runId: run.id, runStatus: run.status, runRevision: run.revision, what },
  });
  return { run, drift: true };
}

// Penanda drift untuk SATU run (bacaan murni): aksi V1 tercatat saat run non-terminal dan V2 tidak memegang eksekusi.
export async function findV1Drift(client, { runId, unitId }) {
  const rows = await client.activityEvent.findMany({
    where: { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_V1_WRITE_ON_V2_RUN, metadata: { path: ["runId"], equals: runId } },
    orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, metadata: true },
  });
  if (rows.length === 0) return null;
  return { count: rows.length, lastAt: rows[0].createdAt, kinds: [...new Set(rows.map((r) => r.metadata?.what).filter(Boolean))] };
}

// Konflik atomik (compare-and-set di DB): nilai yang DILIHAT klien tidak lagi sama saat menulis.
export class UnitConflictError extends Error {
  constructor(fields, current) {
    super(`Data unit sudah diubah orang lain (${fields.join(", ")}) — muat ulang lalu coba lagi.`);
    this.name = "UnitConflictError"; this.statusCode = 409; this.code = "UNIT_CONFLICT"; this.current = current; this.fields = fields;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
