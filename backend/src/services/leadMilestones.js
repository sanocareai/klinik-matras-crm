// ─── MILESTONE LEAD: PENAWARAN OTOMATIS & AREA DARI ORDER ────────────────
//
// Latar (analisis lead Meta Ads Sep 2026): 89% lead yang SUDAH dibalas sales
// tetap di stage NEW karena stage dipindah manual dan jarang dirawat, jadi
// "qualified"/"penawaran" tidak bisa diukur. Wilayah juga tidak bisa
// dipetakan (Customer.city kosong 100%).
//
// Job ini (tiap 2 menit) mengisi dua hal secara otomatis:
//   1. Customer.quotedAt — pesan OUTBOUND pertama yang memuat harga. Kalau
//      pelanggan masih NEW, stage-nya dinaikkan ke PROSPECT (definisi
//      PROSPECT = "dulu QUALIFIED+QUOTED", lihat enum PipelineStage) dan
//      dicatat di pipeline_transitions seperti perpindahan manual.
//   2. Customer.serviceArea — dari Order.deliveryCity terbaru, HANYA kalau
//      masih kosong (isian manual sales tidak pernah ditimpa).
//
// KENAPA JOB, BUKAN HOOK DI SETIAP JALUR KIRIM: pesan OUTBOUND disimpan di
// ±8 tempat (routes/conversations.js kirim teks/media/template/galeri produk,
// webhooks.js untuk balasan dari HP, dst). Job memindai tabel Message sekali
// jalan, jadi otomatis mencakup semuanya — termasuk 17% balasan pertama yang
// dikirim langsung dari HP, bukan lewat CRM.
//
// IDEMPOTEN: semua update memakai syarat "masih NULL"/"masih NEW" di WHERE
// (updateMany), jadi jendela pindai yang tumpang-tindih atau 2 instance yang
// jalan bersamaan tidak pernah menimpa atau mencatat transisi dobel.
import cron from "node-cron";
import { prisma as defaultPrisma } from "../db.js";

// Pola harga (case-insensitive), dipakai di SQL (Postgres ~*) DAN di JS:
//   "Rp3.690.000", "Rp 1,9", "3.690.000", "3,690,000", "2jt", "500rb", "1,5 juta"
// Divalidasi pada data Sep 2026: cocok di 1 dari 3.405 pesan sapaan pertama
// (sapaan tidak memuat harga), dan di 63 dari 63 lead yang akhirnya order.
// \y = batas kata di Postgres; versi JS memakai \b.
export const PRICE_PATTERN_SQL =
  "(rp\\.?\\s?[0-9][0-9.,]{2,}|[0-9]{1,3}([.,][0-9]{3}){1,2}(\\s|$|,|\\.|\\))|[0-9]+([.,][0-9]+)?\\s?(jt|juta|rb|ribu|k)\\y)";
const PRICE_REGEX_JS =
  /(rp\.?\s?[0-9][0-9.,]{2,}|[0-9]{1,3}([.,][0-9]{3}){1,2}(\s|$|,|\.|\))|[0-9]+([.,][0-9]+)?\s?(jt|juta|rb|ribu|k)\b)/i;

export function mengandungHarga(teks) {
  return typeof teks === "string" && PRICE_REGEX_JS.test(teks);
}

// Kota (KOTA_LIST di frontend/src/utils/format.js + teks bebas deliveryCity)
// → area layanan. null = tidak bisa dipetakan (dibiarkan kosong, bukan ditebak).
export function areaDariKota(kota) {
  const k = (kota || "").toLowerCase().trim();
  if (!k) return null;
  if (/jakarta|bekasi|tangerang|bogor|depok|jabodetabek/.test(k)) return "JABODETABEK";
  if (/bandung|cimahi/.test(k)) return "BANDUNG";
  if (/karawang|sukabumi|cianjur|purwakarta|serang|cilegon/.test(k)) return "AREA_LAIN";
  return null;
}

export const SERVICE_AREAS = ["JABODETABEK", "BANDUNG", "AREA_LAIN", "LUAR_AREA"];
// Stage yang tidak boleh dimasuki (lewat pindah MANUAL) sebelum area terisi.
export const STAGE_BUTUH_AREA = ["PROSPECT", "TRANSACTION", "REVIEWED"];

/**
 * Tandai penawaran untuk pelanggan yang menerima pesan berharga sejak `since`.
 * Dibatasi ke percakapan yang aktif sejak `since` (index Conversation
 * status+lastMessageAt), lalu pesan per percakapan (index conversationId+
 * createdAt) — tidak memindai seluruh tabel Message.
 */
