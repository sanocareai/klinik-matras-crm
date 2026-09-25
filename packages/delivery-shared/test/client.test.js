import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient, ApiError, buildQuery, newIdempotencyKey } from "../src/api/client.js";

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); }, _m: m };
}
const res = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  json: async () => body,
});

test("request: kirim Authorization + JSON body, hasil di-decode", async () => {
  const calls = [];
  const c = createApiClient({ serverUrl: "https://x.test", storage: memStorage(), fetchImpl: async (u, i) => { calls.push([u, i]); return res(200, { ok: 1 }); } });
  await c.setToken("T1");
  const out = await c.request("/a", { method: "POST", body: { n: 1 } });
  assert.deepEqual(out, { ok: 1 });
  assert.equal(calls[0][0], "https://x.test/api/a");
  assert.equal(calls[0][1].headers.Authorization, "Bearer T1");
  assert.equal(calls[0][1].body, '{"n":1}');
});

test("401: token dihapus (memori + storage), onUnauthorized dipanggil, ApiError 401", async () => {
  const st = memStorage({ token: "old" });
  let dipanggil = 0;
  const c = createApiClient({ serverUrl: "https://x.test", storage: st, onUnauthorized: () => { dipanggil++; }, fetchImpl: async () => res(401, {}) });
  await c.restoreToken();
  await assert.rejects(c.request("/a"), (e) => e instanceof ApiError && e.status === 401);
  assert.equal(c.getToken(), null);
  assert.equal(st._m.has("token"), false);
  assert.equal(dipanggil, 1);
});

test("X-Refreshed-Token diadopsi dan disimpan", async () => {
  const st = memStorage();
  const c = createApiClient({ serverUrl: "https://x.test", storage: st, fetchImpl: async () => res(200, {}, { "X-Refreshed-Token": "NEW" }) });
  await c.request("/a");
  assert.equal(c.getToken(), "NEW");
  assert.equal(st._m.get("token"), "NEW");
});

test("GET diulang saat 503 lalu berhasil; POST TIDAK diulang", async () => {
  let n = 0;
  const get = createApiClient({ serverUrl: "https://x.test", sleep: async () => {}, fetchImpl: async () => (++n < 3 ? res(503, "down") : res(200, { ok: 1 })) });
  assert.deepEqual(await get.request("/a"), { ok: 1 });
  assert.equal(n, 3);
  let m = 0;
  const post = createApiClient({ serverUrl: "https://x.test", sleep: async () => {}, fetchImpl: async () => { m++; return res(503, "down"); } });
  await assert.rejects(post.request("/a", { method: "POST", body: {} }), (e) => e.status === 503);
  assert.equal(m, 1, "POST tidak boleh diulang otomatis (cegah aksi ganda)");
});

test("pesan error server dibawa apa adanya", async () => {
  const c = createApiClient({ serverUrl: "https://x.test", fetchImpl: async () => res(409, { error: "Sudah diproses" }) });
  await assert.rejects(c.request("/a", { method: "POST", body: {} }), (e) => e.message === "Sudah diproses" && e.status === 409);
});

test("upload: pakai uploadImpl, 4xx jadi ApiError, sukses di-parse", async () => {
  const c = createApiClient({
    serverUrl: "https://x.test",
    uploadImpl: async (url, file, o) => (file.uri === "bad" ? { status: 400, body: JSON.stringify({ error: "Bukan gambar" }) } : { status: 200, body: JSON.stringify({ url: "/media/x.jpg", fieldName: o.fieldName }) }),
  });
  assert.deepEqual(await c.upload("/u", { uri: "ok" }, { fieldName: "bukti" }), { url: "/media/x.jpg", fieldName: "bukti" });
  await assert.rejects(c.upload("/u", { uri: "bad" }), (e) => e.status === 400 && e.message === "Bukan gambar");
});

test("buildQuery & newIdempotencyKey memenuhi format backend", () => {
  assert.equal(buildQuery({ a: 1, b: "", c: null, d: "x y" }), "?a=1&d=x%20y");
  const k = newIdempotencyKey("bd");
  assert.match(k, /^[A-Za-z0-9_\-:.]{8,128}$/);
  assert.notEqual(newIdempotencyKey("bd"), newIdempotencyKey("bd"));
});
