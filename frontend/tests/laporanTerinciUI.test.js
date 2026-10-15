// LAPORAN KEUANGAN TERINCI (UI) — logika murni (label, penanda mutu, parameter drilldown, body export) + penjagaan sumber JSX (tanpa jsdom, pola sama financeExportCoverage.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  METRIK_KARTU, LABEL_METRIK, SEKSI, TAB_DRILLDOWN, penandaMutu, formatCutoff, tanggalPanjang, ringkasKontrol, paramDrilldown, bodyExport, gayaLangkah, pecahJembatan, penandaDivisi, bisaDrilldown, labelSumber,
} from "../src/features/finance/laporanTerinci/logic.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (rel) => fs.readFileSync(path.join(akar, rel), "utf8");

test("penanda mutu margin: BELUM_LENGKAP memakai kalimat baku; LENGKAP hijau & final; TIDAK_BERLAKU netral; status asing tidak dianggap final", () => {
  const b = penandaMutu({ status: "BELUM_LENGKAP", pesan: "x" });
  assert.equal(b.label, "HPP bahan belum lengkap — margin belum final"); assert.equal(b.varian, "orange"); assert.equal(b.final, false);
  const l = penandaMutu({ status: "LENGKAP", pesan: "y" }); assert.equal(l.varian, "green"); assert.equal(l.final, true);
  assert.equal(penandaMutu({ status: "TIDAK_BERLAKU" }).final, false); assert.equal(penandaMutu({ status: "TIDAK_BERLAKU" }).varian, "neutral");
  assert.equal(penandaMutu({ status: "ENTAH" }).final, false); assert.equal(penandaMutu(null).final, false);
});

test("lima kartu, enam seksi, tiga tab drilldown — urutan dan label stabil", () => {
  assert.deepEqual(METRIK_KARTU, ["pendapatan", "hpp", "laba_kotor", "beban_operasional", "laba_bersih"]);
  assert.deepEqual(SEKSI.map((s) => s.key), ["laporan", "jembatan", "pkr", "hpp", "divisi", "gap"]);
  assert.deepEqual(TAB_DRILLDOWN.map((t) => t.key), ["akun", "jurnal", "divisi"]);
  assert.equal(LABEL_METRIK.hpp, "Beban Pokok (HPP)");
});

test("cutoff tercetak apa adanya dari server (WIB), dan periode yang melewati buku diberi tahu", () => {
  assert.equal(formatCutoff({ diambilPadaWib: "2026-10-15 08:32:04", tanggalBukuTerakhir: "2026-10-14", periodeMelewatiBuku: false }), "Data dibaca 15 Okt 2026 08.32 WIB · buku terakhir 14 Okt 2026");
  assert.match(formatCutoff({ diambilPadaWib: "2026-10-15 08:32:04", tanggalBukuTerakhir: "2026-10-14", periodeMelewatiBuku: true }), /periode melewati data buku/);
  assert.equal(formatCutoff(null), ""); assert.equal(tanggalPanjang("2026-01-05"), "5 Jan 2026"); assert.equal(tanggalPanjang(null), "");
});

test("kontrol parity: OK hanya bila semua OK; gagal menyebut labelnya; kosong ≠ OK", () => {
  assert.deepEqual(ringkasKontrol({ daftar: [{ ok: true, label: "a" }, { ok: true, label: "b" }] }), { ok: true, jumlah: 2, gagal: [] });
  assert.deepEqual(ringkasKontrol({ daftar: [{ ok: true, label: "a" }, { ok: false, label: "b" }] }).gagal, ["b"]);
  assert.equal(ringkasKontrol({ daftar: [] }).ok, false); assert.equal(ringkasKontrol(undefined).ok, false);
});

test("parameter drilldown & body export membawa periode, filter aktif, dan cutoff layar; filter kosong dibuang", () => {
  const p = { from: "2026-10-01", to: "2026-10-15" };
  assert.deepEqual(paramDrilldown(p, "hpp", { akun: "5-1150", q: "  kain " }), { from: "2026-10-01", to: "2026-10-15", metrik: "hpp", akun: "5-1150", divisi: "", sumber: "", q: "kain" });
  const b = bodyExport(p, { metrik: "hpp", filter: { akun: "5-1150", divisi: "", q: "" }, cutoff: { diambilPadaWib: "2026-10-15 08:32:04" } });
  assert.deepEqual(b.periode, p); assert.deepEqual(b.filter, { metrik: "hpp", akun: "5-1150", cutoffLayar: "2026-10-15 08:32:04" });
  assert.equal(b.filterLabel, "Metrik: Beban Pokok (HPP); Akun: 5-1150");
  const polos = bodyExport(p); assert.deepEqual(polos.filter, {}); assert.equal(polos.filterLabel, "");
});

