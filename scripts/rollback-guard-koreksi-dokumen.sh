#!/usr/bin/env bash
# GUARD ROLLBACK KODE — Koreksi per Dokumen Laporan Keuangan (baca-saja). Menolak (exit 1) bila SUDAH ada keputusan atribusi divisi AKTIF:
# kode lama tidak membaca fin_attribution_decisions, sehingga konflik atribusi yang sudah diputuskan muncul kembali tanpa jejak di Laporan Divisi / Beban per Divisi.
# Pengakuan pendapatan hasil koreksi adalah jurnal biasa (Dr Piutang / Cr Pendapatan) — kode lama tetap membacanya; TIDAK menghalangi rollback, hanya dilaporkan.
# Perubahan DATA yang sudah terjadi TIDAK dibalik oleh rollback kode.
set -Eeuo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-klinik}"; DB_NAME="${DB_NAME:-klinik_matras}"; PROJECT="${PROJECT:-klinik-matras}"
cd "$RELEASE_DIR"
q() { SANSS_PERSIST_ROOT="${SANSS_PERSIST_ROOT:-$HOME/klinik-matras}" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U "$DB_USER" -d "$DB_NAME" -At -c "$1"; }
echo "Release aktif: $RELEASE_DIR"
N_AKTIF="$(q "select count(*) from fin_attribution_decisions where revoked_at is null")"
N_SEMUA="$(q "select count(*) from fin_attribution_decisions")"
N_PENGAKUAN="$(q "select count(*) from activity_events where metadata->>'aksi' = 'KOREKSI_PENGAKUAN_PENDAPATAN'")"
N_HARGA="$(q "select count(*) from activity_events where metadata->>'aksi' = 'TETAPKAN_HARGA_ORDER_RP0'")"
for v in "$N_AKTIF" "$N_SEMUA" "$N_PENGAKUAN" "$N_HARGA"; do
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hasil pemeriksaan bukan angka: '$v'" >&2; exit 2; }
done
echo "  keputusan atribusi aktif ................ $N_AKTIF (total riwayat $N_SEMUA)"
echo "  pengakuan hasil koreksi (jurnal biasa) .. $N_PENGAKUAN"
echo "  penetapan harga order Rp0 ............... $N_HARGA"
if [ "$N_AKTIF" -gt 0 ]; then
  echo "TOLAK: sudah ada keputusan atribusi aktif -> kode lama mengabaikannya (konflik atribusi muncul lagi). Cabut keputusan lewat layar Koreksi Dokumen lebih dulu, atau pilih perbaiki-maju."
  exit 1
fi
echo "AMAN: tidak ada keputusan atribusi aktif -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang). Pengakuan/harga hasil koreksi tetap sah sebagai data biasa."
