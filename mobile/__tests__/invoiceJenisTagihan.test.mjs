// Pemilih jenis tagihan DP/TOTAL di tab Invoice mobile (6 Okt 2026) — paritas web. Perilaku angka diuji di backend/tests/invoiceDp.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const tab = fs.readFileSync(new URL("../src/components/order/OrderInvoiceTab.js", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../src/api.js", import.meta.url), "utf8");

test("API mobile meneruskan jenis ke lihat, ubah, dan kirim", () => {
  assert.match(api, /getOrderInvoice: \(orderId, jenis\) =>/);
  assert.match(api, /updateOrderInvoice: \(orderId, data, jenis\) =>/);
  assert.match(api, /sendOrderInvoice: \(orderId, jenis\) =>[\s\S]{0,160}JSON\.stringify\(\{ jenis: jenis \|\| undefined \}\)/);
});

test("Tab Invoice mobile: pemilih Total/DP ada, tersembunyi untuk invoice lunas/dibatalkan, bisa diakses (radio)", () => {
  assert.match(tab, /\{!batal && !nominal\.lunas \? \(\s*<View style=\{styles\.card\} testID="pilih-jenis-tagihan"/);
  assert.match(tab, /\["TOTAL", "Total \/ Pelunasan"\], \["DP", "DP \(uang muka\)"\]/);
  assert.match(tab, /accessibilityRole="radio"/);
});

test("Tab Invoice mobile: PDF & kirim memakai jenis yang tampil; nama berkas PDF DP dibedakan", () => {
  assert.match(tab, /const j = view\.nominal\?\.jenisTagihan;/);
  assert.match(tab, /invoice\/pdf\$\{j \? `\?jenis=\$\{j\}` : ""\}/);
  assert.match(tab, /sendOrderInvoice\(orderId, jenisKirim\)/);
});

test("Tab Invoice mobile: DP belum disepakati → form dengan saran 30%, simpan ke dpTarget; Total tidak menghapus dpTarget", () => {
  assert.match(tab, /const DP_PERSEN = 30;/);
  assert.match(tab, /api\.updateOrder\(view\.order\?\.id \|\| orderId, \{ dpTarget: n \}\)/);
  assert.doesNotMatch(tab, /dpTarget: null/);
});

test("Tab Invoice mobile: headline 'Tagihan DP' di mode DP (sebelumnya hanya baris 'DP disepakati')", () => {
  assert.match(tab, /nominal\.modeDP \? \(\s*<Row label="Tagihan DP"/);
  assert.match(tab, /Total keseluruhan order:/);
});
