# Audit kesiapan rilis capture CTWA Fase 0 — backup, disk, snapshot, diff

Tanggal audit: 10 Okt 2026 (waktu server CST/UTC+8). Seluruh pemeriksaan **baca-saja**. Tidak ada isi DB, payload, berkas capture, atau secret yang dibaca atau dicetak; nilai env hanya dihitung (`grep -c`).
Baseline live saat audit: release dir `934142cd`, image `f35df5b6c48a`.

## 1. Backup DB harian — bukti

**Status backup harian terjadwal (`backup-database.sh`): TIDAK BERJALAN** (terbukti untuk jendela syslog 4–10 Okt; bukti keberhasilan terakhir 23 Sep lokal, 27 Sep di remote).
**Status snapshot seluruh VPS oleh penyedia: UNKNOWN** (tidak bisa dilihat dari VM; lihat bagian 4).

| Sumber yang diperiksa | Hasil |
|---|---|
| `crontab -l` user `ubuntu` | hanya `canary-monitor.sh` (tiap 10 menit) dan satu monitor `p7b` (jendela 29 Sep, sudah lewat) |
| crontab root (`sudo -n`, akses resmi tersedia) | satu baris: `qcloud/stargate/admin/start.sh` (agen Tencent Cloud) |
| `/etc/crontab`, `/etc/cron.d/*` | `certbot`, `e2scrub_all`, `sysstat`, `sgagenttask` + `yunjing` (agen Tencent Cloud). Tidak ada backup/pg_dump/rclone |
| `/etc/cron.daily` dan `/etc/cron.weekly` | paket OS standar (`apport`, `dpkg`, `logrotate`, `man-db`, `sysstat`) |
| systemd timer | hanya `dpkg-db-backup.timer` (cadangan database **paket apt**, bukan Postgres) |
| Layanan cron | `active` |
| syslog (mulai 4 Okt 00:00) | cron menjalankan `stargate` 10.424×, `canary-monitor` 868×, `sysstat` 869×, `YDCrontab` 289×; **0 entri `backup-database`, `pg_dump`, atau `rclone`** |
| `journalctl -u cron` 7 hari | 0 entri `backup-database` |
| `BACKUP_NOTIFY_PHONE` di `.env` | tidak ada (alert gagal-backup tidak akan terkirim) |
| `~/klinik-matras/backups/klinik_matras_backup_*.sql.gz` (hasil skrip harian) | 3 berkas: 22 Sep 01:48, 23 Sep 02:06, 23 Sep 02:40. Tidak ada `backup.log`. Itu pun terjadwal pukul 01–02, bukan 03:00 → kemungkinan dijalankan manual |
| Remote `gdrive:klinik-matras-backups/` (daftar metadata, 11 objek) | terbaru **27 Sep 02:31** (`prerelease_dcfinal`); sebelumnya 26 Sep, 23 Sep |
| `~/backups/pre-*.sql.gz` (dari skrip rilis) | 137 berkas, 3,5 GB, terbaru 9 Okt 23:12 (±30 MB, tervalidasi). **Di disk yang sama dengan DB** |

Kesimpulan:
- Salinan DB yang terbukti ada **hanya dua jenis**: dump pra-rilis di VPS yang sama, dan salinan Google Drive terakhir pada 27 Sep (±13 hari lalu). Tidak ada salinan harian offsite sejak 27 Sep.
- Bila disk atau VPS rusak, data setelah 27 Sep hanya dapat dipulihkan dari snapshot penyedia (UNKNOWN). Ini temuan terpisah dan lebih penting daripada rilis CTWA; **jangan diabaikan**.
- Cron tidak dapat membuktikan bahwa tidak ada backup lewat jalur lain (mis. TAT, snapshot penyedia). Karena itu kesimpulan hanya berlaku untuk "backup harian dari skrip repo".

Catatan transparansi: perintah `rclone lsl` memicu rclone memperbarui token OAuth sehingga `~/.config/rclone/rclone.conf` berubah mtime-nya (10 Okt 00:47). Isinya tidak dibaca atau dicetak; ini efek samping bawaan rclone, bukan perubahan konfigurasi.

## 2. Inventaris disk dan image Docker (tidak ada yang dihapus)

Disk `/` (`/dev/vda2`) 99 GB. Angka bergerak: 6,0 GB bebas (94%) pada 9 Okt ±15:20 UTC, 9,3 GB bebas (91%) pada 10 Okt ±00:50 CST — ada aktivitas lain di VPS (bukan dari audit ini).

