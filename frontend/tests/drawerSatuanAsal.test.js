// Drawer riwayat Stok: baris pergerakan memakai SATUAN SAAT DICATAT (satuanCatat dari API), bukan satuan master sekarang. API lama tanpa field = satuan master (kompatibel).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatQty, UNIT_LABEL } from "../src/features/warehouse/inventoryReal.js";

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "features", "warehouse", "components", "ItemDetailDrawer.jsx"), "utf8").replace(/\r\n/g, "\n");

test("satuan baris = satuanCatat bila ada, selain itu satuan master (API lama tetap benar)", () => {
  assert.match(src, /const satuanBaris = m\.satuanCatat \|\| item\.unit;/);
  assert.match(src, /formatQty\(qty, satuanBaris\)/, "jumlah baris diformat dengan satuan baris, bukan satuan master");
  assert.doesNotMatch(src, /formatQty\(qty, item\.unit\)/, "tidak boleh ada format jumlah baris pergerakan dengan satuan master");
});

test("baris bersatuan lama diberi keterangan; baris satuan sekarang tidak", () => {
  assert.match(src, /m\.satuanCatat && m\.satuanCatat !== item\.unit && <span[^>]*data-testid="satuan-asal"/);
  assert.match(src, /Dicatat dalam .* \(satuan lama; saldo sekarang dalam /);
});

test("angka yang sama berlabel lain bila satuannya lain (14 ROLL ≠ 14 METER)", () => {
  assert.notEqual(formatQty(14, "ROLL"), formatQty(14, "METER"));
  assert.equal(formatQty(14, "ROLL"), `14 ${UNIT_LABEL.ROLL || "ROLL"}`); assert.equal(formatQty(900, "METER"), `900 ${UNIT_LABEL.METER || "METER"}`);
});

test("harga referensi Agustus: bahan bertransisi menampilkan 'Tidak berlaku pada satuan …' (tanpa angka), bukan harga per satuan lama", () => {
  assert.match(src, /item\.referensiTidakCocok \? <em data-testid="referensi-satuan-tidak-cocok">Tidak berlaku pada satuan/);
  assert.match(src, /item\.referenceUnitCost != null \? <>\{formatRupiah\(item\.referenceUnitCost\)\}/, "bahan tanpa transisi tetap menampilkan harga referensi");
});
