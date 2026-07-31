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

## D-018 — Dokumentasi driver ke grup WA OTOMATIS, bukan lewat klik manual

**Konteks (Gilang, 31 Juli 2026).** "Penjemputan dan pengambilan
terdokumentasi di grup driver whatsapp."

**Beda dengan D-016 (dokumentasi ke CUSTOMER, lewat sales, wajib klik
manual).** Di sini target-nya grup ops INTERNAL, bukan customer. Pola yang
Gilang gambarkan ("kepala produksi update ke grup" — D-014) memang berupa
praktik rutin yang diharapkan otomatis terjadi, bukan sesuatu yang direview
per pesan. Jadi begitu driver menekan Selesai/Gagal (dengan foto yang SUDAH
wajib diisi di langkah itu), foto langsung terkirim ke grup — TANPA langkah
klik konfirmasi tambahan.

**Keputusan.**
1. `Conversation.isDriverGroup` (boolean, migrasi 20260801110000) — grup WA
   mana yang ditugaskan. Index unik PARSIAL di database (`WHERE
   isDriverGroup = true`) memastikan cuma SATU grup aktif kapan pun; ADMIN
   ganti lewat `PUT /api/armada/driver-group`, sekali di awal.
2. `notifyDriverGroup()` di `armada.js` dipanggil dari `/complete` dan
   `/fail`, TIDAK di-`await` (fire-and-forget + `.catch()`) — job yang sudah
   selesai/gagal ADALAH kebenaran (baris Unit/Job), posting ke grup cuma
   dokumentasi tambahan. Kalau grup belum ditetapkan atau WAHA gagal, job
   TETAP sukses; cuma dokumentasinya yang tidak terkirim. Diverifikasi
   eksplisit: job tetap `COMPLETED` walau kirim ke grup gagal total (tidak
   ada WAHA nyata di lingkungan tes).
3. Menandai grup mana yang "Grup Driver" perlu `CONVERSATION_READ` (melihat
   daftar grup) — role `DISPATCHER` TIDAK punya permission itu (lihat
   permissions.js), jadi endpoint ini `ADMIN` only (`P.USER_MANAGE`),
   BUKAN `JOB_WRITE`. Bukan pembatasan baru, konsekuensi dari model
   permission yang sudah ada.

