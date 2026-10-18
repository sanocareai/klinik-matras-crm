// Menjalankan blok REHEARSAL dan SMOKE dari scripts/release-export-unit.sh — kode Node yang sama persis yang akan jalan di produksi — terhadap DB terisolasi berisi order multi-unit.
// Tujuan: skrip rilis tidak boleh pertama kali dieksekusi di produksi.
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

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skrip = fs.readFileSync(path.resolve(backend, "../scripts/release-export-unit.sh"), "utf8").replace(/\r\n/g, "\n");
const blok = (pembuka, penutup) => { const a = skrip.indexOf(pembuka); assert.ok(a > 0, `pembuka ${pembuka} tidak ada`); const mulai = skrip.indexOf("\n", a) + 1; const b = skrip.indexOf(`\n${penutup}\n`, mulai); assert.ok(b > 0, `penutup ${penutup} tidak ada`); return skrip.slice(mulai, b); };

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dataset() {
  await createTestUser({ roles: ["ADMIN"] }); await createTestUser({ roles: ["SALES"] });
  const lem = await createTestMaterial({ code: "LEM-S", name: "Lem smoke", unit: "KG" });
  const mk = async (nomor, jumlah, berBahan) => {
    const c = await testPrisma.customer.create({ data: { name: `Pelanggan ${nomor}` } });
    const o = await testPrisma.order.create({ data: { customerId: c.id, value: 0, orderNumber: nomor } });
    for (let i = 1; i <= jumlah; i++) {
      const u = await testPrisma.unit.create({ data: { unitCode: `${nomor}-U${i}`, orderId: o.id, seq: i } });
      if (i <= berBahan) await testPrisma.stockMovement.create({ data: { materialId: lem.id, type: "ISSUE", qty: -2, unitId: u.id } });
    }
  };
  await mk("NEW-11102026-023", 3, 1); // kasus Indra: 3 unit, bahan baru dicatat untuk 1
  await mk("RES-12102026-024", 1, 1);
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

test("REHEARSAL (blok skrip rilis): export Biaya Bahan multi-unit pada salinan — semua pemeriksaan OK", async () => {
  await dataset();
  const kode = blok("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\"", "REHNODE").split("/app/").join(`${pathToFileURL(backend).href}/`);
  const r = await jalankan(kode);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /PEMERIKSAAN=\d+ gagal=0/);
  assert.ok(!/^GAGAL/m.test(r.out), r.out);
  assert.match(r.out, /unit saudara tanpa pemakaian=2/);
  assert.match(r.out, /OK\s+baris Ringkasan = unit ber-bahan \+ unit saudara/);
});

test("SMOKE (blok skrip rilis): izin, kolom 'Unit dalam Order', semua unit order tampil, tanpa jejak tulis", async () => {
  await dataset();
  const kode = blok("<<'NODE' | tee \"$BK_DIR/smoke.log\" || die \"smoke test GAGAL\"", "NODE").split('const BASE = "http://127.0.0.1:4000";').join(`const BASE = "${server.baseUrl}";`);
  const env = {
    BASE_TIDAK_SEIMBANG: "0", ORDER_N: String(await hitung('select count(*)::int n from "Order"')), JOB_N: String(await hitung("select count(*)::int n from jobs")),
  };
  const sebelum = { sm: await hitung("select count(*)::int n from stock_movements"), act: await hitung("select count(*)::int n from activity_events") };
  const r = await jalankan(kode, env);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /SMOKE_HASIL fail=0 skip=\d+/, r.out);
  assert.ok(!/FAIL /.test(r.out), r.out);
  assert.match(r.out, /kolom 'Unit dalam Order' ada di header sheet/);
  assert.match(r.out, /PASS\s+semua unit aktif dari 2 order yang punya pemakaian bahan tampil di Excel \(order multi-unit: 1; unit terlewat: 0\)/);
  assert.match(r.out, /unit tanpa pemakaian bahan yang kini ikut tampil: 2/);
  assert.equal(await hitung("select count(*)::int n from stock_movements"), sebelum.sm);
  assert.equal(await hitung("select count(*)::int n from activity_events"), sebelum.act);
});
