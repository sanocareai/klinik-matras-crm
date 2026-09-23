// Facade MCP khusus ChatGPT Plugin untuk divisi Sales CRM.
//
// Handler dan schema berasal LANGSUNG dari registrasi tool MCP yang sudah
// dipakai /mcp. Facade hanya memilih enam tool awal, memberi prefix `sales_`,
// memaksa masking PII, dan menambahkan metadata OAuth. Tidak ada query atau
// aturan bisnis kedua di file ini.

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { prisma } from "../db.js";
import { rolesOf } from "../middleware/authorize.js";
import { registerReadOnlyTools } from "./tools.js";
import { registerChatTools } from "./toolsChat.js";
import { registerTrafficTools } from "./toolsTraffic.js";
import { mcpRateLimit } from "./security.js";
import { oauthConfigured, OAUTH_SCOPE, publicUrl, verifyAccessToken } from "./oauthCrypto.js";

export const CHATGPT_MCP_PATH = "/mcp-chatgpt";
export const CHATGPT_MCP_SERVER_NAME = "sanss-sales-crm";

// Seluruh 18 mapping disiapkan, tetapi hanya enam agregat/katalog berisiko
// rendah yang aktif. Tool pelanggan, order, isi percakapan, dan audit pesan
// tetap tidak terdaftar sampai kontrol akses granularnya dibuktikan.
export const CHATGPT_TOOL_CATALOG = Object.freeze([
  { name: "sales_cari_pelanggan", canonical: "cari_pelanggan", active: false, division: "sales", sensitivity: "customer_profile" },
  { name: "sales_detail_pelanggan", canonical: "detail_pelanggan", active: false, division: "sales", sensitivity: "customer_profile" },
  { name: "sales_cari_order", canonical: "cari_order", active: false, division: "sales", sensitivity: "customer_order" },
  { name: "sales_detail_order", canonical: "detail_order", active: false, division: "sales", sensitivity: "customer_order" },
  { name: "sales_ringkasan_penjualan", canonical: "ringkasan_penjualan", active: true, division: "sales", sensitivity: "aggregate" },
  { name: "sales_ringkasan_pipeline", canonical: "ringkasan_pipeline", active: true, division: "sales", sensitivity: "aggregate" },
  { name: "sales_ringkasan_sumber_lead", canonical: "ringkasan_sumber_lead", active: true, division: "sales", sensitivity: "aggregate" },
  { name: "sales_performa_sales", canonical: "performa_sales", active: false, division: "sales", sensitivity: "employee_performance" },
  { name: "omnichannel_daftar_percakapan", canonical: "daftar_percakapan", active: false, division: "omnichannel", sensitivity: "conversation_metadata" },
  { name: "omnichannel_riwayat_percakapan", canonical: "riwayat_percakapan", active: false, division: "omnichannel", sensitivity: "message_content" },
  { name: "sales_daftar_produk", canonical: "daftar_produk", active: true, division: "sales", sensitivity: "catalog" },
  { name: "sales_statistik_crm", canonical: "statistik_crm", active: false, division: "sales", sensitivity: "cross_division" },
  { name: "omnichannel_cari_pesan", canonical: "cari_pesan", active: false, division: "omnichannel", sensitivity: "message_content" },
  { name: "omnichannel_kualitas_engagement", canonical: "kualitas_engagement", active: false, division: "omnichannel", sensitivity: "customer_profile" },
  { name: "omnichannel_audit_balasan_sales", canonical: "audit_balasan_sales", active: false, division: "omnichannel", sensitivity: "message_audit" },
  { name: "omnichannel_diagnosa_percakapan", canonical: "diagnosa_percakapan", active: false, division: "omnichannel", sensitivity: "message_audit" },
  { name: "sales_tren_traffic_lead", canonical: "tren_traffic_lead", active: true, division: "sales", sensitivity: "aggregate" },
  { name: "sales_performa_iklan", canonical: "performa_iklan", active: true, division: "sales", sensitivity: "aggregate" },
]);

const ACTIVE_BY_CANONICAL = new Map(
  CHATGPT_TOOL_CATALOG.filter((tool) => tool.active).map((tool) => [tool.canonical, tool]),
);

