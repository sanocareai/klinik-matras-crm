# Resi Gabungan — Fase 3A (pembayaran/DP) dan rancangan Fase 3B (batal/refund)

Status: **kode selesai + dua putaran hardening (28 Sep 2026) di branch `feat/resi-fase3a`, belum dimerge/dideploy.** Semua fitur di balik flag `resi_pembayaran_aktif` (default MATI).

## Fase 3A — apa yang ada

| Bagian | Perilaku |
|---|---|
| Flag | `RESI_PEMBAYARAN_AKTIF` (`fin_settings.resi_pembayaran_aktif`, default `false`), server-authoritative: semua endpoint di bawah menolak 403 (`RESI_PEMBAYARAN_MATI`) bila mati. Terpisah dari `RESI_INPUT_AKTIF`. |
| Model data | Satu pembayaran Resi = SATU `Payment` pada order **anchor** + `FinPaymentAllocation` ke child aktif (tabel yang sudah ada, tidak ada tabel baru). Migrasi aditif `20260928090000_resi_klaim_lunas`: dua kolom nullable di `order_groups` (`lunas_diklaim_pada`, `lunas_diklaim_oleh`) untuk menyimpan klaim Sales **tanpa** menyentuh `Order.paymentStatus/paidAt`. |
| Jurnal | `postPaymentReceived`/`postJournal` yang sudah ada: Dr Kas/Bank **sekali** (total, mode REKENING) atau Dr Laba Ditahan (mode SEBELUM_SALDO_AWAL), Cr Piutang/Uang Muka **satu baris per child** sesuai alokasi. Tidak ada pendapatan/uang masuk ganda. |
| Cakupan | Hanya group `source = BARU`. `BACKFILL_BUNDLE` → 409 (`GRUP_BACKFILL`) sampai backfill resmi. Order tunggal/`groupId` NULL tidak tersentuh (dites eksplisit: identik ON/OFF). |
| Sales | `GET /api/resi/:groupId/pembayaran/pratinjau`, `POST /api/resi/:groupId/pembayaran` (catat DP/pembayaran), `POST /api/resi/:groupId/klaim-lunas`, `GET /api/resi/pelanggan/:customerId/pembayaran` (ringkasan kartu), `GET /api/resi/order/:orderId/pembayaran` (tab Pembayaran per order). |
| Finance | `GET /api/finance/penerimaan/lunas-belum-dicatat` menambah bagian `resi` (satu item per Resi + rincian `anak` + `pembayaran` tercatat + bukti bertanda tangan); `GET …/penerimaan/resi/:groupId` (detail), `…/pratinjau`, `POST …/verifikasi`, `…/tolak`, `…/minta-bukti`. |
| Idempotensi | Header `Idempotency-Key` **wajib** (428 bila hilang; 8–128 karakter) pada catat pembayaran, klaim Lunas, dan verifikasi. |
| Konkurensi & urutan kunci | **Kanonis di SEMUA jalur yang menyentuh Payment/Order/OrderGroup** (`services/finance/urutanKunci.js`): grup → order (id naik) → payment → posting jurnal. Dipakai ulang oleh alur Resi, `verifikasiPembayaran`/`tolakPembayaran` lama, batal Payment admin, PATCH/`cancel` order, dan koreksi alokasi manual — menutup deadlock sporadis dari urutan yang dulu terbalik antar jalur. |
| Guard pembatalan | Child ber-`groupId` yang sudah punya alokasi AKTIF tidak bisa dibatalkan (409, tanpa syarat flag). **Anchor** dengan klaim Lunas yang masih menunggu (grup atau per-order lama) juga tidak bisa dibatalkan sampai Finance menolak/memverifikasi klaimnya — mencegah klaim tercecer permanen (`ANCHOR_DIBATALKAN` mengunci seluruh grup). Semua pemeriksaan dicek ULANG di bawah kunci (cancel-vs-verify race tertutup). |
| Guard per order | Saat flag ON, child Resi BARU tidak bisa diverifikasi/ditolak/diminta buktinya per order (409 `ANAK_RESI`), atau dibayar lewat `POST /orders/:id/payments` generik (409 `ANAK_RESI_WAJIB_BAYAR_LEWAT_RESI`, dicek ulang di bawah row lock); saat OFF perilaku lama utuh untuk order tunggal & group legacy. |
| Metode & mode | Semua `PaymentMethod` yang valid (CASH/TRANSFER/QRIS/CARD) diterima — tidak dipersempit. Verifikasi Finance mendukung mode **REKENING** dan (hanya untuk Resi **historis**, lihat di bawah) **SEBELUM_SALDO_AWAL** lewat API; UI Finance hanya menawarkan REKENING. |
| Exactly-once verifikasi | `versi` opsional (angka `updatedAt` grup, dikembalikan di pratinjau/antrean/respons verifikasi) dicocokkan ULANG di bawah kunci grup. Setiap verifikasi (penuh ATAU sebagian) menulis ulang baris grup, jadi request kedua yang balapan dengan `versi` basi (Idempotency-Key beda, dua klik) ditolak 409 `VERSI_BERUBAH` — tanpa Payment/alokasi/jurnal/paidAt tambahan. `versi` yang tidak dikirim melewati pemeriksaan ini (kompatibel mundur). |
| SEBELUM_SALDO_AWAL vs cutoff | Diblokir (409 `SEBELUM_SALDO_AWAL_TIDAK_BERLAKU`) untuk Resi yang **dibuat pada/setelah** tanggal saldo awal (`fin_settings.balance_cutover_date`, default 18 Sep 2026) — dalam praktiknya berarti SEMUA Resi baru, karena fitur ini sendiri baru ada setelah cutoff. Tetap berfungsi (Dr Laba Ditahan, Cr per child, tanpa kas) untuk Resi historis (`OrderGroup.createdAt` sebelum cutoff, mis. hasil migrasi masa depan). |

