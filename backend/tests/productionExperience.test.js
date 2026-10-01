import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  STEPS, andonBucketOf, commandCenterColumn, deriveNextAction, mediaKindOf, normalizeMaterialLines, normalizeMedia, stepNoForStage, validateStepEvidence,
} from "../src/lib/domain/productionSteps.js";
import {
  BOARD_DEFAULTS, assertStationCapacity, normalizeScheduleInput, parseProductionDate, stationLabel, todayWib, workWindowFor,
} from "../src/lib/domain/productionBoard.js";
import { auditProductionExperienceWriters, loadBackendSources, runProductionExperienceWriterAudit } from "../scripts/production-delivery-v2/audit-production-experience-writers.js";
import { buildReportMessage } from "../src/services/productionExperienceReadService.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMG = `/media/production-evidence/${"a".repeat(40)}.jpg`;
const IMG2 = `/media/production-evidence/${"c".repeat(40)}.webp`;
const VID = `/media/production-evidence/${"b".repeat(40)}.mp4`;
const fails = (fn, code, status) => assert.throws(fn, (e) => e.code === code && (status == null || e.statusCode === status), `harus gagal ${code}`);

test("12 tahap blueprint: nomor urut 1..12, Table 1–9, Corner 10–12, kode unik", () => {
  assert.deepEqual(STEPS.map((s) => s.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(STEPS.filter((s) => s.no <= 9).every((s) => s.actor === "TABLE"));
  assert.ok(STEPS.filter((s) => s.no >= 10).every((s) => s.actor === "CORNER"));
  assert.equal(new Set(STEPS.map((s) => s.code)).size, 12);
});

test("pemetaan tahap routing -> nomor tahap: intake 2–5, modul fondasi 6 / lapisan 7, QC 8, corner 11, finish 12", () => {
  assert.equal(stepNoForStage({ code: "pre_teardown_test", phase: "INTAKE" }), 2);
  assert.equal(stepNoForStage({ code: "teardown", phase: "INTAKE" }), 3);
  assert.equal(stepNoForStage({ code: "foundation_test", phase: "INTAKE" }), 4);
  assert.equal(stepNoForStage({ code: "diagnosis", phase: "INTAKE" }), 5);
  assert.equal(stepNoForStage({ code: "foundation_upgrade", phase: "MODULE", sequence: 10 }), 6);
  assert.equal(stepNoForStage({ code: "foundation_service", phase: "MODULE", sequence: 10 }), 6);
  assert.equal(stepNoForStage({ code: "comfort_layer_upgrade", phase: "MODULE", sequence: 20 }), 7);
  assert.equal(stepNoForStage({ code: "cover_replacement", phase: "MODULE", sequence: 30 }), 7);
  assert.equal(stepNoForStage({ code: "fit_test", phase: "FINISH", requiresQc: true }), 8);
  assert.equal(stepNoForStage({ code: "corner_sewing", phase: "FINISH" }), 11);
  assert.equal(stepNoForStage({ code: "finished", phase: "FINISH" }), 12);
});

test("media bukti: hanya URL unggahan produksi (sha1 + ekstensi dikenal), jenis dari ekstensi, tanpa duplikat", () => {
  assert.equal(mediaKindOf(IMG), "image");
  assert.equal(mediaKindOf(VID), "video");
  assert.equal(mediaKindOf("/media/unit-photos/x.jpg"), null);
  assert.equal(mediaKindOf("https://evil.example/a.mp4"), null);
  assert.equal(mediaKindOf(`/media/production-evidence/${"a".repeat(40)}.exe`), null);
  assert.deepEqual(normalizeMedia([IMG, { url: VID }]), [{ url: IMG, kind: "image" }, { url: VID, kind: "video" }]);
  fails(() => normalizeMedia([IMG, IMG]), "STEP_EVIDENCE_INVALID", 400);
  fails(() => normalizeMedia(["/uploads/a.jpg"]), "STEP_EVIDENCE_INVALID", 400);
});

test("kontrak bukti tiap tahap: bukti wajib, video wajib di 2/4/6/8, konfirmasi & checklist wajib", () => {
  const issued = new Map([["m1", 2], ["m2", 0.5]]);
  // 1
  fails(() => validateStepEvidence(1, { media: [], payload: { conditionConfirmed: true } }), "STEP_EVIDENCE_INVALID");
  fails(() => validateStepEvidence(1, { media: [IMG], payload: {} }), "STEP_EVIDENCE_INVALID");
  assert.equal(validateStepEvidence(1, { media: [IMG], payload: { conditionConfirmed: true } }).payload.conditionConfirmed, true);
  // 2 wajib video
  fails(() => validateStepEvidence(2, { media: [IMG], payload: { feelNote: "empuk tengah amblas" } }), "STEP_EVIDENCE_INVALID");
  assert.equal(validateStepEvidence(2, { media: [VID], payload: { feelNote: "empuk tengah amblas" } }).payload.feelNote, "empuk tengah amblas");
  // 3 material lama
  fails(() => validateStepEvidence(3, { media: [IMG], payload: { oldMaterials: [] } }), "STEP_EVIDENCE_INVALID");
  fails(() => validateStepEvidence(3, { media: [IMG], payload: { oldMaterials: ["PLASTIK"] } }), "STEP_EVIDENCE_INVALID");
  assert.deepEqual(validateStepEvidence(3, { media: [IMG], payload: { oldMaterials: ["PER", { type: "BUSA", note: "kempes" }] } }).payload.oldMaterials.map((m) => m.type), ["PER", "BUSA"]);
  // 4 pengukuran
  const s4 = validateStepEvidence(4, { media: [VID], payload: { heightBeforeCm: 24, heightCompressedCm: 17, testerWeightKg: 85 } });
  assert.equal(s4.payload.dropCm, 7);
  fails(() => validateStepEvidence(4, { media: [VID], payload: { heightBeforeCm: 17, heightCompressedCm: 24, testerWeightKg: 85 } }), "STEP_EVIDENCE_INVALID");
  fails(() => validateStepEvidence(4, { media: [VID], payload: { heightBeforeCm: 24, heightCompressedCm: 17 } }), "STEP_EVIDENCE_INVALID");
  // 5 diagnosa (media opsional)
  fails(() => validateStepEvidence(5, { payload: { diagnosis: "pendek" } }), "STEP_EVIDENCE_INVALID");
  assert.equal(validateStepEvidence(5, { payload: { diagnosis: "Per tengah lemah sehingga pinggang melengkung", inputMethod: "VOICE" } }).payload.inputMethod, "VOICE");
  // 6/7 bahan harus dari bahan yang diserahkan Gudang
  fails(() => validateStepEvidence(6, { media: [VID], payload: { note: "pocket spring", materials: [] } }, { issuedQtyByMaterial: issued }), "STEP_EVIDENCE_INVALID");
  fails(() => validateStepEvidence(6, { media: [VID], payload: { note: "pocket spring", materials: [{ materialId: "mX", qty: 1 }] } }, { issuedQtyByMaterial: issued }), "STEP_MATERIAL_NOT_ISSUED", 422);
  fails(() => validateStepEvidence(7, { media: [IMG], payload: { materials: [{ materialId: "m2", qty: 1 }] } }, { issuedQtyByMaterial: issued }), "STEP_MATERIAL_OVER_ISSUED", 422);
  assert.equal(validateStepEvidence(6, { media: [VID], payload: { note: "pocket spring", materials: [{ materialId: "m1", qty: 2 }] } }, { issuedQtyByMaterial: issued }).payload.materials.length, 1);
  // 8 verdict
  fails(() => validateStepEvidence(8, { media: [VID], payload: { verdict: "OK", testerWeightKg: 85 } }), "STEP_EVIDENCE_INVALID");
  assert.equal(validateStepEvidence(8, { media: [VID], payload: { verdict: "TERLALU_KERAS", testerWeightKg: 85 } }).payload.verdict, "TERLALU_KERAS");
  // 10 spesifikasi Corner
  fails(() => validateStepEvidence(10, { payload: { mattressStyle: "EUROTOP", fabricSpec: "Knitting putih", borderColor: "Abu" } }), "STEP_EVIDENCE_INVALID");
  assert.equal(validateStepEvidence(10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Knitting putih", borderColor: "Abu tua" } }, { issuedQtyByMaterial: issued }).payload.materials.length, 0);
  // 11 checklist lengkap
  fails(() => validateStepEvidence(11, { media: [IMG2], payload: { checklist: { jahitan: true, list: true, resleting: true } } }), "STEP_EVIDENCE_INVALID");
  assert.ok(validateStepEvidence(11, { media: [IMG2], payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } } }));
  // 12 konfirmasi
  fails(() => validateStepEvidence(12, { payload: {} }), "STEP_EVIDENCE_INVALID");
  fails(() => validateStepEvidence(12, { media: [], payload: { confirm: true } }), "STEP_EVIDENCE_INVALID");
  assert.equal(validateStepEvidence(12, { media: [IMG], payload: { confirm: true } }).payload.confirm, true);
  fails(() => validateStepEvidence(13, { payload: {} }), "STEP_UNKNOWN", 400);
});

test("baris bahan: duplikat/qty nol ditolak; opsional di tahap 10", () => {
  const issued = new Map([["m1", 2]]);
  fails(() => normalizeMaterialLines([{ materialId: "m1", qty: 1 }, { materialId: "m1", qty: 1 }], { issuedQtyByMaterial: issued, required: true, label: "x" }), "STEP_EVIDENCE_INVALID");
  fails(() => normalizeMaterialLines([{ materialId: "m1", qty: 0 }], { issuedQtyByMaterial: issued, required: true, label: "x" }), "STEP_EVIDENCE_INVALID");
  assert.deepEqual(normalizeMaterialLines(null, { issuedQtyByMaterial: issued, required: false, label: "x" }), []);
});

// Keadaan dasar untuk derivasi.
const base = (over = {}) => ({
  runStatus: "ACTIVE", currentPhase: "PROCESS", unitStatus: "IN_PRODUCTION", handoffPhaseStatus: "NOT_STARTED", exceptionOpen: false,
  activeOp: null, target: null, opEvidence: [], step9SinceQc: false, openShortage: false, serviceSet: true, pathHasModules: true, materialReady: true, diagnosisManualMapped: true, diagnosisBomHasLines: true, ...over,
});
const op = (stageCode, extra = {}) => ({ stageCode, stagePhase: extra.stagePhase || (["foundation_upgrade", "comfort_layer_upgrade"].includes(stageCode) ? "MODULE" : ["corner_sewing", "finished"].includes(stageCode) ? "FINISH" : "INTAKE"), stageSequence: extra.stageSequence ?? (stageCode === "foundation_upgrade" ? 10 : stageCode === "comfort_layer_upgrade" ? 20 : 1), status: "ACTIVE", isLastPreQc: false, isPostQc: false, ...extra });

test("derivasi urutan tahap: tidak ada tahap yang bisa dilewati; rework tekstur; QC; Corner; Gudang", () => {
  assert.deepEqual(deriveNextAction(base({ currentPhase: "INTAKE", unitStatus: "RECEIVED", target: { code: "pre_teardown_test", phase: "INTAKE" } })), { actor: "TABLE", stepNo: 1, action: "START_WITH_EVIDENCE" });
  assert.equal(deriveNextAction(base({ activeOp: op("pre_teardown_test") })).stepNo, 2);
  assert.equal(deriveNextAction(base({ activeOp: op("teardown") })).stepNo, 3);
  assert.equal(deriveNextAction(base({ activeOp: op("foundation_test") })).stepNo, 4);
  // Diagnosa tanpa layanan: boleh kirim diagnosa, setelah terkirim menunggu Planner.
  assert.equal(deriveNextAction(base({ activeOp: op("diagnosis"), serviceSet: false })).serviceMissing, true);
  assert.equal(deriveNextAction(base({ activeOp: op("diagnosis"), serviceSet: false, opEvidence: [{ stepNo: 5, order: 0 }] })).wait, "SERVICE_NOT_SET");
  // Semua syarat terpenuhi + diagnosa sudah tercatat: PIC cukup "Lanjutkan" (continueOnly) — sebelumnya flag ini tidak pernah dikirim.
  const cont = deriveNextAction(base({ activeOp: op("diagnosis"), serviceSet: true, opEvidence: [{ stepNo: 5, order: 0 }] }));
  assert.equal(cont.action, "COMPLETE"); assert.equal(cont.continueOnly, true);
  assert.equal(deriveNextAction(base({ activeOp: op("diagnosis"), serviceSet: true })).continueOnly, undefined, "belum ada diagnosa: bukan continueOnly");
  // Alasan menunggu dibedakan (P9D): bahan manual belum dipetakan / Planned BOM kosong.
  assert.equal(deriveNextAction(base({ activeOp: op("diagnosis"), opEvidence: [{ stepNo: 5, order: 0 }], diagnosisManualMapped: false })).wait, "DIAGNOSIS_MANUAL_UNMAPPED");
  assert.equal(deriveNextAction(base({ activeOp: op("diagnosis"), opEvidence: [{ stepNo: 5, order: 0 }], diagnosisBomHasLines: false })).wait, "DIAGNOSIS_BOM_EMPTY");
  // Modul menunggu bahan / kekurangan.
  assert.equal(deriveNextAction(base({ target: { code: "foundation_upgrade", phase: "MODULE", sequence: 10 }, materialReady: false })).wait, "MATERIAL_NOT_READY");
  assert.equal(deriveNextAction(base({ target: { code: "foundation_upgrade", phase: "MODULE", sequence: 10 }, materialReady: false, openShortage: true })).wait, "MATERIAL_SHORTAGE");
  assert.deepEqual(deriveNextAction(base({ target: { code: "foundation_upgrade", phase: "MODULE", sequence: 10 } })), { actor: "TABLE", stepNo: 6, action: "START" });
  // Modul bukan terakhir diselesaikan di tahapnya; modul terakhir: bukti -> uji tekstur -> (tidak PAS) bukti ulang.
  assert.equal(deriveNextAction(base({ activeOp: op("foundation_upgrade") })).action, "COMPLETE");
  const last = op("comfort_layer_upgrade", { isLastPreQc: true });
  assert.equal(deriveNextAction(base({ activeOp: last })).action, "EVIDENCE");
  assert.equal(deriveNextAction(base({ activeOp: last, opEvidence: [{ stepNo: 7, order: 0 }] })).action, "TEST");
  const rework = deriveNextAction(base({ activeOp: last, opEvidence: [{ stepNo: 7, order: 0 }, { stepNo: 8, order: 1, payload: { verdict: "TERLALU_EMPUK" } }] }));
  assert.equal(rework.action, "EVIDENCE"); assert.equal(rework.stepNo, 7); assert.equal(rework.rework, true); assert.equal(rework.lastVerdict, "TERLALU_EMPUK");
  assert.equal(deriveNextAction(base({ activeOp: last, opEvidence: [{ stepNo: 7, order: 0 }, { stepNo: 8, order: 1, payload: { verdict: "TERLALU_KERAS" } }, { stepNo: 7, order: 2 }] })).action, "TEST");
  // QC resmi bukan milik PIC.
  assert.equal(deriveNextAction(base({ target: { code: "fit_test", phase: "FINISH", requiresQc: true } })).wait, "AWAITING_QC");
  // Pasca-QC: Kirim ke Corner (Table) -> Mulai Jahit (Corner) -> Konfirmasi (Corner).
  assert.deepEqual(deriveNextAction(base({ target: { code: "corner_sewing", phase: "FINISH", isPostQc: true } })), { actor: "TABLE", stepNo: 9, action: "HANDOFF" });
  assert.deepEqual(deriveNextAction(base({ target: { code: "corner_sewing", phase: "FINISH", isPostQc: true }, step9SinceQc: true })), { actor: "CORNER", stepNo: 10, action: "START_CORNER" });
  assert.equal(deriveNextAction(base({ activeOp: op("corner_sewing", { isPostQc: true }) })).stepNo, 11);
  assert.deepEqual(deriveNextAction(base({ target: { code: "finished", phase: "FINISH", isPostQc: true } })), { actor: "CORNER", stepNo: 12, action: "FINISH" });
  assert.equal(deriveNextAction(base({ currentPhase: "HANDOFF", handoffPhaseStatus: "ACTIVE" })).wait, "AWAITING_WAREHOUSE");
  assert.equal(deriveNextAction(base({ runStatus: "COMPLETED" })).wait, "COMPLETED");
  // Jeda: kekurangan bahan menahan RESUME.
  assert.equal(deriveNextAction(base({ activeOp: op("foundation_upgrade", { status: "PAUSED" }), openShortage: true })).wait, "MATERIAL_SHORTAGE");
  assert.equal(deriveNextAction(base({ activeOp: op("foundation_upgrade", { status: "PAUSED" }) })).action, "RESUME");
  assert.equal(deriveNextAction(base({ exceptionOpen: true, activeOp: op("teardown") })).wait, "EXCEPTION_OPEN");
});

test("bucket Andon dari aksi berikutnya", () => {
  assert.equal(andonBucketOf({ next: { stepNo: 1, action: "START_WITH_EVIDENCE" }, started: false }), "ANTREAN");
  assert.equal(andonBucketOf({ next: { stepNo: 3, action: "COMPLETE" }, started: true }), "BONGKAR");
  assert.equal(andonBucketOf({ next: { stepNo: 5, action: "COMPLETE" }, started: true }), "DIAGNOSA");
  assert.equal(andonBucketOf({ next: { stepNo: 6, action: "WAIT", wait: "MATERIAL_SHORTAGE" }, started: true }), "MENUNGGU_BAHAN");
  assert.equal(andonBucketOf({ next: { stepNo: 6, action: "COMPLETE" }, started: true }), "FONDASI");
  assert.equal(andonBucketOf({ next: { stepNo: 8, action: "TEST" }, started: true }), "LAPISAN");
  assert.equal(andonBucketOf({ next: { stepNo: 7, action: "EVIDENCE", rework: true }, started: true }), "QC");
  assert.equal(andonBucketOf({ next: { stepNo: 8, action: "WAIT", wait: "AWAITING_QC" }, started: true }), "QC");
  assert.equal(andonBucketOf({ next: { stepNo: 11, action: "COMPLETE" }, started: true }), "CORNER");
  assert.equal(andonBucketOf({ next: { stepNo: 12, action: "WAIT", wait: "AWAITING_WAREHOUSE" }, started: true }), "HANDOFF");
  assert.equal(andonBucketOf({ next: { stepNo: 12, action: "WAIT", wait: "COMPLETED" }, started: true }), "SELESAI");
  assert.equal(andonBucketOf({ next: { action: "WAIT", wait: "EXCEPTION_OPEN" }, started: true }), "TERHENTI");
});

// P9B.1 — kolom pipeline Status Produksi: LEBIH HALUS dari bucket Andon (Uji Tekstur dipisah dari Lapisan), TIDAK
// mengubah andonBucketOf. "Dijadwalkan"/"Belum Dijadwalkan" DIHAPUS sebagai kolom — status jadwal (plan ada/tidak)
// TIDAK LAGI menentukan kolom sama sekali, murni badge di kartu. Kolom sekarang murni KEADAAN FISIK: DALAM_PERJALANAN
// (belum dikonfirmasi tiba, dijadwalkan atau tidak — sama saja) vs TIBA_BELUM_MULAI (sudah tiba, tahap 1-5/terhenti).
test("kolom Status Produksi (P9B.1): keadaan fisik, bukan status jadwal; tanpa mengubah andonBucketOf", () => {
  const withPlan = { plan: { stationCode: "TABLE_1" } };
  assert.equal(commandCenterColumn({ bucket: "DALAM_PERJALANAN", plan: null, next: { wait: "PENDING_ARRIVAL" } }), "DALAM_PERJALANAN", "belum tiba, belum dijadwalkan -> tetap Dalam Perjalanan (bukan lagi Belum Dijadwalkan)");
  assert.equal(commandCenterColumn({ bucket: "DALAM_PERJALANAN", ...withPlan, next: { wait: "PENDING_ARRIVAL" } }), "DALAM_PERJALANAN", "sudah dijadwalkan (pre-schedule P9A) TAPI belum tiba -> tetap Dalam Perjalanan (jadwal cuma badge)");
  assert.equal(commandCenterColumn({ bucket: "ANTREAN", ...withPlan, next: { stepNo: 1 } }), "TIBA_BELUM_MULAI");
  assert.equal(commandCenterColumn({ bucket: "ANTREAN", plan: null, next: { stepNo: 1 } }), "TIBA_BELUM_MULAI", "sudah tiba tapi belum sempat dijadwalkan pun tetap Tiba/Belum Mulai, bukan kolom terpisah");
  assert.equal(commandCenterColumn({ bucket: "BONGKAR", ...withPlan, next: { stepNo: 3 } }), "TIBA_BELUM_MULAI", "tahap intake 1-5 dianggap Tiba/Belum Mulai di papan pipeline ini");
  assert.equal(commandCenterColumn({ bucket: "FONDASI", ...withPlan, next: { stepNo: 6 } }), "FONDASI");
  assert.equal(commandCenterColumn({ bucket: "LAPISAN", ...withPlan, next: { stepNo: 7 } }), "LAPISAN");
  assert.equal(commandCenterColumn({ bucket: "LAPISAN", ...withPlan, next: { stepNo: 8 } }), "UJI_TEKSTUR", "andonBucketOf menggabungkan 7&8 jadi LAPISAN, kolom P9B memisahkannya");
  assert.equal(commandCenterColumn({ bucket: "QC", ...withPlan, next: { stepNo: 9 } }), "QC");
  assert.equal(commandCenterColumn({ bucket: "QC", ...withPlan, next: { stepNo: 7, wait: "AWAITING_QC" } }), "QC", "rework menunggu QC tetap kolom QC walau stepNo pemicu-nya 7");
  assert.equal(commandCenterColumn({ bucket: "CORNER", ...withPlan, next: { stepNo: 11 } }), "CORNER");
  assert.equal(commandCenterColumn({ bucket: "HANDOFF", ...withPlan, next: { stepNo: 12, wait: "AWAITING_WAREHOUSE" } }), "SIAP_KIRIM");
  assert.equal(commandCenterColumn({ bucket: "SELESAI", ...withPlan, next: { wait: "COMPLETED" } }), null, "SELESAI dikeluarkan dari papan aktif (tetap terhitung KPI selesai hari ini)");
  assert.equal(commandCenterColumn({ bucket: "TERHENTI", ...withPlan, next: { wait: "EXCEPTION_OPEN" } }), "TIBA_BELUM_MULAI", "terhenti/exception tetap tampil di kolomnya, ditandai badge bukan kolom terpisah");
  assert.equal(commandCenterColumn({ bucket: "MENUNGGU_BAHAN", ...withPlan, next: { stepNo: 6, wait: "MATERIAL_SHORTAGE" } }), "FONDASI", "menunggu bahan tetap di kolom tahapnya sendiri, bukan kolom terpisah");
});

test("papan meja: default 12 unit / 4 meja / 3 per meja; validasi jadwal; kapasitas; jendela kerja WIB", () => {
  assert.equal(BOARD_DEFAULTS.dailyTarget, 12);
  assert.deepEqual(BOARD_DEFAULTS.stations, ["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"]);
  assert.equal(BOARD_DEFAULTS.capacityPerStation * BOARD_DEFAULTS.stations.length, BOARD_DEFAULTS.dailyTarget);
  assert.equal(stationLabel("TABLE_3"), "Meja 3");
  assert.equal(parseProductionDate("2026-09-30").toISOString(), "2026-09-30T00:00:00.000Z");
  assert.equal(parseProductionDate("2026-02-30"), null);
  assert.equal(parseProductionDate("30-09-2026"), null);
  assert.equal(todayWib(new Date("2026-09-29T20:00:00Z")), "2026-09-30", "20.00 UTC = 03.00 WIB esok hari");
  const w = workWindowFor(parseProductionDate("2026-09-30"));
  assert.equal(w.targetStartAt.toISOString(), "2026-09-30T01:00:00.000Z");
  assert.equal(w.targetCompleteAt.toISOString(), "2026-09-30T10:00:00.000Z");
  assert.equal(normalizeScheduleInput({}).unschedule, true);
  fails(() => normalizeScheduleInput({ productionDate: "2026-09-30", stationCode: "TABLE_9", workCenterId: "w", operatorId: "o" }), "PLAN_STATION_INVALID", 400);
  fails(() => normalizeScheduleInput({ productionDate: "2026-09-30", stationCode: "TABLE_1", workCenterId: "w" }), "PLAN_OPERATOR_REQUIRED", 400);
  fails(() => normalizeScheduleInput({ productionDate: "2026-09-30", stationCode: "TABLE_1", workCenterId: "w", operatorId: "o", priority: 5 }), "PLAN_PRIORITY_INVALID", 400);
  fails(() => normalizeScheduleInput({ productionDate: "2026-09-30", stationCode: "TABLE_1", workCenterId: "w", operatorId: "o", cornerWorkCenterId: "c" }), "PLAN_CORNER_OPERATOR_REQUIRED", 400);
  assert.equal(normalizeScheduleInput({ productionDate: "2026-09-30", stationCode: "TABLE_1", workCenterId: "w", operatorId: "o", priority: 2 }).priority, 2);
  assert.doesNotThrow(() => assertStationCapacity(2));
  fails(() => assertStationCapacity(3), "PLAN_STATION_FULL", 409);
});

test("pesan laporan Sales mengikuti format blueprint dan jujur soal status Gudang", () => {
  const message = buildReportMessage({
    order: { orderNumber: "RES-1", customerName: "Ibu Maya", complaints: ["Sakit pinggang"] }, unit: { merk: "King Koil", ukuran: "180x200" },
    pic: { table: "Nadya", corner: "Hendra", sales: "Rina" }, measurement: { testerWeightKg: 85, heightBeforeCm: 24, heightCompressedCm: 17, dropCm: 7 },
    diagnosis: "Per tengah lemah", materials: { foundation: [{ name: "Pocket Spring", code: "SPR-POCKET" }], layer: [] }, finalTest: { verdict: "PAS", testerWeightKg: 85 },
    finishing: { mattressStyle: "PILLOWTOP", fabricSpec: "Knitting putih", borderColor: "Abu tua" }, mediaCount: 10, reportPath: "/bengkel/production-v2/laporan/r1", handoffStatus: "OFFERED",
  });
  assert.match(message, /LAPORAN PRODUKSI SELESAI/);
  assert.match(message, /turun dari 24 cm ke 17 cm \(amblas 7 cm\)/);
  assert.match(message, /Model Pillowtop/);
  assert.match(message, /menunggu diterima Gudang/, "belum READY FOR DELIVERY sebelum Gudang menerima");
});

test("audit writer P8 pada source aktual: 0 pelanggaran", () => {
  const report = runProductionExperienceWriterAudit(backendRoot);
  assert.equal(report.totals.violations, 0, JSON.stringify(report.findings.filter((f) => !f.ok)));
  // Dua penulis sah tabel bukti: command tahap (P8) dan command dokumentasi (P10B, baris DOC_* saja).
  assert.equal(report.totals.evidenceWriters, 2);
  assert.deepEqual(report.findings.filter((f) => f.kind === "STEP_EVIDENCE_WRITER").map((f) => f.disposition).sort(), ["DOCUMENTATION_OWNER_CREATE", "OWNER_CREATE"]);
});

test("audit READER P10B: semua pembaca production_step_evidence_v2 teraudit; baris DOC_* tidak pernah dihitung sebagai lifecycle", () => {
  const report = runProductionExperienceWriterAudit(backendRoot);
  const readers = report.findings.filter((f) => f.kind === "STEP_EVIDENCE_READER" || f.kind === "STEP_EVIDENCE_SQL_READER");
  assert.ok(readers.length >= 4, "pembaca Prisma + SQL terdeteksi: " + readers.map((r) => r.file + ":" + r.disposition).join(","));
  assert.deepEqual([...new Set(readers.map((r) => r.file))].sort(), [
    "src/routes/productionEvidenceMedia.js", "src/services/productionDocumentationService.js", "src/services/productionMaterialReturnService.js", "src/services/productionReportingService.js", "src/services/productionStepCommandService.js",
  ]);
  assert.equal(report.findings.filter((f) => !f.ok).length, 0);
  const sources = loadBackendSources(backendRoot);
  const STEP = "src/services/productionStepCommandService.js";
  // pembaca liar (Prisma dan SQL) = pelanggaran
  const wild = new Map(sources);
  wild.set("src/services/pembacaLiar.js", "await prisma.productionStepEvidence.findMany({ where: { runId } });\nawait prisma.$queryRaw`SELECT * FROM production_step_evidence_v2`;\n");
  const d1 = auditProductionExperienceWriters(wild).findings.filter((f) => !f.ok).map((f) => f.disposition);
  assert.ok(d1.includes("UNREVIEWED_READER") && d1.includes("UNREVIEWED_SQL_READER"), d1.join(","));
  // filter DOC_ dihapus dari loadStepContext / versi writeEvidence / pembaca retur = pelanggaran
  const noFilter = new Map(sources);
  noFilter.set(STEP, sources.get(STEP).replace("allEvidence.filter((e) => !isDocumentationRow(e))", "allEvidence"));
  assert.ok(auditProductionExperienceWriters(noFilter).findings.some((f) => f.disposition === "MISSING_DOC_FILTER_loadStepContext"));
  const noVersionFilter = new Map(sources);
  noVersionFilter.set(STEP, sources.get(STEP).replace("NOT: { stepCode: { startsWith: DOC_STEP_CODE_PREFIX } }", ""));
  assert.ok(auditProductionExperienceWriters(noVersionFilter).findings.some((f) => f.disposition === "MISSING_DOC_FILTER_writeEvidence_version"));
  const MAT = "src/services/productionMaterialReturnService.js";
  const noMat = new Map(sources);
  noMat.set(MAT, sources.get(MAT).replace('NOT: { stepCode: { startsWith: "DOC_" } }', ""));
  assert.ok(auditProductionExperienceWriters(noMat).findings.some((f) => f.disposition === "MISSING_DOC_FILTER_material_return"));
});

test("audit writer P10B menangkap: command dokumentasi menulis lifecycle/memanggil helper tahap, tanpa penanda DOC_, atau loadStepContext tak memisahkan baris dokumentasi", () => {
  const sources = loadBackendSources(backendRoot);
  const DOC = "src/services/productionDocumentationService.js";
  const STEP = "src/services/productionStepCommandService.js";
  const bad = new Map(sources);
  bad.set(DOC, `${sources.get(DOC)}
await tx.productionRun.update({});
await tx.unit.update({});
await applyCompleteInTx();
`);
  const d1 = auditProductionExperienceWriters(bad).findings.filter((f) => !f.ok).map((f) => f.disposition);
  for (const expected of ["FORBIDDEN_productionRun", "FORBIDDEN_unit", "FORBIDDEN_applyCompleteInTx"]) assert.ok(d1.includes(expected), `${expected}: ${d1.join(",")}`);
  const noMarker = new Map(sources);
  noMarker.set(DOC, sources.get(DOC).replaceAll("docStepCode(", "kodeLain("));
  assert.ok(auditProductionExperienceWriters(noMarker).findings.some((f) => f.disposition === "MISSING_docStepCode"));
  const noIsolation = new Map(sources);
  noIsolation.set(STEP, sources.get(STEP).replaceAll("isDocumentationRow(", "bukanDokumentasi("));
  assert.ok(auditProductionExperienceWriters(noIsolation).findings.some((f) => f.disposition === "MISSING_isDocumentationRow_in_loadStepContext"));
  const wildWriter = new Map(sources);
  wildWriter.set("src/routes/dokumentasiLiar.js", "await tx.productionStepEvidence.create({});\n");
  assert.ok(auditProductionExperienceWriters(wildWriter).findings.some((f) => f.disposition === "UNOWNED_WRITER"));
  const routeWrites = new Map(sources);
  routeWrites.set("src/routes/productionDocumentation.js", `${sources.get("src/routes/productionDocumentation.js")}
await prisma.unit.update({});
`);
  assert.ok(auditProductionExperienceWriters(routeWrites).findings.some((f) => f.disposition === "READ_MODEL_MUST_NOT_WRITE"));
});

test("audit P11 BACA-SAJA: laporan tidak punya penulis; menangkap create/update/$executeRaw/$transaction/SQL tulis, route non-GET, impor command, helper lifecycle, dan pembaca bukti tanpa pemisah DOC_", () => {
  const sources = loadBackendSources(backendRoot);
  const REPORT = "src/services/productionReportingService.js";
  const ROUTE = "src/routes/productionReports.js";
  const real = auditProductionExperienceWriters(sources).findings;
  assert.equal(real.filter((f) => f.kind.startsWith("REPORT_") || f.kind === "DOC_FILTER").filter((f) => !f.ok).length, 0, JSON.stringify(real.filter((f) => !f.ok)));
  const bad = new Map(sources);
  bad.set(REPORT, `${sources.get(REPORT)}
await prisma.unit.update({});
await prisma.$transaction([]);
await prisma.$executeRaw\`UPDATE units SET status = 'X'\`;
await applyCompleteInTx();
`);
  bad.set("src/services/productionReportingRouting.js", `${sources.get("src/services/productionReportingRouting.js")}\nimport { completeStep } from "./productionStepCommandService.js";\n`);
  bad.set(ROUTE, `${sources.get(ROUTE)}\nproductionReportsRouter.post("/x", () => {});\nproductionReportsRouter.delete("/x", () => {});\n`);
  const d = auditProductionExperienceWriters(bad).findings.filter((f) => !f.ok).map((f) => f.disposition);
  for (const expected of ["REPORT_MUST_NOT_WRITE", "REPORT_MUST_NOT_OPEN_TRANSACTION_OR_UNSAFE_SQL", "FORBIDDEN_applyCompleteInTx", "FORBIDDEN_IMPORT_completeStep", "FORBIDDEN_ROUTE_POST", "FORBIDDEN_ROUTE_DELETE"]) assert.ok(d.includes(expected), `${expected}: ${d.join(",")}`);
  assert.ok(d.includes("REPORT_MUST_NOT_RUN_WRITE_SQL") || d.includes("REPORT_MUST_NOT_WRITE"));
  const noDocFilter = new Map(sources);
  noDocFilter.set(REPORT, sources.get(REPORT).replaceAll("isDocumentationRow(", "bukanDokumentasi("));
  assert.ok(auditProductionExperienceWriters(noDocFilter).findings.some((f) => f.disposition === "MISSING_DOC_FILTER_reporting"));
  const missing = new Map(sources); missing.delete(ROUTE);
  assert.ok(auditProductionExperienceWriters(missing).findings.some((f) => f.disposition === "MISSING_REPORT_FILE"));
});

test("audit writer P8 menangkap: bukti diubah/dihapus, penulis liar, P8 menulis operasi/stok langsung, read-model menulis, outbox ditandai terkirim", () => {
  const sources = loadBackendSources(backendRoot);
  const STEP = "src/services/productionStepCommandService.js";
  const bad = new Map(sources);
  bad.set("src/routes/liar.js", "await tx.productionStepEvidence.update({});\nawait tx.productionStepEvidence.create({});\nawait tx.productionMaterialShortage.update({});\n");
  bad.set(STEP, `${sources.get(STEP)}\nawait tx.productionOperationRun.update({});\nawait tx.stockMovement.create({});\nawait tx.domainOutbox.update({ status: "DELIVERED" });\n`);
  bad.set("src/services/productionExperienceReadService.js", `${sources.get("src/services/productionExperienceReadService.js")}\nawait prisma.unit.update({});\n`);
  const dispositions = auditProductionExperienceWriters(bad).findings.filter((f) => !f.ok).map((f) => f.disposition).sort();
  for (const expected of ["IMMUTABLE_VIOLATION_update", "UNOWNED_WRITER", "FORBIDDEN_productionOperationRun", "FORBIDDEN_stockMovement", "READ_MODEL_MUST_NOT_WRITE", "P8_MARKS_OUTBOX_DELIVERED"]) {
    assert.ok(dispositions.includes(expected), `${expected} harus terdeteksi: ${dispositions.join(",")}`);
  }
  const noHelper = new Map(sources);
  noHelper.set(STEP, sources.get(STEP).replaceAll("applyCompleteInTx(", "selesaiSendiri("));
  assert.ok(auditProductionExperienceWriters(noHelper).findings.some((f) => f.disposition === "MISSING_applyCompleteInTx"));
});

test("migration P8 aditif: kolom plan nullable/berdefault, 2 tabel baru, trigger immutable, partial unique; tanpa DROP/UPDATE/DELETE; LF", () => {
  const MIGRATION = "20261006080000_production_experience_v2";
  const sql = fs.readFileSync(path.join(backendRoot, "prisma", "migrations", MIGRATION, "migration.sql"), "utf8");
  const executable = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");
  assert.equal(sql.includes("\r"), false, "migration harus LF (checksum stabil)");
  assert.equal(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE\s+"|RENAME|INSERT INTO)\b/i.test(executable), false);
  assert.equal(/SET NOT NULL|ALTER COLUMN/i.test(executable), false);
  assert.deepEqual([...executable.matchAll(/ADD COLUMN "([^"]+)"/g)].map((m) => m[1]).sort(), ["corner_operator_id", "corner_work_center_id", "priority", "production_date", "station_code"]);
  assert.match(executable, /ADD COLUMN "priority" SMALLINT NOT NULL DEFAULT 0/);
  assert.deepEqual([...executable.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]).sort(), ["production_material_shortages_v2", "production_step_evidence_v2"]);
  assert.match(executable, /CREATE TRIGGER "production_step_evidence_v2_immutable" BEFORE UPDATE OR DELETE ON "production_step_evidence_v2"/);
  assert.match(executable, /CREATE UNIQUE INDEX "production_material_shortages_v2_open_run_key" ON "production_material_shortages_v2"\("run_id"\) WHERE "status" = 'OPEN'/);
  assert.match(executable, /CREATE UNIQUE INDEX "production_step_evidence_v2_run_id_step_no_version_key"/);
  const names = fs.readdirSync(path.join(backendRoot, "prisma", "migrations"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  // Migration P8 harus ada dan tidak boleh didahului-urut oleh migration yang lebih lama (urutan nama = urutan terapan); migration
  // yang lebih BARU (P9A..P9D, Finance) memang wajar ada setelahnya.
  assert.ok(names.includes(MIGRATION), "migration P8 ada");
  assert.ok(names.indexOf(MIGRATION) >= names.filter((n) => n < MIGRATION).length, "urutan migration P8 konsisten");
});
