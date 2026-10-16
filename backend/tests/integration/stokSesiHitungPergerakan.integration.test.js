// Pergerakan masuk/keluar SETELAH barang dihitung tetapi SEBELUM Stock Count selesai: tanda YA/TIDAK, selisih, posting, dan saldo akhir tidak boleh menghitung pergerakan dua kali.
// Invarian yang diuji (sapuan kombinasi): saldo akhir − Σ qty pergerakan bertanda TIDAK == hasil hitung fisik.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { TEST_DATABASE_URL } from "./setup/env.js";
import { postStockMovement, lockMaterialBalance } from "../../src/services/inventoryLedger.js";
import { KOLOM_HITUNG } from "../../src/services/opnameCutover.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const akun = async (roles) => { const u = await createTestUser({ roles }); return { ...u, c: makeClient(server.baseUrl, u.token) }; };
const saldo = async (id) => { const [{ s }] = await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`; return s; };
const gerak = (materialId, qty, note = "pergerakan sesi") => testPrisma.stockMovement.create({ data: { materialId, type: qty > 0 ? "RECEIPT" : "ISSUE", qty, note } });
async function mulaiSesi(gudang, materialIds) {
  const cr = await gudang.c.post("/api/inventory/stock-counts", { countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: materialIds.map((materialId) => ({ materialId })) });
  const st = await gudang.c.post(`/api/inventory/stock-counts/${cr.body.id}/start`, {});
  assert.equal(st.status, 200, JSON.stringify(st.body));
  return { id: cr.body.id, no: cr.body.countNumber, lines: st.body.lines, startedAt: st.body.startedAt };
}
const isi = async (gudang, s, materialId, counted, reason = "selisih uji") => {
  const line = s.lines.find((l) => l.materialId === materialId);
  const r = await gudang.c.patch(`/api/inventory/stock-counts/${s.id}/lines/${line.id}`, { countedQty: counted, reason });
  assert.equal(r.status, 200, JSON.stringify(r.body));
};
const tandai = (gudang, s, movId, tercermin) => gudang.c.post(`/api/inventory/stock-counts/${s.id}/pergerakan/${movId}/tanda`, { tercermin });
const kirim = async (gudang, s) => assert.equal((await gudang.c.post(`/api/inventory/stock-counts/${s.id}/submit`, {})).status, 200);

test("masuk setelah dihitung, ditandai TIDAK: selisih = hitung − snapshot; saldo akhir = hitung + pergerakan (tidak dihitung dua kali)", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 20);
  const s = await mulaiSesi(gudang, [m.id]);
  await isi(gudang, s, m.id, 18, "susut 2");           // dihitung 18
  const masuk = await gerak(m.id, 5);                  // barang 5 masuk SETELAH dihitung
  await kirim(gudang, s);
  assert.equal((await tandai(gudang, s, masuk.id, false)).status, 200);
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {})).status, 200);
  const adj = await testPrisma.stockMovement.findMany({ where: { stockCountId: s.id, type: "ADJUSTMENT" } });
  assert.equal(adj.length, 1); assert.equal(Number(adj[0].qty), -2);
  assert.equal(await saldo(m.id), 23, "18 fisik + 5 yang masuk setelahnya");
});

test("keluar setelah dihitung, ditandai TIDAK; dan keluar yang sudah terhitung, ditandai YA — campuran pada satu material", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 30);
  const s = await mulaiSesi(gudang, [m.id]);
  const sudah = await gerak(m.id, -4, "keluar sebelum dihitung (diposting setelah snapshot)");
  await isi(gudang, s, m.id, 25, "fisik 25");          // fisik 25 sudah memuat -4 (30-4=26 → selisih -1)
  const belum = await gerak(m.id, -3, "keluar setelah dihitung");
  await kirim(gudang, s);
  await tandai(gudang, s, sudah.id, true); await tandai(gudang, s, belum.id, false);
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {})).status, 200);
  const adj = (await testPrisma.stockMovement.findMany({ where: { stockCountId: s.id, type: "ADJUSTMENT" } }));
  assert.equal(adj.length, 1); assert.equal(Number(adj[0].qty), -1, "25 − (30 + (−4))");
  assert.equal(await saldo(m.id), 22, "25 fisik − 3 yang keluar setelahnya");
});

test("pergerakan diposting SETELAH submit tetapi sebelum Complete: Complete ditolak sampai ditandai; tanpa tanda tidak ada ADJUSTMENT", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const s = await mulaiSesi(gudang, [m.id]);
  await isi(gudang, s, m.id, 9, "susut"); await kirim(gudang, s);
  const telat = await gerak(m.id, 2, "GR diposting sesudah submit");
  const tolak = await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {});
  assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "PERGERAKAN_SESI_BELUM_DITANDAI");
  assert.equal(await testPrisma.stockMovement.count({ where: { stockCountId: s.id } }), 0);
  await tandai(gudang, s, telat.id, false);
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {})).status, 200);
  assert.equal(await saldo(m.id), 11, "9 fisik + 2");
});

test("tanda BASI: hasil hitung diubah setelah ditandai → tanda direset (harus ditandai ulang); hitung ulang mereset semua; tidak ada hitungan ganda", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 20);
  const s = await mulaiSesi(gudang, [m.id]);
  await isi(gudang, s, m.id, 18, "hitung pertama (sebelum barang masuk)");
  const masuk = await gerak(m.id, 5, "barang masuk setelah hitung pertama");
  await kirim(gudang, s);
  await tandai(gudang, s, masuk.id, false);                      // benar untuk hitung pertama
  // hitung ulang SESUDAH barang masuk: fisik baru 23 SUDAH memuat +5
  assert.equal((await gudang.c.post(`/api/inventory/stock-counts/${s.id}/recount`, {})).status, 200);
  const detail = (await gudang.c.get(`/api/inventory/stock-counts/${s.id}`)).body;
  assert.equal(detail.pergerakanSesi[0].tanda, null, "recount mereset tanda lama (yang kini basi)");
  await isi(gudang, s, m.id, 23, "hitung ulang"); await kirim(gudang, s);
  const tolak = await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {});
  assert.equal(tolak.status, 409, "belum ditandai ulang");
  await tandai(gudang, s, masuk.id, true);                       // fisik baru sudah memuat +5
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {})).status, 200);
  const adj = await testPrisma.stockMovement.findMany({ where: { stockCountId: s.id, type: "ADJUSTMENT" } });
  assert.equal(adj.length, 1); assert.equal(Number(adj[0].qty), -2, "23 − (snapshot 20 + 5 yang kini ditandai sudah terhitung)");
  assert.equal(await saldo(m.id), 23, "saldo akhir = hasil hitung ulang (+5 tidak dihitung dua kali)");
});

test("mengubah angka hitung saat WAITING_REVIEW mereset tanda material itu saja", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const a = await createTestMaterial(); const b = await createTestMaterial(); await seedBalance(a.id, 10); await seedBalance(b.id, 10);
  const s = await mulaiSesi(gudang, [a.id, b.id]);
  await isi(gudang, s, a.id, 10, "x"); await isi(gudang, s, b.id, 10, "x");
  const ma = await gerak(a.id, 1); const mb = await gerak(b.id, 1);
  await kirim(gudang, s);
  await tandai(gudang, s, ma.id, false); await tandai(gudang, s, mb.id, false);
  await isi(gudang, s, a.id, 11, "dikoreksi");                   // hanya A berubah
  const detail = (await gudang.c.get(`/api/inventory/stock-counts/${s.id}`)).body;
  const tanda = Object.fromEntries(detail.pergerakanSesi.map((p) => [p.id, p.tanda]));
  assert.equal(tanda[ma.id], null, "tanda A direset"); assert.equal(tanda[mb.id], "BELUM_TERHITUNG", "tanda B tetap");
  void owner;
});

test("Start mengunci material: pergerakan yang sedang diposting masuk snapshot, TIDAK menyelinap di antara snapshot dan startedAt (tidak hilang, tidak ganda)", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 20);
  const cr = await gudang.c.post("/api/inventory/stock-counts", { countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: [{ materialId: m.id }] });
  let mulaiStart; let startSelesai = false;
  // transaksi lain memegang kunci material dan memposting +5 (belum commit) — seperti putaway GR yang sedang berjalan
  await testPrisma.$transaction(async (tx) => {
    await lockMaterialBalance(tx, m.id);
    mulaiStart = gudang.c.post(`/api/inventory/stock-counts/${cr.body.id}/start`, {}).then((r) => { startSelesai = true; return r; });
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(startSelesai, false, "Start menunggu kunci material");
    await postStockMovement(tx, { materialId: m.id, type: "RECEIPT", qty: 5, note: "putaway yang sedang berjalan" });
  });
  const st = await mulaiStart;
  assert.equal(st.status, 200, JSON.stringify(st.body));
  assert.equal(st.body.lines[0].systemQty, 25, "snapshot memuat +5 yang sudah commit");
  const detail = (await gudang.c.get(`/api/inventory/stock-counts/${cr.body.id}`)).body;
  assert.equal(detail.pergerakanSesi.length, 0, "+5 BUKAN pergerakan sesi (sudah di snapshot) → tidak ada hitungan ganda");
  // hitung 25 → tidak ada selisih
  const line = st.body.lines[0];
  await gudang.c.patch(`/api/inventory/stock-counts/${cr.body.id}/lines/${line.id}`, { countedQty: 25 });
  await gudang.c.post(`/api/inventory/stock-counts/${cr.body.id}/submit`, {});
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${cr.body.id}/complete`, {})).status, 200);
  assert.equal(await testPrisma.stockMovement.count({ where: { stockCountId: cr.body.id } }), 0);
  assert.equal(await saldo(m.id), 25);
});

