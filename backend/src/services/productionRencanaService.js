// Rencana Produksi untuk ORDER NYATA (unit Diproses yang belum punya Production Run V2).
//
// Tiga hal yang dikerjakan di sini, semuanya memakai command/jalur resmi yang SUDAH ada (tidak ada tabel/flag baru):
//  1. planAndScheduleUnit — SATU command atomik untuk tombol "Jadwalkan" DAN seret-lepas: (bila perlu) membuka Run lalu membuat rencana lalu menjadwalkannya ke meja
//     dalam SATU transaksi. Gagal di mana pun = tidak ada yang tertulis (tidak ada Run yatim). Idempoten (v2_commands per actor+key).
//  2. getPlanningRefs — daftar workshop + PIC yang SAH untuk penjadwalan, dihitung server (bukan tebakan peran di browser), dengan alasan + tautan bila kosong.
//  3. listRencanaEligibility — daftar unit eligible beserta pengecualiannya (dipakai halaman Aktivasi Rencana dan skrip aktivasi cohort).
//
// Prinsip: status Diproses BUKAN bukti kedatangan fisik — Run dibuka PENDING_ARRIVAL; tahap produksi tetap menunggu "Unit Tiba di Workshop". Unit yang punya Job pickup
// selesai memakai penawaran custody resmi (offerUnitCustody) sehingga garis keturunan pickup + foto + konfirmasi tiba berjalan seperti biasa; unit tanpa pickup tercatat
// dibuka tanpa handoff (kedatangan dikonfirmasi petugas, lihat confirmUnitArrival). Cohort TIDAK pernah diperluas dari sini — unit di luar cohort ditolak 503 berkode.
import { createHash } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { UUID_RE, lockUnitOwnership } from "./unitV2Ownership.js";
import { PKR_ORDER_SELECT, PKR_UNIT_ITEM_SELECT, rujukanPkrDariOrder } from "./pkrProduksiGuard.js";
import { kategoriUnit, statusOrderEfektif } from "../lib/domain/unitKategori.js";
import { BOARD_DEFAULTS, formatProductionDate, normalizeScheduleInput } from "../lib/domain/productionBoard.js";
import { RENCANA_ACTION, activatableOnDrop, classifyRencanaUnit } from "../lib/domain/productionRencana.js";
import {
  V2_FLAGS, isProductionReaderEnabledFor, isProductionWriterEnabledFor, loadV2Flags, resolveProductionReaderState, resolveProductionWriterState,
} from "./v2FeatureFlags.js";
import { assertIdempotencyKey, createProductionPlanInTx, scheduleProductionPlanInTx } from "./productionPlanningCommandService.js";
import { offerUnitCustody, openPendingArrivalIntakeV2InTx } from "./unitCustodyCommandService.js";
import { BORN_CATEGORIES, BORN_UNIT_STATUSES, registerWorkshopBornRunInTx } from "./productionWorkshopExecutionCommandService.js";
import { confirmBuildCornerInTx, normalizeCornerInput } from "./productionBuildCommandService.js";

const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];
const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
const rencanaError = (message, statusCode, code, details) => Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });

// Kolom Unit yang dibutuhkan klasifikasi — dipakai backlog (bulk), command (satu unit), dan daftar eligibility.
export const RENCANA_UNIT_SELECT = {
  id: true, unitCode: true, status: true, currentStageId: true, workCategory: true, productLine: true, productType: true, ...PKR_UNIT_ITEM_SELECT,
  order: { select: { id: true, orderNumber: true, status: true, category: true, ...PKR_ORDER_SELECT, customer: { select: { name: true, pipelineStage: true, isInternalStaff: true } } } },
  _count: { select: { stageLogs: true, productionRunsV2: true } }, // productionRunsV2 = SEMUA Run (juga yang sudah selesai/dibatalkan) — dipakai gerbang aktivasi saat Jadwalkan
  productionRunsV2: { where: { status: { notIn: TERMINAL_RUN } }, select: { id: true, status: true, plan: { select: { id: true, stationCode: true, status: true } } }, take: 1, orderBy: { createdAt: "desc" } },
};

