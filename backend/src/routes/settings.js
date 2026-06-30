import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth } from "../middleware/auth.js";
import { getSessionStatus } from "../services/wahaClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../../data/settings.json");

export const settingsRouter = express.Router();
settingsRouter.use(requireAuth);

function readSettings() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); }
  catch { return {}; }
}
function writeSettings(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET /api/settings — ambil semua pengaturan
settingsRouter.get("/", (req, res) => {
  res.json(readSettings());
});

// PATCH /api/settings — update pengaturan (admin only)
settingsRouter.patch("/", (req, res) => {
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Hanya Admin" });
  const current = readSettings();
  const updated = { ...current, ...req.body };
  writeSettings(updated);
  res.json(updated);
});

// GET /api/settings/whatsapp-status — cek koneksi WAHA live
settingsRouter.get("/whatsapp-status", async (req, res) => {
  try {
    const data = await getSessionStatus();
    // WAHA mengembalikan { status: "WORKING"|"SCAN_QR_CODE"|"STOPPED", ... }
    res.json({ status: data.status || "UNKNOWN", me: data.me, connected: data.status === "WORKING" });
  } catch (err) {
    res.json({ status: "ERROR", connected: false, error: err.message });
  }
});
