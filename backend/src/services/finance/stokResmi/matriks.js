// MATRIKS PERGERAKAN STOK RESMI → JURNAL (Okt 2026) — SATU sumber untuk pratinjau, posting terkunci, dokumen audit, dan endpoint matriks.
//
// Empat dokumen Gudang yang mengubah KUANTITAS stok lewat postStockMovement (services/inventoryLedger.js): Stock Count, Stock Adjustment, Damaged Stock, Return Record.
// Sampai saat ini TIDAK satu pun dari keempatnya menjurnal nilainya (kuantitas berubah, buku besar tidak) — lihat docs/AUDIT-PERGERAKAN-STOK-RESMI.md.
// Modul ini TIDAK mengubah perilaku keempat pintu itu. Ia menyediakan: pratinjau baca-saja, dan posting terkunci (sakelar MATI) yang dipanggil Finance secara eksplisit.
//
// PRINSIP:
//  1. Nilai hanya dari bukti: rata-rata tertimbang penerimaan bernilai (+ baris persediaan awal sesudah cutover). TIDAK PERNAH harga referensi master/Excel, tidak ada tebakan.
//  2. Selisih hasil hitung FISIK ≠ pemakaian bahan per order. Jurnal selisih TIDAK membawa unit/order dan masuk akun Selisih Stok (5-1960) atau Beban Susut (5-1900) — agregat,
//     bukan HPP order/unit. Pemakaian produksi yang belum tercatat hanya DITAMPILKAN sebagai informasi pembanding, tidak pernah diatribusikan otomatis.
//  3. Pergerakan HISTORIS tidak dijurnal mundur (254 ISSUE lama, baseline Excel). Dokumen sebelum tanggal aktivasi ditolak.
//  4. Pembukuan dokumen = SATU jurnal per dokumen, idempoten (kunci jurnal), atomik (jurnal + gap + aktivitas satu transaksi), bisa dibalik resmi (reversal).

export const JENIS = Object.freeze({
  STOCK_COUNT: "STOCK_COUNT",
  STOCK_ADJUSTMENT: "STOCK_ADJUSTMENT",
  DAMAGED_STOCK: "DAMAGED_STOCK",
  RETURN_RECORD: "RETURN_RECORD",
});
export const SEMUA_JENIS = Object.freeze(Object.values(JENIS));

/** Kode penolakan/peringatan — stabil, dipakai UI, tes, dan dokumen. */
export const KODE = Object.freeze({
  FITUR_BELUM_AKTIF: "FITUR_BELUM_AKTIF",
  TANGGAL_AKTIVASI_BELUM_DIISI: "TANGGAL_AKTIVASI_BELUM_DIISI",
  DI_LUAR_PERIODE_AKTIVASI: "DI_LUAR_PERIODE_AKTIVASI",
  DOKUMEN_BELUM_FINAL: "DOKUMEN_BELUM_FINAL",
  TANPA_PERGERAKAN: "TANPA_PERGERAKAN",
  BASELINE_MIGRASI_TIDAK_DIJURNALKAN: "BASELINE_MIGRASI_TIDAK_DIJURNALKAN",
  RETUR_SUPPLIER_BUKAN_SUSUT: "RETUR_SUPPLIER_BUKAN_SUSUT",
  ASAL_RETUR_TIDAK_TERBUKTI: "ASAL_RETUR_TIDAK_TERBUKTI",
  KONVERSI_BUTUH_PASANGAN: "KONVERSI_BUTUH_PASANGAN",
  AKUN_SISTEM_BELUM_SIAP: "AKUN_SISTEM_BELUM_SIAP",
  TANPA_HARGA_PEROLEHAN: "TANPA_HARGA_PEROLEHAN",
  PERSEDIAAN_AWAL_BELUM_DIPOSTING: "PERSEDIAAN_AWAL_BELUM_DIPOSTING",
  TERCAKUP_PERSEDIAAN_AWAL: "TERCAKUP_PERSEDIAAN_AWAL",
  SALDO_BUKU_PERSEDIAAN_KURANG: "SALDO_BUKU_PERSEDIAAN_KURANG",
  SUDAH_DIPOSTING: "SUDAH_DIPOSTING",
  SUDAH_DIBALIK: "SUDAH_DIBALIK",
  PEMAKAIAN_PIC_BELUM_TERCATAT: "PEMAKAIAN_PIC_BELUM_TERCATAT",
  PERIODE_TERTUTUP: "PERIODE_TERTUTUP",
});

