// Aturan murni penjadwalan langsung: Run lama di luar cohort TIDAK lagi menghalangi jadwal Admin; antrean "Belum dijadwalkan" = siap + menunggu tiba; hambatan nyata tetap menghalangi.
import test from "node:test";
import assert from "node:assert/strict";
import { ANTREAN_TAB, ANTREAN_TABS, ANTREAN_TAB_BELUM, normalizeJadwalInput, penghalangJadwal, tabAntrean } from "../src/lib/domain/productionRencanaAdmin.js";

const dasar = { unitStatus: "RECEIVED", orderStatus: "PROCESSING", isInternal: false, customerStage: "NEW", pkrKurang: null, v2Owned: false };

test("Run lama di luar cohort tidak menghalangi jadwal Admin (parameter lama diabaikan); hambatan nyata tetap menghalangi", () => {
  assert.equal(penghalangJadwal({ ...dasar, runOutsideCohort: true }), null, "menjadwalkan tidak menyentuh Run/riwayat lama");
  assert.equal(penghalangJadwal({ ...dasar }), null);
  assert.equal(penghalangJadwal({ ...dasar, unitStatus: "DELIVERED" }).code, "UNIT_FINISHED"); assert.equal(penghalangJadwal({ ...dasar, unitStatus: "CANCELLED" }).code, "UNIT_CANCELLED");
  assert.equal(penghalangJadwal({ ...dasar, v2Owned: true }).code, "UNIT_V2_OWNED"); assert.equal(penghalangJadwal({ ...dasar, orderStatus: "NEW" }).code, "ORDER_BELUM_DIPROSES");
  assert.equal(penghalangJadwal({ ...dasar, pkrKurang: { nomor: "PKR-1", kurang: ["ukuran"] } }).code, "PKR_PERLU_DILENGKAPI"); assert.equal(penghalangJadwal({ ...dasar, isInternal: true }).code, "INTERNAL_OR_SPAM");
});

test("antrean: satu daftar Belum dijadwalkan = siap + menunggu tiba; penyaring lama tetap; unit belum tiba tidak dilempar ke keputusan", () => {
  assert.deepEqual([...ANTREAN_TAB_BELUM], [ANTREAN_TAB.SIAP, ANTREAN_TAB.MENUNGGU_TIBA]); assert.ok(ANTREAN_TABS.includes(ANTREAN_TAB.BELUM) && ANTREAN_TABS.includes(ANTREAN_TAB.SIAP) && ANTREAN_TABS.includes(ANTREAN_TAB.MENUNGGU_TIBA));
  assert.equal(tabAntrean({ terjadwal: false, penghalang: null, diterima: false }), ANTREAN_TAB.MENUNGGU_TIBA); assert.equal(tabAntrean({ terjadwal: false, penghalang: null, diterima: true }), ANTREAN_TAB.SIAP);
  assert.equal(tabAntrean({ terjadwal: false, penghalang: { code: "X" }, diterima: true }), ANTREAN_TAB.KEPUTUSAN); assert.equal(tabAntrean({ terjadwal: true, penghalang: null, diterima: true }), ANTREAN_TAB.TERJADWAL);
  assert.ok(ANTREAN_TAB_BELUM.includes(tabAntrean({ terjadwal: false, penghalang: null, diterima: false })), "belum tiba masuk satu daftar yang sama");
});

test("masukan jadwal: tanggal lewat dan Minggu ditolak; meja boleh kosong (hanya tanggal); meja liar ditolak", () => {
  const now = new Date("2026-10-28T03:00:00Z"); // Rabu WIB
  assert.equal(normalizeJadwalInput({ productionDate: "2026-10-28", stationCode: "TABLE_2" }, { now }).stationCode, "TABLE_2"); assert.equal(normalizeJadwalInput({ productionDate: "2026-10-29" }, { now }).stationCode, null);
  assert.throws(() => normalizeJadwalInput({ productionDate: "2026-10-27" }, { now }), (e) => e.code === "JADWAL_TANGGAL_LEWAT");
  assert.throws(() => normalizeJadwalInput({ productionDate: "2026-11-01" }, { now }), (e) => e.code === "JADWAL_HARI_LIBUR");
  assert.throws(() => normalizeJadwalInput({ productionDate: "2026-10-29", stationCode: "TABLE_9" }, { now }), (e) => e.code === "JADWAL_MEJA_INVALID");
});
