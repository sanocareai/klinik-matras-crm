# Konteks Project — Klinik Matras Omnichannel + CRM

> File ini dibaca otomatis oleh Claude Code setiap mulai session di folder ini.
> Isinya ringkasan semua keputusan yang sudah dibuat bareng Gilang (CCO Klinik Matras) di chat
> perencanaan sebelumnya, supaya tidak perlu dijelaskan ulang dari nol.

## Tentang bisnis

Klinik Matras — bisnis kasur. Volume chat: 50-100 pesan/hari dari WhatsApp + Instagram DM.
Tim: 1 admin (Gilang) + 2 admin lain + 5 sales = 7 user. Gilang yang maintain sistem ini sendirian
(moderate coding skill), jadi **prioritaskan kode yang simpel & mudah dipahami** di atas
"clever"/over-engineered. Semua UI & komentar kode pakai Bahasa Indonesia.

## Kenapa dibangun sendiri (bukan subscribe SaaS)

Awalnya mau pakai WooBlazz CRM (~Rp1jt/bulan untuk 7 user). Custom build jauh lebih hemat (hosting
~Rp100-250rb/bulan) dan data pelanggan privat di server sendiri.

## Tech stack (sudah final, jangan ganti tanpa diskusi)

- **Backend:** Node.js + Express (plain JavaScript, bukan TypeScript — biar simpel)
- **Database:** PostgreSQL via Prisma ORM
- **Frontend:** React + Vite (plain JS, bukan TS), react-router-dom, recharts untuk chart
- **WhatsApp:** WAHA (self-hosted, unofficial/whatsapp-web protocol) — bukan WhatsApp Cloud API
  resmi, karena lebih murah untuk skala kecil ini. Engine: WEBJS (paling stabil).
- **Hosting:** Sumopod (VPS Indonesia, harga terjangkau, ada marketplace template WAHA Plus)
- **Auth:** JWT sederhana, belum ada role-based permission granular (semua user lihat semua data)

## ⚠️ Hal penting soal WAHA (jangan dilupakan)

WAHA melanggar ToS WhatsApp secara teknis (emulasi WhatsApp Web, bukan API resmi). Risiko ban
nyata kalau: kirim pesan massal ke yang belum pernah chat, pola broadcast, atau nomor baru yang
tiba-tiba kirim banyak pesan. Mitigasi yang sudah disepakati:
- Pakai **nomor baru untuk testing** (SIM fisik asli, bukan VoIP), bukan nomor utama klinik
- "Warm up" nomor (chat normal beberapa hari) sebelum disambungkan ke WAHA
- Nomor utama baru dimigrasi setelah sistem terbukti stabil di nomor testing
- Kalau nanti bangun fitur broadcast (Phase 4), WAJIB ada rate-limit & anti-ban check (lihat
  referensi desain di bawah)

## Roadmap & status

| Phase | Fitur | Status |
|---|---|---|
| 1 | Inbox WhatsApp (WAHA) + customer DB dasar | ✅ Sudah di-scaffold |
| 2 | Integrasi Instagram (Graph API resmi) | ⏳ Belum — **blocked**: Gilang perlu setup Meta Developer App + Business verification dulu |
| 3 | Customer 360 (order: status/nilai/kota/tags) + Dashboard analitik | ✅ Sudah di-scaffold |
| 4 | Broadcast & campaign promo + anti-ban rate limit | ⏳ Belum |
| 5 | AI auto-reply (follow-up, handover, closing — bukan cuma FAQ) | ⏳ Belum, paling kompleks, dikerjakan terakhir setelah data order/tags rapi |

## Referensi desain (boleh ditiru / diimprove, jangan asal copy)

- **WooBlazz CRM**: KPI card warna-warni gradient, pipeline dengan nilai deal Rupiah, progress bar
  target bulanan, pie chart breakdown produk
- **Wulan AI** (demo furniture business): sidebar nav bersih, koneksi hybrid Meta Cloud API +
  Baileys, broadcast tool dengan target audience filter + rate-limit anti-ban (120 msg/menit
  ceiling, delay random 3-15 detik, cek rasio outbound:inbound 7 hari terakhir), Handover queue,
  AI Playground + Knowledge Base untuk auto-reply
- Inspirasi AI agent (Phase 5): konsep "OpenClaw + Hermes Agent" dari komunitas growthcircle.id —
  AI yang handle follow-up, handover ke sales, dan bantu closing (bukan sekadar jawab FAQ statis)

## Skema database (Prisma) — ringkasan

`User` (admin/sales) · `Customer` (phone, instagramHandle, city, tags[], pipelineStage,
leadSource, assignedSales) · `Conversation` (channel, status) · `Message` (direction, externalId
untuk dedupe webhook) · `Note` · `Order` (status, value Rupiah, quantity)

## Perintah yang sering dipakai

```bash
docker compose up -d postgres waha   # nyalakan database & WAHA
cd backend && npm run dev             # jalankan backend (port 4000)
cd frontend && npm run dev            # jalankan frontend (port 5173)
npx prisma migrate dev                # setiap ubah schema.prisma
npx prisma studio                     # buka GUI database untuk cek data
```

Panduan setup super detail (untuk pemula) ada di `PANDUAN-LENGKAP-PEMULA.md`.

## Gaya kerja yang diharapkan

- Jelaskan dulu rencana sebelum ubah banyak file (pakai Plan Mode untuk task besar)
- Kalau ragu soal keputusan arsitektur baru (bukan sekadar bugfix), tanya dulu — jangan asumsi sendiri
- Update tabel roadmap di atas setelah menyelesaikan sebuah phase
