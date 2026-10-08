// Purchase Order bahan baku — logika layar (murni) dan pemasangan (rute, menu, API, penanda sumber di Gudang).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATUS_PO, TAB_PO, baris0, teksJumlah, subtotal, totalIsian, galatBaris, galatFormulir, formDariPO, bodyDariForm,
  ringkasProgres, nilaiBelumDiterima, aksiPO, kalimatEvent,
} from "../src/features/finance/purchaseOrderLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

const FORM = (patch = {}) => ({ supplierId: "s1", orderDate: "2026-10-08", expectedDate: "", notes: "", lines: [{ materialId: "m1", qty: "10", unitPrice: "43290" }], ...patch });

test("status & tab memakai istilah Indonesia dan mencakup kelima status PO", () => {
  assert.deepEqual(Object.keys(STATUS_PO), ["DRAFT", "DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI", "DIBATALKAN"]);
  assert.deepEqual(Object.values(STATUS_PO).map((s) => s.label), ["Draf", "Disetujui", "Diterima Sebagian", "Selesai", "Dibatalkan"]);
  assert.ok(TAB_PO.some((t) => t.key === "DISETUJUI,DITERIMA_SEBAGIAN" && t.label === "Berjalan"));
});

test("galatBaris & galatFormulir: aturan sama dengan server", () => {
  assert.equal(galatBaris({ materialId: "m", qty: "10", unitPrice: "43290" }), null);
  assert.match(galatBaris({ materialId: "", qty: "1", unitPrice: "1" }), /Pilih item/);
  assert.match(galatBaris({ materialId: "m", qty: "0", unitPrice: "1" }), /lebih dari 0/);
  assert.match(galatBaris({ materialId: "m", qty: "1.2345", unitPrice: "1" }), /3 angka/);
  assert.match(galatBaris({ materialId: "m", qty: "1", unitPrice: "100.5" }), /rupiah bulat/);
  assert.match(galatBaris({ materialId: "m", qty: "1", unitPrice: "0" }), /rupiah bulat/);

  assert.equal(galatFormulir(FORM()), null);
  assert.match(galatFormulir(FORM({ supplierId: "" })), /supplier/i);
  assert.match(galatFormulir(FORM({ orderDate: "" })), /tanggal PO/);
  assert.match(galatFormulir(FORM({ expectedDate: "2026-10-01" })), /Estimasi/);
  assert.match(galatFormulir(FORM({ lines: [] })), /minimal satu item/);
  const ganda = FORM({ lines: [{ materialId: "m1", qty: "1", unitPrice: "1" }, { materialId: "m1", qty: "2", unitPrice: "1" }] });
  assert.match(galatFormulir(ganda), /Baris 2.*sudah ada/);
  assert.match(galatFormulir(FORM({ lines: [baris0()] })), /Baris 1: Pilih item/);
});

test("subtotal & total isian; body ke server bertipe angka", () => {
  assert.equal(subtotal({ qty: "8", unitPrice: "43290" }), 346320);
  assert.equal(subtotal({ qty: "", unitPrice: "5" }), 0);
  assert.equal(totalIsian([{ qty: "8", unitPrice: "43290" }, { qty: "2", unitPrice: "1000" }]), 348320);
  const b = bodyDariForm(FORM({ expectedDate: "2026-10-12", notes: " lem " }));
  assert.deepEqual(b, { supplierId: "s1", orderDate: "2026-10-08", expectedDate: "2026-10-12", notes: "lem", lines: [{ materialId: "m1", qty: 10, unitPrice: 43290 }] });
  assert.equal(bodyDariForm(FORM()).expectedDate, null);
});

test("formDariPO: mengisi ulang formulir dari PO draf", () => {
  const f = formDariPO({ supplier: { id: "s1" }, orderDate: "2026-10-08T00:00:00.000Z", expectedDate: null, notes: null, lines: [{ materialId: "m1", dipesan: 10, hargaSatuan: 43290 }] });
  assert.deepEqual(f, { supplierId: "s1", orderDate: "2026-10-08", expectedDate: "", notes: "", lines: [{ materialId: "m1", qty: "10", unitPrice: "43290" }] });
});

test("ringkasProgres: satu satuan dijumlah; beda satuan dihitung per baris; diterima tidak melebihi dipesan", () => {
  const po = { lines: [{ satuan: "KG", dipesan: 10, diterimaBaik: 8, belumDiterima: 2 }] };
  assert.deepEqual(ringkasProgres(po), { teks: "8 / 10 KG", persen: 80 });
  const campur = { lines: [{ satuan: "KG", dipesan: 4, diterimaBaik: 4, belumDiterima: 0 }, { satuan: "SHEET", dipesan: 6, diterimaBaik: 0, belumDiterima: 6 }] };
  assert.equal(ringkasProgres(campur).teks, "1/2 baris terpenuhi");
  assert.equal(ringkasProgres(campur).persen, 50);
  assert.equal(ringkasProgres({ lines: [{ satuan: "KG", dipesan: 10, diterimaBaik: 12, belumDiterima: 0 }] }).persen, 100);
});

test("nilaiBelumDiterima hanya untuk PO berjalan", () => {
  const l = [{ belumDiterima: 2, hargaSatuan: 43290 }];
  assert.equal(nilaiBelumDiterima({ status: "DITERIMA_SEBAGIAN", lines: l }), 86580);
  assert.equal(nilaiBelumDiterima({ status: "DRAFT", lines: l }), 0);
  assert.equal(nilaiBelumDiterima({ status: "SELESAI", lines: l }), 0);
});

