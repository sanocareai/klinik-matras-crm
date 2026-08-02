// Peta & turunan inventory NYATA — dari enum backend (prisma/schema.prisma),
// BUKAN dari data contoh.
//
// ⚠️ SENGAJA TERPISAH dari features/warehouse/data/warehouseMock.js. File itu
// berisi vokabuler versi SPESIFIKASI (8 status stok, lokasi rak/bin, reserved,
// supplier per item) yang dipakai dashboard contoh. File INI berisi yang
// benar-benar ada di database hari ini. Menggabungkannya akan membuat halaman
// berdata nyata menampilkan filter yang tidak akan pernah cocok dengan baris
// mana pun — filter yang selalu kosong terbaca sebagai sistem rusak.
//
// Pola yang sama persis dengan jobStatus.js/podStatus.js di modul Delivery.

// enum MaterialUnit — label Indonesia, sama dengan pages/Gudang.jsx supaya
// satu material tidak punya dua sebutan satuan di dua halaman.
export const UNIT_LABEL = {
  PCS: "pcs", METER: "meter", M3: "m³", SHEET: "lembar", SPOOL: "gulung", KG: "kg",
};
export const ALL_UNITS = Object.keys(UNIT_LABEL);

// enum MaterialCategory — ditambahkan migrasi 20260802210000.
export const CATEGORY_REAL = {
  RAW_MATERIAL:   { label: "Raw Material",   labelId: "Bahan Baku" },
  WIP:            { label: "WIP",            labelId: "Barang Setengah Jadi" },
  FINISHED_GOODS: { label: "Finished Goods", labelId: "Produk Jadi" },
  CONSUMABLE:     { label: "Consumables",    labelId: "Barang Pakai Habis" },
};

// enum ServiceLine — sudah ada sejak v1, menjawab pertanyaan BERBEDA dari
// kategori (D-004: dua lini tidak boleh campur material).
export const SERVICE_LINE_REAL = {
  SERVICE: { label: "Service", labelId: "Lini Service" },
  UPGRADE: { label: "Upgrade", labelId: "Lini Upgrade" },
};

// Status stok NYATA — HANYA empat. Semuanya bisa dihitung dari data yang
// benar-benar ada (saldo ledger + reorderPoint + flag aktif).
export const STOCK_STATUS_REAL = {
  IN_STOCK:     { label: "In Stock",     labelId: "Stok Aman",    tone: "green" },
  LOW_STOCK:    { label: "Low Stock",    labelId: "Stok Menipis", tone: "orange" },
  OUT_OF_STOCK: { label: "Out of Stock", labelId: "Stok Habis",   tone: "red" },
  INACTIVE:     { label: "Inactive",     labelId: "Nonaktif",     tone: "neutral" },
};

export const MOVEMENT_LABEL_REAL = {
  RECEIPT:    { label: "Goods Receipt",  labelId: "Penerimaan",  tone: "green" },
  ISSUE:      { label: "Material Issue", labelId: "Pengeluaran", tone: "accent" },
  RETURN:     { label: "Return",         labelId: "Retur",       tone: "accent" },
  WASTE:      { label: "Waste",          labelId: "Terbuang",    tone: "red" },
  ADJUSTMENT: { label: "Adjustment",     labelId: "Opname",      tone: "orange" },
};

/**
 * Status stok DITURUNKAN dari saldo ledger — tidak pernah disimpan sebagai
 * kolom (PRD §8.1). Disiplin yang sama dengan backend GET /inventory/stock
 * yang menghitung `balance` lewat SUM(qty), bukan membacanya.
 *
 * `reorderPoint` null = alert MATI untuk material itu (lihat catatan di
 * schema.prisma) — BUKAN "reorder di titik nol". Karena itu material tanpa
 * reorderPoint tidak akan pernah berstatus LOW_STOCK.
 */
export function deriveStockStatusReal(row) {
  if (!row.active) return "INACTIVE";
  if (row.balance <= 0) return "OUT_OF_STOCK";
  if (row.reorderPoint != null && row.balance <= row.reorderPoint) return "LOW_STOCK";
  return "IN_STOCK";
}

/** Format saldo + satuan. Sama dengan formatQty di pages/Gudang.jsx. */
export function formatQty(qty, unit) {
  const n = Number(qty);
  const rounded = Math.abs(n % 1) < 0.0001
    ? n.toFixed(0)
    : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${rounded} ${UNIT_LABEL[unit] || unit}`;
}

/**
 * SELISIH SPESIFIKASI vs DATABASE — ditulis di sini supaya tidak hilang.
 *
 * Belum ada di backend, jadi TIDAK ditampilkan sebagai kolom/filter di
 * halaman berdata nyata (menampilkannya = kolom yang selalu kosong):
 *   · Reserved / Available terpisah → belum ada sistem reservasi stok sama
 *     sekali. Saldo ledger = on hand = available. Menyusul bersama alur
 *     Material Issue (Phase 3), yang memang jadi tempat stok dialokasikan.
 *   · Lokasi rak/bin → `stock_movements.location` hari ini string bebas
 *     dengan default "GUDANG_UTAMA", BUKAN hierarki Warehouse→Zone→Rack→Bin.
 *     Butuh entitas lokasi tersendiri (Phase 4, bersama Stock Transfer).
 *   · Supplier per item → supplier tercatat PER PENERIMAAN di ledger, bukan
 *     atribut material. Drawer detail menampilkan supplier penerimaan
 *     TERAKHIR — itu yang benar-benar diketahui sistem.
 *   · Batch/lot, expiry, barcode, dimensi, variant, maximumStock → belum ada
 *     kolomnya sama sekali.
 *   · Status OVER_STOCK/QUARANTINE/DAMAGED → tidak ada maximumStock maupun
 *     state karantina di ledger.
 */
export const FIELDS_NOT_IN_BACKEND = [
  "reserved", "location", "batch", "expiry", "barcode", "variant", "maximumStock",
];
