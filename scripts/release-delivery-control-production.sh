#!/usr/bin/env bash
# Rilis MANUAL feat/delivery-control-app (Sano Delivery Control + PERLU_REVISI + own-only) ke produksi.
#
# Dijalankan OPERATOR di VPS, dari ~/klinik-matras. Tidak ada yang berjalan otomatis.
#   bash release-delivery-control-production.sh --preflight-only   # hanya pengecekan; TIDAK mengubah produksi (hanya menulis log di backups/
#   bash release-delivery-control-production.sh                     # rilis penuh
#
# Prinsip: fail-fast; tidak ada reset/stash/force; tidak ada rollback otomatis (hanya instruksi);
# tidak ada penghapusan data (satu-satunya DROP: database sementara verifikasi restore milik skrip ini,
# bernama km_release_verify_<waktu>); tidak mencetak secret (tanpa set -x, tanpa dump env/compose config).
#
# Urutan: preflight -> backup + verifikasi restore -> fast-forward main -> cek dist -> build image baru
#         (backend lama TETAP jalan) -> migrate deploy dengan image baru -> switch backend -> healthcheck -> smoke.
set -Eeuo pipefail
umask 077

# ── Konstanta rilis (dikunci pada saat persiapan) ────────────────────────────────────────────────────────
OLD_MAIN_SHORT="f0e406a7"
OLD_MAIN_FULL="f0e406a7767a98a40c86daeb3bb15169b8d7917c"
MERGE_SHA="b8047bb39cf87fd78b5b7fe6de8a431a6a1de27a"     # merge --no-ff: parent1 = main lama, parent2 = b552a252
DEPLOY_SHA="69ef90ceab60b26f0fc6fc214f3cc0f9ed0dd294"    # MERGE_SHA + satu commit build frontend/dist (worktree bersih)
RELEASE_BRANCH="release/merge-delivery-control"
MIGRATION="20260924110000_expense_submission_perlu_revisi"
APP_DIR="${RELEASE_APP_DIR:-$HOME/klinik-matras}"
PUBLIC_URL="${RELEASE_PUBLIC_URL:-https://app.sanomatrassehat.com}"
INTERNAL_URL="http://127.0.0.1:4000"
DB_USER="klinik"
DB_NAME="klinik_matras"

PREFLIGHT_ONLY=0
[ "${1:-}" = "--preflight-only" ] && PREFLIGHT_ONLY=1

TS="$(date +%Y%m%d_%H%M%S)"
PHASE="init"
BACKUP_FILE=""
ROLLBACK_TAG=""
VERIFY_DB=""
ROLLED_FORWARD_MAIN=0

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

dc() { docker compose "$@"; }
psql_live() { dc exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@"; }

rollback_instructions() {
  cat <<EOF

────────────────────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────────────────────
Fase saat berhenti : ${PHASE}
Backup database    : ${BACKUP_FILE:-<belum dibuat>}
Image lama (tag)   : ${ROLLBACK_TAG:-<belum ditandai>}
Main lama          : ${OLD_MAIN_FULL}     Main baru: ${DEPLOY_SHA}

A. Berhenti SEBELUM 'fast-forward main' -> tidak ada yang berubah di produksi. Cukup perbaiki penyebab lalu jalankan ulang.

B. Backend saja bermasalah (setelah switch):
   1) PRASYARAT: SELECT count(*) FROM expense_submissions WHERE status='PERLU_REVISI';  harus 0. Bila >0, backend LAMA tidak
      bisa membaca baris itu: minta pemilik mengajukan ulang/membatalkan lewat kode baru dulu, atau pertahankan kode baru.
   2) cd ${APP_DIR}
      docker tag ${ROLLBACK_TAG:-<tag-image-lama>} \$(docker inspect -f '{{.Config.Image}}' \$(docker compose ps -q backend))
      docker compose up -d --no-deps backend        # memakai image lama; TANPA build ulang
      curl -fsS ${INTERNAL_URL}/api/health

C. Frontend (dist ikut ter-track git; bind-mount ke container, langsung berlaku):
   cd ${APP_DIR} && git checkout ${OLD_MAIN_FULL} -- frontend/dist     # hanya path dist, bukan reset
   git status --short frontend/dist | grep '^ D'                        # harus kosong
   Lalu hard-refresh browser (service worker: tutup semua tab aplikasi).

