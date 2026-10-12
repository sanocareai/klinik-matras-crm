#!/usr/bin/env bash
# RILIS VALIDASI PARAMETER UUID — BACKEND SAJA, TANPA migrasi, TANPA frontend/dependensi, TANPA perubahan data. FAIL-CLOSED.
#   19 endpoint GET yang dulu menjawab 500 untuk id berformat cuid/string rusak (kolom @db.Uuid) kini menjawab 400 {code:"ID_TIDAK_VALID"} SETELAH 401/403 dan SEBELUM Prisma dipanggil;
#   rute saudara (id yang sama) di router yang sama ikut dilindungi; galat internal Prisma tidak lagi bocor ke badan respons 500; schedule-history untuk plan yang tidak ada = 404.
# Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA); dist frontend DISALIN dari release aktif. Sebelum switch: backup + gzip + RESTORE nyata ke DB sementara.
# Verifikasi pasca-rilis BACA-SAJA: tidak ada transaksi/QA/unggahan di produksi; token uji dicetak dari akun yang sudah ada (tidak membuat akun).
#
#   cat scripts/release-validasi-uuid-param.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/vup.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/vup.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/vup.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/vup.out 2>&1 < /dev/null &'   # unggah & jalankan TERPISAH
#
# ROLLBACK: tanpa migrasi & tanpa perubahan data -> rollback kode aman kapan saja (image rollback ditandai di bawah). Tidak ada guard data yang diperlukan.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/validasi-uuid-param-id-v2}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Prisma/package/frontend/migrasi tidak boleh ikut.
ALLOWED_RE='^(backend/src/lib/galatServerAman\.js|backend/src/lib/uuidParam\.js|backend/src/routes/armada\.js|backend/src/routes/damagedStock\.js|backend/src/routes/finance\.js|backend/src/routes/financeTransactions\.js|backend/src/routes/goodsReceipt\.js|backend/src/routes/materialIssue\.js|backend/src/routes/production\.js|backend/src/routes/productionExperience\.js|backend/src/routes/purchaseOrders\.js|backend/src/routes/replenishment\.js|backend/src/routes/returnRecord\.js|backend/src/routes/stockAdjustment\.js|backend/src/routes/stockCount\.js|backend/src/routes/stockTransfer\.js|backend/src/services/productionPlanningCommandService\.js|backend/tests/integration/validasiUuidParam\.integration\.test\.js|backend/tests/validasiUuidParam\.test\.js|scripts/release-validasi-uuid-param\.sh)$'
BACKEND_SRC_EXPECT="backend/src/lib/galatServerAman.js backend/src/lib/uuidParam.js backend/src/routes/armada.js backend/src/routes/damagedStock.js backend/src/routes/finance.js backend/src/routes/financeTransactions.js backend/src/routes/goodsReceipt.js backend/src/routes/materialIssue.js backend/src/routes/production.js backend/src/routes/productionExperience.js backend/src/routes/purchaseOrders.js backend/src/routes/replenishment.js backend/src/routes/returnRecord.js backend/src/routes/stockAdjustment.js backend/src/routes/stockCount.js backend/src/routes/stockTransfer.js backend/src/services/productionPlanningCommandService.js"
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
BK_DIR="$HOME/release-backups/validasi-uuid-${DEPLOY_SHORT}-${TS}"
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
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas).
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
exec 9>/tmp/release-validasi-uuid-param.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "vup\|release-validasi-uuid-param\|pgrep\|node src/index.js" || true)"
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
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" "+refs/heads/main:refs/remotes/origin/main" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
[ "$(sg rev-parse refs/remotes/origin/main)" = "$BASE_SHA" ] || die "origin/main (${BASE_SHA:0:8} diharapkan) sudah bergeser — gabungkan lineage terbaru lalu ulangi tes/preflight"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "daftar berkas backend/src yang berubah tidak sama dengan yang diaudit"
! printf '%s\n' "$CHANGED" | grep -qE '^(backend/prisma/|frontend/)|package(-lock)?\.json$|^docker-compose|Dockerfile' || die "prisma/frontend/dependensi/compose berubah — rilis ini harus backend-saja tanpa migrasi"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main = baseline; $(printf '%s\n' "$CHANGED" | wc -l) berkas, semua dalam allowlist; backend/src = $(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w) berkas yang diaudit; tanpa prisma/frontend/dependensi"

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
# Snapshot: jurnal, saldo per akun & rekening, stok, PO, penerimaan, Payment, order, job, route, dokumen Gudang, work center, plan v2, flag. Identik-wajib: flag/pengaturan/PO; sisanya tidak boleh BERKURANG.
SNAP_SQL="select 'jurnal', count(*), md5(coalesce(string_agg(e.id::text||e.status::text||e.entry_number, '|' order by e.id),'')) from fin_journal_entries e union all select 'baris_jurnal_saldo', count(*), md5(coalesce(string_agg(l.id::text||l.debit::text||l.credit::text||l.account_id::text||coalesce(l.order_id,'')||coalesce(l.cash_account_id::text,''), '|' order by l.id),'')) from fin_journal_lines l union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(t.k||t.s, '|' order by t.k),'')) from (select a.code as k, sum(l.debit-l.credit)::text as s from fin_journal_lines l join fin_accounts a on a.id=l.account_id join fin_journal_entries e on e.id=l.entry_id where e.status in ('POSTED','REVERSED') group by a.code) t union all select 'saldo_per_rekening', count(*), md5(coalesce(string_agg(t.k||t.s, '|' order by t.k),'')) from (select c.name as k, sum(l.debit-l.credit)::text as s from fin_journal_lines l join fin_cash_accounts c on c.id=l.cash_account_id join fin_journal_entries e on e.id=l.entry_id where e.status in ('POSTED','REVERSED') group by c.name) t union all select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text||coalesce(x.unit_cost::text,'')||x.material_id::text||x.type::text, '|' order by x.id),'')) from stock_movements x union all select 'po', count(*), md5(coalesce(string_agg(p::text, '|' order by p.id),'')) from fin_purchase_orders p union all select 'po_event', count(*), md5(coalesce(string_agg(p.id::text, '|' order by p.id),'')) from fin_purchase_order_events p union all select 'penerimaan', count(*), md5(coalesce(string_agg(g::text, '|' order by g.id),'')) from goods_receipts g union all select 'baris_penerimaan', count(*), md5(coalesce(string_agg(g::text, '|' order by g.id),'')) from goods_receipt_lines g union all select 'payment', count(*), md5(coalesce(string_agg(p.id::text||p.amount::text||coalesce(p.cancelled_at::text,''), '|' order by p.id),'')) from payments p union all select 'order', count(*), md5(coalesce(string_agg(o.id||o.status::text||o.\"paymentStatus\"::text||coalesce(o.paid_at::text,''), '|' order by o.id),'')) from \"Order\" o union all select 'job', count(*), md5(coalesce(string_agg(j.id::text||j.status::text||coalesce(j.route_id::text,''), '|' order by j.id),'')) from jobs j union all select 'route', count(*), md5(coalesce(string_agg(r.id::text||r.status::text, '|' order by r.id),'')) from routes r union all select 'material_issue', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from material_issues m union all select 'transfer', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from stock_transfers m union all select 'stock_count', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from stock_counts m union all select 'stok_rusak', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from damaged_stock_records m union all select 'retur', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from return_records m union all select 'adjustment', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from stock_adjustment_requests m union all select 'replenishment', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from replenishment_requests m union all select 'work_center', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from work_centers m union all select 'plan_v2', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from production_run_plans_v2 m union all select 'plan_event', count(*), md5(coalesce(string_agg(m.id::text, '|' order by m.id),'')) from production_plan_schedule_events_v2 m union all select 'flag_v2', count(*), md5(coalesce(string_agg(f.key||f.enabled::text||f.config::text, '|' order by f.key),'')) from v2_feature_flags f union all select 'fin_settings', count(*), md5(coalesce(string_agg(f.key||f.value, '|' order by f.key),'')) from fin_settings f union all select 'production_settings', count(*), md5(coalesce(string_agg(f::text, '|' order by f::text),'')) from production_settings f"
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sebelum.txt" || die "snapshot sebelum gagal"
[ "$(wc -l < "$BK_DIR/snap-sebelum.txt")" -ge 25 ] || die "snapshot sebelum tidak lengkap"
ok "snapshot sebelum tersimpan ($(wc -l < "$BK_DIR/snap-sebelum.txt") kelompok): jurnal, saldo akun/rekening, stok, PO, penerimaan, Payment, order, job, route, dokumen Gudang, work center, plan v2, flag, pengaturan"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 2 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-validasi-uuid-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

