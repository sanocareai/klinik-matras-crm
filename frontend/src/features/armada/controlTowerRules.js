// Delivery Control Tower — logika MURNI (22 September 2026, permintaan
// dispatcher: satu layar "apa yang terjadi hari ini + apa yang butuh
// tindakan"). TIDAK ADA import React/JSX di file ini SENGAJA — supaya bisa
// dites dengan `node --test` biasa (pola sama dengan effectiveRouteStatus.
// test.js), dan supaya halaman (ArmadaKendaliRute.jsx) TIDAK PERNAH
// menghitung ulang aturan yang sama dengan cara berbeda di tempat lain.
//
// SUMBER DATA: SATU-SATUNYA — hasil GET /armada/routes (routeInclude
// backend, endpoint yang SAMA sudah dipakai Route Planner). TIDAK ADA
// panggilan API kedua, TIDAK ADA tabel/cache terpisah — funsi di bawah cuma
// MENURUNKAN (derive) ringkasan/exception dari array `routes` yang sudah
// lengkap (jobs+driver+helper+vehicle per rute), murni transformasi di
// memori.
import { issueStatusOf } from "./issueStatus.js";

// cityOf() DISALIN dari jobStatus.js, BUKAN diimpor — jobStatus.js memakai
// alias Vite "@/utils/..." yang TIDAK bisa di-resolve `node --test` polos
// (dibuktikan langsung: mengimpornya melempar "Cannot find package '@/utils'").
// File INI (controlTowerRules.js) sengaja bebas dependency SEPENUHNYA demi
// testability, jadi disalin persis alih-alih menambah loader/alias khusus
// test yang menambah kerumitan infra tes untuk satu fungsi 1-baris. WAJIB
// tetap identik dengan cityOf() di jobStatus.js — kalau salah satu berubah,
// ubah dua-duanya.
function cityOfJob(job) {
  return job?.order?.deliveryCity || job?.units?.[0]?.unit?.order?.deliveryCity || null;
}

// ─── Status rute — 5 kelompok tampilan (Draft/Published/Berjalan/Selesai/
// Bermasalah) — "Bermasalah" BUKAN status Route.status sungguhan (enum
// Prisma tetap DRAFT/PUBLISHED/IN_PROGRESS/COMPLETED/CANCELLED, lihat
// backend/prisma/schema.prisma), itu label GABUNGAN: rute status apa pun
// (kecuali sudah CANCELLED — sudah final, dikeluarkan dari kelompok
// manapun) yang punya minimal 1 exception aktif (lihat deriveRouteExceptions
// di bawah) ikut dihitung "Bermasalah" DI SAMPING kelompok status aslinya.
// Rute yang sama BISA muncul di 2 hitungan (mis. PUBLISHED + Bermasalah
// sekaligus) — itu disengaja, "Bermasalah" adalah lapisan PERHATIAN, bukan
// pengganti status asli.
export const ROUTE_STATUS_GROUP = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

// Status Job yang dianggap "sudah berangkat/berjalan" — dipakai deteksi
// "Terlambat Berangkat" (rute sudah published tapi belum ada SATU PUN stop
// yang bergerak). SATU definisi dengan ACTIVE_STATUSES(jobStatus.js) minus
// SCHEDULED/ASSIGNED/UNSCHEDULED (yang justru berarti "belum bergerak").
const STOP_SUDAH_BERGERAK = ["EN_ROUTE", "ARRIVED", "COMPLETED", "FAILED"];

// Ambang "terlambat berangkat" — SENGAJA berbasis Route.publishedAt (data
// yang BENAR-BENAR ada), BUKAN jam-mulai-kerja yang dikarang (tidak ada
// field "jam berangkat direncanakan" di skema Route mana pun). Artinya:
// "sudah diterbitkan >= 2 jam lalu, rutenya untuk HARI INI, tapi belum ada
// satu stop pun yang bergerak" — proxy jujur, BUKAN klaim pasti "harusnya
// sudah jalan jam segini".
const JAM_TERLAMBAT_BERANGKAT = 2;

