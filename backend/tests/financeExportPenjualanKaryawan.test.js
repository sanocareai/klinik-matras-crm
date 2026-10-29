import test from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "../src/services/finance/money.js";
import modul from "../src/services/finance/export/penjualan-karyawan.js";
import { buatXlsx } from "../src/services/finance/export/excel.js";

test("export PKR memakai semua hasil filter, pembayaran batal tidak dihitung dan rekap periode terpisah", async () => {
  const dokumen = (nomor, status, pembayaran) => ({ id: nomor, nomor, status, date: new Date("2026-10-29T00:00:00Z"),
    createdAt: new Date("2026-10-29T00:00:00Z"), sellerId: "s1", seller: { name: "Kemal" }, buyerName: "Indra",
    total: new Decimal(200), items: [{ name: "Kasur", quantity: new Decimal(2), unitPrice: new Decimal(100) }], payments: pembayaran });
  const pay = (amount, cancelledAt = null) => ({ amount: new Decimal(amount), cancelledAt, method: "TRANSFER", date: new Date("2026-10-30T00:00:00Z"), cashAccount: { name: "Bank" } });
  const rows = [dokumen("PKR-1", "AKTIF", [pay(80), pay(20, new Date())]), dokumen("PKR-2", "DIBATALKAN", [])];
  const calls = [];
  const db = { finPenjualanKaryawan: { findMany: async (query) => { calls.push(query); return query.where.status === "AKTIF" ? [rows[0]] : rows; } } };
  const data = await modul.ambil(db, { periode: { from: "2026-10-01", to: "2026-10-31" }, filter: { q: "Indra" } });
  assert.equal(calls[0].take, 50_001, "tidak memotong export di batas 500 pada UI");
  assert.deepEqual(data.sheets[0].baris.map((r) => [r.nomor, r.total, r.terbayar, r.sisa]), [["PKR-1", 200, 80, 120], ["PKR-2", 200, 0, 0]]);
  assert.deepEqual(data.sheets[0].total.nilai, { total: 200, terbayar: 80, sisa: 120 });
  assert.deepEqual(data.sheets[1].baris.map((r) => [r.nama, r.jumlah, r.nilai, r.sisa]), [["Kemal", 1, 200, 120]]);
  assert.equal(data.sheets[2].baris.length, 2);
  assert.ok((await buatXlsx(data, { bolehSensitif: false })).length > 1000);
  await assert.rejects(() => modul.ambil(db, { periode: {}, filter: { status: "APA_SAJA" } }), /Status penjualan tidak valid/);
});
