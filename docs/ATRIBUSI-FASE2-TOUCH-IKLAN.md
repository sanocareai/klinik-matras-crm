# Atribusi CTWA Fase 2 — Touch iklan (Ad ID) dan laporan lead/closing per ad, ad set, campaign

Status: **kode + migrasi aditif, BELUM deploy/push/merge.** Dibangun dari baseline live `187795f1`.
Capture touch **default MATI** (`ATRIBUSI_TOUCH_CAPTURE_ENABLED` harus persis `"true"`).

## 1. Apa yang berubah

| Area | Berkas | Sifat |
|---|---|---|
| Migrasi | `backend/prisma/migrations/20261107090000_atribusi_touch_iklan/migration.sql` | 3 tabel BARU, tanpa mengubah tabel lama |
| Skema | `backend/prisma/schema.prisma` | +3 model, +3 relasi balik (hanya tambahan) |
| Capture | `backend/src/services/attribution/touchCapture.js` | baru; dipanggil dari `webhooks.js` (satu blok, tidak di-await, tidak pernah melempar) |
| Referensi | `backend/src/services/attribution/adReferensi.js` | impor tervalidasi (CSV Ads Manager / JSON), dry-run default |
| Laporan | `backend/src/services/attribution/iklanReport.js` | transaksi `READ ONLY`, rekonsiliasi bawaan |
| Rute | `backend/src/routes/attributionAds.js` → `/api/atribusi/iklan` | ADMIN saja |
| Loader | `backend/src/services/attribution/cohortLoader.js` | + opsi `customerIds` (aditif; jalur lama tak berubah) |
| Dashboard lama | — | **tidak diubah** |

Tabel baru:

- `attribution_touches` — append-only. `customer_id`, `message_id` (opsional), `ad_id` (teks, `^[0-9]{5,32}$`), snapshot `ad_set_id`/`campaign_id`
  (null bila belum terpetakan), `mapping_status_at_touch` (`MAPPED|UNMAPPED`), `touch_at` (UTC) + `touch_date_wib` (tanggal WIB; CHECK = `touch_at + 7 jam`),
  `evidence_source` (`CTWA_AD|AD_REPLY_UNMARKED`), `source_type='ad'`, `entry_point_source/app`, `ctwa_clid_hash` (16 hex HMAC), `customer_new_at_touch`,
  `dedupe_key` UNIQUE, `capture_version`. **Tidak ada** kolom nomor, nama, isi chat, clid mentah, atau payload.
- `meta_ad_references` — kunci `ad_id` → `ad_set_id` → `campaign_id` (ID = kunci; nama = label snapshot), `source` (`ADS_MANAGER_EXPORT|MARKETING_API|MANUAL`), `synced_at`.
- `meta_ad_reference_imports` — jejak setiap impor (sha256 berkas, jumlah baris, siapa).

## 2. Alur

1. Webhook WAHA (`message` / `message.any`) → pesan inbound disimpan seperti biasa (customer + Message ada).
2. `rekamTouch` membaca `contextInfo.externalAdReply.sourceID` + `sourceType=ad` + penanda iklan (`conversionSource` / `entryPointConversionSource`).
   Ad ID **hanya** dari `sourceID`; tidak pernah dari URL postingan. `sourceID` harus numerik 5–32 digit.
3. Menulis satu baris `attribution_touches` dengan kunci dedupe `msg:` + sha256(id pesan inti) — event ganda (`message` + `message.any`), retry WAHA,
   dan prefix `true_/false_` menghasilkan kunci yang sama → satu touch.
4. Pencarian `meta_ad_references`: ada → snapshot ad set/campaign; tidak ada → `UNMAPPED` dengan nol ID turunan.
5. Kegagalan di langkah 2–4 hanya menaikkan penghitung internal dan mencetak **kode** (tanpa pesan galat); inbox tidak terpengaruh.

Laporan memakai referensi **terkini** (bukan snapshot) sehingga Ad ID yang dipetakan belakangan otomatis berpindah dari `UNMAPPED` ke campaign-nya.

## 3. Aturan atribusi

