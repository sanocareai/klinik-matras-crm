# Panduan Lengkap Setup — Klinik Matras Omnichannel + CRM

Panduan ini ditulis untuk yang **belum pernah sama sekali** pakai terminal, Docker, atau coding.
Ikuti dari atas ke bawah, satu per satu, jangan ada yang dilompat. Kalau ada langkah yang error,
cek bagian **Troubleshooting** di paling bawah — hampir semua masalah umum ada di situ.

---

## Bagian 0 — Istilah-istilah yang Akan Sering Muncul

Baca dulu sekilas, supaya nanti pas baca instruksi tidak bingung.

| Istilah | Maksudnya |
|---|---|
| **Terminal** | Aplikasi buat ngetik perintah teks ke komputer (bukan klik-klik mouse). Di Mac namanya "Terminal", di Windows kita pakai yang bawaan VS Code. |
| **Command / perintah** | Baris teks yang diketik di terminal lalu ditekan Enter. |
| **Docker** | Aplikasi yang menjalankan program "dalam kotak terisolasi" (disebut *container*) supaya tidak perlu install macam-macam langsung di komputer. |
| **Docker Compose** | Cara menjalankan beberapa Docker container sekaligus dengan satu perintah. |
| **Node.js** | Program yang dibutuhkan supaya komputer bisa menjalankan kode JavaScript (bahasa yang dipakai project ini). |
| **npm** | "Toko aplikasi" untuk kode JavaScript — `npm install` artinya download semua kode pendukung yang dibutuhkan project. |
| **Database** | Tempat menyimpan data (pelanggan, pesan, order) secara permanen. Kita pakai PostgreSQL. |
| **API** | Cara dua program saling "ngomong" lewat internet/jaringan. |
| **Webhook** | Cara WAHA "lapor" ke program kita setiap kali ada pesan WhatsApp masuk. |
| **WAHA** | Program yang menyambungkan WhatsApp ke sistem kita. |
| **Repository / folder project** | Folder besar berisi semua file kode yang sudah saya buatkan. |

---

## Bagian 1 — Install Software yang Dibutuhkan

Lakukan ini sekali saja di komputer Anda (laptop kerja, bukan VPS).

### 1.1 Docker Desktop

1. Buka https://www.docker.com/products/docker-desktop/
2. Download versi sesuai komputer Anda (Windows / Mac)
3. Install seperti install aplikasi biasa (next-next-finish)
4. Buka aplikasi Docker Desktop-nya, tunggu sampai ada tulisan **"Engine running"** atau ikon paus di pojok jadi hijau/stabil (bukan loading)

**Cara cek berhasil:** buka Terminal, ketik:
```bash
docker --version
```
Kalau muncul tulisan seperti `Docker version 27.x.x`, berarti sudah berhasil.

### 1.2 Node.js

1. Buka https://nodejs.org/
2. Download versi **LTS** (yang direkomendasikan, bukan "Current")
3. Install seperti biasa

**Cara cek berhasil:**
```bash
node --version
```
Harus muncul versi 20 atau lebih baru, contoh `v20.15.0`.

### 1.3 VS Code (tempat buka & edit kode)

1. Download di https://code.visualstudio.com/
2. Install seperti biasa

VS Code punya terminal built-in, jadi Anda tidak perlu buka aplikasi Terminal terpisah — nanti saya tunjukkan caranya.

### 1.4 ngrok (khusus untuk testing WhatsApp di komputer lokal)

WAHA perlu "lapor" ke program kita lewat internet, tapi komputer Anda biasanya tidak punya alamat
internet publik. ngrok membuat alamat sementara supaya WAHA bisa menjangkau komputer Anda saat testing.

1. Buka https://ngrok.com/, klik **Sign up** (gratis)
2. Setelah login, ikuti instruksi di dashboard mereka untuk install ngrok di komputer Anda
   (biasanya tinggal download lalu jalankan 1 command untuk masukkan token akun Anda)

---

## Bagian 2 — Siapkan Folder Project

