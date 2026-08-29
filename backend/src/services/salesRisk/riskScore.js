// ═══ SALES RISK ENGINE — skor + klasifikasi rule-based + explainability ═══
import {
  NEGLECT_WEIGHTS, INTENT_WEIGHTS, WAITING_BUCKETS, PIPELINE_WEIGHTS, VALUE_WEIGHTS,
  CRITICAL_WAIT_HOURS, HIGH_WAIT_HOURS,
} from "./weights.js";
import { mapTrainingModuleHint } from "./trainingMap.js";

function waitingPoints(hours) {
  for (const b of WAITING_BUCKETS) if (hours <= b.maxHours) return b.points;
  return WAITING_BUCKETS[WAITING_BUCKETS.length - 1].points;
}

function neglectPoints(s) {
  if (!s.isNeglected) return 0;
  const extra = Math.min(NEGLECT_WEIGHTS.maxExtra, Math.max(0, s.unansweredCount - 1) * NEGLECT_WEIGHTS.perExtraUnanswered);
  return NEGLECT_WEIGHTS.base + extra;
}

function intentPoints(s) {
  let pts = 0;
  if (s.hasKeywordOrPhrase) pts += INTENT_WEIGHTS.keywordOrPhrase;
  if (s.hasLocation) pts += INTENT_WEIGHTS.location;
  return pts;
}

function pipelinePoints(s) {
  if (s.isTransaction) return PIPELINE_WEIGHTS.transaction;
  if (s.prospectStalled) return PIPELINE_WEIGHTS.prospectStalled;
  if (s.stage === "PROSPECT") return PIPELINE_WEIGHTS.prospect;
  return PIPELINE_WEIGHTS.other;
}

function valuePoints(s) {
  if (s.orderValue >= VALUE_WEIGHTS.highValueMin) return VALUE_WEIGHTS.highValuePoints;
  if (s.orderValue >= VALUE_WEIGHTS.midValueMin) return VALUE_WEIGHTS.midValuePoints;
  if (s.orderCount >= 1) return VALUE_WEIGHTS.repeatCustomerPoints;
  return 0;
}

// Skor 0-100 — HANYA dipakai utk mengurutkan DI DALAM satu tier (bukan
// penentu tier, lihat classifyRiskTier). Breakdown disertakan utk
// explainability/debug, bukan ditampilkan sbg "skor" ke user awam di UI.
export function computeSalesRiskScore(s) {
  const breakdown = {
    neglect: neglectPoints(s),
    intent: intentPoints(s),
    waiting: waitingPoints(s.waitingHours),
    pipeline: pipelinePoints(s),
    value: valuePoints(s),
  };
  const total = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0));
  return { total, breakdown };
}

// Klasifikasi RULE-BASED — baca sinyal MENTAH langsung (waitingHours,
// hasBuyingIntent, isTransaction, dst), BUKAN turunan dari skor komposit.
// First-match-wins, pola sama dgn nextBestAction.js (Priority Engine, TIDAK
// disentuh). Skor tidak pernah dicek di sini sama sekali.
const TIER_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
// Turunkan tier ke maxTier kalau tier mentah lebih tinggi — TIDAK PERNAH
// menaikkan (sebuah cap, bukan override dua arah).
function capTier(tier, maxTier) {
  return TIER_RANK[tier] > TIER_RANK[maxTier] ? maxTier : tier;
}

function classifyRiskTierRaw(s) {
  if (s.waitingHours > CRITICAL_WAIT_HOURS && (s.hasBuyingIntent || s.isTransaction)) return "CRITICAL";
  if (s.waitingHours > CRITICAL_WAIT_HOURS) return "HIGH";
  if (s.waitingHours > HIGH_WAIT_HOURS && (s.hasBuyingIntent || s.isTransaction)) return "HIGH";
  if (s.isNeglected && s.prospectStalled) return "HIGH";
  if (s.waitingHours > HIGH_WAIT_HOURS) return "MEDIUM";
  if (s.isNeglected) return "MEDIUM";
  if (s.prospectStalled) return "MEDIUM";
  return "LOW";
}

// Gerbang intent pesan terakhir (29 Agustus 2026) — PERLUASAN dari gerbang
// CRITICAL yang sudah ada (via hasBuyingIntent, tidak diubah). Masalah yang
// diperbaiki di sini: tier mentah di atas bisa jadi HIGH murni dari DURASI
// (waitingHours > CRITICAL_WAIT_HOURS saja, baris ke-2) atau kombinasi
// isNeglected+prospectStalled (baris ke-4) — DUA-DUANYA TIDAK PERNAH mengecek
// isi pesan sama sekali. Itu sebabnya customer yang pesan terakhirnya
// PENOLAKAN/basa-basi penutup (Dipatikarna, Intan Antasari, dll — lihat
// investigasi 29 Agustus 2026) tetap nongol HIGH walau sudah jelas selesai.
// Cap diterapkan SETELAH tier mentah dihitung, apa pun jalur yang
// menghasilkannya — bukan menambah cabang baru ke waterfall di atas.
//   PENOLAKAN / PLEASANTRY_PENUTUP → maksimal LOW (customer tetap tampil di
//     daftar, cuma severity-nya jujur, bukan hilang dari list).
//   NETRAL_AMBIGU → maksimal MEDIUM ("perlu dicek manual", bukan diklaim
//     minat ATAUPUN ditolak).
//   PERTANYAAN_MENGGANTUNG / MINAT_AKTIF / NETRAL / null (belum
//     diklasifikasi/cache stale) → TIDAK di-cap, perilaku lama utuh.
export function classifyRiskTier(s) {
  const tier = classifyRiskTierRaw(s);
  if (s.latestMessageIntent === "PENOLAKAN" || s.latestMessageIntent === "PLEASANTRY_PENUTUP") {
    return capTier(tier, "LOW");
  }
  if (s.latestMessageIntent === "NETRAL_AMBIGU") {
    return capTier(tier, "MEDIUM");
  }
  return tier;
}

