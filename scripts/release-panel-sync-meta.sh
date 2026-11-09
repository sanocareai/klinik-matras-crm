#!/usr/bin/env bash
# RILIS PANEL SYNC META (psm1) - backend + frontend, TANPA migrasi, TANPA data, .env TIDAK diubah. FAIL-CLOSED.
#   Isi: /referensi mengikuti keadaan Composio (ganti teks usang "MARKETING_API belum dikonfigurasi"), unmapped run = Ad unik,
#        panel Kesehatan & referensi: waktu WIB seragam, tanggal ramah, status & sumber berlabel.
#   Diturunkan dari release-composio-galat.sh (gerbang backend) + release-marketing-apple.sh (build dist, aset lama).
#   tr -d '\r' < scripts/release-panel-sync-meta.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/psm1.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/psm1.bundle bash /tmp/psm1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ... --build-only   : + release dir sementara, build dist, semua gerbang dist; release dir sementara dihapus; TANPA image/switch
#   ... (tanpa flag)   : rilis penuh
#   ... --rollback     : release aktif harus kandidat; image rollback ditandai ulang lalu backend dibuat ulang dari folder baseline
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
MODE=release
for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --build-only) MODE=buildonly;; --rollback) MODE=rollback;; esac; done
CAND_BRANCH="${CAND_BRANCH:-fix/panel-sync-meta-on-5200dede}"
ALLOWED_RE='^(backend/src/routes/attributionAds\.js|backend/src/services/attribution/composioMeta\.js|backend/src/services/attribution/composioMetaSync\.js|backend/tests/composioMeta\.test\.js|backend/tests/integration/composioMetaSync\.integration\.test\.js|frontend/src/features/laporan/components/marketing/KesehatanReferensi\.jsx|frontend/src/features/laporan/components/marketing/StatusSinkronMeta\.jsx|frontend/src/features/laporan/sinkronMetaLogic\.js|frontend/tests/sinkronMetaLogic\.test\.js|scripts/release-panel-sync-meta\.sh)$'
BACKEND_SRC_EXPECT="backend/src/routes/attributionAds.js backend/src/services/attribution/composioMeta.js backend/src/services/attribution/composioMetaSync.js"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; BASE_SHORT="${BASE_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MIN_FREE_KB=$(( 5 * 1024 * 1024 ))
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/panel-sync-meta-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; SWITCHED=0
# Teks baru (hanya dist baru) dan teks yang wajib tetap ada (dist aktif DAN baru). Dicari dengan find|xargs, BUKAN glob (>21.000 chunk).
BARU_JS=("Sinkron otomatis (Composio)" "Ad belum terpetakan (unik)" "Uji coba (tanpa simpan)")
TETAP_JS=("Sinkronisasi spend Meta" "Kesehatan capture touch" "Referensi pemetaan" "Kelola biaya iklan" "Tren lead harian" "Kesehatan & referensi" "Cari halaman atau menu" "Pantau pesanan pembelian (PO) ke supplier")

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  \033[33mPERHATIAN\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
bebas_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
cek_disk() { [ "$(bebas_kb)" -ge "$MIN_FREE_KB" ] || die "disk bebas < 5 GiB ($1)"; ok "disk bebas $(( $(bebas_kb) / 1024 )) MiB >= 5 GiB ($1)"; }
cari_dist() { find "$1/frontend/dist/assets" -maxdepth 1 -type f -name "*.$2" -print0 2>/dev/null | xargs -0 grep -lF -- "$3" 2>/dev/null | sed -n 1p; }

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa)
Image sebelumnya   : ${ROLLBACK_TAG:-<belum ditandai>}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}
$( [ "$SWITCHED" = 1 ] && echo "Switch SUDAH terjadi. Rollback: bash /tmp/psm1.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback" || echo "Berhenti SEBELUM switch -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya." )
Manual (setara --rollback):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Rilis ini tanpa migrasi dan tanpa tulis data: rollback kode tidak membutuhkan pemulihan database.
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy (mode ${MODE})"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm find xargs; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  [ "$lf" = "/tmp/release-panel-sync-meta.lock" ] && continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-panel-sync-meta.lock; flock -n 9 || die "rilis ini sudah berjalan"
tidak_ada_proses_lain() {
  local o; o="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate|npm run build' | grep -v "psm1\|release-panel-sync-meta\|pgrep\|node src/index.js" || true)"
  [ -z "$o" ] || { printf '%s\n' "$o" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan ($1)"; }
}
tidak_ada_proses_lain "fase 0"
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
# Jendela cron sync Meta 02.00 WIB (19:00 UTC): jangan recreate di sekitar jam itu.
JAM_UTC="$(date -u +%H%M)"; if [ "$MODE" != "preflight" ] && [ "$JAM_UTC" -ge 1840 ] && [ "$JAM_UTC" -le 1930 ]; then die "dalam jendela cron sync Meta (18:40-19:30 UTC); ulangi nanti"; fi

PHASE="1-aktif"; say "1. Release aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] && [ -d "$PREV_DIR/frontend/dist" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-panel-sync-meta-${DEPLOY_SHORT}"
ENV_SHA="$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12}); .env sha ${ENV_SHA}"

if [ "$MODE" = "rollback" ]; then
  PHASE="rollback"; say "ROLLBACK ke ${BASE_SHORT} (kode saja)"
  [ "$(basename "$PREV_DIR")" = "$DEPLOY_SHORT" ] || die "release aktif bukan ${DEPLOY_SHORT}; tidak ada yang di-rollback"
  [ -d "$RELEASES/$BASE_SHORT" ] || die "release ${BASE_SHORT} tidak ada di ${RELEASES}"
  docker image inspect "$ROLLBACK_TAG" >/dev/null 2>&1 || die "image rollback ${ROLLBACK_TAG} tidak ada"
  docker tag "$ROLLBACK_TAG" "$IMG_NAME" || die "gagal menandai ulang image rollback"
  dcp "$RELEASES/$BASE_SHORT" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "recreate dari ${BASE_SHORT} gagal"
  for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && break; sleep 2; done
  curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend tidak sehat setelah rollback"
  C="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
  [ "$(docker inspect -f '{{.Image}}' "$C")" = "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" ] || die "container setelah rollback bukan image rollback"
  ok "rollback ke ${BASE_SHORT} selesai (image ${ROLLBACK_TAG}); .env sha $(sha256sum "$PERSIST/backend/.env" | cut -c1-16)"; trap - EXIT; exit 0
fi

[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" 2>/dev/null || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHORT}; produksi bergeser — berhenti"
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "0" ] || die "backend aktif pernah restart (RestartCount != 0) — periksa dulu"
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="2-sumber"; say "2. Sumber kode, ancestry, dan batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
[ -r "${BUNDLE:-}" ] || die "BUNDLE tidak ada"
sg bundle verify "$BUNDLE" >/dev/null 2>&1 || die "git bundle tidak valid / prasyarat tidak ada di repo sumber"
sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand-psm" || die "fetch bundle gagal"
[ "$(sg rev-parse refs/remotes/origin/cand-psm)" = "$DEPLOY_SHA" ] || die "kandidat ${CAND_BRANCH} bukan SHA rilis; bergeser"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHORT} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit — berhenti"; }
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "daftar berkas backend/src yang berubah tidak sama dengan yang diaudit"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$|^docker-compose|Dockerfile|prisma/|\.env' || die "dependensi/compose/prisma/.env berubah — tidak diizinkan"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHORT}; $(printf '%s\n' "$CHANGED" | wc -l) berkas, semua dalam allowlist; backend/src = 3 berkas diaudit; tanpa dependensi/prisma/compose"

