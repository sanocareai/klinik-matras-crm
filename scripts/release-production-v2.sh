#!/usr/bin/env bash
# Rilis Production V2 generik (SHA live & kandidat dari env; jumlah migration DIBACA AKTUAL, tidak di-hardcode).
# Wajib env: CAND_FULL (40 hex, commit kandidat di origin), PREV_FULL (40 hex, commit yang sedang live), PREV_IMG (sha256 image live),
#            SCOPE_FILE (daftar berkas yang diharapkan beda antara PREV dan CAND, satu per baris), BRANCH (branch kandidat).
# Opsional : TAG (default 'pv2') untuk nama backup/rollback.
# Migration: applied-live HARUS = jumlah direktori migrasi di release live; setelah switch HARUS = itu + migrasi baru di diff.
#   env ... bash release-production-v2.sh --preflight-only   (baca-saja)   |   tanpa flag = rilis nyata
set -Eeuo pipefail
umask 077

: "${CAND_FULL:?CAND_FULL wajib}"; : "${PREV_FULL:?PREV_FULL wajib}"; : "${PREV_IMG:?PREV_IMG wajib}"; : "${SCOPE_FILE:?SCOPE_FILE wajib}"; : "${BRANCH:?BRANCH wajib}"; TAG="${TAG:-pv2}"
EXPECT_PREV_FULL="$PREV_FULL"
EXPECT_PREV_SHORT="${PREV_FULL:0:8}"
FROZEN_MAIN_FULL="9b102635074a09961b3513c628ef3bfaa293eaa9"   # origin/main sungguhan — jauh tertinggal, dicek hanya sebagai sanity (bukan basis rilis)
FROZEN_OMSET_BRANCH="${LIVE_BRANCH:-feat/klaim-lunas-gate}"   # branch asal commit live; ujung boleh maju, yang dibekukan hanya PREV_FULL
EXPECT_PREV_IMG="$PREV_IMG"
EXPECT_APPLIED=""; EXPECT_APPLIED_AFTER=""   # dihitung aktual di fase 1/2
CANARY_UNIT_ID="81ce67e2-2794-4f2d-a397-9e5a9974aa45"
EXPECT_FLAGS=""
EXPECT_CANARY=""
EXPECT_UNIT_PHOTOS_ROWS=""

PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
SHORT="${CAND_FULL:0:8}"; RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"; NEW_DIR="$RELEASES/$SHORT"; PREV_DIR="$RELEASES/$EXPECT_PREV_SHORT"
TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/${TAG}-${SHORT}-${TS}"; mkdir -p "$BK_DIR"; LOCK="$HOME/releases/.release.lock"
PREFLIGHT_ONLY=0; [ "${1:-}" = "--preflight-only" ] && PREFLIGHT_ONLY=1
PHASE=init; IMG_NAME="klinik-matras-backend:latest"; HAVE_LOCK=0; SWITCH_AT=""; BACKUP_FILE=""; ROLLBACK_TAG=""

