# SANO Hub Analytics MCP — connector KEDUA di Claude

Endpoint: `https://app.sanomatrassehat.com/mcp-hub`
Kode: `backend/src/mcpHub/` — `index.js` (router & transport), `auth.js`
(token, rate limit, OAuth audience), `db.js` (Prisma **read-only**), `tools.js`
(5 tool baca).

Tujuan: expose data yang dihasilkan **Claude Code selama development**
(Quality Scorer, Sales Risk Engine, Stale Lead Alert, Gold Standard) ke
Claude — **paralel** dengan connector `klinik-matras-crm` (SANSS CRM) yang
sudah ada, **bukan** pengganti. Untuk data mentah pelanggan/order/percakapan,
tetap pakai connector SANSS — server ini sengaja **tidak** menduplikasinya.

---

## 1. Perbedaan dari SANSS CRM (`/mcp`)

| | SANSS CRM (`/mcp`) | SANO Hub Analytics (`/mcp-hub`) |
|---|---|---|
| Data | Pelanggan, order, pipeline, percakapan mentah | Skor kualitas, risk engine, stale lead, gold standard, narasi |
| Koneksi DB | `db.js` biasa (role `klinik`, baca+tulis) | `mcpHub/db.js` — role **`mcp_hub_readonly`, HANYA `GRANT SELECT`** |
| Proses/port/nginx | — | **SAMA** — router tambahan di backend yang sama, tidak ada yang baru |
| Authorization server OAuth | `/oauth/*` | **Sama persis** — admin login satu kali berlaku konsep untuk keduanya, tapi token untuk satu resource TIDAK BISA dipakai ke resource lain (lihat §3) |

**Kenapa DB-level read-only, bukan cuma "tidak ada tool tulis":** ini
permintaan eksplisit — bukti kegagalan tulis harus di level infrastruktur,
bukan cuma janji kode. `src/mcpHub/db.js` connect pakai role Postgres yang
CUMA di-`GRANT SELECT`. **Dibuktikan langsung** (29 Agustus 2026, DB lokal):

```
prisma.customer.updateMany(...) →
PostgresError { code: "42501", message: "permission denied for table Customer" }
```

Kode `42501` = `insufficient_privilege`, kategori resmi PostgreSQL — penolakan
terjadi di database, sebelum baris manapun tersentuh, terlepas dari apakah
`WHERE`-nya cocok baris atau tidak.

---

## 2. Setup role database read-only (SEKALI per server)

Dijalankan langsung ke Postgres (lokal via `docker exec`, production sama
tapi lewat SSH VPS):

```bash
docker exec -i klinik-matras-postgres-1 psql -U klinik -d klinik_matras -c "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mcp_hub_readonly') THEN
    CREATE ROLE mcp_hub_readonly WITH LOGIN PASSWORD '<password-kuat>';
  END IF;
END
\$\$;
GRANT CONNECT ON DATABASE klinik_matras TO mcp_hub_readonly;
GRANT USAGE ON SCHEMA public TO mcp_hub_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_hub_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_hub_readonly;
"
```

`ALTER DEFAULT PRIVILEGES` penting: tanpa itu, tabel BARU yang dibuat migration
berikutnya TIDAK otomatis ter-`SELECT` oleh role ini (role harus di-grant
ulang manual tiap ada tabel baru). Dengan `ALTER DEFAULT PRIVILEGES`, tabel
baru otomatis kebagian `SELECT` — tapi **tetap tidak pernah** dapat hak tulis.

Role ini TIDAK di-manage lewat Prisma migration (bukan bagian skema, murni
hak akses) — dijalankan manual sekali, dicatat di sini supaya tidak hilang
dari institutional knowledge.

---

## 3. Env var baru

```
# .env backend
MCP_HUB_API_TOKEN=""                    # token statis untuk Claude Code
MCP_HUB_RATE_LIMIT_PER_MIN=60
MCP_HUB_READONLY_DATABASE_URL=""        # connection string role mcp_hub_readonly
```

`MCP_PUBLIC_URL` dan `MCP_OAUTH_JWT_SECRET` **dipakai bersama** dengan SANSS
(satu authorization server, satu login admin) — tidak perlu diisi ulang.

Generate token & password:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. OAuth multi-resource (RFC 8707)

