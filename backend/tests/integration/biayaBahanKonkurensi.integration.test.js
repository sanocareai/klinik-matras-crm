// JEJAK BIAYA BAHAN — export Excel, progres penerimaan Gudang sebelum disimpan, dan KONKURENSI/REPLAY di jalur yang menulis stok:
// klik ganda "Simpan ke Stok", Material Issue paralel, retur diterima paralel, replay Idempotency-Key.
// Yang dikunci: stok masuk/keluar tepat SEKALI, satu pergerakan = satu valuasi, jurnal seimbang, tanpa saldo negatif.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { bawaSampaiSiap } from "./setup/kedatangan.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { SETTING_KEYS } from "../../src/services/finance/settings.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const H = 43_290;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  await testPrisma.finSetting.upsert({ where: { key: SETTING_KEYS.INVENTORY_CUTOVER_DATE }, update: { value: "" }, create: { key: SETTING_KEYS.INVENTORY_CUTOVER_DATE, value: "" } });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const prod = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-X", name: "PT ESA BUMINDO" } });
  const lem = await createTestMaterial({ code: "LEM-1037", name: "LEM I-SR 1037 13 KG", unit: "KG" });
  const { unit } = await createTestUnit();
  return { f: c(fin), g: c(gudang), p: c(prod), s: c(sales), fin, gudang, prod, sales, supplier, lem, unit };
}
async function poDisetujui(w, { qty, harga }) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty, unitPrice: harga }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
/** Penerimaan sampai SIAP DISIMPAN (belum Simpan ke Stok). `datang` (default = baik) dan `tolak` lewat jalur resmi Catat Barang Tiba. */
async function penerimaanSiap(w, po, { baik, datang = baik, tolak = 0 }) {
  const gr = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id });
  assert.equal(gr.status, 201, JSON.stringify(gr.body));
  await bawaSampaiSiap(w.g, gr.body, { datang, baik, tolak });
  return gr.body;
}
const simpanKeStok = (w, gr) => w.g.post(`/api/inventory/goods-receipts/${gr.id}/putaway`, {});
async function issueSiap(w, qty) {
  const c = await w.g.post("/api/inventory/material-issues", { sourceType: "PRODUCTION_WORK_ORDER", unitId: w.unit.id, lines: [{ materialId: w.lem.id, requestedQty: qty }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  for (const st of ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"]) assert.equal((await w.g.patch(`/api/inventory/material-issues/${c.body.id}`, { status: st })).status, 200);
  return c.body;
}
const saldo = async (materialId) => {
  const r = await testPrisma.stockMovement.aggregate({ where: { materialId }, _sum: { qty: true } });
  return Number(r._sum.qty ?? 0);
};
async function cacah() {
  const j = await testPrisma.finJournalLine.aggregate({ _sum: { debit: true, credit: true } });
  return { stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), d: String(j._sum.debit ?? 0), k: String(j._sum.credit ?? 0), valuasi: await testPrisma.finStockMovementValuation.count() };
}
const seimbang = (c) => assert.equal(c.d, c.k, "jurnal seimbang (debit = kredit)");

test("klik ganda 'Simpan ke Stok': stok & jurnal penerimaan tepat SEKALI; barang ditolak tidak masuk stok; progres Gudang menunjukkan langkahnya", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10, harga: H });
  // tolak 1 dari 9 yang datang: datang 9, baik 8, ditolak 1
  const gr = await penerimaanSiap(w, po, { baik: 8, datang: 9, tolak: 1 });

  // sebelum disimpan: langkah "Simpan ke Stok" belum selesai, stok 0
  const sebelum = (await w.g.get(`/api/inventory/goods-receipts/${gr.id}/jejak-pemakaian`)).body;
  assert.deepEqual(sebelum.langkah.map((l) => [l.nama, l.selesai]), [["Diterima", true], ["Diperiksa", true], ["Simpan ke Stok", false], ["Dipakai Produksi / Tersisa", false]]);
  assert.equal(sebelum.bahan[0].masukStok, 0);
  assert.equal(await saldo(w.lem.id), 0);

  const awal = await cacah();
  const hasil = await Promise.all([simpanKeStok(w, gr), simpanKeStok(w, gr)]);
  assert.deepEqual(hasil.map((h) => h.status).sort(), [200, 400], `tepat satu sukses: ${JSON.stringify(hasil.map((h) => h.body))}`);
  const akhir = await cacah();
  assert.equal(await saldo(w.lem.id), 8, "hanya barang baik (8) masuk stok, SEKALI");
  assert.equal(akhir.stok - awal.stok, 1, "satu pergerakan RECEIPT");
  assert.equal(akhir.jurnal - awal.jurnal, 1, "satu jurnal penerimaan");
  seimbang(akhir);
  // ulang setelah selesai tetap ditolak tanpa efek
  assert.equal((await simpanKeStok(w, gr)).status, 400);
  assert.deepEqual(await cacah(), akhir);

  const sesudah = (await w.g.get(`/api/inventory/goods-receipts/${gr.id}/jejak-pemakaian`)).body;
  assert.deepEqual(sesudah.langkah.map((l) => l.selesai), [true, true, true, false]);
  assert.deepEqual([sesudah.bahan[0].baik, sesudah.bahan[0].ditolak, sesudah.bahan[0].masukStok, sesudah.bahan[0].tersisa], [8, 1, 8, 8]);
  // faktur tidak menambah stok: pergerakan tidak bertambah setelah faktur disetujui
  const fk = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: "FAK-K1", billDate: hariIni(), lines: [{ purchaseOrderLineId: po.lines[0].id, qty: 8, unitPrice: H }] });
  assert.equal(fk.status, 201, JSON.stringify(fk.body));
  assert.equal((await w.f.post(`/api/finance/bills/${fk.body.billId}/approve`, {})).status, 200);
  assert.equal((await cacah()).stok, akhir.stok, "faktur supplier tidak menambah/mengurangi stok");
  assert.equal(await saldo(w.lem.id), 8);
});

