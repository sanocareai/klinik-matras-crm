# P12A — Production–Warehouse Demo Mode & Persistent Staging

Status: dibangun di branch `feat/production-v2-demo-staging`. Tidak merge, tidak deploy, tidak ada perubahan flag/cohort/migration, tidak ada mutasi production.
Dasar (baseline live saat dibangun): `f0299482`.

## A. Mode Demo (Admin/Owner)
**Cara membuka:** login sebagai ADMIN/OWNER → buka salah satu halaman (Ringkasan, Status Produksi, Rencana Produksi, Quality Control, KPI Produksi, Aplikasi Dokumentasi,
Antrean Gudang) → centang **Lihat Data Demo**, atau tambahkan `?demo=1` pada URL.

| Kontrak | Implementasi |
|---|---|
| Hanya ADMIN/OWNER | izin baru `production_demo:view` (ADMIN, OWNER); server `GET /api/production-v2/demo/access` → 200 hanya untuk keduanya, peran lain 403, tanpa token 401. Non-admin + `?demo=1`: toggle tidak tampil, param dibuang, dataset tidak dimuat, endpoint tidak dipanggil. |
| Default OFF, tidak tersimpan | state di memori; tanpa localStorage/sessionStorage; `?demo=1` dibuang dari path tab tersimpan; logout/ganti halaman = demo mati. |
| Label | “MODE DEMO — bukan data operasional” pada banner atas dan lencana tetap di bawah layar (selalu terlihat, 1440 & 390). |
| Data sintetis di frontend | snapshot JSON (`frontend/src/features/production/demo/demoSnapshot.json`) hasil rekaman staging QA-PV2; chunk terpisah (dimuat `import()` hanya setelah server mengizinkan; tidak ada di bundel utama). Tidak ada tabel/DB. |
| Semua mutasi mati | (1) `api.js` → `demoGate`: non-GET ditolak SEBELUM jaringan; upload/export ditolak; (2) lapis jaringan `installDemoNetworkGuard` (fetch+XHR); (3) 51 tombol mutasi bertanda `data-mutates` dinonaktifkan (`DemoPage` + MutationObserver); (4) kartu tidak bisa diseret (drag-drop). |
| Tidak masuk KPI/export production | bacaan data Production dilayani dataset (tanpa request ke server); export diblokir selama demo; payload nyata tidak dicampur. |
| Foto | seluruh URL `/media/*` ditulis ulang ke 12 fixture lokal `/demo/photo-NN.png` (PNG sintetis); tidak ada URL customer production. |
| Tanggal | semua tanggal snapshot digeser ke “hari ini” (WIB) saat dimuat. |

**Dataset (12 unit, QA-PV2-U01…U12):** 3 belum dijadwalkan (1 dalam perjalanan, 2 tiba; prioritas normal/tinggi/mendesak), Meja 1–4 terisi, diagnosis belum lengkap, menunggu bahan,
sedang dikerjakan, menunggu QC, QC gagal/rework, Corner, menunggu retur (barang jadi tertahan), siap kirim; dokumentasi lengkap (1) dan kurang (11). Kartu memuat customer dummy, nomor
order/resi, foto, layanan Sales, layanan teknis, request Sales, PIC, meja, prioritas, target, progres, status bahan/QC/retur/dokumentasi. (Status Produksi menampilkan 11 di pipeline;
unit ke-12 yang selesai hari ini tampil di Ringkasan/Dokumentasi/Gudang — perilaku produk yang ada.)

## B. Persistent Staging
**Arsitektur isolasi** (`docker-compose.staging.yml`, project `sanss-staging`):
- DB sendiri `postgres-staging` (`sanss_staging`, user `qa_pv2`, volume `pgdata_staging`, tanpa port ke host); media `uploads_staging`/`data_staging`; port host `127.0.0.1:${STAGING_PORT:-18080}` lewat `edge-staging` (nginx).
- Jaringan `staging_internal` **`internal: true`** — backend & DB tidak punya rute keluar (terbukti: koneksi TCP/DNS keluar dari container gagal `ENETUNREACH`/`EAI_AGAIN`). Hanya `edge-staging` yang punya jaringan luar (untuk port lokal).
- Tidak ada layanan WAHA; env staging (`backend/.env.staging`, tidak di-commit) tanpa kredensial eksternal; flag V2 terpisah (di DB staging).
- Lapis aplikasi (`backend/src/lib/stagingGuard.js`, aktif hanya bila `APP_ENV=staging`; no-op di production): menolak `DATABASE_URL` yang bukan staging/qa/test (nama `klinik_matras` ditolak), memblokir egress `fetch`/`http(s)`/`net` ke host publik, membuang variabel kredensial eksternal, mematikan semua job latar & worker pengirim (WA/broadcast/rekap/alert). Outbox tanpa consumer eksternal (semua baris PENDING).
- Audit statis (tes): daftar tertutup modul outbound; modul baru yang bisa menjangkau jaringan luar membuat tes gagal sampai ditinjau.

