import "./env.js"; // urutan WAJIB pertama — lihat catatan di env.js
import { PrismaClient } from "@prisma/client";

// SATU PrismaClient dipakai bersama oleh seluruh test integrasi dalam satu
// proses `node --test` (pola sama dengan src/db.js di aplikasi asli) — tapi
// menunjuk ke DATABASE_URL tes yang sudah di-override & divalidasi oleh
// env.js, bukan ke database dev/produksi.
//
// transactionOptions SAMA dengan src/db.js: batas bawaan Prisma ($transaction interaktif: 2 dtk menunggu
// koneksi, 5 dtk total) terlalu ketat untuk hook setup/cleanup di Docker Desktop yang fsync-nya lambat, dan
// terbukti memunculkan P2028 "Unable to start a transaction in the given time" di hook afterEach
// (24 Sep 2026). Bukan sekadar menaikkan timeout: penyebab utamanya (TRUNCATE 100 tabel per tes) diperbaiki
// di truncateAll() di bawah.
export const testPrisma = new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 30_000 } });

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
  "fin_bank_statement_lines", "fin_bank_statements", "fin_recon_snapshots", "fin_recon_exception_reviews",
  "fin_inventory_opening_lines", "fin_inventory_openings",
  "fin_supplier_payment_allocations", "fin_supplier_payments", "fin_supplier_bills",
  "fin_payment_allocations", "fin_refunds", "fin_expenses",
  // "Terapkan Uang Muka" (D-XXX, 22 September 2026) — WAJIB sebelum
  // fin_purchases: FK advance_purchase_id/target_purchase_id menunjuk ke
  // fin_purchases dengan onDelete Restrict (bukan Cascade — jurnalnya tidak
  // boleh yatim diam-diam), jadi kalau ini luput, TRUNCATE fin_purchases
  // akan gagal FK constraint begitu ada baris penerapan DP tersisa dari test
  // sebelumnya (urutan di sini tidak masalah karena TRUNCATE...CASCADE satu
  // statement, tapi baris ini TETAP wajib ADA, lihat komentar di kepala file).
  "fin_purchase_advance_applications", "fin_purchases", "fin_kasbon_repayments", "fin_kasbon", "fin_other_incomes",
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
  // Finance Android S0: sesi mobile, token push perangkat, kunci idempotency.
  "api_idempotency_keys", "mobile_device_tokens", "mobile_sessions", "mobile_notification_prefs",
  // Pemasukan terpadu: register pendapatan historis (Data Sebelum Sistem).
  "fin_legacy_revenues", "fin_legacy_batches",
  // Delivery Hub (22 September 2026, myJobsRouteCentric.integration.test.js)
  // — "jobs" WAJIB di-truncate eksplisit: Job.orderId/driverId FK ke
  // Order/User dgn Restrict/SetNull (BUKAN Cascade), jadi truncate Order/
  // User TIDAK otomatis membersihkan jobs peninggalannya. "routes" ikut
  // (Job.routeId -> Route juga SetNull, sama alasan). CASCADE dari baris
  // ini otomatis membersihkan job_units/job_position_pings/job_issue_logs/
  // vehicle_expenses (semua FK ke jobs/routes), tidak perlu disebut sendiri.
  "jobs", "routes",
  // Audit insentif driver (23 September 2026,
  // incentiveSummary.integration.test.js) — Job.complaintCaseId FK ke
  // ComplaintCase (SetNull), jadi baris uji yang membuat ComplaintCase
  // untuk menguji exclude "redelivery dari komplain" perlu ditruncate
  // eksplisit juga, sama alasan dengan "jobs"/"routes" di atas.
  "complaint_cases",
  // Hardening insentif driver — exclude UnitRevision (24 September 2026,
  // incentiveSummary.integration.test.js) — unit_revisions.unit_id FK ke
  // "units" (Restrict) SUDAH otomatis ikut ter-CASCADE saat "units"
  // ditruncate (child dari tabel yang di-truncate), tapi disebut EKSPLISIT
  // di sini juga demi konsistensi dokumentasi dengan complaint_cases di
  // atas — bukan strictly wajib, tapi menghindari kebingungan kalau nanti
  // "units" dihapus dari daftar ini tanpa disadari unit_revisions ikut lenyap.
  "unit_revisions",
  // Provenance UnitRevisionJobLink (24 September 2026,
  // unitRevisionJobLink.integration.test.js) — child dari "jobs" DAN
  // "unit_revisions" (keduanya sudah di daftar ini), sama alasan dokumentasi
  // dengan baris di atas.
  "unit_revision_job_links",
  // Snapshot Insentif Driver (24 September 2026,
  // incentiveSnapshot.integration.test.js) — incentive_source_claims dan
  // incentive_snapshot_details/lines adalah child dari incentive_snapshots
  // (sudah otomatis ikut ter-CASCADE), disebut eksplisit demi konsistensi
  // dokumentasi sama seperti baris-baris di atas.
  "incentive_source_claims", "incentive_snapshot_details", "incentive_snapshot_lines",
  // Pembayaran Insentif (24 September 2026,
  // incentivePayout.integration.test.js) — incentive_payouts child dari
  // incentive_snapshots DAN incentive_snapshot_lines (keduanya di daftar
  // ini), sama alasan dokumentasi dengan baris-baris di atas.
  "incentive_payouts", "incentive_snapshots",
  // Production + Delivery V2 command/read model. These tables are not all
  // FK-cascaded from jobs/routes (notably command/outbox/feed), so test
  // isolation must clear them explicitly.
  "driver_devices_v2", "driver_sync_events_v2", "driver_feed_states_v2",
  "route_stop_assignments_v2", "route_publications_v2",
  "delivery_job_cancellations_v2", "delivery_job_states_v2", "delivery_route_states_v2",
  "v2_shadow_comparisons", "v2_migration_exceptions", "v2_migration_runs",
  "domain_outbox", "v2_commands",
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
  // PENYEBAB KONTENSI (diukur 24 Sep 2026): TRUNCATE ~100 tabel SETIAP tes memakan 12-17 detik di Postgres
  // Docker (tiap TRUNCATE membuat relfilenode baru + fsync; 100 tabel = 100 fsync), padahal mayoritas tabel
  // kosong. Itu mendominasi durasi tes, memperpanjang jendela kunci ACCESS EXCLUSIVE, dan memicu P2028 saat
  // mesin ramai. Sekarang hanya tabel yang BERISI baris yang di-TRUNCATE (pemeriksaan EXISTS per tabel
  // murah, satu round-trip). CASCADE tetap menjangkau tabel anak yang berisi. Hasil akhirnya sama: database
  // kosong.
  const berisi = await testPrisma.$queryRawUnsafe(
    `SELECT t AS nama FROM unnest($1::text[]) AS t
     WHERE (xpath('/row/c/text()', query_to_xml(format('select exists(select 1 from %I) as c', t), false, true, '')))[1]::text::boolean`,
    TABLES_TO_TRUNCATE,
  );
  if (berisi.length === 0) return;
  const list = berisi.map((r) => `"${String(r.nama).replace(/"/g, '""')}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
