// Logika murni tampilan Stok & Lokasi (redesain Okt 2026). Tidak ada perhitungan stok/harga baru: semua angka berasal dari baris server (`getStokLokasi`) dan peta Harga Berlaku (`ringkasan-daftar`);
// file ini hanya memilih TEKS dan NADA yang ditampilkan, dengan aturan yang sama dengan sebelumnya:
//  • stok BELUM ADA CATATAN tampil "belum diketahui" (bukan 0); tiga "nol" (belum ada catatan / nol menurut pergerakan / nol terverifikasi) tidak pernah digabung;
//  • harga belum ada tampil "Belum ada harga berlaku" (bukan Rp0); tanpa izin Finance kolom harga tidak ada.
import { tampilSaldo } from "./stokLogic.js";
import { tampilHargaDaftar } from "./koreksiSaldoLogic.js";

const angka = (v) => Number(v).toLocaleString("id-ID", { maximumFractionDigits: 4 });

/**
 * Status SINGKAT satu baris (satu lencana per baris). nada: green | orange | red | neutral — merah/amber hanya untuk kondisi yang butuh perhatian.
 * kode dipakai pengujian dan atribut data.
 */
export function statusRingkas(r) {
  if (r.aktif === false) return { kode: "NONAKTIF", teks: "Nonaktif", nada: "neutral" };
  if (r.keadaan === "BELUM_ADA_CATATAN" || r.saldo === null || r.saldo === undefined) return { kode: "BELUM_DIKETAHUI", teks: "Belum diketahui", nada: "neutral" };
  if (r.keadaan === "MINUS") return { kode: "MINUS", teks: "Saldo minus", nada: "red" };
  if (r.keadaan === "NOL_TERHITUNG") {
    return r.keadaanSaldo === "NOL_TERVERIFIKASI"
      ? { kode: "NOL_TERVERIFIKASI", teks: "Nol terverifikasi", nada: "green" }
      : { kode: "NOL_PERGERAKAN", teks: "Nol menurut pergerakan", nada: "neutral" };
  }
  if (r.keadaan === "TERPESAN_PENUH") return { kode: "TERPESAN_PENUH", teks: "Terpesan penuh", nada: "orange" };
  if (r.keadaan === "MENIPIS") return { kode: "MENIPIS", teks: "Menipis", nada: "orange" };
  return { kode: "ADA", teks: "Ada stok", nada: "green" };
}

/** Angka utama kolom Tersedia: "belum diketahui" untuk stok belum ada catatan (BUKAN 0); minus ditandai; selain itu angka dari server. */
export function teksTersedia(r) {
  const t = tampilSaldo(r);
  if (t.jenis === "BELUM_DIKETAHUI") return { jenis: "BELUM_DIKETAHUI", teks: "belum diketahui", angka: null, minus: false };
  const v = r.tersedia === null || r.tersedia === undefined ? r.saldo : r.tersedia;
  return { jenis: t.jenis, teks: angka(v), angka: Number(v), minus: Number(v) < 0 };
}

/** Harga untuk baris: null bila tanpa izin (kolom disembunyikan); {ada:false,teks} bila belum ada harga berlaku; {ada:true,harga,satuan} bila ada. */
export const hargaBaris = (peta, materialId) => tampilHargaDaftar(peta, materialId);

/** Pecah daftar menjadi halaman. halaman 1-based; dijepit ke rentang sah. */
export function halamanDaftar(rows, halaman = 1, ukuran = 25) {
  const total = rows.length; const jumlahHalaman = Math.max(1, Math.ceil(total / ukuran));
  const h = Math.min(Math.max(1, Number(halaman) || 1), jumlahHalaman);
  const awal = (h - 1) * ukuran;
  return { baris: rows.slice(awal, awal + ukuran), halaman: h, jumlahHalaman, dari: total ? awal + 1 : 0, sampai: Math.min(total, awal + ukuran), total };
}

/**
 * Saringan lanjutan yang aktif (untuk lencana tombol Filter dan chip yang bisa dihapus). `label` = teks chip; `kunci` = parameter URL yang dihapus.
 * Kelompok dan kata kunci TIDAK termasuk (punya kontrol sendiri). nonaktif dihitung sebagai saringan.
 */
export function saringanAktif({ keadaan = "", harga = "", lain = "", satuan = "", jenis = "", nonaktif = false }, label) {
  const o = [];
  if (keadaan) o.push({ kunci: "keadaan", testid: "chip-keadaan", teks: label.keadaan(keadaan), aria: "Hapus saringan keadaan" });
  if (harga) o.push({ kunci: "harga", testid: "chip-harga", teks: label.harga(harga), aria: "Hapus saringan harga" });
  if (lain) o.push({ kunci: "lain", testid: "chip-lain", teks: label.lain(lain), aria: "Hapus saringan kelengkapan" });
  if (satuan) o.push({ kunci: "satuan", testid: "chip-satuan", teks: `Satuan ${satuan}`, aria: "Hapus saringan satuan" });
  if (jenis) o.push({ kunci: "jenis", testid: "chip-jenis", teks: label.jenis(jenis), aria: "Hapus saringan jenis" });
  if (nonaktif) o.push({ kunci: "nonaktif", testid: "chip-nonaktif", teks: "Termasuk nonaktif", aria: "Hapus saringan nonaktif" });
  return o;
}

/** Ringkasan atas: semua angka dari ringkasan server + hitungan opsi saringan (data yang sama dengan daftar). */
export function ringkasanAtas(ringkas, opsi, adaHarga) {
  if (!ringkas) return null;
  return {
    aktif: ringkas.aktif, adaStok: ringkas.ada, nonaktif: ringkas.nonaktif ?? 0,
    minus: ringkas.minus ?? 0, belumDiketahui: ringkas.belumAdaCatatan ?? 0,
    hargaBelum: adaHarga && opsi ? opsi.harga.BELUM ?? 0 : null,
  };
}
