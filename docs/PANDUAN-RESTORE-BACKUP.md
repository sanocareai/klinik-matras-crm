# Panduan Backup & Restore Database Klinik Matras

> Panduan ini untuk Gilang. Kalau ada insiden (VPS crash, data corrupt, dsb),
> ikuti langkah-langkah di sini. Baca dari awal ke bawah — jangan loncat-loncat.

---

## Daftar Isi

1. [Cara Kerja Sistem Backup](#1-cara-kerja-sistem-backup)
2. [Setup Awal (Sekali Saja)](#2-setup-awal-sekali-saja)
3. [Test Backup Manual](#3-test-backup-manual)
4. [Setup Cron Harian](#4-setup-cron-harian)
5. [Cara Melihat Daftar Backup](#5-cara-melihat-daftar-backup)
6. [Cara Restore Database](#6-cara-restore-database)
7. [Test Restore di Lingkungan Aman](#7-test-restore-di-lingkungan-aman)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Cara Kerja Sistem Backup

```
Setiap hari jam 03:00 WIB (cron di VPS):
  1. pg_dump → file .sql.gz di ~/klinik-matras/backups/
  2. rclone upload → Google Drive: gdrive:klinik-matras-backups/
  3. Hapus file lokal yang lebih dari 7 hari
  4. Hapus file di Google Drive yang lebih dari 30 hari
  5. Kalau ada langkah yang gagal → kirim WA notifikasi ke admin
```

**Retensi:**
- Lokal di VPS: 7 hari terakhir
- Google Drive: 30 hari terakhir

**Notifikasi gagal:** Backend Express kirim WA ke nomor `BACKUP_NOTIFY_PHONE` di `.env`.

---

## 2. Setup Awal (Sekali Saja)

SSH ke VPS terlebih dahulu:
```bash
ssh ubuntu@43.133.152.6
cd ~/klinik-matras
```

### 2a. Install rclone

```bash
curl https://rclone.org/install.sh | sudo bash
rclone --version  # verifikasi berhasil
```

### 2b. Konfigurasi Google Drive remote

```bash
rclone config
```

Ikuti wizard interaktif:
1. Tekan `n` → New remote
2. Name: **gdrive** (harus persis ini — script sudah hardcode nama ini)
3. Storage: pilih **Google Drive** (biasanya nomor 17 atau sekitarnya)
4. `client_id`: kosongkan (tekan Enter)
5. `client_secret`: kosongkan (tekan Enter)
6. `scope`: pilih **1** (Full access)
7. `root_folder_id`: kosongkan
8. `service_account_file`: kosongkan
9. Edit advanced config? **n**
10. Use auto config? **n** (karena ini server, tidak ada browser)
11. Copy URL yang muncul → buka di browser laptop/HP → login Google Gilang → izinkan akses
12. Copy kode verifikasi → paste ke terminal
13. Configure as shared drive? **n**
14. Konfirmasi: **y**
15. Tekan `q` → Quit

**Verifikasi:**
```bash
rclone ls gdrive:          # daftar file di Google Drive root
rclone mkdir gdrive:klinik-matras-backups   # buat folder (kalau belum ada)
```

### 2c. Beri permission execute ke script

```bash
chmod +x backend/scripts/backup-database.sh backend/scripts/restore-database.sh
```

### 2d. Tambah env var di .env backend

```bash
nano backend/.env
```

Tambahkan baris ini di akhir file:
```
# Nomor HP admin untuk notifikasi WA kalau backup gagal (format: 628xxx tanpa +)
BACKUP_NOTIFY_PHONE=628xxxxxxxxx
```

Ganti `628xxxxxxxxx` dengan nomor WA Gilang (contoh: `6281234567890`).

Simpan: `Ctrl+X` → `Y` → Enter

Restart backend agar env var aktif:
```bash
docker compose restart backend
```

---

## 3. Test Backup Manual

```bash
cd ~/klinik-matras
./backend/scripts/backup-database.sh
```

Output yang diharapkan:
```
2026-07-06 03:00:00 — Mulai backup: klinik_matras_backup_2026-07-06_03-00-00.sql.gz
✅ Backup dibuat: klinik_matras_backup_2026-07-06_03-00-00.sql.gz (2.5M)
✅ Upload ke Google Drive selesai
✅ Cleanup lokal selesai (file >7 hari dihapus)
✅ Cleanup Google Drive selesai (file >30 hari dihapus)
🎉 2026-07-06 03:00:15 — Backup selesai
```

Verifikasi file ada di Drive:
```bash
rclone ls gdrive:klinik-matras-backups/
```

---

## 4. Setup Cron Harian

```bash
crontab -e
```

Tambahkan baris ini di akhir:
```
0 3 * * * cd /home/ubuntu/klinik-matras && ./backend/scripts/backup-database.sh >> /home/ubuntu/klinik-matras/backups/backup.log 2>&1
```

Arti: Setiap hari jam 03:00 WIB, jalankan backup dan simpan log di `backups/backup.log`.

Simpan dan keluar (`Ctrl+X` → `Y` → Enter untuk nano).

**Verifikasi cron terdaftar:**
```bash
crontab -l
```

**Pantau log:**
```bash
tail -f ~/klinik-matras/backups/backup.log
```

---

## 5. Cara Melihat Daftar Backup

**Backup lokal di VPS:**
```bash
ls -lh ~/klinik-matras/backups/klinik_matras_backup_*.sql.gz
```

**Backup di Google Drive:**
```bash
rclone ls gdrive:klinik-matras-backups/
```

---

## 6. Cara Restore Database

> Ikuti langkah ini kalau perlu memulihkan data dari backup (misalnya data corrupt,
> migrasi bermasalah, atau kecelakaan hapus data penting).

### Langkah 1 — Unduh backup dari Google Drive

Kalau file backup ada di Drive (bukan lokal):
```bash
cd ~/klinik-matras

# Lihat daftar backup di Drive:
rclone ls gdrive:klinik-matras-backups/

# Download file yang diinginkan:
rclone copy gdrive:klinik-matras-backups/klinik_matras_backup_2026-07-05_03-00-00.sql.gz backups/
```

### Langkah 2 — Matikan backend

```bash
docker compose stop backend
```

### Langkah 3 — Jalankan restore

```bash
cd ~/klinik-matras
./backend/scripts/restore-database.sh backups/klinik_matras_backup_2026-07-05_03-00-00.sql.gz
```

Script akan menampilkan peringatan dan meminta konfirmasi. Ketik `YA` (huruf kapital semua).

Script secara otomatis:
1. Menghentikan koneksi aktif ke database
2. Menghapus database lama
3. Membuat database baru (kosong)
4. Mengisi dari file backup

### Langkah 4 — Nyalakan kembali backend

```bash
docker compose up -d backend
```

### Langkah 5 — Verifikasi

Buka `https://app.sanomatrassehat.com` → login → cek data sudah kembali benar.

Atau cek via Prisma Studio:
```bash
docker compose exec backend npx prisma studio
# Buka http://43.133.152.6:5555 di browser (sementara, tutup setelah selesai)
```

---

## 7. Test Restore di Lingkungan Aman

Lakukan ini SEKALI untuk memastikan sistem backup benar-benar bisa digunakan:

```bash
cd ~/klinik-matras

# 1. Buat backup sekarang
./backend/scripts/backup-database.sh

# 2. Catat nama file backup yang baru dibuat
ls -lt backups/ | head -3

# 3. Matikan backend
docker compose stop backend

# 4. Restore dari backup tadi
./backend/scripts/restore-database.sh backups/klinik_matras_backup_XXXX.sql.gz
# Ketik YA untuk konfirmasi

# 5. Nyalakan kembali
docker compose up -d backend

# 6. Buka app, login, verifikasi data
```

Kalau semua data masih ada dan login berhasil → sistem backup berfungsi dengan benar.

---

## 8. Troubleshooting

### "rclone: command not found"
Install rclone: `curl https://rclone.org/install.sh | sudo bash`

### "Error: remote 'gdrive' not found"
Konfigurasi gdrive remote belum ada. Ikuti seksi [2b](#2b-konfigurasi-google-drive-remote).

### Backup gagal tapi tidak dapat WA notifikasi
Cek:
1. `BACKUP_NOTIFY_PHONE` sudah diisi di `backend/.env`?
2. Backend jalan? `docker compose ps`
3. WAHA session aktif? Cek di `http://43.133.152.6:3000/dashboard`

### "pg_dump: error: connection to server failed"
Container postgres belum jalan:
```bash
docker compose up -d postgres
docker compose ps  # cek status semua container
```

### Restore gagal di tengah proses
Database mungkin dalam kondisi setengah jadi. Ulangi dari langkah 3 (restore) — script akan drop dan recreate database dari awal.

### Mau lihat log backup kemarin
```bash
cat ~/klinik-matras/backups/backup.log
# Atau khusus tanggal tertentu:
grep "2026-07-05" ~/klinik-matras/backups/backup.log
```
