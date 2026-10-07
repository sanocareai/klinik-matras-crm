// Panel melayang (bottom sheet gorhom, mis. Info Pelanggan di Inbox) dirender di PORTAL di atas navigator — layar yang dibuka lewat
// navigationRef.navigate() muncul DI BELAKANG panel itu, jadi tombol "Rincian" di kartu order terlihat tidak berfungsi (bug 7 Okt 2026:
// Inbox > profil > order > Rincian). Panel yang menutupi navigator mendaftarkan penutupnya di sini; navigasi lintas-layar menutup semuanya dulu.
const penutup = new Set();

/** Daftarkan fungsi penutup panel; mengembalikan fungsi untuk mencabutnya (cocok sebagai cleanup useEffect). */
export function daftarkanPenutupLapisan(tutup) {
  penutup.add(tutup);
  return () => penutup.delete(tutup);
}

/** Tutup semua panel melayang yang terdaftar. Satu penutup yang error tidak menghalangi yang lain atau navigasinya. */
export function tutupLapisanMelayang() {
  penutup.forEach((tutup) => { try { tutup(); } catch { /* panel sudah tertutup */ } });
}
