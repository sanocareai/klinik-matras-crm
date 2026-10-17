// KESIAPAN MENCATAT TRANSAKSI BARU PER BAHAN (BACA-SAJA).
//
// Transaksi baru (GR putaway, Material Issue, retur) memakai dokumen resmi dan ledger sebagai saldo. Bahan "siap" bila memakai ledger apa adanya tidak menghambat produksi dan tidak menyesatkan.
// Yang menahan: ledger ≤ 0 padahal catatan Gudang menyatakan ada (Issue tertahan, saldo tidak boleh minus), ledger positif padahal catatan menyatakan habis, ledger negatif, dokumen tertunda, konflik satuan.
// RUANG LINGKUP PENAHAN: setiap penahan berlaku HANYA untuk bahan itu (dan dokumen terkaitnya, mis. GR tertunda bahan itu). Tidak ada penahan global: P1, konflik satuan, atau GR tertunda
// pada satu bahan TIDAK menahan GR / Material Issue bahan lain yang valid. Ini laporan baca-saja, bukan penegak; satu-satunya penolakan sistem tetap per bahan (saldo ledger tidak cukup).
// Cek fisik dengan penghitung ≠ pemeriksa ≠ penyetuju diwajibkan pada alur KOREKSI stok (Stock Count/Adjustment), bukan pada setiap transaksi rutin.
// Tidak ada angka dari file yang menjadi saldo; penahan diselesaikan dengan cek fisik + koreksi resmi (Stock Count / Stock Adjustment) oleh orang berbeda.
import { PRIORITAS } from "./stokRekonCatatan.js";

export const KESIAPAN = Object.freeze({
  SIAP: "SIAP",
  SIAP_DENGAN_CATATAN: "SIAP_DENGAN_CATATAN",
  TAHAN_CEK_FISIK_P1: "TAHAN_CEK_FISIK_P1",
  TAHAN_NEGATIF: "TAHAN_LEDGER_NEGATIF",
  TAHAN_DOKUMEN: "TAHAN_DOKUMEN_TERTUNDA",
  TAHAN_SATUAN: "TAHAN_SATUAN",
  WASPADA_P2: "WASPADA_CEK_FISIK_P2",
});

export const RUANG_PENAHAN = Object.freeze({ BAHAN_INI: "HANYA_BAHAN_INI", TIDAK_ADA: "TIDAK_MENAHAN" });
export const CATATAN_RUANG = "Penahan berlaku per bahan/dokumen terkait saja; tidak menahan GR atau Material Issue bahan lain yang valid. Cek fisik + pemeriksa berbeda diwajibkan pada alur koreksi stok, bukan transaksi rutin.";
const MENAHAN = new Set(["TAHAN_CEK_FISIK_P1", "TAHAN_LEDGER_NEGATIF", "TAHAN_DOKUMEN_TERTUNDA", "TAHAN_SATUAN"]);

export function kesiapanPencatatanBaru({ catatan, riwayat, materials, ledger, pending = [] }) {
  const cat = new Map(catatan.bahan.map((x) => [x.materialId, x])); const riw = new Map(riwayat.bahan.map((x) => [x.materialId, x]));
  const bahan = materials.filter((m) => m.active).map((m) => {
    const c = cat.get(m.id); const r = riw.get(m.id); const ledgerKini = Math.round((ledger.get(m.id) || []).reduce((s, x) => s + x.qty, 0) * 10000) / 10000;
    const pend = pending.filter((p) => p.materialCode === m.code);
    const satuanKonflik = (c?.isu || []).some((i) => ["SATUAN_BEDA", "SATUAN_TIDAK_TERTULIS", "SATUAN_TIDAK_DIKENAL"].includes(i.kode)) || (r?.isu || []).some((i) => i.kode === "SATUAN_STOK_BEDA");
    let kesiapan; let alasan; let tindakan;
    const p1 = c?.prioritas === PRIORITAS.P1_MENGHAMBAT;
    if (p1) { kesiapan = KESIAPAN.TAHAN_CEK_FISIK_P1; alasan = c.alasanPrioritas + (pend.length ? ` Juga ada dokumen tertunda (${[...new Set(pend.map((p) => p.dok))].join(", ")}): keputusan GR TETAP dibutuhkan, selain cek fisik.` : ""); tindakan = "Cek fisik (Cycle Count, penghitung ≠ pemeriksa) lalu koreksi resmi bila fisik berbeda" + (pend.length ? "; petugas memutuskan dokumen tertunda setelah ada bukti kedatangan (tidak otomatis)." : "."); }
    else if (satuanKonflik) { kesiapan = KESIAPAN.TAHAN_SATUAN; alasan = "Satuan file ≠ master atau tidak tertulis."; tindakan = "Tetapkan satuan hitung & faktor (jika ada) lewat keputusan Gudang+Tech; hitung fisik dalam satuan master."; }
    else if (pend.length) { kesiapan = KESIAPAN.TAHAN_DOKUMEN; alasan = `Dokumen tertunda: ${[...new Set(pend.map((p) => p.dok))].join(", ")}.`; tindakan = "Petugas memutuskan dokumen (selesaikan/tahan) setelah ada bukti kedatangan; jangan putaway otomatis."; }
    else if (ledgerKini < -1e-6) { kesiapan = KESIAPAN.TAHAN_NEGATIF; alasan = `Ledger ${ledgerKini}: pengeluaran bahan ini ditolak sistem.`; tindakan = "Cek fisik lalu koreksi resmi; GR yang sah menaikkan saldo hanya bila ledger tidak negatif atau setelah koreksi."; }
    else if (c?.prioritas === PRIORITAS.P2_RISIKO) { kesiapan = KESIAPAN.WASPADA_P2; alasan = c.alasanPrioritas; tindakan = "Boleh dicatat, tetapi cek fisik sebelum pengeluaran besar; koreksi resmi bila fisik < ledger."; }
    else if (r && ["ADA_RIWAYAT_BELUM_DI_LEDGER"].includes(r.status)) { kesiapan = KESIAPAN.SIAP_DENGAN_CATATAN; alasan = "Ada riwayat Oktober yang belum di ledger (penerimaan terbukti tanpa GR atau pemakaian per order); tidak menghambat pencatatan baru."; tindakan = "Riwayat direkonsiliasi bertahap; transaksi baru dicatat dari T0 lewat dokumen resmi."; }
    else { kesiapan = KESIAPAN.SIAP; alasan = "Tidak ada penahan terdeteksi untuk MENCATAT transaksi baru. BUKAN bukti jumlah tersedia — saldo ledger belum dihitung fisik."; tindakan = ""; }
    return { kode: m.code, nama: m.name, satuan: m.unit, kesiapan, alasan, ledgerKini, tindakan, cekFisikMendesakP1: p1, dokumenTertunda: pend.length > 0, ruangPenahan: MENAHAN.has(kesiapan) ? RUANG_PENAHAN.BAHAN_INI : RUANG_PENAHAN.TIDAK_ADA, dokumenTerkait: [...new Set(pend.map((p) => p.dok))] };
  });
  const ringkasan = bahan.reduce((o, x) => ((o[x.kesiapan] = (o[x.kesiapan] || 0) + 1), o), {});
  return { ringkasan, bahan, catatanRuang: CATATAN_RUANG };
}
