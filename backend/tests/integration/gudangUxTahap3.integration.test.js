// UX GUDANG TAHAP 3 — DB terisolasi. Kelompok bahan (Stok & Lokasi): turunan itemGroup lewat tabel eksplisit, tidak ditebak dari nama, tidak menulis apa pun. Pipeline Penerimaan: tahap, perpindahan sah,
// dan tindakan berikutnya datang dari server; lompatan status ditolak server tanpa efek stok/Finance; dokumen terposting tidak punya perpindahan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const GR = "/api/inventory/goods-receipts"; const STOK = "/api/inventory/beranda/stok";
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
const snap = async () => ({ mov: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), gr: await testPrisma.goodsReceipt.count(), mat: await testPrisma.material.count() });
async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const [gudang, lead] = await Promise.all(["WAREHOUSE", "PRODUCTION_LEAD"].map((r) => createTestUser({ roles: [r] })));
  return { g: makeClient(server.baseUrl, gudang.token), p: makeClient(server.baseUrl, lead.token) };
}
const bahan = (code, name, itemGroup, extra = {}) => createTestMaterial({ code, name, itemGroup, ...extra });

test("Stok & Lokasi: kelompok diturunkan dari itemGroup (tabel eksplisit): huruf besar/kecil sama, grup campuran/kosong = Belum dikelompokkan dengan alasan, TIDAK dari nama; tanpa menulis data", async () => {
  const w = await dunia();
  const a = await bahan("B-1", "Busa Rebonded D50", "REBONDED"); const b = await bahan("K-1", "Kain Hikaron", "Kain"); const k2 = await bahan("K-2", "Kain Midili", "KAIN");
  const mix = await bahan("S-1", "Benang Halus Hitam 40/2", "SUPPORT KAIN"); // nama menyiratkan Benang, tetapi grupnya campuran → TIDAK ditebak
  const kosong = await bahan("N-1", "Busa Tanpa Grup", null); const lain = await bahan("L-1", "PE Encasement", "PE"); const non = await bahan("B-NON", "Busa Nonaktif", "REBONDED", { active: false });
  await seedBalance(a.id, 10); await seedBalance(b.id, -2); await seedBalance(lain.id, 0);
  const awal = await snap();
  const r = await w.g.get(STOK); assert.equal(r.status, 200, JSON.stringify(r.body));
  const per = Object.fromEntries(r.body.rows.map((x) => [x.kode, x.kelompok]));
  assert.deepEqual([per["B-1"].kode, per["K-1"].kode, per["K-2"].kode, per["L-1"].kode], ["BUSA", "KAIN", "KAIN", "LAINNYA"]);
  assert.equal(per["S-1"].kode, "BELUM"); assert.match(per["S-1"].alasan, /campuran atau maknanya belum jelas/); assert.equal(per["N-1"].kode, "BELUM"); assert.match(per["N-1"].alasan, /tidak punya itemGroup/);
  assert.equal(r.body.rows.find((x) => x.kode === "B-NON").kelompok.kode, "BUSA", "nonaktif tetap punya kelompok");
  const ring = Object.fromEntries(r.body.kelompok.kelompok.map((x) => [x.kode, x]));
  assert.equal(ring.BUSA.total, 1); assert.equal(ring.BUSA.diketahui, 1); assert.equal(ring.BUSA.nonaktif, 1, "nonaktif dihitung terpisah, bukan di total");
  assert.deepEqual({ t: ring.KAIN.total, d: ring.KAIN.diketahui, m: ring.KAIN.minus, bd: ring.KAIN.belumDiketahui }, { t: 2, d: 1, m: 1, bd: 1 });
  assert.equal(ring.BELUM.total, 2); assert.equal(ring.BELUM.belumDiketahui, 2); assert.equal(ring.LAINNYA.nol, 1); assert.equal(ring.BENANG.total, 0, "kelompok kosong tetap ada");
  const aktifSemua = r.body.rows.filter((x) => x.aktif).length; assert.equal(r.body.kelompok.kelompok.reduce((n, x) => n + x.total, 0), aktifSemua, "jumlah per kelompok = jumlah bahan aktif");
  assert.equal(r.body.kelompok.jenis.reduce((n, x) => n + x.total, 0), aktifSemua, "jumlah per jenis = jumlah bahan aktif");
  assert.deepEqual(await snap(), awal, "membaca tidak menulis apa pun"); void kosong; void mix; void non;
  const ro = await w.p.get(STOK); assert.equal(ro.status, 200, "akun baca-saja boleh membaca");
});

