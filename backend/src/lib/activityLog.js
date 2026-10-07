// Aktivitas lintas entitas — lapisan audit/linimasa GENERIK (Production
// Core Slice 1). Lihat catatan panjang di schema.prisma model ActivityEvent
// untuk kenapa tabel ini ADA DI SAMPING (bukan pengganti) unit_stage_logs,
// order_status_transitions, dkk.
//
// ATURAN TUNGGAL: recordActivity() WAJIB dipanggil DI DALAM transaksi Prisma
// yang sama dengan mutasi yang direkamnya (`tx`, bukan `prisma` langsung).
// Konsekuensinya dua arah dan keduanya disengaja:
//   - mutasi gagal -> baris aktivitas ikut batal (tidak ada audit palsu
//     untuk sesuatu yang sebenarnya tidak terjadi)
//   - insert aktivitas gagal -> SELURUH mutasi batal (audit bukan "usaha
//     terbaik" untuk perubahan yang harus tercatat; kalau ini kerap gagal
//     dalam praktik, perbaiki modelnya, jangan pindahkan ke luar transaksi)

import { BLOCK_REASON_LABEL } from "./domain/productionExceptions.js";

export const ENTITY_TYPES = Object.freeze({
  UNIT: "unit",
  ORDER: "order",
  PRODUCTION_SETTING: "production_setting", // Slice 2 — pengaturan Admin Production
  // Audit Gudang & Inventory (12 Sept 2026) — MATERIAL untuk perubahan data
  // master (reorderPoint/kategori/aktif-nonaktif, sebelumnya tidak
  // tercatat SAMA SEKALI), sisanya satu entityType per jenis dokumen
  // proses (Goods Receipt, Material Issue, dst) untuk keputusan
  // approve/reject/cancel/post/complete — StockMovement sendiri SUDAH
  // jadi ledger lengkap (who/when/why per baris), jadi di sini HANYA
  // titik keputusan manusia yang direkam, bukan tiap penulisan ledger.
  MATERIAL: "material",
  GOODS_RECEIPT: "goods_receipt",
  MATERIAL_ISSUE: "material_issue",
  STOCK_TRANSFER: "stock_transfer",
  STOCK_COUNT: "stock_count",
  DAMAGED_STOCK: "damaged_stock",
  RETURN_RECORD: "return_record",
  STOCK_ADJUSTMENT: "stock_adjustment",
  REPLENISHMENT: "replenishment",
  // Complaint / After-Sales Case lintas divisi (D-116, 11 September 2026) —
  // lihat catatan panjang di schema.prisma model ComplaintCase.
  COMPLAINT: "complaint",
  // Finance Workspace (D-180, 17 September 2026). Jurnal sendiri SUDAH
  // jadi ledger lengkap (siapa/kapan/apa per baris) — yang direkam di sini
  // HANYA titik KEPUTUSAN MANUSIA di sekitarnya: menyetujui pengeluaran/
  // tagihan/refund, membalik jurnal terposting, menutup & membuka periode,
  // dan mengubah bagan akun. Pola persis sama dengan dokumen gudang di atas.
  FIN_JOURNAL: "fin_journal",
  FIN_EXPENSE: "fin_expense",
  FIN_PURCHASE: "fin_purchase",
  FIN_KASBON: "fin_kasbon",
  FIN_PENJUALAN_KARYAWAN: "fin_penjualan_karyawan",
  FIN_UANG_MUKA: "fin_uang_muka",
  // Pembayaran pelanggan (Finance Mobile S5): verifikasi & penolakan Payment.
  PAYMENT: "payment",
  FIN_SUPPLIER_BILL: "fin_supplier_bill",
  FIN_REFUND: "fin_refund",
  FIN_PERIOD: "fin_period",
  FIN_ACCOUNT: "fin_account",
  FIN_SETTING: "fin_setting",
  FIN_DIVISION_BUDGET: "fin_division_budget", // Fase 2 Laporan Divisi — versi anggaran divisi
  FIN_INVENTORY_OPENING: "fin_inventory_opening", // B3.6 snapshot stok & persediaan awal
  // Koreksi transaksi finance (17 Sept 2026, permintaan owner: sistem baru
  // mulai dipakai, wajar ada salah input, tapi tidak boleh diam-diam
  // menimpa angka yang sudah diposting) — lihat DOCUMENT_CORRECTED di
  // bawah. Dua entity type baru untuk dua dokumen yang SEBELUMNYA tidak
  // pernah butuh dicatat di sini sendiri-sendiri (transfer & pemasukan
  // lain langsung posting tanpa approval, beda dari expense/bill/refund).
  FIN_CASH_TRANSFER: "fin_cash_transfer",
  FIN_OTHER_INCOME: "fin_other_income",
  // Rekonsiliasi bank: pencocokan/pelepasan baris koran dengan mutasi buku (S9).
  FIN_BANK_STATEMENT: "fin_bank_statement",
  // Rekonsiliasi Bank V2 (15 Okt 2026): impor rekening koran, pencocokan, pengecualian, hitung fisik kas, penyelesaian periode. entityId = id rekening kas/bank, kelompok pencocokan, batch, atau periode.
  FIN_BANK_REKON: "fin_bank_rekon",
  FIN_LEGACY_BATCH: "fin_legacy_batch", // Data Sebelum Sistem (register pendapatan historis non-posting)
  // Hardening insentif driver (23 September 2026) — koreksi admin atas
  // driver/helper/completedAt POD (PATCH /armada/pod/:jobId/edit) LANGSUNG
  // mengubah angka insentif periode lampau (live recompute dari field ini,
  // lihat GET /armada/incentive-summary), tapi sebelumnya cuma tercatat
  // sebagai teks bebas podEditReason — tidak ada nilai LAMA yang bisa
  // ditelusuri. JOB baru di sini, pola sama dengan MATERIAL/ORDER dst.
  JOB: "job",
  // Audit hasSim (24 September 2026) — PATCH /armada/drivers/:id adalah
  // SATU-SATUNYA jalur tulis User.hasSim di seluruh backend (dicek lewat
  // grep sebelum menambah ini), tapi sebelumnya tidak tercatat sama
  // sekali walau field ini LANGSUNG mengubah tarif insentif (Rp7.000 vs
  // Rp3.000/alamat, live recompute — lihat GET /armada/incentive-summary).
  // entityId = user yang statusnya berubah (bukan pelaku — itu actorId).
  USER: "user",
  // Snapshot Insentif Driver (24 September 2026) — entityId = id Snapshot.
  INCENTIVE_SNAPSHOT: "incentive_snapshot",
  // Pembayaran Insentif (24 September 2026) — entityId = id IncentivePayout.
  INCENTIVE_PAYOUT: "incentive_payout",
});

