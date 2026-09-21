# Backend untuk Finance Mobile (S0) — sesi, idempotency, push, foto nota

Dikerjakan 19 September 2026 sebagai prasyarat aplikasi `finance-mobile/` (React Native + Expo).
Semua perubahan **kompatibel mundur untuk web**: tanpa header/klaim baru, perilaku lama persis sama.

## 1. Ringkasan perubahan

| Area | Perubahan | Berlaku untuk web? |
|---|---|---|
| Sesi mobile | Access token 15 mnt (`typ:"mobile"`, `sid`) + refresh token rotasi, bisa dicabut, tidak diperpanjang otomatis | Tidak (jalur terpisah `/api/mobile/auth/*`) |
| Rate limit | Login 5 gagal/15 mnt per email+IP, 30 gagal/15 mnt per IP; refresh 60/mnt/IP; API mobile 120/mnt/pengguna; media sign 60/mnt; unggah nota tetap seperti semula | Login web **ikut** dibatasi (hanya kegagalan yang dihitung) |
| Capabilities | `capabilities` di `GET /api/auth/me` dan di respons login (`user.capabilities`) | Ya (field tambahan, aman) |
| Idempotency-Key | Middleware di 4 router `/api/finance/*` untuk POST/PUT/PATCH/DELETE | Opsional untuk web; **wajib** untuk token mobile (428) |
| Push | Token perangkat (`fcm`/`expo`), servis dispatch, transport FCM HTTP v1 tanpa dependency baru | Tidak |
| Foto nota | `/media/finance-receipts/*` tidak lagi statis publik; Bearer+izin atau URL bertanda-tangan | Ya — web sudah disesuaikan (lihat §6) |

## 2. Endpoint baru

Prefix `/api/mobile` (kecuali disebut). Semua galat: `{ "error": "...", "code": "..." }`.

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| POST | `/auth/login` | — | `{email,password,device:{id,label,appVersion,platform}}` → `{accessToken,refreshToken,expiresIn:900,accessTokenExpiresAt,refreshTokenExpiresAt,session,user,capabilities}`. 403 `NOT_FINANCE_TEAM` bila akun bukan tim Finance |
| POST | `/auth/refresh` | refresh token | `{refreshToken,device?:{appVersion}}` → pasangan baru (token lama tidak berlaku lagi) |
| POST | `/auth/logout` | refresh token **atau** Bearer | Selalu 200; mencabut sesi + menghapus token push perangkat |
| GET | `/auth/sessions` | Bearer | Sesi/perangkat aktif milik sendiri (`current` menandai yang dipakai) |
| DELETE | `/auth/sessions/:id` | Bearer | Keluarkan satu perangkat sendiri |
| POST | `/auth/sessions/revoke-user` | Bearer + `USER_MANAGE` | `{userId}` cabut semua sesi seorang pengguna |
| POST | `/devices` | Bearer (mobile) | `{deviceId,token,provider:"fcm"\|"expo",platform,appVersion}` daftar/ganti token push. `deviceId` harus sama dengan perangkat sesi |
| DELETE | `/devices/:deviceId` | Bearer | Hapus token push perangkat |
| GET | `/config` | — | `{minVersionCode,latestVersionCode,updateUrl,maintenance,fcmConfigured,serverTime}` |
| POST | `/api/finance/media/sign` | Bearer | `{urls:[...]}` → `{signed:{url:{url,thumbUrl,expiresAt}}}` (maks 60) |
| GET | `/api/finance/media/receipts/:file` | Bearer | Alias streaming untuk klien native |
| GET | `/media/finance-receipts/:file` | Bearer **atau** `?exp&sig` | Path lama, kini terlindungi |

### Kode galat penting
`SESSION_REVOKED` · `TOKEN_INVALID` · `REFRESH_INVALID` · `REFRESH_REUSED` · `SESSION_EXPIRED` · `ACCOUNT_INACTIVE` ·
`NOT_FINANCE_TEAM` · `RATE_LIMITED` (429 + `Retry-After`) · `IDEMPOTENCY_KEY_REQUIRED` (428) · `IDEMPOTENCY_KEY_INVALID` (400) ·
`IDEMPOTENCY_KEY_REUSED` (422) · `IDEMPOTENCY_IN_PROGRESS` (409).

