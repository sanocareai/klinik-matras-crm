import test from "node:test";
import assert from "node:assert/strict";
import {
  BUCKET_STYLE, COMMAND_CENTER_COLUMNS, MEDIA_RULES, STEPS, actionLabel, buildStepPayload, canDropOn, clearDraft, createIntentKeys,
  formatMinutes, friendlyError, indicatorList, isRetryableError, loadDraft, priorityTone, saveDraft, stationCapacity, targetDateBadge,
  validateStepForm, waitCopy, wibDate,
} from "../src/features/production/experience.js";

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), size: () => m.size }; };
const done = (kind = "image") => ({ status: "done", kind, url: "/media/production-evidence/x.jpg" });

test("12 tahap: urut, Table 1–9 / Corner 10–12, aturan media cermin server (video 2/4/6/8, foto wajib 12)", () => {
  assert.deepEqual(STEPS.map((s) => s.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(STEPS.filter((s) => s.actor === "CORNER").length, 3);
  assert.deepEqual([2, 4, 6, 8].map((n) => MEDIA_RULES[n].video), [true, true, true, true]);
  assert.equal(MEDIA_RULES[12].min, 1);
  assert.equal(MEDIA_RULES[5].min, 0);
});

// P9B — prioritas & badge tanggal target adalah field TERPISAH (permintaan eksplisit): prioritas URGENT/HIGH/NORMAL
// tidak boleh berubah warna karena tanggal target, dan sebaliknya.
test("P9B (Slice 1): priorityTone Komplain=merah / Tinggi(+Mendesak lama)=oranye / Normal=netral; targetDateBadge terlambat/hari-ini-belum-mulai/besok", () => {
  assert.equal(priorityTone(3), "red");
  assert.equal(priorityTone(2), "orange", "Mendesak lama tampil Tinggi");
  assert.equal(priorityTone(1), "orange");
  assert.equal(priorityTone(0), "neutral");
  assert.equal(priorityTone(undefined), "neutral");

  const today = "2026-09-30"; const tomorrow = "2026-10-01";
  assert.equal(targetDateBadge({ plan: null }, today, tomorrow), null, "belum dijadwalkan -> tidak ada badge tanggal");
  assert.deepEqual(targetDateBadge({ plan: { productionDate: today }, progress: { done: 0 }, activeOp: null, timer: { late: false } }, today, tomorrow), { tone: "red", label: "Target hari ini" });
  assert.equal(targetDateBadge({ plan: { productionDate: today }, progress: { done: 2 }, activeOp: null, timer: { late: false } }, today, tomorrow), null, "sudah ada progres -> bukan 'belum mulai' lagi");
  assert.deepEqual(targetDateBadge({ plan: { productionDate: tomorrow }, progress: { done: 0 }, activeOp: null, timer: { late: false } }, today, tomorrow), { tone: "orange", label: "Target besok" });
  assert.deepEqual(targetDateBadge({ plan: { productionDate: today }, progress: { done: 5 }, activeOp: null, timer: { late: true } }, today, tomorrow), { tone: "red", label: "Terlambat" }, "terlambat menang atas aturan lain apa pun");

  assert.deepEqual(COMMAND_CENTER_COLUMNS, ["AKAN_MASUK", "DALAM_PERJALANAN", "TIBA_BELUM_MULAI", "PENGERJAAN", "UJI_HASIL", "BONGKAR", "UJI_FONDASI", "FONDASI", "LAPISAN", "UJI_TEKSTUR", "CORNER", "SIAP_KIRIM"]);
});

test("validasi form tahap: unggahan belum selesai/gagal, video wajib, pengukuran, rework, checklist", () => {
  assert.match(validateStepForm(1, { conditionConfirmed: true }, { mediaItems: [{ status: "uploading" }] }), /Tunggu unggahan/);
  assert.match(validateStepForm(1, { conditionConfirmed: true }, { mediaItems: [{ status: "error" }] }), /gagal/);
  assert.match(validateStepForm(1, {}, { mediaItems: [done()] }), /konfirmasi/);
  assert.equal(validateStepForm(1, { conditionConfirmed: true }, { mediaItems: [done()] }), null);
  assert.match(validateStepForm(2, { feelNote: "empuk" }, { mediaItems: [done("image")] }), /wajib video/);
  assert.equal(validateStepForm(2, { feelNote: "empuk" }, { mediaItems: [done("video")] }), null);
  assert.match(validateStepForm(4, { heightBeforeCm: "17", heightCompressedCm: "24", testerWeightKg: "85" }, { mediaItems: [done("video")] }), /tidak boleh lebih besar/);
  assert.equal(validateStepForm(4, { heightBeforeCm: "24", heightCompressedCm: "17,5", testerWeightKg: "85" }, { mediaItems: [done("video")] }), null, "koma desimal diterima");
  assert.match(validateStepForm(5, { diagnosis: "pendek" }), /minimal 10/);
  assert.match(validateStepForm(6, { materials: [], note: "pocket" }, { mediaItems: [done("video")] }), /bahan Gudang/);
  assert.match(validateStepForm(8, { testerWeightKg: 85 }, { mediaItems: [done("video")] }), /Pilih hasil uji/);
  assert.match(validateStepForm(11, { checklist: { jahitan: true } }, { mediaItems: [done()] }), /checklist/);
  assert.match(validateStepForm(12, { confirm: true }, { mediaItems: [] }), /minimal 1/);
});

test("payload tahap dinormalisasi ke kontrak server", () => {
  assert.deepEqual(buildStepPayload(4, { heightBeforeCm: "24", heightCompressedCm: "17,5", testerWeightKg: "85", foundationIssues: ["Per tengah lemah", ""] }),
    { heightBeforeCm: 24, heightCompressedCm: 17.5, testerWeightKg: 85, foundationIssues: ["Per tengah lemah"], note: undefined });
  assert.deepEqual(buildStepPayload(6, { materials: [{ materialId: "m1", qty: "1" }, { materialId: "m2", qty: "0" }], note: " pocket " }), { materials: [{ materialId: "m1", qty: 1 }], note: "pocket" });
  assert.deepEqual(buildStepPayload(11, { checklist: { jahitan: true, list: true } }).checklist, { jahitan: true, list: true, resleting: false, kebersihan: false });
  assert.equal(buildStepPayload(5, { diagnosis: " x ", inputMethod: "VOICE" }).inputMethod, "VOICE");
});

test("label aksi & teks tunggu dalam Bahasa Indonesia", () => {
  assert.equal(actionLabel({ stepNo: 1, action: "START_WITH_EVIDENCE" }), "Mulai: Foto Sebelum Bongkar");
  assert.equal(actionLabel({ stepNo: 7, action: "EVIDENCE", rework: true }), "Ulangi Lapisan Baru (Rework)");
  assert.equal(actionLabel({ stepNo: 9, action: "HANDOFF" }), "Kirim ke Corner");
  assert.equal(actionLabel({ stepNo: 6, action: "START" }, { stageLabel: "Upgrade Fondasi" }), "Mulai Upgrade Fondasi");
  assert.equal(waitCopy({ wait: "AWAITING_QC" }).title, "Menunggu QC");
  assert.match(waitCopy({ wait: "SERVICE_NOT_SET" }).text, /Production Lead/);
  assert.match(waitCopy({ wait: "DIAGNOSIS_MANUAL_UNMAPPED" }).text, /memetakan bahan manual/);
  assert.match(waitCopy({ wait: "DIAGNOSIS_BOM_EMPTY" }).text, /Revisi Diagnosis/);
});

test("pesan galat ramah (409 revisi, urutan, jaringan, akses) tanpa kode teknis", () => {
  assert.match(friendlyError({ status: 409, code: "STEP_REVISION_CONFLICT" }), /dimuat ulang/);
  assert.match(friendlyError({ status: 409, code: "STEP_OUT_OF_ORDER", detail: { expectedStep: 4 } }), /Uji Fondasi Lama/);
  assert.match(friendlyError({ status: 0, code: "NETWORK", message: "x" }), /Koneksi terputus/);
  assert.match(friendlyError({ status: 403, code: "WORKSHOP_OPERATOR_MISMATCH" }), /PIC lain/);
  assert.match(friendlyError({ status: 403 }), /tidak punya akses/);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}/.test(friendlyError({ status: 409, code: "STEP_OUT_OF_ORDER", detail: { expectedStep: 2 } })), false);
});

