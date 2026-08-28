// ═══ BACKFILL akuiPresent/galiPresent (28 Agustus 2026) ═══════════════════
// Satu-off — TIDAK didaftarkan sbg cron job. Jalankan manual:
//   docker compose exec backend node scripts/backfillAkuiGali.js
//
// LATAR BELAKANG: frameworkFollowed lama (1 boolean gabungan utk Dengar-
// Akui-Gali) ke-satisfy oleh basa-basi rutin ("baik kak") yang muncul
// identik di banyak tempat lain pada transkrip yang sama — ditemukan lewat
// investigasi gold-standard (baca 3 transkrip mentah). 3 iterasi prompt
// SATU panggilan gabungan (akuiPresent+galiPresent sekaligus) TERBUKTI
// TIDAK STABIL (verifikasi live: tiap perbaikan 1 kegagalan meregresi
// kegagalan lain). Fix STRUKTURAL: 2 panggilan sekuensial terpisah (Gali
// dulu, lalu Akui dgn kutipan Gali sbg konteks) — lihat grading.js#
// extractAkuiGali & qualityScorerRubric.js#buildAkuiPrompt utk detail
// lengkap & alasannya.
//
// Script ini RE-EXTRACT akuiPresent/galiPresent SAJA utk SEMUA baris
// ConversationQualityScore yang objectionHandlingScore-nya terisi — TIDAK
// menyentuh score/quote/strength/weakness/objectionType dimensi itu, TIDAK
// menyentuh dimensi lain sama sekali. Reuse extractAkuiGali() dari
// grading.js — SAMA PERSIS fungsi yang dipakai job grading harian, supaya
// kriteria backfill data lama identik dgn kriteria grading baru (tidak ada
// drift antara 2 jalur).
import { prisma } from "../src/db.js";
import { fetchTranscriptMessages, formatTranscript, resolveApiKey, extractAkuiGali } from "../src/services/qualityScorer/grading.js";

async function reExtract(conversationId, apiKey, objectionQuote) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { customer: { select: { name: true } } },
  });
  if (!conv) return null;
  const messages = await fetchTranscriptMessages(conversationId, new Date());
  if (messages.length === 0) return null;
  const transcriptText = formatTranscript(messages, conv.customer?.name);

  // objectionQuote (dari objectionTypeQuote yang SUDAH tersimpan di baris
  // asal) diteruskan sbg jangkar — SAMA dgn live grading, cegah Gali/Akui
  // salah menemukan bukti dari bagian lain percakapan yang tidak berkaitan.
  const { akuiPresent, akuiPresentQuote, galiPresent, galiPresentQuote } = await extractAkuiGali({ transcriptText, apiKey, objectionQuote });
  const frameworkFollowed = akuiPresent == null || galiPresent == null ? null : akuiPresent && galiPresent;
  return { akuiPresent, akuiPresentQuote, galiPresent, galiPresentQuote, frameworkFollowed };
}

async function main() {
  const apiKey = resolveApiKey();

  const rows = await prisma.conversationQualityScore.findMany({
    where: { objectionHandlingScore: { not: null } },
    select: { id: true, conversationId: true, salesName: true, frameworkFollowed: true, objectionTypeQuote: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Total baris utk backfill: ${rows.length}`);

  const changes = []; // { salesName, from, to }
  let ok = 0, failed = 0;

  for (const row of rows) {
    let extracted;
    try {
      extracted = await reExtract(row.conversationId, apiKey, row.objectionTypeQuote ?? null);
    } catch (err) {
      console.error(`[${row.conversationId}] GAGAL — ${err.message}`);
      failed++;
      continue;
    }
    if (!extracted) {
      console.log(`[${row.conversationId}] SKIP — transkrip/tool call tidak tersedia`);
      failed++;
      continue;
    }

    await prisma.conversationQualityScore.update({
      where: { id: row.id },
      data: {
        akuiPresent: extracted.akuiPresent,
        akuiPresentQuote: extracted.akuiPresentQuote,
        galiPresent: extracted.galiPresent,
        galiPresentQuote: extracted.galiPresentQuote,
        frameworkFollowed: extracted.frameworkFollowed,
        frameworkFollowedQuote: null,
      },
    });
    ok++;

    const before = row.frameworkFollowed;
    const after = extracted.frameworkFollowed;
    if (before !== after) {
      changes.push({ salesName: row.salesName, conversationId: row.conversationId, from: before, to: after });
      console.log(`[${row.conversationId}] ${row.salesName}: frameworkFollowed ${before} -> ${after} (akui=${extracted.akuiPresent}, gali=${extracted.galiPresent})`);
    } else {
      console.log(`[${row.conversationId}] ${row.salesName}: tidak berubah (${before} -> ${after})`);
    }
  }

  const trueToFalseBySales = {};
  const falseToTrueBySales = {};
  for (const c of changes) {
    if (c.from === true && c.to === false) trueToFalseBySales[c.salesName] = (trueToFalseBySales[c.salesName] || 0) + 1;
    if (c.from === false && c.to === true) falseToTrueBySales[c.salesName] = (falseToTrueBySales[c.salesName] || 0) + 1;
  }

  console.log("\n=== RINGKASAN BACKFILL ===");
  console.log(`Berhasil: ${ok}, Gagal/skip: ${failed}, Total baris berubah: ${changes.length}`);
  console.log("\nfalse->true per sales (SEBELUMNYA dinilai gagal, TERNYATA memenuhi kriteria baru yang lebih spesifik):");
  console.log(JSON.stringify(falseToTrueBySales, null, 2));
  console.log("\ntrue->false per sales (SEBELUMNYA dianggap patuh framework krn basa-basi, TERNYATA tidak memenuhi kriteria baru):");
  console.log(JSON.stringify(trueToFalseBySales, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
