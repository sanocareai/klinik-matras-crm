// P12C.1 — read-model antrean pekerjaan V1 per PIC (Aplikasi Meja/Corner). MURNI: tanpa Prisma/jaringan, diuji `node --test`.
//
// Sumber kebenaran: StageAssignment (siapa DITUGASKAN pada tahap mana) + status tahap dari engine V1 (`resolveCurrentTarget`) — bukan tebakan dari nama layanan.
// Setelah sebuah tahap selesai, engine memajukan `currentStageId` ke tahap berikutnya (READY, belum disentuh). Karena itu "penugasan sah yang belum dimulai"
// dan "menunggu penugasan berikutnya" hanya terbaca bila dibandingkan terhadap TAHAP TARGET unit, bukan hanya tahap sekarang:
//
//   target ditugaskan ke saya                  -> READY (siap dikerjakan: FIRST/READY) | IN_PROGRESS | PAUSED | BLOCKED
//   target BUKAN saya, tahap lebih hilir milik saya -> WAITING_PREREQUISITE (menunggu tahap prasyarat; target + pemegangnya ditampilkan)
//   target belum ditugaskan, SAYA PIC terakhir  -> WAITING_ASSIGNMENT (menunggu penugasan tahap berikutnya; tetap tampil sampai dialihkan)
//   target ditugaskan ke PIC lain / selesai     -> tidak tampil (sudah dialihkan / selesai)
//
// PIC terakhir = pemegang penugasan tahap SEBELUM target (fallback: aktor log COMPLETE/SKIP tahap itu -> operator). Tidak ada aksi yang dibuka di sini;
// kartu hanya membawa keadaan. Server tetap menegakkan izin dan urutan tahap pada setiap command (engine V1).
import { stepNoForStage } from "./productionSteps.js";

export const V1_WORK_STATES = Object.freeze({
  IN_PROGRESS: "IN_PROGRESS", PAUSED: "PAUSED", READY: "READY", BLOCKED: "BLOCKED", WAITING_PREREQUISITE: "WAITING_PREREQUISITE", WAITING_ASSIGNMENT: "WAITING_ASSIGNMENT",
});
// Urutan tampil dari server: yang sedang berjalan dulu, lalu siap, lalu yang menunggu.
export const V1_STATE_RANK = Object.freeze({ IN_PROGRESS: 0, PAUSED: 1, READY: 2, BLOCKED: 3, WAITING_PREREQUISITE: 4, WAITING_ASSIGNMENT: 5 });
const PRIORITY_RANK = Object.freeze({ CRITICAL: 0, URGENT: 1, HIGH: 2, NORMAL: 3 });

// Lini lantai KANONIK per tahap: gerbang QC = QC (bukan lantai); tahap pasca-QC `corner_sewing`/`finished` (blueprint langkah 11-12) = CORNER; sisanya TABLE.
// Memakai stepNoForStage (SATU-SATUNYA pemetaan tahap -> langkah blueprint) — bukan nama layanan atau label.
export function laneOfStage(stage) {
  if (!stage) return null;
  if (stage.requiresQc) return "QC";
  const step = stepNoForStage(stage);
  return step != null && step >= 11 ? "CORNER" : "TABLE";
}

/**
 * @param {object} p
 * @param {{id:string, labelId?:string, code?:string, phase?:string, requiresQc?:boolean}[]} p.path        jalur tahap unit (urut)
 * @param {{stage: object|null, state: string}} p.target                                                  hasil resolveCurrentTarget (engine)
 * @param {Map<string,{operatorId:string|null, operatorName?:string|null}>} p.assignments                 stageId -> penugasan
 * @param {string} p.operatorId                                                                             operator yang melihat antrean
 * @param {string|null} p.lastPicOperatorId                                                                 PIC tahap sebelum target (null bila belum ada)
 * @returns {null | { state: string, stage: object, lane: string, prerequisite?: object, waitingFor?: object, lastDone?: object }}
 */
export function deriveV1WorkItem({ path, target, assignments, operatorId, lastPicOperatorId = null }) {
  const T = target?.stage;
  if (!T || !operatorId) return null;
  if (target.state === "MISMATCH" || target.state === "DONE") return null; // jalur tidak cocok / seluruh tahap selesai: bukan antrean kerja
  const idx = path.findIndex((s) => s.id === T.id);
  if (idx < 0) return null;
  const holder = (stageId) => assignments.get(stageId) || null;
  const mine = (stageId) => holder(stageId)?.operatorId === operatorId;

  if (mine(T.id)) {
    const state = target.state === "FIRST" || target.state === "READY" ? V1_WORK_STATES.READY : target.state;
    if (!(state in V1_WORK_STATES)) return null;
    return { state, stage: T, lane: laneOfStage(T) };
  }
  const later = path.slice(idx + 1).find((s) => mine(s.id));
  if (later) {
    return {
      state: V1_WORK_STATES.WAITING_PREREQUISITE, stage: later, lane: laneOfStage(later),
      prerequisite: { stage: T, state: target.state === "FIRST" ? "READY" : target.state, assignee: holder(T.id)?.operatorName ?? null, assigned: !!holder(T.id)?.operatorId },
    };
  }
  // Menunggu penugasan berikutnya: hanya bila tahap target BENAR-BENAR belum ditugaskan & belum berjalan, dan saya PIC tahap sebelumnya.
  if (!holder(T.id)?.operatorId && (target.state === "FIRST" || target.state === "READY") && idx > 0 && lastPicOperatorId === operatorId) {
    const lastDone = path[idx - 1];
    return { state: V1_WORK_STATES.WAITING_ASSIGNMENT, stage: lastDone, lane: laneOfStage(lastDone), waitingFor: T, lastDone };
  }
  return null; // ditugaskan ke PIC lain (dialihkan) atau bukan milik saya
}

// PIC terakhir: penugasan tahap SEBELUM target; bila tidak ada penugasan, operator dari aktor log COMPLETE/SKIP tahap itu.
export function lastPicOperatorId({ path, target, assignments, completedActorByStage, operatorByUser }) {
  const T = target?.stage; if (!T) return null;
  const idx = path.findIndex((s) => s.id === T.id);
  if (idx <= 0) return null;
  const prev = path[idx - 1];
  const assigned = assignments.get(prev.id)?.operatorId ?? null;
  if (assigned) return assigned;
  const actor = completedActorByStage?.get(prev.id) ?? null;
  return actor ? (operatorByUser?.get(actor) ?? null) : null;
}

// Urutan server: keadaan, lalu prioritas (tinggi dulu), lalu yang paling lama (FIFO), lalu kode unit (stabil).
export function rankV1Items(items) {
  return [...items].sort((a, b) => (V1_STATE_RANK[a.state] - V1_STATE_RANK[b.state])
    || ((PRIORITY_RANK[a.unit.priority] ?? 9) - (PRIORITY_RANK[b.unit.priority] ?? 9))
    || String(a.unit.createdAt).localeCompare(String(b.unit.createdAt))
    || String(a.unit.unitCode).localeCompare(String(b.unit.unitCode)));
}
