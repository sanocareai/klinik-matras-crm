import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TAB_PENERIMAAN, cocokJadwal, daftarSupplier, filterTab, hariIni, hitungPerTab, lewatJadwal, tabAktif, tahapUntukTab } from "../src/features/warehouse/penerimaan/penerimaanLogic.js";

// Redesain Gudang (3 Nov 2026) — Penerimaan Barang: tab, saringan jadwal, dan jaminan bahwa lapisan visual tidak menyentuh data/izin.
const akar = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").replace(/\r\n/g, "\n");

const HARI = "2026-11-03";
const r = (status, expectedDate = null, supplier = "PT A") => ({ id: status + expectedDate, status, expectedDate, supplier });
const baris = [r("DRAFT"), r("SCHEDULED", "2026-11-01"), r("SCHEDULED", "2026-11-03"), r("SCHEDULED", "2026-11-08"), r("ARRIVED", "2026-11-02"), r("INSPECTION", "2026-11-02", "PT B"), r("READY_FOR_PUTAWAY", "2026-10-30"), r("COMPLETED", "2026-10-29"), r("REJECTED", "2026-10-28")];

test("Tab: Perlu tindakan memakai definisi pipeline yang sama (draf, tiba, periksa, siap); Terjadwal tidak dihitung sebagai tindakan", () => {
  const h = hitungPerTab(baris);
  assert.deepEqual(h, { tindakan: 4, menunggu: 3, semua: 9, selesai: 2 });
  assert.deepEqual(filterTab(baris, "tindakan").map((x) => x.status).sort(), ["ARRIVED", "DRAFT", "INSPECTION", "READY_FOR_PUTAWAY"]);
  assert.ok(filterTab(baris, "menunggu").every((x) => x.status === "SCHEDULED"));
  assert.deepEqual(filterTab(baris, "selesai").map((x) => x.status).sort(), ["COMPLETED", "REJECTED"]);
  assert.equal(filterTab(baris, "tidak-ada").length, baris.length, "kunci tak dikenal = Semua (tidak menyembunyikan dokumen)");
});

test("Tab aktif: bawaan Perlu tindakan; tautan lama dengan saringan tahap tetap menampilkan hasilnya (Semua)", () => {
  assert.equal(tabAktif("", ""), "tindakan");
  assert.equal(tabAktif("", "STOK"), "semua");
  assert.equal(tabAktif("selesai", "STOK"), "selesai");
  assert.equal(tabAktif("ngawur", ""), "tindakan");
});

test("Pilihan tahap mengikuti tab (tahap yang mungkin ada di tab itu)", () => {
  assert.deepEqual(tahapUntukTab("tindakan").map((t) => t.key), ["DRAF", "TIBA", "PERIKSA", "SIAP"]);
  assert.deepEqual(tahapUntukTab("menunggu").map((t) => t.key), ["TERJADWAL"]);
  assert.deepEqual(tahapUntukTab("selesai").map((t) => t.key), ["STOK", "DITUTUP"]);
  assert.equal(tahapUntukTab("semua").length, 7);
  // setiap dokumen punya tepat satu tab bukan-Semua
  for (const x of baris) assert.equal(TAB_PENERIMAAN.filter((t) => t.key !== "semua" && t.cocok(x)).length, x.status === "SCHEDULED" || x.status !== "SCHEDULED" ? 1 : 0, x.status);
});

test("Jadwal: lewat hanya untuk dokumen yang barangnya belum dicatat tiba; hari ini; 7 hari ke depan", () => {
  assert.equal(lewatJadwal(r("SCHEDULED", "2026-11-01"), HARI), true);
  assert.equal(lewatJadwal(r("DRAFT", "2026-11-01"), HARI), true);
  assert.equal(lewatJadwal(r("ARRIVED", "2026-11-01"), HARI), false, "sudah tiba bukan lewat jadwal");
  assert.equal(lewatJadwal(r("SCHEDULED", "2026-11-03"), HARI), false);
  assert.equal(lewatJadwal(r("SCHEDULED", null), HARI), false, "tanpa jadwal bukan lewat jadwal");
  assert.equal(cocokJadwal(r("SCHEDULED", "2026-11-03"), "hari-ini", HARI), true);
  assert.equal(cocokJadwal(r("SCHEDULED", "2026-11-08"), "pekan", HARI), true);
  assert.equal(cocokJadwal(r("SCHEDULED", "2026-11-11"), "pekan", HARI), false);
  assert.equal(cocokJadwal(r("SCHEDULED", "2026-11-01"), "pekan", HARI), false);
  assert.equal(cocokJadwal(r("SCHEDULED", null), "hari-ini", HARI), false);
  assert.equal(cocokJadwal(r("SCHEDULED", null), "", HARI), true);
  assert.match(hariIni(), /^\d{4}-\d{2}-\d{2}$/);
});

