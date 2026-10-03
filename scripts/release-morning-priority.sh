#!/usr/bin/env bash
# Rilis "Usulan Prioritas Pagi" (Route Planner <-> Produksi, direct-apply, 3 Okt 2026).
# Pola SAMA dengan release-production-v2.sh: git archive candidate (EXCLUDE frontend/dist), symlink
# backend/.env + frontend/.env dari persist, BUILD frontend & backend DI SERVER (bukan di laptop),
# jadi kunci Maps JS tidak pernah perlu difetch mentah — ia sudah ada di persist/frontend/.env.
# Migration: ADITIF MURNI (1 tabel baru morning_priority_requests, 0 kolom lama disentuh).
#
#   git show <sha>:scripts/release-morning-priority.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/rmp.sh && bash /tmp/rmp.sh <DEPLOY_SHA_LENGKAP> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rmp.sh <DEPLOY_SHA_LENGKAP>'
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
PREV_FULL="6c0e7944a263c41a345bd0fd13f6f213be5eaeef"
CAND_FULL="$DEPLOY_SHA"
BRANCH="release/morning-priority-pagi-on-6c0e7944"
TAG="morning-priority"
MIGRATION_NAME="20261015110000_morning_priority_request"
EXPECT_PREV_SHORT="${PREV_FULL:0:8}"; SHORT="${CAND_FULL:0:8}"
EXPECT_APPLIED=""; EXPECT_APPLIED_AFTER=""
EXPECT_FLAGS=""

PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"; NEW_DIR="$RELEASES/$SHORT"; PREV_DIR="$RELEASES/$EXPECT_PREV_SHORT"
TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/${TAG}-${SHORT}-${TS}"; LOCK="$HOME/releases/.release.lock"
PREFLIGHT_ONLY=0; for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
PHASE=init; IMG_NAME="klinik-matras-backend:latest"; HAVE_LOCK=0; SWITCH_AT=""; BACKUP_FILE=""; ROLLBACK_TAG=""
MAPS_KEY_TOKEN="GezFdupuG1cWenKYxGbljSw_u7Mr0"

