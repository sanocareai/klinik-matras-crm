// Kolom "Harga & HPP" di daftar Order Produksi (keputusan Owner 14 Nov 2026: dilihat semua tim). Tidak pernah Rp0 palsu.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ringkasHarga } from "../src/features/production/orderProduksiModel.js";

const baris = (nilai, extra = {}) => ({ adopsi: { nilai }, ...extra });

test("harga jual + HPP lengkap", () => {
  const h = ringkasHarga(baris({ jual: 7500000, unitDalamOrder: 1, hpp: { total: 60000, status: "LENGKAP_MENURUT_HARGA_BERLAKU", tanpaHarga: 0 } }));
  assert.equal(h.jual.teks, "Rp7.500.000"); assert.equal(h.jual.ket, null);
  assert.equal(h.hpp.teks, "HPP Rp60.000"); assert.equal(h.hpp.kosong, false);
});

test("order beberapa unit: harga diberi keterangan; HPP sebagian ditandai", () => {
  const h = ringkasHarga(baris({ jual: 3000000, unitDalamOrder: 2, hpp: { total: 40000, status: "PARSIAL", tanpaHarga: 2 } }));
  assert.equal(h.jual.ket, "untuk 2 unit");
  assert.equal(h.hpp.teks, "HPP Rp40.000"); assert.equal(h.hpp.ket, "sebagian · 2 tanpa harga");
});

test("tanpa pemakaian / tanpa harga / tanpa nilai order: tidak ada Rp0", () => {
  const a = ringkasHarga(baris({ jual: 0, unitDalamOrder: 1, hpp: { total: 0, status: "BELUM_ADA_PEMAKAIAN", tanpaHarga: 0 } }));
  assert.equal(a.jual.teks, "Belum ada harga"); assert.equal(a.hpp.teks, "HPP belum ada");
  const b = ringkasHarga(baris({ jual: 100, unitDalamOrder: 1, hpp: { total: 0, status: "PARSIAL", tanpaHarga: 3 } }));
  assert.equal(b.hpp.teks, "HPP belum berharga"); assert.equal(b.hpp.ket, "3 pemakaian tanpa harga");
  const pkr = ringkasHarga(baris({ jual: 0, unitDalamOrder: 1, hpp: null }, { penjualanKaryawan: { nomor: "PKR-1" } }));
  assert.equal(pkr.jual.teks, "Penjualan karyawan");
  for (const x of [a, b, pkr]) assert.ok(![x.jual.teks, x.hpp.teks].some((t) => /Rp0\b/.test(t)));
  assert.equal(ringkasHarga({ adopsi: {} }), null, "server lama tanpa data harga → kolom kosong (—), bukan angka");
});

test("daftar desktop & kartu HP memuat kolom Harga & HPP", () => {
  const src = fs.readFileSync(new URL("../src/pages/bengkel/ProductionWorkOrders.jsx", import.meta.url), "utf8");
  assert.ok(src.includes('<span role="columnheader" className="prod-ol-kol-harga">Harga &amp; HPP</span>'));
  assert.equal((src.match(/<HargaSel u=\{u\} \/>/g) || []).length, 3, "baris desktop (kolom + tumpukan saat panel profil terbuka) + kartu HP");
});
