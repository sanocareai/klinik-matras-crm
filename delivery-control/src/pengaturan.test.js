import test from "node:test";
import assert from "node:assert/strict";
import { AUTO_LOCK_BAWAAN, PILIHAN_AUTO_LOCK, labelAutoLock, normalisasiAutoLock, normalisasiTema, temaEfektif } from "./lib/pengaturan.js";

test("tema: pilihan System/Terang/Gelap; nilai tak dikenal jatuh ke System; efektif mengikuti sistem hanya di mode System", () => {
  assert.equal(normalisasiTema("dark"), "dark");
  assert.equal(normalisasiTema("ungu"), "system");
  assert.equal(normalisasiTema(null), "system");
  assert.equal(temaEfektif("system", "dark"), "dark");
  assert.equal(temaEfektif("system", "light"), "light");
  assert.equal(temaEfektif("system", null), "light");
  assert.equal(temaEfektif("light", "dark"), "light");
  assert.equal(temaEfektif("dark", "light"), "dark");
});

test("auto-lock: hanya 1/2/5/15 menit; selain itu memakai bawaan 5", () => {
  assert.deepEqual(PILIHAN_AUTO_LOCK, [1, 2, 5, 15]);
  assert.equal(normalisasiAutoLock("15"), 15);
  assert.equal(normalisasiAutoLock(3), AUTO_LOCK_BAWAAN);
  assert.equal(normalisasiAutoLock(undefined), 5);
  assert.equal(labelAutoLock(2), "2 menit");
});
