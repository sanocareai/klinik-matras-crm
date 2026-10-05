# Kandidat rilis gabungan — desain Meja/Corner/Dokumentasi + simplifikasi Production slice 1–3

Branch `release/production-simplifikasi-gabungan` (dari `7e116cec` + merge `origin/main` terbaru). **Belum deploy; tidak ada perubahan production, flag/cohort, atau data.** Dokumen ini = bukti kesiapan + keputusan GO/NO-GO.

## 1. Freeze production + origin/main, merge, audit overlap

| Fakta (dibaca langsung dari VPS, baca-saja) | Nilai |
|---|---|
| Production live | release `d13896a3`, image `c6e28c37b54a…`, restart 0, health OK |
| `origin/main` | `d13896a3` = **sama dengan live** |
| Migration applied di production | **216** (`_prisma_migrations`, dihitung aktual) |
| Flag V2 production | tidak disentuh: `production_v2_reader/writer` ON hanya untuk **1 unit** canary (0 Production Run); Delivery writer ON hanya 1 rute; selebihnya OFF |
| Pergerakan saat persiapan | `main`/live **bergerak dua kali** oleh sesi lain (`b8c1d018` → `db384528` → `d13896a3`); kandidat di-merge ulang tiap kali dan rehearsal diulang pada baseline terbaru |

**Merge:** `7e116cec` ← `origin/main` (2 kali, `--no-ff`). Rilis divisi lain yang **dipertahankan utuh** (semua ada di `main`, tidak ada konflik): Finance — guard Payment menunggu verifikasi (Penerimaan + Resi), skop akses data pembayaran Sales, Jumlah desimal Penjualan Karyawan (migrasi `20261016090000`); Inbox — perbaikan tab "Belum Dibalas" (backend + mobile). **Audit overlap:** 0 berkas bersinggungan kecuali `backend/prisma/schema.prisma` (auto-merge: Finance mengubah satu kolom, kami menambah satu model — saling bebas; `prisma validate` OK). Delta kode kandidat vs commit yang diuji (`0923a3d4`) = **tepat berkas `main`** (13 berkas src/prisma) **+ 1 berkas kami** (`ComponentNotesPanel.jsx`, fallback jujur) — dibuktikan dengan diff set-ke-set.

## 2. Runtime HEAD final vs `0923a3d4` yang diuji — dan gate yang diulang

HEAD final ≠ `0923a3d4` (merge `main` + fallback panel + skrip). Karena berbeda, **gate terdampak diulang pada image kandidat bersih** (`git archive` HEAD → image; frontend dibangun dari HEAD):

| Perubahan sejak `0923a3d4` | Gate yang diulang |
|---|---|
| Merge `main` (Finance/Inbox/Penjualan Karyawan; migrasi `…090000`) | unit backend, integrasi **penuh** (semua berkas), rehearsal restore, verifier |
| `ComponentNotesPanel` fallback (Mode Latihan/non-cohort) | tes frontend, QA browser Mode Latihan, lifecycle UI |
| Skrip/izin/rehearsal (tanpa kode produk) | tes skrip, matriks izin |

## 3. Peta kemampuan: unit COHORT vs NON-cohort (HTTP nyata pada image kandidat; flag tidak diperluas, tidak ada Run otomatis)

