#!/usr/bin/env bash
# Rilis MANUAL backend "avatarUrl aditif" (Delivery Control: foto driver/helper di /armada/drivers, /armada/helpers, /armada/routes) ke produksi
# dengan workflow RELEASE-DIRECTORY (~/releases/klinik-matras/<sha8>). Diturunkan dari release-ukuran-tahap2.sh.
# HANYA backend/src/routes/armada.js yang berubah di kode aplikasi (menambah kolom avatarUrl pada select Prisma). TANPA migration/schema, TANPA build frontend
# (dist aktif disalin apa adanya), TANPA perubahan data. Aplikasi mobile TIDAK ikut rilis ini.
#
#   git show <sha>:scripts/release-avatar-url.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/rav.sh && bash /tmp/rav.sh <DEPLOY_SHA_LENGKAP> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rav.sh <DEPLOY_SHA_LENGKAP>'
#
# Baseline produksi = 87bbba36 (main 8b1756a6 hanya menambah tes di atasnya). DEPLOY_SHA = merge main + fitur di branch ${RELEASE_BRANCH}.
# Smoke HANYA MEMBACA. Prinsip: fail-fast; tanpa reset/stash/force; tanpa rollback otomatis (hanya instruksi); tanpa secret di layar; DROP hanya DB sementara verifikasi restore.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
PROD_FULL="87bbba36b572b791fa140b6864ec4e49449b5646"     # commit produksi aktif = baseline
RELEASE_BRANCH="feat/delivery-control-mobile-v2"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
# Pola berkas yang BOLEH berubah dari baseline (selain itu = STOP). Kode aplikasi produksi: HANYA armada.js.
ALLOWED_RE='^(backend/src/routes/armada\.js|backend/tests/.*|delivery-control/.*|docs/.*|scripts/release-avatar-url\.sh)$'

PREFLIGHT_ONLY=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/avatar-${DEPLOY_SHORT}-${TS}"
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
C. Rilis ini TANPA migration/skema dan TANPA data baru: rollback kode (backend saja; dist frontend tidak berubah) tidak menyentuh data.
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
select 'flag_ukuran_custom_wajib', coalesce((select value from fin_settings where key = 'ukuran_custom_wajib'), '(tidak ada = mati)');
SQL
)
snapshot() { printf '%s\n' "$BASELINE_SQL" | dcp "${CDIR:-$PREV_DIR}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q; }

# ── 0. Lingkungan ────────────────────────────────────────────────────────────────────────────────────────
PHASE="0-lingkungan"; say "0. Lingkungan"
for c in git docker curl gzip sha256sum awk grep flock tar sed df comm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
docker compose version >/dev/null 2>&1 || die "docker compose tidak tersedia"
exec 9>/tmp/release-avatar.lock; flock -n 9 || die "rilis lain sedang berjalan (kunci /tmp/release-avatar.lock)"
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
sg fetch -q --depth=500 origin "+refs/heads/${RELEASE_BRANCH}:refs/remotes/origin/${RELEASE_BRANCH}" || die "git fetch origin gagal"
ORIGIN_REL="$(sg rev-parse "refs/remotes/origin/${RELEASE_BRANCH}")"
[ "$ORIGIN_REL" = "$DEPLOY_SHA" ] || die "origin/${RELEASE_BRANCH} (${ORIGIN_REL:0:8}) BUKAN SHA rilis (${DEPLOY_SHORT})"
sg merge-base --is-ancestor "$PROD_FULL" "$DEPLOY_SHA" || die "baseline produksi ${PROD_FULL:0:8} bukan leluhur SHA rilis"
ok "origin/${RELEASE_BRANCH} = ${DEPLOY_SHORT}; baseline ${PROD_FULL:0:8} (produksi aktif) adalah leluhurnya"
CHANGED="$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" | LC_ALL=C sort)"
BAD_FILES="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$BAD_FILES" ] || { printf '%s\n' "$BAD_FILES" | sed 's/^/        /'; die "ada berkas di luar daftar yang diaudit"; }
printf '%s\n' "$CHANGED" | grep -Fx 'backend/src/routes/armada.js' >/dev/null || die "armada.js tidak berubah (rilis kosong?)"
ok "perubahan hanya: armada.js + tes + delivery-control (aplikasi mobile, tidak dirilis) + docs + skrip ($(printf '%s\n' "$CHANGED" | grep -c .) berkas)"
[ -z "$(sg diff --name-status --diff-filter=D "$PROD_FULL" "$DEPLOY_SHA")" ] || die "ada berkas dihapus"
[ -z "$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" -- backend/src ':(exclude)backend/src/routes/armada.js' backend/prisma backend/package.json backend/package-lock.json backend/Dockerfile docker-compose.yml docker-compose.release.yml frontend driver-mobile finance-mobile mobile packages)" ] || die "rilis menyentuh area terlarang (kode backend lain, schema/migration, Docker, dependensi, frontend, mobile, packages)"
# Isi armada.js: setelah membuang kolom `avatarUrl: true,` dan baris komentar, berkas rilis HARUS identik dengan berkas produksi (perubahan murni aditif pada select)
norm_armada() { sed -E 's/, avatarUrl: true }/ }/; s/ avatarUrl: true,//' | grep -Ev '^[[:space:]]*//'; }
cmp -s <(sg show "${PROD_FULL}:backend/src/routes/armada.js" | norm_armada) <(sg show "${DEPLOY_SHA}:backend/src/routes/armada.js" | norm_armada) || die "armada.js berubah selain penambahan avatarUrl pada select"
[ "$(sg show "${DEPLOY_SHA}:backend/src/routes/armada.js" | grep -c 'avatarUrl: true')" -gt "$(sg show "${PROD_FULL}:backend/src/routes/armada.js" | grep -c 'avatarUrl: true')" ] || die "tidak ada penambahan avatarUrl"
ok "diff armada.js = hanya penambahan avatarUrl pada select; schema/migration/Docker/dependensi/frontend TIDAK berubah"

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

