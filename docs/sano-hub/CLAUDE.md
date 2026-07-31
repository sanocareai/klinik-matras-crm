# CLAUDE.md — Sano Hub

Aturan kerja untuk bagian **Sano Hub** (operasi: unit, produksi, logistik,
inventory). Menggantikan `docs/SANSS_CLAUDE.md`, yang sudah tidak berlaku.

**Baca berurutan sebelum mengerjakan apa pun di area ini:**
1. `/CLAUDE.md` di root repo — aturan induk (stack, deploy, timezone, LID,
   konvensi). Semuanya tetap berlaku di sini.
2. `DECISIONS.md` (folder ini) — keputusan yang sudah dikunci
3. `ROUTING.md` (folder ini) — model produksi
4. `PHASE-0.md` (folder ini) — ruang lingkup yang sedang berjalan
5. `../SANSS-PRD-v1.md` — requirement, dengan pengecualian di banner-nya

---

## Apa ini

Sano Hub adalah CRM Klinik Matras yang diperluas jadi sistem operasi penuh:
CRM & omnichannel yang sudah ada, ditambah bengkel (produksi + inventory),
armada (pickup + delivery), dan kendali (dashboard lintas portal).

Bisnisnya adalah **reverse logistics**: kasur customer keluar dari rumahnya,
dibangun ulang lewat beberapa tahap di bengkel, lalu dikembalikan. Sistem
melacak rantai itu dari ujung ke ujung.

---

## Tiga aturan yang mengalahkan segalanya

### 1. Unit adalah entitas inti, bukan Order
Satu Order bisa berisi banyak Unit. Tiap Unit punya QR, diagnosa, racikan,
tahap, foto, dan tanggal selesainya sendiri. Order cuma pembungkus komersial.

**Kode, query, atau UI apa pun yang mengasumsikan satu order = satu kasur itu
salah.** Status Order **diturunkan** dari Unit-Unitnya, tidak pernah di-set
langsung. Pesanan hotel 30 kasur dikirim bertahap dan tidak pernah berada di
satu status (D-002, D-006).

### 2. Ledger bersifat append-only
`unit_stage_logs`, `stock_movements`, `payments`, `audit_log` hanya boleh
INSERT. Tidak ada UPDATE, tidak ada DELETE.

Koreksi = baris kompensasi baru. Stok = `SUM(qty_delta)` dari ledger. Jangan
pernah menyimpan kolom `current_qty` yang bisa berubah.

Repo ini sudah punya pola yang benar untuk ditiru: `PipelineTransition` dan
`OrderStatusTransition`. Ikuti bentuknya, termasuk `onDelete: SetNull` pada
aktor supaya riwayat operasional tidak hilang saat pegawai resign.

### 3. Routing adalah data, bukan kode
Tahap produksi ada di tabel `routing_stages` / `service_catalog` /
`service_modules`. Lihat `ROUTING.md`.

**Jangan pernah menulis nama tahap di logika aplikasi.** Kalau sampai menulis
`if (stage === 'corner_sewing')`, berhenti — tambahkan kolom flag di
`routing_stages`.

---

## Stack — sama persis dengan CRM

Tidak ada Next.js, tidak ada Supabase, tidak ada Vercel, tidak ada database
kedua (D-001). Yang berlaku adalah stack di `/CLAUDE.md` §3: React 18 + Vite
(plain JS), Express ES Modules, Prisma + PostgreSQL, Docker Compose, nginx
native, VPS Sumopod. App mobile: Expo, sideload APK.

Jangan menambah dependency tanpa bertanya dulu.

---

## Perbedaan yang harus diingat dari PRD

PRD ditulis dengan asumsi Supabase. Terjemahannya ke stack kita:

| PRD bilang | Di sini artinya |
|---|---|
| RLS Postgres, default deny | Middleware otorisasi Express + tes-nya. Cek di klien cuma UX, bukan keamanan. |
| Supabase Realtime | `socket.js` + SSE yang sudah ada |
| Supabase Storage + signed URL | multer + upload dir + URL bertoken |
| Supabase Auth phone OTP untuk driver | JWT yang sudah ada; skema login driver diputuskan di Phase 2 |
| Supabase Cron | node-cron di backend, atau cron VPS |
| `supabase gen types` | Prisma Client (bukan TypeScript — repo ini plain JS) |
| Route group `(growth)` dsb | Route React + guard role di app yang sudah ada |

Yang TIDAK berubah dari PRD: model domain, state machine, disiplin ledger,
model inventory §8, dan aturan bahwa satu foto & satu scan lebih berharga
daripada satu field yang diketik.

---

## Konvensi tambahan

Mengikuti `/CLAUDE.md` (snake_case fisik lewat `@@map` untuk tabel ledger,
camelCase di Prisma, uang integer Rupiah, UTC di dalam WIB di tepi). Tambahan
khusus area ini:

- **ID terbaca manusia:** unit = `<orderNumber>-U<n>`, mis. `RES-07072026-001-U2`.
  Digenerate fungsi Postgres / transaksi counter seperti `OrderSequence`, bukan
  di kode aplikasi (rawan race).
- **Bahasa:** identifier & kode Inggris, label UI Indonesia. Peta istilah ada
  di `ROUTING.md`. Jangan menyebar string Indonesia di komponen.
- **Foto adalah produknya.** `requires_photo` wajib di Uji Sebelum Bongkar,
  Bongkar, Uji Berat Badan, Jahit Corner, dan Finish. Itu sekaligus catatan QC,
  pembelaan sengketa, baseline garansi, dan materi marketing terbaik.
- **Waktu blok dan waktu hold customer dihitung terpisah** dari waktu kerja
  (D-007). Kalau dicampur, data cycle time tidak berguna.

---

## Cara kerja di area ini

Semua aturan `/CLAUDE.md` §12 berlaku (termasuk: **`npm run build` di frontend
VPS itu WAJIB dan sering kelupaan**). Tambahan:

1. **Tanya dulu sebelum ubah skema.** Ajukan SQL-nya, jelaskan trade-off,
   tunggu persetujuan. Salah skema mahal; salah UI murah.
2. **Satu migrasi atau satu fitur per perubahan.** Jangan pernah menerbitkan
   sepuluh migrasi sekaligus.
3. **Aditif dulu.** Sistem ini melayani 7 orang yang sedang bekerja. Kolom &
   tabel baru boleh; mengubah arti kolom yang sudah dipakai perlu rencana
   peralihan (pola strangler — dua-duanya hidup dulu, yang lama dimatikan
   setelah yang baru terbukti).
4. **Verifikasi sebelum bilang selesai.** Jalankan migrasi, jalankan build,
   laporkan output nyata — bukan niat.
5. **Nyatakan asumsi.** Kalau PRD ambigu, sebutkan bacaan mana yang dipakai
   dan tandai. Jangan mengarang aturan bisnis: restorasi kasur punya kendala
   dunia nyata yang tidak terduga, dan menebak menghasilkan kode yang masuk
   akal tapi salah.
6. **Catat keputusan.** Pilihan arsitektur yang tidak jelas-jelas → entri baru
   di `DECISIONS.md`: konteks, pilihan, konsekuensi.
7. **Jangan membangun untuk nanti.** Kalau fase sekarang tidak butuh inventory,
   jangan menambah kolom inventory "buat besok".

---

## Anti-pattern khusus area ini

| Jangan | Lakukan |
|---|---|
| Set `Order.status` langsung | Turunkan dari status Unit |
| Kolom `materials.current_qty` | View `stock_balance` di atas `stock_movements` |
| `if (stage.code === 'fit_test')` | `if (stage.requiresQc)` |
| Satu enum status untuk semuanya | Enum terpisah: order, unit, job. Tiga siklus hidup berbeda. |
| Float untuk uang atau volume busa | Integer Rupiah; `numeric(10,4)` untuk m³ |
| Flag soft-delete di tabel ledger | Baris kompensasi |
| Hold permintaan customer dihitung telat | Jam terpisah, metrik terpisah (D-007) |
| Rework QC tidak terlihat | Setiap gagal Uji Berat Badan tercatat & terhitung |
| Override customer "lebih empuk" tidak dicatat | Wajib tersimpan + catatan edukasi (D-009) |
| Menganggap alamat sudah benar | Pin GPS saat kunjungan sukses pertama adalah kebenarannya |
| Enam routing template untuk enam layanan | Tulang punggung + modul (D-003) |
| Mencampur material lini SERVICE dan UPGRADE | Lini menentukan katalog material & garansi (D-004) |

---

## Fase sekarang

**Phase 0 — Fondasi.** Lihat `PHASE-0.md`. Status: menunggu persetujuan.

Jangan mulai pekerjaan Phase 1. Kalau sebuah tugas ternyata butuh fitur
Phase 1, katakan dan berhenti.

---

## Asumsi yang masih terbuka

Tandai kalau sebuah tugas bergantung pada salah satunya:

1. Pemetaan garansi SERVICE→Standard / UPGRADE→Premium (D-004) — belum
   dikonfirmasi
2. `expected_duration_minutes` tiap tahap — sengaja kosong, diisi dari data
   nyata setelah beberapa minggu, jangan ditebak
3. Nilai `OrderItem.layananName` di data historis — belum diaudit, belum tentu
   cocok dengan enam layanan resmi
4. ~~Skema login driver~~ — DITUTUP, lihat D-019: email+password biasa,
   akun dibuat admin, tidak ada OTP/Google.
5. Apakah job pickup boleh membawa unit dari lebih dari satu order. PRD §5.2
   melarang, tapi pesanan hotel 30 kasur (D-006) kemungkinan besar memaksanya
