// Broadcast / Campaign — kirim pesan massal ke pelanggan lama.
//
// ⚠️ DITULIS ULANG TOTAL 14 Agt 2026. Versi sebelumnya TIDAK PERNAH BISA
// mengirim satu pesan pun, dan gagalnya diam-diam:
//
//   1. Membaca env `WAHA_URL` yang di server TIDAK ADA (yang benar
//      `WAHA_BASE_URL`), jadi jatuh ke fallback http://localhost:3000 —
//      dari dalam container backend itu artinya DIRINYA SENDIRI, dan
//      backend jalan di port 4000. Setiap kiriman kena connection refused.
//   2. Tidak mengirim header X-Api-Key, padahal WAHA mewajibkannya.
//      Seandainya alamatnya benar pun hasilnya 401.
//   3. Error cuma di-console.error, sentCount tidak pernah naik, status
//      campaign nyangkut "BERJALAN" selamanya. Operator tidak pernah tahu
//      bahwa NOL pesan terkirim.
//
// Selain itu ia mem-bypass wahaClient.js sepenuhnya (raw fetch), sehingga
// kehilangan proteksi buildChatId yang MENOLAK alamat LID — tanpa itu
// pesan terkirim ke alamat yang tidak ada dan hilang tanpa error.
//
// Sekarang: antrean = baris di tabel broadcast_targets (tahan restart),
// kirim lewat sendText + sendWithSessionFallback yang sama persis dipakai
// inbox (jadi ikut proteksi LID & pemilihan sesi CS-1/CS-2 yang benar),
// setiap pesan dicatat sebagai Message OUTBOUND supaya muncul di riwayat
// chat sales, dan ada batas harian yang benar-benar ditegakkan.

import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sendText } from "../services/wahaClient.js";
import { sendWithSessionFallback } from "./conversations.js";
import {
  awalHariWIB, dalamJamKirim, sisaWaktuKirimMs,
  jedaAntarPesanMs, acakJeda, susunPesan, TAG_OPT_OUT, TAG_BROADCAST,
} from "../services/broadcastPolicy.js";

export const broadcastRouter = express.Router();
broadcastRouter.use(requireAuth);

// ─── Penyusunan target ─────────────────────────────────────────────────────

/**
 * Terjemahkan filter dari wizard UI jadi klausa `where` Prisma.
 *
 * Dipakai DUA tempat yang wajib sinkron: /estimate (angka yang dilihat
 * admin sebelum menekan kirim) dan /prepare (target yang benar-benar
 * dibekukan). Kalau keduanya beda, admin menyetujui satu angka tapi yang
 * terkirim ke orang lain — makanya sengaja satu fungsi, bukan disalin.
 */
export function susunFilterTarget(filters = {}) {
  const { stage, source, tag, tidakAktifSejakHari, sudahOrder } = filters;
  const where = {
    // Wajib punya nomor. String kosong juga tidak berguna untuk kirim.
    phone: { not: null },
    // Jangan pernah kirim ke yang sudah minta berhenti.
    NOT: { tags: { has: TAG_OPT_OUT } },
  };

  if (stage) where.pipelineStage = stage;
  if (source) where.leadSource = source;
  if (tag) where.tags = { has: tag };
  if (sudahOrder === true) where.orderCount = { gt: 0 };
  if (sudahOrder === false) where.orderCount = 0;

  // Dua syarat di bawah SAMA-SAMA menyaring lewat relasi `conversations`.
  // Ditumpuk ke dalam AND, BUKAN di-assign berurutan ke where.conversations
  // — kalau di-assign, yang kedua menimpa yang pertama dan salah satu
  // saringan hilang diam-diam (target jadi lebih luas dari yang disetujui
  // admin, dan tidak ada tanda apa pun bahwa itu terjadi).
  const syaratPercakapan = [];

  // "Kontak dingin" = tidak ada pesan MASUK sejak N hari terakhir.
  if (tidakAktifSejakHari) {
    const batas = new Date(Date.now() - Number(tidakAktifSejakHari) * 86_400_000);
    syaratPercakapan.push({
      conversations: {
        none: { messages: { some: { direction: "INBOUND", createdAt: { gte: batas } } } },
      },
    });
  }

  if (syaratPercakapan.length) where.AND = syaratPercakapan;

  return where;
}

