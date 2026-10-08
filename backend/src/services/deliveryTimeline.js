// Histori waktu rute & stop (fase 2 Checklist Persiapan Perjalanan, 7 Okt 2026).
//
// SUMBER: ledger eksekusi yang SUDAH ADA — `delivery_execution_events` (idempoten per Idempotency-Key, ditulis di transaksi yang sama dengan
// transisi status). Tidak ada ledger baru. Kolom `occurred_at/source/time_quality` ditambahkan (migrasi aditif); `created_at` = waktu diterima server.
// Kolom bawaan yang sudah ada (route.startedAt/completedAt, job.arrivedAt/completedAt, JobIssueLog) hanya dipakai sebagai CADANGAN untuk histori
// lama yang belum punya event — ditandai sumbernya, tidak pernah mengarang waktu. Yang tidak punya bukti waktu = "Tidak tersedia".
//
// Modul ini murni (tanpa DB) kecuali yang diberi tx/prisma eksplisit, supaya aturan waktu dapat diuji `node --test`.

export const TIME_SOURCES = Object.freeze(["DRIVER_APP", "DRIVER_WEB", "ADMIN_WEB", "SYSTEM"]);
export const SOURCE_LEGACY = "KLIEN_LAMA"; // klien tanpa header sumber (mis. versi lama)

export const TIME_QUALITY = Object.freeze({
  LIVE: "LANGSUNG",
  LATE_SYNC: "SINKRON_TERLAMBAT",
  CLOCK_FUTURE: "JAM_PERANGKAT_MASA_DEPAN",
  CLOCK_STALE: "JAM_PERANGKAT_USANG",
  CLOCK_INVALID: "JAM_PERANGKAT_TIDAK_VALID",
  SERVER_TIME: "WAKTU_SERVER",
});
const SUSPECT_QUALITIES = new Set([TIME_QUALITY.CLOCK_FUTURE, TIME_QUALITY.CLOCK_STALE, TIME_QUALITY.CLOCK_INVALID]);
export const isSuspectQuality = (q) => SUSPECT_QUALITIES.has(q);

export const LATE_SYNC_AFTER_MS = 2 * 60 * 1000; // diterima > 2 menit setelah kejadian = sinkron terlambat
export const CLOCK_FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // jam perangkat > 5 menit di depan server = janggal
export const CLOCK_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // kejadian > 7 hari sebelum diterima = janggal

export const EXEC_ACTIONS = Object.freeze({
  ROUTE_STARTED: "ROUTE_STARTED",
  JOB_STARTED: "JOB_STARTED",
  JOB_ARRIVED: "JOB_ARRIVED",
  JOB_COMPLETED: "JOB_COMPLETED",
  JOB_FAILED: "JOB_FAILED",
  JOB_RESCHEDULED: "JOB_RESCHEDULED",
  ROUTE_COMPLETED: "ROUTE_COMPLETED",
  TIME_CORRECTED: "TIME_CORRECTED",
});
const TIMELINE_ACTIONS = new Set(Object.values(EXEC_ACTIONS));

export function normalizeSource(raw) {
  const v = String(raw ?? "").trim().toUpperCase();
  return TIME_SOURCES.includes(v) ? v : SOURCE_LEGACY;
}

// Menilai waktu kejadian dari perangkat terhadap jam server SAAT event ditulis. Tidak pernah melempar: jam yang salah tidak boleh memblokir transisi status.
export function classifyEventTime(rawOccurredAt, serverNow = new Date()) {
  const now = serverNow instanceof Date ? serverNow : new Date(serverNow);
  if (rawOccurredAt == null || String(rawOccurredAt).trim() === "") return { occurredAt: now, timeQuality: TIME_QUALITY.SERVER_TIME };
  const text = String(rawOccurredAt).trim();
  // Wajib ISO-8601 dengan zona (Z / ±hh:mm): string tanpa zona ambigu -> dianggap tidak valid, bukan ditebak.
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/;
  const parsed = iso.test(text) ? new Date(text) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return { occurredAt: now, timeQuality: TIME_QUALITY.CLOCK_INVALID };
  const delta = now.getTime() - parsed.getTime();
  if (delta < -CLOCK_FUTURE_TOLERANCE_MS) return { occurredAt: parsed, timeQuality: TIME_QUALITY.CLOCK_FUTURE };
  if (delta > CLOCK_STALE_AFTER_MS) return { occurredAt: parsed, timeQuality: TIME_QUALITY.CLOCK_STALE };
  if (delta > LATE_SYNC_AFTER_MS) return { occurredAt: parsed, timeQuality: TIME_QUALITY.LATE_SYNC };
  return { occurredAt: parsed, timeQuality: TIME_QUALITY.LIVE };
}

