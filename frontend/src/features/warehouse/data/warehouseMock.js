// Data CONTOH Warehouse — Tahap 1.
//
// ⚠️ SEMUA angka di file ini FIKTIF. Setiap widget yang memakainya WAJIB
// menampilkan <MockBadge /> ("Contoh"), konvensi yang sudah berlaku di repo
// ini sejak Wave 2A (features/dashboard/data/contracts.js) dan dipakai
// konsisten di seluruh modul Delivery.
//
// KENAPA CONTOH, BUKAN DATA NYATA. Backend inventory SUDAH ADA dan berfungsi
// (backend/src/routes/inventory.js: katalog material, ledger stock_movements,
// saldo terhitung) — tapi di production tabel `materials` dan
// `stock_movements` MASIH KOSONG (0 baris, diverifikasi langsung sebelum
// tahap ini ditulis). Halaman berdata nyata akan tampil kosong total dan
// tidak bisa dipakai menilai rancangan UI-nya.
//
// Halaman lama pages/Gudang.jsx TETAP UTUH dan TETAP memakai data NYATA —
// tidak ada badge "Contoh" di sana. Tahap 2 menyambungkan halaman baru ini ke
// backend yang sama dan mencabut file ini.
export const IS_MOCK = true;

// ── Kategori & status ───────────────────────────────────────────────────
// Vokabuler dwibahasa sesuai ketentuan: istilah Inggris yang sudah lazim di
// gudang, dengan label Indonesia sebagai penjelas.
export const ITEM_CATEGORY = {
  RAW_MATERIAL:  { label: "Raw Material",   labelId: "Bahan Baku" },
  WIP:           { label: "WIP",            labelId: "Barang Setengah Jadi" },
  FINISHED_GOODS:{ label: "Finished Goods", labelId: "Produk Jadi" },
  CONSUMABLE:    { label: "Consumables",    labelId: "Barang Pakai Habis" },
};

// Status stok — TURUNAN dari angka (available vs minimum/maximum), bukan
// kolom yang disimpan. Sama disiplinnya dengan saldo stok itu sendiri:
// dihitung, tidak pernah ditulis (PRD §8.1).
export const STOCK_STATUS = {
  IN_STOCK:     { label: "In Stock",     labelId: "Stok Aman",     tone: "green" },
  LOW_STOCK:    { label: "Low Stock",    labelId: "Stok Menipis",  tone: "orange" },
  OUT_OF_STOCK: { label: "Out of Stock", labelId: "Stok Habis",    tone: "red" },
  OVER_STOCK:   { label: "Over Stock",   labelId: "Stok Berlebih", tone: "accent" },
  // Spesifikasi meminta ungu untuk Quarantine/Reserved. Badge DS v2 SENGAJA
  // cuma punya 4 hue (accent/red/orange/green) dan melipat hue dekoratif ke
  // accent — "aturan satu accent". Karantina dipetakan ke orange karena ia
  // memang keadaan PERINGATAN, bukan sekadar informasi.
  QUARANTINE:   { label: "Quarantine",   labelId: "Karantina",     tone: "orange" },
  DAMAGED:      { label: "Damaged",      labelId: "Rusak",         tone: "red" },
  INACTIVE:     { label: "Inactive",     labelId: "Nonaktif",      tone: "neutral" },
};

/** Status stok DITURUNKAN dari angka — satu-satunya sumber kebenarannya. */
export function deriveStockStatus(item) {
  if (!item.active) return "INACTIVE";
  if (item.quarantine > 0 && item.available === 0) return "QUARANTINE";
  if (item.available <= 0) return "OUT_OF_STOCK";
  if (item.available <= item.minimumStock) return "LOW_STOCK";
  if (item.maximumStock && item.available > item.maximumStock) return "OVER_STOCK";
  return "IN_STOCK";
}

