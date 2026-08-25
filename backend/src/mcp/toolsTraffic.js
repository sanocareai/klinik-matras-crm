// Tool MCP untuk TRAFFIC & IKLAN — tren lead masuk dan performa per sumber /
// per kreatif iklan.
//
// ⚠️ READ-ONLY. `$queryRaw` di file ini HANYA SELECT (agregat), tidak pernah
// menulis. Aturan lengkap ada di toolsShared.js.
//
// ⚠️ KENAPA TIDAK MEMAKAI TrackedLink/ClickEvent: diverifikasi langsung ke
// database production (14 Agt 2026) — TrackedLink 0 baris, ClickEvent 0 baris.
// Fitur link pelacakan tidak pernah dipakai, jadi tool yang bersandar padanya
// akan selalu kosong dan menyesatkan. Sumber atribusi yang BENAR-BENAR terisi:
//   - Customer.leadSource  (META_ADS 1249, WHATSAPP_DIRECT 1007, WEBSITE_ORGANIC
//                           267, GOOGLE_ADS 19, INSTAGRAM 9)
//   - Customer.ctwaClid / ctwaSourceUrl (Click-to-WhatsApp Meta) — atribusi
//     PER-KREATIF, tapi baru aktif 13 Agt 2026 sehingga cakupannya masih
//     sebagian. Tool WAJIB menyatakan cakupan ini di outputnya; menyajikan
//     angka parsial tanpa keterangan = menyesatkan pengambil keputusan iklan.
//
// ⚠️ TIMEZONE: seluruh pengelompokan harian/jam WAJIB digeser ke WIB dengan
// `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'` (CLAUDE.md §11). Tanpa itu
// lead jam 00:00–07:00 WIB masuk ke bucket HARI SEBELUMNYA — bug kelas ini
// pernah NYATA di routes/analytics.js.

import { z } from "zod";
import { prisma } from "../db.js";
import { LEAD_SOURCE, TANGGAL, whereTanggal, batasTanggal, hasil, ANOTASI_BACA } from "./toolsShared.js";