// Metadata waktu dari request klien: header `X-Event-Occurred-At` (ISO) + `X-Action-Source`. Body `occurredAt` hanya fallback untuk klien yang tak bisa memberi header.
export function readTimeMeta(req, serverNow = new Date()) {
  const header = (name) => (typeof req?.get === "function" ? req.get(name) : req?.headers?.[name.toLowerCase()]);
  const raw = header("X-Event-Occurred-At") ?? req?.body?.occurredAt ?? null;
  const { occurredAt, timeQuality } = classifyEventTime(raw, serverNow);
  return { occurredAt, source: normalizeSource(header("X-Action-Source")), timeQuality };
}
export const systemTimeMeta = (serverNow = new Date()) => ({ occurredAt: serverNow, source: "SYSTEM", timeQuality: TIME_QUALITY.SERVER_TIME });

// ---------------------------------------------------------------- Format Indonesia / WIB
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const wibParts = (date) => {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
};
export function formatWib(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const p = wibParts(d);
  const hh = p.hour === "24" ? "00" : p.hour;
  return `${Number(p.day)} ${BULAN[Number(p.month) - 1]} ${p.year} ${hh}:${p.minute} WIB`;
}
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 60000) return "kurang dari 1 menit";
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60); const m = minutes % 60;
  if (h === 0) return `${m} menit`;
  return m === 0 ? `${h} jam` : `${h} jam ${m} menit`;
}

const SOURCE_LABEL = Object.freeze({
  DRIVER_APP: "Driver App", DRIVER_WEB: "Driver Web", ADMIN_WEB: "Web admin", SYSTEM: "Sistem", [SOURCE_LEGACY]: "Klien lama (sumber tidak tercatat)",
});
const QUALITY_LABEL = Object.freeze({
  [TIME_QUALITY.LATE_SYNC]: "Disinkronkan terlambat (aksi dilakukan saat offline)",
  [TIME_QUALITY.CLOCK_FUTURE]: "Jam perangkat janggal (lebih maju dari server) — waktu server dipakai",
  [TIME_QUALITY.CLOCK_STALE]: "Jam perangkat janggal (terlalu lama sebelum diterima) — waktu server dipakai",
  [TIME_QUALITY.CLOCK_INVALID]: "Waktu perangkat tidak valid — waktu server dipakai",
  [TIME_QUALITY.SERVER_TIME]: "Waktu server (perangkat tidak mengirim waktu kejadian)",
});
const eventLabel = (action, jobType) => {
  switch (action) {
    case EXEC_ACTIONS.ROUTE_STARTED: return "Berangkat dari Sano";
    case EXEC_ACTIONS.JOB_STARTED: return "Menuju lokasi";
    case EXEC_ACTIONS.JOB_ARRIVED: return "Tiba di lokasi";
    case EXEC_ACTIONS.JOB_COMPLETED: return jobType === "PICKUP" ? "Pengambilan selesai" : "Pengiriman selesai";
    case EXEC_ACTIONS.JOB_FAILED: return jobType === "PICKUP" ? "Pengambilan gagal" : "Pengiriman gagal";
    case EXEC_ACTIONS.JOB_RESCHEDULED: return "Dijadwalkan ulang";
    case EXEC_ACTIONS.ROUTE_COMPLETED: return "Rute selesai";
    default: return action;
  }
};

