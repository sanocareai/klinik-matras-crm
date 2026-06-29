# Klinik Matras — Omnichannel Inbox & CRM

Sudah termasuk: integrasi WhatsApp via WAHA, inbox, database pelanggan, **Customer 360
(order tracking per pelanggan)**, dan **Dashboard analitik** (traffic bulanan + sumber lead).
Instagram, broadcast, dan AI auto-reply menyusul di phase berikutnya.

Setelah login, ada 3 menu di sidebar: **Dashboard**, **Inbox**, **Pelanggan**.

## 1. Persiapan

- Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Install [Node.js](https://nodejs.org/) versi 20+
- Buka folder ini di VS Code

## 2. Jalankan database & WAHA

```bash
docker compose up -d postgres waha
```

Cek WAHA sudah hidup: buka http://localhost:3000 di browser (akan muncul Swagger UI / Dashboard).

## 3. Setup backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run seed     # buat user admin & sales awal (edit dulu seed.js sesuai tim Anda)
npm run dev
```

Backend jalan di http://localhost:4000

## 4. Hubungkan nomor WhatsApp ke WAHA

1. Buka dashboard WAHA (http://localhost:3000)
2. Buat session baru (gunakan **nomor baru untuk testing**, sesuai rencana kita)
3. Scan QR code dengan WhatsApp di HP (Linked Devices → Link a Device)
4. Set webhook URL ke: `http://localhost:4000/api/webhooks/waha` (untuk testing lokal, perlu tool seperti [ngrok](https://ngrok.com/) supaya WAHA bisa kirim webhook ke komputer Anda — atau langsung deploy ke VPS Sumopod untuk testing real)

## 5. Jalankan frontend

```bash
cd frontend
npm install
npm run dev
```

Buka http://localhost:5173, login pakai email/password dari `seed.js`.

## 6. Testing

- Kirim WhatsApp ke nomor testing dari HP lain → pesan harus muncul di inbox dalam ~5 detik
- Balas dari dashboard → harus terkirim ke WhatsApp peserta
- Buka percakapan → di panel kanan, isi Kota dan tambah Order (nilai + qty) → cek muncul di halaman Pelanggan & Dashboard

## Deploy ke Sumopod (production)

1. Deploy WAHA lewat marketplace template Sumopod (atau Docker manual), catat URL-nya
2. Deploy Postgres (Sumopod marketplace atau container sendiri)
3. Build frontend: `cd frontend && npm run build` (hasil di `frontend/dist`, otomatis disajikan oleh backend)
4. Deploy backend (folder `backend/`) sebagai container di Sumopod, set environment variables sesuai `.env.example` tapi arahkan `WAHA_BASE_URL` ke URL WAHA production
5. Set webhook WAHA ke `https://domain-anda.com/api/webhooks/waha`
6. Pakai domain dengan HTTPS (penting — WAHA & browser butuh koneksi aman)

## Catatan keamanan WAHA

- Pakai SIM card fisik asli untuk nomor testing, bukan nomor virtual/VoIP
- Pakai nomor itu untuk chat normal beberapa hari dulu sebelum disambungkan ke WAHA
- Backup folder session WAHA secara berkala (`waha_sessions` volume) — kalau hilang, harus scan QR ulang