export function cohortStatesOf(flags) {
  return { reader: resolveProductionReaderState(flags), writer: resolveProductionWriterState(flags) };
}

export function classifyUnitRow(row, { reader, writer }) {
  const pkr = rujukanPkrDariOrder(row.order, { unit: row }); // order Penjualan Karyawan: ITEM unit ini belum lengkap = tidak boleh direncanakan (item lain tidak ikut tertahan)
  return classifyRencanaUnit({
    pkrKurang: pkr && !pkr.lengkap ? { nomor: pkr.nomor, kurang: pkr.kurang } : null,
    unitStatus: row.status, orderStatus: statusOrderEfektif(row.order, row), customerStage: row.order?.customer?.pipelineStage ?? null, isInternalStaff: !!row.order?.customer?.isInternalStaff,
    hasActiveRun: row.productionRunsV2.length > 0, stageLogCount: row._count?.stageLogs ?? 0, hasCurrentStage: !!row.currentStageId,
    readerEnabled: isProductionReaderEnabledFor(reader, row.id), writerEnabled: isProductionWriterEnabledFor(writer, row.id),
  });
}

function errorForClassification(cls) {
  if (cls.action === RENCANA_ACTION.AWAIT_ACTIVATION) return rencanaError(`${cls.message} ${cls.next}`, 503, "RENCANA_UNIT_NOT_ACTIVATED");
  if (cls.action === RENCANA_ACTION.WAIT_PICKUP) return rencanaError(cls.message, 409, "RENCANA_WAIT_PICKUP");
  return rencanaError(cls.message, 422, `RENCANA_${cls.code || "NOT_ELIGIBLE"}`);
}

// Buka Run untuk unit eligible di DALAM transaksi pemanggil. Unit SUDAH dikunci (baris + kepemilikan) oleh pemanggil. Mengembalikan Run non-terminal yang sudah ada tanpa membuat baru
// (cegah Run ganda; index unik parsial production_runs_v2_active_unit_key menjaga di DB).
export async function openRencanaRunInTx(tx, { unitId, actorId = null, idempotencyKey = null }) {
  const row = await tx.unit.findUnique({ where: { id: unitId }, select: RENCANA_UNIT_SELECT });
  if (!row) throw rencanaError("Unit tidak ditemukan", 404, "RENCANA_UNIT_NOT_FOUND");
  const cls = classifyUnitRow(row, cohortStatesOf(await loadV2Flags(tx)));
  if (cls.action === RENCANA_ACTION.SCHEDULE) return { runId: row.productionRunsV2[0].id, onboarded: false, viaCustody: false, jobId: null, origin: null };
  if (cls.action !== RENCANA_ACTION.ONBOARD_SCHEDULE) throw errorForClassification(cls);

  // Unit BARU/SEWA tanpa pickup/custody/riwayat V1 = LAHIR di workshop (jalur resmi P5: Run WORKSHOP_BORN, sudah di workshop — tidak ada "kedatangan" yang perlu dikonfirmasi).
  const anyPickup = await tx.jobUnit.count({ where: { unitId, job: { type: "PICKUP" } } });
  const anyInbound = await tx.unitCustodyHandoff.count({ where: { unitId, direction: "INBOUND" } });
  if (BORN_CATEGORIES.includes(kategoriUnit(row, row.order)) && BORN_UNIT_STATUSES.includes(row.status) && !anyPickup && !anyInbound && idempotencyKey) {
    const born = await registerWorkshopBornRunInTx(tx, { unitId, actorId, idempotencyKey: `${idempotencyKey}:born` });
    await recordActivity(tx, {
      entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_RUN_ONBOARDED_RENCANA, actorId: actorId || null,
      metadata: { unitCode: row.unitCode, runId: born.runId, viaCustody: false, jobId: null, origin: "WORKSHOP_BORN" },
    });
    return { runId: born.runId, onboarded: true, viaCustody: false, jobId: null, origin: "WORKSHOP_BORN" };
  }
  const job = (await tx.job.findMany({
    where: { type: "PICKUP", status: "COMPLETED", units: { some: { unitId } } },
    select: { id: true }, orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take: 1,
  }))[0] || null;
  let viaCustody = false;
  if (job) { // garis keturunan resmi: handoff INBOUND OFFERED (+ Run PENDING_ARRIVAL dibuka oleh offerOne) — "Unit Tiba" memakai jalur custody biasa
    const offered = await offerUnitCustody(tx, { direction: "INBOUND", unitIds: [unitId], jobId: job.id, actorId });
    viaCustody = offered.some((o) => !o.replayed);
  }
  let run = await tx.productionRun.findFirst({ where: { unitId, status: { notIn: TERMINAL_RUN } }, select: { id: true } });
  if (!run) run = (await openPendingArrivalIntakeV2InTx(tx, { unitId, actorId })).run;
  await recordActivity(tx, {
    entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_RUN_ONBOARDED_RENCANA, actorId: actorId || null,
    metadata: { unitCode: row.unitCode, runId: run.id, viaCustody, jobId: job?.id ?? null, origin: "CUSTODY_PICKUP" },
  });
  return { runId: run.id, onboarded: true, viaCustody, jobId: job?.id ?? null, origin: "CUSTODY_PICKUP" };
}