// ---------------------------------------------------------------- Penyusun timeline (murni)
// Input: route {id, code, status, startedAt, completedAt}, jobs [{id, type, status, sequence, orderNumber, customerName, arrivedAt, completedAt}],
// events (baris delivery_execution_events dgn actor.name), issueLogs (JobIssueLog RESCHEDULED: {id, jobId, createdAt, createdByName, rescheduleReason}).
export function buildRouteTimeline({ route, jobs = [], events = [], issueLogs = [] }) {
  const corrections = new Map(); // targetEventId -> koreksi terbaru (append-only: yang terbaru menang, semuanya tetap tampil di `history`)
  const correctionHistory = new Map();
  const base = [];
  for (const e of events) {
    if (!TIMELINE_ACTIONS.has(e.action)) continue;
    if (e.action === EXEC_ACTIONS.TIME_CORRECTED) {
      const target = e.payload?.targetEventId;
      if (!target) continue;
      correctionHistory.set(target, [...(correctionHistory.get(target) || []), e]);
      continue;
    }
    base.push(e);
  }
  for (const [target, list] of correctionHistory) corrections.set(target, [...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).at(-1));

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const entryOf = (e, { jobType = null } = {}) => {
    const received = new Date(e.createdAt);
    const device = e.occurredAt ? new Date(e.occurredAt) : null;
    const suspect = isSuspectQuality(e.timeQuality);
    let effective; let quality = e.timeQuality;
    if (!device) { effective = received; quality = quality || TIME_QUALITY.SERVER_TIME; } // event lama: hanya waktu server
    else effective = suspect ? received : device;
    const correction = corrections.get(e.id);
    let effectiveSource = "EVENT";
    if (correction?.payload?.correctedOccurredAt) { effective = new Date(correction.payload.correctedOccurredAt); effectiveSource = "KOREKSI"; }
    const lateSync = quality === TIME_QUALITY.LATE_SYNC;
    const flags = [];
    if (QUALITY_LABEL[quality] && quality !== TIME_QUALITY.SERVER_TIME) flags.push(QUALITY_LABEL[quality]);
    if (!device && !e.occurredAt) flags.push("Waktu diterima server (event dicatat sebelum waktu kejadian perangkat disimpan)");
    if (quality === TIME_QUALITY.SERVER_TIME && device) flags.push(QUALITY_LABEL[TIME_QUALITY.SERVER_TIME]);
    const history = (correctionHistory.get(e.id) || []).map((c) => ({
      eventId: c.id, actorName: c.actor?.name ?? null, reason: c.payload?.reason ?? null,
      from: c.payload?.previousEffectiveAt ?? null, fromText: formatWib(c.payload?.previousEffectiveAt),
      to: c.payload?.correctedOccurredAt ?? null, toText: formatWib(c.payload?.correctedOccurredAt), receivedText: formatWib(c.createdAt),
    }));
    return {
      id: e.id, action: e.action, label: eventLabel(e.action, jobType), origin: "EVENT",
      at: effective.toISOString(), atText: formatWib(effective), effectiveSource,
      receivedAt: received.toISOString(), receivedText: formatWib(received),
      deviceAtText: suspect && device ? formatWib(device) : null,
      actorName: e.actor?.name ?? null, actorId: e.actorId ?? null,
      source: e.source ?? null, sourceLabel: e.source ? (SOURCE_LABEL[e.source] || e.source) : "Tidak tercatat",
      timeQuality: quality ?? null, lateSync, suspect, flags,
      detail: e.action === EXEC_ACTIONS.JOB_FAILED ? (e.payload?.failureReason ?? null) : null,
      corrections: history,
      _ms: effective.getTime(), _durationOk: !suspect || effectiveSource === "KOREKSI",
    };
  };
  const columnEntry = (action, at, label, extra = {}) => ({
    id: null, action, label, origin: "KOLOM_LAMA", at: new Date(at).toISOString(), atText: formatWib(at), effectiveSource: "KOLOM_LAMA",
    receivedAt: new Date(at).toISOString(), receivedText: formatWib(at), deviceAtText: null,
    actorName: extra.actorName ?? null, actorId: null, source: null, sourceLabel: "Dicatat sistem (tanpa log aksi)", timeQuality: null, lateSync: false, suspect: false,
    flags: ["Dicatat sistem sebelum histori waktu aktif — tanpa waktu kejadian perangkat"], detail: extra.detail ?? null, corrections: [],
    _ms: new Date(at).getTime(), _durationOk: true,
  });
  const strip = ({ _ms, _durationOk, ...rest }) => rest;

  // ---- level rute
  const routeEvents = [];
  const rStart = base.filter((e) => e.action === EXEC_ACTIONS.ROUTE_STARTED).map((e) => entryOf(e));
  const rDone = base.filter((e) => e.action === EXEC_ACTIONS.ROUTE_COMPLETED).map((e) => entryOf(e));
  if (!rStart.length && route?.startedAt) rStart.push(columnEntry(EXEC_ACTIONS.ROUTE_STARTED, route.startedAt, "Berangkat dari Sano"));
  if (!rDone.length && route?.status === "COMPLETED" && route?.completedAt) rDone.push(columnEntry(EXEC_ACTIONS.ROUTE_COMPLETED, route.completedAt, "Rute selesai"));
  routeEvents.push(...rStart, ...rDone);
  const routeStarted = routeEvents.find((e) => e.action === EXEC_ACTIONS.ROUTE_STARTED);
  const routeDone = routeEvents.find((e) => e.action === EXEC_ACTIONS.ROUTE_COMPLETED);
  const routeStatus = route?.status ?? null;
  const missingRoute = [];
  if (!routeStarted && ["IN_PROGRESS", "COMPLETED"].includes(routeStatus)) missingRoute.push({ action: EXEC_ACTIONS.ROUTE_STARTED, label: "Berangkat dari Sano", atText: "Tidak tersedia" });
  if (!routeDone && routeStatus === "COMPLETED") missingRoute.push({ action: EXEC_ACTIONS.ROUTE_COMPLETED, label: "Rute selesai", atText: "Tidak tersedia" });
  const routeDuration = routeStarted && routeDone ? durationBetween(routeStarted, routeDone) : null;

  // ---- level stop (gabungan job yang kini di rute + job yang pernah punya event di rute ini, mis. yang dilepas saat reschedule)
  const jobIds = new Set(jobs.map((j) => j.id)); for (const e of base) if (e.jobId) jobIds.add(e.jobId);
  const stops = [];
  for (const jobId of jobIds) {
    const job = jobById.get(jobId) || { id: jobId, type: null, status: null };
    const jobEvents = base.filter((e) => e.jobId === jobId);
    const byAction = (a) => jobEvents.filter((e) => e.action === a).map((e) => entryOf(e, { jobType: job.type }));
    const items = {
      start: byAction(EXEC_ACTIONS.JOB_STARTED), arrive: byAction(EXEC_ACTIONS.JOB_ARRIVED),
      complete: byAction(EXEC_ACTIONS.JOB_COMPLETED), fail: byAction(EXEC_ACTIONS.JOB_FAILED), resched: byAction(EXEC_ACTIONS.JOB_RESCHEDULED),
    };
    if (!items.arrive.length && job.arrivedAt) items.arrive.push(columnEntry(EXEC_ACTIONS.JOB_ARRIVED, job.arrivedAt, "Tiba di lokasi"));
    if (!items.complete.length && job.status === "COMPLETED" && job.completedAt) items.complete.push(columnEntry(EXEC_ACTIONS.JOB_COMPLETED, job.completedAt, eventLabel(EXEC_ACTIONS.JOB_COMPLETED, job.type)));
    if (!items.resched.length) for (const l of issueLogs.filter((x) => x.jobId === jobId)) items.resched.push(columnEntry(EXEC_ACTIONS.JOB_RESCHEDULED, l.createdAt, "Dijadwalkan ulang", { actorName: l.createdByName, detail: l.rescheduleReason }));
    const present = [...items.start, ...items.arrive, ...items.complete, ...items.fail, ...items.resched].sort((a, b) => a._ms - b._ms);
    // Tonggak yang SEHARUSNYA sudah terjadi menurut status tetapi tak punya bukti waktu -> "Tidak tersedia" (tidak diisi/diarang).
    const missing = [];
    const need = (list, action, label) => { if (!list.length) missing.push({ action, label, atText: "Tidak tersedia" }); };
    if (["EN_ROUTE", "ARRIVED", "COMPLETED"].includes(job.status)) need(items.start, EXEC_ACTIONS.JOB_STARTED, "Menuju lokasi");
    if (["ARRIVED", "COMPLETED"].includes(job.status)) need(items.arrive, EXEC_ACTIONS.JOB_ARRIVED, "Tiba di lokasi");
    if (job.status === "COMPLETED") need(items.complete, EXEC_ACTIONS.JOB_COMPLETED, eventLabel(EXEC_ACTIONS.JOB_COMPLETED, job.type));
    if (job.status === "FAILED") need(items.fail, EXEC_ACTIONS.JOB_FAILED, eventLabel(EXEC_ACTIONS.JOB_FAILED, job.type));
    const first = (l) => l[0] || null; const last = (l) => l.at(-1) || null;
    const start = last(items.start); const arrive = last(items.arrive); const end = last(items.complete) || last(items.fail);
    // Urutan waktu janggal (mis. tiba sebelum berangkat): durasi tidak ditampilkan, tonggak diberi catatan.
    const travel = start && arrive ? durationBetween(start, arrive) : null;
    const service = arrive && end ? durationBetween(arrive, end) : null;
    stops.push({
      jobId, sequence: job.sequence ?? null, type: job.type, status: job.status, orderNumber: job.orderNumber ?? null, customerName: job.customerName ?? null,
      events: present.map(strip), missing,
      travelDurationText: travel?.ok ? formatDuration(travel.ms) : null, serviceDurationText: service?.ok ? formatDuration(service.ms) : null,
      travelDurationNote: travel && !travel.ok ? travel.note : null, serviceDurationNote: service && !service.ok ? service.note : null,
      hasAnyTime: present.length > 0,
      _first: first(present)?._ms ?? Number.MAX_SAFE_INTEGER,
    });
  }
  stops.sort((a, b) => (a.sequence ?? 9999) - (b.sequence ?? 9999) || a._first - b._first);
  for (const s of stops) delete s._first;
  return {
    route: { id: route?.id ?? null, code: route?.code ?? null, status: routeStatus },
    routeEvents: routeEvents.map(strip), routeMissing: missingRoute,
    routeDurationText: routeDuration?.ok ? formatDuration(routeDuration.ms) : null, routeDurationNote: routeDuration && !routeDuration.ok ? routeDuration.note : null,
    stops,
    note: "Waktu dalam WIB. Durasi hanya dihitung bila kedua waktu tercatat dan jam perangkat tidak janggal; histori lama tanpa bukti waktu ditampilkan 'Tidak tersedia'.",
  };
}