test("jembatan: gaya baris (subtotal/temuan/kurang/biasa) & pemisahan sisi Sales vs Buku Besar; penanda divisi khusus", () => {
  assert.equal(gayaLangkah({ subtotal: true, nominal: 5 }), "subtotal"); assert.equal(gayaLangkah({ temuan: true, nominal: -1 }), "temuan");
  assert.equal(gayaLangkah({ nominal: -1 }), "kurang"); assert.equal(gayaLangkah({ nominal: 1 }), "biasa");
  const { sales, ledger } = pecahJembatan([{ bagian: "SALES", kunci: "a" }, { bagian: "LEDGER", kunci: "b" }, { bagian: "SALES", kunci: "c" }]);
  assert.deepEqual([sales.length, ledger.length], [2, 1]);
  assert.equal(penandaDivisi("TIDAK_TERKLASIFIKASI").label, "Belum teratribusi"); assert.equal(penandaDivisi("SHARED").label, "Biaya bersama"); assert.equal(penandaDivisi("DELIVERY"), null);
  assert.equal(labelSumber("PENGAKUAN_PENDAPATAN"), "Pengakuan pendapatan"); assert.equal(labelSumber("SUMBER_BARU"), "sumber baru");
  assert.equal(bisaDrilldown({ kartu: [1, 2, 3, 4, 5] }), true); assert.equal(bisaDrilldown({ kartu: [] }), false); assert.equal(bisaDrilldown(null), false);
});

test("SUMBER: halaman Laporan Keuangan — lima kartu bisa diklik, penanda mutu di kartu margin, tombol export modul laporan-keuangan membawa filter+cutoff, panel semua seksi terpasang", () => {
  const s = baca("src/pages/finance/FinanceReports.jsx");
  for (const m of ["pendapatan", "hpp", "laba_kotor", "beban_operasional", "laba_bersih"]) assert.match(s, new RegExp(`onClick=\\{buka\\("${m}"\\)\\}`), `kartu ${m} harus membuka drilldown`);
  assert.match(s, /<TombolExportExcel[^>]*modul="laporan-keuangan"/s); assert.match(s, /ambilBody=\{\(\) => bodyExport\(periode, \{ cutoff: terinci\?\.cutoff \}\)\}/);
  assert.match(s, /data-testid="penanda-mutu-margin"/); assert.match(s, /<DrilldownKartu/);
  for (const k of ["PanelJembatan", "PanelPkr", "PanelHpp", "PanelBeban", "PanelGap"]) assert.match(s, new RegExp(`<${k} data=\\{terinci\\}`), `${k} belum terpasang`);
  assert.match(s, /catch \(e\) \{ setTerinci\(null\)/, "kegagalan rincian tidak boleh merusak laporan baku");
});

test("SUMBER: drilldown menampilkan Σ baris = kartu, memakai endpoint baca-saja, tidak menghitung ulang angka di klien (hanya menjumlah baris yang tampil untuk label filter)", () => {
  const d = baca("src/features/finance/laporanTerinci/DrilldownKartu.jsx");
  assert.match(d, /Σ baris = kartu/); assert.match(d, /TIDAK cocok dengan kartu/); assert.match(d, /api\.getFinanceLaporanDrilldown/); assert.match(d, /modul="laporan-keuangan"/);
  assert.doesNotMatch(d, /dangerouslySetInnerHTML/);
  const api = baca("src/api.js");
  assert.match(api, /getFinanceLaporanTerinci: \(params = \{\}\) => request\(`\/finance\/reports\/income-statement\/terinci\$\{qsFinance\(params\)\}`\)/);
  assert.match(api, /getFinanceLaporanDrilldown: \(params = \{\}\) => request\(`\/finance\/reports\/income-statement\/drilldown\$\{qsFinance\(params\)\}`\)/);
  for (const f of ["PanelPendapatan.jsx", "PanelHppBeban.jsx", "PanelGap.jsx"]) {
    const p = baca(`src/features/finance/laporanTerinci/${f}`);
    assert.doesNotMatch(p, /api\.(post|put|patch|delete)|method: "(POST|PUT|PATCH|DELETE)"/i, `${f}: panel laporan tidak boleh menulis`);
    assert.doesNotMatch(p, /dangerouslySetInnerHTML/);
  }
});

test("SUMBER: kartu margin menampilkan estimasi/tak-terbukti TERPISAH dan menyatakan tidak masuk laba; gap membedakan BELUM_BERHARGA vs PKR Rp0", () => {
  const h = baca("src/features/finance/laporanTerinci/PanelHppBeban.jsx");
  assert.match(h, /Terbukukan — ikut laba/); assert.match(h, /Belum dapat dibuktikan — tidak ikut laba, bukan Rp0/); assert.match(h, /Estimasi informatif — TIDAK masuk laba atau jurnal/);
  const g = baca("src/features/finance/laporanTerinci/PanelGap.jsx");
  assert.match(g, /BELUM_BERHARGA/); assert.match(g, /tidak ada tombol yang memposting jurnal dari sini/);
});
