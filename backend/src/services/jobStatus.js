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
