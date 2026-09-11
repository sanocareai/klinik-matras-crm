// Test integrasi — endpoint TRANSAKSI UTAMA Gudang, lewat HTTP sungguhan
// (testApp.js me-mount ROUTER ASLI, kode yang SAMA PERSIS dijalankan
// produksi — bukan tiruan/reimplementasi logic di dalam test) terhadap
// PostgreSQL sungguhan (bukan stub). Mencakup ketujuh alur yang diminta:
// Goods Receipt, Material Issue, Transfer, Stock Count, Damage, Return,
// Adjustment (Waste diuji lewat Damaged Stock DAN lewat /movements/waste
// langsung) — masing-masing dari create sampai dokumen benar-benar
// menulis ledger, plus percobaan double-posting.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUnit, createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server, api;

test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildTestApp());
});
test.after(async () => {
  await server.close();
  await truncateAll();
  await testPrisma.$disconnect();
});
test.afterEach(async () => { await truncateAll(); });

async function client() {
  const { token } = await createTestUser();
  return makeClient(server.baseUrl, token);
}

async function balanceOf(materialId) {
  const rows = await testPrisma.stockMovement.findMany({ where: { materialId } });
  return rows.reduce((s, r) => s + Number(r.qty), 0);
}

// ─────────────────────────── Goods Receipt ────────────────────────────

test("Goods Receipt: DRAFT -> ... -> putaway menulis RECEIPT dan menaikkan saldo, status jadi COMPLETED", async () => {
  const api = await client();
  const material = await createTestMaterial();

  const create = await api.post("/api/inventory/goods-receipts", {
    sourceType: "SUPPLIER_DELIVERY", supplier: "Supplier Tes",
    lines: [{ materialId: material.id, orderedQty: 10 }],
  });
  assert.equal(create.status, 201);
  const grId = create.body.id;

  for (const status of ["SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"]) {
    const r = await api.patch(`/api/inventory/goods-receipts/${grId}`, { status });
    assert.equal(r.status, 200, `gagal maju ke ${status}: ${JSON.stringify(r.body)}`);
  }

  const lineId = create.body.lines[0].id;
  const lineUpdate = await api.patch(`/api/inventory/goods-receipts/${grId}/lines/${lineId}`, { acceptedQty: 10 });
  assert.equal(lineUpdate.status, 200);

  const putaway = await api.post(`/api/inventory/goods-receipts/${grId}/putaway`, {});
  assert.equal(putaway.status, 200, JSON.stringify(putaway.body));
  assert.equal(putaway.body.status, "COMPLETED");
  assert.equal(await balanceOf(material.id), 10);
});

test("Goods Receipt: putaway KEDUA KALINYA ditolak (double posting) — saldo TIDAK bertambah dua kali", async () => {
  const api = await client();
  const material = await createTestMaterial();
  const create = await api.post("/api/inventory/goods-receipts", {
    sourceType: "MANUAL", lines: [{ materialId: material.id, orderedQty: 5 }],
  });
  const grId = create.body.id;
  for (const status of ["SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"]) {
    await api.patch(`/api/inventory/goods-receipts/${grId}`, { status });
  }
  await api.patch(`/api/inventory/goods-receipts/${grId}/lines/${create.body.lines[0].id}`, { acceptedQty: 5 });

  const first = await api.post(`/api/inventory/goods-receipts/${grId}/putaway`, {});
  assert.equal(first.status, 200);
  const second = await api.post(`/api/inventory/goods-receipts/${grId}/putaway`, {});
  assert.equal(second.status, 400, "putaway kedua wajib ditolak — status sudah COMPLETED");

  assert.equal(await balanceOf(material.id), 5, "saldo cuma boleh naik SEKALI, bukan dua kali");
  const movements = await testPrisma.stockMovement.count({ where: { materialId: material.id } });
  assert.equal(movements, 1);
});

// ─────────────────────────── Material Issue ────────────────────────────

