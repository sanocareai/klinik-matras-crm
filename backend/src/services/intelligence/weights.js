// ─── SANO INTELLIGENCE ENGINE — KONFIGURASI TERPUSAT (Wave 4A) ───────────────
// Satu-satunya tempat bobot/threshold/keyword. Deterministik, explainable, TANPA
// LLM / API eksternal / biaya token. Tune nanti dari perilaku sales nyata.

export const ENGINE_VERSION = "4a-1.0.0";

// Keyword intent (Bahasa Indonesia). Dipakai signals.detectIntents + scoring.
export const KEYWORDS = {
  price:       /harga|berapa|nego|biaya/i,
  size:        /ukuran|dimensi|\b160\b|\b180\b|\b200\b/i,
  promo:       /promo|diskon|potongan/i,
  installment: /cicilan|kredit|tempo/i,
  ready:       /ready|stok|tersedia|sedia/i,
  catalog:     /katalog|foto|gambar|brosur/i,
  order:       /\bbeli\b|pesan|order|checkout|\bdp\b|booking/i,
  complaint:   /komplain|rusak|kecewa|refund|garansi|amblas|kempes|jelek/i,
  handover:    /telepon|telpon|\bcall\b|ngobrol|bicara|orangnya|sales/i,
  scheduling:  /jadwal|kapan|pengiriman|diantar|antar/i,
};

// Ambang batas (menit / hari / jumlah).
export const THRESHOLDS = {
  unansweredMinutes: 180,   // >3 jam = follow-up menunggu
  inactivity30: 30,
  inactivity60: 60,
  abandonedQuoteDays: 3,    // QUOTED tapi diam >3 hari
  repeatOrderDays: 365,     // customer lama, order terakhir >12 bulan
  activeConvMessages: 3,    // percakapan aktif = >=3 pesan dalam recentActivityDays
  recentActivityDays: 3,
  opportunityRecentDays: 7, // kandidat opportunity
  candidateRecentDays: 30,  // kandidat priority
};

// Health Score — kualitas relasi (PORT PERSIS dari customer360 3A).
export const HEALTH_WEIGHTS = {
  base: 50,
  orderBase: 20,
  orderValueMax: 15, orderValuePer: 5_000_000,
  stage: { WON: 15, QUOTED: 10, QUALIFIED: 5 },
  recency: { d2: 15, d7: 10, d14: 5 },
  complaintPenalty: 25,
  inactivity: { d60: 25, d30: 15 },
  unansweredPenalty: 10,
};

// Priority Score — urgensi sales ("act now"). Sinyal mendesak bobot tinggi.
export const PRIORITY_WEIGHTS = {
  complaintOpen: 30,
  unansweredBase: 25, unansweredPerDay: 3, unansweredMaxExtra: 10,
  quotationAbandoned: 20,
  intentAny: 10,
  highValue: 10, highValueMin: 5_000_000,
  stageQuoted: 8,
  recentActive: 7,
};

// Opportunity Score — probabilitas beli. Keyword diperluas + perilaku.
export const OPPORTUNITY_WEIGHTS = {
  keyword: { price: 20, ready: 15, catalog: 12, size: 10, promo: 8, installment: 8 },
  keywordCap: 45,
  stageQuoted: 20, stageQualified: 8,
  activeConversation: 15,
  returning: 10,
};
