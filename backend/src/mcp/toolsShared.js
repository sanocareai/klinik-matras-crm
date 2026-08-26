// Helper bersama untuk SEMUA file tool MCP (tools.js, toolsChat.js,
// toolsTraffic.js). Dipindahkan ke sini apa adanya dari tools.js — perilakunya
// TIDAK berubah, cuma tempatnya, supaya tiga file tool memakai bentuk output &
// aturan parameter yang sama persis (tanggal WIB, masking, batas baris).
//
// ⚠️ ATURAN MUTLAK (berlaku untuk file ini dan semua toolsXxx.js):
//   1. HANYA operasi baca Prisma: findMany / findUnique / findFirst /
//      aggregate / groupBy / count / $queryRaw SELECT. TIDAK ADA
//      create/update/delete/upsert/$executeRaw.
//   2. TIDAK ADA pengiriman pesan WhatsApp — jangan pernah import wahaClient.js.
//   3. Nomor HP & email pelanggan DEFAULT disamarkan; tiap tool yang
//      mengembalikan kontak wajib punya param `unmask`.
// tests/mcp.test.js memindai file-file ini dan GAGAL kalau aturan 1 & 2 dilanggar.

import { z } from "zod";
import { maskPhone, maskEmail } from "./security.js";
// Batas tanggal WIB — WAJIB. Container backend jalan di UTC; `new Date(y,m,d)`
// menggeser seluruh jendela laporan 7 jam (lihat utils/wib.js & CLAUDE.md §11).
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";

// ─── ENUM (cermin schema.prisma — sumber kebenaran tetap schema.prisma) ──────

export const PIPELINE_STAGES = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED", "SPAM"];
export const ORDER_STATUS = ["PENDING", "PICKUP", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];
export const ORDER_CATEGORY = ["LAYANAN", "SEWA", "BARU"];
export const PAYMENT_STATUS = ["BELUM_BAYAR", "DP", "LUNAS"];
export const LEAD_SOURCE = [
  "META_ADS", "GOOGLE_ADS", "WEBSITE_ORGANIC", "INSTAGRAM",
  "WHATSAPP_DIRECT", "REFERRAL", "OTHER", "ADS", "WEBSITE",
];

// ─── PARAMETER YANG BERULANG ────────────────────────────────────────────────

export const TANGGAL = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");

export const unmaskParam = z
  .boolean()
  .optional()
  .describe("true = tampilkan nomor HP & email pelanggan LENGKAP (tanpa masking). Default false.");

export const limitParam = (bawaan) =>
  z.number().int().min(1).max(100).optional().describe(`Jumlah baris (1-100, default ${bawaan}).`);

export const offsetParam = z.number().int().min(0).optional().describe("Lewati N baris pertama (paginasi).");

// ─── UTILITAS ───────────────────────────────────────────────────────────────

// Rentang tanggal WIB → batas instant UTC. `to` EKSKLUSIF (awal hari
// berikutnya), bukan 23:59:59 — lihat utils/wib.js kenapa.
export function whereTanggal(from, to, field = "createdAt") {
  if (!from && !to) return {};
  const w = {};
  if (from) w.gte = startOfDayWIB(from);
  if (to) w.lt = endOfDayExclusiveWIB(to);
  return { [field]: w };
}

// Versi batas mentah (Date) — dibutuhkan $queryRaw yang tidak bisa memakai
// objek where Prisma. Sentinel dipakai kalau salah satu sisi kosong supaya
// SQL-nya tetap satu bentuk (pola sama seperti routes/analytics.js).
export function batasTanggal(from, to) {
  return {
    mulai: from ? startOfDayWIB(from) : new Date("1970-01-01T00:00:00Z"),
    selesai: to ? endOfDayExclusiveWIB(to) : new Date("2999-01-01T00:00:00Z"),
  };
}

// Bentuk ringkas pelanggan — dipakai di semua daftar supaya konsisten.
export function ringkasPelanggan(c, unmask) {
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

export function ringkasOrder(o) {
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
export function hasil(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// Anotasi seragam: readOnlyHint memberi tahu klien MCP bahwa tool ini tidak
// pernah mengubah apa pun, jadi boleh dipanggil tanpa konfirmasi user.
export const ANOTASI_BACA = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
