#!/usr/bin/env bash
# Rilis MANUAL Delivery Control FINAL (modul operasional: Dashboard, Driver/Helper, Rute, Tracking, Masalah/jadwal ulang, Performa;
# Biaya Armada: uang muka, verifikasi bukti, bayar) ke produksi dengan workflow RELEASE-DIRECTORY (~/releases/klinik-matras/<sha8>).
# Baseline produksi = main 8d9bc722 (produksi dan main sudah sama). Target = branch release/delivery-control-final. Jalankan OPERATOR di VPS:
#
#   git show release/delivery-control-final:scripts/release-delivery-control-final.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/rdcf.sh && bash /tmp/rdcf.sh --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rdcf.sh'                                # setelah GO
#
# Rilis ini TIDAK punya migration (pending harus kosong), tidak mengubah schema/ledger/route Job-Route, dan tidak menyentuh driver-mobile
# maupun frontend/dist. Yang berubah hanya backend/src/services/capabilities.js (izin modul, aditif) dan
# backend/src/services/expenseSubmission/service.js (finExpense.adaBukti/createdById/receiptVerifiedAt; path bukti TIDAK dikirim).
# TIDAK memakai dan TIDAK mengubah checkout ~/klinik-matras. Release aktif sebelumnya tidak ditimpa. Smoke HANYA MEMBACA.
# Prinsip: fail-fast; tanpa reset/stash/force; tanpa rollback otomatis (hanya instruksi); tanpa secret di layar; satu-satunya DROP
# adalah DB sementara verifikasi restore milik skrip ini.
set -Eeuo pipefail
umask 077

# ── Konstanta rilis (dikunci saat persiapan; ubah = rilis baru) ──────────────────────────────────────────
PROD_FULL="8d9bc7224ef9133551dcdab3e5d9dcf6761c9864"     # commit produksi aktif = baseline (sama dengan main)
MAIN_TIP="8d9bc7224ef9133551dcdab3e5d9dcf6761c9864"      # origin/main yang dibekukan saat persiapan; HARUS masih ini
DEPLOY_SHA="272392ba396ad236681c36c23c0f2cbf3cb0f836"    # merge Delivery Control final di atas MAIN_TIP (diuji: full integration 1x)
RELEASE_BRANCH="release/delivery-control-final"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
PROJECT="klinik-matras"
DB_USER="klinik"
DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"          # root persisten produksi (HANYA dibaca/di-mount; tidak diubah)
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"

PREFLIGHT_ONLY=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done

TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/dcfinal-${DEPLOY_SHORT}-${TS}"
PHASE="init"
BACKUP_FILE=""
ROLLBACK_TAG=""
PREV_DIR=""
PREV_COMMIT=""
PREV_IMG_ID=""
IMG_NAME=""
VERIFY_DB=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

sg()   { git --git-dir="$SRC" "$@"; }
# docker compose pada release-dir tertentu (satu-satunya cara memanggil compose di skrip ini)
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
CDIR=""   # release-dir untuk psql: PREV_DIR sebelum switch, NEW_DIR sesudahnya
psql_live() { dcp "${CDIR:-$PREV_DIR}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }

rollback_instructions() {
  cat <<EOF

────────────────────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────────────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>}  (commit ${PREV_COMMIT:-?}); TIDAK dihapus/ditimpa
Release baru       : ${NEW_DIR}
Image sebelumnya   : ${ROLLBACK_TAG:-<belum ditandai>}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}  (+ .sha256)

A. Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.
   Rilis ini tanpa migration; tidak ada perubahan skema yang perlu dipikirkan.
   Perbaiki penyebab lalu jalankan ulang (skrip menolak bila ${NEW_DIR} sudah ada; pindahkan/hapus manual setelah dicek).

B. Setelah switch, backend bermasalah -> kembali ke release + image sebelumnya (tanpa build ulang):
   1) Periksa dulu (informasi):
      docker compose -p ${PROJECT} exec -T postgres psql -U ${DB_USER} -d ${DB_NAME} -c "select count(*) from expense_submissions where status='PERLU_REVISI'"
      (informasi saja: rilis ini tanpa migration, jadi rollback image tidak menyentuh skema).
   2) cd ${PREV_DIR:-<release-sebelumnya>}
      docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
      SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps backend
      curl -fsS ${INTERNAL_URL}/api/health
      (frontend ikut kembali: dist di-mount dari release-dir yang dipakai container)

C. main tidak diubah oleh skrip ini. Revert permanen (bila perlu) lewat commit revert biasa, tanpa reset/force.

D. Database: TIDAK ada downgrade migration dan TIDAK ada penghapusan data. Restore dari backup hanya jalan terakhir dan wajib
   persetujuan pemilik (docs/PANDUAN-RESTORE-BACKUP.md bagian 6).
──────────────────────────────────────────────────────────────────────────────────────────────────────────
EOF
}

