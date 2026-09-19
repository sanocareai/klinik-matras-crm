import test from "node:test";
import assert from "node:assert/strict";
import { createLimiter, createFailureLimiter, clientIp, resetRateLimits } from "../src/lib/rateLimit.js";

function fakeRes() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test("createLimiter: lolos sampai max, lalu 429 dengan Retry-After; kunci berbeda terpisah", () => {
  resetRateLimits();
  const lim = createLimiter({ windowMs: 60_000, max: 3, keyFn: (r) => r.k, message: "pelan" });
  let lolos = 0;
  for (let i = 0; i < 3; i++) lim({ k: "a" }, fakeRes(), () => { lolos++; });
  assert.equal(lolos, 3);
  const res = fakeRes();
  lim({ k: "a" }, res, () => assert.fail("tidak boleh lolos"));
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, "RATE_LIMITED");
  assert.ok(Number(res.headers["Retry-After"]) >= 1);
  let b = 0;
  lim({ k: "b" }, fakeRes(), () => { b++; });
  assert.equal(b, 1);
  lim({ k: null }, fakeRes(), () => { b++; });
  assert.equal(b, 2, "tanpa kunci = dilewati");
});

test("createFailureLimiter: hanya kegagalan yang dihitung; success mereset; blokir tidak diperpanjang", () => {
  resetRateLimits();
  const lim = createFailureLimiter({ windowMs: 60_000, max: 3 });
  lim.fail("x"); lim.fail("x");
  assert.equal(lim.check("x").blocked, false);
  lim.success("x");
  lim.fail("x"); lim.fail("x");
  assert.equal(lim.check("x").blocked, false, "success harus mereset hitungan");
  lim.fail("x");
  const g = lim.check("x");
  assert.equal(g.blocked, true);
  assert.ok(g.retryAfterSeconds > 0 && g.retryAfterSeconds <= 60);
  const sisa = g.retryAfterSeconds;
  lim.fail("x"); lim.fail("x");
  assert.ok(lim.check("x").retryAfterSeconds <= sisa, "kegagalan lanjutan tidak memperpanjang blokir");
  assert.equal(lim.check("y").blocked, false);
});

test("clientIp: X-Forwarded-For hanya dipercaya dari proxy privat, dan yang dipakai entri TERAKHIR (bukan yang dipalsukan klien)", () => {
  const dariNginx = { socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } };
  assert.equal(clientIp(dariNginx), "203.0.113.9");
  const langsung = { socket: { remoteAddress: "198.51.100.7" }, headers: { "x-forwarded-for": "6.6.6.6" } };
  assert.equal(clientIp(langsung), "198.51.100.7", "header dari sumber publik diabaikan");
  assert.equal(clientIp({ socket: { remoteAddress: "::ffff:10.0.0.5" }, headers: { "x-forwarded-for": "1.2.3.4" } }), "1.2.3.4");
  assert.equal(clientIp({ socket: {}, headers: {} }), "unknown");
});
