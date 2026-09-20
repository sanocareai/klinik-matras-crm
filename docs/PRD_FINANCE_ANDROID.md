# PRD — SANO Finance Android (Klinik Matras)

| | |
|---|---|
| **Status** | **Revisi 2 (19 Sep 2026)** — S0 backend selesai & live; scaffold `finance-mobile/` dibuat (data contoh); fitur S1+ belum dikerjakan |
| **Tanggal** | 19 September 2026 (revisi 2: platform diganti ke React Native + Expo) |
| **Pemilik produk** | Gilang (CCO/Owner) |
| **Platform** | **React Native + Expo (SDK 57), TypeScript, Expo Router**, Android; build **EAS Build**, OTA **EAS Update** (kanal `development` / `preview` / `production`). *Rencana awal Kotlin/Compose dibatalkan.* |
| **Folder aplikasi** | `finance-mobile/` (sejajar `mobile/` & `driver-mobile/`, yang **tidak diubah**) |
| **Backend** | SANSS existing (`backend/`, Express + Prisma + PostgreSQL) — **single source of truth** |
| **Referensi visual** | `docs/references/finance-mobile/` (3 gambar: `vaulta-home-cards.png`, `nexora-portfolio.png`, `wallet-light.png`) |
| **Bahasa UI** | Bahasa Indonesia sehari-hari (aturan `CLAUDE.md` §2) |

> Dokumen ini hasil audit langsung terhadap kode SANSS per 19 September 2026. Semua klaim tentang backend
> disertai lokasi file. Yang **belum diverifikasi** ditandai eksplisit "(belum diverifikasi)".
>
> **Riwayat revisi.** Rev 1 (19 Sep 2026): PRD awal (Kotlin + Jetpack Compose). Rev 2 (19 Sep 2026): keputusan produk mengganti platform ke
> **React Native + Expo** — §15 (arsitektur), §18 (testing/build/EAS), sebagian §9–§11 (foto, glass, keamanan), §17 (status gap), §19–§20
> ditulis ulang. Bagian fungsional (§1–§8, §12–§14, §16) tidak bergantung platform dan tetap berlaku. Backend S0 dijelaskan di
> `docs/FINANCE-MOBILE-BACKEND.md`.

---

## 0. Cara membaca dokumen ini

1. §1–§3 : tujuan, persona, scope. 2. §4 : temuan audit codebase (dasar semua keputusan). 3. §5–§10 : fitur & layar.
4. §11–§14 : keamanan, RBAC, offline. 5. §15–§18 : arsitektur, kontrak API, **gap API**, testing, rilis.
6. §19 : slice implementasi + acceptance criteria. 7. §20 : risiko & keputusan terbuka.

Istilah: **Ledger** = buku besar double-entry di server (`FinJournalEntry`/`FinJournalLine`).
**Command** = permintaan mobile ke server untuk mengubah data (approve, catat pengeluaran, dll).
**Snapshot** = data baca-saja yang di-cache di HP dengan cap waktu.

---

## 1. Tujuan, masalah, dan prinsip

### 1.1 Masalah yang diselesaikan

Finance & Accounting Workspace sekarang hanya ada sebagai web desktop (`frontend/src/pages/finance/*`, 15 halaman).
Kenyataan operasional Klinik Matras:

- **Pengeluaran & pembelian dilaporkan lewat WhatsApp** (foto nota dikirim ke Natasha). Web sudah punya
  upload + paste foto, tapi finance harus duduk di depan laptop.
- **Approval menunggu orang di depan laptop.** Owner (Gilang/Kemal/Juri) sering di lapangan; pengeluaran,
  pembelian, tagihan, dan refund berstatus `MENUNGGU_APPROVAL` menumpuk (angka antreannya sudah ada di
  `GET /finance/dashboard` → `antrean`).
- **Verifikasi pembayaran pelanggan** (uang benar-benar masuk rekening SANOBANK Kemal / PT Sano) butuh lihat
  mutasi bank — yang justru terjadi di HP (m-banking).
- **Owner tidak punya satu layar "posisi keuangan hari ini"** yang enak dibuka di HP.

### 1.2 Tujuan produk

| # | Tujuan | Ukuran keberhasilan (target, diukur setelah 30 hari rilis internal) |
|---|---|---|
| G1 | Finance bisa mencatat pengeluaran/pembelian/kasbon lengkap dengan foto nota **dari HP dalam < 60 detik** | Median waktu dari buka app → tersimpan ≤ 60 dtk |
| G2 | Approval diputuskan **di hari yang sama** | ≥ 80% approval diputuskan < 24 jam sejak diajukan |
| G3 | Verifikasi pembayaran pelanggan dilakukan dari HP | ≥ 50% verifikasi lewat app |
| G4 | Owner melihat posisi kas, piutang, utang, laba periode dalam **< 3 detik** setelah buka app | Cold start → dashboard terisi ≤ 3 dtk (jaringan 4G) |
| G5 | **Nol selisih** antara angka di app dan web | Tidak ada perhitungan uang di app (§1.3) |

### 1.3 Prinsip yang tidak boleh dilanggar

1. **Server adalah satu-satunya sumber kebenaran.** App **tidak** menghitung saldo, laba, umur piutang,
   jurnal, alokasi, atau total resmi. App mengirim *command* dan menampilkan *hasil resmi server*.
   (Selaras aturan blok Finance: "tidak ada sumber tandingan", lihat komentar kepala `services/finance/*`.)
2. **Tidak ada database keuangan lokal yang bisa dijadikan sumber.** Cache hanya *snapshot baca-saja* berlabel
   waktu, dihapus saat logout (§14).
3. **Tidak ada posting finansial saat offline.** Tidak ada antrean command, tidak ada optimistic update
   pada status keuangan (§14).
4. **Pemisahan tugas (segregation of duties) tetap ditegakkan server.** UI hanya menyembunyikan tombol
   yang memang tidak boleh; keputusan akhir selalu di server (§12).
5. **Jujur soal data.** Catatan laporan (`catatan.pesan`: saldo awal belum diinput, gap posting terbuka)
   **wajib tampil** di layar laporan — sama seperti web (`services/finance/reports.js#catatanLaporan`).
6. **Aplikasi mobile bukan "sidebar desktop yang dikecilkan"**: navigasi berbasis tugas (§6).

---

## 2. Persona

| Persona | Siapa (saat ini) | Konteks | Kebutuhan utama di HP |
|---|---|---|---|
| **Finance** | Natasha (satu-satunya orang finance; juga pegang QC/Gudang/Dispatcher) | Input semua transaksi; bawahan lapor pengadaan ke dia | Catat cepat + foto nota, verifikasi pembayaran, kasbon, cek saldo rekening |
| **Accountant** | Belum ada orang khusus — disiapkan untuk akuntan/konsultan pajak paruh waktu | Cek pembukuan, rekonsiliasi, laporan | Baca jurnal/buku besar/laporan, rekonsiliasi bank, data belum lengkap. **Tidak menyetujui.** |
| **Approver** | Leader/kepala divisi yang diberi hak setuju (peran baru, §12) | Sering di lapangan | Inbox persetujuan, lihat bukti, setuju/tolak dengan alasan |
| **Owner** | Gilang, Kemal, Juri (role `OWNER`) | Ingin tahu posisi keuangan & memutuskan | Dashboard posisi keuangan, approval, laporan ringkas, tinjau bukti, notifikasi |

Catatan nyata dari `CLAUDE.md`: tim 7 orang untuk finance saat ini; `FINANCE_POST` + `FINANCE_APPROVE` sengaja
ada pada satu orang (`constants/permissions.js` komentar role `FINANCE`). Aplikasi **tidak boleh** mengasumsikan
tim besar, tapi harus siap dipecah lewat permission tanpa mengubah kode (§12).

---

## 3. Scope

### 3.1 MVP (rilis 1.0 — internal Klinik Matras, sideload APK)

| Area | Isi MVP |
|---|---|
| Beranda / dashboard | Total kas & saldo per rekening, laba bersih periode, piutang, utang, antrean tindakan, jurnal terakhir, tren 6 bulan |
| Pembayaran & verifikasi | Antrean "Lunas di CRM" (verifikasi + pilih rekening + foto bukti + tolak/Belum Lunas), pembayaran menunggu/terverifikasi, verifikasi tunggal & massal |
| Kas & bank | Daftar rekening + saldo, mutasi per rekening, transfer antar rekening |
| Pengeluaran | Daftar, filter, cari, buat (foto nota), ajukan, bayar reimbursement/utang, batalkan/koreksi dengan alasan |
| Pembelian | Sama seperti pengeluaran (bahan baku manual, aset, uang muka pembelian) |
| Kasbon | Daftar per karyawan, buat kasbon, catat potong gaji, batalkan dengan alasan |
| Pemasukan lain | Buat pemasukan non-order |
| Piutang, invoice, refund | Umur piutang, daftar invoice + jatuh tempo + PDF (endpoint existing), buat refund, refund masuk antrean approval |
| Supplier & utang | Umur utang, supplier, tagihan supplier, pembayaran tagihan |
| Approval | Inbox gabungan: pengeluaran, pembelian, tagihan supplier, refund → setuju/tolak |
| Jurnal & buku besar | **Baca saja**: jurnal umum + detail baris, buku besar per akun |
| Rekonsiliasi | Lihat statement, cocokkan / batalkan cocok / abaikan baris, selesaikan (jika berwenang) |
| Laporan | Laba rugi, neraca, arus kas, neraca saldo, umur piutang, umur utang (+ catatan laporan) |
| Notifikasi | Push (FCM) untuk approval masuk/diputuskan & pembayaran menunggu verifikasi; pusat notifikasi dalam app |
| Audit trail | Linimasa aktivitas per dokumen (siapa/kapan/apa/alasan) |
| Lampiran | Kamera, galeri, **Share-target dari WhatsApp**, kompres di perangkat + kompres server |
| Pencarian & filter | Cari per daftar + filter bergaya glass; pencarian global (§8.6) |
| Ekspor | Bagikan PDF invoice (existing), ekspor CSV dari daftar yang sedang tampil (serialisasi murni), bagikan tangkapan laporan |
| Keamanan | Login aman, PIN + biometrik, auto-lock, masking, sesi per perangkat |

### 3.2 Non-MVP (sengaja ditunda)

| Fitur | Alasan ditunda | Versi |
|---|---|---|
| Jurnal umum manual (buat/post/hapus draft) | Butuh paham debit-kredit; risiko salah input di layar kecil; tetap di web | 1.2 |
| Tutup/buka periode, reversal jurnal terposting, bagan akun, rekening kas, kategori, pengaturan finance | Berisiko tinggi (`FINANCE_ADMIN`); tetap web-only. Mobile hanya menampilkan status | 1.3 (dengan step-up biometrik) |
| Alokasi 1 pembayaran ke banyak order | UI kompleks (`POST /customer-payments/:id/allocations`) | 1.1 |
| Impor baris rekening koran (CSV) | Input dari file bank; lebih cocok di laptop | 1.2 |
| Approval massal | Perlu desain kontrol risiko (batas nominal + step-up) | 1.1 |
| Pratinjau jurnal sebelum approve | Butuh endpoint server baru (G-12) | 1.1 |
| PDF/Excel laporan dibuat server | Butuh endpoint ekspor baru (G-11) | 1.1 |
| Tablet/landscape layout khusus, iOS, Wear OS | Di luar permintaan | — |
| Mode offline penuh / antrean command | **Dilarang** oleh prinsip §1.3 | tidak akan dibuat |
| Perhitungan pajak, payroll penuh | Belum ada modulnya di backend | — |

---

## 4. Temuan audit codebase SANSS

### 4.1 Peta sistem yang sudah berjalan

| Lapisan | Fakta terverifikasi | Lokasi |
|---|---|---|
| API Finance | ±104 endpoint di 4 router, semua di prefix `/api/finance/*`: `finance.js` (37: akun, rekening kas, kategori, periode, jurnal, invoice, gap, setting, 7 laporan, dashboard, sync), `financeTransactions.js` (±55: pengeluaran, pembelian, supplier, tagihan, pembayaran supplier, transfer, pemasukan lain, pembayaran pelanggan, refund, rekonsiliasi, upload nota/bukti), `financeKasbon.js` (8), `financePenerimaan.js` (4: verifikasi order Lunas di CRM) | `backend/src/routes/finance*.js` |
| Verifikasi legacy | `POST /api/armada/payments/:id/verify` (izin `PAYMENT_WRITE`) — masih jalur verifikasi pembayaran yang sudah punya baris `Payment` | `routes/armada.js:4766` |
| Ledger | Double-entry: `FinJournalEntry` (status `DRAFT/POSTED/REVERSED`) + `FinJournalLine`; jurnal diposting **hanya** lewat `postJournal()` (seimbang, idempoten via `idempotencyKey`, periode terkunci ditolak) | `services/finance/journal.js`, `schema.prisma:5626-5773` |
| Mesin posting | Per sumber: pengeluaran, pembelian, kasbon, supplier, kas, inventori, pendapatan order, reallocate | `services/finance/posting/*.js` |
| Laporan | Semua dihitung server: `neracaSaldo`, `labaRugi`, `neraca`, `arusKas`, `bukuBesar`, `umurPiutang`, `umurUtang`, `saldoKasBank` + `catatanLaporan` | `services/finance/reports.js` |
| Uang | `Decimal(18,2)` di DB (`Prisma.Decimal`, pembulatan HALF_UP); **di JSON keluar sebagai `number`** (`moneyToNumber`) | `services/finance/money.js` |
| Tanggal | Tanggal dokumen = `YYYY-MM-DD` (kolom `DATE`, WIB); instant = ISO UTC; rentang laporan `?from=&to=` WIB, default bulan berjalan | `finance.js#rentangDariQuery`, `CLAUDE.md` §11 |
| Error | Selalu `{ "error": "<pesan Bahasa Indonesia>" }` + HTTP status (400/403/404/409/422/500). Kasbon batas → `422 { error, kodeBatas:true }` | `finance.js#handleFinanceError`, `financeKasbon.js:224` |
| Audit trail | `recordActivity()` → `ActivityEvent`; entity `FIN_JOURNAL/EXPENSE/PURCHASE/KASBON/SUPPLIER_BILL/REFUND/PERIOD/ACCOUNT/SETTING/CASH_TRANSFER/OTHER_INCOME` | `lib/activityLog.js` |
| Bukti/nota | Upload multipart `receipt` (maks 25 MB, hanya `image/*`), dikompres server ke `data/finance-receipts/<hash>.jpg` + `_t.jpg`; URL `/media/finance-receipts/...` | `services/finance/receipts.js`, `financeTransactions.js:2267` |
| Kebijakan | Setting: gerbang verifikasi, ambang approval (`expense_approval_threshold`), ambang wajib nota, batas kasbon aktif, tanggal saldo awal (`balance_cutover_date` = 2026-09-18) | `services/finance/settings.js` |
| Tes backend | 11 berkas tes finance (unit + integrasi dengan DB nyata: ledger, journal, money, allocation, kasbon, penerimaan, purchase, koreksi, receipt, read routes) | `backend/tests/` |
| Web finance | 15 halaman + `features/finance/*` (FilterBar glass, PemilihBukti/paste, EditDokumen, BuktiReview, LunasBelumDicatat) | `frontend/src/pages/finance/`, `frontend/src/features/finance/` |
| Aplikasi mobile lain | `mobile/` (Expo React Native, sales, `com.sanomatrassehat.salesapp`), `driver-mobile/` (Expo RN), `driver-app/` (Capacitor, legacy). **Belum ada aplikasi native Kotlin & belum ada app Finance** | root repo |

### 4.2 Status alur transaksi yang harus dihormati mobile

| Dokumen | Status (enum) | Catatan aturan server |
|---|---|---|
| Pengeluaran / Pembelian | `DRAFT → MENUNGGU_APPROVAL → DISETUJUI → DIBAYAR`, `DITOLAK`, `DIBATALKAN` | Mode `LANGSUNG` (langsung `DIBAYAR` saat approve, jurnal sekali), `REIMBURSEMENT`, `UTANG` (perlu `/pay`). Di bawah ambang → langsung disetujui untuk pemegang `FINANCE_POST`. Nota wajib di atas ambang; Pembelian & Reimbursement selalu wajib |
| Orang divisi (hanya `FINANCE_EXPENSE_SUBMIT`) | — | Selalu dipaksa `REIMBURSEMENT`, hanya melihat pengajuan sendiri (`hanyaMilikSendiri`) |
| Tagihan supplier | `DRAFT/MENUNGGU_APPROVAL/DISETUJUI/DIBAYAR_SEBAGIAN/LUNAS/DITOLAK/DIBATALKAN` | `DIBAYAR_SEBAGIAN/LUNAS` turunan alokasi, tidak diketik |
| Refund | `MENUNGGU_APPROVAL/DISETUJUI/DITOLAK/DIBATALKAN` | Tidak boleh melebihi uang yang pernah diterima (dicek 2×, konkurensi-aman) |
| Kasbon | `AKTIF/LUNAS/DIBATALKAN` | **Tanpa approval.** Kasbon = gaji dicairkan lebih awal; hanya `POTONG_GAJI`; Dr Piutang Karyawan/Cr Kas; potong: Dr Beban Gaji/Cr Piutang Karyawan |
| Pembayaran pelanggan | belum diverifikasi / terverifikasi / dibatalkan (turunan baris `PaymentVerification`) | Verifikasi = `PAYMENT_WRITE` (hanya role `FINANCE`) |
| Order "Lunas di CRM" | turunan `Order.paymentStatus=LUNAS` tanpa `Payment` | Diverifikasi lewat `POST /penerimaan/verifikasi`; sebelum 18 Sep 2026 **tidak** menambah kas (mode `SEBELUM_SALDO_AWAL`) |
| Rekonsiliasi | statement `DRAFT/SELESAI`; baris `BELUM_COCOK/COCOK/DIABAIKAN` | Selesaikan = `FINANCE_APPROVE` |
| Periode | `OPEN/CLOSED` | Tutup/buka = `FINANCE_ADMIN` (web-only di MVP) |

Aturan server yang mempengaruhi UX:
- **Pengaju tidak boleh menyetujui pengajuannya sendiri**, kecuali pemegang `FINANCE_ADMIN` (tercatat di audit `menyetujuiPengajuanSendiri`) — `financeTransactions.js:302,748`.
- **Bukti tidak boleh diverifikasi pembuat dokumennya** (`FINANCE_ADMIN`, orang lain) — `financeTransactions.js:2330`.
- Ganti/lepas foto bukti yang sudah ada **wajib alasan**; edit/koreksi/batal dokumen wajib alasan.
- Jurnal `POSTED` **tidak pernah diubah**; pembatalan = reversal jurnal.

### 4.3 Temuan yang mempengaruhi desain aplikasi (dijadikan gap di §17)

| # | Temuan | Bukti | Dampak ke mobile |
|---|---|---|---|
| F1 | **Sesi = satu JWT 7 hari, tanpa refresh token, tanpa daftar cabut, tanpa ikatan perangkat.** Akun nonaktif baru ditolak saat login/refresh; token lama hidup sampai 7 hari | `routes/auth.js:53`, `middleware/auth.js`, komentar `auth.js:39-46` |
| F2 | **Sliding refresh otomatis**: sisa umur < 6 hari → respons membawa `X-Refreshed-Token` 7 hari. Jika token mobile berumur pendek dipakai di middleware ini, ia otomatis "diperpanjang" jadi 7 hari | `middleware/auth.js:28-78` |
| F3 | **Tidak ada rate limiting** (login maupun API), tidak ada helmet; CORS terbuka | `index.js:144`; grep `rate-limit` nol hasil |
| F4 | **`/auth/me` mengembalikan `roles` + `portals`, bukan daftar permission.** Klien harus menyalin peta role→permission (dua sumber kebenaran) | `routes/auth.js:86-100` |
| F5 | **Role `ACCOUNTANT` dan `APPROVER` tidak ada.** Enum `Role` punya `ADMIN, OWNER, FINANCE, …`. `OWNER` = izin ADMIN (termasuk `FINANCE_ADMIN`) + B2B tapi **tanpa `PAYMENT_WRITE`** | `schema.prisma:16+`, `permissions.js:195-360` |
| F6 | **Tidak ada endpoint inbox approval gabungan.** Approval tersebar di 4 daftar (`/expenses`, `/purchases`, `/bills`, `/refunds`) filter status; dashboard hanya memberi *jumlah* | `finance.js:1115-1118` |
| F7 | **Tidak ada `Idempotency-Key` pada command pembuatan** (POST expenses/purchases/kasbon/refunds/transfers/…). Dobel-tap di jaringan lambat = dokumen ganda (preseden nyata: 22 pengeluaran ganda yang dibatalkan 19 Sep 2026) | `financeTransactions.js` POST; idempotensi hanya di level jurnal |
| F8 | **Daftar dibatasi keras tanpa cursor**: expenses/customer-payments `take: 300` (+ flag `terpotong`), jurnal `limit ≤ 500` + `offset`, invoice `≤ 500` | `financeTransactions.js:172-210`, `finance.js:578` |
| F9 | **Push: hanya Expo Push Token & Web Push.** `PushToken.token` berformat `ExponentPushToken[...]`; Aplikasi Expo dapat memakai token Expo Push (sudah didukung) atau token FCM asli. **Tidak ada satu pun event notifikasi finance** (approval, verifikasi) | `schema.prisma:590`, `services/expoPush.js`, `services/pushNotifications.js` |
| F10 | **Audit trail finance tidak bisa dibaca via API.** `GET /api/activity` hanya whitelist `UNIT/ORDER/COMPLAINT`; `entityType` `fin_*` ditolak 400 | `routes/activity.js:20-24` |
| F11 | **Foto nota disajikan sebagai file statis publik** `GET /media/finance-receipts/<hash>.jpg` tanpa auth (nama = hash konten; tidak bisa ditebak tanpa memiliki fotonya, tapi tidak dilindungi izin) | `index.js:155` |
| F12 | **Tidak ada ekspor sisi server untuk data finance** (ekspor Excel dibuat di browser). Hanya PDF invoice: `GET /api/orders/:id/invoice/pdf` | `routes/orders.js:1287` |
| F13 | **Tidak ada endpoint tren bulanan** (dashboard hanya periode berjalan) | `finance.js:1088` |
| F14 | Uang di JSON = `number` (double). Aman untuk Rupiah puluhan-ratusan juta (< 2^53) tetapi klien **tidak boleh** memakai `Double`/`Float` untuk uang | `money.js#moneyToNumber` |
| F15 | Health check hanya `{ok:true}`; tidak ada versi API/`min_app_version`/maintenance flag; tidak ada `X-Request-Id` | `index.js:238` |
| F16 | Dasbor sudah menggabungkan semua yang dibutuhkan Beranda dalam **1 panggilan**: `kasBank[]`, `totalKas`, `labaRugi`, `piutang`, `utang`, `antrean{...}`, `gate`, `jurnalTerakhir[8]`, `catatan` | `finance.js:1088-1167` |
| F17 | Setiap dokumen sudah punya nomor manusiawi (`EXP-DDMMYYYY-NNN`, `PUR-`, `KSB-`, `TRF-`) dan `generateDocumentNumber` | `schema.prisma`, `journal.js` |

