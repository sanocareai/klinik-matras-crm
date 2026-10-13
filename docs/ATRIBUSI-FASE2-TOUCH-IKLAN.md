# Atribusi CTWA Fase 2 — Touch iklan (Ad ID) dan laporan lead/closing per ad, ad set, campaign

Status: **kode + migrasi aditif + skrip rilis bergerbang; BELUM deploy/push/merge.** Dibangun dari baseline live `187795f1`.
Capture touch **default MATI** (`ATRIBUSI_TOUCH_CAPTURE_ENABLED` harus persis `"true"`). Skrip rilis TIDAK menyalakannya.

## 1. Apa yang berubah

| Area | Berkas | Sifat |
|---|---|---|
| Migrasi | `backend/prisma/migrations/20261107090000_atribusi_touch_iklan/migration.sql` | 3 tabel BARU kosong; tanpa mengubah tabel lama; tanpa backfill |
| Skema | `backend/prisma/schema.prisma` | hanya penambahan (3 model + relasi balik) |
| Capture | `backend/src/services/attribution/touchCapture.js` | touch ATOMIK bersama `Message` (lihat §2) |
| Kesehatan | `backend/src/services/attribution/captureHealth.js` | agregat tanpa identitas |
| Referensi | `backend/src/services/attribution/adReferensi.js` | impor tervalidasi, dry-run default |
| Laporan | `backend/src/services/attribution/iklanReport.js` | transaksi `READ ONLY`, rekonsiliasi bawaan |
| Rute | `backend/src/routes/attributionAds.js` → `/api/atribusi/iklan` | ADMIN saja |
| Webhook | `backend/src/routes/webhooks.js` | `Message.create` lewat `simpanPesanDenganTouch` |
| Rilis | `scripts/release-atribusi-iklan.sh` | bergerbang; rollback kode tanpa DROP |
| Dashboard lama | — | **tidak diubah** |

Tabel baru: `attribution_touches` (append-only; Ad ID string; UTC + hari WIB di-CHECK; dedupe key UNIQUE; tanpa nomor/nama/chat/clid mentah/payload),
`meta_ad_references` (Ad → Ad Set → Campaign; ID = kunci, nama = label), `meta_ad_reference_imports` (jejak impor).

## 2. Mekanisme capture: durable dan idempoten (menutup loss window)

**Masalah (ditemukan Mesa):** Ad ID hanya ada di payload webhook. Bila touch ditulis SETELAH `Message.create` sebagai operasi terpisah, proses yang mati di antaranya
meninggalkan `Message` tanpa touch yang tidak dapat dipulihkan: webhook di-ack `200` sebelum diproses (WAHA tidak mengirim ulang), retry yang ada dibuang oleh
`cariPesanSudahAda` sebelum handler, dan DB tidak menyimpan sinyal untuk direkonstruksi.

**Pilihan:** touch ditulis dalam **transaksi yang sama** dengan `Message.create` (`simpanPesanDenganTouch`). Alternatif ditolak:

| Opsi | Menutup crash tanpa webhook ulang? | Alasan ditolak |
|---|---|---|
| Perbaiki `skip-dupe` saja | Tidak | retry dibuang sebelum handler; sinyal tidak ada di DB |
| Tabel outbox + worker pemulih | Hanya bila sinyal ditulis atomik dengan pesan | baris atomik itu sudah *adalah* touch; outbox menambah state/worker tanpa manfaat |
| Intent write-ahead + rekonsiliator | Ya | intent untuk pesan yang tak pernah tersimpan; perlu pembersih; lebih kompleks |
| **Satu transaksi (dipilih)** | **Ya, struktural** | transaksi menahan koneksi beberapa ms, hanya untuk pesan CTWA |

Akibat: tidak ada keadaan "Message ada, touch belum" yang dapat dicapai oleh kematian proses. Mati sebelum commit → tidak ada Message maupun touch;
mati sesudah commit → keduanya ada, tepat satu (kunci dedupe UNIQUE; event `message`+`message.any`+retry menghasilkan satu baris).

**Atribusi tidak boleh menggagalkan inbox:**
1. Pesan tanpa sinyal iklan valid (atau flag MATI) tidak memakai transaksi sama sekali (jalur lama persis).
2. Insert touch berada di dalam `SAVEPOINT`; ditolak DB → `ROLLBACK TO SAVEPOINT`, pesan tetap commit (terhitung `gagal`).
3. Transaksi bermasalah (P2028/P2034/savepoint tak pulih) → pesan dibuat ulang tanpa transaksi, lalu touch dicoba sekali di luar jalur kritis (`dipulihkan` / `gagalPulih`).
4. Galat dari pesan sendiri (mis. P2002 = sudah ada) dilempar apa adanya → pemanggil `skip-dupe`, seperti sebelumnya.

