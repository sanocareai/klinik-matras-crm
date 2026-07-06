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

**Tim pengguna sistem (7 orang):**
- 1 OWNER/Admin: Gilang (admin@klinikmatras.com)
- 1 Admin: Novi (novi@klinikmatras.com)
- 5 Sales: Risel, Farhan, Mila, Kiki, Sales 6
- Password semua: kasursehat1 (sementara, perlu diubah per user)

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

### BUG LID (PRIORITAS TERTINGGI — BELUM SELESAI)

WAHA NOWEB mengirim `from: "201086224863438@lid"` (LID/Local ID) 
bukan nomor telepon asli. Nomor asli ada di:
`payload._data.key.remoteJidAlt = "6285697620076@s.whatsapp.net"`

**Dampak:**
- Customer tersimpan dengan nomor LID (angka 15 digit bukan format 62xxx)
- Balasan dari CRM nyasar (dikirim ke LID, bukan ke nomor asli)
- Tab Pelanggan kemungkinan crash/blank karena data LID tidak valid
- Percakapan dobel di WAHA (satu dari nomor asli, satu dari LID)

**Fix yang harus ada di backend/src/routes/webhooks.js:**
```javascript
function extractPhoneNumber(payload) {
  // NOWEB pakai @lid — nomor asli ada di remoteJidAlt
  if (payload._data?.key?.addressingMode === "lid" && 
      payload._data?.key?.remoteJidAlt) {
    return payload._data.key.remoteJidAlt.split("@")[0];
  }
  // Format normal @c.us
  return (payload.from || "").split("@")[0];
}
```

**Setelah fix kode:** jalankan `node scripts/fix-lid-customers.js` untuk 
cleanup data customer lama yang tersimpan dengan LID.

**Saat kirim balasan (wahaClient.js):** chatId HARUS pakai format 
`${phone}@c.us` — JANGAN @lid.

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

// Enum penting:
PipelineStage: LEAD, QUALIFIED, QUOTED, WON, LOST
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

## 7A. REVISI BATCH — 2 Juli 2026 (12 poin dari Gilang)

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
- ⚠️ Beberapa halaman masih terpotong (Pengaturan, Laporan, Pengguna & Peran)
  — perbaikan dalam antrean

