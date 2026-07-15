// Regression Wave 4B.0.6 — parseSuggestions robustness (PURE). Jalankan:
//   node --test src/services/replyAssistant/promptParser.test.mjs
// Ditemukan saat kalibrasi live (VPS, Claude Haiku asli): Haiku kadang membungkus
// JSON dalam markdown code fence dan/atau output terpotong maxTokens di tengah
// array — parser LAMA menampilkan sampah sintaks ("```json","[","{") sebagai
// draf palsu ke sales (2 dari 42 generate di kalibrasi live: A10-Run1, C5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSuggestions } from "./prompt.js";

test("parser: JSON polos (tanpa fence) tetap jalan — no regression", () => {
  const r = parseSuggestions('[{"text":"Halo kak, boleh cerita dulu keluhannya?","tone":"hangat"}]');
  assert.deepEqual(r, [{ text: "Halo kak, boleh cerita dulu keluhannya?", tone: "hangat" }]);
});

test("parser: JSON dibungkus markdown code fence ```json ... ``` → tetap ter-parse bersih", () => {
  const fenced = '```json\n[\n  {"text":"Boleh cerita dulu keluhan kasurnya kak?","tone":"hangat"},\n  {"text":"Berat badannya berapa ya?","tone":"informatif"}\n]\n```';
  const r = parseSuggestions(fenced);
  assert.equal(r.length, 2);
  assert.equal(r[0].text, "Boleh cerita dulu keluhan kasurnya kak?");
  assert.ok(r.every((s) => !/```/.test(s.text)));
});

test("parser: array terpotong (maxTokens) → objek LENGKAP diselamatkan, objek terpotong dibuang", () => {
  const truncated = '```json\n[\n  {"text":"King Koil fokus teknologi umum, kami fokus PAS & PRESISI.","tone":"informatif"},\n  {"text":"Boleh cerita dulu, kasur sekarang ada kelu';
  const r = parseSuggestions(truncated);
  assert.equal(r.length, 1);
  assert.equal(r[0].text, "King Koil fokus teknologi umum, kami fokus PAS & PRESISI.");
});

test("parser: pola sampah PERSIS yang terlihat di kalibrasi live (A10-Run1/C5) → TIDAK menghasilkan draf palsu", () => {
  const observedGarbage = "```json\n[\n{";
  const r = parseSuggestions(observedGarbage);
  assert.equal(r.length, 0); // kosong → orchestrator fallback ke template, BUKAN tampilkan "```json"/"["/"{" sbg draf
  assert.ok(!r.some((s) => /^[`[\]{}]+$/.test(s.text)));
});

test("parser: fence tanpa label bahasa (``` polos) tetap dibersihkan", () => {
  const r = parseSuggestions('```\n[{"text":"Contoh draf aman","tone":"hangat"}]\n```');
  assert.equal(r.length, 1);
  assert.equal(r[0].text, "Contoh draf aman");
});

test("parser: fallback baris terakhir tidak pernah meloloskan baris sintaks murni", () => {
  const notJson = "```json\n[\n{\n  bukan JSON valid sama sekali tanpa tanda kurung penutup";
  const r = parseSuggestions(notJson);
  assert.ok(r.every((s) => s.text.length > 0 && !/^[`[\]{}]+$/.test(s.text)));
});

test("parser: input kosong → array kosong (tidak crash)", () => {
  assert.deepEqual(parseSuggestions(""), []);
  assert.deepEqual(parseSuggestions("   "), []);
  assert.deepEqual(parseSuggestions(undefined), []);
});