- **Akuisisi** = touch CTWA valid *pertama* pada customer yang *baru saat touch itu* (`customer_new_at_touch=true`, urut `touch_at, id`). Satu customer = tepat satu grup.
- Touch berikutnya dan touch pada customer lama dilaporkan terpisah (`sentuhanBerikutnya`), **tidak** mengubah customer lama menjadi lead baru.
- Customer yang sudah ada sebelum capture aktif tidak punya touch akuisisi → masuk `tanpaTouch` / `leadLegacyMetaAdsTanpaTouch`; tidak ditebak.
- `AD_REPLY_UNMARKED` (iklan tanpa penanda CTWA) direkam tetapi **tidak** dihitung kecuali `sinyal=SEMUA`.
- Tidak ada atribusi historis: berkas Fase 0 tidak memuat customer ID. `attributionStartAt` = touch tertua tersimpan; rentang sebelum itu diberi peringatan `RENTANG_SEBELUM_ATRIBUSI`.

## 4. Endpoint (semua ADMIN, `Cache-Control: no-store`)

| Metode & jalur | Fungsi |
|---|---|
| `GET /api/atribusi/iklan?dari=YYYY-MM-DD&sampai=YYYY-MM-DD&level=campaign\|adset\|ad&sinyal=CTWA_AD\|SEMUA&rincian=1` | laporan; tanggal = hari WIB; maks 366 hari; satu perhitungan sekaligus (429) |
| `GET /api/atribusi/iklan/referensi` | ringkasan referensi + Ad ID tak terpetakan |
| `POST /api/atribusi/iklan/referensi` | impor `{csv}` atau `{rows}`; **`dryRun` default true**; `izinkanKoreksi` default false |
| `GET /api/atribusi/iklan/ekspor-id[?format=csv]` | daftar ID (tanpa PII) untuk join dengan Windsor |

## 5. Definisi metrik

Semua definisi Fase 1 dipakai ulang (`cohortDefinitions.js`); yang baru hanya pengelompokan per Ad/AdSet/Campaign.

| Metrik (kunci respons) | Definisi | Tanggal pemisah |
|---|---|---|
| `lead.unik` | customer akuisisi iklan (touch akuisisi di grup itu) dengan `Customer.createdAt` di rentang | tanggal lead (hari WIB) |
| `lead.spam` / `bukanSpam` / `leadSah` | `SPAM` / bukan spam / bukan SPAM, B2B_DIRECT, staf internal, profil karyawan | — |
| `pernahDitandaiProspek` | pernah stage PROSPECT/TRANSACTION/REVIEWED (penilaian manual; bukan "qualified"); `tanpaTanggal` = tanpa riwayat transisi | `PipelineTransition.createdAt` |
| `customerDenganOrder` | customer lead sah dengan ≥ 1 order eligible (satuan customer) | order |
| `orderEligible` | order bukan CANCELLED/PENDING, bukan penjualan karyawan, milik lead sah | `Order.createdAt` (WIB) |
| `bookedValue` | Σ `Order.value` eligible (tanpa ongkir) — **bukan uang** | tanggal order |
| `orderPernahDp` / `orderDpSaatIniLedger` | pembayaran ledger pertama < tagihan / ledger bersih di antara 0 dan tagihan | hari payment pertama |
| `lunasMenurutCrm` | `paymentStatus = LUNAS` tersimpan (jumlah, nilai, `tanggalTidakPasti` untuk backfill 31 Agt) | `Order.paidAt` |
| `lunasTerbuktiLedger` | ledger valid − refund disetujui ≥ tagihan (value + ongkir) > 0 | hari payment pelunas |
| `buktiPelunasan` | partisi LUNAS CRM: `lunasTerbuktiLedger` / `lunasTanpaLedger` / `konflikLunasTersimpanLedgerTidakCukup` (+ `kekuranganRupiahKonflik`) | — |
| `uangLedger` / `refundDisetujui` / `uangBersihLedger` | Σ kontribusi payment valid (bukan dibatalkan, alokasi-sadar), refund disetujui | `Payment.createdAt`, `approvedAt` |
| `cakupanLedger` | berapa order eligible yang punya payment di ledger | — |
| `kematangan.hari7/30/60` | hasil yang terjadi dalam N hari sejak tanggal lead, hanya lead berumur ≥ N hari | lead + N hari |
| `sentuhanBerikutnya` | touch bukan-akuisisi (customer lama / touch kedua dst) pada Ad di grup itu | tanggal touch |
| `biaya.cpa` / `roas` | **null** — spend Meta belum terhubung/direkonsiliasi (`status: BELUM_TERHUBUNG`) | — |

Tiga tanggal dipisah di blok `rincian` (`perBulanLead`, `perBulanOrder`, `perBulanPembayaran`) — DP September dan pelunasan Oktober jatuh di bulan masing-masing.
Order LUNAS historis tanpa ledger **tidak** pernah dihitung sebagai uang diterima.

