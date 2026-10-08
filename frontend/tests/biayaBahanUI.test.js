// Jejak biaya bahan per unit — logika tampilan (nilai kosong ≠ Rp0) dan pemasangan (rute, menu, Unit 360, API).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { teksRupiah, selNilai, kartuTotal, teksQty, teksSumber, STATUS_BIAYA } from "../src/features/finance/biayaBahanLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

test("teksRupiah: null/undefined tidak pernah menjadi Rp0; retur bertanda minus; desimal hanya bila perlu", () => {
  assert.equal(teksRupiah(null), null);
  assert.equal(teksRupiah(undefined), null);
  assert.equal(teksRupiah(0), "Rp0", "nol sungguhan boleh tampil, null tidak");
  assert.equal(teksRupiah(129870), "Rp129.870");
  assert.equal(teksRupiah(-91948), "−Rp91.948");
  assert.equal(teksRupiah(1234.5), "Rp1.234,50");
  assert.equal(teksRupiah(3408, { tanda: true }), "+Rp3.408");
});

test("selNilai: DINILAI = angka pasti; TANPA_HARGA = 'Belum bisa dihitung' (estimasi hanya keterangan); ESTIMASI_HISTORIS = bukan pasti; tanpa izin harga = tanpa nominal", () => {
  const dinilai = selNilai({ status: "DINILAI", nilai: 129870 }, true);
  assert.deepEqual([dinilai.teks, dinilai.pasti], ["+Rp129.870", true]);
  const tanpa = selNilai({ status: "TANPA_HARGA", nilai: null, estimasi: 80000 }, true);
  assert.equal(tanpa.teks, "Belum bisa dihitung");
  assert.equal(tanpa.pasti, false);
  assert.match(tanpa.ket, /bukan biaya pasti/);
  assert.doesNotMatch(tanpa.teks, /Rp/);
  const hist = selNilai({ status: "ESTIMASI_HISTORIS", nilai: null, estimasi: 80000 }, true);
  assert.equal(hist.pasti, false);
  assert.match(hist.ket, /sebelum nilai dibekukan/);
  const tanpaIzin = selNilai({ status: "DINILAI", nilai: 129870 }, false);
  assert.equal(tanpaIzin.teks, "Harga disembunyikan");
  assert.doesNotMatch(JSON.stringify(tanpaIzin), /129/);
  assert.equal(selNilai({ status: "TANPA_HARGA" }, false).teks, "Tanpa harga");
});

test("kartuTotal: tanpa nilai pasti → kata jujur; sebagian → peringatan; final → angka", () => {
  const kosong = kartuTotal({ biayaPersediaan: { nilai: null } }, "BELUM_ADA_PEMAKAIAN");
  assert.equal(kosong.nilai, "Belum ada pemakaian");
  const tanpaHarga = kartuTotal({ biayaPersediaan: { nilai: null } }, "BELUM_FINAL");
  assert.equal(tanpaHarga.nilai, "Belum bisa dihitung");
  assert.equal(tanpaHarga.pasti, false);
  const sebagian = kartuTotal({ biayaPersediaan: { nilai: 287792, lengkap: false } }, "BELUM_FINAL");
  assert.equal(sebagian.nilai, "Rp287.792");
  assert.match(sebagian.sub, /SEBAGIAN/);
  assert.equal(sebagian.pasti, false);
  const final = kartuTotal({ biayaPersediaan: { nilai: 216450, lengkap: true } }, "FINAL_MENURUT_HARGA_PO");
  assert.equal(final.pasti, true);
  assert.deepEqual(Object.keys(STATUS_BIAYA), ["FINAL_MENURUT_HARGA_PO", "BELUM_FINAL", "BELUM_ADA_PEMAKAIAN"]);
});

test("teksQty & teksSumber: kuantitas 4 desimal; sumber lot menyebut PO/penerimaan, harga hanya bila izin", () => {
  assert.equal(teksQty(0.125), "0,125");
  assert.equal(teksQty(null), "—");
  const s = { poNumber: "PO-08102026-001", receiptNumber: "GR-081026-01", qty: 6, unitCost: 43290 };
  assert.equal(teksSumber(s, true), "PO-08102026-001 · GR-081026-01 · 6 × Rp43.290");
  assert.equal(teksSumber(s, false), "PO-08102026-001 · GR-081026-01 · 6");
  assert.equal(teksSumber({ qty: 5, unitCost: 20000 }, true), "tanpa PO · 5 × Rp20.000");
});

