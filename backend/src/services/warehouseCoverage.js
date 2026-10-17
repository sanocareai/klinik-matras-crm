// CAKUPAN KOREKSI KESALAHAN INPUT — SEMUA MENU GUDANG (Okt 2026). Murni (tanpa DB): satu sumber untuk (a) matriks cakupan per menu, (b) jalur koreksi per dokumen+status yang dipakai UI.
//
// Empat jalur, tidak ada tombol "Edit" umum untuk semua status:
//   EDIT_DRAF   — dokumen belum diposting dan belum mengubah stok: boleh diedit sesuai izin lewat alur biasa, SETIAP perubahan tercatat (sebelum/sesudah) di log aktivitas.
//   KOREKSI_UI  — dokumen sudah diposting: koreksi bertaut (pratinjau dampak → alasan wajib → pemohon ≠ penyetuju bila mengubah stok → pergerakan pembalik/selisih bertaut ke asal).
//   ALUR_RESMI  — sudah ada alur resmi di tempat lain (Finance/Gudang/Produksi) yang lebih tepat; UI menunjukkan langkah nyata, TIDAK membuat jalur ganda.
//   DIBLOKIR    — tidak boleh dikoreksi dari Gudang (milik Produksi/Finance atau final); alasan dan langkah penyelesaian spesifik.
//   FINAL       — dokumen berakhir (dibatalkan/ditolak): tidak ada yang dikoreksi; buat dokumen baru bila perlu.
// Batas: koreksi Gudang TIDAK mengubah pembayaran/jurnal/tagihan Finance dan TIDAK menciptakan QC, penerimaan fisik, atau pemakaian Produksi.

export const JALUR = Object.freeze({ EDIT_DRAF: "EDIT_DRAF", KOREKSI_UI: "KOREKSI_UI", ALUR_RESMI: "ALUR_RESMI", DIBLOKIR: "DIBLOKIR", FINAL: "FINAL" });
export const TIPE = Object.freeze({
  GOODS_RECEIPT: "GOODS_RECEIPT", MATERIAL_ISSUE: "MATERIAL_ISSUE", STOCK_TRANSFER: "STOCK_TRANSFER", RETURN_RECORD: "RETURN_RECORD", DAMAGED_STOCK: "DAMAGED_STOCK",
  STOCK_ADJUSTMENT: "STOCK_ADJUSTMENT", STOCK_COUNT: "STOCK_COUNT", SUPPLIER_RETURN: "SUPPLIER_RETURN",
});
export const TIPE_DIKENAL = Object.freeze(Object.values(TIPE));

const langkah = (...x) => x;
const hasil = (jalur, judul, penjelasan, steps = [], extra = {}) => ({ jalur, judul, penjelasan, langkah: steps, pengaruh: { stok: false, produksi: false, finance: false }, ...extra });

const ALUR_STOCK_ADJUSTMENT = langkah(
  "Buka Penyesuaian → Ajukan Penyesuaian untuk bahan itu (alasan wajib, tulis dokumen asal di catatan).",
  "Penyetuju yang BERBEDA dari pemohon menyetujui, lalu diposting — pergerakan ADJUSTMENT baru; riwayat dokumen asal tetap terlihat.",
);

/**
 * Jalur koreksi satu dokumen. `doc` memuat field relevan (status, sourceType/purchaseOrderId, productionPlanId, resolution, dll.). Tanpa field = jalur umum berdasar status.
 */
