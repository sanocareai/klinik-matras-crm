// Atribusi sumber lead — mencocokkan PESAN PERTAMA customer ke campaign.
//
// KENAPA INI ADA. Sebelumnya atribusi campaign cuma mengandalkan "ambil
// ClickEvent terakhir yang belum ter-match dalam 15 menit" (Lapis 2 di
// webhooks.js). Pencarian itu GLOBAL — tidak terikat ke orangnya sama
// sekali. Di volume 50-100 pesan/hari, dua orang yang mengklik iklan
// BERBEDA dalam 15 menit yang sama bisa tertukar sumbernya, dan setelah
// kejadian tidak ada jejak untuk mendeteksinya.
//
// Sinyal yang jauh lebih kuat sudah tersedia sejak awal tapi tidak pernah
// dipakai: link pelacakan melempar customer ke
// wa.me/<nomor>?text=<prefilledMessage>, jadi PESAN PERTAMA customer
// secara harfiah ADALAH teks kampanye itu. Mencocokkan teks =
// deterministik, tidak ada lomba waktu.
//
// ⚠️ SYARAT PAKAI: tiap campaign WAJIB punya prefilledMessage BERBEDA.
// Kalau dua link aktif memakai teks yang sama persis, fungsi ini sengaja
// menyerah (return null) alih-alih menebak. Menebak sumber iklan lebih
// berbahaya daripada mengaku tidak tahu — angkanya dipakai untuk
// keputusan belanja iklan, dan tebakan yang salah tidak kelihatan salah.
//
// ⚠️ INI TIDAK MENANGKAP 100% KLIK IKLAN. Sebagian customer menghapus
// atau mengetik ulang pesan prefilled sebelum mengirim. Yang tidak cocok
// jatuh ke Lapis 2 (jendela 15 menit) seperti sebelumnya — jadi ini
// menambah ketepatan, bukan menggantikan seluruh alurnya.

/** Samakan bentuk teks sebelum dibandingkan: huruf kecil, spasi rapat. */
function normalize(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Cari campaign yang pesan prefilled-nya jadi AWALAN pesan customer.
 *
 * Pakai awalan (bukan sama persis) karena customer sering menambahkan
 * kalimatnya sendiri di belakang teks bawaan — "Halo Sano, saya mau tanya
 * soal nyeri punggung. Umur saya 40th" harus tetap kena.
 *
 * @param {string} text  pesan pertama customer
 * @param {Array}  links link aktif: { id, name, category, prefilledMessage }
 * @returns {object|null} link yang cocok, atau null kalau tidak ada/ambigu
 */
export function matchCampaignByMessage(text, links) {
  const pesan = normalize(text);
  if (!pesan || !Array.isArray(links)) return null;

  const kandidat = links
    .map((l) => ({ link: l, teks: normalize(l.prefilledMessage) }))
    .filter((k) => k.teks && pesan.startsWith(k.teks));

  if (kandidat.length === 0) return null;

  // Yang paling PANJANG menang — teks kampanye yang lebih spesifik
  // mengalahkan teks umum yang kebetulan jadi awalannya. Contoh:
  //   A: "halo sano, saya mau konsultasi"
  //   B: "halo sano, saya mau konsultasi soal nyeri punggung"
  // Pesan yang persis sama dengan B cocok ke DUA-duanya; B yang benar.
  kandidat.sort((a, b) => b.teks.length - a.teks.length);

  // SERI = dua campaign memakai teks identik. Tidak ada cara membedakan,
  // jadi menyerah (biar jatuh ke Lapis 2) daripada memilih sembarang.
  if (kandidat.length > 1 && kandidat[1].teks.length === kandidat[0].teks.length) {
    return null;
  }

  return kandidat[0].link;
}

/** Kategori link (LinkCategory) -> sumber lead (LeadSource). */
export const CATEGORY_TO_LEAD_SOURCE = {
  META_ADS: "META_ADS",
  GOOGLE_ADS: "GOOGLE_ADS",
  WEBSITE_ORGANIC: "WEBSITE_ORGANIC",
  OTHER: "OTHER",
};
