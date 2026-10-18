// Logika murni halaman Stok & Lokasi. Membedakan "belum ada catatan" (saldo null) dari nol, dan "batas minimum belum diatur" (null) dari 0.
export const FILTER_KEADAAN = Object.freeze([
  { key: "", label: "Semua keadaan" },
  { key: "ADA", label: "Ada stok" },
  { key: "MENIPIS", label: "Menipis (di bawah minimum)" },
  { key: "TERPESAN_PENUH", label: "Seluruhnya sudah dipesan" },
  { key: "NOL_TERHITUNG", label: "Nol menurut pergerakan" },
  { key: "MINUS", label: "Saldo minus" },
  { key: "BELUM_ADA_CATATAN", label: "Belum ada catatan stok" },
]);

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
export function saringStok(rows, { tab = "", jenis = "", kelompok = "", cari = "", keadaan = "", nonaktif = false } = {}) {
  const q = String(cari).trim().toLowerCase(); const j = jenis || tab; const mencari = !!q;
  return rows.filter((r) => {
    if (!nonaktif && !r.aktif) return false;
    if (!mencari) {
      if (j === "none" && r.kategori) return false;
      if (j && j !== "none" && r.kategori !== j) return false;
      if (kelompok && (r.kelompok?.kode ?? "BELUM") !== kelompok) return false;
    }
    if (keadaan && r.keadaan !== keadaan) return false;
    if (mencari && !`${r.kode} ${r.nama} ${r.vendor ?? ""} ${r.kelompok?.label ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Apakah daftar ditampilkan: hanya bila pengguna memilih kelompok, menyaring keadaan, mencari, atau meminta semua. Layar awal = navigasi kelompok (bukan 358 baris). */
export const daftarTampil = ({ kelompok = "", cari = "", keadaan = "", jenis = "", semua = "" } = {}) => !!(kelompok || String(cari).trim() || keadaan || jenis || semua);
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
