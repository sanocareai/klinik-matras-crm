// ─── WAVE 4B.0 — VALIDATOR & PROMISE SCRUBBER (PURE) ────────────────────────
// Backstop KERAS (bukan sekadar prompt): setiap draf harus lolos di sini sebelum
// keluar. Draf yang menjanjikan harga/pengiriman/diskon pasti DIBUANG. Kalau
// akhirnya kosong → pemanggil fallback ke template aman.
import { assertContractInvariants } from "../intelligence/replyReadiness.js";

// Nominal harga (Rp / "5 juta" / "5.000.000").
const PRICE_RE = /\brp\s*\d|\b\d{1,3}(?:[.,]\d{3})+\b|\b\d+\s*(?:juta|jt|ribu|rb)\b/i;
// Diskon/promo dengan angka atau persen.
const DISCOUNT_RE = /\b\d+\s*%|\bdiskon\b[^.]*\d|\bpotongan\b[^.]*\d/i;
// Janji waktu pengiriman/selesai yang spesifik.
const DELIVERY_RE = /\b(?:dikirim|sampai|tiba|diantar|selesai|jadi|ready|dikerjakan)\b[^.]{0,30}\b(?:\d+\s*(?:hari|jam|minggu|hr|hari kerja)|besok|lusa|hari ini)\b/i;

// true = teks membuat janji terlarang (harga/pengiriman/diskon pasti).
export function hasPromise(text = "") {
  return PRICE_RE.test(text) || DISCOUNT_RE.test(text) || DELIVERY_RE.test(text);
}

// Buang draf yang melanggar janji terlarang.
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
