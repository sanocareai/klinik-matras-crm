import test from "node:test";
import assert from "node:assert/strict";
import { eventBadges, durationLine, stopRows } from "./timelineView.js";

test("eventBadges: sinkron terlambat, jam janggal, dikoreksi — urutan tetap; event biasa tanpa penanda", () => {
  assert.deepEqual(eventBadges({}).map((b) => b.key), []);
  assert.deepEqual(eventBadges({ lateSync: true, suspect: true, effectiveSource: "KOREKSI" }).map((b) => b.key), ["late", "clock", "fix"]);
  assert.equal(eventBadges({ suspect: true })[0].tone, "danger");
});

test("durationLine: hanya angka yang ada; catatan alasan bila tidak dihitung; kosong bila tak ada bukti waktu", () => {
  assert.equal(durationLine({ travelDurationText: "30 menit", serviceDurationText: "1 jam" }), "Perjalanan: 30 menit · Layanan: 1 jam");
  assert.equal(durationLine({ travelDurationText: null, travelDurationNote: "Durasi tidak dihitung — jam perangkat janggal", serviceDurationText: "10 menit" }), "Durasi tidak dihitung — jam perangkat janggal · Layanan: 10 menit");
  assert.equal(durationLine({}), "");
  assert.equal(durationLine(null), "");
});

test("stopRows: tonggak bertanda waktu + 'Tidak tersedia' untuk yang tanpa bukti (tidak dikarang); riwayat koreksi lengkap", () => {
  const rows = stopRows({
    events: [{ id: "e1", action: "JOB_STARTED", label: "Menuju lokasi", at: "2026-10-07T03:00:00.000Z", atText: "7 Okt 2026 10:00 WIB", actorName: "Budi", sourceLabel: "Driver App", receivedText: "7 Okt 2026 10:40 WIB", lateSync: true,
      corrections: [{ actorName: "Admin", fromText: "7 Okt 2026 10:00 WIB", toText: "7 Okt 2026 10:05 WIB", reason: "Driver lupa menekan" }] }],
    missing: [{ action: "JOB_ARRIVED", label: "Tiba di lokasi", atText: "Tidak tersedia" }],
  });
  assert.equal(rows[0].meta, "oleh Budi · Driver App"); assert.equal(rows[0].receivedText, "diterima server 7 Okt 2026 10:40 WIB");
  assert.deepEqual(rows[0].badges.map((b) => b.key), ["late"]); assert.match(rows[0].corrections[0], /Alasan: Driver lupa menekan/);
  assert.deepEqual([rows[1].label, rows[1].atText, rows[1].missing], ["Tiba di lokasi", "Tidak tersedia", true]);
  assert.deepEqual(stopRows(null), []);
});