export function isChatGptRoleAllowed(user) {
  return rolesOf(user).includes("ADMIN");
}

async function loadPrincipal(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, active: true, role: true, roles: { select: { role: true } } },
  });
  if (!user) return null;
  return { id: user.id, active: user.active, role: user.role, roles: user.roles.map((row) => row.role) };
}

function setAuthChallenge(res) {
  const metadata = `${publicUrl()}/.well-known/oauth-protected-resource/mcp-chatgpt`;
  res.set("WWW-Authenticate", `Bearer resource_metadata="${metadata}", scope="${OAUTH_SCOPE}"`);
}

export function createRequireChatGptOAuth({ principalLoader = loadPrincipal } = {}) {
  return async function requireChatGptOAuth(req, res, next) {
    if (!oauthConfigured()) {
      return res.status(503).json({ error: "MCP ChatGPT nonaktif: OAuth belum dikonfigurasi" });
    }

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const resource = `${publicUrl()}${CHATGPT_MCP_PATH}`;
    const payload = token ? verifyAccessToken(token, resource) : null;
    if (!payload) {
      setAuthChallenge(res);
      return res.status(401).json({ error: "Token OAuth MCP ChatGPT tidak valid" });
    }
    const scopes = String(payload.scope || "").split(/\s+/).filter(Boolean);
    if (!scopes.includes(OAUTH_SCOPE)) {
      setAuthChallenge(res);
      return res.status(401).json({ error: "Scope OAuth MCP ChatGPT tidak valid" });
    }

    const principal = await principalLoader(payload.userId);
    if (!principal?.active) return res.status(403).json({ error: "Akun tidak aktif" });
    if (!isChatGptRoleAllowed(principal)) {
      return res.status(403).json({ error: "Akses MCP ChatGPT hanya untuk Admin Sales CRM" });
    }

    req.mcpAuth = { type: "oauth", ...payload, principal };
    next();
  };
}

function maskedFacade(server) {
  return {
    registerTool(canonicalName, config, handler) {
      const mapping = ACTIVE_BY_CANONICAL.get(canonicalName);
      if (!mapping) return;

      // Jangan pernah menawarkan `unmask` kepada model. Nilai false juga
      // dipaksa ke handler sebagai pertahanan kedua bila schema berubah.
      const { unmask: _ignored, ...inputSchema } = config.inputSchema || {};
      server.registerTool(
        mapping.name,
        {
          ...config,
          inputSchema,
          annotations: {
            ...config.annotations,
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
          // SDK MCP versi repo belum menyalin `securitySchemes` top-level ke
          // tools/list. Mirror di _meta dipakai untuk discovery klien lama;
          // auth sebenarnya tetap diwajibkan middleware pada setiap request.
          _meta: {
            ...config._meta,
            securitySchemes: [{ type: "oauth2", scopes: [OAUTH_SCOPE] }],
          },
        },
        (args, extra) => handler({ ...args, unmask: false }, extra),
      );
    },
  };
}

export function buatChatGptSalesServer() {
  const server = new McpServer(
    { name: CHATGPT_MCP_SERVER_NAME, version: "1.0.0" },
    {
      instructions:
        "Akses baca-saja ke agregat Sales CRM SANSS. Gunakan enam tool sales_ yang tersedia untuk " +
        "ringkasan penjualan, pipeline, sumber lead, traffic, iklan, dan katalog produk. " +
        "Data pelanggan serta isi percakapan tidak tersedia. PII selalu dimasking oleh server.",
    },
  );
  const facade = maskedFacade(server);
  registerReadOnlyTools(facade);
  registerChatTools(facade);
  registerTrafficTools(facade);
  return server;
}

export function createChatGptMcpRouter({ authorize = createRequireChatGptOAuth() } = {}) {
  const router = express.Router();
  router.use(mcpRateLimit);
  router.use(authorize);
  router.post("/", async (req, res) => {
    const server = buatChatGptSalesServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[mcp-chatgpt] gagal menangani request:", error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });
  router.get("/", (_req, res) => res.status(405).json({ error: "Gunakan POST Streamable HTTP" }));
  router.delete("/", (_req, res) => res.status(405).json({ error: "Server stateless" }));
  return router;
}

export const chatGptMcpRouter = createChatGptMcpRouter();
