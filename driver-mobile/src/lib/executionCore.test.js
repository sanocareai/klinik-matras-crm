import test from "node:test";
import assert from "node:assert/strict";
import {
  createIdempotencyKey,
  isRetryableExecutionError,
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
