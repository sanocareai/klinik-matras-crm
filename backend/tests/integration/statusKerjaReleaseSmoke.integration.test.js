// Menjalankan blok REHEARSAL dan SMOKE dari scripts/release-status-kerja-buka-pekerjaan.sh — kode Node yang sama persis yang akan jalan di produksi — terhadap DB terisolasi berisi unit seperti kasus Bendrya
// (RES-19102026-094-U1: sudah diterima, Dijadwalkan, bertarget). Tujuan: skrip rilis tidak boleh pertama kali dieksekusi di produksi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { addDays, todayWib } from "../../src/lib/domain/productionRencanaAdmin.js";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skrip = fs.readFileSync(path.resolve(backend, "../scripts/release-status-kerja-buka-pekerjaan.sh"), "utf8").replace(/\r\n/g, "\n");
const blok = (pembuka, penutup) => { const a = skrip.indexOf(pembuka); assert.ok(a > 0, `pembuka ${pembuka} tidak ada`); const mulai = skrip.indexOf("\n", a) + 1; const b = skrip.indexOf(`\n${penutup}\n`, mulai); assert.ok(b > 0, `penutup ${penutup} tidak ada`); return skrip.slice(mulai, b); };

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const hariKerja = () => { let k = addDays(todayWib(), 2); while (new Date(`${k}T00:00:00Z`).getUTCDay() === 0) k = addDays(k, 1); return k; };
let seq = 0;
async function unit(kode, nama, { jadwal = true, admin } = {}) {
  seq += 1;
  const customer = await testPrisma.customer.create({ data: { name: nama, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `RES-SKR-${seq}`, value: 1_000_000, category: "LAYANAN", status: "PROCESSING", pickupConfirmedDate: new Date(), items: { create: [{ layananName: "Upgrade Lapisan", harga: 1_000_000, sortOrder: 0 }] } } });
  const u = await testPrisma.unit.create({ data: { unitCode: kode, orderId: order.id, seq: 1, status: "RECEIVED", merk: "King Koil", ukuran: "160x200", productionDueAt: new Date(Date.now() + 86_400_000) } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: u.id } });
  const wh = await testPrisma.warehouse.upsert({ where: { code: "WH-SKR" }, update: {}, create: { code: "WH-SKR", name: "Gudang SKR" } });
  const rcv = await testPrisma.storageLocation.upsert({ where: { code: "RCV-SKR" }, update: {}, create: { warehouseId: wh.id, zone: "RCV", locationType: "RECEIVING_AREA", code: "RCV-SKR" } });
  await testPrisma.unitWorkshopReceipt.create({ data: { unitId: u.id, seq: 1, locationId: rcv.id, receivedById: admin.user.id } });
  if (jadwal) { const r = await admin.api.post(`/api/production/units/${u.id}/jadwal`, { productionDate: hariKerja(), stationCode: "TABLE_1", expectedRevision: 0 }, { "Idempotency-Key": `skr-jdw-${seq}-00000000` }); assert.equal(r.status, 201, JSON.stringify(r.body)); }
  return u;
}
async function dataset() {
  const a = await createTestUser({ roles: ["ADMIN"] }); const admin = { ...a, api: makeClient(server.baseUrl, a.token) };
  await createTestUser({ roles: ["SALES"] });
  await unit("RES-19102026-094-U1", "Bendrya", { admin });
  await unit("RES-LAIN-U1", "Pelanggan Lain", { admin, jadwal: false });
  return { admin };
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

test("REHEARSAL (blok skrip rilis): membuka pekerjaan baca-saja; klik ganda manual = satu catatan; stok/Run/QC/jurnal/jadwal/target (unit Bendrya) tidak berubah", async () => {
  await dataset();
  const kode = blok("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\"", "REHNODE").split("/app/").join(`${pathToFileURL(backend).href}/`);
  const r = await jalankan(kode);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /PEMERIKSAAN=\d+ gagal=0/);
  assert.ok(!/^GAGAL/m.test(r.out), r.out);
  assert.match(r.out, /OK\s+Dijadwalkan → tindakan OPEN_WORK 'Buka pekerjaan'/);
  assert.match(r.out, /OK\s+Sudah dikerjakan \+ bahan tercatat → 'Catat pekerjaan selesai'/);
  assert.match(r.out, /OK\s+MEMBUKA\/membaca daftar kerja dan tindakan TIDAK mengubah satu pun tabel/);
  assert.match(r.out, /OK\s+klik ganda 'Sudah dikerjakan' pada RES-19102026-094-U1 \(serentak ×2\): tepat SATU catatan tersimpan/);
  assert.match(r.out, /OK\s+pengulangan perintah yang sama \(replay\): tidak menulis/);
  assert.match(r.out, /OK\s+setelah tulis manual HANYA catatan kerja \+ audit yang berubah/);
  assert.match(r.out, /OK\s+jadwal \+ target unit yang diuji \(dan unit Bendrya\) tidak berubah/);
  assert.match(r.out, /OK\s+daftar kerja sesudahnya: 'Sudah dikerjakan' dengan sumber 'Dicatat manual'/);
});

test("SMOKE (blok skrip rilis): izin, membuka pekerjaan baca-saja, tanpa jejak tulis, jadwal+target Bendrya utuh", async () => {
  await dataset();
  const kode = blok("<<'NODE' | tee \"$BK_DIR/smoke.log\" || die \"smoke test GAGAL\"", "NODE").split('const BASE = "http://127.0.0.1:4000";').join(`const BASE = "${server.baseUrl}";`).split("/app/").join(`${pathToFileURL(backend).href}/`);
  const env = { BASE_TIDAK_SEIMBANG: "0", ORDER_N: String(await hitung('select count(*)::int n from "Order"')), JOB_N: String(await hitung("select count(*)::int n from jobs")) };
  const sebelum = { progres: await hitung("select count(*)::int n from production_unit_work_progress"), act: await hitung("select count(*)::int n from activity_events"), sm: await hitung("select count(*)::int n from stock_movements") };
  const r = await jalankan(kode, env);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /SMOKE_HASIL fail=0 skip=\d+/, r.out);
  assert.ok(!/FAIL /.test(r.out), r.out);
  assert.match(r.out, /PASS\s+catat status kerja: tanpa token 401/);
  assert.match(r.out, /PASS\s+catat status kerja: SALES \(hanya-lihat\) 403/);
  assert.match(r.out, /PASS\s+unit Dijadwalkan RES-19102026-094-U1: detail 200; tindakan berikutnya tidak menulis/);
  assert.match(r.out, /PASS\s+jadwal \+ target unit Bendrya/);
  assert.match(r.out, /PASS\s+TIDAK ada jejak tulis/);
  assert.equal(await hitung("select count(*)::int n from production_unit_work_progress"), sebelum.progres);
  assert.equal(await hitung("select count(*)::int n from activity_events"), sebelum.act);
  assert.equal(await hitung("select count(*)::int n from stock_movements"), sebelum.sm);
});
