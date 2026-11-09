// Redesain tab Marketing gaya Apple (10 Nov 2026; menggantikan penjaga redesain 1 Nov). Penyajian saja: angka, label definisi, tooltip, syarat tampil CPA/ROAS,
// endpoint, hak akses, dan kontrak ekspor tidak berubah. Penjaga ini memastikan makna data tetap terlihat di susunan baru.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kartuRingkas, kolomPilihan, KOLOM_AWAL_SUMBER, KOLOM_SUMBER } from "../src/features/laporan/marketingLogic.js";
import { kategoriSumber, namaKelompok, saringSumber, rupiahRingkas } from "../src/features/laporan/kanalPakem.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const ring = baca("src/features/laporan/components/marketing/RingkasanMarketing.jsx");
const strip = baca("src/features/laporan/components/marketing/StripStatus.jsx");
const tabel = baca("src/features/laporan/components/marketing/TabelSumber.jsx");
const tren = baca("src/features/laporan/components/marketing/TrenLeadChart.jsx");
const kel = baca("src/features/laporan/components/marketing/KelengkapanData.jsx");
const disc = baca("src/features/laporan/components/marketing/Disclosure.jsx");
const mtab = baca("src/features/laporan/components/MarketingTab.jsx");
const halaman = baca("src/pages/Laporan.jsx");
const meta = baca("src/features/laporan/components/marketing/MetaDetail.jsx");
const logic = baca("src/features/laporan/marketingLogic.js");
const cssLama = baca("src/styles/sanss-crm-laporan.css").replace(/\/\*[\s\S]*?\*\//g, "");
const css = baca("src/styles/sanss-mk-apple.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("4 KPI: Total lead (termasuk spam), Customer ber-order, Nilai order (bukan uang diterima), Uang diterima bersih (+ cakupan pembayaran); tooltip dari kartuRingkas", () => {
  for (const f of ['id: "lead"', 'id: "berOrder"', 'id: "nilai"', 'id: "uang"', "termasuk spam", "bukan uang diterima", "cakupan pembayaran", "tip: k.lead.tip", "tip: k.uang.tip"]) assert.ok(ring.includes(f), f);
  const lap = { total: { lead: 100, spam: 8, leadSah: 92, berOrder: 12, lunas: 3, nilaiOrderSaatIni: 1, uangBersih: 1, berbayar: { sumber: ["META"], lengkap: false, belumLengkap: [], spend: null, cpa: null, alasanNull: "SPEND_TIDAK_LENGKAP_PADA_SUMBER_WAJIB" } }, status: { ledger: { orderEligible: 10, orderBerLedger: 8, persen: 80 } } };
  const k = Object.fromEntries(kartuRingkas(lap).map((c) => [c.id, c]));
  assert.equal(k.biaya.nilai, "—"); assert.equal(k.biaya.kosong, true, "biaya tidak lengkap = kosong, bukan Rp0");
  assert.match(k.lead.judul, /termasuk spam/);
});

test("rupiah ringkas: null tetap — (bukan Rp0); jt/M dua desimal; nilai penuh tetap di title", () => {
  assert.equal(rupiahRingkas(null), "—"); assert.equal(rupiahRingkas(undefined), "—");
  assert.equal(rupiahRingkas(0), "Rp0"); assert.equal(rupiahRingkas(118.45), "Rp118");
  assert.equal(rupiahRingkas(98_020_000), "Rp98,02 jt"); assert.equal(rupiahRingkas(1_250_000_000), "Rp1,25 M");
  assert.match(ring, /judulPenuh: rupiah\(t\.nilaiOrderSaatIni\)/);
});

test("strip status: biaya belum lengkap, pembayaran belum lengkap, dan hari berjalan ditulis terpisah; sumber datanya fungsi lama", () => {
  for (const f of ['id: "biaya"', 'id: "bayar"', 'id: "hari"', "ringkasBiayaBerbayar(lap)", "statusMembayar(lap)", "periode?.termasukHariBerjalan", "Hasil masih sementara"]) assert.ok(strip.includes(f), f);
  assert.match(ring, /<StripStatus /);
  assert.doesNotMatch(ring, /AlertRingkas/);
});

test("Kelengkapan data: biaya per sumber, cakupan ledger, hari berjalan; CPA/ROAS hanya DILAPORKAN kosong", () => {
  for (const f of ["statusMembayar(lap)", "ringkasBiayaBerbayar(lap)", "selTotalBerbayar(lap?.total?.berbayar, \"cpa\")", "periode?.termasukHariBerjalan", "Kosong bukan nol", "Belum lengkap", "Tercatat"]) assert.ok(kel.includes(f), f);
  assert.doesNotMatch(kel, /Math\.random|bookedRoas\s*=|cashRoas\s*=/);
  assert.match(ring, /buka=\{bukaKualitas\} onToggle=\{setBukaKualitas\}/);
  assert.match(disc, /buka: bukaLuar, onToggle/);
});

test("Tren lead: seri, definisi, dan sumber data lama dipertahankan", () => {
  assert.match(tren, /daily\.length === 1/);
  assert.match(tren, /rata-rata 7 hari sebelumnya ± 2 standar deviasi/);
  assert.match(tren, /Hari berjalan — belum lengkap/);
});

