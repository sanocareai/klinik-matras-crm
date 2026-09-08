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
// (persis seperti stock yang tidak pernah kolom `current_qty`).
//
// UPDATE Production Core Slice 2: "blocked" sekarang punya DUA lapis.
// unit_stage_logs TETAP ledger baku (baris FAIL terakhir tanpa START
// susulan — isUnitBlocked() di bawah, sudah tidak dipanggil kode aplikasi
// mana pun, dipertahankan sebagai definisi historis/dokumentasi). Sumber
// kebenaran BARU untuk "apakah unit ini blocked SEKARANG" adalah tabel
// production_blockers (resolvedAt IS NULL) — lihat failStage()/
// resolveBlocker() di bawah dan model ProductionBlocker di schema.prisma.
// Bedanya: tabel baru itu tahu SIAPA/KAPAN/KENAPA diselesaikan, ledger
// lama tidak. deriveProductionStatus() (lib/domain/productionState.js)
// menerima blocker AKTUAL lewat parameter hasOpenBlocker, fallback ke
// definisi ledger lama HANYA kalau parameter itu tidak diberikan.

import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  buildUnitPath, getNextStage, isLastStage, isLastIntakeStage, findComfortLayerModule,
} from "../lib/domain/routing.js";
import { deriveProductionStatus, describeProductionStatus } from "../lib/domain/productionState.js";
import { isProductionEligible, validateBlockReason } from "../lib/domain/productionExceptions.js";
import {
  validatePauseReason, computeExecutionTiming, groupIntoAttempts, toExecutionEvent,
} from "../lib/domain/stageExecution.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { syncOrderStatus } from "./orderStatusSync.js";
import { suggestDeliveryJob } from "./deliveryHandoff.js";

// Isolation SERIALIZABLE untuk keempat perintah eksekusi inti (START/PAUSE/
// RESUME/COMPLETE, Production Core Slice 3I) — pola "baca state tahap
// sekarang, putuskan legal atau tidak, tulis" ini rawan race di bawah
// READ COMMITTED (default Postgres/Prisma): dua klik "Mulai" bersamaan
// bisa SAMA-SAMA membaca "belum ada START" sebelum keduanya menulis,
// menghasilkan dua baris START/dua kali maju tahap. SERIALIZABLE membuat
// Postgres MENOLAK (error 40001 / Prisma P2034) transaksi kedua yang
// datanya sudah "basi" karena transaksi pertama duluan commit — ditangkap
// di handleEngineError sebagai 409 yang jelas, bukan korupsi diam-diam.
// TIDAK diterapkan ke failStage (sudah dijaga partial unique index
// ProductionBlocker, mekanisme lebih kuat) atau skipStage/recordQcFitTest/
// recordStageDone (di luar 4 perintah eksekusi inti Slice 3, tidak diubah
// supaya tidak melebarkan lingkup di luar yang diminta).
const EXECUTION_TX_OPTIONS = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

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

/**
 * Log TERBUKA (segmen kerja aktif) untuk unit+tahap ini, kalau ada — baris
 * TERAKHIR-nya START ATAU RESUME (Production Core Slice 3: RESUME sama-sama
 * "sedang berjalan" seperti START, lihat OPEN_WORK_ACTIONS di
 * lib/domain/stageExecution.js). SEBELUM Slice 3 fungsi ini bernama
 * findOpenStart() dan hanya mengenali START — DIGANTI NAMA (bukan cuma
 * ditambah kondisi) supaya nama fungsinya jujur soal artinya sekarang;
 * private ke modul ini, tidak ada pemanggil luar yang perlu disesuaikan.
 */
