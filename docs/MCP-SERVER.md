# MCP Server READ-ONLY — CRM Klinik Matras

Endpoint: `https://app.sanomatrassehat.com/mcp`
Kode: `backend/src/mcp/` — `index.js` (router & transport), `security.js`
(token, rate limit, masking), `tools.js` (12 tool baca), `oauthCrypto.js`
(primitif OAuth murni: PKCE/JWT/hash), `oauth.js` (router OAuth 2.1 —
`/oauth/*`, `/.well-known/*`).

**Dua jalur auth, dua audiens:**
| Jalur | Untuk siapa | Bagaimana |
|---|---|---|
| Token statis (`MCP_API_TOKEN`) | Claude Code / Claude Desktop | `claude mcp add --header "Authorization: Bearer ..."` |
| OAuth 2.1 (`MCP_OAUTH_JWT_SECRET`) | Claude.ai (browser) | Login CRM (khusus role **ADMIN**) lewat halaman `/oauth/authorize` |

OAuth ditambahkan 14 Agustus 2026 karena UI custom connector claude.ai
browser **tidak punya kolom header kustom** — cuma OAuth Client ID/Secret,
dan fitur `static_headers` (beta) belum rollout ke akun ini (dikonfirmasi
lewat dialog "Tambah konektor kustom": cuma ada field OAuth). Dua jalur ini
hidup berdampingan — menambah OAuth **tidak mengubah** cara Claude Code
connect.

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

## 2. Keamanan (5 lapis)

| Lapis | Mekanisme | Kalau dilanggar |
|---|---|---|
| 1. Auth | Token statis **ATAU** access token OAuth (lihat tabel di atas) | 401 + header `WWW-Authenticate` |
| 2. OAuth: hanya ADMIN | `/oauth/authorize` menolak login SALES (`rolesOf()`, bukan cek `role` langsung) | 403, halaman error jelas |
| 3. Rate limit | `/mcp`: 60 req/menit/IP. `/oauth/authorize` (login): 10 req/menit/IP | 429 + `Retry-After` |
| 4. Read-only | Semua tool hanya `findMany`/`findUnique`/`aggregate`/`groupBy`/`count` | dijaga tes otomatis |
| 5. Masking PII | Nomor HP & email pelanggan disamarkan default (`628****0076`) | param `unmask=true` per tool |

**Fail-closed:** kalau `MCP_API_TOKEN` **dan** `MCP_OAUTH_JWT_SECRET`
dua-duanya kosong, seluruh endpoint `/mcp` menjawab **503** — lupa mengisi
env TIDAK pernah berarti data CRM terbuka bebas. Kalau salah satu saja
terisi, `/mcp` tetap aktif lewat jalur itu.

**Kenapa token statis env, bukan JWT user (untuk Claude Code):** integrasi
mesin-ke-mesin yang dipasang sekali lalu ditinggal; JWT user berumur 7 hari
dan terikat ke satu orang. Token ini juga bukan pengganti login CRM — dia
tidak bisa dipakai ke `/api/*` mana pun.

**Kenapa OAuth terpisah, bukan JWT login CRM langsung (untuk claude.ai):**
UI custom connector claude.ai browser cuma punya field OAuth. Access token
OAuth MCP ditandatangani dengan secret **BEDA** (`MCP_OAUTH_JWT_SECRET` ≠
`JWT_SECRET`) — supaya token MCP tidak pernah bisa dipakai sebagai token
login CRM biasa atau sebaliknya, walau bentuknya sama-sama JWT.

**Kenapa OAuth dibatasi ADMIN saja:** tool MCP membaca SEMUA data pelanggan
lintas sales (bukan cuma milik sendiri) — setara dengan "siapa yang boleh
pegang `MCP_API_TOKEN`", dan sebelumnya cuma admin yang pegang itu. Kalau
sales biasa boleh login, mereka bisa sambungkan akun claude.ai pribadinya ke
data pelanggan seluruh perusahaan tanpa sepengetahuan admin.

**Kenapa server ini efektif cuma bisa dipakai Claude:** Dynamic Client
Registration (`POST /oauth/register`) MENOLAK `redirect_uris` apa pun selain
persis `https://claude.ai/api/mcp/auth_callback` (lihat
`validateRedirectUris` di `oauthCrypto.js`). Tidak ada tempat lain
authorization code/token bisa dikirim.

