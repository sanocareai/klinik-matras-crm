# Laporan performa Meta Ads per campaign (SANSS) — kandidat, BELUM rilis

Cabang `feat/iklan-performa-campaign` (di atas live `6d3c12dc` + gabung `feat/atribusi-fase2-touch-ad`). Tidak ada deploy, migrasi produksi, perubahan env, flag, campaign, atau budget.

## Yang dibangun
- **Endpoint** `GET /api/atribusi/iklan` (ADMIN, baca-saja, transaksi `READ ONLY`): `level=campaign|adset|ad`, drilldown `campaignId`/`adSetId`, `dari`/`sampai` (WIB, inklusif). **Tanpa rentang = 7 hari terakhir** (`rentangLead.bawaan=true`). Maks 93 hari, satu perhitungan sekaligus (429).
- **Tampilan** Laporan → tab "Iklan" (`IklanCampaignTab.jsx` + `iklanCampaignLogic.js`): tabel per campaign, klik baris → ad set → ad, filter umur kohort (semua / ≥7 / ≥30 / ≥60 hari), kartu cakupan, peringatan.
- **Kredit**: Ad ID string dari touch `CTWA_AD` dijoin ke referensi Ad→AdSet→Campaign **berdasar ID** (nama = label). Satu customer baru = tepat satu campaign akuisisi, dari touch kausal pertama (`NEW` dengan bukti `WEBHOOK_MEMBUAT`/`CLID_COCOK`). Touch berikutnya tidak menambah lead unik dan tidak mengambil kredit utama. URL postingan, teks chat, dan waktu pesan tidak pernah memberi kredit.

## Kolom per baris (selalu terpisah)
| Kolom | Arti |
|---|---|
| Lead unik / spam / bukan spam | customer baru dengan touch akuisisi terbukti; spam = label SPAM/B2B/staf/profil karyawan |
| Pernah ditandai prospek | tahap `PROSPECT` **manual** oleh sales (bukan bukti perilaku); dipecah berTanggal/tanpaTanggal |
| Customer ber-order / order eligible | order bukan CANCELLED/PENDING dan bukan penjualan karyawan |
| Order pernah DP | pembayaran pertama belum menutup tagihan |
| Lunas menurut CRM | `paymentStatus`/`paidAt` tersimpan di CRM |
| **Closing utama** | customer dengan ≥1 order eligible lunas **terbukti ledger** (`customerLunasTerbuktiLedger`) |
| Booked value | nilai order bersih (Order.value − nota kredit aktif) |
| Uang ledger + cakupan | Σ payment valid − refund disetujui; `persenOrderBerLedger` |
| Reaktivasi / assisted | touch iklan pada customer **lama** dan touch lanjutan — dihitung terpisah, bukan lead baru |
| Kematangan 7/30/60 | hanya lead berumur ≥N hari, hasil dalam N hari |

Baris tambahan di akhir: **UNMAPPED** (Ad ID belum ada di referensi) dan **UNKNOWN** (lead baru bertouch iklan tetapi tanpa bukti kausal). Rekonsiliasi (di respons, `rekonsiliasi.ok`): Σ baris campaign + UNMAPPED + UNKNOWN = jumlah tercakup; selisih terhadap semua label `META_ADS` di CRM dijelaskan di `rekonMetaAds` (akuisisi terbukti / touch tanpa bukti / customer sudah ada / tanpa touch iklan).

## Biaya (CPA/ROAS) — TIDAK dibangun (Tahap C)
Tidak ditemukan sumber otomatis yang sah di backend SANSS: tidak ada kredensial Meta Marketing API di env/repo, konektor Windsor di sesi ChatGPT/Claude bukan sumber backend, tidak ada impor spend. Karena itu `biaya = { status: "BELUM_TERHUBUNG", cpa: null, roas: null }` dan UI menulis "Belum tersambung". Tidak ada angka yang dikarang.

Opsi integrasi (tanpa CSV harian oleh owner), urut rekomendasi:
1. **Meta Marketing API langsung** (System User token read-only `ads_read`, insights level `ad` per hari, `account_id+ad_id+date`) via job terjadwal; butuh token dari owner Business Manager.
2. **Windsor.ai** — API/ekspor terjadwal ke endpoint/webhook SANSS (butuh API key Windsor di env backend; bukan konektor chat).
3. Fallback sementara: ekspor terjadwal Ads Manager ke email/Drive lalu pemuat otomatis (lebih rapuh).
Desain impor saat siap: tabel grain `account_id+ad_id+date` (spend, messaging conversations + definisi event, `synced_at`, attribution setting), upsert idempoten, backfill terbatas, cek total harian vs Ads Manager, agregasi Ad→AdSet→Campaign tanpa menjumlah reach unik; "messaging conversations" ≠ lead unik CRM. Setelah spend cocok: biaya/lead unik, /bukan spam, /prospek, /customer, /closing ledger; booked÷spend dan uang ledger÷spend **terpisah**; ROAS tidak ditandai terverifikasi bila periode revenue dan atribusi tak sebanding.

## Cakupan data nyata (Fase 0, agregat, sebelum touch aktif)
606 pesan `CTWA_AD`, 534 (88,1%) bersourceID valid, 10 Ad ID berbeda (6 sudah terverifikasi pada fixture referensi). Fase 2 **belum live** (tabel belum ada, flag tidak diset) → laporan nyata akan kosong (`ATRIBUSI_BELUM_MULAI`) sampai rilis, flag ON, dan Ad ID baru diimpor ke referensi.

## Uji
- Unit laporan 24/24; frontend logika 9/9; integrasi atribusi/CTWA/rilis 60/60 + 30/30 (termasuk tes HTTP drilldown, UNKNOWN, filter, read-only, default 7 hari).
- Cakupan skenario: idempotensi (dua event webhook), customer lama, multi-touch lintas campaign, spam, UNMAPPED, banyak order, DP/lunas lintas bulan, refund, ADMIN/SALES, READ ONLY.
- Performa (data sintetis, p50, 3 pengulangan; 1× = volume produksi 12 Okt): 7 hari 78 ms / 125 ms / 318 ms (1×/3×/10×); 30 hari 144 / 430 / 1208 ms; 93 hari 584 / 989 / 3431 ms. Ditemukan & diperbaiki loop kuadratik (`find` di dalam loop) yang membuat 10× > 65 dtk.
- Tidak dapat dilakukan: pencocokan satu Ad ID dan total harian dengan Ads Manager/Windsor (tidak ada akses; Windsor.ai MCP butuh autentikasi) — wajib dilakukan sesudah spend tersambung.

## Rilis (rencana, urutan)
1. Rilis backend memakai `scripts/release-atribusi-iklan.sh` (flag OFF; migrasi 3 tabel aditif kosong; skrip menolak perubahan `frontend/`). Deploy SHA = commit backend, bukan commit frontend.
2. Impor pemetaan Ad→AdSet→Campaign (`POST /api/atribusi/iklan/referensi`, `dryRun` default; ekspor ID `/ekspor-id`).
3. Nyalakan `ATRIBUSI_TOUCH_CAPTURE_ENABLED=true`; pantau `/api/atribusi/iklan/kesehatan`.
4. Rilis frontend (tab Iklan) lewat jalur rilis frontend terpisah (build `dist` di worktree bersih dari commit frontend).
5. Smoke: respons 200 tanpa rentang, `rekonsiliasi.ok`, tidak menulis. Rollback: matikan flag; kembali ke image/tag `pre-…` skrip rilis; tabel baru dibiarkan (aditif).
