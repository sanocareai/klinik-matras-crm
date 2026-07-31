# Sano Hub — Catatan Keputusan (ADR)

Keputusan arsitektur yang sudah DIKUNCI, beserta alasannya. Append-only:
kalau keputusan berubah, tambah entri baru yang menggantikan (`Menggantikan:
D-00x`), jangan edit yang lama.

Sumber: sesi keputusan 31 Juli 2026 bersama Gilang.
Requirement dasar: `docs/SANSS-PRD-v1.md` (lihat banner "SUPERSEDED" di sana).

---

## D-001 — Sano Hub adalah PERLUASAN CRM, bukan sistem baru

**Konteks.** `docs/SANSS_CLAUDE.md` mengunci stack Next.js 15 + Supabase +
Vercel, dengan project Supabase TERPISAH dari CRM (PRD §9.2). CRM yang jalan
di production memakai React+Vite (plain JS) + Express + Prisma + PostgreSQL
self-hosted + WAHA + nginx di VPS Sumopod, plus app Expo untuk sales.

**Keputusan.** Sano Hub dibangun DI DALAM repo & stack CRM yang sudah ada.
Tidak ada Supabase, tidak ada Next.js, tidak ada database kedua. Nama SANSS
dipensiunkan — sistemnya bernama **Sano Hub**.

**Alasan.**
1. PRD §1.3 sendiri melarang "tiga portal = tiga aplikasi". Project Supabase
   terpisah membuat CRM dan Sano Hub jadi DUA aplikasi dengan dua database
   dan dua login — pelanggaran aturan yang sama, cuma naik satu tingkat.
2. `Customer`, `Order`, `Conversation` sudah ada di Postgres ini. `Unit` perlu
   menempel ke `Order`. Satu database = foreign key. Dua database = job sinkron
   yang PASTI melenceng, dan melencengnya ke arah "kasur yang dipegang bengkel
   tidak ada di CRM".
3. CLAUDE.md §2: sistem harus bisa dirawat 1 orang dengan skill coding moderat.
   Dua stack = dua dari segalanya.

**Konsekuensi.** Yang di Supabase gratis (RLS, Realtime, Storage, auth OTP
telepon) harus dibangun sendiri di Express. Sebagian sudah ada: `socket.js` +
SSE untuk realtime, JWT + FCM untuk app mobile, multer untuk upload. Yang
benar-benar baru: otorisasi per-baris (pengganti RLS) — lihat D-010.

---

## D-002 — Unit adalah entitas inti, bukan Order

**Keputusan.** Satu Order bisa berisi banyak Unit (kasur fisik). Setiap Unit
punya QR sendiri, diagnosa sendiri, racikan sendiri, tahap produksi sendiri,
foto sendiri, dan selesai di waktunya sendiri. `Order.status` menjadi
**turunan** dari status Unit-Unitnya, tidak pernah di-set langsung.

**Alasan.** Pesanan hotel 30 kasur tidak pernah berada di satu status. Lihat
juga D-006.

**Konsekuensi.** `OrderStatus` yang sekarang (`PENDING → PICKUP → PROCESSING
→ READY → DELIVERED`) berhenti jadi sumber kebenaran dan berubah jadi hasil
rollup. Order lama di-backfill sebagai order 1 unit. Ini menyentuh UI Order
di web, app mobile, dan laporan — pekerjaan nyata, bukan sekadar tambah tabel.

---

## D-003 — Routing = satu tulang punggung + modul, bukan template per layanan

**Keputusan.** Enam layanan TIDAK dimodelkan sebagai enam routing template.
Dimodelkan sebagai satu urutan tetap (intake → modul kerja → finishing) dengan
modul kerja yang dipilih per unit. Detail lengkap: `ROUTING.md`.

**Alasan.** Enam template menduplikasi kepala & ekor yang sama enam kali;
menambah layanan ketujuh berarti menambah template. Dengan modul, layanan baru
= satu baris data.

