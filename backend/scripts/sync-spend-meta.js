// Sinkronisasi spend harian Meta (rolling 7 hari). HANYA BACA dari Meta; tidak mengubah campaign/ad set/ads/budget. BAWAAN MATI.
//
//   docker exec klinik-matras-backend-1 node scripts/sync-spend-meta.js --cek    # periksa kesiapan saja (flag, kredensial ada?, izin ads_read, zona WIB, IDR)
//   docker exec klinik-matras-backend-1 node scripts/sync-spend-meta.js --dry    # tarik + rencana (tidak menulis)
//   docker exec klinik-matras-backend-1 node scripts/sync-spend-meta.js          # tarik + tulis (hanya bila SIAP)
// Aktif hanya bila SPEND_SYNC_ENABLED=true, META_ADS_ACCESS_TOKEN, META_ADS_ACCOUNT_ID ada DAN ads_read terbukti. Nilai kredensial tidak pernah dicetak.
// Kode keluar: 0 selesai | 3 tidak siap/dilewati (bukan galat) | 2 galat sinkronisasi.
import { prisma } from "../src/db.js";
import { periksaKesiapan, sinkronkanSpendMeta } from "../src/services/attribution/spendSyncMeta.js";

const cek = process.argv.includes("--cek"), dry = process.argv.includes("--dry");
try {
  if (cek) {
    const k = await periksaKesiapan();
    console.log(JSON.stringify({ kesiapan: { siap: k.siap, alasan: k.alasan, izinAdsRead: k.izinAdsRead, zonaWaktu: k.zonaWaktu, mataUang: k.mataUang, akun: k.akun } }));
    process.exitCode = k.siap ? 0 : 3;
  } else {
    const h = await sinkronkanSpendMeta(prisma, { dryRun: dry });
    console.log(JSON.stringify(h.status === "TIDAK_SIAP" ? { status: h.status, alasan: h.kesiapan.alasan } : h));
    process.exitCode = ["SELESAI", "DRY_RUN", "KOSONG"].includes(h.status) ? 0 : 3;
  }
} catch (e) {
  console.error(JSON.stringify({ status: "SINKRON_GAGAL", kode: String(e?.kode || e?.code || e?.name || "ERROR").slice(0, 40) }));
  process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
