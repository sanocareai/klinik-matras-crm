// Logika murni panel status sinkronisasi Meta. Keadaan dihitung server; di sini hanya label.
export const KEADAAN_SINKRON = Object.freeze({
  BELUM_DIKONFIGURASI: { label: "Belum dikonfigurasi", nada: "perhatian" },
  NONAKTIF: { label: "Nonaktif", nada: "info" },
  BELUM_PERNAH_BERJALAN: { label: "Belum pernah berjalan", nada: "info" },
  BERJALAN: { label: "Sedang berjalan", nada: "info" },
  GAGAL: { label: "Gagal", nada: "galat" },
  SELISIH_KONTROL: { label: "Selisih kontrol", nada: "galat" },
  DATA_TERLAMBAT: { label: "Data terlambat", nada: "perhatian" },
  SUKSES: { label: "Sukses", nada: "ok" },
});
export const waktuWibTeks = (w) => (w ? `${new Date(w).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB` : "—");
/** null tetap "—", bukan 0%. */
export function hookRateTampil(h) {
  const t = h?.total;
  if (!t) return { teks: "—", coverage: null, versi: null };
  return { teks: t.nilai === null || t.nilai === undefined ? "—" : `${t.nilai.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`, coverage: t.coverage?.persen ?? null, versi: t.versi ?? h.definisi?.versi ?? null };
}
