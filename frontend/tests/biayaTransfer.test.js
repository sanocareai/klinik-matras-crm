// Biaya admin transfer bank — logika di layar + jaminan bahwa SEMUA form uang
// keluar (termasuk dialog Koreksi) memakainya. TIDAK ada kalkulasi biaya di
// klien: angka final dan pratinjau milik server
// (backend/tests/integration/financeTransferFee.integration.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIAYA_BAWAAN, JENIS_BIAYA_TRANSFER, nilaiAwalBiaya, biayaTransferLengkap, bodyBiayaTransfer, presetRekening, denganBiaya, tanpaBiaya,
} from "../src/features/finance/biayaTransfer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "latin1");

const bank = { id: "b1", kind: "BANK" };
const kas = { id: "k1", kind: "KAS" };

test("Preset bawaan sesuai spesifikasi: Sesama Bank Rp0, BI-FAST Rp2.500, Transfer Online Rp6.500", () => {
  assert.deepEqual(BIAYA_BAWAAN, { SESAMA_BANK: 0, BI_FAST: 2500, TRANSFER_ONLINE: 6500 });
  assert.deepEqual(JENIS_BIAYA_TRANSFER.map((j) => j.code), ["SESAMA_BANK", "BI_FAST", "TRANSFER_ONLINE", "LAINNYA"]);
});

test("Preset per rekening menimpa bawaan; rekening lain tidak terpengaruh", () => {
  assert.equal(presetRekening({ presetBiayaTransfer: { BI_FAST: 3000 } }).BI_FAST, 3000);
  assert.equal(presetRekening({ presetBiayaTransfer: { BI_FAST: 3000 } }).TRANSFER_ONLINE, 6500);
  assert.equal(presetRekening(bank).BI_FAST, 2500);
});

test("Nilai awal: kas -> Tunai; bank -> Transfer (metode wajib dipilih); tanpa rekening -> kosong", () => {
  assert.equal(nilaiAwalBiaya(kas).paymentMethod, "TUNAI");
  assert.equal(nilaiAwalBiaya(bank).paymentMethod, "TRANSFER");
  assert.equal(nilaiAwalBiaya(bank).transferFeeType, "");
  assert.equal(nilaiAwalBiaya(null).paymentMethod, "");
});