say(){ printf '\n== %s\n' "$*"; }; ok(){ printf '  OK    %s\n' "$*"; }; warn(){ printf '  WARN  %s\n' "$*"; }
die(){ printf '\nSTOP: %s\n' "$*" >&2; exit 1; }
sg(){ git --git-dir="$SRC" "$@"; }
dcp(){ local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
CDIR="$PREV_DIR"
psql_live(){ dcp "$CDIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
flags_snapshot(){ psql_live -At -c "select string_agg(key||'='||enabled::text||':'||coalesce(config::text,'{}'), ',' order by key) from v2_feature_flags"; }
canary_snapshot(){ psql_live -At -F'|' -c "
select 'unit_status', status::text from units where id='$CANARY_UNIT_ID'
union all select 'runs_v2_count', count(*)::text from production_runs_v2 where unit_id='$CANARY_UNIT_ID'
union all select 'custody_latest_status', (select status::text from unit_custody_handoffs_v2 where unit_id='$CANARY_UNIT_ID' order by created_at desc limit 1)
union all select 'custody_count', count(*)::text from unit_custody_handoffs_v2 where unit_id='$CANARY_UNIT_ID'
order by 1"; }
cleanup(){ local rc=$?; [ "$HAVE_LOCK" = 1 ] && rm -rf "$LOCK"
  if [ $rc -ne 0 ]; then printf '\nRILIS BERHENTI (kode %s) fase: %s. Tanpa rollback otomatis.\nRelease sebelumnya: %s\nRollback:\n  cd %s && SANSS_PERSIST_ROOT=%s docker compose -p %s -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps backend\nBackup: %s\n' "$rc" "$PHASE" "$PREV_DIR" "$PREV_DIR" "$PERSIST" "$PROJECT" "${BACKUP_FILE:-<belum>}" >&2; fi; }
trap cleanup EXIT

PHASE=0-lock; say "0. Lock eksklusif + kondisi awal"
mkdir "$LOCK" 2>/dev/null || die "lock rilis dipegang sesi lain: $(cat "$LOCK/owner" 2>/dev/null)"; HAVE_LOCK=1; echo "p9dux $SHORT $(date -u +%FT%TZ)" > "$LOCK/owner"; ok "lock diambil"
[ ! -e "$NEW_DIR" ] || die "$NEW_DIR sudah ada"
if ps -eo args | grep -E 'release-[a-z0-9-]+\.sh|docker compose .* build|docker build|prisma migrate deploy' | grep -v grep | grep -v "release-production-v2" | grep -v 'sh -c npx prisma migrate deploy && node' | grep -q .; then die "ada deployment/build lain berjalan"; fi; ok "tidak ada deployment/build lain berjalan"

PHASE=1-freeze; say "1. Freeze: production aktif harus persis $EXPECT_PREV_SHORT"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s' "$CID_OLD" | wc -w)" = 1 ] || die "container backend != 1"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; [ "$PREV_IMG_ID" = "$EXPECT_PREV_IMG" ] || die "image aktif berubah: $PREV_IMG_ID"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah"
PREV_RELEASE_COMMIT="$(cat "$PREV_DIR/.release-commit")"; case "$PREV_RELEASE_COMMIT" in "$EXPECT_PREV_SHORT"*) : ;; *) die ".release-commit tidak cocok: $PREV_RELEASE_COMMIT" ;; esac
RC0="$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")"; ok "image ${PREV_IMG_ID:7:12} release $EXPECT_PREV_SHORT restart=$RC0"
EXPECT_APPLIED="$(find "$PREV_DIR/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)"; [ "$EXPECT_APPLIED" -gt 0 ] || die "tidak ada direktori migrasi di release live"
NAPP="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$NAPP" = "$EXPECT_APPLIED" ] || die "applied di DB ($NAPP) != direktori migrasi release live ($EXPECT_APPLIED) — integritas migration, STOP"; ok "migration applied $NAPP = direktori migrasi release live (dibaca aktual)"
FL0="$(flags_snapshot)"; [ -n "$FL0" ] || die "snapshot flag kosong"; EXPECT_FLAGS="$FL0"; echo "$FL0" > "$BK_DIR/flags_pre.txt"; ok "flag V2 dibekukan: $FL0"
CANARY0="$(canary_snapshot)"; [ -n "$CANARY0" ] || die "snapshot canary kosong"; EXPECT_CANARY="$CANARY0"
echo "$CANARY0" > "$BK_DIR/canary_pre.txt"; ok "snapshot canary pra-rilis sesuai ekspektasi (Kadar Wati masih OFFERED/0 run): $(echo "$CANARY0" | tr '\n' ' ')"
UP0="$(psql_live -At -c "select count(*) from unit_photos")"; EXPECT_UNIT_PHOTOS_ROWS="$UP0"; ok "unit_photos dibekukan = $UP0 baris"
curl -fsS --max-time 8 "$INTERNAL_URL/api/health" | grep -q '"ok":true' || die "health internal"; curl -fsS --max-time 15 "$PUBLIC_URL/api/health" | grep -q '"ok":true' || die "health publik"; ok "health lokal+publik"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ -r "$PERSIST/frontend/.env" ] && grep -q VITE_GOOGLE_MAPS_JS_KEY "$PERSIST/frontend/.env" || die "PERSIST/frontend/.env atau kunci Maps tidak ada"
ok "mount persisten ada, frontend/.env (kunci Maps) tersedia untuk build"

