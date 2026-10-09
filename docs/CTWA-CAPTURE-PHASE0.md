# Capture atribusi Meta CTWA — Fase 0

**Status:** kode siap, flag **MATI** secara default, belum di-deploy. Kandidat rilis: branch `rc/ctwa-capture-phase0-on-live-934142cd`.
**Tujuan:** membuktikan field atribusi apa yang benar-benar diterima dari WAHA/GOWS untuk pesan inbound Click-to-WhatsApp, tanpa menyimpan isi chat atau data pribadi. Ini **bukan atribusi** — tidak mengubah `Customer.leadSource`, tidak membuat `attribution_touch`, tidak mengirim apa pun ke Meta. Tanpa perubahan skema DB.

## Dua keluaran

Direktori: `backend/data/ctwa-capture/` di container = `/app/data/ctwa-capture/` (bind-mount; di-gitignore).

| Berkas | Isi | Kapan ditulis |
|---|---|---|
| `ctwa-capture-YYYY-MM-DD.jsonl` | Observasi ter-sanitasi, satu baris per pesan **bersinyal** | Hanya bila pesan punya `externalAdReply`, penanda iklan, field entry-point conversion, atau key bernama referral/ctwa/conversion/dst |
| `ctwa-capture-counts-YYYY-MM-DD.json` | **Hanya angka**: total inbound, per verdict, baru/lama, jumlah drop | Di-flush paling lambat tiap 60 dtk (tulis tmp + rename atomik) |

Pesan biasa dan reply (`NO_CONTEXT_INFO`, `CONTEXT_NON_AD`, `NO_MESSAGE_BODY`) **tidak** menghasilkan baris; mereka hanya menaikkan angka di berkas agregat. Berkas agregat tidak memuat ID pesan, hash, atau data customer. Jika proses restart, hitungan yang belum di-flush (maks. ±60 dtk) hilang; sesudah restart hitungan digabung dengan berkas hari itu, bukan menimpa.

### Isi baris JSONL (allowlist)

| Kelompok | Isi |
|---|---|
| Meta pesan | event, engine, hash HMAC ID pesan, `sid` (sidik salt 6 hex), timestamp provider, selisih detik, `NEW`/`EXISTING` |
| Verdict bersinyal | `CTWA_AD`, `AD_REPLY_UNMARKED`, `ENTRY_POINT_OTHER`, `OTHER_ATTRIBUTION_FIELD` |
| Status field | `absent` / `empty` / `present` untuk `sourceURL`, `sourceID`, `sourceType`, `ctwaClid`, `containsCtwaFlowsAutoReply`, `conversionSource`, `entryPointConversionSource/App/DelaySeconds` |
| Nilai | hanya bila lolos validasi bentuk; yang gagal hanya dicatat di `rejected` |
| `ctwa_clid` | HMAC-SHA256 (16 hex) + panjang + kelas karakter. Nilai utuh, potongan, dan 4 karakter terakhir tidak disimpan maupun di-log |
| `sourceURL` | jenis, token publik post bila ada, **nama** parameter query. Path `wa.me` dibuang (bisa berisi nomor) |
| Nama key | daftar **nama** key di `externalAdReply`, `contextInfo`, dan key bersinyal lain (bukan nilai) |

**Tidak pernah dicatat:** isi pesan, nama, nomor/JID, media, `healthStatus`, `complaintCategory`, token/API key, payload mentah.

## Perilaku aman (kegagalan, batas, berhenti)

