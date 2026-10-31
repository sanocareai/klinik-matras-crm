import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PENANDA_CADANGAN, penandaDari, adalahPembalik, ringkasPembalik, subKartuBiaya, barisLabaRugi, barisGrafikLabaRugi, labelSaldoTerbalik, pesanNeracaTakSeimbang, ringkasDrilldown,
} from "../src/features/finance/biayaNetoLogic.js";

// Audit tanda laporan Finance (23 Okt 2026): akun biaya bersaldo kredit bersih = "pembalik beban bersih" (kurung + label), bukan biaya biasa. Murni penyajian — nilai tidak diubah.
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
const baca = (p) => readFileSync(path.join(SRC, p), "utf8").replace(/\r\n/g, "\n");
const rp = (n) => `Rp${Math.abs(n).toLocaleString("id-ID")}`;
const penanda = penandaDari({});

test("penandaDari memakai penanda server bila ada, cadangan bila server lama", () => {
  assert.equal(penandaDari({}).pembalikBebanBersih.label, "Pembalik beban bersih");
  const server = { penanda: { pembalikBebanBersih: { label: "X", penjelasan: "Y" } } };
  assert.equal(penandaDari(server).pembalikBebanBersih.label, "X");
  assert.equal(penandaDari(server).rumusLaba, PENANDA_CADANGAN.rumusLaba, "rumus tetap dari cadangan bila server tidak mengirim");
});

test("beban bersaldo kredit: nilai TIDAK dibalik tandanya (tampil apa adanya, negatif) dan diberi label; beban debit tanpa label", () => {
  const pembalik = barisLabaRugi({ nilai: -11_372_248 }, "beban", penanda);
  assert.equal(pembalik.nilaiTampil, -11_372_248); assert.equal(pembalik.label, "Pembalik beban bersih");
  const biasa = barisLabaRugi({ nilai: 2_600_000 }, "beban", penanda);
  assert.equal(biasa.nilaiTampil, 2_600_000); assert.equal(biasa.label, null);
  assert.equal(barisLabaRugi({ nilai: 0 }, "beban", penanda).label, null, "nol bukan pembalik");
});

test("retur tampil sebagai pengurang; retur bersaldo kredit ditandai pembalik retur", () => {
  assert.deepEqual(barisLabaRugi({ nilai: 30_000 }, "retur", penanda), { nilaiTampil: -30_000, label: null });
  assert.equal(barisLabaRugi({ nilai: -30_000 }, "retur", penanda).label, "Pembalik retur bersih");
});

test("ringkasan pembalik & sub-kartu: hanya muncul bila ada pembalik", () => {
  assert.deepEqual(ringkasPembalik({ pembalikBebanPokok: -11_372_248, pembalikBebanOperasional: 0 }), { pokok: -11_372_248, operasional: 0, ada: true });
  assert.equal(ringkasPembalik({}).ada, false);
  assert.match(subKartuBiaya(-700_000, (v) => `(${rp(v)})`), /pembalik beban bersih.*mengurangi biaya, menaikkan laba/i);
  assert.equal(subKartuBiaya(0, rp), null); assert.equal(subKartuBiaya(5, rp), null);
  assert.equal(adalahPembalik(-1), true); assert.equal(adalahPembalik(0), false);
});

test("grafik: batang pembalik hijau + label; laba tetap bertanda apa adanya", () => {
  const g = barisGrafikLabaRugi({ pendapatanBersih: 20_000_000, bebanPokok: 3_790_752, bebanOperasional: -700_000, labaBersih: 16_909_248 }, penanda);
  const by = Object.fromEntries(g.map((b) => [b.name, b]));
  assert.equal(by["Beban Pokok"].label, null); assert.equal(by["Beban Pokok"].value, 3_790_752);
  assert.equal(by["Beban Operasional"].label, "Pembalik beban bersih"); assert.equal(by["Beban Operasional"].value, -700_000); assert.equal(by["Beban Operasional"].color, "var(--green)");
  assert.equal(by["Laba Bersih"].value, 16_909_248);
});