| Konsumen | Ukuran |
|---|---|
| `~/klinik-matras/backend/uploads` (media WhatsApp) | 34 GB |
| Image Docker (118 image) | 25,6 GB, **13,9 GB reclaimable (54%)** |
| Build cache Docker | 10,3 GB (273 MB reclaimable) |
| `~/backups` (137 dump pra-rilis) | 3,5 GB |
| `~/releases` (4 release dir) | 2,2 GB |
| Volume Docker (3) | 3,8 GB; DB `klinik_matras` 441 MB |
| `~/release-src`, `~/release-backups`, `~/klinik-matras/backups`, `backend/data` | 441 MB, 306 MB, 192 MB, 357 MB |

Biaya rilis kandidat ini: layer image baru ±100 MB (`COPY .` 18 MB + `prisma generate` 84 MB; `npm ci` 483 MB ter-cache), `dist` 48 MB, DB sementara verifikasi restore ±450 MB (dihapus sesudahnya). Total kurang dari 1 GB.

### Klasifikasi image (118 ID unik; ukuran = UNIQUE, yang benar-benar dibebaskan)

| Kelompok | Jumlah | UNIQUE | Tindakan |
|---|---|---|---|
| Dipakai container aktif (`backend:latest`, `waha`, `postgres:16-alpine`) | 3 | 4,62 GB | **Jangan disentuh** |
| Target rollback rilis yang release dir-nya masih ada (`rollback-pre-pkroc-934142cd`, `-sku-d4426006`, `-ppd-2a5ab783`, `-rdwa-b3c5502d`) | 4 | 0,53 GB | **Simpan** (rollback rilis aktif = `rollback-pre-pkroc-934142cd`, ID `18c6080b72f6`) |
| Rollback < 3 hari | 18 | 2,07 GB | Simpan |
| Rollback 3–7 hari | 21 | 1,78 GB | Tahap 2 (opsional) |
| **Rollback ≥ 7 hari** | **70** | **9,38 GB** | **Tahap 1 (usulan)** |
| `release-f0e15cd5`, `alpine:latest` | 2 | 0,13 GB | Tinjau pemilik |
| Dangling (`<none>`) | 0 | 0 | — |

Sebelum menghapus, ingat: image `rollback-*` hanyalah kemampuan rollback **kode** cepat. Rollback ke rilis yang sudah lebih dari seminggu yang lalu, praktisnya, dilakukan dengan build ulang dari git (release dir/commit), bukan dari image lama.

### Usulan pembersihan aman (BELUM DIJALANKAN — butuh persetujuan pemilik)
Syarat: tidak ada rilis berjalan (kunci `/tmp/release-*.lock` bebas), live sehat, backup DB segar tersedia.
1. Simpan snapshot daftar tag dulu: `docker images --format '{{.ID}} {{.Repository}}:{{.Tag}} {{.CreatedAt}}' > ~/release-backups/images-before-<tgl>.txt`.
2. Hapus **per tag**, bukan `prune`: `docker rmi klinik-matras-backend:rollback-<nama>` untuk setiap baris Tahap 1 (lampiran). `docker rmi` menolak image yang dipakai container, dan hanya menghapus tag bila image punya tag lain. **Jangan** `docker image prune -a`, `docker system prune`, atau `docker builder prune`.
3. Per 10 tag: `df -h $HOME` dan `curl -fsS http://127.0.0.1:4000/api/health`. Berhenti bila ada keanehan.
4. Perkiraan bebas: ±9,4 GB (Tahap 1), ±11,2 GB bila Tahap 2 ikut. Disk bebas akan naik dari ±9 GB ke ±18–20 GB.
5. Jangan menyentuh `uploads` (34 GB, satu-satunya salinan media), dump `~/backups` (kecuali setelah ada salinan offsite), image `waha`/`postgres`.

Usulan lain di luar image (keputusan pemilik): memindahkan `uploads` atau dump lama ke penyimpanan lain, dan **mengembalikan backup DB harian offsite** (bagian 1) — itu lebih mendesak daripada ruang disk.

## 3. Jalur log legacy ctwaClid