PHASE="3-audit"; say "3. Audit produksi (baca-saja)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
ok "health sehat; bundel publik = dist release aktif (${PREV_INDEX})"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung"
MIG_SEBELUM="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
ok "migrasi terpasang = ${MIG_SEBELUM} (tidak boleh berubah)"
SNAP_SQL="select 'jurnal', count(*), md5(coalesce(string_agg(e.id::text||e.status::text||e.entry_number, '|' order by e.id),'')) from fin_journal_entries e union all select 'baris_jurnal', count(*), md5(coalesce(string_agg(l.id::text||l.debit::text||l.credit::text, '|' order by l.id),'')) from fin_journal_lines l union all select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text, '|' order by x.id),'')) from stock_movements x union all select 'payment', count(*), md5(coalesce(string_agg(p.id::text||p.amount::text||coalesce(p.cancelled_at::text,''), '|' order by p.id),'')) from payments p union all select 'order', count(*), md5(coalesce(string_agg(o.id||o.status::text||o.\"paymentStatus\"::text, '|' order by o.id),'')) from \"Order\" o union all select 'po', count(*), md5(coalesce(string_agg(p::text, '|' order by p.id),'')) from fin_purchase_orders p union all select 'flag_v2', count(*), md5(coalesce(string_agg(f.key||f.enabled::text||f.config::text, '|' order by f.key),'')) from v2_feature_flags f union all select 'fin_settings', count(*), md5(coalesce(string_agg(f.key||f.value, '|' order by f.key),'')) from fin_settings f union all select 'meta_spend', count(*), md5(coalesce(string_agg(s.ad_id||s.date_wib::text||s.source::text||s.spend::text, '|' order by s.ad_id, s.date_wib, s.source),'')) from meta_ad_daily_spend s union all select 'meta_ref', count(*), md5(coalesce(string_agg(r.ad_id||r.ad_set_id||r.campaign_id, '|' order by r.ad_id),'')) from meta_ad_references r union all select 'meta_runs', count(*), '' from meta_sync_runs"
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sebelum.txt" || die "snapshot sebelum gagal"
[ "$(wc -l < "$BK_DIR/snap-sebelum.txt")" -ge 11 ] || die "snapshot sebelum tidak lengkap"
ok "snapshot sebelum ($(wc -l < "$BK_DIR/snap-sebelum.txt") kelompok): jurnal, stok, Payment, order, PO, flag, pengaturan, spend & referensi Meta, run sync"
LOCK_NEW="$BK_DIR/pkg-baru.json"; sg show "${DEPLOY_SHA}:frontend/package.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package.json identik"
NM_KB="$(du -sk "$NM_SRC" | cut -f1)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"
[ "$(bebas_kb)" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang (node_modules + build + backup)"
cek_disk "audit"
ok "node_modules build dari ${NM_SRC}"
if [ "$MODE" = "preflight" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] && [ ! -e "$NEW_DIR/frontend/.env" ] || die ".env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.yml") >/dev/null || die "docker-compose.yml berbeda dari release aktif"
ok "release dir dibuat; compose identik"

