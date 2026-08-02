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
 * Status stok DITURUNKAN dari ANGKA YANG BENAR-BENAR BISA DIALOKASIKAN —
 * `available` (balance − reserved), bukan `balance` mentah — sejak Tahap 3
 * menambahkan Reserved (SUM permintaan Material Issue yang APPROVED..PICKED).
 * Tidak pernah disimpan sebagai kolom (PRD §8.1); backend GET /inventory/stock
 * sudah menghitung & mengembalikan `available` langsung.
 *
 * `reorderPoint` null = alert MATI untuk material itu (lihat catatan di
 * schema.prisma) — BUKAN "reorder di titik nol". Karena itu material tanpa
 * reorderPoint tidak akan pernah berstatus LOW_STOCK.
 */
export function deriveStockStatusReal(row) {
  if (!row.active) return "INACTIVE";
  const available = row.available ?? row.balance;
  if (available <= 0) return "OUT_OF_STOCK";
  if (row.reorderPoint != null && available <= row.reorderPoint) return "LOW_STOCK";
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

// enum ReceiptStatus & ReceiptSourceType — Goods Receipt (Tahap 2B). Urutan
// objeknya SENGAJA berurutan mengikuti FORWARD_FLOW backend, dipakai juga
// untuk membangun daftar "langkah berikutnya yang sah" di UI.
export const RECEIPT_STATUS_REAL = {
  DRAFT:              { label: "Draft",             labelId: "Draft",             tone: "neutral" },
  SCHEDULED:          { label: "Scheduled",         labelId: "Dijadwalkan",       tone: "accent" },
  ARRIVED:            { label: "Arrived",           labelId: "Tiba",              tone: "accent" },
  INSPECTION:         { label: "Inspection",        labelId: "Pemeriksaan",       tone: "orange" },
  READY_FOR_PUTAWAY:  { label: "Ready for Putaway", labelId: "Siap Ditempatkan",  tone: "accent" },
  COMPLETED:          { label: "Completed",         labelId: "Selesai",           tone: "green" },
  REJECTED:           { label: "Rejected",          labelId: "Ditolak",           tone: "red" },
};
export const RECEIPT_FORWARD_FLOW = ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"];

export const RECEIPT_SOURCE_REAL = {
  PURCHASE_ORDER:             { label: "Purchase Order",           labelId: "Pesanan Pembelian" },
  SUPPLIER_DELIVERY:          { label: "Supplier Delivery",        labelId: "Kiriman Supplier" },
  PRODUCTION_RETURN:          { label: "Production Return",        labelId: "Retur Produksi" },
  CUSTOMER_RETURN:            { label: "Customer Return",          labelId: "Retur Pelanggan" },
  INTER_WAREHOUSE_TRANSFER:   { label: "Inter-Warehouse Transfer", labelId: "Transfer Antar Gudang" },
  MANUAL:                     { label: "Manual Receipt",           labelId: "Input Manual" },
};

// enum IssueStatus & IssueSourceType/IssuePriority — Material Issue (Tahap
// 3). Sama pola dengan RECEIPT_STATUS_REAL: urutan objek mengikuti
// FORWARD_FLOW backend.
export const ISSUE_STATUS_REAL = {
  DRAFT:            { label: "Draft",            labelId: "Draft",             tone: "neutral" },
  WAITING_APPROVAL: { label: "Waiting Approval", labelId: "Menunggu Approval", tone: "orange" },
  APPROVED:         { label: "Approved",         labelId: "Disetujui",         tone: "accent" },
  READY_TO_PICK:    { label: "Ready to Pick",    labelId: "Siap Diambil",      tone: "accent" },
  PICKED:           { label: "Picked",           labelId: "Sudah Diambil",     tone: "accent" },
  ISSUED:           { label: "Issued",           labelId: "Dikeluarkan",       tone: "green" },
  CANCELLED:        { label: "Cancelled",        labelId: "Dibatalkan",        tone: "neutral" },
};
export const ISSUE_FORWARD_FLOW = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED", "ISSUED"];

export const ISSUE_SOURCE_REAL = {
  PRODUCTION_WORK_ORDER: { label: "Production Work Order", labelId: "Work Order Produksi" },
  MAINTENANCE_REQUEST:   { label: "Maintenance Request",   labelId: "Permintaan Perawatan" },
  INTERNAL_REQUEST:      { label: "Internal Request",      labelId: "Permintaan Internal" },
  SAMPLE_REQUEST:        { label: "Sample Request",        labelId: "Permintaan Sampel" },
  MANUAL:                { label: "Manual Issue",          labelId: "Input Manual" },
};

export const ISSUE_PRIORITY_REAL = {
  LOW:    { label: "Low",    labelId: "Rendah",   tone: "neutral" },
  NORMAL: { label: "Normal", labelId: "Normal",   tone: "accent" },
  HIGH:   { label: "High",   labelId: "Tinggi",   tone: "orange" },
  URGENT: { label: "Urgent", labelId: "Mendesak", tone: "red" },
};

// enum TransferStatus & TransferType — Stock Transfer (Tahap 4). IN_TRANSIT
// & COMPLETED SENGAJA tidak dicapai lewat PATCH status biasa seperti langkah
// lain di FORWARD_FLOW — keduanya lewat /dispatch & /receive karena
// dua-duanya menulis baris ledger.
export const TRANSFER_STATUS_REAL = {
  DRAFT:             { label: "Draft",              labelId: "Draft",              tone: "neutral" },
  WAITING_APPROVAL:  { label: "Waiting Approval",   labelId: "Menunggu Approval",  tone: "orange" },
  APPROVED:          { label: "Approved",           labelId: "Disetujui",          tone: "accent" },
  PICKED:            { label: "Picked",             labelId: "Sudah Diambil",      tone: "accent" },
  IN_TRANSIT:        { label: "In Transit",         labelId: "Dalam Perjalanan",   tone: "accent" },
  COMPLETED:         { label: "Completed",          labelId: "Selesai",            tone: "green" },
  CANCELLED:         { label: "Cancelled",          labelId: "Dibatalkan",         tone: "neutral" },
};
export const TRANSFER_FORWARD_FLOW = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "PICKED", "IN_TRANSIT", "COMPLETED"];

