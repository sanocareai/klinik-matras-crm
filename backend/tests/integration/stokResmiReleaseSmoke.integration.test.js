// Menjalankan blok REHEARSAL dan SMOKE dari scripts/release-stok-resmi-pratinjau.sh (kode Node yang sama persis yang akan jalan di produksi) terhadap DB terisolasi + app uji.
// Tujuan: skrip rilis tidak boleh pertama kali dieksekusi di produksi. Dataset meniru produksi: satu Stock Count baseline COMPLETED, tanpa adjustment/rusak/retur, sakelar default (tanpa baris).
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
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skrip = fs.readFileSync(path.resolve(backend, "../scripts/release-stok-resmi-pratinjau.sh"), "utf8").replace(/\r\n/g, "\n");
const blok = (pembuka, penutup) => { const a = skrip.indexOf(pembuka); assert.ok(a > 0, `pembuka ${pembuka} tidak ada`); const mulai = skrip.indexOf("\n", a) + 1; const b = skrip.indexOf(`\n${penutup}\n`, mulai); assert.ok(b > 0, `penutup ${penutup} tidak ada`); return skrip.slice(mulai, b); };

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function datasetProduksiMini() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const m = await createTestMaterial({ code: "BHN-BASELINE", unit: "KG" });
  const at = new Date("2026-08-31T17:00:00Z");
  const c = await testPrisma.stockCount.create({ data: { countNumber: "CC-01092026-BASELINE", countType: "FULL_STOCK_OPNAME", countMethod: "FULL_WAREHOUSE", status: "COMPLETED", startedAt: at, completedAt: at, notes: "Backfill saldo pembuka — migrasi dari stock opname Excel", lines: { create: [{ materialId: m.id, systemQty: 0, countedQty: 10 }] } } });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ADJUSTMENT", qty: 10, stockCountId: c.id, createdAt: at, note: "baseline" } });
  await createTestUser({ roles: ["ADMIN"] }); await createTestUser({ roles: ["SALES"] }); await createTestUser({ roles: ["FINANCE"] });
  return c;
}
// ASINKRON (bukan spawnSync): server uji hidup di proses ini — spawnSync akan memblokir event loop-nya dan smoke menggantung.
function jalankan(kode, env = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ["--input-type=module", "-"], { cwd: backend, env: { ...process.env, ...env } });
    let out = ""; c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { out += d; });
    const t = setTimeout(() => c.kill(), 120000);
    c.on("close", (kode) => { clearTimeout(t); resolve({ kode, out }); });
    c.stdin.end(kode);
  });
}
const sidikJari = async () => { const t = (await testPrisma.$queryRawUnsafe("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name <> '_prisma_migrations' order by 1")).map((x) => x.table_name); const o = {}; for (const n of t) o[n] = (await testPrisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${n}" x`))[0]; return o; };

test("REHEARSAL (blok skrip rilis) lulus terhadap data mirip produksi dan tidak mengubah satu baris pun", async () => {
  await datasetProduksiMini();
  const kode = blok("<<'REHNODE'", "REHNODE").split("/app/").join(`${pathToFileURL(backend).href}/`);
  const sebelum = await sidikJari();
  const r = await jalankan(kode);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /PEMERIKSAAN=\d+ gagal=0/);
  assert.ok((r.out.match(/^OK /gm) || []).length >= 8, r.out);
  assert.deepEqual(await sidikJari(), sebelum, "rehearsal tidak boleh mengubah data");
});

test("SMOKE (blok skrip rilis) lulus terhadap app uji: sakelar default, izin, pratinjau, penolakan; tidak ada jejak tulis", async () => {
  await datasetProduksiMini();
  const kode = blok("<<'NODE' | tee", "NODE").split('const BASE = "http://127.0.0.1:4000";').join(`const BASE = "${server.baseUrl}";`);
  const sebelum = await sidikJari();
  const r = await jalankan(kode);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /SMOKE_HASIL fail=0 skip=0/, r.out);
  assert.match(r.out, /SAKELAR stok_resmi_opname: aktif=false sejak=''/);
  assert.match(r.out, /SAKELAR stok_resmi_penyesuaian: aktif=false/);
  assert.match(r.out, /SAKELAR stok_resmi_rusak: aktif=false/);
  assert.deepEqual(await sidikJari(), sebelum, "smoke tidak boleh mengubah data (termasuk panggilan POST posting/pembalikan yang ditolak)");
});

test("SMOKE gagal keras bila ada sakelar menyala (tidak ikut lolos diam-diam)", async () => {
  await datasetProduksiMini();
  await testPrisma.finSetting.upsert({ where: { key: "stok_resmi_opname_aktif" }, update: { value: "true" }, create: { key: "stok_resmi_opname_aktif", value: "true" } });
  const kode = blok("<<'NODE' | tee", "NODE").split('const BASE = "http://127.0.0.1:4000";').join(`const BASE = "${server.baseUrl}";`);
  const r = await jalankan(kode);
  assert.notEqual(r.kode, 0, r.out);
  assert.match(r.out, /FAIL/);
});