## 3. Sesi mobile — aturan

- Access token: JWT dengan `JWT_SECRET` yang sama dan payload web (`id,name,role,roles`) + `typ:"mobile"`, `sid`. Semua `requirePermission` existing bekerja tanpa diubah.
- Refresh token: `smr_<43 char>` acak; di database hanya **SHA-256**-nya. **Rotasi tiap dipakai**; token yang sudah diganti dipakai lagi ⇒ sesi dicabut (`REFRESH_REUSED`). Klien **harus menyimpan token baru sebelum memakainya**.
- Umur: idle 14 hari (bergeser tiap rotasi), absolut 60 hari. Maksimal **2 sesi aktif/pengguna**; login ulang di perangkat yang sama menggantikan sesinya.
- `requireAuth` untuk token mobile: memeriksa sesi di database **setiap request** (revoke & akun nonaktif berlaku seketika), tidak memberi `X-Refreshed-Token`, dan hanya mengizinkan jalur: `/api/finance/*`, `/api/mobile/*`, `/api/auth/me`, `POST /api/armada/payments/:id/verify`, `GET /api/orders/:id/invoice/pdf` (hak akses minimum).
- Role dibaca ulang dari database tiap refresh (perubahan peran berlaku ≤ 15 mnt).
- Menonaktifkan akun (`PATCH /api/users/:id {active:false}`) mencabut semua sesi + token push.
- Batas percobaan disimpan **di memori proses** (satu container). Kalau backend di-scale ke banyak instance, batas menjadi per-instance.
- IP klien: entri **terakhir** `X-Forwarded-For` bila soket berasal dari proxy privat (nginx menambahkannya); header dari sumber publik diabaikan.

## 4. Idempotency-Key

Header `Idempotency-Key: <8–128 karakter [A-Za-z0-9_-:.]>`.

| Situasi | Hasil |
|---|---|
| Kunci baru | Diproses normal; respons 2xx disimpan (24 jam) |
| Kunci sama + isi sama | Respons pertama diputar ulang, header `Idempotent-Replayed: true`, tidak dieksekusi ulang |
| Kunci sama + isi beda | 422 `IDEMPOTENCY_KEY_REUSED` |
| Kunci sama, masih diproses | 409 `IDEMPOTENCY_IN_PROGRESS` (+`Retry-After: 2`) |
| Respons non-2xx | Kunci dilepas, boleh dikirim ulang |
| Token mobile tanpa header pada command | 428 `IDEMPOTENCY_KEY_REQUIRED` |

Dikecualikan: `POST /api/finance/receipts/upload` (multipart, idempoten lewat nama = hash isi) dan `POST /api/finance/media/sign`.
Kunci dilingkupi **per pengguna**. Tabel `api_idempotency_keys`; baris > 48 jam dibersihkan otomatis.
Klien: buat **satu UUID per niat pengguna** (saat form dibuka), pakai ulang saat mencoba lagi setelah timeout, buat baru untuk perintah baru.

## 5. Push (FCM / Expo)

**Aman by default — tidak ada push keluar** kecuali `FINANCE_PUSH_ENABLED=true`. Token FCM hanya dikirim bila kredensial FCM lengkap; token Expo tidak butuh kredensial di server (Expo Push).

| Env | Keterangan |
|---|---|
| `FINANCE_PUSH_ENABLED` | `"true"` untuk menyalakan |
| `FCM_SERVICE_ACCOUNT_JSON` **atau** `FCM_PROJECT_ID`+`FCM_CLIENT_EMAIL`+`FCM_PRIVATE_KEY` | Akun layanan Firebase (Project settings → Service accounts → Generate key). Untuk Expo, upload FCM V1 key ke EAS (`eas credentials`) |

