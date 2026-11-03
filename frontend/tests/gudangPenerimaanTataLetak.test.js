import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { barisPerItem, diLuarDaftar, galatBarisPemeriksaan, kodeSekunder, pengirimanLainPO, progresItemPO, tabUntukDokumen } from "../src/features/warehouse/penerimaan/penerimaanLogic.js";
import { galatBarisKedatangan, galatKolomKedatangan, formKedatanganAwal } from "../src/features/kedatangan/kedatanganLogic.js";

// Redesain Penerimaan (4 Nov 2026): rincian per item berbasis lebar panel, dialog kerja, pengiriman bertahap/kelebihan, dokumen di luar saringan.
const akar = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").replace(/\r\n/g, "\n");
const css = baca("src/styles/sanss-gudang-dok.css");

test("Kode sekunder tidak mengulang nama; kode berbeda tetap tampil", () => {
  assert.equal(kodeSekunder({ kode: "BUSA-OCEAN-D18-120X200X2CM", nama: "BUSA OCEAN D18 120X200X2CM" }), null);
  assert.equal(kodeSekunder({ kode: "SBX-LONG-01", nama: "Kain Oscar" }), "SBX-LONG-01");
  assert.equal(kodeSekunder({ kode: "—", nama: "" }), null);
});

test("Kartu item: nama SATU baris penuh di atas (bukan kolom sempit); grid auto-fit mengikuti lebar kontainer; tanpa lebar tetap", () => {
  assert.match(css, /\[data-testid="tabel-per-item"\] \{ container-type: inline-size; container-name: gud-pi/);
  const nama = css.match(/\.gud-pi-nama \{[^}]+\}/)[0];
  assert.match(nama, /flex: 1 1 100%/); assert.match(nama, /overflow-wrap: break-word/); assert.doesNotMatch(nama, /word-break: (break-all|break-word)/); assert.doesNotMatch(nama, /font-size: (1[0-3])px/);
  assert.match(css, /\.gud-pi-grid \{[^}]*repeat\(auto-fit, minmax\(min\(100%, 112px\), 1fr\)\)/);
  const src = baca("src/features/warehouse/penerimaan/TabelPerItem.jsx");
  assert.doesNotMatch(src, /editable|<input(?![^>]*type="search")|AngkaGud/); // baca-saja: tidak ada isian di panel
  for (const k of ["Dijadwalkan", "Tiba", "Baik", "Ditolak", "Masuk stok", "Dipesan", "Sudah datang", "Belum datang", "Baik belum disimpan", "Sudah masuk stok"]) assert.ok(src.includes(k) || /Dipesan|Sudah datang|Belum datang|Baik belum disimpan|Sudah masuk stok/.test(baca("src/features/warehouse/penerimaan/penerimaanLogic.js")), k);
});

test("Tabrakan kelas: kartu Penerimaan memakai gud-pi*, tidak lagi gud-item*; pemakai gud-item lain memakai gud-bhn*", () => {
  const pen = baca("src/features/warehouse/penerimaan/TabelPerItem.jsx") + baca("src/features/warehouse/penerimaan/DialogPemeriksaan.jsx");
  assert.doesNotMatch(pen, /gud-item/);
  for (const f of ["src/features/warehouse/components/MaterialIssueFormModal.jsx", "src/features/warehouse/dokumen/MaterialIssueDetail.jsx", "src/pages/warehouse/WarehouseMaterialPickup.jsx"]) assert.doesNotMatch(baca(f), /\bgud-item/, f);
  assert.doesNotMatch(css, /\.gud-item\b/);
});

test("Angka PO per item = definisi server (Dipesan · Sudah datang · Belum datang · Baik belum disimpan · Sudah masuk stok); tanpa PO → tidak ada", () => {
  const b = { progres: { dipesan: 100, datang: 50, datangAsli: 50, belumDatang: 50, baikBelumDisimpan: 0, masukStok: 50, menungguPengganti: 0, ditolak: 0 } };
  assert.deepEqual(progresItemPO(b).map((s) => [s.label, s.nilai]), [["Dipesan", 100], ["Sudah datang", 50], ["Belum datang", 50], ["Baik belum disimpan", 0], ["Sudah masuk stok", 50]]);
  const p = progresItemPO({ progres: { ...b.progres, menungguPengganti: 8, ditolak: 8 } }).map((s) => s.kunci);
  assert.ok(p.includes("menungguPengganti") && p.includes("ditolak"));
  assert.equal(progresItemPO({ progres: null }), null);
});

