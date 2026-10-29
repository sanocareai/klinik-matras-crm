import { tampilSaldoKeadaan } from "./koreksiSaldoLogic.js";

// Logika murni halaman Stok & Lokasi. Membedakan "belum ada catatan" (saldo null) dari nol, dan "batas minimum belum diatur" (null) dari 0.
export const FILTER_KEADAAN = Object.freeze([
  { key: "", label: "Semua keadaan" },
  { key: "ADA", label: "Ada stok" },
  { key: "MENIPIS", label: "Menipis (di bawah minimum)" },
  { key: "TERPESAN_PENUH", label: "Seluruhnya sudah dipesan" },
  { key: "NOL_TERHITUNG", label: "Nol menurut pergerakan" },
  { key: "MINUS", label: "Saldo minus" },
  { key: "BELUM_ADA_CATATAN", label: "Belum ada catatan stok" },
  { key: "HABIS_ATAU_MINUS", label: "Saldo nol atau minus" },
]);
const KEADAAN_HABIS_MINUS = new Set(["NOL_TERHITUNG", "MINUS"]);

/** Saringan Harga Berlaku (HPP operasional). "Belum ada harga" = tidak ada harga yang SEDANG berlaku (bahan dengan harga terjadwal saja ikut, sama dengan tulisan di kolom Harga). Bukan Rp0. */
export const FILTER_HARGA = Object.freeze([
  { key: "", label: "Semua harga" },
  { key: "BELUM", label: "Belum ada harga berlaku" },
  { key: "ADA", label: "Sudah ada harga berlaku" },
  { key: "TERJADWAL", label: "Ada harga terjadwal (belum berlaku)" },
]);
/** Saringan kelengkapan data bahan. Batas minimum null = belum diatur (BUKAN 0). */
export const FILTER_LAIN = Object.freeze([
  { key: "", label: "Semua kelengkapan" },
  { key: "BATAS_BELUM", label: "Batas minimum belum diatur" },
  { key: "BATAS_ADA", label: "Batas minimum sudah diatur" },
  { key: "VENDOR_KOSONG", label: "Belum ada vendor" },
  { key: "VENDOR_ADA", label: "Sudah ada vendor" },
]);
/** Harga sedang berlaku untuk bahan ini? (peta = ringkasan daftar Harga Berlaku). */
const punyaHarga = (peta, id) => { const h = peta?.harga?.[id]; return h?.harga !== null && h?.harga !== undefined; };
export const cocokHarga = (peta, id, key) => (!key || !peta ? true : key === "ADA" ? punyaHarga(peta, id) : key === "BELUM" ? !punyaHarga(peta, id) : key === "TERJADWAL" ? !!peta.harga?.[id]?.terjadwal : true);
export const cocokLain = (r, key) => {
  if (!key) return true;
  const batas = r.batasMinimum !== null && r.batasMinimum !== undefined; const vendor = !!String(r.vendor ?? "").trim();
  return key === "BATAS_BELUM" ? !batas : key === "BATAS_ADA" ? batas : key === "VENDOR_KOSONG" ? !vendor : key === "VENDOR_ADA" ? vendor : true;
};
/** Hitungan per opsi saringan atas bahan di cakupan dasar (aktif, kecuali nonaktif diminta), untuk label opsi "(n)". */
export function hitungOpsiSaring(rows, { petaHarga = null, nonaktif = false } = {}) {
  const dasar = rows.filter((r) => nonaktif || r.aktif); const satuan = new Map();
  for (const r of dasar) { const u = String(r.satuan ?? "").trim(); if (u) satuan.set(u, (satuan.get(u) ?? 0) + 1); }
  return {
    harga: Object.fromEntries(FILTER_HARGA.filter((x) => x.key).map((x) => [x.key, dasar.filter((r) => cocokHarga(petaHarga, r.materialId, x.key)).length])),
    lain: Object.fromEntries(FILTER_LAIN.filter((x) => x.key).map((x) => [x.key, dasar.filter((r) => cocokLain(r, x.key)).length])),
    keadaan: Object.fromEntries(FILTER_KEADAAN.filter((x) => x.key).map((x) => [x.key, dasar.filter((r) => (x.key === "HABIS_ATAU_MINUS" ? KEADAAN_HABIS_MINUS.has(r.keadaan) : r.keadaan === x.key)).length])),
    satuan: [...satuan].sort((a, b) => a[0].localeCompare(b[0])).map(([kode, n]) => ({ kode, n })),
  };
}

const WARNA = { ADA: "green", MENIPIS: "orange", TERPESAN_PENUH: "orange", NOL_TERHITUNG: "neutral", MINUS: "red", BELUM_ADA_CATATAN: "neutral", NONAKTIF: "neutral" };
export const warnaKeadaan = (k) => WARNA[k] ?? "neutral";

const angka = (v) => Number(v).toLocaleString("id-ID", { maximumFractionDigits: 4 });
/** "—" = belum ada catatan (BUKAN nol). */
export const teksSaldo = (r) => (r.saldo === null || r.saldo === undefined ? "—" : angka(r.saldo));
/** "—" = belum diatur (BUKAN nol). */
export const teksBatasMinimum = (r) => (r.batasMinimum === null || r.batasMinimum === undefined ? "belum diatur" : angka(r.batasMinimum));

