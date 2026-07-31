# Sano Hub — Phase 0 (Fondasi)

**Status: menunggu persetujuan Gilang. Belum ada kode yang ditulis.**

Phase 0 di sini BUKAN Phase 0 versi PRD §11 — PRD mengasumsikan sistem baru
dari nol. Kita memperluas sistem yang sudah melayani 7 user, 1.320+ customer,
dan percakapan WhatsApp yang hidup. Jadi aturannya: **Phase 0 tidak boleh
mengubah satu pun perilaku yang dilihat tim hari ini.**

Semua di bawah ini aditif. Kalau Phase 0 selesai dan tidak ada yang sadar ada
yang berubah, itu tandanya benar.

---

## 1. Yang dibangun

### 1.1 Perluasan role (D-010)
- Tabel `UserRole` (many-to-many), permission aditif
- Migrasi 7 user existing: Gilang → `ADMIN` + `FINANCE`, Novi → `ADMIN`,
  5 sales → `SALES`. Perilaku hari ini tidak berubah sedikit pun.
- Role baru DIDEFINISIKAN tapi belum dipakai: `PRODUCTION_LEAD`,
  `PRODUCTION_WORKER`, `QC_LEAD`, `WAREHOUSE`, `DISPATCHER`, `DRIVER`,
  `FINANCE`
- Middleware otorisasi Express (pengganti RLS) + tes-nya. Ini yang menahan
  aturan "pekerja produksi tidak melihat nomor telepon & harga customer",
  jadi harus benar sebelum ada pekerja produksi yang login.

### 1.2 Entitas Unit (D-002)
- Model `Unit`: `unit_code` (QR, format `<orderNumber>-U<n>`), FK ke `Order`,
  `seq`, merk, ukuran, `service_line`, status, lokasi penyimpanan.
  `current_stage_id` dan `service_code` sengaja BELUM ada — menyusul bersama
  migrasi routing yang memiliki tabel tujuannya.
- Backfill: **`quantity` unit per order** (bukan selalu 1 seperti rencana
  awal — `Order.quantity` sudah menyimpan jumlah kasur, dan membuat 1 unit
  untuk order berisi 3 kasur justru membuang informasi yang sudah ada).
- Order lama tanpa `orderNumber` (hasil import Excel Jan–Jun) memakai kode
  warisan `LEG-<8 char id order>-U<n>`.

> ⚠️ **Temuan 31 Juli 2026 yang mengubah rencana backfill.** `merkKasur`,
> `ukuranKasur`, dan `keluhanCustomer` **BUKAN kolom database**. Ketiganya
> disimpan sebagai string JSON di dalam `Order.notes`, lewat `buildNotes()` /
> `parseNotes()` yang diduplikasi di frontend web DAN mobile. Baris lama berisi
> teks polos (dianggap keluhan saja). Jadi backfill harus mem-parse JSON
> dengan aman — cast `::jsonb` polos akan meledak di baris warisan. Migrasi
> memakai fungsi `pg_temp.safe_jsonb()` yang mengembalikan NULL saat gagal.
>
> **ASUMSI YANG PERLU DIKONFIRMASI:** `Order.quantity` = jumlah kasur fisik.
> Kalau ternyata artinya lain (mis. jumlah paket layanan), backfill unit
> jadi salah dan harus diulang sebelum ada data produksi yang menempel.
- `Order.status` **tetap seperti sekarang** — masih ditulis manual, belum jadi
  turunan. Peralihan ke derived terjadi di Phase 1, setelah unit benar-benar
  bergerak lewat tahap. (Pola strangler: dua-duanya hidup berdampingan
  sebentar, yang lama dimatikan setelah yang baru terbukti.)

### 1.3 Master data routing (D-003, D-004)
- Tabel `routing_stages`, `service_catalog`, `service_modules`
- Seed persis dari `ROUTING.md` §2 dan §3
- `OrderItem.layananName` (string bebas hari ini) dipetakan ke
  `service_catalog` — perlu audit dulu: layanan apa saja yang benar-benar
  tertulis di 1.320+ customer, dan berapa yang tidak cocok dengan enam
  layanan resmi

### 1.4 Kerangka portal
- Halaman portal: kartu sesuai role user (`frontend/src/pages/Portal.jsx`)
- Nama portal: **Growth · Bengkel · Armada · Kendali**
- Isi portal Bengkel/Armada/Kendali masih kosong, ditandai badge "Segera" dan
  tidak bisa diklik — jangan sampai ada yang mendarat di halaman kosong tanpa
  penjelasan
- Endpoint `GET /api/auth/me` mengembalikan role + portal yang boleh dibuka.
  Sengaja membaca dari DATABASE, bukan dari token: pencabutan role oleh admin
  langsung berlaku saat refresh, tidak menunggu token 7 hari kedaluwarsa.

