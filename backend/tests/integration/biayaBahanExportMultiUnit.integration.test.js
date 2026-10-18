// EXPORT BIAYA BAHAN — ORDER MULTI-UNIT (kasus Indra, Okt 2026): 3 kasur sejenis dalam 1 order. Bahan baru dicatat untuk sebagian unit → unit yang BELUM ber-bahan harus tetap
// terlihat di Excel (status "Belum ada pemakaian bahan", nilai kosong — bukan Rp0), bukan menghilang sehingga order tampak hanya 1 baris. Baca-saja; tidak menulis apa pun.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial } from "./setup/fixtures.js";
import modul from "../../src/services/finance/export/biaya-bahan.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

async function orderMulti({ nomor, jumlahUnit, batal = 0 }) {
  const c = await testPrisma.customer.create({ data: { name: `Pelanggan ${nomor}` } });
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: 0, orderNumber: nomor } });
  const units = [];
  for (let i = 1; i <= jumlahUnit; i++) units.push(await testPrisma.unit.create({ data: { unitCode: `${nomor}-U${i}`, orderId: o.id, seq: i, status: i > jumlahUnit - batal ? "CANCELLED" : "RECEIVED" } }));
  return { o, units };
}
const issue = (materialId, unitId, qty = 2) => testPrisma.stockMovement.create({ data: { materialId, type: "ISSUE", qty: -qty, unitId } });
const sheet = (data, nama) => data.sheets.find((s) => s.nama === nama);

test("order 3 unit, bahan baru tercatat untuk 1 unit → Excel memuat 3 baris: 1 ber-bahan + 2 'Belum ada pemakaian bahan' (kosong, bukan Rp0); unit dibatalkan tidak ikut", async () => {
  const lem = await createTestMaterial({ code: "LEM-X", name: "Lem uji", unit: "KG" });
  const m = await orderMulti({ nomor: "NEW-UJI-001", jumlahUnit: 4, batal: 1 }); // 3 aktif + 1 dibatalkan
  await issue(lem.id, m.units[0].id);
  const sebelum = await testPrisma.stockMovement.count();

  const data = await modul.ambil(testPrisma, { filter: {} });
  const r = sheet(data, "Ringkasan per Unit");
  assert.equal(r.baris.length, 3, "semua unit aktif order tampil, bukan hanya yang ber-bahan");
  const berBahan = r.baris.filter((b) => b.status !== "Belum ada pemakaian bahan");
  const kosong = r.baris.filter((b) => b.status === "Belum ada pemakaian bahan");
  assert.equal(berBahan.length, 1); assert.equal(berBahan[0].unit, "NEW-UJI-001-U1");
  assert.deepEqual(kosong.map((b) => b.unit).sort(), ["NEW-UJI-001-U2", "NEW-UJI-001-U3"]);
  for (const b of kosong) { assert.equal(b.totalBiaya, null); assert.equal(b.nilaiBersih, null); assert.equal(b.order, "NEW-UJI-001"); }
  assert.ok(r.baris.every((b) => b.unitOrder === "1 dari 3 unit ber-bahan"), r.baris.map((b) => b.unitOrder).join("|"));
  assert.ok(!r.baris.some((b) => b.unit === "NEW-UJI-001-U4"), "unit dibatalkan tidak ditampilkan");
  assert.ok(r.kolom.some((k) => k.key === "unitOrder"));
  assert.match(r.total.label, /1 unit ber-bahan, 2 unit lain belum ada pemakaian/);
  assert.ok(r.catatan.some((c) => /2 unit pada order multi-unit belum punya pemakaian bahan/.test(c)));
  assert.equal(await testPrisma.stockMovement.count(), sebelum, "export tidak menulis");
});

test("order 3 unit semuanya ber-bahan → 3 baris ber-bahan, tanpa baris 'Belum ada'; order 1 unit tidak berubah; filter q hanya order itu", async () => {
  const lem = await createTestMaterial({ code: "LEM-Y", name: "Lem uji Y", unit: "KG" });
  const a = await orderMulti({ nomor: "NEW-UJI-002", jumlahUnit: 3 });
  const b = await orderMulti({ nomor: "RES-UJI-003", jumlahUnit: 1 });
  for (const u of a.units) await issue(lem.id, u.id);
  await issue(lem.id, b.units[0].id);

  const semua = sheet(await modul.ambil(testPrisma, { filter: {} }), "Ringkasan per Unit");
  assert.equal(semua.baris.length, 4);
  assert.ok(!semua.baris.some((x) => x.status === "Belum ada pemakaian bahan"));
  assert.ok(semua.baris.filter((x) => x.order === "NEW-UJI-002").every((x) => x.unitOrder === "3 dari 3 unit ber-bahan"));
  assert.equal(semua.baris.find((x) => x.order === "RES-UJI-003").unitOrder, "1 dari 1 unit ber-bahan");
  assert.doesNotMatch(semua.total.label, /belum ada pemakaian/);

  const saring = sheet(await modul.ambil(testPrisma, { filter: { q: "RES-UJI-003" } }), "Ringkasan per Unit");
  assert.equal(saring.baris.length, 1);
});
