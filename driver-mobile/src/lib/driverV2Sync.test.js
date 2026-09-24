import test from "node:test";
import assert from "node:assert/strict";
import { createDriverV2Sync, driverV2CacheKey } from "./driverV2Sync.js";

function storageWith(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
    _values: values,
  };
}

function route(routeId, routeRevision = 1, jobs = [{ id: `${routeId}-j1`, status: "ASSIGNED", _v2: { jobRevision: 1 } }]) {
  return {
    routeId, routeRevision, publicationVersion: routeRevision, routeStatus: "PUBLISHED",
    jobs: jobs.map((job) => ({ ...job, route: { id: routeId, status: "PUBLISHED" } })),
  };
}

function snapshot(items, overrides = {}) {
  return {
    mode: "FULL_SNAPSHOT", driverId: "u1", cacheSchemaVersion: 2,
    items, hasMore: false, nextSnapshotCursor: null, deltaCursor: "cursor-1",
    boundarySequence: "1", feedVersion: 1, ...overrides,
  };
}

test("first launch menyelesaikan semua page sebelum menyimpan cursor dan render", async () => {
  const storage = storageWith({ "driver-my-jobs-v1": JSON.stringify({ jobs: [{ id: "legacy" }] }) });
  const calls = [];
  const api = {
    async getDriverV2Snapshot(cursor) {
      calls.push(cursor);
      return cursor == null
        ? snapshot([route("r1")], { hasMore: true, nextSnapshotCursor: "page-2", deltaCursor: null })
        : snapshot([route("r2")], { deltaCursor: "delta-ready" });
    },
    async ackDriverV2Cursor(cursor, deviceId) { calls.push(["ack", cursor, deviceId]); },
  };
  const sync = createDriverV2Sync({ storage, api });
  const value = await sync.load("u1", "d1", { snapshotPageSize: 1 });
  assert.deepEqual(value.routes.map((item) => item.id), ["r1", "r2"]);
  assert.deepEqual(calls, [null, "page-2", ["ack", "delta-ready", "d1"]]);
  const persisted = JSON.parse(await storage.getItem(driverV2CacheKey("u1", "d1")));
  assert.equal(persisted.cursor, "delta-ready");
  assert.equal(persisted.driverId, "u1");
  assert.equal(persisted.deviceId, "d1");
  assert.equal(await storage.getItem("driver-my-jobs-v1") != null, true);
});

test("pergantian user menghapus cache principal lama, bukan menampilkan job user sebelumnya", async () => {
  const storage = storageWith();
  const api = {
    async getDriverV2Snapshot() {
      return snapshot([], { driverId: api.user, deltaCursor: `cursor-${api.user}` });
    },
    async ackDriverV2Cursor() {},
    user: "u1",
  };
  const sync = createDriverV2Sync({ storage, api });
  await sync.load("u1", "d1");
  assert.ok(await storage.getItem(driverV2CacheKey("u1", "d1")));
  api.user = "u2";
  await sync.load("u2", "d1");
  assert.equal(await storage.getItem(driverV2CacheKey("u1", "d1")), null);
});

test("offline restart dan token expiry gagal eksplisit tanpa mengembalikan stale cache", async () => {
  const storage = storageWith();
  const online = createDriverV2Sync({ storage, api: {
    async getDriverV2Snapshot() { return snapshot([route("old")]); },
    async ackDriverV2Cursor() {},
  } });
  await online.load("u1", "d1");

  const offline = createDriverV2Sync({ storage, api: {
    async getDriverV2Snapshot() { throw Object.assign(new Error("Koneksi timeout"), { status: 401 }); },
    async ackDriverV2Cursor() {},
  } });
  await assert.rejects(offline.load("u1", "d1"), (error) => error.status === 401);
});

