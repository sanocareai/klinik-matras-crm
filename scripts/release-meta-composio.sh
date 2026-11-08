#!/usr/bin/env bash
# RILIS "Sinkronisasi Meta lewat Composio": backend + panel status web + 1 migrasi ADITIF. FLAG TETAP OFF: tidak memasang secret, cron, atau impor data. Tidak ada panggilan ke Composio/Meta.
# Dibangkitkan oleh scripts/gen-release-meta-composio.cjs; JANGAN edit manual. Membawa gerbang data perbaikan 02cfa39d (statis identik; tabel operasional dibatasi cutoff).
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/mcs.bundle bash /tmp/mcs.sh <DEPLOY_SHA> <BASE_SHA> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/mcs.bundle bash /tmp/mcs.sh <DEPLOY_SHA> <BASE_SHA> --rehearsal-only'   # + backup, release dir, build image+web, migrasi pada DB salinan; TANPA migrasi produksi/switch
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/mcs.bundle bash /tmp/mcs.sh <DEPLOY_SHA> <BASE_SHA>'                    # rilis penuh (hanya setelah persetujuan)
#   ssh ubuntu@43.133.152.6 'bash /tmp/mcs.sh <DEPLOY_SHA> <BASE_SHA> --rollback'                                # kembali ke folder+image baseline; migrasi aditif dibiarkan (kode lama mengabaikannya)
set -Eeuo pipefail
umask 077
DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ && "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen harus DEPLOY_SHA BASE_SHA 40 karakter" >&2; exit 1; }
MODE=release; for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --rehearsal-only) MODE=rehearsal;; --rollback) MODE=rollback;; esac; done
BUNDLE="${BUNDLE:-}"; CAND_BRANCH="${CAND_BRANCH:-feat/meta-composio-sync}"; CAND_REF="refs/remotes/origin/cand-mcs"
ALLOWED_RE='^(backend/prisma/migrations/20261231130000_meta_composio_sync/migration\.sql|backend/prisma/schema\.prisma|backend/scripts/rehearsal-composio-replay\.mjs|backend/scripts/sync-meta-composio\.js|backend/src/routes/attributionSpend\.js|backend/src/services/attribution/adReferensi\.js|backend/src/services/attribution/biayaKpi\.js|backend/src/services/attribution/biayaSumber\.js|backend/src/services/attribution/composioMeta\.js|backend/src/services/attribution/composioMetaSync\.js|backend/src/services/attribution/laporanMeta\.js|backend/src/services/attribution/spend\.js|backend/tests/atribusiSumberKontrak\.test\.js|backend/tests/composioMeta\.test\.js|backend/tests/integration/composioMetaSync\.integration\.test\.js|backend/tests/integration/composioNolDanHook\.integration\.test\.js|docs/META-COMPOSIO-SYNC\.md|frontend/qa-harness/panel-sinkron-main\.jsx|frontend/qa-harness/panel-sinkron-qa\.cjs|frontend/qa-harness/panel-sinkron\.html|frontend/src/api\.js|frontend/src/features/laporan/components/marketing/KesehatanReferensi\.jsx|frontend/src/features/laporan/components/marketing/StatusSinkronMeta\.jsx|frontend/src/features/laporan/sinkronMetaLogic\.js|frontend/tests/sinkronMetaLogic\.test\.js|scripts/gen-release-meta-composio\.cjs|scripts/meta-composio-sync-cron\.sh|scripts/release-meta-composio\.sh|scripts/templates/release-meta-composio/gerbang-data\.txt|scripts/templates/release-meta-composio/rilis\.txt)$'
MIG_NAME='20261231130000_meta_composio_sync'; MIG_SHA='28596585346ebb477e3df9589d2127c9b51c13bf867c5b8e9286cf02144c8c8a'; DIFF_SHA='fe017d1fc0d3f4234ec5105d4f7e44e91f4acd2b48efcb5a120547e135847162'
PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"; PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MIN_FREE_KB=$((5 * 1024 * 1024)); TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/meta-composio-${DEPLOY_SHORT}-${TS}"
PHASE=init; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; ROLLBACK_TAG=""; REH_DB=""
say() { printf '\n== %s\n' "$*"; }; ok() { printf '  OK    %s\n' "$*"; }; warn() { printf '  PERHATIAN %s\n' "$*"; }; die() { printf '\nSTOP [%s]: %s\n' "$PHASE" "$*" >&2; exit 1; }
sg() { git --git-dir="$SRC" "$@"; }
dcp() { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { docker exec -i "$PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
bebas_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
bersih() { if [ -n "$REH_DB" ]; then docker exec "$PG" psql -U "$DB_USER" -d postgres -qc "DROP DATABASE IF EXISTS ${REH_DB}" >/dev/null 2>&1 || true; fi; }
trap 'rc=$?; bersih; [ $rc -ne 0 ] && printf "Berhenti di fase %s. Setelah switch saja: bash /tmp/mcs.sh %s %s --rollback\n" "$PHASE" "$DEPLOY_SHA" "$BASE_SHA"; exit $rc' EXIT

# ── GERBANG DATA: pisahkan "data yang WAJIB identik" dari "tabel operasional yang bergerak" ──────────────────────────────────────────────────────────────
# Kejadian 30 Okt 2026: gerbang lama membandingkan jumlah baris SEMUA tabel (termasuk "Message") sebelum vs sesudah switch → trafik WhatsApp normal (+10 pesan dalam ±2 menit) memicu STOP palsu.
# Rilis ini frontend-saja dan tidak menulis data; gerbang harus menolak perubahan yang bukan trafik, tanpa toleransi jumlah baris sembarang.
#
# A. STATIS — harus IDENTIK persis (nilai + sidik jari isi), sebelum vs sesudah switch:
#    migrasi (jumlah selesai + md5 nama/checksum/status), skema (md5 kolom: tipe, null, default), indeks (md5 definisi), constraint (md5 definisi), konfigurasi attribution_kpi_targets (md5 isi baris).
# B. BERGERAK — tabel operasional yang ditulis pengguna/webhook: Message, stock_movements, material_issues, stock_transfers, warehouse_corrections, attribution_touches, ad_source_spend_entries, meta_ad_references.
#    Baseline DIBATASI CUTOFF: cutoff = jam DB saat baseline − 120 detik (UTC). Untuk tiap tabel dicatat (jumlah baris berstempel waktu <= cutoff, stempel waktu terbesar <= cutoff). Setelah switch nilai itu
#    dibaca ulang dengan cutoff YANG SAMA dan harus IDENTIK. Baris baru (stempel > cutoff) = trafik sah dan tidak menggagalkan gerbang.
#    BATAS BUKTI (dicatat di log): terdeteksi = baris berstempel <= cutoff yang hilang/dihapus atau baris bertanggal-mundur yang disisipkan setelah baseline. TIDAK terdeteksi = UPDATE di tempat pada baris lama,
#    dan penambahan baris berstempel > cutoff (tak dapat dibedakan dari trafik). Pesan terlambat >120 detik yang masuk bertanggal sebelum cutoff dapat memicu STOP (aman; periksa manual).
#    Asumsi: kolom waktu = timestamp tanpa zona dalam UTC (default Prisma); satu nama tabel/kolom per baris spesifikasi.
GD_BERGERAK=( 'Message|"Message"|"createdAt"' 'stock_movements|stock_movements|created_at' 'material_issues|material_issues|created_at' 'stock_transfers|stock_transfers|created_at'
  'warehouse_corrections|warehouse_corrections|requested_at' 'attribution_touches|attribution_touches|created_at' 'ad_source_spend_entries|ad_source_spend_entries|created_at' 'meta_ad_references|meta_ad_references|created_at' )
GD_SQL_STATIS="select 'migrasi|' || count(*) filter (where finished_at is not null) || '|' || md5(coalesce(string_agg(migration_name || ':' || checksum || ':' || (finished_at is not null)::text, ',' order by migration_name), '')) from _prisma_migrations
union all select 'skema|' || md5(coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || udt_name || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema = 'public'
union all select 'indeks|' || md5(coalesce(string_agg(tablename || ':' || indexdef, ',' order by tablename, indexname), '')) from pg_indexes where schemaname = 'public'
union all select 'constraint|' || md5(coalesce(string_agg(conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname), '')) from pg_constraint where connamespace = 'public'::regnamespace
union all select 'konfig attribution_kpi_targets|' || count(*) || '|' || md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from attribution_kpi_targets t"
gd_sql_bergerak() {
  local spec lab tbl col first=1
  for spec in "${GD_BERGERAK[@]}"; do
    IFS='|' read -r lab tbl col <<< "$spec"
    [ "$first" = 1 ] && first=0 || printf ' union all '
    printf "select '%s|' || count(*) || '|' || coalesce(max(%s)::text, '-') from %s where %s <= '%s'::timestamp" "$lab" "$col" "$tbl" "$col" "$FP_CUTOFF"
  done
}
gd_baseline() {   # fase 3 (sebelum switch): ambil cutoff dari jam DB, lalu baseline statis + bergerak
  FP_CUTOFF="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '120 seconds', 'YYYY-MM-DD HH24:MI:SS.US')")"
  [[ "$FP_CUTOFF" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9:.]+$ ]] || die "cutoff baseline tidak terbaca: ${FP_CUTOFF}"
  FP_STATIS_0="$(psql_live -At -c "$GD_SQL_STATIS")" || die "baseline data statis gagal dibaca"
  FP_BERGERAK_0="$(psql_live -At -c "$(gd_sql_bergerak)")" || die "baseline tabel bergerak gagal dibaca"
  [ "$(printf '%s\n' "$FP_STATIS_0" | grep -c .)" = 5 ] && [ "$(printf '%s\n' "$FP_BERGERAK_0" | grep -c .)" = "${#GD_BERGERAK[@]}" ] || die "sidik jari baseline tidak lengkap"
  mkdir -p "$BK_DIR"; { echo "cutoff(UTC)=${FP_CUTOFF}"; echo "--statis"; echo "$FP_STATIS_0"; echo "--bergerak (<= cutoff)"; echo "$FP_BERGERAK_0"; } > "$BK_DIR/gerbang-data-baseline.txt"
  ok "baseline data: statis (migrasi|skema|indeks|constraint|konfigurasi) dicatat; ${#GD_BERGERAK[@]} tabel bergerak dibatasi cutoff ${FP_CUTOFF} UTC; migrasi selesai = $(printf '%s\n' "$FP_STATIS_0" | sed -n 's/^migrasi|\([0-9]*\)|.*/\1/p')"
}
gd_verifikasi() {  # fase 6 (sesudah switch): statis identik persis; bergerak identik pada batas cutoff yang sama
  local s1 b1 d
  s1="$(psql_live -At -c "$GD_SQL_STATIS")" || die "data statis sesudah switch gagal dibaca"
  b1="$(psql_live -At -c "$(gd_sql_bergerak)")" || die "tabel bergerak sesudah switch gagal dibaca"
  { echo "--statis sesudah"; echo "$s1"; echo "--bergerak sesudah (<= cutoff ${FP_CUTOFF})"; echo "$b1"; } > "$BK_DIR/gerbang-data-sesudah.txt"
  if [ "$s1" != "$FP_STATIS_0" ]; then d="$(diff <(printf '%s\n' "$FP_STATIS_0") <(printf '%s\n' "$s1") | grep '^[<>]' | cut -c1-160 | head -6 | sed 's/^/        /' || true)"; printf '%s\n' "$d"; die "DATA STATIS BERUBAH selama rilis (migrasi/skema/indeks/constraint/konfigurasi harus identik persis)"; fi
  if [ "$b1" != "$FP_BERGERAK_0" ]; then d="$(diff <(printf '%s\n' "$FP_BERGERAK_0") <(printf '%s\n' "$b1") | grep '^[<>]' | cut -c1-160 | head -8 | sed 's/^/        /' || true)"; printf '%s\n' "$d"; die "baris berstempel <= cutoff ${FP_CUTOFF} pada tabel operasional BERUBAH (hilang/dihapus/disisipkan bertanggal-mundur) — bukan trafik baru"; fi
  ok "data statis identik persis; ${#GD_BERGERAK[@]} tabel operasional identik pada batas cutoff ${FP_CUTOFF} UTC (baris baru setelah cutoff = trafik sah, tidak diperiksa). BATAS BUKTI: tidak mendeteksi UPDATE di tempat pada baris lama maupun penambahan baris bertanggal > cutoff (lihat ${BK_DIR}/gerbang-data-*.txt)"
}

PHASE=0; say "0. Kunci dan konkurensi"
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain berjalan (${lf})"; done
exec 9>/tmp/release-meta-composio.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate deploy' | grep -v 'mcs\.sh\|pgrep\|node src/index.js' | grep -v "$$" || true)"; [ -z "$OTHER" ] || die "ada proses deploy/build/migrasi lain"
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
  T="$RELEASES/${BASE_SHA:0:8}"; [ -d "$T" ] || die "folder baseline tidak ada"; TAG="${IMG_NAME%%:*}:rollback-pre-mcs-${DEPLOY_SHORT}"; docker image inspect "$TAG" >/dev/null 2>&1 || die "tag rollback tidak ada"
  docker tag "$TAG" "$IMG_NAME"; dcp "$T" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "recreate gagal"
  for i in $(seq 1 45); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && break; sleep 2; done; curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "tidak sehat setelah rollback"
  ok "rollback selesai; migrasi aditif dan histori tetap ada"; trap - EXIT; exit 0
fi

PHASE=2; say "2. Sumber, batas perubahan, pin migrasi"
[ -d "$SRC" ] || die "repo sumber tidak ada"
if [ -n "$BUNDLE" ]; then sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch bundle gagal"; else sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch gagal"; fi
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat bergeser"
[ "$(sg rev-parse --short=8 "$BASE_SHA")" = "$PREV_COMMIT" ] || die "baseline ${BASE_SHA:0:8} BUKAN release aktif ${PREV_COMMIT}: bangkitkan ulang di atas live"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline bukan leluhur kandidat"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"; [ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/   /'; die "berkas di luar allowlist"; }
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)(docker-compose[^/]*|Dockerfile)$|package(-lock)?\.json$|\.env|^frontend/dist' || die "Docker/package/env berubah"
[ "$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | sha256sum | cut -d' ' -f1)" = "$MIG_SHA" ] || die "sha migrasi berbeda dari yang diaudit"
[ "$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | wc -l)" = 1 ] || die "harus tepat satu berkas migrasi"
[ "$(sg -c core.quotepath=false diff --no-renames --no-color --no-ext-diff --binary --full-index "$BASE_SHA" "$DEPLOY_SHA" -- backend frontend | sha256sum | cut -d' ' -f1)" = "$DIFF_SHA" ] || die "isi diff backend+frontend berbeda dari yang diaudit"
ok "$(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist; migrasi dan isi diff sesuai pin"

PHASE=3; say "3. Audit produksi (isi kode, bukan marker)"
curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "health internal"; curl -fsS -m15 "${PUBLIC_URL}/api/health" | grep -q '"ok":true' || die "health publik"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = 0 ] || die "migrasi menggantung"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${MIG_NAME}'")" = 0 ] || die "migrasi sudah pernah diterapkan"
sg -c core.quotepath=false ls-tree -r "$BASE_SHA" | awk -F'\t' '$1 ~ /^100[0-9]+ blob/ && $2 !~ /^frontend\/dist\// { split($1,a," "); print a[3] "\t" $2 }' > "$BK_DIR/base.tsv"
cut -f2 "$BK_DIR/base.tsv" | sed "s#^#${PREV_DIR}/#" | git hash-object --no-filters --stdin-paths > "$BK_DIR/live.txt" || die "berkas baseline hilang di release aktif"
BEDA="$(paste "$BK_DIR/base.tsv" "$BK_DIR/live.txt" | awk -F'\t' '$1 != $3' | wc -l)"; [ "$BEDA" = 0 ] || die "kode live menyimpang dari baseline: ${BEDA} berkas"
ok "kode live == baseline ($(wc -l < "$BK_DIR/base.tsv") berkas)"
FREE="$(bebas_kb)"; if [ "$MODE" = preflight ]; then [ "$FREE" -ge "$MIN_FREE_KB" ] && ok "disk bebas $((FREE/1024)) MiB" || warn "disk bebas $((FREE/1024)) MiB < 5 GiB; build akan berhenti"; say "Preflight selesai: produksi TIDAK diubah"; trap - EXIT; exit 0; fi
[ "$FREE" -ge $((MIN_FREE_KB + 3 * 1024 * 1024)) ] || die "butuh >= 8 GiB bebas untuk image+web+backup"
[ ! -e "$NEW_DIR" ] || die "release dir sudah ada"

