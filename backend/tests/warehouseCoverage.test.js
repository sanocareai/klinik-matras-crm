// Jalur koreksi per dokumen+status (murni) — kontrak: tidak ada "Edit umum"; posting tidak diedit diam-diam; batas Finance/Produksi.
import test from "node:test";
import assert from "node:assert/strict";
import { JALUR, MATRIKS_MENU, PENGHALANG, TIPE, TIPE_DIKENAL, jalurDokumen } from "../src/services/warehouseCoverage.js";
import { selisihField } from "../src/lib/jejakPerubahan.js";

test("setiap jenis dokumen punya jalur untuk setiap status; jalur selalu salah satu dari lima; selalu ada langkah nyata kecuali final", () => {
  const status = {
    GOODS_RECEIPT: ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED", "REJECTED"],
    MATERIAL_ISSUE: ["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED", "ISSUED", "CANCELLED"],
    STOCK_TRANSFER: ["DRAFT", "WAITING_APPROVAL", "APPROVED", "PICKED", "IN_TRANSIT", "COMPLETED", "CANCELLED"],
    RETURN_RECORD: ["CREATED", "RECEIVED", "INSPECTION", "COMPLETED", "CANCELLED"],
    DAMAGED_STOCK: ["REPORTED", "UNDER_INSPECTION", "RESOLVED"],
    STOCK_ADJUSTMENT: ["DRAFT", "WAITING_APPROVAL", "APPROVED", "POSTED", "CANCELLED"],
    STOCK_COUNT: ["SCHEDULED", "IN_PROGRESS", "WAITING_REVIEW", "COMPLETED", "CANCELLED"],
    SUPPLIER_RETURN: ["DRAFT", "KELUAR", "SELESAI", "DIBATALKAN"],
  };
  for (const t of TIPE_DIKENAL) for (const s of status[t]) {
    const j = jalurDokumen(t, { status: s });
    assert.ok(Object.values(JALUR).includes(j.jalur), `${t}/${s}`); assert.ok(j.judul && j.penjelasan, `${t}/${s}`);
    if (j.jalur !== JALUR.FINAL) assert.ok(j.langkah.length > 0, `${t}/${s} butuh langkah penyelesaian`);
  }
});

test("dokumen yang sudah diposting TIDAK pernah EDIT_DRAF; draf tidak pernah ALUR_RESMI/KOREKSI_UI", () => {
  const posted = [["GOODS_RECEIPT", "COMPLETED"], ["MATERIAL_ISSUE", "ISSUED"], ["STOCK_TRANSFER", "COMPLETED"], ["STOCK_TRANSFER", "IN_TRANSIT"], ["RETURN_RECORD", "COMPLETED"], ["DAMAGED_STOCK", "RESOLVED"], ["STOCK_ADJUSTMENT", "POSTED"], ["STOCK_COUNT", "COMPLETED"], ["SUPPLIER_RETURN", "KELUAR"]];
  for (const [t, s] of posted) assert.notEqual(jalurDokumen(t, { status: s, resolution: "DISPOSE" }).jalur, JALUR.EDIT_DRAF, `${t}/${s}`);
  for (const [t, s] of [["GOODS_RECEIPT", "DRAFT"], ["MATERIAL_ISSUE", "DRAFT"], ["STOCK_ADJUSTMENT", "DRAFT"], ["STOCK_TRANSFER", "APPROVED"], ["RETURN_RECORD", "CREATED"]]) assert.equal(jalurDokumen(t, { status: s }).jalur, JALUR.EDIT_DRAF, `${t}/${s}`);
});