| Fitur | Unit cohort (Run V2) | Unit non-cohort (tanpa Run) |
|---|---|---|
| Unit Tiba di Workshop (satu aksi, lokasi bawaan) | ✔ | ✘ ditolak `404 CUSTODY_NOT_OFFERED_FOR_UNIT` — tidak membuat custody/Run. **Belum tersedia** untuk non-cohort. |
| Jadwal (rencana Meja/Corner) | ✔ (`/plans` + papan) | ✘ `404 PLAN_RUN_NOT_FOUND` — **belum tersedia** lewat alur baru. Jalur penjadwalan lama tidak diubah kandidat dan tidak diuji ulang di sini. |
| Diagnosis (tanpa pilihan layanan teknis) | ✔ | ✘ butuh Run V2. **Belum tersedia.** |
| Lewati Tahap | ✔ (adaptasi) | ✘ **Belum tersedia.** |
| Selesaikan Produksi (pratinjau + konfirmasi) | ✔ | ✘ **Belum tersedia.** |
| Lanjutkan / Tunda Pekerjaan | ✔ papan; alasan 4 pilihan | ✔ jalur unit (V1): satu aksi atomik; `409 UNIT_V1_STAGE_NOT_ASSIGNED` bila tak ada pekerjaan tertunda |
| Unit 360 | ✔ data lengkap | ✔ jalur fallback/V1 (overview V2 = 404 → tidak ada data V2 bocor) |
| Catatan Komponen Sebelum→Sesudah (baca) | ✔ | ✘ `404` (di luar cohort) |
| Catatan Komponen (tulis + foto) | ✔ | ✘ `503 COMPONENT_WRITER_OFF`, tanpa tulisan |
| Laporan before–after | ✔ blok komponen | — (tidak ada Run) |
| Simplifikasi slice 1 (status, prioritas, label, Order Produksi, Pekerjaan Tertunda) | ✔ | ✔ (berlaku untuk keduanya) |

Hasil uji: **16/16** (`rc-cohort-matrix`). Invarian: snapshot flag **identik**, **0** Production Run/custody baru, **0** catatan komponen untuk non-cohort. **Konsekuensi di production:** kohort aktual hanya 1 unit canary tanpa Run — hampir seluruh fitur V2 (arrival/jadwal/diagnosis/skip/selesai/komponen) **tidak aktif untuk unit nyata sampai Owner memperluas cohort** (keputusan terpisah, tidak dilakukan).

## 4. Izin komponen vs endpoint induk (HTTP nyata, 15 peran di `ROLE_PERMISSIONS`)

Tes `productionComponentPermissions.integration.test.js` memastikan untuk **setiap peran**: baca komponen = baca kartu run = baca Unit 360; tulis komponen = (tulis bukti tahap ATAU kirim dokumentasi); unggah komponen = (unggah bukti tahap ATAU dokumentasi); katalog = hanya penulis.

| Peran | Baca | Tulis | Unggah |
|---|---|---|---|
| **OWNER**, ADMIN (kontrak 65e7e1f5: `UNIT_STAGE_WRITE` + `PRODUCTION_EXECUTE_ANY` + `PRODUCTION_DOCUMENTATION_WRITE`) | ✔ | ✔ | ✔ |
| PRODUCTION_LEAD, PRODUCTION_WORKER, QC_LEAD, PRODUCTION_DOCUMENTER | ✔ | ✔ | ✔ |
| SALES, WAREHOUSE, DISPATCHER, FINANCE | ✔ | ✘ | ✘ |
| DRIVER, HELPER, LEADER_DRIVER, ACCOUNTANT, APPROVER | ✘ | ✘ | ✘ |

OWNER diuji identik dengan ADMIN pada semua pintu. **Lulus.**

## 5. Mode Latihan (browser, image kandidat, ADMIN, 390 light + 1440 dark)

**18/18.** Panel Catatan Komponen di Aplikasi Meja, Unit 360, dan Aplikasi Dokumentasi: tidak crash (0 pageerror), **tidak ada** tombol Isi/Koreksi/form/unggah, **0 request** tulis/unggah/komponen ke server selama Mode Latihan, dan menampilkan fallback jujur: *"Mode Latihan: catatan komponen belum punya data latihan — formulir dan unggah foto dinonaktifkan."* Unit non-cohort: *"…belum memakai alur kerja baru Production."* (dulu panel disembunyikan diam-diam). Dataset latihan belum memuat catatan komponen (di luar permintaan).

## 6. Migration pending AKTUAL + rehearsal restore production

Dihitung dari DB production vs sumber kandidat (bukan dari laporan lama): sumber kandidat **218**, applied production **216**, **pending = 2**:
`20261016100000_production_adaptation_slice2`, `20261017100000_production_component_notes_slice3` (keduanya aditif: 2 kolom nullable + 2 tabel baru; tanpa DROP/UPDATE/DELETE).

