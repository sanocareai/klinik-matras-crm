#!/usr/bin/env bash
# RINGKASAN ROLLBACK KODE — "Status lintas workspace" (Sales fleksibel + Route Planner + riwayat + fungsi domain tunggal) (baca-saja). Rollback kode SELALU aman: rilis ini tanpa migrasi dan tidak ada kode lama yang bergantung pada data baru.
# Yang berubah karena aturan baru (order dibatalkan/ditandai Siap Kirim/Terkirim oleh Sales dengan Run berjalan) TIDAK dibalik oleh rollback kode: Run/rencana/permintaan bahan yang sudah diselaraskan tetap
# sebagaimana tercatat, dan jejak PRODUCTION_FOLLOWS_ORDER tetap di activity_events (kode lama menampilkannya sebagai jenis tak dikenal). Kode lama hanya kembali MENOLAK perubahan Sales berikutnya selama Run berjalan.
# Skrip ini hanya melaporkan jumlahnya; exit 0 selalu (tidak ada syarat yang menolak rollback).
set -Eeuo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-klinik}"; DB_NAME="${DB_NAME:-klinik_matras}"; PROJECT="${PROJECT:-klinik-matras}"
cd "$RELEASE_DIR"
q() { SANSS_PERSIST_ROOT="${SANSS_PERSIST_ROOT:-$HOME/klinik-matras}" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
echo "Release aktif: $RELEASE_DIR"
echo "  Jejak penyelarasan Sales->Produksi (PRODUCTION_FOLLOWS_ORDER) ... $(q "select count(*) from activity_events where event_type = 'PRODUCTION_FOLLOWS_ORDER'")"
echo "  ... di antaranya pembatalan order ................................ $(q "select count(*) from activity_events where event_type = 'PRODUCTION_FOLLOWS_ORDER' and metadata->>'aksi' = 'CANCEL'")"
echo "  Run dilepas karena status order (SALES_STATUS_CHANGE) ............ $(q "select count(*) from production_runs_v2 where delivery_release->>'kind' = 'SALES_STATUS_CHANGE'")"
echo "  Antrean Retur Bahan Gudang PENDING dari pembatalan order ......... $(q "select count(*) from production_material_returns_v2 where status = 'PENDING'")"
echo "  Koreksi pengiriman manual ke rute selesai (DELIVERY_MANUAL_RECORDED) $(q "select count(*) from activity_events where event_type = 'DELIVERY_MANUAL_RECORDED'")"
echo "  Run dilepas karena dispatch Route Planner (DISPATCH_ROUTE_PLANNER) . $(q "select count(*) from production_runs_v2 where delivery_release->>'kind' = 'DISPATCH_ROUTE_PLANNER'")"
echo "AMAN: rollback KODE diperbolehkan (tanpa migrasi). Data yang sudah diselaraskan/dikoreksi tidak dibalik oleh rollback."
