#!/usr/bin/env bash
# Rilis MANUAL perbaikan Rencana Produksi (web + backend + 1 migrasi aditif) — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA).
# Sifat rilis: KODE + migrasi ADITIF. Cohort, flag V2, setting produksi, PIC, dan jadwal order TIDAK diubah/diaktifkan oleh skrip ini
# (diverifikasi: md5 v2_feature_flags + production_settings identik; tabel PIC bawaan Meja dan riwayat jadwal tetap 0 baris; order/stok/jurnal identik).
#
#   Uji tanpa risiko (baca-saja + DB sementara; production tidak diubah, :latest tidak ditimpa):
#     cat scripts/release-rencana-audit.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rra.sh && bash /tmp/rra.sh <DEPLOY_SHA_40> <BASE_SHA_40> <FILELIST_SHA256> --preflight-only'
#     ... --rehearsal-only    (preflight + backup + checksum + restore ke DB sementara + migrate + uji rollback-kode; lalu berhenti)
#   Rilis:
#     ssh ubuntu@43.133.152.6 'bash /tmp/rra.sh <DEPLOY_SHA_40> <BASE_SHA_40> <FILELIST_SHA256>'
#   FILELIST_SHA256 = sha256 dari `git diff --name-only BASE DEPLOY -- . ':!scripts/release-rencana-audit.sh' | LC_ALL=C sort` (daftar berkas yang DIREVIEW; berbeda = berhenti).
#
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"; FILELIST_PIN="${3:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
[[ "$FILELIST_PIN" =~ ^[0-9a-f]{64}$ ]] || { echo "STOP: argumen 3 harus sha256 daftar berkas yang direview (64 hex)" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-rc/rencana-audit-on-live-12dda033}"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
SELF_SCRIPT="scripts/release-rencana-audit.sh"

# Satu migrasi pending: nama → sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang.
# CATATAN stempel: Finance (feat/retur-supplier-debit-note) memakai stempel 20261102090000 yang SAMA tetapi nama folder berbeda
# (20261102090000_retur_supplier_debit_note). Prisma mengurutkan menurut NAMA lengkap folder (production_… < retur_…) dan migrate deploy menerapkan
# semua yang belum terpasang apa pun urutannya; rilis ini hanya mengizinkan SATU migrasi pending (milik kita) sehingga milik Finance tidak ikut terbawa.
MIG_ORDER=(20261102090000_production_station_pic_target_history)
declare -A MIGRASI_PIN=(
  ["20261102090000_production_station_pic_target_history"]="90ca31aee37ef85295c6f7ac4b6fe108cc656d7cc33e4fc622ec73a92b891e05"
)
# Migrasi yang SUDAH terpasang di production dan checksum-nya diketahui berbeda dari berkas repo (tercatat di docs; Prisma migrate deploy tidak memverifikasinya).
KNOWN_DRIFT_RE='^(20260630200000_lead_attribution|20260707130141_add_lid_mapping|20260913180000_return_to_depot|20261007110000_team_broadcast_contacts)$'

MODE="rilis"
for a in "$@"; do case "$a" in --preflight-only) MODE="preflight";; --rehearsal-only) MODE="rehearsal";; esac; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/rra-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; REH_DB=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  PERHATIAN %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
reh_drop() { [ -z "$REH_DB" ] || dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; }

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Mode               : ${MODE}
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa)
Image sebelumnya   : ${ROLLBACK_TAG:-<belum ditandai>}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (migrasi, bila sudah diterapkan, bersifat aditif dan diabaikan kode lama).
Setelah switch bermasalah (rollback KODE; migrasi dipertahankan — terbukti aman di rehearsal: image lama membaca/menulis DB yang sudah dimigrasi):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
   # lalu arahkan web ke dist lama: kembalikan mount frontend/dist release sebelumnya (compose release lama sudah memakainya) — verifikasi: curl ${PUBLIC_URL}/api/health
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas). Migrasi TIDAK perlu di-undo untuk rollback kode.
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; reh_drop; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy (mode: ${MODE})"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm comm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-rencana-audit.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rra\.sh\|release-rencana-audit\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ "$MODE" != "rilis" ] || [ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, daftar berkas yang direview, dan migrasi terpin"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT} — gabungkan ulang kandidat di atas release aktif"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" -- . ":!${SELF_SCRIPT}" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline"
LIST_SHA="$(printf '%s\n' "$CHANGED" | sha256sum | cut -d' ' -f1)"
[ "$LIST_SHA" = "$FILELIST_PIN" ] || die "daftar berkas berubah vs yang direview (sha256 ${LIST_SHA}) — baseline/kandidat bergeser atau ada berkas tak direview; berhenti"
ok "daftar berkas = yang direview: $(printf '%s\n' "$CHANGED" | wc -l) berkas (sha256 ${LIST_SHA:0:12})"
# Batas keras (di atas pin): tidak ada dependensi/infra/build output/data/rahasia yang ikut.
BAD="$(printf '%s\n' "$CHANGED" | grep -E '(^|/)package(-lock)?\.json$|(^|/)Dockerfile$|^docker-compose|(^|/)\.env|^frontend/dist/|^backend/data/|^backend/uploads/' || true)"
[ -z "$BAD" ] || { printf '%s\n' "$BAD" | sed 's/^/        /'; die "berkas dependensi/infra/dist/data/.env ikut berubah — tidak diizinkan pada rilis ini"; }
# Hanya area Produksi + dokumen + titik gabung bersama yang sudah diaudit; area Finance/Delivery/Inbox/Armada TIDAK boleh berbeda dari baseline kecuali titik gabung ini.
NONPROD="$(printf '%s\n' "$CHANGED" | grep -Ev '^(docs/|backend/prisma/|backend/src/(lib/domain/production|services/production|routes/production|lib/activityLog\.js|services/unitStageEngine\.js|services/unitCustodyCommandService\.js|services/v1WorkerQueue\.js|routes/units\.js)|backend/tests/|backend/scripts/production-delivery-v2/|frontend/src/(features/production/|features/warehouse/finishedGoods\.js|pages/(bengkel|produksi|warehouse)/|pages/Portal\.jsx|api\.js|routes/pageRegistry\.jsx|lib/)|frontend/tests/)' || true)"
[ -z "$NONPROD" ] || { printf '%s\n' "$NONPROD" | sed 's/^/        /'; die "ada berkas di luar area Produksi/titik gabung yang diaudit"; }
ok "semua berkas dalam area Produksi + titik gabung yang diaudit; tanpa dependensi/infra/dist/data"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' | LC_ALL=C sort)"
EXPECT_PRISMA="$( { echo backend/prisma/schema.prisma; for m in "${MIG_ORDER[@]}"; do echo "backend/prisma/migrations/${m}/migration.sql"; done; } | LC_ALL=C sort)"
[ "$PRISMA_CHANGED" = "$EXPECT_PRISMA" ] || { diff <(printf '%s\n' "$EXPECT_PRISMA") <(printf '%s\n' "$PRISMA_CHANGED") || true; die "berkas prisma yang berubah HARUS tepat schema.prisma + 1 migrasi terpin"; }
for m in "${MIG_ORDER[@]}"; do
  MIGSQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${m}/migration.sql" | tr -d '\r')"
  MIG_SHA="$(printf '%s\n' "$MIGSQL" | sha256sum | cut -d' ' -f1)"
  [ "${MIGRASI_PIN[$m]}" = "$MIG_SHA" ] || die "isi migrasi ${m} BERBEDA dari yang diaudit (sha256 ${MIG_SHA}) — audit ulang lalu perbarui pin"
  ISI="$(printf '%s\n' "$MIGSQL" | grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$' || true)"
  # Larang perintah destruktif. Diizinkan: DROP CONSTRAINT hanya untuk CHECK section komponen (dibuat ulang sebagai pelebaran), INSERT hanya ke routing_stages,
  # DROP/DELETE/UPDATE/TRUNCATE/RENAME lain = berhenti. (Isi fungsi trigger tidak mengandung perintah-perintah ini.)
  SCAN="$(printf '%s\n' "$ISI" | grep -v 'RAISE EXCEPTION' | sed -E 's/ON (DELETE|UPDATE) (CASCADE|RESTRICT|SET NULL|NO ACTION)//g; s/BEFORE UPDATE OR DELETE//g; s/ALTER TABLE "unit_component_entries_v2" DROP CONSTRAINT "unit_component_entries_v2_section_check";//g; s/INSERT INTO "routing_stages"//g')"
  printf '%s\n' "$SCAN" | grep -Eiw 'DROP|DELETE|TRUNCATE|UPDATE|RENAME|INSERT|ALTER[[:space:]]+COLUMN|GRANT|REVOKE|COPY' >/dev/null && { printf '%s\n' "$SCAN" | grep -Eiw 'DROP|DELETE|TRUNCATE|UPDATE|RENAME|INSERT|ALTER[[:space:]]+COLUMN|GRANT|REVOKE|COPY' | sed 's/^/        /'; die "migrasi ${m} mengandung perintah non-aditif di luar yang diaudit"; }
  ok "migrasi ${m}: sha256 cocok pin (${MIG_SHA:0:12}), aditif"
