// Cetak contoh pesan sales-reminder dari DATA NYATA SEKARANG, TANPA
// mengirim WA apa pun dan TANPA menulis baris StaffBroadcast (run*Cycle
// hanya kirim/catat kalau dryRun:false DAN enabled:true — lihat
// dispatchSection() di salesReminderDigestJob.js). Dipakai untuk
// peninjauan sebelum salesReminderDigest diaktifkan
// (data/settings.json > salesReminderDigest.enabled).
//
// Sekarang 5 TOPIK TERPISAH (revisi 7 Sep 2026) — masing-masing dicetak
// sendiri, persis seperti akan tampil sebagai broadcast masing-masing di
// jam terjadwalnya.
//
// Pakai:
//   docker compose exec backend node scripts/preview-sales-reminder-digest.js

import {
  runUnreadCycle, runHangingCycle, runIncompleteCycle,
  runProcessingCycle, runFollowUpCycle, runZeroClosingCycle,
} from "../src/services/salesReminderDigestJob.js";
import { prisma } from "../src/db.js";

const TOPIK = [
  ["Chat Belum Dibaca", runUnreadCycle],
  ["Chat Menggantung", runHangingCycle],
  ["Data Belum Lengkap", runIncompleteCycle],
  ["Mulai Diproses", runProcessingCycle],
  ["Follow-up H+1", runFollowUpCycle],
  ["Belum Closing", runZeroClosingCycle],
];

async function main() {
  for (const [label, fn] of TOPIK) {
    console.log("=".repeat(70));
    console.log(`TOPIK: ${label}`);
    console.log("=".repeat(70));
    const summary = await fn({ dryRun: true });
    console.log(`Sales dengan minimal 1 hal untuk topik ini: ${summary.salesWithItems}\n`);
  }
  console.log("=".repeat(70));
  console.log("Preview selesai. TIDAK ADA WA yang terkirim, TIDAK ADA baris riwayat ditulis.");
}

main()
  .catch((err) => { console.error("Gagal generate preview:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
