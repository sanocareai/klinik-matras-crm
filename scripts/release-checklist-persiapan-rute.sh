#!/usr/bin/env bash
# Rilis MANUAL "Checklist Persiapan Perjalanan" + "Histori Waktu Rute & Stop" (web admin + Driver Web + Driver App,
# backend gerbang start-rute) — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA).
# DUA migrasi aditif berurutan (diterapkan oleh satu `prisma migrate deploy`):
#   20261018090000_route_prep_checklist        — 1 enum, 2 kolom nullable/default di routes, 2 tabel baru (items/proofs), indeks, FK.
#   20261020100000_route_execution_event_time  — 3 kolom nullable di delivery_execution_events (occurred_at/source/time_quality).
# Tidak ada DROP/DELETE/UPDATE/RENAME/SET NOT NULL pada tabel yang sudah berisi data. Tidak menyentuh Finance/jurnal/payment.
#
#   cat scripts/release-checklist-persiapan-rute.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rcpr.sh && bash /tmp/rcpr.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rcpr.sh <DEPLOY_SHA_40> <BASE_SHA_40>'
#
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/checklist-persiapan-perjalanan}"
# Migrasi CREATE yang SUDAH diaudit: nama -> sha256 isi (LF). Diterapkan BERURUTAN oleh satu `prisma migrate deploy`.
declare -A MIGRASI_TERAUDIT=(
  ["20261018090000_route_prep_checklist"]="b2b4173acd25dd228987c28f2f2f2ba7c90b4308a8e96fe8aa282ef0f195e477"
  ["20261020100000_route_execution_event_time"]="e55f9b86f794427cade872a199a255494235d3d25838ac6405590b8f26f60635"
)
NEW_MIGRATIONS="20261018090000_route_prep_checklist 20261020100000_route_execution_event_time"
# Berkas yang BOLEH berbeda dari baseline: hanya area Armada/Checklist-Persiapan/Histori-Waktu (backend+frontend+driver-mobile) + tes/doc-nya.
# Apa pun di luar ini (Finance, Production, Delivery lain, Inbox, package-lock) = berhenti.
ALLOWED_RE='^(\.gitignore|backend/data/route-prep-proofs/\.gitkeep|backend/prisma/(schema\.prisma|migrations/(20261018090000_route_prep_checklist|20261020100000_route_execution_event_time)/migration\.sql)|backend/src/(index\.js|lib/activityLog\.js|routes/(armada|routePrepProofMedia)\.js|services/(deliveryExecution|deliveryTimeline|orderStatusSync|routePrepChecklist)\.js)|backend/tests/(deliveryTimeline\.test\.js|integration/(routePrepChecklist\.integration\.test\.js|routeTimeline\.integration\.test\.js|setup/testApp\.js))|docs/ROUTE-TIME-HISTORY\.md|driver-mobile/(App\.js|src/(api\.js|components/RouteStartCard\.js|lib/(executionQueue(\.test)?\.js|prepChecklistStatus(\.test)?\.js|timelineView(\.test)?\.js)|screens/(HistoriWaktuScreen|PersiapanPerjalananScreen)\.js))|frontend/src/(api\.js|features/armada/components/(RouteCard|RoutePrepChecklistAdminModal|RoutePrepChecklistDriverPanel|RouteTimelinePanel)\.jsx|pages/DriverJobs\.jsx|utils/submitJobAction\.js)|frontend/tests/routeTimelineUI\.test\.js|scripts/release-checklist-persiapan-rute\.sh)$'
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
PREFLIGHT_ONLY=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/cpr-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa)
Image sebelumnya   : ${ROLLBACK_TAG:-<belum ditandai>}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.
Setelah switch bermasalah:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Kedua migrasi HANYA menambah kolom nullable/default + 2 tabel baru (+indeks/FK) dan 3 kolom nullable di delivery_execution_events: rollback kode aman
tanpa memulihkan database (kode lama mengabaikan kolom/tabel baru itu).
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas).
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm comm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-checklist-persiapan-rute.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rcpr\|release-checklist-persiapan-rute\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, dan batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR area Checklist-Persiapan/Histori-Waktu yang berbeda dari baseline (Finance/Production/Delivery/Inbox/package-lock?) — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
EXPECT_PRISMA="$(printf 'backend/prisma/schema.prisma\n'; for m in $NEW_MIGRATIONS; do printf 'backend/prisma/migrations/%s/migration.sql\n' "$m"; done)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat schema.prisma + migration.sql dari ${NEW_MIGRATIONS}"; }
for NEW_MIGRATION in $NEW_MIGRATIONS; do
  [[ "$NEW_MIGRATION" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: ${NEW_MIGRATION}"
  MIG_PATH="backend/prisma/migrations/${NEW_MIGRATION}/migration.sql"
  MIGSQL="$(sg show "${DEPLOY_SHA}:${MIG_PATH}" | tr -d '\r')"
  ISI="$(printf '%s\n' "$MIGSQL" | grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$' || true)"
  [ -n "$ISI" ] || die "migrasi ${NEW_MIGRATION} kosong"
  MIG_SHA="$(printf '%s\n' "$MIGSQL" | sha256sum | cut -d' ' -f1)"
  [ -n "${MIGRASI_TERAUDIT[$NEW_MIGRATION]:-}" ] || die "migrasi ${NEW_MIGRATION} tidak ada di MIGRASI_TERAUDIT"
  [ "${MIGRASI_TERAUDIT[$NEW_MIGRATION]}" = "$MIG_SHA" ] || die "isi migrasi ${NEW_MIGRATION} BERBEDA dari yang diaudit (sha256 ${MIG_SHA}) — audit ulang lalu perbarui pin"
  SCAN="$(printf '%s\n' "$ISI" | sed -E 's/ON (DELETE|UPDATE) (CASCADE|RESTRICT|SET NULL|NO ACTION)//g')"
  printf '%s\n' "$SCAN" | grep -Eiqw 'DROP|DELETE|UPDATE|INSERT|TRUNCATE|RENAME|SET[[:space:]]+NOT[[:space:]]+NULL|COPY|GRANT|REVOKE' && die "migrasi ${NEW_MIGRATION} mengandung perintah non-aditif"
  ok "migrasi ${NEW_MIGRATION}: sha256 cocok pin (${MIG_SHA:0:12}); aditif (CREATE/ADD COLUMN/ADD CONSTRAINT/CREATE INDEX)"
done
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit + DUA migrasi (${NEW_MIGRATIONS})"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHA:0:8}; produksi bergeser — berhenti"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
ok "health sehat; bundel publik = dist release aktif (${PREV_INDEX})"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung"
# Snapshot data lintas-domain: jurnal/payment/order (Finance, tidak boleh berubah — rilis ini TIDAK menyentuh Finance) + rute/job (domain yang disentuh, hanya struktur baru ditambah, baris lama tidak berubah).
SNAP_SQL="select 'order_status', count(*), md5(coalesce(string_agg(x.id::text||x.\"paymentStatus\"::text||coalesce(x.paid_at::text,''), '|' order by x.id),'')) from \"Order\" x union all select 'payment', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from payments x union all select 'jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from fin_journal_entries x union all select 'route', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from routes x union all select 'job_status', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from jobs x union all select 'delivery_exec_event', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from delivery_execution_events x"
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/data-sebelum.txt" || die "snapshot data sebelum gagal"
ok "snapshot data sebelum tersimpan ($(wc -l < "$BK_DIR/data-sebelum.txt") baris)"

say "2b. Sumber node_modules frontend (package-lock identik dengan kandidat)"
LOCK_NEW="$BK_DIR/lock-baru.json"; sg show "${DEPLOY_SHA}:frontend/package-lock.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do
  d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package-lock.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package-lock.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package-lock identik"
ok "node_modules build dari ${NM_SRC}"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-cpr-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
ln -sf "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env.persist-check" 2>/dev/null || true; rm -f "$NEW_DIR/frontend/.env.persist-check"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat; compose identik"

say "4b. Build frontend di release dir (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
# Fitur live (sebelum rilis ini) yang TIDAK boleh hilang dari bundel — Finance/Production yang sudah ikut lewat merge baseline.
for s1 in "Ajukan Klaim Lunas" "Laporan Biaya Divisi" "Isi Diagnosis" "Sales per Stage" "Rencana Produksi" "Status Produksi" "Penjualan Karyawan (di luar tim Sales)"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN fitur live: $s1"; done
# Fitur BARU rilis ini.
for s2 in "Persiapan Perjalanan" "Histori Waktu"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur Checklist Persiapan/Histori Waktu: $s2"; done
if [ "$NEW_INDEX" = "$PREV_INDEX" ]; then
  ! sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | grep -q '^frontend/' || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
  ok "dist identik (${NEW_INDEX}) — wajar: rilis ini tidak mengubah frontend"
else
  ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX})"