test("SAPUAN kombinasi: 12 material dengan 0–3 pergerakan acak (deterministik) dan tanda acak → invarian: saldo akhir − Σ(qty bertanda TIDAK) = hasil hitung", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  let seed = 7; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const mats = []; for (let i = 0; i < 12; i++) { const m = await createTestMaterial(); await seedBalance(m.id, 50); mats.push(m); }
  const s = await mulaiSesi(gudang, mats.map((m) => m.id));
  const rencana = [];
  for (const m of mats) {
    const hitung = 10 + Math.floor(rnd() * 50); // ≥ 10: pergerakan keluar total maksimum 9, agar hasil akhir fisik tidak negatif
    await isi(gudang, s, m.id, hitung, "sapuan");
    const geraks = [];
    for (let k = 0, n = Math.floor(rnd() * 4); k < n; k++) { const q = (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 3)); geraks.push({ mov: await gerak(m.id, q), q, tercermin: rnd() < 0.5 }); }
    rencana.push({ m, hitung, geraks });
  }
  await kirim(gudang, s);
  for (const r of rencana) for (const g of r.geraks) assert.equal((await tandai(gudang, s, g.mov.id, g.tercermin)).status, 200);
  const sebelumJumlahMov = await testPrisma.stockMovement.count();
  const ok = await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  for (const r of rencana) {
    const sigmaTidak = r.geraks.filter((g) => !g.tercermin).reduce((a, g) => a + g.q, 0);
    const sigmaYa = r.geraks.filter((g) => g.tercermin).reduce((a, g) => a + g.q, 0);
    const akhir = await saldo(r.m.id);
    assert.equal(akhir - sigmaTidak, r.hitung, `invarian ${r.m.code}: akhir ${akhir}, TIDAK ${sigmaTidak}, hitung ${r.hitung}`);
    const adj = await testPrisma.stockMovement.findMany({ where: { materialId: r.m.id, type: "ADJUSTMENT", stockCountId: s.id } });
    assert.ok(adj.length <= 1, "paling banyak satu ADJUSTMENT per material");
    assert.equal(adj.length ? Number(adj[0].qty) : 0, r.hitung - (50 + sigmaYa), `selisih ${r.m.code}`);
  }
  const adjTotal = await testPrisma.stockMovement.count({ where: { stockCountId: s.id } });
  assert.equal(await testPrisma.stockMovement.count(), sebelumJumlahMov + adjTotal, "Complete hanya menambah ADJUSTMENT milik count — pergerakan sesi tidak ditulis ulang");
  const kedua = await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {});
  assert.equal(kedua.status, 400, "Complete kedua ditolak (tidak ada posting ganda)");
});

