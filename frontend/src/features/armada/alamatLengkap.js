// Alamat/tujuan pengiriman belum bisa dipakai pengemudi (19 Okt 2026, keputusan Owner): kelengkapan data TIDAK menahan penjadwalan — hanya PERINGATAN yang terlihat jelas.
// Modul murni (tanpa alias '@/') supaya bisa diuji langsung. STATUS_JOB_AKTIF harus sama dengan ACTIVE_STATUSES di jobStatus.js (dijaga tes).
export const STATUS_JOB_AKTIF = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

/** true bila job DELIVERY aktif tidak punya teks alamat, koordinat, maupun link Maps dari sales. */
export function alamatBelumLengkap(job) {
  if (!job || job.type !== "DELIVERY" || !STATUS_JOB_AKTIF.includes(job.status)) return false;
  const adaTeks = String(job.addressText ?? "").trim().length > 0;
  const adaKoordinat = Number.isFinite(job.lat) && Number.isFinite(job.lng);
  const adaLink = !!(job.order?.locationUrl || job.units?.[0]?.unit?.order?.locationUrl);
  return !adaTeks && !adaKoordinat && !adaLink;
}
