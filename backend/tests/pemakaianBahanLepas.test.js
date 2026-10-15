// K5 — pintu pemakaian bahan lepas (unit/statis, tanpa database): pagar jenis, pagar dokumen induk, kabel pintu, dan larangan harga referensi/backfill.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bukukanNilaiPergerakanBaru } from "../src/services/finance/posting/inventory.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const baca = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const tanpaKomentar = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("hanya ISSUE/RETURN/WASTE yang masuk jalur lepas; ADJUSTMENT/RECEIPT/TRANSFER/tanpa id dilewati tanpa menyentuh tx", async () => {
  const tx = new Proxy({}, { get() { throw new Error("tx tidak boleh disentuh"); } });
  for (const type of ["ADJUSTMENT", "RECEIPT", "TRANSFER_OUT", "SUPPLIER_RETURN"]) {
    const r = await bukukanNilaiPergerakanBaru(tx, { id: "m1", type });
    assert.deepEqual([r.posted, r.reason], [false, "bukan_jalur_lepas"], type);
  }
  assert.equal((await bukukanNilaiPergerakanBaru(tx, { type: "ISSUE" })).reason, "bukan_jalur_lepas");
});

test("pergerakan berdokumen induk (Material Issue, penerimaan, opname, penyesuaian) tidak dibukukan per-baris — tidak ganda dengan jurnal dokumen", async () => {
  for (const induk of [{ materialIssueId: "d" }, { goodsReceiptId: "d" }, { stockCountId: "d" }, { stockAdjustmentRequestId: "d" }]) {
    const tx = { stockMovement: { findUnique: async () => ({ id: "m1", type: "ISSUE", createdAt: new Date(), materialIssueId: null, goodsReceiptId: null, stockCountId: null, stockAdjustmentRequestId: null, material: { code: "X", name: "x" }, ...induk }) } };
    const r = await bukukanNilaiPergerakanBaru(tx, { id: "m1", type: "ISSUE" });
    assert.deepEqual([r.posted, r.reason], [false, "punya_dokumen_induk"], JSON.stringify(induk));
  }
});

test("kabel pintu: units /materials, inventory issue/return/waste, dan penerimaan retur produksi memanggil jalur nilai di transaksi yang sama setelah postStockMovement", () => {
  const units = tanpaKomentar(baca("routes/units.js"));
  assert.equal((units.match(/bukukanNilaiPergerakanBaru\(tx,/g) || []).length, 1);
  const inv = tanpaKomentar(baca("routes/inventory.js"));
  assert.equal((inv.match(/bukukanNilaiPergerakanBaru\(tx,/g) || []).length, 3, "issue, return, waste");
  assert.ok(!/type: "ADJUSTMENT"[\s\S]{0,200}bukukanNilaiPergerakanBaru/.test(inv), "adjustment/opname tidak lewat jalur lepas");
  const retur = tanpaKomentar(baca("services/productionMaterialReturnService.js"));
  assert.equal((retur.match(/bukukanNilaiPergerakanBaru\(tx,/g) || []).length, 1);
  for (const f of ["routes/units.js", "routes/inventory.js", "services/productionMaterialReturnService.js"]) {
    const s = baca(f);
    for (const m of s.matchAll(/bukukanNilaiPergerakanBaru\(tx,/g)) {
      const sebelum = s.slice(Math.max(0, m.index - 600), m.index);
      assert.ok(/postStockMovement\(tx,/.test(sebelum), `${f}: pembukuan harus tepat setelah postStockMovement di transaksi yang sama`);
    }
  }
});

test("larangan: jalur nilai tidak memakai harga referensi Excel, tidak memindai/backfill pergerakan historis, tidak menulis stok", () => {
  const inv = tanpaKomentar(baca("services/finance/posting/inventory.js"));
  assert.ok(!/referenceUnitCost|reference_unit_cost|referenceStockValue/.test(inv), "harga referensi Excel bukan dasar jurnal");
  assert.ok(!/stockMovement\.(create|update|updateMany|delete|deleteMany)/.test(inv), "file posting tidak menulis stock_movements");
  const awal = inv.indexOf("export async function bukukanNilaiPergerakanBaru");
  const akhir = inv.indexOf("export async function postStockCountVariance");
  const badan = inv.slice(awal, akhir);
  assert.ok(!/findMany|\$queryRaw|for \(const .* of .*movements/.test(badan), "pintu baru hanya memproses SATU pergerakan yang diberikan, bukan pemindai historis");
});