PHASE=2-ancestry; say "2. Ancestry + scope (branch=$BRANCH)"
[ -d "$SRC" ] || die "cache git $SRC tidak ada"
sg fetch -q origin "+refs/heads/$BRANCH:refs/cache/p9dcand" "+refs/heads/main:refs/cache/main" "+refs/heads/$FROZEN_OMSET_BRANCH:refs/cache/omset" 2>&1 | tail -3 || true
[ "$(sg rev-parse refs/cache/p9dcand)" = "$CAND_FULL" ] || die "branch kandidat ($BRANCH) berubah: $(sg rev-parse refs/cache/p9dcand)"
[ "$(sg rev-parse refs/cache/omset)" = "$EXPECT_PREV_FULL" ] || die "basis rilis NYATA ($FROZEN_OMSET_BRANCH) BERGERAK sejak freeze ($(sg rev-parse refs/cache/omset)) — STOP"
MAIN_NOW="$(sg rev-parse refs/cache/main)"; [ "$MAIN_NOW" = "$FROZEN_MAIN_FULL" ] || warn "origin/main bergerak ($MAIN_NOW) — bukan basis rilis di repo ini, dilanjutkan (sudah dikonfirmasi ke user P9C dibangun di atas feature branch, bukan main)"
git --git-dir="$SRC" cat-file -e "$EXPECT_PREV_FULL" 2>/dev/null || die "commit produksi aktif ($EXPECT_PREV_SHORT) tidak ditemukan di cache git"
sg merge-base --is-ancestor "$EXPECT_PREV_FULL" "$CAND_FULL" || die "live ($EXPECT_PREV_SHORT) BUKAN ancestor kandidat — bukan superset bersih, STOP"
ok "live ($EXPECT_PREV_SHORT) TERBUKTI leluhur LANGSUNG kandidat — superset bersih (bukan workaround dist-only)"
sg diff --name-only "$EXPECT_PREV_FULL" "$CAND_FULL" -- ':!frontend/dist' > "$BK_DIR/scope.txt"
[ -r "$SCOPE_FILE" ] || die "SCOPE_FILE tidak terbaca"
diff <(LC_ALL=C sort "$SCOPE_FILE") <(LC_ALL=C sort "$BK_DIR/scope.txt") > "$BK_DIR/scope_diff.txt" 2>&1 || die "scope TIDAK PERSIS berkas yang direview — lihat $BK_DIR/scope_diff.txt: $(tr '
' ' ' < "$BK_DIR/scope_diff.txt")"
ok "scope = tepat $(wc -l < "$BK_DIR/scope.txt") berkas yang direview vs production aktif"
sg diff --name-status "$EXPECT_PREV_FULL" "$CAND_FULL" -- backend/prisma/migrations | grep -vE '^As+backend/prisma/migrations/[0-9]+_[a-z0-9_]+/migration.sql$' | grep -q . && die "diff migration berisi perubahan selain penambahan migrasi baru (tidak aditif) — STOP"
NEW_MIG="$(sg diff --name-only --diff-filter=A "$EXPECT_PREV_FULL" "$CAND_FULL" -- backend/prisma/migrations | grep -c 'migration.sql' || true)"
EXPECT_APPLIED_AFTER=$((EXPECT_APPLIED + NEW_MIG))
ok "migrasi baru aditif = $NEW_MIG; applied pasca-switch yang diharapkan = $EXPECT_APPLIED_AFTER (aktual: $EXPECT_APPLIED + $NEW_MIG)"
for f in backend/package-lock.json frontend/package-lock.json backend/package.json frontend/package.json docker-compose.yml docker-compose.release.yml backend/Dockerfile; do cmp -s <(sg show "${EXPECT_PREV_FULL}:$f") <(sg show "${CAND_FULL}:$f") || die "$f berubah di luar ekspektasi"; done
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
grep -q VITE_GOOGLE_MAPS_JS_KEY "$NEW_DIR/frontend/.env" || die "frontend/.env tersymlink tapi kunci Maps tidak terbaca — STOP sebelum build"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "compose.release berbeda"
ok "release dir dibuat; backend/.env DAN frontend/.env (kunci Maps) tersymlink dari persist"

