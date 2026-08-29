// ═══ BACKFILL SEKALI — SalesRiskIntentClassification, populasi penuh ══════
// Satu-off, dijalankan manual SEKALI setelah test kecil dikonfirmasi user
// (29 Agustus 2026). TIDAK didaftarkan sbg cron — cron aslinya
// (intentClassificationJob.js#startSalesRiskIntentClassificationJob)
// diaktifkan terpisah di src/index.js utk jadwal harian 05:00 WIB
// selanjutnya. Reuse runSalesRiskIntentClassificationJob() APA ADANYA
// (fungsi yang sama dipakai cron harian) — tidak ada logic backfill
// terpisah, supaya tidak ada 2 jalur klasifikasi yang bisa drift.
//   docker compose exec backend node scripts/runIntentBackfillOnce.mjs
import { prisma } from "../src/db.js";
import { runSalesRiskIntentClassificationJob } from "../src/services/salesRisk/intentClassificationJob.js";

const summary = await runSalesRiskIntentClassificationJob();
console.log("\n═══ RINGKASAN BACKFILL ═══");
console.log(`Kandidat discan     : ${summary.candidatesScanned}`);
console.log(`Diklasifikasi baru  : ${summary.classified}`);
console.log(`Cache valid (skip)  : ${summary.skippedCacheValid}`);
console.log(`Tanpa pesan (skip)  : ${summary.skippedNoMessage}`);
console.log(`Gagal               : ${summary.failed}`);
console.log(`Total biaya         : $${summary.totalCostUsd.toFixed(4)}`);
console.log(`Token in/out        : ${summary.totalInputTokens} / ${summary.totalOutputTokens}`);

const dist = {};
for (const r of summary.results) dist[r.after] = (dist[r.after] || 0) + 1;
console.log("\nDistribusi intent hasil klasifikasi baru:");
for (const [k, v] of Object.entries(dist)) console.log(`  ${k.padEnd(24)} ${v}`);

if (summary.failed > 0) {
  console.log("\n⚠️  Ada yang gagal — cek log [sales-risk-intent] di atas utk detail per-customer.");
}

await prisma.$disconnect();
