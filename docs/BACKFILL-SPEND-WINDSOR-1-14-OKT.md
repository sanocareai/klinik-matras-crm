# Backfill spend Windsor Meta — 1–14 Oktober 2026 (level Ad, rincian harian)

**Status: SIAP, BELUM DIJALANKAN.** Tidak ada data 1–14 Oktober di sistem (hanya 15 Oktober: 10 baris, Rp1.151.588). Tidak ada angka yang dikarang atau diambil dari tangkapan layar. Perkakas ini hanya mengimpor data yang diberikan Mesa dari konektor Windsor, setelah control total cocok.

## Perlakuan di laporan
Seluruh 1–14 Okt berada sebelum atribusi touch (16 Okt 17:25:43 WIB), sehingga setiap hari tampil `SEBELUM_ATRIBUSI`, evaluasi `TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI`, CPL/CPA/ROAS CRM `null`. Yang tetap tampil: spend, impressions, link clicks, percakapan platform (messaging conversations started), dan **biaya per percakapan platform** (metrik platform, bukan CPL). Reach level Ad tidak pernah dijumlah dan tidak ditampilkan.

## Yang disiapkan Mesa
1. **CSV** (`docs/templates/windsor-spend-ad-harian.template.csv`, header saja): satu baris per (tanggal × Ad), 1–14 Okt, akun `2081614415911241`, IDR, Asia/Jakarta, kolom persis seperti template. Nilai apa adanya dari Windsor; hanya header percakapan yang dinamai "Messaging conversations started". Ad ID/Ad Set ID/Campaign ID sebagai teks digit (jangan dibuka lalu disimpan ulang di spreadsheet → notasi ilmiah ditolak). Spend Rp0 boleh.
2. **Control total** (`docs/templates/windsor-kontrol-total-1-14okt.template.json`): per HARI (level akun) dan per CAMPAIGN per hari — spend, impressions, link_clicks, conversations — dari sumber, bukan dihitung dari CSV. Hari tanpa data: isi 0. Template berisi `null` sehingga tidak pernah lolos gerbang sebelum diisi.

### Checklist control total (diisi Mesa)
| Tanggal | Spend akun | Impressions | Link clicks | Percakapan | Campaign terisi? |
|---|---|---|---|---|---|
| 2026-10-01 … 2026-10-14 | ☐ | ☐ | ☐ | ☐ | ☐ (semua campaign yang berbelanja/berpercakapan) |
Tambahan: ☐ zona akun Asia/Jakarta ☐ mata uang IDR ☐ ditarik pada (WIB) ____ ☐ reach TIDAK diisi/dijumlah.

## Perintah (dari laptop; data tidak pernah disimpan di server — lewat stdin)
```
bash scripts/backfill-spend-windsor.sh cek    data.csv kontrol.json   # lokal: validasi ketat + cocokkan control total
bash scripts/backfill-spend-windsor.sh dry    data.csv kontrol.json   # dry-run lewat jalur aplikasi (tidak menulis)
KOMIT=YA bash scripts/backfill-spend-windsor.sh commit data.csv kontrol.json
bash scripts/backfill-spend-windsor.sh verify data.csv kontrol.json   # DB vs CSV vs control total + status SEBELUM_ATRIBUSI per hari
```
**Gerbang commit (semua wajib):** `KOMIT=YA`; CSV valid; control total lengkap 14 hari dan COCOK persis (akun/hari dan campaign/hari); dry-run aplikasi bersih (0 ditolak, 0 konflik, 0 SPEND_UNMAPPED, total sumber = Σ control). Bila salah satu gagal: tidak ada yang ditulis.

## Aturan importer (sudah teruji)
Idempoten (impor ulang = unchanged; koreksi nilai → revisi tersimpan); source `WINDSOR_API`; IDR saja; commit wajib zona Asia/Jakarta; ID string; spend Rp0 diterima; notasi ilmiah, spend negatif, format ribuan/koma ditolak; Ad ID tanpa referensi → `SPEND_UNMAPPED` (dilaporkan, commit ditahan oleh perkakas sampai referensinya diimpor); hierarki berbeda dari referensi/spend tersimpan → konflik.

## Verifikasi setelah commit (`verify`)
Per baris (hari×Ad) DB = CSV; per hari Σ Ad = Σ Ad Set = Σ Campaign = akun = control (selisih Rp0); semua sumber `WINDSOR_API`, IDR, Asia/Jakarta; 14 hari berstatus `SEBELUM_ATRIBUSI` dengan evaluasi `TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI`, CPL/CPA/ROAS null, tanpa reach.