export const MOVEMENT_TYPE = {
  RECEIPT:       { label: "Goods Receipt",  labelId: "Penerimaan",  tone: "green" },
  ISSUE:         { label: "Material Issue", labelId: "Pengeluaran", tone: "accent" },
  TRANSFER:      { label: "Transfer",       labelId: "Mutasi",      tone: "accent" },
  ADJUSTMENT:    { label: "Adjustment",     labelId: "Penyesuaian", tone: "orange" },
  RETURN:        { label: "Return",         labelId: "Retur",       tone: "accent" },
  REPLENISHMENT: { label: "Replenishment",  labelId: "Restok",      tone: "accent" },
};

// ── KPI dashboard ───────────────────────────────────────────────────────
export const WAREHOUSE_KPI = {
  totalActiveItems:   1284,
  availableStockValue: 2_480_000_000,
  belowMinimumStock:  12,
  outOfStock:         3,
  pendingGoodsReceipt: 8,
  pendingMaterialIssue: 15,
  stockAccuracy:      97.8,
  openDiscrepancy:    4,
};

// ── A. Stock health ─────────────────────────────────────────────────────
export const STOCK_HEALTH = [
  { key: "IN_STOCK",     count: 1198 },
  { key: "LOW_STOCK",    count: 12 },
  { key: "OUT_OF_STOCK", count: 3 },
  { key: "OVER_STOCK",   count: 47 },
  { key: "QUARANTINE",   count: 18 },
  { key: "DAMAGED",      count: 6 },
];

// ── B. Inventory by category ────────────────────────────────────────────
export const INVENTORY_BY_CATEGORY = [
  { key: "RAW_MATERIAL",   items: 642, value: 1_180_000_000 },
  { key: "WIP",            items: 187, value:   410_000_000 },
  { key: "FINISHED_GOODS", items: 361, value:   820_000_000 },
  { key: "CONSUMABLE",     items:  94, value:    70_000_000 },
];

