#!/usr/bin/env bash
# RILIS ANTI-DOBEL FILE MEDIA WEBHOOK — BACKEND SAJA, TANPA migrasi, TANPA frontend/dependensi, TANPA perubahan data. FAIL-CLOSED.
#   downloadAndSaveMedia (routes/webhooks.js) kini dijalankan SEKALI per externalId (utils/sekaliPerKunci.js), sehingga event "message" + "message.any"
#   yang tiba nyaris bersamaan tidak lagi menulis dua file media berbeda untuk satu pesan (audit 21 Okt 2026: 17 GB file kembar).
# Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA); dist frontend DISALIN dari release aktif. Sebelum switch: backup + gzip + RESTORE nyata ke DB sementara.
# Verifikasi pasca-rilis BACA-SAJA: tidak ada transaksi/QA/unggahan di produksi.
#
#   cat scripts/release-media-dedupe.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rmd.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rmd.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rmd.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/rmd.out 2>&1 < /dev/null &'   # unggah & jalankan TERPISAH
#
# ROLLBACK: tanpa migrasi & tanpa perubahan data -> rollback kode aman kapan saja (image rollback ditandai di bawah).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/webhook-media-dedupe}"
# Berkas yang BOLEH berbeda dari baseline: path persis. Prisma/package/frontend/migrasi/compose tidak boleh ikut.
ALLOWED_RE='^(backend/src/routes/webhooks\.js|backend/src/utils/sekaliPerKunci\.js|backend/tests/sekaliPerKunci\.test\.js|scripts/release-ctwa-capture-flag-off\.sh|scripts/release-media-dedupe\.sh)$'
BACKEND_SRC_EXPECT="backend/src/routes/webhooks.js backend/src/utils/sekaliPerKunci.js"
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
BK_DIR="$HOME/release-backups/media-dedupe-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  \033[33mPERHATIAN\033[0m %s\n' "$*"; }
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
Rilis ini TIDAK punya migrasi dan TIDAK mengubah data: rollback kode tidak membutuhkan pemulihan database.
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-media-dedupe.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rmd\|release-media-dedupe\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
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
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "daftar berkas backend/src yang berubah tidak sama dengan yang diaudit"
! printf '%s\n' "$CHANGED" | grep -qE '^(backend/prisma/|frontend/)|package(-lock)?\.json$|^docker-compose|Dockerfile' || die "prisma/frontend/dependensi/compose berubah — rilis ini harus backend-saja tanpa migrasi"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas, semua dalam allowlist; backend/src = $(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w) berkas yang diaudit; tanpa prisma/frontend/dependensi"
warn "origin/main tidak diperiksa sebagai leluhur: main tertinggal dari release aktif (kandidat dibangun di atas live, bukan main)"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] && [ -d "$PREV_DIR/frontend/dist" ] || die "release aktif tidak lengkap"
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
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "0" ] || die "backend aktif pernah restart (RestartCount != 0) — periksa dulu"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung"
MIG_SEBELUM="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
ok "migrasi terpasang sebelum rilis = ${MIG_SEBELUM} (harus tidak berubah)"
# Snapshot: rilis ini tidak menulis data apa pun. Jumlah baris tabel kunci tidak boleh BERKURANG; flag/pengaturan identik.
SNAP_SQL="select 'message', count(*) from \"Message\" union all select 'conversation', count(*) from \"Conversation\" union all select 'customer', count(*) from \"Customer\" union all select 'order', count(*) from \"Order\" union all select 'payment', count(*) from payments union all select 'jurnal', count(*) from fin_journal_entries union all select 'baris_jurnal', count(*) from fin_journal_lines union all select 'stok', count(*) from stock_movements union all select 'po', count(*) from fin_purchase_orders union all select 'penerimaan', count(*) from goods_receipts union all select 'job', count(*) from jobs union all select 'route', count(*) from routes"
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sebelum.txt" || die "snapshot sebelum gagal"
[ "$(wc -l < "$BK_DIR/snap-sebelum.txt")" -ge 12 ] || die "snapshot sebelum tidak lengkap"
ok "snapshot sebelum tersimpan ($(wc -l < "$BK_DIR/snap-sebelum.txt") kelompok)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 5 * 1024 * 1024 )) ] || die "ruang disk kurang (butuh ~3x DB + 5 GiB untuk build image; bebas $(( AVAIL_KB / 1024 )) MiB)"
ok "ruang disk cukup ($(( AVAIL_KB / 1024 )) MiB bebas)"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-media-dedupe-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

