// Tool MCP untuk PERCAKAPAN — pencarian pesan, kualitas engagement pelanggan,
// audit kepatuhan balasan sales, dan diagnosa satu percakapan.
//
// ⚠️ READ-ONLY. Aturan lengkap ada di toolsShared.js — dijaga tes otomatis
// (tests/mcp.test.js memindai file ini).
//
// PRINSIP: mesin aturan TIDAK dibuat baru di sini, semuanya dipakai ulang dari
// yang sudah jalan di produk:
//   - `violations()` (services/replyAssistant/validator.js) — 7 kategori janji
//     terlarang. Dibangun untuk menyaring draf AI; di sini dipakai untuk
//     MENGAUDIT pesan sales SUNGGUHAN. Satu definisi aturan, dua pemakaian —
//     kalau aturannya berubah, dua-duanya ikut berubah otomatis.
//   - `authorityStyleViolations()` (services/replyAssistant/authorityStyleValidator.js,
//     28 Agustus 2026) — kategori BARU, TERPISAH dari violations() di atas.
//     Soal GAYA BAHASA Authority Selling (Modul 6: hindari "pasti"/"dijamin"/
//     "harus beli"), BUKAN risiko hukum seperti 7 kategori violations() —
//     sengaja TIDAK digabung ke violations() supaya tidak ikut memblokir
//     draf AI (scrubSuggestions), yang bukan tujuannya.
//   - `detectIntents()` / `INTENT_TAXONOMY` (services/intelligence/replyReadiness.js)
//     — intent COMPLAINT & HANDOVER_REQUEST = WAJIB ditangani manusia.
//   - `buildCustomerIntelligence()` (services/intelligence/) — skor relasi/urgensi/
//     peluang yang sama dengan UI Customer360.
//
// AMBANG SLA BALAS PERTAMA = 60 MENIT. Angka ini SENGAJA sama dengan
// `sla_breach` di routes/analytics.js dan aturan takeover CLAUDE.md §7C —
// jangan diganti sepihak, nanti laporan CRM dan audit MCP saling bertentangan.
// (THRESHOLDS.unansweredMinutes 180 menit di intelligence/weights.js BEDA
// urusan: itu "follow-up menunggu", bukan SLA balas pertama.)

import { z } from "zod";
import { prisma } from "../db.js";
import { maskPhone } from "./security.js";
import { violations } from "../services/replyAssistant/validator.js";
import { authorityStyleViolations } from "../services/replyAssistant/authorityStyleValidator.js";
import { detectIntents, INTENT_TAXONOMY, anyHandoverRequired } from "../services/intelligence/replyReadiness.js";
import { loadCustomerContext, buildCustomerIntelligence } from "../services/intelligence/index.js";
import {
  PIPELINE_STAGES, TANGGAL, unmaskParam, limitParam,
  whereTanggal, hasil, ANOTASI_BACA,
} from "./toolsShared.js";

export const SLA_BALAS_PERTAMA_MENIT = 60;

// Batas keras jumlah pesan OUTBOUND yang diperiksa sekali panggil. Production
// punya 40.000+ pesan keluar; tanpa batas, satu pertanyaan bisa menarik semuanya.
const MAKS_PESAN_AUDIT = 5000;
// Pesan per percakapan yang dimuat untuk analisa pola (cukup untuk metrik
// giliran/ghosting; percakapan terpanjang pun jarang melewati ini).
const MAKS_PESAN_PER_PERCAKAPAN = 200;

export const LABEL_PELANGGARAN = {
  price: "Menyebut harga/nominal",
  discount: "Menjanjikan diskon/potongan",
  freebie: "Menjanjikan gratis/bonus",
  delivery: "Menjanjikan waktu kirim/selesai spesifik",
  warranty: "Klaim garansi flat berangka",
  medical: "Klaim menyembuhkan (medis)",
  certainty: "Jaminan mutlak (pasti cocok/dijamin)",
  // BARU (28 Agustus 2026) — kategori GAYA BAHASA (Modul 6 Authority
  // Selling), BUKAN kategori compliance existing di atas. Lihat
  // authorityStyleValidator.js utk penjelasan lengkap kenapa terpisah.
  authorityAbsolute: "Gaya bahasa \"penjual\" bukan konsultan (klaim mutlak/memaksa — pasti/dijamin/harus beli)",
};