**Kenapa BUKAN driver yang memilih grup tiap kali:** role `DRIVER` sengaja
tidak diberi `CONVERSATION_READ` sama sekali (Phase 0) — driver tidak boleh
menjelajah Inbox. Meminta driver "pilih grup" tiap job selesai bukan cuma
gesekan ekstra (bertentangan dengan D-014's "satu tap"), tapi juga butuh
permission yang sengaja tidak diberikan ke role itu.

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

**Implementasi (1 Agustus 2026).** Dua tabel: `payments` (APPEND-ONLY —
amount, method CASH/TRANSFER/QRIS, foto bukti opsional, siapa yang mencatat)
dan `payment_verifications` (baris terpisah, bukan kolom `verifiedAt` di
`payments`, supaya `payments` tetap murni INSERT sesuai aturan ledger di
CLAUDE.md). "Sudah diverifikasi?" = ADA baris di `payment_verifications`
untuk payment itu, bukan status yang bisa di-toggle bolak-balik.

Endpoint: `POST /armada/jobs/:id/payment` (driver, HANYA job DELIVERY — D-011
lahir dari kasus "bayar cash saat kasur diantar", bukan saat diambil),
`GET /armada/payments` (PAYMENT_READ — ADMIN+FINANCE), `POST
/armada/payments/:id/verify` (PAYMENT_WRITE — FINANCE saja, ADMIN sengaja
TIDAK punya ini, sama prinsipnya dengan D-013: siapa yang boleh mencatat
uang masuk harus jelas, bukan admin serba-bisa). UI: form pencatatan di
`DriverJobs.jsx` (foto bukti WAJIB kalau metode CASH, opsional untuk
transfer/QRIS), rekonsiliasi finance di `Kendali.jsx` — bagian ini punya
loading/error state sendiri, terpisah dari overview, karena PAYMENT_READ
tidak otomatis dipegang SEMUA role yang boleh buka portal Kendali (ADMIN
dan FINANCE keduanya punya PAYMENT_READ jadi keduanya lihat daftar
pembayaran, tapi tombol "Verifikasi" cuma muncul untuk role FINANCE —
dicek dari `roles` di localStorage, bukan tebakan dari role tunggal lama).

---

## D-019 — Login driver: email+password biasa, akun dibuatkan admin (bukan OTP, bukan Google)

**Keputusan.** Asumsi terbuka #4 di CLAUDE.md ("skema login driver — OTP
telepon vs akun yang dibuatkan") ditutup: driver login PERSIS seperti role
lain — email + password, akun dibuat admin di halaman Pengguna & Peran. Tidak
ada OTP telepon, tidak ada Google/OAuth apa pun. Kata Gilang: "login driver
via otp gaperlu, login hanya by email aja dan email nya kita yang bikin
gaperlu pakai google."

Sebagai bagian dari keputusan ini, `Pengguna.jsx` dan `routes/users.js`
diperluas dari 3 peran (ADMIN/SALES/CS) jadi men-dukung SEMUA 9 peran di
`Role` enum, termasuk DRIVER — sebelumnya admin TIDAK PUNYA cara lewat UI
untuk memberi seseorang peran Sano Hub apa pun (DRIVER, DISPATCHER,
PRODUCTION_LEAD, dst), cuma bisa lewat manipulasi DB langsung. Endpoint baru:
`POST /users/:id/roles` dan `DELETE /users/:id/roles/:role`, aditif sesuai
D-010 — satu user bisa pegang beberapa peran sekaligus, dicentang/dihapus
satu-satu, dengan penjagaan tidak boleh menyisakan user tanpa peran sama
sekali.

**Bug nyata yang ikut ditemukan & diperbaiki di jalan.** `ROLE_LABELS` lama
di `Pengguna.jsx` punya opsi "CS" — padahal `Role` enum di `schema.prisma`
TIDAK PERNAH punya value `CS` sejak migrasi ke multi-role (D-010). Membuat
user dengan peran itu akan gagal di Prisma tanpa pesan yang jelas ke admin.
Tidak ada yang pernah mencobanya sampai sekarang (makanya lolos tanpa
ketahuan) — kemungkinan sisa dari sebelum `Role` enum diperluas.

**Detail teknis penting.** `rolesOf()`/`loadRoles()` (auth.js, authorize.js)
fallback ke kolom `role` tunggal HANYA kalau tabel `user_roles` benar-benar
kosong untuk user itu — begitu ada SATU baris, kolom lama berhenti dibaca
sama sekali untuk keperluan otorisasi. Ini jebakan nyata: kalau admin
menambah satu peran Sano Hub ke user yang sudah punya akses lewat kolom lama
(mis. SALES), tanpa penanganan khusus mereka bisa kehilangan akses SALES
begitu saja. Ditangani dengan `materializeRoles()` — SEBELUM add/remove
apa pun, kalau `user_roles` masih kosong, isi dulu dengan `role` lama user
itu, baru proses perubahan yang diminta. User baru (dibuat lewat modal
Tambah Pengguna) langsung dapat baris `user_roles` sejak awal, tidak pernah
lewat jalur fallback ini sama sekali.

**Konsekuensi.** `PATCH /users/:id` dengan field `role` (kolom tunggal lama)
masih ada di backend untuk kompatibilitas, tapi UI baru tidak memakainya lagi
— semua perubahan peran lewat `POST`/`DELETE /users/:id/roles`. Kolom `role`
lama tetap dipakai di beberapa tempat sebagai gate cepat (`adminOnly`
middleware, gate halaman `currentUser.role !== "ADMIN"`) — sengaja tidak
disentuh di keputusan ini, di luar scope.

---

## D-020 — Antrean offline driver (Phase 2, PWA)

**Keputusan.** Setiap aksi driver (mulai/tiba/selesai/gagal/catat
pembayaran) DICOBA LANGSUNG dulu; kalau gagal karena JARINGAN (bukan
validasi server), diantre di IndexedDB browser dan otomatis dikirim ulang
begitu online lagi. Foto & tanda tangan TIDAK diupload saat diambil —
disimpan sebagai Blob lokal, baru diupload saat submit benar-benar
terkirim (langsung atau lewat antrean).

**Alasan.** Driver kerja di area sinyal lemah (PRD Phase 2 secara eksplisit
menyebut "PWA, offline queue" sebagai satu paket). `/api/` sengaja
NetworkOnly di service worker (vite.config.js) — data CRM harus selalu
fresh, tidak boleh sajikan cache basi — jadi kalau tidak ditangani, driver
offline akan gagal total di setiap aksi, bukan cuma pengalaman lambat.

**Kenapa IndexedDB, bukan localStorage.** Entri antrean membawa Blob foto
(bisa beberapa MB) — localStorage cuma bisa simpan string dan kapasitasnya
kecil (~5-10MB total, base64-encode Blob juga +33% ukuran & lambat).
IndexedDB satu-satunya storage browser yang simpan Blob langsung.

**Kenapa ditulis manual, bukan library (idb/Dexie).** Kebutuhannya kecil —
satu object store, operasi CRUD dasar. CLAUDE.md: jangan tambah dependency
tanpa bertanya dulu.

**Desain penting — SATU titik submit.** `utils/submitJobAction.js` adalah
SATU-SATUNYA tempat yang tahu "apa yang sebenarnya dikirim ke server" untuk
tiap jenis aksi. Dipakai baik oleh percobaan pertama (DriverJobs.jsx) MAUPUN
pemroses antrean (syncQueue.js) — supaya kedua jalur itu TIDAK PERNAH diam-
diam berbeda perilakunya (mis. lupa update salah satu saat field baru
ditambah ke salah satu aksi).

**Error jaringan vs error API dibedakan secara eksplisit**
(`offlineQueue.js` → `isNetworkError()`): error jaringan → antre, coba lagi
nanti. Error API (mis. status job sudah berubah di server oleh proses lain)
→ TETAP di antrean dengan `lastError` terisi, ditampilkan ke driver dengan
tombol dismiss manual — TIDAK dibuang diam-diam. Kehilangan data driver
tanpa jejak adalah kegagalan yang lebih parah daripada antrean yang macet.

**Konsekuensi UI.** `DriverJobs.jsx` sekarang TIDAK PERNAH mengosongkan
daftar job yang sudah berhasil dimuat hanya karena reload gagal (offline) —
daftar terakhir tetap tampil, cuma dengan banner status sinkron di atas.
Job yang punya aksi tertunda di antrean tampil dalam mode "Menunggu
sinkron" (state lokal, BUKAN status Job asli dari server) supaya driver
tidak mencoba mengirim aksi kedua sebelum yang pertama benar-benar sampai.

**Verifikasi.** Diuji dengan mem-patch `window.fetch` untuk mensimulasikan
jaringan mati (bukan asumsi) — aksi start (tanpa lampiran) DAN complete
(dengan foto+tanda tangan) sama-sama terverifikasi: status server TIDAK
berubah selagi "offline", lalu tersinkron benar begitu jaringan "pulih"
(event `online` dipicu ulang). Kasus error API (job ID palsu) juga
diverifikasi TETAP di antrean dengan pesan error, bukan hilang.

---

## D-021 — Inventory v1: inti dulu, sisanya menyusul (Phase 3)

**Keputusan.** Disepakati dengan Gilang 1 Agustus 2026: Inventory PRD §8
dipersempit ke inti dulu — katalog `Material` + ledger `stock_movements`
APPEND-ONLY (RECEIPT/ISSUE/RETURN/WASTE/ADJUSTMENT) + goods receipt (FR-I-01)
+ issue manual ke unit (FR-P-08) + stock opname (FR-I-06), dengan halaman
Gudang di dalam portal Bengkel (tab, bukan portal ke-5 — PRD sendiri bilang
"Workshop mencakup production + materials + QC dalam satu kata").

**DITUNDA ke iterasi berikutnya (JANGAN dibangun sekarang):**
- BoM auto-expand saat order dikonfirmasi (§8.3) — perlu desain terpisah:
  bagaimana spec/routing module memetakan ke baris BoM
- Foam remnant per-sheet (§8.2: sheet_count DAN volume_m³ sekaligus,
  REMNANT-BIN) — v1 cuma hitung volume total, belum per-lembar
- Reservasi vs available-to-promise (FR-I-03)
- Reorder point alert (FR-I-05) — makanya kolom reorder point SENGAJA
  tidak ditambahkan ke `Material` sekarang (CLAUDE.md: jangan membangun
  untuk nanti)
- Yield report (FR-I-08)
- Multi-lokasi sungguhan — `location` di v1 cuma string bebas dengan
  default `"GUDANG_UTAMA"`, bukan tabel Location terpisah

**Kenapa stok dihitung on-the-fly, bukan materialized view.** PRD §8.1
menyarankan `stock_balance` materialized view yang di-refresh tiap tulis.
Di v1 ini disederhanakan jadi agregat `SUM(qty)` langsung saat baca — pada
volume data sekarang selalu akurat (tidak ada risiko view basi) dan tidak
perlu infrastruktur refresh/cron tambahan. Revisit kalau tabel movement
sudah besar dan agregat langsung mulai terasa lambat.

**Kenapa `qty` disimpan bertanda (+/-), bukan qty absolut + kolom arah.**
Ledger jadi bisa langsung di-SUM tanpa CASE/pivot berdasarkan `type` —
konsisten dengan pola PRD §8 sendiri ("RECEIPT +qty ... ISSUE −qty").
ADJUSTMENT dari stock opname dihitung otomatis oleh server (selisih hasil
hitung fisik dikurangi saldo sekarang), BUKAN diinput manual sebagai qty
bertanda oleh user — mencegah gudang salah tanda saat kondisi paling umum
(fisik lebih SEDIKIT dari sistem, variance negatif).

**Verifikasi.** Diuji lewat API langsung (receipt 10 m³ → issue 0.152 m³ ke
unit nyata → waste 0.05 m³ dengan alasan → stock opname hasil hitung 9.5
→ variance dihitung server persis -0.298, saldo akhir tepat 9.5) dan lewat
UI dari login: tambah material baru, catat penerimaan, saldo & riwayat
ter-update benar. Guard permission (INVENTORY_READ/WRITE, WAJIB alasan
untuk WASTE/ADJUSTMENT, tolak variance nol) semua diverifikasi lewat curl.

---

## D-022 — 4 notifikasi WhatsApp otomatis ke customer, FR-M ditunda (Phase 4)

**Keputusan.** Phase 4 dipersempit ke FR-N saja (notifikasi) untuk iterasi
ini. FR-M (uang/outstanding balance) DITUNDA — lihat alasan di bawah.

Empat momen PERSIS sesuai PRD §7.8, tidak lebih ("more than four and
customers mute you"): pickup dijadwalkan, unit sampai bengkel, siap
dikirim, terkirim. Diimplementasi di `services/customerNotifications.js`,
dipicu dari titik yang SUDAH ADA di `armada.js` (buat job PICKUP dengan
tanggal, job PICKUP/DELIVERY selesai) dan `production.js` (unit tuntas
seluruh tahap → READY_FOR_DELIVERY). Semua best-effort — gagal kirim WA
TIDAK PERNAH menggagalkan aksi utamanya, pola yang sama dengan
`notifyDriverGroup` (D-018), tapi target CUSTOMER, bukan grup internal.

**Kenapa FR-M ditunda.** PRD §9.3/§7.9 mengasumsikan ledger Payment
per-Order dengan outstanding balance turunan (amount_paid vs Order.value).
Tapi sistem ini SUDAH punya `Order.paymentStatus` (enum BELUM_BAYAR/DP/
LUNAS) — field manual yang dipakai analytics.js untuk revenue "collected"
sejak sebelum Sano Hub ada. Payment ledger yang dibangun D-011 sengaja
terikat ke Job (driver mencatat penerimaan di stop pengiriman), BUKAN ke
Order langsung — jadi tidak bisa dipakai untuk "DP saat konfirmasi order"
(FR-M-01, terjadi sebelum job apa pun ada) tanpa migrasi skema (longgarkan
Payment.jobId jadi opsional, tambah Payment.orderId wajib, backfill data
lama). Menyatukan dua sumber kebenaran pembayaran (paymentStatus manual +
ledger baru) TANPA rencana migrasi yang jelas berisiko menciptakan
persis masalah yang locking pola D-012/D-017 coba hindari — dua tempat
nyimpan "status bayar" yang bisa saling tidak sinkron, dan analytics.js
yang sudah bergantung ke `paymentStatus` bisa mulai berbohong diam-diam.
Ini keputusan MENUNDA dengan sengaja, bukan lupa — perlu obrolan terpisah
dengan Gilang soal mana yang jadi sumber kebenaran final sebelum digarap.

**Yang TIDAK dibangun di sini (sengaja):** status link customer (PRD minta
tokenized link — belum ada fondasinya), estimasi waktu selesai di pesan
"unit sampai bengkel" (Kendali sudah mengaku tidak bisa menghitung ini,
lihat unavailable di kendali.js — tidak masuk akal menjanjikannya di WA).

**Verifikasi.** Diuji lewat API langsung: job PICKUP dibuat dengan tanggal
→ conversation customer dibuat otomatis, percobaan kirim via CS-1 lalu
CS-2 (fallback session yang benar), gagal (tidak ada WAHA lokal) tapi
response API tetap 201 — TIDAK menggagalkan pembuatan job. Sama untuk
job PICKUP selesai (trigger "unit sampai") — response tetap 200 walau
kirim WA gagal. Konfirmasi lewat log: percobaan kirim BENAR-BENAR terjadi
(bukan silently skipped), errornya tertangkap di lapisan yang benar.