PHASE="3b-restore"; say "3b. Validasi restore: pulihkan backup NYATA ke DB sementara dan cocokkan jumlah baris (DB produksi tidak disentuh)"
REH_DB="rehearsal_mdd_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
# Produksi hidup: pesan WhatsApp sah masuk terus — toleransi HANYA bila produksi >= restore dan selisih kecil (tercatat).
for T in '"Message"' '"Conversation"' '"Customer"' '"Order"' payments fin_journal_entries fin_journal_lines stock_movements fin_purchase_orders goods_receipts jobs routes; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$B" -le "$A" ] && [ "$(( A - B ))" -le 400 ] || { reh_drop; die "restore tidak cocok untuk $T (produksi=$A restore=$B)"; }
  [ "$A" = "$B" ] && echo "  = $T $A" || echo "  ~ $T produksi=$A restore=$B (data sah masuk sesudah backup)"
done
[ "$(RPSQL "select count(*) from _prisma_migrations")" = "$(psql_live -At -c "select count(*) from _prisma_migrations")" ] || { reh_drop; die "jumlah migrasi pada restore berbeda"; }
reh_drop
ok "restore backup ke DB sementara berhasil: tabel kunci cocok; DB sementara dihapus"

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; dist frontend disalin dari release aktif; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
ln -s "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env"; [ -r "$NEW_DIR/frontend/.env" ] || die "symlink frontend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.yml") >/dev/null || die "docker-compose.yml berbeda dari release aktif"
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin dist dari release aktif"
cmp -s "$PREV_DIR/frontend/dist/index.html" "$NEW_DIR/frontend/dist/index.html" || die "index.html hasil salinan berbeda"
ok "release dir dibuat; compose identik; dist = salinan release aktif (${PREV_INDEX}); aset lama otomatis terbawa"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-mdd-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali; tanpa migrasi)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$PREV_INDEX" ] || die "bundel publik berubah (frontend tidak boleh berubah)"; ok "bundel web publik tidak berubah (${PREV_INDEX})"
for f in $BACKEND_SRC_EXPECT; do
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
done
ok "$(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w) berkas backend/src di container = kandidat (byte-identik)"
# Berkas yang TIDAK boleh berubah dari baseline (ledger, otorisasi, klien WAHA, jalur percakapan).
for f in services/finance/journal.js services/inventoryLedger.js middleware/authorize.js middleware/auth.js services/wahaClient.js routes/conversations.js; do
  want="$(sg show "${BASE_SHA}:backend/src/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/src/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "${f} di container BERBEDA dari baseline"
done
ok "journal.js, inventoryLedger.js, authorize.js, auth.js, wahaClient.js, conversations.js tidak berubah dari baseline"
MIG_SESUDAH="$(dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null" </dev/null)"
[ "$MIG_SESUDAH" = "$MIG_SEBELUM" ] || die "jumlah migrasi berubah (${MIG_SEBELUM} -> ${MIG_SESUDAH}) padahal rilis ini tanpa migrasi"
ok "migrasi terpasang tetap ${MIG_SESUDAH} (tanpa migrasi)"