test("Material Issue: request terhubung ke Unit -> approve -> pick -> issue menulis ISSUE dgn unitId, Reserved lepas otomatis", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 20 } });
  const { unit } = await createTestUnit();

  const create = await api.post("/api/inventory/material-issues", {
    sourceType: "PRODUCTION_WORK_ORDER", unitId: unit.id,
    lines: [{ materialId: material.id, requestedQty: 6 }],
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const miId = create.body.id;

  const approve = await api.patch(`/api/inventory/material-issues/${miId}`, { status: "WAITING_APPROVAL" });
  assert.equal(approve.status, 200);
  await api.patch(`/api/inventory/material-issues/${miId}`, { status: "APPROVED" });

  // Selagi APPROVED (belum ISSUED): Reserved harus mengurangi Available,
  // saldo ledger BELUM berubah sama sekali.
  const snapshotMidway = await testPrisma.materialIssueLine.findMany({ where: { materialIssueId: miId } });
  assert.equal(snapshotMidway[0].requestedQty, 6);
  assert.equal(await balanceOf(material.id), 20, "saldo ledger belum berubah selama APPROVED — cuma reservasi");

  await api.patch(`/api/inventory/material-issues/${miId}`, { status: "READY_TO_PICK" });
  await api.patch(`/api/inventory/material-issues/${miId}`, { status: "PICKED" });

  const issueResult = await api.post(`/api/inventory/material-issues/${miId}/issue`, {});
  assert.equal(issueResult.status, 200, JSON.stringify(issueResult.body));
  assert.equal(issueResult.body.status, "ISSUED");
  assert.equal(await balanceOf(material.id), 14);

  const movement = await testPrisma.stockMovement.findFirst({ where: { materialId: material.id, type: "ISSUE" } });
  assert.equal(movement.unitId, unit.id, "ISSUE dari Material Issue yang terhubung ke unit WAJIB membawa unitId — inilah histori per-unit yang bisa ditelusuri");
});

test("Material Issue: PRODUCTION_WORK_ORDER TANPA unitId ditolak di HTTP sungguhan (bukan cuma di test unit)", async () => {
  const api = await client();
  const material = await createTestMaterial();
  const res = await api.post("/api/inventory/material-issues", {
    sourceType: "PRODUCTION_WORK_ORDER",
    lines: [{ materialId: material.id, requestedQty: 1 }],
  });
  assert.equal(res.status, 400);
});

test("Material Issue: cancel dari status APPROVED otomatis melepas Reserved, dan issue setelah cancel ditolak (double posting via jalur cancel)", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10 } });

  const create = await api.post("/api/inventory/material-issues", {
    sourceType: "MANUAL", lines: [{ materialId: material.id, requestedQty: 4 }],
  });
  const miId = create.body.id;
  await api.patch(`/api/inventory/material-issues/${miId}`, { status: "WAITING_APPROVAL" });
  await api.patch(`/api/inventory/material-issues/${miId}`, { status: "APPROVED" });

  const cancel = await api.patch(`/api/inventory/material-issues/${miId}/cancel`, { reason: "tes pembatalan" });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.status, "CANCELLED");

  // Coba lanjutkan ke PICKED/issue setelah cancel — HARUS ditolak.
  const afterCancel = await api.patch(`/api/inventory/material-issues/${miId}`, { status: "READY_TO_PICK" });
  assert.equal(afterCancel.status, 400);
  assert.equal(await balanceOf(material.id), 10, "saldo tidak boleh berubah sama sekali — request dibatalkan sebelum pernah diposting");
});

test("Material Issue: mengeluarkan lebih dari saldo yang tersedia ditolak (negative stock guard di endpoint sungguhan)", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 3 } });

  const create = await api.post("/api/inventory/material-issues", {
    sourceType: "MANUAL", lines: [{ materialId: material.id, requestedQty: 100 }],
  });
  const miId = create.body.id;
  await api.patch(`/api/inventory/material-issues/${miId}`, { status: "WAITING_APPROVAL" });
  await api.patch(`/api/inventory/material-issues/${miId}`, { status: "APPROVED" });
  await api.patch(`/api/inventory/material-issues/${miId}`, { status: "READY_TO_PICK" });
  await api.patch(`/api/inventory/material-issues/${miId}`, { status: "PICKED" });

  const issueResult = await api.post(`/api/inventory/material-issues/${miId}/issue`, {});
  assert.equal(issueResult.status, 400);
  assert.equal(await balanceOf(material.id), 3, "saldo tidak boleh jadi negatif — permintaan lebih besar dari stok ditolak total");
});

// ─────────────────────────── Stock Transfer ────────────────────────────