// Aktivasi unit untuk Rencana Produksi SAAT dijadwalkan (seret-lepas/Jadwalkan) — di DALAM transaksi pemanggil, jadi gagal di mana pun = unit TIDAK teraktivasi. Padanan skrip
// activate-rencana-units.js untuk SATU unit: hanya MENAMBAH unit ke cohort reader+writer (kunci baris flag, cohort lama utuh), flag yang MATI/cohort rusak = berhenti (menyalakan flag
// tetap keputusan terpisah). Pemanggil WAJIB sudah memastikan izin (production_settings:write) dan kemauan eksplisit (activateUnit=true).
export async function activateRencanaUnitInTx(tx, { unitId, actorId = null, idempotencyKey = null }) {
  await tx.$queryRawUnsafe("SELECT key FROM v2_feature_flags WHERE key IN ($1, $2) ORDER BY key FOR UPDATE", V2_FLAGS.PRODUCTION_READER, V2_FLAGS.PRODUCTION_WRITER);
  const flags = await loadV2Flags(tx);
  const states = cohortStatesOf(flags);
  for (const [label, key, s] of [["reader", V2_FLAGS.PRODUCTION_READER, states.reader], ["writer", V2_FLAGS.PRODUCTION_WRITER, states.writer]]) {
    if (!flags[key]?.enabled || s.mode !== "COHORT") {
      throw rencanaError(`Rencana Produksi belum menyala untuk cohort (flag ${label}: ${s.diagnostic || "OFF"}) — menyalakannya adalah keputusan terpisah; unit tidak diaktifkan.`, 503, "RENCANA_ACTIVATION_FLAGS_OFF");
    }
  }
  const row = await tx.unit.findUnique({ where: { id: unitId }, select: RENCANA_UNIT_SELECT });
  if (!row) throw rencanaError("Unit tidak ditemukan", 404, "RENCANA_UNIT_NOT_FOUND");
  const cls = classifyUnitRow(row, states);
  // Keadaan berubah sejak modal dibuka (orang lain sudah mengaktifkan/menjadwalkan unit ini): JANGAN diam-diam menjadwalkan ulang milik orang lain — muat ulang lalu putuskan lagi.
  if (cls.action === RENCANA_ACTION.SCHEDULE || cls.action === RENCANA_ACTION.ONBOARD_SCHEDULE) {
    throw rencanaError("Unit ini sudah diaktifkan atau dijadwalkan oleh orang lain saat Anda membuka formulir. Muat ulang papan lalu periksa jadwalnya.", 409, "RENCANA_ACTIVATION_STALE");
  }
  if (cls.action === RENCANA_ACTION.AWAIT_ACTIVATION && (row._count?.productionRunsV2 ?? 0) > 0) {
    throw rencanaError("Unit ini pernah punya pekerjaan produksi (sudah selesai/dibatalkan) — tidak diaktifkan lewat penjadwalan. Pengaktifannya keputusan terpisah Owner/tim sistem.", 422, "RENCANA_HAS_PRIOR_RUN");
  }
  if (!activatableOnDrop(cls, { stageLogCount: row._count?.stageLogs ?? 0, hasCurrentStage: !!row.currentStageId, runCount: row._count?.productionRunsV2 ?? 0 })) throw errorForClassification(cls);

  const id = String(unitId).toLowerCase();
  const reason = `Aktivasi Rencana Produksi saat Jadwalkan: +1 unit ${row.unitCode} (rencana-drop${idempotencyKey ? `, ${String(idempotencyKey).slice(0, 40)}` : ""}, ${new Date().toISOString()})`;
  const before = { reader: [...states.reader.unitIds].sort(), writer: [...states.writer.unitIds].sort() };
  for (const key of [V2_FLAGS.PRODUCTION_READER, V2_FLAGS.PRODUCTION_WRITER]) {
    const flag = await tx.v2FeatureFlag.findUniqueOrThrow({ where: { key } });
    const current = Array.isArray(flag.config?.unitIds) ? flag.config.unitIds.map((x) => String(x).toLowerCase()) : [];
    const list = [...new Set([...current, id])].sort();
    await tx.v2FeatureFlag.update({ where: { key }, data: { config: { ...(flag.config || {}), unitIds: list }, reason } });
  }
  await recordActivity(tx, {
    entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_RENCANA_UNIT_ACTIVATED, actorId: actorId || null,
    metadata: { unitCode: row.unitCode, sebelumnya: cls.code || cls.action, cohortSebelum: { reader: before.reader.length, writer: before.writer.length } },
  });
  return { activated: true, previous: cls.code || cls.action, cohortBefore: { reader: before.reader.length, writer: before.writer.length } };
}