Servis: `services/financeNotifications.js` — `dispatchFinanceNotification`, `notifyApprovalRequested`, `notifyApprovalDecided`, `notifyPaymentsPending`.
Isi title/body **generik** (tanpa nominal/nama); detail hanya di `data` (`url: sanofinance://…`). Token mati (FCM `UNREGISTERED`/404, Expo `DeviceNotRegistered`) dihapus otomatis.
**Pemicu di route finance belum dipasang** (slice S11) supaya perilaku endpoint yang berjalan tidak berubah di S0.

## 6. Foto nota

- File tetap di `backend/data/finance-receipts/` (`FINANCE_RECEIPTS_DIR` untuk mengubah), nilai `receiptUrl` di database **tidak berubah**.
- Izin: `FINANCE_READ` melihat semua; pemegang `FINANCE_EXPENSE_SUBMIT` saja hanya foto pada pengeluaran/pembelian yang ia buat/ajukan.
- URL bertanda-tangan: `HMAC-SHA256(file.exp)`, umur 10 menit, kunci `MEDIA_SIGNING_SECRET` (default turunan `JWT_SECRET`, label `finance-media-v1`).
- Cache `private, max-age=300`, `X-Content-Type-Options: nosniff`; nama file divalidasi `^[a-f0-9]{40}(_t)?\.jpg$` (tanpa path traversal).
- **Web**: `features/finance/receiptMedia.jsx` menukar URL foto dengan URL bertanda-tangan lewat `POST /finance/media/sign` (digabung per layar, di-cache) — dipakai `Foto`, `PemilihBukti`, `SelBukti`, dan tautan bukti di Kasbon.
- **Belum dilindungi** (di luar cakupan S0): `/media/payment-proofs`, `/media/vehicle-receipts`, `/media/invoice-pdfs`, dll. (dipakai app CRM/driver lain).

## 7. Database

Migration `20260919230000_mobile_sessions_idempotency_devices` (additive): `mobile_sessions`, `mobile_device_tokens`, `api_idempotency_keys`.
Deploy: `git pull` → `docker compose up -d --build backend` → `docker compose exec backend npx prisma migrate deploy`.

### Role baru (S2, 19 Sep 2026)

Enum `Role` bertambah `ACCOUNTANT` dan `APPROVER` (migration `20260920100000_role_accountant_approver`, hanya `ADD VALUE`, aman diulang). Belum ada pengguna yang ditetapkan — atur lewat halaman Pengguna & Peran ("Akuntan", "Penyetuju Keuangan"). `ACCOUNTANT`: FINANCE_READ, FINANCE_POST, PAYMENT_READ, DASHBOARD_READ. `APPROVER`: FINANCE_READ, FINANCE_APPROVE, PAYMENT_READ, DASHBOARD_READ. `PAYMENT_WRITE` tetap khusus `FINANCE`. Keduanya masuk portal Finance dan `capabilities.financeApp=true` (preset `ACCOUNTANT`/`APPROVER`). Tes: `tests/authorize.test.js`, `tests/integration/financeRoles.integration.test.js`.

### Kontrak dashboard untuk Beranda (S3, 20 Sep 2026)

`GET /api/finance/dashboard?from=&to=` (FINANCE_READ; FINANCE/ACCOUNTANT/APPROVER/OWNER 200, SALES 403). Uang berupa angka JSON; `kasBank`, `totalKas`, `piutang`, `utang` adalah posisi saat ini, hanya `labaRugi` mengikuti periode. Perbaikan: saat belum ada piutang (`umurPiutang` kosong) respons sebelumnya tidak memuat `total`/`perTanggal` dan `ringkasan` berupa Decimal bertipe string — sekarang bentuknya sama dengan saat berisi (angka). Perubahan aditif, aman untuk web. Tes kontrak: `tests/integration/financeDashboardContract.integration.test.js`.

### Inbox persetujuan gabungan (S4, 20 Sep 2026)