test("Supplier: unik, terurut, tanpa kosong", () => {
  assert.deepEqual(daftarSupplier([r("DRAFT", null, "PT B"), r("DRAFT", null, "PT A"), r("DRAFT", null, " PT A "), r("DRAFT", null, "")]), ["PT A", "PT B"]);
  assert.deepEqual(daftarSupplier(null), []);
});

test("Halaman Penerimaan: saringan di URL, tab, panel menempel; data dan endpoint tidak berubah", () => {
  const s = baca("src/pages/warehouse/WarehouseGoodsReceipt.jsx");
  assert.match(s, /KUNCI = \["tab", "tahap", "q", "supplier", "jadwal"\]/);
  assert.match(s, /api\.getGoodsReceipts\(\{\}\)/, "satu sumber data yang sama");
  assert.match(s, /<PenerimaanDetail key="fokus"[\s\S]*? tempel \/>/);
  assert.doesNotMatch(s, /api\.(update|reject|putaway|create|mundur|batalkan|pulihkan)/, "daftar tidak mengubah data");
  assert.doesNotMatch(s, /status\s*[:=]\s*["']/, "status tidak dihitung/ditulis di daftar");
});

test("Mode tempel: hanya di layar lebar, Dialog tetap di bawah itu; satu-lapisan tetap berlaku di kedua mode", () => {
  const o = baca("src/components/ui/fokus-overlay.jsx");
  assert.match(o, /tempel = false, tempelMin = 1200/);
  assert.match(o, /if \(tempel && lebar\)/);
  assert.match(o, /<LapisanTunggalCtx\.Provider value=\{ctx\}>[\s\S]*<TempelCtx\.Provider value>/);
  assert.match(o, /<Dialog\.Root open/, "jendela fokus lama utuh");
  const d = baca("src/features/warehouse/penerimaan/PenerimaanDetail.jsx");
  assert.equal((d.match(/tempel=\{tempel\}/g) ?? []).length, 3, "memuat, galat, dan isi memakai mode yang sama");
});

test("Kulit Gudang: hanya divisi warehouse; ikon satu keluarga SVG garis tanpa aset luar; font tidak diubah", () => {
  const l = baca("src/components/Layout.jsx");
  assert.ok(l.includes('crmShell && divisionKey === "warehouse" && "gud-skin"'));
  assert.ok(l.includes('divisionKey === "warehouse" || apSkin) && !IS_DRIVER_APP && !CRM_SKIN_OFF')); // + apSkin (Main Hub/Delivery/All Teams, Gelombang 1); kelas gud-skin tetap hanya untuk warehouse
  const ik = baca("src/components/gudangIcons.jsx");
  assert.ok(!/https?:|href=|<image|fetch\(/.test(ik.replace(/xmlns|import React from "react";/g, "")), "tanpa aset eksternal");
  assert.match(ik, /stroke="currentColor"/);
  for (const rute of ["/warehouse/dashboard", "/warehouse/goods-receipt", "/warehouse/inventory", "/warehouse/retur-supplier", "/warehouse/kpi"]) assert.ok(ik.includes(`"${rute}":`), rute);
  const css = baca("src/styles/sanss-gudang.css");
  const tanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(tanpaKomentar, /font-family|@import|@font-face/);
  assert.doesNotMatch(tanpaKomentar, /font-weight:\s*(700|800|900)/);
  assert.ok(baca("src/main.jsx").includes('import "./styles/sanss-gudang.css";'));
});

test("Menu Gudang: setiap rute menu punya ikon; urutan dan izin menu tidak disentuh", () => {
  const l = baca("src/components/Layout.jsx");
  const gudang = l.slice(l.indexOf("  warehouse: {\n    label: \"Warehouse\""), l.indexOf("// ── DELIVERY & FULFILLMENT"));
  const rute = [...gudang.matchAll(/\{ to: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(rute.length >= 20, "daftar menu terbaca");
  const ik = baca("src/components/gudangIcons.jsx");
  for (const x of rute) assert.ok(ik.includes(`"${x}":`), `ikon untuk ${x}`);
});

// ── Formulir & tindakan (Fase 1 lanjutan): kit kontrol aplikasi, kunci klik ganda sinkron, Retur opt-in (Finance tidak berubah)
test("Kit kontrol Gudang: pemilih/kalender/angka aplikasi, galat per kolom, tanpa <select>/<input type=date> bawaan di formulir alur Penerimaan", () => {
  const kit = baca("src/features/warehouse/form/GudKontrol.jsx");
  for (const k of ["export function GudField", "export function PilihGud", "export function TanggalGud", "export function AngkaGud", "aria-invalid"]) assert.ok(kit.includes(k), k);
  assert.match(kit, /lapisanTetap/, "kalender di panel/jendela memakai posisi layar");
  for (const f of ["src/features/warehouse/components/GoodsReceiptFormModal.jsx", "src/features/warehouse/aksi/AksiDokumen.jsx", "src/features/warehouse/koreksi/KoreksiPenerimaanModal.jsx"]) {
    const s = baca(f).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.doesNotMatch(s, /<select\b/, `${f}: <select> bawaan`); assert.doesNotMatch(s, /type="date"|type=\{[^}]*"date"/, `${f}: input date bawaan`); assert.doesNotMatch(s, /window\.confirm/, `${f}: confirm bawaan`);
  }
  assert.match(baca("src/components/ui/date-picker.jsx"), /lapisanTetap = false/, "DatePicker: opt-in, perilaku halaman lain tidak berubah");
});

test("Klik ganda: kunci SINKRON (ref) pada semua tindakan penulisan alur Penerimaan/Retur — satu permintaan", () => {
  for (const [f, pola] of [["src/features/warehouse/aksi/AksiDokumen.jsx", /kunciJalan\.current/], ["src/features/warehouse/components/GoodsReceiptFormModal.jsx", /kunci\.current/], ["src/features/kedatangan/PanelKedatangan.jsx", /kunciRef\.current/], ["src/features/warehouse/koreksi/KoreksiPenerimaanModal.jsx", /kunciAjukan\.current/], ["src/features/returSupplier/ReturSupplierWorkspace.jsx", /kunciRef\.current/]]) assert.match(baca(f), pola, f);
});

test("Retur Supplier: tata letak Gudang HANYA untuk workspace GUDANG; Finance memakai komponen lama (Pilihan/Input date) tanpa perubahan", () => {
  const r = baca("src/features/returSupplier/ReturSupplierWorkspace.jsx");
  assert.match(r, /if \(workspace === "GUDANG"\) \{\s*\n\s*return \(\s*\n\s*<PageContainer fluid className="gud-halaman">/);
  assert.match(r, /const Pil = gud \? PilihGud : Pilihan;/);
  assert.match(r, /gud \? <TanggalGud[^]*?: <Input type="date"/, "Finance tetap memakai Input date lama");
  const pk = baca("src/features/kedatangan/PanelKedatangan.jsx");
  assert.match(pk, /const gud = workspace === "GUDANG"; const Pil = gud \? PilihGud : Pilihan;/);
  assert.match(pk, /gud \? <TanggalGud[^]*?: <Input type="date"/);
  assert.match(pk, /function JumlahIsian\(\{ gud/);
});

test("Alur penerimaan tidak menambah pemanggilan penulisan baru: daftar endpoint yang dipakai formulir sama dengan sebelumnya", () => {
  const f = baca("src/features/warehouse/components/GoodsReceiptFormModal.jsx");
  const dipakai = [...f.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(dipakai)], ["createGoodsReceipt", "getGudangPurchaseOrders", "getMaterials"]);
  const a = baca("src/features/warehouse/aksi/AksiDokumen.jsx");
  assert.doesNotMatch(a, /api\./, "AksiDokumen hanya memanggil onJalankan milik halaman (kontrak lama)");
});
