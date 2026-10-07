import test from "node:test";
import assert from "node:assert/strict";
import { formatTanggalJamWIB, formatDurasiSingkatID, formatTimelineEvent, TIDAK_TERSEDIA } from "./routeTimelineFormat.js";

test("formatTanggalJamWIB mengonversi UTC ke WIB (+7 jam) dengan benar", () => {
  // 2026-10-07T10:55:13Z -> 17.55 WIB
  assert.equal(formatTanggalJamWIB("2026-10-07T10:55:13.000Z"), "7 Okt 2026, 17.55");
  // Lintas tengah malam: 2026-10-07T17:30:00Z -> 8 Okt 00.30 WIB
  assert.equal(formatTanggalJamWIB("2026-10-07T17:30:00.000Z"), "8 Okt 2026, 00.30");
});

test("formatTanggalJamWIB: null/tidak valid -> Tidak tersedia, tidak pernah mengarang", () => {
  assert.equal(formatTanggalJamWIB(null), TIDAK_TERSEDIA);
  assert.equal(formatTanggalJamWIB("bukan-tanggal"), TIDAK_TERSEDIA);
});

test("formatDurasiSingkatID: jam+menit, menit saja, dan <1 menit", () => {
  assert.equal(formatDurasiSingkatID(70 * 60 * 1000), "1 j 10 mnt");
  assert.equal(formatDurasiSingkatID(45 * 60 * 1000), "45 mnt");
  assert.equal(formatDurasiSingkatID(120 * 60 * 1000), "2 j");
  assert.equal(formatDurasiSingkatID(10 * 1000), "<1 mnt");
  assert.equal(formatDurasiSingkatID(null), null);
});

test("formatTimelineEvent: null -> null (pemanggil yang menampilkan Tidak tersedia)", () => {
  assert.equal(formatTimelineEvent(null), null);
});

test("formatTimelineEvent: sinkronisasi terlambat berlabel, waktu janggal berlabel, normal tanpa catatan", () => {
  const normal = formatTimelineEvent({
    action: "JOB_ARRIVED", displayAt: "2026-10-07T10:00:00.000Z", hasDeviceTime: true,
    isLateSync: false, isSuspiciousClock: false, lateSyncMs: 500,
  });
  assert.equal(normal.label, "Tiba di lokasi");
  assert.equal(normal.catatan.length, 0);

  const telat = formatTimelineEvent({
    action: "JOB_COMPLETED", displayAt: "2026-10-07T10:00:00.000Z", hasDeviceTime: true,
    isLateSync: true, isSuspiciousClock: false, lateSyncMs: 5 * 60 * 1000,
  });
  assert.match(telat.catatan[0], /Disinkronkan terlambat/);
  assert.match(telat.catatan[0], /5 mnt/);

  const janggal = formatTimelineEvent({
    action: "JOB_STARTED", displayAt: "2026-10-07T10:00:00.000Z", hasDeviceTime: true,
    isLateSync: false, isSuspiciousClock: true, lateSyncMs: -120000,
  });
  assert.match(janggal.catatan[0], /masa depan/);

  const tanpaDeviceTime = formatTimelineEvent({
    action: "ROUTE_STARTED", displayAt: "2026-10-07T10:00:00.000Z", hasDeviceTime: false,
    isLateSync: false, isSuspiciousClock: false, lateSyncMs: null,
  });
  assert.match(tanpaDeviceTime.catatan[0], /jam server/);
});
