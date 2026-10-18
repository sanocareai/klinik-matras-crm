// Label berbahasa Indonesia untuk Restok, Barang Rusak, Retur, Penyesuaian, dan Stock Opname (UX Tahap 2) + filter tahap daftar. Status/aksi tetap datang dari server (`tampilan`); di sini hanya istilah isian.
export const KATEGORI_RUSAK = { TORN: "Robek", WET: "Basah", CONTAMINATED: "Terkontaminasi", DEFORMED: "Berubah bentuk", PACKAGING_DAMAGE: "Kemasan rusak", EXPIRED: "Kedaluwarsa", PRODUCTION_DEFECT: "Cacat produksi", DELIVERY_DAMAGE: "Rusak saat pengiriman", OTHER: "Lainnya" };
/** Penyelesaian Barang Rusak, dengan dampak stok di label (dua yang MENGURANGI stok ditandai jelas). */
export const RESOLUSI_RUSAK = [
  { nilai: "DISPOSE", label: "Dibuang — stok BERKURANG sebesar jumlah rusak", kurangi: true },
  { nilai: "RETURN_TO_SUPPLIER", label: "Retur ke supplier — stok BERKURANG sebesar jumlah rusak", kurangi: true },
  { nilai: "REWORK", label: "Perbaiki ulang — hanya dicatat, stok tidak berubah", kurangi: false },
  { nilai: "RESTORE_TO_AVAILABLE", label: "Kembalikan ke tersedia — hanya dicatat, stok tidak berubah", kurangi: false },
];
export const JENIS_RETUR = { CUSTOMER_RETURN: "Retur pelanggan", DELIVERY_RETURN: "Retur pengiriman", PRODUCTION_RETURN: "Retur produksi", SUPPLIER_RETURN: "Retur ke supplier" };
/** Penyelesaian Retur; hanya "Kembalikan ke tersedia" yang MENAMBAH stok. */
export const RESOLUSI_RETUR = [
  { nilai: "RETURN_TO_AVAILABLE", label: "Kembalikan ke tersedia — stok BERTAMBAH sebesar jumlah retur", tambah: true },
  { nilai: "QUARANTINE", label: "Karantina — hanya dicatat, stok tidak berubah", tambah: false },
  { nilai: "REWORK", label: "Perbaiki ulang — hanya dicatat, stok tidak berubah", tambah: false },
  { nilai: "RETURN_TO_SUPPLIER", label: "Kembalikan ke supplier — hanya dicatat, stok tidak berubah", tambah: false },
  { nilai: "DISPOSE", label: "Dibuang — hanya dicatat, stok tidak berubah", tambah: false },
  { nilai: "REPLACE_PRODUCT", label: "Ganti produk — hanya dicatat, stok tidak berubah", tambah: false },
];
export const JENIS_PENYESUAIAN = { POSITIVE: "Penambahan stok", NEGATIVE: "Pengurangan stok", COUNT_DIFFERENCE: "Selisih hitungan", DAMAGE: "Kerusakan", EXPIRY: "Kedaluwarsa", DATA_CORRECTION: "Koreksi data", CONVERSION: "Konversi", OTHER: "Lainnya" };
export const SUMBER_RESTOK = { MINIMUM_STOCK_RULE: "Aturan stok minimum", REORDER_POINT: "Batas minimum (reorder point)", PRODUCTION_FORECAST: "Perkiraan produksi", SALES_DEMAND: "Permintaan penjualan", MANUAL_REQUEST: "Diajukan manual", LOCATION_REFILL: "Isi ulang lokasi" };
export const METODE_HITUNG = { BY_ITEM: "Per bahan", BY_CATEGORY: "Per kategori", BY_LOCATION: "Per lokasi", BY_BATCH: "Per batch", RANDOM_SAMPLING: "Sampel acak", FULL_WAREHOUSE: "Seluruh gudang" };
export const JENIS_HITUNG = { CYCLE_COUNT: "Hitung berkala (Cycle Count)", FULL_STOCK_OPNAME: "Opname penuh" };
export const PRIORITAS = { LOW: "Rendah", NORMAL: "Normal", HIGH: "Tinggi", URGENT: "Mendesak" };

const F = (key, label, statuses) => ({ key, label, ...(statuses && { statuses }) });
export const TAHAP_FILTER_RESTOK = Object.freeze([F("", "Semua"), F("draf", "Draf", ["DRAFT"]), F("menunggu", "Menunggu persetujuan", ["WAITING_APPROVAL"]), F("berjalan", "Disetujui & dipesan", ["APPROVED", "ORDERED"]), F("selesai", "Selesai", ["COMPLETED"]), F("ditolak", "Ditolak", ["REJECTED"])]);
export const TAHAP_FILTER_OPNAME = Object.freeze([F("", "Semua"), F("terjadwal", "Terjadwal", ["SCHEDULED"]), F("dihitung", "Sedang dihitung", ["IN_PROGRESS"]), F("tinjauan", "Menunggu tinjauan", ["WAITING_REVIEW"]), F("selesai", "Selesai", ["COMPLETED"]), F("batal", "Dibatalkan", ["CANCELLED"])]);
export const TAHAP_FILTER_RUSAK = Object.freeze([F("", "Semua"), F("dilaporkan", "Dilaporkan", ["REPORTED"]), F("diperiksa", "Diperiksa", ["UNDER_INSPECTION"]), F("selesai", "Selesai", ["RESOLVED"])]);
export const TAHAP_FILTER_RETUR = Object.freeze([F("", "Semua"), F("masuk", "Dicatat & diterima", ["CREATED", "RECEIVED"]), F("diperiksa", "Diperiksa", ["INSPECTION"]), F("selesai", "Selesai", ["COMPLETED"]), F("batal", "Dibatalkan", ["CANCELLED"])]);
export const TAHAP_FILTER_ADJ = Object.freeze([F("", "Semua"), F("draf", "Draf", ["DRAFT"]), F("menunggu", "Menunggu persetujuan", ["WAITING_APPROVAL"]), F("disetujui", "Disetujui (belum diposting)", ["APPROVED"]), F("diposting", "Diposting", ["POSTED"]), F("batal", "Dibatalkan", ["CANCELLED"])]);

/** Teks pencarian per jenis dokumen (huruf kecil). */
export const teksCari = {
  restok: (r) => [r.requestNumber, r.material?.code, r.material?.name, r.supplier, r.requestedBy?.name, r.goodsReceipt?.receiptNumber].filter(Boolean).join(" ").toLowerCase(),
  opname: (r) => [r.countNumber, r.assignedTo?.name, r.createdBy?.name, r.notes, ...(r.lines ?? []).map((l) => `${l.material?.code} ${l.material?.name}`)].filter(Boolean).join(" ").toLowerCase(),
  rusak: (r) => [r.recordNumber, r.material?.code, r.material?.name, r.reportedBy?.name, r.notes, KATEGORI_RUSAK[r.damageCategory]].filter(Boolean).join(" ").toLowerCase(),
  retur: (r) => [r.returnNumber, r.reference, r.material?.code, r.material?.name, r.createdBy?.name, JENIS_RETUR[r.returnType]].filter(Boolean).join(" ").toLowerCase(),
  adj: (r) => [r.adjustmentNumber, r.material?.code, r.material?.name, r.requestedBy?.name, r.reason, JENIS_PENYESUAIAN[r.adjustmentType]].filter(Boolean).join(" ").toLowerCase(),
};