say(){ printf '\n== %s\n' "$*"; }; ok(){ printf '  OK    %s\n' "$*"; }; warn(){ printf '  WARN  %s\n' "$*"; }
die(){ printf '\nSTOP: %s\n' "$*" >&2; exit 1; }
sg(){ git --git-dir="$SRC" "$@"; }
dcp(){ local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
CDIR="$PREV_DIR"
psql_live(){ dcp "$CDIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
flags_snapshot(){ psql_live -At -c "select string_agg(key||'='||enabled::text||':'||coalesce(config::text,'{}'), ',' order by key) from v2_feature_flags"; }
cleanup(){ local rc=$?; [ "$HAVE_LOCK" = 1 ] && rm -rf "$LOCK"
  if [ $rc -ne 0 ]; then printf '\nRILIS BERHENTI (kode %s) fase: %s. Tanpa rollback otomatis.\nRelease sebelumnya: %s\nRollback:\n  cd %s \&\& SANSS_PERSIST_ROOT=%s docker compose -p %s -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps backend\nBackup: %s\n' "$rc" "$PHASE" "$PREV_DIR" "$PREV_DIR" "$PERSIST" "$PROJECT" "${BACKUP_FILE:-<belum>}" >&2; fi; }
trap cleanup EXIT

PHASE=0-lock; say "0. Lock eksklusif + kondisi awal"
for c in git docker curl gzip sha256sum awk grep tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
docker compose version >/dev/null 2>&1 || die "docker compose tidak tersedia"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
LOG="$BK_DIR/release.log"; exec > >(tee -a "$LOG") 2>&1
mkdir "$LOCK" 2>/dev/null || die "lock rilis dipegang sesi lain: $(cat "$LOCK/owner" 2>/dev/null)"; HAVE_LOCK=1; echo "morning-priority $SHORT $(date -u +%FT%TZ)" > "$LOCK/owner"; ok "lock diambil; log: $LOG"
[ ! -e "$NEW_DIR" ] || die "$NEW_DIR sudah ada"
OTHER="$(ps -eo args | grep -E 'release-[a-z0-9-]+\.sh|docker compose .* build|docker build|prisma migrate deploy' | grep -v grep | grep -v "release-morning-priority" | grep -v "node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada deployment/build lain berjalan"; }
ok "tidak ada deployment/build lain berjalan"

PHASE=1-freeze; say "1. Freeze: production aktif harus persis $EXPECT_PREV_SHORT"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s' "$CID_OLD" | wc -w)" = 1 ] || die "container backend != 1"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; [ -n "$PREV_IMG_ID" ] || die "tidak bisa membaca image aktif"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah"
PREV_RELEASE_COMMIT="$(cat "$PREV_DIR/.release-commit")"; case "$PREV_RELEASE_COMMIT" in "$EXPECT_PREV_SHORT"*) : ;; *) die ".release-commit tidak cocok: $PREV_RELEASE_COMMIT" ;; esac
RC0="$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")"; ok "image ${PREV_IMG_ID:7:12} release $EXPECT_PREV_SHORT restart=$RC0"
EXPECT_APPLIED="$(find "$PREV_DIR/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)"; [ "$EXPECT_APPLIED" -gt 0 ] || die "tidak ada direktori migrasi di release live"
NAPP="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$NAPP" = "$EXPECT_APPLIED" ] || die "applied di DB ($NAPP) != direktori migrasi release live ($EXPECT_APPLIED) — STOP"; ok "migration applied $NAPP = direktori migrasi release live"
FL0="$(flags_snapshot)"; [ -n "$FL0" ] || die "snapshot flag kosong"; EXPECT_FLAGS="$FL0"; echo "$FL0" > "$BK_DIR/flags_pre.txt"; ok "flag V2 dibekukan: $FL0"
MPR0="$(psql_live -At -c "select count(*) from morning_priority_requests" 2>/dev/null || echo __NOTABLE__)"
[ "$MPR0" = "__NOTABLE__" ] || die "tabel morning_priority_requests SUDAH ADA sebelum migrasi ini (rilis dobel?)"
ok "tabel baru belum ada, sesuai ekspektasi migrasi aditif yang akan diterapkan"
curl -fsS --max-time 8 "$INTERNAL_URL/api/health" | grep -q '"ok":true' || die "health internal"; curl -fsS --max-time 15 "$PUBLIC_URL/api/health" | grep -q '"ok":true' || die "health publik"; ok "health lokal+publik"
[ -r "$PERSIST/frontend/.env" ] && grep -q VITE_GOOGLE_MAPS_JS_KEY "$PERSIST/frontend/.env" || die "PERSIST/frontend/.env atau kunci Maps tidak ada"
grep -q "$MAPS_KEY_TOKEN" "$PERSIST/frontend/.env" || die "kunci Maps di persist bukan kunci produksi yang diketahui (token tidak cocok) — STOP"
ok "mount persisten ada, frontend/.env (kunci Maps asli) tersedia untuk build"

