#!/usr/bin/env bash
# Rilis MANUAL Resi Gabungan FASE 2 (OrderGroup: tabel order_groups + kolom Order.group_id, aditif) ke produksi dengan workflow
# RELEASE-DIRECTORY (~/releases/klinik-matras/<sha8>). Diadaptasi dari release-delivery-control-final.sh (gate, backup+restore-verify, image rollback).
#
#   git show <sha>:scripts/release-resi-fase2.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/rrf2.sh && bash /tmp/rrf2.sh <DEPLOY_SHA_LENGKAP> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rrf2.sh <DEPLOY_SHA_LENGKAP>'
#
# Baseline produksi = main 414e68a7 (produksi dan main sudah sama). DEPLOY_SHA harus HEAD origin/main (main di-fast-forward lebih dulu) dan keturunan baseline.
# Satu-satunya migration pending: 20260927200000_order_groups (aditif: 1 enum + 1 tabel + 1 kolom nullable). Frontend TIDAK berubah (dist produksi disalin apa adanya).
# RESI_INPUT_AKTIF wajib tetap false. TIDAK ada backfill. Smoke HANYA MEMBACA (POST /api/resi hanya untuk membuktikan 403 saat flag mati).
# Prinsip: fail-fast; tanpa reset/stash/force; tanpa rollback otomatis (hanya instruksi); tanpa secret di layar; DROP hanya DB sementara verifikasi restore.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
PROD_FULL="414e68a7aa0df72138f2d88fc7a8151a9ecdb60a"     # commit produksi aktif = baseline (sama dengan main sebelum fast-forward)
NEW_MIGRATION="20260927200000_order_groups"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
# Berkas yang BOLEH berubah dari baseline (daftar tepat; selain itu = STOP)
ALLOWED_FILES="backend/prisma/migrations/${NEW_MIGRATION}/migration.sql
backend/prisma/schema.prisma
backend/scripts/resiBackfillBundle.js
backend/src/services/resi.js
backend/src/services/resiBackfill.js
backend/tests/integration/resiOrderGroup.integration.test.js
backend/tests/integration/setup/testDb.js
backend/tests/resiBackfill.test.js
docs/RESI-GABUNGAN-FASE2.md
scripts/release-resi-fase2.sh"

PREFLIGHT_ONLY=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/resi2-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_COMMIT=""; PREV_IMG_ID=""; IMG_NAME=""; VERIFY_DB=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
CDIR=""
psql_live() { dcp "${CDIR:-$PREV_DIR}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }

rollback_instructions() {
  cat <<EOF

────────────────────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────────────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>}  (commit ${PREV_COMMIT:-?}); TIDAK dihapus/ditimpa
Release baru       : ${NEW_DIR}
Image sebelumnya   : ${ROLLBACK_TAG:-<belum ditandai>}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}  (+ .sha256)

A. Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.
B. Setelah switch, backend bermasalah -> kembali ke release + image sebelumnya (tanpa build ulang):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps backend
   curl -fsS ${INTERNAL_URL}/api/health
C. Tabel order_groups, kolom "Order".group_id, dan enum TIDAK dihapus oleh rollback kode: kode lama tidak membacanya, kolom nullable & kosong (aman dibiarkan).
   Penghapusan skema/data HANYA atas permintaan eksplisit pemilik.
D. Restore dari backup hanya jalan terakhir dan wajib persetujuan pemilik (docs/PANDUAN-RESTORE-BACKUP.md bagian 6).
──────────────────────────────────────────────────────────────────────────────────────────────────────────
EOF
}

cleanup() {
  local rc=$?
  if [ -n "$VERIFY_DB" ] && [[ "$VERIFY_DB" =~ ^km_release_verify_[0-9]{8}_[0-9]{6}$ ]] && [ -n "$PREV_DIR" ]; then
    dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" --if-exists "$VERIFY_DB" </dev/null >/dev/null 2>&1 || warn "gagal menghapus DB sementara ${VERIFY_DB}"
  fi
  if [ $rc -ne 0 ]; then
    printf '\n\033[31mRILIS BERHENTI (kode %s) pada fase: %s. Tidak ada rollback otomatis.\033[0m\n' "$rc" "$PHASE" >&2
    [ "$PREFLIGHT_ONLY" = "1" ] || rollback_instructions >&2
  fi
}
trap cleanup EXIT

