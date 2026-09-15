// Jembatan REST/OpenAPI ke tool MCP yang SUDAH ADA — dibuat 14 September 2026
// (D-164, permintaan owner: "SANSS bisa terkoneksi dengan ChatGPT, tidak
// cuma Claude") supaya ChatGPT Custom GPT Actions bisa memakai data yang
// sama dengan yang Claude pakai lewat /mcp.
//
// KENAPA TIDAK LANGSUNG /mcp: Custom GPT Actions bicara OpenAPI/REST biasa
// (satu HTTP call per operationId, request/response JSON polos), BUKAN
// protokol MCP (JSON-RPC batched, initialize/tools-list/tools-call). Bukan
// pilihan desain kita — itu keterbatasan produk ChatGPT.
//
// KENAPA TIDAK MENULIS ULANG TOOL: router ini TIDAK mendefinisikan satu pun
// tool atau aturan bisnis baru. Ia memanggil McpServer yang SAMA PERSIS
// (buatServer() dari index.js — tools.js/toolsChat.js/toolsTraffic.js apa
// adanya) lewat InMemoryTransport SDK (client<->server MCP di proses yang
// sama, tanpa network sungguhan) — cuma menerjemahkan bentuk transportnya.
// Konsekuensinya: read-only, masking PII, dan deskripsi tool ikut otomatis
// tanpa perlu disalin — kalau tools.js berubah, endpoint ini ikut berubah,
// tidak mungkin diam-diam menyimpang (persis kekhawatiran yang berulang kali
// dicatat CLAUDE.md soal "dua sumber kebenaran").
//
// AUTH & RATE LIMIT: reuse requireMcpToken + mcpRateLimit dari security.js —
// SATU token (MCP_API_TOKEN) untuk kedua jembatan (Claude via /mcp, ChatGPT
// via /gpt-actions). TIDAK menambah OAuth baru: Custom GPT Actions sudah
// punya tipe auth "API Key" (Bearer) bawaan di panel Authentication-nya,
// tidak butuh redirect_uri seperti OAuth claude.ai (lihat oauth.js).
//
// CATATAN SETUP: GET /openapi.json SENGAJA tetap di belakang token yang sama
// (bukan endpoint publik) — konsisten dengan sikap fail-closed seluruh /mcp.
// Konsekuensinya: builder Custom GPT tidak bisa pakai "Import from URL" ala
// endpoint publik biasa. Admin fetch sekali pakai token (mis. curl dengan
// header Authorization), lalu tempel hasilnya ke tab "Schema" GPT builder
// secara manual — pola umum untuk API berautentikasi, bukan celah.

import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

import { requireMcpToken, mcpRateLimit, mcpAuthConfigured, mcpStaticTokenConfigured } from "./security.js";
import { buatServer, MCP_SERVER_VERSION } from "./index.js";