D. Pointer main (bila revert permanen diperlukan; tanpa reset/force):
   git revert -m 1 ${DEPLOY_SHA}   ->  push  ->  bangun ulang dist dari worktree BERSIH (jangan di VPS)

E. Database: migration ${MIGRATION} bersifat ADITIF (1 nilai enum + 3 kolom nullable + 1 FK). TIDAK ada downgrade
   migration dan TIDAK ada penghapusan data. Restore dari backup hanya sebagai jalan terakhir dan wajib persetujuan pemilik
   (docs/PANDUAN-RESTORE-BACKUP.md, bagian 6). Checksum backup: ${BACKUP_FILE:+${BACKUP_FILE}.sha256}
──────────────────────────────────────────────────────────────────────────────────────────────────────────
EOF
}

cleanup() {
  local rc=$?
  if [ -n "$VERIFY_DB" ] && [[ "$VERIFY_DB" =~ ^km_release_verify_[0-9]{8}_[0-9]{6}$ ]]; then
    dc exec -T postgres dropdb -U "$DB_USER" --if-exists "$VERIFY_DB" >/dev/null 2>&1 || warn "gagal menghapus DB sementara ${VERIFY_DB} (hapus manual: dropdb ${VERIFY_DB})"
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
[ "$(pwd -P)" = "$(cd "$APP_DIR" 2>/dev/null && pwd -P)" ] || die "jalankan dari ${APP_DIR} (sekarang: $(pwd -P))"
for c in git docker curl gzip sha256sum awk grep flock; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
docker compose version >/dev/null 2>&1 || die "docker compose tidak tersedia"
exec 9>/tmp/release-delivery-control.lock
flock -n 9 || die "rilis lain sedang berjalan (kunci /tmp/release-delivery-control.lock)"
mkdir -p backups
LOG="backups/release_delivery_control_${TS}.log"
exec > >(tee -a "$LOG") 2>&1
ok "direktori ${APP_DIR}; log ${LOG}"
[ -n "$(dc ps -q backend)" ] || die "container backend tidak berjalan"
[ -n "$(dc ps -q postgres)" ] || die "container postgres tidak berjalan"
ok "backend dan postgres berjalan"

# ── 1. Preflight git ─────────────────────────────────────────────────────────────────────────────────────
PHASE="1-preflight-git"
say "1. Preflight git"
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "cabang aktif harus main"
git diff --quiet && git diff --cached --quiet || die "ada perubahan file ter-track yang belum di-commit; bereskan manual (skrip tidak akan reset/stash)"
git status --short frontend/dist | grep -s >/dev/null '^ D' && die "frontend/dist punya file terhapus; pulihkan manual: git checkout -- frontend/dist"
git fetch origin main "$RELEASE_BRANCH" >/dev/null 2>&1 || die "git fetch origin gagal"
ORIGIN_MAIN="$(git rev-parse origin/main)"
[ "$ORIGIN_MAIN" = "$OLD_MAIN_FULL" ] || die "origin/main sudah berubah: ${ORIGIN_MAIN} (diharapkan ${OLD_MAIN_SHORT}); tinjau ulang sebelum rilis"
ok "origin/main masih ${OLD_MAIN_SHORT}"
HEAD_SHA="$(git rev-parse HEAD)"
if [ "$HEAD_SHA" != "$OLD_MAIN_FULL" ]; then
  git merge-base --is-ancestor "$HEAD_SHA" "$OLD_MAIN_FULL" || die "main lokal VPS (${HEAD_SHA:0:8}) menyimpang dari origin/main"
  warn "main lokal VPS tertinggal dari ${OLD_MAIN_SHORT}; commit yang ikut terdeploy:"
  git log --oneline "${HEAD_SHA}..${OLD_MAIN_FULL}" | sed 's/^/        /'
  [ "${ALLOW_VPS_BEHIND:-0}" = "1" ] || die "jalankan ulang dengan ALLOW_VPS_BEHIND=1 bila commit di atas memang boleh ikut terdeploy"
fi
FETCHED="$(git rev-parse "origin/${RELEASE_BRANCH}")"
git cat-file -e "${DEPLOY_SHA}^{commit}" 2>/dev/null || die "commit ${DEPLOY_SHA} tidak ada di repo (pastikan branch ${RELEASE_BRANCH} sudah di-push)"
git merge-base --is-ancestor "$DEPLOY_SHA" "$FETCHED" || die "SHA merge final bukan bagian dari origin/${RELEASE_BRANCH}"
PARENTS="$(git rev-list --parents -n1 "$MERGE_SHA")"
[ "$PARENTS" = "${MERGE_SHA} ${OLD_MAIN_FULL} b552a252dc2332140697fc414af51b745bdaf5f8" ] || die "parent merge tidak sesuai (bukan merge f0e406a7 + b552a252): ${PARENTS}"
[ "$(git rev-list --parents -n1 "$DEPLOY_SHA")" = "${DEPLOY_SHA} ${MERGE_SHA}" ] || die "SHA rilis bukan anak langsung dari commit merge"
[ -z "$(git diff --name-only "$MERGE_SHA" "$DEPLOY_SHA" | grep -v "^frontend/dist/" || true)" ] || die "commit rilis mengubah file di luar frontend/dist"
ok "merge ${MERGE_SHA:0:8} (--no-ff dari ${OLD_MAIN_SHORT} + b552a252) + commit dist ${DEPLOY_SHA:0:8} (hanya frontend/dist)"
git merge-base --is-ancestor "$OLD_MAIN_FULL" "$DEPLOY_SHA" || die "SHA merge bukan turunan main lama (ff tidak mungkin)"

say "1b. Batas perubahan (dari ${OLD_MAIN_SHORT} ke ${DEPLOY_SHA:0:8})"
CHANGED="$(git diff --name-only "$OLD_MAIN_FULL" "$DEPLOY_SHA")"
[ -z "$(git diff --name-only "$OLD_MAIN_FULL" "$DEPLOY_SHA" -- driver-mobile)" ] || die "driver-mobile berubah pada rilis ini"
ok "driver-mobile identik dengan main"
LEDGER="$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/services/finance/|^backend/src/services/ledger|^backend/src/routes/(finance|ledger|incentivePayout|incentiveSnapshot).js$' || true)"
[ -z "$LEDGER" ] || die "ada perubahan pada kode ledger/Finance: ${LEDGER}"
ok "tidak ada perubahan pada backend/src/services/finance/, ledger, atau route finance/insentif"
REMOVED_ROUTES="$(git diff "$OLD_MAIN_FULL" "$DEPLOY_SHA" -- backend/src/index.js | grep -c '^-[^-]' || true)"
[ "${REMOVED_ROUTES}" = "0" ] || die "backend/src/index.js menghapus/mengubah ${REMOVED_ROUTES} baris (route aktif harus tidak berubah)"
ok "backend/src/index.js hanya menambah (mount /api/delivery-control)"
REMOVED_SCHEMA="$(git diff -U0 "$OLD_MAIN_FULL" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | grep -c '^-[^-]' || true)"
[ "${REMOVED_SCHEMA}" = "0" ] || die "schema.prisma menghapus/mengubah ${REMOVED_SCHEMA} baris (harus aditif murni)"
ok "schema.prisma hanya menambah baris"
NEWMIG="$(git diff --name-only --diff-filter=A "$OLD_MAIN_FULL" "$DEPLOY_SHA" -- backend/prisma/migrations | sed 's#backend/prisma/migrations/##; s#/.*##' | sort -u)"
[ "$NEWMIG" = "$MIGRATION" ] || die "migration baru tidak sesuai. Ditemukan: ${NEWMIG:-<kosong>}"
[ -z "$(git diff --name-only --diff-filter=MDR "$OLD_MAIN_FULL" "$DEPLOY_SHA" -- backend/prisma/migrations)" ] || die "migration lama diubah/dihapus"
MIGSQL="$(git show "${DEPLOY_SHA}:backend/prisma/migrations/${MIGRATION}/migration.sql")"
if printf '%s\n' "$MIGSQL" | grep -v '^--' | sed -E 's/ON (DELETE|UPDATE) (SET NULL|CASCADE|RESTRICT|NO ACTION)//g' | grep -Eiq '\b(DROP|DELETE|TRUNCATE|UPDATE|RENAME|ALTER[[:space:]]+COLUMN)\b'; then die "migration mengandung perintah destruktif"; fi
ok "hanya migration ${MIGRATION} (aditif; tanpa DROP/DELETE/TRUNCATE/UPDATE/RENAME)"
git show "${DEPLOY_SHA}:docs/DELIVERY-APP-SPLIT.md" 2>/dev/null | grep -s >/dev/null '^## 8. Rilis dan rollback' || die "catatan rilis (docs/DELIVERY-APP-SPLIT.md bagian 8) tidak ditemukan pada SHA rilis"
ok "release notes ada di docs/DELIVERY-APP-SPLIT.md"

say "1c. Artefak frontend/dist pada SHA rilis (dibangun dari worktree bersih, ter-commit)"
DIST_INDEX="$(git show "${DEPLOY_SHA}:frontend/dist/index.html" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
[ -n "$DIST_INDEX" ] || die "index.html dist tidak merujuk bundel index-*.js"
git cat-file -e "${DEPLOY_SHA}:frontend/dist/assets/${DIST_INDEX}" || die "bundel ${DIST_INDEX} tidak ada di dist"
PR_FILE="$(git ls-tree --name-only "$DEPLOY_SHA" frontend/dist/assets/ | grep 'ArmadaPengajuanBiaya-.*\.js$' | sed -n 1p)"
[ -n "$PR_FILE" ] || die "chunk ArmadaPengajuanBiaya tidak ada di dist"
PR_SRC="$(git show "${DEPLOY_SHA}:${PR_FILE}")"
for kata in "Perlu Revisi" "PERLU_REVISI" "Riwayat Revisi" "Status tidak dikenal"; do
  printf '%s' "$PR_SRC" | grep -s >/dev/null "$kata" || die "dist tidak memuat '${kata}'"
done
PR_BASENAME="$(basename "$PR_FILE")"
ok "dist memuat label/filter/detail/riwayat PERLU_REVISI dan fallback status tak dikenal (${PR_BASENAME}); bundel utama ${DIST_INDEX}"

# ── 2. Preflight sumber daya ─────────────────────────────────────────────────────────────────────────────
PHASE="2-preflight-sumber-daya"
say "2. Sumber daya dan kondisi awal"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" >/dev/null || die "healthcheck internal SEBELUM rilis gagal; sistem sudah bermasalah, jangan rilis"
ok "healthcheck internal sehat (sebelum rilis)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"
AVAIL_KB="$(df -Pk backups | awk 'NR==2{print $4}')"
NEED_KB=$(( DB_BYTES / 1024 * 3 + 1048576 ))
[ "$AVAIL_KB" -ge "$NEED_KB" ] || die "ruang disk backups/ kurang (tersedia ${AVAIL_KB} KB, butuh ${NEED_KB} KB)"
ok "ruang disk cukup (db ${DB_BYTES} byte)"
PENDING_BEFORE="$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${MIGRATION}' and finished_at is not null")"
ok "migration ${MIGRATION} sudah tercatat applied sebelum rilis? ${PENDING_BEFORE} (0 = belum, akan diterapkan)"
CID_OLD="$(dc ps -q backend)"
OLD_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"
IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
ok "image backend aktif: ${IMG_NAME} (${OLD_IMG_ID:7:12})"

