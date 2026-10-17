// Rekonsiliasi riwayat Oktober (CLI --db, READ ONLY) di DB terisolasi + bukti bahwa Opname Penuh menetapkan saldo TANPA menghapus/mengubah riwayat.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUnit, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { TEST_DATABASE_URL } from "./setup/env.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const cwd = path.resolve(import.meta.dirname, "../..");
const cli = (args) => spawnSync(process.execPath, ["scripts/opname-rekon-riwayat-okt.mjs", ...args], { cwd, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, encoding: "utf8" });
const HEAD = Array(70).fill("");
[[0, "KODE BANG"], [1, "NAMA BARANG"], [2, "SATUAN"], [3, "JENIS"], [4, "BARANG"], [5, "VENDOR"], [43, "HARGA ACT"], [44, "MASUK"], [45, "KELUAR"], [46, "SISA"], [47, "QTY SEP"], [48, "QTY Selisih"], [49, "SATUAN"],
  [52, "HARGA ACT"], [53, "MASUK"], [54, "KELUAR"], [55, "SISA"], [56, "QTY OKT"], [57, "QTY SELISIH"], [58, "SATUAN"]].forEach(([i, v]) => { HEAD[i] = v; });
const stokRow = (nama, sat, sep) => { const r = Array(70).fill(""); r[1] = nama; r[2] = sat; r[3] = "MATERIAL"; r[47] = sep; r[49] = sat; return r.join(","); };
const pakaiRow = (no, resi, tgl, label, nama, qty) => { const r = Array(22).fill(""); r[0] = no; r[1] = resi; r[2] = "DONE F"; r[8] = tgl; r[9] = label; r[10] = "Bahan"; r[11] = nama; r[14] = qty; r[15] = "METER"; return r.join(","); };
const beliHead = "BULAN KRM,TGL PO,TANGGAL KIRIM,NO SURAT JALAN,NO INVOICE,JENIS,Product Code,Product Description,VENDOR NAME,HARGA EXC,harga inc,satuan,PACK,PO,QTY kirim,PURCHASE INC,PURCHASE EXC,CATATAN,CAT BARANG,BRAND,FOTO,TOP,JATUH TEMPO,BULAN TEMPO,PEMBAYARAN";
const beliRow = (kirim, sj, nama, qty) => { const r = Array(25).fill(""); r[0] = "OKT"; r[1] = kirim; r[2] = kirim; r[3] = sj; r[5] = "BAHAN BAKU"; r[7] = nama; r[8] = "V"; r[11] = "METER"; r[14] = qty; return r.join(","); };