export const TRANSFER_TYPE_REAL = {
  BIN_TO_BIN:               { label: "Bin to Bin",               labelId: "Antar Bin" },
  ZONE_TO_ZONE:              { label: "Zone to Zone",             labelId: "Antar Zone" },
  WAREHOUSE_TO_WAREHOUSE:    { label: "Warehouse to Warehouse",   labelId: "Antar Gudang" },
  AVAILABLE_TO_QUARANTINE:   { label: "Available → Quarantine",   labelId: "Ke Karantina" },
  QUARANTINE_TO_AVAILABLE:   { label: "Quarantine → Available",   labelId: "Dari Karantina" },
  AVAILABLE_TO_DAMAGED:      { label: "Available → Damaged",      labelId: "Ke Area Rusak" },
  RETURN_TO_WAREHOUSE:       { label: "Return to Warehouse",      labelId: "Retur ke Gudang" },
};

export const LOCATION_TYPE_REAL = {
  RECEIVING_AREA:      "Receiving Area",
  RAW_MATERIAL_AREA:   "Raw Material Area",
  WIP_AREA:            "WIP Area",
  FINISHED_GOODS_AREA: "Finished Goods Area",
  QUARANTINE_AREA:     "Quarantine Area",
  DAMAGED_AREA:        "Damaged Area",
  RETURN_AREA:         "Return Area",
  DISPATCH_AREA:       "Dispatch Area",
};

// enum CountStatus/CountType/CountMethod — Stock Count (Tahap 5). Status
// TIDAK punya "forward flow" generik seperti dokumen lain — transisinya
// masing-masing lewat endpoint dengan efek samping berbeda (start=snapshot,
// submit=validasi lengkap, complete=tulis ledger), jadi tidak ada array
// FORWARD_FLOW di sini seperti RECEIPT_FORWARD_FLOW/ISSUE_FORWARD_FLOW.
export const COUNT_STATUS_REAL = {
  SCHEDULED:       { label: "Scheduled",       labelId: "Dijadwalkan",       tone: "neutral" },
  IN_PROGRESS:     { label: "In Progress",     labelId: "Sedang Dihitung",   tone: "accent" },
  WAITING_REVIEW:  { label: "Waiting Review",  labelId: "Menunggu Review",   tone: "orange" },
  COMPLETED:       { label: "Completed",       labelId: "Selesai",           tone: "green" },
  CANCELLED:       { label: "Cancelled",       labelId: "Dibatalkan",        tone: "neutral" },
};

