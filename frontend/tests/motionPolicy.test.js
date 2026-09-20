import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Kebijakan motion (lihat komentar "KEBIJAKAN MOTION & PAINT" di styles/tokens.css):
// index.css tidak boleh menganimasikan properti layout/paint mahal, dan tidak boleh
// punya animasi idle yang berulang selain daftar yang memang informatif.
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

const transitions = [...css.matchAll(/transition:\s*([^;}]+)[;}]/g)].map((m) => m[1].trim());
const animations = [...css.matchAll(/(?<![-\w])animation:\s*([^;}]+)[;}]/g)].map((m) => m[1].trim());

test("transisi tidak menganimasikan all/width/height/top/left/box-shadow/filter/margin/padding", () => {
  // Pengecualian sadar: bar progres informatif (lebar = nilai) berdurasi pendek.
  const ALLOW = /^width 0\.(15|2)s ease$/;
  const bad = transitions.filter((t) => /(^|,\s*)(all|width|height|top|left|right|bottom|box-shadow|filter|backdrop-filter|margin[\w-]*|padding[\w-]*|max-height|grid-template-columns)\b/.test(t) && !ALLOW.test(t));
  assert.deepEqual(bad, []);
});

test("durasi transisi <= 220 ms", () => {
  const tooLong = [];
  for (const t of transitions) for (const m of t.matchAll(/([0-9.]+)(ms|s)\b/g)) {
    const ms = m[2] === "s" ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
    if (ms > 220) tooLong.push(t);
  }
  assert.deepEqual([...new Set(tooLong)], []);
});

test("tidak ada animasi berulang (infinite) selain spinner, titik rekam, skeleton", () => {
  const infinite = animations.filter((a) => /infinite/.test(a));
  const ALLOW = /^(spin |rec-pulse |skeleton-pulse )/;
  assert.deepEqual(infinite.filter((a) => !ALLOW.test(a)), []);
});

test("animasi masuk (bukan infinite) <= 250 ms kecuali kilas sorot pesan", () => {
  const long = [];
  for (const a of animations.filter((x) => !/infinite/.test(x) && !/^bubbleFlash/.test(x) && x !== "none")) {
    const ms = parseFloat((a.match(/([0-9.]+)s\b/) || [0, 0])[1]) * 1000;
    if (ms > 250) long.push(a);
  }
  assert.deepEqual(long, []);
});

test("keyframes hanya memakai transform/opacity (kecuali kilas sorot & shimmer AI)", () => {
  const frames = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})+)\s*\}/g)];
  const bad = [];
  for (const [, name, body] of frames) {
    if (/^bubbleFlash/.test(name)) continue;
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    const off = props.filter((p) => !["transform", "opacity"].includes(p));
    if (off.length) bad.push(`${name}: ${[...new Set(off)]}`);
  }
  assert.deepEqual(bad, []);
});

test("prefers-reduced-motion dihormati secara global & Ringan mematikan efek dekoratif", () => {
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-iteration-count: 1 !important/);
  assert.match(tokens, /\[data-perf="lite"\][\s\S]*backdrop-filter: none !important/);
  assert.match(tokens, /\[data-perf="lite"\] \.skeleton/);
});