**Konsekuensi.** `OrderItem` yang sudah ada (add-on layanan berharga per baris)
JADI sumber pemilihan modul. Bukan struktur paralel yang harus disinkronkan
sales secara manual.

---

## D-004 — SERVICE dan UPGRADE adalah dua lini produk, bukan dua tingkat intensitas

**Keputusan.** Setiap layanan punya atribut `service_line`:

| Lini | Tujuan | Material | Garansi |
|---|---|---|---|
| `SERVICE` | Restorasi — mengembalikan kasur ke kondisi layak | grade standar | tingkat Standard |
| `UPGRADE` | Membangun ke standar Matras Sehat, disetel ke berat badan | premium, khusus Matras Sehat | tingkat Premium |

Modul kerja terikat ke lini. **Satu unit tidak boleh mencampur modul lintas
lini** — Full Service memakai material grade service di SELURUH modulnya.

**Alasan.** Kata Gilang: "tambah busa ini hanya untuk layanan service, bukan
fokus ke kasur sehat, jadi lebih ke restorasi — bahan baku beda, garansi pun
beda. Kalau upgrade, material lebih premium dan benar-benar dibuat khusus
untuk kasur sehat."

**Konsekuensi.** Lini menentukan katalog material (BoM), termin garansi, dan
lead time produksi. Revisi scope di Uji Fondasi bisa berupa **pindah lini**
(service → upgrade), bukan cuma tukar modul — delta harganya jauh lebih besar
dan wajib persetujuan customer.

**ASUMSI YANG PERLU DIKONFIRMASI:** `SERVICE` → paket garansi Standard (amblas
10th, busa 5th, trial 7 hari, pengerjaan 7 hari) dan `UPGRADE` → Premium
(amblas 20th, busa 10th, trial 30 hari, pengerjaan 3 hari), mengikuti CLAUDE.md
§16.8. Kalau pemetaannya tidak 1:1, garansi jadi atribut sendiri di katalog
layanan, bukan turunan dari lini.

---

## D-005 — QC adalah Uji Berat Badan, dan letaknya SEBELUM Jahit Corner

**Keputusan.** Tahap `fit_test` (Uji Berat Badan) adalah gerbang wajib sebelum
`corner_sewing` (Jahit Corner). Perakitan TIDAK jadi tahap tersendiri — sudah
termasuk di dalam tahap uji ini.

Hasil uji direkam sebagai putusan, bukan lulus/gagal boolean:
`TERLALU_KERAS | PAS | TERLALU_EMPUK`, beserta berat badan acuan dan keluhan
awal customer. Gagal → balik ke modul lapisan (dihitung sebagai rework), bukan
balik ke awal.

**Alasan.** Kata Gilang: "perakitan biasanya cepat, yang paling krusial adalah
uji-nya karena tekstur kasur — keras, empuk, pas-nya." Letaknya sebelum jahit
corner karena setelah corner dijahit, membuka lagi mahal. Jadi ini gerbang
sebelum langkah yang tidak bisa dibatalkan.

**Konsekuensi — ini nilai jangka panjang terbesar sistem ini.** Setiap uji
menyimpan (berat badan → keluhan → racikan → putusan). Setelah beberapa ratus
unit, tacit knowledge Production Lead & QC Leader berubah jadi DATA: "untuk
75kg dengan keluhan pinggang, racikan X keluar PAS." Itu fondasi FR-G-03 di PRD
(sistem menyarankan racikan) — tanpa perlu dibangun sebagai fitur terpisah,
cukup direkam sejak hari pertama.

---

## D-006 — Pengiriman bertahap wajib ada di v1

**Keputusan.** Satu Order bisa dikirim dalam beberapa **Batch** (tahap 1,
tahap 2, ...). Batch mengelompokkan sebagian Unit jadi satu pengiriman. Status
order adalah rollup ("12 terkirim, 8 siap, 10 produksi"), bukan satu state.