## 6. Contoh respons (data sintetis dari tes integrasi; dipangkas)

```json
{
  "versi": 1,
  "zonaWaktu": "Asia/Jakarta (UTC+7); semua hari WIB",
  "rentangLead": { "dari": "2026-09-25", "sampai": "2026-10-10", "level": "campaign", "sinyal": "CTWA_AD" },
  "atribusi": { "attributionStartWib": "2026-09-29 10:01", "historis": "TIDAK ADA — lead sebelum touch tersimpan tidak diatribusikan; ..." },
  "cakupan": { "leadBaruDalamRentang": 8, "leadSahDalamRentang": 7, "denganTouchAkuisisi": 7, "terpetakan": 6,
               "tidakTerpetakan": 1, "tanpaTouch": 1, "persenDenganTouch": 87.5, "persenTerpetakanDariTouch": 85.7 },
  "grup": [
    { "kunci": "52694481763084", "status": "MAPPED", "campaign": { "id": "52694481763084", "nama": "Jabo IG Oktober" },
      "lead": { "unik": 3, "spam": 1, "bukanSpam": 2, "leadSah": 2 },
      "customerDenganOrder": 2, "orderEligible": 3, "orderPernahDp": 2,
      "lunasMenurutCrm": { "jumlah": 2, "nilai": 6000000 }, "lunasTerbuktiLedger": { "jumlah": 2, "nilai": 6000000 },
      "bookedValue": 7500000, "uangLedger": 6750000,
      "sentuhanBerikutnya": { "touch": 2, "customerUnik": 2, "padaCustomerBaru": 0, "padaCustomerLama": 2 },
      "biaya": { "status": "BELUM_TERHUBUNG", "cpa": null, "roas": null } },
    { "kunci": "52689735916884", "status": "MAPPED", "campaign": { "id": "52689735916884", "nama": "IG gabungan lama" },
      "lead": { "unik": 2, "leadSah": 2 }, "orderEligible": 1, "bookedValue": 3000000,
      "lunasMenurutCrm": { "jumlah": 1, "nilai": 3000000 }, "lunasTerbuktiLedger": { "jumlah": 0, "nilai": 0 },
      "buktiPelunasan": { "lunasTanpaLedger": 1 }, "uangLedger": 0 },
    { "kunci": "UNMAPPED", "status": "UNMAPPED", "campaign": null, "adSet": null, "lead": { "unik": 1 } }
  ],
  "tidakTerpetakan": { "adIds": [ { "adId": "52699999999999", "leadAkuisisi": 1, "pertamaWib": "2026-10-02 10:01" } ] },
  "biaya": { "status": "BELUM_TERHUBUNG", "cpa": null, "roas": null, "ekspor": "/api/atribusi/iklan/ekspor-id" },
  "rekonsiliasi": { "ok": true }
}
```

Respons tidak memuat nomor, nama, customerId, orderId, clid, atau isi chat (diperiksa otomatis oleh tes).

## 7. Validasi

| Lapis | Hasil |
|---|---|
| Unit (builder touch, dedupe, parser/validator CSV, rencana impor, mesin laporan) | 29/29 |
| Integrasi PostgreSQL sekali pakai (migrasi dari nol, webhook asli, HTTP) | 14/14, stabil 3× berturut-turut |
| Suite unit penuh vs baseline `187795f1` | kegagalan identik (5 bawaan: P5 pagar, audit statis outbound, 2 compose staging, COVERAGE TAB Finance); 2 pin sha256 skrip rilis Fase 0/1 diperbarui sadar (lihat §10) |
| Performa (disposable, data sintetis, 1× dan 10× volume produksi 12 Okt 2026) | 1×: 57–451 ms (90 hari, level ad); 10×: 319–2.704 ms; kueri touch sendiri 0,8–44 ms |

Kasus yang dibuktikan: dua event bersamaan + retry = 1 Message & 1 touch; customer lama = touch terpisah tanpa mengubah customer; tanpa `sourceID`/`sourceType≠ad`
= 0 touch dan Ad ID tidak dikarang dari URL; kegagalan penulisan touch tidak menggagalkan inbox dan log tanpa nomor; CHECK DB menolak Ad ID bukan digit, pemetaan
tidak konsisten, tanggal WIB tidak cocok; impor: dry-run default, ADMIN saja, konflik tidak menimpa, notasi ilmiah (`5.2E+13`) ditolak, `MARKETING_API` ditolak;
Ad ID baru dipetakan tanpa perubahan kode; level campaign/ad set/ad menjumlah identik; DP→lunas lintas bulan; payment batal + pengganti; LUNAS historis tanpa ledger;
konflik LUNAS-ledger-kurang; spam dikecualikan dari closing; transaksi laporan ditolak Postgres bila menulis (`read-only`).