| Kondisi | Perilaku |
|---|---|
| Flag bukan persis `true` | `captureInbound` langsung return; tidak ada I/O. Flush agregat membuang hitungan memori. Sisa antrean dibuang (`flagOff`) |
| Salt kosong / < 16 karakter | Tidak menulis apa pun, tidak membuat folder, satu peringatan per menit |
| Penulisan | **Satu antrean serial**, batas `MAX_QUEUE = 500` baris (≤ 2 MB memori). Penuh → drop + counter `queueFull`; inbox tetap jalan |
| Folder tidak writable / error berturut-turut | Setelah 5 kegagalan, circuit breaker terbuka 60 dtk (tulis di-drop, bukan dicoba ulang tiap pesan) |
| Disk penuh (`ENOSPC`/`EDQUOT`) | Breaker langsung terbuka 60 dtk |
| Ruang bebas < `CTWA_CAPTURE_MIN_FREE_MB` (default **1024**) | Tidak menulis (`lowDisk`). Dicek paling banyak sekali per menit; jika `statfs` gagal, capture tidak diblokir |
| Berkas harian ≥ 5 MB | Baris berikutnya di-drop (`fileCap`) |
| Baris > 4 KB | Di-drop (`oversize`) |
| Folder dihapus saat berjalan | Dibuat ulang sekali lalu menulis lagi |
| Crash saat menulis (ekor tanpa `\n`) | Tulis pertama ke berkas itu diawali `\n`, jadi tidak merekat ke baris terpotong |
| Restart | Antrean memori hilang (wajar); berkas yang sudah ditulis utuh |

Capture dipanggil setelah `Message.create` berhasil dan hanya di jalur `saved`; kegagalannya tidak bisa menggagalkan pesan.

## Hasil preflight produksi (metadata saja, 9 Okt 2026, ±15:20 UTC)

Diambil lewat SSH read-only: hanya `stat`, `df`, `docker inspect --format` terbatas, dan penghitung `grep -c` untuk env. Tidak ada isi chat, payload, berkas capture, atau secret yang dibaca atau dicetak.

| Item | Hasil | Arti |
|---|---|---|
| Baseline live | release dir `934142cd`, container `klinik-matras-backend-1` (naik ±17 menit sebelum cek), image `sha256:f35df5b6c48a…`, compose `docker-compose.yml` + `docker-compose.release.yml` dari release dir itu | Bukan `main` `f0e406a7` dan bukan `f28e232d` (leluhur live). Baseline bergerak; **cek ulang tepat sebelum rilis** |
| Mount data | `bind /home/ubuntu/klinik-matras/backend/data -> /app/data` (rw) | Persisten; bertahan saat container/release di-recreate |
| Folder capture | belum ada di host maupun container | Wajar: flag belum pernah menyala. Setelah deploy flag OFF folder ini **tidak boleh muncul** |
| Ownership host | `ubuntu:ubuntu 775` untuk `backend/data`; `700` untuk `~/klinik-matras` | `ubuntu` bisa membuat/menghapus isi `backend/data` |
| Proses container | uid/gid `0/0` (root) | Folder capture akan dibuat `root:root 0700`; `ubuntu` tidak bisa membacanya di host. Report/purge **harus lewat `docker exec`** |
| Disk | `/dev/vda2` 99 GB, terpakai 89 GB, **bebas 6,0 GB (94%)**, inode 15% | **Sempit.** Disk dipakai bersama `uploads` (34 GB), Postgres, image Docker (118 image, 13,9 GB reclaimable), build cache 10,3 GB |
| `backend/data` | 357 MB | Capture ≤ 5 MB/hari di atasnya |
| Docker log | `json-file`, `max-size 100m`, `max-file 3` (daemon.json dan container) | Log container dibatasi ±300 MB; capture tidak menambah log kecuali error ≤ 1 baris/menit |
| `WEBHOOK_DEBUG` | tidak ada di env container maupun `.env` persist (0 dari 0) | Payload penuh **tidak** dicetak ke log |
| Flag `CTWA_*` | tidak ada di env container maupun `.env` | Capture mati secara default |
| Cron user | hanya `canary-monitor.sh` (tiap 10 menit) dan satu `p7b-monitor` (jendela 29 Sep, sudah lewat) | **`backup-database.sh` tidak ada di crontab user** |
| `/etc/cron.d` | `certbot`, `e2scrub_all`, `sgagenttask`, `sysstat`, `yunjing` | Tidak ada pekerjaan backup yang terlihat |
| Backup DB | `~/backups` hanya `pre-<rilis>-*.sql.gz` (±30 MB, dari skrip rilis); `~/klinik-matras/backups` punya 3 `klinik_matras_backup_*.sql.gz` terakhir 23 Sep dan dump manual 23–24 Sep; tidak ada `backup.log` | Backup harian terjadwal yang dijelaskan di `PANDUAN-RESTORE-BACKUP.md` **tidak terbukti berjalan**. Cron root tidak bisa dilihat tanpa sudo → belum bisa dipastikan |
| Backup `backend/data` | tidak ada pekerjaan lokal yang terlihat mengarsipkannya | Lihat status di bawah |
| Agen cloud | `barad_agent`, `tat_agent`, `YDService`, `YDLive` berjalan; `/etc/cron.d` ada `yunjing`, `sgagenttask` | Pola agen monitoring/otomasi/keamanan Tencent Cloud. **Bukan bukti snapshot** |
| rclone | remote `gdrive:` terdaftar | Hanya nama remote yang dilihat |

