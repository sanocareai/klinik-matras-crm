// Pintu masuk modul "Pergerakan stok resmi → jurnal" (pratinjau baca-saja + posting terkunci). Lihat docs/AUDIT-PERGERAKAN-STOK-RESMI.md.
export { JENIS, SEMUA_JENIS, KODE, PESAN, MATRIKS, StokResmiError, akunBebanUntuk } from "./matriks.js";
export { muatDokumen } from "./dokumen.js";
export { pratinjau, bacaPengaturanPosting, evaluasiAturan, pemakaianPicPembanding } from "./pratinjau.js";
export { postDokumenStok, balikDokumenStok } from "./posting.js";
