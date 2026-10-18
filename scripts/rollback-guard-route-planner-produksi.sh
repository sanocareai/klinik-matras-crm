#!/usr/bin/env bash
# GUARD ROLLBACK KODE — "status produksi tidak menahan pengiriman" (Route Planner) (baca-saja). Menolak (exit 1) bila rollback ke kode lama akan merusak pekerjaan yang SUDAH berjalan karena aturan baru:
#   (a) ada Run yang dilepas karena dispatch (production_runs_v2.delivery_release->>'kind' = 'DISPATCH_ROUTE_PLANNER'): kode lama menampilkannya sebagai "override Admin" dan tidak mengenal penandanya;
#   (b) ada job pengiriman AKTIF (UNSCHEDULED/SCHEDULED/ASSIGNED/EN_ROUTE/ARRIVED) yang memuat unit yang MASIH diproduksi (RECEIVED/IN_PRODUCTION): kode lama menolak menerbitkan/memberi driver/menjalankannya
#       (409 MENUNGGU_KONFIRMASI_SIAP_KIRIM), jadi job yang sudah dijadwalkan lewat aturan baru macet di tengah jalan.
# Perubahan DATA yang sudah terjadi TIDAK dibalik oleh rollback kode (tidak ada migrasi untuk dipulihkan).
set -Eeuo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-klinik}"; DB_NAME="${DB_NAME:-klinik_matras}"; PROJECT="${PROJECT:-klinik-matras}"
cd "$RELEASE_DIR"
q() { SANSS_PERSIST_ROOT="${SANSS_PERSIST_ROOT:-$HOME/klinik-matras}" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
echo "Release aktif: $RELEASE_DIR"
N_DISPATCH="$(q "select count(*) from production_runs_v2 where delivery_released_at is not null and delivery_release->>'kind' = 'DISPATCH_ROUTE_PLANNER'")"
N_DISPATCH_RUN="$(q "select count(*) from production_runs_v2 where delivery_released_at is not null and delivery_release->>'kind' = 'DISPATCH_ROUTE_PLANNER' and status::text in ('ACTIVE','BLOCKED','PENDING_ARRIVAL')")"
N_JOB_PROD="$(q "select count(distinct j.id) from jobs j join job_units ju on ju.job_id = j.id join units u on u.id = ju.unit_id where j.type = 'DELIVERY' and j.status in ('UNSCHEDULED','SCHEDULED','ASSIGNED','EN_ROUTE','ARRIVED') and u.status in ('RECEIVED','IN_PRODUCTION')")"
for v in "$N_DISPATCH" "$N_DISPATCH_RUN" "$N_JOB_PROD"; do
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hasil pemeriksaan bukan angka: '$v'" >&2; exit 2; }
done
echo "  Run yang dilepas karena dispatch ................ $N_DISPATCH"
echo "  ... di antaranya Run belum ditutup ................ $N_DISPATCH_RUN"
echo "  Job pengiriman aktif berisi unit masih diproduksi . $N_JOB_PROD"
if [ "$N_DISPATCH" -gt 0 ] || [ "$N_JOB_PROD" -gt 0 ]; then
  echo "TOLAK: aturan baru sudah dipakai -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau selesaikan/keluarkan job terkait dan tutup Run administratif (Selesaikan Produksi / Konfirmasi Barang Jadi) lebih dulu, dengan persetujuan Owner."
  exit 1
fi
echo "AMAN: belum ada Run yang dilepas karena dispatch dan tidak ada job aktif berisi unit yang masih diproduksi -> rollback KODE diperbolehkan (tidak ada migrasi)."
