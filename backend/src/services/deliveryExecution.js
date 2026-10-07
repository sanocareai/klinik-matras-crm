import { randomUUID } from "node:crypto";

const TRANSITIONS = Object.freeze({
  START: new Set(["ASSIGNED"]),
  ARRIVE: new Set(["EN_ROUTE"]),
  COMPLETE: new Set(["ARRIVED"]),
  FAIL: new Set(["ASSIGNED", "EN_ROUTE", "ARRIVED"]),
});

export const SETTLED_JOB_STATUSES = Object.freeze(["COMPLETED", "FAILED", "RESCHEDULED"]);

export function validateJobTransition(action, status, { privileged = false } = {}) {
  const allowed = TRANSITIONS[action];
  if (!allowed) throw Object.assign(new Error(`Aksi tidak dikenal: ${action}`), { statusCode: 400 });
  // Input POD manual dispatcher tetap kompatibel dengan alur existing.
  if (action === "COMPLETE" && privileged && ["SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"].includes(status)) return;
  if (!allowed.has(status)) {
    throw Object.assign(new Error(`Job berstatus ${status}, tidak bisa menjalankan aksi ${action}`), { statusCode: 409 });
  }
}

export function requireIdempotencyKey(req) {
  // Klien lama tetap kompatibel; Driver App Slice 2 selalu mengirim key
  // stabil. Fallback hanya membuat satu request legacy aman diproses.
  const key = String(req.get("Idempotency-Key") || req.body?.idempotencyKey || `legacy-${randomUUID()}`).trim();
  if (!/^[A-Za-z0-9._:-]{12,128}$/.test(key)) {
    throw Object.assign(new Error("Idempotency-Key wajib diisi (12-128 karakter)"), { statusCode: 400 });
  }
  return key;
}

const SUMBER_DIKENAL = new Set(["WEB", "DRIVER_APP"]);

// Histori Waktu Route & Stop (7 Okt 2026) — occurredAt = waktu KEJADIAN
// menurut klien (device clock saat tombol ditekan), BEDA dari createdAt
// DeliveryExecutionEvent (waktu server commit, @default(now()) saat insert).
// Untuk aksi yang SEMPAT mengantre offline, klien mengirim waktu TAP ASLI
// (driver-mobile: item.createdAt dari executionQueue.js, direkam saat
// enqueue — BUKAN saat akhirnya terkirim). TIDAK PERNAH menolak nilai yang
// kelihatan janggal (jam device rusak tetap aksi sah, lihat
// services/routeTimeline.js#evaluateEventTiming yang MELABELI, bukan
// memblokir) — kalau klien tidak mengirim apa pun/tidak valid, default ke
// SEKARANG (fakta nyata: server menerima aksi ini sekarang), bukan nilai
// karangan yang lain.
export function resolveClientTiming(req) {
  const raw = req.body?.occurredAt;
  let occurredAt = null;
  if (raw != null) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) occurredAt = d;
  }
  if (!occurredAt) occurredAt = new Date();
  const rawSource = typeof req.body?.clientPlatform === "string" ? req.body.clientPlatform.toUpperCase() : null;
  const source = rawSource && SUMBER_DIKENAL.has(rawSource) ? rawSource : null;
  return { occurredAt, source };
}

export function normalizeProofLocation(value) {
  if (value == null) return null; // GPS best-effort: izin ditolak tidak memblokir.
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  const accuracy = value.accuracy == null ? null : Number(value.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw Object.assign(new Error("Lokasi bukti tidak valid"), { statusCode: 400 });
  }
  if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000)) {
    throw Object.assign(new Error("Akurasi lokasi tidak valid"), { statusCode: 400 });
  }
  return { lat, lng, accuracy };
}

export function validatePodInput(body) {
  const recipientName = String(body?.recipientName || "").trim();
  const proofPhotoUrls = Array.isArray(body?.proofPhotoUrls) ? body.proofPhotoUrls : [];
  if (!recipientName) throw Object.assign(new Error("Nama penerima/pemberi barang wajib diisi"), { statusCode: 400 });
  if (recipientName.length > 160) throw Object.assign(new Error("Nama penerima terlalu panjang"), { statusCode: 400 });
  if (proofPhotoUrls.length === 0) throw Object.assign(new Error("Minimal satu foto bukti wajib diisi"), { statusCode: 400 });
  if (!proofPhotoUrls.every(isJobPhotoUrl)) throw Object.assign(new Error("URL foto tidak valid"), { statusCode: 400 });
  const note = body?.note == null ? null : String(body.note).trim().slice(0, 2000) || null;
  return { recipientName, proofPhotoUrls, note, location: normalizeProofLocation(body?.location) };
}

export function validateFailureInput(body) {
  const failureReason = String(body?.failureReason || "").trim();
  const failurePhotoUrls = Array.isArray(body?.failurePhotoUrls) ? body.failurePhotoUrls : [];
  if (!failureReason) throw Object.assign(new Error("Alasan kegagalan wajib diisi"), { statusCode: 400 });
  if (failurePhotoUrls.length === 0) throw Object.assign(new Error("Minimal satu foto kegagalan wajib diisi"), { statusCode: 400 });
  if (!failurePhotoUrls.every(isJobPhotoUrl)) throw Object.assign(new Error("URL foto tidak valid"), { statusCode: 400 });
  const note = body?.note == null ? null : String(body.note).trim().slice(0, 2000) || null;
  return { failureReason, failurePhotoUrls, note, location: normalizeProofLocation(body?.location) };
}

export function isJobPhotoUrl(value) {
  return typeof value === "string" && /^\/media\/job-photos\/[A-Za-z0-9._-]+$/.test(value);
}

export async function lockJob(tx, jobId) {
  await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE NOWAIT`;
  return tx.job.findUnique({ where: { id: jobId } });
}

export async function lockRoute(tx, routeId) {
  await tx.$queryRaw`SELECT id FROM routes WHERE id = ${routeId}::uuid FOR UPDATE NOWAIT`;
  return tx.route.findUnique({ where: { id: routeId } });
}

export async function findExecutionReplay(tx, idempotencyKey, actorId, action, { jobId = null, routeId = null } = {}) {
  const event = await tx.deliveryExecutionEvent.findUnique({ where: { idempotencyKey } });
  if (!event) return null;
  if (
    event.actorId !== actorId
    || event.action !== action
    || (jobId != null && event.jobId !== jobId)
    || (routeId != null && event.routeId !== routeId)
  ) {
    throw Object.assign(new Error("Idempotency-Key sudah dipakai untuk aksi lain"), { statusCode: 409 });
  }
  return event;
}

export function createExecutionEvent(tx, { idempotencyKey, action, actorId, jobId = null, routeId = null, payload = null, occurredAt = null, source = null }) {
  return tx.deliveryExecutionEvent.create({
    data: { idempotencyKey, action, actorId, jobId, routeId, payload, occurredAt, source },
  });
}