export const EVENT_TYPES = Object.freeze({
  PRIORITY_CHANGED: "PRIORITY_CHANGED",
  // Usulan Prioritas Pagi (Route Planner -> Produksi, 3 Oktober 2026) — lihat
  // model MorningPriorityRequest di schema.prisma dan services/morningPriority.js.
  // Entity-nya ORDER (usulan ini bicara soal order, bukan satu unit tertentu);
  // perubahan Unit.priority yang terjadi saat disetujui TETAP memakai
  // PRIORITY_CHANGED di atas, dicatat ber-entity UNIT seperti biasa.
  MORNING_PRIORITY_REQUESTED: "MORNING_PRIORITY_REQUESTED",
  MORNING_PRIORITY_APPROVED: "MORNING_PRIORITY_APPROVED",
  MORNING_PRIORITY_DISMISSED: "MORNING_PRIORITY_DISMISSED",
  DUE_DATE_CHANGED: "DUE_DATE_CHANGED",
  SERVICE_ASSIGNED: "SERVICE_ASSIGNED",
  // Production Core Slice 2 — lifecycle ProductionBlocker.
  PRODUCTION_BLOCKED: "PRODUCTION_BLOCKED",
  PRODUCTION_BLOCKER_RESOLVED: "PRODUCTION_BLOCKER_RESOLVED",
  // Production Core Slice 3 — eksekusi tahap (unitStageEngine.js
  // startStage/pauseStage/resumeStage/finishStageInternal). SENGAJA TIDAK
  // ada STAGE_FAILED terpisah — kegagalan tahap SUDAH tercatat lewat
  // PRODUCTION_BLOCKED (satu narasi per kejadian nyata, bukan dua entri
  // untuk momen yang sama — lihat failStage()).
  STAGE_STARTED: "STAGE_STARTED",
  STAGE_PAUSED: "STAGE_PAUSED",
  STAGE_RESUMED: "STAGE_RESUMED",
  STAGE_COMPLETED: "STAGE_COMPLETED",
  // Bypass administratif SELURUH pipeline produksi (8 September 2026,
  // permintaan owner — lihat unitStageEngine.js#adminBypassProduction).
  // SENGAJA satu event untuk seluruh pipeline, BUKAN satu STAGE_COMPLETED
  // per tahap — menulis 8 baris "selesai" palsu tanpa foto/QC sungguhan
  // akan membuat linimasa terlihat seperti produksi normal berjalan
  // lengkap, padahal tidak. Kejujuran ledger lebih penting dari
  // kelengkapan tampilan.
  PRODUCTION_ADMIN_BYPASS: "PRODUCTION_ADMIN_BYPASS",
  // Production Core Slice 4 — Route/Work Center/Operator (lihat
  // services/productionRouting.js). ROUTE_CHANGED SENGAJA tidak dipisah
  // dari ROUTE_ASSIGNED (pola sama dengan PRIORITY_CHANGED/DUE_DATE_CHANGED
  // — satu event, from/to di metadata) — penetapan PERTAMA dan pergantian
  // rute sama-sama "rute unit ini sekarang X", bedanya cuma isi `from`.
  ROUTE_ASSIGNED: "ROUTE_ASSIGNED",
  WORK_CENTER_ASSIGNED: "WORK_CENTER_ASSIGNED",
  OPERATOR_ASSIGNED: "OPERATOR_ASSIGNED",
  OPERATOR_REASSIGNED: "OPERATOR_REASSIGNED",
  OPERATOR_UNASSIGNED: "OPERATOR_UNASSIGNED",

  // Audit Gudang & Inventory (12 Sept 2026). MATERIAL_UPDATED = satu event
  // generik untuk PATCH /materials/:id (from/to per field yang berubah di
  // metadata) — sebelumnya edit reorderPoint/kategori/aktif-nonaktif tidak
  // tercatat sama sekali, siapa saja bisa menimpa diam-diam.
  MATERIAL_UPDATED: "MATERIAL_UPDATED",
  // Satu event generik per titik keputusan dokumen proses (approve/reject/
  // cancel/post/complete/putaway) — nama dokumennya sendiri sudah ada di
  // entityType (GOODS_RECEIPT/MATERIAL_ISSUE/dst), jadi eventType di sini
  // fokus ke JENIS keputusannya, bukan diulang per dokumen (pola sama
  // dengan STAGE_STARTED/dst yang generik lintas tahap produksi).
  DOCUMENT_APPROVED: "DOCUMENT_APPROVED",
  DOCUMENT_REJECTED: "DOCUMENT_REJECTED",
  // Finance meminta bukti pembayaran atas order yang ditandai Lunas oleh Sales (Perlu Verifikasi Finance). Tidak mengubah status/keuangan apa pun.
  BUKTI_DIMINTA: "BUKTI_DIMINTA",
  // Klaim Lunas Sales (1 Okt 2026): satu event generik per titik keputusan klaim; jenisnya ada di metadata.aksi
  // (draft_dibuat | diajukan | diajukan_ulang | bukti_ditambah | bukti_dihapus | bukti_diminta | ditolak | diverifikasi | ditarik | ubah_pemilik).
  KLAIM_LUNAS: "KLAIM_LUNAS",
  // Penjualan Karyawan (1 Okt 2026): penanda karyawan non-Sales yang menjual sebuah order diubah (metadata: before/to = nama karyawan).
  PENJUALAN_KARYAWAN_DIUBAH: "PENJUALAN_KARYAWAN_DIUBAH",
  BANK_REKON_V2: "BANK_REKON_V2", // metadata.aksi: impor | impor_dibatalkan | cocok | cocok_dibatalkan | dikecualikan | opname | periode_selesai | periode_dibatalkan — services/finance/bankRekon/
  PAIDAT_PENGECUALIAN: "PAIDAT_PENGECUALIAN", // pengecualian tanggal lunas (Order.paidAt) dibuat/dicabut oleh Owner — services/pengecualianPaidAt.js
  // Custody unit Gudang V2 (P1–P2): serah-terima Delivery <-> Gudang. Detail (unit, arah, lokasi, alasan) ada di metadata.
  CUSTODY_OFFERED: "CUSTODY_OFFERED",
  CUSTODY_ACCEPTED: "CUSTODY_ACCEPTED",
  CUSTODY_REJECTED: "CUSTODY_REJECTED",
  CUSTODY_ROLLED_BACK: "CUSTODY_ROLLED_BACK",
  // Planning Produksi H-1 V2 (P3): rencana kerja per Unit, assignment workshop/operator, Planned BOM, reservasi
  // bahan Gudang. Detail (planId, workshop, material, dll) ada di metadata.
  PRODUCTION_PLAN_CREATED: "PRODUCTION_PLAN_CREATED",
  PRODUCTION_PLAN_ASSIGNED: "PRODUCTION_PLAN_ASSIGNED",
  PRODUCTION_PLAN_BOM_SET: "PRODUCTION_PLAN_BOM_SET",
  PRODUCTION_PLAN_MATERIAL_RESERVED: "PRODUCTION_PLAN_MATERIAL_RESERVED",
  PRODUCTION_PLAN_CANCELLED: "PRODUCTION_PLAN_CANCELLED",
  // Diagnosis Produksi + Planned BOM Terpadu (P9D): hasil bongkar + layanan teknis + Planned BOM dalam satu
  // wizard. Detail (findings ringkas, jumlah bahan, dll) ada di metadata — TIDAK menyalin seluruh findings JSON.
  PRODUCTION_DIAGNOSIS_SUBMITTED: "PRODUCTION_DIAGNOSIS_SUBMITTED",
  PRODUCTION_DIAGNOSIS_MANUAL_MATERIAL_MAPPED: "PRODUCTION_DIAGNOSIS_MANUAL_MATERIAL_MAPPED",
  // Pengambilan Bahan Produksi V2 (P4): permintaan dari Plan MATERIAL_RESERVED, PICKED oleh Gudang (stok fisik
  // berkurang + reservasi CONSUMED), atau dibatalkan sebelum PICKED (reservasi dilepas).
  PRODUCTION_MATERIAL_ISSUE_REQUESTED: "PRODUCTION_MATERIAL_ISSUE_REQUESTED",
  PRODUCTION_MATERIAL_ISSUE_PICKED: "PRODUCTION_MATERIAL_ISSUE_PICKED",
  PRODUCTION_MATERIAL_ISSUE_CANCELLED: "PRODUCTION_MATERIAL_ISSUE_CANCELLED",
  // Eksekusi Workshop V2 (P5): unit BARU/SEWA didaftarkan lahir di workshop; run selesai tahap workshop -> menunggu QC.
  PRODUCTION_WORKSHOP_RUN_REGISTERED: "PRODUCTION_WORKSHOP_RUN_REGISTERED",
  PRODUCTION_WORKSHOP_AWAITING_QC: "PRODUCTION_WORKSHOP_AWAITING_QC",
  // Rencana Produksi order nyata: Run dibuka (belum tiba) saat Jadwalkan; kedatangan fisik tanpa custody dikonfirmasi eksplisit.
  PRODUCTION_RUN_ONBOARDED_RENCANA: "PRODUCTION_RUN_ONBOARDED_RENCANA",
  PRODUCTION_ARRIVAL_CONFIRMED_NO_CUSTODY: "PRODUCTION_ARRIVAL_CONFIRMED_NO_CUSTODY",
  // QC V2, rework, barang jadi, dan rekonsiliasi override V1 (P6). Detail (hasil, inspeksi, alasan) ada di metadata.
  PRODUCTION_QC_RECORDED: "PRODUCTION_QC_RECORDED",
  PRODUCTION_QC_WAIVED: "PRODUCTION_QC_WAIVED",
  PRODUCTION_REWORK_OPENED: "PRODUCTION_REWORK_OPENED",
  PRODUCTION_HANDOFF_ACTION: "PRODUCTION_HANDOFF_ACTION",
  PRODUCTION_RUN_COMPLETED: "PRODUCTION_RUN_COMPLETED",
  PRODUCTION_RUN_CANCELLED: "PRODUCTION_RUN_CANCELLED",
  PRODUCTION_RUN_EXCEPTION_OPENED: "PRODUCTION_RUN_EXCEPTION_OPENED",
  PRODUCTION_RUN_EXCEPTION_RESOLVED: "PRODUCTION_RUN_EXCEPTION_RESOLVED",
  // P12B.6 — aksi V1 yang ditulis saat unit punya Production Run non-terminal TETAPI V2 tidak memegang eksekusi (writer OFF/rollback): penanda drift proyeksi.
  // Command V2 berhenti (409 PRODUCTION_RUN_V1_DRIFT) sampai Run dibatalkan (rekonsiliasi). Lihat services/unitV2Ownership.js.
  PRODUCTION_V1_WRITE_ON_V2_RUN: "PRODUCTION_V1_WRITE_ON_V2_RUN",
  // P8 — bukti tahap PIC Table/Corner dan "Menunggu Bahan Baku".
  PRODUCTION_STEP_RECORDED: "PRODUCTION_STEP_RECORDED",
  PRODUCTION_MATERIAL_SHORTAGE_REPORTED: "PRODUCTION_MATERIAL_SHORTAGE_REPORTED",
  PRODUCTION_MATERIAL_SHORTAGE_RESOLVED: "PRODUCTION_MATERIAL_SHORTAGE_RESOLVED",
  // Urutan manual unit per meja + antrean retur sisa bahan (migration 20261012100000).
  PRODUCTION_STATION_REORDERED: "PRODUCTION_STATION_REORDERED",
  PRODUCTION_MATERIAL_RETURN_REQUESTED: "PRODUCTION_MATERIAL_RETURN_REQUESTED",
  PRODUCTION_MATERIAL_RETURN_RECEIVED: "PRODUCTION_MATERIAL_RETURN_RECEIVED",
  // Slice 2 (flow adaptasi): tahap dilewati (SKIPPED), QC tidak dilakukan, produksi diselesaikan lewat adaptasi, kebijakan adaptasi diterapkan, Tunda/Lanjutkan Pekerjaan di papan, pengaturan Admin.
  PRODUCTION_STEP_SKIPPED: "PRODUCTION_STEP_SKIPPED",
  // Jalur Pengerjaan Pesanan: PIC Bahan per pekerjaan, kebutuhan Corner, catatan racikan/pemakaian bahan.
  PRODUCTION_BUILD_MATERIAL_OPERATOR_SET: "PRODUCTION_BUILD_MATERIAL_OPERATOR_SET",
  PRODUCTION_BUILD_CORNER_CONFIRMED: "PRODUCTION_BUILD_CORNER_CONFIRMED",
  PRODUCTION_BUILD_MATERIALS_RECORDED: "PRODUCTION_BUILD_MATERIALS_RECORDED",
  PRODUCTION_QC_NOT_PERFORMED: "PRODUCTION_QC_NOT_PERFORMED",
  PRODUCTION_FINISHED_ADAPTATION: "PRODUCTION_FINISHED_ADAPTATION",
  PRODUCTION_ADAPTATION_APPLIED: "PRODUCTION_ADAPTATION_APPLIED",
  PRODUCTION_WORK_DELAYED: "PRODUCTION_WORK_DELAYED",
  PRODUCTION_WORK_RESUMED: "PRODUCTION_WORK_RESUMED",
  PRODUCTION_SETTING_CHANGED: "PRODUCTION_SETTING_CHANGED",
  // P10B — Aplikasi Dokumentasi (foto dokumentasi produksi; TIDAK mengubah lifecycle).
  PRODUCTION_DOCUMENTATION_ADDED: "PRODUCTION_DOCUMENTATION_ADDED",
  PRODUCTION_DOCUMENTATION_CORRECTED: "PRODUCTION_DOCUMENTATION_CORRECTED",
  // Slice 3 — Catatan Komponen kanonis per unit (informasi; tidak mengubah stok/lifecycle).
  PRODUCTION_COMPONENT_RECORDED: "PRODUCTION_COMPONENT_RECORDED",
  PRODUCTION_COMPONENT_CORRECTED: "PRODUCTION_COMPONENT_CORRECTED",
  DOCUMENT_CANCELLED: "DOCUMENT_CANCELLED",
  DOCUMENT_POSTED: "DOCUMENT_POSTED", // ledger benar-benar tertulis (putaway/issue/dispatch/receive/complete/post)

  // Complaint / After-Sales Case lintas divisi (D-116, 11 September 2026).
  // Satu event generik per titik keputusan (pola sama dengan
  // DOCUMENT_APPROVED/dst di atas) — detail "apa"/"kenapa" ada di metadata,
  // bukan diulang jadi eventType baru per kasus.
  COMPLAINT_CREATED: "COMPLAINT_CREATED",
  COMPLAINT_STATUS_CHANGED: "COMPLAINT_STATUS_CHANGED",
  COMPLAINT_DELIVERY_TASK_CREATED: "COMPLAINT_DELIVERY_TASK_CREATED",
  COMPLAINT_MATERIAL_REQUESTED: "COMPLAINT_MATERIAL_REQUESTED",
  COMPLAINT_QC_LINKED: "COMPLAINT_QC_LINKED",
  COMPLAINT_FOLLOW_UP_LOGGED: "COMPLAINT_FOLLOW_UP_LOGGED",
  COMPLAINT_CUSTOMER_CONFIRMED: "COMPLAINT_CUSTOMER_CONFIRMED",
  COMPLAINT_CANCELLED: "COMPLAINT_CANCELLED",

  // Finance (D-180). DOCUMENT_APPROVED/REJECTED/CANCELLED/POSTED di atas
  // DIPAKAI ULANG untuk dokumen finance — jenis keputusannya sama persis,
  // dan entityType sudah membedakan dokumennya. Yang BARU di bawah hanya
  // kejadian yang memang tidak punya padanan di domain lain.
  JOURNAL_REVERSED: "JOURNAL_REVERSED",
  PERIOD_CLOSED: "PERIOD_CLOSED",
  PERIOD_REOPENED: "PERIOD_REOPENED",
  FINANCE_SETTING_CHANGED: "FINANCE_SETTING_CHANGED",
  DIVISION_BUDGET_CHANGED: "DIVISION_BUDGET_CHANGED", // anggaran divisi: draf dibuat/diubah/dihapus, disetujui (menggantikan versi lama)
  CHART_OF_ACCOUNTS_CHANGED: "CHART_OF_ACCOUNTS_CHANGED",
  // Koreksi (17 Sept 2026) — admin mengubah nilai transaksi yang SUDAH
  // diposting. BUKAN edit diam-diam: jurnal lama dibalik (tetap ada,
  // tidak dihapus), jurnal baru diposting dengan nilai baru, dan baris
  // ini menyimpan before/after di metadata. DOCUMENT_EDITED terpisah
  // untuk dokumen yang MASIH draft/menunggu approval (belum menyentuh
  // buku besar sama sekali — edit langsung, tidak perlu reversal).
  DOCUMENT_CORRECTED: "DOCUMENT_CORRECTED",
  DOCUMENT_EDITED: "DOCUMENT_EDITED",

  // Hardening insentif driver (23 September 2026) — pola sama dengan
  // MATERIAL_UPDATED: satu event generik, nilai LAMA dan BARU per field
  // yang berubah (driverId/helperId/completedAt) di metadata. Cuma dicatat
  // kalau salah satu dari 3 field itu BENAR-BENAR berubah — edit yang
  // hanya mengganti foto/alasan tidak memicu event ini (lihat pemanggil).
  POD_EDITED: "POD_EDITED",
  // Audit hasSim (24 September 2026) — lihat catatan ENTITY_TYPES.USER.
  // metadata: { from, to, source } — source SENGAJA disimpan (bukan
  // ditebak dari eventType) supaya kalau suatu hari ada jalur tulis kedua
  // (mis. bulk-import), linimasa tetap bisa membedakan asalnya tanpa
  // menambah eventType baru per jalur.
  HAS_SIM_CHANGED: "HAS_SIM_CHANGED",

  // Snapshot Insentif Driver (24 September 2026) — satu event generik per
  // titik keputusan (pola sama dengan DOCUMENT_APPROVED/dst), detail di
  // metadata (periode, totalRupiah, alasan, dsb).
  INCENTIVE_SNAPSHOT_CREATED: "INCENTIVE_SNAPSHOT_CREATED",
  INCENTIVE_SNAPSHOT_REVIEWED: "INCENTIVE_SNAPSHOT_REVIEWED",
  INCENTIVE_SNAPSHOT_APPROVED: "INCENTIVE_SNAPSHOT_APPROVED",
  INCENTIVE_SNAPSHOT_REJECTED: "INCENTIVE_SNAPSHOT_REJECTED",
  // Adjustment TERCATAT di Snapshot BARU-nya sendiri lewat
  // INCENTIVE_SNAPSHOT_CREATED (metadata.adjustsSnapshotId terisi) — event
  // ini KHUSUS ditulis di Snapshot ASAL yang dikoreksi, supaya linimasa
  // Snapshot asal ikut menunjukkan "pernah dikoreksi oleh Snapshot X",
  // walau baris asalnya sendiri TIDAK PERNAH diedit.
  INCENTIVE_SNAPSHOT_ADJUSTED: "INCENTIVE_SNAPSHOT_ADJUSTED",

  // Pembayaran Insentif (24 September 2026) — metadata: { snapshotId,
  // snapshotLineId, userId, amount, method, referenceNumber, sisaSebelum,
  // sisaSesudah, reason (khusus VOID) }.
  INCENTIVE_PAYOUT_CREATED: "INCENTIVE_PAYOUT_CREATED",
  INCENTIVE_PAYOUT_VOIDED: "INCENTIVE_PAYOUT_VOIDED",
});