PHASE=4; say "4. Backup, release dir, build"
BACKUP_FILE="$HOME/backups/pre-meta-composio-${DEPLOY_SHORT}-${TS}.sql.gz"
docker exec "$PG" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "${BACKUP_FILE}.partial"; gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || die "dump tidak lengkap"; mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"; sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"; ok "backup ${BACKUP_FILE}"
mkdir "$NEW_DIR"; sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist'; printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; cp -a "$PREV_DIR/frontend/node_modules" "$NEW_DIR/frontend/node_modules" || die "node_modules frontend live tidak ada"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env"; ( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/web.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 20 "$BK_DIR/web.log"; die "build web gagal"; }; rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"; [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "dist tidak valid"
grep -rlF "Sinkronisasi spend Meta" "$NEW_DIR/frontend/dist/assets" --include='*.js' | grep -q . || die "dist baru tanpa panel status"
n=0; for f in "$PREV_DIR"/frontend/dist/assets/*; do b="${f##*/}"; [ -e "$NEW_DIR/frontend/dist/assets/$b" ] || { cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b"; n=$((n+1)); }; done; ok "web ${NEW_INDEX}; ${n} aset lama dibawa"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-mcs-${DEPLOY_SHORT}"; docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { docker tag "$PREV_IMG_ID" "$IMG_NAME"; tail -n 20 "$BK_DIR/build.log"; die "build image gagal"; }
ok "image baru dibangun; rollback ${ROLLBACK_TAG}"