**Status customer pada touch** (`customer_status_at_touch` + `customer_basis_at_touch`) memakai BUKTI KAUSAL, bukan heuristik waktu. Tanpa bukti = `UNKNOWN`, bukan `NEW`:

| Status / basis | Bukti | Efek pada laporan |
|---|---|---|
| NEW / WEBHOOK_MEMBUAT | tidak ada baris Customer saat handler webhook ini mulai (webhook yang membuat) dan belum ada pesan lain | lead iklan baru |
| NEW / CLID_COCOK | customer sudah ada tanpa pesan, tetapi `Customer.ctwa_clid` = clid payload ini (hanya jalur create webhook yang menulis clid) — mis. retry sesudah proses mati antara upsert customer dan commit pesan | lead iklan baru |
| EXISTING / RIWAYAT_PESAN | customer sudah punya pesan (masuk/keluar) | sentuhan berikutnya (bukan lead) |
| UNKNOWN / TANPA_BUKTI | customer sudah ada tanpa pesan dan tanpa clid cocok (dibuat manual / mulai-chat / B2B / jalur lain) | touch tercatat, TIDAK jadi lead iklan; `TOUCH_TANPA_BUKTI_AKUISISI` |
| UNKNOWN / TIDAK_KONSISTEN | "baru" tetapi `createdAt` jauh sebelum handler mulai, atau penentuan gagal | sama |

Jalur pembuat Customer yang diaudit: webhook inbound (`upsert`, satu-satunya yang mengisi `ctwa_clid`), webhook keluar fromMe (`upsert`, tanpa clid), `POST /customers` (manual), `POST /conversations/mulai-chat`, `POST /b2b/orders`, profil karyawan (PKR). Status TIDAK mengubah jumlah touch. Pesan paralel milik customer yang sama diserialkan oleh kunci baris customer (`FOR UPDATE`) di dalam transaksi pesan: tepat satu pemenang NEW.

**Observabilitas (agregat, tanpa identitas):** `GET /api/atribusi/iklan/kesehatan` — `proses`: direkam, duplikat, bukanTouch, gagal, fallbackTransaksi, dipulihkan,
gagalPulih, tertunda (+usia tertua detik), terakhirGagalAt (per proses; 0 saat restart); `db`: touch total/24 jam/7 hari, touch tertua/terbaru, kesegaran referensi,
`pendingPemetaan` (touch dengan Ad ID tanpa referensi + usia tertua). Log hanya KODE galat.

## 3. Aturan atribusi dan definisi yang dikunci

- **Atribusi utama hanya `CTWA_AD`.** `AD_REPLY_UNMARKED` direkam sebagai **audit** (blok `audit`), tidak pernah masuk lead/closing/grup; `sinyal=SEMUA` → 400.
- **Akuisisi** = touch CTWA valid *pertama* pada customer yang baru saat touch itu. Touch berikutnya/customer lama = `sentuhanBerikutnya` (bukan lead baru).
- **Closing utama (keputusan biaya)** = **customer yang memiliki ≥ 1 order eligible lunas TERBUKTI LEDGER** (`closingUtama.customerLunasTerbuktiLedger`).
  `customerDenganOrder`, `orderPernahDp`, dan `lunasMenurutCrm` tetap metrik terpisah; LUNAS historis tanpa ledger dan LUNAS-CRM berledger kurang BUKAN closing utama.
- **CPA/ROAS = `null`** (`penyebutCpa: closingUtama.customerLunasTerbuktiLedger`) sampai spend per Campaign ID dan tanggal direkonsiliasi.
- Tidak ada atribusi historis (1–9 Okt tidak diisi dari URL kreatif/berkas Fase 0); `attributionStartAt` + peringatan `RENTANG_SEBELUM_ATRIBUSI`.
- Enam Ad ID terverifikasi = fixture tes, bukan daftar permanen; iklan baru dipetakan lewat impor referensi tanpa perubahan kode.

## 4. Endpoint (semua ADMIN, `Cache-Control: no-store`)

| Metode & jalur | Fungsi |
|---|---|
| `GET /api/atribusi/iklan?dari=&sampai=&level=campaign\|adset\|ad&rincian=1` | laporan; **`dari` dan `sampai` WAJIB** (hari WIB), maks **93 hari**; satu perhitungan sekaligus (429) |
| `GET /api/atribusi/iklan/kesehatan` | agregat kesehatan capture (§2) |
| `GET /api/atribusi/iklan/referensi` | ringkasan referensi + Ad ID tak terpetakan |
| `POST /api/atribusi/iklan/referensi` | impor `{csv}` / `{rows}`; `dryRun` default true; konflik tidak menimpa |
| `GET /api/atribusi/iklan/ekspor-id[?format=csv]` | daftar ID tanpa data customer, untuk join dengan data spend |

