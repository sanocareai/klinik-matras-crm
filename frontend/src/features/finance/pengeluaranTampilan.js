// Logika PENYAJIAN halaman Pengeluaran (murni, tanpa React). Hanya menyusun ulang field yang SUDAH dikirim backend:
// tidak ada rumus, status, atau hak akses baru di sini.
import { jenisRekening } from "./ringkasanTampilan.js";

/** Tahap proses (filter status) — sama dengan halaman lama; tidak ada status yang ditambah/dipetakan ulang. */
export const STATUS_TAB = Object.freeze([
  { key: "", label: "Semua" },
  { key: "MENUNGGU_APPROVAL", label: "Menunggu persetujuan" },
  { key: "DISETUJUI", label: "Disetujui, belum dibayar" },
  { key: "DIBAYAR", label: "Dibayar" },
  { key: "DITOLAK", label: "Ditolak" },
]);

export const LABEL_MODE = Object.freeze({ LANGSUNG: "Bayar langsung", REIMBURSEMENT: "Reimbursement", UTANG: "Utang" });
export const teksMode = (mode) => LABEL_MODE[mode] ?? (mode || "—");

/** Nada chip status proses (semua status enum nyata; yang tak dikenal netral — tidak ada pemetaan tanpa dasar). */
const NADA_STATUS = { DRAFT: "neutral", MENUNGGU_APPROVAL: "perhatian", DISETUJUI: "biru", DIBAYAR: "green", DITOLAK: "red", DIBATALKAN: "neutral" };
export const nadaStatus = (status) => NADA_STATUS[status] ?? "neutral";

/**
 * Status BUKTI (terpisah dari status proses: "Dibayar" tidak berarti bukti terverifikasi).
 * terverifikasi = ada foto & sudah diverifikasi · tersedia = ada foto, belum diverifikasi · tanpa = belum ada foto (wajib bila `notaWajib`).
 */
export function statusBukti(e) {
  if (e?.receiptUrl && e?.receiptVerifiedAt) return { kode: "terverifikasi", label: "Bukti terverifikasi", nada: "green" };
  if (e?.receiptUrl) return { kode: "tersedia", label: "Bukti tersedia", sub: "belum diverifikasi", nada: "netral" };
  if (e?.notaWajib) return { kode: "wajib", label: "Nota wajib", sub: "belum ada", nada: "red" };
  return { kode: "tanpa", label: "Belum ada bukti", nada: "redup" };
}

/** Sumber dana = rekening/kas yang dipakai (field cashAccount); cara bayar dinyatakan terpisah. `peta` = Map id → rekening aktif (membawa bankName). */
export function sumberDana(e, peta) {
  const ca = e?.cashAccount;
  if (!ca) {
    const belumDibayar = ["DRAFT", "MENUNGGU_APPROVAL", "DISETUJUI"].includes(e?.status) && e?.mode !== "LANGSUNG";
    return { ada: false, teks: belumDibayar ? "Belum dibayar" : "—" };
  }
  const rek = peta?.get?.(ca.id);
  const info = jenisRekening({ kind: rek?.kind ?? ca.kind, bankName: rek?.bankName });
  return { ada: true, nama: ca.name, jenis: info.jenis, namaBank: info.namaBank, rekening: { kind: rek?.kind ?? ca.kind, bankName: rek?.bankName } };
}

/** Kalimat batas data daftar. Total = jumlah SEMUA baris yang cocok filter (dari agregat server), bukan yang termuat. */
export function kalimatBatas({ termuat, total, terpotong }) {
  const n = Number(termuat) || 0; const t = Number(total) || n;
  if (!terpotong || t <= n) return { teks: `Menampilkan ${n.toLocaleString("id-ID")} pengeluaran`, terpotong: false };
  return {
    teks: `Menampilkan ${n.toLocaleString("id-ID")} dari ${t.toLocaleString("id-ID")} pengeluaran`,
    catatan: "Daftar hanya memuat 300 teratas. Angka ringkasan di atas mencakup seluruh hasil. Persempit periode atau filter untuk melihat sisanya.",
    terpotong: true,
  };
}

/** Isi tiga KPI dari respons server (nilai & populasi sama dengan halaman lama). */
export function kpiPengeluaran({ data, status, expenses }) {
  const r = data?.ringkasan;
  const filterStatus = !!status;
  const nilai = filterStatus ? (r?.total ?? data?.total ?? 0) : (r?.totalAktif ?? data?.total ?? 0);
  const jumlah = filterStatus ? (r?.jumlahSemua ?? expenses.length) : (r?.jumlahAktif ?? expenses.length);
  const tak = r?.tidakDihitung;
  const menunggu = r?.perStatus?.MENUNGGU_APPROVAL?.jumlah ?? expenses.filter((e) => e.status === "MENUNGGU_APPROVAL").length;
  const disetujui = r?.perStatus?.DISETUJUI?.jumlah ?? expenses.filter((e) => e.status === "DISETUJUI").length;
  return {
    labelTotal: filterStatus ? "Total di filter ini" : "Total pengeluaran",
    nilai, jumlah, tidakDihitung: !filterStatus && tak?.jumlah ? tak : null, menunggu, disetujui,
    adaKontrakTotal: !filterStatus,
  };
}

/** Filter lain (di luar status & pencarian) yang sedang aktif — untuk lencana "Filter lainnya" dan tombol atur ulang. */
export function jumlahFilterAktif({ fKategori, fDivisi, fMode, fRekening, fBukti, q }) {
  return [fKategori, fDivisi, fMode, fRekening, fBukti, (q || "").trim()].filter(Boolean).length;
}