PHASE=4r; say "4r. Rehearsal migrasi pada salinan backup"
REH_DB="rehearsal_mcs_${DEPLOY_SHORT}"; docker exec "$PG" psql -U "$DB_USER" -d postgres -qc "DROP DATABASE IF EXISTS ${REH_DB}" -c "CREATE DATABASE ${REH_DB}"
gzip -dc "$BACKUP_FILE" | docker exec -i "$PG" psql -U "$DB_USER" -d "$REH_DB" -q > "$BK_DIR/restore.log" 2>&1 || true
dcp "$NEW_DIR" run --rm --no-deps -T --entrypoint sh -e "RDB=${REH_DB}" backend -c 'DATABASE_URL="$(printf %s "$DATABASE_URL" | sed "s#/[^/?]*\(?.*\)\?\$#/$RDB\1#")" npx prisma migrate deploy' </dev/null > "$BK_DIR/migrate-reh.log" 2>&1 || { tail -n 15 "$BK_DIR/migrate-reh.log"; die "migrasi rehearsal gagal"; }
[ "$(grep -c 'Applying migration' "$BK_DIR/migrate-reh.log")" = 1 ] || die "rehearsal harus menerapkan tepat 1 migrasi"
RC="$(docker exec "$PG" psql -U "$DB_USER" -d "$REH_DB" -At -c "select (select count(*) from meta_ad_daily_spend), (select count(*) from meta_sync_runs)")"; ok "rehearsal lulus; spend|run di salinan = ${RC}"
bersih; REH_DB=""
if [ "$MODE" = rehearsal ]; then
  docker tag "$PREV_IMG_ID" "$IMG_NAME"
  [ "$NEW_DIR" = "$RELEASES/$DEPLOY_SHORT" ] && [ "$NEW_DIR" != "$PREV_DIR" ] && rm -rf -- "$NEW_DIR"
  say "Rehearsal selesai: produksi TIDAK dimigrasi dan TIDAK di-switch; image latest dikembalikan"; trap - EXIT; exit 0
