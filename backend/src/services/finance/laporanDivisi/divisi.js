// LAPORAN DIVISI (Fase 2, 1 Okt 2026) — DAFTAR DIVISI RESMI, PEMETAAN, DAN KONFIGURASI ATRIBUSI. Satu-satunya tempat aturan ini didefinisikan.
//
// Scope resmi: SALES, DELIVERY, PRODUCTION, WAREHOUSE, MARKETING, DIGITAL_TECHNOLOGY, HR_GA, MANAGEMENT, SHARED — ditambah satu KELOMPOK TURUNAN
// TIDAK_TERKLASIFIKASI (bukan divisi: tempat transaksi yang divisinya TIDAK terbukti). D&T adalah divisi tersendiri; tidak pernah dipetakan ke Marketing.
//
// ATURAN ATRIBUSI (urutan prioritas, berhenti di yang pertama terbukti; lihat atribusi.js):
//   a. EKSPLISIT  — divisi yang tertulis pada dokumen itu sendiri (FinExpense.division, FinPurchase.division, FinOperationalAdvance.division) dan BUKAN "UMUM".
//   b. RELASI     — dokumen sumbernya membuktikan divisi: pengajuan biaya (ExpenseSubmission.division), jenis sumber tetap (kendaraan/insentif → Delivery, refund → Sales),
//                   material issue produksi, pergerakan stok susut/opname (→ Gudang), tagihan bahan baku (→ Produksi).
//   c. KATEGORI   — pemetaan kategori yang DIKONFIGURASI (FinExpenseCategory.division, atau tabel KATEGORI_PEMBELIAN_DIVISI di bawah). Kategori "UMUM" = biaya bersama → SHARED.
//   d. TIDAK_TERKLASIFIKASI bila tidak ada bukti. Pembuat/pengaju transaksi TIDAK PERNAH dipakai untuk menebak divisi.
// Biaya bersama tetap SHARED sampai ada alokasi resmi (tidak ada pembagian otomatis).

export const DIVISI = Object.freeze(["SALES", "DELIVERY", "PRODUCTION", "WAREHOUSE", "MARKETING", "DIGITAL_TECHNOLOGY", "HR_GA", "MANAGEMENT", "SHARED"]);
export const TIDAK_TERKLASIFIKASI = "TIDAK_TERKLASIFIKASI";
/** Bukan divisi & bukan kebocoran klasifikasi: arus kas dari sumber non-biaya (pembalikan pembayaran, saldo awal, rekonsiliasi). Hanya muncul di jembatan. */
export const DI_LUAR_DIVISI = "DI_LUAR_DIVISI";
export const SEMUA_KELOMPOK = Object.freeze([...DIVISI, TIDAK_TERKLASIFIKASI]);

export const LABEL_DIVISI = Object.freeze({
  SALES: "Sales", DELIVERY: "Delivery", PRODUCTION: "Produksi", WAREHOUSE: "Gudang", MARKETING: "Marketing", DIGITAL_TECHNOLOGY: "Digital & Technology",
  HR_GA: "HR & GA", MANAGEMENT: "Management", SHARED: "Biaya Bersama", TIDAK_TERKLASIFIKASI: "Tidak Terklasifikasi",
});

/** FinDivision (enum lama pada dokumen) → scope resmi. UMUM & OFFICE = biaya bersama/lintas divisi → SHARED. */
export const DARI_FIN_DIVISION = Object.freeze({
  SALES: "SALES", PRODUKSI: "PRODUCTION", GUDANG: "WAREHOUSE", DELIVERY: "DELIVERY", DIGITAL_TECHNOLOGY: "DIGITAL_TECHNOLOGY",
  MARKETING: "MARKETING", HR_GA: "HR_GA", MANAGEMENT: "MANAGEMENT", UMUM: "SHARED", OFFICE: "SHARED",
});

/** Scope → keanggotaan divisi (UserDivision) yang memberi hak lihat. SALES lewat peran SALES (bukan keanggotaan). */
export const KEANGGOTAAN_UNTUK_SCOPE = Object.freeze({
  DELIVERY: "DELIVERY", PRODUCTION: "PRODUCTION", WAREHOUSE: "WAREHOUSE", MARKETING: "MARKETING", DIGITAL_TECHNOLOGY: "DIGITAL_TECHNOLOGY", HR_GA: "HR_GA", MANAGEMENT: "MANAGEMENT",
});