say "2b. Migration: TIDAK boleh ada pending"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung di produksi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort > "$BK_DIR/applied.txt"
sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's#backend/prisma/migrations/##' | grep -E '^[0-9]{14}_' | LC_ALL=C sort > "$BK_DIR/tree.txt"
PENDING="$(LC_ALL=C comm -13 "$BK_DIR/applied.txt" "$BK_DIR/tree.txt")"; AHEAD="$(LC_ALL=C comm -23 "$BK_DIR/applied.txt" "$BK_DIR/tree.txt")"
[ -z "$AHEAD" ] || die "DB memuat migration yang tidak ada di kode rilis: $(printf '%s' "$AHEAD" | tr '\n' ' ')"
[ -z "$PENDING" ] || die "ada migration pending padahal rilis ini tanpa migration: $(printf '%s' "$PENDING" | tr '\n' ' ')"
ok "applied $(wc -l < "$BK_DIR/applied.txt"); pending: TIDAK ADA"

say "2c. Kondisi data SEBELUM (baca-saja)"
snapshot > "$BK_DIR/baseline-sebelum.txt" || die "snapshot sebelum gagal"
ok "baseline sebelum tersimpan (rilis ini tidak mengubah data; dibandingkan lagi sesudah rilis)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 6 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"

say "2d. dist frontend aktif (akan disalin apa adanya; frontend TIDAK berubah)"
[ -f "$PREV_DIR/frontend/dist/index.html" ] || die "dist release aktif tidak ada"
DIST_KB="$(du -sk "$PREV_DIR/frontend/dist" | cut -f1)"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DIST_KB * 2 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang untuk menyalin dist"
ok "dist aktif ${DIST_INDEX}; ruang cukup"

if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; exit 0; fi

