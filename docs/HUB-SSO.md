# SSO Task & Meeting — kontrak sisi SANSS (D-200)

**Status:** tahap 4 (state/nonce, siklus akses, kartu portal, revoke keluar)
selesai di branch `feat/task-meeting-sso`, **mati secara default**
(`HUB_SSO_ENABLED=false`). Kedua flag (SANSS `HUB_SSO_ENABLED` dan HUB
`SANSS_SSO_ENABLED`) harus menyala berbarengan sebelum kartu portal atau
alur mana pun terlihat pengguna — salah satu mati berarti 404/`ready:false`
bersih, **tanpa** jatuh ke Google login, dev bypass, atau auto-join.

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

## Konfigurasi (env backend)

| Variabel | Arti |
|---|---|
| `HUB_SSO_ENABLED` | **Persis `"true"`** untuk menyalakan. Selain itu (kosong, `1`, `TRUE`, …) = mati → `/api/hub/*` menjawab **404**, tanpa tulis DB dan tanpa audit; kartu portal tidak pernah tampil. |
| `HUB_BASE_URL` | Origin HUB. `https` (http hanya untuk localhost), tanpa path/query/fragment/kredensial. **Satu-satunya sumber** alamat tujuan (dan alamat kartu portal) — tidak pernah dari `Host`, `Origin`, atau body. |
| `HUB_INTERNAL_URL` (tahap 4) | Alamat **PRIVAT** HUB (loopback/RFC1918/link-local/ULA/`*.localhost`/`host.docker.internal`/nama satu-label) — dipakai SANSS memanggil `POST {HUB_INTERNAL_URL}/api/sso/revoke` saat logout/nonaktifkan-user/cabut-peran. Domain/IP publik **ditolak** (panggilan ini server-ke-server, arahnya terbalik dari exchange/introspect/revoke di atas). |
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
  umum — persis simetris dengan `location /api/sso/revoke { return 404; }`
  yang didokumentasikan di sisi HUB (`DEPLOYMENT.md` §6b).

## Allow-list tujuan

Kecocokan **persis**, tanpa query/fragment: `/`, `/dashboard`, `/my-tasks`,
`/inbox`, `/goals`, `/dashboards`, `/meetings`, `/meetings/action-item-saya`,
`/meetings/<id>`, `/projects/<id>/(board|list|calendar|gantt|docs|forms|sprints)`
dengan `<id>` = `[A-Za-z0-9_-]{8,64}`. Divalidasi saat **dibuat dan saat ditukar**.
Klien tidak pernah menentukan alamat redirect; HUB mendarat di `destination`
yang dikembalikan `exchange`.

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
3. **WAJIB** blokir `location /api/hub/internal/ { return 404; }` di nginx publik SEBELUM langkah berikutnya (lihat "Autentikasi server-ke-server" di atas).
4. Isi `HUB_BASE_URL` + `HUB_INTERNAL_URL` (alamat privat HUB, mis. `http://127.0.0.1:3000` kalau HUB berjalan di host yang sama) + `HUB_SERVICE_TOKEN` (sama persis dengan `SANSS_SERVICE_TOKEN`/token layanan di sisi HUB).
5. Smoke test dengan flag **tetap mati** dulu: `/api/hub/*` masih 404, `/api/auth/login` & `/api/auth/logout` masih berfungsi normal, kartu portal masih tersembunyi.
6. Set `HUB_SSO_ENABLED=true` **hanya setelah** sisi HUB (`SANSS_SSO_ENABLED`) juga siap dinyalakan — salah satu mati saja sudah membuat alurnya menolak bersih di sisi manapun yang mati.
7. **Rollback:** `HUB_SSO_ENABLED=false` (semua endpoint `/api/hub/*` 404 seketika, kartu portal langsung hilang dari respons login/`/me` berikutnya). Tabel/kolom
   aditif dan aman ditinggal; kode yang belum terpakai kedaluwarsa sendiri dalam 60 detik; `/api/auth/logout` tetap 200 (berhenti memanggil HUB).

## Tes

* Unit murni: `node --test tests/hubSso.test.js` (aturan konfigurasi, `isPrivateHost`, bentuk kode/state, pemetaan peran — tanpa DB/Express).
* Integrasi (Postgres sekali-pakai, migrasi dari nol, HTTP sungguhan lewat router ASLI,
  termasuk HUB PALSU (server HTTP nyata di localhost) untuk membuktikan
  `notifyHubRevoke` benar-benar melakukan panggilan jaringan, bukan mock):
  `npm run test:integration:clean -- tests/integration/hubSso.integration.test.js`