### 4.4 Referensi visual → keputusan desain

| Referensi | Yang diambil | Yang **tidak** diambil |
|---|---|---|
| `vaulta-home-cards.png` (biru glass gelap) | Hero "Total Balance" besar dengan digit desimal redup; kartu rekening horizontal berbahan glass; grid Quick Actions dalam panel translucent; kartu "This Month Uses" dengan progress bar; bottom nav ikon+label | Dynamic Island, status bar iPhone, ikon merek VISA |
| `nexora-portfolio.png` (biru muda + navy) | Kartu ringkasan berisi nilai + chip delta (▲ +4,73%); donut/ring dengan label melengkung; bar chart bertumpuk; kartu daftar dengan badge waktu/tanggal | Konten investasi/kripto |
| `wallet-light.png` (mode terang, kartu ungu) | Mode terang lembut abu-putih; tombol bulat bayangan lembut (menu, tambah); FAB tengah di bottom bar; kartu transaksi kecil dengan avatar & nominal hijau/merah | Warna ungu (diganti biru brand), avatar kartun |

Token warna mengikuti `docs/design-system/sano-color-system.md`: biru brand `#2064B7` (skala `brand-50…900`),
sukses `#16A34A`, peringatan `#F59E0B`, bahaya `#DC2626`. Detail di §10.

---

## 5. Kebutuhan fungsional per modul

Notasi: **FR-x-n** = requirement; kolom "API" merujuk kontrak di §16; "Gap" merujuk §17. Semua aksi ubah data
adalah *command* ke server, diikuti *re-fetch* hasil resmi (§15.4).

### 5.1 Beranda — posisi keuangan (FR-H)

| ID | Kebutuhan | API / Gap |
|---|---|---|
| FR-H-1 | Kartu hero **Total Kas & Bank** (angka besar, desimal redup, tombol sembunyikan angka ala referensi wallet) | `GET /finance/dashboard` → `totalKas` |
| FR-H-2 | Carousel **kartu rekening** (nama, saldo, jenis BANK/KAS/EWALLET) — tap → mutasi rekening | `dashboard.kasBank[]` |
| FR-H-3 | **Aksi cepat**: Catat Pengeluaran, Foto Nota, Kasbon, Verifikasi Pembayaran, Transfer Kas, Refund. Hanya yang diizinkan capability pengguna | capabilities (G-04) |
| FR-H-4 | **Perlu Tindakan**: jumlah menunggu approval (4 jenis), pembayaran belum diverifikasi, order Lunas di CRM belum dicatat, gap posting | `dashboard.antrean` |
| FR-H-5 | KPI periode: laba bersih, pendapatan bersih, beban, piutang total (+ jatuh tempo), utang total | `dashboard.labaRugi/piutang/utang` |
| FR-H-6 | Ring chart komposisi (mis. Piutang per ember umur, atau Beban per kelompok) dan bar chart tren 6 bulan pendapatan vs beban | `dashboard.piutang.ringkasan`; tren: G-09 |
| FR-H-7 | Daftar **8 jurnal terakhir** (nomor, deskripsi, sumber, total) → tap detail | `dashboard.jurnalTerakhir` |
| FR-H-8 | Banner **catatan laporan** bila ada (saldo awal belum diinput / gap terbuka) — wajib jujur | `dashboard.catatan.pesan` |
| FR-H-9 | Pemilih periode (bulan ini, bulan lalu, 30 hari, kustom) — default bulan berjalan WIB | `?from=&to=` |
| FR-H-10 | Pull-to-refresh + refresh otomatis saat app kembali ke foreground bila data > 60 detik | — |
| FR-H-11 | Tampilan **Owner** memprioritaskan: kas, laba, approval; tampilan **Finance** memprioritaskan: antrean verifikasi, aksi cepat | capabilities |

### 5.2 Pembayaran & verifikasi (FR-P)

Latar: sales menekan **Lunas** di CRM → status order berubah tetapi belum ada uang tercatat. Finance memverifikasi:
pilih rekening tujuan (SANOBANK Kemal / PT Sano / …) + lampirkan foto bukti. (Implementasi web: `LunasBelumDicatat.jsx`.)

| ID | Kebutuhan | API |
|---|---|---|
| FR-P-1 | Tab **Lunas di CRM** (default untuk Finance): daftar order ditandai lunas tanpa catatan uang; jenis **Perlu dicek** vs **Lunas sebelum 18 Sep 2026** | `GET /finance/penerimaan/lunas-belum-dicatat` |
| FR-P-2 | **Verifikasi satu order**: pilih rekening (chip), cara bayar, tanggal uang masuk, nominal (boleh lebih kecil dari nilai order), foto bukti; jenis "sebelum tanggal saldo awal" tidak butuh rekening/foto | `POST /finance/penerimaan/verifikasi` |
| FR-P-3 | **Verifikasi massal** (rekening sama untuk banyak order); hasil per order (berhasil/gagal) ditampilkan | `POST /finance/penerimaan/verifikasi-massal` |
| FR-P-4 | **Belum Lunas** (uang belum masuk): wajib alasan; status order dikembalikan, `paidAt` dikosongkan | `POST /finance/penerimaan/tolak` |
| FR-P-5 | Tab **Menunggu Verifikasi** & **Sudah Diverifikasi** & **Semua**: daftar pembayaran (order, pelanggan, nominal, cara bayar, rekening, pencatat, foto bukti) | `GET /finance/customer-payments?status=` |
| FR-P-6 | Verifikasi satu pembayaran yang sudah punya baris `Payment` | `POST /armada/payments/:id/verify` |
| FR-P-7 | Kartu angka **tab-independen**: total uang masuk periode, dan **nominal Rp** Menunggu Verifikasi vs Sudah Diverifikasi (+ jumlah pembayaran). Dihitung server (klien hanya menampilkan) | G-13 (sementara: 2 panggilan `customer-payments` seperti web) |
| FR-P-8 | Lihat foto bukti layar penuh (zoom, cubit), bagikan | media (F11 → G-08) |
| FR-P-9 | Filter: metode, rekening, sales/pencatat, ada/tanpa bukti; pencarian order/pelanggan/nominal (`150.000` cocok `150000`) | klien + `q` |
| FR-P-10 | Setelah verifikasi sukses, item hilang dari antrean **karena server menghitung ulang** (bukan dihapus lokal) | re-fetch |
| FR-P-11 | Bahasa: sehari-hari; **tidak** memakai istilah "sebelum saldo awal"/"pemetaan metode" — gunakan "Lunas sebelum {tanggal}", "belum dipilih" | Konten §7 |

Izin: hanya role dengan `PAYMENT_WRITE` (praktis `FINANCE`) yang melihat tombol verifikasi. Owner/Approver **hanya membaca**.

### 5.3 Kas & bank (FR-K)

| ID | Kebutuhan | API |
|---|---|---|
| FR-K-1 | Daftar rekening + saldo + total | `GET /finance/cash-accounts` |
| FR-K-2 | Detail rekening: mutasi berurutan (buku besar akun kas) dengan saldo berjalan, filter periode | `GET /finance/reports/ledger/:accountId` (`accountId` dari `cashAccount.account.id`) |
| FR-K-3 | **Transfer antar rekening**: asal, tujuan, nominal, biaya admin, referensi, catatan; rekening asal ≠ tujuan | `POST /finance/transfers` |
| FR-K-4 | Riwayat transfer + batalkan/koreksi dengan alasan (`FINANCE_ADMIN`) | `GET/POST /transfers…` |
| FR-K-5 | **Pemasukan lain** (non-order): akun pendapatan, rekening tujuan, lampiran | `POST /finance/other-income` |
| FR-K-6 | Pengelolaan rekening (tambah/nonaktif) **tidak ada di mobile** (web-only) | — |

### 5.4 Pengeluaran, pembelian, kasbon (FR-E)

| ID | Kebutuhan | API |
|---|---|---|
| FR-E-1 | Daftar Pengeluaran: filter status, divisi, kategori, mode, ada/tanpa bukti, periode; cari (nomor, keterangan, penerima, supplier); kartu ringkas + badge status | `GET /finance/expenses` |
| FR-E-2 | **Buat pengeluaran**: tanggal, nominal, keterangan, kategori (dari daftar server), divisi, mode (Langsung/Reimburse/Utang), rekening sumber (jika Langsung), supplier/penerima, order/unit terkait (opsional), **foto nota**, catatan. Kategori/divisi/rekening diambil dari server | `POST /finance/expenses`, `GET /expense-categories`, `GET /cash-accounts` |
| FR-E-3 | **Foto nota**: kamera, galeri, dan **Share dari WhatsApp** (§9.3); kompres di perangkat sebelum unggah (§9.3); tampilkan peringatan jika foto sudah dipakai dokumen lain (`dipakaiDi`) | `POST /finance/receipts/upload` |
| FR-E-4 | Orang divisi (hanya `FINANCE_EXPENSE_SUBMIT`) hanya bisa **mengajukan reimbursement** dan melihat pengajuan sendiri | server memaksa |
| FR-E-5 | Alur: draft → ajukan → (approve) → bayar untuk Reimburse/Utang; tombol **Bayar** memilih rekening + tanggal | `submit`, `pay` |
| FR-E-6 | **Ubah/Koreksi/Batalkan** dokumen: wajib alasan (bottom sheet); ganti/lepas foto wajib alasan | `PATCH`, `koreksi`, `cancel`, `bukti` |
| FR-E-7 | Detail: semua field, foto bukti, status verifikasi bukti, **linimasa audit** | detail + G-05 |
| FR-E-8 | **Pembelian**: sama seperti pengeluaran, dengan "Jenis Pembelian" (Bahan Baku Manual, Aset Kendaraan/Peralatan, Aset Tak Berwujud, Uang Muka Pembelian) | `/finance/purchases…` |
| FR-E-9 | **Kasbon**: daftar per karyawan (sisa aktif), buat kasbon (nama, nominal, **urgensi wajib**, rekening, bukti), peringatan batas (`422 kodeBatas`), catat **potong gaji** per kasbon atau per karyawan, batal dengan alasan | `/finance/kasbon…` |
| FR-E-10 | Bahasa kasbon: "gaji dicairkan lebih awal, dipotong dari gaji" — **bukan** "dikembalikan"; tidak ada opsi tunai | Konten §7 |
| FR-E-11 | Banner di Pengeluaran: "Kasbon periode ini Rp X — lihat Kasbon" (tampilan saja, tidak mengubah jurnal) | dari `GET /kasbon` (G-14 opsional) |
| FR-E-12 | **Tinjau bukti** (Owner/`FINANCE_ADMIN`): antrean dokumen tanpa bukti / bukti belum diverifikasi; verifikasi bukti oleh orang **selain pembuat** | `GET /bukti-review`, `POST …/verifikasi-bukti` |

### 5.5 Invoice, piutang, refund, supplier, utang (FR-R)

| ID | Kebutuhan | API |
|---|---|---|
| FR-R-1 | **Umur piutang**: ringkasan per ember umur, daftar pelanggan/order; **hanya order belum lunas** (order LUNAS tidak masuk piutang); banner "N order menunggu verifikasi" | `GET /finance/reports/receivables` |
| FR-R-2 | **Invoice & jatuh tempo**: daftar, filter status/jatuh tempo, cari; tandai lewat tempo; buka/bagikan PDF | `GET /finance/invoices`, `GET /orders/:id/invoice/pdf` |
| FR-R-3 | **Refund**: buat (order, nominal ≤ yang pernah diterima, alasan, rekening, lampiran) → masuk approval | `POST /finance/refunds` |
| FR-R-4 | **Umur utang** + daftar supplier + detail supplier | `GET /reports/payables`, `GET /suppliers` |
| FR-R-5 | **Tagihan supplier**: daftar, buat (supplier, tanggal, jatuh tempo, nominal, kategori biaya **atau** penerimaan barang gudang, lampiran), approve/reject | `/finance/bills…` |
| FR-R-6 | **Bayar tagihan**: pilih tagihan (alokasi), rekening, tanggal, referensi; tidak boleh melebihi sisa tagihan | `POST /finance/supplier-payments` |
| FR-R-7 | Supplier baru/ubah (izin `FINANCE_POST`) | `POST/PATCH /suppliers` |

### 5.6 Approval (FR-A)

| ID | Kebutuhan | API |
|---|---|---|
| FR-A-1 | **Inbox Persetujuan** gabungan 4 jenis (Pengeluaran, Pembelian, Tagihan supplier, Refund), urut terlama-dulu, chip filter jenis, badge jumlah di tab | G-06 (sementara 4 panggilan filter `status=MENUNGGU_APPROVAL`) |
| FR-A-2 | **Detail approval**: pemohon, tanggal, nominal, kategori/divisi, mode, foto bukti (zoom), catatan, riwayat; peringatan jika bukti kosong pada dokumen yang mewajibkannya | detail endpoint |
| FR-A-3 | **Setujui** (konfirmasi + step-up biometrik/PIN, §11.5) | `POST …/approve` |
| FR-A-4 | **Tolak** dengan alasan wajib | `POST …/reject` |
| FR-A-5 | Pengaju sendiri **tidak melihat** tombol Setujui (server tetap menolak 403 dengan pesan aslinya) kecuali `FINANCE_ADMIN` | server rule |
| FR-A-6 | Konflik: dokumen sudah diputuskan orang lain (409) → tampilkan "Sudah diputuskan oleh …", muat ulang | 409 |
| FR-A-7 | Setelah putusan, jurnal diposting **server**; app menampilkan nomor jurnal hasil resmi | respons approve |
| FR-A-8 | Pratinjau jurnal yang akan terbentuk | G-12 (non-MVP) |
| FR-A-9 | Pemilihan periode terkunci: jika periode dokumen `CLOSED`, server menolak → pesan jelas | 4xx server |

### 5.7 Jurnal, buku besar, rekonsiliasi, data belum lengkap (FR-J)

| ID | Kebutuhan | API |
|---|---|---|
| FR-J-1 | **Jurnal umum** (baca): filter sumber (MANUAL, PEMBAYARAN_ORDER, PENGELUARAN, …), status, cari; detail baris debit/kredit per akun; tautan `reversalOf/reversedBy` | `GET /finance/journal`, `/journal/:id` |
| FR-J-2 | **Buku besar** per akun: pilih akun (cari kode/nama), periode, saldo berjalan | `GET /reports/ledger/:accountId`, `GET /accounts` |
| FR-J-3 | **Rekonsiliasi**: daftar statement per rekening; detail baris; **cocokkan** ke baris jurnal, **batal cocok**, **abaikan**; selesaikan statement (`FINANCE_APPROVE`) | `/finance/bank-statements…`, `/bank-lines/:id/match…` |
| FR-J-4 | **Data belum lengkap** (posting gap): daftar penyebab; tombol **coba lagi** (`FINANCE_POST`) | `GET /finance/gaps`, `POST /gaps/:id/retry` |
| FR-J-5 | Status periode (baca): terbuka/terkunci + catatan | `GET /finance/periods` |

### 5.8 Laporan (FR-L)

| ID | Kebutuhan | API |
|---|---|---|
| FR-L-1 | Enam laporan: **Laba Rugi**, **Neraca**, **Arus Kas**, **Neraca Saldo**, **Umur Piutang**, **Umur Utang** — struktur & angka **persis** respons server (Pendapatan − Retur → Laba Kotor → Laba Bersih, dst.) | `/finance/reports/*` |
| FR-L-2 | Semua laporan menampilkan **catatan laporan** (saldo awal, gap) dan indikator `seimbang` (neraca/neraca saldo); jika `seimbang=false` tampil peringatan darurat | `catatan`, `ringkasan.seimbang` |
| FR-L-3 | Pemilih periode + perbandingan tidak dihitung klien (perbandingan periode: server, G-13) | — |
| FR-L-4 | Ekspor: bagikan CSV (serialisasi baris yang sedang tampil) & gambar ringkasan; PDF server 1.1 | §8.7, G-11 |
| FR-L-5 | Visual: kartu ringkas + daftar akun (kode, nama, nilai) dapat di-expand per kelompok; chart hanya untuk data yang sudah dihitung server | — |

### 5.9 Lainnya: notifikasi, pencarian, pengaturan lokal (FR-M)

Lihat §8–§9. Pengaturan lokal: tema (Sistem/Terang/Gelap), Efek Ringan, sembunyikan angka, PIN/biometrik/auto-lock,
perangkat & sesi, bahasa (hanya Indonesia), versi & bantuan.

---

## 6. Navigasi dan peta layar

### 6.1 Struktur navigasi

Bottom navigation **5 tab** (label Bahasa Indonesia, sesuai permintaan produk). Tab yang tidak relevan bagi
capability pengguna **disembunyikan/disederhanakan**, bukan dinonaktifkan.

```
┌ Beranda ┬ Transaksi ┬ Persetujuan ┬ Laporan ┬ Lainnya ┐
```

| Tab | Isi | Pengguna utama | Badge |
|---|---|---|---|
| **Beranda** | Posisi keuangan, rekening, aksi cepat, perlu tindakan | semua | — |
| **Transaksi** | Catat & lihat: Terbukukan · Pengeluaran · Pembelian · Kasbon · Pembayaran · Pemasukan · Transfer | Finance, Accountant | jumlah pembayaran menunggu verifikasi |
| **Persetujuan** | Inbox approval gabungan | Approver, Owner, Finance | jumlah menunggu |
| **Laporan** | 6 laporan keuangan + ekspor | Owner, Accountant | — |
| **Lainnya** | Kas & Bank, Piutang & Refund, Invoice, Supplier & Utang, Jurnal, Buku Besar, Rekonsiliasi, Data Belum Lengkap, Tinjau Bukti, Periode, Keamanan, Tampilan, Perangkat, Bantuan, Keluar | semua | data belum lengkap |

- **FAB "+" kanan-bawah, di atas tab bar** (keputusan implementasi: posisi tengah menimpa tab Persetujuan) hadir di **Beranda & Transaksi**:
  membuka *sheet aksi cepat* (Foto Nota, Pengeluaran, Pembelian, Kasbon, Transfer, Pemasukan). Bukan tab kelima.
- Persona **Approver**: tab Transaksi & Laporan menampilkan mode baca-saja; **Persetujuan** menjadi tab awal.
- Persona **Owner**: tab awal Beranda; Persetujuan menonjol lewat kartu "Perlu Tindakan".
- Navigasi mendalam memakai *back stack* per tab (state tab dipertahankan). Tombol back sistem & gestur back
  prediktif Android 14+ didukung.
- **Deep link** dari push: `sanofinance://approval/{jenis}/{id}`, `sanofinance://payment/{id}`, `sanofinance://expense/{id}`.
  Bila terkunci (PIN), buka layar kunci lalu lanjut ke tujuan.

### 6.2 Inventaris layar

Kode layar dipakai di user flow, tes, dan slice (§19).

