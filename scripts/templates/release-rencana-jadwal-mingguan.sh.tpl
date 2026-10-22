#!/usr/bin/env bash
# RILIS "RENCANA PRODUKSI — JADWAL MINGGUAN (Rencana Admin tanpa Run) + BAHAN RUANG KERJA UNIT (Catat pemakaian aktual, komponen lama dari unit pelanggan, Ringkasan)" — BACKEND + WEB + 2 MIGRASI ADITIF (3 tabel baru kosong: jadwal Admin per unit + riwayat jadwal append-only + komponen lama append-only). FAIL-CLOSED. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA).
#   Kode: kalender mingguan (Senin–Sabtu 72 slot, Minggu libur) + antrean per tindakan; Admin menjadwalkan unit TANPA mengaktifkan Pelaksanaan Meja (tidak membuka Run/tahap/QC/penerimaan/pemakaian bahan/stok/jurnal/pesan); kapasitas meja dihitung bersama rencana Meja;
#   undo + riwayat; aktivasi Pelaksanaan Meja mengambil alih jadwal Admin (satu sumber kebenaran); ekspor Excel (Tanggal Jadwal, Status Rencana, Mode pelaksanaan). Target selesai + prioritas tetap di Unit, PIC meja dari PIC harian meja (tidak ada salinan).
#   Status kerja administratif: pemakaian aktual yang BERHASIL tercatat (bahan baru lewat jalur stok resmi / komponen lama "dipakai kembali") → "Sudah dikerjakan" (DITURUNKAN dari fakta saat dibaca: tanpa baris status baru, tanpa jadwal fiktif, tanpa Run/QC; koreksi tidak menghapus faktanya; rollback kode otomatis kembali ke tampilan lama tanpa sisa data).
#   Bahan: Catat pemakaian aktual tanpa Rencana wajib (bahan baru dari Gudang = jalur stok resmi tepat sekali; komponen lama dari unit ini = milik pelanggan, BUKAN stok: tanpa Material Issue/penerimaan/pergerakan/reservasi/jurnal/biaya), koreksi berjejak, Ringkasan Unit, ekspor Excel dua sumber.
#   Migrasi: 3 CREATE TABLE baru (kosong) + 8 indeks (2 unik parsial) + 6 FK ON DELETE RESTRICT + 2 trigger append-only yang memakai fungsi production_adopsi_append_only() YANG SUDAH ADA live. Tidak ada ALTER TABLE pada tabel lama, tidak ada backfill, tidak ada perubahan data lama.
#   Produksi: rilis ini TIDAK membuat jadwal, order, penerimaan, Run, serah-terima, pergerakan stok, jurnal, job, atau pesan pelanggan; smoke hanya baca + penolakan sebelum menyentuh data.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, pin sha256 migrasi, pemindai DDL + mutan negatif, tepat 2 migrasi pending) → (2) audit produksi baca-saja + sidik jari → (3) backup + restore nyata
#              → (4) build web + image → (5) REHEARSAL (restore nyata, migrasi dengan image baru, uji constraint/trigger/FK, kode baru terhadap data restore, sidik jari sebelum=sesudah)
#              → (6) migrate deploy produksi SATU kali (backend lama tetap melayani) → (7) switch → (8) verifikasi + smoke baca-saja.
#
#   cat scripts/release-rencana-jadwal-mingguan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rjm.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rjm.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah (tanpa backup, tanpa DB sementara)
#   ssh ubuntu@43.133.152.6 'bash /tmp/rjm.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only'      # backup NYATA + restore ke DB sementara + migrasi (SQL dari git) + uji; TANPA build/release dir/migrasi produksi
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rjm.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-penuh > /tmp/rjm.out 2>&1 < /dev/null &'   # build web + image BERTAG REHEARSAL, restore nyata, migrasi, smoke, skenario pada klon, TES INTEGRASI terarah (Postgres sekali-pakai), guard rollback; production TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rjm.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/rjm.out 2>&1 < /dev/null &'                    # rilis penuh: WAJIB ada bukti --rehearsal-penuh LULUS untuk SHA + baseline yang sama (<36 jam)
#
# ROLLBACK KODE: TIDAK otomatis aman. Kode lama tidak membaca tabel jadwal; selama masih ada jadwal Admin BERLAKU (ACTIVE) rollback kode berbahaya (jadwal tersembunyi + kode lama dapat membuat rencana Meja kedua). Jalankan dulu scripts/rollback-guard-rencana-jadwal-mingguan.sh (baca-saja):
#   LULUS (exit 0) hanya bila tidak ada jadwal ACTIVE dan setiap jadwal ADOPTED terbukti punya rencana Meja sah; DITOLAK (exit 1) mencetak jumlah, contoh unit, dan alasan. Bila ditolak, pemulihan = PERBAIKAN MAJU (kode baru tetap terpasang) sampai jadwal itu diselesaikan, baru guard dijalankan lagi.
#   Rollback kode (bila guard lulus) TIDAK menghapus tabel/riwayat; yang hilang hanya tampilan kalender mingguan, antrean per tindakan, dan riwayat/undo jadwal Admin.
# (dibangkitkan oleh scripts/gen-release-rencana-jadwal-mingguan.cjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang; templat sha256 @@TEMPLATE_SHA@@)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-@@CAND_BRANCH@@}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="@@MIGS@@"
# Jumlah migrasi pada pohon kandidat (= jumlah migrasi terpasang di production SESUDAH rilis ini). Dipakai gerbang keadaan: LANJUT menuntut tepat jumlah ini terpasang.
MIG_N_KANDIDAT="@@MIG_N_KANDIDAT@@"
# Migrasi yang BOLEH bernama lebih lama daripada migrasi baseline terbaru (diaudit mandiri; dibuktikan Prisma menerapkannya setelah migrasi yang lebih baru terpasang). Kosong = harus terurut setelah baseline.
MIG_URUT_LAMA_OK="@@MIG_OOO@@"
# Hasil pemindai DDL untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='@@SCAN_EXPECT@@'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index dan tanpa nomor baris hunk) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="@@SCHEMA_DIFF_SHA@@"
# Migrasi live terakhir yang HARUS sudah terpasang di produksi dan ada di kandidat (Produksi: admin override siap kirim). Bila lebih baru muncul di produksi, gabungkan baseline terbaru dulu.
LIVE_MIG_TERAKHIR="@@LIVE_MIG_TERAKHIR@@"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard rollback). Apa pun di luar daftar = berhenti.
ALLOWED_RE='@@ALLOWED_RE@@'
BACKEND_SRC_EXPECT="@@BACKEND_SRC@@"
FRONTEND_SRC_EXPECT="@@FRONTEND_SRC@@"
# Berkas pelindung: identik dengan baseline (rilis ini tidak menyentuhnya).
GUARD_UNCHANGED="@@GUARD_UNCHANGED@@"
# Tes integrasi terarah (Produksi, unit, workshop, PKR/Sales, Gudang, Delivery) yang dijalankan di rehearsal-penuh pada Postgres sekali-pakai: berkas pinned + jumlah tes yang HARUS lulus semuanya.
TES_FILES="@@TES_FILES@@"
TES_N_EXPECT="@@TES_N_EXPECT@@"
# Commit Produksi (admin override siap kirim), Riwayat Referensi, dan bukti serah yang sudah live: HARUS leluhur kandidat (rilis tidak boleh menghilangkannya).
LIVE_ANCESTORS="@@LIVE_ANCESTORS@@"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
PREFLIGHT_ONLY=0
REHEARSAL_ONLY=0
REHEARSAL_PENUH=0
TAHAN_UI=0
BACKUP_PRA=""; SHA_PRA=""   # --backup-pra / --sha-pra: backup NYATA sebelum rilis (state 263) untuk jalur rehearsal "pra" saat production sudah LANJUT (265)
CAND_DIR="$NEW_DIR"   # sumber kode kandidat untuk rehearsal: release dir (rilis penuh) atau direktori kerja sementara (--rehearsal-penuh)
for a in "$@"; do
  [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; [ "$a" = "--rehearsal-only" ] && REHEARSAL_ONLY=1; [ "$a" = "--rehearsal-penuh" ] && REHEARSAL_PENUH=1
  case "$a" in --tahan-ui=*) TAHAN_UI="${a#--tahan-ui=}";; --backup-pra=*) BACKUP_PRA="${a#--backup-pra=}";; --sha-pra=*) SHA_PRA="${a#--sha-pra=}";; esac
done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/rencana-jadwal-mingguan-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  \033[33mPERHATIAN\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
gagal_reh() { reh_drop; die "$@"; }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }

# Struktur 3 tabel rilis (KOSONG; FK RESTRICT, CHECK, indeks [unik parsial], trigger append-only memakai fungsi lama) — SATU definisi dipakai production (keadaan LANJUT, sebelum switch) dan rehearsal.
# $1 = fungsi pembaca SQL (menerima satu argumen SQL, mencetak hasil -At), $2 = fungsi kegagalan (menerima pesan).
struktur_baru() {
  local Q="$1" G="$2"
  [ "$("$Q" "select count(*) from pg_tables where schemaname='public' and tablename in ('production_unit_schedules','production_unit_schedule_events','unit_component_reuse_entries')")" = "3" ] || "$G" "3 tabel baru (jadwal, riwayat jadwal, komponen lama) tidak terpasang"
  [ "$("$Q" "select (select count(*) from production_unit_schedules) + (select count(*) from production_unit_schedule_events) + (select count(*) from unit_component_reuse_entries)")" = "0" ] || "$G" "tabel baru TIDAK kosong setelah migrasi (backfill tidak diizinkan)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ('unit_component_reuse_entries_unit_id_fkey','unit_component_reuse_entries_material_id_fkey') and contype='f' and confdeltype='r' and convalidated")" = "2" ] || "$G" "2 FK komponen lama (unit, bahan katalog) ON DELETE RESTRICT tidak terpasang/tervalidasi"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ('unit_component_reuse_entries_kind_chk','unit_component_reuse_entries_version_chk','unit_component_reuse_entries_source_chk','unit_component_reuse_entries_outcome_chk','unit_component_reuse_entries_qty_chk','unit_component_reuse_entries_name_chk','unit_component_reuse_entries_uom_chk','unit_component_reuse_entries_reason_chk','unit_component_reuse_entries_photos_chk') and contype='c' and convalidated")" = "9" ] || "$G" "9 CHECK komponen lama tidak terpasang/tervalidasi"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ('unit_component_reuse_entries_pkey','unit_component_reuse_entries_item_id_version_key','unit_component_reuse_entries_unit_id_created_at_idx','unit_component_reuse_entries_unit_id_idempotency_key_key')")" = "4" ] || "$G" "4 indeks komponen lama tidak terpasang"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname = 'unit_component_reuse_entries_unit_id_idempotency_key_key' and indexdef like '%UNIQUE%' and indexdef like '%WHERE%'")" = "1" ] || "$G" "indeks unik parsial kunci idempotensi komponen lama tidak terpasang"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname = 'unit_component_reuse_entries_item_id_version_key' and indexdef like '%UNIQUE%'")" = "1" ] || "$G" "versi unik per komponen (UNIQUE item_id, version) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname = 'unit_component_reuse_entries_append_only_trg' and not t.tgisinternal and p.proname = 'production_adopsi_append_only'")" = "1" ] || "$G" "trigger append-only komponen lama (fungsi production_adopsi_append_only) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ('production_unit_schedules_unit_id_fkey','production_unit_schedules_adopted_plan_id_fkey','production_unit_schedule_events_schedule_id_fkey','production_unit_schedule_events_unit_id_fkey') and contype='f' and confdeltype='r' and convalidated")" = "4" ] || "$G" "4 FK ON DELETE RESTRICT tidak terpasang/tervalidasi"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ('production_unit_schedules_status_chk','production_unit_schedules_station_chk','production_unit_schedules_revision_chk','production_unit_schedule_events_kind_chk') and contype='c' and convalidated")" = "4" ] || "$G" "4 CHECK jadwal tidak terpasang/tervalidasi"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ('production_unit_schedules_pkey','production_unit_schedules_unit_id_key','production_unit_schedules_production_date_station_code_idx','production_unit_schedule_events_pkey','production_unit_schedule_events_schedule_id_created_at_idx','production_unit_schedule_events_unit_id_created_at_idx','production_unit_schedule_events_unit_id_idempotency_key_key')")" = "7" ] || "$G" "7 indeks jadwal (2 pkey + 5 indeks) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname = 'production_unit_schedule_events_unit_id_idempotency_key_key' and indexdef like '%UNIQUE%' and indexdef like '%WHERE%'")" = "1" ] || "$G" "indeks unik parsial kunci idempotensi tidak terpasang"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname = 'production_unit_schedules_unit_id_key' and indexdef like '%UNIQUE%'")" = "1" ] || "$G" "satu jadwal per unit (UNIQUE unit_id) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname = 'production_unit_schedule_events_append_only_trg' and not t.tgisinternal and p.proname = 'production_adopsi_append_only'")" = "1" ] || "$G" "trigger append-only riwayat (fungsi production_adopsi_append_only) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_trigger where tgrelid = 'production_unit_schedules'::regclass and not tgisinternal")" = "0" ] || "$G" "tabel jadwal (boleh diubah) memiliki trigger (tidak diharapkan)"
}

# <<TENTUKAN_KEADAAN
# Klasifikasi KEADAAN production — murni (hanya membaca berkas/argumen), diuji di tes skrip. FAIL-CLOSED: selain dua keadaan yang dikenal = TOLAK (cetak "TOLAK: alasan", exit 1).
#   SEGAR  = tidak ada tabel rilis, tidak ada migrasi rilis terpasang, terpasang tepat himpunan baseline, pending tepat migrasi rilis.
#   LANJUT = rilis terhenti SESUDAH migrasi: 3 tabel rilis ada dan KOSONG, SEMUA migrasi rilis terpasang (selesai, tidak di-rollback, 1 langkah, checksum = isi berkas kandidat), terpasang tepat baseline + migrasi rilis, tidak ada pending.
# Argumen: ntab nisi applied cand base kand csok  (applied/cand/base = berkas daftar nama migrasi terurut; kand = nama migrasi rilis dipisah spasi; csok = jumlah migrasi rilis yang selesai+checksum cocok)
tentukan_keadaan() {
  local ntab="$1" nisi="$2" applied="$3" cand="$4" base="$5" kand="$6" csok="$7" n=0 nk=0 m solo lama pend kandurut
  for m in $kand; do n=$((n+1)); if grep -Fxq "$m" "$applied"; then nk=$((nk+1)); fi; done
  kandurut="$(printf '%s\n' $kand | LC_ALL=C sort)"
  solo="$(comm -13 "$cand" "$applied" || true)"
  if [ -n "$solo" ]; then echo "TOLAK: production memiliki migrasi yang TIDAK ada di kandidat: $(printf '%s' "$solo" | tr '\n' ' ')"; return 1; fi
  lama="$(grep -vxF -f <(printf '%s\n' $kand) "$applied" || true)"
  if [ "$lama" != "$(cat "$base")" ]; then echo "TOLAK: migrasi terpasang (di luar migrasi rilis) BUKAN tepat himpunan baseline"; return 1; fi
  pend="$(comm -23 "$cand" "$applied" || true)"
  if [ "$ntab" = "0" ] && [ "$nk" = "0" ]; then
    if [ "$pend" != "$kandurut" ]; then echo "TOLAK: migrasi pending bukan tepat migrasi rilis ini"; return 1; fi
    echo SEGAR; return 0
  fi
  if [ "$ntab" = "3" ] && [ "$nk" = "$n" ] && [ "$n" -ge 1 ]; then
    if [ -n "$pend" ]; then echo "TOLAK: masih ada migrasi pending ($(printf '%s' "$pend" | tr '\n' ' '))"; return 1; fi
    if [ "$csok" != "$n" ]; then echo "TOLAK: status/checksum migrasi rilis tidak sesuai berkas kandidat (${csok} dari ${n} cocok)"; return 1; fi
    if [ "$nisi" != "0" ]; then echo "TOLAK: tabel rilis TIDAK kosong (${nisi} baris)"; return 1; fi
    echo LANJUT; return 0
  fi
  echo "TOLAK: keadaan campuran/tidak dikenal (tabel rilis=${ntab}, migrasi rilis terpasang=${nk} dari ${n})"; return 1
}
# TENTUKAN_KEADAAN>>

