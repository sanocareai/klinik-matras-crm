// SNAPSHOT PDF INVOICE — membuktikan refactor komponen dokumen bersama (services/documentPdf.js) TIDAK mengubah tampilan invoice lama.
// Golden (tests/fixtures/invoicePdfGolden.json) diambil dari invoicePdf.js SEBELUM refactor: hash seluruh isi PDF (konten halaman, font, logo) setelah membuang tanggal-dibuat/ID acak.
// Lima variasi: sederhana, diskon+ongkir+dibayar+riwayat (2 halaman), mode DP, gabungan lintas-order (alamat panjang), 24 item (3 halaman).
// Bila tampilan invoice SENGAJA diubah: regenerasi golden bersama persetujuan Owner — jangan ubah tes ini untuk meloloskan perubahan tak sengaja.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderInvoicePdf } from "../src/services/invoicePdf.js";
import { VIEWS } from "./fixtures/invoicePdfViews.js";
import { hashPdf } from "./fixtures/invoicePdfNormalisasi.js";

const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/invoicePdfGolden.json", import.meta.url), "utf8"));

for (const nama of Object.keys(VIEWS)) {
  test(`invoice "${nama}": isi PDF identik dengan golden sebelum refactor (logo, header, kartu, tabel, footer)`, async () => {
    const buf = await renderInvoicePdf(VIEWS[nama]);
    assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
    const halaman = (buf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
    assert.equal(halaman, golden[nama].halaman, "jumlah halaman");
    assert.equal(buf.length, golden[nama].bytes, "ukuran berkas");
    assert.equal(hashPdf(buf), golden[nama].sha256, `tampilan invoice "${nama}" BERUBAH dari golden`);
  });
}

test("komponen bersama: invoice & PO memakai documentPdf.js (logo, font, warna, header, footer) — tidak ada salinan terpisah", () => {
  const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
  const inv = baca("../src/services/invoicePdf.js");
  const po = baca("../src/services/purchaseOrderPdf.js");
  for (const [nama, src] of [["invoicePdf", inv], ["purchaseOrderPdf", po]]) {
    assert.match(src, /from "\.\/documentPdf\.js"/, `${nama} mengimpor komponen bersama`);
    assert.match(src, /gambarHeaderDokumen/, `${nama} memakai header bersama`);
    assert.match(src, /gambarFooterBantuan/, `${nama} memakai footer bersama`);
    assert.doesNotMatch(src, /#2367C2|#EEF4FC|logo-invoice-blue|\.woff"|registerFont/, `${nama} tidak menyalin warna/logo/font`);
  }
  assert.doesNotMatch(po, /from "\.\/invoicePdf\.js"/, "PO tidak bergantung pada invoice");
});
