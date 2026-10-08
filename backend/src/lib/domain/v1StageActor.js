// P12C.2 — keputusan MURNI "siapa boleh mengeksekusi tahap V1 ini" (tanpa database; diuji node --test).
// Dipanggil mesin tahap (services/unitStageEngine.js) DI DALAM transaksi yang sama dengan mutasinya, setelah kunci baris unit
// (guardV1UnitWrite) — sehingga penugasan yang berubah di tengah jalan (POST .../assign memegang kunci unit yang sama) tidak bisa lolos.
//
// Aturan (sejajar kontrak V2 authorizeOperator, productionWorkshopExecutionCommandService.js):
//  1. Tahap yang dituju klien (stageId) HARUS tahap kanonik unit SEKARANG (currentStageId diselesaikan engine) — tahap basi/hilir ditolak 409.
//  2. Tahap lantai Meja/Corner (bukan gerbang QC): wajib sudah ditugaskan ke seorang PIC (409 bila belum).
//  3. Pemegang izin PRODUCTION_EXECUTE_ANY (ADMIN/OWNER, keputusan owner 4 Okt 2026) boleh mengerjakan tahap yang ditugaskan ke PIC lain;
//     aksi tetap tercatat atas actor_id penekan. Pagar "sudah ditugaskan" (butir 2) TETAP berlaku untuk mereka.
//  4. Selain itu: pengguna harus operator produksi AKTIF dan pemegang penugasan tahap itu (403 bila bukan).
//  5. Gerbang QC (requiresQc) TIDAK diatur di sini: kontraknya tetap (UNIT_STAGE_WRITE untuk mulai, QC_WRITE untuk putusan).
// Izin TIDAK diperluas: fungsi ini hanya MENAMBAH pagar di atas izin yang sudah ada; ia tidak pernah memberi akses baru.
import { laneOfStage } from "./v1WorkerQueue.js";

export const V1_ACTOR_CODES = Object.freeze({
  UNRESOLVED: "UNIT_V1_STAGE_UNRESOLVED",
  CHANGED: "UNIT_V1_STAGE_CHANGED",
  NOT_ASSIGNED: "UNIT_V1_STAGE_NOT_ASSIGNED",
  NOT_OPERATOR: "UNIT_V1_NOT_OPERATOR",
  NOT_YOURS: "UNIT_V1_NOT_YOUR_ASSIGNMENT",
});

const deny = (status, code, message) => ({ ok: false, status, code, message });
const label = (stage) => `"${stage?.labelId || stage?.code || "tahap"}"`;

/** Tahap lantai yang diatur penugasan PIC (Meja/Corner). Gerbang QC dikecualikan (kontrak QC sendiri). */
export const isOperatorGatedStage = (stage) => {
  const lane = laneOfStage(stage);
  return lane === "TABLE" || lane === "CORNER";
};

/**
 * @param {object} p
 * @param {{stage: object|null, state: string}} p.target          hasil resolveCurrentTarget (engine) — tahap kanonik SEKARANG
 * @param {string|null} p.requestedStageId                         tahap yang dituju permintaan (null untuk "mulai", yang selalu menuju tahap sekarang)
 * @param {{operatorId: string|null}|null} p.assignment            penugasan (unit, tahap sekarang) atau null
 * @param {{id: string, active: boolean}|null} p.operator          ProductionOperator milik pengguna penekan atau null
 * @param {boolean} p.override                                     pengguna aktif memegang PRODUCTION_EXECUTE_ANY
 * @returns {{ok: true, via: "ASSIGNED"|"OVERRIDE"|"QC_GATE"} | {ok: false, status: number, code: string, message: string}}
 */
export function decideV1StageActor({ target, requestedStageId = null, assignment = null, operator = null, override = false }) {
  const stage = target?.stage ?? null;
  if (!stage || target?.state === "MISMATCH") {
    return deny(409, V1_ACTOR_CODES.UNRESOLVED, "Tahap unit sekarang tidak ditemukan di jalur layanan saat ini — hubungi Production Lead");
  }
  if (requestedStageId && requestedStageId !== stage.id) {
    return deny(409, V1_ACTOR_CODES.CHANGED, `Tahap unit sudah berubah — tahap aktif sekarang ${label(stage)}. Muat ulang daftar kerja; aksi tidak dijalankan.`);
  }
  if (!isOperatorGatedStage(stage)) return { ok: true, via: "QC_GATE" };
  if (!assignment?.operatorId) {
    return deny(409, V1_ACTOR_CODES.NOT_ASSIGNED, `Tahap ${label(stage)} belum ditugaskan ke PIC — minta Production Lead menugaskannya dulu`);
  }
  if (override) return { ok: true, via: "OVERRIDE" };
  if (!operator || !operator.active) {
    return deny(403, V1_ACTOR_CODES.NOT_OPERATOR, "Akun Anda bukan PIC produksi yang aktif — tidak bisa mengerjakan tahap ini");
  }
  if (assignment.operatorId !== operator.id) {
    return deny(403, V1_ACTOR_CODES.NOT_YOURS, `Tahap ${label(stage)} ditugaskan ke PIC lain — pekerjaan ini sudah dialihkan, bukan lagi milik Anda`);
  }
  return { ok: true, via: "ASSIGNED" };
}