export const COUNT_TYPE_REAL = {
  CYCLE_COUNT:       { label: "Cycle Count",        labelId: "Hitung Berkala" },
  FULL_STOCK_OPNAME: { label: "Full Stock Opname",  labelId: "Opname Penuh" },
};

export const COUNT_METHOD_REAL = {
  BY_ITEM:          { label: "By Item" },
  BY_CATEGORY:      { label: "By Category" },
  BY_LOCATION:       { label: "By Location" },
  BY_BATCH:          { label: "By Batch" },
  RANDOM_SAMPLING:   { label: "Random Sampling" },
  FULL_WAREHOUSE:    { label: "Full Warehouse" },
};

// ── Damaged Stock, Returns, Stock Adjustment (Tahap 6) ──────────────────
// Ketiganya memakai movement yang SUDAH ADA (WASTE/RETURN/ADJUSTMENT) —
// lihat catatan panjang di schema.prisma. Cuma resolusi tertentu yang
// menulis ledger; sisanya murni status/riwayat.
export const DAMAGE_CATEGORY_REAL = {
  TORN:              { label: "Torn" },
  WET:               { label: "Wet" },
  CONTAMINATED:      { label: "Contaminated" },
  DEFORMED:          { label: "Deformed" },
  PACKAGING_DAMAGE:  { label: "Packaging Damage" },
  EXPIRED:           { label: "Expired" },
  PRODUCTION_DEFECT: { label: "Production Defect" },
  DELIVERY_DAMAGE:   { label: "Delivery Damage" },
  OTHER:             { label: "Other" },
};
export const DAMAGED_STATUS_REAL = {
  REPORTED:         { label: "Reported",         labelId: "Dilaporkan",    tone: "orange" },
  UNDER_INSPECTION: { label: "Under Inspection",  labelId: "Diperiksa",     tone: "accent" },
  RESOLVED:         { label: "Resolved",          labelId: "Selesai",      tone: "green" },
};
// Cuma dua yang menulis ledger (WASTE) — ditandai di label supaya jelas
// di UI, bukan disembunyikan sebagai detail implementasi.
export const DAMAGED_RESOLUTION_REAL = {
  RETURN_TO_SUPPLIER:   { label: "Return to Supplier", writesLedger: true },
  REWORK:                { label: "Rework",             writesLedger: false },
  DISPOSE:               { label: "Dispose",            writesLedger: true },
  RESTORE_TO_AVAILABLE:  { label: "Restore to Available", writesLedger: false },
};

export const RETURN_TYPE_REAL = {
  CUSTOMER_RETURN:  { label: "Customer Return" },
  DELIVERY_RETURN:  { label: "Delivery Return" },
  PRODUCTION_RETURN:{ label: "Production Return" },
  SUPPLIER_RETURN:  { label: "Supplier Return" },
};
export const RETURN_STATUS_REAL = {
  CREATED:    { label: "Created",    labelId: "Dibuat",    tone: "neutral" },
  RECEIVED:   { label: "Received",   labelId: "Diterima",  tone: "accent" },
  INSPECTION: { label: "Inspection", labelId: "Pemeriksaan", tone: "orange" },
  COMPLETED:  { label: "Completed",  labelId: "Selesai",   tone: "green" },
  CANCELLED:  { label: "Cancelled",  labelId: "Dibatalkan", tone: "neutral" },
};
export const RETURN_FORWARD_FLOW = ["CREATED", "RECEIVED", "INSPECTION", "COMPLETED"];
// Cuma RETURN_TO_AVAILABLE yang menulis ledger (RETURN, positif).
export const RETURN_RESOLUTION_REAL = {
  RETURN_TO_AVAILABLE: { label: "Return to Available", writesLedger: true },
  QUARANTINE:           { label: "Quarantine",          writesLedger: false },
  REWORK:                { label: "Rework",              writesLedger: false },
  RETURN_TO_SUPPLIER:    { label: "Return to Supplier",  writesLedger: false },
  DISPOSE:               { label: "Dispose",             writesLedger: false },
  REPLACE_PRODUCT:       { label: "Replace Product",     writesLedger: false },
};