| Kode | Layar | Tab/Asal | MVP |
|---|---|---|---|
| **A1** | Splash + cek versi/maintenance | — | ✔ |
| **A2** | Login (email + password) | — | ✔ |
| **A3** | Buat PIN 6 digit | setelah login pertama | ✔ |
| **A4** | Aktifkan biometrik (opsional) | setelah PIN | ✔ |
| **A5** | Layar kunci (PIN/biometrik) | buka app / kembali dari background | ✔ |
| **A6** | Sesi berakhir / dicabut | 401 | ✔ |
| **H1** | Beranda | Beranda | ✔ |
| **H2** | Pusat notifikasi | ikon lonceng | ✔ |
| **H3** | Pencarian global | ikon kaca pembesar | ✔ |
| **T1** | Transaksi (segmen + daftar) | Transaksi | ✔ |
| **T2** | Sheet filter (glass) | T1/daftar lain | ✔ |
| **T3** | Detail Pengeluaran | T1 | ✔ |
| **T4** | Form Pengeluaran | FAB/T1 | ✔ |
| **T5** | Detail Pembelian | T1 | ✔ |
| **T6** | Form Pembelian | FAB/T1 | ✔ |
| **T7** | Kasbon: daftar per karyawan | T1 / Lainnya | ✔ |
| **T8** | Detail Kasbon (riwayat potong) | T7 | ✔ |
| **T9** | Form Kasbon | FAB/T7 | ✔ |
| **T10** | Form Potong Gaji | T8 | ✔ |
| **T11** | Form Pemasukan Lain | FAB | ✔ |
| **T12** | Form Transfer Kas | FAB / K2 | ✔ |
| **T13** | Kamera / Galeri / Share-target foto nota | dari form | ✔ |
| **T14** | Sheet Alasan (batal/koreksi/tolak/belum lunas) | umum | ✔ |
| **T15** | Sheet Bayar (reimburse/utang) | T3/T5 | ✔ |
| **T16** | Penampil foto bukti (zoom) | umum | ✔ |
| **T17** | Linimasa audit dokumen | T3/T5/T8/AP2 | ✔ |
| **P1** | Pembayaran & Verifikasi (4 tab: Lunas di CRM / Menunggu / Sudah / Semua) | Transaksi→Pembayaran / Beranda | ✔ |
| **P2** | Sheet Verifikasi (rekening, cara bayar, tanggal, nominal, bukti) | P1 | ✔ |
| **P3** | Detail Pembayaran | P1 | ✔ |
| **P4** | Hasil verifikasi massal | P1 | ✔ |
| **AP1** | Inbox Persetujuan | Persetujuan | ✔ |
| **AP2** | Detail Persetujuan | AP1 / push | ✔ |
| **AP3** | Sheet Setujui (konfirmasi + step-up) | AP2 | ✔ |
| **AP4** | Sheet Tolak (alasan) | AP2 | ✔ |
| **K1** | Kas & Bank (daftar rekening) | Lainnya / H1 | ✔ |
| **K2** | Detail Rekening (mutasi) | K1 | ✔ |
| **R1** | Piutang (umur) | Lainnya | ✔ |
| **R2** | Detail piutang order | R1 | ✔ |
| **R3** | Invoice & Jatuh Tempo | Lainnya | ✔ |
| **R4** | Penampil PDF invoice | R3 | ✔ |
| **R5** | Refund (daftar) | Lainnya | ✔ |
| **R6** | Form Refund | R5 | ✔ |
| **S1** | Supplier & Utang (umur + supplier) | Lainnya | ✔ |
| **S2** | Detail Supplier | S1 | ✔ |
| **S3** | Tagihan Supplier (daftar/detail) | S1 | ✔ |
| **S4** | Form Tagihan | S3 | ✔ |
| **S5** | Form Bayar Tagihan | S3 | ✔ |
| **J1** | Jurnal Umum (daftar) | Lainnya / H1 | ✔ baca |
| **J2** | Detail Jurnal | J1 | ✔ |
| **J3** | Buku Besar | Lainnya | ✔ |
| **J4** | Rekonsiliasi (daftar statement) | Lainnya | ✔ |
| **J5** | Detail Statement + pencocokan | J4 | ✔ |
| **J6** | Data Belum Lengkap | Lainnya | ✔ |
| **J7** | Status Periode | Lainnya | ✔ baca |
| **B1** | Tinjau Bukti (antrean) | Lainnya | ✔ |
| **L1** | Hub Laporan | Laporan | ✔ |
| **L2** | Laba Rugi | L1 | ✔ |
| **L3** | Neraca | L1 | ✔ |
| **L4** | Arus Kas | L1 | ✔ |
| **L5** | Neraca Saldo | L1 | ✔ |
| **L6** | Umur Piutang | L1/R1 | ✔ |
| **L7** | Umur Utang | L1/S1 | ✔ |
| **L8** | Sheet Ekspor/Bagikan | L2–L7, daftar | ✔ |
| **M1** | Menu Lainnya | Lainnya | ✔ |
| **M2** | Keamanan (PIN, biometrik, auto-lock, sembunyikan angka) | M1 | ✔ |
| **M3** | Tampilan (tema, Efek Ringan, ukuran teks) | M1 | ✔ |
| **M4** | Perangkat & Sesi | M1 | ✔ |
| **M5** | Tentang & Bantuan | M1 | ✔ |

Total **±62 layar/sheet**; kebanyakan berbagi komponen (daftar+filter, detail dokumen, sheet alasan, form berkolom).

---

## 7. Detail layar utama dan user flow

### 7.1 Layar kunci komponen (dipakai ulang)

| Komponen | Perilaku |
|---|---|
| `GlassCard` | Kartu translucent (lihat §10.3). Varian: hero, biasa, kaca-gelap (untuk mode gelap) |
| `MoneyText` | Menampilkan `Rp 1.234.567` dengan **angka tabular**; `sembunyikan angka` → `Rp ••••••`; desimal (jika ada) redup ala referensi |
| `StatusBadge` | Pemetaan status enum → label + warna: `MENUNGGU_APPROVAL` "Menunggu persetujuan" (amber), `DISETUJUI` "Disetujui" (biru), `DIBAYAR` "Dibayar" (hijau), `DITOLAK` (merah), `DIBATALKAN` (abu), dsb. |
| `FilterBar` | Kolom cari + chip filter bergaya glass; ringkasan "12 dari 40"; tombol atur ulang |
| `ReasonSheet` | Bottom sheet alasan wajib (min 3 huruf), tombol konfirmasi tidak aktif sampai valid |
| `ReceiptPicker` | Tiga sumber: Kamera, Galeri, **Tempel/Share dari WhatsApp**; pratinjau; kompres; progres unggah; hapus/ganti (ganti butuh alasan bila dokumen sudah tersimpan) |
| `AccountChips` | Pilih rekening dengan chip besar (tinggi ≥ 48dp) |
| `EmptyState`/`ErrorState`/`Skeleton` | Standar §8 |

### 7.2 Flow: Finance mencatat pengeluaran dari foto nota (G1)

1. Bawahan lapor via WhatsApp → Natasha menekan foto → **Bagikan → "SANO Finance"** (share-target) **atau** buka app → FAB → **Foto Nota**.
2. **T13** menerima foto → kompres di perangkat (§9.3) → unggah (`POST /receipts/upload`), tampil peringatan bila foto sudah dipakai dokumen lain.
3. **T4** terbuka dengan foto terpasang; pengguna mengisi nominal, keterangan, kategori (dengan pencarian), divisi, mode (default **Langsung**), rekening (chip). Kategori/rekening yang sering dipakai diurutkan di atas (urutan lokal murni preferensi UI).
4. Tekan **Simpan** → *command* dikirim dengan `Idempotency-Key` (G-07) → tombol jadi *loading*, dobel-tap diabaikan.
5. Server memutuskan: di bawah ambang → langsung `DISETUJUI/DIBAYAR` + jurnal; di atas ambang → `MENUNGGU_APPROVAL`. App menampilkan **status resmi dari respons**, bukan tebakan.
6. Toast + haptic sukses; opsi "Catat lagi". Error 4xx tampil **pesan server apa adanya** (sudah berbahasa Indonesia), field-level bila memungkinkan.

### 7.3 Flow: Owner menyetujui dari notifikasi (G2)

1. Push "Pengeluaran Rp 2.500.000 menunggu persetujuan — Natasha" (§9.1).
2. Tap → (kunci PIN/biometrik jika perlu) → **AP2** langsung terbuka (deep link).
3. Owner memeriksa bukti (T16), mode, kategori; menekan **Setujui** → **AP3** konfirmasi + **step-up** (§11.5) → `POST /expenses/:id/approve`.
4. Sukses → layar hasil "Disetujui · Jurnal JRN-…" (nomor dari respons) → kembali ke inbox pada item berikutnya.
5. **Tolak** → **AP4** alasan wajib → `POST …/reject`.
6. Jika 409 (sudah diputuskan) → kartu informasi "Sudah diputuskan oleh {nama}".

### 7.4 Flow: verifikasi pembayaran Lunas di CRM (G3)

1. **P1 → tab Lunas di CRM**: daftar order "Perlu dicek" (kartu: no. order, pelanggan, sales, ditandai lunas kapan, nilai).
2. Buka mobile banking → lihat uang masuk → kembali → tap **Verifikasi** → **P2**.
3. P2: pilih rekening (chip: SANOBANK Kemal / PT Sano / …), cara bayar, tanggal, nominal, tempel foto bukti (screenshot m-banking dari galeri).
4. **Verifikasi** → server membuat Payment + verifikasi + jurnal → item hilang dari antrean setelah re-fetch.
5. Bila uang belum masuk: **Belum Lunas** → alasan → status order kembali.
6. Jenis **Lunas sebelum 18 Sep 2026**: P2 langsung menampilkan penjelasan singkat ("Uangnya sudah termasuk di saldo bank asli yang dimasukkan pada tanggal itu, jadi saldo rekening tidak ditambah lagi") — tanpa rekening/foto.

### 7.5 Flow: kasbon

1. FAB → **Kasbon** → T9: nama karyawan (autocomplete dari server: `GET /kasbon/karyawan-nama`), nominal, **urgensi** (wajib), rekening sumber, bukti.
2. Jika melewati batas kasbon aktif → server `422 kodeBatas` → dialog "Melewati batas Rp X. Lanjutkan?" hanya untuk pemegang `FINANCE_ADMIN`; lainnya hanya melihat penolakan.
3. Saat gajian: T8/T10 **Potong Gaji** (nominal ≤ sisa; server menolak lebih).
4. Teks bantuan tetap: "Kasbon = gaji dicairkan lebih awal. Tidak dikembalikan — dipotong dari gaji. Uang keluar dari rekening; biaya gaji dicatat saat dipotong."

### 7.6 Flow: rekonsiliasi (Accountant)

1. **J4** pilih statement → **J5**: daftar baris `BELUM_COCOK` di atas.
2. Tap baris → sheet kandidat jurnal (dari endpoint match server) → **Cocokkan** / **Abaikan** (alasan) / **Batal cocok**.
3. Semua tercocok/dijelaskan → **Selesaikan** (butuh `FINANCE_APPROVE`) → status `SELESAI`.

### 7.7 Beranda (H1) — tata letak

Urutan (atas ke bawah), mengacu ketiga referensi:
1. Header: sapaan "Halo, {nama}" + periode + lonceng + ikon cari; ikon mata (sembunyikan angka).
2. **Hero glass**: Total Kas & Bank; chip delta hanya jika server menyediakan pembanding (G-13) — jika tidak, chip **tidak ditampilkan** (jangan hitung sendiri).
3. **Carousel rekening** (kartu glass, mengacu `vaulta-home-cards.png`).
4. **Aksi cepat** (grid 4×2 dalam panel translucent).
5. **Perlu Tindakan** (kartu berwarna: Persetujuan N · Verifikasi N · Data belum lengkap N).
6. **KPI periode** (Laba Bersih, Piutang, Utang) dengan bar tren 6 bulan (G-09) dan ring komposisi piutang.
7. **Jurnal terakhir** (daftar 8, mengacu "Latest Transactions").
8. Banner **Catatan laporan** bila `catatan.pesan` tidak kosong.

---

## 8. State standar, pencarian, filter, ekspor

### 8.1 Loading

- **Skeleton shimmer** (bukan spinner penuh) untuk daftar/kartu; tinggi mengikuti konten akhir (tanpa layout shift).
- Tombol aksi: *loading in-button*, dinonaktifkan selama command berjalan; **tidak ada** optimistic status keuangan.
- Batas waktu jaringan: connect 10 dtk, read 30 dtk (unggah foto 90 dtk). Setelah itu → error jaringan dengan tombol **Coba lagi**.

### 8.2 Kosong (contoh teks)

| Layar | Judul | Deskripsi |
|---|---|---|
| Persetujuan | "Tidak ada yang menunggu" | "Semua pengajuan sudah diputuskan." |
| P1 · Lunas di CRM | "Semua sudah dicek" | "Tidak ada order lunas yang menunggu verifikasi uang masuk." |
| Pengeluaran (terfilter) | "Tidak ada yang cocok" | "Ubah kata kunci atau atur ulang filter." + tombol Atur ulang |
| Kasbon | "Belum ada kasbon aktif" | — |
| Notifikasi | "Belum ada notifikasi" | — |
| Laporan (tanpa transaksi) | "Belum ada transaksi di periode ini" | tampilkan `catatan` |

### 8.3 Error

| Kondisi | Perilaku |
|---|---|
| Tanpa jaringan | Banner "Tidak ada koneksi — menampilkan data {waktu}" bila ada snapshot; aksi ubah data **dinonaktifkan** dengan tooltip |
| 400/422 | Tampilkan `error` dari server di field/sheet; data input **tetap** (tidak hilang) |
| 401 | Coba refresh sesi sekali (§11.3); gagal → A6 "Sesi berakhir", kembali ke login; **draft form lokal dipertahankan** |
| 403 | Layar "Anda tidak punya akses" + tombol kembali; `capabilities` di-refresh |
| 404 | "Data tidak ditemukan / sudah dihapus" + muat ulang daftar |
| 409 | "Data sudah berubah" (mis. sudah diputuskan/diverifikasi) → dialog "Muat ulang" — **tidak** mencoba ulang otomatis |
| 5xx | "Server sedang bermasalah" + Coba lagi + kode request-id kecil (untuk dilaporkan) |
| Maintenance/versi lama | Layar penuh dari `mobile/config` (G-17) |

### 8.4 Hasil parsial

Verifikasi massal: dialog hasil "5 berhasil, 1 gagal" + alasan gagal per order; yang berhasil tidak diulang.

### 8.5 Pull-to-refresh & sinkronisasi

Semua daftar mendukung tarik-untuk-muat-ulang; kembali ke foreground > 60 dtk → muat ulang senyap; setelah command sukses → muat ulang entitas yang berubah + hitungan badge.

### 8.6 Pencarian & filter (FR-S)

| ID | Kebutuhan |
|---|---|
| FR-S-1 | Setiap daftar transaksi memiliki kolom cari (debounce 300 ms) memakai `q`/`search` server bila ada; sisanya filter klien atas baris yang sudah dimuat |
| FR-S-2 | Normalisasi angka: `150.000` cocok `150000` (perilaku web `cocok()`), pencarian tidak sensitif huruf besar |
| FR-S-3 | **Filter glass**: sheet setengah layar berbahan translucent; chip kategori/divisi/status/mode/rekening/metode/ada-tanpa bukti/periode; jumlah filter aktif tampil di ikon; **Atur ulang** |
| FR-S-4 | Ringkasan hasil ("12 dari 40 · Rp 3,2 jt") — angka total hasil filter **dari server** bila tersedia (`total` di respons), jika tidak, hanya jumlah baris |
| FR-S-5 | **Pencarian global (H3)** MVP: mencari nomor dokumen (`EXP-`, `PUR-`, `KSB-`, `TRF-`, `INV-`, nomor order) dengan memanggil daftar terkait paralel; endpoint terpadu di G-18 (1.1) |
| FR-S-6 | Filter terakhir per daftar diingat selama sesi (bukan disimpan setelah logout) |

### 8.7 Ekspor & berbagi (FR-X)

| Jenis | MVP | Catatan |
|---|---|---|
| PDF Invoice | ✔ | Unduh `GET /orders/:id/invoice/pdf` (Bearer) → simpan ke cache app (`expo-file-system`) → Share Sheet (`expo-sharing`) |
| CSV daftar | ✔ | Serialisasi **apa adanya** baris yang tampil (tanpa perhitungan baru); nama berkas `sano-{daftar}-{from}_{to}.csv`; kolom sesuai layar |
| Gambar ringkasan laporan | ✔ | Tangkapan layar komposisi laporan (dengan cap "per {waktu}" dan catatan laporan) |
| PDF/Excel laporan resmi | 1.1 | Dibuat server (G-11) supaya angka identik dengan web |
| Aturan | — | Berkas ekspor hanya di cache privat; dihapus saat logout; diberi peringatan "berisi data keuangan" sebelum dibagikan |

---

## 9. Notifikasi, audit trail, lampiran bukti

### 9.1 Notifikasi

Kondisi nyata: **belum ada** event notifikasi finance di backend dan push yang ada hanya Expo/Web Push (F9).
Solusi (G-10): fondasi **sudah dibuat di S0** — `POST /api/mobile/devices` (token `expo` atau `fcm`), `services/financeNotifications.js`
(dispatch, aman by default: mati kecuali `FINANCE_PUSH_ENABLED=true`). Aplikasi 1.0 memakai **Expo Push** (`expo-notifications`) — server tidak butuh kredensial
untuk token Expo; kunci FCM V1 diunggah ke EAS. **Pemicu** di route finance (submit/approve/verifikasi) dipasang di S11; pusat notifikasi dalam app = tabel baru di S11.

| Event (dibuat server) | Penerima | Isi | Aksi (deep link) |
|---|---|---|---|
| Pengajuan baru `MENUNGGU_APPROVAL` (pengeluaran/pembelian/tagihan/refund) | pemegang `FINANCE_APPROVE` **selain pengaju** | "Pengeluaran Rp 2.500.000 menunggu persetujuan — {pengaju}" | `approval/{jenis}/{id}` |
| Pengajuan diputuskan (setuju/tolak) | pengaju | "Disetujui/ditolak: {nomor}" (+ alasan penolakan) | dokumen |
| Order ditandai Lunas oleh sales (tanpa catatan uang) | pemegang `PAYMENT_WRITE` | ringkasan **digest** ("3 order menunggu verifikasi") maksimal 1 push / 30 menit | `payment` |
| Pembayaran menunggu verifikasi > 24 jam | pemegang `PAYMENT_WRITE` | pengingat harian 09:00 WIB | `payment` |
| Approval menunggu > 24 jam | approver | pengingat harian | `approval` |
| Data belum lengkap baru (gap posting) | Accountant/Finance | "Ada transaksi yang belum bisa dibukukan" (digest harian) | `gaps` |
| Periode ditutup/dibuka | Owner | informasi | `periode` |

Aturan:
- **Privasi isi push**: jumlah uang **tidak ditampilkan** di layar terkunci (`visibility=PRIVATE`; versi publik "Ada pengajuan menunggu persetujuan"). Nominal hanya di dalam app setelah unlock. (Toggle "tampilkan nominal di notifikasi" default **mati**.)
- Channel Android: `approval` (penting, bunyi), `pembayaran` (default), `pengingat` (rendah), `sistem`.
- Pengguna bisa mematikan per channel; **penonaktifan tidak mengubah izin**.
- Pusat notifikasi (H2) membaca dari server (`GET /finance/notifications`, G-10), status baca disinkronkan.
- Notifikasi **tidak pernah membawa perintah**; tap hanya membuka layar, keputusan tetap manual + step-up.

### 9.2 Audit trail

| Kebutuhan | Detail |
|---|---|
| Linimasa per dokumen (T17) | Peristiwa dari `ActivityEvent`: dibuat, diajukan, disetujui/ditolak, dibayar, diedit (dengan `alasan`), bukti diganti/diverifikasi, dibatalkan/koreksi, jurnal dibuat/di-reverse |
| Isi baris | waktu (WIB), aktor (nama), aksi (kata kerja Indonesia), alasan bila ada, perubahan sebelum→sesudah bila tersedia; penanda **"menyetujui pengajuan sendiri"** bila ada |
| Sumber | `GET /finance/audit?entityType=&entityId=&cursor=` (G-05) — endpoint `/api/activity` existing menolak `fin_*` (F10) |
| Audit sisi aplikasi | Server mencatat **perangkat** (id, model, versi app) pada login/refresh & command sensitif (G-01) |
| Retensi | Mengikuti server; app tidak menyimpan riwayat audit secara lokal |

### 9.3 Lampiran bukti (foto nota, bukti transfer)

| Aspek | Keputusan |
|---|---|
| Sumber | Kamera & Galeri (`expo-image-picker`; Photo Picker Android, tanpa izin storage luas), **Share dari WhatsApp/galeri** (`expo-share-intent`: intent `ACTION_SEND`/`SEND_MULTIPLE` `image/*`; wajib development build/EAS build, **tidak jalan di Expo Go**) dan **tempel gambar dari clipboard** (`expo-clipboard`) |
| Kompres di perangkat | `expo-image-manipulator`: sisi panjang maks **1600 px**, JPEG kualitas ~80, target < 400 KB (menyerupai kompres WhatsApp yang diminta pengguna: irit storage & tidak berat dibuka). Server tetap mengompres ulang (`simpanFotoBukti`) dan menjadi acuan |
| Unggah | `multipart/form-data` field **`receipt`**, endpoint `POST /finance/receipts/upload`; progres + batal; ulang otomatis 2× untuk kegagalan jaringan (aman — mengunggah foto **bukan** command finansial dan idempoten oleh nama = hash konten) |
| Validasi klien | Hanya gambar; tolak file > 25 MB sebelum kompres |
| Duplikasi | Respons `dipakaiDi[]` → tampilkan peringatan "Foto ini sudah dipakai di EXP-… ". Boleh lanjut (kebijakan sama dengan web) |
| Ganti/lepas | Bila dokumen sudah tersimpan → wajib alasan (`POST …/bukti` server menegakkan) |
| Tampilan | Thumbnail `_t.jpg` di daftar; gambar penuh di penampil zoom (`expo-image` dengan header `Authorization: Bearer`; cache dibersihkan saat logout) |
| Keamanan | Foto nota **tidak** disimpan ke Galeri; file sementara di cache privat dan dihapus setelah unggah. **Akses media sudah terlindungi di backend (S0, G-08 selesai)**: `GET /media/finance-receipts/<file>` atau `GET /api/finance/media/receipts/<file>` dengan Bearer; URL bertanda-tangan lewat `POST /api/finance/media/sign` (10 menit) untuk komponen yang tak bisa mengirim header |
| Draft offline | Foto yang diambil saat offline disimpan **sebagai draft lokal** (bukan command); pengguna mengunggah & menyimpan setelah online |

---

## 10. Desain visual, interaksi, dan performa

### 10.1 Bahasa desain: "Biru Kaca" (Apple-style, bukan salinan iOS)

- **Karakter**: tenang, presisi, premium. Latar gradien biru halus, kartu translucent berbatas rambut (hairline) terang,
  bayangan lembut berlapis, sudut membulat besar, banyak ruang napas. Angka uang adalah **bintang visual**.
- **Dilarang**: Dynamic Island, notch/status bar palsu, ikon SF Symbols, tab bar iOS persis, logo VISA/Mastercard,
  gaya "bounce" khas iOS yang tidak natural di Android. Gunakan gestur & pola Android (back prediktif, edge-to-edge).
- Referensi → §4.4.

### 10.2 Token desain

| Token | Terang | Gelap |
|---|---|---|
| `bg` (dasar layar) | gradien `#F3F7FD → #E4EEFB` | gradien `#0A1730 → #0E2A55` |
| `glass-fill` | `#FFFFFF` α 0.62 | `#5B8FE0` α 0.14 (di atas bg gelap) |
| `glass-stroke` | `#FFFFFF` α 0.85 (1 dp) | `#FFFFFF` α 0.16 |
| `glass-shadow` | `#123655` α 0.10, blur 24 dp, y 8 dp | `#000000` α 0.35 |
| `primary` | `#2064B7` (brand-600) | `#4F97E3` (brand-400) |
| `on-primary` | `#FFFFFF` | `#0A1730` |
| `success` / `warning` / `danger` | `#16A34A` / `#F59E0B` / `#DC2626` | versi lebih terang (kontras AA di atas glass) |
| `text-strong` / `text-muted` | `#0F1E3A` / `#5B6B85` | `#F2F6FF` / `#9DB0D0` |
| Hero "navy" | gradien `#164476 → #123655` | gradien `#1B4B8F → #0F2F5E` |

