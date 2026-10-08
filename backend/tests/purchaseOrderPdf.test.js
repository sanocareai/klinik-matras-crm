// PDF PURCHASE ORDER — render dari fixture (tanpa DB). Dikunci: judul PURCHASE ORDER / Pesanan Pembelian; data supplier (bukan pelanggan); daftar material (nama, kode, jumlah+satuan, harga, nilai);
// termin supplier; alamat penerimaan barang; status & revisi sesuai kontrak PO; total = totalDipesan; TIDAK memuat elemen invoice (DP, garansi, status bayar pelanggan, rekening, Sales);
// header/footer/identitas SAMA dengan invoice (teks dari komponen bersama); multi-halaman memakai penanda "— lanjutan" dan bar tabel diulang.
import test from "node:test";
import assert from "node:assert/strict";
import { PDFParse } from "pdf-parse";
import { renderPurchaseOrderPdf } from "../src/services/purchaseOrderPdf.js";
import { renderInvoicePdf } from "../src/services/invoicePdf.js";
import { VIEWS_PO } from "./fixtures/poPdfViews.js";
import { VIEWS } from "./fixtures/invoicePdfViews.js";

async function teks(buf) {
  const p = new PDFParse({ data: new Uint8Array(buf) });
  const r = await p.getText();
  await p.destroy?.();
  return { teks: r.text.replace(/\s+/g, " "), halaman: r.total ?? r.pages?.length ?? 1 };
}
const rp = (n) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

test("PO disetujui: satu halaman; judul, supplier, material, termin, alamat penerimaan, total, persetujuan", async () => {
  const v = VIEWS_PO.disetujui;
  const buf = await renderPurchaseOrderPdf(v);
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  const { teks: t, halaman } = await teks(buf);
  assert.equal(halaman, 1);
  for (const x of ["PURCHASE ORDER", "Pesanan Pembelian", "PO No.", v.po.poNumber, "DIPESAN DARI", "PT ESA BUMINDO", "SUP-001", "esabumindo.co.id", "TERMIN PEMBAYARAN", "30 hari",
    "ALAMAT PENERIMAAN BARANG", "Gudang Penerimaan", "Pancoran Mas", "15 Oktober 2026", "MATERIAL", "HARGA SATUAN", "Lem I-SR 1037 13 KG tipe 0", "BHN-000", "KG", "SHEET", "METER",
    "TOTAL PESANAN", rp(v.po.totalDipesan), "STATUS: DISETUJUI", "Disetujui oleh Dewi Finance", "Kirim ke Gudang Utama sebelum Jumat"]) {
    assert.ok(t.includes(x), `PDF memuat "${x}"`);
  }
  for (const l of v.po.lines) { assert.ok(t.includes(rp(l.hargaSatuan)) && t.includes(rp(l.nilaiDipesan)), `harga & nilai ${l.kode}`); }
});

test("PO TIDAK memuat elemen invoice yang tidak relevan: DP, garansi, status bayar pelanggan, rekening, Sales, 'INVOICE'", async () => {
  for (const [nama, v] of Object.entries(VIEWS_PO)) {
    const { teks: t } = await teks(await renderPurchaseOrderPdf(v));
    for (const terlarang of ["INVOICE", "DITERBITKAN UNTUK", "METODE PEMBAYARAN", "Tagihan DP", "Sisa DP", "Sudah dibayar", "Sisa tagihan", "Garansi", "garansi", "Mandiri", "1230013546272", "Sales", "Syarat & Ketentuan", "SYARAT & KETENTUAN", "Terima kasih"]) {
      assert.ok(!t.includes(terlarang), `${nama}: tidak boleh memuat "${terlarang}"`);
    }
  }
});

