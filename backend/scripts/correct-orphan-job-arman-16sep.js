// Koreksi job orphan Arman (22 September 2026, audit "Route Planner dan
// Driver App harus identik", laporan owner: "Arman memiliki job orphan
// EN_ROUTE sejak 16 September, padahal tidak ada route pada tanggal
// tersebut. Hari ini Arman baru tergabung dengan Agung di
// RTE-220926-01").
//
// TEMUAN (dikonfirmasi via query read-only produksi sebelum script ini
// ditulis): job 07c49dcc-cc1c-4034-b57b-901e10f33277 (order
// SWS-08092026-003, customer N.Roeswana) — type DELIVERY, status
// EN_ROUTE, routeId NULL, scheduledDate 2026-09-16, driverId = Arman,
// helperId = Agung (peninggalan dari rute lama yang sudah dilepas/
// dihapus — mekanismenya SAMA dengan pola "job dilepas dari rute lewat
// PATCH /routes/:id/jobs atau /routes/:id/cancel, driverId/helperId lama
// TIDAK ikut dibersihkan" yang jadi salah satu akar bug Alwan). Job ini
// TIDAK PERNAH benar-benar diselesaikan di lapangan (tidak ada
// completedAt/proofPhotoUrls) — nyangkut EN_ROUTE selama 6+ hari.
//
// KENAPA BUKAN LEWAT POST /jobs/:id/complete ATAU /fail (endpoint normal):
// /fail MEWAJIBKAN foto bukti (FR-D-07, "tanpa kecuali") — TIDAK ADA foto
// asli untuk kegagalan yang terjadi (atau TIDAK terjadi) 6 hari lalu,
// membuat foto palsu = fabrikasi (dilarang keras). Ini KOREKSI DATA
// administratif, bukan laporan lapangan sungguhan — pola yang SAMA dengan
// backfill-complete-stale-pickups.js (script serupa sebelumnya).
//
// KEBIJAKAN: FAILED (bukan COMPLETED — job ini TIDAK terbukti selesai;
// bukan hard-delete — baris TETAP ada sebagai riwayat/audit trail;
// failureReason diisi PENJELASAN LENGKAP kondisi sebelumnya + kenapa
// dikoreksi, field yang MEMANG didesain untuk itu, bukan kolom baru).
// TIDAK menyentuh field lain job ini (proofPhotoUrls/dst dibiarkan kosong
// apa adanya, JUJUR — kita tidak tahu apa yang sungguhan terjadi).
//
// TIDAK MENYENTUH keanggotaan Arman di RTE-220926-01 (rute AKTIF hari ini)
// — script ini HANYA menyentuh SATU baris job dengan ID persis di atas,
// tidak ada filter tanggal/status yang bisa "nyasar" ke job lain.
//
// SEBELUM koreksi, script ini JUGA mencari (read-only, tidak mengubah
// apa pun) orphan AKTIF lain company-wide, dilaporkan ke output supaya
// TIDAK ADA yang diam-diam ikut ke-bulk-fix — kalau ternyata ada orphan
// lain, WAJIB ditinjau manusia dulu sebelum dibuatkan koreksi terpisah.
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/correct-orphan-job-arman-16sep.js
//   docker compose exec backend node scripts/correct-orphan-job-arman-16sep.js --apply

import { prisma } from "../src/db.js";
import { assertLegacyDeliveryRepairAllowed } from "../src/services/deliveryCrossBoundaryCommandService.js";

const APPLY = process.argv.includes("--apply");
const JOB_ID = "07c49dcc-cc1c-4034-b57b-901e10f33277";
const ALASAN_KOREKSI =
  "[Koreksi data 22 September 2026] Job ini ditinggalkan EN_ROUTE tanpa " +
  "route (routeId NULL) sejak 16 September 2026 — peninggalan dari rute " +
  "lama yang sudah dilepas/dihapus, driverId/helperId lama (Arman/Agung) " +
  "tidak ikut dibersihkan saat itu (akar bug yang sama dengan kasus " +
  "Alwan, sudah diperbaiki di kode 22 Sep 2026). TIDAK ADA bukti " +
  "completedAt/proofPhotoUrls — job ini tidak terbukti pernah benar-benar " +
  "diselesaikan atau digagalkan di lapangan. Ditandai FAILED secara " +
  "administratif oleh audit teknis supaya tidak lagi nyangkut sebagai " +
  "\"aktif\" di app driver manapun; BUKAN laporan kegagalan lapangan " +
  "sungguhan. Baris tidak dihapus — tetap tersedia sebagai riwayat/audit.";