cleanup() {
  local rc=$?
  if [ -n "$VERIFY_DB" ] && [[ "$VERIFY_DB" =~ ^km_release_verify_[0-9]{8}_[0-9]{6}$ ]] && [ -n "$PREV_DIR" ]; then
    dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" --if-exists "$VERIFY_DB" </dev/null >/dev/null 2>&1 || warn "gagal menghapus DB sementara ${VERIFY_DB} (hapus manual: dropdb ${VERIFY_DB})"
  fi
  if [ $rc -ne 0 ]; then
    printf '\n\033[31mRILIS BERHENTI (kode %s) pada fase: %s. Tidak ada rollback otomatis.\033[0m\n' "$rc" "$PHASE" >&2
    [ "$PREFLIGHT_ONLY" = "1" ] || rollback_instructions >&2
  fi
}
trap cleanup EXIT

# ── 0. Lingkungan ────────────────────────────────────────────────────────────────────────────────────────
PHASE="0-lingkungan"
say "0. Lingkungan"
for c in git docker curl gzip sha256sum awk grep flock tar sed df comm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
docker compose version >/dev/null 2>&1 || die "docker compose tidak tersedia"
exec 9>/tmp/release-dcfinal.lock
flock -n 9 || die "rilis lain sedang berjalan (kunci /tmp/release-dcfinal.lock)"
mkdir -p "$BK_DIR" "$HOME/release-src"
LOG="$BK_DIR/release.log"
exec > >(tee -a "$LOG") 2>&1
ok "log: ${LOG}"
[ -d "$RELEASES" ] || die "direktori rilis ${RELEASES} tidak ada"
[ -f "$PERSIST/backend/.env" ] || die "${PERSIST}/backend/.env tidak ada"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
ok "root persisten ${PERSIST} lengkap (.env, dist-driver, uploads, data)"
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa). Periksa isinya; pindahkan/hapus manual bila sisa rilis gagal"

# ── 1. Sumber kode (cache git terpisah; BUKAN ~/klinik-matras) ───────────────────────────────────────────
PHASE="1-sumber"
say "1. Sumber kode dan validasi SHA"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=500 origin "+refs/heads/main:refs/remotes/origin/main" "+refs/heads/${RELEASE_BRANCH}:refs/remotes/origin/${RELEASE_BRANCH}" || die "git fetch origin gagal"
ORIGIN_MAIN="$(sg rev-parse refs/remotes/origin/main)"
[ "$ORIGIN_MAIN" = "$MAIN_TIP" ] || die "origin/main berubah: ${ORIGIN_MAIN:0:8} (dibekukan ${MAIN_TIP:0:8}). Berhenti tanpa force/test ulang; laporkan commit baru"
ok "origin/main = ${MAIN_TIP:0:8} (dibekukan)"
sg cat-file -e "${DEPLOY_SHA}^{commit}" 2>/dev/null || die "SHA rilis ${DEPLOY_SHA} tidak ada di ${RELEASE_BRANCH}"
sg merge-base --is-ancestor "$DEPLOY_SHA" "refs/remotes/origin/${RELEASE_BRANCH}" || die "SHA rilis bukan bagian dari origin/${RELEASE_BRANCH}"
sg merge-base --is-ancestor "$PROD_FULL" "$MAIN_TIP" || die "baseline produksi ${PROD_FULL:0:8} BUKAN leluhur main ${MAIN_TIP:0:8}"
sg merge-base --is-ancestor "$MAIN_TIP" "$DEPLOY_SHA" || die "main ${MAIN_TIP:0:8} BUKAN leluhur SHA rilis (perubahan main terbaru tidak termuat penuh)"
ok "ancestry aman: produksi ${PROD_FULL:0:8} -> main ${MAIN_TIP:0:8} -> rilis ${DEPLOY_SHORT}"

say "1b. Batas perubahan: main sejak produksi (harus persis yang diaudit) dan tambahan Delivery Control"
[ "$PROD_FULL" = "$MAIN_TIP" ] || die "baseline produksi (${PROD_FULL:0:8}) tidak sama dengan main dibekukan (${MAIN_TIP:0:8}): rilis ini dirancang untuk produksi = main"
ok "produksi = main ${MAIN_TIP:0:8}; rilis hanya menambah Delivery Control di atasnya"
[ -z "$(sg diff --name-only "$MAIN_TIP" "$DEPLOY_SHA" -- driver-mobile frontend backend/prisma backend/src/routes backend/src/constants backend/src/index.js backend/src/services/finance backend/Dockerfile docker-compose.yml docker-compose.release.yml)" ] \
  || die "rilis mengubah area di luar scope (driver-mobile/frontend/schema+migration/routes/permissions/index/finance/Docker)"