/**
 * Apakah urusan dengan pelanggan ini BELUM SELESAI — pesan terakhir datang
 * dari dia dan belum pernah dibalas sales?
 *
 * ⚠️ SENGAJA TIDAK MEMAKAI Conversation.status. Di produksi status itu
 * praktis tidak pernah diurus: 2.453 OPEN berbanding 30 RESOLVED (diperiksa
 * 14 Agt 2026). Artinya "OPEN" cuma berarti percakapannya ADA, bukan sedang
 * ditangani — memakainya sebagai saringan akan membuang 436 dari 439 kontak
 * dan membuat fitur ini terlihat rusak.
 *
 * Arah pesan terakhir adalah sinyal yang benar-benar hidup karena ditulis
 * otomatis oleh alur pesan itu sendiri, bukan bergantung pada disiplin
 * seseorang menekan tombol "selesai". Dan maknanya tepat: mengirim promo
 * massal ke orang yang pertanyaannya belum kita jawab adalah cara tercepat
 * mengundang komplain.
 */
export function belumDibalas(kandidat) {
  return kandidat.arahPesanTerakhir === "INBOUND";
}

// ─── Worker ────────────────────────────────────────────────────────────────
//
// Satu interval untuk SELURUH proses, bukan satu timer per target seperti
// versi lama. Tiap tick paling banyak mengirim SATU pesan, lalu menentukan
// sendiri kapan boleh mengirim lagi. Karena "antrean" sebenarnya hidup di
// database, restart backend tidak menghilangkan apa pun — worker tinggal
// membaca baris MENUNGGU berikutnya.

const TICK_MS = 15_000;
let bolehKirimSetelah = 0; // timestamp; jaga jarak antar pesan
let workerJalan = false;

/** Berapa pesan sudah TERKIRIM hari ini (WIB) untuk campaign tsb. */
async function terkirimHariIni(campaignId) {
  return prisma.broadcastTarget.count({
    where: { campaignId, status: "TERKIRIM", sentAt: { gte: awalHariWIB() } },
  });
}

/**
 * Kirim SATU target. Semua kegagalan dicatat ke baris target-nya sendiri
 * (kolom error) — tidak ada lagi kegagalan yang cuma lewat di console.
 */
async function kirimSatuTarget(target, campaign) {
  // Cek ulang opt-out TEPAT sebelum kirim. Target dibekukan saat campaign
  // disiapkan, tapi orangnya bisa minta berhenti di antara waktu itu dan
  // giliran kirimnya (bisa berhari-hari kemudian karena batas harian).
  const customer = await prisma.customer.findUnique({
    where: { id: target.customerId },
    select: { id: true, name: true, tags: true },
  });

  if (!customer || customer.tags.includes(TAG_OPT_OUT)) {
    await prisma.broadcastTarget.update({
      where: { id: target.id },
      data: { status: "DILEWATI", error: customer ? "Pelanggan minta berhenti" : "Pelanggan sudah dihapus" },
    });
    return "DILEWATI";
  }

  // Pakai percakapan WhatsApp yang sudah ada supaya sesi (CS-1/CS-2) ikut
  // yang benar dan pesannya nyambung ke riwayat chat yang sales lihat.
  const conversation = await prisma.conversation.findFirst({
    where: { customerId: target.customerId, channel: "WHATSAPP", type: "INDIVIDUAL" },
    orderBy: { updatedAt: "desc" },
  });

  if (!conversation) {
    await prisma.broadcastTarget.update({
      where: { id: target.id },
      data: { status: "GAGAL", error: "Belum ada percakapan WhatsApp" },
    });
    return "GAGAL";
  }

  const isiPesan = susunPesan(campaign.message, customer.name);

  let wahaMsg = null;
  try {
    ({ result: wahaMsg } = await sendWithSessionFallback(conversation, (session) =>
      sendText(target.phone, isiPesan, null, session)
    ));
  } catch (err) {
    await prisma.broadcastTarget.update({
      where: { id: target.id },
      data: { status: "GAGAL", error: String(err.message || err).slice(0, 500) },
    });
    return "GAGAL";
  }

  // Catat sebagai pesan keluar biasa — supaya sales yang membuka chat ini
  // TAHU customer sudah dikirimi broadcast, dan tidak menyapa seolah tidak
  // terjadi apa-apa waktu customer membalas.
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      content: isiPesan,
      externalId: wahaMsg?.id || null,
    },
  }).catch((e) => {
    // Pesannya SUDAH sampai ke customer; gagal mencatat tidak boleh
    // membatalkan itu atau memicu kirim ulang.
    console.warn("[broadcast] Pesan terkirim tapi gagal dicatat ke DB:", e.message);
  });

  await prisma.broadcastTarget.update({
    where: { id: target.id },
    data: { status: "TERKIRIM", sentAt: new Date(), error: null },
  });

  // Tandai penerima. TAG_BROADCAST selalu dipasang (dipakai chip "Broadcast"
  // di Inbox supaya sales bisa menggarap penerima blast sebagai satu antrean
  // tersendiri), tagOnSend opsional per kampanye (dipakai mengukur hasil
  // kampanye tertentu).
  const tagBaru = [TAG_BROADCAST, campaign.tagOnSend]
    .filter((t) => t && !customer.tags.includes(t));
  if (tagBaru.length) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { tags: { push: tagBaru } },
    }).catch((e) => console.warn("[broadcast] Gagal menandai pelanggan:", e.message));
  }

  return "TERKIRIM";
}

