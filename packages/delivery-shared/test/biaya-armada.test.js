import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedActions, statusInfo, validateDraft, toCreateBody, PERLU_REVISI_DIDUKUNG_BACKEND, BACKEND_STATUS, STAGES,
  statusesForStage, metadataFieldsFor, describeAudit, emptyDraft, formatRupiah,
} from "../src/biayaArmada/domain.js";
import { createBiayaArmadaApi } from "../src/biayaArmada/api.js";
import { deliveryExpenseAbilities } from "../src/rbac.js";

const AB = (o = {}) => ({ submit: false, verify: false, approve: false, requestRevision: false, pay: false, ...o });
const sub = (o = {}) => ({ id: "s1", status: "DRAFT", requestedById: "me", createdById: "me", finExpenseId: null, finExpense: null, proofs: [], ...o });
const aktif = (a) => Object.entries(a).filter(([, v]) => v).map(([k]) => k).sort();

test("setiap status backend punya label & tahap alur tim; PERLU_REVISI kini didukung backend", () => {
  for (const s of Object.values(BACKEND_STATUS)) {
    const i = statusInfo(s);
    assert.ok(i.label && i.tone, s);
    assert.ok(STAGES.includes(i.stage), `${s} -> ${i.stage}`);
  }
  assert.equal(PERLU_REVISI_DIDUKUNG_BACKEND, true);
  assert.equal(statusInfo("PERLU_REVISI").stage, "PERLU_REVISI");
  assert.equal(statusInfo("ENTAH").stage, "TIDAK_DIKENAL");
});

test("filter status per tahap memetakan ke SEMUA status backend yang relevan", () => {
  assert.deepEqual(statusesForStage("DIAJUKAN").sort(), ["DIAJUKAN", "MENUNGGU_PERSETUJUAN"]);
  assert.deepEqual(statusesForStage("DISETUJUI").sort(), ["DISETUJUI", "OTOMATIS_DISETUJUI"]);
  assert.deepEqual(statusesForStage("DITOLAK").sort(), ["DIBATALKAN", "DITOLAK"]);
  assert.deepEqual(statusesForStage("PERLU_REVISI"), ["PERLU_REVISI"]);
  const semua = STAGES.flatMap(statusesForStage).sort();
  assert.deepEqual(semua, Object.values(BACKEND_STATUS).sort(), "tidak ada status yang tidak punya tahap");
});

test("pemilik: edit/ajukan/bukti saat DRAF dan PERLU_REVISI; tarik hanya saat menunggu; tidak bisa setujui", () => {
  const ab = AB({ submit: true });
  assert.deepEqual(aktif(allowedActions(sub(), ab, "me")), ["ajukan", "batalkan", "edit", "uploadBukti"]);
  assert.deepEqual(aktif(allowedActions(sub({ status: "PERLU_REVISI" }), ab, "me")), ["ajukan", "batalkan", "edit", "uploadBukti"]);
  const menunggu = allowedActions(sub({ status: "MENUNGGU_PERSETUJUAN", finExpenseId: "f1" }), ab, "me");
  assert.deepEqual(aktif(menunggu), ["batalkan", "tarik"]);
  assert.equal(allowedActions(sub(), ab, "orang-lain").edit, false, "bukan miliknya");
  for (const st of ["DISETUJUI", "OTOMATIS_DISETUJUI", "DIBAYAR", "DITOLAK", "DIBATALKAN"]) {
    assert.equal(aktif(allowedActions(sub({ status: st }), ab, "me")).length, 0, st);
  }
});

test("reviewer: minta revisi/setujui/tolak hanya saat menunggu, dengan izinnya, dan bukan pemohon sendiri", () => {
  const menunggu = sub({ status: "MENUNGGU_PERSETUJUAN", finExpenseId: "f1" });
  assert.deepEqual(aktif(allowedActions(menunggu, AB({ approve: true, requestRevision: true }), "reviewer")), ["mintaRevisi", "setujui", "tolak"]);
  assert.deepEqual(aktif(allowedActions(menunggu, AB({ requestRevision: true }), "reviewer")), ["mintaRevisi"]);
  assert.deepEqual(aktif(allowedActions(menunggu, AB({ approve: true }), "reviewer")), ["setujui", "tolak"]);
  assert.deepEqual(aktif(allowedActions(menunggu, AB({ approve: true, requestRevision: true }), "me")), [], "pemohon tidak menyetujui/merevisi dirinya");
  assert.deepEqual(aktif(allowedActions(sub({ status: "DISETUJUI" }), AB({ approve: true, requestRevision: true }), "reviewer")), []);
  assert.deepEqual(aktif(allowedActions(sub({ status: "PERLU_REVISI" }), AB({ approve: true, requestRevision: true }), "reviewer")), []);
  assert.deepEqual(aktif(allowedActions(menunggu, AB(), "reviewer")), [], "tanpa izin = tidak ada tombol");
});

test("izin biaya armada dari capabilities: lima kemampuan terpisah, default mati", () => {
  assert.deepEqual(deliveryExpenseAbilities({}), { submit: false, verify: false, approve: false, requestRevision: false, pay: false });
  assert.deepEqual(deliveryExpenseAbilities({ deliveryExpense: { approve: true, requestRevision: true } }), { submit: false, verify: false, approve: true, requestRevision: true, pay: false });
});

