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
//
// Revisi 24 Agustus 2026 (restrukturisasi pipeline 7→4 — lihat
// schema.prisma enum PipelineStage): `abandonedQuoteDays` → `stalledProspectDays`.
// Dulu spesifik "sudah di-QUOTED tapi diam" (belum lanjut ke BOOKED); sekarang
// PROSPECT adalah SATU-SATUNYA stage aktif pra-transaksi, jadi maknanya
// digeneralisasi jadi "macet di PROSPECT terlalu lama" — nilai ambang (3 hari)
// TIDAK berubah, cuma cakupannya lebih luas (dulu cuma yang sudah di-quote).
export const THRESHOLDS = {
  unansweredMinutes: 180,   // >3 jam = follow-up menunggu
  inactivity30: 30,
  inactivity60: 60,
  stalledProspectDays: 3,   // PROSPECT tapi diam >3 hari (belum lanjut ke TRANSACTION atau SPAM)
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
  // Revisi 24 Agustus 2026: pipeline 7-stage LAMA (NEW/QUALIFIED/QUOTED/
  // BOOKED/SCHEDULED/COMPLETED/REVIEWED) turun jadi 4 (NEW/PROSPECT/
  // TRANSACTION/SPAM) — resolusi 6-tingkat sengaja hilang sesuai keputusan
  // bisnis (Order.status sekarang men-track progres operasional secara
  // terpisah, pipelineStage cukup posisi lead di funnel). Sinyal "sudah
  // kasih review" (REVIEWED lama, +16) sempat DIHAPUS.
  // Revisi 26 Agustus 2026: REVIEWED dikembalikan (permintaan owner) dengan
  // definisi BARU — testimoni/review PUBLIK (Google Maps/medsos), bukan lagi
  // "ditinjau internal". Bobotnya SEDIKIT LEBIH TINGGI dari TRANSACTION (20 vs
  // 18, beda dari +16 dulu) karena ini sinyal advokasi nyata dari pelanggan,
  // bukan cuma progres internal. SPAM TIDAK PUNYA bobot di sini sama sekali:
  // customer ber-stage SPAM difilter keluar SEBELUM sampai ke health score
  // (lihat index.js loadCandidates) — bukan diberi skor 0/negatif, memang
  // tidak pernah dinilai.
  stage: { NEW: 0, PROSPECT: 10, TRANSACTION: 18, REVIEWED: 20 },
  recency: { d2: 15, d7: 10, d14: 5 },
  complaintPenalty: 25,
  inactivity: { d60: 25, d30: 15 },
  unansweredPenalty: 10,
};

// Priority Score — urgensi sales ("act now"). Sinyal mendesak bobot tinggi.
export const PRIORITY_WEIGHTS = {
  complaintOpen: 30,
  unansweredBase: 25, unansweredPerDay: 3, unansweredMaxExtra: 10,
  prospectStalled: 20, // dulu quotationAbandoned — lihat THRESHOLDS.stalledProspectDays
  intentAny: 10,
  highValue: 10, highValueMin: 5_000_000,
  stageProspect: 8, // dulu stageQuoted — PROSPECT sekarang satu-satunya stage aktif pra-transaksi
  recentActive: 7,
};

// Opportunity Score — probabilitas beli. Keyword diperluas + perilaku.
export const OPPORTUNITY_WEIGHTS = {
  keyword: { price: 20, ready: 15, catalog: 12, size: 10, promo: 8, installment: 8 },
  keywordCap: 45,
  // Dulu stageQuoted:20 + stageQualified:8 (dua tingkatan). Sekarang cuma
  // PROSPECT — dipatok ke nilai QUOTED lama (bobot tertinggi) karena
  // diferensiasi "baru masuk vs sudah serius nego" sekarang murni datang
  // dari sinyal keyword di atas (price/ready/catalog/dst), bukan lagi dari
  // sub-tingkatan stage.
  stageProspect: 20,
  activeConversation: 15,
  returning: 10,
};