async function findOpenWork(tx, unitId, stageId) {
  const last = await tx.unitStageLog.findFirst({
    where: { unitId, stageId },
    orderBy: { createdAt: "desc" },
  });
  return last && (last.action === "START" || last.action === "RESUME") ? last : null;
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
 * @returns {{stage: object|null, state: 'FIRST'|'READY'|'IN_PROGRESS'|'PAUSED'|'BLOCKED'|'DONE'|'MISMATCH'}}
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

  // RESUME = kembali aktif, sama seperti START (Production Core Slice 3).
  if (lastLog?.action === "START" || lastLog?.action === "RESUME") return { stage, state: "IN_PROGRESS" };
  // PAUSED TERPISAH dari IN_PROGRESS — startStage() harus MENOLAK tahap yang
  // sedang dijeda (retry itu tugas resumeStage(), bukan startStage() lagi).
  if (lastLog?.action === "PAUSE") return { stage, state: "PAUSED" };
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
 *
 * `productionStatus`/`productionStatusReason` (Production Core Slice 1) —
 * kosakata KANONIK level-unit dari lib/domain/productionState.js, TAMBAHAN
 * di atas `state` (FIRST/READY/IN_PROGRESS/PAUSED/BLOCKED/DONE/MISMATCH —
 * TETAP ada, itu yang dipakai UI kiosk memutuskan tombol apa yang tampil).
 * Lihat catatan di productionState.js untuk kenapa dua kosakata ini hidup
 * berdampingan, bukan salah satu diganti.
 *
 * `execution` (Production Core Slice 3L) — timing attempt SEKARANG (elapsed/
 * touch/paused, lihat lib/domain/stageExecution.js), null kalau tahap belum
 * pernah disentuh sama sekali. Query tambahan di sini AMAN — SATU unit,
 * bukan daftar (lihat routes/production.js untuk versi batch permukaan LIST).
 */
export async function getUnitStatus(unitId) {
  const unit = await prisma.unit.findUniqueOrThrow({
    where: { id: unitId },
    include: { service: true, currentStage: true, order: { select: { orderNumber: true } } },
  });
  const path = await pathForUnit(prisma, unit);
  const { stage, state } = await resolveCurrentTarget(prisma, unit, path);

  const stageRows = unit.currentStageId
    ? await prisma.unitStageLog.findMany({
        where: { unitId, stageId: unit.currentStageId },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const lastLog = stageRows[stageRows.length - 1] || null;
  const attempts = groupIntoAttempts(stageRows);
  const currentAttempt = attempts[attempts.length - 1] || null;
  const execution = currentAttempt
    ? computeExecutionTiming({ events: currentAttempt.events.map(toExecutionEvent) })
    : null;

  const productionStatus = deriveProductionStatus({ unit, lastLog, currentStageRequiresQc: !!stage?.requiresQc });

  return {
    unit, stage, state, needsService: state === "MISMATCH" && !unit.serviceId,
    productionStatus,
    productionStatusReason: describeProductionStatus(productionStatus, lastLog),
    execution,
  };
}

/**
 * Log TERAKHIR untuk currentStageId masing-masing unit, dalam SATU query
 * batch — dipakai permukaan baca yang menampilkan BANYAK unit sekaligus
 * (papan produksi, work order, antrean QC) supaya tidak N+1. Ditarik ke sini
 * 6 September 2026 (Production Core Slice 1) dari pola yang tadinya
 * diduplikasi langsung di GET /production/qc-queue — permukaan lain (board,
 * work-orders) sekarang memakai definisi yang SAMA, bukan salinan kedua
 * yang bisa diam-diam menyimpang.
 *
 * `client` (default `prisma` singleton) — pola yang sama dengan
 * findOrdersWithoutUnits() di services/unitProvisioning.js — supaya fungsi
 * ini bisa diuji dengan STUB tanpa database sungguhan, membuktikan
 * baris-DB dipanggil TEPAT SEKALI berapa pun jumlah unit (lihat
 * tests/queryBatching.test.js, Production Core Slice 2 — bukti tertulis
 * untuk audit performa STEP 0).
 *
 * @param {{id:string, currentStageId?:string|null}[]} units
 * @param {object} [client]
 * @returns {Promise<Record<string, object>>} unitId -> UnitStageLog TERBARU untuk currentStageId unit itu
 */
export async function loadLastCurrentStageLogs(units, client = prisma) {
  const withStage = units.filter((u) => u.currentStageId);
  if (withStage.length === 0) return {};

  const logs = await client.unitStageLog.findMany({
    where: { OR: withStage.map((u) => ({ unitId: u.id, stageId: u.currentStageId })) },
    orderBy: { createdAt: "desc" },
  });
  const lastByUnit = {};
  for (const log of logs) {
    if (!lastByUnit[log.unitId]) lastByUnit[log.unitId] = log; // sudah urut desc, yang pertama ketemu = terbaru
  }
  return lastByUnit;
}

/**
 * ProductionBlocker TERBUKA (resolvedAt IS NULL) per unit, SATU query batch
 * — dipakai permukaan yang menampilkan BANYAK unit sekaligus (board,
 * work-orders, qc-queue, command center — Production Core Slice 2) supaya
 * productionStatus/exception TIDAK N+1. Lihat catatan `client` di
 * loadLastCurrentStageLogs di atas.
 *
 * @param {string[]} unitIds
 * @param {object} [client]
 * @returns {Promise<Record<string, object>>} unitId -> ProductionBlocker terbuka unit itu
 */
export async function loadOpenBlockersByUnit(unitIds, client = prisma) {
  if (!unitIds || unitIds.length === 0) return {};
  const blockers = await client.productionBlocker.findMany({
    where: { unitId: { in: unitIds }, resolvedAt: null },
  });
  return Object.fromEntries(blockers.map((b) => [b.unitId, b]));
}

/**
 * QcFitTest TERBARU per unit, SATU query batch — dipakai deteksi rework
 * (lib/domain/productionState.js#isReworkTarget) di permukaan yang
 * menampilkan banyak unit sekaligus (Production Core Slice 2). Lihat
 * catatan `client` di loadLastCurrentStageLogs di atas.
 *
 * @param {string[]} unitIds
 * @param {object} [client]
 * @returns {Promise<Record<string, object>>} unitId -> QcFitTest TERBARU unit itu
 */
export async function loadLatestQcFitTestByUnit(unitIds, client = prisma) {
  if (!unitIds || unitIds.length === 0) return {};
  const tests = await client.qcFitTest.findMany({
    where: { unitId: { in: unitIds } },
    orderBy: { createdAt: "desc" },
  });
  const latestByUnit = {};
  for (const t of tests) {
    if (!latestByUnit[t.unitId]) latestByUnit[t.unitId] = t; // sudah urut desc, pertama ketemu = terbaru
  }
  return latestByUnit;
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
    if (state === "PAUSED") {
      // Production Core Slice 3A: retry tahap dijeda BUKAN lewat startStage()
      // lagi — itu akan menulis START kedua untuk attempt yang SAMA. Jalan
      // yang benar resumeStage(), supaya satu attempt tetap satu START.
      throw new StageTransitionError(`Tahap "${targetStage.labelId}" sedang dijeda — gunakan "Lanjutkan" (Resume), bukan Mulai`);
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
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.STAGE_STARTED,
      actorId, metadata: { stage: targetStage.labelId },
    });

    // Retry setelah BLOCKED (Production Core Slice 2A): me-restart tahap
    // berarti kondisi pemblokirnya sudah tidak menghalangi lagi secara
    // fisik. Auto-resolve blokir terbuka DI SINI penting untuk KEBENARAN,
    // bukan cuma kenyamanan — deriveProductionStatus() mengecek
    // hasOpenBlocker LEBIH DULU sebelum IN_PROGRESS, jadi kalau blokirnya
    // dibiarkan terbuka, unit yang sudah jelas-jelas berjalan lagi akan
    // tampil BLOCKED selamanya. resolveBlocker() (RESOLVE BLOCKER manual)
    // TETAP tersedia terpisah untuk mencatat penyelesaian TANPA langsung
    // me-restart (mis. supervisor konfirmasi bahan sudah datang, pekerja
    // baru benar-benar mulai lagi belakangan) — dua jalur, satu state akhir
    // yang konsisten: idempotent lewat `resolvedAt: null` di WHERE.
    const openBlocker = await tx.productionBlocker.findFirst({ where: { unitId, resolvedAt: null } });
    let resolvedBlocker = null;
    if (openBlocker) {
      resolvedBlocker = await tx.productionBlocker.update({
        where: { id: openBlocker.id },
        data: {
          resolvedAt: new Date(), resolvedById: actorId || null,
          resolutionNote: "Diselesaikan otomatis — produksi dilanjutkan",
        },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.UNIT, entityId: unitId,
        eventType: EVENT_TYPES.PRODUCTION_BLOCKER_RESOLVED, actorId,
        metadata: { blockerId: openBlocker.id, reason: openBlocker.reason, resolutionNote: "auto: produksi dilanjutkan" },
      });
    }

    // Tahap produksi pertama yang dimulai -> unit resmi masuk produksi.
    const data = { currentStageId: targetStage.id };
    if (unit.status === "RECEIVED" || unit.status === "AWAITING_PICKUP") {
      data.status = "IN_PRODUCTION";
    }
    await tx.unit.update({ where: { id: unitId }, data });
    if (data.status) await syncOrderStatus(tx, unit.orderId);

    return { log, stage: targetStage, resolvedBlocker };
  }, EXECUTION_TX_OPTIONS);
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

    let open = await findOpenWork(tx, unitId, stage.id);
    if (!open) {
      // Belum pernah di-START (kasus normal untuk pencatatan retrospektif):
      // tulis START-nya juga supaya ledger tetap punya pasangan yang utuh.
      open = await tx.unitStageLog.create({
        data: { unitId, stageId: stage.id, action: "START", actorId, startedAt: null },
      });
      if (unit.status === "RECEIVED" || unit.status === "AWAITING_PICKUP") {
        await tx.unit.update({ where: { id: unitId }, data: { status: "IN_PRODUCTION" } });
        await syncOrderStatus(tx, unit.orderId);
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

    const open = await findOpenWork(tx, unitId, stageId);
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
  }, EXECUTION_TX_OPTIONS);
}

