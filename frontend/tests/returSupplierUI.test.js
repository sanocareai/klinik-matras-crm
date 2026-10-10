// Retur Supplier & Debit Note — logika layar + pemasangan (sumber). Aturan nyata dihitung server; layar hanya meneruskan dan menampilkan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALASAN_RETUR, STATUS_RETUR, STATUS_DEBIT_NOTE, TEKS_KEPUTUSAN, formReturAwal, bodyRetur, galatRetur, galatKeluar, kalimatDampakDebitNote, jumlahTeks, rupiahTeks,
} from "../src/features/returSupplier/returLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

test("dua keputusan dibedakan: pengganti = alur penolakan (tanpa dokumen), kredit = dokumen retur", () => {
  assert.match(TEKS_KEPUTUSAN.pengganti, /alur penolakan.*pengiriman pengganti/);
  assert.match(TEKS_KEPUTUSAN.pengganti, /tidak ada dokumen retur/);
  assert.match(TEKS_KEPUTUSAN.kredit, /Debit Note/); assert.match(TEKS_KEPUTUSAN.kredit, /tidak ada uang kembali otomatis/);
  const ws = baca("../src/features/returSupplier/ReturSupplierWorkspace.jsx");
  assert.match(ws, /data-testid="dua-keputusan"/);
  assert.match(ws, /Ingin minta <strong[^>]*>pengganti<\/strong>/);
});

test("formulir retur: alasan, bukti, jumlah wajib; jumlah > boleh diretur ditolak di layar (server tetap menegakkan)", () => {
  const f = formReturAwal();
  const kandidat = [{ goodsReceiptLineId: "L1", kode: "BUSA", nomorPenerimaan: "GR-1", satuan: "KG", bolehDiretur: 2 }];
  assert.equal(galatRetur(f, kandidat), "Pilih PO terlebih dulu");
  f.poId = "po1";
  assert.match(galatRetur(f, kandidat), /Jelaskan alasan/);
  f.reason = "Busa pecah-pecah";
  assert.match(galatRetur(f, kandidat), /foto bukti/);
  f.evidenceUrls = ["/media/receipt-proofs/a.jpg"];
  assert.match(galatRetur(f, kandidat), /jumlah retur minimal satu baris/);
  f.jumlah = { L1: "3" };
  assert.match(galatRetur(f, kandidat), /melebihi yang boleh diretur \(2 KG\)/);
  f.jumlah = { L1: "1.2345" };
  assert.match(galatRetur(f, kandidat), /3 angka/);
  f.jumlah = { L1: "2" };
  assert.equal(galatRetur(f, kandidat), null);
  const b = bodyRetur(f);
  assert.deepEqual([b.reasonCode, b.lines, b.evidenceUrls.length], ["RUSAK", [{ goodsReceiptLineId: "L1", qty: 2 }], 1]);
  assert.equal("decision" in b, false, "keputusan kredit tidak dikirim: server menetapkannya");
});

test("konfirmasi barang keluar: PIC dan tanggal wajib", () => {
  assert.match(galatKeluar({ pic: "", tanggal: "2026-10-10" }), /PIC/);
  assert.match(galatKeluar({ pic: "Budi", tanggal: "" }), /tanggal/);
  assert.equal(galatKeluar({ pic: "Budi", tanggal: "2026-10-10" }), null);
});

test("status & istilah Indonesia jelas; kalimat dampak debit note dari angka server", () => {
  assert.equal(STATUS_RETUR.KELUAR.label, "Barang sudah keluar");
  assert.equal(STATUS_DEBIT_NOTE.MENUNGGU.label, "Menunggu persetujuan Finance");
  assert.ok(ALASAN_RETUR.length >= 4 && ALASAN_RETUR.every((a) => a.label.length > 3));
  assert.equal(jumlahTeks(1234.5), "1.234,5");
  assert.equal(rupiahTeks(216450), "Rp216.450");
  const k = kalimatDampakDebitNote({ nilai: 216450, kurangiSisaUtang: 173160, jadiSaldoKredit: 43290 });
  assert.match(k, /mengurangi sisa utang faktur Rp173\.160/); assert.match(k, /saldo kredit supplier Rp43\.290 \(bukan refund kas\)/);
});

test("pemasangan: Gudang tanpa nilai rupiah; Finance memegang debit note & saldo kredit dengan konfirmasi; rute & menu; Idempotency-Key per aksi", () => {
  const ws = baca("../src/features/returSupplier/ReturSupplierWorkspace.jsx");
  // Gudang: nilai hanya tampil bila finance
  assert.match(ws, /finance && b\.nilaiPersediaan != null/); assert.match(ws, /finance && l\.nilaiPersediaan != null/);
  assert.match(ws, /tab === "dn" && finance/); assert.match(ws, /tab === "kredit" && finance/);
  // saldo kredit: pilihan faktur + konfirmasi eksplisit, pratinjau server
  assert.match(ws, /Konfirmasi pemakaian saldo kredit|aria-label="Konfirmasi pemakaian saldo kredit"/);
  assert.match(ws, /konfirmasi: true/); assert.match(ws, /sisaFakturDilihat/);
  assert.match(ws, /kurangiSisaDiharapkan/);
  assert.match(ws, /tidak ada uang keluar|Tidak ada jurnal baru dan tidak ada uang keluar/);
  const api = baca("../src/api.js");
  for (const f of ["buatReturGudang", "keluarkanReturGudang", "setujuiDebitNote", "terapkanSaldoKredit", "batalDebitNote", "batalPemakaianKredit"]) assert.match(api, new RegExp(`${f}:[^\\n]*Idempotency-Key`));
  assert.match(baca("../src/routes/pageRegistry.jsx"), /"\/warehouse\/retur-supplier"/);
  assert.match(baca("../src/routes/pageRegistry.jsx"), /"\/finance\/retur-supplier"/);
  assert.match(baca("../src/components/Layout.jsx"), /Retur Supplier/);
  assert.match(baca("../src/components/Layout.jsx"), /Retur & Debit Note/);
  assert.match(baca("../src/features/warehouse/inventoryReal.js"), /SUPPLIER_RETURN/);
});

