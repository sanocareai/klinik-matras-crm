import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAccounts, initialDraft, draftReducer, selectedAccountId, buildPaymentPayload, parseAmount, METHODS,
} from "../src/lib/paymentDraft.js";

const A = { id: "a1", name: "SANOBANK", kind: "BANK", bankName: "BCA", accountHolder: "Kemal", accountNumberMasked: "••••7890" };
const B = { id: "b2", name: "PT Sano", kind: "BANK", bankName: null, accountHolder: null };
const run = (...aksi) => aksi.reduce((d, a) => draftReducer(d, a), initialDraft());

test("normalizeAccounts: 0, 1, 2+ rekening; kotor/duplikat/nonaktif dibuang; urut bank dulu", () => {
  assert.deepEqual(normalizeAccounts([]), []);
  assert.deepEqual(normalizeAccounts(null), []);
  assert.deepEqual(normalizeAccounts({ error: "x" }), []);
  assert.equal(normalizeAccounts([A]).length, 1);
  const dua = normalizeAccounts([B, A]);
  assert.deepEqual(dua.map((x) => x.id), ["b2", "a1"], "urut nama (PT Sano, SANOBANK)");
  assert.equal(dua.length, 2, "kedua rekening aktual tampil");
  const kotor = normalizeAccounts([A, A, null, "x", { id: "", name: "Z" }, { id: "z", name: "  " }, { id: "n", name: "Nonaktif", active: false }, B]);
  assert.deepEqual(kotor.map((x) => x.id).sort(), ["a1", "b2"]);
  const e = { id: "e", name: "OVO", kind: "EWALLET" };
  assert.deepEqual(normalizeAccounts([e, B, A]).map((x) => x.kind), ["BANK", "BANK", "EWALLET"]);
});

test("normalizeAccounts: field opsional dipetakan; nomor hanya bentuk tersamarkan dari server", () => {
  const [a] = normalizeAccounts([A]);
  assert.equal(a.bankName, "BCA");
  assert.equal(a.holder, "Kemal");
  assert.equal(a.masked, "••••7890");
  const [b] = normalizeAccounts([{ id: "x", name: "N", accountNumber: "1234567890" }]);
  assert.equal(b.masked, null, "nomor mentah tidak pernah dipakai");
});

test("Transfer: rekening dipilih & ketuk lagi melepas", () => {
  const acc = normalizeAccounts([A, B]);
  let d = run({ type: "method", value: "TRANSFER" }, { type: "pickAccount", id: "a1" });
  assert.equal(selectedAccountId(d, acc), "a1");
  d = draftReducer(d, { type: "pickAccount", id: "a1" });
  assert.equal(selectedAccountId(d, acc), null);
  d = draftReducer(d, { type: "pickAccount", id: "b2" });
  assert.equal(selectedAccountId(d, acc), "b2");
});

test("Pilihan rekening bertahan saat pindah metode & kembali, tidak bocor antar metode", () => {
  const acc = normalizeAccounts([A, B]);
  let d = run({ type: "method", value: "TRANSFER" }, { type: "pickAccount", id: "a1" });
  d = draftReducer(d, { type: "method", value: "QRIS" });
  assert.equal(selectedAccountId(d, acc), null, "QRIS belum memilih → tidak membawa pilihan Transfer");
  d = draftReducer(d, { type: "pickAccount", id: "b2" });
  d = draftReducer(d, { type: "method", value: "TRANSFER" });
  assert.equal(selectedAccountId(d, acc), "a1", "kembali ke Transfer: pilihan awal utuh");
  d = draftReducer(d, { type: "method", value: "QRIS" });
  assert.equal(selectedAccountId(d, acc), "b2");
});

test("Tunai TIDAK PERNAH mengirim rekening, walau sebelumnya ada yang dipilih di metode lain", () => {
  const acc = normalizeAccounts([A, B]);
  let d = run({ type: "amount", value: "150000" }, { type: "method", value: "TRANSFER" }, { type: "pickAccount", id: "a1" }, { type: "method", value: "CASH" });
  assert.equal(selectedAccountId(d, acc), null);
  const p = buildPaymentPayload(d, acc, null);
  assert.deepEqual(p, { amount: 150000, method: "CASH" });
  assert.ok(!("cashAccountId" in p));
  assert.deepEqual(draftReducer(d, { type: "pickAccount", id: "b2" }), d, "pickAccount diabaikan untuk Tunai");
});

test("buildPaymentPayload: Transfer membawa rekening + bukti; rekening basi (tak ada di daftar aktif) dibuang", () => {
  const acc = normalizeAccounts([A, B]);
  const d = run({ type: "amount", value: "Rp 1.250.000" }, { type: "method", value: "TRANSFER" }, { type: "pickAccount", id: "a1" });
  assert.deepEqual(buildPaymentPayload(d, acc, "/media/payment-proofs/x.jpg"), {
    amount: 1250000, method: "TRANSFER", proofPhotoUrl: "/media/payment-proofs/x.jpg", cashAccountId: "a1",
  });
  assert.deepEqual(buildPaymentPayload(d, normalizeAccounts([B]), null), { amount: 1250000, method: "TRANSFER" }, "a1 dinonaktifkan");
  assert.deepEqual(buildPaymentPayload(d, [], null), { amount: 1250000, method: "TRANSFER" }, "daftar kosong");
});

test("Empat metode: masing-masing state terpisah; reset mengembalikan awal", () => {
  const acc = normalizeAccounts([A, B]);
  let d = initialDraft();
  for (const m of METHODS) {
    d = draftReducer(d, { type: "method", value: m });
    d = draftReducer(d, { type: "pickAccount", id: m === "CARD" ? "b2" : "a1" });
  }
  const per = Object.fromEntries(METHODS.map((m) => [m, selectedAccountId({ ...d, method: m }, acc)]));
  assert.deepEqual(per, { CASH: null, TRANSFER: "a1", QRIS: "a1", CARD: "b2" });
  assert.deepEqual(draftReducer(d, { type: "reset" }), initialDraft());
  assert.equal(draftReducer(d, { type: "method", value: "BITCOIN" }), d, "metode tak dikenal diabaikan");
});

test("parseAmount: format Indonesia, kosong/negatif/terlalu besar → 0", () => {
  assert.equal(parseAmount("1.500.000"), 1500000);
  assert.equal(parseAmount("Rp 250000"), 250000);
  assert.equal(parseAmount(""), 0);
  assert.equal(parseAmount("abc"), 0);
  assert.equal(parseAmount("-500"), 0, "nilai negatif ditolak");
  assert.equal(parseAmount("9".repeat(13)), 0);
});