**Alasan.** Kata Gilang: pesanan hotel dikirim bertahap — 15 dulu, 15 lagi;
atau customer minta 10 duluan cepat, sisanya ikut timeline produksi.

**Konsekuensi.** Ini mematikan model status di level order (memperkuat D-002).
Aturan PRD §5.2 "satu job pickup = satu order saja" juga perlu ditinjau: 30
kasur hotel hampir pasti butuh beberapa kali angkut.

---

## D-007 — Hold atas permintaan customer BUKAN blok produksi

**Keputusan.** Unit yang sudah selesai tapi ditahan atas permintaan customer
masuk state `READY_ON_CUSTOMER_HOLD`. Jamnya berhenti terpisah dari jam blok
produksi, dan TIDAK dihitung dalam metrik turnaround maupun on-time delivery.

**Alasan.** Kata Gilang: stok selalu ada, kasur tidak pernah ditahan lewat
tanggal karena masalah kita — tapi customer bisa minta tunda pengiriman
walaupun kasur sudah jadi.

**Konsekuensi.** Kalau hold customer dicampur dengan keterlambatan kita, data
TAT jadi sampah dalam hitungan minggu — kita akan terlihat telat di pekerjaan
yang justru selesai lebih cepat. Dua jam, dua metrik, sejak awal.

---

## D-008 — Revisi scope masuk Phase 1, bukan Phase 4

**Keputusan.** Alur ScopeRevision (PRD §7.4) naik ke Phase 1.

**Alasan.** Tahap `foundation_test` (Uji Fondasi) ADA justru untuk menentukan
seberapa layak fondasi — artinya di situlah jenis layanan ditetapkan/direvisi,
bukan saat sales input order. Sales menjual "Service Fondasi", bongkar
menunjukkan per sudah habis, pekerjaan berubah jadi "Upgrade Fondasi", harga
berubah. Ini kejadian paling umum di bisnis ini dan sekarang dinegosiasikan
lewat WhatsApp lalu hilang.

**Konsekuensi.** Tanpa ini, total order diam-diam menyimpang dari yang benar-
benar ditagih.

---

## D-009 — Racikan ditentukan Production Lead + QC Leader; override customer WAJIB dicatat

**Keputusan.** Racikan/layering ditentukan Production Lead dan QC Leader
berdasarkan berat badan + keluhan. Customer dilibatkan dan boleh minta lebih
keras/lebih empuk dari titik "pas" — permintaan itu direkam sebagai
`customer_preference_override` beserta catatan edukasi yang sudah diberikan.

**Alasan.** Kata Gilang: "customer harus ikut karena tujuannya kasur sehat
untuk dia... kalau customer ingin lebih keras atau lebih empuk bisa, tapi kita
tetap edukasi kalau ini tidak baik untuk tubuh. Indikator pas atau tidak itu
dari berat badan."

**Konsekuensi.** Override customer adalah **catatan liability**, bukan sekadar
preferensi. Kalau customer memaksa "lebih empuk" melawan saran lalu kemudian
komplain sakit pinggang, catatan itu adalah pembelaan garansi. Hari ini catatan
seperti ini tidak tersimpan di mana pun.

---

## D-010 — Role melar dari ADMIN/SALES

**Konteks.** `enum Role` sekarang cuma `ADMIN | SALES` untuk 7 user.

**Keputusan.** Role bertambah: `PRODUCTION_LEAD`, `PRODUCTION_WORKER`,
`QC_LEAD`, `WAREHOUSE`, `DISPATCHER`, `DRIVER`, `FINANCE`. Satu orang boleh
punya lebih dari satu role — permission bersifat aditif. **Tidak ada
"super admin bisa segalanya" sebagai default**, karena itu menghancurkan jejak
audit yang justru jadi alasan sistem ini dibangun.

