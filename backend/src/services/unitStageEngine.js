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
 * Tentukan tahap yang harus ditindak berikutnya + keadaannya SEKARANG, tanpa
 * menulis apa pun. SATU-SATUNYA tempat logika ini ada — dipakai baik oleh
 * startStage() (menulis) maupun getUnitStatus() (baca-saja, untuk kiosk),
 * supaya dua-duanya tidak pernah bisa saling menyimpang.
 *
 * PENTING soal makna `unit.currentStageId`: field ini SELALU menunjuk
 * LANGSUNG ke tahap yang harus ditindak — baik itu tahap pertama, tahap yang
 * barusan di-advance setelah COMPLETE/SKIP tahap sebelumnya (lihat
 * advanceUnitPastStage), atau tahap yang sedang di-retry setelah FAIL.
 * TIDAK PERNAH dipanggil ulang lewat getNextStage() di sini — currentStageId
 * sendiri SUDAH jawabannya. Memanggil getNextStage() atas currentStageId
 * adalah bug yang pernah nyata terjadi: setiap start melompati satu tahap,
 * dan dua tahap bisa sama-sama "terbuka" sekaligus. Jangan diulang.
 *
 * @returns {{stage: object|null, state: 'FIRST'|'READY'|'IN_PROGRESS'|'BLOCKED'|'DONE'|'MISMATCH'}}
 */
async function resolveCurrentTarget(tx, unit, path) {
  if (!unit.currentStageId) {
    const stage = getNextStage(path, null); // tahap pertama jalur
    return { stage, state: stage ? "FIRST" : "MISMATCH" };
  }

  const stage = path.find((s) => s.id === unit.currentStageId);
  if (!stage) {
    return { stage: null, state: "MISMATCH" }; // lini/layanan berubah, tahap sekarang tidak ada di jalur baru
  }

  const lastLog = await tx.unitStageLog.findFirst({
    where: { unitId: unit.id, stageId: stage.id },
    orderBy: { createdAt: "desc" },
  });

  if (lastLog?.action === "START") return { stage, state: "IN_PROGRESS" };
  if (lastLog?.action === "FAIL") return { stage, state: "BLOCKED" };
  // Tahap TERAKHIR jalur yang sudah COMPLETE/SKIP: currentStageId sengaja
  // TETAP menunjuk ke sini (lihat advanceUnitPastStage) supaya "tahap
  // terakhir yang dilalui" masih terbaca tanpa query ledger.
  if ((lastLog?.action === "COMPLETE" || lastLog?.action === "SKIP") && isLastStage(path, stage.id)) {
    return { stage, state: "DONE" };
  }
  // lastLog kosong (baru saja di-advance ke sini, belum pernah disentuh) —
  // siap di-START.
  return { stage, state: "READY" };
}

/**
 * Status produksi unit SEKARANG — baca-saja, untuk layar kiosk (tampilkan
 * tombol yang tepat SEBELUM worker menekannya, bukan menebak dari status
 * kasar UnitStatus). Bentuk hasil dirancang supaya frontend TIDAK PERNAH
 * perlu mengulang logika routing sendiri.
 */
export async function getUnitStatus(unitId) {
  const unit = await prisma.unit.findUniqueOrThrow({
    where: { id: unitId },
    include: { service: true, currentStage: true, order: { select: { orderNumber: true } } },
  });
  const path = await pathForUnit(prisma, unit);
  const { stage, state } = await resolveCurrentTarget(prisma, unit, path);
  return { unit, stage, state, needsService: state === "MISMATCH" && !unit.serviceId };
}

/**
 * Versi BATCH ringan dari resolveCurrentTarget — untuk Papan Produksi Harian
 * (D-014), yang perlu tahu "tahap apa yang harus ditandai selesai" untuk
 * BANYAK unit sekaligus tanpa query per-unit.
 *
 * SENGAJA TIDAK selengkap resolveCurrentTarget: tidak membedakan IN_PROGRESS
 * vs BLOCKED vs DONE (itu perlu baca ledger per unit — mahal untuk daftar).
 * Amannya terjamin oleh KONTEKS pemanggilnya: unit yang tampil di papan ini
 * selalu berstatus RECEIVED/IN_PRODUCTION, dan advanceUnitPastStage() SELALU
 * mengubah status jadi READY_FOR_DELIVERY begitu unit menuntaskan seluruh
 * jalur — jadi unit yang lolos filter IN_WORKSHOP tidak akan pernah dalam
 * keadaan "sudah DONE tapi masih nampil". Hasil fungsi ini murni PETUNJUK
 * TAMPILAN; recordStageDone() TETAP menghitung ulang dan memvalidasi secara
 * otoritatif sendiri saat benar-benar dipanggil.
 *
 * @param {object[]} units - array Unit (butuh id, serviceId, currentStageId)
 * @returns {Record<string, object|null>} unitId -> RoutingStage
 */