// Durasi hanya bila kedua ujung punya bukti waktu yang layak dipercaya DAN urutannya masuk akal.
function durationBetween(from, to) {
  if (!from || !to) return null;
  if (!from._durationOk || !to._durationOk) return { ok: false, note: "Durasi tidak dihitung — jam perangkat janggal" };
  const ms = to._ms - from._ms;
  if (ms < 0) return { ok: false, note: "Durasi tidak dihitung — urutan waktu janggal" };
  return { ok: true, ms };
}

// ---------------------------------------------------------------- Penulisan event (di dalam transaksi pemanggil)
export async function recordRouteCompleted(tx, routeId, meta = null, { actorId = null, triggerJobId = null } = {}) {
  // Event "rute selesai": kunci deterministik per siklus penyelesaian (rute bisa dibuka lagi lalu selesai lagi) + skipDuplicates (tanpa meracuni transaksi).
  const used = await tx.deliveryExecutionEvent.count({ where: { routeId, action: EXEC_ACTIONS.ROUTE_COMPLETED } });
  const m = meta || systemTimeMeta();
  await tx.deliveryExecutionEvent.createMany({
    data: [{
      idempotencyKey: `route-completed:${routeId}:${used + 1}`, action: EXEC_ACTIONS.ROUTE_COMPLETED, actorId, routeId, jobId: null,
      payload: { status: "COMPLETED", derived: true, triggerJobId }, occurredAt: m.occurredAt, source: m.source, timeQuality: m.timeQuality,
    }],
    skipDuplicates: true,
  });
}

