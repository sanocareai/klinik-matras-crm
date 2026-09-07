// KEBIJAKAN GEOCODING LINK-ONLY (8 September 2026, keputusan owner: "kita
// perketat hanya link google maps saja, untuk orderan yang gaada google
// maps nya kasih notifikasi... ketika klik buat peta orderan yang gaada
// link nya terisi kosong dan harus cari manual admin deliverynya") — lihat
// catatan panjang di services/maps.js#geocodeAddress untuk riwayat lengkap.
//
// Job BARU/diedit dan "Buat Peta" sudah otomatis mengikuti kebijakan ini
// (geocodeAddress() tidak lagi menebak dari teks alamat sama sekali). Tapi
// job AKTIF yang SUDAH punya lat/lng dari kebijakan LAMA (Google Geocoding/
// LocationIQ/Nominatim menebak dari Job.addressText, sebelum 8 September
// 2026) TIDAK otomatis terhapus — koordinat lama itu MASIH TERSIMPAN dan
// masih akan dipakai apa adanya (RouteMap.jsx, buildRouteMapsUrl, estimasi
// jarak Dashboard) walau order-nya TIDAK PUNYA link Maps sama sekali.
// Itu bertentangan dengan kebijakan baru — dispatcher/admin delivery bisa
// mengira pin itu terpercaya (dari link) padahal sebenarnya tebakan lama.
//
// Script ini membersihkan SISA itu: job AKTIF (ACTIVE_JOB_STATUSES) yang
// order-nya TIDAK punya locationUrl TAPI job-nya masih punya lat/lng —
// koordinatnya di-NULL-kan (bukan digeocode ulang, TIDAK ADA sumber lain
// yang boleh dipercaya sekarang selain link). Setelah ini:
//   - Job tsb HILANG dari RouteMap.jsx (cuma menggambar stop yang punya
//     koordinat) dan DIKECUALIKAN dari URL "Buat Peta" (buildRouteMapsUrl).
//   - Badge "Tanpa link Maps" (JobBadges.jsx) tetap/mulai tampil di
//     kartunya — sinyal itu SUDAH berbasis ada/tidaknya locationUrl, bukan
//     ada/tidaknya lat/lng, jadi tidak berubah akibat script ini.
//   - Dashboard Needs Attention (job SUDAH terjadwal tanpa link Maps) tetap
//     menandai job ini kalau relevan — admin delivery WAJIB cari lokasinya
//     manual/follow-up ke sales untuk link Maps.
//
// TIDAK menyentuh job COMPLETED/FAILED/CANCELLED (riwayat, tidak lagi
// butuh peta akurat) — konsisten dengan cakupan
// backfill-job-geocode-from-order-link.js.
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/clear-non-link-job-geocode.js
//   docker compose exec backend node scripts/clear-non-link-job-geocode.js --apply

import { prisma } from "../src/db.js";
import { ACTIVE_JOB_STATUSES } from "../src/services/jobStatus.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau)"}\n`);

  const jobs = await prisma.job.findMany({
    where: {
      status: { in: ACTIVE_JOB_STATUSES },
      lat: { not: null },
      order: { OR: [{ locationUrl: null }, { locationUrl: "" }] },
    },
    select: {
      id: true, type: true, lat: true, lng: true,
      order: { select: { orderNumber: true } },
    },
  });

  console.log(`${jobs.length} job aktif TANPA link Maps tapi masih punya koordinat (tebakan lama) ditemukan.\n`);

  for (const j of jobs) {
    console.log(`${j.order.orderNumber} (${j.type}, job ${j.id.slice(0, 8)}): ${j.lat.toFixed(5)},${j.lng.toFixed(5)} -> (dikosongkan)`);
    if (!APPLY) continue;
    await prisma.job.update({ where: { id: j.id }, data: { lat: null, lng: null } });
  }

  if (!APPLY) console.log("\nJalankan ulang dengan --apply untuk benar-benar mengosongkan lat/lng job di atas.");
  else console.log(`\nSelesai — ${jobs.length} job dikosongkan koordinatnya. Admin delivery perlu follow up ke sales untuk link Maps order-order ini.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