> ⚠️ **PENYIMPANGAN DARI RENCANA AWAL — halaman portal BUKAN landing default.**
> Rencana semula: portal jadi halaman pertama setelah login. Yang dibangun:
> rute `/portal` terpisah, landing tetap `/dashboard`.
>
> Alasannya: tiga dari empat portal masih kosong di Phase 0. Memindahkan 7
> orang yang sedang bekerja ke layar pemilih berisi kartu mati adalah
> penurunan kualitas, dan melanggar aturan Phase 0 sendiri ("tidak boleh
> mengubah satu pun perilaku yang dilihat tim hari ini").
>
> Ditukar jadi landing default di Phase 1, begitu portalnya berisi. Satu baris
> perubahan di `App.jsx`.

---

## 2. Yang TIDAK ada di Phase 0

Ditulis eksplisit supaya tidak diam-diam merembes:

- Tidak ada scan QR, tidak ada pelacakan tahap, tidak ada papan Kanban
- Tidak ada inventory sama sekali (material, ledger, remnant) — Phase 3, dan
  D-007 memastikan tidak mendesak: stok selalu ada
- Tidak ada job pickup/delivery, rute, atau app driver
- Tidak ada pencatatan pembayaran
- Tidak ada ScopeRevision (Phase 1, D-008)
- Tidak ada kolom "untuk nanti". Kalau Phase 0 tidak memakainya, jangan
  ditambahkan.

---

## 3. Yang harus dijalankan paralel oleh Gilang (bukan pekerjaan kode)

Ini yang biasanya menunda launch, dan lead time-nya di luar kendali kita:

1. ~~**Printer label termal + stok label + scanner cadangan.**~~
   ⛔ **DIBATALKAN 31 Juli 2026 — JANGAN DIBELI.** Model kiosk scan tidak
   sesuai cara kerja Sano: satu QC Leader yang meng-update semua proses, dan
   ID Order sudah cukup sebagai identitas. Lihat D-014.
2. **Konfirmasi pemetaan garansi** (asumsi terbuka di D-004): apakah
   SERVICE → paket Standard dan UPGRADE → paket Premium benar-benar 1:1?
3. **Daftar orang + role.** Siapa Production Lead, siapa QC Leader, berapa
   driver, siapa dispatcher. Role tanpa orang tidak bisa diuji.
4. **Survei wifi bengkel.** PRD §9.4: lantai produksi tidak dibangun offline.
   Kalau wifi bengkel tidak andal, perbaiki wifi — jauh lebih murah daripada
   membangun sinkronisasi offline dua kali.

---

## 4. Risiko Phase 0

| Risiko | Kenapa serius | Penanganan |
|---|---|---|
| Backfill Unit salah di order lama | 1.320+ customer, order historis dari import Excel Jan–Jun formatnya tidak seragam | Dry-run dulu + laporan berapa order yang datanya tidak lengkap, sebelum apply. Pola yang sama seperti `fix-lid-customers.js` |
| `OrderItem.layananName` teks bebas tidak cocok katalog | Pemetaan modul gagal diam-diam → routing kosong | Audit nilai distinct DULU (bagian 1.3), baru rancang pemetaan |
| Middleware otorisasi bocor | Pekerja produksi melihat PII & harga customer | Tes otorisasi wajib ada di Phase 0, bukan menyusul |
| Perluasan role merusak login yang jalan | 7 orang tidak bisa kerja | `UserRole` diisi dari `User.role` lama; kolom lama TIDAK dihapus di Phase 0 |

---

## 5. Definisi selesai

Phase 0 selesai kalau semua ini benar dan sudah diverifikasi dengan output
nyata, bukan asumsi:

Sudah terverifikasi di database sekali pakai (31 Juli 2026):

- [x] 3 migrasi jalan bersih dari nol bersama 41 migrasi lama
- [x] `prisma migrate diff` tidak menunjukkan drift dari tabel Sano Hub
- [x] Backfill diuji terhadap data bermasalah yang sengaja dibuat: JSON rusak,
      notes teks polos, `orderNumber` NULL, `quantity` 0 dan 3, merk berisi
      spasi — 9 invarian lulus
- [x] FK RESTRICT terbukti mencegah penghapusan Order yang masih punya unit
- [x] Seed routing cocok dengan `ROUTING.md` (12 tahap, 6 layanan, 11 modul)
- [x] 16 tes otorisasi lulus (`npm test`), termasuk: `PRODUCTION_WORKER` tidak
      bisa membaca PII maupun harga, dan token lama tanpa `roles` tidak
      kehilangan akses
- [x] Frontend build sukses, chunk `Portal-*.js` terbentuk

Belum — butuh deploy sungguhan:

- [ ] `npx prisma migrate deploy` jalan bersih di VPS **dengan data asli**
      (angka backfill nyata baru terlihat di sini)
- [ ] 7 user existing login dan bekerja persis seperti sebelumnya
- [ ] Hash bundle frontend berubah setelah deploy (CLAUDE.md §12 — ini yang
      berkali-kali bikin "kode benar tapi tampilan tidak berubah")
- [ ] Konfirmasi `Order.quantity` = jumlah kasur fisik (kalau salah, backfill
      unit harus diulang SEBELUM ada data produksi menempel)

---

## 6. Setelah ini

**Phase 1 — Tulang punggung.** Order → unit → job pickup → scan intake →
tahap produksi → Uji Berat Badan → job delivery → bukti serah terima.
Penjadwalan manual, belum ada route builder, belum ada inventory. Plus
ScopeRevision (D-008) dan pencatatan pembayaran driver (D-011), yang keduanya
naik dari fase belakang karena jawaban Gilang.

Jalankan 20 order asli lewat Phase 1 sebelum membangun apa pun setelahnya.