Satu authorization server (`/oauth/*`) sekarang melayani **dua resource**:
`https://app.sanomatrassehat.com/mcp` dan `.../mcp-hub`. Saat login,
Claude mengirim parameter `resource=` menunjuk endpoint yang ingin diakses;
server:

1. Memvalidasi `resource` terhadap `KNOWN_RESOURCES` di `mcp/oauth.js` (resource
   tidak dikenal → ditolak, sama ketatnya dengan validasi `redirect_uri`).
2. Menyimpan resource itu di baris `McpAuthorizationCode`/`McpRefreshToken`
   (kolom `resource`, migrasi `mcp_oauth_multi_resource`).
3. Menandatangani access token dengan `aud` (audience) = resource itu.
4. **`requireMcpToken` (SANSS) dan `requireMcpHubToken` (hub) masing-masing
   verifikasi audience miliknya sendiri** — token yang diterbitkan untuk
   `/mcp` **ditolak** kalau dipakai ke `/mcp-hub`, dan sebaliknya. Diverifikasi
   otomatis lewat tes `mcpHub.test.js`.

Login sekali per admin per connector (state OAuth terpisah per resource,
walau kredensial akun sama).

---

## 5. Menyambungkan ke Claude

**Claude Code / Claude Desktop:**
```bash
claude mcp add --transport http sano-hub-analytics https://app.sanomatrassehat.com/mcp-hub \
  --header "Authorization: Bearer <MCP_HUB_API_TOKEN>"
```

**Claude.ai (browser):** sama seperti SANSS (lihat `docs/MCP-SERVER.md` §3d) —
Add custom connector → URL `https://app.sanomatrassehat.com/mcp-hub` →
kosongkan Advanced settings → login akun ADMIN (halaman consent akan
menyebutkan "SANO Hub Analytics", bukan generik). ⚠️ Kalau CRM ter-install
sebagai PWA di komputer Anda, pakai Incognito (lihat gotcha yang sama di
`docs/MCP-SERVER.md`).

---

## 6. Daftar tool (semua read-only, DB-level enforced)

| Tool | Fungsi |
|---|---|
| `get_quality_scores` | Rollup skor kualitas percakapan sales per rentang tanggal — reuse `services/qualityScorer/rollup.js` |
| `get_risk_profiles` | Profil risiko pelanggan (CRITICAL/HIGH/MEDIUM/LOW) — reuse `services/salesRisk/` |
| `get_stale_lead_status` | Status alert lead mengendap: belum/sudah dinotif hari ini, atau tereskalasi |
| `get_gold_standard_examples` | Kutipan balasan sales terbaik per kategori |
| `get_weekly_narratives` | Narasi pola perilaku mingguan per sales (sudah tersimpan, tidak generate ulang) |

**Batasan `get_stale_lead_status` (sadar, bukan bug):** hanya mencakup lead
yang **sudah pernah** tercatat kena alert (`StaleLeadAlertLog`). Lead yang
seharusnya stale tapi belum pernah dialert TIDAK muncul — logic candidate
selection job-nya besar & sering berubah (noise exclusion, cek sales aktif,
dst), reimplementasi ulang di sini berisiko drift dari job aslinya. Kalau
kelak dibutuhkan, itu perluasan terpisah.

---

## 7. Aturan saat menambah tool baru

1. **HANYA `prismaReadOnly` dari `./db.js`.** Jangan pernah import `prisma`
   dari `../db.js` (role writable) di `src/mcpHub/`. Dijaga tes
   `mcpHub.test.js` ("tools.js TIDAK PERNAH import prisma writable").
2. **Reuse fungsi bisnis yang sudah ada**, jangan tulis ulang scoring/rollup.
   Kalau fungsi aslinya pakai `prisma` singleton internal (bukan parameter),
   susun ulang query-nya dengan `prismaReadOnly` tapi PANGGIL helper
   transform murni yang sama (lihat pola `get_quality_scores` memakai
   `overallScore`/`avgByDim`/`formatExample` yang diekspor dari `rollup.js`).
3. **File baru → daftarkan di `FILE_HUB`** pada `tests/mcpHub.test.js`.
4. Response **terstruktur JSON** (reuse `hasil()` dari `mcp/toolsShared.js`).

Jalankan tes:
```bash
cd backend && npm test
```