test("REMOVE_ROUTE atomik, duplicate delta idempoten, dan route terminal tidak kembali dari snapshot stale", async () => {
  const storage = storageWith();
  let snapshotRoute = route("r1", 4);
  let deltaCall = 0;
  const api = {
    async getDriverV2Snapshot() { return snapshot([snapshotRoute], { deltaCursor: "d1", boundarySequence: "1" }); },
    async getDriverV2Changes() {
      deltaCall += 1;
      return {
        mode: "DELTA", feedVersion: 1, hasMore: false, cursor: "d2",
        events: [{ sequence: "2", kind: "REMOVE_ROUTE", aggregateId: "r1", aggregateRevision: 5, payload: { routeId: "r1" } }],
      };
    },
    async ackDriverV2Cursor() {},
  };
  const sync = createDriverV2Sync({ storage, api });
  await sync.load("u1", "d1");
  const removed = await sync.load("u1", "d1");
  assert.equal(removed.routes.length, 0);
  const duplicate = await sync.load("u1", "d1");
  assert.equal(duplicate.routes.length, 0);
  assert.equal(deltaCall, 2);
  assert.equal((await sync.fullRefresh("u1", "d1")).routes.length, 0);
  snapshotRoute = route("r1", 6);
  assert.equal((await sync.fullRefresh("u1", "d1")).routes.length, 1);
});

test("REMOVE_JOB, cursor gap, dan reassignment memaksa full refresh authoritative", async () => {
  const storage = storageWith();
  let snapshots = 0;
  let deltaMode = "REMOVE_JOB";
  const api = {
    async getDriverV2Snapshot() {
      snapshots += 1;
      const items = snapshots >= 3 ? [route("r-new", 3, [{ id: "j2", _v2: { jobRevision: 3 } }])] : [route("r-old", 1, [
        { id: "j1", _v2: { jobRevision: 1 } }, { id: "j2", _v2: { jobRevision: 1 } },
      ])];
      return snapshot(items, { deltaCursor: `d${snapshots}`, boundarySequence: String(snapshots) });
    },
    async getDriverV2Changes() {
      if (deltaMode === "REMOVE_JOB") return {
        mode: "DELTA", feedVersion: 1, hasMore: false, cursor: "d2",
        events: [{ sequence: "2", kind: "REMOVE_JOB", aggregateId: "j1", aggregateRevision: 2, payload: { jobId: "j1" } }],
      };
      if (deltaMode === "GAP") return { mode: "FULL_REFRESH_REQUIRED", reason: "CURSOR_GAP" };
      return {
        mode: "DELTA", feedVersion: 1, hasMore: false, cursor: "d4",
        events: [{ sequence: "4", kind: "UPSERT_ROUTE", aggregateId: "r-new", aggregateRevision: 3 }],
      };
    },
    async ackDriverV2Cursor() {},
  };
  const sync = createDriverV2Sync({ storage, api });
  await sync.load("u1", "d1");
  assert.deepEqual((await sync.load("u1", "d1")).jobs.map((job) => job.id), ["j2"]);
  deltaMode = "GAP";
  await sync.load("u1", "d1");
  assert.equal(snapshots, 2);
  deltaMode = "UPSERT";
  const reassigned = await sync.load("u1", "d1");
  assert.deepEqual(reassigned.routes.map((item) => item.id), ["r-new"]);
});

test("cache korup direset dan cache schema/route count dibatasi", async () => {
  const key = driverV2CacheKey("u1", "d1");
  const storage = storageWith({ [key]: "{rusak" });
  const api = {
    async getDriverV2Snapshot() { return snapshot([route("r1"), route("r2")]); },
    async ackDriverV2Cursor() {},
  };
  const sync = createDriverV2Sync({ storage, api, maxRoutes: 1 });
  await assert.rejects(sync.load("u1", "d1"), (error) => error.code === "ACTIVE_ROUTE_CACHE_LIMIT");
});

test("snapshot defensif menolak route COMPLETED/CANCELLED walau server/cache stale", async () => {
  const completed = route("done", 9);
  completed.routeStatus = "COMPLETED";
  const cancelled = route("cancelled", 4);
  cancelled.routeStatus = "CANCELLED";
  const sync = createDriverV2Sync({ storage: storageWith(), api: {
    async getDriverV2Snapshot() { return snapshot([completed, cancelled]); },
    async ackDriverV2Cursor() {},
  } });
  const value = await sync.load("u1", "d1");
  assert.equal(value.routes.length, 0);
  assert.equal(value.jobs.length, 0);
});