/**
 * Saring daftar Stok & Lokasi.
 *  • tab/jenis = jenis persediaan (kategori master: RAW_MATERIAL/WIP/FINISHED_GOODS/CONSUMABLE, atau "none" = tanpa kategori).
 *  • kelompok  = kelompok bahan operasional (kode dari server: BUSA, KAIN, …, atau "BELUM" = belum dikelompokkan).
 *  • cari      = kode/nama/vendor. PENCARIAN MENCARI SELURUH BAHAN: bila ada kata kunci, kelompok dan jenis TIDAK menyaring (hasil menampilkan kelompoknya) — lihat `jangkauanCari`.
 */
export function saringStok(rows, { tab = "", jenis = "", kelompok = "", cari = "", keadaan = "", nonaktif = false, harga = "", petaHarga = null, lain = "", satuan = "" } = {}) {
  const q = String(cari).trim().toLowerCase(); const j = jenis || tab; const mencari = !!q;
  return rows.filter((r) => {
    if (!nonaktif && !r.aktif) return false;
    if (!mencari) {
      if (j === "none" && r.kategori) return false;
      if (j && j !== "none" && r.kategori !== j) return false;
      if (kelompok && (r.kelompok?.kode ?? "BELUM") !== kelompok) return false;
    }
    if (keadaan && (keadaan === "HABIS_ATAU_MINUS" ? !KEADAAN_HABIS_MINUS.has(r.keadaan) : r.keadaan !== keadaan)) return false;
    if (harga && !cocokHarga(petaHarga, r.materialId, harga)) return false;
    if (!cocokLain(r, lain)) return false;
    if (satuan && String(r.satuan ?? "").trim() !== satuan) return false;
    if (mencari && !`${r.kode} ${r.nama} ${r.vendor ?? ""} ${r.kelompok?.label ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Apakah daftar ditampilkan: hanya bila pengguna memilih kelompok, menyaring keadaan, mencari, atau meminta semua. Layar awal = navigasi kelompok (bukan 358 baris). */
export const daftarTampil = ({ kelompok = "", cari = "", keadaan = "", jenis = "", semua = "", harga = "", lain = "", satuan = "" } = {}) => !!(kelompok || String(cari).trim() || keadaan || jenis || semua || harga || lain || satuan);
/** Kata-kata untuk pengguna tentang cakupan hasil saat ini. */
export function jangkauanCari({ kelompok = "", cari = "", labelKelompok = "" } = {}) {
  if (String(cari).trim()) return { mode: "cari", teks: kelompok ? `Mencari di semua kelompok (bukan hanya ${labelKelompok || "kelompok terpilih"}).` : "Mencari di semua kelompok." };
  if (kelompok) return { mode: "kelompok", teks: `Kelompok ${labelKelompok || kelompok}.` };
  return { mode: "semua", teks: "Semua kelompok." };
}

export const FILTER_JENIS = Object.freeze([
  { key: "", label: "Semua jenis" }, { key: "RAW_MATERIAL", label: "Bahan Baku" }, { key: "WIP", label: "Setengah Jadi" }, { key: "FINISHED_GOODS", label: "Barang Jadi" }, { key: "CONSUMABLE", label: "Habis Pakai" }, { key: "none", label: "Tanpa kategori" },
]);
/** Kunci jenis dari server ("NONE") ↔ kunci filter UI ("none"). */
export const kunciJenis = (kode) => (kode === "NONE" ? "none" : kode);

/**
 * Tampilan saldo yang membedakan TIGA keadaan yang berbeda artinya:
 *  • belum diketahui — belum ada catatan pergerakan stok (bukan nol),
 *  • nol — ada catatan dan hasilnya nol (habis menurut pergerakan),
 *  • minus — catatan lebih kecil dari nol (perlu dihitung fisik).
 * @returns {{jenis:"BELUM_DIKETAHUI"|"NOL"|"MINUS"|"ADA", teks:string, keterangan:string}}
 */
export function tampilSaldo(r) {
  // Server baru mengirim keadaanSaldo: tiga "nol" berbeda (belum ada catatan / nol menurut pergerakan / nol TERVERIFIKASI hitung fisik) tidak pernah digabung.
  const dariServer = tampilSaldoKeadaan(r); if (dariServer) return dariServer;
  if (r.saldo === null || r.saldo === undefined) return { jenis: "BELUM_DIKETAHUI", teks: "belum diketahui", keterangan: "Belum ada catatan pergerakan stok — bukan berarti habis" };
  if (Number(r.saldo) < 0) return { jenis: "MINUS", teks: angka(r.saldo), keterangan: "Saldo minus — catatan perlu dihitung fisik dan dikoreksi resmi" };
  if (Number(r.saldo) === 0) return { jenis: "NOL", teks: "0", keterangan: "Nol menurut pergerakan stok" };
  return { jenis: "ADA", teks: angka(r.saldo), keterangan: "" };
}

/** Lokasi dari RIWAYAT penerimaan (bukan lokasi stok saat ini — sistem tidak menyimpan saldo per lokasi). null bila tidak ada penerimaan bertanggal. */
export function riwayatLokasi(r) {
  const l = r.lokasiTerakhir;
  if (!l?.lokasi) return null;
  const tgl = l.waktu ? new Date(l.waktu).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : null;
  return { lokasi: l.lokasi, tanggal: tgl, teks: `Terakhir diterima di ${l.lokasi}${tgl ? ` (${tgl})` : ""}` };
}
