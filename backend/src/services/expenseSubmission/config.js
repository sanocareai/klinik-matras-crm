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
  MARKETING: {
    division: "MARKETING",
    label: "Marketing",
    expenseTypes: [
      { code: "IKLAN", label: "Belanja iklan" },
      { code: "LAINNYA", label: "Lainnya" },
    ],
    relations: [],
    requiresLeaderReview: false,
    metadataFields() {
      return [
        { key: "platform", label: "Platform", type: "text", required: false },
        { key: "adAccount", label: "Akun iklan", type: "text", required: false },
        { key: "periodStart", label: "Periode mulai", type: "date", required: false },
        { key: "periodEnd", label: "Periode selesai", type: "date", required: false },
      ];
    },
  },
  MANAGEMENT: {
    division: "MANAGEMENT",
    label: "Management",
    expenseTypes: [
      { code: "MEETING", label: "Meeting/survey" },
      { code: "LAINNYA", label: "Lainnya" },
    ],
    relations: [],
    requiresLeaderReview: false,
    metadataFields() {
      return [
        { key: "activity", label: "Kegiatan", type: "text", required: false },
        { key: "budgetRef", label: "Referensi anggaran", type: "text", required: false },
      ];
    },
  },
  HR_GA: {
    division: "HR_GA",
    label: "HR & GA",
    expenseTypes: [
      { code: "REIMBURSEMENT_KARYAWAN", label: "Reimbursement karyawan" },
      { code: "ASET", label: "Aset kantor" },
      { code: "LAINNYA", label: "Lainnya" },
    ],
    relations: [],
    requiresLeaderReview: false,
    metadataFields() {
      return [
        { key: "employeeName", label: "Nama karyawan", type: "text", required: false },
        { key: "assetLocation", label: "Lokasi aset", type: "text", required: false },
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
export const JENIS_TERLARANG_STOK = Object.freeze(["MATERIAL", "BAHAN_TAMBAHAN", "BAHAN_BAKU", "PEMBELIAN_MATERIAL", "PENERIMAAN_BARANG", "PEMAKAIAN_BAHAN", "TRANSFER_STOK", "BARANG_RUSAK", "PENYESUAIAN_STOK"]);

export function getWorkspaceConfig(workspace) {
  return WORKSPACES[workspace] || null;
}

export function daftarWorkspaceAktif() {
  // Delivery (pilot), Produksi & Warehouse (C1). Divisi lain masih stub tanpa UI/pemetaan akun.
  return ["DELIVERY", "PRODUKSI", "WAREHOUSE"];
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
