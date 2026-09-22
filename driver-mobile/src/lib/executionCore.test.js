import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyExecutionError,
  createIdempotencyKey,
  dedupeKey,
  isJobActionSatisfied,
  isRetryableExecutionError,
  isRouteStartSatisfied,
  jobActionSupersededReason,
  pendingForJob,
  queueStorageKey,
  retryDelay,
} from "./executionCore.js";

test("key idempotency unik dan cukup panjang", () => {
  const a = createIdempotencyKey("driver");
  const b = createIdempotencyKey("driver");
  assert.notEqual(a, b);
  assert.ok(a.length >= 12);
});

test("retry hanya untuk jaringan, 401, timeout, dan 5xx", () => {
  assert.equal(isRetryableExecutionError({ status: 401 }), true);
  assert.equal(isRetryableExecutionError({ status: 503 }), true);
  assert.equal(isRetryableExecutionError({ status: 409 }), false);
  assert.equal(isRetryableExecutionError(new Error("Koneksi timeout")), true);
});

test("backoff dibatasi satu menit", () => {
  assert.equal(retryDelay(0), 2000);
  assert.equal(retryDelay(1), 4000);
  assert.equal(retryDelay(99), 60000);
});

test("queue dan lookup pending selalu terisolasi per user/job", () => {
  assert.notEqual(queueStorageKey("akun-a"), queueStorageKey("akun-b"));
  assert.equal(pendingForJob([{ jobId: "a", action: "complete" }], "b"), null);
  assert.equal(pendingForJob([{ jobId: "a", action: "complete" }], "a").action, "complete");
});

test("dedupeKey membedakan job+aksi, route-start pakai routeId", () => {
  assert.equal(dedupeKey({ action: "complete", jobId: "j1" }), dedupeKey({ action: "complete", jobId: "j1" }));
  assert.notEqual(dedupeKey({ action: "complete", jobId: "j1" }), dedupeKey({ action: "start", jobId: "j1" }));
  assert.notEqual(dedupeKey({ action: "complete", jobId: "j1" }), dedupeKey({ action: "complete", jobId: "j2" }));
  assert.equal(dedupeKey({ action: "route-start", routeId: "r1", jobId: "sample" }), "route:r1:route-start");
});

test("isJobActionSatisfied mengenali target status tercapai per aksi", () => {
  assert.equal(isJobActionSatisfied("start", "EN_ROUTE"), true);
  assert.equal(isJobActionSatisfied("start", "COMPLETED"), true);
  assert.equal(isJobActionSatisfied("start", "ASSIGNED"), false);
  assert.equal(isJobActionSatisfied("arrive", "ARRIVED"), true);
  assert.equal(isJobActionSatisfied("arrive", "COMPLETED"), true);
  assert.equal(isJobActionSatisfied("arrive", "EN_ROUTE"), false);
  assert.equal(isJobActionSatisfied("complete", "COMPLETED"), true);
  assert.equal(isJobActionSatisfied("complete", "FAILED"), false);
  assert.equal(isJobActionSatisfied("fail", "FAILED"), true);
  assert.equal(isJobActionSatisfied("fail", "RESCHEDULED"), true);
  assert.equal(isJobActionSatisfied("fail", "COMPLETED"), false);
  assert.equal(isJobActionSatisfied("complete", null), false);
});

test("jobActionSupersededReason menjelaskan konflik dari status nyata, bukan tebakan", () => {
  assert.match(jobActionSupersededReason("complete", "FAILED"), /Gagal/);
  assert.match(jobActionSupersededReason("fail", "COMPLETED"), /Selesai/);
  assert.match(jobActionSupersededReason("arrive", "ASSIGNED"), /Ditugaskan/);
});

test("isRouteStartSatisfied true begitu rute bukan lagi PUBLISHED", () => {
  assert.equal(isRouteStartSatisfied("PUBLISHED"), false);
  assert.equal(isRouteStartSatisfied("IN_PROGRESS"), true);
  assert.equal(isRouteStartSatisfied("COMPLETED"), true);
  assert.equal(isRouteStartSatisfied(null), false);
});

test("classifyExecutionError: retry vs reconcile vs block", () => {
  assert.deepEqual(classifyExecutionError({ status: 401 }), { kind: "retry" });
  assert.deepEqual(classifyExecutionError({ status: 503 }), { kind: "retry" });
  assert.equal(classifyExecutionError(new Error("Koneksi timeout")).kind, "retry");
  assert.deepEqual(
    classifyExecutionError({ status: 409, message: "Aksi sedang diproses di perangkat lain. Muat ulang status lalu coba lagi." }),
    { kind: "retry" }
  );
  assert.equal(classifyExecutionError({ status: 409, message: "Job berstatus COMPLETED, tidak bisa menjalankan aksi COMPLETE" }).kind, "reconcile");
  assert.equal(classifyExecutionError({ status: 409, message: "Rute berstatus DRAFT, tidak bisa dimulai" }).kind, "reconcile");
  assert.equal(classifyExecutionError({ status: 409, message: "Idempotency-Key sudah dipakai untuk aksi lain" }).kind, "block");
  assert.equal(classifyExecutionError({ status: 403, message: "Bukan job Anda" }).kind, "block");
  assert.equal(classifyExecutionError({ status: 400, message: "URL foto tidak valid" }).kind, "block");
});
