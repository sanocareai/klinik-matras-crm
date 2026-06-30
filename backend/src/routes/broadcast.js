import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../../data/campaigns.json");

export const broadcastRouter = express.Router();
broadcastRouter.use(requireAuth);

function readCampaigns() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return []; }
}
function writeCampaigns(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// In-memory queue per proses server
const sendQueue = [];
let queueRunning = false;

function startQueueProcessor() {
  if (queueRunning) return;
  queueRunning = true;
  setInterval(async () => {
    if (sendQueue.length === 0) return;
    const item = sendQueue.shift();
    try {
      const wahaUrl = process.env.WAHA_URL || "http://localhost:3000";
      const wahaSession = process.env.WAHA_SESSION || "default";
      await fetch(`${wahaUrl}/api/sendText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: wahaSession,
          chatId: item.phone + "@c.us",
          text: item.message,
        }),
      });

      // Update progress di campaigns.json
      const campaigns = readCampaigns();
      const c = campaigns.find((x) => x.id === item.campaignId);
      if (c) {
        if (!c.sentCount) c.sentCount = 0;
        c.sentCount++;
        if (c.sentCount >= c.totalTargets) c.status = "SELESAI";
        writeCampaigns(campaigns);
      }
    } catch (err) {
      console.error("Broadcast queue error:", err.message);
    }
  }, 1000); // cek queue setiap 1 detik
}

startQueueProcessor();

// GET /api/broadcast/campaigns
broadcastRouter.get("/campaigns", (req, res) => {
  res.json(readCampaigns());
});

// POST /api/broadcast/campaigns
broadcastRouter.post("/campaigns", (req, res) => {
  const { name, message, filters, schedule, randomDelay } = req.body;
  if (!name || !message) return res.status(400).json({ error: "Nama dan pesan wajib diisi" });

  const campaigns = readCampaigns();
  const campaign = {
    id: Date.now().toString(),
    name,
    message,
    filters: filters || {},
    schedule: schedule || null,
    randomDelay: randomDelay !== false,
    status: "DRAFT",
    sentCount: 0,
    totalTargets: 0,
    createdAt: new Date().toISOString(),
    createdById: req.user.id,
  };
  campaigns.push(campaign);
  writeCampaigns(campaigns);
  res.status(201).json(campaign);
});

// PATCH /api/broadcast/campaigns/:id
broadcastRouter.patch("/campaigns/:id", (req, res) => {
  const campaigns = readCampaigns();
  const idx = campaigns.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Kampanye tidak ditemukan" });
  Object.assign(campaigns[idx], req.body, { id: campaigns[idx].id });
  writeCampaigns(campaigns);
  res.json(campaigns[idx]);
});

// DELETE /api/broadcast/campaigns/:id
broadcastRouter.delete("/campaigns/:id", (req, res) => {
  const campaigns = readCampaigns();
  const filtered = campaigns.filter((c) => c.id !== req.params.id);
  if (filtered.length === campaigns.length) return res.status(404).json({ error: "Tidak ditemukan" });
  writeCampaigns(filtered);
  res.json({ ok: true });
});

// GET /api/broadcast/estimate — estimasi jumlah target berdasarkan filter
broadcastRouter.get("/estimate", async (req, res) => {
  try {
    const { stage, source, tags, minOrderValue } = req.query;
    const where = {};
    if (stage)  where.pipelineStage = stage;
    if (source) where.leadSource    = source;
    if (minOrderValue) {
      where.orders = { some: { value: { gte: Number(minOrderValue) }, status: { not: "CANCELLED" } } };
    }
    where.phone = { not: null }; // harus punya nomor WA

    const count = await prisma.customer.count({ where });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/broadcast/health-check — cek rasio outbound:inbound 7 hari terakhir
broadcastRouter.get("/health-check", async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 86400000);
    const [outbound, inbound] = await Promise.all([
      prisma.message.count({ where: { direction: "OUTBOUND", createdAt: { gte: since } } }),
      prisma.message.count({ where: { direction: "INBOUND",  createdAt: { gte: since } } }),
    ]);

    const ratio = inbound > 0 ? outbound / inbound : outbound;
    const safe  = ratio <= 2;

    res.json({ outbound, inbound, ratio: Math.round(ratio * 100) / 100, safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/broadcast/campaigns/:id/send — tambahkan target ke queue
broadcastRouter.post("/campaigns/:id/send", async (req, res) => {
  try {
    const campaigns = readCampaigns();
    const campaign = campaigns.find((c) => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: "Kampanye tidak ditemukan" });

    const where = { phone: { not: null }, ...campaign.filters };
    const targets = await prisma.customer.findMany({ where, select: { id: true, phone: true, name: true } });

    campaign.totalTargets = targets.length;
    campaign.status       = "BERJALAN";
    campaign.sentCount    = 0;
    writeCampaigns(campaigns);

    // Tambah ke queue dengan random delay
    targets.forEach((t, i) => {
      const baseDelay = campaign.randomDelay ? (Math.floor(Math.random() * 12) + 3) * 1000 : 5000;
      const msg = campaign.message.replace(/\{\{nama\}\}/gi, t.name || "");
      setTimeout(() => {
        sendQueue.push({ campaignId: campaign.id, phone: t.phone, message: msg });
      }, i * baseDelay);
    });

    res.json({ queued: targets.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/broadcast/campaigns/:id/test — test kirim ke 3 nomor
broadcastRouter.post("/campaigns/:id/test", async (req, res) => {
  try {
    const campaigns = readCampaigns();
    const campaign  = campaigns.find((c) => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: "Kampanye tidak ditemukan" });

    const targets = await prisma.customer.findMany({
      where: { phone: { not: null } },
      take: 3,
      select: { phone: true, name: true },
    });

    targets.forEach((t) => {
      const msg = campaign.message.replace(/\{\{nama\}\}/gi, t.name || "");
      sendQueue.push({ campaignId: campaign.id, phone: t.phone, message: msg });
    });

    res.json({ sent: targets.length, targets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
