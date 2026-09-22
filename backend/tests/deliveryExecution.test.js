import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTLED_JOB_STATUSES,
  normalizeProofLocation,
  requireIdempotencyKey,
  validateFailureInput,
  validateJobTransition,
  validatePodInput,
} from "../src/services/deliveryExecution.js";

test("state machine menerima seluruh transisi driver yang valid", () => {
  assert.doesNotThrow(() => validateJobTransition("START", "ASSIGNED"));
  assert.doesNotThrow(() => validateJobTransition("ARRIVE", "EN_ROUTE"));
  assert.doesNotThrow(() => validateJobTransition("COMPLETE", "ARRIVED"));
  for (const status of ["ASSIGNED", "EN_ROUTE", "ARRIVED"]) {
    assert.doesNotThrow(() => validateJobTransition("FAIL", status));
  }
});

test("state machine menolak lompatan dan transisi terminal", () => {
  assert.throws(() => validateJobTransition("ARRIVE", "ASSIGNED"), /tidak bisa/);
  assert.throws(() => validateJobTransition("COMPLETE", "EN_ROUTE"), /tidak bisa/);
  assert.throws(() => validateJobTransition("START", "COMPLETED"), /tidak bisa/);
  assert.throws(() => validateJobTransition("FAIL", "FAILED"), /tidak bisa/);
  assert.doesNotThrow(() => validateJobTransition("COMPLETE", "ASSIGNED", { privileged: true }));
});

test("POD wajib foto dan nama, GPS boleh null saat izin ditolak", () => {
  assert.throws(() => validatePodInput({ proofPhotoUrls: ["/media/job-photos/a.jpg"] }), /Nama/);
  assert.throws(() => validatePodInput({ recipientName: "Budi", proofPhotoUrls: [] }), /foto/);
  const pod = validatePodInput({ recipientName: " Budi ", proofPhotoUrls: ["/media/job-photos/a.jpg"], location: null });
  assert.equal(pod.recipientName, "Budi");
  assert.equal(pod.location, null);
});

test("validasi foto menolak URL eksternal/path traversal dan GPS invalid", () => {
  assert.throws(() => validatePodInput({ recipientName: "Budi", proofPhotoUrls: ["https://evil.example/a.jpg"] }), /URL foto/);
  assert.throws(() => validateFailureInput({ failureReason: "Akses ditolak", failurePhotoUrls: ["/media/job-photos/../x.jpg"] }), /URL foto/);
  assert.throws(() => normalizeProofLocation({ lat: 100, lng: 10 }), /Lokasi/);
});

test("failed/rescheduled dihitung settled untuk penyelesaian route", () => {
  assert.deepEqual(SETTLED_JOB_STATUSES, ["COMPLETED", "FAILED", "RESCHEDULED"]);
});

test("idempotency key stabil diterima dan key malformed ditolak", () => {
  const req = { get: () => "driver-abc-123456", body: {} };
  assert.equal(requireIdempotencyKey(req), "driver-abc-123456");
  assert.throws(() => requireIdempotencyKey({ get: () => "pendek", body: {} }), /Idempotency-Key/);
});
