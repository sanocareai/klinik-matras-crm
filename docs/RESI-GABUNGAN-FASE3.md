# Resi Gabungan — Fase 3A (pembayaran/DP) dan rancangan Fase 3B (batal/refund)

Status: **kode selesai di branch `feat/resi-fase3a`, belum dimerge/dideploy.** Semua fitur di balik flag `resi_pembayaran_aktif` (default MATI).

## Fase 3A — apa yang ada

| Bagian | Perilaku |
|---|---|
| Flag | `RESI_PEMBAYARAN_AKTIF` (`fin_settings.resi_pembayaran_aktif`, default `false`), server-authoritative: semua endpoint di bawah menolak 403 (`RESI_PEMBAYARAN_MATI`) bila mati. Terpisah dari `RESI_INPUT_AKTIF`. |
| Model data | **Tidak ada tabel/kolom baru.** Satu pembayaran Resi = SATU `Payment` pada order **anchor** + `FinPaymentAllocation` ke child aktif. |
| Jurnal | `postPaymentReceived` yang sudah ada: Dr Kas/Bank **sekali** (total), Cr Piutang/Uang Muka **satu baris per child** sesuai alokasi. Tidak ada pendapatan/uang masuk ganda. |
| Cakupan | Hanya group `source = BARU`. `BACKFILL_BUNDLE` → 409 (`GRUP_BACKFILL`) sampai backfill resmi. Order tunggal/`groupId` NULL tidak tersentuh. |
| Sales | `GET /api/resi/:groupId/pembayaran/pratinjau`, `POST /api/resi/:groupId/pembayaran` (catat DP/pembayaran), `POST /api/resi/:groupId/klaim-lunas`. |
| Finance | `GET /api/finance/penerimaan/lunas-belum-dicatat` menambah bagian `resi` (satu item per Resi + rincian `anak`); `GET …/penerimaan/resi/:groupId/pratinjau`, `POST …/verifikasi`, `…/tolak`, `…/minta-bukti`. |
| Idempotensi | Header `Idempotency-Key` **wajib** (428 bila hilang; 8–128 karakter) pada catat pembayaran, klaim Lunas, dan verifikasi. Memakai `ApiIdempotencyKey` yang sudah ada (kunci sama + isi sama = respons diputar ulang; isi beda = 422). |
| Konkurensi | Transaksi mengunci baris group lalu **semua child berurutan (id naik)**; hitung ulang di bawah kunci. Kunci berbeda pada pelunasan yang sama → satu berhasil, sisanya 409. |
| Guard pembatalan | Child ber-`groupId` yang sudah punya alokasi tidak bisa dibatalkan (`checkCancelBlockers`, PATCH status dan `/cancel` → 409). Order lain tidak berubah. |
| Guard per order | Saat flag ON, child Resi BARU tidak bisa diverifikasi/ditolak/diminta buktinya per order (409 `ANAK_RESI`); saat OFF perilaku lama utuh. |

## Aturan angka

- `tagihan child = Order.value + Order.ongkir` (Ongkir Tambahan hanya di anchor). Sama dengan Total Resi dan dasar DP 30% Fase 1.
- `dibayar child` = `paidForOrder` **tanpa gerbang verifikasi** (semua Payment tidak dibatalkan) — konservatif: uang yang sudah dicatat Sales mengurangi sisa walau belum diverifikasi.
- **Mode `TAGIHAN`**: bobot = sisa tagihan child aktif. **Mode `DP`**: bobot = `max(min(dpTarget, tagihan) − dibayar, 0)`; tanpa pembayaran sebelumnya alokasi DP **persis = dpTarget** tiap child (Σ dpTarget = DP 30% Total Resi).
- Nominal default = Σ bobot; nominal > Σ bobot → 409 `OVER_ALOKASI`; bukan bilangan bulat > 0 → 400.
- Pembagian: **largest-remainder** (`bagiProporsional`), Σ alokasi tepat = nominal; baris 0 tidak ditulis.
- Invarian dicek ulang ke DB tepat sebelum menulis (`validasiAlokasiResi`): child ada, satu group & satu customer, tidak CANCELLED, nominal bulat > 0, tanpa duplikat, tiap alokasi ≤ sisa, Σ = Payment.
- Klien **tidak** mengirim pembagian; field `alokasi`/`allocations` pada body diabaikan.

## Alur klaim Lunas

1. Sales: `klaim-lunas` (sekali per Resi) → semua child aktif `paymentStatus = LUNAS`, `paidAt` terisi (dasar komisi). Tidak ada Payment/jurnal.
2. Finance melihat **satu** antrean Resi (`lengkap: true` bila semua child Lunas) dengan rincian child; pratinjau alokasi; verifikasi (rekening wajib, mode `REKENING`) → 1 Payment terverifikasi + alokasi + jurnal per child. `tolak` mengembalikan child ke `DP`/`BELUM_BAYAR`.
3. Klaim yang belum lengkap di level Resi → verifikasi 409 `KLAIM_BELUM_LENGKAP`.

## Batasan/risiko yang diketahui