// ⚠️ PEMBEDAAN PENTING — `violations()` dirancang untuk membatasi DRAF AI, dan
// aturan AI TIDAK SAMA dengan aturan sales manusia. Menyamakan keduanya membuat
// laporan audit menuduh sales melanggar padahal mereka sedang mengerjakan
// pekerjaannya (menyebut harga ke pelanggan itu memang tugas sales).
// Dasar pembagian ini ada di CLAUDE.md:
//   - §16.8  "Sano TIDAK BOLEH menyebut 'garansi 20 tahun' secara flat"
//            → menyebut "Sano" (brand), berlaku untuk SIAPA PUN termasuk sales.
//   - Fase 4 "Yang TIDAK boleh dijanjikan AI ke customer: harga pasti,
//            estimasi pengiriman pasti, diskon/promo di luar KB, closing"
//            → eksplisit "AI", bukan aturan untuk sales manusia.
export const RUANG_LINGKUP_ATURAN = {
  // Pelanggaran SUNGGUHAN walau dikirim manusia: soal akurasi klaim & risiko
  // hukum/ekspektasi, bukan soal siapa yang mengetik.
  warranty: "semua",
  medical: "semua",
  certainty: "semua",
  // Tergantung konteks: bisa sah kalau sesuai paket/promo resmi yang berlaku
  // (mis. "pengerjaan 3 hari" untuk Paket Premium, atau promo resmi berjalan).
  // Ditampilkan untuk DITINJAU, bukan langsung dianggap salah.
  delivery: "perlu_tinjau",
  discount: "perlu_tinjau",
  freebie: "perlu_tinjau",
  // Aturan KHUSUS DRAF AI. Untuk sales manusia, menyebut harga = pekerjaan
  // normal. Tidak ditampilkan sebagai pelanggaran kecuali diminta eksplisit.
  price: "ai_saja",
  // "semua" di sini BUKAN karena risiko hukum (beda alasan dari
  // warranty/medical/certainty di atas) — tapi karena TIDAK ADA konteks sah
  // yang membenarkan kalimat "pasti"/"dijamin"/"harus beli"/"kasur ini
  // paling bagus"/"semua orang cocok" dari SIAPA PUN (beda dari delivery/
  // discount/freebie yang BISA sah kalau sesuai paket/promo resmi). Modul 6
  // eksplisit mengajarkan ini ke SALES manusia, bukan aturan khusus AI.
  authorityAbsolute: "semua",
};

const KETERANGAN_LINGKUP = {
  semua: "Pelanggaran sungguhan — berlaku untuk siapa pun termasuk sales manusia (akurasi klaim / risiko hukum).",
  perlu_tinjau: "Perlu ditinjau manusia — bisa SAH kalau sesuai paket atau promo resmi yang sedang berjalan. Baca kutipannya dulu.",
  ai_saja: "Aturan khusus draf AI, BUKAN pelanggaran untuk sales manusia (menyebut harga memang tugas sales). Hanya muncul kalau termasukAturanKhususAi=true.",
};

// ═══ HELPER MURNI (tanpa DB — dites di tests/mcp-chat.test.js) ══════════════

// `pesan` = array { direction, createdAt } URUT KRONOLOGIS (lama → baru).
// Semua metrik di bawah deterministik & bisa dijelaskan ke sales.
export function hitungMetrikPercakapan(pesan = [], { slaMenit = SLA_BALAS_PERTAMA_MENIT } = {}) {
  const urut = [...pesan].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const masuk = urut.filter((m) => m.direction === "INBOUND");
  const keluar = urut.filter((m) => m.direction === "OUTBOUND");

  // Giliran balas = berapa kali arah percakapan BERGANTI (I→O atau O→I).
  // Ini ukuran kedalaman dialog 2 arah — 20 pesan sepihak dari customer yang
  // tidak pernah dibalas TIDAK boleh terbaca sebagai percakapan berkualitas.
  let giliranBalas = 0;
  for (let i = 1; i < urut.length; i++) {
    if (urut[i].direction !== urut[i - 1].direction) giliranBalas++;
  }

  // Balas pertama: dari pesan INBOUND pertama ke OUTBOUND pertama SETELAHNYA.
  let balasPertamaMenit = null;
  const inboundPertama = urut.find((m) => m.direction === "INBOUND");
  if (inboundPertama) {
    const balasan = urut.find(
      (m) => m.direction === "OUTBOUND" && new Date(m.createdAt) > new Date(inboundPertama.createdAt),
    );
    if (balasan) {
      balasPertamaMenit = Math.round(
        (new Date(balasan.createdAt) - new Date(inboundPertama.createdAt)) / 60000,
      );
    }
  }

  // Rata-rata kecepatan CUSTOMER merespons balasan CS (indikator minat).
  const jedaCustomer = [];
  for (let i = 1; i < urut.length; i++) {
    if (urut[i].direction === "INBOUND" && urut[i - 1].direction === "OUTBOUND") {
      jedaCustomer.push((new Date(urut[i].createdAt) - new Date(urut[i - 1].createdAt)) / 60000);
    }
  }
  const rataBalasCustomerMenit = jedaCustomer.length
    ? Math.round(jedaCustomer.reduce((a, b) => a + b, 0) / jedaCustomer.length)
    : null;
  // Berapa KALI customer merespons balasan CS (bukan cuma "pernah" atau tidak)
  // — pembeda antara yang menjawab sekali lalu diam dengan yang benar-benar
  // terlibat bolak-balik.
  const jumlahBalasanCustomer = jedaCustomer.length;

  const terakhir = urut[urut.length - 1] || null;
  // Customer pernah membalas SETELAH CS menjawab = dialog benar-benar 2 arah.
  const pernahBalasSetelahDijawab = jedaCustomer.length > 0;
  // Ghosting: CS sudah menjawab, pesan terakhir dari CS, customer diam.
  const ghosting = Boolean(keluar.length) && terakhir?.direction === "OUTBOUND" && !pernahBalasSetelahDijawab;
  // Pola "sales balas di awal lalu hilang" (CLAUDE.md §7C): CS pernah membalas,
  // customer membalas lagi, lalu tidak pernah dijawab sampai sekarang.
  const ditinggalSetelahBalasPertama =
    Boolean(keluar.length) && terakhir?.direction === "INBOUND" && pernahBalasSetelahDijawab;

  return {
    totalPesan: urut.length,
    pesanMasuk: masuk.length,
    pesanKeluar: keluar.length,
    giliranBalas,
    balasPertamaMenit,
    slaBalasPertamaTerlampaui: balasPertamaMenit != null && balasPertamaMenit > slaMenit,
    tidakPernahDibalas: masuk.length > 0 && keluar.length === 0,
    rataBalasCustomerMenit,
    jumlahBalasanCustomer,
    pernahBalasSetelahDijawab,
    ghosting,
    ditinggalSetelahBalasPertama,
    arahPesanTerakhir: terakhir?.direction ?? null,
    waktuPesanTerakhir: terakhir?.createdAt ?? null,
  };
}