Sudah diperbaiki dan diuji pada kandidat (commit `adad0d24` untuk log 16 karakter, `f7c9a434` untuk `ctwaDetail`/Lapis 2). WEBHOOK_DEBUG: **tidak aktif** di container maupun `.env` live (0 dari 0 baris).

## 4. Yang perlu dicek di konsol Tencent Cloud (tanpa menyimpulkan dari data VM)

Hostname `VM-17-158-ubuntu` dengan agen `barad_agent`, `tat_agent`, `YDService` menunjukkan instance Tencent Cloud (CVM). Agen-agen itu **bukan bukti snapshot**. Snapshot dikelola di konsol, tidak terlihat dari dalam VM. Tulis jawaban pada tabel di bawah; nama menu dapat berbeda antar versi konsol.

| # | Periksa | Lokasi (perkiraan) | Catat |
|---|---|---|---|
| 1 | Identitas instance: region/zone, Instance ID, nama `VM-17-158-ubuntu`, IP 43.133.152.6 | CVM → Instances | ID instance, ID disk sistem dan data |
| 2 | Disk apa saja yang terpasang dan ukurannya. VM hanya memetakan `/dev/vda2` (99 GB) ke `/` — apakah **semua data (Docker, uploads, Postgres) ada di disk sistem** ini, atau ada disk data terpisah | CVM → Instance → Cloud disks (CBS) | Daftar disk; disk mana yang menampung `/var/lib/docker` dan `/home` |
| 3 | Kebijakan snapshot terjadwal | CBS → Snapshots → *Scheduled snapshot* (policy), atau Backup Center | Ada/tidak kebijakan; **disk yang terhubung ke kebijakan** (harus mencakup disk sistem); frekuensi; jam; retensi (hari/jumlah); status aktif |
| 4 | Daftar snapshot yang benar-benar ada | CBS → Snapshots | Waktu snapshot terbaru, ukuran, status `Normal`, apakah terjadwal atau manual, cakupan disk |
| 5 | Kuota snapshot dan penagihan | CBS → Snapshots → quota; Billing | Apakah ada tagihan snapshot (bukti ada), kuota tersisa |
| 6 | Salinan lintas region | Snapshot → Copy | Ada/tidak |
| 7 | Eksekusi otomasi (TAT) | TAT → *Command invocation history* | Apakah ada perintah backup/`pg_dump`/`rclone` yang dijalankan lewat TAT (tidak tampil di cron) |
| 8 | Backup/Object storage lain | COS (bucket), Cloud Backup / Backup Center | Ada bucket/rencana backup yang dipakai proyek ini |
| 9 | Uji pulih | Buat disk sementara dari snapshot terbaru (di sandbox, bukan produksi) | Apakah bisa dibuat; ada isi `postgres` dan `/home/ubuntu/klinik-matras` |
| 10 | Alert backup | Monitoring/Cloud Monitor | Apakah ada alarm bila snapshot gagal |

**Aturan penarikan kesimpulan:**
- Status **YES** hanya bila #3 dan #4 menunjukkan kebijakan aktif yang menaungi disk yang berisi `/home/ubuntu/klinik-matras` dan snapshot terbaru di dalam retensi.
- Status **NO** hanya bila #3, #4, #7, dan #8 semuanya kosong.
- Selain itu: **UNKNOWN** (laporkan apa adanya).
- Untuk capture CTWA: bila snapshot ada, berkas capture ikut tersalin di luar retensi 7 hari. Isinya ter-sanitasi (hash, tanpa data pribadi), jadi dapat diterima, tetapi pemilik harus memutuskannya secara sadar.

## 5. Tinjauan diff kandidat terhadap baseline live

Kandidat: 5 commit fitur + skrip rilis + tes skrip, di atas `934142cd`. Dihitung dengan `git diff --numstat 934142cd`:

| Kategori | Berkas | Tambah | Hapus |
|---|---|---|---|
| Modul capture baru (runtime) | `ctwaCapture.js` 714, `ctwaCaptureAnalysis.js` 195 | 909 | 0 |
| Skrip operasional baru | `ctwa-capture-report.js` 59, `ctwa-capture-purge.js` 21 | 80 | 0 |
| Skrip rilis | `release-ctwa-capture-flag-off.sh` | 327 | 0 |
| Tes baru | `ctwaCapture.test.js` 682, integrasi 214, `releaseCtwaCapture.test.js` 71 | 967 | 0 |
| Tes existing (ditambah) | `leadAttribution.test.js` | 48 | 0 |
| Dokumen | `CTWA-CAPTURE-PHASE0.md` 200 (+ dokumen ini) | 200+ | 0 |
| Konfigurasi (dokumentasi/ignore) | `.gitignore` +3, `.env.example` +10 | 13 | 0 |
| **Kode existing yang diubah** | `webhooks.js` (+18/−5), `leadAttribution.js` (+30/−3) | **48** | **8** |

