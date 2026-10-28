// Barang mirip pada form PO: helper murni + pengawatan sumber (aksi pada baris, bukan hanya pesan galat). Tanpa React/DOM.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { barisLainDariForm, barisBaruUntukCek, jenisMasalah, masalahDariCek, masalahDariGalat, teksPerbedaan } from "../src/features/finance/purchaseOrderLogic.js";

const src = (...p) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", ...p), "utf8").replace(/\r\n/g, "\n");
const mb = (nama, o = {}) => ({ nama, kategori: "Busa", jenis: "BAHAN_PRODUKSI", satuanStok: "SHEET", satuanBeli: "SHEET", spesifikasi: "", ...o });
const LINES = [{ materialId: "", materialBaru: mb("BUSA REBONDED MSB 120X200X2CM R58") }, { materialId: "abc", materialBaru: null }, { materialId: "", materialBaru: mb("BUSA REBONDED MSB 160X200X2CM R58", { spesifikasi: " tebal 2 " }) }];

test("barisLainDariForm: barang baru lain (bukan baris yang sedang diperiksa), bernomor baris sesungguhnya; baris material yang ada diabaikan", () => {
  assert.deepEqual(barisLainDariForm(LINES, 0), [{ baris: 3, nama: "BUSA REBONDED MSB 160X200X2CM R58", satuanStok: "SHEET", spesifikasi: "tebal 2", kategori: "Busa" }]);
  assert.deepEqual(barisLainDariForm(LINES, -1).map((x) => x.baris), [1, 3]); assert.deepEqual(barisLainDariForm([{ materialBaru: mb("") }], -1), []); assert.deepEqual(barisLainDariForm(null, 0), []);
});

test("barisBaruUntukCek: semua barang baru yang valid, berurutan, dalam bentuk body server; baris yang belum lengkap tidak ikut", () => {
  const r = barisBaruUntukCek([...LINES, { materialBaru: mb("X", { kategori: "" }) }]); assert.deepEqual(r.map((x) => x.baris), [1, 3]); assert.equal(r[0].materialBaru.nama, "BUSA REBONDED MSB 120X200X2CM R58"); assert.equal(r[1].materialBaru.satuanStok, "SHEET");
});

test("masalahDariCek: hanya baris yang diblokir/butuh konfirmasi; jenis masalah menentukan aksi (katalog / baris lain di PO / konfirmasi)", () => {
  const cek = { bolehSimpan: false, baris: [
    { baris: 1, pasti: [], mirip: [], berbeda: [{ kode: "BUS-009" }], diblokir: false, perluKonfirmasi: false },
    { baris: 2, pasti: [{ materialId: "m1", kode: "BUS-012" }], mirip: [], diblokir: true, perluKonfirmasi: false, dalamPO: false },
    { baris: 3, pasti: [{ materialId: null, kode: "Baris 1", dariBarisPO: 1 }], mirip: [], diblokir: true, perluKonfirmasi: false, dalamPO: true },
    { baris: 4, pasti: [], mirip: [{ kode: "BUS-009", belumJelas: ["Ukuran tertulis di salah satu nama saja"] }], diblokir: false, perluKonfirmasi: true },
  ] };
  const m = masalahDariCek(cek); assert.deepEqual(Object.keys(m), ["2", "3", "4"]);
  assert.equal(jenisMasalah(m[2]), "PASTI_KATALOG"); assert.equal(jenisMasalah(m[3]), "PASTI_PO"); assert.equal(jenisMasalah(m[4]), "KONFIRMASI"); assert.equal(jenisMasalah(null), null);
  assert.deepEqual(masalahDariCek({ baris: [] }), {}); assert.deepEqual(masalahDariCek(null), {});
});

test("masalahDariGalat: galat simpan dari server menunjuk baris + kandidat; galat lain bukan masalah baris", () => {
  const e1 = Object.assign(new Error("Baris 2: ..."), { code: "SKU_MIRIP_BUTUH_KONFIRMASI", data: { baris: 2, kandidat: [{ kode: "BUS-009", materialId: "x" }] } });
  const m1 = masalahDariGalat(e1); assert.equal(m1.baris, 2); assert.equal(jenisMasalah(m1), "KONFIRMASI"); assert.equal(m1.mirip[0].kode, "BUS-009");
  const e2 = Object.assign(new Error("Baris 3: sama dengan baris 1"), { code: "SKU_DUPLIKAT_DALAM_PO", data: { baris: 3, barisSama: 1, kandidat: [{ dariBarisPO: 1 }] } }); const m2 = masalahDariGalat(e2); assert.equal(jenisMasalah(m2), "PASTI_PO"); assert.equal(m2.barisSama, 1);
  const e3 = Object.assign(new Error("x"), { code: "SKU_DUPLIKAT_PASTI", data: { baris: 1, kandidat: [{ materialId: "m", kode: "BUS-012" }] } }); assert.equal(jenisMasalah(masalahDariGalat(e3)), "PASTI_KATALOG");
  assert.equal(masalahDariGalat(new Error("Koneksi putus")), null); assert.equal(masalahDariGalat(Object.assign(new Error("x"), { code: "SKU_DUPLIKAT_PASTI" })), null, "tanpa nomor baris tidak bisa ditunjuk");
});

test("teksPerbedaan: perbedaan disorot 'label: baru ≠ ada'", () => {
  assert.equal(teksPerbedaan({ label: "Ketebalan", baru: "2 cm", ada: "4 cm" }), "Ketebalan: 2 cm ≠ 4 cm");
});

test("pengawatan: panel hasil memisahkan Sudah ada / Perlu keputusan / Varian serupa (tanpa paksaan); aksi pada BARIS; kontrak kunci idempotensi po-${kunci} tetap", () => {
  const p = src("pages", "finance", "FinancePurchaseOrders.jsx");
  for (const k of ['data-testid="duplikat-pasti"', 'data-testid="duplikat-mirip"', 'data-testid="varian-serupa"', 'data-testid="perbedaan"', 'data-testid="pakai-material"', 'data-testid="batalkan-baru"', "api.cekDuplikatSku({ supplierId, materialBaru: bodyMaterialBaru({ ...m, konfirmasiMirip: false }), barisLain })",
    "function PanelMasalahBaris", 'data-testid="masalah-baris"', 'data-testid="masalah-pakai"', 'data-testid="masalah-periksa"', 'data-testid="masalah-hapus"', "<PanelMasalahBaris", "api.cekDuplikatPO(", "masalahDariGalat(e)", "api.createPurchaseOrder(body, `po-${kunci}`)", "autoPeriksa", "barisLainDariForm(f.lines, barangBaru.baris)", "keBaris("]) assert.ok(p.includes(k), k);
  assert.match(p, /if \(!otomatis && \(r\.pasti \|\| \[\]\)\.length === 0 && \(r\.mirip \|\| \[\]\)\.length === 0 && \(r\.berbeda \|\| \[\]\)\.length === 0\) onSimpan\(m\)/, "hanya tanpa kandidat sama sekali yang langsung dipakai; varian berbeda ditampilkan dulu tanpa paksaan");
  assert.ok(p.indexOf("masalahDariCek(cek)") < p.indexOf("api.createPurchaseOrder("), "pemeriksaan sekaligus SEBELUM simpan");
  assert.match(src("api.js"), /cekDuplikatPO: \(data\) => request\("\/finance\/purchase-orders\/sku\/cek-duplikat-po"/); assert.match(src("api.js"), /\{ status: res\.status, code, \.\.\.\(detail \? \{ detail \} : \{\}\), \.\.\.\(dataGalat \? \{ data: dataGalat \} : \{\}\) \}/);
});
