// INTEGRASI: jumlah item Penjualan Karyawan PECAHAN (migrasi 20261016090000_penjualan_karyawan_qty_desimal). Dikunci: simpan 1,6 + lebih dari 6 item, subtotal & total (aturan
// pembulatan tunggal), jurnal = total, daftar/detail/cari, pembatalan (histori) membalik persis, Laporan (ringkasan manual), Export Excel Pemasukan, input rusak → 400 tanpa
// menyimpan apa pun, dan constraint DB (jumlah > 0, presisi 3 desimal).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { toMoney } from "../../src/services/finance/money.js";
import { STATUS_DIHITUNG } from "../../src/services/finance/journal.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const seller = await testPrisma.user.create({ data: { name: "Emon Uji", email: `emon-${Date.now()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  return { seller, token, c: makeClient(server.baseUrl, token) };
}
async function saldo(code) {
  const akun = await testPrisma.finAccount.findUnique({ where: { code } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG } } }, select: { debit: true, credit: true } });
  return baris.reduce((a, b) => a.plus(toMoney(b.debit)).minus(toMoney(b.credit)), toMoney(0)).toFixed(2);
}
const U = "/api/finance/penjualan-karyawan";
const ITEM_OWNER = [
  { name: "LEM I-SR 1037 13 KG", quantity: 2, unitPrice: 49950 }, { name: "BUSA OCEAN D18 200X200X2CM", quantity: 2, unitPrice: 110800 },
  { name: "LIST WIBING ABU", quantity: 6, unitPrice: 86000 }, { name: "LIST WIBING COKLAT", quantity: 12, unitPrice: 86000 },
  { name: "HARDPAD FUJIPO", quantity: "1,6".replace(",", "."), unitPrice: 35000 }, { name: "KAIN TABENG HIKARON, IVONNA: (287: PEANUT)", quantity: 2, unitPrice: 20000 },
];
const badan = (seller, items, extra = {}) => ({ date: "2026-10-02", sellerId: seller.id, buyerName: "Pemakaian bahan", notes: "PEMAKAIAN BAHAN 16 AGUS", items, ...extra });

test("Skenario layar Owner: 6 item termasuk HARDPAD 1,6 → tersimpan; subtotal/total benar; jurnal = total; jumlah pecahan tersimpan persis (1.600)", async () => {
  const { seller, c } = await siapkan();
  const r = await c.post(U, badan(seller, ITEM_OWNER));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.total, 1_965_500);
  assert.equal(r.body.items.length, 6);
  const hardpad = r.body.items.find((i) => i.name === "HARDPAD FUJIPO");
  assert.equal(hardpad.quantity, 1.6);
  assert.equal(hardpad.subtotal, 56_000);
  assert.equal(r.body.items.reduce((s, i) => s + i.subtotal, 0), r.body.total, "Σ subtotal yang tampil = total");
  const baris = await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: r.body.id } });
  assert.equal(baris.find((b) => b.name === "HARDPAD FUJIPO").quantity.toFixed(3), "1.600");
  assert.equal(await saldo("1-1350"), "1965500.00", "piutang karyawan = total");
  assert.equal(await saldo("4-1250"), "-1965500.00", "pendapatan = total");
});

test("Pembulatan HALF_UP per baris di API: total = Σ subtotal dibulatkan; jurnal sama dengan total dokumen", async () => {
  const { seller, c } = await siapkan();
  const r = await c.post(U, badan(seller, [{ name: "A", quantity: "0.5", unitPrice: "12345.67" }, { name: "B", quantity: "0.5", unitPrice: "12345.67" }]));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((i) => i.subtotal), [6172.84, 6172.84]);
  assert.equal(r.body.total, 12345.68);
  assert.equal(await saldo("1-1350"), "12345.68");
});