test("header, identitas, dan footer sama dengan invoice (komponen bersama): logo+kartu bantuan, WhatsApp, website, alamat workshop, tagline", async () => {
  const po = (await teks(await renderPurchaseOrderPdf(VIEWS_PO.disetujui))).teks;
  const inv = (await teks(await renderInvoicePdf(VIEWS.sederhana))).teks;
  for (const x of ["BUTUH BANTUAN?", "Customer Care", "0851 8728 3900", "www.sanomatrassehat.com", "Workshop:", "Jl. Raya Keadilan, Gg Asrama Polri, No. 81, RT 5/12, Pancoran Mas, Kota Depok", "Ahlinya Kasur Sehat", "Tanggal"]) {
    assert.ok(po.includes(x) && inv.includes(x), `PO dan invoice sama-sama memuat "${x}"`);
  }
});

test("status & revisi sesuai kontrak PO: draf (tidak mengikat), diterima sebagian + revisi, dibatalkan (alasan), termin belum ditetapkan", async () => {
  let t = (await teks(await renderPurchaseOrderPdf(VIEWS_PO.draf))).teks;
  assert.ok(t.includes("STATUS: DRAF") && t.includes("belum disetujui") && t.includes("belum mengikat"));
  assert.ok(t.includes("Belum ditetapkan") && !t.includes("Disetujui oleh"));
  t = (await teks(await renderPurchaseOrderPdf(VIEWS_PO.revisi))).teks;
  assert.ok(t.includes("STATUS: DITERIMA SEBAGIAN") && t.includes("Revisi ke-2") && t.includes("10 Oktober 2026") && t.includes("Tunai/COD") && t.includes("Ditetapkan pada PO ini"));
  t = (await teks(await renderPurchaseOrderPdf(VIEWS_PO.dibatalkan))).teks;
  assert.ok(t.includes("STATUS: DIBATALKAN") && t.includes("Supplier kehabisan stok") && t.includes("9 Oktober 2026"));
});

test("PO panjang (22 material): 3 halaman, penanda '— lanjutan', bar tabel diulang, semua baris tampil, total dan footer hanya di akhir", async () => {
  const v = VIEWS_PO.panjang;
  const { teks: t, halaman } = await teks(await renderPurchaseOrderPdf(v));
  assert.equal(halaman, 3);
  assert.equal(t.split("PO-08102026-001 — lanjutan").length - 1, 2);
  assert.equal(t.split("MATERIAL").length - 1, 3, "bar tabel di tiap halaman");
  for (let i = 0; i < 22; i++) assert.ok(t.includes(`BHN-${String(i).padStart(3, "0")}`), `baris ${i + 1}`);
  assert.equal(t.split("TOTAL PESANAN").length - 1, 1);
  assert.equal(t.split("BUTUH BANTUAN?").length - 1, 1);
  assert.ok(t.includes(rp(v.po.totalDipesan)));
});

test("supplier tanpa alamat/kontak dan nama sangat panjang tetap tampil rapi (tanpa galat, satu halaman)", async () => {
  const { teks: t, halaman } = await teks(await renderPurchaseOrderPdf(VIEWS_PO.supplierMinim));
  assert.equal(halaman, 1);
  assert.ok(t.includes("Toko Bahan Pak Haji Sulaiman") && t.includes("SUP-009"));
});

test("render deterministik dan aman: dua kali render isi sama; teks berawalan '=' atau tanda khusus tidak merusak PDF", async () => {
  const v = structuredClone(VIEWS_PO.disetujui);
  v.po.lines[0].nama = "=HYPERLINK(\"x\") <b>Lem & \ (uji)</b>";
  v.supplier.nama = "PT \"Aneh\" (Uji) & Sons";
  const a = await renderPurchaseOrderPdf(v);
  const { teks: t } = await teks(a);
  assert.ok(t.includes("HYPERLINK") && t.includes("Aneh"));
  const norm = (b) => b.toString("latin1").replace(/\(D:\d{14}Z?\)/g, "").replace(/\/ID \[[^\]]*\]/g, "");
  assert.equal(norm(a), norm(await renderPurchaseOrderPdf(v)));
});