/** Jenis sumber yang SELALU milik satu divisi (relasi sumber, bukan tebakan): armada, insentif driver, refund pelanggan, biaya bank transfer. */
export const SUMBER_TETAP = Object.freeze({
  BIAYA_KENDARAAN: { scope: "DELIVERY", aturan: "Biaya kendaraan (Armada) selalu milik Delivery" },
  INSENTIF_DRIVER: { scope: "DELIVERY", aturan: "Insentif driver selalu milik Delivery" },
  REFUND: { scope: "SALES", aturan: "Refund pelanggan atas order milik Sales" },
  TRANSFER_KAS: { scope: "SHARED", aturan: "Biaya admin transfer antar rekening = biaya bank bersama" },
  KASBON: { scope: "HR_GA", aturan: "Kasbon gaji karyawan dikelola HR & GA", sensitif: true },
});

/** Kategori pembelian (FinPurchaseCategory belum punya kolom divisi) → scope. Yang tidak terdaftar = tidak terbukti → TIDAK_TERKLASIFIKASI. */
export const KATEGORI_PEMBELIAN_DIVISI = Object.freeze({
  BAHAN_BAKU_MANUAL: "PRODUCTION",
  ASET_KENDARAAN: "DELIVERY",
});

/** Jenis tagihan supplier yang membuktikan divisi tanpa kategori biaya. */
export const JENIS_TAGIHAN_DIVISI = Object.freeze({ BAHAN_BAKU: "PRODUCTION" });

/** Jenis Material Issue yang membuktikan pemakaian produksi. */
export const SUMBER_ISSUE_PRODUKSI = Object.freeze(["PRODUCTION_WORK_ORDER", "COMPLAINT_REWORK"]);

/** Kategori/akun SENSITIF: tidak tampil bagi non-Finance (gaji, kasbon, investor, rekening). Disaring server — angka & baris dikeluarkan dari tampilan scoped. */
export const KATEGORI_SENSITIF = Object.freeze(["GAJI_KARYAWAN"]);
export const AKUN_SENSITIF = Object.freeze(["6-1100", "1-1350", "2-1500", "2-1600", "2-1800", "3-2100", "3-4200"]);

/** Sumber jurnal yang mewakili BIAYA/penggunaan uang oleh divisi (selain sumber di luar: pendapatan, saldo awal, rekonsiliasi). */
export const SUMBER_BIAYA = Object.freeze([
  "PENGELUARAN", "PEMBELIAN", "BIAYA_KENDARAAN", "BIAYA_IKLAN", "TAGIHAN_SUPPLIER", "PEMBAYARAN_SUPPLIER", "PEMAKAIAN_BAHAN", "PENERIMAAN_BAHAN",
  "KASBON", "UANG_MUKA_OPERASIONAL", "INSENTIF_DRIVER", "REFUND", "TRANSFER_KAS", "TERAPKAN_UANG_MUKA", "MANUAL", "REVERSAL",
]);

/**
 * KELOMPOK RINCIAN per divisi untuk layar workspace — pemetaan dari kode kategori / kode akun / sumber jurnal ke label yang dipakai tim divisi.
 * Baris yang tidak masuk kelompok mana pun (atau bernilai nol) dilipat ke "Komponen lain". Bentuk: { kunci, label, kategori?:[kode], akun?:[kode], sumber?:[sumber] }.
 */
