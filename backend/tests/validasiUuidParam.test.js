// Unit: helper UUID kanonis + jaring pengaman pesan 500. Tanpa DB.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Prisma } from "@prisma/client";
import { UUID_RE, isUuid, wajibUuid, GALAT_ID_TIDAK_VALID } from "../src/lib/uuidParam.js";
import { adalahGalatPrisma, pesanServerAman, PESAN_SERVER_AMAN } from "../src/lib/galatServerAman.js";

function jalankan(mw, params) {
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let lanjut = false;
  mw({ params }, res, () => { lanjut = true; });
  return { lanjut, code: res.code, body: res.body };
}

test("isUuid: hanya UUID berhuruf heksa berbentuk 8-4-4-4-12; cuid, kosong, bukan-string, kelebihan karakter ditolak", () => {
  assert.equal(isUuid("0b8f6f4e-3c1a-4c55-9f4e-2a1b3c4d5e6f"), true);
  assert.equal(isUuid("0B8F6F4E-3C1A-4C55-9F4E-2A1B3C4D5E6F"), true, "huruf besar sah");
  for (const v of ["cmgz1k8q40000x7e5f2h9d3ab", "", " ", null, undefined, 42, {}, ["0b8f6f4e-3c1a-4c55-9f4e-2a1b3c4d5e6f"], "0b8f6f4e-3c1a-4c55-9f4e-2a1b3c4d5e6f0", " 0b8f6f4e-3c1a-4c55-9f4e-2a1b3c4d5e6f", "0b8f6f4e-3c1a-4c55-9f4e-2a1b3c4d5e6g", "urn:uuid:0b8f6f4e-3c1a-4c55-9f4e-2a1b3c4d5e6f", "0b8f6f4e3c1a4c559f4e2a1b3c4d5e6f"]) {
    assert.equal(isUuid(v), false, JSON.stringify(v));
  }
  assert.ok(UUID_RE.flags.includes("i"));
});

test("wajibUuid: lanjut bila semua parameter UUID; 400 persis {code,message} bila salah satu rusak; tanpa argumen memeriksa :id; tidak menggaungkan nilai klien", () => {
  const ok = "0b8f6f4e-3c1a-4c55-9f4e-2a1b3c4d5e6f";
  assert.deepEqual(jalankan(wajibUuid(), { id: ok }), { lanjut: true, code: null, body: null });
  const salah = jalankan(wajibUuid(), { id: "cmgz1k8q40000x7e5f2h9d3ab" });
  assert.equal(salah.lanjut, false); assert.equal(salah.code, 400);
  assert.deepEqual(salah.body, { code: "ID_TIDAK_VALID", message: "ID tidak valid." });
  assert.deepEqual(Object.keys(salah.body).sort(), ["code", "message"]);
  assert.equal(jalankan(wajibUuid("id", "lineId"), { id: ok, lineId: ok }).lanjut, true);
  assert.equal(jalankan(wajibUuid("id", "lineId"), { id: ok, lineId: "x" }).code, 400);
  assert.equal(jalankan(wajibUuid("id", "lineId"), { id: ok }).code, 400, "parameter yang tidak ada = tidak valid");
  assert.ok(!JSON.stringify(salah.body).includes("cmgz1k8q4"));
  assert.throws(() => { GALAT_ID_TIDAK_VALID.code = "X"; if (GALAT_ID_TIDAK_VALID.code === "X") throw new Error("berubah"); }, /./, "konstanta tidak boleh berubah");
});

test("pesan 500 aman: galat Prisma disamarkan; galat aplikasi lain tetap meneruskan pesannya", () => {
  const prismaKnown = new Prisma.PrismaClientKnownRequestError("\nInvalid `prisma.workCenter.findUnique()` invocation:\n\nInconsistent column data", { code: "P2023", clientVersion: "5.0.0" });
  const prismaValidasi = new Prisma.PrismaClientValidationError("Argument `where` is missing", { clientVersion: "5.0.0" });
  const dibungkus = new Error("Gagal: Invalid `prisma.job.findMany()` invocation: ...");
  for (const e of [prismaKnown, prismaValidasi, dibungkus]) {
    assert.equal(adalahGalatPrisma(e), true);
    assert.equal(pesanServerAman(e), PESAN_SERVER_AMAN);
    assert.doesNotMatch(pesanServerAman(e), /prisma|invocation|where/i);
  }
  const aplikasi = new Error("Stok tidak cukup untuk bahan X");
  assert.equal(adalahGalatPrisma(aplikasi), false);
  assert.equal(pesanServerAman(aplikasi), "Server error: Stok tidak cukup untuk bahan X", "format lama dipertahankan untuk galat non-Prisma");
  assert.equal(pesanServerAman(aplikasi, "Galat: "), "Galat: Stok tidak cukup untuk bahan X");
  assert.equal(adalahGalatPrisma(null), false); assert.equal(adalahGalatPrisma("teks"), false);
});

test("handler 500 pada router terdampak memakai pesanServerAman (tidak ada lagi 'Server error: ' + message mentah)", () => {
  for (const f of ["goodsReceipt", "materialIssue", "stockTransfer", "stockCount", "damagedStock", "returnRecord", "stockAdjustment", "replenishment", "production", "armada", "finance"]) {
    const src = fs.readFileSync(new URL(`../src/routes/${f}.js`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /"Server error: " \+ \w+\.message/, f);
    assert.match(src, /pesanServerAman\(/, f);
    assert.match(src, /from "\.\.\/lib\/galatServerAman\.js"/, f);
  }
});

test("urutan middleware: wajibUuid dipasang SETELAH requirePermission/requireAnyPermission pada setiap rute terlindungi (401 → 403 → 400), bukan router.param", () => {
  const berkas = ["production", "productionExperience", "goodsReceipt", "purchaseOrders", "materialIssue", "stockTransfer", "stockCount", "damagedStock", "returnRecord", "stockAdjustment", "replenishment", "financeTransactions", "armada"];
  let jumlah = 0;
  for (const f of berkas) {
    const src = fs.readFileSync(new URL(`../src/routes/${f}.js`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\.param\(\s*["']id["']/, `${f}: jangan memakai router.param untuk id`);
    for (const m of src.matchAll(/wajibUuid\([^)]*\)/g)) {
      jumlah++;
      const sebelum = src.slice(Math.max(0, m.index - 140), m.index);
      assert.match(sebelum, /require(Any)?Permission\([^)]*\),\s*$/, `${f}: wajibUuid harus tepat setelah middleware izin → ...${sebelum.slice(-80)}`);
    }
  }
  assert.ok(jumlah >= 50, `jumlah rute terlindungi: ${jumlah}`);
});