`scripts/rehearsal-restore-production.sh` dijalankan di VPS (production hanya dibaca): dump 28 MB (sha256 `75a18a51…`) → restore ke DB sementara (+ cocok 216 applied) → verifier **sebelum** (OK dengan 2 pengecualian historis terdokumentasi: `LID_ONE_LINE`, `CRLF_APPLIED` — bukan "tanpa drift") → `prisma migrate deploy` pada **salinan** (hanya 2 pending diterapkan) → verifier **sesudah** (218, pending −) → `migrate status` *up to date* → sidik jumlah baris **191 tabel**: hanya `_prisma_migrations` (+2) dan 2 tabel baru (0 baris) yang berubah; **tabel lama identik** → smoke baca-saja kode kandidat pada data nyata (papan, command center, andon, antrean, Unit 360, catatan komponen, backfill = 0) → cleanup (DB sementara dan dump dihapus) → **bukti production tidak berubah** (image/restart/release/applied/flag identik, health OK). Log: `~/rehearsal-logs/rehearsal-00b48b76-*.log` di VPS.
Preflight baca-saja `release-production-v2.sh` pada kandidat: ancestry langsung dari live, **scope = tepat 404 berkas** yang direview, migrasi baru aditif = 2 (applied pasca-switch = 218), package/compose/Dockerfile byte-identik.

## 7. Rollback — kode lama dapat salah membaca SKIPPED dan mengunci run adaptasi

**Prosedur production = rollback aplikasi saja; migration DIPERTAHANKAN** (aditif; kode lama mengabaikannya — teruji: `migrate deploy` kode lama pada DB lebih maju = "No pending migrations"). `DROP` hanya bukti teknis di rehearsal, **bukan prosedur**.

Risiko nyata (teruji di slice 2 dengan image kode lama pada salinan DB):
1. Tahap `SKIPPED` terbaca **dikerjakan** di kode lama (progres, KPI, laporan; pesan Sales bisa memuat "undefined").
2. Run adaptasi yang **gerbang QC-nya dicatat "tidak dilakukan"** terkunci di kode lama: tahap 12 ditolak `409 CUSTODY_QC_NOT_SATISFIED`, tanpa tombol Selesaikan Produksi.

**Prosedur pemulihan — tanpa menghapus catatan bisnis** (`backend/scripts/production-delivery-v2/adaptation-rollback-readiness.js`):
1. *Sebelum* rollback (dari image kandidat/terbaru): jalankan **tanpa argumen** (baca-saja) → daftar run adaptasi non-terminal + klasifikasi (`LOCKED_UNDER_OLD_CODE`, `HAS_SKIPPED_STAGES`, …); exit 1 bila ada yang akan terkunci.
2. Matikan mode adaptasi untuk run baru (Pengaturan › Alur Kerja).
3. Tutup run terkunci lewat **Selesaikan Produksi** (UI) atau `--finish --actor=<ADMIN/OWNER> --run=<id>` (pratinjau) lalu `--yes` — memakai command resmi `finishProduction` (idempoten): tahap sisa dicatat SKIPPED, QC "tidak dilakukan", **retur sisa bahan tetap wajib** (Gudang menerima dulu), satu handoff Delivery. Teruji pada staging: run terblokir retur → `completed:false`; setelah Gudang menerima → `COMPLETED`/`READY_FOR_DELIVERY`; panggilan ulang tidak menggandakan apa pun.
4. Ulangi langkah 1 sampai tidak ada `LOCKED_UNDER_OLD_CODE`, baru rollback aplikasi.
5. **Bila terlanjur rollback dengan run terkunci:** jangan hapus apa pun. Roll-forward ke kandidat lagi (migration masih ada) lalu langkah 3; atau QC resmi/waive oleh pihak berwenang di kode lama.
Saat ini di production: **0 run adaptasi** (mode adaptasi default OFF, cohort 1 unit tanpa Run) → rollback tidak mengunci apa pun *sampai Owner mengaktifkan adaptasi pada cohort*.

## 8. Regresi gabungan + QA lifecycle sederhana (image kandidat bersih)

