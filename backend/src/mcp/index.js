// MCP (Model Context Protocol) server READ-ONLY untuk CRM Klinik Matras.
//
// Di-mount di backend Express yang SUDAH ADA pada path /mcp — bukan service
// atau container terpisah. Alasannya: reuse Prisma client, nginx, dan SSL yang
// sudah jalan; tidak menambah biaya VPS (CLAUDE.md §2: target <Rp300rb/bulan).
//
// TRANSPORT: Streamable HTTP dari @modelcontextprotocol/sdk, mode STATELESS
// (sessionIdGenerator: undefined). Stateless dipilih karena:
//   - tidak ada state sesi yang bocor di memori kalau klien putus tanpa DELETE
//   - semua tool di sini murni request→response, tidak ada notifikasi dari
//     server, jadi tidak butuh SSE stream jangka panjang
// Konsekuensinya GET /mcp (SSE stream server→klien) memang tidak didukung —
// itu disengaja, bukan bug.
//
// AUTH — DUA jalur yang hidup berdampingan (lihat security.js#requireMcpToken):
//   a. Token statis MCP_API_TOKEN — Claude Code/Desktop (custom header).
//   b. OAuth 2.1 (oauth.js) — claude.ai browser, yang UI custom connector-nya
//      cuma punya field OAuth, tidak ada input header kustom.
//
// KEAMANAN — JANGAN dilonggarkan satu pun:
//   1. Salah satu dari dua jalur auth di atas WAJIB cocok → selain itu 401.
//      Kalau DUA-DUANYA belum dikonfigurasi di .env, seluruh endpoint mati (503).
//   2. Rate limit 60 request/menit per IP (MCP_RATE_LIMIT_PER_MIN) di /mcp;
//      /oauth/authorize (login) punya limit terpisah yang lebih ketat.
//   3. Semua tool read-only — lihat aturan di tools.js.
//   4. Nomor HP & email pelanggan disamarkan secara default.
//   5. OAuth: hanya user ber-role ADMIN yang bisa login+approve (oauth.js).
//
// NGINX: tidak perlu diubah — /mcp ikut `proxy_pass http://localhost:4000`
// yang sudah ada. Kalau nanti dibutuhkan streaming SSE jangka panjang, barulah
// `proxy_buffering off;` perlu ditambahkan (jangan diubah sendiri, diskusikan).

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { requireMcpToken, mcpRateLimit, mcpAuthConfigured, mcpStaticTokenConfigured, MCP_RATE_LIMIT } from "./security.js";
import { oauthConfigured } from "./oauthCrypto.js";
import { registerReadOnlyTools } from "./tools.js";

export { wellKnownRouter, mcpOAuthRouter } from "./oauth.js";

export const MCP_SERVER_NAME = "klinik-matras-crm";
export const MCP_SERVER_VERSION = "1.0.0";

// Satu instance McpServer per request. Ini pola stateless yang dianjurkan SDK:
// server & transport hidup selama satu request lalu ditutup, jadi tidak ada
// akumulasi memori dan tidak ada kebocoran konteks antar pemanggil.
function buatServer() {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        "Server ini memberi akses BACA-SAJA ke CRM Klinik Matras (bisnis kasur sehat Indonesia): " +
        "pelanggan, order, pipeline penjualan, percakapan WhatsApp, dan katalog produk. " +
        "Tidak ada tool yang bisa mengubah data atau mengirim pesan WhatsApp. " +
        "Nomor HP & email pelanggan disamarkan secara default — gunakan unmask=true hanya kalau " +
        "pengguna memang meminta kontak lengkap. Semua tanggal parameter memakai kalender WIB " +
        "(Asia/Jakarta) format YYYY-MM-DD, sedangkan tanggal di hasil adalah ISO 8601 UTC. " +
        "Panggil statistik_crm dulu kalau butuh orientasi awal (termasuk daftar ID sales).",
    },
  );
  registerReadOnlyTools(server);
  return server;
}

export const mcpRouter = express.Router();

// Urutan middleware disengaja: rate limit DULU, baru auth. Dengan begitu
// tebakan token beruntun ikut kena batas 60/menit, bukan cuma request yang
// tokennya sudah benar.
mcpRouter.use(mcpRateLimit);
mcpRouter.use(requireMcpToken);

mcpRouter.post("/", async (req, res) => {
  const server = buatServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  // Bersihkan begitu respons selesai/terputus — tanpa ini setiap request
  // meninggalkan McpServer yang tidak pernah ditutup.
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] gagal menangani request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Mode stateless tidak punya stream server→klien dan tidak punya sesi untuk
// dihapus. Jawab 405 dengan bentuk JSON-RPC supaya klien MCP membacanya
// sebagai "tidak didukung", bukan "server rusak".
function tidakDidukung(_req, res) {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Server MCP ini stateless — pakai POST." },
    id: null,
  });
}
mcpRouter.get("/", tidakDidukung);
mcpRouter.delete("/", tidakDidukung);

// Bantuan diagnosa saat setup ("token saya salah, atau URL-nya yang salah?").
// Sudah di belakang token, jadi tidak membocorkan apa pun ke publik.
mcpRouter.get("/info", (_req, res) => {
  res.json({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    transport: "streamable-http (stateless)",
    readOnly: true,
    rateLimitPerMinute: MCP_RATE_LIMIT,
  });
});

export function logStatusMcp() {
  if (!mcpAuthConfigured()) {
    console.log("MCP server NONAKTIF — set MCP_API_TOKEN dan/atau MCP_OAUTH_JWT_SECRET di .env untuk mengaktifkan /mcp");
    return;
  }
  const jalur = [
    mcpStaticTokenConfigured() && "token statis (Claude Code)",
    oauthConfigured() && "OAuth (claude.ai browser)",
  ].filter(Boolean).join(" + ");
  console.log(`MCP server READ-ONLY aktif di /mcp [${jalur}] (rate limit ${MCP_RATE_LIMIT} req/menit)`);
}