function formatHoursIndonesia(hours) {
  if (hours < 24) return `${Math.floor(hours)} jam`;
  return `${Math.floor(hours / 24)} hari`;
}

// Explainability WAJIB: problem, evidence, recommendedAction — bahasa
// Indonesia awam, TANPA istilah "skor"/"sinyal"/AI. Ditulis di sini (bukan
// di UI) supaya konsisten dipakai lintas channel (dashboard, alert WA nanti).
// `problemTags` (29 Agustus 2026) — dibangun DI BLOK YANG SAMA dgn `problems`
// (bukan parser teks terpisah thd kalimat yang sudah digabung) supaya tidak
// ada drift antara tag & kalimat penuh — sumbernya SAMA PERSIS sinyal
// terstruktur (isNeglected/hasLocation/dst), cuma direpresentasikan 2 cara:
// kalimat lengkap (utk detail/expand) & label pendek (utk tampilan utama
// kartu, lihat SalesRisk.jsx). Ditemukan lewat cek sumber data (ticket
// eksplisit minta verifikasi ini dulu) — problem SEBELUMNYA cuma kalimat
// gabungan tanpa versi terstruktur diekspos ke frontend sama sekali.
export function explainRisk(s, customer) {
  const problems = [];
  const problemTags = [];
  if (s.isNeglected) {
    problems.push(
      s.unansweredCount > 1
        ? `Pelanggan mengirim ${s.unansweredCount} pesan berturut-turut tanpa dibalas sales`
        : "Pesan terakhir pelanggan belum dibalas sales sama sekali"
    );
    problemTags.push(s.unansweredCount > 1 ? `${s.unansweredCount}x belum dibalas` : "Belum dibalas");
  }
  if (s.hasLocation) {
    problems.push("Pelanggan sudah kirim lokasi penjemputan");
    problemTags.push("Kirim lokasi");
  }
  if (s.hasKeywordOrPhrase && !s.hasLocation) {
    problems.push("Pelanggan menunjukkan minat beli yang jelas");
    problemTags.push("Minat tinggi");
  }
  if (s.isTransaction) {
    problems.push("Sudah masuk tahap transaksi — closing di depan mata");
    problemTags.push("Transaksi");
  } else if (s.prospectStalled) {
    problems.push("Prospek macet, belum ada progres lanjutan");
    problemTags.push("Macet");
  }

  // NETRAL_AMBIGU (29 Agustus 2026) — pesan terakhir terlalu pendek utk
  // disimpulkan pasti (mis. "Mahal" sendirian). TIDAK diklaim sbg sinyal
  // minat (hasKeywordOrPhrase sudah otomatis false utk kasus ini, lihat
  // signals.js) — cukup dicatat jujur perlu dicek manual, ditaruh PALING
  // DEPAN supaya jadi alasan utama yang terlihat, tapi problem struktural
  // lain (mis. belum dibalas) tetap ikut tampil kalau memang ada.
  if (s.latestMessageIntent === "NETRAL_AMBIGU") {
    problems.unshift("Respons ambigu — perlu dicek manual (pesan terakhir terlalu pendek utk disimpulkan pasti)");
    problemTags.unshift("Ambigu — cek manual");
  }

  const problem = problems.length ? problems.join("; ") : "Tidak ada masalah signifikan terdeteksi";

  const evidence = {
    lastInboundAt: s.lastInboundAt ? s.lastInboundAt.toISOString() : null,
    lastOutboundAt: s.lastOutboundAt ? s.lastOutboundAt.toISOString() : null,
    waitingDuration: s.isNeglected ? formatHoursIndonesia(s.waitingHours) : null,
    unansweredCount: s.unansweredCount,
    quote: s.recentInboundQuote,
    stage: s.stage,
  };

  let recommendedAction;
  if (s.latestMessageIntent === "NETRAL_AMBIGU") {
    // Diprioritaskan di atas cabang isNeglected lain — jangan sampai
    // rekomendasi menyiratkan "pelanggan siap"/minat kuat padahal pesan
    // terakhirnya genuinely ambigu.
    recommendedAction = `Cek manual balasan ${customer.name || "pelanggan ini"} — pesan terakhirnya terlalu pendek/ambigu utk disimpulkan otomatis, jangan diperlakukan sebagai sinyal minat.`;
  } else if (s.isNeglected && (s.hasLocation || s.hasKeywordOrPhrase)) {
    recommendedAction = `Segera hubungi ${customer.name || "pelanggan ini"} — pelanggan sudah siap, jangan sampai dingin.`;
  } else if (s.isNeglected) {
    recommendedAction = `Balas pesan ${customer.name || "pelanggan ini"} sekarang, walau belum ada tanda-tanda minat kuat.`;
  } else if (s.prospectStalled) {
    recommendedAction = `Follow up ulang ${customer.name || "pelanggan ini"} — sudah lama tidak ada progres.`;
  } else {
    recommendedAction = "Tidak ada tindakan mendesak — pantau berkala.";
  }

  return { problem, problemTags, evidence, recommendedAction };
}

export function buildSalesRisk(signals, customer) {
  const { total, breakdown } = computeSalesRiskScore(signals);
  const tier = classifyRiskTier(signals);
  const { problem, problemTags, evidence, recommendedAction } = explainRisk(signals, customer);
  const trainingModuleHint = mapTrainingModuleHint(signals);
  return { score: Math.round(total), scoreBreakdown: breakdown, tier, problem, problemTags, evidence, recommendedAction, trainingModuleHint };
}
