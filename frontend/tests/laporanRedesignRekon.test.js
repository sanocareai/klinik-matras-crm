// Redesain Rekonsiliasi Sales–Finance (tab Sales, 1 Nov 2026): penyajian saja — angka, status, rumus, ambang, periode tetap dari server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const rekon = baca("src/features/laporan/components/RekonSalesFinance.jsx");
const tab = baca("src/features/laporan/components/SalesReportTab.jsx");
const kontrak = baca("src/features/finance/kontrak.jsx");
const css = baca("src/styles/sanss-crm-laporan.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("Panel: judul, subjudul, dua status terpisah dari kondisi server; selisih Rp0 tidak otomatis 'tanpa masalah'", () => {
  for (const f of ["Rekonsiliasi Sales–Finance", "Hubungkan pembayaran masuk dengan nilai order lunas dan atribusi tim.", "Perhitungan cocok (kedua tahap)", "Perhitungan tidak cocok", "Perlu ditinjau", "Tidak ada yang perlu ditinjau"]) assert.ok(rekon.includes(f), f);
  assert.match(rekon, /data\?\.status\?\.perhitungan === "COCOK"/);
  assert.match(rekon, /data\?\.status\?\.perluDitinjau/);
  assert.match(rekon, /data-testid="rekon-temuan"/, "ringkasan temuan terlihat saat perhitungan dilipat");
});

test("Alur tiga angka memakai sumber lama (kartu server), label tidak diganti omzet/pendapatan; ikon SVG duotone keluarga yang ada", () => {
  for (const f of ["k?.uangMasukDariOrder", "k?.totalPerusahaan", "k?.nilaiLunasSales", "Uang masuk terverifikasi", "Order lunas perusahaan", "Order lunas tim Sales", "IkonDompet", "IkCentang", "IkonOrang"]) assert.ok(rekon.includes(f), f);
  assert.doesNotMatch(rekon, /Omzet|Pendapatan/);
  assert.match(css, /@container laptab \(min-width: 900px\)[^}]*\.crm-rk-alur/s);
});

test("Dua tahap lipat: tertutup = nama, selisih, tombol; terbuka = awal, penyesuaian, hasil, pembanding, selisih+status; Rp0 dilipat; aksesibel keyboard", () => {
  for (const f of ["Lihat perhitungan", "Tutup perhitungan", "Tampilkan komponen Rp0", "Sembunyikan komponen Rp0", "hasil perhitungan", "pembanding langsung", "Selisih perhitungan", "Pembayaran → Order lunas perusahaan", "Perusahaan → Tim Sales", "aria-expanded={buka}", "aria-controls={id}"]) assert.ok(rekon.includes(f), f);
  assert.match(rekon, /const efek = b\.tanda \* b\.jumlah;/); assert.match(rekon, /efek < 0 \? "−" : "\+"/);
  assert.match(rekon, /t\.komponenLain\?\.daftar/);
  assert.match(rekon, /<button type="button" className="crm-rk-tahap-kepala"/, "tombol native (Enter/Spasi)");
  assert.doesNotMatch(rekon.slice(rekon.indexOf("function TahapRekon"), rekon.indexOf("const JUDUL_DETAIL")), /\.reduce\(/, "tidak menghitung ulang");
});

test("Empat kartu lama dilebur tanpa kehilangan tooltip/subjudul/klik; 'Kenapa angkanya berbeda?' dipindah ke panel dengan isi lama (IsiKenapaBeda dibagi dengan Finance)", () => {
  for (const f of ["Payment terverifikasi yang diterima di periode ini", "Uang muka/DP terverifikasi untuk order yang belum lunas", "Bagian Payment yang menutup ongkir", "TIDAK diberikan ke Sales secara tebakan"]) assert.ok(rekon.includes(f), f);
  assert.match(rekon, /onBuka\("UANG_MASUK"\)/);
  assert.match(rekon, /<IsiKenapaBeda metrik=\{METRIK_KENAPA\} \/>/);
  assert.match(rekon, /"uang_masuk_terverifikasi", "klaim_lunas_menunggu", "order_lunas_terverifikasi", "nilai_order_lunas_perusahaan", "nilai_lunas_tim_sales", "tanpa_atribusi_sales"/);
  assert.doesNotMatch(tab, /<KenapaBeda|<KartuRekon/);
  assert.match(kontrak, /export function IsiKenapaBeda/);
  assert.match(kontrak, /<IsiKenapaBeda metrik=\{metrik\} from=\{from\} to=\{to\} denganJembatan=\{denganJembatan\} \/>/, "KenapaBeda (Finance) memakai isi yang sama");
  assert.match(rekon, /Nilai order lunas bukan metrik yang sama dengan uang masuk/);
});

test("Akses rincian order tidak berubah: modal + tetapkan Sales hanya Admin tetap ada; Export Excel tetap membawa rekonSales", () => {
  assert.match(tab, /<DaftarRekonModal /); assert.match(tab, /onExport\(\{ rekonSales: rekon\.data \}\)/);
  assert.match(rekon, /kunci === "TANPA_SALES" && admin/); assert.match(rekon, /data\?\.detailTersedia/);
  assert.doesNotMatch(css, /font-family/); assert.doesNotMatch(css, /!important/);
});