if [ "$PREFLIGHT_ONLY" = "1" ]; then
  say "Preflight selesai (--preflight-only): tidak ada perubahan yang dibuat"
  exit 0
fi

# ── 3. Backup + verifikasi restore ───────────────────────────────────────────────────────────────────────
PHASE="3-backup"
say "3. Backup produksi + verifikasi restore ke database sementara"
BACKUP_FILE="${APP_DIR}/backups/klinik_matras_prerelease_delivery-control_${TS}.sql.gz"
COUNTS_SQL="select table_name||'|'||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
psql_live -At -c "$COUNTS_SQL" > "backups/.counts_before_${TS}.txt"
dc exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak (gzip -t gagal)"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep -s >/dev/null 'PostgreSQL database dump complete' || die "dump tidak lengkap (penanda akhir tidak ada)"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd backups && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal diverifikasi"
psql_live -At -c "$COUNTS_SQL" > "backups/.counts_after_${TS}.txt"
ok "backup dibuat: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -c1-16 "${BACKUP_FILE}.sha256")..."

PHASE="3b-verifikasi-restore"
VERIFY_DB="km_release_verify_${TS}"
[[ "$VERIFY_DB" =~ ^km_release_verify_[0-9]{8}_[0-9]{6}$ ]] || die "nama DB verifikasi tidak aman"
dc exec -T postgres createdb -U "$DB_USER" "$VERIFY_DB" || die "gagal membuat DB sementara"
gzip -dc "$BACKUP_FILE" | dc exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -X -q -o /dev/null || die "restore ke DB sementara GAGAL"
dc exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -c "$COUNTS_SQL" > "backups/.counts_restored_${TS}.txt" || die "gagal menghitung baris hasil restore"
diff -q <(cut -d'|' -f1 "backups/.counts_before_${TS}.txt") <(cut -d'|' -f1 "backups/.counts_restored_${TS}.txt") >/dev/null || die "daftar tabel hasil restore berbeda dari produksi"
BAD="$(awk -F'|' 'NR==FNR{b[$1]=$2;next} FILENAME==ARGV[2]{a[$1]=$2;next} {t=$1; r=$2; d=r-b[t]; if(d<0)d=-d; lim=b[t]*0.02; if(lim<25)lim=25; if(d>lim && !(r>=b[t] && r<=a[t]) && !(r<=b[t] && r>=a[t])) print t": produksi(sebelum)="b[t]" sesudah="a[t]" restore="r}' "backups/.counts_before_${TS}.txt" "backups/.counts_after_${TS}.txt" "backups/.counts_restored_${TS}.txt")"
[ -z "$BAD" ] || die "jumlah baris hasil restore tidak cocok: ${BAD}"
MIG_LIVE="$(psql_live -At -c 'select count(*) from _prisma_migrations')"
MIG_REST="$(dc exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -c 'select count(*) from _prisma_migrations')"
[ "$MIG_LIVE" = "$MIG_REST" ] || die "_prisma_migrations berbeda: produksi ${MIG_LIVE}, restore ${MIG_REST}"
ok "restore terverifikasi: $(wc -l < "backups/.counts_restored_${TS}.txt") tabel cocok; _prisma_migrations ${MIG_REST} baris"
dc exec -T postgres dropdb -U "$DB_USER" "$VERIFY_DB" && VERIFY_DB="" && ok "DB sementara dihapus"
rm -f "backups/.counts_before_${TS}.txt" "backups/.counts_after_${TS}.txt" "backups/.counts_restored_${TS}.txt"
if command -v rclone >/dev/null 2>&1; then
  rclone copy "$BACKUP_FILE" gdrive:klinik-matras-backups/ >/dev/null 2>&1 && rclone copy "${BACKUP_FILE}.sha256" gdrive:klinik-matras-backups/ >/dev/null 2>&1 \
    && ok "salinan offsite (Google Drive) diunggah (tanpa pembersihan)" \
    || { [ "${REQUIRE_OFFSITE:-0}" = "1" ] && die "unggah offsite gagal"; warn "unggah offsite gagal (lanjut; lokal + checksum valid)"; }