// ── Item inventory (dipakai Stock & Material + Low Stock Alert) ─────────
export const INVENTORY_ITEMS = [
  {
    id: "ITEM-FOAM-D18", itemCode: "FOAM-HR-D18-5CM", name: "Busa HR Density 18 — 5cm",
    category: "RAW_MATERIAL", variant: "200x180cm", unit: "SHEET",
    onHand: 12, reserved: 0, available: 12, incoming: 40, quarantine: 0,
    minimumStock: 30, maximumStock: 120, location: "WH-JKT / RAW-MATERIAL / RACK-A / BIN-A01",
    supplier: "PT Busa Nusantara", lastMovementAt: "2026-08-01T09:20:00.000Z", active: true,
  },
  {
    id: "ITEM-FOAM-D26", itemCode: "FOAM-HD-D26-10CM", name: "Busa HD Density 26 — 10cm",
    category: "RAW_MATERIAL", variant: "200x160cm", unit: "SHEET",
    onHand: 214, reserved: 36, available: 178, incoming: 0, quarantine: 0,
    minimumStock: 60, maximumStock: 300, location: "WH-JKT / RAW-MATERIAL / RACK-A / BIN-A04",
    supplier: "PT Busa Nusantara", lastMovementAt: "2026-08-02T03:10:00.000Z", active: true,
  },
  {
    id: "ITEM-FABRIC-KNIT", itemCode: "FABRIC-KNIT-QUILT", name: "Kain Knit Quilting Premium",
    category: "RAW_MATERIAL", variant: "Putih Tulang", unit: "METER",
    onHand: 0, reserved: 0, available: 0, incoming: 250, quarantine: 0,
    minimumStock: 100, maximumStock: 600, location: "WH-JKT / RAW-MATERIAL / RACK-C / BIN-C02",
    supplier: "CV Tekstil Jaya", lastMovementAt: "2026-07-30T07:45:00.000Z", active: true,
  },
  {
    id: "ITEM-SPRING-POCKET", itemCode: "SPRING-POCKET-Q", name: "Pocket Spring Queen",
    category: "RAW_MATERIAL", variant: "160x200cm", unit: "PCS",
    onHand: 88, reserved: 12, available: 76, incoming: 0, quarantine: 0,
    minimumStock: 25, maximumStock: 150, location: "WH-JKT / RAW-MATERIAL / RACK-B / BIN-B01",
    supplier: "PT Spring Indo", lastMovementAt: "2026-08-01T14:05:00.000Z", active: true,
  },
  {
    id: "ITEM-ADHESIVE", itemCode: "ADHESIVE-SPRAY-5L", name: "Lem Semprot Foam 5L",
    category: "CONSUMABLE", variant: "5 Liter", unit: "PCS",
    onHand: 9, reserved: 2, available: 7, incoming: 0, quarantine: 0,
    minimumStock: 15, maximumStock: 60, location: "WH-JKT / RAW-MATERIAL / RACK-D / BIN-D03",
    supplier: "CV Kimia Sentosa", lastMovementAt: "2026-07-29T11:30:00.000Z", active: true,
  },
  {
    id: "ITEM-ZIPPER", itemCode: "ZIPPER-YKK-200", name: "Resleting YKK 200cm",
    category: "RAW_MATERIAL", variant: "Hitam", unit: "PCS",
    onHand: 430, reserved: 40, available: 390, incoming: 0, quarantine: 0,
    minimumStock: 100, maximumStock: 350, location: "WH-JKT / RAW-MATERIAL / RACK-D / BIN-D07",
    supplier: "CV Tekstil Jaya", lastMovementAt: "2026-08-02T01:15:00.000Z", active: true,
  },
  {
    id: "ITEM-WIP-CORE-Q", itemCode: "WIP-CORE-QUEEN", name: "Mattress Core Queen — Menunggu Finishing",
    category: "WIP", variant: "160x200cm", unit: "PCS",
    onHand: 23, reserved: 23, available: 0, incoming: 0, quarantine: 0,
    minimumStock: 0, maximumStock: null, location: "WH-JKT / WIP / RACK-W1 / BIN-W03",
    supplier: null, lastMovementAt: "2026-08-02T02:40:00.000Z", active: true,
  },
  {
    id: "ITEM-FG-SANO-Q", itemCode: "FG-SANO-SEHAT-Q", name: "Kasur Sano Matras Sehat Queen",
    category: "FINISHED_GOODS", variant: "160x200cm", unit: "PCS",
    onHand: 31, reserved: 8, available: 23, incoming: 0, quarantine: 0,
    minimumStock: 10, maximumStock: 40, location: "WH-JKT / FINISHED-GOODS / RACK-F2 / BIN-F05",
    supplier: null, lastMovementAt: "2026-08-01T16:50:00.000Z", active: true,
  },
  {
    id: "ITEM-FG-PILLOW", itemCode: "FG-PILLOW-LATEX", name: "Bantal Latex Sano",
    category: "FINISHED_GOODS", variant: "60x40cm", unit: "PCS",
    onHand: 156, reserved: 14, available: 142, incoming: 0, quarantine: 0,
    minimumStock: 30, maximumStock: 120, location: "WH-JKT / FINISHED-GOODS / RACK-F1 / BIN-F02",
    supplier: null, lastMovementAt: "2026-07-31T13:20:00.000Z", active: true,
  },
  {
    id: "ITEM-PACK-PLASTIC", itemCode: "PACK-WRAP-ROLL", name: "Plastik Wrap Packaging",
    category: "CONSUMABLE", variant: "50cm x 300m", unit: "SPOOL",
    onHand: 4, reserved: 0, available: 4, incoming: 20, quarantine: 0,
    minimumStock: 10, maximumStock: 50, location: "WH-JKT / DISPATCH / RACK-P1 / BIN-P01",
    supplier: "CV Kemasan Prima", lastMovementAt: "2026-07-28T08:00:00.000Z", active: true,
  },
  {
    id: "ITEM-FABRIC-JACQUARD", itemCode: "FABRIC-JACQUARD-LUX", name: "Kain Jacquard Luxury",
    category: "RAW_MATERIAL", variant: "Abu Muda", unit: "METER",
    onHand: 62, reserved: 0, available: 0, incoming: 0, quarantine: 62,
    minimumStock: 50, maximumStock: 400, location: "WH-JKT / QUARANTINE / RACK-Q1 / BIN-Q02",
    supplier: "CV Tekstil Jaya", lastMovementAt: "2026-08-01T10:10:00.000Z", active: true,
  },
  {
    id: "ITEM-THREAD", itemCode: "THREAD-POLY-40", name: "Benang Polyester #40",
    category: "CONSUMABLE", variant: "Putih", unit: "SPOOL",
    onHand: 0, reserved: 0, available: 0, incoming: 0, quarantine: 0,
    minimumStock: 20, maximumStock: 80, location: "WH-JKT / RAW-MATERIAL / RACK-D / BIN-D01",
    supplier: "CV Tekstil Jaya", lastMovementAt: "2026-07-25T09:00:00.000Z", active: true,
  },
];

