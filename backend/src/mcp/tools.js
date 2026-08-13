// Definisi tool MCP — SEMUANYA READ-ONLY.
//
// ⚠️ ATURAN MUTLAK FILE INI (jangan dilanggar, jangan "sekalian"):
//   1. HANYA operasi baca Prisma: findMany / findUnique / findFirst /
//      aggregate / groupBy / count. TIDAK ADA create/update/delete/upsert/
//      $executeRaw. Tool yang menulis harus lewat UI CRM atau API biasa yang
//      punya JWT user + jejak audit — MCP tidak punya keduanya.
//   2. TIDAK ADA pengiriman pesan WhatsApp. Jangan pernah import wahaClient.js
//      di sini. Salah kirim pesan ke pelanggan tidak bisa dibatalkan.
//   3. Nomor HP & email pelanggan DEFAULT disamarkan (lihat security.js).
//      Setiap tool yang mengembalikan kontak wajib punya param `unmask`.
//
// Konteks: Klinik Matras CRM. Deskripsi tool ditulis Bahasa Indonesia supaya
// konsisten dengan sisa produk dan supaya istilah bisnis (pipeline stage,
// kategori order, keluhan) tidak salah diterjemahkan oleh model.

import { z } from "zod";
import { prisma } from "../db.js";
import { maskPhone, maskEmail } from "./security.js";
// Batas tanggal WIB — WAJIB. Container backend jalan di UTC; `new Date(y,m,d)`
// menggeser seluruh jendela laporan 7 jam (lihat utils/wib.js & CLAUDE.md §11).
import {
  startOfDayWIB,
  endOfDayExclusiveWIB,
  startOfMonthWIB,
  endOfMonthExclusiveWIB,
  nowPartsWIB,
} from "../utils/wib.js";

// ─── HELPER ─────────────────────────────────────────────────────────────────

const TANGGAL = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");

const PIPELINE_STAGES = ["NEW", "QUALIFIED", "QUOTED", "BOOKED", "SCHEDULED", "COMPLETED", "REVIEWED"];
const ORDER_STATUS = ["PENDING", "PICKUP", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];
const ORDER_CATEGORY = ["LAYANAN", "SEWA", "BARU"];
const PAYMENT_STATUS = ["BELUM_BAYAR", "DP", "LUNAS"];
const LEAD_SOURCE = [
  "META_ADS", "GOOGLE_ADS", "WEBSITE_ORGANIC", "INSTAGRAM",
  "WHATSAPP_DIRECT", "REFERRAL", "OTHER", "ADS", "WEBSITE",
];

const unmaskParam = z
  .boolean()
  .optional()
  .describe("true = tampilkan nomor HP & email pelanggan LENGKAP (tanpa masking). Default false.");

const limitParam = (bawaan) =>
  z.number().int().min(1).max(100).optional().describe(`Jumlah baris (1-100, default ${bawaan}).`);

const offsetParam = z.number().int().min(0).optional().describe("Lewati N baris pertama (paginasi).");

// Rentang tanggal WIB → batas instant UTC. `to` EKSKLUSIF (awal hari
// berikutnya), bukan 23:59:59 — lihat utils/wib.js kenapa.
function whereTanggal(from, to, field = "createdAt") {
  if (!from && !to) return {};
  const w = {};
  if (from) w.gte = startOfDayWIB(from);
  if (to) w.lt = endOfDayExclusiveWIB(to);
  return { [field]: w };
}

// Bentuk ringkas pelanggan — dipakai di semua daftar supaya konsisten.
function ringkasPelanggan(c, unmask) {
  return {
    id: c.id,
    nama: c.name,
    telepon: maskPhone(c.phone, unmask),
    email: maskEmail(c.email, unmask),
    instagram: c.instagramHandle,
    kota: c.city,
    tags: c.tags,
    pipelineStage: c.pipelineStage,
    tipePelanggan: c.customerType,
    statusKesehatan: c.healthStatus,
    sumberLead: c.leadSource,
    detailSumberLead: c.leadSourceDetail,
    sumberLeadDikonfirmasi: c.leadSourceConfirmed,
    // Atribusi Click-to-WhatsApp Meta — berguna untuk pertanyaan "kreatif
    // iklan mana yang menghasilkan lead ini". Bukan PII pelanggan.
    ctwaClickId: c.ctwaClid,
    ctwaUrlSumber: c.ctwaSourceUrl,
    salesPenanggungJawab: c.assignedSales?.name ?? null,
    salesPenanggungJawabId: c.assignedSalesId,
    jumlahOrder: c.orderCount,
    nilaiOrder: c.orderValue,
    dibuatPada: c.createdAt,
  };
}

