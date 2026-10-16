// Pemeriksaan monitoring atribusi Meta Ads untuk CRON. AGREGAT SAJA — tidak mencetak nomor, nama, chat, JID, clid mentah, payload, atau data kesehatan.
//
//   docker exec klinik-matras-backend-1 node scripts/atribusi-monitor.js            # periksa, catat state, log alarm
//   docker exec klinik-matras-backend-1 node scripts/atribusi-monitor.js --dry      # periksa saja (tanpa menulis state/log)
//
// Kode keluar: 0 SEHAT | 1 PERINGATAN | 2 KRITIS (juga bila pemeriksaan sendiri gagal: monitoring buta = kritis).
// Cara kerja: memanggil GET /api/atribusi/iklan/monitor di backend yang SEDANG berjalan (agar penghitung proses touch terbaca) memakai token ADMIN berumur 2 menit
// yang ditandatangani lokal (tidak dicetak, tidak disimpan). Lalu menerapkan cooldown + pemberitahuan PULIH dan menulis log JSON-lines agregat ke
// $ATRIBUSI_MONITOR_LOG (bawaan /app/data/atribusi-monitor.log, dirotasi di 2 MiB). WA hanya bila ATRIBUSI_ALERT_NOTIFY_PHONE diisi eksplisit (bawaan: TIDAK ada).
import fs from "fs";
import jwt from "jsonwebtoken";
import { prisma } from "../src/db.js";
import { rencanaNotifikasi, CFG_BAWAAN } from "../src/services/attribution/monitor.js";

const DRY = process.argv.includes("--dry");
const LOG = process.env.ATRIBUSI_MONITOR_LOG || "/app/data/atribusi-monitor.log";
const PORT = process.env.PORT || 4000;
const cooldownMenit = Number(process.env.ATRIBUSI_ALERT_COOLDOWN_MIN) > 0 ? Number(process.env.ATRIBUSI_ALERT_COOLDOWN_MIN) : CFG_BAWAAN.cooldownMenit;
const cfg = { ...CFG_BAWAAN, cooldownMenit };

function tulisLog(obj) {
  if (DRY) return;
  try {
    try { if (fs.statSync(LOG).size > 2 * 1024 * 1024) fs.renameSync(LOG, `${LOG}.1`); } catch { /* belum ada */ }
    fs.appendFileSync(LOG, JSON.stringify(obj) + "\n");
  } catch { /* log gagal tidak boleh menggagalkan pemeriksaan */ }
}

async function main() {
  const now = new Date();
  const admin = await prisma.user.findFirst({ where: { active: true, role: "ADMIN" }, select: { id: true, name: true, role: true } });
  if (!admin) throw new Error("TIDAK_ADA_ADMIN_AKTIF");
  const token = jwt.sign({ id: admin.id, name: admin.name, role: admin.role, roles: [admin.role] }, process.env.JWT_SECRET, { expiresIn: "2m" });
  const r = await fetch(`http://127.0.0.1:${PORT}/api/atribusi/iklan/monitor`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`MONITOR_HTTP_${r.status}`);
  const j = await r.json();

  const lama = await prisma.attributionAlertState.findMany();
  const state = new Map(lama.map((x) => [x.key, { status: x.status, since: x.since, lastNotifiedAt: x.lastNotifiedAt }]));
  const { notifikasi, stateBaru } = rencanaNotifikasi(j.alarm, state, now, cfg);

  if (!DRY) {
    for (const [key, v] of stateBaru) {
      await prisma.attributionAlertState.upsert({
        where: { key },
        create: { key, status: v.status, since: v.since, lastNotifiedAt: v.lastNotifiedAt, detail: String(v.detail ?? "").slice(0, 200), updatedAt: now },
        update: { status: v.status, since: v.since, lastNotifiedAt: v.lastNotifiedAt, detail: String(v.detail ?? "").slice(0, 200), updatedAt: now },
      });
    }
  }
  for (const n of notifikasi) tulisLog({ at: now.toISOString(), jenis: n.jenis, key: n.key, level: n.level, pesan: n.pesan });
  tulisLog({ at: now.toISOString(), jenis: "RINGKASAN", status: j.status, bermasalah: j.alarm.filter((x) => x.level !== "OK").map((x) => `${x.key}:${x.level}`) });

  // WA opsional — hanya tujuan yang DIISI EKSPLISIT untuk alarm atribusi (tidak memakai nomor lain).
  const tujuan = process.env.ATRIBUSI_ALERT_NOTIFY_PHONE;
  if (tujuan && notifikasi.length && !DRY) {
    try {
      const { sendText, getDefaultOpsSession } = await import("../src/services/wahaClient.js");
      const teks = notifikasi.map((n) => `[Atribusi ${n.jenis}] ${n.key}: ${n.pesan}`).join("\n").slice(0, 1500);
      await sendText(tujuan, teks, null, getDefaultOpsSession());
    } catch { tulisLog({ at: now.toISOString(), jenis: "NOTIFIKASI_WA_GAGAL" }); }
  }

  console.log(JSON.stringify({ status: j.status, kodeKeluar: j.kodeKeluar, notifikasi: notifikasi.map((n) => `${n.jenis} ${n.key} ${n.level}`), bermasalah: j.alarm.filter((x) => x.level !== "OK").map((x) => ({ key: x.key, level: x.level, pesan: x.pesan })), waNotifikasi: tujuan ? "AKTIF" : "TIDAK_ADA_TUJUAN (log saja)", dry: DRY }));
  return j.kodeKeluar;
}

main().then(async (kode) => { await prisma.$disconnect(); process.exit(kode); }).catch(async (e) => {
  console.error(JSON.stringify({ status: "MONITOR_ERROR", kode: String(e?.message || e?.code || "ERROR").slice(0, 60) }));
  tulisLog({ at: new Date().toISOString(), jenis: "MONITOR_ERROR", kode: String(e?.message || "ERROR").slice(0, 60) });
  try { await prisma.$disconnect(); } catch { /* abaikan */ }
  process.exit(2);
});
