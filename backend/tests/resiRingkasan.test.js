// Resi Gabungan Fase 1 — hitungan murni: Total Resi, DP 30% (termasuk Ongkir Tambahan), pembagian DP per item (jumlah tepat).
import test from "node:test";
import assert from "node:assert/strict";
import { hitungRingkasanResi, bagiProporsional, DP_PERSEN } from "../src/services/resi.js";

test("DP 30% dihitung dari Total Resi termasuk Ongkir Tambahan", () => {
  const r = hitungRingkasanResi({ hargaItem: [1_000_000, 500_000], ongkirTambahan: 100_000 });
  assert.equal(DP_PERSEN, 30);
  assert.equal(r.subtotal, 1_500_000);
  assert.equal(r.ongkirTambahan, 100_000);
  assert.equal(r.totalResi, 1_600_000);
  assert.equal(r.dp, 480_000);
  assert.equal(r.sisaSetelahDp, 1_120_000);
});

test("Ongkir Tambahan default Rp0; DP dari subtotal saja", () => {
  const r = hitungRingkasanResi({ hargaItem: [1_200_000, 1_200_000, 1_200_000] });
  assert.equal(r.ongkirTambahan, 0);
  assert.equal(r.totalResi, 3_600_000);
  assert.equal(r.dp, 1_080_000);
});

test("Pembagian DP per item selalu berjumlah tepat DP (largest remainder), tanpa nilai negatif", () => {
  for (const [harga, ongkir] of [[[1_000_000, 500_000, 250_001], 50_000], [[333_333, 333_333, 333_334], 0], [[1, 1, 1], 7], [[10_000_000], 0], [[999_999, 1], 123]]) {
    const r = hitungRingkasanResi({ hargaItem: harga, ongkirTambahan: ongkir });
    assert.equal(r.dpPerItem.reduce((s, x) => s + x, 0), r.dp, JSON.stringify({ harga, ongkir }));
    assert.ok(r.dpPerItem.every((x) => x >= 0 && Number.isInteger(x)));
    assert.equal(r.tagihanPerItem.reduce((s, x) => s + x, 0), r.totalResi, "Σ tagihan item = Total Resi (ongkir di item pertama)");
  }
});

test("Ongkir Tambahan melekat di item pertama (anchor) saja", () => {
  const r = hitungRingkasanResi({ hargaItem: [100, 200, 300], ongkirTambahan: 50 });
  assert.deepEqual(r.tagihanPerItem, [150, 200, 300]);
});

test("bagiProporsional: bobot nol / total nol aman", () => {
  assert.deepEqual(bagiProporsional(0, [1, 2]), [0, 0]);
  assert.deepEqual(bagiProporsional(10, [0, 0]), [0, 0]);
  assert.equal(bagiProporsional(100, [1, 1, 1]).reduce((s, x) => s + x, 0), 100);
});
