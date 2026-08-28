// ═══ SALES RISK ENGINE — deteksi sinyal (PURE) ════════════════════════════
// Input: customer (bentuk SAMA PERSIS dgn CUSTOMER_SELECT di
// services/intelligence/index.js — di-REUSE lewat loadAllPriorityCandidates
// di index.js file ini, TIDAK ada select/query baru). Output: sinyal mentah
// utk riskScore.js. TIDAK menyentuh/menduplikasi logic intelligence/signals.js
// (detectSignals) — engine ini punya definisi sendiri utk "neglect"/"waiting"
// yang SENGAJA beda filosofi (lihat weights.js).
import { KEYWORDS, THRESHOLDS as INTEL_THRESHOLDS } from "../intelligence/weights.js";
// detectIntents/BOOKING_READINESS_PATTERN TIDAK DIPAKAI LAGI di sini (29
// Agustus 2026) — diganti klasifikasi LLM, lihat detectBuyingIntent di bawah.

// Gabungkan semua pesan dari conversations yang dimuat (maks 3 percakapan x
// 20 pesan, sama seperti Priority Engine), urut KRONOLOGIS (ascending) —
// perlu urutan asli utk hitung "unanswered run" di akhir.
// Diekspor (29 Agustus 2026) — dipakai juga intentClassificationJob.js supaya
// window pesan yang dievaluasi LLM SAMA PERSIS dgn yang dipakai signals.js,
// tidak ada drift.
export function flattenMessagesAsc(conversations) {
  const all = [];
  for (const conv of conversations || []) {
    for (const m of conv.messages || []) all.push(m);
  }
  all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return all;
}

// Sinyal A — Neglect: pesan TERAKHIR di seluruh window INBOUND artinya
// belum dibalas sama sekali sejak itu. unansweredCount = berapa banyak
// pesan INBOUND BERUNTUN di ekor (setelah OUTBOUND terakhir, atau semua
// kalau tidak ada OUTBOUND sama sekali di window) — customer yang chat
// berkali-kali tanpa dibalas SATU KALI PUN lebih parah dari yang cuma
// sekali.
function detectNeglect(messagesAsc) {
  if (messagesAsc.length === 0) {
    return { isNeglected: false, unansweredCount: 0, lastInboundAt: null, lastOutboundAt: null };
  }
  let lastOutboundAt = null;
  for (const m of messagesAsc) if (m.direction === "OUTBOUND") lastOutboundAt = new Date(m.createdAt);

  let unansweredCount = 0;
  let lastInboundAt = null;
  for (let i = messagesAsc.length - 1; i >= 0; i--) {
    const m = messagesAsc[i];
    if (m.direction === "OUTBOUND") break; // berhenti begitu ketemu balasan sales
    unansweredCount++;
    if (!lastInboundAt) lastInboundAt = new Date(m.createdAt);
  }

  const last = messagesAsc[messagesAsc.length - 1];
  const isNeglected = last.direction === "INBOUND";
  return { isNeglected, unansweredCount, lastInboundAt, lastOutboundAt };
}

