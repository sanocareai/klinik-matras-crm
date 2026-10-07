// Bug 7 Okt 2026: pratinjau yang dipotong di tengah emoji menghasilkan karakter yatim yang ditolak Prisma → percakapan tak ter-update.
import test from "node:test";
import assert from "node:assert/strict";
import { buildMessagePreview, buildSearchSnippet, potongAman } from "../src/utils/messagePreview.js";

const yatim = (s) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

test("KASUS NYATA: emoji tepat di batas 80 karakter tidak pernah menghasilkan karakter yatim", () => {
  for (let geser = 70; geser <= 90; geser++) {
    const teks = "a".repeat(geser) + "😊🙏😊🙏 lanjutan pesan yang panjang";
    const p = buildMessagePreview(teks, null);
    assert.equal(yatim(p), false, `geser ${geser}`);
    assert.ok(p.endsWith("…"));
    assert.doesNotThrow(() => JSON.stringify({ p }) && encodeURIComponent(p), `geser ${geser}`); // string yang valid UTF-16
  }
});

test("pesan pendek dan tanpa emoji tidak berubah", () => {
  assert.equal(buildMessagePreview("halo kak", null), "halo kak");
  assert.equal(buildMessagePreview("a".repeat(100), null), "a".repeat(80) + "…");
});

test("emoji utuh di dalam batas tetap dipertahankan", () => {
  assert.equal(buildMessagePreview("Siap pak 🙏🏻", null), "Siap pak 🙏🏻");
});

test("potongAman: tidak membelah di awal maupun akhir", () => {
  const t = "ab😊cd";
  assert.equal(potongAman(t, 0, 3), "ab");
  assert.equal(potongAman(t, 3, 6), "cd");
  assert.equal(potongAman(t, 0, 4), "ab😊");
  assert.equal(potongAman("abc", 0, 99), "abc");
});

test("buildSearchSnippet: potongan di sekitar kata tidak menghasilkan karakter yatim", () => {
  for (let geser = 30; geser <= 45; geser++) {
    const teks = "x".repeat(geser) + "😊" + "y".repeat(10) + "kata" + "z".repeat(30) + "🙏" + "w".repeat(40);
    assert.equal(yatim(buildSearchSnippet(teks, null, "kata")), false, `geser ${geser}`);
  }
});

test("label terstruktur & media tetap sama", () => {
  assert.equal(buildMessagePreview("{}", "location"), "[Lokasi]");
  assert.equal(buildMessagePreview("", "image"), "[Foto]");
});
