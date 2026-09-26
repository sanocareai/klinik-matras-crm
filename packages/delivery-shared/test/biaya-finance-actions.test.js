import test from "node:test";
import assert from "node:assert/strict";
import { allowedActions, toCreateBody } from "../src/biayaArmada/domain.js";
import { createBiayaArmadaApi } from "../src/biayaArmada/api.js";

const abil = (x = {}) => ({ submit: false, verify: false, approve: false, requestRevision: false, pay: false, ...x });
const sub = (status, fe, requestedById = "lain") => ({ status, requestedById, createdById: requestedById, finExpense: fe });

test("verifikasi bukti: hanya pemegang verify, ada bukti, belum diverifikasi, bukan pembuat FinExpense", () => {
  const fe = { status: "MENUNGGU_APPROVAL", adaBukti: true, receiptVerifiedAt: null, createdById: "pembuat" };
  assert.equal(allowedActions(sub("MENUNGGU_PERSETUJUAN", fe), abil({ verify: true }), "admin").verifikasiBukti, true);
  assert.equal(allowedActions(sub("MENUNGGU_PERSETUJUAN", fe), abil(), "admin").verifikasiBukti, false);
  assert.equal(allowedActions(sub("MENUNGGU_PERSETUJUAN", fe), abil({ verify: true }), "pembuat").verifikasiBukti, false, "verifikasi sendiri disembunyikan");
  assert.equal(allowedActions(sub("MENUNGGU_PERSETUJUAN", { ...fe, adaBukti: false }), abil({ verify: true }), "admin").verifikasiBukti, false);
  assert.equal(allowedActions(sub("MENUNGGU_PERSETUJUAN", { ...fe, receiptVerifiedAt: "2026-09-26" }), abil({ verify: true }), "admin").verifikasiBukti, false);
  assert.equal(allowedActions(sub("DITOLAK", fe), abil({ verify: true }), "admin").verifikasiBukti, false);
  assert.equal(allowedActions(sub("DRAFT", null), abil({ verify: true }), "admin").verifikasiBukti, false);
});

test("bayar: hanya pemegang pay dan FinExpense DISETUJUI", () => {
  const ok = { status: "DISETUJUI" };
  assert.equal(allowedActions(sub("DISETUJUI", ok), abil({ pay: true }), "x").bayar, true);
  assert.equal(allowedActions(sub("OTOMATIS_DISETUJUI", ok), abil({ pay: true }), "x").bayar, true);
  assert.equal(allowedActions(sub("DISETUJUI", ok), abil(), "x").bayar, false);
  assert.equal(allowedActions(sub("DIBAYAR", { status: "DIBAYAR" }), abil({ pay: true }), "x").bayar, false);
  assert.equal(allowedActions(sub("MENUNGGU_PERSETUJUAN", { status: "MENUNGGU_APPROVAL" }), abil({ pay: true }), "x").bayar, false);
});

test("uang muka: advanceId ikut dikirim bila dipilih", () => {
  const b = toCreateBody({ expenseType: "BBM", amount: 1, date: "2026-09-26", sumberDana: "UANG_MUKA_OPERASIONAL", advanceId: "adv-1" });
  assert.equal(b.advanceId, "adv-1");
  assert.equal(toCreateBody({ expenseType: "BBM", advanceId: "" }).advanceId, undefined);
});

test("API baru memakai endpoint yang sudah ada; bayar wajib Idempotency-Key", async () => {
  const calls = [];
  const api = createBiayaArmadaApi({ request: async (p, o = {}) => { calls.push([p, o]); return {}; } });
  await api.rekeningKas();
  await api.uangMukaAktif({ requestedById: "u1" });
  await api.bayar("fe1", { cashAccountId: "k1", paymentMethod: "TUNAI" }, "kunci-12345678");
  assert.equal(calls[0][0], "/finance/cash-accounts");
  assert.match(calls[1][0], /^\/finance\/expense-submissions\/uang-muka-aktif\?requestedById=u1$/);
  assert.equal(calls[2][0], "/finance/expenses/fe1/pay");
  assert.equal(calls[2][1].headers["Idempotency-Key"], "kunci-12345678");
  assert.throws(() => api.bayar("fe1", {}, ""), /Idempotency-Key/);
});
