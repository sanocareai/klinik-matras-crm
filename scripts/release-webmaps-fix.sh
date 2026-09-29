#!/usr/bin/env bash
# Rilis MANUAL "frontend dist rebuild dengan VITE_GOOGLE_MAPS_JS_KEY terisi" (peta Live Tracking & Route
# Planner web menampilkan "Peta belum aktif" karena build dist sebelumnya tidak membawa kunci) ke produksi
# dengan workflow RELEASE-DIRECTORY (~/releases/klinik-matras/<sha8>). HANYA frontend/dist yang berubah;
# tidak ada perubahan source, backend, migration, atau data. Image backend LAMA dipakai ulang (tidak dibangun
# ulang) karena kode backend tidak berubah.
#
#   git show <sha>:scripts/release-webmaps-fix.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/rwm.sh && bash /tmp/rwm.sh <DEPLOY_SHA_LENGKAP> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rwm.sh <DEPLOY_SHA_LENGKAP>'
#
# Baseline produksi = fe438058 (branch feat/production-v2-ui-polish). DEPLOY_SHA = commit di branch yang sama
# yang HANYA menambah rebuild frontend/dist di atasnya.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
PROD_FULL="fe438058278c5bfb8606682bb60e835b4e54b489"     # commit produksi aktif = baseline
RELEASE_BRANCH="feat/production-v2-ui-polish"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MAPS_KEY_TOKEN="GezFdupuG1cWenKYxGbljSw_u7Mr0"  # potongan unik kunci Maps JS (bukan kunci penuh), dipakai smoke test membuktikan dist baru benar-benar membawanya

PREFLIGHT_ONLY=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/webmaps-${DEPLOY_SHORT}-${TS}"
PHASE="init"; PREV_DIR=""; PREV_COMMIT=""; NEW_INDEX=""; DIST_INDEX_OLD=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }

rollback_instructions() {
  cat <<EOF

────────────────────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────────────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>}  (commit ${PREV_COMMIT:-?}); TIDAK dihapus/ditimpa
Release baru       : ${NEW_DIR}

A. Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.
B. Setelah switch, kembali ke release sebelumnya (IMAGE TIDAK BERUBAH, jadi cukup arahkan ulang bind mount):
   cd ${PREV_DIR:-<release-sebelumnya>}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps backend
   curl -fsS ${INTERNAL_URL}/api/health
C. Rilis ini HANYA mengganti berkas statis frontend/dist; tidak ada migration/skema/data yang tersentuh.
──────────────────────────────────────────────────────────────────────────────────────────────────────────
EOF
}
cleanup() {
  local rc=$?
  if [ $rc -ne 0 ]; then
    printf '\n\033[31mRILIS BERHENTI (kode %s) pada fase: %s. Tidak ada rollback otomatis.\033[0m\n' "$rc" "$PHASE" >&2
    [ "$PREFLIGHT_ONLY" = "1" ] || rollback_instructions >&2
  fi
}
trap cleanup EXIT

# ── 0. Lingkungan ────────────────────────────────────────────────────────────────────────────────────────
PHASE="0-lingkungan"; say "0. Lingkungan"
for c in git docker curl grep flock sed; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
docker compose version >/dev/null 2>&1 || die "docker compose tidak tersedia"
exec 9>/tmp/release-webmaps.lock; flock -n 9 || die "rilis lain sedang berjalan (kunci /tmp/release-webmaps.lock)"
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
BAD_FILES="$(printf '%s\n' "$CHANGED" | grep -Ev '^(frontend/dist/.*|scripts/release-webmaps-fix\.sh)$' || true)"
[ -z "$BAD_FILES" ] || { printf '%s\n' "$BAD_FILES" | sed 's/^/        /'; die "ada berkas di luar frontend/dist dan skrip rilis"; }
printf '%s\n' "$CHANGED" | grep -Fx 'frontend/dist/index.html' >/dev/null || die "frontend/dist/index.html tidak berubah (rilis kosong?)"
ok "perubahan hanya di frontend/dist ($(printf '%s\n' "$CHANGED" | grep -c .) berkas) + skrip rilis"
[ -z "$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" -- backend frontend/src frontend/package.json frontend/package-lock.json backend/prisma docker-compose.yml docker-compose.release.yml)" ] || die "rilis menyentuh area terlarang (backend, source frontend, dependensi, schema, Docker)"
ok "backend, source frontend, dependensi, schema, Docker TIDAK berubah"
NEW_INDEX="$(sg show "${DEPLOY_SHA}:frontend/dist/index.html" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
[ -n "$NEW_INDEX" ] || die "tidak dapat membaca bundel index dari commit rilis"
sg show "${DEPLOY_SHA}:frontend/dist/assets/${NEW_INDEX}" >/dev/null 2>&1 || true
# Chunk mana yang membawa GOOGLE_MAPS_JS_KEY tidak stabil namanya antar-build (Rollup bisa menggabungkan/
# memisahkan modul googleMaps.js dan googleMapIcons.js tergantung graf dependensi saat itu) — jadi diperiksa
# dengan grep TOKEN di SELURUH berkas JS commit rilis, bukan glob nama chunk tertentu.
MAPS_CHUNK="$(sg ls-tree -r --name-only "$DEPLOY_SHA" -- frontend/dist/assets | grep -E '\.js$' | while read -r f; do sg show "${DEPLOY_SHA}:${f}" 2>/dev/null | grep -q "$MAPS_KEY_TOKEN" && { echo "$f"; break; }; done)"
[ -n "$MAPS_CHUNK" ] || die "TIDAK ADA berkas JS di commit rilis yang membawa kunci Maps JS (regresi yang sama akan terulang)"
ok "commit rilis memuat kunci Maps JS di ${MAPS_CHUNK##*/}"