### 🔄 PWA (Dalam Progress)
- vite-plugin-pwa sudah atau akan diinstall
- Icon 192x192 dan 512x512
- Install prompt banner (Android)
- Service worker dengan NetworkFirst untuk /api/*
- ⚠️ Test di Chrome Android dulu sebelum submit ke Play Store

---

## 9. YANG BELUM / ROADMAP

### 🔨 Sedang Dikerjakan / Antrean Bugfix
- Fix bug LID (PRIORITAS TERTINGGI)
- Mobile UI fixes: Pengaturan, Laporan, Pengguna & Peran terpotong
- Inbox header nama customer overflow di mobile
- Pipeline rigid di mobile
- Notifikasi in-app (badge unread di icon 🔔 topbar)
- Push notification Android (web-push + service worker)
- Tab Pelanggan blank/crash (kemungkinan besar disebabkan bug LID)

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

---

## 12. WORKFLOW DEVELOPMENT

```bash
# 1. LAPTOP — edit & test lokal
docker compose up -d postgres waha  # nyalakan DB & WAHA
cd backend && npm run dev            # terminal 1 (port 4000)
cd frontend && npm run dev           # terminal 2 (port 5173)

# 2. COMMIT & PUSH ke GitHub
git add .
git commit -m "feat: deskripsi"
git push

# 3. DEPLOY ke VPS
ssh ubuntu@43.133.152.6
cd ~/klinik-matras
git pull
cd frontend && npm install && npm run build && cd ..
docker compose up -d --build

# 4. KALAU ADA PERUBAHAN SCHEMA DATABASE
docker compose exec backend npx prisma migrate deploy

# 5. UTILITAS
npx prisma migrate dev --name nama_migration  # buat migration baru (lokal)
npx prisma studio                              # GUI database
docker compose exec backend node scripts/nama-script.js  # jalankan script
```

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

Klinik Matras memberikan **garansi kenyamanan & kerusakan 20 tahun**.
Ini bukan cuma nilai jual — ini alasan operasional kenapa komplain HARUS
ditangani manusia secepat mungkin, bukan AI.

**Aturan mutlak: customer yang marah/komplain di chat manapun (termasuk
chat pertama) → LANGSUNG handover ke sales/tim, JANGAN dicoba diredakan
oleh AI dulu.** Pola yang sudah terbukti di lapangan: kasus komplain
biasanya butuh **telepon langsung** dari tim untuk meyakinkan proses
revisi ulang kasur (bagian dari garansi 20 tahun) — ini butuh nada suara
manusia dan keputusan real-time yang AI tidak boleh coba ambil alih.
Trust customer di momen komplain jauh lebih rapuh dibanding chat biasa —
respons AI yang terasa "template" di saat itu berisiko merusak trust
yang sudah dibangun garansi 20 tahun.

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

## 18. BACKUP DATABASE OTOMATIS

**Script backup:** `backend/scripts/backup-database.sh`
**Script restore:** `backend/scripts/restore-database.sh`
**Panduan lengkap:** `docs/PANDUAN-RESTORE-BACKUP.md`

**Alur backup:**
```
Cron 03:00 WIB → pg_dump | gzip → ~/klinik-matras/backups/
→ rclone upload → gdrive:klinik-matras-backups/
→ hapus lokal >7 hari
→ hapus Drive >30 hari
→ kalau gagal → WA notifikasi ke BACKUP_NOTIFY_PHONE
```

**Cron di VPS (setup manual oleh Gilang setelah git pull):**
```
0 3 * * * cd /home/ubuntu/klinik-matras && ./backend/scripts/backup-database.sh >> /home/ubuntu/klinik-matras/backups/backup.log 2>&1
*/15 * * * * cd /home/ubuntu/klinik-matras && ./backend/scripts/check-waha-status.sh >> /home/ubuntu/klinik-matras/backups/waha-monitor.log 2>&1
```

**Script monitoring WAHA:** `backend/scripts/check-waha-status.sh`
- Cek WAHA session setiap 15 menit
- Debounce: alert maksimal 1x per jam (lock file di /tmp)
- Lock file hilang saat reboot → langsung alert kalau WAHA belum reconnect

**Env var yang perlu ditambah di `backend/.env` di VPS:**
```
BACKUP_NOTIFY_PHONE=628xxxxxxxxx   # nomor WA admin untuk notifikasi backup gagal + WAHA alert

# Email fallback — kalau WAHA mati, alert dikirim via email (opsional tapi dianjurkan)
# Gmail: buat App Password di https://myaccount.google.com/apppasswords
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=admin@klinikmatras.com
SMTP_PASS=xxxx xxxx xxxx xxxx    # Gmail App Password (16 karakter dengan spasi)
SMTP_FROM=admin@klinikmatras.com
ALERT_EMAIL_TO=admin@klinikmatras.com
```

**Setup prasyarat di VPS (sekali saja):**
1. `curl https://rclone.org/install.sh | sudo bash` — install rclone
2. `rclone config` — tambah remote bernama `gdrive` → pilih Google Drive → ikuti wizard OAuth
3. `chmod +x backend/scripts/backup-database.sh backend/scripts/restore-database.sh backend/scripts/check-waha-status.sh`
4. Tambah env var ke `backend/.env` → `docker compose restart backend`
5. Setup cron (`crontab -e`)
6. Test manual: `cd ~/klinik-matras && ./backend/scripts/backup-database.sh`
7. Test WAHA monitor: `cd ~/klinik-matras && ./backend/scripts/check-waha-status.sh`

**Notifikasi gagal:** endpoint `POST /api/internal/backup-alert` (no JWT, localhost only)
dipanggil oleh `trap ERR` di script bash → backend kirim WA via wahaClient.

**Notifikasi WAHA down:** endpoint `POST /api/internal/waha-alert` (no JWT, localhost only)
→ coba kirim WA → kalau gagal (WAHA memang down) → fallback kirim email → log ke file.