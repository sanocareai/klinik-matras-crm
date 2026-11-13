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
import { runTurn, runCopilotDraft, MODELS } from "../services/agentStudio/runtime.js";
import { rakitKonteksCopilot, muatDataCopilot } from "../services/agentStudio/copilotContext.js";
import { bolehCopilot, alasanPercakapanDitolak, validasiOutcome, validasiCrm, ringkasStats, BATAS_DRAFT_PER_JAM, BATAS_HARIAN_USD } from "../services/agentStudio/copilotPolicy.js";

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

// ═══ COPILOT INBOX (MVP 2) ═════════════════════════════════════════════════
// Draft untuk sales di Inbox. Copilot TIDAK PERNAH mengirim pesan / memanggil
// WAHA — sales yang mengirim lewat alur Inbox yang sudah ada.
// Lihat docs/AI-STUDIO-MVP2-COPILOT.md §7.

async function aksesCopilot(req) {
  const agent = await pastikanAgentBawaan(req.user.id);
  return { agent, boleh: bolehCopilot(rolesOf(req.user), req.user.id, agent.config || {}) };
}

async function simpanConfigAgent(agent, patch) {
  return prisma.studioAgent.update({ where: { id: agent.id }, data: { config: { ...(agent.config || {}), ...patch } } });
}

function awalHariIni() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── GET /copilot/akses — apakah tombol ✨ Saran AI ditampilkan untuk user ini ─
studioRouter.get("/copilot/akses", async (req, res) => {
  try {
    const { boleh } = await aksesCopilot(req);
    res.json({ boleh });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /copilot/:conversationId/draft — klik "Saran AI" ───────────────────
studioRouter.post("/copilot/:conversationId/draft", async (req, res) => {
  try {
    const { agent, boleh } = await aksesCopilot(req);
    if (!boleh) return res.status(403).json({ error: "Copilot belum diaktifkan untuk akun Anda" });

    const data = await muatDataCopilot(prisma, req.params.conversationId, { contohIds: agent.config?.contohGaya || [] });
    const ditolak = alasanPercakapanDitolak(data?.conversation);
    if (ditolak) return res.status(data ? 400 : 404).json({ error: ditolak });

    const sejamLalu = new Date(Date.now() - 3600_000);
    const [draftSejam, biayaHariIni] = await Promise.all([
      prisma.studioCopilotDraft.count({ where: { salesUserId: req.user.id, createdAt: { gte: sejamLalu } } }),
      prisma.studioCopilotDraft.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: awalHariIni() } } }),
    ]);
    if (draftSejam >= BATAS_DRAFT_PER_JAM) return res.status(429).json({ error: `Batas ${BATAS_DRAFT_PER_JAM} saran AI per jam tercapai — coba lagi nanti` });
    if ((biayaHariIni._sum.costUsd || 0) >= BATAS_HARIAN_USD()) return res.status(429).json({ error: `Plafon biaya Copilot hari ini ($${BATAS_HARIAN_USD()}) sudah tercapai` });

    const apiKey = kunciAnthropic();
    if (!apiKey) return res.status(503).json({ error: "Kunci API Anthropic belum diatur" });

    const konteks = rakitKonteksCopilot(data);
    if (!konteks.riwayat.length) return res.status(400).json({ error: "Percakapan belum punya pesan" });

    const [live, products] = await Promise.all([
      prisma.studioSkillVersion.findFirst({ where: { agentId: agent.id, status: "LIVE" }, orderBy: { versionNumber: "desc" } }),
      prisma.product.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    ]);
    if (!live) return res.status(409).json({ error: "Agent belum punya versi live" });

    const model = agent.defaultModel || "claude-haiku-5-5";
    const mulai = Date.now();
    const hasil = await runCopilotDraft({
      skillFiles: live.files,
      products,
      konteks,
      model,
      callModel: ({ model: m, systemPrompt, messages, maxTokens }) => anthropicChat({ apiKey, model: m, systemPrompt, messages, maxTokens }),
    });
    const draft = await prisma.studioCopilotDraft.create({
      data: {
        conversationId: data.conversation.id,
        customerId: data.conversation.customerId,
        salesUserId: req.user.id,
        skillVersionId: live.id,
        model,
        contextMessageId: data.messages.find((m) => m.direction === "INBOUND")?.id || null, // messages urut terbaru dulu
        output: hasil.output,
        inputTokens: hasil.usage.inputTokens || 0,
        outputTokens: hasil.usage.outputTokens || 0,
        cacheReadTokens: hasil.usage.cacheReadTokens || 0,
        costUsd: hasil.costUsd,
        latencyMs: Date.now() - mulai,
      },
    });
    res.status(201).json({ draft: { id: draft.id, output: draft.output, model, costUsd: draft.costUsd, latencyMs: draft.latencyMs, versi: live.versionNumber } });
  } catch (err) {
    // Jangan log isi chat / data customer — cukup pesan error.
    console.error("[copilot] gagal membuat draft:", err.message);
    res.status(502).json({ error: `Gagal membuat saran AI: ${err.message}` });
  }
});

// Draft hanya boleh diubah oleh sales yang membuatnya. null = respons error sudah dikirim.
async function draftMilikSendiri(req, res) {
  const draft = await prisma.studioCopilotDraft.findUnique({ where: { id: req.params.id } });
  if (!draft) {
    res.status(404).json({ error: "Draft tidak ditemukan" });
    return null;
  }
  if (draft.salesUserId !== req.user.id) {
    res.status(403).json({ error: "Bukan draft Anda" });
    return null;
  }
  return draft;
}

