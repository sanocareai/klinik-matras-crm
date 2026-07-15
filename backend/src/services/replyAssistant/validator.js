// ─── WAVE 4B.0.2 — VALIDATOR & PROMISE SCRUBBER (PURE, HARDENED) ────────────
// Backstop KERAS (bukan sekadar prompt): setiap draf harus lolos di sini sebelum
// keluar. Draf yang melanggar aturan produk DIBUANG; kalau akhirnya kosong →
// pemanggil fallback ke template aman.
//
// Kategori terlarang (Wave 4B.0.1 quality gate — P0/P1):
//   price     harga nominal (Rp / 5.000.000 / 5 juta / 3 jutaan / lima juta / 500k)
//   discount  diskon/potongan berangka atau persen
//   freebie   pemberian gratis (gratis ongkir / free bantal / bonus)
//   delivery  janji waktu kirim/selesai spesifik (besok / 3 hari / minggu depan / H+3)
//   warranty  klaim garansi flat berangka (garansi 20 tahun / seumur hidup)
//   medical   klaim penyembuhan (menyembuhkan / sembuh / mengobati)
//   certainty jaminan mutlak (pasti cocok / dijamin nyaman / 100% sehat)
import { assertContractInvariants } from "../intelligence/replyReadiness.js";

// Angka terbilang Indonesia yang lazim mendahului satuan uang/tahun.
const NUM = "(?:se|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|belas|puluh|ratus|setengah)";

// ── PRICE ── Rp, ribuan/jutaan berformat, digit+satuan (+an), "500k", terbilang+satuan
const PRICE_RE = new RegExp(
  "\\brp\\s*\\d" + // Rp5000, Rp 5jt
    "|\\b\\d{1,3}(?:[.,]\\d{3})+\\b" + // 5.000.000
    "|\\b\\d+\\s*(?:juta|jt|ribu|rb)(?:an)?\\b" + // 5 juta / 3 jutaan / 500rb
    "|\\b\\d+\\s*k\\b" + // 500k
    `|\\b${NUM}(?:\\s+${NUM})*\\s*(?:juta|jutaan|ribu|ribuan)\\b`, // lima juta / dua ratus ribu / tiga jutaan
  "i"
);

// ── DISCOUNT ── persen atau diskon/potongan berangka
const DISCOUNT_RE = /\b\d+\s*%|\bdiskon\b[^.]*\d|\bpotongan\b[^.]*\d/i;

// ── FREEBIE ── pemberian gratis (tak perlu angka)
const FREEBIE_RE = /\b(?:gratis|free|cuma-cuma|bonus)\b/i;

// ── DELIVERY ── kata kerja kirim/selesai + token waktu spesifik dalam 30 char
//   ("jadi" sengaja TIDAK dipakai — terlalu umum → false positive)
const DELIVERY_RE = /\b(?:dikirim|kirim|sampai|tiba|diantar|antar|selesai|ready|dikerjakan|pengerjaan)\b[^.]{0,30}\b(?:\d+\s*(?:hari|jam|minggu|bulan|hr)(?:\s*kerja)?|besok|lusa|hari ini|minggu ini|minggu depan|bulan depan|h\+\d+)\b/i;

// ── WARRANTY ── klaim garansi flat berangka / seumur hidup / terbilang tahun
const WARRANTY_RE = /garansi[^.]{0,25}(?:\d+\s*tahun|(?:se|dua|tiga|lima|sepuluh|belas|puluh)[a-z ]{0,12}tahun|seumur hidup)/i;

// ── MEDICAL ── klaim penyembuhan/pengobatan
const MEDICAL_RE = /\b(?:menyembuhkan|menyembuhkn|penyembuhan|sembuh|mengobati|obat|kuratif)\b/i;

// ── CERTAINTY ── jaminan mutlak (over-promise)
const CERTAINTY_RE = /\b(?:pasti|dijamin)\b[^.]{0,15}\b(?:cocok|nyaman|sembuh|hilang|puas|sehat|bagus|ampuh)\b|\b(?:100\s*%|seratus\s*persen)\s*\S{0,10}\b(?:cocok|nyaman|sehat|puas|sembuh)\b/i;

const CHECKS = [
  ["price", PRICE_RE],
  ["discount", DISCOUNT_RE],
  ["freebie", FREEBIE_RE],
  ["delivery", DELIVERY_RE],
  ["warranty", WARRANTY_RE],
  ["medical", MEDICAL_RE],
  ["certainty", CERTAINTY_RE],
];

// Kategori pelanggaran yang terdeteksi (untuk audit/red-team). [] = aman.
export function violations(text = "") {
  return CHECKS.filter(([, re]) => re.test(text)).map(([k]) => k);
}

// true = teks membuat janji/klaim terlarang.
export function hasPromise(text = "") {
  return violations(text).length > 0;
}

// Buang draf yang melanggar.
export function scrubSuggestions(suggestions = []) {
  return suggestions.filter((s) => !hasPromise(s?.text || ""));
}

// Paksa invarian per-draf: requiresHumanReview SELALU true, kolom minimal ada.
export function enforceSuggestion(s, { intent = null, source = "llm" } = {}) {
  return {
    id: s.id || `s${Math.random().toString(36).slice(2, 8)}`,
    text: String(s.text || "").trim(),
    tone: s.tone || "informatif",
    intent: s.intent || intent,
    source,
    confidence: null, // tanpa false precision di 4B.0
    requiresHumanReview: true, // WAJIB — draft-only
    disclaimers: s.disclaimers?.length ? s.disclaimers : ["Draf AI — tinjau & kirim manual."],
  };
}

// Validasi payload lengkap terhadap invarian kontrak Wave 4A (hard-fail).
// intents = detectedIntents, dipakai untuk cek complaint/handover WAJIB blocked.
export function assertPayload(payload, intents = []) {
  assertContractInvariants({ ...payload, _detectedIntents: intents });
  return true;
}
