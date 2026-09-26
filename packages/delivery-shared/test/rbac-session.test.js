import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../src/api/client.js";
import { createSessionManager } from "../src/session.js";
import { canUseControlApp, deliveryExpenseAbilities, AccessDeniedError } from "../src/rbac.js";

const memStorage = () => { const m = new Map(); return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); }, _m: m }; };
const json = (status, body) => ({ status, ok: status < 300, headers: { get: () => null }, text: async () => JSON.stringify(body), json: async () => body });

function server(routes) {
  return async (url, init) => {
    const path = url.replace(/^https:\/\/x\.test\/api/, "");
    const h = routes[`${init.method || "GET"} ${path}`];
    if (!h) return json(404, { error: "no route" });
    return h(init);
  };
}

test("capabilities: hanya deliveryControlApp === true yang boleh; tidak menebak dari role", () => {
  assert.equal(canUseControlApp({ deliveryControlApp: true }), true);
  assert.equal(canUseControlApp({ deliveryControlApp: false }), false);
  assert.equal(canUseControlApp({ deliveryControlApp: "true" }), false);
  assert.equal(canUseControlApp(null), false);
  assert.equal(canUseControlApp({ role: "ADMIN" }), false, "role saja tidak cukup");
});

test("izin biaya armada terpisah dan default mati", () => {
  assert.deepEqual(deliveryExpenseAbilities({}), { submit: false, verify: false, approve: false, requestRevision: false, pay: false });
  assert.deepEqual(deliveryExpenseAbilities({ deliveryExpense: { submit: true, approve: true } }), { submit: true, verify: false, approve: true, requestRevision: false, pay: false });
});

test("signIn: akun tanpa akses (Driver) ditolak dan token TIDAK tersisa", async () => {
  const st = memStorage();
  const client = createApiClient({ serverUrl: "https://x.test", storage: st, fetchImpl: server({
    "POST /auth/login": () => json(200, { token: "TOK" }),
    "GET /delivery-control/session": () => json(403, { error: "Anda tidak punya akses untuk aksi ini" }),
  }) });
  const s = createSessionManager({ client, storage: st });
  await assert.rejects(s.signIn("d@x", "pw"), (e) => e instanceof AccessDeniedError);
  assert.equal(client.getToken(), null);
  assert.equal(st._m.has("token"), false);
  assert.equal(st._m.has("session:user"), false);
});

test("signIn: Admin berhak masuk, sesi + cache tersimpan", async () => {
  const st = memStorage();
  const client = createApiClient({ serverUrl: "https://x.test", storage: st, fetchImpl: server({
    "POST /auth/login": () => json(200, { token: "TOK" }),
    "GET /delivery-control/session": () => json(200, { id: "a1", role: "ADMIN", capabilities: { deliveryControlApp: true } }),
  }) });
  const s = createSessionManager({ client, storage: st });
  const session = await s.signIn("a@x", "pw");
  assert.equal(session.user.id, "a1");
  assert.equal(session.capabilities.deliveryControlApp, true);
  assert.equal(client.getToken(), "TOK");
  assert.ok(st._m.get("session:user"));
});

test("restore: izin dicabut di server -> sesi dibersihkan; server mati -> pakai cache (offline)", async () => {
  const st = memStorage();
  let mode = "ok";
  const client = createApiClient({ serverUrl: "https://x.test", storage: st, sleep: async () => {}, retryDelaysMs: [], fetchImpl: async (url) => {
    if (mode === "down") throw new Error("network");
    if (mode === "revoked") return json(403, { error: "Anda tidak punya akses" });
    return json(200, { id: "a1", capabilities: { deliveryControlApp: true } });
  } });
  const s = createSessionManager({ client, storage: st });
  await client.setToken("TOK");
  assert.ok(await s.restore());
  mode = "down";
  const off = await s.restore();
  assert.equal(off.offline, true);
  mode = "revoked";
  assert.equal(await s.restore(), null);
  assert.equal(st._m.has("token"), false);
});
