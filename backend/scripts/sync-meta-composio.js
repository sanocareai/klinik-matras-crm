// Sinkronisasi Meta lewat Composio. HANYA BACA dari Meta; tidak pernah mengubah campaign/ad set/ad/budget. BAWAAN MATI (COMPOSIO_META_SYNC_ENABLED).
//   node scripts/sync-meta-composio.js --cek                                  konfigurasi + akun (tanpa tulis)
//   node scripts/sync-meta-composio.js --dry    [--dari=YYYY-MM-DD --sampai=YYYY-MM-DD]   tarik + rencana; hanya mencatat run
//   node scripts/sync-meta-composio.js --commit [--dari --sampai]              tulis (wajib flag ON)
//   Commit dan dry-run juga mengambil hierarki resmi Ad ber-touch tanpa referensi (termasuk Ad tanpa spend); konflik tidak ditimpa.
//   node scripts/sync-meta-composio.js --verify [--dari --sampai]              DB (terpilih) vs kontrol akun sekarang
// Tanpa --dari/--sampai: rolling 7 hari penuh sampai kemarin WIB. Keluaran JSON agregat; nilai kredensial tidak pernah dicetak.
// Kode keluar: 0 sukses/terverifikasi | 3 tidak siap, sedang berjalan, atau belum direkonsiliasi | 2 gagal.
import { prisma } from "../src/db.js";
import { jalankanSinkronComposio } from "../src/services/attribution/composioMetaSync.js";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? null;
const mode = ["cek", "dry", "commit", "verify"].find((m) => process.argv.includes(`--${m}`)) ?? "cek";
try {
  const h = await jalankanSinkronComposio(prisma, { mode, dari: arg("dari"), sampai: arg("sampai") });
  console.log(JSON.stringify(h, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  process.exitCode = ["SIAP", "SUKSES", "DRY_RUN", "TERVERIFIKASI"].includes(h.status) ? 0 : h.status === "GAGAL" ? 2 : 3;
} catch (e) {
  console.error(JSON.stringify({ status: "SINKRON_GAGAL", kode: String(e?.kode || e?.code || e?.name || "ERROR").slice(0, 40) }));
  process.exitCode = 2;
} finally { await prisma.$disconnect(); }