export const KELOMPOK = Object.freeze({
  DELIVERY: [
    { kunci: "bensin", label: "Bensin / BBM", kategori: ["BBM"] },
    { kunci: "tol", label: "Tol", kategori: ["TOL"] },
    { kunci: "parkir", label: "Parkir", kategori: ["PARKIR"] },
    { kunci: "servis", label: "Servis & perawatan kendaraan", kategori: ["SERVIS_KENDARAAN", "BAN_KENDARAAN", "CUCI_KENDARAAN"] },
    { kunci: "denda", label: "Denda & tilang", kategori: ["DENDA_TILANG"] },
    { kunci: "kurir", label: "Kurir / logistik", kategori: ["KURIR_EKSTERNAL"] },
    { kunci: "sewa", label: "Sewa kendaraan", kategori: ["SEWA_KENDARAAN"] },
    { kunci: "insentif", label: "Insentif driver", sumber: ["INSENTIF_DRIVER"] },
    { kunci: "kendaraan", label: "Biaya kendaraan lainnya", kategori: ["BIAYA_KENDARAAN_LAIN"] },
  ],
  PRODUCTION: [
    { kunci: "bahan", label: "Bahan terpakai", sumber: ["PEMAKAIAN_BAHAN"], akun: ["5-1100", "5-1150"], kategori: ["BAHAN_BAKU_MANUAL"] },
    { kunci: "vendor", label: "Jasa vendor / tukang", kategori: ["UPAH_PRODUKSI"] },
    { kunci: "mesin", label: "Perawatan mesin", kategori: ["MAINT_MESIN"] },
    { kunci: "overhead", label: "Overhead produksi", kategori: ["OVERHEAD_PRODUKSI"] },
    // Tooling & lembur belum punya kategori sendiri di bagan kategori: tampil di "Komponen lain" sampai Finance menambah kategorinya — TIDAK ditebak.
    { kunci: "tooling", label: "Tooling", kategori: ["TOOLING_PRODUKSI"] },
    { kunci: "lembur", label: "Lembur", kategori: ["LEMBUR_PRODUKSI"] },
  ],
  WAREHOUSE: [
    { kunci: "bongkar", label: "Bongkar muat", kategori: ["BONGKAR_MUAT_GUDANG"] },
    { kunci: "fasilitas", label: "Perawatan fasilitas", kategori: ["PERAWATAN_FASILITAS_GUDANG"] },
    { kunci: "mendesak", label: "Operasional mendesak", kategori: ["BIAYA_GUDANG_MENDESAK"] },
    { kunci: "perlengkapan", label: "Perlengkapan gudang", kategori: ["PERLENGKAPAN_GUDANG"] },
    { kunci: "logistik", label: "Logistik", kategori: ["LOGISTIK_GUDANG"] },
    { kunci: "susut", label: "Kerusakan / kehilangan", akun: ["5-1900"] },
    { kunci: "selisih", label: "Selisih stok", akun: ["5-1960"] },
  ],
  MARKETING: [
    { kunci: "promosi", label: "Iklan & promosi", kategori: ["MKT_PROMOSI", "IKLAN"], sumber: ["BIAYA_IKLAN"] },
    { kunci: "konten", label: "Konten", kategori: ["MKT_KONTEN"] },
    { kunci: "event", label: "Event & aktivasi", kategori: ["MKT_EVENT"] },
    { kunci: "cetak", label: "Cetak", kategori: ["MKT_CETAK"] },
    { kunci: "tools", label: "Tools / langganan", kategori: ["LANGGANAN_APLIKASI"] },
    { kunci: "transportasi", label: "Transportasi", kategori: ["OPS_MEETING"] },
  ],
  DIGITAL_TECHNOLOGY: [
    { kunci: "iklan", label: "Iklan digital (platform)", kategori: ["IKLAN"], sumber: ["BIAYA_IKLAN"] },
    { kunci: "saas", label: "Langganan / SaaS", kategori: ["LANGGANAN_APLIKASI"] },
  ],
  SALES: [
    { kunci: "refund", label: "Refund pelanggan", sumber: ["REFUND"] },
  ],
  HR_GA: [
    { kunci: "rekrutmen", label: "Rekrutmen", kategori: ["HRGA_REKRUTMEN"] },
    { kunci: "pelatihan", label: "Pelatihan", kategori: ["HRGA_PELATIHAN"] },
    { kunci: "kesejahteraan", label: "Kesejahteraan", kategori: ["HRGA_KESEJAHTERAAN"] },
    { kunci: "fasilitas", label: "Fasilitas kantor", kategori: ["HRGA_PERAWATAN_FASILITAS"] },
    { kunci: "perizinan", label: "Perizinan & ATK non-stok", kategori: ["HRGA_PERIZINAN", "PERLENGKAPAN"] },
  ],
  MANAGEMENT: [
    { kunci: "konsultan", label: "Konsultan & jasa profesional", kategori: ["MGT_KONSULTAN"] },
    { kunci: "legal", label: "Legal & perizinan", kategori: ["MGT_LEGAL"] },
    { kunci: "meeting", label: "Meeting, perjalanan & representasi", kategori: ["OPS_MEETING"] },
  ],
  SHARED: [
    { kunci: "sewa", label: "Sewa tempat", kategori: ["SEWA_TEMPAT"] },
    { kunci: "utilitas", label: "Listrik, air & internet", kategori: ["UTILITAS"] },
    { kunci: "bank", label: "Administrasi bank", kategori: ["ADMIN_BANK"], akun: ["6-1700"] },
  ],
});

export const adalahScope = (s) => DIVISI.includes(s);
export const adalahKelompok = (s) => SEMUA_KELOMPOK.includes(s);

/** Bulan "YYYY-MM" dari Date/ISO tanggal. */
export const bulanKunci = (d) => new Date(d).toISOString().slice(0, 7);