/**
 * JEDA tahap yang sedang berjalan (Production Core Slice 3C — Pilihan
 * Arsitektur A, lihat catatan panjang di lib/domain/stageExecution.js).
 * PAUSE TIDAK PERNAH boleh dipakai untuk kendala eksternal (material/tool/
 * approval dst, itu tugas "Tandai Terhambat"/failStage) — validatePauseReason
 * menolak reason berbentuk blocker sebelum menyentuh database.
 *
 * Baris PAUSE TIDAK punya startedAt/endedAt/durationSeconds sendiri (pola
 * yang sama dengan SKIP) — timing SELALU dihitung ULANG dari seluruh baris
 * attempt lewat computeExecutionTiming(), bukan disimpan per-baris.
 *
 * findOpenWork mensyaratkan baris TERAKHIR START/RESUME — jadi PAUSE ganda
 * (klik dobel) ditolak jujur ("tidak sedang berjalan") begitu PAUSE pertama
 * tercatat; kalau dua klik itu benar-benar bersamaan, EXECUTION_TX_OPTIONS
 * (Serializable) membuat salah satunya gagal dengan konflik serialisasi
 * (P2034) alih-alih diam-diam menulis dua baris PAUSE berurutan.
 */
export async function pauseStage(unitId, stageId, { actorId, reason, note } = {}) {
  // Validasi MURNI dulu (bisa diuji tanpa database) — lib/domain/stageExecution.js#validatePauseReason.
  const validationError = validatePauseReason({ reason, note });
  if (validationError) throw new StageTransitionError(validationError);

  return prisma.$transaction(async (tx) => {
    const stage = await tx.routingStage.findUniqueOrThrow({ where: { id: stageId } });

    const open = await findOpenWork(tx, unitId, stageId);
    if (!open) {
      throw new StageTransitionError(`Tidak ada tahap "${stage.labelId}" yang sedang berjalan untuk unit ini — tidak bisa dijeda`);
    }

    const log = await tx.unitStageLog.create({
      data: { unitId, stageId, action: "PAUSE", actorId, pauseReason: reason, note: note?.trim() || null },
    });

    await recordActivity(tx, {
      entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.STAGE_PAUSED, actorId,
      metadata: { stage: stage.labelId, reason, note: note?.trim() || null },
    });

    return { log };
  }, EXECUTION_TX_OPTIONS);
}

