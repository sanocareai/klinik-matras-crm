// Gabungan dua sumber Penjualan Karyawan (order bertanda + dokumen manual) untuk kartu Laporan Sales — dijumlahkan di SERVER.
import test from "node:test";
import assert from "node:assert/strict";
import { gabungkanPenjualanKaryawan } from "../src/services/penjualanKaryawan.js";

const order = { karyawan: [{ staffSellerId: "u1", nama: "Sulaiman / Emon", jumlahOrder: 2, nilai: 2_500_000, terbayar: 1_700_000, sisa: 800_000, orders: [
  { orderNumber: "NEW-27092026-047", tanggal: new Date("2026-09-27T03:00:00Z"), pelanggan: "Sulaiman", nilai: 1_200_000, terbayar: 1_200_000, sisa: 0 },
  { orderNumber: "NEW-01102026-001", tanggal: new Date("2026-10-01T03:00:00Z"), pelanggan: "Sulaiman", nilai: 1_300_000, terbayar: 500_000, sisa: 800_000 },
] }] };
const manual = { karyawan: [
  { sellerId: "u1", nama: "Sulaiman / Emon", jumlah: 1, nilai: 3_850_000, terbayar: 3_850_000, sisa: 0, dokumen: [{ nomor: "PKR-08092026-001", tanggal: "2026-09-08", pembeli: "Bu Ani", nilai: 3_850_000, terbayar: 3_850_000, sisa: 0 }] },
  { sellerId: "u2", nama: "Driver Uji", jumlah: 1, nilai: 1_000_000, terbayar: 0, sisa: 1_000_000, dokumen: [{ nomor: "PKR-02102026-001", tanggal: "2026-10-02", pembeli: "Pak Budi", nilai: 1_000_000, terbayar: 0, sisa: 1_000_000 }] },
] };

test("Menjumlahkan order bertanda + dokumen manual per karyawan dan total; karyawan yang sama digabung satu baris", () => {
  const g = gabungkanPenjualanKaryawan(order, manual);
  assert.equal(g.jumlah, 4);
  assert.equal(g.nilai, 7_350_000);
  assert.equal(g.terbayar, 5_550_000);
  assert.equal(g.sisa, 1_800_000);
  assert.equal(g.karyawan.length, 2);
  const emon = g.karyawan.find((k) => k.id === "u1");
  assert.equal(emon.jumlah, 3);
  assert.equal(emon.nilai, 6_350_000);
  assert.equal(emon.sisa, 800_000);
});

test("Urutan: sisa terbesar dulu; transaksi terbaru dulu dan membawa jenis ORDER/MANUAL", () => {
  const g = gabungkanPenjualanKaryawan(order, manual);
  assert.deepEqual(g.karyawan.map((k) => k.id), ["u2", "u1"], "Driver Uji sisa Rp1 jt > Emon Rp0,8 jt");
  const t = g.karyawan.find((k) => k.id === "u1").transaksi;
  assert.deepEqual(t.map((x) => x.nomor), ["NEW-01102026-001", "NEW-27092026-047", "PKR-08092026-001"]);
  assert.deepEqual(t.map((x) => x.jenis), ["ORDER", "ORDER", "MANUAL"]);
  assert.equal(t[0].tanggal, "2026-10-01");
});

test("Satu sumber kosong tetap jalan; keduanya kosong = nol", () => {
  assert.equal(gabungkanPenjualanKaryawan(order, { karyawan: [] }).jumlah, 2);
  assert.equal(gabungkanPenjualanKaryawan({ karyawan: [] }, manual).jumlah, 2);
  const kosong = gabungkanPenjualanKaryawan(undefined, undefined);
  assert.deepEqual([kosong.jumlah, kosong.nilai, kosong.sisa, kosong.karyawan.length], [0, 0, 0, 0]);
});
