#!/usr/bin/env bash
# GUARD ROLLBACK KODE — Pratinjau & posting terkunci dokumen stok resmi (baca-saja). Menolak (exit 1) bila SUDAH ada jurnal hasil posting dokumen stok resmi
# (kunci SELISIH_OPNAME:* / SELISIH_PENYESUAIAN:* / SUSUT_BARANG_RUSAK:*): kode lama tidak punya jalur pembalikan dokumen itu, sehingga jurnalnya tidak bisa dibalik lewat aplikasi.
# Sakelar (tiga jenis) hanya DIBACA dan dicetak; rollback kode tidak mengubahnya. Perubahan DATA yang sudah terjadi TIDAK dibalik oleh rollback kode.
set -Eeuo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-klinik}"; DB_NAME="${DB_NAME:-klinik_matras}"; PROJECT="${PROJECT:-klinik-matras}"
cd "$RELEASE_DIR"
q() { SANSS_PERSIST_ROOT="${SANSS_PERSIST_ROOT:-$HOME/klinik-matras}" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U "$DB_USER" -d "$DB_NAME" -At -c "$1"; }
echo "Release aktif: $RELEASE_DIR"
N_JURNAL="$(q "select count(*) from fin_journal_entries where idempotency_key like 'SELISIH_OPNAME:%' or idempotency_key like 'SELISIH_PENYESUAIAN:%' or idempotency_key like 'SUSUT_BARANG_RUSAK:%'")"
N_AKTIF="$(q "select count(*) from fin_settings where key like 'stok_resmi_%_aktif' and value = 'true'")"
for v in "$N_JURNAL" "$N_AKTIF"; do
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hasil pemeriksaan bukan angka: '$v'" >&2; exit 2; }
done
echo "  jurnal stok resmi (opname/penyesuaian/rusak) .... $N_JURNAL"
echo "  sakelar posting berstatus true (dari 3) ......... $N_AKTIF"
q "select key || ' = ' || value from fin_settings where key like 'stok_resmi_%' order by key" | sed 's/^/    /'
if [ "$N_JURNAL" -gt 0 ]; then
  echo "TOLAK: sudah ada jurnal posting dokumen stok resmi -> JANGAN rollback ke kode lama (tidak ada jalur pembalikan). Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner."
  exit 1
fi
if [ "$N_AKTIF" -gt 0 ]; then
  echo "PERHATIAN: ada sakelar menyala tetapi belum ada jurnal. Matikan dulu lewat PATCH /api/finance/settings (stok_resmi_*_aktif=false) sebelum atau sesudah rollback; kode lama mengabaikannya."
fi
echo "AMAN: belum ada jurnal posting stok resmi -> rollback KODE diperbolehkan (tanpa migrasi; baris pengaturan dibiarkan)."
