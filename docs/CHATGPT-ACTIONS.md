# ChatGPT Custom GPT Actions — jembatan REST ke data CRM

Ditambahkan 14 September 2026 (D-164, permintaan owner: "SANSS bisa
terkoneksi dengan ChatGPT, tidak cuma Claude").

Endpoint: `https://app.sanomatrassehat.com/gpt-actions`
Kode: `backend/src/mcp/gptActions.js` — TIDAK ADA tool/aturan bisnis baru di
sini, murni jembatan transport. Baca `docs/MCP-SERVER.md` dulu untuk
konteks lengkap (tool apa saja, kenapa read-only, kenapa masking) — dokumen
ini cuma bagian "bagaimana ChatGPT nyambung ke hal yang sama".

---

## 1. Kenapa bukan langsung `/mcp`

`/mcp` bicara **MCP (Model Context Protocol)** — JSON-RPC batched, ada
langkah `initialize` lalu `tools/list`/`tools/call`. Ini yang dipakai
Claude Code/Desktop dan claude.ai.

**Custom GPT Actions** (fitur ChatGPT untuk memberi tool ke sebuah GPT)
bicara **OpenAPI/REST biasa** — satu `operationId` = satu endpoint HTTP,
tidak tahu apa-apa soal JSON-RPC atau protokol MCP. Ini keterbatasan produk
ChatGPT, bukan pilihan desain kita.

`/gpt-actions` menerjemahkan satu ke yang lain: setiap tool MCP yang sudah
ada otomatis muncul sebagai satu endpoint REST
`POST /gpt-actions/tools/<nama_tool>`, dengan skema OpenAPI yang
di-generate langsung dari definisi tool aslinya (lihat §2). **Tidak ada
tool atau aturan bisnis yang ditulis ulang** — data, masking, dan batasan
read-only-nya persis sama dengan yang dipakai Claude.

## 2. Bagaimana cara kerjanya (untuk yang mau audit/ubah kode)

`gptActions.js` memakai `InMemoryTransport.createLinkedPair()` dari SDK MCP
untuk membuat sepasang client↔server MCP **di dalam proses yang sama**
(tanpa network sungguhan), lalu:

- `GET /openapi.json` memanggil `client.listTools()` — hasilnya `inputSchema`
  per tool SUDAH berbentuk JSON Schema standar (dikonversi dari zod oleh SDK
  MCP sendiri, bukan kode kita), langsung dipakai sebagai skema
  `requestBody` tiap path OpenAPI.
- `POST /tools/:nama` memanggil `client.callTool({name, arguments: body})`,
  lalu hasil `content[0].text` (JSON string, format `hasil()` di
  `toolsShared.js`) di-parse balik jadi objek JSON biasa untuk respons REST.

Konsekuensinya: kalau ada tool baru ditambahkan ke `tools.js`/`toolsChat.js`/
`toolsTraffic.js`, dia OTOMATIS muncul di `/gpt-actions/openapi.json` tanpa
perlu sentuh `gptActions.js` sama sekali.

## 3. Auth — SATU token yang sama dengan `/mcp`

`/gpt-actions` memakai persis `requireMcpToken` + `mcpRateLimit` dari
`security.js` yang sama dipakai `/mcp` — **bukan mekanisme auth baru**:

- Token: `MCP_API_TOKEN` yang SUDAH ada (kalau Claude Code sudah
  disambungkan, tokennya sama, tidak perlu generate token kedua).
- Rate limit: 60 request/menit/IP (`MCP_RATE_LIMIT_PER_MIN`), jatah
  BERBAGI dengan `/mcp` per IP yang sama? **Tidak** — beda router, beda
  instance limiter, jadi kena hitungan sendiri-sendiri per path.
- Fail-closed sama: kalau `MCP_API_TOKEN` dan `MCP_OAUTH_JWT_SECRET`
  dua-duanya kosong di `.env`, `/gpt-actions` ikut mati (503) — TIDAK ada
  konfigurasi terpisah untuk mengaktifkan/menonaktifkan jembatan ini.

Custom GPT Actions punya tipe auth bawaan **"API Key" → "Bearer"** yang pas
untuk model ini — tidak perlu OAuth (dan memang tidak bisa: `redirect_uris`
OAuth server ini dikunci ke `claude.ai`, lihat `docs/MCP-SERVER.md`).

## 4. Setup — langkah demi langkah

### a. Pastikan `MCP_API_TOKEN` sudah terisi

Kalau Claude Code sudah tersambung ke `/mcp`, token ini SUDAH ADA di `.env`
backend (dev & VPS) — pakai ulang, jangan generate baru (satu token, dua
jembatan). Kalau belum ada sama sekali, lihat `docs/MCP-SERVER.md` §3a.

### b. Ambil skema OpenAPI (butuh token — sengaja tidak publik)

`GET /gpt-actions/openapi.json` ada DI BELAKANG token yang sama (konsisten
dengan sikap fail-closed seluruh `/mcp*`), jadi builder Custom GPT **tidak
bisa** pakai tombol "Import from URL" ala endpoint publik biasa. Ambil
manual sekali, lalu tempel:

```bash
curl -s https://app.sanomatrassehat.com/gpt-actions/openapi.json \
  -H "Authorization: Bearer $MCP_API_TOKEN" > openapi.json
```

Buka `openapi.json`, salin seluruh isinya.

### c. Buat Custom GPT

1. ChatGPT → **Explore GPTs → Create** (butuh ChatGPT Plus/Team/Enterprise
   untuk publish privat ke tim — akun gratis tidak bisa membuat Custom GPT).
2. Tab **Configure** → scroll ke **Actions** → **Create new action**.
3. Klik **"Import from URL"**? **Jangan** (akan gagal 401 tanpa header).
   Sebaliknya klik area schema lalu **tempel isi `openapi.json`** dari
   langkah (b) langsung ke editor skema.
4. **Authentication** → pilih **API Key** → Auth Type **Bearer** → isi
   dengan nilai `MCP_API_TOKEN` yang sama.
5. Simpan, lalu di tab **Instructions** GPT, jelaskan konteks bisnisnya —
   contoh singkat (silakan sesuaikan):
   > "Kamu punya akses baca-saja ke data CRM Klinik Matras (bisnis kasur
   > sehat Indonesia) lewat Action ini. Panggil `statistik_crm` dulu untuk
   > orientasi. Nomor HP/email pelanggan disamarkan default — jangan minta
   > unmask kecuali user memang eksplisit butuh kontak lengkap. Tanggal
   > parameter pakai format YYYY-MM-DD kalender WIB."
