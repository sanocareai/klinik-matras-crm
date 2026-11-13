import test from "node:test";
import assert from "node:assert/strict";
import { urutanTabHidup, MAKS_TAB_HIDUP } from "../src/lib/tabHidup.js";

test("tab dipulihkan saat reload TIDAK ikut hidup — hanya tab aktif", () => {
  assert.deepEqual(urutanTabHidup([], "b", ["a", "b", "c", "d", "e"]), ["b"]);
});

test("tab yang dibuka ditambahkan di depan; urutan terbaru dulu", () => {
  let h = urutanTabHidup([], "a", ["a", "b", "c"]);
  h = urutanTabHidup(h, "b", ["a", "b", "c"]);
  h = urutanTabHidup(h, "a", ["a", "b", "c"]);
  assert.deepEqual(h, ["a", "b"]);
});

test("tab ditutup dibuang; batas maks membongkar yang paling lama tidak dibuka", () => {
  const ids = ["1", "2", "3", "4", "5", "6", "7", "8"];
  let h = [];
  for (const id of ids) h = urutanTabHidup(h, id, ids);
  assert.equal(h.length, MAKS_TAB_HIDUP);
  assert.deepEqual(h, ["8", "7", "6", "5", "4", "3"]);
  assert.deepEqual(urutanTabHidup(h, "8", ["8", "6", "3"]), ["8", "6", "3"]);
});

test("render berulang dengan tab aktif sama tidak mengubah apa pun (aman StrictMode)", () => {
  const h = ["b", "a"];
  assert.deepEqual(urutanTabHidup(urutanTabHidup(h, "b", ["a", "b"]), "b", ["a", "b"]), ["b", "a"]);
});