Hanya modul baru, tes, skrip, dan dokumen yang bertambah; tidak ada perubahan skema, migrasi, dependensi, compose, atau frontend (dijaga allowlist skrip rilis). Perubahan pada kode existing, seluruhnya:

| # | Berkas | Perubahan | Jenis | Dampak perilaku |
|---|---|---|---|---|
| 1 | `webhooks.js` | log Lapis 0b: `clid: <16 karakter>` → `clid: ada/tidak ada` | sanitasi log | hanya format log |
| 2 | `webhooks.js` | Lapis 2 legacy: `JSON.stringify(ctwa).slice(0,200)` → `legacyAdContextDetail(ctwa)` | sanitasi detail | `leadSourceDetail` untuk jalur legacy berubah (jalur belum pernah teramati di payload GOWS) |
| 3 | `leadAttribution.js` | `ctwaDetail()` membuang query/fragment dari `sourceUrl` | sanitasi detail | **perubahan perilaku existing (jalur live):** teks `leadSourceDetail` lead CTWA **baru** tidak lagi memuat `?param=…` dan slash akhir. Efek ke laporan "Rincian per Iklan" (grup per teks `leadSourceDetail`): lead baru dengan URL kreatif yang sama tetapi query berbeda kini jatuh ke **satu** grup, sedangkan lead lama tetap di grup lama (terpisah). `platformDariDetail` tidak terpengaruh (mengandalkan domain/kata platform). Atribusi (`leadSource`) tidak berubah |
| 4 | `webhooks.js` | `captureInbound(...)` setelah `Message.create` di jalur `saved` | **fitur baru (di luar sanitasi)** | Flag OFF: satu pembacaan env + satu perbandingan tanggal per pesan; **sekali per hari-UTC** menjalankan `purgeCaptures()` → `readdir` pada `backend/data/ctwa-capture` (tidak ada → ENOENT → selesai; tidak membuat folder). Tidak ada `setImmediate`, tidak ada tulis, tidak ada log. Dibungkus try/catch dan tidak di-await |
| 5 | `webhooks.js` | `handleInboundMessage` menerima `event`, `engine`; pemanggilnya meneruskan | plumbing | tidak ada |
| 6 | `webhooks.js` | `import { captureInbound }` | plumbing | modul `ctwaCapture.js` ikut dimuat saat start (hanya `crypto`, `fs`, `path`, `url`, `idPesanWa.js`; tidak ada jaringan) |

Butir 4 adalah satu-satunya perubahan perilaku di luar sanitasi, dan sengaja: itulah fitur capture. Butir 3 perlu diketahui tim laporan.

## 6. Lampiran: daftar image (hasil `docker system df -v` + `docker images`, baca-saja)

Format: `ID  UNIQUE  umur  tag`. Daftar ini adalah **usulan**, bukan instruksi hapus.