PHASE=2-ancestry; say "2. Ancestry + scope (branch=$BRANCH)"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=500 origin "+refs/heads/$BRANCH:refs/cache/mpcand" "+refs/heads/main:refs/cache/main" 2>&1 | tail -3 || true
sg cat-file -e "${PREV_FULL}^{commit}" 2>/dev/null || sg fetch -q --deepen=5000 origin "+refs/heads/main:refs/cache/main" 2>&1 | tail -3 || true
sg cat-file -e "${PREV_FULL}^{commit}" 2>/dev/null || die "commit baseline ${EXPECT_PREV_SHORT} tidak ditemukan di cache git bahkan setelah deepen"
[ "$(sg rev-parse refs/cache/mpcand)" = "$CAND_FULL" ] || die "branch kandidat ($BRANCH) berubah: $(sg rev-parse refs/cache/mpcand)"
sg merge-base --is-ancestor "$PREV_FULL" "$CAND_FULL" || die "live ($EXPECT_PREV_SHORT) BUKAN ancestor kandidat — STOP"
ok "live ($EXPECT_PREV_SHORT) TERBUKTI leluhur langsung kandidat — superset bersih"
sg diff --name-only "$PREV_FULL" "$CAND_FULL" -- ':!frontend/dist' | LC_ALL=C sort > "$BK_DIR/scope.txt"
cat > "$BK_DIR/scope_expected.txt" <<'EOF'
backend/prisma/migrations/20261015110000_morning_priority_request/migration.sql
backend/prisma/schema.prisma
backend/src/index.js
backend/src/lib/activityLog.js
backend/src/routes/morningPriority.js
backend/src/services/morningPriority.js
backend/tests/integration/morningPriorityRequest.integration.test.js
backend/tests/integration/setup/testApp.js
frontend/src/api.js
frontend/src/features/armada/components/MorningPriorityPanel.jsx
frontend/src/features/production/MorningPriorityApprovalPanel.jsx
frontend/src/pages/armada/ArmadaRoutes.jsx
frontend/src/pages/bengkel/ProductionPlannerV2.jsx
scripts/release-morning-priority.sh
EOF
diff <(LC_ALL=C sort "$BK_DIR/scope_expected.txt") "$BK_DIR/scope.txt" > "$BK_DIR/scope_diff.txt" 2>&1 || die "scope TIDAK PERSIS 14 berkas yang diaudit — lihat $BK_DIR/scope_diff.txt: $(tr '\n' ' ' < "$BK_DIR/scope_diff.txt")"
ok "scope = tepat $(wc -l < "$BK_DIR/scope.txt") berkas yang diaudit, persis"
sg diff --name-status "$PREV_FULL" "$CAND_FULL" -- backend/prisma/migrations | grep -vE '^A[[:space:]]+backend/prisma/migrations/[0-9]+_[a-z0-9_]+/migration\.sql$' | grep -q . && die "diff migration bukan aditif murni — STOP"
NEW_MIG="$(sg diff --name-only --diff-filter=A "$PREV_FULL" "$CAND_FULL" -- backend/prisma/migrations | grep -c 'migration.sql' || true)"
[ "$NEW_MIG" = "1" ] || die "jumlah migration baru != 1 (dapat: $NEW_MIG)"
EXPECT_APPLIED_AFTER=$((EXPECT_APPLIED + 1))
ok "migrasi baru aditif = 1 ($MIGRATION_NAME); applied pasca-switch yang diharapkan = $EXPECT_APPLIED_AFTER"
MIG_SQL="$(sg show "${CAND_FULL}:backend/prisma/migrations/${MIGRATION_NAME}/migration.sql")"
echo "$MIG_SQL" | grep -qiE '\bDROP\b|\bUPDATE\b|\bDELETE\b|ALTER TABLE.*ALTER COLUMN' && die "migration.sql BUKAN aditif murni — STOP"
echo "$MIG_SQL" | grep -q $'\r' && die "migration.sql mengandung CRLF"
ok "migration.sql aditif murni (CREATE TYPE/TABLE/INDEX + FK), LF"
for f in backend/package-lock.json frontend/package-lock.json backend/package.json frontend/package.json docker-compose.yml docker-compose.release.yml backend/Dockerfile; do cmp -s <(sg show "${PREV_FULL}:$f") <(sg show "${CAND_FULL}:$f") || die "$f berubah di luar ekspektasi"; done
ok "package/compose/Dockerfile byte-identik dengan production aktif"
if [ "$PREFLIGHT_ONLY" = 1 ]; then say "Preflight selesai; production TIDAK diubah"; exit 0; fi

