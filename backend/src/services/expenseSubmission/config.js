// KONFIGURASI FORM PER WORKSPACE DIVISI — fondasi reusable untuk Pengajuan Biaya Lintas
// Divisi (lihat banner di schema.prisma#ExpenseSubmission). Divisi baru (Produksi/
// Warehouse/Marketing/Management/HR-GA) TIDAK butuh migrasi skema untuk menambah jenis
// biaya baru — cukup tambah entri di sini. UI (frontend) merender field SECARA DINAMIS
// dari config yang dikirim endpoint GET /expense-submissions/config, tidak ada field
// hardcode per divisi di kode React.
//
// SETIAP entri workspace WAJIB punya:
//   division            — FinDivision yang dipakai saat FinExpense dibuat
//   expenseTypes         — daftar jenis biaya valid untuk workspace ini (server MENOLAK
//                          expenseType di luar daftar ini — lihat service.js#validasiTipe)
//   relations             — relasi opsional yang BOLEH diisi (job/route/vehicle/driver/
//                          helper/order) — dipakai frontend untuk tahu picker mana yang
//                          ditampilkan, dan backend untuk menolak field yang tidak relevan
//   metadataFields(tipe) — fungsi: daftar field metadata terstruktur untuk SATU jenis
//                          biaya (dinamis per jenis, mis. BBM punya odometer+liter,
//                          SEWA tidak) — bentuk field: { key, label, type, required }
//   requiresLeaderReview — true kalau workspace ini mewajibkan review internal SEBELUM
//                          masuk ke Finance (status DIAJUKAN tertahan menunggu leader).
//                          Delivery: false (LEADER_DRIVER tidak punya izin approval
//                          finance — lihat audit; "diajukan" langsung jadi FinExpense).

// Sumber dana USULAN dari pemohon (ExpenseSubmission.sumberDana) — dipakai
// SEMUA workspace, bukan per-divisi. Cuma klasifikasi/hint; mode FinExpense
// final (LANGSUNG/REIMBURSEMENT/UTANG) tetap ditentukan buatFinExpense()
// dari kapabilitas user (lihat modeDariSumberDana() di service.js) — rekening
// TIDAK PERNAH berkurang saat baru diajukan atau saat ditanggung pribadi,
// cuma saat FinExpense-nya benar-benar /pay (prinsip "dokumen dulu, jurnal
// belakangan" yang sudah dipegang seluruh Finance Workspace).
export const SUMBER_DANA = [
  { code: "REKENING_PERUSAHAAN", label: "Dibayar langsung rekening perusahaan" },
  { code: "UANG_MUKA_OPERASIONAL", label: "Uang muka operasional (kas yang sudah dipegang)" },
  { code: "TALANGAN_PRIBADI", label: "Ditanggung driver/karyawan dulu (reimbursement)" },
  { code: "BELUM_DIBAYAR", label: "Belum dibayar (utang ke pihak ketiga)" },
];