ok "Delivery Control TIDAK menyentuh driver-mobile, frontend, schema/migration, route (Job/Route), permissions, ledger/finance, Docker"
DELETED="$(sg diff --name-status --diff-filter=D "$MAIN_TIP" "$DEPLOY_SHA" || true)"
[ -z "$DELETED" ] || die "ada file dihapus: ${DELETED}"
BACKEND_SRC="$(sg diff --name-only "$MAIN_TIP" "$DEPLOY_SHA" -- backend/src | LC_ALL=C sort | tr '\n' ' ')"
[ "$BACKEND_SRC" = "backend/src/services/capabilities.js backend/src/services/expenseSubmission/service.js " ] || die "perubahan backend/src tidak sama dengan yang diaudit: ${BACKEND_SRC}"
ok "backend/src hanya: services/capabilities.js (izin modul, aditif) dan services/expenseSubmission/service.js (finExpense.adaBukti/createdById/receiptVerifiedAt, tanpa path bukti)"
OUT_SCOPE="$(sg diff --name-only "$MAIN_TIP" "$DEPLOY_SHA" | grep -Ev '^(delivery-control/|packages/delivery-shared/|docs/|backend/tests/|backend/src/services/(capabilities\.js|expenseSubmission/service\.js)$)' || true)"
[ -z "$OUT_SCOPE" ] || die "berkas di luar scope Delivery Control: ${OUT_SCOPE}"
ok "seluruh perubahan Delivery Control berada di delivery-control/, packages/delivery-shared/, docs/, tests, dan dua berkas backend di atas"
NEWMIG="$(sg diff --name-only "$MAIN_TIP" "$DEPLOY_SHA" -- backend/prisma/migrations)"
[ -z "$NEWMIG" ] || die "rilis ini TIDAK boleh menambah/mengubah migration: ${NEWMIG}"
ok "tidak ada migration baru; schema.prisma tidak berubah"
sg show "${DEPLOY_SHA}:docs/DELIVERY-CONTROL-APK-PREVIEW-QA.md" | grep 'Uang Muka' >/dev/null || die "checklist QA modul tidak ada"
ok "checklist QA final ada"

say "1c. Frontend: tidak berubah oleh rilis ini -> dist release produksi aktif dipakai ulang APA ADANYA"
[ -z "$(sg diff --name-only "$MAIN_TIP" "$DEPLOY_SHA" -- frontend)" ] || die "frontend berubah pada rilis ini (di luar scope)"
ok "frontend/ identik dengan main; dist tidak dibangun ulang. Catatan: dist ter-commit di git dapat berbeda dari build produksi, karena itu dist produksi yang disalin"

# ── 2. Audit produksi (baca-saja) ────────────────────────────────────────────────────────────────────────
PHASE="2-audit-produksi"
say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend project ${PROJECT}"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$PROD_FULL" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${PROD_FULL:0:8}; produksi bergeser, hentikan"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"
IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
CDIR="$PREV_DIR"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT} = baseline); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "produksi publik (${PUB_BEFORE}) tidak sama dengan dist release aktif (${PREV_INDEX})"
ok "health internal/publik sehat; bundel publik = dist release aktif (${PUB_BEFORE})"
DIST_INDEX="$PREV_INDEX"
PR_BASENAME="$(grep -l 'Perlu Revisi' "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p | xargs -r basename)"
[ -n "$PR_BASENAME" ] || die "dist release aktif tidak memuat label 'Perlu Revisi' pada chunk mana pun"
for kata in "PERLU_REVISI" "Status tidak dikenal"; do
  [ -n "$(grep -l "$kata" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist produksi tidak memuat '${kata}'"
done
ok "dist produksi memuat PERLU_REVISI (${PR_BASENAME}); bundel utama ${DIST_INDEX} akan dipertahankan"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
IDS_BEFORE="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" | sort | tr '\n' ' ')"

say "2b. Migration: applied vs pending (pending harus TEPAT migration main yang diaudit)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung di produksi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort > "$BK_DIR/applied.txt"
sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's#backend/prisma/migrations/##' | grep -E '^[0-9]{14}_' | LC_ALL=C sort > "$BK_DIR/tree.txt"
PENDING="$(LC_ALL=C comm -13 "$BK_DIR/applied.txt" "$BK_DIR/tree.txt")"
AHEAD="$(LC_ALL=C comm -23 "$BK_DIR/applied.txt" "$BK_DIR/tree.txt")"
[ -z "$AHEAD" ] || die "DB memuat migration yang tidak ada di kode rilis: $(printf '%s' "$AHEAD" | tr '\n' ' ')"
[ -z "$PENDING" ] || die "ada migration pending padahal rilis ini tidak punya migration: $(printf '%s' "$PENDING" | tr '\n' ' ')"
for m in 20260924110000_expense_submission_perlu_revisi 20260926090000_persediaan_awal_cutover 20260927150000_user_divisions 20260927170000_coa_bagi_hasil_investor; do
  grep -Fx "$m" "$BK_DIR/applied.txt" >/dev/null || die "migration ${m} belum applied di produksi (baseline tidak sesuai)"
