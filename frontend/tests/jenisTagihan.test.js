// B3.3 — Jenis Tagihan Supplier di layar: pilihan kategori per jenis dan isian yang dikirim ke server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JENIS_TAGIHAN, opsiKategori, bodyJenis, jenisLengkap } from "../src/features/finance/jenisTagihanLogika.js";

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