## Status backup `backend/data`: UNKNOWN

- Tidak ada pekerjaan lokal yang terlihat mengarsipkan `backend/data` atau `backend/uploads`. Itu **bukan bukti bahwa tidak ada backup**: snapshot disk penuh dikelola di konsol penyedia cloud (tidak terlihat dari VM), dan cron root tidak bisa dilihat tanpa sudo.
- Temuan terpisah untuk pemilik: backup DB harian terjadwal tidak terbukti berjalan (lihat tabel). Cek sebelum mengandalkannya.
- Cek yang perlu dijawab pemilik: apakah konsol penyedia (Tencent Cloud) punya kebijakan snapshot untuk instance ini, dan berapa retensinya. Jika ada, berkas capture ikut tersalin di luar retensi 7 hari; itu **dapat diterima** hanya bila isinya memang ter-sanitasi (hash, tanpa data pribadi), yang dijamin desain ini, tetapi tetap perlu keputusan sadar.

## Estimasi volume (jangan memakai asumsi 100 pesan/hari)

Angka "50-100 pesan/hari" di `CLAUDE.md` adalah catatan lama saat memakai nomor testing dan **tidak konsisten** dengan kode: komentar produksi mencatat 89–120 lead Meta per hari (14–17 Agt 2026) dan ±2.550 customer pada 14 Agt. Pesan inbound per hari jauh di atas jumlah lead (tiap lead mengirim beberapa pesan, termasuk media), jadi 100 pesan/hari tidak bisa menjadi batas atas. Perkiraan modeling (bukan hasil ukur): ratusan hingga beberapa ribu pesan inbound per hari.

Desain tidak bergantung pada angka itu: JSONL hanya untuk pesan bersinyal (kira-kira puluhan sampai ±200 baris/hari ≈ <300 KB/hari bila konteks iklan hanya menempel di pesan pertama; bila WhatsApp ikut menyertakannya di pesan lanjutan jumlahnya bisa lebih, dan batas 5 MB/hari menjaganya), dibatasi 5 MB/hari dan 500 baris di memori. Biaya tiap pesan inbound dengan flag nyala sekitar 25 µs CPU plus satu penambahan counter.

**Angka sebenarnya** didapat dua cara tanpa membaca isi chat:

1. Setelah capture menyala: `node scripts/ctwa-capture-report.js` (bagian "Volume inbound (agregat)").
2. Sebelum menyala, query agregat (hanya jumlah per hari WIB; divalidasi oleh tes integrasi):
   ```sql
   SELECT to_char((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS hari_wib,
          count(*)::int AS inbound
   FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
   WHERE m.direction = 'INBOUND' AND c.type = 'INDIVIDUAL' AND m."createdAt" >= now() - interval '14 days'
   GROUP BY 1 ORDER BY 1;
   ```
   Jalankan lewat `docker exec` ke container Postgres; jangan menambah kolom lain ke SELECT.

## Urutan deploy bergerbang

Setiap gerbang punya **titik penghentian**: bila tidak terpenuhi, berhenti dan jangan lanjut ke gerbang berikutnya.

