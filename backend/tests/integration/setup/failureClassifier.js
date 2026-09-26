// Klasifikasi kegagalan dari keluaran `node --test` untuk runIsolated.js.
//
// Kegagalan berpola "Can't reach database server at localhost:5432" (Prisma P1001) adalah gangguan
// KONEKTIVITAS infrastruktur (proxy port Docker Desktop di Windows), bukan perilaku kode yang diuji:
// Postgres tidak restart dan tidak mencatat error, dan seluruh tes dalam SATU berkas gagal dalam hitungan
// milidetik. Runner mengulang HANYA berkas seperti itu, satu kali, dan mencatatnya terang-terangan.
// Kegagalan lain (assertion, timeout transaksi, dsb.) TIDAK pernah diulang otomatis.

const POLA_KONEKSI = /Can't reach database server/;
const POLA_BERKAS = /test at (tests[\\/]integration[\\/][^\s:]+\.integration\.test\.js)/;

/** @returns {{ koneksi: string[], lain: string[] }} berkas (path relatif backend, slash maju) */
export function klasifikasiKegagalan(keluaran) {
  const i = keluaran.indexOf("failing tests:");
  if (i < 0) return { koneksi: [], lain: [] };
  const blok = keluaran.slice(i).split(/\r?\n(?=test at )/).slice(1);
  const perBerkas = new Map(); // berkas -> true bila SEMUA blok kegagalannya karena koneksi
  for (const b of blok) {
    const m = POLA_BERKAS.exec(b);
    if (!m) continue;
    const berkas = m[1].replace(/\\/g, "/");
    const karenaKoneksi = POLA_KONEKSI.test(b);
    perBerkas.set(berkas, (perBerkas.get(berkas) ?? true) && karenaKoneksi);
  }
  const koneksi = [];
  const lain = [];
  for (const [berkas, hanyaKoneksi] of perBerkas) (hanyaKoneksi ? koneksi : lain).push(berkas);
  return { koneksi, lain };
}
