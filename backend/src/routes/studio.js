// ─── AI STUDIO — API /api/studio (MVP 1) ────────────────────────────────────
// Workspace terpisah untuk melatih & menguji agent (Mattress Consultant).
// MVP 1: Playground (sesi simulasi), koreksi sales, antrean tinjauan
// Owner/Admin → test case. TIDAK ada jalur kirim ke customer sungguhan.
//
// Akses: ADMIN / OWNER / SALES. Tinjauan koreksi: ADMIN / OWNER.
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { rolesOf } from "../middleware/authorize.js";
import { chat as anthropicChat } from "../services/providers/anthropicProvider.js";
import { getAnthropicKey } from "../services/replyAssistant/providers/keyStore.js";
import { readSkillFolder, skillBerubah, dariFolderBawaan, SINKRON_PREFIX } from "../services/agentStudio/skillLoader.js";
import { runTurn, MODELS } from "../services/agentStudio/runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.join(__dirname, "../services/agentStudio/skill-bawaan");

export const studioRouter = express.Router();
studioRouter.use(requireAuth);

const PERAN_STUDIO = ["ADMIN", "OWNER", "SALES"];
const PERAN_PENINJAU = ["ADMIN", "OWNER"];
const ALASAN_KOREKSI = [
  "INFO_SALAH", "HARGA_TERLALU_CEPAT_LAMBAT", "TERLALU_PANJANG", "NADA_KURANG_HANGAT",
  "PERTANYAAN_KURANG_TEPAT", "REKOMENDASI_TIDAK_SESUAI", "LUPA_KIRIM_KATALOG", "HARUS_HANDOVER", "LAINNYA",
];

function boleh(peran) {
  return (req, res, next) => {
    if (!rolesOf(req.user).some((r) => peran.includes(r))) return res.status(403).json({ error: "Tidak punya akses ke AI Studio" });
    next();
  };
}
studioRouter.use(boleh(PERAN_STUDIO));

// Agent bawaan — ditanam otomatis saat AI Studio pertama kali dibuka.
const AGENT_BAWAAN = {
  slug: "mattress-consultant",
  name: "Mattress Consultant",
  description: "Konsultan kasur sehat Klinik Matras — diagnosa, edukasi, rekomendasi, handover ke sales.",
  folder: "sano-mattress-consultant",
};

// Skill bawaan ikut kode (folder skill-bawaan). Saat rilis membawa isi folder
// baru, versi live di DB ikut diperbarui SEKALI per proses: versi baru LIVE
// (N+1), versi lama ARCHIVED. Hanya bila versi live memang berasal dari
// folder (bukan suntingan manual — editor skill baru ada di MVP 3).
let sinkronSelesai = false;
async function sinkronSkillBawaan(agent, userId) {
  if (sinkronSelesai) return;
  sinkronSelesai = true;
  const live = await prisma.studioSkillVersion.findFirst({ where: { agentId: agent.id, status: "LIVE" }, orderBy: { versionNumber: "desc" } });
  if (!live || !dariFolderBawaan(live.changeNote)) return;
  const files = readSkillFolder(path.join(SKILL_ROOT, AGENT_BAWAAN.folder));
  if (!skillBerubah(files, live.files)) return;
  const terakhir = await prisma.studioSkillVersion.findFirst({ where: { agentId: agent.id }, orderBy: { versionNumber: "desc" }, select: { versionNumber: true } });
  try {
    await prisma.$transaction([
      prisma.studioSkillVersion.updateMany({ where: { agentId: agent.id, status: "LIVE" }, data: { status: "ARCHIVED" } }),
      prisma.studioSkillVersion.create({
        data: { agentId: agent.id, versionNumber: terakhir.versionNumber + 1, status: "LIVE", changeNote: `${SINKRON_PREFIX} (${new Date().toISOString().slice(0, 10)})`, files, createdById: userId },
      }),
    ]);
  } catch (err) {
    // P2002 = proses lain sudah membuat versi yang sama. Error lain: jangan gagalkan
    // permintaan — playground tetap jalan dengan versi live lama.
    if (err?.code !== "P2002") console.error("[studio] sinkron skill bawaan gagal:", err?.message);
  }
}

