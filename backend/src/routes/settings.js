import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { prisma } from "../db.js";
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

// GET /api/settings/sales-targets?year=&month=
// Kembalikan semua sales + target mereka di bulan itu (0 kalau belum diset)
settingsRouter.get("/sales-targets", requireAdmin, async (req, res) => {
  const year  = Number(req.query.year  || new Date().getFullYear());
  const month = Number(req.query.month || new Date().getMonth() + 1);

  try {
    const salesUsers = await prisma.user.findMany({
      where: { role: "SALES" },
      orderBy: { name: "asc" },
    });

    const targets = await prisma.salesTarget.findMany({
      where: { year, month },
    });
    const targetMap = Object.fromEntries(targets.map((t) => [t.userId, t]));

    const result = salesUsers.map((u) => ({
      userId:      u.id,
      name:        u.name,
      email:       u.email,
      year,
      month,
      targetValue: targetMap[u.id]?.targetValue ?? 0,
      targetId:    targetMap[u.id]?.id ?? null,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/sales-targets — upsert target bulanan satu sales
// Body: { userId, year, month, targetValue }
settingsRouter.put("/sales-targets", requireAdmin, async (req, res) => {
  const { userId, year, month, targetValue } = req.body;
  if (!userId || !year || !month || targetValue === undefined) {
    return res.status(400).json({ error: "userId, year, month, targetValue wajib diisi" });
  }

  try {
    const target = await prisma.salesTarget.upsert({
      where: { userId_year_month: { userId, year: Number(year), month: Number(month) } },
      create: { userId, year: Number(year), month: Number(month), targetValue: Number(targetValue) },
      update: { targetValue: Number(targetValue) },
    });
    res.json(target);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
