// Kolom "Sales" di daftar Order & Excel = pihak yang dikreditkan laporan (salesKredit), bukan label lead — keputusan Owner 11 Okt 2026.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { namaSalesKredit, keteranganSalesKredit } from "../src/features/orders/salesKredit.js";

test("KASUS FADLAN/ERVINA: kolom menampilkan yang dikreditkan (Ervina), bukan label lead (Fadlan)", () => {
  const o = { assignedSales: { name: "Fadlan" }, salesKredit: { id: "e", name: "Ervina", sumber: "PEMILIK_ORDER" } };
  assert.equal(namaSalesKredit(o), "Ervina");
  assert.match(keteranganSalesKredit(o), /Dikreditkan ke laporan: Ervina \(pemilik order tercatat\)/);
  assert.match(keteranganSalesKredit(o), /label pemilik lead: Fadlan/);
});

test("kredit mengikuti pemegang chat; label lead sama → tidak ada peringatan tambahan", () => {
  const o = { assignedSales: { name: "Kiki" }, salesKredit: { name: "Kiki", sumber: "PEMEGANG_PERCAKAPAN" } };
  assert.equal(namaSalesKredit(o), "Kiki");
  assert.equal(keteranganSalesKredit(o), "Dikreditkan ke laporan: Kiki (mengikuti pemegang chat sekarang)");
});

test("tanpa kredit: kosong (bukan label lead); Penjualan Karyawan dijelaskan", () => {
  assert.equal(namaSalesKredit({ assignedSales: { name: "Fadlan" }, salesKredit: null }), "");
  assert.match(keteranganSalesKredit({ salesKredit: null, staffSellerId: "x" }), /Penjualan Karyawan/);
  assert.match(keteranganSalesKredit({ salesKredit: null }), /Belum ada kredit Sales/);
});

test("payload lama tanpa salesKredit jatuh ke label lead (kompatibel)", () => {
  assert.equal(namaSalesKredit({ assignedSales: { name: "Risel" } }), "Risel");
  assert.equal(keteranganSalesKredit({ assignedSales: { name: "Risel" } }), "");
  assert.equal(namaSalesKredit(null), "");
});

test("PEMASANGAN: daftar Order, urutan, dan Excel (2 sheet) memakai namaSalesKredit — tidak ada lagi assignedSales?.name di kolom Sales", () => {
  const s = fs.readFileSync(new URL("../src/pages/Orders.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal((s.match(/"Sales Person": namaSalesKredit\(o\)/g) || []).length, 2);
  assert.match(s, /assignedSales:\(o\) => namaSalesKredit\(o\)/);
  assert.doesNotMatch(s, /"Sales Person": o\.assignedSales\?\.name/);
  assert.doesNotMatch(s, /\{o\.assignedSales\?\.name \|\| "—"\}/);
});
