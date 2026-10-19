#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Stock Opname penuh + model waktu" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini.
#   Rollback kode TIDAK menghapus kolom baru pada stock_counts/stock_count_lines, sesi model baru, hasil hitung, waktu pengamatan, maupun penyesuaian yang sudah diposting ke ledger: riwayat tetap utuh dan saldo ledger (SUM(qty)) tetap benar.
#   Yang hilang setelah rollback hanya halaman kerja hitung, pratinjau cakupan, dan aturan waktu. BAHAYANYA: kode lama tidak mengenal sesi model baru. Sesi model baru yang MASIH TERBUKA (SCHEDULED / IN_PROGRESS / WAITING_REVIEW)
#   tidak punya snapshot saldo (system_qty kosong); bila kode lama menjalankan Mulai/Selesaikan pada sesi itu, selisihnya dihitung dari saldo kosong dan menulis penyesuaian KELIRU ke ledger.
#   Guard menolak (exit 1) selama ada sesi model baru yang terbuka — selesaikan atau batalkan dulu lewat Stock Opname. Sesi model baru yang sudah COMPLETED/CANCELLED tidak berbahaya (tidak bisa diubah lagi).
#   Exit 0 = aman (tidak ada sesi model baru terbuka).
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
[ "$(Q "select count(*) from information_schema.columns where table_schema='public' and table_name='stock_counts' and column_name='model_version'")" = "1" ] || { echo "Kolom model_version tidak ada: migrasi Stock Opname penuh belum terpasang — rollback kode tidak berkaitan dengan sesi model baru."; exit 0; }
TERBUKA="$(Q "select count(*) from stock_counts where model_version = 2 and status in ('SCHEDULED','IN_PROGRESS','WAITING_REVIEW')")"
SELESAI="$(Q "select count(*) from stock_counts where model_version = 2 and status = 'COMPLETED'")"
BATAL="$(Q "select count(*) from stock_counts where model_version = 2 and status = 'CANCELLED'")"
LAMA="$(Q "select count(*) from stock_counts where model_version = 1")"
PENYESUAIAN="$(Q "select count(*) from stock_movements m join stock_counts c on c.id = m.stock_count_id where c.model_version = 2")"
for v in "$TERBUKA" "$SELESAI" "$BATAL" "$LAMA" "$PENYESUAIAN"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hitungan guard bukan angka ('$v')"; exit 2; }; done
echo "Sesi hitung: model baru terbuka=${TERBUKA}, selesai=${SELESAI}, dibatalkan=${BATAL}; sesi lama (model 1)=${LAMA}; penyesuaian ledger dari sesi model baru=${PENYESUAIAN}"
if [ "$TERBUKA" != "0" ]; then
  Q "select count_number||' | '||status||' | dibuat '||to_char(created_at,'YYYY-MM-DD HH24:MI') from stock_counts where model_version = 2 and status in ('SCHEDULED','IN_PROGRESS','WAITING_REVIEW') order by created_at" | sed 's/^/   terbuka: /'
  echo "GUARD MENOLAK: ada ${TERBUKA} sesi hitung model baru yang masih terbuka. Selesaikan atau batalkan dulu (Stock Opname), lalu jalankan guard ini lagi."
  exit 1
fi
if [ "$SELESAI" != "0" ] || [ "$PENYESUAIAN" != "0" ]; then
  echo "INFO: ${SELESAI} sesi model baru selesai dan ${PENYESUAIAN} penyesuaian ledger TETAP di database setelah rollback kode (tidak dihapus; saldo ledger tetap benar)."
  echo "INFO: setelah rollback tidak ada halaman kerja/tinjauan model baru; sesi itu tetap terbaca sebagai daftar baris bahan. Jangan menghapus kolom model baru."
fi
echo "GUARD LULUS: tidak ada sesi model baru yang terbuka; rollback kode aman (riwayat hitung dan penyesuaian tidak dihapus)."
exit 0
