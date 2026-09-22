// BAGAN AKUN (Chart of Accounts) — definisi baku + resolver akun sistem.
//
// DUA HAL BERBEDA ADA DI FILE INI, sengaja bersebelahan:
//
//  1. DEFAULT_COA — daftar akun bawaan yang dipasang sekali lewat
//     ensureDefaultChartOfAccounts(). Ini BUKAN "data seed developer": akun
//     di sini dipilih supaya tiap transaksi yang SUDAH ADA di sistem punya
//     rumah yang benar (pendapatan layanan/produk/sewa terpisah karena
//     OrderCategory memang memisahkannya; beban BBM/tol/parkir terpisah
//     karena VehicleExpense.category memang memisahkannya). Admin tetap
//     bebas menambah akun sendiri lewat UI — yang TIDAK boleh dihapus
//     hanyalah akun ber-systemKey.
//
//  2. SYSTEM_KEYS + resolveAccount() — cara mesin posting menemukan akun
//     TANPA meng-hardcode kode akun ("1-1300") di kode program. Kalau suatu
//     saat owner mau menomori ulang bagan akunnya, systemKey-nya ikut
//     pindah bersama akunnya dan mesin posting tidak perlu diubah sebaris
//     pun. Meng-hardcode kode akun adalah cara paling umum sistem akuntansi
//     buatan sendiri jadi mustahil dirawat.
//
// URUTAN KODE mengikuti kebiasaan pembukuan Indonesia:
//   1 Aset · 2 Kewajiban · 3 Ekuitas · 4 Pendapatan · 5 Beban Pokok · 6 Beban

export class AccountError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AccountError";
    this.statusCode = statusCode;
  }
}

// Kunci akun yang DIPAKAI MESIN POSTING. Menambah kunci di sini WAJIB
// dibarengi akun bawaannya di DEFAULT_COA — kalau tidak, posting yang
// memakainya akan gagal di production dengan pesan "akun sistem belum
// disiapkan" (gagal keras yang disengaja: lebih baik berhenti daripada
// menjurnal ke akun tebakan).
export const SYSTEM_KEYS = Object.freeze({
  KAS: "KAS",
  BANK: "BANK",
  PIUTANG_USAHA: "PIUTANG_USAHA",
  PIUTANG_KARYAWAN: "PIUTANG_KARYAWAN",
  PERSEDIAAN_BAHAN: "PERSEDIAAN_BAHAN",
  UTANG_USAHA: "UTANG_USAHA",
  // GR/IR — barang SUDAH diterima gudang tapi tagihan supplier BELUM
  // datang. Tanpa akun ini, penerimaan barang tidak punya lawan jurnal yang
  // jujur: mendebet Persediaan langsung ke Utang Usaha akan menggandakan
  // utang begitu tagihan sungguhannya masuk, dan menundanya sampai tagihan
  // datang membuat nilai persediaan di neraca lebih kecil dari barang yang
  // benar-benar ada di rak.
  UTANG_BELUM_DITAGIH: "UTANG_BELUM_DITAGIH",
  UANG_MUKA_PELANGGAN: "UANG_MUKA_PELANGGAN",
  UTANG_REIMBURSEMENT: "UTANG_REIMBURSEMENT",
  LABA_DITAHAN: "LABA_DITAHAN",
  // Lawan jurnal kalibrasi saldo kas/bank ke saldo riil (services/finance/kalibrasiSaldo.js). Ekuitas, BUKAN pendapatan/biaya.
  KOREKSI_SALDO_AWAL: "KOREKSI_SALDO_AWAL",
  PENDAPATAN_LAYANAN: "PENDAPATAN_LAYANAN",
  PENDAPATAN_PRODUK: "PENDAPATAN_PRODUK",
  PENDAPATAN_SEWA: "PENDAPATAN_SEWA",
  PENDAPATAN_ONGKIR: "PENDAPATAN_ONGKIR",
  RETUR_PENJUALAN: "RETUR_PENJUALAN",
  PENDAPATAN_LAIN: "PENDAPATAN_LAIN",
  BEBAN_POKOK_BAHAN: "BEBAN_POKOK_BAHAN",
  BEBAN_SUSUT_BAHAN: "BEBAN_SUSUT_BAHAN",
  SELISIH_HARGA_PEMBELIAN: "SELISIH_HARGA_PEMBELIAN",
  SELISIH_STOK: "SELISIH_STOK",
  BEBAN_ADMIN_BANK: "BEBAN_ADMIN_BANK",
  ASET_TAK_BERWUJUD: "ASET_TAK_BERWUJUD",
  UTANG_PIHAK_KETIGA: "UTANG_PIHAK_KETIGA",
  BEBAN_PEMELIHARAAN_MESIN: "BEBAN_PEMELIHARAAN_MESIN",
  BEBAN_LANGGANAN_APLIKASI: "BEBAN_LANGGANAN_APLIKASI",
  BEBAN_OPERASIONAL_TRIP: "BEBAN_OPERASIONAL_TRIP",
  BEBAN_POKOK_BAHAN_MANUAL: "BEBAN_POKOK_BAHAN_MANUAL",
  UANG_MUKA_PEMBELIAN: "UANG_MUKA_PEMBELIAN",
  // Lawan jurnal penyesuaian SEMENTARA rekonsiliasi bank (services/finance/
  // posting/rekonsiliasiSementara.js) — dipakai saat saldo riil bank sudah
  // terkonfirmasi lebih tinggi dari buku tapi SUMBER dana belum bisa
  // diidentifikasi dari dokumen internal (butuh rekening koran). Kewajiban
  // lancar (suspense), BUKAN pendapatan/ekuitas — uang ini belum tentu milik
  // perusahaan sampai sumbernya terbukti.
  DANA_MASUK_BELUM_TERIDENTIFIKASI: "DANA_MASUK_BELUM_TERIDENTIFIKASI",
});

