// METODE PERSEDIAAN (B3.5) — keputusan bisnis 25 Sep 2026:
//   • Sebelum tanggal cutover  : PERIODIK. Tagihan bahan baku TANPA penerimaan Gudang mendebet 5-1100 (Beban Pokok Bahan Baku /
//     pembelian bahan) — nilai persediaan akhir baru diketahui lewat stok opname, bukan lewat jurnal per tagihan.
//   • Mulai tanggal cutover    : PERPETUAL. Bahan baku wajib lewat Penerimaan Barang Gudang (Dr Persediaan / Cr GRNI) dan
//     Pengeluaran Bahan (Dr 5-1100 / Cr Persediaan); tagihan bahan baku TANPA penerimaan ditolak.
// Tagihan bahan baku DENGAN penerimaan Gudang selalu jalur GRNI (Dr 2-1150 ± selisih harga / Cr Utang Usaha) di kedua metode.
//
// Tanggal yang dinilai adalah TANGGAL TAGIHAN (bukan tanggal setuju/bayar) supaya hasilnya deterministik: tagihan bertanggal
// 9 Sep yang disetujui 2 Okt tetap periodik. Jurnal & tagihan lama TIDAK pernah dihitung ulang dari sini.

import { getSettingRaw, SETTING_KEYS } from "./settings.js";

export const METODE_PERSEDIAAN = Object.freeze({ PERIODIK: "PERIODIK", PERPETUAL: "PERPETUAL" });
export const CATATAN_PERIODIK = "Metode periodik — nilai persediaan akhir ditentukan melalui stok opname.";

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/** Date | string → "YYYY-MM-DD" (UTC, sama dengan cara tanggal tagihan disimpan), atau null kalau tidak valid. */
export function kunciTanggal(t) {
  if (!t) return null;
  if (typeof t === "string" && POLA_TANGGAL.test(t)) return t;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Baca kebijakan dari pengaturan. cutover kosong/tidak valid = tidak ada cutover (metode "sebelum" berlaku selamanya). */
export async function ambilKebijakanPersediaan(db) {
  const [metodeRaw, cutoverRaw] = await Promise.all([
    getSettingRaw(db, SETTING_KEYS.INVENTORY_METHOD_BEFORE_CUTOVER),
    getSettingRaw(db, SETTING_KEYS.INVENTORY_CUTOVER_DATE),
  ]);
  const sebelumCutover = metodeRaw === METODE_PERSEDIAAN.PERPETUAL ? METODE_PERSEDIAAN.PERPETUAL : METODE_PERSEDIAAN.PERIODIK;
  const cutover = POLA_TANGGAL.test(cutoverRaw || "") ? cutoverRaw : null;
  return { sebelumCutover, cutover };
}

/** Metode yang berlaku pada sebuah tanggal (tanggal tagihan). Murni — tidak menyentuh DB. */
export function metodeUntukTanggal(kebijakan, tanggal) {
  const k = kunciTanggal(tanggal);
  if (kebijakan.cutover && k && k >= kebijakan.cutover) return METODE_PERSEDIAAN.PERPETUAL;
  return kebijakan.sebelumCutover;
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function tanggalIndonesia(kunci) {
  if (!kunci) return "";
  const [y, m, d] = kunci.split("-");
  return `${Number(d)} ${BULAN[Number(m) - 1]} ${y}`;
}

export function pesanPerpetual(kebijakan) {
  return kebijakan.cutover
    ? `Mulai ${tanggalIndonesia(kebijakan.cutover)} persediaan memakai metode perpetual: tagihan bahan baku wajib menaut Penerimaan Barang Gudang. Buat Penerimaan Barang dulu, lalu tautkan ke tagihan ini.`
    : "Persediaan memakai metode perpetual: tagihan bahan baku wajib menaut Penerimaan Barang Gudang.";
}
