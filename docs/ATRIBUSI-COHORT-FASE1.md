# Atribusi Meta Ads — Fase 1: kohort lead → customer → order → pembayaran (endpoint baca-saja)

**Status:** endpoint admin baca-saja, terisolasi, **belum di-deploy/push/merge**. Basis: live `c220e72d` (seluruh rilis live sebelumnya tetap utuh: Penerimaan Kosong Lama, Perpindahan Percakapan, Rencana Aktivasi). Tanpa migrasi, tanpa penulisan data, tanpa menyentuh Dashboard/`analytics.js`, env, atau capture CTWA.
**Prinsip:** campaign/ad set/ad **tidak** diisi dan tidak dihitung (tidak ada CPA/ROAS). Customer, order, dan rupiah adalah satuan berbeda; booked value dan uang diterima tidak pernah dijumlahkan.
Sumber audit: `docs/ATRIBUSI-FASE1-AUDIT-REVIEW.md` (`d4f4e811`). Kontrak attribution touch **dipindah** ke branch `feat/atribusi-touch-contract` (tahap berikutnya).

## 1. Endpoint

`GET /api/atribusi/kohort?dari=YYYY-MM&sampai=YYYY-MM` — hanya **ADMIN** (401 tanpa token, 403 peran lain). Default: `sampai` = bulan berjalan WIB, `dari` = 3 bulan sebelumnya; maksimum 24 bulan; format salah → 400.
Seluruh perhitungan berjalan dalam satu transaksi `SET TRANSACTION READ ONLY` + `statement_timeout` 25 dtk (dipaksa Postgres; teruji). Satu perhitungan sekaligus per proses (429 bila paralel), `Cache-Control: no-store`.

| Bagian respons | Kunci | Isi |
|---|---|---|
| `perBulanLead` | `Customer.createdAt` | hasil lead bulan itu sepanjang umurnya: `leads`, `pernahDitandaiProspek`, `customerDenganOrder`, `orders`, `nilaiOrder`, `lunasMenurutCrm`, `lunasTerbuktiLedger`, `buktiPelunasan`, `cakupanLedger`, `uangLedger`, sebaran `menurutBulan*` |
| `perBulanOrder` | `Order.createdAt` | semua lead (baru dan lama): `orders`, `nilaiOrder`, `customerUnik`, `orderDariLeadLama`, `orderBerulang`, `statusBayarTersimpan`, `lunasMenurutCrm`, `lunasTerbuktiLedger`, `buktiPelunasan`, `cakupanLedger` |
| `perBulanPembayaran` | `Payment.createdAt` / refund `approvedAt` / `Order.paidAt` / hari payment pelunas | `uangLedger`, `jumlahPembayaran`, `refundDisetujui`, **`lunasMenurutCrm`** (tren), **`lunasTerbuktiLedger`** (tren) |
| `jumlahPeriode`, `riwayatPenuh` | — | jumlah bulan terpilih; total seluruh riwayat, order luar kohort |
| `rekonsiliasi` | — | 23 pemeriksaan dari data mentah (`ok`, `cek[]`) |
| `peringatan`, `batasan`, `definisi` | — | peringatan terhitung dari data (mis. `KONFLIK_STATUS_LUNAS_LEDGER`, `LEDGER_TIDAK_LENGKAP`, `TANGGAL_LUNAS_TIDAK_PASTI`, `TANGGAL_DIKUNCI_OWNER`); batas klaim; definisi |

## 2. Definisi dan formula (semua WIB, UTC+7)