### Gerbang 0 — Sebelum rilis (tidak mengubah apa pun)
1. Cek ulang baseline live: `ssh ubuntu@43.133.152.6 "ls -1dt \$HOME/releases/klinik-matras/*/ | head -1; docker inspect klinik-matras-backend-1 --format '{{.Image}}'"`. Bila release teratas bukan `934142cd`, **berhenti** dan rebase kandidat ke baseline baru (jangan menimpa rilis sesi lain).
2. Disk: `df -h $HOME`. **STOP bila bebas < 5 GiB** (build image dan frontend butuh ruang; `.dockerignore` mencatat deploy pernah gagal "no space left on device"). Pembersihan image/rollback lama adalah keputusan pemilik, bukan bagian rilis ini.
3. Mount: `docker inspect klinik-matras-backend-1 --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' | grep /app/data` harus menunjuk `~/klinik-matras/backend/data`. **STOP** bila berbeda.
4. Backup DB segar: skrip rilis membuat `pg_dump` + verifikasi restore. **STOP** bila gagal.
5. Keputusan backup/snapshot (status UNKNOWN di atas) dicatat oleh pemilik.

### Gerbang 1 — Deploy kode dengan flag OFF
Skrip: `scripts/release-ctwa-capture-flag-off.sh` (kode saja, **tanpa migrasi**, tanpa build frontend, tanpa perubahan env, tanpa penghapusan apa pun, tanpa rollback otomatis). Gerbang 0 di atas sudah ditegakkan oleh skrip (baseline, mount, disk ≥ 5 GiB di awal/sebelum build/sebelum switch, `pg_dump` + validasi gzip + verifikasi restore ke DB sementara, `.env` 0 baris `CTWA_*`, folder capture belum ada, `WEBHOOK_DEBUG` mati, allowlist berkas, pin sha256 4 berkas runtime).

```bash
# dari repo kandidat (laptop) — tanpa push; BASE_SHA = release aktif, DEPLOY_SHA = HEAD kandidat
git bundle create /tmp/ctwa.bundle <BASE_SHA>..rc/ctwa-capture-phase0-on-live-934142cd
scp /tmp/ctwa.bundle ubuntu@43.133.152.6:/tmp/ctwa.bundle
cat scripts/release-ctwa-capture-flag-off.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rcc.sh'
ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/ctwa.bundle bash /tmp/rcc.sh <DEPLOY_SHA> <BASE_SHA> --preflight-only'   # baca-saja, ulangi sampai bersih
ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/ctwa.bundle bash /tmp/rcc.sh <DEPLOY_SHA> <BASE_SHA>'                    # rilis
```
Kode keluar: `0` selesai dan terverifikasi; `1` berhenti (skrip mencetak instruksi rollback); `3` rilis aktif tetapi smoke inbox **tertunda** (belum ada pesan inbound dalam `SMOKE_WAIT_SEC`, default 300 dtk) → jalankan nanti `bash /tmp/rcc.sh <DEPLOY_SHA> <BASE_SHA> --verify-only` (baca-saja).
Rollback tag dibuat otomatis (`klinik-matras-backend:rollback-pre-ctwa0-<sha8>`).
Skrip diuji pada harness lokal (docker/curl disamarkan): jalur normal, `--preflight-only`, `--verify-only`, dan 15 skenario gagal (baseline bergeser, disk < 5 GiB di awal dan sebelum switch, mount salah, `pg_dump` gagal, restore tidak cocok, `CTWA_*` di `.env` atau container, folder capture sudah ada, `WEBHOOK_DEBUG=1`, berkas di luar allowlist, pin tidak cocok, log memuat clid, log memuat `[ctwa-capture]`, galat webhook, belum ada trafik). Harness itu **bukan** pengganti `--preflight-only` di server.

### Gerbang 2 — Verifikasi inbox dan flag-off
Sebagian besar otomatis di fase 8 skrip (lihat juga "Smoke test inbox"): release aktif, health, `RestartCount=0`, mount, pin berkas di container, 0 variabel `CTWA_*`, **tidak ada `ctwa-capture*` di container maupun host (sebelum dan sesudah ada trafik inbound nyata)**, 0 galat webhook dan 0 baris `[ctwa-capture]` di log sejak switch, log "Lapis 0b" tanpa nilai clid, route inbox 401 tanpa login, dan ≥ 1 pesan inbound baru tersimpan. **STOP + rollback** bila ada pesan inbound yang tidak tersimpan, error baru di log, atau folder capture muncul. Satu catatan: container diganti (beberapa detik); pesan WhatsApp yang tiba persis di jeda itu bergantung pada retry WAHA (belum diverifikasi) dan sinkronisasi riwayat WAHA→CRM — risiko yang sama dengan setiap rilis backend sebelumnya. Rilis di jam sepi.

