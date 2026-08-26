// ═══ SALES RISK ENGINE — training module hint (rule-based, PERSIAPAN) ═════
// BUKAN Sales Quality Engine (itu masih rencana masa depan, TIDAK dibangun
// di sini) — ini cuma LOOKUP kecil rule-based supaya output Sales Risk
// Engine sudah punya "hint" arah training yang relevan tanpa perlu
// perubahan skema nanti saat Sales Quality Engine benar-benar dibangun.
// 3 modul SANO Class yang disebut eksplisit — JANGAN tambah modul baru di
// sini tanpa konfirmasi (bukan wewenang fitur ini utk mendefinisikan
// kurikulum training).
export const TRAINING_MODULES = {
  COMMUNICATION_SKILL: "Communication Skill",
  AUTHORITY_SELLING: "Authority Selling",
  OBJECTION_HANDLING: "Objection Handling",
};

// First-match-wins, sama pola dgn nextBestAction.js (Priority Engine) —
// TIDAK memanggil/mengubah nextBestAction.js itu sendiri.
export function mapTrainingModuleHint(signals) {
  if (signals.hasComplaintLikeKeyword) return TRAINING_MODULES.OBJECTION_HANDLING;
  if (signals.isNeglected && signals.hasBuyingIntent) return TRAINING_MODULES.AUTHORITY_SELLING;
  if (signals.isNeglected) return TRAINING_MODULES.COMMUNICATION_SKILL;
  return null;
}
