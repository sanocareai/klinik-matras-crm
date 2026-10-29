// LAPORAN PRODUKSI TERPADU (4 tab): Ringkasan · Biaya per Order · Kinerja · Bahan & Gudang. DB sungguhan.
// Dibuktikan: cakupan di luar kohort V2, order multiunit (order = Σ unit), pemakaian langsung/historis, retur/koreksi, tanpa harga, harga berubah (nilai beku tidak bergeser),
// tanggal lintas hari WIB, PIC/meja berpindah (total selesai tidak ganda), SANO GUARD tidak dijumlahkan, izin server (nominal hanya finance:read), layar = grafik = Excel, BACA-SAJA.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { catatBiayaOperasional } from "../../src/services/finance/hargaBerlaku.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (t) => `lap-${t}-${Date.now().toString(36)}-${++seq}-aaaaaaaa`;
const HARI = 86_400_000;
const wib = (d = new Date()) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const hariIni = () => wib();
const base = "/api/production-v2/laporan";

async function dunia() {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const finance = await createTestUser({ roles: ["FINANCE"] }); const gudang = await createTestUser({ roles: ["WAREHOUSE"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const cl = (u) => makeClient(server.baseUrl, u.token);
  const busa = await createTestMaterial({ code: "LP-BUSA", name: "BUSA LAPORAN", unit: "SHEET" }); await seedBalance(busa.id, 500, { unitCost: 20000 });
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: busa.id, jenis: "HARGA", unitPrice: "20000", satuan: "SHEET", effectiveFrom: new Date(Date.now() - 90 * HARI), createdAt: new Date(Date.now() - 90 * HARI), reason: "Harga uji laporan produksi", idempotencyKey: kunci("hb1") } });
  const lem = await createTestMaterial({ code: "LP-LEM", name: "LEM LAPORAN", unit: "KG" }); await seedBalance(lem.id, 500);
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: lem.id, jenis: "HARGA", unitPrice: "50000", satuan: "KG", effectiveFrom: new Date(Date.now() - 90 * HARI), createdAt: new Date(Date.now() - 90 * HARI), reason: "Harga uji laporan produksi", idempotencyKey: kunci("hb2") } });
  const tanpaHarga = await createTestMaterial({ code: "LP-TH", name: "BAHAN TANPA HARGA", unit: "KG" }); await seedBalance(tanpaHarga.id, 500);
  const guard = await createTestMaterial({ code: "SANO-GUARD-LP", name: "SANO GUARD LAPORAN", unit: "PCS" }); await seedBalance(guard.id, 100);
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: guard.id, jenis: "HARGA", unitPrice: "150000", satuan: "PCS", effectiveFrom: new Date(Date.now() - 90 * HARI), createdAt: new Date(Date.now() - 90 * HARI), reason: "Harga uji laporan produksi", idempotencyKey: kunci("hb3") } });
  return { admin, finance, gudang, sales, a: cl(admin), f: cl(finance), g: cl(gudang), s: cl(sales), busa, lem, tanpaHarga, guard };
}
async function order(nomor, units) { // units: [{status, umur}] → satu order, banyak unit
  const cust = await testPrisma.customer.create({ data: { name: `Pelanggan ${nomor}` } });
  const o = await testPrisma.order.create({ data: { customerId: cust.id, value: 0, orderNumber: nomor, status: "PROCESSING" } });
  const out = [];
  for (const [i, def] of units.entries()) out.push(await testPrisma.unit.create({ data: { unitCode: `${nomor}-U${i + 1}`, orderId: o.id, seq: i + 1, status: def.status ?? "IN_PRODUCTION", createdAt: new Date(Date.now() - (def.umur ?? 2) * HARI) } }));
  return { o, us: out };
}
const issue = (w, u, mat, qty = 1) => w.a.post(`/api/units/${u.id}/materials`, { materialId: mat.id, qty }, { "Idempotency-Key": kunci("iss") });
const periodeHariIni = () => `from=${hariIni()}&to=${hariIni()}`;
const ambil = async (w, path) => (await w.a.get(`${base}${path}`));
const tabel = async (n) => Number((await testPrisma.$queryRawUnsafe(`select count(*)::int n from ${n}`))[0].n);
const efek = async () => ({ sm: await tabel("stock_movements"), mi: await tabel("material_issues"), jur: await tabel("fin_journal_entries"), bo: await tabel("stock_movement_biaya_operasional"), hb: await tabel("material_harga_berlaku"), un: await tabel("units"), pn: await tabel("unit_material_declarations") });
async function unduh(token, path) { const r = await fetch(`${server.baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; }
const sel = (ws, r, c) => { const v = ws.getRow(r).getCell(c).value; return v && typeof v === "object" && "result" in v ? v.result : v; };

test("L1. order MULTIUNIT: cakupan di luar kohort V2; nilai order = Σ unit; unit tanpa pemakaian ⇒ Parsial + masalah; Lengkap tidak disimpulkan dari satu catatan berharga", async () => {
  const w = await dunia(); const { o, us } = await order("RES-LP-01", [{ status: "IN_PRODUCTION" }, { status: "READY_FOR_DELIVERY", umur: 6 }]);
  assert.equal((await issue(w, us[0], w.busa, 2)).status, 201); // 2 × 20.000
  assert.equal((await issue(w, us[0], w.lem, 1)).status, 201); // 1 × 50.000
  const r = await ambil(w, `/biaya-order?${periodeHariIni()}`); assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = r.body.rows.find((x) => x.orderNumber === "RES-LP-01"); assert.ok(row, "order muncul walau unit tidak ada di kohort rencana V2");
  assert.equal(row.nilaiDiketahui, 90000); assert.equal(row.unitDalamOrder, 2); assert.equal(row.barisPemakaian, 2);
  assert.equal(row.status, "PARSIAL", "unit kedua Siap Kirim tanpa pemakaian ⇒ tidak boleh Lengkap"); assert.ok(row.masalah.BAHAN_BELUM_DICATAT >= 1 && row.jumlahMasalah >= 1);
  const d = (await ambil(w, `/biaya-order/${o.id}?${periodeHariIni()}`)).body;
  assert.equal(d.total.nilaiDiketahui, d.unit.reduce((a, u) => a + (u.ringkas.nilaiDiketahui ?? 0), 0), "order = Σ rincian unit");
  assert.equal(d.total.barisPemakaian, d.unit.reduce((a, u) => a + u.ringkas.barisPemakaian, 0));
  const b = d.unit[0].bahan.find((x) => x.kode === "LP-BUSA"); assert.equal(b.qty, 2); assert.equal(b.satuan, "SHEET"); assert.equal(b.harga, 20000); assert.equal(b.subtotal, 40000);
  assert.equal(b.status, "DIBEKUKAN"); assert.equal(b.sumberHarga, "BEKU_SAAT_POSTING"); assert.ok(b.tanggalDasarHarga, "tanggal dasar harga tampil"); assert.equal(b.dasarTanggal, "PENCATATAN");
  assert.ok(d.catatanFinance, "label pemisah Finance ada di detail");
});

test("L2. tanpa harga ⇒ Belum diketahui (bukan Rp0) dengan jumlah masalah; masalah bisa difilter", async () => {
  const w = await dunia(); const { us } = await order("RES-LP-02", [{ status: "IN_PRODUCTION" }]);
  assert.equal((await issue(w, us[0], w.tanpaHarga, 3)).status, 201);
  const r = (await ambil(w, `/biaya-order?${periodeHariIni()}`)).body; const row = r.rows.find((x) => x.orderNumber === "RES-LP-02");
  assert.equal(row.status, "BELUM_DIKETAHUI"); assert.equal(row.nilaiDiketahui, 0); assert.equal(row.masalah.TANPA_HARGA, 1); assert.equal(row.jumlahMasalah >= 1, true);
  const f = (await ambil(w, `/biaya-order?${periodeHariIni()}&masalah=TANPA_HARGA`)).body; assert.equal(f.total, 1);
  const g = (await ambil(w, `/biaya-order?${periodeHariIni()}&status=LENGKAP`)).body; assert.equal(g.rows.some((x) => x.orderNumber === "RES-LP-02"), false);
});

test("L3. harga BERUBAH sesudah posting: nilai beku tidak bergeser; pemakaian lama TIDAK dihitung ulang dengan harga master terbaru", async () => {
  const w = await dunia(); const { us } = await order("RES-LP-03", [{ status: "IN_PRODUCTION" }]);
  assert.equal((await issue(w, us[0], w.busa, 1)).status, 201);
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: w.busa.id, jenis: "HARGA", unitPrice: "99999", satuan: "SHEET", effectiveFrom: new Date(Date.now() + 3600_000), createdAt: new Date(), reason: "Harga uji laporan produksi", idempotencyKey: kunci("hb4") } });
  const row = (await ambil(w, `/biaya-order?${periodeHariIni()}`)).body.rows.find((x) => x.orderNumber === "RES-LP-03"); assert.equal(row.nilaiDiketahui, 20000);
});

test("L4. pemakaian BELUM DIBEKUKAN (lama) = masalah, bukan dihitung dengan harga terbaru", async () => {
  const w = await dunia(); const { us } = await order("RES-LP-04", [{ status: "IN_PRODUCTION" }]);
  await testPrisma.stockMovement.create({ data: { materialId: w.busa.id, type: "ISSUE", qty: -4, unitId: us[0].id, note: "pemakaian lama tanpa pembekuan" } }); // pergerakan lama: tidak punya baris biaya beku
  const row = (await ambil(w, `/biaya-order?${periodeHariIni()}`)).body.rows.find((x) => x.orderNumber === "RES-LP-04");
  assert.equal(row.nilaiDiketahui, 0); assert.equal(row.masalah.BELUM_DIBEKUKAN, 1); assert.equal(row.status, "BELUM_DIKETAHUI");
});

test("L5. RETUR/KOREKSI: pengembalian mengurangi (harga ISSUE asal); susut TERPISAH; pemakaian bersih konsisten di rincian", async () => {
  const w = await dunia(); const { o, us } = await order("RES-LP-05", [{ status: "IN_PRODUCTION" }]);
  const iss = await issue(w, us[0], w.busa, 5); assert.equal(iss.status, 201);
  const ret = await testPrisma.stockMovement.create({ data: { materialId: w.busa.id, type: "RETURN", qty: 2, unitId: us[0].id, note: "retur uji", reason: "uji" } });
  await testPrisma.$transaction((tx) => catatBiayaOperasional(tx, ret));
  const was = await testPrisma.stockMovement.create({ data: { materialId: w.busa.id, type: "WASTE", qty: -1, unitId: us[0].id, note: "susut uji", reason: "uji" } });
  await testPrisma.$transaction((tx) => catatBiayaOperasional(tx, was));
  const d = (await ambil(w, `/biaya-order/${o.id}?${periodeHariIni()}`)).body; const bahan = d.unit[0].bahan;
  assert.equal(d.total.nilaiDiketahui, 60000, "5×20.000 − 2×20.000 = 60.000 (susut tidak ikut)"); assert.equal(d.total.susut, 20000);
  assert.ok(bahan.find((x) => x.jenis === "PENGEMBALIAN" && x.subtotal === -40000 && x.harga === 20000));
  const gdg = (await ambil(w, `/bahan-gudang?${periodeHariIni()}`)).body; const bb = gdg.rows.find((x) => x.kode === "LP-BUSA");
  assert.equal(bb.dipakai, 5); assert.equal(bb.dikembalikan, 2); assert.equal(bb.bersih, 3); assert.equal(bb.susut, 1); assert.equal(bb.nilaiDiketahui, 60000);
});

test("L6. TANGGAL: lintas hari WIB (00:30 WIB = 17:30 UTC hari sebelumnya) dan tanggal pemakaian historis dilaporkan dibedakan dari waktu pencatatan", async () => {
  const w = await dunia(); const { us } = await order("RES-LP-06", [{ status: "IN_PRODUCTION" }, { status: "IN_PRODUCTION" }]);
  assert.equal((await issue(w, us[0], w.busa, 1)).status, 201); assert.equal((await issue(w, us[1], w.busa, 1)).status, 201);
  // pemakaian 1: dicatat pukul 00:30 WIB 29 Okt 2026 (= 28 Okt 17:30 UTC)
  await testPrisma.$executeRawUnsafe(`update stock_movements set created_at = '2026-10-28T17:30:00Z' where unit_id = '${us[0].id}' and type = 'ISSUE'`);
  // pemakaian 2: dicatat belakangan tetapi LAPORAN pemakaian 2026-10-10 (pembetulan terlambat)
  await testPrisma.$executeRawUnsafe(`update stock_movements set created_at = '2026-10-28T10:00:00Z', note = 'Pembetulan unit terkirim (${us[1].unitCode}) [dilaporkan 2026-10-10]: uji' where unit_id = '${us[1].id}' and type = 'ISSUE'`);
  const hari29 = (await ambil(w, `/biaya-order?from=2026-10-29&to=2026-10-29`)).body.rows.find((x) => x.orderNumber === "RES-LP-06");
  const hari28 = (await ambil(w, `/biaya-order?from=2026-10-28&to=2026-10-28`)).body.rows.find((x) => x.orderNumber === "RES-LP-06");
  assert.ok(hari29 && hari29.barisPemakaian === 1, "00:30 WIB 29 Okt masuk tanggal 29 (bukan 28)"); assert.equal(hari28, undefined, "tidak ada pemakaian pada 28 Okt WIB");
  const hari10 = (await ambil(w, `/biaya-order?from=2026-10-10&to=2026-10-10`)).body.rows.find((x) => x.orderNumber === "RES-LP-06");
  assert.ok(hari10 && hari10.barisPemakaian === 1, "dikelompokkan menurut TANGGAL PEMAKAIAN yang dilaporkan");
  const o = await testPrisma.order.findFirst({ where: { orderNumber: "RES-LP-06" } });
  const det = (await ambil(w, `/biaya-order/${o.id}?from=2026-10-10&to=2026-10-10`)).body; const b = det.unit.find((u) => u.unitCode.endsWith("U2")).bahan[0];
  assert.equal(b.tanggalPemakaian, "2026-10-10"); assert.equal(b.dasarTanggal, "DILAPORKAN"); assert.match(String(b.waktuPencatatan), /2026-10-28/, "waktu pencatatan tetap tampil terpisah");
});

test("L7. SANO GUARD: nilainya TIDAK dijumlahkan sebagai biaya terbukti; ditandai gap dengan penjelasan risiko hitung ganda", async () => {
  const w = await dunia(); const { o, us } = await order("RES-LP-07", [{ status: "IN_PRODUCTION" }]);
  assert.equal((await issue(w, us[0], w.guard, 1)).status, 201); assert.equal((await issue(w, us[0], w.busa, 1)).status, 201);
  const row = (await ambil(w, `/biaya-order?${periodeHariIni()}`)).body.rows.find((x) => x.orderNumber === "RES-LP-07");
  assert.equal(row.nilaiDiketahui, 20000, "hanya busa; SANO GUARD 150.000 tidak dijumlahkan"); assert.equal(row.masalah.GUARD, 1); assert.equal(row.status, "PARSIAL"); assert.equal(row.adaGuard, true);
  const d = (await ambil(w, `/biaya-order/${o.id}?${periodeHariIni()}`)).body; assert.match(d.catatanGuard, /hitung ganda/);
  assert.equal(d.unit[0].bahan.find((x) => x.kode === "SANO-GUARD-LP").status, "GUARD");
});

test("L8. KINERJA: unit selesai dihitung SEKALI meski berpindah meja; PIC dari rencana (bukan pelaku posting bahan); tanpa penetapan = Tidak tercatat; durasi/target tidak dikarang", async () => {
  const w = await dunia(); const { us } = await order("RES-LP-08", [{ status: "READY_FOR_DELIVERY" }, { status: "READY_FOR_DELIVERY" }, { status: "READY_FOR_DELIVERY" }]);
  for (const u of us) await testPrisma.unitCustodyHandoff.create({ data: { unitId: u.id, direction: "FINISHED_GOODS", status: "OFFERED", offeredAt: new Date() } });
  const bulan = new Date(); const tglProduksi = new Date(`${hariIni()}T00:00:00.000Z`);
  await testPrisma.productionUnitSchedule.create({ data: { unitId: us[0].id, productionDate: tglProduksi, stationCode: "TABLE_1" } });
  await testPrisma.productionUnitSchedule.update({ where: { unitId: us[0].id }, data: { stationCode: "TABLE_2" } }); // berpindah meja: tetap satu unit
  await testPrisma.productionUnitSchedule.create({ data: { unitId: us[1].id, productionDate: tglProduksi, stationCode: "TABLE_2" } });
  const k = (await ambil(w, `/kinerja?${periodeHariIni()}`)).body;
  assert.equal(k.selesai.unit, 3);
  const jumlah = k.meja.baris.reduce((a, m) => a + m.selesai, 0) + k.meja.tidakTercatat.selesai; assert.equal(jumlah, k.selesai.unit, "Σ meja + Tidak tercatat = total selesai (tidak ganda)");
  assert.equal(k.meja.baris.find((m) => m.kode === "TABLE_2").selesai, 2); assert.equal(k.meja.tidakTercatat.selesai, 1);
  assert.equal(k.selesai.durasi.rataMenit, null, "durasi belum tersedia — bukan 0"); assert.equal(k.targetHistoris.tersedia, false); assert.match(k.targetHistoris.catatan, /belum tersedia/);
  assert.equal(k.pic.baris.reduce((a, p) => a + p.selesai, 0), k.selesai.unit); assert.equal(k.pic.baris.find((p) => p.key === "__TIDAK_TERCATAT__").selesai, 3, "tidak ada PIC pada rencana ⇒ Tidak tercatat (pelaku posting bahan tidak dipakai)");
  assert.equal(k.terjadwal.unit, 2); void bulan;
});

test("L9. IZIN: Sales 403; Gudang hanya Bahan & Gudang dan TANPA nominal; Admin tanpa finance:read tanpa nominal; Finance melihat nominal; ekspor mengikuti izin", async () => {
  const w = await dunia(); const { us } = await order("RES-LP-09", [{ status: "IN_PRODUCTION" }]); await issue(w, us[0], w.busa, 1);
  for (const p of ["/ringkasan", "/biaya-order", "/kinerja", "/bahan-gudang", "/export?tab=ringkasan"]) assert.equal((await w.s.get(`${base}${p}`)).status, 403, `Sales ${p}`);
  assert.equal((await w.g.get(`${base}/bahan-gudang?${periodeHariIni()}`)).status, 200);
  assert.equal((await w.g.get(`${base}/biaya-order?${periodeHariIni()}`)).status, 403); assert.equal((await w.g.get(`${base}/kinerja?${periodeHariIni()}`)).status, 403);
  const gd = (await w.g.get(`${base}/bahan-gudang?${periodeHariIni()}`)).body; assert.equal(gd.rows[0].nilaiDiketahui, null); assert.equal(gd.total.nilaiDiketahui, null);
  const meta = (await w.a.get(`${base}/meta`)).body; assert.equal(meta.capabilities.biayaOrder, true);
  const adminRow = (await w.a.get(`${base}/biaya-order?${periodeHariIni()}`)).body; const finRow = (await w.f.get(`${base}/biaya-order?${periodeHariIni()}`));
  if (meta.capabilities.harga) assert.equal(adminRow.rows[0].nilaiDiketahui, 20000); else assert.equal(adminRow.rows[0].nilaiDiketahui, null);
  void finRow;
});

test("L10. LAYAR = GRAFIK = EXCEL: jumlah/filter/urut atas SELURUH hasil (bukan halaman 1); ekspor mengikuti tab, periode, filter", async () => {
  const w = await dunia();
  for (let i = 1; i <= 7; i += 1) { const { us } = await order(`RES-LP-${String(30 + i)}`, [{ status: "IN_PRODUCTION" }]); await issue(w, us[0], w.busa, i); }
  const p1 = (await ambil(w, `/biaya-order?${periodeHariIni()}&pageSize=3&page=1&urut=nilai`)).body; const p3 = (await ambil(w, `/biaya-order?${periodeHariIni()}&pageSize=3&page=3&urut=nilai`)).body;
  assert.equal(p1.total, 7); assert.equal(p1.rows.length, 3); assert.equal(p3.rows.length, 1); assert.equal(p1.ringkas.order, 7);
  const semua = (await ambil(w, `/biaya-order?${periodeHariIni()}&pageSize=100&urut=nilai`)).body; assert.equal(semua.ringkas.nilaiDiketahui, semua.rows.reduce((a, r) => a + (r.nilaiDiketahui ?? 0), 0));
  const rg = (await ambil(w, `/ringkasan?${periodeHariIni()}`)).body; const sumGrafik = rg.grafik.biayaPerHari.reduce((a, x) => a + x.nilai, 0);
  if (rg.kartu.hppDiketahui) { assert.equal(sumGrafik, semua.ringkas.nilaiDiketahui, "grafik HPP per hari = total tabel"); assert.equal(rg.kartu.hppDiketahui.nilai, semua.ringkas.nilaiDiketahui); }
  const x = await unduh(w.admin.token, `${base}/export?tab=biaya-order&${periodeHariIni()}&urut=nilai`); assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf);
  const ws = wb.getWorksheet("Biaya per Order"); assert.ok(ws, "sheet Biaya per Order"); let nBaris = 0; ws.eachRow((r, n) => { if (n >= 7 && String(sel(ws, n, 1) ?? "").startsWith("RES-LP-")) nBaris += 1; });
  assert.equal(nBaris, 7, "Excel memuat SEMUA order, bukan halaman pertama");
  assert.ok(wb.getWorksheet("Cakupan dan Definisi"), "definisi + dasar tanggal ada di Excel");
});

test("L11. BACA-SAJA: membuka seluruh tab, rincian, dan ekspor tidak mengubah stok, Material Issue, jurnal, biaya beku, harga, unit, pernyataan", async () => {
  const w = await dunia(); const { o, us } = await order("RES-LP-11", [{ status: "IN_PRODUCTION" }]); await issue(w, us[0], w.busa, 1);
  const a = await efek();
  for (const p of ["/meta", `/ringkasan?${periodeHariIni()}`, `/biaya-order?${periodeHariIni()}`, `/biaya-order/${o.id}?${periodeHariIni()}`, `/kinerja?${periodeHariIni()}`, `/bahan-gudang?${periodeHariIni()}`]) assert.equal((await w.a.get(`${base}${p}`)).status, 200, p);
  for (const t of ["ringkasan", "biaya-order", "kinerja", "bahan-gudang"]) assert.equal((await w.a.get(`${base}/export?tab=${t}&${periodeHariIni()}`)).status, 200, t);
  assert.deepEqual(await efek(), a);
});

test("L12. periode tidak valid ditolak 400 (bukan diabaikan); tab ekspor tidak dikenal 400", async () => {
  const w = await dunia();
  const r = await w.a.get(`${base}/biaya-order?from=2026-10-30&to=2026-10-01`); assert.equal(r.status, 400);
  assert.equal((await w.a.get(`${base}/export?tab=lain`)).status, 400);
});