export const WORKSPACES = {
  DELIVERY: {
    division: "DELIVERY",
    keanggotaan: "DELIVERY",
    label: "Delivery",
    expenseTypes: [
      { code: "BBM", label: "BBM" },
      { code: "TOL", label: "Tol" },
      { code: "PARKIR", label: "Parkir" },
      { code: "SERVIS", label: "Servis" },
      { code: "BAN", label: "Ban" },
      { code: "CUCI", label: "Cuci kendaraan" },
      { code: "DENDA", label: "Denda/tilang" },
      { code: "SEWA", label: "Sewa kendaraan" },
      { code: "LAINNYA", label: "Lainnya" },
    ],
    // Pemetaan WAJIB & EKSPLISIT expenseType -> FinExpenseCategory.code (lihat
    // DEFAULT_EXPENSE_CATEGORIES di accounts.js). SENGAJA tidak ada fallback:
    // kategoriUntuk() di service.js menolak (422) kalau kode di sini tidak
    // ditemukan/nonaktif di FinExpenseCategory, TIDAK PERNAH diam-diam memilih
    // kategori lain — transaksi finansial tidak boleh salah akun cuma karena
    // Finance belum sempat memasang kategorinya.
    categoryMapping: {
      BBM: "BBM", TOL: "TOL", PARKIR: "PARKIR", SERVIS: "SERVIS_KENDARAAN",
      BAN: "BAN_KENDARAAN", CUCI: "CUCI_KENDARAAN", DENDA: "DENDA_TILANG",
      SEWA: "SEWA_KENDARAAN", LAINNYA: "BIAYA_KENDARAAN_LAIN",
    },
    // Auto-approve untuk jenis biaya RUTIN bernilai kecil (D-181, 24 September
    // 2026) — BBM/tol/parkir yang setiap hari terjadi berkali-kali tidak perlu
    // menunggu Finance klik approve satu-satu. `maxAmount` adalah pagar
    // keamanan supaya "BBM" yang nilainya janggal besar tetap masuk antrean
    // manusia — kedua angka ini sengaja mudah diubah di satu tempat kalau
    // kebijakan Finance berubah, TIDAK di-hardcode di service.js.
    autoApprove: { types: ["BBM", "TOL", "PARKIR"], maxAmount: 300_000 },
    relations: ["job", "route", "vehicle", "driver", "helper"],
    requiresLeaderReview: false,
    metadataFields(tipe) {
      const umum = [
        { key: "vendorOrLocation", label: "Vendor / lokasi", type: "text", required: false },
      ];
      if (tipe === "BBM") {
        return [
          { key: "odometerKm", label: "Odometer (km)", type: "number", required: false },
          { key: "liters", label: "Jumlah liter", type: "decimal", required: true },
          { key: "pricePerLiter", label: "Harga per liter", type: "money", required: false },
          ...umum,
        ];
      }
      if (tipe === "SERVIS" || tipe === "BAN") {
        return [
          { key: "odometerKm", label: "Odometer (km)", type: "number", required: true },
          { key: "workshop", label: "Bengkel", type: "text", required: false },
          ...umum,
        ];
      }
      if (tipe === "TOL" || tipe === "PARKIR" || tipe === "CUCI") {
        return umum;
      }
      if (tipe === "DENDA") {
        return [{ key: "violationRef", label: "Nomor tilang/referensi", type: "text", required: false }, ...umum];
      }
      if (tipe === "SEWA") {
        return [
          { key: "rentalPeriodStart", label: "Mulai sewa", type: "date", required: false },
          { key: "rentalPeriodEnd", label: "Selesai sewa", type: "date", required: false },
          ...umum,
        ];
      }
      return umum;
    },
  },

  // ── PRODUKSI & WAREHOUSE (C1, 25 September 2026) ─────────────────────────────────────────────
  // Biaya OPERASIONAL NON-STOK. Semua yang menggerakkan stok tetap lewat Inventory/Pembelian (lihat ARAHAN_MODUL_LAIN dan
  // guard di guard.js) — di sini TIDAK BOLEH ada jenis biaya untuk pembelian material, penerimaan barang, pemakaian bahan,
  // transfer stok, barang rusak, atau penyesuaian stok.
  //
  // categoryMapping HANYA berisi kategori Finance yang sudah punya akun resmi (DEFAULT_EXPENSE_CATEGORIES di accounts.js).
  // Jenis biaya tanpa entri di sini (nilai null di `tanpaAkun`) TAMPIL tetapi tidak bisa dipilih: tidak ada akun tebakan.
  PRODUKSI: {
    division: "PRODUKSI",
    keanggotaan: "PRODUCTION",
    label: "Produksi",
    expenseTypes: [
      { code: "SERVIS_MESIN", label: "Servis / perawatan mesin" },
      { code: "TOOLING_KECIL", label: "Tooling kecil" },
      { code: "VENDOR_JASA", label: "Vendor / jasa produksi" },
      { code: "LEMBUR", label: "Lembur / upah mendesak" },
      { code: "KEBUTUHAN_MENDESAK", label: "Kebutuhan produksi mendesak (non-stok)" },
      { code: "BIAYA_OPERASIONAL", label: "Biaya operasional non-stok" },
    ],
    categoryMapping: {
      SERVIS_MESIN: "MAINT_MESIN", // 6-1150 Beban Pemeliharaan Mesin & Peralatan
      TOOLING_KECIL: "OVERHEAD_PRODUKSI", // 5-1300 Beban Overhead Produksi
      VENDOR_JASA: "OVERHEAD_PRODUKSI", // 5-1300
      LEMBUR: "UPAH_PRODUKSI", // 5-1200 Beban Upah Produksi
      KEBUTUHAN_MENDESAK: "OVERHEAD_PRODUKSI", // 5-1300
      BIAYA_OPERASIONAL: "OVERHEAD_PRODUKSI", // 5-1300
    },
    tanpaAkun: {},
    strict: true, peranPic: ["PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD"],
    ringkas: "Servis mesin, alat kerja kecil, jasa vendor/tukang, lembur, dan kebutuhan produksi mendesak yang bukan stok.",
    konteksMetadata: [],
    catatanJenis: {},
    // relasi yang BOLEH diisi: order, unit (selalu milik order-nya), mesin (WorkCenter). Field kendaraan/rute/job ditolak.
    relations: ["order", "unit", "machine"],
    relasiWajib: { SERVIS_MESIN: ["machine"] },
    wajibAlasanMendesak: ["KEBUTUHAN_MENDESAK", "LEMBUR"],
    requiresLeaderReview: false,
    metadataFields(tipe) {
      switch (tipe) {
        case "SERVIS_MESIN": return [{ key: "pekerjaan", label: "Pekerjaan yang dilakukan", type: "text", required: true }];
        case "TOOLING_KECIL": return [{ key: "namaAlat", label: "Nama alat", type: "text", required: true }, { key: "jumlah", label: "Jumlah", type: "number", required: false }];
        case "VENDOR_JASA": return [{ key: "lingkupJasa", label: "Lingkup jasa", type: "text", required: true }];
        case "LEMBUR": return [
          { key: "jumlahJam", label: "Jumlah jam lembur", type: "decimal", required: true },
          { key: "jumlahOrang", label: "Jumlah orang", type: "number", required: true },
          { key: "tahapan", label: "Tahapan produksi", type: "text", required: false },
        ];
        default: return [{ key: "keperluan", label: "Keperluan", type: "text", required: true }];
      }
    },
  },
  WAREHOUSE: {
    division: "GUDANG",
    keanggotaan: "WAREHOUSE",
    label: "Warehouse",
    expenseTypes: [
      { code: "KURIR_LOGISTIK", label: "Kurir / logistik" },
      { code: "PERLENGKAPAN_GUDANG", label: "Perlengkapan gudang (non-stok)" },
      { code: "BONGKAR_MUAT", label: "Bongkar muat" },
      { code: "PERAWATAN_FASILITAS", label: "Perawatan fasilitas" },
      { code: "BIAYA_MENDESAK", label: "Biaya operasional mendesak" },
    ],
    categoryMapping: {
      KURIR_LOGISTIK: "KURIR_EKSTERNAL", // 6-1340 Beban Kurir Eksternal
      PERLENGKAPAN_GUDANG: "PERLENGKAPAN", // 6-1600 Beban Perlengkapan Kantor
      // Kategori bawaan baru C1 (migrasi 20260926130000) — memakai akun resmi 6-1900 yang SUDAH ada; Finance boleh mengarahkannya ke akun lain.
      BONGKAR_MUAT: "BONGKAR_MUAT_GUDANG",
      PERAWATAN_FASILITAS: "PERAWATAN_FASILITAS_GUDANG",
      BIAYA_MENDESAK: "BIAYA_GUDANG_MENDESAK",
    },
    tanpaAkun: {}, // semua jenis biaya Gudang kini punya kategori resmi
    strict: true, peranPic: ["WAREHOUSE", "PRODUCTION_LEAD"],
    ringkas: "Bongkar muat, kurir/logistik, perlengkapan gudang non-stok, perawatan fasilitas, dan biaya operasional mendesak.",
    konteksMetadata: [],
    catatanJenis: {},
    relations: ["warehouse", "material", "document"],
    relasiWajib: {},
    wajibAlasanMendesak: ["BIAYA_MENDESAK"],
    requiresLeaderReview: false,
    metadataFields(tipe) {
      switch (tipe) {
        case "KURIR_LOGISTIK": return [{ key: "tujuan", label: "Tujuan / ekspedisi", type: "text", required: true }, { key: "nomorResi", label: "Nomor resi", type: "text", required: false }];
        case "PERLENGKAPAN_GUDANG": return [{ key: "namaBarang", label: "Nama barang (non-stok)", type: "text", required: true }, { key: "jumlah", label: "Jumlah", type: "number", required: false }];
        default: return [{ key: "keperluan", label: "Keperluan", type: "text", required: true }];
      }
    },
  },
  // ── MARKETING, MANAGEMENT & HR-GA (C2, 26 September 2026) ───────────────────────────────────────────────────────────
  // Konfigurasi DATA-DRIVEN di atas fondasi C1: jenis biaya, kategori Finance, field khusus divisi, peran pengaju, dan arahan modul lain
  // semuanya dibaca UI dari GET /expense-submissions/config — tidak ada halaman/cabang kode per divisi.
  // Peran pengaju: sistem BELUM punya peran khusus Marketing/HR-GA/Management. Marketing memakai peran SALES (tim growth); Management &
  // HR-GA hanya dapat diajukan/dicatat oleh Finance/Admin/Owner sampai peran divisinya dibuat (lihat access.js). Tidak ada akses lintas divisi implisit.
  MARKETING: {
    division: "MARKETING", keanggotaan: "MARKETING", label: "Marketing", strict: true,
    // C2.1: SALES BUKAN otomatis Marketing — akses lewat keanggotaan divisi MARKETING (Admin/Owner yang mengatur), tanpa adapter peran.
    peranPic: null,
    ringkas: "Iklan & promosi, produksi konten, event/aktivasi, cetak materi promosi, tools/langganan marketing, dan transportasi/representasi kegiatan marketing.",
    expenseTypes: [
      { code: "IKLAN_PROMOSI", label: "Iklan & promosi (di luar belanja iklan platform)" },
      { code: "KONTEN", label: "Produksi konten" },
      { code: "EVENT", label: "Event / aktivasi" },
      { code: "CETAK_PROMO", label: "Cetak materi promosi" },
      { code: "TOOLS_MARKETING", label: "Tools / langganan marketing" },
      { code: "TRANSPORT_REPRESENTASI", label: "Transportasi / representasi kegiatan marketing" },
    ],
    categoryMapping: {
      IKLAN_PROMOSI: "MKT_PROMOSI", KONTEN: "MKT_KONTEN", EVENT: "MKT_EVENT", CETAK_PROMO: "MKT_CETAK", // 6-1200 Beban Iklan & Pemasaran
      TOOLS_MARKETING: "LANGGANAN_APLIKASI", // 6-1160
      TRANSPORT_REPRESENTASI: "OPS_MEETING", // 6-1170
    },
    catatanJenis: {
      IKLAN_PROMOSI: "Belanja iklan platform (Meta, Google, TikTok) sudah dicatat bulanan lewat Pengaturan Sales › Biaya Iklan — jangan diajukan lagi di sini.",
    },
    tanpaAkun: {}, relations: [], relasiWajib: {}, wajibAlasanMendesak: [], requiresLeaderReview: false,
    konteksMetadata: [{ key: "campaign", label: "Campaign" }, { key: "channel", label: "Channel" }, { key: "periodStart", label: "Mulai", tanggal: true }, { key: "periodEnd", label: "Selesai", tanggal: true }],
    metadataFields() {
      return [
        { key: "keperluan", label: "Keperluan / kegiatan", type: "text", required: true },
        { key: "campaign", label: "Campaign", type: "text", required: false },
        { key: "channel", label: "Channel", type: "select", required: false, options: ["Instagram", "Facebook", "TikTok", "WhatsApp", "Google", "Marketplace", "Offline / event", "Lainnya"] },
        { key: "periodStart", label: "Periode kegiatan mulai", type: "date", required: false },
        { key: "periodEnd", label: "Periode kegiatan selesai", type: "date", required: false },
      ];
    },
  },
  MANAGEMENT: {
    division: "MANAGEMENT", keanggotaan: "MANAGEMENT", label: "Management", strict: true,
    peranPic: null,
    ringkas: "Meeting dan representasi, perjalanan dinas, konsultan/jasa profesional, legal/perizinan, langganan manajemen, dan kebutuhan operasional khusus.",
    expenseTypes: [
      { code: "MEETING_REPRESENTASI", label: "Meeting & representasi" },
      { code: "PERJALANAN_DINAS", label: "Perjalanan dinas" },
      { code: "KONSULTAN", label: "Konsultan / jasa profesional" },
      { code: "LEGAL_PERIZINAN", label: "Legal / perizinan" },
      { code: "LANGGANAN_MANAJEMEN", label: "Langganan manajemen" },
      { code: "OPERASIONAL_KHUSUS", label: "Kebutuhan operasional khusus" },
    ],
    categoryMapping: {
      MEETING_REPRESENTASI: "OPS_MEETING", PERJALANAN_DINAS: "OPS_MEETING", // 6-1170
      KONSULTAN: "MGT_KONSULTAN", LEGAL_PERIZINAN: "MGT_LEGAL", // 6-1900 (kategori tersendiri agar laporan terpisah)
      LANGGANAN_MANAJEMEN: "LANGGANAN_APLIKASI", // 6-1160
      OPERASIONAL_KHUSUS: "LAIN_LAIN", // 6-1900
    },
    catatanJenis: {},
    tanpaAkun: {}, relations: [], relasiWajib: {}, wajibAlasanMendesak: ["OPERASIONAL_KHUSUS"], requiresLeaderReview: false,
    konteksMetadata: [{ key: "tujuan", label: "Tujuan" }, { key: "divisiPenerima", label: "Untuk divisi" }],
    metadataFields() {
      return [
        { key: "keperluan", label: "Keperluan / kegiatan", type: "text", required: true },
        { key: "tujuan", label: "Tujuan (kota / pihak)", type: "text", required: false },
        { key: "divisiPenerima", label: "Divisi penerima manfaat", type: "select", required: false, options: ["Sales", "Marketing", "Produksi", "Gudang", "Delivery", "HR & GA", "Management", "Umum"] },
      ];
    },
  },
  HR_GA: {
    division: "HR_GA", keanggotaan: "HR_GA", label: "HR & GA", strict: true,
    peranPic: null,
    ringkas: "Rekrutmen, pelatihan, kesejahteraan karyawan, ATK dan kebutuhan kantor non-stok, perawatan fasilitas, serta perizinan dan administrasi.",
    expenseTypes: [
      { code: "REKRUTMEN", label: "Rekrutmen" },
      { code: "PELATIHAN", label: "Pelatihan" },
      { code: "KESEJAHTERAAN", label: "Kesejahteraan karyawan" },
      { code: "ATK_KANTOR", label: "ATK & kebutuhan kantor (non-stok)" },
      { code: "PERAWATAN_FASILITAS", label: "Perawatan fasilitas" },
      { code: "PERIZINAN_ADMINISTRASI", label: "Perizinan & administrasi" },
    ],
    categoryMapping: {
      REKRUTMEN: "HRGA_REKRUTMEN", PELATIHAN: "HRGA_PELATIHAN", KESEJAHTERAAN: "HRGA_KESEJAHTERAAN", // 6-1900
      ATK_KANTOR: "PERLENGKAPAN", // 6-1600
      PERAWATAN_FASILITAS: "HRGA_PERAWATAN_FASILITAS", PERIZINAN_ADMINISTRASI: "HRGA_PERIZINAN", // 6-1900
    },
    catatanJenis: { KESEJAHTERAAN: "Bukan gaji, THR, atau bonus — itu payroll. Bukan pinjaman/kasbon karyawan — itu Finance › Kasbon." },
    tanpaAkun: {}, relations: [], relasiWajib: {}, wajibAlasanMendesak: [], requiresLeaderReview: false,
    konteksMetadata: [{ key: "kegiatan", label: "Kegiatan" }, { key: "lokasi", label: "Lokasi" }, { key: "jumlahOrang", label: "Peserta", satuan: "orang" }],
    metadataFields() {
      return [
        { key: "kegiatan", label: "Kegiatan / keperluan", type: "text", required: true },
        { key: "lokasi", label: "Lokasi", type: "text", required: false },
        { key: "jumlahOrang", label: "Jumlah peserta / orang", type: "number", required: false },
      ];
    },
  },
};

