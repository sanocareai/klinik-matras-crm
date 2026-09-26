import test from "node:test";
import assert from "node:assert/strict";
import { PESAN_KEMAMPUAN, perluKunci, statusKemampuan, tafsirHasilBiometrik } from "./lib/kunciApp.js";

const T0 = 1_000_000_000_000;

test("auto-lock: hanya bila biometrik aktif, ada sesi, dan ditinggal >= batas", () => {
  const dasar = { biometrikAktif: true, adaSesi: true, ditinggalMs: T0, menit: 2 };
  assert.equal(perluKunci({ ...dasar, now: T0 + 119_000 }), false);
  assert.equal(perluKunci({ ...dasar, now: T0 + 120_000 }), true);
  assert.equal(perluKunci({ ...dasar, now: T0 + 999_000, biometrikAktif: false }), false);
  assert.equal(perluKunci({ ...dasar, now: T0 + 999_000, adaSesi: false }), false);
  assert.equal(perluKunci({ ...dasar, now: T0 + 999_000, ditinggalMs: null }), false);
  assert.equal(perluKunci({ ...dasar, now: T0 + 60_000, menit: 1 }), true);
  assert.equal(perluKunci({ ...dasar, now: T0 + 14 * 60_000, menit: 15 }), false);
});

test("kemampuan perangkat", () => {
  assert.equal(statusKemampuan({ adaPerangkat: false, terdaftar: false }), "TANPA_PERANGKAT");
  assert.equal(statusKemampuan({ adaPerangkat: true, terdaftar: false }), "BELUM_TERDAFTAR");
  assert.equal(statusKemampuan({ adaPerangkat: true, terdaftar: true }), "SIAP");
  assert.match(PESAN_KEMAMPUAN.TANPA_PERANGKAT, /tidak memiliki sensor/);
  assert.match(PESAN_KEMAMPUAN.BELUM_TERDAFTAR, /Daftarkan/);
});

test("tafsir hasil biometrik: sukses, batal/gagal boleh ulang, dicabut/tidak terdaftar wajib masuk ulang", () => {
  assert.equal(tafsirHasilBiometrik({ success: true }).ok, true);
  for (const k of ["user_cancel", "system_cancel", "app_cancel", "user_fallback"]) {
    const r = tafsirHasilBiometrik({ success: false, error: k });
    assert.deepEqual([r.ok, r.ulang, r.wajibMasukUlang, r.pesan], [false, true, false, ""], k);
  }
  assert.match(tafsirHasilBiometrik({ success: false, error: "authentication_failed" }).pesan, /tidak cocok/);
  assert.equal(tafsirHasilBiometrik({ success: false, error: "lockout" }).ulang, true);
  for (const k of ["not_enrolled", "not_available", "passcode_not_set", "lockout_permanent"]) {
    const r = tafsirHasilBiometrik({ success: false, error: k });
    assert.equal(r.wajibMasukUlang, true, k);
    assert.equal(r.ulang, false, k);
    assert.ok(r.pesan.length > 10, k);
  }
  assert.equal(tafsirHasilBiometrik({ success: false, error: "aneh" }).wajibMasukUlang, false);
  assert.equal(tafsirHasilBiometrik(undefined).ok, false);
});
