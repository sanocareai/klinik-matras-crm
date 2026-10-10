// Command owner Diagnosis Produksi + Planned BOM Terpadu (P9D). SATU-SATUNYA penulis diagnosis_reports_v2 /
// diagnosis_manual_materials_v2.
//
// Reuse (TIDAK menduplikasi logika manapun):
//  - P3 (productionPlanningCommandService.js): loadPlanForWrite (kunci+muat plan), setPlannedBOMInTx (susun
//    Planned BOM, row lock material deterministik, release reservasi ACTIVE atomik bila BOM berubah).
//  - P5 (productionWorkshopExecutionCommandService.js): loadRunForWrite (kunci+muat run), authorizeOperator
//    (operator yang di-assign ke plan ini SAJA yang boleh menulis — sama gate dengan tahap 1-12).
//  - Slice 1 (productionRouting.js): tryProvisionUnitRoute, dipanggil SETELAH Unit.serviceId ditulis — pola
//    SAMA persis dengan PATCH /api/units/:id/service (routes/units.js) supaya jalur produksi ikut terhitung
//    ulang, best-effort/tidak pernah menggagalkan submit diagnosis kalau gagal.
//
// Kontrak:
//  - `findings`: JSON bebas terstruktur (lihat validateFindings) — reuse kolom `findings` yang sudah ada di
//    DiagnosisReport sejak P8 (dormant, 0 baris, 0 kode menulisnya sebelum P9D — diverifikasi `grep -rl
//    diagnosisReport src/` kosong).
//  - status: DRAFT (operator assigned, disimpan DI TEMPAT berulang, `revision` bertambah tiap simpan) ->
//    RECORDED (= "SUBMITTED" bahasa tugas P9D; expectedRevision wajib). RECORDED yang direvisi lagi membuat
//    VERSI BARU (`version`+1, RECORDED langsung, versi lama SUPERSEDED) — bukan diedit di tempat lagi.
//  - submitDiagnosis MENULIS Planned BOM (setPlannedBOMInTx) + Unit.serviceId + provisioning rute DALAM SATU
//    TRANSAKSI dengan penulisan DiagnosisReport — gagal di mana pun (mis. stok material tidak aktif) ROLLBACK
//    PENUH (jaminan native prisma.$transaction), findings/foto TIDAK pernah tersimpan sebagian.
//  - Bahan manual/noncatalog (DiagnosisManualMaterial): dicatat APA ADANYA (deskripsi/qty/alasan operator TIDAK
//    PERNAH ditimpa), status NEEDS_MAPPING. TIDAK PERNAH masuk Planned BOM/direservasi sampai dipetakan
//    (mapManualMaterial, dipanggil pemegang UNIT_ROUTING_WRITE lewat route) — pemetaan menambah baris BOM asli
//    lewat setPlannedBOMInTx yang SAMA.
//  - TIDAK PERNAH menulis stock_movements/jurnal/HPP — setPlannedBOMInTx sendiri (direuse, bukan ditulis ulang)
//    juga berhenti di reservasi (P3), tidak pernah mengurangi stok fisik.
//  - Writer di balik production_v2_writer (cohort unitIds, fail-closed) — SAMA flag dengan P3/P5.
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";
import { authorizeOperator, loadRunForWrite } from "./productionWorkshopExecutionCommandService.js";
import { loadPlanForWrite, setPlannedBOMInTx, assertPlanBOMLines } from "./productionPlanningCommandService.js";
import { tryProvisionUnitRoute } from "./productionRouting.js";
import { resolveProductionServiceForUnit } from "./productionSettingsService.js";
import { normalizeMedia } from "../lib/domain/productionSteps.js";
import { signEvidenceUrl } from "../routes/productionEvidenceMedia.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,128}$/;
const FOUNDATION_ACTIONS = Object.freeze(["KEEP", "REINFORCE", "REPLACE"]);
const LAYER_ACTIONS = Object.freeze(["KEEP", "REMOVE", "REPLACE"]);
const DAMAGE_LEVELS = Object.freeze(["RINGAN", "SEDANG", "BERAT"]);

function diagError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}

