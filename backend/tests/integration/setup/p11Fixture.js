// Fixture P11 (Reporting & KPI): 40+ unit V2 dengan skenario terkontrol (tepat waktu, terlambat, shortage, retur, waste, rework, QC lulus/gagal,
// dokumentasi lengkap/kurang, empat meja, batas WIB). Data dimasukkan LANGSUNG ke tabel V2 supaya cap waktu bisa dikendalikan persis
// (laporan bersifat baca-saja; yang diuji adalah rumus & pembacaan, bukan command penulis). Setiap spec membawa nilai yang dipakai test
// untuk menghitung HARAPAN secara independen (tanpa memanggil kode laporan).
import "./env.js";
import { testPrisma } from "./testDb.js";
import { createTestMaterial, createTestUser } from "./fixtures.js";
import { BOARD_DEFAULTS } from "../../../src/lib/domain/productionBoard.js";

export const NOW = new Date("2026-10-20T08:00:00.000Z"); // 15:00 WIB, Selasa 20 Okt 2026
export const D = (key, hh = 0, mm = 0) => new Date(`${key}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+07:00`);
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const PERIOD = { from: "2026-10-01", to: "2026-10-20" };
const STATIONS = BOARD_DEFAULTS.stations;

let seq = 0;
export async function buildFixture() {
  const stages = Object.fromEntries((await testPrisma.routingStage.findMany()).map((s) => [s.code, s]));
  const service = await testPrisma.serviceCatalog.findUniqueOrThrow({ where: { code: "UPG_FONDASI_LAYANAN" } }).catch(async () => testPrisma.serviceCatalog.findFirstOrThrow({ where: { active: true } }));
  const moduleStage = (await testPrisma.serviceCatalogModule.findMany({ where: { serviceId: service.id }, include: { stage: true }, orderBy: { sequence: "asc" } }))[0]?.stage;
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-P11-${++seq}-${Date.now()}`, name: "Workshop P11" } });
  const mejaUsers = []; const cornerUsers = [];
  for (const n of ["Andi", "Sari", "Budi", "Rina"]) { const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); await testPrisma.user.update({ where: { id: u.user.id }, data: { name: n } }); mejaUsers.push({ ...u, op: await testPrisma.productionOperator.create({ data: { userId: u.user.id, primaryWorkCenterId: wc.id } }), name: n }); }
  for (const n of ["Tika", "Yudi"]) { const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); await testPrisma.user.update({ where: { id: u.user.id }, data: { name: n } }); cornerUsers.push({ ...u, op: await testPrisma.productionOperator.create({ data: { userId: u.user.id, primaryWorkCenterId: wc.id } }), name: n }); }
  const mats = [await createTestMaterial({ name: "Busa P11", unit: "SHEET" }), await createTestMaterial({ name: "Per P11", unit: "PCS" })];

  const specs = [];
  const S = (over) => { const s = { code: `P11-${String(specs.length + 1).padStart(2, "0")}`, kind: "done", priority: 0, ...over }; specs.push(s); return s; };
  // --- A: 8 selesai TEPAT WAKTU & siap kirim (meja berputar). selesai 15:00, target 17:00, siap kirim = +k jam.
  for (let i = 0; i < 8; i += 1) { const planned = `2026-10-${String(5 + i).padStart(2, "0")}`; S({ tag: "ontime", station: STATIONS[i % 4], planned, arrived: D(addDays(planned, -1), 9), started: D(planned, 9), finished: D(planned, 15), target: D(planned, 17), ready: D(planned, 15 + 2 + i), qc: [{ result: "PASS", at: D(planned, 14) }], docs: i % 2 === 0 ? "full" : "partial", priority: i % 3 }); }
  // --- B: 4 selesai TERLAMBAT (selesai 19:30, target 17:00), siap kirim esok 10:00
  for (let i = 0; i < 4; i += 1) { const planned = `2026-10-${String(13 + i).padStart(2, "0")}`; S({ tag: "late", station: STATIONS[(i + 1) % 4], planned, arrived: D(addDays(planned, -1), 10), started: D(planned, 9), finished: D(planned, 19, 30), target: D(planned, 17), ready: D(addDays(planned, 1), 10), qc: [{ result: "PASS", at: D(planned, 18) }], docs: "partial" }); }
  // --- C: 2 rework (QC v1 GAGAL lalu v2 LULUS), selesai besok 16:00 (tepat waktu thd target besok)
  for (let i = 0; i < 2; i += 1) { const planned = `2026-10-${String(9 + i).padStart(2, "0")}`; S({ tag: "rework", station: STATIONS[i], planned, arrived: D(addDays(planned, -1), 9), started: D(planned, 9), finished: D(addDays(planned, 1), 16), target: D(addDays(planned, 1), 17), ready: D(addDays(planned, 2), 9), qc: [{ result: "FAIL_REWORK", at: D(planned, 14) }, { result: "PASS", at: D(addDays(planned, 1), 12) }], docs: "full", textureRetest: i === 0 }); }
  // --- D: QC pertama GAGAL, masih dikerjakan ulang (op aktif)
  S({ tag: "qcfail_open", kind: "active", station: "TABLE_3", planned: "2026-10-19", arrived: D("2026-10-18", 9), started: D("2026-10-19", 9), target: D("2026-10-21", 17), qc: [{ result: "FAIL_REWORK", at: D("2026-10-19", 14) }], opStatus: "ACTIVE", docs: "partial" });
  // --- E: kekurangan bahan: 2 terbuka (TERTUNDA), 1 selesai dalam 120 mnt (unit lulus & siap kirim)
  for (let i = 0; i < 2; i += 1) S({ tag: "shortage_open", kind: "active", station: STATIONS[i + 1], planned: "2026-10-18", arrived: D("2026-10-17", 9), started: D("2026-10-18", 9), target: D("2026-10-21", 17), shortage: { reportedAt: D("2026-10-18", 10 + i), resolvedAt: null }, opStatus: "PAUSED", docs: "partial" });
  S({ tag: "shortage_resolved", station: "TABLE_4", planned: "2026-10-10", arrived: D("2026-10-09", 9), started: D("2026-10-10", 9), finished: D("2026-10-10", 16), target: D("2026-10-10", 17), ready: D("2026-10-11", 9), qc: [{ result: "PASS", at: D("2026-10-10", 15) }], shortage: { reportedAt: D("2026-10-10", 9), resolvedAt: D("2026-10-10", 11) }, docs: "full" });
  // --- F: retur pending (barang jadi tertahan), parsial, selesai
  S({ tag: "return_pending", kind: "finished_waiting", station: "TABLE_1", planned: "2026-10-18", arrived: D("2026-10-17", 9), started: D("2026-10-18", 9), finished: D("2026-10-18", 16), target: D("2026-10-18", 17), qc: [{ result: "PASS", at: D("2026-10-18", 15) }], fgOffered: D("2026-10-19", 8), ret: { qty: 1, status: "PENDING", requestedAt: D("2026-10-19", 8) }, docs: "partial" });
  S({ tag: "return_partial", station: "TABLE_2", planned: "2026-10-12", arrived: D("2026-10-11", 9), started: D("2026-10-12", 9), finished: D("2026-10-12", 14), target: D("2026-10-12", 17), ready: D("2026-10-12", 18), qc: [{ result: "PASS", at: D("2026-10-12", 13) }], ret: { qty: 1, status: "RECEIVED", receivedQty: 0.5, requestedAt: D("2026-10-12", 10), receivedAt: D("2026-10-12", 12) }, docs: "full" });
  S({ tag: "return_done", station: "TABLE_3", planned: "2026-10-13", arrived: D("2026-10-12", 9), started: D("2026-10-13", 9), finished: D("2026-10-13", 14), target: D("2026-10-13", 17), ready: D("2026-10-13", 18), qc: [{ result: "PASS", at: D("2026-10-13", 13) }], ret: { qty: 1, status: "RECEIVED", receivedQty: 1, requestedAt: D("2026-10-13", 10), receivedAt: D("2026-10-13", 11) }, docs: "full" });
  // --- G: waste
  for (let i = 0; i < 2; i += 1) S({ tag: "waste", station: STATIONS[i + 2], planned: `2026-10-${14 + i}`, arrived: D(`2026-10-${13 + i}`, 9), started: D(`2026-10-${14 + i}`, 9), finished: D(`2026-10-${14 + i}`, 15), target: D(`2026-10-${14 + i}`, 17), ready: D(`2026-10-${14 + i}`, 19), qc: [{ result: "PASS", at: D(`2026-10-${14 + i}`, 14) }], waste: i === 0 ? 0.5 : 1, docs: "full" });
  // --- H: bahan tambahan (BOM tambahan + permintaan rework)
  S({ tag: "extra", station: "TABLE_4", planned: "2026-10-16", arrived: D("2026-10-15", 9), started: D("2026-10-16", 9), finished: D("2026-10-16", 15), target: D("2026-10-16", 17), ready: D("2026-10-16", 19), qc: [{ result: "PASS", at: D("2026-10-16", 14) }], extra: true, docs: "full" });
  // --- I: sedang dikerjakan (3), J: dijeda/diblokir, K: menunggu QC, L: barang jadi menunggu, M: dalam perjalanan/masuk
  for (let i = 0; i < 3; i += 1) S({ tag: "working", kind: "active", station: STATIONS[i], planned: "2026-10-20", arrived: D("2026-10-19", 9), started: D("2026-10-20", 8), target: D("2026-10-20", 17), opStatus: "ACTIVE", docs: "partial", exception: i === 2 });
  S({ tag: "paused", kind: "active", station: "TABLE_4", planned: "2026-10-20", arrived: D("2026-10-19", 9), started: D("2026-10-20", 8), target: D("2026-10-20", 17), opStatus: "PAUSED", pauseSince: D("2026-10-20", 9), docs: "partial" });
  S({ tag: "blocked", kind: "active", station: "TABLE_1", planned: "2026-10-20", arrived: D("2026-10-19", 9), started: D("2026-10-20", 8), target: D("2026-10-20", 17), opStatus: "BLOCKED", blockedSince: D("2026-10-20", 10), docs: "partial" });
  for (let i = 0; i < 2; i += 1) S({ tag: "waiting_qc", kind: "active", phase: "QC", station: STATIONS[i + 1], planned: "2026-10-20", arrived: D("2026-10-19", 9), started: D("2026-10-20", 8), target: D("2026-10-20", 17), opStatus: null, docs: "partial" });
  S({ tag: "fg_waiting", kind: "finished_waiting", station: "TABLE_2", planned: "2026-10-19", arrived: D("2026-10-18", 9), started: D("2026-10-19", 8), finished: D("2026-10-19", 10), target: D("2026-10-19", 17), qc: [{ result: "PASS", at: D("2026-10-19", 9) }], fgOffered: D("2026-10-19", 10, 30), docs: "full" });
  for (let i = 0; i < 2; i += 1) S({ tag: "in_transit", kind: "transit", docs: "none" });
  S({ tag: "unscheduled", kind: "active", arrived: D("2026-10-19", 9), docs: "none", opStatus: null });
  S({ tag: "late_open", kind: "active", station: "TABLE_2", planned: "2026-10-19", arrived: D("2026-10-18", 9), started: D("2026-10-19", 9), target: D("2026-10-19", 17), opStatus: "ACTIVE", docs: "partial" });
  // --- N: batas hari/bulan WIB: selesai 2026-09-30T17:30Z = 1 Okt 00:30 WIB (DI DALAM periode), dan 2026-10-20T17:30Z = 21 Okt 00:30 WIB (DI LUAR)
  S({ tag: "wib_in", station: "TABLE_1", planned: "2026-10-01", arrived: D("2026-09-30", 9), started: D("2026-09-30", 9), finished: new Date("2026-09-30T17:30:00.000Z"), target: D("2026-10-01", 17), ready: D("2026-10-01", 9), qc: [{ result: "PASS", at: D("2026-09-30", 20) }], docs: "full" });
  S({ tag: "wib_out", station: "TABLE_2", planned: "2026-10-20", arrived: D("2026-10-19", 9), started: D("2026-10-20", 9), finished: new Date("2026-10-20T17:30:00.000Z"), target: D("2026-10-21", 17), ready: D("2026-10-21", 9), qc: [{ result: "PASS", at: D("2026-10-20", 20) }], docs: "full" });
  // --- O: sebelum periode (September) — bukan bagian periode Okt
  S({ tag: "september", station: "TABLE_3", planned: "2026-09-10", arrived: D("2026-09-09", 9), started: D("2026-09-10", 9), finished: D("2026-09-10", 15), target: D("2026-09-10", 17), ready: D("2026-09-10", 18), qc: [{ result: "PASS", at: D("2026-09-10", 14) }], docs: "full" });

  const driver = await createTestUser({ roles: ["DRIVER"] });
  const route = await testPrisma.route.create({ data: { code: `P11-RTE-${Date.now()}`, date: new Date("2026-09-29T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id } });
  const unitsByCode = new Map();
  const docCats = [["BEFORE_TEARDOWN", 2], ["PROCESS", 2], ["FINAL_RESULT", 3]];
  for (const s of specs) {
    s.stationIdx = s.station ? STATIONS.indexOf(s.station) : null;
    const customer = await testPrisma.customer.create({ data: { name: `Pelanggan ${s.code}` } });
    const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-${s.code}`, value: 1000, category: "LAYANAN" } });
    const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-${s.code}`, orderId: order.id, seq: 1, status: s.kind === "done" ? "READY_FOR_DELIVERY" : "IN_PRODUCTION", serviceId: service.id, merk: "King Koil", ukuran: "180x200" } });
    s.unitId = unit.id; s.unitCode = unit.unitCode; s.orderNumber = order.orderNumber;
    const runStatus = s.kind === "transit" ? "PENDING_ARRIVAL" : s.kind === "done" ? "COMPLETED" : "ACTIVE";
    const phase = s.phase || (s.kind === "done" ? "HANDOFF" : s.kind === "finished_waiting" ? "HANDOFF" : "PROCESS");
    const run = await testPrisma.productionRun.create({
      data: { unitId: unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: runStatus, currentPhase: phase, revision: 3, startedAt: s.started ?? null, completedAt: s.kind === "done" ? s.ready : null, createdAt: s.arrived ? D(addDays(s.arrived.toISOString().slice(0, 10), 0), 0) : D("2026-10-19", 8) },
    });
    s.runId = run.id;
    await testPrisma.productionPhaseRun.createMany({ data: ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"].map((p, i) => ({ runId: run.id, phase: p, sequence: i + 1, status: p === phase ? "ACTIVE" : "NOT_STARTED", startedAt: p === "HANDOFF" && s.finished ? s.finished : null })) });
    if (s.station) {
      await testPrisma.productionRunPlan.create({ data: { runId: run.id, status: "PLANNED", workCenterId: wc.id, operatorId: mejaUsers[s.stationIdx].op.id, cornerOperatorId: cornerUsers[s.stationIdx % 2].op.id, cornerWorkCenterId: wc.id, productionDate: new Date(`${s.planned}T00:00:00.000Z`), stationCode: s.station, priority: s.priority, targetCompleteAt: s.target ?? null, targetStartAt: s.started ?? null, stationSequence: s.tag === "ontime" && s.code.endsWith("1") ? 1 : null } });
    }
    if (s.arrived && s.kind !== "transit") {
      // INBOUND wajib menunjuk Job pickup (CHECK job_by_direction): satu Job PICKUP per unit.
      const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "COMPLETED", sequence: 1, scheduledDate: new Date("2026-09-29T00:00:00.000Z") } });
      await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
      await testPrisma.unitCustodyHandoff.create({ data: { unitId: unit.id, deliveryJobId: job.id, direction: "INBOUND", status: "ACCEPTED", offeredAt: s.arrived, acceptedAt: s.arrived, productionRunId: run.id } });
    }
    if (s.ready) await testPrisma.unitCustodyHandoff.create({ data: { unitId: unit.id, direction: "FINISHED_GOODS", status: "ACCEPTED", offeredAt: s.finished ?? s.ready, acceptedAt: s.ready, productionRunId: run.id } });
    if (s.fgOffered) await testPrisma.unitCustodyHandoff.create({ data: { unitId: unit.id, direction: "FINISHED_GOODS", status: "OFFERED", offeredAt: s.fgOffered, productionRunId: run.id } });
    // operasi + stage log (durasi aktif/jeda/blokir)
    const opStage = stages.teardown;
    if (s.started && opStage) {
      const end = s.finished ?? null;
      const op = await testPrisma.productionOperationRun.create({ data: { runId: run.id, stageId: opStage.id, stageCode: opStage.code, stageLabel: opStage.labelId || "Bongkar", sequence: 1, status: s.opStatus || (end ? "COMPLETED" : "ACTIVE"), startedAt: s.started, completedAt: end } });
      s.opId = op.id;
      const log = (action, at) => testPrisma.unitStageLog.create({ data: { unitId: unit.id, stageId: opStage.id, action, createdAt: at, startedAt: at } });
      await log("START", s.started);
      if (s.pauseSince) await log("PAUSE", s.pauseSince);
      if (s.blockedSince) await log("FAIL", s.blockedSince);
      if (s.tag === "ontime" && s.code.endsWith("2")) { s.pauseMin = 30; await log("PAUSE", D(s.planned, 11)); await log("RESUME", D(s.planned, 11, 30)); }
      if (end) await log("COMPLETE", end);
    }
    // QC
    for (const [i, q] of (s.qc || []).entries()) await testPrisma.qualityInspection.create({ data: { runId: run.id, version: i + 1, checklistVersion: "v1", result: q.result, inspectedAt: q.at } });
    // kekurangan bahan
    if (s.shortage) await testPrisma.productionMaterialShortage.create({ data: { runId: run.id, unitId: unit.id, status: s.shortage.resolvedAt ? "RESOLVED" : "OPEN", items: [], reportedAt: s.shortage.reportedAt, resolvedAt: s.shortage.resolvedAt } });
    if (s.exception) await testPrisma.productionRunException.create({ data: { runId: run.id, unitId: unit.id, kind: "UNIT_STATUS_OVERRIDE", status: "OPEN", unitStatusSeen: "IN_PRODUCTION", runRevisionSeen: 3 } }).catch(async () => { const kinds = await testPrisma.$queryRawUnsafe("select unnest(enum_range(null::\"ProductionRunExceptionKind\"))::text k"); await testPrisma.productionRunException.create({ data: { runId: run.id, unitId: unit.id, kind: kinds[0].k, status: "OPEN", unitStatusSeen: "IN_PRODUCTION", runRevisionSeen: 3 } }); });
    // BOM + permintaan bahan + pemakaian
    if (s.planned && s.station) {
      const plan = await testPrisma.productionRunPlan.findUniqueOrThrow({ where: { runId: run.id } });
      s.planId = plan.id;
      s.bom = [{ mat: mats[0], planned: 2, used: s.tag === "extra" ? 3 : 2 }, { mat: mats[1], planned: 1, used: 1 }];
      for (const b of s.bom) await testPrisma.plannedBOMLine.create({ data: { planId: plan.id, materialId: b.mat.id, qty: b.planned, unit: b.mat.unit, status: "ACTIVE", revision: 1 } });
      const issuedAt = s.started ? new Date(s.started.getTime() - 60 * 60_000) : null; // diserahkan 1 jam sebelum mulai
      if (issuedAt && ["ontime", "late", "rework", "waste", "extra", "return_partial", "return_done", "shortage_resolved"].includes(s.tag)) {
        const createdAt = new Date(issuedAt.getTime() - (s.tag === "late" ? 300 : 90) * 60_000); // respons 90 mnt (late: 300 mnt -> lewat SLA 240)
        const issue = await testPrisma.materialIssue.create({ data: { issueNumber: `MI-P11-${s.code}`, sourceType: "PRODUCTION_WORK_ORDER", status: "ISSUED", productionPlanId: plan.id, unitId: unit.id, createdAt, issuedAt, lines: { create: s.bom.map((b) => ({ materialId: b.mat.id, requestedQty: b.planned, issuedQty: b.planned })) } } });
        s.issue = { createdAt, issuedAt, responseMin: Math.round((issuedAt - createdAt) / 60_000) };
        void issue;
      }
      if (s.tag === "extra") {
        const insp = await testPrisma.qualityInspection.findFirstOrThrow({ where: { runId: run.id } });
        await testPrisma.materialIssue.create({ data: { issueNumber: `MI-P11-${s.code}-R`, sourceType: "PRODUCTION_WORK_ORDER", status: "ISSUED", productionPlanId: plan.id, unitId: unit.id, reworkInspectionId: insp.id, createdAt: D(s.planned, 12), issuedAt: D(s.planned, 13) } });
        s.issueExtra = { createdAt: D(s.planned, 12), issuedAt: D(s.planned, 13), responseMin: 60 };
      }
      if (["working", "paused", "late_open", "waiting_qc", "shortage_open"].includes(s.tag) || s.tag === "unscheduled") {
        const createdAt = new Date(NOW.getTime() - 600 * 60_000); // permintaan terbuka sejak 10 jam lalu (> SLA 240)
        await testPrisma.materialIssue.create({ data: { issueNumber: `MI-P11-${s.code}-O`, sourceType: "PRODUCTION_WORK_ORDER", status: "READY_TO_PICK", productionPlanId: plan.id, unitId: unit.id, createdAt } }).catch(() => {});
        s.openIssue = true;
      }
      // bukti pemakaian bahan (tahap 6) + bukti tahap 12 (selesai)
      const media = [{ url: `/media/production-evidence/${"a".repeat(40)}.jpg`, kind: "image" }];
      if (s.started && (s.finished || s.tag === "extra")) await testPrisma.productionStepEvidence.create({ data: { runId: run.id, stepNo: 6, stepCode: "S06_NEW_FOUNDATION", version: 1, payload: { materials: s.bom.map((b) => ({ materialId: b.mat.id, qty: b.used })) }, media, createdAt: s.started } });
      if (s.finished) await testPrisma.productionStepEvidence.create({ data: { runId: run.id, stepNo: 12, stepCode: "S12_CONFIRM_DONE", version: 1, payload: { confirm: true }, media, createdAt: s.finished } });
    }
    // retur
    if (s.ret) await testPrisma.productionMaterialReturn.create({ data: { runId: run.id, unitId: unit.id, materialId: mats[0].id, qty: s.ret.qty, status: s.ret.status, requestedAt: s.ret.requestedAt, receivedAt: s.ret.receivedAt ?? null, receivedQty: s.ret.receivedQty ?? null } });
    // waste
    if (s.waste) await testPrisma.stockMovement.create({ data: { materialId: mats[0].id, type: "WASTE", qty: -s.waste, unitId: unit.id, createdAt: D(s.planned, 13), note: "waste P11" } });
    // dokumentasi (baris DOC_* di tabel bukti yang sama)
    s.docRows = 0;
    if (s.docs === "full" || s.docs === "partial") {
      const cats = s.docs === "full" ? docCats : [["BEFORE_TEARDOWN", 1]];
      for (const [cat, n] of cats) { s.docRows += n; await testPrisma.productionStepEvidence.create({ data: { runId: run.id, stepNo: cat === "FINAL_RESULT" ? 12 : cat === "PROCESS" ? 7 : 1, stepCode: `DOC_${cat}`, version: 1000 + s.docRows, payload: { documentation: { category: cat, source: "MANUAL", items: Array.from({ length: n }, (_, k) => ({ url: `/media/production-evidence/${String(k).repeat(40).slice(0, 40)}.jpg`, caption: null, order: k + 1 })) } }, media: Array.from({ length: n }, (_, k) => ({ url: `/media/production-evidence/${String(k + s.docRows).padStart(40, "c")}.jpg`, kind: "image" })), createdAt: D("2026-10-01", 9) } }); }
    }
    unitsByCode.set(s.code, s);
  }
  // unit di cohort TANPA run (mis. Kadar Wati-like) + unit V2 di LUAR cohort (tidak boleh terhitung) + unit V1 murni
  const idleUnit = await testPrisma.unit.create({ data: { unitCode: "UNIT-P11-IDLE", orderId: (await testPrisma.order.create({ data: { customerId: (await testPrisma.customer.create({ data: { name: "Idle" } })).id, orderNumber: "ORD-P11-IDLE", value: 1, category: "LAYANAN" } })).id, seq: 1, status: "RECEIVED" } });
  const outsider = await testPrisma.unit.create({ data: { unitCode: "UNIT-P11-OUT", orderId: (await testPrisma.order.create({ data: { customerId: (await testPrisma.customer.create({ data: { name: "Outsider" } })).id, orderNumber: "ORD-P11-OUT", value: 1, category: "LAYANAN" } })).id, seq: 1, status: "IN_PRODUCTION", serviceId: service.id } });
  const outRun = await testPrisma.productionRun.create({ data: { unitId: outsider.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "COMPLETED", currentPhase: "HANDOFF", revision: 3 } });
  await testPrisma.productionRunPlan.create({ data: { runId: outRun.id, status: "PLANNED", productionDate: new Date("2026-10-08T00:00:00.000Z"), stationCode: "TABLE_1", operatorId: mejaUsers[0].op.id, workCenterId: wc.id } });
  return { specs, unitsByCode, unitIds: [...specs.map((s) => s.unitId), idleUnit.id], idleUnitId: idleUnit.id, outsiderUnitId: outsider.id, mejaUsers, cornerUsers, mats, wc, stages, moduleStage };
}