| Metrik | Definisi |
|---|---|
| Unique lead | `Customer` unik, `createdAt` di bulan itu, bukan SPAM / B2B_DIRECT / `isInternalStaff` / `staffUserId` |
| Pernah ditandai prospek | pernah di PROSPECT/TRANSACTION/REVIEWED (penilaian manual sales; **bukan** "qualified lead"); `tanpaTanggal` = stage prospek tanpa riwayat transisi |
| Customer dengan order | ≥ 1 order eligible: status bukan PENDING/CANCELLED, bukan Penjualan Karyawan. `customerHanyaOrderPending` = selisih terhadap Dashboard |
| Order / booked value | order eligible / Σ `Order.value` (tanpa ongkir). Bukan uang |
| **`lunasMenurutCrm`** | `Order.paymentStatus = LUNAS` (status tersimpan; yang dilihat tampilan operasional). Order dengan ledger kurang **tetap termasuk**. Tren menurut `Order.paidAt`: `tanggalPasti` (tercatat, bukan backfill) masuk tren; `tanggalTidakPasti` (= timestamp backfill `2026-08-31T05:35:57.201Z`) tidak masuk tren mana pun; `tanpaTanggal` |
| **`lunasTerbuktiLedger`** | ledger valid menutup **seluruh** tagihan: Σ kontribusi dihitung − refund DISETUJUI (≥ 0) **≥ tagihan > 0**, tagihan = `Order.value + ongkir ditagih`. Order dengan ledger kurang **tidak masuk**. Tren menurut hari WIB payment yang pertama membuat kumulatif ≥ tagihan |
| `buktiPelunasan` | partisi **tepat-satu** atas LUNAS CRM: `lunasTerbuktiLedger` / `lunasTanpaLedger` / `konflikLunasTersimpanLedgerTidakCukup` (+ `kekuranganRupiahKonflik`). Terpisah: `konflikBelumLunasTersimpanLedgerCukup` (ledger cukup, CRM belum LUNAS) |
| Uang diterima (`uangLedger`) | Σ kontribusi Payment dihitung (bukan dibatalkan, lolos gerbang verifikasi, sadar-alokasi) pada order bukan CANCELLED; `refundDisetujui`, `uangBersihLedger` terpisah |
| `cakupanLedger` | order eligible: `orderBerLedger` (`berLedgerCukup`/`berLedgerSebagian`) dan `orderTanpaLedger`; `persenOrderBerLedger` di respons |
| DP | `orderDpSaatIniLedger` (ledger bersih > 0 dan < tagihan); `orderDpSaatIniKonflikLunasCrm` = bagian yang berstatus LUNAS CRM |

**Formula:** `lunasMenurutCrm.jumlah = buktiPelunasan.lunasTerbuktiLedger + lunasTanpaLedger + konflikLunasTersimpanLedgerTidakCukup`; `lunasTerbuktiLedger.jumlah = buktiPelunasan.lunasTerbuktiLedger + konflikBelumLunasTersimpanLedgerCukup`.

**Dua jenis lunas, tidak pernah ditukar.** `lunasMenurutCrm` dapat direkonsiliasi dengan tampilan operasional; `lunasTerbuktiLedger` adalah bukti uang dari ledger. Selisihnya = LUNAS tanpa ledger + konflik.

**Tanggal dikunci Owner.** Pengecualian paidAt Owner mengunci *tanggal*; ia tidak membuktikan uang. Order dengan pengecualian aktif ditandai `tanggalDikunciOwner` (subset `tanggalPasti`) dan tidak otomatis `didukungLedger`.

**Cutoff ledger / batas klaim.** Ledger Payment hanya terisi memadai sejak ±Sep 2026; histori sebelumnya hanya dapat "lunas menurut CRM". `uangLedger` dan `lunasTerbuktiLedger` untuk bulan lebih awal **bukan** total pemasukan/pelunasan — baca bersama `cakupanLedger` (di produksi Jul 8/123, Agu 61/208, Sep 202/221). Cutoff eksplisit belum ditetapkan (keputusan Finance). Tanggal lead = `Customer.createdAt` (bukan klik iklan); tanggal pembayaran = `Payment.createdAt` (bukan tanggal klaim); belum ada kebijakan kematangan kohort. Tidak ada atribusi campaign/ad.

## 3. Kasus konflik: LUNAS tersimpan, ledger valid 50% (produksi 10 Okt 2026, telusur baca-saja)

