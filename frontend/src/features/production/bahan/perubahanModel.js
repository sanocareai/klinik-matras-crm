// Model MURNI "Ubah pemakaian" per bahan (tombol Edit pada tabel Pemakaian aktual) — diuji node --test tanpa React/DOM.
// Dua perubahan: UBAH JUMLAH (bahan yang sama) dan GANTI BAHAN (bahan lama dikembalikan, bahan pengganti dikeluarkan — dua langkah resmi, disimpan SEKALIGUS atau tidak sama sekali).
// Ledger tidak pernah ditimpa: perubahan = baris RETURN/ISSUE baru. Server yang memutuskan jalurnya: LANGSUNG (disimpan sekarang) atau AJUKAN (menunggu persetujuan orang lain; stok belum berubah).
// Unit TERKIRIM: tanggal pemakaian yang dilaporkan wajib (harga HPP mengikuti tanggal itu). Unit berjalan: dicatat sekarang.
import { parseJumlah } from "../orderProduksiModel.js";
import { validasiTanggal } from "./pembetulanModel.js";

export const MODE = Object.freeze({ UBAH: "UBAH", GANTI: "GANTI" });
export const MODE_SERVER = Object.freeze({ UBAH: "UBAH_JUMLAH", GANTI: "GANTI_BAHAN" });

// Pilihan sumber untuk "+ Tambah pemakaian": tiga pilihan yang mudah dipahami; rincian teknis ada di bagian yang bisa dibuka.
export const PILIHAN_SUMBER = Object.freeze({
  gudang: { key: "gudang", label: "Bahan Gudang", bantu: "Bahan ada di katalog Gudang. Stok berkurang saat disimpan." },
  belum: { key: "belum", label: "Bahan belum tercatat", bantu: "Belum ada di katalog atau stok belum diketahui. Hanya catatan; Gudang merekonsiliasi." },
  lama: { key: "lama", label: "Komponen lama", bantu: "Milik pelanggan (bongkaran kasur). Bukan stok." },
});
export const DETAIL_TEKNIS = Object.freeze([
  { judul: "Bahan Gudang", teks: "Mengubah stok Gudang dan HPP order lewat pergerakan stok resmi (pengeluaran atau pengembalian baru). Baris lama tidak pernah diedit atau dihapus; perubahan menjadi baris baru di riwayat dengan alasan." },
  { judul: "Bahan belum tercatat", teks: "Pemakaian sementara: hanya mencatat fakta. Stok, jurnal, dan HPP tidak berubah; berstatus “Perlu rekonsiliasi Gudang” dan tampil di Ringkasan, Riwayat, dan Excel (sheet Pemakaian Sementara)." },
  { judul: "Komponen lama", teks: "Milik pelanggan: bukan stok Gudang, bukan Material Issue, tanpa biaya bahan baru. Tampil di kartu “Komponen lama dari kasur ini”." },
  { judul: "Tanggal dan harga", teks: "Unit terkirim: tanggal pemakaian yang dilaporkan wajib dan menentukan Harga Berlaku HPP operasional (belum ada harga pada tanggal itu = tanpa harga). Waktu pencatatan tersimpan terpisah; tanggal jurnal Finance mengikuti hari pencatatan. Unit berjalan: dicatat sekarang." },
  { judul: "Persetujuan", teks: "Jumlah bahan dari dokumen Material Issue Gudang diubah lewat “Ajukan perubahan”: stok baru berubah setelah Owner/Finance (orang lain dari pemohon) menyetujui. Koreksi catatan Excel/historis ada di bagian “Catatan pemakaian historis”; Posting Pemakaian Historis adalah proses terpisah di bawah kendali Owner." },
]);

