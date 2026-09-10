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
    default:
      // eventType yang belum dikenali modul ini (mis. ditambahkan slice
      // berikutnya) — tampilkan apa adanya alih-alih melempar error, supaya
      // linimasa tidak pernah gagal render gara-gara satu jenis event baru.
      return eventType || "Aktivitas";
  }
}