Order Rp4,5 jt, ongkir 0, satu-satunya payment Rp2,25 jt (24 Sep, terverifikasi, sebelum gerbang). Bukan penyebab: payment dibatalkan/diganti, ongkir, gerbang verifikasi, alokasi/refund/klaim, payment lewat job. Status LUNAS (paidAt 30 Sep) tidak mungkin berasal dari ledger; satu-satunya jejak pelunasan adalah pengecualian tanggal Owner (belum dicabut). Pembayaran sisa di luar sistem yang belum dicatat vs status LUNAS keliru **tidak dapat dibedakan dari data**; ini anomali Finance dan **tidak dikoreksi otomatis**.
Perlakuan laporan: tetap di `lunasMenurutCrm`; tidak di `lunasTerbuktiLedger`; `konflikLunasTersimpanLedgerTidakCukup = 1`, `kekuranganRupiahKonflik = 2.250.000` (terpisah); peringatan `KONFLIK_STATUS_LUNAS_LEDGER`; ditandai di tren (`lunasMenurutCrm.konflikLedger`).

## 4. Rekonsiliasi

- **Internal (23 pemeriksaan, dari data mentah):** lead, customer dengan order, order, nilai, uang, partisi order dan uang, LUNAS CRM terbagi lengkap, tren tanpa backfill, `lunasTerbuktiLedger` dihitung ulang dari mentah, partisi bukti, cakupan ledger, tiga tampilan konsisten.
- **Fixture berbentuk audit** (`tests/fixtures/attributionAuditShape.js`, sintetis): mereproduksi 9.362 customer / 8.825 lead sah; 406 vs Dashboard 415; sebaran 8.419/297/64/45; 617/42/21; order per bulan 123/208/221/65, dari lead lama 0/39/55/35, berulang Okt 25; cakupan 8/123 · 61/208 · 202/221 · 19/65; LUNAS 556 = 286 terbukti + 270 tanpa ledger; backfill 133; varian dengan satu konflik → 285/270/1 dan DP kini 5.
- **Produksi** (ekstrak berpseudonim baca-saja → kode final; 10 Okt 2026): rekonsiliasi OK. LUNAS CRM 558 = terbukti ledger 287 + tanpa ledger 270 + konflik 1; `lunasTerbuktiLedger` 287; DP kini ledger 5 (1 konflik); backfill 130 (audit: 133 per hari WIB, kode: per timestamp persis); 12 order bertanggal dikunci Owner; uang ledger Rp639,0 jt vs booked Rp1.365,5 jt vs nilai LUNAS CRM Rp1.253,9 jt vs nilai terbukti ledger Rp632,6 jt.

## 5. Isi branch dan risiko

| Berkas | Fungsi |
|---|---|
| `services/attribution/cohort.js` | inti murni (tiga tampilan, dua lunas, bukti, cakupan, rekonsiliasi) |
| `services/attribution/cohortDefinitions.js` | definisi metrik (sumber tunggal untuk `definisi` respons) |
| `services/attribution/cohortLoader.js` | loader baca-saja, memakai aturan uang live + pengecualian Owner aktif |
| `services/attribution/cohortReport.js` | parameter, transaksi READ ONLY, bentuk respons, peringatan |
| `routes/attributionCohort.js`, `index.js` (+2 baris) | route ADMIN |
| tes | unit inti/audit/laporan, integrasi DB (RBAC, READ ONLY, konflik, backfill, pengecualian) |

Risiko tersisa: loader belum dijalankan terhadap DB produksi (teruji di DB uji; pembanding produksi memakai ekstrak + kode yang sama); memuat semua customer sampai bulan akhir (±9.400, linear; aman sekarang); cutoff ledger dan jendela kematangan belum diputuskan; kasus konflik menunggu Finance. Rollback: hapus route + 2 baris `index.js` + direktori `services/attribution/`; tanpa migrasi atau data.
