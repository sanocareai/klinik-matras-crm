// ═══ SALES RISK ENGINE — klasifikasi intent PESAN TERAKHIR (LLM) ══════════
// GANTI regex keyword-presence (\bbeli\b dkk thd 5 pesan digabung) yang
// terbukti 2 bug independen (investigasi 29 Agustus 2026):
//   1. Regex TIDAK sadar negasi — "Gk jadi kak, saya udah beli kasur baru"
//      match \bbeli\b, salah kebaca MINAT_AKTIF padahal PENOLAKAN.
//   2. recentText menggabungkan 5 pesan INBOUND jadi SATU string — minat
//      yang disebut di pesan ke-2 dari 5 masih "menempel" ke evaluasi walau
//      pesan TERAKHIR cuma penutup basa-basi ("terima kasih infonya").
// Reuse regex dari staleLeadAlertJob.js (isClosingPleasantry/isExplicitDecline)
// SUDAH DICOBA & GAGAL: verbatim 0/4 kasus laporan tertangkap (variasi bahasa
// terlalu banyak: "gk jadi" vs "ga jadi", "nga" vs "ngga/engga", batas
// panjang kalimat exact-match). Regex bukan pendekatan yang tepat utk
// distinction "kata produk dalam kalimat MINAT" vs "kata produk dalam
// kalimat PENOLAKAN/PENUTUP" — sama persis kelas masalah dgn akuiPresent/
// galiPresent yang butuh LLM, bukan regex, di Quality Scorer.
import { chatWithTools } from "../providers/anthropicProvider.js";
import { getAnthropicKey } from "../replyAssistant/providers/keyStore.js";
import { AI_MODELS } from "../../config/aiModels.js";

export const LATEST_MESSAGE_INTENT_VALUES = [
  "MINAT_AKTIF",
  "PENOLAKAN",
  "PLEASANTRY_PENUTUP",
  "PERTANYAAN_MENGGANTUNG",
  "NETRAL",
  // NETRAL_AMBIGU (29 Agustus 2026) — kategori BARU, KHUSUS pesan sangat
  // pendek (1-3 kata) yang genuinely tidak bisa disimpulkan pasti sebagai
  // MINAT_AKTIF ATAU PENOLAKAN dari konteks yang tersedia (mis. "Mahal" saja,
  // tanpa kalimat pembatalan/lanjutan). BUKAN keranjang sampah utk kasus sulit
  // yang sebenarnya BISA disimpulkan — lihat rambu ketat di buildIntentPrompt.
  "NETRAL_AMBIGU",
];

export function resolveSalesRiskIntentApiKey() {
  const key = getAnthropicKey();
  if (!key) throw new Error("Tidak ada API key Anthropic aktif di AI Playground (data/ai-models.json) — klasifikasi intent Sales Risk butuh key yang sama.");
  return key.apiKey;
}

function buildIntentTool() {
  return {
    name: "submit_intent",
    description: "Klasifikasikan maksud PESAN TERAKHIR customer, berdasarkan konteks beberapa pesan sebelumnya.",
    input_schema: {
      type: "object",
      properties: {
        latestMessageIntent: { type: "string", enum: LATEST_MESSAGE_INTENT_VALUES },
      },
      required: ["latestMessageIntent"],
      additionalProperties: false,
    },
  };
}

