import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";

process.env.MCP_OAUTH_JWT_SECRET = "integration-only-chatgpt-oauth-secret";
process.env.MCP_PUBLIC_URL = "http://localhost:4000";

const { chatGptMcpRouter } = await import("../../src/mcp/chatgptPlugin.js");
const { signAccessToken } = await import("../../src/mcp/oauthCrypto.js");

let server;
let baseUrl;
let token;

function parseMcp(text) {
  const line = text.split("\n").find((value) => value.startsWith("data:"));
  return JSON.parse((line || text).replace(/^data:\s*/, ""));
}

async function call(name, args) {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: args } }),
  });
  assert.equal(response.status, 200, `${name} harus menjawab HTTP 200`);
  return parseMcp(await response.text());
}

test.before(async () => {
  await truncateAll();
  const { user } = await createTestUser({ roles: ["ADMIN"] });
  token = signAccessToken({
    userId: user.id,
    clientId: "chatgpt-integration-test",
    resource: "http://localhost:4000/mcp-chatgpt",
  });

  const app = express();
  app.use(express.json());
  app.use("/mcp-chatgpt", chatGptMcpRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/mcp-chatgpt`;
});

test.after(async () => {
  await truncateAll();
  await new Promise((resolve) => server.close(resolve));
  await testPrisma.$disconnect();
});

test("enam tool aktif berhasil dipanggil terhadap database tes tanpa data pelanggan nyata", async () => {
  const calls = [
    ["sales_ringkasan_penjualan", { dari: "2026-09-01", sampai: "2026-09-30" }],
    ["sales_ringkasan_pipeline", {}],
    ["sales_ringkasan_sumber_lead", { dari: "2026-09-01", sampai: "2026-09-30" }],
    ["sales_daftar_produk", { limit: 5 }],
    ["sales_tren_traffic_lead", { dari: "2026-09-01", sampai: "2026-09-30" }],
    ["sales_performa_iklan", { dari: "2026-09-01", sampai: "2026-09-30" }],
  ];

  for (const [name, args] of calls) {
    const payload = await call(name, args);
    assert.equal(payload.error, undefined, `${name} tidak boleh menghasilkan JSON-RPC error`);
    assert.equal(payload.result?.isError, undefined, `${name} tidak boleh menghasilkan tool error`);
    assert.equal(payload.result?.content?.[0]?.type, "text");
    assert.doesNotThrow(() => JSON.parse(payload.result.content[0].text));
  }
});