else
  [ "${REQUIRE_OFFSITE:-0}" = "1" ] && die "rclone tidak ada"; warn "rclone tidak ada; hanya backup lokal"
fi

# ── 4. Fast-forward main ─────────────────────────────────────────────────────────────────────────────────
PHASE="4-fast-forward-main"
say "4. Fast-forward main ke ${DEPLOY_SHA:0:8} (tanpa force)"
git fetch origin main >/dev/null 2>&1 || die "git fetch gagal"
[ "$(git rev-parse origin/main)" = "$OLD_MAIN_FULL" ] || die "origin/main berubah selama backup; hentikan dan tinjau"
git merge --ff-only "$DEPLOY_SHA" >/dev/null || die "fast-forward gagal"
[ "$(git rev-parse HEAD)" = "$DEPLOY_SHA" ] || die "HEAD tidak sama dengan SHA rilis setelah ff"
ROLLED_FORWARD_MAIN=1
git status --short frontend/dist | grep -s >/dev/null '^ D' && die "frontend/dist punya file terhapus setelah ff"
ok "main lokal VPS = ${DEPLOY_SHA:0:8}"

# ── 5. Frontend ──────────────────────────────────────────────────────────────────────────────────────────
PHASE="5-frontend"
say "5. frontend/dist"
# dist DIBANGUN dari worktree bersih saat persiapan lalu ter-commit (CLAUDE.md §12: JANGAN npm run build di VPS,
# insiden 13 Sep 2026). Di sini hanya diverifikasi bahwa checkout memuat artefak persis itu.
grep -q "$DIST_INDEX" frontend/dist/index.html || die "frontend/dist/index.html di VPS tidak merujuk ${DIST_INDEX}"
[ -f "frontend/dist/assets/${DIST_INDEX}" ] && [ -f "frontend/dist/assets/${PR_BASENAME}" ] || die "berkas dist tidak lengkap di VPS"
for kata in "Perlu Revisi" "Riwayat Revisi"; do grep -q "$kata" "frontend/dist/assets/${PR_BASENAME}" || die "dist VPS tidak memuat '${kata}'"; done
ok "dist di VPS = artefak ter-commit (bundel ${DIST_INDEX}); frontend langsung aktif lewat bind-mount"

