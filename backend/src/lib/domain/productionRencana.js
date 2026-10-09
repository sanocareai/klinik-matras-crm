// Kelayakan unit nyata untuk Rencana Produksi — SATU definisi murni (tanpa DB) yang dipakai backlog (kartu), perintah onboarding+jadwal (validasi ulang di dalam
// transaksi), daftar eligibility Admin, dan skrip aktivasi cohort. Server = otoritas; UI hanya menampilkan hasilnya.
//
// Konsep:
//  - Unit order NYATA berstatus Diproses BELUM punya Production Run V2 (Run lahir dari custody pickup atau workshop). Status "Diproses" TIDAK membuktikan
//    unit sudah tiba secara fisik, jadi onboarding membuka Run berstatus PENDING_ARRIVAL (presence "Belum tiba di workshop"); tahap produksi baru bisa
//    dimulai setelah "Unit Tiba di Workshop" dikonfirmasi — gerbang itu TIDAK berubah.
//  - Onboarding hanya untuk unit di cohort writer+reader (aktivasi eksplisit oleh Owner lewat skrip/halaman Aktivasi) — tidak ada perluasan cohort otomatis.
//  - Unit yang sudah punya progres V1 (riwayat tahap/tahap berjalan) TIDAK di-onboard dari sini: riwayatnya harus dipetakan oleh backfill resmi agar tidak hilang.

export const RENCANA_ACTION = Object.freeze({
  SCHEDULE: "SCHEDULE", // sudah punya Run di cohort -> kartu rencana penuh (Jadwalkan / seret)
  ONBOARD_SCHEDULE: "ONBOARD_SCHEDULE", // eligible & aktif -> Jadwalkan membuka Run lalu menjadwalkan (satu perintah)
  AWAIT_ACTIVATION: "AWAIT_ACTIVATION", // eligible menurut data, tetapi cohort V2 belum mencakup unit ini
  WAIT_PICKUP: "WAIT_PICKUP", // belum diambil/dalam perjalanan masuk
  EXCEPTION: "EXCEPTION", // pengecualian dengan kode + penjelasan
});

export const RENCANA_EXCEPTION = Object.freeze({
  INTERNAL_OR_SPAM: "INTERNAL_OR_SPAM",
  UNIT_CANCELLED: "UNIT_CANCELLED",
  UNIT_FINISHED: "UNIT_FINISHED",
  ORDER_NOT_PROCESSING: "ORDER_NOT_PROCESSING",
  HAS_V1_PROGRESS: "HAS_V1_PROGRESS",
  PARTIAL_ACTIVATION: "PARTIAL_ACTIVATION",
  RUN_OUTSIDE_COHORT: "RUN_OUTSIDE_COHORT", // Run lama (custody/backfill) di luar cohort V2 — bukan tugas Rencana
  PKR_PERLU_DILENGKAPI: "PKR_PERLU_DILENGKAPI", // order Penjualan Karyawan yang spesifikasinya belum lengkap — Finance harus melengkapi dulu
});

const FINISHED_UNIT = ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"];
const PICKUP_UNIT = ["AWAITING_PICKUP", "IN_TRANSIT_IN"];
export const ONBOARD_UNIT_STATUSES = Object.freeze(["RECEIVED", "IN_PRODUCTION"]);

const act = (action, code, message, next) => ({ action, code, eligible: action === RENCANA_ACTION.ONBOARD_SCHEDULE || action === RENCANA_ACTION.SCHEDULE, message, next });

/**
 * @param {object} u
 * @param {string} u.unitStatus  Unit.status
 * @param {string} u.orderStatus Order.status
 * @param {string|null} [u.customerStage] Customer.pipelineStage
 * @param {boolean} [u.isInternalStaff]
 * @param {boolean} [u.hasActiveRun] ada Production Run non-terminal
 * @param {number} [u.stageLogCount] riwayat tahap V1
 * @param {boolean} [u.hasCurrentStage] tahap V1 berjalan
 * @param {boolean} [u.readerEnabled] unit ada di cohort reader
 * @param {boolean} [u.writerEnabled] unit ada di cohort writer
 * @param {{ nomor?: string|null, kurang: string[] }|null} [u.pkrKurang] order Penjualan Karyawan yang belum lengkap (data yang kurang); null/kosong = tidak ada hambatan
 */
