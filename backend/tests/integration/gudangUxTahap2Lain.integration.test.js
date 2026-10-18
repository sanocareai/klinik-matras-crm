// UX GUDANG TAHAP 2 — Restok, Barang Rusak, Retur, Penyesuaian Stok, Stock Opname: tampilan/aksi per status dari server (satu sumber), izin hanya-lihat, penjelasan pemisahan tugas,
// dampak ke stok yang jujur (hanya penyelesaian tertentu yang menulis stok), dan jejak. Aturan bisnis lama tidak diubah. DB terisolasi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const B = "/api/inventory";
async function dunia() {
  const [gudang, gudang2, owner, lead] = await Promise.all(["WAREHOUSE", "WAREHOUSE", "OWNER", "PRODUCTION_LEAD"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const busa = await createTestMaterial({ name: "Busa LN", reorderQty: 20 }); await seedBalance(busa.id, 40);
  return { g: c(gudang), g2: c(gudang2), o: c(owner), p: c(lead), busa, gudang };
}
const stok = async (id) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: id }, _sum: { qty: true } }))._sum.qty ?? 0);
const kode = (t) => t.aksi.map((a) => a.kode);
const get = async (c, path) => (await c.get(path)).body;

test("Restok: alur, aksi per status, tidak pernah menyentuh stok, ditolak/final tanpa aksi, hanya-lihat tanpa aksi", async () => {
  const w = await dunia(); const awal = await stok(w.busa.id);
  const c = await w.g.post(`${B}/replenishment`, { source: "MANUAL_REQUEST", materialId: w.busa.id, suggestedQty: 10 }); assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.id;
  let d = await get(w.g, `${B}/replenishment/${id}`); assert.deepEqual(kode(d.tampilan), ["AJUKAN", "UBAH", "TOLAK"]); assert.equal(d.tampilan.pengaruhStok, "BELUM"); assert.equal(d.izin.tulis, true);
  assert.deepEqual(d.tampilan.tahap.map((t) => t.kode), ["DRAF", "MENUNGGU", "DISETUJUI", "DIPESAN", "SELESAI"]);
  const langkah = [["WAITING_APPROVAL", "MENUNGGU", "SETUJUI"], ["APPROVED", "DISETUJUI", "TANDAI_DIPESAN"], ["ORDERED", "DIPESAN", "HUBUNGKAN_PENERIMAAN"]];
  for (const [s, k, aksi] of langkah) { assert.equal((await w.g.patch(`${B}/replenishment/${id}`, { status: s })).status, 200); d = await get(w.g, `${B}/replenishment/${id}`); assert.equal(d.tampilan.kode, k); assert.ok(kode(d.tampilan).includes(aksi)); }
  assert.equal(await stok(w.busa.id), awal, "Restok tidak pernah menyentuh stok");
  const baca = await get(w.p, `${B}/replenishment/${id}`); assert.equal(baca.izin.tulis, false); assert.deepEqual(baca.tampilan.aksi, []); assert.equal(baca.tampilan.kode, "DIPESAN");
  const r2 = (await w.g.post(`${B}/replenishment`, { source: "MANUAL_REQUEST", materialId: w.busa.id, suggestedQty: 5 })).body;
  assert.equal((await w.g.patch(`${B}/replenishment/${r2.id}/reject`, { reason: "Tidak jadi dibutuhkan" })).status, 200);
  const dt = await get(w.g, `${B}/replenishment/${r2.id}`); assert.equal(dt.tampilan.kode, "DITOLAK"); assert.deepEqual(dt.tampilan.aksi, []); assert.match(dt.tampilan.penjelasan, /Tidak jadi dibutuhkan/);
  const daftar = (await get(w.g, `${B}/replenishment`)).requests; assert.ok(daftar.every((x) => x.tampilan?.label));
});

