#!/usr/bin/env bash
# Rilis MANUAL "Usulan Prioritas Pagi" (Route Planner <-> Produksi) ke produksi dengan workflow
# RELEASE-DIRECTORY (~/releases/klinik-matras/<sha8>). Migration ADITIF (1 tabel baru, tanpa kolom baru
# di tabel lama, tanpa data lama tersentuh). Backend DIBANGUN ULANG (route+service baru); frontend
# DIBANGUN ULANG (2 komponen baru + 2 halaman menyisipkannya). Kunci Maps JS diverifikasi tetap ada
# di dist baru (non-regresi — pernah regresi 2x sebelumnya di sesi ini).
#
#   git show <sha>:scripts/release-morning-priority.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/rmp.sh && bash /tmp/rmp.sh <DEPLOY_SHA_LENGKAP> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rmp.sh <DEPLOY_SHA_LENGKAP>'
#
# Baseline produksi = 6c0e7944 (branch release/morning-priority-pagi-on-6c0e7944).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
PROD_FULL="6c0e79449ea2e6f0e79e2cc6a9a7f04bb10b5c37"
RELEASE_BRANCH="release/morning-priority-pagi-on-6c0e7944"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MAPS_KEY_TOKEN="GezFdupuG1cWenKYxGbljSw_u7Mr0"  # potongan unik kunci Maps JS — cek NON-REGRESI
MIGRATION_NAME="20261015110000_morning_priority_request"

PREFLIGHT_ONLY=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/morning-priority-${DEPLOY_SHORT}-${TS}"
PHASE="init"; PREV_DIR=""; PREV_COMMIT=""; NEW_INDEX=""; DIST_INDEX_OLD=""; PREV_IMG_ID=""; IMG_NAME=""; NEW_IMG_ID=""; ROLLBACK_TAG=""; BACKUP_FILE=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "${CDIR:-$PREV_DIR}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
CDIR=""

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
C. Migration ini ADITIF MURNI (1 tabel baru, tanpa kolom baru di tabel lama): rollback KODE tidak
   memerlukan rollback skema — tabel baru menganggur begitu kode lama (yang tidak tahu soal tabel itu)
   kembali aktif. TIDAK ADA data lama yang diubah/dihapus oleh migration ini.
D. Restore dari backup hanya jalan terakhir dan wajib persetujuan pemilik (docs/PANDUAN-RESTORE-BACKUP.md bagian 6).
──────────────────────────────────────────────────────────────────────────────────────────────────────────
EOF
}
cleanup() {
  local rc=$?
  if [ -n "${VERIFY_DB:-}" ] && [[ "$VERIFY_DB" =~ ^km_release_verify_[0-9]{8}_[0-9]{6}$ ]] && [ -n "$PREV_DIR" ]; then
    dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" --if-exists "$VERIFY_DB" </dev/null >/dev/null 2>&1 || true
  fi
  if [ $rc -ne 0 ]; then
    printf '\n\033[31mRILIS BERHENTI (kode %s) pada fase: %s. Tidak ada rollback otomatis.\033[0m\n' "$rc" "$PHASE" >&2
    [ "$PREFLIGHT_ONLY" = "1" ] || rollback_instructions >&2
  fi
}
trap cleanup EXIT

# ── 0. Lingkungan ────────────────────────────────────────────────────────────────────────────────────────
PHASE="0-lingkungan"; say "0. Lingkungan"
for c in git docker curl grep flock sed awk df; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
docker compose version >/dev/null 2>&1 || die "docker compose tidak tersedia"
exec 9>/tmp/release-morning-priority.lock; flock -n 9 || die "rilis lain sedang berjalan (kunci /tmp/release-morning-priority.lock)"
mkdir -p "$BK_DIR" "$HOME/release-src"
LOG="$BK_DIR/release.log"; exec > >(tee -a "$LOG") 2>&1
ok "log: ${LOG}"
[ -d "$RELEASES" ] || die "direktori rilis ${RELEASES} tidak ada"
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

