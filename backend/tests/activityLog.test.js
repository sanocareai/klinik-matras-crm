// Tes activityLog.js (Production Core Slice 1) — bagian MURNI saja
// (formatActivitySentence). recordActivity() menyentuh database lewat `tx`
// dan diverifikasi lewat jalur yang sama dengan tabel ledger lain di repo
// ini: pemeriksaan langsung setelah deploy, bukan mock Prisma (lihat pola
// di scopeRevision.test.js / orderStatusSync.test.js).

import test from "node:test";
import assert from "node:assert/strict";

import { recordActivity, formatActivitySentence, EVENT_TYPES } from "../src/lib/activityLog.js";

// --- recordActivity: pemeriksaan kontrak, bukan tulis ke database ----------
test("recordActivity menolak dipanggil tanpa `tx` — mencegah insert di luar transaksi mutasinya", async () => {
  await assert.rejects(
    () => recordActivity(undefined, { entityType: "unit", entityId: "u1", eventType: "X" }),
    /tx/
  );
  await assert.rejects(
    () => recordActivity({}, { entityType: "unit", entityId: "u1", eventType: "X" }),
    /tx/,
    "objek tanpa .activityEvent (bukan klien transaksi Prisma) harus ditolak juga"
  );
});

test("recordActivity menolak field wajib yang kosong", async () => {
  const fakeTx = { activityEvent: { create: async (args) => args.data } };
  await assert.rejects(() => recordActivity(fakeTx, { entityId: "u1", eventType: "X" }));
  await assert.rejects(() => recordActivity(fakeTx, { entityType: "unit", eventType: "X" }));
  await assert.rejects(() => recordActivity(fakeTx, { entityType: "unit", entityId: "u1" }));
});

test("recordActivity meneruskan data apa adanya ke tx.activityEvent.create", async () => {
  let captured = null;
  const fakeTx = { activityEvent: { create: async (args) => { captured = args.data; return { id: "evt1", ...args.data }; } } };
  await recordActivity(fakeTx, {
    entityType: "unit", entityId: "u1", eventType: EVENT_TYPES.PRIORITY_CHANGED,
    actorId: "user1", metadata: { from: "NORMAL", to: "URGENT" },
  });
  assert.equal(captured.entityType, "unit");
  assert.equal(captured.entityId, "u1");
  assert.equal(captured.eventType, "PRIORITY_CHANGED");
  assert.equal(captured.actorType, "USER"); // default
  assert.deepEqual(captured.metadata, { from: "NORMAL", to: "URGENT" });
});

// --- formatActivitySentence: murni, tanpa database --------------------------
test("PRIORITY_CHANGED -> kalimat menyebut label Indonesia dari-ke", () => {
  const kalimat = formatActivitySentence({
    eventType: EVENT_TYPES.PRIORITY_CHANGED, metadata: { from: "NORMAL", to: "URGENT" },
  });
  assert.match(kalimat, /Normal/);
  assert.match(kalimat, /Mendesak/);
});

test("DUE_DATE_CHANGED terisi -> menyebut tanggalnya; dihapus -> kalimat berbeda", () => {
  const diatur = formatActivitySentence({
    eventType: EVENT_TYPES.DUE_DATE_CHANGED, metadata: { from: null, to: "2026-09-10T14:00:00.000Z" },
  });
  assert.match(diatur, /2026-09-10/);

  const dihapus = formatActivitySentence({
    eventType: EVENT_TYPES.DUE_DATE_CHANGED, metadata: { from: "2026-09-10T14:00:00.000Z", to: null },
  });
  assert.match(dihapus, /dihapus/);
  assert.notEqual(diatur, dihapus);
});

test("SERVICE_ASSIGNED -> menyebut label layanan", () => {
  const kalimat = formatActivitySentence({
    eventType: EVENT_TYPES.SERVICE_ASSIGNED, metadata: { serviceLabel: "Full Upgrade" },
  });
  assert.match(kalimat, /Full Upgrade/);
});

// --- Production Core Slice 3: eksekusi tahap (STAGE_*) ----------------------
test("STAGE_STARTED -> menyebut nama tahap", () => {
  const kalimat = formatActivitySentence({ eventType: EVENT_TYPES.STAGE_STARTED, metadata: { stage: "Uji Fondasi" } });
  assert.match(kalimat, /Uji Fondasi/);
  assert.match(kalimat, /started/);
});

test("STAGE_PAUSED -> menyebut label alasan jeda; note ikut tampil kalau ada", () => {
  const tanpaNote = formatActivitySentence({
    eventType: EVENT_TYPES.STAGE_PAUSED, metadata: { stage: "Jahit", reason: "BREAK" },
  });
  assert.match(tanpaNote, /Break/);
  assert.doesNotMatch(tanpaNote, /:/); // tanpa note, tidak ada titik dua kosong

  const denganNote = formatActivitySentence({
    eventType: EVENT_TYPES.STAGE_PAUSED, metadata: { stage: "Jahit", reason: "OTHER", note: "Menunggu instruksi" },
  });
  assert.match(denganNote, /Other/);
  assert.match(denganNote, /Menunggu instruksi/);
});

test("STAGE_RESUMED -> menyebut nama tahap, tidak menyebut alasan (itu urusan PAUSE)", () => {
  const kalimat = formatActivitySentence({ eventType: EVENT_TYPES.STAGE_RESUMED, metadata: { stage: "Jahit" } });
  assert.match(kalimat, /Jahit/);
  assert.match(kalimat, /resumed/);
});

test("STAGE_COMPLETED -> menyebut Touch time kalau timing diketahui; polos kalau tidak (legacy)", () => {
  const denganTouch = formatActivitySentence({
    eventType: EVENT_TYPES.STAGE_COMPLETED, metadata: { stage: "Jahit", touchSeconds: 70 * 60 },
  });
  assert.match(denganTouch, /Touch time/);
  assert.match(denganTouch, /1h 10m/);

  const tanpaTouch = formatActivitySentence({
    eventType: EVENT_TYPES.STAGE_COMPLETED, metadata: { stage: "Jahit", touchSeconds: null },
  });
  assert.doesNotMatch(tanpaTouch, /Touch time/);
  assert.match(tanpaTouch, /completed/);
});

test("eventType yang tidak dikenal tidak pernah melempar error — linimasa tidak boleh gagal render", () => {
  assert.doesNotThrow(() => formatActivitySentence({ eventType: "SESUATU_YANG_BARU", metadata: {} }));
  assert.equal(formatActivitySentence({ eventType: "SESUATU_YANG_BARU", metadata: {} }), "SESUATU_YANG_BARU");
  assert.doesNotThrow(() => formatActivitySentence(null));
  assert.doesNotThrow(() => formatActivitySentence({}));
});

test("setiap EVENT_TYPES yang didaftarkan modul ini punya kalimat spesifik (bukan jatuh ke default)", () => {
  for (const eventType of Object.values(EVENT_TYPES)) {
    const kalimat = formatActivitySentence({ eventType, metadata: {} });
    assert.notEqual(kalimat, eventType, `${eventType} jatuh ke cabang default — lupa ditangani di formatActivitySentence`);
  }
});
