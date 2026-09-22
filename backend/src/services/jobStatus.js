// Konstanta status Job yang dipakai LINTAS file (routes/armada.js DAN
// services/armadaAutoJob.js) — dipindah ke sini 24 Agustus 2026 supaya
// definisi "job aktif" cuma ada SATU tempat. Sebelumnya armada.js
// mendefinisikan sendiri secara lokal; kalau armadaAutoJob.js menyalin
// ulang, dua definisi itu gampang drift kalau salah satu diubah tanpa
// ingat yang lain (persis pola bug yang berulang kali ditemukan di project
// ini — lihat CLAUDE.md §"aturan produk berubah, cukup ubah di satu tempat").

// Job dianggap "aktif" (masih akan dikerjakan) — dipakai untuk menyaring
// unit yang SUDAH punya job tipe ini supaya tidak double-booking. FAILED dan
// RESCHEDULED SENGAJA TIDAK termasuk aktif — unit itu harus muncul lagi di
// daftar "available" supaya dispatcher bisa membuat job baru.
export const ACTIVE_JOB_STATUSES = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

// Unit.status "AWAITING_PICKUP"/"READY_FOR_DELIVERY" TIDAK cukup untuk
// menandai unit layak dijadwalkan — order induknya bisa saja sudah
// CANCELLED atau malah sudah DELIVERED (lihat services/armadaAutoJob.js
// dan routes/armada.js GET /board). Satu sumber kebenaran dipakai di dua
// tempat itu.
export const ELIGIBLE_ORDER_STATUS = { PICKUP: ["PENDING", "PICKUP"], DELIVERY: ["READY"] };

// Job USANG (D-064, 4 September 2026) — laporan owner: order seperti
// "Hotel Discovery" sudah "Terkirim" di Sales CRM, tapi job-nya di Delivery
// masih nangkring selamanya sebagai "Belum Dijadwalkan"/"Belum ada driver".
// Sebabnya BUKAN bug baru — ini order LAMA dari sebelum Delivery Hub aktif
// dipakai sehari-hari: Order.status sudah di-set DELIVERED/CANCELLED lewat
// jalur LAIN (Sales CRM langsung, atau data lama/import), sementara Job
// yang ikut ter-auto-buat (armadaAutoJob.js) tidak pernah disentuh sama
// sekali (masih UNSCHEDULED) karena waktu itu belum ada yang benar-benar
// mengoperasikan Delivery Hub. ACTIVE_JOB_STATUSES di atas TIDAK menangkap
// ini — job-nya memang "aktif" secara status sendiri, cuma order induknya
// sudah tidak relevan lagi.
//
// SENGAJA cuma UNSCHEDULED (bukan SCHEDULED/ASSIGNED/EN_ROUTE/ARRIVED) —
// job yang SUDAH disentuh dispatcher (dapat tanggal/driver) berarti memang
// SEDANG diproses lewat Delivery Hub sungguhan; kalau ternyata order-nya
// juga sudah DELIVERED itu kasus beda (kemungkinan race/edit manual
// bersamaan) yang butuh tinjauan manusia, bukan disembunyikan otomatis.
//
// Dipakai sebagai `NOT: STALE_UNSCHEDULED_JOB` di GET /armada/jobs (Jadwal
// & Penugasan, Dashboard "Perlu Dijadwalkan", panel Route Planner) DAN GET
// /armada/board (Papan) — SATU definisi, bukan disalin ulang, supaya kalau
// aturannya berubah nanti tidak diam-diam beda di 2 tempat.
//
// ⚠️ KOREKSI (6 September 2026, D-108) — job PICKUP yang lahir dari
// POST /revisions/:id/create-pickup-job (klaim garansi/trial kenyamanan)
// SELALU order.status=DELIVERED (revisi cuma bisa diajukan untuk unit yang
// SUDAH terkirim — lihat guard di POST /revisions) DAN lahir UNSCHEDULED —
// jadi tanpa pengecualian ini, filter di atas langsung menyembunyikannya
// SAAT ITU JUGA, seolah itu job basi peninggalan sebelum Delivery Hub
// dipakai. Ditemukan lewat laporan owner: job pengambilan revisi Dewi
// (RES-18082026-071) baru dibuat tapi tidak muncul di Jadwal & Penugasan
// sama sekali. `revisionLinks: { none: {} }` — job dengan revisi yang
// menunjuk ke dirinya TIDAK PERNAH dianggap basi, apa pun status order-nya.
// KOREKSI KEDUA (11 September 2026, D-116) — bug yang sama terulang untuk
// ComplaintCase: job PICKUP dari POST /complaints/:id/delivery-task (kasus
// Sony RES-27082026-183, laporan owner: "di delivery masih belum bisa
// masuk rute") SELALU order.status=DELIVERED (itulah inti ComplaintCase --
// komplain baru terjadi SETELAH order pertama kali terkirim) DAN lahir
// UNSCHEDULED. `complaintCaseId: null` -- job yang menunjuk ke sebuah
// ComplaintCase TIDAK PERNAH dianggap basi, pola SAMA dengan revisionLinks.
export const STALE_UNSCHEDULED_JOB = {
  status: "UNSCHEDULED",
  order: { status: { in: ["DELIVERED", "CANCELLED"] } },
  revisionLinks: { none: {} },
  complaintCaseId: null,
};

