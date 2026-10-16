#!/usr/bin/env bash
# GUARD ROLLBACK KODE — PO Uang Muka Supplier (baca-saja). Menolak (exit 1) bila SUDAH ada:
#   - uang muka tertaut PO (fin_purchases.purchase_order_id terisi): kode lama tidak mengenal tautan; pembatalan PO dan koreksi uang muka tidak lagi menjaganya.
#   - penerapan uang muka ke faktur (fin_supplier_bill_advance_applications): kode lama tidak bisa membatalkannya dan koreksi/pembatalan uang muka bisa meninggalkan penerapan yatim
#     (credit_applied faktur tetap terbaca, tetapi jurnal Dr Utang / Cr Uang Muka tidak punya jalur batal).
# Perubahan DATA yang sudah terjadi TIDAK dibalik oleh rollback kode.
set -Eeuo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-klinik}"; DB_NAME="${DB_NAME:-klinik_matras}"; PROJECT="${PROJECT:-klinik-matras}"
cd "$RELEASE_DIR"
q() { SANSS_PERSIST_ROOT="${SANSS_PERSIST_ROOT:-$HOME/klinik-matras}" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U "$DB_USER" -d "$DB_NAME" -At -c "$1"; }
echo "Release aktif: $RELEASE_DIR"
N_DP="$(q "select count(*) from fin_purchases where purchase_order_id is not null")"
N_APP="$(q "select count(*) from fin_supplier_bill_advance_applications")"
for v in "$N_DP" "$N_APP"; do
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hasil pemeriksaan bukan angka: '$v'" >&2; exit 2; }
done
echo "  uang muka tertaut PO ................... $N_DP"
echo "  penerapan uang muka ke faktur .......... $N_APP"
if [ "$N_DP" -gt 0 ] || [ "$N_APP" -gt 0 ]; then
  echo "TOLAK: sudah ada data fitur ini -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner."
  exit 1
fi
echo "AMAN: belum ada uang muka tertaut PO/penerapan -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang)."
