# Capture atribusi Meta CTWA — Fase 0

**Status:** kode siap, flag **MATI** secara default, belum di-deploy.
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

## Persistensi, ownership, disk (bukti dari repo)

- Produksi memakai overlay `docker-compose.release.yml` (ada di `f28e232d`, tidak di `main`) dengan `${SANSS_PERSIST_ROOT}/backend/data:/app/data`. `SANSS_PERSIST_ROOT=$HOME/klinik-matras` → data capture ada di `~/klinik-matras/backend/data/ctwa-capture/` di host, **bertahan** saat container di-recreate dan saat berpindah release directory. Skrip rilis menolak jalan bila `$PERSIST/backend/data` tidak ada.
- `backend/.dockerignore` mengecualikan `data/`, jadi isi capture tidak ikut masuk image.
- `Dockerfile` tidak punya `USER` → proses berjalan sebagai **root** di container. Folder dibuat `0700` dan berkas `0600`, pemilik root di host: user `ubuntu` tidak bisa membaca langsung, gunakan `docker exec`.
- Tidak ada kuota/batas disk di compose. Disk dipakai bersama Postgres, `uploads/` (media WhatsApp, GB), dan image. `.dockerignore` mencatat disk VPS pernah mencapai 0 byte bebas.
- Log Docker: tidak ada konfigurasi `logging:` di compose (default `json-file`, tidak berbatas kecuali diatur di daemon). Capture hanya menulis ke log bila gagal, maksimum satu baris per menit berisi kode error.
- **Belum terbukti dari repo (UNKNOWN sampai dicek):** mount aktual di container, ownership aktual, kapasitas dan ruang bebas disk, konfigurasi daemon Docker.

### Cek aman (metadata saja, tanpa membaca isi berkas)

```bash
# 1. Mount aktual container backend (nama dari memory: klinik-matras-backend-1)
docker inspect klinik-matras-backend-1 --format '{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{.Type}}, rw={{.RW}}){{"\n"}}{{end}}' | grep -E "/app/data|/app/uploads"
# 2. Ruang bebas disk dan inode
df -h "$HOME"; df -i "$HOME" | tail -1
# 3. Ownership/permission folder (hanya metadata)
sudo stat -c '%U:%G %a %n' ~/klinik-matras/backend/data ~/klinik-matras/backend/data/ctwa-capture 2>/dev/null
# 4. Batas log Docker (default dan per container)
docker inspect klinik-matras-backend-1 --format '{{.HostConfig.LogConfig.Type}} {{.HostConfig.LogConfig.Config}}'
# 5. Ukuran folder capture (angka saja)
sudo du -sh ~/klinik-matras/backend/data/ctwa-capture 2>/dev/null
```

## Status backup

**UNKNOWN** (bukti repo: **NO** untuk backup terdefinisi).

- `backend/scripts/backup-database.sh` (cron harian 03:00 WIB, lalu `rclone` ke Google Drive) dan skrip rilis (`pg_dump` ke `~/backups/pre-*.sql.gz`) hanya mencadangkan **database**.
- Tidak ada skrip di repo yang mengarsipkan `backend/data` atau `backend/uploads`. Berkas capture berada di luar database, jadi tidak ada di dump mana pun.
- Yang tidak bisa dibuktikan dari repo: snapshot VPS dari penyedia cloud, cron lain di luar yang didokumentasikan, atau salinan manual.

Cek aman: `crontab -l` (baca nama pekerjaan; abaikan baris yang memuat kredensial), `ls /etc/cron.d`, `rclone listremotes` (nama saja), dan periksa kebijakan snapshot disk di konsol penyedia VPS. Bila ada snapshot seluruh disk, berkas capture ikut tersalin di luar retensi 7 hari → pertimbangkan itu sebelum mengaktifkan.

## Estimasi volume (jangan memakai asumsi 100 pesan/hari)

Angka "50-100 pesan/hari" di `CLAUDE.md` adalah catatan lama saat memakai nomor testing dan **tidak konsisten** dengan kode: komentar produksi mencatat 89–120 lead Meta per hari (14–17 Agt 2026) dan ±2.550 customer pada 14 Agt. Pesan inbound per hari jauh di atas jumlah lead (tiap lead mengirim beberapa pesan, termasuk media), jadi 100 pesan/hari tidak bisa menjadi batas atas. Perkiraan modeling (bukan hasil ukur): ratusan hingga beberapa ribu pesan inbound per hari.

Desain tidak bergantung pada angka itu: JSONL hanya untuk pesan bersinyal (≈ satu per klik iklan, kira-kira puluhan sampai ±200 baris/hari ≈ <300 KB/hari bila konteks iklan hanya menempel di pesan pertama; bila WhatsApp ikut menyertakannya di pesan lanjutan jumlahnya bisa lebih, dan batas 5 MB/hari menjaganya), dibatasi 5 MB/hari dan 500 baris di memori. Biaya tiap pesan inbound dengan flag nyala sekitar 25 µs CPU plus satu penambahan counter.

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

## Mengaktifkan

1. Buat salt acak (jangan dipakai ulang): `openssl rand -hex 24`
2. Di `backend/.env` server (`$SANSS_PERSIST_ROOT/backend/.env`):
   ```
   CTWA_ATTRIBUTION_CAPTURE_ENABLED=true
   CTWA_CAPTURE_HASH_SALT=<salt langkah 1>
   CTWA_CAPTURE_RETENTION_DAYS=7
   CTWA_CAPTURE_MIN_FREE_MB=1024
   ```
3. Recreate backend saja (env hanya terbaca saat container dibuat ulang), memakai perintah rilis yang sama dengan skrip rilis.
4. Verifikasi: tidak ada baris `[ctwa-capture]` di log; setelah ±2 menit ada `ctwa-capture-counts-<hari>.json` di folder capture; `docker exec <backend> node scripts/ctwa-capture-report.js` menampilkan volume.
5. **Jangan memutar salt selama jendela observasi.** Report memperingatkan bila ada lebih dari satu `sid`.
6. Tunggu ≥ 30 observasi `CTWA_AD`, lalu jalankan report.

## Menonaktifkan / rollback

1. Set `CTWA_ATTRIBUTION_CAPTURE_ENABLED=false` (atau hapus baris itu).
2. Recreate backend.
3. Hapus data: `docker exec <backend> node scripts/ctwa-capture-purge.js --all`.

Rollback kode: kembalikan image/release sebelumnya (mis. tag `rollback-pre-...` dari skrip rilis); karena tidak ada migrasi, tidak ada langkah DB. Berkas lama tetap dibersihkan otomatis sekali per hari-UTC (juga saat flag mati) hanya bila build yang sama masih berjalan; setelah rollback ke build tanpa modul ini, jalankan `purge --all` **sebelum** rollback.

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
