// EXPORT ORDER — representasi unit (kasus Indra: 3 kasur sejenis dalam 1 order tidak boleh tampak "1 kasur" di Excel).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KOLOM_REKAP_UNIT, barisRekapUnit, jumlahUnitOrder, produkRingkasOrder, semuaRekapUnit, totalUnitOrders } from "../src/utils/orderUnitExport.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unit = (n, o = {}) => ({
  id: `u${n}`, kode: `NEW-X-U${n}`, urutan: n, dari: 3, urutanLabel: `${n} dari 3`,
  item: { no: 1, nama: o.nama ?? "Kasur Sorong 3in1 custom" }, merk: "Sano", ukuran: o.ukuran ?? "100x200", spesifikasi: o.spek ?? "Pocket spring 5 zona",
  produksi: { kode: "RECEIVED", label: "Menunggu produksi", tahap: null }, rencana: null,
  delivery: { kode: "MENUNGGU_PRODUKSI", label: "Menunggu produksi selesai", jobId: null, tanggal: null }, kirim: { perluDikirim: true, label: "Dikirim" },
});
const orderIndra = { orderNumber: "NEW-X", customerName: "Pelanggan Contoh", quantity: 3, penjualanKaryawan: { unitBaris: [unit(1), unit(2), unit(3)], ringkasUnit: { total: 3 } } };

const barisOrder = (o) => ({ "ID Order": o.orderNumber, Pelanggan: o.customerName ?? "Pelanggan Contoh", "Sales Person": "Sales A", Kategori: "Baru", Layanan: "", Status: "Diproses", "Jenis Pekerjaan": "Order Baru", "Keluhan/Catatan": "", "Berat Badan": "", "Kota Pengiriman": "Depok", "Estimasi Kirim": "", "Merk/Model": "Sano", "Ukuran/Konfigurasi": "100 × 200 cm" });

test("3 kasur sejenis dalam 1 order → Jumlah Unit 3, produk digabung '3× …', rekap 3 baris (1 per unit, kode unit sendiri)", () => {
  assert.equal(jumlahUnitOrder(orderIndra), 3);
  assert.equal(produkRingkasOrder(orderIndra), "3× Kasur Sorong 3in1 custom (100 × 200 cm)");
  const baris = barisRekapUnit(orderIndra, barisOrder(orderIndra));
  assert.equal(baris.length, 3);
  assert.deepEqual(baris.map((b) => b.Unit), ["NEW-X-U1", "NEW-X-U2", "NEW-X-U3"]);
  assert.deepEqual(baris.map((b) => b["Unit ke"]), ["1 dari 3", "2 dari 3", "3 dari 3"]);
  assert.ok(baris.every((b) => b["ID Order"] === "NEW-X" && b["Sales Person"] === "Sales A" && b.Ukuran === "100 × 200 cm" && b["Status Order"] === "Diproses" && b["Status Produksi"] === "Menunggu produksi"));
});

test("rekap per unit: SETIAP order tampil — order multi-unit N baris, order biasa/tanpa unit 1 baris (Unit kosong, ukuran dari sheet Order); tanpa kolom uang", () => {
  const biasa = { orderNumber: "RES-1", customerName: "Lain", quantity: 1 };
  const rekap = semuaRekapUnit([orderIndra, biasa], [barisOrder(orderIndra), barisOrder(biasa)]);
  assert.equal(rekap.length, 4);
  assert.deepEqual(rekap.map((r) => r["ID Order"]), ["NEW-X", "NEW-X", "NEW-X", "RES-1"]);
  assert.equal(rekap[3].Unit, ""); assert.equal(rekap[3].Ukuran, "100 × 200 cm"); assert.equal(rekap[3]["Merk/Model"], "Sano");
  assert.ok(rekap.every((r) => JSON.stringify(Object.keys(r)) === JSON.stringify(KOLOM_REKAP_UNIT)));
  assert.ok(!KOLOM_REKAP_UNIT.some((k) => /Nilai|Harga|Ongkir|Pembayaran|Lunas/i.test(k)));
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
  assert.equal(barisRekapUnit({ orderNumber: "RES-1" }, {}).length, 1, "order tanpa unit tetap 1 baris rekap");
});

test("total unit = jumlah semua unit (bukan jumlah order)", () => {
  assert.equal(totalUnitOrders([orderIndra, { orderNumber: "RES-1", quantity: 1 }]), 4);
});

test("Orders.jsx & exportOrdersStyled.js memakai modul unit: kolom Jumlah Unit + sheet Rekap per Unit (ekspor berwarna DAN cadangan polos)", () => {
  const orders = fs.readFileSync(path.join(root, "src/pages/Orders.jsx"), "utf8");
  const styled = fs.readFileSync(path.join(root, "src/utils/exportOrdersStyled.js"), "utf8");
  assert.match(orders, /"Jumlah Unit": jumlahUnitOrder\(o\)/);
  assert.match(orders, /"Produk per Unit": produkRingkasOrder\(o\)/);
  assert.match(orders, /unit: sheetUnit/);
  assert.match(orders, /name: "Rekap per Unit", data: sheetUnit/);
  assert.ok(orders.includes("semuaRekapUnit(semuaOrder, sheetOrder)"));
  assert.match(styled, /addWorksheet\("Rekap per Unit"/);
  assert.match(styled, /buatSheetUnit\(wb, unit\)/);
});
