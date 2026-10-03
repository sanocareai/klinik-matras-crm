// P12B.6 — kepemilikan V2 atas unit. SATU definisi dipakai engine tahap/QC/blokir (assertNotV2ExecutionOwned) DAN endpoint V1 layanan/prioritas/target/rute/penugasan/bahan:
//   unit DIMILIKI V2 = flag writer aktif untuk unit itu DAN punya Production Run non-terminal (COMPLETED/CANCELLED = terminal).
// Alasannya: command owner V2 (Diagnosis, Rencana Produksi, Material Issue, Workshop, QC) semuanya butuh writer ON + Run. Selama salah satunya tidak ada
// (writer OFF / reader-only / cohort belum punya Run / Run sudah selesai), TIDAK ADA jalur V2 yang sah — jalur V1 tetap bekerja supaya unit tidak terkunci.
// Selama V2 memilikinya, jalur V1 DITOLAK 409 (UNIT_V2_OWNED) agar diagnosis, rencana (revision/idempotency/outbox V2) dan Material Issue tidak terlewati.
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";

export class UnitV2OwnedError extends Error {
  constructor(what) {
    super(`Unit ini dikelola Production V2 — ${what} diubah lewat jalur V2 (Diagnosis untuk layanan teknis, Rencana Produksi untuk prioritas/target/penugasan, Material Issue untuk bahan).`);
    this.name = "UnitV2OwnedError"; this.statusCode = 409; this.code = "UNIT_V2_OWNED";
  }
}

export async function isUnitV2ExecutionOwned(client, unitId) {
  if (!isProductionWriterEnabledFor(resolveProductionWriterState(await loadV2Flags(client)), unitId)) return false;
  const run = await client.productionRun.findFirst({ where: { unitId, status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true } });
  return !!run;
}

export async function assertUnitNotV2Owned(client, unitId, what = "data ini") {
  if (await isUnitV2ExecutionOwned(client, unitId)) throw new UnitV2OwnedError(what);
}

// Konflik atomik (compare-and-set di DB): nilai yang DILIHAT klien tidak lagi sama saat menulis.
export class UnitConflictError extends Error {
  constructor(fields, current) {
    super(`Data unit sudah diubah orang lain (${fields.join(", ")}) — muat ulang lalu coba lagi.`);
    this.name = "UnitConflictError"; this.statusCode = 409; this.code = "UNIT_CONFLICT"; this.current = current; this.fields = fields;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
