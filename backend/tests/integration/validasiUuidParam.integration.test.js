// VALIDASI PARAMETER UUID — 19 endpoint yang dulu menjawab 500 untuk id berformat cuid/string rusak (sapuan 12 Okt 2026).
// Urutan respons yang dikunci: tanpa token 401 → peran tak berizin 403 → berizin + id bukan UUID 400 {code,message} → UUID valid tak ada 404 → UUID nyata = respons lama.
// Mode SNAPSHOT (env VALIDASI_UUID_SNAPSHOT=<berkas.json>): TIDAK menegaskan apa pun; hanya merekam status+badan ternormalisasi tiap kasus — dijalankan pada kode LAMA dan BARU
// lalu dibandingkan untuk membuktikan "UUID nyata → respons identik" dan menyusun tabel sebelum/sesudah.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { PERMISSIONS as P, ROLE_PERMISSIONS } from "../../src/constants/permissions.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

const SNAPSHOT = process.env.VALIDASI_UUID_SNAPSHOT || null;
const rekam = {};

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => {
  if (SNAPSHOT) fs.writeFileSync(SNAPSHOT, JSON.stringify(rekam, null, 2));
  await truncateAll(); await server.close(); await testPrisma.$disconnect();
});

const CUID = "cmgz1k8q40000x7e5f2h9d3ab";
const UUID_TAK_ADA = "11111111-2222-4333-8444-555555555555";
const ID_RUSAK = [
  ["cuid", CUID],
  ["teks bebas", "bukan-uuid"],
  ["UUID kelebihan karakter", `${UUID_TAK_ADA}0`],
  ["UUID dengan karakter non-heksa", "11111111-2222-4333-8444-55555555555g"],
  ["terlalu panjang (300 karakter)", "a".repeat(300)],
  ["mirip injeksi", "1';DROP TABLE \"User\";--"],
];
const PERLU_AMAN = /prisma|stack|\bat\s+\S+\.js|node_modules|\$queryRaw|select\s.+\sfrom|insert\s+into|C:\\|\/app\/|\/home\/|jwt_secret|database_url|postgres(ql)?:\/\/|invocation|P20\d\d/i;

