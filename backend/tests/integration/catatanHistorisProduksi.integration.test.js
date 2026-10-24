// Catatan pemakaian historis TAMPIL di Produksi: ringkasan unit, tab Bahan (data), Riwayat, daftar Order Produksi, ekspor Excel, dan HPP parsial — tanpa menggandakan 'Pemakaian aktual'.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { rencanakanImpor, terapkanImpor } from "../../src/services/catatanPemakaianHistoris.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, kat, nama, qty, sat) => `${no},${order},1 Sep 26,SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);

async function dunia() {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const c = makeClient(server.baseUrl, admin.token);
  const kain = await createTestMaterial({ code: "P-KAIN", name: "KAIN LAVA PROD", unit: "METER" }); const lem = await createTestMaterial({ code: "P-LEM", name: "LEM I-SR PROD 13 KG", unit: "CAN" });
  await seedBalance(kain.id, 20, { createdAt: WIB("2026-09-01"), unitCost: 25000 }); await seedBalance(lem.id, 5, { createdAt: WIB("2026-09-01"), unitCost: 600000 });
  const { order, unit } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: "RES-01092026-777", status: "DELIVERED" } });
  await testPrisma.stockMovement.create({ data: { materialId: kain.id, type: "ISSUE", qty: -1.7, unitId: unit.id, note: "Impor pemakaian Sept 2026 — order asli: X -> RES-01092026-777", createdAt: WIB("2026-09-01") } });
  const csv = ["J", "D", HDR, baris(1, "RES-01092026-777", "Bahan Lapisan", "KAIN LAVA PROD", "1,7", "METER"), baris(2, "RES-01092026-777", "Lain-lain", "LEM I-SR PROD 13 KG", "1,5", "KG"), baris(3, "RES-01092026-777", "Lain-lain", "BAHAN GAIB", "1,0", "PCS")].join("\n");
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv, namaBerkas: "uji.csv" }), {});
  return { c, admin, unit, kain, lem };
}

test("P1. Detail Order Produksi memuat catatan historis (nilai asli, label Perlu dicek, catatan singkat) TANPA menggandakan Pemakaian aktual", async () => {
  const w = await dunia();
  const r = await w.c.get(`/api/production/units/${w.unit.id}/adopsi`); assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const ch = r.body.catatanHistoris; assert.equal(ch.ringkas.total, 3); assert.equal(ch.ringkas.tercatatDiStok, 1); assert.equal(ch.ringkas.perluDicek, 2);
  const lem = ch.items.find((i) => i.nama === "LEM I-SR PROD 13 KG"); assert.equal(lem.label, "Perlu dicek"); assert.equal(lem.qtyAsli, "1,5"); assert.equal(lem.satuanAsli, "KG"); assert.match(lem.catatan, /salah satuan/);
  assert.equal(r.body.pemakaianAktual.baris.length, 1, "Pemakaian aktual hanya ISSUE yang sungguh ada — catatan Excel tidak ikut");
  assert.equal(r.body.adopsi.pemakaianBahan.baruCatatan, 1);
  assert.equal(r.body.adopsi.kerja.key, "SELESAI", "status kerja tidak berubah oleh catatan historis");
  assert.ok(r.body.riwayat.some((e) => e.kind === "CATATAN_HISTORIS" && /bukan pengeluaran stok baru/.test(e.label)));
});

test("P2. HPP per order PARSIAL: menyebut gap, tidak ditampilkan sebagai final", async () => {
  const w = await dunia();
  const r = await w.c.get(`/api/production/units/${w.unit.id}/adopsi`);
  const h = r.body.hppBahan; assert.equal(h.parsial, true); assert.equal(h.final, false);
  const gap = h.gap.find((g) => g.jenis === "CATATAN_BELUM_JADI_STOK"); assert.ok(gap, JSON.stringify(h.gap)); assert.match(gap.pesan, /PARSIAL/);
  assert.match(h.catatan, /Bukan HPP final/);
});

test("P3. Daftar Order Produksi + ekspor Excel: ringkasan catatan, sheet 'Catatan Historis' dengan nilai asli, dan sheet Pemakaian Aktual tidak bertambah", async () => {
  const w = await dunia();
  const l = await w.c.get(`/api/production/work-orders?q=RES-01092026-777`); const row = (l.body.units ?? l.body.items ?? []).find((u) => u.id === w.unit.id);
  assert.equal(row.adopsi.catatanHistoris.total, 3); assert.equal(row.adopsi.catatanHistoris.perluDicek, 2);
  const res = await fetch(`${server.baseUrl}/api/production/work-orders/export.xlsx?q=RES-01092026-777`, { headers: { Authorization: `Bearer ${w.admin.token}` } });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const sh = wb.getWorksheet("Catatan Historis"); assert.ok(sh);
  const rows = []; sh.eachRow((r2, i) => { if (i > 1) rows.push(r2.values.slice(1)); });
  assert.equal(rows.length, 3); const lem = rows.find((r2) => r2.includes("LEM I-SR PROD 13 KG"));
  assert.ok(lem, "baris LEM ada"); assert.ok(lem.includes("1,5") && lem.includes("KG"), "nilai asli tampil apa adanya"); assert.ok(lem.includes("Perlu dicek"));
  const aktual = []; wb.getWorksheet("Pemakaian Aktual").eachRow((r2, i) => { if (i > 1) aktual.push(r2.values); }); assert.equal(aktual.length, 1);
  const ring = wb.getWorksheet("Ringkasan Unit"); const hdr = ring.getRow(1).values.slice(1); assert.ok(hdr.includes("Catatan Historis Perlu Dicek (jumlah)"));
});