test("draft lokal per unit+tahap; storage rusak tidak memecahkan form", () => {
  const s = memoryStorage();
  assert.equal(saveDraft(s, "r1", 3, { form: { oldMaterials: ["PER"] } }), true);
  assert.deepEqual(loadDraft(s, "r1", 3).form, { oldMaterials: ["PER"] });
  assert.equal(loadDraft(s, "r1", 4), null);
  clearDraft(s, "r1", 3);
  assert.equal(loadDraft(s, "r1", 3), null);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("x"); } };
  assert.equal(loadDraft(broken, "r1", 3), null);
  assert.equal(saveDraft(broken, "r1", 3, {}), false);
  assert.doesNotThrow(() => clearDraft(broken, "r1", 3));
  s.setItem("p8-draft:r2:1", "{bukan json");
  assert.equal(loadDraft(s, "r2", 1), null);
});

test("kunci idempotensi per niat: sama saat Coba Lagi, baru setelah dilepas atau revisi berubah", () => {
  let n = 0;
  const keys = createIntentKeys(() => `id${++n}`);
  const a = keys.keyFor("r1", 2, 5);
  assert.equal(keys.keyFor("r1", 2, 5), a);
  assert.notEqual(keys.keyFor("r1", 2, 6), a);
  keys.release("r1", 2, 5);
  assert.notEqual(keys.keyFor("r1", 2, 5), a);
  assert.equal(isRetryableError({ status: 0 }), true);
  assert.equal(isRetryableError({ status: 502 }), true);
  assert.equal(isRetryableError({ status: 409 }), false);
  assert.equal(isRetryableError({ status: 503 }), false);
});

test("papan: kapasitas meja, drop tidak ke meja penuh/sama, indikator & format waktu", () => {
  const st = { code: "TABLE_1", capacity: 3, items: [{}, {}, {}] };
  assert.deepEqual(stationCapacity(st), { count: 3, capacity: 3, full: true, label: "3/3 unit" });
  assert.equal(canDropOn(st, { plan: { stationCode: "TABLE_2" } }), false);
  assert.equal(canDropOn({ code: "TABLE_2", capacity: 3, items: [{}] }, { plan: { stationCode: "TABLE_2" } }), false);
  assert.equal(canDropOn({ code: "TABLE_3", capacity: 3, items: [] }, { plan: null }), true);
  const ind = indicatorList({ custody: "OK", material: "KEKURANGAN", qc: "WAIVED" });
  assert.equal(ind.find((i) => i.key === "custody").tone, "green");
  assert.equal(ind.find((i) => i.key === "material").tone, "red");
  assert.equal(ind.find((i) => i.key === "qc").tone, "orange");
  assert.equal(formatMinutes(45), "45 mnt");
  assert.equal(formatMinutes(135), "2 j 15 mnt");
  assert.equal(wibDate(1, new Date("2026-09-29T20:00:00Z")), "2026-10-01");
  for (const key of ["ANTREAN", "MENUNGGU_BAHAN", "QC", "CORNER", "SELESAI"]) assert.ok(BUCKET_STYLE[key].label);
});