**Rotasi/cabut akses:**
- Token statis: ganti `MCP_API_TOKEN` di `.env` lalu restart backend.
- OAuth: ganti `MCP_OAUTH_JWT_SECRET` → semua access token OAuth yang
  beredar langsung tidak valid (gagal verifikasi tanda tangan). Refresh
  token tersimpan di DB (`McpRefreshToken`) — kalau perlu mencabut sesi
  OAuth tertentu tanpa mematikan semuanya, revoke barisnya langsung di DB
  (`revokedAt`), atau hapus barisnya.

**Refresh token ROTASI wajib** (public client + PKCE, bukan opsional):
tiap dipakai, token lama langsung `revokedAt` dan token baru diterbitkan.
Reuse token yang sudah di-revoke = `invalid_grant` — replay token lama
setelah rotasi selalu gagal.

**Catatan rate limit di belakang nginx:** `req.ip` selalu `127.0.0.1`, jadi
kunci limit diambil dari `X-Forwarded-For` yang diisi nginx. Ini aman selama
port 4000 tidak diekspos langsung ke internet (arsitektur sekarang: tidak).

---

## 3. Setup

### a. Generate token/secret & isi .env

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Jalankan DUA KALI untuk dua nilai berbeda — jangan pernah pakai hasil yang
sama untuk `MCP_API_TOKEN` dan `MCP_OAUTH_JWT_SECRET`. Isi salah satu (atau
dua-duanya) di `backend/.env` (dev) dan `.env` di VPS (production):

```
# Untuk Claude Code/Desktop:
MCP_API_TOKEN="<hasil generate #1>"
MCP_RATE_LIMIT_PER_MIN=60

# Untuk claude.ai browser:
MCP_PUBLIC_URL="https://app.sanomatrassehat.com"   # dev: http://localhost:4000
MCP_OAUTH_JWT_SECRET="<hasil generate #2>"
```

### b. Restart backend

```bash
# lokal
cd backend && npm run dev

# VPS
cd ~/klinik-matras && docker compose up -d --build backend
```

Saat start, log backend menyebutkan statusnya, termasuk jalur auth mana yang
aktif:

```
MCP server READ-ONLY aktif di /mcp [token statis (Claude Code) + OAuth (claude.ai browser)] (rate limit 60 req/menit)
```

atau `MCP server NONAKTIF — set MCP_API_TOKEN dan/atau MCP_OAUTH_JWT_SECRET ...`
kalau DUA-DUANYA belum diisi.

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

**Claude Code / Claude Desktop** — custom header, token statis:
```bash
claude mcp add --transport http klinik-matras https://app.sanomatrassehat.com/mcp \
  --header "Authorization: Bearer <MCP_API_TOKEN>"
```

**Claude.ai (Custom Connector di browser)** — OAuth, login pakai akun ADMIN:
1. **Customize/Pengaturan → Connectors/Konektor → "Add custom connector"**
2. URL: `https://app.sanomatrassehat.com/mcp`
3. **JANGAN isi apa pun** di "Pengaturan lanjutan" (OAuth Client ID/Secret) —
   dikosongkan saja, server ini pakai Dynamic Client Registration otomatis.
4. Klik "Add/Tambahkan" → Claude membuka halaman login CRM
   (`/oauth/authorize`) di tab baru
5. Masuk pakai email+password **akun ADMIN** (Gilang/Novi) — akun SALES akan
   ditolak dengan pesan jelas, bukan pura-pura berhasil
6. Setelah "Masuk & Izinkan", otomatis kembali ke claude.ai, connector
   berstatus terhubung
7. Di jendela chat, tombol **"+" → Connectors** → aktifkan `klinik-matras`

⚠️ **Yang TIDAK boleh dilakukan:** membuka `/mcp` tanpa auth "sementara
untuk tes", atau melonggarkan gate ADMIN di `/oauth/authorize` supaya SALES
bisa login juga. Endpoint ini membaca SELURUH data pelanggan lintas sales.

### ⚠️ Kalau CRM ter-install sebagai PWA di komputer admin: PAKAI INCOGNITO

**Gejala (ditemukan & didiagnosis 14 Agustus 2026):** klik "Add" di claude.ai
→ status nyangkut "mulai terhubung tetapi belum selesai" → begitu login,
yang muncul layar login CRM **biasa** (dark theme, dashboard/portal), BUKAN
kartu putih kecil "Izinkan akses Claude" dari `/oauth/authorize`.

