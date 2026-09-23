# SANSS Sales CRM — ChatGPT Plugin berbasis MCP

Status: implementasi source dan test lokal. Belum di-deploy dan belum pernah
dipanggil dari ChatGPT.

## Endpoint dan transport

- MCP URL: `https://app.sanomatrassehat.com/mcp-chatgpt`
- Transport: Streamable HTTP, stateless
- Auth: OAuth 2.1 authorization code + PKCE S256
- Audience token: URL MCP di atas; token `/mcp` atau `/mcp-hub` ditolak
- Role: hanya akun aktif dengan role `ADMIN`, diperiksa ulang di server pada
  setiap request
- Data: hanya divisi Sales, agregat/katalog, read-only

Endpoint ini adalah facade dari registrasi dan handler `/mcp` yang sudah ada.
Tidak ada query, tabel, atau implementasi bisnis kedua.

## Enam tool aktif

1. `sales_ringkasan_penjualan`
2. `sales_ringkasan_pipeline`
3. `sales_ringkasan_sumber_lead`
4. `sales_tren_traffic_lead`
5. `sales_performa_iklan`
6. `sales_daftar_produk`

Semua tool memiliki `readOnlyHint: true`, `destructiveHint: false`, dan
`openWorldHint: false`. Parameter `unmask` tidak ada pada schema ChatGPT dan
nilai `false` tetap dipaksa pada handler server.

Mapping 12 tool lain sudah dicatat di `CHATGPT_TOOL_CATALOG` dalam
`backend/src/mcp/chatgptPlugin.js`, tetapi tidak diregistrasikan. Ini mencakup
profil pelanggan/order, metadata dan isi percakapan, statistik lintas divisi,
performa individu sales, engagement, serta audit/diagnosa pesan.

## Hasil audit kontrak lama

Kontrak OpenAPI lama dan implementasi tidak sepenuhnya cocok dengan release
gate ini:

- `/gpt-actions/tools/*` mengekspos 18 operation ID tanpa prefix divisi,
  sedangkan katalog baru memakai `<division>_<action>`.
- REST memakai `POST`, tetapi handler MCP yang dipanggil tetap murni baca.
- Response OpenAPI lama hanya `additionalProperties: true`; tidak ada kontrak
  output terstruktur yang dapat diklaim lebih ketat.
- Dokumentasi lama menawarkan `unmask`. Sekarang schema REST menyembunyikannya
  dan server memaksa `unmask: false`.
- `/mcp` tetap mempertahankan 18 nama lama untuk kompatibilitas Claude.
- OAuth lama hanya mengizinkan callback Claude. Allowlist sekarang dapat
  ditambah dengan callback ChatGPT melalui environment, tetap exact-match dan
  tanpa wildcard.
- Token statis `/mcp` tidak membawa identitas user/role. Karena itu endpoint
  ChatGPT tidak menerima token statis dan mewajibkan OAuth user.
- Tool grup internal dan isi pesan tidak tersedia pada `/mcp-chatgpt`.

## Konfigurasi environment

Gunakan konfigurasi existing berikut; jangan masukkan nilainya ke chat atau
commit:

```dotenv
MCP_PUBLIC_URL="https://app.sanomatrassehat.com"
MCP_OAUTH_JWT_SECRET="<secret-terpisah-dari-JWT_SECRET>"
MCP_CHATGPT_REDIRECT_URIS="<callback-persis-yang-diberikan-ChatGPT>"
```

Beberapa callback dapat dipisahkan koma. Seluruh URI wajib cocok dengan
allowlist. Kredensial production tidak perlu dan tidak boleh diubah untuk test
source lokal.

## Hubungkan melalui ChatGPT Developer Mode

Menurut dokumentasi resmi OpenAI:

1. Buka ChatGPT web, lalu **Settings → Security and login**.
2. Aktifkan **Developer mode**.
3. Buka **ChatGPT Plugins**, tekan tombol plus, dan buat koneksi baru.
4. Masukkan URL `https://app.sanomatrassehat.com/mcp-chatgpt`.
5. Pilih OAuth/DCR dan selesaikan login menggunakan akun ADMIN SANSS.
6. Periksa bahwa hanya enam tool di atas yang ditemukan dan seluruhnya
   ditandai read-only.
7. Setelah perubahan metadata di-deploy, gunakan **Refresh** pada detail app.
8. Uji satu panggilan nyata dari percakapan ChatGPT sebelum menyatakan plugin
   terhubung.