/** Item yang available-nya di bawah minimum — dipakai Low Stock Alert. */
export function lowStockItems() {
  return INVENTORY_ITEMS
    .filter((i) => i.active && i.available <= i.minimumStock && i.minimumStock > 0)
    .map((i) => ({ ...i, shortage: Math.max(0, i.minimumStock - i.available) }))
    .sort((a, b) => b.shortage - a.shortage);
}

// ── D. Incoming goods ───────────────────────────────────────────────────
export const RECEIPT_STATUS = {
  DRAFT:             { label: "Draft",             labelId: "Draft",            tone: "neutral" },
  SCHEDULED:         { label: "Scheduled",         labelId: "Dijadwalkan",      tone: "accent" },
  ARRIVED:           { label: "Arrived",           labelId: "Tiba",             tone: "accent" },
  INSPECTION:        { label: "Inspection",        labelId: "Pemeriksaan",      tone: "orange" },
  READY_FOR_PUTAWAY: { label: "Ready for Putaway", labelId: "Siap Ditempatkan", tone: "accent" },
  COMPLETED:         { label: "Completed",         labelId: "Selesai",          tone: "green" },
  REJECTED:          { label: "Rejected",          labelId: "Ditolak",          tone: "red" },
};

export const INCOMING_GOODS = [
  { id: "GR-20260802-001", reference: "PO-2026-0451", supplier: "PT Busa Nusantara", expectedDate: "2026-08-03", itemCount: 4, status: "SCHEDULED" },
  { id: "GR-20260802-002", reference: "PO-2026-0448", supplier: "CV Tekstil Jaya",   expectedDate: "2026-08-03", itemCount: 2, status: "ARRIVED" },
  { id: "GR-20260801-014", reference: "PO-2026-0442", supplier: "PT Spring Indo",    expectedDate: "2026-08-02", itemCount: 1, status: "INSPECTION" },
  { id: "GR-20260801-013", reference: "PO-2026-0440", supplier: "CV Kemasan Prima",  expectedDate: "2026-08-02", itemCount: 3, status: "READY_FOR_PUTAWAY" },
  { id: "GR-20260801-011", reference: "RET-PROD-018", supplier: "Produksi — Retur",  expectedDate: "2026-08-01", itemCount: 2, status: "COMPLETED" },
];

// ── E. Material request queue ───────────────────────────────────────────
export const ISSUE_STATUS = {
  DRAFT:            { label: "Draft",            labelId: "Draft",             tone: "neutral" },
  WAITING_APPROVAL: { label: "Waiting Approval", labelId: "Menunggu Approval", tone: "orange" },
  APPROVED:         { label: "Approved",         labelId: "Disetujui",         tone: "accent" },
  READY_TO_PICK:    { label: "Ready to Pick",    labelId: "Siap Diambil",      tone: "accent" },
  PICKED:           { label: "Picked",           labelId: "Sudah Diambil",     tone: "accent" },
  ISSUED:           { label: "Issued",           labelId: "Dikeluarkan",       tone: "green" },
  CANCELLED:        { label: "Cancelled",        labelId: "Dibatalkan",        tone: "neutral" },
};

