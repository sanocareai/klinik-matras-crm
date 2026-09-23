import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const originalSecret = process.env.MCP_OAUTH_JWT_SECRET;
const originalPublicUrl = process.env.MCP_PUBLIC_URL;
process.env.MCP_OAUTH_JWT_SECRET = "oauth-secret-chatgpt-test-only";
process.env.MCP_PUBLIC_URL = "http://localhost:4000";

after(() => {
  if (originalSecret === undefined) delete process.env.MCP_OAUTH_JWT_SECRET;
  else process.env.MCP_OAUTH_JWT_SECRET = originalSecret;
  if (originalPublicUrl === undefined) delete process.env.MCP_PUBLIC_URL;
  else process.env.MCP_PUBLIC_URL = originalPublicUrl;
});

const {
  CHATGPT_TOOL_CATALOG,
  createChatGptMcpRouter,
  createRequireChatGptOAuth,
} = await import("../src/mcp/chatgptPlugin.js");
const { signAccessToken } = await import("../src/mcp/oauthCrypto.js");

function parseMcp(text) {
  const line = text.split("\n").find((value) => value.startsWith("data:"));
  return JSON.parse((line || text).replace(/^data:\s*/, ""));
}

async function start(router) {
  const app = express();
  app.use(express.json());
  app.use("/mcp-chatgpt", router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp-chatgpt`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function call(url, body, token) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("catalog menyiapkan 18 mapping tetapi hanya enam tool tahap awal aktif", () => {
  assert.equal(CHATGPT_TOOL_CATALOG.length, 18);
  assert.deepEqual(
    CHATGPT_TOOL_CATALOG.filter((tool) => tool.active).map((tool) => tool.name),
    [
      "sales_ringkasan_penjualan",
      "sales_ringkasan_pipeline",
      "sales_ringkasan_sumber_lead",
      "sales_daftar_produk",
      "sales_tren_traffic_lead",
      "sales_performa_iklan",
    ],
  );
});

test("tools/list hanya menawarkan enam tool read-only, OAuth, dan tanpa unmask", async (t) => {
  const authorize = (_req, _res, next) => next();
  const { url, close } = await start(createChatGptMcpRouter({ authorize }));
  t.after(close);

  const response = await call(url, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  assert.equal(response.status, 200);
  const tools = parseMcp(await response.text()).result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), CHATGPT_TOOL_CATALOG.filter((tool) => tool.active).map((tool) => tool.name));
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.inputSchema?.properties?.unmask, undefined);
    assert.deepEqual(tool._meta?.securitySchemes, [{ type: "oauth2", scopes: ["mcp:read"] }]);
  }
});

test("schema menolak parameter tanggal yang tidak valid", async (t) => {
  const authorize = (_req, _res, next) => next();
  const { url, close } = await start(createChatGptMcpRouter({ authorize }));
  t.after(close);

  const response = await call(url, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "sales_ringkasan_penjualan", arguments: { dari: "23-09-2026", sampai: "2026-09-23" } },
  });
  const result = parseMcp(await response.text()).result;
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /validasi|validation|YYYY-MM-DD/i);
});

test("OAuth wajib dan role diperiksa ulang pada server", async (t) => {
  const middleware = createRequireChatGptOAuth({
    principalLoader: async (userId) => ({
      id: userId,
      active: true,
      roles: userId === "admin-user" ? ["ADMIN"] : ["SALES"],
    }),
  });
  const { url, close } = await start(createChatGptMcpRouter({ authorize: middleware }));
  t.after(close);

  const body = { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} };
  const withoutToken = await call(url, body);
  assert.equal(withoutToken.status, 401);
  assert.match(withoutToken.headers.get("www-authenticate") || "", /mcp-chatgpt/);

  const wrongAudience = signAccessToken({ userId: "admin-user", clientId: "client", resource: "http://localhost:4000/mcp" });
  assert.equal((await call(url, body, wrongAudience)).status, 401);

  const salesToken = signAccessToken({ userId: "sales-user", clientId: "client", resource: "http://localhost:4000/mcp-chatgpt" });
  assert.equal((await call(url, body, salesToken)).status, 403);

  const adminToken = signAccessToken({ userId: "admin-user", clientId: "client", resource: "http://localhost:4000/mcp-chatgpt" });
  assert.equal((await call(url, body, adminToken)).status, 200);
});
