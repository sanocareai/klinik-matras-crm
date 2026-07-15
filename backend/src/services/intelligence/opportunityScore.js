import { OPPORTUNITY_WEIGHTS as W, THRESHOLDS as T } from "./weights.js";

// Opportunity Score — PROBABILITAS BELI. Keyword intent (diperluas) + perilaku.
// Menggantikan HOT_WEIGHTS lama saat hot-leads migrasi (bentuk respons dijaga).
const INTENT_LABEL = {
  PRICE_INQUIRY: "Tanya harga", SIZE_INQUIRY: "Tanya ukuran", CATALOG_REQUEST: "Minta katalog",
  PROMO_INQUIRY: "Tanya promo", PAYMENT_INQUIRY: "Tanya pembayaran", AVAILABILITY: "Tanya ketersediaan",
};
// Kode intent → key bobot keyword.
const KW_FOR = {
  PRICE_INQUIRY: "price", AVAILABILITY: "ready", CATALOG_REQUEST: "catalog",
  SIZE_INQUIRY: "size", PROMO_INQUIRY: "promo", PAYMENT_INQUIRY: "installment",
};

export function computeOpportunity(s) {
  const signals = [];
  let score = 0, kwPts = 0;

  for (const code of s.detectedIntents) {
    const kw = KW_FOR[code];
    if (kw && W.keyword[kw]) { kwPts += W.keyword[kw]; if (INTENT_LABEL[code]) signals.push(INTENT_LABEL[code]); }
  }
  score += Math.min(kwPts, W.keywordCap);

  if (s.stage === "QUOTED") score += W.stageQuoted;
  else if (s.stage === "QUALIFIED") score += W.stageQualified;

  if (s.activityCount >= T.activeConvMessages) { score += W.activeConversation; signals.push("Percakapan aktif"); }
  if (s.isReturning) { score += W.returning; signals.push("Repeat customer"); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, signals };
}
