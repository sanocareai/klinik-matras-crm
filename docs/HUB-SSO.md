# SSO Task & Meeting — kontrak sisi SANSS (D-200)

**Status:** tahap 4 (state/nonce, siklus akses, kartu portal, revoke keluar)
+ same-domain embedding + Main Hub (Tugas Saya/Pantauan Leader, Okt 2026)
selesai di branch `feat/task-meeting-sso-current` (SANSS) /
`feat/sanss-meeting-workspace` (HUB), **mati secara default**
(`HUB_SSO_ENABLED=false`). Kedua flag (SANSS `HUB_SSO_ENABLED` dan HUB
`SANSS_SSO_ENABLED`) harus menyala berbarengan sebelum kartu portal, widget
Main Hub, atau alur mana pun terlihat pengguna — salah satu mati berarti
404/`ready:false` bersih, **tanpa** jatuh ke Google login, dev bypass, atau
auto-join. Belum pernah di-deploy ke production; belum di-merge ke `main`.

Keputusan dasar: [D-200](sano-hub/DECISIONS.md) — SANO-HUB (Next.js + database
sendiri) boleh berjalan terpisah; **SANSS tetap pemilik identitas dan
authorization**; integrasi hanya lewat SSO/API; tidak berbagi JWT secret,
koneksi DB, atau FK lintas database.

## Bentuk alur

```
Browser (login SANSS, token di localStorage)
  │ 0. klik kartu "Task & Meeting" di Portal → navigasi PENUH (bukan iframe,
  │    bukan React Router) ke HUB GET /sso/start
  ▼
HUB ── GET /sso/start ── buat `state` acak ≥256-bit, simpan HttpOnly di
  │    cookie HUB sendiri, redirect ke halaman peluncuran SANSS dengan
  │    HANYA SHA-256(state) di query — `state` ASLI tidak pernah keluar dari
  │    cookie HUB, dan hash-nya juga tidak pernah muncul di URL AKHIR.
  ▼
SANSS /hub/launch ── 1. POST /api/hub/handoff {next?, stateHash}   Authorization: Bearer <JWT SANSS>
  │◄─ {method:"POST", postUrl:"<HUB_BASE_URL>/sso/callback", fields:{code}, expiresInSec:60}
  │ 2. form POST (top-level, auto-submit) code → HUB /sso/callback   (kode & state TIDAK PERNAH di URL/log/Referer)
  ▼
HUB (server) ── 3. POST /api/hub/internal/exchange {code}  X-Hub-Service-Token ──► SANSS
             ◄─ {sub,name,email,roles,hubRole,active,destination,stateHash}
   4. HUB bandingkan (waktu-konstan) SHA-256(cookie state) dgn stateHash — beda ⇒ tolak, cookie state dihapus
   5. cocok ⇒ HUB membuat sesinya sendiri, cookie state dihapus, mendarat di `destination`
   6. paling sering tiap 60 detik: POST /api/hub/internal/introspect {sub} → aktif? hubRole?
      (aktif=false atau hubRole=null ⇒ HUB menutup SEMUA sesi HUB identitas itu)
   7. SANSS logout / nonaktifkan user / cabut peran HUB_ACCESS ⇒
      POST {HUB_INTERNAL_URL}/api/sso/revoke {sub,reason} — HUB menutup
      SEMUA sesinya untuk identitas itu seketika; kalau panggilan ini gagal,
      langkah 6 (introspeksi ≤60 detik) tetap menutupnya, hanya lebih lambat.
```

Kenapa form POST dan bukan redirect dengan `?code=`: kode di URL bocor ke log
nginx, riwayat browser, dan header Referer — sama alasannya `stateHash` hanya
lewat query SEKALI (dari HUB ke halaman peluncuran) dan tidak pernah muncul
lagi di URL akhir manapun sesudahnya. Kenapa handoff dan bukan berbagi
cookie/JWT: token web SANSS ada di `localStorage`, tidak bisa dibawa lintas
origin, dan D-200 melarang berbagi JWT secret. Kenapa `state` dan bukan cuma
mengandalkan kode sekali-pakai: kode sudah mencegah replay MITM di jalur
callback, tapi `state` adalah yang mengikat callback itu ke SESI BROWSER yang
memulainya (HttpOnly, tidak bisa dibaca/disuntik dari halaman lain) — pagar
terhadap login-CSRF, bukan terhadap pencurian kode.

## Same-domain embedding (Okt 2026)

Keputusan Owner: HUB tidak lagi berjalan di origin terpisah — HUB mount di
`{SANSS origin}/workspace` lewat `basePath` Next.js (`next.config.ts`) +
reverse proxy nginx, satu origin publik untuk keduanya (SANSS di `/`, HUB di
`/workspace`). Ini **menggeser bentuk nilai** `HUB_BASE_URL`/`HUB_INTERNAL_URL`
(sekarang origin + path dasar, bukan origin polos — lihat tabel di bawah),
tapi **tidak mengubah kontrak SSO itu sendiri** sama sekali: handoff, state,
exchange, introspect, revoke, dan summary (lihat di bawah) semuanya tetap
persis seperti didokumentasikan di sini, hanya alamat dasarnya yang kini
punya path.

