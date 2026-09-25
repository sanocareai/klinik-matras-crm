// B3.3 — Jenis Tagihan Supplier di layar: pilihan kategori per jenis dan isian yang dikirim ke server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JENIS_TAGIHAN, opsiKategori, bodyJenis, jenisLengkap, metodeUntukTanggal, bahanBakuButuhPenerimaan, CATATAN_PERIODIK, tanggalIndonesia,
} from "../src/features/finance/jenisTagihanLogika.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

const kategori = [
  { id: "a", code: "PERLENGKAPAN", account: { type: "BEBAN", code: "6-1600" } },
  { id: "b", code: "OVERHEAD_PRODUKSI", account: { type: "BEBAN_POKOK", code: "5-1300" } },
  { id: "c", code: "BAHAN_BAKU_MANUAL", account: { type: "BEBAN_POKOK", code: "5-1150" } },
];
const kategoriBeli = [
  { id: "p1", code: "ASET_PERALATAN" }, { id: "p2", code: "ASET_KENDARAAN" }, { id: "p3", code: "UANG_MUKA_PEMBELIAN" }, { id: "p4", code: "BAHAN_BAKU_MANUAL" },
];

test("Lima jenis tagihan tersedia dengan label Bahasa Indonesia", () => {
  assert.deepEqual(JENIS_TAGIHAN.map((j) => j.kode), ["BAHAN_BAKU", "JASA_OPERASIONAL", "BIAYA_PRODUKSI_NON_STOK", "MESIN_PERALATAN", "UANG_MUKA_PEMBELIAN"]);
  for (const j of JENIS_TAGIHAN) assert.ok(j.label && j.ket.length > 20);
});

test("Kategori per jenis: bahan baku manual tidak pernah ditawarkan sebagai beban", () => {
  assert.deepEqual(opsiKategori("JASA_OPERASIONAL", { kategori }).map((k) => k.id), ["a"]);
  assert.deepEqual(opsiKategori("BIAYA_PRODUKSI_NON_STOK", { kategori }).map((k) => k.id), ["b"]);
  assert.deepEqual(opsiKategori("MESIN_PERALATAN", { kategoriBeli }).map((k) => k.id), ["p1", "p2"]);
  assert.deepEqual(opsiKategori("UANG_MUKA_PEMBELIAN", { kategoriBeli }).map((k) => k.id), ["p3"]);
  assert.deepEqual(opsiKategori("BAHAN_BAKU", { kategori, kategoriBeli }), []);
});

test("Isian yang dikirim bersih per jenis; kelengkapan", () => {
  assert.deepEqual(bodyJenis({ billType: "BAHAN_BAKU", goodsReceiptId: "g", expenseCategoryId: "a", purchaseCategoryId: "p1" }),
    { billType: "BAHAN_BAKU", goodsReceiptId: "g", expenseCategoryId: null, purchaseCategoryId: null });
  assert.deepEqual(bodyJenis({ billType: "MESIN_PERALATAN", goodsReceiptId: "g", purchaseCategoryId: "p1" }),
    { billType: "MESIN_PERALATAN", goodsReceiptId: null, expenseCategoryId: null, purchaseCategoryId: "p1" });
  assert.ok(jenisLengkap({ billType: "BAHAN_BAKU" }));
  assert.ok(!jenisLengkap({ billType: "JASA_OPERASIONAL" }));
  assert.ok(!jenisLengkap({ billType: "" }));
});

test("Form tagihan memakai pilihan jenis; Setujui nonaktif untuk tagihan lama tanpa jenis", () => {
  const s = baca("pages/finance/FinanceSuppliers.jsx");
  assert.match(s, /<PilihJenisTagihan/);
  assert.match(s, /disabled: !b\.billType/);
  assert.match(s, /Pilih Jenis Tagihan dulu/);
  const k = baca("features/finance/JenisTagihan.jsx");
  for (const t of ["Nilai diterima", "Nilai ditagih", "Selisih", "Dokumen", "Supplier (penerimaan)"]) assert.ok(k.includes(t), t);
});

// ── B3.5 — metode persediaan periodik sementara & cutover ──────────────────────────────────────────────────────────────

const info = { sebelumCutover: "PERIODIK", cutover: "2026-10-01", sesudahCutover: "PERPETUAL" };

test("Metode per tanggal tagihan: periodik s.d. 30 Sep 2026, perpetual mulai 1 Okt 2026 (cutover kosong = periodik terus)", () => {
  assert.equal(metodeUntukTanggal(info, "2026-09-30"), "PERIODIK");
  assert.equal(metodeUntukTanggal(info, "2026-10-01"), "PERPETUAL");
  assert.equal(metodeUntukTanggal(info, "2026-12-31"), "PERPETUAL");
  assert.equal(metodeUntukTanggal({ sebelumCutover: "PERIODIK", cutover: null }, "2030-01-01"), "PERIODIK");
  assert.equal(metodeUntukTanggal(null, "2026-10-01"), null, "info belum dimuat → server yang menegakkan");
  assert.equal(tanggalIndonesia("2026-10-01"), "1 Okt 2026");
});

test("Bahan baku tanpa penerimaan setelah cutover tidak bisa disimpan; dengan penerimaan tetap boleh; sebelum cutover boleh", () => {
  const dasar = { billType: "BAHAN_BAKU" };
  assert.ok(jenisLengkap({ ...dasar, billDate: "2026-09-30" }, info));
  assert.ok(!jenisLengkap({ ...dasar, billDate: "2026-10-01" }, info));
  assert.ok(bahanBakuButuhPenerimaan({ ...dasar, billDate: "2026-10-05" }, info));
  assert.ok(jenisLengkap({ ...dasar, billDate: "2026-10-05", goodsReceiptId: "gr1" }, info));
  assert.ok(!bahanBakuButuhPenerimaan({ billType: "JASA_OPERASIONAL", billDate: "2026-10-05" }, info));
  assert.ok(jenisLengkap({ ...dasar, billDate: "2026-10-05" }, null), "tanpa info kebijakan jangan memblokir di layar");
});

test("UI menjelaskan metode periodik & perpetual dalam Bahasa Indonesia", () => {
  assert.equal(CATATAN_PERIODIK, "Metode periodik — nilai persediaan akhir ditentukan melalui stok opname.");
  const k = baca("features/finance/JenisTagihan.jsx");
  assert.match(k, /CATATAN_PERIODIK/);
  assert.match(k, /data-testid="catatan-periodik"/);
  assert.match(k, /data-testid="catatan-perpetual"/);
  assert.match(k, /Dr Beban Pokok Bahan Baku \(5-1100\) \/ Cr Utang Usaha/);
  assert.match(k, /metode perpetual/);
  const p = baca("pages/finance/FinanceSuppliers.jsx");
  assert.match(p, /getFinanceInventoryMethod/);
  assert.match(p, /jenisLengkap\(f, metodeInfo\)/);
  assert.match(p, /metodeInfo=\{metodeInfo\}/);
});