// ---------------------------------------------------------------------------
// 1. Jadwalkan unit (onboarding bila perlu) — SATU transaksi, SATU pintu untuk tombol Jadwalkan dan seret-lepas.
// ---------------------------------------------------------------------------
export async function planAndScheduleUnit(prisma, { unitId, actorId, idempotencyKey, input = {}, config = BOARD_DEFAULTS, canActivate = false }) {
  if (!unitId || !UUID_RE.test(String(unitId))) throw rencanaError("unitId wajib diisi (UUID)", 400, "RENCANA_UNIT_ID_INVALID");
  assertIdempotencyKey(idempotencyKey);
  const data = normalizeScheduleInput(input, config, { deferResources: true }); // 400 bila tanggal/meja/prioritas tidak valid — SEBELUM menyentuh DB; PIC/workshop dilengkapi dari PIC bawaan meja di dalam transaksi
  // Pilihan "Corner diperlukan?" (modal Jadwalkan jalur pengerjaan) — validasi yang SAMA dengan command Unit 360, sebelum DB; alasan wajib bila tidak diperlukan.
  const corner = input.cornerRequired === undefined || input.cornerRequired === null ? null : normalizeCornerInput({ required: input.cornerRequired, reason: input.cornerReason });
  if (data.unschedule) throw rencanaError("Mengeluarkan dari papan dilakukan lewat jadwal rencana yang sudah ada", 400, "RENCANA_UNSCHEDULE_NOT_SUPPORTED");
  // Aktivasi saat Jadwalkan = keputusan sadar: wajib eksplisit (activateUnit=true) DAN pemegang izin Pengaturan Produksi (ADMIN/OWNER). Dicek SEBELUM menyentuh DB.
  const activate = input.activateUnit === true;
  if (activate && !canActivate) throw rencanaError("Mengaktifkan unit untuk Rencana Produksi hanya untuk Admin/Owner.", 403, "RENCANA_ACTIVATION_FORBIDDEN");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RENCANA_PLAN_SCHEDULE_UNIT", unitId, ...data, productionDate: formatProductionDate(data.productionDate), ...(corner ? { corner } : {}), ...(activate ? { activateUnit: true } : {}), ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}) });

  return prisma.$transaction(async (tx) => {
    // Kunci unit LEBIH DULU, baru cari replay: dua permintaan bersamaan dengan kunci yang sama diserialkan di sini — yang kalah menunggu lalu MELIHAT command yang sudah commit
    // (replay), bukan menabrak unique key sebagai "duplikat". Urutan kunci sama dengan pembuka Run lain: unit -> run -> plan.
    await lockRowForUpdate(tx, "units", unitId);
    await lockUnitOwnership(tx, unitId);
    const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw rencanaError("Idempotency-Key dipakai untuk payload berbeda", 409, "IDEMPOTENCY_CONFLICT");
      if (replay.status !== "APPLIED") throw rencanaError("Command masih diproses", 409, "COMMAND_IN_PROGRESS");
      return { ...replay.response, replayed: true };
    }
    const command = await tx.v2Command.create({
      data: { domain: "PRODUCTION", actorId: actor, idempotencyKey, commandType: "RENCANA_PLAN_SCHEDULE_UNIT", aggregateType: "Unit", aggregateId: unitId, requestHash },
    });
    // Aktivasi (bila diminta) SEBELUM membuka Run: satu transaksi dengan Run + rencana + jadwal. Unit yang sudah aktif = tidak ada perubahan (activated:false).
    const activation = activate ? await activateRencanaUnitInTx(tx, { unitId, actorId, idempotencyKey }) : null;
    const opened = await openRencanaRunInTx(tx, { unitId, actorId, idempotencyKey });
    let plan = await tx.productionRunPlan.findUnique({ where: { runId: opened.runId }, select: { id: true, revision: true, status: true } });
    let created = false;
    if (plan?.status === "CANCELLED") throw rencanaError("Rencana unit ini sudah dibatalkan dan satu pekerjaan hanya boleh punya satu rencana — hubungi tim sistem untuk membuka ulang.", 409, "RENCANA_PLAN_CANCELLED");
    if (!plan) {
      const c = await createProductionPlanInTx(tx, { runId: opened.runId, actorId, idempotencyKey: `${idempotencyKey}:create` });
      plan = { id: c.planId, revision: c.revision }; created = true;
    }
    const scheduled = await scheduleProductionPlanInTx(tx, {
      planId: plan.id, actorId, idempotencyKey: `${idempotencyKey}:schedule`, expectedRevision: plan.revision, config,
      productionDate: input.productionDate, stationCode: input.stationCode, priority: input.priority,
      workCenterId: input.workCenterId, operatorId: input.operatorId, cornerWorkCenterId: input.cornerWorkCenterId, cornerOperatorId: input.cornerOperatorId,
      ...(Object.prototype.hasOwnProperty.call(input, "targetDate") ? { targetDate: input.targetDate } : {}), rescheduleReason: input.rescheduleReason, rescheduleNote: input.rescheduleNote,
    });
    // Corner dikonfirmasi pada rencana: SATU transaksi dengan onboarding + jadwal. Bukan jalur pengerjaan (mis. Run lain/custody/SEWA) = ditolak (422/409), tidak diam-diam diabaikan.
    let cornerResult = null;
    if (corner) {
      if (opened.origin !== "WORKSHOP_BORN") throw rencanaError("Pilihan Corner hanya untuk pesanan BARU/custom yang dikerjakan langsung di workshop", 422, "RENCANA_CORNER_NOT_APPLICABLE");
      cornerResult = await confirmBuildCornerInTx(tx, { runId: opened.runId, choice: corner, actorId, idempotencyKey: `${idempotencyKey}:corner` });
    }
    const response = { ...scheduled, runId: opened.runId, onboarded: opened.onboarded, viaCustody: opened.viaCustody, origin: opened.origin, created, ...(activation?.activated ? { activated: true } : {}), ...(cornerResult ? { corner: cornerResult.corner } : {}) };
    await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision: scheduled.revision, response, completedAt: new Date() } });
    return { ...response, replayed: false };
  }, { timeout: 20_000, maxWait: 10_000 });
}

