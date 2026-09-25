import test from "node:test";
import assert from "node:assert/strict";
import { klasifikasiKegagalan } from "./integration/setup/failureClassifier.js";

const blok = (berkas, isi) => `test at ${berkas}:55:1\n✖ nama tes (7ms)\n  ${isi}\n      at foo\n\n`;

test("hanya kegagalan koneksi (P1001) yang diklasifikasikan sebagai koneksi", () => {
  const out = `ok\n✖ failing tests:\n\n${blok("tests\\integration\\a.integration.test.js", "PrismaClientInitializationError: Can't reach database server at `localhost:5432`")}${blok("tests\\integration\\a.integration.test.js", "Can't reach database server")}`;
  assert.deepEqual(klasifikasiKegagalan(out), { koneksi: ["tests/integration/a.integration.test.js"], lain: [] });
});

test("berkas dengan kegagalan campuran (koneksi + assertion) masuk 'lain' dan TIDAK diulang otomatis", () => {
  const out = `✖ failing tests:\n\n${blok("tests\\integration\\b.integration.test.js", "Can't reach database server")}${blok("tests\\integration\\b.integration.test.js", "AssertionError: 409 !== 200")}`;
  assert.deepEqual(klasifikasiKegagalan(out), { koneksi: [], lain: ["tests/integration/b.integration.test.js"] });
});

test("kegagalan bukan-koneksi (timeout transaksi, assertion) tidak pernah dianggap koneksi", () => {
  const out = `✖ failing tests:\n\n${blok("tests/integration/c.integration.test.js", "PrismaClientKnownRequestError: Transaction API error: Unable to start a transaction in the given time.")}`;
  assert.deepEqual(klasifikasiKegagalan(out), { koneksi: [], lain: ["tests/integration/c.integration.test.js"] });
});

test("tanpa bagian 'failing tests' = tidak ada klasifikasi", () => {
  assert.deepEqual(klasifikasiKegagalan("semua lulus"), { koneksi: [], lain: [] });
});

test("beberapa berkas: koneksi dan lain dipisah", () => {
  const out = `✖ failing tests:\n\n${blok("tests\\integration\\x.integration.test.js", "Can't reach database server")}${blok("tests\\integration\\y.integration.test.js", "AssertionError")}`;
  const r = klasifikasiKegagalan(out);
  assert.deepEqual(r.koneksi, ["tests/integration/x.integration.test.js"]);
  assert.deepEqual(r.lain, ["tests/integration/y.integration.test.js"]);
});
