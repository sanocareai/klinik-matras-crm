// SKU baru langsung dari PO — logika layar (murni) dan pemasangan (API, tombol hanya Admin, pemilih Produksi tanpa Perlengkapan Stok).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  baris0, materialBaru0, galatMaterialBaru, bodyMaterialBaru, galatBaris, galatFormulir, bodyDariForm, formDariPO,
  teksSetara, qtyStok, infoKonversi, daftarBarangBaru, kalimatEvent, labelSatuan, PESAN_NON_STOK, JENIS_SKU_OPSI,
} from "../src/features/finance/purchaseOrderLogic.js";
import { adalahAdminKeuangan } from "../src/features/finance/matriksAksi.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

const BARU = (patch = {}) => ({
  ...materialBaru0(), nama: "Lem Semprot 500 ML", kategori: "Perekat", jenis: "BAHAN_PRODUKSI", satuanBeli: "BOX", satuanStok: "CAN", faktorKonversi: "12",
  kodeSupplier: "LS-500", moq: "2", estimasiKirimHari: "5", ...patch,
});
const FORM = (lines, patch = {}) => ({ supplierId: "s1", orderDate: "2026-10-09", expectedDate: "", notes: "", lines, ...patch });

test("galatMaterialBaru: wajib nama, kategori, jenis, satuan stok; faktor wajib bila satuan beli ≠ satuan stok; non-stok diarahkan ke Pengeluaran", () => {
  assert.equal(galatMaterialBaru(BARU()), null);
  assert.match(galatMaterialBaru(BARU({ nama: " " })), /Nama barang/);
  assert.match(galatMaterialBaru(BARU({ kategori: "" })), /Kategori/);
  assert.match(galatMaterialBaru(BARU({ jenis: "" })), /Pilih jenis/);
  assert.match(galatMaterialBaru(BARU({ satuanStok: "" })), /satuan stok/);
  assert.match(galatMaterialBaru(BARU({ faktorKonversi: "" })), /faktor konversi/i);
  assert.match(galatMaterialBaru(BARU({ faktorKonversi: "0" })), /faktor konversi/i);
  assert.match(galatMaterialBaru(BARU({ faktorKonversi: "1.23456" })), /4 angka/);
  assert.equal(galatMaterialBaru(BARU({ satuanBeli: "CAN", faktorKonversi: "" })), null, "satuan sama → faktor tidak diperlukan");
  assert.equal(galatMaterialBaru(BARU({ satuanBeli: "" , faktorKonversi: "" })), null, "satuan beli kosong = satuan stok");
  assert.match(galatMaterialBaru(BARU({ moq: "-1" })), /MOQ/);
  assert.match(galatMaterialBaru(BARU({ estimasiKirimHari: "400" })), /0–365/);
  assert.equal(galatMaterialBaru(BARU({ jenis: "JASA" })), PESAN_NON_STOK);
  assert.match(PESAN_NON_STOK, /Pengeluaran.*Pengajuan Biaya.*Tagihan Supplier/);
});

test("dua jenis barang dengan penjelasan Indonesia; Perlengkapan Stok dijelaskan hanya untuk Gudang", () => {
  assert.deepEqual(JENIS_SKU_OPSI.map((j) => j.label), ["Bahan Produksi", "Perlengkapan Stok"]);
  assert.match(JENIS_SKU_OPSI[1].hint, /Gudang/);
  assert.match(JENIS_SKU_OPSI[0].hint, /tidak otomatis masuk BOM/);
});