export function assertIdempotencyKey(key) {
  if (!key || !IDEMPOTENCY_KEY.test(key)) throw diagError("Idempotency-Key wajib diisi (12-128 karakter)", 400, "IDEMPOTENCY_KEY_INVALID");
}

// SENGAJA terpisah dari assertExpectedRevision P3/P5 (yang menolak < 1) — diagnosis BARU (belum ada baris sama
// sekali) sah memakai expectedRevision 0, bukan null/undefined (tetap WAJIB dikirim, "expectedRevision wajib").
export function assertExpectedDiagnosisRevision(value) {
  const revision = Number(value);
  if (value == null || value === "" || !Number.isInteger(revision) || revision < 0) {
    throw diagError("expectedRevision wajib diisi (angka bulat >= 0)", 400, "EXPECTED_REVISION_REQUIRED");
  }
  return revision;
}

const text = (value, min, label, max = 4000) => {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length < min) throw diagError(`${label} wajib diisi (minimal ${min} karakter)`, 400, "DIAGNOSIS_FIELD_INVALID", { field: label });
  if (s.length > max) throw diagError(`${label} terlalu panjang (maksimal ${max} karakter)`, 400, "DIAGNOSIS_FIELD_INVALID", { field: label });
  return s;
};
const optionalText = (value, label, max = 2000) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw diagError(`${label} tidak valid`, 400, "DIAGNOSIS_FIELD_INVALID", { field: label });
  const s = value.trim();
  if (s.length > max) throw diagError(`${label} terlalu panjang (maksimal ${max} karakter)`, 400, "DIAGNOSIS_FIELD_INVALID", { field: label });
  return s || null;
};
const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw diagError(`${label} tidak valid (pilih salah satu: ${allowed.join(", ")})`, 400, "DIAGNOSIS_FIELD_INVALID", { field: label });
  return value;
};
const positiveNumberOrNull = (value, label, { max = 1000 } = {}) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > max) throw diagError(`${label} harus berupa angka lebih dari 0`, 400, "DIAGNOSIS_FIELD_INVALID", { field: label });
  return Math.round(n * 100) / 100;
};

// Bentuk `findings` — DIVALIDASI PENUH hanya saat SUBMIT (final=true); saat DRAFT (final=false) semua
// sub-bagian OPSIONAL supaya operator bisa menyimpan progres parsial tanpa mengisi semua section dulu.
function validateFindings(input, { final }) {
  const f = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  const general = f.general && typeof f.general === "object" ? f.general : {};
  const generalOut = {
    condition: final ? text(general.condition, 3, "Kondisi kasur") : optionalText(general.condition, "Kondisi kasur", 500),
    mainDamage: final ? text(general.mainDamage, 3, "Kerusakan utama") : optionalText(general.mainDamage, "Kerusakan utama", 500),
    damageLevel: general.damageLevel ? oneOf(general.damageLevel, DAMAGE_LEVELS, "Tingkat kerusakan") : (final ? oneOf(undefined, DAMAGE_LEVELS, "Tingkat kerusakan") : null),
    teardownNote: optionalText(general.teardownNote, "Catatan hasil bongkar", 2000),
  };

  const foundation = f.foundation && typeof f.foundation === "object" ? f.foundation : {};
  const foundationAction = foundation.action ?? null;
  const foundationOut = {
    oldCondition: optionalText(foundation.oldCondition, "Kondisi fondasi lama", 500),
    action: foundationAction ? oneOf(foundationAction, FOUNDATION_ACTIONS, "Tindakan fondasi") : (final ? oneOf(undefined, FOUNDATION_ACTIONS, "Tindakan fondasi") : null),
    size: optionalText(foundation.size, "Ukuran fondasi", 200),
    qty: positiveNumberOrNull(foundation.qty, "Jumlah fondasi"),
    note: optionalText(foundation.note, "Catatan fondasi", 1000),
  };

  const layersInput = Array.isArray(f.layers) ? f.layers : [];
  if (layersInput.length > 10) throw diagError("Maksimal 10 baris lapisan", 400, "DIAGNOSIS_FIELD_INVALID", { field: "layers" });
  const layersOut = layersInput.map((l, i) => ({
    oldCondition: optionalText(l?.oldCondition, `Kondisi lapisan #${i + 1}`, 500),
    action: l?.action ? oneOf(l.action, LAYER_ACTIONS, `Tindakan lapisan #${i + 1}`) : null,
    material: optionalText(l?.material, `Material lapisan #${i + 1}`, 200),
    thickness: optionalText(l?.thickness, `Ketebalan lapisan #${i + 1}`, 100),
    density: optionalText(l?.density, `Density lapisan #${i + 1}`, 100),
    qty: positiveNumberOrNull(l?.qty, `Jumlah lapisan #${i + 1}`),
    note: optionalText(l?.note, `Catatan lapisan #${i + 1}`, 500),
  }));

  const components = f.components && typeof f.components === "object" ? f.components : {};
  const compField = (v, label) => optionalText(v, label, 500);
  const componentsOut = {
    spring: compField(components.spring, "Per/spring"),
    cover: compField(components.cover, "Kain/cover"),
    quilting: compField(components.quilting, "Quilting"),
    glue: compField(components.glue, "Lem"),
    wood: compField(components.wood, "Kayu"),
    other: Array.isArray(components.other) ? components.other.slice(0, 10).map((o, i) => optionalText(typeof o === "string" ? o : o?.note, `Komponen lain #${i + 1}`, 300)).filter(Boolean) : [],
  };

  const serviceNote = final ? text(f.serviceNote, 10, "Kesimpulan diagnosis", 4000) : optionalText(f.serviceNote, "Kesimpulan diagnosis", 4000);

  return { general: generalOut, foundation: foundationOut, layers: layersOut, components: componentsOut, serviceNote };
}

