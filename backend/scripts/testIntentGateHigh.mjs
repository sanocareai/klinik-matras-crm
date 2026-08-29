// ═══ TEST KECIL — gerbang intent utk tier HIGH + NETRAL_AMBIGU + spam link ═
// Satu-off, TIDAK didaftarkan sbg cron/job. Jalankan manual:
//   docker compose exec backend node scripts/testIntentGateHigh.mjs
//
// LATAR BELAKANG: ticket 29 Agustus 2026 "Perluas gerbang klasifikasi LLM
// intent supaya juga menentukan tier HIGH" — stop condition eksplisit:
// tunjukkan hasil test kecil dulu sebelum backfill penuh ke 3000 pelanggan
// atau menyalakan cron kembali. Script ini TIDAK backfill populasi, TIDAK
// menyalakan cron — cuma:
//   1. Re-cek tier SEMUA customer yang SUDAH pernah diklasifikasi (dari
//      sesi testing sebelumnya: 4 kasus bug asli + 9 kasus minat asli +
//      sample Ervina) dgn kode classifyRiskTier YANG BARU (gerbang HIGH).
//   2. Klasifikasi BARU (1 panggilan LLM per customer, kecil) khusus utk
//      Mahda Kotambunan ("Mahal") dan HRD (link spam) — 2 kasus target
//      ticket ini yang belum pernah dites krn kategorinya belum ada.
//   3. Hitung berapa banyak kandidat (dari populasi ~3000 yang sama dgn
//      Sales Risk Engine) mengandung link asing (hasSuspiciousLink) —
//      DIAGNOSTIK SAJA, tanpa panggilan LLM, tanpa tulis apa pun ke DB.
import { prisma } from "../src/db.js";
import { loadSalesRiskCandidates } from "../src/services/salesRisk/index.js";
import { detectSalesRiskSignals, flattenMessagesAsc } from "../src/services/salesRisk/signals.js";
import { buildSalesRisk, classifyRiskTier } from "../src/services/salesRisk/riskScore.js";
import { classifyLatestMessageIntent, resolveSalesRiskIntentApiKey } from "../src/services/salesRisk/intentClassification.js";

function printRow(label, before, after, intent, problem, spam) {
  const changed = before !== after ? "  ← BERUBAH" : "";
  console.log(
    `${label.padEnd(28)} intent=${String(intent).padEnd(22)} tier: ${String(before).padEnd(8)} → ${String(after).padEnd(8)}${changed}${spam ? "  [SPAM]" : ""}`
  );
  if (problem) console.log(`    problem: ${problem}`);
}

async function main() {
  console.log("═══ 1. Re-cek tier customer yang SUDAH diklasifikasi sebelumnya ═══\n");

  const cachedRows = await prisma.salesRiskIntentClassification.findMany({
    include: { customer: { select: { id: true, name: true, phone: true, pipelineStage: true, assignedSalesId: true, orders: { select: { value: true, status: true } }, conversations: { where: { type: "INDIVIDUAL" }, orderBy: { lastMessageAt: "desc" }, take: 3, select: { messages: { orderBy: { createdAt: "desc" }, take: 20, select: { direction: true, content: true, createdAt: true, rawType: true, mediaType: true } } } } } },
  });
  console.log(`(${cachedRows.length} baris cache ditemukan dari sesi testing sebelumnya)\n`);

  for (const row of cachedRows) {
    const c = row.customer;
    if (!c) continue;
    const signals = detectSalesRiskSignals(c, row);
    const risk = buildSalesRisk(signals, c);
    const oldTierNoGate = (() => {
      // Tier tanpa gerbang HIGH baru (simulasi kode LAMA) — pakai signals yg
      // sama tapi hasBuyingIntent tetap sudah dari cache (gerbang CRITICAL
      // lama TIDAK berubah), cuma gerbang HIGH capping-nya yang baru.
      const s2 = { ...signals, latestMessageIntent: null }; // matikan gerbang baru
      return classifyRiskTier(s2);
    })();
    printRow(c.name || c.phone, oldTierNoGate, risk.tier, signals.latestMessageIntent, risk.tier !== oldTierNoGate ? risk.problem : "", signals.isProbablySpam);
  }

  console.log("\n═══ 2. Klasifikasi BARU — Mahda Kotambunan (\"Mahal\") & HRD (link spam) ═══\n");
  const apiKey = resolveSalesRiskIntentApiKey();
  const targets = await prisma.customer.findMany({
    where: { OR: [{ name: { contains: "Mahda", mode: "insensitive" } }, { name: { contains: "HRD", mode: "insensitive" } }] },
    select: { id: true, name: true, phone: true, pipelineStage: true, assignedSalesId: true, orders: { select: { value: true, status: true } }, conversations: { where: { type: "INDIVIDUAL" }, orderBy: { lastMessageAt: "desc" }, take: 3, select: { messages: { orderBy: { createdAt: "desc" }, take: 20, select: { direction: true, content: true, createdAt: true, rawType: true, mediaType: true } } } } },
  });
  if (targets.length === 0) console.log("  (tidak ketemu customer bernama Mahda/HRD — cek nama persis di DB)");
  for (const c of targets) {
    const messagesAsc = flattenMessagesAsc(c.conversations);
    const recentInbound = messagesAsc.filter((m) => m.direction === "INBOUND").slice(-5);
    const lastInbound = recentInbound[recentInbound.length - 1];
    if (!lastInbound) { console.log(`  ${c.name}: tidak ada pesan inbound, skip.`); continue; }
    const { intent, usage } = await classifyLatestMessageIntent({ recentInbound, apiKey });
    await prisma.salesRiskIntentClassification.upsert({
      where: { customerId: c.id },
      create: { customerId: c.id, latestMessageIntent: intent, latestMessageAt: new Date(lastInbound.createdAt) },
      update: { latestMessageIntent: intent, latestMessageAt: new Date(lastInbound.createdAt), classifiedAt: new Date() },
    });
    const cachedRow = { latestMessageIntent: intent, latestMessageAt: new Date(lastInbound.createdAt) };
    const signals = detectSalesRiskSignals(c, cachedRow);
    const risk = buildSalesRisk(signals, c);
    console.log(`  ${c.name} — pesan terakhir: "${lastInbound.content}"`);
    console.log(`    → intent=${intent}  tier=${risk.tier}  isProbablySpam=${signals.isProbablySpam}  hasSuspiciousLink=${signals.hasSuspiciousLink}`);
    console.log(`    → problem: ${risk.problem}`);
    console.log(`    → recommendedAction: ${risk.recommendedAction}`);
    console.log(`    (biaya: $${((usage.inputTokens || 0) * 1 + (usage.outputTokens || 0) * 5) / 1_000_000 > 0 ? "lihat log AI Playground" : "0"})\n`);
  }

  console.log("═══ 3. Diagnostik populasi — berapa banyak kandidat punya link asing? (TANPA LLM, TANPA tulis DB) ═══\n");
  const candidates = await loadSalesRiskCandidates(prisma, {});
  let suspiciousCount = 0;
  const examples = [];
  for (const c of candidates) {
    const signals = detectSalesRiskSignals(c, null);
    if (signals.hasSuspiciousLink) {
      suspiciousCount++;
      if (examples.length < 10) examples.push(`${c.name || c.phone}: "${signals.recentInboundQuote}"`);
    }
  }
  console.log(`Total kandidat discan: ${candidates.length}`);
  console.log(`Mengandung link asing (hasSuspiciousLink): ${suspiciousCount}`);
  console.log(`Contoh (maks 10):`);
  for (const ex of examples) console.log(`  - ${ex}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