export const CORRECTION_REASON_MIN = 5;
// Koreksi append-only: event TIME_CORRECTED baru; event asli tidak diubah. `effective` = waktu efektif target saat ini (untuk jejak "semula").
export function validateCorrectionInput(body, { now = new Date() } = {}) {
  const eventId = String(body?.eventId || "").trim();
  const reason = String(body?.reason || "").trim();
  if (!eventId) throw Object.assign(new Error("Pilih tonggak waktu yang dikoreksi"), { statusCode: 400, code: "TIMELINE_EVENT_REQUIRED" });
  if (reason.length < CORRECTION_REASON_MIN) throw Object.assign(new Error(`Alasan koreksi wajib diisi (minimal ${CORRECTION_REASON_MIN} karakter)`), { statusCode: 400, code: "TIMELINE_REASON_REQUIRED" });
  if (reason.length > 500) throw Object.assign(new Error("Alasan koreksi terlalu panjang (maks. 500 karakter)"), { statusCode: 400, code: "TIMELINE_REASON_TOO_LONG" });
  const text = String(body?.correctedOccurredAt || "").trim();
  const parsed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.test(text) ? new Date(text) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw Object.assign(new Error("Waktu koreksi tidak valid (gunakan format ISO dengan zona waktu)"), { statusCode: 400, code: "TIMELINE_TIME_INVALID" });
  if (parsed.getTime() > now.getTime() + CLOCK_FUTURE_TOLERANCE_MS) throw Object.assign(new Error("Waktu koreksi tidak boleh di masa depan"), { statusCode: 400, code: "TIMELINE_TIME_FUTURE" });
  return { eventId, reason, correctedOccurredAt: parsed };
}
export const isCorrectableAction = (action) => TIMELINE_ACTIONS.has(action) && action !== EXEC_ACTIONS.TIME_CORRECTED;
