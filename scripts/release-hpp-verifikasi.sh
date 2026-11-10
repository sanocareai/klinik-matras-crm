#!/usr/bin/env bash
# RILIS "HPP per Order — verifikasi admin produksi" (keputusan Owner 10 Nov 2026): backend + web, TANPA migrasi. Mengubah siapa yang memverifikasi biaya tanpa stok
# (ADMIN/PRODUCTION_LEAD; pencatatan oleh peran itu langsung berlaku). Tidak menulis stok, jurnal, saldo, PSA, atau cutover; tidak mengisi data.
#   ssh ubuntu@43.133.152.6 'bash /tmp/hov.sh <DEPLOY_SHA> <BASE_SHA> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'bash /tmp/hov.sh <DEPLOY_SHA> <BASE_SHA>'                    # rilis (HANYA setelah persetujuan deploy)
#   ssh ubuntu@43.133.152.6 'bash /tmp/hov.sh <DEPLOY_SHA> <BASE_SHA> --rollback'         # kembali ke folder+image baseline
set -Eeuo pipefail
umask 077
DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ && "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen harus DEPLOY_SHA BASE_SHA 40 karakter" >&2; exit 1; }
MODE=release; for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --rollback) MODE=rollback;; esac; done
CAND_BRANCH="${CAND_BRANCH:-feat/hpp-verifikasi-on-ff17cd82}"; CAND_REF="refs/remotes/origin/cand-hov"
ALLOWED_RE='^(backend/src/lib/domain/hppOrder\.js|backend/src/routes/financeHppOrder\.js|backend/src/services/finance/hppOrder\.js|backend/tests/integration/hppOrder\.integration\.test\.js|frontend/qa-harness/hpp-order-browser\.cjs|frontend/qa-harness/hpp-order-server\.mjs|frontend/src/pages/finance/FinanceHppOrder\.jsx|scripts/release-hpp-verifikasi\.sh)$'
DIFF_SHA='d8f9229263786336feeeb2a107a19cd39810d14643599058d9e82893f9a88a59'
PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"; PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MIN_FREE_KB=$((8 * 1024 * 1024)); TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/hpp-verifikasi-${DEPLOY_SHORT}-${TS}"
PHASE=init; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""
say() { printf '\n== %s\n' "$*"; }; ok() { printf '  OK    %s\n' "$*"; }; warn() { printf '  PERHATIAN %s\n' "$*"; }; die() { printf '\nSTOP [%s]: %s\n' "$PHASE" "$*" >&2; exit 1; }
sg() { git --git-dir="$SRC" "$@"; }
dcp() { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { docker exec -i "$PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
bebas_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
trap 'rc=$?; [ $rc -ne 0 ] && printf "Berhenti di fase %s. Setelah switch saja: bash /tmp/hov.sh %s %s --rollback\n" "$PHASE" "$DEPLOY_SHA" "$BASE_SHA"; exit $rc' EXIT

# Gerbang data: statis (migrasi/skema/indeks/constraint/tabel HPP) identik persis; tabel operasional identik pada batas cutoff (baris baru sesudah cutoff = trafik sah).
GD_BERGERAK=( 'stock_movements|stock_movements|created_at' 'fin_journal_entries|fin_journal_entries|created_at' 'unit_usage_notes|unit_usage_notes|created_at' 'material_issues|material_issues|created_at'
  'order_biaya_tanpa_stok|order_biaya_tanpa_stok|diajukan_pada' 'unit_hpp_konfirmasi|unit_hpp_konfirmasi|dikonfirmasi_pada' )
GD_SQL_STATIS="select 'migrasi|' || count(*) filter (where finished_at is not null) || '|' || md5(coalesce(string_agg(migration_name || ':' || checksum || ':' || (finished_at is not null)::text, ',' order by migration_name), '')) from _prisma_migrations
union all select 'skema|' || md5(coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || udt_name || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema = 'public'
union all select 'indeks|' || md5(coalesce(string_agg(tablename || ':' || indexdef, ',' order by tablename, indexname), '')) from pg_indexes where schemaname = 'public'
union all select 'constraint|' || md5(coalesce(string_agg(conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname), '')) from pg_constraint where connamespace = 'public'::regnamespace"
gd_sql_bergerak() { local spec lab tbl col first=1; for spec in "${GD_BERGERAK[@]}"; do IFS='|' read -r lab tbl col <<< "$spec"; [ "$first" = 1 ] && first=0 || printf ' union all '; printf "select '%s|' || count(*) || '|' || coalesce(max(%s)::text, '-') from %s where %s <= '%s'::timestamp" "$lab" "$col" "$tbl" "$col" "$FP_CUTOFF"; done; }
gd_baseline() {
  FP_CUTOFF="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '120 seconds', 'YYYY-MM-DD HH24:MI:SS.US')")"; [[ "$FP_CUTOFF" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9:.]+$ ]] || die "cutoff tidak terbaca"
  FP_STATIS_0="$(psql_live -At -c "$GD_SQL_STATIS")" || die "baseline statis gagal"; FP_BERGERAK_0="$(psql_live -At -c "$(gd_sql_bergerak)")" || die "baseline bergerak gagal"
  { echo "cutoff(UTC)=${FP_CUTOFF}"; echo "$FP_STATIS_0"; echo "$FP_BERGERAK_0"; } > "$BK_DIR/gerbang-data-baseline.txt"; ok "baseline data dicatat (cutoff ${FP_CUTOFF} UTC)"
}
gd_verifikasi() {
  local s1 b1; s1="$(psql_live -At -c "$GD_SQL_STATIS")" || die "statis sesudah gagal"; b1="$(psql_live -At -c "$(gd_sql_bergerak)")" || die "bergerak sesudah gagal"
  { echo "$s1"; echo "$b1"; } > "$BK_DIR/gerbang-data-sesudah.txt"
  [ "$s1" = "$FP_STATIS_0" ] || { diff <(printf '%s\n' "$FP_STATIS_0") <(printf '%s\n' "$s1") | head -6; die "DATA STATIS BERUBAH selama rilis"; }
  [ "$b1" = "$FP_BERGERAK_0" ] || { diff <(printf '%s\n' "$FP_BERGERAK_0") <(printf '%s\n' "$b1") | head -8; die "baris <= cutoff pada tabel operasional BERUBAH"; }
  ok "data statis identik; tabel operasional (termasuk biaya tanpa stok & konfirmasi HPP) identik pada cutoff ${FP_CUTOFF} UTC"
}

PHASE=0; say "0. Kunci dan konkurensi"
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain berjalan (${lf})"; done
exec 9>/tmp/release-hpp-verifikasi.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate deploy' | grep -v 'hov\.sh\|pgrep\|node src/index.js' | grep -v "$$" || true)"; [ -z "$OTHER" ] || die "ada proses deploy/build/migrasi lain"
mkdir -p "$BK_DIR" "$HOME/release-src"; exec > >(tee -a "$BK_DIR/release.log") 2>&1
ok "tidak ada deploy lain"

PHASE=1; say "1. Release aktif"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = 1 ] || die "harus tepat satu backend"
PG="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=postgres")"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"; PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"; ENV_SHA="$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)"
ok "aktif ${PREV_DIR} marker ${PREV_COMMIT} image ${PREV_IMG_ID:7:12} env ${ENV_SHA}"
if [ "$MODE" = rollback ]; then
  PHASE=rollback; [ "$(basename "$PREV_DIR")" = "$DEPLOY_SHORT" ] || die "release aktif bukan ${DEPLOY_SHORT}; rollback ditolak agar tidak menimpa rilis lain"
  T="$RELEASES/${BASE_SHA:0:8}"; [ -d "$T" ] || die "folder baseline tidak ada"; TAG="${IMG_NAME%%:*}:rollback-pre-hov-${DEPLOY_SHORT}"; docker image inspect "$TAG" >/dev/null 2>&1 || die "tag rollback tidak ada"
  docker tag "$TAG" "$IMG_NAME"; dcp "$T" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "recreate gagal"
  for i in $(seq 1 45); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && break; sleep 2; done; curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "tidak sehat setelah rollback"
  ok "rollback selesai"; trap - EXIT; exit 0
