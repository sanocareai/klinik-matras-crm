// Posisi scroll per tab dalam-app: penyimpan murni (lib/posisiScrollTab.js). Perilaku di browser dibuktikan terpisah (dua tab, Chrome).
import test from "node:test";
import assert from "node:assert/strict";
import { buatPenyimpanScroll, terapkanScroll } from "../src/lib/posisiScrollTab.js";

test("tab yang belum pernah dicatat kembali ke atas (tidak mewarisi tab lain)", () => {
  const s = buatPenyimpanScroll();
  s.catatUtama("A", 1400);
  assert.deepEqual(s.ambil("B"), { utama: 0, dalam: [] });
  assert.equal(s.ambil("A").utama, 1400);
});

test("posisi dipisah per tab dan diperbarui oleh catatan terbaru", () => {
  const s = buatPenyimpanScroll();
  s.catatUtama("A", 100); s.catatUtama("B", 250); s.catatUtama("A", 900);
  assert.equal(s.ambil("A").utama, 900); assert.equal(s.ambil("B").utama, 250);
});

test("nilai tidak sah diabaikan; negatif dipotong ke 0", () => {
  const s = buatPenyimpanScroll();
  s.catatUtama("A", NaN); s.catatUtama(null, 10); s.catatUtama("A", -5);
  assert.equal(s.ambil("A").utama, 0); assert.equal(s.ukuran(), 1);
});

test("panel dalam: dipulihkan; elemen yang sudah lepas dari dokumen dibuang", () => {
  const s = buatPenyimpanScroll();
  const hidup = { isConnected: true, scrollTop: 0 }; const mati = { isConnected: false, scrollTop: 0 };
  s.catatDalam("A", hidup, 140); s.catatDalam("A", mati, 60);
  const p = s.ambil("A");
  assert.equal(p.dalam.length, 1);
  const utama = { scrollTop: 0 };
  terapkanScroll(p, utama);
  assert.equal(hidup.scrollTop, 140); assert.equal(mati.scrollTop, 0);
  assert.equal(utama.scrollTop, 0);
});

test("terapkanScroll memulihkan penggulir utama; tanpa penggulir tidak melempar galat", () => {
  const s = buatPenyimpanScroll(); s.catatUtama("A", 1400);
  const utama = { scrollTop: 0 }; terapkanScroll(s.ambil("A"), utama); assert.equal(utama.scrollTop, 1400);
  assert.doesNotThrow(() => terapkanScroll(s.ambil("A"), null));
});

test("sisakan membuang catatan tab yang sudah ditutup", () => {
  const s = buatPenyimpanScroll(); s.catatUtama("A", 1); s.catatUtama("B", 2); s.catatUtama("C", 3);
  s.sisakan(["A", "C"]);
  assert.equal(s.ukuran(), 2); assert.equal(s.ambil("B").utama, 0);
});