// Satu pasang client<->server per panggilan (mirror pola stateless /mcp:
// server baru tiap request, ditutup begitu selesai — tidak ada state yang
// menumpuk di memori antar pemanggil).
async function withClient(fn) {
  const server = buatServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "chatgpt-actions-bridge", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

// tool.inputSchema dari tools/list SUDAH berbentuk JSON Schema standar
// ({type:"object", properties, required}) — SDK MCP yang mengonversinya dari
// zod, bukan kita. Ini yang membuat OpenAPI di bawah otomatis sinkron dengan
// definisi tool tanpa perlu ditulis ulang manual per tool.
// Skema placeholder untuk respons 200 — bentuk data ASLI beda-beda per tool
// (lihat komentar hasil() di toolsShared.js: sengaja tidak ada outputSchema
// ketat). `properties: {}` WAJIB ada secara eksplisit — validator skema
// Custom GPT Actions milik OpenAI menolak `{type:"object"}` tanpa `properties`
// sebagai "object schema missing properties" (ditemukan 15 September 2026
// lewat percobaan langsung: SEMUA 18 path gagal validasi dengan pesan yang
// sama persis, karena constant ini dipakai berulang untuk tiap tool).
const RESPONS_BEBAS = { type: "object", properties: {}, additionalProperties: true };

// Custom GPT Actions membatasi `description` per operation MAKS 300 karakter
// (ditemukan 15 September 2026, error langsung dari ChatGPT: "description
// has length N exceeding limit of 300" untuk 9 dari 18 tool — deskripsi
// tool.js/toolsChat.js/toolsTraffic.js sengaja detail untuk Claude, yang
// TIDAK punya batas ini). Batas ini KHUSUS lapisan OpenAPI ChatGPT — deskripsi
// asli tool di /mcp TIDAK dipotong, cuma cerminan di sini yang dipendekkan.
const OPENAI_BATAS_DESKRIPSI = 300;
function potongDeskripsi(teks) {
  if (!teks || teks.length <= OPENAI_BATAS_DESKRIPSI) return teks;
  return teks.slice(0, OPENAI_BATAS_DESKRIPSI - 1) + "…";
}

function buildOpenApiSpec(tools, baseUrl) {
  const paths = {};
  for (const tool of tools) {
    paths[`/gpt-actions/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.title || tool.name,
        description: potongDeskripsi(tool.description || tool.name),
        requestBody: {
          required: false,
          content: { "application/json": { schema: tool.inputSchema } },
        },
        responses: {
          200: {
            description: "Hasil tool dalam JSON — struktur persis mengikuti deskripsi tool di atas.",
            content: { "application/json": { schema: RESPONS_BEBAS } },
          },
          400: { description: "Argumen tidak valid, atau tool gagal dijalankan." },
          401: { description: "Token tidak ada / tidak valid." },
          429: { description: "Terlalu banyak permintaan (rate limit)." },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "SANSS CRM Klinik Matras (read-only, untuk ChatGPT)",
      version: MCP_SERVER_VERSION,
      description:
        "Akses BACA-SAJA ke data CRM Klinik Matras — cermin persis dari server MCP yang " +
        "dipakai Claude (/mcp), disajikan sebagai REST/OpenAPI untuk ChatGPT Custom GPT " +
        "Actions. Tidak ada operasi yang mengubah data atau mengirim WhatsApp. Nomor HP & " +
        "email pelanggan disamarkan default (param unmask per tool untuk kasus yang " +
        "memang butuh kontak lengkap).",
    },
    servers: [{ url: baseUrl }],
    paths,
  };
}

export const gptActionsRouter = express.Router();

// Urutan sama seperti /mcp: rate limit dulu, baru auth (tebakan token
// beruntun ikut kena batas, bukan cuma yang tokennya sudah benar).
gptActionsRouter.use(mcpRateLimit);
gptActionsRouter.use(requireMcpToken);

gptActionsRouter.get("/openapi.json", async (req, res) => {
  try {
    const { tools } = await withClient((client) => client.listTools());
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const baseUrl = `${proto}://${req.headers.host}`;
    res.json(buildOpenApiSpec(tools, baseUrl));
  } catch (err) {
    console.error("[gpt-actions] gagal membangun openapi.json:", err);
    res.status(500).json({ error: "Gagal membangun skema OpenAPI" });
  }
});

gptActionsRouter.post("/tools/:toolName", async (req, res) => {
  try {
    const result = await withClient((client) =>
      client.callTool({ name: req.params.toolName, arguments: req.body || {} }),
    );
    const potongan = result.content?.[0];
    const teks = potongan?.type === "text" ? potongan.text : null;

    if (result.isError) {
      return res.status(400).json({ error: teks || "Tool gagal dijalankan." });
    }
    if (teks == null) return res.json({ content: result.content ?? [] });
    try {
      return res.json(JSON.parse(teks));
    } catch {
      // Tool non-JSON (belum ada saat ini, tapi jaga-jaga) — kembalikan apa adanya.
      return res.json({ text: teks });
    }
  } catch (err) {
    // Nama tool tidak dikenal / argumen gagal validasi zod → McpError dari
    // SDK (InvalidParams/MethodNotFound), bukan kegagalan server sungguhan.
    if (err instanceof McpError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(`[gpt-actions] gagal memanggil tool ${req.params.toolName}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// "Aktif" di sini artinya sama dengan /mcp: butuh MCP_API_TOKEN ATAU
// MCP_OAUTH_JWT_SECRET terisi (requireMcpToken fail-closed kalau dua-duanya
// kosong) — TIDAK ada konfigurasi terpisah untuk jembatan ini.
export function logStatusGptActions() {
  if (!mcpAuthConfigured()) return; // sudah dilaporkan oleh logStatusMcp()
  const jalur = mcpStaticTokenConfigured() ? "token statis (sama dengan /mcp)" : "OAuth (sama dengan /mcp)";
  console.log(`ChatGPT Actions bridge aktif di /gpt-actions [${jalur}] — GET /gpt-actions/openapi.json untuk skema`);
}
