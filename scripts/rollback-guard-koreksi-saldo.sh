#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Koreksi Saldo per Bahan" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini.
#   Kode lama TIDAK mengenal tabel koreksi_saldo_bahan: tidak membacanya dan tidak menulisnya. Tabel tetap ada (tidak dihapus) dan TIDAK memengaruhi stok, nilai Finance, atau jurnal.
#   Yang berisiko pada rollback: permintaan Penyesuaian Stok hasil Koreksi Saldo yang MASIH BERJALAN (Draf / Menunggu persetujuan / Disetujui). Di kode lama permintaan itu tetap dapat disetujui dan diposting,
#   TETAPI penjaga "saldo bergeser" (saldo yang dilihat pengaju harus sama saat disetujui dan diposting) tidak berlaku lagi — selisihnya bisa diposting pada saldo yang sudah berbeda.
#   ATURAN (bila ragu, TOLAK):
#     - tabel koreksi_saldo_bahan belum ada                                             → LULUS (migrasi belum terpasang: tidak ada yang tersembunyi)
#     - tabel ada dan TIDAK ADA permintaan koreksi saldo yang masih berjalan           → LULUS (riwayat yang sudah POSTED/CANCELLED/REJECTED tetap tersimpan; tabel tidak dihapus)
#     - ADA permintaan koreksi saldo yang masih berjalan                                → TOLAK (exit 1): batalkan dulu lewat Penyesuaian Stok (alasan wajib), lalu ulangi guard
#   Exit: 0 = LULUS, 1 = DITOLAK (pesan memuat jumlah, contoh, alasan, pemulihan), 2 = guard sendiri gagal membaca (anggap DITOLAK). Guard ini tidak mengubah data apa pun (transaksi READ ONLY).
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}" # GUARD_DB hanya untuk rehearsal (DB sementara); tanpa itu = database production (baca-saja)
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
# Seluruh pembacaan di dalam satu transaksi READ ONLY agar guard terbukti tidak dapat menulis.
QR() { Q "BEGIN READ ONLY; $1; COMMIT;" | grep -v -E '^(BEGIN|COMMIT)$' || true; }
ADA="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name = 'koreksi_saldo_bahan'")"
[[ "$ADA" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: jumlah tabel rilis tidak terbaca ('$ADA'); anggap TIDAK aman."; exit 2; }
if [ "$ADA" = "0" ]; then echo "Koreksi Saldo: tabel belum ada (migrasi belum terpasang); koreksi=0"; echo "GUARD LULUS: tidak ada yang bisa tersembunyi; rollback kode tidak berdampak."; exit 0; fi
NT="$(QR "select count(*) from koreksi_saldo_bahan")"
NJ="$(QR "select count(*) from koreksi_saldo_bahan k join stock_adjustment_requests r on r.id = k.adjustment_request_id where r.status in ('DRAFT','WAITING_APPROVAL','APPROVED')")"
NP="$(QR "select count(*) from koreksi_saldo_bahan k join stock_adjustment_requests r on r.id = k.adjustment_request_id where r.status = 'POSTED'")"
NX="$(QR "select count(*) from koreksi_saldo_bahan k join stock_adjustment_requests r on r.id = k.adjustment_request_id where r.status in ('CANCELLED','REJECTED')")"
NASING="$(QR "select count(*) from koreksi_saldo_bahan k join stock_adjustment_requests r on r.id = k.adjustment_request_id where r.status not in ('DRAFT','WAITING_APPROVAL','APPROVED','POSTED','CANCELLED','REJECTED')")"
for v in "$NT" "$NJ" "$NP" "$NX" "$NASING"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: hitungan guard bukan angka ('$v'); anggap TIDAK aman."; exit 2; }; done
echo "Koreksi Saldo: konteks tercatat=${NT} (${NJ} masih berjalan, ${NP} sudah diposting ke stok, ${NX} dibatalkan/ditolak)"
echo "Data ini TIDAK memengaruhi stok, valuasi Finance, atau jurnal; yang berisiko pada rollback adalah hilangnya penjaga saldo bergeser untuk permintaan yang masih berjalan (lihat kepala skrip)."
if [ "$NASING" != "0" ]; then echo "GUARD DITOLAK: ada status permintaan tidak dikenal (${NASING}); anggap TIDAK aman."; exit 1; fi
if [ "$NJ" = "0" ]; then
  echo "GUARD LULUS: tidak ada koreksi saldo yang masih berjalan. Tabel tetap ada (tidak dihapus); riwayat koreksi yang sudah selesai tetap tersimpan."
  exit 0
fi
echo "GUARD DITOLAK: rollback kode RUTIN TIDAK DIPERBOLEHKAN — ada ${NJ} koreksi saldo yang masih berjalan:"
echo "  - di kode lama permintaan itu tetap dapat disetujui/diposting TANPA penjaga saldo bergeser (selisih dapat diposting pada saldo yang sudah berbeda dari yang dilihat pengaju)."
echo "Contoh (maks 10; nomor | bahan | status | selisih):"
QR "select r.adjustment_number || ' | ' || m.code || ' | ' || r.status::text || ' | ' || k.selisih::text from koreksi_saldo_bahan k join stock_adjustment_requests r on r.id = k.adjustment_request_id join materials m on m.id = k.material_id where r.status in ('DRAFT','WAITING_APPROVAL','APPROVED') order by r.created_at limit 10" | sed 's/^/  - /'
echo "PEMULIHAN (perbaikan maju atau pembatalan terkendali):"
echo "  1. Batalkan tiap permintaan di atas lewat Gudang → Penyesuaian Stok (PATCH /api/inventory/adjustments/:id/cancel, alasan wajib), lalu jalankan guard ini lagi."
echo "  2. Atau biarkan kode baru terpasang dan perbaiki lewat rilis perbaikan di atas kode baru (hotfix)."
echo "  3. Bila Owner tetap memutuskan rollback: itu keputusan tertulis di luar skrip ini; rollback kode saja tidak menghapus tabel, dan pemulihan penuh dari backup MENGHAPUS semua perubahan sesudah backup."
exit 1
