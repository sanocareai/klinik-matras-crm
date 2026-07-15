// ─── WAVE 4B.0 — TEMPLATE FALLBACK (PURE, DETERMINISTIK, AMAN) ───────────────
// Dipakai saat: LLM nonaktif / API key tidak ada / provider gagal / kuota harian
// habis / plafon biaya bulanan tercapai / semua draf LLM ke-scrub. TIDAK PERNAH
// menjanjikan harga/pengiriman/diskon (aman by design). Output deterministik.
import { enforceSuggestion } from "./validator.js";

const TEXTS = {
  PRICE_INQUIRY: [
    "Terima kasih sudah menanyakan. Boleh saya tahu ukuran dan pemakainya, supaya tim kami bisa bantu hitung rincian yang paling pas untuk Bapak/Ibu?",
    "Untuk harga yang akurat, tim kami akan bantu konfirmasi sesuai kebutuhan ya. Sebelumnya, keluhan tidur yang dirasakan seperti apa?",
  ],
  SIZE_INQUIRY: [
    "Untuk ukuran, kami sediakan beberapa pilihan umum (160/180/200). Kasurnya untuk berapa orang dan berapa berat badannya ya, supaya rekomendasinya pas?",
  ],
  CATALOG_REQUEST: [
    "Dengan senang hati kami siapkan katalognya. Boleh dibantu info dulu, keluhan tidur atau kebutuhan utamanya apa ya?",
  ],
  ORDER_INTENT: [
    "Baik, terima kasih. Supaya prosesnya pas, boleh saya konfirmasi dulu kebutuhannya? Tim kami akan bantu lanjutkan langkah berikutnya.",
  ],
  SCHEDULING: [
    "Untuk penjadwalan, tim kami akan bantu konfirmasi ketersediaannya ya. Boleh dibantu lokasi pengirimannya di daerah mana?",
  ],
  DEFAULT: [
    "Terima kasih sudah menghubungi Klinik Matras. Boleh diceritakan keluhan tidur atau kebutuhannya, supaya kami bisa bantu dengan tepat?",
  ],
};

// Draf template untuk 1 intent. Deterministik (urutan tetap).
export function templateSuggestions(intent) {
  const texts = TEXTS[intent] || TEXTS.DEFAULT;
  return texts.map((text, i) =>
    enforceSuggestion(
      { id: `tpl-${i + 1}`, text, tone: "hangat", disclaimers: ["Draf template — tinjau sebelum kirim."] },
      { intent: intent || null, source: "template" }
    )
  );
}
