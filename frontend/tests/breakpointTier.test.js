// Regresi D-XXX (22 Sep 2026) — tier lebar layar untuk tabel dengan kolom
// gabungan (Expenses/Purchases: Kategori+Divisi → Klasifikasi, dst). Lihat
// komentar panjang di src/hooks/useBreakpointTier.js untuk kenapa tabel ini
// SENGAJA pindah dari CSS hideBelow murni ke matchMedia + render kondisional
// (table-layout:fixed mematok lebar kolom yang display:none juga, meledak
// kalau ada 3 representasi kolom sekaligus di DOM).
import test from "node:test";
import assert from "node:assert/strict";
import { tierFromWidth, TIER_QUERY } from "../src/hooks/useBreakpointTier.js";

test("tierFromWidth: batas persis 768/1400/1600, tidak ada celah atau tumpang tindih", () => {
  // Batas "mid" 1400 (bukan 1280) — lihat komentar panjang di
  // useBreakpointTier.js: 1280px terbukti (QA visual + geometry dump)
  // TIDAK cukup ruang untuk kolom gabungan + Keterangan yang masih
  // terbaca sekaligus, begitu sidebar & kolom wajib (Nomor/Tanggal/
  // Nominal/Status/Bukti/Aksi) dihitung.
  assert.equal(tierFromWidth(320), "mobile");
  assert.equal(tierFromWidth(767), "mobile");
  assert.equal(tierFromWidth(768), "compact");
  assert.equal(tierFromWidth(1024), "compact");
  assert.equal(tierFromWidth(1280), "compact");
  assert.equal(tierFromWidth(1399), "compact");
  assert.equal(tierFromWidth(1400), "mid");
  assert.equal(tierFromWidth(1440), "mid");
  assert.equal(tierFromWidth(1599), "mid");
  assert.equal(tierFromWidth(1600), "uw");
  assert.equal(tierFromWidth(1920), "uw");
  assert.equal(tierFromWidth(2560), "uw");
});

test("tierFromWidth: SETIAP integer 0-3000 dapat tepat satu tier (tidak ada celah, tidak pernah undefined)", () => {
  for (let w = 0; w <= 3000; w += 1) {
    const t = tierFromWidth(w);
    assert.ok(["mobile", "compact", "mid", "uw"].includes(t), `width=${w} → "${t}" bukan tier yang dikenal`);
  }
});

test("TIER_QUERY: literal media query cocok dengan batas tierFromWidth (dua sumber kebenaran dikunci sinkron)", () => {
  assert.equal(TIER_QUERY.uw, "(min-width: 1600px)");
  assert.equal(TIER_QUERY.mid, "(min-width: 1400px) and (max-width: 1599.98px)");
  assert.equal(TIER_QUERY.compact, "(min-width: 768px) and (max-width: 1399.98px)");
  assert.equal(TIER_QUERY.mobile, "(max-width: 767.98px)");
});