// Skor engagement 0-100 dari perilaku balas chat SAJA (bukan nilai order).
// Sengaja terpisah dari skor CRM (health/opportunity) supaya dua sudut pandang
// itu tidak saling menyamarkan: customer bisa bernilai besar tapi chatnya
// dingin, atau sebaliknya.
// KALIBRASI (dikoreksi 14 Agt 2026 setelah diuji ke data production): versi
// pertama memberi 8 poin per giliran + 25 poin sekali-balas, sehingga hampir
// semua percakapan yang pernah dibalas langsung mentok 100. Hasilnya distribusi
// terbelah dua (165 TINGGI / 0 SEDANG / 35 RENDAH) — tidak berguna untuk
// memprioritaskan siapa yang layak dikejar. Sekarang bobotnya dibuat menanjak
// supaya dialog dangkal (balas sekali lalu diam) benar-benar jatuh ke SEDANG,
// bukan ikut TINGGI bersama percakapan yang sungguh-sungguh berlanjut.
export function skorEngagement(m) {
  const alasan = [];
  let skor = 0;

  // Kedalaman dialog — butuh ~10 pergantian arah untuk poin penuh.
  const poinGiliran = Math.min(40, m.giliranBalas * 4);
  if (poinGiliran > 0) {
    skor += poinGiliran;
    alasan.push(`${m.giliranBalas} giliran balas (dialog 2 arah)`);
  }

  // Konsistensi — BERAPA KALI customer merespons, bukan sekadar pernah/tidak.
  const poinKonsistensi = Math.min(25, (m.jumlahBalasanCustomer ?? 0) * 5);
  if (poinKonsistensi > 0) {
    skor += poinKonsistensi;
    alasan.push(`Customer merespons balasan CS ${m.jumlahBalasanCustomer}x`);
  }

  if (m.rataBalasCustomerMenit != null) {
    if (m.rataBalasCustomerMenit <= 15) { skor += 20; alasan.push("Balas sangat cepat (<=15 menit)"); }
    else if (m.rataBalasCustomerMenit <= 60) { skor += 15; alasan.push("Balas cepat (<=1 jam)"); }
    else if (m.rataBalasCustomerMenit <= 360) { skor += 10; }
    else if (m.rataBalasCustomerMenit <= 24 * 60) { skor += 5; }
  }

  if (m.ghosting) {
    alasan.push("Ghosting — tidak pernah merespons balasan CS");
  } else if (m.pesanKeluar > 0) {
    skor += 15;
  }
  if (m.tidakPernahDibalas) alasan.push("Belum pernah dibalas CS sama sekali");

  skor = Math.max(0, Math.min(100, skor));
  const kategori = skor >= 65 ? "TINGGI" : skor >= 35 ? "SEDANG" : "RENDAH";
  return { skor, kategori, alasan };
}

// Ringkas daftar kategori pelanggaran jadi hitungan.
export function hitungPelanggaran(daftarKategori = []) {
  const per = {};
  for (const k of daftarKategori) per[k] = (per[k] || 0) + 1;
  return per;
}

// ═══ PENDAFTARAN TOOL ═══════════════════════════════════════════════════════

