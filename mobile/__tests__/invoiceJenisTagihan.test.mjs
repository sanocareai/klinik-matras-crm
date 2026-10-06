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

test("Tab Invoice mobile: DP belum disepakati → form Persen/Nominal (default 30%), simpan nominal hasil hitung; Total tidak menghapus dpTarget", () => {
  assert.match(tab, /from "\.\.\/\.\.\/lib\/invoiceDp"/);
  assert.match(tab, /testID=\{`dp-mode-\$\{k\}`\}/);
  assert.match(tab, /api\.updateOrder\(view\.order\?\.id \|\| orderId, \{ dpTarget: hitung\.nominal \}\)/);
  assert.match(tab, /testID="pratinjau-dp"/);
  assert.doesNotMatch(tab, /dpTarget: null/);
});

test("Tab Invoice mobile: DP yang sudah disepakati bisa diubah dari tab Invoice", () => {
  assert.match(tab, /!formDp && nominal\.modeDP \?/);
  assert.match(tab, /testID="ubah-dp-invoice"/);
});

test("Tab Invoice mobile: headline 'Tagihan DP' di mode DP (sebelumnya hanya baris 'DP disepakati')", () => {
  assert.match(tab, /nominal\.modeDP \? \(\s*<Row label="Tagihan DP"/);
  assert.match(tab, /Total keseluruhan order:/);
});