async function tick() {
  if (Date.now() < bolehKirimSetelah) return;
  if (!dalamJamKirim()) return;

  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { status: "BERJALAN" },
    orderBy: { startedAt: "asc" }, // yang lebih dulu dimulai, lebih dulu selesai
  });
  if (!campaign) return;

  const sisaTarget = await prisma.broadcastTarget.count({
    where: { campaignId: campaign.id, status: "MENUNGGU" },
  });
  if (sisaTarget === 0) {
    await prisma.broadcastCampaign.update({
      where: { id: campaign.id },
      data: { status: "SELESAI", finishedAt: new Date() },
    });
    console.log(`[broadcast] Campaign "${campaign.name}" SELESAI`);
    return;
  }

  const terpakai = await terkirimHariIni(campaign.id);
  const kuotaSisa = campaign.dailyCap - terpakai;
  if (kuotaSisa <= 0) return; // kuota hari ini habis — lanjut besok sendirinya

  const target = await prisma.broadcastTarget.findFirst({
    where: { campaignId: campaign.id, status: "MENUNGGU" },
    // Ikuti urutan yang ditetapkan saat prepare (paling baru berinteraksi
    // duluan). JANGAN pakai createdAt — nilainya kembar sampai milidetik
    // karena semua target dibuat dalam satu batch insert.
    orderBy: { urutan: "asc" },
  });
  if (!target) return;

  const hasil = await kirimSatuTarget(target, campaign);

  // Jadwalkan pesan berikutnya. Target DILEWATI tidak memakai kuota, jadi
  // boleh langsung lanjut tanpa menunggu jeda penuh.
  const jeda = hasil === "DILEWATI"
    ? 1_000
    : acakJeda(jedaAntarPesanMs(Math.max(1, kuotaSisa), sisaWaktuKirimMs()));
  bolehKirimSetelah = Date.now() + jeda;

  console.log(`[broadcast] "${campaign.name}" -> ${target.phone}: ${hasil} (kuota ${terpakai + 1}/${campaign.dailyCap}, jeda ${Math.round(jeda / 1000)}s)`);
}

export function mulaiWorkerBroadcast() {
  if (workerJalan) return;
  workerJalan = true;
  setInterval(() => {
    tick().catch((err) => console.error("[broadcast] tick error:", err.message));
  }, TICK_MS);
  console.log("[broadcast] Worker aktif (tahan restart — antrean ada di database)");
}

// ─── Endpoint ──────────────────────────────────────────────────────────────

// GET /api/broadcast/campaigns — daftar + progres nyata dari tabel target
broadcastRouter.get("/campaigns", async (_req, res) => {
  try {
    const campaigns = await prisma.broadcastCampaign.findMany({ orderBy: { createdAt: "desc" } });
    const hitung = await prisma.broadcastTarget.groupBy({
      by: ["campaignId", "status"],
      _count: { _all: true },
    });

    res.json(campaigns.map((c) => {
      const milik = hitung.filter((h) => h.campaignId === c.id);
      const per = (s) => milik.find((h) => h.status === s)?._count._all || 0;
      const terkirim = per("TERKIRIM");
      const gagal = per("GAGAL");
      const dilewati = per("DILEWATI");
      const menunggu = per("MENUNGGU");
      return {
        ...c,
        sentCount: terkirim,
        failedCount: gagal,
        skippedCount: dilewati,
        pendingCount: menunggu,
        totalTargets: terkirim + gagal + dilewati + menunggu,
      };
    }));
  } catch (err) {
    console.error("[broadcast] daftar campaign gagal:", err.message);
    res.status(500).json({ error: "Gagal memuat kampanye" });
  }
});

