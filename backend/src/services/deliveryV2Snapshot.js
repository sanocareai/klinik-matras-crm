import { createHash } from "node:crypto";

export const DRIVER_ACTIVE_ROUTE_STATUSES_V2 = Object.freeze(["PUBLISHED", "IN_PROGRESS"]);

const DRIVER_ACTIVE_ROUTE_STATUS_SET_V2 = new Set(DRIVER_ACTIVE_ROUTE_STATUSES_V2);
const DRIVER_TERMINAL_JOB_STATUS_SET_V2 = new Set(["COMPLETED", "FAILED", "RESCHEDULED", "CANCELLED"]);

export function isDriverActiveRouteStatusV2(status) {
  return DRIVER_ACTIVE_ROUTE_STATUS_SET_V2.has(status);
}

export function isDriverVisibleAssignmentV2(routeStatus, assignmentStatus) {
  if (!isDriverActiveRouteStatusV2(routeStatus)) return false;
  if (assignmentStatus === "ACTIVE") return true;
  return routeStatus === "IN_PROGRESS" && assignmentStatus === "COMPLETED";
}

// Recipient feed harus memakai predicate yang sama dengan full snapshot.
// Route PUBLISHED tanpa stop aktif tidak boleh menerima UPSERT_ROUTE; kalau
// publication lama masih terlihat, transisi rekonsiliasi wajib menghasilkan
// REMOVE_ROUTE. Pada IN_PROGRESS, stop selesai tetap boleh menjadi konteks.
export function hasDriverVisibleRouteSnapshotV2(snapshot) {
  if (!isDriverActiveRouteStatusV2(snapshot?.status)) return false;
  return (snapshot?.stops || []).some((stop) => {
    const assignmentStatus = DRIVER_TERMINAL_JOB_STATUS_SET_V2.has(stop.status) ? "COMPLETED" : "ACTIVE";
    return isDriverVisibleAssignmentV2(snapshot.status, assignmentStatus);
  });
}

function normalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value.toJSON === "function") return normalize(value.toJSON());
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function deliveryV2Checksum(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export const DELIVERY_V2_ROUTE_INCLUDE = Object.freeze({
  jobs: {
    orderBy: [{ sequence: "asc" }, { id: "asc" }],
    include: {
      deliveryStateV2: { select: { jobRevision: true } },
      cancellationV2: {
        select: { id: true, reason: true, actorId: true, cancelledAt: true, previousStatus: true },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          category: true,
          deliveryAddress: true,
          deliveryCity: true,
          locationUrl: true,
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
      vehicle: { select: { id: true, plateNumber: true, type: true } },
      units: { select: { unitId: true } },
    },
  },
  vehicle: { select: { id: true, plateNumber: true, type: true } },
});

export function buildDeliveryRouteSnapshot(route, { routeRevision, publicationVersion = null } = {}) {
  const snapshot = {
    schemaVersion: 1,
    routeId: route.id,
    code: route.code,
    date: normalize(route.date),
    status: route.status,
    routeRevision,
    publicationVersion,
    driverId: route.driverId ?? null,
    helperId: route.helperId ?? null,
    vehicleId: route.vehicleId ?? null,
    vehicle: route.vehicle ?? null,
    notes: route.notes ?? null,
    manualMapsUrl: route.manualMapsUrl ?? null,
    plannedDistanceKm: route.plannedDistanceKm ?? null,
    plannedDurationMin: route.plannedDurationMin ?? null,
    publishedAt: normalize(route.publishedAt),
    lastEditedAt: normalize(route.lastEditedAt),
    lastEditReason: route.lastEditReason ?? null,
    stops: (route.jobs || []).filter((job) => !job.cancellationV2).map((job, index) => ({
      jobId: job.id,
      sequence: job.sequence ?? index + 1,
      type: job.type,
      status: job.status,
      scheduledDate: normalize(job.scheduledDate),
      driverId: job.driverId ?? null,
      helperId: job.helperId ?? null,
      vehicleId: job.vehicleId ?? null,
      addressText: job.addressText ?? null,
      addressCity: job.addressCity ?? null,
      lat: job.lat ?? null,
      lng: job.lng ?? null,
      accessNotes: job.accessNotes ?? null,
      returnToDepotBefore: Boolean(job.returnToDepotBefore),
      order: job.order ?? null,
      unitIds: (job.units || []).map((item) => item.unitId),
    })),
  };
  return normalize(snapshot);
}

export function deliveryJobSource(job) {
  return normalize({
    id: job.id,
    routeId: job.routeId ?? null,
    driverId: job.driverId ?? null,
    status: job.status,
    updatedAt: job.updatedAt,
    ...(job.cancellationV2 ? {
      cancellation: {
        id: job.cancellationV2.id,
        reason: job.cancellationV2.reason,
        actorId: job.cancellationV2.actorId ?? null,
        cancelledAt: job.cancellationV2.cancelledAt,
        previousStatus: job.cancellationV2.previousStatus,
      },
    } : {}),
  });
}

export function routeRecipients(snapshot) {
  return [...new Set([snapshot?.driverId, snapshot?.helperId].filter(Boolean))].sort();
}
