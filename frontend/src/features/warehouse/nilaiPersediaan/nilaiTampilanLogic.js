// Logika MURNI tampilan Nilai Persediaan (redesain sederhana, Nov 2026). Tidak menghitung nilai: semua angka berasal dari respons server (`/api/inventory/nilai-persediaan`).
// Di sini hanya: menyusun teks ringkas kartu, mengelompokkan pilihan filter untuk popover, dan menyiapkan status utama satu baris.
// Aturan makna yang dijaga: estimasi stok dan saldo Finance TIDAK dijumlahkan/disamakan; nilai tidak diketahui BUKAN Rp0 (teksRupiah → "—"); nol Owner, nol koreksi resmi, nol ledger,
// tanpa catatan stok, dan terukur dalam satuan lain tetap sebagai kunci tampilan yang berbeda; label "belum direkonsiliasi/belum diverifikasi" tidak diubah menjadi "terbukti".
import {
  FILTER_PENGECUALIAN, FILTER_SEMUA, STATUS_PENGECUALIAN, STATUS_REKON_TEKS, STATUS_TEKS, SUB_INDUK, SUB_TEKS, URUT_STATUS, URUT_SUB,
  kunciTampil, nadaKunci, opsiFilter, teksKunci, teksRupiah,
} from "./nilaiPersediaanLogic.js";

export const UKURAN_HALAMAN = 25;
export const TEKS_NOMINAL_DISEMBUNYIKAN = "[nominal hanya untuk Finance/Owner]";
/**
 * Kalimat dari server bisa memuat nominal (mis. selisih saldo akun pada `finance.alasan`) walau pengguna tidak punya finance:read. Tanpa izin nominal, angka Rupiah bukan-nol di kalimat disembunyikan
 * di tampilan; "Rp0" tetap (itu pernyataan nol, bukan nominal). Ini HANYA lapisan tampilan: sumber kebocoran ada di backend dan dilaporkan terpisah (tidak diubah di redesain ini).
 */
export function topengNominal(teks, nominal) {
  if (nominal) return teks;
  return String(teks ?? "").replace(/Rp\s?(?=[\d.,]*[1-9])[\d.,]+/g, TEKS_NOMINAL_DISEMBUNYIKAN);
}
export const TEKS_BELUM_DIREKONSILIASI_SO = "Belum direkonsiliasi dengan hasil SO";
export const KALIMAT_PERLU_DILENGKAPI = "Belum bisa dinilai — tidak dihitung sebagai Rp0.";

/** Satu status utama per baris (chip tabel). `peringatanSO` = catatan SO kedaluwarsa (ada pergerakan sesudah tanggal SO) → tanda kecil, bukan status kedua. */
export function statusUtama(b) {
  const kunci = kunciTampil(b);
  return { kunci, teks: teksKunci(kunci), nada: nadaKunci(kunci), peringatanSO: !!b?.hasilSO?.kedaluwarsa };
}

/** Bahan unik yang masuk "perlu dilengkapi" menurut baris yang dimuat (pembanding konsistensi dengan angka server). */
export function bahanUnikPerluDilengkapi(baris) {
  return new Set((baris ?? []).filter((b) => STATUS_PENGECUALIAN.includes(b.status)).map((b) => b.materialId)).size;
}