test("Performa sumber: kolom awal hasil→biaya, kolom lain lewat pilihan; kelompok tetap terpisah; fitur lama dipertahankan", () => {
  assert.deepEqual([...KOLOM_AWAL_SUMBER], ["lead", "berOrder", "nilai", "uang", "spend"]);
  assert.deepEqual(kolomPilihan("ringkas", null).map((k) => k.id), ["lead", "berOrder", "nilai", "uang", "spend"]);
  assert.equal(kolomPilihan("lengkap", ["lead"]).length, KOLOM_SUMBER.length);
  assert.deepEqual(kolomPilihan("ringkas", ["cpa", "lead"]).map((k) => k.id), ["lead", "cpa"], "urutan mengikuti KOLOM_SUMBER");
  assert.deepEqual(kolomPilihan("ringkas", ["tidak-ada"]).map((k) => k.id), [...KOLOM_AWAL_SUMBER]);
  for (const f of ["pilih-urut", "toggle-kolom", "toggle-banding", "onBuka(id)", "kelompokkanSumber(tampil)", "teksSorotan", "Sampel kecil", "baris-total", "selTotal(lap, k.id)", "selSumber(s, k.id", "DASAR_BIAYA_LABEL", "bukan Rp0", "e.stopPropagation()"]) assert.ok(tabel.includes(f), f);
  assert.match(logic, /\{ id: "lead".*\{ id: "berOrder".*\{ id: "lunas".*\{ id: "konversi".*\{ id: "nilai".*\{ id: "uang".*\{ id: "spend".*\{ id: "cpa"/s);
  assert.match(css, /\.mk-ap \.mk-kiri \{ position: sticky; left: 0/);
  assert.match(css, /\.mk-ap \.mk-gulir \{ overflow-x: auto/);
});

test("label sumber: tanpa jejak = sumber belum diketahui, Website tidak otomatis organik; saringan hanya tampilan", () => {
  assert.match(kategoriSumber("WHATSAPP"), /^Sumber belum diketahui/);
  assert.doesNotMatch(kategoriSumber("WHATSAPP"), /organik/i);
  assert.doesNotMatch(kategoriSumber("WEBSITE"), /^Organik/i);
  assert.equal(namaKelompok("Tanpa jejak"), "Sumber belum diketahui");
  assert.equal(namaKelompok("Iklan berbayar"), "Iklan berbayar");
  const baris = [{ id: "META", label: "Meta Ads", kelompok: "Iklan berbayar", lead: 5 }, { id: "WHATSAPP", label: "WhatsApp tanpa jejak", kelompok: "Tanpa jejak", lead: 0 }];
  assert.deepEqual(saringSumber(baris, { saring: "berbayar" }).map((s) => s.id), ["META"]);
  assert.deepEqual(saringSumber(baris, { saring: "lain" }).map((s) => s.id), ["WHATSAPP"]);
  assert.deepEqual(saringSumber(baris, { sembunyikanKosong: true }).map((s) => s.id), ["META"]);
  assert.deepEqual(saringSumber(baris, { cari: "whats" }).map((s) => s.id), ["WHATSAPP"]);
  assert.equal(saringSumber(baris).length, 2);
});

test("Marketing: endpoint, periode, hak akses tidak berubah; satu menu Ekspor memuat tiga format lama; aksi di header", () => {
  for (const f of ["api.getAtribusiSumber", "api.getAtribusiIklan", "periodeTab(range, hariIni)", "Laporan Marketing hanya untuk ADMIN", "berurutan(", "unduhEksporMarketing({ dari: periode.dari, sampai: periode.sampai })", "buatCsvAkuisisi(lap, { urut: url.urut })"]) assert.ok(mtab.includes(f), f);
  for (const f of ['data-testid="kelola-biaya"', 'data-testid="menu-ekspor"', 'data-testid="ekspor-excel-marketing"', 'data-testid="ekspor-laporan-marketing"', 'data-testid="ekspor-sumber"', "handleExport()", 'aria-label="Muat ulang"', "onAksi={setAksiMk}"]) assert.ok(halaman.includes(f), f);
});

test("rincian Meta: judul ikut tampilan Per kreatif; penjelasan teknis di bagian yang dapat dibuka; ID tetap bisa disalin", () => {
  assert.match(meta, /perKreatif \? "Per kreatif"/);
  assert.match(meta, /id="bantuan-meta"/);
  assert.match(meta, /function SalinId/);
  for (const f of ["Ber-order ≠ membayar ≠ lunas", "UNMAPPED dan UNKNOWN tidak dikreditkan", "panel-${id}", "Impor spend", "Target KPI", "Monitoring"]) assert.ok(meta.includes(f), f);
});

test("gaya dibatasi ke Marketing: berkas terpisah dimuat dari MarketingTab; stylesheet Laporan lama tidak berubah aturannya", () => {
  assert.match(mtab, /import "@\/styles\/sanss-mk-apple\.css"/);
  assert.doesNotMatch(baca("src/main.jsx"), /sanss-mk-apple/);
  const aturan = css.split("}").map((r) => r.trim()).filter((r) => r.includes("{")).map((r) => r.split("{").slice(-2, -1)[0] ?? r.split("{")[0]).map((x) => x.trim()).filter((sel) => sel && !sel.startsWith("@"));
  const pecah = (sel) => { const out = []; let d = 0, cur = ""; for (const ch of sel) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
  for (const sel of aturan) for (const bagian of pecah(sel)) assert.match(bagian, /mk-ap|data-mk-ap/, `selektor tidak dibatasi: ${bagian}`);
  assert.doesNotMatch(cssLama, /font-family/);
  assert.doesNotMatch(cssLama, /!important/);
});