# Bukti keadaan data (BACA-SAJA). Tahan terhadap sebelum/sesudah migrasi: group_id dibuang dari hash Order; order_groups = -1 bila belum ada.
BASELINE_SQL=$(cat <<'SQL'
select 'order_tanpa_group_id', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'group_id')::text, '|' order by x.id), '')) from "Order" x;
select 'order_item', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from "OrderItem" x;
select 'invoices', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from invoices x;
select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from payments x;
select 'alokasi', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_payment_allocations x;
select 'unit', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from units x;
select 'job', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from jobs x;
select 'jurnal', count(*), md5(coalesce(string_agg(e.id::text || e.status || e.entry_number, ',' order by e.id), '')) from fin_journal_entries e;
select 'baris_jurnal', count(*), sum(l.debit), sum(l.credit), md5(coalesce(string_agg(l.id::text || l.debit || l.credit || l.account_id, ',' order by l.id), '')) from fin_journal_lines l;
select 'saldo_semua_akun', md5(coalesce(string_agg(t.code || ':' || t.s, ',' order by t.code), '')) from (select a.code, coalesce(sum(l.debit - l.credit), 0) s from fin_accounts a left join fin_journal_lines l on l.account_id = a.id left join fin_journal_entries e on e.id = l.entry_id and e.status in ('POSTED', 'REVERSED') group by a.code) t;
select 'akun_terlindungi', a.code, coalesce(sum(l.debit - l.credit), 0) from fin_accounts a left join fin_journal_lines l on l.account_id = a.id join fin_journal_entries e on e.id = l.entry_id and e.status in ('POSTED', 'REVERSED') where a.code in ('2-1600', '2-1700') group by a.code order by a.code;
select 'kas', c.name, coalesce(sum(l.debit - l.credit), 0) from fin_cash_accounts c left join fin_journal_lines l on l.account_id = c.account_id left join fin_journal_entries e on e.id = l.entry_id and e.status in ('POSTED', 'REVERSED') group by c.name order by c.name;
select 'jv_terlindungi', e.entry_number, e.status, sum(l.debit), md5(string_agg(l.id::text || l.debit || l.credit, ',' order by l.id)) from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id where e.entry_number like 'JV-%' and e.entry_number ~ '-(372|391|515|516|517)$' group by e.entry_number, e.status order by 2;
select 'group_id_tidak_null', count(*) from "Order" o where (to_jsonb(o) ->> 'group_id') is not null;
select 'order_groups_baris', case when to_regclass('public.order_groups') is null then -1 else (xpath('/row/c/text()', query_to_xml('select count(*) as c from order_groups', false, true, '')))[1]::text::int end;
select 'flag_resi_input_aktif', coalesce((select value from fin_settings where key = 'resi_input_aktif'), '(tidak ada = mati)');
SQL
)
snapshot() { printf '%s\n' "$BASELINE_SQL" | dcp "${CDIR:-$PREV_DIR}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q; }

# ── 0. Lingkungan ────────────────────────────────────────────────────────────────────────────────────────
PHASE="0-lingkungan"; say "0. Lingkungan"
for c in git docker curl gzip sha256sum awk grep flock tar sed df comm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
docker compose version >/dev/null 2>&1 || die "docker compose tidak tersedia"
exec 9>/tmp/release-resi2.lock; flock -n 9 || die "rilis lain sedang berjalan (kunci /tmp/release-resi2.lock)"
mkdir -p "$BK_DIR" "$HOME/release-src"
LOG="$BK_DIR/release.log"; exec > >(tee -a "$LOG") 2>&1
ok "log: ${LOG}"
[ -d "$RELEASES" ] || die "direktori rilis ${RELEASES} tidak ada"
[ -f "$PERSIST/backend/.env" ] || die "${PERSIST}/backend/.env tidak ada"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
ok "root persisten lengkap"
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

# ── 1. Sumber kode ───────────────────────────────────────────────────────────────────────────────────────
PHASE="1-sumber"; say "1. Sumber kode, ancestry, dan batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=500 origin "+refs/heads/main:refs/remotes/origin/main" || die "git fetch origin gagal"
ORIGIN_MAIN="$(sg rev-parse refs/remotes/origin/main)"
[ "$ORIGIN_MAIN" = "$DEPLOY_SHA" ] || die "origin/main (${ORIGIN_MAIN:0:8}) BUKAN SHA rilis (${DEPLOY_SHORT}); fast-forward main dulu / main bergeser"
sg merge-base --is-ancestor "$PROD_FULL" "$DEPLOY_SHA" || die "baseline produksi ${PROD_FULL:0:8} bukan leluhur SHA rilis"
ok "origin/main = ${DEPLOY_SHORT}; baseline ${PROD_FULL:0:8} adalah leluhurnya"
CHANGED="$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ "$CHANGED" = "$(printf '%s\n' "$ALLOWED_FILES" | LC_ALL=C sort)" ] || { printf '%s\n' "$CHANGED" | sed 's/^/        /'; die "berkas yang berubah TIDAK sama persis dengan daftar yang diaudit"; }
ok "perubahan = tepat 10 berkas yang diaudit (skema+migration aditif, resi.js, skrip/servis backfill, tes, docs, skrip rilis)"
[ -z "$(sg diff --name-status --diff-filter=D "$PROD_FULL" "$DEPLOY_SHA")" ] || die "ada berkas dihapus"
[ -z "$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" -- frontend driver-mobile delivery-control packages backend/src/routes backend/src/index.js backend/src/services/finance backend/Dockerfile docker-compose.yml docker-compose.release.yml)" ] || die "rilis menyentuh area terlarang"
ok "frontend, route, finance, Docker, driver-mobile TIDAK berubah; dist produksi dipakai ulang"
NEWMIG="$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" -- backend/prisma/migrations)"
[ "$NEWMIG" = "backend/prisma/migrations/${NEW_MIGRATION}/migration.sql" ] || die "migration baru bukan hanya ${NEW_MIGRATION}"
MIGSQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${NEW_MIGRATION}/migration.sql" | tr -d '\r')"
printf '%s\n' "$MIGSQL" | grep -Ei '^\s*(update|delete|truncate|drop)\b|insert into' >/dev/null && die "migration memuat UPDATE/DELETE/DROP/INSERT (harus murni aditif)"
printf '%s\n' "$MIGSQL" | grep -c 'CREATE TYPE\|CREATE TABLE\|ADD COLUMN\|CREATE .*INDEX\|ADD CONSTRAINT' | grep -qv '^0$' || die "migration tidak berisi DDL aditif yang diharapkan"
ok "migration ${NEW_MIGRATION} murni aditif (tanpa UPDATE/DELETE/DROP/INSERT)"

