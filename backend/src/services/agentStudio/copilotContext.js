// ─── AI STUDIO — PERAKIT KONTEKS COPILOT (MVP 2) ────────────────────────────
// Mengubah data Inbox (riwayat chat, kartu customer, contoh gaya) menjadi SATU
// pesan user untuk model. Fungsi rakit* MURNI (tanpa DB) supaya bisa dites;
// muatDataCopilot() satu-satunya yang membaca Prisma.
// Lihat docs/AI-STUDIO-MVP2-COPILOT.md §4.

export const MAKS_PESAN = 30;
export const MAKS_CONTOH = 8;
const MAKS_KARAKTER_PESAN = 600;
const STATUS_KOMPLAIN_SELESAI = ["SELESAI", "DIBATALKAN"];

const LABEL_MEDIA = { image: "[foto]", video: "[video]", audio: "[voice note]", ptt: "[voice note]", document: "[dokumen]", sticker: "[stiker]", location: "[lokasi]" };

function potong(teks, maks) {
  const s = String(teks || "").replace(/\s+\n/g, "\n").trim();
  return s.length > maks ? s.slice(0, maks).trimEnd() + "…" : s;
}

// Satu Message → teks satu baris riwayat. null = dibuang (revoked / kosong).
export function ringkasPesan(m = {}) {
  if (m.isRevoked) return null;
  const media = LABEL_MEDIA[m.mediaType] || LABEL_MEDIA[m.rawType] || (m.mediaType ? "[lampiran]" : "");
  const teks = potong(m.content, MAKS_KARAKTER_PESAN);
  const isi = [media, teks].filter(Boolean).join(" ");
  return isi || null;
}

// Message[] (urutan apa saja) → baris "Customer: …" / "Sales: …", 30 terakhir, lama → baru.
export function rakitRiwayat(messages = []) {
  const urut = [...messages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const baris = [];
  for (const m of urut) {
    const isi = ringkasPesan(m);
    if (isi) baris.push({ dari: m.direction === "INBOUND" ? "CUSTOMER" : "SALES", isi });
  }
  return baris.slice(-MAKS_PESAN);
}

const fmtTanggal = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "?");

// Kartu customer → blok teks. Hanya data yang membantu menjawab; tanpa nomor HP.
export function rakitKartuCustomer({ customer = null, orders = [], complaints = [] } = {}) {
  if (!customer) return "Customer belum tercatat di CRM (lead baru).";
  const baris = [
    `Nama: ${customer.name || "(belum diketahui)"}`,
    `Kota: ${customer.city || "(belum diketahui)"}`,
    `Tahap pipeline: ${customer.pipelineStage || "NEW"}`,
  ];
  if (customer.tags?.length) baris.push(`Tag: ${customer.tags.join(", ")}`);
  if (orders.length) {
    baris.push(`Order sebelumnya (${orders.length}) — PELANGGAN LAMA, jangan pakai alur lead baru:`);
    for (const o of orders.slice(0, 3)) {
      const produk = (o.items || []).map((i) => i.layananName).filter(Boolean).join(", ") || "(tanpa rincian)";
      baris.push(`- ${fmtTanggal(o.createdAt)} · ${produk} · status ${o.status}`);
    }
  } else {
    baris.push("Order sebelumnya: belum ada.");
  }
  const terbuka = complaints.filter((c) => !STATUS_KOMPLAIN_SELESAI.includes(c.status));
  if (terbuka.length) {
    baris.push(`KOMPLAIN TERBUKA (${terbuka.length}) — jangan jualan, serahkan ke sales:`);
    for (const c of terbuka.slice(0, 3)) baris.push(`- ${c.caseNumber} · ${c.category} · ${c.status} · ${potong(c.description, 160)}`);
  }
  return baris.join("\n");
}

// Pilih maks 8 contoh gaya, bergiliran antar kategori supaya beragam.
// `prioritas` = kategori yang didahulukan (mis. saat customer sudah tanya harga).
export function pilihContohGaya(examples = [], { prioritas = [], maks = MAKS_CONTOH } = {}) {
  const perKategori = new Map();
  for (const e of examples) {
    if (!e?.quote?.trim()) continue;
    if (!perKategori.has(e.category)) perKategori.set(e.category, []);
    perKategori.get(e.category).push(e);
  }
  const urutan = [...prioritas.filter((k) => perKategori.has(k)), ...[...perKategori.keys()].filter((k) => !prioritas.includes(k))];
  const hasil = [];
  for (let putaran = 0; hasil.length < maks; putaran++) {
    let ada = false;
    for (const k of urutan) {
      const e = perKategori.get(k)[putaran];
      if (e && hasil.length < maks) { hasil.push(e); ada = true; }
    }
    if (!ada) break;
  }
  return hasil;
}