/**
 * LANJUTKAN tahap yang sedang dijeda.
 *
 * Menolak EKSPLISIT kalau baris terakhir bukan PAUSE — terutama FAIL
 * (blocked): unit yang sedang terhambat TIDAK BOLEH diam-diam "lanjut" lewat
 * jalur pause/resume, cuma lewat resolveBlocker()/startStage() retry (jalur
 * yang sudah ada, lihat catatan auto-resolve blocker di startStage()). Ini
 * yang menjaga PAUSED dan BLOCKED tetap dua state yang TIDAK BISA saling
 * disilangkan lewat perintah yang salah.
 *
 * RESUME ganda (klik dobel) ditolak jujur begitu RESUME pertama tercatat
 * (baris terakhir sudah bukan PAUSE lagi); race bersamaan ditangkap
 * EXECUTION_TX_OPTIONS (Serializable), sama seperti pauseStage().
 */
export async function resumeStage(unitId, stageId, { actorId } = {}) {
  return prisma.$transaction(async (tx) => {
    const stage = await tx.routingStage.findUniqueOrThrow({ where: { id: stageId } });
    const last = await tx.unitStageLog.findFirst({
      where: { unitId, stageId },
      orderBy: { createdAt: "desc" },
    });

    if (last?.action === "FAIL") {
      throw new StageTransitionError(
        `Tahap "${stage.labelId}" sedang terhambat (blocked) — selesaikan blokirnya dulu lalu gunakan "Mulai Lagi", bukan Lanjutkan`
      );
    }
    if (!last || last.action !== "PAUSE") {
      throw new StageTransitionError(`Tahap "${stage.labelId}" tidak sedang dijeda — tidak ada yang bisa dilanjutkan`);
    }

    const log = await tx.unitStageLog.create({
      data: { unitId, stageId, action: "RESUME", actorId },
    });

    await recordActivity(tx, {
      entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.STAGE_RESUMED, actorId,
      metadata: { stage: stage.labelId },
    });

    return { log };
  }, EXECUTION_TX_OPTIONS);
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
    await syncOrderStatus(tx, unit.orderId);
    await suggestDeliveryJob(tx, unitId);
  } else {
    const next = getNextStage(path, stage.id);
    await tx.unit.update({ where: { id: unitId }, data: { currentStageId: next.id } });
  }
}