# ── 2. Audit produksi (baca-saja) ────────────────────────────────────────────────────────────────────────
PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$PROD_FULL" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${PROD_FULL:0:8}; produksi bergeser"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"; CDIR="$PREV_DIR"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT} = baseline); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
DIST_INDEX="$PREV_INDEX"; ok "health sehat; bundel publik = dist release aktif (${DIST_INDEX})"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
IDS_BEFORE="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" | sort | tr '\n' ' ')"

say "2b. Migration: pending harus TEPAT ${NEW_MIGRATION}"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung di produksi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort > "$BK_DIR/applied.txt"
sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's#backend/prisma/migrations/##' | grep -E '^[0-9]{14}_' | LC_ALL=C sort > "$BK_DIR/tree.txt"
PENDING="$(LC_ALL=C comm -13 "$BK_DIR/applied.txt" "$BK_DIR/tree.txt")"; AHEAD="$(LC_ALL=C comm -23 "$BK_DIR/applied.txt" "$BK_DIR/tree.txt")"
[ -z "$AHEAD" ] || die "DB memuat migration yang tidak ada di kode rilis: $(printf '%s' "$AHEAD" | tr '\n' ' ')"
[ "$PENDING" = "$NEW_MIGRATION" ] || die "pending bukan tepat ${NEW_MIGRATION}: $(printf '%s' "$PENDING" | tr '\n' ' ')"
for m in 20260926140000_normalize_order_weight_entry_index 20260927150000_user_divisions 20260927170000_coa_bagi_hasil_investor; do
  grep -Fx "$m" "$BK_DIR/applied.txt" >/dev/null || die "migration ${m} belum applied di produksi"
