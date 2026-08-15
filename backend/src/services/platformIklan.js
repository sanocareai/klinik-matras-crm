// Menyimpulkan PLATFORM (Facebook / Instagram / WhatsApp) dari string
// Customer.leadSourceDetail.
//
// KENAPA DITURUNKAN, BUKAN DISIMPAN JADI ENUM SENDIRI. LeadSource di
// database cuma punya META_ADS — satu nilai untuk Facebook DAN Instagram,
// karena keduanya memang satu sistem iklan (Meta Ads Manager, satu
// campaign bisa tayang di dua-duanya sekaligus). Memecah enum jadi
// META_ADS_FB / META_ADS_IG akan:
//   1. butuh migrasi enum yang menyentuh ribuan baris, dan
//   2. TETAP TIDAK BISA mengisi platform untuk lead lama — data itu
//      memang tidak pernah tersimpan sebelum perbaikan CTWA 13 Agt 2026.
// Menurunkannya dari leadSourceDetail memberi pemisahan yang diminta
// TANPA memalsukan data lama: yang tidak diketahui tetap terang-terangan
// "tidak diketahui", bukan ditebak jadi salah satu.

/** Nilai yang mungkin dikembalikan — dipakai juga untuk label di UI. */
export const PLATFORM = {
  FACEBOOK: "FACEBOOK",
  INSTAGRAM: "INSTAGRAM",
  WHATSAPP: "WHATSAPP",
  UNKNOWN: "UNKNOWN",
};

/**
 * @param {string|null} detail  isi Customer.leadSourceDetail
 * @returns {string} salah satu PLATFORM
 *
 * Bentuk detail yang ditemui di data produksi (14 Agt 2026):
 *   "Meta CTWA - facebook - fb.me/77pJdJNsy"        -> FACEBOOK
 *   "Meta CTWA - instagram - instagram.com/p/xxx"   -> INSTAGRAM
 *   "Meta CTWA - whatsapp - wa.me/wamo/status/..."  -> WHATSAPP (iklan Status)
 *   "Meta CTWA - fb.me/77pJdJNsy"                   -> FACEBOOK (dari domainnya)
 *   "Meta CTWA - instagram.com/p/xxx"               -> INSTAGRAM (dari domainnya)
 *   "Website - ig-paid-52681422227284"              -> INSTAGRAM
 *   "Website - fb-paid-52681422227284"              -> FACEBOOK
 *   "Meta Ads (retroaktif: ...)"                    -> UNKNOWN
 */
export function platformDariDetail(detail) {
  const t = String(detail || "").toLowerCase();
  if (!t) return PLATFORM.UNKNOWN;

  // Kata platform eksplisit lebih dipercaya daripada tebakan domain —
  // entryPointConversionApp dari Meta ditulis di posisi ini.
  if (/\binstagram\b/.test(t) || /\big-paid\b/.test(t) || /instagram\.com/.test(t)) {
    return PLATFORM.INSTAGRAM;
  }
  if (/\bfacebook\b/.test(t) || /\bfb-paid\b/.test(t) || /fb\.me/.test(t)) {
    return PLATFORM.FACEBOOK;
  }
  // Iklan Status WhatsApp — placement Meta yang sah, bukan chat organik.
  if (/\bwhatsapp\b/.test(t) || /wa\.me\/wamo/.test(t)) {
    return PLATFORM.WHATSAPP;
  }
  return PLATFORM.UNKNOWN;
}

// ⚠️ CATATAN PENTING soal urutan pemeriksaan di atas. Ada detail berbentuk
// "Meta CTWA - facebook - instagram.com/p/DXWbO-EAOeT" di data nyata —
// Meta melaporkan app=facebook tapi kreatifnya postingan Instagram (iklan
// yang dijalankan dari Ads Manager memakai postingan IG sebagai materi,
// lalu ditayangkan di Facebook). Untuk kasus itu fungsi ini mengembalikan
// INSTAGRAM karena pemeriksaan instagram didahulukan.
//
// Itu PILIHAN SADAR, bukan kelalaian: yang lebih berguna untuk keputusan
// belanja iklan adalah "kreatif mana yang menarik orang", dan kreatifnya
// jelas postingan Instagram itu. Kalau suatu saat yang lebih dibutuhkan
// adalah "ditayangkan DI MANA", tukar urutannya — dan perbarui tes
// platformIklan.test.js yang mengunci perilaku ini.