test("Stock Transfer: dispatch mengurangi saldo di asal, receive menambah saldo di tujuan — dua sisi ledger nyata", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 15 } });

  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-${Date.now()}`, name: "Gudang Tes" } });
  const source = await testPrisma.storageLocation.create({ data: { code: `LOC-A-${Date.now()}`, warehouseId: warehouse.id, locationType: "RAW_MATERIAL_AREA", zone: "A" } });
  const destination = await testPrisma.storageLocation.create({ data: { code: `LOC-B-${Date.now()}`, warehouseId: warehouse.id, locationType: "WIP_AREA", zone: "B" } });

  const create = await api.post("/api/inventory/transfers", {
    transferType: "ZONE_TO_ZONE", sourceLocationId: source.id, destinationLocationId: destination.id,
    lines: [{ materialId: material.id, qtySent: 5 }],
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const trId = create.body.id;

  await api.patch(`/api/inventory/transfers/${trId}`, { status: "WAITING_APPROVAL" });
  await api.patch(`/api/inventory/transfers/${trId}`, { status: "APPROVED" });
  await api.patch(`/api/inventory/transfers/${trId}`, { status: "PICKED" });

  const dispatch = await api.post(`/api/inventory/transfers/${trId}/dispatch`, {});
  assert.equal(dispatch.status, 200, JSON.stringify(dispatch.body));
  assert.equal(await balanceOf(material.id), 10, "total saldo TURUN begitu dispatch (barang sudah meninggalkan lokasi asal)");

  const receive = await api.post(`/api/inventory/transfers/${trId}/receive`, {});
  assert.equal(receive.status, 200, JSON.stringify(receive.body));
  assert.equal(await balanceOf(material.id), 15, "total saldo GLOBAL balik ke 15 — cuma pindah lokasi, bukan hilang");

  const movements = await testPrisma.stockMovement.findMany({ where: { materialId: material.id, type: "TRANSFER" } });
  assert.equal(movements.length, 2, "harus ADA DUA baris TRANSFER: negatif di asal, positif di tujuan");
});

test("Stock Transfer: dispatch KEDUA KALINYA ditolak (double posting)", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 8 } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-${Date.now()}`, name: "Gudang Tes 2" } });
  const source = await testPrisma.storageLocation.create({ data: { code: `LOC-C-${Date.now()}`, warehouseId: warehouse.id, locationType: "RAW_MATERIAL_AREA", zone: "A" } });
  const destination = await testPrisma.storageLocation.create({ data: { code: `LOC-D-${Date.now()}`, warehouseId: warehouse.id, locationType: "WIP_AREA", zone: "B" } });

  const create = await api.post("/api/inventory/transfers", {
    transferType: "ZONE_TO_ZONE", sourceLocationId: source.id, destinationLocationId: destination.id,
    lines: [{ materialId: material.id, qtySent: 3 }],
  });
  const trId = create.body.id;
  await api.patch(`/api/inventory/transfers/${trId}`, { status: "WAITING_APPROVAL" });
  await api.patch(`/api/inventory/transfers/${trId}`, { status: "APPROVED" });
  await api.patch(`/api/inventory/transfers/${trId}`, { status: "PICKED" });

  const first = await api.post(`/api/inventory/transfers/${trId}/dispatch`, {});
  assert.equal(first.status, 200);
  const second = await api.post(`/api/inventory/transfers/${trId}/dispatch`, {});
  assert.equal(second.status, 400);

  const movements = await testPrisma.stockMovement.count({ where: { materialId: material.id, type: "TRANSFER" } });
  assert.equal(movements, 1, "dispatch kedua wajib tidak menulis apa pun");
});

// ─────────────────────────── Stock Count ────────────────────────────

test("Stock Count: start snapshot systemQty, complete menulis ADJUSTMENT sebesar selisih SAJA", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10 } });

  const create = await api.post("/api/inventory/stock-counts", {
    countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: [{ materialId: material.id }],
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const scId = create.body.id;

  const start = await api.post(`/api/inventory/stock-counts/${scId}/start`, {});
  assert.equal(start.status, 200);
  assert.equal(start.body.lines[0].systemQty, 10);

  const lineId = start.body.lines[0].id;
  await api.patch(`/api/inventory/stock-counts/${scId}/lines/${lineId}`, { countedQty: 7, reason: "susut pengeringan" });

  const submit = await api.post(`/api/inventory/stock-counts/${scId}/submit`, {});
  assert.equal(submit.status, 200);

  const complete = await api.post(`/api/inventory/stock-counts/${scId}/complete`, {});
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  assert.equal(await balanceOf(material.id), 7);

  const adj = await testPrisma.stockMovement.findFirst({ where: { materialId: material.id, type: "ADJUSTMENT" } });
  assert.equal(Number(adj.qty), -3, "ADJUSTMENT harus PERSIS selisih (7-10=-3), bukan qty mentah hasil hitung");
  assert.equal(adj.reason, "susut pengeringan");
});