async function pastikanAgentBawaan(userId) {
  const ada = await prisma.studioAgent.findUnique({ where: { slug: AGENT_BAWAAN.slug } });
  if (ada) {
    await sinkronSkillBawaan(ada, userId);
    return ada;
  }
  const files = readSkillFolder(path.join(SKILL_ROOT, AGENT_BAWAAN.folder));
  return prisma.studioAgent.create({
    data: {
      slug: AGENT_BAWAAN.slug,
      name: AGENT_BAWAAN.name,
      description: AGENT_BAWAAN.description,
      versions: { create: { versionNumber: 1, status: "LIVE", changeNote: "Versi awal dari skill sano-mattress-consultant (Nov 2026)", files, createdById: userId } },
    },
  });
}

function kunciAnthropic() {
  const env = process.env.STUDIO_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (env?.trim()) return env.trim();
  return getAnthropicKey()?.apiKey || null;
}

async function biayaBulanIni() {
  const awal = new Date();
  awal.setDate(1);
  awal.setHours(0, 0, 0, 0);
  const agg = await prisma.studioMessage.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: awal } } });
  return agg._sum.costUsd || 0;
}
const BATAS_BIAYA = () => Number(process.env.STUDIO_MAX_COST_USD_MONTH || 20);

// ── GET /agents — daftar agent + versi live ────────────────────────────────
studioRouter.get("/agents", async (req, res) => {
  try {
    await pastikanAgentBawaan(req.user.id);
    const agents = await prisma.studioAgent.findMany({
      orderBy: { createdAt: "asc" },
      include: { versions: { orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, status: true, changeNote: true, createdAt: true } } },
    });
    res.json({ agents, models: MODELS, biayaBulanIni: await biayaBulanIni(), batasBiaya: BATAS_BIAYA() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /summary — angka widget (minggu ini) ───────────────────────────────
studioRouter.get("/summary", async (req, res) => {
  try {
    const seminggu = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [koreksi, bagus, totalNilai, testCase, pelatih, menunggu] = await Promise.all([
      prisma.studioFeedback.count({ where: { createdAt: { gte: seminggu } } }),
      prisma.studioFeedback.count({ where: { createdAt: { gte: seminggu }, rating: "GOOD" } }),
      prisma.studioFeedback.count({ where: { createdAt: { gte: seminggu } } }),
      prisma.studioTestCase.count({ where: { active: true } }),
      prisma.studioFeedback.groupBy({ by: ["createdById"], where: { createdAt: { gte: seminggu } } }),
      prisma.studioFeedback.count({ where: { status: "NEW" } }),
    ]);
    res.json({
      koreksiMingguIni: koreksi,
      persenBagus: totalNilai ? Math.round((bagus / totalNilai) * 100) : null,
      testCaseAktif: testCase,
      pelatihAktif: pelatih.length,
      menungguTinjauan: menunggu,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /sessions — sesi milik sendiri (Admin/Owner: semua) ─────────────────
studioRouter.get("/sessions", async (req, res) => {
  try {
    const peninjau = rolesOf(req.user).some((r) => PERAN_PENINJAU.includes(r));
    const sessions = await prisma.studioSession.findMany({
      where: peninjau ? {} : { createdById: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { _count: { select: { messages: true } } },
    });
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /sessions — mulai simulasi ─────────────────────────────────────────
studioRouter.post("/sessions", async (req, res) => {
  try {
    const agent = await pastikanAgentBawaan(req.user.id);
    const { title, scenario, model } = req.body || {};
    const live = await prisma.studioSkillVersion.findFirst({ where: { agentId: agent.id, status: "LIVE" }, orderBy: { versionNumber: "desc" } });
    if (!live) return res.status(409).json({ error: "Agent belum punya versi live" });
    const session = await prisma.studioSession.create({
      data: {
        agentId: agent.id,
        skillVersionId: live.id,
        title: (title || "Simulasi baru").slice(0, 120),
        scenario: scenario || null,
        model: MODELS.includes(model) ? model : agent.defaultModel,
        createdById: req.user.id,
      },
    });
    res.status(201).json({ session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /sessions/:id — sesi + pesan + koreksi ──────────────────────────────
studioRouter.get("/sessions/:id", async (req, res) => {
  try {
    const session = await prisma.studioSession.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: "asc" }, include: { feedback: { orderBy: { createdAt: "desc" } } } } },
    });
    if (!session) return res.status(404).json({ error: "Sesi tidak ditemukan" });
    const peninjau = rolesOf(req.user).some((r) => PERAN_PENINJAU.includes(r));
    if (!peninjau && session.createdById !== req.user.id) return res.status(403).json({ error: "Bukan sesi Anda" });
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /sessions/:id/messages — pesan customer → balasan AI ───────────────
studioRouter.post("/sessions/:id/messages", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Pesan kosong" });
  if (text.length > 2000) return res.status(400).json({ error: "Pesan terlalu panjang (maks 2.000 karakter)" });
  try {
    const session = await prisma.studioSession.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!session) return res.status(404).json({ error: "Sesi tidak ditemukan" });
    if (session.createdById !== req.user.id) return res.status(403).json({ error: "Hanya pembuat sesi yang bisa mengirim pesan" });

    if ((await biayaBulanIni()) >= BATAS_BIAYA()) return res.status(429).json({ error: `Batas biaya AI Studio bulan ini ($${BATAS_BIAYA()}) sudah tercapai` });
    const apiKey = kunciAnthropic();
    if (!apiKey) return res.status(503).json({ error: "Kunci API Anthropic belum diatur (STUDIO_ANTHROPIC_API_KEY atau AI Playground)" });

    const [version, products] = await Promise.all([
      prisma.studioSkillVersion.findUnique({ where: { id: session.skillVersionId } }),
      prisma.product.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    ]);
    const model = req.body?.model && MODELS.includes(req.body.model) ? req.body.model : session.model || "claude-haiku-5-5";

    // Panggil model DULU; pesan customer & balasan baru disimpan berdua setelah
    // berhasil — kalau model gagal (saldo habis, timeout), riwayat sesi tidak
    // menyisakan pesan customer tanpa balasan.
    const hasil = await runTurn({
      skillFiles: version.files,
      products,
      history: session.messages,
      customerText: text,
      model,
      callModel: ({ model: m, systemPrompt, messages, maxTokens }) => anthropicChat({ apiKey, model: m, systemPrompt, messages, maxTokens }),
    });
    const [customerMsg, agentMsg] = await prisma.$transaction(async (tx) => {
      const c = await tx.studioMessage.create({ data: { sessionId: session.id, role: "CUSTOMER", content: { text } } });
      // +1 ms supaya urutan createdAt customer → agent selalu stabil.
      const a = await tx.studioMessage.create({
        data: {
          sessionId: session.id,
          role: "AGENT",
          content: hasil.output,
          model,
          inputTokens: hasil.usage.inputTokens || 0,
          outputTokens: hasil.usage.outputTokens || 0,
          cacheReadTokens: hasil.usage.cacheReadTokens || 0,
          costUsd: hasil.costUsd,
          createdAt: new Date(c.createdAt.getTime() + 1),
        },
      });
      return [c, a];
    });
    res.status(201).json({ customer: customerMsg, agent: { ...agentMsg, feedback: [] } });
  } catch (err) {
    res.status(502).json({ error: `Gagal mendapat balasan AI: ${err.message}` });
  }
});

// ── POST /messages/:id/feedback — koreksi sales ─────────────────────────────
studioRouter.post("/messages/:id/feedback", async (req, res) => {
  try {
    const msg = await prisma.studioMessage.findUnique({ where: { id: req.params.id } });
    if (!msg || msg.role !== "AGENT") return res.status(404).json({ error: "Balasan AI tidak ditemukan" });
    const { rating, idealReply, reasons, note } = req.body || {};
    if (!["GOOD", "BAD"].includes(rating)) return res.status(400).json({ error: "rating harus GOOD atau BAD" });
    if (rating === "BAD" && !String(idealReply || "").trim()) return res.status(400).json({ error: "Tulis balasan yang seharusnya" });
    const feedback = await prisma.studioFeedback.create({
      data: {
        messageId: msg.id,
        rating,
        idealReply: idealReply?.trim() || null,
        reasons: (Array.isArray(reasons) ? reasons : []).filter((r) => ALASAN_KOREKSI.includes(r)),
        note: note?.trim() || null,
        createdById: req.user.id,
      },
    });
    res.status(201).json({ feedback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /feedback — antrean tinjauan (Admin/Owner) ──────────────────────────
studioRouter.get("/feedback", boleh(PERAN_PENINJAU), async (req, res) => {
  try {
    const status = ["NEW", "ACCEPTED", "REJECTED"].includes(req.query.status) ? req.query.status : "NEW";
    const items = await prisma.studioFeedback.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { message: { include: { session: { select: { id: true, title: true } } } } },
    });
    const userIds = [...new Set(items.map((i) => i.createdById))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const nama = Object.fromEntries(users.map((u) => [u.id, u.name]));
    res.json({ items: items.map((i) => ({ ...i, createdByName: nama[i.createdById] || "—" })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /feedback/:id — terima (→ test case) / tolak ──────────────────────
studioRouter.patch("/feedback/:id", boleh(PERAN_PENINJAU), async (req, res) => {
  const { action } = req.body || {};
  if (!["ACCEPT", "REJECT"].includes(action)) return res.status(400).json({ error: "action harus ACCEPT atau REJECT" });
  try {
    const fb = await prisma.studioFeedback.findUnique({ where: { id: req.params.id }, include: { message: { include: { session: true } } } });
    if (!fb) return res.status(404).json({ error: "Koreksi tidak ditemukan" });
    if (fb.status !== "NEW") return res.status(409).json({ error: "Koreksi sudah ditinjau" });

    const hasil = await prisma.$transaction(async (tx) => {
      const updated = await tx.studioFeedback.update({
        where: { id: fb.id },
        data: { status: action === "ACCEPT" ? "ACCEPTED" : "REJECTED", reviewedById: req.user.id, reviewedAt: new Date() },
      });
      let testCase = null;
      // Koreksi BAD yang diterima → test case (riwayat sampai pesan customer yang dibalas).
      if (action === "ACCEPT" && fb.rating === "BAD" && fb.idealReply) {
        const riwayat = await tx.studioMessage.findMany({
          where: { sessionId: fb.message.sessionId, createdAt: { lt: fb.message.createdAt } },
          orderBy: { createdAt: "asc" },
        });
        testCase = await tx.studioTestCase.create({
          data: {
            agentId: fb.message.session.agentId,
            title: (req.body?.title || `${fb.message.session.title} — koreksi`).slice(0, 160),
            history: riwayat.map((m) => ({ role: m.role === "CUSTOMER" ? "customer" : "agent", text: m.role === "CUSTOMER" ? m.content?.text : (m.content?.bubbles || []).join("\n") })),
            idealReply: fb.idealReply,
            mustRules: fb.reasons,
            sourceFeedbackId: fb.id,
            createdById: req.user.id,
          },
        });
      }
      return { feedback: updated, testCase };
    });
    res.json(hasil);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /test-cases ─────────────────────────────────────────────────────────
studioRouter.get("/test-cases", async (req, res) => {
  try {
    const items = await prisma.studioTestCase.findMany({ where: { active: true }, orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
