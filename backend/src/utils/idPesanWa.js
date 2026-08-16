// Mengambil ID pesan WhatsApp yang STABIL dari string externalId WAHA.
//
// KENAPA PERLU. WAHA menyusun externalId dari beberapa bagian:
//
//     {fromMe}_{chatJid}_{idPesan}[_{pengirim}]
//
// Bagian pertama dan terakhir BISA BERBEDA untuk pesan yang SAMA. Contoh
// nyata dari production (16 Agt 2026, grup SANO SALES) — satu pesan yang
// kita kirim sendiri lalu digemakan balik oleh WAHA:
//
//   dikirim CRM : true_...@g.us_3EB0D2E1B2462CE7F000D1_6285187283900@c.us
//   gema webhook: false_...@g.us_3EB0D2E1B2462CE7F000D1_222681874051121@lid
//
// Sama-sama pesan 3EB0D2E1B2462CE7F000D1, tapi:
//   - prefix true_ vs false_  (WAHA tidak mengenali gema itu milik kita)
//   - akhiran nomor kita vs bentuk LID-nya
//
// Akibatnya dedup yang membandingkan externalId UTUH tidak pernah cocok,
// dan pesan keluar kita muncul DUA KALI di grup: sekali sebagai bubble
// sendiri, sekali lagi sebagai pesan masuk atas nama "Klinik Matras by
// Sano". Bagian TENGAH-lah satu-satunya yang stabil.

/**
 * @param {string|null} externalId
 * @returns {string|null} ID pesan WhatsApp murni, atau null kalau tidak
 *   bisa diurai (jangan menebak — pemanggil harus jatuh ke perilaku aman).
 */
export function idPesanInti(externalId) {
  const s = String(externalId || "").trim();
  if (!s) return null;

  const bagian = s.split("_");
  // Bentuk minimal yang bisa diandalkan: fromMe_chatJid_idPesan.
  // Kurang dari itu berarti formatnya di luar dugaan — lebih baik
  // mengembalikan null daripada mengarang potongan yang salah, karena
  // hasilnya dipakai untuk MENGHAPUS/melewati pesan.
  if (bagian.length < 3) return null;

  const id = bagian[2];
  return id ? id : null;
}