export function jalurDokumen(tipe, doc = {}) {
  const s = String(doc.status ?? "");
  switch (tipe) {
    case TIPE.GOODS_RECEIPT: {
      if (s === "REJECTED") return hasil(JALUR.FINAL, "Penerimaan ditolak atau dibatalkan", "Dokumen berakhir tanpa menambah stok (dibatalkan sebelum barang tiba, atau barang tiba lalu ditolak). Jika keliru, buat Penerimaan Baru dari PO.", langkah("Buat jadwal/penerimaan baru dari Barang Akan Datang (PO) atau Penerimaan Baru."));
      if (s !== "COMPLETED") return hasil(JALUR.EDIT_DRAF, "Boleh diedit (belum masuk stok)", "Penerimaan belum disimpan ke stok. Isian boleh diperbaiki sesuai izin; tiap perubahan tercatat sebelum–sesudah.", langkah(
        s === "DRAFT" || s === "SCHEDULED" ? "Ubah jadwal kedatangan langsung di detail penerimaan." : "Ubah isian di detail penerimaan (tanggal, surat jalan, jumlah, kondisi).",
        s === "SCHEDULED" ? "Salah jadwalkan? Kembalikan ke Draf, atau Batalkan penerimaan (alasan singkat) selama barang belum dicatat tiba." : "Salah buat? Batalkan penerimaan (alasan singkat) selama belum ada barang tiba.",
      ), { pengaruh: { stok: false, produksi: false, finance: !!doc.purchaseOrderId } });
      if (doc.purchaseOrderId) return hasil(JALUR.ALUR_RESMI, "Sudah masuk stok — dari PO: pakai Koreksi Kedatangan (resmi)", "Penerimaan dari PO terhubung ke progres PO, jadwal termin, tagihan, dan jurnal persediaan. Koreksi jumlah baik dan data kedatangan memakai satu pintu resmi yang sudah ada: wajib alasan, pratinjau dampak (progres PO, termin, jurnal), pergerakan pembalik + pengganti bertaut. Diblokir otomatis bila bahan sudah dipakai/dipindah/dihitung opname, ada retur supplier aktif, atau faktur disetujui mengklaim baris itu.", langkah(
        "Tekan “Koreksi Kedatangan (resmi)” di detail penerimaan ini (membuka form yang sama dengan Barang Akan Datang).",
        "Isi nilai baru + alasan, tekan Lihat Dampak; jika tidak diblokir, simpan.",
        "Bila bahan yang dipilih salah (bukan sekadar jumlah): Finance mengoreksi PO/baris PO lebih dulu — Gudang tidak mengganti bahan penerimaan PO.",
      ), { pengaruh: { stok: true, produksi: false, finance: true }, tindakan: [{ kode: "KOREKSI_KEDATANGAN", label: "Koreksi Kedatangan (resmi)" }] });
      return hasil(JALUR.KOREKSI_UI, "Sudah masuk stok — koreksi bertaut", "Penerimaan tanpa PO. Catatan asal tidak diubah. Koreksi metadata (supplier, referensi, surat jalan, catatan, tanggal dokumen) langsung tercatat; koreksi jumlah, bahan, atau lokasi mengubah stok → pratinjau dampak, alasan wajib, disetujui orang lain, lalu pergerakan pembalik/selisih bertaut ke penerimaan ini.", langkah(
        "Tekan “Koreksi Penerimaan” di detail penerimaan ini.",
        "Pilih jenis koreksi (data saja, atau jumlah/bahan/lokasi), isi nilai baru dan alasan, lihat dampak.",
        "Koreksi stok menunggu penyetuju yang berbeda dari pemohon (Owner); setelah disetujui pergerakan tercatat.",
      ), { pengaruh: { stok: true, produksi: false, finance: false }, tindakan: [{ kode: "KOREKSI_PENERIMAAN", label: "Koreksi Penerimaan" }] });
    }
    case TIPE.MATERIAL_ISSUE: {
      if (s === "CANCELLED") return hasil(JALUR.FINAL, "Permintaan dibatalkan", "Tidak menulis stok. Buat Permintaan Bahan baru bila perlu.", langkah("Buat Permintaan Bahan baru."));
      if (doc.productionPlanId) return hasil(JALUR.DIBLOKIR, "Dokumen bahan Produksi (V2)", "Dokumen ini dimiliki alur Produksi (rencana produksi/eksekusi bengkel). Gudang tidak mengoreksinya dari sini agar tidak menciptakan atau menghapus pemakaian Produksi.", langkah(
        "Koreksi dilakukan Produksi lewat alur Material Issue/Pengembalian Material produksi.",
        "Bila stok fisik berbeda dari catatan, ajukan Penyesuaian Stok (pemohon ≠ penyetuju).",
      ), { pengaruh: { stok: s === "ISSUED", produksi: true, finance: false } });
      if (s === "ISSUED") return hasil(JALUR.ALUR_RESMI, "Sudah dikeluarkan — pakai Pengembalian / Penyesuaian", "Stok sudah keluar dan terhubung ke pemakaian unit. Isian tidak diubah. Kelebihan keluar dikembalikan lewat Pengembalian Bahan (Return Record) setelah diperiksa; bahan salah dikembalikan lalu dibuat Permintaan baru; selisih fisik lewat Penyesuaian Stok.", langkah(
        "Kelebihan/bahan salah: buat Pengembalian Bahan (Gudang → Barang Rusak, Retur & Penyesuaian → Retur) untuk bahan itu, periksa, selesaikan sebagai Kembali ke Stok.",
        "Lalu buat Permintaan Bahan baru dengan bahan/jumlah yang benar.",
        "Selisih tanpa dokumen: Penyesuaian Stok (pemohon ≠ penyetuju).",
      ), { pengaruh: { stok: true, produksi: !!doc.unitId, finance: false } });
      return hasil(JALUR.EDIT_DRAF, "Boleh diedit (belum keluar stok)", "Permintaan belum mengeluarkan stok. Isian boleh diperbaiki sesuai status; reservasi mengikuti. Perubahan tercatat sebelum–sesudah; batalkan dengan alasan bila salah total.", langkah("Ubah permintaan di detail, atau Batalkan (alasan wajib)."));
    }
    case TIPE.STOCK_TRANSFER: {
      if (s === "CANCELLED") return hasil(JALUR.FINAL, "Transfer dibatalkan", "Tidak ada perpindahan yang terjadi.", langkah("Buat Transfer baru bila perlu."));
      if (s === "COMPLETED") return hasil(JALUR.ALUR_RESMI, "Sudah diterima — buat Transfer balik", "Perpindahan antar lokasi sudah tercatat dua sisi (keluar+masuk, saldo total tidak berubah). Tidak ada penghapusan; salah lokasi diperbaiki dengan Transfer baru dari lokasi tujuan ke lokasi yang benar.", langkah("Buat Transfer baru: dari lokasi tujuan yang salah ke lokasi yang benar (alasan di catatan), lalu Kirim dan Terima."), { pengaruh: { stok: true, produksi: false, finance: false } });
      if (s === "IN_TRANSIT") return hasil(JALUR.ALUR_RESMI, "Dalam perjalanan — selesaikan lewat Terima", "Stok sudah keluar dari lokasi asal. Barang yang tiba dicatat lewat Terima; tidak boleh dibatalkan diam-diam saat barang di jalan.", langkah("Konfirmasi Terima di lokasi tujuan; selisih jumlah lewat Penyesuaian Stok."), { pengaruh: { stok: true, produksi: false, finance: false } });
      return hasil(JALUR.EDIT_DRAF, "Boleh diedit (belum keluar)", "Transfer belum memindahkan stok. Isian boleh diperbaiki sesuai status; tercatat sebelum–sesudah; atau batalkan dengan alasan.", langkah("Ubah transfer di detail, atau Batalkan (alasan wajib)."));
    }
    case TIPE.RETURN_RECORD: {
      if (s === "CANCELLED") return hasil(JALUR.FINAL, "Retur dibatalkan", "Tidak menulis stok.", langkah("Buat Retur baru bila perlu."));
      if (s === "COMPLETED") {
        const masuk = doc.resolution === "RETURN_TO_AVAILABLE";
        return hasil(JALUR.ALUR_RESMI, masuk ? "Retur sudah masuk stok — koreksi lewat Penyesuaian" : "Retur selesai tanpa mengubah stok", masuk ? "Barang retur sudah masuk stok (pergerakan RETURN). Tidak dibatalkan atau diedit; selisih diperbaiki dengan Penyesuaian Stok bertaut (pemohon ≠ penyetuju)." : "Resolusi ini tidak menulis pergerakan stok; tidak ada angka yang perlu dibalik. Perbaiki keputusan dengan dokumen baru.", masuk ? ALUR_STOCK_ADJUSTMENT : langkah("Buat Retur baru atau dokumen kerusakan sesuai kondisi barang."), { pengaruh: { stok: masuk, produksi: !!doc.unitId, finance: false } });
      }
      return hasil(JALUR.EDIT_DRAF, "Boleh diteruskan/dibatalkan (belum masuk stok)", "Retur belum menulis stok. Perbaiki lewat transisi status biasa atau batalkan dengan alasan; perubahan tercatat.", langkah("Ubah/lanjutkan retur, atau Batalkan (alasan wajib)."));
    }
    case TIPE.DAMAGED_STOCK: {
      if (s === "RESOLVED") {
        const keluar = doc.resolution === "DISPOSE" || doc.resolution === "RETURN_TO_SUPPLIER";
        return hasil(JALUR.ALUR_RESMI, keluar ? "Sudah dikeluarkan dari stok — koreksi lewat Penyesuaian" : "Selesai tanpa pergerakan stok", keluar ? "Resolusi sudah menulis pergerakan WASTE. Catatan asal tidak dihapus; bila ternyata keliru, stok dikembalikan lewat Penyesuaian Stok bertaut (pemohon ≠ penyetuju). Retur ke supplier yang bernilai ditangani lewat Retur Supplier resmi (Finance mengelola nota debit)." : "Resolusi ini tidak menulis stok.", keluar ? ALUR_STOCK_ADJUSTMENT : langkah("Catat laporan baru bila kondisi barang berubah."), { pengaruh: { stok: keluar, produksi: false, finance: doc.resolution === "RETURN_TO_SUPPLIER" } });
      }
      return hasil(JALUR.EDIT_DRAF, "Boleh diperiksa/diubah (belum diselesaikan)", "Laporan belum menulis stok. Lengkapi pemeriksaan sebelum diselesaikan; perubahan tercatat.", langkah("Perbarui laporan/pemeriksaan di detail."));
    }
    case TIPE.STOCK_ADJUSTMENT: {
      if (s === "POSTED") return hasil(JALUR.ALUR_RESMI, "Sudah diposting — koreksi dengan penyesuaian pembalik", "Penyesuaian yang diposting tidak diubah/dihapus. Kekeliruan dikoreksi dengan Penyesuaian baru berlawanan tanda (dengan alasan dan rujukan nomor ini), disetujui orang lain.", langkah("Ajukan Penyesuaian baru dengan jumlah berlawanan; tulis nomor penyesuaian asal di alasan.", "Penyetuju berbeda menyetujui dan memposting."), { pengaruh: { stok: true, produksi: false, finance: true } });
      if (s === "CANCELLED") return hasil(JALUR.FINAL, "Penyesuaian dibatalkan", "Tidak menulis stok.", langkah("Ajukan penyesuaian baru bila perlu."));
      return hasil(JALUR.EDIT_DRAF, "Boleh diedit/dibatalkan (belum diposting)", "Belum menulis stok. Pemohon memperbaiki sebelum disetujui; penyetuju bisa mengembalikan; perubahan tercatat.", langkah("Ubah/ajukan ulang di detail, atau Batalkan (alasan wajib)."));
    }
    case TIPE.STOCK_COUNT: {
      if (s === "CANCELLED") return hasil(JALUR.FINAL, "Hitungan dibatalkan", "Tidak menulis stok.", langkah("Buat Stock Count baru."));
      if (s === "COMPLETED") return hasil(JALUR.ALUR_RESMI, "Hitungan selesai — koreksi dengan hitungan ulang/penyesuaian", "Hasil hitung dan penyesuaian yang sudah diposting tidak dibatalkan. Kesalahan input hitung diperbaiki dengan Stock Count/Cycle Count baru untuk bahan itu (penghitung ≠ pemeriksa ≠ penyetuju) atau Penyesuaian Stok bertaut.", langkah("Buat Cycle Count baru untuk bahan yang keliru.", "Atau ajukan Penyesuaian Stok dengan rujukan nomor hitungan ini."), { pengaruh: { stok: true, produksi: false, finance: true } });
      return hasil(JALUR.EDIT_DRAF, "Boleh dikoreksi lewat Hitung Ulang (belum selesai)", "Hitungan belum diposting. Angka salah diperbaiki lewat Hitung Ulang/isian baris sebelum Kirim; pemeriksa dan penyetuju berbeda mengesahkan.", langkah("Ubah hitungan di baris atau minta Hitung Ulang sebelum diselesaikan."));
    }
    case TIPE.SUPPLIER_RETURN: {
      if (s === "DIBATALKAN") return hasil(JALUR.FINAL, "Retur supplier dibatalkan", "Pergerakan balik sudah tercatat bila barang sempat keluar.", langkah("Buat Retur Supplier baru bila perlu."));
      if (s === "DRAFT") return hasil(JALUR.EDIT_DRAF, "Draf — boleh diubah/dibatalkan", "Belum mengeluarkan stok.", langkah("Perbaiki draf atau Batalkan."), { pengaruh: { stok: false, produksi: false, finance: true } });
      return hasil(JALUR.ALUR_RESMI, "Retur supplier — pakai alur resmi Batalkan Retur", "Barang yang sudah keluar dikembalikan lewat Batalkan Retur (pergerakan balik) selama belum ada nota debit disetujui. Nota debit adalah milik Finance.", langkah("Gudang: Retur Supplier → Batalkan (alasan wajib).", "Bila nota debit sudah disetujui: Finance membatalkannya lebih dulu."), { pengaruh: { stok: true, produksi: false, finance: true } });
    }
    default:
      return hasil(JALUR.DIBLOKIR, "Jenis dokumen tidak dikenal", "Tidak ada jalur koreksi yang terdaftar untuk dokumen ini.", langkah("Hubungi admin sistem."));
  }
}