function routeDateKey(value) {
  if (!value) return null;
  // Route.date adalah kolom DATE dan dikirim Prisma sebagai tengah malam UTC;
  // bagian YYYY-MM-DD adalah kalender bisnisnya, bukan instant untuk digeser.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function wibDateKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

// ─── Progress rute — stop selesai/total, stop aktif (sedang dikerjakan) ────
// SATU sumber angka untuk header ringkasan MAUPUN kartu rute — supaya
// "displayedCount === renderedStops.length" (Aktif tab driver-mobile) juga
// berlaku di sisi dispatcher: apa pun yang dihitung DI SINI harus sama
// dengan array `route.jobs` yang benar-benar dirender di drawer.
export function deriveRouteProgress(route) {
  const jobs = route?.jobs || [];
  const total = jobs.length;
  const done = jobs.filter((j) => j.status === "COMPLETED" || j.status === "FAILED").length;
  const activeJob = jobs.find((j) => j.status === "EN_ROUTE" || j.status === "ARRIVED") || null;
  // "Update terakhir" rute — waktu PALING BARU di antara Route.updatedAt
  // dan updatedAt SEMUA job anggotanya (Route.updatedAt sendiri TIDAK
  // bertambah kalau cuma job anaknya yang berubah — pola SAMA dengan
  // `revision` di GET /armada/my-jobs, backend/src/routes/armada.js).
  let lastUpdatedAt = route?.updatedAt ? new Date(route.updatedAt) : null;
  for (const j of jobs) {
    const t = j.updatedAt ? new Date(j.updatedAt) : null;
    if (t && (!lastUpdatedAt || t > lastUpdatedAt)) lastUpdatedAt = t;
  }
  return { done, total, activeJob, lastUpdatedAt };
}

// ─── Kota rute — JUJUR: tidak ada kolom "kota" di Route, cuma per-stop
// (Order.deliveryCity lewat cityOf(), lihat jobStatus.js). Diturunkan dari
// kota yang PALING SERING muncul di antara stop rute ini — kalau semua stop
// searah (kasus normal), ini akurat; kalau tercampur, label tetap yang
// PALING dominan (bukan "campuran" yang tidak actionable untuk filter).
// null kalau TIDAK ADA stop dengan kota diketahui sama sekali — TIDAK
// ditebak jadi "Jakarta" atau kota lain.
export function deriveRouteCity(route) {
  const hitung = new Map();
  for (const j of route?.jobs || []) {
    const kota = cityOfJob(j);
    if (!kota) continue;
    hitung.set(kota, (hitung.get(kota) || 0) + 1);
  }
  let terbanyak = null, max = 0;
  for (const [kota, n] of hitung) {
    if (n > max) { max = n; terbanyak = kota; }
  }
  return terbanyak;
}

// ─── Exception detection — SATU aturan per jenis, dikembalikan sebagai
// array (satu rute BISA punya lebih dari satu exception sekaligus, mis.
// "belum publish" TIDAK exclusive dari nanti "driver belum sinkron" begitu
// akhirnya publish). `now` disuntikkan (bukan `new Date()` langsung di
// dalam) supaya fungsi ini 100% deterministik untuk dites.
export function deriveRouteExceptions(route, { now = new Date() } = {}) {
  const out = [];
  const jobs = route?.jobs || [];
  const tanggalRute = routeDateKey(route?.date);
  const tanggalSekarangWib = wibDateKey(now);
  const tanggalHariIni = tanggalRute && tanggalRute === tanggalSekarangWib;
  const tanggalSudahLewat = tanggalRute && tanggalSekarangWib && tanggalRute < tanggalSekarangWib;

  // 1) Tanpa driver/kendaraan — DRAFT, salah satu (atau keduanya) kosong,
  // rute-nya untuk hari ini/sudah lewat/besok (jauh ke depan belum
  // mendesak — dispatcher masih punya waktu menyusun).
  if (!["COMPLETED", "CANCELLED"].includes(route?.status) && (!route?.driverId || !route?.vehicleId) && jobs.length > 0) {
    out.push({
      type: "TANPA_DRIVER_KENDARAAN",
      severity: "critical",
      label: !route.driverId && !route.vehicleId ? "Belum ada driver & kendaraan" : !route.driverId ? "Belum ada driver" : "Belum ada kendaraan",
      detail: `${jobs.length} stop menunggu pada rute ${route?.status === "DRAFT" ? "Draft" : "aktif"}`,
    });
  }

  // 2) Belum publish — DRAFT tapi driver+kendaraan+stop SUDAH lengkap,
  // cuma belum diterbitkan. Beda dari #1 (siap tapi idle, bukan belum siap).
  if (route?.status === "DRAFT" && route?.driverId && route?.vehicleId && jobs.length > 0) {
    out.push({
      type: "BELUM_PUBLISH",
      severity: "warning",
      label: "Siap diterbitkan, belum diterbitkan",
      detail: "Driver & kendaraan sudah lengkap — tinggal klik Terbitkan",
    });
  }

  // 3) Driver belum ambil data sejak publish — SATU DEFINISI dengan
  // RouteCard.jsx (Route Planner): User.lastAppSyncAt HANYA membuktikan
  // kapan server terakhir berhasil membalas GET /my-jobs, BUKAN bukti
  // driver membaca/menerima rute — makanya framing di label/detail SENGAJA
  // "terakhir mengambil data", bukan "belum menerima"/"belum dilihat".
  if (route?.status === "PUBLISHED" && route?.driver) {
    const belumSinkron = !route.driver.lastAppSyncAt || (route.publishedAt && new Date(route.driver.lastAppSyncAt) < new Date(route.publishedAt));
    if (belumSinkron) {
      out.push({
        type: "DRIVER_BELUM_SINKRON",
        severity: "warning",
        label: `${route.driver.name} belum tercatat mengambil data sejak rute diterbitkan`,
        detail: "Bukan bukti belum diterima — cek manual (telepon/WA) kalau ragu",
      });
    }
  }

  // 4) Terlambat berangkat — PUBLISHED, rute HARI INI, diterbitkan >= 2 jam
  // lalu, TAPI belum ada satu stop pun yang bergerak (semua masih
  // SCHEDULED/ASSIGNED). Heuristik BERBASIS DATA (publishedAt), bukan jam
  // kerja karangan — lihat catatan JAM_TERLAMBAT_BERANGKAT di atas.
  if (route?.status === "PUBLISHED" && tanggalHariIni && route?.publishedAt) {
    const jamSejakPublish = (now.getTime() - new Date(route.publishedAt).getTime()) / 3_600_000;
    const sudahBergerak = jobs.some((j) => STOP_SUDAH_BERGERAK.includes(j.status));
    if (jamSejakPublish >= JAM_TERLAMBAT_BERANGKAT && !sudahBergerak && jobs.length > 0) {
      out.push({
        type: "TERLAMBAT_BERANGKAT",
        severity: "critical",
        label: "Belum ada tanda keberangkatan",
        detail: `Diterbitkan ${Math.floor(jamSejakPublish)} jam lalu, belum ada stop yang dimulai`,
      });
    }
  }

  // 5) Gagal antar / masalah aktif — job FAILED yang BELUM dijadwalkan
  // ulang (issueStatusOf === "OPEN", SATU DEFINISI dengan tab Kendala &
  // Reschedule/RiwayatRevisiKendala.jsx — TIDAK dihitung ulang dengan
  // logika kedua yang bisa diam-diam menyimpang).
  const gagalTerbuka = jobs.filter((j) => issueStatusOf(j) === "OPEN");
  if (gagalTerbuka.length > 0) {
    out.push({
      type: "GAGAL_ANTAR",
      severity: "critical",
      label: `${gagalTerbuka.length} stop gagal, belum dijadwalkan ulang`,
      detail: gagalTerbuka.map((j) => j.order?.orderNumber).filter(Boolean).slice(0, 3).join(", "),
    });
  }

  // ComplaintCase yang masih aktif adalah masalah operasional meskipun job
  // belum/ tidak berstatus FAILED. Relasi ini sudah ikut jobInclude, sehingga
  // tidak menambah endpoint atau query per kartu.
  const masalahAktif = jobs.filter((j) => j.complaintCase && !["SELESAI", "DIBATALKAN"].includes(j.complaintCase.status));
  if (masalahAktif.length > 0) {
    out.push({
      type: "MASALAH_AKTIF",
      severity: masalahAktif.some((j) => ["TINGGI", "KRITIS"].includes(j.complaintCase?.severity)) ? "critical" : "warning",
      label: `${masalahAktif.length} masalah aktif terkait stop`,
      detail: masalahAktif.map((j) => j.complaintCase?.caseNumber).filter(Boolean).slice(0, 3).join(", "),
    });
  }

  // Rute sudah lewat tanggalnya tapi belum COMPLETED/CANCELLED — sinyal
  // tambahan (jangan dobel-hitung sama sekali dengan hari-ini punya, hanya
  // untuk rute yang TERTINGGAL dari hari sebelumnya).
  if (tanggalSudahLewat && !["COMPLETED", "CANCELLED"].includes(route?.status) && jobs.length > 0) {
    out.push({
      type: "TERTINGGAL",
      severity: "critical",
      label: "Rute sudah lewat tanggal, belum Selesai/Dibatalkan",
      detail: `Tanggal rute: ${route.date ? new Date(route.date).toISOString().slice(0, 10) : "-"}`,
    });
  }

  return out;
}

// Bobot prioritas per jenis (dipakai rankRoutesByPriority di bawah) —
// makin besar makin mendesak. Urutan mengikuti dampak operasional: gagal
// antar/tertinggal = customer sudah terdampak SEKARANG; terlambat
// berangkat & tanpa driver = rute hari ini terancam gagal total; driver
// belum sinkron & belum publish = risiko, belum tentu terjadi.
const BOBOT_EXCEPTION = {
  GAGAL_ANTAR: 100,
  TERTINGGAL: 95,
  TERLAMBAT_BERANGKAT: 90,
  TANPA_DRIVER_KENDARAAN: 80,
  DRIVER_BELUM_SINKRON: 60,
  MASALAH_AKTIF: 70,
  BELUM_PUBLISH: 50,
};

// ─── Ringkasan status — hitungan per kelompok + jumlah rute Bermasalah,
// dari array `routes` (SUDAH difilter tanggal/dll oleh pemanggil) ─────────
export function summarizeRoutes(routes, { now = new Date() } = {}) {
  const ringkasan = { DRAFT: 0, PUBLISHED: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, BERMASALAH: 0 };
  for (const r of routes || []) {
    if (ringkasan[r.status] !== undefined) ringkasan[r.status] += 1;
    if (r.status !== "CANCELLED" && deriveRouteExceptions(r, { now }).length > 0) ringkasan.BERMASALAH += 1;
  }
  return ringkasan;
}

// ─── Prioritisasi — SEMUA exception dari SEMUA rute, digabung jadi satu
// daftar terurut (dampak tertinggi duluan), masing-masing membawa
// referensi ke rute asalnya untuk tindakan cepat (navigasi ke rute itu). ──
export function rankRouteExceptions(routes, { now = new Date() } = {}) {
  const out = [];
  for (const r of routes || []) {
    if (r.status === "CANCELLED") continue;
    for (const exc of deriveRouteExceptions(r, { now })) {
      out.push({ ...exc, route: r, weight: BOBOT_EXCEPTION[exc.type] ?? 0 });
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
}

// ─── Filter — tanggal (dilakukan pemanggil lewat parameter API from/to,
// TIDAK di sini), status, driver, kendaraan, kota. Semua opsional — filter
// yang tidak diisi (falsy) dilewati begitu saja. ──────────────────────────
export function filterRoutes(routes, { status, driverId, vehicleId, city, onlyProblem } = {}, { now = new Date() } = {}) {
  return (routes || []).filter((r) => {
    if (status && r.status !== status) return false;
    if (driverId && r.driverId !== driverId && r.helperId !== driverId) return false;
    if (vehicleId && r.vehicleId !== vehicleId) return false;
    if (city && deriveRouteCity(r) !== city) return false;
    if (onlyProblem && (r.status === "CANCELLED" || deriveRouteExceptions(r, { now }).length === 0)) return false;
    return true;
  });
}

// ─── Daftar kota unik dari sekumpulan rute — dipakai mengisi opsi filter
// kota TANPA memanggil endpoint terpisah (bukan daftar kota tetap yang
// dikarang, murni turunan data yang sudah ada). ──────────────────────────
export function distinctCities(routes) {
  const set = new Set();
  for (const r of routes || []) {
    const kota = deriveRouteCity(r);
    if (kota) set.add(kota);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ─── Opsi filter Driver & Kendaraan — SAMA prinsip dengan distinctCities:
// diturunkan dari `routes` yang SUDAH ter-fetch (driver ATAU helper di
// rute manapun pada rentang ini), BUKAN panggilan GET /armada/drivers
// terpisah. Trade-off SADAR: driver yang kebetulan tidak punya rute sama
// sekali di rentang tanggal terpilih tidak akan muncul di opsi filter —
// itu memang tidak relevan untuk memfilter rute yang sedang ditampilkan.
export function distinctDrivers(routes) {
  const map = new Map();
  for (const r of routes || []) {
    if (r.driver) map.set(r.driver.id, r.driver.name);
    if (r.helper) map.set(r.helper.id, r.helper.name);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function distinctVehicles(routes) {
  const map = new Map();
  for (const r of routes || []) {
    if (r.vehicle) map.set(r.vehicle.id, r.vehicle.plateNumber);
  }
  return [...map.entries()].map(([id, plateNumber]) => ({ id, plateNumber })).sort((a, b) => a.plateNumber.localeCompare(b.plateNumber));
}

// UI gate mengikuti permission backend GET /armada/routes (job:read).
// `capabilities` adalah sumber utama dari /auth/login dan /auth/me; fallback
// role menjaga sesi lama yang tersimpan sebelum field itu tersedia.
export function canAccessControlTower(user) {
  if (Array.isArray(user?.capabilities)) return user.capabilities.includes("job:read");
  const roles = Array.isArray(user?.roles) && user.roles.length > 0
    ? user.roles
    : (user?.role ? [user.role] : []);
  return roles.some((role) => ["ADMIN", "OWNER", "DISPATCHER", "LEADER_DRIVER"].includes(role));
}
