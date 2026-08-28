// MCP (Model Context Protocol) server READ-ONLY untuk SANO Hub Analytics —
// connector KEDUA di Claude, PARALEL dengan SANSS CRM (src/mcp/), bukan
// menggantikannya. Expose data yang dihasilkan Claude Code selama development
// (Quality Scorer, Sales Risk Engine, Stale Lead Alert, Gold Standard) —
// BUKAN duplikasi data mentah CRM yang sudah ada di connector SANSS.
//
// Di-mount di backend Express yang SAMA pada path /mcp-hub — TIDAK ada
// proses/container/port baru, TIDAK ada perubahan nginx (sama alasan seperti
// /mcp: reuse SSL & reverse proxy yang sudah ada). Yang BEDA dari /mcp:
// koneksi Prisma-nya (lihat db.js) pakai role Postgres KHUSUS yang HANYA
// GRANT SELECT — percobaan tulis ditolak di level DATABASE (kode 42501),
// bukan cuma "tidak ada tool untuk itu". Lihat docs/MCP-HUB-SERVER.md untuk
// bukti & cara setup role-nya.
//
// TRANSPORT & AUTH: pola IDENTIK dengan src/mcp/index.js (Streamable HTTP
// stateless, token statis + OAuth berdampingan) — lihat komentar di sana
// untuk alasannya, tidak diulang di sini. Authorization SERVER-nya malah
// SAMA PERSIS dengan /mcp (satu login admin untuk dua connector), tapi
// access token untuk /mcp TIDAK BISA dipakai di sini — audience (resource)
// berbeda, lihat mcp/oauth.js#KNOWN_RESOURCES & mcp/oauthCrypto.js.

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { requireMcpHubToken, mcpHubRateLimit, mcpHubAuthConfigured, mcpHubStaticTokenConfigured, MCP_HUB_RATE_LIMIT } from "./auth.js";
import { oauthConfigured } from "../mcp/oauthCrypto.js";
import { mcpHubDbConfigured } from "./db.js";
import { registerMcpHubTools } from "./tools.js";

export const MCP_HUB_SERVER_NAME = "sano-hub-analytics";
export const MCP_HUB_SERVER_VERSION = "1.0.0";

function buatServer() {
  const server = new McpServer(
    { name: MCP_HUB_SERVER_NAME, version: MCP_HUB_SERVER_VERSION },
    {
      instructions:
        "Server ini memberi akses BACA-SAJA ke data analitik SANO Hub yang dihasilkan Claude Code " +
        "selama development Klinik Matras CRM: skor kualitas percakapan sales (AI Conversation Quality " +
        "Scorer), profil risiko pelanggan (Sales Risk Engine), status alert lead yang mengendap (Stale " +
        "Lead Alert), contoh balasan terbaik (Gold Standard Examples), dan narasi pola mingguan per " +
        "sales. Koneksi database di server ini SECARA TEKNIS tidak bisa menulis (role read-only di " +
        "Postgres) — bukan cuma tidak ada tool untuk itu. " +
        "Ini TERPISAH dari connector 'klinik-matras-crm': untuk data mentah pelanggan/order/percakapan, " +
        "pakai connector itu, bukan ini. " +
        "Semua tanggal parameter memakai kalender WIB (Asia/Jakarta) format YYYY-MM-DD.",
    },
  );
  registerMcpHubTools(server);
  return server;
}

export const mcpHubRouter = express.Router();

mcpHubRouter.use(mcpHubRateLimit);
mcpHubRouter.use(requireMcpHubToken);

mcpHubRouter.post("/", async (req, res) => {
  const server = buatServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp-hub] gagal menangani request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

function tidakDidukung(_req, res) {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Server MCP ini stateless — pakai POST." },
    id: null,
  });
}
mcpHubRouter.get("/", tidakDidukung);
mcpHubRouter.delete("/", tidakDidukung);

mcpHubRouter.get("/info", (_req, res) => {
  res.json({
    name: MCP_HUB_SERVER_NAME,
    version: MCP_HUB_SERVER_VERSION,
    transport: "streamable-http (stateless)",
    readOnly: true,
    readOnlyEnforcedAtDbLevel: mcpHubDbConfigured(),
    rateLimitPerMinute: MCP_HUB_RATE_LIMIT,
  });
});

export function logStatusMcpHub() {
  if (!mcpHubDbConfigured()) {
    console.log("SANO Hub Analytics MCP NONAKTIF — MCP_HUB_READONLY_DATABASE_URL belum diisi di .env");
    return;
  }
  if (!mcpHubAuthConfigured()) {
    console.log("SANO Hub Analytics MCP NONAKTIF — set MCP_HUB_API_TOKEN dan/atau MCP_OAUTH_JWT_SECRET di .env untuk mengaktifkan /mcp-hub");
    return;
  }
  const jalur = [
    mcpHubStaticTokenConfigured() && "token statis (Claude Code)",
    oauthConfigured() && "OAuth (claude.ai browser)",
  ].filter(Boolean).join(" + ");
  console.log(`SANO Hub Analytics MCP READ-ONLY (DB-level) aktif di /mcp-hub [${jalur}] (rate limit ${MCP_HUB_RATE_LIMIT} req/menit)`);
}