fi

PHASE=5; say "5. Migrasi aditif lalu switch satu kali"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container berubah sebelum switch"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate.log" 2>&1 || { tail -n 15 "$BK_DIR/migrate.log"; die "migrasi produksi gagal"; }
gd_baseline
T_SWITCH="$(date -u +%FT%TZ)"; dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "up gagal"
UP=0; for i in $(seq 1 60); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = 1 ] || die "backend baru tidak sehat"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
ok "switch ${T_SWITCH}; image $(docker inspect -f '{{.Image}}' "$CID_NEW" | cut -c8-19)"

PHASE=6; say "6. Verifikasi dan smoke (baca-saja)"
[ "$(curl -fsS -m15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik bukan dist baru"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah"
gd_verifikasi
for ep in /api/atribusi/iklan/sync-meta/status /api/atribusi/iklan/spend /api/atribusi/iklan /api/atribusi/iklan/kesehatan /api/analytics/traffic; do [ "$(curl -s -o /dev/null -w '%{http_code}' -m15 "${PUBLIC_URL}${ep}")" = 401 ] || die "${ep} tanpa token harus 401"; done
docker exec "$CID_NEW" node scripts/sync-meta-composio.js --cek | grep -q '"status":"TIDAK_SIAP"' || warn "--cek bukan TIDAK_SIAP: secret/flag sudah terpasang"
[ "$(psql_live -At -c "select count(*) from meta_sync_runs where mode='commit'")" = 0 ] || warn "sudah ada run commit"
sleep 15; [ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = 0 ] || die "backend restart sendiri"
ok "smoke lulus; flag OFF, tanpa secret, tanpa impor"
trap - EXIT; say "SELESAI ${DEPLOY_SHORT}. BUKAN AUTO SYNC: secret, backfill, dan cron masih terpisah. Rollback: bash /tmp/mcs.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback"