// [nama, path(id) , izin (satu string atau array = salah satu cukup), pembuat fixture, status UUID nyata yang diharapkan]
const ENDPOINT = [
  ["production/work-centers/:id", (id) => `/api/production/work-centers/${id}`, [P.WORK_CENTER_READ], async (f) => (await testPrisma.workCenter.create({ data: { code: "WC-UUID-1", name: "Meja Uji UUID" } })).id, 200],
  ["inventory/goods-receipts/:id", (id) => `/api/inventory/goods-receipts/${id}`, [P.INVENTORY_READ], async (f) => (await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-UUID-1", sourceType: "MANUAL" } })).id, 200],
  ["inventory/purchase-orders/:id", (id) => `/api/inventory/purchase-orders/${id}`, [P.INVENTORY_READ], async (f) => (await testPrisma.finPurchaseOrder.create({ data: { poNumber: "PO-UUID-1", supplierId: f.supplier.id, orderDate: new Date("2026-10-01T00:00:00Z"), status: "DISETUJUI" } })).id, 200],
  ["inventory/material-issues/:id", (id) => `/api/inventory/material-issues/${id}`, [P.INVENTORY_READ], async () => (await testPrisma.materialIssue.create({ data: { issueNumber: "MI-UUID-1", sourceType: "MANUAL" } })).id, 200],
  ["inventory/transfers/:id", (id) => `/api/inventory/transfers/${id}`, [P.INVENTORY_READ], async (f) => (await testPrisma.stockTransfer.create({ data: { transferNumber: "TR-UUID-1", transferType: "BIN_TO_BIN", sourceLocationId: f.locA.id, destinationLocationId: f.locB.id } })).id, 200],
  ["inventory/stock-counts/:id", (id) => `/api/inventory/stock-counts/${id}`, [P.INVENTORY_READ], async () => (await testPrisma.stockCount.create({ data: { countNumber: "SC-UUID-1", countType: "CYCLE_COUNT", countMethod: "BY_ITEM" } })).id, 200],
  ["inventory/damaged-stock/:id", (id) => `/api/inventory/damaged-stock/${id}`, [P.INVENTORY_READ], async (f) => (await testPrisma.damagedStockRecord.create({ data: { recordNumber: "DS-UUID-1", materialId: f.material.id, qty: 1, damageCategory: "TORN" } })).id, 200],
  ["inventory/returns/:id", (id) => `/api/inventory/returns/${id}`, [P.INVENTORY_READ], async (f) => (await testPrisma.returnRecord.create({ data: { returnNumber: "RT-UUID-1", returnType: "CUSTOMER_RETURN", materialId: f.material.id, qty: 1 } })).id, 200],
  ["inventory/adjustments/:id", (id) => `/api/inventory/adjustments/${id}`, [P.INVENTORY_READ], async (f) => (await testPrisma.stockAdjustmentRequest.create({ data: { adjustmentNumber: "ADJ-UUID-1", adjustmentType: "POSITIVE", materialId: f.material.id, beforeQty: 0, adjustmentQty: 1, reason: "uji validasi uuid" } })).id, 200],
  ["inventory/replenishment/:id", (id) => `/api/inventory/replenishment/${id}`, [P.INVENTORY_READ], async (f) => (await testPrisma.replenishmentRequest.create({ data: { requestNumber: "RP-UUID-1", source: "MANUAL_REQUEST", materialId: f.material.id, currentStockSnapshot: 0, suggestedQty: 1 } })).id, 200],
  ["production-v2/plans/:id/schedule-history", (id) => `/api/production-v2/plans/${id}/schedule-history`, [P.UNIT_READ], async (f) => {
    const run = await testPrisma.productionRun.create({ data: { unitId: f.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS", revision: 1 } });
    const plan = await testPrisma.productionRunPlan.create({ data: { runId: run.id } });
    await testPrisma.productionPlanScheduleEvent.create({ data: { planId: plan.id, unitId: f.unit.id, kind: "SCHEDULED", toStation: "MEJA_1" } });
    return plan.id;
  }, 200],
  ["finance/purchases/:id/advance-summary", (id) => `/api/finance/purchases/${id}/advance-summary`, [P.FINANCE_READ, P.FINANCE_EXPENSE_SUBMIT], async (f) => (await testPrisma.finPurchase.create({ data: { purchaseNumber: "PUR-UUID-1", date: new Date("2026-10-01T00:00:00Z"), amount: 150000, description: "Pembelian uji UUID", categoryId: f.kategori.id } })).id, 200],
  ["armada/routes/:id", (id) => `/api/armada/routes/${id}`, [P.JOB_READ], async (f) => f.route.id, 200],
  ["armada/routes/:id/maps-link", (id) => `/api/armada/routes/${id}/maps-link`, [P.JOB_READ], async (f) => f.route.id, null],
  ["armada/routes/:id/map", (id) => `/api/armada/routes/${id}/map`, [P.JOB_READ, P.JOB_OWN_READ], async (f) => f.route.id, null],
  ["armada/routes/:id/route-trace", (id) => `/api/armada/routes/${id}/route-trace`, [P.JOB_READ], async (f) => f.route.id, null],
  ["armada/routes/:id/prep-checklist", (id) => `/api/armada/routes/${id}/prep-checklist`, [P.JOB_WRITE, P.JOB_OWN_WRITE], async (f) => f.route.id, null],
  ["armada/routes/:id/timeline", (id) => `/api/armada/routes/${id}/timeline`, [P.JOB_READ, P.JOB_OWN_READ, P.JOB_OWN_WRITE], async (f) => f.route.id, null],
  ["armada/jobs/:id", (id) => `/api/armada/jobs/${id}`, [P.JOB_READ, P.JOB_OWN_READ], async (f) => f.job.id, 200],
];

// Rute SAUDARA di router yang sama (id yang sama, akar masalah identik) — hanya urutan 401/403/400 yang dikunci (tanpa menjalankan aksi).
const SAUDARA = [
  ["PATCH", "/api/production/work-centers/:id", [P.WORK_CENTER_WRITE]],
  ...["PATCH /:id", "PATCH /:id/lines/:lineId", "POST /:id/putaway", "PATCH /:id/reject"].map((r) => [r.split(" ")[0], `/api/inventory/goods-receipts${r.split(" ")[1]}`, [P.INVENTORY_WRITE]]),
  ...["PATCH /:id", "PATCH /:id/lines/:lineId", "POST /:id/issue", "PATCH /:id/cancel"].map((r) => [r.split(" ")[0], `/api/inventory/material-issues${r.split(" ")[1]}`, [P.INVENTORY_WRITE]]),
  ...["PATCH /:id", "POST /:id/dispatch", "POST /:id/receive", "PATCH /:id/cancel"].map((r) => [r.split(" ")[0], `/api/inventory/transfers${r.split(" ")[1]}`, [P.INVENTORY_WRITE]]),
  ...["PATCH /:id", "POST /:id/start", "PATCH /:id/lines/:lineId", "POST /:id/submit", "POST /:id/recount", "POST /:id/complete", "PATCH /:id/cancel"].map((r) => [r.split(" ")[0], `/api/inventory/stock-counts${r.split(" ")[1]}`, [P.INVENTORY_WRITE]]),
  ...["PATCH /:id/inspect", "POST /:id/resolve"].map((r) => [r.split(" ")[0], `/api/inventory/damaged-stock${r.split(" ")[1]}`, [P.INVENTORY_WRITE]]),
  ...["PATCH /:id", "POST /:id/complete", "PATCH /:id/cancel"].map((r) => [r.split(" ")[0], `/api/inventory/returns${r.split(" ")[1]}`, [P.INVENTORY_WRITE]]),
  ...["PATCH /:id", "POST /:id/post", "PATCH /:id/cancel"].map((r) => [r.split(" ")[0], `/api/inventory/adjustments${r.split(" ")[1]}`, [P.INVENTORY_WRITE]]),
  ...["PATCH /:id", "POST /:id/link-receipt", "PATCH /:id/reject"].map((r) => [r.split(" ")[0], `/api/inventory/replenishment${r.split(" ")[1]}`, [P.INVENTORY_WRITE]]),
  ["GET", "/api/finance/purchase-orders/:id", [P.FINANCE_READ]],
  ["GET", "/api/finance/purchase-orders/:id/penagihan", [P.FINANCE_READ]],
  ["GET", "/api/finance/purchases/:id/advance-eligible", [P.FINANCE_READ, P.FINANCE_POST]],
];

const tersedia = (role, izin) => izin.some((p) => (ROLE_PERMISSIONS[role] || []).includes(p));
const pilihBerizin = (izin) => { const r = Object.keys(ROLE_PERMISSIONS).find((x) => tersedia(x, izin)); assert.ok(r, `tidak ada peran berizin untuk ${izin}`); return r; };
const pilihTerlarang = (izin) => { const r = ["SALES", "DRIVER", "HELPER", "QC_LEAD", "WAREHOUSE", "FINANCE"].concat(Object.keys(ROLE_PERMISSIONS)).find((x) => ROLE_PERMISSIONS[x] && !tersedia(x, izin)); assert.ok(r, `tidak ada peran terlarang untuk ${izin}`); return r; };

const normal = (v) => JSON.parse(JSON.stringify(v ?? null)
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<waktu>")
  .replace(/c[a-z0-9]{24}/g, "<cuid>"));

async function panggil(metode, token, path) {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method: metode,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: metode === "GET" ? undefined : "{}",
  });
  let body = null; const teks = await res.text(); try { body = JSON.parse(teks); } catch { body = teks.slice(0, 200); }
  return { status: res.status, body, teks };
}

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const material = await createTestMaterial({ code: "MAT-UUID-1" });
  const wh = await testPrisma.warehouse.create({ data: { code: "WH-UUID-1", name: "Gudang Uji UUID" } });
  const locA = await testPrisma.storageLocation.create({ data: { code: "LOC-UUID-A", warehouseId: wh.id, locationType: "RAW_MATERIAL_AREA", zone: "A" } });
  const locB = await testPrisma.storageLocation.create({ data: { code: "LOC-UUID-B", warehouseId: wh.id, locationType: "WIP_AREA", zone: "B" } });
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-UUID-1", name: "Supplier Uji UUID" } });
  const kategori = (await testPrisma.finPurchaseCategory.findFirst()) ?? await (async () => {
    const akun = await testPrisma.finAccount.findFirst();
    return testPrisma.finPurchaseCategory.create({ data: { code: "UJI-UUID", name: "Kategori Uji UUID", accountId: akun.id } });
  })();
  const { unit, order } = await createTestUnit({ unitCode: "UNIT-UUID-1" });
  const route = await testPrisma.route.create({ data: { code: "RT-UUID-1", date: new Date("2026-10-13T00:00:00Z") } });
  const job = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, routeId: route.id } });
  return { material, locA, locB, supplier, kategori, unit, order, route, job };
}

