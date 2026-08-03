// Peta status & lini unit NYATA — dari enum backend (prisma/schema.prisma),
// BUKAN karangan mockup.
//
// Pola yang sama dengan jobStatus.js (Delivery) dan inventoryReal.js
// (Warehouse): file ini HANYA berisi nilai yang benar-benar ada di
// database, supaya filter di halaman berdata nyata tidak pernah
// menawarkan pilihan yang mustahil cocok.

// enum UnitStatus — 9 nilai, apa adanya di schema.
export const UNIT_STATUS_REAL = {
  AWAITING_PICKUP:        { label: "Menunggu Dijemput",   tone: "neutral" },
  IN_TRANSIT_IN:          { label: "Dalam Perjalanan Masuk", tone: "accent" },
  RECEIVED:               { label: "Diterima Bengkel",    tone: "accent" },
  IN_PRODUCTION:          { label: "Sedang Dikerjakan",   tone: "accent" },
  READY_FOR_DELIVERY:     { label: "Siap Dikirim",        tone: "green" },
  READY_ON_CUSTOMER_HOLD: { label: "Ditahan Pelanggan",   tone: "orange" },
  IN_TRANSIT_OUT:         { label: "Dalam Pengiriman",    tone: "accent" },
  DELIVERED:              { label: "Terkirim",            tone: "green" },
  CANCELLED:              { label: "Dibatalkan",          tone: "neutral" },
};

// Status yang dianggap "ada di bengkel" — SAMA dengan IN_WORKSHOP di
// backend/src/routes/production.js. Dipakai tab "Di Bengkel".
export const IN_WORKSHOP_STATUSES = ["RECEIVED", "IN_PRODUCTION"];

// enum ServiceLine — D-004: dua lini tidak boleh campur material.
export const SERVICE_LINE_REAL = {
  SERVICE: { label: "Service", tone: "accent" },
  UPGRADE: { label: "Upgrade", tone: "accent" },
};

// enum StagePhase — urutan besar routing (D-003).
export const STAGE_PHASE_REAL = {
  INTAKE: { label: "Intake" },
  MODULE: { label: "Modul Kerja" },
  FINISH: { label: "Finishing" },
};

// Status per tahap di timeline (Production Tahap 2) — DITURUNKAN dari
// unit_stage_logs (lihat GET /units/:id/timeline), bukan kolom tersimpan.
export const STAGE_LOG_STATUS = {
  NOT_STARTED: { label: "Belum Dimulai", tone: "neutral" },
  IN_PROGRESS: { label: "Sedang Berjalan", tone: "accent" },
  BLOCKED:     { label: "Terhambat",      tone: "red" },
  DONE:        { label: "Selesai",        tone: "green" },
  SKIPPED:     { label: "Dilewati",       tone: "neutral" },
};

// enum BlockReason (PRD §6.2) — WAJIB diisi saat menggagalkan tahap.
export const BLOCK_REASON_REAL = {
  MATERIAL_SHORTAGE:          { label: "Bahan Habis" },
  AWAITING_CUSTOMER_APPROVAL: { label: "Menunggu Persetujuan Pelanggan" },
  MACHINE_DOWN:               { label: "Mesin Rusak" },
  QUALITY_ISSUE:              { label: "Masalah Kualitas" },
  OTHER:                      { label: "Lainnya" },
};

/**
 * KENYATAAN DATA YANG HARUS DIINGAT — ditulis di sini supaya tidak hilang.
 *
 * Diverifikasi langsung di production (2 Agustus 2026): 199 unit ada
 * dengan status NYATA, TAPI `serviceId`, `serviceLine`, dan
 * `currentStageId` NULL di SELURUH 199 baris. Unit di-backfill dari Order
 * ("PHASE 0" di schema.prisma) dan BELUM PERNAH masuk stage engine —
 * `unit_stage_logs` masih 0 baris.
 *
 * Konsekuensinya untuk UI: kolom Layanan & Tahap akan kosong untuk hampir
 * semua unit. Itu JUJUR, bukan bug — jangan diisi tebakan. Unit baru bisa
 * punya tahap setelah diadopsi ke engine (Tahap 2: set lini layanan lewat
 * PATCH /units/:id/service, lalu mulai tahap pertamanya).
 */
export const UNITS_NOT_YET_IN_ENGINE = true;