## Aturan angka (helper kanonis: `services/finance/tagihanOrder.js`)

- `tagihanOrder` = `Order.value` + ongkir yang **ditagih lewat order itu**. Untuk child Resi BARU, Ongkir Tambahan HANYA dihitung di order **anchor** (tepat sekali per Resi, walau field `ongkir` keliru terisi di child lain). Order lain (tunggal/BACKFILL) = `value + ongkir` seperti sebelumnya.
- `dasarStatusBayar` = pembanding status Lunas/DP di CRM. Child Resi BARU → `tagihanOrder` (ongkir anchor ikut). Order lain → `Order.value` saja — **aturan lama TIDAK berubah** (dipakai `recomputeOrderPaymentStatus`, antrean Finance, invoice, `Pemasukan`, dan guard pembatalan).
- `dibayar child` = `paidForOrder` **tanpa gerbang verifikasi** (konservatif, tidak pernah over-alokasi).
- **Mode `TAGIHAN`**: bobot = sisa tagihan child aktif. **Mode `DP`**: bobot = `max(min(dpTarget, tagihan) − dibayar, 0)`; tanpa pembayaran sebelumnya alokasi DP **persis = dpTarget** tiap child.
- Nominal default = Σ bobot; nominal > Σ bobot → 409 `OVER_ALOKASI`.
- Pembagian: **largest-remainder** (`bagiProporsional`), Σ alokasi tepat = nominal; baris 0 tidak ditulis. Invarian dicek ulang ke DB tepat sebelum menulis (`validasiAlokasiResi`).
- Klien **tidak** mengirim pembagian; field `alokasi`/`allocations` pada body diabaikan.
- **Total sadar-alokasi**: `kontribusiPembayaranOrders`/`kontribusiPembayaranOrder` (`services/finance/allocation.js`) — Payment tanpa alokasi = penuh ke order induknya (identik lama); Payment beralokasi (pembayaran Resi di anchor) = hanya bagian untuk order itu. Dipakai invoice (per order dan gabungan — satu Payment yang dialokasikan ke beberapa anggota disatukan lagi jadi satu baris di dokumen gabungan) dan status bayar di `Pemasukan`.

## Alur klaim Lunas (disimpan di grup, BUKAN di child)

1. Sales: `klaim-lunas` (sekali per Resi) → `OrderGroup.lunasDiklaimPada/OlehId` terisi. **Tidak mengubah** `paymentStatus`/`paidAt` child dan tidak membuat Payment/jurnal — status dan komisi hanya bergerak lewat ledger setelah Finance memverifikasi.
2. Finance melihat **satu** antrean Resi (rincian child, pembayaran tercatat, bukti) dengan pratinjau alokasi; verifikasi (REKENING/SEBELUM_SALDO_AWAL) → 1 Payment + alokasi + jurnal per child, status+`paidAt` child dihitung ulang dari ledger. Verifikasi **sebagian** mempertahankan klaim (menunggu sisanya); lunas penuh melepas klaim.
3. `tolak` melepas klaim TANPA menyentuh status/pembayaran yang sah (hanya child dengan klaim per-order lama yang tidak didukung ledger yang dipulihkan dari ledger).
4. Klaim per order LAMA (dropdown sebelum flag aktif, `paymentStatus=LUNAS` tanpa ledger yang cukup) pada child Resi BARU ikut tampil di antrean (`sumberKlaim: PER_ORDER`), tidak yatim.

