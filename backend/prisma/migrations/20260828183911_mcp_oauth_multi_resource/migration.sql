-- OAuth 2.1 multi-resource (RFC 8707) -- SANO Hub Analytics (/mcp-hub)
-- ditambahkan sebagai connector KEDUA yang berbagi authorization server
-- yang sama dengan SANSS CRM (/mcp). Kolom nullable -- baris lama (sebelum
-- kolom ini ada) dianggap "/mcp" oleh oauthCrypto.js, bukan NULL error.
ALTER TABLE "mcp_authorization_codes" ADD COLUMN "resource" TEXT;
ALTER TABLE "mcp_refresh_tokens" ADD COLUMN "resource" TEXT;
