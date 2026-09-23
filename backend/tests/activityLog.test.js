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

// Hardening insentif driver (23 September 2026) — kalimat linimasa untuk
// koreksi POD admin harus menyebut field yang BERUBAH (bukti nilai
// lama→baru ada di metadata.changes, lihat test integrasi POD edit yang
// memverifikasi tx.activityEvent.create menerima from/to sesungguhnya).
test("POD_EDITED menyebut field yang berubah dan alasan koreksi", () => {
  const kalimat = formatActivitySentence({
    eventType: EVENT_TYPES.POD_EDITED,
    metadata: {
      orderNumber: "ORD-001",
      reason: "Driver salah dipilih",
      changes: {
        driverId: { from: "user-lama", to: "user-baru" },
        completedAt: { from: "2026-09-01T03:00:00.000Z", to: "2026-09-01T10:00:00.000Z" },
      },
    },
  });
  assert.match(kalimat, /ORD-001/);
  assert.match(kalimat, /driver/);
  assert.match(kalimat, /waktu selesai/);
  assert.match(kalimat, /Driver salah dipilih/);
});

// Audit hasSim (24 September 2026) — kalimat harus menyebut arah perubahan
// (punya SIM <-> tanpa SIM) dan tarif yang berlaku SETELAH perubahan.
test("HAS_SIM_CHANGED menyebut arah perubahan dan tarif baru", () => {
  const jadiPunya = formatActivitySentence({
    eventType: EVENT_TYPES.HAS_SIM_CHANGED, metadata: { from: false, to: true, source: "armada.drivers.patch" },
  });
  assert.match(jadiPunya, /tanpa SIM/);
  assert.match(jadiPunya, /punya SIM/);
  assert.match(jadiPunya, /Rp7\.000/);

  const jadiTanpa = formatActivitySentence({
    eventType: EVENT_TYPES.HAS_SIM_CHANGED, metadata: { from: true, to: false, source: "armada.drivers.patch" },
  });
  assert.match(jadiTanpa, /Rp3\.000/);
  assert.notEqual(jadiPunya, jadiTanpa);
});

// Snapshot Insentif Driver (24 September 2026).
test("INCENTIVE_SNAPSHOT_CREATED menyebut periode dan total; menandai kalau ini adjustment", () => {
  const biasa = formatActivitySentence({
    eventType: EVENT_TYPES.INCENTIVE_SNAPSHOT_CREATED,
    metadata: { periodFrom: "2026-09-01", periodTo: "2026-09-30", totalAlamat: 12, totalRupiah: 84000 },
  });
  assert.match(biasa, /2026-09-01/); assert.match(biasa, /2026-09-30/);
  assert.match(biasa, /12 alamat/); assert.match(biasa, /84.000|84000/);
  assert.doesNotMatch(biasa, /koreksi/);

  const adjustment = formatActivitySentence({
    eventType: EVENT_TYPES.INCENTIVE_SNAPSHOT_CREATED,
    metadata: { periodFrom: "2026-09-01", periodTo: "2026-09-30", totalAlamat: 1, totalRupiah: 7000, adjustsSnapshotId: "snap-lama" },
  });
  assert.match(adjustment, /koreksi/i);
});

test("INCENTIVE_SNAPSHOT_APPROVED dan INCENTIVE_SNAPSHOT_REJECTED menyebut isi yang berbeda", () => {
  const disetujui = formatActivitySentence({
    eventType: EVENT_TYPES.INCENTIVE_SNAPSHOT_APPROVED,
    metadata: { periodFrom: "2026-09-01", periodTo: "2026-09-30", totalRupiah: 84000 },
  });
  assert.match(disetujui, /disetujui/i);

  const ditolak = formatActivitySentence({
    eventType: EVENT_TYPES.INCENTIVE_SNAPSHOT_REJECTED,
    metadata: { periodFrom: "2026-09-01", periodTo: "2026-09-30", reason: "Data POD masih dikoreksi" },
  });
  assert.match(ditolak, /ditolak/i);
  assert.match(ditolak, /Data POD masih dikoreksi/);
});

test("INCENTIVE_SNAPSHOT_ADJUSTED (di snapshot ASAL) menyebut id snapshot koreksi dan alasan", () => {
  const kalimat = formatActivitySentence({
    eventType: EVENT_TYPES.INCENTIVE_SNAPSHOT_ADJUSTED,
    metadata: { adjustmentSnapshotId: "snap-baru-123", reason: "Driver salah tercatat" },
  });
  assert.match(kalimat, /snap-baru-123/);
  assert.match(kalimat, /Driver salah tercatat/);
});

// Pembayaran Insentif (24 September 2026).
test("INCENTIVE_PAYOUT_CREATED menyebut nominal, metode, referensi, dan sisa", () => {
  const kalimat = formatActivitySentence({
    eventType: EVENT_TYPES.INCENTIVE_PAYOUT_CREATED,
    metadata: { amount: 21000, method: "TRANSFER", referenceNumber: "TRX-001", sisaSebelum: 21000, sisaSesudah: 0 },
  });
  assert.match(kalimat, /21\.000|21000/);
  assert.match(kalimat, /TRANSFER/);
  assert.match(kalimat, /TRX-001/);
});

test("INCENTIVE_PAYOUT_VOIDED menyebut alasan dan sisa setelah dibatalkan", () => {
  const kalimat = formatActivitySentence({
    eventType: EVENT_TYPES.INCENTIVE_PAYOUT_VOIDED,
    metadata: { amount: 21000, method: "TRANSFER", reason: "Salah nominal", sisaSebelum: 0, sisaSesudah: 21000 },
  });
  assert.match(kalimat, /dibatalkan/i);
  assert.match(kalimat, /Salah nominal/);
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
