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
// FIX: job yang SUDAH tuntas (COMPLETED/FAILED) TETAP tampil apa pun nasib
// rutenya sekarang (riwayat nyata, bukan rencana) — cuma job yang MASIH
// aktif/belum tuntas yang disaring ulang di sini: rute DRAFT/CANCELLED
// disembunyikan dari Driver App, PUBLISHED/IN_PROGRESS/COMPLETED tetap
// tampil. Job tanpa rute sama sekali (routeId null, ditugaskan langsung
// lewat Jadwal & Penugasan) TIDAK terdampak — itu penugasan sah yang
// memang tidak lewat Route Planner.
export const HIDDEN_DRIVER_APP_ROUTE_STATUSES = ["DRAFT", "CANCELLED"];

export function isJobVisibleToDriverApp(job) {
  if (job.status === "COMPLETED" || job.status === "FAILED") return true;
  if (!job.route) return true;
  return !HIDDEN_DRIVER_APP_ROUTE_STATUSES.includes(job.route.status);
}
