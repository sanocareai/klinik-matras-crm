// Mesin transisi tahap produksi — satu-satunya jalur yang boleh menulis ke
// unit_stage_logs dan mengubah units.currentStageId/status. PRD: "Illegal
// transitions must be rejected, not just hidden in the UI" — pemeriksaan di
// sini, bukan cuma disable tombol di frontend.
//
// SELURUH fungsi di sini murni membaca FLAG dari routing_stages
// (requiresPhoto, requiresQc, isOptional) — tidak ada satu pun perbandingan
// `stage.code === '...'`. Kalau butuh perilaku baru per tahap, tambah flag
// di routing_stages, JANGAN hardcode kode tahap di sini (D-003).
//
// "BLOCKED" bukan kolom status. PRD §6.2 memang minta status BLOCKED, tapi
// menambah kolom mutable akan bertentangan dengan prinsip yang sudah dikunci
// di Phase 0: posisi/keadaan halus dilacak dari LEDGER, bukan enum status
// (persis seperti stock yang tidak pernah kolom `current_qty`). "Blocked"
// di sini adalah properti DERIVED: baris log TERAKHIR untuk tahap unit
// sekarang berupa FAIL tanpa START susulan. Lihat isUnitBlocked().

import { prisma } from "../db.js";
import {
  buildUnitPath, getNextStage, isLastStage, isLastIntakeStage, findComfortLayerModule,
} from "../lib/domain/routing.js";

class StageTransitionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Ambil seluruh tahap INTAKE/FINISH global + tahap MODULE milik satu layanan. */
async function loadRoutingData(tx, serviceId) {
  const [intakeStages, finishStages, moduleMappings] = await Promise.all([
    tx.routingStage.findMany({ where: { phase: "INTAKE", active: true } }),
    tx.routingStage.findMany({ where: { phase: "FINISH", active: true } }),
    serviceId
      ? tx.serviceCatalogModule.findMany({
          where: { serviceId },
          orderBy: { sequence: "asc" },
          include: { stage: true },
        })
      : Promise.resolve([]),
  ]);
  const moduleStages = moduleMappings.map((m) => m.stage);
  return { intakeStages, finishStages, moduleStages };
}

/** Bangun jalur penuh unit ini. Lempar error jelas kalau layanan belum ditetapkan tapi dibutuhkan. */
async function pathForUnit(tx, unit) {
  const { intakeStages, finishStages, moduleStages } = await loadRoutingData(tx, unit.serviceId);
  return buildUnitPath(intakeStages, moduleStages, finishStages);
}

/** Log TERBUKA (START tanpa COMPLETE/FAIL/SKIP susulan) untuk unit+tahap ini, kalau ada. */
async function findOpenStart(tx, unitId, stageId) {
  const last = await tx.unitStageLog.findFirst({
    where: { unitId, stageId },
    orderBy: { createdAt: "desc" },
  });
  return last && last.action === "START" ? last : null;
}

/**
 * true kalau unit sedang terblokir di tahapnya sekarang — DERIVED dari log
 * terakhir (FAIL tanpa START susulan), bukan kolom.
 */
export async function isUnitBlocked(unitId, stageId) {
  if (!stageId) return false;
  const last = await prisma.unitStageLog.findFirst({
    where: { unitId, stageId },
    orderBy: { createdAt: "desc" },
  });
  return !!last && last.action === "FAIL";
}

/**
 * MULAI sebuah tahap.
 *
 * PENTING soal makna `unit.currentStageId`: field ini SELALU menunjuk
 * LANGSUNG ke tahap yang harus di-START berikutnya — baik itu tahap
 * pertama (di-set saat start pertama), tahap yang barusan di-advance
 * setelah COMPLETE/SKIP tahap sebelumnya (lihat advanceUnitPastStage), atau
 * tahap yang sedang di-retry setelah FAIL. TIDAK PERNAH dipanggil ulang
 * lewat getNextStage() di fungsi ini — currentStageId sendiri SUDAH
 * jawabannya. Memanggil getNextStage() atas currentStageId di sini adalah
 * bug yang pernah nyata terjadi: setiap start melompati satu tahap, dan dua
 * tahap bisa sama-sama "terbuka" sekaligus. Jangan diulang.
 */