test("batas lintas domain: GR dari PO → alur resmi Koreksi Kedatangan (Finance-aware); GR tanpa PO → koreksi bertaut tanpa dampak Finance; dokumen bahan Produksi V2 diblokir", () => {
  const po = jalurDokumen("GOODS_RECEIPT", { status: "COMPLETED", purchaseOrderId: "x" });
  assert.equal(po.jalur, JALUR.ALUR_RESMI); assert.equal(po.pengaruh.finance, true); assert.ok(po.tindakan.some((t) => t.kode === "KOREKSI_KEDATANGAN")); assert.match(po.penjelasan, /progres PO|termin|jurnal/);
  const non = jalurDokumen("GOODS_RECEIPT", { status: "COMPLETED" });
  assert.equal(non.jalur, JALUR.KOREKSI_UI); assert.equal(non.pengaruh.finance, false); assert.equal(non.pengaruh.stok, true);
  const v2 = jalurDokumen("MATERIAL_ISSUE", { status: "ISSUED", productionPlanId: "p" });
  assert.equal(v2.jalur, JALUR.DIBLOKIR); assert.equal(v2.pengaruh.produksi, true); assert.match(v2.penjelasan, /Produksi/);
  assert.equal(jalurDokumen("MATERIAL_ISSUE", { status: "ISSUED" }).jalur, JALUR.ALUR_RESMI);
  assert.equal(jalurDokumen("STOCK_COUNT", { status: "COMPLETED" }).jalur, JALUR.ALUR_RESMI);
  assert.equal(jalurDokumen("TIDAK_ADA", { status: "X" }).jalur, JALUR.DIBLOKIR);
});

test("matriks menu: setiap menu punya jalur sah, catatan, dan menu milik Produksi/Finance diblokir (tidak ada koreksi palsu)", () => {
  assert.ok(MATRIKS_MENU.length >= 15);
  for (const m of MATRIKS_MENU) { assert.ok(Object.values(JALUR).includes(m.jalur), m.menu); assert.ok(m.catatan.length > 20, m.menu); assert.equal(typeof m.stok, "boolean"); }
  assert.equal(MATRIKS_MENU.find((m) => m.menu.startsWith("Terima Barang Jadi")).jalur, JALUR.DIBLOKIR);
  assert.equal(MATRIKS_MENU.find((m) => m.menu === "Opname Cutover Persediaan").jalur, JALUR.DIBLOKIR);
  assert.equal(MATRIKS_MENU.find((m) => m.menu === "Penerimaan Barang").jalur, JALUR.KOREKSI_UI);
});

test("penghalang: setiap kode punya pesan dan langkah penyelesaian nyata", () => {
  for (const [k, v] of Object.entries(PENGHALANG)) { assert.ok(v.pesan.length > 15, k); assert.ok(v.langkah.length > 10, k); }
  for (const k of ["BAHAN_SUDAH_BERGERAK", "SUDAH_DIHITUNG_OPNAME", "STOK_TIDAK_CUKUP", "JURNAL_FINANCE", "TAGIHAN_TERKAIT", "DARI_PO", "RETUR_AKTIF", "KOREKSI_TERTUNDA"]) assert.ok(PENGHALANG[k], k);
  assert.match(PENGHALANG.JURNAL_FINANCE.langkah, /Finance/); assert.match(PENGHALANG.DARI_PO.langkah, /Koreksi Kedatangan/); assert.match(PENGHALANG.BAHAN_SUDAH_BERGERAK.langkah, /Penyesuaian Stok/);
  assert.equal(TIPE.GOODS_RECEIPT, "GOODS_RECEIPT");
});

test("jejak perubahan: hanya bidang yang benar-benar berubah; tanggal/null dinormalkan; bidang otomatis diabaikan", () => {
  const r = selisihField({ notes: null, supplier: "A", requiredDate: new Date("2026-10-01T00:00:00Z"), approvedAt: null }, { notes: "baru", supplier: "A", requiredDate: new Date("2026-10-01T00:00:00Z"), approvedAt: new Date(), priority: undefined });
  assert.deepEqual(r, { sebelum: { notes: null }, sesudah: { notes: "baru" } });
  assert.deepEqual(selisihField({ a: 1 }, { a: 1 }), { sebelum: {}, sesudah: {} });
  assert.deepEqual(selisihField({ requiredDate: new Date("2026-10-01T00:00:00Z") }, { requiredDate: null }), { sebelum: { requiredDate: "2026-10-01T00:00:00.000Z" }, sesudah: { requiredDate: null } });
});