function ringkasOrder(o) {
  return {
    id: o.id,
    nomorOrder: o.orderNumber,
    pelangganId: o.customerId,
    namaPelanggan: o.customer?.name ?? null,
    status: o.status,
    statusDikunciManual: o.statusLocked,
    statusPembayaran: o.paymentStatus,
    kategori: o.category,
    nilai: o.value,
    jumlah: o.quantity,
    catatan: o.notes,
    adaKomplain: o.hasComplaint,
    tanggalKomplain: o.complaintDate,
    detailKomplain: o.complaintDetail,
    dibuatPada: o.createdAt,
    diperbaruiPada: o.updatedAt,
    ...(o.items
      ? {
          layanan: o.items.map((i) => ({ nama: i.layananName, harga: i.harga })),
          totalLayanan: o.items.reduce((s, i) => s + i.harga, 0),
        }
      : {}),
    ...(o.weightEntries
      ? { beratBadan: o.weightEntries.map((w) => ({ label: w.label, kg: w.beratKg })) }
      : {}),
  };
}

// Semua tool mengembalikan JSON sebagai teks. Sengaja tidak pakai
// structuredContent/outputSchema — bentuk datanya sering berubah mengikuti
// schema CRM, dan skema keluaran yang ketat cuma jadi beban pemeliharaan.
function hasil(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// Anotasi seragam: readOnlyHint memberi tahu klien MCP bahwa tool ini tidak
// pernah mengubah apa pun, jadi boleh dipanggil tanpa konfirmasi user.
const ANOTASI_BACA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// ─── PENDAFTARAN TOOL ───────────────────────────────────────────────────────

export function registerReadOnlyTools(server) {
  // 1 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "cari_pelanggan",
    {
      title: "Cari pelanggan",
      description:
        "Cari pelanggan CRM Klinik Matras dengan berbagai filter (nama/nomor, kota, pipeline stage, " +
        "tipe pelanggan, sumber lead, nilai order). Mengembalikan daftar ringkas + total yang cocok. " +
        "Nomor HP disamarkan kecuali unmask=true.",
      inputSchema: {
        q: z.string().optional().describe("Kata kunci: cocokkan ke nama, nomor HP, email, atau handle Instagram."),
        kota: z.string().optional().describe("Filter kota persis, mis. 'Jakarta Selatan'."),
        pipelineStage: z.enum(PIPELINE_STAGES).optional(),
        tipePelanggan: z.enum(["END_USER", "CORPORATE"]).optional(),
        statusKesehatan: z.enum(["SAKIT", "TIDAK_SAKIT"]).optional(),
        sumberLead: z.enum(LEAD_SOURCE).optional(),
        salesId: z.string().optional().describe("ID user sales penanggung jawab."),
        minNilaiOrder: z.number().int().min(0).optional().describe("Hanya pelanggan dengan total nilai order >= ini (Rupiah)."),
        belumOrder: z.boolean().optional().describe("true = hanya pelanggan yang belum pernah order."),
        dibuatDari: TANGGAL.optional().describe("Pelanggan dibuat sejak tanggal ini (WIB)."),
        dibuatSampai: TANGGAL.optional().describe("Pelanggan dibuat sampai tanggal ini (WIB, inklusif)."),
        limit: limitParam(20),
        offset: offsetParam,
        unmask: unmaskParam,
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const take = args.limit ?? 20;
      const where = {
        ...whereTanggal(args.dibuatDari, args.dibuatSampai),
        ...(args.kota ? { city: args.kota } : {}),
        ...(args.pipelineStage ? { pipelineStage: args.pipelineStage } : {}),
        ...(args.tipePelanggan ? { customerType: args.tipePelanggan } : {}),
        ...(args.statusKesehatan ? { healthStatus: args.statusKesehatan } : {}),
        ...(args.sumberLead ? { leadSource: args.sumberLead } : {}),
        ...(args.salesId ? { assignedSalesId: args.salesId } : {}),
        ...(args.minNilaiOrder != null ? { orderValue: { gte: args.minNilaiOrder } } : {}),
        ...(args.belumOrder ? { orderCount: 0 } : {}),
        ...(args.q
          ? {
              OR: [
                { name: { contains: args.q, mode: "insensitive" } },
                { phone: { contains: args.q } },
                { email: { contains: args.q, mode: "insensitive" } },
                { instagramHandle: { contains: args.q, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({
          where,
          include: { assignedSales: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
          take,
          skip: args.offset ?? 0,
        }),
      ]);

      return hasil({
        total,
        ditampilkan: rows.length,
        offset: args.offset ?? 0,
        pelanggan: rows.map((c) => ringkasPelanggan(c, args.unmask === true)),
      });
    },
  );

  // 2 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "detail_pelanggan",
    {
      title: "Detail pelanggan",
      description:
        "Profil lengkap satu pelanggan: data diri, seluruh order beserta rincian layanan & berat badan, " +
        "catatan internal sales, riwayat perpindahan pipeline stage, riwayat keluhan, dan ringkasan " +
        "percakapan. Cari berdasarkan customerId ATAU nomor HP.",
      inputSchema: {
        customerId: z.string().optional().describe("ID pelanggan (cuid)."),
        telepon: z.string().optional().describe("Nomor HP format 628xxxx (tanpa + dan tanpa @c.us)."),
        unmask: unmaskParam,
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      if (!args.customerId && !args.telepon) {
        return hasil({ error: "Wajib isi salah satu: customerId atau telepon." });
      }

      const c = await prisma.customer.findFirst({
        where: args.customerId ? { id: args.customerId } : { phone: args.telepon },
        include: {
          assignedSales: { select: { id: true, name: true } },
          orders: {
            orderBy: { createdAt: "desc" },
            include: {
              items: { orderBy: { sortOrder: "asc" } },
              weightEntries: { orderBy: { sortOrder: "asc" } },
            },
          },
          notes: {
            orderBy: { createdAt: "desc" },
            take: 50,
            include: { author: { select: { name: true } } },
          },
          pipelineTransitions: {
            orderBy: { createdAt: "desc" },
            take: 50,
            include: { changedBy: { select: { name: true } } },
          },
          conversations: {
            orderBy: { lastMessageAt: "desc" },
            select: {
              id: true, channel: true, status: true, sessionId: true,
              lastMessageAt: true, lastMessagePreview: true, unreadCount: true,
              assignedTo: { select: { name: true } },
            },
          },
        },
      });

      if (!c) return hasil({ error: "Pelanggan tidak ditemukan." });

      const unmask = args.unmask === true;
      return hasil({
        ...ringkasPelanggan(c, unmask),
        order: c.orders.map(ringkasOrder),
        // Riwayat keluhan dirangkum dari semua order (bukan field terpisah di
        // Customer) — ini sengaja, lihat CLAUDE.md §7D.
        riwayatKeluhan: c.orders
          .filter((o) => o.hasComplaint)
          .map((o) => ({
            orderId: o.id,
            nomorOrder: o.orderNumber,
            tanggal: o.complaintDate,
            detail: o.complaintDetail,
          })),
        catatanInternal: c.notes.map((n) => ({
          penulis: n.author?.name ?? null,
          isi: n.content,
          tanggal: n.createdAt,
        })),
        riwayatPipeline: c.pipelineTransitions.map((t) => ({
          dari: t.fromStage,
          ke: t.toStage,
          olehSales: t.changedBy?.name ?? null,
          tanggal: t.createdAt,
        })),
        percakapan: c.conversations.map((k) => ({
          id: k.id,
          channel: k.channel,
          status: k.status,
          sesiWa: k.sessionId,
          dipegangOleh: k.assignedTo?.name ?? null,
          pesanTerakhir: k.lastMessagePreview,
          waktuPesanTerakhir: k.lastMessageAt,
          belumDibaca: k.unreadCount,
        })),
      });
    },
  );

  // 3 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "cari_order",
    {
      title: "Cari order",
      description:
        "Cari order/pesanan dengan filter status, kategori (LAYANAN/SEWA/BARU), status pembayaran, " +
        "komplain, dan rentang tanggal WIB. Mengembalikan daftar + total nilai yang cocok.",
      inputSchema: {
        nomorOrder: z.string().optional().describe("Cocokkan sebagian nomor order, mis. 'NEW-07072026'."),
        pelangganId: z.string().optional(),
        status: z.enum(ORDER_STATUS).optional(),
        kategori: z.enum(ORDER_CATEGORY).optional(),
        statusPembayaran: z.enum(PAYMENT_STATUS).optional(),
        adaKomplain: z.boolean().optional().describe("true = hanya order yang ditandai pernah komplain."),
        dari: TANGGAL.optional().describe("Order dibuat sejak tanggal ini (WIB)."),
        sampai: TANGGAL.optional().describe("Order dibuat sampai tanggal ini (WIB, inklusif)."),
        limit: limitParam(20),
        offset: offsetParam,
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const take = args.limit ?? 20;
      const where = {
        ...whereTanggal(args.dari, args.sampai),
        ...(args.nomorOrder ? { orderNumber: { contains: args.nomorOrder, mode: "insensitive" } } : {}),
        ...(args.pelangganId ? { customerId: args.pelangganId } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.kategori ? { category: args.kategori } : {}),
        ...(args.statusPembayaran ? { paymentStatus: args.statusPembayaran } : {}),
        ...(args.adaKomplain != null ? { hasComplaint: args.adaKomplain } : {}),
      };

      const [total, agregat, rows] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.aggregate({ where, _sum: { value: true } }),
        prisma.order.findMany({
          where,
          include: {
            customer: { select: { id: true, name: true } },
            items: { orderBy: { sortOrder: "asc" } },
          },
          orderBy: { createdAt: "desc" },
          take,
          skip: args.offset ?? 0,
        }),
      ]);

      return hasil({
        total,
        totalNilai: agregat._sum.value ?? 0,
        ditampilkan: rows.length,
        offset: args.offset ?? 0,
        order: rows.map(ringkasOrder),
      });
    },
  );

  // 4 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "detail_order",
    {
      title: "Detail order",
      description:
        "Detail satu order: rincian layanan (add-ons) dan harganya, berat badan per orang, keluhan " +
        "pelanggan, riwayat perpindahan status, dan data pelanggan pemiliknya.",
      inputSchema: {
        orderId: z.string().optional(),
        nomorOrder: z.string().optional().describe("Nomor order persis, mis. 'NEW-07072026-001'."),
        unmask: unmaskParam,
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      if (!args.orderId && !args.nomorOrder) {
        return hasil({ error: "Wajib isi salah satu: orderId atau nomorOrder." });
      }

      const o = await prisma.order.findFirst({
        where: args.orderId ? { id: args.orderId } : { orderNumber: args.nomorOrder },
        include: {
          customer: { include: { assignedSales: { select: { id: true, name: true } } } },
          items: { orderBy: { sortOrder: "asc" } },
          weightEntries: { orderBy: { sortOrder: "asc" } },
          statusTransitions: {
            orderBy: { createdAt: "desc" },
            take: 50,
            include: { changedBy: { select: { name: true } } },
          },
        },
      });

      if (!o) return hasil({ error: "Order tidak ditemukan." });

      return hasil({
        ...ringkasOrder(o),
        pelanggan: ringkasPelanggan(o.customer, args.unmask === true),
        riwayatStatus: o.statusTransitions.map((t) => ({
          dari: t.fromStatus,
          ke: t.toStatus,
          oleh: t.changedBy?.name ?? null,
          tanggal: t.createdAt,
        })),
      });
    },
  );

  // 5 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "ringkasan_penjualan",
    {
      title: "Ringkasan penjualan",
      description:
        "Agregat penjualan pada rentang tanggal WIB: jumlah order, total nilai, rata-rata nilai order, " +
        "pecahan per status / kategori / status pembayaran, dan jumlah pelanggan baru. " +
        "Order berstatus CANCELLED dikecualikan dari total nilai (konsisten dengan Dashboard CRM).",
      inputSchema: {
        dari: TANGGAL.describe("Tanggal awal (WIB, inklusif)."),
        sampai: TANGGAL.describe("Tanggal akhir (WIB, inklusif)."),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const periode = whereTanggal(args.dari, args.sampai);
      const tanpaBatal = { ...periode, status: { not: "CANCELLED" } };

      const [agregat, perStatus, perKategori, perBayar, pelangganBaru] = await Promise.all([
        prisma.order.aggregate({ where: tanpaBatal, _sum: { value: true }, _count: true, _avg: { value: true } }),
        prisma.order.groupBy({ by: ["status"], where: periode, _count: true, _sum: { value: true } }),
        prisma.order.groupBy({ by: ["category"], where: tanpaBatal, _count: true, _sum: { value: true } }),
        prisma.order.groupBy({ by: ["paymentStatus"], where: tanpaBatal, _count: true, _sum: { value: true } }),
        prisma.customer.count({ where: periode }),
      ]);

      return hasil({
        periode: { dari: args.dari, sampai: args.sampai, zonaWaktu: "WIB (Asia/Jakarta)" },
        jumlahOrder: agregat._count,
        totalNilai: agregat._sum.value ?? 0,
        rataRataNilaiOrder: Math.round(agregat._avg.value ?? 0),
        pelangganBaru,
        perStatus: perStatus.map((r) => ({ status: r.status, jumlah: r._count, nilai: r._sum.value ?? 0 })),
        perKategori: perKategori.map((r) => ({ kategori: r.category, jumlah: r._count, nilai: r._sum.value ?? 0 })),
        perStatusPembayaran: perBayar.map((r) => ({
          statusPembayaran: r.paymentStatus,
          jumlah: r._count,
          nilai: r._sum.value ?? 0,
        })),
        catatan: "CANCELLED dikecualikan dari semua angka kecuali pecahan perStatus.",
      });
    },
  );

  // 6 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "ringkasan_pipeline",
    {
      title: "Ringkasan pipeline",
      description:
        "Jumlah pelanggan dan total nilai order di setiap pipeline stage " +
        "(NEW → QUALIFIED → QUOTED → BOOKED → SCHEDULED → COMPLETED → REVIEWED). " +
        "Opsional dibatasi per sales. Bisa juga menampilkan jumlah perpindahan stage pada periode tertentu.",
      inputSchema: {
        salesId: z.string().optional().describe("Batasi ke pelanggan milik sales ini."),
        dari: TANGGAL.optional().describe("Kalau diisi, tambahkan hitungan perpindahan stage sejak tanggal ini (WIB)."),
        sampai: TANGGAL.optional(),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const where = args.salesId ? { assignedSalesId: args.salesId } : {};

      const [perStage, transisi] = await Promise.all([
        prisma.customer.groupBy({
          by: ["pipelineStage"],
          where,
          _count: true,
          _sum: { orderValue: true },
        }),
        args.dari || args.sampai
          ? prisma.pipelineTransition.groupBy({
              by: ["toStage"],
              where: {
                ...whereTanggal(args.dari, args.sampai),
                ...(args.salesId ? { customer: { assignedSalesId: args.salesId } } : {}),
              },
              _count: true,
            })
          : Promise.resolve(null),
      ]);

      const peta = Object.fromEntries(perStage.map((r) => [r.pipelineStage, r]));
      return hasil({
        // Urutkan mengikuti urutan stage sebenarnya, bukan urutan hasil groupBy —
        // supaya funnel terbaca dari atas ke bawah.
        stage: PIPELINE_STAGES.map((s) => ({
          stage: s,
          jumlahPelanggan: peta[s]?._count ?? 0,
          totalNilaiOrder: peta[s]?._sum.orderValue ?? 0,
        })),
        ...(transisi
          ? {
              perpindahanPadaPeriode: {
                dari: args.dari ?? null,
                sampai: args.sampai ?? null,
                masukKeStage: transisi.map((r) => ({ stage: r.toStage, jumlah: r._count })),
              },
            }
          : {}),
      });
    },
  );

  // 7 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "ringkasan_sumber_lead",
    {
      title: "Ringkasan sumber lead",
      description:
        "Distribusi pelanggan per sumber lead (META_ADS, GOOGLE_ADS, WEBSITE_ORGANIC, INSTAGRAM, " +
        "WHATSAPP_DIRECT, REFERRAL, OTHER) beserta berapa yang akhirnya order dan total nilainya — " +
        "dipakai untuk melihat channel mana yang paling menghasilkan.",
      inputSchema: {
        dari: TANGGAL.optional().describe("Pelanggan dibuat sejak tanggal ini (WIB)."),
        sampai: TANGGAL.optional(),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const where = whereTanggal(args.dari, args.sampai);

      const [semua, yangOrder] = await Promise.all([
        prisma.customer.groupBy({ by: ["leadSource"], where, _count: true, _sum: { orderValue: true } }),
        prisma.customer.groupBy({
          by: ["leadSource"],
          where: { ...where, orderCount: { gt: 0 } },
          _count: true,
        }),
      ]);

      const petaOrder = Object.fromEntries(yangOrder.map((r) => [String(r.leadSource), r._count]));

      return hasil({
        periode: { dari: args.dari ?? null, sampai: args.sampai ?? null, zonaWaktu: "WIB (Asia/Jakarta)" },
        sumber: semua
          .map((r) => {
            const kunci = String(r.leadSource);
            const konversi = petaOrder[kunci] ?? 0;
            return {
              sumberLead: r.leadSource ?? "BELUM_DIISI",
              jumlahLead: r._count,
              jumlahYangOrder: konversi,
              conversionRate: r._count ? Number(((konversi / r._count) * 100).toFixed(1)) : 0,
              totalNilaiOrder: r._sum.orderValue ?? 0,
            };
          })
          .sort((a, b) => b.jumlahLead - a.jumlahLead),
      });
    },
  );

  // 8 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "performa_sales",
    {
      title: "Performa sales bulanan",
      description:
        "Realisasi penjualan per sales pada satu bulan dibanding target bulanannya (SalesTarget), " +
        "plus jumlah order dan pelanggan baru. Atribusi memakai Customer.assignedSalesId " +
        "(kepemilikan lead di CRM) — order dari pelanggan yang bukan miliknya TIDAK dihitung.",
      inputSchema: {
        tahun: z.number().int().min(2020).max(2100).optional().describe("Default: tahun berjalan menurut WIB."),
        bulan: z.number().int().min(1).max(12).optional().describe("Default: bulan berjalan menurut WIB."),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const sekarang = nowPartsWIB();
      const tahun = args.tahun ?? sekarang.year;
      const bulan = args.bulan ?? sekarang.month;
      const awal = startOfMonthWIB(tahun, bulan);
      const akhir = endOfMonthExclusiveWIB(tahun, bulan);

      // Hanya user aktif — sales yang sudah resign tidak muncul lagi di baris
      // laporan (konsisten dengan routes/analytics.js), tapi ordernya tetap
      // terhitung di angka company-wide di tool ringkasan_penjualan.
      const salesUsers = await prisma.user.findMany({
        where: { active: true, OR: [{ role: "SALES" }, { roles: { some: { role: "SALES" } } }] },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      });

      const targets = await prisma.salesTarget.findMany({ where: { year: tahun, month: bulan } });
      const petaTarget = Object.fromEntries(targets.map((t) => [t.userId, t.targetValue]));

      const baris = await Promise.all(
        salesUsers.map(async (u) => {
          const [order, pelangganBaru] = await Promise.all([
            prisma.order.aggregate({
              where: {
                customer: { assignedSalesId: u.id },
                status: { not: "CANCELLED" },
                createdAt: { gte: awal, lt: akhir },
              },
              _sum: { value: true },
              _count: true,
            }),
            prisma.customer.count({
              where: { assignedSalesId: u.id, createdAt: { gte: awal, lt: akhir } },
            }),
          ]);

          const realisasi = order._sum.value ?? 0;
          const target = petaTarget[u.id] ?? 0;
          return {
            salesId: u.id,
            nama: u.name,
            target,
            realisasi,
            pencapaianPersen: target ? Number(((realisasi / target) * 100).toFixed(1)) : null,
            jumlahOrder: order._count,
            pelangganBaru,
          };
        }),
      );

      return hasil({
        periode: { tahun, bulan, zonaWaktu: "WIB (Asia/Jakarta)" },
        sales: baris.sort((a, b) => b.realisasi - a.realisasi),
      });
    },
  );

  // 9 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "daftar_percakapan",
    {
      title: "Daftar percakapan",
      description:
        "Daftar percakapan Inbox (WhatsApp/Instagram) beserta status, sales yang memegang, " +
        "cuplikan pesan terakhir, dan jumlah pesan belum dibaca. Bisa disaring ke percakapan " +
        "yang lama tidak dibalas — berguna untuk mencari lead yang terbengkalai.",
      inputSchema: {
        status: z.enum(["OPEN", "PENDING", "RESOLVED"]).optional(),
        tipe: z.enum(["INDIVIDUAL", "GROUP"]).optional().describe("GROUP = grup WA internal (bukan pelanggan)."),
        salesId: z.string().optional().describe("Sales yang sedang memegang percakapan (assignedToId)."),
        belumDipegang: z.boolean().optional().describe("true = hanya percakapan yang belum ada yang pegang."),
        adaPesanBelumDibaca: z.boolean().optional(),
        tidakAdaBalasanSejakMenit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Hanya percakapan yang pesan terakhirnya lebih lama dari N menit lalu."),
        limit: limitParam(20),
        offset: offsetParam,
        unmask: unmaskParam,
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const take = args.limit ?? 20;
      const where = {
        ...(args.status ? { status: args.status } : {}),
        ...(args.tipe ? { type: args.tipe } : {}),
        ...(args.salesId ? { assignedToId: args.salesId } : {}),
        ...(args.belumDipegang ? { assignedToId: null } : {}),
        ...(args.adaPesanBelumDibaca ? { unreadCount: { gt: 0 } } : {}),
        ...(args.tidakAdaBalasanSejakMenit
          ? { lastMessageAt: { lt: new Date(Date.now() - args.tidakAdaBalasanSejakMenit * 60_000) } }
          : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.conversation.count({ where }),
        prisma.conversation.findMany({
          where,
          include: {
            customer: { select: { id: true, name: true, phone: true, pipelineStage: true } },
            assignedTo: { select: { id: true, name: true } },
            firstResponder: { select: { name: true } },
          },
          orderBy: { lastMessageAt: "desc" },
          take,
          skip: args.offset ?? 0,
        }),
      ]);

      const unmask = args.unmask === true;
      return hasil({
        total,
        ditampilkan: rows.length,
        offset: args.offset ?? 0,
        percakapan: rows.map((k) => ({
          id: k.id,
          tipe: k.type,
          channel: k.channel,
          status: k.status,
          sesiWa: k.sessionId,
          namaGrup: k.groupName,
          pelanggan: k.customer
            ? {
                id: k.customer.id,
                nama: k.customer.name,
                telepon: maskPhone(k.customer.phone, unmask),
                pipelineStage: k.customer.pipelineStage,
              }
            : null,
          dipegangOleh: k.assignedTo?.name ?? null,
          dipegangOlehId: k.assignedToId,
          perespondPertama: k.firstResponder?.name ?? null,
          pesanTerakhir: k.lastMessagePreview,
          waktuPesanTerakhir: k.lastMessageAt,
          belumDibaca: k.unreadCount,
          disematkan: k.pinned,
        })),
      });
    },
  );

  // 10 ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    "riwayat_percakapan",
    {
      title: "Riwayat pesan percakapan",
      description:
        "Isi pesan sebuah percakapan (urut dari yang terbaru). Berguna untuk memahami konteks " +
        "keluhan/kebutuhan pelanggan. Pesan yang sudah dihapus pelanggan ditandai isRevoked.",
      inputSchema: {
        conversationId: z.string().describe("ID percakapan dari tool daftar_percakapan atau detail_pelanggan."),
        limit: limitParam(50),
        unmask: unmaskParam,
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const percakapan = await prisma.conversation.findUnique({
        where: { id: args.conversationId },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          assignedTo: { select: { name: true } },
        },
      });
      if (!percakapan) return hasil({ error: "Percakapan tidak ditemukan." });

      const pesan = await prisma.message.findMany({
        where: { conversationId: args.conversationId },
        include: { sentBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: args.limit ?? 50,
      });

      const unmask = args.unmask === true;
      return hasil({
        percakapan: {
          id: percakapan.id,
          tipe: percakapan.type,
          channel: percakapan.channel,
          status: percakapan.status,
          namaGrup: percakapan.groupName,
          dipegangOleh: percakapan.assignedTo?.name ?? null,
          pelanggan: percakapan.customer
            ? {
                id: percakapan.customer.id,
                nama: percakapan.customer.name,
                telepon: maskPhone(percakapan.customer.phone, unmask),
              }
            : null,
        },
        jumlahPesan: pesan.length,
        pesan: pesan.map((m) => ({
          arah: m.direction === "INBOUND" ? "dari_pelanggan" : "dari_cs",
          isi: m.isRevoked ? "[pesan dihapus]" : m.content,
          tipeMedia: m.mediaType,
          adaMedia: Boolean(m.mediaUrl),
          namaPengirim: m.senderName,
          dikirimOlehSales: m.sentBy?.name ?? null,
          diedit: Boolean(m.editedAt),
          dihapus: m.isRevoked,
          waktu: m.createdAt,
        })),
      });
    },
  );

  // 11 ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    "daftar_produk",
    {
      title: "Katalog produk & layanan",
      description:
        "Katalog produk/layanan yang bisa dikirim sales dari chat (nama, kategori, harga, satuan harga). " +
        "Tidak mengandung data pelanggan.",
      inputSchema: {
        q: z.string().optional().describe("Cari di nama & deskripsi produk."),
        kategori: z.string().optional().describe("Mis. 'Upgrade', 'Matras Baru', 'Garansi', 'Servis'."),
        termasukNonaktif: z.boolean().optional().describe("true = ikut tampilkan produk yang dinonaktifkan."),
        limit: limitParam(50),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const where = {
        ...(args.termasukNonaktif ? {} : { active: true }),
        ...(args.kategori ? { category: args.kategori } : {}),
        ...(args.q
          ? {
              OR: [
                { name: { contains: args.q, mode: "insensitive" } },
                { description: { contains: args.q, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const rows = await prisma.product.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        take: args.limit ?? 50,
        include: { images: { select: { url: true, label: true }, orderBy: { sortOrder: "asc" } } },
      });

      return hasil({
        jumlah: rows.length,
        produk: rows.map((p) => ({
          id: p.id,
          nama: p.name,
          deskripsi: p.description,
          kategori: p.category,
          harga: p.price,
          satuanHarga: p.priceUnit,
          aktif: p.active,
          jumlahFoto: p.images.length,
        })),
      });
    },
  );

  // 12 ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    "statistik_crm",
    {
      title: "Statistik ringkas CRM",
      description:
        "Snapshot cepat kondisi CRM saat ini: total pelanggan, total order & nilainya, order bulan " +
        "berjalan, percakapan terbuka/belum dipegang, jumlah komplain terbuka, dan daftar sales aktif " +
        "(termasuk ID-nya untuk dipakai di tool lain). Panggil ini dulu kalau butuh orientasi.",
      inputSchema: {},
      annotations: ANOTASI_BACA,
    },
    async () => {
      const { year, month } = nowPartsWIB();
      const awalBulan = startOfMonthWIB(year, month);
      const akhirBulan = endOfMonthExclusiveWIB(year, month);

      const [
        totalPelanggan,
        totalOrder,
        nilaiSemuaOrder,
        orderBulanIni,
        percakapanTerbuka,
        percakapanBelumDipegang,
        komplain,
        salesAktif,
      ] = await Promise.all([
        prisma.customer.count(),
        prisma.order.count({ where: { status: { not: "CANCELLED" } } }),
        prisma.order.aggregate({ where: { status: { not: "CANCELLED" } }, _sum: { value: true } }),
        prisma.order.aggregate({
          where: { status: { not: "CANCELLED" }, createdAt: { gte: awalBulan, lt: akhirBulan } },
          _sum: { value: true },
          _count: true,
        }),
        prisma.conversation.count({ where: { status: "OPEN", type: "INDIVIDUAL" } }),
        prisma.conversation.count({ where: { status: "OPEN", type: "INDIVIDUAL", assignedToId: null } }),
        prisma.order.count({ where: { hasComplaint: true } }),
        prisma.user.findMany({
          where: { active: true },
          select: { id: true, name: true, role: true },
          orderBy: { name: "asc" },
        }),
      ]);

      return hasil({
        perTanggal: { tahun: year, bulan: month, zonaWaktu: "WIB (Asia/Jakarta)" },
        totalPelanggan,
        totalOrder,
        totalNilaiOrder: nilaiSemuaOrder._sum.value ?? 0,
        bulanBerjalan: {
          jumlahOrder: orderBulanIni._count,
          totalNilai: orderBulanIni._sum.value ?? 0,
        },
        percakapanTerbuka,
        percakapanBelumDipegang,
        orderPernahKomplain: komplain,
        userAktif: salesAktif.map((u) => ({ id: u.id, nama: u.name, role: u.role })),
      });
    },
  );
}