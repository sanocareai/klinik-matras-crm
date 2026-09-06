// BACKFILL: rute PUBLISHED yang SEMUA job-nya sudah tuntas (COMPLETED/
// FAILED) tapi Route.status masih "PUBLISHED" — karena syncRouteCompletionStatus
// (services/orderStatusSync.js) baru ditambahkan 6 September 2026 dan cuma
// jalan begitu ADA job yang baru diselesaikan/digagalkan SETELAH kode ini
// ada, rute yang SUDAH tuntas SEBELUM perbaikan ini di-deploy tidak ikut
// otomatis ter-backfill. Script ini menjalankan pengecekan yang SAMA ke
// SEMUA rute PUBLISHED yang ada sekarang, satu kali.
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/backfill-route-completion.js
//   docker compose exec backend node scripts/backfill-route-completion.js --apply

import { prisma } from "../src/db.js";
import { syncRouteCompletionStatus } from "../src/services/orderStatusSync.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau)"}\n`);

  const routes = await prisma.route.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, code: true, jobs: { select: { status: true } } },
  });

  let jumlahSelesai = 0;
  for (const route of routes) {
    if (route.jobs.length === 0) continue;
    const semuaTuntas = route.jobs.every((j) => ["COMPLETED", "FAILED"].includes(j.status));
    if (!semuaTuntas) continue;
    jumlahSelesai++;
    console.log(`${route.code}: ${route.jobs.length} job semua tuntas -> akan ditandai COMPLETED.`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await syncRouteCompletionStatus(tx, route.id);
      });
    }
  }

  console.log(`\n${jumlahSelesai} dari ${routes.length} rute PUBLISHED yang semua job-nya tuntas.`);
  if (!APPLY) console.log("Jalankan ulang dengan --apply untuk benar-benar menulis.");
}

main()
  .catch((err) => {
    console.error("Gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