function normalizeManualMaterials(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw diagError("Daftar bahan manual tidak valid", 400, "DIAGNOSIS_MANUAL_MATERIAL_INVALID");
  if (input.length > 20) throw diagError("Maksimal 20 bahan manual per diagnosis", 400, "DIAGNOSIS_MANUAL_MATERIAL_INVALID");
  return input.map((m, i) => ({
    description: text(m?.description, 2, `Bahan manual #${i + 1}: nama/deskripsi`, 300),
    estimatedUnit: optionalText(m?.estimatedUnit, `Bahan manual #${i + 1}: satuan perkiraan`, 50),
    qty: (() => {
      const n = Number(m?.qty);
      if (!Number.isFinite(n) || n <= 0) throw diagError(`Bahan manual #${i + 1}: jumlah wajib diisi dan lebih dari 0`, 400, "DIAGNOSIS_MANUAL_MATERIAL_INVALID");
      return n;
    })(),
    reason: text(m?.reason, 3, `Bahan manual #${i + 1}: alasan tidak ada di katalog`, 500),
  }));
}

function normalizePhotoUrls(urls, { min = 0 } = {}) {
  const media = normalizeMedia(urls);
  if (media.length < min) throw diagError(`Wajib melampirkan minimal ${min} foto/video diagnosis`, 422, "DIAGNOSIS_PHOTO_REQUIRED");
  return media.map((m) => m.url);
}

async function assertWriterEnabledForUnit(tx, unitId) {
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  if (!isProductionWriterEnabledFor(state, unitId)) {
    throw diagError("Unit ini belum diaktifkan untuk alur produksi baru; kerjakan lewat bagian Pekerjaan unit (alur biasa)", 503, "DIAGNOSIS_WRITER_OFF");
  }
}

// Baris non-SUPERSEDED terbaru untuk run ini (DRAFT atau RECORDED), atau null. HARUS dipanggil setelah run
// (production_runs_v2) dikunci FOR UPDATE oleh pemanggil — menyerialkan draft-save/submit bersamaan.
async function loadLatestDiagnosis(tx, runId) {
  return tx.diagnosisReport.findFirst({
    where: { runId, status: { in: ["DRAFT", "RECORDED"] } },
    orderBy: { version: "desc" },
    include: { manualMaterials: true },
  });
}

