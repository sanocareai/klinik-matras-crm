// Model baris bahan (BOM & pemakaian PIC Bahan): pola "+ Tambah baris", baris kosong terakhir tidak terkirim, validasi per baris & total.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  blankRow, fromRecord, isBlankRow, rowsPayload, sameAsSaved, totalsOf, validateMaterialRows, withTrailingBlank,
} from "../src/features/production/materialRows.js";

const row = (materialId = "", qty = "") => ({ key: `k-${materialId}-${qty}-${Math.random()}`, materialId, qty });

test("daftar kosong -> satu baris kosong; setelah baris terisi, baris kosong baru otomatis tersedia", () => {
  const empty = withTrailingBlank([]);
  assert.equal(empty.length, 1); assert.ok(isBlankRow(empty[0]));
  const filled = withTrailingBlank([{ ...empty[0], materialId: "m1", qty: "2" }]);
  assert.equal(filled.length, 2); assert.ok(isBlankRow(filled[1]));
  // tepat satu baris kosong, bukan bertambah terus
  assert.equal(withTrailingBlank(filled).length, 2);
});

test("baris setengah terisi tidak disusul baris kosong; kosong berlebih dipangkas", () => {
  const partial = withTrailingBlank([row("m1", "")]);
  assert.equal(partial.length, 1);
  const many = withTrailingBlank([row("m1", "1"), blankRow(), blankRow(), blankRow()]);
  assert.equal(many.length, 2);
});

test("baris kosong terakhir TIDAK ikut terkirim; jumlah koma desimal diterima", () => {
  const rows = withTrailingBlank([row("m1", "2"), row("m2", "1,5")]);
  assert.deepEqual(rowsPayload(rows), [{ materialId: "m1", qty: 2 }, { materialId: "m2", qty: 1.5 }]);
});

test("validasi: baris setengah terisi ditolak per baris (tidak dibuang diam-diam)", () => {
  const rows = [row("m1", "2"), row("m2", ""), row("", "3")];
  const v = validateMaterialRows(rows);
  assert.match(v.error, /Baris 2: isi jumlah/);
  assert.match(v.rowErrors[rows[2].key], /Baris 3: pilih bahan/);
});

test("validasi: duplikat bahan, jumlah <= 0, dan minimal satu bahan", () => {
  assert.match(validateMaterialRows([row("m1", "1"), row("m1", "2")]).error, /sudah ada di baris 1/);
  assert.match(validateMaterialRows([row("m1", "0")]).error, /lebih dari nol/);
  assert.match(validateMaterialRows([blankRow()]).error, /minimal satu bahan/);
  assert.equal(validateMaterialRows([blankRow()], { requireOne: false }).error, null);
});

test("mode pemakaian: tidak boleh melebihi yang diserahkan Gudang dan hanya bahan yang diserahkan", () => {
  const issued = { m1: 5 };
  const availableOf = (id) => (id in issued ? issued[id] : null);
  assert.equal(validateMaterialRows([row("m1", "5")], { availableOf }).error, null);
  assert.match(validateMaterialRows([row("m1", "6")], { availableOf }).error, /melebihi yang diserahkan Gudang \(maksimal 5\)/);
  assert.match(validateMaterialRows([row("zzz", "1")], { availableOf, labelOf: () => "Busa X" }).error, /Busa X bukan bahan yang diserahkan Gudang/);
});

test("total per satuan tidak menjumlahkan satuan berbeda; fromRecord/sameAsSaved", () => {
  const unit = { m1: "KG", m2: "KG", m3: "PCS" };
  const t = totalsOf([row("m1", "1,5"), row("m2", "2"), row("m3", "4"), blankRow()], (id) => unit[id]);
  assert.equal(t.count, 3);
  assert.deepEqual(t.byUnit, [{ unit: "KG", qty: 3.5 }, { unit: "PCS", qty: 4 }]);
  const saved = [{ materialId: "m1", qty: "2.0000" }, { materialId: "m2", qty: 1 }];
  const rows = fromRecord(saved);
  assert.equal(rows.length, 3); assert.ok(isBlankRow(rows[2]));
  assert.equal(sameAsSaved(rows, saved), true);
  assert.equal(sameAsSaved([...rows.slice(0, 1)], saved), false);
});

test("UI: PO-style '+ Tambah baris' dipakai di Rencana (BOM), Aplikasi PIC Bahan (BOM) dan pemakaian aktual; tanpa tombol 'Tambah Bahan' lama", () => {
  const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const rencana = read("pages/bengkel/ProductionRencanaWorkspace.jsx");
  assert.match(rencana, /<MaterialRowsEditor rows=\{rows\}/);
  assert.doesNotMatch(rencana, /\+ Tambah Bahan/);
  assert.match(read("features/production/workerApp/BomPlanSheet.jsx"), /<MaterialRowsEditor rows=\{rows\}/);
  const usage = read("features/production/workerApp/materialSheet.jsx");
  assert.match(usage, /<MaterialRowsEditor rows=\{rows\}/); assert.doesNotMatch(usage, /<MaterialLines /);
  const ed = read("features/production/components/MaterialRowsEditor.jsx");
  assert.match(ed, /data-testid="material-row-add"/); assert.match(ed, /Tambah baris/);
});
