// Regression Wave 4B.0.2 — validator hardening (PURE). Jalankan:
//   node --test src/services/replyAssistant/validatorHardening.test.mjs
// Menutup gap P0 (harga terbilang, freebie, garansi flat, klaim medis) + P1,
// dan MENJAGA false-positive guards (ukuran/berat/jumlah orang tetap lolos).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPromise, violations, scrubSuggestions } from "./validator.js";

// ── P0: harga terbilang & fuzzy ───────────────────────────────────────────────
test("P0 price — harga terbilang & jutaan terdeteksi", () => {
  for (const t of ["lima juta", "tiga jutaan", "3 jutaan", "sekitar 5 jutaan", "dua ratus ribu", "harganya 500k"]) {
    assert.ok(hasPromise(t), `harus terdeteksi: "${t}"`);
    assert.ok(violations(t).includes("price"), `kategori price: "${t}"`);
  }
});

// ── P0: freebie ────────────────────────────────────────────────────────────────
test("P0 freebie — gratis/free/bonus terdeteksi", () => {
  for (const t of ["gratis ongkir", "free bantal", "cuma-cuma", "ada bonus sarung kok"]) {
    assert.ok(hasPromise(t), `harus terdeteksi: "${t}"`);
    assert.ok(violations(t).includes("freebie"), `kategori freebie: "${t}"`);
  }
});

// ── P0: garansi flat ─────────────────────────────────────────────────────────────
test("P0 warranty — klaim garansi flat terdeteksi", () => {
  for (const t of ["garansi 20 tahun", "garansi amblas 10 tahun", "garansi dua puluh tahun", "garansi seumur hidup"]) {
    assert.ok(hasPromise(t), `harus terdeteksi: "${t}"`);
    assert.ok(violations(t).includes("warranty"), `kategori warranty: "${t}"`);
  }
});

// ── P0: klaim medis/penyembuhan ──────────────────────────────────────────────────
test("P0 medical — klaim penyembuhan terdeteksi", () => {
  for (const t of ["menyembuhkan HNP", "dijamin sembuh total", "kasur ini mengobati saraf kejepit", "ini obat buat nyeri"]) {
    assert.ok(hasPromise(t), `harus terdeteksi: "${t}"`);
  }
  assert.ok(violations("menyembuhkan HNP").includes("medical"));
});

// ── P1: pengiriman non-digit + over-certainty ───────────────────────────────────
test("P1 delivery/certainty — frasa waktu & jaminan mutlak terdeteksi", () => {
  for (const t of ["dikirim minggu depan", "diantar besok", "pengerjaan 3 hari kerja"]) {
    assert.ok(hasPromise(t), `delivery: "${t}"`);
  }
  for (const t of ["kasur ini pasti cocok untuk Anda", "dijamin nyaman", "100% sehat"]) {
    assert.ok(hasPromise(t), `certainty: "${t}"`);
  }
});

// ── FALSE-POSITIVE GUARDS (Group D) — HARUS tetap lolos (aman) ──────────────────
test("guards — ukuran/berat/jumlah/pertanyaan TIDAK di-scrub", () => {
  const safe = [
    "ukuran 160x200 tersedia",
    "boleh tahu berat badan 70 kg?",
    "kasurnya untuk 2 orang ya?",
    "boleh tahu budget-nya berapa?",
    "garansi kami ada 2 tingkat, nanti tim jelaskan ya",
    "soal harga, tim kami akan konfirmasi sesuai kebutuhan",
    "untuk promo, nanti tim bantu cek ya",
    "semoga lekas membaik ya pak",
    "kami sarankan kasur sehat yang PAS dengan berat badan",
    "kami proses secepatnya ya",
  ];
  for (const t of safe) {
    assert.equal(hasPromise(t), false, `HARUS aman (tidak di-scrub): "${t}" → ${violations(t)}`);
  }
});

// ── scrub campuran: draf bersih dipertahankan, draf melanggar dibuang ────────────
test("scrub — pertahankan yang bersih, buang yang melanggar", () => {
  const kept = scrubSuggestions([
    { text: "Boleh saya bantu pahami kebutuhannya dulu?" },
    { text: "harganya lima juta ya pak" },
    { text: "Kami sarankan ukuran 180 sesuai kebutuhan." },
    { text: "gratis ongkir khusus Anda" },
  ]);
  assert.equal(kept.length, 2);
  assert.ok(kept.every((s) => hasPromise(s.text) === false));
});

// ── existing behaviour tetap ────────────────────────────────────────────────────
test("regresi — deteksi lama tetap jalan", () => {
  assert.ok(hasPromise("harganya Rp5.000.000"));
  assert.ok(hasPromise("diskon 20%"));
  assert.ok(hasPromise("barang sampai 3 hari"));
  assert.equal(hasPromise("Boleh saya bantu pahami keluhannya?"), false);
});