const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function registerTrafficTools(server) {
  // 17 ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    "tren_traffic_lead",
    {
      title: "Tren traffic lead masuk",
      description:
        "Tren HARIAN jumlah lead (pelanggan baru) yang masuk pada suatu periode, plus pola jam & hari " +
        "tersibuk, dan pembanding terhadap periode sebelumnya yang sama panjang. Menjawab pertanyaan " +
        "seperti 'hari apa lead paling ramai', 'apakah traffic naik dibanding bulan lalu', 'jam berapa " +
        "chat masuk paling banyak'. Semua pengelompokan memakai kalender WIB.",
      inputSchema: {
        dari: TANGGAL.describe("Tanggal awal (WIB, inklusif)."),
        sampai: TANGGAL.describe("Tanggal akhir (WIB, inklusif)."),
        sumberLead: z.enum(LEAD_SOURCE).optional().describe("Batasi ke satu sumber lead saja."),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const { mulai, selesai } = batasTanggal(args.dari, args.sampai);
      const panjangMs = selesai - mulai;
      const sebelumMulai = new Date(mulai.getTime() - panjangMs);
      const filterSumber = args.sumberLead ?? null;

      const [harian, jamHari, periodeIni, periodeSebelum] = await Promise.all([
        prisma.$queryRaw`
          SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS tanggal,
                 COUNT(*)::int AS jumlah
          FROM "Customer"
          WHERE "createdAt" >= ${mulai} AND "createdAt" < ${selesai}
            AND (${filterSumber}::text IS NULL OR "leadSource"::text = ${filterSumber})
          GROUP BY 1 ORDER BY 1`,
        prisma.$queryRaw`
          SELECT EXTRACT(dow  FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::int AS hari,
                 EXTRACT(hour FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::int AS jam,
                 COUNT(*)::int AS jumlah
          FROM "Customer"
          WHERE "createdAt" >= ${mulai} AND "createdAt" < ${selesai}
            AND (${filterSumber}::text IS NULL OR "leadSource"::text = ${filterSumber})
          GROUP BY 1, 2`,
        prisma.customer.count({
          where: { ...whereTanggal(args.dari, args.sampai), ...(filterSumber ? { leadSource: filterSumber } : {}) },
        }),
        prisma.customer.count({
          where: {
            createdAt: { gte: sebelumMulai, lt: mulai },
            ...(filterSumber ? { leadSource: filterSumber } : {}),
          },
        }),
      ]);

      // Agregasi pola jam & hari dari hasil mentah.
      const perHari = {};
      const perJam = {};
      for (const r of jamHari) {
        perHari[NAMA_HARI[r.hari]] = (perHari[NAMA_HARI[r.hari]] || 0) + r.jumlah;
        perJam[r.jam] = (perJam[r.jam] || 0) + r.jumlah;
      }
      const jamTersibuk = Object.entries(perJam)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([jam, jumlah]) => ({ jamWIB: Number(jam), jumlah }));
      const hariTersibuk = Object.entries(perHari)
        .sort((a, b) => b[1] - a[1])
        .map(([hari, jumlah]) => ({ hari, jumlah }));

      const puncak = harian.reduce((a, r) => (!a || r.jumlah > a.jumlah ? r : a), null);
      const rataHarian = harian.length
        ? Number((harian.reduce((s, r) => s + r.jumlah, 0) / harian.length).toFixed(1))
        : 0;

      return hasil({
        periode: { dari: args.dari, sampai: args.sampai, zonaWaktu: "WIB (Asia/Jakarta)" },
        sumberLead: filterSumber ?? "semua",
        totalLead: periodeIni,
        perbandinganPeriodeSebelumnya: {
          jumlahSebelumnya: periodeSebelum,
          selisih: periodeIni - periodeSebelum,
          persen: periodeSebelum ? Number((((periodeIni - periodeSebelum) / periodeSebelum) * 100).toFixed(1)) : null,
        },
        rataRataPerHari: rataHarian,
        hariPuncak: puncak ? { tanggal: puncak.tanggal, jumlah: puncak.jumlah } : null,
        deretHarian: harian,
        polaHari: hariTersibuk,
        jamTersibuk,
      });
    },
  );

  // 18 ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    "performa_iklan",
    {
      title: "Performa iklan per sumber & per kreatif",
      description:
        "Performa akuisisi per SUMBER LEAD (META_ADS, GOOGLE_ADS, WEBSITE_ORGANIC, dst) — jumlah lead, " +
        "berapa yang jadi order, conversion rate, dan total nilai order — PLUS rincian per KREATIF " +
        "iklan Meta (URL post Instagram/Facebook dari atribusi Click-to-WhatsApp). Menjawab 'iklan " +
        "mana yang benar-benar menghasilkan penjualan, bukan cuma ramai chat'. " +
        "CATATAN PENTING: atribusi per-kreatif hanya tersedia untuk lead yang membawa data CTWA " +
        "(aktif sejak 13 Agustus 2026), jadi cakupannya sebagian — lihat field cakupanCtwa di hasil. " +
        "`lead`/jumlah TERMASUK chat SPAM/junk (lihat spamRate per baris) — sengaja tidak dibuang " +
        "supaya iklan bertargeting buruk tetap kelihatan buruk, bukan tersembunyi di balik penyebut " +
        "yang sudah disaring.",
      inputSchema: {
        dari: TANGGAL.optional().describe("Lead yang masuk sejak tanggal ini (WIB). Kosong = sepanjang waktu."),
        sampai: TANGGAL.optional().describe("Sampai tanggal ini (WIB, inklusif)."),
        hanyaDikonfirmasi: z.boolean().optional()
          .describe("true = hanya lead yang sumbernya sudah dikoreksi/dikonfirmasi manual oleh sales (leadSourceConfirmed)."),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const rentang = whereTanggal(args.dari, args.sampai);
      const { mulai, selesai } = batasTanggal(args.dari, args.sampai);
      const whereDasar = {
        ...rentang,
        ...(args.hanyaDikonfirmasi ? { leadSourceConfirmed: true } : {}),
      };

      const [perSumber, perSumberOrder, perSumberSpam, totalLead, totalPunyaCtwa, perKreatif] = await Promise.all([
        prisma.customer.groupBy({
          by: ["leadSource"],
          where: whereDasar,
          _count: true,
          _sum: { orderValue: true },
        }),
        prisma.customer.groupBy({
          by: ["leadSource"],
          where: { ...whereDasar, orderCount: { gt: 0 } },
          _count: true,
        }),
        // SPAM SENGAJA TIDAK dikecualikan dari `lead` di atas (25 Agustus
        // 2026) — sama seperti /source-performance & ringkasan_sumber_lead:
        // ini metrik kualitas channel, bukan performa sales. spamRate
        // diekspos terpisah sebagai diagnostik, bukan dibuang dari penyebut.
        prisma.customer.groupBy({
          by: ["leadSource"],
          where: { ...whereDasar, pipelineStage: "SPAM" },
          _count: true,
        }),
        prisma.customer.count({ where: whereDasar }),
        prisma.customer.count({ where: { ...whereDasar, ctwaClid: { not: null } } }),
        // Per kreatif iklan Meta. Agregat langsung di SQL supaya tidak menarik
        // ribuan baris customer ke memori hanya untuk dikelompokkan di JS.
        prisma.$queryRaw`
          SELECT "ctwa_source_url" AS kreatif,
                 COUNT(*)::int AS lead,
                 COUNT(*) FILTER (WHERE "orderCount" > 0)::int AS jadi_order,
                 COUNT(*) FILTER (WHERE "pipelineStage" = 'SPAM')::int AS spam,
                 COALESCE(SUM("orderValue"), 0)::bigint AS nilai_order
          FROM "Customer"
          WHERE "ctwa_clid" IS NOT NULL
            AND "createdAt" >= ${mulai} AND "createdAt" < ${selesai}
          GROUP BY 1
          ORDER BY 2 DESC
          LIMIT 50`,
      ]);

      const petaOrder = Object.fromEntries(perSumberOrder.map((r) => [String(r.leadSource), r._count]));
      const petaSpam = Object.fromEntries(perSumberSpam.map((r) => [String(r.leadSource), r._count]));
      const sumber = perSumber
        .map((r) => {
          const kunci = String(r.leadSource);
          const jadiOrder = petaOrder[kunci] ?? 0;
          const spam = petaSpam[kunci] ?? 0;
          return {
            sumberLead: r.leadSource ?? "BELUM_DIISI",
            lead: r._count,
            jadiOrder,
            conversionRate: r._count ? Number(((jadiOrder / r._count) * 100).toFixed(1)) : 0,
            spam,
            spamRate: r._count ? Number(((spam / r._count) * 100).toFixed(1)) : 0,
            totalNilaiOrder: Number(r._sum.orderValue ?? 0),
          };
        })
        .sort((a, b) => b.lead - a.lead);

      const kreatif = perKreatif.map((r) => ({
        urlKreatif: r.kreatif ?? "(URL tidak tercatat)",
        lead: r.lead,
        jadiOrder: r.jadi_order,
        conversionRate: r.lead ? Number(((r.jadi_order / r.lead) * 100).toFixed(1)) : 0,
        spam: r.spam,
        spamRate: r.lead ? Number(((r.spam / r.lead) * 100).toFixed(1)) : 0,
        totalNilaiOrder: Number(r.nilai_order),
      }));

      const leadMetaAds = sumber.find((s) => s.sumberLead === "META_ADS")?.lead ?? 0;

      return hasil({
        periode: { dari: args.dari ?? null, sampai: args.sampai ?? null, zonaWaktu: "WIB (Asia/Jakarta)" },
        totalLead,
        perSumberLead: sumber,
        perKreatifIklanMeta: kreatif,
        cakupanCtwa: {
          leadPunyaDataCtwa: totalPunyaCtwa,
          leadMetaAdsTotal: leadMetaAds,
          persenMetaAdsTerlacakKreatif: leadMetaAds
            ? Number(((totalPunyaCtwa / leadMetaAds) * 100).toFixed(1))
            : null,
          keterangan:
            "Atribusi per-kreatif hanya ada untuk lead yang membawa Click-to-WhatsApp ID dari Meta " +
            "(aktif sejak 13 Agustus 2026). Lead META_ADS di luar itu TIDAK bisa dipetakan ke kreatif " +
            "tertentu — jangan simpulkan kreatif yang tidak muncul di daftar berarti tidak menghasilkan.",
        },
        catatan: [
          "TrackedLink (link pelacakan manual) TIDAK dipakai di laporan ini karena belum pernah dibuat satu pun di production — kalau nanti mulai dipakai, tool ini perlu diperluas.",
          "totalNilaiOrder memakai Customer.orderValue (denormalized, sudah mengecualikan order CANCELLED — lihat schema.prisma).",
        ],
      });
    },
  );
}
