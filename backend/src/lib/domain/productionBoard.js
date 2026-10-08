// Papan Produksi V2 (P8) — aturan MURNI papan meja Planner H-1. Tidak menyentuh database.
//
// Konfigurasi awal (blueprint): target 12 unit/hari, Meja 1–4, kapasitas 3 unit/meja. Disajikan ke UI lewat endpoint board
// sehingga kelak bisa dipindah ke pengaturan tanpa mengubah UI. Waktu kerja default 08.00–17.00 WIB (target mulai/selesai plan).

export const BOARD_DEFAULTS = Object.freeze({
  dailyTarget: 12,
  stations: Object.freeze(["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"]),
  capacityPerStation: 3,
  workStartHourWib: 8,
  workEndHourWib: 17,
});

// Prioritas pengguna hanya Normal · Tinggi · Komplain (Komplain = turunan ComplaintCase resmi, lihat productionDisplay.js). Nilai lama 2 ("Mendesak") tersimpan apa adanya, hanya DITAMPILKAN Tinggi.
export const PRIORITY_LABEL = Object.freeze({ 0: "Normal", 1: "Tinggi", 2: "Tinggi" });

// Urutan kartu di satu meja. Urutan MANUAL (stationSequence, diatur Planner lewat drag-drop / tombol naik-turun) selalu menang;
// prioritas hanya URUTAN BAWAAN untuk kartu yang belum punya nomor manual (prioritas tinggi dulu, lalu target mulai paling awal).
// Kartu bernomor manual selalu di atas yang belum bernomor, jadi prioritas tidak pernah melompati urutan yang sudah diatur orang.
export function compareStationOrder(a, b) {
  const sa = a?.stationSequence ?? null;
  const sb = b?.stationSequence ?? null;
  if (sa != null && sb != null && sa !== sb) return sa - sb;
  if (sa != null && sb == null) return -1;
  if (sa == null && sb != null) return 1;
  return ((b?.priorityRank ?? b?.priority ?? 0) - (a?.priorityRank ?? a?.priority ?? 0))
    || (new Date(a?.targetStartAt || 0).getTime() - new Date(b?.targetStartAt || 0).getTime());
}

export function stationLabel(code) {
  const m = /^TABLE_(\d{1,2})$/.exec(code || "");
  return m ? `Meja ${Number(m[1])}` : "Belum dijadwalkan";
}

function boardError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}

// "YYYY-MM-DD" (tanggal kalender WIB) -> Date UTC tengah malam (kolom @db.Date). Tanggal tidak valid -> null.
export function parseProductionDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

export function formatProductionDate(date) {
  if (!date) return null;
  return new Date(date).toISOString().slice(0, 10);
}

// Tanggal kalender WIB hari ini ("YYYY-MM-DD").
export function todayWib(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

// Jendela kerja (UTC) untuk tanggal produksi WIB.
export function workWindowFor(productionDate, config = BOARD_DEFAULTS) {
  const base = new Date(`${formatProductionDate(productionDate)}T00:00:00.000Z`).getTime();
  return {
    targetStartAt: new Date(base + (config.workStartHourWib - 7) * 3600_000),
    targetCompleteAt: new Date(base + (config.workEndHourWib - 7) * 3600_000),
  };
}

// Validasi input penjadwalan (murni). Mengembalikan bentuk ternormalisasi atau melempar 400.
// Keluarkan dari papan = productionDate & stationCode keduanya null (penugasan operator tidak berubah).
export function normalizeScheduleInput(input, config = BOARD_DEFAULTS) {
  const { productionDate = null, stationCode = null } = input || {};
  const priority = input?.priority == null ? 0 : Number(input.priority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 2) throw boardError("Prioritas harus 0 (Normal), 1 (Tinggi), atau 2 (Mendesak)", 400, "PLAN_PRIORITY_INVALID");
  if (productionDate == null && stationCode == null) return { unschedule: true, priority };
  const date = parseProductionDate(productionDate);
  if (!date) throw boardError("Tanggal produksi wajib diisi dengan format YYYY-MM-DD", 400, "PLAN_PRODUCTION_DATE_INVALID");
  if (!config.stations.includes(stationCode)) throw boardError("Meja tidak dikenal", 400, "PLAN_STATION_INVALID", { stations: config.stations });
  if (!input.workCenterId) throw boardError("Workshop/work center wajib dipilih", 400, "PLAN_WORK_CENTER_REQUIRED");
  if (!input.operatorId) throw boardError("PIC meja (operator) wajib dipilih", 400, "PLAN_OPERATOR_REQUIRED");
  if (input.cornerWorkCenterId && !input.cornerOperatorId) throw boardError("Work center Corner hanya berlaku bersama PIC Corner", 400, "PLAN_CORNER_OPERATOR_REQUIRED");
  return {
    unschedule: false, priority, productionDate: date, stationCode,
    workCenterId: input.workCenterId, operatorId: input.operatorId,
    cornerWorkCenterId: input.cornerWorkCenterId || null, cornerOperatorId: input.cornerOperatorId || null,
  };
}

// Kapasitas meja (murni): `occupied` = jumlah plan AKTIF lain di (tanggal, meja) yang sama.
export function assertStationCapacity(occupied, config = BOARD_DEFAULTS) {
  if (occupied >= config.capacityPerStation) {
    throw boardError(`Meja sudah penuh (${occupied}/${config.capacityPerStation} unit). Pilih meja lain atau keluarkan unit dari meja ini.`, 409, "PLAN_STATION_FULL", { occupied, capacity: config.capacityPerStation });
  }
}
