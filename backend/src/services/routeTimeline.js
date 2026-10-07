// Histori Waktu Route & Stop (7 Okt 2026) — logika MURNI (tanpa DB/HTTP),
// dipanggil dari routes/armada.js (GET /routes/:id/timeline) setelah data
// mentah (DeliveryExecutionEvent + ActivityEvent koreksi POD) diambil.
//
// SUMBER TUNGGAL: DeliveryExecutionEvent (ledger yang SUDAH ADA sejak lama,
// lihat services/deliveryExecution.js) — TIDAK ADA ledger baru. Event hanya
// pernah ditulis DI DALAM transaksi yang sama dengan transisi status (atomik)
// dan idempotencyKey mencegah retry menggandakan baris (findExecutionReplay)
// — dua properti itu SUDAH ADA, bukan ditambahkan fase ini.
//
// Prinsip "jangan mengarang": stop/milestone yang TIDAK PUNYA baris event
// sama sekali (job lama dari sebelum ledger ini mulai dipakai, atau jalur
// kode yang belum sempat menulis event) TIDAK PERNAH diisi tebakan — field-
// nya absen, frontend WAJIB menampilkan "Tidak tersedia" (lihat
// frontend/src/utils/formatDate.js & padanan driver-mobile/web).
//
// "UTC di dalam, WIB di tepi" (CLAUDE.md §11, konvensi SELURUH repo ini) —
// modul ini mengembalikan ISO UTC apa adanya; pengubahan ke WIB + kalimat
// Indonesia adalah tanggung jawab frontend/driver-mobile (formatDate.js).

// occurredAt (waktu kejadian di device) vs createdAt (waktu server commit)
// — selisih dipakai MENGHITUNG label saat BACA, bukan disimpan sebagai flag
// terpisah di DB (supaya ambang batas bisa disetel ulang tanpa migrasi).
export const LATE_SYNC_THRESHOLD_MS = 2 * 60 * 1000; // 2 menit
export const SUSPICIOUS_FUTURE_TOLERANCE_MS = 60 * 1000; // 1 menit — toleransi selisih jam wajar
export const SUSPICIOUS_PAST_THRESHOLD_MS = 7 * 24 * 3600 * 1000; // 7 hari