/** Matriks cakupan per MENU Gudang (sidebar). `jalur` = jalur utama untuk dokumen yang sudah diposting; draf selalu EDIT_DRAF lewat alur biasa dengan jejak. */
export const MATRIKS_MENU = Object.freeze([
  { menu: "Penerimaan Barang", tipe: TIPE.GOODS_RECEIPT, jalur: JALUR.KOREKSI_UI, stok: true, produksi: false, finance: "PO: ya (Koreksi Kedatangan resmi)", catatan: "Sudah masuk stok tanpa PO: koreksi bertaut (metadata langsung; jumlah/bahan/lokasi → pemohon≠penyetuju). Dari PO: alur resmi Koreksi Kedatangan, dibuka dari detail penerimaan." },
  { menu: "Barang Akan Datang", tipe: TIPE.GOODS_RECEIPT, jalur: JALUR.ALUR_RESMI, stok: true, produksi: false, finance: "ya", catatan: "Catat Barang Tiba + Koreksi Kedatangan sudah ada (alasan, revisi, pratinjau dampak). Pembayaran PO tidak bergantung pada kedatangan." },
  { menu: "Pengeluaran Material", tipe: TIPE.MATERIAL_ISSUE, jalur: JALUR.ALUR_RESMI, stok: true, produksi: true, finance: "tidak", catatan: "Draf/diajukan: edit + batal dengan jejak. Sudah ISSUED: Pengembalian Bahan lalu permintaan baru; dokumen V2 milik Produksi diblokir." },
  { menu: "Permintaan Bahan", tipe: TIPE.MATERIAL_ISSUE, jalur: JALUR.EDIT_DRAF, stok: false, produksi: true, finance: "tidak", catatan: "Sama dengan Pengeluaran Material (satu dokumen)." },
  { menu: "Transfer Stok", tipe: TIPE.STOCK_TRANSFER, jalur: JALUR.ALUR_RESMI, stok: true, produksi: false, finance: "tidak", catatan: "Sebelum Kirim: edit/batal. Dalam perjalanan: Terima. Sudah diterima: Transfer balik." },
  { menu: "Retur (Return Record)", tipe: TIPE.RETURN_RECORD, jalur: JALUR.ALUR_RESMI, stok: true, produksi: true, finance: "tidak", catatan: "Sebelum selesai: lanjutkan/batal. Sudah masuk stok: Penyesuaian Stok bertaut." },
  { menu: "Retur Supplier", tipe: TIPE.SUPPLIER_RETURN, jalur: JALUR.ALUR_RESMI, stok: true, produksi: false, finance: "ya (nota debit)", catatan: "Batalkan Retur (pergerakan balik) selama belum ada nota debit disetujui." },
  { menu: "Barang Rusak", tipe: TIPE.DAMAGED_STOCK, jalur: JALUR.ALUR_RESMI, stok: true, produksi: false, finance: "ya jika retur ke supplier", catatan: "Sebelum selesai: periksa/ubah. Sudah dikeluarkan: Penyesuaian Stok bertaut." },
  { menu: "Penyesuaian Stok", tipe: TIPE.STOCK_ADJUSTMENT, jalur: JALUR.ALUR_RESMI, stok: true, produksi: false, finance: "ya (jurnal selisih stok resmi)", catatan: "Sebelum posting: edit/batal. Sudah diposting: penyesuaian pembalik oleh penyetuju berbeda." },
  { menu: "Stock Count / Stock Opname", tipe: TIPE.STOCK_COUNT, jalur: JALUR.ALUR_RESMI, stok: true, produksi: false, finance: "ya (jurnal selisih stok resmi)", catatan: "Sebelum selesai: Hitung Ulang. Sudah selesai: hitungan baru/Penyesuaian bertaut; Opname Penuh wajib pemeriksa berbeda." },
  { menu: "Opname Cutover Persediaan", tipe: null, jalur: JALUR.DIBLOKIR, stok: true, produksi: false, finance: "ya (milik Finance)", catatan: "Persediaan awal berjurnal: dikoreksi lewat alur Finance (pembalikan resmi). Gudang tidak mengubah." },
  { menu: "Stok & Lokasi (master bahan)", tipe: null, jalur: JALUR.EDIT_DRAF, stok: false, produksi: false, finance: "tidak", catatan: "Master bahan bukan ledger: nama/kategori/aktif boleh diubah sesuai izin; satuan tidak diubah bila sudah ada pergerakan. Saldo tidak pernah diedit langsung." },
  { menu: "Restok", tipe: null, jalur: JALUR.EDIT_DRAF, stok: false, produksi: false, finance: "tidak", catatan: "Usulan restok bukan dokumen stok; boleh diperbaiki/dibatalkan sebelum menjadi PO (milik Finance)." },
  { menu: "Terima Barang Jadi / Penerimaan Unit / Antrean Produksi", tipe: null, jalur: JALUR.DIBLOKIR, stok: false, produksi: true, finance: "tidak", catatan: "Milik Produksi (QC, serah-terima unit, custody). Gudang tidak mengoreksi agar tidak menciptakan/menghapus QC atau penerimaan fisik palsu." },
  { menu: "Pengajuan Biaya / Laporan Biaya", tipe: null, jalur: JALUR.DIBLOKIR, stok: false, produksi: false, finance: "ya (milik Finance)", catatan: "Koreksi lewat alur Finance." },
  { menu: "Riwayat Pergerakan / KPI Gudang / Laporan", tipe: null, jalur: JALUR.FINAL, stok: false, produksi: false, finance: "tidak", catatan: "Hanya baca. Riwayat tidak diubah; koreksi tampil sebagai pergerakan bertaut." },
]);