export const PRIORITY = {
  LOW:    { label: "Low",    labelId: "Rendah",  tone: "neutral" },
  NORMAL: { label: "Normal", labelId: "Normal",  tone: "accent" },
  HIGH:   { label: "High",   labelId: "Tinggi",  tone: "orange" },
  URGENT: { label: "Urgent", labelId: "Mendesak",tone: "red" },
};

export const MATERIAL_REQUESTS = [
  { id: "MI-20260802-018", workOrder: "WO-2026-0871", line: "Line A — Quilting", requestedBy: "Bagas",  totalItems: 5, requiredDate: "2026-08-03", priority: "URGENT", status: "WAITING_APPROVAL" },
  { id: "MI-20260802-017", workOrder: "WO-2026-0869", line: "Line B — Assembly", requestedBy: "Rian",   totalItems: 3, requiredDate: "2026-08-03", priority: "HIGH",   status: "WAITING_APPROVAL" },
  { id: "MI-20260802-015", workOrder: "WO-2026-0866", line: "Line A — Cutting",  requestedBy: "Dwi",    totalItems: 7, requiredDate: "2026-08-04", priority: "NORMAL", status: "APPROVED" },
  { id: "MI-20260801-012", workOrder: "WO-2026-0860", line: "Line C — Finishing",requestedBy: "Sari",   totalItems: 2, requiredDate: "2026-08-02", priority: "NORMAL", status: "READY_TO_PICK" },
  { id: "MI-20260801-009", workOrder: "WO-2026-0855", line: "Line B — Assembly", requestedBy: "Rian",   totalItems: 4, requiredDate: "2026-08-02", priority: "LOW",    status: "ISSUED" },
];

// ── F. Recent stock movement ────────────────────────────────────────────
export const RECENT_MOVEMENTS = [
  { id: "MV-9021", type: "ISSUE",         itemName: "Busa HD Density 26 — 10cm", qty: -12, unit: "SHEET", reference: "WO-2026-0869", user: "Bagas", at: "2026-08-02T03:10:00.000Z" },
  { id: "MV-9020", type: "RECEIPT",       itemName: "Resleting YKK 200cm",       qty: 200, unit: "PCS",   reference: "PO-2026-0447", user: "Novi",  at: "2026-08-02T01:15:00.000Z" },
  { id: "MV-9019", type: "TRANSFER",      itemName: "Mattress Core Queen",       qty: 6,   unit: "PCS",   reference: "TR-20260802-003", user: "Dwi", at: "2026-08-02T02:40:00.000Z" },
  { id: "MV-9018", type: "ADJUSTMENT",    itemName: "Lem Semprot Foam 5L",       qty: -2,  unit: "PCS",   reference: "CC-024",       user: "Sari",  at: "2026-08-01T16:50:00.000Z" },
  { id: "MV-9017", type: "RETURN",        itemName: "Kain Knit Quilting Premium",qty: 18,  unit: "METER", reference: "RET-PROD-018", user: "Rian",  at: "2026-08-01T14:05:00.000Z" },
  { id: "MV-9016", type: "REPLENISHMENT", itemName: "Plastik Wrap Packaging",    qty: 20,  unit: "SPOOL", reference: "RP-20260801-006", user: "Novi", at: "2026-08-01T09:20:00.000Z" },
];

// ── G. Inventory issues ─────────────────────────────────────────────────
export const INVENTORY_ISSUES = [
  { id: "ISS-1", severity: "red",    label: "Negative stock",     labelId: "Stok minus",                count: 0 },
  { id: "ISS-2", severity: "orange", label: "Stock discrepancy",  labelId: "Selisih stok opname",       count: 4 },
  { id: "ISS-3", severity: "orange", label: "Expired batch",      labelId: "Batch kedaluwarsa",         count: 2 },
  { id: "ISS-4", severity: "red",    label: "Damaged material",   labelId: "Material rusak",            count: 6 },
  { id: "ISS-5", severity: "accent", label: "Unverified receipt", labelId: "Penerimaan belum diverifikasi", count: 3 },
  { id: "ISS-6", severity: "orange", label: "Pending approval",   labelId: "Menunggu approval",         count: 8 },
];