done

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHA:0:8}; produksi bergeser — gabungkan ulang kandidat lalu ulangi"
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
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
N_APPLIED="$(wc -l < "$BK_DIR/applied-sebelum.txt")"
# Setiap migrasi yang terpasang HARUS punya folder di kandidat (tidak ada "yatim"), dan migrasi kita belum terpasang.
# CATATAN: jangan menyaring daftar dengan `grep -v lock` — nama "block_reason_extended" dan "production_blockers" mengandung "lock" (pernah salah mengira keduanya yatim).
sg ls-tree --name-only "${DEPLOY_SHA}:backend/prisma/migrations/" | grep -E '^[0-9]{14}_' | LC_ALL=C sort > "$BK_DIR/folder-kandidat.txt"
YATIM="$(comm -23 <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") "$BK_DIR/folder-kandidat.txt" || true)"
[ -z "$YATIM" ] || { printf '%s\n' "$YATIM" | sed 's/^/        /'; die "ada migrasi terpasang di production yang TIDAK punya folder di kandidat"; }
PENDING="$(comm -13 <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") "$BK_DIR/folder-kandidat.txt" || true)"
EXPECT_PENDING="$(printf '%s\n' "${MIG_ORDER[@]}" | LC_ALL=C sort)"
[ "$PENDING" = "$EXPECT_PENDING" ] || { printf 'pending:\n%s\n' "$PENDING" | sed 's/^/        /'; die "migrasi pending BUKAN tepat 1 yang diaudit — production/kandidat bergeser (mis. rilis lain menambah migrasi)"; }
ok "terpasang di production: ${N_APPLIED}; semuanya punya folder di kandidat; pending = tepat 1 yang diaudit (→ $((N_APPLIED + 1)))"
# Checksum migrasi terpasang vs berkas kandidat (CRLF/edit diam-diam): selisih di luar daftar drift yang sudah tercatat = berhenti.
psql_live -At -F'|' -c "select migration_name, checksum from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/checksum-prod.txt" || die "gagal membaca checksum"
DRIFT_BARU=""; DRIFT_LAMA=""
while IFS='|' read -r n c; do
  f="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${n}/migration.sql" 2>/dev/null | sha256sum | cut -d' ' -f1 || true)"
  [ "$f" = "$c" ] && continue
  if [[ "$n" =~ $KNOWN_DRIFT_RE ]]; then DRIFT_LAMA="${DRIFT_LAMA} ${n}"; else DRIFT_BARU="${DRIFT_BARU} ${n}"; fi
