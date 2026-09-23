export const LEGACY_PRODUCTION_PHASE_TO_V2 = Object.freeze({
  INTAKE: "INTAKE",
  MODULE: "PROCESS",
  FINISH: "QC",
});

export function legacyProductionPhaseToV2(phase) {
  return phase ? LEGACY_PRODUCTION_PHASE_TO_V2[phase] || null : null;
}