**Akar masalah:** kalau CRM sudah pernah di-install sebagai aplikasi PWA
(ikon terpisah, bukan sekadar tab), Windows/Chrome menangkap link OAuth yang
dibuka Claude dan malah **membuka app PWA yang ter-install** (dianggap "buka
di app"), bukan tab browser biasa. App PWA itu boot ke router React-nya
sendiri, tidak tahu apa-apa soal `/oauth/authorize` (rute itu di-handle
Express, bukan React Router), jadi jatuh ke layar login SPA biasa lalu
`/portal` — deep-link OAuth-nya terbuang begitu saja. **Sudah diverifikasi
lewat nginx access log:** request `GET /oauth/authorize` untuk kasus ini
TIDAK PERNAH sampai ke server sama sekali (server-side sudah dites benar via
curl langsung) — jadi bug ini murni perilaku PWA-launch di browser, BUKAN
bug di `oauth.js`.

**Solusi:** lakukan proses "Add custom connector" dari jendela
**Incognito/Private Browsing** (`Ctrl+Shift+N`). Incognito tidak pernah
membuka app PWA yang ter-install, jadi link OAuth pasti kebuka sebagai tab
browser biasa dan sampai ke `/oauth/authorize` dengan benar. Ini cukup
dilakukan **sekali** per admin — access/refresh token yang dihasilkan tetap
berlaku normal (refresh token 30 hari, rotasi otomatis) walau sesi Incognito
sudah ditutup.

---

## 4. Daftar tool (semua read-only)

Kode tool dipecah 3 file supaya tidak jadi satu file raksasa — helper bersamanya
di `toolsShared.js`: `tools.js` (CRM inti), `toolsChat.js` (percakapan & audit),
`toolsTraffic.js` (traffic & iklan).

### CRM inti (`tools.js`)

| Tool | Fungsi |
|---|---|
| `statistik_crm` | Snapshot cepat + daftar ID sales. **Panggil ini dulu untuk orientasi.** |
| `cari_pelanggan` | Cari pelanggan (nama/HP/kota/stage/tipe/sumber lead/nilai order) |
| `detail_pelanggan` | Profil lengkap: order, catatan, riwayat pipeline, keluhan, percakapan, **+ skor CRM** (relasi/urgensi/peluang beli dari mesin intelligence) |
| `cari_order` | Cari order (status, kategori, pembayaran, komplain, rentang tanggal) |
| `detail_order` | Rincian layanan & harga, berat badan per orang, riwayat status |
| `ringkasan_penjualan` | Agregat penjualan per periode (per status/kategori/pembayaran) |
| `ringkasan_pipeline` | Jumlah & nilai per pipeline stage + perpindahan stage per periode |
| `ringkasan_sumber_lead` | Distribusi & conversion rate per sumber lead |
| `performa_sales` | Realisasi vs target bulanan per sales |
| `daftar_percakapan` | Inbox: status, pemegang, belum dibaca, lama tidak dibalas |
| `riwayat_percakapan` | Isi pesan satu percakapan — **berpaginasi** (`sebelum`/`adaLagi`), filter tanggal & arah, `urutan=terlama` untuk baca alur dari awal |
| `daftar_produk` | Katalog produk/layanan (tanpa data pelanggan) |

### Percakapan, kualitas & audit (`toolsChat.js`)

| Tool | Fungsi |
|---|---|
| `cari_pesan` | Cari kata/frasa di **seluruh** isi pesan lintas percakapan |
| `kualitas_engagement` | Kualitas pelanggan dari pola balas chat (TINGGI/SEDANG/RENDAH) + skor CRM sebagai pembanding |
| `audit_balasan_sales` | **Audit kepatuhan sales**: pelanggaran aturan produk + SLA + komplain tak tertangani + "balas di awal lalu hilang" |
| `diagnosa_percakapan` | Bedah 1 percakapan pesan-per-pesan: pelanggaran, jeda respons, intent, ringkasan kepatuhan |

### Traffic & iklan (`toolsTraffic.js`)

| Tool | Fungsi |
|---|---|
| `tren_traffic_lead` | Tren harian lead + jam/hari tersibuk + pembanding periode sebelumnya |
| `performa_iklan` | Performa per sumber lead **dan per kreatif iklan Meta** (URL post IG/FB dari CTWA) |

**Tanggal:** parameter `dari`/`sampai` memakai kalender **WIB** format
`YYYY-MM-DD` dan diterjemahkan lewat `utils/wib.js` (batas atas EKSKLUSIF).
Tanggal di hasil tetap ISO 8601 UTC. Lihat CLAUDE.md §11 kenapa ini penting.

**Atribusi sales** di `performa_sales` memakai `Customer.assignedSalesId`
(kepemilikan lead), sama dengan endpoint target di `routes/analytics.js` —
BUKAN `Conversation.assignedToId` yang dipakai laporan Performa CS.

### Aturan & ambang yang dipakai audit (JANGAN didefinisikan ulang)

Tool audit **tidak punya aturan sendiri** — semuanya dipakai ulang dari mesin
yang sudah jalan di produk, supaya standar CRM dan standar audit tidak pernah
berbeda:

| Yang diukur | Sumber kebenaran | Catatan |
|---|---|---|
| 7 kategori janji terlarang (harga, diskon, gratis, waktu kirim, garansi flat, klaim medis, jaminan mutlak) | `violations()` di `services/replyAssistant/validator.js` | Dibuat untuk menyaring draf AI; di MCP dipakai mengaudit pesan sales sungguhan |
| Intent pelanggan & kewajiban handover (COMPLAINT, HANDOVER_REQUEST) | `detectIntents()` + `INTENT_TAXONOMY` di `services/intelligence/replyReadiness.js` | |
| Skor relasi / urgensi / peluang beli | `buildCustomerIntelligence()` di `services/intelligence/` | Angkanya sama persis dengan UI Customer360 |
| SLA balas pertama = **60 menit** | `SLA_BALAS_PERTAMA_MENIT` di `toolsChat.js` | Sengaja sama dengan `sla_breach` di `routes/analytics.js` & ambang takeover CLAUDE.md §7C. Bisa di-override lewat param `slaMenit`. |

⚠️ Deteksi aturan produk berbasis pola teks, jadi **bisa ada false positive**
(mis. sales menyalin ulang kalimat pelanggan yang menyebut harga). Tool selalu
mengembalikan kutipannya — baca dulu sebelum dipakai menegur orang.

### Batas jumlah data (penting saat membaca hasil)

Production punya ~76.000 pesan, jadi tool yang menyisir pesan **dibatasi**:
`audit_balasan_sales` maks 5.000 pesan keluar + 500 percakapan per panggilan,
`kualitas_engagement` maks 500 percakapan (default 200), pesan per percakapan
maks 200. Kalau batas tercapai, hasilnya memuat `terpotong: true` / `adaLagi:
true` — **angkanya bukan total periode**; persempit rentang tanggal.

---

## 5. Aturan saat menambah tool baru

1. **Read-only, tanpa kecuali.** Tidak ada `create/update/delete/upsert/
   $executeRaw/$transaction`. Tidak ada import `wahaClient.js`. `$queryRaw`
   boleh tapi HARUS `SELECT` murni. `tests/mcp.test.js` memindai SEMUA file
   `tools*.js` dan GAGAL kalau pola ini muncul.
   ⚠️ **Kalau membuat file `toolsXxx.js` BARU, daftarkan di konstanta
   `FILE_TOOL` pada `tests/mcp.test.js`** — ada tes terpisah yang mencocokkan
   daftar itu dengan isi folder, jadi kelupaan akan ketahuan, bukan lolos diam-diam.
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

---

## 6. Verifikasi manual alur OAuth (kalau mengubah oauth.js/oauthCrypto.js)

`tests/mcp-oauth.test.js` cuma menguji fungsi murni (PKCE, JWT, validasi
redirect_uris) tanpa DB — kalau mengubah alur login/token, verifikasi manual
langkah-langkah ini (lihat riwayat percakapan pengembangan untuk contoh
lengkap curl per langkah):

1. `POST /mcp` tanpa token → `401` + `WWW-Authenticate` memuat `resource_metadata`
2. `GET /.well-known/oauth-protected-resource` & `/.well-known/oauth-authorization-server` → JSON valid
3. `POST /oauth/register` dengan `redirect_uris` benar → `201`; dengan yang salah → `400`
4. `GET /oauth/authorize?...` → halaman login (cek hidden fields lengkap, TERMASUK `response_type`)
5. Login akun SALES → `403`. Login akun ADMIN → `302` ke `redirect_uri` dengan `code`
6. `POST /oauth/token` (authorization_code, verifier benar) → access + refresh token. Code dipakai ULANG → `invalid_grant`
7. Access token dipakai ke `POST /mcp` `tools/list` → `200` + 12 tool
8. `POST /oauth/token` (refresh_token) → token baru. Refresh token LAMA dipakai lagi → `invalid_grant`
9. Token statis (`MCP_API_TOKEN`) masih tetap bisa akses `/mcp` — regresi check