test("Neraca Saldo: saldo terbalik diberi penjelasan; pesan Neraca tidak menebak penyebab tunggal", () => {
  assert.match(labelSaldoTerbalik({ saldoTidakNormal: true, normalBalance: "DEBIT" }), /berlawanan dengan saldo normal debit/);
  assert.equal(labelSaldoTerbalik({ saldoTidakNormal: false }), null);
  const p = pesanNeracaTakSeimbang(1_000, rp);
  assert.match(p.isi, /belum bisa dipastikan/i);
  assert.ok(p.langkah.length >= 3);
  assert.doesNotMatch(JSON.stringify(p), /karena (laba|saldo awal) /i, "tidak menyatakan satu penyebab pasti");
});

test("drilldown: label parsial jelas bila daftar dipotong; total dari SEMUA baris", () => {
  const penuh = ringkasDrilldown({ jumlah: 3, jumlahDitampilkan: 3, baris: [1, 2, 3], terpotong: false });
  assert.equal(penuh.parsial, false); assert.match(penuh.labelDaftar, /semua 3 baris/i);
  const parsial = ringkasDrilldown({ jumlah: 9_500, jumlahDitampilkan: 8_000, baris: new Array(8_000), terpotong: true });
  assert.equal(parsial.parsial, true); assert.equal(parsial.tampil, 8_000); assert.equal(parsial.jumlah, 9_500);
  assert.match(parsial.labelDaftar, /8\.000 dari 9\.500.*SEMUA 9\.500/s);
});

test("wiring: semua layar biaya memakai penyajian pembalik, tidak ada lagi pembalikan tanda -row.nilai untuk beban", () => {
  const lr = baca("pages/finance/FinanceReports.jsx");
  assert.match(lr, /kotak-pembalik-lr/); assert.match(lr, /grafik-pembalik/); assert.match(lr, /neraca-tak-seimbang/); assert.match(lr, /saldo-terbalik/);
  assert.match(lr, /Total Beban Pokok \(neto\)/); assert.match(lr, /Total Beban Operasional \(neto\)/);
  assert.doesNotMatch(lr, /-row\.nilai/, "tanda beban tidak boleh dibalik di tampilan");
  assert.doesNotMatch(lr, /<TD truncate>\{b\.name\}\{b\.saldoTidakNormal/, "penanda 'Saldo terbalik' tidak boleh terpotong oleh truncate pada nama akun panjang");
  assert.match(baca("features/finance/biayaNeto.jsx"), /text-green/, "nominal pembalik hijau (menaikkan laba), bukan merah");
  const dash = baca("pages/finance/FinanceDashboard.jsx");
  assert.match(baca("features/finance/RingkasanPanels.jsx"), /kotak-pembalik-dashboard/); assert.match(dash, /labaRugiPenanda/);
  assert.doesNotMatch(dash, /-\(lr\.bebanPokok\)|-lr\.bebanPokok|-\(lr\.bebanOperasional\)/);
  const hpp = baca("features/finance/laporanTerinci/PanelHppBeban.jsx");
  assert.match(hpp, /kotak-pembalik-hpp/); assert.match(hpp, /kotak-pembalik-divisi/); assert.match(hpp, /UangBiaya/);
  const dd = baca("features/finance/laporanTerinci/DrilldownKartu.jsx");
  assert.match(dd, /kotak-pembalik-drilldown/); assert.match(dd, /drill-parsial/);
  assert.doesNotMatch(dd, /data\.baris\.filter/, "filter drilldown dikirim ke server, bukan disaring di klien dari daftar terpotong");
  assert.match(dd, /paramDrilldown\(periode, metrik, \{ \.\.\.f, q: kata \}\)/);
  const div = baca("features/laporanDivisi/LaporanDivisi.jsx");
  assert.match(div, /kotak-pembalik-laporan-divisi/); assert.match(div, /AktualBeban/);
});