const A = "ASET";
const K = "KEWAJIBAN";
const E = "EKUITAS";
const P = "PENDAPATAN";
const BP = "BEBAN_POKOK";
const B = "BEBAN";
const D = "DEBIT";
const C = "KREDIT";

// { code, name, type, normalBalance, isPostable, systemKey?, cashFlowCategory?, description? }
export const DEFAULT_COA = Object.freeze([
  // ── 1 ASET ────────────────────────────────────────────────────────────
  { code: "1-0000", name: "ASET", type: A, normalBalance: D, isPostable: false },
  { code: "1-1000", name: "Aset Lancar", type: A, normalBalance: D, isPostable: false, parent: "1-0000" },
  { code: "1-1100", name: "Kas", type: A, normalBalance: D, parent: "1-1000", systemKey: SYSTEM_KEYS.KAS,
    description: "Uang tunai di tangan — kas kecil kantor & uang tunai yang dipegang driver sebelum disetor." },
  { code: "1-1200", name: "Bank", type: A, normalBalance: D, parent: "1-1000", systemKey: SYSTEM_KEYS.BANK,
    description: "Saldo seluruh rekening bank & e-wallet perusahaan." },
  { code: "1-1300", name: "Piutang Usaha", type: A, normalBalance: D, parent: "1-1000", systemKey: SYSTEM_KEYS.PIUTANG_USAHA,
    cashFlowCategory: "OPERASI",
    description: "Tagihan ke customer atas order yang SUDAH diserahkan tapi belum lunas." },
  { code: "1-1350", name: "Piutang Karyawan (Kasbon)", type: A, normalBalance: D, parent: "1-1000",
    systemKey: SYSTEM_KEYS.PIUTANG_KARYAWAN, cashFlowCategory: "OPERASI" },
  { code: "1-1400", name: "Persediaan Bahan Baku", type: A, normalBalance: D, parent: "1-1000",
    systemKey: SYSTEM_KEYS.PERSEDIAAN_BAHAN, cashFlowCategory: "OPERASI",
    description: "Nilai bahan di gudang. Kuantitasnya TETAP milik ledger stok (stock_movements) — akun ini cuma nilai rupiahnya." },
  { code: "1-1500", name: "Uang Muka Pembelian", type: A, normalBalance: D, parent: "1-1000",
    systemKey: SYSTEM_KEYS.UANG_MUKA_PEMBELIAN, cashFlowCategory: "OPERASI",
    description: "DP/uang muka yang sudah dibayar ke supplier untuk barang/jasa yang BELUM diterima — aset, bukan beban, sampai barang/jasanya benar-benar diterima. Penyelesaiannya (Dr akun tujuan sebenarnya / Cr akun ini) dilakukan manual lewat Jurnal Umum, lihat model FinPurchase." },
  { code: "1-2000", name: "Aset Tetap", type: A, normalBalance: D, isPostable: false, parent: "1-0000" },
  { code: "1-2100", name: "Kendaraan", type: A, normalBalance: D, parent: "1-2000", cashFlowCategory: "INVESTASI" },
  { code: "1-2200", name: "Peralatan & Mesin", type: A, normalBalance: D, parent: "1-2000", cashFlowCategory: "INVESTASI" },
  { code: "1-2300", name: "Aset Tak Berwujud", type: A, normalBalance: D, parent: "1-2000",
    systemKey: SYSTEM_KEYS.ASET_TAK_BERWUJUD, cashFlowCategory: "INVESTASI",
    description: "Paten, HAKI, domain, dan hak tak berwujud lain yang nilainya material — dicatat sebagai aset, bukan langsung dibebankan, supaya sejalan dengan umur manfaatnya." },
  // Akun KONTRA: bertipe ASET tapi saldo normalnya KREDIT (lihat komentar
  // enum FinNormalBalance di schema.prisma).
  { code: "1-2900", name: "Akumulasi Penyusutan", type: A, normalBalance: C, parent: "1-2000" },

  // ── 2 KEWAJIBAN ───────────────────────────────────────────────────────
  { code: "2-0000", name: "KEWAJIBAN", type: K, normalBalance: C, isPostable: false },
  { code: "2-1000", name: "Kewajiban Lancar", type: K, normalBalance: C, isPostable: false, parent: "2-0000" },
  { code: "2-1100", name: "Utang Usaha", type: K, normalBalance: C, parent: "2-1000", systemKey: SYSTEM_KEYS.UTANG_USAHA,
    cashFlowCategory: "OPERASI", description: "Tagihan supplier yang sudah disetujui tapi belum dibayar." },
  { code: "2-1150", name: "Utang Barang Belum Ditagih", type: K, normalBalance: C, parent: "2-1000",
    systemKey: SYSTEM_KEYS.UTANG_BELUM_DITAGIH, cashFlowCategory: "OPERASI",
    description: "Barang sudah masuk gudang (putaway tercatat di ledger stok) tapi tagihan supplier belum diterima. Saldonya hilang sendiri begitu tagihannya masuk & disetujui." },
  { code: "2-1200", name: "Uang Muka Pelanggan (DP)", type: K, normalBalance: C, parent: "2-1000",
    systemKey: SYSTEM_KEYS.UANG_MUKA_PELANGGAN, cashFlowCategory: "OPERASI",
    description: "DP & cicilan yang sudah diterima untuk order yang BELUM diserahkan. Ini UTANG, bukan pendapatan — lihat services/finance/posting/orderRevenue.js." },
  { code: "2-1300", name: "Utang Reimbursement Karyawan", type: K, normalBalance: C, parent: "2-1000",
    systemKey: SYSTEM_KEYS.UTANG_REIMBURSEMENT, cashFlowCategory: "OPERASI" },
  { code: "2-1400", name: "Utang Pajak", type: K, normalBalance: C, parent: "2-1000", cashFlowCategory: "OPERASI",
    description: "Tersedia untuk jurnal MANUAL. Sistem ini belum punya mesin hitung pajak otomatis — jangan berasumsi terisi sendiri." },
  { code: "2-1500", name: "Utang Gaji", type: K, normalBalance: C, parent: "2-1000", cashFlowCategory: "OPERASI" },
  { code: "2-1600", name: "Utang Pihak Ketiga (Investor/Mitra)", type: K, normalBalance: C, parent: "2-1000",
    systemKey: SYSTEM_KEYS.UTANG_PIHAK_KETIGA, cashFlowCategory: "PENDANAAN",
    description: "Pinjaman/suntikan dari investor & mitra non-bank yang diharapkan dikembalikan (mis. Pasamebel, MUF, investor perorangan) — pencairannya PENDANAAN masuk, pelunasannya PENDANAAN keluar, bukan beban. Fee/bagi hasil yang dibayarkan ke pemberi pinjaman dicatat terpisah sebagai beban di 6-1900 atau akun beban yang sesuai." },
  { code: "2-1700", name: "Dana Masuk Belum Teridentifikasi", type: K, normalBalance: C, parent: "2-1000",
    systemKey: SYSTEM_KEYS.DANA_MASUK_BELUM_TERIDENTIFIKASI,
    description: "Suspense rekonsiliasi bank: saldo bank riil terkonfirmasi lebih tinggi dari buku, tapi sumber dananya BELUM bisa diidentifikasi dari dokumen internal (butuh rekening koran). SELALU sementara — begitu sumbernya terbukti, saldo di akun ini direklasifikasi (jurnal baru) ke akun yang benar, TIDAK PERNAH diedit/dihapus di sini. Bukan pendapatan, bukan ekuitas, bukan akun 3-4100 (itu khusus kalibrasi saldo awal yang SUMBERNYA sudah jelas)." },
  { code: "2-2000", name: "Kewajiban Jangka Panjang", type: K, normalBalance: C, isPostable: false, parent: "2-0000" },
  { code: "2-2100", name: "Utang Bank", type: K, normalBalance: C, parent: "2-2000", cashFlowCategory: "PENDANAAN" },

  // ── 3 EKUITAS ─────────────────────────────────────────────────────────
  { code: "3-0000", name: "EKUITAS", type: E, normalBalance: C, isPostable: false },
  { code: "3-1100", name: "Modal Pemilik", type: E, normalBalance: C, parent: "3-0000", cashFlowCategory: "PENDANAAN" },
  { code: "3-2100", name: "Prive (Pengambilan Pemilik)", type: E, normalBalance: D, parent: "3-0000", cashFlowCategory: "PENDANAAN" },
  { code: "3-3100", name: "Laba Ditahan", type: E, normalBalance: C, parent: "3-0000", systemKey: SYSTEM_KEYS.LABA_DITAHAN,
    description: "Akumulasi laba tahun-tahun sebelumnya. Laba tahun BERJALAN TIDAK disimpan di sini — dihitung langsung dari akun pendapatan & beban (lihat services/finance/reports.js), supaya neraca tidak pernah bergantung pada proses tutup buku yang lupa dijalankan." },

  { code: "3-4100", name: "Koreksi Saldo Awal", type: E, normalBalance: C, parent: "3-0000", systemKey: SYSTEM_KEYS.KOREKSI_SALDO_AWAL,
    description: "Lawan jurnal kalibrasi saldo kas/bank ke saldo riil (mis. 19 Sep 2026 20.00 WIB). Akun sistem: bukan pendapatan dan bukan biaya. Jangan dipakai untuk transaksi biasa." },

  // ── 4 PENDAPATAN ──────────────────────────────────────────────────────
  { code: "4-0000", name: "PENDAPATAN", type: P, normalBalance: C, isPostable: false },
  { code: "4-1100", name: "Pendapatan Jasa Layanan", type: P, normalBalance: C, parent: "4-0000",
    systemKey: SYSTEM_KEYS.PENDAPATAN_LAYANAN, cashFlowCategory: "OPERASI",
    description: "Order kategori LAYANAN (service/upgrade/ganti kain)." },
  { code: "4-1200", name: "Pendapatan Penjualan Produk", type: P, normalBalance: C, parent: "4-0000",
    systemKey: SYSTEM_KEYS.PENDAPATAN_PRODUK, cashFlowCategory: "OPERASI",
    description: "Order kategori BARU (kasur/sofa/divan baru)." },
  { code: "4-1300", name: "Pendapatan Sewa", type: P, normalBalance: C, parent: "4-0000",
    systemKey: SYSTEM_KEYS.PENDAPATAN_SEWA, cashFlowCategory: "OPERASI",
    description: "Order kategori SEWA." },
  { code: "4-1900", name: "Pendapatan Ongkos Kirim", type: P, normalBalance: C, parent: "4-0000",
    systemKey: SYSTEM_KEYS.PENDAPATAN_ONGKIR, cashFlowCategory: "OPERASI",
    description: "Order.ongkir yang ditagihkan ke customer. TIDAK termasuk Order.ongkirKlaimGaransi — itu biaya kami, bukan tagihan (lihat services/invoice.js)." },
  // Akun KONTRA pendapatan.
  { code: "4-2100", name: "Retur & Potongan Penjualan", type: P, normalBalance: D, parent: "4-0000",
    systemKey: SYSTEM_KEYS.RETUR_PENJUALAN, cashFlowCategory: "OPERASI" },
  { code: "4-9100", name: "Pendapatan Lain-lain", type: P, normalBalance: C, parent: "4-0000",
    systemKey: SYSTEM_KEYS.PENDAPATAN_LAIN, cashFlowCategory: "OPERASI" },

  // ── 5 BEBAN POKOK ─────────────────────────────────────────────────────
  { code: "5-0000", name: "BEBAN POKOK", type: BP, normalBalance: D, isPostable: false },
  { code: "5-1100", name: "Beban Pokok Bahan Baku", type: BP, normalBalance: D, parent: "5-0000",
    systemKey: SYSTEM_KEYS.BEBAN_POKOK_BAHAN, cashFlowCategory: "OPERASI",
    description: "Nilai bahan yang benar-benar dikeluarkan gudang ke produksi (stock_movements ISSUE). Tidak pernah ditulis manual." },
  { code: "5-1150", name: "Pembelian Bahan Baku (Input Manual)", type: BP, normalBalance: D, parent: "5-0000",
    systemKey: SYSTEM_KEYS.BEBAN_POKOK_BAHAN_MANUAL, cashFlowCategory: "OPERASI",
    description: "Pembelian bahan baku yang dicatat manual SEBELUM modul Gudang dipakai — sengaja dipisah dari 5-1100 supaya akun itu tetap murni otomatis dari stock_movements begitu Gudang mulai jalan, tanpa perlu memilah mana baris manual mana baris otomatis di kemudian hari." },
  { code: "5-1200", name: "Beban Upah Produksi", type: BP, normalBalance: D, parent: "5-0000", cashFlowCategory: "OPERASI" },
  { code: "5-1300", name: "Beban Overhead Produksi", type: BP, normalBalance: D, parent: "5-0000", cashFlowCategory: "OPERASI" },
  { code: "5-1900", name: "Beban Susut & Bahan Rusak", type: BP, normalBalance: D, parent: "5-0000",
    systemKey: SYSTEM_KEYS.BEBAN_SUSUT_BAHAN, cashFlowCategory: "OPERASI",
    description: "Dari stock_movements WASTE & barang rusak yang dihapusbukukan." },
  { code: "5-1960", name: "Selisih Stok Opname", type: BP, normalBalance: D, parent: "5-0000",
    systemKey: SYSTEM_KEYS.SELISIH_STOK, cashFlowCategory: "OPERASI",
    description: "Selisih hasil stock opname terhadap saldo ledger. Bisa DEBIT (stok fisik kurang) maupun KREDIT (stok fisik lebih) — dua-duanya masuk akun yang sama supaya besaran selisih per periode terbaca sebagai satu angka, bukan tersebar." },
  { code: "5-1950", name: "Selisih Harga Pembelian", type: BP, normalBalance: D, parent: "5-0000",
    systemKey: SYSTEM_KEYS.SELISIH_HARGA_PEMBELIAN, cashFlowCategory: "OPERASI",
    description: "Selisih antara nilai tagihan supplier dan nilai penerimaan barang yang sudah tercatat di ledger stok. Ada supaya nilai persediaan yang SUDAH tercatat tidak pernah diubah diam-diam oleh tagihan yang datang belakangan." },

  // ── 6 BEBAN OPERASIONAL ───────────────────────────────────────────────
  { code: "6-0000", name: "BEBAN OPERASIONAL", type: B, normalBalance: D, isPostable: false },
  { code: "6-1100", name: "Beban Gaji & Tunjangan", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI" },
  { code: "6-1150", name: "Beban Pemeliharaan Mesin & Peralatan", type: B, normalBalance: D, parent: "6-0000",
    systemKey: SYSTEM_KEYS.BEBAN_PEMELIHARAAN_MESIN, cashFlowCategory: "OPERASI",
    description: "Servis & perawatan mesin produksi (kompresor, mesin corner, mesin jahit) — beda dari 6-1320 yang khusus kendaraan." },
  { code: "6-1160", name: "Beban Langganan Aplikasi", type: B, normalBalance: D, parent: "6-0000",
    systemKey: SYSTEM_KEYS.BEBAN_LANGGANAN_APLIKASI, cashFlowCategory: "OPERASI",
    description: "Langganan software/SaaS bulanan atau tahunan (mis. Claude, Adobe, Capcut, VPS)." },
  { code: "6-1170", name: "Beban Operasional & Perjalanan Dinas", type: B, normalBalance: D, parent: "6-0000",
    systemKey: SYSTEM_KEYS.BEBAN_OPERASIONAL_TRIP, cashFlowCategory: "OPERASI",
    description: "Meeting, perjalanan dinas, dan operasional kecil lain yang bukan bensin/tol kendaraan operasional harian." },
  { code: "6-1200", name: "Beban Iklan & Pemasaran", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI",
    description: "Termasuk belanja iklan bulanan per platform (tabel ad_spends) yang diposting otomatis." },
  { code: "6-1300", name: "Beban BBM", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI" },
  { code: "6-1310", name: "Beban Tol & Parkir", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI" },
  { code: "6-1320", name: "Beban Servis & Perawatan Kendaraan", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI" },
  { code: "6-1330", name: "Beban Denda & Tilang", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI" },
  { code: "6-1340", name: "Beban Kurir Eksternal", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI" },
  { code: "6-1400", name: "Beban Sewa Tempat", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI" },
  { code: "6-1500", name: "Beban Listrik, Air & Internet", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI" },
  { code: "6-1600", name: "Beban Perlengkapan Kantor", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI" },
  { code: "6-1700", name: "Beban Administrasi Bank", type: B, normalBalance: D, parent: "6-0000",
    systemKey: SYSTEM_KEYS.BEBAN_ADMIN_BANK, cashFlowCategory: "OPERASI" },
  { code: "6-1800", name: "Beban Penyusutan", type: B, normalBalance: D, parent: "6-0000" },
  { code: "6-1900", name: "Beban Lain-lain", type: B, normalBalance: D, parent: "6-0000", cashFlowCategory: "OPERASI" },
]);

// Kategori pengeluaran bawaan — jembatan bahasa operasional → akun COA.
// `autoMapKey` yang diawali "VEHICLE:" dipakai mesin posting biaya kendaraan
// (VehicleExpense.category / VehicleService), "ADSPEND" untuk belanja iklan.
// Sisanya murni untuk input manual di workspace Finance.
export const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  { code: "BBM", name: "BBM / Bensin", accountCode: "6-1300", division: "DELIVERY", autoMapKey: "VEHICLE:BBM" },
  { code: "TOL", name: "Tol", accountCode: "6-1310", division: "DELIVERY", autoMapKey: "VEHICLE:TOL" },
  { code: "PARKIR", name: "Parkir", accountCode: "6-1310", division: "DELIVERY", autoMapKey: "VEHICLE:PARKIR" },
  { code: "CUCI_KENDARAAN", name: "Cuci Kendaraan", accountCode: "6-1320", division: "DELIVERY", autoMapKey: "VEHICLE:CUCI" },
  { code: "DENDA_TILANG", name: "Denda / Tilang", accountCode: "6-1330", division: "DELIVERY", autoMapKey: "VEHICLE:DENDA" },
  { code: "BIAYA_KENDARAAN_LAIN", name: "Biaya Kendaraan Lainnya", accountCode: "6-1900", division: "DELIVERY", autoMapKey: "VEHICLE:LAINNYA" },
  { code: "SERVIS_KENDARAAN", name: "Servis & Perawatan Kendaraan", accountCode: "6-1320", division: "DELIVERY", autoMapKey: "VEHICLE_SERVICE" },
  { code: "IKLAN", name: "Belanja Iklan", accountCode: "6-1200", division: "DIGITAL_TECHNOLOGY", autoMapKey: "ADSPEND" },
  { code: "KURIR_EKSTERNAL", name: "Kurir Eksternal", accountCode: "6-1340", division: "DELIVERY" },
  { code: "GAJI_KARYAWAN", name: "Gaji & Tunjangan", accountCode: "6-1100", division: "UMUM" },
  { code: "UPAH_PRODUKSI", name: "Upah Produksi / Tukang", accountCode: "5-1200", division: "PRODUKSI" },
  { code: "OVERHEAD_PRODUKSI", name: "Overhead Produksi", accountCode: "5-1300", division: "PRODUKSI" },
  { code: "SEWA_TEMPAT", name: "Sewa Tempat", accountCode: "6-1400", division: "UMUM" },
  { code: "UTILITAS", name: "Listrik, Air & Internet", accountCode: "6-1500", division: "UMUM" },
  { code: "PERLENGKAPAN", name: "Perlengkapan Kantor", accountCode: "6-1600", division: "UMUM" },
  { code: "ADMIN_BANK", name: "Biaya Administrasi Bank", accountCode: "6-1700", division: "UMUM" },
  { code: "LAIN_LAIN", name: "Lain-lain", accountCode: "6-1900", division: "UMUM" },
  { code: "MAINT_MESIN", name: "Pemeliharaan Mesin & Peralatan", accountCode: "6-1150", division: "PRODUKSI" },
  { code: "LANGGANAN_APLIKASI", name: "Langganan Aplikasi", accountCode: "6-1160", division: "UMUM" },
  { code: "OPS_MEETING", name: "Operasional Meeting & Perjalanan Dinas", accountCode: "6-1170", division: "UMUM" },
  { code: "BAHAN_BAKU_MANUAL", name: "Pembelian Bahan Baku (Manual)", accountCode: "5-1150", division: "PRODUKSI" },
]);

// Kode kategori pengeluaran yang DIPENSIUNKAN — masih dipakai histori
// FinExpense lama (jangan pernah disentuh), tapi TIDAK BOLEH lagi dipilih
// untuk pengeluaran baru sejak tab Pembelian ada. ensureDefaultChartOfAccounts
// menonaktifkannya (active:false) tiap dijalankan, idempoten, TANPA
// mengubah accountId/histori transaksi yang sudah memakainya.
const DEPRECATED_EXPENSE_CATEGORY_CODES = Object.freeze(["BAHAN_BAKU_MANUAL"]);

// Kategori PEMBELIAN bawaan — jembatan yang sama seperti kategori
// pengeluaran, tapi akun tujuannya bisa ASET (bahan baku manual masih ke
// akun BEBAN POKOK yang sama seperti sebelumnya, supaya laporan tidak
// pecah dua; aset tetap & aset tak berwujud & uang muka ke akun ASET).
export const DEFAULT_PURCHASE_CATEGORIES = Object.freeze([
  { code: "BAHAN_BAKU_MANUAL", name: "Bahan Baku (Manual)", accountCode: "5-1150" },
  { code: "ASET_KENDARAAN", name: "Aset Tetap — Kendaraan", accountCode: "1-2100" },
  { code: "ASET_PERALATAN", name: "Aset Tetap — Peralatan & Mesin", accountCode: "1-2200" },
  { code: "ASET_TAK_BERWUJUD", name: "Aset Tak Berwujud", accountCode: "1-2300" },
  { code: "UANG_MUKA_PEMBELIAN", name: "Uang Muka Pembelian (DP)", accountCode: "1-1500" },
]);

/**
 * Pasang bagan akun bawaan — IDEMPOTEN, aman dijalankan berkali-kali.
 * Akun yang SUDAH ADA tidak pernah ditimpa (admin boleh mengganti nama/
 * deskripsi sesuai kebiasaan mereka tanpa takut ditimpa balik deploy
 * berikutnya); yang belum ada dibuat. Tidak ada akun yang pernah dihapus
 * dari sini.
 */
export async function ensureDefaultChartOfAccounts(tx) {
  const existing = await tx.finAccount.findMany({ select: { id: true, code: true } });
  const byCode = new Map(existing.map((a) => [a.code, a.id]));

  // Dua lintasan: induk dulu (parent selalu punya kode lebih "atas" di
  // DEFAULT_COA, tapi jangan bergantung pada urutan array — resolve
  // parentId dari peta yang sudah terisi, lalu isi susulan).
  for (const def of DEFAULT_COA) {
    if (byCode.has(def.code)) continue;
    const created = await tx.finAccount.create({
      data: {
        code: def.code,
        name: def.name,
        type: def.type,
        normalBalance: def.normalBalance,
        isPostable: def.isPostable !== false,
        systemKey: def.systemKey || null,
        cashFlowCategory: def.cashFlowCategory || null,
        description: def.description || null,
      },
      select: { id: true, code: true },
    });
    byCode.set(created.code, created.id);
  }

  for (const def of DEFAULT_COA) {
    if (!def.parent) continue;
    const id = byCode.get(def.code);
    const parentId = byCode.get(def.parent);
    if (!id || !parentId) continue;
    const row = await tx.finAccount.findUnique({ where: { id }, select: { parentId: true } });
    if (row?.parentId == null) {
      await tx.finAccount.update({ where: { id }, data: { parentId } });
    }
  }

  // Backfill systemKey untuk akun LAMA yang baru sekarang dapat systemKey
  // di DEFAULT_COA (mis. "1-1500 Uang Muka Pembelian" dipasang jauh sebelum
  // ada mesin posting yang memakainya). Beda dari name/description yang
  // sengaja tidak pernah ditimpa (customization admin) — systemKey murni
  // dikelola kode, jadi aman & perlu di-backfill supaya resolveAccount()
  // tidak gagal keras di instalasi yang akunnya sudah lama ada.
  for (const def of DEFAULT_COA) {
    if (!def.systemKey) continue;
    const id = byCode.get(def.code);
    if (!id) continue;
    const row = await tx.finAccount.findUnique({ where: { id }, select: { systemKey: true } });
    if (row?.systemKey == null) {
      await tx.finAccount.update({ where: { id }, data: { systemKey: def.systemKey } });
    }
  }

  // Kategori pengeluaran bawaan — sama idempotennya.
  const existingCats = await tx.finExpenseCategory.findMany({ select: { code: true } });
  const catCodes = new Set(existingCats.map((c) => c.code));
  for (const def of DEFAULT_EXPENSE_CATEGORIES) {
    if (catCodes.has(def.code)) continue;
    const accountId = byCode.get(def.accountCode);
    if (!accountId) continue; // akun tujuan tidak ada — lewati, jangan bikin kategori yatim
    await tx.finExpenseCategory.create({
      data: {
        code: def.code,
        name: def.name,
        accountId,
        division: def.division,
        autoMapKey: def.autoMapKey || null,
      },
    });
  }

  // Pensiunkan kategori pengeluaran yang sudah pindah ke tab Pembelian —
  // tidak menyentuh accountId/histori, cuma menyembunyikannya dari form
  // pengajuan baru. Idempoten: sudah nonaktif ya dilewati saja.
  await tx.finExpenseCategory.updateMany({
    where: { code: { in: DEPRECATED_EXPENSE_CATEGORY_CODES }, active: true },
    data: { active: false },
  });

  // Kategori pembelian bawaan — pola identik kategori pengeluaran di atas.
  const existingPurchaseCats = await tx.finPurchaseCategory.findMany({ select: { code: true } });
  const purchaseCatCodes = new Set(existingPurchaseCats.map((c) => c.code));
  for (const def of DEFAULT_PURCHASE_CATEGORIES) {
    if (purchaseCatCodes.has(def.code)) continue;
    const accountId = byCode.get(def.accountCode);
    if (!accountId) continue; // akun tujuan tidak ada — lewati, jangan bikin kategori yatim
    await tx.finPurchaseCategory.create({
      data: { code: def.code, name: def.name, accountId },
    });
  }

  return { accounts: byCode.size };
}

/**
 * Ambil akun berdasarkan systemKey. GAGAL KERAS kalau tidak ada — mesin
 * posting TIDAK BOLEH memilih akun cadangan sendiri. Kalau akun sistem
 * hilang, yang benar adalah berhenti dan memberi tahu admin, bukan diam-diam
 * menjurnal ke "Beban Lain-lain".
 */
export async function resolveAccount(tx, systemKey) {
  const account = await tx.finAccount.findUnique({
    where: { systemKey },
    select: { id: true, code: true, name: true, isPostable: true, active: true },
  });
  if (!account) {
    throw new AccountError(
      `Akun sistem "${systemKey}" belum disiapkan di Bagan Akun. Buka Finance > Bagan Akun lalu jalankan "Pasang Akun Bawaan".`,
      409
    );
  }
  if (!account.isPostable || !account.active) {
    throw new AccountError(
      `Akun sistem "${systemKey}" (${account.code} ${account.name}) sedang nonaktif atau bukan akun detail — perbaiki di Bagan Akun sebelum melanjutkan.`,
      409
    );
  }
  return account;
}

/** Ambil beberapa akun sistem sekaligus → { KAS: {...}, BANK: {...} }. */
export async function resolveAccounts(tx, systemKeys) {
  const out = {};
  for (const key of systemKeys) out[key] = await resolveAccount(tx, key);
  return out;
}

/**
 * Akun pendapatan yang benar untuk sebuah order — SATU tempat, dipakai
 * pengakuan pendapatan maupun refund/retur supaya keduanya tidak bisa
 * memilih akun yang berbeda untuk order yang sama.
 */
export function revenueSystemKeyForOrder(order) {
  switch (order?.category) {
    case "BARU":
      return SYSTEM_KEYS.PENDAPATAN_PRODUK;
    case "SEWA":
      return SYSTEM_KEYS.PENDAPATAN_SEWA;
    case "LAYANAN":
    default:
      // LAYANAN adalah default OrderCategory di schema — order lama tanpa
      // kategori eksplisit memang layanan (lihat komentar OrderCategory).
      return SYSTEM_KEYS.PENDAPATAN_LAYANAN;
  }
}
