// Pembaca matriks dokumentasi produksi V2 (P10B) — BACA-SAJA. SATU-SATUNYA tempat matriks dirakit dari data kanonis; dipakai
// Aplikasi Dokumentasi (antrean + detail), Unit 360, Laporan Produksi (dan siap dipakai Aplikasi Meja/Corner/QC). Tidak menulis apa pun.
// Sumber foto (semuanya DIHITUNG, bukan disalin): bukti tahap (production_step_evidence_v2 non-DOC), baris dokumentasi
// (production_step_evidence_v2 DOC_*), foto pickup driver / foto identitas unit, foto diagnosis, foto QC, semua lewat URL bertanda-tangan.
import { applicableStepsFor } from "./productionStepCommandService.js";
import { resolveUnitPhoto } from "./productionUnitPhotoService.js";
import { signEvidenceUrl } from "../routes/productionEvidenceMedia.js";
import { signUnitPhotoUrl } from "../routes/productionUnitPhoto.js";
import { buildDocumentationMatrix, deriveNextStepNo, parseDocRows, LEGACY_PHOTO_PREFIX } from "../lib/domain/productionDocumentation.js";
import { STEP_BY_NO } from "../lib/domain/productionSteps.js";


export async function buildRunDocumentation(prisma, run, ctx) {
  const evidence = ctx.evidence || [];
  const docs = ctx.documentation || [];
  const actorIds = [...new Set([...evidence, ...docs].map((e) => e.actorId).filter(Boolean))];
  const users = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const stepMedia = new Map();
  for (const e of evidence) {
    const list = stepMedia.get(e.stepNo) || [];
    for (const m of Array.isArray(e.media) ? e.media : []) {
      const url = signEvidenceUrl(m.url);
      if (url) list.push({ url, kind: m.kind || "image", evidenceId: e.id, actorName: nameOf.get(e.actorId) ?? null, createdAt: e.createdAt, stepLabel: STEP_BY_NO[e.stepNo]?.label ?? null });
    }
    stepMedia.set(e.stepNo, list);
  }

  const [unitPhoto, diagnosis, inspections] = await Promise.all([
    resolveUnitPhoto(prisma, run.unitId),
    prisma.diagnosisReport.findFirst({ where: { runId: run.id }, orderBy: { createdAt: "desc" }, select: { photoUrls: true, createdAt: true } }),
    prisma.qualityInspection.findMany({ where: { runId: run.id }, orderBy: { version: "asc" }, include: { items: { select: { photoUrls: true } } } }),
  ]);
  // Foto pickup driver dihitung ke "Pickup / tiba"; foto identitas manual (Lead) tetap foto Manual di kategori yang sama.
  const pickupPhoto = unitPhoto ? { url: signUnitPhotoUrl(run.unitId), createdAt: null, source: unitPhoto.source } : null;
  const diagnosisPhotos = (diagnosis?.photoUrls || []).map((u) => ({ url: signEvidenceUrl(u), kind: "image", createdAt: diagnosis.createdAt })).filter((m) => m.url);
  const qcPhotos = inspections.flatMap((q) => q.items.flatMap((i) => (i.photoUrls || []).filter((u) => LEGACY_PHOTO_PREFIX.test(u)).map((u) => ({ url: u, kind: "image", createdAt: q.inspectedAt ?? q.createdAt })))).filter((m, idx, arr) => arr.findIndex((x) => x.url === m.url) === idx);

  const docRows = parseDocRows(docs).map((r) => ({
    ...r, actorName: nameOf.get(r.actorId) ?? null,
    items: r.items.map((it) => ({ ...it, url: signEvidenceUrl(it.url) })).filter((it) => it.url),
  }));
  const started = run.status !== "PENDING_ARRIVAL" && ((run.operations?.length ?? 0) > 0 || evidence.length > 0);
  const matrix = buildDocumentationMatrix({
    applicableSteps: applicableStepsFor(ctx.split),
    recordedSteps: new Set(evidence.map((e) => e.stepNo)),
    nextStepNo: deriveNextStepNo(new Set(evidence.map((e) => e.stepNo))),
    started,
    run: { origin: run.origin, status: run.status },
    qcDone: inspections.length > 0,
    stepMedia,
    extra: { pickupPhoto: pickupPhoto ? { url: pickupPhoto.url, createdAt: pickupPhoto.createdAt } : null, diagnosisPhotos, qcPhotos },
    docRows,
  });
  // Foto identitas manual (bukan driver) ditandai Manual, bukan Driver Pickup.
  if (pickupPhoto?.source === "PRODUCTION_MANUAL") {
    const cat = matrix.categories.find((c) => c.key === "PICKUP_ARRIVAL");
    for (const it of cat.items) if (it.origin === "PICKUP") it.source = "MANUAL";
  }
  return matrix;
}

// Foto dokumentasi dalam bentuk bucket before/process/after yang dipakai Unit 360 & Laporan (sudah ada), supaya foto yang baru
// terkirim langsung tampil di UI lama tanpa menunggu perubahan layar. Hanya item DOKUMENTASI (bukan foto tahap; itu sudah ada di bucket).
export function documentationBuckets(matrix) {
  const out = { before: [], process: [], after: [] };
  const key = { BEFORE: "before", PROCESS: "process", AFTER: "after" };
  for (const c of matrix.categories) {
    for (const it of c.items) {
      if (it.origin !== "DOC") continue;
      out[key[c.group]].push({ stepNo: null, stepLabel: c.label, kind: it.kind, url: it.url, source: it.source, caption: it.caption, documentation: true, category: c.key });
    }
  }
  return out;
}

// Ringkas untuk kartu antrean (tanpa item).
export function summarizeMatrix(matrix) {
  return {
    photos: matrix.totals.photos, required: matrix.totals.required, satisfied: matrix.totals.satisfied,
    missing: matrix.missing, missingBy: matrix.missingBy, missingTotal: matrix.missingTotal, flags: matrix.flags,
  };
}