function assertDiagnosisRevision(latest, expectedRevision) {
  const current = latest?.revision ?? 0;
  if (current !== expectedRevision) {
    throw diagError(`Revisi diagnosis berubah: diharapkan ${expectedRevision}, sekarang ${current}. Muat ulang.`, 409, "DIAGNOSIS_REVISION_CONFLICT", { revision: current });
  }
}

async function loadRunAndAuthorize(tx, { runId, actorId, workCenterId }) {
  const run = await loadRunForWrite(tx, runId);
  await assertWriterEnabledForUnit(tx, run.unitId);
  const plan = await authorizeOperator(tx, run, actorId, workCenterId, { postQc: false });
  return { run, plan };
}

// ---------------------------------------------------------------------------
// 1. Simpan draft (operator assigned SAJA). Baris DIBUAT sekali (version=1, DRAFT) lalu DIPERBARUI DI TEMPAT
//    selama masih DRAFT — TIDAK PERNAH dipanggil lagi setelah RECORDED (lihat submitDiagnosis untuk revisi).
// ---------------------------------------------------------------------------
export async function saveDiagnosisDraft(prisma, { runId, actorId, workCenterId, expectedRevision, findings, photoUrls, recommendedServiceId, manualMaterials }) {
  const revisionExpected = assertExpectedDiagnosisRevision(expectedRevision);
  const validatedFindings = validateFindings(findings, { final: false });
  const media = normalizePhotoUrls(photoUrls);
  const validatedManual = normalizeManualMaterials(manualMaterials);

  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "production_runs_v2", runId);
    const { run } = await loadRunAndAuthorize(tx, { runId, actorId, workCenterId });
    const latest = await loadLatestDiagnosis(tx, run.id);
    if (latest?.status === "RECORDED") {
      throw diagError("Diagnosis unit ini sudah dikirim — gunakan revisi (submit ulang), bukan simpan draft", 409, "DIAGNOSIS_ALREADY_RECORDED");
    }
    assertDiagnosisRevision(latest, revisionExpected);

    const now = new Date();
    let report;
    if (latest) {
      report = await tx.diagnosisReport.update({
        where: { id: latest.id },
        data: { revision: latest.revision + 1, findings: validatedFindings, photoUrls: media, recommendedServiceId: recommendedServiceId || null, diagnosedById: actorId || null },
      });
      // Ganti-total daftar bahan manual draft — HANYA yang MASIH NEEDS_MAPPING; bahan yang SUDAH dipetakan
      // Production Lead (status MAPPED) tidak pernah disentuh/dihapus oleh simpan-draft berikutnya.
      await tx.diagnosisManualMaterial.deleteMany({ where: { diagnosisReportId: latest.id, status: "NEEDS_MAPPING" } });
      if (validatedManual.length) {
        await tx.diagnosisManualMaterial.createMany({
          data: validatedManual.map((m) => ({ diagnosisReportId: report.id, ...m, createdById: actorId || null })),
        });
      }
    } else {
      report = await tx.diagnosisReport.create({
        data: {
          runId: run.id, version: 1, revision: 1, status: "DRAFT",
          findings: validatedFindings, photoUrls: media, recommendedServiceId: recommendedServiceId || null, diagnosedById: actorId || null,
          manualMaterials: validatedManual.length ? { create: validatedManual.map((m) => ({ ...m, createdById: actorId || null })) } : undefined,
        },
      });
    }
    return { diagnosisId: report.id, version: report.version, revision: report.revision, status: report.status };
  });
}