test("Daftar, detail, dan pencarian nama item menampilkan jumlah pecahan; bulat lama tetap bulat", async () => {
  const { seller, c } = await siapkan();
  const a = (await c.post(U, badan(seller, ITEM_OWNER))).body;
  const b = (await c.post(U, badan(seller, [{ name: "Kasur", quantity: 3, unitPrice: 1_000_000 }], { buyerName: "Pak Budi" }))).body;
  const daftar = await c.get(U);
  assert.equal(daftar.status, 200);
  const da = daftar.body.penjualan.find((x) => x.id === a.id), db = daftar.body.penjualan.find((x) => x.id === b.id);
  assert.equal(da.items.find((i) => i.name === "HARDPAD FUJIPO").quantity, 1.6);
  assert.equal(db.items[0].quantity, 3);
  const detail = await c.get(`${U}/${a.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.items.find((i) => i.name === "HARDPAD FUJIPO").subtotal, 56_000);
  const cari = await c.get(`${U}?q=hardpad`);
  assert.deepEqual(cari.body.penjualan.map((x) => x.id), [a.id]);
  assert.equal(daftar.body.ringkasan.nilai, 1_965_500 + 3_000_000);
});

test("Histori/pembatalan: batal membalik jurnal persis total pecahan; item tetap tersimpan utuh (append-only)", async () => {
  const { seller, c } = await siapkan();
  const a = (await c.post(U, badan(seller, ITEM_OWNER))).body;
  assert.equal(await saldo("1-1350"), "1965500.00");
  const batal = await c.post(`${U}/${a.id}/batal`, { reason: "salah input" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.equal(await saldo("1-1350"), "0.00");
  assert.equal(await saldo("4-1250"), "0.00");
  const sesudah = await c.get(`${U}/${a.id}`);
  assert.equal(sesudah.body.statusTampil, "DIBATALKAN");
  assert.equal(sesudah.body.items.find((i) => i.name === "HARDPAD FUJIPO").quantity, 1.6, "item tidak berubah/terhapus");
  assert.equal(await testPrisma.finPenjualanKaryawanItem.count({ where: { penjualanId: a.id } }), 6);
});

test("Input rusak lewat API → 400 dan TIDAK ada dokumen/item/jurnal tersimpan", async () => {
  const { seller, c } = await siapkan();
  const rusak = ["1,6", "1.600,5", "NaN", "-1", "0", "1.2345", "1e3", "abc", "", "1001"];
  for (const q of rusak) {
    const r = await c.post(U, badan(seller, [{ name: "X", quantity: q, unitPrice: 1000 }]));
    assert.equal(r.status, 400, `jumlah ${JSON.stringify(q)} → ${r.status} ${JSON.stringify(r.body)}`);
    assert.match(r.body.error, /Jumlah item/);
  }
  for (const h of ["1,5", "NaN", "-5", "0", "100.123"]) assert.equal((await c.post(U, badan(seller, [{ name: "X", quantity: 1, unitPrice: h }]))).status, 400, `harga ${h}`);
  assert.equal((await c.post(U, badan(seller, [{ name: "X", quantity: "0.001", unitPrice: 1 }]))).status, 400, "subtotal dibulatkan menjadi Rp0");
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 0);
  assert.equal(await testPrisma.finPenjualanKaryawanItem.count(), 0);
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
});

test("Laporan: ringkasan manual & gabungan memakai total pecahan yang sama; periode lain tidak ikut", async () => {
  const { seller, c } = await siapkan();
  await c.post(U, badan(seller, ITEM_OWNER));
  const r = await c.get("/api/orders/penjualan-karyawan/ringkasan?from=2026-10-01&to=2026-10-31");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.manual.nilai, 1_965_500);
  assert.equal(r.body.gabungan.nilai, 1_965_500);
  assert.equal((await c.get("/api/orders/penjualan-karyawan/ringkasan?from=2026-09-01&to=2026-09-30")).body.manual.jumlah, 0);
});

test("Export Excel Pemasukan: baris Penjualan Karyawan bernilai total pecahan (angka, bukan teks) = layar", async () => {
  const { seller, token, c } = await siapkan();
  await c.post(U, badan(seller, ITEM_OWNER));
  const periode = { from: "2026-10-01", to: "2026-10-31" };
  const layar = await c.get(`/api/finance/pemasukan?from=${periode.from}&to=${periode.to}`);
  assert.equal(layar.status, 200, JSON.stringify(layar.body).slice(0, 200));
  const r = await unduhExport(server.baseUrl, token, "pemasukan", { periode, filterLabel: "Kategori: (semua)" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = bacaSheet(r.wb, "Pemasukan");
  const baris = s.baris.filter((b) => Object.values(b).some((v) => typeof v === "string" && /PKR-/.test(v)));
  assert.ok(baris.length >= 1, "baris PKR ada di export");
  const nilai = baris.map((b) => Object.values(b).find((v) => typeof v === "number" && Math.abs(v - 1_965_500) < 0.005));
  assert.ok(nilai.some((v) => v === 1_965_500), `nilai 1965500 sebagai angka: ${JSON.stringify(baris[0])}`);
});

test("Constraint DB: jumlah 0/negatif ditolak CHECK; presisi >3 desimal dibulatkan oleh tipe kolom (API sudah menolaknya lebih dulu); pecahan 3 desimal tersimpan persis", async () => {
  const { seller, c } = await siapkan();
  const a = (await c.post(U, badan(seller, [{ name: "X", quantity: "1.625", unitPrice: 1000 }]))).body;
  const tersimpan = await testPrisma.finPenjualanKaryawanItem.findFirst({ where: { penjualanId: a.id } });
  assert.equal(tersimpan.quantity.toFixed(3), "1.625");
  for (const q of ["0", "-1"]) {
    await assert.rejects(
      () => testPrisma.$executeRawUnsafe(`INSERT INTO fin_penjualan_karyawan_items (id, penjualan_id, name, quantity, unit_price, sort_order) VALUES (gen_random_uuid(), '${a.id}', 'Z', ${q}, 1000, 9)`),
      /fin_penjualan_karyawan_items_qty_chk|check constraint/i, `quantity ${q} harus ditolak CHECK`,
    );
  }
});
