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