**Akun staging** (peran; password acak per-akun tersimpan di `data/qa-pv2-credentials.json` mode 0600 di volume staging, tidak pernah dicetak/di-commit; `--rotate-passwords` untuk rotasi):
`qa-pv2-owner` (OWNER), `-admin` (ADMIN), `-lead` (PRODUCTION_LEAD), `-meja1..4` (PRODUCTION_WORKER = Operator Meja), `-corner1..2` (PRODUCTION_WORKER = PIC Corner), `-qc` (QC_LEAD), `-gudang` (WAREHOUSE), `-dokumentasi` (PRODUCTION_DOCUMENTER), `-driver`, `-sales_*` — semua `@staging.invalid`.

**Perintah** (dijalankan di container staging; semuanya `assertQaPv2Safe()` lebih dulu — hanya `APP_ENV=staging|test` dan DB bertanda staging/qa/test; production → kode keluar 2 sebelum query):
```
docker compose -f docker-compose.staging.yml --env-file backend/.env.staging up -d --build
docker compose -f docker-compose.staging.yml --env-file backend/.env.staging exec -T backend-staging node scripts/staging/qa-pv2.js seed
  … qa-pv2.js master | unit --stage=<perjalanan|tiba|diagnosa|bahan_kurang|fondasi|lapisan|menunggu_qc|qc_gagal|corner|menunggu_retur|siap_kirim> | lifecycle | status | reset --yes
  … export-demo-snapshot.js > frontend/src/features/production/demo/demoSnapshot.json
```
- Prefix `QA-PV2` pada user/customer/order/unit/bahan/work center/gudang/lokasi; seed idempoten (ensure-by-code; unit yang ada dilewati); perubahan produksi lewat endpoint command ASLI (bukan SQL).
- `reset --yes`: menolak bila ada data non-QA-PV2; TRUNCATE tabel non-baseline (tabel baseline hasil migrasi tidak disentuh; baris ber-prefix pada tabel yang direferensi baseline dihapus per-prefix); file media staging dihapus.
- Lifecycle end-to-end: `lifecycle` / `unit --stage=…` menjalankan pickup → tiba → rencana meja → diagnosis/BOM → issue bahan → proses → QC (lulus/gagal-rework) → Corner → retur sisa → barang jadi diterima.

**URL staging:** `http://127.0.0.1:18080` (hanya lokal; header `X-Environment: staging (QA-PV2)`, `noindex`). Frontend dev terhadap staging: `VITE_API_BASE=http://127.0.0.1:18080 npx vite`.

## C. Bukti
- Tes backend: `stagingIsolation` (9), `qaPv2Staging.integration` (6: akun/prefix/idempoten, matriks 12 unit lewat jalur tulis asli, lifecycle, akses demo server, penjaga bentuk payload snapshot = payload nyata, reset aman), audit writer 0 pelanggaran.
- Tes frontend: `demoMode` (9) + KPI (9) + regresi menu/route.
- Visual QA (staging + Vite, Admin/Owner): 7 halaman × 1440 terang / 1440 gelap / 390 = label terlihat, tanpa overflow, tanpa gambar rusak, tanpa error console/network; demo tanpa request data ke server; 0 request non-GET; klik paksa pada semua tombol mutasi & drag-drop tidak menghasilkan mutasi; non-admin tidak membocorkan dataset; demo tidak lintas logout.
- Production tidak berubah: tidak ada baris QA-PV2 (user/unit/order/customer = 0), `production_runs_v2` tetap 565, 0 baris `DOC_*`, flag 8, tidak ada container staging di VPS; tidak ada deploy/migration.
- Perbaikan sampingan: tab KPI Produksi tidak merespons klik di sistem tab dalam-app dan akan crash bila data tab sebelumnya masih ada → state tab lokal + panel hanya dirender bila jenis dokumen = jenis tab; Ringkasan Produksi kini mengizinkan OWNER.

## Gap / catatan
- Snapshot demo perlu direkam ulang (`export-demo-snapshot.js`) bila bentuk payload berubah; tes “penjaga bentuk” gagal bila kunci payload menyimpang.
- Staging belum dipasang di VPS (hanya lokal/Docker Desktop); memasang di VPS = keputusan terpisah (port, TLS, akses).
- Blocker Finance `PERSEDIAAN_AWAL_BELUM_DIPOSTING` tidak tersentuh (tanpa HPP/finance di demo/staging).