export async function startStage(unitId, { actorId } = {}) {
  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    const path = await pathForUnit(tx, unit);

    let targetStage;
    if (!unit.currentStageId) {
      targetStage = getNextStage(path, null); // tahap pertama jalur — satu-satunya tempat getNextStage dipakai di sini
    } else {
      targetStage = path.find((s) => s.id === unit.currentStageId);
      if (!targetStage) {
        throw new StageTransitionError(
          "Tahap unit sekarang tidak ditemukan di jalur layanan saat ini — perlu penanganan manual Production Lead"
        );
      }
      const lastLog = await tx.unitStageLog.findFirst({
        where: { unitId, stageId: targetStage.id },
        orderBy: { createdAt: "desc" },
      });
      if (lastLog?.action === "START") {
        throw new StageTransitionError(`Tahap "${targetStage.labelId}" sudah berjalan, selesaikan dulu`);
      }
      // Tahap TERAKHIR jalur yang sudah COMPLETE/SKIP: currentStageId sengaja
      // TETAP menunjuk ke sini (lihat advanceUnitPastStage) supaya "tahap
      // terakhir yang dilalui" masih terbaca tanpa query ledger — tapi itu
      // BUKAN izin untuk start ulang. Tanpa cek ini, unit yang sudah
      // READY_FOR_DELIVERY bisa "dimulai lagi" di tahap yang sama.
      if ((lastLog?.action === "COMPLETE" || lastLog?.action === "SKIP") && isLastStage(path, targetStage.id)) {
        throw new StageTransitionError("Unit sudah menyelesaikan seluruh tahap routing");
      }
      // Sisanya: lastLog kosong (baru saja di-advance ke sini, belum pernah
      // disentuh) atau FAIL (retry setelah blokir) — dua-duanya sah untuk START.
    }

    if (!targetStage) {
      throw new StageTransitionError("Unit sudah menyelesaikan seluruh tahap routing");
    }

    const log = await tx.unitStageLog.create({
      data: { unitId, stageId: targetStage.id, action: "START", actorId, startedAt: new Date() },
    });

    // Tahap produksi pertama yang dimulai -> unit resmi masuk produksi.
    const data = { currentStageId: targetStage.id };
    if (unit.status === "RECEIVED" || unit.status === "AWAITING_PICKUP") {
      data.status = "IN_PRODUCTION";
    }
    await tx.unit.update({ where: { id: unitId }, data });

    return { log, stage: targetStage };
  });
}

/**
 * SELESAIKAN tahap yang sedang berjalan.
 *
 * Menolak kalau: tidak ada START terbuka, requiresPhoto tapi photoUrls
 * kosong, atau tahap ini requiresQc (harus lewat recordQcFitTest, bukan
 * endpoint generik ini — putusan QC punya bentuk data sendiri).
 */
export async function completeStage(unitId, stageId, { actorId, photoUrls = [], note } = {}) {
  return prisma.$transaction(async (tx) => {
    const stage = await tx.routingStage.findUniqueOrThrow({ where: { id: stageId } });

    if (stage.requiresQc) {
      throw new StageTransitionError(
        `Tahap "${stage.labelId}" adalah gerbang QC — selesaikan lewat pencatatan putusan QC, bukan endpoint ini`
      );
    }

    const open = await findOpenStart(tx, unitId, stageId);
    if (!open) {
      throw new StageTransitionError(`Tidak ada tahap "${stage.labelId}" yang sedang berjalan untuk unit ini`);
    }

    if (stage.requiresPhoto && photoUrls.length === 0) {
      throw new StageTransitionError(`Tahap "${stage.labelId}" wajib foto sebelum bisa diselesaikan`);
    }

    // D-008: lini/modul ditetapkan di Uji Fondasi/Diagnosa — kalau ini tahap
    // INTAKE TERAKHIR dan layanan belum ditetapkan, JANGAN selesaikan (dan
    // JANGAN tulis log apa pun): menyelesaikannya tanpa serviceId akan
    // membuat advanceUnitPastStage melompati SELURUH fase MODULE secara diam-
    // diam (path-nya jadi INTAKE+FINISH saja, tanpa modul apa pun). Diperiksa
    // dari FASE+urutan (isLastIntakeStage), bukan nama kode tahap (D-003).
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    const path = await pathForUnit(tx, unit);
    if (isLastIntakeStage(path, stage.id) && !unit.serviceId) {
      throw new StageTransitionError(
        `Layanan unit belum ditetapkan — tidak bisa menyelesaikan "${stage.labelId}" sebelum lini/layanan ditentukan (PATCH /units/:id/service)`
      );
    }

    return finishStageInternal(tx, unitId, stage, open, { actorId, photoUrls, note });
  });
}

