// Tampilan Riwayat Referensi (catatan dari file) — Okt 2026. Ini CATATAN REFERENSI, BUKAN transaksi/saldo. Teks & label dipusatkan di sini supaya konsisten dan mudah diuji.
export const LABEL_REFERENSI = "REFERENSI HISTORIS DARI FILE — bukan transaksi resmi (GR, Material Issue, movement), bukan saldo, dan bukan bukti tanggal pemakaian.";
export const TEKS_TANGGAL_PEMAKAIAN = "Tanggal pemakaian: tidak ada bukti";

export const STATUS_REFERENSI = Object.freeze({
  BELUM_DIVERIFIKASI: { label: "Belum diverifikasi", tone: "neutral", arti: "Tertulis di file; belum ada dokumen resmi yang cocok. Bukan bukti sudah dipakai." },
  SUDAH_ADA_DI_RESMI: { label: "Sudah ada di resmi", tone: "green", arti: "Order+bahan ini sudah tercatat di dokumen resmi (Issue/GR). Lihat dokumen resminya; catatan ini tidak dicatat ulang." },
  ADA_DOKUMEN_RESMI_BELUM_DIPOSTING: { label: "Dokumen resmi belum diposting", tone: "orange", arti: "Ada Material Issue/GR resmi yang belum selesai untuk order+bahan ini. Selesaikan lewat dokumen resmi, bukan dari file." },
  PERLU_PEMERIKSAAN: { label: "Perlu pemeriksaan", tone: "orange", arti: "Terbukti tiba (tanggal kirim aktual) tetapi belum ada GR. Catatan pemeriksaan — BUKAN stok masuk." },
  PERLU_PENYELESAIAN: { label: "Antrean penyelesaian", tone: "red", arti: "Tidak dapat dipetakan/dibandingkan otomatis. Butuh keputusan manusia." },
});
export const ANTREAN_REFERENSI = Object.freeze({
  TANPA_PASANGAN: "Tanpa pasangan di master", PEMETAAN_PERLU_KONFIRMASI: "Pemetaan perlu konfirmasi", NAMA_MASTER_GANDA: "Nama master ganda", SATUAN_BEDA: "Satuan beda dengan master",
  SATUAN_CAMPUR: "Satuan campur", ANGKA_TIDAK_VALID: "Jumlah tidak terbaca",
});
export const JENIS_REFERENSI = Object.freeze({ PEMAKAIAN_ORDER: "Pemakaian per order (file)", PENERIMAAN_TERBUKTI_TANPA_GR: "Penerimaan terbukti tiba (file)" });

export const bolehImpor = (roles) => Array.isArray(roles) && roles.some((r) => ["WAREHOUSE", "ADMIN", "OWNER"].includes(r));

/** Ringkas "Sumber": file + baris. */
export const teksSumber = (r) => `${r.sumberFile} · baris ${(r.sumberBaris || []).join(", ")}`;
/** Jumlah ditampilkan dengan satuan FILE apa adanya (tidak dikonversi); kosong bila tidak terbaca. */
export const teksJumlah = (r) => (r.jumlah == null ? "tidak terbaca" : `${r.jumlah} ${r.satuanFile || ""}`.trim());
export const teksTanggal = (r) => (r.jenis === "PEMAKAIAN_ORDER" ? `Tanggal order ${r.tanggalOrder || "—"} · ${TEKS_TANGGAL_PEMAKAIAN}` : `Tanggal kirim aktual ${r.tanggalKirim || "—"}`);

const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
/** "2026-08" → "Agustus 2026". Selalu dipakai bersama kata "tanggal order": bulan ini BUKAN bulan pemakaian yang terbukti. */
export const namaBulan = (ym) => { const m = /^(\d{4})-(\d{2})$/.exec(String(ym || "")); return m ? `${NAMA_BULAN[Number(m[2]) - 1]} ${m[1]}` : String(ym || "—"); };
export const teksPerBulan = (perBulan = {}) => Object.keys(perBulan).sort().map((k) => `${namaBulan(k)}: ${perBulan[k]}`).join(" · ");
export const KETERANGAN_BULAN = "Dihitung dari TANGGAL ORDER di file. Bukan bukti kapan bahan dipakai (tanggal pemakaian tidak ada bukti; label bulan SEP/OKT di file tidak dipercaya).";
export const TEKS_T0 = "T0 tidak menyaring baris file dan BUKAN syarat impor. T0 hanya peringatan: menandai dokumen RESMI (movement/GR) yang waktu kejadiannya terbukti sesudah T0, dan mengingatkan bahwa tanggal pemakaian di file tidak diketahui.";
/** Teks catatan T0 pada dokumen resmi terkait. */
export const teksDokumenResmi = (d) => (d ? `${d.jenis}${d.nomor ? " " + d.nomor : ""}${(d.dokumen || []).length ? " " + d.dokumen.join(", ") : ""}${d.setelahT0 === true ? " · dibuat/terjadi SESUDAH T0" : d.setelahT0 === false ? " · sebelum T0" : ""}` : "");

/** Dua gerbang terpisah — ditampilkan di tab dan panduan. */
export const TEKS_GERBANG_IMPOR = "Gerbang 1 — IMPOR CATATAN REFERENSI: cukup pratinjau + konfirmasi hash oleh petugas berhak (Gudang/Admin/Owner). TIDAK menunggu T0, cek fisik 8 bahan P1, keputusan satuan, atau keputusan GR. Hasilnya hanya catatan: tidak ada movement, saldo, GR, Material Issue, adjustment, atau jurnal.";
export const TEKS_GERBANG_OPERASIONAL = "Gerbang 2 — MULAI TRANSAKSI OPERASIONAL (GR / Material Issue baru): dimulai pada T0 yang disepakati. Penahan berlaku PER BAHAN/DOKUMEN terkait saja — bahan P1, konflik satuan, atau GR tertunda menahan transaksi bahan itu, bukan GR atau Material Issue bahan lain yang valid. Cek fisik dengan pemeriksa berbeda diwajibkan pada alur koreksi stok, bukan transaksi rutin. Mengimpor catatan referensi tidak membuka gerbang ini. PO dan pembayaran Finance berjalan independen dari GR.";
export const TEKS_SEGARKAN = "Membuka atau menyegarkan tab ini hanya MEMBACA: status selalu dihitung terkini dari dokumen resmi. Tombol \"Simpan snapshot status\" bersifat manual dan hanya mencatat revisi pada catatan referensi (bukan transaksi); tidak wajib untuk melihat status.";