LQ() { psql_live -At -c "$1"; }
# Keadaan production SAAT INI (membaca production; menulis daftar ke $BK_DIR/applied-sebelum${1}.txt). Cetak SEGAR | LANJUT | "TOLAK: ..." (exit 1). Dipakai di preflight dan diulang sesaat sebelum migrasi/switch.
keadaan_produksi() {
  local sfx="$1" ntab nisi csok=0 e n pin raw row
  psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum${sfx}.txt" || { echo "TOLAK: gagal membaca migrasi terpasang"; return 1; }
  sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u > "$BK_DIR/cand-pra.txt"
  sg ls-tree --name-only "$BASE_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u > "$BK_DIR/base-pra.txt"
  ntab="$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename in ('production_unit_schedules','production_unit_schedule_events','unit_component_reuse_entries')")"
  [[ "$ntab" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan tabel rilis bukan angka"; return 1; }
  nisi=0; if [ "$ntab" = "3" ]; then nisi="$(psql_live -At -c "select (select count(*) from production_unit_schedules) + (select count(*) from production_unit_schedule_events) + (select count(*) from unit_component_reuse_entries)")"; fi
  [[ "$nisi" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan isi tabel rilis bukan angka"; return 1; }
  for e in $MIGS; do
    n="${e%%:*}"; raw="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${n}/migration.sql" | sha256sum | cut -d' ' -f1)"
    row="$(psql_live -At -c "select checksum||'|'||applied_steps_count::text||'|'||(finished_at is not null)::text||'|'||(rolled_back_at is null)::text from _prisma_migrations where migration_name='${n}'")"
    [ "$row" = "${raw}|1|true|true" ] && csok=$((csok+1))
  done
  tentukan_keadaan "$ntab" "$nisi" "$BK_DIR/applied-sebelum${sfx}.txt" "$BK_DIR/cand-pra.txt" "$BK_DIR/base-pra.txt" "$MIG_LIST" "$csok"
}
[ "$((PREFLIGHT_ONLY + REHEARSAL_ONLY + REHEARSAL_PENUH))" -le 1 ] || die "pilih SATU mode saja (--preflight-only | --rehearsal-only | --rehearsal-penuh)"
[[ "$TAHAN_UI" =~ ^[0-9]+$ ]] || die "--tahan-ui=MENIT harus angka"
[ "$TAHAN_UI" = "0" ] || [ "$REHEARSAL_PENUH" = "1" ] || die "--tahan-ui hanya bersama --rehearsal-penuh"
[ -z "$BACKUP_PRA$SHA_PRA" ] || [ "$REHEARSAL_ONLY$REHEARSAL_PENUH" != "00" ] || die "--backup-pra/--sha-pra hanya untuk --rehearsal-only atau --rehearsal-penuh"
[ -z "$BACKUP_PRA" ] || [[ "$SHA_PRA" =~ ^[0-9a-f]{64}$ ]] || die "--backup-pra wajib disertai --sha-pra=<sha256 64 hex backup itu>"
WS=""; REH_IMG=""; REH_DB=""; NET=""
# Pembersih --rehearsal-penuh (dipanggil di trap EXIT, juga saat gagal): hapus container UI, direktori kerja, image bertag rehearsal (SATU tag itu saja), dan DB sementara bernama rehearsal_rjm_test_*. TIDAK menyentuh production.
cleanup_penuh() {
  [ "$REHEARSAL_PENUH" = "1" ] || return 0
  docker rm -f "rh-rjm-pg-${TS}" >/dev/null 2>&1 || true
  if [ -n "${PREV_DIR:-}" ]; then dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"rehearsal_rjm_test_klon_${TS}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; fi
  if [ -n "${PREV_DIR:-}" ]; then dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"rehearsal_rjm_test_klong_${TS}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; fi
  if [ -n "${WS:-}" ] && [[ "$WS" == "$HOME/release-rehearsal/rjm-"* ]]; then rm -rf -- "$WS" 2>/dev/null || sudo -n rm -rf -- "$WS" 2>/dev/null || true; fi
  if [ -n "${REH_IMG:-}" ] && [[ "$REH_IMG" == *":rehearsal-rjm-"* ]]; then docker rmi "$REH_IMG" >/dev/null 2>&1 || true; fi
  if [[ "${REH_DB:-}" =~ ^rehearsal_rjm_test_(image|git)(pra)?_[0-9_]+$ ]] && [ -n "${PREV_DIR:-}" ]; then dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; fi
  return 0
}

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa)
Image sebelumnya   : ${ROLLBACK_TAG:-<belum ditandai>}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.
LANGKAH WAJIB sebelum rollback KODE setelah switch: jalankan GUARD (baca-saja)
   bash ${NEW_DIR}/scripts/rollback-guard-rencana-jadwal-mingguan.sh
   - exit 0 (LULUS): tidak ada jadwal Admin berlaku; jadwal ADOPTED terbukti punya rencana Meja sah. Baru boleh rollback kode (di bawah).
   - exit 1/2 (DITOLAK): masih ada jadwal Admin berlaku (atau keadaan tidak jelas) — rollback kode TIDAK AMAN walau tabel tetap ada: unit tampil "belum dijadwalkan" di layar lama dan kode lama bisa membuat rencana Meja kedua.
     Jalur pemulihan = PERBAIKAN MAJU (kode baru tetap terpasang): di Rencana Produksi jadwalkan unit tersebut ke Pelaksanaan Meja atau "Keluarkan dari jadwal", lalu jalankan guard lagi. Pemulihan database (di bawah) hanya atas keputusan Owner.
Rollback kode (HANYA setelah guard LULUS; tidak menghapus tabel jadwal, riwayat jadwal, rencana Meja/Run hasil aktivasi, maupun pergerakan stok):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi bersifat ADITIF (3 tabel baru + 8 indeks + 6 FK + 2 trigger append-only): tabel dibiarkan terpasang setelah rollback kode. Komponen lama dari unit pelanggan bukan stok (hanya tersembunyi di layar lama). Jadwal Admin yang sudah selesai (ADOPTED sah / CLEARED) aman; jadwal berlaku TIDAK aman (lihat guard).
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS semua perubahan sesudah backup (jadwal, riwayat, Run, transaksi stok); gunakan hanya atas keputusan Owner.
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && [ "$REHEARSAL_PENUH" = "0" ] && rollback_instructions; cleanup_penuh; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-rencana-jadwal-mingguan.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rjm\.sh\|release-rencana-jadwal-mingguan\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
if [ "$PREFLIGHT_ONLY" = "0" ] && [ "$REHEARSAL_ONLY" = "0" ] && [ "$REHEARSAL_PENUH" = "0" ]; then [ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"; fi

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, pin migrasi, pemindai DDL (+ uji negatif pemindai)"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" "+refs/heads/main:refs/remotes/origin/main" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
# MAIN_LEBIH_MAJU: main boleh memuat commit di atas release aktif asalkan selisih BASE..MAIN hanya scripts/, docs/, dan tes skrip rilis (tidak ada kode aplikasi/prisma/frontend).
MAIN_FILES=""
if ! sg merge-base --is-ancestor "$MAIN_SHA" "$BASE_SHA"; then
  sg merge-base --is-ancestor "$BASE_SHA" "$MAIN_SHA" || die "origin/main (${MAIN_SHA:0:8}) dan baseline ${BASE_SHA:0:8} bercabang — gabungkan lineage terbaru lalu ulangi tes/preflight"
  MAIN_EXTRA="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA" | grep -Ev '^(scripts/|docs/|backend/tests/release[A-Za-z0-9]+\.test\.js$)' || true)"
  [ -z "$MAIN_EXTRA" ] || { printf '%s\n' "$MAIN_EXTRA" | sed 's/^/        /'; die "origin/main memuat perubahan kode yang tidak ada di release aktif — berhenti"; }
  MAIN_FILES="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA")"
  warn "origin/main (${MAIN_SHA:0:8}) lebih maju dari baseline hanya pada scripts/docs ($(printf '%s\n' "$MAIN_FILES" | wc -l) berkas) — ikut diizinkan"
fi
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat ${DEPLOY_SHORT}: rilis akan menghilangkan isi main — gabungkan main ke kandidat dulu"
for A in $LIVE_ANCESTORS; do
  sg cat-file -e "${A}^{commit}" 2>/dev/null || die "commit live ${A:0:8} tidak ada di repo sumber"
  sg merge-base --is-ancestor "$A" "$DEPLOY_SHA" || die "commit live ${A:0:8} BUKAN leluhur kandidat — rilis akan menghilangkan perubahan live; gabungkan baseline terbaru dulu"
done
ok "semua commit live yang wajib (Status Produksi + Penerimaan Workshop, Order Produksi adopsi Admin, Produksi override, Riwayat Referensi, bukti serah, Koreksi Gudang, UX Gudang, Sidebar, Stock Opname) adalah leluhur kandidat"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" | { grep -Fvx -f <(printf '%s\n' "$MAIN_FILES") || true; } || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -q 'production-evidence' || die "artefak foto uji ikut ter-commit (backend/data/production-evidence) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -q 'receipt-proofs' || die "artefak unggahan uji ikut ter-commit (backend/data/receipt-proofs) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)\.env' || die "berkas .env ikut ter-commit — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -q '^driver-mobile/' || die "driver-mobile berubah — rilis ini tidak membawa app Driver"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
MIG_LIST=""; EXPECT_PRISMA=""; NLX="$(printf '\nx')"; NLX="${NLX%x}"
for e in $MIGS; do MIG_LIST="$MIG_LIST ${e%%:*}"; EXPECT_PRISMA="${EXPECT_PRISMA:+${EXPECT_PRISMA}${NLX}}backend/prisma/migrations/${e%%:*}/migration.sql"; done
EXPECT_PRISMA="${EXPECT_PRISMA}${NLX}backend/prisma/schema.prisma"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat migrasi rilis ini (1 migrasi + schema.prisma yang diaudit)"; }
# Migrasi yang sudah ada di baseline TIDAK boleh diubah/dihapus (yang sudah pernah diterapkan di produksi): hanya penambahan.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
[ "$(sg diff -U0 --no-color "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | grep -v '^index ' | sed -E 's/^@@ [^@]*@@.*$/@@/' | { cat; echo; } | sha256sum | cut -d' ' -f1)" = "$SCHEMA_DIFF_SHA" ] || die "diff schema.prisma BERBEDA dari yang diaudit (pin SCHEMA_DIFF_SHA) — audit ulang lalu perbarui pin"
ok "schema.prisma: diff identik dengan yang diaudit (aditif: 3 model baru ProductionUnitSchedule/ProductionUnitScheduleEvent/UnitComponentReuseEntry + relasi balik pada Unit, Material, dan ProductionRunPlan)"
ALL_SQL=""
for e in $MIGS; do
  n="${e%%:*}"; pin="${e##*:}"
  [[ "$n" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $n"
  s="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${n}/migration.sql" | tr -d '\r')"
  h="$(printf '%s\n' "$s" | sha256sum | cut -d' ' -f1)"
  [ "$pin" = "$h" ] || die "isi migrasi ${n} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
  ok "migrasi ${n}: sha256 cocok pin (${h:0:12})"
  ALL_SQL="$ALL_SQL
$s"
done
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
@@SCAN_JS@@
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "2 migrasi: DDL aditif (3 CREATE TABLE baru kosong, 8 indeks [2 unik parsial], 6 FK ON DELETE RESTRICT, 2 trigger append-only yang memakai fungsi production_adopsi_append_only() YANG SUDAH ADA live); tanpa ALTER pada tabel lama, tanpa DROP/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT/EXTENSION/CREATE FUNCTION"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE units" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "DROP TABLE production_run_plans_v2" "$(tambah_stmt 'DROP TABLE "production_run_plans_v2";')"
harus_ditolak "DROP TABLE tabel baru" "$(tambah_stmt 'DROP TABLE "production_unit_schedules";')"
harus_ditolak "UPDATE units (backfill)" "$(tambah_stmt "UPDATE \"units\" SET \"status\" = 'RECEIVED';")"
harus_ditolak "UPDATE production_run_plans_v2" "$(tambah_stmt "UPDATE \"production_run_plans_v2\" SET \"revision\" = 1;")"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "units";')"
harus_ditolak "INSERT ke tabel baru (backfill jadwal)" "$(tambah_stmt "INSERT INTO \"production_unit_schedules\" (id) VALUES ('x');")"
harus_ditolak "INSERT ... SELECT ke tabel baru (backfill dari units)" "$(tambah_stmt 'INSERT INTO "production_unit_schedules" SELECT * FROM "units";')"
harus_ditolak "INSERT ke tabel lama" "$(tambah_stmt "INSERT INTO \"stock_movements\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "units";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "units" DROP COLUMN "status";')"
harus_ditolak "ADD COLUMN pada units" "$(tambah_stmt 'ALTER TABLE "units" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada production_run_plans_v2" "$(tambah_stmt 'ALTER TABLE "production_run_plans_v2" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada tabel baru" "$(tambah_stmt 'ALTER TABLE "production_unit_schedules" ADD COLUMN "x" TEXT;')"
harus_ditolak "SET DEFAULT pada tabel baru" "$(tambah_stmt 'ALTER TABLE "production_unit_schedules" ALTER COLUMN "revision" SET DEFAULT 1;')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "units" ALTER COLUMN "status" TYPE TEXT;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "units" RENAME COLUMN "status" TO "s";')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "salinan tabel lama (CREATE TABLE AS)" "$(tambah_stmt 'CREATE TABLE "production_unit_schedules_copy" AS SELECT * FROM "units";')"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("status");')"
harus_ditolak "indeks unik pada tabel lama" "$(tambah_stmt 'CREATE UNIQUE INDEX "x_uq" ON "production_run_plans_v2"("id");')"
harus_ditolak "FK ke tabel lain" "$(tambah_stmt 'ALTER TABLE "production_unit_schedules" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "FK CASCADE jadwal -> units" "$(printf '%s\n' "$ALL_SQL" | sed 's/production_unit_schedules_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT/production_unit_schedules_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE/')"
harus_ditolak "FK CASCADE jadwal -> rencana Meja" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "production_run_plans_v2"("id") ON DELETE RESTRICT/REFERENCES "production_run_plans_v2"("id") ON DELETE CASCADE/')"
harus_ditolak "FK SET NULL riwayat -> jadwal" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "production_unit_schedules"("id") ON DELETE RESTRICT/REFERENCES "production_unit_schedules"("id") ON DELETE SET NULL/')"
harus_ditolak "FK CASCADE riwayat -> units" "$(printf '%s\n' "$ALL_SQL" | sed 's/production_unit_schedule_events_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT/production_unit_schedule_events_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE/')"
harus_ditolak "CHECK status jadwal dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'production_unit_schedules_status_chk')"
harus_ditolak "CHECK meja dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'production_unit_schedules_station_chk')"
harus_ditolak "CHECK revisi dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'production_unit_schedules_revision_chk')"
harus_ditolak "CHECK jenis riwayat dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'production_unit_schedule_events_kind_chk')"
harus_ditolak "CHECK status dilonggarkan" "$(printf '%s\n' "$ALL_SQL" | sed "s/'ACTIVE','CLEARED','ADOPTED'/'ACTIVE','CLEARED','ADOPTED','LIAR'/")"
harus_ditolak "CHECK jenis dilonggarkan" "$(printf '%s\n' "$ALL_SQL" | sed "s/'UNDONE','ADOPTED'/'UNDONE','ADOPTED','LIAR'/")"
harus_ditolak "CHECK revisi dilonggarkan" "$(printf '%s\n' "$ALL_SQL" | sed 's/"revision" >= 1/"revision" >= 0/')"
harus_ditolak "indeks unik kunci idempotensi kehilangan WHERE" "$(printf '%s\n' "$ALL_SQL" | sed 's/ WHERE "idempotency_key" IS NOT NULL//')"
harus_ditolak "trigger append-only riwayat dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'production_unit_schedule_events_append_only_trg')"
harus_ditolak "trigger memakai fungsi lain" "$(printf '%s\n' "$ALL_SQL" | sed 's/EXECUTE FUNCTION production_adopsi_append_only()/EXECUTE FUNCTION evil_fn()/')"
harus_ditolak "trigger dilonggarkan (hanya UPDATE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/BEFORE UPDATE OR DELETE ON "production_unit_schedule_events"/BEFORE UPDATE ON "production_unit_schedule_events"/')"
harus_ditolak "trigger append-only dipasang pada tabel jadwal (harus boleh diubah)" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE UPDATE OR DELETE ON "production_unit_schedules" FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();')"
harus_ditolak "DISABLE TRIGGER" "$(tambah_stmt 'ALTER TABLE "production_unit_schedule_events" DISABLE TRIGGER ALL;')"
harus_ditolak "DROP TRIGGER" "$(tambah_stmt 'DROP TRIGGER "production_unit_schedule_events_append_only_trg" ON "production_unit_schedule_events";')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "units" DROP CONSTRAINT "units_pkey";')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"UnitStatus\" ADD VALUE IF NOT EXISTS 'LIAR';")"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "production_unit_schedules" TO PUBLIC;')"
harus_ditolak "REVOKE" "$(tambah_stmt 'REVOKE ALL ON "units" FROM PUBLIC;')"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "fungsi append-only ditimpa" "$(tambah_stmt 'CREATE OR REPLACE FUNCTION production_adopsi_append_only() RETURNS TRIGGER AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "trigger pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "units" FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();')"
harus_ditolak "pernyataan ganda" "$(tambah_stmt 'CREATE UNIQUE INDEX "production_unit_schedules_unit_id_key" ON "production_unit_schedules"("unit_id");')"
harus_ditolak "DROP TABLE komponen lama" "$(tambah_stmt 'DROP TABLE "unit_component_reuse_entries";')"
harus_ditolak "INSERT ke komponen lama (backfill)" "$(tambah_stmt "INSERT INTO \"unit_component_reuse_entries\" (id) VALUES ('x');")"
harus_ditolak "ALTER TABLE materials (tabel lama)" "$(tambah_stmt 'ALTER TABLE "materials" ADD COLUMN "x" TEXT;')"
harus_ditolak "CHECK sumber komponen dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'unit_component_reuse_entries_source_chk')"
harus_ditolak "CHECK sumber dilonggarkan (lintas unit)" "$(printf '%s\n' "$ALL_SQL" | sed "s/\"source\" = 'OWN_UNIT'/\"source\" IN ('OWN_UNIT','OTHER_UNIT')/")"
harus_ditolak "CHECK versi komponen dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'unit_component_reuse_entries_version_chk')"
harus_ditolak "CHECK alasan koreksi dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'unit_component_reuse_entries_reason_chk')"
harus_ditolak "CHECK jumlah dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'unit_component_reuse_entries_qty_chk')"
harus_ditolak "CHECK hasil dilonggarkan" "$(printf '%s\n' "$ALL_SQL" | sed "s/'KEPT_WITH_UNIT','DISCARDED'/'KEPT_WITH_UNIT','DISCARDED','LIAR'/")"
harus_ditolak "FK CASCADE komponen -> units" "$(printf '%s\n' "$ALL_SQL" | sed 's/unit_component_reuse_entries_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT/unit_component_reuse_entries_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE/')"
harus_ditolak "FK komponen -> materials SET NULL" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "materials"("id") ON DELETE RESTRICT/REFERENCES "materials"("id") ON DELETE SET NULL/')"
harus_ditolak "trigger append-only komponen dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'unit_component_reuse_entries_append_only_trg')"
harus_ditolak "trigger komponen dilonggarkan (hanya UPDATE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/BEFORE UPDATE OR DELETE ON "unit_component_reuse_entries"/BEFORE UPDATE ON "unit_component_reuse_entries"/')"
harus_ditolak "trigger append-only pada tabel liar" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE UPDATE OR DELETE ON "materials" FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();')"
harus_ditolak "blok DO liar" "$(tambah_stmt 'DO $$ BEGIN DELETE FROM "units"; END $$;')"
[ "$NEG" -ge 50 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 50)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ADD-DROP-ALTER-RENAME COLUMN/tabel-indeks-FK-trigger-fungsi liar/CASCADE/SET NULL/CHECK dibuang atau dilonggarkan/WHERE indeks parsial dibuang/trigger dibuang atau diganti fungsi/DISABLE/GRANT/REVOKE/EXTENSION/DO liar/pernyataan ganda) SEMUANYA ditolak"
for f in $GUARD_UNCHANGED; do
  [ "$(sg rev-parse "${BASE_SHA}:${f}")" = "$(sg rev-parse "${DEPLOY_SHA}:${f}")" ] || die "${f} berbeda antara baseline dan kandidat — rilis ini tidak boleh menyentuhnya (ledger, jurnal, otorisasi, status lintas workspace, Produksi V2, Delivery, Stock Count)"