export async function resolveNextStageForUnits(units) {
  const [intakeStages, finishStages, allModuleMappings] = await Promise.all([
    prisma.routingStage.findMany({ where: { phase: "INTAKE", active: true } }),
    prisma.routingStage.findMany({ where: { phase: "FINISH", active: true } }),
    prisma.serviceCatalogModule.findMany({ orderBy: { sequence: "asc" }, include: { stage: true } }),
  ]);
  const modulesByService = {};
  for (const m of allModuleMappings) {
    (modulesByService[m.serviceId] ??= []).push(m.stage);
  }

  const result = {};
  for (const unit of units) {
    const moduleStages = unit.serviceId ? (modulesByService[unit.serviceId] || []) : [];
    const path = buildUnitPath(intakeStages, moduleStages, finishStages);
    result[unit.id] = unit.currentStageId
      ? path.find((s) => s.id === unit.currentStageId) || null
      : getNextStage(path, null);
  }
  return result;
}

/**
 * MULAI sebuah tahap. Lihat resolveCurrentTarget() untuk aturan penentuan
 * tahap targetnya.
 */
export async function startStage(unitId, { actorId } = {}) {
  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    const path = await pathForUnit(tx, unit);
    const { stage: targetStage, state } = await resolveCurrentTarget(tx, unit, path);

    if (state === "IN_PROGRESS") {
      throw new StageTransitionError(`Tahap "${targetStage.labelId}" sudah berjalan, selesaikan dulu`);
    }
    if (state === "DONE") {
      throw new StageTransitionError("Unit sudah menyelesaikan seluruh tahap routing");
    }
    if (state === "MISMATCH" || !targetStage) {
      throw new StageTransitionError(
        "Tahap unit sekarang tidak ditemukan di jalur layanan saat ini — perlu penanganan manual Production Lead"
      );
    }
    // state FIRST / READY / BLOCKED(retry) — semuanya sah untuk START.

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
 * CATAT tahap SUDAH SELESAI — mode retrospektif untuk Papan Produksi Harian
 * (D-014). Ini jalur yang dipakai kepala produksi/QC Leader.
 *
 * Bedanya dengan completeStage(): TIDAK menuntut ada START terbuka lebih dulu.
 * Kepala produksi mencatat SETELAH pekerjaannya terjadi ("hari ini unit X
 * sampai tahap Y") — memaksa dua langkah START lalu COMPLETE untuk satu
 * kejadian yang sudah lampau adalah gesekan yang justru mematikan adopsi
 * (persis kegagalan yang diperingatkan PRD §13, cuma pindah dari pekerja ke
 * kepala produksi).
 *
 * Kalau memang ADA START terbuka (mis. dicatat real-time), durasinya tetap
 * dihitung seperti biasa. Kalau tidak ada, START dan COMPLETE ditulis
 * berbarengan dengan durasi NULL — jujur bahwa durasinya tidak diukur, BUKAN
 * mengarang angka. Ini penting untuk laporan cycle time nanti: baris
 * berdurasi NULL harus dikecualikan, bukan dianggap nol.
 */
export async function recordStageDone(unitId, { actorId, photoUrls = [], note } = {}) {
  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    const path = await pathForUnit(tx, unit);
    const { stage, state } = await resolveCurrentTarget(tx, unit, path);

    if (state === "DONE") throw new StageTransitionError("Unit sudah menyelesaikan seluruh tahap routing");
    if (state === "MISMATCH" || !stage) {
      throw new StageTransitionError(
        "Tahap unit sekarang tidak ditemukan di jalur layanan saat ini — perlu penanganan manual Production Lead"
      );
    }
    if (stage.requiresQc) {
      throw new StageTransitionError(
        `Tahap "${stage.labelId}" adalah gerbang QC — catat lewat putusan Uji Berat Badan, bukan tombol selesai biasa`
      );
    }
    if (stage.requiresPhoto && photoUrls.length === 0) {
      throw new StageTransitionError(`Tahap "${stage.labelId}" wajib foto sebelum bisa dicatat selesai`);
    }
    // D-008 — sama seperti completeStage: jangan biarkan lewat INTAKE terakhir
    // tanpa layanan, karena itu melompati SELURUH fase MODULE diam-diam.
    if (isLastIntakeStage(path, stage.id) && !unit.serviceId) {
      throw new StageTransitionError(
        `Layanan unit belum ditetapkan — tidak bisa menyelesaikan "${stage.labelId}" sebelum lini/layanan ditentukan`
      );
    }

    let open = await findOpenStart(tx, unitId, stage.id);
    if (!open) {
      // Belum pernah di-START (kasus normal untuk pencatatan retrospektif):
      // tulis START-nya juga supaya ledger tetap punya pasangan yang utuh.
      open = await tx.unitStageLog.create({
        data: { unitId, stageId: stage.id, action: "START", actorId, startedAt: null },
      });
      if (unit.status === "RECEIVED" || unit.status === "AWAITING_PICKUP") {
        await tx.unit.update({ where: { id: unitId }, data: { status: "IN_PRODUCTION" } });
      }
    }

    return finishStageInternal(tx, unitId, stage, open, { actorId, photoUrls, note });
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