done < "$BK_DIR/checksum-prod.txt"
[ -z "$DRIFT_BARU" ] || die "checksum migrasi terpasang BERBEDA dari berkas kandidat (di luar drift tercatat):${DRIFT_BARU}"
ok "checksum $((N_APPLIED - $(printf '%s' "$DRIFT_LAMA" | wc -w))) migrasi terpasang = berkas kandidat (termasuk block_reason_extended & production_blockers); drift lama yang tercatat:${DRIFT_LAMA:- (tidak ada)}"
# Keadaan yang HARUS tidak berubah: flag/cohort V2 dan pengaturan produksi (termasuk tidak adanya setting gerbang QC).
FLAG_SEBELUM="$(psql_live -At -c "select md5(coalesce(string_agg(f::text,'|' order by f.key),'')) from v2_feature_flags f")"
SET_SEBELUM="$(psql_live -At -c "select md5(coalesce(string_agg(s::text,'|' order by s.key),'')) from production_settings s")"
QCG_SEBELUM="$(psql_live -At -c "select count(*) from production_settings where key='qc_gate_default_policy'")"
ok "flag/cohort md5=${FLAG_SEBELUM}; production_settings md5=${SET_SEBELUM}; baris qc_gate_default_policy=${QCG_SEBELUM}"
SNAP_SQL="select 'order_status', count(*), md5(coalesce(string_agg(x.id::text||x.\"paymentStatus\"::text||coalesce(x.paid_at::text,''), '|' order by x.id),'')) from \"Order\" x union all select 'alokasi', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from fin_payment_allocations x union all select 'jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from fin_journal_entries x union all select 'baris_jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.debit::text||x.credit::text, '|' order by x.id),'')) from fin_journal_lines x union all select 'payment', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from payments x union all select 'po', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from fin_purchase_orders x union all select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text, '|' order by x.id),'')) from stock_movements x union all select 'run_v2', count(*), md5(coalesce(string_agg(x.id::text||x.status::text||x.revision::text, '|' order by x.id),'')) from production_runs_v2 x"
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
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang (butuh ≈ $(( (NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024) / 1024 )) MB, tersedia $((AVAIL_KB / 1024)) MB)"
ok "ruang disk cukup ($((AVAIL_KB / 1024)) MB tersedia)"
if [ "$MODE" = "preflight" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-rra-${DEPLOY_SHORT}-${TS}.sql.gz"
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
if [ "$MODE" = "rehearsal" ]; then NEW_DIR="$BK_DIR/release-rehearsal"; fi
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
for m in "${MIG_ORDER[@]}"; do [ -f "$NEW_DIR/backend/prisma/migrations/$m/migration.sql" ] || die "arsip kehilangan migrasi $m"; done
[ -f "$NEW_DIR/backend/prisma/migrations/20260906120000_block_reason_extended/migration.sql" ] && [ -f "$NEW_DIR/backend/prisma/migrations/20260906130000_production_blockers/migration.sql" ] || die "arsip kehilangan block_reason_extended/production_blockers"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
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
# Fitur yang sudah live (Finance/Gudang/PO/Delivery/Produksi lama) HARUS masih ada; fitur Fase 1–5 HARUS ada.
for s1 in "Ajukan Klaim Lunas" "Laporan Biaya Divisi" "Penjualan Karyawan (di luar tim Sales)" "Pratinjau PDF" "Perlu dilengkapi" "Rencana Produksi" "Status Produksi" "Sales per Stage" "Barang Akan Datang" "Perlu konfirmasi Sales" "Rangkaian dokumentasi" "Gerbang QC untuk run baru" "Konfirmasi Sales dicatat oleh PIC Corner"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN fitur live: $s1"; done
for s2 in "Riwayat jadwal & target" "Target berbeda dari tanggal papan" "kembali ke Belum Dijadwalkan" "Tentukan rute dari Layanan Sales" "Tambah baris" "QC & Serah ke Gudang"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur rilis ini: $s2"; done
[ -z "$(grep -lF "QC & Handoff" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru masih memuat jargon \"QC & Handoff\""
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "bundel baru identik dengan lama (frontend berubah, tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); fitur live utuh; fitur rilis ini ada"

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
[ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "bundel baru rusak setelah membawa aset lama"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-rra-${DEPLOY_SHORT}"
if [ "$MODE" = "rehearsal" ]; then
  # Rehearsal: image diberi tag SENDIRI (bukan :latest) supaya restart tak sengaja container live tidak pernah mengambil image ini.
  NEW_IMAGE_REF="${IMG_NAME%%:*}:rehearsal-rra-${DEPLOY_SHORT}"
  ( cd "$NEW_DIR" && docker build -t "$NEW_IMAGE_REF" -f backend/Dockerfile backend ) > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image (rehearsal) gagal"; }
  NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$NEW_IMAGE_REF")"
else
  docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
  dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
  NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"; NEW_IMAGE_REF="$IMG_NAME"
  [ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
fi
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, migrasi dengan image baru, verifikasi, uji rollback-kode, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_rra_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
for T in '"Order"' payments fin_journal_entries fin_payment_allocations stock_movements production_runs_v2 fin_purchase_orders _prisma_migrations; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$A" = "$B" ] || die "restore rehearsal tidak identik untuk $T (produksi=$A restore=$B) — backup/restore bermasalah"
done
ok "restore nyata identik (Order, payments, jurnal, alokasi, stok, run V2, PO, riwayat migrasi)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"
REH_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CID_OLD")"
# sidik jari data lama (jumlah baris + md5 isi, kolom lama saja) SEBELUM migrasi
RPSQL "select string_agg(format('select %L as t, count(*)::text as c, md5(coalesce(string_agg(row(%s)::text, ''|'' order by row(%s)::text), '''')) as h from %I', table_name, cols, cols, table_name), E'\nunion all\n' order by table_name) from (select table_name, string_agg(quote_ident(column_name), ',' order by ordinal_position) as cols from information_schema.columns where table_schema='public' and table_name <> '_prisma_migrations' and table_name <> 'routing_stages' and table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE') group by table_name) x" > "$BK_DIR/fp.sql"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -F'|' -q < "$BK_DIR/fp.sql" 2>/dev/null | LC_ALL=C sort > "$BK_DIR/fp-sebelum.txt" || die "sidik jari sebelum gagal"
RFLAG_SEBELUM="$(RPSQL "select md5(coalesce(string_agg(f::text,'|' order by f.key),'')) from v2_feature_flags f")"; RSET_SEBELUM="$(RPSQL "select md5(coalesce(string_agg(s::text,'|' order by s.key),'')) from production_settings s")"
RS_SEBELUM="$(RPSQL "select string_agg(code||'|'||sequence, ',' order by code) from routing_stages")"
docker run --rm --network "$NET" -e DATABASE_URL="$REH_URL" --entrypoint sh "$NEW_IMG_ID" -c "cd /app && npx prisma migrate deploy" > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; die "REHEARSAL migrate deploy GAGAL (DB produksi tidak disentuh)"; }
docker run --rm --network "$NET" -e DATABASE_URL="$REH_URL" --entrypoint sh "$NEW_IMG_ID" -c "cd /app && npx prisma migrate deploy" 2>&1 | grep -i 'No pending migrations' >/dev/null || die "replay migrate deploy pada rehearsal bukan 'No pending'"
[ "$(RPSQL "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$((N_APPLIED + 1))" ] || die "jumlah migrasi rehearsal != ${N_APPLIED}+1"
[ "$(RPSQL "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "migrasi menggantung pada rehearsal"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -F'|' -q < "$BK_DIR/fp.sql" 2>/dev/null | LC_ALL=C sort > "$BK_DIR/fp-sesudah.txt" || die "sidik jari sesudah gagal"
diff "$BK_DIR/fp-sebelum.txt" "$BK_DIR/fp-sesudah.txt" >/dev/null || { diff "$BK_DIR/fp-sebelum.txt" "$BK_DIR/fp-sesudah.txt" | head -20; die "data lama BERUBAH oleh migrasi (rehearsal)"; }
ok "rehearsal: ${N_APPLIED} → $((N_APPLIED + 1)); replay 'No pending'; sidik jari $(wc -l < "$BK_DIR/fp-sebelum.txt") tabel data lama IDENTIK"
RS_SESUDAH="$(RPSQL "select string_agg(code||'|'||sequence, ',' order by code) from routing_stages")"
[ "$(printf '%s' "$RS_SEBELUM" | tr ',' '\n' | LC_ALL=C sort | comm -23 - <(printf '%s' "$RS_SESUDAH" | tr ',' '\n' | LC_ALL=C sort) | wc -l)" = "0" ] || die "baris routing_stages lama hilang/berubah oleh migrasi"
ok "routing_stages: hanya penambahan ($(printf '%s' "$RS_SESUDAH" | tr ',' '\n' | wc -l) vs $(printf '%s' "$RS_SEBELUM" | tr ',' '\n' | wc -l) baris)"
[ "$(RPSQL "select md5(coalesce(string_agg(f::text,'|' order by f.key),'')) from v2_feature_flags f")" = "$RFLAG_SEBELUM" ] || die "flag/cohort V2 berubah oleh migrasi (rehearsal)"
[ "$(RPSQL "select md5(coalesce(string_agg(s::text,'|' order by s.key),'')) from production_settings s")" = "$RSET_SEBELUM" ] || die "production_settings berubah oleh migrasi (rehearsal)"
[ "$(RPSQL "select count(*) from production_settings where key='qc_gate_default_policy'")" = "0" ] || die "setting gerbang QC muncul oleh migrasi (rehearsal)"
ok "flag/cohort V2 dan production_settings BYTE-IDENTIK setelah migrasi; V2 tidak aktif"
# Uji ROLLBACK KODE: image LAMA (kode lama) terhadap DB yang SUDAH dimigrasi — baca tabel yang berubah + tulis dalam transaksi yang dibatalkan.
cat > "$BK_DIR/rb.cjs" <<'JS'
const { PrismaClient } = require("@prisma/client");
(async () => {
  const p = new PrismaClient(); const out = {};
  out.users = await p.user.count(); out.orders = await p.order.count(); out.units = await p.unit.count();
  out.materials = (await p.material.findMany({ take: 5 })).length; out.runs = (await p.productionRun.findMany({ take: 5 })).length;
  out.plans = (await p.productionRunPlan.findMany({ take: 3 })).length; out.evidence = await p.productionStepEvidence.count(); out.moves = (await p.stockMovement.findMany({ take: 3 })).length;
  out.flags = await p.v2FeatureFlag.count(); out.settings = await p.productionSetting.count(); out.po = await p.finPurchaseOrder.count(); out.valuasi = await p.finStockMovementValuation.count();
  out.stages = await p.routingStage.count(); out.comp = await p.unitComponentEntry.count();
  const before = await p.material.count();
  try { await p.$transaction(async (tx) => { const m = await tx.material.create({ data: { code: "RB-" + Date.now(), name: "Uji rollback kode (dibatalkan)", unit: "PCS", category: "RAW_MATERIAL", active: true } }); out.writeOk = !!m.id; throw new Error("ROLLBACK_SENGAJA"); }); } catch (e) { out.rolledBack = e.message === "ROLLBACK_SENGAJA"; }
  out.materialsTetap = (await p.material.count()) === before;
  console.log("RBJSON " + JSON.stringify(out)); await p.$disconnect();
})().catch((e) => { console.log("RBERR " + e.message); process.exit(1); });
JS
RB_OUT="$(docker run --rm --network "$NET" -e DATABASE_URL="$REH_URL" -v "$BK_DIR/rb.cjs:/app/rb.cjs:ro" --entrypoint sh "$PREV_IMG_ID" -c "cd /app && node rb.cjs" 2>&1 | grep -E '^RB(JSON|ERR)' || true)"
printf '%s' "$RB_OUT" | grep -q '"writeOk":true' && printf '%s' "$RB_OUT" | grep -q '"rolledBack":true' && printf '%s' "$RB_OUT" | grep -q '"materialsTetap":true' || die "ROLLBACK KODE gagal diuji: ${RB_OUT}"
ok "rollback kode terbukti: image lama membaca/menulis DB termigrasi (${RB_OUT#RBJSON })"
reh_drop; REH_DB=""
ok "DB sementara dihapus"
if [ "$MODE" = "rehearsal" ]; then
  docker rmi "$NEW_IMAGE_REF" >/dev/null 2>&1 || true; rm -rf "$NEW_DIR"
  say "Rehearsal selesai (--rehearsal-only): produksi TIDAK diubah; backup ${BACKUP_FILE} (sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")) disimpan"; trap - EXIT; exit 0
fi

PHASE="6-migrate"; say "6. Migrasi aditif (1) — image baru; backend lama tetap melayani"
for m in "${MIG_ORDER[@]}"; do grep -Fx "$m" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${m} SUDAH terpasang sebelum rilis (tidak diharapkan)"; done
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani; backup ${BACKUP_FILE})"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$((N_APPLIED + 1))" ] || die "jumlah migrasi terpasang != ${N_APPLIED}+1"
for m in "${MIG_ORDER[@]}"; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
ok "migrasi diterapkan: ${N_APPLIED} → $((N_APPLIED + 1)); tidak ada yang menggantung"
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
for f in backend/src/lib/domain/productionBoard.js backend/src/lib/domain/productionRencana.js backend/src/services/productionPlanningCommandService.js backend/src/services/productionExperienceReadService.js backend/src/services/productionRencanaService.js backend/src/services/productionSettingsService.js backend/src/routes/productionExperience.js backend/src/routes/units.js backend/src/lib/domain/productionCorner.js backend/src/services/finance/biayaBahan.js; do
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
done
ok "berkas kunci Produksi/Finance di container = kandidat (byte-identik)"
for ep in "GET /api/production-v2/settings" "PUT /api/production-v2/settings/qc-gate-default" "PUT /api/production-v2/stations/TABLE_1/pic" "GET /api/production-v2/plans/00000000-0000-0000-0000-000000000000/schedule-history" "PATCH /api/units/00000000-0000-0000-0000-000000000000/service"; do
  m="${ep%% *}"; u="${ep#* }"; [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X "$m" "${PUBLIC_URL}${u}")" = "401" ] || die "endpoint ${ep} tidak menjawab 401 tanpa login"
done
ok "endpoint baru aktif dan menolak tanpa login (401)"
[ "$(psql_live -At -c "select md5(coalesce(string_agg(f::text,'|' order by f.key),'')) from v2_feature_flags f")" = "$FLAG_SEBELUM" ] || die "flag/cohort V2 BERUBAH selama rilis"
[ "$(psql_live -At -c "select md5(coalesce(string_agg(s::text,'|' order by s.key),'')) from production_settings s")" = "$SET_SEBELUM" ] || die "production_settings BERUBAH selama rilis"
[ "$(psql_live -At -c "select count(*) from production_settings where key='qc_gate_default_policy'")" = "$QCG_SEBELUM" ] || die "setting gerbang QC berubah selama rilis"
ok "flag/cohort V2 + production_settings BYTE-IDENTIK; kebijakan V2 TIDAK aktif; Run baru tetap dipin NULL"
[ "$(psql_live -At -c "select (select count(*) from production_station_day_pics_v2) || '|' || (select count(*) from production_plan_schedule_events_v2) || '|' || (select count(*) from production_run_plans_v2 where target_date is not null)")" = "0|0|0" ] || die "tabel PIC bawaan Meja / riwayat jadwal / target khusus TIDAK kosong setelah rilis (rilis ini tidak boleh menulis data)"
ok "tabel baru kosong: PIC bawaan Meja 0, riwayat jadwal 0, target khusus 0 (rilis tidak menulis data)"
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} tidak bisa diunduh (404)"
  ok "aset lama ${OLD_ONLY} masih 200"
fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang tidak ada harus 404 jujur"
ok "aset yang tidak ada = 404 (bukan index.html)"
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$SNAP_SQL" </dev/null > "$BK_DIR/data-sesudah.txt" || die "snapshot data sesudah gagal"
if diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null; then ok "order, jurnal, saldo, payment, PO, stok, run V2 IDENTIK sebelum vs sesudah rilis"
else diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; warn "data transaksi berubah selama rilis — hampir pasti transaksi pengguna yang sah (rilis ini tidak menulis data); tinjau selisih di atas"; fi
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
say "SELESAI — rilis ${DEPLOY_SHORT} aktif (kode saja; cohort/setting/PIC/jadwal tidak diubah). Backup: ${BACKUP_FILE} (sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")). Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