test("19 endpoint: 401 → 403 → 400 ID_TIDAK_VALID → 404 → UUID nyata sama seperti dulu; 4xx tidak membocorkan detail internal", async () => {
  const f = await siapkan();
  const ringkas = [];
  for (const [nama, buat, izin, fixture, statusNyata] of ENDPOINT) {
    const berizin = await createTestUser({ roles: [pilihBerizin(izin)] });
    const terlarang = await createTestUser({ roles: [pilihTerlarang(izin)] });
    const idNyata = await fixture(f);
    const hasil = {};

    // 1. tanpa autentikasi (id rusak) → 401
    const anon = await panggil("GET", null, buat(CUID));
    hasil.tanpaToken = anon.status;
    // 2. peran tak berizin (id rusak) → 403
    const dilarang = await panggil("GET", terlarang.token, buat(CUID));
    hasil.terlarang = dilarang.status;
    // 3 + 4. berizin + id bukan UUID → 400
    const rusak = [];
    for (const [label, id] of ID_RUSAK) {
      const r = await panggil("GET", berizin.token, buat(encodeURIComponent(id)));
      rusak.push([label, r.status, normal(r.body)]);
      if (!SNAPSHOT) {
        assert.equal(r.status, 400, `${nama} [${label}] → ${r.status} ${r.teks.slice(0, 160)}`);
        assert.deepEqual(r.body, { code: "ID_TIDAK_VALID", message: "ID tidak valid." }, `${nama} [${label}] badan`);
        assert.doesNotMatch(r.teks, PERLU_AMAN, `${nama} [${label}] membocorkan detail internal`);
      }
    }
    hasil.rusak = rusak;
    // 5. UUID valid tak ada → 404
    const hilang = await panggil("GET", berizin.token, buat(UUID_TAK_ADA));
    hasil.tidakAda = [hilang.status, normal(hilang.body)];
    // 6. UUID nyata
    const nyata = await panggil("GET", berizin.token, buat(idNyata));
    hasil.nyata = [nyata.status, normal(nyata.body)];
    rekam[nama] = hasil;

    if (SNAPSHOT) continue;
    assert.equal(anon.status, 401, `${nama}: tanpa token`);
    assert.equal(dilarang.status, 403, `${nama}: peran terlarang`);
    assert.doesNotMatch(dilarang.teks, PERLU_AMAN);
    assert.equal(hilang.status, 404, `${nama}: UUID valid tak ada → ${hilang.status} ${hilang.teks.slice(0, 160)}`);
    assert.doesNotMatch(hilang.teks, PERLU_AMAN, `${nama}: 404 membocorkan detail`);
    assert.notEqual(nyata.body?.code, "ID_TIDAK_VALID", `${nama}: UUID nyata ditolak validator`);
    if (statusNyata) assert.equal(nyata.status, statusNyata, `${nama}: UUID nyata → ${nyata.status} ${nyata.teks.slice(0, 200)}`);
    assert.ok(nyata.status < 500, `${nama}: UUID nyata → ${nyata.status} ${nyata.teks.slice(0, 200)}`);
    ringkas.push(`${nama}: nyata=${nyata.status}`);
  }
  if (!SNAPSHOT) console.log("  UUID nyata:", ringkas.join(" | "));
});

