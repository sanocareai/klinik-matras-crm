// PENGAJUAN PEMAKAIAN BAHAN (aturan Owner Nov 2026): ADMIN mencatat → langsung; non-ADMIN → pengajuan, stok & HPP berubah sesudah diverifikasi ADMIN lain.
// Peran di sini hanya PETUNJUK tampilan — server yang menentukan (respons 202 { menungguVerifikasi }).

export const PENGAJUAN_BERUBAH = "pengajuan-pemakaian:berubah";
export const kabarkanPengajuan = () => { try { window.dispatchEvent(new Event(PENGAJUAN_BERUBAH)); } catch { /* lingkungan tanpa window */ } };

export function peranSaatIni() {
  try { const u = JSON.parse(localStorage.getItem("user") || "null"); return Array.isArray(u?.roles) && u.roles.length ? u.roles : u?.role ? [u.role] : []; } catch { return []; }
}
export const adminBahanSaatIni = (roles = peranSaatIni()) => roles.includes("ADMIN");

export const menunggu = (hasil) => !!hasil?.menungguVerifikasi;

export const STATUS_TEKS = { DIAJUKAN: "Menunggu verifikasi ADMIN", DITAHAN: "Ditahan — perlu diperiksa ADMIN", DISETUJUI: "Disahkan", DITOLAK: "Ditolak", DIBATALKAN: "Dibatalkan" };
export const JALUR_TEKS = { UNIT_BAHAN: "Catat pemakaian", PERUBAHAN: "Perubahan pemakaian", RUN_V2: "Bahan pekerjaan (Aplikasi Meja)", BUKTI_V2: "Bahan di bukti tahap (Aplikasi Meja)" };
export const HASIL_TEKS = { DISETUJUI: "Disahkan — stok & HPP diperbarui", DITAHAN: "Ditahan — dasar berubah atau pemeriksaan gagal", GAGAL: "Tidak diproses" };

const angka = (v) => { const n = Number(v); return Number.isFinite(n) ? (Math.round(n * 10000) / 10000).toLocaleString("id-ID", { maximumFractionDigits: 4 }) : "—"; };
/** "2 KG BUSA A (PPA-1)" per baris ringkasan. */
export function teksBaris(b) {
  const sat = b.satuanInput && b.satuanInput !== b.satuanStok ? b.satuanInput : b.satuanStok;
  const arah = b.jenis === "RETURN" ? "kembali " : b.jenis === "ISSUE" ? "pakai " : "";
  return `${arah}${angka(b.qty)} ${sat || ""} ${b.bahan || "bahan"}${b.kode ? ` (${b.kode})` : ""}`.replace(/\s+/g, " ").trim();
}
export function teksRingkas(p) {
  const r = p.ringkasan || {};
  if (r.racikan && !(r.baris || []).length) return "Racikan saja";
  return (r.baris || []).map(teksBaris).join(" · ") || r.teks || "—";
}
export const waktuSingkat = (t) => { try { return new Date(t).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }); } catch { return "—"; } };
/** Alasan tahan yang bisa dibaca ADMIN. */
export const alasanTahan = (p) => (p.alasanTahan?.beda || []).map((b) => b.pesan).filter(Boolean);
// Alasan tertulis hanya untuk perubahan HARGA yang sudah ditampilkan (DITAHAN). Perbedaan keras (satuan, ganda, sumber) → tolak lalu ajukan ulang.
export const bedaKeras = (p) => (p.alasanTahan?.beda || []).some((b) => b.keras);
export const butuhKonfirmasi = (p) => p.status === "DITAHAN" && (p.alasanTahan?.beda || []).some((b) => b.jenis === "HARGA") && !bedaKeras(p);
export const butuhKonfirmasiHarga = (p) => !!p.hargaAmbigu;
