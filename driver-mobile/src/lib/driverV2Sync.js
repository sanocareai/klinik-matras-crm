export const DRIVER_V2_CACHE_SCHEMA = 2;
export const DRIVER_V2_MAX_ROUTES = 50;
export const DRIVER_V2_MAX_JOBS = 500;
export const DRIVER_V2_MAX_TOMBSTONES = 1000;

const ACTIVE_SESSION_KEY = "driver-v2:active-session";
const ACTIVE_ROUTE_STATUSES = new Set(["PUBLISHED", "IN_PROGRESS"]);

export function driverV2CacheKey(userId, deviceId) {
  if (!userId || !deviceId) throw new Error("userId dan deviceId wajib untuk cache Driver V2");
  return `driver-v2:cache:${DRIVER_V2_CACHE_SCHEMA}:${userId}:${deviceId}`;
}

function emptyState(userId, deviceId) {
  return {
    schemaVersion: DRIVER_V2_CACHE_SCHEMA,
    userId,
    driverId: userId,
    deviceId,
    cursor: null,
    feedVersion: null,
    lastSequence: "0",
    routes: [],
    tombstones: { routes: {}, jobs: {} },
    updatedAt: null,
  };
}

function validState(value, userId, deviceId) {
  return value
    && value.schemaVersion === DRIVER_V2_CACHE_SCHEMA
    && value.userId === userId
    && value.driverId === userId
    && value.deviceId === deviceId
    && Array.isArray(value.routes)
    && value.tombstones && typeof value.tombstones === "object";
}

function revision(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 0;
}

function filterTombstones(routes, tombstones) {
  return routes.flatMap((route) => {
    if (!ACTIVE_ROUTE_STATUSES.has(route.routeStatus)) return [];
    const routeRemovedAt = revision(tombstones.routes?.[route.routeId]);
    if (routeRemovedAt >= revision(route.routeRevision)) return [];
    const jobs = (route.jobs || []).filter((job) => (
      revision(tombstones.jobs?.[job.id]) < revision(job._v2?.jobRevision)
    ));
    return [{ ...route, jobs }];
  });
}

function boundedEntries(value, max = DRIVER_V2_MAX_TOMBSTONES) {
  const entries = Object.entries(value || {});
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - max)));
}

function projectForUi(state) {
  const jobs = state.routes.flatMap((route) => route.jobs || []);
  const routes = state.routes.map((item) => ({
    ...(item.jobs?.[0]?.route || {}),
    id: item.routeId,
    status: item.routeStatus,
    revision: item.routeRevision,
    publicationVersion: item.publicationVersion,
    stopCount: item.jobs?.length || 0,
  }));
  return {
    jobs,
    routes,
    readerMode: "V2",
    sync: {
      cursor: state.cursor,
      feedVersion: state.feedVersion,
      lastSequence: state.lastSequence,
      updatedAt: state.updatedAt,
    },
  };
}

