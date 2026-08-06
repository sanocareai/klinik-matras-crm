import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { KNOWN_SESSIONS } from "../services/wahaClient.js";
// Batas hari WIB — WAJIB, jangan `setHours(0,0,0,0)` polos (lihat catatan
// panjang di utils/wib.js & CLAUDE.md §11).
import { startOfDayWIB, endOfDayExclusiveWIB, nowPartsWIB } from "../utils/wib.js";

export const dashboardRouter = express.Router();
dashboardRouter.use(requireAuth);

// 5 percakapan terbaru untuk widget "Percakapan terbaru" di Dashboard
dashboardRouter.get("/recent-conversations", async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 5,
  });
  res.json(conversations);
});

// Awal periode "today"/"week"/"month" menurut kalender WIB — dipakai widget
// "Distribusi Chat CS-1 vs CS-2".
//
// BUG YANG DIPERBAIKI (6 Agustus 2026): versi lama pakai `new Date()` +
// `setHours(0,0,0,0)` / `new Date(y, m, 1)` — itu waktu SERVER, dan container
// backend jalan di UTC (diverifikasi: `date` → UTC, getTimezoneOffset() → 0).
// Jadi "hari ini" mulai jam 00:00 UTC = 07:00 WIB, dan SEMUA lead yang masuk
// jam 00:00-07:00 WIB terhitung di HARI SEBELUMNYA. Di data produksi itu
// 166 lead (~8,5% dari total) salah bucket. Ini kelas bug yang sama persis
// dengan yang sudah pernah diperbaiki di routes/analytics.js — sekarang
// dipakaikan helper WIB yang sama supaya tidak ada dua definisi "hari ini"
// yang bertentangan di satu aplikasi.
function sessionDistributionPeriodStart(period) {
  const { year, month, day } = nowPartsWIB();
  const hariIni = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (period === "week") {
    // 7 hari TERMASUK hari ini → mundur 6 hari dari awal hari ini (WIB).
    return new Date(startOfDayWIB(hariIni).getTime() - 6 * 86_400_000);
  }
  if (period === "month") {
    return startOfDayWIB(`${year}-${String(month).padStart(2, "0")}-01`);
  }
  return startOfDayWIB(hariIni);
}

// Widget "Distribusi Chat CS-1 vs CS-2" — READ ONLY, tidak menyentuh logic
// pembuatan/update Customer atau Conversation manapun.
// newLeads: Customer baru (createdAt dalam periode) dikelompokkan lewat
// sessionId dari Conversation individual PERTAMA milik customer itu (bukan
// field langsung di Customer, lihat schema.prisma).
// totalActive: snapshot jumlah Conversation type=INDIVIDUAL per sessionId,
// tanpa filter tanggal.
dashboardRouter.get("/session-distribution", async (req, res) => {
  const period = ["today", "week", "month"].includes(req.query.period) ? req.query.period : "today";
  const start = sessionDistributionPeriodStart(period);

  const [newCustomers, activeGroups] = await Promise.all([
    prisma.customer.findMany({
      where: { createdAt: { gte: start } },
      select: {
        conversations: {
          where: { type: "INDIVIDUAL" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { sessionId: true },
        },
      },
    }),
    prisma.conversation.groupBy({
      by: ["sessionId"],
      where: { type: "INDIVIDUAL" },
      _count: { _all: true },
    }),
  ]);

  const newLeadsBySession = {};
  for (const c of newCustomers) {
    const sessionId = c.conversations[0]?.sessionId;
    if (!sessionId) continue;
    newLeadsBySession[sessionId] = (newLeadsBySession[sessionId] || 0) + 1;
  }

  const totalActiveBySession = {};
  for (const g of activeGroups) {
    if (!g.sessionId) continue;
    totalActiveBySession[g.sessionId] = g._count._all;
  }

  const result = KNOWN_SESSIONS.map((session) => ({
    session,
    newLeads: newLeadsBySession[session] || 0,
    totalActive: totalActiveBySession[session] || 0,
  }));

  res.json(result);
});

// Drill-down widget "Distribusi Lead per Sesi" — daftar lead 1 tanggal
// tertentu, klik dari card newLeads (session-distribution) atau card
// "Total Lead" existing. READ ONLY, sessionId sama seperti di atas
// (dari Conversation individual pertama milik customer).
dashboardRouter.get("/leads-detail", async (req, res) => {
  // Batas hari WIB — sama seperti session-distribution di atas.
  // `new Date("2026-08-06T00:00:00")` (tanpa sufiks Z) di Node diparse
  // sebagai waktu LOKAL = UTC di container, jadi drill-down "lead tanggal X"
  // dulu menampilkan jendela 07:00 WIB hari X sampai 07:00 WIB hari X+1.
  const dateParam = req.query.date;
  const { year, month, day } = nowPartsWIB();
  const tanggal = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? dateParam
    : `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const start = startOfDayWIB(tanggal);
  const end = endOfDayExclusiveWIB(tanggal);

  const sessionFilter = ["CS-1", "CS-2"].includes(req.query.session) ? req.query.session : "all";

  const customers = await prisma.customer.findMany({
    where: { createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      createdAt: true,
      conversations: {
        where: { type: "INDIVIDUAL" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, sessionId: true },
      },
    },
  });

  const result = customers
    .map((c) => {
      const firstConv = c.conversations[0] || null;
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        createdAt: c.createdAt,
        sessionId: firstConv?.sessionId || null,
        conversationId: firstConv?.id || null,
      };
    })
    .filter((c) => sessionFilter === "all" || c.sessionId === sessionFilter);

  res.json(result);
});