// ---------------------------------------------------------------------------
// 2. Referensi penjadwalan: workshop + PIC yang sah, dihitung server. Kosong = ada alasan + tindakan berikutnya (tidak pernah kosong tanpa penjelasan).
// ---------------------------------------------------------------------------
// Keputusan Owner (11 Okt 2026): akun ADMIN/OWNER tidak muncul sebagai pilihan PIC (dropdown). Hanya menyaring PILIHAN: profil operator & riwayat tidak dihapus/diubah, dan ADMIN/OWNER tetap
// boleh mengerjakan semua lini (PRODUCTION_EXECUTE_ANY) tanpa menjadi PIC terdaftar di papan.
export const PIC_EXCLUDED_ROLES = Object.freeze(["ADMIN", "OWNER"]);
const bukanAdminOwner = { role: { notIn: PIC_EXCLUDED_ROLES }, roles: { none: { role: { in: PIC_EXCLUDED_ROLES } } } };
export const PRODUCTION_PIC_ROLES = Object.freeze(["PRODUCTION_WORKER"]); // yang mengerjakan Meja/Corner; Kepala Produksi tetap bisa mendaftarkan siapa pun lewat tab Operator
// Tautan ke tab Pengaturan Produksi (TabbedHub membaca ?tab=): Operator (PIC) & Area Kerja (workshop).
const LINKS = Object.freeze({ operators: "/bengkel/pengaturan?tab=operator", workCenters: "/bengkel/pengaturan?tab=area-kerja", settings: "/bengkel/pengaturan" });