done
ok "applied $(wc -l < "$BK_DIR/applied.txt") migration (termasuk PERLU_REVISI, persediaan awal, user_divisions, COA bagi hasil); pending: TIDAK ADA"
[ "$(psql_live -At -c "select count(*) from expense_submissions where status='PERLU_REVISI'")" -ge 0 ] || die "kolom PERLU_REVISI tidak terbaca"
ok "skema Delivery Control (PERLU_REVISI) terbaca di produksi"

say "2c. Sumber daya"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"
AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
NEED_KB=$(( DB_BYTES / 1024 * 3 + 6 * 1024 * 1024 ))
[ "$AVAIL_KB" -ge "$NEED_KB" ] || die "ruang disk kurang (tersedia ${AVAIL_KB} KB, butuh ${NEED_KB} KB)"
ok "ruang disk cukup (db ${DB_BYTES} byte)"

if [ "$PREFLIGHT_ONLY" = "1" ]; then
  say "Preflight selesai (--preflight-only): produksi TIDAK diubah (hanya log ${LOG} dan cache git ${SRC})"
  exit 0
fi

# ── 3. Backup + verifikasi restore ───────────────────────────────────────────────────────────────────────
PHASE="3-backup"
say "3. Backup produksi + checksum + verifikasi restore ke database sementara"
BACKUP_FILE="$BK_DIR/klinik_matras_prerelease_dcfinal_${DEPLOY_SHORT}_${TS}.sql.gz"
COUNTS_SQL="select table_name||'|'||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
psql_live -At -c "$COUNTS_SQL" > "$BK_DIR/.counts_before.txt"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak (gzip -t gagal)"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$BK_DIR" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal diverifikasi"
psql_live -At -c "$COUNTS_SQL" > "$BK_DIR/.counts_after.txt"
SHA256="$(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 ${SHA256}"

PHASE="3b-verifikasi-restore"
VERIFY_DB="km_release_verify_${TS}"
[[ "$VERIFY_DB" =~ ^km_release_verify_[0-9]{8}_[0-9]{6}$ ]] || die "nama DB verifikasi tidak aman"
dcp "$PREV_DIR" exec -T postgres createdb -U "$DB_USER" "$VERIFY_DB" </dev/null || die "gagal membuat DB sementara"
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -X -q -o /dev/null || die "restore ke DB sementara GAGAL"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -c "$COUNTS_SQL" </dev/null > "$BK_DIR/.counts_restored.txt" || die "gagal menghitung baris hasil restore"
diff -q <(cut -d'|' -f1 "$BK_DIR/.counts_before.txt") <(cut -d'|' -f1 "$BK_DIR/.counts_restored.txt") >/dev/null || die "daftar tabel hasil restore berbeda dari produksi"
BAD="$(awk -F'|' 'NR==FNR{b[$1]=$2;next} FILENAME==ARGV[2]{a[$1]=$2;next} {t=$1; r=$2; d=r-b[t]; if(d<0)d=-d; lim=b[t]*0.02; if(lim<25)lim=25; if(d>lim && !(r>=b[t] && r<=a[t]) && !(r<=b[t] && r>=a[t])) print t": produksi(sebelum)="b[t]" sesudah="a[t]" restore="r}' "$BK_DIR/.counts_before.txt" "$BK_DIR/.counts_after.txt" "$BK_DIR/.counts_restored.txt")"
[ -z "$BAD" ] || die "jumlah baris hasil restore tidak cocok: ${BAD}"
MIG_LIVE="$(psql_live -At -c 'select count(*) from _prisma_migrations')"
MIG_REST="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -c 'select count(*) from _prisma_migrations' </dev/null)"
[ "$MIG_LIVE" = "$MIG_REST" ] || die "_prisma_migrations berbeda: produksi ${MIG_LIVE}, restore ${MIG_REST}"
ok "restore terverifikasi: $(wc -l < "$BK_DIR/.counts_restored.txt") tabel cocok; _prisma_migrations ${MIG_REST} baris"
dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" "$VERIFY_DB" </dev/null && VERIFY_DB="" && ok "DB sementara dihapus"
rm -f "$BK_DIR"/.counts_*.txt
if command -v rclone >/dev/null 2>&1; then
  { rclone copy "$BACKUP_FILE" gdrive:klinik-matras-backups/ && rclone copy "${BACKUP_FILE}.sha256" gdrive:klinik-matras-backups/; } >/dev/null 2>&1 \
    && ok "salinan offsite (Google Drive) diunggah (tanpa pembersihan)" \
    || { [ "${REQUIRE_OFFSITE:-0}" = "1" ] && die "unggah offsite gagal"; warn "unggah offsite gagal (lanjut; lokal + checksum valid)"; }
