#!/usr/bin/env bash
# GUARD ROLLBACK KODE — Nilai Bersih Jembatan Laporan Keuangan (baca-saja). Rilis ini TANPA migrasi dan TANPA tulisan data, jadi rollback kode selalu aman secara skema dan data.
# Guard hanya MELAPORKAN: release aktif, jumlah jurnal/gap, dan bahwa read-model tidak menyimpan apa pun (tidak ada tabel baru). Exit 0 = laporan tampil; exit 2 = pembacaan gagal.
set -Eeuo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-klinik}"; DB_NAME="${DB_NAME:-klinik_matras}"; PROJECT="${PROJECT:-klinik-matras}"
cd "$RELEASE_DIR"
q() { SANSS_PERSIST_ROOT="${SANSS_PERSIST_ROOT:-$HOME/klinik-matras}" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U "$DB_USER" -d "$DB_NAME" -At -c "$1"; }
echo "Release aktif: $RELEASE_DIR ($(tr -d '[:space:]' < .release-commit 2>/dev/null || echo '?'))"
N_JURNAL="$(q "select count(*) from fin_journal_entries")" || exit 2
N_GAP="$(q "select count(*) from fin_posting_gaps where resolved_at is null")" || exit 2
N_MIG_TUNDA="$(q "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" || exit 2
for v in "$N_JURNAL" "$N_GAP" "$N_MIG_TUNDA"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hasil bukan angka: '$v'" >&2; exit 2; }; done
echo "  jurnal tercatat ..................... ${N_JURNAL}"
echo "  gap pembukuan terbuka ............... ${N_GAP}"
echo "  migrasi menggantung ................. ${N_MIG_TUNDA}"
echo "AMAN: rilis tanpa migrasi dan tanpa tulisan data — rollback KODE diperbolehkan. Dampaknya hanya definisi omzet pada jembatan kembali ke nilai kotor; Laba Rugi tidak berubah."
