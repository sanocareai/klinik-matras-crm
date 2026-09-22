// Regresi D-XXX (polish 22 Sep 2026) — tier tabel berbasis lebar CONTAINER
// (ResizeObserver), bukan viewport (window.matchMedia). Lihat komentar
// panjang di src/hooks/useContainerTier.js untuk kenapa.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tierFromContainerWidth, CONTAINER_TIER_THRESHOLD } from "../src/hooks/useContainerTier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("tierFromContainerWidth: batas persis 768/900/1250, tidak ada celah atau tumpang tindih", () => {
  assert.equal(tierFromContainerWidth(320), "card");
  assert.equal(tierFromContainerWidth(767), "card");
  assert.equal(tierFromContainerWidth(768), "minimal");
  assert.equal(tierFromContainerWidth(899), "minimal");
  assert.equal(tierFromContainerWidth(900), "reduced");
  assert.equal(tierFromContainerWidth(1249), "reduced");
  assert.equal(tierFromContainerWidth(1250), "full");
  assert.equal(tierFromContainerWidth(1920), "full");
});

test("tierFromContainerWidth: SETIAP integer 0-2500 dapat tepat satu tier", () => {
  for (let w = 0; w <= 2500; w += 1) {
    const t = tierFromContainerWidth(w);
    assert.ok(["card", "minimal", "reduced", "full"].includes(t), `width=${w} → "${t}" bukan tier yang dikenal`);
  }
});

test("CONTAINER_TIER_THRESHOLD: nilai konstanta sesuai spec (full≥1250, reduced≥900, minimal≥768)", () => {
  assert.equal(CONTAINER_TIER_THRESHOLD.full, 1250);
  assert.equal(CONTAINER_TIER_THRESHOLD.reduced, 900);
  assert.equal(CONTAINER_TIER_THRESHOLD.minimal, 768);
});

// Bug NYATA (bukan teori) ditemukan lewat QA: div pembungkus tabel di
// halaman Finance selalu dirender KONDISIONAL (muncul setelah data selesai
// dimuat — sebelum itu skeleton/empty state, tanpa div ber-ref). Versi awal
// hook ini pakai `useRef` + `useEffect(fn, [])`: effect itu jalan SEKALI
// saat mount pertama, saat mana ref MASIH null (div belum ada) — jadi
// ResizeObserver tidak pernah terpasang, dan karena dependency array kosong
// React tidak pernah menjalankan ulang efeknya begitu div akhirnya muncul.
// Hasilnya tier permanen macet di tebakan awal "full", walau container
// nyatanya cuma 918px (kasus nyata: 1280px viewport, 9 kolom penuh
// dipaksakan muat, table container overflow). Test ini memindai source
// untuk mengunci pola PERBAIKANNYA (callback ref via useCallback — React
// memanggilnya PERSIS saat node DOM terpasang, berapa kali & kapan pun)
// supaya tidak diam-diam ditulis ulang balik ke pola useRef+useEffect yang
// rusak itu.
test("useContainerTier: pakai callback ref (useCallback), BUKAN useRef+useEffect(fn,[]) — cegah bug 'ref masih null saat effect pertama jalan'", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "hooks", "useContainerTier.js"), "utf-8");
  assert.ok(src.includes("useCallback"), "useContainerTier diharapkan memakai useCallback untuk ref-nya (callback ref), bukan useRef+useEffect biasa.");
  assert.ok(
    !/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?ref\.current[\s\S]*?\},\s*\[\]\s*\)/.test(src),
    "Pola LAMA yang rusak (useEffect(() => {... ref.current ...}, [])) terdeteksi lagi — ref div pembungkus tabel dirender kondisional, effect dengan deps [] tidak akan pernah lihat ref-nya kalau div itu baru muncul belakangan. Pakai callback ref."
  );
});