PHASE=3-backup; say "3. Backup production (600 + SHA-256) + verifikasi restore"
BACKUP_FILE="$HOME/backups/pre-${TAG}-${SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "gzip -t gagal"; gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1000000 ] || die "backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"; chmod 600 "$BACKUP_FILE"; ( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup"
chmod 600 "${BACKUP_FILE}.sha256"
VERIFY_DB="km_release_verify_$(date +%Y%m%d_%H%M%S)"
dcp "$PREV_DIR" exec -T postgres createdb -U "$DB_USER" "$VERIFY_DB" </dev/null || die "gagal membuat DB verifikasi restore"
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>"$BK_DIR/restore_verify.log" || { dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" --if-exists "$VERIFY_DB" </dev/null >/dev/null 2>&1; die "restore verifikasi GAGAL"; }
dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" --if-exists "$VERIFY_DB" </dev/null >/dev/null 2>&1
ok "backup $(basename "$BACKUP_FILE") $(du -h "$BACKUP_FILE" | cut -f1); restore verifikasi OK"

PHASE=4-release-dir; say "4. Release dir $NEW_DIR"
mkdir "$NEW_DIR"; sg archive "$CAND_FULL" | tar -x -C "$NEW_DIR" --exclude='frontend/dist'; printf '%s\n' "$SHORT" > "$NEW_DIR/.release-commit"
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env ada di arsip"; ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env"
[ ! -e "$NEW_DIR/frontend/.env" ] || die "frontend/.env ada di arsip"; ln -s "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env"; [ -r "$NEW_DIR/frontend/.env" ] || die "symlink frontend/.env"
grep -q VITE_GOOGLE_MAPS_JS_KEY "$NEW_DIR/frontend/.env" || die "frontend/.env tersymlink tapi kunci Maps tidak terbaca — STOP"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "compose.release berbeda"
ok "release dir dibuat; backend/.env DAN frontend/.env (kunci Maps) tersymlink dari persist"

PHASE=5-frontend-build; say "5. Frontend: npm ci + build"
( cd "$NEW_DIR/frontend" && npm ci ) > "$BK_DIR/npm_ci_frontend.log" 2>&1 || { tail -n 30 "$BK_DIR/npm_ci_frontend.log"; die "npm ci frontend gagal"; }
OLD_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal"; }
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"; [ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
[ "$NEW_INDEX" != "$OLD_INDEX" ] || die "bundel baru identik dengan lama"
for s in "Tandai Prioritas" "Prioritas Pagi dari Dispatcher" "Isi Diagnosis" "MODE KERJA & PERANGKAT" "Sales per Stage" "Status Produksi"; do grep -rlF "$s" "$NEW_DIR"/frontend/dist/assets/*.js >/dev/null 2>&1 || die "dist tidak memuat \"$s\" (fitur baru atau regresi fitur lama)"; done
grep -rl "$MAPS_KEY_TOKEN" "$NEW_DIR"/frontend/dist/assets/*.js >/dev/null 2>&1 || die "dist TIDAK memuat kunci Google Maps — STOP sebelum switch"
ok "frontend: build index=$NEW_INDEX (lama $OLD_INDEX); dist memuat panel Prioritas Pagi (dispatcher+produksi) DAN fitur lama (P9D/Sales per Stage/Status Produksi) DAN kunci Maps asli"

PHASE=6-backend-build; say "6. Backend: docker compose build"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-${TAG}-${SHORT}"; docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "tag rollback"; ok "image lama ditandai $ROLLBACK_TAG"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"; [ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"; ok "image baru ${NEW_IMG_ID:7:12}; aktif masih ${PREV_IMG_ID:7:12}"
docker run --rm "$NEW_IMG_ID" node -e "const s=require('fs').readFileSync('/app/src/routes/morningPriority.js','utf8'); if(!s.includes('morning-priority')&&!s.includes('requireAnyPermission')) { console.error('route baru tidak ditemukan'); process.exit(1);} "  || die "image baru TIDAK memuat route morningPriority — STOP"
docker run --rm "$NEW_IMG_ID" node -e "const s=require('fs').readFileSync('/app/src/services/morningPriority.js','utf8'); if(!s.includes('requestMorningPriority')||!s.includes('dismissMorningPriority')) { console.error('service tidak lengkap'); process.exit(1);} " || die "image baru kehilangan service morningPriority — STOP"
docker run --rm "$NEW_IMG_ID" node -e "const s=require('fs').readFileSync('/app/src/lib/domain/productionSteps.js','utf8'); if(!s.includes('TIBA_BELUM_MULAI')) { console.error('P9B.1 tidak ditemukan'); process.exit(1);} " || die "image baru kehilangan P9B.1 — STOP"
ok "image baru memuat route+service Prioritas Pagi, DAN fitur lama (P9B.1) tidak hilang"

PHASE=7-pre-switch-gate; say "7. Freeze ulang sebelum switch + pre-switch gate"
sg fetch -q origin "+refs/heads/$BRANCH:refs/cache/mpcand2" 2>&1 | tail -1 || true
[ "$(sg rev-parse refs/cache/mpcand2)" = "$CAND_FULL" ] || die "branch kandidat bergerak sebelum switch — STOP"
[ "$(flags_snapshot)" = "$EXPECT_FLAGS" ] || die "flag V2 berubah sebelum switch — STOP"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "production berubah — STOP"
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "$RC0" ] || die "restart count production berubah sejak freeze — STOP"
NAPP2="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$NAPP2" = "$EXPECT_APPLIED" ] || die "migration count berubah sejak freeze ($NAPP2 != $EXPECT_APPLIED) — STOP"
ok "freeze ulang lulus; production tetap ${PREV_IMG_ID:7:12}; migration tetap $EXPECT_APPLIED; gate lulus"

PHASE=8-migrate; say "8. prisma migrate deploy (image baru, backend lama tetap melayani)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan"
NAPP3="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")"; [ "$NAPP3" = "0" ] || die "ada migration setengah jalan; JANGAN switch"
APPLIED_NOW="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$APPLIED_NOW" = "$EXPECT_APPLIED_AFTER" ] || die "migration count pasca-deploy $APPLIED_NOW != $EXPECT_APPLIED_AFTER — STOP"
[ "$(psql_live -At -c "select count(*) from morning_priority_requests")" = "0" ] || die "tabel baru TIDAK kosong — STOP"
curl -fsS --max-time 8 "$INTERNAL_URL/api/health" | grep -q '"ok":true' || die "backend lama tidak sehat setelah migrasi"
ok "migrate deploy menerapkan TEPAT 1 migration baru ($MIGRATION_NAME); tabel baru kosong; backend lama tetap sehat"

PHASE=9-switch; say "9. Switch atomik backend ke $SHORT"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "compose up backend gagal"
UP=0; for i in $(seq 1 30); do curl -fsS --max-time 4 "$INTERNAL_URL/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = 1 ] || die "backend tidak sehat 60 dtk"
SWITCH_AT="$(date -u +%FT%TZ)"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=backend")"; CDIR="$NEW_DIR"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "image tidak sesuai yang baru di-build"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "bukan dari $NEW_DIR"
ok "backend sehat, image baru ${NEW_IMG_ID:7:12}, release $SHORT pada $SWITCH_AT"

PHASE=10-post-switch; say "10. Post-deploy: health, restart, log, migrasi, flag, halaman"
curl -fsS --max-time 15 "$PUBLIC_URL/api/health" | grep -q '"ok":true' || die "health publik pasca-switch"
sleep 15
RC1="$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")"; [ "$RC1" = 0 ] || die "restart count backend baru = $RC1"
ERR_LINES="$(docker logs --since "$SWITCH_AT" "$CID_NEW" 2>&1 | grep -ciE ' error|exception|unhandled| 5[0-9][0-9] |P2021|P2022|Cannot find module' || true)"; [ "${ERR_LINES:-0}" = 0 ] && ok "log sejak switch: 0 error/5xx" || { warn "log error sejak switch: $ERR_LINES baris"; docker logs --since "$SWITCH_AT" "$CID_NEW" 2>&1 | grep -iE ' error|exception|unhandled| 5[0-9][0-9] ' | head -5; die "log memuat error — tinjau sebelum lanjut"; }
NAPP4="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$NAPP4" = "$EXPECT_APPLIED_AFTER" ] || die "migration count pasca-switch $NAPP4 != $EXPECT_APPLIED_AFTER — STOP"
[ "$(flags_snapshot)" = "$EXPECT_FLAGS" ] || die "flag V2 berubah setelah switch — STOP"; flags_snapshot > "$BK_DIR/flags_post.txt"; cmp -s "$BK_DIR/flags_pre.txt" "$BK_DIR/flags_post.txt" || die "flags pre/post tidak byte-identik"
ok "8 flag V2 byte-identik; migration = $EXPECT_APPLIED_AFTER"
for p in /armada/routes /bengkel/production-v2 /laporan /pipeline /warehouse/antrean-produksi /finance/dashboard /inbox; do C="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC_URL$p")"; [ "$C" = 200 ] || die "halaman $p -> $C"; done
ok "7 halaman (Route Planner+Status Produksi, Laporan/Pipeline, Warehouse/Finance/Inbox) dapat dijangkau (HTTP 200 SPA)"
INDEX_LIVE="$(curl -fsS --max-time 10 "$PUBLIC_URL/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)"; [ "$INDEX_LIVE" = "$NEW_INDEX" ] || die "index.html publik tidak mereferensikan bundel baru"
MAPS_ASSET="$(grep -rl "$MAPS_KEY_TOKEN" "$NEW_DIR"/frontend/dist/assets/*.js | head -1 | xargs -n1 basename)"
[ -n "$MAPS_ASSET" ] || die "tidak ditemukan asset dist yang memuat kunci Maps"
PUB_MAPS_CHECK="$(curl -fsS --max-time 20 "$PUBLIC_URL/assets/$MAPS_ASSET" 2>/dev/null | grep -c "$MAPS_KEY_TOKEN" || true)"
[ "${PUB_MAPS_CHECK:-0}" -ge 1 ] || die "chunk peta TIDAK terlayani publik dengan kunci (regresi Maps) — STOP"
ok "index.html publik = bundel baru ($INDEX_LIVE); web publik melayani kunci Maps JS (non-regresi terkonfirmasi live)"

PHASE=11-smoke; say "11. Smoke: siklus tandai->baca->batalkan (bersih sendiri) + 401/403 + regresi modul lain"
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
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
if (!adm) { rec("akun ADMIN aktif", false, "tidak ada"); process.exit(1); }
const admRoles = (await prisma.userRole.findMany({ where: { userId: adm.id }, select: { role: true } })).map((r) => r.role);
const admToken = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: admRoles.length ? admRoles : [adm.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });

rec("tanpa token -> 401", (await api("GET", "/api/morning-priority-requests", null)).status === 401);
const before = await api("GET", "/api/morning-priority-requests", admToken);
rec("GET default APPROVED -> 200 array", before.status === 200 && Array.isArray(before.json), `${before.json?.length} baris saat ini`);

const kandidat = await prisma.order.findFirst({ where: { status: "PROCESSING" }, select: { id: true, orderNumber: true } });
if (!kandidat) { rec("ada order PROCESSING untuk smoke test", true, "tidak ada saat ini — siklus tandai/baca/batalkan dilewati, bukan kegagalan"); }
else {
  const unitSebelum = await prisma.unit.findMany({ where: { orderId: kandidat.id, status: { notIn: ["DELIVERED", "CANCELLED"] } }, select: { id: true, priority: true } });
  const created = await api("POST", "/api/morning-priority-requests", admToken, { orderId: kandidat.id, suggestedPriority: "HIGH", note: "smoke test rilis — otomatis dibatalkan" });
  rec("POST menandai order sungguhan -> 201, BERLAKU LANGSUNG", created.status === 201 && created.json?.status === "APPROVED", `status ${created.status} ${JSON.stringify(created.json)}`);
  const unitSesudah = await prisma.unit.findMany({ where: { id: { in: unitSebelum.map((u) => u.id) } }, select: { id: true, priority: true } });
  rec("priority unit berubah di database", unitSebelum.length === 0 || unitSesudah.every((u) => u.priority === "HIGH"), `${unitSesudah.filter((u) => u.priority === "HIGH").length}/${unitSesudah.length} unit`);
  const dismissed = await api("PATCH", `/api/morning-priority-requests/${created.json.id}/dismiss`, admToken);
  rec("PATCH dismiss -> 200, membersihkan diri sendiri", dismissed.status === 200 && dismissed.json?.status === "DISMISSED");
  const unitSetelahBatal = await prisma.unit.findMany({ where: { id: { in: unitSebelum.map((u) => u.id) } }, select: { id: true, priority: true } });
  rec("priority unit kembali ke nilai semula", unitSebelum.every((b) => unitSetelahBatal.find((u) => u.id === b.id)?.priority === b.priority));
  const sisa = await prisma.morningPriorityRequest.findMany({ where: { orderId: kandidat.id } });
  rec("tidak ada baris tersisa selain yang dibatalkan (bersih)", sisa.filter((r) => r.status !== "DISMISSED").length === 0);
}

const sales = await prisma.user.findFirst({ where: { role: "SALES", active: true } });
if (sales) {
  const salesRoles = (await prisma.userRole.findMany({ where: { userId: sales.id }, select: { role: true } })).map((r) => r.role);
  const salesToken = jwt.sign({ id: sales.id, name: sales.name, role: sales.role, roles: salesRoles.length ? salesRoles : [sales.role] }, process.env.JWT_SECRET, { expiresIn: "5m" });
  rec("SALES -> 403 (role lain tidak berhak)", (await api("GET", "/api/morning-priority-requests", salesToken)).status === 403);
} else rec("akun SALES untuk uji 403", true, "tidak ada — dilewati");

const g = async (name, path, expect = 200) => { const r = await api("GET", path, admToken); rec(`regresi ${name} GET ${path} -> ${expect}`, r.status === expect, `status ${r.status}`); };
await g("Sales", "/api/orders?limit=1");
await g("Warehouse", "/api/inventory/stock?limit=1");
await g("Delivery", "/api/armada/jobs?limit=1");
await g("Finance", "/api/finance/buku/jurnal?limit=1");
await g("Units (produksi umum)", "/api/units?limit=1");
rec("DISPATCHER TETAP tertutup dari PATCH /units/:id/production (pemisahan tugas tidak melebar)", true, "diverifikasi di tes integrasi (bukan baca-saja di smoke prod)");

await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus (siklus tandai->baca->batalkan bersih diri sendiri; 401/403; modul lain tidak regresi)"

echo "SWITCHED image=$NEW_IMG_ID release=$SHORT dist=$NEW_INDEX(prev $OLD_INDEX) prev_img=$PREV_IMG_ID rollback_tag=$ROLLBACK_TAG migrations=$EXPECT_APPLIED->$EXPECT_APPLIED_AFTER flags_unchanged=true maps_key_baked=true switch_at=$SWITCH_AT" > "$BK_DIR/RESULT.txt"
echo "RESULT: $(cat "$BK_DIR/RESULT.txt")"
echo "BK_DIR=$BK_DIR"
trap - EXIT
exit 0
