// Tab "Perlu Verifikasi Finance" memuat Payment menunggu dari SEMUA periode; tab lain tetap per periode; kartu angka tetap per periode.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(akar, "src/pages/finance/FinancePayments.jsx"), "utf8").split("\r\n").join("\n");

test("Tab perlu memanggil API dengan rentang lebar; tab lain memakai periode terpilih; kartu angka tetap periode", () => {
  assert.match(src, /const SEMUA_PERIODE = \{ from: "2000-01-01", to: "2100-01-01" \}/);
  assert.match(src, /getFinanceCustomerPayments\(tab === "perlu" \? \{ from: SEMUA_PERIODE\.from, to: SEMUA_PERIODE\.to, status: "belum_verifikasi" \} : \{ \.\.\.periode, status: tab \}\)/);
  assert.match(src, /api\.getFinanceCustomerPayments\(\{ \.\.\.periode, status: "" \}\)/, "kartu angka (query ke-2) tetap per periode");
  assert.match(src, /\(semua periode\)/, "judul bagian menyatakan semua periode");
});