PHASE="8b-smoke"; say "8b. Smoke baca-saja: perilaku helper di dalam container + media lama tetap tersaji"
cat > "$BK_DIR/smoke.mjs" <<'NODE'
import { buatSekaliPerKunci } from "/app/src/utils/sekaliPerKunci.js";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const tunda = (ms) => new Promise((r) => setTimeout(r, ms));
const jalan = buatSekaliPerKunci({ ttlMs: 60000, maksEntri: 50 });
let n = 0;
const unduh = async () => { n++; await tunda(30); return "/uploads/uji.jpg"; };
const [a, b, c] = await Promise.all([jalan("uji-1", unduh), jalan("uji-1", unduh), jalan("uji-1", unduh)]);
rec("3 pemanggil bersamaan untuk satu externalId -> fn hanya 1x, path sama", n === 1 && a === b && b === c, `panggilan=${n}`);
let m = 0;
const gagal = async () => { m++; return m === 1 ? null : "/uploads/ok.jpg"; };
const g1 = await jalan("uji-2", gagal); const g2 = await jalan("uji-2", gagal);
rec("hasil gagal (null) tidak diingat: percobaan kedua jalan lagi", g1 === null && g2 === "/uploads/ok.jpg" && m === 2);
console.log(`SMOKE_HASIL mode=after fail=${fail} skip=0`);
process.exit(fail ? 1 : 0);
NODE
docker exec -i "$CID_NEW" node --input-type=module - < "$BK_DIR/smoke.mjs" > "$BK_DIR/smoke.log" 2>&1 || { tail -n 30 "$BK_DIR/smoke.log"; die "smoke di container GAGAL"; }
cat "$BK_DIR/smoke.log"
grep -q '^SMOKE_HASIL mode=after fail=0 skip=0$' "$BK_DIR/smoke.log" || die "smoke tidak mencetak ringkasan lulus"
ok "helper di container berperilaku sesuai kontrak (tanpa menyentuh data produksi)"
# Media lama harus tetap tersaji lewat domain publik (mount uploads utuh): ambil satu mediaUrl terbaru yang file-nya ada.
MEDIA="$(psql_live -At -c "select \"mediaUrl\" from \"Message\" where \"mediaUrl\" like '/uploads/%' order by \"createdAt\" desc limit 1")"
if [ -n "$MEDIA" ] && [ -f "$PERSIST/backend${MEDIA}" ]; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -r 0-1023 "${PUBLIC_URL}${MEDIA}")"
  case "$CODE" in 200|206) ok "media terbaru ${MEDIA} tersaji lewat domain publik (HTTP ${CODE})";; *) die "media ${MEDIA} tidak tersaji (HTTP ${CODE})";; esac
else warn "tidak ada mediaUrl terbaru yang file-nya ada di disk — pemeriksaan penyajian media dilewati"; fi

PHASE="8c-snapshot"; say "8c. Snapshot data sebelum vs sesudah"
sleep 5
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sesudah.txt" || die "snapshot sesudah gagal"
while IFS='|' read -r kk nn; do
  [ "$(awk -F'|' -v k="$kk" '$1==k{print $2}' "$BK_DIR/snap-sesudah.txt")" -ge "$nn" ] || die "jumlah baris $kk BERKURANG selama rilis"
done < "$BK_DIR/snap-sebelum.txt"
cmp -s "$BK_DIR/snap-sebelum.txt" "$BK_DIR/snap-sesudah.txt" && ok "SELURUH snapshot IDENTIK" || { echo "  INFO  selisih (pesan WhatsApp sah yang masuk di sela rilis harus tampak sebagai penambahan):"; diff "$BK_DIR/snap-sebelum.txt" "$BK_DIR/snap-sesudah.txt" || true; ok "tidak ada baris yang berkurang; selisih hanya penambahan (aktivitas pengguna sah)"; }
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
LOGERR="$(docker logs --since 5m "$CID_NEW" 2>&1 | grep -ciE 'unhandled|uncaught|Cannot find module|SyntaxError' || true)"
[ "${LOGERR:-0}" = "0" ] || { docker logs --since 5m "$CID_NEW" 2>&1 | grep -iE 'unhandled|uncaught|Cannot find module|SyntaxError' | tail -n 10; die "log backend 5 menit terakhir memuat galat fatal (${LOGERR})"; }
ok "log backend 5 menit terakhir bersih dari galat fatal"
ok "sesi WhatsApp tidak disentuh (container WAHA tidak dibuat ulang)"

PHASE="9-pembersihan"; say "9. Pembersihan release lama (menyisakan 5 terbaru + yang dipakai container)"
(
  cd "$RELEASES" || exit 0
  KEEP="$(ls -1dt */ | head -5 | tr -d /)
$(basename "$NEW_DIR")
$(basename "$PREV_DIR")"
  for c in $(docker ps -q); do w="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null)"; [ -n "$w" ] && KEEP="$KEEP
$(basename "$w")"; done
  HAPUS="$(ls -1d */ | tr -d / | grep -vxF -f <(echo "$KEEP" | sort -u) || true)"
  n=0; for d in $HAPUS; do [[ "$d" =~ ^[0-9a-f]{8}$ ]] || continue; [ -d "$d" ] || continue; rm -rf -- "$d" 2>/dev/null || sudo -n rm -rf -- "$d" 2>/dev/null; n=$((n+1)); done
  echo "  OK    release lama dihapus: $n folder; disk: $(df -h "$HOME" | awk 'NR==2{print $4" bebas"}')"
) || echo "  (pembersihan dilewati)"
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
