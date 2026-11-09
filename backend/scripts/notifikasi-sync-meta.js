// Kirim WA kegagalan sinkron Meta lewat WAHA. Dipanggil oleh scripts/sync-meta-composio-cron.sh; keluaran sinkron dibaca dari stdin.
//   node scripts/notifikasi-sync-meta.js --tahap=commit --rc=2
// Tujuan hanya dari SYNC_META_ALERT_PHONE. Kode keluar: 0 terkirim | 4 gagal atau tujuan kosong.
import { susunPesanGagal } from "../src/services/attribution/composioMetaNotif.js";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? "-";
let keluaran = "";
for await (const c of process.stdin) keluaran += c;
try {
  const tujuan = process.env.SYNC_META_ALERT_PHONE;
  if (!tujuan) throw new Error("TUJUAN_KOSONG");
  const { sendText, getDefaultOpsSession } = await import("../src/services/wahaClient.js");
  const p = susunPesanGagal({ tahap: arg("tahap"), rc: arg("rc"), keluaran, waktu: new Date().toISOString() });
  await sendText(tujuan, `${p.subject}\n\n${p.text}`.slice(0, 1500), null, getDefaultOpsSession());
  console.log(JSON.stringify({ notifikasi: "TERKIRIM" }));
} catch {
  console.error(JSON.stringify({ notifikasi: "GAGAL" }));
  process.exitCode = 4;
}
process.exit();
