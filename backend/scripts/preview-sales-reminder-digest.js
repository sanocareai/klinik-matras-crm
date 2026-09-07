// Cetak contoh pesan digest sales reminder dari DATA NYATA SEKARANG, TANPA
// mengirim WA apa pun (buildDigest() murni baca, tidak menyentuh WAHA sama
// sekali). Dipakai untuk peninjauan sebelum salesReminderDigest diaktifkan
// (data/settings.json > salesReminderDigest.enabled).
//
// Pakai:
//   docker compose exec backend node scripts/preview-sales-reminder-digest.js
//   docker compose exec backend node scripts/preview-sales-reminder-digest.js --eod
//     (--eod = paksa simulasi SEOLAH sedang di jam eodHour, supaya poin
//      "belum closing" & "follow-up H+1" ikut tampil di preview walau
//      script ini dijalankan bukan pas jam itu)

import { buildDigest } from "../src/services/salesReminderDigestJob.js";
import { prisma } from "../src/db.js";

async function main() {
  const forceEod = process.argv.includes("--eod");
  let referenceNow = new Date();
  if (forceEod) {
    // Geser waktu simulasi ke jam eodHour WIB hari ini (tanpa ubah
    // tanggal), supaya query "hari ini" tetap benar.
    const jamWibSekarang = new Date(referenceNow.getTime() + 7 * 3_600_000).getUTCHours();
    referenceNow = new Date(referenceNow.getTime() + (17 - jamWibSekarang) * 3_600_000);
  }

  const { config, eodSlot, digests } = await buildDigest({ referenceNow });

  console.log("=".repeat(70));
  console.log(`Config aktif:`, JSON.stringify({ ...config, salesPhoneDirectory: `${config.salesPhoneDirectory.length} entri` }, null, 2));
  console.log(`Slot akhir-hari (poin belum-closing & follow-up H+1 ikut tampil)? ${eodSlot ? "YA" : "TIDAK"}`);
  console.log(`Sales dengan minimal 1 hal untuk dilaporkan: ${digests.length}`);
  console.log("=".repeat(70));

  if (digests.length === 0) {
    console.log("\n(Tidak ada satu pun sales yang perlu dikirimi digest saat ini.)");
  }

  for (const { sales, phone, pesan } of digests) {
    console.log(`\n--- ${sales.name} (nomor WA: ${phone || "❌ BELUM TERDAFTAR di slaAlert.salesPhoneDirectory"}) ---`);
    console.log(pesan);
  }

  console.log("\n" + "=".repeat(70));
  console.log("Preview selesai. TIDAK ADA WA yang benar-benar terkirim dari script ini.");
}

main()
  .catch((err) => { console.error("Gagal generate preview:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
