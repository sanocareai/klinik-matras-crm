import "./env.js"; // urutan WAJIB pertama — lihat catatan di env.js
import { PrismaClient } from "@prisma/client";

// SATU PrismaClient dipakai bersama oleh seluruh test integrasi dalam satu
// proses `node --test` (pola sama dengan src/db.js di aplikasi asli) — tapi
// menunjuk ke DATABASE_URL tes yang sudah di-override & divalidasi oleh
// env.js, bukan ke database dev/produksi.
export const testPrisma = new PrismaClient();

// Tabel inventory (urutan TIDAK penting — TRUNCATE ... CASCADE mengabaikan
// arah FK RESTRICT/SetNull sepenuhnya, beda dari DELETE biasa) + entitas
// pendukung minimal yang dibuat fixture (users/customers/orders/units).
// SENGAJA di-list eksplisit (bukan "semua tabel di schema") — supaya kalau
// ada tabel baru ditambah tapi lupa dimasukkan ke sini, pemanggil dapat
// error jelas dari FK constraint yang masih menunjuk baris lama, alih-alih
// diam-diam meninggalkan sampah lintas test run.
const TABLES_TO_TRUNCATE = [
  "activity_events",
  "stock_movements",
  "stock_count_lines", "stock_counts",
  "material_issue_lines", "material_issues",
  "stock_transfer_lines", "stock_transfers",
  "goods_receipt_lines", "goods_receipts",
  "damaged_stock_records", "return_records",
  "stock_adjustment_requests", "replenishment_requests",
  "materials",
  "storage_locations", "warehouses",
  // ── Finance Workspace (D-180, 17 September 2026) ────────────────────────
  // WAJIB ada di daftar ini, bukan mengandalkan CASCADE dari "Order".
  // Alasannya BUKAN teoretis: sejak D-180, putaway goods receipt & material
  // issue MEMANGGIL mesin posting finance (lihat routes/goodsReceipt.js dan
  // routes/materialIssue.js). Di database tes yang bagan akunnya belum
  // dipasang, panggilan itu menulis baris fin_posting_gaps + fin_journal_*.
  // Baris-baris itu TIDAK tersentuh CASCADE dari tabel mana pun di bawah
  // (relasinya ke Order/Customer/User semua SetNull, dan sourceId-nya
  // polimorfik tanpa FK sama sekali) — jadi tanpa baris ini, sampah
  // menumpuk lintas file test dan assertion "berapa gap yang terbuka"
  // di financeLedger.integration.test.js akan melihat sisa test lain.
  "fin_bank_statement_lines", "fin_bank_statements",
  "fin_supplier_payment_allocations", "fin_supplier_payments", "fin_supplier_bills",
  "fin_payment_allocations", "fin_refunds", "fin_expenses", "fin_purchases", "fin_kasbon_repayments", "fin_kasbon", "fin_other_incomes",
  "fin_cash_transfers",
  "fin_journal_lines", "fin_journal_entries",
  "fin_posting_gaps", "fin_periods", "fin_settings",
  "fin_expense_categories", "fin_purchase_categories", "fin_cash_accounts", "fin_suppliers", "fin_accounts",
  // payment_verifications & payments: sebelumnya ikut terbawa CASCADE dari
  // "Order", sekarang disebut eksplisit supaya urutan pembersihannya tidak
  // bergantung pada detail cascade yang tidak terlihat dari file ini.
  "payment_verifications", "payments",
  // OrderSequence: counter nomor dokumen (ORD/INV/JV/EXP/BILL/...) yang
  // dipakai bersama seluruh domain. Tanpa direset, nomor dokumen di test
  // akan terus naik lintas run — bukan kesalahan fatal, tapi membuat
  // assertion terhadap nomor dokumen (mis. "JV-17092026-001") mustahil.
  "OrderSequence",

  // Customer/Order/User TIDAK punya @@map — nama tabel fisiknya PERSIS nama
  // model PascalCase (case-sensitive, wajib dikutip di SQL), BEDA dari
  // model lain di daftar ini yang semuanya snake_case lewat @@map. Gotcha
  // ini sudah pernah bikin query gagal sebelumnya di sesi kerja lain —
  // dicatat di sini supaya tidak terulang.
  "units", "Order", "Customer",
  "user_roles", "User",
];

/**
 * Bersihkan SELURUH data tes (bukan schema) — dipanggil di `before`/`after`
 * setiap file test integrasi supaya satu file tidak melihat sisa data file
 * lain, dan supaya menjalankan ulang test yang gagal di tengah jalan tidak
 * terjegal data basi dari run sebelumnya. Aman dipakai di sini KARENA
 * env.js sudah memvalidasi database ini adalah database tes khusus.
 */
export async function truncateAll() {
  const list = TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