test("Material Issue paralel: dua dokumen berbeda keluar bersamaan, klik ganda satu dokumen — stok keluar tepat sekali per dokumen, satu valuasi per pergerakan, jurnal seimbang", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10, harga: H });
  const gr = await penerimaanSiap(w, po, { baik: 10 });
  assert.equal((await simpanKeStok(w, gr)).status, 200);
  const a = await issueSiap(w, 4); const b = await issueSiap(w, 4);
  const awal = await cacah();

  const paralel = await Promise.all([a, b].map((m) => w.g.post(`/api/inventory/material-issues/${m.id}/issue`, {})));
  assert.deepEqual(paralel.map((r) => r.status), [200, 200], JSON.stringify(paralel.map((r) => r.body)));
  assert.equal(await saldo(w.lem.id), 2, "10 − 4 − 4");
  assert.equal((await cacah()).stok - awal.stok, 2);

  // klik ganda pada satu dokumen (sisa 2 KG → dokumen 2 KG)
  const c = await issueSiap(w, 2);
  const tengah = await cacah();
  const ganda = await Promise.all([1, 2].map(() => w.g.post(`/api/inventory/material-issues/${c.id}/issue`, {})));
  assert.deepEqual(ganda.map((r) => r.status).sort(), [200, 400], JSON.stringify(ganda.map((r) => r.body)));
  const akhir = await cacah();
  assert.equal(akhir.stok - tengah.stok, 1, "dokumen yang diklik dua kali hanya mengeluarkan stok sekali");
  assert.equal(await saldo(w.lem.id), 0);
  assert.equal(akhir.valuasi, akhir.stok - 1, "setiap pergerakan unit punya tepat satu valuasi (RECEIPT tanpa unit tidak dinilai)");
  seimbang(akhir);

  // catatan PIC tidak membuat stok keluar kedua
  const run = await testPrisma.productionRun.create({ data: { unitId: w.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS", revision: 1 } });
  await testPrisma.productionStepEvidence.create({ data: { runId: run.id, stepNo: 6, stepCode: "PRODUKSI", version: 1, payload: { materials: [{ materialId: w.lem.id, qty: 5 }] }, actorId: w.prod.user.id } });
  assert.deepEqual(await cacah(), akhir, "catatan pemakaian PIC tidak memposting stok/jurnal");
  const j = (await w.f.get(`/api/finance/biaya-bahan/unit/${w.unit.id}`)).body;
  assert.equal(j.ringkasan.totalBiaya, 10 * H);
  assert.equal(j.bahan[0].dipakaiPIC, 5);
  assert.equal(j.bahan[0].diserahkan, 10);
});

test("retur diterima paralel + replay Idempotency-Key: stok bertambah dan biaya unit turun tepat SEKALI; retur yang baru diminta tidak mengubah apa pun; waste tidak menambah stok", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10, harga: H });
  assert.equal((await simpanKeStok(w, await penerimaanSiap(w, po, { baik: 10 }))).status, 200);
  const mi = await issueSiap(w, 6);
  assert.equal((await w.g.post(`/api/inventory/material-issues/${mi.id}/issue`, {})).status, 200);
  assert.equal(await saldo(w.lem.id), 4);

  // waste tidak menambah stok; dilaporkan terpisah
  assert.equal((await w.g.post("/api/inventory/movements/waste", { materialId: w.lem.id, qty: 1, reason: "Potong salah", unitId: w.unit.id })).status, 201);
  assert.equal(await saldo(w.lem.id), 3, "waste mengurangi stok, tidak menambah");

  // retur diminta Produksi (PENDING) — belum mengubah stok maupun biaya
  const run = await testPrisma.productionRun.create({ data: { unitId: w.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS", revision: 1 } });
  const retur = await testPrisma.productionMaterialReturn.create({ data: { runId: run.id, unitId: w.unit.id, materialId: w.lem.id, qty: 2, status: "PENDING" } });
  for (const key of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { unitIds: [w.unit.id] }, reason: "uji konkurensi biaya bahan" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
  const sebelum = (await w.f.get(`/api/finance/biaya-bahan/unit/${w.unit.id}`)).body;
  assert.equal(sebelum.ringkasan.totalRetur, 0, "retur belum diterima = belum mengurangi biaya");
  assert.equal(sebelum.ringkasan.nilaiBersih, 6 * H);
  assert.equal(sebelum.ringkasan.totalWaste, H, "waste terpisah, tidak ikut biaya bersih");
  assert.equal(await saldo(w.lem.id), 3);

  const awal = await cacah();
  const url = `/api/production-v2/material-returns/${retur.id}/receive`;
  const kunci = (v) => ({ "Idempotency-Key": `biaya-bahan-uji-${v}-0001` });
  // dua penerimaan BERSAMAAN dengan kunci berbeda: hanya satu berhasil
  const paralel = await Promise.all([w.g.post(url, { expectedRevision: retur.revision }, kunci("a")), w.g.post(url, { expectedRevision: retur.revision }, kunci("b"))]);
  assert.equal(paralel.filter((r) => r.status === 200).length, 1, JSON.stringify(paralel.map((r) => [r.status, r.body])));
  assert.equal(paralel.filter((r) => r.status === 409).length, 1);
  const berhasil = paralel.find((r) => r.status === 200);
  const akhir = await cacah();
  assert.equal(akhir.stok - awal.stok, 1, "satu pergerakan RETURN");
  assert.equal(await saldo(w.lem.id), 5, "stok +2 sekali");
  // replay dengan kunci yang sama → tidak ada efek tambahan
  const kunciBerhasil = paralel[0].status === 200 ? kunci("a") : kunci("b");
  const ulang = await w.g.post(url, { expectedRevision: retur.revision }, kunciBerhasil);
  assert.equal(ulang.status, 200);
  assert.equal(ulang.body.replayed, true);
  assert.equal(berhasil.body.returnId, retur.id);
  assert.deepEqual(await cacah(), akhir, "replay tidak mengubah stok/jurnal/valuasi");

  const sesudah = (await w.f.get(`/api/finance/biaya-bahan/unit/${w.unit.id}`)).body;
  assert.equal(sesudah.ringkasan.totalRetur, 2 * H, "retur diterima mengurangi biaya sekali");
  assert.equal(sesudah.ringkasan.nilaiBersih, 4 * H);
  assert.equal(sesudah.ringkasan.totalWaste, H);
  assert.equal(sesudah.ringkasan.totalBiaya - sesudah.ringkasan.totalRetur, sesudah.ringkasan.nilaiBersih);
  seimbang(akhir);
});

test("export Excel Biaya Bahan: total berkas = total layar, angka numerik, sel kosong untuk TANPA_HARGA (bukan Rp0), waste & retur terpisah, rumus diblokir, izin per peran", async () => {
  const w = await dunia();
  const tanpaHarga = await createTestMaterial({ code: "BHN-TANPA", name: "=HYPERLINK(\"x\") bahan", unit: "PCS" });
  const po = await poDisetujui(w, { qty: 10, harga: H });
  assert.equal((await simpanKeStok(w, await penerimaanSiap(w, po, { baik: 10 }))).status, 200);
  const mi = await issueSiap(w, 5);
  assert.equal((await w.g.post(`/api/inventory/material-issues/${mi.id}/issue`, {})).status, 200);
  assert.equal((await w.g.post("/api/inventory/movements/waste", { materialId: w.lem.id, qty: 1, reason: "Potong salah", unitId: w.unit.id })).status, 201);
  assert.equal((await w.g.post("/api/inventory/movements/return", { materialId: w.lem.id, qty: 2, unitId: w.unit.id, note: "Sisa kembali" })).status, 201);
  await seedBalance(tanpaHarga.id, 5);
  const m2 = await w.g.post("/api/inventory/material-issues", { sourceType: "PRODUCTION_WORK_ORDER", unitId: w.unit.id, lines: [{ materialId: tanpaHarga.id, requestedQty: 1 }] });
  for (const st of ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"]) await w.g.patch(`/api/inventory/material-issues/${m2.body.id}`, { status: st });
  assert.equal((await w.g.post(`/api/inventory/material-issues/${m2.body.id}/issue`, {})).status, 200);

  const layar = (await w.f.get(`/api/finance/biaya-bahan/unit/${w.unit.id}`)).body;
  const daftar = (await w.f.get("/api/finance/biaya-bahan/unit")).body.units;
  assert.equal(daftar.length, 1);
  assert.equal(daftar[0].biayaPersediaan, layar.ringkasan.biayaPersediaan.nilai, "daftar layar = detail layar");

  const ambil = async (token, body = { filter: {} }) => fetch(`${server.baseUrl}/api/finance/export/biaya-bahan`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await ambil(null)).status, 401);
  assert.equal((await ambil(w.sales.token)).status, 403);
  const res = await ambil(w.fin.token);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const nama = wb.worksheets.map((s) => s.name);
  for (const n of ["Ringkasan per Unit", "Rincian Pergerakan", "Tanpa Harga", "Retur dan Waste"]) assert.ok(nama.includes(n), `sheet ${n} ada: ${nama.join(",")}`);

  const barisSheet = (n) => { const out = []; wb.getWorksheet(n).eachRow((row) => out.push(row.values.slice(1))); return out; };
  const totalRow = (n) => barisSheet(n).find((r) => String(r[0] ?? "").startsWith("TOTAL"));
  // total berkas = total layar (Ringkasan per Unit: Total Biaya, Retur, Bersih, Waste)
  const tr = totalRow("Ringkasan per Unit");
  assert.ok(tr, "baris TOTAL ada");
  assert.deepEqual(tr.slice(2, 6).map(Number), [layar.ringkasan.totalBiaya, layar.ringkasan.totalRetur, layar.ringkasan.nilaiBersih, layar.ringkasan.totalWaste]);
  assert.equal(layar.ringkasan.nilaiBersih, 5 * H - 2 * H);
  assert.equal(typeof tr[2], "number", "angka numerik, bukan teks");
  // rincian: total biaya bersih = layar; baris TANPA_HARGA bernilai kosong, tidak ikut total
  const rincian = barisSheet("Rincian Pergerakan");
  assert.equal(Number(totalRow("Rincian Pergerakan")[9]), layar.ringkasan.nilaiBersih);
  const barisTanpa = rincian.find((r) => String(r[3] ?? "").includes("BHN-TANPA"));
  assert.ok(barisTanpa, "baris bahan tanpa harga ada di rincian");
  assert.ok(barisTanpa[9] === null || barisTanpa[9] === undefined || barisTanpa[9] === "", "nilai kosong (bukan 0)");
  // rumus diblokir
  assert.ok(rincian.some((r) => String(r[4] ?? "").startsWith("'=HYPERLINK")), "nama bahan berawalan '=' diberi apostrof (formula injection)");
  // retur & waste terpisah
  const rw = barisSheet("Retur dan Waste").map((r) => String(r[5]));
  assert.ok(rw.some((j) => j.startsWith("Retur")) && rw.some((j) => j.startsWith("Waste")));
  assert.equal((await ambil(w.fin.token, { filter: { q: "tidak-ada-unit-ini" } })).status, 200, "filter tanpa hasil tetap menghasilkan berkas dengan alasan kosong");
  // Gudang & Produksi tidak punya izin harga → ditolak
  assert.equal((await ambil(w.gudang.token)).status, 403);
  assert.equal((await ambil(w.prod.token)).status, 403);
});

test("penerimaan tanpa PO tetap bisa disimpan ke stok (jalur lama utuh) tetapi pemakaiannya ditandai TANPA_PO — bukan sumber biaya lengkap", async () => {
  const w = await dunia();
  assert.equal((await w.g.post("/api/inventory/movements/receipt", { materialId: w.lem.id, qty: 5, unitCost: 20_000, supplier: "Toko Lama" })).status, 201);
  const mi = await issueSiap(w, 2);
  assert.equal((await w.g.post(`/api/inventory/material-issues/${mi.id}/issue`, {})).status, 200);
  const j = (await w.f.get(`/api/finance/biaya-bahan/unit/${w.unit.id}`)).body;
  assert.equal(j.bahan[0].pergerakan[0].nilai, 40_000);
  assert.equal(j.bahan[0].pergerakan[0].faktur.status, "TANPA_PO");
  assert.equal(await saldo(w.lem.id), 3);
  seimbang(await cacah());
});
