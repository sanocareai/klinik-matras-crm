// Tes parameter dan bentuk respons laporan kohort (services/attribution/cohortReport.js) — murni, tanpa DB.
import test from "node:test";
import assert from "node:assert/strict";
import { parseRentang, susunLaporan, ParameterError, MAKS_BULAN } from "../src/services/attribution/cohortReport.js";
import { buildCohort } from "../src/services/attribution/cohort.js";

const SEKARANG = new Date("2026-10-10T05:00:00Z");   // 10 Okt 2026 12:00 WIB

test("default: sampai = bulan berjalan WIB, dari = 3 bulan sebelumnya", () => {
  assert.deepEqual(parseRentang({}, SEKARANG), { dari: "2026-07", sampai: "2026-10", bulanBerjalan: "2026-10" });
});

test("bulan berjalan ditentukan WIB, bukan UTC (31 Okt 18:00 UTC = 1 Nov WIB)", () => {
  assert.equal(parseRentang({}, new Date("2026-10-31T18:00:00Z")).sampai, "2026-11");
  assert.equal(parseRentang({}, new Date("2026-10-31T16:59:00Z")).sampai, "2026-10");
});

test("rentang eksplisit lintas tahun diterima", () => {
  assert.deepEqual(parseRentang({ dari: "2025-11", sampai: "2026-02" }, SEKARANG), { dari: "2025-11", sampai: "2026-02", bulanBerjalan: "2026-10" });
});

test("parameter tidak valid ditolak dengan ParameterError (400)", () => {
  for (const q of [{ dari: "2026-13" }, { dari: "2026-7" }, { sampai: "okt-2026" }, { dari: "2026-10", sampai: "2026-09" }, { sampai: "2026-11" }, { dari: "2024-01", sampai: "2026-10" }, { dari: "2026-07-01" }]) {
    assert.throws(() => parseRentang(q, SEKARANG), (e) => e instanceof ParameterError && e.statusCode === 400, JSON.stringify(q));
  }
  assert.equal(MAKS_BULAN, 24);
  assert.doesNotThrow(() => parseRentang({ dari: "2024-11", sampai: "2026-10" }, SEKARANG));   // tepat 24 bulan
});

test("susunLaporan: rentang kosong tidak error; peringatan REKONSILIASI_GAGAL muncul bila ada cek gagal", () => {
  const r = buildCohort({ customers: [], orders: [], kontribusi: [] });
  const lap = susunLaporan({ meta: {}, ...r }, { dari: "2026-07", sampai: "2026-10", bulanBerjalan: "2026-10" });
  assert.deepEqual(lap.perBulanLead, {});
  assert.equal(lap.rekonsiliasi.ok, true);
  const rusak = { ...r, rekonsiliasi: { ok: false, cek: [{ id: "x", ok: false, a: 1, b: 2, ket: "" }] } };
  const lap2 = susunLaporan({ meta: {}, ...rusak }, { dari: "2026-07", sampai: "2026-10", bulanBerjalan: "2026-10" });
  assert.deepEqual(lap2.peringatan.find((w) => w.kode === "REKONSILIASI_GAGAL").data.gagal, ["x"]);
});

test("susunLaporan: batasan menyatakan atribusi campaign/ad belum tersedia; definisi memuat tiga tanggal terpisah", () => {
  const lap = susunLaporan({ meta: {}, ...buildCohort({ customers: [], orders: [], kontribusi: [] }) }, { dari: "2026-07", sampai: "2026-10", bulanBerjalan: "2026-10" });
  assert.match(lap.batasan.join(" "), /campaign\/ad set\/ad belum tersedia/);
  assert.deepEqual(Object.keys(lap.tanggal), ["LEAD", "ORDER", "PEMBAYARAN"]);
  assert.ok(lap.definisi.some((d) => d.id === "pernah_ditandai_prospek"));
  assert.ok(!lap.definisi.some((d) => /qualified/i.test(d.id)));
});
