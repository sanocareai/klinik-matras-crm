// Rencana Admin — aturan MURNI jadwal produksi per unit TANPA Production Run (tidak menyentuh database).
//
// Prinsip (satu sumber kebenaran, tidak ada salinan):
//   • tanggal + meja unit yang BELUM dimiliki V2  = production_unit_schedules (satu baris per unit);
//   • tanggal + meja unit yang sudah dijadwalkan V2 = production_run_plans_v2 (jadwal Admin diambil alih: status ADOPTED);
//   • target selesai + prioritas = kolom Unit (productionDueAt, priority) — dipakai Order Produksi/Status Produksi yang sama;
//   • PIC meja = production_station_day_pics_v2 (per meja per tanggal).
// Menjadwalkan TIDAK membuat Run, tahap, QC, penerimaan, serah-terima, pemakaian bahan, stok, jurnal, maupun pesan pelanggan.
import { BOARD_DEFAULTS, formatProductionDate, parseProductionDate, stationLabel, todayWib, workWindowFor } from "./productionBoard.js";

export const JADWAL_STATUS = Object.freeze({ ACTIVE: "ACTIVE", CLEARED: "CLEARED", ADOPTED: "ADOPTED" });
export const JADWAL_EVENT = Object.freeze({ SCHEDULED: "SCHEDULED", RESCHEDULED: "RESCHEDULED", UNSCHEDULED: "UNSCHEDULED", TARGET_CHANGED: "TARGET_CHANGED", UNDONE: "UNDONE", ADOPTED: "ADOPTED" });
export const ANTREAN_TAB = Object.freeze({ SIAP: "SIAP", KEPUTUSAN: "KEPUTUSAN", MENUNGGU_TIBA: "MENUNGGU_TIBA", TERJADWAL: "TERJADWAL", SEMUA: "SEMUA" });
export const ANTREAN_TABS = Object.freeze(Object.values(ANTREAN_TAB));
export const ANTREAN_SORT = Object.freeze({ PRIORITAS: "PRIORITAS", TARGET: "TARGET", TERLAMA: "TERLAMA" });
export const PRIORITAS_UNIT = Object.freeze(["NORMAL", "HIGH"]);

export function jadwalError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}

