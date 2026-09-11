// Test integrasi — KONKURENSI NYATA terhadap PostgreSQL sungguhan.
//
// KENAPA FILE INI ADA: ledgerCore.integration.test.js dan
// documentFlows.integration.test.js membuktikan tiap request TUNGGAL benar
// (termasuk penolakan double-posting SEKUENSIAL — request kedua dikirim
// SETELAH request pertama selesai). Itu belum membuktikan yang paling
// penting dari lockRowForUpdate: bahwa DUA request yang BENAR-BENAR
// tumpang tindih waktu (dikirim nyaris bersamaan, dua koneksi Postgres
// berbeda) tidak bisa dua-duanya lolos cek "stok cukup" sebelum salah satu
// commit. SELECT SUM() biasa di luar lock TIDAK mencegah ini di level
// READ COMMITTED (default Postgres) — makanya lockMaterialBalance() WAJIB
// SELECT ... FOR UPDATE dulu. File ini mengirim request paralel sungguhan
// (Promise.all ke server HTTP nyata, bukan panggil fungsi langsung) supaya
// race window-nya nyata, bukan simulasi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUnit, createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { postStockMovement } from "../../src/services/inventoryLedger.js";

let server;
let client;

test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildTestApp());
  client = makeClient(server.baseUrl, null);
});
test.after(async () => {
  await truncateAll();
  await server.close();
  await testPrisma.$disconnect();
});
test.afterEach(async () => { await truncateAll(); });

test("Konkurensi nyata: dua POST /units/:id/materials PARALEL yang sama-sama 'sah' sendiri-sendiri TIDAK BOLEH dua-duanya lolos kalau totalnya melebihi saldo — saldo akhir tidak pernah negatif", async () => {
  const material = await createTestMaterial();
  await testPrisma.$transaction((tx) => postStockMovement(tx, { materialId: material.id, type: "RECEIPT", qty: 10 }));

  const { unit } = await createTestUnit();
  const { token } = await createTestUser({ roles: ["WAREHOUSE"] });
  const authedClient = makeClient(server.baseUrl, token);

  // Saldo = 10. Dua request paralel masing-masing minta 7 (ISSUE qty=7).
  // Dicek sendiri-sendiri di luar lock, keduanya "kelihatan" sah (7 <= 10)
  // — tapi 7 + 7 = 14 > 10, jadi TIDAK BOLEH dua-duanya berhasil.
  const [resA, resB] = await Promise.all([
    authedClient.post(`/api/units/${unit.id}/materials`, { materialId: material.id, qty: 7 }),
    authedClient.post(`/api/units/${unit.id}/materials`, { materialId: material.id, qty: 7 }),
  ]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [201, 400], "tepat satu request berhasil (201), satu ditolak karena stok tidak cukup (400) — bukan dua-duanya lolos, bukan dua-duanya ditolak");

  const rows = await testPrisma.stockMovement.findMany({ where: { materialId: material.id, type: "ISSUE" } });
  assert.equal(rows.length, 1, "hanya SATU baris ISSUE yang tertulis ke ledger — request yang ditolak tidak meninggalkan jejak");

  const balance = await testPrisma.$transaction((tx) =>
    tx.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${material.id}::uuid`
  );
  assert.equal(balance[0].balance, 3, "saldo akhir = 10 - 7 = 3, TIDAK PERNAH negatif walau dua request sama-sama 'kelihatan sah' saat dicek");
});

test("Konkurensi nyata: lock FOR UPDATE menyerialkan request paralel ke material yang SAMA — jumlah movement yang tertulis SELALU konsisten dengan hasil akhirnya, tidak ada partial/split write", async () => {
  const material = await createTestMaterial();
  await testPrisma.$transaction((tx) => postStockMovement(tx, { materialId: material.id, type: "RECEIPT", qty: 100 }));

  const { unit } = await createTestUnit();
  const { token } = await createTestUser({ roles: ["WAREHOUSE"] });
  const authedClient = makeClient(server.baseUrl, token);

  // 10 request paralel, masing-masing ISSUE qty=10 -> total persis 100,
  // semua HARUS berhasil (tidak ada kelebihan), dan urutan commit boleh
  // acak (itu tugas lock, bukan tugas test) tapi hasil akhirnya harus
  // deterministik: 10 baris ISSUE, saldo akhir 0.
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      authedClient.post(`/api/units/${unit.id}/materials`, { materialId: material.id, qty: 10 })
    )
  );
  assert.ok(results.every((r) => r.status === 201), `saldo persis cukup untuk semua 10 request paralel — semua harus berhasil, tidak ada yang salah ditolak akibat race. Statuses: ${JSON.stringify(results.map((r) => [r.status, r.body?.error]))}`);

  const rows = await testPrisma.stockMovement.findMany({ where: { materialId: material.id, type: "ISSUE" } });
  assert.equal(rows.length, 10);

  const balance = await testPrisma.$transaction((tx) =>
    tx.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${material.id}::uuid`
  );
  assert.equal(balance[0].balance, 0, "10 x issue 10 dari saldo 100 -> tepat 0, tidak kurang tidak lebih walau dieksekusi paralel");
});

test("Konkurensi nyata: dua percobaan putaway PARALEL pada Goods Receipt yang SAMA (double posting via race, bukan sekuensial) — cuma satu yang boleh menaikkan saldo", async () => {
  const material = await createTestMaterial();
  const { token } = await createTestUser({ roles: ["WAREHOUSE"] });
  const authedClient = makeClient(server.baseUrl, token);

  const create = await authedClient.post("/api/inventory/goods-receipts", {
    sourceType: "MANUAL", lines: [{ materialId: material.id, orderedQty: 20 }],
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const grId = create.body.id;
  for (const status of ["SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"]) {
    const r = await authedClient.patch(`/api/inventory/goods-receipts/${grId}`, { status });
    assert.equal(r.status, 200, `gagal maju ke ${status}: ${JSON.stringify(r.body)}`);
  }
  await authedClient.patch(`/api/inventory/goods-receipts/${grId}/lines/${create.body.lines[0].id}`, { acceptedQty: 20 });

  const [resA, resB] = await Promise.all([
    authedClient.post(`/api/inventory/goods-receipts/${grId}/putaway`, {}),
    authedClient.post(`/api/inventory/goods-receipts/${grId}/putaway`, {}),
  ]);

  const statuses = [resA.status, resB.status].sort((a, b) => a - b);
  assert.equal(statuses[0], 200, "salah satu request putaway paralel harus berhasil");
  assert.notEqual(resA.status === 200 && resB.status === 200, true, "TIDAK BOLEH dua-duanya berhasil — itu double posting lewat race, bukan cuma sekuensial");

  const rows = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: grId } });
  assert.equal(rows.length, 1, "hanya satu baris RECEIPT walau dua request putaway dikirim nyaris bersamaan");

  const balance = await testPrisma.$transaction((tx) =>
    tx.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${material.id}::uuid`
  );
  assert.equal(balance[0].balance, 20, "saldo naik TEPAT sekali (20), bukan dua kali (40)");
});
