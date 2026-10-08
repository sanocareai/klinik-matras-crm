// Peta status & lini unit NYATA — dari enum backend (prisma/schema.prisma),
// BUKAN karangan mockup.
//
// Pola yang sama dengan jobStatus.js (Delivery) dan inventoryReal.js
// (Warehouse): file ini HANYA berisi nilai yang benar-benar ada di
// database, supaya filter di halaman berdata nyata tidak pernah
// menawarkan pilihan yang mustahil cocok.

// enum UnitStatus — 9 nilai, apa adanya di schema.
// Simplifikasi Production slice 1: SATU kosakata status — Pengambilan · Diproses · Siap Kirim · Terkirim (cermin backend/src/lib/domain/productionDisplay.js, dijaga tes paritas).
// Ini status ORDER/UNIT saja; keberadaan fisik (belum tiba / di workshop) dan tahap pengerjaan ditampilkan TERPISAH, tidak dicampur ke badge ini.
export const UNIT_STATUS_REAL = {
  AWAITING_PICKUP:        { label: "Pengambilan",  tone: "neutral", detail: "Menunggu dijemput" },
  IN_TRANSIT_IN:          { label: "Pengambilan",  tone: "neutral", detail: "Dalam perjalanan ke workshop" },
  RECEIVED:               { label: "Diproses",     tone: "accent" },
  IN_PRODUCTION:          { label: "Diproses",     tone: "accent" },
  READY_FOR_DELIVERY:     { label: "Siap Kirim",   tone: "green" },
  READY_ON_CUSTOMER_HOLD: { label: "Siap Kirim",   tone: "orange", detail: "Ditahan pelanggan" },
  IN_TRANSIT_OUT:         { label: "Siap Kirim",   tone: "green", detail: "Dalam pengiriman" },
  DELIVERED:              { label: "Terkirim",     tone: "green" },
  CANCELLED:              { label: "Dibatalkan",   tone: "neutral" },
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
  BLOCKED:     { label: "Pekerjaan Tertunda", tone: "red" },
  WAITING_QC:  { label: "Menunggu QC",       tone: "orange" },
  REWORK:      { label: "Dikerjakan Ulang",  tone: "orange" },
  COMPLETED:   { label: "Selesai",           tone: "green" },
  CANCELLED:   { label: "Dibatalkan",        tone: "neutral" },
};

// enum ProductionPriority (schema.prisma, Production Core Slice 1) — 4
// nilai, default NORMAL. TERPISAH dari status (spec: prioritas tidak boleh
// disimpulkan dari status apa pun, murni keputusan manusia lewat
// PATCH /units/:id/production).
// Prioritas pengguna: Normal · Tinggi · Komplain. Nilai lama Mendesak/Kritis HANYA ditampilkan Tinggi (data tersimpan tidak diubah). Komplain = turunan ComplaintCase resmi dari server (priorityDisplay), bukan enum ini.
export const PRODUCTION_PRIORITY_REAL = {
  NORMAL:   { label: "Normal",   tone: "neutral" },
  HIGH:     { label: "Tinggi",   tone: "orange" },
  URGENT:   { label: "Tinggi",   tone: "orange" },
  CRITICAL: { label: "Tinggi",   tone: "orange" },
  COMPLAINT: { label: "Komplain", tone: "red" },
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
  BLOCKED:     { label: "Tertunda",       tone: "red" },
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
// Bahasa sederhana (slice 1): 8 nilai enum DITAMPILKAN sebagai 4 alasan "Pekerjaan Tertunda" (pemetaan di productionLabels.js, paritas dengan backend).
export const BLOCK_REASON_REAL = {
  MATERIAL_SHORTAGE:          { label: "Menunggu bahan" },
  AWAITING_CUSTOMER_APPROVAL: { label: "Menunggu arahan" },
  AWAITING_CUSTOMER:          { label: "Menunggu arahan" },
  AWAITING_OPERATOR:          { label: "Menunggu arahan" },
  MACHINE_DOWN:               { label: "Kendala pengerjaan" },
  QUALITY_ISSUE:              { label: "Kendala pengerjaan" },
  AWAITING_TOOL:              { label: "Kendala pengerjaan" },
  OTHER:                      { label: "Lainnya" },
};

// EXCEPTION_TYPE (Production Core Slice 2D) — cermin FRONTEND dari
// backend/src/lib/domain/productionExceptions.js. Dipakai Command Center
// ("Perlu Perhatian") — pola SAMA dengan map lain di file ini: HANYA nilai
// yang benar-benar dikirim backend.
export const EXCEPTION_TYPE_REAL = {
  OVERDUE:          { label: "Overdue",         tone: "red" },
  AT_RISK:          { label: "At Risk",         tone: "orange" },
  BLOCKED:          { label: "Pekerjaan Tertunda", tone: "red" },
  WAITING_APPROVAL: { label: "Menunggu arahan", tone: "orange" },
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
