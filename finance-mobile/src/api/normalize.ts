import { isLosslessNumber, parse } from "lossless-json";
import { toMoney } from "@/lib/money";

// BATAS API: JSON dari server memuat uang sebagai ANGKA (mis. 1234567.89 atau 50000).
// `JSON.parse` biasa mengubahnya jadi JS Number (float). Di sini teks JSON dibaca dengan
// lossless-json sehingga literal angka dipertahankan, lalu:
//   • angka dengan pecahan                    → string desimal (Money)
//   • angka bulat pada kunci bernuansa uang   → string desimal (Money)
//   • angka bulat lainnya (hitungan, id)      → Number
// Jadi TIDAK ADA nilai uang yang pernah menjadi float di klien.
//
// Default berpihak pada keamanan uang: kunci yang tidak dikenal tetapi mengandung kata
// bernuansa uang (total, saldo, nilai, …) diperlakukan SEBAGAI UANG. Kalau ternyata
// hitungan (mis. `total` pada daftar jurnal), endpoint itu menyebutnya lewat `hitungan`
// — kesalahannya langsung terlihat sebagai string, bukan diam-diam menjadi float.

const POLA_KUNCI_UANG =
  /(amount|nominal|saldo|nilai|sisa|debit|credit|kredit|laba|beban|pendapatan|retur|selisih|masuk|keluar|arus|terlunasi|value|harga|fee|total)/i;

/** Kunci yang PASTI hitungan/metadata (bukan uang) di semua endpoint. */
const KUNCI_HITUNGAN = new Set([
  "jumlah", "count", "limit", "offset", "expiresIn", "status", "lineNo", "sortOrder", "take",
  "gapTerbuka", "periodeTerbuka", "dihapus", "berhasil", "gagal", "dicabut", "retryAfterSeconds",
]);

export type OpsiNormalisasi = {
  /** Kunci tambahan yang PASTI hitungan pada endpoint ini (mis. `total` pada daftar jurnal). */
  hitungan?: string[];
  /** Kunci tambahan yang PASTI uang pada endpoint ini (mis. `id` tidak, tapi `feeAmount` ya). */
  uang?: string[];
};

function ubah(node: unknown, kunci: string | null, opsi: OpsiNormalisasi): unknown {
  if (isLosslessNumber(node)) {
    const teks = node.value;
    if (/[eE]/.test(teks)) {
      // Decimal(18,2) tidak pernah dicetak dengan eksponen; kalau muncul, itu bukan uang yang kita kenal.
      throw new Error(`Angka berformat eksponen tidak didukung: ${teks}`);
    }
    const hitungan = kunci != null && (KUNCI_HITUNGAN.has(kunci) || (opsi.hitungan?.includes(kunci) ?? false));
    const uangEksplisit = kunci != null && (opsi.uang?.includes(kunci) ?? false);
    const uangDugaan = kunci != null && !hitungan && POLA_KUNCI_UANG.test(kunci);
    const desimal = teks.includes(".");
    if (uangEksplisit || uangDugaan || (desimal && !hitungan)) return toMoney(teks);
    return node.valueOf();
  }
  if (Array.isArray(node)) return node.map((x) => ubah(x, kunci, opsi));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = ubah(v, k, opsi);
    return out;
  }
  return node;
}

/** Parse teks JSON respons → objek dengan uang berupa string desimal. */
export function parseResponse<T = unknown>(teks: string, opsi: OpsiNormalisasi = {}): T {
  return ubah(parse(teks), null, opsi) as T;
}
