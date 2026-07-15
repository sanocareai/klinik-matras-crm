// ─── WAVE 4B.0/4B.0.5 — TEMPLATE FALLBACK (PURE, DETERMINISTIK, AMAN) ────────
// Dipakai saat: LLM nonaktif / API key tidak ada / provider gagal / kuota harian
// habis / plafon biaya bulanan tercapai / semua draf LLM ke-scrub. TIDAK PERNAH
// menjanjikan harga/pengiriman/diskon (aman by design). Output deterministik.
// Wave 4B.0.5: suara konsultan kasur sehat (diagnosa dulu), BUKAN CS generik —
// selaras docs/business/klinik-matras-ai-persona.md ("kak", gali kebutuhan
// dulu sebelum arahkan ke tim). TIDAK melewati validator (dipercaya-by-construction)
// — setiap teks di sini WAJIB tetap lolos hasPromise()===false (dicek di test).
import { enforceSuggestion } from "./validator.js";

const TEXTS = {
  PRICE_INQUIRY: [
    "Boleh cerita dulu kak, kasurnya untuk siapa dan biasanya keluhan bangun tidur di bagian mana? Biar tim bisa bantu arahkan yang paling pas dulu ya.",
    "Untuk harga, nanti tim kami bantu konfirmasi sesuai kebutuhan kakak ya. Sebelum itu, kasur yang sekarang sudah dipakai berapa lama?",
  ],
  SIZE_INQUIRY: [
    "Untuk ukuran, kami sediakan beberapa pilihan umum. Kasurnya dipakai sendiri atau berdua, dan kira-kira berat badannya berapa ya kak? Biar rekomendasinya presisi.",
  ],
  CATALOG_REQUEST: [
    "Dengan senang hati kami bantu kirim katalognya kak. Sebelumnya boleh cerita dulu, keluhan tidur atau kebutuhan utamanya apa ya?",
  ],
  ORDER_INTENT: [
    "Baik kak, terima kasih. Biar prosesnya pas, boleh dibantu info dulu kebutuhannya (pemakai, keluhan, ukuran)? Nanti tim lanjutkan langkah berikutnya.",
  ],
  SCHEDULING: [
    "Untuk jadwal, tim kami akan bantu konfirmasi ketersediaannya ya kak. Boleh dibantu info lokasi pengirimannya di daerah mana?",
  ],
  DEFAULT: [
    "Terima kasih sudah menghubungi Klinik Matras kak 🙏 Boleh cerita dulu, keluhan kasurnya seperti apa? Bangun tidur biasanya terasa pegal di bagian mana?",
    "Setiap kasur punya pendekatan berbeda-beda kak — di Klinik Matras kami fokus ke kesesuaian fondasi dan lapisan dengan kebutuhan tidur masing-masing orang, bukan cuma soal keras atau empuknya.",
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