test("Barang Rusak: hanya Dibuang/Retur supplier yang mengurangi stok; penyelesaian lain hanya dicatat; label & jejak jujur", async () => {
  const w = await dunia(); const awal = await stok(w.busa.id);
  const mk = async () => (await w.g.post(`${B}/damaged-stock`, { materialId: w.busa.id, qty: 4, damageCategory: "TORN" })).body;
  const a = await mk(); let d = await get(w.g, `${B}/damaged-stock/${a.id}`); assert.equal(d.tampilan.kode, "DILAPORKAN"); assert.deepEqual(kode(d.tampilan), ["MULAI_PERIKSA"]); assert.equal(d.tampilan.pengaruhStok, "BELUM");
  assert.equal((await w.g.patch(`${B}/damaged-stock/${a.id}/inspect`, {})).status, 200); d = await get(w.g, `${B}/damaged-stock/${a.id}`); assert.deepEqual(kode(d.tampilan), ["SELESAIKAN"]);
  assert.equal(await stok(w.busa.id), awal, "belum ada pengaruh sampai diselesaikan");
  assert.equal((await w.g.post(`${B}/damaged-stock/${a.id}/resolve`, { resolution: "DISPOSE", resolutionNote: "dibuang" })).status, 200);
  d = await get(w.g, `${B}/damaged-stock/${a.id}`); assert.equal(d.tampilan.label, "Selesai — stok berkurang"); assert.equal(d.tampilan.pengaruhStok, "SUDAH"); assert.equal(await stok(w.busa.id), awal - 4);
  assert.ok(d.jejak.some((j) => j.aksi === "DISELESAIKAN" && /stok berkurang/.test(j.teks) && /dibuang/.test(j.teks)), JSON.stringify(d.jejak));
  const b = await mk(); await w.g.patch(`${B}/damaged-stock/${b.id}/inspect`, {}); assert.equal((await w.g.post(`${B}/damaged-stock/${b.id}/resolve`, { resolution: "REWORK" })).status, 200);
  const e = await get(w.g, `${B}/damaged-stock/${b.id}`); assert.equal(e.tampilan.label, "Selesai — stok tidak berubah"); assert.equal(e.tampilan.pengaruhStok, "TIDAK"); assert.equal(await stok(w.busa.id), awal - 4);
  assert.deepEqual((await get(w.p, `${B}/damaged-stock/${a.id}`)).tampilan.aksi, []);
});

test("Retur: alur Dicatat→Diterima→Diperiksa→Selesai; hanya 'Kembalikan ke tersedia' menambah stok; batal & hanya-lihat", async () => {
  const w = await dunia(); const awal = await stok(w.busa.id);
  const r = (await w.g.post(`${B}/returns`, { returnType: "CUSTOMER_RETURN", materialId: w.busa.id, qty: 3 })).body; let d = await get(w.g, `${B}/returns/${r.id}`);
  assert.equal(d.tampilan.kode, "DICATAT"); assert.deepEqual(kode(d.tampilan), ["TERIMA_RETUR", "UBAH", "BATALKAN"]);
  await w.g.patch(`${B}/returns/${r.id}`, { status: "RECEIVED" }); d = await get(w.g, `${B}/returns/${r.id}`); assert.deepEqual(kode(d.tampilan), ["PERIKSA_RETUR", "UBAH", "BATALKAN"]);
  await w.g.patch(`${B}/returns/${r.id}`, { status: "INSPECTION", inspectionNote: "baik" }); d = await get(w.g, `${B}/returns/${r.id}`); assert.deepEqual(kode(d.tampilan), ["SELESAIKAN", "UBAH", "BATALKAN"]);
  assert.equal(await stok(w.busa.id), awal);
  assert.equal((await w.g.post(`${B}/returns/${r.id}/complete`, { resolution: "RETURN_TO_AVAILABLE" })).status, 200); d = await get(w.g, `${B}/returns/${r.id}`);
  assert.equal(d.tampilan.label, "Selesai — stok bertambah"); assert.equal(d.tampilan.pengaruhStok, "SUDAH"); assert.equal(await stok(w.busa.id), awal + 3); assert.deepEqual(d.tampilan.aksi, []);
  assert.ok(d.jejak.some((j) => j.aksi === "DISELESAIKAN" && /kembali ke stok tersedia/.test(j.teks)));
  const r2 = (await w.g.post(`${B}/returns`, { returnType: "DELIVERY_RETURN", materialId: w.busa.id, qty: 1 })).body;
  await w.g.patch(`${B}/returns/${r2.id}`, { status: "RECEIVED" }); await w.g.patch(`${B}/returns/${r2.id}`, { status: "INSPECTION" }); await w.g.post(`${B}/returns/${r2.id}/complete`, { resolution: "DISPOSE" });
  const e = await get(w.g, `${B}/returns/${r2.id}`); assert.equal(e.tampilan.label, "Selesai — stok tidak berubah"); assert.equal(await stok(w.busa.id), awal + 3);
  const r3 = (await w.g.post(`${B}/returns`, { returnType: "CUSTOMER_RETURN", materialId: w.busa.id, qty: 1 })).body; assert.equal((await w.g.patch(`${B}/returns/${r3.id}/cancel`, { reason: "salah catat" })).status, 200);
  assert.equal((await get(w.g, `${B}/returns/${r3.id}`)).tampilan.kode, "DIBATALKAN"); assert.deepEqual((await get(w.p, `${B}/returns/${r.id}`)).tampilan.aksi, []);
});

