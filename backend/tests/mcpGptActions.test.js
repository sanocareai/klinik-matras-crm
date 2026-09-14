// Tes jembatan REST/OpenAPI ChatGPT Actions (/gpt-actions, src/mcp/gptActions.js).
//
// Sengaja TANPA database — sama seperti tests/mcp.test.js: yang diuji di sini
// adalah lapisan auth/rate-limit (reuse dari security.js, sudah dites di sana)
// dan kontrak REST (openapi.json valid & sinkron dengan tools/list, tool tak
// dikenal ditolak rapi). Memanggil tool sungguhan butuh Postgres — itu di
// luar cakupan tes unit ini, sama seperti mcp.test.js tidak memanggil handler
// tool manapun.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

const TOKEN_UJI = "token-rahasia-untuk-tes-gpt-actions";

// Sama seperti mcp.test.js: import dinamis SETELAH env diset, dan
// MCP_OAUTH_JWT_SECRET dikosongkan secara eksplisit supaya tidak ikut apa pun
// yang ada di backend/.env sungguhan.
async function jalankanServer(env = {}) {
  process.env.MCP_API_TOKEN = env.MCP_API_TOKEN ?? TOKEN_UJI;
  process.env.MCP_OAUTH_JWT_SECRET = env.MCP_OAUTH_JWT_SECRET ?? "";
  const { gptActionsRouter } = await import("../src/mcp/gptActions.js");

  const app = express();
  app.use(express.json());
  app.use("/gpt-actions", gptActionsRouter);

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/gpt-actions`;
  return { url, tutup: () => new Promise((r) => server.close(r)) };
}

function get(url, path, token = TOKEN_UJI) {
  return fetch(`${url}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function post(url, path, body, token = TOKEN_UJI) {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
}

test("tanpa token / token salah ditolak 401 — jalur SAMA dengan /mcp", async (t) => {
  const { url, tutup } = await jalankanServer();
  t.after(tutup);

  const tanpa = await get(url, "/openapi.json", null);
  assert.equal(tanpa.status, 401);

  const salah = await get(url, "/openapi.json", "token-ngasal");
  assert.equal(salah.status, 401);
});

test("kedua jalur auth kosong = fitur mati (503), bukan terbuka bebas", async (t) => {
  const { url, tutup } = await jalankanServer({ MCP_API_TOKEN: "", MCP_OAUTH_JWT_SECRET: "" });
  t.after(tutup);

  const res = await get(url, "/openapi.json", "apa saja");
  assert.equal(res.status, 503);
});

test("GET /openapi.json — OpenAPI 3.1 valid, satu path per tool MCP, tidak ada tool tersembunyi", async (t) => {
  const { url, tutup } = await jalankanServer();
  t.after(tutup);

  const res = await get(url, "/openapi.json");
  assert.equal(res.status, 200);
  const spec = await res.json();

  assert.equal(spec.openapi, "3.1.0");
  assert.ok(Array.isArray(spec.servers) && spec.servers[0].url.startsWith("http"));

  const paths = Object.keys(spec.paths);
  assert.ok(paths.length >= 10, `harus ada minimal 10 path tool, dapat ${paths.length}`);

  // Kontrak nama tool yang sama dengan /mcp (lihat tests/mcp.test.js) — kalau
  // salah satu hilang di sini tapi ada di /mcp, berarti jembatan REST ini
  // diam-diam menyembunyikan tool dari ChatGPT.
  for (const wajib of ["cari_pelanggan", "detail_pelanggan", "cari_order", "statistik_crm"]) {
    assert.ok(paths.includes(`/gpt-actions/tools/${wajib}`), `tool ${wajib} hilang dari openapi.json`);
  }

  // Tiap path harus operationId + requestBody JSON Schema yang benar-benar
  // datang dari tools/list (bukan placeholder kosong) — cek satu contoh.
  const op = spec.paths["/gpt-actions/tools/cari_pelanggan"].post;
  assert.equal(op.operationId, "cari_pelanggan");
  const schema = op.requestBody.content["application/json"].schema;
  assert.equal(schema.type, "object");
  assert.ok(schema.properties.unmask, "param unmask (dari toolsShared.js) harus ikut ke schema OpenAPI");
});

test("POST /gpt-actions/tools/:nama untuk tool yang tidak ada dijawab 400, bukan 500", async (t) => {
  const { url, tutup } = await jalankanServer();
  t.after(tutup);

  const res = await post(url, "/tools/tool_yang_tidak_pernah_ada", {});
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /not found/i);
});
