import test from "node:test";
import assert from "node:assert/strict";
import { checklistSiapBerangkat, hitungItemBelum, butuhFoto } from "./prepChecklistStatus.js";

test("checklistSiapBerangkat: tidak ada item wajib sama sekali tapi Bukti Kelengkapan SELALU wajib — baru siap kalau kelengkapanSiap true", () => {
  assert.equal(checklistSiapBerangkat([], true), true);
  assert.equal(checklistSiapBerangkat([], false), false);
  assert.equal(checklistSiapBerangkat([{ required: false, terpenuhi: false }], true), true);
});

test("checklistSiapBerangkat: false kalau ADA item wajib yang belum terpenuhi, walau kelengkapan sudah siap", () => {
  const items = [
    { required: true, terpenuhi: true },
    { required: true, terpenuhi: false },
  ];
  assert.equal(checklistSiapBerangkat(items, true), false);
});

test("checklistSiapBerangkat: true hanya kalau SEMUA item wajib terpenuhi DAN kelengkapanSiap true (item opsional yang belum tidak menahan)", () => {
  const items = [
    { required: true, terpenuhi: true },
    { required: false, terpenuhi: false },
  ];
  assert.equal(checklistSiapBerangkat(items, true), true);
  assert.equal(checklistSiapBerangkat(items, false), false, "item admin lengkap tapi Bukti Kelengkapan belum dikirim -> belum siap");
});

test("hitungItemBelum menghitung item wajib yang belum terpenuhi DITAMBAH 1 kalau Bukti Kelengkapan belum dikirim", () => {
  const items = [
    { required: true, terpenuhi: false },
    { required: true, terpenuhi: true },
    { required: false, terpenuhi: false },
  ];
  assert.equal(hitungItemBelum(items, true), 1);
  assert.equal(hitungItemBelum(items, false), 2);
  assert.equal(hitungItemBelum([], false), 1, "rute tanpa item admin tetap terhitung 1 (Bukti Kelengkapan) kalau belum dikirim");
  assert.equal(hitungItemBelum([], true), 0);
});

test("butuhFoto mencerminkan photoRequired item", () => {
  assert.equal(butuhFoto({ photoRequired: true }), true);
  assert.equal(butuhFoto({ photoRequired: false }), false);
  assert.equal(butuhFoto({}), false);
});