/**
 * Rekonstruksi timing attempt yang SEDANG DITUTUP (Production Core Slice 3D)
 * — dipakai finishStageInternal (COMPLETE) dan failStage (FAIL). Mengambil
 * SELURUH baris (unitId, stageId) — bukan cuma sejak openLog — supaya
 * attempt yang sudah melalui beberapa siklus PAUSE/RESUME terekonstruksi
 * PENUH, bukan cuma segmen sejak segmen aktif terakhir.
 *
 * `closingAction` disuntikkan sebagai event SINTETIS di titik `now` (baris
 * COMPLETE/FAIL yang sebenarnya BELUM ditulis saat fungsi ini dipanggil) —
 * pemanggil menyimpan `timing.touchSeconds` sebagai durationSeconds baris
 * itu SETELAH fungsi ini kembali, satu kali tulis, tidak dua kali.
 *
 * Query tambahan ini AMAN — SATU (unit, stage), jumlah baris per attempt
 * kecil (0-beberapa jeda), BUKAN pola daftar/N+1 (lihat STEP 0 audit).
 */
async function reconstructClosingTiming(tx, unitId, stageId, closingAction, now) {
  const allRows = await tx.unitStageLog.findMany({
    where: { unitId, stageId }, orderBy: { createdAt: "asc" },
  });
  const attempts = groupIntoAttempts(allRows);
  const currentAttempt = attempts[attempts.length - 1];
  const timing = computeExecutionTiming({
    events: [...currentAttempt.events.map(toExecutionEvent), { type: closingAction, at: now, timingKnown: true }],
    now,
  });
  const trueStart = currentAttempt.events[0]; // selalu baris START attempt ini
  return { trueStartedAt: trueStart.startedAt ?? null, timing };
}