```

# TAHAP 1: rollback >= 7 hari — 70 image, UNIQUE 9.38 GB
095f76eadf5d  114MB 2 weeks ago   klinik-matras-backend:rollback-pre-a8ca7c6f
ed4a4a0fe4b8  803MB 2 weeks ago   klinik-matras-backend:rollback-pre-f0e15cd5
559d3a10bf49  805MB 13 days ago   klinik-matras-backend:rollback-pre-dcfinal-272392ba
f58d85136794  117MB 12 days ago   klinik-matras-backend:rollback-pre-b37-248bb039
828845e8c33c  116MB 12 days ago   klinik-matras-backend:rollback-pre-p3-8ad9a725
68c4f5cfbb2b  116MB 12 days ago   klinik-matras-backend:rollback-pre-custody-e4cbfcb1
d8f3ba20f5af  116MB 12 days ago   klinik-matras-backend:rollback-pre-avatar-69c1741c
012442d72c00  116MB 12 days ago   klinik-matras-backend:rollback-pre-87bbba36
727715a8a1c6  116MB 12 days ago   klinik-matras-backend:rollback-pre-ukuran2-e1c85b37
fc691b3dd590  116MB 12 days ago   klinik-matras-backend:rollback-pre-a96acc3e
fb40a71add2d  116MB 12 days ago   klinik-matras-backend:rollback-pre-ukuran-fc329ab2
cb03b73dd188  115MB 12 days ago   klinik-matras-backend:rollback-pre-resi2-cb0c6c2e
6de9536fdd47  115MB 12 days ago   klinik-matras-backend:rollback-pre-414e68a7
b33f73db4f1f  118MB 11 days ago   klinik-matras-backend:rollback-pre-hotfix-failclosed-b9da5705
1083e2a1badd  117MB 11 days ago   klinik-matras-backend:rollback-pre-p456-2644f175
8eec3ce911ce  120MB 10 days ago   klinik-matras-backend:rollback-pre-finhv-2b9b9746
75f9ab3eda93  120MB 10 days ago   klinik-matras-backend:rollback-pre-finhv-991907e1
8b7047106aa7  119MB 10 days ago   klinik-matras-backend:rollback-pre-p9b-46590e68
39adf58e7151  809MB 10 days ago   klinik-matras-backend:rollback-pre-p9a-62a207a6
977400a35b7d  119MB 10 days ago   klinik-matras-backend:rollback-ca0b112d,klinik-matras-backend:rollback-pre-p82ui-fe438058
dc57ec0a04a4  119MB 10 days ago   klinik-matras-backend:rollback-pre-finhv-ca0b112d
8619241b7fe5  119MB 10 days ago   klinik-matras-backend:rollback-pre-p8-794d7fa0
eb526c17bf6e  118MB 10 days ago   klinik-matras-backend:rollback-pre-finb38-9181d484
ae64672df59f  120MB 9 days ago    klinik-matras-backend:rollback-pre-klg-c2fbdcfe
070d0ad3e98c  120MB 9 days ago    klinik-matras-backend:rollback-pre-finhv-d5eb8221
5f0fd67f597a  120MB 9 days ago    klinik-matras-backend:rollback-pre-finhv-305d394a
d6c964ef0340  120MB 9 days ago    klinik-matras-backend:rollback-pre-finhv-eea2dc01
ac7ee6c5ac89  120MB 9 days ago    klinik-matras-backend:rollback-pre-finhv-921c8021
5ce94a59427e  120MB 9 days ago    klinik-matras-backend:rollback-36ee5e02
a26a80430d22  120MB 9 days ago    klinik-matras-backend:rollback-pre-finhv-36ee5e02
1a7046df55e9  120MB 9 days ago    klinik-matras-backend:rollback-pre-finhv-f201c4dc
e551934ff357  120MB 9 days ago    klinik-matras-backend:rollback-pre-finhv-3823c8a0
3dc027c16bf0    0MB 9 days ago    klinik-matras-backend:rollback-a4b2ea34
a462a66b1510    0MB 9 days ago    klinik-matras-backend:rollback-a90565ba
d3f2d83dabeb    0MB 9 days ago    klinik-matras-backend:rollback-f3de49b7
08c60908a54b    0MB 9 days ago    klinik-matras-backend:rollback-pre-p9c-7afc1709
c29011acf0da    0MB 9 days ago    klinik-matras-backend:rollback-018bc41e
7cdf81a2e2e8    0MB 9 days ago    klinik-matras-backend:rollback-deff1adb
169b29348fa2    0MB 9 days ago    klinik-matras-backend:rollback-f7a6b2ef
ae348fc45849  120MB 9 days ago    klinik-matras-backend:rollback-1802d743
ce0d07a128e1  120MB 9 days ago    klinik-matras-backend:rollback-pre-p9b1-1802d743
36f2beb3cfc8  120MB 9 days ago    klinik-matras-backend:rollback-pre-finhv-6819ae4d
03df578e4805  120MB 9 days ago    klinik-matras-backend:rollback-pre-finhv-9aa2b160
7d0b5aad8597  123MB 8 days ago    klinik-matras-backend:rollback-pre-p111-2c4909ad
973e6decdee5  123MB 8 days ago    klinik-matras-backend:rollback-pre-msg-a0804231
ac95aa6a91aa  123MB 8 days ago    klinik-matras-backend:rollback-pre-p11-0d298922
f3d3ef12dc01    0MB 8 days ago    klinik-matras-backend:rollback-pre-pk-4348787e
4a308c4c4818    0MB 8 days ago    klinik-matras-backend:rollback-pre-kdp-b05d03a9
e1597733957b  122MB 8 days ago    klinik-matras-backend:rollback-pre-p10b-ae9e65d4
0f68ebcf8afa  122MB 8 days ago    klinik-matras-backend:rollback-pre-p10a-f9b10d22
454224adbc96  121MB 8 days ago    klinik-matras-backend:rollback-pre-ff2-f9f0bba9
d109d27c5714  121MB 8 days ago    klinik-matras-backend:rollback-pre-fx-e2d733d2
ba4d8e251619  121MB 8 days ago    klinik-matras-backend:rollback-pre-fs-70e3b61c
1da812700702  121MB 8 days ago    klinik-matras-backend:rollback-pre-pv2sf-c29d949b
d062a8112218  121MB 8 days ago    klinik-matras-backend:rollback-pre-f1-d27802dc
04afdddefd63  121MB 8 days ago    klinik-matras-backend:rollback-pre-pv2fix-999a8fdb
a1b70ce7cae3  121MB 8 days ago    klinik-matras-backend:rollback-pre-klg-dd5d665e
159119bfee93  121MB 8 days ago    klinik-matras-backend:rollback-pre-p9dux-b8f47557
e401ac7b4274  121MB 8 days ago    klinik-matras-backend:rollback-pre-klg-732379c0
152f23070e04  121MB 8 days ago    klinik-matras-backend:rollback-pre-klg-58898305
58af221f473c  121MB 8 days ago    klinik-matras-backend:rollback-c2fbdcfe
823650fc23c2  127MB 7 days ago    klinik-matras-backend:rollback-pre-pbr-6c0e7944
da28ea313f6e  127MB 7 days ago    klinik-matras-backend:rollback-pre-pbr-605a20db
8905502bd8c4  125MB 7 days ago    klinik-matras-backend:rollback-pre-pbr-461c14bc
870ca6e856af  124MB 7 days ago    klinik-matras-backend:rollback-pre-ppl-60f2a33a
83fcf0ec214f  124MB 7 days ago    klinik-matras-backend:rollback-pre-p12a1-d61ae2d7
e1be7883e0cb  124MB 7 days ago    klinik-matras-backend:rollback-pre-p12a-17f34317
01eb3e8289ea  124MB 7 days ago    klinik-matras-backend:rollback-pre-pkm-a495f950
b33d936aee69  123MB 7 days ago    klinik-matras-backend:rollback-pre-pkm-49b7c446
104f15f28dcd  123MB 7 days ago    klinik-matras-backend:rollback-pre-kdc-f0299482

# TAHAP 2 (opsional): rollback 3-7 hari — 21 image, UNIQUE 1.78 GB
efa1c29616e3  127MB 6 days ago    klinik-matras-backend:rollback-pre-adm-65e7e1f5
0543f167163d  127MB 6 days ago    klinik-matras-backend:rollback-pre-p12a3-906ff12f
d5a38c2d594c  127MB 6 days ago    klinik-matras-backend:rollback-pre-driver-catatan-rute-203e8870
19d7c86ef5b4  127MB 6 days ago    klinik-matras-backend:rollback-pre-morning-priority-1a39c851
af3e815c0760  127MB 5 days ago    klinik-matras-backend:rollback-pre-bdb-888f4ab6
753f71d2ce9f    0MB 5 days ago    klinik-matras-backend:rollback-pre-p12b7-b8c1d018
3f541db908c3    0MB 5 days ago    klinik-matras-backend:rollback-pre-p12b3-296c1073
6c00e991022a    0MB 5 days ago    klinik-matras-backend:rollback-pre-p12b4-b0005a11
b85c42ae02f2    0MB 5 days ago    klinik-matras-backend:rollback-pre-p12b2-a06ce6e6
5a5fe6f78604    0MB 5 days ago    klinik-matras-backend:rollback-pre-back-3d97d01a
b975eff65577  127MB 4 days ago    klinik-matras-backend:rollback-pre-pbr-db384528
94ea8d1bd6d0  127MB 4 days ago    klinik-matras-backend:rollback-pre-pbr-8551d9db
ff9fd4c54813  128MB 3 days ago    klinik-matras-backend:rollback-pre-inv-22c6e497
5772e030893c  128MB 3 days ago    klinik-matras-backend:rollback-pre-pbr-36b4b4b3
e3edd605c9d0  128MB 3 days ago    klinik-matras-backend:rollback-pre-pbr-86cb882f
d9edaac97f8b    0MB 3 days ago    klinik-matras-backend:rollback-pre-kvf-8529e300
deb93960d233    0MB 3 days ago    klinik-matras-backend:rollback-pre-rnp-86d9162d
30c5210ba6a8  128MB 3 days ago    klinik-matras-backend:rollback-pre-pbr-65842c6b
5ad9aa437a8b  128MB 3 days ago    klinik-matras-backend:rollback-pre-pbr-836f68de
c6e28c37b54a  127MB 3 days ago    klinik-matras-backend:rollback-pre-gab-f28e232d
98cebf827d8f  127MB 3 days ago    klinik-matras-backend:rollback-pre-pbr-d13896a3

# DIPERTAHANKAN: rollback < 3 hari — 18 image, UNIQUE 2.07 GB
4519e0fe0f47  130MB 2 days ago    klinik-matras-backend:rollback-pre-po-cf7a2f7b
c06de94953b2  130MB 2 days ago    klinik-matras-backend:rollback-pre-bk-2e7d5db8
7ef24579421e  130MB 2 days ago    klinik-matras-backend:rollback-765e2f7d
970581c4ee0b  129MB 2 days ago    klinik-matras-backend:rollback-pre-cpr-765e2f7d
3d5bb43c1ccc  129MB 2 days ago    klinik-matras-backend:rollback-pre-pbr-6643b2b0
143399a4592b  129MB 2 days ago    klinik-matras-backend:rollback-pre-inv-66776624
846eb5292f63  128MB 2 days ago    klinik-matras-backend:rollback-pre-inv-31e04300
f06d6791db43  129MB 2 days ago    klinik-matras-backend:rollback-b35751dc
a4564dc254de  128MB 2 days ago    klinik-matras-backend:rollback-pre-pbr-b35751dc
14881c7ea619  128MB 2 days ago    klinik-matras-backend:rollback-pre-inv-59bdc408
e272ef94255d  128MB 2 days ago    klinik-matras-backend:rollback-pre-pbr-59bbc0cc
d9014beabc8b    0MB 32 hours ago  klinik-matras-backend:rollback-pre-rcgr-852d3bd5
81c5b8a1d4b5    0MB 32 hours ago  klinik-matras-backend:rollback-pre-mcpiss-f61df9e7
29dfdb721966  131MB 30 hours ago  klinik-matras-backend:rollback-ad1e9ca2
6f36898fdc58  131MB 30 hours ago  klinik-matras-backend:rollback-pre-bb-ad1e9ca2,klinik-matras-backend:rollback-pre-bb-b9671647
cf4b7f1fac10  132MB 29 hours ago  klinik-matras-backend:rollback-pre-tau-f369b6fd
3c734ca978e8  132MB 29 hours ago  klinik-matras-backend:rollback-pre-mcpdiag-b840db01
46b8e76b0b48  132MB 28 hours ago  klinik-matras-backend:rollback-pre-reklas-7c4e5586

# DIPERTAHANKAN: target rollback rilis dengan release dir + image aktif + infrastruktur + TINJAU
f35df5b6c48a  133MB 2 hours ago   klinik-matras-backend:latest  [JANGAN]
18c6080b72f6  132MB 23 hours ago  klinik-matras-backend:rollback-pre-pkroc-74e3d73a,klinik-matras-backend:rollback-pre-pkroc-934142cd  [SIMPAN]
736b8eeceb01  132MB 25 hours ago  klinik-matras-backend:rollback-pre-sku-d4426006  [SIMPAN]
1fd141f3d3b2  132MB 26 hours ago  klinik-matras-backend:rollback-pre-ppd-2a5ab783  [SIMPAN]
8a29fe856d4a  132MB 26 hours ago  klinik-matras-backend:rollback-pre-rdwa-b3c5502d  [SIMPAN]
b222feb17b83  113MB 2 weeks ago   klinik-matras-backend:release-f0e15cd5  [TINJAU]
294b683cb724   13MB 3 weeks ago   alpine:latest  [TINJAU]
f3c33e8e70a7 4065MB 3 months ago  devlikeapro/waha:latest  [JANGAN]
e013e867e712  420MB 3 months ago  postgres:16-alpine  [JANGAN]
```
