// PENJAGA SATU-PERHITUNGAN-SEKALIGUS untuk laporan atribusi iklan (per proses backend).
//
// Laporan /api/atribusi/iklan (/, /d7, /sumber) dan tool MCP laporan Meta Ads memuat banyak customer/order/pembayaran sekaligus; dua perhitungan
// bersamaan membebani DB yang sama dengan Inbox. Dulu penjaganya variabel lokal di routes/attributionAds.js; sekarang di sini supaya endpoint dan
// konektor MCP berbagi SATU penjaga (bukan dua jalur yang bisa menembak DB bersamaan).
//
//   denganPenjaga(fn)              : jalankan fn bila bebas; bila sibuk → lempar SedangDihitungError (endpoint menjawab 429, perilaku lama).
//   denganAntrean(fn, {tungguMs})  : untuk konektor MCP: tunggu giliran sebentar (polling) lalu jalan; bila tetap sibuk → SedangDihitungError.
export class SedangDihitungError extends Error {
  constructor() {
    super("Laporan atribusi iklan sedang dihitung; coba lagi sebentar");
    this.statusCode = 429;
    this.code = "SEDANG_DIHITUNG";
  }
}

let sibuk = false;

export const sedangDihitung = () => sibuk;

export async function denganPenjaga(fn) {
  if (sibuk) throw new SedangDihitungError();
  sibuk = true;
  try {
    return await fn();
  } finally {
    sibuk = false;
  }
}

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

export async function denganAntrean(fn, { tungguMs = 15_000, langkahMs = 100 } = {}) {
  const batas = Date.now() + tungguMs;
  for (;;) {
    if (!sibuk) return denganPenjaga(fn);
    if (Date.now() >= batas) throw new SedangDihitungError();
    await tidur(langkahMs);
  }
}
