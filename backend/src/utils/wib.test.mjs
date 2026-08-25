import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveResponseMinutes } from "./wib.js";

// Kasus-kasus ini datang langsung dari diskusi dengan owner (25 Agustus
// 2026) — rata-rata respons mentah (14 jam 30 menit) menyesatkan karena
// digelembungkan pesan malam yang baru dibalas paginya. Skema di sini
// SENGAJA bukan filter kaku "cuma hitung kalau dua-duanya di jam 09-21" —
// itu salah ke arah lain (balasan jam 22:00 utk pesan 21:30 akan
// terdistorsi), makanya kasus "balas di luar jam operasional" di bawah
// WAJIB tetap hijau kalau skemanya diubah lagi nanti.
test("pesan malam, balas pagi berikutnya — jendela tutup dibuang penuh", () => {
  const got = effectiveResponseMinutes(new Date("2026-08-25T16:00:00Z"), new Date("2026-08-26T02:05:00Z"));
  assert.ok(Math.abs(got - 5) < 0.01, `expected ~5, got ${got}`);
});

test("balas di luar jam operasional (malam ke malam) — TIDAK dinolkan/didistorsi", () => {
  const got = effectiveResponseMinutes(new Date("2026-08-25T14:30:00Z"), new Date("2026-08-25T15:00:00Z"));
  assert.ok(Math.abs(got - 30) < 0.01, `expected 30 (wall-clock apa adanya), got ${got}`);
});

test("pesan siang, balas siang besoknya — hanya jendela tutup semalam yang dibuang", () => {
  const got = effectiveResponseMinutes(new Date("2026-08-25T07:00:00Z"), new Date("2026-08-26T04:00:00Z"));
  assert.ok(Math.abs(got - 540) < 0.01, `expected 540 (9 jam), got ${got}`);
});

test("balas sebelum jam buka (pagi-pagi) — simetris dengan kasus malam, tidak didistorsi", () => {
  const got = effectiveResponseMinutes(new Date("2026-08-24T23:45:00Z"), new Date("2026-08-25T00:00:00Z"));
  assert.ok(Math.abs(got - 15) < 0.01, `expected 15, got ${got}`);
});

test("dalam jam operasional biasa — sama persis dengan wall-clock", () => {
  const got = effectiveResponseMinutes(new Date("2026-08-25T03:00:00Z"), new Date("2026-08-25T03:20:00Z"));
  assert.ok(Math.abs(got - 20) < 0.01, `expected 20, got ${got}`);
});

test("pesan masuk SETELAH jendela tutup mulai — jangan buang bagian sebelum pesan ada", () => {
  // Pesan jam 22:00 WIB (sudah tutup, bukan jam 21:00) → balas 2 siang besok.
  // Cuma 22:00-09:00 (11 jam) yang boleh dibuang, BUKAN 21:00-09:00 (12 jam) —
  // 21:00-22:00 terjadi SEBELUM pesan ada sama sekali.
  const got = effectiveResponseMinutes(new Date("2026-08-25T15:00:00Z"), new Date("2026-08-26T07:00:00Z"));
  assert.ok(Math.abs(got - 300) < 0.01, `expected 300 (5 jam), got ${got}`);
});

test("rentang 2 malam tertutup (Senin siang -> Rabu pagi)", () => {
  const got = effectiveResponseMinutes(new Date("2026-08-24T07:00:00Z"), new Date("2026-08-26T04:00:00Z"));
  assert.ok(Math.abs(got - 1260) < 0.01, `expected 1260 (21 jam), got ${got}`);
});

test("selisih nol / balasan sebelum pesan — tidak pernah negatif", () => {
  assert.equal(effectiveResponseMinutes(new Date("2026-08-25T07:00:00Z"), new Date("2026-08-25T07:00:00Z")), 0);
  assert.equal(effectiveResponseMinutes(new Date("2026-08-25T07:00:00Z"), new Date("2026-08-25T06:00:00Z")), 0);
});