export async function tandaiPenawaranOtomatis(prisma, { since, source = "AUTO_PESAN" }) {
  const kandidat = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT ON (u.id) u.id AS "customerId", m."createdAt" AS "at", m."sentById" AS "by"
       FROM "Conversation" c
       JOIN "Customer" u ON u.id = c."customerId"
       JOIN "Message"  m ON m."conversationId" = c.id
      WHERE c.type = 'INDIVIDUAL'
        AND c."lastMessageAt" >= $1
        AND m.direction = 'OUTBOUND'
        AND m."createdAt" >= $1
        AND u.quoted_at IS NULL
        AND u.is_internal_staff = false
        AND m.content ~* $2
      ORDER BY u.id, m."createdAt"`,
    since, PRICE_PATTERN_SQL,
  );
  return catatPenawaran(prisma, kandidat, { source, naikkanStage: true });
}

// Dipakai job & skrip backfill. naikkanStage=false untuk backfill: riwayat
// stage lama TIDAK diubah mundur (pipeline_transitions harus mencerminkan
// kejadian nyata, bukan rekonstruksi).
export async function catatPenawaran(prisma, kandidat, { source, naikkanStage }) {
  let ditandai = 0, dinaikkan = 0;
  for (const { customerId, at, by } of kandidat) {
    await prisma.$transaction(async (tx) => {
      const set = await tx.customer.updateMany({
        where: { id: customerId, quotedAt: null },
        data: { quotedAt: at, quotedBy: by || null, quotedSource: source },
      });
      if (set.count === 0) return;
      ditandai++;
      if (!naikkanStage) return;
      const naik = await tx.customer.updateMany({
        where: { id: customerId, pipelineStage: "NEW" },
        data: { pipelineStage: "PROSPECT" },
      });
      if (naik.count === 0) return;
      dinaikkan++;
      await tx.pipelineTransition.create({
        data: { customerId, fromStage: "NEW", toStage: "PROSPECT", changedById: by || null },
      });
    });
  }
  return { ditandai, dinaikkan };
}

/** Isi serviceArea yang masih kosong dari Order.deliveryCity terbaru. */
export async function isiAreaDariOrder(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT ON (o."customerId") o."customerId" AS "customerId", o.delivery_city AS "kota"
       FROM "Order" o
       JOIN "Customer" u ON u.id = o."customerId"
      WHERE u.service_area IS NULL AND o.delivery_city IS NOT NULL AND o.delivery_city <> ''
      ORDER BY o."customerId", o."createdAt" DESC`,
  );
  let diisi = 0;
  for (const { customerId, kota } of rows) {
    const area = areaDariKota(kota);
    if (!area) continue;
    const r = await prisma.customer.updateMany({
      where: { id: customerId, serviceArea: null },
      data: { serviceArea: area, serviceAreaSetAt: new Date(), serviceAreaSetBy: null },
    });
    diisi += r.count;
  }
  return { diisi };
}

export async function runLeadMilestoneCycle(prisma = defaultPrisma, { windowMinutes = 15 } = {}) {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const penawaran = await tandaiPenawaranOtomatis(prisma, { since });
  const area = await isiAreaDariOrder(prisma);
  if (penawaran.ditandai || area.diisi) {
    console.log(`[lead-milestones] penawaran ditandai: ${penawaran.ditandai} (naik ke PROSPECT: ${penawaran.dinaikkan}), area dari order: ${area.diisi}`);
  }
  return { ...penawaran, ...area };
}

export function startLeadMilestoneJob() {
  let berjalan = false;
  const jalan = async (windowMinutes) => {
    if (berjalan) return; // siklus sebelumnya belum selesai — lewati, jendela berikutnya tumpang-tindih
    berjalan = true;
    try { await runLeadMilestoneCycle(defaultPrisma, { windowMinutes }); }
    catch (err) { console.error("[lead-milestones] siklus gagal:", err.message); }
    finally { berjalan = false; }
  };
  // Sekali saat start dgn jendela 6 jam — menutup celah selama redeploy/restart.
  setTimeout(() => jalan(6 * 60), 30_000);
  cron.schedule("*/2 * * * *", () => jalan(15), { timezone: "Asia/Jakarta" });
  console.log("[lead-milestones] job aktif — tiap 2 menit");
}