Tiga jebakan nyata yang ditemukan dan diperbaiki saat memasang ini (dicatat
di sini supaya tidak terulang kalau topologi ini pernah disentuh lagi):

1. **nginx exact-match WAJIB ada untuk `/workspace` tanpa garis miring,
   SEBELUM blok prefix `/workspace/`** — pola prefix bergaris-miring-akhir
   membuat nginx sendiri 301 `/workspace` → `/workspace/`, sementara basePath
   Next.js (bawaan `trailingSlash:false`) 308 ke arah SEBALIKNYA —
   `ERR_TOO_MANY_REDIRECTS` tanpa blok exact-match ini:
   ```nginx
   location = /workspace { proxy_pass http://host.docker.internal:<HUB_PORT>; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-Host $http_host; proxy_set_header X-Real-IP $remote_addr; }
   location /workspace/  { proxy_pass http://host.docker.internal:<HUB_PORT>; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-Host $http_host; proxy_set_header X-Real-IP $remote_addr; }
   ```
2. **Auth.js (HUB) sendiri TIDAK diberi `basePath`** — hanya `next.config.ts`
   yang punya `basePath: "/workspace"`. Next.js sudah memotong `/workspace`
   dari request sebelum Route Handler mana pun (termasuk `[...nextauth]`)
   melihatnya; menyetel `basePath` Auth.js juga membuat setiap aksinya
   (`providers`, `session`, `signin`) 400 karena dua lapis basePath menumpuk.
   `AUTH_URL`/`NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL` (HUB) tetap **origin
   polos**, TANPA `/workspace` — threading path ke situ membuat Auth.js
   mengira itu basePath-nya sendiri, bug yang sama lewat jalur lain.
3. **Cookie sesi HUB diganti nama** (`sanohub.session-token` /
   `__Secure-sanohub.session-token`, bukan default Auth.js
   `authjs.session-token`) supaya tidak bentrok dengan cookie SANSS sendiri
   di satu origin yang sama — `cookies.sessionToken` di `NextAuth()`
   mengurusnya untuk `auth()`, TAPI kode lain yang membaca cookie session
   secara manual (HUB: `server/auth.ts#resolveUserId`, untuk menemukan
   `externalIdentityId` dan memutuskan perlu-tidaknya memanggil
   `introspectGate`) harus ikut disinkronkan — lupa menyinkronkannya adalah
   regresi keamanan NYATA yang pernah terjadi: gerbang introspeksi diam-diam
   TIDAK PERNAH terpanggil untuk sesi SSO manapun (kill switch berhenti
   menutup sesi aktif), lolos dari ketiga fast-suite HUB, hanya tertangkap
   rehearsal browser sungguhan (lihat commit `ced11b8`, repo HUB).

Standalone build Next.js (HUB) juga butuh `.next/static`/`public` disalin
manual ke `.next/standalone` — langkah resmi Next.js yang mudah terlewat;
tanpa itu halaman render tapi TIDAK interaktif (chunk JS 404 diam-diam, klik
tidak berbuat apa-apa). Otomatis lewat `postbuild` (`npm run build` HUB,
`scripts/copy-standalone-assets.mjs`) sejak commit `5a01b85` — tidak perlu
langkah manual lagi.

## Konfigurasi (env backend)

| Variabel | Arti |
|---|---|
| `HUB_SSO_ENABLED` | **Persis `"true"`** untuk menyalakan. Selain itu (kosong, `1`, `TRUE`, …) = mati → `/api/hub/*` menjawab **404**, tanpa tulis DB dan tanpa audit; kartu portal tidak pernah tampil. |
| `HUB_BASE_URL` | Origin HUB, **atau origin + path dasar sederhana** sejak same-domain embedding (Okt 2026) — mis. `https://app.sanomatrassehat.com/workspace`. `https` (http hanya untuk localhost), tanpa query/fragment/kredensial; path (kalau ada) hanya segmen alfanumerik sederhana (`^(/[A-Za-z0-9_-]+)+$`), bukan path bebas — sengaja ketat, bukan pelonggaran open-redirect. **Satu-satunya sumber** alamat tujuan (dan alamat kartu portal) — tidak pernah dari `Host`, `Origin`, atau body. |
| `HUB_INTERNAL_URL` (tahap 4) | Alamat **PRIVAT** HUB (loopback/RFC1918/link-local/ULA/`*.localhost`/`host.docker.internal`/nama satu-label), **origin + path dasar yang sama** kalau HUB di-mount dengan basePath — dipakai SANSS memanggil `POST {HUB_INTERNAL_URL}/api/sso/revoke` dan `POST {HUB_INTERNAL_URL}/api/sso/summary` (lihat di bawah). Domain/IP publik **ditolak** (panggilan ini server-ke-server, arahnya terbalik dari exchange/introspect/revoke di atas). |
| `HUB_SERVICE_TOKEN` | Rahasia server-ke-server, ≥ 32 karakter, **tidak boleh sama dengan `JWT_SECRET`**. Dipakai KEDUA ARAH — HUB→SANSS (exchange/introspect/revoke) DAN SANSS→HUB (`/api/sso/revoke`) — satu rahasia bersama. |

