// ═══ SALES RISK ENGINE — konfigurasi terpusat ═════════════════════════════
// Engine TERPISAH dari Priority Engine (services/intelligence/) — jawab
// pertanyaan BEDA: "siapa berisiko KARENA eksekusi sales gagal", bukan
// "siapa yang layak diprioritaskan". Lihat services/intelligence/weights.js
// utk THRESHOLDS.stalledProspectDays yang di-IMPORT (bukan diduplikasi) di
// signals.js — supaya "berapa hari PROSPECT dianggap macet" tetap 1 sumber
// kebenaran lintas kedua engine.
//
// TIDAK MENGUBAH apa pun di intelligence/ — file ini murni baru.

// ── A. Sales Neglect (bobot 35%) ───────────────────────────────────────────
// "Neglect" = pesan TERAKHIR di percakapan itu INBOUND (customer bicara
// duluan/terakhir, sales belum balas SAMA SEKALI sejak itu). Base langsung
// besar (25 dari 35) karena ini SATU-SATUNYA sinyal yang murni tentang
// KEGAGALAN sales (bukan "seberapa penting" seperti 4 sinyal lain) — beda
// filosofi dari skorUrgensi yang mencampur banyak sinyal jadi satu angka.
export const NEGLECT_WEIGHTS = {
  base: 25, // begitu ke-flag neglected (last message INBOUND)
  perExtraUnanswered: 2, // +2 tiap pesan INBOUND beruntun TAMBAHAN setelah yang pertama
  maxExtra: 10, // total sinyal ini di-cap 35 (25+10)
};

// ── B. Buying Intent (bobot 30%) ───────────────────────────────────────────
// 3 sumber independen, SEMUA reuse/read-only kecuali BOOKING_READINESS_PATTERN
// (baru): (1) detectIntents() dari intelligence/replyReadiness.js — keyword
// existing (harga/ukuran/order/dst), (2) Message.rawType==="location" — TIDAK
// ADA di Priority Engine sama sekali (shareloc Ivan lolos dari deteksi lama
// justru karena ini), (3) frasa "siap booking" — BARU, di bawah.
export const INTENT_WEIGHTS = {
  keywordOrPhrase: 15, // dari detectIntents() ATAU BOOKING_READINESS_PATTERN, mana pun yg match (tidak dijumlah keduanya)
  location: 15, // dari Message.rawType/mediaType === "location"
};

// Frasa kesiapan booking (Bahasa Indonesia sehari-hari) — BEDA dari
// KEYWORDS.scheduling (intelligence/weights.js, itu "tanya jadwal"). Ini
// spesifik SINYAL SIAP KOMIT ("gas", "otw", "siap dijemput"), bukan sekadar
// bertanya. HEURISTIK, belum diverifikasi luas ke data produksi — tunable,
// revisi kalau ternyata terlalu longgar/ketat setelah dipakai beberapa
// minggu (sama status "belum diverifikasi" dengan Lapis 1 CTWA di CLAUDE.md).
export const BOOKING_READINESS_PATTERN =
  /\b(siap\s*(di)?(jemput|ambil|booking)|gas\s*(kak|min)?|otw|deal\s*(kak|min)?|oke\s*(gas|siap|deal)|jadi\s*(kapan|hari\s*ini)|langsung\s*aja|lanjut(kan)?\s*(saja|aja)?\s*(ya|ka?k)?)\b/i;

// ── C. Waiting Duration (bobot 20%) ────────────────────────────────────────
// Terus naik seiring lama menunggu — TIDAK mentok di hari ke-4 seperti
// unansweredMaxExtra di priorityScore.js (itu akar masalah yang membuat
// kasus Ivan, 411 jam/17 hari, dinilai "low" oleh Priority Engine).
export const WAITING_BUCKETS = [
  { maxHours: 24, points: 0 },
  { maxHours: 72, points: 5 },
  { maxHours: 168, points: 10 }, // 7 hari
  { maxHours: 336, points: 15 }, // 14 hari
  { maxHours: Infinity, points: 20 },
];

// ── D. Pipeline Importance (bobot 10%) ─────────────────────────────────────
export const PIPELINE_WEIGHTS = {
  transaction: 10,
  prospectStalled: 10, // PROSPECT + macet > stalledProspectDays (lihat signals.js)
  prospect: 6, // PROSPECT tapi belum macet
  other: 0, // NEW/REVIEWED/SPAM (SPAM sendiri sudah dikecualikan di candidate pool)
};

// ── E. Customer Value (bobot 5%) ───────────────────────────────────────────
// Dihitung dari customer.orders yang SUDAH dimuat (bukan field baru,
// bukan query tambahan) — SUM value, exclude CANCELLED, sama konvensi
// dgn customerOrderAggregate.js.
export const VALUE_WEIGHTS = {
  highValueMin: 10_000_000,
  highValuePoints: 5,
  midValueMin: 5_000_000,
  midValuePoints: 3,
  repeatCustomerPoints: 2, // orderCount >= 1 (transaksi lama, exclude CANCELLED) — TIDAK ditambah ke atas, cuma dipakai kalau value < midValueMin
};

// ── Ambang klasifikasi rule-based (BUKAN score-only, lihat riskScore.js) ──
export const CRITICAL_WAIT_HOURS = 72;
export const HIGH_WAIT_HOURS = 24;

export const RISK_TIERS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