done
ok "$(printf '%s\n' $GUARD_UNCHANGED | wc -w) berkas pelindung (ledger stok, jurnal Finance, otorisasi/izin, fungsi status lintas workspace, Produksi V2 tahap/QC, Delivery override, Stock Count) identik dengan baseline"
# Urutan migrasi: Prisma `migrate deploy` menerapkan SEMUA migrasi yang belum terpasang menurut nama dan TIDAK menolak migrasi baru yang bernama lebih LAMA daripada migrasi yang sudah terpasang (dibuktikan 20 Okt 2026: 261 migrasi live
# → +20261221090000 di bawah 20261222090000 = "All migrations have been successfully applied", status up to date; dibuktikan lagi pada restore production di rehearsal). Migrasi yang sudah live TIDAK diubah/diganti-nama.
# Syarat: bila nama migrasi rilis ini lebih lama dari migrasi baseline terbaru, ia WAJIB tercantum di MIG_URUT_LAMA_OK (sudah diaudit: mandiri, tidak bergantung pada migrasi yang lebih baru, hanya tabel baru), dan baseline terbaru = yang diaudit.
MIG_BASE_MAX="$(sg ls-tree --name-only "$BASE_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort | tail -n 1)"
[ "$MIG_BASE_MAX" = "$LIVE_MIG_TERAKHIR" ] || die "migrasi terbaru di baseline (${MIG_BASE_MAX}) bukan yang diaudit (${LIVE_MIG_TERAKHIR}) — baseline bergeser; audit ulang"
MIG_URUT_NOTE=""
for e in $MIGS; do
  n="${e%%:*}"
  if [[ "$n" > "$MIG_BASE_MAX" ]]; then continue; fi
  case " $MIG_URUT_LAMA_OK " in *" $n "*) MIG_URUT_NOTE="${MIG_URUT_NOTE} ${n} (bernama lebih LAMA dari ${MIG_BASE_MAX}; urutan tidak-berurutan sudah diaudit aman)";; *) die "migrasi ${n} bernama lebih lama dari migrasi baseline terbaru (${MIG_BASE_MAX}) dan TIDAK tercantum di MIG_URUT_LAMA_OK";; esac
  ! sg ls-tree --name-only "$BASE_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -Fx "$n" >/dev/null || die "migrasi ${n} sudah ada di baseline"
done
ok "urutan migrasi:${MIG_LIST} ${MIG_URUT_NOTE:-terurut setelah migrasi baseline terbaru (${MIG_BASE_MAX})}"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHA:0:8}; produksi bergeser — berhenti"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
ok "health sehat; bundel publik = dist release aktif (${PREV_INDEX})"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung"
# Prasyarat skema: tabel yang dibaca/ditulis kode baru HARUS sudah ada; objek rilis ini belum boleh ada.
for T in units stock_movements materials v2_commands activity_events jobs production_runs_v2 production_operation_runs_v2 production_step_evidence_v2 unit_stage_logs quality_inspections_v2 unit_custody_handoffs_v2 material_issues material_reservations_v2 payments order_groups '"User"' user_roles fin_journal_entries fin_journal_lines goods_receipts; do
  [ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename='${T//\"/}'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from pg_proc where proname = 'production_adopsi_append_only'")" = "1" ] || die "fungsi production_adopsi_append_only HARUS sudah ada di produksi (dibuat migrasi 20261221090000; migrasi ini hanya memakainya)"
[ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename in ('units','production_run_plans_v2','production_unit_work_progress','unit_workshop_receipts')")" = "4" ] || die "tabel prasyarat (units, production_run_plans_v2, adopsi Admin, penerimaan workshop) tidak lengkap di produksi"
N_MIG="$(printf '%s\n' $MIG_LIST | grep -c .)"
KEADAAN_TEKS="$(keadaan_produksi "")" || die "${KEADAAN_TEKS}"
KEADAAN="$KEADAAN_TEKS"; case "$KEADAAN" in SEGAR|LANJUT) ;; *) die "keadaan production tidak dikenal: ${KEADAAN}";; esac
grep -Fx "$LIVE_MIG_TERAKHIR" "$BK_DIR/applied-sebelum.txt" >/dev/null || die "migrasi live ${LIVE_MIG_TERAKHIR} belum terpasang di produksi — baseline bukan yang diharapkan"
MIG_SEBELUM="$(wc -l < "$BK_DIR/base-pra.txt" | tr -d ' ')"; MIG_TERPASANG="$(wc -l < "$BK_DIR/applied-sebelum.txt" | tr -d ' ')"
[ "$(wc -l < "$BK_DIR/cand-pra.txt" | tr -d ' ')" = "$MIG_N_KANDIDAT" ] && [ "$MIG_N_KANDIDAT" = "$(( MIG_SEBELUM + N_MIG ))" ] || die "jumlah migrasi pohon kandidat ($(wc -l < "$BK_DIR/cand-pra.txt" | tr -d ' ')) bukan pin ${MIG_N_KANDIDAT} = baseline ${MIG_SEBELUM} + ${N_MIG}"
if [ "$KEADAAN" = "SEGAR" ]; then
  [ "$MIG_TERPASANG" = "$MIG_SEBELUM" ] || die "keadaan SEGAR tetapi migrasi terpasang ${MIG_TERPASANG} != baseline ${MIG_SEBELUM}"
  ok "keadaan production: SEGAR — migrasi terpasang ${MIG_SEBELUM} (tepat baseline), tidak ada tabel rilis, pending = tepat:${MIG_LIST}"
else
  [ "$MIG_TERPASANG" = "$MIG_N_KANDIDAT" ] || die "keadaan LANJUT tetapi migrasi terpasang ${MIG_TERPASANG} != ${MIG_N_KANDIDAT}"
  struktur_baru LQ die
  ok "keadaan production: LANJUT — rilis sebelumnya terhenti SESUDAH migrasi: ${MIG_TERPASANG} migrasi terpasang (baseline ${MIG_SEBELUM} + ${N_MIG} migrasi rilis, selesai, checksum = isi berkas kandidat), 3 tabel rilis ada, KOSONG, struktur lengkap tervalidasi; migrasi TIDAK akan diulang"
fi
# Dampak migrasi: hanya 2 CREATE TABLE tabel baru kosong + FK ke units/production_run_plans_v2 (FK pada tabel kosong = tanpa validasi baris; tabel lama TIDAK disentuh sama sekali, tanpa kunci pada tabel aktif selain ACCESS SHARE pada units/production_run_plans_v2 saat FK dibuat).
UNIT_N="$(psql_live -At -c "select count(*) from units")"; SM_N="$(psql_live -At -c "select count(*) from stock_movements")"; MAT_N="$(psql_live -At -c "select count(*) from materials")"
[[ "$UNIT_N" =~ ^[0-9]+$ ]] && [[ "$SM_N" =~ ^[0-9]+$ ]] && [[ "$MAT_N" =~ ^[0-9]+$ ]] || die "audit awal bukan angka"
[ "$UNIT_N" -le 4900 ] || die "jumlah unit ${UNIT_N} mendekati batas ekspor Excel (5000) — tinjau batas BATAS_EKSPOR sebelum rilis"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"
ok "dampak migrasi: units ${UNIT_N} baris; stock_movements ${SM_N}; materials ${MAT_N}; DB ${DB_BYTES} byte — hanya 3 tabel baru kosong (tabel lama tidak diubah; keadaan ${KEADAAN}); ekspor Excel memuat seluruh ${UNIT_N} unit (batas 5000)"
ADM_AKTIF="$(psql_live -At -c "select count(*) from \"User\" where active and (role::text in ('ADMIN','OWNER') or id in (select user_id from user_roles where role::text in ('ADMIN','OWNER')))")"
LEAD_AKTIF="$(psql_live -At -c "select count(*) from \"User\" where active and (role::text = 'PRODUCTION_LEAD' or id in (select user_id from user_roles where role::text = 'PRODUCTION_LEAD'))")"
PLAN_AKTIF="$(psql_live -At -c "select count(*) from production_run_plans_v2 where status::text <> 'CANCELLED' and production_date is not null")"
[[ "$ADM_AKTIF" =~ ^[0-9]+$ ]] && [[ "$LEAD_AKTIF" =~ ^[0-9]+$ ]] && [[ "$PLAN_AKTIF" =~ ^[0-9]+$ ]] || die "audit akun/rencana bukan angka"
ok "akun aktif yang akan memakai fitur: ADMIN/OWNER ${ADM_AKTIF} + Kepala Produksi ${LEAD_AKTIF} (menjadwalkan, undo, keluarkan); rencana Meja bertanggal yang akan tampil di kalender: ${PLAN_AKTIF}; jadwal Admin awal: 0 (rilis tidak membuat jadwal)"
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"
[[ "$BASE_TIDAK_SEIMBANG" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$BASE_TIDAK_SEIMBANG'"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}"
# T0 = jam DB (UTC) 5 menit lalu. Dokumen pembanding dibekukan: hanya yang dibuat sebelum T0 (transaksi sah baru tidak diperbandingkan).
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
# Tabel pembanding beku: HANYA data append-only atau daftar id yang tidak berubah oleh operasi harian, dibekukan pada T0 (baris yang dibuat sesudah T0 tidak ikut dibandingkan). Tabel yang berubah setiap hari (units, jobs, Run, dst) dibandingkan lewat DAFTAR ID, bukan isi baris.
# Mencakup semua yang TIDAK boleh dibuat/diubah oleh rilis ini: ledger stok (isi penuh) + saldo per bahan, jurnal Finance (induk + baris), pembayaran, penerimaan, Material Issue, reservasi, dan id unit/job/Run/operasi/bukti tahap/log tahap/QC/serah/aktivitas.
FP_BEKU_SQL="$(cat <<FPBEKU
select 'pergerakan_stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'saldo_per_bahan', count(*), md5(coalesce(string_agg(s.material_id::text || ':' || s.q::text, '|' order by s.material_id),'')) from (select material_id, sum(qty) q from stock_movements where created_at < '$T0'::timestamp group by material_id) s
union all select 'jurnal_induk', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from fin_journal_entries x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'id_unit', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from units x where x.created_at < '$T0'::timestamp
union all select 'id_penerimaan', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from goods_receipts x where x.created_at < '$T0'::timestamp
union all select 'id_material_issue', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from material_issues x where x.created_at < '$T0'::timestamp
union all select 'id_reservasi', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from material_reservations_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_job', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from jobs x where x.created_at < '$T0'::timestamp
union all select 'id_run_produksi', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from production_runs_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_operasi_run', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from production_operation_runs_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_bukti_tahap', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from production_step_evidence_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_log_tahap', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from unit_stage_logs x where x.created_at < '$T0'::timestamp
union all select 'id_qc', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from quality_inspections_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_serah_unit', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from unit_custody_handoffs_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_pembayaran', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from payments x where x.created_at < '$T0'::timestamp
union all select 'id_aktivitas', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from activity_events x where x.created_at < '$T0'::timestamp
FPBEKU
)"
FPB_N=17
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "$FPB_N" ] || die "sidik jari dokumen beku tidak ${FPB_N} baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di ${FPB_N} kelompok)"
# Skema tabel LAMA (sidik jari kolom/tipe/nullable/default): tidak boleh berubah oleh migrasi (3 tabel baru dikecualikan).
SKEMA_SQL="select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name not in ('production_unit_schedules','production_unit_schedule_events','unit_component_reuse_entries')"
# Katalog objek (indeks, constraint, trigger) SEMUA tabel LAMA: tidak boleh berubah (objek rilis ini hanya ada pada 2 tabel baru).
KATALOG_SQL="select md5(coalesce(string_agg(x, ',' order by x), '')) from (
 select 'idx:'||tablename||':'||indexname as x from pg_indexes where schemaname='public' and tablename not in ('production_unit_schedules','production_unit_schedule_events','unit_component_reuse_entries')
 union all select 'con:'||conrelid::regclass::text||':'||conname from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text not in ('production_unit_schedules','production_unit_schedule_events','unit_component_reuse_entries')
 union all select 'trg:'||tgrelid::regclass::text||':'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text not in ('production_unit_schedules','production_unit_schedule_events','unit_component_reuse_entries')) k"

