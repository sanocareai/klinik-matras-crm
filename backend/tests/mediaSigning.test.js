import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "rahasia-uji";
const { signFile, verifyFileSignature, FILE_PATTERN } = await import("../src/lib/mediaSigning.js");

const FILE = "a".repeat(40) + ".jpg";

test("signFile → verifyFileSignature sah; file/exp/sig yang diubah gagal", () => {
  const { exp, sig } = signFile(FILE);
  assert.equal(verifyFileSignature(FILE, exp, sig), true);
  assert.equal(verifyFileSignature("b".repeat(40) + ".jpg", exp, sig), false);
  assert.equal(verifyFileSignature(FILE, exp + 1, sig), false);
  assert.equal(verifyFileSignature(FILE, exp, "00".repeat(32)), false);
  assert.equal(verifyFileSignature(FILE, exp, "bukan-hex"), false);
  assert.equal(verifyFileSignature(FILE, "abc", sig), false);
  assert.equal(verifyFileSignature(FILE, exp, undefined), false);
});

test("kedaluwarsa ditolak; ttl bisa diatur", () => {
  const t0 = Date.UTC(2026, 8, 19, 10, 0, 0);
  const { exp, sig } = signFile(FILE, { now: t0, ttlSeconds: 60 });
  assert.equal(verifyFileSignature(FILE, exp, sig, { now: t0 + 30_000 }), true);
  assert.equal(verifyFileSignature(FILE, exp, sig, { now: t0 + 61_000 }), false);
});

test("MEDIA_SIGNING_SECRET diutamakan dan tanda tangan lama tidak berlaku setelah kunci diganti", () => {
  const a = signFile(FILE, { now: 1_000_000 });
  process.env.MEDIA_SIGNING_SECRET = "kunci-media-khusus";
  const b = signFile(FILE, { now: 1_000_000 });
  assert.notEqual(a.sig, b.sig);
  assert.equal(verifyFileSignature(FILE, b.exp, b.sig, { now: 1_000_000 }), true);
  assert.equal(verifyFileSignature(FILE, a.exp, a.sig, { now: 1_000_000 }), false);
  delete process.env.MEDIA_SIGNING_SECRET;
});

test("FILE_PATTERN hanya menerima 40 hex + .jpg / _t.jpg", () => {
  assert.ok(FILE_PATTERN.test(FILE));
  assert.ok(FILE_PATTERN.test("a".repeat(40) + "_t.jpg"));
  for (const bad of ["../x.jpg", "a.jpg", "A".repeat(40) + ".jpg", "a".repeat(41) + ".jpg", "a".repeat(40) + ".png", "a".repeat(40) + ".jpg/x"]) {
    assert.equal(FILE_PATTERN.test(bad), false, bad);
  }
});