### Gerbang 3 — Aktivasi terpisah (butuh persetujuan pemilik)
- Prasyarat: Gerbang 2 lulus, disk bebas ≥ 4 GiB, keputusan snapshot ada.
- Tambahkan ke `$SANSS_PERSIST_ROOT/backend/.env`:
  ```
  CTWA_ATTRIBUTION_CAPTURE_ENABLED=true
  CTWA_CAPTURE_HASH_SALT=<openssl rand -hex 24>
  CTWA_CAPTURE_RETENTION_DAYS=7
  CTWA_CAPTURE_MIN_FREE_MB=2048
  ```
  (2048 MB, bukan default 1024: disk produksi sudah 94%, jadi capture berhenti lebih awal dan menyisakan ruang untuk Postgres dan rilis.)
- Recreate backend saja (env hanya terbaca saat container dibuat ulang). Jangan memutar salt selama jendela observasi.
- Verifikasi ±2 menit: `ctwa-capture-counts-<hari>.json` muncul; tidak ada baris `[ctwa-capture]` di log selain peringatan yang disengaja.
- **Titik penghentian otomatis:** bila disk bebas < 2 GiB capture berhenti sendiri (`lowDisk` di agregat). Bila disk bebas < 1 GiB atau Postgres melaporkan error tulis → matikan flag segera.

### Gerbang 4 — Laporan agregat
`docker exec klinik-matras-backend-1 node scripts/ctwa-capture-report.js` setelah ≥ 30 observasi `CTWA_AD` (atau 3–7 hari). Putuskan GO/NO-GO `attribution_touch` dengan tabel kriteria di bawah.

### Gerbang 5 — Matikan dan purge
1. `CTWA_ATTRIBUTION_CAPTURE_ENABLED=false` (atau hapus barisnya), recreate backend.
2. `docker exec klinik-matras-backend-1 node scripts/ctwa-capture-purge.js --all`
3. Verifikasi: `docker exec klinik-matras-backend-1 sh -c 'ls /app/data/ctwa-capture | wc -l'` → 0.
4. Hapus `CTWA_CAPTURE_HASH_SALT` dari `.env`.

### Rollback
| Situasi | Tindakan |
|---|---|
| Capture bermasalah (disk, error), kode OK | Gerbang 5 (matikan flag, purge). Tidak perlu rollback kode |
| Kode bermasalah (inbox terganggu) | `docker exec … purge --all` dulu bila flag pernah menyala, lalu pakai perintah rollback yang dicetak skrip rilis: `cd <PREV_DIR> && SANSS_PERSIST_ROOT=$HOME/klinik-matras docker compose -p klinik-matras -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps backend` |
| Tidak ada langkah DB | Kandidat tanpa migrasi |

## Smoke test inbox

Semua cek memakai angka agregat; tidak ada isi chat yang dibaca.

**Sebelum deploy (baseline):**
```sql
-- jumlah pesan inbound 30 menit terakhir dan sebaran sumber lead 24 jam (agregat saja)
SELECT count(*) AS inbound_30m FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId"
 WHERE m.direction='INBOUND' AND c.type='INDIVIDUAL' AND m."createdAt" > now() - interval '30 minutes';
SELECT "leadSource", count(*) FROM "Customer" WHERE "createdAt" > now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC;
```