test("pemasangan: rute Finance, menu, API, dan Unit 360 tab Bahan memakai komponen yang sama", () => {
  assert.match(baca("../src/routes/pageRegistry.jsx"), /path: "\/finance\/biaya-bahan", render: \(\) => <FinanceBiayaBahan \/>/);
  assert.ok(baca("../src/components/Layout.jsx").includes('to: "/finance/biaya-bahan", label: "Biaya Bahan per Unit"'));
  const api = baca("../src/api.js");
  for (const fn of ["getBiayaBahanUnits", "getBiayaBahanUnit", "getJejakBahanUnit"]) assert.ok(api.includes(`${fn}:`), fn);
  assert.ok(api.includes("/units/${unitId}/jejak-bahan"));
  const u = baca("../src/features/production/UnitOverviewDrawer.jsx");
  assert.ok(u.includes('<JejakBiayaBahan unitId={data.identity.unitId} sumber="unit" />'));
  assert.ok(u.includes('data-testid="unit360-jejak-bahan"'));
  assert.ok(u.includes('data-testid="unit360-jejak-bahan-fallback"'), "unit di luar V2 juga menampilkan jejak biaya");
});

test("komponen: tanpa tombol aksi tulis; menjelaskan stok hanya via Material Issue; menandai belum final & catatan PIC bukan stok", () => {
  const k = baca("../src/features/finance/JejakBiayaBahan.jsx");
  assert.doesNotMatch(k, /api\.(create|update|post|approve|cancel|delete|receive|issue)/i);
  assert.ok(k.includes("Stok keluar hanya lewat Material Issue Gudang"));
  assert.ok(k.includes("bukan stok/jurnal"));
  assert.ok(k.includes('data-testid="belum-final"'));
  assert.ok(k.includes("Nominal harga tidak ditampilkan untuk peran Anda"));
  const h = baca("../src/pages/finance/FinanceBiayaBahan.jsx");
  assert.ok(h.includes("angka kosong bukan Rp0"));
  assert.doesNotMatch(h, /<Button[^>]*>(Simpan|Setujui|Posting)/);
});

// ── Bahasa UI Gudang: kata "Putaway" tidak boleh muncul sebagai teks yang dilihat pengguna (nama internal route/fungsi boleh tetap) ──
test("UI Gudang/Finance memakai 'Simpan ke Stok', bukan 'Putaway', pada label, tombol, dan teks bantuan", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8");
  const real = baca("features/warehouse/inventoryReal.js");
  assert.match(real, /READY_FOR_PUTAWAY:\s*\{ label: "Siap Disimpan"/);
  assert.match(real, /COMPLETED:\s*\{ label: "Sudah Masuk Stok"/);
  const drawer = baca("features/warehouse/components/GoodsReceiptDetailDrawer.jsx");
  assert.match(drawer, /Simpan ke Stok<\/|Simpan ke Stok\s*$/m);
  assert.match(drawer, /Hanya barang yang dinyatakan baik yang masuk ke stok\. Tindakan ini menambah persediaan dan membuat jurnal penerimaan secara otomatis\./);
  // teks JSX/literal yang tampil (bukan komentar //, bukan identifier): tidak ada "Putaway" / "Siap Ditempatkan"
  for (const f of ["features/warehouse/inventoryReal.js", "features/warehouse/components/GoodsReceiptDetailDrawer.jsx", "pages/warehouse/WarehouseGoodsReceipt.jsx", "pages/warehouse/WarehouseDashboard.jsx", "features/finance/purchaseOrderLogic.js", "pages/finance/FinancePurchaseOrders.jsx"]) {
    const tampil = baca(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(tampil.replace(/READY_FOR_PUTAWAY/g, "").replace(/putawayGoodsReceipt|async function putaway|onClick=\{putaway\}/g, ""), /Putaway|Ready for Putaway|Siap Ditempatkan|Konfirmasi Putaway/, `${f}: istilah lama masih tampil`);
  }
});
