// Mengenali lead Meta Ads dari TEKS TEMPLATE iklan Click-to-WhatsApp,
// dipakai sebagai JARING PENGAMAN saat sinyal CTWA tidak terbaca.
//
// ── KENAPA INI ADA ──────────────────────────────────────────────────────
// Iklan CTWA membuka WhatsApp dengan teks prefilled dari kreatif iklannya.
// Kalau WAHA berhasil membaca ctwa_clid, atribusinya pasti. Tapi sinyal itu
// TIDAK SELALU sampai — diukur di produksi (11-17 Agt 2026):
//
//   Tgl     Lead Meta   Punya CTWA   "WhatsApp Langsung"
//   11 Agt      32          0%              25
//   12 Agt      33          0%              33
//   14 Agt      89         92%               6
//   17 Agt     120         92%              16
//
// Korelasi terbaliknya jelas: saat CTWA gagal, lead iklan jatuh ke
// "WhatsApp Langsung" — padahal pesan pertamanya HARFIAH teks iklan.
// Akibatnya laporan meremehkan Meta dan menggelembungkan "direct", dan
// angka itu dipakai untuk keputusan belanja iklan.
//
// Logika pencocokan ini sudah terbukti benar: dipakai script backfill
// 13 Agt 2026 (scripts/backfill-template-iklan.js) untuk memulihkan ~1.100
// lead historis. Yang HILANG adalah penerapannya di jalur LIVE — itu yang
// diperbaiki di sini.
//
// ── KENAPA DAFTARNYA DITURUNKAN DARI DATA, BUKAN DI-HARDCODE ───────────
// Kreatif iklan berganti-ganti; daftar hardcode akan basi diam-diam dan
// tidak ada yang sadar. Daftar di sini diturunkan dari lead yang CTWA-nya
// TERBUKTI terbaca (ctwa_clid tidak null) — jadi sumber kebenarannya
// adalah iklan yang benar-benar jalan, dan otomatis ikut kalau kreatif
// baru mulai dipakai.
//
// ── KENAPA ADA AMBANG PANJANG ──────────────────────────────────────────
// Tanpa penjaga, "lokasi dimana" (13 karakter, 10 lead, 40% di antaranya
// dari iklan) ikut terjaring — itu pertanyaan yang WAJAR diketik siapa
// saja, bukan teks iklan. Menandai lead organik sebagai Meta lebih
// berbahaya daripada melewatkannya: angkanya dipakai menaikkan belanja
// iklan, dan salahnya tidak kelihatan salah.
//
// Rasio "berapa persen dari iklan" TIDAK bisa dipakai membedakan —
// diperiksa di produksi, template asli maupun pertanyaan generik sama-sama
// di kisaran 15-40%. Yang memisahkan bersih adalah PANJANG:
//   template iklan asli : 42-78 karakter (8 template, 13-85 lead)
//   pertanyaan generik  : 1-14 karakter  ("lokasi dimana", "halo kak", "p")
import { prisma } from "../db.js";

/** Teks iklan itu salinan pemasaran, selalu panjang. Pertanyaan spontan pendek. */
export const PANJANG_MIN = 30;
/** Muncul sesekali bisa kebetulan; pola berulang berarti memang template. */
export const MIN_KEMUNCULAN = 5;
/** Kreatif lama tidak relevan lagi — jendela ini menjaga daftar tetap segar. */
export const JENDELA_HARI = 90;
/** Daftar berubah lambat (hitungan hari), jadi tidak perlu query tiap pesan. */
export const CACHE_TTL_MS = 30 * 60 * 1000;

