// Unit: jumlah item Penjualan Karyawan boleh PECAHAN — parser ketat + aturan pembulatan tunggal (services/finance/penjualanKaryawanManual.js). Tanpa database.
import test from "node:test";
import assert from "node:assert/strict";
import { hitungItems, parseAngkaKetat, subtotalItem, bentukPenjualan } from "../src/services/finance/penjualanKaryawanManual.js";
import { Decimal } from "../src/services/finance/money.js";

const err = (m) => Object.assign(new Error(m), { statusCode: 400 });
const item = (quantity, unitPrice = 1000, name = "X") => ({ name, quantity, unitPrice });

test("Kasus layar Owner (6 item, HARDPAD 1,6): subtotal & total tepat Rp1.965.500", () => {
  const { items, total } = hitungItems([
    item(2, 49950, "LEM I-SR 1037 13 KG"), item(2, 110800, "BUSA OCEAN D18"), item(6, 86000, "LIST WIBING ABU"),
    item(12, 86000, "LIST WIBING COKLAT"), item("1.6", 35000, "HARDPAD FUJIPO"), item(2, 20000, "KAIN TABENG"),
  ], err);
  assert.equal(items.length, 6, "lebih dari 6 item tidak dibatasi");
  assert.equal(total.toFixed(2), "1965500.00");
  assert.equal(items[4].subtotal.toFixed(2), "56000.00");
  assert.equal(items[4].quantity.toFixed(3), "1.600");
});

test("Jumlah bulat lama menghasilkan angka IDENTIK dengan rumus lama (qty × harga)", () => {
  for (const [q, h] of [[1, 1_300_000], [2, 150_000], [13, 99_999.99], [1000, 1], [7, 0.01]]) {
    assert.equal(subtotalItem(h, q).toFixed(2), new Decimal(h).times(q).toFixed(2), `${q} × ${h}`);
  }
});

test("Aturan pembulatan TUNGGAL: HALF_UP per baris; total = Σ subtotal yang sudah dibulatkan", () => {
  // 0,5 × 12.345,67 = 6.172,835 → 6.172,84 (naik); dua baris = 12.345,68 (bukan 12.345,67 dari penjumlahan tak dibulatkan)
  const { items, total } = hitungItems([item("0.5", 12345.67), item("0.5", 12345.67)], err);
  assert.deepEqual(items.map((i) => i.subtotal.toFixed(2)), ["6172.84", "6172.84"]);
  assert.equal(total.toFixed(2), "12345.68");
  assert.equal(subtotalItem(100, "0.333").toFixed(2), "33.30");
  assert.equal(subtotalItem(10, "0.045").toFixed(2), "0.45", "0,45 tepat");
  assert.equal(subtotalItem(1, "0.005").toFixed(2), "0.01", "0,005 → naik ke 0,01 (HALF_UP)");
});

test("Input rusak DITOLAK: koma, pemisah ribuan, NaN/Infinity, eksponen, heks, negatif, nol, kosong, spasi, presisi >3, di atas batas", () => {
  const tolak = [
    "1,6", "1.600,5", "1.6.0", "NaN", NaN, Infinity, -Infinity, "Infinity", "1e3", 1e21, "0x10", "-1", -1, "+1", "0", 0, "0.000", "", " ", " 1", "1 ", ".5", "5.", null, undefined,
    {}, [], true, "1.2345", 0.1 + 0.2, "1001", 1001, "١٢٣", "１２",
  ];
  for (const q of tolak) assert.throws(() => hitungItems([item(q)], err), (e) => e.statusCode === 400, `harus ditolak: ${JSON.stringify(q)}`);
  for (const h of ["1,5", "NaN", "-5", "0", "", "100.123", null, 1e21, "1e3"]) assert.throws(() => hitungItems([item(1, h)], err), (e) => e.statusCode === 400, `harga harus ditolak: ${JSON.stringify(h)}`);
  assert.throws(() => hitungItems([item("0.001", 1)], err), /terlalu kecil/, "subtotal yang dibulatkan menjadi Rp0 ditolak");
});

test("Input sah: bulat, pecahan ≤3 desimal, number JSON maupun teks bertitik; batas 0,001 s.d. 1000", () => {
  for (const q of [1, "1", 1.6, "1.6", "0.001", "1000", "1000.000", "12.345", 0.5]) assert.doesNotThrow(() => hitungItems([item(q, 10_000)], err), JSON.stringify(q));
  assert.equal(parseAngkaKetat("1.600", { label: "J", maksDesimal: 3 }, err).toFixed(3), "1.600");
});

test("Bentuk tampilan: quantity number, subtotal memakai aturan yang SAMA dengan input (tidak mungkin berbeda)", () => {
  const p = bentukPenjualan({
    total: new Decimal("56000"), status: "AKTIF", payments: [], items: [{ id: "i", name: "HARDPAD", quantity: new Decimal("1.600"), unitPrice: new Decimal("35000"), sortOrder: 0 }],
  });
  assert.equal(p.items[0].quantity, 1.6);
  assert.equal(p.items[0].subtotal, 56000);
  assert.equal(p.total, 56000);
});

test("Batas jumlah item per dokumen tetap 50 (bukan 6)", () => {
  assert.doesNotThrow(() => hitungItems(Array.from({ length: 50 }, (_, i) => item(1, 1000, `item ${i}`)), err));
  assert.throws(() => hitungItems(Array.from({ length: 51 }, (_, i) => item(1, 1000, `item ${i}`)), err), /maksimal 50/);
});
