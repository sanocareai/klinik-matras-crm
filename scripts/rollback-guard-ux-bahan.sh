#!/usr/bin/env bash
# GUARD ROLLBACK KODE "UX Bahan — usulan bahan katalog + pemakaian sementara" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini.
#   Kode lama TIDAK mengenal tabel material_proposals / unit_provisional_usages: tidak membacanya dan tidak menulisnya. Tabel tetap ada (tidak dihapus) dan TIDAK memengaruhi stok, biaya, atau jurnal.
#   Yang berbahaya setelah rollback kode adalah pekerjaan yang MASIH MENUNGGU dan menjadi tak terlihat:
#     (a) pemakaian sementara berstatus PERLU_REKONSILIASI: bahan sudah terpakai pada unit tetapi belum diselesaikan Gudang — penanda "Perlu rekonsiliasi Gudang" dan bukti "Sudah dikerjakan"-nya hilang dari layar, Gudang tidak lagi diingatkan;
#     (b) usulan bahan MENUNGGU_GUDANG: permintaan Produksi ke Gudang tidak lagi terlihat oleh siapa pun.
#   ATURAN (bila ragu, TOLAK):
#     - kedua tabel belum ada             → LULUS (migrasi belum terpasang: tidak ada yang tersembunyi)
#     - hanya satu dari dua tabel ada     → TOLAK (keadaan tidak dikenal)
#     - ada PERLU_REKONSILIASI atau MENUNGGU_GUDANG → TOLAK (exit 1): selesaikan dulu lewat layar baru (Gudang › Usulan Bahan: setujui/gabung/tolak; tautkan ke pengeluaran stok resmi / "bukan stok Gudang" / batalkan salah input)
#     - semua sudah diputuskan/direkonsiliasi/dibatalkan → boleh (hanya informasi: jumlah catatan; bahan yang sudah dibuat dari usulan tetap di katalog)
#   Exit: 0 = LULUS, 1 = DITOLAK (pesan memuat jumlah, contoh, alasan), 2 = guard sendiri gagal membaca (anggap DITOLAK). Guard ini tidak mengubah data apa pun (transaksi READ ONLY).
#   Bila DITOLAK: jangan rollback kode. Pemulihan yang benar = PERBAIKAN MAJU (kode baru tetap terpasang) sampai antrean itu selesai, baru jalankan guard lagi.
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}" # GUARD_DB hanya untuk rehearsal (DB sementara); tanpa itu = database production (baca-saja)
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
# Seluruh pembacaan di dalam satu transaksi READ ONLY agar guard terbukti tidak dapat menulis.
QR() { Q "BEGIN READ ONLY; $1; COMMIT;" | grep -v -E '^(BEGIN|COMMIT)$' || true; }
ADA="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('material_proposals','unit_provisional_usages')")"
[[ "$ADA" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: jumlah tabel rilis tidak terbaca ('$ADA'); anggap TIDAK aman."; exit 2; }
if [ "$ADA" = "0" ]; then echo "UX Bahan: tabel belum ada (migrasi belum terpasang); usulan=0, pemakaian sementara=0"; echo "GUARD LULUS: tidak ada yang bisa tersembunyi; rollback kode tidak berdampak."; exit 0; fi
[ "$ADA" = "2" ] || { echo "GUARD DITOLAK: hanya ${ADA} dari 2 tabel rilis ada (keadaan tidak dikenal). Jangan rollback; periksa dulu."; exit 1; }
NU="$(QR "select count(*) from material_proposals")"; NUM="$(QR "select count(*) from material_proposals where status = 'MENUNGGU_GUDANG'")"
NS="$(QR "select count(*) from unit_provisional_usages")"; NSP="$(QR "select count(*) from unit_provisional_usages where status = 'PERLU_REKONSILIASI'")"
NSD="$(QR "select count(*) from unit_provisional_usages where status = 'DIREKONSILIASI'")"; NSB="$(QR "select count(*) from unit_provisional_usages where status = 'DIBATALKAN'")"
NASING="$(QR "select count(*) from material_proposals where status not in ('MENUNGGU_GUDANG','DISETUJUI','DIGABUNG','DITOLAK')")"
NASING2="$(QR "select count(*) from unit_provisional_usages where status not in ('PERLU_REKONSILIASI','DIREKONSILIASI','DIBATALKAN')")"
for v in "$NU" "$NUM" "$NS" "$NSP" "$NSD" "$NSB" "$NASING" "$NASING2"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: hitungan guard bukan angka ('$v'); anggap TIDAK aman."; exit 2; }; done
echo "UX Bahan: usulan=${NU} (${NUM} menunggu Gudang); pemakaian sementara=${NS} (${NSP} perlu rekonsiliasi, ${NSD} direkonsiliasi, ${NSB} dibatalkan)"
echo "Bahan yang dibuat dari usulan tetap berada di katalog setelah rollback (hanya baris katalog tanpa saldo; tidak memengaruhi stok/biaya/jurnal)."
if [ "$NASING" != "0" ] || [ "$NASING2" != "0" ]; then echo "GUARD DITOLAK: ada status tidak dikenal (usulan=${NASING}, pemakaian sementara=${NASING2}); anggap TIDAK aman."; exit 1; fi
if [ "$NUM" != "0" ] || [ "$NSP" != "0" ]; then
  echo "GUARD DITOLAK: ${NSP} pemakaian sementara masih PERLU REKONSILIASI dan ${NUM} usulan masih MENUNGGU GUDANG — akan tersembunyi dan terlupakan bila kode di-rollback."
  if [ "$NSP" != "0" ]; then
    echo "Contoh pemakaian sementara (maks 10; kode unit | bahan | jumlah | pencatat | waktu):"
    QR "select u.unit_code || ' | ' || s.name || ' | ' || s.qty::text || ' ' || s.uom || ' | ' || coalesce((select x.name from \"User\" x where x.id = s.recorded_by), '-') || ' | ' || to_char(s.recorded_at,'YYYY-MM-DD HH24:MI') from unit_provisional_usages s join units u on u.id = s.unit_id where s.status = 'PERLU_REKONSILIASI' order by s.recorded_at limit 10" | sed 's/^/  - /'
  fi
  if [ "$NUM" != "0" ]; then
    echo "Contoh usulan bahan menunggu (maks 10; nama | satuan | diajukan):"
    QR "select name || ' | ' || unit || ' | ' || to_char(requested_at,'YYYY-MM-DD HH24:MI') from material_proposals where status = 'MENUNGGU_GUDANG' order by requested_at limit 10" | sed 's/^/  - /'
  fi
  echo "TINDAKAN: JANGAN rollback kode. Pulihkan dengan PERBAIKAN MAJU (kode baru tetap terpasang): Gudang › Usulan Bahan — putuskan usulan; selesaikan pemakaian sementara (tautkan ke pengeluaran resmi / 'bukan stok Gudang') atau batalkan salah input; lalu jalankan guard ini lagi."
  exit 1
fi
echo "GUARD LULUS: tidak ada usulan menunggu dan tidak ada pemakaian sementara yang perlu rekonsiliasi. Tabel dan riwayat TETAP ada (tidak dihapus) tetapi kode lama tidak membacanya; tidak memengaruhi stok, biaya, atau jurnal."
exit 0