Enabled tetapi konfigurasi cacat (termasuk `HUB_INTERNAL_URL` hilang/publik) ⇒
**503 `HUB_SSO_MISCONFIGURED`** pada `/api/hub/*`, dan kartu portal tetap
tersembunyi (`hubPortalEntry`/`portalsWithHub` memakai `ready` yang sama) —
tidak jalan setengah benar; masalahnya dicatat sekali di log server, tanpa
nilai rahasia.

## Permission dan peran

`HUB_ACCESS` (`hub:access`) dan `HUB_ADMIN` (`hub:admin`) di
`constants/permissions.js`. **Default deny**; pemetaan awal hanya `ADMIN` dan
`OWNER` (`OWNER` mewarisi `ADMIN_PERMS`). Peran di HUB diturunkan dari
permission (`hubRoleFor`), bukan dari nama role:

| Kondisi | `hubRole` |
|---|---|
| punya role `OWNER` | `OWNER` |
| punya `HUB_ADMIN` | `ADMIN` |
| punya `HUB_ACCESS` saja | `MEMBER` |
| lainnya | `null` — tanpa akses |

Peran, nama, dan `active` **selalu dibaca ulang dari DB** (tabel `user_roles`
seperti `loadRoles`, D-010) pada tiap handoff, exchange, dan introspect. Klaim
JWT hanya dipakai untuk tahu *siapa*, tidak pernah *boleh apa*.

Menambah role lain di kemudian hari = menambah `P.HUB_ACCESS` (dan/atau
`P.HUB_ADMIN`) pada role itu di `ROLE_PERMISSIONS` **beserta tes**; jangan cek
role ad-hoc di route.

### `HUB_LEADER_MONITOR` — Pantauan Leader, Main Hub (Okt 2026)

Permission **terpisah**, default-deny, dipetakan **HANYA ke `OWNER`** (bukan
`ADMIN_PERMS` — menambah role lain tidak diam-diam membukanya untuk ADMIN
juga). Menggerbangi `GET /api/hub/summary/leaders` (lihat Endpoint) — Owner
ingin memantau progres leader lintas divisi dari Main Hub, bukan setiap
pemegang HUB_ADMIN otomatis boleh. Melebarkan ini ke role lain = satu baris
di `ROLE_PERMISSIONS` **beserta tes** (lihat `tests/hubSummary.test.js`),
BUKAN pelonggaran default `ADMIN_PERMS`.

"Leader" yang dipantau memakai penandaan **yang sudah ada dan terbukti**
(`UserDivision.isLeader`, C2.1 — dipakai juga oleh Laporan Divisi RINCI),
**bukan** peran/role baru dan **bukan** "semua user dianggap leader". Admin/
Owner menetapkannya eksplisit lewat Pengguna & Divisi; tanpa penetapan,
Pantauan Leader kosong jujur ("Belum ada leader divisi yang ditetapkan"),
bukan daftar kosong yang terlihat seperti galat.

`HUB_ACCESS` tetap TIDAK diberikan otomatis ke seorang leader hanya karena
`isLeader=true` — dua hal berbeda sama sekali (satu "siapa dipantau Owner",
satu lagi "siapa boleh masuk HUB"). Seorang leader tanpa `HUB_ACCESS` tetap
muncul di Pantauan Leader, berlabel jujur **"Belum terhubung"** (bukan data
karangan), karena HUB tidak pernah punya identitasnya sama sekali.

### Main Hub — onboarding leader (`HUB_MEMBER`, Okt 2026)