// Rute "hantu" di Driver App (bug Alwan, 22 September 2026, laporan owner:
// "rute yang tidak ada di Route Planner muncul di Driver App"). AKAR
// MASALAH: GET /armada/my-jobs cuma pernah menyaring dari sisi Job
// (driverId/helperId + tanggal/status) — TIDAK PERNAH ikut memeriksa status
// Route induknya. Dua jalur nyata yang membuat itu jadi celah:
//   (1) PATCH /routes/:id/cancel SENGAJA tidak melepas job dari rute yang
//       dibatalkan (demi riwayat "rute ini pernah direncanakan" tetap
//       terbaca dispatcher) — tapi driver TIDAK PERNAH diberi tahu, job-nya
//       tetap "menempel" aktif di app walau rutenya sudah dicoret dari papan
//       Route Planner (CANCELLED disembunyikan dari papan utama).
//   (2) Rute DRAFT yang sudah kebagian driver (cascade D-077 di PATCH
//       /routes/:id/jobs, ATAU prefill) bisa saja job anggotanya sudah
//       berstatus ASSIGNED walau dispatcher BELUM klik "Terbitkan" — rute
//       itu belum pernah "ada" secara resmi buat driver, tapi my-jobs sudah
//       menampilkannya lebih dulu.
//
// ALLOWLIST, bukan denylist (dikoreksi 22 September 2026, audit QA
// produksi) — versi pertama menulis "sembunyikan DRAFT/CANCELLED, tampilkan
// sisanya". Itu BENAR untuk 5 nilai RouteStatus yang ada SEKARANG (schema.
// prisma), tapi kalau suatu hari ada nilai BARU (mis. "ON_HOLD") yang lupa
// diputuskan di sini, denylist otomatis MENAMPILKANNYA diam-diam — persis
// arah kesalahan yang sama dengan bug Alwan (job tampil padahal seharusnya
// tidak). Allowlist default-nya SEBALIKNYA: nilai baru yang belum eksplisit
// terdaftar otomatis DISEMBUNYIKAN sampai ditinjau — gagal ke arah yang
// lebih aman untuk kasus ini (driver tidak lihat rute yang belum committed,
// bukan driver lihat rute yang seharusnya belum boleh dilihat).
export const VISIBLE_ROUTE_STATUSES_FOR_DRIVER_APP = ["PUBLISHED", "IN_PROGRESS", "COMPLETED"];

// Status Job yang dianggap TUNTAS/settled buat Driver App — job ini
// representasi kerja yang SUDAH terjadi (atau sudah dipindah jalur
// penanganan lain), harus TETAP tampil ke driver apa pun nasib rutenya
// sekarang (riwayat nyata, bukan rencana yang batal/belum committed).
// RESCHEDULED disertakan (bukan cuma COMPLETED/FAILED seperti versi
// pertama) — SATU definisi dengan STATUS_STOP_TUNTAS di routes/armada.js
// (Live Tracking): job RESCHEDULED sudah dipindah alur (lihat D-160,
// routeId-nya SENGAJA di-null-kan saat reschedule), bukan lagi pekerjaan
// yang sedang berjalan, jadi diperlakukan sama seperti COMPLETED/FAILED di
// sini — bukan disaring lewat status Route (yang sudah null/tidak relevan).
// ⚠️ Prisma enum JobStatus PUNYA nilai ini tapi TIDAK ADA kode yang
// benar-benar menulis job.status="RESCHEDULED" per audit 22 September 2026
// (grep penuh routes/armada.js) — dicantumkan di sini SENGAJA untuk jaga-
// jaga (enum-nya ADA, jadi bukan "status tidak dikenal") supaya kalau nanti
// ada jalur yang mulai menulisnya, perilakunya sudah benar dari awal tanpa
// perlu ingat mengubah file ini lagi.
export const JOB_STATUS_SETTLED_FOR_DRIVER_APP = ["COMPLETED", "FAILED", "RESCHEDULED"];

// Job tanpa Route (routeId null — ditugaskan langsung lewat Jadwal &
// Penugasan, ATAU baru saja dilepas dari rute lewat PATCH /routes/:id/jobs)
// TIDAK disaring status Route sama sekali di sini — driverId/helperId pada
// Job itu sendiri SUDAH jadi gerbang kepemilikan (WHERE clause di GET
// /my-jobs), jadi ini penugasan yang sah walau tidak lewat Route Planner.
// Ini juga jalur aman untuk status Job yang TIDAK DIKENAL/rusak (bukan 8
// nilai JobStatus yang ada) — daripada diam-diam menyembunyikan pekerjaan
// yang MEMANG ditugaskan ke driver ini (gagal ke arah "job hilang dari
// app" jauh lebih berbahaya buat operasional daripada "job tampil dengan
// status aneh"), job apa pun yang sudah lolos gerbang driverId/helperId
// TETAP tampil kalau tidak terikat rute yang secara eksplisit disembunyikan.
export function isJobVisibleToDriverApp(job) {
  if (JOB_STATUS_SETTLED_FOR_DRIVER_APP.includes(job.status)) return true;
  if (!job.route) return true;
  return VISIBLE_ROUTE_STATUSES_FOR_DRIVER_APP.includes(job.route.status);
}