// `recentInbound` = array pesan INBOUND (customer→sales) TERURUT KRONOLOGIS,
// maks 5 (sama window dgn signals.js lama) — TAPI prompt SECARA EKSPLISIT
// instruksikan LLM cuma menilai pesan TERAKHIR, 4 lainnya sekadar konteks.
function buildIntentPrompt(recentInbound) {
  const n = recentInbound.length;
  const formatted = recentInbound
    .map((m, i) => {
      const tag = i === n - 1 ? " — INI PESAN TERAKHIR, YANG DINILAI" : " (konteks saja)";
      return `[Pesan ${i + 1}/${n}${tag}] "${(m.content || "").slice(0, 300)}"`;
    })
    .join("\n");

  return `Kamu menganalisis percakapan WhatsApp customer klinik kasur (Klinik Matras Sano Care) dengan sales. Berikut pesan-pesan TERAKHIR dari CUSTOMER (bukan dari sales), urut kronologis lama→baru:

${formatted}

TUGAS: klasifikasikan maksud PESAN TERAKHIR SAJA (baris paling bawah, ditandai "INI PESAN TERAKHIR"). Pesan-pesan sebelumnya HANYA konteks — JANGAN menilai pesan lama seolah itu pesan yang sedang dievaluasi, walau pesan lama menyebut minat/harga/produk.

Pilih SATU dari 6 kategori:
- MINAT_AKTIF: pesan terakhir menunjukkan ketertarikan/niat beli yang MASIH BERLAKU SAAT INI (nanya harga/ukuran/jadwal, minta lanjut proses, kirim lokasi, konfirmasi mau lanjut, negosiasi harga tapi TETAP ingin lanjut).
- PENOLAKAN: pesan terakhir menolak/membatalkan/sudah beli di tempat lain — MESKIPUN kalimatnya menyebut kata yang terdengar seperti minat (mis. "beli", "kasur", "harga"). UJI WAJIB: kalau ADA kata negasi/pembatalan ("gak/gk/ga/nga/ngga jadi", "batal", "udah beli [tempat lain]", "kemahalan") yang MENGUBAH makna kalimat jadi penolakan, itu PENOLAKAN — bukan MINAT_AKTIF, walau ada kata produk di dalamnya.
- PLEASANTRY_PENUTUP: basa-basi penutup wajar ("terima kasih", "terima kasih infonya", "siap", "oke", "makasih ya") TANPA pertanyaan/permintaan baru — percakapan terasa SELESAI secara alami, bukan menggantung. Termasuk variasi dengan tambahan kata sopan ("Pak"/"Kak") atau info tambahan pendek ("atas infonya").
- PERTANYAAN_MENGGANTUNG: ada pertanyaan/permintaan dari customer yang BELUM dijawab sales (pesan terakhir ini customer SEDANG MENUNGGU balasan) TAPI isinya BUKAN soal niat beli aktif (mis. komplain, pertanyaan teknis netral, pertanyaan administratif).
- NETRAL: tidak masuk kategori lain (mis. cuma emoji tanpa makna jelas, pesan tidak relevan konteks jualan) TAPI maknanya tetap JELAS (bukan ambigu).
- NETRAL_AMBIGU: pesan SANGAT PENDEK (1-3 kata), TIDAK ADA kata pembatalan/kelanjutan/negasi/tanya apa pun di sekitarnya, dan SECARA JUJUR bisa ditafsirkan ke DUA ARAH yang sama-sama masuk akal (mis. keberatan-tapi-mungkin-masih-lanjut ATAU alasan berhenti). PAKAI HANYA kalau setelah membaca konteks kamu BENAR-BENAR tidak bisa memilih salah satu dari 4 kategori di atas dengan yakin — JANGAN jadikan ini "pilihan aman" utk kasus yang sebenarnya BISA disimpulkan dari kata di sekitarnya (kalau ada kata pembatalan → tetap PENOLAKAN; kalau ada kata penutup wajar → tetap PLEASANTRY_PENUTUP; kalau ada pertanyaan lanjutan → tetap MINAT_AKTIF/PERTANYAAN_MENGGANTUNG).

CONTOH KASUS SULIT (kata yang terdengar seperti minat BUKAN otomatis MINAT_AKTIF — perhatikan konteks penuh kalimat):
- "Gk jadi kak, saya udah beli kasur baru🙏" → PENOLAKAN (ada kata "beli" tapi didahului "gk jadi" = pembatalan eksplisit, dan "beli" merujuk ke PEMBELIAN DI TEMPAT LAIN)
- "maaf...nga jadi..tks🙏" → PENOLAKAN ("nga jadi" = varian informal "enggak jadi")
- "Terima kasih infonya" → PLEASANTRY_PENUTUP
- "Siap, terima kasih atas infonya Pak" → PLEASANTRY_PENUTUP
- "Kalo besok max jam 4 apakah bisa ya?" → MINAT_AKTIF (menanyakan jadwal penjemputan/kunjungan, artinya proses masih berjalan)
- "harga ini tdk bisa dikurangi🙏🏻" (dari customer, menegosiasi) → MINAT_AKTIF (masih tawar-menawar, bukan menolak)
- "Mahal" (SATU KATA, tanpa kalimat sebelum/sesudah yang menjelaskan lanjut atau berhenti) → NETRAL_AMBIGU (bisa berarti "mahal, jadi saya berhenti" ATAU "mahal, tapi masih mikir/nego" — tidak cukup konteks utk pilih salah satu)
- "mahal banget, gajadi deh" → PENOLAKAN, BUKAN NETRAL_AMBIGU (ada "gajadi deh" = pembatalan eksplisit, jadi tidak ambigu lagi)
- "Oke" atau "👍" SAJA sebagai balasan thd penawaran/harga tanpa keterangan lain → NETRAL_AMBIGU (bisa berarti "oke, lanjut" ATAU sekadar mengonfirmasi terima info tanpa niat lanjut)

Jawab HANYA berdasarkan pesan CUSTOMER di atas.`;
}

/**
 * Klasifikasi intent pesan terakhir SATU customer. 1 panggilan LLM.
 * @param {{content:string, createdAt:Date|string}[]} recentInbound - pesan
 *   INBOUND kronologis (lama→baru), maks 5, SAMA window dgn signals.js.
 * @returns {{intent: string, usage: object}}
 */
export async function classifyLatestMessageIntent({ recentInbound, apiKey }) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  if (!recentInbound || recentInbound.length === 0) {
    return { intent: "NETRAL", usage };
  }
  const tool = buildIntentTool();
  const { toolCalls, usage: u } = await chatWithTools({
    apiKey,
    model: AI_MODELS.SANO_SALES_RISK_INTENT,
    systemPrompt: "Kamu supervisor training SANO Care (Klinik Matras) yang menilai percakapan sales-customer.",
    messages: [{ role: "user", content: buildIntentPrompt(recentInbound) }],
    tools: [tool],
    toolChoice: { type: "tool", name: tool.name },
    maxTokens: 200,
  });
  usage.inputTokens += u.inputTokens || 0;
  usage.outputTokens += u.outputTokens || 0;
  usage.cacheReadTokens += u.cacheReadTokens || 0;
  usage.cacheCreateTokens += u.cacheCreateTokens || 0;

  const call = toolCalls.find((c) => c.name === tool.name);
  if (!call) throw new Error("LLM tidak memanggil tool submit_intent (kemungkinan output terpotong maxTokens).");
  const intent = LATEST_MESSAGE_INTENT_VALUES.includes(call.input.latestMessageIntent)
    ? call.input.latestMessageIntent
    : "NETRAL"; // fallback null-safe kalau LLM keliru sebut nilai di luar enum
  return { intent, usage };
}
