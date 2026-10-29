// Tool MCP untuk LAPORAN META ADS (campaign → ad set → ad) — hasil atribusi CTWA yang SUDAH LIVE dipakai halaman Laporan/Akuisisi,
// bukan tracking kedua.
//
// ⚠️ READ-ONLY. File ini TIDAK menyentuh DB langsung: semua perhitungan lewat services/attribution/laporanMeta.js, yang memanggil service atribusi
// yang SAMA dengan GET /api/atribusi/iklan (hitungLaporanIklan) di dalam transaksi READ ONLY milik service itu. Aturan lengkap ada di toolsShared.js.
//
// ⚠️ BEDA DENGAN `performa_iklan` (legacy, toolsTraffic.js): tool lama mengelompokkan Customer.ctwaSourceUrl (URL kreatif/postingan) dan menghitung
// "jadi order" dari orderCount > 0. Itu BUKAN atribusi kausal, TIDAK mengenal campaign/ad set, dan satu postingan bisa dipakai di banyak campaign.
// Tool di file ini memakai touch akuisisi kausal (CTWA_AD) + referensi Ad → Ad Set → Campaign + ledger pembayaran + spend.
//
// ⚠️ Respons hanya agregat dan ID/nama iklan: tanpa nama, nomor, email, percakapan, atau ID customer/order.
import { z } from "zod";
import { prisma } from "../db.js";
import { TANGGAL, hasil, ANOTASI_BACA } from "./toolsShared.js";
import { ParameterError, laporanPerforma, rekapHarian, kesehatanAtribusi, DAFTAR_KRITERIA, MAKS_HARI_REKAP, BATAS_BARIS_MAKS } from "../services/attribution/laporanMeta.js";
import { SedangDihitungError } from "../services/attribution/penjagaLaporan.js";

const ID_META = z.string().regex(/^\d{5,32}$/, "ID Meta harus string digit (5-32 angka)");

function galat(pesan, kode) {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ galat: pesan, kode }, null, 2) }] };
}

// Galat parameter/sibuk → pesan jelas untuk model; galat lain → log tanpa pesan (galat Prisma bisa memuat nilai kueri) dan pesan generik.
async function jalankan(fn) {
  try {
    return hasil(await fn());
  } catch (err) {
    if (err instanceof ParameterError || err instanceof SedangDihitungError) return galat(err.message, err.code);
    console.error("[mcp] laporan meta ads error:", err?.code || err?.name || "ERROR");
    return galat("Gagal menghitung laporan Meta Ads; coba lagi atau persempit periode", "GAGAL_HITUNG");
  }
}

