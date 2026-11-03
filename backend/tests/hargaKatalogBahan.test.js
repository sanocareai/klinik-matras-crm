// Harga Berlaku di katalog bahan (form pencatatan pemakaian) — murni, tanpa DB: hargaBerlakuBanyak memilih harga yang berlaku SEKARANG per bahan (koreksi menggantikan, jadwal masa depan terpisah, tanpa harga = tidak ada), satu query.
import test from "node:test";
import assert from "node:assert/strict";
import { hargaBerlakuBanyak } from "../src/services/finance/hargaBerlaku.js";

const baris = (o) => ({ id: o.id, materialId: o.m, unitPrice: o.p, effectiveFrom: new Date(o.dari), createdAt: new Date(o.dibuat ?? o.dari), correctsId: o.koreksi ?? null, evidenceNote: o.bukti ?? null });
const dbDari = (rows) => { let n = 0; return { n: () => n, materialHargaBerlaku: { findMany: async ({ where }) => { n += 1; assert.ok(where.materialId.in, "satu query dengan in"); return rows.filter((r) => where.materialId.in.includes(r.materialId)); } } }; };
const SEKARANG = new Date("2026-11-03T05:00:00Z");

test("harga yang berlaku sekarang per bahan; satu query untuk banyak bahan", async () => {
  const db = dbDari([baris({ id: "a1", m: "A", p: "10000", dari: "2026-10-01T00:00:00Z" }), baris({ id: "a2", m: "A", p: "12500", dari: "2026-10-20T00:00:00Z" }), baris({ id: "b1", m: "B", p: "300.5", dari: "2026-09-01T00:00:00Z", bukti: "faktur 123" })]);
  const p = await hargaBerlakuBanyak(db, ["A", "B", "C", "A", null], SEKARANG);
  assert.equal(db.n(), 1);
  assert.equal(p.get("A").harga, 12500, "harga terbaru yang sudah berlaku");
  assert.equal(p.get("B").harga, 300.5); assert.equal(p.get("B").label, "ADA_CATATAN_BUKTI");
  assert.equal(p.has("C"), false, "bahan tanpa harga tidak ada di peta (tidak ditebak, bukan 0)");
});

test("koreksi menggantikan baris asal; harga terjadwal TIDAK berlaku sekarang tetapi dilaporkan terpisah", async () => {
  const db = dbDari([
    baris({ id: "a1", m: "A", p: "10000", dari: "2026-10-01T00:00:00Z" }), baris({ id: "a1k", m: "A", p: "11000", dari: "2026-10-01T00:00:00Z", dibuat: "2026-10-02T00:00:00Z", koreksi: "a1" }),
    baris({ id: "a3", m: "A", p: "13000", dari: "2026-11-10T00:00:00Z" }),
  ]);
  const a = (await hargaBerlakuBanyak(db, ["A"], SEKARANG)).get("A");
  assert.equal(a.harga, 11000, "baris asal yang dikoreksi tidak dipakai");
  assert.equal(a.terjadwal.harga, 13000); assert.ok(new Date(a.terjadwal.berlakuMulai) > SEKARANG);
});

test("harga yang BARU berlaku di masa depan = belum ada harga sekarang; daftar kosong tanpa query", async () => {
  const db = dbDari([baris({ id: "x", m: "X", p: "500", dari: "2026-12-01T00:00:00Z" })]);
  assert.equal((await hargaBerlakuBanyak(db, ["X"], SEKARANG)).has("X"), false);
  const kosong = dbDari([]); assert.equal((await hargaBerlakuBanyak(kosong, [], SEKARANG)).size, 0); assert.equal(kosong.n(), 0);
});
