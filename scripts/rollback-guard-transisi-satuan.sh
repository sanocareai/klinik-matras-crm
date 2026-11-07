#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Transisi satuan bahan" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini.
#   Kode lama TIDAK mengenal penanda satuan per pergerakan (stock_movements.unit_at_entry) maupun dokumen transisi. Selama BELUM ada transisi tersimpan, rollback kode rutin aman: saldo, satuan master, dan jalur stok sama persis.
#   Begitu ADA transisi tersimpan, riwayat pergerakan sebelum transisi masih dalam satuan LAMA tetapi kode lama menampilkannya dengan label satuan master yang BARU (mis. -350 ROLL terbaca -350 METER) dan tidak bisa
#   membedakan periode satuan di laporan lintas-waktu. Saldo (jumlah qty) tetap benar karena transisi menutup saldo lama dan membuka saldo baru, tetapi riwayatnya salah dibaca. Karena itu rollback rutin DITOLAK.
#   Exit: 0 = rollback kode boleh (belum ada transisi, atau tabel belum ada); 3 = DITOLAK (ada transisi tersimpan; keputusan Owner diperlukan; perbaiki ke depan, jangan rollback rutin);
#         2 = guard gagal membaca (anggap perlu diperiksa dulu). Pembacaan dalam transaksi READ ONLY.
#   Izin pengecualian (HANYA atas keputusan Owner, dengan alasan tertulis >= 20 karakter): ROLLBACK_TRANSISI_IZIN="<alasan>" bash scripts/rollback-guard-transisi-satuan.sh  → exit 0 dengan peringatan, dan data transisi TIDAK dibalik.
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}" # GUARD_DB hanya untuk rehearsal (DB sementara); tanpa itu = database production (baca-saja)
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
QR() { Q "BEGIN READ ONLY; $1; COMMIT;" | grep -v -E '^(BEGIN|COMMIT)$' || true; }
ADA="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name = 'material_unit_transitions'")"
[[ "$ADA" =~ ^[0-9]+$ ]] || { echo "GUARD GAGAL: keberadaan tabel rilis tidak terbaca ('$ADA'); periksa dulu."; exit 2; }
if [ "$ADA" = "0" ]; then echo "Transisi satuan: tabel belum ada (migrasi belum terpasang); transisi=0"; echo "GUARD OK: rollback kode tidak berdampak."; exit 0; fi
NT="$(QR "select count(*) from material_unit_transitions")"; NB="$(QR "select count(distinct material_id) from material_unit_transitions")"
NG="$(QR "select count(*) from stock_movements where unit_transition_id is not null")"; NM="$(QR "select count(*) from stock_movements where unit_at_entry is not null")"
for v in "$NT" "$NB" "$NG" "$NM"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "GUARD GAGAL: hitungan bukan angka ('$v'); periksa dulu."; exit 2; }; done
echo "Transisi satuan: dokumen=${NT} (bahan ${NB}); pergerakan penutup/pembuka=${NG}; pergerakan bersatuan (penanda trigger)=${NM}"
if [ "$NT" = "0" ]; then echo "GUARD OK: belum ada transisi tersimpan — rollback kode rutin aman (trigger penanda satuan hanya mengisi kolom nullable baru; kode lama tetap berjalan)."; exit 0; fi
echo "Bahan yang sudah bertransisi (kode | satuan lama → baru | saldo lama → baru | kewajiban konversi terbuka):"
QR "select m.code || ' | ' || t.from_unit::text || ' → ' || t.to_unit::text || ' | ' || t.balance_old::text || ' → ' || t.balance_new::text || ' | ' || jsonb_array_length(t.open_obligations)::text from material_unit_transitions t join materials m on m.id = t.material_id order by t.created_at, m.code" | sed 's/^/  - /'
if [ -n "${ROLLBACK_TRANSISI_IZIN:-}" ] && [ "${#ROLLBACK_TRANSISI_IZIN}" -ge 20 ]; then
  echo "PERINGATAN: rollback kode atas izin Owner ('${ROLLBACK_TRANSISI_IZIN}'). Transisi TIDAK dibalik; kode lama akan membaca riwayat sebelum transisi dengan label satuan baru. Jangan pakai laporan/riwayat lintas-waktu bahan di atas sampai kode baru kembali."
  exit 0
fi
echo "GUARD DITOLAK: ada ${NT} transisi satuan tersimpan. Kode lama akan SALAH MEMBACA satuan riwayat pergerakan bahan di atas (saldo tetap benar, riwayatnya tidak)."
echo "Jangan rollback rutin. Perbaiki ke depan (rilis perbaikan di atas kandidat ini). Pengecualian hanya atas keputusan Owner: ROLLBACK_TRANSISI_IZIN=\"<alasan tertulis>\" bash $0"
exit 3
