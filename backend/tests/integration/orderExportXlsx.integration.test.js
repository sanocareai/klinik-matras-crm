// POST /api/orders/export-xlsx lewat HTTP sungguhan: wajib login, mengembalikan berkas .xlsx yang valid, menolak data terlalu besar dengan 413.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const spec = (extra = {}) => ({
  judul: "Laporan Order",
  sheets: [{ nama: "Order", kolom: [{ key: "a", header: "ID Order" }, { key: "b", header: "Nilai", tipe: "uang", total: true }], baris: [["RES-1", 1000], ["RES-2", 2500]], bendera: [[], ["komplain"]] }],
  ringkasan: { kunciNilai: "b", kelompok: [] },
  ...extra,
});
const kirim = (token, body) => fetch(`${server.baseUrl}/api/orders/export-xlsx`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

test("tanpa login → 401", async () => {
  assert.equal((await kirim(null, spec())).status, 401);
});

test("login → berkas xlsx valid (tipe, nama berkas, isi bisa dibuka & komplain berwarna)", async () => {
  const { token } = await createTestUser({ roles: ["SALES"] });
  const res = await kirim(token, spec());
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /spreadsheetml\.sheet/);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="order-\d{4}-\d{2}-\d{2}\.xlsx"/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), "PK", "xlsx adalah zip");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Ringkasan", "Order"]);
  assert.equal(wb.getWorksheet("Order").getCell("A5").fill.fgColor.argb, "FFFEE2E2");
});

test("nama pengekspor diambil dari akun yang login (isian klien diabaikan)", async () => {
  const { token, user } = await createTestUser({ roles: ["SALES"] });
  const res = await kirim(token, spec({ pengekspor: "Penyamar" }));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const info = String(wb.getWorksheet("Order").getCell("A2").value);
  assert.ok(info.includes(user.name), info);
  assert.ok(!info.includes("Penyamar"), info);
});

test("data terlalu besar → 413 dengan pesan yang jelas; bentuk salah → 400", async () => {
  const { token } = await createTestUser({ roles: ["SALES"] });
  const banyak = Array.from({ length: 6001 }, (_, i) => ["x", i]);
  const r1 = await kirim(token, spec({ sheets: [{ nama: "Order", kolom: [{ key: "a", header: "a" }, { key: "b", header: "b" }], baris: banyak }] }));
  assert.equal(r1.status, 413);
  assert.match((await r1.json()).error, /persempit/i);
  const r2 = await kirim(token, { sheets: "salah" });
  assert.equal(r2.status, 400);
});
