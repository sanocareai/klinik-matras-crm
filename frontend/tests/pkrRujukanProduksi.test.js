// Rujukan Penjualan Karyawan di daftar Produksi: model tampilan murni + pemasangan di semua daftar/detail Produksi (tanpa bergantung flag V2).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rujukanDariRingkas, tampilRujukanPkr } from "../src/features/production/pkrRujukanModel.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

test("tampilan rujukan: badge, nomor PKR, nama karyawan, Dikirim/Ambil sendiri, dan 'Perlu dilengkapi' + data yang kurang; order biasa = tidak ada rujukan", () => {
  assert.equal(tampilRujukanPkr(null), null);
  assert.equal(tampilRujukanPkr({}), null);
  const belum = tampilRujukanPkr({ nomor: "PKR-05102026-001", karyawan: "Emon Produksi", perluDikirim: null, kirimLabel: "Belum ditentukan", lengkap: false, kurang: ["Merk kasur", "Ukuran"] });
  assert.deepEqual(belum, { badge: "Penjualan Karyawan", nomor: "PKR-05102026-001", karyawan: "Emon Produksi", kirim: "Belum ditentukan", perluDilengkapi: true, kurangTeks: "Merk kasur, Ukuran", ringkas: "PKR-05102026-001 · Emon Produksi" });
  const kirim = tampilRujukanPkr({ nomor: "PKR-1", karyawan: "A", perluDikirim: true, lengkap: true, kurang: [] });
  assert.equal(kirim.kirim, "Dikirim"); assert.equal(kirim.perluDilengkapi, false); assert.equal(kirim.kurangTeks, "");
  assert.equal(tampilRujukanPkr({ nomor: "PKR-2", perluDikirim: false, lengkap: true, kurang: [] }).kirim, "Ambil sendiri");
});

test("adaptor dari ringkasan Finance/CRM (daftar Order Produksi) ke bentuk rujukan Produksi", () => {
  assert.equal(rujukanDariRingkas(null), null);
  const r = rujukanDariRingkas({ penjualanId: "x", nomor: "PKR-9", penjual: { id: "u", name: "Rani" }, pembeli: "Bu Dewi", order: { spesifikasi: { lengkap: false, kurang: ["Ukuran"], perluDikirim: false } } });
  assert.deepEqual(r, { penjualanId: "x", nomor: "PKR-9", karyawan: "Rani", pembeli: "Bu Dewi", perluDikirim: false, kirimLabel: "Ambil sendiri", lengkap: false, kurang: ["Ukuran"] });
  assert.equal(rujukanDariRingkas({ nomor: "PKR-8", penjual: { name: "Z" }, order: null }).lengkap, false, "belum ada order = belum lengkap");
});

test("pemasangan: kartu backlog, kartu rencana, kartu akan-masuk, kartu V1, Order Produksi, Unit 360 V2 dan non-V2 memakai komponen yang SAMA", () => {
  const komp = baca("../src/features/production/PkrRujukan.jsx");
  for (const t of ["pkr-badge", "pkr-nomor", "pkr-karyawan", "pkr-kirim", "pkr-perlu-dilengkapi", "pkr-kurang"]) assert.ok(komp.includes(`data-testid="${t}"`), t);
  assert.match(komp, /Penjualan Karyawan|t\.badge/);
  assert.match(baca("../src/features/production/BacklogCard.jsx"), /<PkrRujukan pkr=\{c\.penjualanKaryawan\} \/>/);
  assert.match(baca("../src/features/production/PlanCard.jsx"), /<PkrRujukan pkr=\{view\.penjualanKaryawan\}/);
  assert.match(baca("../src/features/production/UnitCard.jsx"), /<PkrRujukan pkr=\{item\.penjualanKaryawan\} \/>/);
  assert.match(baca("../src/features/production/v1Source.jsx"), /<PkrRujukan pkr=\{unit\.penjualanKaryawan\} \/>/);
  assert.match(baca("../src/pages/bengkel/ProductionOrders.jsx"), /rujukanDariRingkas\(o\.penjualanKaryawan\)/);
  assert.equal((baca("../src/pages/bengkel/ProductionWorkOrders.jsx").match(/<PkrRujukan pkr=\{u\.penjualanKaryawan\}/g) || []).length, 2, "tabel Order Produksi + kartu mobile");
  assert.match(baca("../src/pages/bengkel/ProductionPlannerV2.jsx"), /<PkrRujukan pkr=\{u\.penjualanKaryawan\}/);
  assert.match(baca("../src/features/production/UnitOverviewDrawer.jsx"), /<PkrRujukan pkr=\{data\.identity\.penjualanKaryawan\} rinci \/>/);
  assert.match(baca("../src/features/production/UnitOrderFallback.jsx"), /<PkrRujukan pkr=\{data\.penjualanKaryawan\} rinci \/>/);
});

test("Order Produksi: nominal dan status bayar order PKR dibaca dari Finance, bukan dari kolom order", () => {
  const s = baca("../src/pages/bengkel/ProductionOrders.jsx");
  assert.match(s, /di Finance/);
  assert.match(s, /o\.penjualanKaryawan\.pembayaran\?\.label/);
});