1. Cari file `klinik-matras-phase1.zip` yang saya berikan, lalu **extract** (klik kanan → Extract All / Extract Here)
2. Hasilnya akan ada folder bernama `klinik-matras`
3. Buka VS Code → File → Open Folder → pilih folder `klinik-matras` tadi
4. Buka terminal built-in di VS Code: menu **Terminal → New Terminal** (atau tombol `` Ctrl + ` ``)

Struktur foldernya seperti ini:
```
klinik-matras/
├── backend/        <- server (otak sistem)
├── frontend/       <- tampilan website yang Anda lihat di browser
├── docker-compose.yml
└── README.md
```

Semua perintah di bawah ini dijalankan **di terminal VS Code**, dari folder `klinik-matras`
(kecuali disebutkan harus pindah folder dengan `cd backend` atau `cd frontend`).

---

## Bagian 3 — Jalankan Database & WAHA

Di terminal, dari folder `klinik-matras`, ketik:

```bash
docker compose up -d postgres waha
```

Penjelasan: ini menyalakan 2 "kotak" sekaligus — database PostgreSQL dan WAHA. Tanda `-d` artinya
jalan di belakang layar (tidak memenuhi layar terminal Anda).

**Cara cek berhasil:**
```bash
docker ps
```
Harus muncul 2 baris: satu nama mengandung `postgres`, satu lagi `waha`, dengan status `Up`.

Lalu buka browser, kunjungi: **http://localhost:3000**
Kalau muncul halaman dashboard/Swagger WAHA, berarti WAHA sudah jalan dengan benar.

---

## Bagian 4 — Setup Backend (Server)

### 4.1 Pindah ke folder backend

```bash
cd backend
```

### 4.2 Buat file konfigurasi

```bash
cp .env.example .env
```
Ini menyalin file contoh jadi file `.env` (file rahasia berisi konfigurasi). Anda tidak perlu ubah
apa-apa di file ini untuk testing lokal — defaultnya sudah cocok dengan `docker-compose.yml`.

### 4.3 Download semua kode pendukung

```bash
npm install
```
Tunggu sampai selesai (muncul banyak teks lalu berhenti tanpa error merah). Ini bisa 1-3 menit.

### 4.4 Siapkan struktur tabel di database

```bash
npx prisma migrate dev --name init
```
Ini membuatkan semua tabel (pelanggan, pesan, order, dst) di database Postgres yang baru kita
nyalakan tadi. Kalau ditanya nama migrasi, biarkan default atau ketik `init`.

### 4.5 Buat akun login pertama

Sebelum ini, **buka file `backend/seed.js` di VS Code**, lalu edit nama & email & password sesuai
tim Anda (2 admin + 5 sales). Setelah disimpan, jalankan:

```bash
npm run seed
```
Ini akan membuat akun-akun tersebut di database supaya Anda bisa login nanti.

### 4.6 Jalankan server

```bash
npm run dev
```
Kalau berhasil, akan muncul tulisan `Backend jalan di http://localhost:4000` dan terminal akan
"menggantung" (tidak kembali ke prompt) — itu normal, artinya server sedang aktif berjalan.
**Jangan ditutup terminalnya** selama testing.

**Cara cek berhasil:** buka tab browser baru, kunjungi http://localhost:4000/api/health
Harus muncul teks `{"ok":true}`.

---

## Bagian 5 — Hubungkan Nomor WhatsApp ke WAHA

Ingat: pakai **nomor baru untuk testing**, dengan SIM card fisik asli (bukan nomor virtual/VoIP),
sesuai yang kita sepakati sebelumnya.

### 5.1 Nyalakan ngrok

Buka **terminal baru** (jangan tutup terminal backend yang masih jalan!) — di VS Code klik tombol
`+` di panel terminal untuk buka tab terminal baru. Lalu ketik:

```bash
ngrok http 4000
```

Akan muncul tampilan dengan baris seperti ini:
```
Forwarding   https://abcd-12-34-56.ngrok-free.app -> http://localhost:4000
```

**Salin (copy) URL `https://abcd-12-34-56.ngrok-free.app` itu** — setiap orang akan dapat URL
berbeda, dan URL ini akan **berubah setiap kali ngrok di-restart** (untuk versi gratis).

### 5.2 Buat session WhatsApp di WAHA

1. Buka http://localhost:3000 di browser
2. Cari tombol untuk membuat session baru (biasanya "Start New Session" atau lewat Swagger
   `POST /api/sessions`)
3. Beri nama session: `default`
4. Akan muncul **QR code**
5. Di HP dengan nomor testing: buka WhatsApp → Menu (titik tiga di Android / Setelan di iPhone) →
   **Perangkat Tertaut** → **Tautkan Perangkat** → arahkan kamera ke QR code di layar komputer
6. Tunggu beberapa detik sampai status session berubah jadi **WORKING**

### 5.3 Hubungkan webhook

Saat membuat/mengatur session, ada kolom **Webhook URL**. Isi dengan:

```
https://abcd-12-34-56.ngrok-free.app/api/webhooks/waha
```

(ganti bagian `abcd-12-34-56.ngrok-free.app` dengan URL ngrok Anda sendiri dari langkah 5.1,
dan jangan lupa tambahkan `/api/webhooks/waha` di belakangnya)

> ⚠️ Setiap kali Anda restart ngrok, URL-nya berubah dan Anda harus update webhook URL ini lagi
> di setting session WAHA. Ini hanya untuk testing lokal — kalau sudah deploy ke server (Sumopod),
> URL-nya tetap dan tidak perlu diubah-ubah lagi.

---

## Bagian 6 — Jalankan Frontend (Tampilan Website)

Buka **terminal baru lagi** (tab ke-3 — biarkan backend & ngrok tetap jalan), lalu:

```bash
cd frontend
npm install
npm run dev
```

Akan muncul tulisan seperti:
```
Local:   http://localhost:5173/
```

Buka URL itu di browser. Anda akan melihat halaman login Klinik Matras.

**Login** menggunakan email & password yang Anda atur di `backend/seed.js` tadi (Bagian 4.5).

---

## Bagian 7 — Coba Semua Fitur

Sekarang Anda harusnya punya **3 terminal aktif** (backend, ngrok, frontend) — jangan ditutup
selama testing.

1. **Dashboard** — akan kosong/nol dulu karena belum ada data, itu normal
2. **Inbox** — kirim WhatsApp dari HP lain ke nomor testing Anda → tunggu maksimal 5 detik →
   pesan harus muncul otomatis di kolom tengah. Coba balas dari kotak chat di dashboard → cek di
   HP, balasan harus sampai
3. Klik percakapan yang masuk → di panel kanan, isi **Kota**, lalu tambahkan **Order** (isi nilai
   dalam Rupiah, misal `1500000`, dan jumlah barang) → klik **+ Order**
4. Buka menu **Pelanggan** → pelanggan yang baru chat tadi harus muncul di tabel, lengkap dengan
   kota & order yang baru diisi
5. Buka menu **Dashboard** lagi → refresh browser → angka-angka KPI dan chart harus mulai terisi

Kalau semua langkah di atas berhasil, sistemnya sudah jalan dengan benar. 🎉

---

## Bagian 8 — Troubleshooting (Masalah Umum)

**"docker: command not found"**
Docker Desktop belum jalan atau belum terinstall. Buka aplikasi Docker Desktop-nya dulu, tunggu
sampai statusnya aktif, baru coba lagi.

**`docker compose up` error "port already in use" / "address already in use"**
Ada program lain yang sudah memakai port 5432 (Postgres) atau 3000 (WAHA) di komputer Anda.
Matikan program itu, atau ganti nomor port di `docker-compose.yml` (misal `5433:5432`).

**`npx prisma migrate dev` error "Can't reach database server"**
Database belum jalan. Cek dengan `docker ps` — pastikan container `postgres` statusnya `Up`.
Kalau belum, ulangi Bagian 3.

**QR code WAHA tidak muncul / loading terus**
Coba refresh halaman http://localhost:3000, atau buat ulang session-nya (hapus session lama,
buat baru).

