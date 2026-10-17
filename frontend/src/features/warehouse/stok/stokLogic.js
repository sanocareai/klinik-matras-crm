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

export function saringStok(rows, { tab = "", cari = "", keadaan = "", nonaktif = false } = {}) {
  const q = String(cari).trim().toLowerCase();
  return rows.filter((r) => {
    if (!nonaktif && !r.aktif) return false;
    if (tab === "none" && r.kategori) return false;
    if (tab && tab !== "none" && r.kategori !== tab) return false;
    if (keadaan && r.keadaan !== keadaan) return false;
    if (q && !`${r.kode} ${r.nama} ${r.vendor ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

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
