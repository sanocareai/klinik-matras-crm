import test from "node:test";
import assert from "node:assert/strict";
import { checklistSiapBerangkat, hitungItemBelum, butuhFoto } from "./prepChecklistStatus.js";

test("checklistSiapBerangkat: true kalau tidak ada item wajib sama sekali (rute tanpa checklist)", () => {
  assert.equal(checklistSiapBerangkat([]), true);
  assert.equal(checklistSiapBerangkat([{ required: false, terpenuhi: false }]), true);
});

test("checklistSiapBerangkat: false kalau ADA item wajib yang belum terpenuhi", () => {
  const items = [
    { required: true, terpenuhi: true },
    { required: true, terpenuhi: false },
  ];
  assert.equal(checklistSiapBerangkat(items), false);
});

test("checklistSiapBerangkat: true kalau SEMUA item wajib sudah terpenuhi (item opsional yang belum tidak menahan)", () => {
  const items = [
    { required: true, terpenuhi: true },
    { required: false, terpenuhi: false },
  ];
  assert.equal(checklistSiapBerangkat(items), true);
});

test("hitungItemBelum menghitung HANYA item wajib yang belum terpenuhi", () => {
  const items = [
    { required: true, terpenuhi: false },
    { required: true, terpenuhi: true },
    { required: false, terpenuhi: false },
  ];
  assert.equal(hitungItemBelum(items), 1);
});

test("butuhFoto mencerminkan photoRequired item", () => {
  assert.equal(butuhFoto({ photoRequired: true }), true);
  assert.equal(butuhFoto({ photoRequired: false }), false);
  assert.equal(butuhFoto({}), false);
});