// POST /api/broadcast/campaigns
broadcastRouter.post("/campaigns", async (req, res) => {
  try {
    const { name, message, filters, dailyCap, tagOnSend } = req.body;
    if (!name?.trim() || !message?.trim()) {
      return res.status(400).json({ error: "Nama dan pesan wajib diisi" });
    }
    const campaign = await prisma.broadcastCampaign.create({
      data: {
        name: name.trim(),
        message: message.trim(),
        filters: filters || {},
        dailyCap: Math.max(1, Math.min(Number(dailyCap) || 50, 500)),
        tagOnSend: tagOnSend?.trim() || null,
        createdById: req.user.id,
      },
    });
    res.status(201).json(campaign);
  } catch (err) {
    console.error("[broadcast] buat campaign gagal:", err.message);
    res.status(500).json({ error: "Gagal membuat kampanye" });
  }
});

// PATCH /api/broadcast/campaigns/:id
broadcastRouter.patch("/campaigns/:id", async (req, res) => {
  try {
    const { name, message, filters, dailyCap, tagOnSend, status } = req.body;
    const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) return res.status(404).json({ error: "Kampanye tidak ditemukan" });

    // Isi pesan & target TIDAK boleh diubah setelah campaign mulai jalan —
    // sebagian orang sudah menerima versi lama, mengubahnya di tengah bikin
    // dua kelompok penerima menerima janji berbeda tanpa jejak.
    const sudahJalan = campaign.status !== "DRAFT";
    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (dailyCap !== undefined) data.dailyCap = Math.max(1, Math.min(Number(dailyCap) || 50, 500));
    if (tagOnSend !== undefined) data.tagOnSend = tagOnSend?.trim() || null;
    if (status !== undefined && ["BERJALAN", "JEDA"].includes(status)) data.status = status;
    if (!sudahJalan) {
      if (message !== undefined) data.message = message.trim();
      if (filters !== undefined) data.filters = filters;
    }

    const updated = await prisma.broadcastCampaign.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    console.error("[broadcast] ubah campaign gagal:", err.message);
    res.status(500).json({ error: "Gagal mengubah kampanye" });
  }
});

// DELETE /api/broadcast/campaigns/:id
broadcastRouter.delete("/campaigns/:id", async (req, res) => {
  try {
    await prisma.broadcastCampaign.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Kampanye tidak ditemukan" });
  }
});

// GET /api/broadcast/estimate — berapa kontak yang cocok filter saat ini
broadcastRouter.get("/estimate", async (req, res) => {
  try {
    const filters = {
      stage: req.query.stage || undefined,
      source: req.query.source || undefined,
      tag: req.query.tag || undefined,
      tidakAktifSejakHari: req.query.tidakAktifSejakHari || undefined,
      sudahOrder: req.query.sudahOrder === "true" ? true : req.query.sudahOrder === "false" ? false : undefined,
      // Default AKTIF — mengecualikan chat yang sedang berjalan adalah
      // perilaku yang diinginkan; harus sengaja dimatikan, bukan sengaja
      // dinyalakan.
      kecualikanChatAktif: req.query.kecualikanChatAktif !== "false",
    };
    // Lewat ambilKandidat (bukan prisma.count) supaya saringan "belum
    // dibalas" — yang tidak bisa dinyatakan di klausa where — ikut terhitung.
    // Kalau di sini pakai count langsung, admin melihat angka yang lebih
    // besar dari jumlah yang benar-benar dikirimi.
    const kandidat = await ambilKandidat(filters);
    res.json({ count: kandidat.length });
  } catch (err) {
    console.error("[broadcast] estimate gagal:", err.message);
    res.status(500).json({ error: "Gagal menghitung target" });
  }
});

/**
 * Ambil kandidat target LENGKAP dengan kapan terakhir mereka berinteraksi,
 * sudah diurutkan dari yang paling baru.
 *
 * Dipakai bersama oleh /preview-targets (admin melihat & memilih) dan
 * /prepare (yang benar-benar membekukan). Satu sumber supaya daftar yang
 * DILIHAT admin persis sama dengan yang DIKIRIMI.
 */
