// PEMERIKSA DEKLARASI METRIK DI UI FINANCE — murni (tanpa fs/DB) supaya perilakunya bisa dibuktikan dengan sumber sintetis
// (lihat financeKontrakMetrik.test.js). Membaca TEKS sumber halaman/komponen dan melaporkan masalah per halaman; tidak pernah berhenti di halaman pertama yang bermasalah.
//
// Bentuk deklarasi yang dikenali (kunci = kunci metrik di services/finance/kontrakMetrik.js):
//   metrik="kunci"   metrik={"kunci"}   metrik: "kunci"      (satu kunci)
//   metrik={["a", "b"]}   metrik: ["a", "b"]                 (larik, mis. <KenapaBeda metrik={[...]} />)
// Kunci yang tidak berbentuk snake_case huruf kecil (kapital, tanda hubung, spasi, awalan angka) DILAPORKAN sebagai tidak valid — tidak dilewati diam-diam.

export const BENTUK_KUNCI = /^[a-z][a-z0-9_]*$/;

const POLA_TUNGGAL = /\bmetrik\s*[=:]\s*\{?\s*(["'`])((?:(?!\1).)*)\1/g;
const POLA_LARIK = /\bmetrik\s*[=:]\s*\{?\s*\[([^\]]*)\]/g;

/** Semua deklarasi metrik dalam sebuah sumber: [{ kunci, bentuk: "tunggal" | "larik" }] (urutan kemunculan). */
export function ekstrakDeklarasiMetrik(src) {
  const hasil = [];
  const teks = String(src ?? "");
  for (const m of teks.matchAll(POLA_TUNGGAL)) hasil.push({ kunci: m[2], bentuk: "tunggal", pos: m.index });
  for (const m of teks.matchAll(POLA_LARIK)) {
    for (const k of m[1].matchAll(/(["'`])((?:(?!\1).)*)\1/g)) hasil.push({ kunci: k[2], bentuk: "larik", pos: m.index });
  }
  return hasil.sort((a, b) => a.pos - b.pos).map(({ kunci, bentuk }) => ({ kunci, bentuk }));
}

/**
 * Periksa SATU halaman. `sumber` = teks halaman (+ komponen fitur yang dibaca bersama), `kunciKontrak` = Set kunci metrik kontrak,
 * `tanpaAngka` = halaman dinyatakan eksplisit tanpa angka uang. Mengembalikan daftar masalah (kosong = lolos).
 */
export function periksaHalamanMetrik({ nama, sumber, kunciKontrak, tanpaAngka = false }) {
  const masalah = [];
  const dekl = ekstrakDeklarasiMetrik(sumber);
  for (const d of dekl) {
    if (!BENTUK_KUNCI.test(d.kunci)) masalah.push(`${nama}: kunci metrik "${d.kunci}" tidak valid (harus snake_case huruf kecil/angka/garis bawah, diawali huruf)`);
    else if (!kunciKontrak.has(d.kunci)) masalah.push(`${nama}: metrik="${d.kunci}" tidak ada di kontrak`);
  }
  if (dekl.length === 0 && !tanpaAngka) masalah.push(`${nama}: halaman Finance tidak punya metrik kontrak dan belum dinyatakan tanpa angka uang`);
  return masalah;
}

/** Periksa banyak halaman SEKALIGUS: { [nama]: masalah[] } — setiap halaman diperiksa terlepas dari hasil halaman lain. */
export function periksaSemuaHalaman(halaman, kunciKontrak, tanpaAngka = new Set()) {
  const hasil = {};
  for (const { nama, sumber } of halaman) hasil[nama] = periksaHalamanMetrik({ nama, sumber, kunciKontrak, tanpaAngka: tanpaAngka.has(nama) });
  return hasil;
}
