// Uji integrasi pratinjau opname: pembaca ledger/dokumen tertunda BENAR terhadap Postgres sungguhan, transaksi READ ONLY menolak tulis,
// dan CLI scripts/opname-preview.mjs end-to-end (xlsx → preview.json) tidak mengubah satu baris pun.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial } from "./setup/fixtures.js";
import { muatLedger, muatDokumenTertunda, muatSaldoBuku1400, muatMaterials, KOLOM_HITUNG, KOLOM_LOG, KOLOM_HARGA } from "../../src/services/opnameCutover.js";
import { TEST_DATABASE_URL } from "./setup/env.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

test.before(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const hitung = async () => ({
  mov: await testPrisma.stockMovement.count(), adj: await testPrisma.stockAdjustmentRequest.count(), jv: await testPrisma.finJournalEntry.count(),
  gr: await testPrisma.goodsReceipt.count(),
});

test("muatLedger memotong pergerakan pada waktu yang diminta (bukan saldo hari ini); dokumen tertunda & saldo 1-1400 dapat dibaca", async () => {
  const m = await createTestMaterial();
  const t0 = new Date("2026-10-31T01:00:00Z");
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 100, createdAt: t0, note: "awal" } });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -30, createdAt: new Date("2026-10-31T03:00:00Z"), note: "pakai" } });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 7, createdAt: new Date("2026-11-02T03:00:00Z"), note: "tanpa dokumen" } });
  const sampaiAwal = await muatLedger(testPrisma, [m.id], new Date("2026-10-31T02:00:00Z"));
  assert.equal(sampaiAwal.get(m.id).reduce((s, x) => s + x.qty, 0), 100);
  const semua = await muatLedger(testPrisma, [m.id], new Date("2026-11-30T00:00:00Z"));
  assert.equal(semua.get(m.id).length, 3);
  assert.equal(semua.get(m.id)[2].tanpaDokumen, true, "RECEIPT tanpa GR = jalur cepat");
  const g = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-TEST-OPN", sourceType: "PURCHASE_ORDER", status: "READY_FOR_PUTAWAY", supplier: "T", lines: { create: [{ materialId: m.id, orderedQty: 5, receivedQty: 5, acceptedQty: 5 }] } } });
  const pend = await muatDokumenTertunda(testPrisma);
  assert.ok(pend.some((p) => p.jenis === "GR_TERTUNDA" && p.dok === "GR-TEST-OPN" && p.materialCode === m.code && p.qty === 5));
  assert.equal(typeof (await muatSaldoBuku1400(testPrisma, "2026-10-31")), "number");
  assert.ok((await muatMaterials(testPrisma)).some((x) => x.id === m.id));
  await testPrisma.goodsReceipt.delete({ where: { id: g.id } });
});

test("transaksi SET TRANSACTION READ ONLY menolak penulisan stok (jaminan skrip dry-run)", async () => {
  const m = await createTestMaterial();
  const sebelum = await hitung();
  await assert.rejects(testPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 1, note: "harus gagal" } });
  }), /read-only|read only/i);
  assert.deepEqual(await hitung(), sebelum);
});