export async function getPlanningRefs(prisma, { canRegisterOperator = false } = {}) {
  const [workCenters, operators, candidates] = await Promise.all([
    prisma.workCenter.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.productionOperator.findMany({
      where: { active: true, user: { active: true, ...bukanAdminOwner } },
      select: { id: true, employeeCode: true, primaryWorkCenterId: true, user: { select: { id: true, name: true } }, primaryWorkCenter: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { active: true, ...bukanAdminOwner, productionOperatorProfile: { is: null }, OR: [{ roles: { some: { role: { in: PRODUCTION_PIC_ROLES } } } }, { role: { in: PRODUCTION_PIC_ROLES } }] }, // peran multi-role (user_roles) ATAU kolom peran lama
      select: { id: true, name: true, roles: { select: { role: true } } }, orderBy: { name: "asc" },
    }),
  ]);
  const inactiveProfiles = await prisma.productionOperator.count({ where: { OR: [{ active: false }, { user: { active: false } }] } });
  const problems = [];
  if (workCenters.length === 0) problems.push({ code: "NO_WORK_CENTER", message: "Belum ada workshop (work center) aktif — penjadwalan butuh minimal satu.", link: LINKS.workCenters, linkLabel: "Buka Work Centers" });
  if (operators.length === 0) {
    problems.push(candidates.length
      ? { code: "NO_PIC_PROFILE", message: `Belum ada PIC terdaftar. ${candidates.length} akun produksi aktif belum didaftarkan sebagai operator/PIC${canRegisterOperator ? " — daftarkan dari daftar di bawah." : " — minta Admin/Kepala Produksi mendaftarkannya."}`, link: LINKS.operators, linkLabel: "Buka Operators" }
      : { code: "NO_PIC_ACCOUNT", message: `Tidak ada akun aktif berperan Produksi (${PRODUCTION_PIC_ROLES.join("/")}) yang bisa dijadikan PIC${inactiveProfiles ? `; ${inactiveProfiles} profil operator ada tetapi nonaktif` : ""}. Beri peran produksi pada akun di Pengguna & Peran, lalu daftarkan sebagai operator.`, link: LINKS.operators, linkLabel: "Buka Operators" });
  } else if (operators.length < 2) {
    problems.push({ code: "ONLY_ONE_PIC", message: `Baru ${operators.length} PIC terdaftar${candidates.length ? `; ${candidates.length} akun produksi lain belum didaftarkan` : ""}. PIC Corner opsional memakai daftar yang sama.`, link: LINKS.operators, linkLabel: "Kelola Operators", severity: "info" });
  }
  return {
    workCenters,
    operators: operators.map((o) => ({ id: o.id, name: o.user.name, userId: o.user.id, employeeCode: o.employeeCode, primaryWorkCenterId: o.primaryWorkCenterId, primaryWorkCenterName: o.primaryWorkCenter?.name ?? null })),
    candidates: candidates.map((c) => ({ userId: c.id, name: c.name, roles: c.roles.map((r) => r.role).filter((r) => PRODUCTION_PIC_ROLES.includes(r)) })),
    problems, links: LINKS, canRegisterOperator,
    // Pemetaan area kerja: workshop bawaan = work center utama PIC bila ada, kalau tidak workshop pertama. Server tidak memilih diam-diam — hanya saran awal formulir.
    defaultWorkCenterId: workCenters.length === 1 ? workCenters[0].id : null,
  };
}

// ---------------------------------------------------------------------------
// 3. Eligibility: daftar unit nyata (Diproses + Pengambilan) beserta kelayakan & pengecualian. BACA-SAJA.
// ---------------------------------------------------------------------------
export async function listRencanaEligibility(prisma, { limit = 500 } = {}) {
  const flags = await loadV2Flags(prisma);
  const states = cohortStatesOf(flags);
  const rows = await prisma.unit.findMany({
    where: {
      status: { in: ["RECEIVED", "IN_PRODUCTION", "AWAITING_PICKUP", "IN_TRANSIT_IN"] },
      order: { status: { in: ["PROCESSING", "PENDING", "PICKUP"] }, customer: { pipelineStage: { not: "SPAM" }, isInternalStaff: false } },
    },
    select: { ...RENCANA_UNIT_SELECT }, orderBy: { createdAt: "asc" }, take: Math.min(Math.max(limit, 1), 2000),
  });
  const summary = { total: rows.length, byAction: {}, byException: {} };
  const units = rows.map((r) => {
    const cls = classifyUnitRow(r, states);
    summary.byAction[cls.action] = (summary.byAction[cls.action] || 0) + 1;
    if (cls.code) summary.byException[cls.code] = (summary.byException[cls.code] || 0) + 1;
    return {
      unitId: r.id, unitCode: r.unitCode, orderNumber: r.order?.orderNumber ?? null, customerName: r.order?.customer?.name ?? null, unitStatus: r.status, orderStatus: r.order?.status ?? null,
      action: cls.action, code: cls.code, message: cls.message, next: cls.next, hasRun: r.productionRunsV2.length > 0,
      inReaderCohort: isProductionReaderEnabledFor(states.reader, r.id), inWriterCohort: isProductionWriterEnabledFor(states.writer, r.id),
    };
  });
  return {
    summary, units,
    cohort: { reader: { mode: states.reader.mode, size: states.reader.unitIds.size, diagnostic: states.reader.diagnostic }, writer: { mode: states.writer.mode, size: states.writer.unitIds.size, diagnostic: states.writer.diagnostic } },
    activation: { script: "node scripts/production-delivery-v2/activate-rencana-units.js", note: "Aktivasi adalah keputusan Owner: skrip berjalan dry-run kecuali diberi --apply; menambah unit ke cohort reader+writer tanpa mengubah unit lain." },
  };
}