/**
 * Majukan currentStageId/status unit SETELAH sebuah tahap tuntas (COMPLETE
 * ATAU SKIP — dua-duanya "tuntas" dari sudut pandang jalur). TIDAK menulis
 * log apa pun — pemanggil sudah menulis baris ledgernya sendiri dengan
 * action yang sesuai (COMPLETE atau SKIP). Dipisah dari penulisan log supaya
 * setiap transisi menghasilkan TEPAT SATU baris ledger, tidak dobel.
 */
async function advanceUnitPastStage(tx, unitId, stage) {
  const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
  const path = await pathForUnit(tx, unit);

  if (isLastStage(path, stage.id)) {
    // Seluruh routing selesai — unit siap kirim. currentStageId TETAP di
    // tahap terakhir (bukan null) supaya "tahap terakhir yang dilalui" masih
    // bisa dibaca dari unit tanpa query ke ledger.
    await tx.unit.update({ where: { id: unitId }, data: { status: "READY_FOR_DELIVERY" } });
  } else {
    const next = getNextStage(path, stage.id);
    await tx.unit.update({ where: { id: unitId }, data: { currentStageId: next.id } });
  }
}

/** Tulis log COMPLETE + majukan unit. Dipakai completeStage biasa dan QC lulus. */
async function finishStageInternal(tx, unitId, stage, openLog, { actorId, photoUrls = [], note } = {}) {
  const endedAt = new Date();
  const durationSeconds = openLog?.startedAt
    ? Math.round((endedAt.getTime() - openLog.startedAt.getTime()) / 1000)
    : null;

  const log = await tx.unitStageLog.create({
    data: {
      unitId, stageId: stage.id, action: "COMPLETE", actorId,
      startedAt: openLog?.startedAt ?? null, endedAt, durationSeconds, photoUrls, note,
    },
  });

  await advanceUnitPastStage(tx, unitId, stage);
  return log;
}

/**
 * GAGALKAN/blokir tahap yang sedang berjalan. Wajib blockReason (PRD §6.2).
 * TIDAK mengubah currentStageId — unit tetap "di" tahap ini, tinggal
 * status blocked-nya jadi true (derived, lihat isUnitBlocked). Retry lewat
 * startStage() lagi setelah blokir diselesaikan.
 */
export async function failStage(unitId, stageId, { actorId, blockReason, note } = {}) {
  if (!blockReason) throw new StageTransitionError("blockReason wajib diisi saat menggagalkan tahap");

  return prisma.$transaction(async (tx) => {
    const stage = await tx.routingStage.findUniqueOrThrow({ where: { id: stageId } });
    const open = await findOpenStart(tx, unitId, stageId);
    if (!open) {
      throw new StageTransitionError(`Tidak ada tahap "${stage.labelId}" yang sedang berjalan untuk unit ini`);
    }
    return tx.unitStageLog.create({
      data: { unitId, stageId, action: "FAIL", actorId, blockReason, note, startedAt: open.startedAt, endedAt: new Date() },
    });
  });
}

/** LEWATI tahap opsional (isOptional=true). Tetap tercatat di ledger. */
export async function skipStage(unitId, { actorId, note } = {}) {
  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    const path = await pathForUnit(tx, unit);

    // currentStageId SUDAH menunjuk tahap yang harus ditindak berikutnya —
    // sama seperti startStage, JANGAN panggil getNextStage() atas nilai ini.
    const target = unit.currentStageId
      ? path.find((s) => s.id === unit.currentStageId)
      : getNextStage(path, null);

    if (!target) throw new StageTransitionError("Tidak ada tahap berikutnya untuk dilewati");
    if (!target.isOptional) {
      throw new StageTransitionError(`Tahap "${target.labelId}" wajib, tidak bisa dilewati`);
    }

    const log = await tx.unitStageLog.create({
      data: { unitId, stageId: target.id, action: "SKIP", actorId, note },
    });
    await advanceUnitPastStage(tx, unitId, target);
    return log;
  });
}

