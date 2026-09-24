// Waktu WIB tanpa bergantung pada Intl (Hermes/Android bervariasi).
const pad = (n) => String(n).padStart(2, "0");

export function waktuWIB(iso) {
  if (!iso) return "-";
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  if (Number.isNaN(d.getTime())) return "-";
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())} WIB`;
}

export function tanggalWIB(isoOrDate) {
  if (!isoOrDate) return "-";
  const s = String(isoOrDate).slice(0, 10);
  const [y, m, d] = s.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "-";
}

export function hariIniWIB() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
