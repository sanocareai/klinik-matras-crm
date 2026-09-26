// Domain operasional Delivery Control (dashboard, driver, rute, tracking, masalah, performa).
// Peta status mengikuti enum Prisma apa adanya (JobStatus, RouteStatus) — tidak ada status karangan.
// Semua fungsi murni (tanpa I/O) supaya bisa diuji di Node.

export const JOB_TYPE = { PICKUP: "Pengambilan", DELIVERY: "Pengiriman" };

export const JOB_STATUS = {
  UNSCHEDULED: { label: "Belum dijadwalkan", tone: "neutral" },
  SCHEDULED: { label: "Terjadwal", tone: "accent" },
  ASSIGNED: { label: "Driver ditugaskan", tone: "accent" },
  EN_ROUTE: { label: "Menuju lokasi", tone: "cyan" },
  ARRIVED: { label: "Tiba di lokasi", tone: "cyan" },
  COMPLETED: { label: "Selesai", tone: "green" },
  FAILED: { label: "Gagal", tone: "red" },
  RESCHEDULED: { label: "Dijadwalkan ulang", tone: "orange" },
};

export const ROUTE_STATUS = {
  DRAFT: { label: "Draf", tone: "neutral" },
  PUBLISHED: { label: "Terbit", tone: "accent" },
  IN_PROGRESS: { label: "Berjalan", tone: "cyan" },
  COMPLETED: { label: "Selesai", tone: "green" },
  CANCELLED: { label: "Dibatalkan", tone: "red" },
};

// Fase kartu tracking (GET /armada/tracking: phase = EN_ROUTE | ARRIVED | WAITING | DONE; loose job = status job).
export const TRACKING_PHASE = {
  EN_ROUTE: { label: "Menuju lokasi", tone: "cyan" },
  ARRIVED: { label: "Tiba di lokasi", tone: "cyan" },
  WAITING: { label: "Menunggu berangkat", tone: "accent" },
  DONE: { label: "Semua stop tuntas", tone: "green" },
};

export const ISSUE_STATUS = {
  OPEN: { label: "Perlu tindakan", tone: "red" },
  RESCHEDULED: { label: "Sudah dijadwalkan ulang", tone: "orange" },
};

const TIDAK_DIKENAL = (v) => ({ label: v ? `Status tidak dikenal (${v})` : "-", tone: "neutral" });
export const jobStatusInfo = (s) => JOB_STATUS[s] || TIDAK_DIKENAL(s);
export const routeStatusInfo = (s) => ROUTE_STATUS[s] || TIDAK_DIKENAL(s);
export const trackingPhaseInfo = (s) => TRACKING_PHASE[s] || JOB_STATUS[s] || TIDAK_DIKENAL(s);
export const issueStatusInfo = (s) => ISSUE_STATUS[s] || TIDAK_DIKENAL(s);

export const ACTIVE_JOB = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

/** Ringkasan papan hari ini dari GET /armada/board (dua tipe digabung). */
export function ringkasPapan(jobs = []) {
  const r = { total: 0, selesai: 0, berjalan: 0, menunggu: 0, gagal: 0, belumDriver: 0, pickup: 0, delivery: 0 };
  for (const j of jobs) {
    r.total += 1;
    if (j.type === "PICKUP") r.pickup += 1; else if (j.type === "DELIVERY") r.delivery += 1;
    if (j.status === "COMPLETED") r.selesai += 1;
    else if (j.status === "FAILED") r.gagal += 1;
    else if (j.status === "EN_ROUTE" || j.status === "ARRIVED") r.berjalan += 1;
    else if (ACTIVE_JOB.includes(j.status)) r.menunggu += 1;
    if (ACTIVE_JOB.includes(j.status) && !j.driverId && !j.driver && !j.isExternalCourier) r.belumDriver += 1;
  }
  r.persenSelesai = r.total ? Math.round((r.selesai / r.total) * 100) : 0;
  return r;
}

/** Ringkasan satu rute dari routeInclude (jobs + status). */
export function ringkasRute(route) {
  const jobs = route?.jobs || [];
  const selesai = jobs.filter((j) => j.status === "COMPLETED").length;
  const gagal = jobs.filter((j) => j.status === "FAILED").length;
  return { stop: jobs.length, selesai, gagal, sisa: jobs.length - selesai - gagal };
}

/** Daftar driver+helper digabung per orang (satu orang bisa punya dua peran). */
export function gabungKru(drivers = [], helpers = []) {
  const peta = new Map();
  for (const [daftar, peran] of [[drivers, "Driver"], [helpers, "Helper"]]) {
    for (const u of daftar) {
      const x = peta.get(u.id) || { ...u, peran: [] };
      x.peran.push(peran);
      peta.set(u.id, { ...x, ...u, peran: x.peran });
    }
  }
  return [...peta.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "id"));
}

/** "YYYY-MM-DD" hari ini + n hari (WIB). */
export function tanggalWIBPlus(n = 0, now = Date.now()) {
  return new Date(now + 7 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);
}

/** Awal & akhir bulan berjalan (WIB) untuk periode insentif default. */
export function periodeBulanIni(now = Date.now()) {
  const hari = tanggalWIBPlus(0, now);
  return { from: `${hari.slice(0, 7)}-01`, to: hari };
}

/** Umur posisi GPS terakhir dalam menit (null bila tidak ada). */
export function umurPosisiMenit(lastPosition, now = Date.now()) {
  if (!lastPosition?.recordedAt) return null;
  const t = new Date(lastPosition.recordedAt).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60000)) : null;
}

/** Tautan peta eksternal (dibuka di aplikasi peta HP; Control TIDAK meminta izin lokasi). */
export function tautanPeta(lat, lng) {
  if (lat == null || lng == null || lat === "" || lng === "" || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return `https://www.google.com/maps/search/?api=1&query=${Number(lat)},${Number(lng)}`;
}

/** Validasi form reschedule (server tetap penentu: job wajib FAILED, tanggal & alasan wajib). */
export function validasiReschedule(f, today) {
  const errors = {};
  if (!f?.scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(f.scheduledDate)) errors.scheduledDate = "Tanggal baru wajib diisi (TTTT-BB-HH)";
  else if (today && f.scheduledDate < today) errors.scheduledDate = "Tanggal baru tidak boleh sebelum hari ini";
  if (!f?.reason || f.reason.trim().length < 3) errors.reason = "Alasan wajib diisi (minimal 3 huruf)";
  return { ok: Object.keys(errors).length === 0, errors };
}