## 8. Rollout (setiap langkah butuh keputusan Owner; tidak ada yang dijalankan di sini)

1. Rilis kode dengan **flag MATI** — migrasi aditif; perilaku webhook tidak berubah (verifikasi: 0 baris `attribution_touches` setelah beberapa jam).
2. Impor referensi: `POST /referensi` dengan `dryRun` (default) → tinjau → ulangi `dryRun:false`. Sumber: ekspor Ads Manager (kolom Ad ID/Ad set ID/Campaign ID sebagai **teks**).
   Enam pemetaan yang diverifikasi Mesa adalah fixture tes, bukan daftar permanen.
3. Owner mengubah env `ATRIBUSI_TOUCH_CAPTURE_ENABLED=true` + recreate backend (di luar cakupan sesi ini).
4. Pantau 24–48 jam: `GET /api/atribusi/iklan` (rekonsiliasi `ok`, `tidakTerpetakan.adIds`), jumlah touch ≈ inbound CTWA_AD baru.
5. Setiap iklan baru → ekspor `ekspor-id`/impor referensi lagi.

## 9. Rollback

- Cepat (perilaku): ubah flag ke bukan `"true"` + recreate backend → capture berhenti; data tetap; laporan tetap dapat dibaca.
- Kode: rollback image ke tag pra-rilis (kode lama mengabaikan tabel baru; migrasi aditif sehingga tidak perlu di-undo).
- Data: tabel baru tidak dibaca oleh kode lama; `DROP` hanya bila Owner memutuskan (tidak diperlukan untuk rollback).

## 10. Risiko dan batasan jujur

1. **Touch hilang bila proses mati** di antara simpan pesan dan simpan touch (penulisan sengaja di luar jalur kritis). Retry WAHA tidak membuat ulang touch karena pesan sudah ada.
   Dampak: undercount kecil, tidak pernah overcount. Dipantau lewat selisih jumlah touch vs inbound CTWA_AD.
2. **Tidak ada atribusi historis**; 20 dari 283 observasi Fase 0 (customer lama tanpa `sourceID`) tidak akan pernah bertouch.
3. **Referensi dapat basi**: iklan baru tampil `UNMAPPED` sampai referensi diimpor. Tidak ada kredensial Marketing API di repo/env → sinkron otomatis tidak dibangun.
4. **Pin skrip rilis Fase 0/1**: `release-ctwa-capture-flag-off.sh` (webhooks.js) dan `release-atribusi-kohort.sh` (index.js, cohortLoader.js) dipin per berkas; kedua skrip
   di-repin setelah perubahan ditinjau. Allowlist keduanya tetap menolak `schema.prisma` dan migrasi, jadi tidak dapat dipakai merilis Fase 2.
5. CPA/ROAS tidak diklaim (spend belum terhubung).
6. Performa linear terhadap jumlah customer di rentang (beban utama = loader kohort Fase 1, bukan kueri touch); rentang ≤ 366 hari.

## 11. Keputusan bisnis yang tertunda (butuh Owner)

| Keputusan | Opsi | Rekomendasi (berbasis data) |
|---|---|---|
| Apakah `AD_REPLY_UNMARKED` dihitung sebagai touch iklan | A: hanya `CTWA_AD` (default); B: `SEMUA` | **A**. Di capture Fase 0 hanya 8 observasi (2 pada customer baru); menghitungnya menaikkan lead tanpa bukti penanda iklan. `sinyal=SEMUA` tersedia untuk perbandingan. |
| Kapan CPA/ROAS boleh diklaim | A: tunggu integrasi spend Meta + rekonsiliasi; B: join manual di Windsor lewat `ekspor-id` | **B sebagai jembatan**, A sebagai target; angka tetap `null` di CRM sampai spend direkonsiliasi. |
| Makna "closing" di laporan iklan | A: `lunasMenurutCrm`; B: `lunasTerbuktiLedger` | **Tampilkan keduanya** (sudah); gunakan `lunasTerbuktiLedger` untuk keputusan uang dan `lunasMenurutCrm` hanya sebagai indikator operasional sampai cakupan ledger histori memadai. |