test("bodyMaterialBaru: angka bertipe angka, kosong dibuang, faktor hanya bila satuan beda, konfirmasi mirip hanya bila dicentang", () => {
  const b = bodyMaterialBaru(BARU());
  assert.deepEqual(b, { nama: "Lem Semprot 500 ML", kategori: "Perekat", jenis: "BAHAN_PRODUKSI", satuanStok: "CAN", satuanBeli: "BOX", faktorKonversi: 12, kodeSupplier: "LS-500", moq: 2, estimasiKirimHari: 5 });
  const sama = bodyMaterialBaru(BARU({ satuanBeli: "", faktorKonversi: "" }));
  assert.equal(sama.satuanBeli, "CAN");
  assert.equal("faktorKonversi" in sama, false);
  const mirip = bodyMaterialBaru(BARU({ konfirmasiMirip: true, alasanMirip: " beda ketebalan " }));
  assert.equal(mirip.konfirmasiMirip, true);
  assert.equal(mirip.alasanMirip, "beda ketebalan");
});

test("baris barang baru: valid tanpa materialId, ikut galat qty/harga, dan body memakai materialBaru", () => {
  const l = { ...baris0(), materialBaru: BARU(), qty: "2", unitPrice: "43290" };
  assert.equal(galatBaris(l), null);
  assert.match(galatBaris({ ...l, qty: "0" }), /lebih dari 0/);
  assert.match(galatBaris({ ...l, unitPrice: "10.5" }), /rupiah bulat/);
  assert.match(galatBaris({ ...l, materialBaru: BARU({ nama: "" }) }), /Nama barang/);
  const body = bodyDariForm(FORM([l]));
  assert.equal(body.lines[0].materialId, undefined);
  assert.equal(body.lines[0].materialBaru.nama, "Lem Semprot 500 ML");
  assert.equal(body.lines[0].qty, 2);
  assert.equal(body.lines[0].unitPrice, 43290);
  assert.equal(galatFormulir(FORM([l])), null);
  assert.match(galatFormulir(FORM([l, { ...l }])), /Baris 2.*sudah ada/, "dua barang baru bernama sama dalam satu PO ditolak");
  assert.deepEqual(daftarBarangBaru([baris0(), l]), [{ baris: 2, nama: "Lem Semprot 500 ML" }]);
});

test("konversi satuan: 2 BOX × 12 = 24 kaleng; presisi stok & harga per satuan stok diperiksa", () => {
  const l = { ...baris0(), materialBaru: BARU(), qty: "2", unitPrice: "43290" };
  assert.deepEqual(infoKonversi(l), { satuanBeli: "BOX", satuanStok: "CAN", faktor: 12 });
  assert.equal(qtyStok(l), 24);
  assert.equal(teksSetara(l), "Setara dengan 24 kaleng");
  assert.equal(teksSetara({ ...l, materialBaru: BARU({ satuanBeli: "CAN", faktorKonversi: "" }) }), null);
  // material yang ADA (unit stok dari katalog): satuan beli + faktor di baris
  const ada = { ...baris0(), materialId: "m1", qty: "5", unitPrice: "90000", satuanBeli: "BOX", faktorKonversi: "12.5" };
  assert.equal(galatBaris(ada, "KG"), null);
  assert.equal(teksSetara(ada, "KG"), "Setara dengan 62,5 kg");
  assert.match(galatBaris({ ...ada, faktorKonversi: "" }, "KG"), /faktor konversi/i);
  assert.match(galatBaris({ ...ada, faktorKonversi: "1.00001" }, "KG"), /4 angka/);
  assert.match(galatBaris({ ...ada, qty: "0.333", faktorKonversi: "12.5001" }, "KG"), /4 angka di belakang koma/);
  assert.match(galatBaris({ ...ada, unitPrice: "10", faktorKonversi: "100" }, "KG"), /Rp1/);
  assert.equal(galatBaris({ ...ada, satuanBeli: "", faktorKonversi: "" }, "KG"), null, "tanpa konversi = perilaku lama");
  assert.equal(labelSatuan("CAN"), "kaleng");
  assert.equal(labelSatuan("BOX"), "dus");
});