/**
 * Catat putusan Uji Berat Badan (D-005). Ini SATU-SATUNYA jalan
 * menyelesaikan tahap requiresQc.
 *
 * PAS (atau override customer, D-009) -> tahap selesai, unit maju seperti
 * completeStage biasa. TERLALU_KERAS/TERLALU_EMPUK tanpa override -> tahap
 * TIDAK selesai, unit dikembalikan ke modul lapisan sebagai rework
 * (ROUTING.md §4) — "jangan biarkan rework tidak terlihat".
 */
export async function recordQcFitTest(unitId, stageId, {
  actorId, verdict, referenceWeightKg, customerPreferenceOverride, educationGiven, note, photoUrls = [],
} = {}) {
  if (!verdict) throw new StageTransitionError("verdict wajib diisi");
  if (!referenceWeightKg) throw new StageTransitionError("referenceWeightKg wajib diisi");
  if (customerPreferenceOverride && !educationGiven) {
    // D-009: override tanpa edukasi tercatat = data liability cacat. DB juga
    // menolak ini (CHECK constraint) — pengecekan di sini supaya pesan error
    // untuk sales/QC jelas, bukan cuma error SQL mentah.
    throw new StageTransitionError("Override preferensi customer wajib disertai konfirmasi edukasi sudah diberikan");
  }

  return prisma.$transaction(async (tx) => {
    const stage = await tx.routingStage.findUniqueOrThrow({ where: { id: stageId } });
    if (!stage.requiresQc) {
      throw new StageTransitionError(`Tahap "${stage.labelId}" bukan gerbang QC`);
    }
    const open = await findOpenStart(tx, unitId, stageId);
    if (!open) {
      throw new StageTransitionError(`Tidak ada tahap "${stage.labelId}" yang sedang berjalan untuk unit ini`);
    }
    if (stage.requiresPhoto && photoUrls.length === 0) {
      throw new StageTransitionError(`Tahap "${stage.labelId}" wajib foto sebelum bisa diselesaikan`);
    }

    const test = await tx.qcFitTest.create({
      data: {
        unitId, stageId, verdict, referenceWeightKg,
        customerPreferenceOverride: customerPreferenceOverride ?? null,
        educationGiven: !!educationGiven,
        testedById: actorId, note,
      },
    });

    const lulus = verdict === "PAS" || !!customerPreferenceOverride;
    if (lulus) {
      await finishStageInternal(tx, unitId, stage, open, { actorId, photoUrls, note: `QC: ${verdict}` });
      return { test, result: "PASSED" };
    }

    // Gagal -> rework. Tutup START yang terbuka sebagai FAIL (rework, bukan
    // material_shortage/dst — QUALITY_ISSUE paling tepat mewakili "belum pas").
    await tx.unitStageLog.create({
      data: {
        unitId, stageId, action: "FAIL", actorId, blockReason: "QUALITY_ISSUE",
        note: `QC gagal: ${verdict}`, startedAt: open.startedAt, endedAt: new Date(),
      },
    });

    const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    const path = await pathForUnit(tx, unit);
    const comfortLayer = findComfortLayerModule(path);
    if (!comfortLayer) {
      // Layanan unit ini tidak punya modul lapisan (mis. Service Fondasi
      // murni) — tidak ada tempat rework yang masuk akal. Ini kondisi yang
      // TIDAK BOLEH ditebak; production lead harus menangani manual.
      throw new StageTransitionError(
        `QC gagal tapi layanan unit ini tidak punya modul lapisan untuk rework — perlu penanganan manual Production Lead`
      );
    }
    await tx.unit.update({ where: { id: unitId }, data: { currentStageId: comfortLayer.id } });

    return { test, result: "REWORK", reworkStage: comfortLayer };
  });
}

export { StageTransitionError };