# ── 3. Backup + verifikasi restore ───────────────────────────────────────────────────────────────────────
PHASE="3-backup"; say "3. Backup produksi + checksum + verifikasi restore ke DB sementara"
BACKUP_FILE="$HOME/backups/pre-avatar-${DEPLOY_SHORT}-${TS}.sql.gz"
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
[ "$(sg ls-remote origin "refs/heads/${RELEASE_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "branch rilis berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin dist aktif"
[ "$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)" = "$DIST_INDEX" ] || die "dist salinan berbeda dari dist aktif"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
# Normalisasi CRLF -> LF pada berkas teks backend yang di-archive dari commit (rilis harus LF)
if grep -rl $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat (source dari git archive; dist aktif disalin); compose identik"

# ── 5. Build image ───────────────────────────────────────────────────────────────────────────────────────
PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-avatar-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

# ── 6. Migration ─────────────────────────────────────────────────────────────────────────────────────────
PHASE="6-migrate"; say "6. prisma migrate deploy (image baru; HARUS no-op: tidak ada migration pending)"
snapshot > "$BK_DIR/baseline-pra-migrasi.txt" || die "snapshot pra-migrasi gagal"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null || true
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration setengah jalan; JANGAN switch"
[ "$(psql_live -At -c 'select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null')" = "$(wc -l < "$BK_DIR/applied.txt")" ] || die "jumlah migration applied berubah (seharusnya no-op)"
ok "migrate deploy = no-op (applied tetap $(wc -l < "$BK_DIR/applied.txt")); tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi"
ok "backend lama tetap sehat"

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
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$DIST_INDEX" ] || die "bundel publik berubah (harusnya sama: frontend tidak dirilis)"; ok "bundel web publik tetap ${DIST_INDEX}"
IDS_AFTER="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" | sort | tr '\n' ' ')"
[ "$(comm -3 <(printf '%s\n' $IDS_BEFORE) <(printf '%s\n' $IDS_AFTER) | grep -c . || true)" = "2" ] || warn "container lain di project berubah (diharapkan hanya backend)"

# ── 9. Smoke test (BACA-SAJA) ────────────────────────────────────────────────────────────────────────────
PHASE="9-smoke"; say "9. Smoke test (BACA-SAJA; tidak membuat order)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
const URL_FOTO = /^\/uploads\/avatars\/[\w.-]+$/;
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function api(path, token) {
  const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
if (!adm) { rec("akun ADMIN aktif", false, "tidak ada"); process.exit(1); }
const roles = (await prisma.userRole.findMany({ where: { userId: adm.id }, select: { role: true } })).map((r) => r.role);
const token = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: roles.length ? roles : [adm.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });
rec("tanpa token ditolak (401)", (await api("/api/armada/drivers", null)).status === 401);

const hari = new Date(Date.now() + 7 * 3600_000);
const iso = (d) => d.toISOString().slice(0, 10);
const to = iso(hari), from = iso(new Date(hari.getTime() - 30 * 86400_000)), awalBulan = to.slice(0, 7) + "-01";
const dbFoto = new Map((await prisma.user.findMany({ select: { id: true, avatarUrl: true } })).map((u) => [u.id, u.avatarUrl]));
const semuaFoto = new Set();
const cek = (nama, id, nilai) => {
  // bentuk: kunci ada (aditif), null bila tidak ada foto, sama PERSIS dengan DB, dan hanya URL media publik (bukan path internal)
  const dariDb = dbFoto.get(id) ?? null;
  const benar = nilai !== undefined && (nilai === null || URL_FOTO.test(nilai)) && nilai === dariDb;
  if (nilai) semuaFoto.add(nilai);
  return benar;
};

const dr = await api("/api/armada/drivers", token), hp = await api("/api/armada/helpers", token);
rec("GET /armada/drivers 200, array", dr.status === 200 && Array.isArray(dr.json), `${dr.json?.length} orang`);
rec("drivers: avatarUrl benar (ada/null, = DB, tanpa path internal) untuk SEMUA", dr.status === 200 && dr.json.every((u) => cek("drivers", u.id, u.avatarUrl)), `${dr.json?.filter((u) => u.avatarUrl).length} berfoto, ${dr.json?.filter((u) => u.avatarUrl === null).length} tanpa foto`);
rec("GET /armada/helpers 200, avatarUrl benar untuk SEMUA", hp.status === 200 && Array.isArray(hp.json) && hp.json.every((u) => cek("helpers", u.id, u.avatarUrl)), `${hp.json?.length} orang`);

const rt = await api(`/api/armada/routes?from=${from}&to=${to}&take=100`, token);
const rutes = rt.json?.routes || [];
const orangRute = rutes.flatMap((r) => [r.driver, r.helper]).filter(Boolean);
rec("GET /armada/routes 200", rt.status === 200 && Array.isArray(rt.json?.routes), `${rutes.length} rute, ${orangRute.length} kru`);
rec("routes: driver/helper membawa avatarUrl benar", orangRute.every((o) => cek("routes", o.id, o.avatarUrl)));

const tr = await api("/api/armada/tracking", token);
const trk = Array.isArray(tr.json) ? tr.json : [];
rec("GET /armada/tracking 200 (array)", tr.status === 200 && Array.isArray(tr.json), `${trk.length} armada`);
// tracking membawa nama + URL foto; cocokkan URL ke DB lewat set URL milik pengguna (URL tidak boleh dikarang)
const urlDb = new Set([...dbFoto.values()].filter(Boolean));
const urlTrk = trk.flatMap((x) => [x.driverAvatarUrl, x.helperAvatarUrl]).filter((v) => v !== undefined);
rec("tracking: driverAvatarUrl/helperAvatarUrl null atau URL media milik pengguna (bentuk publik)", urlTrk.every((v) => v === null || (URL_FOTO.test(v) && urlDb.has(v))), `${urlTrk.filter(Boolean).length} berfoto`);

const inc = await api(`/api/armada/incentive-summary?from=${awalBulan}&to=${to}`, token);
const orang = inc.json?.orang || [];
rec("GET /armada/incentive-summary 200", inc.status === 200 && Array.isArray(inc.json?.orang), `${orang.length} orang`);
rec("incentive-summary: avatarUrl benar", orang.every((o) => cek("incentive", o.id, o.avatarUrl)));

const semuaJson = JSON.stringify([dr.json, hp.json, rt.json, tr.json, inc.json]);
rec("tidak ada path internal/rahasia di respons", !/[A-Za-z]:\\|"\/(app|home|root|var|etc)\/|passwordHash/.test(semuaJson));

// URL foto benar-benar terlayani (publik, lewat nginx) sebagai gambar
const contoh = [...semuaFoto][0];
if (contoh) {
  const r = await fetch("https://app.sanomatrassehat.com" + contoh);
  rec("URL foto contoh terlayani publik (200, image/*)", r.status === 200 && /^image\//.test(r.headers.get("content-type") || ""), `${contoh} -> ${r.status} ${r.headers.get("content-type")}`);
} else rec("URL foto contoh", true, "tidak ada pengguna berfoto di respons (dilewati)");
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus"

# ── 10. Verifikasi data sesudah ──────────────────────────────────────────────────────────────────────────
PHASE="10-verifikasi-data"; say "10. Data SESUDAH vs SEBELUM (baca-saja)"
snapshot > "$BK_DIR/baseline-sesudah.txt" || die "snapshot sesudah gagal"
DIFFS="$(diff <(cat "$BK_DIR/baseline-sebelum.txt") <(cat "$BK_DIR/baseline-sesudah.txt") || true)"
DIFFS_MIG="$(diff <(cat "$BK_DIR/baseline-pra-migrasi.txt") <(cat "$BK_DIR/baseline-sesudah.txt") || true)"
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

RILIS BACKEND avatarUrl SELESAI (tanpa migration, tanpa perubahan data/frontend).
  release aktif : ${NEW_DIR}  (commit ${DEPLOY_SHA})
  release lama  : ${PREV_DIR}  (commit ${PREV_COMMIT}; tidak dihapus)
  image lama    : ${ROLLBACK_TAG}
  backup        : ${BACKUP_FILE}
  sha256        : ${SHA256}
  log/baseline  : ${BK_DIR}
EOF
trap - EXIT
exit 0