# ── 6. Build image baru (backend lama tetap berjalan) ───────────────────────────────────────────────────
PHASE="6-build-image"
say "6. Build image backend baru TANPA mengganti container aktif"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-${TS}"
docker tag "$OLD_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"
ok "image lama ditandai ${ROLLBACK_TAG}"
dc build backend >/dev/null || die "build image backend gagal (container lama masih berjalan, tidak terganggu)"
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$OLD_IMG_ID" ] || warn "image baru identik dengan lama (cache penuh)"
[ "$(docker inspect -f '{{.Image}}' "$(dc ps -q backend)")" = "$OLD_IMG_ID" ] || die "container aktif berubah saat build (tidak diharapkan)"
ok "image baru ${NEW_IMG_ID:7:12} siap; container aktif masih memakai image lama"

# ── 7. Migration dengan image baru ───────────────────────────────────────────────────────────────────────
PHASE="7-migrate"
say "7. prisma migrate deploy (image baru, backend lama masih melayani; migration aditif kompatibel)"
dc run --rm --no-deps -T backend npx prisma migrate status || true
dc run --rm --no-deps -T backend npx prisma migrate deploy || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan"
APPLIED="$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${MIGRATION}' and finished_at is not null and rolled_back_at is null")"
[ "$APPLIED" = "1" ] || die "migration ${MIGRATION} tidak tercatat selesai"
COLS="$(psql_live -At -c "select count(*) from information_schema.columns where table_name='expense_submissions' and column_name in ('revision_reason','revision_requested_by','revision_requested_at')")"
ENUMV="$(psql_live -At -c "select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='ExpenseSubmissionStatus' and e.enumlabel='PERLU_REVISI'")"
[ "$COLS" = "3" ] && [ "$ENUMV" = "1" ] || die "skema tidak sesuai setelah migrate (kolom=${COLS}, enum=${ENUMV})"
FAILED="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")"
[ "$FAILED" = "0" ] || die "ada migration setengah jalan (${FAILED}); JANGAN lanjut, periksa manual"
ok "migration sukses; 3 kolom + nilai enum PERLU_REVISI ada; tidak ada migration menggantung"