test("Pipeline Penerimaan: tahap, perpindahan sah, dan tindakan berikutnya dari server untuk tiap status; DRAF tidak bisa melompat; terposting tanpa perpindahan", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: "BUSA-X", name: "Busa X", unit: "SHEET" });
  const baru = async () => { const c = await w.g.post(GR, { sourceType: "MANUAL", supplier: "Toko Uji", sourceReference: "NOTA-" + Math.random().toString(36).slice(2, 7), expectedDate: geser(1), lines: [{ materialId: m.id, orderedQty: 5 }] }); assert.equal(c.status, 201, JSON.stringify(c.body)); return c.body; };
  const status = async (id, s) => { const r = await w.g.patch(`${GR}/${id}`, { status: s }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
  const lihat = async (id) => (await w.g.get(`${GR}/${id}`)).body.tampilan;
  const g = await baru(); let t = await lihat(g.id);
  assert.deepEqual(t.pipeline.tahap.map((x) => x.label), ["Draf", "Terjadwal", "Barang tiba", "Pemeriksaan", "Siap masuk stok", "Sudah masuk stok"]);
  assert.equal(t.pipeline.indeks, 0); assert.equal(t.berikutnya, "Jadwalkan kedatangan");
  assert.deepEqual(t.pipeline.pindah.map((x) => `${x.kode}>${x.ke}`), ["JADWALKAN>TERJADWAL", "BATALKAN_JADWAL>DIBATALKAN"], "DRAF: hanya jadwalkan atau batalkan — tidak ada Barang tiba/Pemeriksaan/Siap/Stok");
  // lompatan ditolak server, tanpa efek
  const awal = await snap();
  for (const lompat of ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"]) { const r = await w.g.patch(`${GR}/${g.id}`, { status: lompat }); assert.ok(r.status >= 400, `DRAF → ${lompat} harus ditolak, dapat ${r.status}`); }
  assert.equal((await lihat(g.id)).kode, "DRAF"); assert.deepEqual(await snap(), awal, "lompatan yang ditolak tidak mengubah stok/Finance/dokumen");
  await status(g.id, "SCHEDULED"); t = await lihat(g.id); assert.equal(t.pipeline.indeks, 1);
  assert.deepEqual(t.pipeline.pindah.map((x) => x.ke), ["TIBA", "DRAF", "DIBATALKAN"]);
  for (const lompat of ["INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"]) { const r = await w.g.patch(`${GR}/${g.id}`, { status: lompat }); assert.ok(r.status >= 400, `TERJADWAL → ${lompat} harus ditolak, dapat ${r.status}`); }
  await status(g.id, "ARRIVED"); t = await lihat(g.id); assert.equal(t.pipeline.indeks, 2); assert.equal(t.berikutnya, "Periksa barang");
  assert.ok(t.pipeline.pindah.some((x) => x.kode === "MAJUKAN" && x.ke === "PERIKSA")); assert.ok(!t.pipeline.pindah.some((x) => x.ke === "SIAP" || x.ke === "STOK"));
  const lompatSiap = await w.g.patch(`${GR}/${g.id}`, { status: "READY_FOR_PUTAWAY" }); assert.ok(lompatSiap.status >= 400, "ARRIVED → READY harus ditolak (pemeriksaan tidak boleh dilewati)");
  await status(g.id, "INSPECTION"); t = await lihat(g.id); assert.equal(t.pipeline.indeks, 3);
  const d = (await w.g.get(`${GR}/${g.id}`)).body; for (const l of d.lines) { const u = await w.g.patch(`${GR}/${g.id}/lines/${l.id}`, { receivedQty: 5, acceptedQty: 5, rejectedQty: 0 }); assert.equal(u.status, 200, JSON.stringify(u.body)); }
  await status(g.id, "READY_FOR_PUTAWAY"); t = await lihat(g.id); assert.equal(t.pipeline.indeks, 4); assert.equal(t.berikutnya, "Simpan ke Stok"); assert.ok(t.pipeline.pindah.some((x) => x.kode === "SIMPAN_KE_STOK" && x.ke === "STOK"));
  const stokSebelum = await snap(); assert.equal(stokSebelum.mov, 0, "belum ada pergerakan sebelum Simpan ke Stok");
  const put = await w.g.post(`${GR}/${g.id}/putaway`, { location: "RAK-A1" }); assert.equal(put.status, 200, JSON.stringify(put.body));
  t = await lihat(g.id); assert.equal(t.pipeline.indeks, 5); assert.equal(t.status, "COMPLETED"); assert.deepEqual(t.pipeline.pindah, [], "dokumen terposting: tidak ada perpindahan status (hanya jalur Koreksi)");
  assert.ok(t.aksi.every((a) => a.kode.startsWith("KOREKSI")), "terposting hanya punya aksi koreksi");
  const mundur = await w.g.patch(`${GR}/${g.id}`, { status: "SCHEDULED" }); assert.ok(mundur.status >= 400, "terposting tidak bisa dimundurkan lewat PATCH");
  assert.equal((await snap()).mov, 1, "tepat satu pergerakan stok dari Simpan ke Stok");
  // dibatalkan: alur berhenti, hanya pemulihan
  const b = await baru(); const bt = await w.g.post(`${GR}/${b.id}/batalkan-jadwal`, { alasan: "Salah buat" }); assert.equal(bt.status, 200, JSON.stringify(bt.body));
  const tb = await lihat(b.id); assert.equal(tb.pipeline.indeks, null); assert.deepEqual(tb.pipeline.pindah.map((x) => x.kode), ["PULIHKAN"]);
});

test("Pipeline Penerimaan: dua penerimaan untuk satu PO tetap dua dokumen dengan pipeline sendiri-sendiri; Terjadwal bukan bukti barang tiba", async () => {
  const w = await dunia(); await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const fin = await createTestUser({ roles: ["FINANCE"] }); const f = makeClient(server.baseUrl, fin.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-OCEAN", name: "PT OCEAN CENTRA FURNINDO", paymentTermType: "HARI", paymentTermDays: 30 } });
  const mo = await createTestMaterial({ code: "BUSA-OCEAN", name: "Busa Ocean D18", unit: "SHEET" });
  const c = await f.post("/api/finance/purchase-orders", { supplierId: supplier.id, orderDate: geser(-20), expectedDate: geser(-1), lines: [{ materialId: mo.id, qty: 50, unitPrice: 100000 }] }); assert.equal(c.status, 201, JSON.stringify(c.body));
  const po = (await f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {})).body;
  const a = (await w.g.post(GR, { purchaseOrderId: po.id, expectedDate: geser(-1) })).body; await w.g.patch(`${GR}/${a.id}`, { status: "SCHEDULED" });
  const b = (await w.g.post(GR, { purchaseOrderId: po.id, expectedDate: geser(1) })).body;
  assert.notEqual(a.receiptNumber, b.receiptNumber);
  const da = (await w.g.get(`${GR}/${a.id}`)).body; const db = (await w.g.get(`${GR}/${b.id}`)).body;
  assert.equal(da.tampilan.pipeline.indeks, 1); assert.equal(db.tampilan.pipeline.indeks, 0);
  assert.equal(da.arrivedDate, null, "Terjadwal bukan bukti barang tiba: tidak ada tanggal tiba"); assert.equal(da.tampilan.pengaruhStok, "BELUM"); assert.match(da.tampilan.label, /Terjadwal — menunggu barang tiba/);
  assert.equal(da.tampilan.pipeline.pindah.find((x) => x.kode === "CATAT_TIBA")?.ke, "TIBA", "untuk PO, pindah ke Barang tiba lewat Catat barang tiba (formulir kedatangan resmi)");
  const lst = (await w.g.get(GR)).body.receipts; assert.equal(lst.filter((x) => x.purchaseOrderId === po.id).length, 2); assert.ok(lst.every((x) => x.tampilan.pipeline && typeof x.tampilan.berikutnya === "string"));
});

test("tabel pemetaan sementara tidak membuat bahan hilang: bahan baru dengan itemGroup yang belum dikenal / kosong otomatis 'Belum dikelompokkan', ikut terhitung, dan dapat dicari", async () => {
  const w = await dunia();
  const sebelum = (await w.g.get(STOK)).body.kelompok.kelompok.find((x) => x.kode === "BELUM").total;
  await bahan("NEW-1", "Aksesori Impor Baru", "GRUP BARU DARI EXCEL"); await bahan("NEW-2", "Bahan Tanpa Grup", null); await bahan("NEW-3", "Busa Rebonded Baru", "REBONDED");
  const r = (await w.g.get(STOK)).body; const ring = Object.fromEntries(r.kelompok.kelompok.map((x) => [x.kode, x]));
  assert.equal(ring.BELUM.total, sebelum + 2, "dua bahan baru yang belum dipetakan masuk Belum dikelompokkan"); assert.equal(ring.BUSA.total, 1, "yang dikenal tetap masuk kelompoknya");
  assert.equal(r.rows.filter((x) => x.aktif).length, r.kelompok.kelompok.reduce((n, x) => n + x.total, 0), "tidak ada bahan aktif yang hilang dari ringkasan kelompok");
  assert.ok(r.rows.filter((x) => ["NEW-1", "NEW-2"].includes(x.kode)).every((x) => x.kelompok.kode === "BELUM" && x.kelompok.alasan));
  assert.match(r.rows.find((x) => x.kode === "NEW-1").kelompok.alasan, /belum ada di tabel pemetaan/);
});