/** Penghalang yang dapat muncul pada koreksi Penerimaan (kode stabil → pesan + langkah penyelesaian nyata). Dipakai layanan, UI, tes, dan dokumen. */
export const PENGHALANG = Object.freeze({
  BUKAN_COMPLETED: { pesan: "Penerimaan belum masuk stok — koreksi stok tidak berlaku.", langkah: "Ubah isian di alur penerimaan biasa (draf boleh diedit)." },
  PENERIMAAN_DITOLAK: { pesan: "Penerimaan yang ditolak berakhir tanpa stok.", langkah: "Buat Penerimaan Baru." },
  DARI_PO: { pesan: "Penerimaan dari PO terhubung ke progres PO, termin, tagihan, dan jurnal — koreksi memakai Koreksi Kedatangan (resmi).", langkah: "Buka “Koreksi Kedatangan (resmi)” pada penerimaan ini." },
  KOREKSI_TERTUNDA: { pesan: "Masih ada koreksi lain yang menunggu persetujuan untuk penerimaan ini.", langkah: "Selesaikan (setujui/tolak/batalkan) koreksi yang tertunda dulu." },
  BARIS_BAHAN_GANDA: { pesan: "Penerimaan memuat bahan yang sama di lebih dari satu baris — pergerakan stok per baris tidak bisa dipisahkan dengan pasti.", langkah: "Gunakan Penyesuaian Stok untuk bahan itu (pemohon ≠ penyetuju)." },
  LEDGER_TIDAK_SINKRON: { pesan: "Jumlah di ledger tidak sama dengan jumlah baik yang tercatat pada penerimaan — dasar koreksi tidak terbukti.", langkah: "Selesaikan lewat Stock Count/Penyesuaian Stok resmi; laporkan ke admin." },
  BAHAN_SUDAH_BERGERAK: { pesan: "Bahan sudah dipakai/dipindah/disesuaikan sejak penerimaan ini disimpan — asal stok yang dikoreksi tidak bisa dipastikan.", langkah: "Pakai Penyesuaian Stok (pemohon ≠ penyetuju) untuk selisih yang terbukti, atau kembalikan pergerakan lanjutan lewat alurnya (Pengembalian/Transfer balik) lalu ulangi." },
  SUDAH_DIHITUNG_OPNAME: { pesan: "Bahan sudah masuk hitungan Stock Count sejak penerimaan disimpan — mengubah penerimaan akan membuat hasil hitung tidak konsisten.", langkah: "Selesaikan atau batalkan Stock Count itu; selisih diperbaiki lewat hitungan/Penyesuaian resmi." },
  STOK_TIDAK_CUKUP: { pesan: "Stok tersedia (stok − reservasi) tidak cukup untuk dikurangi.", langkah: "Lepas reservasi/Material Issue yang menahan stok, atau kembalikan bahan yang sudah keluar, lalu ulangi." },
  RETUR_AKTIF: { pesan: "Ada Retur Supplier aktif pada baris penerimaan ini.", langkah: "Gudang: batalkan Retur Supplier itu, lalu ulangi koreksi." },
  TAGIHAN_TERKAIT: { pesan: "Ada tagihan/faktur supplier aktif yang menautkan penerimaan ini.", langkah: "Finance: batalkan/koreksi tagihan itu lewat alur Finance (jurnal dibalik resmi), lalu ulangi koreksi." },
  JURNAL_FINANCE: { pesan: "Penerimaan ini sudah dijurnal di buku besar (Persediaan/Barang Belum Ditagih). Gudang tidak mengubah jurnal Finance.", langkah: "Finance: koreksi lewat alur resmi (jurnal koreksi/pembalikan). Setelah itu koreksi stok dapat diajukan." },
  TERCAKUP_STOK_OPNAME: { pesan: "Penerimaan bertanggal sebelum cutover persediaan dan sudah tercakup stok opname awal — dikoreksi lewat Finance.", langkah: "Finance: alur Opname Cutover Persediaan." },
  TANPA_PERUBAHAN: { pesan: "Tidak ada perubahan dibanding keadaan sekarang.", langkah: "Ubah minimal satu nilai." },
  NILAI_TIDAK_VALID: { pesan: "Nilai koreksi tidak valid.", langkah: "Perbaiki isian." },
  BAHAN_PENGGANTI_TIDAK_VALID: { pesan: "Bahan pengganti tidak ditemukan/tidak aktif atau sama dengan bahan asal.", langkah: "Pilih bahan aktif yang berbeda." },
  SATUAN_BEDA: { pesan: "Bahan pengganti memakai satuan berbeda — jumlah tidak dikonversi otomatis.", langkah: "Pilih bahan sesatuan, atau Tech/Gudang memutuskan satuan lebih dulu; jangan menebak konversi." },
  WAKTU_TIDAK_VALID: { pesan: "Tanggal dokumen tidak valid (kosong, masa depan, atau setelah koreksi lain).", langkah: "Isi tanggal yang benar dan tidak di masa depan." },
});
