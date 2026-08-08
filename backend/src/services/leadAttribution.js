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

// ─── Tag "(ref: ...)" dari website sanomatrassehat.com ─────────────────────
//
// Google Search & PMax mendarat di WEBSITE dulu (bukan langsung ke
// WhatsApp seperti TrackedLink), jadi jejak "dari campaign mana" akan
// hilang begitu customer pindah ke WA — KECUALI website-nya sendiri
// menempelkan tag ke pesan yang dikirim. Lihat utils/attribution.ts di
// repo SANO-WEB: kalau pengunjung datang dari iklan (ada utm_source/
// gclid/fbclid di URL), tombol WA di situs menambahkan
// " (ref: google-cpc-namacampaign)" di akhir pesan prefilled.
//
// Ini sinyal PALING KUAT yang tersedia (eksplisit, bukan tebakan/
// kemiripan teks) — makanya dicek PALING AWAL, sebelum Lapis 1
// (pencocokan teks ke TrackedLink).
const REF_TAG_PATTERN = /\s*\(ref:\s*([a-z0-9-]+)\)\s*$/i;

/**
 * Pisahkan tag "(ref: ...)" dari teks pesan asli.
 * @returns {{ cleaned: string, tag: string|null }} cleaned = teks TANPA
 *   tag (ini yang disimpan/ditampilkan ke sales, bukan teks mentahnya —
 *   supaya chat tidak kelihatan aneh ada kode nempel di akhir kalimat).
 */
export function extractRefTag(text) {
  const asli = String(text || "");
  const match = REF_TAG_PATTERN.exec(asli);
  if (!match) return { cleaned: asli, tag: null };
  return { cleaned: asli.slice(0, match.index).trimEnd(), tag: match[1].toLowerCase() };
}

/** Tag ref (mis. "google-cpc-brand") -> LeadSource. Prefix source yang menentukan. */
export function leadSourceFromRefTag(tag) {
  if (!tag) return null;
  if (tag.startsWith("google")) return "GOOGLE_ADS";
  if (tag.startsWith("meta")) return "META_ADS";
  return "OTHER";
}
