import express from "express";
import { sendText } from "../services/wahaClient.js";

export const internalRouter = express.Router();

const ADMIN_PHONE = process.env.BACKUP_NOTIFY_PHONE;

// POST /api/internal/backup-alert
// Dipanggil oleh trap ERR di backup-database.sh kalau backup gagal.
// Tidak pakai JWT auth — endpoint ini hanya boleh dipanggil dari VPS itu sendiri (cron/bash script).
// Guard keamanan ganda:
//   1. req.ip harus localhost (blok panggilan langsung dari internet ke port 4000)
//   2. X-Forwarded-For harus tidak ada (blok panggilan dari luar via Nginx)
internalRouter.post("/backup-alert", async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || "";
  const isLocalhost =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const isForwarded = !!req.headers["x-forwarded-for"];

  if (!isLocalhost || isForwarded) {
    return res.status(403).json({ error: "Forbidden" });
  }

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
    await sendText(ADMIN_PHONE, pesan);
    console.log("[Backup Alert] Notifikasi WA terkirim ke", ADMIN_PHONE);
  } catch (err) {
    console.error("[Backup Alert] Gagal kirim WA:", err.message);
  }
});
