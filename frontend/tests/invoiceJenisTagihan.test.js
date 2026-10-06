// Pemilih jenis tagihan DP/TOTAL di InvoicePanel web (6 Okt 2026). Perilaku angka diuji di backend/tests/invoiceDp.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync(new URL("../src/features/orders/InvoicePanel.jsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../src/api.js", import.meta.url), "utf8");

test("API web meneruskan jenis ke lihat, ubah, PDF, dan kirim", () => {
  assert.match(api, /getOrderInvoice: \(orderId, jenis\) => request\(`\/orders\/\$\{orderId\}\/invoice\$\{jenis \? `\?jenis=\$\{jenis\}` : ""\}`\)/);
  assert.match(api, /updateOrderInvoice: \(orderId, data, jenis\)/);
  assert.match(api, /sendOrderInvoice: \(orderId, jenis\)[\s\S]{0,160}JSON\.stringify\(\{ jenis: jenis \|\| undefined \}\)/);
  assert.match(api, /getOrderInvoicePdf: async \(orderId, jenis\)[\s\S]{0,160}invoice\/pdf\$\{jenis \?/);
});

test("Panel: pemilih jenis tagihan ada (Total / DP) dan tidak tampil untuk invoice lunas atau dibatalkan", () => {
  assert.match(panel, /data-testid="pilih-jenis-tagihan"/);
  assert.match(panel, /\{!dibatalkan && !nominal\.lunas && \(\s*<div[^>]*pilih-jenis-tagihan/);
  assert.match(panel, /\["TOTAL", "Total \/ Pelunasan"\], \["DP", "DP \(uang muka\)"\]/);
  assert.match(panel, /role="radiogroup"/);
});

test("Panel: PDF, kirim WA, dan salin memakai jenis yang SEDANG TAMPIL (dokumen yang dikirim = yang dilihat)", () => {
  assert.match(panel, /getOrderInvoicePdf\(orderId, view\?\.nominal\?\.jenisTagihan\)/g);
  assert.match(panel, /sendOrderInvoice\(orderId, view\?\.nominal\?\.jenisTagihan\)/);
  assert.match(panel, /nominal\.modeDP \? `\*Sisa DP: /);
  assert.match(panel, /\*TAGIHAN DP: /);
});

test("Panel: DP belum disepakati → form nominal dengan saran DP_PERSEN, disimpan ke dpTarget order; tidak ada penghapusan dpTarget", () => {
  assert.match(panel, /setDpDraft\(String\(Math\.round\(\(\(n\?\.totalTagihan \|\| 0\) \* DP_PERSEN\) \/ 100\)\)\)/);
  assert.match(panel, /api\.updateOrder\(view\.orders\?\.\[0\]\?\.id \|\| orderId, \{ dpTarget: n \}\)/);
  assert.doesNotMatch(panel, /dpTarget: null/, "memilih Total tidak boleh menghapus kesepakatan DP");
  assert.match(panel, /DP harus lebih kecil dari total tagihan/);
});

test("Panel: 'DP terpenuhi' hanya bila DP memang terpenuhi (bukan karena Sales memilih Total)", () => {
  assert.match(panel, /nominal\.dpTarget > 0 && nominal\.sumber === "ledger" && !nominal\.bisaDP/);
});