/** Tulis log COMPLETE + majukan unit. Dipakai completeStage biasa dan QC lulus. */
async function finishStageInternal(tx, unitId, stage, openLog, { actorId, photoUrls = [], note } = {}) {
  const now = new Date();
  const { trueStartedAt, timing } = await reconstructClosingTiming(tx, unitId, stage.id, "COMPLETE", now);

  const log = await tx.unitStageLog.create({
    data: {
      unitId, stageId: stage.id, action: "COMPLETE", actorId,
      // startedAt di baris COMPLETE = awal ATTEMPT (bisa lebih lama dari
      // openLog kalau openLog ini sebetulnya RESUME setelah dijeda) —
      // BEDA dari sebelum Slice 3 (dulu SELALU sama dengan openLog.startedAt
      // karena openLog SELALU START, RESUME belum ada).
      startedAt: trueStartedAt, endedAt: now,
      // Sejak Slice 3: TOUCH TIME (mengecualikan jeda), BUKAN wall-clock
      // endedAt-startedAt lagi — untuk attempt TANPA jeda sama sekali,
      // dua-duanya identik (tidak ada yang dikurangi), jadi data lama tidak
      // berubah maknanya. NULL kalau timing tidak diketahui (retrospektif
      // tanpa startedAt asli) — JANGAN pernah 0, lihat computeExecutionTiming().
      durationSeconds: timing.timingKnown ? timing.touchSeconds : null,
      photoUrls, note,
    },
  });

  await recordActivity(tx, {
    entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.STAGE_COMPLETED, actorId,
    metadata: {
      stage: stage.labelId,
      touchSeconds: timing.timingKnown ? timing.touchSeconds : null,
      pausedSeconds: timing.timingKnown ? timing.pausedSeconds : null,
      elapsedSeconds: timing.timingKnown ? timing.elapsedSeconds : null,
    },
  });

  await advanceUnitPastStage(tx, unitId, stage);
  return log;
}

/**
 * GAGALKAN/blokir tahap yang sedang berjalan — Production Core Slice 2A:
 * ini SEKARANG "OPEN BLOCKER" (perintah eksplisit, PRD "no free-form status
 * mutation") — bukan cuma baris ledger. Wajib blockReason (PRD §6.2). TIDAK
 * mengubah currentStageId — unit tetap "di" tahap ini. Retry lewat
 * startStage() lagi (auto-resolve blokirnya, lihat catatan di sana) ATAU
 * resolveBlocker() manual dulu baru startStage() belakangan.
 *
 * Satu FAIL = satu baris unit_stage_logs (ledger, TIDAK BERUBAH) + SATU
 * baris production_blockers (lifecycle BARU, Slice 2) + SATU ActivityEvent
 * PRODUCTION_BLOCKED — ketiganya dalam transaksi yang sama (D-045: race dua
 * "Tandai Terhambat" bersamaan akan membuat percobaan kedua gagal lewat
 * partial unique index, ditangkap di bawah sebagai 409 — bukan diam-diam
 * membuat dua blokir aktif untuk unit yang sama).
 */
export async function failStage(unitId, stageId, { actorId, blockReason, note } = {}) {
  // Validasi MURNI (bisa diuji tanpa database) — lihat
  // lib/domain/productionExceptions.js#validateBlockReason.
  const validationError = validateBlockReason({ reason: blockReason, note });
  if (validationError) throw new StageTransitionError(validationError);

  try {
    return await prisma.$transaction(async (tx) => {
      const stage = await tx.routingStage.findUniqueOrThrow({ where: { id: stageId } });
      const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });

      // Pertahanan berlapis: findOpenWork di bawah SEHARUSNYA sudah
      // mustahil lolos untuk unit yang produksinya sudah tuntas (tidak ada
      // START/RESUME terbuka pada unit COMPLETED), tapi pesan error ini jauh
      // lebih jelas dibanding "tidak ada tahap yang sedang berjalan" kalau
      // ternyata ada jalur yang belum terpikirkan.
      if (!isProductionEligible(unit.status)) {
        throw new StageTransitionError("Unit ini sudah selesai/dibatalkan secara produksi — tidak bisa membuka blokir baru");
      }

      const open = await findOpenWork(tx, unitId, stageId);
      if (!open) {
        throw new StageTransitionError(`Tidak ada tahap "${stage.labelId}" yang sedang berjalan untuk unit ini`);
      }

      // Sejak Slice 3: startedAt/durationSeconds baris FAIL direkonstruksi
      // dari SELURUH attempt (bisa melalui beberapa jeda), bukan cuma
      // openLog.startedAt — konsisten dengan finishStageInternal() (lihat
      // catatan panjang di reconstructClosingTiming()). Sebelum ada jeda
      // sama sekali (dan sebelum Slice 3), openLog SELALU START, jadi
      // hasilnya identik dengan perilaku lama.
      const now = new Date();
      const { trueStartedAt, timing } = await reconstructClosingTiming(tx, unitId, stageId, "FAIL", now);

      const log = await tx.unitStageLog.create({
        data: {
          unitId, stageId, action: "FAIL", actorId, blockReason, note,
          startedAt: trueStartedAt, endedAt: now,
          durationSeconds: timing.timingKnown ? timing.touchSeconds : null,
        },
      });

      const blocker = await tx.productionBlocker.create({
        data: {
          unitId, stageId, stageLogId: log.id,
          reason: blockReason, note: note || null, openedById: actorId || null,
        },
      });

      await recordActivity(tx, {
        entityType: ENTITY_TYPES.UNIT, entityId: unitId,
        eventType: EVENT_TYPES.PRODUCTION_BLOCKED, actorId,
        metadata: { reason: blockReason, note: note || null, blockerId: blocker.id },
      });

      return { log, blocker };
    });
  } catch (err) {
    // P2002 = pelanggaran partial unique index production_blockers_unit_id_open_key
    // (lihat migration.sql) — dua "Tandai Terhambat" bersamaan untuk unit
    // yang sama, race window sudah ditutup DB, bukan kode ini.
    if (err.code === "P2002") {
      throw new StageTransitionError("Unit ini sudah punya blokir produksi yang masih terbuka", 409);
    }
    throw err;
  }
}