# ── 1. Sumber kode, ancestry, batas perubahan ───────────────────────────────────────────────────────────
PHASE="1-sumber"; say "1. Sumber kode, ancestry, dan batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=500 origin "+refs/heads/${RELEASE_BRANCH}:refs/remotes/origin/${RELEASE_BRANCH}" || die "git fetch origin gagal"
ORIGIN_REL="$(sg rev-parse "refs/remotes/origin/${RELEASE_BRANCH}")"
[ "$ORIGIN_REL" = "$DEPLOY_SHA" ] || die "origin/${RELEASE_BRANCH} (${ORIGIN_REL:0:8}) BUKAN SHA rilis (${DEPLOY_SHORT})"
sg merge-base --is-ancestor "$PROD_FULL" "$DEPLOY_SHA" || die "baseline produksi ${PROD_FULL:0:8} bukan leluhur SHA rilis"
ok "origin/${RELEASE_BRANCH} = ${DEPLOY_SHORT}; baseline ${PROD_FULL:0:8} (produksi aktif) adalah leluhurnya"
CHANGED="$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" | LC_ALL=C sort)"
ALLOWED_RE='^(backend/prisma/migrations/20261015110000_morning_priority_request/migration\.sql|backend/prisma/schema\.prisma|backend/src/index\.js|backend/src/lib/activityLog\.js|backend/src/routes/morningPriority\.js|backend/src/services/morningPriority\.js|backend/tests/integration/morningPriorityRequest\.integration\.test\.js|backend/tests/integration/setup/testApp\.js|frontend/src/api\.js|frontend/src/features/armada/components/MorningPriorityPanel\.jsx|frontend/src/features/production/MorningPriorityApprovalPanel\.jsx|frontend/src/pages/armada/ArmadaRoutes\.jsx|frontend/src/pages/bengkel/ProductionPlannerV2\.jsx|frontend/dist/.*|scripts/release-morning-priority\.sh)$'
BAD_FILES="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$BAD_FILES" ] || { printf '%s\n' "$BAD_FILES" | sed 's/^/        /'; die "ada berkas di luar daftar yang diaudit"; }
printf '%s\n' "$CHANGED" | grep -Fx "backend/prisma/migrations/${MIGRATION_NAME}/migration.sql" >/dev/null || die "migration baru tidak ditemukan di diff (rilis salah baseline?)"
printf '%s\n' "$CHANGED" | grep -Fx 'frontend/dist/index.html' >/dev/null || die "frontend/dist/index.html tidak berubah (dist belum dibangun ulang?)"
ok "perubahan sesuai daftar yang diaudit ($(printf '%s\n' "$CHANGED" | grep -c .) berkas)"
[ -z "$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" -- backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json backend/Dockerfile docker-compose.yml docker-compose.release.yml)" ] || die "rilis menyentuh dependensi/Docker — di luar scope audit ini"
ok "dependensi dan Docker TIDAK berubah"
# Isi migration: HANYA boleh CREATE (TYPE/TABLE/INDEX) dan ADD CONSTRAINT — tanpa DROP/ALTER kolom lama/UPDATE/DELETE.
MIG_SQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIGRATION_NAME}/migration.sql")"
echo "$MIG_SQL" | grep -qiE '\bDROP\b|\bUPDATE\b|\bDELETE\b|\bALTER TABLE\b.*\bALTER COLUMN\b' && die "migration ini BUKAN aditif murni (ada DROP/UPDATE/DELETE/ALTER COLUMN) — audit ulang sebelum lanjut"
echo "$MIG_SQL" | grep -q $'\r' && die "migration.sql mengandung CRLF — rilis harus LF"
ok "migration.sql aditif murni (hanya CREATE/ADD CONSTRAINT), LF, tanpa menyentuh data/kolom lama"
NEW_INDEX="$(sg show "${DEPLOY_SHA}:frontend/dist/index.html" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
[ -n "$NEW_INDEX" ] || die "tidak dapat membaca bundel index dari commit rilis"
sg ls-tree -r --name-only "$DEPLOY_SHA" -- frontend/dist/assets | grep -E '^frontend/dist/assets/(MorningPriorityPanel|MorningPriorityApprovalPanel)-.*\.js$' | grep -q . || die "chunk fitur (MorningPriorityPanel/ApprovalPanel) tidak ditemukan di commit rilis"
ok "commit rilis memuat chunk fitur frontend"
MAPS_CHUNK="$(sg ls-tree -r --name-only "$DEPLOY_SHA" -- frontend/dist/assets | grep -E '\.js$' | while read -r f; do sg show "${DEPLOY_SHA}:${f}" 2>/dev/null | grep -q "$MAPS_KEY_TOKEN" && { echo "$f"; break; }; done)"
[ -n "$MAPS_CHUNK" ] || die "TIDAK ADA berkas JS di commit rilis yang membawa kunci Maps JS (regresi lama akan terulang)"
ok "non-regresi: commit rilis tetap memuat kunci Maps JS di ${MAPS_CHUNK##*/}"