/** Teks tiga kartu. Nominal tidak diizinkan → "—" (bukan Rp0). `parsial` hanya tampilan: bahan yang dinilai < bahan relevan (angka dari server). */
export function ringkasKartu(d, nominal) {
  const e = d.kartu.estimasi; const f = d.kartu.finance; const akun = d.finance?.akun;
  const rp = (n) => (nominal ? teksRupiah(n) : "—");
  return {
    estimasi: {
      nilai: rp(e.nilaiLedger), parsial: e.bahanDinilai < e.bahanRelevan, statusRekon: TEKS_BELUM_DIREKONSILIASI_SO,
      setelahPengecualian: rp(e.nilaiTanpaHasilSOBermasalah), bahanDikecualikan: e.bahanHasilSOBermasalah,
      nilaiDikecualikan: nominal && e.bahanHasilSOBermasalah > 0 ? teksRupiah(e.nilaiHasilSOBermasalah) : null,
      kalimat: `${e.bahanDinilai} dari ${e.bahanRelevan} bahan relevan dinilai${e.dariPO > 0 ? ` · ${e.dariPO} memakai harga dari PO (belum tentu diterima)` : ""}.`,
    },
    finance: {
      nilai: rp(f.saldo), status: STATUS_REKON_TEKS[f.status] ?? f.status,
      kalimat: `${akun ? `Akun ${akun.kode} ${akun.nama}` : "Akun persediaan belum disiapkan"} · ${d.finance?.jurnal ?? 0} jurnal sampai ${d.finance?.tanggalBuku ?? "—"} · tidak dibagi ke bahan.`,
    },
    perlu: { jumlah: d.kartu.belumDinilai.jumlah, kalimat: KALIMAT_PERLU_DILENGKAPI },
  };
}

/** Keterangan singkat di judul bagian "Cakupan data" (selalu terlihat saat bagian tertutup): tidak ada angka penting yang tersembunyi. */
export function ringkasCakupanData(c) {
  if (!c) return "";
  const bagian = [`${c.dinilai} dari ${c.relevan} bahan dinilai`];
  if (c.pengecualianSatuanTerbuka > 0) bagian.push(`${c.pengecualianSatuanTerbuka} pengecualian satuan terbuka`);
  if (c.hasilSOKedaluwarsa > 0) bagian.push(`${c.hasilSOKedaluwarsa} catatan SO kedaluwarsa`);
  return bagian.join(" · ");
}

/** Pilihan filter dikelompokkan untuk popover/lembar bawah: tampilan · status · rincian nol/tanpa catatan. Hitungan = dari server (opsiFilter). */
export function kelompokOpsiFilter(cakupan) {
  const semua = opsiFilter(cakupan);
  const tampilan = semua.filter((o) => o.kode === FILTER_PENGECUALIAN || o.kode === FILTER_SEMUA);
  const status = semua.filter((o) => URUT_STATUS.includes(o.kode));
  const rincian = semua.filter((o) => o.sub);
  return [
    { judul: "Tampilan", opsi: tampilan },
    { judul: "Status", opsi: status },
    ...(rincian.length ? [{ judul: "Rincian stok belum diketahui dan nol", opsi: rincian }] : []),
  ];
}

/** Chip filter aktif: hanya bila bukan "Semua bahan". Satu filter status → satu chip. */
export function chipFilterAktif(filter, cakupan) {
  if (!filter || filter === FILTER_SEMUA) return null;
  const o = opsiFilter(cakupan).find((x) => x.kode === filter);
  return o ? { kode: o.kode, teks: o.teks, jumlah: o.jumlah } : { kode: filter, teks: STATUS_TEKS[filter] ?? SUB_TEKS[filter] ?? filter, jumlah: null };
}

/** Hanya kode filter yang sah untuk tombol pintas (segmen cakupan, kartu "Lihat bahan"). */
export function kodeFilterSah(kode) { return kode === FILTER_SEMUA || kode === FILTER_PENGECUALIAN || URUT_STATUS.includes(kode) || URUT_SUB.includes(kode); }
export const indukSub = (kode) => SUB_INDUK[kode] ?? null;

/** Kalimat hasil di atas tabel: dari SELURUH hasil saringan, bukan 25 baris halaman. */
export function teksHasil({ total, dari, sampai, cari, chip }) {
  if (total === 0) return "Tidak ada bahan yang cocok";
  const rentang = total > sampai - dari + 1 ? `Menampilkan ${dari}–${sampai} dari ${total} bahan` : `${total} bahan`;
  return `${rentang}${chip ? ` · ${chip}` : ""}${cari?.trim() ? ` · cari “${cari.trim()}”` : ""}`;
}