export function registerAtribusiIklanTools(server) {
  // 1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "performa_campaign_meta",
    {
      title: "Performa campaign / ad set / ad Meta Ads (atribusi CTWA)",
      description:
        "Laporan hasil iklan Meta per CAMPAIGN, AD SET atau AD dari atribusi CTWA yang sama dengan halaman Laporan SANSS: lead akuisisi terbukti, spam, " +
        "customer unik ber-order, customer unik pernah membayar, customer unik LUNAS terbukti ledger (closing utama), nilai order, uang ledger bersih " +
        "(setelah refund), spend, CPA lunas, Booked ROAS, Cash ROAS, dan 'nilai order setelah biaya iklan' (bukan laba). Baris diperingkat menurut `urutkan`. " +
        "Periode = tanggal LEAD (WIB); hasil order/pembayaran dihitung sampai waktu snapshot (lihat `snapshot`), jadi lead muda masih bertambah. " +
        "ATURAN BACA: (1) closing utama = customer lunas ledger; ber-order ≠ lunas. (2) Baris UNMAPPED (Ad ID belum dipetakan) dan UNKNOWN selalu tampil terpisah dan " +
        "tidak diperingkat — jangan dialokasikan ke campaign. (3) Reaktivasi (customer lama klik iklan lagi) dipisah, bukan lead. (4) Nilai null berarti TIDAK dapat dihitung " +
        "(lihat alasanNull: BELUM_ADA_SPEND, SPEND_TIDAK_LENGKAP, HARI_BERJALAN_PARSIAL, SEBELUM_ATRIBUSI, BELUM_ADA_KONVERSI) — bukan 0. " +
        "(5) Atribusi baru tersimpan sejak awal Okt 2026 (atribusiMulaiWib); lead sebelumnya tidak punya touch. (6) Tidak ada alokasi berdasarkan URL kreatif. " +
        "Untuk drilldown: level=adset dengan campaignId, atau level=ad dengan adSetId/campaignId. Batas rentang 93 hari; kosongkan dari/sampai untuk 7 hari penuh terakhir (berakhir kemarin).",
      inputSchema: {
        dari: TANGGAL.optional().describe("Tanggal lead awal (WIB, inklusif). Isi bersama `sampai`; kosong keduanya = 7 hari penuh berakhir kemarin."),
        sampai: TANGGAL.optional().describe("Tanggal lead akhir (WIB, inklusif, tidak boleh di masa depan)."),
        level: z.enum(["campaign", "adset", "ad"]).optional().describe("Tingkat baris. Default campaign."),
        urutkan: z.enum(DAFTAR_KRITERIA).optional()
          .describe("Kriteria peringkat, terbaik dulu. Default customer_lunas_ledger. cpa_lunas: terendah = terbaik. Metrik KPI yang null tidak diperingkat."),
        batas: z.number().int().min(1).max(BATAS_BARIS_MAKS).optional().describe(`Jumlah baris terpetakan yang ditampilkan (default 20, maks ${BATAS_BARIS_MAKS}). Total tetap mencakup semua baris.`),
        campaignId: ID_META.optional().describe("Drilldown ke satu campaign (hanya level adset/ad). ID Meta, jangan ditebak."),
        adSetId: ID_META.optional().describe("Drilldown ke satu ad set (hanya level ad). ID Meta, jangan ditebak."),
      },
      annotations: ANOTASI_BACA,
    },
    (args) => jalankan(() => laporanPerforma(prisma, args)),
  );

  // 2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "rekap_harian_meta",
    {
      title: "Rekap harian Meta Ads + akumulasi periode (kohort akuisisi)",
      description:
        "Rekap HARIAN hasil iklan Meta dan akumulasi periodenya, dari atribusi CTWA yang sama dengan halaman Laporan. Tampilan = KOHORT AKUISISI: baris tanggal D berisi lead " +
        "yang masuk pada D beserta hasil order/pembayaran mereka SAMPAI waktu snapshot (umurKohortHari menunjukkan umur kohort; kohort muda belum matang). Ini BUKAN aktivitas " +
        "kalender: pembayaran hari ini dari lead lama tidak muncul di baris hari ini. Akumulasi dihitung ULANG dari data sumber atas seluruh periode (customer unik periode), tidak " +
        "dijumlahkan dari angka/persentase harian; `pemeriksaanAditif` membuktikan hitungan harian = akumulasi. KPI (CPA, ROAS) tidak pernah dijumlahkan. " +
        "statusHari: PENUH / HARI_BERJALAN (spend belum final → KPI null) / HARI_ATRIBUSI_PARSIAL / SEBELUM_ATRIBUSI (0 lead di sini = atribusi belum ada, bukan performa nol). " +
        `Maks ${MAKS_HARI_REKAP} hari per panggilan. Isi campaignId untuk rekap satu campaign.`,
      inputSchema: {
        dari: TANGGAL.optional().describe("Tanggal lead awal (WIB, inklusif). Kosong keduanya = 7 hari penuh berakhir kemarin."),
        sampai: TANGGAL.optional().describe("Tanggal lead akhir (WIB, inklusif)."),
        campaignId: ID_META.optional().describe("Batasi ke satu campaign (ID Meta)."),
      },
      annotations: ANOTASI_BACA,
    },
    (args) => jalankan(() => rekapHarian(prisma, args)),
  );

  // 3 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "kesehatan_atribusi_meta",
    {
      title: "Kesehatan & coverage atribusi + spend Meta Ads",
      description:
        "Apakah laporan Meta Ads layak dipercaya untuk periode ini? Mengembalikan: kesehatan capture touch (aktif, usia touch terbaru, kegagalan), cakupan atribusi (berapa lead " +
        "baru punya touch akuisisi terbukti, UNMAPPED, UNKNOWN, tanpa touch), kesehatan spend (tanggal spend terakhir, hari hilang, hari berjalan, spend UNMAPPED, impor terakhir), " +
        "cakupan ledger pembayaran, dan kesiapan KPI (kapan CPA/ROAS boleh dibaca). `periksaLintasLevel=true` juga membuktikan campaign = Σ ad set = Σ ad untuk metrik aditif " +
        "pada snapshot yang sama (tiga perhitungan penuh, lebih lambat). Tidak berisi data customer. Gunakan sebelum menyimpulkan performa iklan, terutama bila CPA/ROAS null.",
      inputSchema: {
        dari: TANGGAL.optional().describe("Tanggal lead awal (WIB). Kosong keduanya = 7 hari penuh berakhir kemarin."),
        sampai: TANGGAL.optional().describe("Tanggal lead akhir (WIB, inklusif)."),
        periksaLintasLevel: z.boolean().optional().describe("true = rekonsiliasi campaign ↔ ad set ↔ ad (3x perhitungan)."),
      },
      annotations: ANOTASI_BACA,
    },
    (args) => jalankan(() => kesehatanAtribusi(prisma, args)),
  );
}
