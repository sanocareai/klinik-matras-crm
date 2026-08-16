// Merapikan nomor HP Indonesia yang DIKETIK MANUSIA jadi bentuk baku
// "628xxxxxxxxx" — format yang dipakai di seluruh database & WAHA.
//
// KENAPA PERLU. Fitur "cari nomor lalu chat" menerima ketikan bebas dari
// sales, dan di lapangan nomor ditulis dengan segala macam gaya:
//   0851-8728-3900   +62 851 8728 3900   62851 8728 3900   (0851) 87283900
// Semuanya nomor yang SAMA. Tanpa dibakukan, satu orang bisa punya
// beberapa Customer terpisah di CRM hanya karena beda cara ketik — dan
// itu memecah riwayat chat & order yang seharusnya jadi satu.

/** Panjang wajar nomor Indonesia SETELAH jadi 62xxx (62 + 9..13 digit). */
const MIN_PANJANG = 11;
const MAX_PANJANG = 15;

/**
 * @param {string} input nomor apa adanya dari ketikan pengguna
 * @returns {{ok: true, nomor: string} | {ok: false, alasan: string}}
 *
 * SENGAJA mengembalikan alasan yang bisa langsung ditampilkan ke sales,
 * bukan cuma null — "kenapa nomor saya ditolak" adalah pertanyaan pertama
 * yang muncul, dan menjawabnya di tempat lebih baik daripada membuat
 * mereka menebak.
 */
export function bakukanNomorIndonesia(input) {
  // Buang semua yang bukan angka: spasi, strip, kurung, titik, tanda plus.
  const angka = String(input || "").replace(/\D/g, "");
  if (!angka) return { ok: false, alasan: "Nomor masih kosong" };

  let n = angka;

  // 0851... -> 62851...
  if (n.startsWith("0")) {
    n = "62" + n.slice(1);
  } else if (n.startsWith("62")) {
    // sudah benar
  } else if (n.startsWith("8")) {
    // Sales sering mengetik tanpa 0 maupun 62 ("85187283900").
    n = "62" + n;
  } else {
    return {
      ok: false,
      alasan: "Nomor harus nomor Indonesia (diawali 08, 62, atau 8)",
    };
  }

  if (n.length < MIN_PANJANG) return { ok: false, alasan: "Nomor terlalu pendek" };
  if (n.length > MAX_PANJANG) return { ok: false, alasan: "Nomor terlalu panjang" };

  // 620851... — hasil orang mengetik "+62" DAN "0" sekaligus. Ini bentuk
  // yang tampak benar sekilas tapi menghasilkan nomor yang tidak pernah ada.
  if (n.startsWith("620")) {
    return { ok: false, alasan: "Nomor tidak valid — jangan pakai 0 setelah 62" };
  }

  return { ok: true, nomor: n };
}
