// Tab "Perlu verifikasi" memuat Payment menunggu dari SEMUA periode; tab lain tetap per periode; angka periode tetap per periode.
// Redesain Verifikasi pembayaran (Nov 2026): konstanta rentang di verifikasiLogic.js, pemuatan di halaman, cakupan di DaftarPembayaran.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (rel) => fs.readFileSync(path.join(akar, rel), "utf8").split("\r\n").join("\n");
const src = baca("src/pages/finance/FinancePayments.jsx");

test("Tab perlu memanggil API dengan rentang lebar; tab lain memakai periode terpilih; angka periode tetap periode", () => {
  assert.match(baca("src/features/finance/verifikasi/verifikasiLogic.js"), /SEMUA_PERIODE = Object\.freeze\(\{ from: "2000-01-01", to: "2100-01-01" \}\)/);
  assert.match(src, /getFinanceCustomerPayments\(antreanId === "perlu" \? \{ from: SEMUA_PERIODE\.from, to: SEMUA_PERIODE\.to, status: "belum_verifikasi" \} : \{ \.\.\.periode, status: statusServer\(antreanId\) \}\)/);
  assert.match(src, /api\.getFinanceCustomerPayments\(\{ \.\.\.periode, status: "" \}\)/, "angka periode (query ke-2) tetap per periode");
  assert.match(baca("src/features/finance/verifikasi/DaftarPembayaran.jsx"), /Semua periode/, "daftar menyatakan cakupan semua periode");
});