done
ok "applied $(wc -l < "$BK_DIR/applied.txt"); pending TEPAT ${NEW_MIGRATION}; OrderWeightEntry + user_divisions + COA bagi hasil sudah applied (berurutan sebelum migration baru)"

say "2c. Kondisi data SEBELUM (baca-saja) dan flag"
snapshot > "$BK_DIR/baseline-sebelum.txt" || die "snapshot sebelum gagal"
grep -E '^flag_resi_input_aktif\|(false|\(tidak ada = mati\))$' "$BK_DIR/baseline-sebelum.txt" >/dev/null || die "RESI_INPUT_AKTIF bukan false di produksi"
grep -Fx 'order_groups_baris|-1' "$BK_DIR/baseline-sebelum.txt" >/dev/null || die "order_groups sudah ada sebelum rilis (tidak diharapkan)"
ok "flag resi_input_aktif = false; order_groups belum ada; baseline sebelum tersimpan"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 6 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"

if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; exit 0; fi

# ── 3. Backup + verifikasi restore ───────────────────────────────────────────────────────────────────────
PHASE="3-backup"; say "3. Backup produksi + checksum + verifikasi restore ke DB sementara"
BACKUP_FILE="$HOME/backups/pre-resi2-${DEPLOY_SHORT}-${TS}.sql.gz"
COUNTS_SQL="select table_name||'|'||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
psql_live -At -c "$COUNTS_SQL" > "$BK_DIR/.counts_before.txt"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
psql_live -At -c "$COUNTS_SQL" > "$BK_DIR/.counts_after.txt"
SHA256="$(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 ${SHA256}"
PHASE="3b-verifikasi-restore"
VERIFY_DB="km_release_verify_${TS}"; [[ "$VERIFY_DB" =~ ^km_release_verify_[0-9]{8}_[0-9]{6}$ ]] || die "nama DB verifikasi tidak aman"
dcp "$PREV_DIR" exec -T postgres createdb -U "$DB_USER" "$VERIFY_DB" </dev/null || die "gagal membuat DB sementara"
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -X -q -o /dev/null || die "restore ke DB sementara GAGAL"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -c "$COUNTS_SQL" </dev/null > "$BK_DIR/.counts_restored.txt" || die "gagal menghitung baris hasil restore"
diff -q <(cut -d'|' -f1 "$BK_DIR/.counts_before.txt") <(cut -d'|' -f1 "$BK_DIR/.counts_restored.txt") >/dev/null || die "daftar tabel hasil restore berbeda"
BAD="$(awk -F'|' 'NR==FNR{b[$1]=$2;next} FILENAME==ARGV[2]{a[$1]=$2;next} {t=$1; r=$2; d=r-b[t]; if(d<0)d=-d; lim=b[t]*0.02; if(lim<25)lim=25; if(d>lim && !(r>=b[t] && r<=a[t]) && !(r<=b[t] && r>=a[t])) print t": sebelum="b[t]" sesudah="a[t]" restore="r}' "$BK_DIR/.counts_before.txt" "$BK_DIR/.counts_after.txt" "$BK_DIR/.counts_restored.txt")"
[ -z "$BAD" ] || die "jumlah baris hasil restore tidak cocok: ${BAD}"
[ "$(psql_live -At -c 'select count(*) from _prisma_migrations')" = "$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -c 'select count(*) from _prisma_migrations' </dev/null)" ] || die "_prisma_migrations berbeda pada hasil restore"
ok "restore terverifikasi: $(wc -l < "$BK_DIR/.counts_restored.txt") tabel cocok"
dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" "$VERIFY_DB" </dev/null && VERIFY_DB="" && ok "DB sementara dihapus"
rm -f "$BK_DIR"/.counts_*.txt

# ── 4. Release dir ───────────────────────────────────────────────────────────────────────────────────────
PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive SHA rilis; release aktif tidak disentuh)"
[ "$(sg ls-remote origin refs/heads/main | cut -f1)" = "$DEPLOY_SHA" ] || die "origin/main berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin dist produksi"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/dist/index.html; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
grep "$DIST_INDEX" "$NEW_DIR/frontend/dist/index.html" >/dev/null || die "dist tidak merujuk ${DIST_INDEX}"
# Normalisasi CRLF -> LF pada berkas teks backend yang di-archive dari commit (rilis harus LF)
if grep -rl $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat; dist = salinan dist produksi (${DIST_INDEX}); compose identik"

