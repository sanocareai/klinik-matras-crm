// PERBAIKAN GEOCODING — investigasi 7 September 2026, laporan owner: tombol
// "Buat Peta" di Route Planner "mental kemana-mana" (pin salah lokasi).
// DIPERLUAS 8 September 2026 (laporan owner lanjutan: "dengan aktifnya
// Google Maps API, memudahkan semua... akurasi harus semakin akurat").
//
// AKAR MASALAH (lihat catatan panjang di services/maps.js#geocodeAddress dan
// routes/armada.js#ensureJobsGeocoded): Job.lat/lng SELALU di-geocode dari
// Job.addressText (alamat teks bebas ketikan sales) lewat Nominatim/
// LocationIQ, yang untuk alamat Indonesia detail (blok/RT-RW) SERING gagal
// cocok tepat — pin jatuh di level kelurahan/kecamatan, kadang salah
// kelurahan. Order.locationUrl (link Google Maps yang sales/admin dapat
// LANGSUNG dari customer) jauh lebih akurat, TAPI field ini tidak PERNAH
// dipakai untuk geocoding job sampai fix 7 September 2026.
//
// Fix di kode (armada.js/maps.js) menutup lubang untuk job BARU dan job yang
// diedit ulang, PLUS "Buat Peta" sekarang otomatis self-heal job yang lat-nya
// masih null (link ATAU, sejak 8 September, geocodeAddress penuh kalau
// TIDAK ada link — billing Google Cloud sudah aktif). Script ini untuk
// kasus yang self-heal TIDAK menyentuh: job yang SUDAH punya lat/lng (dari
// Nominatim/LocationIQ, mungkin kurang akurat) — ensureJobsGeocoded()
// SENGAJA tidak menimpa job yang sudah ada koordinat (supaya klik "Buat
// Peta" tetap cepat). Script inilah yang melakukan upgrade retroaktif itu:
// SEMUA job aktif yang punya locationUrl ATAU addressText di-geocode ULANG
// lewat geocodeAddress() (prioritas SAMA dengan jalur normal: link order ->
// Google Geocoding API -> LocationIQ -> Nominatim) dan MENIMPA lat/lng
// lama, apa pun sumbernya sebelumnya.
//
// CAKUPAN: job dengan status AKTIF saja (ACTIVE_JOB_STATUSES) — job yang
// sudah COMPLETED/FAILED/CANCELLED tidak lagi butuh peta akurat, tidak perlu
// dibakar kuota fetch untuk itu.
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/backfill-job-geocode-from-order-link.js
//   docker compose exec backend node scripts/backfill-job-geocode-from-order-link.js --apply

import { prisma } from "../src/db.js";
import { geocodeAddress } from "../src/services/maps.js";
import { ACTIVE_JOB_STATUSES } from "../src/services/jobStatus.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau)"}\n`);

  const jobs = await prisma.job.findMany({
    where: {
      status: { in: ACTIVE_JOB_STATUSES },
      OR: [{ order: { locationUrl: { not: null } } }, { addressText: { not: null } }],
    },
    select: {
      id: true, type: true, lat: true, lng: true, addressText: true,
      order: { select: { orderNumber: true, locationUrl: true } },
    },
  });

  console.log(`${jobs.length} job aktif dengan link Maps dan/atau alamat teks ditemukan.\n`);

  let berhasil = 0, gagalResolve = 0, dilewati = 0;
  for (const j of jobs) {
    const label = `${j.order.orderNumber} (${j.type}, job ${j.id.slice(0, 8)})`;
    if (!j.order.locationUrl && !j.addressText?.trim()) {
      dilewati++;
      continue;
    }
    let geo;
    try {
      geo = await geocodeAddress(j.addressText, j.order.locationUrl);
    } catch (err) {
      console.log(`${label}: GAGAL geocode (${err.message}) — dilewati.`);
      gagalResolve++;
      continue;
    }
    if (!geo) {
      console.log(`${label}: tidak bisa di-resolve jadi koordinat sama sekali — dilewati.`);
      gagalResolve++;
      continue;
    }

    const sebelum = j.lat != null ? `${j.lat.toFixed(5)},${j.lng.toFixed(5)}` : "(belum ada)";
    const sesudah = `${geo.lat.toFixed(5)},${geo.lng.toFixed(5)}`;
    const sumber = j.order.locationUrl ? "link order" : geo.estimate ? "geocode perkiraan" : "Google Geocoding";
    console.log(`${label}: ${sebelum} -> ${sesudah} (${sumber})`);
    berhasil++;

    if (!APPLY) continue;
    await prisma.job.update({ where: { id: j.id }, data: { lat: geo.lat, lng: geo.lng } });
  }

  console.log(`\n${berhasil} berhasil di-resolve, ${gagalResolve} gagal/tidak bisa di-resolve, ${dilewati} dilewati (tidak ada link maupun alamat).`);
  if (!APPLY) console.log("Jalankan ulang dengan --apply untuk benar-benar menulis ke database.");
  else console.log("Selesai — lat/lng job di atas sudah ditulis ke database.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
