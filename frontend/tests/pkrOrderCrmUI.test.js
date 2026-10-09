// Sinkronisasi Penjualan Karyawan -> Order CRM: logika layar (murni) + pemasangan di Finance, CRM Orders, Produksi (Unit 360), dan Delivery (detail job).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  orderCrmKosong, orderCrmDariSinkron, galatOrderCrm, bodyOrderCrm, varianDelivery, VARIAN_PRODUKSI, aksiOrderCrm, teksKurang, KATEGORI_PKR_OPSI, KIRIM_OPSI,
} from "../src/features/finance/pkrOrderCrmLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

test("body order CRM: baru membawa jenis & jumlah unit; kirim 'ya' membawa alamat; belum dipilih = tanpa perluDikirim (server menilai 'Perlu dilengkapi')", () => {
  assert.deepEqual(bodyOrderCrm(orderCrmKosong()), { kategori: "BARU", jumlahUnit: 1 });
  const f = { ...orderCrmKosong(), kategori: "LAYANAN", jumlahUnit: "2", merk: " Sano ", ukuran: "160 x 200", kirim: "ya", alamat: " Jl. Mawar 5 ", kota: "Bekasi", tanggalKirim: "2026-10-20" };
  assert.deepEqual(bodyOrderCrm(f), { kategori: "LAYANAN", jumlahUnit: 2, merk: "Sano", ukuran: "160 x 200", perluDikirim: true, alamat: "Jl. Mawar 5", kota: "Bekasi", tanggalKirim: "2026-10-20" });
  assert.deepEqual(bodyOrderCrm({ ...f, kirim: "tidak" }), { kategori: "LAYANAN", jumlahUnit: 2, merk: "Sano", ukuran: "160 x 200", perluDikirim: false }, "diambil sendiri: alamat tidak dikirim");
  assert.deepEqual(bodyOrderCrm({ ...f, kirim: "ya" }, { baru: false }).kategori, undefined, "lengkapi: jenis & jumlah unit tidak diubah");
});

test("galat isian: jumlah unit 1–20 hanya saat membuat; isian boleh belum lengkap", () => {
  assert.equal(galatOrderCrm(orderCrmKosong()), null, "kosong tetap boleh dikirim");
  assert.match(galatOrderCrm({ ...orderCrmKosong(), jumlahUnit: "0" }), /1–20/);
  assert.match(galatOrderCrm({ ...orderCrmKosong(), jumlahUnit: "21" }), /1–20/);
  assert.match(galatOrderCrm({ ...orderCrmKosong(), jumlahUnit: "1.5" }), /1–20/);
  assert.equal(galatOrderCrm({ ...orderCrmKosong(), jumlahUnit: "" }, { baru: false }), null);
  assert.match(galatOrderCrm({ ...orderCrmKosong(), tanggalKirim: "20-10-2026" }), /Tanggal kirim/);
});

test("form lengkapi diisi dari spesifikasi server; aksi per PKR; label/varian dalam Bahasa Indonesia", () => {
  const sinkron = { order: { kategori: "LAYANAN", status: "PROCESSING", spesifikasi: { merk: "Sano", ukuran: "160 x 200", perluDikirim: false, alamat: null, kota: null, kurang: [], lengkap: true } } };
  assert.deepEqual(orderCrmDariSinkron(sinkron), { ...orderCrmKosong(), kategori: "LAYANAN", merk: "Sano", ukuran: "160 x 200", kirim: "tidak" });
  assert.deepEqual(aksiOrderCrm({ statusTampil: "BELUM_BAYAR", sinkron: null }), { buat: true, lengkapi: false }, "PKR lama: Buat/Tautkan Order CRM");
  assert.deepEqual(aksiOrderCrm({ statusTampil: "BELUM_BAYAR", sinkron }), { buat: false, lengkapi: true });
  assert.deepEqual(aksiOrderCrm({ statusTampil: "DIBATALKAN", sinkron: null }), { buat: false, lengkapi: false });
  assert.deepEqual(aksiOrderCrm({ statusTampil: "LUNAS", sinkron: { order: { ...sinkron.order, status: "CANCELLED" } } }), { buat: false, lengkapi: false });
  assert.equal(teksKurang({ order: { spesifikasi: { kurang: ["Merk kasur", "Ukuran"] } } }), "Merk kasur, Ukuran");
  assert.equal(VARIAN_PRODUKSI.PERLU_DILENGKAPI, "orange");
  assert.equal(varianDelivery("COMPLETED"), "green"); assert.equal(varianDelivery("BELUM_ADA_JOB"), "orange"); assert.equal(varianDelivery("AMBIL_SENDIRI"), "neutral");
  assert.deepEqual(KATEGORI_PKR_OPSI.map((o) => o.key), ["BARU", "LAYANAN"]);
  assert.ok(KIRIM_OPSI.some((o) => /Diambil sendiri/.test(o.label)));
});

test("detail PKR (detailSpecs) memuat bagian Order CRM, produksi, delivery, dan pembayaran dibaca dari PKR", () => {
  const spec = baca("../src/features/finance/detailSpecs.js");
  assert.match(spec, /judul: "Order CRM, Produksi, Delivery"/);
  assert.match(spec, /dibaca dari penjualan ini, bukan dari order/);
  assert.ok(spec.includes("Belum ada. Gunakan “Buat/Tautkan Order CRM”."));
  assert.ok(spec.includes("Perlu dilengkapi: ${p.sinkron.order.spesifikasi.kurang.join"));
});

test("pemasangan: API, Finance (kolom + tombol Buat/Tautkan + form), CRM Orders, Unit 360, detail job Delivery", () => {
  const api = baca("../src/api.js");
  for (const fn of ["getPenjualanKaryawanOrderCrmDryRun", "buatOrderCrmPenjualanKaryawan", "lengkapiOrderCrmPenjualanKaryawan"]) assert.match(api, new RegExp(`${fn}:`));
  assert.match(api, /penjualan-karyawan\/order-crm\/dry-run/);
  const fin = baca("../src/pages/finance/FinancePenjualanKaryawan.jsx");
  assert.match(fin, /Buat\/Tautkan Order CRM/);
  assert.match(fin, /Lengkapi spesifikasi order/);
  assert.match(fin, /<TH width=\{210\}>Order CRM<\/TH>/);
  assert.match(fin, /orderCrm: bodyOrderCrm\(f\.orderCrm\)/);
  assert.match(fin, /data-testid="bagian-order-crm"/);
  assert.doesNotMatch(fin, /Tidak membuat order, produksi, atau pengiriman/, "teks lama (tanpa order) sudah diganti");
  const ord = baca("../src/pages/Orders.jsx");
  assert.match(ord, /LabelOrderPkr pkr=\{order\.penjualanKaryawan\}/);
  assert.match(ord, /BadgeBayarPkr/);
  assert.match(ord, /di Finance/);
  assert.match(baca("../src/features/production/UnitOverviewDrawer.jsx"), /unit360-pkr-perlu-dilengkapi/);
  assert.match(baca("../src/features/armada/components/JobDetailDrawer.jsx"), /job-rujukan-pkr/);
  const komp = baca("../src/features/finance/PkrOrderCrm.jsx");
  assert.match(komp, /Perlu dilengkapi/);
  assert.match(komp, /tidak membawa uang|Tidak ada pembayaran, invoice, atau jurnal baru/);
});