fi

PHASE=2; say "2. Sumber, batas perubahan, pin isi"
[ -d "$SRC" ] || die "repo sumber tidak ada"
sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch gagal"
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat bergeser"
[ "$(sg rev-parse --short=8 "$BASE_SHA")" = "$PREV_COMMIT" ] || die "baseline ${BASE_SHA:0:8} BUKAN release aktif ${PREV_COMMIT}: rebase kandidat di atas live"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline bukan leluhur kandidat"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"; [ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/   /'; die "berkas di luar allowlist"; }
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)(docker-compose[^/]*|Dockerfile)$|package(-lock)?\.json$|\.env|^frontend/dist|^backend/prisma/' || die "Docker/package/env/prisma berubah (rilis ini tanpa migrasi)"
[ "$(sg -c core.quotepath=false diff --no-renames --no-color --no-ext-diff --binary --full-index "$BASE_SHA" "$DEPLOY_SHA" -- backend frontend | sha256sum | cut -d' ' -f1)" = "$DIFF_SHA" ] || die "isi diff backend+frontend berbeda dari yang diaudit"
ok "$(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist; tanpa migrasi; isi diff sesuai pin"

PHASE=3; say "3. Audit produksi (isi kode, bukan marker)"
curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "health internal"; curl -fsS -m15 "${PUBLIC_URL}/api/health" | grep -q '"ok":true' || die "health publik"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = 0 ] || die "migrasi menggantung"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='20261231170000_hpp_order_biaya_tanpa_stok' and finished_at is not null")" = 1 ] || die "migrasi HPP belum ada di produksi"
sg -c core.quotepath=false ls-tree -r "$BASE_SHA" | awk -F'\t' '$1 ~ /^100[0-9]+ blob/ && $2 !~ /^frontend\/dist\// { split($1,a," "); print a[3] "\t" $2 }' > "$BK_DIR/base.tsv"
cut -f2 "$BK_DIR/base.tsv" | sed "s#^#${PREV_DIR}/#" | git hash-object --no-filters --stdin-paths > "$BK_DIR/live.txt" || die "berkas baseline hilang di release aktif"
BEDA="$(paste "$BK_DIR/base.tsv" "$BK_DIR/live.txt" | awk -F'\t' '$1 != $3' | wc -l)"; [ "$BEDA" = 0 ] || die "kode live menyimpang dari baseline: ${BEDA} berkas"
ok "kode live == baseline ($(wc -l < "$BK_DIR/base.tsv") berkas)"
FREE="$(bebas_kb)"
if [ "$MODE" = preflight ]; then [ "$FREE" -ge "$MIN_FREE_KB" ] && ok "disk bebas $((FREE/1024)) MiB (rilis butuh >= 8 GiB)" || warn "disk bebas $((FREE/1024)) MiB < 8 GiB: rilis akan berhenti"; say "Preflight selesai: produksi TIDAK diubah"; trap - EXIT; exit 0; fi
[ "$FREE" -ge "$MIN_FREE_KB" ] || die "butuh >= 8 GiB bebas"; [ ! -e "$NEW_DIR" ] || die "release dir sudah ada"

