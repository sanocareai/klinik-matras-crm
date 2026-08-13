# MCP Server READ-ONLY — CRM Klinik Matras

Endpoint: `https://app.sanomatrassehat.com/mcp`
Kode: `backend/src/mcp/` — `index.js` (router & transport), `security.js`
(token, rate limit, masking), `tools.js` (12 tool baca).

Tujuan: Claude.ai bisa menjawab pertanyaan tentang data CRM ("berapa order
bulan ini?", "pelanggan mana yang chatnya nggak dibalas 2 hari?") **tanpa**
bisa mengubah apa pun.

---

## 1. Ringkasan arsitektur

- **Bukan service/container terpisah.** Di-mount ke backend Express yang sudah
  ada (`app.use("/mcp", mcpRouter)` di `backend/src/index.js`), memakai Prisma
  client yang sama (`../db.js`). Tidak menambah biaya VPS.
- **Transport:** Streamable HTTP dari `@modelcontextprotocol/sdk` v1.30,
  mode **stateless** (`sessionIdGenerator: undefined`). Satu `McpServer` per
  request, ditutup begitu respons selesai — tidak ada sesi menggantung di
  memori.
- **nginx tidak perlu diubah.** `/mcp` ikut `proxy_pass http://localhost:4000`
  yang sudah ada. `proxy_buffering off` **belum** dibutuhkan karena mode
  stateless tidak memakai SSE jangka panjang.

---

## 2. Keamanan (4 lapis)

| Lapis | Mekanisme | Kalau dilanggar |
|---|---|---|
| 1. Auth | Bearer token dari env `MCP_API_TOKEN` (bukan JWT user) | 401 + header `WWW-Authenticate` |
| 2. Rate limit | 60 request/menit per IP (`MCP_RATE_LIMIT_PER_MIN`) | 429 + `Retry-After` |
| 3. Read-only | Semua tool hanya `findMany`/`findUnique`/`aggregate`/`groupBy`/`count` | dijaga tes otomatis |
| 4. Masking PII | Nomor HP & email pelanggan disamarkan default (`628****0076`) | param `unmask=true` per tool |

**Fail-closed:** kalau `MCP_API_TOKEN` kosong/tidak diset, seluruh endpoint
`/mcp` menjawab **503** — lupa mengisi env TIDAK pernah berarti data CRM
terbuka bebas.

**Kenapa token env, bukan JWT user:** MCP itu integrasi mesin-ke-mesin yang
dipasang sekali lalu ditinggal; JWT user berumur 7 hari dan terikat ke satu
orang. Token ini juga bukan pengganti login CRM — dia tidak bisa dipakai ke
`/api/*` mana pun.

**Rotasi/cabut akses:** ganti nilai `MCP_API_TOKEN` di `backend/.env` lalu
restart backend. Tidak ada state lain yang perlu dibersihkan.

**Catatan rate limit di belakang nginx:** `req.ip` selalu `127.0.0.1`, jadi
kunci limit diambil dari `X-Forwarded-For` yang diisi nginx. Ini aman selama
port 4000 tidak diekspos langsung ke internet (arsitektur sekarang: tidak).

---

## 3. Setup

### a. Generate token & isi .env

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Di `backend/.env` (dev) dan `.env` di VPS (production):

```
MCP_API_TOKEN="<hasil generate di atas>"
MCP_RATE_LIMIT_PER_MIN=60
```

### b. Restart backend

```bash
# lokal
cd backend && npm run dev

# VPS
cd ~/klinik-matras && docker compose up -d --build backend
```

Saat start, log backend menyebutkan statusnya:

```
MCP server READ-ONLY aktif di /mcp (rate limit 60 req/menit)
```

atau `MCP server NONAKTIF — set MCP_API_TOKEN ...` kalau env belum diisi.

### c. Verifikasi cepat

```bash
# Harus 401 (tanpa token)
curl -i -X POST https://app.sanomatrassehat.com/mcp

# Harus 200 + daftar 12 tool
curl -s -X POST https://app.sanomatrassehat.com/mcp \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Info server (diagnosa setup)
curl -s https://app.sanomatrassehat.com/mcp/info -H "Authorization: Bearer $MCP_API_TOKEN"
```

### d. Sambungkan ke Claude

Server ini memakai **Bearer token statis**, bukan OAuth.

- **Claude Code / Claude Desktop** — dukung custom header:
  ```bash
  claude mcp add --transport http klinik-matras https://app.sanomatrassehat.com/mcp \
    --header "Authorization: Bearer <MCP_API_TOKEN>"
  ```
- **Claude.ai (Custom Connector di browser)** — form connector di claude.ai
  mengharapkan OAuth atau endpoint tanpa auth; **belum tentu** menyediakan
  kolom header kustom. Kalau ternyata tidak ada kolomnya, opsinya:
  1. pakai Claude Code/Desktop (paling cepat, tidak perlu kode tambahan), atau
  2. tambahkan lapisan OAuth 2.1 di depan `/mcp` — pekerjaan terpisah,
     **jangan** dikerjakan dengan cara melonggarkan auth yang sekarang.

⚠️ **Yang TIDAK boleh dilakukan** kalau connector claude.ai menolak: membuka
`/mcp` tanpa auth "sementara untuk tes". Endpoint ini membaca SELURUH data
pelanggan.

---

## 4. Daftar tool (semua read-only)

| Tool | Fungsi |
|---|---|
| `statistik_crm` | Snapshot cepat + daftar ID sales. **Panggil ini dulu untuk orientasi.** |
| `cari_pelanggan` | Cari pelanggan (nama/HP/kota/stage/tipe/sumber lead/nilai order) |
| `detail_pelanggan` | Profil lengkap: order, catatan, riwayat pipeline, riwayat keluhan, percakapan |
| `cari_order` | Cari order (status, kategori, pembayaran, komplain, rentang tanggal) |
| `detail_order` | Rincian layanan & harga, berat badan per orang, riwayat status |
| `ringkasan_penjualan` | Agregat penjualan per periode (per status/kategori/pembayaran) |
| `ringkasan_pipeline` | Jumlah & nilai per pipeline stage + perpindahan stage per periode |
| `ringkasan_sumber_lead` | Distribusi & conversion rate per sumber lead |
| `performa_sales` | Realisasi vs target bulanan per sales |
| `daftar_percakapan` | Inbox: status, pemegang, belum dibaca, lama tidak dibalas |
| `riwayat_percakapan` | Isi pesan sebuah percakapan |
| `daftar_produk` | Katalog produk/layanan (tanpa data pelanggan) |

**Tanggal:** parameter `dari`/`sampai` memakai kalender **WIB** format
`YYYY-MM-DD` dan diterjemahkan lewat `utils/wib.js` (batas atas EKSKLUSIF).
Tanggal di hasil tetap ISO 8601 UTC. Lihat CLAUDE.md §11 kenapa ini penting.

**Atribusi sales** di `performa_sales` memakai `Customer.assignedSalesId`
(kepemilikan lead), sama dengan endpoint target di `routes/analytics.js` —
BUKAN `Conversation.assignedToId` yang dipakai laporan Performa CS.

---

## 5. Aturan saat menambah tool baru

1. **Read-only, tanpa kecuali.** Tidak ada `create/update/delete/upsert/
   $executeRaw/$transaction`. Tidak ada import `wahaClient.js`.
   `tests/mcp.test.js` memindai `tools.js` dan GAGAL kalau pola ini muncul.
2. **Setiap tool yang mengembalikan kontak pelanggan wajib punya param
   `unmask`** dan memakai `maskPhone()`/`maskEmail()` dari `security.js`.
3. **Pakai helper WIB** untuk semua batas tanggal — jangan `new Date(y,m,d)`.
4. **Batasi `take`.** Semua daftar dibatasi maksimal 100 baris; jangan
   mengembalikan tabel penuh (1.300+ pelanggan) ke konteks model.
5. **Anotasi `ANOTASI_BACA`** (readOnlyHint/destructiveHint) wajib ikut —
   ada tes yang memastikannya.

Jalankan tes:

```bash
cd backend && npm test
```