/** FinDivision yang tersimpan di pengajuan -> kunci workspace (GUDANG dulu tak terpetakan ke WAREHOUSE, sehingga edit/ajukan gagal). */
export function workspaceUntukDivisi(division) {
  if (division === "GUDANG") return "WAREHOUSE";
  return WORKSPACES[division] ? division : null;
}

/** Kebutuhan yang BUKAN biaya operasional: tetap lewat Inventory/Pembelian yang sudah ada. Dipakai UI (kartu arahan) dan pesan galat server. */
export const ARAHAN_MODUL_LAIN = Object.freeze([
  { kebutuhan: "Pembelian material stok (kain, busa, per, dan sejenisnya)", ke: "Finance › Pembelian, atau Gudang › Penerimaan Barang", path: "/finance/purchases" },
  { kebutuhan: "Penerimaan barang dari supplier", ke: "Gudang › Penerimaan Barang", path: "/warehouse/goods-receipt" },
  { kebutuhan: "Pemakaian bahan produksi", ke: "Gudang › Pengeluaran Material", path: "/warehouse/material-issue" },
  { kebutuhan: "Transfer stok antar gudang", ke: "Gudang › Transfer Stok", path: "/warehouse/transfers" },
  { kebutuhan: "Barang rusak atau penyesuaian stok", ke: "Gudang › Penyesuaian Stok", path: "/warehouse/adjustments" },
]);