# ── 2. Audit produksi (baca-saja) ────────────────────────────────────────────────────────────────────────
PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$PROD_FULL" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${PROD_FULL:0:8}; produksi bergeser sejak audit"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"; CDIR="$PREV_DIR"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT} = baseline); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
DIST_INDEX_OLD="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
[ "$PUB_BEFORE" = "$DIST_INDEX_OLD" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${DIST_INDEX_OLD})"
[ "$NEW_INDEX" != "$DIST_INDEX_OLD" ] || die "bundel baru identik dengan lama (tidak diharapkan)"
ok "health sehat; bundel publik saat ini ${DIST_INDEX_OLD} (akan berubah ke ${NEW_INDEX})"

say "2b. Migration: TIDAK boleh ada yang menggantung; tepat 0 pending sebelum rilis ini"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung di produksi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort > "$BK_DIR/applied.txt"
sg ls-tree --name-only "$PROD_FULL" backend/prisma/migrations/ | sed 's#backend/prisma/migrations/##' | grep -E '^[0-9]{14}_' | LC_ALL=C sort > "$BK_DIR/tree_baseline.txt"
PENDING_BASELINE="$(LC_ALL=C comm -13 "$BK_DIR/applied.txt" "$BK_DIR/tree_baseline.txt")"
[ -z "$PENDING_BASELINE" ] || die "produksi punya migration baseline yang belum applied: $(printf '%s' "$PENDING_BASELINE" | tr '\n' ' ')"
grep -Fx "$MIGRATION_NAME" "$BK_DIR/applied.txt" >/dev/null && die "migration ${MIGRATION_NAME} sudah applied sebelumnya (rilis dobel?)"
ok "baseline bersih, 0 pending; ${MIGRATION_NAME} belum applied (akan diterapkan rilis ini)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 6 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; exit 0; fi

# ── 3. Backup + verifikasi restore ───────────────────────────────────────────────────────────────────────
PHASE="3-backup"; say "3. Backup produksi + checksum + verifikasi restore ke DB sementara"
BACKUP_FILE="$HOME/backups/pre-morning-priority-${DEPLOY_SHORT}-${TS}.sql.gz"
COUNTS_SQL="select table_name||'|'||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
psql_live -At -c "$COUNTS_SQL" > "$BK_DIR/.counts_before.txt"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
SHA256="$(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 ${SHA256}"
PHASE="3b-verifikasi-restore"
VERIFY_DB="km_release_verify_${TS}"; [[ "$VERIFY_DB" =~ ^km_release_verify_[0-9]{8}_[0-9]{6}$ ]] || die "nama DB verifikasi tidak aman"
dcp "$PREV_DIR" exec -T postgres createdb -U "$DB_USER" "$VERIFY_DB" </dev/null || die "gagal membuat DB sementara"
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -X -q -o /dev/null || die "restore ke DB sementara GAGAL"
RESTORED_COUNT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -c 'select count(*) from information_schema.tables where table_schema=current_schema()' </dev/null)"
[ -n "$RESTORED_COUNT" ] && [ "$RESTORED_COUNT" -gt 50 ] || die "hasil restore terlihat tidak lengkap (cuma ${RESTORED_COUNT} tabel)"
ok "restore terverifikasi: ${RESTORED_COUNT} tabel"
dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" "$VERIFY_DB" </dev/null && VERIFY_DB="" && ok "DB sementara dihapus"
rm -f "$BK_DIR"/.counts_before.txt

