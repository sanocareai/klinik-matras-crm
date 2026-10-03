// P12B.6 — kepemilikan V2 atas unit: unit yang tercantum di cohort Production V2 (reader ATAU writer) dikelola command owner V2. Jalur V1 yang mengubah
// layanan teknis / prioritas / target / rute / penugasan / bahan DITOLAK 409 (UNIT_V2_OWNED) agar diagnosis, rencana (revision/idempotency/outbox V2), dan
// Material Issue tidak terlewati. Unit di luar cohort: jalur V1 tetap berlaku. Tahap/QC/blokir dijaga engine sendiri (assertNotV2ExecutionOwned).
// Definisi cohort = flag yang SAMA dengan Unit 360 (reader) dan command V2 (writer) — tidak ada daftar kedua.
import { isProductionReaderEnabledFor, isProductionWriterEnabledFor, loadV2Flags, resolveProductionReaderState, resolveProductionWriterState } from "./v2FeatureFlags.js";

export class UnitV2OwnedError extends Error {
  constructor(what) {
    super(`Unit ini dikelola Production V2 — ${what} diubah lewat jalur V2 (Diagnosis untuk layanan teknis, Rencana Produksi untuk prioritas/target/penugasan, Material Issue untuk bahan).`);
    this.name = "UnitV2OwnedError"; this.statusCode = 409; this.code = "UNIT_V2_OWNED";
  }
}

export async function isUnitInV2Cohort(client, unitId) {
  const flags = await loadV2Flags(client);
  return isProductionReaderEnabledFor(resolveProductionReaderState(flags), unitId) || isProductionWriterEnabledFor(resolveProductionWriterState(flags), unitId);
}

export async function assertUnitNotInV2Cohort(client, unitId, what = "data ini") {
  if (await isUnitInV2Cohort(client, unitId)) throw new UnitV2OwnedError(what);
}

// Konflik atomik (compare-and-set di DB): nilai yang DILIHAT klien tidak lagi sama saat menulis.
export class UnitConflictError extends Error {
  constructor(fields, current) {
    super(`Data unit sudah diubah orang lain (${fields.join(", ")}) — muat ulang lalu coba lagi.`);
    this.name = "UnitConflictError"; this.statusCode = 409; this.code = "UNIT_CONFLICT"; this.current = current; this.fields = fields;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