- Kontras minimum **WCAG AA** (4.5:1 teks, 3:1 komponen) diuji di **kedua tema di atas glass** (glass memudarkan kontras — teks di atas glass memakai `text-strong` ditambah scrim bila perlu).
- Dark/light: **Ikuti sistem** (default) | Terang | Gelap; Material You dinamis **tidak dipakai** (identitas merek diutamakan).
- Tipografi: **Inter** (sama dengan app Expo Sano) variabel, subset Latin; angka **tabular** (`tnum`) untuk semua nominal; skala: hero 40/44 (Semibold), judul 22, kepala kartu 16 (Semibold), isi 14, keterangan 12. Mendukung skala font sistem s.d. 200% (layout tidak boleh patah).
- Sudut: kartu 24 dp, sheet 28 dp, chip 999 dp, tombol 16 dp. Ikon: `lucide-react-native` (garis 1.75, sama dengan app Sano lain).
- Tinggi target sentuh ≥ **48 dp**.

### 10.3 Material glass — implementasi bertingkat (penting untuk Android lama)

| Tier | Kondisi | Teknik |
|---|---|---|
| **FULL** | Android 12+ (API 31+), RAM ≥ 4 GB (`expo-device.totalMemory`), "Efek Ringan" mati | `expo-blur` (`BlurView`) **hanya pada ≤ 2 permukaan per layar** (hero + sheet/filter); sisanya translucent |
| **LITE** | API 26–30, RAM rendah, atau Efek Ringan hidup | **Tanpa blur**: isi translucent + `expo-linear-gradient` halus + hairline + bayangan ringan |
| **MINIMAL** | Mode hemat daya / animasi sistem dimatikan | Kartu solid dengan hairline, tanpa bayangan berlapis |

- Tier dipilih **otomatis saat pertama jalan** (`src/design/glass.ts`) + bisa diubah manual di M3 (Efek Ringan); pilihan disimpan.
- **Tidak boleh** ada `BlurView` di dalam item daftar yang di-scroll (FlatList/FlashList). Kartu daftar memakai fill translucent murah.
- Latar layar = satu `LinearGradient` statis di root (bukan bitmap); bayangan memakai `elevation` Android + `boxShadow` sederhana.
- Semua warna berasal dari token (`src/design/tokens.ts`), tidak ada warna literal di layar.

### 10.4 Animasi & haptic

| Elemen | Spesifikasi |
|---|---|
| Transisi layar | Bawaan Expo Router/React Navigation (native stack, ±220 ms); gestur back sistem didukung |
| Kartu masuk | Fade+translate 12 px, *stagger* 30 ms, maks 6 item (`Animated` core, `useNativeDriver`) |
| Angka uang | Tanpa hitung ulang; *fade/slide* singkat saat data pertama kali tampil (angka akhir selalu dari server) |
| Tombol | Tekan: skala 0.97 (`PressableScale`) |
| Sheet | Modal kustom dengan *spring* redam sedang; *drag handle* |
| Chart | Gambar-tumbuh 500 ms sekali (SVG) |
| Haptic (`expo-haptics`) | `notificationAsync(Success)` saat approve/verifikasi sukses; `Error` saat galat/penolakan; `selectionAsync` saat ganti tab & toggle; **tidak** ada haptic pada scroll |
| Aksesibilitas gerak | Hormati `AccessibilityInfo.isReduceMotionEnabled` — semua animasi non-esensial mati |
| Frame budget | 60 fps stabil pada perangkat acuan; jank > 5% frame = gagal tes performa (§18) |

### 10.5 Anggaran performa & perangkat

| Metrik | Target |
|---|---|
| Android minimum | **Android 8.0 (API 26)** (default Expo SDK 57 dapat menaikkan minimum — dicek saat `expo-doctor`; bila SDK menuntut lebih tinggi, angka ini diikuti SDK) |
| Perangkat acuan bawah | 3 GB RAM, Android 9, SoC kelas Helio G-series |
| Cold start → Beranda terisi | ≤ 3,5 dtk (4G, build rilis), ≤ 2 dtk ke layar kunci |
| Ukuran APK (release) | ≤ 45 MB (universal); target arm64-only ≤ 30 MB |
| Memori puncak Beranda | ≤ 250 MB |
| Scroll daftar 300 baris | ≥ 55 fps (FlashList), tanpa alokasi berlebih |
| Kompilasi | Hermes bytecode, Proguard/shrink/minify rilis (`expo-build-properties`), `transform-remove-console` di produksi |
| Pembaruan | Bundel JS ≤ 6 MB agar OTA cepat |

---

## 11. Autentikasi, sesi, dan keamanan aplikasi

### 11.1 Ancaman yang dipertimbangkan

HP hilang/dicuri saat login · HP dipinjam orang lain · malware/root membaca penyimpanan · penyadapan jaringan
(WiFi publik) · shoulder-surfing · screenshot/layar-rekam · token bocor lewat log/backup · karyawan resign yang
sesinya masih hidup · tekan-ganda/replay command · kredensial ditebak (tanpa rate-limit di server sekarang, F3).

### 11.2 Login

- Email + password akun SANSS (bcrypt di server, `POST /auth/login` existing). Pesan galat generik ("Email atau password salah").
- Kolom password: tombol lihat, `autofill` password manager; tidak ada "ingat password" di app.
- Setelah login pertama di perangkat: **wajib membuat PIN** (A3), **biometrik opsional** (A4).
- **Akses hanya untuk tim finance**: bila `capabilities` tidak memuat satupun dari `finance.read/approve/post`, login berakhir dengan layar
  "Aplikasi ini untuk tim Finance". (Orang divisi yang hanya punya `FINANCE_EXPENSE_SUBMIT` tidak termasuk MVP.)
- Verifikasi 2 langkah (TOTP) → non-MVP, dicatat di §20.

### 11.3 Sesi (kontrak baru — G-01, G-02, G-03)

Sesi 7-hari existing (F1, F2) **tidak layak** untuk aplikasi keuangan. Dibuat jalur sesi **khusus mobile** yang
tetap memakai `requireAuth`/`requirePermission` existing (access token sama-format), agar seluruh route finance
tidak perlu diubah:

| Elemen | Ketentuan |
|---|---|
| Access token | JWT dengan `JWT_SECRET` yang sama, payload existing `{id,name,role,roles}` **+** `typ:"mobile"`, `sid` (id sesi). **Umur 15 menit** |
| Refresh token | Acak 256-bit, **disimpan hash-nya** di tabel `mobile_sessions`; **rotasi setiap dipakai**; pemakaian ulang token lama ⇒ seluruh sesi dicabut (deteksi pencurian) |
| Ikatan perangkat | `deviceId` (UUID lokal, dibuat saat instal), label perangkat, versi app; maksimal **2 sesi aktif/pengguna** (yang terlama dicabut) |
| Masa berlaku | Idle 14 hari, absolut 60 hari, lalu login ulang |
| Cek akun | Setiap refresh membaca DB: akun `active=false` ditolak; `roles` terbaru dimasukkan; `capabilities` dikirim ulang |
| Pencabutan | Pengguna: M4 "Keluarkan perangkat"; Admin: nonaktifkan akun ⇒ semua sesi dicabut; role berubah ⇒ sesi dipaksa refresh. Endpoint command finance memeriksa `sid` **belum dicabut** (lookup PK) ⇒ pencabutan efektif segera |
| Middleware | `requireAuth` **tidak** memberi `X-Refreshed-Token` untuk token `typ:"mobile"` (F2) |
| Rate limit | Login: 5 gagal / 15 menit per (email+IP) → tunda bertahap; API: 120 req/menit/pengguna; unggah foto 20/menit (G-03) |
| Endpoint | `POST /mobile/auth/login`, `/refresh`, `/logout`, `GET /mobile/auth/sessions`, `DELETE /mobile/auth/sessions/:id`, `GET /mobile/config` |

**Status: SELESAI dan live di produksi (S0, 19 Sep 2026)** — dengan tes integrasi (`mobileAuth.integration.test.js`). Rincian & endpoint: `docs/FINANCE-MOBILE-BACKEND.md`.
Tambahan yang ikut dibangun: token mobile hanya berlaku untuk jalur `/api/finance`, `/api/mobile`, `/api/auth/me`, `POST /api/armada/payments/:id/verify`,
`GET /api/orders/:id/invoice/pdf`; `code` pada galat (`SESSION_REVOKED`, `REFRESH_REUSED`, …).

Klien: `apiClient` men-*refresh* satu kali untuk banyak request paralel (*single-flight*) dan menyimpan token baru ke SecureStore **sebelum** dipakai; kegagalan refresh ⇒ A6.

### 11.4 Kunci aplikasi (PIN & biometrik)

| Aspek | Ketentuan |
|---|---|
| PIN | 6 digit, dicek **lokal**, tidak pernah dikirim ke server. Verifier = PBKDF2-HMAC-SHA256 (`@noble/hashes`, iterasi **25.000**, disimpan di dalam verifier sehingga bisa dinaikkan tanpa memutus PIN lama; angka ini dipilih karena mesin Hermes menjalankan PBKDF2 murni-JS jauh lebih lambat dari native — 100.000 iterasi membekukan UI beberapa detik di HP menengah. Perlindungan utama bukan kerasnya hash, melainkan jeda percobaan (5→30 dtk, 8→5 mnt, 10→hapus data) dan Keystore) + salt acak; disimpan di `expo-secure-store` (Android Keystore) |
| Percobaan | 5 salah → jeda 30 dtk; 8 → 5 menit; 10 → **hapus sesi & data lokal**, wajib login penuh; penghitung percobaan ikut di SecureStore |
| Biometrik | `expo-local-authentication` (`biometricsSecurityLevel: "strong"`, tanpa fallback ke passcode perangkat); sukses biometrik membuka kunci layar yang sama; PIN selalu tersedia sebagai cadangan. Catatan: pengikatan kunci ke biometrik di level Keystore (`CryptoObject`) tidak tersedia di Expo → ditutup oleh G-19 (step-up server) |
| Auto-lock | Default **60 detik** setelah app ke background (pilihan: langsung / 30 dtk / 1 mnt / 5 mnt) via `AppState`. Juga saat proses app dimatikan sistem (cold start selalu terkunci) |
| Layar kunci | Tidak menampilkan angka apa pun; menampilkan nama pengguna & tombol biometrik |
| Ganti PIN | Butuh PIN lama; lupa PIN ⇒ login ulang (sesi lama dicabut) |

### 11.5 Step-up untuk aksi sensitif

Aksi **wajib** re-autentikasi (biometrik/PIN) bila unlock terakhir > **2 menit**, dan dialog konfirmasi menampilkan
nominal + tujuan dengan jelas:

`Setujui` · `Verifikasi pembayaran / order Lunas` · `Bayar (reimburse/utang/tagihan supplier)` · `Buat Refund` ·
`Transfer kas` · `Buat/potong Kasbon` · `Batalkan/Koreksi dokumen` · `Selesaikan rekonsiliasi` · `Ganti/lepas bukti`.
(Tolak, baca, dan buat draft tidak butuh step-up.)

**Keputusan yang diterima & risikonya:** MVP menegakkan step-up di **klien**. Penyerang yang sudah memegang refresh token
(mis. perangkat di-root) bisa memanggil API tanpa layar kunci. Mitigasi MVP: token di SecureStore (Android Keystore),
access token 15 menit, pencabutan sesi instan (sudah ada di S0), pengecekan integritas dasar (§11.7), notifikasi "login dari perangkat baru".
**Rilis 1.1**: step-up diverifikasi server (challenge–signature dengan kunci perangkat yang dilindungi biometrik) — G-19.

### 11.6 Jaringan

- HTTPS saja; `usesCleartextTraffic` hanya aktif di varian `development` (emulator `10.0.2.2`, lewat `expo-build-properties`). TLS ≥ 1.2.
- **Certificate pinning: tidak ada di 1.0.** Pinning di React Native membutuhkan modul native pihak ketiga (mis. `react-native-ssl-public-key-pinning`) dan
  meningkatkan risiko terkunci saat sertifikat Let's Encrypt berganti. Keputusan: dievaluasi di rilis 1.1 (pin **intermediate + ISRG Root**, bukan daun) setelah
  runbook rotasi ada. Mitigasi 1.0: HTTPS + HSTS di nginx, token berumur pendek, sesi bisa dicabut instan.
- Header `X-Request-Id` (UUID) di setiap request untuk korelasi log (G-17). Tidak mencatat body/`Authorization` (log klien menyaring header & body).

### 11.7 Penyimpanan & integritas

| Aspek | Ketentuan |
|---|---|
| Rahasia | Refresh token, access token, PIN-verifier, penghitung percobaan: **`expo-secure-store`** (Android Keystore). **Dilarang** AsyncStorage/berkas biasa untuk rahasia |
| Cache | Snapshot baca-saja dari TanStack Query yang di-*persist* ke penyimpanan lokal **terenkripsi** (kunci acak 256-bit di SecureStore; enkripsi AES-GCM `react-native-quick-crypto` atau setara) — TTL 24 jam; **dihapus** saat logout, sesi dicabut, atau PIN terkunci. Bila enkripsi belum tersedia pada slice awal: **jangan** mem-*persist* data keuangan (memori saja) |
| Backup | `android.allowBackup: false` (`expo-build-properties`) |
| Layar | `expo-screen-capture` `preventScreenCaptureAsync` di **seluruh** layar (`FLAG_SECURE`: blokir screenshot, rekam layar, thumbnail Recents) — bagikan hasil lewat fitur "Bagikan" resmi |
| Log | Build produksi menghapus `console.*` (`transform-remove-console`); tidak ada log yang memuat nominal/nama/token; pelaporan galat tanpa PII |
| Integritas | Peringatan (bukan blok) bila perangkat di-root/emulator/USB debugging, dilaporkan ke server; APK ditandatangani EAS; Play Integrity dipakai bila kelak lewat Play Store |
| Dependensi | Versi dikunci (`package-lock.json`), `npm audit` di CI, `expo-doctor`, hanya modul dengan dukungan SDK 57 |
| Overlay | Modul kecil/`filterTouchesWhenObscured` pada tombol aksi sensitif (anti-tapjacking) — dievaluasi di S12 |

---

## 12. RBAC — peran, izin, dan kemampuan

### 12.1 Kondisi backend sekarang (F5)

| Role (enum `Role`) | Izin finance yang dipegang |
|---|---|
| `FINANCE` | `FINANCE_READ, FINANCE_POST, FINANCE_APPROVE, FINANCE_EXPENSE_SUBMIT`, `PAYMENT_READ, PAYMENT_WRITE`, `INVENTORY_READ`, order/customer read (**tanpa** `FINANCE_ADMIN`) |
| `OWNER` | `ADMIN_PERMS` (termasuk `FINANCE_READ/POST/APPROVE/ADMIN`, `PAYMENT_READ`, **bukan** `PAYMENT_WRITE`) + B2B |
| `ADMIN` | Sama seperti `OWNER` tanpa B2B (Novi berperan ADMIN) |
| Sales/Produksi/Gudang/Dispatcher | hanya `FINANCE_EXPENSE_SUBMIT` |

Portal Finance: roles `["ADMIN","OWNER","FINANCE"]` (`permissions.js:415-424`). **Tidak ada `ACCOUNTANT` dan `APPROVER`.**

### 12.2 Peta persona → role backend

| Persona | Role backend | Status | Izin |
|---|---|---|---|
| **Finance** | `FINANCE` | ada | seperti tabel di atas |
| **Accountant** | `ACCOUNTANT` | **selesai (S2, 19 Sep 2026)** | `FINANCE_READ`, `FINANCE_POST` (jurnal, rekonsiliasi, transfer, catat dokumen), `PAYMENT_READ`, `DASHBOARD_READ`. **Tanpa** `FINANCE_APPROVE`, `PAYMENT_WRITE`, `FINANCE_ADMIN` |
| **Approver** | `APPROVER` | **selesai (S2, 19 Sep 2026)** | `FINANCE_READ`, `FINANCE_APPROVE`, `PAYMENT_READ`, `DASHBOARD_READ`. **Tanpa** `FINANCE_POST` (tidak bisa mencatat, hanya memutuskan) |
| **Owner** | `OWNER` | ada | `ADMIN_PERMS`; layout mobile menonjolkan baca + approve + tinjau bukti; aksi catat tetap ada tetapi tidak menjadi aksi cepat |

Pemberian peran tetap lewat halaman **Pengguna & Peran** (D-010: jangan menyimpulkan dari nama). Role baru = migrasi enum + konstanta
permission; **tidak** mengubah role existing.

### 12.3 Kemampuan (capabilities) — aplikasi tidak menyalin peta role→izin

`GET /auth/me` dan respons login/refresh mobile memuat **`capabilities`** (G-04), diturunkan server dari `hasPermission()`:

```json
{ "capabilities": {
  "financeRead": true, "financePost": true, "financeApprove": true, "financeAdmin": false,
  "paymentRead": true, "paymentWrite": true, "expenseSubmit": true,
  "preset": "FINANCE" } }
```

- UI **menampilkan/menyembunyikan** berdasarkan capability; **`preset`** hanya mengatur tata letak awal (Owner/Finance/Approver/Accountant), bukan izin.
- Server tetap penentu akhir: 403 diperlakukan sebagai kejadian normal (refresh capability, tampilkan "tidak punya akses").
- Tes: setiap layar diuji dengan **akun peran nyata**, bukan admin (pelajaran §19 CLAUDE.md: bug lolos karena semua uji memakai ADMIN).

### 12.4 Matriks aksi (MVP)

✔ = boleh · — = tidak · 👁 = baca saja · 🅢 = butuh step-up

| Aksi | Finance | Accountant | Approver | Owner |
|---|:-:|:-:|:-:|:-:|
| Beranda / laporan / jurnal / buku besar | ✔ | ✔ | 👁 (beranda ringkas) | ✔ |
| Lihat pembayaran & antrean Lunas di CRM | ✔ | 👁 | 👁 | 👁 |
| **Verifikasi pembayaran / order Lunas** (`PAYMENT_WRITE`) | ✔ 🅢 | — | — | — |
| Catat pengeluaran / pembelian / kasbon / pemasukan | ✔ 🅢 | ✔ 🅢 | — | ✔ 🅢 (bukan aksi cepat) |
| Ajukan (`MENUNGGU_APPROVAL`) | ✔ | ✔ | — | ✔ |
| **Setujui / tolak** | ✔ 🅢 (bukan pengajuan sendiri) | — | ✔ 🅢 | ✔ 🅢 |
| Setujui pengajuan **sendiri** | — | — | — | ✔ bila `FINANCE_ADMIN` (tercatat) |
| Bayar reimburse / utang / tagihan supplier | ✔ 🅢 | ✔ 🅢 | — | ✔ 🅢 |
| Transfer antar rekening | ✔ 🅢 | ✔ 🅢 | — | ✔ 🅢 |
| Buat refund | ✔ 🅢 | ✔ 🅢 | — | ✔ 🅢 |
| Batalkan / koreksi dokumen (`FINANCE_ADMIN`) | — | — | — | ✔ 🅢 |
| Verifikasi bukti (bukan pembuatnya) (`FINANCE_ADMIN`) | — | — | — | ✔ |
| Rekonsiliasi: cocokkan/abaikan | ✔ | ✔ | — | ✔ |
| Rekonsiliasi: selesaikan (`FINANCE_APPROVE`) | ✔ 🅢 | — | ✔ 🅢 | ✔ 🅢 |
| Data belum lengkap: coba lagi (`FINANCE_POST`) | ✔ | ✔ | — | ✔ |
| Tutup/buka periode, reversal jurnal, bagan akun, rekening, kategori, pengaturan | web saja | web saja | — | web saja |

Catatan: `FINANCE` memegang `POST`+`APPROVE` (tim kecil). Pemisahan sudah ada di level izin; saat tim tumbuh cukup memindahkan
peran (`FINANCE` → `ACCOUNTANT`+`APPROVER`) tanpa ubah kode aplikasi.

---

## 13. Masking data dan privasi

| Data | Aturan |
|---|---|
| Saldo & nominal | Tombol **mata** (Beranda) menyembunyikan seluruh nominal (`Rp ••••••`); preferensi disimpan; default **tampil** (bisa diatur default **sembunyi** di M2). Saat app baru dibuka setelah kunci: mengikuti preferensi |
| Nomor rekening/VA | Tampil hanya 4 digit terakhir bila ada di data; nomor lengkap **tidak** ditarik ke daftar |
| Data pribadi pelanggan | Role finance **tidak** punya `CUSTOMER_PII_READ`; server tidak mengirim nomor HP/alamat dan app tidak memintanya. Nama pelanggan tampil (dibutuhkan konteks tagihan) |
| Data karyawan (kasbon) | Nama + nominal; tidak ada data gaji lengkap di app |
| Notifikasi | Tanpa nominal di layar terkunci (§9.1) |
| Ekspor/Bagikan | Peringatan "berisi data keuangan"; berkas dihapus dari cache saat logout |
| Analitik/crash | Tanpa nominal, nama, nomor dokumen; hanya nama layar & kode galat |
| Clipboard | App tidak menyalin data finansial ke clipboard; kolom nominal menonaktifkan saran keyboard/riwayat |
| Cache | ≤ 24 jam, terenkripsi, hilang saat logout (§11.7) |

---

## 14. Perilaku offline dan larangan posting saat offline

**Aturan besi (tidak ada pengecualian):** *tidak ada command keuangan yang dikirim, diantrekan, atau ditunda saat offline*.

| Kemampuan | Offline |
|---|---|
| Lihat Beranda, daftar terakhir dibuka, laporan terakhir dibuka | ✔ **snapshot** dengan banner "Data per {tanggal jam} — tidak ada koneksi" dan **tanpa** animasi count-up; semua tombol ubah-data dinonaktifkan |
| Buka detail dokumen yang sudah pernah dimuat | ✔ baca saja |
| Setujui/tolak, verifikasi, catat, bayar, transfer, kasbon, refund, batal/koreksi | ✘ dinonaktifkan; tooltip "Butuh koneksi internet" |
| Ambil foto nota / isi form | ✔ sebagai **draft lokal terenkripsi** (maks 7 hari); **bukan** command; tampil di "Draft" dengan tombol **Kirim** yang aktif hanya saat online dan butuh konfirmasi manual |
| Snapshot dipakai untuk menghitung apa pun | ✘ (hanya ditampilkan) |