## 5. Definisi metrik

| Metrik (kunci respons) | Definisi | Tanggal |
|---|---|---|
| `lead.unik` / `spam` / `bukanSpam` / `leadSah` | customer akuisisi iklan dengan `createdAt` di rentang; sah = bukan SPAM/B2B/staf/profil karyawan | `Customer.createdAt` (WIB) |
| `closingUtama.customerLunasTerbuktiLedger` | **customer** lead sah dengan ≥ 1 order eligible lunas terbukti ledger | hari lunas terbukti pertama (`perBulanLunasPertama`) |
| `closingUtama.orderLunasTerbuktiLedger` | order di balik closing utama (= `lunasTerbuktiLedger` kohort) | hari payment pelunas |
| `customerDenganOrder` | customer lead sah dengan ≥ 1 order eligible (bukan closing) | `Order.createdAt` |
| `orderEligible` / `bookedValue` | order bukan CANCELLED/PENDING/penjualan karyawan; Σ `Order.value` — bukan uang | `Order.createdAt` |
| `orderPernahDp` / `orderDpSaatIniLedger` | pembayaran ledger pertama < tagihan / ledger bersih di antara 0 dan tagihan | hari payment pertama |
| `lunasMenurutCrm` | `paymentStatus = LUNAS` tersimpan (indikator operasional) | `Order.paidAt` |
| `lunasTerbuktiLedger` / `buktiPelunasan` | ledger valid − refund disetujui ≥ tagihan; partisi terbukti/tanpa ledger/konflik | hari payment pelunas |
| `uangLedger` / `refundDisetujui` / `uangBersihLedger` | Σ payment valid (bukan dibatalkan, alokasi-sadar) | `Payment.createdAt` |
| `kematangan.hari7/30/60` | hasil DALAM N hari sejak tanggal lead, hanya lead berumur ≥ N hari (termasuk `customerLunasTerbuktiLedger`) | lead + N hari |
| `audit.adReplyTanpaPenanda` | touch `AD_REPLY_UNMARKED` (audit; `masukAtribusi:false`) | tanggal touch |
| `biaya.cpa` / `roas` | `null` | — |

Rekonsiliasi bawaan (16 pemeriksaan): Σ grup = gabungan untuk lead, customer, order, booked, lunas CRM, lunas ledger, closing utama, uang; closing utama ≤ customer dengan order;
order di balik closing = `lunasTerbuktiLedger` kohort Fase 1.

## 6. Validasi

| Lapis | Hasil |
|---|---|
| Unit (builder touch, atomik via db palsu, impor referensi, laporan, skrip rilis) | 82 (`atribusiTouchReferensi` 15, `atribusiTouchAtomik` 10, `atribusiIklanReport` 17, `releaseAtribusiIklan` 12, + Fase 0/1 terkait) |
| Integrasi PostgreSQL sekali pakai (migrasi dari nol) | `atribusiIklan` 17/17, `atribusiStatusCustomer` 8/8, `atribusiTouchCrash` 13/13 (7 titik statement + after-commit), `releaseAtribusiIklan` 4/4 (SMOKE_JS asli + UJI_SQL rehearsal 15 tolak/4 lolos pada DB termigrasi) |
| Crash SIGKILL pada tiap statement transaksi pesan (proses terpisah, router asli) | stmt:1..5 dan after-commit: tidak pernah Message tanpa touch; proses baru memulihkan TEPAT satu touch; customer lama / Ad ID belum terpetakan / flag MATI / dua event bersamaan |
| Fallback | trigger DB menolak insert (Message tetap commit); P2028/P2034 → dipulihkan atau gagalPulih |

**Performa** (data sintetis pada satu PostgreSQL lokal; 15 pengulangan + pemanasan; volume produksi 12 Okt 2026 = 9.657 customer, 693 order, 299 payment):

| Skala | Lead di rentang 93 hari | p50 | p95 | Rentang 7 hari p95 | Waktu kueri DB (total) |
|---|---|---|---|---|---|
| 1× | 3.360 | 360 ms | 634 ms | 87 ms | 78 ms |
| 3× | 10.086 | 989 ms | 1.107 ms | 141 ms | 215 ms |
| 10× | 33.618 | 3,2 s | 3,7 s | 326 ms | 753 ms |