Read-model `services/finance/approvals.js`, router `routes/financeApprovals.js` (semua `requireAuth` + `FINANCE_READ`):
- `GET /api/finance/approvals?tab=MENUNGGU|DIPROSES|DISETUJUI|DITOLAK&jenis=expense,purchase,bill,refund&from&to&pemohonId&q&page&limit` → `{items, tab, page, limit, total, adaLagi, hitung}`.
- `GET /api/finance/approvals/ringkasan` → `{menunggu, perJenis}` (lencana). `GET /approvals/pemohon` (filter). `GET /approvals/:jenis/:id` → item + `rincian`, `lampiran` (signed URL), `riwayat` (ActivityEvent).
- Tiap item: `aksi.{setujui,tolak} = {boleh, alasan, path, alasanWajib?}` dihitung server. Keputusan tetap ke endpoint per jenis: `POST /finance/{expenses|purchases|bills|refunds}/:id/{approve|reject}` (`FINANCE_APPROVE`; `Idempotency-Key` wajib untuk token mobile; tolak wajib `reason`).
- Pemisahan tugas hanya expense & purchase. `lockRowForUpdate` di 8 handler approve/reject ⇒ balapan menghasilkan satu 200 dan satu 409.
- Peran token mobile dibaca dari DB tiap request (`sesiMobileTerkini` di `services/mobileSession.js`), jadi izin yang dicabut langsung berlaku (sebelumnya membeku 15 menit di JWT).
- Perbaikan WIB: `umurPiutang/umurUtang/saldoKasBank` memakai tanggal buku WIB (`todayBookDateWIB`), bukan `new Date()` UTC.
- Tes: `tests/integration/financeApprovals.integration.test.js` (15) + regresi WIB di `financePenerimaan.integration.test.js`.

### Pembayaran pelanggan (S5, 20 Sep 2026)

Kode: `services/finance/pembayaran.js`, `routes/financePembayaran.js`, bukti di `routes/financeMedia.js`. Tidak ada tabel/kolom baru. Endpoint & aturan lengkap: PRD §S5. Ringkas:
- `GET /api/finance/pembayaran[?status=MENUNGGU|TERVERIFIKASI|DITOLAK|DIBATALKAN&q&metode&rekeningId&from&to&limit&cursor]` → `{items, nextCursor, hitung, ringkasan, diperbaruiPada}` (cursor keyset `createdAt|id`); `/pembayaran/ringkasan`, `/pembayaran/opsi`, `/pembayaran/:id` (detail: `tagihan{nilaiOrder, terbayarTerhitung, sisa, sisaSetelahIni, gerbangVerifikasi, terhitungSebelumVerifikasi}`, invoice, alokasi, jurnal, `bukti`, `tidakTercatat`, `peringatan`, `riwayat`).
- Command `POST /pembayaran/:id/verifikasi` (201) dan `/tolak {reason}` (200) — `PAYMENT_WRITE`, `Idempotency-Key`, row lock, transaksi atomik, audit; respons memuat detail resmi terbaru.
- Bukti: `/media/bukti-pembayaran/:file` di luar `/api` (router-router finance memasang `requireAuth` global di `/api/finance`, jadi URL bertanda-tangan tanpa Bearer tidak bisa di bawah prefix itu — pola sama dengan `/media/finance-receipts`).
- Perbaikan lintas modul: `tolakLunas` menolak (409) bila order sudah lunas penuh oleh pembayaran terverifikasi; `verifikasiPenerimaan/tolakLunas` mengunci baris Order; `/armada/payments/:id/verify` memakai `verifikasiPembayaran`.
- Tes: `tests/integration/financePembayaran.integration.test.js` (18).

### Transaksi S6–S8 (21 Sep 2026)