async function ambilKandidat(filters = {}) {
  const customers = await prisma.customer.findMany({
    where: susunFilterTarget(filters),
    select: {
      id: true, name: true, phone: true, pipelineStage: true,
      orderCount: true, tags: true,
      // lastMessageAt percakapan = kapan TERAKHIR benar-benar ada interaksi.
      // Sengaja TIDAK memakai Customer.updatedAt: kolom itu ikut berubah
      // setiap sales mengedit data (ganti nama, pindah stage) — perubahan
      // yang sama sekali tidak berarti "orangnya baru saja aktif".
      conversations: {
        where: { channel: "WHATSAPP" },
        select: {
          lastMessageAt: true,
          // Arah pesan TERAKHIR — dasar saringan "belum dibalas".
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { direction: true } },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 1,
      },
    },
  });

  const kandidat = customers
    .map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      pipelineStage: c.pipelineStage,
      orderCount: c.orderCount,
      tags: c.tags,
      terakhirInteraksi: c.conversations[0]?.lastMessageAt || null,
      arahPesanTerakhir: c.conversations[0]?.messages[0]?.direction || null,
    }))
    // Paling baru berinteraksi duluan — mereka paling ingat Sano, jadi
    // paling kecil kemungkinan menganggap pesannya spam.
    .sort((a, b) => (b.terakhirInteraksi?.getTime() || 0) - (a.terakhirInteraksi?.getTime() || 0));

  // Saringan ini dikerjakan DI SINI, bukan di klausa where, karena "arah
  // pesan terakhir" tidak bisa dinyatakan sebagai filter Prisma. Karena
  // /estimate, /preview-targets, dan /prepare semuanya lewat fungsi ini,
  // angka yang DILIHAT admin dijamin sama dengan yang DIKIRIMI.
  return filters.kecualikanChatAktif ? kandidat.filter((k) => !belumDibalas(k)) : kandidat;
}

// GET /api/broadcast/preview-targets — daftar kandidat + recency, supaya
// admin bisa MEMILIH sendiri siapa yang dikirimi (10 dulu, 30 dulu, dst)
// alih-alih hanya menerima angka total.
broadcastRouter.get("/preview-targets", async (req, res) => {
  try {
    const filters = {
      stage: req.query.stage || undefined,
      source: req.query.source || undefined,
      tag: req.query.tag || undefined,
      tidakAktifSejakHari: req.query.tidakAktifSejakHari || undefined,
      sudahOrder: req.query.sudahOrder === "true" ? true : req.query.sudahOrder === "false" ? false : undefined,
      kecualikanChatAktif: req.query.kecualikanChatAktif !== "false",
    };
    const semua = await ambilKandidat(filters);
    res.json({
      total: semua.length,
      // Dibatasi supaya payload tidak jadi ribuan baris; admin memilih dari
      // yang paling atas (paling baru berinteraksi) yang memang didahulukan.
      data: semua.slice(0, Math.min(Number(req.query.limit) || 300, 1000)),
    });
  } catch (err) {
    console.error("[broadcast] preview-targets gagal:", err.message);
    res.status(500).json({ error: "Gagal memuat kandidat target" });
  }
});

