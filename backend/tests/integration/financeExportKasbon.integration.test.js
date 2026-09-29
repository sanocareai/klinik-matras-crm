// EXPORT EXCEL FINANCE — KASBON (B3.9). Yang dikunci: berkas = data yang SAMA dengan layar (GET /kasbon), nominal angka, filter/status
// diikuti, izin (SALES 403, tanpa login 401), kolom sensitif hanya untuk Admin Keuangan, header Indonesia, tanggal WIB.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const a = makeClient(server.baseUrl, admin.token);
  const k1 = (await a.post("/api/finance/kasbon", { date: "2026-09-19", amount: 500_000, employeeName: "imam", urgency: "anak sakit, biaya berobat", cashAccountId: kas.id, notes: "=CATATAN RAHASIA" })).body;
  const k2 = (await a.post("/api/finance/kasbon", { date: "2026-09-21", amount: 300_000, employeeName: "ujang sigit", urgency: "-servis motor", cashAccountId: kas.id })).body;
  await a.post(`/api/finance/kasbon/${k1.id}/pelunasan`, { method: "POTONG_GAJI", amount: 200_000, date: "2026-09-25" });
  return { kas, admin, finance, sales, a, k1, k2 };
}

test("Berkas Kasbon = data layar: baris, nominal (ANGKA), terpotong, sisa, total; header Indonesia; kepala memuat filter", async () => {
  const ctx = await siapkan();
  const layar = (await ctx.a.get("/api/finance/kasbon?status=AKTIF")).body.kasbon;
  const r = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon", { filter: { status: "AKTIF" }, filterLabel: "Status: Aktif (belum lunas)" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Kasbon_per_\d{4}-\d{2}-\d{2}\.xlsx"/);
  const s = bacaSheet(r.wb, "Kasbon");
  assert.equal(s.baris.length, layar.length);
  assert.deepEqual(s.baris.map((b) => b["No. Kasbon"]).sort(), layar.map((k) => k.kasbonNumber).sort());
  for (const k of layar) {
    const b = s.baris.find((x) => x["No. Kasbon"] === k.kasbonNumber);
    assert.equal(typeof b["Nominal (Rp)"], "number");
    assert.equal(b["Nominal (Rp)"], k.amount);
    assert.equal(b["Terpotong (Rp)"], k.terlunasi);
    assert.equal(b["Sisa (Rp)"], k.sisa);
    assert.equal(b["Status"], "Aktif");
  }
  assert.equal(s.total["Nominal (Rp)"], layar.reduce((a, k) => a + k.amount, 0));
  assert.equal(s.total["Sisa (Rp)"], layar.reduce((a, k) => a + k.sisa, 0));
  assert.match(s.kepala[2], /Filter: Status: Aktif \(belum lunas\)/);
  assert.ok(s.header.includes("Karyawan") && s.header.includes("Sisa (Rp)"));
  const tgl = s.baris.find((b) => b["No. Kasbon"] === ctx.k1.kasbonNumber)["Tanggal"];
  assert.ok(tgl instanceof Date && tgl.toISOString().slice(0, 10) === "2026-09-19", "tanggal = tanggal Excel");
  assert.ok(r.wb.getWorksheet("Pemotongan"), "sheet pemotongan ada bila ada pemotongan");
  assert.equal(bacaSheet(r.wb, "Pemotongan").baris.length, 1);
});

test("Filter & pencarian diikuti (karyawan, q, periode); status lain → hasil berbeda; filter tanpa hasil tetap berkas valid", async () => {
  const ctx = await siapkan();
  const kar = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon", { filter: { karyawan: "Ujang Sigit" } });
  assert.deepEqual(bacaSheet(kar.wb, "Kasbon").baris.map((b) => b["Karyawan"]), ["Ujang Sigit"]);
  const q = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon", { filter: { q: "berobat" } });
  assert.deepEqual(bacaSheet(q.wb, "Kasbon").baris.map((b) => b["Karyawan"]), ["Imam"]);
  const per = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon", { periode: { from: "2026-09-20", to: "2026-09-30" } });
  assert.deepEqual(bacaSheet(per.wb, "Kasbon").baris.map((b) => b["Karyawan"]), ["Ujang Sigit"]);
  assert.match(per.headers.get("content-disposition"), /2026-09-20_sd_2026-09-30/);
  assert.match(bacaSheet(per.wb, "Kasbon").kepala[1], /Periode: 20 Sep 2026 – 30 Sep 2026/);
  const kosong = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon", { filter: { status: "LUNAS" } });
  assert.equal(kosong.status, 200);
  assert.equal(bacaSheet(kosong.wb, "Kasbon").baris.length, 0);
  const ids = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon", { ids: [ctx.k2.id] });
  assert.deepEqual(bacaSheet(ids.wb, "Kasbon").baris.map((b) => b["No. Kasbon"]), [ctx.k2.kasbonNumber]);
});

test("Izin: tanpa login 401, SALES 403, modul tak dikenal 404, periode rusak 400; FINANCE boleh tetapi kolom sensitif TIDAK ikut; ADMIN mendapat kolomnya; formula dinetralkan", async () => {
  const ctx = await siapkan();
  assert.equal((await unduhExport(server.baseUrl, null, "kasbon")).status, 401);
  assert.equal((await unduhExport(server.baseUrl, ctx.sales.token, "kasbon")).status, 403);
  assert.equal((await unduhExport(server.baseUrl, ctx.admin.token, "tidak-ada")).status, 404);
  assert.equal((await unduhExport(server.baseUrl, ctx.admin.token, "constructor")).status, 404, "kunci prototipe tidak dianggap modul");
  const rusak = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon", { periode: { from: "2026-13-45" } });
  assert.equal(rusak.status, 400);
  const fin = await unduhExport(server.baseUrl, ctx.finance.token, "kasbon");
  assert.equal(fin.status, 200);
  assert.ok(!bacaSheet(fin.wb, "Kasbon").header.includes("Catatan Internal"));
  const adm = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon");
  const sa = bacaSheet(adm.wb, "Kasbon");
  assert.ok(sa.header.includes("Catatan Internal"));
  assert.equal(sa.baris.find((b) => b["No. Kasbon"] === ctx.k1.kasbonNumber)["Catatan Internal"], "'=CATATAN RAHASIA", "catatan berawalan = dinetralkan");
  assert.equal(sa.baris.find((b) => b["No. Kasbon"] === ctx.k2.kasbonNumber)["Urgensi / Alasan"], "'-servis motor", "teks berawalan - dinetralkan");
});

test("Input rusak → 400 (bukan 500, tanpa bocor struktur query): filter objek, id non-string diabaikan, enum ngawur", async () => {
  const ctx = await siapkan();
  const objek = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon", { filter: { status: { contains: "x" } } });
  assert.equal(objek.status, 400); assert.equal(objek.json.code, "FILTER_TIDAK_VALID");
  const ngawur = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon", { filter: { status: "BUKAN_STATUS" } });
  assert.equal(ngawur.status, 400); assert.equal(ngawur.json.code, "FILTER_TIDAK_VALID"); assert.ok(!/prisma/i.test(JSON.stringify(ngawur.json)));
  const campur = await unduhExport(server.baseUrl, ctx.admin.token, "kasbon", { ids: [1, null, { a: 1 }, ctx.k2.id] });
  assert.equal(campur.status, 200);
  assert.deepEqual(bacaSheet(campur.wb, "Kasbon").baris.map((b) => b["No. Kasbon"]), [ctx.k2.kasbonNumber]);
});
