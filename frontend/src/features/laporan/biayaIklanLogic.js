// Logika murni form "Kelola biaya iklan" (input manual biaya tingkat SUMBER). Cermin validasi server (backend/src/services/attribution/biayaSumber.js) agar kesalahan terlihat sebelum
// mengirim — server TETAP memvalidasi ulang (sumber kebenaran). Tidak ada token/secret yang diminta atau disimpan di sini.
import { tglValid, selisihHari, tambahHari } from "./periodeLaporan.js";

export const SUMBER_FORM = [
  { id: "META", label: "Meta Ads" },
  { id: "TIKTOK", label: "TikTok Ads" },
  { id: "LAINNYA", label: "Lainnya (mis. Google Ads)" },
];
export const MAKS_HARI_ENTRI = 93;
const NOMINAL_RE = /^\d{1,13}(\.\d{1,2})?$/;

export const formKosong = ({ sumber = "TIKTOK", jenis = "HARIAN", dari = "", sampai = "" } = {}) => ({ sumber, jenis, dari, sampai: jenis === "HARIAN" ? dari : sampai, akun: "", nominal: "", alasan: "", konfirmasiNol: false, gantiDetailAd: false });

/** Validasi form → { galat: {field: pesan}, data|null }. hariIni: "YYYY-MM-DD" WIB. */
export function validasiForm(f, hariIni) {
  const g = {};
  if (!SUMBER_FORM.some((s) => s.id === f.sumber)) g.sumber = "Pilih sumber berbiaya. Sumber organik tidak punya biaya iklan yang dialokasikan.";
  const dari = f.dari, sampai = f.jenis === "HARIAN" ? f.dari : f.sampai;
  if (!tglValid(dari)) g.dari = "Tanggal wajib diisi (YYYY-MM-DD, WIB).";
  if (f.jenis === "TOTAL_RENTANG" && !tglValid(sampai)) g.sampai = "Tanggal akhir wajib diisi.";
  if (!g.dari && !g.sampai) {
    if (dari > sampai) g.sampai = "Tanggal akhir tidak boleh sebelum tanggal mulai.";
    else if (sampai >= hariIni) g.sampai = `Tanggal terakhir harus sebelum hari ini (${hariIni}); biaya hari berjalan belum final.`;
    else if (selisihHari(dari, sampai) + 1 > MAKS_HARI_ENTRI) g.sampai = `Rentang paling lama ${MAKS_HARI_ENTRI} hari.`;
  }
  const n = String(f.nominal ?? "").trim();
  if (n === "") g.nominal = "Nominal wajib diisi (Rp0 harus dikonfirmasi; kosong ≠ Rp0).";
  else if (/^-/.test(n)) g.nominal = "Nominal tidak boleh negatif.";
  else if (/[eE]/.test(n)) g.nominal = "Tulis angka biasa, bukan notasi ilmiah.";
  else if (!NOMINAL_RE.test(n)) g.nominal = "Tulis angka tanpa titik/koma ribuan, maks. 2 desimal (contoh 1500000 atau 1500000.50).";
  else if (Number(n) === 0 && !f.konfirmasiNol) g.nominal = "Rp0 harus dikonfirmasi (centang): Rp0 berbeda dari 'belum diisi'.";
  const alasan = String(f.alasan ?? "").trim();
  if (alasan.length < 5 || alasan.length > 300) g.alasan = "Alasan wajib 5–300 karakter (sumber angka / nomor invoice).";
  const akun = String(f.akun ?? "").trim().replace(/^act_/i, "");
  if (akun !== "" && !/^\d{5,32}$/.test(akun)) g.akun = "ID akun berupa 5–32 digit, atau kosongkan (semua akun).";
  if (f.gantiDetailAd && f.sumber !== "META") g.gantiDetailAd = "Mengganti detail Ad hanya untuk Meta.";
  return { galat: g, valid: Object.keys(g).length === 0 };
}

/** Body permintaan PUT /biaya-sumber. dryRun:true → hanya rencana (tidak menulis). */
export function bodyBiaya(f, { dryRun }) {
  const dari = f.dari, sampai = f.jenis === "HARIAN" ? f.dari : f.sampai;
  const nominal = String(f.nominal).trim();
  return {
    sumber: f.sumber, jenis: f.jenis, dari, ...(f.jenis === "TOTAL_RENTANG" ? { sampai } : {}), ...(String(f.akun || "").trim() ? { akun: String(f.akun).trim() } : {}),
    nominal, ...(Number(nominal) === 0 ? { konfirmasiNol: f.konfirmasiNol === true } : {}), alasan: String(f.alasan).trim(), ...(f.sumber === "META" && f.gantiDetailAd ? { gantiDetailAd: true } : {}), dryRun,
  };
}

export const AKSI_TEKS = {
  BARU: "Entri baru akan dibuat", UBAH: "Entri yang ada akan diperbarui (revisi tercatat)", AKTIFKAN: "Entri yang dibatalkan akan diaktifkan kembali", TIDAK_BERUBAH: "Tidak ada perubahan (nilai sama — tidak ada revisi baru)", KONFLIK: "Tumpang tindih dengan entri aktif lain",
};
export function ringkasRencana(r) {
  if (!r) return null;
  const rentang = r.dari === r.sampai ? r.dari : `${r.dari} s/d ${r.sampai}`;
  const lama = r.perubahan?.nominalLama != null ? ` (sebelumnya Rp${Math.round(r.perubahan.nominalLama).toLocaleString("id-ID")})` : "";
  return `${AKSI_TEKS[r.aksi] || r.aksi}: ${r.sumber} · ${r.jenis === "HARIAN" ? "harian" : "total rentang"} ${rentang} · Rp${Number(r.nominal).toLocaleString("id-ID")}${lama}${r.gantiDetailAd ? " · menggantikan detail Ad" : ""}.`;
}

/** Tanggal kemarin (batas atas input). */
export const kemarin = (hariIni) => tambahHari(hariIni, -1);

export const ALASAN_TIDAK_DIPAKAI = {
  BULAN_TIDAK_PENUH_DALAM_RENTANG: "bulan tidak termuat penuh dalam periode (tidak diprorata)",
  DETAIL_AD_MENANG: "detail Ad lebih diutamakan",
  ADA_ENTRI_SUMBER_PADA_BULAN_INI: "ada entri sumber pada bulan ini",
  NOMINAL_NOL_DIANGGAP_BELUM_DIISI: "nominal 0 dianggap belum diisi",
};
/** Teks sumber data biaya yang dipakai pada satu cakupan (untuk kejujuran asal angka). */
export function ringkasAsalBiaya(c) {
  if (!c) return [];
  const o = [];
  if (c.hari?.adDetail) o.push(`${c.hari.adDetail} hari dari detail Ad (Windsor/API/CSV)`);
  if (c.hari?.manualHarian) o.push(`${c.hari.manualHarian} hari dari entri harian manual`);
  if (c.hari?.manualBlok) o.push(`${c.hari.manualBlok} hari dari total rentang manual/bulanan`);
  if (c.hari?.override) o.push(`${c.hari.override} hari memakai manual yang mengganti detail Ad`);
  if ((c.hariHilang || []).length) o.push(`${c.hariHilang.length} hari belum ada data`);
  if ((c.hariRentangTidakCocok || []).length) o.push(`${c.hariRentangTidakCocok.length} hari tertutup total rentang yang tidak termuat penuh`);
  if ((c.manualDiabaikanHari || []).length) o.push(`${c.manualDiabaikanHari.length} hari manual diabaikan (detail Ad ada)`);
  return o;
}