PHASE="3b-restore"; say "3b. Validasi restore: pulihkan backup NYATA ke DB sementara dan cocokkan jumlah baris (DB produksi tidak disentuh)"
REH_DB="rehearsal_uuid_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
# Produksi hidup: transaksi sah bisa masuk antara backup dan pembandingan — toleransi HANYA bila selisih = penambahan (produksi >= restore) dan tercatat.
for T in fin_journal_entries fin_journal_lines payments fin_accounts fin_cash_accounts stock_movements fin_purchase_orders goods_receipts jobs routes; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$B" -le "$A" ] && [ "$(( A - B ))" -le 25 ] || { reh_drop; die "restore tidak cocok untuk $T (produksi=$A restore=$B)"; }
  [ "$A" = "$B" ] && echo "  = $T $A" || echo "  ~ $T produksi=$A restore=$B (transaksi sah masuk sesudah backup)"
done
[ "$(RPSQL "select count(*) from _prisma_migrations")" = "$(psql_live -At -c "select count(*) from _prisma_migrations")" ] || { reh_drop; die "jumlah migrasi pada restore berbeda"; }
reh_drop
ok "restore backup ke DB sementara berhasil: tabel kunci cocok (selisih hanya transaksi baru sesudah backup); DB sementara dihapus"

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; dist frontend disalin dari release aktif; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
[ "$(sg ls-remote origin "refs/heads/main" | cut -f1)" = "$BASE_SHA" ] || die "origin/main bergeser selama backup"
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-validasi-uuid-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