// ── POST /copilot/drafts/:id/outcome — dipakai / diedit / diabaikan ─────────
studioRouter.post("/copilot/drafts/:id/outcome", async (req, res) => {
  try {
    const draft = await draftMilikSendiri(req, res);
    if (!draft) return;
    if (draft.outcome !== "SHOWN") return res.status(409).json({ error: "Nasib draft ini sudah dicatat" });
    const v = validasiOutcome(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const updated = await prisma.studioCopilotDraft.update({ where: { id: draft.id }, data: v.data, select: { id: true, outcome: true, ignoreReason: true, outcomeAt: true } });
    res.json({ draft: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /copilot/drafts/:id/crm — simpan chip (kota, tag keluhan, catatan) ─
studioRouter.post("/copilot/drafts/:id/crm", async (req, res) => {
  try {
    const draft = await draftMilikSendiri(req, res);
    if (!draft) return;
    if (!draft.customerId) return res.status(400).json({ error: "Percakapan ini belum terhubung ke customer" });
    const customer = await prisma.customer.findUnique({ where: { id: draft.customerId }, select: { id: true, tags: true } });
    if (!customer) return res.status(404).json({ error: "Customer tidak ditemukan" });
    const v = validasiCrm(req.body, customer.tags || []);
    if (v.error) return res.status(400).json({ error: v.error });

    await prisma.$transaction(async (tx) => {
      if (Object.keys(v.data.customer).length) await tx.customer.update({ where: { id: customer.id }, data: v.data.customer });
      if (v.data.note) await tx.note.create({ data: { customerId: customer.id, authorId: req.user.id, content: v.data.note } });
      await tx.studioCopilotDraft.update({ where: { id: draft.id }, data: { crmSaved: { ...(draft.crmSaved || {}), ...v.data.disimpan } } });
    });
    res.json({ disimpan: v.data.disimpan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /copilot/stats — pemakaian pilot (Admin/Owner) ──────────────────────
studioRouter.get("/copilot/stats", boleh(PERAN_PENINJAU), async (req, res) => {
  try {
    const hari = Math.min(Math.max(Number(req.query.hari) || 14, 1), 90);
    const sejak = new Date(Date.now() - hari * 24 * 3600_000);
    const [drafts, terbaru, biayaHariIni] = await Promise.all([
      prisma.studioCopilotDraft.findMany({ where: { createdAt: { gte: sejak } }, select: { salesUserId: true, outcome: true, costUsd: true } }),
      prisma.studioCopilotDraft.findMany({
        where: { createdAt: { gte: sejak } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, conversationId: true, salesUserId: true, output: true, outcome: true, ignoreReason: true, sentText: true, crmSaved: true, costUsd: true, latencyMs: true, createdAt: true },
      }),
      prisma.studioCopilotDraft.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: awalHariIni() } } }),
    ]);
    const ids = [...new Set(drafts.map((d) => d.salesUserId))];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const nama = Object.fromEntries(users.map((u) => [u.id, u.name]));
    res.json({
      hari,
      ...ringkasStats(drafts, nama),
      terbaru: terbaru.map((d) => ({ ...d, salesNama: nama[d.salesUserId] || "—" })),
      biayaHariIni: biayaHariIni._sum.costUsd || 0,
      plafonHarian: BATAS_HARIAN_USD(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET/PUT /copilot/users — daftar pilot Tahap B (Admin/Owner) ─────────────
studioRouter.get("/copilot/users", boleh(PERAN_PENINJAU), async (req, res) => {
  try {
    const agent = await pastikanAgentBawaan(req.user.id);
    const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
    res.json({ users, copilotUsers: agent.config?.copilotUsers || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

studioRouter.put("/copilot/users", boleh(PERAN_PENINJAU), async (req, res) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).filter((x) => typeof x === "string"))];
    const ada = await prisma.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } });
    const agent = await pastikanAgentBawaan(req.user.id);
    const updated = await simpanConfigAgent(agent, { copilotUsers: ada.map((u) => u.id) });
    res.json({ copilotUsers: updated.config.copilotUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET/PUT /copilot/contoh-gaya — kurasi gold standard (Admin/Owner) ───────
studioRouter.get("/copilot/contoh-gaya", boleh(PERAN_PENINJAU), async (req, res) => {
  try {
    const agent = await pastikanAgentBawaan(req.user.id);
    const kandidat = await prisma.goldStandardExample.findMany({
      orderBy: [{ category: "asc" }, { relatedScore: "desc" }],
      take: 300,
      select: { id: true, category: true, quote: true, salesName: true, relatedScore: true, sampledFor: true },
    });
    res.json({ kandidat, terpilih: agent.config?.contohGaya || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

studioRouter.put("/copilot/contoh-gaya", boleh(PERAN_PENINJAU), async (req, res) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => typeof x === "string"))];
    if (ids.length > 40) return res.status(400).json({ error: "Maksimal 40 contoh gaya" });
    const ada = await prisma.goldStandardExample.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const agent = await pastikanAgentBawaan(req.user.id);
    const updated = await simpanConfigAgent(agent, { contohGaya: ada.map((e) => e.id) });
    res.json({ terpilih: updated.config.contohGaya });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
