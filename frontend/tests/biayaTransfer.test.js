// Biaya admin transfer bank — logika pratinjau di layar + jaminan bahwa SEMUA
// form uang keluar memakainya. Hitungan final tetap milik server
// (backend/tests/integration/financeTransferFee.integration.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIAYA_BAWAAN, JENIS_BIAYA_TRANSFER, nilaiAwalBiaya, pratinjauBiaya, biayaTransferLengkap, bodyBiayaTransfer, presetRekening,
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

test("Pratinjau: Nominal Diterima dan Total Keluar Rekening terpisah", () => {
  const v = { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST", transferFeeAmount: "" };
  assert.deepEqual(pratinjauBiaya(bank, v, "100000"), { nominalDiterima: 100000, biayaAdmin: 2500, totalKeluarRekening: 102500 });
  const c = { paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: "7777" };
  assert.equal(pratinjauBiaya(bank, c, 100000).totalKeluarRekening, 107777);
  const t = { paymentMethod: "TUNAI", transferFeeType: "", transferFeeAmount: "" };
  assert.equal(pratinjauBiaya(bank, t, 100000).biayaAdmin, 0);
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

test("SEMUA form uang keluar memakai CaraBayarTransfer dan mengirim bodyBiayaTransfer", () => {
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
    const jumlahBody = (src.match(/bodyBiayaTransfer\(/g) || []).length;
    assert.ok(jumlahKomponen >= minimal, `${file}: <CaraBayarTransfer> ${jumlahKomponen}x, butuh >= ${minimal}`);
    assert.ok(jumlahBody >= minimal, `${file}: bodyBiayaTransfer ${jumlahBody}x, butuh >= ${minimal}`);
    assert.ok(/biayaTransferLengkap\(/.test(src), `${file}: tombol kirim harus menunggu metode transfer lengkap`);
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
