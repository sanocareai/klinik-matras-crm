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
// Satu format waktu untuk seluruh panel: "10 Nov 2026, 02.00 WIB". Server mengirim ISO UTC; tampilan selalu WIB.
const FMT_WAKTU = { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false };
export const waktuWibTeks = (w) => {
  const d = w ? new Date(w) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.toLocaleString("id-ID", FMT_WAKTU).replace(/\s*pukul\s*/, ", ")} WIB` : "—";
};
/** Tanggal kalender WIB "YYYY-MM-DD" → "9 Nov 2026" (tanpa geser zona: nilainya sudah tanggal WIB). */
export const tanggalTeks = (t) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("id-ID", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "—";
};
const STATUS_RUN = Object.freeze({ SUKSES: "Sukses", GAGAL: "Gagal", DRY_RUN: "Uji coba (tanpa simpan)", BELUM_DIREKONSILIASI: "Ada hari ditahan", BERJALAN: "Sedang berjalan" });
export const statusRunTeks = (s) => STATUS_RUN[s] ?? s ?? "—";
const SUMBER_REFERENSI = Object.freeze({ COMPOSIO: "Sinkron otomatis (Composio)", ADS_MANAGER_EXPORT: "Ekspor Ads Manager", MANUAL: "Manual" });
export const sumberReferensiTeks = (daftar) => (daftar?.length ? daftar.map((s) => SUMBER_REFERENSI[s] ?? s).join(" · ") : "—");
/** null tetap "—", bukan 0%. */
export function hookRateTampil(h) {
  const t = h?.total;
  if (!t) return { teks: "—", coverage: null, versi: null };
  return { teks: t.nilai === null || t.nilai === undefined ? "—" : `${t.nilai.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`, coverage: t.coverage?.persen ?? null, versi: t.versi ?? h.definisi?.versi ?? null };
}
