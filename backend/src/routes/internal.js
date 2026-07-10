import fs from "fs";
import express from "express";
import { sendText, getDefaultOpsSession } from "../services/wahaClient.js";
import { sendEmailAlert } from "../services/emailAlert.js";

export const internalRouter = express.Router();

const ADMIN_PHONE = process.env.BACKUP_NOTIFY_PHONE;
const WAHA_LOG = "/home/ubuntu/klinik-matras/backups/waha-monitor.log";

// Guard yang sama untuk semua endpoint internal:
// - req.ip harus localhost (blok panggilan langsung ke port 4000 dari internet)
// - X-Forwarded-For tidak boleh ada (blok panggilan dari luar via Nginx)
function checkLocalhost(req, res) {
  const ip = req.ip || req.socket?.remoteAddress || "";
  const isLocalhost =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const isForwarded = !!req.headers["x-forwarded-for"];
  if (!isLocalhost || isForwarded) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// POST /api/internal/backup-alert
// Dipanggil oleh trap ERR di backup-database.sh kalau backup gagal.
internalRouter.post("/backup-alert", async (req, res) => {
  if (!checkLocalhost(req, res)) return;

  res.json({ ok: true }); // jawab dulu, notifikasi WA jalan di background

  if (!ADMIN_PHONE) {
    console.error(
      "[Backup Alert] BACKUP_NOTIFY_PHONE belum diisi di .env — skip notifikasi WA"
    );
    return;
  }

  const { timestamp, file } = req.body || {};
  const pesan = [
    "⚠️ *BACKUP DATABASE GAGAL*",
    "",
    `Waktu: ${timestamp || new Date().toLocaleString("id-ID")}`,
    `File : ${file || "-"}`,
    "",
    "Segera cek VPS dan jalankan backup manual:",
    "  cd ~/klinik-matras",
    "  ./backend/scripts/backup-database.sh",
    "",
    "Log lengkap: ~/klinik-matras/backups/backup.log",
  ].join("\n");

  try {
    await sendText(ADMIN_PHONE, pesan, null, getDefaultOpsSession());
    console.log("[Backup Alert] Notifikasi WA terkirim ke", ADMIN_PHONE);
  } catch (err) {
    console.error("[Backup Alert] Gagal kirim WA:", err.message);
  }
});

// POST /api/internal/waha-alert
// Dipanggil oleh check-waha-status.sh kalau WAHA session tidak WORKING.
// Coba kirim WA dulu. Kalau WAHA sendiri yang mati, fallback ke email.
internalRouter.post("/waha-alert", async (req, res) => {
  if (!checkLocalhost(req, res)) return;

  res.json({ ok: true });

  const { status } = req.body || {};
  const statusDisplay = status || "TIDAK DIKETAHUI";
  const waktu = new Date().toLocaleString("id-ID");

  // Selalu tulis ke log file (bisa dicek manual)
  try {
    fs.appendFileSync(
      WAHA_LOG,
      `${new Date().toISOString()} — WAHA alert diterima backend, status: ${statusDisplay}\n`
    );
  } catch (_) {
    // Log path belum ada di dev environment, lewati
  }

  const pesan = [
    "⚠️ *WAHA WhatsApp Terputus!*",
    "",
    `Status  : ${statusDisplay}`,
    `Waktu   : ${waktu}`,
    "",
    "Buka dashboard WAHA dan scan ulang QR jika perlu:",
    "  http://43.133.152.6:3000/dashboard",
    "  Login: admin / klinikmatras123",
    "",
    "Atau restart WAHA: docker compose restart waha",
  ].join("\n");

  // Coba kirim via WhatsApp dulu
  let waSent = false;
  if (ADMIN_PHONE) {
    try {
      await sendText(ADMIN_PHONE, pesan, null, getDefaultOpsSession());
      waSent = true;
      console.log("[WAHA Alert] Notifikasi WA terkirim ke", ADMIN_PHONE);
    } catch (err) {
      // WAHA memang sedang down, ini expected — jangan panic di console
      console.warn("[WAHA Alert] Gagal kirim WA (WAHA mungkin down):", err.message);
    }
  }

  // Fallback: kirim email kalau WA gagal
  if (!waSent) {
    try {
      await sendEmailAlert({
        subject: `⚠️ WAHA Terputus — Klinik Matras CRM (${statusDisplay})`,
        text: pesan,
      });
      console.log("[WAHA Alert] Fallback email terkirim");
    } catch (err) {
      if (err.message.startsWith("SMTP belum dikonfigurasi")) {
        console.warn("[WAHA Alert] Email fallback tidak dikonfigurasi. Status:", statusDisplay);
        console.warn("[WAHA Alert] Cek log manual: " + WAHA_LOG);
      } else {
        console.error("[WAHA Alert] Gagal kirim email juga:", err.message);
      }
    }
  }
});
