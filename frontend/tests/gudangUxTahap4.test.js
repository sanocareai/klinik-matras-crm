// UX Gudang Tahap 4 — Pusat Kerja Harian & Penanganan Masalah: logika murni (tujuan jendela fokus, definisi) dan kontrak struktur (satu pola jendela fokus untuk semua dokumen, Beranda/Perlu Perhatian/pencarian BACA-SAJA).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JENIS_FOKUS, bisaFokus, urlItem, dalamHalaman, barisDefinisi, LABEL_CAKUPAN } from "../src/features/warehouse/pusatkerja/urlFokus.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(dir, "../src", rel), "utf8").replace(/\r\n/g, "\n");

test("urlItem: jenis ber-jendela → /<halaman>/<jenis>/<id>; aksi hanya sebagai query ?aksi= (membuka/menyorot, bukan menjalankan)", () => {
  const gr = { jenis: "penerimaan", id: "11111111-1111-4111-8111-111111111111", tautan: "/x" };
  assert.equal(urlItem("/warehouse/dashboard", gr), "/warehouse/dashboard/penerimaan/11111111-1111-4111-8111-111111111111");
  assert.equal(urlItem("/warehouse/dashboard", gr, "TANDAI_TIBA"), "/warehouse/dashboard/penerimaan/11111111-1111-4111-8111-111111111111?aksi=TANDAI_TIBA");
  assert.equal(urlItem("/warehouse/perlu-perhatian", { jenis: "koreksi", id: "abc" }), "/warehouse/perlu-perhatian/koreksi/abc");
  for (const j of JENIS_FOKUS) assert.ok(urlItem("/b", { jenis: j, id: "i" }).startsWith(`/b/${j}/i`), j);
});

test("urlItem: Retur Supplier ke rute daftarnya; bahan & item Produksi memakai tautan server; tanpa id/tautan → null", () => {
  assert.equal(urlItem("/warehouse/dashboard", { jenis: "retur-supplier", id: "r1" }), "/warehouse/retur-supplier/r1");
  assert.equal(urlItem("/warehouse/dashboard", { jenis: "bahan", id: "m1", tautan: "/warehouse/inventory?q=BUSA-A" }), "/warehouse/inventory?q=BUSA-A");
  assert.equal(urlItem("/warehouse/dashboard", { jenis: "bahan", id: "h1", tautan: "/warehouse/antrean-produksi" }), "/warehouse/antrean-produksi");
  assert.equal(urlItem("/warehouse/dashboard", { jenis: "bahan" }), null); assert.equal(urlItem("/x", null), null);
  assert.equal(bisaFokus("bahan"), false); assert.equal(bisaFokus("po"), true); assert.equal(bisaFokus("retur-supplier"), false);
});

test("dalamHalaman: hanya URL di bawah halaman yang sama yang mendorong riwayat satu langkah", () => {
  assert.equal(dalamHalaman("/warehouse/dashboard", "/warehouse/dashboard/transfer/1"), true);
  assert.equal(dalamHalaman("/warehouse/dashboard", "/warehouse/transfers/1"), false); assert.equal(dalamHalaman("/warehouse/dashboard", null), false);
});

test("barisDefinisi: sumber data, masuk, keluar, siapa yang bertindak, satuan hitung; baris kosong dibuang", () => {
  const r = barisDefinisi({ tabel: "goods_receipts", masuk: "Draf/Terjadwal", keluar: "Barang tiba", pemilik: "Gudang", satuan: "dokumen" });
  assert.deepEqual(r.map(([k]) => k), ["Sumber data", "Masuk antrean bila", "Keluar antrean bila", "Yang boleh bertindak", "Dihitung per"]);
  assert.deepEqual(barisDefinisi(null), []); assert.ok(LABEL_CAKUPAN.PROSES && LABEL_CAKUPAN.DOKUMEN && LABEL_CAKUPAN.BAHAN && LABEL_CAKUPAN.FITUR);
});