test("Penyesuaian Stok: Setujui hanya ditawarkan kepada penyetuju berperan yang BUKAN pemohon; alasan dijelaskan; posting ke stok", async () => {
  const w = await dunia(); const awal = await stok(w.busa.id);
  const a = (await w.g.post(`${B}/adjustments`, { materialId: w.busa.id, adjustmentType: "POSITIVE", adjustmentQty: 3, reason: "Temuan fisik" })).body; let d = await get(w.g, `${B}/adjustments/${a.id}`);
  assert.deepEqual(kode(d.tampilan), ["AJUKAN", "UBAH", "BATALKAN"]); assert.equal(d.izin.pemohonSama, true);
  await w.g.patch(`${B}/adjustments/${a.id}`, { status: "WAITING_APPROVAL" });
  d = await get(w.g, `${B}/adjustments/${a.id}`); assert.ok(!kode(d.tampilan).includes("SETUJUI"), "pemohon (peran gudang) tidak ditawari Setujui"); assert.match(d.tampilan.penjelasan, /tidak berperan penyetuju/);
  const dow = await get(w.o, `${B}/adjustments/${a.id}`); assert.ok(kode(dow.tampilan).includes("SETUJUI"), "Owner (bukan pemohon) ditawari Setujui"); assert.equal(dow.izin.tulis, true);
  assert.equal((await w.o.patch(`${B}/adjustments/${a.id}`, { status: "APPROVED" })).status, 200);
  d = await get(w.g, `${B}/adjustments/${a.id}`); assert.deepEqual(kode(d.tampilan), ["POSTING", "BATALKAN"]); assert.equal(await stok(w.busa.id), awal);
  assert.equal((await w.g.post(`${B}/adjustments/${a.id}/post`, {})).status, 200); d = await get(w.g, `${B}/adjustments/${a.id}`); assert.equal(d.tampilan.kode, "DIPOSTING"); assert.equal(d.tampilan.pengaruhStok, "SUDAH"); assert.equal(await stok(w.busa.id), awal + 3);
  assert.ok(d.jejak.some((j) => j.aksi === "DISETUJUI") && d.jejak.some((j) => j.aksi === "DIPOSTING"));
  // pemohon = Owner: tidak ditawari Setujui untuk dokumen sendiri
  const b = (await w.o.post(`${B}/adjustments`, { materialId: w.busa.id, adjustmentType: "NEGATIVE", adjustmentQty: -1, reason: "Susut" })).body; await w.o.patch(`${B}/adjustments/${b.id}`, { status: "WAITING_APPROVAL" });
  const db = await get(w.o, `${B}/adjustments/${b.id}`); assert.ok(!kode(db.tampilan).includes("SETUJUI")); assert.match(db.tampilan.penjelasan, /pemohon dokumen ini/);
  assert.equal((await w.o.patch(`${B}/adjustments/${b.id}`, { status: "APPROVED" })).status, 403, "server tetap menolak");
});

