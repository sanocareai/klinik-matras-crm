#!/usr/bin/env bash
# RILIS "Backend aplikasi Android SANSS Produksi (tahap 1-7, Nov 2026)": BACKEND-SAJA + 1 migrasi ADITIF
# (kolom mobile_device_tokens.app DEFAULT 'finance' + 1 indeks). Web TIDAK berubah (dist release aktif disalin apa adanya).
# Isi: login/refresh mobile menerima app="production" (gerbang capabilities.productionApp), token Produksi dibatasi ke
# jalur Produksi (middleware/auth.js), pengirim push Finance hanya ke app='finance', pemicu push Produksi di tahap/QC/urutan/komplain
# — semuanya MATI kecuali PRODUCTION_PUSH_ENABLED=true (skrip ini MENOLAK bila sakelar itu sudah hidup).
# Perilaku SANO Finance tidak berubah: login tanpa `app` = Finance seperti sebelumnya.
# Pola sama dengan release-pengajuan-pemakaian.sh (allowlist + pin migrasi + pin isi diff + audit kode live + backup + rehearsal di salinan + switch satu kali).
#   ssh ubuntu@43.133.152.6 'bash /tmp/rpm.sh <DEPLOY_SHA> <BASE_SHA> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'bash /tmp/rpm.sh <DEPLOY_SHA> <BASE_SHA> --rehearsal-only'   # + backup segar, restore ke DB salinan, migrasi + uji baca kode baru pada salinan; TANPA build/migrasi produksi/switch
#   ssh ubuntu@43.133.152.6 'bash /tmp/rpm.sh <DEPLOY_SHA> <BASE_SHA>'                    # rilis penuh (HANYA setelah persetujuan deploy)
#   ssh ubuntu@43.133.152.6 'bash /tmp/rpm.sh <DEPLOY_SHA> <BASE_SHA> --rollback'         # kembali ke folder+image baseline; kolom aditif dibiarkan (kode lama tidak membacanya)
# Rollback aman: kode lama tidak mengenal kolom `app` (DEFAULT 'finance' tetap terisi untuk token baru dari kode lama). Token
# akses Produksi yang sudah terbit tetap valid di kode lama (klaim `app` diabaikan) tetapi hanya untuk izin akun itu sendiri.
set -Eeuo pipefail
umask 077
DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ && "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen harus DEPLOY_SHA BASE_SHA 40 karakter" >&2; exit 1; }
MODE=release; for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --rehearsal-only) MODE=rehearsal;; --rollback) MODE=rollback;; esac; done
BUNDLE="${BUNDLE:-}"; CAND_BRANCH="${CAND_BRANCH:-feat/production-mobile-on-fba65a14}"; CAND_REF="refs/remotes/origin/cand-rpm"
# production-mobile/** tidak ikut ke server (aplikasi Android dibangun terpisah lewat EAS); diizinkan agar diff branch lolos.
ALLOWED_RE='^(backend/prisma/migrations/20261231200000_mobile_device_tokens_app/migration\.sql|backend/prisma/schema\.prisma|backend/src/middleware/auth\.js|backend/src/routes/mobileAuth\.js|backend/src/routes/productionExperience\.js|backend/src/routes/productionPlanning\.js|backend/src/services/capabilities\.js|backend/src/services/complaintCase\.js|backend/src/services/financeNotifications\.js|backend/src/services/mobileSession\.js|backend/src/services/productionNotifications\.js|backend/tests/capabilitiesProductionApp\.test\.js|backend/tests/integration/mobileAuth\.integration\.test\.js|backend/tests/productionNotifications\.test\.js|production-mobile/.+|scripts/release-produksi-mobile\.sh)$'
MIG_NAME='20261231200000_mobile_device_tokens_app'; MIG_SHA='3d4dae845dd254f4767f6e90fbfcd5eaf58a81f71511aabdde510282ace28dbe'; DIFF_SHA='c0a00b5699bf8d421d81a021a80651a9383194048ebdb7be2efda102404c7361'
MIG_DASAR='20261231190400_add_hub_member_role'
PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"; PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MIN_FREE_KB=$((4 * 1024 * 1024)); REH_FREE_KB=$((3 * 1024 * 1024)); TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/produksi-mobile-${DEPLOY_SHORT}-${TS}"
PHASE=init; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; ROLLBACK_TAG=""; REH_DB=""; REH_SRC=""; PREV_INDEX=""
say() { printf '\n== %s\n' "$*"; }; ok() { printf '  OK    %s\n' "$*"; }; warn() { printf '  PERHATIAN %s\n' "$*"; }; die() { printf '\nSTOP [%s]: %s\n' "$PHASE" "$*" >&2; exit 1; }
sg() { git --git-dir="$SRC" "$@"; }
dcp() { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { docker exec -i "$PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
bebas_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
SKEMA_MD5_KOSONG="d41d8cd98f00b204e9800998ecf8427e"; SKEMA_MIN_BARIS="${SKEMA_MIN_BARIS:-50}"
# Baris CHECK dan baris INDEKS PARSIAL (CREATE ... INDEX ... WHERE): pg_dump merender ulang cast/kurung daftar IN sesudah restore — makna sama.
skema_norm() {
  tr -d '\r' | sed -E '/^--/d; /^[[:space:]]*$/d; /^.?(un)?restrict [A-Za-z0-9]+$/d; s/,$//' | sed -E '/CHECK|^CREATE (UNIQUE )?INDEX .* WHERE /{
    s/::character varying(\([0-9]+\))?(\[\])?//g
    s/::text(\[\])?//g
    :a
    s/(^|[^A-Za-z0-9_])\(([^() ,]+)\)/\1\2/g
    ta
    :b
    s/(^|[^A-Za-z0-9_])\((ARRAY\[[^]]*\])\)/\1\2/g
    tb
  }'
}
skema_valid() { [ -s "$1" ] && [ "$(md5sum <"$1" | cut -d' ' -f1)" != "$SKEMA_MD5_KOSONG" ] && [ "$(wc -l <"$1")" -ge "$SKEMA_MIN_BARIS" ] && grep -q 'CREATE TABLE' "$1"; }
skema_banding() {
  local T ha hb; T="$(mktemp -d)"; skema_norm <"$1" >"$T/a"; skema_norm <"$2" >"$T/b"
  if ! skema_valid "$T/a" || ! skema_valid "$T/b"; then echo "SKEMA_GAGAL: dump kosong atau terlalu pendek"; rm -rf "$T"; return 1; fi
  ha="$(md5sum <"$T/a" | cut -d' ' -f1)"; hb="$(md5sum <"$T/b" | cut -d' ' -f1)"
  if [ "$ha" != "$hb" ]; then echo "SKEMA_GAGAL: hash berbeda ${ha:0:16} vs ${hb:0:16}"; diff "$T/a" "$T/b" | head -n 6 | cut -c1-140; rm -rf "$T"; return 1; fi
  echo "SKEMA_COCOK ${ha:0:16} baris=$(wc -l <"$T/a")"; rm -rf "$T"
}
# Migrasi ini HANYA: 1 kolom baru pada tabel lama + 1 indeks. Sesudah = sebelum + PERSIS dua baris itu (tidak ada tabel/fungsi/trigger/constraint baru).
skema_tambahan() {
  local T; T="$(mktemp -d)"; skema_norm <"$1" >"$T/a"; skema_norm <"$2" >"$T/b"
  if ! skema_valid "$T/a" || ! skema_valid "$T/b"; then echo "SKEMA_GAGAL: dump kosong atau terlalu pendek"; rm -rf "$T"; return 1; fi
  diff "$T/a" "$T/b" >"$T/d" || true
  if grep -q '^<' "$T/d"; then echo "SKEMA_GAGAL: skema lama berubah"; grep '^<' "$T/d" | head -n 5 | cut -c1-140; rm -rf "$T"; return 1; fi
  sed -n 's/^> //p' "$T/d" >"$T/add"
  if [ "$(wc -l <"$T/add")" != 2 ]; then echo "SKEMA_GAGAL: tambahan harus tepat 2 baris (kolom + indeks), dapat $(wc -l <"$T/add")"; head -n 5 "$T/add" | cut -c1-140; rm -rf "$T"; return 1; fi
  grep -qE "^[[:space:]]+app text DEFAULT 'finance'::text NOT NULL$" "$T/add" || { echo "SKEMA_GAGAL: kolom app tidak sesuai migrasi"; cat "$T/add"; rm -rf "$T"; return 1; }
  grep -qE '^CREATE INDEX mobile_device_tokens_app_user_id_idx ON public\.mobile_device_tokens USING btree \(app, user_id\);$' "$T/add" || { echo "SKEMA_GAGAL: indeks tidak sesuai migrasi"; cat "$T/add"; rm -rf "$T"; return 1; }
  echo "SKEMA_TAMBAHAN_SESUAI kolom=mobile_device_tokens.app indeks=mobile_device_tokens_app_user_id_idx"; rm -rf "$T"
}
bersih() {
  if [ -n "$REH_DB" ]; then docker exec "$PG" psql -U "$DB_USER" -d postgres -qc "DROP DATABASE IF EXISTS ${REH_DB}" >/dev/null 2>&1 || true; fi
  if [ -n "$REH_SRC" ] && [[ "$REH_SRC" == "$BK_DIR"/* ]]; then rm -rf -- "$REH_SRC"; fi
}
trap 'rc=$?; bersih; [ $rc -ne 0 ] && printf "Berhenti di fase %s. Setelah switch saja: bash /tmp/rpm.sh %s %s --rollback\n" "$PHASE" "$DEPLOY_SHA" "$BASE_SHA"; exit $rc' EXIT

# Gerbang data rilis (fase 5/6): skema/migrasi identik sesudah migrasi; tabel operasional identik pada batas cutoff.
# mobile_device_tokens SENGAJA tidak di gerbang ini: aplikasi Finance boleh mendaftarkan perangkat selama rilis (dicek terpisah: app<>'finance' = 0).
GD_BERGERAK=( 'Message|"Message"|"createdAt"' 'Order|"Order"|"createdAt"' 'unit_stage_logs|unit_stage_logs|created_at' 'stock_movements|stock_movements|created_at'
  'fin_journal_entries|fin_journal_entries|created_at' 'mobile_sessions|mobile_sessions|created_at' )
GD_SQL_STATIS="select 'migrasi|' || count(*) filter (where finished_at is not null) || '|' || md5(coalesce(string_agg(migration_name || ':' || checksum || ':' || (finished_at is not null)::text, ',' order by migration_name), '')) from _prisma_migrations
union all select 'skema|' || md5(coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || udt_name || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema = 'public'
union all select 'indeks|' || md5(coalesce(string_agg(tablename || ':' || indexdef, ',' order by tablename, indexname), '')) from pg_indexes where schemaname = 'public'
union all select 'constraint|' || md5(coalesce(string_agg(conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname), '')) from pg_constraint where connamespace = 'public'::regnamespace"
gd_sql_bergerak() {
  local spec lab tbl col first=1
  for spec in "${GD_BERGERAK[@]}"; do
    IFS='|' read -r lab tbl col <<< "$spec"
    [ "$first" = 1 ] && first=0 || printf ' union all '
    printf "select '%s|' || count(*) || '|' || coalesce(max(%s)::text, '-') from %s where %s <= '%s'::timestamp" "$lab" "$col" "$tbl" "$col" "$FP_CUTOFF"
  done
}
gd_baseline() {
  FP_CUTOFF="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '120 seconds', 'YYYY-MM-DD HH24:MI:SS.US')")"
  [[ "$FP_CUTOFF" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9:.]+$ ]] || die "cutoff baseline tidak terbaca: ${FP_CUTOFF}"
  FP_STATIS_0="$(psql_live -At -c "$GD_SQL_STATIS")" || die "baseline data statis gagal dibaca"
  FP_BERGERAK_0="$(psql_live -At -c "$(gd_sql_bergerak)")" || die "baseline tabel bergerak gagal dibaca"
  { echo "cutoff(UTC)=${FP_CUTOFF}"; echo "--statis"; echo "$FP_STATIS_0"; echo "--bergerak (<= cutoff)"; echo "$FP_BERGERAK_0"; } > "$BK_DIR/gerbang-data-baseline.txt"
  ok "baseline data dicatat (cutoff ${FP_CUTOFF} UTC)"
}
gd_verifikasi() {
  local s1 b1
  s1="$(psql_live -At -c "$GD_SQL_STATIS")" || die "data statis sesudah switch gagal dibaca"; b1="$(psql_live -At -c "$(gd_sql_bergerak)")" || die "tabel bergerak sesudah switch gagal dibaca"
  { echo "--statis sesudah"; echo "$s1"; echo "--bergerak sesudah"; echo "$b1"; } > "$BK_DIR/gerbang-data-sesudah.txt"
  [ "$s1" = "$FP_STATIS_0" ] || { diff <(printf '%s\n' "$FP_STATIS_0") <(printf '%s\n' "$s1") | head -6; die "SKEMA/MIGRASI BERUBAH selama rilis"; }
  [ "$b1" = "$FP_BERGERAK_0" ] || { diff <(printf '%s\n' "$FP_BERGERAK_0") <(printf '%s\n' "$b1") | head -8; die "baris <= cutoff pada tabel operasional BERUBAH"; }
  ok "skema identik; tabel operasional identik pada cutoff ${FP_CUTOFF} UTC"
}

PHASE=0; say "0. Kunci dan konkurensi"
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain berjalan (${lf})"; done
exec 9>/tmp/release-produksi-mobile.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate deploy' | grep -v 'rpm\.sh\|pgrep\|node src/index.js' | grep -v "$$" || true)"; [ -z "$OTHER" ] || die "ada proses deploy/build/migrasi lain"
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
  T="$RELEASES/${BASE_SHA:0:8}"; [ -d "$T" ] || die "folder baseline tidak ada"; TAG="${IMG_NAME%%:*}:rollback-pre-rpm-${DEPLOY_SHORT}"; docker image inspect "$TAG" >/dev/null 2>&1 || die "tag rollback tidak ada"
  docker tag "$TAG" "$IMG_NAME"; dcp "$T" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "recreate gagal"
  for i in $(seq 1 45); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && break; sleep 2; done; curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "tidak sehat setelah rollback"
  ok "rollback selesai; kolom mobile_device_tokens.app tetap ada (kode lama tidak membacanya). Aplikasi Produksi tidak bisa login sampai dirilis ulang."; trap - EXIT; exit 0
fi

PHASE=2; say "2. Sumber, batas perubahan, pin migrasi"
[ -d "$SRC" ] || die "repo sumber tidak ada"
if [ -n "$BUNDLE" ]; then sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch bundle gagal"; else sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch gagal"; fi
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat bergeser"
[ "$(sg rev-parse --short=8 "$BASE_SHA")" = "$PREV_COMMIT" ] || die "baseline ${BASE_SHA:0:8} BUKAN release aktif ${PREV_COMMIT}: rebase kandidat di atas live"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline bukan leluhur kandidat"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"; [ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/   /'; die "berkas di luar allowlist"; }
RAWAN="$(printf '%s\n' "$CHANGED" | grep -v '^production-mobile/' | grep -E '(^|/)(docker-compose[^/]*|Dockerfile)$|package(-lock)?\.json$|\.env|^frontend/' || true)"
[ -z "$RAWAN" ] || { printf '%s\n' "$RAWAN" | sed 's/^/   /'; die "Docker/package/env/frontend server berubah"; }
[ "$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | sha256sum | cut -d' ' -f1)" = "$MIG_SHA" ] || die "sha migrasi berbeda dari yang diaudit"
[ "$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | wc -l)" = 1 ] || die "harus tepat satu berkas migrasi"
[ "$(sg -c core.quotepath=false diff --no-renames --no-color --no-ext-diff --binary --full-index "$BASE_SHA" "$DEPLOY_SHA" -- backend frontend | sha256sum | cut -d' ' -f1)" = "$DIFF_SHA" ] || die "isi diff backend berbeda dari yang diaudit"
ok "$(printf '%s\n' "$CHANGED" | grep -vc '^production-mobile/') berkas server dalam allowlist (+ $(printf '%s\n' "$CHANGED" | grep -c '^production-mobile/') berkas aplikasi Android, tidak ikut ke server); migrasi dan isi diff sesuai pin"

PHASE=3; say "3. Audit produksi (isi kode, bukan marker)"
curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "health internal"; curl -fsS -m15 "${PUBLIC_URL}/api/health" | grep -q '"ok":true' || die "health publik"
PUB_BEFORE="$(curl -fsS -m15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"; PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$PREV_INDEX" ] && [ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = 0 ] || die "migrasi menggantung"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${MIG_NAME}'")" = 0 ] || die "migrasi sudah pernah diterapkan"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${MIG_DASAR}' and finished_at is not null")" = 1 ] || die "migrasi dasar ${MIG_DASAR} belum ada di produksi"
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_name='mobile_device_tokens' and column_name='app'")" = 0 ] || die "kolom mobile_device_tokens.app sudah ada di produksi"
if grep -qE '^[[:space:]]*PRODUCTION_PUSH_ENABLED[[:space:]]*=[[:space:]]*"?true' "$PERSIST/backend/.env"; then die "PRODUCTION_PUSH_ENABLED=true di .env — rilis ini harus berjalan dengan push Produksi MATI"; fi
ok "PRODUCTION_PUSH_ENABLED tidak hidup (push Produksi mati)"
sg -c core.quotepath=false ls-tree -r "$BASE_SHA" | awk -F'\t' '$1 ~ /^100[0-9]+ blob/ && $2 !~ /^frontend\/dist\// { split($1,a," "); print a[3] "\t" $2 }' > "$BK_DIR/base.tsv"
cut -f2 "$BK_DIR/base.tsv" | sed "s#^#${PREV_DIR}/#" | git hash-object --no-filters --stdin-paths > "$BK_DIR/live.txt" || die "berkas baseline hilang di release aktif"
BEDA="$(paste "$BK_DIR/base.tsv" "$BK_DIR/live.txt" | awk -F'\t' '$1 != $3' | wc -l)"; [ "$BEDA" = 0 ] || die "kode live menyimpang dari baseline: ${BEDA} berkas"
ok "kode live == baseline ($(wc -l < "$BK_DIR/base.tsv") berkas); bundel publik ${PREV_INDEX}"
FREE="$(bebas_kb)"
if [ "$MODE" = preflight ]; then
  [ "$FREE" -ge "$REH_FREE_KB" ] && ok "disk bebas $((FREE/1024)) MiB (rehearsal butuh >= 3 GiB)" || warn "disk bebas $((FREE/1024)) MiB < 3 GiB: rehearsal akan berhenti"
  [ "$FREE" -ge "$MIN_FREE_KB" ] || warn "disk bebas $((FREE/1024)) MiB < 4 GiB: RILIS PENUH (build image+backup) akan berhenti di gerbang disk"
  say "Preflight selesai: produksi TIDAK diubah"; trap - EXIT; exit 0
fi
if [ "$MODE" = rehearsal ]; then [ "$FREE" -ge "$REH_FREE_KB" ] || die "rehearsal butuh >= 3 GiB bebas"; else [ "$FREE" -ge "$MIN_FREE_KB" ] || die "butuh >= 4 GiB bebas untuk image+backup"; [ ! -e "$NEW_DIR" ] || die "release dir sudah ada"; fi

PHASE=4; say "4. Backup segar"
BACKUP_FILE="$HOME/backups/pre-produksi-mobile-${DEPLOY_SHORT}-${TS}.sql.gz"
docker exec "$PG" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "${BACKUP_FILE}.partial"; gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || die "dump tidak lengkap"; mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"; sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"; ok "backup ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"
if [ "$MODE" = release ]; then
  mkdir "$NEW_DIR"; sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"; printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
  ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"
  # Web TIDAK berubah: dist release aktif disalin apa adanya (tanpa build web).
  cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin dist aktif"
  [ "$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)" = "$PREV_INDEX" ] || die "dist salinan berbeda dari dist aktif"; ok "dist aktif ${PREV_INDEX} disalin (web tidak di-build)"
  ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-rpm-${DEPLOY_SHORT}"; docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG"
  dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { docker tag "$PREV_IMG_ID" "$IMG_NAME"; tail -n 20 "$BK_DIR/build.log"; die "build image gagal"; }
  ok "image baru dibangun; rollback ${ROLLBACK_TAG}"; REH_SRC="$NEW_DIR"
else
  REH_SRC="$BK_DIR/src"; mkdir -p "$REH_SRC"; sg archive "$DEPLOY_SHA" backend/src backend/prisma | tar -x -C "$REH_SRC"; ok "kode kandidat (backend/src + prisma) diekstrak untuk rehearsal"
fi

PHASE=4r; say "4r. Rehearsal: restore backup ke salinan, migrasi, uji baca kode baru"
REH_DB="rehearsal_rpm_${DEPLOY_SHORT}"; docker exec "$PG" psql -U "$DB_USER" -d postgres -qc "DROP DATABASE IF EXISTS ${REH_DB}" -c "CREATE DATABASE ${REH_DB}"
gzip -dc "$BACKUP_FILE" | docker exec -i "$PG" psql -U "$DB_USER" -d "$REH_DB" -q > "$BK_DIR/restore.log" 2>&1 || true
RE_LAIN="$(grep -E 'ERROR:|FATAL:' "$BK_DIR/restore.log" | grep -vc 'role "mcp_hub_readonly" does not exist' || true)"; [ "$RE_LAIN" = 0 ] || { grep -E 'ERROR:|FATAL:' "$BK_DIR/restore.log" | head -n 5 | cut -c1-160; die "restore rehearsal punya galat selain role hilang"; }
dump_skema() { docker exec "$PG" pg_dump -U "$DB_USER" -d "$1" -s --no-owner --no-privileges > "$2" </dev/null || die "dump skema $1 gagal"; [ -s "$2" ] || die "dump skema $1 kosong"; }
dump_skema "$DB_NAME" "$BK_DIR/skema-live.sql"; dump_skema "$REH_DB" "$BK_DIR/skema-reh-awal.sql"
HSL="$(skema_banding "$BK_DIR/skema-live.sql" "$BK_DIR/skema-reh-awal.sql")" || { printf '%s\n' "$HSL"; die "skema salinan tidak identik dengan sumber"; }; ok "restore lengkap; skema salinan identik: $HSL"
cat > "$BK_DIR/rpm-smoke.mjs" <<'JS'
// Uji BACA kode kandidat terhadap salinan. Tidak menulis apa pun. Mencetak:
//  - token push per aplikasi (semua harus 'finance' — aplikasi Produksi belum pernah mendaftar),
//  - akun AKTIF yang lolos gerbang login Produksi (capabilities.productionApp) + preset tampilannya,
//  - gerbang aplikasi: '' → Finance, 'production' → Produksi, lainnya → null (400 APP_UNKNOWN).
const { prisma } = await import("/app/src/db.js");
const { capabilitiesFor } = await import("/app/src/services/capabilities.js");
const { loadRoles } = await import("/app/src/routes/auth.js");
const { gerbangApp } = await import("/app/src/routes/mobileAuth.js");
await import("/app/src/middleware/auth.js"); await import("/app/src/routes/productionExperience.js"); await import("/app/src/routes/productionPlanning.js");
const { productionPushEnabled } = await import("/app/src/services/productionNotifications.js");
const perApp = await prisma.mobileDeviceToken.groupBy({ by: ["app"], _count: { _all: true } });
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } });
const tim = [];
for (const u of users) {
  const caps = capabilitiesFor({ roles: await loadRoles(u), role: u.role });
  if (caps.productionApp) tim.push(`${u.name}:${caps.productionPreset}`);
}
const gerbang = [gerbangApp("")?.kunci ?? "finance", gerbangApp("production")?.kunci, gerbangApp("x") === null ? "tolak" : "LOLOS"].join(",");
console.log(JSON.stringify({ rpm: "ok", token: Object.fromEntries(perApp.map((r) => [r.app, r._count._all])), pushProduksi: productionPushEnabled(), gerbang, timProduksi: tim.length }));
console.log("TIM " + tim.join(" | "));
await prisma.$disconnect();
JS
dcp "$PREV_DIR" run --rm --no-deps -T -v "$REH_SRC/backend/src:/app/src:ro" -v "$REH_SRC/backend/prisma:/app/prisma:ro" -v "$BK_DIR/rpm-smoke.mjs:/app/rpm-smoke.mjs:ro" --entrypoint sh -e "RDB=${REH_DB}" backend -c \
  'export DATABASE_URL="$(printf %s "$DATABASE_URL" | sed "s#/[^/?]*\(?.*\)\?\$#/$RDB\1#")"; case "$DATABASE_URL" in */rehearsal_rpm_*) ;; *) echo "DATABASE_URL bukan salinan rehearsal"; exit 9;; esac; npx prisma generate >/dev/null && npx prisma migrate deploy && node /app/rpm-smoke.mjs' \
  </dev/null > "$BK_DIR/migrate-reh.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-reh.log"; die "migrasi/uji baca rehearsal gagal"; }
[ "$(grep -c 'Applying migration' "$BK_DIR/migrate-reh.log")" = 1 ] || die "rehearsal harus menerapkan tepat 1 migrasi"
dump_skema "$REH_DB" "$BK_DIR/skema-reh-akhir.sql"
HSL="$(skema_tambahan "$BK_DIR/skema-reh-awal.sql" "$BK_DIR/skema-reh-akhir.sql")" || { printf '%s\n' "$HSL"; die "tambahan skema tidak sesuai migrasi"; }; ok "tambahan skema: $HSL"
UJI="$(grep '^{"rpm"' "$BK_DIR/migrate-reh.log" | tail -n 1)"; [ -n "$UJI" ] || die "uji baca tidak menghasilkan ringkasan"; ok "uji baca kode baru pada salinan: ${UJI}"
printf '%s\n' "$UJI" | grep -q '"pushProduksi":false' || die "push Produksi harus mati"
printf '%s\n' "$UJI" | grep -q '"gerbang":"finance,production,tolak"' || die "gerbang aplikasi tidak sesuai"
printf '%s\n' "$UJI" | grep -qE '"token":\{("finance":[0-9]+)?\}' || die "token salinan harus semuanya app=finance"
printf '%s\n' "$UJI" | grep -qE '"timProduksi":0[,}]' && warn "TIDAK ADA akun aktif yang bisa login ke aplikasi Produksi — periksa peran tim sebelum membagikan APK"
ok "akun yang bisa login aplikasi Produksi: $(grep '^TIM ' "$BK_DIR/migrate-reh.log" | tail -n 1 | cut -c5-)"
bersih; REH_DB=""; REH_SRC=""
if [ "$MODE" = rehearsal ]; then
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container live berubah selama rehearsal"
  say "Rehearsal selesai: produksi TIDAK dimigrasi, TIDAK di-build, TIDAK di-switch. Backup segar: ${BACKUP_FILE}"; trap - EXIT; exit 0
fi

PHASE=5; say "5. Migrasi aditif lalu switch satu kali"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container berubah sebelum switch"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate.log" 2>&1 || { tail -n 15 "$BK_DIR/migrate.log"; die "migrasi produksi gagal"; }
[ "$(grep -c 'Applying migration' "$BK_DIR/migrate.log")" = 1 ] || die "produksi harus menerapkan tepat 1 migrasi"
gd_baseline
T_SWITCH="$(date -u +%FT%TZ)"; dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "up gagal"
UP=0; for i in $(seq 1 60); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = 1 ] || die "backend baru tidak sehat"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s\n' "$CID_NEW" | grep -c .)" = 1 ] || die "harus tepat satu backend setelah switch"
ok "switch ${T_SWITCH}"

