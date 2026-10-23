import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Baris PKR dibatalkan tidak boleh tampak seperti tagihan: "Dibatalkan — tidak ditagih"; nilai historis tetap tersedia di rincian (angka & dokumen tidak berubah).
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
const panel = readFileSync(path.join(SRC, "features/finance/laporanTerinci/PanelPendapatan.jsx"), "utf8").replace(/\r\n/g, "\n");

test("PKR batal: status 'Dibatalkan — tidak ditagih' menggantikan 'sisa' di baris utama; nilai historis di baris rincian", () => {
  assert.match(panel, /d\.status === "DIBATALKAN" \? <span data-testid="pkr-batal-tidak-ditagih"[^>]*>Dibatalkan — tidak ditagih<\/span> : <>dibayar <Uang value=\{d\.dibayar\} \/> · sisa <Uang value=\{d\.sisa\} \/><\/>/);
  assert.match(panel, /data-testid="pkr-nilai-historis">Nilai historis \(bukan tagihan\): total <Uang value=\{d\.total\} \/> · dibayar <Uang value=\{d\.dibayar\} \/> · sisa sebelum dibatalkan <Uang value=\{d\.sisa\} \/>/);
});

test("PKR aktif tetap menampilkan dibayar dan sisa; total sisa piutang tetap dari server (tidak dihitung di klien)", () => {
  assert.match(panel, /dibayar <Uang value=\{d\.dibayar\} \/> · sisa <Uang value=\{d\.sisa\} \/>/);
  assert.match(panel, /formatUang\(r\.sisaPiutang\)/);
  assert.doesNotMatch(panel, /reduce\(/, "tidak menjumlah baris di klien");
});