| Gerbang | Hasil |
|---|---|
| Backend unit (`npm test`) | **1008/1008** (pada HEAD final) |
| Frontend | **635/635** (pada HEAD final) |
| Integrasi penuh (SEMUA 149 berkas `*.integration.test.js`, serial, satu DB terisolasi, tanpa beban lain) | **1327/1334 lulus; 7 gagal — SEMUA 7 gagal identik pada `origin/main` murni (`1a783034`, node_modules terpisah), jadi bukan dari kandidat: 0 kegagalan baru.** Lihat rincian di bawah tabel. |
| Mobile (`belumDibalasStore`) | **tidak dijalankan di sini** — dependensi `mobile/node_modules` (zustand) tidak terpasang pada worktree ini; berkas milik rilis Inbox di `main`, tidak diubah kandidat |
| Rehearsal restore production (VPS) | OK (lihat §6) |
| Matriks cohort/non-cohort | 16/16 |
| Matriks izin 15 peran | lulus |
| Mode Latihan (browser) | 18/18 |
| Lifecycle sederhana (UI + DB): Unit Tiba 1 klik → Lewati Tahap → Selesaikan Produksi → Siap Kirim | **14/14** — tanpa QC/custody palsu, stok tidak bergerak, tepat 1 job Delivery, selesai ulang ditolak, laporan QC "tidak dilakukan" |
| Mutasi sumber audit pembaca bukti (slice 3) | lulus |

**7 kegagalan integrasi — semuanya bawaan baseline (diverifikasi, bukan diasumsikan):**
| Berkas / tes | Di kandidat | Di `origin/main` murni |
|---|---|---|
| `exportKomplainAktif` — includeActiveComplaint | gagal | gagal identik |
| `financeFase1ResiInventory` — RESI satu Payment ke 3 child | gagal | gagal identik |
| `koreksiPembayaran` — 3 tes (Resi koreksi nominal, Blokir tambahan, paidAt Resi) | gagal | gagal identik (21/24 lulus di kedua sisi) |
| `productionPlanning` — 2 tes pertama | gagal **hanya** bila berjalan setelah `expenseSubmissionProduksiGudang` | gagal identik pada urutan yang sama; **lulus 15/15 bila berjalan sendiri**. Penyebab terbukti: berkas Finance meninggalkan `work_centers` kode `WC-1…`, tes planning memakai kode yang sama → `Unique constraint (code)`. Polusi lintas-berkas lama, bukan regresi. |

Penyebab empat kegagalan Finance/Orders (export komplain, Resi ×4) **belum dianalisis** (dugaan: bergantung jam/zona waktu karena dijalankan pukul 01–04 WIB — belum diverifikasi); itu area divisi Finance dan tidak disentuh. Berkas-berkas production yang menjadi cakupan kandidat (production*, unitCustody*, unitV1*, v1*, delivery lintas-batas) lulus penuh bila dijalankan sebagai kelompok (246/246 pada putaran slice 3 + berkas izin baru).

## 9. Keputusan

**GO-BERSYARAT** — kandidat **siap rilis secara teknis**; ini bukan perintah deploy. SHA kandidat: lihat commit terakhir branch (kode `backend/`, `frontend/src`, `prisma` identik dengan image yang diuji `d1977cae`; commit sesudahnya hanya dokumen). Syarat sebelum eksekusi:
1. **Freeze ulang di jam deploy**: `main`/live bergerak dua kali selama persiapan; jalankan `release-production-v2.sh --preflight-only` dan rehearsal lagi pada SHA kandidat terakhir (skrip menolak bila live/main berubah).
2. Rilis memakai skrip bergerbang (`release-production-v2.sh`: backup + verifikasi restore + pre-switch + rollback tag); jangan manual.
3. Pastikan **tidak ada** run adaptasi non-terminal sebelum rollback apa pun (§7).
4. Owner memutuskan terpisah: perluasan cohort (tanpa itu fitur V2 tidak aktif untuk unit nyata) dan pengaktifan mode adaptasi.

Risiko sisa yang **tidak** terbukti: keselarasan visual dengan mockup (tidak tersedia), perangkat fisik/login production nyata/kamera ponsel, tes mobile (dependensi). Perubahan yang terlihat semua pengguna begitu rilis aktif (tanpa cohort): label status/prioritas/menu slice 1, Pengaturan › Alur Kerja, tampilan Aplikasi Meja/Corner/Dokumentasi.