function toDate(value) {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Evaluasi SATU baris DeliveryExecutionEvent murni dari occurredAt/createdAt.
 * TIDAK PERNAH menolak/mengubah data — cuma MELABELI apa adanya, device
 * yang jamnya ngaco tetap tercatat (lebih jujur daripada diam-diam dibuang).
 */
export function evaluateEventTiming(event) {
  const createdAt = toDate(event.createdAt);
  const occurredAt = toDate(event.occurredAt);
  if (!occurredAt) {
    return { displayAt: createdAt, hasDeviceTime: false, lateSyncMs: null, isLateSync: false, isSuspiciousClock: false };
  }
  // Positif = device mencatat SEBELUM server menerima (normal, atau
  // terlambat sinkron saat offline). Negatif = device "dari masa depan"
  // relatif ke server — jam perangkat janggal.
  const lateSyncMs = createdAt.getTime() - occurredAt.getTime();
  const isLateSync = lateSyncMs > LATE_SYNC_THRESHOLD_MS;
  const isSuspiciousClock = lateSyncMs < -SUSPICIOUS_FUTURE_TOLERANCE_MS || lateSyncMs > SUSPICIOUS_PAST_THRESHOLD_MS;
  return { displayAt: occurredAt, hasDeviceTime: true, lateSyncMs, isLateSync, isSuspiciousClock };
}

function formatEvent(event, actorById) {
  return {
    id: event.id,
    action: event.action,
    actorId: event.actorId,
    actorName: actorById.get(event.actorId) || null,
    source: event.source || null,
    occurredAt: event.occurredAt ? new Date(event.occurredAt).toISOString() : null,
    createdAt: new Date(event.createdAt).toISOString(),
    payload: event.payload || null,
    ...evaluateEventTimingIso(event),
  };
}

function evaluateEventTimingIso(event) {
  const r = evaluateEventTiming(event);
  return {
    displayAt: r.displayAt ? r.displayAt.toISOString() : null,
    hasDeviceTime: r.hasDeviceTime,
    lateSyncMs: r.lateSyncMs,
    isLateSync: r.isLateSync,
    isSuspiciousClock: r.isSuspiciousClock,
  };
}

// Durasi antar DUA milestone — null kalau SALAH SATU tidak tersedia (tidak
// pernah menebak satu sisi dari sisi lain).
export function durationBetweenMs(eventA, eventB) {
  if (!eventA || !eventB) return null;
  const a = toDate(eventA.occurredAt || eventA.createdAt);
  const b = toDate(eventB.occurredAt || eventB.createdAt);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return ms >= 0 ? ms : null; // negatif = urutan tidak masuk akal (jam janggal) — jangan tampilkan durasi palsu
}

const JOB_ACTIONS = new Set(["JOB_STARTED", "JOB_ARRIVED", "JOB_COMPLETED", "JOB_FAILED", "JOB_RESCHEDULED"]);
const ROUTE_ACTIONS = new Set(["ROUTE_STARTED", "ROUTE_COMPLETED"]);

/**
 * events: baris DeliveryExecutionEvent mentah (routeId ini), SUDAH include actor {id,name}.
 * podEdits: baris ActivityEvent POD_EDITED (entityType=JOB) yang entityId-nya salah satu job di rute ini.
 * jobs: daftar job ringkas { id, sequence, orderNumber, customerName } urutan tampil.
 */
export function buildRouteTimeline({ route, jobs, events, podEdits = [] }) {
  const actorById = new Map();
  for (const e of events) if (e.actorId && e.actor?.name) actorById.set(e.actorId, e.actor.name);
  for (const e of podEdits) if (e.actorId && e.actor?.name) actorById.set(e.actorId, e.actor.name);

  const routeEvents = events
    .filter((e) => ROUTE_ACTIONS.has(e.action))
    .sort((a, b) => new Date(a.occurredAt || a.createdAt) - new Date(b.occurredAt || b.createdAt))
    .map((e) => formatEvent(e, actorById));

  const eventsByJob = new Map();
  for (const e of events) {
    if (!JOB_ACTIONS.has(e.action) || !e.jobId) continue;
    if (!eventsByJob.has(e.jobId)) eventsByJob.set(e.jobId, []);
    eventsByJob.get(e.jobId).push(e);
  }
  const correctionsByJob = new Map();
  for (const c of podEdits) {
    const jobId = c.entityId;
    if (!correctionsByJob.has(jobId)) correctionsByJob.set(jobId, []);
    const changes = c.metadata?.changes || {};
    if (!("completedAt" in changes)) continue; // koreksi lain (driver/helper) tidak relevan utk timeline waktu
    correctionsByJob.get(jobId).push({
      from: changes.completedAt.from,
      to: changes.completedAt.to,
      reason: c.metadata?.reason || null,
      actorId: c.actorId,
      actorName: actorById.get(c.actorId) || null,
      createdAt: new Date(c.createdAt).toISOString(),
    });
  }

  const jobTimelines = jobs.map((job) => {
    const raw = (eventsByJob.get(job.id) || []).sort((a, b) => new Date(a.occurredAt || a.createdAt) - new Date(b.occurredAt || b.createdAt));
    const byAction = new Map(raw.map((e) => [e.action, e]));
    const started = byAction.get("JOB_STARTED") || null;
    const arrived = byAction.get("JOB_ARRIVED") || null;
    const selesai = byAction.get("JOB_COMPLETED") || byAction.get("JOB_FAILED") || null;
    return {
      jobId: job.id,
      sequence: job.sequence,
      orderNumber: job.orderNumber,
      customerName: job.customerName,
      type: job.type,
      status: job.status,
      events: raw.map((e) => formatEvent(e, actorById)),
      // Durasi dihitung HANYA kalau kedua ujung tersedia (lihat durationBetweenMs).
      travelMs: durationBetweenMs(started, arrived), // "menuju stop" -> "tiba"
      serviceMs: durationBetweenMs(arrived, selesai), // "tiba" -> "selesai/gagal"
      corrections: correctionsByJob.get(job.id) || [],
    };
  });

  return {
    routeId: route.id,
    routeCode: route.code,
    routeEvents,
    jobs: jobTimelines,
  };
}
