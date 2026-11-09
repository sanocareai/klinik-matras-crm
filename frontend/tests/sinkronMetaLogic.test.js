import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { KEADAAN_SINKRON, hookRateTampil, waktuWibTeks } from "../src/features/laporan/sinkronMetaLogic.js";

test("semua keadaan server punya label", () => {
  for (const k of ["BELUM_DIKONFIGURASI", "NONAKTIF", "BELUM_PERNAH_BERJALAN", "BERJALAN", "GAGAL", "SELISIH_KONTROL", "DATA_TERLAMBAT", "SUKSES"]) assert.ok(KEADAAN_SINKRON[k]?.label, k);
});
test("hook rate: null bukan 0%, coverage dan versi ikut", () => {
  assert.deepEqual(hookRateTampil(null), { teks: "—", coverage: null, versi: null });
  assert.equal(hookRateTampil({ total: { nilai: null, coverage: { persen: null }, versi: "V" } }).teks, "—");
  const h = hookRateTampil({ total: { nilai: 36.11, coverage: { persen: 99.9 }, versi: "V" } }); assert.equal(h.teks, "36,11%"); assert.equal(h.coverage, 99.9); assert.equal(h.versi, "V");
});
test("waktu WIB; kosong = —", () => { assert.equal(waktuWibTeks(null), "—"); assert.match(waktuWibTeks("2026-11-08T00:00:00Z"), /WIB$/); });
test("panel terpasang di Kesehatan & referensi; galat akses tidak menjatuhkan panel lain", () => {
  const s = fs.readFileSync(new URL("../src/features/laporan/components/marketing/KesehatanReferensi.jsx", import.meta.url), "utf8");
  assert.match(s, /<StatusSinkronMeta s=\{s\} \/>/); assert.match(s, /galatStatus/);
});

test("format panel: waktu WIB seragam, tanggal ramah, status dan sumber berlabel", async () => {
  const { tanggalTeks, statusRunTeks, sumberReferensiTeks } = await import("../src/features/laporan/sinkronMetaLogic.js");
  assert.equal(waktuWibTeks("2026-11-09T19:00:02Z"), "10 Nov 2026, 02.00 WIB", "UTC malam = WIB hari berikutnya");
  assert.equal(waktuWibTeks("bukan-waktu"), "—");
  assert.equal(tanggalTeks("2026-11-09"), "9 Nov 2026"); assert.equal(tanggalTeks(null), "—");
  assert.equal(statusRunTeks("SUKSES"), "Sukses"); assert.equal(statusRunTeks("KODE_BARU"), "KODE_BARU");
  assert.equal(sumberReferensiTeks(["COMPOSIO", "ADS_MANAGER_EXPORT", "MANUAL"]), "Sinkron otomatis (Composio) · Ekspor Ads Manager · Manual");
  assert.equal(sumberReferensiTeks([]), "—");
});
