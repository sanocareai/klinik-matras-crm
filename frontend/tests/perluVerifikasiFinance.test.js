// Perlu Verifikasi Finance: tab & label memisahkan uang masuk / pendapatan diakui / klaim Lunas dari Sales (sumber data berbeda).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

test("Pemasukan: tab Pendapatan Diakui, Uang Masuk, Perlu Verifikasi Finance (label lama tidak tersisa)", () => {
  const s = baca("pages/finance/FinancePemasukan.jsx");
  assert.match(s, /id: "pendapatan", label: "Pendapatan Diakui"/);
  assert.match(s, /id: "pembayaran", label: "Uang Masuk"/);
  assert.match(s, /id: "verifikasi", label: "Perlu Verifikasi Finance"/);
  assert.doesNotMatch(s, /label: "Pendapatan Penjualan"|label: "Pembayaran Masuk"/);
  assert.match(s, /tab === "verifikasi" && <PerluVerifikasi/);
});

test("Pendapatan Diakui: kolom Status pembayaran (bukan Rekening), filter status bayar, badge Rekening belum diketahui", () => {
  const s = baca("pages/finance/FinancePemasukan.jsx");
  assert.match(s, /Status pembayaran/);
  assert.match(s, /statusBayar/);
  assert.match(s, /Rekening belum diketahui/);
  assert.match(s, /pendapatan \? <TH width=\{168\}>Status pembayaran<\/TH>/);
});

test("Penjelasan UI: pendapatan bukan bukti uang masuk; rekening muncul di uang masuk", () => {
  const s = baca("pages/finance/FinancePemasukan.jsx");
  assert.match(s, /Pendapatan adalah omzet yang diakui, bukan bukti uang masuk\./);
  assert.match(s, /rekening muncul di uang masuk, bukan selalu di pendapatan/);
});

test("Perlu Verifikasi Finance memuat DUA sumber: klaim Lunas dari Sales dan uang masuk menunggu verifikasi", () => {
  const s = baca("pages/finance/FinancePemasukan.jsx");
  assert.match(s, /<LunasBelumDicatat \/>/);
  assert.match(s, /kategori="PEMBAYARAN"[^>]*statusAwal="MENUNGGU"/);
  assert.match(s, /1\. Klaim Lunas dari Sales/);
  assert.match(s, /2\. Uang masuk tercatat, menunggu verifikasi/);
});

test("Pembayaran (Finance): tab Perlu Verifikasi Finance (default), Klaim Lunas dari Sales, Uang Masuk Terverifikasi; klaim & pembayaran menunggu dalam satu tab", () => {
  const s = baca("pages/finance/FinancePayments.jsx");
  assert.match(s, /key: "perlu", label: "Perlu Verifikasi Finance"/);
  assert.match(s, /key: "lunas_crm", label: "Klaim Lunas dari Sales"/);
  assert.match(s, /key: "terverifikasi", label: "Uang Masuk Terverifikasi"/);
  assert.match(s, /useState\("perlu"\)/);
  assert.doesNotMatch(s, /label: "Ditandai Lunas oleh Sales"|label: "Menunggu Verifikasi" \}/);
  assert.match(s, /\(tab === "lunas_crm" \|\| tab === "perlu"\) && <LunasBelumDicatat \/>/);
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