Kode: `services/finance/transaksi.js`, `routes/financeTransaksi.js`. **Read-model saja** — tanpa tabel, ledger, status, atau command baru; perintah tetap ke endpoint dokumen (`routes/financeTransactions.js`, `financeKasbon.js`). Semua butuh `FINANCE_READ`; uang berupa string desimal.
- `GET /api/finance/transaksi/ringkasan` (jumlah per modul), `/opsi` (kategori, rekening + saldo, supplier, karyawan aktif, akun Pemasukan Lain, mode, ambang nota), `/opsi/order?q=` (cari order untuk refund + `sisaBisaDirefund` dari server).
- `GET /api/finance/transaksi/:modul?tab&q&from&to&page&limit[&supplierId&jatuhTempo=lewat]` → `{items, tab, page, total, adaLagi, hitung, ringkasan, diperbaruiPada}`; `GET .../:modul/:id` → detail (`bagian`, `lampiran` bertanda-tangan, `riwayat` dari audit trail, `pembayaran` untuk piutang). Modul: `pengeluaran | pembelian | kasbon | pemasukan | piutang | refund | supplier | tagihan | pembayaran-supplier`.
- Setiap item membawa `aksi` (`{boleh, alasan, path, metode, perlu, tetap}`) dan `persetujuan` (tautan ke Inbox S4 bila pengguna boleh memutuskan). Klien tidak menyalin aturan izin/status.
- Perintah yang dipakai: `POST /expenses|/purchases|/kasbon|/other-income|/refunds|/bills|/suppliers` (buat), `/expenses|purchases/:id/submit|pay|cancel|bukti`, `PATCH /expenses|purchases|suppliers/:id`, `/kasbon/:id/pelunasan|batal`, `/other-income/:id/cancel`, `/supplier-payments` (+ `/:id/cancel`), `/customer-payments/:id/allocations`, `/receipts/upload`. Semua: `Idempotency-Key` (428 untuk token mobile bila hilang).
- **Penguatan backend:** `lockRowForUpdate` pada bayar/batal pengeluaran & pembelian, pelunasan/batal kasbon (dua pemotongan paralel tidak bisa melampaui kasbon), pembayaran & batal pembayaran supplier (kunci baris tagihan urut id — dua pembayaran paralel tidak bisa melebihi sisa utang; satu tagihan tak boleh muncul dua kali dalam satu pembayaran), batal pemasukan lain.
- **Aturan Pemasukan Lain:** `POST/koreksi /other-income` menolak akun pendapatan penjualan/layanan/sewa/ongkir dan akun kontra Retur & Potongan Penjualan (400: uang pelanggan dicatat di Pembayaran & Verifikasi); `/transaksi/opsi` tidak menawarkannya.
- Tes: `tests/integration/financeTransaksi.integration.test.js` (9; `DUMP_TRANSAKSI=1` menulis fixture respons nyata untuk uji kontrak mobile `src/__tests__/transaksi.kontrak.test.ts`).

### Buku & laporan S9–S10 (21 Sep 2026)

Kode: `services/finance/buku.js`, `routes/financeBuku.js`. **Read-model saja**; semua butuh `FINANCE_READ`, uang = string desimal (`.toFixed(2)`), hanya jurnal `POSTED`/`REVERSED` (`STATUS_DIHITUNG`).
- `GET /api/finance/buku/jurnal?from&to&q&source&status&akunId&page&limit` → `{items, page, total, adaLagi, hitung, tidakSeimbang, diperbaruiPada}`; item memuat `totalDebit/totalKredit/seimbang/selisih`, `dokumen` (modul + id), jurnal pembalik. `GET .../jurnal/:id` → baris, riwayat audit, catatan bila tidak seimbang.
- `GET /buku/akun?q`, `GET /buku/akun/:id/mutasi?from&to&page` → saldo awal, mutasi, **saldo berjalan (Decimal di server)**; identik dengan `/reports/ledger` (diuji); batas 20.000 baris.
- `GET /buku/rekon`, `GET /buku/rekon/:id` → saldo buku/koran/selisih, kandidat (nominal & arah sama), `aksi.cocokkan/lepas` per baris, riwayat (`activityEvent` `FIN_BANK_STATEMENT`).
- Perintah (endpoint lama, diperkuat): `POST /bank-lines/:id/match` (kunci baris koran & baris jurnal; 409 bila baris koran sudah COCOK atau baris jurnal dipakai baris koran lain) dan `/unmatch` (409 bila tidak COCOK); audit trail keduanya.
- `GET /reports/arus-kas`: tiap baris kini membawa `accountId` (aditif) untuk drill-down.
- Tes: `tests/integration/financeBuku.integration.test.js` (jurnal termasuk fixture tidak seimbang; buku besar identik dengan laporan lama, negatif, lintas tahun; rekonsiliasi dengan double-tap, paralel, pasangan ganda, periode terkunci, izin; uji kontrak — `DUMP_BUKU=1` menulis fixture untuk `src/__tests__/buku.kontrak.test.ts`).