export const PESAN = Object.freeze({
  [KODE.FITUR_BELUM_AKTIF]: "Posting dokumen stok resmi belum diaktifkan (sakelar rollout MATI). Pratinjau tetap bisa dilihat.",
  [KODE.TANGGAL_AKTIVASI_BELUM_DIISI]: "Tanggal mulai posting dokumen stok resmi belum ditetapkan Owner/Admin Finance.",
  [KODE.DI_LUAR_PERIODE_AKTIVASI]: "Dokumen bertanggal sebelum tanggal mulai posting — riwayat tidak dijurnal mundur.",
  [KODE.DOKUMEN_BELUM_FINAL]: "Dokumen belum final (belum selesai/diposting di Gudang) — belum ada pergerakan stok yang bisa dibukukan.",
  [KODE.TANPA_PERGERAKAN]: "Dokumen ini tidak menulis pergerakan stok (tidak ada kuantitas yang berubah) — tidak ada yang dijurnal.",
  [KODE.BASELINE_MIGRASI_TIDAK_DIJURNALKAN]: "Stock Count baseline hasil migrasi Excel (saldo pembuka) — DILARANG dijurnal; nilai persediaan awal hanya lewat snapshot Persediaan Awal berdokumen Finance.",
  [KODE.RETUR_SUPPLIER_BUKAN_SUSUT]: "Resolusi RETURN_TO_SUPPLIER menulis WASTE tetapi retur ke supplier BUKAN susut: nilainya berhak ditagih/dikreditkan. Gunakan dokumen Retur Supplier resmi (Debit Note); tidak dijurnal sebagai susut.",
  [KODE.ASAL_RETUR_TIDAK_TERBUKTI]: "Return Record tidak punya asal yang terbukti (tanpa unit/Material Issue tertaut): barang kembali tanpa dasar nilai dan lawan akun. Retur produksi lewat Pengembalian Bahan Produksi; retur customer/pengiriman butuh keputusan akuntansi Owner. Tidak dijurnal otomatis.",
  [KODE.KONVERSI_BUTUH_PASANGAN]: "Adjustment tipe CONVERSION adalah satu sisi dari pasangan (bahan keluar + bahan masuk) — nilai tidak bisa dibuktikan sendiri-sendiri. Tidak dijurnal.",
  [KODE.AKUN_SISTEM_BELUM_SIAP]: "Akun sistem untuk jurnal ini belum ada di bagan akun.",
  [KODE.TANPA_HARGA_PEROLEHAN]: "Material belum punya harga perolehan (penerimaan bernilai/persediaan awal) — nilai TIDAK dikarang, tidak jadi Rp0; gap dicatat.",
  [KODE.PERSEDIAAN_AWAL_BELUM_DIPOSTING]: "Cutover perpetual sudah berlaku tetapi persediaan awal (stok opname) belum diposting — jurnal ditunda agar saldo Persediaan tidak negatif.",
  [KODE.TERCAKUP_PERSEDIAAN_AWAL]: "Dokumen bertanggal sebelum cutover dan persediaan awal sudah diposting: nilainya sudah tercakup stok opname — tidak dijurnal lagi (menghindari ganda).",
  [KODE.SALDO_BUKU_PERSEDIAAN_KURANG]: "Nilai pengeluaran lebih besar dari saldo buku Persediaan Bahan Baku — selesaikan persediaan awal/rekonsiliasi dulu.",
  [KODE.SUDAH_DIPOSTING]: "Dokumen ini sudah dijurnal.",
  [KODE.SUDAH_DIBALIK]: "Jurnal dokumen ini sudah dibalik (final). Koreksi lanjutan lewat dokumen/jurnal baru.",
  [KODE.PEMAKAIAN_PIC_BELUM_TERCATAT]: "INFORMASI: catatan pemakaian PIC melebihi pemakaian yang tercatat di stok pada jendela ini. Itu bisa menjelaskan sebagian selisih, tetapi TIDAK diatribusikan otomatis ke HPP order/unit.",
  [KODE.PERIODE_TERTUTUP]: "Periode pembukuan untuk tanggal jurnal sudah ditutup.",
});