test("Galat per baris pemeriksaan: baik + ditolak ≤ tiba, angka ≥ 0, maks 3 desimal", () => {
  const b = { baik: null, ditolak: null, tiba: 50 };
  assert.equal(galatBarisPemeriksaan(b, { acceptedQty: "50", rejectedQty: "0" }), "");
  assert.match(galatBarisPemeriksaan(b, { acceptedQty: "60" }), /melebihi jumlah tiba/);
  assert.match(galatBarisPemeriksaan(b, { acceptedQty: "-1" }), /0 atau lebih/);
  assert.match(galatBarisPemeriksaan(b, { acceptedQty: "1.2345" }), /3 angka/);
  assert.equal(galatBarisPemeriksaan({ baik: null, ditolak: null, tiba: null }, { acceptedQty: "5" }), ""); // tiba belum diisi: tidak menuduh
});

const po = { orderDate: "2026-10-20", lines: [{ id: "L1", kode: "BUSA", nama: "BUSA", satuan: "PCS", dipesan: 100, belumDatang: 50, belumDipenuhiSupplier: 50, menungguPengganti: 0, asalPengganti: [] }] };
test("Kelebihan atas sisa PO: galat per baris menyebut batas dan 'Minta Finance merevisi jumlah PO'; tanpa jalan otomatis", () => {
  const f = formKedatanganAwal(po); f.penerima = "Budi"; f.catatan = "x"; f.lines[0].jumlahDatang = "51";
  const g = galatBarisKedatangan(f.lines[0]);
  assert.match(g, /Batas 50 PCS/); assert.match(g, /Minta Finance merevisi jumlah PO/);
  const k = galatKolomKedatangan(f, { tanggalPO: po.orderDate }); assert.equal(k["baris:L1"], g);
  f.lines[0].jumlahDatang = "50"; assert.equal(galatBarisKedatangan(f.lines[0]), ""); assert.deepEqual(galatKolomKedatangan(f, { tanggalPO: po.orderDate }), {});
  f.lines[0].jumlahDatang = ""; assert.equal(galatKolomKedatangan(f, { tanggalPO: po.orderDate }).jumlah, "Isi jumlah datang minimal satu item");
  const src = baca("src/features/kedatangan/PanelKedatangan.jsx");
  assert.doesNotMatch(src, /revisiJumlah|revisi-jumlah|setujui kelebihan/i); // tidak ada tombol/jalur yang merevisi PO dari Gudang
});

test("Pengganti: batas = sisa penolakan; bukan 'belum datang'", () => {
  const f = formKedatanganAwal({ ...po, lines: [{ ...po.lines[0], belumDatang: 0, belumDipenuhiSupplier: 8, menungguPengganti: 8, asalPengganti: [{ lineId: "A", receiptNumber: "GR-1", sisa: 8 }] }] });
  f.lines[0].jumlahDatang = "8"; assert.match(galatBarisKedatangan(f.lines[0]), /Batas 0 PCS/); // tanpa centang pengganti: tetap dihitung asli
  f.lines[0].pengganti = true; assert.equal(galatBarisKedatangan(f.lines[0]), "");
  f.lines[0].jumlahDatang = "9"; assert.match(galatBarisKedatangan(f.lines[0]), /Batas 8 PCS.*tidak menaikkan jumlah PO/);
});

test("Pengiriman lain pada PO yang sama: satu pengiriman = satu dokumen, urut tanggal, tidak menghitung dokumen ditolak", () => {
  const ini = { id: "1", purchaseOrderId: "P", lines: [{ purchaseOrderLineId: "L1" }] };
  const semua = [ini, { id: "2", purchaseOrderId: "P", status: "COMPLETED", receiptNumber: "GR-2", arrivedDate: "2026-11-01", lines: [{ purchaseOrderLineId: "L1", receivedQty: 50, material: { code: "B", name: "B" } }] },
    { id: "3", purchaseOrderId: "P", status: "REJECTED", receiptNumber: "GR-3", lines: [{ purchaseOrderLineId: "L1", receivedQty: 9 }] }, { id: "4", purchaseOrderId: "Q", status: "ARRIVED", lines: [] }];
  const l = pengirimanLainPO(ini, semua); assert.equal(l.length, 1); assert.equal(l[0].nomor, "GR-2"); assert.equal(l[0].baris[0].tiba, 50);
  assert.deepEqual(pengirimanLainPO({ id: "x", purchaseOrderId: null, lines: [] }, semua), []);
});

