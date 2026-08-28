// Lapisan auth untuk /mcp-hub — SEJAJAR dengan src/mcp/security.js, TAPI
// file terpisah (bukan generalisasi security.js) supaya perubahan di sini
// TIDAK PERNAH bisa mempengaruhi /mcp (SANSS CRM) yang sudah dipakai admin.
//
// Sama seperti /mcp: dua jalur auth berdampingan —
//   1. Token statis MCP_HUB_API_TOKEN (Claude Code/Desktop)
//   2. OAuth 2.1 (authorization server SAMA dengan /mcp, resource BERBEDA —
//      lihat KNOWN_RESOURCES di mcp/oauth.js). Access token untuk /mcp TIDAK
//      BISA dipakai di sini — audience-nya beda (oauthCrypto.js#verifyAccessToken).
import crypto from "crypto";
import { verifyAccessToken, oauthConfigured, publicUrl } from "../mcp/oauthCrypto.js";
import { createRateLimiter, rateLimitKey } from "../mcp/security.js";

const HUB_RESOURCE_PATH = "/mcp-hub";
function hubResourceUrl() {
  return `${publicUrl()}${HUB_RESOURCE_PATH}`;
}

export function mcpHubStaticTokenConfigured() {
  const t = process.env.MCP_HUB_API_TOKEN;
  return typeof t === "string" && t.trim().length > 0;
}

export function mcpHubAuthConfigured() {
  return mcpHubStaticTokenConfigured() || oauthConfigured();
}

function tokenCocok(diberikan, benar) {
  const a = crypto.createHash("sha256").update(String(diberikan)).digest();
  const b = crypto.createHash("sha256").update(String(benar)).digest();
  return crypto.timingSafeEqual(a, b);
}

function setWwwAuthenticate(res) {
  const params = ['realm="sano-hub-mcp"'];
  if (oauthConfigured()) {
    params.push(`resource_metadata="${publicUrl()}/.well-known/oauth-protected-resource/mcp-hub"`);
  }
  res.set("WWW-Authenticate", `Bearer ${params.join(", ")}`);
}

export function requireMcpHubToken(req, res, next) {
  if (!mcpHubAuthConfigured()) {
    return res.status(503).json({
      error: "SANO Hub Analytics MCP nonaktif — isi MCP_HUB_API_TOKEN dan/atau MCP_OAUTH_JWT_SECRET di .env backend",
    });
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (token && mcpHubStaticTokenConfigured() && tokenCocok(token, process.env.MCP_HUB_API_TOKEN.trim())) {
    req.mcpAuth = { type: "static" };
    return next();
  }

  if (token) {
    const payload = verifyAccessToken(token, hubResourceUrl());
    if (payload) {
      req.mcpAuth = { type: "oauth", userId: payload.userId, clientId: payload.clientId };
      return next();
    }
  }

  setWwwAuthenticate(res);
  return res.status(401).json({ error: "Token SANO Hub Analytics MCP tidak valid" });
}

// Rate limiter SENDIRI (bukan berbagi Map dengan /mcp) — traffic ke satu
// connector tidak boleh menghabiskan jatah connector lain.
export const MCP_HUB_RATE_LIMIT = Number(process.env.MCP_HUB_RATE_LIMIT_PER_MIN || 60);
const cekRateHub = createRateLimiter({ limit: MCP_HUB_RATE_LIMIT, windowMs: 60_000 });

export function mcpHubRateLimit(req, res, next) {
  const { allowed, remaining, retryAfter } = cekRateHub(rateLimitKey(req));
  res.set("X-RateLimit-Limit", String(MCP_HUB_RATE_LIMIT));
  res.set("X-RateLimit-Remaining", String(remaining));
  if (!allowed) {
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: `Terlalu banyak permintaan. Batas ${MCP_HUB_RATE_LIMIT} request/menit.`,
    });
  }
  next();
}