/**
 * Matriks lengkap per AKSI pintu Gudang. `posting`: "TERKUNCI" = ada jalur posting resmi tetapi sakelar MATI (butuh aktivasi bertahap);
 * "DITOLAK" = sengaja tidak ada jalur otomatis (butuh dokumen/keputusan lain).
 */
export const MATRIKS = Object.freeze([
  {
    jenis: JENIS.STOCK_COUNT, aksi: "Selesaikan Stock Count (POST /inventory/stock-counts/:id/complete)", tipePergerakan: "ADJUSTMENT (±) satu baris per material berselisih",
    ubahKuantitas: "Selisih = fisik − (snapshot Start + pergerakan sesi yang DITANDAI sudah terhitung). Tanpa selisih: tidak ada pergerakan.",
    sumberNilai: "Rata-rata tertimbang penerimaan bernilai sampai waktu pergerakan (+ baris persediaan awal bila cutover aktif). Tanpa bukti harga → gap. Harga referensi Excel TIDAK dipakai.",
    jurnalKurang: "Dr 5-1960 Selisih Stok Opname / Cr 1-1400 Persediaan Bahan Baku", jurnalLebih: "Dr 1-1400 Persediaan Bahan Baku / Cr 5-1960 Selisih Stok Opname",
    atribusi: "Agregat. Tanpa unit/order. Dua arah tidak di-netto.", kunciJurnal: "SELISIH_OPNAME:<id>",
    pembatalan: "Dokumen COMPLETED tidak bisa dibatalkan di Gudang. Jurnal bisa dibalik resmi (reversal); stok dikoreksi lewat Stock Adjustment/Count baru.",
    ketergantungan: "Bergantung pada pemakaian bahan Produksi–Gudang yang tercatat: pemakaian yang belum dicatat tampil sebagai selisih negatif semu. Baseline Excel (CC-…-BASELINE) dilarang dijurnal.",
    posting: "TERKUNCI",
  },
  {
    jenis: JENIS.STOCK_ADJUSTMENT, aksi: "Posting Stock Adjustment (POST /inventory/adjustments/:id/post)", tipePergerakan: "ADJUSTMENT (±) satu baris",
    ubahKuantitas: "adjustmentQty bertanda; ditulis terhadap saldo BERJALAN saat posting (bukan beforeQty basi).",
    sumberNilai: "Sama dengan Stock Count (rata-rata tertimbang bukti; gap bila tanpa harga).",
    jurnalKurang: "Dr 5-1960 (DAMAGE/EXPIRY: Dr 5-1900 Beban Susut) / Cr 1-1400", jurnalLebih: "Dr 1-1400 / Cr 5-1960 (DAMAGE/EXPIRY tidak lazim positif)",
    atribusi: "Agregat. CONVERSION ditolak (pasangan).", kunciJurnal: "SELISIH_PENYESUAIAN:<id>",
    pembatalan: "POSTED tidak bisa dibatalkan di Gudang. Jurnal bisa dibalik resmi; stok dikoreksi dengan Adjustment baru.",
    ketergantungan: "Pengaju ≠ penyetuju (pemisahan tugas) sudah ditegakkan Gudang. Nilai tergantung harga perolehan.",
    posting: "TERKUNCI",
  },
  {
    jenis: JENIS.DAMAGED_STOCK, aksi: "Resolve Damaged Stock DISPOSE (POST /inventory/damaged-stock/:id/resolve)", tipePergerakan: "WASTE (−qty)",
    ubahKuantitas: "Mengurangi qty record dari saldo.", sumberNilai: "Rata-rata tertimbang bukti (gap bila tanpa harga).",
    jurnalKurang: "Dr 5-1900 Beban Susut & Bahan Rusak / Cr 1-1400 Persediaan Bahan Baku", jurnalLebih: "—",
    atribusi: "Agregat (kategori PRODUCTION_DEFECT/DELIVERY_DAMAGE tidak otomatis ke order).", kunciJurnal: "SUSUT_BARANG_RUSAK:<id>",
    pembatalan: "RESOLVED tidak bisa dibatalkan. Jurnal bisa dibalik resmi; stok dikembalikan lewat Adjustment.",
    ketergantungan: "Bahan rusak di produksi bisa juga sudah tercatat lewat Material Issue/retur — risiko ganda bila keduanya dipakai.",
    posting: "TERKUNCI",
  },
  {
    jenis: JENIS.DAMAGED_STOCK, aksi: "Resolve Damaged Stock RETURN_TO_SUPPLIER", tipePergerakan: "WASTE (−qty) — tipe SALAH untuk retur supplier",
    ubahKuantitas: "Mengurangi qty record dari saldo (sebagai WASTE).", sumberNilai: "—",
    jurnalKurang: "TIDAK ADA jurnal otomatis (bukan susut). Semestinya Retur Supplier resmi: Dr Utang Usaha/Piutang Supplier / Cr 1-1400", jurnalLebih: "—",
    atribusi: "—", kunciJurnal: "—", pembatalan: "Tidak ada.",
    ketergantungan: "Retur Supplier resmi (SUPPLIER_RETURN + Debit Note) juga mengurangi stok: memakai KEDUANYA = stok berkurang dua kali. Risiko rekonsiliasi tertinggi di pintu ini.",
    posting: "DITOLAK",
  },
  {
    jenis: JENIS.DAMAGED_STOCK, aksi: "Resolve REWORK / RESTORE_TO_AVAILABLE", tipePergerakan: "— (tidak menulis)", ubahKuantitas: "Tidak ada.", sumberNilai: "—",
    jurnalKurang: "Tidak ada", jurnalLebih: "Tidak ada", atribusi: "—", kunciJurnal: "—", pembatalan: "—", ketergantungan: "—", posting: "DITOLAK",
  },
  {
    jenis: JENIS.RETURN_RECORD, aksi: "Complete Return Record RETURN_TO_AVAILABLE (POST /inventory/returns/:id/complete)", tipePergerakan: "RETURN (+qty), tanpa unit/Material Issue",
    ubahKuantitas: "Menambah qty record ke saldo.", sumberNilai: "TIDAK TERBUKTI: dokumen tidak punya asal terstruktur (reference teks bebas).",
    jurnalKurang: "—", jurnalLebih: "TIDAK ADA jurnal otomatis. Lawan akun tergantung asal: retur produksi (Cr 5-1100) hanya lewat Pengembalian Bahan Produksi tertaut unit; customer/pengiriman butuh keputusan Owner.",
    atribusi: "Tidak boleh ke order/unit tanpa dasar.", kunciJurnal: "—", pembatalan: "COMPLETED tidak bisa dibatalkan.",
    ketergantungan: "Retur produksi sudah punya jalur resmi (productionMaterialReturnService, kini terjurnal). Jalur Return Record menggandakan konsep tanpa dasar nilai.",
    posting: "DITOLAK",
  },
]);

