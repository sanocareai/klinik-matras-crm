// DESKRIPSI BAHAN (9 Nov 2026) — Postgres SUNGGUHAN terisolasi, rute ASLI. Informasi saja: bisa diisi/diubah/dikosongkan, tercatat di jejak, tampil di daftar stok; tidak menyentuh saldo, harga, satuan, atau spesifikasi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { denganVerifikasiOtomatis } from "./setup/verifikasiOtomatis.js"; // non-ADMIN: pengajuan → diverifikasi ADMIN uji lain (jalur tulis yang sama)
import fs from "node:fs";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function akun(roles) { const u = await createTestUser({ roles }); return { ...u, c: denganVerifikasiOtomatis(makeClient(server.baseUrl, u.token), server.baseUrl) }; }
const TEKS = "Merek ABC. Dibeli per pack, 1 pack isi 12 pcs.\nDipakai per pcs.";

test("D1 Admin dan Gudang mengisi, mengubah, mengosongkan; tampil di daftar stok; jejak mencatat sebelum dan sesudah", async () => {
  const admin = await akun(["ADMIN"]); const gudang = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ unit: "PCS" });
  const a = await admin.c.patch(`/api/inventory/materials/${m.id}`, { description: `  ${TEKS}  ` });
  assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.description, TEKS);
  const stok = await admin.c.get("/api/inventory/stock");
  assert.equal(stok.body.find((x) => x.materialId === m.id).description, TEKS);
  const jejak = await testPrisma.activityEvent.findFirst({ where: { entityId: m.id, eventType: "MATERIAL_UPDATED" }, orderBy: { createdAt: "desc" } });
  assert.deepEqual(jejak.metadata.changes.description, { from: null, to: TEKS }); assert.equal(jejak.actorId, admin.user.id);
  assert.equal((await gudang.c.patch(`/api/inventory/materials/${m.id}`, { description: "Merek XYZ" })).body.description, "Merek XYZ");
  assert.equal((await admin.c.patch(`/api/inventory/materials/${m.id}`, { description: "" })).body.description, null);
});

test("D2 tanpa kolom deskripsi nilainya tidak berubah; buat bahan baru boleh langsung berdeskripsi", async () => {
  const admin = await akun(["ADMIN"]); const m = await createTestMaterial();
  await admin.c.patch(`/api/inventory/materials/${m.id}`, { description: TEKS });
  assert.equal((await admin.c.patch(`/api/inventory/materials/${m.id}`, { name: "Nama baru" })).body.description, TEKS);
  const baru = await admin.c.post("/api/inventory/materials", { code: `DSK-${Date.now()}`, name: "Benang A", unit: "PCS", description: TEKS });
  assert.equal(baru.status, 201, JSON.stringify(baru.body)); assert.equal(baru.body.description, TEKS);
  const tanpa = await admin.c.post("/api/inventory/materials", { code: `DSK2-${Date.now()}`, name: "Benang B", unit: "PCS" });
  assert.equal(tanpa.body.description, null);
});

test("D3 ditolak: terlalu panjang, bukan teks, tanpa izin tulis; nilai lama utuh", async () => {
  const admin = await akun(["ADMIN"]); const fin = await akun(["FINANCE"]); const sales = await akun(["SALES"]); const m = await createTestMaterial();
  await admin.c.patch(`/api/inventory/materials/${m.id}`, { description: "Awal" });
  assert.equal((await admin.c.patch(`/api/inventory/materials/${m.id}`, { description: "x".repeat(1001) })).status, 400);
  assert.equal((await admin.c.patch(`/api/inventory/materials/${m.id}`, { description: 12 })).status, 400);
  assert.equal((await fin.c.patch(`/api/inventory/materials/${m.id}`, { description: "Ubah" })).status, 403);
  assert.equal((await sales.c.patch(`/api/inventory/materials/${m.id}`, { description: "Ubah" })).status, 403);
  assert.equal((await testPrisma.material.findUnique({ where: { id: m.id } })).description, "Awal");
});

test("D4 informasi saja: saldo, pergerakan, jurnal, harga, satuan, dan spesifikasi tidak berubah; isi kemasan tidak menjadi konversi", async () => {
  const admin = await akun(["ADMIN"]); const m = await createTestMaterial({ unit: "PCS" }); await seedBalance(m.id, 10);
  await testPrisma.material.update({ where: { id: m.id }, data: { specification: "warna abu" } });
  const snap = async () => ({ gerak: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), harga: await testPrisma.materialHargaBerlaku.count(), adj: await testPrisma.stockAdjustmentRequest.count() });
  const s0 = await snap();
  await admin.c.patch(`/api/inventory/materials/${m.id}`, { description: TEKS });
  assert.deepEqual(await snap(), s0);
  const stok = (await admin.c.get("/api/inventory/stock")).body.find((x) => x.materialId === m.id);
  assert.equal(stok.balance, 10); assert.equal(stok.unit, "PCS"); assert.equal(stok.specification, "warna abu");
});

test("D5 deskripsi tidak dibaca deteksi SKU kembar maupun layanan SKU PO", () => {
  for (const f of ["../../src/lib/domain/kemiripanBarang.js", "../../src/services/finance/skuBaru.js"]) assert.ok(!/description/.test(fs.readFileSync(new URL(f, import.meta.url), "utf8")), f);
});
