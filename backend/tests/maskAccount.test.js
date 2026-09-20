import test from "node:test";
import assert from "node:assert/strict";
import { maskAccountNumber } from "../src/utils/maskAccount.js";

test("hanya 4 digit terakhir yang tampil; format & spasi diabaikan", () => {
  assert.equal(maskAccountNumber("1234567890"), "••••7890");
  assert.equal(maskAccountNumber("123-456 789 0"), "••••7890");
  assert.equal(maskAccountNumber("1234"), "••••1234");
});
test("kosong/terlalu pendek/bukan angka → null (tidak membocorkan)", () => {
  for (const v of [null, undefined, "", "12", "abc", 0]) assert.equal(maskAccountNumber(v), null);
});
test("nomor lengkap tidak pernah muncul di hasil", () => {
  assert.ok(!maskAccountNumber("9876543210987").includes("98765432109"));
});
