// Tes pembakuan nomor HP Indonesia yang diketik manusia.
//
// Kenapa diuji ketat: fitur "cari nomor lalu chat" memakai hasil fungsi
// ini untuk MEMBUAT Customer baru. Kalau pembakuannya meleset, satu orang
// bisa punya beberapa Customer terpisah hanya karena beda cara ketik —
// dan riwayat chat & ordernya ikut terpecah, yang jauh lebih mahal
// diperbaiki belakangan daripada dicegah di sini.

import test from "node:test";
import assert from "node:assert/strict";
import { bakukanNomorIndonesia } from "../src/services/nomorIndonesia.js";

test("berbagai gaya ketik nomor yang SAMA menghasilkan satu bentuk baku", () => {
  const sama = [
    "085187283900",
    "0851-8728-3900",
    "0851 8728 3900",
    "+6285187283900",
    "+62 851 8728 3900",
    "6285187283900",
    "85187283900",       // tanpa 0 maupun 62
    "(0851) 87283900",
  ];
  for (const gaya of sama) {
    const h = bakukanNomorIndonesia(gaya);
    assert.equal(h.ok, true, `harusnya diterima: ${gaya} (${h.alasan})`);
    assert.equal(h.nomor, "6285187283900", `salah baku untuk: ${gaya}`);
  }
});

test("620... ditolak — hasil mengetik +62 DAN 0 sekaligus", () => {
  // Bentuk ini tampak benar sekilas, itu sebabnya berbahaya: kalau
  // diloloskan, nomornya tidak pernah ada di WhatsApp tapi Customer-nya
  // terlanjur dibuat.
  const h = bakukanNomorIndonesia("+62085187283900");
  assert.equal(h.ok, false);
  assert.match(h.alasan, /jangan pakai 0 setelah 62/i);
});

test("nomor terlalu pendek / panjang ditolak dengan alasan jelas", () => {
  assert.equal(bakukanNomorIndonesia("0851").ok, false);
  assert.match(bakukanNomorIndonesia("0851").alasan, /pendek/i);
  assert.equal(bakukanNomorIndonesia("0851872839001234567").ok, false);
  assert.match(bakukanNomorIndonesia("0851872839001234567").alasan, /panjang/i);
});

test("nomor non-Indonesia ditolak", () => {
  const h = bakukanNomorIndonesia("+1 415 555 2671");
  assert.equal(h.ok, false);
  assert.match(h.alasan, /Indonesia/i);
});

test("kosong / null tidak melempar error", () => {
  for (const v of ["", null, undefined, "   ", "abc"]) {
    const h = bakukanNomorIndonesia(v);
    assert.equal(h.ok, false);
    assert.ok(h.alasan, "harus selalu ada alasan yang bisa ditampilkan ke sales");
  }
});
