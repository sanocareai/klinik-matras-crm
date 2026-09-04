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
export const STALE_UNSCHEDULED_JOB = {
  status: "UNSCHEDULED",
  order: { status: { in: ["DELIVERED", "CANCELLED"] } },
};
