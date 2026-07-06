#!/bin/bash
# Restore database Klinik Matras dari file backup .sql.gz
# Jalankan dari root project: cd ~/klinik-matras && ./backend/scripts/restore-database.sh <file>
# Panduan lengkap: docs/PANDUAN-RESTORE-BACKUP.md

set -e

FILENAME=$1

if [ -z "$FILENAME" ]; then
  echo "Gunakan: ./backend/scripts/restore-database.sh <path-ke-file-backup.sql.gz>"
  echo "Contoh:  ./backend/scripts/restore-database.sh /home/ubuntu/klinik-matras/backups/klinik_matras_backup_2026-07-05_03-00-00.sql.gz"
  echo ""
  echo "Daftar backup lokal tersedia:"
  ls -lh /home/ubuntu/klinik-matras/backups/klinik_matras_backup_*.sql.gz 2>/dev/null || echo "  (tidak ada backup lokal — download dari Google Drive dulu)"
  exit 1
fi

if [ ! -f "$FILENAME" ]; then
  echo "❌ File tidak ditemukan: $FILENAME"
  exit 1
fi

echo ""
echo "========================================================"
echo "  ⚠️  RESTORE DATABASE — BACA DULU SEBELUM LANJUT"
echo "========================================================"
echo ""
echo "  Database tujuan  : klinik_matras"
echo "  File backup      : $(basename "$FILENAME")"
echo "  Ukuran file      : $(du -h "$FILENAME" | cut -f1)"
echo ""
echo "  ❗ SEMUA data yang ada sekarang akan DIHAPUS PERMANEN"
echo "     dan diganti dengan isi file backup ini."
echo ""
echo "  Pastikan sudah mematikan backend dulu:"
echo "    docker compose stop backend"
echo ""
echo "========================================================"
echo ""
echo "Ketik YA (huruf kapital semua) untuk lanjut, atau tekan Enter untuk batal:"
read -r konfirmasi

if [ "$konfirmasi" != "YA" ]; then
  echo ""
  echo "Dibatalkan. Database tidak diubah."
  exit 0
fi

echo ""
echo "$(date) — Memulai restore..."

echo "▶  Menghentikan koneksi aktif ke database..."
docker compose exec -T postgres psql -U klinik postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE datname = 'klinik_matras' AND pid <> pg_backend_pid();" \
  > /dev/null

echo "▶  Menghapus database lama..."
docker compose exec -T postgres psql -U klinik postgres -c \
  "DROP DATABASE IF EXISTS klinik_matras;"

echo "▶  Membuat database baru..."
docker compose exec -T postgres psql -U klinik postgres -c \
  "CREATE DATABASE klinik_matras OWNER klinik;"

echo "▶  Restore data dari backup (ini bisa memakan beberapa menit)..."
gunzip -c "$FILENAME" | docker compose exec -T postgres psql -U klinik klinik_matras

echo ""
echo "✅ $(date) — Restore selesai"
echo ""
echo "Langkah selanjutnya:"
echo "  1. Nyalakan kembali backend: docker compose up -d backend"
echo "  2. Verifikasi data di UI atau: docker compose exec backend npx prisma studio"
echo ""