else
  [ "${REQUIRE_OFFSITE:-0}" = "1" ] && die "rclone tidak ada"; warn "rclone tidak ada; hanya backup lokal"
fi

# ── 4. Release dir baru ──────────────────────────────────────────────────────────────────────────────────
PHASE="4-release-dir"
say "4. Release dir ${NEW_DIR} (export git SHA rilis; release aktif tidak disentuh)"
[ "$(sg ls-remote origin refs/heads/main | cut -f1)" = "$DEPLOY_SHA" ] || die "origin/main berubah selama backup; hentikan dan laporkan"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin dist produksi"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/dist/index.html; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"
[ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
grep "$DIST_INDEX" "$NEW_DIR/frontend/dist/index.html" >/dev/null || die "dist di release dir tidak merujuk ${DIST_INDEX}"
[ -f "$NEW_DIR/frontend/dist/assets/${PR_BASENAME}" ] || die "chunk PERLU_REVISI tidak ada di release dir"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
ok "release dir dibuat; backend/.env -> ${PERSIST}/backend/.env; dist = salinan dist produksi aktif (${DIST_INDEX})"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif; tinjau manual"
ok "docker-compose.release.yml identik dengan release aktif"

# ── 5. Build image baru (backend lama tetap melayani) ────────────────────────────────────────────────────
PHASE="5-build-image"
say "5. Build image backend baru tanpa mengganti release aktif"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-dcfinal-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"
ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan; log ${BK_DIR}/build.log)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama (tidak diharapkan: kode berubah)"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

# ── 6. Migration sebelum switch ──────────────────────────────────────────────────────────────────────────
PHASE="6-migrate"
say "6. prisma migrate deploy (image baru; harus no-op karena tidak ada migration pending)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null || true
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration setengah jalan; JANGAN switch"
[ "$(psql_live -At -c 'select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null')" = "$(wc -l < "$BK_DIR/applied.txt")" ] || die "jumlah migration applied berubah setelah migrate deploy (seharusnya no-op)"
ok "migrate deploy = no-op (jumlah applied tetap $(wc -l < "$BK_DIR/applied.txt")); tidak ada migration menggantung"

# ── 7. Switch backend ────────────────────────────────────────────────────────────────────────────────────
PHASE="7-switch"
say "7. Switch backend ke release baru"
SWITCH_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0
for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
CDIR="$NEW_DIR"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

# ── 8. Healthcheck ───────────────────────────────────────────────────────────────────────────────────────
PHASE="8-healthcheck"
say "8. Healthcheck internal dan publik + artefak frontend"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal gagal"
ok "internal: ${INTERNAL_URL}/api/health"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"
ok "publik: ${PUBLIC_URL}/api/health"
PUB_INDEX="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
[ "$PUB_INDEX" = "$DIST_INDEX" ] || die "bundel publik (${PUB_INDEX:-kosong}) tidak sama dengan dist rilis (${DIST_INDEX})"
ok "bundel web publik = ${PUB_INDEX}"
curl -fsS --max-time 20 "${PUBLIC_URL}/assets/${PR_BASENAME}" | grep 'Perlu Revisi' >/dev/null || die "chunk PERLU_REVISI tidak terlayani publik"
ok "web publik melayani PERLU_REVISI (${PR_BASENAME}); bundel publik tidak berubah oleh rilis ini"
IDS_AFTER="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" | sort | tr '\n' ' ')"
DIFFN="$(comm -3 <(printf '%s\n' $IDS_BEFORE) <(printf '%s\n' $IDS_AFTER) | grep -c . || true)"
[ "$DIFFN" = "2" ] || warn "container lain di project berubah (selisih ${DIFFN}; diharapkan hanya backend: 2 baris)"