1. **Status bayar CRM mengabaikan Ongkir** (aturan lama: `paid ≥ Order.value` → LUNAS). Anchor bisa berstatus LUNAS saat Ongkir Tambahan belum terbayar penuh; sisa Resi tetap dihitung dengan ongkir sehingga pelunasan berikutnya tetap dialokasikan.
2. **Koreksi alokasi manual** (fitur Finance yang sudah ada) tetap bisa mengubah alokasi Payment Resi; tidak diblokir di 3A.
3. **Verifikasi hanya mode REKENING** (bukan `SEBELUM_SALDO_AWAL`): Resi baru tidak relevan dengan riwayat sebelum 18 Sep 2026.
4. **Frontend belum diubah**: bagian `resi` di antrean Finance dan tombol Sales belum punya UI. Selama flag MATI tidak ada dampak. UI perlu sebelum flag dinyalakan.
5. Modul yang menjumlah `payments.amount` per order **tanpa** `paidForOrder` akan menaruh seluruh Payment pada anchor. Modul yang sudah memakai `paidForOrder`/alokasi (status bayar, piutang per order dari jurnal, Pemasukan) benar; sisanya perlu diaudit sebelum rilis.

## Hasil audit invariants (sub-agent Opus) dan tindak lanjut

Diperbaiki di 3A (ada tesnya): (1) pembatalan Payment oleh admin lewat CRM kini menghitung ulang SEMUA order beralokasi, bukan hanya anchor; (2) koreksi alokasi manual atas Payment Resi ditolak saat flag ON (409 `ALOKASI_RESI_TERKUNCI`); (3) Sales tidak bisa mencatat pembayaran atas Resi yang sedang diklaim Lunas (409 `KLAIM_LUNAS_AKTIF`).

Dicatat, tidak diubah (risiko rendah, untuk 3B/sebelum flag ON): (4) `tolakLunasResi` membandingkan dengan value, antrean memakai value+ongkir (turunan aturan status CRM yang mengabaikan ongkir); (5) bila gerbang verifikasi dinyalakan, DP Sales belum terverifikasi tidak dihitung saat recompute sehingga status/paidAt child turun sementara; (6) blocker batal child (alokasi) tidak mengikuti flag: order di group BACKFILL_BUNDLE dengan alokasi manual lama kini tidak bisa dibatalkan (arah lebih aman); (7) urutan kunci payment→order di verifikasi/tolak lama vs order terurut di alur Resi dapat memicu deadlock yang dibatalkan Postgres (data aman, klien mengulang).

## Kontrak Fase 3B (belum diimplementasikan — jangan dikerjakan diam-diam)

**Tujuan**: pembatalan dan refund SEBAGIAN dalam satu Resi.

1. **Pembatalan child dengan alokasi** (saat ini diblokir): wajib alur eksplisit, bukan PATCH status.
   - Prasyarat: tidak ada unit in-flight/job aktif (aturan lama).
   - Uang yang sudah dialokasikan ke child itu **tidak hilang**: dipilih Finance — (a) **realokasi** ke child aktif lain (sisa tagihan), atau (b) **refund** ke customer. Keduanya lewat jurnal resmi (tidak ada edit).
2. **Refund child** memakai `FinRefund` per order (yang sudah ada) dengan batas `sisaBisaDirefund` (`paidForOrder`), sehingga alokasi ke child itu menjadi sumber refund. Pembagian refund lintas child dihitung server (largest-remainder) bila refund dimulai dari level Resi.
3. **Ongkir Tambahan** (di anchor): bila anchor dibatalkan, ongkir dipindahkan/dihapus lewat koreksi eksplisit; anchor tidak boleh dibatalkan selama ada child aktif tanpa penetapan anchor baru (`OrderGroup.anchorOrderId` diganti dalam transaksi + audit).
4. **DP**: `OrderGroup.dpTarget` dan `Order.dpTarget` child dihitung ulang proporsional atas sisa child aktif (snapshot lama tersimpan di `metadata`), tanpa mengubah Payment yang sudah ada.
5. **Jurnal**: pembatalan child yang sudah menerima uang memakai jurnal koreksi berseri (pola `bukukanUlangAlokasi`: balik jurnal lama, posting pengganti dengan kunci `…:REALOKASI:<n>`); tidak pernah menimpa jurnal.
6. **Tes wajib 3B**: batal child sebelum/sesudah DP, refund sebagian, realokasi, anchor dibatalkan, kunci konkurensi (sama pola 3A), rollback jurnal, dan Σ invarian (Σ alokasi = Payment, Σ dibayar child + refund = uang masuk bersih).
7. **Feature flag terpisah** (`RESI_PEMBATALAN_AKTIF`, default MATI) dan hanya group `BARU`.

## Rollback

Kode: deploy ulang release sebelumnya. Data: tidak ada migrasi/skema baru; Payment/alokasi/jurnal yang sudah terbentuk mengikuti aturan ledger append-only yang ada (koreksi lewat alur Finance: tolak Payment yang belum diverifikasi, atau pembalikan jurnal resmi). Mematikan flag menghentikan endpoint baru tanpa mengubah data.
