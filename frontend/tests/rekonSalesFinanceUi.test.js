// REKONSILIASI SALES–FINANCE (30 Sep 2026) — kunci kontrak UI: label & tooltip sesuai keputusan Owner, angka SELALU dari server (tidak dihitung ulang di
// frontend), kartu terpisah, drill-down dengan tiga nilai jasa/ongkir/tagihan, dan Export Excel memakai payload server yang sama dengan layar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").split("\r\n").join("\n");
const tab = baca("src/features/laporan/components/SalesReportTab.jsx");
const rekon = baca("src/features/laporan/components/RekonSalesFinance.jsx");
const api = baca("src/api.js");
const ekspor = baca("src/utils/exportLaporan.js");
const laporan = baca("src/pages/Laporan.jsx");

test("Label & tooltip kartu: 'Nilai Order yang Menjadi Lunas' dengan tooltip persis dari Owner; label lama hilang", () => {
  assert.match(tab, /label="Nilai Order yang Menjadi Lunas"/);
  assert.doesNotMatch(tab, /label="Nilai Lunas Tim"/);
  assert.ok(tab.includes("Nilai penuh order yang mencapai lunas pada periode ini. Tidak selalu sama dengan uang masuk periode karena DP, ongkir, dan pembayaran lintas periode."));
});

test("Empat kartu terpisah + panel bridge terpasang di tab Sales", () => {
  for (const label of ["Uang Masuk Terverifikasi dari Order", "DP Belum Lunas", "Ongkir Diterima", "Tanpa Atribusi Sales"]) assert.ok(rekon.includes(`label: "${label}"`), `kartu "${label}" tidak ada`);
  assert.match(tab, /<KartuRekon /);
  assert.match(tab, /<PanelRekon /);
  assert.match(tab, /<DaftarRekonModal /);
});

test("Angka bridge dari SERVER: komponen tidak menjumlah/menghitung ulang (tanpa reduce atas nominal bridge); memakai api.getRekonSalesFinance", () => {
  assert.match(rekon, /api\.getRekonSalesFinance\(/);
  assert.match(api, /getRekonSalesFinance: \(params\) => request\("\/sales-finance\/rekon"/);
  // satu-satunya reduce di komponen adalah subtotal tampilan daftar (jumlah baris yang SUDAH dikirim server), bukan bridge
  const bagianBridge = rekon.slice(rekon.indexOf("export function PanelRekon"), rekon.indexOf("const JUDUL_DETAIL"));
  assert.doesNotMatch(bagianBridge, /\.reduce\(/, "PanelRekon tidak boleh menghitung ulang");
  assert.match(bagianBridge, /data\.bridge\.map/);
  assert.match(bagianBridge, /data\.residual/);
});

test("Drill-down: tiga nilai terpisah (jasa/ongkir/total tagihan), pembayaran per order, multi-order pelanggan dikelompokkan tanpa digabung, tautan ke order", () => {
  for (const kolom of ["Nilai Jasa", "Ongkir", "Total Tagihan"]) assert.ok(rekon.includes(kolom), `kolom ${kolom}`);
  assert.match(rekon, /data terpisah, tidak digabung/);
  assert.match(rekon, /navigate\(`\/orders\?id=\$\{b\.orderId\}`\)/);
  assert.match(rekon, /b\.pembayaran/);
});

test("Tanpa Sales: penugasan ulang hanya Admin, alasan wajib; klik baris hanya bila server mengirim detail", () => {
  assert.match(rekon, /kunci === "TANPA_SALES" && admin/);
  assert.match(rekon, /!tetapkan\.alasan\.trim\(\)/);
  assert.match(rekon, /data\?\.detailTersedia/);
  assert.match(api, /tetapkanPemilikSalesOrder: \(orderId, body\) => request\(`\/sales-finance\/orders\/\$\{orderId\}\/pemilik`, \{ method: "POST"/);
});

test("Export Excel: sheet Rekonsiliasi memakai payload server yang sama dengan layar (rekonSales diteruskan dari tab)", () => {
  assert.match(tab, /onExport\(\{ rekonSales: rekon\.data \}\)/);
  assert.match(laporan, /extra\.rekonSales/);
  assert.match(laporan, /salesReport, traffic, sourceDetail, rekonSales/);
  assert.match(ekspor, /\["Rekonsiliasi", d\.rekonSales && sheetRekon\(d\)\]/);
  assert.match(ekspor, /rekonSales\.bridge/);
  assert.match(ekspor, /rekonSales\.detail\[b\.kunci\]/);
});

test("Bridge: tanda tampilan = EFEK (tanda × jumlah) — langkah 'kurangi' berjumlah negatif (Selisih Nominal Lain) tampil '+', bukan '−'; Excel memakai arah & jumlah mutlak yang sama", () => {
  assert.match(rekon, /const efek = b\.tanda \* b\.jumlah;/);
  assert.match(rekon, /efek < 0 \? "−" : "\+"/);
  assert.match(ekspor, /b\.tanda \* b\.jumlah < 0 \? "Kurangi" : "Tambah"/);
  assert.match(ekspor, /Math\.abs\(b\.jumlah\)/);
});

test("Drill-down: layar sempit memakai daftar kartu per order (tabel 6 kolom terpotong di 390px); angka negatif ditulis '−Rp…' (bukan 'Rp-…')", () => {
  assert.match(rekon, /data-testid="rekon-kartu-mobile"/);
  assert.match(rekon, /hidden max-h-\[60vh\] overflow-auto sm:block/);
  assert.match(rekon, /sm:hidden/);
  assert.match(rekon, /const rpBertanda = \(n\) => \(n < 0 \?/);
  assert.doesNotMatch(rekon, /description=\{kunci \? `\$\{baris\.length\} order · \$\{formatRupiah\(/, "deskripsi modal memakai rpBertanda");
});