test("pembatalan pemakaian saldo kredit: dialog beraudit (bukan window.prompt) — alasan wajib, rincian & dampak dari server, hanya Admin Keuangan, kunci per dialog", () => {
  const ws = baca("../src/features/returSupplier/ReturSupplierWorkspace.jsx");
  assert.equal(/window\.prompt|window\.confirm|\bprompt\(/.test(ws), false, "tidak boleh ada prompt bawaan browser");
  assert.match(ws, /function DialogBatalPemakaianKredit/);
  assert.match(ws, /data-testid="rincian-batal-kredit"/);
  assert.match(ws, /data-testid="dampak-batal-kredit"/);
  assert.match(ws, /alasan\.trim\(\)\.length < 5/);
  assert.match(ws, /Tercatat di riwayat audit: siapa, kapan, dan alasannya/);
  assert.match(ws, /api\.batalPemakaianKredit\(aplikasi\.id, \{ reason: alasan\.trim\(\) \}, kunci\.current\)/);
  assert.match(ws, /kunci\.current = kunciAksi\("kredit-batal"\)/, "kunci baru setelah galat");
  assert.match(ws, /disabled=\{!admin\}[\s\S]{0,80}ALASAN_ADMIN/, "tombol batalkan nonaktif + alasan untuk non-admin");
  assert.match(ws, /adalahAdminKeuangan/);
  // tombol hanya membuka dialog (tidak memanggil API langsung)
  assert.match(ws, /onClick=\{\(\) => onBatalPakai\(k, a\)\}/);
});

test("asal stok tidak pasti: peringatan server ditampilkan di formulir retur; pesan blokir tidak disamarkan", () => {
  const ws = baca("../src/features/returSupplier/ReturSupplierWorkspace.jsx");
  assert.match(ws, /data-testid="peringatan-retur"/);
  assert.match(ws, /k\.peringatan\.map/);
  assert.match(ws, /data-testid="blokir-retur"/);
});

test("progres stok bruto · retur · bersih dipisah di Finance (tabel + kartu + total) dan Gudang (jejak penerimaan)", () => {
  const po = baca("../src/pages/finance/FinancePurchaseOrders.jsx");
  assert.match(po, /<TH numeric[^>]*>Diretur<\/TH><TH numeric[^>]*>Diterima bersih dari PO<\/TH>/);
  assert.match(po, /data-testid="kolom-diretur"/);
  assert.match(po, /data-testid="kolom-diterima-bersih"/);
  assert.match(po, /<dt className="text-ink3">Diretur<\/dt>/);
  assert.match(po, /<dt className="text-ink3">Diterima bersih dari PO<\/dt>/);
  assert.match(po, /data-testid="nilai-diretur"/);
  const jejak = baca("../src/features/warehouse/components/JejakPemakaianPenerimaan.jsx");
  assert.match(jejak, /data-testid="diretur-supplier"/);
  assert.match(jejak, /data-testid="diterima-bersih"/);
  assert.match(jejak, /Retur dari Produksi/, "retur dari Produksi dibedakan dari retur ke supplier");
  // Panel kedatangan (Gudang & Finance) menampilkan SEMUA kolom dari definisi server — kolom baru ikut tanpa menghitung ulang
  const panel = baca("../src/features/kedatangan/PanelKedatangan.jsx");
  assert.match(panel, /definisi\.filter\(\(d\) => d\.kunci !== "dipesan"\)/);
});

test("pembatalan Debit Note: tombol nonaktif + alasan jelas untuk non-Admin Keuangan (server tetap menegakkan 403)", () => {
  const ws = baca("../src/features/returSupplier/ReturSupplierWorkspace.jsx");
  assert.match(ws, /disabled=\{!admin\} title=\{admin \? undefined : ALASAN_ADMIN\}[\s\S]{0,160}data-testid="aksi-batal-dn"/);
  assert.match(ws, /data-testid="alasan-batal-dn"/);
});

test("label 'Diterima bersih dari PO' di semua layar; tidak ada klaim 'Stok bersih'; tooltip menegaskan bukan stok tersedia", () => {
  const berkas = ["../src/pages/finance/FinancePurchaseOrders.jsx", "../src/features/warehouse/components/JejakPemakaianPenerimaan.jsx", "../src/features/kedatangan/PanelKedatangan.jsx", "../src/features/returSupplier/ReturSupplierWorkspace.jsx", "../src/features/returSupplier/returLogic.js"];
  for (const f of berkas) {
    const s = baca(f);
    assert.equal(/stok bersih|stokBersih|stok-bersih/i.test(s), false, `${f}: istilah 'stok bersih' tidak boleh ada (angka ini bukan stok tersedia)`);
  }
  const po = baca("../src/pages/finance/FinancePurchaseOrders.jsx");
  assert.match(po, /title="Masuk stok dikurangi diretur\. Bukan stok tersedia/);
  assert.match(baca("../src/features/warehouse/components/JejakPemakaianPenerimaan.jsx"), /Bukan stok tersedia/);
  assert.match(po, /Nilai diretur[\s\S]{0,200}diterima bersih dari PO/);
});