// Sinyal B — Buying Intent (29 Agustus 2026, GANTI TOTAL sumber "keyword
// text" — lihat catatan panjang di intentClassification.js soal 2 bug yang
// diperbaiki). `hasKeywordOrPhrase` SEKARANG murni dari klasifikasi LLM
// ter-cache (latestMessageIntent === "MINAT_AKTIF") thd PESAN TERAKHIR SAJA
// — BUKAN lagi detectIntents()/BOOKING_READINESS_PATTERN thd 5 pesan
// digabung. `hasLocation` TIDAK diubah (sinyal struktural/rawType, bukan
// text-parsing, tidak terlibat di bug yang dilaporkan).
//
// `cachedRow` (null kalau belum pernah diklasifikasi ATAU cache stale)
// datang dari SalesRiskIntentClassification, dimuat SEKALI oleh caller
// (index.js#computeAllSalesRisks, bukan query per-customer di sini — fungsi
// ini TETAP PURE/sync, cuma baca parameter yang sudah di-lookup). Validitas
// cache (apakah `latestMessageAt` masih match pesan terakhir SEKARANG)
// dicek DI SINI karena pesan sudah di-flatten di sini juga — hindari
// flatten dobel.
function detectBuyingIntent(messagesAsc, cachedRow) {
  const recentInbound = messagesAsc.filter((m) => m.direction === "INBOUND").slice(-5);
  const lastInbound = recentInbound[recentInbound.length - 1] || null;
  const recentText = recentInbound.map((m) => m.content || "").join(" ");

  const hasLocation = recentInbound.some((m) => m.rawType === "location" || m.mediaType === "location");
  const hasComplaintLikeKeyword = KEYWORDS.complaint.test(recentText); // dipakai trainingMap.js, bukan skor — TIDAK diubah

  const cacheValid =
    cachedRow && lastInbound && cachedRow.latestMessageAt.getTime() === new Date(lastInbound.createdAt).getTime();
  // null (bukan false/"NETRAL" ditebak) kalau belum pernah diklasifikasi
  // atau customer sudah kirim pesan baru sejak klasifikasi terakhir — job
  // harian yang akan mengisi ini, TIDAK ditebak di sini (prinsip null-safety
  // yang sama dipakai di seluruh investigasi akuiPresent/galiPresent).
  const latestMessageIntent = cacheValid ? cachedRow.latestMessageIntent : null;
  const hasKeywordOrPhrase = latestMessageIntent === "MINAT_AKTIF";

  return {
    hasKeywordOrPhrase,
    hasLocation,
    hasBuyingIntent: hasKeywordOrPhrase || hasLocation,
    hasComplaintLikeKeyword,
    recentInboundQuote: lastInbound?.content || null,
    latestMessageIntent,
  };
}

// Sinyal D — Pipeline: TRANSACTION / PROSPECT (macet atau tidak, threshold
// DI-IMPORT dari intelligence/weights.js, bukan angka baru) / lainnya.
function detectPipeline(customer, lastMessageAt) {
  const stage = customer.pipelineStage || "NEW";
  const daysSince = lastMessageAt ? Math.floor((Date.now() - lastMessageAt.getTime()) / 86_400_000) : null;
  const prospectStalled = stage === "PROSPECT" && daysSince != null && daysSince > INTEL_THRESHOLDS.stalledProspectDays;
  return { stage, isTransaction: stage === "TRANSACTION", prospectStalled };
}

// Sinyal E — Customer Value: dihitung dari customer.orders yang SUDAH
// dimuat (field select SAMA dgn Priority Engine, tidak ada field/query
// tambahan) — exclude CANCELLED, konvensi sama dgn customerOrderAggregate.js.
function detectCustomerValue(customer) {
  const orders = (customer.orders || []).filter((o) => o.status !== "CANCELLED");
  const orderValue = orders.reduce((s, o) => s + (o.value || 0), 0);
  const orderCount = orders.length;
  return { orderValue, orderCount };
}

// `cachedRow` (29 Agustus 2026) — baris SalesRiskIntentClassification utk
// customer ini (atau null), diteruskan LANGSUNG ke detectBuyingIntent. Lihat
// index.js#computeAllSalesRisks utk bagaimana ini dimuat (1x findMany utk
// semua customer, bukan N+1).
export function detectSalesRiskSignals(customer, cachedRow = null) {
  const messagesAsc = flattenMessagesAsc(customer.conversations);
  const neglect = detectNeglect(messagesAsc);
  const intent = detectBuyingIntent(messagesAsc, cachedRow);

  const lastMessageAt = messagesAsc.length ? new Date(messagesAsc[messagesAsc.length - 1].createdAt) : null;
  const pipeline = detectPipeline(customer, lastMessageAt);
  const value = detectCustomerValue(customer);

  // waitingHours HANYA relevan kalau sedang neglected (belum dibalas) —
  // kalau sudah dibalas, "menunggu" tidak lagi bermakna utk engine ini.
  const waitingHours = neglect.isNeglected && neglect.lastInboundAt
    ? (Date.now() - neglect.lastInboundAt.getTime()) / 3_600_000
    : 0;

  return {
    ...neglect,
    ...intent,
    ...pipeline,
    ...value,
    waitingHours,
    messageCount: messagesAsc.length,
  };
}