/** Validasi isian Edit sebelum meminta pratinjau. bersih = pemakaian bersih sekarang. Mencerminkan server; server yang memutuskan. */
export function validasiPerubahan({ mode, qtyBaru, keBahan = null, qtyKe = "", alasan, tanggal, selesai = false, bersih = null, sekarang = new Date() }) {
  const v = parseJumlah(qtyBaru);
  if (mode === MODE.UBAH) {
    if (v === null || v < 0) return { ok: false, galat: "Isi jumlah yang benar (angka 0 atau lebih)." };
    if (bersih !== null && Math.abs(v - bersih) < 0.00005) return { ok: false, galat: "Jumlah yang benar sama dengan yang tercatat sekarang." };
  } else {
    if (!keBahan?.materialId) return { ok: false, galat: "Pilih bahan pengganti." };
    if (v === null || v < 0) return { ok: false, galat: "Isi jumlah bahan lama yang tetap dipakai (0 bila tidak jadi dipakai)." };
    if (bersih !== null && v >= bersih - 0.00005) return { ok: false, galat: "Jumlah bahan lama yang tetap dipakai harus kurang dari pemakaian sekarang." };
    const k = parseJumlah(qtyKe); if (k === null || k <= 0) return { ok: false, galat: "Isi jumlah bahan pengganti (lebih dari 0)." };
  }
  let t = null; if (selesai) { const r = validasiTanggal(tanggal, sekarang); if (!r.ok) return r; t = r.tanggal; }
  const a = String(alasan ?? "").trim();
  if (a.length < 5) return { ok: false, galat: "Alasan wajib diisi (minimal 5 karakter)." };
  if (a.length > 500) return { ok: false, galat: "Alasan maksimal 500 karakter." };
  const r4 = (x) => Math.round(x * 10000) / 10000;
  return { ok: true, qtyBaru: r4(v), qtyKe: mode === MODE.GANTI ? r4(parseJumlah(qtyKe)) : null, alasan: a, tanggal: t };
}
/** Sidik isian: berubah = pratinjau lama tidak berlaku lagi (harus lihat dampak ulang). */
export const sidikPerubahan = ({ mode, materialId, qtyBaru, keBahan, qtyKe, alasan, tanggal, ajukan }) => JSON.stringify([mode, materialId, String(qtyBaru ?? "").trim(), keBahan?.materialId ?? null, mode === MODE.GANTI ? String(qtyKe ?? "").trim() : "", String(alasan ?? "").trim(), String(tanggal ?? "").trim(), !!ajukan]);
/** Badan permintaan pratinjau (baca-saja). */
export const badanPratinjau = ({ mode, materialId, v, keBahan, ajukan }) => ({ materialId, qtyBaru: v.qtyBaru, ...(mode === MODE.GANTI ? { keMaterialId: keBahan.materialId, qtyKe: v.qtyKe } : {}), ...(v.tanggal ? { tanggalPemakaian: v.tanggal } : {}), ...(ajukan ? { ajukan: true } : {}) });
/** Badan penerapan LANGSUNG: isian yang sama + apa yang dilihat di pratinjau (server membandingkan dengan keadaan sekarang). */
export const badanPenerapan = (pra, { mode, materialId, v, keBahan, sudahPeriksa = false }) => ({ ...badanPratinjau({ mode, materialId, v, keBahan, ajukan: false }), alasan: v.alasan, dilihat: pra.sidik, ...(sudahPeriksa ? { konfirmasiBukanGanda: true } : {}) });
/** Badan pengajuan (koreksi pemakaian berpersetujuan; hanya ubah jumlah): total yang benar + tanggal dilaporkan untuk unit terkirim. */
export const badanPengajuan = ({ materialId, v }) => ({ materialId, qtyBaru: v.qtyBaru, alasan: v.alasan, ...(v.tanggal ? { tanggalPemakaian: v.tanggal } : {}) });

export const perluPeriksaGanda = (pra) => !!pra?.perluKonfirmasiGanda;
/** Tombol simpan/ajukan aktif hanya bila pratinjau ada, boleh, isian belum berubah sejak pratinjau, dan (bila ada kemungkinan ganda) pengguna menyatakan sudah memeriksa. */
export const bolehSimpan = (pra, sidikSekarang, sidikPratinjau, { sudahPeriksa = false } = {}) => !!pra && pra.boleh === true && sidikSekarang === sidikPratinjau && (!perluPeriksaGanda(pra) || sudahPeriksa === true);
export const labelJalur = (pra) => (pra?.jalur === "AJUKAN" ? "Ajukan perubahan" : "Simpan perubahan");
export const teksJenisLangkah = (l) => (l.jenis === "RETURN" ? "Pengembalian ke stok" : "Pengeluaran dari stok");
const koma = (n) => String(Math.round(Number(n) * 10000) / 10000).replace(".", ",");
/** Satu baris dampak per langkah, apa adanya dari server (tidak menambah angka sendiri). */
export function barisLangkah(pra) {
  return (pra?.langkah ?? []).map((l) => ({
    k: `langkah-${l.urutan}`, judul: `${l.urutan}. ${teksJenisLangkah(l)}: ${l.bahan.nama} ${koma(l.qty)} ${l.bahan.satuan}`,
    stok: `Stok ${l.bahan.kode}: ${l.stok.saldoSebelum === null ? "belum diketahui" : koma(l.stok.saldoSebelum)} → ${koma(l.stok.saldoSesudah)} ${l.bahan.satuan}`,
    finance: l.finance.teks, hpp: l.hppOperasional.teks, hppStatus: l.hppOperasional.status, tanggalDasar: l.hppOperasional.tanggalDasar ?? null,
  }));
}
/** Pesan status sesudah hasil: LANGSUNG = tersimpan; AJUKAN = menunggu persetujuan (bukan seolah tersimpan). */
export function pesanHasil(jenis, { nomor = null, ulang = false } = {}) {
  if (jenis === "AJUKAN") return `Perubahan DIAJUKAN${nomor ? ` (${nomor})` : ""} dan menunggu persetujuan Owner/Finance. Stok dan HPP BELUM berubah sampai disetujui.`;
  return `${ulang ? "Perubahan ini sudah tersimpan sebelumnya (tidak dicatat dua kali)." : "Perubahan tersimpan."} Tampil sebagai baris baru di riwayat; baris lama tidak diubah.`;
}