test("TIDAK ada kalkulasi biaya di klien: pratinjau meminta angka ke endpoint server yang sama dengan penyimpanan", () => {
  const util = baca("features/finance/biayaTransfer.js");
  assert.ok(!/pratinjauBiaya|biayaTerpilih/.test(util), "kalkulasi biaya tidak boleh ada di util klien");
  const komp = baca("features/finance/CaraBayarTransfer.jsx");
  assert.match(komp, /api\.previewBiayaTransfer\(/, "pratinjau harus meminta angka ke server");
  assert.ok(!/nominal\s*\+|\+\s*nominal|biayaAdmin\s*\+|\+\s*biayaAdmin/.test(komp), "tidak menjumlahkan nominal + biaya di klien");
  for (const teks of ["Nominal diterima", "Biaya admin", "Total keluar rekening"]) assert.ok(komp.includes(teks), teks);
  assert.match(baca("api.js"), /previewBiayaTransfer:[\s\S]{0,120}\/finance\/transfer-fee\/preview/);
});

test("denganBiaya: form utang/reimbursement TIDAK membawa isian biaya; form langsung membawanya", () => {
  const f = { amount: 1, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST", transferFeeAmount: "" };
  assert.deepEqual(denganBiaya(f, false), { amount: 1 });
  assert.deepEqual(denganBiaya(f, true), { amount: 1, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.deepEqual(tanpaBiaya(f), { amount: 1 });
});

test("Kelengkapan: Transfer wajib pilih metode; Custom wajib nominal (boleh 0)", () => {
  assert.equal(biayaTransferLengkap(bank, { paymentMethod: "TRANSFER", transferFeeType: "" }), false);
  assert.equal(biayaTransferLengkap(bank, { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }), true);
  assert.equal(biayaTransferLengkap(bank, { paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: "" }), false);
  assert.equal(biayaTransferLengkap(bank, { paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: "0" }), true);
  assert.equal(biayaTransferLengkap(kas, { paymentMethod: "TUNAI" }), true);
});

test("Body request: preset TIDAK mengirim nominal (server yang mengisi); Custom mengirim angka", () => {
  assert.deepEqual(bodyBiayaTransfer({ paymentMethod: "TRANSFER", transferFeeType: "BI_FAST", transferFeeAmount: "999" }), { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.deepEqual(bodyBiayaTransfer({ paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: "7777" }), { paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: 7777 });
  assert.deepEqual(bodyBiayaTransfer({ paymentMethod: "TUNAI" }), { paymentMethod: "TUNAI" });
  assert.deepEqual(bodyBiayaTransfer({ paymentMethod: "" }), {});
});

test("SEMUA form uang keluar memakai CaraBayarTransfer + denganBiaya + menunggu metode transfer lengkap", () => {
  const form = [
    ["pages/finance/FinanceExpenses.jsx", 2],
    ["pages/finance/FinancePurchases.jsx", 2],
    ["pages/finance/FinanceSuppliers.jsx", 1],
    ["pages/finance/FinanceKasbon.jsx", 1],
    ["pages/finance/FinanceReceivables.jsx", 1],
  ];
  for (const [file, minimal] of form) {
    const src = baca(file);
    const jumlahKomponen = (src.match(/<CaraBayarTransfer\b/g) || []).length;
    const jumlahBody = (src.match(/denganBiaya\(/g) || []).length;
    assert.ok(jumlahKomponen >= minimal, `${file}: <CaraBayarTransfer> ${jumlahKomponen}x, butuh >= ${minimal}`);
    assert.ok(jumlahBody >= minimal, `${file}: denganBiaya ${jumlahBody}x, butuh >= ${minimal}`);
    assert.ok(/biayaTransferLengkap\(/.test(src), `${file}: tombol kirim harus menunggu metode transfer lengkap`);
  }
});

test("Dialog Koreksi (EditDokumen) memakai CaraBayarTransfer dan hanya mengirim biaya bila berubah", () => {
  const src = baca("features/finance/EditDokumen.jsx");
  assert.match(src, /<CaraBayarTransfer\b/);
  assert.match(src, /biayaBisaDiedit/);
  assert.match(src, /doc\.mode === "LANGSUNG" \|\| doc\.status === "DIBAYAR"/, "biaya hanya dikoreksi bila uang sudah keluar di jurnalnya");
  assert.match(src, /biayaBerubah \? bodyBiayaTransfer\(f\)/);
  assert.match(src, /langkah <strong>Bayar<\/strong>/, "dokumen belum dibayar dijelaskan: biaya dicatat saat Bayar");
});

test("Form buat utang/reimbursement tidak mengirim biaya (denganBiaya aktif hanya untuk LANGSUNG)", () => {
  for (const file of ["pages/finance/FinanceExpenses.jsx", "pages/finance/FinancePurchases.jsx"]) {
    assert.match(baca(file), /denganBiaya\(f, f\.mode === "LANGSUNG"\)/, file);
  }
});

test("Pengaturan Finance memuat preset biaya admin per rekening, teks Bahasa Indonesia", () => {
  const src = baca("pages/finance/FinanceSettings.jsx");
  assert.match(src, /Biaya Admin Transfer per Rekening/);
  assert.match(src, /transferFeePresets/);
  const komponen = baca("features/finance/CaraBayarTransfer.jsx");
  for (const teks of ["Nominal diterima", "Total keluar rekening", "Biaya admin", "Metode transfer", "Cara bayar"]) {
    assert.ok(komponen.includes(teks), `label "${teks}" harus ada`);
  }
});