// GET /api/broadcast/health-check — rasio outbound:inbound 7 hari terakhir.
// Rasio tinggi = pola akun makin mirip penyebar spam di mata WhatsApp.
broadcastRouter.get("/health-check", async (_req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [outbound, inbound] = await Promise.all([
      prisma.message.count({ where: { direction: "OUTBOUND", createdAt: { gte: since } } }),
      prisma.message.count({ where: { direction: "INBOUND", createdAt: { gte: since } } }),
    ]);
    const ratio = inbound > 0 ? outbound / inbound : outbound;
    res.json({ outbound, inbound, ratio: Math.round(ratio * 100) / 100, safe: ratio <= 2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/broadcast/campaigns/:id/prepare — bekukan daftar target.
// DIPISAH dari "start" supaya admin bisa melihat daftar final SEBELUM
// satu pesan pun terkirim.
broadcastRouter.post("/campaigns/:id/prepare", async (req, res) => {
  try {
    const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) return res.status(404).json({ error: "Kampanye tidak ditemukan" });
    if (campaign.status !== "DRAFT") {
      return res.status(409).json({ error: "Kampanye sudah pernah dijalankan — buat kampanye baru" });
    }

    // customerIds = admin memilih sendiri di layar "Pilih Kontak".
    // batas = ambil N teratas saja (paling baru berinteraksi duluan).
    // Kalau dua-duanya kosong, pakai seluruh hasil filter.
    const { customerIds, batas } = req.body || {};

    let kandidat = await ambilKandidat(campaign.filters || {});

    if (Array.isArray(customerIds) && customerIds.length > 0) {
      const dipilih = new Set(customerIds);
      kandidat = kandidat.filter((c) => dipilih.has(c.id));
    }
    if (batas && Number(batas) > 0) {
      kandidat = kandidat.slice(0, Number(batas));
    }

    if (kandidat.length === 0) return res.status(400).json({ error: "Tidak ada kontak yang cocok dengan filter" });

    await prisma.broadcastTarget.createMany({
      data: kandidat.map((c, i) => ({
        campaignId: campaign.id,
        customerId: c.id,
        phone: c.phone,
        urutan: i,
      })),
      skipDuplicates: true,
    });

    const total = await prisma.broadcastTarget.count({ where: { campaignId: campaign.id } });
    res.json({ prepared: total });
  } catch (err) {
    console.error("[broadcast] prepare gagal:", err.message);
    res.status(500).json({ error: "Gagal menyiapkan target" });
  }
});

// POST /api/broadcast/campaigns/:id/start — serahkan ke worker
broadcastRouter.post("/campaigns/:id/start", async (req, res) => {
  try {
    const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) return res.status(404).json({ error: "Kampanye tidak ditemukan" });

    const menunggu = await prisma.broadcastTarget.count({
      where: { campaignId: campaign.id, status: "MENUNGGU" },
    });
    if (menunggu === 0) {
      return res.status(400).json({ error: "Belum ada target — jalankan 'Siapkan Target' dulu" });
    }

    const updated = await prisma.broadcastCampaign.update({
      where: { id: campaign.id },
      data: { status: "BERJALAN", startedAt: campaign.startedAt || new Date() },
    });
    res.json({ ...updated, pendingCount: menunggu });
  } catch (err) {
    console.error("[broadcast] start gagal:", err.message);
    res.status(500).json({ error: "Gagal menjalankan kampanye" });
  }
});

// POST /api/broadcast/campaigns/:id/pause — rem darurat
broadcastRouter.post("/campaigns/:id/pause", async (req, res) => {
  try {
    const updated = await prisma.broadcastCampaign.update({
      where: { id: req.params.id },
      data: { status: "JEDA" },
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "Kampanye tidak ditemukan" });
  }
});

// POST /api/broadcast/campaigns/:id/test — kirim contoh ke nomor yang
// DITENTUKAN admin. Versi lama mengirim ke 3 pelanggan ASLI pertama di
// database — orang sungguhan menerima pesan uji coba tanpa pernah setuju.
broadcastRouter.post("/campaigns/:id/test", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone?.trim()) return res.status(400).json({ error: "Nomor tujuan uji wajib diisi" });

    const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) return res.status(404).json({ error: "Kampanye tidak ditemukan" });

    const nomor = phone.replace(/[^0-9]/g, "");
    const conversation = await prisma.conversation.findFirst({
      where: { customer: { phone: nomor }, channel: "WHATSAPP" },
      orderBy: { updatedAt: "desc" },
    });
    if (!conversation) {
      return res.status(400).json({ error: "Nomor ini belum pernah chat — pakai nomor yang ada di CRM" });
    }

    await sendWithSessionFallback(conversation, (session) =>
      sendText(nomor, susunPesan(campaign.message, "Budi"), null, session)
    );
    res.json({ ok: true, sentTo: nomor });
  } catch (err) {
    res.status(502).json({ error: `Gagal kirim uji: ${err.message}` });
  }
});

// GET /api/broadcast/campaigns/:id/targets — daftar penerima + statusnya,
// supaya hasil campaign bisa diperiksa & diukur, bukan cuma angka total.
broadcastRouter.get("/campaigns/:id/targets", async (req, res) => {
  try {
    const targets = await prisma.broadcastTarget.findMany({
      where: {
        campaignId: req.params.id,
        ...(req.query.status ? { status: req.query.status } : {}),
      },
      include: { customer: { select: { name: true, phone: true, pipelineStage: true, orderCount: true } } },
      orderBy: [{ sentAt: "desc" }, { urutan: "asc" }],
      take: Math.min(Number(req.query.limit) || 200, 1000),
    });
    res.json(targets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