export function classifyRencanaUnit(u) {
  const E = RENCANA_EXCEPTION; const A = RENCANA_ACTION;
  if (u.isInternalStaff || u.customerStage === "SPAM") return act(A.EXCEPTION, E.INTERNAL_OR_SPAM, "Pelanggan internal/spam — tidak masuk Rencana Produksi.", "Tidak ada tindakan.");
  if (u.unitStatus === "CANCELLED" || u.orderStatus === "CANCELLED") return act(A.EXCEPTION, E.UNIT_CANCELLED, "Order/unit dibatalkan — tidak masuk Rencana Produksi.", "Tidak ada tindakan.");
  if (FINISHED_UNIT.includes(u.unitStatus)) return act(A.EXCEPTION, E.UNIT_FINISHED, "Unit sudah Siap Kirim/Terkirim — tidak masuk Rencana Produksi.", "Lihat riwayatnya di Order Produksi.");
  if (u.pkrKurang?.kurang?.length) {
    return act(A.EXCEPTION, E.PKR_PERLU_DILENGKAPI,
      `Order Penjualan Karyawan${u.pkrKurang.nomor ? ` ${u.pkrKurang.nomor}` : ""} perlu dilengkapi dulu — belum bisa dijadwalkan. Data yang kurang: ${u.pkrKurang.kurang.join(", ")}.`,
      "Lengkapi di Finance › Penjualan Karyawan (Lengkapi spesifikasi order); setelah lengkap unit ini langsung bisa dijadwalkan.");
  }
  const activated = !!u.readerEnabled && !!u.writerEnabled;
  if (u.hasActiveRun) {
    if (activated) return act(A.SCHEDULE, null, "Sudah punya Run produksi — siap dijadwalkan.", "Klik Jadwalkan atau seret ke Meja.");
    if (!!u.readerEnabled !== !!u.writerEnabled) return act(A.EXCEPTION, E.PARTIAL_ACTIVATION, "Unit sudah punya Run produksi, tetapi aktivasi V2-nya belum lengkap (reader dan writer harus sama-sama mencakup unit ini).", "Minta Owner melengkapi aktivasi (lihat Aktivasi Rencana).");
    return act(A.EXCEPTION, E.RUN_OUTSIDE_COHORT, "Unit sudah punya Run produksi lama (hasil custody/backfill) di luar cohort V2 — tidak diaktifkan dari Rencana Produksi.", "Pengaktifannya keputusan terpisah Owner/tim sistem (mengubah kepemilikan V2 atas unit yang sudah berjalan).");
  }
  if (PICKUP_UNIT.includes(u.unitStatus)) return act(A.WAIT_PICKUP, null, "Unit belum diambil dari pelanggan / belum sampai — belum bisa dijadwalkan.", "Dijadwalkan setelah masuk Diproses (pickup selesai).");
  if (u.orderStatus !== "PROCESSING" || !ONBOARD_UNIT_STATUSES.includes(u.unitStatus)) {
    return act(A.EXCEPTION, E.ORDER_NOT_PROCESSING, "Order belum berstatus Diproses — belum masuk Rencana Produksi.", "Menunggu status order Diproses.");
  }
  if ((u.stageLogCount || 0) > 0 || u.hasCurrentStage) {
    return act(A.EXCEPTION, E.HAS_V1_PROGRESS, "Unit sudah punya progres produksi lama (V1). Riwayatnya harus dipindahkan oleh backfill resmi agar tidak hilang — bukan lewat tombol Jadwalkan.", "Minta tim sistem menjalankan backfill unit ini, lalu muat ulang.");
  }
  if (activated) return act(A.ONBOARD_SCHEDULE, null, "Siap dijadwalkan — Jadwalkan membuka Run produksi unit ini lalu menjadwalkannya (satu langkah).", "Klik Jadwalkan atau seret ke Meja.");
  if (u.readerEnabled !== u.writerEnabled) {
    return act(A.EXCEPTION, E.PARTIAL_ACTIVATION, "Aktivasi V2 unit ini belum lengkap (hanya reader atau hanya writer).", "Minta Owner melengkapi aktivasi (lihat Aktivasi Rencana).");
  }
  return act(A.AWAIT_ACTIVATION, null, "Eligible, tetapi belum diaktifkan untuk Rencana Produksi (menunggu keputusan Owner).", "Owner mengaktifkan unit ini lewat Aktivasi Rencana.");
}

// Penjelasan foto kosong untuk kartu. `diagnosis` dari diagnoseUnitPhotosBulk(); photoUrl non-null = ada foto (tidak perlu penjelasan).
export function photoNoteOf({ photoUrl, diagnosis }) {
  if (photoUrl) return null;
  const d = diagnosis || { status: "NO_PICKUP" };
  if (d.status === "AMBIGUOUS") {
    return { status: "AMBIGUOUS", text: `Foto pickup ada di Delivery, tetapi dipakai bersama ${d.jobUnitCount} unit — tidak bisa dipastikan unit mana pemiliknya, jadi tidak ditampilkan.` };
  }
  if (d.status === "NO_PHOTO") return { status: "NO_PHOTO", text: "Pickup tercatat, tetapi driver belum mengunggah foto bukti. Foto muncul otomatis setelah pickup selesai." };
  return { status: "NO_PICKUP", text: "Belum ada pickup berfoto untuk unit ini." };
}