# ── 2. Audit produksi (baca-saja) ────────────────────────────────────────────────────────────────────────
PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$PROD_FULL" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${PROD_FULL:0:8}; produksi bergeser sejak audit"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT} = baseline); image ${IMG_NAME} (${PREV_IMG_ID:7:12}) akan DIPAKAI ULANG"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
DIST_INDEX_OLD="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
[ "$PUB_BEFORE" = "$DIST_INDEX_OLD" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${DIST_INDEX_OLD})"
[ "$NEW_INDEX" != "$DIST_INDEX_OLD" ] || die "bundel baru identik dengan lama (tidak diharapkan)"
ok "health sehat; bundel publik saat ini ${DIST_INDEX_OLD} (akan berubah ke ${NEW_INDEX})"
if grep -rlq "$MAPS_KEY_TOKEN" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null; then
  die "dist LAMA sudah membawa kunci — regresi yang dikira sedang diperbaiki mungkin sudah tidak ada; audit ulang sebelum lanjut"
fi
ok "dist lama dikonfirmasi TIDAK membawa kunci Maps JS di berkas mana pun (regresi nyata, rilis ini relevan)"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; exit 0; fi

# ── 3. Release dir ───────────────────────────────────────────────────────────────────────────────────────
PHASE="3-release-dir"; say "3. Release dir ${NEW_DIR} (git archive SHA rilis; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${RELEASE_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "branch rilis berubah sejak audit"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sejak audit"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" || die "git archive gagal"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile frontend/dist/index.html; do [ -e "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
grep -rlq "$MAPS_KEY_TOKEN" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null || die "dist di release dir baru tidak membawa kunci (git archive rusak?)"
ok "release dir dibuat dari git archive; docker-compose identik; dist baru membawa kunci Maps JS"

# ── 4. Migration (harus no-op; image lama dipakai ulang) ──────────────────────────────────────────────────
PHASE="4-migrate"; say "4. prisma migrate deploy (image LAMA dipakai ulang; HARUS no-op)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend lama TIDAK diganggu"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah cek migrasi"
ok "migrate deploy no-op (tidak ada perubahan schema di rilis ini); backend lama tetap sehat"

# ── 5. Switch ────────────────────────────────────────────────────────────────────────────────────────────
PHASE="5-switch"; say "5. Switch backend ke release baru (IMAGE SAMA — ${PREV_IMG_ID:7:12}; hanya bind mount frontend/dist berubah)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 30); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 60 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$PREV_IMG_ID" ] || die "image berubah (seharusnya identik — dipakai ulang)"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat, image tetap ${PREV_IMG_ID:7:12}, release ${DEPLOY_SHORT}"

# ── 6. Healthcheck + smoke (BACA-SAJA) ──────────────────────────────────────────────────────────────────
PHASE="6-healthcheck"; say "6. Healthcheck dan smoke (baca-saja)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal gagal"; ok "internal 200"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru (${NEW_INDEX})"; ok "bundel web publik = ${NEW_INDEX} (dist baru)"
PUB_MAPS_CHUNK="$(basename "$MAPS_CHUNK")"
curl -fsS --max-time 20 "${PUBLIC_URL}/assets/${PUB_MAPS_CHUNK}" | grep -q "$MAPS_KEY_TOKEN" || die "chunk peta TIDAK terlayani publik dengan kunci (masih regresi)"
ok "web publik melayani chunk peta (${PUB_MAPS_CHUNK}) DENGAN kunci Maps JS — perbaikan terkonfirmasi live"

# ── 7. Log ───────────────────────────────────────────────────────────────────────────────────────────────
PHASE="7-log"; say "7. Log backend sejak switch"
LOGS="$(dcp "$NEW_DIR" logs --since 3m --no-color backend </dev/null 2>&1 | cut -c1-240 || true)"
FATAL="$(printf '%s\n' "$LOGS" | grep -Ei 'P2021|P2022|does not exist|PrismaClientInitializationError|Cannot find module|EADDRINUSE' || true)"
[ -z "$FATAL" ] || { printf '%s\n' "$FATAL" | sed -n 1,10p; die "log backend memuat error skema/inisialisasi"; }
ok "log bersih dari error skema/inisialisasi"

PHASE="8-selesai"; say "8. Ringkasan"
dcp "$NEW_DIR" ps </dev/null
cat <<EOF

RILIS PERBAIKAN PETA WEB SELESAI (frontend dist saja, image backend dipakai ulang, tanpa migration/data).
  release aktif : ${NEW_DIR}  (commit ${DEPLOY_SHA})
  release lama  : ${PREV_DIR}  (commit ${PREV_COMMIT}; tidak dihapus)
  log           : ${BK_DIR}
EOF
trap - EXIT
exit 0