**Hasil command yang tidak pasti** (timeout/putus setelah request terkirim): app **tidak boleh** mengirim ulang membabi buta.
- Dengan `Idempotency-Key` (G-07): boleh dikirim ulang dengan **kunci yang sama** → server mengembalikan hasil pertama, bukan membuat ganda.
- Tanpa G-07 (belum tersedia): tampilkan "Status belum pasti — cek daftar {jenis} sebelum mencoba lagi", blokir tombol kirim untuk draft itu 60 detik.
- Command yang dibatalkan pengguna di tengah jalan diperlakukan sama (tidak pasti).

**Deteksi jaringan:** `ConnectivityManager.NetworkCallback` + kegagalan request nyata (koneksi "ada" tapi tak berinternet dianggap offline setelah 2 kegagalan). Foto unggahan boleh diulang otomatis (idempoten, bukan command).

---

## 15. Arsitektur mobile (React Native + Expo)

> **Keputusan produk 19 Sep 2026 (menggantikan rencana Kotlin/Compose):** aplikasi dibuat dengan **React Native + Expo (TypeScript, Expo Router)**
> di folder `finance-mobile/`, dibangun & didistribusikan lewat **EAS Build**, pembaruan lewat **EAS Update**. Alasan: satu bahasa dengan
> aplikasi `mobile/` dan `driver-mobile/` (Expo SDK 57), pemeliharaan satu orang, OTA update untuk perbaikan cepat, dan infrastruktur push Expo
> yang sudah ada di backend.

### 15.1 Stack

| Lapisan | Pilihan | Alasan / catatan |
|---|---|---|
| Runtime | **Expo SDK 57**, React Native 0.86, React 19.2, Hermes, New Architecture | Selaras `mobile/` & `driver-mobile/` (audit §15.6) |
| Bahasa | **TypeScript strict** (`noUncheckedIndexedAccess`) | Diminta; tipe DTO menjaga kontrak API |
| Routing | **Expo Router** (file-based, typed routes), deep link skema `sanofinance://` | Lima tab = `app/(tabs)/*` |
| Data server | **TanStack Query v5** (cache, refetch saat fokus, invalidasi setelah command) | Sama dengan app lain; tidak ada store global untuk data keuangan |
| State UI lokal | Zustand kecil (kunci layar, preferensi, sembunyikan angka) | Bukan sumber data keuangan |
| Jaringan | `fetch` + pembungkus `apiClient` (timeout `AbortController`, `ApiError`, refresh *single-flight*, `Idempotency-Key`, `X-Request-Id`) | Tanpa axios |
| Parsing JSON uang | **`lossless-json`**: literal angka dipertahankan, kolom uang diubah menjadi **string desimal** di batas API | JS `Number` tidak dipakai untuk uang (§15.3) |
| Penyimpanan aman | **`expo-secure-store`** (Android Keystore) untuk refresh token & verifier PIN | Bukan AsyncStorage |
| Kunci layar | `expo-local-authentication` (biometrik) + PIN 6 digit | §11.4 |
| Anti-tangkapan layar | `expo-screen-capture` (`preventScreenCaptureAsync` = `FLAG_SECURE`) | §11.7 |
| UI | React Native core + **`expo-blur`**, **`expo-linear-gradient`**, `lucide-react-native` + `react-native-svg`, `expo-image`, **`expo-haptics`** | Biru Kaca (§10). Tanpa Reanimated di awal (audit performa `driver-mobile`: biaya start-up native); animasi memakai `Animated` core |
| Foto | `expo-image-picker` (kamera/galeri) + `expo-image-manipulator` (kompres) + `expo-clipboard` (tempel gambar) + **`expo-share-intent`** (Share dari WhatsApp/galeri Android) | §9.3 |
| Push | `expo-notifications` — token **Expo Push** (`provider:"expo"`) untuk 1.0; token FCM asli (`provider:"fcm"`) didukung backend bila kelak dibutuhkan | Backend S0 mendukung keduanya |
| Pembaruan | **`expo-updates`** + EAS Update, kanal `development` / `preview` / `production` | §18.4 |
| Build | **EAS Build** (APK internal & AAB) | §18.4 |
| Uji | `jest-expo`, `@testing-library/react-native`, `tsc --noEmit`, ESLint (`eslint-config-expo`), `expo-doctor` | §18.1 |
| Observability | Sentry (`@sentry/react-native`, tanpa PII) atau setara — keputusan di S12; sementara `ErrorBoundary` + log terstruktur | §18.3 |

### 15.2 Struktur proyek `finance-mobile/`

```
finance-mobile/
  app/                         # Expo Router
    _layout.tsx                # provider (tema, query, sesi), gerbang login/kunci
    login.tsx                  # A2 (+ A3/A5/A6 pada slice S2)
    +native-intent.tsx         # tautan share dari Android → aksi-cepat
    (tabs)/_layout.tsx         # 5 tab + FAB
    (tabs)/index.tsx           # Beranda
    (tabs)/transaksi.tsx       # Transaksi
    (tabs)/persetujuan.tsx     # Persetujuan
    (tabs)/laporan.tsx         # Laporan
    (tabs)/lainnya.tsx         # Lainnya
    aksi-cepat.tsx             # sheet FAB (modal): kamera/galeri/tempel/share
    persetujuan/[id].tsx       # detail persetujuan (AP2)
    laporan/[jenis].tsx        # detail laporan (L2–L7)
    approval/[jenis]/[id].tsx  # tautan push → persetujuan/[id]
    …                          # layar detail lain ditambah per slice
  src/
    design/                    # token, GlassCard, MoneyText, StatusBadge, Sheet, tier glass
    api/                       # apiClient, ApiError, endpoint per domain, tipe DTO
    auth/                      # sesi mobile, secure storage, kunci layar (PIN/biometrik)
    lib/                       # money (string desimal), tanggal WIB, format, env
    features/                  # komponen per fitur (beranda, transaksi, persetujuan, …)
    mocks/                     # data contoh realistis (dipakai sebelum API tersambung)
    hooks/  state/
  assets/  scripts/
  app.config.ts  eas.json  babel.config.js  metro.config.js  tsconfig.json  jest.config.js  eslint.config.js
  README.md
```

### 15.3 Aturan kode yang menjaga "server sebagai sumber kebenaran"

1. **Uang = string desimal** bertipe `Money` (`"1234567.89"`). Respons server (angka JSON) di-*parse* dengan `lossless-json` dan kolom uang dikonversi ke string
   **di satu tempat** (`src/api/normalize.ts`); **command mengirim string** (`toMoney` server menerima string). Dilarang: `parseFloat`, `Number()`, `+x`,
   `toFixed` pada uang. ESLint `no-restricted-syntax` + tes `money.test.ts` menjaga ini.
2. **Tidak ada penjumlahan/pengurangan uang untuk tampilan resmi.** Yang boleh: format ribuan, memecah tampilan ("8.200" + ",28" redup), tanda +/−, singkatan
   tampilan ("Rp 1,2 jt" lewat `BigInt` khusus tampilan), urutan, geometri chart. Total selalu dari server (`total`, `ringkasan`, `totalKas`).
3. **Tidak ada enum/aturan status buatan sendiri.** Status dari string server; pemetaan label tunggal di `StatusBadge`; status tak dikenal → tampil apa adanya, netral.
4. **Tidak ada perhitungan jurnal, saldo, umur piutang, alokasi, HPP, pajak di klien.** Laporan hanya dirender dari respons `/finance/reports/*`.
5. **Command → tunggu respons → invalidasi query** (TanStack Query) agar data diambil ulang dari server. **Tidak ada optimistic update** pada data keuangan, tidak ada antrean command, tidak ada posting offline (§14).
6. Galat server ditampilkan **apa adanya** (`error` sudah Bahasa Indonesia); pemetaan `code` (`SESSION_REVOKED`, `RATE_LIMITED`, `IDEMPOTENCY_*`, …) di satu tempat.
7. Tanggal dokumen `YYYY-MM-DD` (WIB); instant ISO-UTC dirender **Asia/Jakarta** lewat satu util (bukan zona perangkat) — `CLAUDE.md` §11.
8. Seluruh teks UI **Bahasa Indonesia**; string ditaruh di `src/lib/strings.ts` (bukan tersebar) supaya mudah ditinjau.
9. Ambang/aturan bisnis dibaca dari server; app tidak menyimpan angka bisnis.

### 15.4 Lapisan data

```
Screen(app/*) ⇄ hook fitur (useQuery/useMutation) ⇄ src/api/* (apiClient) ⇄ backend SANSS
                                └─ cache snapshot baca-saja (react-query persister terenkripsi, TTL 24 jam, dihapus saat logout)
```

- `useMutation` command memakai `CommandExecutor`: cek jaringan → step-up bila perlu → `Idempotency-Key` (UUID dari `expo-crypto`, dibuat **sekali per niat pengguna** dan dipakai ulang saat mencoba lagi) → panggil → tangani hasil pasti/tidak pasti (§14) → `invalidateQueries`.
- **Refresh token** *single-flight*: banyak request paralel yang menerima 401 `TOKEN_INVALID`/kedaluwarsa menunggu satu panggilan `POST /mobile/auth/refresh`; token baru **disimpan ke SecureStore sebelum dipakai** (server mencabut sesi bila token lama dipakai ulang). Kode `SESSION_REVOKED`/`REFRESH_REUSED`/`ACCOUNT_INACTIVE` ⇒ layar A6 + hapus data lokal.
- Paginasi: kini offset/limit & `take 300` (F8); `useInfiniteQuery` dipakai begitu server menyediakan cursor (G-16). Sampai itu, daftar dimuat dengan **batas periode** + indikator "terpotong".

### 15.5 Lingkungan (dev / preview / production)

`app.config.ts` membaca `APP_VARIANT` (`development` | `preview` | `production`) dan `EXPO_PUBLIC_*` dari profil `eas.json`:

| Variabel | development | preview | production |
|---|---|---|---|
| `APP_VARIANT` | `development` | `preview` | `production` |
| `EXPO_PUBLIC_API_URL` | `http://10.0.2.2:4000/api` (emulator) / IP LAN | `https://app.sanomatrassehat.com/api` | `https://app.sanomatrassehat.com/api` |
| `EXPO_PUBLIC_USE_MOCKS` | `true` | `false` | `false` |
| Package Android | `com.sanomatrassehat.finance.dev` | `com.sanomatrassehat.finance.preview` | `com.sanomatrassehat.finance` |
| Nama | "SANO Finance (Dev)" | "SANO Finance (Preview)" | "SANO Finance" |
| Kanal EAS Update | `development` | `preview` | `production` |

Tiga varian punya package berbeda sehingga bisa **terpasang bersamaan** di satu HP. `runtimeVersion` memakai kebijakan **`fingerprint`** (hash konfigurasi native + dependensi):
OTA **tidak pernah** dikirim ke build yang native-nya berbeda — lebih aman daripada `appVersion` yang dipakai dua app lain (yang bisa lupa dinaikkan).

### 15.6 Hasil audit pola Expo di repo (yang dipakai ulang)

| Pola di `mobile/` & `driver-mobile/` | Dipakai di `finance-mobile/` |
|---|---|
| Expo SDK ~57, RN 0.86, React 19.2.3, `expo-*` ~57 | Sama persis (versi ditetapkan lewat `npx expo install`) |
| `eas.json`: profil `development` (dev client, internal), `preview` (internal), `production`, `apk`; kanal sama dengan nama profil | Dipertahankan + `env` per profil + `production-apk` |
| `app.json`: `userInterfaceStyle: automatic`, `expo-build-properties` (Proguard/shrink/minify rilis), `expo-notifications` (warna), `expo-splash-screen` | Dipertahankan (jadi `app.config.ts`) |
| `runtimeVersion.policy = appVersion`, `updates.url = https://u.expo.dev/<projectId>` | Diganti `fingerprint`; `projectId` **diisi lewat `eas init`** (tidak boleh memakai ID app lain) |
| `babel.config.js`: `babel-preset-expo` + `transform-remove-console` di produksi | Dipakai |
| `expo-secure-store`, `expo-local-authentication` (di `mobile/`) | Dipakai untuk token & kunci layar |
| `@tanstack/react-query` v5, `lucide-react-native`, `expo-image`, `expo-haptics`, `expo-notifications` | Dipakai |
| Tanpa Reanimated di `driver-mobile` (audit performa 13 Sep 2026) | Diikuti; `Animated` core |
| `@shopify/flash-list` 2.0.2 | Dipakai untuk daftar panjang (S6+) |
| `push.js`: registrasi token Expo + channel Android, `Constants.expoConfig.extra.eas.projectId` | Diadaptasi (`src/auth/push.ts`) ke `POST /api/mobile/devices` |
| Proyek TypeScript **belum ada** di repo; `mobile/AGENTS.md`: "Expo has changed — baca dokumen v57" | Baca docs SDK 57 sebelum menambah modul; TS baru di `finance-mobile/` saja |
| **Tidak diubah**: `mobile/`, `driver-mobile/`, `driver-app/` | Nol perubahan pada app lain |

---

## 16. Kontrak API existing yang dipakai

Basis URL produksi: `https://app.sanomatrassehat.com/api`. Autentikasi: `Authorization: Bearer <accessToken>`.
Format kesalahan: `{"error":"…"}`. Semua respons JSON kecuali unggah (multipart) dan PDF. Izin di kolom "Izin" dari `requirePermission`/`requireAnyPermission`.

### 16.1 Auth & profil

| Method | Path | Izin | Catatan |
|---|---|---|---|
| POST | `/auth/login` | publik | **Web/legacy** (7 hari). Mobile memakai `/mobile/auth/*` (G-01) |
| GET | `/auth/me` | login | `roles`, `portals` (+ `capabilities` G-04) |

### 16.2 Dashboard & laporan (semua `FINANCE_READ`)

| Method | Path | Query | Respons kunci |
|---|---|---|---|
| GET | `/finance/dashboard` | `from,to` | `periode, kasBank[], totalKas, labaRugi{…}, piutang{total,ringkasan,teratas[],menungguVerifikasi}, utang{…}, antrean{pembayaranBelumVerifikasi[], jumlahPembayaranBelumVerifikasi, lunasBelumDicatat, pengeluaranMenunggu, pembelianMenunggu, tagihanMenunggu, refundMenunggu}, gate, jurnalTerakhir[], catatan` |
| GET | `/finance/reports/income-statement` | `from,to` | `pendapatan[], retur[], bebanPokok[], bebanOperasional[], ringkasan{pendapatanBruto…labaBersih, marginKotor, marginBersih}, catatan` |
| GET | `/finance/reports/balance-sheet` | `to` | `aset[], kewajiban[], ekuitas[], labaTahunBerjalan, ringkasan{totalAset, totalKewajiban, totalEkuitas, totalPasiva, seimbang, selisih}, catatan` |
| GET | `/finance/reports/cash-flow` | `from,to` | `operasi[], investasi[], pendanaan[], takTerkategori[], ringkasan{saldoAwal, masuk, keluar, arusBersih, saldoAkhir}` |
| GET | `/finance/reports/trial-balance` | `from,to` | `baris[], total{mutasiDebit, mutasiKredit, seimbang, selisih}, catatan` |
| GET | `/finance/reports/ledger/:accountId` | `from,to` | buku besar per akun (maks 500 baris) |
| GET | `/finance/reports/receivables` | `to` | `baris[], ringkasan, ember, menungguVerifikasi{jumlah,total}` |
| GET | `/finance/reports/payables` | `to` | serupa piutang |

### 16.3 Master ringan (untuk form)

| Method | Path | Izin | Isi |
|---|---|---|---|
| GET | `/finance/cash-accounts` | `FINANCE_READ` | `accounts[] (id,name,kind,active,account{id,code,name},saldo), totalSaldo` |
| GET | `/finance/expense-categories`, `/finance/purchase-categories` | `FINANCE_READ` | kategori + akun + divisi + `active` |
| GET | `/finance/accounts` | `FINANCE_READ` | bagan akun (untuk pemilih akun buku besar / akun pendapatan) |
| GET | `/finance/settings` | `FINANCE_READ` | ambang approval, ambang nota, batas kasbon, cutover — **dibaca** untuk teks bantuan |
| GET | `/finance/periods` | `FINANCE_READ` | status periode |

### 16.4 Transaksi