say "2b. Sumber node_modules frontend (package.json identik dengan kandidat)"
LOCK_NEW="$BK_DIR/pkg-baru.json"; sg show "${DEPLOY_SHA}:frontend/package.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do
  d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package.json identik"
ok "node_modules build dari ${NM_SRC}"
NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang (tersedia ${AVAIL_KB} KB)"
ok "ruang disk cukup (tersedia ${AVAIL_KB} KB)"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

if [ "$PREFLIGHT_ONLY" = "0" ] && [ "$REHEARSAL_ONLY" = "0" ] && [ "$REHEARSAL_PENUH" = "0" ]; then
  MARK="$HOME/release-backups/.rehearsal-penuh-ok-rencana-jadwal-mingguan-${DEPLOY_SHA}"
  [ -f "$MARK" ] || die "belum ada bukti --rehearsal-penuh LULUS untuk SHA ${DEPLOY_SHORT}: jalankan --rehearsal-penuh dulu"
  grep -qx "BASE=${BASE_SHA}" "$MARK" && grep -qx "DEPLOY=${DEPLOY_SHA}" "$MARK" || die "bukti rehearsal-penuh bukan untuk SHA/baseline ini — ulangi terhadap baseline live saat ini"
  grep -qx "KEADAAN=${KEADAAN}" "$MARK" || die "bukti rehearsal-penuh dibuat untuk keadaan production lain (sekarang ${KEADAAN}) — ulangi rehearsal-penuh"
  if [ "$KEADAAN" = "LANJUT" ]; then grep -qx "JALUR=lanjut+pra" "$MARK" || die "keadaan LANJUT menuntut bukti kedua jalur (lanjut + pra); bukti ini tidak lengkap"; fi
  [ -n "$(find "$MARK" -mmin -2160 2>/dev/null)" ] || die "bukti rehearsal-penuh lebih dari 36 jam — ulangi terhadap data production terbaru"
  ok "bukti --rehearsal-penuh LULUS untuk SHA ${DEPLOY_SHORT} + baseline ${BASE_SHA:0:8} ($(sed -n 4p "$MARK" | sed s/TES=/tes\ integrasi\ lulus:\ /))"
fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-rjm-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"
if [ "$REHEARSAL_ONLY$REHEARSAL_PENUH" != "00" ] && [ "$KEADAAN" = "LANJUT" ]; then
  [ -n "$BACKUP_PRA" ] || die "production sudah LANJUT (265): rehearsal wajib membuktikan JALUR PRA — sertakan --backup-pra=<backup NYATA sebelum rilis> --sha-pra=<sha256>"
  [ -f "$BACKUP_PRA" ] || die "backup pra-rilis tidak ada: ${BACKUP_PRA}"
  case "$BACKUP_PRA" in "$HOME"/backups/pre-rjm-*.sql.gz) ;; *) die "backup pra-rilis harus berada di $HOME/backups/pre-rjm-*.sql.gz";; esac
  [ "$(sha256sum "$BACKUP_PRA" | cut -d' ' -f1)" = "$SHA_PRA" ] || die "sha256 backup pra-rilis TIDAK sama dengan --sha-pra"
  [ ! -f "${BACKUP_PRA}.sha256" ] || [ "$(cut -d' ' -f1 "${BACKUP_PRA}.sha256")" = "$SHA_PRA" ] || die "berkas .sha256 backup pra-rilis berbeda dari --sha-pra"
  gzip -t "$BACKUP_PRA" || die "arsip backup pra-rilis rusak"
  gzip -dc "$BACKUP_PRA" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump pra-rilis tidak lengkap"
  [ "$BACKUP_PRA" != "$BACKUP_FILE" ] || die "backup pra-rilis tidak boleh backup yang baru diambil"
  ok "backup pra-rilis terverifikasi: ${BACKUP_PRA} sha256 ${SHA_PRA:0:12}…"
fi