Untuk pengujian sebelum deploy publik, gunakan MCP Inspector atau Secure MCP
Tunnel. Paket manifest portable berada di `plugins/sanss-sales-crm/`.

Referensi resmi:

- https://developers.openai.com/api/docs/guides/developer-mode
- https://developers.openai.com/plugins/quickstart
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/build/auth

## Batas rollout

- Pekerjaan ini tidak melakukan deploy atau perubahan credential production.
- Jangan aktifkan 12 mapping tertunda hanya karena tool sudah ada di `/mcp`.
- Akses percakapan grup internal, isi pesan, dan audit kutipan tetap tertutup
  sampai ada permission/data-scope yang lebih granular daripada ADMIN global.
- Jangan klaim plugin terhubung sampai OAuth dan satu tool benar-benar berhasil
  dipanggil dari ChatGPT.

## Checklist release

### Sebelum merge

- Pastikan branch hanya berbeda pada file MCP/plugin/test/dokumentasi yang
  tercantum di commit dan tidak membawa perubahan Finance atau worktree lokal.
- Jalankan unit backend, test MCP/OAuth, integrasi enam tool, serta integration
  suite ketika tidak ada runner lain yang memakai `klinik_matras_test`.
- Review diff dan secret scan. Nilai `MCP_API_TOKEN`,
  `MCP_OAUTH_JWT_SECRET`, access token, authorization code, dan refresh token
  tidak boleh berada dalam commit atau log CI.
- Merge `feat/chatgpt-mcp-sales` ke `main` melalui PR/non-force setelah branch
  diperbarui terhadap `origin/main` dan checks lulus.

### Konfigurasi dan deploy backend

1. Di halaman pengelolaan koneksi MCP ChatGPT, salin redirect URI yang
   ditampilkan. Jangan menebak URI atau memakai contoh dari dokumentasi.
2. Di konfigurasi rahasia VPS, pertahankan `MCP_OAUTH_JWT_SECRET` yang sudah
   ada, pastikan `MCP_PUBLIC_URL=https://app.sanomatrassehat.com`, lalu isi
   `MCP_CHATGPT_REDIRECT_URIS` dengan URI persis tersebut. Jangan gunakan
   wildcard dan jangan menaruh nilainya di Git atau command yang tercatat log.
3. Di `~/klinik-matras`, tarik `main` terbaru dan jalankan
   `docker compose up -d --build backend`. Tidak ada migration untuk rilis ini.
4. Pastikan sertifikat HTTPS valid dan reverse proxy meneruskan POST
   `/mcp-chatgpt`, `/.well-known/*`, dan `/oauth/*` ke backend. Jangan membuka
   port backend langsung ke internet.
5. Tanpa token, POST `/mcp-chatgpt` harus menjawab `401` dengan
   `WWW-Authenticate` yang menunjuk metadata `/mcp-chatgpt`. Verifikasi metadata
   resource/authorization server memakai URL HTTPS production.

### Uji nyata dari ChatGPT

1. Tambah/refresh koneksi MCP di Developer Mode dengan URL
   `https://app.sanomatrassehat.com/mcp-chatgpt`.
2. Selesaikan OAuth menggunakan akun ADMIN aktif. Uji bahwa akun non-ADMIN
   ditolak dan token untuk `/mcp` tidak diterima pada `/mcp-chatgpt`.
3. Pastikan `tools/list` hanya berisi enam tool aktif, seluruhnya read-only,
   dan schema tidak memiliki `unmask`.
4. Panggil `sales_daftar_produk` sebagai smoke test tanpa data pelanggan, lalu
   satu tool agregat dengan rentang tanggal aman. Cocokkan respons dengan SANSS.
5. Simpan bukti waktu uji dan hasil, bukan token/kode OAuth. Baru setelah OAuth
   dan satu panggilan tool nyata lulus, tandai koneksi berhasil.

### Rollback

- Revert commit merge MCP di `main` (tanpa force-push), tarik commit rollback di
  VPS, lalu jalankan kembali `docker compose up -d --build backend`.
- Rilis ini tidak mempunyai migration atau perubahan data, sehingga rollback
  tidak membutuhkan perubahan database.
- Setelah backend lama sehat, hapus callback ChatGPT dari konfigurasi rahasia
  bila koneksi harus dicabut, lalu recreate backend. Jangan mengubah atau
  mencetak secret OAuth yang dipakai connector MCP lain.
