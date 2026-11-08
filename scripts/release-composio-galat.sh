#!/usr/bin/env bash
# RILIS PERBAIKAN GALAT + NOTIFIKASI SYNC META COMPOSIO - backend saja, tanpa migrasi, tanpa frontend. FAIL-CLOSED.
#   Diturunkan dari scripts/release-composio-galat.sh. Kandidat dikirim lewat bundle: BUNDLE=/tmp/gm1.bundle.
#   tr -d '\r' < scripts/release-composio-galat.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/gm1.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/gm1.bundle bash /tmp/gm1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
# .env tidak diubah skrip ini. Rollback: lihat instruksi saat berhenti; tag image rollback-pre-composio-galat-<sha>.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/composio-galat-notif-on-68536152}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Package/frontend/compose tidak boleh ikut.
ALLOWED_RE='^(backend/scripts/notifikasi-sync-meta\.js|backend/src/services/attribution/composioMeta\.js|backend/src/services/attribution/composioMetaNotif\.js|backend/tests/composioMeta\.test\.js|backend/tests/composioMetaNotif\.test\.js|scripts/sync-meta-composio-cron\.sh|scripts/templates/release-meta-composio/rilis\.txt|scripts/release-composio-galat\.sh)$'
BACKEND_SRC_EXPECT="backend/src/services/attribution/composioMeta.js backend/src/services/attribution/composioMetaNotif.js"
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
BK_DIR="$HOME/release-backups/composio-galat-${DEPLOY_SHORT}-${TS}"
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
Rilis ini tanpa migrasi: rollback kode tidak membutuhkan pemulihan database.
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
exec 9>/tmp/release-composio-galat.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "gm1\|release-composio-galat\|pgrep\|node src/index.js" || true)"
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
[ -f "${BUNDLE:-}" ] || die "BUNDLE tidak ada"
sg fetch -q origin "+refs/heads/main:refs/remotes/origin/main" || die "git fetch main gagal"
sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" || die "fetch bundle gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
sg merge-base --is-ancestor "$MAIN_SHA" "$BASE_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur baseline ${BASE_SHA:0:8} — main memuat pekerjaan yang tidak ada di release aktif; gabungkan lineage terbaru lalu ulangi tes/preflight"
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat — fast-forward main tidak akan mungkin"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "daftar berkas backend/src yang berubah tidak sama dengan yang diaudit"
! printf '%s\n' "$CHANGED" | grep -qE '^frontend/|package(-lock)?\.json$|^docker-compose|Dockerfile' || die "frontend/dependensi/compose berubah — rilis ini harus backend-saja"
[ -z "$(sg diff "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | tr -d '\r' | grep -E '^-[^-]' || true)" ] || die "schema.prisma bukan murni penambahan"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; origin/main (${MAIN_SHA:0:8}) leluhur baseline dan kandidat (fast-forward mungkin); $(printf '%s\n' "$CHANGED" | wc -l) berkas, semua dalam allowlist; backend/src = $(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w) berkas yang diaudit; schema murni penambahan; tanpa frontend/dependensi"

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
ok "migrasi terpasang sebelum rilis = ${MIG_SEBELUM} (tidak boleh berubah)"
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
BACKUP_FILE="$HOME/backups/pre-composio-galat-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

PHASE="3b-restore"; say "3b. Validasi restore: pulihkan backup NYATA ke DB sementara dan cocokkan jumlah baris (DB produksi tidak disentuh)"
REH_DB="rehearsal_gm1_${TS}"
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
[ "$(sg ls-remote origin "refs/heads/main" | cut -f1)" = "$MAIN_SHA" ] || die "origin/main bergeser selama backup"
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-composio-galat-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

# Smoke baca-saja: klasifikasi galat dan keberadaan pengirim notifikasi.
cat > "$BK_DIR/smoke.mjs" <<'NODE'
const { kelasGalat } = await import("/app/src/services/attribution/composioMeta.js");
const { susunPesanGagal } = await import("/app/src/services/attribution/composioMetaNotif.js");
const fs = await import("node:fs");
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " - " + d : ""}`); };
rec("OAuthException kode 17 = RATE_LIMIT", kelasGalat('{"type":"OAuthException","code":17}').kode === "RATE_LIMIT");
rec("kode 190 = TOKEN_KEDALUWARSA", kelasGalat('{"type":"OAuthException","code":190}').kode === "TOKEN_KEDALUWARSA");
rec("pesan notifikasi tersusun", /GAGAL/.test(susunPesanGagal({ tahap: "commit", rc: 2, keluaran: '{"status":"GAGAL"}', waktu: "t" }).subject));
rec("skrip notifikasi ada", fs.existsSync("/app/scripts/notifikasi-sync-meta.js"));
rec("tujuan WA terisi", Boolean(process.env.SYNC_META_ALERT_PHONE));
rec("flag sync tetap menyala", process.env.COMPOSIO_META_SYNC_ENABLED === "true");
console.log(`SMOKE_HASIL mode=after fail=${fail} skip=0`);
process.exit(fail ? 1 : 0);
NODE

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali; tanpa migrasi)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
# Saat pergantian, container lama bisa masih terdaftar: tunggu tepat satu container dari image baru.
CID_NEW=""
for i in $(seq 1 30); do
  CAL="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
  if [ "$(printf '%s\n' "$CAL" | grep -c .)" = "1" ] && [ "$(docker inspect -f '{{.Image}}' "$CAL" 2>/dev/null)" = "$NEW_IMG_ID" ]; then CID_NEW="$CAL"; break; fi
  sleep 2
done
[ -n "$CID_NEW" ] || die "container berjalan tetapi bukan image baru"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat setelah pergantian"
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
[ "$MIG_SESUDAH" = "$MIG_SEBELUM" ] || die "jumlah migrasi berubah (${MIG_SEBELUM} -> ${MIG_SESUDAH})"
ok "migrasi terpasang ${MIG_SEBELUM} -> ${MIG_SESUDAH}"

PHASE="8b-smoke"; say "8b. Smoke klasifikasi galat dan sync (tanpa menulis data)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - < "$BK_DIR/smoke.mjs" > "$BK_DIR/smoke.log" 2>&1 || { cat "$BK_DIR/smoke.log" | tail -n 60; die "smoke test GAGAL"; }
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

trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