# bk_run: menjalankan perintah di container backend. Rilis penuh = compose release dir (env production); --rehearsal-penuh = image bertag rehearsal TANPA env production (hanya variabel yang diberikan eksplisit).
bk_run() {
  local o=(); while [ "$1" != "--" ]; do o+=("$1"); shift; done; shift
  if [ "$REHEARSAL_PENUH" = "1" ]; then docker run --rm -i --network "$NET" -w /app -e JWT_SECRET="rehearsal-sekali-pakai-${TS:-x}" "${o[@]}" "$REH_IMG" "$@"
  else dcp "$NEW_DIR" run --rm --no-deps -T "${o[@]}" backend "$@"; fi
}
# Lanjutan --rehearsal-penuh di DALAM rehearsal(): semuanya terhadap DB rehearsal yang SUDAH dimigrasi dan lolos sidik jari.
rehearsal_penuh_lanjutan() {
  say "Lanjutan rehearsal penuh: smoke baca-saja pada DB rehearsal, skenario pada KLON (jadwal Admin tanpa Run, klik ganda/serentak/revisi basi, pindah hari-meja, kapasitas penuh, hari Minggu libur, undo, aktivasi Meja mengambil alih, ekspor Excel, izin), guard rollback (4 pembuktian aturan + kode LAMA pada jadwal berlaku), kode LAMA terhadap data baru, TES INTEGRASI terarah (Postgres sekali-pakai); production tidak disentuh"
  local RH_DIR="$BK_DIR/rh"; mkdir -p "$RH_DIR"
  cp "$WS/scripts/lib/rehearsal-skenario-rencana-jadwal-mingguan.mjs" "$WS/scripts/lib/smoke-rencana-jadwal-mingguan.mjs" "$WS/scripts/lib/rehearsal-kode-lama-rencana-jadwal-mingguan.mjs" "$RH_DIR/" || { reh_drop; die "pustaka skenario tidak ada di arsip kandidat"; }
  local RH_JWT; RH_JWT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  [ "${#RH_JWT}" -ge 32 ] || { reh_drop; die "gagal membangkitkan rahasia JWT rehearsal"; }
  # 1) smoke baca-saja terhadap data restore (DB rehearsal yang SUDAH dimigrasi): tidak ada tulisan; sidik jari tabel lama diperiksa lagi sesudahnya
  docker run --rm --network "$NET" -v "$RH_DIR:/rh:ro" -w /app -e FASE=smoke -e JWT_SECRET="$RH_JWT" -e DATABASE_URL="$REH_URL" -e TEST_DATABASE_URL="$REH_URL" "$REH_IMG" node /rh/rehearsal-skenario-rencana-jadwal-mingguan.mjs </dev/null > "$BK_DIR/rh-smoke.log" 2>&1 || { grep -E 'FAIL|Error' "$BK_DIR/rh-smoke.log" | head -n 10; reh_drop; die "smoke baca-saja terhadap DB rehearsal GAGAL (log: $BK_DIR/rh-smoke.log)"; }
  grep -q '^RH_SMOKE kode=0' "$BK_DIR/rh-smoke.log" && grep -q '^SMOKE_HASIL fail=0 skip=' "$BK_DIR/rh-smoke.log" || { tail -n 8 "$BK_DIR/rh-smoke.log"; reh_drop; die "smoke tidak mencetak ringkasan lulus"; }
  grep -q 'ekspor xlsx: 200' "$BK_DIR/rh-smoke.log" && grep -q 'panel unit .*: 200' "$BK_DIR/rh-smoke.log" || { reh_drop; die "smoke tidak membuktikan panel unit nyata + ekspor xlsx"; }
  ok "smoke baca-saja terhadap DB rehearsal: $(grep -c '  PASS' "$BK_DIR/rh-smoke.log") pemeriksaan lulus, $(grep '^SMOKE_HASIL' "$BK_DIR/rh-smoke.log" | sed 's/SMOKE_HASIL //')"
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sesudah-smoke-${mode}.txt" || { reh_drop; die "sidik jari penuh sesudah smoke gagal"; }
  cmp -s "$BK_DIR/fp-all-sebelum-${mode}.txt" "$BK_DIR/fp-all-sesudah-smoke-${mode}.txt" || { diff "$BK_DIR/fp-all-sebelum-${mode}.txt" "$BK_DIR/fp-all-sesudah-smoke-${mode}.txt" || true; reh_drop; die "smoke baca-saja MENGUBAH isi tabel lama"; }
  [ "$(RPSQL "select (select count(*) from production_unit_schedules) + (select count(*) from production_unit_schedule_events) + (select count(*) from unit_component_reuse_entries)")" = "0" ] || { reh_drop; die "smoke baca-saja menulis ke tabel jadwal"; }
  ok "sesudah smoke: isi semua tabel lama IDENTIK dengan sebelum migrasi; tabel jadwal tetap kosong (read-only terbukti)"
  # 2) skenario menulis pada KLON DB rehearsal (CREATE DATABASE ... TEMPLATE); DB rehearsal utama tidak ikut berubah
  KLON_DB="rehearsal_rjm_test_klon_${TS}"
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${KLON_DB}\" TEMPLATE \"${REH_DB}\"" </dev/null || { reh_drop; die "gagal membuat klon DB rehearsal"; }
  local KLON_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${KLON_DB}"
  docker run --rm --network "$NET" -v "$RH_DIR:/rh:ro" -w /app -e FASE=skenario -e JWT_SECRET="$RH_JWT" -e DATABASE_URL="$KLON_URL" -e TEST_DATABASE_URL="$KLON_URL" "$REH_IMG" node /rh/rehearsal-skenario-rencana-jadwal-mingguan.mjs </dev/null > "$BK_DIR/rh-skenario.log" 2>&1 || { grep -E '^FAIL' "$BK_DIR/rh-skenario.log" | head -n 12; tail -n 5 "$BK_DIR/rh-skenario.log"; dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${KLON_DB}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; reh_drop; die "skenario rehearsal GAGAL (log: $BK_DIR/rh-skenario.log)"; }
  grep -q '^RH_SKENARIO gagal=0' "$BK_DIR/rh-skenario.log" && ! grep -q '^FAIL' "$BK_DIR/rh-skenario.log" || { grep -E '^FAIL' "$BK_DIR/rh-skenario.log" | head -n 12; reh_drop; die "skenario rehearsal tidak lulus penuh"; }
  local NPASS; NPASS="$(grep -c '^PASS' "$BK_DIR/rh-skenario.log")"; [ "$NPASS" -ge 25 ] || { reh_drop; die "skenario hanya ${NPASS} pemeriksaan lulus (minimal 25)"; }
  for k in 'SINTETIS: kalender minggu 72 slot' 'SINTETIS: hari Minggu ditolak' 'SINTETIS: jadwal Admin unit belum diterima' 'SINTETIS: jadwal Admin TIDAK membuka Run' 'SINTETIS: kalender menandai unit belum diterima' 'SINTETIS: klik ganda' 'SINTETIS: permintaan serentak' 'SINTETIS: pindah hari/meja memperbarui baris yang sama' 'SINTETIS: kapasitas meja penuh' 'SINTETIS: undo salah-pindah' 'SINTETIS: antrean per tindakan' 'SINTETIS: akun hanya-lihat' 'SINTETIS: aktivasi Meja mengambil alih' 'SINTETIS: unit yang sudah dikelola Meja ditolak' 'SINTETIS: ekspor Excel memuat' 'SINTETIS: keluarkan dari jadwal' 'SINTETIS: komponen lama dari unit ini' 'SINTETIS: komponen lama TIDAK mengubah saldo' 'SINTETIS: koreksi + batal berjejak' 'SINTETIS: tanpa lintas unit' 'SINTETIS: dilepas tanpa dipakai' 'SINTETIS: akun hanya-lihat (Sales) membaca komponen lama' 'SINTETIS: status kerja otomatis'; do grep -q "^PASS ${k}" "$BK_DIR/rh-skenario.log" || { reh_drop; die "pemeriksaan wajib tidak ada/lulus: $k"; }; done
  ok "skenario rehearsal pada KLON data production: ${NPASS} pemeriksaan lulus, 0 gagal — jadwal Admin tanpa Run/stok/job/jurnal/penerimaan/outbox/pesan, klik ganda + serentak + revisi basi, pindah baris yang sama, meja penuh, Minggu libur, undo, aktivasi Meja mengambil alih (ADOPTED), ekspor Excel, izin hanya-lihat"
  grep -E '^INFO' "$BK_DIR/rh-skenario.log" | sed 's/^/        /'
  # DB rehearsal UTAMA tetap tidak berubah oleh skenario (skenario hanya menulis di klon)
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sesudah-skenario-${mode}.txt" || { reh_drop; die "sidik jari penuh sesudah skenario gagal"; }
  cmp -s "$BK_DIR/fp-all-sebelum-${mode}.txt" "$BK_DIR/fp-all-sesudah-skenario-${mode}.txt" || { reh_drop; die "DB rehearsal utama berubah oleh skenario (seharusnya hanya klon)"; }
  # 3) GUARD ROLLBACK — aturan dibuktikan pada DB rehearsal (guard baca-saja; sidik jari data dibandingkan sebelum/sesudah setiap pemanggilan)
  gsql() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$1" -X -At -q -c "$2" </dev/null; }
  gfp() { gsql "$1" "select md5(coalesce(string_agg(t::text,',' order by id),'')) from production_unit_schedules t union all select md5(coalesce(string_agg(t::text,',' order by id),'')) from production_unit_schedule_events t union all select (select count(*) from units)||'/'||(select count(*) from production_run_plans_v2)||'/'||(select count(*) from production_runs_v2)||'/'||(select count(*) from stock_movements)||'/'||(select count(*) from fin_journal_entries)||'/'||(select count(*) from jobs)" | LC_ALL=C sort; }
  GX=99
  guard_ke() { # $1=DB $2=log; hasil exit guard di GX; guard TIDAK boleh mengubah data
    local f1 f2; f1="$(gfp "$1")" && [ -n "$f1" ] || { reh_drop; die "sidik jari sebelum guard gagal"; }
    set +e; GUARD_DB="$1" bash "$WS/scripts/rollback-guard-rencana-jadwal-mingguan.sh" > "$2" 2>&1; GX=$?; set -e
    f2="$(gfp "$1")"; [ "$f1" = "$f2" ] || { cat "$2"; reh_drop; die "guard rollback MENGUBAH data (seharusnya baca-saja)"; }
  }
  # 3a) KLON skenario memuat jadwal Admin yang masih BERLAKU → guard HARUS menolak (exit 1) dengan jumlah, contoh unit, dan alasan; data tidak berubah
  guard_ke "$KLON_DB" "$BK_DIR/guard-klon.log"
  [ "$GX" = "1" ] && grep -q 'GUARD DITOLAK' "$BK_DIR/guard-klon.log" && grep -Eq 'jadwal Admin=[1-9]' "$BK_DIR/guard-klon.log" && grep -q 'RH-RJM-' "$BK_DIR/guard-klon.log" && grep -q 'jadwal Admin berlaku' "$BK_DIR/guard-klon.log" && grep -q 'PERBAIKAN MAJU' "$BK_DIR/guard-klon.log" || { cat "$BK_DIR/guard-klon.log"; reh_drop; die "guard rollback pada klon berisi jadwal Admin berlaku TIDAK menolak dengan benar (exit=${GX})"; }
  ok "guard rollback pada klon skenario (jadwal Admin berlaku): DITOLAK (exit 1) dengan jumlah + contoh unit + alasan; data tidak berubah — $(sed -n 2p "$BK_DIR/guard-klon.log")"
  # 3b) KLON KHUSUS guard (restore bersih, tabel jadwal kosong): empat pembuktian aturan
  KLON_G="rehearsal_rjm_test_klong_${TS}"
  cp "$WS/scripts/lib/rehearsal-guard-rencana-jadwal-mingguan.mjs" "$WS/scripts/lib/rehearsal-guard-kode-lama-rencana-jadwal-mingguan.mjs" "$RH_DIR/" || { reh_drop; die "pustaka guard tidak ada di arsip kandidat"; }
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${KLON_G}\" TEMPLATE \"${REH_DB}\"" </dev/null || { reh_drop; die "gagal membuat klon guard"; }
  local KLONG_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${KLON_G}"
  gfase() { # $1=fase; image kandidat
    docker run --rm --network "$NET" -v "$RH_DIR:/rh:ro" -w /app -e FASE="$1" -e JWT_SECRET="$RH_JWT" -e DATABASE_URL="$KLONG_URL" -e TEST_DATABASE_URL="$KLONG_URL" "$REH_IMG" node /rh/rehearsal-guard-rencana-jadwal-mingguan.mjs </dev/null > "$BK_DIR/rh-guard-$1.log" 2>&1 && grep -q "^RH_GUARD_FASE $1 gagal=0" "$BK_DIR/rh-guard-$1.log" || { grep -E '^FAIL|Error' "$BK_DIR/rh-guard-$1.log" | head -n 6; tail -n 3 "$BK_DIR/rh-guard-$1.log"; reh_drop; die "fase guard $1 gagal"; }
  }
  # 1. SEBELUM jadwal pertama (kondisi production saat deploy): LULUS
  guard_ke "$KLON_G" "$BK_DIR/guard-1-kosong.log"
  [ "$GX" = "0" ] && grep -q 'GUARD LULUS' "$BK_DIR/guard-1-kosong.log" && grep -q 'jadwal Admin=0' "$BK_DIR/guard-1-kosong.log" || { cat "$BK_DIR/guard-1-kosong.log"; reh_drop; die "guard sebelum jadwal pertama harus LULUS (exit=${GX})"; }
  ok "PEMBUKTIAN 1 — sebelum jadwal Admin pertama: guard LULUS (exit 0; jadwal Admin=0), data tidak berubah"
  # 2. setelah SATU jadwal Admin: DITOLAK, data tidak berubah
  gfase g1; guard_ke "$KLON_G" "$BK_DIR/guard-2-satu.log"
  [ "$GX" = "1" ] && grep -q 'GUARD DITOLAK: 1 jadwal Admin' "$BK_DIR/guard-2-satu.log" && grep -q 'jadwal Admin=1 ' "$BK_DIR/guard-2-satu.log" && grep -q 'RH-GRD-X | ACTIVE' "$BK_DIR/guard-2-satu.log" && grep -q 'jadwal Admin berlaku' "$BK_DIR/guard-2-satu.log" && grep -q 'JANGAN rollback kode' "$BK_DIR/guard-2-satu.log" || { cat "$BK_DIR/guard-2-satu.log"; reh_drop; die "guard setelah SATU jadwal Admin harus MENOLAK (exit=${GX})"; }
  ok "PEMBUKTIAN 2 — setelah satu jadwal Admin: guard DITOLAK (exit 1) menyebut jumlah=1, unit RH-GRD-X dan alasan; sidik jari data identik sebelum/sesudah guard"
  # 3. diambil alih Pelaksanaan Meja → boleh; jadwal lain ACTIVE → tolak; dikeluarkan (CLEARED) → boleh; rencana Meja pengambil-alih dibatalkan → tolak
  gfase g2; guard_ke "$KLON_G" "$BK_DIR/guard-3a-adopted.log"
  [ "$GX" = "0" ] && grep -q 'GUARD LULUS' "$BK_DIR/guard-3a-adopted.log" && grep -q '1 diambil alih rencana Meja' "$BK_DIR/guard-3a-adopted.log" || { cat "$BK_DIR/guard-3a-adopted.log"; reh_drop; die "guard untuk jadwal yang sah diambil alih Pelaksanaan Meja harus LULUS (exit=${GX})"; }
  gfase g3; guard_ke "$KLON_G" "$BK_DIR/guard-3b-aktif-lagi.log"
  [ "$GX" = "1" ] && grep -q 'RH-GRD-Y | ACTIVE' "$BK_DIR/guard-3b-aktif-lagi.log" && ! grep -q 'RH-GRD-X' "$BK_DIR/guard-3b-aktif-lagi.log" || { cat "$BK_DIR/guard-3b-aktif-lagi.log"; reh_drop; die "guard harus menolak karena unit Y berlaku, TANPA menyalahkan unit X yang sah diambil alih"; }
  gfase g3b; guard_ke "$KLON_G" "$BK_DIR/guard-3c-cleared.log"
  [ "$GX" = "0" ] && grep -q 'GUARD LULUS' "$BK_DIR/guard-3c-cleared.log" && grep -q '1 sudah dikeluarkan' "$BK_DIR/guard-3c-cleared.log" || { cat "$BK_DIR/guard-3c-cleared.log"; reh_drop; die "guard untuk jadwal yang dikeluarkan (CLEARED) + diambil alih sah harus LULUS (exit=${GX})"; }
  ok "PEMBUKTIAN 3 — jadwal diambil alih Pelaksanaan Meja (rencana sah) → LULUS; jadwal berlaku lain → DITOLAK (hanya unit yang berlaku disebut); dikeluarkan (CLEARED) → LULUS"
  # 4. kode LAMA: tidak membuat jadwal kedua pada keadaan yang diizinkan; bahaya pada jadwal ACTIVE terbukti (itu sebabnya guard menolak)
  gfase g4; guard_ke "$KLON_G" "$BK_DIR/guard-4-z.log"
  [ "$GX" = "1" ] && grep -q 'RH-GRD-Z | ACTIVE' "$BK_DIR/guard-4-z.log" || { cat "$BK_DIR/guard-4-z.log"; reh_drop; die "guard harus menolak unit Z (jadwal Admin berlaku)"; }
  docker run --rm --network "$NET" -v "$RH_DIR:/rh:ro" -w /app -e JWT_SECRET="$RH_JWT" -e DATABASE_URL="$KLONG_URL" -e TEST_DATABASE_URL="$KLONG_URL" "$PREV_IMG_ID" node /rh/rehearsal-guard-kode-lama-rencana-jadwal-mingguan.mjs </dev/null > "$BK_DIR/rh-guard-kode-lama.log" 2>&1 || { grep -E '^FAIL|Error' "$BK_DIR/rh-guard-kode-lama.log" | head -n 8; tail -n 3 "$BK_DIR/rh-guard-kode-lama.log"; reh_drop; die "pembuktian kode lama terhadap klon guard gagal"; }
  grep -q '^RH_GUARD_LAMA gagal=0' "$BK_DIR/rh-guard-kode-lama.log" && ! grep -q '^FAIL' "$BK_DIR/rh-guard-kode-lama.log" && grep -q '^PASS kode lama: image ini LAMA' "$BK_DIR/rh-guard-kode-lama.log" && grep -q '^PASS kode lama: unit X (ADOPTED' "$BK_DIR/rh-guard-kode-lama.log" && grep -q '^PASS kode lama: unit Y (CLEARED)' "$BK_DIR/rh-guard-kode-lama.log" && grep -q 'INFO bahaya terbukti=ya' "$BK_DIR/rh-guard-kode-lama.log" || { tail -n 8 "$BK_DIR/rh-guard-kode-lama.log"; reh_drop; die "pembuktian kode lama tidak lulus penuh"; }
  guard_ke "$KLON_G" "$BK_DIR/guard-4b-setelah-lama.log"
  [ "$GX" = "1" ] && grep -q 'RH-GRD-Z | ACTIVE' "$BK_DIR/guard-4b-setelah-lama.log" || { cat "$BK_DIR/guard-4b-setelah-lama.log"; reh_drop; die "guard tetap harus menolak sesudah kode lama bekerja"; }
  gfase g5; guard_ke "$KLON_G" "$BK_DIR/guard-5-batal.log"
  [ "$GX" = "1" ] && grep -q 'RH-GRD-X | ADOPTED' "$BK_DIR/guard-5-batal.log" && grep -q 'DIBATALKAN' "$BK_DIR/guard-5-batal.log" || { cat "$BK_DIR/guard-5-batal.log"; reh_drop; die "guard harus menolak jadwal ADOPTED yang rencana Mejanya dibatalkan (bila ragu, tolak)"; }
  ok "PEMBUKTIAN 4 — kode LAMA ($(docker image inspect -f '{{.Id}}' "$PREV_IMG_ID" | cut -c8-19)) pada klon: unit ADOPTED tidak mendapat rencana kedua; unit CLEARED hanya mendapat satu rencana Meja; tabel jadwal + riwayat TIDAK berubah oleh kode lama; pada jadwal ACTIVE kode lama MEMBUAT rencana Meja kedua tanpa menutup jadwal Admin (bahaya terbukti → guard menolak, juga sesudah kode lama bekerja); ADOPTED dengan rencana dibatalkan → ditolak"
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${KLON_G}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true
  # 3b) ROLLBACK KODE terbukti pada DATA: image LAMA (baseline live, tanpa kode rilis ini) membaca KLON yang berisi data jadwal Admin — bacaan lama tetap benar, stok tidak berubah, hapus unit berjejak tidak menghilangkan data
  docker run --rm --network "$NET" -v "$RH_DIR:/rh:ro" -w /app -e JWT_SECRET="$RH_JWT" -e DATABASE_URL="$KLON_URL" -e TEST_DATABASE_URL="$KLON_URL" "$PREV_IMG_ID" node /rh/rehearsal-kode-lama-rencana-jadwal-mingguan.mjs </dev/null > "$BK_DIR/rh-kode-lama.log" 2>&1 || { grep -E '^FAIL|Error' "$BK_DIR/rh-kode-lama.log" | head -n 10; tail -n 4 "$BK_DIR/rh-kode-lama.log"; dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${KLON_DB}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; reh_drop; die "rollback kode: image LAMA terhadap data jadwal Admin GAGAL (log: $BK_DIR/rh-kode-lama.log)"; }
  grep -q '^RH_KODE_LAMA gagal=0' "$BK_DIR/rh-kode-lama.log" && ! grep -q '^FAIL' "$BK_DIR/rh-kode-lama.log" && grep -q '^PASS image ini LAMA' "$BK_DIR/rh-kode-lama.log" || { tail -n 6 "$BK_DIR/rh-kode-lama.log"; reh_drop; die "rollback kode terhadap data jadwal Admin tidak lulus penuh"; }
  ok "rollback kode terbukti pada data: image LAMA ($(docker image inspect -f '{{.Id}}' "$PREV_IMG_ID" | cut -c8-19)) membaca klon berisi data jadwal Admin — $(grep -c '^PASS' "$BK_DIR/rh-kode-lama.log") pemeriksaan lulus; $(grep '^INFO' "$BK_DIR/rh-kode-lama.log" | sed 's/^INFO //')"
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${KLON_DB}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true
  # 4) TES INTEGRASI terarah di Postgres SEKALI-PAKAI (container sementara, tanpa volume, TIDAK memakai Postgres production): image kandidat, node 20 Linux, DB dibuat dari NOL oleh runDisposable
  #    (tes memuat TRUNCATE sehingga TIDAK dijalankan pada salinan data production; yang dijalankan pada data production = skenario klon di atas)
  say "Tes integrasi terarah (${TES_N_EXPECT} tes di $(printf '%s\n' $TES_FILES | wc -l) berkas) pada Postgres sekali-pakai — bisa 40–70 menit; log: $BK_DIR/tes-integrasi.log"
  PG_IMG="$(docker inspect -f '{{.Config.Image}}' "$(dcp "$PREV_DIR" ps -q postgres </dev/null)")"; [ -n "$PG_IMG" ] || { reh_drop; die "image postgres tidak terbaca"; }
  PGT="rh-rjm-pg-${TS}"; local PGPW; PGPW="$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  docker run -d --name "$PGT" --network "$NET" --tmpfs /var/lib/postgresql/data:rw,size=3g -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$PGPW" "$PG_IMG" -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=300 >/dev/null || { reh_drop; die "gagal menjalankan Postgres sekali-pakai"; }
  local siap=0; for i in $(seq 1 40); do docker exec "$PGT" pg_isready -U "$DB_USER" >/dev/null 2>&1 && { siap=1; break; }; sleep 2; done
  [ "$siap" = "1" ] || { docker logs "$PGT" 2>&1 | tail -n 8; reh_drop; die "Postgres sekali-pakai tidak siap"; }
  for f in $TES_FILES; do [ -f "$WS/backend/$f" ] || { reh_drop; die "berkas tes pinned tidak ada di arsip kandidat: $f"; }; done
  # Dua penyesuaian lingkungan (bukan pelonggaran gerbang): (1) sebagian tes membaca berkas repo di luar backend/ (scripts/, frontend/src) lewat ../../../ → dipasang READ-ONLY dari arsip kandidat (bukan data production);
  # (2) kolam koneksi Prisma bawaan = 2×CPU+1 = 5 pada VPS 2 vCPU, terlalu kecil untuk tes paralel (P2024 → 503); connection_limit=30 menyamai kolam mesin pengembangan.
  tes_jalankan() { # $1 = log; sisanya = berkas tes. Mengembalikan kode keluar runDisposable (output TAP/spec ke log)
    local log="$1"; shift
    docker run --rm --network "$NET" -w /app -v "$WS/scripts:/scripts:ro" -v "$WS/frontend/src:/frontend/src:ro" -e TZ=Asia/Jakarta -e JWT_SECRET="$RH_JWT" -e TEST_DB_SERVER_URL="postgresql://${DB_USER}:${PGPW}@${PGT}:5432/postgres?connection_limit=30" "$REH_IMG" node tests/integration/setup/runDisposable.js "$@" </dev/null > "$log" 2>&1
  }
  # Pelapor tes bergantung versi node: node 20 (image) non-TTY = TAP ("# tests N"); node ≥ 22 = spec ("ℹ tests N"). Keduanya diterima.
  tes_angka() { sed -n -e "s/^ℹ $2 \([0-9]*\)\$/\1/p" -e "s/^# $2 \([0-9]*\)\$/\1/p" "$1" | tail -n 1; }
  set +e; tes_jalankan "$BK_DIR/tes-integrasi.log" $TES_FILES; local TES_RC=$?; set -e
  local T_N T_PASS T_FAIL; T_N="$(tes_angka "$BK_DIR/tes-integrasi.log" tests)"; T_PASS="$(tes_angka "$BK_DIR/tes-integrasi.log" pass)"; T_FAIL="$(tes_angka "$BK_DIR/tes-integrasi.log" fail)"
  [[ "$T_N" =~ ^[0-9]+$ ]] && [[ "$T_PASS" =~ ^[0-9]+$ ]] && [[ "$T_FAIL" =~ ^[0-9]+$ ]] || { tail -n 12 "$BK_DIR/tes-integrasi.log"; docker rm -f "$PGT" >/dev/null 2>&1 || true; reh_drop; die "ringkasan tes integrasi tidak terbaca (exit=${TES_RC}) — jangan anggap lulus"; }
  [ "$T_N" = "$TES_N_EXPECT" ] || { { grep -E '^✖|^not ok' "$BK_DIR/tes-integrasi.log" | sort -u | head -n 15 || true; }; docker rm -f "$PGT" >/dev/null 2>&1 || true; reh_drop; die "jumlah tes ${T_N} != ${TES_N_EXPECT} yang dipatok (berkas gagal dimuat atau daftar berubah)"; }
  TES_ULANG_INFO="percobaan pertama bersih"
  if [ "$TES_RC" != "0" ] || [ "$T_FAIL" != "0" ] || [ "$T_PASS" != "$TES_N_EXPECT" ]; then
    # KEBIJAKAN FLAKY (eksplisit, SATU kali): kegagalan boleh dicoba ulang HANYA bila terbatas pada ≤ 3 berkas tes; berkas itu dijalankan ulang di DB baru dan HARUS lulus penuh. Kegagalan pertama + hasil ulang dilaporkan apa adanya.
    local GAGAL_NAMA GAGAL_FILES NG; GAGAL_NAMA="$(grep -E '^not ok' "$BK_DIR/tes-integrasi.log" | sed 's/^not ok [0-9]* - //' | sort -u | cut -c1-140 || true)"
    GAGAL_FILES="$(grep -oE "location: '/app/tests/integration/[A-Za-z0-9]+\.integration\.test\.js" "$BK_DIR/tes-integrasi.log" | sed "s#location: '/app/#tests/#" | sort -u || true)"
    NG="$(printf '%s\n' "$GAGAL_FILES" | grep -c . || true)"
    printf '%s\n' "$GAGAL_NAMA" | sed 's/^/        GAGAL percobaan pertama: /'
    { [ "$NG" -ge 1 ] && [ "$NG" -le 3 ] && [ "$T_FAIL" -le 3 ]; } || { tail -n 12 "$BK_DIR/tes-integrasi.log"; docker rm -f "$PGT" >/dev/null 2>&1 || true; reh_drop; die "tes integrasi terarah TIDAK lulus (exit=${TES_RC}, tests=${T_N}, pass=${T_PASS}, fail=${T_FAIL}, berkas gagal=${NG}); di luar batas kebijakan ulang"; }
    for f in $GAGAL_FILES; do case " $TES_FILES " in *" $f "*) ;; *) docker rm -f "$PGT" >/dev/null 2>&1 || true; reh_drop; die "berkas gagal ${f} bukan bagian daftar tes pinned";; esac; done
    warn "tes integrasi: ${T_FAIL} gagal pada percobaan pertama di ${NG} berkas ($(printf '%s' "$GAGAL_FILES" | tr '\n' ' ')); mengulang HANYA berkas itu di DB baru (sekali)"
    set +e; tes_jalankan "$BK_DIR/tes-integrasi-ulang.log" $GAGAL_FILES; local ULANG_RC=$?; set -e
    local U_FAIL U_N; U_FAIL="$(tes_angka "$BK_DIR/tes-integrasi-ulang.log" fail)"; U_N="$(tes_angka "$BK_DIR/tes-integrasi-ulang.log" tests)"
    if [ "$ULANG_RC" != "0" ] || [ "$U_FAIL" != "0" ] || ! [[ "$U_N" =~ ^[0-9]+$ ]] || [ "$U_N" -lt 1 ]; then { grep -E '^✖|^not ok' "$BK_DIR/tes-integrasi-ulang.log" | sort -u | head -n 10 || true; }; docker rm -f "$PGT" >/dev/null 2>&1 || true; reh_drop; die "tes integrasi GAGAL lagi pada percobaan ulang (${ULANG_RC}; fail=${U_FAIL:-?}) — bukan flaky; berhenti"; fi
    TES_ULANG_INFO="${T_FAIL} gagal pada percobaan pertama (${NG} berkas) lalu LULUS PENUH pada percobaan ulang (${U_N} tes di berkas itu)"
  fi
  docker rm -f "$PGT" >/dev/null 2>&1 || true
  ok "tes integrasi terarah: ${T_N} tes dijalankan (image kandidat, DB dari nol, container sekali-pakai dihapus); ${TES_ULANG_INFO}"
}