/**
 * RESOLVE BLOCKER — perintah eksplisit terpisah dari restart tahap
 * (Production Core Slice 2A). Dipakai kalau kondisi pemblokirnya sudah
 * selesai TAPI belum tentu ada yang langsung menekan "Mulai Lagi" saat itu
 * juga (mis. supervisor mencatat "bahan sudah datang" duluan).
 *
 * Idempotency lewat WHERE guard (`resolvedAt: null`) di updateMany, BUKAN
 * baca-lalu-tulis biasa — mencegah race dua klik "Resolve" bersamaan
 * menghasilkan dua ActivityEvent RESOLVED untuk satu blokir yang sama.
 * Resolusi kedua (baik dari sini maupun startStage() auto-resolve) SELALU
 * ditolak 409, bukan diam-diam "berhasil lagi".
 */
export async function resolveBlocker(blockerId, { actorId, resolutionNote } = {}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.productionBlocker.findUnique({ where: { id: blockerId } });
    if (!existing) throw new StageTransitionError("Blokir tidak ditemukan", 404);

    const result = await tx.productionBlocker.updateMany({
      where: { id: blockerId, resolvedAt: null },
      data: {
        resolvedAt: new Date(), resolvedById: actorId || null,
        resolutionNote: resolutionNote?.trim() || null,
      },
    });
    if (result.count === 0) {
      throw new StageTransitionError("Blokir ini sudah diselesaikan sebelumnya dan tidak bisa diubah lagi", 409);
    }

    await recordActivity(tx, {
      entityType: ENTITY_TYPES.UNIT, entityId: existing.unitId,
      eventType: EVENT_TYPES.PRODUCTION_BLOCKER_RESOLVED, actorId,
      metadata: { blockerId, reason: existing.reason, resolutionNote: resolutionNote?.trim() || null },
    });

    return tx.productionBlocker.findUniqueOrThrow({ where: { id: blockerId } });
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
    const open = await findOpenWork(tx, unitId, stageId);
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

    // Gagal -> rework. Tutup START/RESUME yang terbuka sebagai FAIL (rework,
    // bukan material_shortage/dst — QUALITY_ISSUE paling tepat mewakili
    // "belum pas"). startedAt/durationSeconds direkonstruksi dari SELURUH
    // attempt — pola sama dengan failStage()/finishStageInternal() (lihat
    // reconstructClosingTiming()).
    const reworkNow = new Date();
    const { trueStartedAt, timing } = await reconstructClosingTiming(tx, unitId, stageId, "FAIL", reworkNow);
    await tx.unitStageLog.create({
      data: {
        unitId, stageId, action: "FAIL", actorId, blockReason: "QUALITY_ISSUE",
        note: `QC gagal: ${verdict}`, startedAt: trueStartedAt, endedAt: reworkNow,
        durationSeconds: timing.timingKnown ? timing.touchSeconds : null,
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

/**
 * Bypass administratif SELURUH pipeline produksi (8 September 2026,
 * permintaan owner langsung — kasus Lim Fie Boen/RES-30082026-205/206,
 * Royhan Arief/RES-03092026-017, Julhan/RES-02092026-011, Windy Satya/
 * RES-03092026-016: pengambilan sudah selesai secara fisik, unit siap
 * kirim, TAPI tidak pernah dilacak lewat sistem produksi sama sekali —
 * currentStageId kosong, 0 log tahap, serviceId belum ditetapkan).
 *
 * BUKAN skipStage() — fungsi itu menolak keras tahap yang isOptional=false
 * (fit_test/Uji Berat Badan SENGAJA begitu, satu-satunya gerbang QC wajib
 * untuk SEMUA unit, lihat CLAUDE.md §1). BUKAN JUGA berjalan tahap demi
 * tahap lewat recordStageDone() — 7 dari 8 tahap aktif mewajibkan foto
 * (requiresPhoto), dan tidak ada satu pun foto asli untuk unit-unit ini.
 * Mencatat "selesai" per tahap tanpa foto/tanpa uji berat badan sungguhan
 * akan membuat ledger produksi TERLIHAT seperti alur normal berjalan
 * lengkap — itu fabrikasi data, dilarang keras di project ini (CLAUDE.md
 * prinsip atribusi jujur).
 *
 * Yang ditulis sebagai gantinya: SATU baris unit_stage_logs (action SKIP,
 * anchor ke tahap FINISH terakhir — bukan menunjuk tahap tertentu yang
 * "dilewati", catatannya sendiri yang menjelaskan seluruh pipeline
 * dilewati) + SATU ActivityEvent PRODUCTION_ADMIN_BYPASS yang eksplisit
 * bilang ini override manual, bukan produksi sungguhan. `note` WAJIB diisi
 * pemanggil (alasan/otorisasi) — fungsi ini SENGAJA tidak punya default
 * kosong, supaya jejaknya selalu bisa dipertanggungjawabkan ke seseorang.
 *
 * TIDAK ADA route/UI yang memanggil ini — sengaja hanya dipakai dari
 * script backfill bernama (scripts/backfill-admin-bypass-production.js),
 * ditinjau manusia per order, BUKAN tombol self-service dispatcher. Kalau
 * suatu hari mau diekspos ke UI, diskusikan dulu — bypass gerbang QC wajib
 * bukan keputusan yang pantas satu klik tanpa jejak persetujuan eksplisit.
 */
export async function adminBypassProduction(unitId, { actorId, note } = {}) {
  if (!note || !note.trim()) {
    throw new StageTransitionError("Catatan alasan bypass wajib diisi — ini override manual, harus bisa dipertanggungjawabkan");
  }
  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    if (["CANCELLED", "DELIVERED", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"].includes(unit.status)) {
      throw new StageTransitionError(`Unit sudah berstatus ${unit.status} — bypass ini cuma untuk unit yang masih tersangkut di produksi`);
    }
    const finishStages = await tx.routingStage.findMany({ where: { phase: "FINISH", active: true }, orderBy: { sequence: "desc" }, take: 1 });
    const anchorStage = finishStages[0];
    if (!anchorStage) throw new StageTransitionError("Tidak ada tahap FINISH aktif untuk dijadikan anchor — periksa konfigurasi routing_stages");

    const catatan = `⚠️ ADMIN OVERRIDE — seluruh tahap produksi (termasuk Uji Berat Badan) dilewati manual, BUKAN hasil produksi/QC sungguhan. ${note.trim()}`;
    await tx.unitStageLog.create({
      data: { unitId, stageId: anchorStage.id, action: "SKIP", actorId, note: catatan },
    });
    await tx.unit.update({
      where: { id: unitId },
      data: { currentStageId: anchorStage.id, status: "READY_FOR_DELIVERY" },
    });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_ADMIN_BYPASS,
      actorId, metadata: { note: note.trim() },
    });
    await syncOrderStatus(tx, unit.orderId);
    await suggestDeliveryJob(tx, unitId);
  });
}

export { StageTransitionError };