# ── 5. Build image ───────────────────────────────────────────────────────────────────────────────────────
PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-resi2-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

# ── 6. Migration ─────────────────────────────────────────────────────────────────────────────────────────
PHASE="6-migrate"; say "6. prisma migrate deploy (image baru; hanya ${NEW_MIGRATION})"
snapshot > "$BK_DIR/baseline-pra-migrasi.txt" || die "snapshot pra-migrasi gagal"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null || true
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration setengah jalan; JANGAN switch"
[ "$(psql_live -At -c 'select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null')" = "$(( $(wc -l < "$BK_DIR/applied.txt") + 1 ))" ] || die "jumlah applied != baseline + 1"
psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${NEW_MIGRATION}'" | grep -Fx t >/dev/null || die "${NEW_MIGRATION} tidak tercatat selesai"
ok "migration diterapkan: ${NEW_MIGRATION} (applied $(wc -l < "$BK_DIR/applied.txt") -> $(( $(wc -l < "$BK_DIR/applied.txt") + 1 ))); tidak ada yang menggantung"
# Backend LAMA masih melayani DB yang sudah bermigrasi: kolom nullable tambahan aman untuk kode lama.
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi"
ok "backend lama tetap sehat setelah migrasi (aditif)"

# ── 7. Switch ────────────────────────────────────────────────────────────────────────────────────────────
PHASE="7-switch"; say "7. Switch backend ke release baru"
SWITCH_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
CDIR="$NEW_DIR"; ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

# ── 8. Healthcheck ───────────────────────────────────────────────────────────────────────────────────────
PHASE="8-healthcheck"; say "8. Healthcheck internal dan publik"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal gagal"; ok "internal 200"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$DIST_INDEX" ] || die "bundel publik berubah"; ok "bundel web publik = ${DIST_INDEX}"
IDS_AFTER="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" | sort | tr '\n' ' ')"
[ "$(comm -3 <(printf '%s\n' $IDS_BEFORE) <(printf '%s\n' $IDS_AFTER) | grep -c . || true)" = "2" ] || warn "container lain di project berubah (diharapkan hanya backend)"

