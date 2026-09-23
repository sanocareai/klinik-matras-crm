import { createHmac, timingSafeEqual } from "node:crypto";

const CURSOR_VERSION = 1;

function cursorSecret(secret) {
  const value = secret || process.env.DRIVER_V2_CURSOR_SECRET || process.env.JWT_SECRET;
  if (!value || value.length < 16) throw Object.assign(new Error("Driver V2 cursor secret belum dikonfigurasi"), { statusCode: 503 });
  return value;
}

export function encodeDriverCursor(payload, secret) {
  const body = Buffer.from(JSON.stringify({ v: CURSOR_VERSION, ...payload })).toString("base64url");
  const signature = createHmac("sha256", cursorSecret(secret)).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function decodeDriverCursor(cursor, { userId, mode, secret } = {}) {
  if (!cursor || typeof cursor !== "string") return null;
  const [body, signature, extra] = cursor.split(".");
  if (!body || !signature || extra) throw Object.assign(new Error("Snapshot cursor tidak valid"), { statusCode: 400 });
  const expected = createHmac("sha256", cursorSecret(secret)).update(body).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { actual = Buffer.alloc(0); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw Object.assign(new Error("Snapshot cursor tidak valid"), { statusCode: 400 });
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch {
    throw Object.assign(new Error("Snapshot cursor tidak valid"), { statusCode: 400 });
  }
  if (parsed.v !== CURSOR_VERSION || (userId && parsed.userId !== userId) || (mode && parsed.mode !== mode)) {
    throw Object.assign(new Error("Snapshot cursor di luar scope"), { statusCode: 409, code: "CURSOR_SCOPE_MISMATCH" });
  }
  return parsed;
}

export async function appendDriverFeedEvent(tx, {
  userId, kind, aggregateType, aggregateId, aggregateRevision = null,
  publicationVersion = null, payload = {},
}) {
  await tx.driverFeedState.upsert({
    where: { userId },
    create: { userId, nextSequence: 1n, retentionFloor: 1n, feedVersion: 1 },
    update: {},
  });
  await tx.$queryRaw`SELECT user_id FROM driver_feed_states_v2 WHERE user_id = ${userId} FOR UPDATE`;
  const state = await tx.driverFeedState.findUniqueOrThrow({ where: { userId } });
  const event = await tx.driverSyncEvent.create({
    data: {
      userId,
      sequence: state.nextSequence,
      feedVersion: state.feedVersion,
      kind,
      aggregateType,
      aggregateId,
      aggregateRevision,
      publicationVersion,
      payload,
    },
  });
  await tx.driverFeedState.update({ where: { userId }, data: { nextSequence: { increment: 1 } } });
  return event;
}

export async function appendRouteFeedChanges(tx, {
  oldRecipients = [], newRecipients = [], routeId, routeRevision, publicationVersion, checksum,
}) {
  const oldSet = new Set(oldRecipients);
  const newSet = new Set(newRecipients);
  const events = [];
  for (const userId of [...oldSet].filter((id) => !newSet.has(id)).sort()) {
    events.push(await appendDriverFeedEvent(tx, {
      userId,
      kind: "REMOVE_ROUTE",
      aggregateType: "Route",
      aggregateId: routeId,
      aggregateRevision: routeRevision,
      publicationVersion,
      payload: { routeId, revoked: true },
    }));
  }
  for (const userId of [...newSet].sort()) {
    events.push(await appendDriverFeedEvent(tx, {
      userId,
      kind: "UPSERT_ROUTE",
      aggregateType: "Route",
      aggregateId: routeId,
      aggregateRevision: routeRevision,
      publicationVersion,
      payload: { routeId, checksum },
    }));
  }
  return events;
}