/**
 * Tulis satu baris aktivitas (append-only — tidak ada update/delete dari
 * kode aplikasi, sama seperti ledger lain di repo ini).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx - klien transaksi pemanggil, BUKAN `prisma` singleton
 */
export async function recordActivity(tx, {
  entityType, entityId, eventType, actorId = null, actorType = "USER", metadata = {},
} = {}) {
  if (!tx?.activityEvent) {
    throw new Error("recordActivity butuh `tx` (klien transaksi pemanggil), bukan prisma singleton di luar transaksi");
  }
  if (!entityType || !entityId || !eventType) {
    throw new Error("recordActivity butuh entityType, entityId, dan eventType");
  }
  return tx.activityEvent.create({
    data: { entityType, entityId, eventType, actorId, actorType, metadata },
  });
}

const PRIORITY_LABEL = { NORMAL: "Normal", HIGH: "Tinggi", URGENT: "Mendesak", CRITICAL: "Kritis" };
const PAUSE_REASON_LABEL = { BREAK: "Break", PROCESS_DELAY: "Process delay", OTHER: "Other" };

// "1h 10m" — dipakai kalimat STAGE_COMPLETED ("Touch time 1h 10m", contoh
// spec Slice 3G). Salinan kecil dari formatDurasiMenit frontend (utils/
// formatDate.js) — sengaja tidak diimpor lintas paket backend/frontend
// (dua package.json terpisah), pola yang sama dengan label enum lain di
// file ini yang juga dicerminkan, bukan dibagi lewat import lintas paket.
function formatDurasiSingkat(totalSeconds) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return null;
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

