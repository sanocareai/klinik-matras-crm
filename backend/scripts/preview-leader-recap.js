// Cetak contoh rekap tim harian utk leader (Novi) dari DATA NYATA SEKARANG,
// TANPA mengirim WA apa pun dan TANPA menulis baris StaffBroadcast (sama
// pola dgn scripts/preview-sales-reminder-digest.js). Dipakai untuk
// peninjauan sebelum leaderRecap diaktifkan
// (data/settings.json > leaderRecap.enabled).
//
// Pakai:
//   docker compose exec backend node scripts/preview-leader-recap.js

import { buildRecap } from "../src/services/leaderRecapJob.js";
import { prisma } from "../src/db.js";

async function main() {
  const { config, pesan, leaders } = await buildRecap({});

  console.log("=".repeat(70));
  console.log("Config aktif:", JSON.stringify(config, null, 2));
  console.log(`Leader ditemukan (isSalesTeamLead=true, active): ${leaders.length}`);
  for (const l of leaders) console.log(`  - ${l.name}`);
  console.log("=".repeat(70));
  console.log("\n" + pesan + "\n");
  console.log("=".repeat(70));
  console.log("Preview selesai. TIDAK ADA WA yang terkirim, TIDAK ADA baris riwayat ditulis.");
}

main()
  .catch((err) => { console.error("Gagal generate preview:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
