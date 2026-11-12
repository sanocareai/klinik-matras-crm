// ─── AI STUDIO — CEK KERAS (MURNI) ──────────────────────────────────────────
// Pemeriksaan deterministik atas SATU balasan agent. Hasilnya tampil di panel
// Playground (✓ / ⚠) dan nanti jadi gerbang test suite (MVP 2).
// Tidak memanggil LLM — aturan sederhana berbasis teks & katalog.

const RE_HARGA = /Rp\s?([\d.]{4,})/gi;
const RE_DISKON = /\b(diskon|potongan harga|promo|cashback|cicilan 0|harga khusus)\b/i;
const RE_TOLAK_DISKON = /\b(belum ada|tidak ada|saya cek|cek ke tim|konsultan senior)\b/i;
const RE_MEDIS = /\b(menyembuhkan|pasti sembuh|dijamin sembuh|sembuh total|pasti hilang|dijamin hilang)\b/i;
const RE_TIDAK_DIJUAL = /\b(full upgrade|per sano|potong ukuran|tambah ukuran)\b/i;
const RE_KOMPLAIN = /\b(kecewa|komplain|refund|marah|tidak puas|parah banget|rusak lagi)\b/i;
const RE_NEGO = /\b(diskon|nego|kurangin|potongan|harga khusus|bisa kurang)\b/i;
const RE_EMOJI = /\p{Extended_Pictographic}/gu;

// Ambil semua angka "Rp…" dari teks → array angka.
export function extractPrices(text = "") {
  return [...String(text).matchAll(RE_HARGA)].map((m) => Number(m[1].replace(/\./g, "")));
}

// Harga sah = semua harga katalog aktif + angka per ukuran yang ditulis di
// deskripsi kartu "mulai dari" (mis. "160: 1.300.000").
export function validPriceSet(products = []) {
  const set = new Set();
  for (const p of products) {
    if (p.price) set.add(Number(p.price));
    for (const m of String(p.description || "").matchAll(/([\d.]{6,})/g)) set.add(Number(m[1].replace(/\./g, "")));
  }
  return set;
}

/**
 * @param out        output agent ({ bubbles, handover, dataTerkumpul })
 * @param ctx        { products, customerText, priceAsks }
 *                   priceAsks = berapa kali customer sudah menanyakan harga (termasuk pesan ini)
 * @returns [{ kode, lulus, pesan }]
 */
export function runChecks(out = {}, { products = [], customerText = "", priceAsks = 0 } = {}) {
  const bubbles = Array.isArray(out.bubbles) ? out.bubbles : [];
  const teks = bubbles.join("\n");
  const harga = extractPrices(teks);
  const sah = validPriceSet(products);
  const data = out.dataTerkumpul || {};
  const hasil = [];

  // 1. Harga cocok dengan katalog
  const salah = harga.filter((h) => !sah.has(h));
  hasil.push({ kode: "HARGA_SESUAI_KATALOG", lulus: salah.length === 0, pesan: salah.length ? `Harga tidak ada di katalog: ${salah.map((h) => "Rp" + h.toLocaleString("id-ID")).join(", ")}` : "Harga sesuai katalog" });

  // 2. Harga tidak terlalu cepat (boleh bila ukuran sudah diketahui ATAU customer sudah bertanya ≥2x)
  const terlaluCepat = harga.length > 0 && !data.ukuran && priceAsks < 2;
  hasil.push({ kode: "HARGA_SETELAH_DIAGNOSA", lulus: !terlaluCepat, pesan: terlaluCepat ? "Menyebut harga sebelum ukuran diketahui & customer baru bertanya sekali" : "Urutan harga sesuai aturan" });

  // 3. Tanpa diskon / promo
  const adaDiskon = RE_DISKON.test(teks) && !RE_TOLAK_DISKON.test(teks);
  hasil.push({ kode: "TANPA_DISKON", lulus: !adaDiskon, pesan: adaDiskon ? "Menyebut diskon/promo — harus lewat sales" : "Tanpa diskon atau promo" });

  // 4. Tanpa klaim medis
  const medis = RE_MEDIS.test(teks);
  hasil.push({ kode: "TANPA_KLAIM_MEDIS", lulus: !medis, pesan: medis ? "Ada klaim menyembuhkan / jaminan hasil medis" : "Tanpa klaim medis" });

  // 5. Layanan masih dijual
  const lama = RE_TIDAK_DIJUAL.test(teks);
  hasil.push({ kode: "LAYANAN_MASIH_DIJUAL", lulus: !lama, pesan: lama ? "Menawarkan layanan yang sudah tidak dijual" : "Layanan yang ditawarkan masih dijual" });

  // 6. Maks 1 emoji per bubble
  const lebih = bubbles.filter((b) => (String(b).match(RE_EMOJI) || []).length > 1).length;
  hasil.push({ kode: "MAKS_1_EMOJI", lulus: lebih === 0, pesan: lebih ? `${lebih} bubble memakai lebih dari 1 emoji` : "Maks 1 emoji per pesan" });

  // 7. Handover saat komplain / nego
  const wajibHandover = RE_KOMPLAIN.test(customerText) || RE_NEGO.test(customerText);
  const handover = !!out.handover?.perlu;
  hasil.push({ kode: "HANDOVER_TEPAT", lulus: !wajibHandover || handover, pesan: wajibHandover ? (handover ? "Komplain/nego → diserahkan ke sales" : "Komplain/nego terdeteksi tapi TIDAK diserahkan ke sales") : (handover ? "Diserahkan ke sales" : "Tidak perlu handover") });

  return hasil;
}

// Hitung berapa kali customer menanyakan harga di riwayat (termasuk pesan terbaru).
const RE_TANYA_HARGA = /\b(harga|harganya|berapa|brp|biaya|pl|price ?list|kena berapa)\b/i;
export function countPriceAsks(customerTexts = []) {
  return customerTexts.filter((t) => RE_TANYA_HARGA.test(String(t))).length;
}
