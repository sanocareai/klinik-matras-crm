// Invoice Pelanggan — logika penyajian murni (tanpa React). Tidak mengubah rumus/status; tampilan diperiksa di browser terpisah.
import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_INVOICE, TAB_TEMPO, labelStatus, nadaStatus, statusBayar, keteranganBayar, statusDokumen, sumberAngka, keadaanTempo,
  filterInvoice, adaFilterLokal, jumlahFilterAktif, kpiInvoice, kalimatHasil,
} from "../src/features/finance/invoiceTampilan.js";

const inv = (o = {}) => ({ id: "i1", status: "SENT", lifecycleStatus: "SENT", totalTagihan: 1000000, dibayar: 0, sisa: 1000000, lunas: false, sumber: "ledger", dibayarTidakRinci: false, dueDate: null, hariLewat: null, dibatalkan: false, ...o });

test("status tampil: semua status lama tetap, label sama dengan halaman lama", () => {
  assert.deepEqual(Object.keys(STATUS_INVOICE), ["DRAFT", "SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"]);
  assert.equal(labelStatus("PARTIALLY_PAID"), "Dibayar Sebagian");
  assert.equal(labelStatus("OVERDUE"), "Lewat Tempo");
  assert.equal(labelStatus("BARU"), "BARU");
  assert.equal(nadaStatus("PAID"), "green"); assert.equal(nadaStatus("OVERDUE"), "red"); assert.equal(nadaStatus("BARU"), "neutral");
  assert.deepEqual(TAB_TEMPO.map((t) => t.key), ["", "lewat", "belum_diatur"]);
});

test("status pembayaran terpisah dari status dokumen: lewat tempo tidak menyembunyikan pembayaran sebagian", () => {
  const telat = inv({ status: "OVERDUE", dibayar: 400000, sisa: 600000, dueDate: "2026-10-01", hariLewat: 31 });
  assert.equal(statusBayar(telat).kode, "sebagian");
  assert.equal(keteranganBayar(telat).kode, "sebagian"); // chip bilang "Lewat Tempo", keterangan bilang sudah dibayar sebagian
  assert.equal(statusBayar(inv()).kode, "belum");
  assert.equal(statusBayar(inv({ lunas: true, status: "PAID", dibayar: 1000000, sisa: 0 })).kode, "lunas");
  assert.equal(statusBayar(inv({ dibayarTidakRinci: true })).kode, "sebagian");
  assert.equal(statusBayar(inv({ status: "CANCELLED", dibatalkan: true })).kode, "dibatalkan");
});

test("keterangan bayar tidak mengulang chip Lunas / Dibayar Sebagian", () => {
  assert.equal(keteranganBayar(inv({ status: "PAID", lunas: true })), null);
  assert.equal(keteranganBayar(inv({ status: "PARTIALLY_PAID", dibayar: 5 })), null);
  assert.equal(keteranganBayar(inv({ status: "DRAFT" })).label, "Belum dibayar");
});

test("status dokumen: dari lifecycleStatus, tanpa membicarakan uang", () => {
  assert.match(statusDokumen(inv({ lifecycleStatus: "DRAFT" })), /belum dikirim/);
  assert.equal(statusDokumen(inv({ lifecycleStatus: "VIEWED" })), "Dilihat pelanggan");
  assert.match(statusDokumen(inv({ lifecycleStatus: "SENT", dibatalkan: true })), /semua order/);
  assert.equal(statusDokumen(inv({ lifecycleStatus: "CANCELLED", dibatalkan: true })), "Dibatalkan");
});

test("sumber angka & jatuh tempo mengikuti aturan halaman lama", () => {
  assert.equal(sumberAngka(inv()).kode, "ledger");
  assert.equal(sumberAngka(inv({ sumber: "statusManual" })).kode, "manual");
  assert.deepEqual(keadaanTempo(inv()), { diatur: false, lewat: 0 });
  assert.deepEqual(keadaanTempo(inv({ dueDate: "2026-10-01", hariLewat: 12 })), { diatur: true, lewat: 12 });
  assert.deepEqual(keadaanTempo(inv({ dueDate: "2026-10-01", hariLewat: 12, lunas: true })), { diatur: true, lewat: 0 });
  assert.deepEqual(keadaanTempo(inv({ dueDate: "2026-12-01", hariLewat: -5 })), { diatur: true, lewat: 0 });
});

test("filter lokal sama dengan halaman lama (status tampil, sumber, sales, tempo)", () => {
  const daftar = [
    inv({ id: "a", status: "PAID", salesName: "Rina", dueDate: "2026-10-01" }),
    inv({ id: "b", status: "OVERDUE", salesName: "Budi", sumber: "statusManual" }),
    inv({ id: "c", status: "SENT", salesName: "Rina" }),
  ];
  const id = (f) => filterInvoice(daftar, { fStatus: "", fSumber: "", fSales: "", fTempo: "", ...f }).map((x) => x.id);
  assert.deepEqual(id({}), ["a", "b", "c"]);
  assert.deepEqual(id({ fStatus: "OVERDUE" }), ["b"]);
  assert.deepEqual(id({ fSumber: "manual" }), ["b"]); // server mengirim "statusManual"
  assert.deepEqual(id({ fSumber: "ledger" }), ["a", "c"]);
  assert.deepEqual(id({ fSales: "Rina" }), ["a", "c"]);
  assert.deepEqual(id({ fTempo: "ada" }), ["a"]);
  assert.deepEqual(id({ fTempo: "belum" }), ["b", "c"]);
  assert.equal(adaFilterLokal({ fStatus: "", fSumber: "", fSales: "", fTempo: "" }), false);
  assert.equal(adaFilterLokal({ fStatus: "PAID" }), true);
});

test("jumlah filter aktif menghitung tab jatuh tempo dan pencarian yang terisi", () => {
  assert.equal(jumlahFilterAktif({}), 0);
  assert.equal(jumlahFilterAktif({ q: "  ", fStatus: "PAID" }), 1);
  assert.equal(jumlahFilterAktif({ q: "x", fStatus: "PAID", fSumber: "manual", fSales: "Rina", fTempo: "ada", jatuhTempo: "lewat" }), 6);
});

test("KPI: nilai & populasi mengikuti ringkasan server; batas data hanya diaku bila server menandai terpotong", () => {
  const data = { invoices: [], terpotong: true, ringkasan: { total: 12, nilaiBelumLunas: 5000000, lewatTempo: 3, tanpaJatuhTempo: 4, dariStatusManual: 2 } };
  assert.deepEqual(kpiInvoice(data), { jumlah: 12, sisaBelumLunas: 5000000, lewat: 3, tanpaTempo: 4, manual: 2, terpotong: true });
  assert.deepEqual(kpiInvoice(null), { jumlah: 0, sisaBelumLunas: 0, lewat: 0, tanpaTempo: 0, manual: 0, terpotong: false });
  const penuh = kalimatHasil({ tampil: 500, termuat: 500, terpotong: true });
  assert.equal(penuh.teks, "500 invoice"); assert.ok(penuh.catatan && penuh.terpotong);
  const saring = kalimatHasil({ tampil: 3, termuat: 40, terpotong: false });
  assert.equal(saring.teks, "3 dari 40 invoice"); assert.equal(saring.catatan, undefined);
});
