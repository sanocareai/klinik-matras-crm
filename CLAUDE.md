# CLAUDE.md — Klinik Matras CRM Platform
# Baca file ini SEPENUHNYA sebelum mengerjakan apapun di project ini.
# Update terakhir: 1 Juli 2026

---

## 1. TENTANG BISNIS & OWNER

**Perusahaan:** Klinik Matras — bisnis kasur Indonesia (produksi + retail + servis)
**Owner/PIC:** Gilang (CCO), username GitHub: sanocareai
**Email bisnis:** admin@klinikmatras.com
**Domain produksi:** https://app.sanomatrassehat.com
**VPS:** Sumopod Jakarta, IP 43.133.152.6, user: ubuntu
**GitHub repo:** https://github.com/sanocareai/klinik-matras-crm
**Website utama:** sanomatrassehat.com (DNS nameserver di Vercel, bukan Hostinger)

**Tim pengguna sistem (24 akun per 21 Agustus 2026):**

Growth (sudah lama aktif):
- OWNER/Admin: Gilang (admin@klinikmatras.com) · Admin: Novi
- 8 Sales: Risel, Farhan, Mila, Kiki, Ervina, Fadlan, Andes, Rifki

Operasional (ditambahkan 21 Agustus 2026 — lihat §19):
- 2 Owner/Admin: Juri, Kemal
- Kepala Produksi: Imam (PRODUCTION_LEAD)
- Admin Produksi: Ferdy (PRODUCTION_LEAD, tangan kanan Imam)
- Natasha: SEMUA 9 peran (permintaan eksplisit owner — lihat peringatan §19)
- 3 Driver: Apriansyah, Agung, Alwan

Akun uji "Uji — …" (bengkel@/qc@/gudang@/dispatcher@/driver@/finance@) MASIH
ADA dan belum dipakai apa pun (0 jejak aktivitas). Aman dihapus kapan saja.

- Email: `namadepan@klinikmatras.com`, semua huruf kecil
- Password semua: kasursehat1 (sementara, perlu diubah per user)

⚠️ **TIDAK ADA orang khusus untuk QC, Gudang, Dispatcher, dan Finance** —
keempatnya hanya dipegang Natasha. Konsekuensi paling tajam ada di QC: `fit_test`
("Uji Berat Badan") adalah SATU-SATUNYA tahap `requires_qc=true` dan `is_optional
=false`, jadi SETIAP unit wajib melewatinya. Selama cuma Natasha yang punya
QC_LEAD, seluruh lini produksi berhenti di gerbang itu kalau dia berhalangan.

**Volume operasional saat ini:**
- 50-100 pesan/hari dari WhatsApp (Instagram belum terintegrasi)
- Nomor WhatsApp: masih pakai nomor TESTING (belum nomor utama klinik)

---

## 2. FILOSOFI PRODUCT

Dibangun karena WooBlazz CRM terlalu mahal (Rp1jt/bulan untuk 7 user)
dan data pelanggan harus di server sendiri (privasi bisnis).

**Prinsip utama:**
- Data 100% di server sendiri
- Hemat biaya (target <Rp300rb/bulan total)
- Mudah dimaintain oleh 1 orang dengan moderate coding skill
- Kode simpel dan readable > clever/over-engineered
- Komentar kode dalam Bahasa Indonesia untuk logika bisnis penting
- Semua teks UI dalam Bahasa Indonesia

---

## 3. TECH STACK (FINAL — JANGAN GANTI TANPA DISKUSI)

### Frontend
- React 18 + Vite (plain JavaScript, BUKAN TypeScript)
- React Router DOM v6
- Recharts (chart/grafik)
- Lucide React (icons)
- xlsx + file-saver (export Excel/CSV)
- vite-plugin-pwa (PWA support — sudah atau akan diinstall)
- CSS murni di index.css (TIDAK pakai Tailwind/styled-components)

### Backend
- Node.js + Express (ES Modules — pakai `import`, bukan `require`)
- Prisma ORM v5 + PostgreSQL
- bcryptjs, jsonwebtoken, dotenv
- web-push (untuk push notification — sudah atau akan diinstall)
- multer (file upload)

### Infrastructure
- Docker + Docker Compose (semua service dalam container)
- WAHA self-hosted (WhatsApp HTTP API), engine: **NOWEB** (BUKAN WEBJS)
  ⚠️ WEBJS rusak akibat update WhatsApp Web — selalu pakai NOWEB
- Nginx (reverse proxy), client_max_body_size 50M (sudah diset)
- Let's Encrypt SSL via certbot
- Sumopod VPS Jakarta, Ubuntu 22.04

---

## 4. ARSITEKTUR SISTEM

```
Browser/PWA (React SPA)
    ↕ HTTPS via Nginx (port 443)
Nginx reverse proxy
    ↕ http://localhost:4000
Express Backend (port 4000)
    ├─ Prisma ORM ↔ PostgreSQL (port 5432, internal only)
    └─ WAHA Client ↔ WAHA container (port 3000)
                        ↕ WhatsApp Web NOWEB protocol
                        ↕ Webhook → POST /api/webhooks/waha
```

**Di production (VPS):**
- Service names Docker: `postgres`, `waha`, `backend`
- WAHA_BASE_URL = `http://waha:3000`
- DATABASE_URL host = `postgres`
- Webhook URL = `http://backend:4000/api/webhooks/waha` (internal Docker)

---

## 5. ⚠️ MASALAH KRITIS YANG SEDANG BERLANGSUNG

### BUG LID (sudah ditangani — status diperbarui 25 Juli 2026)

⚠️ **Bagian ini SEBELUMNYA menyatakan bug LID "BELUM SELESAI" dan meminta
menambahkan `extractPhoneNumber()` ke webhooks.js. Itu SUDAH TIDAK AKURAT** —
penanganan LID di kode jauh lebih lengkap dari contoh yang dulu ditulis di
sini. Jangan menambah parser LID baru; pakai yang sudah ada.

**Masalah aslinya:** WAHA mengirim `from: "201086224863438@lid"` (LID/Local ID),
bukan nomor telepon. Nomor asli ada di `_data.key.remoteJidAlt` (NOWEB) atau
`_data.Info.SenderAlt`/`RecipientAlt` (GOWS).

**Yang SUDAH ada di kode (jalur MASUK) — `routes/webhooks.js`:**
- `extractPhoneNoweb()` — pakai `remoteJidAlt` dulu, fallback resolve via API
- `extractPhoneGows()` — pakai `SenderAlt`/`RecipientAlt`, sadar `fromMe`
  (saat `fromMe` nomor customer ada di `Chat`, bukan `Sender`)
- Gagal total → pesan **DIKARANTINA** ke tabel `UnresolvedMessage`
  (`reason: "LID_UNRESOLVABLE"`), **BUKAN** membuat Customer bernomor sampah

**`services/wahaClient.js`:**
- `normalizePhoneNumber()` — SATU pintu masuk normalisasi, wajib dipakai semua
  kode yang menerima JID dari WAHA
- `resolvePhoneFromLid()` — berlapis: cache tabel `LidMapping` → WAHA API
  `GET /api/{session}/lids/{lid}` → fallback Customer lama → null

**Yang SUDAH ada di kode (jalur KELUAR):**
- `isLidLikePhone()` — predikat KANONIK deteksi LID, satu-satunya sumber
  kebenaran (dipakai juga oleh `scripts/fix-lid-customers.js`)
- `buildChatId()` — dipakai `sendText` / `sendMedia` / `editMessage` /
  `deleteMessage`. **MENOLAK (throw)** kalau tujuan masih LID, jadi sales
  melihat error jelas di UI (502) alih-alih pesan hilang tanpa jejak.
  Sebelum 25 Juli 2026 cek ini cuma `console.warn` DI SATU fungsi saja
  (`sendText`) lalu pesan tetap dikirim ke `<LID>@c.us` — alamat yang tidak
  ada. Itu penyebab sebenarnya gejala "balasan nyasar".

⚠️ **JANGAN "menyederhanakan" `isLidLikePhone()` menjadi "angka panjang yang
tidak mulai 62 = LID".** JID GRUP juga berbentuk begitu (mis.
`120363376@g.us`) dan grup dikirim lewat `sendText`/`sendMedia` yang SAMA —
tanpa pengecualian `@g.us`, SELURUH fitur pesan grup mati.

**Cleanup data lama — PRATINJAU dulu, JANGAN langsung apply:**
```bash
# 1. Lihat rencananya (DEFAULT = dry-run, tidak mengubah apa pun)
docker compose exec backend node scripts/fix-lid-customers.js
# 2. Backup — jalur merge MENGHAPUS record Customer, tidak bisa dibatalkan
./backend/scripts/backup-database.sh
# 3. Baru terapkan
docker compose exec backend node scripts/fix-lid-customers.js --apply
```
Perilakunya: kalau ada customer bernomor valid dengan nama SAMA → merge
(relasi dipindahkan, customer LID DIHAPUS). Kalau tidak ada pasangan →
`phone` di-null-kan saja (order/catatan/percakapan TIDAK dihapus).
Idempotent, aman dijalankan berkali-kali.

