#!/usr/bin/env bash
# GUARD ROLLBACK KODE — Admin override: Siap Kirim saat pencatatan produksi belum selesai (baca-saja). Menolak (exit 1) bila SUDAH ada Run yang di-override
# (production_runs_v2.delivery_released_at terisi). Kode lama tidak mengenal override: unit READY_FOR_DELIVERY dengan Run ACTIVE tampil sebagai konflik V1 (rekonsiliasi),
# pagar "Run sudah di-override" hilang sehingga command tahap/bahan bisa berjalan di belakang unit yang sudah di jalur pengiriman, dan rekam audit keputusan Admin tidak lagi terbaca.
# Perubahan DATA yang sudah terjadi TIDAK dibalik oleh rollback kode.
set -Eeuo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-klinik}"; DB_NAME="${DB_NAME:-klinik_matras}"; PROJECT="${PROJECT:-klinik-matras}"
cd "$RELEASE_DIR"
q() { SANSS_PERSIST_ROOT="${SANSS_PERSIST_ROOT:-$HOME/klinik-matras}" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
echo "Release aktif: $RELEASE_DIR"
N_OV="$(q "select count(*) from production_runs_v2 where delivery_released_at is not null or delivery_release is not null")"
N_OVR="$(q "select count(*) from production_runs_v2 where delivery_released_at is not null and status::text in ('ACTIVE','BLOCKED','PENDING_ARRIVAL')")"
for v in "$N_OV" "$N_OVR"; do
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hasil pemeriksaan bukan angka: '$v'" >&2; exit 2; }
done
echo "  Run yang di-override (Admin override) ..... $N_OV"
echo "  ... di antaranya Run belum ditutup ........ $N_OVR"
if [ "$N_OV" -gt 0 ]; then
  echo "TOLAK: sudah ada Run yang di-override -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner."
  exit 1
fi
echo "AMAN: belum ada Run yang di-override -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang)."