/** Kode jenis biaya yang dulu/umum dipakai untuk urusan stok — ditolak dengan arahan modul yang benar, bukan sekadar "tidak dikenal". */
export const JENIS_TERLARANG_STOK = Object.freeze(["MATERIAL", "BAHAN_TAMBAHAN", "BAHAN_BAKU", "PEMBELIAN_MATERIAL", "PENERIMAAN_BARANG", "PEMAKAIAN_BAHAN", "TRANSFER_STOK", "BARANG_RUSAK", "PENYESUAIAN_STOK", "PERSEDIAAN", "PEMBELIAN_STOK", "BARANG_DAGANG"]);

/**
 * C2 — jenis biaya yang BUKAN biaya operasional umum dan harus lewat modulnya sendiri (aset, payroll, kasbon, transaksi antarbank, tagihan
 * supplier, belanja iklan platform). Ditolak dengan arahan modul yang benar. Kunci = kode jenis biaya (huruf besar).
 */
export const ARAHAN_JENIS = Object.freeze({
  ASET: { label: "Aset tetap", ke: "Finance › Pembelian (kategori aset) atau Supplier & Utang › Tagihan jenis Mesin / Peralatan", path: "/finance/purchases" },
  ASET_TETAP: { label: "Aset tetap", ke: "Finance › Pembelian (kategori aset) atau Supplier & Utang › Tagihan jenis Mesin / Peralatan", path: "/finance/purchases" },
  ASET_KANTOR: { label: "Aset tetap", ke: "Finance › Pembelian (kategori aset) atau Supplier & Utang › Tagihan jenis Mesin / Peralatan", path: "/finance/purchases" },
  PAYROLL: { label: "Payroll", ke: "diproses Finance sebagai payroll (Finance › Jurnal Umum), bukan Pengajuan Biaya", path: "/finance/journal" },
  GAJI: { label: "Gaji / payroll", ke: "diproses Finance sebagai payroll (Finance › Jurnal Umum), bukan Pengajuan Biaya", path: "/finance/journal" },
  THR: { label: "THR / bonus (payroll)", ke: "diproses Finance sebagai payroll (Finance › Jurnal Umum), bukan Pengajuan Biaya", path: "/finance/journal" },
  BONUS: { label: "Bonus (payroll)", ke: "diproses Finance sebagai payroll (Finance › Jurnal Umum), bukan Pengajuan Biaya", path: "/finance/journal" },
  KASBON: { label: "Kasbon karyawan", ke: "Finance › Kasbon", path: "/finance/kasbon" },
  PINJAMAN_KARYAWAN: { label: "Pinjaman karyawan", ke: "Finance › Kasbon", path: "/finance/kasbon" },
  TRANSFER_BANK: { label: "Transaksi antarbank", ke: "Finance › Kas & Bank (Transfer Kas)", path: "/finance/cash" },
  TRANSFER_ANTAR_BANK: { label: "Transaksi antarbank", ke: "Finance › Kas & Bank (Transfer Kas)", path: "/finance/cash" },
  PINDAH_DANA: { label: "Pemindahan dana antarbank", ke: "Finance › Kas & Bank (Transfer Kas)", path: "/finance/cash" },
  TAGIHAN_SUPPLIER: { label: "Tagihan supplier", ke: "Finance › Supplier & Utang", path: "/finance/suppliers" },
  BELANJA_IKLAN: { label: "Belanja iklan platform", ke: "Pengaturan Sales › Biaya Iklan (AdSpend)", path: "/pengaturan-sales" },
  ADSPEND: { label: "Belanja iklan platform", ke: "Pengaturan Sales › Biaya Iklan (AdSpend)", path: "/pengaturan-sales" },
});

