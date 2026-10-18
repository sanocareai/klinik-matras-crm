// KELOMPOK BAHAN OPERASIONAL (Okt 2026, UX Gudang Tahap 3) — navigasi di Stok & Lokasi: Busa, Kain, Benang, Pegas, Kayu, Lem/Kimia, Aksesori, Lainnya.
// BEDA dengan jenis persediaan (Material.category: Bahan Baku / Setengah Jadi / Barang Jadi / Habis Pakai) — keduanya dimensi terpisah.
//
// PRINSIP: kelompok TIDAK ditebak dari nama bahan. Satu-satunya sumber adalah metadata yang SUDAH ada: Material.itemGroup (kolom "BARANG" dari stock opname Excel).
// Pemetaan di bawah per-NILAI itemGroup (tabel eksplisit, bisa diaudit), hanya untuk grup yang artinya jelas. Grup yang isinya campuran atau tidak jelas, dan bahan tanpa itemGroup,
// TIDAK dimasukkan ke kelompok mana pun → "Belum dikelompokkan (perlu keputusan)". Tidak ada kelompok yang disimpan permanen di database: ini tampilan turunan (read-only).
// Rancangan penyimpanan permanen + daftar keputusan manual: docs/GUDANG-UX-TAHAP3.md.

export const KELOMPOK = Object.freeze({
  BUSA: "Busa", KAIN: "Kain", BENANG: "Benang", PEGAS: "Pegas", KAYU: "Kayu", LEM_KIMIA: "Lem/Kimia", AKSESORI: "Aksesori", LAINNYA: "Lainnya",
});
export const KELOMPOK_BELUM = "BELUM";
export const LABEL_BELUM = "Belum dikelompokkan";
export const URUTAN_KELOMPOK = Object.freeze([...Object.keys(KELOMPOK), KELOMPOK_BELUM]);

// itemGroup (dinormalkan: trim, spasi tunggal, HURUF BESAR) → kode kelompok.
const PETA = {
  BUSA: ["REBONDED", "BUSA", "HR FOAM", "SOFT FOAM", "BUSA LATEX", "MEMORY FOAM", "BUSA S", "HR KULIT"],
  KAIN: ["KAIN", "KAIN KNITTING"],
  BENANG: ["BENANG"],
  PEGAS: ["PER BONNEL", "PER POCKET", "PER KEONG"],
  KAYU: ["KAYU", "KAYU RACUK", "TRIPLEK"],
  LEM_KIMIA: ["LEM", "THINER"],
  AKSESORI: ["PAKU", "STREPLES", "STEPLES", "WEBING", "LIST CORNER", "TALI TIS", "RING", "C RING"],
  // "Lainnya" = grup yang JELAS bukan salah satu dari tujuh kelompok di atas (lapisan/pelapis, plastik, rangka besi, alat, dan barang jadi). Bukan tempat membuang yang tidak jelas.
  LAINNYA: ["PE", "PLASTIK", "COTTONSHEET", "COTTON SHEET/HARDPAD", "HARDPAD", "SPUNBON", "BESI", "CUTTER", "GERGAJI", "SELANG", "SPRAY GUN", "LAKBAN", "KAPUR", "KARET BAN",
    "COVER KASUR", "KASUR SEWA", "STOCK PASAMEBEL", "BED", "KASUR BUSA"],
};
// Grup yang SENGAJA tidak dipetakan (isi campuran/maknanya belum jelas) — ditampilkan di audit sebagai keputusan manual.
export const GRUP_PERLU_KEPUTUSAN = Object.freeze(["SUPPORT KAIN", "SUPPORT", "KANCING", "KAKI", "LACI", "RODA", "SUDUT", "SAKURA", "OSCAR", "STERILISASI"]);

export const normalkanGrup = (g) => String(g ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const TABEL = new Map(Object.entries(PETA).flatMap(([kode, grup]) => grup.map((g) => [g, kode])));
export const grupTerpetakan = () => [...TABEL.keys()];

/** Murni. { kode, label, sumber } — sumber "item_group" bila terpetakan; "belum" bila tidak (null/kosong, grup campuran, atau grup yang belum dikenal). */
export function kelompokDariItemGroup(itemGroup) {
  const n = normalkanGrup(itemGroup);
  const kode = n ? TABEL.get(n) : undefined;
  if (kode) return { kode, label: KELOMPOK[kode], sumber: "item_group" };
  return { kode: KELOMPOK_BELUM, label: LABEL_BELUM, sumber: "belum", alasan: !n ? "Bahan tidak punya itemGroup" : GRUP_PERLU_KEPUTUSAN.includes(n) ? `Grup "${n}" isinya campuran atau maknanya belum jelas — perlu keputusan manual` : `Grup "${n}" belum ada di tabel pemetaan` };
}

const JENIS = Object.freeze({ RAW_MATERIAL: "Bahan Baku", WIP: "Setengah Jadi", FINISHED_GOODS: "Barang Jadi", CONSUMABLE: "Habis Pakai" });
export const LABEL_JENIS = JENIS;

/**
 * Ringkasan per kelompok DAN per jenis dari baris Stok & Lokasi (hanya yang punya `kelompok`). Jujur:
 *   total = bahan aktif; diketahui = punya catatan stok; belumDiketahui = belum ada catatan (BUKAN habis); minus = saldo minus; nonaktif dihitung terpisah.
 */
export function ringkasKelompok(rows) {
  const kosong = () => ({ total: 0, diketahui: 0, belumDiketahui: 0, minus: 0, nol: 0, nonaktif: 0 });
  const tambah = (m, k, r) => { const o = m.get(k) ?? kosong(); if (!r.aktif) o.nonaktif++; else { o.total++; if (r.saldo === null) o.belumDiketahui++; else { o.diketahui++; if (r.saldo < 0) o.minus++; else if (r.saldo === 0) o.nol++; } } m.set(k, o); };
  const mk = new Map(URUTAN_KELOMPOK.map((k) => [k, kosong()])); const mj = new Map([...Object.keys(JENIS), "NONE"].map((k) => [k, kosong()]));
  for (const r of rows) { tambah(mk, r.kelompok?.kode ?? KELOMPOK_BELUM, r); tambah(mj, r.kategori ?? "NONE", r); }
  return {
    kelompok: URUTAN_KELOMPOK.map((kode) => ({ kode, label: kode === KELOMPOK_BELUM ? LABEL_BELUM : KELOMPOK[kode], ...mk.get(kode) })),
    jenis: [...Object.keys(JENIS), "NONE"].map((kode) => ({ kode, label: kode === "NONE" ? "Tanpa kategori" : JENIS[kode], ...mj.get(kode) })),
  };
}