**Pesan WhatsApp masuk tapi tidak muncul di Inbox**
Hampir selalu karena URL webhook salah atau ngrok sudah berubah URL. Cek lagi Bagian 5.1 dan 5.3 —
pastikan URL ngrok yang aktif sekarang sama dengan yang diisi di setting webhook WAHA.

**Login gagal "Email atau password salah"**
Cek lagi isi `backend/seed.js`, pastikan Anda sudah benar-benar menjalankan `npm run seed` setelah
mengubahnya (Bagian 4.5).

**Halaman frontend blank putih / error di browser**
Buka DevTools browser (klik kanan → Inspect → tab Console), screenshot error-nya — biasanya
ketahuan dari situ apakah backend belum jalan atau ada typo.

**Terminal "menggantung" tidak bisa ngetik apa-apa lagi**
Itu normal untuk proses yang sedang berjalan (backend, frontend, ngrok). Untuk mematikannya,
tekan `Ctrl + C` di terminal itu.

---

## Bagian 9 — Langkah Selanjutnya

Setelah semua di atas lancar di laptop Anda, langkah berikutnya adalah **deploy ke Sumopod**
supaya bisa diakses tim Anda 24 jam tanpa laptop Anda harus nyala terus. Garis besarnya sudah ada
di `README.md`, dan kalau Anda sudah siap ke tahap itu, bilang saja — saya bisa buatkan panduan
deploy yang sama detailnya seperti ini.