test("preview (--stock-count) dan posting Complete menghasilkan selisih yang SAMA untuk skenario campuran YA/TIDAK", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 30);
  const s = await mulaiSesi(gudang, [m.id]);
  const ya = await gerak(m.id, -4, "sudah terhitung"); const tidak = await gerak(m.id, 6, "belum terhitung");
  await isi(gudang, s, m.id, 24, "fisik 24");               // pembanding = 30 + (−4) = 26 → selisih −2
  await kirim(gudang, s);
  await tandai(gudang, s, ya.id, true); await tandai(gudang, s, tidak.id, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opname-sesi-"));
  const file = path.join(dir, "bukti.xlsx");
  const wb = new ExcelJS.Workbook(); const h = wb.addWorksheet("Hitung"); const K = Object.values(KOLOM_HITUNG); h.addRow(K);
  const wib = (d) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  // lembar HANYA membawa metadata (lokasi, penghitung, pemeriksa, bukti); angka & waktu diambil dari Stock Count
  h.addRow(K.map((k) => ({ [KOLOM_HITUNG.materialId]: m.id, [KOLOM_HITUNG.kode]: m.code, [KOLOM_HITUNG.satuan]: m.unit, [KOLOM_HITUNG.lokasi]: "RAW-MATERIAL", [KOLOM_HITUNG.penghitung]: "Petugas A", [KOLOM_HITUNG.pemeriksa]: "Petugas B", [KOLOM_HITUNG.bukti]: "FOTO-1" }[k] ?? null)));
  await wb.xlsx.writeFile(file);
  void wib;
  const out = path.join(dir, "out");
  const run = spawnSync(process.execPath, ["scripts/opname-preview.mjs", "--file", file, "--out", out, "--stock-count", s.no], {
    cwd: path.resolve(import.meta.dirname, "../.."), env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const p = JSON.parse(fs.readFileSync(path.join(out, "preview.json"), "utf8")).materials.find((x) => x.materialId === m.id);
  assert.equal(p.fisikMilikSano, 24);
  assert.equal(p.delta, -2, JSON.stringify(p.isu));
  assert.ok(!p.isu.some((i) => i.level === "BLOCKER"), JSON.stringify(p.isu));
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {})).status, 200);
  const adj = await testPrisma.stockMovement.findFirst({ where: { stockCountId: s.id, type: "ADJUSTMENT" } });
  assert.equal(Number(adj.qty), p.delta, "preview = yang diposting");
});

test("preview --stock-count tanpa lembar: angka & waktu dari Stock Count, metadata kosong → BLOCKER (tidak ada nama/lokasi/bukti yang ditebak)", async () => {
  const gudang = await akun(["WAREHOUSE"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const s = await mulaiSesi(gudang, [m.id]);
  await isi(gudang, s, m.id, 9, "susut"); await kirim(gudang, s);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opname-sesi2-"));
  const run = spawnSync(process.execPath, ["scripts/opname-preview.mjs", "--out", dir, "--stock-count", s.no], { cwd: path.resolve(import.meta.dirname, "../.."), env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const p = JSON.parse(fs.readFileSync(path.join(dir, "preview.json"), "utf8")).materials.find((x) => x.materialId === m.id);
  assert.equal(p.fisikMilikSano, 9);
  const kode = p.isu.map((i) => i.kode);
  for (const k of ["LOKASI_KOSONG", "PENGHITUNG_KOSONG", "PEMERIKSA_KOSONG"]) assert.ok(kode.includes(k), k);
  assert.equal(p.statusAkhir, "PERLU_HITUNG_ULANG");
});