Keputusan Owner (revisi kedua): leader boleh memakai Main Hub (Tugas Saya/
Hasil Meeting) walau hanya punya SATU portal operasional, TANPA diberi akses
ADMIN — lewat role BARU, `HUB_MEMBER`, satu-satunya permission di
dalamnya `P.HUB_ACCESS` (lihat `constants/permissions.js`). `hubRoleFor`
memetakannya ke peran HUB **"MEMBER"** (lihat tabel di atas: "punya
HUB_ACCESS saja → MEMBER"), BUKAN "ADMIN".

**Cara memberi akses seorang leader** (Admin/Owner, lewat Pengguna & Peran —
`POST /users/:id/roles { role: "HUB_MEMBER" }`, sama pola dengan
`LEADER_DRIVER`/`PRODUCTION_DOCUMENTER`): tambahkan role `HUB_MEMBER` ke
akun orang itu, SELAIN role operasionalnya yang sudah ada (SALES,
PRODUCTION_LEAD, dst — role aditif, D-010). Dua langkah **sengaja terpisah**
dan TIDAK ADA jalan pintas yang menyatukannya:

1. **`HUB_MEMBER`** (role) → boleh masuk HUB sama sekali, Main Hub
   menampilkan "Tugas Saya"/"Hasil Meeting" miliknya.
2. **`UserDivision.isLeader=true`** (C2.1, lewat Pengguna & Divisi) → MUNCUL
   di Pantauan Leader Owner, kalau Owner juga punya `HUB_LEADER_MONITOR`.

Seseorang bisa punya SALAH SATU tanpa yang lain (biasa dan sah): staf dengan
`HUB_MEMBER` tapi bukan `isLeader` punya Main Hub pribadi, TIDAK pernah
tampil di Pantauan Leader siapa pun. Leader dengan `isLeader=true` tapi
TANPA `HUB_MEMBER` tampil "Belum terhubung" di Pantauan Leader Owner —
belum punya akses HUB sama sekali. **Tidak ada pemberian otomatis**: jangan
beri `HUB_MEMBER` ke seluruh role SALES atau ke seluruh baris
`isLeader=true` sekaligus — berikan satu per satu, ke orang yang memang
perlu.

**Routing (kenapa tidak perlu ubah logika auto-skip Portal.jsx):** landing
page SANSS melompati layar pemilih workspace untuk akun yang cuma punya
SATU portal (PRD §4) — sebelum `HUB_MEMBER` ada, seorang leader dengan satu
role operasional dan tanpa HUB_ACCESS APA PUN benar-benar hanya punya satu
portal, jadi tidak pernah melihat Main Hub. Begitu `HUB_MEMBER` diberikan,
`portalsWithHub(user)` (dipakai `/auth/me`) MENAMBAHKAN kartu "Task &
Meeting" ke daftar portal orang itu — jadi daftarnya otomatis berisi DUA
entri (portal operasional + hub), auto-skip (yang mengecek `portals.length
=== 1`) tidak pernah terpicu, dan Portal.jsx (beserta widget Main Hub-nya)
tampil seperti biasa. Tidak ada perubahan kode routing yang diperlukan —
diverifikasi langsung lewat rehearsal (leader satu-portal mendarat di
`/portal`, non-leader satu-portal tetap auto-skip seperti sebelumnya).

**SUPERSEDED (10 Nov 2026) — lihat repo SANO-HUB, `docs/SSO.md` "Access
control" + `src/server/policy/access.ts`:** paragraf di bawah ini dulu
menyatakan keputusan "dokumentasikan batas ini, jangan bangun sekarang"
sebagai final. Itu TIDAK LAGI benar — HUB sekarang punya kontrol akses
per-proyek terpusat (OWNER/ADMIN: akses penuh; MEMBER: hanya proyek yang
`ProjectMember`-nya; GUEST: baca-saja pada proyek yang diizinkan; task
mengikuti akses proyek, bukan assignment; meeting dibaca organizer+attendee,
diubah organizer/OWNER/ADMIN saja), diterapkan lewat
`HUB_RESOURCE_ACL_ENABLED` (default OFF — nonaktif berarti perilaku lama di
bawah ini TETAP berlaku apa adanya sampai Owner menyalakannya untuk pilot
tertentu). Dibuktikan lewat `scripts/verify-resource-acl.ts` (53/53 lulus)
dan rehearsal Tahap 5 skenario 14 (dua leader, dua proyek terpisah, deep
link browser nyata). Paragraf asli di bawah tetap benar untuk MENJELASKAN
kenapa `HUB_MEMBER` sendirian (tanpa flag ini) tidak pernah cukup — hanya
klaim "ini final, tidak akan dibangun" yang sekarang salah.

**Batas yang JUJUR, bukan terlewat (sebelum kebijakan di atas):** `HUB_MEMBER`
membatasi apa yang TERLIHAT DARI MAIN HUB SANSS (ringkasan milik sendiri
saja, tanpa Pantauan Leader). Begitu seorang `HUB_MEMBER` benar-benar MASUK
ke HUB itu sendiri (klik kartu "Task & Meeting", bukan cuma lihat Main
Hub), ia tunduk pada model otorisasi HUB SENDIRI — tanpa `HUB_RESOURCE_ACL_ENABLED=true`,
itu masih **workspace flat, tanpa kontrol akses per-task/per-project apa
pun**: siapa pun anggota workspace (MEMBER/ADMIN/OWNER) bisa melihat DAN
MENGUBAH task/meeting siapa pun di workspace yang sama. Ini desain ASLI HUB
sejak sebelum Main Hub ada — `HUB_MEMBER` TIDAK mengubahnya; mengubahnya
butuh flag terpisah di atas, dinyalakan sadar oleh Owner, bukan efek
samping dari `HUB_MEMBER`.

## Endpoint

Semua respons `Cache-Control: no-store`.

### `POST /api/hub/handoff` — pengguna login
`Authorization: Bearer <JWT>`; body `{ "next"?: "/meetings", "stateHash": "<sha256 hex>" }`.
`stateHash` **wajib** sejak tahap 4 — SHA-256(state) yang HUB buat di
`GET /sso/start` dan kirim ke `/hub/launch` lewat query string; diteruskan
apa adanya, dikembalikan lagi utuh oleh `/internal/exchange`.

| Hasil | Kondisi |
|---|---|
| `200 {method, postUrl, fields:{code}, expiresInSec:60}` | berizin; kode 256-bit, TTL 60 dtk |
| `400 DESTINATION_NOT_ALLOWED` | `next` tidak lolos allow-list |
| `400 INVALID_STATE` | `stateHash` hilang atau bukan SHA-256 hex 64 karakter kecil |
| `401` | tanpa/rusak token (token mobile juga ditolak pagar jalur mobile) |
| `403 HUB_ACCESS_DENIED` | pengguna tak dikenal, **nonaktif**, atau tanpa `HUB_ACCESS` (satu pesan; rinciannya di audit) |
| `429` | > 10 permintaan/menit/pengguna |

Urutan pengecekan: pengguna/peran → tujuan → `stateHash` — pemanggil tanpa izin
tidak pernah melihat apa pun soal state. Menerbitkan kode baru **mencabut
kode lama yang belum terpakai** milik pengguna itu.

### `POST /api/hub/internal/exchange` — HUB
Header `X-Hub-Service-Token`; body `{ "code": "<43 karakter>" }`.

* `200 {sub, name, email, roles, hubRole, active:true, destination, stateHash}` — `stateHash` dikembalikan **apa adanya** (SHA-256 dari `state` HUB); SANSS hanya menyimpan/meneruskannya, HUB sendiri yang membandingkannya dengan cookie-nya.
* `401 INVALID_CODE` — tak dikenal, cacat, **sudah terpakai (replay)**, **kedaluwarsa**, atau dicabut (satu jawaban; bedanya hanya di audit)
* `403 ACCESS_DENIED` — kode sah tetapi pemiliknya nonaktif/tanpa izin **saat ditukar**; kode tetap hangus

Klaim kode **atomik**: `UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`
lalu pemeriksaan pengguna, dalam satu transaksi. Dua penukar serentak ⇒ tepat satu menang.

### `POST /api/hub/internal/introspect` — HUB
Body `{ "sub": "<userId>" }` → `200 {sub, active, hubRole, roles[, name, email]}`.
Pengguna tak dikenal / nonaktif / tanpa izin ⇒ `active:false, hubRole:null, roles:[]`
(tanpa nama/email; tidak membocorkan keberadaan akun). `400 SUB_REQUIRED` untuk `sub` cacat.
Dipanggil HUB paling sering tiap 60 detik lewat gerbang introspeksi terpusatnya
sendiri (`introspectGate`, satu tempat untuk page/Server Action/API HUB) —
kontrak endpoint ini sendiri tidak berubah dari tahap 2/3.

### `POST /api/hub/internal/revoke` — HUB / operasi
Body `{ "userId": "…", "reason": "logout|deactivated|role_changed|admin|other" }` →
`200 {revoked: n}`: mencabut kode **belum terpakai** milik pengguna itu. Idempoten.
Alasan lain dinormalkan menjadi `other`.

### `POST /api/sso/revoke` — SANSS → HUB (arah terbalik, tahap 4)
Bukan endpoint SANSS — ini yang SANSS **panggil** ke `{HUB_INTERNAL_URL}/api/sso/revoke`
(`x-hub-service-token`) dari `notifyHubRevoke()`, dipicu oleh `POST /api/auth/logout`,
`PATCH /users/:id` (`active:false` atau `role` berubah), dan
`DELETE /users/:id/roles/:role` — **hanya kalau perubahan itu sungguh
menghilangkan `HUB_ACCESS`, dicek ulang dari DB** (`syncHubAccessOnUserChange`).
Best-effort dan **tidak pernah** membuat pemanggilnya (logout/PATCH/DELETE)
gagal — kalau HUB tidak terjangkau atau menolak, introspeksi berkala HUB
(≤60 detik) tetap menutup sesinya, hanya lebih lambat. Sukses/gagal diaudit
sebagai `HUB_REVOKE_NOTIFIED`/`HUB_REVOKE_NOTIFY_FAILED`.

### `GET /api/hub/summary/me` — Main Hub, "Tugas Saya"/"Hasil Meeting" (Okt 2026)
`Authorization: Bearer <JWT>`. Dipanggil browser (bukan server-ke-server) —
backend yang memanggil HUB server-ke-server di baliknya; token layanan
**tidak pernah** sampai ke respons ini. Status aktif + `hubRole` dibaca ulang
dari DB (sama seperti `/api/hub/handoff`), BUKAN dari klaim JWT.

| Hasil | Kondisi |
|---|---|
| `200 {connected, summary:{tasks,meetings}}` | berizin; `connected:false` kalau belum pernah membuka HUB sama sekali (identitas belum ada di sisi HUB) — `summary` tetap bentuk kosong yang valid, bukan `null` |
| `403 HUB_SUMMARY_NO_PERMISSION` | tanpa `HUB_ACCESS` |
| `403 HUB_SUMMARY_USER_INACTIVE` | nonaktif |
| `503 HUB_SUMMARY_UNAVAILABLE` | SSO mati/tidak dikonfigurasi, atau HUB tidak terjangkau |

### `GET /api/hub/summary/leaders?division=` — Main Hub, "Pantauan Leader" (Okt 2026)
Sama pola di atas, digerbangi `HUB_LEADER_MONITOR` (lihat "Permission dan
peran"). `?division=` **hanya mempersempit** set leader yang sudah dihitung
dari DB (`UserDivision.isLeader=true`) — nilai di luar enum
`DivisiKeanggotaan` diabaikan bersih (jadi "tanpa filter", bukan galat/leak).
`200 {leaders:[{userId,name,divisions,connected,summary}]}`; `403`/`503`
sama kode dengan `/summary/me` di atas.

### `POST /api/sso/summary` — SANSS → HUB (Okt 2026, server-ke-server)
Bukan endpoint SANSS — ini yang SANSS **panggil** ke
`{HUB_INTERNAL_URL}/api/sso/summary` (`x-hub-service-token`), persis pola
`/api/sso/revoke` di bawah, dari dua route di atas. Body
`{ "subs": ["<userId>", …] }` (1–50 id). HUB me-resolve tiap `sub` ke
identitas AKTIF di workspace resminya; `sub` yang tidak cocok **diam-diam
dihilangkan** dari `results` (bukan galat) — sama posisi "tidak pernah
membocorkan keberadaan akun" dengan `/internal/introspect`. Endpoint ini
TIDAK memutuskan siapa boleh meminta ringkasan siapa — itu sepenuhnya
tanggung jawab SANSS **sebelum** memanggilnya (lihat `HUB_LEADER_MONITOR` di
atas); ia hanya menjawab "apakah `sub` ini orang nyata di sini".

### `POST /api/auth/logout` — tahap 4
`Authorization: Bearer <JWT>`, tanpa body → **selalu** `200 {ok:true}`. Login
web SANSS sengaja stateless (tidak ada tabel sesi web) — endpoint ini tidak
mencabut JWT pemanggil sendiri (tidak ada yang bisa dicabut di server);
satu-satunya kerjanya adalah mencabut kode handoff yang belum terpakai +
memanggil `/api/sso/revoke` di atas. Tidak digerbangi `HUB_SSO_ENABLED` —
aman dipanggil dari frontend tanpa syarat (no-op kalau SSO mati).

### Autentikasi server-ke-server
* Header `X-Hub-Service-Token`, dibandingkan waktu-konstan (`timingSafeEqual` atas SHA-256), arah manapun (HUB→SANSS atau SANSS→HUB).
* **Hanya internal**: soket dari alamat loopback/privat **dan** tanpa header proxy
  (`X-Forwarded-*`, `X-Real-IP`, `Forwarded`, `Via`). Permintaan lewat nginx ⇒ `404`.
  **HUB harus memanggil backend langsung** (mis. `http://127.0.0.1:4000`), bukan URL publik.
* JWT pengguna **tidak** berlaku sebagai token layanan, dan sebaliknya.
* Batas 120 permintaan/menit/IP sebelum autentikasi, supaya penolakan (yang diaudit) tidak bisa membanjiri tabel audit.
* **WAJIB** di nginx produksi (bukan sekadar saran — lapisan jaringan nyata,
  token layanan tetap yang membawa beban keamanan sesungguhnya):
  ```nginx
  location /api/hub/internal/ { return 404; }
  ```
  pada `server` publik SANSS, sebelum blok `location /api/ { proxy_pass … }`
  umum — persis simetris dengan blok di sisi HUB (`DEPLOYMENT.md` §6b, repo
  HUB), yang sejak same-domain embedding (Okt 2026) hidup di SATU `server`
  publik yang sama dengan SANSS (bukan dua `server` terpisah lagi):
  ```nginx
  location /workspace/api/sso/revoke  { return 404; }
  location /workspace/api/sso/summary { return 404; }
  ```

## Allow-list tujuan

Kecocokan **persis**, tanpa query/fragment: `/`, `/dashboard`, `/my-tasks`,
`/inbox`, `/goals`, `/dashboards`, `/meetings`, `/meetings/action-item-saya`,
`/meetings/<id>`, `/projects/<id>/(board|list|calendar|gantt|docs|forms|sprints)`
dengan `<id>` = `[A-Za-z0-9_-]{8,64}`. Divalidasi saat **dibuat dan saat ditukar**.
Klien tidak pernah menentukan alamat redirect; HUB mendarat di `destination`
yang dikembalikan `exchange`.

**Satu pengecualian aditif** (Okt 2026, Main Hub): `/projects/<id>/board?task=<id>`
— pola TERPISAH, bukan pelonggaran `board` di atas ke "query apa saja boleh".
Dipakai tautan "lihat detail" di "Tugas Saya"/"Pantauan Leader" supaya klik
mendarat langsung di panel task tertentu, bukan cuma board-nya. Setiap bentuk
lain (view selain board, param tambahan, nama param beda huruf besar/kecil,
id cacat, fragment) tetap jatuh ke default — lihat uji
`tujuan: tautan task Main Hub` di kedua sisi (SANSS `hubSso.test.js`, HUB
`verify-sso.ts`).

## Kartu portal "Task & Meeting"

`hubPortalEntry(user)`/`portalsWithHub(user)` (dipakai `/auth/login` dan
`/auth/me`, di `routes/auth.js`) menambahkan kartu **hanya** kalau (a)
`HUB_SSO_ENABLED=true` **dan** konfigurasi lengkap (`ready`), **dan** (b)
pengguna itu punya `HUB_ACCESS` (ADMIN/OWNER). Aditif murni — daftar
`portalsFor(user)` yang sudah ada tidak disentuh; SALES tidak pernah melihat
apa pun soal HUB di respons login, flag menyala atau tidak. `path` kartu
adalah **URL lengkap** ke `{HUB_BASE_URL}/sso/start` (bukan rute SPA relatif)
— frontend (`Portal.jsx`) mendeteksi ini lewat awalan `http` dan melakukan
navigasi PENUH (`window.location`), bukan `<iframe>` atau React Router,
karena masuk wajib dimulai dari situ (HUB membuat `state` di sana).

## Data dan audit

Tabel `hub_handoffs` (migrasi aditif `20261227090000_hub_handoff_sso`,
gabungan tahap 3+4 — forward-port ke `main`, lihat catatan identitas migrasi
baru di commit yang menambahkannya): `code_hash` (SHA-256, unik), `user_id`
(FK `User`, cascade), `destination`, `state_hash` (nullable — SHA-256 hex
dari `state` HUB, tahap 4), `expires_at`, `used_at`, `revoked_at`,
`created_at`. **Kode mentah dan `state` asli tidak pernah disimpan atau
dilog** (hanya hash-nya, dan itu pun bukan rahasia yang perlu disembunyikan
dari SANSS — perbandingannya terjadi di sisi HUB). Baris lebih tua dari 24
jam dibersihkan saat penerbitan berikutnya.

Audit ke `activity_events` (`entity_type = hub_sso`), untuk sukses **dan**
penolakan, tanpa kode mentah, `state`, JWT, maupun token layanan:

`HUB_HANDOFF_ISSUED`, `HUB_HANDOFF_DENIED` (`reason` tambahan tahap 4:
`invalid_state`), `HUB_HANDOFF_EXCHANGED`,
`HUB_HANDOFF_REJECTED` (`reason`: `replay`, `expired`, `revoked`, `unknown_code`,
`malformed`, `user_inactive`, `no_permission`, `destination_not_allowed`),
`HUB_INTROSPECTED` (disampling: paling banyak sekali per pengguna per 5 menit),
`HUB_INTROSPECT_DENIED` (selalu), `HUB_HANDOFF_REVOKED`, `HUB_SERVICE_DENIED`
(`not_internal`, `token_missing`, `token_invalid`), dan (tahap 4, panggilan
KELUAR SANSS→HUB) `HUB_REVOKE_NOTIFIED` / `HUB_REVOKE_NOTIFY_FAILED`.

## Yang sengaja belum ada

Sisi HUB (`/sso/callback`, `ExternalIdentity`, sesi, gerbang introspeksi
terpusat) hidup di repo SANO-HUB, bukan di sini — kontraknya didokumentasikan
di `docs/SSO.md` repo itu. Di sisi SANSS ini, tahap 4 sudah menutup semua
yang sebelumnya tertulis "belum ada": kartu portal, `/api/auth/logout`, dan
kait nonaktifkan-pengguna/cabut-peran yang memanggil revoke. `/auth/login`,
`portals` (non-hub), dan `capabilities` tetap tidak berubah bentuknya
(dijaga tes) — kartu hub murni aditif di akhir array `portals`.

## Rollout

1. Deploy dengan `HUB_SSO_ENABLED=false` (perilaku produksi identik; hanya tabel/kolom baru yang muncul; `/api/auth/logout` sudah ada tapi no-op terhadap HUB).
2. Jalankan migrasi (`prisma migrate deploy` — additive murni, aman dijalankan kapan saja, termasuk sebelum flag dinyalakan).
3. **Konfigurasi nginx same-domain** (lihat "Same-domain embedding" di atas) — WAJIB SEBELUM langkah berikutnya:
   - `location /api/hub/internal/ { return 404; }`
   - `location /workspace/api/sso/revoke { return 404; }`
   - `location /workspace/api/sso/summary { return 404; }`
   - `location = /workspace { proxy_pass …HUB…; }` **SEBELUM** `location /workspace/ { proxy_pass …HUB…; }` (exact-match dulu, cegah loop redirect — lihat jebakan #1 di atas)
4. Isi `HUB_BASE_URL` + `HUB_INTERNAL_URL` — origin + `/workspace` kalau HUB di-mount same-domain (mis. `https://app.sanomatrassehat.com/workspace` / `http://127.0.0.1:3000/workspace`) — + `HUB_SERVICE_TOKEN` (sama persis dengan `SANSS_SERVICE_TOKEN`/token layanan di sisi HUB).
5. Smoke test dengan flag **tetap mati** dulu: `/api/hub/*` masih 404, `/api/auth/login` & `/api/auth/logout` masih berfungsi normal, kartu portal masih tersembunyi, `/workspace` HUB sendiri 404 (bukan loop redirect).
6. Set `HUB_SSO_ENABLED=true` **hanya setelah** sisi HUB (`SANSS_SSO_ENABLED`) juga siap dinyalakan — salah satu mati saja sudah membuat alurnya menolak bersih di sisi manapun yang mati.
7. **Main Hub (Tugas Saya/Pantauan Leader)** ikut flag yang sama, tanpa flag terpisah — begitu `HUB_SSO_ENABLED`+`SANSS_SSO_ENABLED` menyala, `/api/hub/summary/*` otomatis aktif untuk siapa pun yang sudah punya `HUB_ACCESS` (ringkasan milik sendiri). "Pantauan Leader" TETAP kosong untuk semua orang kecuali Owner secara eksplisit diberi `HUB_LEADER_MONITOR` di `ROLE_PERMISSIONS` (default saat ini: Owner-only, bukan per-user toggle) — dan tetap kosong-jujur sampai Admin/Owner menetapkan `UserDivision.isLeader=true` untuk leader yang dimaksud lewat Pengguna & Divisi; tidak ada data yang tampil tanpa penetapan eksplisit itu.
7a. **Migrasi `HUB_MEMBER`** (enum `Role`, aditif murni — lihat "Main Hub — onboarding leader" di atas) jalan sebagai bagian dari langkah 2, kapan saja, tanpa dampak sampai role itu benar-benar diberikan ke seseorang. Tidak ada pengguna yang mendapat `HUB_MEMBER` otomatis — Admin/Owner memberikannya satu per satu lewat Pengguna & Peran, kapan pun siap (tidak terikat urutan rollout ini).
8. **Rollback:** `HUB_SSO_ENABLED=false` (semua endpoint `/api/hub/*`, termasuk `/api/hub/summary/*`, 404 seketika; kartu portal dan widget Main Hub langsung hilang dari respons login/`/me`/Portal.jsx berikutnya). Tabel/kolom
   aditif dan aman ditinggal; kode yang belum terpakai kedaluwarsa sendiri dalam 60 detik; `/api/auth/logout` tetap 200 (berhenti memanggil HUB).

## Tes

* Unit murni: `node --test tests/hubSso.test.js` (aturan konfigurasi, `isPrivateHost`, bentuk kode/state, pemetaan peran — tanpa DB/Express).
* Unit murni (Main Hub): `node --test tests/hubSummary.test.js` — `HUB_LEADER_MONITOR` HANYA dipegang OWNER (dan bukan role lain mana pun, termasuk ADMIN), `normalizeDivisionFilter` (narrow-only, tidak pernah expand).
* Integrasi (Postgres sekali-pakai, migrasi dari nol, HTTP sungguhan lewat router ASLI,
  termasuk HUB PALSU (server HTTP nyata di localhost) untuk membuktikan
  `notifyHubRevoke` benar-benar melakukan panggilan jaringan, bukan mock):
  `npm run test:integration:clean -- tests/integration/hubSso.integration.test.js`
* Sisi HUB: `npm run verify:sso` / `npm run verify:prod-boot` (repo SANO-HUB)
  — termasuk `POST /api/sso/summary` end-to-end (token/private-only/rate-limit,
  data task/meeting nyata) dan regresi permanen gerbang introspeksi (lihat
  jebakan #3 di "Same-domain embedding" di atas).
* Rehearsal staging penuh, browser sungguhan, dua origin disatukan lewat nginx
  TLS lokal (`docs/sso-stage5-rehearsal/`, repo ini): `node rehearsal.mjs` —
  mencakup dua leader berbeda bentuk (satu terhubung ke HUB, satu belum)
  + Owner: scope sendiri, Pantauan Leader, manipulasi `?division=`/akses
  langsung tanpa izin, tautan task mendarat tepat tanpa login ulang,
  pencabutan akses, dan rantai penuh meeting→keputusan→action item→task→
  ringkasan Main Hub setelah refresh.