// ---------------------------------------------------------------------------
// 2. Submit (= SUBMITTED). Menulis Planned BOM (setPlannedBOMInTx) + Unit.serviceId + provisioning rute DALAM
//    SATU TRANSAKSI dengan DiagnosisReport. Bahan manual dicatat NEEDS_MAPPING (tidak masuk BOM).
// ---------------------------------------------------------------------------
export async function submitDiagnosis(prisma, { runId, actorId, workCenterId, expectedRevision, findings, photoUrls, recommendedServiceId, materials, manualMaterials }) {
  const revisionExpected = assertExpectedDiagnosisRevision(expectedRevision);
  const validatedFindings = validateFindings(findings, { final: true });
  const media = normalizePhotoUrls(photoUrls, { min: 1 });
  const validatedManual = normalizeManualMaterials(manualMaterials);
  // Slice 2: operator TIDAK dimintai layanan teknis. recommendedServiceId (klien lama) tetap diterima bila dikirim; bila kosong, layanan diturunkan dari pemetaan Sales->produksi
  // kanonis (price_items.production_service_id) atau layanan historis unit. Tanpa itu: 409 DIAGNOSIS_SERVICE_MAPPING_NEEDED (kebutuhan konfigurasi Admin; draf tetap tersimpan).
  const bomLines = Array.isArray(materials) ? materials : [];
  if (bomLines.length) assertPlanBOMLines(bomLines);

  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "production_runs_v2", runId);
    const { run } = await loadRunAndAuthorize(tx, { runId, actorId, workCenterId });

    const resolvedService = recommendedServiceId
      ? { serviceId: recommendedServiceId, source: "EXPLICIT" }
      : await resolveProductionServiceForUnit(tx, run.unit);
    recommendedServiceId = resolvedService.serviceId;
    const service = await tx.serviceCatalog.findUnique({ where: { id: recommendedServiceId } });
    if (!service || !service.active) throw diagError("Layanan produksi tidak ditemukan atau nonaktif di katalog — Admin perlu memperbaiki pemetaan di Pengaturan Produksi", 409, "DIAGNOSIS_SERVICE_NOT_FOUND", { needs: "ADMIN_CONFIGURATION" });

    const latest = await loadLatestDiagnosis(tx, run.id);
    assertDiagnosisRevision(latest, revisionExpected);

    const now = new Date();
    let report;
    let version;
    if (latest?.status === "RECORDED") {
      // Revisi diagnosis yang SUDAH dikirim: versi lama SUPERSEDED, versi baru RECORDED langsung.
      await tx.diagnosisReport.update({ where: { id: latest.id }, data: { status: "SUPERSEDED" } });
      version = latest.version + 1;
    } else {
      version = latest?.version ?? 1;
    }
    const data = {
      runId: run.id, version, revision: 1, status: "RECORDED", recordedAt: now,
      findings: validatedFindings, photoUrls: media, recommendedServiceId, diagnosedById: actorId || null,
    };
    if (latest && latest.status !== "RECORDED") {
      report = await tx.diagnosisReport.update({ where: { id: latest.id }, data });
      await tx.diagnosisManualMaterial.deleteMany({ where: { diagnosisReportId: latest.id, status: "NEEDS_MAPPING" } });
    } else {
      report = await tx.diagnosisReport.create({ data });
    }
    if (validatedManual.length) {
      await tx.diagnosisManualMaterial.createMany({ data: validatedManual.map((m) => ({ diagnosisReportId: report.id, ...m, createdById: actorId || null })) });
    }

    // Planned BOM — HANYA bahan katalog (bomLines); bahan manual TIDAK PERNAH masuk sini sampai dipetakan.
    let bomResult = { lineCount: 0, releasedReservations: 0 };
    if (bomLines.length) {
      const plan = await loadPlanForWrite(tx, run.plan.id);
      bomResult = await setPlannedBOMInTx(tx, { plan, lines: bomLines, actorId });
    }

    // Layanan teknis: SAMA pola dengan PATCH /api/units/:id/service (routes/units.js, Slice 1) — tulis
    // Unit.serviceId hanya jika berubah, lalu provisioning rute best-effort.
    if (run.unit.serviceId !== recommendedServiceId) {
      await tx.unit.update({ where: { id: run.unitId }, data: { serviceId: recommendedServiceId, serviceLine: service.serviceLine } });
      await recordActivity(tx, {
        entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.SERVICE_ASSIGNED, actorId: actorId || null,
        metadata: { serviceId: recommendedServiceId, serviceLabel: service.labelId, serviceLine: service.serviceLine, source: "DIAGNOSIS", resolvedBy: resolvedService.source },
      });
      await tryProvisionUnitRoute(tx, run.unitId, recommendedServiceId, actorId || null);
    }

    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_DIAGNOSIS_SUBMITTED, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, version, serviceLabel: service.labelId, bomLineCount: bomResult.lineCount, manualMaterialCount: validatedManual.length },
    });

    return {
      diagnosisId: report.id, version, revision: report.revision, status: "RECORDED",
      bom: bomResult, manualMaterialCount: validatedManual.length, recommendedServiceId, serviceLabel: service.labelId,
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Pemetaan bahan manual -> Material katalog (Production Lead/Admin, UNIT_ROUTING_WRITE — diperiksa di
//    route). Menambah baris BOM ASLI lewat setPlannedBOMInTx (full-replace: mengirim SEMUA baris ACTIVE saat
//    ini + baris baru ini) — TIDAK menyentuh reservasi yang sudah CONSUMED (setPlannedBOMInTx sendiri, yang
//    direuse, sudah menjaga itu).
// ---------------------------------------------------------------------------
export async function mapManualMaterial(prisma, { manualMaterialId, materialId, qty, actorId }) {
  if (!materialId) throw diagError("Material tujuan pemetaan wajib dipilih", 400, "DIAGNOSIS_MAPPING_MATERIAL_REQUIRED");
  return prisma.$transaction(async (tx) => {
    const manual = await tx.diagnosisManualMaterial.findUnique({
      where: { id: manualMaterialId },
      include: { diagnosisReport: { include: { run: { select: { id: true, unitId: true, plan: true, unit: { select: { unitCode: true } } } } } } },
    });
    if (!manual) throw diagError("Bahan manual tidak ditemukan", 404, "DIAGNOSIS_MANUAL_MATERIAL_NOT_FOUND");
    if (manual.status === "MAPPED") throw diagError("Bahan manual ini sudah dipetakan sebelumnya", 409, "DIAGNOSIS_MANUAL_MATERIAL_ALREADY_MAPPED");
    const run = manual.diagnosisReport.run;
    await assertWriterEnabledForUnit(tx, run.unitId);
    if (!run.plan) throw diagError("Unit ini belum memiliki rencana produksi", 409, "DIAGNOSIS_PLAN_NOT_FOUND");

    const material = await tx.material.findUnique({ where: { id: materialId } });
    if (!material) throw diagError("Material tidak ditemukan", 404, "PLAN_BOM_MATERIAL_NOT_FOUND");
    if (!material.active) throw diagError(`Material ${material.code} sudah nonaktif`, 422, "PLAN_BOM_MATERIAL_INACTIVE");
    if (material.kind === "PERLENGKAPAN_STOK") throw diagError(`${material.code} adalah Perlengkapan Stok (hanya Gudang) dan tidak bisa dipetakan sebagai bahan BOM Produksi`, 422, "PLAN_BOM_MATERIAL_PERLENGKAPAN_STOK");
    const finalQty = qty != null ? Number(qty) : Number(manual.qty);
    if (!Number.isFinite(finalQty) || finalQty <= 0) throw diagError("Jumlah pemetaan harus lebih dari 0", 400, "DIAGNOSIS_MAPPING_QTY_INVALID");

    const plan = await loadPlanForWrite(tx, run.plan.id);
    const existingLines = plan.bomLines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) }));
    const merged = [...existingLines.filter((l) => l.materialId !== materialId), { materialId, qty: (existingLines.find((l) => l.materialId === materialId)?.qty || 0) + finalQty }];
    const bomResult = await setPlannedBOMInTx(tx, { plan, lines: merged, actorId });
    const newLine = await tx.plannedBOMLine.findFirst({ where: { planId: plan.id, materialId, status: "ACTIVE" } });

    const now = new Date();
    const updated = await tx.diagnosisManualMaterial.update({
      where: { id: manualMaterialId },
      data: { status: "MAPPED", mappedMaterialId: materialId, mappedQty: finalQty, mappedById: actorId || null, mappedAt: now, bomLineId: newLine?.id ?? null },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_DIAGNOSIS_MANUAL_MATERIAL_MAPPED, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, description: manual.description, materialCode: material.code },
    });
    return { manualMaterialId, status: updated.status, materialId, materialCode: material.code, bom: bomResult };
  });
}

