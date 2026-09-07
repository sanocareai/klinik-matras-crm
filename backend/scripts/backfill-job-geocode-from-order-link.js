// PERBAIKAN GEOCODING — investigasi 7 September 2026, laporan owner: tombol
// "Buat Peta" di Route Planner "mental kemana-mana" (pin salah lokasi).
// DIPERKETAT 8 September 2026 jadi kebijakan LINK-ONLY (laporan owner: "kita
// perketat hanya link google maps saja") — lihat catatan panjang di
// services/maps.js#geocodeAddress untuk riwayat lengkap keputusan ini.
//
// AKAR MASALAH: Job.lat/lng dulu SELALU di-geocode dari Job.addressText
// (alamat teks bebas ketikan sales) lewat Nominatim/LocationIQ/Google, yang
// untuk alamat Indonesia detail (blok/RT-RW) SERING gagal cocok tepat — pin
// jatuh di level kelurahan/kecamatan, kadang salah kelurahan, bahkan pernah
// nyasar ratusan km. Order.locationUrl (link Google Maps yang sales/admin
// dapat LANGSUNG dari customer) jauh lebih akurat DAN sekarang jadi
// SATU-SATUNYA sumber yang dipercaya (geocodeAddress() tidak lagi menebak
// dari teks sama sekali).
//
// Fix di kode (armada.js/maps.js) menutup lubang untuk job BARU dan job yang
// diedit ulang, PLUS "Buat Peta" sekarang otomatis self-heal job yang
// lat-nya masih null (kalau order-nya punya link). Script ini untuk kasus
// yang self-heal TIDAK menyentuh: job yang SUDAH punya lat/lng (dari
// geocoding lama, mungkin kurang akurat) — ensureJobsGeocoded() SENGAJA
// tidak menimpa job yang sudah ada koordinat (supaya klik "Buat Peta" tetap
// cepat). Script inilah yang melakukan upgrade retroaktif itu: SEMUA job
// aktif yang order-nya punya locationUrl di-geocode ULANG dari link
// tersebut dan MENIMPA lat/lng lama, apa pun sumbernya sebelumnya.
//
// Job aktif yang order-nya TIDAK punya locationUrl TIDAK disentuh script
// ini (tidak ada yang bisa di-geocode tanpa link) — kalau job itu KEBETULAN
// masih menyimpan koordinat dari kebijakan lama (geocoding tebakan sebelum
// 8 September 2026), itu tugas scripts/clear-non-link-job-geocode.js untuk
// membersihkannya, BUKAN script ini.
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
      order: { locationUrl: { not: null } },
    },
    select: {
      id: true, type: true, lat: true, lng: true,
      order: { select: { orderNumber: true, locationUrl: true } },
    },
  });

  console.log(`${jobs.length} job aktif dengan Order.locationUrl ditemukan.\n`);

  let berhasil = 0, gagalResolve = 0;
  for (const j of jobs) {
    const label = `${j.order.orderNumber} (${j.type}, job ${j.id.slice(0, 8)})`;
    let geo;
    try {
      // addressText SENGAJA tidak dikirim — kebijakan link-only, sumber
      // satu-satunya adalah j.order.locationUrl (lihat catatan kepala file).
      geo = await geocodeAddress(null, j.order.locationUrl);
    } catch (err) {
      console.log(`${label}: GAGAL geocode (${err.message}) — dilewati.`);
      gagalResolve++;
      continue;
    }
    if (!geo) {
      console.log(`${label}: link ada tapi tidak bisa di-resolve jadi koordinat — dilewati.`);
      gagalResolve++;
      continue;
    }

    const sebelum = j.lat != null ? `${j.lat.toFixed(5)},${j.lng.toFixed(5)}` : "(belum ada)";
    const sesudah = `${geo.lat.toFixed(5)},${geo.lng.toFixed(5)}`;
    console.log(`${label}: ${sebelum} -> ${sesudah}`);
    berhasil++;

    if (!APPLY) continue;
    await prisma.job.update({ where: { id: j.id }, data: { lat: geo.lat, lng: geo.lng } });
  }

  console.log(`\n${berhasil} berhasil di-resolve, ${gagalResolve} gagal/tidak bisa di-resolve.`);
  if (!APPLY) console.log("Jalankan ulang dengan --apply untuk benar-benar menulis ke database.");
  else console.log("Selesai — lat/lng job di atas sudah ditulis ke database.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