/** Samakan bentuk sebelum dibandingkan — sama seperti leadAttribution.js. */
export function normalisasi(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Cari template yang jadi AWALAN pesan customer.
 *
 * Pakai awalan (bukan sama persis) karena customer sering menambahkan
 * kalimatnya sendiri di belakang teks bawaan — pola yang sama dengan
 * matchCampaignByMessage() di leadAttribution.js.
 *
 * @param {string} text pesan pertama customer
 * @param {string[]} templates daftar template (sudah ternormalisasi)
 * @returns {string|null} template yang cocok, atau null
 */
export function cocokkanTemplateIklan(text, templates) {
  const pesan = normalisasi(text);
  if (!pesan || !Array.isArray(templates) || templates.length === 0) return null;

  // Yang paling PANJANG menang — template spesifik mengalahkan template
  // umum yang kebetulan jadi awalannya (mis. "Ingin upgrade kasur lama
  // agar lebih nyaman" vs "...agar lebih nyaman dan sehat").
  let terbaik = null;
  for (const t of templates) {
    if (t && pesan.startsWith(t) && (!terbaik || t.length > terbaik.length)) {
      terbaik = t;
    }
  }
  return terbaik;
}

let cache = { data: null, at: 0 };
let cacheWeb = { data: null, at: 0 };

/** Dipakai tes — jangan dipanggil dari kode produksi. */
export function _resetCacheTemplateIklan() {
  cache = { data: null, at: 0 };
  cacheWeb = { data: null, at: 0 };
}

/**
 * Daftar template iklan yang sedang aktif, diturunkan dari lead yang
 * CTWA-nya terbukti terbaca.
 *
 * Gagal query TIDAK melempar error — kembalikan daftar kosong supaya
 * atribusi jatuh ke perilaku lama (WHATSAPP_DIRECT). Lapis ini penambah
 * ketepatan; kalau ia sendiri bermasalah, jangan sampai menjatuhkan
 * penyimpanan pesan customer.
 */
export async function ambilTemplateIklanAktif() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  try {
    const baris = await prisma.$queryRaw`
      WITH pertama AS (
        SELECT c.id, lower(trim(m.content)) AS teks
        FROM "Customer" c
        JOIN "Conversation" conv ON conv."customerId" = c.id
        JOIN LATERAL (
          SELECT content FROM "Message"
          WHERE "conversationId" = conv.id AND direction = 'INBOUND'
          ORDER BY "createdAt" ASC LIMIT 1
        ) m ON true
        WHERE c.ctwa_clid IS NOT NULL
          AND c."createdAt" >= now() - (${JENDELA_HARI} || ' days')::interval
      )
      SELECT teks, count(*)::int AS n
      FROM pertama
      WHERE length(teks) >= ${PANJANG_MIN}
      GROUP BY teks
      HAVING count(*) >= ${MIN_KEMUNCULAN}
    `;
    // Query sudah lower+trim; normalisasi lagi untuk merapatkan spasi ganda.
    const data = baris.map((b) => normalisasi(b.teks)).filter(Boolean);
    cache = { data, at: Date.now() };
    return data;
  } catch (e) {
    console.warn("[templateIklan] Gagal ambil daftar template:", e.message);
    return cache.data || [];
  }
}

// ── TEKS TOMBOL WA DI WEBSITE ──────────────────────────────────────────
//
// MASALAH TERPISAH dari template iklan di atas, tapi pola solusinya sama.
//
// Tombol WhatsApp di sanomatrassehat.com membuka WA dengan teks prefilled
// ("Halo Sano, saya tertarik konsultasi"). Kalau pengunjung datang dari
// iklan, website juga menempelkan tag kanal tak terlihat (lihat
// leadAttribution.js#extractRefTag). Pengunjung ORGANIK tidak dapat tag —
// dan itu memang benar, tidak ada kanal iklan untuk dicatat.
//
// Tapi akibatnya lead itu jatuh ke WHATSAPP_DIRECT, yang MENYATAKAN HAL
// YANG SALAH: "customer menghubungi langsung tanpa lewat website".
// Padahal jelas lewat website — teks tombolnya ada di pesan pertamanya.
//
// Terukur di produksi (90 hari): 343 lead memakai teks tombol ini, hanya
// 51 yang bertag kanal. Sisanya (292) tercatat "WhatsApp Langsung" —
// itu yang menggelembungkan angka "direct" di laporan.
//
// Yang JUJUR: sumbernya WEBSITE, kanalnya tidak diketahui (organik, atau
// iklan yang tagnya hilang). Itu yang ditulis di detail — bukan menebak
// Google/Meta, dan bukan pula mengaku "direct".
export const MIN_KEMUNCULAN_WEBSITE = 3;

/**
 * Daftar teks tombol WA website, diturunkan dari lead yang tag kanalnya
 * TERBUKTI terbaca ("Website - <kanal>", bukan hasil backfill retroaktif).
 *
 * Ambang panjang & jumlah sama alasannya dengan template iklan: mencegah
 * sapaan wajar seperti "halo sano" (9 karakter) ikut terjaring.
 */
export async function ambilTeksTombolWebsite() {
  if (cacheWeb.data && Date.now() - cacheWeb.at < CACHE_TTL_MS) return cacheWeb.data;

  try {
    const baris = await prisma.$queryRaw`
      WITH pertama AS (
        SELECT c.id, lower(trim(m.content)) AS teks
        FROM "Customer" c
        JOIN "Conversation" conv ON conv."customerId" = c.id
        JOIN LATERAL (
          SELECT content FROM "Message"
          WHERE "conversationId" = conv.id AND direction = 'INBOUND'
          ORDER BY "createdAt" ASC LIMIT 1
        ) m ON true
        WHERE c."leadSourceDetail" LIKE 'Website - %'
          AND c."leadSourceDetail" NOT LIKE '%retroaktif%'
          AND c."createdAt" >= now() - (${JENDELA_HARI} || ' days')::interval
      )
      SELECT teks, count(*)::int AS n
      FROM pertama
      WHERE length(teks) >= ${PANJANG_MIN}
      GROUP BY teks
      HAVING count(*) >= ${MIN_KEMUNCULAN_WEBSITE}
    `;
    const data = baris.map((b) => normalisasi(b.teks)).filter(Boolean);
    cacheWeb = { data, at: Date.now() };
    return data;
  } catch (e) {
    console.warn("[templateIklan] Gagal ambil teks tombol website:", e.message);
    return cacheWeb.data || [];
  }
}