PHASE="4b-build-frontend"; say "4b. Build frontend (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$MAPS_KEY" ] || die "VITE_GOOGLE_MAPS_JS_KEY kosong di frontend/.env persisten"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
unset MAPS_KEY
for t in "${BARU_JS[@]}"; do
  [ -z "$(cari_dist "$PREV_DIR" js "$t")" ] || die "[skrip] '${t}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"
  [ -n "$(cari_dist "$NEW_DIR" js "$t")" ] || die "dist baru TIDAK memuat tampilan panel baru: ${t}"
done
for t in "${TETAP_JS[@]}"; do
  [ -n "$(cari_dist "$PREV_DIR" js "$t")" ] || die "[skrip] '${t}' tidak ada di dist release aktif — perbaiki daftar pembanding"
  [ -n "$(cari_dist "$NEW_DIR" js "$t")" ] || die "dist baru KEHILANGAN teks fitur: ${t}"
done
for c in ".crm-mk-tabel" ".crm-lap" ".gud-halaman" ".fin-kpi-grid"; do
  [ -n "$(cari_dist "$PREV_DIR" css "$c")" ] || die "[skrip] '${c}' tidak ada di CSS release aktif — perbaiki daftar pembanding"
  [ -n "$(cari_dist "$NEW_DIR" css "$c")" ] || die "CSS baru KEHILANGAN ${c}"
done
[ -f "$NEW_DIR/frontend/dist/sw.js" ] || die "sw.js tidak ada di dist baru"
cmp -s <(tr -d '\r' < "$PREV_DIR/frontend/dist/sw.js") <(tr -d '\r' < "$NEW_DIR/frontend/dist/sw.js") || warn "sw.js berbeda dari dist aktif (periksa ${BK_DIR}/build-frontend.log)"
! grep -qF '"url":"index.html"' "$NEW_DIR/frontend/dist/sw.js" || die "sw.js baru MEMPRECACHE index.html (regresi)"
grep -qF 'addEventListener("push"' "$NEW_DIR/frontend/dist/sw.js" || die "sw.js baru KEHILANGAN penerima notifikasi push"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}): panel baru ada; teks dan CSS fitur live tetap ada; service worker utuh"

