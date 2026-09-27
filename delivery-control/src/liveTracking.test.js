import test from "node:test";
import assert from "node:assert/strict";
import { batasPeta, bentukArmada, kesegaran, kunciMarker, periksaPosisi, ringkasArmada, umurLabel, umurMenit } from "./lib/liveTracking.js";

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

test("periksaPosisi: koordinat & timestamp divalidasi; (0,0), NaN, jam rusak/masa depan tidak jadi marker", () => {
  const ok = { lat: -6.2, lng: 106.8, recordedAt: menitLalu(3) };
  assert.deepEqual(periksaPosisi(ok, NOW), { valid: true, alasan: null, menit: 3 });
  assert.equal(periksaPosisi(null, NOW).alasan, "BELUM_ADA");
  assert.equal(periksaPosisi({ ...ok, lat: 0, lng: 0 }, NOW).alasan, "KOORDINAT_TIDAK_VALID");
  assert.equal(periksaPosisi({ ...ok, lat: "abc" }, NOW).alasan, "KOORDINAT_TIDAK_VALID");
  assert.equal(periksaPosisi({ ...ok, lat: 91 }, NOW).alasan, "KOORDINAT_TIDAK_VALID");
  assert.equal(periksaPosisi({ ...ok, lng: 181 }, NOW).alasan, "KOORDINAT_TIDAK_VALID");
  assert.equal(periksaPosisi({ ...ok, recordedAt: null }, NOW).alasan, "WAKTU_TIDAK_VALID");
  assert.equal(periksaPosisi({ ...ok, recordedAt: "bukan-tanggal" }, NOW).alasan, "WAKTU_TIDAK_VALID");
  assert.equal(periksaPosisi({ ...ok, recordedAt: new Date(NOW + 30 * 60000).toISOString() }, NOW).alasan, "WAKTU_MASA_DEPAN");
  assert.deepEqual(periksaPosisi({ ...ok, recordedAt: new Date(NOW + 2 * 60000).toISOString() }, NOW), { valid: true, alasan: null, menit: 0 }, "selisih jam kecil ditoleransi");
});

test("bentukArmada: 'terdaftar' dibedakan dari 'punya posisi'; posisi rusak masuk daftar tanpa marker", () => {
  const rusak = [
    ...TRACKING,
    { kind: "route", routeId: "r3", routeCode: "RTE-3", driverName: "Dedi", phase: "EN_ROUTE", activeJobId: null, stops: [], lastPosition: { lat: 0, lng: 0, recordedAt: menitLalu(1) } },
    { kind: "route", routeId: "r4", routeCode: "RTE-4", driverName: "Eko", phase: "EN_ROUTE", activeJobId: null, stops: [], lastPosition: { lat: -6.1, lng: 106.7, recordedAt: "xx" } },
  ];
  const a = bentukArmada(rusak, RUTE, NOW);
  const r = ringkasArmada(a);
  assert.deepEqual(r, { terdaftar: 5, denganPosisi: 2, tanpaPosisi: 3, posisiLama: 1 });
  assert.equal(a.find((x) => x.key === "r3").alasanTanpaPosisi, "KOORDINAT_TIDAK_VALID");
  assert.equal(a.find((x) => x.key === "r3").segar.label, "Koordinat GPS tidak valid");
  assert.equal(a.find((x) => x.key === "r4").marker, null);
  assert.equal(a.find((x) => x.key === "r2").alasanTanpaPosisi, "BELUM_ADA");
  assert.equal(kunciMarker(a), "j9|r1", "kunci hanya dari yang punya posisi (untuk fit ulang saat himpunan berubah)");
  assert.deepEqual(ringkasArmada([]), { terdaftar: 0, denganPosisi: 0, tanpaPosisi: 0, posisiLama: 0 });
});

test("bentukArmada membawa URL foto driver/helper dari respons agregat (bukan path storage); kosong = null", () => {
  const a = bentukArmada([
    { kind: "route", routeId: "r1", driverName: "Andi", helperName: "Budi", driverAvatarUrl: "/uploads/avatars/a.png", helperAvatarUrl: null, stops: [], lastPosition: null },
    { kind: "loose", jobId: "j1", driverName: "Rian", driverAvatarUrl: "/uploads/avatars/r.png", lastPosition: null },
  ], [], NOW);
  assert.equal(a.find((x) => x.key === "r1").fotoDriver, "/uploads/avatars/a.png");
  assert.equal(a.find((x) => x.key === "r1").fotoHelper, null);
  assert.equal(a.find((x) => x.key === "j1").fotoDriver, "/uploads/avatars/r.png");
});