## UI

- **Sales** (`features/resi/PembayaranResiPelanggan.jsx`, dipasang di `OrderSection.jsx`): kartu per Resi di profil pelanggan — total, ongkir tambahan, rincian child (bisa dibuka ke drawer order), sisa, tombol "Klaim Lunas Resi" sekali. Dropdown status bayar per order dikunci (dengan keterangan) untuk anak Resi. Tab Pembayaran di drawer order menampilkan angka sadar-alokasi + penjelasan untuk anak Resi.
- **Finance** (`features/finance/KlaimLunasResi.jsx`, dipasang di `LunasBelumDicatat.jsx`/halaman Pembayaran & Pemasukan): satu baris per Resi, rincian child + pembayaran tercatat (rekening, bukti bertanda tangan) bisa dibuka; pratinjau alokasi server sebelum verifikasi; Verifikasi/Minta Bukti/Tolak.
- Semua bagian di atas **disembunyikan total** bila `RESI_PEMBAYARAN_AKTIF` mati (server tidak mengirim data `resi`/`aktif:false`) — fail-closed. Order tunggal tidak berubah.
- **QA visual (28 Sep 2026, putaran 3)**: dijalankan NYATA di browser (Playwright + Chromium) memakai worktree ini tapi **backend+DB+frontend TERISOLASI** — database sekali-pakai `klinik_matras_qa_resi` (bukan `.env`/DB produksi ataupun DB tes), backend & frontend dijalankan di port default (4000/5173, keduanya kosong sebelum dipakai) lalu **dimatikan dan database DIHAPUS setelah selesai** — tidak menyentuh produksi maupun sesi lain. Dicek: Sales klaim Resi (kartu profil + modal konfirmasi), Finance pratinjau + verifikasi (antrean, rincian, modal dengan pembagian otomatis dari server), pada 1440px & 390px, terang & gelap (8 kombinasi + 2 tambahan), dan flag OFF menyembunyikan seluruh UI (dicek eksplisit: 0 elemen). Semua lulus. Satu temuan KODE (bukan Resi) tercatat terpisah: ikon status di baris order bawaan tampil kosong/putih di dark-mode — pra-ada, di luar cakupan Fase 3A, tidak diperbaiki di sini.

## Hasil audit invariants (dua putaran sub-agent Opus) dan tindak lanjut

**Putaran 1 (alokasi/jurnal) — diperbaiki, ada tesnya:** (1) pembatalan Payment oleh admin lewat CRM menghitung ulang SEMUA order beralokasi, bukan hanya anchor; (2) koreksi alokasi manual atas Payment Resi ditolak (409 `ALOKASI_RESI_TERKUNCI`), dicek ulang di bawah kunci; (3) Sales tidak bisa mencatat pembayaran atas Resi yang sedang diklaim Lunas (409 `KLAIM_LUNAS_AKTIF`).

**Putaran 2 (lock order & jurnal, setelah hardening) — diperbaiki, ada tesnya:** (4) anchor dengan klaim Lunas (grup atau per-order lama) menunggu tidak bisa dibatalkan sampai Finance menolak/memverifikasi — sebelumnya `ANCHOR_DIBATALKAN` membuat klaim tercecer permanen (tidak bisa ditolak maupun diverifikasi); (5) daftar unit yang ikut dibatalkan di `POST /:id/cancel` dibaca ULANG di bawah kunci (bukan hasil pemeriksaan di luar transaksi) — unit yang berubah di antara dua pemeriksaan tidak lagi tertinggal; (6) guard `pastikanPaymentBukanResi` dicek ULANG di dalam transaksi setelah kunci payment, bukan hanya sekali di luar transaksi.