/** Arahan modul yang ditampilkan di halaman Marketing/Management/HR-GA (UI membacanya dari konfigurasi server). */
export const ARAHAN_MODUL_UMUM = Object.freeze([
  { kebutuhan: "Pembelian aset tetap", ke: "Finance › Pembelian (kategori aset)", path: "/finance/purchases" },
  { kebutuhan: "Tagihan supplier & persediaan", ke: "Finance › Supplier & Utang, atau Gudang › Penerimaan Barang", path: "/finance/suppliers" },
  { kebutuhan: "Gaji, THR, dan bonus (payroll)", ke: "Diproses Finance (Jurnal Umum)", path: "/finance/journal" },
  { kebutuhan: "Pinjaman / kasbon karyawan", ke: "Finance › Kasbon", path: "/finance/kasbon" },
  { kebutuhan: "Transaksi antarbank", ke: "Finance › Kas & Bank", path: "/finance/cash" },
]);

/** Ringkasan konteks khusus divisi dari metadata (campaign, channel, tujuan, kegiatan, lokasi, peserta) — dipakai daftar/duplikat/detail. */
export function ringkasKonteksMetadata(cfg, metadata) {
  const m = metadata && typeof metadata === "object" ? metadata : {};
  return (cfg?.konteksMetadata || [])
    .map((f) => {
      const v = m[f.key];
      if (v === undefined || v === null || String(v).trim() === "") return null;
      const teks = f.tanggal ? String(v).slice(0, 10) : String(v);
      return `${f.label} ${teks}${f.satuan ? ` ${f.satuan}` : ""}`;
    })
    .filter(Boolean)
    .join(" · ");
}

export function getWorkspaceConfig(workspace) {
  return WORKSPACES[workspace] || null;
}

export function daftarWorkspaceAktif() {
  // Delivery (pilot), Produksi & Warehouse (C1), Marketing / Management / HR-GA (C2).
  return ["DELIVERY", "PRODUKSI", "WAREHOUSE", "MARKETING", "MANAGEMENT", "HR_GA"];
}

/** Boleh lewat jalur OTOMATIS_DISETUJUI? Default tertutup (workspace tanpa `autoApprove` = selalu manual). */
// mandiriOwn = pengajuan diajukan oleh akun own-only (delivery:expense:own:write tanpa jalur pengajuan lama;
// diturunkan SERVER-SIDE dari izin aktor, bukan field kiriman klien). Pengajuan mandiri Driver/Helper/Leader
// Driver TIDAK PERNAH auto-approve: selalu menunggu persetujuan Finance. Jalur/role lama tidak berubah.
export function bolehAutoApprove(cfg, expenseType, amount, { mandiriOwn = false } = {}) {
  if (mandiriOwn) return false;
  const policy = cfg?.autoApprove;
  if (!policy) return false;
  if (!policy.types.includes(expenseType)) return false;
  return Number(amount) <= policy.maxAmount;
}