const RE_TANYA_HARGA = /\b(harga|harganya|berapa|brp|biaya|pl|price ?list|kena berapa)\b/i;
const PRIORITAS_HARGA = ["OBJECTION_REFRAME_HARGA", "OBJECTION_AKUI", "CLOSING_ASK"];
const PRIORITAS_AWAL = ["COMMUNICATION_VALIDATION", "COMMUNICATION_PLAIN_LANGUAGE", "OBJECTION_GALI"];

/**
 * Rakit pesan user untuk model dalam mode copilot.
 * @returns { pesan, riwayat, customerTexts, customerTerakhir, terakhirDari, contoh }
 *   customerTexts    = semua teks customer (untuk hitung tanya harga di cek)
 *   customerTerakhir = pesan customer paling baru (untuk cek handover komplain/nego)
 *   terakhirDari     = "CUSTOMER" | "SALES" | null
 */
export function rakitKonteksCopilot({ messages = [], customer = null, orders = [], complaints = [], examples = [] } = {}) {
  const riwayat = rakitRiwayat(messages);
  const customerTexts = riwayat.filter((b) => b.dari === "CUSTOMER").map((b) => b.isi);
  const terakhirDari = riwayat.at(-1)?.dari || null;
  const tanyaHarga = customerTexts.filter((t) => RE_TANYA_HARGA.test(t)).length;
  const contoh = pilihContohGaya(examples, { prioritas: tanyaHarga ? PRIORITAS_HARGA : PRIORITAS_AWAL });

  const bagian = [`## KONTEKS CUSTOMER\n${rakitKartuCustomer({ customer, orders, complaints })}`];
  if (contoh.length) {
    bagian.push(`## CONTOH GAYA (kutipan sales terbaik kita — tiru nadanya, JANGAN ambil fakta/harga dari sini)\n${contoh.map((e) => `- "${potong(e.quote, 300)}"`).join("\n")}`);
  }
  bagian.push(`## RIWAYAT CHAT (lama → baru)\n${riwayat.length ? riwayat.map((b) => `${b.dari === "CUSTOMER" ? "Customer" : "Sales"}: ${b.isi}`).join("\n") : "(belum ada pesan)"}`);
  bagian.push(
    terakhirDari === "SALES"
      ? "## TUGAS\nPesan terakhir dari sales dan customer belum membalas. Susun follow-up ringan yang relevan (bukan mengulang pesan sales), atau bubble [] bila belum perlu follow-up."
      : "## TUGAS\nSusun draft balasan sales berikutnya untuk pesan customer terakhir di atas."
  );
  // Model sering salah menghitung sendiri → beri angka pasti untuk Aturan harga di SKILL.md.
  if (tanyaHarga) {
    bagian[bagian.length - 1] += `\nCustomer sudah menanyakan harga ${tanyaHarga}x di riwayat ini${tanyaHarga === 1 ? " (PERTAMA kali → ikuti aturan tanya harga pertama, satu langkah saja)" : ""}.`;
  }

  return {
    pesan: bagian.join("\n\n"),
    riwayat,
    customerTexts,
    customerTerakhir: [...riwayat].reverse().find((b) => b.dari === "CUSTOMER")?.isi || "",
    terakhirDari,
    contoh,
  };
}

// ─── Pemuat dari DB (satu-satunya bagian yang menyentuh Prisma) ─────────────
// `contohIds` = id GoldStandardExample yang sudah dikurasi (StudioAgent.config.contohGaya).
export async function muatDataCopilot(prisma, conversationId, { contohIds = [] } = {}) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, type: true, customerId: true, customer: { select: { id: true, name: true, city: true, tags: true, pipelineStage: true } } },
  });
  if (!conv) return null;
  const [messages, orders, complaints, examples] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId, isRevoked: false },
      orderBy: { createdAt: "desc" },
      take: MAKS_PESAN + 10, // cadangan untuk pesan kosong yang dibuang
      select: { direction: true, content: true, mediaType: true, rawType: true, isRevoked: true, createdAt: true },
    }),
    conv.customerId
      ? prisma.order.findMany({
          where: { customerId: conv.customerId, mergedIntoOrderId: null },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { createdAt: true, status: true, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } } },
        })
      : [],
    conv.customerId
      ? prisma.complaintCase.findMany({
          where: { order: { customerId: conv.customerId }, status: { notIn: STATUS_KOMPLAIN_SELESAI } },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { caseNumber: true, category: true, status: true, description: true },
        })
      : [],
    contohIds.length ? prisma.goldStandardExample.findMany({ where: { id: { in: contohIds } }, select: { id: true, category: true, quote: true } }) : [],
  ]);
  return { conversation: conv, messages, customer: conv.customer, orders, complaints, examples };
}