test("material yang ada: body hanya membawa konversi bila satuan beli & faktor terisi (perilaku lama tidak berubah)", () => {
  const polos = bodyDariForm(FORM([{ materialId: "m1", qty: "10", unitPrice: "43290" }]));
  assert.deepEqual(polos.lines[0], { materialId: "m1", qty: 10, unitPrice: 43290 });
  const konv = bodyDariForm(FORM([{ materialId: "m1", qty: "2", unitPrice: "43290", satuanBeli: "BOX", faktorKonversi: "12", kodeSupplier: "LS-500" }]));
  assert.deepEqual(konv.lines[0], { materialId: "m1", qty: 2, unitPrice: 43290, satuanBeli: "BOX", faktorKonversi: 12, kodeSupplier: "LS-500" });
});

test("formDariPO membawa konversi & info supplier saat draf diubah (SKU yang sudah jadi dikirim sebagai materialId, bukan materialBaru)", () => {
  const f = formDariPO({
    supplier: { id: "s1" }, orderDate: "2026-10-09T00:00:00.000Z", expectedDate: null, notes: null,
    lines: [{ materialId: "m9", dipesan: 2, hargaSatuan: 43290, konversi: { satuanBeli: "BOX", faktor: 12, satuanStok: "CAN" }, namaSupplier: "LEM SPRAY", kodeSupplier: "LS-500" }],
  });
  assert.deepEqual(f.lines[0], { materialId: "m9", qty: "2", unitPrice: "43290", satuanBeli: "BOX", faktorKonversi: "12", namaSupplier: "LEM SPRAY", kodeSupplier: "LS-500" });
  assert.equal(f.lines[0].materialBaru, undefined);
});

test("riwayat PO menyebut barang baru yang dibuat", () => {
  assert.equal(kalimatEvent({ type: "DIBUAT", metadata: { skuBaru: [{ kode: "LEM-001" }, { kode: "BUS-002" }] } }), "PO dibuat · 2 barang baru: LEM-001, BUS-002");
  assert.equal(kalimatEvent({ type: "DIBUAT", metadata: {} }), "PO dibuat");
});

test("hanya Admin (ADMIN/OWNER) yang melihat tombol Buat Barang Baru; Finance biasa melihat petunjuk", () => {
  assert.equal(adalahAdminKeuangan({ roles: ["ADMIN"] }), true);
  assert.equal(adalahAdminKeuangan({ roles: ["FINANCE"] }), false);
  const src = baca("../src/pages/finance/FinancePurchaseOrders.jsx");
  assert.match(src, /bolehBuatSku \? \([\s\S]{0,400}data-testid="tombol-barang-baru"/);
  assert.match(src, /Minta Admin Finance membuat barang baru dari PO/);
  assert.match(src, /Barang baru — akan dibuat saat PO disimpan/);
  assert.match(src, /api\.cekDuplikatSku/);
});

test("pemasangan: API SKU/katalog ada; pemilih bahan Produksi memakai untuk=produksi; Penerimaan Gudang menampilkan konversi", () => {
  const api = baca("../src/api.js");
  for (const fn of ["cekDuplikatSku", "getAsalSku", "perbaikiSku", "getKatalogSupplier"]) assert.match(api, new RegExp(`${fn}:`));
  assert.match(api, /purchase-orders\/sku\/cek-duplikat/);
  for (const p of ["../src/features/production/UnitV1Materials.jsx", "../src/features/production/workerApp/V1Panels.jsx", "../src/features/production/workerApp/workerSheets.jsx", "../src/pages/bengkel/ProductionMaterialUsage.jsx", "../src/pages/bengkel/ProductionRencanaWorkspace.jsx"]) {
    assert.match(baca(p), /getMaterials\(\{[^}]*untuk: "produksi"/, `${p} harus meminta bahan Produksi saja`);
  }
  assert.match(baca("../src/features/warehouse/components/GoodsReceiptDetailDrawer.jsx"), /data-testid="konversi-penerimaan"/);
  assert.match(baca("../src/features/warehouse/components/ItemDetailDrawer.jsx"), /data-testid="asal-sku-po"/);
});