export const ADJUSTMENT_TYPE_REAL = {
  POSITIVE:         { label: "Positive Adjustment" },
  NEGATIVE:         { label: "Negative Adjustment" },
  COUNT_DIFFERENCE: { label: "Count Difference" },
  DAMAGE:           { label: "Damage" },
  EXPIRY:           { label: "Expiry" },
  DATA_CORRECTION:  { label: "Data Correction" },
  CONVERSION:       { label: "Conversion" },
  OTHER:            { label: "Other" },
};
export const ADJUSTMENT_STATUS_REAL = {
  DRAFT:            { label: "Draft",            labelId: "Draft",             tone: "neutral" },
  WAITING_APPROVAL: { label: "Waiting Approval",  labelId: "Menunggu Approval", tone: "orange" },
  APPROVED:         { label: "Approved",          labelId: "Disetujui",        tone: "accent" },
  POSTED:           { label: "Posted",            labelId: "Diposting",        tone: "green" },
  CANCELLED:        { label: "Cancelled",         labelId: "Dibatalkan",       tone: "neutral" },
};
export const ADJUSTMENT_FORWARD_FLOW = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "POSTED"];

/**
 * SELISIH SPESIFIKASI vs DATABASE — ditulis di sini supaya tidak hilang.
 *
 * Belum ada di backend, jadi TIDAK ditampilkan sebagai kolom/filter di
 * halaman berdata nyata (menampilkannya = kolom yang selalu kosong):
 *   · Reserved / Available SUDAH nyata sejak Tahap 3 — dihitung dari
 *     Material Issue yang APPROVED..PICKED, lihat deriveStockStatusReal().
 *   · Lokasi rak/bin SUDAH nyata sejak Tahap 4 (Warehouse→StorageLocation)
 *     — tapi HANYA dipakai Stock Transfer. GoodsReceiptLine.destinationLocation
 *     & MaterialIssueLine.sourceLocation MASIH string bebas — menyambungkan
 *     keduanya ke StorageLocation adalah pembersihan terpisah, bukan gap
 *     fungsional yang mendesak (lihat catatan di schema.prisma model
 *     StorageLocation).
 *   · Supplier per item → supplier tercatat PER PENERIMAAN di ledger, bukan
 *     atribut material. Drawer detail menampilkan supplier penerimaan
 *     TERAKHIR — itu yang benar-benar diketahui sistem.
 *   · Batch/lot, expiry, barcode, dimensi, variant, maximumStock → belum ada
 *     kolomnya sama sekali.
 *   · Status OVER_STOCK/QUARANTINE/DAMAGED (Stock & Material) → item bisa
 *     DIPINDAHKAN ke lokasi bertipe Quarantine/Damaged lewat Transfer, tapi
 *     status stok agregat (deriveStockStatusReal) tidak membaca lokasi —
 *     saldo tetap dihitung lintas lokasi. Memisah saldo PER LOKASI adalah
 *     perluasan terpisah, bukan bagian Tahap 4.
 *   · Substitution Item (Material Issue) → sengaja tidak dibangun Tahap 3.
 *     Kalau perlu material pengganti, batalkan permintaan lalu ajukan ulang
 *     dengan item yang benar — lebih jujur daripada field yang menyiratkan
 *     penggantian otomatis padahal tidak ada logikanya.
 *   · Difference VALUE — Rupiah (Stock Count, Tahap 5) → Material tidak
 *     punya kolom harga/costing (unitCost cuma tercatat PER PENERIMAAN di
 *     StockMovement). Menghitung nilai selisih tanpa baseline harga yang
 *     benar sama dengan mengarang angka.
 *   · Assigned TEAM (jamak, Stock Count) → disederhanakan jadi satu
 *     `assignedTo` — tidak ada entitas tim/grup kerja di sistem ini.
 *   · Evidence foto (Stock Count) → tidak ada upload, sama alasan dengan
 *     Goods Receipt Tahap 2B (butuh storage terpisah).
 */
export const FIELDS_NOT_IN_BACKEND = [
  "batch", "expiry", "barcode", "variant", "maximumStock", "substitutionItem",
  "stockByLocation", "differenceValue", "assignedTeam", "evidencePhoto",
];
