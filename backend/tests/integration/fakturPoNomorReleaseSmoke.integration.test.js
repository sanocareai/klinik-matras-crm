// Menjalankan blok REHEARSAL dan SMOKE dari scripts/release-faktur-po-nomor.sh — kode Node yang sama persis yang akan jalan di produksi — terhadap DB terisolasi berisi kasus
// BILL-17102026-008 (faktur kedua bernomor pengisi '---' dari supplier yang sama). Tujuan: skrip rilis tidak boleh pertama kali dieksekusi di produksi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { bawaSampaiSiap } from "./setup/kedatangan.js";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skrip = fs.readFileSync(path.resolve(backend, "../scripts/release-faktur-po-nomor.sh"), "utf8").replace(/\r\n/g, "\n");
const blok = (pembuka, penutup) => { const a = skrip.indexOf(pembuka); assert.ok(a > 0, `pembuka ${pembuka} tidak ada`); const mulai = skrip.indexOf("\n", a) + 1; const b = skrip.indexOf(`\n${penutup}\n`, mulai); assert.ok(b > 0, `penutup ${penutup} tidak ada`); return skrip.slice(mulai, b); };

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

async function dataset({ setujuiKedua = false } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  await createTestUser({ roles: ["ADMIN"] }); await createTestUser({ roles: ["SALES"] });
  const f = makeClient(server.baseUrl, fin.token); const g = makeClient(server.baseUrl, gudang.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-TBF", name: "TOKO BERSAMA FURNITURE" } });
  const kain = await createTestMaterial({ code: "KAI-004", name: "KAIN UJI", unit: "METER" });
  const buat = async (qty, harga) => {
    const c = await f.post("/api/finance/purchase-orders", { supplierId: supplier.id, orderDate: hariIni(), lines: [{ materialId: kain.id, qty, unitPrice: harga }] });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const po = (await f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {})).body;
    const gr = await g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id });
    assert.equal(gr.status, 201, JSON.stringify(gr.body));
    await bawaSampaiSiap(g, gr.body, { datang: qty, baik: qty });
    assert.equal((await g.post(`/api/inventory/goods-receipts/${gr.body.id}/putaway`, {})).status, 200);
    const fk = await f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: "---", billDate: hariIni(), lines: [{ purchaseOrderLineId: po.lines[0].id, qty, unitPrice: harga }] });
    assert.equal(fk.status, 201, JSON.stringify(fk.body));
    return fk.body.billId;
  };
  const b1 = await buat(4, 48_000);
  assert.equal((await f.post(`/api/finance/bills/${b1}/approve`, {})).status, 200);
  const b2 = await buat(5, 148_000); // Rp740.000
  await testPrisma.finSupplierBill.update({ where: { id: b2 }, data: { billNumber: "BILL-17102026-008" } });
  if (setujuiKedua) assert.equal((await f.post(`/api/finance/bills/${b2}/approve`, {})).status, 200);
  return { f, b1, b2 };
}
function jalankan(kode, env = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ["--input-type=module", "-"], { cwd: backend, env: { ...process.env, ...env } });
    let out = ""; c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { out += d; });
    const t = setTimeout(() => c.kill(), 170000);
    c.on("close", (kode2) => { clearTimeout(t); resolve({ kode: kode2, out }); });
    c.stdin.end(kode);
  });
}
const hitung = async (q) => Number((await testPrisma.$queryRawUnsafe(q))[0].n);

test("REHEARSAL (blok skrip rilis): guard nomor pengisi + simulasi persetujuan BILL-17102026-008 (GRNI turun, Utang naik, rollback) — semua OK", async () => {
  const { b2 } = await dataset();
  const kode = blok("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\"", "REHNODE").split("/app/").join(`${pathToFileURL(backend).href}/`);
  const sebelum = { je: await hitung("select count(*)::int n from fin_journal_entries"), al: await hitung("select count(*)::int n from fin_supplier_bill_allocations") };
  const r = await jalankan(kode);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /PEMERIKSAAN=\d+ gagal=0/);
  assert.ok(!/^GAGAL/m.test(r.out), r.out);
  assert.match(r.out, /OK\s+BILL-17102026-008: nomor pengisi tidak lagi ditolak FAKTUR_GANDA/);
  assert.match(r.out, /OK\s+BILL-17102026-008 \(simulasi, di-rollback\): GRNI 2-1150 didebit Rp740000/);
  assert.match(r.out, /OK\s+BILL-17102026-008 \(simulasi\): Utang Usaha 2-1100 dikredit/);
  assert.match(r.out, /OK\s+BILL-17102026-008 \(simulasi\): tidak ada akun lain bergerak/);
  assert.match(r.out, /OK\s+rollback: BILL-17102026-008 tetap MENUNGGU_APPROVAL/);
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: b2 } })).status, "MENUNGGU_APPROVAL", "simulasi tidak menyetujui");
  assert.equal(await hitung("select count(*)::int n from fin_journal_entries"), sebelum.je);
  assert.equal(await hitung("select count(*)::int n from fin_supplier_bill_allocations"), sebelum.al);
});

test("REHEARSAL: bila BILL-17102026-008 sudah ditangani Finance (tidak menunggu) → simulasi dilewati (SKIP), tetap lulus", async () => {
  await dataset({ setujuiKedua: true });
  const kode = blok("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\"", "REHNODE").split("/app/").join(`${pathToFileURL(backend).href}/`);
  const r = await jalankan(kode);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /SKIP BILL-17102026-008 tidak berstatus menunggu/);
});

test("SMOKE (blok skrip rilis): izin, guard lolos untuk BILL-17102026-008, tanpa jejak tulis", async () => {
  await dataset();
  const kode = blok("<<'NODE' | tee \"$BK_DIR/smoke.log\" || die \"smoke test GAGAL\"", "NODE").split('const BASE = "http://127.0.0.1:4000";').join(`const BASE = "${server.baseUrl}";`).split("/app/").join(`${pathToFileURL(backend).href}/`);
  const env = { BASE_TIDAK_SEIMBANG: "0", ORDER_N: String(await hitung('select count(*)::int n from "Order"')), JOB_N: String(await hitung("select count(*)::int n from jobs")) };
  const sebelum = { je: await hitung("select count(*)::int n from fin_journal_entries"), bill: await hitung("select count(*)::int n from fin_supplier_bills"), act: await hitung("select count(*)::int n from activity_events") };
  const r = await jalankan(kode, env);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /SMOKE_HASIL fail=0 skip=\d+/, r.out);
  assert.ok(!/FAIL /.test(r.out), r.out);
  assert.match(r.out, /PASS\s+BILL-17102026-008: guard persetujuan lolos/);
  assert.match(r.out, /PASS\s+approve tagihan: tanpa token 401/);
  assert.equal(await hitung("select count(*)::int n from fin_journal_entries"), sebelum.je);
  assert.equal(await hitung("select count(*)::int n from fin_supplier_bills"), sebelum.bill);
  assert.equal(await hitung("select count(*)::int n from activity_events"), sebelum.act);
});