# ── 8. Switch backend ────────────────────────────────────────────────────────────────────────────────────
PHASE="8-switch"
say "8. Switch backend ke image baru"
SWITCH_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dc up -d --no-deps backend >/dev/null || die "docker compose up backend gagal"
UP=0
for i in $(seq 1 45); do
  if curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1; then UP=1; break; fi
  sleep 2
done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
[ "$(docker inspect -f '{{.Image}}' "$(dc ps -q backend)")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12})"

# ── 9. Healthcheck ───────────────────────────────────────────────────────────────────────────────────────
PHASE="9-healthcheck"
say "9. Healthcheck internal dan publik"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep -s >/dev/null '"ok":true' || die "healthcheck internal gagal"
ok "internal: ${INTERNAL_URL}/api/health"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep -s >/dev/null '"ok":true' || die "healthcheck publik gagal"
ok "publik: ${PUBLIC_URL}/api/health"
PUB_INDEX="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
[ "$PUB_INDEX" = "$DIST_INDEX" ] || die "bundel publik (${PUB_INDEX:-kosong}) tidak sama dengan dist rilis (${DIST_INDEX})"
ok "bundel web publik = ${PUB_INDEX}"
curl -fsS --max-time 20 "${PUBLIC_URL}/assets/${PR_BASENAME}" | grep -s >/dev/null 'Perlu Revisi' || die "chunk PERLU_REVISI tidak terlayani publik"
ok "web publik melayani chunk Pengajuan Biaya dengan badge/filter/detail PERLU_REVISI"

# ── 10. Smoke test (baca-saja; token 10 menit dibuat di dalam container, tidak pernah dicetak) ───────────
PHASE="10-smoke"
say "10. Smoke test capability Control, PERLU_REVISI, media bertanda-tangan, RBAC"
dc exec -T backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
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

// 4) Status tak dikenal tidak merusak server (filter bebas)
const adm = await pick("ADMIN");
if (adm) {
  const u = await api("GET", "/api/finance/expense-submissions?division=DELIVERY&status=STATUS_NGAWUR&limit=5", adm.token);
  rec("filter status tak dikenal tidak membuat server error (bukan 5xx)", u.status < 500, `status ${u.status}`);
}
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal, ${skip} dilewati`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus (lihat baris SKIP di atas bila ada: itu perlu uji manual)"

# ── 11. Log dan regresi ──────────────────────────────────────────────────────────────────────────────────
PHASE="11-log"
say "11. Log backend sejak switch (${SWITCH_AT})"
LOGS="$(dc logs --since "$SWITCH_AT" --no-color backend 2>&1 | cut -c1-240 || true)"
FATAL="$(printf '%s\n' "$LOGS" | grep -Ei 'P2021|P2022|does not exist|PrismaClientInitializationError|Cannot find module|EADDRINUSE' || true)"
[ -z "$FATAL" ] || { printf '%s\n' "$FATAL" | sed -n 1,10p; die "log backend memuat error skema/inisialisasi"; }
ERRN="$(printf '%s\n' "$LOGS" | grep -Eic 'error|exception|unhandled' || true)"
ok "tidak ada error skema/inisialisasi; baris berisi 'error/exception': ${ERRN}"
[ "$ERRN" = "0" ] || { warn "contoh baris (maks 8):"; printf '%s\n' "$LOGS" | grep -Ei 'error|exception|unhandled' | sed -n 1,8p | sed 's/^/        /'; }
FIN_ERR="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")"
[ "$FIN_ERR" = "0" ] || die "ada migration menggantung setelah rilis"
ok "tidak ada migration menggantung"

# ── 12. Selesai ──────────────────────────────────────────────────────────────────────────────────────────
PHASE="12-selesai"
say "12. Selesai"
if git push origin "${DEPLOY_SHA}:refs/heads/main" >/dev/null 2>&1; then ok "origin/main di-fast-forward ke ${DEPLOY_SHA:0:8} (tanpa force)"
else warn "push origin main dari VPS tidak berhasil (mungkin tanpa kredensial tulis). Dari laptop: git push origin ${DEPLOY_SHA}:main  (fast-forward biasa; JANGAN force)"; fi
cat <<EOF

RILIS SELESAI.
  main aktif di VPS : ${DEPLOY_SHA}
  Backup            : ${BACKUP_FILE}  (+ .sha256)
  Image lama (tag)  : ${ROLLBACK_TAG}
  Log lengkap       : ${APP_DIR}/${LOG}
  EAS / APK / OTA   : TIDAK disentuh (pekerjaan terpisah)
Kirim kembali ke pemilik: isi log di atas (bagian 1c, 3, 7, 9, 10, 11) tanpa secret.
EOF
trap - EXIT
[ -z "$VERIFY_DB" ] || cleanup
exit 0
