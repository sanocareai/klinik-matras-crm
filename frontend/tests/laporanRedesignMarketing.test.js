// Redesain Laporan — tab Marketing (1 Nov 2026). Penyajian saja: angka, label, tooltip, syarat tampil CPA/ROAS, endpoint, dan hak akses tidak berubah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kartuRingkas } from "../src/features/laporan/marketingLogic.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const ring = baca("src/features/laporan/components/marketing/RingkasanMarketing.jsx");
const tabel = baca("src/features/laporan/components/marketing/TabelSumber.jsx");
const tren = baca("src/features/laporan/components/marketing/TrenLeadChart.jsx");
const kel = baca("src/features/laporan/components/marketing/KelengkapanData.jsx");
const disc = baca("src/features/laporan/components/marketing/Disclosure.jsx");
const mtab = baca("src/features/laporan/components/MarketingTab.jsx");
const logic = baca("src/features/laporan/marketingLogic.js");
const css = baca("src/styles/sanss-crm-laporan.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("KPI utama = Total lead, Customer ber-order, Nilai order, Uang diterima bersih; pendukung = lunas ledger, biaya iklan, cakupan; label/tooltip dari kartuRingkas (tidak ditulis ulang)", () => {
  assert.match(ring, /KPI_UTAMA = \[\{ id: "lead".*\{ id: "berOrder".*\{ id: "nilai".*\{ id: "uang"/s);
  assert.match(ring, /k\.lunas &&/); assert.match(ring, /k\.biaya &&/); assert.match(ring, /testid: "kartu-cakupan"/);
  assert.match(ring, /label=\{c\.judul\}.*tooltip=\{c\.tip\}/s);
  assert.match(ring, /catatan: k\.lunas\.catatan/);
  const lap = { total: { lead: 100, spam: 8, leadSah: 92, berOrder: 12, membayar: 5, lunas: 3, nilaiOrderSaatIni: 1, uangBersih: 1, berbayar: { sumber: ["META"], lengkap: false, belumLengkap: [], spend: null, cpa: null, alasanNull: "SPEND_TIDAK_LENGKAP_PADA_SUMBER_WAJIB" } }, status: { ledger: { orderEligible: 10, orderBerLedger: 8, persen: 80 } } };
  const k = Object.fromEntries(kartuRingkas(lap).map((c) => [c.id, c]));
  assert.equal(k.biaya.nilai, "—"); assert.equal(k.biaya.kosong, true, "biaya tidak lengkap = kosong, bukan Rp0");
  assert.match(k.lunas.catatan, /Cakupan ledger/);
  assert.match(k.lead.judul, /termasuk spam/);
});

test("Kelengkapan Data: ringkasan ledger/biaya/hari berjalan + rincian; CPA/ROAS hanya DILAPORKAN kosong, syaratnya tidak diubah", () => {
  for (const f of ["Kelengkapan Data", "statusMembayar(lap)", "ringkasBiayaBerbayar(lap)", "selTotalBerbayar(lap?.total?.berbayar, \"cpa\")", "periode?.termasukHariBerjalan", "CPA dan ROAS belum ditampilkan", "Kosong bukan nol", "Lihat rincian"]) assert.ok(kel.includes(f), f);
  assert.doesNotMatch(kel, /Math\.random|\* 100\)|bookedRoas\s*=|cashRoas\s*=/);
  // rincian lengkap = bagian Kualitas data (terkendali dari luar), bukan salinan baru
  assert.match(ring, /buka=\{bukaKualitas\} onToggle=\{setBukaKualitas\}/);
  assert.match(disc, /buka: bukaLuar, onToggle/);
  assert.match(disc, /bukaAwal = false/);
});

test("Tren lead: satu titik = nilai bertanggal tanpa grafik; kosong ringkas; definisi lengkap tetap (tooltip); sumber data sama", () => {
  assert.match(tren, /daily\.length === 1/);
  assert.match(tren, /data-testid="tren-satu-titik"/);
  assert.match(tren, /Periode satu hari: tidak ada tren/);
  assert.match(tren, /crm-mk-tren--ringkas/);
  assert.match(tren, /rata-rata 7 hari sebelumnya ± 2 standar deviasi/);
  assert.match(tren, /Hari berjalan — belum lengkap/);
  assert.match(css, /\.crm-mk-tren\.crm-mk-tren--ringkas \{ align-self: start; \}/);
  assert.match(css, /container-name: laptab|@container laptab \(min-width: 900px\)[^}]*crm-lap-baris--tren/);
});

test("Performa Sumber: kolom urut hasil→biaya, angka rata kanan, sticky Sumber, gulir internal; fitur lama dipertahankan", () => {
  for (const f of ["pilih-urut", "toggle-kolom", "toggle-banding", "ekspor-sumber", "onEkspor", "onBuka(id)", "BUKTI_LABEL", "Sampel kecil", "teksSorotan(p)", "baris-total", "selTotal(lap, k.id)", "selSumber(s, k.id", "DASAR_BIAYA_LABEL", "aria-pressed={bandingkan}"]) assert.ok(tabel.includes(f), f);
  assert.doesNotMatch(tabel, /KartuSumber/);
  assert.match(css, /\.crm-mk-sel \{ text-align: right/);
  assert.match(css, /\.crm-mk-tabel \.crm-mk-kiri \{ position: sticky; left: 0/);
  assert.match(css, /\.crm-ss-gulir \{ overflow-x: auto/);
  assert.match(logic, /\{ id: "lead".*\{ id: "berOrder".*\{ id: "lunas".*\{ id: "konversi".*\{ id: "nilai".*\{ id: "uang".*\{ id: "spend".*\{ id: "cpa"/s);
});

test("Marketing: endpoint, periode, hak akses, dan ekspor tidak berubah; font tetap Manrope", () => {
  for (const f of ["api.getAtribusiSumber", "api.getAtribusiIklan", "periodeTab(range, hariIni)", "Laporan Marketing hanya untuk ADMIN", "kelola-biaya", "berurutan("]) assert.ok(mtab.includes(f), f);
  assert.doesNotMatch(css, /font-family/);
  assert.doesNotMatch(css, /!important/);
});