test("rute saudara di router yang sama (tulis/nested): tanpa token 401, peran terlarang 403, berizin + id rusak 400 — tanpa menjalankan aksi", async () => {
  const hasil = [];
  for (const [metode, templ, izin] of SAUDARA) {
    const berizin = await createTestUser({ roles: [pilihBerizin(izin)] });
    const terlarang = await createTestUser({ roles: [pilihTerlarang(izin)] });
    const bentuk = (id) => templ.replace(":lineId", encodeURIComponent(UUID_TAK_ADA)).replace(":id", encodeURIComponent(id));
    const a = await panggil(metode, null, bentuk(CUID));
    const b = await panggil(metode, terlarang.token, bentuk(CUID));
    const c = await panggil(metode, berizin.token, bentuk(CUID));
    const d = await panggil(metode, berizin.token, bentuk("bukan-uuid"));
    // id utama valid tetapi lineId rusak → juga 400 (hanya untuk rute bersarang)
    let e = null;
    if (templ.includes(":lineId")) e = await panggil(metode, berizin.token, templ.replace(":id", UUID_TAK_ADA).replace(":lineId", CUID));
    hasil.push([`${metode} ${templ}`, a.status, b.status, c.status, d.status, e?.status ?? "-"]);
    rekam[`saudara ${metode} ${templ}`] = [a.status, b.status, c.status, d.status, e?.status ?? null];
    if (SNAPSHOT) continue;
    assert.equal(a.status, 401, `${metode} ${templ}: tanpa token`);
    assert.equal(b.status, 403, `${metode} ${templ}: peran terlarang`);
    assert.equal(c.status, 400, `${metode} ${templ}: cuid → ${c.status} ${c.teks.slice(0, 120)}`);
    assert.deepEqual(c.body, { code: "ID_TIDAK_VALID", message: "ID tidak valid." });
    assert.equal(d.status, 400);
    if (e) { assert.equal(e.status, 400, `${metode} ${templ}: lineId cuid`); assert.deepEqual(e.body, { code: "ID_TIDAK_VALID", message: "ID tidak valid." }); }
    for (const r of [a, b, c, d]) assert.doesNotMatch(r.teks, PERLU_AMAN);
  }
  if (!SNAPSHOT) console.log(`  ${hasil.length} rute saudara terkunci`);
});

test("id valid yang tidak ada pada rute saudara tetap 404 seperti dulu (validator tidak menelan jalur normal)", async () => {
  const berizin = await createTestUser({ roles: [pilihBerizin([P.INVENTORY_WRITE])] });
  for (const [metode, path] of [
    ["PATCH", `/api/inventory/material-issues/${UUID_TAK_ADA}/cancel`],
    ["POST", `/api/inventory/stock-counts/${UUID_TAK_ADA}/start`],
    ["PATCH", `/api/inventory/returns/${UUID_TAK_ADA}/cancel`],
  ]) {
    const r = await panggil(metode, berizin.token, path);
    rekam[`404 ${metode} ${path.replace(UUID_TAK_ADA, "<uuid>")}`] = [r.status, normal(r.body)];
    if (SNAPSHOT) continue;
    assert.equal(r.status, 404, `${metode} ${path} → ${r.status} ${r.teks.slice(0, 120)}`);
  }
});