## 8. Tes

```bash
cd backend
npm test                                   # unit: rateLimit, mediaSigning, fcmTransport (+ yang lama)
node tests/integration/setup/bootstrapTestDb.js
node --test --test-concurrency=1 \
  tests/integration/mobileAuth.integration.test.js \
  tests/integration/financeIdempotency.integration.test.js \
  tests/integration/financeMedia.integration.test.js \
  tests/integration/financeNotifications.integration.test.js
npm run test:integration                   # seluruh suite (regresi)
```

## 9. QA manual (dengan curl)

```bash
B=https://app.sanomatrassehat.com/api          # dev: http://localhost:4000/api
# 1) login mobile
curl -s -X POST $B/mobile/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"natasha@klinikmatras.com","password":"...","device":{"id":"qa-1","label":"QA","appVersion":"0.0.1"}}' | tee /tmp/l.json
A=$(jq -r .accessToken /tmp/l.json); R=$(jq -r .refreshToken /tmp/l.json)
# 2) capabilities
curl -s $B/auth/me -H "Authorization: Bearer $A" | jq .capabilities
# 3) token mobile tidak diperpanjang → header X-Refreshed-Token TIDAK ada
curl -si $B/auth/me -H "Authorization: Bearer $A" | grep -i x-refreshed || echo "OK: tidak ada"
# 4) command tanpa Idempotency-Key ditolak (428)
curl -s -X POST $B/finance/transfers -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{}'
# 5) rotasi refresh, lalu pakai token LAMA → REFRESH_REUSED, sesi mati
curl -s -X POST $B/mobile/auth/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$R\"}" | jq -c '{ok:(.accessToken!=null)}'
curl -s -X POST $B/mobile/auth/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$R\"}"
# 6) foto nota tanpa login → 401
curl -si https://app.sanomatrassehat.com/media/finance-receipts/<hash>.jpg | head -1
# 7) rate limit login: 6× password salah → 429
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code} " -X POST $B/mobile/auth/login -H 'Content-Type: application/json' -d '{"email":"x@y.z","password":"salah","device":{"id":"qa"}}'; done
```
Di web: buka Finance → Pengeluaran/Pembelian/Kasbon — thumbnail nota harus tetap tampil, klik membuka foto penuh.

## 10. Risiko tersisa

1. **Step-up biometrik hanya di klien** (PRD §11.5) — penyerang yang memegang refresh token bisa memanggil API tanpa layar kunci. Mitigasi: token di secure storage, access 15 mnt, revoke instan. Step-up terverifikasi server = rilis berikutnya.
2. **Refresh token dipakai ulang karena respons hilang** (jaringan putus tepat setelah rotasi) mencabut sesi → pengguna login ulang. Aman tetapi bisa mengganggu; klien wajib menyimpan token baru secara atomik.
3. **Rate limit di memori**: hilang saat restart, per-instance.
4. **Foto yang baru diunggah oleh pemegang izin ajukan-saja** belum terikat ke dokumen sehingga belum bisa ditampilkan sampai dokumennya tersimpan (finance tidak terpengaruh).
5. **Media lain masih publik** (bukti pembayaran lama, struk kendaraan, invoice PDF) — dipakai app CRM/driver; perlu migrasi terpisah.
6. Pemicu notifikasi belum dipasang (S11); `FINANCE_PUSH_ENABLED` masih `false`.
7. Batas `Idempotency-Key`: respons yang gagal tidak disimpan, jadi request yang menghasilkan efek samping lalu 5xx bisa dieksekusi ulang bila klien memakai kunci yang sama — route finance memakai transaksi sehingga 5xx = tidak ada efek.