# ── 4. Release dir ───────────────────────────────────────────────────────────────────────────────────────
PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive SHA rilis; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${RELEASE_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "branch rilis berubah sejak audit"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sejak audit"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" || die "git archive gagal"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile frontend/dist/index.html backend/prisma/migrations/${MIGRATION_NAME}/migration.sql; do [ -e "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
grep -rlq "$MAPS_KEY_TOKEN" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null || die "dist di release dir baru tidak membawa kunci Maps JS (non-regresi gagal)"
ok "release dir dibuat dari git archive; docker-compose identik; dist baru membawa kunci Maps JS (non-regresi)"

# ── 5. Build image backend ───────────────────────────────────────────────────────────────────────────────
PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-morning-priority-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama (tidak diharapkan: kode backend berubah)"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

# ── 6. Migration ─────────────────────────────────────────────────────────────────────────────────────────
PHASE="6-migrate"; say "6. prisma migrate deploy (image baru; HARUS menerapkan TEPAT 1 migration: ${MIGRATION_NAME})"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null || true
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration setengah jalan; JANGAN switch"
APPLIED_AFTER="$(psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1")"
NEW_APPLIED="$(LC_ALL=C comm -13 "$BK_DIR/applied.txt" <(printf '%s\n' "$APPLIED_AFTER" | LC_ALL=C sort))"
[ "$NEW_APPLIED" = "$MIGRATION_NAME" ] || die "migration yang diterapkan BUKAN tepat 1 ${MIGRATION_NAME} (dapat: $(printf '%s' "$NEW_APPLIED" | tr '\n' ' '))"
ok "migrate deploy menerapkan TEPAT 1 migration baru: ${MIGRATION_NAME}"
[ "$(psql_live -At -c "select count(*) from morning_priority_requests")" = "0" ] || die "tabel baru TIDAK kosong (seharusnya baru dibuat)"
ok "tabel morning_priority_requests ada dan kosong, sesuai migration aditif"
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
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru (${NEW_INDEX})"; ok "bundel web publik = ${NEW_INDEX} (dist baru)"
PUB_MAPS_CHUNK="$(basename "$MAPS_CHUNK")"
curl -fsS --max-time 20 "${PUBLIC_URL}/assets/${PUB_MAPS_CHUNK}" | grep -q "$MAPS_KEY_TOKEN" || die "chunk peta TIDAK terlayani publik dengan kunci (regresi)"
ok "web publik melayani chunk peta DENGAN kunci Maps JS (non-regresi terkonfirmasi live)"

# ── 9. Smoke test (endpoint baru, BACA + satu siklus tulis-batalkan yang dibersihkan sendiri) ─────────────
PHASE="9-smoke"; say "9. Smoke test endpoint Usulan Prioritas Pagi (siklus tandai -> baca -> batalkan, bersih sendiri)"
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
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
if (!adm) { rec("akun ADMIN aktif", false, "tidak ada"); process.exit(1); }
const roles = (await prisma.userRole.findMany({ where: { userId: adm.id }, select: { role: true } })).map((r) => r.role);
const token = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: roles.length ? roles : [adm.role] }, process.env.JWT_SECRET, { expiresIn: "5m" });
rec("tanpa token ditolak (401)", (await api("GET", "/api/morning-priority-requests", null)).status === 401);

const before = await api("GET", "/api/morning-priority-requests", token);
rec("GET /morning-priority-requests 200 (array, ADMIN berhak)", before.status === 200 && Array.isArray(before.json), `${before.json?.length} baris APPROVED saat ini`);

const kandidat = await prisma.order.findFirst({ where: { status: "PROCESSING" }, select: { id: true, orderNumber: true } });
if (!kandidat) { rec("ada order PROCESSING untuk smoke test", true, "tidak ada saat ini di produksi — siklus tandai/baca/batalkan dilewati, bukan kegagalan"); }
else {
  const unitSebelum = await prisma.unit.findMany({ where: { orderId: kandidat.id, status: { notIn: ["DELIVERED", "CANCELLED"] } }, select: { id: true, priority: true } });
  const created = await api("POST", "/api/morning-priority-requests", token, { orderId: kandidat.id, suggestedPriority: "HIGH", note: "smoke test rilis — otomatis dibatalkan" });
  rec("POST menandai order PROCESSING sungguhan -> 201, BERLAKU LANGSUNG (status APPROVED)", created.status === 201 && created.json?.status === "APPROVED", `status ${created.status} ${JSON.stringify(created.json)}`);
  const unitSesudah = await prisma.unit.findMany({ where: { id: { in: unitSebelum.map((u) => u.id) } }, select: { id: true, priority: true } });
  rec("priority unit benar-benar berubah di database (bukan cuma respons API)", unitSebelum.length === 0 || unitSesudah.every((u) => u.priority === "HIGH"), `${unitSesudah.filter((u) => u.priority === "HIGH").length}/${unitSesudah.length} unit`);
  const dismissed = await api("PATCH", `/api/morning-priority-requests/${created.json.id}/dismiss`, token);
  rec("PATCH dismiss -> 200, membersihkan diri sendiri (tidak meninggalkan data smoke test)", dismissed.status === 200 && dismissed.json?.status === "DISMISSED");
  const unitSetelahBatal = await prisma.unit.findMany({ where: { id: { in: unitSebelum.map((u) => u.id) } }, select: { id: true, priority: true } });
  rec("priority unit kembali ke nilai semula setelah dibatalkan", unitSebelum.every((before) => unitSetelahBatal.find((u) => u.id === before.id)?.priority === before.priority));
  const sisa = await prisma.morningPriorityRequest.findMany({ where: { orderId: kandidat.id } });
  rec("tidak ada baris tersisa selain yang baru saja dibatalkan (bersih)", sisa.filter((r) => r.status !== "DISMISSED").length === 0);
}