Linear terhadap jumlah lead di rentang; kueri touch sendiri ≤ 44 ms pada 10×; sisanya komputasi kohort Node. Seq Scan dipilih planner (tabel kecil/rentang lebar); indeks
`(customer_id, touch_at)`, `(ad_id, touch_at)`, `touch_date_wib`, `dedupe_key` tersedia. Batas 93 hari menjaga p95 < 4 s sampai 10× volume.
Batas data uji: sintetis, satu instance lokal, tanpa trafik bersamaan; angka produksi nyata perlu dikonfirmasi pada `--verify-only` sesudah flag menyala.

## 7. Rilis (skrip `scripts/release-atribusi-iklan.sh`)

Gerbang berurutan: kunci deploy → disk ≥ 5 GiB → sumber (bundle git, tanpa push) + ancestry + allowlist + pin sha256 (kode, skema, migrasi) + pemindai DDL (+33 mutan) →
audit produksi (baseline = release aktif, flag MATI, objek rilis belum ada) → backup + checksum → release dir + build image → **rehearsal pada restore backup nyata**
(migrasi, struktur, 15 penolakan constraint/4 baris sah, sidik jari tabel lama identik, dihapus) → migrasi aditif produksi → switch SATU kali → verifikasi baca-saja
(RBAC, rentang wajib, rekonsiliasi, CPA/ROAS null, privasi, flag MATI, 0 touch, smoke inbox dari log + hitungan Message, 0 galat webhook).

Perintah (review; **tidak dijalankan di sini**): lihat kepala skrip. Mode: `--preflight-only`, rilis, `--verify-only`, `--rollback`.

**Menyalakan flag** (Owner, terpisah): urutan yang disarankan — (1) rilis dengan flag MATI; (2) impor referensi dry-run → commit; (3) ubah `backend/.env` + recreate backend;
(4) `--verify-only` + pantau `/kesehatan` 24–48 jam.

**Rollback:** `bash /tmp/atri2.sh <DEPLOY_SHA> <BASE_SHA> --rollback` — hanya kode (tag image sebelum rilis, recreate dari release sebelumnya); `.env` tidak disentuh;
**tiga tabel tidak dihapus** (kode lama mengabaikannya; touch yang sudah terekam tetap utuh); gerbang menolak bila release aktif bukan kandidat. Migrasi aditif tidak perlu di-undo.

## 8. Risiko sisa dan batasan jujur

1. **Ack-before-process (sudah ada sebelum Fase 2):** `res.sendStatus(200)` di awal handler → proses mati sebelum commit kehilangan pesan itu seluruhnya (tak ada retry WAHA);
   tak ada atribusi yang dapat mengatasinya. Mengubah ke ack-setelah-simpan adalah keputusan inbox terpisah (bukan bagian rilis ini).
2. **Insert touch ditolak DB di dalam transaksi** (constraint/trigger/disk) → pesan commit tanpa touch, tercatat `gagal`, tidak diulang. Tidak dapat terjadi karena kematian proses; praktis
   hanya bila skema berubah di luar rilis.
3. **Tidak ada atribusi historis:** pesan yang tersimpan sebelum flag menyala, dan pesan hasil sinkron riwayat (`autoSyncHistory`), tidak punya touch (disengaja).
4. **Referensi dapat basi:** iklan baru tampil `UNMAPPED` sampai referensi diimpor; tidak ada kredensial Marketing API di sistem ini.
5. **Pin skrip rilis Fase 0/1** (`release-ctwa-capture-flag-off.sh`: webhooks.js; `release-atribusi-kohort.sh`: index.js, cohortLoader.js) di-repin setelah perubahan ditinjau;
   allowlist keduanya tetap menolak skema/migrasi sehingga tidak dapat merilis Fase 2.
6. Performa linear terhadap lead di rentang (batas 93 hari); pertumbuhan ±100 customer/hari → 10× volume ±2,5 tahun.

## 9. Keputusan Owner (tertunda)

| Keputusan | Rekomendasi |
|---|---|
| Menyalakan flag capture touch (setelah rilis + impor referensi) | ya, setelah `--verify-only` lulus dan pemetaan enam iklan terisi |
| Sumber spend untuk CPA/ROAS | jembatan: join manual di Windsor lewat `ekspor-id`; target: spend per Campaign ID + tanggal direkonsiliasi, penyebut = closing utama |
| Ack webhook sesudah simpan (menutup kehilangan pesan saat crash) | evaluasi terpisah: dampak ke WAHA retry/duplikat harus diukur dulu |