**Sesudah deploy flag OFF (tunggu ≥ 15 menit trafik nyata):**
1. Container sehat: `docker ps --filter name=klinik-matras-backend-1` status `Up`, tidak restart-loop.
2. Pesan tetap masuk: query `inbound_30m` di atas > 0 dan sebanding dengan baseline pada jam sibuk yang sama; log `docker logs --since 10m klinik-matras-backend-1 | grep -c "action=saved"` > 0 (hanya hitungan).
3. Inbox hidup: buka Inbox di web, pesan terbaru muncul dan unread bertambah (tanpa membuka isi chat pelanggan; cukup lihat badge/jumlah).
4. Atribusi tetap jalan: sebaran `leadSource` 24 jam tetap memuat `META_ADS` pada proporsi wajar.
5. **Flag-off tidak membuat berkas:**
   ```bash
   docker exec klinik-matras-backend-1 sh -c 'ls -ld /app/data/ctwa-capture 2>&1'   # harus: No such file or directory
   docker logs --since 30m klinik-matras-backend-1 2>&1 | grep -c "ctwa-capture"     # harus: 0
   ```
6. Log bersih dari potongan clid: `docker logs --since 30m klinik-matras-backend-1 2>&1 | grep -c "Lapis 0b"` boleh > 0, tetapi barisnya harus berakhir `clid: ada`/`clid: tidak ada` (cek 1 baris tanpa menyalin isinya).

**Sesudah aktivasi (Gerbang 3):** ulangi cek 1–3, lalu pastikan hanya folder berisi `ctwa-capture-counts-*.json` (dan `.jsonl` bila ada sinyal), `ls -ld` menunjukkan `drwx------ root root`, dan disk bebas tidak turun berarti.

## Mengaktifkan dan menonaktifkan

Lihat **Urutan deploy bergerbang** (Gerbang 3 untuk aktivasi, Gerbang 5 untuk mematikan dan purge) dan tabel Rollback di atas. Aturan umum:

- Flag harus persis `true`; nilai lain (`1`, `TRUE`, kosong) dianggap mati. Env hanya terbaca saat container dibuat ulang.
- `CTWA_CAPTURE_HASH_SALT` wajib (≥ 16 karakter); tanpa salt capture menolak menulis. Jangan memutar salt selama jendela observasi (report memperingatkan bila ada lebih dari satu `sid`).
- Setelah flag dimatikan, berkas lama tetap dihapus otomatis oleh build yang sama (sekali per hari-UTC). Sebelum rollback ke build yang tidak memuat modul ini, jalankan `purge --all`.

## Retensi dan cleanup

- Berkas (JSONL, agregat, dan `.tmp`) dihapus bila **awal hari-UTC-nya** lebih tua dari retensi (maks. dipaksa 7 hari; env lebih besar dipotong ke 7). Baris tertua yang tersisa tak pernah lebih tua dari retensi.
- Purge hanya menyentuh nama berpola `ctwa-capture[-counts]-YYYY-MM-DD.json[l][.tmp]`.
- Manual: `node scripts/ctwa-capture-purge.js [--dry-run] [--all]`. Wajib `--all` saat fase selesai.

## Cakupan yang tidak teramati (sengaja)

Pesan grup, pesan `fromMe`, nomor staf internal, header album, dan pesan yang nomornya tidak bisa di-resolve tidak masuk capture maupun hitungan.

## Kriteria keputusan untuk `attribution_touch`

Jalankan report setelah ≥ 30 observasi `CTWA_AD`.

| Hasil | Keputusan |
|---|---|
| `sourceID` ada di ≥ 90% `CTWA_AD`, numerik, dan 5 iklan berbeda cocok dengan ID iklan di Ads Manager | GO penuh: touch menyimpan `source_id` sebagai ad ID terverifikasi |
| `sourceID` ada tapi sama dengan ID post turunan dari shortcode (`instagramComparison`) | GO terbatas: simpan sebagai ID kreatif/post, bukan ad ID |
| `sourceID` absen, `ctwa_clid` ada | GO terbatas: touch dengan `ctwa_clid` + `sourceURL`; pemetaan ke ad set/campaign butuh jalur lain (Cloud API atau Marketing API) |
| `ctwa_clid` ada di < 80% `CTWA_AD`, atau sampel < 30 | NO-GO: perpanjang capture atau perbaiki sumber dulu |

`sourceIdLooksLikeAdId` di report sengaja selalu `null`: ID baru boleh disebut ad ID setelah dicocokkan manual.