test("CLI --db: pratinjau per Material ID tanpa menulis; pemakaian di ledger tidak dihitung dua kali; PO/estimasi bukan stok; --apply/--import ditolak", async () => {
  const a = await createTestMaterial({ unit: "METER", name: "Kain Riwayat A" }); const b = await createTestMaterial({ unit: "METER", name: "Kain Riwayat B" });
  await seedBalance(a.id, 100); await testPrisma.stockMovement.updateMany({ where: { materialId: a.id }, data: { createdAt: new Date("2026-09-05T00:00:00Z") } });
  // pemakaian yang SUDAH ada di ledger lewat unit order
  const { unit } = await createTestUnit({ unitCode: "RES-05102026-010-U1" });
  await testPrisma.stockMovement.create({ data: { materialId: a.id, type: "ISSUE", qty: -3, unitId: unit.id, note: "Impor pemakaian — order asli RES-05102026-010", createdAt: new Date("2026-09-05T01:00:00Z") } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rekon-riw-"));
  const stok = path.join(dir, "stok.csv"); fs.writeFileSync(stok, [["x"], HEAD, stokRow(a.name, "METER", "90"), stokRow(b.name, "METER", "")].map((r) => (Array.isArray(r) ? r.join(",") : r)).join("\n"));
  const pak = path.join(dir, "pakai.csv"); fs.writeFileSync(pak, ["J", "x", "No,Resi", pakaiRow(1, "RES-05102026-010", "2026-10-05", "OKT", a.name, "3"), pakaiRow(2, "RES-06102026-011", "2026-10-06", "OKT", a.name, "2")].join("\n"));
  const rek = path.join(dir, "rekap.csv"); fs.writeFileSync(rek, "x\ny\n");
  const bel = path.join(dir, "beli.csv"); fs.writeFileSync(bel, [beliHead, beliRow("6 Oktober 2026", "SJ-77", b.name, "5"), beliRow("EST 12 oct", "", a.name, "9")].join("\n"));
  const sebelum = { mov: await testPrisma.stockMovement.count(), adj: await testPrisma.stockAdjustmentRequest.count(), cnt: await testPrisma.stockCount.count(), jurnal: await testPrisma.finJournalEntry.count(), gr: await testPrisma.goodsReceipt.count() };
  const out = path.join(dir, "o");
  const r = cli(["--stok-okt", stok, "--pemakaian", pak, "--rekap-order", rek, "--pembelian", bel, "--db", "--out", out, "--mulai", "2026-10-17 00:00"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const j = JSON.parse(fs.readFileSync(path.join(out, "rekon-riwayat-okt.json"), "utf8"));
  const ja = j.bahan.find((x) => x.kode === a.code); const jb = j.bahan.find((x) => x.kode === b.code);
  assert.equal(ja.titikHitung[0].angka, 90); assert.equal(ja.titikHitung[0].tingkat, "TANPA_TANGGAL");
  assert.equal(ja.pemakaian.length, 2); assert.equal(ja.pemakaian.find((p) => p.resi === "RES-05102026-010").status, "SUDAH_DI_LEDGER_SAMA"); assert.equal(ja.pemakaian.find((p) => p.resi === "RES-06102026-011").status, "BELUM_DI_LEDGER"); assert.ok(ja.penerimaan.some((t) => t.status === "ESTIMASI_BUKAN_BUKTI"));
  assert.equal(jb.titikHitung.length, 0, "SEP kosong = belum diketahui"); assert.equal(jb.perkiraan9Okt, null);
  assert.equal(jb.penerimaan[0].status, "TERBUKTI_TIBA_BELUM_ADA_GR");
  assert.deepEqual({ mov: await testPrisma.stockMovement.count(), adj: await testPrisma.stockAdjustmentRequest.count(), cnt: await testPrisma.stockCount.count(), jurnal: await testPrisma.finJournalEntry.count(), gr: await testPrisma.goodsReceipt.count() }, sebelum, "tidak ada tulis");
  assert.ok(fs.existsSync(path.join(out, "rekon-riwayat-okt.xlsx")));
  for (const flag of ["--apply", "--post", "--ajukan", "--import"]) assert.equal(cli(["--stok-okt", stok, "--db", flag]).status, 2);
});

test("Opname Penuh menetapkan saldo pada waktu hitung TANPA menghapus/mengubah riwayat Oktober; transaksi baru sesudah hitung tetap utuh", async () => {
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] }); const pemeriksa = await createTestUser({ roles: ["WAREHOUSE"] }); const owner = await createTestUser({ roles: ["OWNER"] });
  const cg = makeClient(server.baseUrl, gudang.token); const cp = makeClient(server.baseUrl, pemeriksa.token); const co = makeClient(server.baseUrl, owner.token);
  const m = await createTestMaterial({ unit: "METER", name: "Kain Opname Riwayat" });
  await seedBalance(m.id, 50);
  // riwayat Oktober di ledger (mis. GR + pemakaian lama) — jumlah 50 + 20 − 5 = 65
  const r1 = await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 20, note: "riwayat Oktober GR", createdAt: new Date("2026-10-06T03:00:00Z") } });
  const r2 = await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -5, note: "riwayat Oktober pemakaian", createdAt: new Date("2026-10-07T03:00:00Z") } });
  const idsSebelum = (await testPrisma.stockMovement.findMany({ where: { materialId: m.id }, orderBy: { createdAt: "asc" } })).map((x) => ({ id: x.id, qty: Number(x.qty), at: +x.createdAt, note: x.note }));
  const cr = await cg.post("/api/inventory/stock-counts", { countType: "FULL_STOCK_OPNAME", countMethod: "BY_ITEM", lines: [{ materialId: m.id }] });
  const st = await cg.post(`/api/inventory/stock-counts/${cr.body.id}/start`, {}); assert.equal(st.status, 200);
  const line = st.body.lines[0];
  // transaksi BARU setelah Start (sesi hitung) = pergerakan sesi; fisik 60 dihitung sebelum +8 ini masuk
  const baru = await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 8, note: "transaksi baru setelah mulai hitung" } });
  assert.equal((await cg.patch(`/api/inventory/stock-counts/${cr.body.id}/lines/${line.id}`, { countedQty: 60, reason: "selisih opname" })).status, 200);
  assert.equal((await cg.post(`/api/inventory/stock-counts/${cr.body.id}/submit`, {})).status, 200);
  assert.equal((await cg.post(`/api/inventory/stock-counts/${cr.body.id}/pergerakan/${baru.id}/tanda`, { tercermin: false })).status, 200);
  assert.equal((await cp.post(`/api/inventory/stock-counts/${cr.body.id}/periksa`, {})).status, 200);
  assert.equal((await co.post(`/api/inventory/stock-counts/${cr.body.id}/complete`, {})).status, 200);
  const sesudah = await testPrisma.stockMovement.findMany({ where: { materialId: m.id }, orderBy: { createdAt: "asc" } });
  // semua riwayat lama utuh (id, qty, waktu, catatan tidak berubah); yang bertambah hanya satu ADJUSTMENT milik count
  for (const lama of idsSebelum) { const x = sesudah.find((y) => y.id === lama.id); assert.ok(x, "riwayat tidak terhapus"); assert.equal(Number(x.qty), lama.qty); assert.equal(+x.createdAt, lama.at); assert.equal(x.note, lama.note); }
  assert.ok(sesudah.some((x) => x.id === r1.id) && sesudah.some((x) => x.id === r2.id) && sesudah.some((x) => x.id === baru.id));
  const adj = sesudah.filter((x) => x.type === "ADJUSTMENT"); assert.equal(adj.length, 1); assert.equal(Number(adj[0].qty), 60 - 65, "fisik 60 − saldo saat Start 65");
  assert.equal(sesudah.length, idsSebelum.length + 2, "satu transaksi baru + satu ADJUSTMENT");
  const saldo = sesudah.reduce((s, x) => s + Number(x.qty), 0); assert.equal(saldo, 60 + 8, "saldo = fisik + transaksi baru yang belum masuk hitungan");
});
