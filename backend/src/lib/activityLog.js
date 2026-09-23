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
  // Pembayaran pelanggan (Finance Mobile S5): verifikasi & penolakan Payment.
  PAYMENT: "payment",
  FIN_SUPPLIER_BILL: "fin_supplier_bill",
  FIN_REFUND: "fin_refund",
  FIN_PERIOD: "fin_period",
  FIN_ACCOUNT: "fin_account",
  FIN_SETTING: "fin_setting",
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
    case EVENT_TYPES.DUE_DATE_CHANGED:
      return metadata.to
        ? `Target produksi diatur ke ${tanggalSaja(metadata.to)}`
        : "Target produksi dihapus";
    case EVENT_TYPES.SERVICE_ASSIGNED:
      return `Layanan produksi ditetapkan: ${metadata.serviceLabel || "—"}`;
    case EVENT_TYPES.PRODUCTION_BLOCKED: {
      const label = BLOCK_REASON_LABEL[metadata.reason] || metadata.reason || "Unknown reason";
      return metadata.note ? `Production blocked — ${label}: ${metadata.note}` : `Production blocked — ${label}`;
    }
    case EVENT_TYPES.PRODUCTION_BLOCKER_RESOLVED:
      return metadata.resolutionNote
        ? `Production blocker resolved — ${metadata.resolutionNote}`
        : "Production blocker resolved";
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
