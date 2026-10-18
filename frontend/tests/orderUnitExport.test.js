// EXPORT ORDER — representasi unit (kasus Indra: 3 kasur sejenis dalam 1 order tidak boleh tampak "1 kasur" di Excel).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KOLOM_RINCIAN_UNIT, barisRincianUnit, jumlahUnitOrder, produkRingkasOrder, semuaRincianUnit, totalUnitOrders } from "../src/utils/orderUnitExport.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unit = (n, o = {}) => ({
  id: `u${n}`, kode: `NEW-X-U${n}`, urutan: n, dari: 3, urutanLabel: `${n} dari 3`,
  item: { no: 1, nama: o.nama ?? "Kasur Sorong 3in1 custom" }, merk: "Sano", ukuran: o.ukuran ?? "100x200", spesifikasi: o.spek ?? "Pocket spring 5 zona",
  produksi: { kode: "RECEIVED", label: "Menunggu produksi", tahap: null }, rencana: null,
  delivery: { kode: "MENUNGGU_PRODUKSI", label: "Menunggu produksi selesai", jobId: null, tanggal: null }, kirim: { perluDikirim: true, label: "Dikirim" },
});
const orderIndra = { orderNumber: "NEW-X", customerName: "Pelanggan Contoh", quantity: 3, penjualanKaryawan: { unitBaris: [unit(1), unit(2), unit(3)], ringkasUnit: { total: 3 } } };

test("3 kasur sejenis dalam 1 order → Jumlah Unit 3, produk digabung '3× …', rincian 3 baris (1 per unit)", () => {
  assert.equal(jumlahUnitOrder(orderIndra), 3);
  assert.equal(produkRingkasOrder(orderIndra), "3× Kasur Sorong 3in1 custom (100 × 200 cm)");
  const baris = barisRincianUnit(orderIndra, { pelanggan: "Pelanggan Contoh", sales: "Sales A" });
  assert.equal(baris.length, 3);
  assert.deepEqual(baris.map((b) => b.Unit), ["NEW-X-U1", "NEW-X-U2", "NEW-X-U3"]);
  assert.deepEqual(baris.map((b) => b["Unit ke"]), ["1 dari 3", "2 dari 3", "3 dari 3"]);
  assert.ok(baris.every((b) => b["ID Order"] === "NEW-X" && b["Sales Person"] === "Sales A" && b.Ukuran === "100 × 200 cm" && b.Pengiriman === "Dikirim"));
  assert.deepEqual(Object.keys(baris[0]), KOLOM_RINCIAN_UNIT);
});

test("produk berbeda dalam satu order tidak dipotong: '2× Kasur …; 1× Divan …' (Excel memuat semuanya)", () => {
  const o = { orderNumber: "NEW-Y", penjualanKaryawan: { unitBaris: [unit(1), unit(2), unit(3, { nama: "Divan Laci", ukuran: "100x200" }), { ...unit(4, { nama: "Sandaran", ukuran: "" }) }, { ...unit(5, { nama: "Matras Lipat", ukuran: "" }) }] } };
  const t = produkRingkasOrder(o);
  assert.match(t, /^2× Kasur Sorong 3in1 custom \(100 × 200 cm\); 1× Divan Laci \(100 × 200 cm\); 1× Sandaran; 1× Matras Lipat$/);
  assert.doesNotMatch(t, /jenis lain/);
});

test("order lama / biasa tanpa unit: Jumlah Unit dari quantity (minimal 1), produk kosong, tidak ada baris rincian", () => {
  assert.equal(jumlahUnitOrder({ orderNumber: "RES-1", quantity: 1 }), 1);
  assert.equal(jumlahUnitOrder({ orderNumber: "RES-2", quantity: 2 }), 2);
  assert.equal(jumlahUnitOrder({ orderNumber: "RES-3" }), 1);
  assert.equal(jumlahUnitOrder({ orderNumber: "RES-4", quantity: 0 }), 1);
  assert.equal(jumlahUnitOrder({ orderNumber: "RES-5", quantity: "abc" }), 1);
  assert.equal(produkRingkasOrder({ orderNumber: "RES-1" }), "");
  assert.deepEqual(barisRincianUnit({ orderNumber: "RES-1" }), []);
});

test("banyak order: rincian berurutan, total unit = jumlah semua unit (bukan jumlah order)", () => {
  const biasa = { orderNumber: "RES-1", quantity: 1 };
  const semua = [orderIndra, biasa];
  assert.equal(totalUnitOrders(semua), 4);
  const rinci = semuaRincianUnit(semua, (o) => ({ pelanggan: o.customerName ?? "", sales: "S" }));
  assert.equal(rinci.length, 3);
  assert.equal(new Set(rinci.map((r) => r.Unit)).size, 3, "tiap unit satu baris, tanpa duplikat");
});

test("Orders.jsx & exportOrdersStyled.js memakai modul unit: kolom Jumlah Unit + sheet Rincian Unit (ekspor berwarna DAN cadangan polos)", () => {
  const orders = fs.readFileSync(path.join(root, "src/pages/Orders.jsx"), "utf8");
  const styled = fs.readFileSync(path.join(root, "src/utils/exportOrdersStyled.js"), "utf8");
  assert.match(orders, /"Jumlah Unit": jumlahUnitOrder\(o\)/);
  assert.match(orders, /"Produk per Unit": produkRingkasOrder\(o\)/);
  assert.match(orders, /unit: sheetUnit/);
  assert.match(orders, /name: "Rincian Unit", data: sheetUnit/);
  assert.match(styled, /addWorksheet\("Rincian Unit"/);
  assert.match(styled, /buatSheetUnit\(wb, unit\)/);
});