PHASE=6; say "6. Verifikasi dan smoke (tanpa menulis data)"
[ "$(curl -fsS -m15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$PREV_INDEX" ] || die "bundel publik berubah (rilis ini tidak mengubah web)"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah"
gd_verifikasi
# Kode baru menolak `app` tak dikenal SEBELUM mencari akun (400 APP_UNKNOWN). Kode lama mengabaikan `app` lalu menjawab 401.
R="$(curl -s -m15 -H 'Content-Type: application/json' -d '{"email":"cek-rilis@invalid","password":"x","app":"cek-rilis"}' -w ' %{http_code}' "${PUBLIC_URL}/api/mobile/auth/login")"
printf '%s\n' "$R" | grep -q 'APP_UNKNOWN.* 400$' || die "login mobile dengan app tak dikenal harus 400 APP_UNKNOWN (dapat: ${R})"
c="$(curl -s -o /dev/null -w '%{http_code}' -m15 "${PUBLIC_URL}/api/production-v2/worker/material")"; [ "$c" = 401 ] || die "/api/production-v2/worker/material tanpa token harus 401 (dapat ${c})"
c="$(curl -s -o /dev/null -w '%{http_code}' -m15 -X POST -H 'Content-Type: application/json' -d '{}' "${PUBLIC_URL}/api/mobile/devices")"; [ "$c" = 401 ] || die "POST /api/mobile/devices tanpa token harus 401 (dapat ${c})"
sleep 15; [ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = 0 ] || die "backend restart sendiri"
[ "$(psql_live -At -c "select count(*) from mobile_device_tokens where app <> 'finance'")" = 0 ] || die "ada token non-finance sesudah switch (aplikasi Produksi belum dibagikan)"
ok "smoke lulus; gerbang aplikasi aktif; semua token push tetap app=finance; tidak ada data yang diisi"
trap - EXIT; say "SELESAI ${DEPLOY_SHORT}. Rollback: bash /tmp/rpm.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback"
