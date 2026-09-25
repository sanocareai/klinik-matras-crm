// B3.6 — halaman Tutup Stok & Persediaan Awal: baca tempelan, tindakan per status, dan teks Bahasa Indonesia.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bacaTempelan, tindakanTersedia, ringkasPenyesuaian, tanggalIndonesia, CATATAN_PERIODIK,
} from "../src/features/finance/persediaanAwalLogika.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

test("Tempelan spreadsheet (tab), titik-koma, dan CSV dibaca; baris judul & kosong dilewati", () => {
  const tab = bacaTempelan("Kode material\tQty fisik\tSatuan\n BUSA-A\t10\tSHEET\t10000\tFAKTUR\tINV-1\n\nPLASTIK-B\t20,5\tKG\t30000\tTAGIHAN\tBILL-1\t\tgudang atas");
  assert.equal(tab.length, 2);
  assert.deepEqual(tab[0], { kode: "BUSA-A", qty: "10", satuan: "SHEET", harga: "10000", sumber: "FAKTUR", referensi: "INV-1", penjelasanHarga: "", catatan: "" });
  assert.equal(tab[1].qty, "20,5"); assert.equal(tab[1].catatan, "gudang atas");
  const tk = bacaTempelan("BUSA-A;1,5;SHEET;10.000;FAKTUR;INV-1");
  assert.equal(tk[0].qty, "1,5"); assert.equal(tk[0].harga, "10.000");
  const csv = bacaTempelan("BUSA-A,2,SHEET,10000,FAKTUR,INV-1");
  assert.equal(csv[0].sumber, "FAKTUR");
  assert.ok(bacaTempelan("BUSA-A,2,5,SHEET,10000,FAKTUR,INV-1,a,b")[0].galatTempel, "koma desimal di CSV berkoma ditolak jelas");
});

test("Tindakan per status: draf diisi & diperiksa; diperiksa → posting Owner; diposting → balik; final tanpa tindakan", () => {
  const semua = { tulis: true, periksaFinance: true, periksaGudang: true, posting: true };
  assert.deepEqual(tindakanTersedia({ status: "DRAFT" }, semua), ["isi", "batal", "periksaFinance", "periksaGudang"]);
  assert.deepEqual(tindakanTersedia({ status: "DRAFT", financeCheckedById: "u" }, semua), ["isi", "batal", "periksaGudang"]);
  assert.deepEqual(tindakanTersedia({ status: "DIPERIKSA" }, semua), ["bukaKembali", "posting"]);
  assert.deepEqual(tindakanTersedia({ status: "DIPERIKSA" }, { periksaFinance: true }), ["bukaKembali"], "bukan Owner tidak melihat tombol posting");
  assert.deepEqual(tindakanTersedia({ status: "DIPOSTING" }, semua), ["balik"]);
  assert.deepEqual(tindakanTersedia({ status: "DIBALIK" }, semua), []);
});

test("Teks penyesuaian & tanggal Indonesia", () => {
  assert.match(ringkasPenyesuaian({ penyesuaian: "715000.00" }), /Persediaan Bahan Baku bertambah/);
  assert.match(ringkasPenyesuaian({ penyesuaian: "-5.00" }), /berkurang/);
  assert.match(ringkasPenyesuaian({ penyesuaian: "0.00" }), /tidak ada jurnal/);
  assert.equal(tanggalIndonesia("2026-09-30"), "30 Sep 2026");
  assert.equal(CATATAN_PERIODIK, "Metode periodik — nilai persediaan akhir ditentukan melalui stok opname.");
});

test("Halaman memakai PIN step-up, pratinjau, alasan wajib, dan terdaftar di menu Finance & Gudang", () => {
  const p = baca("pages/finance/FinancePersediaanAwal.jsx");
  for (const s of ["usePinStepUp", "getPersediaanAwalPratinjau", "Pratinjau saja — belum ada jurnal yang dibuat", "Alasan posting (wajib)", "Periksa sebagai Finance", "Periksa sebagai Gudang", "Laporan pengecualian"]) assert.ok(p.includes(s), s);
  assert.doesNotMatch(p, /referenceUnitCost/, "harga referensi master tidak dipakai sebagai nilai");
  const layout = baca("components/Layout.jsx");
  assert.match(layout, /Tutup Stok & Persediaan Awal/);
  assert.match(layout, /Opname Cutover Persediaan/);
  assert.match(baca("routes/pageRegistry.jsx"), /\/finance\/persediaan-awal/);
});