# ── 9. Smoke test (BACA-SAJA; token 10 menit dibuat di dalam container, tidak pernah dicetak) ────────────
PHASE="9-smoke"
say "9. Smoke test seluruh modul Delivery Control + RBAC (baca-saja)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
const OWN = ["DRIVER", "HELPER", "LEADER_DRIVER"];
let fail = 0, skip = 0;
const rec = (name, ok, detail = "") => {
  if (ok === null) skip++; else if (!ok) fail++;
  console.log(`  ${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method, redirect: "manual",
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
async function rolesOf(user) {
  const rows = await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } });
  return rows.length ? rows.map((r) => r.role) : [user.role];
}
async function withToken(user) {
  const roles = await rolesOf(user);
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role, roles }, process.env.JWT_SECRET, { expiresIn: "10m" });
  return { user, roles, token };
}
async function pick(role, { pure, notId } = {}) {
  let users = [];
  try { users = (await prisma.userRole.findMany({ where: { role, user: { active: true } }, include: { user: true }, take: 60 })).map((r) => r.user); } catch { /* enum tak dikenal */ }
  if (!users.length) { try { users = await prisma.user.findMany({ where: { role, active: true }, take: 60 }); } catch { /* */ } }
  for (const u of users) {
    if (notId && u.id === notId) continue;
    const t = await withToken(u);
    if (!pure || t.roles.every((x) => OWN.includes(x))) return t;
  }
  return null;
}
const rows = (j) => (Array.isArray(j) ? j : j?.items || j?.data || j?.submissions || []);

// 1) Role yang boleh Control
for (const role of ["ADMIN", "OWNER", "DISPATCHER"]) {
  const t = await pick(role);
  if (!t) { rec(`${role}: akun uji`, null, "tidak ada akun aktif dengan role ini"); continue; }
  const me = await api("GET", "/api/auth/me", t.token);
  rec(`${role}: /auth/me kompatibel (capabilities lama + deliveryControlApp)`, me.status === 200 && me.json?.capabilities && "financeRead" in me.json.capabilities && "preset" in me.json.capabilities && me.json.capabilities.deliveryControlApp === true, `status ${me.status}`);
  const s = await api("GET", "/api/delivery-control/session", t.token);
  rec(`${role}: GET /delivery-control/session -> 200`, s.status === 200 && Array.isArray(s.json?.roles), `status ${s.status}`);
  if (role === "ADMIN" || role === "OWNER") {
    const l = await api("GET", "/api/finance/expense-submissions?division=DELIVERY&status=PERLU_REVISI&limit=5", t.token);
    rec(`${role}: filter status=PERLU_REVISI diterima server (200)`, l.status === 200, `status ${l.status}, ${rows(l.json).length} baris`);
  }
}

// 2) Role own-only harus ditolak dari Control dan terkurung di DELIVERY milik sendiri
const ownUsers = [];
for (const role of OWN) {
  const t = await pick(role, { pure: true });
  if (!t) { rec(`${role}: akun uji (hanya role itu)`, null, "tidak ada akun aktif dengan role murni ini"); continue; }
  ownUsers.push(t);
  const s = await api("GET", "/api/delivery-control/session", t.token);
  rec(`${role}: ditolak dari Control (403)`, s.status === 403, `status ${s.status}`);
  const me = await api("GET", "/api/auth/me", t.token);
  const c = me.json?.capabilities || {};
  rec(`${role}: capabilities own-only (control=false, financeRead=false, deliveryExpenseOwn.write=true)`, me.status === 200 && c.deliveryControlApp === false && c.financeRead === false && c.deliveryExpenseOwn?.write === true);
  const cfg = await api("GET", "/api/finance/expense-submissions/config?workspace=DELIVERY", t.token);
  rec(`${role}: config DELIVERY 200 dan tanpa ambang auto-approve`, cfg.status === 200 && !cfg.json?.autoApprove, `status ${cfg.status}`);
  const bad = await api("GET", "/api/finance/expense-submissions/config?workspace=FINANCE", t.token);
  rec(`${role}: workspace selain DELIVERY ditolak (403)`, bad.status === 403, `status ${bad.status}`);
  const fin = await api("GET", "/api/finance/accounts", t.token);
  rec(`${role}: data Finance (finance:read) ditolak (403)`, fin.status === 403, `status ${fin.status}`);
  const l = await api("GET", "/api/finance/expense-submissions?division=FINANCE&limit=50", t.token);
  const rs = rows(l.json);
  rec(`${role}: daftar pengajuan hanya DELIVERY milik sendiri`, l.status === 200 && rs.every((r) => r.division === "DELIVERY" && (r.requestedById === t.user.id || r.createdById === t.user.id)), `${rs.length} baris`);
}
const noAuth = await api("GET", "/api/delivery-control/session", null);
rec("tanpa token ditolak (401)", noAuth.status === 401, `status ${noAuth.status}`);

// 3) Foto struk milik sendiri (signed URL) vs milik orang lain
let target = null;
const proofs = await prisma.expenseSubmissionProof.findMany({
  where: { supersededAt: null, submission: { division: "DELIVERY" } },
  include: { submission: true }, orderBy: { createdAt: "desc" }, take: 80,
});
for (const p of proofs) {
  const uid = p.submission.requestedById || p.submission.createdById;
  if (!uid) continue;
  const u = await prisma.user.findUnique({ where: { id: uid } });
  if (!u || u.active === false) continue;
  const t = await withToken(u);
  if (t.roles.every((x) => OWN.includes(x))) { target = { p, t }; break; }
}
if (!target) {
  rec("foto struk milik sendiri via signed URL", null, "belum ada bukti pengajuan DELIVERY milik akun own-only di produksi; TIDAK membuat data uji -> uji manual dari HP/web setelah ada foto");
} else {
  const { p, t } = target;
  const sg = await api("POST", "/api/finance/media/sign", t.token, { urls: [p.url] });
  const item = sg.json?.signed?.[p.url];
  rec("pemilik: URL bertanda-tangan diterbitkan", sg.status === 200 && !!item?.url && !!item?.expiresAt, `status ${sg.status}`);
  if (item?.url) {
    rec("URL tidak membocorkan path penyimpanan", !/\/app\/|data\/finance-receipts|\\|\.\./.test(item.url));
    const ttl = (new Date(item.expiresAt).getTime() - Date.now()) / 1000;
    rec("URL berumur pendek (<= 10 menit)", ttl > 0 && ttl <= 601, `${Math.round(ttl)} dtk`);
    const img = await fetch(BASE + item.url);
    rec("pemilik: URL bertanda-tangan membuka foto (200, image)", img.status === 200 && /image\//.test(img.headers.get("content-type") || ""), `status ${img.status}`);
    const tampered = item.url.replace(/sig=([0-9a-f]+)/, (m, s) => "sig=" + (s.slice(0, -1) + (s.slice(-1) === "0" ? "1" : "0")));
    const tr = await fetch(BASE + tampered);
    rec("tanda-tangan diubah ditolak (403)", tr.status === 403, `status ${tr.status}`);
    const expired = item.url.replace(/exp=\d+/, "exp=1");
    const er = await fetch(BASE + expired);
    rec("URL kedaluwarsa ditolak (403)", er.status === 403, `status ${er.status}`);
    const bare = await fetch(BASE + item.url.split("?")[0]);
    rec("tanpa tanda-tangan/token ditolak (401/403)", bare.status === 401 || bare.status === 403, `status ${bare.status}`);
  }
  let lain = null;
  for (const role of OWN) { const o = await pick(role, { pure: true, notId: t.user.id }); if (o) { lain = o; break; } }
  if (!lain) rec("milik orang lain ditolak", null, "tidak ada akun own-only kedua untuk uji silang");
  else {
    const so = await api("POST", "/api/finance/media/sign", lain.token, { urls: [p.url] });
    rec("akun own-only LAIN tidak mendapat URL untuk foto itu", so.status === 200 && !so.json?.signed?.[p.url], `status ${so.status}`);
  }
}

const adm = await pick("ADMIN");

// 5) Modul operasional Control (BACA-SAJA): capability server + endpoint /armada/* yang ada
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const modul = ["dashboard", "drivers", "routes", "tracking", "issues", "reschedule", "performance"];
for (const role of ["ADMIN", "OWNER", "DISPATCHER"]) {
  const t = await pick(role);
  if (!t) continue; // SKIP sudah dicatat di bagian 1
  const me = await api("GET", "/api/auth/me", t.token);
  const dc = me.json?.capabilities?.deliveryControl || {};
  rec(`${role}: capabilities.deliveryControl memuat ketujuh modul (true)`, modul.every((k) => dc[k] === true), modul.filter((k) => dc[k] !== true).join(",") || "lengkap");
}
const kel = (await pick("ADMIN")) || (await pick("OWNER"));
if (!kel) rec("modul operasional: akun Admin/Owner", null, "tidak ada akun uji");
else {
  const cek = async (nama, path, ok = (j) => j != null) => { const r = await api("GET", path, kel.token); rec(`modul: ${nama} -> 200`, r.status === 200 && ok(r.json), `status ${r.status}`); return r; };
  await cek("Dashboard papan pengiriman", `/api/armada/board?date=${hariIni}&type=DELIVERY`, (j) => Array.isArray(j?.jobs) && Array.isArray(j?.available));
  await cek("Dashboard papan pengambilan", `/api/armada/board?date=${hariIni}&type=PICKUP`, (j) => Array.isArray(j?.jobs));
  await cek("Rute per tanggal", `/api/armada/routes?date=${hariIni}`, (j) => Array.isArray(j?.routes));
  await cek("Driver", "/api/armada/drivers", Array.isArray);
  await cek("Helper", "/api/armada/helpers", Array.isArray);
  await cek("Tracking", "/api/armada/tracking", Array.isArray);
  await cek("Masalah (gagal)", "/api/armada/issues?status=OPEN", (j) => Array.isArray(j?.jobs));
  await cek("Masalah (jadwal ulang)", "/api/armada/issues?status=RESCHEDULED", (j) => Array.isArray(j?.jobs));
  await cek("Performa/insentif", `/api/armada/incentive-summary?from=${hariIni.slice(0, 7)}-01&to=${hariIni}`, (j) => Array.isArray(j?.orang) && j?.ratePerAlamat != null);
  await cek("Kendaraan (form jadwal ulang)", "/api/armada/vehicles");
  await cek("Rekening kas (Bayar)", "/api/finance/cash-accounts", (j) => Array.isArray(j?.accounts) && Array.isArray(j?.jenisBiayaTransfer));
  await cek("Uang muka aktif", "/api/finance/expense-submissions/uang-muka-aktif", (j) => Array.isArray(j?.items));
  const daf = await api("GET", "/api/finance/expense-submissions?division=DELIVERY&limit=20", kel.token);
  const rows = Array.isArray(daf.json) ? daf.json : daf.json?.submissions || [];
  rec("daftar pengajuan: finExpense tidak membocorkan path bukti (receiptUrl)", daf.status === 200 && rows.every((r) => !r.finExpense || !("receiptUrl" in r.finExpense)), `${rows.length} baris`);
  const punyaFin = rows.find((r) => r.finExpense);
  if (!punyaFin) rec("detail pengajuan: finExpense.adaBukti/receiptVerifiedAt/createdById", null, "belum ada pengajuan Delivery berdokumen Finance; TIDAK membuat data uji");
  else {
    const d = await api("GET", `/api/finance/expense-submissions/${punyaFin.id}`, kel.token);
    const fe = d.json?.finExpense || {};
    rec("detail pengajuan: finExpense.adaBukti/receiptVerifiedAt/createdById ada, receiptUrl tidak dikirim", d.status === 200 && typeof fe.adaBukti === "boolean" && "receiptVerifiedAt" in fe && "createdById" in fe && !("receiptUrl" in fe));
  }
}
// Peran own-only harus ditolak dari SELURUH endpoint operasional (server, bukan UI)
if (ownUsers[0]) {
  for (const [nama, path] of [["board", `/api/armada/board?date=${hariIni}&type=DELIVERY`], ["routes", `/api/armada/routes?date=${hariIni}`], ["drivers", "/api/armada/drivers"], ["tracking", "/api/armada/tracking"], ["incentive-summary(semua orang)", `/api/armada/incentive-summary?from=${hariIni}&to=${hariIni}`], ["cash-accounts", "/api/finance/cash-accounts"]]) {
    const r = await api("GET", path, ownUsers[0].token);
    // incentive-summary boleh untuk job:own:read tetapi HANYA data diri sendiri; endpoint lain wajib 403
    const ok = nama.startsWith("incentive") ? r.status === 200 && (r.json?.orang || []).every((o) => o.id === ownUsers[0].user.id) : r.status === 403;
    rec(`own-only: ${nama} ${nama.startsWith("incentive") ? "hanya data sendiri" : "ditolak (403)"}`, ok, `status ${r.status}`);
  }
}
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal, ${skip} dilewati`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus (baris SKIP di atas = perlu uji manual)"

# ── 10. Log ──────────────────────────────────────────────────────────────────────────────────────────────
PHASE="10-log"
say "10. Log backend sejak switch (${SWITCH_AT})"
LOGS="$(dcp "$NEW_DIR" logs --since "$SWITCH_AT" --no-color backend </dev/null 2>&1 | cut -c1-240 || true)"
FATAL="$(printf '%s\n' "$LOGS" | grep -Ei 'P2021|P2022|does not exist|PrismaClientInitializationError|Cannot find module|EADDRINUSE' || true)"
[ -z "$FATAL" ] || { printf '%s\n' "$FATAL" | sed -n 1,10p; die "log backend memuat error skema/inisialisasi"; }
ERRN="$(printf '%s\n' "$LOGS" | grep -Eic 'error|exception|unhandled' || true)"
ok "tanpa error skema/inisialisasi; baris berisi 'error/exception': ${ERRN}"
[ "$ERRN" = "0" ] || { warn "contoh baris (maks 8):"; printf '%s\n' "$LOGS" | grep -Ei 'error|exception|unhandled' | sed -n 1,8p | sed 's/^/        /'; }
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung setelah rilis"
ok "tidak ada migration menggantung"

# ── 11. main tidak diubah ────────────────────────────────────────────────────────────────────────────────
PHASE="11-status-main"
say "11. Status main"
sg fetch -q origin "+refs/heads/main:refs/remotes/origin/main" || warn "fetch ulang gagal"
ok "origin/main = $(sg rev-parse --short refs/remotes/origin/main) (skrip ini tidak mem-push apa pun; produksi = ${DEPLOY_SHORT})"

PHASE="12-selesai"
say "12. Ringkasan"
dcp "$NEW_DIR" ps </dev/null
cat <<EOF

RILIS DELIVERY CONTROL FINAL SELESAI.
  release aktif : ${NEW_DIR}  (commit ${DEPLOY_SHA})
  release lama  : ${PREV_DIR}  (commit ${PREV_COMMIT}; tidak dihapus)
  image lama    : ${ROLLBACK_TAG}
  backup        : ${BACKUP_FILE}
  sha256        : ${SHA256}
  log           : ${LOG}
  Schema, migration, ledger, route Job/Route, frontend web, OTA/EAS/APK, Driver App : TIDAK disentuh
Kirim kembali ke pemilik: isi ${LOG} (tanpa secret) + hasil 'docker compose -p ${PROJECT} ps'.
EOF
trap - EXIT
exit 0
