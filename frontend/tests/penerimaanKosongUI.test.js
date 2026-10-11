// Dokumen kosong lama (penerimaan PO berstatus maju tanpa kedatangan & tanpa jumlah): label, varian, dan kelayakan "Catat Barang Tiba" di kartu penerimaan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { labelPenerimaan, varianPenerimaan, penerimaanBelumTiba, LABEL_DOKUMEN_KOSONG, LABEL_PENERIMAAN } from "../src/features/kedatangan/kedatanganLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const panel = fs.readFileSync(path.join(dir, "../src/features/kedatangan/PanelKedatangan.jsx"), "utf8");

test("dokumen kosong lama: label & varian netral, BUKAN 'Siap disimpan'", () => {
  const r = { status: "READY_FOR_PUTAWAY", kosong: true, kedatanganDicatat: false };
  assert.equal(labelPenerimaan(r), LABEL_DOKUMEN_KOSONG);
  assert.notEqual(labelPenerimaan(r), LABEL_PENERIMAAN.READY_FOR_PUTAWAY);
  assert.equal(varianPenerimaan(r), "neutral");
});

test("penerimaan bermuatan tetap berlabel menurut status", () => {
  assert.equal(labelPenerimaan({ status: "READY_FOR_PUTAWAY", kosong: false }), "Siap disimpan");
  assert.equal(labelPenerimaan({ status: "ARRIVED" }), LABEL_PENERIMAAN.ARRIVED);
  assert.equal(varianPenerimaan({ status: "COMPLETED" }), "green");
});

test("Catat Barang Tiba tersedia untuk draf/terjadwal DAN dokumen kosong lama; tidak untuk yang sudah dicatat/masuk stok", () => {
  assert.equal(penerimaanBelumTiba({ status: "DRAFT", kedatanganDicatat: false }), true);
  assert.equal(penerimaanBelumTiba({ status: "SCHEDULED", kedatanganDicatat: false }), true);
  assert.equal(penerimaanBelumTiba({ status: "READY_FOR_PUTAWAY", kosong: true, kedatanganDicatat: false }), true);
  assert.equal(penerimaanBelumTiba({ status: "READY_FOR_PUTAWAY", kosong: false, kedatanganDicatat: false }), false, "bukan kosong: tidak bisa dicatat ulang");
  assert.equal(penerimaanBelumTiba({ status: "ARRIVED", kedatanganDicatat: true }), false);
  assert.equal(penerimaanBelumTiba({ status: "DRAFT", kedatanganDicatat: true }), false);
  assert.equal(penerimaanBelumTiba(null), false);
});

test("kartu & panel memakai helper itu (tidak ada lagi daftar status DRAFT/SCHEDULED di komponen)", () => {
  assert.match(panel, /const belumTiba = penerimaanBelumTiba\(r\);/);
  assert.match(panel, /<Badge variant=\{varianPenerimaan\(r\)\}>\{labelPenerimaan\(r\)\}<\/Badge>/);
  assert.match(panel, /po\.penerimaan\.some\(\(r\) => penerimaanBelumTiba\(r\)\)/);
  assert.doesNotMatch(panel, /\["DRAFT", "SCHEDULED"\]\.includes\(r\.status\)/);
});