test("CLI opname-preview.mjs: xlsx terisi → preview.json; selisih terhadap ledger saat hitung; DB tidak berubah; --apply ditolak", async () => {
  const m = await createTestMaterial(); const kosongan = await createTestMaterial();
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 100, createdAt: new Date("2026-10-31T01:00:00Z"), note: "awal" } });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 50, createdAt: new Date("2026-10-31T09:00:00Z"), note: "setelah hitung" } }); // setelah 15:00 WIB? 16:00 WIB
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opname-"));
  const file = path.join(dir, "terisi.xlsx");
  const wb = new ExcelJS.Workbook();
  const h = wb.addWorksheet("Hitung");
  const K = Object.values(KOLOM_HITUNG);
  h.addRow(["PETUNJUK (baris sebelum judul diabaikan)"]);
  h.addRow(K);
  const baris = (o) => K.map((k) => o[k] ?? null);
  h.addRow(baris({ [KOLOM_HITUNG.materialId]: m.id, [KOLOM_HITUNG.kode]: m.code, [KOLOM_HITUNG.satuan]: m.unit, [KOLOM_HITUNG.lokasi]: "RAW-MATERIAL", [KOLOM_HITUNG.status]: "DIHITUNG", [KOLOM_HITUNG.qtyRak]: 95, [KOLOM_HITUNG.mulai]: "2026-10-31 09:00", [KOLOM_HITUNG.selesai]: "2026-10-31 10:00", [KOLOM_HITUNG.penghitung]: "Andi", [KOLOM_HITUNG.pemeriksa]: "Budi", [KOLOM_HITUNG.bukti]: "FOTO-1" }));
  h.addRow(baris({ [KOLOM_HITUNG.materialId]: kosongan.id, [KOLOM_HITUNG.kode]: kosongan.code, [KOLOM_HITUNG.satuan]: kosongan.unit, [KOLOM_HITUNG.lokasi]: "RAW-MATERIAL", [KOLOM_HITUNG.status]: "NOL_FISIK", [KOLOM_HITUNG.qtyRak]: 0, [KOLOM_HITUNG.mulai]: "2026-10-31 09:00", [KOLOM_HITUNG.selesai]: "2026-10-31 10:00", [KOLOM_HITUNG.penghitung]: "Andi", [KOLOM_HITUNG.pemeriksa]: "Budi", [KOLOM_HITUNG.bukti]: "FOTO-2" }));
  wb.addWorksheet("Log pergerakan jendela").addRow(Object.values(KOLOM_LOG));
  const hf = wb.addWorksheet("Harga Finance"); hf.addRow(Object.values(KOLOM_HARGA)); hf.addRow([m.code, 20000, "FAKTUR", "INV-1", ""]);
  await wb.xlsx.writeFile(file);

  const sebelum = await hitung();
  const out = path.join(dir, "keluaran");
  const run = spawnSync(process.execPath, ["scripts/opname-preview.mjs", "--file", file, "--out", out, "--cutoff", "2026-10-31 23:59", "--saldo-1400-sampai", "2026-10-31"], {
    cwd: path.resolve(import.meta.dirname, "../.."), env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const prev = JSON.parse(fs.readFileSync(path.join(out, "preview.json"), "utf8"));
  assert.equal(prev.dryRun, true); assert.equal(prev.meta.readOnly, true);
  const a = prev.materials.find((x) => x.materialId === m.id);
  assert.equal(a.ledgerSaatHitung, 100, "ledger pada selesai hitung (10:00 WIB), tanpa penerimaan 16:00 WIB");
  assert.equal(a.delta, -5); assert.equal(a.ledgerCutoff, 150); assert.equal(a.fisikProyeksiCutoff, 145);
  assert.equal(a.nilai.status, "DITETAPKAN"); assert.equal(a.nilai.nilaiSelisih, -100000);
  const b = prev.materials.find((x) => x.materialId === kosongan.id);
  assert.equal(b.fisikMilikSano, 0); assert.equal(b.delta, 0);
  assert.ok(fs.existsSync(path.join(out, "preview.xlsx")));
  const rencana = fs.readFileSync(path.join(out, "rencana-adjustment.csv"), "utf8").trim().split("\n");
  assert.equal(rencana.length, 2, "header + satu selisih (material nol fisik tanpa selisih tidak masuk)");
  assert.match(rencana[1], new RegExp("OPNAME-2026-10-31:" + m.code)); assert.match(rencana[1], /-5/);
  assert.deepEqual(await hitung(), sebelum, "tidak ada tulis ke stok/dokumen/jurnal");

  const tolak = spawnSync(process.execPath, ["scripts/opname-preview.mjs", "--file", file, "--apply"], { cwd: path.resolve(import.meta.dirname, "../.."), env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, encoding: "utf8" });
  assert.equal(tolak.status, 2);
});