test("satu pola jendela fokus: semua detail dokumen menampilkan FokusOverlay + props { id, onTutup, onBerubah }, tanpa halaman terpisah (PageContainer) dan tanpa useParams", () => {
  for (const f of ["MaterialIssueDetail", "TransferDetail", "OpnameDetail", "RestokDetail", "RusakDetail", "ReturDetail", "PenyesuaianDetail"]) {
    const s = baca(`features/warehouse/dokumen/${f}.jsx`);
    assert.match(s, /\{ id, onTutup, onBerubah \}/, f); assert.doesNotMatch(s, /PageContainer|useParams|<Link to=\{?["`]\/warehouse\/(material-issue|transfers|stock-count|replenishment|adjustments)/, f);
    assert.match(s, /FokusOverlay|HalamanDokumen/, f);
  }
  assert.match(baca("features/warehouse/dokumen/KartuDokumen.jsx"), /<FokusOverlay open onClose=\{onTutup\}/); assert.doesNotMatch(baca("features/warehouse/dokumen/KartuDokumen.jsx"), /PageContainer/);
  assert.match(baca("features/warehouse/koreksi/KoreksiFokus.jsx"), /HalamanDokumen/); assert.match(baca("features/kedatangan/DetailPOFokus.jsx"), /<FokusOverlay/);
  for (const f of ["MaterialIssueDetail", "TransferDetail"]) assert.match(baca(`features/warehouse/dokumen/${f}.jsx`), /footer=\{kartuAksi\}/, `${f}: bilah aksi tetap terlihat`);
});

test("rute: daftar + /:id? (jendela di atas daftar); Beranda & Perlu Perhatian membawa /:jenis?/:id?; Retur Supplier /:id?", () => {
  const reg = baca("routes/pageRegistry.jsx");
  for (const p of ["/warehouse/material-issue/:id?", "/warehouse/transfers/:id?", "/warehouse/stock-count/:id?", "/warehouse/replenishment/:id?", "/warehouse/adjustments/:jenis?/:id?", "/warehouse/dashboard/:jenis?/:id?", "/warehouse/perlu-perhatian/:jenis?/:id?", "/warehouse/retur-supplier/:id?"]) assert.ok(reg.includes(`"${p}"`), p);
  assert.doesNotMatch(reg, /path: "\/warehouse\/(material-issue|transfers|stock-count|replenishment)\/:id", render/, "tidak ada rute detail terpisah");
  for (const [f, k] of [["WarehouseMaterialIssue", "MaterialIssueDetail"], ["WarehouseTransfers", "TransferDetail"], ["WarehouseStockCount", "OpnameDetail"], ["WarehouseReplenishment", "RestokDetail"]]) {
    const s = baca(`pages/warehouse/${f}.jsx`); assert.match(s, new RegExp(`<${k} key="fokus" id=\\{bukaId\\} onTutup=\\{tutup\\}`), f); assert.match(s, /useJendelaFokus\(/, f); assert.doesNotMatch(s, /openNewTab|window\.open/, f);
  }
  const adj = baca("pages/warehouse/WarehouseAdjustments.jsx"); for (const j of ["damaged", "returns", "stock", "koreksi"]) assert.ok(adj.includes(`jenis === "${j}"`), j);
});

test("Beranda & Perlu Perhatian BACA-SAJA: hanya endpoint GET pusat-kerja; tidak memanggil API tulis; tombol aksi hanya membuka jendela dengan ?aksi=", () => {
  for (const f of ["pages/warehouse/WarehouseDashboard.jsx", "pages/warehouse/WarehousePerluPerhatian.jsx", "features/warehouse/pusatkerja/PencarianGudang.jsx", "features/warehouse/pusatkerja/BagianAntrean.jsx", "features/warehouse/pusatkerja/KartuPekerjaan.jsx"]) {
    const s = baca(f); assert.doesNotMatch(s, /api\.(post|put|patch|delete|update|create|setujui|tolak|batal|kirim|terima|simpan|jalankan|putaway|issue|mulai)\w*\(/i, `${f}: tidak boleh menulis`); assert.doesNotMatch(s, /method: "(POST|PUT|PATCH|DELETE)"/, f);
  }
  const a = baca("api.js"); for (const e of ["getPusatKerja", "getAntreanPusatKerja", "getTertahanPusatKerja", "getPerluPerhatianGudang", "cariGudang"]) assert.match(a, new RegExp(`${e}:[^\\n]*request\\(\`/inventory/pusat-kerja`), e);
  assert.doesNotMatch(a.match(/getPusatKerja:[^\n]*\n/)[0], /method/);
  const k = baca("features/warehouse/pusatkerja/KartuPekerjaan.jsx"); assert.match(k, /onBuka\(item, aksi\.kode\)/); assert.match(k, /\{aksi && \(/, "tombol hanya bila server mengirim aksi (sesuai izin)");
});

test("AksiDokumen: ?aksi= hanya MEMBUKA panel/konfirmasi/formulir atau MENYOROT tombol — tidak pernah menjalankan aksi tanpa panel secara otomatis", () => {
  const s = baca("features/warehouse/aksi/AksiDokumen.jsx");
  assert.match(s, /useSearchParams\(\)/); assert.match(s, /sp\.get\("aksi"\)/); assert.match(s, /aman: true/);
  assert.match(s, /picu\.aman && !spec\[a\.kode\]\?\.panel && !spec\[a\.kode\]\?\.konfirmasi && !AKSI_BUKA_FORMULIR\.includes\(a\.kode\)/); assert.match(s, /setSorot\(a\.kode\)/); assert.match(s, /AKSI_BUKA_FORMULIR = \["CATAT_TIBA", "KOREKSI_KEDATANGAN", "KOREKSI_PENERIMAAN"\]/);
  assert.match(s, /data-sorot=/);
});

test("Beranda: bagian Perlu dikerjakan sekarang / Terlambat atau tertahan / Selesai terbaru; definisi antrean; baca-saja; sisa selalu disebut; jendela di atas Beranda", () => {
  const s = baca("pages/warehouse/WarehouseDashboard.jsx");
  for (const k of ["Perlu dikerjakan sekarang", "Terlambat atau tertahan", "Selesai terbaru", 'data-testid="baca-saja"', 'data-testid="galat-beranda"', 'data-testid="tidak-ada-tugas"', 'data-testid="tidak-ada-tertahan"', "<DokumenFokus", "<PencarianGudang", "tidakDihitung", "bukan SLA"]) assert.ok(s.includes(k), k);
  assert.match(s, /api\.getPusatKerja\(\)/); assert.match(s, /onBerubah=\{\(\) => muat\(true\)\}/, "segarkan tenang setelah jendela memberi kabar");
  const b = baca("features/warehouse/pusatkerja/BagianAntrean.jsx"); assert.match(b, /data-testid="tampilkan-lagi"/); assert.match(b, /data-testid="definisi-antrean"/); assert.match(b, /barisDefinisi/);
});

test("Perlu Perhatian: tiap masalah memuat apa, dampak, cakupan, pemilik, tindakan resmi; jendela fokus di atas halaman; sidebar Kontrol memuat menu", () => {
  const s = baca("pages/warehouse/WarehousePerluPerhatian.jsx");
  for (const k of ['data-testid="apa-masalah"', 'data-testid="dampak-masalah"', 'data-testid="cakupan-masalah"', 'data-testid="pemilik-masalah"', 'data-testid="tindakan-masalah"', "<DokumenFokus", "tidak-ada-masalah"]) assert.ok(s.includes(k), k);
  assert.match(baca("components/Layout.jsx"), /to: "\/warehouse\/perlu-perhatian", label: "Perlu Perhatian"/);
  assert.match(baca("lib/tabTitles.js"), /parts\[1\] === "dashboard"\) return "Gudang · Beranda"/); assert.match(baca("lib/tabTitles.js"), /"perlu-perhatian"\) return "Perlu Perhatian"/);
});

test("mobile: target sentuh ≥ 44px pada kartu/tombol/hasil pencarian; tanpa tabel lebar di Beranda; kartu ringkas dengan [overflow-wrap:anywhere]", () => {
  for (const f of ["features/warehouse/pusatkerja/KartuPekerjaan.jsx", "features/warehouse/pusatkerja/BagianAntrean.jsx", "features/warehouse/pusatkerja/PencarianGudang.jsx"]) assert.match(baca(f), /max-sm:min-h-11/, f);
  assert.match(baca("features/warehouse/pusatkerja/KartuPekerjaan.jsx"), /\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(baca("pages/warehouse/WarehouseDashboard.jsx"), /<Table|<TableWrap/);
});