const CFG = { expenseTypes: [{ code: "BBM" }, { code: "SERVIS" }], metadataFieldsByType: { BBM: [{ key: "liters", label: "Jumlah liter", required: true }], SERVIS: [{ key: "odometerKm", label: "Odometer (km)", required: true }] } };
test("validateDraft: wajib jenis, nominal > 0, tanggal, dan field metadata dari server; odometer opsional harus angka", () => {
  assert.equal(validateDraft({}, CFG).ok, false);
  assert.equal(validateDraft({ expenseType: "BBM", amount: 50000, date: "2026-09-24", metadata: { liters: 8 } }, CFG).ok, true);
  assert.equal(validateDraft({ expenseType: "BBM", amount: 50000, date: "2026-09-24", metadata: {} }, CFG).errors["metadata.liters"], "Jumlah liter wajib diisi");
  assert.equal(validateDraft({ expenseType: "BBM", amount: -1, date: "2026-09-24", metadata: { liters: 1 } }, CFG).errors.amount, "Nominal harus lebih dari 0");
  assert.equal(validateDraft({ expenseType: "TERBANG", amount: 1, date: "2026-09-24" }, CFG).errors.expenseType, "Jenis biaya tidak dikenal");
  assert.ok(validateDraft({ expenseType: "BBM", amount: 1, date: "2026-09-24", metadata: { liters: 1, odometerKm: "abc" } }, CFG).errors["metadata.odometerKm"]);
  assert.equal(validateDraft({ expenseType: "SERVIS", amount: 1, date: "2026-09-24", metadata: {} }, CFG).errors["metadata.odometerKm"], "Odometer (km) wajib diisi");
});

test("metadataFieldsFor membaca kunci SERVER (metadataFieldsByType), aman bila config kosong", () => {
  assert.equal(metadataFieldsFor(CFG, "BBM").length, 1);
  assert.deepEqual(metadataFieldsFor(null, "BBM"), []);
  assert.deepEqual(metadataFieldsFor(CFG, "TOL"), []);
});

test("toCreateBody hanya meneruskan field yang dikenal backend + workspace DELIVERY", () => {
  const b = toCreateBody({ expenseType: "BBM", amount: 1, date: "2026-09-24", vehicleId: "v", rahasia: "x", notes: "" });
  assert.deepEqual(b, { workspace: "DELIVERY", expenseType: "BBM", amount: 1, date: "2026-09-24", vehicleId: "v" });
});

test("timeline audit: kalimat Indonesia yang membedakan revisi, tarik, batalkan, ajukan ulang", () => {
  const d = (field, before, after, reason = null) => describeAudit({ field, before, after, reason });
  assert.equal(d("status", null, "DRAFT"), "Draf dibuat");
  assert.equal(d("status", "DRAFT", "MENUNGGU_PERSETUJUAN"), "Diajukan");
  assert.equal(d("status", "PERLU_REVISI", "MENUNGGU_PERSETUJUAN"), "Diajukan ulang setelah revisi");
  assert.equal(d("status", "MENUNGGU_PERSETUJUAN", "PERLU_REVISI", "Foto buram"), "Diminta revisi — Foto buram");
  assert.equal(d("status", "MENUNGGU_PERSETUJUAN", "DRAFT"), "Ditarik kembali oleh pemohon");
  assert.equal(d("status", "DRAFT", "DIBATALKAN", "Salah input"), "Dibatalkan — Salah input");
  assert.equal(d("draft", null, "amount"), "Draf diubah");
  assert.equal(d("bukti", null, "versi 2"), "Foto struk diunggah (versi 2)");
  assert.equal(d("description", "a", "b", "typo"), "Koreksi description — typo");
});

test("emptyDraft dan formatRupiah", () => {
  assert.equal(emptyDraft("2026-09-24").date, "2026-09-24");
  assert.equal(emptyDraft("2026-09-24").expenseType, "");
  assert.match(formatRupiah(1500000), /^Rp1\.500\.000$|^Rp1,500,000$/);
});

test("API biaya armada: aksi uang WAJIB Idempotency-Key & memakai endpoint existing (termasuk minta revisi)", async () => {
  const calls = [];
  const client = { request: async (p, o) => { calls.push([p, o]); return {}; }, upload: async (p, f, o) => { calls.push([p, o]); return {}; } };
  const api = createBiayaArmadaApi(client);
  assert.throws(() => api.ajukan("s1"), /Idempotency-Key wajib/);
  assert.throws(() => api.mintaRevisi("s1", "alasan"), /Idempotency-Key wajib/);
  await api.ajukan("s1", "k-ajukan-1");
  await api.setujui("f1", "k-setuju-1");
  await api.mintaRevisi("s1", "Foto buram", "k-rev-0001");
  await api.uploadBukti("s1", { uri: "file://a.jpg" });
  await api.signMedia(["/media/finance-receipts/x.jpg"]);
  assert.equal(calls[0][0], "/finance/expense-submissions/s1/ajukan");
  assert.equal(calls[0][1].headers["Idempotency-Key"], "k-ajukan-1");
  assert.equal(calls[1][0], "/finance/expenses/f1/approve");
  assert.equal(calls[2][0], "/finance/expense-submissions/s1/minta-revisi");
  assert.deepEqual(calls[2][1].body, { reason: "Foto buram" });
  assert.equal(calls[3][0], "/finance/expense-submissions/s1/bukti");
  assert.equal(calls[3][1].fieldName, "bukti");
  assert.equal(calls[4][0], "/finance/media/sign");
  assert.deepEqual(calls[4][1].body, { urls: ["/media/finance-receipts/x.jpg"] });
});