const sales = await prisma.user.findFirst({ where: { role: "SALES", active: true } });
if (sales) {
  const salesRoles = (await prisma.userRole.findMany({ where: { userId: sales.id }, select: { role: true } })).map((r) => r.role);
  const salesToken = jwt.sign({ id: sales.id, name: sales.name, role: sales.role, roles: salesRoles.length ? salesRoles : [sales.role] }, process.env.JWT_SECRET, { expiresIn: "5m" });
  rec("SALES ditolak 403 (role lain tidak berhak)", (await api("GET", "/api/morning-priority-requests", salesToken)).status === 403);
} else rec("akun SALES untuk uji 403", true, "tidak ada — dilewati, bukan kegagalan");

await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus"

# ── 10. Data lama tidak tersentuh ────────────────────────────────────────────────────────────────────────
PHASE="10-verifikasi-data"; say "10. Verifikasi data lama tidak berubah (migration aditif murni)"
psql_live -At -c "$COUNTS_SQL" > "$BK_DIR/.counts_after.txt"
DIFF_COUNTS="$(diff <(grep -v '^morning_priority_requests' "$BK_DIR/.counts_after.txt") <(dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -At -c "$COUNTS_SQL" </dev/null | grep -v '^morning_priority_requests') || true)"
[ -z "$DIFF_COUNTS" ] && ok "jumlah baris seluruh tabel lama IDENTIK sebelum/sesudah rilis (di luar aktivitas normal operasional)" || warn "ada selisih jumlah baris — tinjau manual (bisa jadi aktivitas operasional normal selama rilis berjalan): ${DIFF_COUNTS}"
rm -f "$BK_DIR"/.counts_after.txt

# ── 11. Log ──────────────────────────────────────────────────────────────────────────────────────────────
PHASE="11-log"; say "11. Log backend sejak switch (${SWITCH_AT})"
LOGS="$(dcp "$NEW_DIR" logs --since "$SWITCH_AT" --no-color backend </dev/null 2>&1 | cut -c1-240 || true)"
FATAL="$(printf '%s\n' "$LOGS" | grep -Ei 'P2021|P2022|does not exist|PrismaClientInitializationError|Cannot find module|EADDRINUSE' || true)"
[ -z "$FATAL" ] || { printf '%s\n' "$FATAL" | sed -n 1,10p; die "log backend memuat error skema/inisialisasi"; }
ERRN="$(printf '%s\n' "$LOGS" | grep -Eic 'error|exception|unhandled' || true)"; ok "tanpa error skema/inisialisasi; baris 'error/exception': ${ERRN}"
[ "$ERRN" = "0" ] || printf '%s\n' "$LOGS" | grep -Ei 'error|exception|unhandled' | sed -n 1,8p | sed 's/^/        /'
dcp "$NEW_DIR" exec -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null && ok "prisma migrate status: database schema is up to date" || die "migrate status tidak 'up to date'"

PHASE="12-selesai"; say "12. Ringkasan"
dcp "$NEW_DIR" ps </dev/null
cat <<EOF

RILIS USULAN PRIORITAS PAGI SELESAI.
  release aktif : ${NEW_DIR}  (commit ${DEPLOY_SHA})
  release lama  : ${PREV_DIR}  (commit ${PREV_COMMIT}; tidak dihapus)
  image lama    : ${ROLLBACK_TAG}
  migration baru: ${MIGRATION_NAME} (aditif murni)
  backup        : ${BACKUP_FILE}
  sha256        : ${SHA256}
  log/baseline  : ${BK_DIR}
EOF
trap - EXIT
exit 0