const DAY_MS = 86_400_000;
const addDays = (key, n) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
export const HARI = Object.freeze(["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]);

/** Senin (WIB) pada minggu yang memuat tanggal `key`. */
export function mondayOf(key) {
  const d = new Date(`${key}T00:00:00Z`); const dow = d.getUTCDay(); // 0 = Minggu
  return addDays(key, dow === 0 ? -6 : 1 - dow);
}
export function weekDays(startKey) { const s = mondayOf(startKey); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
export { addDays };

/** Kapasitas jujur: slot per meja × jumlah meja (jumlah UNIT). Durasi kerja per unit belum tersedia → TIDAK ada estimasi jam. */
export function kapasitasHari(config = BOARD_DEFAULTS) {
  const mejaCount = config.stations.length;
  return {
    perMeja: config.capacityPerStation, mejaCount, total: config.capacityPerStation * mejaCount, satuan: "unit", targetHarian: config.dailyTarget,
    catatan: "Kapasitas dihitung dari jumlah unit per meja. Durasi kerja per unit belum tersedia, jadi tidak ada estimasi jam.",
  };
}

/** Normalisasi masukan jadwal. Tanggal tidak boleh sudah lewat (WIB); meja boleh kosong (jadwal hari saja). */
export function normalizeJadwalInput(raw = {}, { config = BOARD_DEFAULTS, now = new Date() } = {}) {
  const date = parseProductionDate(raw.productionDate);
  if (!date) throw jadwalError("Tanggal jadwal tidak valid (format YYYY-MM-DD)", 400, "JADWAL_TANGGAL_INVALID");
  const key = formatProductionDate(date);
  if (key < todayWib(now)) throw jadwalError("Tanggal jadwal sudah lewat — pilih hari ini atau setelahnya.", 422, "JADWAL_TANGGAL_LEWAT", { today: todayWib(now) });
  const station = raw.stationCode == null || raw.stationCode === "" ? null : String(raw.stationCode);
  if (station != null && !config.stations.includes(station)) throw jadwalError(`Meja tidak dikenal (${station})`, 400, "JADWAL_MEJA_INVALID", { allowed: config.stations });
  let targetKey; // undefined = tidak diubah; null = hapus target; "YYYY-MM-DD" = set
  if (raw.targetDate !== undefined) {
    if (raw.targetDate === null || raw.targetDate === "") targetKey = null;
    else {
      const t = parseProductionDate(raw.targetDate);
      if (!t) throw jadwalError("Target selesai tidak valid (format YYYY-MM-DD)", 400, "JADWAL_TARGET_INVALID");
      targetKey = formatProductionDate(t);
      if (targetKey < key) throw jadwalError("Target selesai tidak boleh lebih awal dari tanggal jadwal.", 422, "JADWAL_TARGET_SEBELUM_TANGGAL", { productionDate: key });
    }
  }
  let priority;
  if (raw.priority !== undefined) {
    if (!PRIORITAS_UNIT.includes(raw.priority)) throw jadwalError(`Prioritas harus salah satu dari: ${PRIORITAS_UNIT.join(", ")}`, 400, "JADWAL_PRIORITAS_INVALID");
    priority = raw.priority;
  }
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 500) : "";
  return { productionDate: date, dateKey: key, stationCode: station, targetKey, priority, note: note || null };
}

/** Target selesai (tanggal WIB) -> instan jam akhir kerja WIB (sama dengan target rencana V2). */
export const targetAtOf = (targetKey, config = BOARD_DEFAULTS) => (targetKey ? workWindowFor(parseProductionDate(targetKey), config).targetCompleteAt : null);
export const targetKeyOf = (at) => (at ? new Date(new Date(at).getTime() + 7 * 3600_000).toISOString().slice(0, 10) : null);

export const JADWAL_SUMBER = Object.freeze({ ADMIN: "ADMIN", V2: "V2" });
export const SUMBER_LABEL = Object.freeze({ ADMIN: "Rencana Admin", V2: "Pelaksanaan Meja" });
export const SUMBER_DAMPAK = Object.freeze({
  ADMIN: "Hanya jadwal. Tidak membuka Run, tahap, QC, penerimaan, atau pemakaian bahan.",
  V2: "Pekerjaan Meja sudah dibuka: Run, alur Meja/QC dan PIC berjalan dari jadwal ini.",
});

/**
 * Tab antrean untuk SATU unit (murni). Masukan sudah dihitung server:
 *  - schedulable: hasil eligibilitas jadwal Admin ({ok:false, code, message, next} bila tak boleh)
 *  - diterima: posisi fisik = di workshop
 *  - terjadwal: punya jadwal Admin ACTIVE atau rencana V2 bertanggal
 *  - penghalang: { code, message, next } | null — hambatan konkret yang butuh keputusan manusia
 */
export function tabAntrean({ terjadwal, penghalang, diterima }) {
  if (terjadwal) return ANTREAN_TAB.TERJADWAL;
  if (penghalang) return ANTREAN_TAB.KEPUTUSAN;
  return diterima ? ANTREAN_TAB.SIAP : ANTREAN_TAB.MENUNGGU_TIBA;
}

/** Penghalang konkret untuk menjadwalkan (Admin). null = boleh. Urutan = prioritas penjelasan. */
export function penghalangJadwal({ unitStatus, orderStatus, isInternal, customerStage, pkrKurang, v2Owned, runOutsideCohort }) {
  if (isInternal || customerStage === "SPAM") return { code: "INTERNAL_OR_SPAM", message: "Pelanggan internal/spam — tidak masuk Rencana Produksi.", next: "Tidak ada tindakan.", fatal: true };
  if (unitStatus === "CANCELLED" || orderStatus === "CANCELLED") return { code: "UNIT_CANCELLED", message: "Order/unit dibatalkan — tidak dijadwalkan.", next: "Tidak ada tindakan.", fatal: true };
  if (["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"].includes(unitStatus)) return { code: "UNIT_FINISHED", message: "Unit sudah Siap Kirim/Terkirim — tidak dijadwalkan.", next: "Lihat riwayatnya di Order Produksi.", fatal: true };
  if (pkrKurang?.kurang?.length) return { code: "PKR_PERLU_DILENGKAPI", message: `Order Penjualan Karyawan${pkrKurang.nomor ? ` ${pkrKurang.nomor}` : ""} belum lengkap: ${pkrKurang.kurang.join(", ")}.`, next: "Finance melengkapi spesifikasi di Penjualan Karyawan." };
  if (v2Owned) return { code: "UNIT_V2_OWNED", message: "Unit ini sudah dikelola Pelaksanaan Meja — jadwalnya diatur lewat rencana Meja.", next: "Atur lewat kartu Pelaksanaan Meja di kalender.", fatal: true };
  if (runOutsideCohort) return { code: "RUN_OUTSIDE_COHORT", message: "Unit punya pekerjaan produksi lama di luar cohort V2 — pengambilalihan adalah keputusan Owner/tim sistem.", next: "Minta Owner memutuskan." };
  if (orderStatus && !["PROCESSING", "PICKUP"].includes(orderStatus)) return { code: "ORDER_BELUM_DIPROSES", message: "Order belum berstatus Diproses.", next: "Menunggu status order Diproses." };
  return null;
}

export { stationLabel, formatProductionDate, parseProductionDate, todayWib };