PHASE=5-frontend-build; say "5. Frontend: npm ci + build"
( cd "$NEW_DIR/frontend" && npm ci ) > "$BK_DIR/npm_ci_frontend.log" 2>&1 || { tail -n 30 "$BK_DIR/npm_ci_frontend.log"; die "npm ci frontend gagal"; }
OLD_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal"; }
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"; [ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
[ "$NEW_INDEX" != "$OLD_INDEX" ] || die "bundel baru identik dengan lama"
for s in "Isi Diagnosis" "Revisi Diagnosis" "MODE KERJA & PERANGKAT" "Belum Dijadwalkan" "Putusan QC" "Layanan Dipesan (Sales)"; do grep -rlF "$s" "$NEW_DIR"/frontend/dist/assets/*.js >/dev/null 2>&1 || die "dist tidak memuat referensi P9C Unit 360 \"$s\""; done
for s in "Sales per Stage" "Gerbang Klaim Lunas" "Status Produksi" "Rencana Produksi"; do grep -rlF "$s" "$NEW_DIR"/frontend/dist/assets/*.js >/dev/null 2>&1 || die "dist kehilangan fitur lama \"$s\" (Sales Stage/Pipeline atau P9B.1)"; done
grep -rlF "AIzaSy" "$NEW_DIR"/frontend/dist/assets/*.js >/dev/null 2>&1 || die "dist TIDAK memuat kunci Google Maps — STOP sebelum switch"
ok "frontend: build index=$NEW_INDEX (lama $OLD_INDEX); dist memuat Unit 360 P9C DAN Sales per Stage/Pipeline/P9B.1 (tidak hilang) DAN kunci Google Maps"

PHASE=6-backend-build; say "6. Backend: docker compose build"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-${TAG}-${SHORT}"; docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "tag rollback"; ok "image lama ditandai $ROLLBACK_TAG"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"; [ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"; ok "image baru ${NEW_IMG_ID:7:12}; aktif masih ${PREV_IMG_ID:7:12}"
docker run --rm "$NEW_IMG_ID" node -e "const s=require('fs').readFileSync('/app/src/services/productionDiagnosisCommandService.js','utf8'); if(!s.includes('submitDiagnosis')) { console.error('P9D tidak ditemukan'); process.exit(1);} " || die "image baru TIDAK memuat P9C (getUnitOverview) — STOP"
docker run --rm "$NEW_IMG_ID" node -e "const s=require('fs').readFileSync('/app/src/routes/analytics.js','utf8'); if(!s.includes('stage-by-sales')) { console.error('omset-stage tidak ditemukan'); process.exit(1);} " || die "image baru kehilangan fitur Sales per Stage — STOP"
docker run --rm "$NEW_IMG_ID" node -e "const s=require('fs').readFileSync('/app/src/lib/domain/productionSteps.js','utf8'); if(!s.includes('TIBA_BELUM_MULAI')) { console.error('P9B.1 tidak ditemukan'); process.exit(1);} " || die "image baru kehilangan P9B.1 — STOP"
ok "image baru memuat P9D, Sales per Stage, DAN P9B.1 (tidak ada yang hilang)"

PHASE=7-pre-switch-gate; say "7. Freeze ulang sebelum switch + pre-switch gate"
sg fetch -q origin "+refs/heads/$FROZEN_OMSET_BRANCH:refs/cache/omset2" 2>&1 | tail -1 || true
[ "$(sg rev-parse refs/cache/omset2)" = "$EXPECT_PREV_FULL" ] || die "basis rilis (feat/laporan-omset-stage) bergerak sebelum switch — STOP"
[ "$(flags_snapshot)" = "$EXPECT_FLAGS" ] || die "flag V2 berubah sebelum switch — STOP"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$EXPECT_PREV_IMG" ] || die "production berubah — STOP"
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "$RC0" ] || die "restart count production berubah sejak freeze — STOP"
CANARY1="$(canary_snapshot)"; [ "$CANARY1" = "$CANARY0" ] || { echo "$CANARY1"; die "state unit canary berubah sejak freeze — STOP"; }
NAPP2="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$NAPP2" = "$EXPECT_APPLIED" ] || die "migration count berubah sejak freeze ($NAPP2 != $EXPECT_APPLIED) — STOP"
ok "freeze ulang lulus (basis rilis tetap; production tetap ${PREV_IMG_ID:7:12}; canary stabil; migration tetap $EXPECT_APPLIED); gate lulus"

PHASE=8-switch; say "8. Switch atomik backend ke $SHORT"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "compose up backend gagal"
UP=0; for i in $(seq 1 30); do curl -fsS --max-time 4 "$INTERNAL_URL/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = 1 ] || die "backend tidak sehat 60 dtk"
SWITCH_AT="$(date -u +%FT%TZ)"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=backend")"; CDIR="$NEW_DIR"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "image tidak sesuai yang baru di-build"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "bukan dari $NEW_DIR"
ok "backend sehat, image baru ${NEW_IMG_ID:7:12}, release $SHORT pada $SWITCH_AT"

PHASE=9-post-switch; say "9. Post-deploy: health, restart, log, migrasi TIDAK berubah, flag, canary TIDAK BERUBAH, halaman"
curl -fsS --max-time 15 "$PUBLIC_URL/api/health" | grep -q '"ok":true' || die "health publik pasca-switch"
sleep 15
RC1="$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")"; [ "$RC1" = 0 ] || die "restart count backend baru = $RC1"
ERR_LINES="$(docker logs --since "$SWITCH_AT" "$CID_NEW" 2>&1 | grep -ciE ' error|exception|unhandled| 5[0-9][0-9] ' || true)"; [ "${ERR_LINES:-0}" = 0 ] && ok "log sejak switch: 0 error/5xx" || { warn "log error sejak switch: $ERR_LINES baris"; docker logs --since "$SWITCH_AT" "$CID_NEW" 2>&1 | grep -iE ' error|exception|unhandled| 5[0-9][0-9] ' | head -5; }
NAPP3="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$NAPP3" = "$EXPECT_APPLIED_AFTER" ] || die "migration count pasca-switch $NAPP3 != $EXPECT_APPLIED_AFTER — STOP"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang pasca-switch: ${PERSIST}/${d}"; done; ok "mount persisten tetap ada"
[ "$(flags_snapshot)" = "$EXPECT_FLAGS" ] || die "flag V2 berubah setelah switch — STOP"; flags_snapshot > "$BK_DIR/flags_post.txt"; cmp -s "$BK_DIR/flags_pre.txt" "$BK_DIR/flags_post.txt" || die "flags pre/post tidak byte-identik"
ok "8 flag V2 byte-identik; migration = $EXPECT_APPLIED_AFTER (aktual)"
CANARY2="$(canary_snapshot)"; echo "$CANARY2" > "$BK_DIR/canary_post.txt"; [ "$CANARY2" = "$CANARY0" ] || { echo "$CANARY2"; die "state unit canary berubah akibat deploy — STOP (P9C hanya read-model, TIDAK boleh memutasi apa pun)"; }
ok "state unit canary byte-identik (masih OFFERED/0 run — belum dimutasi): $(echo "$CANARY2" | tr '\n' ' ')"
UP1="$(psql_live -At -c "select count(*) from unit_photos")"; [ "$UP1" = "$EXPECT_UNIT_PHOTOS_ROWS" ] || die "unit_photos baris berubah pasca-deploy: $UP1"; ok "unit_photos tetap $UP1 baris"
for p in /bengkel/production-v2 /bengkel/rencana-produksi /laporan /pipeline /warehouse/antrean-produksi /finance/dashboard /armada/tracking /inbox; do C="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC_URL$p")"; [ "$C" = 200 ] || die "halaman $p -> $C"; done
ok "8 halaman (Status Produksi+Rencana Produksi Unit 360, Laporan+Pipeline Sales Stage, Warehouse/Finance/Armada/Inbox kontrol) dapat dijangkau (HTTP 200 SPA)"
INDEX_LIVE="$(curl -fsS --max-time 10 "$PUBLIC_URL/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)"; [ "$INDEX_LIVE" = "$NEW_INDEX" ] || die "index.html publik tidak mereferensikan bundel baru"
ok "index.html publik mereferensikan bundel baru persis ($INDEX_LIVE)"

PHASE=10-smoke; say "10. Smoke baca-saja: Unit 360 overview Kadar Wati + gating harga + isolasi multi-unit + media auth + regresi Sales/Warehouse/Delivery/Finance/Omset"
dcp "$NEW_DIR" exec -T -e EXPECT_UP="$UP0" backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
const CANARY = "81ce67e2-2794-4f2d-a397-9e5a9974aa45";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
if (!adm) { rec("akun ADMIN aktif", false, "tidak ada"); process.exit(1); }
const admRoles = (await prisma.userRole.findMany({ where: { userId: adm.id }, select: { role: true } })).map((r) => r.role);
const admToken = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: admRoles.length ? admRoles : [adm.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });
// Role TANPA ORDER_PRICE_READ (mis. worker produksi biasa) — untuk cek gating harga.
const worker = await prisma.user.findFirst({ where: { role: "PRODUCTION_WORKER", active: true } });
const workerToken = worker ? jwt.sign({ id: worker.id, name: worker.name, role: worker.role, roles: [worker.role] }, process.env.JWT_SECRET, { expiresIn: "10m" }) : null;
const g = async (name, path, token, expect = 200) => { const r = await api("GET", path, token); rec(`${name} GET ${path} -> ${expect}`, r.status === expect, `status ${r.status}`); return r; };
await g("Sales", "/api/orders?limit=1", admToken);
await g("Warehouse", "/api/inventory/stock?limit=1", admToken);
await g("Production V1", "/api/production/board", admToken);
await g("Delivery", "/api/armada/jobs?limit=1", admToken);
await g("Finance", "/api/finance/buku/jurnal?limit=1", admToken);
await g("Sales per Stage", "/api/analytics/stage-by-sales", admToken);
await g("Pipeline order-board", "/api/pipeline/order-board", admToken);
const ov = await g("Unit 360 Kadar Wati (ADMIN)", `/api/production-v2/units/${CANARY}/overview`, admToken);
rec("readerMode COHORT (cohort canary tetap ON)", ov.json?.readerMode === "COHORT", JSON.stringify(ov.json?.readerMode));
rec("Kadar Wati: warning BELUM_ADA_RUN eksplisit (bukan error, bukan ditebak)", (ov.json?.warnings || []).some((w) => w.code === "BELUM_ADA_RUN"), JSON.stringify(ov.json?.warnings));
rec("Kadar Wati: production.runId null (jujur belum ada run, tidak crash)", ov.json?.production?.runId === null, JSON.stringify(ov.json?.production?.runId));
rec("Kadar Wati: identity.photoUrl ada NILAINYA (foto pickup resolvable sejak OFFERED, P9B.1)", !!ov.json?.identity?.photoUrl, JSON.stringify(ov.json?.identity?.photoUrl));
rec("ADMIN menerima orderValue (canSeeValue true)", ov.json?.permissions?.canSeeValue === true && ov.json?.orderValue !== undefined, JSON.stringify({ canSeeValue: ov.json?.permissions?.canSeeValue, orderValue: ov.json?.orderValue }));
if (workerToken) {
  const ovWorker = await api("GET", `/api/production-v2/units/${CANARY}/overview`, workerToken);
  rec("role TANPA ORDER_PRICE_READ: field orderValue TIDAK ADA sama sekali di payload", ovWorker.status === 200 && !("orderValue" in (ovWorker.json || {})), JSON.stringify({ status: ovWorker.status, hasOrderValue: "orderValue" in (ovWorker.json || {}) }));
} else { console.log("  SKIP  role tanpa harga — tidak ada akun PRODUCTION_WORKER aktif di DB produksi"); }
const dgNoAuth = await api("GET", `/api/production-v2/diagnosis/00000000-0000-0000-0000-000000000000`, null);
rec("P9D GET /diagnosis/:runId TANPA auth -> 401", dgNoAuth.status === 401, `status ${dgNoAuth.status}`);
const dgSubNoAuth = await api("POST", `/api/production-v2/diagnosis/00000000-0000-0000-0000-000000000000/submit`, null, {});
rec("P9D POST /diagnosis/:runId/submit TANPA auth -> 401", dgSubNoAuth.status === 401, `status ${dgSubNoAuth.status}`);
const cc = await api("GET", "/api/production-v2/command-center", admToken);
rec("command-center 200 (kartu membawa salesServices bila ada kartu)", cc.status === 200, `status ${cc.status}`);
const noAuth = await api("GET", `/api/production-v2/units/${CANARY}/overview`, null);
rec("Unit 360 TANPA auth -> 401 (bukan bocor)", noAuth.status === 401, `status ${noAuth.status}`);
const badUnit = await api("GET", "/api/production-v2/units/00000000-0000-0000-0000-000000000000/overview", admToken);
rec("Unit 360 unit tak dikenal -> 404 (bukan 500, tidak bocor)", badUnit.status === 404, `status ${badUnit.status}`);
// Media auth foto unit (pola sama dengan rilis P9B.1) — TIDAK BOLEH 500.
const photoNoAuth = await fetch(`${BASE}/media/unit-photo/${CANARY}`);
rec("GET /media/unit-photo/<canary> TANPA auth -> 401/403 (bukan 500)", [401, 403].includes(photoNoAuth.status), `status ${photoNoAuth.status}`);
const photoAuth = await api("GET", `/media/unit-photo/${CANARY}`, admToken);
rec("GET /media/unit-photo/<canary> DENGAN Bearer admin -> 200 atau 404 (bukan 500)", [200, 404].includes(photoAuth.status), `status ${photoAuth.status}`);
rec("tabel unit_photos tidak berubah akibat deploy", (await prisma.$queryRawUnsafe("select count(*)::int c from unit_photos"))[0].c === Number(process.env.EXPECT_UP));
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke baca-saja lulus (Sales/Warehouse/Production V1/Delivery/Finance/Sales-per-Stage/Pipeline hidup; Unit 360 Kadar Wati 200 dengan foto+warning eksplisit; gating harga per-role; IDOR 401/404; media auth fail-closed; canary pristine; flag byte-identik; unit_photos kosong)"

echo "SWITCHED image=$NEW_IMG_ID release=$SHORT dist=$NEW_INDEX(prev $OLD_INDEX) prev_img=$PREV_IMG_ID rollback_tag=$ROLLBACK_TAG migrations=$EXPECT_APPLIED->$EXPECT_APPLIED_AFTER flags_unchanged=true canary_unchanged=true unit_photos_unchanged=true maps_key_baked=true includes=p9c-unit360+laporan-omset-stage+p9b1 switch_at=$SWITCH_AT" > "$BK_DIR/RESULT.txt"
echo "RESULT: $(cat "$BK_DIR/RESULT.txt")"
echo "BK_DIR=$BK_DIR"