| Domain | Method & Path | Izin | Body/Query kunci |
|---|---|---|---|
| Pengeluaran | `GET /finance/expenses` | `FINANCE_READ` **atau** `EXPENSE_SUBMIT` (terakhir: hanya milik sendiri) | `from,to,status,division,categoryId,mode,q,bukti` → `{expenses[], total, hanyaMilikSendiri, terpotong}` |
| | `POST /finance/expenses` | `FINANCE_POST` / `EXPENSE_SUBMIT` | `date, amount, description, categoryId, division, mode(LANGSUNG/REIMBURSEMENT/UTANG), cashAccountId, supplierId, reimburseToId, payeeName, orderId, unitId, receiptUrl, notes, langsungAjukan` |
| | `POST /finance/expenses/:id/submit` · `/approve` · `/reject{reason}` · `/pay{cashAccountId,paidAt}` | POST · **APPROVE** · **APPROVE** · POST | approve: pengaju≠penyetuju kecuali `FINANCE_ADMIN` |
| | `POST …/cancel` · `PATCH /expenses/:id` · `POST …/koreksi` | `FINANCE_ADMIN` | alasan wajib |
| Pembelian | `GET/POST /finance/purchases` + `submit/approve/reject/pay/cancel/PATCH/koreksi` | sama seperti pengeluaran | `categoryId` = jenis pembelian |
| Kasbon | `GET /finance/kasbon` (`FINANCE_READ`); `GET /kasbon/karyawan-nama`, `POST /kasbon`, `POST /kasbon/:id/pelunasan`, `POST /kasbon/pelunasan-karyawan` | `FINANCE_POST` | `date, amount, employeeName, urgency, cashAccountId, notes, receiptUrl, lewatBatas`; potong: `employeeName, amount, date, method(POTONG_GAJI), notes` |
| | `POST /kasbon/:id/batal` · `/pelunasan/:rid/batal` · `PATCH /kasbon/:id` | `FINANCE_ADMIN` | alasan |
| Pemasukan lain | `GET/POST /finance/other-income`, `…/cancel`, `…/koreksi` | READ/POST/ADMIN | `date, amount, description, accountId, cashAccountId, attachmentUrl, notes` |
| Transfer kas | `GET/POST /finance/transfers`, `…/cancel`, `…/koreksi` | READ/POST/ADMIN | `date, fromAccountId, toAccountId, amount, feeAmount, reference, notes` |
| Supplier | `GET/POST /finance/suppliers`, `PATCH /suppliers/:id` | READ/POST | |
| Tagihan | `GET/POST /finance/bills`, `…/approve`, `…/reject`, `GET /bills/unbilled-receipts` | READ/POST/**APPROVE** | `supplierId, supplierRef, billDate, dueDate, amount, description, goodsReceiptId` **atau** `expenseCategoryId`, `attachmentUrl` |
| Bayar tagihan | `GET/POST /finance/supplier-payments`, `…/cancel` | READ/POST/ADMIN | `supplierId, date, cashAccountId, reference, notes, attachmentUrl, allocations[{billId,amount}]` |
| Refund | `GET/POST /finance/refunds`, `…/approve`, `…/reject` | READ/POST/**APPROVE** | `orderId, date, amount, reason, cashAccountId, attachmentUrl` |
| Invoice | `GET /finance/invoices` (`status,jatuhTempo,search,limit`) ; PDF `GET /orders/:id/invoice/pdf` | `FINANCE_READ` ; login | jatuh tempo diubah lewat `PATCH /orders/:id/invoice` (web) |

### 16.5 Pembayaran & verifikasi

| Method | Path | Izin | Catatan |
|---|---|---|---|
| GET | `/finance/penerimaan/lunas-belum-dicatat` | `PAYMENT_READ` | `{cutoff, items[{orderId,orderNumber,orderStatus,customerName,salesName,nilaiOrder,sudahDicatat,sisa,lunasSejak,kelompok:BARU|LAMA}], semua, baru, lama}` |
| POST | `/finance/penerimaan/verifikasi` | `PAYMENT_WRITE` | `orderId, mode(REKENING|SEBELUM_SALDO_AWAL), method, cashAccountId, date, amount, proofPhotoUrl` (URL harus dari `/media/finance-receipts/` atau `/media/payment-proofs/`) |
| POST | `/finance/penerimaan/verifikasi-massal` | `PAYMENT_WRITE` | `orderIds[], mode, method, cashAccountId` → `{berhasil,gagal,hasil[]}` |
| POST | `/finance/penerimaan/tolak` | `PAYMENT_WRITE` | `orderId, reason` |
| GET | `/finance/customer-payments` | `FINANCE_READ` | `from,to,status(belum_verifikasi|terverifikasi|dibatalkan|kosong=semua)`; `take 300` |
| POST | `/armada/payments/:id/verify` | `PAYMENT_WRITE` | 409 bila sudah diverifikasi |
| POST | `/finance/customer-payments/:id/allocations` | `FINANCE_POST` | (non-MVP) |

### 16.6 Rekonsiliasi, jurnal, gap, bukti

| Domain | Method & Path | Izin |
|---|---|---|
| Rekonsiliasi | `GET/POST /finance/bank-statements`, `GET /bank-statements/:id`, `POST …/lines`(non-MVP), `POST /bank-lines/:id/match|unmatch|ignore`, `POST /bank-statements/:id/complete` | READ / POST / **APPROVE** untuk `complete` |
| Jurnal | `GET /finance/journal` (`from,to,source,status,search,limit≤500,offset`) → `{entries[],total}`; `GET /journal/:id` | `FINANCE_READ` |
| Gap | `GET /finance/gaps`, `POST /gaps/:id/retry` | READ / POST |
| Unggah nota | `POST /finance/receipts/upload` (multipart `receipt`, ≤25 MB) → `{url, ukuranAsli, ukuranAkhir, dipakaiDi[]}` | `FINANCE_POST` / `EXPENSE_SUBMIT` |
| Bukti dokumen | `POST /finance/:jenis(expenses|purchases)/:id/bukti{receiptUrl,reason}`; `POST …/verifikasi-bukti`; `GET /finance/bukti-review` | POST/EXPENSE_SUBMIT · **ADMIN** · READ |

### 16.7 Konvensi yang harus dipatuhi klien

- **Tanggal**: `from`/`to` = `YYYY-MM-DD` WIB. Default server = bulan berjalan.
- **Uang**: respons `number` (dua desimal); di klien di-*parse* dengan `lossless-json` dan diubah ke **string desimal** (`Money`) di `src/api/normalize.ts`; **kirim string**. Jangan memakai JS `Number` untuk uang.
- **Status HTTP**: 200/201 sukses; 400 validasi; 401 sesi; 403 izin/pemisahan tugas; 404; 409 konflik status; 422 aturan bisnis (mis. batas kasbon + `kodeBatas`); 5xx server.
- **Idempotensi**: belum ada di command pembuatan (F7) → G-07.
- **Nomor dokumen** ada di respons (`expenseNumber`, `kasbonNumber`, `entryNumber`, …) — ditampilkan, tidak dibuat klien.
- **URL media** relatif (`/media/finance-receipts/<hash>.jpg`, thumbnail `_t.jpg`) — digabung dengan host; wajib melalui G-08 setelah tersedia.

---

## 17. Gap API dan pekerjaan backend (prasyarat)

Prinsip: gap ditutup **tanpa** membuat jalur tulis kedua atau perhitungan baru. Semua penambahan di prefix baru
`/api/mobile/*` atau endpoint baca tambahan; route finance existing tidak diubah perilakunya kecuali disebut.
Prioritas: **P0** = memblokir rilis; **P1** = dibutuhkan MVP tetapi ada penyiasatan sementara; **P2** = 1.1+.

| ID | Gap (temuan) | Solusi | Prio | File utama yang disentuh |
|---|---|---|---|---|
| **G-01** | Sesi 7 hari tanpa refresh/cabut/perangkat (F1) | Tabel `MobileSession`; `POST /mobile/auth/login|refresh|logout`, `GET/DELETE /mobile/auth/sessions`; access 15 mnt, refresh rotasi + deteksi reuse; cek `active` & role tiap refresh; batas 2 sesi; pemeriksaan `sid` pada command finance; audit perangkat | **P0** | `routes/mobileAuth.js` (baru), `schema.prisma`, `middleware/auth.js` |
| **G-02** | Sliding refresh mem-perpanjang token mobile (F2) | `requireAuth`: lewati `X-Refreshed-Token` bila `payload.typ==='mobile'` | **P0** | `middleware/auth.js` |
| **G-03** | Tanpa rate limit (F3) | `express-rate-limit`: login 5/15 mnt per email+IP, API 120/mnt/pengguna, unggah 20/mnt; `helmet`; batasi CORS untuk web | **P0** | `index.js`, `routes/mobileAuth.js` |
| **G-04** | `/auth/me` tanpa izin (F4) | Tambah `capabilities` (turunan `hasPermission`) di `/auth/me` dan respons login/refresh mobile | **P0** | `routes/auth.js`, `middleware/authorize.js` |
| **G-05** | Audit trail finance tak terbaca (F10) | `GET /finance/audit?entityType&entityId&cursor` (`FINANCE_READ`), whitelist `FIN_*`; nama aktor di-resolve; termasuk `alasan`/`menyetujuiPengajuanSendiri` | **P1** | `routes/finance.js` (atau `financeAudit.js`) |
| **G-06** | Tidak ada inbox approval gabungan (F6) | `GET /finance/approvals/pending?jenis=&limit=&cursor=` (`FINANCE_APPROVE`): gabungan expense/purchase/bill/refund `MENUNGGU_APPROVAL` (id, jenis, nomor, nominal, pengaju, tanggal, kategori, ada-bukti, `bolehDisetujuiSaya`) + total per jenis. **Penyiasatan sementara**: 4 panggilan filter status | **P1** | `routes/financeApprovals.js` (baru) |
| **G-07** | Tanpa `Idempotency-Key` (F7) | Middleware `Idempotency-Key` untuk POST pembuatan/aksi uang: tabel `api_idempotency(userId,key,method,path,status,responseJson,createdAt)` TTL 24 jam; permintaan kembar ⇒ respons pertama (`Idempotent-Replayed: true`); kunci sama dengan body beda ⇒ 422. Dikenakan pada: expenses/purchases/kasbon/refunds/transfers/other-income/bills/supplier-payments/penerimaan | **P0** untuk command uang | `middleware/idempotency.js` (baru), mount di router finance |
| **G-08** | Foto nota publik tanpa auth (F11) | `GET /api/finance/media/receipts/:file` (Bearer, `FINANCE_READ`/`EXPENSE_SUBMIT`) atau URL bertanda-tangan berumur 5 mnt; `/media/finance-receipts` statis dipertahankan untuk web sampai dimigrasi | **P1** | `index.js`, `routes/finance.js` |
| **G-09** | Tidak ada tren bulanan (F13) | `GET /finance/dashboard/trend?months=6` → per bulan `{bulan, pendapatanBersih, beban, labaBersih}` memakai `labaRugi()` yang sama. **Penyiasatan**: 6× `income-statement` paralel | **P1** | `routes/finance.js` |
| **G-10** | Push FCM & notifikasi finance nol (F9) | Tabel `DeviceToken(userId, platform, fcmToken, deviceId)` + `finance_notifications`; `firebase-admin` kirim; event §9.1 dipicu dari approve/reject/submit/verifikasi; `GET /finance/notifications`, `POST …/read`; `POST /mobile/devices` (daftar token) | **P0** (push) / P1 (pusat notifikasi) | `services/fcmPush.js` (baru), hooks di route finance |
| **G-11** | Tak ada ekspor server (F12) | `GET /finance/reports/*?format=pdf|csv` memakai fungsi `reports.js` yang sama | **P2** | `routes/finance.js`, `services/financePdf.js` |
| **G-12** | Pratinjau jurnal sebelum approve | `GET /finance/{expenses|purchases|bills|refunds}/:id/preview-journal` (dry-run `postJournal` tanpa commit) | **P2** | posting service |
| **G-13** | Ringkasan pembayaran per periode & pembanding periode | `GET /finance/customer-payments/summary?from&to` → `{total, terverifikasi{jumlah,nominal}, menunggu{jumlah,nominal}, dibatalkan}`; pembanding periode di dashboard (`?bandingkan=periodeLalu`). **Penyiasatan**: dua panggilan `customer-payments` seperti web | **P1** | `routes/financeTransactions.js` |
| **G-14** | Ringkasan kasbon periode (banner di Pengeluaran) | Tambah `ringkasan{totalPeriode, sisaAktif}` pada `GET /kasbon` | **P2** | `routes/financeKasbon.js` |
| **G-15** | Role `ACCOUNTANT` & `APPROVER` tiada (F5) — **SELESAI di S2** | Migrasi enum `Role` + entri `ROLE_PERMISSIONS` (§12.2) + `PORTALS.finance.roles`; uji per role | **P1** | `schema.prisma`, `constants/permissions.js`, tes |
| **G-16** | Daftar tanpa cursor, `take 300` (F8) | Tambahkan `limit` + `cursor` (keyset `date,createdAt,id`) & `total` pada daftar expenses/purchases/bills/refunds/customer-payments/kasbon/invoices/journal | **P1** (MVP hidup dengan batas periode) | route finance |
| **G-17** | Tanpa versi/konfigurasi/`X-Request-Id` (F15) | `GET /mobile/config` → `{minVersionCode, latestVersionCode, apkUrl, maintenance{active,message}, flags}` (tanpa auth); log `X-Request-Id` di server | **P1** | `routes/mobileAuth.js`, `index.js` |
| **G-18** | Pencarian global | `GET /finance/search?q=` → gabungan nomor dokumen/order/pelanggan/supplier (batas 20) | **P2** | `routes/finance.js` |
| **G-19** | Step-up hanya klien (§11.5) | Enrollment kunci publik perangkat + `POST /mobile/auth/step-up` (challenge–signature) ⇒ `X-StepUp-Token` 5 mnt wajib pada command uang | **P2** | `routes/mobileAuth.js` |

**Status 19 Sep 2026 (S0 selesai, live di produksi, 175 tes integrasi + 494 tes unit hijau):**

| Gap | Status | Catatan |
|---|---|---|
| G-01 sesi mobile | ✔ selesai | `/api/mobile/auth/*`, tabel `mobile_sessions` |
| G-02 tanpa perpanjangan otomatis | ✔ selesai | `requireAuth` cabang `typ:"mobile"` |
| G-03 rate limit | ✔ selesai | login (email+IP, IP), refresh, API mobile, media sign; helmet/CORS **belum** |
| G-04 capabilities | ✔ selesai | `/auth/me` + login |
| G-07 Idempotency-Key | ✔ selesai | 4 router finance; wajib untuk token mobile (428) |
| G-08 foto nota | ✔ selesai | Bearer atau URL bertanda-tangan; web disesuaikan; media lain (`payment-proofs`, dll.) **belum** |
| G-10 push | ◐ fondasi selesai | token perangkat (`expo`/`fcm`), dispatch, transport FCM v1; **pemicu & pusat notifikasi = S11**; mati kecuali `FINANCE_PUSH_ENABLED=true` |
| G-17 config | ◐ dasar selesai | `GET /api/mobile/config`; `X-Request-Id` di log server belum |
| G-15 role baru | ✔ selesai (S2) | enum `ACCOUNTANT`/`APPROVER`, migration `20260920100000_role_accountant_approver`; belum ada pengguna yang ditetapkan |
| G-05, G-06, G-09, G-13, G-16 | ✘ belum | penyiasatan tercantum; S3–S6 |

Ringkasan blokade MVP (semula): **G-01, G-02, G-03, G-04, G-07, G-10 (push)** harus selesai **sebelum** aplikasi boleh dipakai dengan data produksi — kini terpenuhi kecuali **pemicu push (S11)**.
G-05, G-06, G-08, G-09, G-13, G-15, G-16, G-17 harus selesai sebelum rilis 1.0 final; penyiasatan sementara tercantum agar pengembangan tidak menunggu.

Aturan pengerjaan backend (dari `CLAUDE.md`): uji integrasi per role nyata (bukan admin) · route baru **wajib** dimount di `tests/integration/setup/testApp.js` ·
migrasi lewat `prisma migrate` · deploy: `git pull` di VPS, `docker compose up -d --build backend`, `prisma migrate deploy`; jangan build frontend di VPS.

---

## 18. Testing, observability, build, dan deployment

### 18.1 Strategi tes

| Lapisan | Alat | Cakupan wajib |
|---|---|---|
| Tipe & gaya | `tsc --noEmit` (strict), ESLint (`eslint-config-expo` + aturan larangan `parseFloat`/`Number()` untuk uang), `expo-doctor` | Bersih di CI sebelum build |
| Unit | `jest-expo` | `money.ts` (parse/format/pecah desimal, `150.000`→`150000`, negatif, sangat besar), `dates.ts` (batas 00:00–07:00 WIB), `normalize.ts` (angka JSON → string desimal, literal `1234.50` tetap), `StatusBadge` (status tak dikenal), `apiClient` (refresh single-flight, pemetaan galat, `Idempotency-Key`), `pin.ts` (verifier, jeda percobaan), `CommandExecutor` (hasil pasti/tidak pasti) |
| Komponen | `@testing-library/react-native` | State kosong/loading/error tiap daftar; form validasi; tombol nonaktif tanpa capability; teks Bahasa Indonesia |
| Kontrak | Fixture JSON **dihasilkan dari tes integrasi backend** (respons nyata) + tes klien memparse semuanya | Semua endpoint §16; status tak dikenal tidak crash; angka besar & 2 desimal |
| Snapshot visual | Jest snapshot komponen desain + tangkapan manual per rilis | Terang/gelap × tier glass FULL/LITE/MINIMAL × skala font 100/150/200% |
| E2E | **Maestro** (YAML) pada emulator/perangkat dengan backend lokal & DB uji (`tests/integration/setup/bootstrapTestDb.js`) | Alur §7.2–§7.5 dengan **akun Finance, Approver, Owner, Accountant** (bukan admin) |
| Keamanan | Checklist **OWASP MASVS-L1 + butir L2 terpilih** + uji manual | Screenshot terblokir, token hanya di SecureStore, pinning/HTTPS, reuse refresh-token mencabut sesi, PIN lockout |
| Performa | Profil Hermes/React DevTools + pengukuran manual | Cold start, scroll 300 baris (FlashList), kompres 12 MP < 1,5 dtk di perangkat acuan |
| Aksesibilitas | TalkBack manual + `accessibilityLabel` diaudit | Label, urutan fokus, kontras AA di atas glass, target 48 dp, teks 200% |
| Perangkat | Matriks: Android 8 (API 26), 10, 13, 15; RAM 3/4/8 GB; layar 5,5–6,8" | Tier glass benar, tidak ada jank |
| Regresi backend | Suite existing 11 berkas finance + tes S0 (mobileAuth, idempotency, media, notifikasi) | Wajib hijau sebelum deploy backend |

Definisi selesai (DoD) fitur: kode + tes unit + tes komponen + diuji dengan **akun peran nyata** + tidak ada aritmetika uang baru di klien (lint bersih) + teks Bahasa Indonesia + review keamanan singkat.

### 18.2 Kualitas data yang diuji khusus

- Total di layar **identik** dengan web untuk periode & akun yang sama (uji otomatis membandingkan respons; **tidak** ada logika turunan).
- Order LUNAS **tidak** muncul di Piutang; pembayaran sebelum 18 Sep 2026 tidak menambah kas (uji E2E lewat mode `SEBELUM_SALDO_AWAL`).
- Verifikasi massal parsial menampilkan hasil per order benar.
- Dobel-tap Simpan menghasilkan **satu** dokumen (backend S0 sudah memastikan lewat `Idempotency-Key`).

### 18.3 Observability

| Kebutuhan | Implementasi |
|---|---|
| Crash & galat JS | `ErrorBoundary` global + pelaporan (Sentry atau setara; keputusan S12), **tanpa PII**, kunci kustom: versi, varian, tier glass, preset peran |
| Analitik produk (minimal, tanpa data finansial) | Event: `login_success`, `approval_decided(jenis,hasil)`, `payment_verified(mode)`, `receipt_uploaded(sumber)`, `command_failed(kode)`, `offline_blocked`. **Tanpa** nominal/nama/nomor dokumen |
| Korelasi | `X-Request-Id` (UUID) dikirim tiap request; ditampilkan sebagai kode kecil pada galat 5xx (G-17) |
| Server | Log terstruktur untuk `/mobile/auth/*` & command finance; hitungan 401/403/409/422/429; alert bila login gagal melonjak |
| Kesehatan | `/api/health` + `/api/mobile/config` (versi minimum, maintenance) — **sudah ada (S0)** |
| Metrik keberhasilan | Dasbor sederhana atas G1–G5 (§1.2) dari log audit server |
| Privasi | Opt-out analitik di M5 |

### 18.4 Build, EAS, dan rilis

**Lokasi & identitas:** `finance-mobile/`; package produksi **`com.sanomatrassehat.finance`** (varian `.dev` / `.preview` memakai sufiks); nama "SANO Finance".

**Profil EAS (`eas.json`)**

| Profil | Tujuan | Output | Kanal update | Distribusi |
|---|---|---|---|---|
| `development` | Dev client (hot reload, uji native) | APK | `development` | internal |
| `preview` | Uji tim (Natasha/Gilang/Kemal/Juri) sebelum rilis | APK | `preview` | internal (tautan/QR EAS) |
| `production` | Rilis toko | **AAB** | `production` | Play Store (bila kelak dipakai) |
| `production-apk` | Rilis sideload terkontrol | **APK** | `production` | internal |

**Perintah (dijalankan dari `finance-mobile/`; butuh `eas login` & `eas init` sekali)**

```bash
eas build --platform android --profile development      # dev client
eas build --platform android --profile preview          # APK uji
eas build --platform android --profile production-apk   # APK rilis
eas build --platform android --profile production       # AAB
eas update --channel preview    --message "…"            # OTA ke preview
eas update --channel production --message "…"            # OTA ke production
eas update:rollback                                       # tarik OTA bermasalah
```

**OTA aman (EAS Update):**
- `runtimeVersion.policy = "fingerprint"` — OTA hanya menjangkau build yang **native-nya identik**; menambah/mengubah modul native ⇒ fingerprint berubah ⇒ wajib build baru.
- OTA hanya untuk JS/aset. Perubahan pada kontrak API yang **tidak kompatibel mundur** harus lewat `minVersionCode` di `/api/mobile/config` (paksa-update).
- Alur: PR → tes → `eas update --channel preview` → uji Natasha/Owner → `eas update --channel production`. Tiap update diberi pesan; rollback dengan `eas update:rollback`.
- `expo-updates`: `checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout` singkat; dokumen aman terhadap update yang gagal (kembali ke bundel tertanam).

**Penandatanganan:** keystore Android dikelola **EAS (credentials service)**; simpan cadangan (`eas credentials` → unduh) di password manager. Kehilangan keystore = tidak bisa memperbarui aplikasi yang sudah terpasang.

**Push:** unggah kunci **FCM V1** (akun layanan Firebase) ke EAS (`eas credentials`) — Expo Push memakainya. Server SANSS **tidak** butuh kredensial untuk token Expo (`FINANCE_PUSH_ENABLED=true` sudah cukup); kredensial FCM di env server hanya bila memakai token FCM langsung. Lihat `docs/FINANCE-MOBILE-BACKEND.md`.

**CI (GitHub Actions, repo `sanocareai/klinik-matras-crm`):** `npm ci` → `tsc` → lint → `jest` → `expo-doctor`; build EAS dipicu manual/`workflow_dispatch` dengan `EXPO_TOKEN`.

**Distribusi 1.0:** APK `production-apk` via tautan internal EAS ke Natasha/Gilang/Kemal/Juri; opsional Play Internal Testing (akun developer sekali bayar).

**Pembaruan versi:** cek `GET /api/mobile/config` saat buka: `versionCode` < `minVersionCode` ⇒ layar paksa-update; `< latestVersionCode` ⇒ banner lembut. Backend kompatibel mundur minimal 2 versi app.

**Lingkungan server:** tidak ada staging terpisah (hanya dev lokal + VPS produksi). Uji backend dengan DB uji lokal; deploy backend bertahap (endpoint baru tidak mengubah yang lama) — alur `CLAUDE.md` §12.

**Dokumen operasional:** `docs/RUNBOOK_FINANCE_MOBILE.md` (dibuat di S12): build, kredensial, OTA & rollback, cabut sesi darurat, HP hilang.

### 18.5 Prosedur darurat

- **HP hilang**: Owner/Admin menonaktifkan akun atau memanggil `POST /api/mobile/auth/sessions/revoke-user` ⇒ token akses langsung ditolak (cek sesi tiap request), token push dihapus, cache lokal tak terbaca tanpa SecureStore + PIN.
- **Token bocor**: rotasi refresh + cabut semua sesi pengguna; catat di audit.
- **Bug angka**: tidak ada perhitungan di klien ⇒ perbaikan di backend berlaku instan tanpa rilis app.
- **Bug UI**: `eas update:rollback` atau OTA perbaikan ke kanal `production`; bila menyangkut native ⇒ build baru + naikkan `minVersionCode`.

---

## 19. Slice implementasi dan acceptance criteria

Urutan dibuat agar tiap slice **dapat dirilis internal** dan bernilai sendiri. Ukuran: S ≈ 2–4 hari, M ≈ 1 minggu, L ≈ 2 minggu
(satu developer, termasuk tes). Setiap slice memakai DoD §18.1 dan **diuji dengan akun peran nyata**.
Format AC: *Given/When/Then* ringkas.

### Fase A — Fondasi (backend + kerangka app)

#### S0 — Prasyarat backend (L) — G-01, G-02, G-03, G-04, G-07, G-08, G-10 (fondasi), G-17 (dasar)
**Status: SELESAI & live (19 Sep 2026)** — role baru G-15 diselesaikan pada S2 (nama peran: `APPROVER`, bukan `FINANCE_APPROVER`). Bukti: `mobileAuth`, `financeIdempotency`, `financeMedia`, `financeNotifications` integration test + `rateLimit`, `mediaSigning`, `fcmTransport` unit test. Dokumen: `docs/FINANCE-MOBILE-BACKEND.md`.
Cakupan: sesi mobile, rate limit, capabilities, idempotency, foto nota terlindungi, token push perangkat + dispatch, `mobile/config`.
| AC | Kriteria |
|---|---|
| S0-1 | *Given* kredensial benar *When* `POST /mobile/auth/login` *Then* dapat access token 15 mnt (`typ:"mobile"`, `sid`) + refresh token; respons memuat `capabilities` |
| S0-2 | *Given* refresh token dipakai dua kali *Then* pemakaian kedua ditolak **dan** seluruh sesi itu dicabut |
| S0-3 | *Given* akun dinonaktifkan *When* refresh atau command finance dipanggil dengan token lama *Then* 401 (command: paling lambat langsung karena cek `sid`) |
| S0-4 | *Given* token `typ:"mobile"` *When* request apa pun *Then* **tidak ada** `X-Refreshed-Token` |
| S0-5 | *Given* 6 login gagal / 15 mnt (email+IP sama) *Then* percobaan ke-6 ditolak 429 dengan pesan Indonesia; login sah dari pengguna lain tidak terpengaruh |
| S0-6 | *Given* `Idempotency-Key` sama & body sama pada `POST /expenses` *Then* hanya **satu** dokumen dan respons kedua bertanda `Idempotent-Replayed`; body beda ⇒ 422 |
| S0-7 | Role `ACCOUNTANT`/`APPROVER` ada; tes izin per role lulus (Approver 403 pada `POST /expenses`; Accountant 403 pada `/expenses/:id/approve` dan `/penerimaan/verifikasi`) |
| S0-8 | Suite finance existing (11 berkas) tetap hijau; router baru terpasang di `testApp.js` |

#### S1 — Kerangka app + design system (M)
**Status: scaffold SELESAI (19 Sep 2026)** — `finance-mobile/` sudah berisi Expo Router + TypeScript, token & `GlassCard`/`MoneyText`/`StatusBadge`/`Sheet`, tier glass, dark/light,
lima tab + FAB, `apiClient`, SecureStore, konfigurasi EAS, dan data contoh. Sisa S1: `FilterBar`, `ReasonSheet`, CI, pemasangan Inter, snapshot visual.
Proyek `finance-mobile/`, tema Biru Kaca, `GlassCard`, `MoneyText`, `StatusBadge`, `FilterBar`, `ReasonSheet`, tier glass, dark/light, navigasi 5 tab, CI dasar.
| AC | Kriteria |
|---|---|
| S1-1 | Build EAS `development` & `preview` berjalan di Android 8 dan 15; tab bawah 5 item berpindah dengan state dipertahankan; ketiga varian (`.dev`, `.preview`, produksi) terpasang bersamaan |
| S1-2 | Tier glass otomatis (FULL di API ≥ 31 & RAM ≥ 4 GB, LITE lainnya); tombol Efek Ringan mengganti seketika |
| S1-3 | Screenshot tes terang/gelap × skala font 100/200% lulus tanpa teks terpotong |
| S1-4 | `parseMoney("1234567.89")` mengembalikan string desimal yang sama; `formatRupiah` benar untuk nol, negatif, dan nilai > 2^53; tidak ada `Number`/`parseFloat` pada uang (lint + tes hijau) |
| S1-5 | Tema mengikuti sistem; kontras AA untuk teks di atas glass (Accessibility Scanner bersih) |

#### S2 — Auth, kunci, keamanan dasar (L) — butuh S0

**Status: SELESAI (19 Sep 2026, belum ada build EAS).** Diimplementasikan: login sesi mobile SANSS Hub, refresh rotasi single-flight, logout/revoke, sesi habis, SecureStore; app lock PIN 6 digit (PBKDF2 25.000 iterasi, verifier saja) + biometrik opsional dengan cadangan PIN; auto-lock default 2 menit (pilihan Langsung/30 dtk/1/2/5 mnt), tutup layar saat ke background, jeda percobaan salah tersimpan, step-up 2 menit untuk aksi sensitif; RBAC end-to-end berbasis capabilities (tab, FAB, route, command); layar Keamanan dan Ubah PIN; role `ACCOUNTANT` & `APPROVER` di backend. Push tidak diaktifkan; layar transaksi belum dikerjakan. Bukti: 101 tes Jest, `tsc`, `eslint`, `expo-doctor` 21/21, bundle Android sukses; backend `authorize` 34 tes + `financeRoles` 7 tes.
| AC | Kriteria |
|---|---|
| S2-1 | Login sukses → wajib buat PIN 6 digit → (opsional) biometrik → Beranda |
| S2-2 | Akun tanpa capability finance ⇒ layar "Aplikasi ini untuk tim Finance", sesi dibuang |
| S2-3 | App di background > auto-lock ⇒ layar kunci muncul; tanpa unlock tidak ada data terlihat (juga di Recents: layar hitam/`FLAG_SECURE`) |
| S2-4 | 10 PIN salah ⇒ data lokal & sesi dihapus, kembali ke login |
| S2-5 | Access token kedaluwarsa saat beberapa request paralel ⇒ tepat **satu** refresh; hasil semua request benar |
| S2-6 | Refresh gagal (dicabut) ⇒ A6, data cache dihapus |
| S2-7 | Klien menolak HTTP polos dan sertifikat tidak valid (HTTPS bawaan sistem); pinning ditunda ke 1.1 (§11.6) — keputusan tercatat |
| S2-8 | `android.allowBackup=false`; `adb backup`/`run-as` tidak menghasilkan token terbaca (token hanya di SecureStore) |
| S2-9 | M4 menampilkan sesi/perangkat & bisa mengeluarkan perangkat lain |

### Fase B — Nilai inti (baca + putuskan)

#### S3 — Beranda & rekening (M)

**Status: SELESAI (20 Sep 2026, diuji di emulator Android + API dev; belum ada build EAS).** Kontrak `GET /finance/dashboard` diaudit dari respons asli (bukan ditebak): uang = angka JSON → string desimal lewat lossless parse, margin = persen (bukan uang), kas/piutang/utang = posisi saat ini dan hanya laba rugi mengikuti `?from&to`. Diimplementasikan: pemilih periode (Bulan ini/lalu, kuartal, tahun, 12 bulan), pull-to-refresh, "Diperbarui … WIB", hero kas, saldo per rekening, aksi cepat berbasis capabilities, pekerjaan tertunda (per peran), laba rugi, umur piutang & utang, kesehatan pembukuan, jurnal terakhir; state memuat/kosong/galat/offline/sesi habis/data parsial/penyegaran gagal (data lama tetap tampil) berbahasa Indonesia. Backend: perbaikan bentuk respons piutang saat kosong (`total`, `perTanggal`, ringkasan numerik) + tes kontrak. Deviasi: S3-5 "snapshot offline" hanya di memori selama aplikasi terbuka (belum ada cache terenkripsi lintas peluncuran — ditunda); jurnal terakhir memuat nama pelanggan dalam deskripsi (dibiarkan, tim internal).
Layar H1, K1, K2 (baca); `GET /finance/dashboard`, `/cash-accounts`, `/reports/ledger`.
| AC | Kriteria |
|---|---|
| S3-1 | Angka `totalKas`, tiap saldo rekening, laba bersih, piutang, utang **persis sama** dengan web untuk periode sama |
| S3-2 | Cold start → Beranda terisi ≤ 3 dtk (4G, perangkat acuan) |
| S3-3 | Ikon mata menyembunyikan **semua** nominal Beranda; preferensi bertahan |
| S3-4 | `catatan.pesan` non-kosong ⇒ banner catatan tampil; kosong ⇒ tidak tampil |
| S3-5 | Offline: snapshot tampil dengan "Data per …", tanpa count-up, tanpa tombol ubah data |
| S3-6 | Tanpa `paymentWrite` ⇒ aksi cepat "Verifikasi Pembayaran" tidak ada; Owner tidak melihat "Catat" di aksi cepat |
| S3-7 | Chip delta hanya muncul bila server menyediakan pembanding (tidak dihitung klien) |

#### S4 — Persetujuan (M) — G-06 (atau penyiasatan 4 panggilan)

**Status: SELESAI (20 Sep 2026, diuji di emulator Android dengan keyboard nyata; belum ada build EAS).** G-06 ditutup dengan read-model gabungan `GET /finance/approvals` (tanpa menduplikasi transaksi; komando tetap ke endpoint per jenis). Diaudit dari kode, bukan ditebak: hanya 4 dokumen yang punya approval (Pengeluaran, Pembelian, Tagihan supplier, Refund).

**Keputusan workflow (server yang memutuskan, klien hanya memetakan):**
- Tab **Menunggu** = `MENUNGGU_APPROVAL` (DRAFT tidak masuk inbox), terlama dahulu. **Diproses** = disetujui tetapi belum selesai (expense/purchase `DISETUJUI`; tagihan `DISETUJUI`/`DIBAYAR_SEBAGIAN`). **Disetujui** = selesai (`DIBAYAR`/`LUNAS`; refund `DISETUJUI`). **Ditolak** = `DITOLAK`. `DIBATALKAN` tidak ditampilkan.
- Setiap item membawa `aksi.{setujui,tolak}` = `{boleh, alasan, path}` yang dihitung server (izin, pemisahan tugas, syarat nota). Tombol tetap tampil **nonaktif dengan alasan dari server** (deviasi S4-6: tidak disembunyikan). Klien fail-closed: `path` harus berawalan `/finance/`.
- Pemisahan tugas hanya ada pada Pengeluaran & Pembelian (pembuat tak boleh menyetujui sendiri kecuali `FINANCE_ADMIN`). Tagihan & refund **tidak** punya aturan itu di backend dan tidak dikarang.
- Keputusan: step-up PIN/biometrik + `Idempotency-Key` (wajib 428 untuk token mobile) + transaksi atomik + `ActivityEvent` (`DOCUMENT_APPROVED/REJECTED`). Baris dokumen dikunci (`SELECT … FOR UPDATE`) di 8 handler ⇒ balapan setujui×setujui / setujui×tolak menghasilkan satu 200 dan satu 409, satu jurnal. Setelah aksi klien memuat ulang status resmi; kunci idempotensi dipakai ulang bila hasil tidak pasti.
- **Verifikasi pembayaran (`PAYMENT_WRITE`) tetap khusus Finance**; Owner/Accountant/Approver tidak diberi izin itu.

**Capability matrix (`FINANCE_READ` untuk baca inbox; `FINANCE_APPROVE` untuk keputusan):**
| Peran | Lihat inbox | Setujui/Tolak | Catatan |
|---|---|---|---|
| FINANCE | ya | ya | pengaju tak boleh menyetujui miliknya (expense/purchase) kecuali `FINANCE_ADMIN` |
| APPROVER | ya | ya | tab awal |
| OWNER | ya | ya | |
| ACCOUNTANT | ya (baca) | tidak | `aksi.boleh=false` + alasan |
| SALES / tanpa akses | tidak (403) | tidak | app menolak login: tidak punya akses Finance |

**Temuan keamanan yang diperbaiki di S4:** JWT mobile membekukan peran 15 menit sehingga izin yang dicabut masih berlaku sampai token habis. Kini `requireAuth`/`authenticateBearer` untuk token mobile membaca peran terkini dari DB per request (`sesiMobileTerkini`). Token web masih membawa peran dari JWT 7 hari (risiko tersisa).
**Perbaikan bug produksi (prasyarat S4):** `umurPiutang/umurUtang/saldoKasBank` memakai `new Date()` (UTC) sehingga jurnal bertanggal buku WIB hari ini dikecualikan pukul 00:00–07:00 WIB; kini memakai `todayBookDateWIB()`. Ini penyebab 2 kegagalan `financePenerimaan` (bug, bukan fixture/aturan); assertion tidak diubah, ditambah tes regresi.
**Lampiran:** foto nota lewat signed URL (`/media/…?exp&sig`, TTL 10 mnt); URL di luar `/media/` dibuang klien. **Privasi:** "Sembunyikan nominal" menyamarkan nominal, keterangan, nama vendor/pelanggan, dan lampiran pada daftar, detail, dan jurnal Beranda. **Deviasi:** S4-7 (deep link push) menunggu S11.

| AC | Kriteria |
|---|---|
| S4-1 | Inbox menampilkan 4 jenis, urut terlama dahulu, badge tab = jumlah server |
| S4-2 | Setujui memerlukan step-up bila unlock > 2 mnt; sukses ⇒ status resmi dari server, item hilang setelah re-fetch, haptic konfirmasi |
| S4-3 | Tolak tanpa alasan tidak bisa dikirim; alasan tersimpan & tampil di linimasa |
| S4-4 | Akun pengaju **tidak** melihat "Setujui" atas pengajuannya (kecuali `FINANCE_ADMIN`); percobaan API langsung tetap 403 dan pesan server tampil |
| S4-5 | Dokumen sudah diputuskan orang lain ⇒ 409 ⇒ kartu "Sudah diputuskan oleh …", tanpa retry otomatis |
| S4-6 | Dokumen yang mewajibkan nota tetapi kosong ⇒ pesan server ditampilkan apa adanya; tombol tidak menyembunyikannya |
| S4-7 | Deep link dari push membuka AP2 setelah unlock |

#### S5 — Pembayaran & verifikasi (L) — G-08 (foto), G-13 (kartu) atau penyiasatan

**Status: SELESAI (20 Sep 2026; diuji di emulator Android dengan API development nyata + data contoh; belum ada build EAS).** Cakupan S5 yang dikerjakan = **daftar & keputusan atas Pembayaran pelanggan** (`Payment`): tab Menunggu Verifikasi / Terverifikasi / Ditolak, ringkasan periode, pencarian, filter (cara bayar, rekening, periode), pagination cursor, refresh, detail lengkap, verifikasi dan penolakan. Tab **"Lunas di CRM"** (AC S5-1…S5-6 di bawah, `/finance/penerimaan/*`) **tidak dibuat di mobile pada S5 ini**; endpoint-nya tetap ada di backend dan ikut diperkuat (row lock, lihat di bawah).

**Penutupan S5 (21 Sep 2026).** Tes gabungan pada database uji terpisah, dijalankan serial dan tidak bersamaan dengan QA: backend integrasi 240/240, unit backend 507/507, mobile `npm run check` (tsc + eslint + Jest 243), `expo-doctor` 21/21, bundle Android sukses. Produksi diperiksa read-only: Neraca seimbang (selisih 0) pada 31 Agu dan 17–21 Sep 2026; saldo Kas & Bank (KEM 6.716.507; PT 29.870.615; Kas 104.500) dan JV-19092026-372 (POSTED, tidak diubah); tidak ada jurnal baru, reversal, atau reklasifikasi 2-1600 sejak deploy terakhir. QA visual tabel Pengeluaran/Pembelian/Kasbon dan form Kasbon dilakukan pada build produksi yang sama terhadap database uji berisi data contoh (bukan akun produksi): menemukan dan memperbaiki latar header sticky yang masih semi-transparan karena tema kaca, serta menambah tombol "Coba lagi" untuk daftar karyawan kasbon. Risiko tersisa: verifikasi visual langsung pada akun produksi belum dilakukan; kelebihan bayar, reversal pembayaran, dan pembayaran tanpa invoice tetap gap terdokumentasi (bukan aturan baru).

**Endpoint (semua di `/api/finance`; `FINANCE_READ` untuk baca, `PAYMENT_WRITE` untuk keputusan):**
`GET /pembayaran` (status, q, metode, rekeningId, from, to, limit, cursor) · `GET /pembayaran/ringkasan` (lencana) · `GET /pembayaran/opsi` (filter) · `GET /pembayaran/:id` · `POST /pembayaran/:id/verifikasi` · `POST /pembayaran/:id/tolak {reason}`. Bukti: URL bertanda-tangan `/media/bukti-pembayaran/:file?exp&sig` (10 mnt; Bearer+`FINANCE_READ` juga diterima; juga `/api/finance/media/payment-proofs/:file` khusus Bearer).

**Schema: tidak ada tabel/kolom baru.** Dipakai apa adanya: `Payment` (+`cancelledAt/cancelReason`), `PaymentVerification` (unik per payment), `FinPaymentAllocation`, jurnal `PEMBAYARAN_ORDER:<paymentId>`, `ActivityEvent` (entity `payment`).

**Workflow (server yang memutuskan):** status turunan — MENUNGGU (belum dibatalkan, belum ada `PaymentVerification`), TERVERIFIKASI, DITOLAK (dibatalkan lewat penolakan Finance), DIBATALKAN (dibatalkan admin di CRM; tidak punya tab, hanya masuk ringkasan). Jenis DP/Cicilan/Pelunasan diturunkan server dari urutan pembayaran per order. **Verifikasi** = baris `PaymentVerification` + hitung ulang status bayar semua order terdampak (termasuk tujuan alokasi); jurnal penerimaan sudah terposting saat pembayaran dicatat, tidak dijurnal ulang. **Penolakan** = pembatalan Payment (append-only) + pembalikan jurnal + hitung ulang status, **hanya** untuk yang belum diverifikasi (yang sudah diverifikasi → 409; koreksinya tetap admin di CRM — kebijakan reversal tidak dikarang). Status order/CRM hanya berubah dari pembayaran terverifikasi bila gerbang verifikasi berlaku untuk pembayaran itu (`isPaymentCounted`). Command: `Idempotency-Key` (428 bila tiada, token mobile), `SELECT … FOR UPDATE` pada payment (dan order terdampak), transaksi atomik, `ActivityEvent`; kunci sama diputar ulang, kunci beda paralel ⇒ tepat satu menang, yang lain 409.

**Capability matrix:**
| Peran | Lihat daftar/detail/bukti | Verifikasi / Tolak |
|---|---|---|
| FINANCE | ya | ya (`PAYMENT_WRITE`) |
| OWNER, APPROVER, ACCOUNTANT | ya (`FINANCE_READ`) | tidak — `aksi.boleh=false` + alasan server; perintah langsung 403 |
| SALES / tanpa akses Finance | tidak (403; login mobile ditolak `NOT_FINANCE_TEAM`) | tidak |
`PAYMENT_WRITE` tetap khusus Finance; verifikasi pembayaran terpisah dari approval dokumen (S4).

**Gap yang dinyatakan jujur (mengikuti backend, tidak dikarang):** (1) **Pencatatan pembayaran masuk dari mobile tidak dibuat** — workflow backend mencatat pembayaran lewat sales/driver/CRM (`POST /orders/:id/payments`, tanpa izin granular) atau lahir dari "Lunas di CRM". (2) `Payment` **tidak menyimpan referensi, nama pengirim, maupun catatan** — detail menuliskan "Tidak tercatat di sistem" (bukan kosong diam-diam); tidak ada deteksi referensi duplikat selain peringatan `KEMUNGKINAN_GANDA` (order+nominal+cara bayar sama dalam 24 jam). (3) Kelebihan bayar, pembayaran melebihi nilai order, tanpa bukti, dan tanpa order hanya **peringatan informatif**; server tidak memblokir verifikasi. (4) Pembayaran tanpa alokasi eksplisit dianggap milik `Payment.orderId`; tidak ada kebijakan pembayaran tanpa invoice/order. (5) `Order.value`/`Payment.amount` bertipe INT32 (Rupiah utuh, maks ±2,1 miliar). (6) `/media/payment-proofs` statis publik untuk web CRM **dipertahankan** (belum dimigrasi); mobile hanya memakai jalur bertanda-tangan.

**Temuan & perbaikan selama S5:** router pembayaran memasang `requireAuth` global sehingga URL bertanda-tangan di bawah `/api/finance` diblokir (401) → dibatasi ke `/pembayaran` dan URL bukti dipindah ke `/media/bukti-pembayaran`; `tolakLunas` bisa menurunkan order yang baru saja dilunasi verifikasi ke "DP" (kini 409); verifikasi/penolakan "Lunas di CRM" paralel bisa membuat dua Payment (kini row lock order); "sisa jika ikut dihitung" mengurangi nominal dua kali saat gerbang menyala tanpa tanggal mulai (kini memakai `isPaymentCounted` + bagian alokasi, field `tagihan.terhitungSebelumVerifikasi`); `/armada/payments/:id/verify` (web) kini memakai fungsi verifikasi yang sama (row lock, pembayaran batal ditolak 409, semua order alokasi dihitung ulang).

**QA:** backend serial 18 tes S5 (izin per peran, 428, status/filter/cursor, ringkasan tab-independen, detail, bukti, verifikasi, 409, double-tap, paralel ×6, verifikasi×tolak, alokasi, penolakan + jurnal dibalik, tagihan) + regresi "Lunas di CRM". Mobile 62 tes baru (pemetaan, jalur API asli, hook keputusan, UI). Emulator, **API nyata**: login Finance, daftar/pencarian/ringkasan, detail beralokasi dengan foto bukti bertanda-tangan, verifikasi (409 saat diverifikasi Finance lain — pesan server + status dimuat ulang), penolakan dengan keyboard nyata (status bayar order kembali "Belum bayar" dari server), sesi dicabut server → pesan Indonesia; Owner/Approver/Akuntan hanya membaca (aksi nonaktif, perintah 403), Sales ditolak masuk; PDF bertanda-tangan 200 `application/pdf`; 360×640dp + font 1.5 + gelap (2 cacat tata letak ditemukan & diperbaiki: ringkasan/rekening terpotong, label "Invoice" pecah).

| AC | Kriteria |
|---|---|
| S5-1 | Tab **Lunas di CRM** = `lunas-belum-dicatat`; kartu memisahkan "Perlu dicek" dan "Lunas sebelum 18 Sep 2026" dengan bahasa §7.4 (tanpa istilah "saldo awal"/"pemetaan metode") |
| S5-2 | Verifikasi (mode REKENING) tanpa rekening tidak bisa dikirim; sukses ⇒ item hilang setelah re-fetch; Payment+verifikasi+jurnal terbentuk di server |
| S5-3 | Nominal < sisa diterima; nominal > sisa ⇒ pesan server ("Nominal terlalu besar…") tampil, input tetap |
| S5-4 | Mode "lunas sebelum tanggal" tidak meminta rekening/foto dan tidak menambah kas (verifikasi di DB) |
| S5-5 | Verifikasi massal ⇒ dialog hasil "N berhasil, M gagal" + alasan; yang berhasil tidak diulang |
| S5-6 | **Belum Lunas** wajib alasan; status order kembali ke DP/BELUM_BAYAR di web |
| S5-7 | Kartu total periode menampilkan nominal Menunggu vs Sudah Diverifikasi (server) dan **tidak berubah** saat pindah tab |
| S5-8 | Akun `APPROVER`/`OWNER`/`ACCOUNTANT` hanya melihat daftar (tanpa tombol verifikasi) |
| S5-9 | Foto bukti dari galeri (screenshot m-banking) terunggah terkompres < 400 KB dan tampil di detail |

### Fase C — Mencatat transaksi

#### S6 — Pengeluaran, pembelian, kasbon, pemasukan lain + lampiran + audit (L) — G-05, G-07, G-16 (opsional)

**Status: SELESAI (21 Sep 2026; Wave 1 bersama S7 dan S8; diuji di atas server contoh, kontrak respons backend nyata, dan tes integrasi backend; belum ada build EAS).** Cakupan: Pengeluaran, Pembelian, Kasbon, dan Pemasukan Lain — daftar (tab status, ringkasan, cari, periode, paginasi), detail (rincian, lampiran bertanda-tangan, riwayat audit), buat/ajukan/simpan draf, lampirkan nota, bayar reimbursement/utang, potong gaji kasbon, batalkan (admin), ubah draf (admin). **Transfer kas tidak termasuk** (di luar Wave 1). Semua data, status, dan izin per dokumen (`aksi`) dihitung server lewat read-model `GET /finance/transaksi/:modul` (lihat `docs/FINANCE-MOBILE-BACKEND.md`); perintah memakai endpoint milik tiap dokumen (Idempotency-Key, step-up PIN/biometrik, tanpa antrean offline). Dokumen yang menunggu approval otomatis tampil di Inbox S4 dan memuat tautan "Buka di Persetujuan".

| AC | Status | Kriteria & realisasi |
|---|---|---|
| S6-1 | ◐ | Buat pengeluaran dari foto nota (kamera / galeri / **Share dari WhatsApp** / tempel). Foto diunggah ke `/finance/receipts/upload`; **pengecilan dilakukan server** (klien memakai kualitas picker 0,7, tidak memaksa ≤ 1600 px / < 400 KB di HP) |
| S6-2 | ✔ | Dobel-tap **Simpan** ⇒ satu perintah (kunci ulang-tap sinkron + Idempotency-Key); koneksi putus setelah kirim ⇒ "hasilnya belum pasti", kunci dipakai ulang, tanpa kirim ulang buta. Diuji di UI & backend (kunci sama = respons diputar ulang) |
| S6-3 | ✔ | Mode Langsung tanpa rekening tidak bisa dikirim; kategori, rekening (dengan saldo), karyawan hanya dari server. Pengaju tanpa `financePost` otomatis reimbursement (aturan server) |
| S6-4 | ✔ | Foto yang sama dengan dokumen lain ⇒ peringatan `dipakaiDi`, boleh lanjut |
| S6-5 | ◐ | Batalkan (admin) dan ubah draf (admin; keterangan & nominal) wajib alasan dan muncul di riwayat. **Belum di mobile:** Koreksi pasca-posting dan mengganti/melepas foto yang sudah terpasang (tetap di web) |
| S6-6 | ◐ | Kasbon: alasan wajib; karyawan hanya akun aktif (server); potong gaji > sisa ditolak (klien & server, row lock menahan dua pemotongan paralel). **Belum:** dialog "lewati batas kasbon" untuk admin (pesan server ditampilkan apa adanya) |
| S6-7 | — | Transfer kas: di luar cakupan Wave 1 |
| S6-8 | ✔ | Tombol tambah hanya untuk pemegang izin mencatat; akun penyetuju tidak melihat tombol tambah maupun formulir (capability, bukan nama peran) |
| S6-9 | ◐ | Draf lokal: hanya isian teks (tanpa foto) di penyimpanan aman perangkat, tidak pernah terkirim otomatis, dilanjutkan/dibuang manual. **Belum:** kedaluwarsa 7 hari dan penghapusan saat logout; draf server (`langsungAjukan=false`) tersedia untuk pengeluaran/pembelian |
| S6-10 | ✔ | Pencarian & tab pada semua modul; `150.000` cocok nominal 150000; penutup "N … · sudah semua" |
| S6-11 | ✔ | Riwayat per dokumen dari audit trail server: aktor, aksi, alasan, waktu WIB |
| S6-12 | ✔ | **Pemasukan Lain bukan pembayaran order.** Server menolak akun pendapatan penjualan/layanan/sewa/ongkir dan akun kontra Retur & Potongan Penjualan; UI tidak menawarkannya dan menautkan ke Pembayaran & Verifikasi |

**Gap jujur S6.** Kasbon dan Pemasukan Lain langsung dibukukan di backend (tidak ada workflow approval), sehingga **tidak** masuk Inbox S4; hanya Pengeluaran, Pembelian, Tagihan, dan Refund yang punya approval. Mengubah draf adalah hak `FINANCE_ADMIN` (aturan server); pengguna biasa memakai draf lokal/draf server lalu mengajukan. Perbaikan backend yang menyertai: row lock pada bayar/batal pengeluaran & pembelian, pelunasan/batal kasbon, batal pemasukan lain.

#### S7 — Piutang, jatuh tempo, alokasi pembayaran, refund (M)

**Status: SELESAI (21 Sep 2026).** Piutang dibaca dari buku besar (`umurPiutang`, sumber yang sama dengan web): invoice, jatuh tempo, umur (ember), sisa, pembayaran resmi, alokasi. Status verifikasi pembayaran dan status order tetap milik **S5** (tautan ke detail pembayaran). Refund mengikuti sumber pembayaran, approval, jurnal, dan reversal yang sudah ada — tidak ada aturan baru.

| AC | Status | Kriteria & realisasi |
|---|---|---|
| S7-1 | ◐ | Piutang **tidak** memuat order berstatus Lunas di CRM; jumlah/total "menunggu verifikasi" ditampilkan di ringkasan (server). **Belum:** kartu itu belum dapat diketuk ke daftar pembayaran |
| S7-2 | ✔ | Umur piutang (ember) dan sisa identik dengan web (fungsi server yang sama); acuan jatuh tempo dinyatakan (invoice atau tanggal order) |
| S7-3 | ✗ | Daftar invoice dan PDF invoice **belum** dikerjakan (gap terdokumentasi); nomor, status, jatuh tempo invoice tampil di detail piutang |
| S7-4 | ✔ | Refund melebihi uang diterima ⇒ ditahan di klien (server menghitung `sisaBisaDirefund`) dan pesan server dipertahankan; refund sah ⇒ status Menunggu dan masuk Inbox S4 |
| S7-5 | n/a | Backend tidak punya pemisahan tugas untuk Refund (hanya Pengeluaran/Pembelian); tidak dikarang di klien |
| S7-6 | ✔ | Alokasi pembayaran ke beberapa order pelanggan: total wajib persis sama dengan nominal pembayaran (indikator "belum teralokasi" memakai BigInt); server membalik & memposting ulang jurnal penerimaan dan menghitung ulang status bayar order |

**Gap jujur S7.** Reversal pembayaran pelanggan, kelebihan bayar, dan pembayaran tanpa invoice tetap di luar mobile dan tidak dikarang aturannya. Refund yang sudah disetujui tidak bisa dibatalkan dari mobile (reversal tetap di web).

#### S8 — Supplier, tagihan, utang usaha, pembayaran tagihan (M)

**Status: SELESAI (21 Sep 2026).** Supplier (data, termin, rekening bank, sisa utang, tagihan terbuka, pembayaran terakhir), Tagihan supplier (umur, jatuh tempo, terbayar/sisa, pembayaran per tagihan), dan Pembayaran supplier (histori, batal admin). Pembayaran tagihan parsial/penuh dari rekening yang dipilih; status DIBAYAR_SEBAGIAN/LUNAS dari server.

| AC | Status | Kriteria & realisasi |
|---|---|---|
| S8-1 | ✔ | Umur utang, sisa, dan daftar supplier identik dengan web (fungsi server yang sama) |
| S8-2 | ◐ | Tagihan wajib memilih kategori biaya (pesan server dipertahankan). **Belum:** memilih dokumen penerimaan barang Gudang (tetap di web) |
| S8-3 | ✔ | Bayar tagihan: nominal ≤ sisa (klien & server); dua pembayaran paralel tidak bisa melebihi sisa (row lock pada tagihan) — yang kedua ditolak 409; sukses ⇒ status dari server. Pembayaran per satu tagihan (gabungan banyak tagihan tetap di web) |
| S8-4 | ✔ | Tagihan `MENUNGGU_APPROVAL` muncul di Inbox S4 dan bisa diputuskan; detail memuat tautan |
| S8-5 | ✔ | Pembatalan pembayaran (admin) membalik jurnal dan mengembalikan status tagihan; dua pembatalan paralel hanya sekali |

**Penutupan Wave 1 (21 Sep 2026).** Kualitas: backend integrasi 9 tes baru (read-model 9 modul, izin, paginasi, konkurensi bayar/batal/kasbon/pembayaran supplier, Idempotency-Key, Neraca seimbang, uji kontrak 9 modul); mobile 15 tes API, 39 tes UI, 15 tes kontrak dengan respons backend nyata. Di luar cakupan dan tidak disentuh: SANO Messenger, driver-mobile, EAS, Firebase, push, deep link, tutup buku, jurnal manual, reversal pembayaran pelanggan, saldo kalibrasi, JV-19092026-372, akun 2-1600, kebijakan akurasi, S4, S5.

### Fase D — Akuntansi & laporan

#### S9 — Jurnal, buku besar, rekonsiliasi, data belum lengkap, tinjau bukti (L)
| AC | Kriteria |
|---|---|
| S9-1 | Jurnal: filter sumber/status/cari; detail memperlihatkan baris debit/kredit dan tautan reversal; total debit = total kredit tampil dari server |
| S9-2 | Buku besar per akun: saldo berjalan dari server, periode dapat diubah |
| S9-3 | Rekonsiliasi: cocokkan/batal cocok/abaikan (alasan) bekerja; **Selesaikan** hanya untuk pemegang `FINANCE_APPROVE` dan butuh step-up |
| S9-4 | Data belum lengkap: daftar + coba lagi (`FINANCE_POST`); Accountant melihat badge di Lainnya |
| S9-5 | Tinjau bukti: verifikasi bukti oleh **bukan** pembuat; pembuat mendapat pesan server "tidak boleh memverifikasi sendiri" |
| S9-6 | Status periode tampil (baca); tidak ada tombol tutup/buka di mobile |

#### S10 — Laporan & ekspor (M)
| AC | Kriteria |
|---|---|
| S10-1 | Enam laporan menampilkan struktur & angka identik respons server; `catatan` selalu tampil |
| S10-2 | `seimbang=false` (neraca/neraca saldo) ⇒ peringatan darurat merah + selisih dari server |
| S10-3 | Ekspor CSV berisi **persis** baris yang tampil; PDF invoice bisa dibagikan; peringatan data keuangan muncul sebelum berbagi |
| S10-4 | Ganti periode memuat ulang; kosong ⇒ "Belum ada transaksi di periode ini" + catatan |

### Fase E — Notifikasi, pencarian, rilis

#### S11 — Notifikasi push & pencarian (M) — G-10, G-18 (opsional)
| AC | Kriteria |
|---|---|
| S11-1 | Pengajuan baru ⇒ approver menerima push ≤ 30 dtk; **pengaju tidak** menerimanya; layar terkunci tidak menampilkan nominal |
| S11-2 | Putusan ⇒ pengaju menerima push berisi hasil/alasan |
| S11-3 | Pembayaran/order Lunas menunggu verifikasi ⇒ digest maks 1 push/30 mnt ke pemegang `PAYMENT_WRITE`; pengingat harian 09:00 WIB |
| S11-4 | Tap push ⇒ (unlock) ⇒ layar tujuan yang benar (deep link); app tertutup/background/foreground semua lolos |
| S11-5 | Pusat notifikasi menyinkronkan status baca; badge tab konsisten |
| S11-6 | Token FCM tidak valid dibersihkan server; logout/cabut sesi menghapus token perangkat |
| S11-7 | Pencarian global menemukan nomor dokumen (`EXP-…`, `INV-…`, no. order) dari daftar terkait |

#### S12 — Hardening, performa, QA, dan rilis (L)
| AC | Kriteria |
|---|---|
| S12-1 | Semua target §10.5 tercapai pada perangkat acuan (cold start, ukuran APK, memori, fps) pada build rilis Hermes |
| S12-2 | Checklist MASVS-L1 (+ butir L2 yang dipilih) lulus dan terdokumentasi; uji MITM/root/backup/screenshot tercatat |
| S12-3 | TalkBack menavigasi alur §7.2–§7.5 dari awal sampai akhir; kontras AA di kedua tema |
| S12-4 | Regresi lengkap: suite backend finance hijau + tes klien + E2E dengan 4 persona |
| S12-5 | APK `production-apk` (EAS) didistribusikan ke 4 pengguna; OTA `eas update --channel production` dan `eas update:rollback` diuji; paksa-update diuji (naikkan `minVersionCode`) |
| S12-6 | `docs/RUNBOOK_FINANCE_MOBILE.md` selesai (build, kredensial EAS, OTA & rollback, pencabutan sesi, HP hilang) |
| S12-7 | Pilot 2 minggu dengan pengguna nyata; metrik G1–G5 diukur; daftar temuan diprioritaskan |

### 19.1 Ringkasan fase & ketergantungan

| Fase | Slice | Bisa dirilis internal? | Bergantung pada |
|---|---|---|---|
| A Fondasi | S0, S1, S2 | Tidak (belum ada fitur) | — |
| B Baca & putuskan | S3, S4, S5 | **Ya — nilai terbesar untuk Owner & Finance** | S0–S2 |
| C Mencatat | S6, S7, S8 | Ya | S0 (G-07), S3 |
| D Akuntansi | S9, S10 | Ya | S3 |
| E Rilis | S11, S12 | Rilis 1.0 | semua |

Urutan yang disarankan bila waktu terbatas: **S0 → S1 → S2 → S3 → S4 → S11(push saja) → S5 → S6 → sisanya.** Alasan: approval + posisi kas + notifikasi
langsung menjawab masalah Owner (G2, G4), sebelum fitur pencatatan yang lebih besar.

---

## 20. Risiko, keputusan terbuka, dan hal di luar cakupan

### 20.1 Risiko

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Backend punya lubang keamanan (tanpa rate limit, sesi 7 hari) yang jadi lebih berbahaya saat ada app finansial | Tinggi | G-01…G-03 = P0, memblokir rilis |
| R2 | Satu orang finance memegang POST+APPROVE | Sedang | Server melarang menyetujui pengajuan sendiri; approval pengajuan Natasha oleh Owner; peran `APPROVER` (G-15) |
| R3 | Dokumen ganda karena jaringan mobile tidak stabil (preseden 22 pengeluaran ganda) | Tinggi | G-07 wajib sebelum command uang; UI "status belum pasti" |
| R4 | Foto nota dapat diakses tanpa auth | Sedang | G-08; sementara: nama = hash konten, tidak pernah ditampilkan di log/deeplink publik |
| R5 | Blur pada Android lama lambat/panas | Sedang | Tier glass, batas 2 blur/layar, tanpa blur di daftar, uji perangkat 3 GB |
| R6 | Klien tergoda menghitung angka | Tinggi | Aturan §15.3 + lint + review; bug angka ⇒ perbaiki di server |
| R7 | Tanpa certificate pinning di 1.0 (RN butuh modul native pihak ketiga) | Rendah–Sedang | HTTPS + HSTS, token 15 menit, revoke instan; evaluasi pinning (intermediate + root) di 1.1 dengan runbook rotasi |
| R8 | Kehilangan kredensial penandatanganan Android (dikelola EAS) | Tinggi | Unduh cadangan `eas credentials`, simpan di password manager; runbook |
| R13 | OTA (EAS Update) mengirim JS yang tidak kompatibel dengan native build | Tinggi | `runtimeVersion` kebijakan **fingerprint**; kanal terpisah; uji di `preview` dulu; `eas update:rollback` |
| R14 | Modul native pihak ketiga (`expo-share-intent`, enkripsi cache) tertinggal dari SDK Expo | Sedang | Hanya modul yang mendukung SDK 57 (dicek `expo-doctor`); fitur bisa dimatikan lewat `flags` `/mobile/config`; fallback ke galeri |
| R15 | JS `Number` menyelinap ke perhitungan uang | Tinggi | Uang = string desimal, ESLint melarang `parseFloat`/`Number()` pada uang, tes `money`, review; server tetap penentu |
| R9 | Push nominal bocor di layar terkunci | Sedang | `visibility=PRIVATE`, nominal tidak di teks publik |
| R10 | Pemeliharaan oleh satu orang | Sedang | Modul sederhana, tanpa framework eksotis, dokumentasi runbook |
| R11 | Perilaku backend berubah tanpa app tahu | Rendah | Tes kontrak berbasis fixture; `min/latestVersionCode`; kompatibilitas mundur 2 versi |
| R12 | Step-up hanya klien (§11.5) | Sedang | Diterima untuk 1.0 dengan mitigasi; G-19 di 1.1 |

### 20.2 Keputusan produk yang **sudah diambil** (tanpa menunggu konfirmasi)

1. **React Native + Expo (SDK 57) + TypeScript + Expo Router**, folder `finance-mobile/`, terpisah dari `mobile/` dan `driver-mobile/` (tidak diubah). Build **EAS Build**, OTA **EAS Update** (kanal `development`/`preview`/`production`, `runtimeVersion` = `fingerprint`). *(Mengganti keputusan awal Kotlin/Compose.)*
2. 5 tab: Beranda, Transaksi, Persetujuan, Laporan, Lainnya; FAB "+" untuk aksi cepat.
3. MVP **tidak** memuat jurnal manual, tutup/buka periode, reversal, bagan akun, pengaturan finance (web-only) — risiko tinggi & butuh konteks akuntansi.
4. Kasbon tanpa approval dan hanya potong gaji (sesuai backend & keputusan owner) — tidak dimasukkan ke Pengeluaran; tampil di tab Kasbon + banner.
5. Verifikasi pembayaran hanya untuk `PAYMENT_WRITE` (Finance); Owner/Approver/Accountant baca saja.
6. Sesi mobile terpisah (access 15 mnt + refresh rotasi) dengan token format sama sehingga route existing tidak diubah.
7. Push lewat **Expo Push** (`expo-notifications`) untuk 1.0; token FCM asli didukung backend (`provider:"fcm"`); nominal tidak ditampilkan di layar terkunci; server mati-secara-default (`FINANCE_PUSH_ENABLED`).
8. Ekspor MVP: PDF invoice + CSV serialisasi + gambar; PDF/Excel laporan resmi menunggu endpoint server.
9. Distribusi awal: APK internal via **EAS** (`production-apk`, tautan/QR EAS); Play Internal Testing opsional. Uang di klien = **string desimal** (`lossless-json` di batas API).
10. Tanpa mode offline penuh; draft lokal diperbolehkan, command tidak.
11. Bahasa UI Indonesia sehari-hari; menghindari jargon ("sebelum saldo awal", "pemetaan metode") — pelajaran dari perombakan halaman Pembayaran & Verifikasi web.

### 20.3 Pertanyaan terbuka (tidak memblokir; default sudah dipilih)

| # | Pertanyaan | Default bila tidak dijawab |
|---|---|---|
| Q1 | Apakah orang divisi (sales/produksi) perlu mengajukan reimbursement lewat app ini? | Tidak (MVP) — tetap web / app Sales |
| Q2 | Siapa yang menjadi Accountant & Approver pertama? | Role disiapkan, belum ada akun; Owner tetap penyetuju |
| Q3 | Ambang nominal yang butuh konfirmasi tambahan (double-confirm) di app? | Semua command uang memakai dialog konfirmasi + step-up; ambang khusus tidak ada |
| Q4 | Perlu 2FA (TOTP) sebelum 1.0? | Tidak; PIN + biometrik + sesi perangkat cukup untuk tim 4 orang; evaluasi 1.1 |
| Q5 | Akun **Expo/EAS** (organisasi `sanocare`, proyek baru `finance-mobile`) dan **Firebase** (kunci FCM V1 untuk push) dimiliki siapa? | Akun perusahaan (bukan pribadi); `eas init` + unggah kunci FCM **wajib sebelum build pertama & S11** — lihat blocker di `finance-mobile/README.md` |
| Q6 | Kebijakan ganti `PAYMENT_WRITE` untuk Owner (agar Owner juga bisa verifikasi)? | Tidak — sengaja hanya Finance (pemisahan tugas) |

### 20.4 Di luar cakupan dokumen ini

Implementasi aplikasi, pembuatan proyek Android, dan perubahan backend **belum dikerjakan**. Dokumen ini adalah dasar
kerja S0–S12. Perubahan kode pertama yang disarankan: **S0** (backend), karena semua slice bergantung padanya.

---

## Lampiran A — Padanan halaman web → layar mobile

| Halaman web (`frontend/src/pages/finance/`) | Layar mobile | Catatan |
|---|---|---|
| `FinanceDashboard.jsx` | H1 | Diringkas; tren & ring chart |
| `FinancePayments.jsx` (+ `LunasBelumDicatat.jsx`) | P1–P4 | Alokasi ke banyak order ditunda |
| `FinanceCash.jsx` | K1, K2, T12, T11 | Kelola rekening: web saja |
| `FinanceExpenses.jsx` | T1 (Pengeluaran), T3, T4 | + bukti/koreksi/batal |
| `FinancePurchases.jsx` | T1 (Pembelian), T5, T6 | |
| `FinanceKasbon.jsx` | T7–T10 | |
| `FinanceInvoices.jsx` | R3, R4 | Ubah jatuh tempo: web |
| `FinanceReceivables.jsx` | R1, R2, R5, R6 | |
| `FinanceSuppliers.jsx` | S1–S5 | |
| `FinanceJournal.jsx` | J1, J2 | Baca saja |
| `FinanceLedger.jsx` | J3 | |
| `FinanceReconciliation.jsx` | J4, J5 | Impor baris: web |
| `FinanceReports.jsx` | L1–L7 | |
| `FinanceAccounts.jsx`, `FinanceSettings.jsx` | — | Web saja |
| `features/finance/BuktiReview.jsx` | B1 | |

## Lampiran B — Daftar kode akun sistem yang relevan untuk teks bantuan

Piutang Usaha `1-1300` · Piutang Karyawan `1-1350` · Uang Muka Pembelian `1-1500` · Utang Gaji `2-1500` · Beban Gaji `6-1100` ·
Pembelian Bahan Baku (manual) `5-1150`. (Ditampilkan hanya sebagai keterangan detail jurnal; app tidak memakainya untuk logika.)

## Lampiran C — Referensi kode yang menjadi dasar audit

`backend/src/routes/finance.js`, `financeTransactions.js`, `financeKasbon.js`, `financePenerimaan.js` · `services/finance/*` (journal, reports, money, settings, receipts, penerimaanOrder, posting/*) ·
`constants/permissions.js` · `middleware/auth.js`, `authorize.js` · `routes/auth.js`, `activity.js`, `armada.js:4766` · `lib/activityLog.js` ·
`services/expoPush.js`, `pushNotifications.js` · `prisma/schema.prisma` (model `Fin*`, `PushToken`, `PushSubscription`, `Role`) ·
`frontend/src/pages/finance/*`, `frontend/src/features/finance/*` · `docs/design-system/sano-color-system.md` · `docs/BUILD-APK.md` · `mobile/`, `driver-mobile/`.