# Pemilih jalur: SEGAR → satu jalur (segar). LANJUT → jalur "lanjut" (restore keadaan production sekarang, 265; migrasi tidak diulang) DAN, pada mode rehearsal, jalur "pra" (backup nyata sebelum rilis, 263 → 265).
rehearsal_jalur() { # $1 = git | image
  if [ "$KEADAAN" = "SEGAR" ]; then rehearsal "$1" segar; return; fi
  rehearsal "$1" lanjut
  if [ "$REHEARSAL_ONLY$REHEARSAL_PENUH" != "00" ]; then rehearsal "$1" pra; fi
}
# ── REHEARSAL (satu fungsi, dipakai --rehearsal-only, --rehearsal-penuh dan alur rilis penuh) ───────────────────────────────────────────────────────────────────────────
# $1 = "git" (SQL migrasi dari git, diberi waktu per pernyataan) | "image" (prisma migrate deploy dari image baru + kode baru terhadap data restore)
# $2 = skenario: segar (production 263; restore backup baru → 263→265) | lanjut (production 265; restore backup baru: migrasi TIDAK diulang, tidak ada yang dilewati) | pra (production 265; restore backup NYATA sebelum rilis [--backup-pra] → 263→265)
rehearsal() {
  local jenis="$1" sken="${2:-segar}" sfxdb=""; [ "$sken" = "pra" ] && sfxdb="pra"
  local mode="${jenis}-${sken}"  # akhiran berkas bukti
  local RESTORE_SRC="$BACKUP_FILE"; [ "$sken" = "pra" ] && RESTORE_SRC="$BACKUP_PRA"
  local REF_BEKU="$BK_DIR/data-sebelum.txt"
  REH_DB="rehearsal_rjm_test_${jenis}${sfxdb}_${TS}"  # nama WAJIB memuat "test": pagar env.js skenario menolak DB lain
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
  reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
  RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
  # 1) RESTORE bersih: exit code 0 dan tidak ada ERROR/FATAL/PANIC; WARNING dicatat dan dilaporkan.
  set +e; gzip -dc "$RESTORE_SRC" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-${mode}.log" 2>&1; RESTORE_RC=$?; set -e
  RESTORE_ERR="$(grep -ciE 'ERROR:|FATAL|PANIC' "$BK_DIR/restore-${mode}.log" || true)"
  RESTORE_WARN="$(grep -ciE 'WARNING' "$BK_DIR/restore-${mode}.log" || true)"
  [ "$RESTORE_RC" = "0" ] && [ "${RESTORE_ERR:-0}" = "0" ] || { grep -iE 'ERROR:|FATAL|PANIC' "$BK_DIR/restore-${mode}.log" | LC_ALL=C sort | uniq -c | head -n 10 | sed 's/^/        /'; reh_drop; die "restore ke DB sementara TIDAK bersih (exit=${RESTORE_RC}, error=${RESTORE_ERR}; log: $BK_DIR/restore-${mode}.log) — berhenti; produksi tidak berubah"; }
  if [ "${RESTORE_WARN:-0}" != "0" ]; then warn "restore menghasilkan ${RESTORE_WARN} WARNING (log: $BK_DIR/restore-${mode}.log):"; grep -i 'WARNING' "$BK_DIR/restore-${mode}.log" | LC_ALL=C sort | uniq -c | head -n 5 | sed 's/^/        /'; fi
  ok "restore bersih: exit=0, error=0, warning=${RESTORE_WARN:-0}"
  # 2) Restore IDENTIK dengan dokumen beku produksi (segar/lanjut). Jalur PRA memakai backup NYATA sebelum rilis (data lebih lama dari production sekarang): dibuktikan KEADAAN-nya (tanpa objek rilis, tepat himpunan baseline), dan data dibandingkan sebelum vs sesudah migrasi.
  if [ "$sken" = "pra" ]; then
    [ "$(RPSQL "select count(*) from pg_tables where schemaname='public' and tablename in ('production_unit_schedules','production_unit_schedule_events','unit_component_reuse_entries')")" = "0" ] || gagal_reh "backup pra-rilis memuat tabel rilis (bukan keadaan sebelum rilis)"
    RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-reh-${mode}.txt" || gagal_reh "gagal membaca migrasi backup pra-rilis"
    cmp -s "$BK_DIR/applied-reh-${mode}.txt" "$BK_DIR/base-pra.txt" || gagal_reh "migrasi pada backup pra-rilis BUKAN tepat himpunan baseline (${MIG_SEBELUM})"
    RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku-${mode}.txt" || gagal_reh "sidik jari dokumen beku backup pra-rilis gagal"
    REF_BEKU="$BK_DIR/fp-reh-beku-${mode}.txt"; [ "$(grep -c . "$REF_BEKU")" = "$FPB_N" ] || gagal_reh "sidik jari beku backup pra-rilis tidak ${FPB_N} baris"
    ok "JALUR PRA: backup NYATA sebelum rilis (${BACKUP_PRA##*/}) dipulihkan bersih; keadaan = tepat ${MIG_SEBELUM} migrasi baseline, TANPA tabel rilis; sidik jari dokumen beku dicatat sebagai acuan sebelum-vs-sesudah"
  else
    # 2) Restore IDENTIK dengan dokumen beku produksi
    psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod-beku-${mode}.txt" || { reh_drop; die "sidik jari dokumen beku produksi gagal"; }
    cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku-${mode}.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku-${mode}.txt" || true; reh_drop; die "dokumen pembanding beku BERUBAH selama backup (produksi)"; }
    RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku-${mode}.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
    cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku-${mode}.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku-${mode}.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi (backup/restore bermasalah)"; }
    ok "restore nyata IDENTIK dengan produksi pada ${FPB_N} kelompok pembanding (pergerakan stok, saldo per bahan, GR + baris + event, jurnal, PO, tagihan, pembayaran, Produksi, aktivitas, sesi hitung lama + barisnya)"
  fi
  # 3) Sidik jari PENUH semua tabel lama (baris penuh) + skema + katalog objek, SEBELUM migrasi
  TABEL_LAMA="$(RPSQL "select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1")"
  [ "$(printf '%s\n' "$TABEL_LAMA" | grep -c .)" -ge 100 ] || { reh_drop; die "jumlah tabel lama di restore mencurigakan ($(printf '%s\n' "$TABEL_LAMA" | grep -c .))"; }
  FP_ALL=""
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    expr="to_jsonb(x)"
    FP_ALL="${FP_ALL:+${FP_ALL} union all }select '${t}', count(*), md5(coalesce(string_agg(md5(${expr}::text), '' order by md5(${expr}::text)),'')) from \"${t}\" x"
  done <<< "$TABEL_LAMA"
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sebelum-${mode}.txt" || { reh_drop; die "sidik jari penuh sebelum gagal"; }
  MIG_IN="$(printf "'%s'," $MIG_LIST | sed 's/,$//')"
  RPSQL "select md5(coalesce(string_agg(migration_name||':'||checksum, ',' order by migration_name),'')) from _prisma_migrations where migration_name not in (${MIG_IN})" > "$BK_DIR/mig-hash-sebelum-${mode}.txt" || { reh_drop; die "sidik jari riwayat migrasi gagal"; }
  RPSQL "select md5(coalesce(string_agg(migration_name||':'||checksum||':'||applied_steps_count::text, ',' order by migration_name),'')) from _prisma_migrations where migration_name in (${MIG_IN})" > "$BK_DIR/mig-kand-sebelum-${mode}.txt" || { reh_drop; die "sidik jari migrasi rilis gagal"; }
  S_SEBELUM="$(RPSQL "$SKEMA_SQL")"; K_SEBELUM="$(RPSQL "$KATALOG_SQL")"; [ -n "$S_SEBELUM" ] && [ -n "$K_SEBELUM" ] || { reh_drop; die "sidik jari skema/katalog kosong"; }
  FN_SEBELUM="$(RPSQL "select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'production_adopsi_append_only'")"; [ -n "$FN_SEBELUM" ] || { reh_drop; die "fungsi production_adopsi_append_only tidak ada di restore (prasyarat migrasi 20261221090000)"; }
  SALDO_SEBELUM="$(RPSQL "select md5(coalesce(string_agg(material_id::text||':'||q::text, '|' order by material_id),'')) from (select material_id, sum(qty) q from stock_movements group by material_id) s")"
  N_SM="$(RPSQL "select count(*) from stock_movements")"; N_TABEL_SEBELUM="$(RPSQL "select count(*) from pg_tables where schemaname='public'")"
  ok "garis dasar rehearsal: $(printf '%s\n' "$TABEL_LAMA" | grep -c .) tabel lama disidik-jari; stock_movements=${N_SM} baris; saldo per bahan ${SALDO_SEBELUM:0:12}"
  # 4) Migrasi
  if [ "$jenis" = "git" ] && [ "$sken" = "lanjut" ]; then
    ok "migrasi (git): keadaan LANJUT — tabel rilis sudah ada di backup; TIDAK ada migrasi yang diterapkan (tidak diulang, tidak dilewati)"
  elif [ "$jenis" = "git" ]; then
    { printf '\\timing on\n'; for e in $MIGS; do sg show "${DEPLOY_SHA}:backend/prisma/migrations/${e%%:*}/migration.sql" | tr -d '\r'; done; } | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=1 -X -q > "$BK_DIR/migrate-rehearsal-${mode}.log" 2>&1 || { tail -n 12 "$BK_DIR/migrate-rehearsal-${mode}.log"; reh_drop; die "migrasi pada DB rehearsal GAGAL (produksi tidak disentuh)"; }
    MAKS_MS="$(grep -o 'Time: [0-9.]*' "$BK_DIR/migrate-rehearsal-${mode}.log" | awk '{ if ($2+0 > m) m = $2+0 } END { printf "%.1f", m+0 }')"
    TOTAL_MS="$(grep -o 'Time: [0-9.]*' "$BK_DIR/migrate-rehearsal-${mode}.log" | awk '{ t += $2 } END { printf "%.1f", t+0 }')"
    ok "migrasi diterapkan pada DB rehearsal: $(grep -c 'Time:' "$BK_DIR/migrate-rehearsal-${mode}.log") pernyataan, total ${TOTAL_MS} ms, terlama ${MAKS_MS} ms (stock_movements ${N_SM} baris) — kunci tabel hanya sepanjang itu"
  else
    REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
    [ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
    REH_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
    REH_PEND="$(comm -23 <(ls -1 "$CAND_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
    if [ "$sken" = "lanjut" ]; then
      [ -z "$(printf '%s' "$REH_PEND" | tr -d ' \n')" ] || { reh_drop; die "keadaan LANJUT: seharusnya TIDAK ada migrasi pending pada DB rehearsal: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
      for e in $MIGS; do n="${e%%:*}"; [ "$(RPSQL "select checksum from _prisma_migrations where migration_name='${n}'")" = "$(sha256sum "$CAND_DIR/backend/prisma/migrations/${n}/migration.sql" | cut -d' ' -f1)" ] || { reh_drop; die "checksum migrasi ${n} di restore BERBEDA dari berkas kandidat"; }; done
    else
      [ "$(printf '%s\n' "$REH_PEND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat migrasi rilis ini: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
    fi
    T_A="$(date +%s%N)"
    bk_run -e DATABASE_URL="$REH_URL" -- npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal-${mode}.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal-${mode}.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
    T_B="$(date +%s%N)"
    if [ "$sken" = "lanjut" ]; then
      grep -q 'No pending migrations' "$BK_DIR/migrate-rehearsal-${mode}.log" && ! grep -q 'Applying migration' "$BK_DIR/migrate-rehearsal-${mode}.log" || { tail -n 12 "$BK_DIR/migrate-rehearsal-${mode}.log"; reh_drop; die "keadaan LANJUT: migrate deploy MENERAPKAN sesuatu (seharusnya 'No pending migrations')"; }
    else
      [ "$(grep -c 'Applying migration' "$BK_DIR/migrate-rehearsal-${mode}.log")" = "$N_MIG" ] || { tail -n 12 "$BK_DIR/migrate-rehearsal-${mode}.log"; reh_drop; die "migrate deploy harus menerapkan TEPAT ${N_MIG} migrasi rilis"; }
    fi
    bk_run -e DATABASE_URL="$REH_URL" -- npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
    ok "prisma migrate deploy pada DB rehearsal: $(( (T_B - T_A) / 1000000 )) ms (termasuk start container); status up to date"
  fi
  [ "$(RPSQL "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$MIG_N_KANDIDAT" ] || { reh_drop; die "sesudah migrasi (${mode}) jumlah migrasi terpasang != ${MIG_N_KANDIDAT}"; }
  # 5) STRUKTUR: 2 tabel baru KOSONG; 4 FK RESTRICT + 4 CHECK + 7 indeks (termasuk 2 pkey; 1 unik parsial) + 1 trigger append-only (fungsi lama, tidak diubah) terpasang dan tervalidasi; tabel lama identik (skema + katalog objek)
  struktur_baru RPSQL gagal_reh
  local TAMBAH_TABEL=3; [ "$sken" = "lanjut" ] && TAMBAH_TABEL=0
  [ "$(RPSQL "select count(*) from pg_tables where schemaname='public'")" = "$(( N_TABEL_SEBELUM + TAMBAH_TABEL ))" ] || { reh_drop; die "migrasi MENAMBAH/MENGURANGI tabel di luar yang diharapkan (jadwal, riwayat jadwal, komponen lama; tambahan ${TAMBAH_TABEL})"; }
  [ "$(RPSQL "$SKEMA_SQL")" = "$S_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH skema (kolom/tipe/nullable/default) tabel lama"; }
  [ "$(RPSQL "$KATALOG_SQL")" = "$K_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH indeks/constraint/trigger tabel lama"; }
  ok "struktur: 3 tabel baru kosong; jadwal: 4 FK RESTRICT + 4 CHECK + 7 indeks (1 unik parsial; satu jadwal per unit) + 1 trigger append-only; komponen lama: 2 FK RESTRICT + 9 CHECK (sumber dikunci unit ini) + 4 indeks (1 unik parsial; versi unik) + 1 trigger append-only; fungsi lama tak diubah; tabel lama (skema + indeks/constraint/trigger) identik; jumlah tabel ${N_TABEL_SEBELUM} → $(( N_TABEL_SEBELUM + TAMBAH_TABEL )) (${sken})"
  # 6) UJI PERILAKU constraint/trigger/FK memakai baris NYATA hasil restore (dua unit + pengguna asli); SELURUHNYA dibatalkan (RAISE di akhir)
  cat > "$BK_DIR/uji-perilaku-${mode}.sql" <<'UJISQL'
DO $t$
DECLARE u uuid; u2 uuid; m uuid; i1 uuid := gen_random_uuid(); i2 uuid := gen_random_uuid(); i3 uuid := gen_random_uuid(); i4 uuid := gen_random_uuid(); i5 uuid := gen_random_uuid(); usr text; s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); tolak int := 0; lolos int := 0;
BEGIN
  SELECT id INTO u FROM units ORDER BY created_at, id LIMIT 1;
  SELECT id INTO u2 FROM units ORDER BY created_at, id OFFSET 1 LIMIT 1;
  SELECT id INTO usr FROM "User" ORDER BY id LIMIT 1;
  SELECT id INTO m FROM materials ORDER BY id LIMIT 1;
  IF u IS NULL OR u2 IS NULL OR usr IS NULL OR m IS NULL THEN RAISE EXCEPTION 'DATA_CONTOH_KURANG'; END IF;
  -- YANG SAH (jadwal 6)
  INSERT INTO production_unit_schedules (id, unit_id, production_date, station_code, created_by_id) VALUES (s1, u, DATE '2030-01-07', 'TABLE_1', usr); lolos := lolos + 1;
  UPDATE production_unit_schedules SET revision = 2, status = 'CLEARED', updated_at = now() WHERE id = s1; lolos := lolos + 1;
  UPDATE production_unit_schedules SET revision = 3, status = 'ACTIVE', station_code = NULL, updated_at = now() WHERE id = s1; lolos := lolos + 1;
  INSERT INTO production_unit_schedule_events (id, schedule_id, unit_id, kind, to_date, to_station, resulting_revision, actor_id) VALUES (gen_random_uuid(), s1, u, 'SCHEDULED', DATE '2030-01-07', 'TABLE_1', 1, usr); lolos := lolos + 1;
  INSERT INTO production_unit_schedule_events (id, schedule_id, unit_id, kind, resulting_revision, idempotency_key, actor_id) VALUES (gen_random_uuid(), s1, u, 'UNSCHEDULED', 2, 'k1', usr); lolos := lolos + 1;
  INSERT INTO production_unit_schedule_events (id, schedule_id, unit_id, kind, resulting_revision, actor_id) VALUES (gen_random_uuid(), s1, u, 'UNDONE', 3, usr); lolos := lolos + 1;
  -- YANG HARUS DITOLAK: bentuk data jadwal
  BEGIN INSERT INTO production_unit_schedules (id, unit_id, production_date) VALUES (gen_random_uuid(), u, DATE '2030-01-08'); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_jadwal_ganda_per_unit';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_schedules (id, unit_id, production_date, status) VALUES (gen_random_uuid(), u2, DATE '2030-01-08', 'LIAR'); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_status_liar';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_schedules (id, unit_id, production_date, station_code) VALUES (gen_random_uuid(), u2, DATE '2030-01-08', 'MEJA_9'); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_meja_liar';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_schedules (id, unit_id, production_date, revision) VALUES (gen_random_uuid(), u2, DATE '2030-01-08', 0); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_revisi_nol';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_schedules (id, unit_id, production_date) VALUES (gen_random_uuid(), gen_random_uuid(), DATE '2030-01-08'); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_unit_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_schedules (id, unit_id, production_date, adopted_plan_id) VALUES (gen_random_uuid(), u2, DATE '2030-01-08', gen_random_uuid()); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_rencana_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  -- YANG HARUS DITOLAK: bentuk data riwayat
  BEGIN INSERT INTO production_unit_schedule_events (id, schedule_id, unit_id, kind, resulting_revision, actor_id) VALUES (gen_random_uuid(), s1, u, 'LIAR', 4, usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_jenis_liar';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_schedule_events (id, schedule_id, unit_id, kind, resulting_revision, idempotency_key, actor_id) VALUES (gen_random_uuid(), s1, u, 'SCHEDULED', 4, 'k1', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_kunci_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_schedule_events (id, schedule_id, unit_id, kind, resulting_revision, actor_id) VALUES (gen_random_uuid(), gen_random_uuid(), u, 'SCHEDULED', 1, usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_jadwal_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_schedule_events (id, schedule_id, unit_id, kind, resulting_revision, actor_id) VALUES (gen_random_uuid(), s1, gen_random_uuid(), 'SCHEDULED', 1, usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_unit_riwayat_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  -- append-only (trigger): riwayat jadwal tidak bisa diubah/dihapus
  BEGIN UPDATE production_unit_schedule_events SET note = 'diubah' WHERE schedule_id = s1; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_ubah_riwayat';
  EXCEPTION WHEN sqlstate 'P0001' THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM production_unit_schedule_events WHERE schedule_id = s1; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_hapus_riwayat';
  EXCEPTION WHEN sqlstate 'P0001' THEN tolak := tolak + 1; END;
  -- FK RESTRICT: unit yang punya jadwal dan jadwal yang punya riwayat tidak bisa dihapus
  BEGIN DELETE FROM units WHERE id = u; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_hapus_unit_berjadwal';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM production_unit_schedules WHERE id = s1; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_hapus_jadwal_beriwayat';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  -- KOMPONEN LAMA: YANG SAH (6)
  INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, condition, work_part, actor_id) VALUES (gen_random_uuid(), i1, u, 1, 'CREATED', 'Pegas bongkaran', 12, 'PCS', 'REUSED', 'bagus', 'rangka bawah', usr); lolos := lolos + 1;
  INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, material_id, photo_urls, actor_id) VALUES (gen_random_uuid(), i2, u, 1, 'CREATED', 'Busa lama', 1.5, 'SHEET', 'DISCARDED', m, '["/media/production-evidence/a.jpg"]'::jsonb, usr); lolos := lolos + 1;
  INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, reason, actor_id) VALUES (gen_random_uuid(), i1, u, 2, 'CORRECTED', 'Pegas bongkaran', 10, 'PCS', 'REUSED', 'salah hitung', usr); lolos := lolos + 1;
  INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, reason, actor_id) VALUES (gen_random_uuid(), i1, u, 3, 'VOIDED', 'Pegas bongkaran', 10, 'PCS', 'REUSED', 'salah input', usr); lolos := lolos + 1;
  INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, idempotency_key, actor_id) VALUES (gen_random_uuid(), i3, u, 1, 'CREATED', 'Kain lama', 2, 'METER', 'KEPT_WITH_UNIT', 'kk1', usr); lolos := lolos + 1;
  INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, idempotency_key, actor_id) VALUES (gen_random_uuid(), i4, u2, 1, 'CREATED', 'Kain lama', 2, 'METER', 'RETURNED_TO_CUSTOMER', 'kk1', usr); lolos := lolos + 1;
  -- KOMPONEN LAMA: YANG HARUS DITOLAK (18)
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i1, u, 1, 'CREATED', 'x lagi', 1, 'PCS', 'REUSED', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_versi_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'LIAR', 'xx', 1, 'PCS', 'REUSED', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_jenis_liar';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i5, u, 2, 'CREATED', 'xx', 1, 'PCS', 'REUSED', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_dicatat_versi_dua';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, reason, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'CORRECTED', 'xx', 1, 'PCS', 'REUSED', 'alasan', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_koreksi_versi_satu';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, source, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'CREATED', 'OTHER_UNIT', 'xx', 1, 'PCS', 'REUSED', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_sumber_lintas_unit';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'CREATED', 'xx', 1, 'PCS', 'LIAR', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_hasil_liar';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'CREATED', 'xx', 0, 'PCS', 'REUSED', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_jumlah_nol';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'CREATED', 'xx', -1, 'PCS', 'REUSED', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_jumlah_negatif';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'CREATED', 'x', 1, 'PCS', 'REUSED', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_nama_terlalu_pendek';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'CREATED', 'xx', 1, 'pcs', 'REUSED', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_satuan_huruf_kecil';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i3, u, 2, 'CORRECTED', 'xx', 1, 'PCS', 'REUSED', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_koreksi_tanpa_alasan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, photo_urls, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'CREATED', 'xx', 1, 'PCS', 'REUSED', '{}'::jsonb, usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_foto_bukan_larik';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, actor_id) VALUES (gen_random_uuid(), i5, gen_random_uuid(), 1, 'CREATED', 'xx', 1, 'PCS', 'REUSED', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_unit_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, material_id, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'CREATED', 'xx', 1, 'PCS', 'REUSED', gen_random_uuid(), usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_bahan_katalog_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO unit_component_reuse_entries (id, item_id, unit_id, version, kind, name, qty, uom, outcome, idempotency_key, actor_id) VALUES (gen_random_uuid(), i5, u, 1, 'CREATED', 'xx', 1, 'PCS', 'REUSED', 'kk1', usr); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_kunci_idempotensi_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE unit_component_reuse_entries SET qty = 99 WHERE item_id = i1; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_ubah_riwayat_komponen';
  EXCEPTION WHEN sqlstate 'P0001' THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM unit_component_reuse_entries WHERE item_id = i1; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_hapus_riwayat_komponen';
  EXCEPTION WHEN sqlstate 'P0001' THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM units WHERE id = u2; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_hapus_unit_berkomponen';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
  UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku-${mode}.sql" 2>&1 || true)"
  printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku-${mode}.out"
  printf '%s\n' "$UJI_OUT" | grep -q 'DATA_CONTOH_KURANG' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data contoh di hasil restore kurang (butuh >=2 unit dan >=1 pengguna)"; }
  printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
  printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint/trigger/FK SALAH (ada data yang seharusnya ditolak lolos)"; }
  UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
  UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
  [ "$UJI_TOLAK" = "@@UJI_TOLAK@@" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti ${UJI_TOLAK:-?} (harus @@UJI_TOLAK@@)"; }
  [ "$UJI_LOLOS" = "@@UJI_LOLOS@@" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data sah yang lolos ${UJI_LOLOS:-?} (harus @@UJI_LOLOS@@)"; }
  ok "perilaku terbukti pada hasil restore: ${UJI_TOLAK} penolakan (satu jadwal per unit, status/meja/revisi liar, FK unit/rencana/jadwal, jenis riwayat liar, kunci idempotensi ganda, trigger append-only ×2, RESTRICT hapus unit/jadwal) ditambah komponen lama (versi unik, jenis/versi/hasil/jumlah/satuan liar, SUMBER LINTAS UNIT, koreksi tanpa alasan, foto bukan larik, FK unit/bahan, kunci idempotensi ganda, ubah/hapus riwayat, hapus unit berkomponen) dan ${UJI_LOLOS} operasi sah lolos (jadwal boleh diubah; riwayat jadwal dan versi komponen boleh ditambah); seluruh uji dibatalkan"
  # 7) Mode image: kode BARU terhadap data restore yang SUDAH dimigrasi (baca-saja)
  if [ "$jenis" = "image" ]; then
    bk_run -e DATABASE_URL="$REH_URL" -- node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-kode-baru.log" 2>&1 || { cat "$BK_DIR/rehearsal-kode-baru.log"; reh_drop; die "pemeriksaan kode baru terhadap data restore GAGAL"; }
@@REH_NODE@@
REHNODE
    ok "kode baru terhadap data restore yang sudah dimigrasi: $(tail -n 1 "$BK_DIR/rehearsal-kode-baru.log"); $(grep -c '^PASS' "$BK_DIR/rehearsal-kode-baru.log") pemeriksaan lulus"
  fi
  # 8) SESUDAH: isi semua tabel lama identik; saldo identik; riwayat migrasi lama identik; tidak ada data uji tersisa
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sesudah-${mode}.txt" || { reh_drop; die "sidik jari penuh sesudah gagal"; }
  cmp -s "$BK_DIR/fp-all-sebelum-${mode}.txt" "$BK_DIR/fp-all-sesudah-${mode}.txt" || { diff "$BK_DIR/fp-all-sebelum-${mode}.txt" "$BK_DIR/fp-all-sesudah-${mode}.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
  [ "$(RPSQL "select md5(coalesce(string_agg(material_id::text||':'||q::text, '|' order by material_id),'')) from (select material_id, sum(qty) q from stock_movements group by material_id) s")" = "$SALDO_SEBELUM" ] || { reh_drop; die "saldo per bahan BERUBAH oleh migrasi/uji"; }
  [ "$(RPSQL "select count(*) from stock_movements")" = "$N_SM" ] || { reh_drop; die "jumlah pergerakan stok berubah"; }
  [ "$(RPSQL "select (select count(*) from production_unit_schedules) + (select count(*) from production_unit_schedule_events) + (select count(*) from unit_component_reuse_entries)")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan (tabel jadwal tidak kosong)"; }
  [ "$(RPSQL "select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'production_adopsi_append_only'")" = "$FN_SEBELUM" ] || { reh_drop; die "fungsi production_adopsi_append_only BERUBAH oleh migrasi (seharusnya dipakai apa adanya)"; }
  [ "$(RPSQL "select md5(coalesce(string_agg(migration_name||':'||checksum, ',' order by migration_name),'')) from _prisma_migrations where migration_name not in (${MIG_IN})")" = "$(cat "$BK_DIR/mig-hash-sebelum-${mode}.txt")" ] || { reh_drop; die "riwayat migrasi lama (checksum) BERUBAH"; }
  if [ "$sken" = "lanjut" ]; then
    [ "$(RPSQL "select md5(coalesce(string_agg(migration_name||':'||checksum||':'||applied_steps_count::text, ',' order by migration_name),'')) from _prisma_migrations where migration_name in (${MIG_IN})")" = "$(cat "$BK_DIR/mig-kand-sebelum-${mode}.txt")" ] || { reh_drop; die "baris migrasi rilis BERUBAH (migrasi diulang/diubah) pada keadaan LANJUT"; }
  else
    [ "$(RPSQL "select count(*) from _prisma_migrations where migration_name in (${MIG_IN}) and finished_at is not null and rolled_back_at is null and applied_steps_count = 1")" = "$N_MIG" ] || { reh_drop; die "migrasi rilis tidak tercatat selesai tepat ${N_MIG} baris"; }
  fi
  RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku-sesudah-${mode}.txt" || { reh_drop; die "sidik jari beku sesudah gagal"; }
  cmp -s "$REF_BEKU" "$BK_DIR/fp-reh-beku-sesudah-${mode}.txt" || { diff "$REF_BEKU" "$BK_DIR/fp-reh-beku-sesudah-${mode}.txt" || true; reh_drop; die "dokumen pembanding beku (stok, saldo, jurnal, PO, tagihan, pembayaran, Produksi) berubah oleh migrasi/uji"; }
  if [ "$REHEARSAL_PENUH" = "1" ] && [ "$sken" != "lanjut" ]; then rehearsal_penuh_lanjutan; fi
  reh_drop
  ok "rehearsal (${jenis}, jalur ${sken}) lulus: isi $(printf '%s\n' "$TABEL_LAMA" | grep -c .) tabel lama IDENTIK sebelum vs sesudah; saldo per bahan + jurnal + PO + tagihan + pembayaran + Produksi tidak berubah; DB sementara dihapus"
}

if [ "$REHEARSAL_ONLY" = "1" ]; then
  # MODE --rehearsal-only: backup NYATA + restore ke DB sementara + migrasi (SQL dari git) + uji; TANPA build image, TANPA release dir, TANPA migrasi/switch produksi. DB sementara selalu dihapus.
  PHASE="3b-rehearsal-saja"; say "3b. REHEARSAL SAJA: restore backup NYATA ke DB sementara, migrasi (SQL dari git, bukan dari produksi), uji perilaku, bandingkan sidik jari (produksi tidak diubah)"
  rehearsal_jalur git
  say "Rehearsal selesai (--rehearsal-only): PRODUKSI TIDAK DIUBAH (tanpa build, tanpa release dir, tanpa migrasi produksi, tanpa switch). Backup: ${BACKUP_FILE}"
  trap - EXIT; exit 0
fi

if [ "$REHEARSAL_PENUH" = "1" ]; then
  PHASE="3c-rehearsal-penuh"; say "3c. REHEARSAL PENUH: build web + image kandidat bertag rehearsal (tag production tidak disentuh), restore backup NYATA, migrasi pada DB rehearsal, skenario — production TIDAK diubah selain backup dan DB sementara"
  WS="$HOME/release-rehearsal/rjm-${DEPLOY_SHORT}-${TS}"; CAND_DIR="$WS"; REH_IMG="${IMG_NAME%%:*}:rehearsal-rjm-${DEPLOY_SHORT}"
  NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" | awk '{print $1}')"; [ -n "$NET" ] || die "jaringan docker postgres tidak terbaca"
  [ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
  mkdir -p "$WS" || die "gagal membuat ${WS}"
  sg archive "$DEPLOY_SHA" | tar -x -C "$WS" --exclude='frontend/dist' || die "git archive gagal"
  [ ! -e "$WS/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
  for f in backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-rencana-jadwal-mingguan.sh scripts/lib/rehearsal-skenario-rencana-jadwal-mingguan.mjs scripts/lib/smoke-rencana-jadwal-mingguan.mjs scripts/lib/rehearsal-kode-lama-rencana-jadwal-mingguan.mjs scripts/lib/rehearsal-guard-rencana-jadwal-mingguan.mjs scripts/lib/rehearsal-guard-kode-lama-rencana-jadwal-mingguan.mjs docker-compose.yml docker-compose.release.yml; do [ -f "$WS/$f" ] || die "direktori kerja tidak lengkap: $f"; done
  cp -a "$NM_SRC" "$WS/frontend/node_modules" || die "gagal menyalin node_modules frontend"
  install -m 600 "$PERSIST/frontend/.env" "$WS/frontend/.env" || die "gagal menyalin frontend/.env"
  ( cd "$WS/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$WS/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (production tidak berubah)"; }
  rm -f "$WS/frontend/.env"
  RH_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$WS/frontend/dist/index.html" | sed -n 1p)"; [ -n "$RH_INDEX" ] && [ -f "$WS/frontend/dist/assets/$RH_INDEX" ] || die "hasil build frontend tidak valid"
  for s1 in @@DIST_BARU@@; do [ -n "$(grep -lF "$s1" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal TIDAK memuat teks fitur rilis ini: ${s1}"; done
  for s2 in @@DIST_LAMA@@; do [ -n "$(grep -lF "$s2" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal KEHILANGAN teks fitur lama: ${s2}"; done
  [ "$RH_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel rehearsal identik dengan live"
  ok "build web kandidat: ${RH_INDEX} (live ${PREV_INDEX}); teks fitur Rencana Produksi (jadwal mingguan) baru ada; teks fitur live lama tetap ada"
  docker build -t "$REH_IMG" -f "$WS/backend/Dockerfile" "$WS/backend" > "$BK_DIR/build-rehearsal.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build-rehearsal.log"; die "build image rehearsal gagal (production tidak berubah)"; }
  RH_IMG_ID="$(docker image inspect -f '{{.Id}}' "$REH_IMG")"; [ "$RH_IMG_ID" != "$PREV_IMG_ID" ] || die "image rehearsal identik dengan live"
  [ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag image PRODUCTION berubah selama build — berhenti"
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
  ok "image rehearsal ${REH_IMG} (${RH_IMG_ID:7:12}); tag production ${IMG_NAME} tetap ${PREV_IMG_ID:7:12}; container aktif tidak tersentuh"
  PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, migrasi dengan image kandidat, uji perilaku, kode baru terhadap data restore, sidik jari semua tabel lama, lalu skenario (DB production tidak disentuh)"
  rehearsal_jalur image
  cleanup_penuh
  PHASE="3d-production-tidak-berubah"; say "3d. Verifikasi production TIDAK berubah oleh rehearsal"
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] && [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] && [ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "0" ] && [ "$(docker inspect -f '{{.State.Running}}' "$CID_OLD")" = "true" ] || die "container production berubah"
  curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal setelah rehearsal gagal"
  psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sesudah-rehearsal.txt"
  cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sesudah-rehearsal.txt" || die "daftar migrasi production berubah selama rehearsal"
  [ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename in ('production_unit_schedules','production_unit_schedule_events','unit_component_reuse_entries')")" = "$([ "$KEADAAN" = LANJUT ] && echo 3 || echo 0)" ] || die "jumlah tabel rilis di production berubah selama rehearsal"
  [ "$(psql_live -At -c "select 1")" = "1" ] && KEADAAN_SESUDAH="$(keadaan_produksi "-sesudah-rehearsal")" && [ "$KEADAAN_SESUDAH" = "$KEADAAN" ] || die "keadaan production berubah selama rehearsal (${KEADAAN} → ${KEADAAN_SESUDAH:-?})"
  psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sesudah-rehearsal.txt" || die "sidik jari beku production sesudah rehearsal gagal"
  diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" || true; die "dokumen pembanding production BERUBAH selama rehearsal"; }
  [ "$(psql_live -At -c "select count(*) from pg_database where datname like 'rehearsal_rjm_test_%'")" = "0" ] || die "DB rehearsal masih tersisa di server"
  [ ! -e "$WS" ] || die "direktori kerja rehearsal masih ada"
  [ -z "$(docker images -q "$REH_IMG")" ] || die "image rehearsal masih ada"
  ok "production TIDAK berubah: container/image/release sama, 0 restart, migrasi sama (${MIG_SEBELUM}), 17 kelompok dokumen pembanding identik, keadaan ${KEADAAN} tidak berubah, DB rehearsal + direktori kerja + image rehearsal sudah dihapus; satu-satunya jejak: backup ${BACKUP_FILE}"
  trap - EXIT
  printf 'BASE=%s\nDEPLOY=%s\nTS=%s\nTES=%s\nRETRY=%s\nKEADAAN=%s\nJALUR=%s\n' "$BASE_SHA" "$DEPLOY_SHA" "$TS" "$TES_N_EXPECT" "$TES_ULANG_INFO" "$KEADAAN" "$([ "$KEADAAN" = LANJUT ] && echo lanjut+pra || echo segar)" > "$HOME/release-backups/.rehearsal-penuh-ok-rencana-jadwal-mingguan-${DEPLOY_SHA}"
  say "REHEARSAL PENUH SELESAI — production TIDAK diubah, tidak ada deploy, tidak ada jadwal/Run/pesan dibuat di production. Backup: ${BACKUP_FILE}. Log: ${BK_DIR}/release.log"
  exit 0
fi

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-rencana-jadwal-mingguan.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat; compose identik"

say "4b. Build frontend di release dir (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
# Fitur rilis ini harus ada di bundel baru; fitur live sebelumnya (verifikasi ADA di dist release aktif dulu) tidak boleh hilang.
for s1 in @@DIST_BARU@@; do
  [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru TIDAK memuat teks fitur rilis ini: ${s1}"
done
for s2 in @@DIST_LAMA@@; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur Rencana Produksi (jadwal mingguan) baru ada; teks fitur live lama tetap ada"

PHASE="4c-aset-lama"; say "4c. Bawa aset ber-hash dari dist release aktif (tab terbuka saat deploy tetap bisa memuat chunk lama)"
OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"
n=0
for f in "$PREV_DIR"/frontend/dist/assets/*; do
  [ -f "$f" ] || continue; b="$(basename "$f")"
  [ -e "$NEW_DIR/frontend/dist/assets/$b" ] && continue
  cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b" && { printf '%s\n' "$b" >> "$OLD_ASSETS"; n=$((n+1)); }
done
find "$NEW_DIR/frontend/dist/assets" -type f -mtime +21 -delete
ok "${n} aset lama dibawa ke dist baru; index.html baru tetap hanya merujuk aset baru"
[ -n "$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "index/bundel baru rusak setelah membawa aset lama"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-rjm-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, migrasi dengan image baru, uji perilaku, kode baru terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
rehearsal_jalur image

PHASE="6-migrate"; say "6. Migrasi aditif (image baru; backend lama tetap melayani) — keadaan ${KEADAAN}"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum migrasi"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum migrasi"
# Keadaan production diputuskan ULANG sesaat sebelum bertindak: harus sama dengan preflight (tidak ada sesi lain yang menerapkan/mengubah migrasi).
KEADAAN2="$(keadaan_produksi "2")" || die "${KEADAAN2}"
[ "$KEADAAN2" = "$KEADAAN" ] || die "keadaan production berubah sejak preflight (${KEADAAN} → ${KEADAAN2})"
cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sebelum2.txt" || die "daftar migrasi terpasang berubah selama persiapan (sesi lain menerapkan migrasi) — berhenti, ulangi preflight"
SOLO_PROD="$(comm -13 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) "$BK_DIR/applied-sebelum2.txt" || true)"
[ -z "$SOLO_PROD" ] || die "produksi memiliki migrasi yang TIDAK ada di image baru: $(printf '%s' "$SOLO_PROD" | tr '\n' ' ')"
PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) "$BK_DIR/applied-sebelum2.txt" || true)"
if [ "$KEADAAN" = "SEGAR" ]; then
  [ "$(printf '%s\n' "$PENDING" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || die "migrasi pending bukan tepat migrasi rilis ini: $(printf '%s' "$PENDING" | tr '\n' ' ')"
else
  [ -z "$(printf '%s' "$PENDING" | tr -d ' \n')" ] || die "keadaan LANJUT: tidak boleh ada migrasi pending: $(printf '%s' "$PENDING" | tr '\n' ' ')"
fi
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-migrasi.txt" || die "sidik jari beku pra-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH sebelum migrasi"; }
psql_live -At -c "$SKEMA_SQL" > "$BK_DIR/skema-prod-sebelum.txt" || die "sidik jari skema produksi sebelum gagal"
psql_live -At -c "select md5(coalesce(string_agg(migration_name||':'||checksum||':'||applied_steps_count::text, ',' order by migration_name),'')) from _prisma_migrations where migration_name in ($(printf "'%s'," $MIG_LIST | sed 's/,$//'))" > "$BK_DIR/mig-kand-prod-sebelum.txt" || die "sidik jari baris migrasi rilis gagal"
if [ "$KEADAAN" = "SEGAR" ]; then
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
else
  # LANJUT: migrasi SUDAH terpasang dan terbukti (checksum, struktur, kosong). TIDAK menjalankan migrate deploy: hanya membaca status (tanpa penulisan).
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | tee "$BK_DIR/migrate-status-lanjut.log" | grep -i 'up to date' >/dev/null || die "keadaan LANJUT: migrate status production tidak 'up to date'"
  ! grep -qi 'have not yet been applied\|pending' "$BK_DIR/migrate-status-lanjut.log" || die "keadaan LANJUT: migrate status melaporkan migrasi pending"
fi
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + N_MIG ))" ] || die "jumlah migrasi terpasang != baseline + ${N_MIG} ($(( MIG_SEBELUM + N_MIG )))"
for m in $MIG_LIST; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
[ "$(psql_live -At -c "select md5(coalesce(string_agg(migration_name||':'||checksum||':'||applied_steps_count::text, ',' order by migration_name),'')) from _prisma_migrations where migration_name in ($(printf "'%s'," $MIG_LIST | sed 's/,$//'))")" = "$(cat "$BK_DIR/mig-kand-prod-sebelum.txt")" ] || [ "$KEADAAN" = "SEGAR" ] || die "keadaan LANJUT: baris migrasi rilis BERUBAH (diulang/diubah)"
struktur_baru LQ die
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$(cat "$BK_DIR/skema-prod-sebelum.txt")" ] || die "skema tabel lama BERUBAH (jangan switch)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah tahap migrasi"
if [ "$KEADAAN" = "SEGAR" ]; then ok "${N_MIG} migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + N_MIG ))); 3 tabel rilis kosong, struktur lengkap tervalidasi; skema tabel lama identik; backend lama tetap sehat"
else ok "keadaan LANJUT: migrasi TIDAK diulang dan tidak ada yang dilewati — $(( MIG_SEBELUM + N_MIG )) migrasi terpasang (baris migrasi rilis identik sebelum/sesudah gerbang), 3 tabel rilis kosong, struktur lengkap tervalidasi, status up to date; backend lama tetap sehat"; fi
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari beku pasca-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh tahap migrasi (jangan switch)"; }
ok "pasca-tahap-migrasi sebelum switch: dokumen pembanding beku IDENTIK"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru (${NEW_INDEX})"; ok "bundel web publik = dist baru ${NEW_INDEX}"
NBE=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in backend/src/*) ;; *) continue;; esac
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
  NBE=$((NBE+1))
done <<< "$CHANGED"
NBE_EXPECT="$(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w)"
[ "$NBE" = "$NBE_EXPECT" ] || die "berkas backend yang diverifikasi harus tepat ${NBE_EXPECT} (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
[ "$(PSQLN "select count(*) from pg_tables where schemaname='public' and tablename in ('production_unit_schedules','production_unit_schedule_events','unit_component_reuse_entries')")" = "3" ] || die "3 tabel rilis tidak ada di produksi"
[ "$(PSQLN "select (select count(*) from production_unit_schedules) + (select count(*) from production_unit_schedule_events) + (select count(*) from unit_component_reuse_entries)")" = "0" ] || die "ada jadwal tepat setelah switch (tidak ada yang boleh membuatnya)"
ok "objek rilis terpasang di produksi: 3 tabel (jadwal, riwayat jadwal, komponen lama) — kosong"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin, penolakan sebelum menyentuh data, daftar tiga status, panel unit nyata, katalog per kelompok, ekspor xlsx, pagar tulis; tidak ada tulisan"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
@@SMOKE_NODE@@
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else ok "smoke test lulus (izin, penolakan sebelum menyentuh data, daftar tiga status, panel unit nyata, katalog per kelompok, ekspor xlsx, pagar tulis, tanpa tulisan)"; fi
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} tidak bisa diunduh (404) — pembawaan aset lama gagal"
  ok "aset lama ${OLD_ONLY} masih 200 (tab terbuka tidak kena 404)"
fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang memang tidak ada harus 404 jujur"
ok "aset yang tidak ada = 404 (bukan index.html)"
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$FP_BEKU_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/data-sesudah.txt" || die "sidik jari dokumen beku sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis — periksa dengan backup"; }
ok "dokumen pembanding beku (pergerakan stok, saldo per bahan, jurnal Finance, id unit/job/Run/operasi/bukti tahap/log tahap/QC/serah/pembayaran/aktivitas) IDENTIK sebelum vs sesudah rilis"
# Pembersihan release lama (setelah rilis TERBUKTI sehat). Dipertahankan: 4 terbaru (mtime), release baru, release sebelumnya, dan release yang dirujuk container berjalan. Kegagalan di sini TIDAK menggagalkan rilis.
PHASE="9-pembersihan"; say "9. Pembersihan release lama (menyisakan 4 terbaru + yang dipakai container)"
(
  cd "$RELEASES" || exit 0
  KEEP="$(ls -1dt */ | head -4 | tr -d /)
$(basename "$NEW_DIR")
$(basename "$PREV_DIR")"
  for c in $(docker ps -q); do w="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null)"; [ -n "$w" ] && KEEP="$KEEP
$(basename "$w")"; done
  HAPUS="$(ls -1d */ | tr -d / | grep -vxF -f <(echo "$KEEP" | sort -u) || true)"
  n=0; for d in $HAPUS; do case "$d" in ""|"."|"..") continue;; esac; [ -d "$d" ] || continue; rm -rf -- "$d" 2>/dev/null || sudo -n rm -rf -- "$d" 2>/dev/null; n=$((n+1)); done
  echo "  OK    release lama dihapus: $n folder; disk: $(df -h "$HOME" | awk 'NR==2{print $4" bebas"}')"
) || echo "  (pembersihan dilewati)"
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
say "CATATAN: rilis ini TIDAK membuat jadwal, order, penerimaan, Run, serah-terima, pergerakan stok, jurnal, job, atau pesan pelanggan. Jadwal pertama dibuat Admin lewat Rencana Produksi (kalender mingguan); mulai dengan satu unit uji yang disepakati lalu periksa Riwayat jadwal dan Excel hasil ekspor."