⚠️ **Dampak yang harus diantisipasi:** customer yang `phone`-nya di-null-kan
TIDAK BISA dibalas sales sampai nomornya terisi lagi (UI: "Nomor WA pelanggan
tidak tersedia"). Nomor terisi otomatis begitu customer chat lagi dan WAHA
berhasil resolve. Karena itu pratinjau penting — supaya tahu DULU berapa
banyak yang akan terdampak.

⚠️ **KALAU MENAMBAH TABEL BARU YANG FK-nya `onDelete: Cascade` KE Customer,
WAJIB tambahkan pemindahannya ke jalur merge script ini.** `Order`/`Note`
pakai RESTRICT jadi kalau terlewat delete-nya GAGAL KERAS (aman ketahuan).
Tabel Cascade TIDAK punya jaring itu — datanya hilang DIAM-DIAM tanpa error.
Ini pernah kejadian nyata: `pipeline_transitions` (Cascade) ditambahkan tanpa
memperbarui script ini, jadi tiap merge menghapus seluruh riwayat stage
customer yang di-merge. Sekarang sudah dipindahkan di dalam satu transaksi.

**Cara cek cepat apakah masih ada data LID:**
```sql
SELECT id, name, phone FROM "Customer"
WHERE phone IS NOT NULL
  AND (phone NOT LIKE '62%' OR length(phone) > 13 OR phone LIKE '%@%');
-- HARUS 0 baris
SELECT reason, COUNT(*) FROM "UnresolvedMessage" GROUP BY reason;
-- LID_UNRESOLVABLE naik terus = WAHA tidak bisa resolve, perlu diperiksa
```

**Sisa risiko yang masih terbuka:**
- `resolvePhoneFromLid()` langkah 4 sengaja mengembalikan LID apa adanya kalau
  ada Customer lama bernomor LID — supaya pesan masuk tetap menempel ke
  riwayat yang benar. Jaring pengamannya adalah guard jalur keluar di atas.
  Setelah cleanup dijalankan, langkah ini tidak akan pernah cocok lagi.
- Webhook KELUAR `lead.won` (`services/automationWebhook.js`) mengirim
  `customer.phone` ke n8n. Untuk customer yang nomornya sudah di-null-kan,
  field ini `null` — otomasi eksternal harus menanganinya.
- Percakapan dobel di WAHA (satu dari nomor asli, satu dari LID) dicegah
  partial unique index di `Conversation`; kalau masih muncul, jalankan
  `scripts/dedup-conversations.js`.

---

## 6. ENVIRONMENT VARIABLES

### Development (localhost) — backend/.env
```
DATABASE_URL="postgresql://klinik:klinik123@localhost:5432/klinik_matras"
JWT_SECRET="[string panjang rahasia]"
WAHA_BASE_URL="http://localhost:3000"
WAHA_API_KEY="klinikmatras-rahasia-2026"
WAHA_SESSION="default"
WAHA_BUSINESS_NUMBER="628xxxxxxxxx"
VAPID_PUBLIC_KEY="[generate dengan web-push]"
VAPID_PRIVATE_KEY="[generate dengan web-push]"
VAPID_EMAIL="admin@klinikmatras.com"
PORT=4000

# Webhook KELUAR ke n8n/tool otomasi — SEMUA OPSIONAL.
# Kalau AUTOMATION_WEBHOOK_URL kosong, dispatcher no-op (fitur mati, bukan error).
# Lihat backend/src/services/automationWebhook.js
AUTOMATION_WEBHOOK_URL=""          # mis. https://n8n.contoh.com/webhook/klinik-matras
AUTOMATION_WEBHOOK_SECRET=""       # dikirim sebagai header X-Klinik-Signature
AUTOMATION_WEBHOOK_TIMEOUT=10000   # ms, default 10000
```

### Production (VPS) — perbedaan dari dev:
```
DATABASE_URL host: postgres (bukan localhost)
WAHA_BASE_URL: http://waha:3000 (bukan localhost)
```

⚠️ File .env tidak pernah masuk Git (.gitignore sudah setup)

---

## 7. SCHEMA DATABASE (Prisma — tanya dulu sebelum ubah)

⚠️ **CATATAN AKURASI**: Dokumentasi di bawah mungkin sedikit tertinggal dari
`schema.prisma` yang sebenarnya (misal OrderStatus kemungkinan sudah berubah
jadi WAITING_LIST/PENGAMBILAN/PENGERJAAN/FINISH di suatu commit, belum
tercatat di sini). **SELALU cek `backend/prisma/schema.prisma` langsung
sebagai sumber kebenaran**, dokumentasi ini cuma referensi cepat.

```prisma
// Models yang sudah ada:
User          → id, name, email, passwordHash, role (ADMIN/SALES)
Customer      → id, name, phone, instagramHandle, email, city, tags[],
                pipelineStage, leadSource (enum LeadSource), leadSourceDetail,
                leadSourceConfirmed, assignedSalesId, timestamps,
                customerType (enum CustomerType — RENCANA, lihat di bawah),
                healthStatus (enum HealthStatus? — RENCANA, lihat di bawah)
Conversation  → id, customerId, channel (WA/IG), status (OPEN/PENDING/RESOLVED),
                assignedToId, lastMessageAt, sessionId (untuk multi-nomor nanti)
Message       → id, conversationId, direction (INBOUND/OUTBOUND), content,
                mediaUrl, mediaType, externalId (dedupe webhook)
Note          → id, customerId, authorId, content, createdAt
                (RENCANA: tambah updatedAt, jadikan editable/deletable)
Order         → id, customerId, status (enum OrderStatus), quantity, notes,
                merkKasur, ukuran, keluhanCustomer, timestamps
                (RENCANA: value jadi computed dari OrderItem[], jenisLayanan
                text field digantikan OrderItem[] — lihat di bawah)
OrderItem     → id, orderId, layananName, harga (Rupiah), sortOrder — RENCANA
SalesTarget   → id, userId, year, month, targetValue (Rupiah) — RENCANA,
                target bulanan per sales, editable di Pengaturan
Product       → id, name, description, category, price, priceUnit, active,
                sortOrder, images (ProductImage[])
ProductImage  → id, productId, url, label, sortOrder
TrackedLink   → id, slug (unique), name, category (enum LinkCategory),
                prefilledMessage, targetPhone, active, clicks (ClickEvent[])
ClickEvent    → id, trackedLinkId, matchedCustomerId, createdAt
PipelineTransition → id (UUID), customerId, fromStage, toStage, changedById,
                createdAt — RIWAYAT perpindahan pipeline stage (append-only).
                Customer.pipelineStage cuma posisi SEKARANG; tabel ini yang
                bikin laporan time-series mungkin (kecepatan LEAD→WON, cohort).
                Ditulis dalam 1 transaksi dgn update stage di routes/customers.js
                PATCH /:id, HANYA kalau stage benar-benar berubah (form CRM
                sering kirim pipelineStage yang sama — jangan catat "LEAD→LEAD").
                Nama fisik snake_case: tabel "pipeline_transitions" via @@map

// Enum penting:
PipelineStage: NEW, QUALIFIED, QUOTED, BOOKED, SCHEDULED, COMPLETED, REVIEWED
  ⚠️ DIKOREKSI 1 Agustus 2026 — dokumentasi ini SEBELUMNYA menulis
  "LEAD, QUALIFIED, QUOTED, WON, LOST" dan itu SALAH (sudah lama tidak
  cocok dengan database). Nilai di atas diverifikasi langsung dari
  `pg_enum` production. Bug nyata akibat versi lama: endpoint
  /auth/portal-summary memfilter `pipelineStage: "LEAD"` → cocok NOL baris,
  kartu Sales CRM di Portal muncul tanpa angka.
  SELALU cek `backend/prisma/schema.prisma` / pg_enum, jangan percaya
  daftar enum di file ini.
  (label tampilan QUOTED berubah dari "Penawaran" jadi "Offers/Negosiasi" —
  cuma label, enum value TETAP QUOTED, jangan migrate enum-nya)
LeadSource: META_ADS, GOOGLE_ADS, WEBSITE_ORGANIC, INSTAGRAM, 
            WHATSAPP_DIRECT, REFERRAL, OTHER
OrderStatus: cek schema.prisma langsung (kemungkinan sudah jadi
            WAITING_LIST/PENGAMBILAN/PENGERJAAN/FINISH — verifikasi dulu)
LinkCategory: META_ADS, GOOGLE_ADS, WEBSITE_ORGANIC, OTHER
CustomerType: END_USER, CORPORATE — RENCANA, default END_USER, gantikan
              deteksi tag "Korporat" yang rawan typo
HealthStatus: SAKIT, TIDAK_SAKIT — RENCANA, nullable (default belum diisi/
              belum ditanya ke customer)
```

**Daftar kota tetap (dropdown, bukan free text) — RENCANA:**
Jakarta Selatan, Jakarta Barat, Jakarta Utara, Jakarta Pusat, Jakarta Timur,
Bekasi, Tangerang, Bogor, Depok, Bandung, Sukabumi, Karawang

---

## 7D. FITUR BARU — Kategori Order, ID Otomatis, Tracking Komplain (7 Juli 2026)

**Kategori Order (field baru di Order):**
enum OrderCategory { LAYANAN, SEWA, BARU }
- LAYANAN → mencakup semua Upgrade/Service/Ganti Kain yang sudah ada
  (pakai OrderItem add-ons seperti biasa) → prefix ID "RES"
- SEWA → Kasur Sewa (layanan baru) → prefix ID "SWS"
- BARU → Kasur Baru/pembelian baru (layanan baru) → prefix ID "NEW"

**Merk Kasur:** tambah "Sano" ke daftar pilihan merk yang sudah ada
(King Koil, dll).

**ID Order OTOMATIS (mengubah keputusan 7B yang tadinya manual):**
Format: `{PREFIX}-{DDMMYYYY}-{NNN}` — contoh: `NEW-07072026-001`
- Nomor urut (NNN) 3 digit, increment per PREFIX per BULAN, reset ke 001
  di awal bulan baru (RES dan SWS dan NEW masing-masing hitungan sendiri,
  tidak saling pengaruh)
- Generate OTOMATIS saat order dibuat lewat UI CRM (Inbox/Drawer) —
  sales tidak perlu ketik manual lagi
- KECUALI untuk fitur Import Excel (migrasi data historis Jan-Jun) — di
  situ ID Order tetap pakai apa yang tertulis di spreadsheet asli, TIDAK
  di-generate ulang (supaya konsisten dengan pencatatan lama Gilang)
- Butuh tabel counter terpisah (OrderSequence) supaya aman dari race
  condition kalau 2 order dibuat bersamaan

**Tracking Komplain (terikat ke Order spesifik, bukan field terpisah):**
- Field baru di Order: hasComplaint (boolean), complaintDate (datetime),
  complaintDetail (text)
- Ditandai MANUAL oleh sales/admin lewat toggle di Order editor — hanya
  muncul untuk order yang statusnya sudah "selesai/terkirim" (customer
  baru bisa komplain setelah barang/layanan diterima)
- Muncul di profil pelanggan sebagai: badge "Pernah Komplain" (kalau ADA
  order manapun milik customer itu yang hasComplaint=true) + riwayat detail
  (tanggal, order mana, isi komplain) — bisa lebih dari 1 kalau customer
  komplain berkali-kali di order berbeda

### Revisi (7 Juli 2026, setelah Gelombang 1-2 selesai)

**1. Merk Kasur untuk kategori BARU/SEWA:** otomatis "Sano", TIDAK perlu
pilih merk lain — dropdown merk cuma relevan untuk kategori LAYANAN
(upgrade/service kasur existing customer, yang merknya bisa apa saja).

**2. Berat badan — MULTI-ORANG, bukan field tunggal:** ganti dari
`Order.beratBadan Int?` (field lama, sudah tidak dipakai untuk order baru)
jadi tabel terpisah:
```
model OrderWeightEntry {
  id        String @id @default(cuid())
  orderId   String
  order     Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)
  label     String  // free text: "Suami", "Istri", "Sendiri", "Anak 1", dst
  beratKg   Int
  sortOrder Int    @default(0)
}
```
Alasan: kebanyakan order untuk pasangan (suami+istri) yang tidur di kasur
sama, masing-masing beda berat badan — dibutuhkan TERPISAH per orang
untuk analisa layering yang presisi, BUKAN dijumlah/dirata-rata.

**3. Foto profil WhatsApp:** belum ada, sekarang ditambahkan sebagai
enhancement (fetch dari WAHA contacts API kalau tersedia). CATATAN:
tingkat keberhasilan tidak akan 100% — tergantung setting privasi
customer di WhatsApp mereka (kalau foto profil dibatasi "kontak saya
saja", WAHA/CRM tidak akan bisa ambil). Fallback tetap avatar inisial
berwarna seperti sekarang.

**4. Bug floating button "Tanya Sano":** menutupi tombol kirim pesan di
Inbox mobile — perbaikan sebelumnya (hide saat keyboard fokus) TERNYATA
tidak cukup, perlu disembunyikan TOTAL khusus di halaman Inbox (bukan
cuma saat mengetik), karena Inbox sudah punya mekanisme kirim pesan
sendiri, tidak perlu shortcut floating yang bersaing ruang.

Juga ditemukan bug: menu sidebar "Tanya Sano" hilang untuk role SALES
(padahal fitur ini seharusnya BISA dipakai SALES, itu tujuan awal
dibangun) — kemungkinan salah kondisi role-check di render sidebar.

**5. Link Pelacakan — verifikasi + insight penting soal Meta Ads:**
Lapis 1 (deteksi otomatis referral iklan Meta dari payload WAHA) BELUM
PERNAH dikonfirmasi benar-benar berfungsi dengan klik iklan asli — status
masih "belum diverifikasi" sejak awal dibangun. REKOMENDASI: untuk Meta
Ads, JANGAN andalkan Lapis 1 (auto-detect) — pakai TrackedLink juga
(sama seperti Google Ads/Website), 1 link per campaign, category
META_ADS. Ini lebih reliable dan sudah pasti berfungsi (Lapis 2, sudah
terbukti jalan), dibanding menunggu kepastian Lapis 1.

Untuk ORGANIK: TIDAK PERLU setup TrackedLink apapun — ini otomatis
jadi default/fallback (Lapis 3) kalau chat masuk TANPA ada ClickEvent
yang cocok dalam 15 menit terakhir. Organik = customer chat random tanpa
lewat link pelacakan manapun.



**Konteks:** ADMIN bisa minta Sano Co-pilot langsung simpan info baru ke
Knowledge Base lewat chat natural ("tambahin info: X adalah..."). Role
SALES bisa tanya tapi TIDAK bisa menulis — kalau minta tambah info, Sano
cuma sarankan hubungi admin.

**Struktur: 4 kategori TETAP (folder), BUKAN file bebas per entri** —
supaya tidak numpuk jadi puluhan file kecil berantakan:

1. **Konsep & Istilah Teknis** — definisi istilah spesifik Sano/produk
   Klinik Matras (misal "Plasspring", "PE Encasement")
2. **Dunia Kasur (Umum)** — pengetahuan industri kasur secara luas,
   BUKAN cuma milik Sano: teknologi kasur pada umumnya, merk kompetitor
   (King Koil, Serta, Lady Americana, dll), tren pasar. Ini yang bikin
   Sano bisa ngobrol luas & meyakinkan saat customer bandingkan dengan
   kasur lain, konsisten dengan positioning "Ahlinya Kasur Sehat"
3. **FAQ Tambahan** — pertanyaan baru yang sering muncul di lapangan
4. **Insight Lapangan** — pola umum dari pengalaman sales (BUKAN data
   spesifik 1 customer — itu tempatnya di Order.keluhanCustomer yang
   sudah ada, bukan di sini, demi privasi & supaya Knowledge Base tidak
   penuh nama-nama customer individual)

**Setiap perintah simpan → Sano klasifikasi masuk kategori mana → APPEND
sebagai entri baru DI DALAM file kategori itu** (bukan bikin file .md
baru tiap kali).

**Harga TIDAK termasuk quick-add** — perubahan harga tetap wajib lewat
edit manual `02-harga-layanan.md`, area paling berisiko kalau salah
kutip ke customer, sengaja tidak dibuka jalur cepat lewat chat.

**UI**: sidebar Knowledge Base jadi struktur folder (4 kategori tetap),
klik kategori baru kelihatan daftar entri di dalamnya (judul + tanggal),
bukan daftar file rata.



Status: 🔨 baru mulai. Konteks: Gelombang 1-4 (7A) SUDAH jalan di production,
dikonfirmasi visual oleh Gilang. Root cause masalah "deploy tidak muncul"
sebelumnya ternyata Node.js versi usang di VPS + docker-compose ke-reset
oleh `git reset --hard` (lihat seksi 12 untuk detail lengkap, sudah
diperbaiki permanen).

1. BUG: kolom "STATUS ORDE[R]" di tabel Pelanggan (list view) masih kosong,
   padahal data status order SUDAH benar kalau dilihat dari drawer/detail
   pelanggan. Kemungkinan besar endpoint GET list customers (dipakai
   tabel) tidak include/compute status order terbaru, sementara endpoint
   GET detail customer (dipakai drawer) sudah benar. Perlu disamakan.

2. ID Order manual — field baru Order.orderNumber (String?, nullable,
   diisi manual oleh sales, BUKAN auto-generate) untuk tracking/sinkron
   dengan sistem pencatatan lain. Input di form order (Inbox + Drawer),
   kolom baru "ID Order" di tabel Pelanggan (ambil dari order terbaru).

3. Keluhan Customer di tabel + profil — TIDAK bikin field baru. Order
   sudah punya `keluhanCustomer` per order. Rangkum jadi:
   - Kolom baru "Keluhan" di tabel Pelanggan (ringkasan/keluhan terbaru)
   - Section "Riwayat Keluhan" di tab Profil drawer (bukan cuma tab
     Order) — list semua keluhan dari semua order customer itu, dengan
     tanggal, supaya riwayat kesehatan/keluhan customer kelihatan
     sekilas begitu buka profil (relevan untuk konteks Fase 4 AI nanti)

4. Sistem Take Over percakapan — mengatasi sales yang cuma balas di awal
   lalu hilang. Aturan:
   - Kalau conversation BELUM ada assignedToId → tombol "Ambil" selalu
     aktif untuk siapa saja (klaim awal, normal)
   - Kalau conversation SUDAH ada assignedToId (sedang dipegang sales
     tertentu) → tombol "Ambil Alih" HANYA aktif kalau pesan TERAKHIR
     di percakapan itu adalah dari CUSTOMER (inbound) DAN sudah lebih
     dari 60 menit tanpa balasan (tidak ada outbound setelahnya)
   - Dihitung on-the-fly dari Message terakhir per conversation, TIDAK
     perlu tabel/field baru
   - UI: badge peringatan "Belum dibalas 1j+" pada percakapan yang
     kena kondisi ini, tombol takeover disabled sampai syarat terpenuhi



Status: 🔨 sedang dikerjakan Claude Code, bertahap per gelombang (lihat
prompt kerja untuk detail lengkap tiap poin). Ringkasan:

1. Fix status order kepotong di UI (WAITING_LIST/PENGAMBILAN/PENGERJAAN/FINISH)
2. Label pipeline QUOTED: "Penawaran" → "Offers/Negosiasi"
3. Target sales bulanan + progress bar (SalesTarget model baru), editable
   di Pengaturan
4. Semua field customer (order, keluhan, catatan, harga) jadi editable
   setelah diinput, bukan cuma create-once
5. Order jadi multi-item "add-ons" (OrderItem model baru: merk+ukuran di
   level order, tiap layanan + harga jadi baris terpisah)
6. Kota jadi dropdown 12 pilihan tetap (bukan free text)
7. Toggle Sakit/Tidak Sakit di Inbox, tersimpan ke Customer, muncul di
   export Excel
8. CustomerType eksplisit (END_USER/CORPORATE), gantikan tag "Korporat"
9. Label "Sales" → "Sales Person" (tampilan saja, role enum tetap SALES)
10. Semua field yang bisa diedit di Inbox harus juga bisa diedit dari
    Pelanggan > Aksi (drawer), satu sumber kebenaran UI
11. AI Co-pilot untuk sales (Fase D dari roadmap Phase 4 — dipercepat
    jadi pilot sekarang, pakai AI Playground infra yang sudah ada +
    wawasan produk di seksi 16)
12. Export Excel di semua halaman direview ulang: rapi, terstruktur,
    mencerminkan semua field baru

**Update status (setelah cek visual bareng Gilang):**
- ✅ CustomerType (End User/Korporat) sudah jalan di tabel & filter
- ✅ Order add-ons (merk/ukuran/layanan/keluhan) sudah ada di drawer, tapi
  BELUM identik dengan versi Inbox — perlu di-refactor jadi 1 komponen
  shared, bukan 2 implementasi terpisah yang bisa saling drift
- ⚠️ BUG ditemukan: Order.value tidak sinkron dengan SUM(OrderItem.harga) —
  header order tampil Rp1.000.000 tapi breakdown add-ons tampil "Total: Rp0"
- ❌ Dashboard Performa CS masih tabel polos lama, belum jadi milestone/
  progress bar dengan target per sales (Gelombang 4 poin 4 belum kepakai
  di UI meski backend-nya mungkin sudah ada)
- ❌ Label "Penawaran" masih muncul di beberapa tempat — indikasi ada
  hardcode "Penawaran" yang terpisah dari STAGE_LABELS constant, bukan
  1 sumber kebenaran
- ❌ Tabel Pelanggan belum ada kolom Status Kesehatan (Sakit/Tidak Sakit)
  dan Status Order (progress WAITING_LIST/PENGAMBILAN/PENGERJAAN/FINISH)



### ✅ Core & Infrastructure
- Multi-user login (JWT, role ADMIN/SALES, 7 user)
- Deploy ke VPS Sumopod Jakarta
- Domain app.sanomatrassehat.com (A record di Vercel DNS → IP VPS)
- HTTPS via Let's Encrypt/certbot
- Nginx reverse proxy dengan upload limit 50MB
- Git workflow: laptop → GitHub → VPS (git pull + docker compose up --build)

### ✅ WhatsApp Integration (WAHA NOWEB)
- Terima pesan masuk via webhook
- Kirim pesan teks dari CRM
- Kirim media: foto (terkompres canvas), video, dokumen
- Kirim multiple foto sebagai "album" (dengan delay antar foto)
- ⚠️ Bug LID masih ada (lihat seksi 5) — fix sedang dalam proses
- Sync nama kontak ke WhatsApp: GAGAL (NOWEB tidak support PUT /api/contacts)
  → solusi: jadi fitur "nice to have", skip untuk sekarang

### ✅ Inbox Omnichannel
- 3-panel layout: list percakapan + chat window + customer detail
- Tab filter: Semua / Terbuka / Pending / Selesai
- Search percakapan
- Avatar inisial berwarna
- Channel badge (WhatsApp hijau)
- Timestamp relatif
- Quick reply templates (3 template hardcode)
- Galeri Produk siap-kirim dari panel chat
- Polling 5 detik untuk update real-time

### ✅ CRM - Customer 360
- Database pelanggan lengkap (nama, HP, email, kota, tags, pipeline)
- Tabel dengan search, filter, sort, pagination
- Drawer detail pelanggan (4 tab: Profil, Orders, Catatan, Riwayat Chat)
- Pipeline stage selector berwarna
- Order tracking (nilai Rupiah, status, qty, detail kasur)
- Catatan internal per pelanggan
- Export Excel/CSV
- Tambah pelanggan baru manual
- Quick filter: VIP / Belum Order / Tidak aktif 30 hari

### ✅ Sales Pipeline Kanban
- 5 kolom: LEAD → QUALIFIED → QUOTED → WON → LOST
- Drag & drop (HTML5 native API)
- Total nilai per stage
- Filter by assigned sales
- Export Excel

### ✅ Dashboard Analitik
- KPI cards gradient: Total Pelanggan, Total Order, Total Nilai, Terjual Bulan Ini
- Date range picker (Today/7 hari/30 hari/3 bulan)
- Progress bar target bulanan (Rp50jt hardcode)
- Bar chart traffic bulanan (label Indonesia)
- Donut chart sumber lead
- Funnel penjualan visual
- Intent distribution (placeholder, data dummy)
- Performance CS table
- Recent conversations (5 terbaru)

### ✅ Galeri Produk (siap-kirim dari chat)
- Manajemen produk (admin): upload foto, kategori, harga
- Picker di panel chat: cari produk → pilih foto → kirim dengan caption
- Kompresi foto di browser (canvas, max 1600px JPEG 0.8)
- Toggle sertakan/sembunyikan harga saat kirim

### ✅ Broadcast & Campaign
- Wizard 4 langkah: Template → Target Audience → Jadwal → Konfirmasi
- Filter target: kota, pipeline stage, jumlah order, opt-out exclude
- Estimasi jumlah kontak cocok (realtime)
- Anti-ban check: rasio outbound:inbound 7 hari
- Rate limit: 120 msg/menit, random delay 3-15 detik
- Simpan draft / jadwalkan / kirim sekarang

### ✅ Lead Attribution Tracking
- TrackedLink: generate link pelacakan per campaign
- Redirect endpoint publik: GET /r/:slug → catat klik → redirect ke WA
- Auto-detect sumber: Lapis 1 (referral Meta, belum konfirmasi NOWEB support)
                      Lapis 2 (match ClickEvent 15 menit)
                      Lapis 3 (default WHATSAPP_DIRECT)
- Koreksi manual sumber di Customer Panel & drawer
- Dashboard sumber lead dengan conversion rate per channel
- Halaman "Link Pelacakan" (admin only)

### ✅ Otomasi & AI (UI sudah ada, logic sebagian)
- Workflow builder: trigger → kondisi → aksi (visual flow cards)
- AI Playground: multi-model BYOK (Claude, GPT, Gemini), chat interface
- Knowledge Base: upload dokumen + FAQ manual + keyword search

### ✅ Mobile Responsiveness
- Dark sidebar collapse jadi hamburger di mobile
- Inbox: navigasi bertingkat (list → chat → customer panel bottom sheet)
- Pelanggan: card list (bukan tabel) di mobile
- Pipeline: tab per stage di mobile
- Touch target minimal 44x44px
- ✅ "Halaman terpotong (Pengaturan, Laporan, Pengguna & Peran)" SUDAH TIDAK
  TERJADI — diverifikasi ulang 1 Agustus 2026 di viewport 375px: ketiganya
  `scrollWidth === clientWidth` (tidak ada overflow horizontal sama sekali).
  Halaman Sano Hub (Portal/Bengkel/Armada/Kendali/Gudang) juga bersih.
  Cara cek ulang kalau ragu (jangan andalkan mata saja):
  `document.documentElement.scrollWidth > document.documentElement.clientWidth`

### 🔄 PWA (Dalam Progress)
- vite-plugin-pwa sudah atau akan diinstall
- Icon 192x192 dan 512x512
- Install prompt banner (Android)
- Service worker dengan NetworkFirst untuk /api/*
- ⚠️ Test di Chrome Android dulu sebelum submit ke Play Store

---

## 9. YANG BELUM / ROADMAP

### 🔨 Sedang Dikerjakan / Antrean Bugfix
- ~~Fix bug LID~~ — sudah ditangani, lihat seksi 5
- ~~Mobile UI fixes: Pengaturan, Laporan, Pengguna & Peran terpotong~~ —
  diverifikasi BERSIH 1 Agustus 2026 (lihat seksi 8 Mobile Responsiveness)
- Inbox header nama customer overflow di mobile (belum diverifikasi ulang)
- Pipeline rigid di mobile (belum diverifikasi ulang)
- Notifikasi in-app (badge unread di icon 🔔 topbar)
- Push notification Android (web-push + service worker)
- Tab Pelanggan blank/crash — kemungkinan besar SUDAH HILANG karena bug LID
  (penyebab yang diduga) sudah ditangani; perlu konfirmasi ulang

### ⚠️ Utang teknis yang ditemukan QA 1 Agustus 2026 (sudah diperbaiki)
Dicatat supaya polanya tidak terulang, BUKAN sebagai pekerjaan tersisa:
- **Cek admin pakai field `role` legacy, bukan array `roles` multi-role
  (D-010).** Ada di 7 file frontend + 8 titik backend (termasuk
  `requireAdmin` di `middleware/auth.js` yang dipakai 6 route file).
  Efeknya: user yang dapat ADMIN HANYA lewat halaman "Pengguna & Peran"
  ditolak 403 walau backend permission system sudah mengakuinya.
  **Aturan sekarang: JANGAN pernah cek `user.role === "ADMIN"` langsung.**
  Pakai `isAdminUser()`/`rolesOf()` dari `frontend/src/lib/roles.js`, atau
  `rolesOf()` dari `backend/src/middleware/authorize.js`.
- ADMIN memang SENGAJA tidak punya `INVENTORY_WRITE` (lihat komentar di
  `constants/permissions.js`) — itu bukan bug. Tapi UI harus jujur soal
  itu, jangan menyuruh klik tombol yang memang tidak ditampilkan.

### 📋 Phase 3 — Belum Dimulai
- Integrasi Instagram DM (Meta Graph API resmi)
  BLOCKED: perlu setup Meta Developer App + Business verification
  BLOCKED: perlu Facebook Page terhubung ke akun Instagram bisnis

### 📋 Phase 4 — AI System (RENCANA LENGKAP — status: mulai Fase A)

**Filosofi produk AI (PENTING — pegang ini di semua prompt AI):**
Klinik Matras bukan sekadar jualan kasur — misinya membantu orang tidur sehat.
AI harus berperan sebagai "Konsultan Tidur Sano" (gaya BMW Genius: diagnosa dulu,
edukasi, baru rekomendasi — bukan jualan cepat/interogasi budget di awal).
Konsep inti yang harus dikuasai AI: kasur sehat = fondasi kokoh (menopang tulang
belakang tetap lurus) + lapisan lembut yang PAS dengan berat badan orang tersebut
(bukan satu ukuran untuk semua orang).

**2 mode AI, berbagi 1 Knowledge Base yang sama:**
- Mode 1 — AI Warming: chat pertama customer baru, sebelum sales masuk
- Mode 2 — AI Co-pilot: sales tanya internal (harga, produk, diskusi konsep)

**Alur percakapan AI Warming (4 tahap, tidak kaku linear):**
1. Sambutan hangat berfokus masalah tidur (bukan "ada yang bisa dibantu?" generik)
2. Diagnosa: siapa pemakai, keluhan tidur, berat badan (untuk kekerasan kasur), ukuran
3. Edukasi konsep kasur sehat dijalin dalam percakapan (bukan ceramah terpisah) —
   ini yang bikin AI terasa "genius consultant" bukan chatbot FAQ
4. Rekomendasi ARAH (bukan harga final) — harga presisi diserahkan ke sales

**Titik wajib handover ke sales (buying signal eksplisit):**
- Customer tanya harga nominal spesifik
- Customer tanya cara order/bayar/pengiriman
- Customer minta foto produk/katalog
- Customer eksplisit minta ngobrol orang ("bisa telepon?", "ada yang follow up?")
- Safety net: 8-10 balasan tanpa closing signal → AI tetap tawarkan handover

**Saat handover:** sales harus terima RINGKASAN OTOMATIS (keluhan, berat badan,
kebutuhan, arah rekomendasi yang sudah dibahas AI) — supaya sales TIDAK tanya
ulang dari nol, customer tidak merasa diulang-ulang.

**Yang TIDAK boleh dijanjikan AI ke customer:**
- Harga pasti tanpa konfirmasi tim
- Estimasi waktu pengiriman pasti
- Diskon/promo yang tidak ada di Knowledge Base
- Closing/deal final — AI membuka jalan, bukan menutup deal

**Model AI:** Claude untuk percakapan bernuansa (customer ragu, edukasi konsep),
Gemini untuk FAQ volume tinggi/sederhana (harga, jadwal). Router otomatis baru
dibangun di Fase G setelah tahu pola pemakaian nyata — awal mulai 1 model dulu.

**Timeline & gerbang (tidak lanjut fase berikutnya sebelum lolos testing):**

| Fase | Isi | Status |
|---|---|---|
| A | Isi Knowledge Base lengkap: semua harga layanan, FAQ, dokumen konsep "kasur sehat by Sano" (filosofi fondasi+lapisan, siapa cocok apa) | 🔨 Gilang sedang siapkan konten |
| B | Rancang persona & alur percakapan AI (prompt engineering) — dikerjakan bareng Claude, ditest di AI Playground yang sudah ada di CRM | ⏳ Berikutnya, dikerjakan bareng |
| C | Logika deteksi buying-signal + generator ringkasan otomatis untuk sales | ⏳ Belum |
| D | AI Co-pilot untuk SALES dulu (internal, risiko rendah) | ⏳ Belum |
| E | Red team / stress test — coba jebak AI dengan pertanyaan aneh/provokatif sebelum sentuh customer asli | ⏳ Belum |
| F | Pilot terbatas — nyalakan AI Warming ke sebagian kecil traffic, sales pantau penuh, bisa override kapan saja | ⏳ Belum |
| G | Live penuh + router multi-model (Claude vs Gemini otomatis berdasarkan jenis pertanyaan) | ⏳ Belum |

Catatan: seluruh Fase 4 BELUM live ke customer asli manapun sampai lolos Fase E.
Prioritas: AI Co-pilot sales (D) sebelum AI Warming customer (F) — risiko lebih
kecil kalau ada yang meleset saat baru mulai.

**Item terkait lain (belum masuk timeline di atas, dikerjakan kapan pun relevan):**
- Workflow eksekusi nyata (sekarang baru UI, belum ada trigger real)
- Multi-nomor WhatsApp (2 nomor ke 1 CRM)
  PENDING: menunggu jawaban Gilang soal fungsi 2 nomor (beda fungsi vs load-balancing)

### 📋 Phase 5 — Roadmap Jauh
- Submit PWA ke Google Play Store (butuh akun $25 one-time)
- Integrasi marketplace (Tokopedia, Shopee)
- Auto PDF penawaran/invoice
- Mobile app native (React Native) — hanya kalau PWA tidak cukup

---

## 10. DESIGN SYSTEM

### Warna (CSS Variables)
```css
--sidebar-bg: #1e2139
--sidebar-active-bg: #2d3154
--sidebar-text: #a0aec0
--sidebar-active-text: #ffffff
--primary: #2563eb
--success: #16a34a
--warning: #f59e0b
--danger: #dc2626
--purple: #7c3aed
--pink: #ec4899
--orange: #f97316
--bg: #f8fafc
--card-bg: #ffffff
--border: #e5e7eb
--text-primary: #111827
--text-secondary: #6b7280
--text-muted: #9ca3af
```

### Badge Warna per Pipeline Stage
- LEAD: yellow | QUALIFIED: blue | QUOTED: purple
- WON: green | LOST: red

### Badge Warna per Conversation Status
- OPEN: blue | PENDING: yellow | RESOLVED: gray

### Breakpoint Mobile
- @media (max-width: 768px) untuk semua penyesuaian mobile

---

## 11. KONVENSI KODE

```javascript
// Format uang — SELALU pakai ini
function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
}
// Output: Rp15.000.000

// Singkatan untuk ruang terbatas (mobile, chart)
function formatRupiahShort(n) {
  if (n >= 1000000) return "Rp" + (n/1000000).toFixed(1) + "jt";
  if (n >= 1000) return "Rp" + (n/1000).toFixed(0) + "rb";
  return "Rp" + n;
}

// Format tanggal relatif: "5 mnt lalu", "2 jam lalu", "3 hari lalu"
// Format tanggal absolut: "Senin, 1 Juli 2026"
// Format tanggal pendek: "1 Jul"
```

### ⚠️ TANGGAL & TIMEZONE — UTC DI DALAM, WIB DI TEPI (WAJIB)

Arsitekturnya: **database & API selalu UTC** (ISO 8601, akhiran "Z"). WIB cuma
dipakai di 2 tepi — (a) menerjemahkan `?from=`/`?to=` dari UI jadi batas instant,
(b) merender ke manusia. Konversi TIDAK BOLEH tersebar di komponen/query.

| JANGAN | PAKAI |
|---|---|
| `new Date(iso).toLocaleDateString("id-ID")` di komponen | `frontend/src/utils/formatDate.js` |
| `new Date(y, m, d)` / `setHours(0,0,0,0)` untuk batas laporan | `backend/src/utils/wib.js` |
| `date_trunc('month', "createdAt")` polos | `date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')` |
| `toLocaleString("id-ID")` di pesan WA/email | `formatWIB()` dari `utils/wib.js` |
| `lte: <akhir hari>` | batas EKSKLUSIF `lt: <awal hari berikutnya>` |

**Kenapa ini serius.** Container backend jalan di **UTC** (docker-compose sengaja
tidak men-set `TZ`). Jadi tiap `new Date(y, m, d)` menghitung batas **UTC**,
padahal user memilih tanggal **WIB** — seluruh jendela laporan bergeser 7 jam dan
order jam 00:00–07:00 WIB terhitung di HARI SEBELUMNYA. Di frontend,
`toLocaleDateString` mengikuti timezone **device**, jadi angka laporan bisa beda
tergantung siapa yang membukanya (HP habis factory reset sering balik ke UTC).

Bug kelas ini pernah NYATA di `routes/analytics.js` — termasuk
`lte: new Date(to)` yang membuang SELURUH hari terakhir dari kolom "Total Nilai
Order" per sales. Sudah diperbaiki; jangan diulang. Offset WIB dipatok tetap
+07:00 (Indonesia tidak pernah pakai DST, offset tidak berubah sejak 1964).

---

## 12. WORKFLOW DEVELOPMENT

⚠️ **PENYEBAB PALING SERING "kode sudah benar tapi tampilan tidak berubah":**
`frontend/dist` di VPS itu **bind mount** ke container backend (lihat 
docker-compose.yml) — artinya perubahan HANYA muncul setelah `npm run build` 
BENAR-BENAR dijalankan ulang di folder `frontend` di VPS. `docker compose 
up -d --build` **TIDAK** membangun ulang frontend (itu cuma rebuild image 
backend). Kalau lupa jalankan `npm run build`, file lama akan terus 
disajikan selamanya walau kode di GitHub sudah benar. SELALU jalankan 
kedua langkah di bawah SECARA BERURUTAN, jangan skip salah satu.

```bash
# 1. LAPTOP — edit & test lokal
docker compose up -d postgres waha  # nyalakan DB & WAHA
cd backend && npm run dev            # terminal 1 (port 4000)
cd frontend && npm run dev           # terminal 2 (port 5173)

# 2. COMMIT & PUSH ke GitHub
git add .
git commit -m "feat: deskripsi"
git push

# 3. DEPLOY ke VPS — JALANKAN SEMUA BARIS INI, JANGAN ADA YANG DI-SKIP
ssh ubuntu@43.133.152.6
cd ~/klinik-matras
git pull
cd frontend && npm install && npm run build && cd ..   # ← WAJIB, sering kelupaan
docker compose up -d --build backend                    # ← cuma untuk backend

# 4. VERIFIKASI deploy frontend benar-benar baru (bukan asumsi):
curl -s https://app.sanomatrassehat.com/ | grep -o 'index-[a-zA-Z0-9]*\.js'
# Bandingkan hash-nya dengan sebelumnya — HARUS beda kalau ada perubahan frontend

# 5. KALAU ADA PERUBAHAN SCHEMA DATABASE
docker compose exec backend npx prisma migrate deploy

# 6. UTILITAS
npx prisma migrate dev --name nama_migration  # buat migration baru (lokal)
npx prisma studio                              # GUI database
docker compose exec backend node scripts/nama-script.js  # jalankan script
```

### Reverse proxy: NGINX (native systemd), BUKAN Docker

Web server yang benar-benar melayani `app.sanomatrassehat.com` adalah 
**nginx native** (`sudo systemctl status nginx`), config di 
`/etc/nginx/sites-enabled/klinikmatras`, proxy ke `http://localhost:4000`.
SSL dikelola Certbot (Let's Encrypt), auto-renew.

⚠️ **Insiden Caddy (Juli 2026, sudah dibereskan):** sempat ada percobaan
migrasi ke Caddy (docker-compose service `caddy` + `Caddyfile`) yang tidak
pernah selesai — Caddy gagal total (tidak bisa resolve DNS dari dalam
container, tidak pernah dapat sertifikat, tidak pernah berhasil pegang
port 80/443 karena nginx sudah duluan). Caddy SUDAH DIHAPUS dari
docker-compose.yml. **JANGAN tambahkan Caddy lagi** kecuali benar-benar
niat migrasi penuh (matikan nginx dulu, pastikan DNS container bisa
resolve ke internet, test menyeluruh sebelum cutover) — jangan biarkan
2 reverse proxy jalan bersamaan lagi, itu yang bikin bingung "mana yang
sebenarnya aktif".

### ⚠️ Node.js di VPS WAJIB versi 20 LTS (insiden Juli 2026, sudah dibereskan)

VPS sempat pakai Node.js versi sangat lama (v12/14, dari `apt install 
nodejs` — repo default Ubuntu kasih versi usang) — ini bikin `npm run 
build` di frontend GAGAL TOTAL secara diam-diam selama berminggu-minggu 
(error `ReferenceError: crypto is not defined` dari dependency 
`serialize-javascript`), sehingga `frontend/dist` tidak pernah benar-benar 
ter-update walau proses lain (git pull, docker rebuild) semua "sukses".
Ini akar masalah sebenarnya di balik banyak kejadian "kode sudah benar 
tapi tampilan tidak berubah" yang berulang kali muncul.

Fix permanen yang sudah diterapkan:
```bash
sudo apt remove -y nodejs npm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # HARUS v20.x.x, kalau bukan berarti ada yang salah
```
**Selalu cek `node -v` di VPS kalau curiga build frontend bermasalah** — 
jangan asumsi build sukses hanya karena tidak ada pesan error yang 
terlihat jelas di terminal (build tools kadang cuma warning, bukan STOP).

### ⚠️ Setelah edit docker-compose.yml, WAJIB `--force-recreate`

Container yang sudah jalan TIDAK otomatis membaca ulang definisi 
`volumes:`/`ports:`/`environment:` yang baru diedit di docker-compose.yml 
hanya dengan `docker compose up -d` biasa atau `restart`. Kalau baru 
saja mengedit docker-compose.yml (misal ubah bind mount, hapus service, 
ubah port), WAJIB:
```bash
docker compose up -d --force-recreate backend
```
Tandanya bind mount "putus"/belum ke-refresh: `docker compose exec backend 
ls -la /frontend/dist/` menunjukkan folder KOSONG padahal file aslinya 
ada di host — itu sinyal container masih pakai definisi volume yang lama.

---


## 13. WAHA — CATATAN PENTING

```
Engine: NOWEB (BUKAN WEBJS — WEBJS rusak sejak update WhatsApp Web 2026)
Dashboard URL: IP_VPS:3000/dashboard
Dashboard login: admin / klinikmatras123
API Key: klinikmatras-rahasia-2026
Session name: default (WAHA free hanya support 1 session dengan nama "default")

WAHA melanggar ToS WhatsApp (emulasi WhatsApp Web, bukan API resmi).
Risiko ban kalau: broadcast agresif, pola spam, nomor baru kirim banyak pesan.

Nomor WA sekarang: masih NOMOR TESTING (bukan nomor utama klinik).
Migrasi ke nomor utama: setelah semua bug (terutama LID) selesai dan stabil.

Anti-ban untuk broadcast:
- Rate limit: 120 pesan/menit
- Random delay: 3-15 detik antar pesan
- Hanya kirim ke kontak yang SUDAH pernah chat duluan
- Monitor rasio outbound:inbound 7 hari terakhir

Sync nama kontak ke WhatsApp: TIDAK BISA dengan NOWEB.
PUT /api/contacts tidak di-support — ini sudah dikonfirmasi, skip fitur ini.

Payload NOWEB untuk pesan dari iklan Meta (CTWA):
Belum dikonfirmasi apakah referral/ctwaClid ikut terbawa di NOWEB.
Perlu test langsung dengan klik iklan nyata untuk verifikasi.
```
## Konsep baru: Conversation type GROUP vs INDIVIDUAL
Ditemukan bahwa nomor CS juga tergabung di grup WhatsApp internal: Grup
Sales, Grup Driver (report pengiriman), Grup Produksi (dokumentasi order).
Ini BUKAN customer/lead — jangan masuk Pipeline atau bikin Customer record.
Perlu field `type` (INDIVIDUAL/GROUP) di model Conversation, panel kanan
beda (Info Grup vs Customer Profile), dan grup terdeteksi dari JID berformat
"@g.us". [Status: belum dikerjakan / sudah dikerjakan — isi sesuai kondisi]

## Multi-session WAHA aktif
Sistem sekarang punya 2 session WAHA aktif: CS-1 (628518728390) dan CS-2
(6285166662896), bukan lagi 1 session "default". WAHA_SESSION di .env sudah
diubah ke "CS-1". PENTING: kalau ada kode yang masih hardcode nama session
"default", itu bug — harus dinamis handle multi-session. Field sessionId di
Conversation dipakai untuk bedain asal pesan dari CS-1 atau CS-2, tapi label
visual di Inbox (badge CS-1/CS-2) [belum/sudah] diimplementasikan.

## Fitur WA yang masih kurang / diminta (belum semua dikerjakan)
- Pinned chat
- Forward pesan (field forwarded + replyToId di Message)
- Go to message (jump ke pesan yang di-reply)
- Galeri media per percakapan
- Auto-sync nama kontak dari pushName WAHA (kecuali sudah manual diedit,
  ditandai flag nameManuallyEdited)
- Sync status "sudah dibaca" jangan ikut status read-receipt asli WA
- History chat lama (sebelum WA connect ke WAHA) belum ter-backfill ke CRM

---

## 14. DNS & DOMAIN

- Domain: sanomatrassehat.com
- Nameserver: di Vercel (bukan Hostinger — jangan ubah di Hostinger)
- A record untuk `app`: dibuat di Vercel DNS Dashboard → 43.133.152.6
- HTTPS: Let's Encrypt via certbot, auto-renew

Untuk tambah/ubah DNS: login Vercel → pilih domain sanomatrassehat.com 
→ DNS Records (BUKAN di Hostinger).

---

## 16. WAWASAN PRODUK — KONSEP MATRAS SEHAT BY SANO CARE

Dirangkum dari 5 artikel resmi Klinik Matras (artikel-1 s/d artikel-5) +
tambahan wawasan pelengkap. Ini bahan utama Fase A Knowledge Base, dan
referensi supaya diskusi soal produk nyambung dan tidak dangkal.

### 16.1 Misi & Positioning (dari artikel-1)

> "Menolong banyak orang agar terhindar dari kerusakan tubuh akibat kasur
> yang salah, dan membantu memulihkan kenyamanan tidur melalui konsep
> Matras Sehat yang benar." — Misi Sano Care

Positioning penting: Klinik Matras **bukan toko kasur**, tapi klinik yang
"mendiagnosa" kondisi tubuh + kasur, lalu memberi solusi lewat **upgrade**
(fondasi/lapisan/kain/restorasi total) — TANPA harus beli kasur baru.
Ini pembeda utama vs kompetitor yang jualan kasur baru.

Ciri kasur yang salah: terlalu empuk & cepat amblas, terlalu keras &
tidak adaptif, fondasi tidak stabil, lapisan tidak presisi dengan berat
badan, material menekan saraf & aliran darah.

Dampak kasur salah: sakit punggung/pinggang, saraf kejepit (HNP
fungsional), skoliosis fungsional, tidur tidak berkualitas, mudah lelah.

### 16.2 Definisi "Matras Sehat" (dari artikel-2)

> Matras Sehat = kasur yang mampu menjaga bentuk tubuh dan struktur
> tulang secara stabil, menjaga tulang belakang tetap netral, tanpa
> tekanan berlebih pada saraf/aliran darah — tujuannya tubuh bisa
> restorasi total selama tidur.

**3 Prinsip Dasar Matras Sehat (SANO CARE):**
1. **Fondasi Harus Kuat & Stabil** — jantung kasur, tidak boleh amblas/goyang
2. **Lapisan Presisi & Adaptif** — mengikuti lekuk tubuh, elastisitas sesuai
   berat badan individu (tidak ada tekanan berlebih, tidak mengambang)
3. **Kain Permukaan Sejuk & Nyaman** — sirkulasi udara baik, suhu tubuh stabil

**Kriteria ketat Matras Sehat versi SANO CARE:**
- Menjaga tulang belakang tetap netral (kurva alami terjaga)
- Distribusi tekanan merata (tidak ada titik tekan di bahu/pinggul)
- Keamanan saraf & tendon (tidak menekan aliran darah/saraf)
- Mendukung recovery otot (otot rileks sempurna)
- Aman untuk nyeri punggung bawah & skoliosis fungsional

**Rumus inti (PENTING, sering dipakai untuk edukasi customer):**
> Matras Sehat = Fondasi Kuat + Lapisan Presisi + Permukaan Nyaman + Aman bagi Tubuh

### 16.3 Kenapa Kasur "Baik-baik Saja" Bisa Merusak Tubuh (dari artikel-3)

Selama 6-8 jam/malam, kasur adalah "lingkungan" yang menentukan kesehatan
anatomi tubuh. Kasur bisa terlihat OK secara fisik tapi salah secara
fungsi/tekstur untuk berat badan spesifik orang itu.

**4 Penyebab Utama Kasur Merusak Tubuh:**
1. **Fondasi Lemah & Tenggelam** — tulang belakang melengkung perlahan
   menuju permanen; busa apapun di atas fondasi jebol jadi sia-sia
2. **Lapisan Terlalu Empuk/Keras** — empuk berlebihan = tubuh "tenggelam"
   & sendi terkunci; terlalu keras = pressure points, hambat sirkulasi darah
3. **Material Tidak Sesuai Berat Badan** — elastisitas tidak seimbang
   dengan beban → deformasi plastis & fatigue material + distribusi berat kacau
4. **Ketidaktahuan Pengguna** — dampak baru terasa saat bangun (pegal,
   sakit pinggang berulang), sering disalahartikan sebagai "faktor umur"

**Dampak kesehatan yang dilaporkan pasien:** pegal & sakit leher, pusing,
lemas & kurang bersemangat, sakit pinggang/punggung kronis, saraf kejepit
(HNP fungsional), skoliosis fungsional, kualitas tidur buruk (badan "remuk"
saat bangun).

**3 solusi Sano Care (tanpa ganti kasur baru):**
1. Upgrade Fondasi — perkuat struktur, kembalikan posisi netral tulang belakang
2. Upgrade Lapisan — ganti material presisi sesuai berat badan
3. Paket Restorasi Matras Sehat — transformasi total ke standar medis Sano Care

### 16.4 Struktur Kasur dari Dalam (dari artikel-4)

Kasur = sistem rekayasa berlapis, tiap komponen punya peran vital:

**1. Fondasi / Support System ("Jantung Kasur")**
Menentukan kekuatan, stabilitas, daya topang. Komponen umum:
- Per/Spring System: Bonnel Spring (per sambung) atau Pocket Spring (per
  bungkus) — beri daya balik (bounce) & gaya dorong
- High-Density (HD) Foam: standar MJ — busa standar min density 26,
  Rebonded min density 50, Latex min density 80
- PE Encasement: kekuatan pinggiran + sedikit daya balik

**Standar Sano Care untuk fondasi:** TIDAK BOLEH lembek, "ngeper"
berlebih, fleksibel, atau patah. Harus menahan tulang belakang di posisi
netral dengan **batas penurunan maksimal 1cm** saat diberi beban.

**2. Lapisan Penahan** — pelindung busa dari fondasi Per/Spring (cotton
sheet, hard pad, serabut kelapa) agar tidak mudah robek/jebol

**3. Lapisan/Comfort Layer** — atur kenyamanan & distribusi tekanan
(pressure relief), inilah yang bikin rileks saat berbaring.
**Standar Sano Care:** tidak boleh terlalu empuk (maksimal turun 8cm
hingga menenggelamkan tubuh), tidak boleh terlalu keras hingga menekan
saraf & pembuluh darah.

**4. Kain/Fabric System** — bukan sekadar estetika: kenyamanan permukaan
(cegah iritasi kulit), sirkulasi udara/breathability (cegah tungau/jamur,
jaga suhu sejuk), sensasi tidur (kain modern bantu redakan stres saraf
permukaan kulit).

### 16.5 Matras Sehat vs Kasur Orthopedic (dari artikel-5)

> "Mayoritas orang (dari pabrik hingga sales) memahami Kasur Orthopedic
> = KERAS. Padahal, Kasur Keras ≠ Otomatis Sehat." — miskonsepsi umum
> yang PENTING diluruskan ke customer

Kasur Orthopedic umum: fokus keras untuk cegah tenggelam, tapi sering
TIDAK memperhitungkan berat badan pengguna, elastisitas aman, ketepatan
tekstur, aliran darah & saraf permukaan.

**Insight kunci Sano Care:** Matras Sehat bukan soal Keras vs Empuk —
tapi **PAS dan PRESISI**. Fungsi dipisah:
- **Fondasi (bawah)** = harus KOKOH/KERAS (fungsi penopang jangka panjang)
- **Lapisan (atas)** = harus disesuaikan tekanan tubuh (lembut TAPI tidak amblas)

| Aspek | Orthopedic Umum | Matras Sehat SANO |
|---|---|---|
| Konsep | Keras / Padat | Stabil + Adaptif |
| Fokus | Support Permukaan | Menopang Tanpa Menekan |
| Efek Saraf | Berisiko Tekanan Lokal | Terapi Tidur, Minim Tekanan |
| Kenyamanan | Sering Kaku | Nyaman & Aman |

**Kesimpulan yang sering perlu diluruskan ke customer:** "Kasur keras"
bukan otomatis sehat. Kasur orthopedic yang cuma keras tanpa distribusi
tekanan bikin tubuh justru BEKERJA menahan beban semalaman — padahal saat
tidur, tubuh seharusnya beristirahat, bukan menahan tekanan.

### 16.6 Tambahan Wawasan Pelengkap (di luar artikel, untuk diskusi lebih kaya)

**Kaitan dengan sains tidur secara umum:**
- Posisi tidur (terlentang/miring/tengkurap) mengubah kebutuhan lapisan —
  tidur miring butuh lapisan lebih tebal di area bahu & pinggul (titik
  tekan terbesar) dibanding tidur terlentang
- Suhu tubuh turun alami saat tidur nyenyak — ini kenapa breathability
  kain (poin di artikel-4) bukan cuma soal "adem", tapi mendukung siklus
  tidur alami tubuh (thermoregulation)
- Fase tidur dalam (deep sleep/NREM) adalah saat tubuh benar-benar
  melakukan restorasi/pemulihan jaringan — ini yang dimaksud "restorasi
  total" di artikel-2, dan kasur yang salah bisa memotong fase ini
  berkali-kali semalaman tanpa penderita sadar (micro-arousal)

**Kaitan dengan ortopedi/ergonomi tidur:**
- "Skoliosis fungsional" (disebut di artikel-3 & artikel-1) berbeda dari
  skoliosis struktural bawaan — ini kelengkungan yang terbentuk dari
  kebiasaan posisi (termasuk tidur di kasur yang tidak rata), berpotensi
  membaik kalau penyebabnya dikoreksi (berbeda dari skoliosis struktural
  yang perlu penanganan medis khusus)
- Prinsip "spinal alignment netral" yang dipegang Sano Care sejalan dengan
  prinsip ergonomi tidur pada umumnya — tulang belakang idealnya membentuk
  garis lurus dari leher ke pinggul saat tidur miring, atau menjaga kurva
  alami (leher-punggung-pinggang) saat terlentang

**Kenapa "berat badan" jadi pertanyaan kunci (bukan cuma ukuran kasur):**
Ini alasan teknis kenapa Sano Care selalu tanya berat badan sebelum
rekomendasi (relevan untuk alur diagnosa Sano AI di Fase 4): elastisitas
material (density busa/pocket spring) punya rentang beban optimal. Orang
dengan berat badan lebih ringan di kasur yang terlalu keras/density
tinggi akan "mengambang" (tidak cukup tenggelam untuk pressure relief);
orang dengan berat badan lebih berat di kasur density rendah akan
"tenggelam" melewati titik optimal (bottoming out) — dua-duanya sama-sama
merusak alignment tulang belakang meski dari arah berlawanan.

### 16.7 Istilah & Kosakata Brand (dipakai konsisten di semua komunikasi)

**Tagline resmi Sano: "Ahlinya Kasur Sehat"** — bisa dipakai di
perkenalan/penutup percakapan untuk menegaskan positioning ahli, bukan
sekadar toko/CS.

**Istilah teknis BOLEH dipakai** (justru membangun kredibilitas "ahli"),
selama diikuti penjelasan singkat dalam kalimat yang sama untuk awam:
Pocket Spring, Bonnel Spring, HR Foam (High Resilience), Latex, HD Foam
(High-Density), PE Encasement, density (26/50/80), dsb. Contoh pola:
"kasur ini pakai Pocket Spring — per yang dibungkus satu-satu jadi lebih
senyap dan minim getaran nular ke pasangan tidur."

| Istilah | Jangan disebut sebagai |
|---|---|
| Matras Sehat | "kasur bagus" (terlalu generik) |
| Upgrade Fondasi/Lapisan | "ganti kasur" (beda konsep — tanpa beli baru) |
| Restorasi Total | "servis kasur" (terdengar sekadar reparasi kecil) |
| PAS & PRESISI | "empuk" atau "keras" saja (miskonsepsi yang ingin diluruskan) |
| HNP Fungsional, Skoliosis Fungsional | istilah medis ini boleh dipakai TAPI selalu
  diikuti penjelasan awam, jangan dibiarkan berdiri sendiri terdengar menakutkan |

Nada komunikasi brand: **klinis tapi hangat** — pakai istilah teknis
untuk membangun kredibilitas, TAPI selalu diterjemahkan ke bahasa awam
dalam kalimat yang sama. Ini konsisten dengan gaya "Prof KM" (edukator)
dan "Doktress" (otoritas medis) di persona brand yang sudah ada.

### 16.8 Garansi & Kebijakan Komplain (PENTING untuk alur AI)

⚠️ **KOREKSI (3 Juli 2026):** garansi Klinik Matras **BUKAN flat 20 tahun**
untuk semua — ada 2 tingkat paket:
- **Paket Standard**: garansi amblas 10 tahun, garansi busa/kempes 5
  tahun, trial kenyamanan 7 hari, pengerjaan 7 hari kerja
- **Paket Premium**: garansi amblas 20 tahun, garansi busa/kempes 10
  tahun, trial kenyamanan 30 hari, pengerjaan 3 hari (prioritas) —
  khusus disarankan untuk keluhan medis (saraf kejepit, skoliosis, nyeri
  kronis)

**Sano TIDAK BOLEH menyebut "garansi 20 tahun" secara flat/rata** —
harus jelaskan ada 2 tingkat, dan tanya/rekomendasikan sesuai kondisi
customer. Detail lengkap ada di
docs/knowledge-base/02-harga-layanan.md bagian "Paket Garansi".

Garansi ini bukan cuma nilai jual — ini alasan operasional kenapa
komplain HARUS ditangani manusia secepat mungkin, bukan AI.

**Aturan mutlak: customer yang marah/komplain di chat manapun (termasuk
chat pertama) → LANGSUNG handover ke sales/tim, JANGAN dicoba diredakan
oleh AI dulu.** Pola yang sudah terbukti di lapangan: kasus komplain
biasanya butuh **telepon langsung** dari tim untuk meyakinkan proses
revisi ulang kasur (bagian dari garansi trial kenyamanan) — ini butuh
nada suara manusia dan keputusan real-time yang AI tidak boleh coba
ambil alih. Trust customer di momen komplain jauh lebih rapuh dibanding
chat biasa — respons AI yang terasa "template" di saat itu berisiko
merusak trust yang sudah dibangun lewat garansi ini.

Sumber lengkap: file artikel-1.docx s/d artikel-5.docx (1 Juli 2026),
Proses_Produksi.xlsx + tabel harga & garansi (3 Juli 2026) — sudah
diolah jadi docs/knowledge-base/*.md, siap upload ke Knowledge Base CRM.

Sumber lengkap: file artikel-1.docx s/d artikel-5.docx (di-upload Gilang,
1 Juli 2026) — pertimbangkan upload versi final ke Knowledge Base CRM
(Fase A) begitu konten sudah difinalisasi/ditambah.

## 17. REFERENSI KOMPETITOR (inspirasi, bukan copy)

**WooBlazz CRM:** dark sidebar, Kanban pipeline nilai Rupiah, tabel+pagination+export,
broadcast wizard, automasi workflow visual, studio kustom kolom

**Wulan AI (furniture business):** sidebar section-based, hybrid WA (Meta+Baileys),
broadcast anti-ban rate limiter, handover queue, AI Playground BYOK, Customer 360 segmentasi

**GrowthCircle.id (komunitas):** OpenClaw + Hermes Agent — AI untuk follow-up, 
handover, closing. Bukan sekadar FAQ bot. Ini inspirasi untuk Phase 4 AI Agent.
---

## 18. MCP SERVER READ-ONLY (/mcp) — akses baca CRM untuk Claude

Ditambahkan 13 Agustus 2026. Panduan lengkap: `docs/MCP-SERVER.md`.
Kode: `backend/src/mcp/` (index.js = router/transport, security.js = token +
rate limit + masking, tools.js = 12 tool baca). Tes: `backend/tests/mcp.test.js`.

**Apa ini:** endpoint MCP (Model Context Protocol) di `POST /mcp`, di-mount ke
backend Express yang SUDAH ADA — bukan service/container terpisah — supaya
Claude bisa MENJAWAB pertanyaan soal data CRM (pelanggan, order, pipeline,
percakapan, produk) tanpa bisa mengubah apa pun. Transport: Streamable HTTP
(`@modelcontextprotocol/sdk`), mode STATELESS.

**⚠️ ATURAN YANG TIDAK BOLEH DIKOMPROMIKAN:**

1. **SEMUA tool read-only.** Tidak ada create/update/delete/upsert/$executeRaw/
   $transaction. TIDAK ADA pengiriman pesan WhatsApp — jangan pernah import
   `services/wahaClient.js` di `src/mcp/`. `tests/mcp.test.js` memindai
   `tools.js` dan GAGAL kalau pola terlarang itu muncul; jangan matikan tesnya.
2. **Auth = Bearer token dari env `MCP_API_TOKEN`**, BUKAN JWT user. Kalau env
   kosong, seluruh `/mcp` menjawab 503 (fail-closed) — lupa isi env tidak
   pernah berarti data terbuka. Rotasi = ganti nilai + restart backend.
3. **Nomor HP & email pelanggan DI-MASK default** (`628****0076`), pakai
   `maskPhone()`/`maskEmail()` dari `src/mcp/security.js`. Tiap tool yang
   mengembalikan kontak wajib punya param opsional `unmask`.
4. **Rate limit 60 req/menit per IP** (`MCP_RATE_LIMIT_PER_MIN`). Kunci limit
   dari `X-Forwarded-For` karena di belakang nginx `req.ip` selalu 127.0.0.1.

**nginx:** TIDAK perlu diubah — `/mcp` ikut `proxy_pass http://localhost:4000`
yang sudah ada. `proxy_buffering off` baru relevan kalau suatu hari pindah ke
mode stateful/SSE panjang — diskusikan dulu, jangan diedit sendiri.

**Mounting:** `app.use("/mcp", mcpRouter)` di `src/index.js` HARUS di atas
`express.static` + catch-all `app.get("*")`. Kalau di bawah, request /mcp
dijawab index.html React, bukan JSON-RPC.

**Menyambungkan ke Claude:** Claude Code/Desktop bisa langsung (custom header
Authorization). Connector di claude.ai kemungkinan menuntut OAuth — kalau
begitu, tambahkan lapisan OAuth di depan `/mcp`, JANGAN "sementara" membuka
endpoint tanpa auth untuk tes.

### 18b. OAuth 2.1 untuk /mcp — koneksi claude.ai BROWSER (ditambah 14 Agustus 2026)

Custom connector claude.ai browser TIDAK punya kolom header kustom (cuma
OAuth Client ID/Secret) dan fitur `static_headers` (beta) belum rollout ke
akun ini — dikonfirmasi lewat screenshot dialog "Tambah konektor kustom".
Karena itu `/mcp` sekarang jadi *protected resource* OAuth 2.1 sungguhan,
HIDUP BERDAMPINGAN dengan token statis di atas (Claude Code TIDAK terpengaruh
sama sekali). Panduan lengkap & langkah verifikasi manual: `docs/MCP-SERVER.md`.

Kode: `backend/src/mcp/oauthCrypto.js` (primitif murni: PKCE S256, sign/verify
JWT, hash token — TANPA Prisma, gampang dites) dan `backend/src/mcp/oauth.js`
(router: `/.well-known/oauth-protected-resource`,
`/.well-known/oauth-authorization-server`, `POST /oauth/register` (DCR),
`GET/POST /oauth/authorize` (halaman login+consent server-rendered),
`POST /oauth/token`). Tes: `backend/tests/mcp-oauth.test.js`.

**⚠️ ATURAN YANG TIDAK BOLEH DIKOMPROMIKAN (tambahan dari §18):**

1. **Hanya user ber-role ADMIN yang boleh login+approve** di
   `/oauth/authorize` — keputusan sadar, karena tool MCP membaca SEMUA data
   pelanggan lintas sales (bukan cuma milik sendiri), setara dengan "siapa
   yang boleh pegang MCP_API_TOKEN" (sebelumnya cuma admin). Cek role WAJIB
   lewat `rolesOf()` dari `middleware/authorize.js` — JANGAN pernah cek
   `user.role === "ADMIN"` langsung (lihat peringatan D-010 di §9, bug nyata
   yang sudah pernah terjadi akibat pola ini).
2. **`redirect_uris` di Dynamic Client Registration WAJIB persis**
   `https://claude.ai/api/mcp/auth_callback` — `POST /oauth/register`
   menolak SEMUA nilai lain (`validateRedirectUris` di `oauthCrypto.js`).
   Ini yang membuat authorization server ini efektif cuma bisa dipakai
   Claude, walau `client_id` bisa didaftarkan siapa saja lewat DCR.
3. **`MCP_OAUTH_JWT_SECRET` WAJIB beda dari `JWT_SECRET`** (login CRM) —
   supaya access token MCP dan token login CRM tidak bisa dipakai silang.
4. **Refresh token WAJIB rotasi** tiap dipakai (public client + PKCE) —
   token lama langsung `revokedAt`, reuse setelah rotasi = `invalid_grant`.
   Jangan "menyederhanakan" jadi refresh token yang tidak pernah kedaluwarsa.
5. **PKCE method WAJIB S256**, tidak ada fallback ke `plain`.

**Model Prisma baru (FK ke User pakai `onDelete: Cascade`, SENGAJA beda dari
pola RESTRICT/SetNull di Order/Unit — ini kredensial ephemeral, bukan riwayat
bisnis):** `McpOAuthClient`, `McpAuthorizationCode`, `McpRefreshToken`.

**Env var baru:** `MCP_PUBLIC_URL` (origin publik, dipakai di URL metadata
OAuth) dan `MCP_OAUTH_JWT_SECRET` (secret access token OAuth MCP).
`requireMcpToken` di `security.js` sekarang fail-closed berdasarkan
`mcpAuthConfigured()` = token statis ATAU OAuth (bukan cuma token statis
seperti sebelumnya) — kalau DUA-DUANYA kosong baru 503.
### 18c. Perluasan tool MCP — chat mendalam, audit sales, traffic iklan (14 Agt 2026)

18 tool sekarang (dari 12), dipecah 3 file + helper bersama: `src/mcp/tools.js`
(CRM inti), `toolsChat.js` (percakapan/kualitas/audit), `toolsTraffic.js`
(traffic & iklan), `toolsShared.js` (helper). Detail: `docs/MCP-SERVER.md`.

**⚠️ ATURAN PENTING:**

1. **Audit sales TIDAK punya mesin aturan sendiri** — semuanya dipakai ulang:
   `violations()` dari `services/replyAssistant/validator.js` (7 kategori janji
   terlarang), `detectIntents()`/`INTENT_TAXONOMY` dari
   `services/intelligence/replyReadiness.js` (COMPLAINT & HANDOVER_REQUEST wajib
   manusia), dan `buildCustomerIntelligence()` dari `services/intelligence/`
   (skor relasi/urgensi/peluang). **Jangan bikin definisi aturan kedua di MCP** —
   kalau aturan produk berubah, cukup ubah di validator.js dan audit ikut berubah.
2. **SLA balas pertama = 60 menit** (`SLA_BALAS_PERTAMA_MENIT` di toolsChat.js),
   SENGAJA sama dengan `sla_breach` di routes/analytics.js dan ambang takeover
   §7C. Jangan diganti sepihak — nanti laporan CRM & audit MCP bertentangan.
   (`THRESHOLDS.unansweredMinutes` 180 menit di intelligence/weights.js BEDA
   urusan: itu "follow-up menunggu", bukan SLA balas pertama.)
3. **Kalau menambah file `toolsXxx.js` baru, WAJIB daftarkan di `FILE_TOOL`**
   pada `tests/mcp.test.js`. Ada tes yang mencocokkan daftar itu dengan isi
   folder, jadi kelupaan pasti ketahuan — jangan matikan tes itu.
4. **Batas jumlah data itu disengaja** (76rb pesan di production):
   `audit_balasan_sales` maks 5.000 pesan keluar + 500 percakapan,
   `kualitas_engagement` maks 500 percakapan, 200 pesan per percakapan. Tool
   mengembalikan `terpotong`/`adaLagi` — hasil yang terpotong TIDAK BOLEH
   disajikan sebagai total periode.

**TrackedLink KOSONG di production (0 link, 0 klik — diverifikasi 14 Agt 2026).**
Karena itu `performa_iklan` dibangun di atas `Customer.leadSource` + atribusi
CTWA (`ctwa_source_url` = URL kreatif IG/FB), BUKAN TrackedLink. Cakupan CTWA
masih sebagian (aktif sejak 13 Agt 2026) dan tool WAJIB menyatakannya di output —
jangan sajikan angka parsial seolah lengkap. Kalau nanti TrackedLink mulai
dipakai, tool ini perlu diperluas.

**⚠️ ATURAN DRAF AI ≠ ATURAN SALES MANUSIA (temuan 14 Agt 2026).**
`violations()` dibangun untuk membatasi DRAF AI. Sebagian aturannya TIDAK
berlaku untuk sales manusia — menyebut harga ke pelanggan itu memang TUGAS
sales. `audit_balasan_sales` karena itu memisahkan hasil jadi 3 lewat
`RUANG_LINGKUP_ATURAN` di `toolsChat.js`:
- `pelanggaran` (siapa pun): warranty, medical, certainty — dasar §16.8 yang
  menyebut "Sano" (brand), bukan "AI".
- `perluTinjau` (tergantung konteks): delivery, discount, freebie — bisa SAH
  kalau sesuai paket/promo resmi.
- `aturanKhususAi`: price — dasar Fase 4 yang menulis eksplisit "yang tidak
  boleh dijanjikan AI". Default TIDAK dihitung sebagai pelanggaran sales.

Bukan teori: audit 30 hari data production awalnya melaporkan 629
"pelanggaran", 420 di antaranya kategori price yang ternyata sales sedang
menjelaskan promo resmi. Yang tersisa sebagai pelanggaran nyata: 93 klaim
"garansi 20 tahun" flat — itu memang melanggar §16.8 (garansi 2 tingkat).
**JANGAN gabungkan ketiga kelompok itu jadi satu angka.**

**⚠️ Skor engagement pernah salah kalibrasi.** Versi pertama membuat
percakapan dangkal langsung mentok 100 → distribusi production 165 TINGGI /
0 SEDANG / 35 RENDAH, tidak bisa dipakai memprioritaskan. Sudah diperbaiki
(138/27/35) dan dikunci tes di `tests/mcp-chat.test.js`. Kalau menyetel ulang
bobotnya, jalankan tes itu DAN cek ulang distribusinya di production — jangan
menilai dari satu contoh percakapan saja.

---

## 19. KESIAPAN OPERASIONAL LINTAS DIVISI (21 Agustus 2026)

Audit + perbaikan sebelum praktek bareng tiap divisi. Angka diverifikasi
langsung ke database produksi dengan `COUNT(*)` (BUKAN `pg_stat_user_tables`,
yang estimasinya basi dan sempat melaporkan tabel terisi sebagai 0).

**Kondisi data:** Sales CRM hidup (3.325 pelanggan, 96.719 pesan, 318 order,
317 unit). Master data operasional LENGKAP (12 routing_stages, 6 service_catalog,
11 modul, 15 material, 61 produk, 1 gudang, 1 kendaraan). Tapi eksekusi NOL:
0 unit_stage_logs, 0 jobs, 0 qc_fit_tests, 0 payments, 0 stock_movements.

**Penyebabnya bukan kode, tapi ketiadaan akun ber-peran** — sudah diperbaiki
dengan penambahan 8 akun di §1.

### ⚠️ Lubang integritas yang MASIH TERBUKA

**`Order.paymentStatus` tidak terhubung ke tabel `payments`.** 149 order
berstatus LUNAS + 1 DP, tapi tabel `payments` KOSONG — status itu dropdown yang
diklik sales, tanpa catatan siapa menerima uang, kapan, lewat apa. Jangan
backfill (berarti mengarang tanggal & penerima); jadikan `paymentStatus`
TURUNAN dari `payments` untuk transaksi baru.

### Bug yang ditemukan & diperbaiki di sesi ini

Ketiganya lolos selama ini karena SELURUH pengujian sebelumnya memakai akun
ADMIN, yang punya semua hak — begitu diuji dengan akun peran sungguhan,
langsung ketahuan. **Kalau menambah fitur per-divisi, uji dengan akun peran
itu, jangan admin.**

1. `GET /production/qc-queue` dijaga `QC_WRITE` padahal cuma MEMBACA antrean →
   Kepala Produksi 403, buta terhadap unit yang tertahan di gerbang QC.
   Diturunkan ke `UNIT_READ`. Keputusan verdict TETAP `QC_WRITE`
   (`POST /units/:id/stages/:stageId/qc`) — pemisahan tugas tidak berubah.
2. `/armada` mengarahkan SEMUA orang ke `/armada/dashboard` yang butuh
   `JOB_READ` → driver (cuma `JOB_OWN_READ`) mendarat di halaman yang pasti
   gagal. Sekarang driver diarahkan ke `/armada/jobs`.
3. `/armada/jobs` default ke tampilan "Daftar" milik dispatcher → 403 beruntun
   untuk driver, padahal layar driver ("Job Saya" + `DriverJobs`) SUDAH ADA di
   `Armada.jsx` tapi tidak pernah tercapai. Driver-only sekarang langsung ke
   sana, dan sidebar Delivery untuk driver dipangkas dari 9 menu jadi 1.

### Yang MASIH data contoh (jangan dibaca sebagai angka nyata)

- `/armada/dashboard` & `/portal` — sebagian widget dari `deliveryMock.js`
- `/armada/tracking` — `trackingMock.js`, **100% simulasi**: koordinat 0–100 di
  kanvas abstrak, nama driver karangan. TIDAK ADA tabel/endpoint posisi GPS
  di backend sama sekali.
- Halaman Gudang — `warehouseMock.js` (backend nyata, tabel masih kosong)

Semuanya sudah menandai diri dengan badge "Contoh". Jangan hapus badge itu
sebelum sumber datanya benar-benar diganti ke endpoint nyata.