// Tanggal di metadata disimpan ISO (UTC) apa adanya — pengubahan ke label
// WIB yang enak dibaca adalah tanggung jawab tepi tampilan (frontend
// formatDate.js), BUKAN modul ini (utils/wib.js: "UTC di dalam, WIB di
// tepi"). Di sini cukup ambil bagian tanggalnya (YYYY-MM-DD) untuk kalimat
// yang tetap masuk akal dibaca di log/tes backend.
function tanggalSaja(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

/**
 * Ubah satu ActivityEvent jadi kalimat Bahasa Indonesia siap tampil di
 * linimasa (spec Phase 26: "Spring Repair completed by Ari"). Fungsi
 * MURNI — tidak menyentuh database, dites langsung (tests/activityLog.test.js).
 * Frontend boleh memformat ulang tanggal metadata dengan formatDate.js;
 * fungsi ini memberi kalimat yang SUDAH benar tanpa itu, bukan template
 * setengah jadi.
 */
export function formatActivitySentence(event) {
  const { eventType, metadata = {} } = event || {};
  switch (eventType) {
    case EVENT_TYPES.PRIORITY_CHANGED:
      return `Prioritas diubah dari ${PRIORITY_LABEL[metadata.from] || "Normal"} ke ${PRIORITY_LABEL[metadata.to] || "Normal"}`;
    case EVENT_TYPES.MORNING_PRIORITY_REQUESTED:
      return `Ditandai prioritas pagi: ${PRIORITY_LABEL[metadata.suggestedPriority] || metadata.suggestedPriority}${metadata.note ? ` — "${metadata.note}"` : ""}`;
    case EVENT_TYPES.MORNING_PRIORITY_APPROVED:
      return `Prioritas pagi diterapkan ke ${metadata.unitCount ?? 0} unit: ${PRIORITY_LABEL[metadata.appliedPriority] || metadata.appliedPriority}`;
    case EVENT_TYPES.MORNING_PRIORITY_DISMISSED:
      return "Prioritas pagi dibatalkan";
    case EVENT_TYPES.DUE_DATE_CHANGED:
      return metadata.to
        ? `Target produksi diatur ke ${tanggalSaja(metadata.to)}`
        : "Target produksi dihapus";
    case EVENT_TYPES.SERVICE_ASSIGNED:
      return `Layanan produksi ditetapkan: ${metadata.serviceLabel || "—"}`;
    case EVENT_TYPES.PRODUCTION_BLOCKED: {
      const label = (BLOCK_REASON_LABEL[metadata.reason] || metadata.reason || "alasan belum tercatat").toLowerCase();
      return metadata.note ? `Pekerjaan tertunda — ${label}: ${metadata.note}` : `Pekerjaan tertunda — ${label}`;
    }
    case EVENT_TYPES.PRODUCTION_BLOCKER_RESOLVED:
      return metadata.resolutionNote
        ? `Pekerjaan dilanjutkan — ${metadata.resolutionNote}`
        : "Pekerjaan dilanjutkan";
    case EVENT_TYPES.STAGE_STARTED:
      return `${metadata.stage || "Tahap"} started`;
    case EVENT_TYPES.STAGE_PAUSED: {
      const label = PAUSE_REASON_LABEL[metadata.reason] || metadata.reason || "Unknown reason";
      return metadata.note
        ? `${metadata.stage || "Tahap"} paused — ${label}: ${metadata.note}`
        : `${metadata.stage || "Tahap"} paused — ${label}`;
    }
    case EVENT_TYPES.STAGE_RESUMED:
      return `${metadata.stage || "Tahap"} resumed`;
    case EVENT_TYPES.STAGE_COMPLETED: {
      const touch = formatDurasiSingkat(metadata.touchSeconds);
      return touch
        ? `${metadata.stage || "Tahap"} completed — Touch time ${touch}`
        : `${metadata.stage || "Tahap"} completed`;
    }
    case EVENT_TYPES.PRODUCTION_ADMIN_BYPASS:
      return `⚠️ Seluruh tahap produksi dilewati manual (admin) — ${metadata.note || "tanpa keterangan"}`;
    case EVENT_TYPES.ROUTE_ASSIGNED:
      return metadata.fromRouteId
        ? `Rute produksi diganti — ${metadata.routeName || "—"} v${metadata.routeVersion ?? "?"}`
        : `Rute produksi ditetapkan: ${metadata.routeName || "—"} v${metadata.routeVersion ?? "?"}`;
    case EVENT_TYPES.WORK_CENTER_ASSIGNED:
      return metadata.from
        ? `${metadata.stage || "Tahap"} — Work Center diubah: ${metadata.from} → ${metadata.to || "—"}`
        : `${metadata.stage || "Tahap"} — Work Center ditetapkan: ${metadata.to || "—"}`;
    case EVENT_TYPES.OPERATOR_ASSIGNED:
      return `${metadata.stage || "Tahap"} — Operator ditugaskan: ${metadata.to || "—"}`;
    case EVENT_TYPES.OPERATOR_REASSIGNED:
      return `${metadata.stage || "Tahap"} — Operator diganti: ${metadata.from || "—"} → ${metadata.to || "—"}`;
    case EVENT_TYPES.OPERATOR_UNASSIGNED:
      return `${metadata.stage || "Tahap"} — Penugasan operator dibatalkan (sebelumnya ${metadata.from || "—"})`;
    case EVENT_TYPES.MATERIAL_UPDATED: {
      const fields = Object.keys(metadata.changes || {});
      return fields.length
        ? `Data material ${metadata.code || "—"} diubah: ${fields.join(", ")}`
        : `Data material ${metadata.code || "—"} diubah`;
    }
    case EVENT_TYPES.DOCUMENT_APPROVED:
      return `Dokumen ${metadata.adjustmentNumber || metadata.transferNumber || metadata.issueNumber || metadata.receiptNumber || "—"} disetujui`;
    case EVENT_TYPES.DOCUMENT_REJECTED:
      return metadata.reason
        ? `Dokumen ${metadata.receiptNumber || metadata.recordNumber || "—"} ditolak — ${metadata.reason}`
        : `Dokumen ${metadata.receiptNumber || metadata.recordNumber || "—"} ditolak`;
    case EVENT_TYPES.CUSTODY_OFFERED:
      return `Unit ${metadata.unitCode || "—"} ditawarkan ke Gudang (${metadata.direction === "RETURN" ? "kembali dari pengiriman gagal" : metadata.direction === "FINISHED_GOODS" ? "barang jadi dari Produksi" : "tiba dari pickup"})`;
    case EVENT_TYPES.CUSTODY_ACCEPTED:
      return `Gudang menerima unit ${metadata.unitCode || "—"}${metadata.locationCode ? ` di lokasi ${metadata.locationCode}` : ""}`;
    case EVENT_TYPES.CUSTODY_REJECTED:
      return `Gudang menolak unit ${metadata.unitCode || "—"}${metadata.reason ? ` — ${metadata.reason}` : ""}`;
    case EVENT_TYPES.CUSTODY_ROLLED_BACK:
      return `Penawaran custody unit ${metadata.unitCode || "—"} dibatalkan (rollback writer)${metadata.reason ? ` — ${metadata.reason}` : ""}`;
    case EVENT_TYPES.PRODUCTION_PLAN_CREATED:
      return `Rencana produksi dibuat untuk unit ${metadata.unitCode || "—"}`;
    case EVENT_TYPES.PRODUCTION_PLAN_ASSIGNED:
      return `Rencana unit ${metadata.unitCode || "—"} ditetapkan ke workshop ${metadata.workCenterCode || "—"}`;
    case EVENT_TYPES.PRODUCTION_PLAN_BOM_SET:
      return `Planned BOM unit ${metadata.unitCode || "—"} disusun ulang (${metadata.lineCount ?? 0} bahan)${metadata.releasedReservations ? `, ${metadata.releasedReservations} reservasi dilepas` : ""}`;
    case EVENT_TYPES.PRODUCTION_PLAN_MATERIAL_RESERVED:
      return `Bahan direservasi untuk unit ${metadata.unitCode || "—"} (${metadata.reservationCount ?? 0} baris)`;
    case EVENT_TYPES.PRODUCTION_PLAN_CANCELLED:
      return `Rencana produksi unit ${metadata.unitCode || "—"} dibatalkan${metadata.reason ? ` — ${metadata.reason}` : ""}`;
    case EVENT_TYPES.PRODUCTION_DIAGNOSIS_SUBMITTED:
      return `Diagnosis unit ${metadata.unitCode || "—"} dikirim (v${metadata.version ?? "—"}) — layanan teknis ${metadata.serviceLabel || "—"}, ${metadata.bomLineCount ?? 0} bahan katalog${metadata.manualMaterialCount ? `, ${metadata.manualMaterialCount} bahan manual perlu dipetakan` : ""}`;
    case EVENT_TYPES.PRODUCTION_DIAGNOSIS_MANUAL_MATERIAL_MAPPED:
      return `Bahan manual "${metadata.description || "—"}" (unit ${metadata.unitCode || "—"}) dipetakan ke ${metadata.materialCode || "—"}`;
    case EVENT_TYPES.PRODUCTION_MATERIAL_ISSUE_REQUESTED:
      return `Produksi mengajukan pengambilan bahan ${metadata.issueNumber || "—"} untuk unit ${metadata.unitCode || "—"} (${metadata.lineCount ?? 0} bahan)`;
    case EVENT_TYPES.PRODUCTION_MATERIAL_ISSUE_PICKED:
      return `Gudang menyerahkan bahan ${metadata.issueNumber || "—"} untuk unit ${metadata.unitCode || "—"} (${metadata.lineCount ?? 0} bahan, stok berkurang)`;
    case EVENT_TYPES.PRODUCTION_WORKSHOP_RUN_REGISTERED:
      return `Unit ${metadata.unitCode || "—"} (${metadata.category || "—"}) didaftarkan lahir di workshop tanpa pickup`;
    case EVENT_TYPES.PRODUCTION_RUN_ONBOARDED_RENCANA:
      return metadata.origin === "WORKSHOP_BORN" ? `Unit ${metadata.unitCode || "—"} dimasukkan ke Rencana Produksi (Run dibuka — unit dibuat di workshop, tanpa pickup)` : `Unit ${metadata.unitCode || "—"} dimasukkan ke Rencana Produksi (Run dibuka, belum tiba di workshop${metadata.viaCustody ? "; mengikuti pickup yang sudah tercatat" : "; tanpa pickup tercatat"})`;
    case EVENT_TYPES.PRODUCTION_ARRIVAL_CONFIRMED_NO_CUSTODY:
      return `Kedatangan unit ${metadata.unitCode || "—"} di workshop dikonfirmasi petugas (lokasi ${metadata.locationCode || "—"}; tanpa serah-terima custody karena tidak ada pickup tercatat)`;
    case EVENT_TYPES.PRODUCTION_WORKSHOP_AWAITING_QC:
      return `Seluruh tahap workshop unit ${metadata.unitCode || "—"} selesai — menunggu QC`;
    case EVENT_TYPES.PRODUCTION_QC_RECORDED:
      return `QC unit ${metadata.unitCode || "—"}: ${metadata.result === "PASS" ? "LULUS" : metadata.result === "FAIL" ? "GAGAL (rework)" : metadata.result || "—"} (inspeksi #${metadata.version ?? "—"})`;
    case EVENT_TYPES.PRODUCTION_QC_WAIVED:
      return `QC unit ${metadata.unitCode || "—"} di-waive oleh pihak berwenang — ${metadata.reason || "tanpa alasan"}`;
    case EVENT_TYPES.PRODUCTION_REWORK_OPENED:
      return `Rework dibuka untuk unit ${metadata.unitCode || "—"} pada tahap ${metadata.stageLabel || "—"}${metadata.note ? ` — ${metadata.note}` : ""}`;
    case EVENT_TYPES.PRODUCTION_HANDOFF_ACTION:
      return `Tindak lanjut penolakan Gudang untuk unit ${metadata.unitCode || "—"}: ${metadata.action === "REWORK" ? "rework" : "tawarkan ulang"}${metadata.note ? ` — ${metadata.note}` : ""}`;
    case EVENT_TYPES.PRODUCTION_RUN_COMPLETED:
      return `Produksi unit ${metadata.unitCode || "—"} selesai — barang jadi diterima Gudang${metadata.locationCode ? ` di lokasi ${metadata.locationCode}` : ""}`;
    case EVENT_TYPES.PRODUCTION_RUN_CANCELLED:
      return `Production Run unit ${metadata.unitCode || "—"} dibatalkan${metadata.reason ? ` — ${metadata.reason}` : ""}`;
    case EVENT_TYPES.PRODUCTION_RUN_EXCEPTION_OPENED:
      return `Konflik rekonsiliasi dicatat untuk unit ${metadata.unitCode || "—"}: status unit ${metadata.unitStatus || "—"} berbeda dari Production Run yang berjalan`;
    case EVENT_TYPES.PRODUCTION_V1_WRITE_ON_V2_RUN:
      return `Aksi V1 (${metadata.what || "—"}) dicatat saat Production Run V2 unit ini masih berjalan — proyeksi V2 perlu direkonsiliasi sebelum command V2 dilanjutkan`;
    case EVENT_TYPES.PRODUCTION_RUN_EXCEPTION_RESOLVED:
      return `Konflik rekonsiliasi unit ${metadata.unitCode || "—"} diselesaikan (${metadata.resolution || "—"})${metadata.note ? ` — ${metadata.note}` : ""}`;
    case EVENT_TYPES.PRODUCTION_STATION_REORDERED:
      return `Urutan unit ${metadata.unitCode || "—"} di ${metadata.stationCode || "meja"} diubah manual: posisi ${metadata.from ?? "—"} → ${metadata.to ?? "—"}`;
    case EVENT_TYPES.PRODUCTION_MATERIAL_RETURN_REQUESTED:
      return `Sisa bahan unit ${metadata.unitCode || "—"} (${metadata.lineCount ?? 0} bahan) menunggu diterima Gudang`;
    case EVENT_TYPES.PRODUCTION_BUILD_MATERIAL_OPERATOR_SET:
      return metadata.operatorName ? `PIC Bahan unit ${metadata.unitCode || "—"} ditetapkan: ${metadata.operatorName}` : `PIC Bahan unit ${metadata.unitCode || "—"} dilepas`;
    case EVENT_TYPES.PRODUCTION_BUILD_CORNER_CONFIRMED:
      return metadata.required ? `Corner unit ${metadata.unitCode || "—"} dikonfirmasi DIPERLUKAN` : `Corner unit ${metadata.unitCode || "—"} dikonfirmasi TIDAK diperlukan — ${metadata.reason || "tanpa alasan"}`;
    case EVENT_TYPES.PRODUCTION_BUILD_MATERIALS_RECORDED:
      return `Racikan/pemakaian bahan unit ${metadata.unitCode || "—"} dicatat (versi ${metadata.version ?? "—"}, ${metadata.materialCount ?? 0} bahan)`;
    case EVENT_TYPES.PRODUCTION_STEP_SKIPPED:
      return `Tahap ${(metadata.stepNos || []).join(", ") || "—"} (${metadata.stageLabel || "—"}) unit ${metadata.unitCode || "—"} DILEWATI — ${metadata.reason || "Adaptasi sistem"} (bukan dikerjakan; tanpa foto/hasil uji)`;
    case EVENT_TYPES.PRODUCTION_QC_NOT_PERFORMED:
      return `QC unit ${metadata.unitCode || "—"} TIDAK DILAKUKAN — ${metadata.reason || "Adaptasi sistem"} (bukan lulus/di-waive)`;
    case EVENT_TYPES.PRODUCTION_FINISHED_ADAPTATION:
      return `Produksi unit ${metadata.unitCode || "—"} diselesaikan (mode adaptasi): ${metadata.skippedCount ?? 0} tahap dilewati, QC tidak dilakukan, unit Siap Kirim tanpa penerimaan barang jadi Gudang`;
    case EVENT_TYPES.PRODUCTION_ADAPTATION_APPLIED:
      return `Mode adaptasi diterapkan pada Production Run unit ${metadata.unitCode || "—"}${metadata.reason ? ` — ${metadata.reason}` : ""}`;
    case EVENT_TYPES.PRODUCTION_WORK_DELAYED:
      return `Pekerjaan unit ${metadata.unitCode || "—"} ditunda: ${metadata.reasonLabel || "—"}${metadata.note ? ` — ${metadata.note}` : ""}`;
    case EVENT_TYPES.PRODUCTION_WORK_RESUMED:
      return `Pekerjaan unit ${metadata.unitCode || "—"} dilanjutkan${metadata.reasonLabel ? ` (sebelumnya: ${metadata.reasonLabel})` : ""}`;
    case EVENT_TYPES.PRODUCTION_SETTING_CHANGED:
      return `Pengaturan Production "${metadata.label || metadata.key || "—"}" diubah${metadata.to != null ? ` → ${metadata.to}` : ""}`;
    case EVENT_TYPES.PRODUCTION_MATERIAL_RETURN_RECEIVED:
      return `Gudang menerima retur sisa ${metadata.materialCode || "bahan"} ${metadata.qty ?? "—"} dari unit ${metadata.unitCode || "—"}`;
    case EVENT_TYPES.PRODUCTION_DOCUMENTATION_ADDED:
      return `Dokumentasi ${metadata.categoryLabel || metadata.category || "produksi"} unit ${metadata.unitCode || "—"}: ${metadata.count ?? 0} foto ditambahkan (${metadata.source || "Manual"})`;
    case EVENT_TYPES.PRODUCTION_DOCUMENTATION_CORRECTED:
      return `Dokumentasi ${metadata.categoryLabel || metadata.category || "produksi"} unit ${metadata.unitCode || "—"} dikoreksi — ${metadata.reason || "tanpa alasan"}`;
    case EVENT_TYPES.PRODUCTION_COMPONENT_RECORDED:
      return `Catatan komponen unit ${metadata.unitCode || "—"}: ${metadata.sectionLabel || metadata.section || "—"} dicatat (versi ${metadata.version ?? 1}${metadata.mediaCount ? `, ${metadata.mediaCount} foto` : ""})`;
    case EVENT_TYPES.PRODUCTION_COMPONENT_CORRECTED:
      return `Catatan komponen unit ${metadata.unitCode || "—"}: ${metadata.sectionLabel || metadata.section || "—"} dikoreksi (versi ${metadata.version ?? "—"}) — ${metadata.reason || "tanpa alasan"}`;
    case EVENT_TYPES.PRODUCTION_STEP_RECORDED:
      return `Tahap ${metadata.stepNo ?? "—"} (${metadata.stepLabel || "—"}) unit ${metadata.unitCode || "—"} tercatat${metadata.verdict ? ` — hasil ${metadata.verdict}` : ""}`;
    case EVENT_TYPES.PRODUCTION_MATERIAL_SHORTAGE_REPORTED:
      return `Produksi menunggu bahan baku untuk unit ${metadata.unitCode || "—"} (${metadata.itemCount ?? 0} bahan)${metadata.note ? ` — ${metadata.note}` : ""}`;
    case EVENT_TYPES.PRODUCTION_MATERIAL_SHORTAGE_RESOLVED:
      return `Kekurangan bahan unit ${metadata.unitCode || "—"} diselesaikan Gudang${metadata.note ? ` — ${metadata.note}` : ""}`;
    case EVENT_TYPES.PRODUCTION_MATERIAL_ISSUE_CANCELLED:
      return `Pengambilan bahan ${metadata.issueNumber || "—"} untuk unit ${metadata.unitCode || "—"} dibatalkan${metadata.reason ? ` — ${metadata.reason}` : ""}`;
    case EVENT_TYPES.BANK_REKON_V2: {
      const alasan = metadata.alasan ? ` — ${metadata.alasan}` : "";
      switch (metadata.aksi) {
        case "impor": return `Rekening koran diimpor (${metadata.rekening ?? "rekening"}): ${metadata.jumlahBaris ?? 0} baris${metadata.dilewati ? `, ${metadata.dilewati} baris ganda dilewati` : ""}`;
        case "impor_dibatalkan": return `Impor rekening koran dibatalkan (${metadata.jumlahBaris ?? 0} baris)${alasan}`;
        case "cocok": return `Pencocokan ${metadata.bentuk ?? ""} dibuat (${metadata.jenis === "OTOMATIS" ? "otomatis" : "manual"})${alasan}`.replace("  ", " ");
        case "cocok_dibatalkan": return `Pencocokan dibatalkan${alasan}`;
        case "dikecualikan": return `Dikecualikan dari pencocokan${alasan}`;
        case "opname": return `Hitung fisik kas Rp${Number(metadata.jumlah ?? 0).toLocaleString("id-ID")} dicatat${alasan}`;
        case "periode_selesai": return `Periode rekonsiliasi diselesaikan (${metadata.periode ?? ""})`;
        case "periode_dibatalkan": return `Periode rekonsiliasi dinyatakan tidak berlaku${alasan}`;
        default: return "Aktivitas rekonsiliasi bank";
      }
    }
    case EVENT_TYPES.PAIDAT_PENGECUALIAN:
      return metadata.aksi === "dicabut"
        ? `Pengecualian tanggal lunas dicabut — ${metadata.alasan ?? "tanpa alasan"}`
        : `Tanggal lunas dikunci oleh Owner (pengecualian) — ${metadata.alasan ?? "tanpa alasan"}`;
    case EVENT_TYPES.PENJUALAN_KARYAWAN_DIUBAH:
      return metadata.to ? `Ditandai Penjualan Karyawan — penjual: ${metadata.to}${metadata.before ? ` (sebelumnya ${metadata.before})` : ""}` : "Penanda Penjualan Karyawan dihapus";
    case EVENT_TYPES.KLAIM_LUNAS: {
      const rp = `Rp${Number(metadata.amount ?? 0).toLocaleString("id-ID")}`;
      const alasan = metadata.alasan ? ` — ${metadata.alasan}` : "";
      switch (metadata.aksi) {
        case "draft_dibuat": return "Draft Klaim Lunas dibuat";
        case "diajukan": return `Klaim Lunas ${rp} diajukan, menunggu verifikasi Finance (${metadata.jumlahBukti ?? 0} bukti)`;
        case "diajukan_ulang": return `Klaim Lunas ${rp} diajukan ulang, menunggu verifikasi Finance (${metadata.jumlahBukti ?? 0} bukti)`;
        case "bukti_ditambah": return "Bukti Pembayaran ditambahkan ke klaim";
        case "bukti_dihapus": return "Bukti Pembayaran dihapus dari draft klaim";
        case "bukti_diminta": return `Finance meminta bukti tambahan untuk Klaim Lunas${alasan}`;
        case "ditolak": return `Klaim Lunas ditolak Finance${alasan}`;
        case "diverifikasi": return `Klaim Lunas diverifikasi Finance — Payment ${rp} dibuat, status bayar: ${metadata.statusBayar || "—"}`;
        case "ditarik": return "Klaim Lunas ditarik oleh Sales";
        default: return "Klaim Lunas";
      }
    }
    case EVENT_TYPES.BUKTI_DIMINTA:
      return metadata.catatan ? `Finance meminta bukti pembayaran order ${metadata.orderNumber || "—"} — ${metadata.catatan}` : `Finance meminta bukti pembayaran order ${metadata.orderNumber || "—"}`;
    case EVENT_TYPES.DOCUMENT_CANCELLED:
      return metadata.reason
        ? `Dokumen ${metadata.issueNumber || metadata.transferNumber || "—"} dibatalkan — ${metadata.reason}`
        : `Dokumen ${metadata.issueNumber || metadata.transferNumber || "—"} dibatalkan`;
    case EVENT_TYPES.DOCUMENT_POSTED:
      return `Ledger stok ditulis dari dokumen ${
        metadata.receiptNumber || metadata.issueNumber || metadata.transferNumber
        || metadata.countNumber || metadata.adjustmentNumber || metadata.recordNumber || metadata.returnNumber || "—"
      }${metadata.step ? ` (${metadata.step})` : ""}`;
    case EVENT_TYPES.COMPLAINT_CREATED:
      return `Kasus komplain dibuka — ${metadata.categoryLabel || metadata.category || "—"}`;
    case EVENT_TYPES.COMPLAINT_STATUS_CHANGED:
      return metadata.note
        ? `Status komplain: ${metadata.fromLabel || metadata.from || "—"} → ${metadata.toLabel || metadata.to || "—"} — ${metadata.note}`
        : `Status komplain: ${metadata.fromLabel || metadata.from || "—"} → ${metadata.toLabel || metadata.to || "—"}`;
    case EVENT_TYPES.COMPLAINT_DELIVERY_TASK_CREATED:
      return `Delivery Task dibuat — ${metadata.jobType === "DELIVERY" ? "Pengiriman ulang" : "Pengambilan/inspeksi"}`;
    case EVENT_TYPES.COMPLAINT_MATERIAL_REQUESTED:
      return `Material Requirement diajukan ke Warehouse${metadata.issueNumber ? ` — ${metadata.issueNumber}` : ""}`;
    case EVENT_TYPES.COMPLAINT_QC_LINKED:
      return `Hasil QC ditautkan ke kasus — verdict ${metadata.verdict || "—"}`;
    case EVENT_TYPES.COMPLAINT_FOLLOW_UP_LOGGED:
      return metadata.note ? `Follow-up ke customer — ${metadata.note}` : "Follow-up ke customer dicatat";
    case EVENT_TYPES.COMPLAINT_CUSTOMER_CONFIRMED:
      return "Customer mengonfirmasi komplain SELESAI";
    case EVENT_TYPES.COMPLAINT_CANCELLED:
      return metadata.reason ? `Kasus komplain dibatalkan — ${metadata.reason}` : "Kasus komplain dibatalkan";

    // ── Finance (D-180) ───────────────────────────────────────────────
    case EVENT_TYPES.JOURNAL_REVERSED:
      return `Jurnal ${metadata.entryNumber || "—"} dibalik — ${metadata.reason || "tanpa keterangan"}`;
    case EVENT_TYPES.PERIOD_CLOSED:
      return `Periode ${metadata.periode || "—"} ditutup${metadata.note ? ` — ${metadata.note}` : ""}`;
    case EVENT_TYPES.PERIOD_REOPENED:
      return `Periode ${metadata.periode || "—"} dibuka kembali${metadata.note ? ` — ${metadata.note}` : ""}`;
    case EVENT_TYPES.FINANCE_SETTING_CHANGED:
      return `Pengaturan finance "${metadata.key || "—"}" diubah: ${metadata.from ?? "(kosong)"} → ${metadata.to ?? "(kosong)"}`;
    case EVENT_TYPES.DIVISION_BUDGET_CHANGED: {
      const aksi = { draf_dibuat: "dibuat (draf)", draf_diubah: "diubah (draf)", disetujui: "disetujui", draf_dihapus: "draf dihapus" }[metadata.aksi] || "diubah";
      return `Anggaran divisi ${metadata.lineKey || "—"} v${metadata.version ?? "?"} ${aksi}${metadata.ke != null ? ` — Rp${Number(metadata.ke).toLocaleString("id-ID")}` : ""}${metadata.alasan ? ` — ${metadata.alasan}` : ""}`;
    }
    case EVENT_TYPES.CHART_OF_ACCOUNTS_CHANGED: {
      const fields = Object.keys(metadata.changes || {});
      if (metadata.aksi === "dibuat") return `Akun ${metadata.code || "—"} ${metadata.name || ""} ditambahkan ke bagan akun`.trim();
      if (metadata.aksi === "pasang_bawaan") return `Bagan akun bawaan dipasang (${metadata.jumlah ?? 0} akun tersedia)`;
      return fields.length
        ? `Akun ${metadata.code || "—"} diubah: ${fields.join(", ")}`
        : `Akun ${metadata.code || "—"} diubah`;
    }
    case EVENT_TYPES.DOCUMENT_CORRECTED: {
      const nomor = metadata.expenseNumber || metadata.transferNumber || metadata.incomeNumber
        || metadata.billNumber || metadata.refundNumber || "—";
      return `Dokumen ${nomor} dikoreksi (jurnal lama dibalik, jurnal baru diposting) — ${metadata.reason || "tanpa keterangan"}`;
    }
    case EVENT_TYPES.DOCUMENT_EDITED: {
      const nomor = metadata.expenseNumber || metadata.transferNumber || metadata.incomeNumber
        || metadata.billNumber || metadata.refundNumber || "—";
      const fields = Object.keys(metadata.changes || {});
      return fields.length
        ? `Dokumen ${nomor} diubah (masih ${metadata.status || "draft"}): ${fields.join(", ")}`
        : `Dokumen ${nomor} diubah (masih ${metadata.status || "draft"})`;
    }
    case EVENT_TYPES.POD_EDITED: {
      const label = { driverId: "driver", helperId: "helper", completedAt: "waktu selesai" };
      const fields = Object.keys(metadata.changes || {}).map((f) => label[f] || f);
      return fields.length
        ? `POD job ${metadata.orderNumber || "—"} dikoreksi admin (${fields.join(", ")} berubah) — ${metadata.reason || "tanpa keterangan"}`
        : `POD job ${metadata.orderNumber || "—"} dikoreksi admin — ${metadata.reason || "tanpa keterangan"}`;
    }
    case EVENT_TYPES.HAS_SIM_CHANGED:
      return `Status SIM diubah: ${metadata.from ? "punya SIM" : "tanpa SIM"} → ${metadata.to ? "punya SIM" : "tanpa SIM"} (tarif insentif ${metadata.to ? "Rp7.000" : "Rp3.000"}/alamat)`;
    case EVENT_TYPES.INCENTIVE_SNAPSHOT_CREATED:
      return `Snapshot Insentif ${metadata.periodFrom || "?"} s/d ${metadata.periodTo || "?"} dibuat (${metadata.totalAlamat ?? 0} alamat, Rp${(metadata.totalRupiah ?? 0).toLocaleString("id-ID")})${metadata.adjustsSnapshotId ? " — koreksi atas snapshot sebelumnya" : ""}`;
    case EVENT_TYPES.INCENTIVE_SNAPSHOT_REVIEWED:
      return `Snapshot Insentif ${metadata.periodFrom || "?"} s/d ${metadata.periodTo || "?"} direview Finance`;
    case EVENT_TYPES.INCENTIVE_SNAPSHOT_APPROVED:
      return `Snapshot Insentif ${metadata.periodFrom || "?"} s/d ${metadata.periodTo || "?"} disetujui Owner — Rp${(metadata.totalRupiah ?? 0).toLocaleString("id-ID")}`;
    case EVENT_TYPES.INCENTIVE_SNAPSHOT_REJECTED:
      return `Snapshot Insentif ${metadata.periodFrom || "?"} s/d ${metadata.periodTo || "?"} ditolak — ${metadata.reason || "tanpa keterangan"}`;
    case EVENT_TYPES.INCENTIVE_SNAPSHOT_ADJUSTED:
      return `Snapshot ini dikoreksi oleh Snapshot baru (${metadata.adjustmentSnapshotId || "—"}) — ${metadata.reason || "tanpa keterangan"}`;
    case EVENT_TYPES.INCENTIVE_PAYOUT_CREATED:
      return `Pembayaran insentif Rp${(metadata.amount ?? 0).toLocaleString("id-ID")} dicatat (${metadata.method || "?"}${metadata.referenceNumber ? `, ref ${metadata.referenceNumber}` : ""}) — sisa Rp${(metadata.sisaSesudah ?? 0).toLocaleString("id-ID")}`;
    case EVENT_TYPES.INCENTIVE_PAYOUT_VOIDED:
      return `Pembayaran insentif Rp${(metadata.amount ?? 0).toLocaleString("id-ID")} dibatalkan (void) — ${metadata.reason || "tanpa keterangan"} (sisa jadi Rp${(metadata.sisaSesudah ?? 0).toLocaleString("id-ID")})`;
    default:
      // eventType yang belum dikenali modul ini (mis. ditambahkan slice
      // berikutnya) — tampilkan apa adanya alih-alih melempar error, supaya
      // linimasa tidak pernah gagal render gara-gara satu jenis event baru.
      return eventType || "Aktivitas";
  }
}
