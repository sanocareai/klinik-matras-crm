import test from "node:test";
import assert from "node:assert/strict";
import { batasPeta, bentukArmada, kesegaran, umurLabel, umurMenit } from "./lib/liveTracking.js";

const NOW = Date.UTC(2026, 8, 27, 3, 0, 0);
const menitLalu = (m) => new Date(NOW - m * 60000).toISOString();

test("kesegaran posisi: segar <=5, lambat <=15, lama >15, tanpa GPS", () => {
  assert.equal(kesegaran(0).kode, "SEGAR");
  assert.equal(kesegaran(5).kode, "SEGAR");
  assert.equal(kesegaran(6).kode, "LAMBAT");
  assert.equal(kesegaran(15).kode, "LAMBAT");
  assert.equal(kesegaran(16).kode, "LAMA");
  assert.equal(kesegaran(null).kode, "TANPA");
  assert.equal(umurMenit(menitLalu(7), NOW), 7);
  assert.equal(umurMenit(null, NOW), null);
  assert.equal(umurLabel(0), "Baru saja");
  assert.equal(umurLabel(45), "45 menit lalu");
  assert.equal(umurLabel(125), "2 jam lalu");
  assert.equal(umurLabel(null), "Belum ada posisi GPS");
});

const TRACKING = [
  { kind: "route", routeId: "r1", routeCode: "RTE-1", driverName: "Andi", helperName: "Budi", driverOnline: true, phase: "EN_ROUTE", activeJobId: "j2",
    lastPosition: { lat: -6.2, lng: 106.8, accuracy: 12, recordedAt: menitLalu(2) },
    stops: [{ jobId: "j1", status: "COMPLETED" }, { jobId: "j2", status: "EN_ROUTE", customerName: "Klinik Sehat", orderNumber: "RES-2" }] },
  { kind: "route", routeId: "r2", routeCode: "RTE-2", driverName: "Joko", driverOnline: false, phase: "WAITING", activeJobId: null, lastPosition: null, stops: [] },
  { kind: "loose", jobId: "j9", status: "EN_ROUTE", driverName: "Rian", driverOnline: true, orderNumber: "RES-9", customerName: "Bu Rina",
    lastPosition: { lat: -6.3, lng: 106.9, recordedAt: menitLalu(40) } },
];
const RUTE = [{ id: "r1", vehicle: { plateNumber: "B 9123 KMS" } }, { id: "r2", vehicle: null }];

test("bentukArmada: gabung kendaraan dari rute, marker hanya dari GPS asli, urut tersegar dulu", () => {
  const a = bentukArmada(TRACKING, RUTE, NOW);
  assert.deepEqual(a.map((x) => x.key), ["r1", "j9", "r2"]);
  const r1 = a[0];
  assert.equal(r1.kendaraan, "B 9123 KMS");
  assert.equal(r1.driver, "Andi");
  assert.equal(r1.helper, "Budi");
  assert.equal(r1.kodeRute, "RTE-1");
  assert.deepEqual([r1.stopSelesai, r1.stopTotal, r1.berikutnya, r1.order], [1, 2, "Klinik Sehat", "RES-2"]);
  assert.equal(r1.segar.kode, "SEGAR");
  assert.deepEqual(r1.marker, { lat: -6.2, lng: 106.8, akurasi: 12 });
  assert.equal(r1.dataTerakhir, menitLalu(2));
  const loose = a[1];
  assert.equal(loose.kind, "loose");
  assert.equal(loose.segar.kode, "LAMA");
  assert.equal(loose.jobId, "j9");
  const tanpa = a[2];
  assert.equal(tanpa.marker, null, "tanpa GPS tidak dibuatkan marker (depot bukan posisi driver)");
  assert.equal(tanpa.segar.kode, "TANPA");
  assert.equal(tanpa.kendaraan, null);
});

test("bentukArmada: masukan kosong/rusak tidak membuat crash; koordinat tidak valid tidak jadi marker", () => {
  assert.deepEqual(bentukArmada(null, null, NOW), []);
  assert.deepEqual(bentukArmada([], [], NOW), []);
  const a = bentukArmada([{ kind: "loose", jobId: "x", lastPosition: { lat: "abc", lng: 200, recordedAt: menitLalu(1) } }], [], NOW);
  assert.equal(a[0].marker, null);
});

test("batasPeta memuat semua marker; null bila tidak ada", () => {
  const a = bentukArmada(TRACKING, RUTE, NOW);
  const b = batasPeta(a);
  assert.ok(b.latitude < -6.2 && b.latitude > -6.3);
  assert.ok(b.longitudeDelta >= 0.01 && b.latitudeDelta >= 0.01);
  assert.equal(batasPeta(bentukArmada([TRACKING[1]], RUTE, NOW)), null);
});