**Konsekuensi.** `Role` tunggal di `User` tidak cukup lagi → tabel `UserRole`
(many-to-many). Otorisasi per-baris jadi middleware Express, bukan RLS
Postgres: driver hanya baca job miliknya (hari ini ±1), pekerja produksi tidak
melihat nomor telepon customer maupun harga.

---

## D-017 — Bug nyata: dua `getMe` di api.js membuat auto-skip Portal rusak total, tanpa error

**Bukan keputusan desain — catatan insiden**, disimpan di sini karena caranya
ditemukan lebih penting daripada perbaikannya sendiri.

**Yang terjadi.** `frontend/src/api.js` punya DUA properti bernama `getMe`
dalam satu object literal yang sama: satu ditambahkan Phase 0
(`request("/auth/me")`, dipakai Portal.jsx untuk auto-skip role-tunggal),
satu lagi sudah ada duluan (`request("/users/me")`, dipakai Automation.jsx).
JavaScript membiarkan key kedua diam-diam MENIMPA yang pertama — tidak ada
error, tidak ada warning, build tetap sukses, ESLint (kalau ada) mungkin juga
diam. `api.getMe` di seluruh aplikasi ternyata selalu memanggil `/users/me`.

**Akibatnya:** Portal.jsx memanggil endpoint yang TIDAK PUNYA field
`portals`, jadi `me.portals || []` selalu jatuh ke array kosong, dan
auto-skip role-tunggal (dibangun & "diverifikasi" di Phase 0) SEBENARNYA
tidak pernah berfungsi di browser sungguhan — sampai ditemukan saat menguji
Armada.

**Kenapa lolos dari verifikasi Phase 0 sebelumnya:** tes browser Phase 0
untuk portal SELALU menavigasi LANGSUNG ke halaman tujuan (`/bengkel`, dst)
lewat URL, bukan lewat login → auto-redirect dari `/portal`. Jalur kode yang
sebenarnya dipakai user asli (login → /portal → auto-skip) TIDAK PERNAH
benar-benar dilewati sampai sesi ini.

**Perbaikan.** `getMe` Sano Hub diganti nama jadi `getMyPortals` (lihat
komentar panjang di api.js persis di baris itu — jangan dihapus, itu
pengingat supaya nama "getMe" tidak dipakai lagi di file ini). `getMe` lama
(`/users/me`) dibiarkan apa adanya untuk Automation.jsx.

**Pelajaran yang DIPEGANG, bukan cuma dicatat:** "kode terlihat benar" dan
"sudah pernah dites" adalah dua klaim berbeda. Tes yang mem-bypass jalur asli
(langsung ke URL tujuan alih-alih lewat alur normal user) bisa lolos 100%
sambil jalur yang SEBENARNYA dipakai tetap rusak. Sejak insiden ini,
verifikasi UI Sano Hub SELALU dimulai dari login lalu diikuti sampai ke
tujuan lewat navigasi yang SAMA PERSIS dengan yang akan dilakukan user —
bukan jalan pintas ke URL akhir.

---

## D-016 — Kirim dokumentasi lewat WAHA langsung dari CRM (menggantikan asumsi D-015)