# ── 9. Smoke test (BACA-SAJA) ────────────────────────────────────────────────────────────────────────────
PHASE="9-smoke"; say "9. Smoke test (baca-saja; POST resi hanya membuktikan 403 saat flag mati)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
if (!adm) { rec("akun ADMIN aktif", false, "tidak ada"); process.exit(1); }
const roles = (await prisma.userRole.findMany({ where: { userId: adm.id }, select: { role: true } })).map((r) => r.role);
const token = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: roles.length ? roles : [adm.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const st = await api("GET", "/api/resi/status", token);
rec("GET /api/resi/status -> 200 dan aktif=false", st.status === 200 && st.json?.aktif === false, `status ${st.status}`);
const nol = await api("GET", "/api/resi/status", null);
rec("tanpa token ditolak (401)", nol.status === 401, `status ${nol.status}`);
const sebelum = [await prisma.order.count(), await prisma.orderGroup.count()];
const post = await api("POST", "/api/resi", token, { customerId: "tidak-ada", items: [{ nominal: 1000 }] });
rec("POST /api/resi saat flag mati -> 403", post.status === 403, `status ${post.status}`);
const sesudah = [await prisma.order.count(), await prisma.orderGroup.count()];
rec("POST 403 tidak membuat order/grup", sebelum[0] === sesudah[0] && sesudah[1] === 0, `order ${sebelum[0]}->${sesudah[0]}, grup ${sesudah[1]}`);
rec("klien Prisma membaca order_groups (kosong) dan Order.groupId (semua NULL)", (await prisma.orderGroup.count()) === 0 && (await prisma.order.count({ where: { groupId: { not: null } } })) === 0);
const c = await prisma.customer.findFirst({ where: { orders: { some: {} } }, select: { id: true } });
if (c) { const d = await api("GET", `/api/customers/${c.id}`, token); rec("detail customer berorder terbaca (200) dengan skema baru", d.status === 200 && Array.isArray(d.json?.orders), `status ${d.status}`); }
const inv = await prisma.invoice.findFirst({ where: { combinedIntoId: { not: null } }, select: { orderId: true } });
rec("invoice bundle lama tetap terbaca", inv !== null);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus"

# ── 10. Verifikasi data sesudah ──────────────────────────────────────────────────────────────────────────
PHASE="10-verifikasi-data"; say "10. Data SESUDAH vs SEBELUM (baca-saja)"
snapshot > "$BK_DIR/baseline-sesudah.txt" || die "snapshot sesudah gagal"
grep -Fx 'order_groups_baris|0' "$BK_DIR/baseline-sesudah.txt" >/dev/null || die "order_groups tidak kosong"; ok "order_groups = 0 baris"
grep -Fx 'group_id_tidak_null|0' "$BK_DIR/baseline-sesudah.txt" >/dev/null || die "ada Order.group_id tidak NULL"; ok "semua orders.group_id NULL"
grep -E '^flag_resi_input_aktif\|(false|\(tidak ada = mati\))$' "$BK_DIR/baseline-sesudah.txt" >/dev/null || die "flag RESI_INPUT_AKTIF tidak false"; ok "RESI_INPUT_AKTIF tetap false"
DIFFS="$(diff <(grep -Ev '^(order_groups_baris|group_id_tidak_null)\|' "$BK_DIR/baseline-sebelum.txt") <(grep -Ev '^(order_groups_baris|group_id_tidak_null)\|' "$BK_DIR/baseline-sesudah.txt") || true)"
DIFFS_MIG="$(diff <(grep -Ev '^(order_groups_baris|group_id_tidak_null)\|' "$BK_DIR/baseline-pra-migrasi.txt") <(grep -Ev '^(order_groups_baris|group_id_tidak_null)\|' "$BK_DIR/baseline-sesudah.txt") || true)"
if [ -z "$DIFFS_MIG" ]; then ok "hash order/invoice/payment/alokasi/unit/job/jurnal/saldo/kas/JV terlindungi IDENTIK (pra-migrasi vs sesudah rilis)"
else warn "ADA selisih pra-migrasi vs sesudah (kemungkinan aktivitas normal saat rilis berjalan). Tinjau manual:"; printf '%s\n' "$DIFFS_MIG" | sed 's/^/        /' | sed -n 1,30p; fi
[ -z "$DIFFS" ] && ok "IDENTIK juga terhadap snapshot awal preflight" || warn "selisih terhadap snapshot awal (lihat ${BK_DIR}/baseline-*.txt)"

# ── 11. Log & migration ──────────────────────────────────────────────────────────────────────────────────
PHASE="11-log"; say "11. Log backend sejak switch (${SWITCH_AT}) dan migration"
LOGS="$(dcp "$NEW_DIR" logs --since "$SWITCH_AT" --no-color backend </dev/null 2>&1 | cut -c1-240 || true)"
FATAL="$(printf '%s\n' "$LOGS" | grep -Ei 'P2021|P2022|does not exist|PrismaClientInitializationError|Cannot find module|EADDRINUSE' || true)"
[ -z "$FATAL" ] || { printf '%s\n' "$FATAL" | sed -n 1,10p; die "log backend memuat error skema/inisialisasi"; }
ERRN="$(printf '%s\n' "$LOGS" | grep -Eic 'error|exception|unhandled' || true)"; ok "tanpa error skema/inisialisasi; baris 'error/exception': ${ERRN}"
[ "$ERRN" = "0" ] || printf '%s\n' "$LOGS" | grep -Ei 'error|exception|unhandled' | sed -n 1,8p | sed 's/^/        /'
dcp "$NEW_DIR" exec -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null && ok "prisma migrate status: database schema is up to date (tidak ada migrasi pending)" || die "migrate status tidak 'up to date'"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung setelah rilis"

PHASE="12-selesai"; say "12. Ringkasan"
dcp "$NEW_DIR" ps </dev/null
cat <<EOF

RILIS RESI GABUNGAN FASE 2 SELESAI (flag TETAP MATI, tanpa backfill).
  release aktif : ${NEW_DIR}  (commit ${DEPLOY_SHA})
  release lama  : ${PREV_DIR}  (commit ${PREV_COMMIT}; tidak dihapus)
  image lama    : ${ROLLBACK_TAG}
  backup        : ${BACKUP_FILE}
  sha256        : ${SHA256}
  log/baseline  : ${BK_DIR}
EOF
trap - EXIT
exit 0