# Skrip smoke baca-saja: dipakai SEBELUM switch (di container lama: rekam respons id NYATA) dan SESUDAH switch (di container baru: perilaku baru + perbandingan).
cat > "$BK_DIR/smoke.mjs" <<'NODE'
import { createRequire } from "node:module";
import crypto from "node:crypto";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const APP_ROOT = process.env.APP_ROOT || "/app"; // lokal (uji skrip): APP_ROOT=<folder backend>
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL(APP_ROOT + "/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const MODE = process.env.MODE; // before | after
const BEFORE = MODE === "after" ? JSON.parse(process.env.BEFORE_JSON || "{}") : {};
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
const PUBLIK = process.env.SMOKE_PUBLIK || "https://app.sanomatrassehat.com";
let fail = 0, skip = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const lewati = (n, alasan) => { skip++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const info = (n) => console.log(`  INFO  ${n}`);
const CUID = "cmgz1k8q40000x7e5f2h9d3ab";
const NOL = "00000000-0000-4000-8000-000000000000";
const BOCOR = /prisma|stack|\bat\s+\S+\.js|node_modules|\$queryRaw|select\s.+\sfrom|insert\s+into|\/app\/|\/home\/|jwt_secret|database_url|postgres(ql)?:\/\/|invocation|P20\d\d/i;
async function api(method, path, token, base = BASE) {
  const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
  const teks = await r.text(); let json = null; try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  return { status: r.status, json, teks };
}
const tokenUntuk = async (u) => {
  const roles = (await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role);
  return jwt.sign({ id: u.id, name: u.name, role: u.role, roles: roles.length ? roles : [u.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });
};
const aktif = await prisma.user.findMany({ where: { active: true } });
const peranUser = new Map();
for (const u of aktif) peranUser.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => izin.some((p) => (ROLE_PERMISSIONS[r] || []).includes(p)));
const PREFERENSI = ["ADMIN", "OWNER", "WAREHOUSE", "PRODUCTION_LEAD", "DISPATCHER", "FINANCE"];
async function tokenBerizin(izin) {
  const kandidat = aktif.filter((u) => punya(peranUser.get(u.id), izin));
  kandidat.sort((a, b) => Math.min(...peranUser.get(a.id).map((r) => (PREFERENSI.includes(r) ? PREFERENSI.indexOf(r) : 99))) - Math.min(...peranUser.get(b.id).map((r) => (PREFERENSI.includes(r) ? PREFERENSI.indexOf(r) : 99))));
  return kandidat[0] ? tokenUntuk(kandidat[0]) : null;
}
async function tokenTerlarang(izin) {
  const u = aktif.find((x) => peranUser.get(x.id).every((r) => ROLE_PERMISSIONS[r]) && !punya(peranUser.get(x.id), izin));
  return u ? tokenUntuk(u) : null;
}
const terbaru = async (model, where = {}) => {
  try { return (await prisma[model].findFirst({ where, orderBy: { createdAt: "desc" }, select: { id: true } }))?.id ?? null; }
  catch { /* model tanpa createdAt */ }
  try { return (await prisma[model].findFirst({ where, select: { id: true } }))?.id ?? null; } catch { return null; }
};
const EP = [
  ["production/work-centers/:id", (id) => `/api/production/work-centers/${id}`, [P.WORK_CENTER_READ], () => terbaru("workCenter")],
  ["inventory/goods-receipts/:id", (id) => `/api/inventory/goods-receipts/${id}`, [P.INVENTORY_READ], () => terbaru("goodsReceipt")],
  ["inventory/purchase-orders/:id", (id) => `/api/inventory/purchase-orders/${id}`, [P.INVENTORY_READ], () => terbaru("finPurchaseOrder", { status: { not: "DRAFT" } })],
  ["inventory/material-issues/:id", (id) => `/api/inventory/material-issues/${id}`, [P.INVENTORY_READ], () => terbaru("materialIssue")],
  ["inventory/transfers/:id", (id) => `/api/inventory/transfers/${id}`, [P.INVENTORY_READ], () => terbaru("stockTransfer")],
  ["inventory/stock-counts/:id", (id) => `/api/inventory/stock-counts/${id}`, [P.INVENTORY_READ], () => terbaru("stockCount")],
  ["inventory/damaged-stock/:id", (id) => `/api/inventory/damaged-stock/${id}`, [P.INVENTORY_READ], () => terbaru("damagedStockRecord")],
  ["inventory/returns/:id", (id) => `/api/inventory/returns/${id}`, [P.INVENTORY_READ], () => terbaru("returnRecord")],
  ["inventory/adjustments/:id", (id) => `/api/inventory/adjustments/${id}`, [P.INVENTORY_READ], () => terbaru("stockAdjustmentRequest")],
  ["inventory/replenishment/:id", (id) => `/api/inventory/replenishment/${id}`, [P.INVENTORY_READ], () => terbaru("replenishmentRequest")],
  ["production-v2/plans/:id/schedule-history", (id) => `/api/production-v2/plans/${id}/schedule-history`, [P.UNIT_READ], () => terbaru("productionRunPlan")],
  ["finance/purchases/:id/advance-summary", (id) => `/api/finance/purchases/${id}/advance-summary`, [P.FINANCE_READ, P.FINANCE_EXPENSE_SUBMIT], () => terbaru("finPurchase")],
  ["armada/routes/:id", (id) => `/api/armada/routes/${id}`, [P.JOB_READ], () => terbaru("route")],
  ["armada/routes/:id/maps-link", (id) => `/api/armada/routes/${id}/maps-link`, [P.JOB_READ], () => terbaru("route")],
  ["armada/routes/:id/map", (id) => `/api/armada/routes/${id}/map`, [P.JOB_READ, P.JOB_OWN_READ], () => terbaru("route")],
  ["armada/routes/:id/route-trace", (id) => `/api/armada/routes/${id}/route-trace`, [P.JOB_READ], () => terbaru("route")],
  ["armada/routes/:id/prep-checklist", (id) => `/api/armada/routes/${id}/prep-checklist`, [P.JOB_WRITE, P.JOB_OWN_WRITE], () => terbaru("route")],
  ["armada/routes/:id/timeline", (id) => `/api/armada/routes/${id}/timeline`, [P.JOB_READ, P.JOB_OWN_READ, P.JOB_OWN_WRITE], () => terbaru("route")],
  ["armada/jobs/:id", (id) => `/api/armada/jobs/${id}`, [P.JOB_READ, P.JOB_OWN_READ], () => terbaru("job")],
];
const bentuk = (v, pre = "") => {
  if (Array.isArray(v)) return [...new Set(v.flatMap((x) => bentuk(x, pre + "[]")))];
  if (v && typeof v === "object") return Object.keys(v).flatMap((k) => [pre + "." + k, ...bentuk(v[k], pre + "." + k)]);
  return [];
};
const struktur = (json) => crypto.createHash("sha256").update([...new Set(bentuk(json))].sort().join("\n")).digest("hex").slice(0, 16);
const sha = (teks) => crypto.createHash("sha256").update(teks).digest("hex").slice(0, 16);

const cacah = async () => [await prisma.finJournalEntry.count(), await prisma.finJournalLine.count(), await prisma.payment.count(), await prisma.stockMovement.count(), await prisma.finPurchaseOrder.count(), await prisma.goodsReceipt.count(), await prisma.job.count(), await prisma.route.count(), await prisma.order.count()];
const sebelum = await cacah();
const rekam = {};
for (const [nama, buat, izin, cari] of EP) {
  const tB = await tokenBerizin(izin);
  const tL = await tokenTerlarang(izin);
  const id = await cari();
  if (!tB) { lewati(`${nama}: token berizin`, "tidak ada akun aktif dengan izin ini; token tidak dibuat/direkayasa"); continue; }
  if (MODE === "before") {
    if (!id) { rekam[nama] = null; info(`${nama}: tidak ada data nyata di produksi`); continue; }
    const r = await api("GET", buat(id), tB);
    rekam[nama] = { status: r.status, struktur: struktur(r.json), sha: sha(r.teks) };
    info(`${nama}: sebelum switch ${r.status}`);
    continue;
  }
  // — SESUDAH switch —
  rec(`${nama}: tanpa token -> 401`, (await api("GET", buat(CUID))).status === 401);
  if (tL) { const r = await api("GET", buat(CUID), tL); rec(`${nama}: peran tak berizin + id rusak -> 403 (bukan 400/500)`, r.status === 403, String(r.status)); }
  else lewati(`${nama}: peran tak berizin -> 403`, "tidak ada akun aktif murni tanpa izin ini");
  for (const [label, rusak] of [["cuid", CUID], ["teks bebas", "bukan-uuid"], ["UUID kelebihan karakter", NOL + "0"]]) {
    const r = await api("GET", buat(encodeURIComponent(rusak)), tB);
    rec(`${nama}: berizin + ${label} -> 400 ID_TIDAK_VALID persis`, r.status === 400 && r.json?.code === "ID_TIDAK_VALID" && r.json?.message === "ID tidak valid." && Object.keys(r.json).length === 2 && !BOCOR.test(r.teks), `${r.status} ${r.teks.slice(0, 120)}`);
  }
  const h = await api("GET", buat(NOL), tB);
  rec(`${nama}: UUID valid tidak ada -> 404 tanpa detail internal`, h.status === 404 && !BOCOR.test(h.teks), `${h.status} ${h.teks.slice(0, 120)}`);
  if (!id) { lewati(`${nama}: id nyata`, "tidak ada data nyata di produksi (data tidak dibuat untuk uji)"); continue; }
  const b = BEFORE[nama];
  const r = await api("GET", buat(id), tB);
  if (!b) { rec(`${nama}: id nyata -> bukan 5xx`, r.status < 500, String(r.status)); continue; }
  rec(`${nama}: id nyata -> status sama dengan sebelum switch (${b.status})`, r.status === b.status, `${r.status}`);
  rec(`${nama}: id nyata -> struktur payload identik`, struktur(r.json) === b.struktur);
  if (sha(r.teks) === b.sha) info(`${nama}: payload byte-identik`); else info(`${nama}: struktur sama, isi berbeda (data hidup berubah di sela rilis)`);
}
if (MODE === "after") {
  // Rute saudara: 403 untuk peran terlarang, 400 untuk berizin — tanpa pernah mencapai handler (tak ada tulis).
  const tG = await tokenBerizin([P.INVENTORY_WRITE]), tS = await tokenTerlarang([P.INVENTORY_WRITE]);
  for (const [m, p] of [["PATCH", `/api/inventory/returns/${CUID}/cancel`], ["POST", `/api/inventory/stock-counts/${CUID}/start`], ["PATCH", `/api/inventory/goods-receipts/${CUID}/reject`], ["POST", `/api/inventory/material-issues/${CUID}/issue`]]) {
    rec(`${m} ${p.replace(CUID, ":id")}: tanpa token 401`, (await api(m, p)).status === 401);
    if (tS) rec(`${m} ${p.replace(CUID, ":id")}: peran tak berizin 403`, (await api(m, p, tS)).status === 403);
    if (tG) { const r = await api(m, p, tG); rec(`${m} ${p.replace(CUID, ":id")}: berizin + cuid 400 (tidak mencapai handler)`, r.status === 400 && r.json?.code === "ID_TIDAK_VALID", String(r.status)); }
    else lewati(`${m} ${p.replace(CUID, ":id")}: berizin`, "tidak ada akun dengan inventory:write");
  }
  // Domain publik (nginx) membawa respons yang sama.
  const tB0 = await tokenBerizin([P.INVENTORY_READ]);
  rec("domain publik: tanpa token 401", (await api("GET", `/api/inventory/returns/${CUID}`, null, PUBLIK)).status === 401);
  if (tB0) { const r = await api("GET", `/api/inventory/returns/${CUID}`, tB0, PUBLIK); rec("domain publik: berizin + cuid 400 ID_TIDAK_VALID", r.status === 400 && r.json?.code === "ID_TIDAK_VALID", String(r.status)); }
  const sesudah = await cacah();
  rec("tidak ada baris yang BERKURANG selama smoke (jurnal, baris jurnal, payment, stok, PO, penerimaan, job, route, order)", sebelum.every((n, i) => sesudah[i] >= n), `${sebelum.join(",")} -> ${sesudah.join(",")}`);
}
await prisma.$disconnect();
if (MODE === "before") console.log("REAL_BEFORE " + JSON.stringify(rekam));
console.log(`SMOKE_HASIL mode=${MODE} fail=${fail} skip=${skip}`);
process.exit(fail ? 1 : 0);
NODE

PHASE="5b-rekam-sebelum"; say "5b. Rekam respons id NYATA dari backend LAMA (baca-saja) untuk dibandingkan sesudah switch"
dcp "$PREV_DIR" exec -T -e MODE=before backend node --input-type=module - < "$BK_DIR/smoke.mjs" > "$BK_DIR/smoke-sebelum.log" 2>&1 || { tail -n 20 "$BK_DIR/smoke-sebelum.log"; die "perekaman sebelum switch gagal"; }
REAL_BEFORE="$(grep '^REAL_BEFORE ' "$BK_DIR/smoke-sebelum.log" | sed 's/^REAL_BEFORE //')"
[ -n "$REAL_BEFORE" ] || die "rekaman sebelum switch kosong"
ok "respons id nyata terekam ($(grep -c ': sebelum switch' "$BK_DIR/smoke-sebelum.log") endpoint ber-data; sisanya tidak punya data di produksi)"

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
# Berkas keuangan/ledger yang TIDAK boleh berubah dari baseline.
for f in services/finance/journal.js services/finance/posting/orderRevenue.js services/inventoryLedger.js middleware/authorize.js middleware/auth.js; do
  want="$(sg show "${BASE_SHA}:backend/src/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/src/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "${f} di container BERBEDA dari baseline"
done
ok "journal.js, orderRevenue.js, inventoryLedger.js, authorize.js, auth.js tidak berubah dari baseline"
MIG_SESUDAH="$(dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null" </dev/null)"
[ "$MIG_SESUDAH" = "$MIG_SEBELUM" ] || die "jumlah migrasi berubah (${MIG_SEBELUM} -> ${MIG_SESUDAH}) padahal rilis ini tanpa migrasi"
ok "migrasi terpasang tetap ${MIG_SESUDAH} (tanpa migrasi)"

PHASE="8b-smoke"; say "8b. Smoke 19 endpoint + rute saudara (baca-saja; TIDAK membuat data/transaksi QA di produksi)"
dcp "$NEW_DIR" exec -T -e MODE=after -e BEFORE_JSON="$REAL_BEFORE" backend node --input-type=module - < "$BK_DIR/smoke.mjs" > "$BK_DIR/smoke.log" 2>&1 || { cat "$BK_DIR/smoke.log" | tail -n 60; die "smoke test GAGAL"; }
cat "$BK_DIR/smoke.log"
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL mode=after fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke tidak mencetak ringkasan SMOKE_HASIL yang lulus"
if [ "$SMOKE_SKIP" != "0" ]; then warn "smoke lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat ${BK_DIR}/smoke.log — BUKAN PASS untuk yang dilewati"; else ok "smoke test lulus tanpa SKIP"; fi

PHASE="8c-snapshot"; say "8c. Snapshot data sebelum vs sesudah"
sleep 5
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sesudah.txt" || die "snapshot sesudah gagal"
if cmp -s "$BK_DIR/snap-sebelum.txt" "$BK_DIR/snap-sesudah.txt"; then ok "SELURUH snapshot IDENTIK (jurnal, saldo akun & rekening, stok, PO, penerimaan, Payment, order, job, route, dokumen Gudang, work center, plan v2, flag, pengaturan)"; else
  echo "  INFO  snapshot berbeda — rincian (transaksi pengguna sah di sela rilis harus tampak sebagai penambahan):"; diff "$BK_DIR/snap-sebelum.txt" "$BK_DIR/snap-sesudah.txt" || true
  for k in flag_v2 fin_settings production_settings po po_event; do
    [ "$(awk -F'|' -v k="$k" '$1==k' "$BK_DIR/snap-sebelum.txt")" = "$(awk -F'|' -v k="$k" '$1==k' "$BK_DIR/snap-sesudah.txt")" ] || die "$k BERUBAH selama rilis (flag/pengaturan/PO tidak boleh berubah)"
  done
  while IFS='|' read -r kk nn _; do
    [ "$(awk -F'|' -v k="$kk" '$1==k{print $2}' "$BK_DIR/snap-sesudah.txt")" -ge "$nn" ] || die "jumlah baris $kk BERKURANG selama rilis"
  done < "$BK_DIR/snap-sebelum.txt"
  ok "flag, pengaturan, dan PO identik; selisih lain hanya penambahan (aktivitas pengguna sah di sela rilis, tercatat di log)"
fi
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
LOGERR="$(docker logs --since 5m "$CID_NEW" 2>&1 | grep -ciE 'unhandled|uncaught|Cannot find module|SyntaxError' || true)"
[ "${LOGERR:-0}" = "0" ] || { docker logs --since 5m "$CID_NEW" 2>&1 | grep -iE 'unhandled|uncaught|Cannot find module|SyntaxError' | tail -n 10; die "log backend 5 menit terakhir memuat galat fatal (${LOGERR})"; }
ok "log backend 5 menit terakhir bersih dari galat fatal (unhandled/uncaught/module/syntax)"

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
