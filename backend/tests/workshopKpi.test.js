// KPI waktu alur milestone — fungsi murni. Durasi hanya bila kedua timestamp ada & berurutan; selain itu "Data waktu belum tersedia".
import test from "node:test";
import assert from "node:assert/strict";
import { DATA_UNAVAILABLE, DURATIONS, TIMESTAMPS, aggregateDurations, formatMinutes, minutesBetween, timelineOf } from "../src/lib/domain/workshopKpi.js";

const T0 = Date.parse("2026-10-12T01:00:00.000Z");
const at = (min) => new Date(T0 + min * 60_000).toISOString();

test("enam durasi + tujuh timestamp sesuai urutan alur", () => {
  assert.equal(DURATIONS.length, 6); assert.equal(TIMESTAMPS.length, 7);
  assert.deepEqual(DURATIONS.map((d) => d.key), ["pickupToReceived", "receivedToStart", "productionDuration", "finishedToWarehouse", "readyToDelivery", "deliveryDuration"]);
  // rantai: tiap durasi berakhir di timestamp tempat durasi berikutnya dimulai
  for (let i = 1; i < DURATIONS.length; i += 1) assert.equal(DURATIONS[i].from, DURATIONS[i - 1].to);
});

test("alur lengkap: semua enam durasi dihitung; selesai produksi ≠ barang jadi diterima Gudang", () => {
  const tl = timelineOf({ pickupCompletedAt: at(0), receivedAt: at(30), productionStartedAt: at(90), productionFinishedAt: at(300), warehouseAcceptedAt: at(330), deliveryStartedAt: at(480), deliveredAt: at(540) });
  const m = Object.fromEntries(tl.durations.map((d) => [d.key, d.minutes]));
  assert.deepEqual(m, { pickupToReceived: 30, receivedToStart: 60, productionDuration: 210, finishedToWarehouse: 30, readyToDelivery: 150, deliveryDuration: 60 });
  assert.ok(tl.durations.every((d) => d.available && d.reason === null));
  assert.equal(tl.durations[2].text, "3 jam 30 menit");
});

test("data tidak lengkap: durasi yang kedua timestamp-nya tidak ada = 'Data waktu belum tersedia' (tidak ditebak, tidak nol)", () => {
  const tl = timelineOf({ pickupCompletedAt: at(0), productionStartedAt: at(90) }); // tidak ada receivedAt
  const by = Object.fromEntries(tl.durations.map((d) => [d.key, d]));
  assert.equal(by.pickupToReceived.available, false); assert.equal(by.pickupToReceived.text, DATA_UNAVAILABLE); assert.equal(by.pickupToReceived.minutes, null); assert.equal(by.pickupToReceived.reason, "MISSING_TIMESTAMP");
  assert.equal(by.receivedToStart.available, false);
  assert.equal(by.productionDuration.available, false, "belum ada produksi selesai");
  assert.ok(tl.durations.every((d) => d.minutes === null));
  assert.equal(timelineOf({}).durations.every((d) => d.text === DATA_UNAVAILABLE), true);
  assert.equal(formatMinutes(null), DATA_UNAVAILABLE);
});

test("urutan terbalik (jam tidak wajar) tidak dikoreksi — dianggap tidak tersedia dengan alasan ORDER_INVALID", () => {
  const tl = timelineOf({ receivedAt: at(100), productionStartedAt: at(40) });
  const d = tl.durations.find((x) => x.key === "receivedToStart");
  assert.equal(d.available, false); assert.equal(d.reason, "ORDER_INVALID"); assert.equal(d.text, DATA_UNAVAILABLE);
  assert.equal(minutesBetween(at(10), at(10)), 0, "nol menit sah bila kedua timestamp sama");
  assert.equal(minutesBetween("bukan-tanggal", at(1)), null);
});

test("format menit: menit / jam / hari", () => {
  assert.equal(formatMinutes(0), "0 menit"); assert.equal(formatMinutes(45), "45 menit"); assert.equal(formatMinutes(60), "1 jam"); assert.equal(formatMinutes(125), "2 jam 5 menit");
  assert.equal(formatMinutes(1440), "1 hari"); assert.equal(formatMinutes(1440 + 180), "1 hari 3 jam");
});

test("agregat: rata-rata/median hanya dari unit yang punya kedua timestamp; unit tanpa data masuk 'missing'; filter periode memakai timestamp akhir", () => {
  const a = timelineOf({ pickupCompletedAt: at(0), receivedAt: at(20) });
  const b = timelineOf({ pickupCompletedAt: at(0), receivedAt: at(60) });
  const c = timelineOf({ pickupCompletedAt: at(0) }); // belum diterima
  const agg = Object.fromEntries(aggregateDurations([a, b, c]).map((x) => [x.key, x]));
  assert.equal(agg.pickupToReceived.n, 2); assert.equal(agg.pickupToReceived.missing, 1); assert.equal(agg.pickupToReceived.avgMinutes, 40); assert.equal(agg.pickupToReceived.medianMinutes, 40); assert.equal(agg.pickupToReceived.maxMinutes, 60);
  assert.equal(agg.pickupToReceived.avgText, "40 menit");
  assert.equal(agg.deliveryDuration.n, 0); assert.equal(agg.deliveryDuration.avgText, DATA_UNAVAILABLE); assert.equal(agg.deliveryDuration.avgMinutes, null);
  const within = (iso) => new Date(iso) >= new Date(at(30));
  const only = Object.fromEntries(aggregateDurations([a, b, c], { within }).map((x) => [x.key, x]));
  assert.equal(only.pickupToReceived.n, 1); assert.equal(only.pickupToReceived.avgMinutes, 60);
});