6. Publish **hanya ke "Only me" atau "Anyone with a link" internal tim** —
   JANGAN publish publik ke GPT Store (ini akses data pelanggan asli).

### d. Verifikasi cepat (tanpa buka ChatGPT dulu)

```bash
# Harus 401 tanpa token
curl -i https://app.sanomatrassehat.com/gpt-actions/openapi.json

# Harus 200 + daftar path per tool
curl -s https://app.sanomatrassehat.com/gpt-actions/openapi.json \
  -H "Authorization: Bearer $MCP_API_TOKEN" | jq '.paths | keys'

# Contoh panggil satu tool langsung (sama seperti yang ChatGPT lakukan)
curl -s -X POST https://app.sanomatrassehat.com/gpt-actions/tools/statistik_crm \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

## 5. Batasan yang perlu diketahui

- **Ini bukan resource OAuth terpisah.** `/gpt-actions` sengaja divalidasi
  terhadap audience OAuth `/mcp` yang sama (bukan resource baru) — karena
  secara data dia memang BUKAN permukaan baru, cuma transport baru ke
  resource yang sama. Kalau suatu hari perlu mencabut akses ChatGPT TANPA
  mematikan Claude Code, satu-satunya cara sekarang adalah rotasi
  `MCP_API_TOKEN` (mematikan KEDUANYA) — belum ada token terpisah per
  klien. Kalau ini jadi kebutuhan nyata, perlu token kedua (mis.
  `GPT_ACTIONS_API_TOKEN`) yang dicek di `requireMcpToken`-nya sendiri;
  belum dibangun karena belum ada kasus nyatanya.
- **Custom GPT Actions punya batas ukuran/kompleksitas skema** dari sisi
  OpenAI (jumlah operasi, kedalaman schema) — dengan ~18 tool saat ini
  masih jauh di bawah batas itu, tapi kalau daftar tool MCP terus bertambah
  banyak, redesain (mis. pecah jadi beberapa GPT Action per kelompok tool)
  mungkin perlu dipertimbangkan.
- **Tidak ada apa pun di sini yang menulis data** — sama seperti `/mcp`,
  seluruh tool di baliknya cuma `findMany`/`aggregate`/dst (dijaga tes
  otomatis `tests/mcp.test.js`). `/gpt-actions` tidak menambah tool tulis
  apa pun, cuma membungkus ulang yang sudah read-only.
