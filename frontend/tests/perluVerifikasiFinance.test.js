// Perlu Verifikasi Finance: tab & label memisahkan uang masuk / pendapatan diakui / klaim Lunas dari Sales (sumber data berbeda).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

// Redesain Pemasukan (Nov 2026): halaman dipecah ke features/finance/pemasukan/*. Pemeriksaan membaca halaman + komponennya bersama.
const bacaPemasukan = () => ["pages/finance/FinancePemasukan.jsx", "features/finance/pemasukan/pemasukanLogic.js", "features/finance/pemasukan/DaftarPemasukan.jsx", "features/finance/pemasukan/RingkasanPemasukan.jsx"].map(baca).join(" ");

test("Pemasukan: kategori Pendapatan, Uang masuk, Menunggu verifikasi (label lama tidak tersisa)", () => {
  const s = bacaPemasukan();
  assert.match(s, /id: "pendapatan", label: "Pendapatan"/);
  assert.match(s, /id: "pembayaran", label: "Uang masuk"/);
  assert.match(s, /id: "verifikasi", label: "Menunggu verifikasi"/);
  assert.doesNotMatch(s, /label: "Pendapatan Penjualan"|label: "Pembayaran Masuk"|label: "Perlu Verifikasi Finance"|label: "Pendapatan Diakui"/);
  assert.match(s, /tab === "verifikasi" && <PerluVerifikasi/);
});

test("Pendapatan: kolom Status pembayaran (bukan Rekening), filter status bayar, badge Rekening belum diketahui", () => {
  const s = bacaPemasukan();
  assert.match(s, /Status pembayaran/);
  assert.match(s, /statusBayar/);
  assert.match(s, /Rekening belum diketahui/);
  assert.match(s, /if \(pendapatan\) return \["tanggal", "pihak", "keterangan", "statusBayar", "nilai", "rincian"\]/); // Pendapatan tidak punya kolom Rekening
});

test("Penjelasan UI: pendapatan bukan bukti uang masuk; rekening muncul di uang masuk", () => {
  const s = bacaPemasukan();
  assert.match(s, /Pendapatan adalah omzet yang diakui, bukan bukti uang masuk\./);
  assert.match(s, /rekening muncul di uang masuk, bukan selalu di pendapatan/);
});

test("Menunggu verifikasi memuat DUA sumber: klaim lunas dari Sales dan uang masuk menunggu verifikasi", () => {
  const s = bacaPemasukan();
  assert.match(s, /<LunasBelumDicatat ringkas \/>/);
  assert.match(s, /statusAwal="MENUNGGU"[\s\S]{0,300}tabDari\("pembayaran"\)/); // daftar kedua = uang masuk kategori PEMBAYARAN berstatus awal MENUNGGU
  assert.match(s, /1\. Klaim lunas dari Sales/);
  assert.match(s, /2\. Uang masuk tercatat, menunggu verifikasi/);
});

test("Pembayaran (Finance): tab Perlu Verifikasi Finance (default), Klaim Lunas dari Sales, Uang Masuk Terverifikasi; klaim & pembayaran menunggu dalam satu tab", () => {
  const s = baca("pages/finance/FinancePayments.jsx");
  assert.match(s, /key: "perlu", label: "Perlu Verifikasi Finance"/);
  assert.match(s, /key: "lunas_crm", label: "Klaim Lunas dari Sales"/);
  assert.match(s, /key: "terverifikasi", label: "Uang Masuk Terverifikasi"/);
  assert.match(s, /useUrlTab\(\["perlu", "lunas_crm", "terverifikasi", "dibatalkan"\], "perlu"\)/); // bawaan tetap "perlu"; terikat ?tab= (hub Finance)
  assert.doesNotMatch(s, /label: "Ditandai Lunas oleh Sales"|label: "Menunggu Verifikasi" \}/);
  assert.match(s, /\(tab === "lunas_crm" \|\| tab === "perlu"\) && <LunasBelumDicatat ringkas=\{tab === "perlu"\} onTampil=\{setKlaimIds\} \/>/); // onTampil: dipakai Export Excel (B3.9)
  assert.match(s, /tab === "perlu" \? "belum_verifikasi" : tab/);
});

test("Klaim Lunas dari Sales: aksi Verifikasi Pembayaran, Tolak Klaim, Minta Bukti + penanda Bukti diminta; API terpasang", () => {
  const s = baca("features/finance/LunasBelumDicatat.jsx");
  for (const t of ["Verifikasi Pembayaran", "Tolak Klaim", "Minta Bukti", "Bukti diminta", "Klaim Lunas dari Sales"]) assert.match(s, new RegExp(t));
  assert.match(s, /api\.mintaBuktiPenerimaan\(/);
  assert.match(s, /api\.tolakLunas\(/);
  assert.doesNotMatch(s, /Belum Lunas<|> Belum Lunas/);
  const api = baca("api.js");
  assert.match(api, /mintaBuktiPenerimaan: \(orderId, catatan\) => request\("\/finance\/penerimaan\/minta-bukti"/);
});
