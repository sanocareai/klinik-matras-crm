// Lini PIC Produksi: PIC Meja Bongkar dan PIC Corner & Finishing adalah dua penugasan TERPISAH. Siapa boleh jadi PIC lini mana ditetapkan Admin
// (ProductionOperator.workLanes, bermula kosong) — klien hanya MENYARING pilihan; server tetap menolak lintas lini (PLAN_*_LANE_INVALID / CORNER_OPERATOR_LANE_INVALID).
export const LANE = Object.freeze({ TABLE: "TABLE", CORNER: "CORNER" });
export const LANE_LABEL = Object.freeze({ TABLE: "Meja Bongkar", CORNER: "Corner & Finishing" });

export const operatorName = (o) => o?.name || o?.user?.name || o?.employeeCode || "—";
export const hasLane = (o, lane) => Array.isArray(o?.workLanes) && o.workLanes.includes(lane);

/**
 * Opsi dropdown PIC untuk satu lini. Hanya operator berlini tersebut. Penugasan YANG SUDAH ADA (current) tetap ditampilkan walau belum berlini — diberi tanda,
 * supaya form edit tidak diam-diam mengosongkan/menggantinya; memilihnya kembali tidak berubah, memilih orang lain wajib berlini.
 */
export function laneOptions(operators, lane, current = null) {
  const list = (operators || []).filter((o) => hasLane(o, lane)).map((o) => ({ id: o.id, name: operatorName(o), legacy: false }));
  if (current?.id && !list.some((o) => o.id === current.id)) list.unshift({ id: current.id, name: current.name || "PIC saat ini", legacy: true });
  return list;
}

export const optionText = (o, lane) => (o.legacy ? `${o.name} (belum berlini ${LANE_LABEL[lane]})` : o.name);