/** Akun sistem per jenis/dokumen — dipakai pratinjau & posting (SATU pemetaan). */
export function akunBebanUntuk(jenis, doc) {
  if (jenis === JENIS.DAMAGED_STOCK) return "BEBAN_SUSUT_BAHAN";
  if (jenis === JENIS.STOCK_ADJUSTMENT && ["DAMAGE", "EXPIRY"].includes(doc?.adjustmentType)) return "BEBAN_SUSUT_BAHAN";
  return "SELISIH_STOK";
}

import { SETTING_KEYS } from "../settings.js";

/** Sakelar per jenis dokumen. RETURN_RECORD sengaja TANPA sakelar: ditolak permanen (asal & nilai perolehan barang retur tidak terbukti). */
export const SAKELAR = Object.freeze({
  STOCK_COUNT: { aktif: SETTING_KEYS.STOK_RESMI_OPNAME_AKTIF, sejak: SETTING_KEYS.STOK_RESMI_OPNAME_SEJAK, nama: "Stock Count (opname)" },
  STOCK_ADJUSTMENT: { aktif: SETTING_KEYS.STOK_RESMI_PENYESUAIAN_AKTIF, sejak: SETTING_KEYS.STOK_RESMI_PENYESUAIAN_SEJAK, nama: "Stock Adjustment" },
  DAMAGED_STOCK: { aktif: SETTING_KEYS.STOK_RESMI_RUSAK_AKTIF, sejak: SETTING_KEYS.STOK_RESMI_RUSAK_SEJAK, nama: "Damaged Stock (DISPOSE)" },
  RETURN_RECORD: null,
});

export class StokResmiError extends Error {
  constructor(message, statusCode = 400, code = null, detail = null) {
    super(message); this.name = "StokResmiError"; this.statusCode = statusCode; if (code) this.code = code; if (detail) this.extra = { detail };
  }
}