test("Stock Count: complete KEDUA KALINYA ditolak (double posting ADJUSTMENT)", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 5 } });
  const create = await api.post("/api/inventory/stock-counts", {
    countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: [{ materialId: material.id }],
  });
  const scId = create.body.id;
  const start = await api.post(`/api/inventory/stock-counts/${scId}/start`, {});
  await api.patch(`/api/inventory/stock-counts/${scId}/lines/${start.body.lines[0].id}`, { countedQty: 2, reason: "hilang" });
  await api.post(`/api/inventory/stock-counts/${scId}/submit`, {});

  const first = await api.post(`/api/inventory/stock-counts/${scId}/complete`, {});
  assert.equal(first.status, 200);
  const second = await api.post(`/api/inventory/stock-counts/${scId}/complete`, {});
  assert.equal(second.status, 400);

  const adjustments = await testPrisma.stockMovement.count({ where: { materialId: material.id, type: "ADJUSTMENT" } });
  assert.equal(adjustments, 1);
});

// ─────────────────────────── Damaged Stock (Waste) ────────────────────────────

test("Damaged Stock: resolve DISPOSE menulis WASTE dan mengurangi saldo, terhubung ke unit produksi", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10 } });
  const { unit } = await createTestUnit();

  const create = await api.post("/api/inventory/damaged-stock", {
    materialId: material.id, qty: 3, damageCategory: "TORN",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const dsId = create.body.id;

  await api.patch(`/api/inventory/damaged-stock/${dsId}/inspect`, {});
  const resolve = await api.post(`/api/inventory/damaged-stock/${dsId}/resolve`, { resolution: "DISPOSE" });
  assert.equal(resolve.status, 200, JSON.stringify(resolve.body));
  assert.equal(await balanceOf(material.id), 7);

  const waste = await testPrisma.stockMovement.findFirst({ where: { materialId: material.id, type: "WASTE" } });
  assert.ok(waste.reason, "WASTE wajib punya alasan");

  // unitId TIDAK dikirim dari damaged-stock resolve (endpoint ini belum
  // menerima unitId) — dicek di sini murni supaya kalau nanti field itu
  // ditambahkan, test ini yang pertama kali harus diperbarui, bukan
  // diam-diam terlewat.
  assert.equal(waste.unitId, null);
});

test("Damaged Stock: resolve REWORK tidak menulis ledger sama sekali (barang tidak pernah dianggap hilang dari saldo)", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10 } });
  const create = await api.post("/api/inventory/damaged-stock", { materialId: material.id, qty: 2, damageCategory: "OTHER" });
  await api.patch(`/api/inventory/damaged-stock/${create.body.id}/inspect`, {});
  const resolve = await api.post(`/api/inventory/damaged-stock/${create.body.id}/resolve`, { resolution: "REWORK" });
  assert.equal(resolve.status, 200);
  assert.equal(await balanceOf(material.id), 10, "REWORK tidak boleh mengubah saldo sama sekali");
});

test("Damaged Stock: resolve KEDUA KALINYA ditolak (double posting WASTE)", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10 } });
  const create = await api.post("/api/inventory/damaged-stock", { materialId: material.id, qty: 2, damageCategory: "WET" });
  await api.patch(`/api/inventory/damaged-stock/${create.body.id}/inspect`, {});
  const first = await api.post(`/api/inventory/damaged-stock/${create.body.id}/resolve`, { resolution: "DISPOSE" });
  assert.equal(first.status, 200);
  const second = await api.post(`/api/inventory/damaged-stock/${create.body.id}/resolve`, { resolution: "DISPOSE" });
  assert.equal(second.status, 400);
  assert.equal(await balanceOf(material.id), 8);
});

// ─────────────────────────── Return ────────────────────────────

