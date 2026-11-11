// MODEL MURNI putusan QC — CERMIN frontend/src/features/production/qcHandoff.js (validateInspectionForm, buildInspectionBody,
// reworkStageOptions) dan componentNotesModel.js#decisionGate. Server (productionQcHandoffCommandService) tetap menegakkan ulang:
// izin QC_WRITE, revisi Run, foto, gerbang putaran (QC_*_REQUIRED). Waive & override preferensi customer tetap di Hub QC web.

export type ProfilQc = "KASUR" | "GENERIC";
export type ModeQc = "PASS" | "FAIL";
export const VERDICT_GAGAL = [
  { value: "TERLALU_KERAS", label: "Terlalu keras" },
  { value: "TERLALU_EMPUK", label: "Terlalu empuk" },
] as const;
export type VerdictGagal = (typeof VERDICT_GAGAL)[number]["value"];

export type FormQc = { mode: ModeQc; photoUrls: string[]; referenceWeightKg: string; fitVerdict: VerdictGagal | "PAS"; note: string; reworkStageId: string };

export type TahapRun = { id: string; code: string; label: string; order: number; isQcGate: boolean };

/** Tahap rework yang boleh dipilih: SEBELUM gerbang QC (unit wajib diuji lagi). */
export function opsiRework(stages: TahapRun[] | undefined): TahapRun[] {
  const s = stages ?? [];
  const gate = s.find((x) => x.isQcGate);
  if (!gate) return [];
  return s.filter((x) => !x.isQcGate && x.order < gate.order);
}

type Assembly = {
  applicable?: boolean; round?: number; hasFoundation?: boolean;
  current?: { foundationTest?: { ok?: boolean } | null; after?: { ok?: boolean } | null; wholeTest?: { ok?: boolean } | null };
};

/** Gerbang LULUS putaran ini (uji fondasi baru bila ada fondasi, hasil aktual susunan, uji kasur jadi). Gagal → rework selalu boleh. */
export function gerbangLulus(a: Assembly | null | undefined): { ok: boolean; pesan: string; bagian: string[] } {
  if (!a?.applicable) return { ok: true, pesan: "", bagian: [] };
  const c = a.current ?? {};
  const kurang: string[] = []; const ada: string[] = [];
  if (a.hasFoundation) (c.foundationTest?.ok ? ada : kurang).push("uji fondasi baru");
  (c.after?.ok ? ada : kurang).push("hasil aktual susunan");
  (c.wholeTest?.ok ? ada : kurang).push("uji kasur jadi");
  return {
    ok: kurang.length === 0,
    bagian: ada,
    pesan: kurang.length ? `Belum lengkap untuk putaran ${a.round ?? 1}: ${kurang.join("; ")}. Catat di Catatan Komponen (SANSS Web) dulu. Gagal → rework tetap bisa diputuskan.` : "",
  };
}

export function validasiQc(f: FormQc, profil: ProfilQc): string | null {
  if (f.photoUrls.length === 0) return "Foto bukti wajib untuk hasil Lulus/Gagal.";
  if (profil === "KASUR") {
    const w = Number(f.referenceWeightKg);
    if (!Number.isInteger(w) || w <= 0) return "Berat acuan (kg, bilangan bulat) wajib diisi.";
  }
  if (f.mode === "FAIL") {
    if (profil === "KASUR" && !VERDICT_GAGAL.some((v) => v.value === f.fitVerdict)) return "Pilih hasil uji: terlalu keras atau terlalu empuk.";
    if (f.note.trim().length < 3) return "Catatan temuan wajib diisi (minimal 3 karakter).";
    if (!f.reworkStageId) return "Tahap rework wajib dipilih.";
  }
  return null;
}

/** Body POST /production-planning/qc/runs/:runId/inspect — bentuk SAMA dengan buildInspectionBody web (tanpa waive/override/bahan tambahan). */
export function bodyQc(f: FormQc, expectedRevision: number, profil: ProfilQc): Record<string, unknown> {
  const note = f.note.trim() || undefined;
  if (profil === "GENERIC") {
    return { expectedRevision, result: f.mode, photoUrls: f.photoUrls, note, ...(f.mode === "FAIL" ? { reworkStageId: f.reworkStageId } : {}) };
  }
  const body: Record<string, unknown> = { expectedRevision, result: f.mode, photoUrls: f.photoUrls, referenceWeightKg: Number(f.referenceWeightKg), note };
  if (f.mode === "PASS") body.fitVerdict = "PAS";
  else { body.fitVerdict = f.fitVerdict; body.reworkStageId = f.reworkStageId; }
  return body;
}