fi

PHASE="4c-aset-lama"; say "4c. Bawa aset ber-hash dari dist release aktif (tab terbuka saat deploy tetap bisa memuat chunk lama)"
OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"
n=0
for f in "$PREV_DIR"/frontend/dist/assets/*; do
  [ -f "$f" ] || continue; b="$(basename "$f")"
  [ -e "$NEW_DIR/frontend/dist/assets/$b" ] && continue
  cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b" && { printf '%s\n' "$b" >> "$OLD_ASSETS"; n=$((n+1)); }
done
find "$NEW_DIR/frontend/dist/assets" -type f -mtime +21 -delete
ok "${n} aset lama dibawa ke dist baru; index.html baru tetap hanya merujuk aset baru"
[ -n "$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "index/bundel baru rusak setelah membawa aset lama"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-cpr-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan KEDUA migrasi dengan image baru, verifikasi, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_cpr_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
for T in '"Order"' payments fin_journal_entries routes jobs delivery_execution_events; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "select count(*) from $T" </dev/null)"
  [ "$A" = "$B" ] || { reh_drop; die "restore rehearsal tidak identik untuk $T (produksi=$A restore=$B) — backup/restore bermasalah"; }
done
ok "restore nyata identik untuk Order, payments, jurnal, routes, jobs, delivery_execution_events"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 30 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "REHEARSAL migrate deploy GAGAL (DB produksi tidak disentuh)"; }
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
[ "$(RPSQL "select count(*) from information_schema.tables where table_name='route_prep_checklist_items'")" = "1" ] || { reh_drop; die "tabel route_prep_checklist_items tidak ada setelah migrasi rehearsal"; }
[ "$(RPSQL "select count(*) from information_schema.tables where table_name='route_prep_checklist_proofs'")" = "1" ] || { reh_drop; die "tabel route_prep_checklist_proofs tidak ada setelah migrasi rehearsal"; }
[ "$(RPSQL "select count(*) from information_schema.columns where table_name='delivery_execution_events' and column_name='time_quality'")" = "1" ] || { reh_drop; die "kolom time_quality tidak ada setelah migrasi rehearsal"; }
[ "$(RPSQL "select count(*) from route_prep_checklist_items")" = "0" ] || { reh_drop; die "ada baris di route_prep_checklist_items setelah migrasi (tidak diharapkan: tabel baru kosong)"; }
for T in '"Order"' payments fin_journal_entries routes jobs delivery_execution_events; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$A" = "$B" ] || { reh_drop; die "jumlah baris $T berubah oleh migrasi rehearsal (produksi=$A rehearsal=$B)"; }
done
reh_drop
ok "rehearsal lulus: migrate dari schema produksi (restore nyata) -> up to date; tabel checklist baru kosong; jumlah baris tabel kunci tidak berubah; DB sementara dihapus"

PHASE="6-migrate"; say "6. Migrasi aditif ${NEW_MIGRATIONS} (image baru; backend lama tetap melayani)"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
for m in $NEW_MIGRATIONS; do grep -Fx "$m" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${m} SUDAH terpasang sebelum rilis (tidak diharapkan)"; done
PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") || true)"
EXPECT_PENDING="$(printf '%s\n' $NEW_MIGRATIONS | LC_ALL=C sort)"
[ "$PENDING" = "$EXPECT_PENDING" ] || die "migrasi pending bukan tepat ${NEW_MIGRATIONS}: $(printf '%s' "$PENDING" | tr '\n' ' ')"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
for m in $NEW_MIGRATIONS; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 2 ))" ] || die "jumlah migrasi terpasang != sebelum + 2"
ok "kedua migrasi diterapkan: ${NEW_MIGRATIONS}; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru (${NEW_INDEX})"; ok "bundel web publik = dist baru ${NEW_INDEX}"
for f in backend/src/routes/armada.js backend/src/routes/routePrepProofMedia.js backend/src/services/deliveryTimeline.js backend/src/services/routePrepChecklist.js backend/src/services/deliveryExecution.js backend/src/services/orderStatusSync.js backend/src/lib/activityLog.js backend/src/index.js; do
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
done
ok "berkas Checklist Persiapan/Histori Waktu di container = kandidat (byte-identik)"
[ "$(dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "select count(*) from route_prep_checklist_items" </dev/null)" = "0" ] || die "ada baris di route_prep_checklist_items setelah rilis (tidak diharapkan: fitur baru, tabel baru)"
ok "tabel checklist baru ada dan kosong (belum ada rute yang memakainya)"
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${PUBLIC_URL}/api/armada/routes/00000000-0000-0000-0000-000000000000/timeline")" = "401" ] || die "endpoint timeline tidak menjawab 401 tanpa login"
ok "endpoint GET timeline aktif dan menolak tanpa login (401)"
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$SNAP_SQL" </dev/null > "$BK_DIR/data-sesudah.txt" || die "snapshot data sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "data berubah selama rilis (jurnal/payment/order/route/job) — periksa (transaksi pengguna yang sah juga bisa menyebabkan ini)"; }
ok "jurnal, payment, order, route, job, delivery_execution_event IDENTIK sebelum vs sesudah rilis"
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} tidak bisa diunduh (404) — pembawaan aset lama gagal"
  ok "aset lama ${OLD_ONLY} masih 200 (tab terbuka tidak kena 404)"
fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang memang tidak ada harus 404 jujur"
ok "aset yang tidak ada = 404 (bukan index.html)"

PHASE="9-pembersihan"; say "9. Pembersihan release lama (menyisakan 4 terbaru + yang dipakai container)"
(
  cd "$RELEASES" || exit 0
  KEEP="$(ls -1dt */ | head -4 | tr -d /)
$(basename "$NEW_DIR")
$(basename "$PREV_DIR")"
  for c in $(docker ps -q); do w="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null)"; [ -n "$w" ] && KEEP="$KEEP
$(basename "$w")"; done
  HAPUS="$(ls -1d */ | tr -d / | grep -vxF -f <(echo "$KEEP" | sort -u) || true)"
  n=0; for d in $HAPUS; do case "$d" in ""|"."|"..") continue;; esac; [ -d "$d" ] || continue; rm -rf -- "$d" 2>/dev/null || sudo -n rm -rf -- "$d" 2>/dev/null; n=$((n+1)); done
  echo "  OK    release lama dihapus: $n folder; disk: $(df -h "$HOME" | awk 'NR==2{print $4" bebas"}')"
) || echo "  (pembersihan dilewati)"
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
