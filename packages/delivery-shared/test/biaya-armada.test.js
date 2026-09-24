import test from "node:test";
import assert from "node:assert/strict";
import { allowedActions, statusInfo, validateDraft, toCreateBody, PERLU_REVISI_DIDUKUNG_BACKEND, BACKEND_STATUS, STAGES } from "../src/biayaArmada/domain.js";
import { createBiayaArmadaApi } from "../src/biayaArmada/api.js";

const AB = (o = {}) => ({ submit: false, verify: false, approve: false, pay: false, ...o });
const sub = (o = {}) => ({ id: "s1", status: "DRAFT", requestedById: "me", createdById: "me", finExpenseId: null, finExpense: null, proofs: [], ...o });

test("setiap status backend punya label & tahap alur tim; PERLU_REVISI dicatat belum didukung", () => {
  for (const s of Object.values(BACKEND_STATUS)) {
    const i = statusInfo(s);
    assert.ok(i.label && i.tone, s);
    assert.ok(STAGES.includes(i.stage), `${s} -> ${i.stage}`);
  }
  assert.equal(PERLU_REVISI_DIDUKUNG_BACKEND, false);
  assert.equal(statusInfo("ENTAH").stage, "TIDAK_DIKENAL");
});

test("driver: edit/ajukan hanya DRAFT miliknya; tarik hanya MENUNGGU_PERSETUJUAN; tidak bisa approve/bayar", () => {
  const ab = AB({ submit: true });
  assert.deepEqual(Object.entries(allowedActions(sub(), ab, "me")).filter(([, v]) => v).map(([k]) => k).sort(), ["ajukan", "batalkan", "edit", "uploadBukti"]);
  const menunggu = allowedActions(sub({ status: "MENUNGGU_PERSETUJUAN", finExpenseId: "f1" }), ab, "me");
  assert.equal(menunggu.tarik, true);
  assert.equal(menunggu.edit, false);
  assert.equal(menunggu.setujui, false);
  assert.equal(menunggu.bayar, false);
  assert.equal(allowedActions(sub(), ab, "orang-lain").edit, false, "bukan miliknya");
  assert.equal(Object.values(allowedActions(sub({ status: "DIBAYAR" }), ab, "me")).some(Boolean), false, "terminal");
});

test("izin dipisah: verifikasi, setujui, bayar masing-masing hanya dengan izinnya", () => {
  const menunggu = sub({ status: "MENUNGGU_PERSETUJUAN", finExpenseId: "f1", finExpense: { receiptUrl: "/m/a.jpg", receiptVerifiedAt: null } });
  assert.equal(allowedActions(menunggu, AB({ verify: true }), "x").verifikasiBukti, true);
  assert.equal(allowedActions(menunggu, AB({ verify: true }), "x").setujui, false);
  assert.equal(allowedActions(menunggu, AB({ approve: true }), "x").setujui, true);
  assert.equal(allowedActions(menunggu, AB({ approve: true }), "x").bayar, false);
  const disetujui = sub({ status: "DISETUJUI", finExpenseId: "f1" });
  assert.equal(allowedActions(disetujui, AB({ pay: true }), "x").bayar, true);
  assert.equal(allowedActions(disetujui, AB({ approve: true, verify: true }), "x").bayar, false);
  const terverifikasi = sub({ status: "MENUNGGU_PERSETUJUAN", finExpenseId: "f1", finExpense: { receiptUrl: "/m/a.jpg", receiptVerifiedAt: "2026-09-24" } });
  assert.equal(allowedActions(terverifikasi, AB({ verify: true }), "x").verifikasiBukti, false, "sudah terverifikasi");
});

const CFG = { expenseTypes: [{ code: "BBM" }, { code: "SERVIS" }], metadataFields: { BBM: [{ key: "liters", label: "Jumlah liter", required: true }], SERVIS: [{ key: "odometerKm", label: "Odometer (km)", required: true }] } };
test("validateDraft: wajib jenis, nominal > 0, tanggal, dan field metadata dari server; odometer opsional harus angka", () => {
  assert.equal(validateDraft({}, CFG).ok, false);
  assert.equal(validateDraft({ expenseType: "BBM", amount: 50000, date: "2026-09-24", metadata: { liters: 8 } }, CFG).ok, true);
  assert.equal(validateDraft({ expenseType: "BBM", amount: 50000, date: "2026-09-24", metadata: {} }, CFG).errors["metadata.liters"], "Jumlah liter wajib diisi");
  assert.equal(validateDraft({ expenseType: "BBM", amount: -1, date: "2026-09-24", metadata: { liters: 1 } }, CFG).errors.amount, "Nominal harus lebih dari 0");
  assert.equal(validateDraft({ expenseType: "TERBANG", amount: 1, date: "2026-09-24" }, CFG).errors.expenseType, "Jenis biaya tidak dikenal");
  assert.ok(validateDraft({ expenseType: "BBM", amount: 1, date: "2026-09-24", metadata: { liters: 1, odometerKm: "abc" } }, CFG).errors["metadata.odometerKm"]);
});

test("toCreateBody hanya meneruskan field yang dikenal backend + workspace DELIVERY", () => {
  const b = toCreateBody({ expenseType: "BBM", amount: 1, date: "2026-09-24", vehicleId: "v", rahasia: "x", notes: "" });
  assert.deepEqual(b, { workspace: "DELIVERY", expenseType: "BBM", amount: 1, date: "2026-09-24", vehicleId: "v" });
});

test("API biaya armada: aksi uang WAJIB Idempotency-Key & memakai endpoint existing", async () => {
  const calls = [];
  const client = { request: async (p, o) => { calls.push([p, o]); return {}; }, upload: async (p, f, o) => { calls.push([p, o]); return {}; } };
  const api = createBiayaArmadaApi(client);
  assert.throws(() => api.ajukan("s1"), /Idempotency-Key wajib/);
  await api.ajukan("s1", "k-ajukan-1");
  await api.setujui("f1", "k-setuju-1");
  await api.bayar("f1", { cashAccountId: "c" }, "k-bayar-1");
  await api.uploadBukti("s1", { uri: "file://a.jpg" });
  assert.equal(calls[0][0], "/finance/expense-submissions/s1/ajukan");
  assert.equal(calls[0][1].headers["Idempotency-Key"], "k-ajukan-1");
  assert.equal(calls[1][0], "/finance/expenses/f1/approve");
  assert.equal(calls[2][0], "/finance/expenses/f1/pay");
  assert.equal(calls[3][0], "/finance/expense-submissions/s1/bukti");
  assert.equal(calls[3][1].fieldName, "bukti");
});