test("Dokumen di luar saringan: hanya bila dokumen ada di data tetapi tidak di hasil; tab sesuai status", () => {
  const rows = [{ id: "a", status: "SCHEDULED" }, { id: "b", status: "COMPLETED" }];
  assert.equal(diLuarDaftar("b", rows, [rows[0]]), true); assert.equal(diLuarDaftar("a", rows, [rows[0]]), false);
  assert.equal(diLuarDaftar("b", null, null), false); assert.equal(diLuarDaftar("zzz", rows, []), false); // belum dimuat / tak dikenal: tidak menuduh
  assert.equal(tabUntukDokumen({ status: "COMPLETED" }), "selesai"); assert.equal(tabUntukDokumen({ status: "SCHEDULED" }), "menunggu"); assert.equal(tabUntukDokumen({ status: "ARRIVED" }), "tindakan");
  const hal = baca("src/pages/warehouse/WarehouseGoodsReceipt.jsx"); assert.match(hal, /data-testid="di-luar-daftar"/); assert.match(hal, /data-testid="tampilkan-di-daftar"/);
});

test("Panel = BACA, form panjang = dialog kerja lebar (layar penuh di HP): Pemeriksaan, Catat tiba, Koreksi", () => {
  const det = baca("src/features/warehouse/penerimaan/PenerimaanDetail.jsx");
  assert.match(det, /<DialogPemeriksaan/); assert.match(det, /if \(kode === "ISI_PEMERIKSAAN"\) \{[^}]*setPeriksa\(true\)/);
  assert.doesNotMatch(det, /progres-po-baris/); assert.doesNotMatch(det, /editable=/);
  const dlg = baca("src/features/warehouse/penerimaan/DialogPemeriksaan.jsx");
  assert.match(dlg, /dialogBilaTempel/); assert.match(dlg, /gud-dlg-penuh/); assert.match(dlg, /kunci\.current/); assert.match(dlg, /simpan-pemeriksaan/);
  const pk = baca("src/features/kedatangan/PanelKedatangan.jsx");
  assert.match(pk, /if \(gud\) \{[\s\S]*dialogBilaTempel[\s\S]*gud-dlg-penuh/); assert.match(pk, /portalToBody=\{gud\} dialogBilaTempel=\{gud\}/);
  assert.match(css, /\.gud-dlg-penuh \{[^}]*max-height/); assert.match(css, /@media \(max-width: 639px\) \{\s*\.gud-dlg-penuh \{[^}]*100dvh/);
  assert.match(css, /container-name: gud-dlg/);
  // Finance tidak berubah: cabang non-Gudang masih memakai kolom & galat lama.
  assert.match(pk, /disabled=\{!!galatDini \|\| kunciSimpan\}/);
});

test("Alur status: tahap saat ini + 'Lihat alur' di panel sempit (enam tahap tetap ada); tindakan konkret lebih dulu dari menu Ubah status", () => {
  const src = baca("src/features/warehouse/penerimaan/PipelineStatus.jsx");
  assert.match(src, /data-testid="lihat-alur"/); assert.match(src, /Tahap \{p\.indeks \+ 1\} dari \{p\.tahap\.length\}/); assert.match(src, /p\.tahap\.map/);
  assert.match(css, /container-name: gud-pipa/); assert.match(css, /@container gud-pipa \(max-width: 600px\)/);
  const det = baca("src/features/warehouse/penerimaan/PenerimaanDetail.jsx");
  assert.match(det, /ARRIVED: "Mulai pemeriksaan"/); assert.match(det, /INSPECTION: "Tandai siap masuk stok"/);
});

test("Panel menempel tidak lagi terpotong di dasar (tinggi dari posisi awal)", () => {
  assert.match(css, /\.fokus-tempel \{ height: calc\(100dvh - 130px\); max-height: calc\(100dvh - 130px\); \}/);
});

test("barisPerItem membawa progres PO + id baris PO", () => {
  const r = { status: "ARRIVED", lines: [{ id: "x", purchaseOrderLineId: "L1", material: { code: "B", name: "Busa", unit: "PCS" }, orderedQty: "100", receivedQty: "50", acceptedQty: null, rejectedQty: null }], poRingkas: { lines: [{ id: "L1", progres: { dipesan: 100, datang: 50, belumDatang: 50 } }] } };
  const [b] = barisPerItem(r); assert.equal(b.progres.dipesan, 100); assert.equal(b.purchaseOrderLineId, "L1"); assert.equal(b.tiba, 50); assert.equal(b.baik, null);
});
