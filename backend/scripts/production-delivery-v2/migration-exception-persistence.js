import { checksum } from "./common.js";

// Resolusi yang boleh dibawa forward antar-run. Selain ini (mis. tebakan otomatis) TIDAK dibawa: exception dibuka lagi.
export const CARRY_FORWARD_PROVENANCES = Object.freeze(["PRODUCTION_ADMIN_BYPASS", "OPS_ROUTE_ASSIGNMENT_DECISION"]);
const KEY_FIELDS = ["domain", "aggregateType", "aggregateId", "code"];

export const evidenceFingerprint = (evidence) => checksum(evidence ?? {});

function keyOf(exception) {
  return Object.fromEntries(KEY_FIELDS.map((field) => [field, exception[field]]));
}

function isCarryEligible(prior) {
  return CARRY_FORWARD_PROVENANCES.includes(prior?.resolution?.provenance);
}

// Membuka kembali (fail-closed) exception yang sudah RESOLVED karena evidence berubah. Histori resolusi
// dipertahankan utuh di resolution.previous (rantai bersarang bila dibuka berulang kali).
function reopenedResolution(prior, exception) {
  return {
    reopened: true,
    reason: "EVIDENCE_CHANGED",
    reopenedAt: new Date().toISOString(),
    previous: {
      exceptionId: prior.id,
      status: prior.status,
      resolution: prior.resolution ?? null,
      resolvedById: prior.resolvedById ?? null,
      resolvedAt: prior.resolvedAt ? new Date(prior.resolvedAt).toISOString() : null,
      evidenceChecksum: evidenceFingerprint(prior.evidence),
    },
    currentEvidenceChecksum: evidenceFingerprint(exception.evidence),
  };
}

// Satu baris per (run, domain, aggregateType, aggregateId, code) — idempoten di dalam run; antar-run
// menurunkan status dari exception sebelumnya:
//   RESOLVED (provenance sah) + fingerprint sama        -> tetap RESOLVED
//   RESOLVED (provenance sah) + evidence berubah        -> OPEN (dibuka lagi) + histori resolusi
//   OPEN hasil pembukaan-ulang                          -> tetap OPEN (tidak turun ke KEEP_V1 secara diam-diam)
//   selain itu                                          -> status bawaan exception
export async function createMigrationExceptionWithResolutionCarryForward(tx, { runId, exception }) {
  const key = keyOf(exception);
  const fingerprint = evidenceFingerprint(exception.evidence);

  const inRun = await tx.v2MigrationException.findUnique({
    where: { runId_domain_aggregateType_aggregateId_code: { runId, ...key } },
  });
  if (inRun) {
    if (evidenceFingerprint(inRun.evidence) === fingerprint) return inRun;
    return tx.v2MigrationException.update({
      where: { id: inRun.id },
      data: {
        evidence: exception.evidence,
        severity: exception.severity,
        ...(inRun.status === "RESOLVED"
          ? { status: "OPEN", resolution: reopenedResolution(inRun, exception), resolvedById: null, resolvedAt: null }
          : {}),
      },
    });
  }

  const latest = await tx.v2MigrationException.findFirst({
    where: { ...key, runId: { not: runId } },
    orderBy: [{ createdAt: "desc" }],
  });
  let carry = {};
  if (latest?.status === "OPEN" && latest.resolution?.reopened === true) {
    carry = {
      status: "OPEN",
      resolution: evidenceFingerprint(latest.evidence) === fingerprint
        ? latest.resolution
        : { ...latest.resolution, evidenceChangedAfterReopen: true, currentEvidenceChecksum: fingerprint },
    };
  } else {
    const prior = await tx.v2MigrationException.findFirst({
      where: { ...key, status: "RESOLVED" },
      orderBy: [{ resolvedAt: "desc" }, { createdAt: "desc" }],
    });
    if (prior && isCarryEligible(prior)) {
      carry = evidenceFingerprint(prior.evidence) === fingerprint
        ? { status: "RESOLVED", resolution: prior.resolution, resolvedById: prior.resolvedById, resolvedAt: prior.resolvedAt }
        : { status: "OPEN", resolution: reopenedResolution(prior, exception) };
    }
  }
  return tx.v2MigrationException.create({ data: { runId, ...exception, ...carry } });
}

// Menjalankan fn di dalam SAVEPOINT: kegagalan (termasuk error database yang meracuni transaksi) hanya
// membatalkan bagian itu. Tanpa ini satu item bermasalah menggagalkan seluruh transaksi batch.
export async function withSavepoint(tx, name, fn) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new TypeError("Nama savepoint tidak valid");
  await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    const value = await fn();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, value };
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return { ok: false, error };
  }
}

// Menyimpan seluruh exception; satu exception yang gagal dicatat di `failures`, yang lain tetap tersimpan.
export async function persistMigrationExceptions(tx, { runId, exceptions }) {
  const persisted = [];
  const failures = [];
  for (const [index, exception] of exceptions.entries()) {
    const outcome = await withSavepoint(tx, `v2_exception_${index}`, () => createMigrationExceptionWithResolutionCarryForward(tx, { runId, exception }));
    if (outcome.ok) persisted.push(outcome.value);
    else failures.push({ kind: "EXCEPTION", aggregateType: exception.aggregateType, aggregateId: exception.aggregateId, code: exception.code, message: String(outcome.error?.message || outcome.error).slice(0, 300) });
  }
  return { persisted, failures };
}
