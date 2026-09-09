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

// productionStatus (Production Core Slice 1) — kosakata KANONIK level-unit
// dari backend/src/lib/domain/productionState.js (PRODUCTION_STATUS),
// dikembalikan sebagai field `productionStatus` di GET /units/:id,
// /units/:id/timeline, /production/board, /production/work-orders, dan
// /production/qc-queue. TERPISAH dari UNIT_STATUS_REAL di atas (itu enum
// UnitStatus KASAR — RECEIVED/IN_PRODUCTION/dst) dan dari STAGE_LOG_STATUS
// di bawah (itu status SATU baris tahap) — tiga sumbu berbeda, JANGAN
// digabung jadi satu badge.
export const PRODUCTION_STATUS_REAL = {
  NOT_STARTED: { label: "Belum Masuk Alur",  tone: "neutral" },
  QUEUED:      { label: "Menunggu Dikerjakan", tone: "neutral" },
  IN_PROGRESS: { label: "Sedang Dikerjakan", tone: "accent" },
  PAUSED:      { label: "Dijeda",            tone: "orange" },
  BLOCKED:     { label: "Terhambat",         tone: "red" },
  WAITING_QC:  { label: "Menunggu QC",       tone: "orange" },
  REWORK:      { label: "Dikerjakan Ulang",  tone: "orange" },
  COMPLETED:   { label: "Selesai",           tone: "green" },
  CANCELLED:   { label: "Dibatalkan",        tone: "neutral" },
};

// enum ProductionPriority (schema.prisma, Production Core Slice 1) — 4
// nilai, default NORMAL. TERPISAH dari status (spec: prioritas tidak boleh
// disimpulkan dari status apa pun, murni keputusan manusia lewat
// PATCH /units/:id/production).
export const PRODUCTION_PRIORITY_REAL = {
  NORMAL:   { label: "Normal",   tone: "neutral" },
  HIGH:     { label: "Tinggi",   tone: "accent" },
  URGENT:   { label: "Mendesak", tone: "orange" },
  CRITICAL: { label: "Kritis",   tone: "red" },
};

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
// PAUSED ditambah Production Core Slice 3 (deriveStageLogStatus di backend)
// — TERPISAH dari BLOCKED (lihat catatan panjang di
// backend/src/lib/domain/stageExecution.js soal kenapa dua state ini tidak
// boleh saling tertukar).
export const STAGE_LOG_STATUS = {
  NOT_STARTED: { label: "Belum Dimulai", tone: "neutral" },
  IN_PROGRESS: { label: "Sedang Berjalan", tone: "accent" },
  PAUSED:      { label: "Dijeda",         tone: "orange" },
  BLOCKED:     { label: "Terhambat",      tone: "red" },
  DONE:        { label: "Selesai",        tone: "green" },
  SKIPPED:     { label: "Dilewati",       tone: "neutral" },
};

// enum PauseReason (Production Core Slice 3, schema.prisma) — daftar SEMPIT
// SENGAJA (3 nilai) dan TIDAK OVERLAP dengan BLOCK_REASON_REAL di bawah —
// kalau kendalanya eksternal (bahan/alat/approval/dst), itu "Tandai
// Terhambat" (BLOCK_REASON_REAL), BUKAN jeda.
export const PAUSE_REASON_REAL = {
  BREAK:         { label: "Istirahat" },
  PROCESS_DELAY: { label: "Menunggu Proses" },
  OTHER:         { label: "Lainnya" },
};

// enum BlockReason (PRD §6.2) — WAJIB diisi saat menggagalkan tahap.
export const BLOCK_REASON_REAL = {
  MATERIAL_SHORTAGE:          { label: "Bahan Habis" },
  AWAITING_CUSTOMER_APPROVAL: { label: "Menunggu Persetujuan Pelanggan" },
  MACHINE_DOWN:               { label: "Mesin/Alat Rusak" },
  QUALITY_ISSUE:              { label: "Masalah Kualitas" },
  OTHER:                      { label: "Lainnya" },
  // Ditambah Production Core Slice 2 — lihat schema.prisma enum BlockReason.
  AWAITING_CUSTOMER: { label: "Menunggu Pelanggan" },
  AWAITING_OPERATOR: { label: "Menunggu Operator" },
  AWAITING_TOOL:     { label: "Menunggu Alat" },
};

// EXCEPTION_TYPE (Production Core Slice 2D) — cermin FRONTEND dari
// backend/src/lib/domain/productionExceptions.js. Dipakai Command Center
// ("Perlu Perhatian") — pola SAMA dengan map lain di file ini: HANYA nilai
// yang benar-benar dikirim backend.
export const EXCEPTION_TYPE_REAL = {
  OVERDUE:          { label: "Overdue",         tone: "red" },
  AT_RISK:          { label: "At Risk",         tone: "orange" },
  BLOCKED:          { label: "Blocked",         tone: "red" },
  WAITING_APPROVAL: { label: "Waiting Approval", tone: "orange" },
  REWORK:           { label: "Rework",          tone: "orange" },
};

// SEVERITY (Production Core Slice 2) — model severity TUNGGAL terpusat,
// dipakai badge exception di Command Center. JANGAN membuat kosakata
// severity kedua di komponen lain.
export const SEVERITY_REAL = {
  CRITICAL: { label: "Critical", tone: "red" },
  HIGH:     { label: "High",     tone: "red" },
  WARNING:  { label: "Warning",  tone: "orange" },
  INFO:     { label: "Info",     tone: "neutral" },
};

// Workspace health level (Production Core Slice 2F) — dipakai Command
// Center, cermin deriveWorkspaceHealth() di backend.
export const WORKSPACE_HEALTH_REAL = {
  STABLE:    { label: "Stabil",         tone: "ok" },
  ATTENTION: { label: "Perlu Perhatian", tone: "warn" },
  CRITICAL:  { label: "Kritis",         tone: "critical" },
};

// enum FitVerdict & PreferenceOverride (D-005, D-009) — Uji Berat Badan.
export const FIT_VERDICT_REAL = {
  TERLALU_KERAS: { label: "Terlalu Keras", tone: "red" },
  PAS:           { label: "Pas",            tone: "green" },
  TERLALU_EMPUK: { label: "Terlalu Empuk",  tone: "red" },
};
export const PREFERENCE_OVERRIDE_REAL = {
  LEBIH_KERAS: { label: "Pelanggan Minta Lebih Keras" },
  LEBIH_EMPUK: { label: "Pelanggan Minta Lebih Empuk" },
};

// enum ScopeRevisionStatus & ScopeRevisionVia (PRD §7.4, D-008) — Revisi
// Lingkup (Production Tahap 4).
export const SCOPE_REVISION_STATUS_REAL = {
  PENDING:  { label: "Menunggu Jawaban", tone: "orange" },
  APPROVED: { label: "Disetujui",        tone: "green" },
  REJECTED: { label: "Ditolak",          tone: "red" },
  PARTIAL:  { label: "Setuju Sebagian",  tone: "accent" },
};
export const SCOPE_REVISION_VIA_REAL = {
  WHATSAPP: { label: "WhatsApp" },
  TELEPON:  { label: "Telepon" },
  LANGSUNG: { label: "Langsung" },
  LAINNYA:  { label: "Lainnya" },
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