test("Stock Opname: tampilan per status; aksi Selesaikan disembunyikan bagi non-penyetuju bila ada selisih; periksa hanya untuk Opname Penuh & bukan penghitung; hanya-lihat", async () => {
  const w = await dunia();
  const c = (await w.g.post(`${B}/stock-counts`, { countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: [{ materialId: w.busa.id }] })).body; let d = await get(w.g, `${B}/stock-counts/${c.id}`);
  assert.equal(d.tampilan.kode, "TERJADWAL"); assert.deepEqual(kode(d.tampilan), ["MULAI_HITUNG", "UBAH", "BATALKAN"]); assert.deepEqual(d.tampilan.tahap.map((t) => t.kode), ["TERJADWAL", "DIHITUNG", "TINJAUAN", "SELESAI"]);
  assert.equal((await w.g.post(`${B}/stock-counts/${c.id}/start`, {})).status, 200); d = await get(w.g, `${B}/stock-counts/${c.id}`); assert.deepEqual(kode(d.tampilan), ["SERAHKAN_HITUNGAN", "BATALKAN"]);
  const baris = d.lines[0]; assert.equal((await w.g.patch(`${B}/stock-counts/${c.id}/lines/${baris.id}`, { countedQty: 37, reason: "Salah hitung rak" })).status, 200);
  assert.equal((await w.g.post(`${B}/stock-counts/${c.id}/submit`, {})).status, 200); d = await get(w.g, `${B}/stock-counts/${c.id}`);
  assert.equal(d.tampilan.kode, "TINJAUAN"); assert.equal(d.adaSelisih, true); assert.deepEqual(kode(d.tampilan), ["HITUNG_ULANG", "BATALKAN"], "Cycle Count: tanpa Periksa; non-penyetuju tidak ditawari Selesaikan");
  assert.match(d.tampilan.penjelasan, /hanya penyetuju/); assert.equal(d.izin.bisaMenyetujuiSelisih, false);
  const dow = await get(w.o, `${B}/stock-counts/${c.id}`); assert.ok(kode(dow.tampilan).includes("SELESAIKAN_OPNAME")); assert.equal(dow.izin.bisaMenyetujuiSelisih, true);
  assert.deepEqual((await get(w.p, `${B}/stock-counts/${c.id}`)).tampilan.aksi, []);
  assert.ok((await get(w.g, `${B}/stock-counts/${c.id}`)).jejak.some((j) => j.aksi === "HITUNGAN_DISERAHKAN"));
  // Opname Penuh: penghitung tidak ditawari Periksa; petugas lain ditawari
  const f = (await w.g.post(`${B}/stock-counts`, { countType: "FULL_STOCK_OPNAME", countMethod: "FULL_WAREHOUSE", lines: [{ materialId: w.busa.id }] })).body; await w.g.post(`${B}/stock-counts/${f.id}/start`, {});
  const fd = await get(w.g, `${B}/stock-counts/${f.id}`); await w.g.patch(`${B}/stock-counts/${f.id}/lines/${fd.lines[0].id}`, { countedQty: 40 }); await w.g.post(`${B}/stock-counts/${f.id}/submit`, {});
  assert.ok(!kode((await get(w.g, `${B}/stock-counts/${f.id}`)).tampilan).includes("PERIKSA_HITUNGAN"), "penghitung tidak memeriksa hitungannya sendiri");
  assert.ok(kode((await get(w.g2, `${B}/stock-counts/${f.id}`)).tampilan).includes("PERIKSA_HITUNGAN"), "petugas lain ditawari Periksa");
  const daftar = (await get(w.g, `${B}/stock-counts`)).counts; assert.ok(daftar.every((x) => x.tampilan?.label));
});
