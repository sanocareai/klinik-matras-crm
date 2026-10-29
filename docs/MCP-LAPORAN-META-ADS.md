# MCP — Laporan Meta Ads (campaign → ad set → ad)

Tiga tool BACA-SAJA di server MCP `klinik-matras-crm` (v1.1.0) yang membuka hasil atribusi CTWA yang **sudah live** (`/api/atribusi/iklan`) ke Claude. Tidak ada tracking kedua, tidak ada migrasi, tidak ada tabel baru.

## Arsitektur

```
Claude ──MCP──▶ toolsAtribusiIklan.js ──▶ services/attribution/laporanMeta.js ──▶ hitungLaporanIklan (iklanReport.js)
Halaman Laporan ──HTTP──▶ routes/attributionAds.js ───────────────────────────────▶ hitungLaporanIklan (iklanReport.js)
```

- Endpoint dan tool memanggil **fungsi yang sama** (`hitungLaporanIklan`, transaksi `READ ONLY` + `statement_timeout`). MCP tidak berisi SQL maupun rumus bisnis; `laporanMeta.js` hanya memilih kolom (daftar-putih), mengurutkan, dan menyusun per hari.
- Penjaga satu-perhitungan-sekaligus dipindah ke `penjagaLaporan.js` dan dipakai bersama: endpoint tetap menjawab 429 `SEDANG_DIHITUNG` saat sibuk; tool MCP antre hingga 15 detik.
- Auth MCP tidak berubah: token statis (Claude Code/Desktop) atau OAuth (hanya ADMIN bisa login+approve). Respons tidak memuat nama, nomor, email, percakapan, atau ID customer/order.
- Perubahan di service lama (aditif): metrik `customerPernahMembayar` (customer unik dengan ≥1 pembayaran ledger sah) di baris `/iklan`, `jumlahTeratribusi`, dan dua pemeriksaan rekonsiliasi baru. Tidak ada kunci yang dihapus/diubah.

## Tool

| Tool | Fungsi |
|---|---|
| `performa_campaign_meta` | Baris campaign / ad set / ad, diperingkat. Param: `dari`, `sampai`, `level`, `urutkan`, `batas`, `campaignId`, `adSetId`. |
| `rekap_harian_meta` | Rekap harian (kohort tanggal lead) + akumulasi periode dihitung ulang. Param: `dari`, `sampai`, `campaignId`. Maks 31 hari. |
| `kesehatan_atribusi_meta` | Capture, cakupan atribusi, kesehatan spend, cakupan ledger, kesiapan KPI; `periksaLintasLevel` membuktikan campaign = Σ ad set = Σ ad. |
| `performa_iklan` (lama) | Tetap ada dan kompatibel. **Bukan atribusi campaign**: mengelompokkan `ctwaSourceUrl`, menghitung "jadi order" dari `orderCount > 0`. Deskripsinya kini menyatakan batasan itu. |

`urutkan` (terbaik dulu): `customer_lunas_ledger` (bawaan, closing utama), `customer_pernah_membayar`, `customer_ber_order`, `lead_akuisisi`, `nilai_order`, `uang_ledger_bersih`, `spend`, `cpa_lunas` (terendah = terbaik), `booked_roas`, `cash_roas`. Seri → peringkat sama. KPI null → tanpa peringkat + alasan.

## Definisi (terkunci, sama dengan halaman Laporan)

- **Lead akuisisi terbukti**: customer baru saat touch `CTWA_AD` pertama (bukti kausal). Reaktivasi (customer lama) dan UNKNOWN dipisah.
- **Customer ber-order**: ≥1 order eligible (bukan CANCELLED/PENDING, bukan penjualan karyawan; spam/staf/B2B keluar).
- **Pernah membayar**: ≥1 pembayaran sah di ledger. **Lunas terbukti ledger** (closing utama): ledger − refund menutup seluruh tagihan. Ber-order ≠ lunas; "lunas CRM" metrik terpisah.
- **Booked ROAS** = nilai order (tanpa ongkir) ÷ spend. **Cash ROAS** = uang ledger bersih (memuat ongkir) ÷ spend — definisi lama dipertahankan; keduanya tidak sebanding langsung.
- **Nilai order setelah biaya iklan** = nilai order − spend. Bukan laba. null bila spend tidak ada/tidak lengkap/periode tidak sebanding.
- **UNMAPPED** (Ad ID belum dipetakan) selalu tampil terpisah dan tidak diperingkat. URL kreatif tidak pernah dipakai untuk atribusi campaign.
- Periode = tanggal **lead** (WIB). Hasil order/pembayaran dihitung sampai waktu snapshot (`snapshot.dihitungPadaWib`); kohort muda masih bertambah (`umurKohortHari`).
- Pengaman KPI (tak berubah): `SEBELUM_ATRIBUSI`, `HARI_ATRIBUSI_PARSIAL`, `HARI_BERJALAN_PARSIAL`, `SPEND_TIDAK_LENGKAP` → CPA/ROAS/nilai-setelah-biaya = null dengan `alasanNull`. Biaya manual per sumber tidak pernah menjadi biaya campaign. Nol yang sah (spend Rp0) ≠ tidak ada data.

## Batasan yang diketahui

- Tampilan **aktivitas kalender** (order/pembayaran yang terjadi pada tanggal tertentu, termasuk dari lead lama) **belum disediakan**: status order pada tanggal itu butuh riwayat transisi yang tidak lengkap untuk order lama (D7 menandainya "TIDAK DIKETAHUI"). Hanya kohort akuisisi yang terbukti.
- Atribusi hanya untuk lead sesudah touch tersimpan (awal Okt 2026); tidak ada backfill.
- `rekap_harian_meta` menjalankan satu perhitungan penuh per hari (28–290 ms di data live untuk 9 hari).

## Rilis & reconnect

1. Kode saja: tanpa migrasi, tanpa perubahan env. Build image backend dari commit kandidat, ganti kontainer `backend`.
2. Smoke: `tools/list` memuat 3 tool baru (readOnlyHint=true); panggil `kesehatan_atribusi_meta` (rekonsiliasi `ok`), `performa_campaign_meta` 7 hari bawaan.
3. **Connector claude.ai** menyimpan daftar tool per koneksi. Setelah rilis: Pengaturan → Konektor → SANSS CRM → putuskan lalu sambungkan ulang (atau mulai percakapan baru). `serverInfo.version` kini `1.1.0` untuk memastikan klien melihat versi baru.
4. **Jembatan ChatGPT Actions** (`/gpt-actions`) mengekspos semua tool server di belakang token yang sama: ambil ulang `/gpt-actions/openapi.json` dan tempel ke Custom GPT bila ingin operasi baru. Plugin `/mcp-chatgpt` memakai allowlist eksplisit, jadi tool baru **tidak** aktif di sana (fail-closed).
5. Rollback: kembalikan image sebelumnya; tidak ada perubahan data.

## Pengujian

- `tests/laporanMeta.test.js` (unit, 17): proyeksi, peringkat, pengaman KPI, rekap + batas WIB, rekonsiliasi lintas level, penjaga, discovery/schema/galat MCP.
- `tests/integration/mcpLaporanMeta.integration.test.js` (DB nyata terisolasi, 13): endpoint = service = tool di tiga level; multi-order, retry touch, reaktivasi, UNMAPPED, CANCELLED/PENDING, payment dibatalkan+pengganti, ledger parsial, spend parsial, batas WIB 23:59:59/00:00:00; RBAC; read-only (jumlah baris tidak berubah); tanpa PII; tool legacy; konkurensi dengan endpoint.
