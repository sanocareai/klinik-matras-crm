// Production Core Slice 4 — logika MURNI untuk Production Route/Work
// Center/Operator. Tidak menyentuh Prisma/database — diberi data yang
// sudah di-load pemanggil (unitStageEngine.js / routes/*.js), kembalikan
// hasil turunan. Lihat tests/productionRouting.test.js.
//
// SATU PRINSIP PALING PENTING: file ini TIDAK PERNAH menghitung ULANG
// jalur produksi sendiri (buildUnitPath/getNextStage TETAP satu-satunya
// sumber kebenaran, lib/domain/routing.js, TIDAK diubah slice ini). File
// ini murni mengolah OUTPUT dari situ (path yang sudah dihitung) menjadi
// snapshot rute / visualisasi / validasi skill — lapisan DI ATAS, bukan
// pengganti.

/**
 * Ubah jalur LIVE (hasil buildUnitPath — array RoutingStage, urut) jadi
 * baris ProductionRouteStage siap-simpan (Slice 4A/4B/4D). Murni
 * transformasi bentuk data + resolusi Work Center default — TIDAK
 * menyentuh database.
 *
 * `required` dibalik dari RoutingStage.isOptional SAAT snapshot dibuat
 * (Slice 4C: "implement only what current engine can support safely" —
 * runtime SKIP tetap jalan seperti biasa lewat unitStageEngine.js,
 * `required` di sini murni LABEL rencana, bukan penegak aturan baru).
 *
 * @param {{id:string, isOptional:boolean, defaultWorkCenterId?:string|null}[]} path
 * @returns {{stageId:string, sequence:number, required:boolean, workCenterId:string|null}[]}
 */
export function buildRouteStageSnapshot(path) {
  return (path || []).map((stage, i) => ({
    stageId: stage.id,
    sequence: i + 1,
    required: !stage.isOptional,
    workCenterId: stage.defaultWorkCenterId ?? null,
  }));
}

/**
 * true kalau route boleh DIGANTI untuk unit ini (Slice 4Q — "Route Change
 * After Production Start"). Sekali unit punya SATU baris eksekusi apa pun
 * (unit_stage_logs), ganti rute ditolak — bukan tugas slice ini untuk
 * menangani migrasi kerja yang sudah berjalan ke jalur baru (itu wilayah
 * Scope Revision, Slice 4R, sengaja TIDAK disatukan di sini).
 *
 * @param {{hasExecutionHistory:boolean}} params
 */
export function canReplaceRoute({ hasExecutionHistory }) {
  return !hasExecutionHistory;
}

/**
 * Gabungkan snapshot ProductionRouteStage (urutan/required/work center
 * TETAP dari saat diprovisioning) dengan status LIVE per tahap (timeline
 * yang sudah dihitung endpoint, lihat routes/units.js) jadi bentuk
 * visualisasi ✓/●/○ (Slice 4J). Baris snapshot yang stageId-nya SUDAH
 * TIDAK ADA di timeline live (routing berubah sejak snapshot diambil —
 * langka tapi mungkin) tetap ditampilkan APA ADANYA dengan status
 * UNKNOWN, bukan disembunyikan diam-diam (kejujuran historis).
 *
 * @param {{stageId:string, sequence:number, required:boolean, workCenterId:string|null}[]} routeStages
 * @param {Record<string,string>} liveStatusByStageId - stageId -> status (NOT_STARTED/IN_PROGRESS/PAUSED/BLOCKED/DONE/SKIPPED)
 * @param {string|null} currentStageId
 */
export function mapRouteStagesToVisualization(routeStages, liveStatusByStageId, currentStageId) {
  return (routeStages || [])
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((rs) => {
      const status = liveStatusByStageId[rs.stageId] ?? "UNKNOWN";
      const marker = status === "DONE" || status === "SKIPPED" ? "DONE"
        : rs.stageId === currentStageId ? "CURRENT"
        : "PENDING";
      return { ...rs, status, marker };
    });
}

/**
 * Validasi kecocokan skill operator utk sebuah tahap (Slice 4G/4H) —
 * SELALU mengembalikan WARNING, TIDAK PERNAH memblokir (spec eksplisit:
 * "skill mismatch should primarily be WARNING not hard blocking... Do not
 * make incomplete initial skill data prevent production"). Pemanggil
 * (routes/units.js) TETAP mengizinkan assignment berjalan, cuma
 * menyertakan warning ini di respons untuk ditampilkan ke supervisor.
 *
 * @param {{stageId:string, level:number, active:boolean}[]} operatorSkills
 * @param {string} stageId
 * @returns {{hasSkill:boolean, level:number|null, warning:string|null}}
 */
export function deriveSkillWarning(operatorSkills, stageId) {
  const skill = (operatorSkills || []).find((s) => s.stageId === stageId && s.active !== false);
  if (!skill) {
    return {
      hasSkill: false, level: null,
      warning: "Operator ini belum punya data skill tercatat untuk tahap ini — tetap bisa ditugaskan, tapi perlu diperhatikan supervisor.",
    };
  }
  return { hasSkill: true, level: skill.level, warning: null };
}

/** Nilai level skill yang sah (Slice 4G). */
export const OPERATOR_SKILL_LEVELS = [1, 2, 3, 4, 5];

/**
 * Work Center yang BERLAKU untuk tahap sekarang sebuah unit (Slice 4E:
 * "allow an execution or assignment to override the default where
 * authorized") — StageAssignment.workCenterId MENANG kalau ada (override
 * per unit), fallback ke RoutingStage.defaultWorkCenterId (berlaku untuk
 * SEMUA unit termasuk yang belum pernah ditugaskan/unit lama).
 *
 * @param {{workCenterId?:string|null}|null} assignment - StageAssignment tahap sekarang, atau null
 * @param {{defaultWorkCenterId?:string|null}|null} stage - RoutingStage tahap sekarang
 */
export function resolveEffectiveWorkCenterId(assignment, stage) {
  return assignment?.workCenterId ?? stage?.defaultWorkCenterId ?? null;
}
