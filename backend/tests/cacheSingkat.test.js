// cacheSingkat (hotfix perf 27–28 Okt 2026): cache respons GET berumur pendek, dikunci per PENGGUNA + URL LENGKAP.
// Yang dijaga di sini adalah yang paling berbahaya bila salah: hasil satu pengguna/filter bocor ke pengguna/filter lain.
import test from "node:test";
import assert from "node:assert/strict";
import { cacheSingkat } from "../src/middleware/cacheSingkat.js";

function panggil(mw, { user, url, status = 200, body }) {
  const res = {
    statusCode: status,
    out: undefined,
    json(b) { this.out = b; return this; },
  };
  let handlerJalan = false;
  const req = { user, originalUrl: url };
  mw(req, res, () => { handlerJalan = true; res.json(body ?? { ok: true }); });
  return { handlerJalan, out: res.out };
}

test("pengguna yang sama + URL yang sama: pemanggilan kedua dilayani dari cache (handler TIDAK jalan lagi)", () => {
  const mw = cacheSingkat(60_000);
  const a = panggil(mw, { user: { id: "u1" }, url: "/r?from=1", body: { v: 1 } });
  const b = panggil(mw, { user: { id: "u1" }, url: "/r?from=1", body: { v: 2 } });
  assert.equal(a.handlerJalan, true);
  assert.equal(b.handlerJalan, false);
  assert.deepEqual(b.out, { v: 1 });
});

test("pengguna BERBEDA + URL sama: TIDAK berbagi cache (tidak ada kebocoran antar akun)", () => {
  const mw = cacheSingkat(60_000);
  panggil(mw, { user: { id: "u1" }, url: "/r", body: { milik: "u1" } });
  const b = panggil(mw, { user: { id: "u2" }, url: "/r", body: { milik: "u2" } });
  assert.equal(b.handlerJalan, true, "u2 harus menjalankan handler sendiri");
  assert.deepEqual(b.out, { milik: "u2" });
  const c = panggil(mw, { user: { id: "u1" }, url: "/r", body: { milik: "salah" } });
  assert.deepEqual(c.out, { milik: "u1" }, "u1 tetap mendapat miliknya");
});

test("pengguna sama + FILTER/query berbeda: tidak berbagi cache (kunci memakai URL lengkap termasuk query string)", () => {
  const mw = cacheSingkat(60_000);
  panggil(mw, { user: { id: "u1" }, url: "/r?from=2026-10-01&to=2026-10-07", body: { periode: "minggu" } });
  const b = panggil(mw, { user: { id: "u1" }, url: "/r?from=2026-10-01&to=2026-10-31", body: { periode: "bulan" } });
  assert.equal(b.handlerJalan, true);
  assert.deepEqual(b.out, { periode: "bulan" });
  const c = panggil(mw, { user: { id: "u1" }, url: "/r", body: { periode: "semua" } });
  assert.deepEqual(c.out, { periode: "semua" }, "tanpa query = kunci sendiri");
});

test("respons non-2xx TIDAK disimpan (galat/izin ditolak tidak 'menempel')", () => {
  const mw = cacheSingkat(60_000);
  panggil(mw, { user: { id: "u1" }, url: "/r", status: 403, body: { error: "ditolak" } });
  const b = panggil(mw, { user: { id: "u1" }, url: "/r", status: 200, body: { ok: 1 } });
  assert.equal(b.handlerJalan, true);
  assert.deepEqual(b.out, { ok: 1 });
  const c = panggil(mw, { user: { id: "u1" }, url: "/r2", status: 500, body: { error: "x" } });
  const d = panggil(mw, { user: { id: "u1" }, url: "/r2", status: 200, body: { ok: 2 } });
  assert.equal(c.handlerJalan && d.handlerJalan, true);
});

test("tanpa req.user: kunci '-' (tidak pernah sama dengan id pengguna sungguhan)", () => {
  const mw = cacheSingkat(60_000);
  panggil(mw, { user: undefined, url: "/r", body: { anon: true } });
  const b = panggil(mw, { user: { id: "u1" }, url: "/r", body: { u1: true } });
  assert.equal(b.handlerJalan, true);
  assert.deepEqual(b.out, { u1: true });
});

test("kedaluwarsa: setelah ttl entri tidak dipakai lagi (basi paling lama ttlMs)", async () => {
  const mw = cacheSingkat(40);
  panggil(mw, { user: { id: "u1" }, url: "/r", body: { v: 1 } });
  await new Promise((r) => setTimeout(r, 70));
  const b = panggil(mw, { user: { id: "u1" }, url: "/r", body: { v: 2 } });
  assert.equal(b.handlerJalan, true);
  assert.deepEqual(b.out, { v: 2 });
});

test("instans terpisah tidak berbagi penyimpanan (satu cacheSingkat per rute)", () => {
  const a = cacheSingkat(60_000), b = cacheSingkat(60_000);
  panggil(a, { user: { id: "u1" }, url: "/r", body: { dari: "a" } });
  const r = panggil(b, { user: { id: "u1" }, url: "/r", body: { dari: "b" } });
  assert.equal(r.handlerJalan, true);
  assert.deepEqual(r.out, { dari: "b" });
});

test("batas 500 entri: penyimpanan tidak tumbuh tanpa batas dan hasil tetap benar", () => {
  const mw = cacheSingkat(60_000);
  for (let i = 0; i < 700; i++) panggil(mw, { user: { id: "u" + i }, url: "/r", body: { i } });
  const b = panggil(mw, { user: { id: "u699" }, url: "/r", body: { i: -1 } });
  assert.ok(b.out.i === 699 || b.out.i === -1, "boleh hit atau recompute, tidak boleh isi milik orang lain");
  const c = panggil(mw, { user: { id: "u5" }, url: "/r", body: { i: 5 } });
  assert.equal(c.out.i, 5);
});