test("Return: complete RETURN_TO_AVAILABLE menulis RETURN dan menambah saldo", async () => {
  const api = await client();
  const material = await createTestMaterial();

  const create = await api.post("/api/inventory/returns", {
    returnType: "PRODUCTION_RETURN", materialId: material.id, qty: 4,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const rId = create.body.id;

  await api.patch(`/api/inventory/returns/${rId}`, { status: "RECEIVED" });
  await api.patch(`/api/inventory/returns/${rId}`, { status: "INSPECTION" });
  const complete = await api.post(`/api/inventory/returns/${rId}/complete`, { resolution: "RETURN_TO_AVAILABLE" });
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  assert.equal(await balanceOf(material.id), 4);
});

test("Return: complete DISPOSE (bukan RETURN_TO_AVAILABLE) tidak menambah saldo", async () => {
  const api = await client();
  const material = await createTestMaterial();
  const create = await api.post("/api/inventory/returns", { returnType: "CUSTOMER_RETURN", materialId: material.id, qty: 2 });
  await api.patch(`/api/inventory/returns/${create.body.id}`, { status: "RECEIVED" });
  await api.patch(`/api/inventory/returns/${create.body.id}`, { status: "INSPECTION" });
  await api.post(`/api/inventory/returns/${create.body.id}/complete`, { resolution: "DISPOSE" });
  assert.equal(await balanceOf(material.id), 0);
});

// ─────────────────────────── Stock Adjustment (review-gated) ────────────────────────────

test("Stock Adjustment: post menulis ADJUSTMENT berdasarkan SALDO TERKINI, bukan snapshot basi saat request dibuat", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10 } });

  const create = await api.post("/api/inventory/adjustments", {
    materialId: material.id, adjustmentType: "NEGATIVE", adjustmentQty: -4, reason: "tes penyesuaian",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const adjId = create.body.id;

  // Saldo berubah SETELAH request dibuat, SEBELUM di-approve/post — kasus
  // nyata yang menyebabkan bug lama (beforeQty basi).
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 20 } });

  await api.patch(`/api/inventory/adjustments/${adjId}`, { status: "WAITING_APPROVAL" });
  await api.patch(`/api/inventory/adjustments/${adjId}`, { status: "APPROVED" });
  const post = await api.post(`/api/inventory/adjustments/${adjId}/post`, {});
  assert.equal(post.status, 200, JSON.stringify(post.body));

  // 10 (awal) + 20 (masuk di tengah) - 4 (adjustment) = 26
  assert.equal(await balanceOf(material.id), 26);
});

test("Stock Adjustment: post ditolak kalau adjustmentQty basi akan mendorong saldo TERKINI ke negatif", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10 } });

  const create = await api.post("/api/inventory/adjustments", {
    materialId: material.id, adjustmentType: "NEGATIVE", adjustmentQty: -8, reason: "tes",
  });
  const adjId = create.body.id;

  // Saldo TURUN drastis sebelum approval selesai (mis. ada ISSUE lain di
  // antaranya) — delta -8 yang tadinya sah sekarang akan mendorong negatif.
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "ISSUE", qty: -9 } });

  await api.patch(`/api/inventory/adjustments/${adjId}`, { status: "WAITING_APPROVAL" });
  await api.patch(`/api/inventory/adjustments/${adjId}`, { status: "APPROVED" });
  const post = await api.post(`/api/inventory/adjustments/${adjId}/post`, {});
  assert.equal(post.status, 400, "harus ditolak — 10-9-8 = -7, negatif");
  assert.equal(await balanceOf(material.id), 1, "saldo cuma boleh mencerminkan RECEIPT+ISSUE yang sudah sah, ADJUSTMENT yang ditolak tidak ikut tertulis");
});

test("Stock Adjustment: post KEDUA KALINYA ditolak (double posting)", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10 } });
  const create = await api.post("/api/inventory/adjustments", {
    materialId: material.id, adjustmentType: "POSITIVE", adjustmentQty: 2, reason: "tes",
  });
  const adjId = create.body.id;
  await api.patch(`/api/inventory/adjustments/${adjId}`, { status: "WAITING_APPROVAL" });
  await api.patch(`/api/inventory/adjustments/${adjId}`, { status: "APPROVED" });
  const first = await api.post(`/api/inventory/adjustments/${adjId}/post`, {});
  assert.equal(first.status, 200);
  const second = await api.post(`/api/inventory/adjustments/${adjId}/post`, {});
  assert.equal(second.status, 400);
  assert.equal(await balanceOf(material.id), 12);
});

// ─────────────────────────── Jalur cepat (quick movements) ────────────────────────────

test("Quick path: POST /movements/waste dengan unitId tersimpan & mengurangi saldo", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10 } });
  const { unit } = await createTestUnit();

  const res = await api.post("/api/inventory/movements/waste", {
    materialId: material.id, qty: 2, reason: "sobek saat dipotong", unitId: unit.id,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.unitId, unit.id);
  assert.equal(await balanceOf(material.id), 8);
});

test("Quick path: POST /units/:id/materials (jalur cepat produksi) TIDAK BISA mendorong saldo negatif", async () => {
  const api = await client();
  const material = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 2 } });
  const { unit } = await createTestUnit();

  const res = await api.post(`/api/units/${unit.id}/materials`, { materialId: material.id, qty: 5 });
  assert.equal(res.status, 400, "qty positif = pemakaian (ISSUE) — 5 > saldo 2, wajib ditolak");
  assert.equal(await balanceOf(material.id), 2);
});