PHASE="4c-aset-lama"; say "4c. Bawa aset ber-hash dari dist aktif (tab terbuka tetap bisa memuat chunk lama)"
OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"; n=0
for f in "$PREV_DIR"/frontend/dist/assets/*; do
  [ -f "$f" ] || continue; b="$(basename "$f")"; [ -e "$NEW_DIR/frontend/dist/assets/$b" ] && continue
  cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b" && { printf '%s\n' "$b" >> "$OLD_ASSETS"; n=$((n+1)); }
done
find "$NEW_DIR/frontend/dist/assets" -type f -mtime +21 -delete
[ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "bundel baru rusak setelah membawa aset lama"
rm -rf -- "$NEW_DIR/frontend/node_modules"   # salinan build saja; tidak dipakai saat runtime
ok "${n} aset lama dibawa; salinan node_modules build dilepas"
cek_disk "setelah build"
if [ "$MODE" = "buildonly" ]; then
  say "Build terisolasi selesai (--build-only): semua gerbang dist lulus; image TIDAK dibangun; produksi TIDAK diubah"
  [ "$NEW_DIR" = "$RELEASES/$DEPLOY_SHORT" ] && [ "$(tr -d '[:space:]' < "$NEW_DIR/.release-commit")" = "$DEPLOY_SHORT" ] && [ "$NEW_DIR" != "$PREV_DIR" ] || die "release dir sementara tidak terverifikasi; tidak dihapus"
  rm -rf -- "$NEW_DIR"; ok "release dir sementara ${NEW_DIR} dihapus; bukti gerbang di ${BK_DIR}"
  trap - EXIT; exit 0
fi

PHASE="5-backup"; say "5. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-panel-sync-meta-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -c1-16 "${BACKUP_FILE}.sha256")"

PHASE="6-build-image"; say "6. Build image backend baru (backend lama tetap melayani)"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
ln -s "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env"; [ -r "$NEW_DIR/frontend/.env" ] || die "symlink frontend/.env tidak terbaca"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali; tanpa migrasi)"
tidak_ada_proses_lain "tepat sebelum switch"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum switch"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah sebelum switch"
T_SWITCH="$(date -u +%FT%TZ)"; SWITCHED=1
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
CID_NEW=""
for i in $(seq 1 45); do
  CAL="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
  if [ "$(printf '%s\n' "$CAL" | grep -c .)" = "1" ] && [ "$(docker inspect -f '{{.Image}}' "$CAL" 2>/dev/null)" = "$NEW_IMG_ID" ]; then CID_NEW="$CAL"; break; fi
  sleep 2
done
[ -n "$CID_NEW" ] || die "tidak ada tepat satu container dari image baru"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT}); switch ${T_SWITCH}"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru"
ok "publik 200; bundel web publik = dist baru ${NEW_INDEX}"
for f in $BACKEND_SRC_EXPECT; do
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
done
for f in services/finance/journal.js services/finance/posting/orderRevenue.js services/inventoryLedger.js middleware/authorize.js middleware/auth.js services/attribution/spend.js; do
  want="$(sg show "${BASE_SHA}:backend/src/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/src/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "${f} di container BERBEDA dari baseline"
done
ok "3 berkas backend/src = kandidat (byte-identik); jurnal, ledger, auth, importer spend tidak berubah dari baseline"
MIG_SESUDAH="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
[ "$MIG_SESUDAH" = "$MIG_SEBELUM" ] || die "jumlah migrasi berubah (${MIG_SEBELUM} -> ${MIG_SESUDAH})"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env BERUBAH selama rilis"
ok "migrasi ${MIG_SEBELUM} -> ${MIG_SESUDAH}; .env identik (sha ${ENV_SHA})"

PHASE="8b-smoke"; say "8b. Smoke panel (GET saja; identitas sintetis 60 detik; nilai konfigurasi tidak dicetak)"
cat > "$BK_DIR/smoke.mjs" <<'NODE'
import jwt from "jsonwebtoken";
const B = `http://127.0.0.1:${process.env.PORT || 4000}/api/atribusi/iklan`;
const tok = (role) => jwt.sign({ id: `qa-sintetis-${role}`, name: "QA sintetis", role, roles: [role] }, process.env.JWT_SECRET, { expiresIn: 60 });
let fail = 0; const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " - " + d : ""}`); };
const get = async (p, role) => { const r = await fetch(B + p, role ? { headers: { Authorization: `Bearer ${tok(role)}` } } : {}); const t = await r.text(); return { s: r.status, t, j: (() => { try { return JSON.parse(t); } catch { return {}; } })() }; };
const tanpa = await get("/referensi"); rec("referensi tanpa token = 401", tanpa.s === 401, String(tanpa.s));
const sales = await get("/referensi", "SALES"); rec("referensi SALES = 403", sales.s === 403, String(sales.s));
const r = await get("/referensi", "ADMIN"); rec("referensi ADMIN = 200", r.s === 200, String(r.s));
const aktif = process.env.COMPOSIO_META_SYNC_ENABLED === "true";
rec("sumberTersedia mengikuti flag Composio", JSON.stringify(r.j.sumberTersedia) === JSON.stringify(aktif ? ["COMPOSIO", "ADS_MANAGER_EXPORT", "MANUAL"] : ["ADS_MANAGER_EXPORT", "MANUAL"]), JSON.stringify(r.j.sumberTersedia));
rec("teks usang MARKETING_API hilang", !String(r.j.catatan || "").includes("MARKETING_API belum"));
const rahasia = ["COMPOSIO_API_KEY", "COMPOSIO_META_USER_ID", "JWT_SECRET"].map((n) => process.env[n]).filter((v) => v && v.length >= 6);
const st = await get("/sync-meta/status", "ADMIN"); rec("status sync ADMIN = 200", st.s === 200, String(st.s));
rec("respons tanpa nilai secret", rahasia.every((v) => !r.t.includes(v) && !st.t.includes(v)));
rec("flag sync tidak berubah (tetap menyala)", aktif && st.j.flagAktif === true);
const m = await import("/app/src/services/attribution/composioMetaSync.js"); rec("modul sync termuat", typeof m.jalankanSinkronComposio === "function");
console.log(`SMOKE_HASIL fail=${fail}`); process.exit(fail ? 1 : 0);
NODE
docker exec -i -w /app "$CID_NEW" node --input-type=module - < "$BK_DIR/smoke.mjs" > "$BK_DIR/smoke.log" 2>&1 || { tail -n 40 "$BK_DIR/smoke.log"; die "smoke GAGAL"; }
cat "$BK_DIR/smoke.log"
grep -qx 'SMOKE_HASIL fail=0' "$BK_DIR/smoke.log" || die "smoke tidak mencetak ringkasan lulus"
ok "smoke lulus"

PHASE="8c-snapshot"; say "8c. Snapshot data sebelum vs sesudah + aset"
sleep 5
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sesudah.txt" || die "snapshot sesudah gagal"
if cmp -s "$BK_DIR/snap-sebelum.txt" "$BK_DIR/snap-sesudah.txt"; then ok "SELURUH snapshot IDENTIK"; else
  echo "  INFO  snapshot berbeda (aktivitas pengguna sah harus tampak sebagai penambahan):"; diff "$BK_DIR/snap-sebelum.txt" "$BK_DIR/snap-sesudah.txt" || true
  for k in flag_v2 fin_settings po meta_spend meta_ref meta_runs; do
    [ "$(awk -F'|' -v k="$k" '$1==k' "$BK_DIR/snap-sebelum.txt")" = "$(awk -F'|' -v k="$k" '$1==k' "$BK_DIR/snap-sesudah.txt")" ] || die "$k BERUBAH selama rilis"
  done
  while IFS='|' read -r kk nn _; do [ "$(awk -F'|' -v k="$kk" '$1==k{print $2}' "$BK_DIR/snap-sesudah.txt")" -ge "$nn" ] || die "jumlah baris $kk BERKURANG selama rilis"; done < "$BK_DIR/snap-sebelum.txt"
  ok "flag, pengaturan, PO, spend/referensi/run Meta identik; selisih lain hanya penambahan"
fi
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} tidak 200"; ok "aset lama masih 200"; fi
[ "$(crontab -l 2>/dev/null | grep -c 'BEGIN sync-meta-composio')" = "1" ] || die "blok cron sync-meta-composio hilang"
ok "blok cron sync Meta tetap ada (tidak disentuh)"
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
LOGERR="$(docker logs --since 5m "$CID_NEW" 2>&1 | grep -ciE 'unhandled|uncaught|Cannot find module|SyntaxError' || true)"
[ "${LOGERR:-0}" = "0" ] || { docker logs --since 5m "$CID_NEW" 2>&1 | grep -iE 'unhandled|uncaught|Cannot find module|SyntaxError' | tail -n 10; die "log backend memuat galat fatal (${LOGERR})"; }
ok "backend stabil: RestartCount=0; log 5 menit bersih dari galat fatal"

trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif (switch ${T_SWITCH}). Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}."
say "Rollback: bash /tmp/psm1.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback   Log: ${BK_DIR}/release.log"