test("preview membaca tanda sesi Stock Count (--stock-count): belum ditandai → BLOCKER; ditandai YA/TIDAK → ledger pembanding menyesuaikan, tanpa menulis", async () => {
  const server = await startTestServer(buildTestApp());
  try {
    const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
    const c = makeClient(server.baseUrl, gudang.token);
    const m = await createTestMaterial();
    await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 100, createdAt: new Date(Date.now() - 3600_000), note: "awal" } });
    const cr = await c.post("/api/inventory/stock-counts", { countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: [{ materialId: m.id }] });
    const st = await c.post(`/api/inventory/stock-counts/${cr.body.id}/start`, {});
    const mulai = new Date(st.body.startedAt);
    const mv = await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -10, note: "pemakaian selama sesi" } });
    const wib = (d) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opname-sc-"));
    const file = path.join(dir, "terisi.xlsx");
    const wb = new ExcelJS.Workbook();
    const h = wb.addWorksheet("Hitung");
    const K = Object.values(KOLOM_HITUNG);
    h.addRow(K);
    const baris = (o) => K.map((k) => o[k] ?? null);
    h.addRow(baris({ [KOLOM_HITUNG.materialId]: m.id, [KOLOM_HITUNG.kode]: m.code, [KOLOM_HITUNG.satuan]: m.unit, [KOLOM_HITUNG.lokasi]: "RAW-MATERIAL", [KOLOM_HITUNG.status]: "DIHITUNG", [KOLOM_HITUNG.qtyRak]: 90,
      [KOLOM_HITUNG.mulai]: wib(new Date(mulai.getTime() - 120_000)), [KOLOM_HITUNG.selesai]: wib(new Date(Date.now() + 180_000)), [KOLOM_HITUNG.penghitung]: "Andi", [KOLOM_HITUNG.pemeriksa]: "Budi", [KOLOM_HITUNG.bukti]: "FOTO-1" }));
    await wb.xlsx.writeFile(file);
    const sebelum = await testPrisma.stockMovement.count();
    const jalankan = (out) => spawnSync(process.execPath, ["scripts/opname-preview.mjs", "--file", file, "--out", out, "--stock-count", cr.body.countNumber], {
      cwd: path.resolve(import.meta.dirname, "../.."), env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, encoding: "utf8",
    });
    const r1 = jalankan(path.join(dir, "o1"));
    assert.equal(r1.status, 0, r1.stderr + r1.stdout);
    const p1 = JSON.parse(fs.readFileSync(path.join(dir, "o1", "preview.json"), "utf8")).materials.find((x) => x.materialId === m.id);
    assert.equal(p1.statusAkhir, "PERLU_HITUNG_ULANG");
    assert.ok(p1.isu.some((i) => i.kode === "LOG_TANPA_KEPUTUSAN"), "belum ditandai tidak ditebak");
    // penghitung menandai di aplikasi: fisik 90 sudah memuat issue -10 → SESUAI
    assert.equal((await c.post(`/api/inventory/stock-counts/${cr.body.id}/pergerakan/${mv.id}/tanda`, { tercermin: true })).status, 200);
    const r2 = jalankan(path.join(dir, "o2"));
    assert.equal(r2.status, 0, r2.stderr + r2.stdout);
    const p2 = JSON.parse(fs.readFileSync(path.join(dir, "o2", "preview.json"), "utf8")).materials.find((x) => x.materialId === m.id);
    assert.equal(p2.ledgerSaatHitung, 90); assert.equal(p2.delta, 0); assert.equal(p2.kelas, "SESUAI");
    // tanda diganti: belum masuk → pembanding 100, fisik 90 → selisih −10
    assert.equal((await c.post(`/api/inventory/stock-counts/${cr.body.id}/pergerakan/${mv.id}/tanda`, { tercermin: false })).status, 200);
    const r3 = jalankan(path.join(dir, "o3"));
    const p3 = JSON.parse(fs.readFileSync(path.join(dir, "o3", "preview.json"), "utf8")).materials.find((x) => x.materialId === m.id);
    assert.equal(p3.ledgerSaatHitung, 100); assert.equal(p3.delta, -10);
    assert.equal(await testPrisma.stockMovement.count(), sebelum, "preview tidak menulis movement");
  } finally { await server.close(); }
});
