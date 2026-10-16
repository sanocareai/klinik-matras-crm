// Impor stok dari file: pratinjau CLI (--db, READ ONLY) → rencana → DRAFT Stock Adjustment lewat API resmi, idempoten.
// Invarian: tidak ada movement/jurnal baru, status tetap DRAFT, run kedua tidak membuat apa pun, --apply ditolak, tanpa bukti rencana kosong.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { TEST_DATABASE_URL } from "./setup/env.js";
import { ajukanDraft } from "../../src/services/stokFileImport.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const HEAD = Array(70).fill("");
[[0, "KODE BANG"], [1, "NAMA BARANG"], [2, "SATUAN"], [3, "JENIS"], [4, "BARANG"], [5, "VENDOR"], [43, "HARGA ACT"], [44, "MASUK"], [45, "KELUAR"], [46, "SISA"], [47, "QTY SEP"], [48, "QTY Selisih"], [49, "SATUAN"],
  [52, "HARGA ACT"], [53, "MASUK"], [54, "KELUAR"], [55, "SISA"], [56, "QTY OKT"], [57, "QTY SELISIH"], [58, "SATUAN"]].forEach(([i, v]) => { HEAD[i] = v; });
const row = (nama, satuan, sep) => { const r = Array(70).fill(""); r[1] = nama; r[2] = satuan; r[3] = "MATERIAL"; r[47] = sep; r[49] = satuan; return r; };
const tulisCsv = (dir, rows) => { const f = path.join(dir, "stock.csv"); fs.writeFileSync(f, [["x"], HEAD, ...rows].map((r) => r.join(",")).join("\r\n")); return f; };
const cwd = path.resolve(import.meta.dirname, "../..");
const cli = (args) => spawnSync(process.execPath, ["scripts/opname-impor-stock-file.mjs", ...args], { cwd, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, encoding: "utf8" });
const jumlah = async () => ({ mov: await testPrisma.stockMovement.count(), adj: await testPrisma.stockAdjustmentRequest.count(), jurnal: await testPrisma.finJournalEntry.count() });

test("alur lengkap: tanpa bukti → rencana kosong; dengan bukti → rencana; DRAFT idempoten; ledger & jurnal tidak berubah", async () => {
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] }); const c = makeClient(server.baseUrl, gudang.token);
  const a = await createTestMaterial({ unit: "METER", name: "Kain Impor A" }); const b = await createTestMaterial({ unit: "ROLL", name: "List Impor B" }); const kosong = await createTestMaterial({ unit: "PCS", name: "Paku Impor C" });
  await seedBalance(a.id, 100); await seedBalance(b.id, 5); await seedBalance(kosong.id, 7);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "impor-stok-"));
  const f = tulisCsv(dir, [row(a.name, "METER", "90"), row(b.name, "METER", "450"), row(kosong.name, "PCS", "")]);
  // penerimaan SESUDAH waktu hitung: harus tetap utuh
  const T = new Date(Date.now() - 3600_000); await testPrisma.stockMovement.updateMany({ where: {}, data: { createdAt: new Date(T.getTime() - 86400_000) } });
  await testPrisma.stockMovement.create({ data: { materialId: a.id, type: "RECEIPT", qty: 20, note: "GR sesudah hitung", createdAt: new Date(T.getTime() + 1800_000) } });
  const awal = await jumlah();

  // 1. tanpa bukti
  const out1 = path.join(dir, "o1");
  const r1 = cli(["--csv", f, "--db", "--out", out1, "--skenario", fmt(T)]); assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  const p1 = JSON.parse(fs.readFileSync(path.join(out1, "pratinjau.json"), "utf8"));
  assert.equal(p1.ringkasan.buktiWaktu, "TIDAK ADA"); assert.ok(p1.bahan.every((x) => x.status !== "SIAP_DITINJAU"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out1, "rencana-draft.json"), "utf8")), []);
  assert.equal(p1.bahan.find((x) => x.kode === kosong.code).status, "BELUM_DIHITUNG");

  // 2. dengan bukti
  const out2 = path.join(dir, "o2");
  const r2 = cli(["--csv", f, "--db", "--out", out2, "--waktu-hitung", fmt(T), "--sumber-waktu", "foto form #1", "--penghitung", "A", "--pemeriksa", "B", "--bukti-petugas", "form #1"]);
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  const p2 = JSON.parse(fs.readFileSync(path.join(out2, "pratinjau.json"), "utf8"));
  const pa = p2.bahan.find((x) => x.kode === a.code); const pb = p2.bahan.find((x) => x.kode === b.code);
  assert.equal(pa.status, "SIAP_DITINJAU"); assert.equal(pa.delta, -10); assert.equal(pa.proyeksiKini, 110, "90 fisik + 20 GR sesudah hitung");
  assert.equal(pb.status, "BLOCKER"); assert.ok(pb.isu.some((i) => i.kode === "SATUAN_BEDA"));
  const rencana = JSON.parse(fs.readFileSync(path.join(out2, "rencana-draft.json"), "utf8"));
  assert.deepEqual(rencana.map((x) => x.kode), [a.code]);

  // 3. DRAFT lewat API resmi: dry-run, apply, ulang
  const dry = await ajukanDraft({ plan: rencana, client: c, apply: false });
  assert.equal(dry.dryRun, true); assert.equal(dry.dibuat.length, 1); assert.deepEqual(await jumlah(), awal, "dry-run tidak menulis");
  const ap = await ajukanDraft({ plan: rencana, client: c, apply: true });
  assert.equal(ap.dibuat.length, 1, JSON.stringify(ap)); assert.equal(ap.dibuat[0].status, "DRAFT");
  const ulang = await ajukanDraft({ plan: rencana, client: c, apply: true });
  assert.equal(ulang.dibuat.length, 0); assert.equal(ulang.dilewati.length, 1);
  const baru = await jumlah();
  assert.equal(baru.adj, awal.adj + 1, "tepat satu draft"); assert.equal(baru.mov, awal.mov, "tidak ada movement"); assert.equal(baru.jurnal, awal.jurnal, "tidak ada jurnal");
  const req = await testPrisma.stockAdjustmentRequest.findFirst({ where: { materialId: a.id } });
  assert.equal(req.status, "DRAFT"); assert.equal(Number(req.adjustmentQty), -10); assert.match(req.reason, /^IMPOR-STOK-\d{4}-\d{2}-\d{2}:/);
  const saldoA = await testPrisma.stockMovement.aggregate({ where: { materialId: a.id }, _sum: { qty: true } });
  assert.equal(Number(saldoA._sum.qty), 120, "saldo tidak berubah oleh draft");

  // 4. draft lama dengan delta berbeda tidak ditimpa
  const beda = await ajukanDraft({ plan: [{ ...rencana[0], delta: -3 }], client: c, apply: true });
  assert.equal(beda.dibuat.length, 0); assert.equal(beda.berbedaDenganDraftLama.length, 1);
});

test("CLI menolak --apply/--post/--ajukan dan layout CSV yang berubah", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "impor-stok2-"));
  const f = tulisCsv(dir, [row("X", "PCS", "1")]);
  for (const flag of ["--apply", "--post", "--ajukan"]) assert.equal(cli(["--csv", f, "--db", flag]).status, 2);
  const salah = path.join(dir, "salah.csv"); fs.writeFileSync(salah, "a,b\n1,2");
  const r = cli(["--csv", salah, "--db", "--out", path.join(dir, "o")]); assert.notEqual(r.status, 0);
});

function fmt(d) { const w = new Date(d.getTime() + 7 * 3600_000); return w.toISOString().slice(0, 16).replace("T", " "); }