async function main() {
  if (APPLY) await assertLegacyDeliveryRepairAllowed(prisma, "correct-orphan-job-arman-16sep.js");
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau)"}\n`);

  // 1) Pemindaian LUAS (read-only) — job orphan AKTIF company-wide, supaya
  // kalau ada kasus lain di luar Arman, itu KELIHATAN di sini dan TIDAK
  // ikut tersentuh oleh --apply di bawah (yang scope-nya SATU job spesifik).
  const semuaOrphanAktif = await prisma.job.findMany({
    where: { driverId: { not: null }, routeId: null, status: { notIn: ["COMPLETED", "FAILED"] } },
    include: { driver: { select: { name: true } }, order: { select: { orderNumber: true } } },
  });
  console.log(`=== Pemindaian company-wide: ${semuaOrphanAktif.length} job orphan AKTIF ditemukan ===`);
  for (const j of semuaOrphanAktif) {
    const tanda = j.id === JOB_ID ? " ← YANG DIKOREKSI SCRIPT INI" : " ⚠ DI LUAR SCOPE SCRIPT INI, PERLU DITINJAU TERPISAH";
    console.log(`  - job=${j.id} driver=${j.driver?.name} status=${j.status} order=${j.order?.orderNumber} scheduledDate=${j.scheduledDate?.toISOString().slice(0, 10)}${tanda}`);
  }
  if (semuaOrphanAktif.some((j) => j.id !== JOB_ID)) {
    console.log("\n⚠ ADA job orphan LAIN di luar scope script ini — TIDAK disentuh, tinjau manual dulu sebelum membuat koreksi terpisah.\n");
  }

  // 2) Verifikasi job TARGET masih sesuai kondisi yang diharapkan SEBELUM
  // menyentuhnya — kalau sudah berubah (mis. sudah ditangani manual oleh
  // dispatcher sejak audit awal), JANGAN dipaksa timpa.
  const job = await prisma.job.findUnique({
    where: { id: JOB_ID },
    include: { driver: { select: { name: true } }, helper: { select: { name: true } }, order: { select: { orderNumber: true } } },
  });
  if (!job) {
    console.log(`\nJob ${JOB_ID} tidak ditemukan — tidak ada yang dikoreksi.`);
    return;
  }
  console.log(`\n=== Job target ===`);
  console.log(`id=${job.id} order=${job.order?.orderNumber} driver=${job.driver?.name} helper=${job.helper?.name}`);
  console.log(`status=${job.status} routeId=${job.routeId} scheduledDate=${job.scheduledDate?.toISOString().slice(0, 10)} completedAt=${job.completedAt}`);

  const kondisiSesuai = job.routeId === null && job.status === "EN_ROUTE" && !job.completedAt;
  if (!kondisiSesuai) {
    console.log("\nKondisi job SUDAH BERBEDA dari yang diharapkan script ini (routeId null + status EN_ROUTE + belum completedAt) — TIDAK dikoreksi, tinjau manual.");
    return;
  }

  if (!APPLY) {
    console.log("\nJalankan ulang dengan --apply untuk benar-benar menulis ke database.");
    return;
  }

  await prisma.job.update({
    where: { id: JOB_ID },
    data: { status: "FAILED", failureReason: ALASAN_KOREKSI },
  });
  console.log(`\nSelesai — job ${JOB_ID} ditandai FAILED dengan alasan koreksi tercatat di failureReason. Keanggotaan Arman di RTE-220926-01 TIDAK disentuh.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