PHASE=4; say "4. Backup, release dir, build"
BACKUP_FILE="$HOME/backups/pre-hpp-verifikasi-${DEPLOY_SHORT}-${TS}.sql.gz"
docker exec "$PG" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "${BACKUP_FILE}.partial"; gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || die "dump tidak lengkap"; mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"; sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"; ok "backup ${BACKUP_FILE}"
mkdir "$NEW_DIR"; sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist'; printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; FE_NM=""; for d in "$PREV_DIR" $(ls -dt "$(dirname "$PREV_DIR")"/*/); do d="${d%/}"; if [ -d "$d/frontend/node_modules" ] && cmp -s "$d/frontend/package-lock.json" "$NEW_DIR/frontend/package-lock.json"; then FE_NM="$d/frontend/node_modules"; break; fi; done
if [ -n "$FE_NM" ]; then cp -a "$FE_NM" "$NEW_DIR/frontend/node_modules" || die "salin node_modules frontend gagal"; else ( cd "$NEW_DIR/frontend" && npm install --no-audit --no-fund ) > "$BK_DIR/npm-frontend.log" 2>&1 </dev/null || die "npm install frontend gagal"; fi
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env"; ( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/web.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 20 "$BK_DIR/web.log"; die "build web gagal"; }; rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"; [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "dist tidak valid"
grep -rlF "Verifikasi biaya" "$NEW_DIR/frontend/dist/assets" --include='*.js' | grep -q . || die "dist baru tanpa tab Verifikasi biaya"
n=0; for f in "$PREV_DIR"/frontend/dist/assets/*; do b="${f##*/}"; [ -e "$NEW_DIR/frontend/dist/assets/$b" ] || { cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b"; n=$((n+1)); }; done; ok "web ${NEW_INDEX}; ${n} aset lama dibawa"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-hov-${DEPLOY_SHORT}"; docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { docker tag "$PREV_IMG_ID" "$IMG_NAME"; tail -n 20 "$BK_DIR/build.log"; die "build image gagal"; }
ok "image baru dibangun; rollback ${ROLLBACK_TAG}"

PHASE=5; say "5. Switch satu kali (tanpa migrasi)"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container berubah sebelum switch"
gd_baseline
T_SWITCH="$(date -u +%FT%TZ)"; dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "up gagal"
UP=0; for i in $(seq 1 60); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = 1 ] || die "backend baru tidak sehat"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s\n' "$CID_NEW" | grep -c .)" = 1 ] || die "harus tepat satu backend setelah switch"
ok "switch ${T_SWITCH}"

PHASE=6; say "6. Verifikasi dan smoke (baca-saja)"
[ "$(curl -fsS -m15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik bukan dist baru"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah"
gd_verifikasi
for ep in /api/finance/hpp-order/meta /api/finance/hpp-order/antrean /api/finance/hpp-order/laporan; do [ "$(curl -s -o /dev/null -w '%{http_code}' -m15 "${PUBLIC_URL}${ep}")" = 401 ] || die "${ep} tanpa token harus 401"; done
sleep 15; [ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = 0 ] || die "backend restart sendiri"
ok "smoke lulus; tidak ada data yang diisi"
trap - EXIT; say "SELESAI ${DEPLOY_SHORT}. Rollback: bash /tmp/hov.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback"
