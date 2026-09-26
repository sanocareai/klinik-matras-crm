import { checksum } from "./common.js";

const CARRY_FORWARD_PROVENANCE = "PRODUCTION_ADMIN_BYPASS";

// A later catch-up run must retain an owner-approved administrative-history
// disposition, but only while the exact source evidence remains unchanged.
// Any changed evidence deliberately reopens the exception for Ops review.
export async function createMigrationExceptionWithResolutionCarryForward(tx, { runId, exception }) {
  const prior = await tx.v2MigrationException.findFirst({
    where: {
      domain: exception.domain,
      aggregateType: exception.aggregateType,
      aggregateId: exception.aggregateId,
      code: exception.code,
      status: "RESOLVED",
    },
    orderBy: [{ resolvedAt: "desc" }, { createdAt: "desc" }],
  });
  const canCarryForward = prior?.resolution?.provenance === CARRY_FORWARD_PROVENANCE
    && checksum(prior.evidence) === checksum(exception.evidence);

  return tx.v2MigrationException.create({
    data: {
      runId,
      ...exception,
      ...(canCarryForward ? {
        status: "RESOLVED",
        resolution: prior.resolution,
        resolvedById: prior.resolvedById,
        resolvedAt: prior.resolvedAt,
      } : {}),
    },
  });
}