test("aksiPO: draf bisa diubah/disetujui; disetujui bisa direvisi/dibatalkan; sebagian hanya revisi; selesai & batal tanpa aksi", () => {
  assert.deepEqual(aksiPO({ status: "DRAFT" }), { ubah: true, setujui: true, batalkan: true, revisi: false });
  assert.deepEqual(aksiPO({ status: "DISETUJUI" }), { ubah: false, setujui: false, batalkan: true, revisi: true });
  assert.deepEqual(aksiPO({ status: "DITERIMA_SEBAGIAN" }), { ubah: false, setujui: false, batalkan: false, revisi: true });
  for (const s of ["SELESAI", "DIBATALKAN"]) assert.deepEqual(aksiPO({ status: s }), { ubah: false, setujui: false, batalkan: false, revisi: false });
});

test("kalimatEvent & teksJumlah", () => {
  assert.equal(kalimatEvent({ type: "REVISI_JUMLAH", note: "supplier kurang stok", metadata: { sebelum: 10, sesudah: 8 } }), "Jumlah direvisi 10 → 8 — supplier kurang stok");
  assert.equal(kalimatEvent({ type: "STATUS_BERUBAH", metadata: { dari: "DISETUJUI", ke: "DITERIMA_SEBAGIAN" } }), "Status Disetujui → Diterima Sebagian");
  assert.equal(kalimatEvent({ type: "DISETUJUI" }), "PO disetujui");
  assert.equal(teksJumlah(8), "8");
  assert.equal(teksJumlah(2.5), "2,5");
  assert.equal(teksJumlah(null), "0");
  assert.equal(teksJumlah(undefined), "—");
});

test("pemasangan: rute, menu Finance, dan fungsi API Purchase Order terdaftar", () => {
  const reg = baca("../src/routes/pageRegistry.jsx");
  assert.match(reg, /const FinancePurchaseOrders = lazy\(\(\) => import\("\.\.\/pages\/finance\/FinancePurchaseOrders\.jsx"\)\)/);
  assert.match(reg, /path: "\/finance\/purchase-orders", render: \(\) => <FinancePurchaseOrders \/>/);
  assert.match(baca("../src/components/Layout.jsx"), /to: "\/finance\/purchase-orders", label: "Purchase Order"/);
  const api = baca("../src/api.js");
  for (const fn of ["getPurchaseOrders", "getPurchaseOrder", "createPurchaseOrder", "updatePurchaseOrder", "approvePurchaseOrder", "cancelPurchaseOrder", "revisiJumlahPurchaseOrder", "getGudangPurchaseOrders"]) {
    assert.match(api, new RegExp(`${fn}:`), fn);
  }
  assert.match(api, /createPurchaseOrder: \(data, idempotencyKey = mutationKey\("po"\)\) =>/);
  assert.match(api, /\/inventory\/purchase-orders/);
});

test("halaman Finance: tidak ada tindakan stok/jurnal, dan menjelaskan bahwa PO tidak mengubah stok", () => {
  const h = baca("../src/pages/finance/FinancePurchaseOrders.jsx");
  assert.match(h, /tidak mengubah stok dan tidak membuat jurnal/);
  assert.match(h, /Tanpa PO/);
  // Peringatan galat berada di footer dialog (selalu terlihat), bukan di badan yang bisa di-scroll.
  const mulai = h.indexOf("footer={", h.indexOf("function ModalPO("));
  assert.match(h.slice(mulai, mulai + 400), /galat-po/);
  // Dialog formulir di-mount ulang per pembukaan (key) supaya isian lama tidak tertinggal.
  assert.match(h, /<ModalPO\s+key=\{form\.kunci\}/);
  // Kunci idempotensi dipegang per sesi dialog.
  assert.match(h, /createPurchaseOrder\(body, `po-\$\{kunci\}`\)/);
});

test("Gudang: formulir Penerimaan Baru memilih PO, tanpa harga; daftar & detail menandai sumber (Dari PO / Tanpa PO)", () => {
  const m = baca("../src/features/warehouse/components/GoodsReceiptFormModal.jsx");
  assert.match(m, /Dari Purchase Order/);
  assert.match(m, /getGudangPurchaseOrders/);
  assert.match(m, /purchaseOrderLineId: l\.id, orderedQty/);
  assert.doesNotMatch(m, /hargaSatuan|unitPrice|formatUang|Rp\b/, "Gudang tidak menampilkan harga");
  assert.match(m, /peringatan-tanpa-po/);
  const sumber = baca("../src/features/warehouse/components/SumberPO.jsx");
  assert.match(sumber, /Dari PO/);
  assert.match(sumber, /Tanpa PO/);
  assert.match(baca("../src/pages/warehouse/WarehouseGoodsReceipt.jsx"), /<SumberPO receipt=\{r\} \/>/);
  const d = baca("../src/features/warehouse/components/GoodsReceiptDetailDrawer.jsx");
  assert.match(d, /data-testid="sumber-po"/);
  assert.match(d, /data-testid="sumber-tanpa-po"/);
  assert.match(d, /progres-po-baris/);
  assert.doesNotMatch(d, /hargaSatuan|unitPrice|formatUang/, "detail penerimaan Gudang tidak menampilkan harga");
});