**Menggantikan asumsi di D-015** ("sistem menyiapkan, sales forward manual
lewat WhatsApp pribadi").

**Konteks (Gilang, 31 Juli 2026).** Diminta eksplisit: "lanjut bikin kirim ke
customer via WAHA." Sales tidak lagi perlu save-lalu-forward manual — tab
Dokumentasi (D-015) sekarang punya tombol kirim langsung.

**Keputusan.** `POST /conversations/:id/send-documentation`, MENIRU PERSIS
pola `/conversations/:id/send-product` yang sudah dipercaya di production
(delay 1500ms antar foto, `sendWithSessionFallback` CS-1/CS-2, pesan error
`SESSION_UNKNOWN_ERROR` yang sama) — bukan jalur kirim baru dari nol. Beda
utamanya: tiap TAHAP dapat caption sendiri (nama tahap + catatan), bukan satu
caption di foto terakhir seperti send-product, supaya customer paham "ini
foto tahap apa".

**Manusia tetap memutuskan, cuma jalurnya pindah.** Sales melihat foto,
MENCENTANG tahap mana yang mau dikirim, baru menekan kirim — bukan sistem
auto-kirim begitu kepala produksi mencatat tahap selesai. Prinsip D-015
("manusia mereview sebelum sampai ke customer") tetap dipegang, cuma
reviewnya sekarang terjadi di CRM alih-alih di aplikasi WhatsApp pribadi sales.

**Pengaman yang WAJIB ada, ditambahkan di endpoint ini:**
1. **Validasi kepemilikan order↔conversation** — order yang dikirim HARUS
   milik `customerId` yang sama dengan percakapan tujuan. Tanpa ini, salah
   klik di tab browser lain bisa mengirim foto kasur customer A ke chat
   customer B.
2. **Whitelist path foto** (`/media/unit-photos/...` saja) — `entries` datang
   dari body request yang dikontrol klien. Tanpa filter ini, endpoint bisa
   dipaksa mem-fetch URL APA SAJA dan mengirimkannya sebagai lampiran WhatsApp
   (SSRF lewat parameter file WAHA).

**Permission:** TIDAK ada perubahan — endpoint ini ikut pola
`conversations.js` yang sudah ada (`requireAuth` polos, bukan
`requirePermission` granular Sano Hub), konsisten dengan seluruh endpoint
kirim pesan lain di file yang sama. SALES sudah punya `CONVERSATION_WRITE`
dari sebelumnya.

**Diverifikasi TANPA mengirim pesan WhatsApp sungguhan** (tidak ada sesi WAHA
nyata di lingkungan verifikasi, dan mengirim ke nomor uji buatan bukan hal
yang pantas dicoba): seluruh cabang validasi diuji lewat curl (orderId
hilang, entries kosong, conversation tidak ada, order↔customer tidak cocok,
URL foto berbahaya difilter), dan jalur kirim asli diuji sampai titik
"WAHA tidak terjangkau" — sistem gagal dengan bersih (409
`SESSION_UNKNOWN_ERROR`, log rapi per foto, tidak crash), PERSIS seperti
perilaku send-product yang sudah dipercaya. UI (checkbox, tombol, hitungan
tahap terpilih) diverifikasi lewat browser sungguhan sampai tepat sebelum
tombol kirim ditekan.

---

## D-014 — Model kiosk scan DIBATALKAN, diganti Papan Produksi Harian

**Menggantikan sebagian D-005 dan asumsi PRD §1.6 / §7.5 (FR-P-01, FR-P-02).**

**Konteks (klarifikasi Gilang, 31 Juli 2026).** PRD mengasumsikan tiap pekerja
scan QR di stasiunnya lalu tap tahapnya sendiri ("workers must not type",
kiosk mode, label QR sebagai tiket kerja fisik). Itu SALAH untuk cara Sano
bekerja. Kenyataannya:

- **Satu orang** (QC Leader / kepala produksi) yang meng-update SELURUH proses
  kasur, bukan tiap pekerja di stasiun masing-masing.
- **ID Order sudah cukup** sebagai identitas. Tidak perlu label QR per unit.
- Update dilakukan **manual dan terkumpul**, bukan scan per kejadian.

**Alur sebenarnya:**
```
Sales input order (CRM, ID auto-generate — sudah ada, CLAUDE.md §7D)
  → Admin bikin jalur PENGAMBILAN (rute harian; Sano ambil orderan tiap hari,
    bukan cuma mengirim)
  → Driver jemput kasur           → dokumentasi foto → grup driver WA
  → Kepala produksi bikin TARGET HARIAN (pilih order ID yang dikerjakan hari itu)
  → Produksi jalan                → tiap proses & uji didokumentasikan
  → Sebelum tutup: kepala produksi UPDATE HASIL HARI ITU ke grup
  → Kasur selesai
  → Admin bikin jalur PENGIRIMAN (rute harian)
  → Driver kirim                  → dokumentasi foto → grup driver WA
```

**Keputusan.**
1. `BengkelKiosk.jsx` (scan satu unit per waktu) DIHAPUS — bentuk interaksinya
   salah, bukan sekadar perlu diperbaiki.
2. Diganti **Papan Produksi Harian**: target pagi, update sore, banyak unit
   sekaligus.
3. **Label QR + printer termal TIDAK JADI dibeli.** Instruksi di PHASE-0.md §3
   poin 1 dibatalkan.

**Konsekuensi yang harus diingat — arti `unit_stage_logs.actor_id` BERUBAH.**
Dulu dirancang sebagai "siapa yang MENGERJAKAN". Sekarang isinya selalu
"siapa yang MENCATAT" (QC Leader). **Jangan pernah membuat laporan
produktivitas per pekerja dari kolom ini** — datanya tidak pernah berarti itu.
Kalau produktivitas per pekerja memang mau diukur nanti, butuh kolom/tabel
sendiri, bukan menafsir ulang kolom ini.

**Yang TETAP berlaku** (lapisan data tidak berubah sama sekali): `Unit`
(D-002), `routing_stages` sebagai data (D-003), ledger append-only
`unit_stage_logs`, `Job` PICKUP/DELIVERY, `qc_fit_tests`. Tahap-tahapnya nyata
— tiap proses memang didokumentasikan — hanya CARA mencatatnya yang berbeda.

---

## D-015 — Dokumentasi WhatsApp adalah produknya, bukan efek samping

**Konteks (Gilang, 31 Juli 2026).** "Kelebihan Sano: setiap proses, uji dan
lainnya kita dokumentasi dan kirim WhatsApp ke customer, sales tinggal forward
hasil dokumentasi ke customer." Penjemputan & pengiriman driver juga
terdokumentasi di grup WA driver.

**Masalahnya:** seluruh dokumentasi itu sekarang hidup DI DALAM thread
WhatsApp. Tidak bisa dicari, tidak menempel ke order, dan hilang begitu orang
yang memegangnya keluar.

**Keputusan.** Foto per tahap disimpan menempel ke `unit_stage_logs`
(kolom `photo_urls` sudah ada sejak migrasi 20260731130000), lalu bisa dilihat
sebagai satu berkas dokumentasi per order.

**ASUMSI YANG DIPAKAI (belum dikonfirmasi — mudah dibalik):** sistem
MENYIAPKAN paket dokumentasinya, **sales yang forward manual** ke customer —
BUKAN kirim otomatis. Alasannya: itu yang dilakukan sekarang, dan ada manusia
yang memeriksa sebelum sesuatu sampai ke customer. Kirim otomatis lewat WAHA
gampang ditambahkan nanti kalau memang diinginkan.

**Kenapa ini penting lebih dari sekadar "fitur foto":** foto yang sama melayani
empat fungsi sekaligus — update ke customer, bukti garansi, pembelaan kalau ada
sengketa, dan materi marketing. PRD §7.5 sudah bilang "photo discipline is the
product"; klarifikasi ini menegaskan itu bukan retorika.

---

## D-013 — ADMIN tidak boleh memajukan tahap produksi atau memutuskan QC

**Keputusan.** Role `ADMIN` mendapat hampir semua permission, KECUALI
`UNIT_STAGE_WRITE`, `QC_WRITE`, dan `PAYMENT_WRITE`.

**Alasan.** PRD §3 melarang "super admin bisa segalanya" sebagai default karena
menghancurkan jejak audit yang justru jadi alasan sistem ini dibangun. Kalau
admin bisa memajukan tahap, kolom "siapa yang mengerjakan" di `unit_stage_logs`
berhenti bisa dipercaya — dan seluruh data cycle time ikut kehilangan arti.
Hal yang sama berlaku untuk putusan QC dan pencatatan uang.

**Konsekuensi.** Kalau Gilang memang ikut mengerjakan di bengkel atau menguji
QC, jalan keluarnya BUKAN melebarkan ADMIN — tapi memberinya role
`PRODUCTION_LEAD` / `QC_LEAD` sebagai TAMBAHAN. Itu justru gunanya multi-role
(D-010), dan hasilnya jejak audit tetap jujur: yang tercatat adalah orangnya,
bukan "admin".

Diuji eksplisit di `backend/tests/authorize.test.js`.

---

## D-012 — merk/ukuran jadi kolom asli di Unit, bukan JSON di dalam notes

**Konteks (temuan 31 Juli 2026).** `merkKasur`, `ukuranKasur`, dan
`keluhanCustomer` bukan kolom database. Ketiganya di-`JSON.stringify` ke dalam
`Order.notes` oleh `buildNotes()` di frontend web dan mobile (dua salinan
terpisah dari fungsi yang sama), lalu dibaca balik oleh `parseNotes()`. Baris
lama berisi teks polos dan ditangani lewat `catch` sebagai keluhan saja.

**Keputusan.** `Unit.merk` dan `Unit.ukuran` jadi kolom asli. Backfill
mem-parse blob JSON `Order.notes` dengan parser yang aman gagal (NULL, bukan
error). `Order.notes` TIDAK diubah di Phase 0 — masih ditulis & dibaca klien
seperti biasa.

**Alasan.** Merk & ukuran adalah sifat KASUR, bukan sifat order — order berisi
satu queen dan satu king tidak bisa diwakili satu pasang nilai. Selain itu
kolom di dalam blob JSON tidak bisa di-index, di-filter, atau di-agregasi,
padahal papan bengkel akan butuh persis itu.

**Konsekuensi.** Sementara ada dua tempat penyimpanan (blob lama tetap jadi
sumber kebenaran untuk UI yang jalan, kolom Unit untuk Sano Hub). Ini disengaja
dan berbatas waktu: begitu UI order beralih ke Unit di Phase 1, blob-nya
dipensiunkan dan `keluhanCustomer` dinormalkan jadi kolom `Order`. Jangan
biarkan keadaan dua-sumber ini hidup melewati Phase 1.

**Catatan terpisah, BUKAN bagian migrasi ini** — dua hal ditemukan saat
membaca `routes/orders.js` dan perlu diperbaiki sendiri:
1. `PATCH /api/orders/:id` menerima `merkKasur`/`ukuranKasur`/
   `keluhanCustomer`/`jenisLayanan` sebagai field Prisma top-level yang TIDAK
   ADA di skema maupun migrasi mana pun. Belum meledak karena tidak ada klien
   yang mengirimnya (semua mengirim `notes`) — ranjau, bukan kerusakan aktif.
2. Endpoint yang sama menerima `hargaTotal` dan menulisnya langsung ke
   `Order.value`, padahal `syncOrderValue()` menghitung ulang `value` dari
   `SUM(items.harga)` — dan komentar route-nya sendiri bilang `value` tidak
   boleh diubah dari sini. Ini kandidat kuat penyebab bug yang sudah tercatat
   di CLAUDE.md: "header order tampil Rp1.000.000 tapi breakdown add-ons
   tampil Total: Rp0".

---

## D-011 — Pembayaran tunai ke driver masuk v1

**Keputusan.** Driver mencatat penerimaan (jumlah + metode + foto bukti) di
stop pengiriman, dengan rekonsiliasi harian per driver dan verifikasi finance.

**Alasan.** Kata Gilang: terkadang customer bayar cash ke driver, dan itu
dilaporkan lewat grup WhatsApp dengan foto uang. Volumenya kecil (jadi murah
dibangun), tapi ini SATU-SATUNYA jejak audit kas yang ada sekarang — permukaan
kebocoran paling nyata di operasi.
