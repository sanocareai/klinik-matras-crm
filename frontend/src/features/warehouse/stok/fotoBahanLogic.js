// Logika murni foto bahan (tanpa DOM): validasi berkas dan ukuran target. Pemrosesan akhir (EXIF, WebP, buang metadata, thumbnail) dilakukan SERVER; klien hanya memperkecil foto besar dari HP
// supaya unggahan cepat di sinyal lemah dan tidak melewati batas 10 MB server.
export const BATAS_SUMBER_BYTE = 30 * 1024 * 1024; // berkas yang bahkan terlalu besar untuk diperkecil di perangkat
export const BATAS_KIRIM_BYTE = 9 * 1024 * 1024; // di bawah batas server (10 MB)
export const SISI_KIRIM_MAKS = 2000;

const EKSTENSI_GAMBAR = /\.(jpe?g|png|webp|heic|heif|avif|tiff?)$/i;

/** null bila boleh diproses; selain itu pesan untuk pengguna. */
export function periksaBerkas(berkas) {
  if (!berkas) return "Pilih foto terlebih dahulu.";
  const tipe = String(berkas.type || ""); const nama = String(berkas.name || "");
  const gambar = tipe.startsWith("image/") || (tipe === "" && EKSTENSI_GAMBAR.test(nama));
  if (!gambar) return "Berkas ini bukan foto. Pilih gambar JPG, PNG, atau WebP.";
  if (tipe === "image/gif" || tipe === "image/svg+xml") return "Format ini tidak didukung. Pilih foto JPG, PNG, atau WebP.";
  if (berkas.size > BATAS_SUMBER_BYTE) return "Foto terlalu besar (maksimal 30 MB). Pilih foto yang lebih kecil.";
  if (berkas.size === 0) return "Berkas foto kosong. Pilih foto lain.";
  return null;
}

/** Ukuran hasil perkecilan: sisi terpanjang ≤ maks, tidak pernah diperbesar, rasio tetap. */
export function ukuranTarget(lebar, tinggi, maks = SISI_KIRIM_MAKS) {
  if (!(lebar > 0) || !(tinggi > 0)) return { lebar: 0, tinggi: 0, perkecil: false };
  const skala = Math.min(1, maks / Math.max(lebar, tinggi));
  return { lebar: Math.round(lebar * skala), tinggi: Math.round(tinggi * skala), perkecil: skala < 1 };
}

/** Perlu diperkecil di perangkat? Ya bila sisi melebihi batas ATAU berkas lebih besar dari batas kirim. */
export const perluDiperkecil = (lebar, tinggi, byte) => ukuranTarget(lebar, tinggi).perkecil || byte > BATAS_KIRIM_BYTE;

/** Pesan galat yang ramah; galat server (sudah berbahasa Indonesia) dipakai apa adanya. */
export function pesanGalatFoto(err) {
  if (err?.status === 403) return "Anda tidak punya izin mengubah foto bahan. Hubungi Admin atau Gudang.";
  if (err?.status === 413) return "Foto terlalu besar. Pilih foto yang lebih kecil atau ambil ulang.";
  if (err?.status === 0 || err?.code === "NETWORK" || err?.code === "TIMEOUT") return err.message || "Koneksi terputus. Coba lagi.";
  return err?.message || "Foto belum berhasil disimpan. Coba lagi.";
}

/** Alur pasti yang dipakai komponen: unggah baru → ganti. Kedua kasus sama (server mengganti dan menghapus berkas lama). */
export const labelAksiUnggah = (adaFoto) => (adaFoto ? "Ganti foto" : "Unggah foto");
