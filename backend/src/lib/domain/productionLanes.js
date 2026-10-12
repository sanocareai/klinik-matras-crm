// Lini kerja PIC Produksi — PIC Meja Bongkar dan PIC Corner & Finishing adalah DUA penugasan terpisah (keputusan Owner Okt 2026).
// Operator hanya boleh dijadikan PIC suatu lini kalau Admin sudah menetapkannya eksplisit (ProductionOperator.workLanes, bermula kosong).
// Modul ini murni (tanpa DB) supaya validasi server, read-model dan UI memakai satu kosakata.

export const WORK_LANES = Object.freeze({ TABLE: "TABLE", CORNER: "CORNER" });
export const WORK_LANE_VALUES = Object.freeze([WORK_LANES.TABLE, WORK_LANES.CORNER]);
export const WORK_LANE_LABELS = Object.freeze({ TABLE: "Meja Bongkar", CORNER: "Corner & Finishing" });

// Normalisasi KETAT untuk input Admin: harus array, setiap nilai salah satu lini yang sah; duplikat dibuang, urutan baku. Selain itu null (tolak — jangan menebak).
export function normalizeWorkLanes(input) {
  if (!Array.isArray(input)) return null;
  const set = new Set();
  for (const v of input) {
    if (typeof v !== "string" || !WORK_LANE_VALUES.includes(v)) return null;
    set.add(v);
  }
  return WORK_LANE_VALUES.filter((l) => set.has(l));
}

// Pembacaan TOLERAN dari DB/respons (nilai tak dikenal diabaikan, bukan dianggap lini sah).
export function lanesOf(operator) {
  const raw = Array.isArray(operator?.workLanes) ? operator.workLanes : [];
  return WORK_LANE_VALUES.filter((l) => raw.includes(l));
}

export function hasLane(operator, lane) {
  return lanesOf(operator).includes(lane);
}

export function laneLabel(lane) {
  return WORK_LANE_LABELS[lane] || String(lane);
}