export function createDriverV2Sync({ storage, api, maxRoutes = DRIVER_V2_MAX_ROUTES }) {
  const locks = new Map();
  const memory = new Map();
  const initializedSessions = new Set();

  function withLock(key, fn) {
    const prior = locks.get(key) || Promise.resolve();
    const next = prior.then(fn, fn);
    locks.set(key, next.then(() => {}, () => {}));
    return next;
  }

  async function prepareSession(userId, deviceId) {
    const next = { userId, deviceId, schemaVersion: DRIVER_V2_CACHE_SCHEMA };
    let previous = null;
    try { previous = JSON.parse(await storage.getItem(ACTIVE_SESSION_KEY)); } catch {}
    if (previous && (previous.userId !== userId || previous.deviceId !== deviceId || previous.schemaVersion !== DRIVER_V2_CACHE_SCHEMA)) {
      if (previous.userId && previous.deviceId) {
        await storage.removeItem(driverV2CacheKey(previous.userId, previous.deviceId));
        memory.delete(driverV2CacheKey(previous.userId, previous.deviceId));
      }
    }
    await storage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(next));
  }

  async function readState(userId, deviceId) {
    const key = driverV2CacheKey(userId, deviceId);
    if (memory.has(key)) return memory.get(key);
    let parsed = null;
    try { parsed = JSON.parse(await storage.getItem(key)); } catch {}
    if (!validState(parsed, userId, deviceId)) {
      if (await storage.getItem(key)) await storage.removeItem(key);
      return null;
    }
    memory.set(key, parsed);
    return parsed;
  }

  async function writeState(state) {
    const key = driverV2CacheKey(state.userId, state.deviceId);
    memory.set(key, state);
    await storage.setItem(key, JSON.stringify(state));
  }

  async function fullRefresh(userId, deviceId, config = {}) {
    const key = driverV2CacheKey(userId, deviceId);
    return withLock(key, async () => {
      await prepareSession(userId, deviceId);
      const prior = await readState(userId, deviceId) || emptyState(userId, deviceId);
      let pageCursor = null;
      let finalPage = null;
      const routes = [];
      do {
        const page = await api.getDriverV2Snapshot(pageCursor, config.snapshotPageSize || 25);
        if (page.mode !== "FULL_SNAPSHOT" || page.driverId !== userId || page.cacheSchemaVersion !== DRIVER_V2_CACHE_SCHEMA) {
          throw Object.assign(new Error("Snapshot Driver V2 tidak sesuai sesi/perangkat"), { code: "SNAPSHOT_SCOPE_MISMATCH" });
        }
        routes.push(...(page.items || []));
        if (routes.length > maxRoutes || routes.reduce((sum, route) => sum + (route.jobs?.length || 0), 0) > DRIVER_V2_MAX_JOBS) {
          throw Object.assign(new Error("Jumlah rute/stop aktif melebihi batas cache perangkat"), { code: "ACTIVE_ROUTE_CACHE_LIMIT" });
        }
        finalPage = page;
        pageCursor = page.hasMore ? page.nextSnapshotCursor : null;
        if (page.hasMore && !pageCursor) throw new Error("Snapshot pagination tidak memiliki cursor lanjutan");
      } while (pageCursor);

      const next = {
        ...emptyState(userId, deviceId),
        cursor: finalPage?.deltaCursor || null,
        feedVersion: finalPage?.feedVersion ?? null,
        lastSequence: String(finalPage?.boundarySequence ?? "0"),
        routes: filterTombstones(routes, prior.tombstones),
        tombstones: prior.tombstones,
        updatedAt: new Date().toISOString(),
      };
      if (!next.cursor) throw new Error("Snapshot lengkap tidak menghasilkan delta cursor");
      await writeState(next);
      await api.ackDriverV2Cursor(next.cursor, deviceId).catch(() => {});
      return projectForUi(next);
    });
  }

  function applyRemove(state, event) {
    const eventRevision = revision(event.aggregateRevision);
    if (event.kind === "REMOVE_ROUTE") {
      const routeId = event.payload?.routeId || event.aggregateId;
      const prior = revision(state.tombstones.routes[routeId]);
      state.tombstones.routes[routeId] = Math.max(prior, eventRevision);
      state.routes = state.routes.filter((route) => route.routeId !== routeId);
    } else if (event.kind === "REMOVE_JOB") {
      const jobId = event.payload?.jobId || event.aggregateId;
      const prior = revision(state.tombstones.jobs[jobId]);
      state.tombstones.jobs[jobId] = Math.max(prior, eventRevision);
      state.routes = state.routes.map((route) => ({
        ...route,
        jobs: (route.jobs || []).filter((job) => job.id !== jobId),
      }));
    }
  }

  async function syncDelta(userId, deviceId, config = {}) {
    const key = driverV2CacheKey(userId, deviceId);
    const outcome = await withLock(key, async () => {
      const current = await readState(userId, deviceId);
      if (!current?.cursor) return { refresh: true };
      const state = JSON.parse(JSON.stringify(current));
      let requiresRefresh = false;
      let more = true;
      while (more) {
        const page = await api.getDriverV2Changes(state.cursor, config.deltaPageSize || 100);
        if (page.mode === "FULL_REFRESH_REQUIRED") return { refresh: true };
        if (page.mode !== "DELTA" || page.feedVersion !== state.feedVersion) return { refresh: true };
        for (const event of page.events || []) {
          const got = BigInt(event.sequence);
          const last = BigInt(state.lastSequence || "0");
          if (got <= last) continue;
          if (got !== last + 1n) return { refresh: true };
          if (event.kind === "REMOVE_ROUTE" || event.kind === "REMOVE_JOB") applyRemove(state, event);
          else requiresRefresh = true;
          state.lastSequence = String(event.sequence);
        }
        state.cursor = page.cursor;
        more = page.hasMore === true;
      }
      if (requiresRefresh) return { refresh: true };
      state.tombstones.routes = boundedEntries(state.tombstones.routes);
      state.tombstones.jobs = boundedEntries(state.tombstones.jobs);
      state.updatedAt = new Date().toISOString();
      await writeState(state);
      await api.ackDriverV2Cursor(state.cursor, deviceId).catch(() => {});
      return { value: projectForUi(state) };
    });
    return outcome.refresh ? fullRefresh(userId, deviceId, config) : outcome.value;
  }

  async function load(userId, deviceId, config = {}) {
    await prepareSession(userId, deviceId);
    const sessionKey = driverV2CacheKey(userId, deviceId);
    // Startup proses selalu full snapshot. Cache persisten hanya checkpoint
    // cursor/tombstone; ia tidak pernah dirender sebelum server mengonfirmasi.
    if (!initializedSessions.has(sessionKey)) {
      const value = await fullRefresh(userId, deviceId, config);
      initializedSessions.add(sessionKey);
      return value;
    }
    return syncDelta(userId, deviceId, config);
  }

  async function resetSession(userId, deviceId) {
    if (userId && deviceId) {
      const key = driverV2CacheKey(userId, deviceId);
      memory.delete(key);
      initializedSessions.delete(key);
      await storage.removeItem(key);
    }
    await storage.removeItem(ACTIVE_SESSION_KEY);
  }

  return { load, fullRefresh, syncDelta, readState, resetSession };
}
