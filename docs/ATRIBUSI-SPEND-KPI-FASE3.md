# Atribusi Meta Ads — Fase 3: spend harian, KPI biaya, target, monitoring

Kandidat `feat/atribusi-fase3-spend`. Tidak mengubah campaign, ad set, ads, placement, atau budget Meta; sistem **tidak pernah menulis ke Meta** (adapter hanya `GET`).

## Sumber spend (audit 16 Okt 2026)
- Backend produksi **tidak memiliki** kredensial Meta Marketing API maupun Windsor (nama env yang ada: Google Maps, LocationIQ, MCP, VAPID, WAHA, JWT — tidak satu pun terkait Ads). Tidak ada token website/dataset/CAPI yang dipakai sebagai pengganti.
- Prioritas sumber: (1) **Meta Marketing API** dengan izin `ads_read` terbukti; (2) **Windsor API** resmi; (3) **impor CSV Ads Manager** (jalur yang aktif sekarang).
- Semua sumber memakai kontrak data dan tabel yang sama (`meta_ad_daily_spend`, kolom `source`). Adapter API (`spendSyncMeta.js`, `scripts/sync-spend-meta.js`) **nonaktif** sampai `SPEND_SYNC_ENABLED=true` + `META_ADS_ACCESS_TOKEN` + `META_ADS_ACCOUNT_ID` tersedia lewat secret resmi dan `ads_read` terbukti (`GET /me/permissions`), akun berzona WIB dan IDR. Rolling 7 hari, retry terbatas, tanpa paralel (kunci advisory per akun), data kosong tidak menghapus histori.

## Skema (migrasi aditif `20261201090000_atribusi_spend_kpi`, 5 tabel kosong)
`meta_spend_imports` (audit impor, tanpa isi berkas), `meta_ad_daily_spend` (unik `tanggal WIB + akun + Ad ID + sumber`; IDR saja; spend ≥ 0; ID string digit), `meta_ad_spend_revisions` (nilai lama setiap koreksi snapshot), `attribution_kpi_targets` (satu baris; semua null), `attribution_alert_state` (cooldown/pulih alarm). Tidak ada kolom token/respons mentah/data pelanggan.

## Aturan data
- Tanggal Meta mengikuti **zona waktu akun iklan**; spend harian tidak dapat dikonversi antar-zona. Commit wajib `zonaWaktuAkun` ∈ {Asia/Jakarta, Asia/Pontianak}; zona lain ditolak 422.
- Tolak: notasi ilmiah (ID/spend), format ribuan/koma, spend negatif, mata uang selain IDR (kolom baris, judul kolom `Amount spent (USD)`, atau parameter), ID bertingkat sama, duplikat bertentangan. Baris buruk ditolak per baris; baris sah tetap diproses.
- Impor ulang hari yang sama: identik → tidak berubah; angka berubah → snapshot diperbarui + revisi tersimpan; **nama campaign berubah tidak menggandakan** (nama = label, ID = kunci). Ad ID tanpa referensi → `SPEND_UNMAPPED`. Hierarki berbeda dari referensi atau spend tersimpan → konflik (tidak ditulis).
- `totalSumber` (opsional) harus cocok persis dengan total impor; bila diberikan dan beda → 409, tidak ada yang ditulis. Dua impor paralel pada akun yang sama: yang kedua 409/identik, tanpa baris ganda.
- Laporan memilih **satu sumber per (tanggal, akun, Ad ID)** menurut prioritas API > Windsor > CSV sehingga spend tidak pernah dijumlah dobel.

## KPI (definisi terkunci)
| Metrik | Rumus |
|---|---|
| Platform conversation | hasil percakapan versi Meta; **bukan** lead CRM |
| Acquisition lead | customer dengan causal first touch NEW (WEBHOOK_MEMBUAT / CLID_COCOK) |
| Qualified lead | acquisition lead yang pernah ditandai PROSPECT (riwayat transisi) |
| CPL | spend ÷ acquisition lead |
| Cost per qualified lead | spend ÷ qualified lead |
| Cost per customer ber-order | spend ÷ customer unik dengan order eligible (bukan jumlah order) |
| CPA utama | spend ÷ `customerLunasTerbuktiLedger` |
| Booked ROAS / Cash ROAS | booked value ÷ spend / uang ledger bersih ÷ spend |
Penyebut 0 → `null` + alasan `BELUM_ADA_KONVERSI` (bukan 0/∞). Spend 0 → ROAS `null` (`SPEND_NOL`). Customer lama (EXISTING) = reaktivasi; tidak menambah acquisition lead dan revenue repeat tidak dikreditkan ke campaign akuisisi. Filter utama = tanggal lead; maturity 7/30/60 hari.

Status baris: `BELUM_TERHUBUNG`, `DATA_BELUM_MATANG`, `BELUM_ADA_KONVERSI`, `MAPPING_BELUM_ADA`, `DATA_TERLAMBAT`, `TANPA_SPEND_DI_RENTANG`, `SIAP_DIEVALUASI`. Tanpa target ADMIN tidak ada evaluasi/warna.

## Target & evaluasi (ADMIN)
`GET/PUT /api/atribusi/iklan/target` — maks CPL, maks cost per qualified lead, maks cost per customer ber-order, maks CPA closing, min booked/cash ROAS, min lead, min closing, min umur kohort, maks share spam. Default semua `null` (tidak ada target CPA yang di-hardcode). Evaluasi: `DATA_KURANG` / `PANTAU` / `BAIK` / `PERLU_REVIEW`. **Hanya label** — tidak ada aksi otomatis pada iklan atau budget.

## Endpoint baru (ADMIN)
`GET /spend` (ringkasan harian + riwayat impor), `POST /spend` (dry-run default), `GET|PUT /target`, `GET /monitor`. Laporan `GET /api/atribusi/iklan` kini memuat `biaya` per baris dan total, tetap transaksi READ ONLY.

## Monitoring
`GET /monitor` + `scripts/atribusi-monitor.js` (cron: `scripts/atribusi-monitor-cron.sh`; exit 0 sehat / 1 peringatan / 2 kritis). Kondisi: WAHA per sesi, inbound sepi (dibanding basis jam yang sama 14 hari, jam sepi tidak alarm), touch gagal / gagal-pulih / tertunda > 10 menit, Ad ID UNMAPPED, touch ganda, CTWA_AD valid di capture Fase 0 tanpa touch, UNKNOWN > 10% (≥ 30 touch), coverage pemetaan < 95% (≥ 30 touch), spend terlambat. Cooldown 60 menit, notifikasi PULIH, keadaan di `attribution_alert_state`, log agregat `/app/data/atribusi-monitor.log`. WA hanya bila `ATRIBUSI_ALERT_NOTIFY_PHONE` diisi eksplisit (bawaan: log saja; tidak ada nomor ditebak).

## Rilis
`scripts/release-atribusi-spend.sh` (bergerbang: backup + restore rehearsal, pin sha256, pemindai DDL 35 mutan, build web, migrasi aditif, switch tunggal, verifikasi). Sinkronisasi spend OFF; `.env` tidak diubah. Rollback = kode saja (`--rollback`), semua tabel tetap.
