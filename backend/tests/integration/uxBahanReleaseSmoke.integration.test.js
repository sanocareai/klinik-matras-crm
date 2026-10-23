// Menjalankan blok REHEARSAL dan SMOKE dari scripts/release-ux-bahan.sh — kode Node yang sama persis yang akan jalan di produksi — terhadap DB terisolasi berisi unit/bahan/akun seperti produksi.
// Tujuan: skrip rilis tidak boleh pertama kali dieksekusi di produksi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skrip = fs.readFileSync(path.resolve(backend, "../scripts/release-ux-bahan.sh"), "utf8").replace(/\r\n/g, "\n");
const blok = (pembuka, penutup) => { const a = skrip.indexOf(pembuka); assert.ok(a > 0, `pembuka ${pembuka} tidak ada`); const mulai = skrip.indexOf("\n", a) + 1; const b = skrip.indexOf(`\n${penutup}\n`, mulai); assert.ok(b > 0, `penutup ${penutup} tidak ada`); return skrip.slice(mulai, b); };

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dataset() {
  const a = await createTestUser({ roles: ["ADMIN"] }); await createTestUser({ roles: ["SALES"] });
  const { unit } = await createTestUnit({ status: "RECEIVED" });
  await createTestMaterial({ code: "BUSA-REH-1", name: "Busa Rehearsal 5 cm", unit: "M3", itemGroup: "HR FOAM" });
  return { admin: { ...a, api: makeClient(server.baseUrl, a.token) }, unit };
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

test("REHEARSAL (blok skrip rilis): usulan, keputusan, pemakaian sementara, koreksi, batal, rekonsiliasi — tanpa efek stok/jurnal; trigger menahan baris final", async () => {
  await dataset();
  const kode = blok("<<'REHNODE' > \"$BK_DIR/rehearsal-koreksi.log\" 2>&1 || { cat \"$BK_DIR/rehearsal-koreksi.log\"; reh_drop; die \"uji UX Bahan terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)\"; }", "REHNODE").split("/app/").join(`${pathToFileURL(backend).href}/`);
  const r = await jalankan(kode);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /PEMERIKSAAN=\d+ gagal=0/);
  assert.ok(!/^GAGAL/m.test(r.out), r.out);
  assert.ok(!/^SKIP/m.test(r.out), "tidak ada pemeriksaan yang dilewati pada dataset ini: " + r.out);
  for (const t of [
    /OK\s+tabel rilis kosong setelah migrasi/, /OK\s+kode baru: hanya pemakaian sementara → 'Sudah dikerjakan' bersumber PEMAKAIAN_SEMENTARA/, /OK\s+usulan bahan \(serentak ×3\): tepat SATU baris usulan/,
    /OK\s+usulan TIDAK membuat Material/, /OK\s+nama yang SAMA dengan bahan katalog ditolak/, /OK\s+keputusan SETUJUI: Material dibuat di katalog/, /OK\s+membuat katalog TIDAK menambah saldo/,
    /OK\s+pemakaian sementara pada .* \(serentak ×3, kunci sama\): tepat SATU catatan/, /OK\s+pemakaian sementara TIDAK menyentuh stok/, /OK\s+daftar kerja: 'Sudah dikerjakan' dengan sumber 'Pemakaian sementara/,
    /OK\s+koreksi beralasan: catatan lama DIBATALKAN/, /OK\s+setelah koreksi: bukti kerja pindah/, /OK\s+setelah pembatalan salah input: status kerja KEMBALI/, /OK\s+audit tercatat/,
    /OK\s+rekonsiliasi 'bukan stok Gudang'/, /OK\s+pembatalan catatan 'bukan stok Gudang' oleh pemegang hak Gudang/, /OK\s+trigger DB: baris final tidak bisa diubah\/dihapus/, /OK\s+seluruh rangkaian tulis: stok, Material Issue/,
  ]) assert.match(r.out, t);
});

test("SMOKE (blok skrip rilis): izin 401/403, antrean kosong, panel unit, ekspor Excel, tabel rilis kosong, tanpa jejak tulis", async () => {
  await dataset();
  const kode = blok("<<'NODE' | tee \"$BK_DIR/smoke.log\" || die \"smoke test GAGAL\"", "NODE").split('const BASE = "http://127.0.0.1:4000";').join(`const BASE = "${server.baseUrl}";`).split("/app/").join(`${pathToFileURL(backend).href}/`);
  const env = { BASE_TIDAK_SEIMBANG: "0", ORDER_N: String(await hitung('select count(*)::int n from "Order"')), JOB_N: String(await hitung("select count(*)::int n from jobs")) };
  const sebelum = { prop: await hitung("select count(*)::int n from material_proposals"), sem: await hitung("select count(*)::int n from unit_provisional_usages"), sm: await hitung("select count(*)::int n from stock_movements"), mat: await hitung("select count(*)::int n from materials"), act: await hitung("select count(*)::int n from activity_events") };
  const r = await jalankan(kode, env);
  assert.equal(r.kode, 0, r.out);
  assert.match(r.out, /SMOKE_HASIL fail=0 skip=\d+/, r.out);
  assert.ok(!/FAIL /.test(r.out), r.out);
  for (const t of [/PASS\s+usul bahan: tanpa token 401/, /PASS\s+catat pemakaian sementara: tanpa token 401/, /PASS\s+keputusan usulan: tanpa token 401/, /PASS\s+usul bahan: SALES \(hanya-lihat\) 403/, /PASS\s+antrean usulan \(Admin\) 200 dan kosong/,
    /PASS\s+antrean pemakaian sementara \(Admin\) 200 dan kosong/, /PASS\s+cek duplikasi nama \(baca-saja\) 200/, /PASS\s+panel unit .* \(Admin\) 200: pemakaianSementara ada dan kosong/, /PASS\s+panel unit \(SALES hanya-lihat\) 200 dan izin catat\/usul = false/,
    /PASS\s+ekspor Excel memuat sheet 'Pemakaian Sementara'/, /PASS\s+TIDAK ada jejak tulis/]) assert.match(r.out, t);
  assert.equal(await hitung("select count(*)::int n from material_proposals"), sebelum.prop);
  assert.equal(await hitung("select count(*)::int n from unit_provisional_usages"), sebelum.sem);
  assert.equal(await hitung("select count(*)::int n from stock_movements"), sebelum.sm);
  assert.equal(await hitung("select count(*)::int n from materials"), sebelum.mat);
  assert.equal(await hitung("select count(*)::int n from activity_events"), sebelum.act);
});
