import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { prisma } from "../db.js";
import { getSessionStatus, fetchChatHistory } from "../services/wahaClient.js";
import { parseHistoryMessage } from "../utils/parseHistoryMessage.js";
import { getJob, isJobRunning, startJob } from "../services/syncHistoryJob.js";
import { emitSyncProgress, emitSyncDone } from "../socket.js";

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

// POST /api/settings/sync-history — pull riwayat chat dari WAHA ke CRM (admin only)
// Body (opsional): { phone: "628xxx" } → sync 1 customer; kosong → sync semua customer ber-phone
// Idempotent: pesan yang sudah ada di DB di-skip via externalId @unique
// Paginasi penuh + parsing semua tipe pesan lewat parseHistoryMessage — lihat
// backend/src/utils/parseHistoryMessage.js untuk detail (fix bubble kosong).
//
// BACKGROUND JOB (fix UX timeout) — endpoint ini SEBELUMNYA menahan request
// HTTP sampai SELURUH sync selesai (bisa berapa menit utk ratusan chat),
// sehingga frontend abort di 30 detik dan tampilkan "Gagal: Koneksi timeout"
// padahal sync-nya sendiri terus jalan sukses di belakang layar. Sekarang:
// validasi → startJob (TIDAK di-await) → langsung return 202. Progress bisa
// dipantau lewat GET /sync-history/status (polling) atau socket
// sync:progress/sync:done.
settingsRouter.post("/sync-history", requireAdmin, async (req, res) => {
  if (isJobRunning()) {
    return res.status(409).json({ error: "Sinkronisasi sedang berjalan", job: getJob() });
  }

  const { phone } = req.body || {};

  const job = startJob(async (job) => {
    const customers = await prisma.customer.findMany({
      where: phone ? { phone } : { phone: { not: null } },
      select: { id: true, phone: true, name: true },
    });
    job.progress.totalChats = customers.length;

    for (const customer of customers) {
      job.progress.currentChat = customer.name || customer.phone;

      try {
        // Cari conversation WA yang ada (dan sessionId-nya kalau ada), atau
        // buat baru (status RESOLVED karena ini history, bukan chat aktif).
        let convo = await prisma.conversation.findFirst({
          where: { customerId: customer.id, channel: "WHATSAPP" },
          orderBy: { createdAt: "desc" },
        });

        const messages = await fetchChatHistory(customer.phone, convo?.sessionId || undefined, { maxMessages: 1000 });
        job.progress.processedChats++;

        if (messages.length) {
          if (!convo) {
            convo = await prisma.conversation.create({
              data: { customerId: customer.id, channel: "WHATSAPP", status: "RESOLVED" },
            });
          }

          for (const msg of messages) {
            const parsed = parseHistoryMessage(msg);
            if (!parsed.externalId) continue;
            if (parsed.isStatus) { console.log("[sync-history] drop status/broadcast dari", customer.phone); continue; }

            // Skip kalau sudah ada (idempotent)
            const exists = await prisma.message.findUnique({ where: { externalId: parsed.externalId } });
            if (exists) continue;

            if (parsed.unsupported) {
              job.progress.unsupportedMessages++;
              console.warn("[sync-history] Tipe pesan tidak dikenali:", parsed.rawType, "externalId:", parsed.externalId);
            }

            await prisma.message.create({
              data: {
                conversationId: convo.id,
                direction:      parsed.direction,
                content:        parsed.content,
                mediaType:      parsed.mediaType,
                mediaUrl:       parsed.mediaUrl,
                externalId:     parsed.externalId,
                createdAt:      parsed.createdAt,
              },
            });
            job.progress.newMessages++;
          }
        }
      } catch (e) {
        console.error("[sync-history] Error untuk customer", customer.phone, e.message);
        job.progress.failedChats++;
      }

      // Emit progress tiap ~10 chat (bukan tiap chat — hindari spam socket
      // untuk sync ratusan chat) + selalu emit di chat terakhir.
      if (job.progress.processedChats % 10 === 0 || job.progress.processedChats === job.progress.totalChats) {
        emitSyncProgress(job);
      }
    }
  }, {
    onDone: (job) => emitSyncDone(job),
    onError: (job) => emitSyncDone(job),
  });

  res.status(202).json({ jobId: job.jobId, status: job.status });
});

// GET /api/settings/sync-history/status — polling fallback (kalau socket
// putus/tidak tersedia) dan dipakai saat mount halaman utk cek job yang
// mungkin masih berjalan dari sebelum refresh.
settingsRouter.get("/sync-history/status", requireAdmin, (req, res) => {
  const job = getJob();
  if (!job) return res.json({ status: "idle" });
  res.json(job);
});

// GET /api/settings/whatsapp-status?session=CS-1 — cek koneksi WAHA live.
// ?session opsional (default WAHA_SESSION) — dipakai Pengaturan untuk cek
// CS-1/CS-2 terpisah (multi-session WAHA, lihat CLAUDE.md).
settingsRouter.get("/whatsapp-status", async (req, res) => {
  try {
    const data = await getSessionStatus(req.query.session || undefined);
    // WAHA mengembalikan { status: "WORKING"|"SCAN_QR_CODE"|"STOPPED", ... }
    res.json({ status: data.status || "UNKNOWN", me: data.me, connected: data.status === "WORKING" });
  } catch (err) {
    res.json({ status: "ERROR", connected: false, error: err.message });
  }
});
