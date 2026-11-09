import { detailCtwaKanonik } from "../leadAttribution.js";

/** Keterangan sumber untuk tampilan. Data lama tetap tersimpan apa adanya; cocok-klik waktu terbukti bukan bukti sumber, jadi tampil sebagai "Tanpa bukti sumber". */
export function detailSumberTampil(detail) {
  if (typeof detail === "string" && /^Kemungkinan TikTok\b/i.test(detail)) return "Tanpa bukti sumber";
  return detailCtwaKanonik(detail);
}