**Putaran 3 (tiga blocker terakhir, 28 Sep 2026) — diperbaiki, ada tesnya:**
1. `POST /orders/:id/payments` (pencatatan manual generik) sekarang menolak (409 `ANAK_RESI_WAJIB_BAYAR_LEWAT_RESI`) untuk child Resi BARU saat flag ON, dicek ulang di bawah row lock. Order tunggal dan group `BACKFILL_BUNDLE` identik dengan sebelumnya (tetap 201).
2. Verifikasi Resi sekarang **exactly-once** walau dua request paralel memakai Idempotency-Key berbeda: `versi` optimistik (angka `updatedAt` grup) dicocokkan ulang di bawah kunci; setiap verifikasi (penuh ATAU sebagian) menulis ulang baris grup, jadi request kedua yang balapan dengan `versi` basi ditolak 409 `VERSI_BERUBAH` — tanpa Payment/alokasi/jurnal/paidAt tambahan. Verifikasi sebagian yang genuinely berurutan (bukan balapan) tetap berjalan selama klien memakai `versi` terbaru dari respons sebelumnya (dipakai UI Finance).
3. `SEBELUM_SALDO_AWAL` sekarang diblokir (409 `SEBELUM_SALDO_AWAL_TIDAK_BERLAKU`) untuk `OrderGroup` yang dibuat pada/setelah cutoff saldo awal — dicek terhadap `grup.createdAt`, bukan dipercaya dari input Finance seperti alur lama. Tetap berfungsi untuk Resi historis (`createdAt` sebelum cutoff). UI Finance tidak lagi menawarkan mode ini sama sekali (selalu REKENING) untuk Resi.

QA visual (Playwright, DB terisolasi) mengonfirmasi ketiga hal ini secara nyata di browser: lihat bagian **UI** di atas.

**Dicatat, sengaja tidak diubah (risiko rendah, keputusan desain untuk Fase 3B atau di luar cakupan hardening ini):**
- Klaim per-order lama pada child Resi bisa "hilang" dari antrean bila verifikasi Resi **sebagian** menurunkan status child itu dari LUNAS ke DP (ledger menang atas klaim manual — dianggap benar: uang yang belum cukup memang belum lunas).
- Ikon status di tabel order bawaan (di bawah kartu Resi, bukan bagian Fase 3A) tampil kosong di dark-mode — ditemukan saat QA visual putaran 3, pra-ada, di luar cakupan.

## Kontrak Fase 3B (belum diimplementasikan — jangan dikerjakan diam-diam)

**Tujuan**: pembatalan dan refund SEBAGIAN dalam satu Resi.

1. **Pembatalan child dengan alokasi** (saat ini diblokir): wajib alur eksplisit, bukan PATCH status.
   - Prasyarat: tidak ada unit in-flight/job aktif (aturan lama).
   - Uang yang sudah dialokasikan ke child itu **tidak hilang**: dipilih Finance — (a) **realokasi** ke child aktif lain (sisa tagihan), atau (b) **refund** ke customer. Keduanya lewat jurnal resmi (tidak ada edit).
2. **Refund child** memakai `FinRefund` per order (yang sudah ada) dengan batas `sisaBisaDirefund` (`paidForOrder`), sehingga alokasi ke child itu menjadi sumber refund. Pembagian refund lintas child dihitung server (largest-remainder) bila refund dimulai dari level Resi.
3. **Ongkir Tambahan** (di anchor): bila anchor dibatalkan, ongkir dipindahkan/dihapus lewat koreksi eksplisit; anchor tidak boleh dibatalkan selama ada child aktif tanpa penetapan anchor baru (`OrderGroup.anchorOrderId` diganti dalam transaksi + audit). Hardening 28 Sep sudah memblokir pembatalan anchor selama ada KLAIM menunggu; 3B perlu memperluas ke child aktif secara umum.
4. **DP**: `OrderGroup.dpTarget` dan `Order.dpTarget` child dihitung ulang proporsional atas sisa child aktif (snapshot lama tersimpan di `metadata`), tanpa mengubah Payment yang sudah ada.
5. **Jurnal**: pembatalan child yang sudah menerima uang memakai jurnal koreksi berseri (pola `bukukanUlangAlokasi`: balik jurnal lama, posting pengganti dengan kunci `…:REALOKASI:<n>`); tidak pernah menimpa jurnal.
6. ~~**Manual generik**: `POST /orders/:id/payments` perlu diberi guard...~~ **SELESAI di hardening putaran 3** (409 `ANAK_RESI_WAJIB_BAYAR_LEWAT_RESI`).
7. **Tes wajib 3B**: batal child sebelum/sesudah DP, refund sebagian, realokasi, anchor dibatalkan, kunci konkurensi (sama pola 3A), rollback jurnal, dan Σ invarian (Σ alokasi = Payment, Σ dibayar child + refund = uang masuk bersih).
8. **Feature flag terpisah** (`RESI_PEMBATALAN_AKTIF`, default MATI) dan hanya group `BARU`.

## Rollback

Kode: deploy ulang release sebelumnya. Data: migrasi `20260928090000_resi_klaim_lunas` murni aditif (dua kolom nullable, baris lama = NULL); Payment/alokasi/jurnal yang sudah terbentuk mengikuti aturan ledger append-only yang ada. Mematikan flag menghentikan endpoint baru tanpa mengubah data.
