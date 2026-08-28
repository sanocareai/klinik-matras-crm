// PrismaClient TERPISAH dari ../db.js — sengaja connect dengan role Postgres
// yang HANYA GRANT SELECT (mcp_hub_readonly), BUKAN role "klinik" (baca+tulis)
// yang dipakai seluruh app. Ini enforcement di level DATABASE, bukan cuma
// "tidak ada tool untuk itu": kalau ada kode di src/mcpHub/ yang keliru
// memanggil .create()/.update()/.delete() lewat client ini, Postgres sendiri
// yang menolak (permission denied), request itu gagal — bukan diam-diam
// berhasil menulis.
//
// SETUP (production & lokal, sekali per server): buat role read-only, lihat
// docs/MCP-HUB-SERVER.md bagian "Setup role database read-only".
//
// Kalau MCP_HUB_READONLY_DATABASE_URL belum diisi, dibiarkan undefined —
// PrismaClient akan gagal connect saat dipakai (bukan diam-diam pakai
// DATABASE_URL utama yang writable). Kegagalan connect di sini HARUS
// membuat /mcp-hub mati (503), bukan fallback ke koneksi writable.
import { PrismaClient } from "@prisma/client";

export const prismaReadOnly = new PrismaClient({
  datasources: {
    db: { url: process.env.MCP_HUB_READONLY_DATABASE_URL || "postgresql://invalid-not-configured/db" },
  },
});

export function mcpHubDbConfigured() {
  const u = process.env.MCP_HUB_READONLY_DATABASE_URL;
  return typeof u === "string" && u.trim().length > 0;
}