export function registerChatTools(server) {
  // 13 ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    "cari_pesan",
    {
      title: "Cari isi pesan",
      description:
        "Cari kata/frasa di SELURUH isi pesan WhatsApp lintas percakapan (bukan cuma satu percakapan). " +
        "Berguna untuk pertanyaan seperti 'chat mana yang menyebut saraf kejepit', 'siapa yang tanya " +
        "cicilan', atau mencari bukti sales menyebut harga. Bisa disaring ke arah pesan, rentang " +
        "tanggal, pelanggan, atau sales pengirim.",
      inputSchema: {
        teks: z.string().min(3).describe("Kata/frasa yang dicari (minimal 3 huruf, tidak peka huruf besar-kecil)."),
        arah: z.enum(["INBOUND", "OUTBOUND"]).optional()
          .describe("INBOUND = pesan dari pelanggan, OUTBOUND = balasan CS/sales."),
        dari: TANGGAL.optional().describe("Pesan sejak tanggal ini (WIB)."),
        sampai: TANGGAL.optional().describe("Pesan sampai tanggal ini (WIB, inklusif)."),
        customerId: z.string().optional().describe("Batasi ke satu pelanggan."),
        salesId: z.string().optional().describe("Batasi ke pesan yang dikirim sales tertentu (hanya OUTBOUND dari CRM)."),
        limit: limitParam(30),
        unmask: unmaskParam,
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const take = args.limit ?? 30;
      const where = {
        content: { contains: args.teks, mode: "insensitive" },
        ...whereTanggal(args.dari, args.sampai),
        ...(args.arah ? { direction: args.arah } : {}),
        ...(args.salesId ? { sentById: args.salesId } : {}),
        ...(args.customerId ? { conversation: { customerId: args.customerId } } : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.message.count({ where }),
        prisma.message.findMany({
          where,
          include: {
            sentBy: { select: { id: true, name: true } },
            conversation: {
              select: {
                id: true, sessionId: true,
                customer: { select: { id: true, name: true, phone: true, pipelineStage: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take,
        }),
      ]);

      const unmask = args.unmask === true;
      return hasil({
        kataKunci: args.teks,
        totalCocok: total,
        ditampilkan: rows.length,
        adaLagi: total > rows.length,
        pesan: rows.map((m) => ({
          conversationId: m.conversationId,
          arah: m.direction === "INBOUND" ? "dari_pelanggan" : "dari_cs",
          isi: m.isRevoked ? "[pesan dihapus]" : m.content,
          waktu: m.createdAt,
          dikirimOlehSales: m.sentBy?.name ?? null,
          pelanggan: m.conversation?.customer
            ? {
                id: m.conversation.customer.id,
                nama: m.conversation.customer.name,
                telepon: maskPhone(m.conversation.customer.phone, unmask),
                pipelineStage: m.conversation.customer.pipelineStage,
              }
            : null,
        })),
      });
    },
  );

  // 14 ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    "kualitas_engagement",
    {
      title: "Kualitas pelanggan dari pola balas chat",
      description:
        "Menilai SEBERAPA BERKUALITAS pelanggan dilihat dari perilaku balas chat: kedalaman dialog " +
        "2 arah (giliran balas), apakah pelanggan merespons setelah CS menjawab, kecepatan balasnya, " +
        "dan ghosting (diam setelah dijawab). Mengembalikan distribusi TINGGI/SEDANG/RENDAH untuk " +
        "seluruh yang cocok, plus daftar rinci yang JUGA memuat skor CRM (relasi & peluang beli) " +
        "supaya dua sudut pandang itu bisa dibandingkan.",
      inputSchema: {
        dari: TANGGAL.optional().describe("Percakapan dengan aktivitas sejak tanggal ini (WIB)."),
        sampai: TANGGAL.optional().describe("Sampai tanggal ini (WIB, inklusif)."),
        salesId: z.string().optional().describe("Batasi ke percakapan yang dipegang sales ini."),
        pipelineStage: z.enum(PIPELINE_STAGES).optional(),
        kategori: z.enum(["TINGGI", "SEDANG", "RENDAH"]).optional()
          .describe("Tampilkan hanya kategori ini di daftar rinci."),
        maksPelangganDiperiksa: z.number().int().min(10).max(500).optional()
          .describe("Batas percakapan yang dianalisa (10-500, default 200). Naikkan kalau perlu cakupan lebih luas."),
        limit: limitParam(20),
        unmask: unmaskParam,
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const maks = args.maksPelangganDiperiksa ?? 200;
      const take = args.limit ?? 20;

      const percakapan = await prisma.conversation.findMany({
        where: {
          type: "INDIVIDUAL",
          customerId: { not: null },
          ...whereTanggal(args.dari, args.sampai, "lastMessageAt"),
          ...(args.salesId ? { assignedToId: args.salesId } : {}),
          ...(args.pipelineStage ? { customer: { pipelineStage: args.pipelineStage } } : {}),
        },
        select: {
          id: true,
          customerId: true,
          assignedTo: { select: { name: true } },
          customer: { select: { id: true, name: true, phone: true, pipelineStage: true, orderCount: true, orderValue: true } },
          messages: {
            select: { direction: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: MAKS_PESAN_PER_PERCAKAPAN,
          },
        },
        orderBy: { lastMessageAt: "desc" },
        take: maks,
      });

      const dinilai = percakapan.map((k) => {
        const metrik = hitungMetrikPercakapan(k.messages);
        const skor = skorEngagement(metrik);
        return { k, metrik, skor };
      });

      const distribusi = { TINGGI: 0, SEDANG: 0, RENDAH: 0 };
      for (const d of dinilai) distribusi[d.skor.kategori]++;

      const terpilih = dinilai
        .filter((d) => !args.kategori || d.skor.kategori === args.kategori)
        .sort((a, b) => b.skor.skor - a.skor.skor)
        .slice(0, take);

      // Skor CRM (relasi/peluang) HANYA untuk baris yang benar-benar
      // dikembalikan — 1 query per pelanggan, jadi jangan dihitung untuk
      // seluruh kandidat.
      const rinci = await Promise.all(
        terpilih.map(async ({ k, metrik, skor }) => {
          let skorCrm = null;
          try {
            const ctx = await loadCustomerContext(prisma, k.customerId);
            if (ctx) {
              const intel = buildCustomerIntelligence(ctx);
              skorCrm = {
                relasi: { nilai: intel.health.score, kategori: intel.health.category },
                peluangBeli: intel.opportunity.score,
                urgensi: intel.priority.score,
                aksiDisarankan: intel.nextAction?.action ?? null,
              };
            }
          } catch (err) {
            console.error("[mcp] intelligence gagal:", err.message);
          }
          return {
            customerId: k.customerId,
            conversationId: k.id,
            nama: k.customer?.name ?? null,
            telepon: maskPhone(k.customer?.phone, args.unmask === true),
            pipelineStage: k.customer?.pipelineStage ?? null,
            dipegangOleh: k.assignedTo?.name ?? null,
            jumlahOrder: k.customer?.orderCount ?? 0,
            nilaiOrder: k.customer?.orderValue ?? 0,
            engagement: { ...skor, metrik },
            skorCrm,
          };
        }),
      );

      return hasil({
        periode: { dari: args.dari ?? null, sampai: args.sampai ?? null, zonaWaktu: "WIB (Asia/Jakarta)" },
        percakapanDianalisa: percakapan.length,
        batasAnalisa: maks,
        terpotong: percakapan.length >= maks,
        distribusiKualitas: distribusi,
        keterangan: {
          TINGGI: "skor engagement >= 65 — dialog 2 arah dalam, pelanggan responsif",
          SEDANG: "35-64 — ada interaksi tapi dangkal",
          RENDAH: "< 35 — sepihak, ghosting, atau belum pernah dibalas CS",
          catatan: "Skor engagement dihitung dari POLA BALAS CHAT saja. skorCrm (relasi/peluang beli) berasal dari mesin intelligence CRM yang juga memperhitungkan order & pipeline — sengaja dipisah supaya tidak saling menyamarkan.",
        },
        pelanggan: rinci,
      });
    },
  );

  // 15 ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    "audit_balasan_sales",
    {
      title: "Audit kepatuhan balasan sales",
      description:
        "Memeriksa balasan sales terhadap ATURAN PRODUK dan ATURAN ALUR Klinik Matras.\n" +
        "Aturan produk dikelompokkan menurut SIAPA yang terikat:\n" +
        "• 'pelanggaran' (berlaku untuk semua termasuk sales manusia): klaim garansi flat berangka " +
        "(CLAUDE.md §16.8 — garansi ada 2 tingkat, bukan flat 20 tahun), klaim menyembuhkan, jaminan mutlak.\n" +
        "• 'perluTinjau' (tergantung konteks): janji waktu kirim/selesai, diskon, gratis/bonus — bisa SAH " +
        "kalau sesuai paket atau promo resmi. Baca kutipannya sebelum menyimpulkan.\n" +
        "• 'aturanKhususAi' (menyebut harga): BUKAN pelanggaran untuk sales manusia — menyebut harga " +
        "memang tugas sales. Hanya ikut kalau termasukAturanKhususAi=true.\n" +
        "Aturan alur: SLA balas pertama, komplain/permintaan bicara orang yang tidak segera ditangani, " +
        "dan pola 'sales balas di awal lalu hilang'. Hasil dikelompokkan per sales beserta kutipan.",
      inputSchema: {
        dari: TANGGAL.describe("Tanggal awal periode audit (WIB, inklusif)."),
        sampai: TANGGAL.describe("Tanggal akhir periode audit (WIB, inklusif)."),
        salesId: z.string().optional().describe("Audit satu sales saja."),
        kategori: z.enum(["price", "discount", "freebie", "delivery", "warranty", "medical", "certainty"]).optional()
          .describe("Fokus ke satu kategori saja (menimpa pengelompokan default, termasuk kategori khusus AI)."),
        termasukAturanKhususAi: z.boolean().optional()
          .describe("true = ikutkan kategori yang hanya berlaku untuk draf AI (menyebut harga). Default false — supaya sales tidak terhitung melanggar saat menjalankan tugasnya."),
        slaMenit: z.number().int().min(5).max(1440).optional()
          .describe(`Ambang SLA balas pertama dalam menit (default ${SLA_BALAS_PERTAMA_MENIT}, sama dengan ambang takeover & laporan CRM).`),
        sertakanContoh: z.boolean().optional().describe("true = sertakan kutipan pesan yang melanggar (default true)."),
        maksContohPerKategori: z.number().int().min(1).max(20).optional().describe("Jumlah contoh per kategori per sales (default 3)."),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const slaMenit = args.slaMenit ?? SLA_BALAS_PERTAMA_MENIT;
      const sertakanContoh = args.sertakanContoh !== false;
      const maksContoh = args.maksContohPerKategori ?? 3;
      const rentang = whereTanggal(args.dari, args.sampai);

      // ── 1. Aturan produk: periksa isi pesan OUTBOUND ──────────────────────
      const wherePesan = {
        direction: "OUTBOUND",
        ...rentang,
        ...(args.salesId ? { sentById: args.salesId } : {}),
        // Pesan kosong/media murni tidak punya teks untuk diperiksa.
        NOT: { content: "" },
      };

      const [totalPesanKeluar, pesanKeluar] = await Promise.all([
        prisma.message.count({ where: wherePesan }),
        prisma.message.findMany({
          where: wherePesan,
          select: {
            id: true, content: true, createdAt: true, conversationId: true,
            sentBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: MAKS_PESAN_AUDIT,
        }),
      ]);

      const perSales = new Map();
      const totalPerKategori = {};
      let pesanMelanggar = 0;

      // Saring kategori sesuai ruang lingkup: kategori khusus draf AI TIDAK
      // dihitung sebagai pelanggaran sales kecuali diminta eksplisit.
      const kategoriDipakai = (k) => {
        if (args.kategori) return k === args.kategori;
        if (RUANG_LINGKUP_ATURAN[k] === "ai_saja") return args.termasukAturanKhususAi === true;
        return true;
      };

      for (const m of pesanKeluar) {
        // authorityStyleViolations digabung DI SINI (aggregasi audit),
        // BUKAN di dalam violations() itu sendiri — lihat catatan header
        // file soal kenapa 2 mesin aturan ini sengaja tidak dicampur.
        const isi = m.content || "";
        const kategoriTerdeteksi = [...violations(isi), ...authorityStyleViolations(isi)].filter(kategoriDipakai);
        if (!kategoriTerdeteksi.length) continue;
        pesanMelanggar++;

        // Pesan lama (sebelum kolom sentById ada) tidak punya pengirim —
        // dikelompokkan terpisah, JANGAN dibuang diam-diam.
        const kunci = m.sentBy?.id ?? "(tidak tercatat)";
        if (!perSales.has(kunci)) {
          perSales.set(kunci, {
            salesId: m.sentBy?.id ?? null,
            nama: m.sentBy?.name ?? "(pengirim tidak tercatat)",
            totalPelanggaran: 0,
            perKategori: {},
            contoh: [],
          });
        }
        const entri = perSales.get(kunci);
        for (const k of kategoriTerdeteksi) {
          entri.totalPelanggaran++;
          entri.perKategori[k] = (entri.perKategori[k] || 0) + 1;
          totalPerKategori[k] = (totalPerKategori[k] || 0) + 1;
          if (sertakanContoh && entri.contoh.filter((c) => c.kategori === k).length < maksContoh) {
            entri.contoh.push({
              kategori: k,
              label: LABEL_PELANGGARAN[k],
              kutipan: (m.content || "").slice(0, 300),
              waktu: m.createdAt,
              conversationId: m.conversationId,
            });
          }
        }
      }

      // ── 2. Aturan alur: SLA, komplain, ditinggal ──────────────────────────
      const percakapan = await prisma.conversation.findMany({
        where: {
          type: "INDIVIDUAL",
          ...whereTanggal(args.dari, args.sampai, "lastMessageAt"),
          ...(args.salesId ? { assignedToId: args.salesId } : {}),
        },
        select: {
          id: true,
          assignedTo: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          messages: {
            select: { direction: true, content: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: MAKS_PESAN_PER_PERCAKAPAN,
          },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 500,
      });

      const alur = {
        percakapanDiperiksa: percakapan.length,
        terlambatBalasPertama: 0,
        tidakPernahDibalas: 0,
        ditinggalSetelahBalasPertama: 0,
        komplainAtauMintaOrangTidakSegeraDitangani: 0,
      };
      const contohAlur = [];

      for (const k of percakapan) {
        const metrik = hitungMetrikPercakapan(k.messages, { slaMenit });
        if (metrik.slaBalasPertamaTerlampaui) alur.terlambatBalasPertama++;
        if (metrik.tidakPernahDibalas) alur.tidakPernahDibalas++;
        if (metrik.ditinggalSetelahBalasPertama) alur.ditinggalSetelahBalasPertama++;

        // Komplain / minta bicara orang = WAJIB manusia (INTENT_TAXONOMY
        // handoverRequired). Dihitung melanggar kalau balasannya lewat SLA
        // atau tidak pernah dibalas sama sekali.
        const teksMasuk = k.messages
          .filter((m) => m.direction === "INBOUND")
          .slice(0, 10)
          .map((m) => m.content || "")
          .join(" ");
        const intents = detectIntents(teksMasuk);
        const wajibManusia = anyHandoverRequired(intents);
        if (wajibManusia && (metrik.tidakPernahDibalas || metrik.slaBalasPertamaTerlampaui)) {
          alur.komplainAtauMintaOrangTidakSegeraDitangani++;
          if (sertakanContoh && contohAlur.length < 10) {
            contohAlur.push({
              conversationId: k.id,
              pelanggan: k.customer?.name ?? null,
              dipegangOleh: k.assignedTo?.name ?? null,
              intentWajibManusia: intents.filter((c) => INTENT_TAXONOMY[c]?.handoverRequired),
              balasPertamaMenit: metrik.balasPertamaMenit,
              tidakPernahDibalas: metrik.tidakPernahDibalas,
            });
          }
        }
      }

      const terpotong = totalPesanKeluar > pesanKeluar.length;

      // Pisahkan hitungan menurut ruang lingkup supaya pembaca tidak menjumlah
      // "pelanggaran sungguhan" dengan "aturan khusus AI" jadi satu angka besar
      // yang menyesatkan.
      const belahLingkup = (obj) => {
        const out = { semua: {}, perlu_tinjau: {}, ai_saja: {} };
        for (const [k, v] of Object.entries(obj)) out[RUANG_LINGKUP_ATURAN[k] ?? "perlu_tinjau"][k] = v;
        return out;
      };
      const terbelah = belahLingkup(totalPerKategori);
      const jumlahkan = (o) => Object.values(o).reduce((a, b) => a + b, 0);

      return hasil({
        periode: { dari: args.dari, sampai: args.sampai, zonaWaktu: "WIB (Asia/Jakarta)" },
        slaBalasPertamaMenit: slaMenit,
        aturanProduk: {
          pesanKeluarDiperiksa: pesanKeluar.length,
          totalPesanKeluarPeriode: totalPesanKeluar,
          terpotong,
          pesanKenaSorot: pesanMelanggar,
          persenPesanKenaSorot: pesanKeluar.length
            ? Number(((pesanMelanggar / pesanKeluar.length) * 100).toFixed(1))
            : 0,
          // Dipisah menurut siapa yang terikat aturannya — lihat RUANG_LINGKUP_ATURAN.
          pelanggaran: { jumlah: jumlahkan(terbelah.semua), perKategori: terbelah.semua, arti: KETERANGAN_LINGKUP.semua },
          perluTinjau: { jumlah: jumlahkan(terbelah.perlu_tinjau), perKategori: terbelah.perlu_tinjau, arti: KETERANGAN_LINGKUP.perlu_tinjau },
          aturanKhususAi: {
            disertakan: args.termasukAturanKhususAi === true || Boolean(args.kategori),
            jumlah: jumlahkan(terbelah.ai_saja),
            perKategori: terbelah.ai_saja,
            arti: KETERANGAN_LINGKUP.ai_saja,
          },
          labelKategori: LABEL_PELANGGARAN,
          ruangLingkupKategori: RUANG_LINGKUP_ATURAN,
          perSales: [...perSales.values()].sort((a, b) => b.totalPelanggaran - a.totalPelanggaran),
        },
        aturanAlur: { ...alur, contoh: contohAlur },
        catatan: [
          terpotong
            ? `HANYA ${pesanKeluar.length} dari ${totalPesanKeluar} pesan keluar yang diperiksa (batas ${MAKS_PESAN_AUDIT}). Angka di atas BUKAN total periode — persempit rentang tanggal untuk hasil yang utuh.`
            : "Seluruh pesan keluar pada periode ini diperiksa.",
          percakapan.length >= 500
            ? "Pemeriksaan alur dibatasi 500 percakapan terbaru pada periode ini."
            : null,
          "Deteksi berbasis pola teks — SELALU baca kutipannya sebelum menyimpulkan, apalagi sebelum menegur orang. Contoh false positive: sales menyalin ulang kalimat pelanggan, atau menyebut promo yang memang resmi berjalan.",
          args.termasukAturanKhususAi === true
            ? "termasukAturanKhususAi=true — kategori 'menyebut harga' ikut dihitung. Untuk sales manusia ini biasanya BUKAN pelanggaran."
            : "Kategori 'menyebut harga' (aturan khusus draf AI) TIDAK dihitung sebagai pelanggaran sales. Set termasukAturanKhususAi=true kalau memang ingin melihatnya.",
        ].filter(Boolean),
      });
    },
  );

  // 16 ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    "diagnosa_percakapan",
    {
      title: "Diagnosa satu percakapan",
      description:
        "Bedah SATU percakapan pesan-per-pesan: pelanggaran aturan produk di tiap balasan sales, " +
        "jeda respons antar pesan, dan intent pelanggan yang terdeteksi. Termasuk ringkasan " +
        "kepatuhan (SLA balas pertama, apakah ada komplain/permintaan bicara orang dan bagaimana " +
        "penanganannya) serta metrik engagement pelanggan. Pakai ini untuk menjawab 'apa yang salah " +
        "di percakapan ini'.",
      inputSchema: {
        conversationId: z.string().describe("ID percakapan dari daftar_percakapan / cari_pesan / detail_pelanggan."),
        slaMenit: z.number().int().min(5).max(1440).optional()
          .describe(`Ambang SLA balas pertama (default ${SLA_BALAS_PERTAMA_MENIT}).`),
        limit: limitParam(100),
        unmask: unmaskParam,
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const slaMenit = args.slaMenit ?? SLA_BALAS_PERTAMA_MENIT;
      const percakapan = await prisma.conversation.findUnique({
        where: { id: args.conversationId },
        include: {
          customer: { select: { id: true, name: true, phone: true, pipelineStage: true } },
          assignedTo: { select: { name: true } },
          firstResponder: { select: { name: true } },
        },
      });
      if (!percakapan) return hasil({ error: "Percakapan tidak ditemukan." });

      const pesanDesc = await prisma.message.findMany({
        where: { conversationId: args.conversationId },
        include: { sentBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: args.limit ?? 100,
      });
      const pesan = [...pesanDesc].reverse(); // kronologis untuk membaca alur

      const metrik = hitungMetrikPercakapan(pesan, { slaMenit });
      const totalPerKategori = {};
      const timeline = pesan.map((m, i) => {
        const isi = m.isRevoked ? "" : m.content || "";
        const pelanggaran = m.direction === "OUTBOUND" ? violations(isi) : [];
        for (const k of pelanggaran) totalPerKategori[k] = (totalPerKategori[k] || 0) + 1;
        const sebelumnya = pesan[i - 1];
        return {
          urutan: i + 1,
          arah: m.direction === "INBOUND" ? "dari_pelanggan" : "dari_cs",
          isi: m.isRevoked ? "[pesan dihapus]" : m.content,
          waktu: m.createdAt,
          jedaDariPesanSebelumnyaMenit: sebelumnya
            ? Math.round((new Date(m.createdAt) - new Date(sebelumnya.createdAt)) / 60000)
            : null,
          dikirimOlehSales: m.sentBy?.name ?? null,
          pelanggaranAturan: pelanggaran.map((k) => ({
            kategori: k,
            label: LABEL_PELANGGARAN[k],
            berlakuUntuk: RUANG_LINGKUP_ATURAN[k],
          })),
          intentTerdeteksi: m.direction === "INBOUND" ? detectIntents(isi) : [],
        };
      });

      const semuaIntentMasuk = [
        ...new Set(pesan.filter((m) => m.direction === "INBOUND").flatMap((m) => detectIntents(m.content || ""))),
      ];
      const intentWajibManusia = semuaIntentMasuk.filter((c) => INTENT_TAXONOMY[c]?.handoverRequired);

      return hasil({
        percakapan: {
          id: percakapan.id,
          status: percakapan.status,
          channel: percakapan.channel,
          sesiWa: percakapan.sessionId,
          dipegangOleh: percakapan.assignedTo?.name ?? null,
          perespondPertama: percakapan.firstResponder?.name ?? null,
          pelanggan: percakapan.customer
            ? {
                id: percakapan.customer.id,
                nama: percakapan.customer.name,
                telepon: maskPhone(percakapan.customer.phone, args.unmask === true),
                pipelineStage: percakapan.customer.pipelineStage,
              }
            : null,
        },
        ringkasanKepatuhan: {
          slaBalasPertamaMenit: slaMenit,
          balasPertamaMenit: metrik.balasPertamaMenit,
          slaTerlampaui: metrik.slaBalasPertamaTerlampaui,
          tidakPernahDibalas: metrik.tidakPernahDibalas,
          ditinggalSetelahBalasPertama: metrik.ditinggalSetelahBalasPertama,
          totalTemuanAturanProduk: Object.values(totalPerKategori).reduce((a, b) => a + b, 0),
          temuanPerKategori: totalPerKategori,
          // Berapa yang benar-benar pelanggaran untuk sales manusia (bukan
          // aturan khusus draf AI seperti "menyebut harga").
          pelanggaranBerlakuUntukSales: Object.entries(totalPerKategori)
            .filter(([k]) => RUANG_LINGKUP_ATURAN[k] === "semua")
            .reduce((a, [, v]) => a + v, 0),
          labelKategori: LABEL_PELANGGARAN,
          ruangLingkupKategori: RUANG_LINGKUP_ATURAN,
          artiRuangLingkup: KETERANGAN_LINGKUP,
          intentPelangganTerdeteksi: semuaIntentMasuk,
          intentWajibDitanganiManusia: intentWajibManusia,
          adaKewajibanHandover: intentWajibManusia.length > 0,
        },
        engagementPelanggan: { ...skorEngagement(metrik), metrik },
        jumlahPesanDianalisa: pesan.length,
        timeline,
      });
    },
  );
}