// Semua bahan manual dari DiagnosisReport RECORDED terbaru sebuah run sudah dipetakan? (dipakai gerbang tahap 5)
export async function allManualMaterialsMapped(tx, runId) {
  const latest = await tx.diagnosisReport.findFirst({ where: { runId, status: "RECORDED" }, orderBy: { version: "desc" }, select: { id: true } });
  if (!latest) return true; // tidak ada diagnosis RECORDED -> bukan tanggung jawab gerbang ini (gerbang lain yang menahan)
  const pending = await tx.diagnosisManualMaterial.count({ where: { diagnosisReportId: latest.id, status: "NEEDS_MAPPING" } });
  return pending === 0;
}

// Diagnosis RECORDED terbaru sebuah run sudah punya Planned BOM aktif? (dipakai gerbang tahap 5)
export async function diagnosisBomValid(tx, runId, planId) {
  if (!planId) return false;
  const activeCount = await tx.plannedBOMLine.count({ where: { planId, status: "ACTIVE" } });
  return activeCount > 0;
}

// Bacaan Unit 360 + wizard (prefill draft/tampilkan hasil submit). Baris DRAFT/RECORDED terbaru + riwayat
// SUPERSEDED ringkas + bahan manual (semua status, deskripsi awal tidak pernah hilang).
export async function getDiagnosisState(prisma, runId) {
  const plan = await prisma.productionRunPlan.findFirst({ where: { runId, status: { not: "CANCELLED" } }, select: { id: true } });
  const [bomRows, current, historyRaw] = await Promise.all([
    plan ? prisma.plannedBOMLine.findMany({ where: { planId: plan.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, include: { material: { select: { id: true, code: true, name: true, unit: true } } } }) : [],
    prisma.diagnosisReport.findFirst({
      where: { runId, status: { in: ["DRAFT", "RECORDED"] } },
      orderBy: { version: "desc" },
      include: {
        manualMaterials: { orderBy: { createdAt: "asc" }, include: { mappedMaterial: { select: { code: true, name: true, unit: true } } } },
        recommendedService: { select: { code: true, labelId: true } },
      },
    }),
    prisma.diagnosisReport.findMany({ where: { runId, status: "SUPERSEDED" }, orderBy: { version: "desc" }, select: { version: true, recordedAt: true, createdAt: true } }),
  ]);
  return {
    current: current ? {
      diagnosisId: current.id, version: current.version, revision: current.revision, status: current.status,
      findings: current.findings, photoUrls: current.photoUrls,
      recommendedServiceId: current.recommendedServiceId,
      recommendedServiceLabel: current.recommendedService?.labelId ?? null,
      recordedAt: current.recordedAt, createdAt: current.createdAt,
      // Prefill "Revisi Diagnosis" (sandbox QA: wizard dibuka KOSONG padahal diagnosis sudah ada — kirim ulang = menimpa BOM).
      // bomLines = SEMUA baris Planned BOM aktif (termasuk hasil pemetaan bahan manual) supaya revisi tidak menghilangkannya;
      // photos membawa URL mentah (untuk dikirim ulang) + pratinjau bertanda tangan (untuk ditampilkan).
      prefill: {
        bomLines: bomRows.map((l) => ({ materialId: l.materialId, code: l.material.code, name: l.material.name, unit: l.material.unit, qty: Number(l.qty) })),
        photos: (current.photoUrls || []).map((u) => ({ url: u, previewUrl: signEvidenceUrl(u) })).filter((x) => x.previewUrl),
      },
      manualMaterials: current.manualMaterials.map((m) => ({
        id: m.id, description: m.description, estimatedUnit: m.estimatedUnit, qty: Number(m.qty), reason: m.reason, status: m.status,
        mappedMaterialCode: m.mappedMaterial?.code ?? null, mappedMaterialName: m.mappedMaterial?.name ?? null, mappedQty: m.mappedQty != null ? Number(m.mappedQty) : null,
      })),
    } : null,
    history: historyRaw.map((h) => ({ version: h.version, recordedAt: h.recordedAt, createdAt: h.createdAt })),
  };
}
