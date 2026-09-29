#!/usr/bin/env bash
# Rilis MANUAL Finance B3.8 (koreksi Tagihan Supplier & Refund tanpa PIN) + B3.9 (Export Excel 11 modul) ke produksi dengan workflow
# RELEASE-DIRECTORY (~/releases/klinik-matras/<sha8>). Diadaptasi dari release-resi-fase2.sh (gate, backup + verifikasi restore, image rollback)
# dan release-ukuran-custom.sh (build frontend SAAT RILIS di release dir baru).
#
#   git show <sha>:scripts/release-finance-b38-b39.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/rfb38.sh && bash /tmp/rfb38.sh <DEPLOY_SHA_LENGKAP> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rfb38.sh <DEPLOY_SHA_LENGKAP>'
#
# Baseline produksi = hotfix b9da5705 (fail-closed Production V2 + invariant lifecycle P1-P6) yang sudah menjadi HEAD main. DEPLOY_SHA = HEAD
# origin/feat/b38-finance-koreksi-lanjutan dan WAJIB keturunan baseline (dan main). Satu-satunya migration pending:
# 20261003070000_finance_koreksi_tagihan_refund (aditif: 2 kolom nullable + UNIQUE + FK). Tidak ada backfill, tidak ada transaksi produksi baru.
# Prinsip: fail-fast; tanpa reset/stash/force; TANPA rollback otomatis (hanya instruksi); tanpa secret di layar; DROP hanya DB sementara verifikasi restore.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
PROD_FULL="b9da5705d0118d3e91111ec56b8245a89a70a338"      # release aktif = hotfix fail-closed Production V2 (baseline)
HOTFIX_PARENT="2644f1753ff5fcd7c04ea4ca9a9f3ef46f44547f"  # induk hotfix: (HOTFIX_PARENT..PROD_FULL) = 13 berkas hotfix yang tidak boleh berubah
NEW_MIGRATION="20261003070000_finance_koreksi_tagihan_refund"
CAND_BRANCH="feat/b38-finance-koreksi-lanjutan"
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
BK_DIR="$HOME/release-backups/finb38-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_COMMIT=""; PREV_IMG_ID=""; IMG_NAME=""; VERIFY_DB=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
CDIR=""
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
B. Setelah switch, backend bermasalah -> kembali ke release + image sebelumnya (tanpa build ulang):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps backend
   curl -fsS ${INTERNAL_URL}/api/health
C. Kolom fin_supplier_bills.replaces_bill_id dan fin_refunds.replaces_refund_id TIDAK dihapus oleh rollback kode: kode lama tidak membacanya,
   kolom nullable & kosong (aman dibiarkan). Penghapusan skema/data HANYA atas permintaan eksplisit pemilik.
D. Restore dari backup hanya jalan terakhir dan wajib persetujuan pemilik (docs/PANDUAN-RESTORE-BACKUP.md bagian 6).
──────────────────────────────────────────────────────────────────────────────────────────────────────────
EOF
}

cleanup() {
  local rc=$?
  if [ -n "$VERIFY_DB" ] && [[ "$VERIFY_DB" =~ ^km_release_verify_[0-9]{8}_[0-9]{6}$ ]] && [ -n "$PREV_DIR" ]; then
    dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" --if-exists "$VERIFY_DB" </dev/null >/dev/null 2>&1 || warn "gagal menghapus DB sementara ${VERIFY_DB}"
  fi
  if [ $rc -ne 0 ]; then
    printf '\n\033[31mRILIS BERHENTI (kode %s) pada fase: %s. Tidak ada rollback otomatis.\033[0m\n' "$rc" "$PHASE" >&2
    [ "$PREFLIGHT_ONLY" = "1" ] || rollback_instructions >&2
  fi
}
trap cleanup EXIT

# Bukti keadaan data (BACA-SAJA). Tahan terhadap sebelum/sesudah migrasi: kolom versi baru dibuang dari hash (to_jsonb - 'kolom').
BASELINE_SQL=$(cat <<'SQL'
select 'jurnal', count(*), md5(coalesce(string_agg(e.id::text || e.status || e.entry_number, ',' order by e.id), '')) from fin_journal_entries e;
select 'baris_jurnal', count(*), sum(l.debit), sum(l.credit), md5(coalesce(string_agg(l.id::text || l.debit || l.credit || l.account_id, ',' order by l.id), '')) from fin_journal_lines l;
select 'saldo_semua_akun', md5(coalesce(string_agg(t.code || ':' || t.s, ',' order by t.code), '')) from (select a.code, coalesce(sum(l.debit - l.credit), 0) s from fin_accounts a left join fin_journal_lines l on l.account_id = a.id left join fin_journal_entries e on e.id = l.entry_id and e.status in ('POSTED', 'REVERSED') group by a.code) t;
select 'kas', c.name, coalesce(sum(l.debit - l.credit), 0) from fin_cash_accounts c left join fin_journal_lines l on l.account_id = c.account_id left join fin_journal_entries e on e.id = l.entry_id and e.status in ('POSTED', 'REVERSED') group by c.name order by c.name;
select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from payments x;
select 'alokasi_pembayaran', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_payment_allocations x;
select 'tagihan_supplier', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'replaces_bill_id')::text, '|' order by x.id), '')) from fin_supplier_bills x;
select 'pembayaran_supplier', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_supplier_payments x;
select 'alokasi_supplier', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_supplier_payment_allocations x;
select 'refund', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'replaces_refund_id')::text, '|' order by x.id), '')) from fin_refunds x;
select 'pengeluaran', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_expenses x;
select 'pembelian', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_purchases x;
select 'kasbon', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_kasbon x;
select 'persediaan_awal', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_inventory_openings x;
select 'fin_settings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key), '')) from fin_settings x;
select 'order', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from "Order" x;
select 'unit', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from units x;
select 'job', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from jobs x;
select 'flag_v2', key, enabled, scope from v2_feature_flags order by key;
select 'kolom_versi_ada', count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'fin_supplier_bills' and column_name = 'replaces_bill_id') or (table_name = 'fin_refunds' and column_name = 'replaces_refund_id'));
select 'versi_tagihan_terisi', count(*) from fin_supplier_bills x where (to_jsonb(x) ->> 'replaces_bill_id') is not null;
select 'versi_refund_terisi', count(*) from fin_refunds x where (to_jsonb(x) ->> 'replaces_refund_id') is not null;
SQL
)
snapshot() { printf '%s\n' "$BASELINE_SQL" | dcp "${CDIR:-$PREV_DIR}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q; }
# Baris yang BOLEH berbeda antara sebelum dan sesudah migrasi (hanya penanda kolom baru).
SKIP_KOLOM='^(kolom_versi_ada)\|'

# ── 0. Lingkungan & kunci deploy ─────────────────────────────────────────────────────────────────────────
PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df comm node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
docker compose version >/dev/null 2>&1 || die "docker compose tidak tersedia"
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-finance-b38.lock; flock -n 9 || die "rilis ini sudah berjalan (kunci /tmp/release-finance-b38.lock)"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rfb38\|release-finance-b38\|pgrep" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain: semua kunci /tmp/release-*.lock bebas dan tidak ada proses build/migrate lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
LOG="$BK_DIR/release.log"; exec > >(tee -a "$LOG") 2>&1
ok "log: ${LOG}"
[ -d "$RELEASES" ] || die "direktori rilis ${RELEASES} tidak ada"
[ -f "$PERSIST/backend/.env" ] || die "${PERSIST}/backend/.env tidak ada"
[ -f "$PERSIST/frontend/.env" ] || die "${PERSIST}/frontend/.env tidak ada (VITE_* wajib saat build)"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong di ${PERSIST}/frontend/.env (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
ok "root persisten lengkap"
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

# ── 1. Sumber kode ───────────────────────────────────────────────────────────────────────────────────────
PHASE="1-sumber"; say "1. Sumber kode, ancestry, dan batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=500 origin "+refs/heads/main:refs/remotes/origin/main" "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" || die "git fetch origin gagal"
ORIGIN_CAND="$(sg rev-parse refs/remotes/origin/cand)"
[ "$ORIGIN_CAND" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} (${ORIGIN_CAND:0:8}) BUKAN SHA rilis (${DEPLOY_SHORT}); kandidat bergeser"
sg cat-file -e "${PROD_FULL}^{commit}" 2>/dev/null || die "commit baseline ${PROD_FULL:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$PROD_FULL" "$DEPLOY_SHA" || die "release aktif (hotfix ${PROD_FULL:0:8}) BUKAN leluhur kandidat ${DEPLOY_SHORT}"
sg merge-base --is-ancestor "$PROD_FULL" refs/remotes/origin/main || die "hotfix ${PROD_FULL:0:8} belum ada di origin/main"
sg merge-base --is-ancestor refs/remotes/origin/main "$DEPLOY_SHA" || die "origin/main belum di-merge ke kandidat"
ok "hotfix ${PROD_FULL:0:8} ada di origin/main DAN leluhur kandidat ${DEPLOY_SHORT}; origin/main juga leluhur kandidat"
CHANGED="$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "tidak ada perubahan antara baseline dan kandidat"
HOT="$(sg diff --name-only "$HOTFIX_PARENT" "$PROD_FULL" | LC_ALL=C sort)"
[ "$(printf '%s\n' "$HOT" | grep -c .)" = "13" ] || die "hotfix tidak tepat 13 berkas ($(printf '%s\n' "$HOT" | grep -c .))"
OVERLAP="$(LC_ALL=C comm -12 <(printf '%s\n' "$HOT") <(printf '%s\n' "$CHANGED"))"
[ -z "$OVERLAP" ] || { printf '%s\n' "$OVERLAP" | sed 's/^/        /'; die "kandidat mengubah berkas hotfix (overlap)"; }
ok "0 dari 13 berkas hotfix diubah kandidat ($(printf '%s\n' "$CHANGED" | grep -c .) berkas berubah dari baseline)"
FORBID="$(printf '%s\n' "$CHANGED" | grep -E '^(backend/src/services/(production|unitCustody|v2FeatureFlags|delivery|driver|route|units)|backend/src/routes/(production|unitCustody|delivery|driver|units)|backend/scripts/production-delivery-v2/|backend/Dockerfile|docker-compose\.yml|docker-compose\.release\.yml|driver-mobile/|delivery-control/|driver-app/|packages/|backend/package(-lock)?\.json|frontend/package(-lock)?\.json)' || true)"
[ -z "$FORBID" ] || { printf '%s\n' "$FORBID" | sed 's/^/        /'; die "kandidat menyentuh area terlarang (Production/Delivery/Docker/dependency)"; }
[ -z "$(sg diff --name-status --diff-filter=D "$PROD_FULL" "$DEPLOY_SHA" | grep -v '^D[[:space:]]frontend/dist/' || true)" ] || die "ada berkas dihapus (selain frontend/dist artefak)"
NEWMIG="$(printf '%s\n' "$CHANGED" | grep '^backend/prisma/migrations/' || true)"
[ "$NEWMIG" = "backend/prisma/migrations/${NEW_MIGRATION}/migration.sql" ] || die "migration baru bukan hanya ${NEW_MIGRATION}"
MIGSQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${NEW_MIGRATION}/migration.sql" | tr -d '\r')"
printf '%s\n' "$MIGSQL" | grep -Ei '^\s*(update|delete|truncate|drop)\b|insert into' >/dev/null && die "migration memuat UPDATE/DELETE/DROP/INSERT (harus murni aditif)"
[ "$(printf '%s\n' "$MIGSQL" | grep -c 'ADD COLUMN')" = "2" ] || die "migration harus tepat 2 ADD COLUMN"
ok "migration ${NEW_MIGRATION} murni aditif (2 kolom nullable + UNIQUE + FK; tanpa UPDATE/DELETE/DROP/INSERT)"
SCHEMA_DEL="$(sg diff "$PROD_FULL" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | grep -E '^-' | grep -v '^---' || true)"
[ -z "$SCHEMA_DEL" ] || { printf '%s\n' "$SCHEMA_DEL" | sed 's/^/        /'; die "schema.prisma menghapus/mengubah baris lama (harus hanya penambahan)"; }
ok "schema.prisma hanya penambahan"

# ── 2. Audit produksi (baca-saja) ────────────────────────────────────────────────────────────────────────
PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$PROD_FULL" ] || die "release aktif (${PREV_COMMIT}) BUKAN hotfix ${PROD_FULL:0:8}; produksi bergeser"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"; CDIR="$PREV_DIR"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT} = hotfix); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
DIST_INDEX="$PREV_INDEX"; ok "health sehat; bundel publik = dist release aktif (${DIST_INDEX})"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
IDS_BEFORE="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" | sort | tr '\n' ' ')"

say "2a. Kode hotfix di container aktif = commit hotfix (byte-identik, 7 berkas src)"
HOTFIX_SRC="$(printf '%s\n' "$HOT" | grep '^backend/src/' || true)"
[ "$(printf '%s\n' "$HOTFIX_SRC" | grep -c .)" = "7" ] || die "berkas src hotfix bukan 7"
for f in $HOTFIX_SRC; do
  want="$(sg show "${PROD_FULL}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_OLD" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container aktif TIDAK memuat hotfix persis: ${f}"
done
ok "7 berkas src hotfix di container aktif identik dengan ${PROD_FULL:0:8}"

say "2b. Migration: pending harus TEPAT ${NEW_MIGRATION}"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung di produksi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort > "$BK_DIR/applied.txt"
sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's#backend/prisma/migrations/##' | grep -E '^[0-9]{14}_' | LC_ALL=C sort > "$BK_DIR/tree.txt"
PENDING="$(LC_ALL=C comm -13 "$BK_DIR/applied.txt" "$BK_DIR/tree.txt")"; AHEAD="$(LC_ALL=C comm -23 "$BK_DIR/applied.txt" "$BK_DIR/tree.txt")"
[ -z "$AHEAD" ] || die "DB memuat migration yang tidak ada di kode rilis: $(printf '%s' "$AHEAD" | tr '\n' ' ')"
[ "$PENDING" = "$NEW_MIGRATION" ] || die "pending bukan tepat ${NEW_MIGRATION}: $(printf '%s' "$PENDING" | tr '\n' ' ')"
grep -Fx "20261003080000_production_qc_finished_goods_v2" "$BK_DIR/applied.txt" >/dev/null || die "migration P6 belum applied di produksi"
ok "applied $(wc -l < "$BK_DIR/applied.txt"); pending TEPAT ${NEW_MIGRATION}; P6 (20261003080000) sudah applied"

say "2c. Kondisi data SEBELUM (baca-saja) dan flag Production V2"
snapshot > "$BK_DIR/baseline-sebelum.txt" || die "snapshot sebelum gagal"
grep -Fx 'kolom_versi_ada|0' "$BK_DIR/baseline-sebelum.txt" >/dev/null || die "kolom versi sudah ada sebelum rilis (tidak diharapkan)"
grep -Fx 'flag_v2|production_v2_writer|t|GLOBAL' "$BK_DIR/baseline-sebelum.txt" >/dev/null || die "flag production_v2_writer bukan aktif seperti yang diaudit"
ok "kolom versi belum ada; flag Production V2 sesuai; baseline sebelum tersimpan ($(wc -l < "$BK_DIR/baseline-sebelum.txt") baris)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 6 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"

say "2d. Sumber node_modules frontend untuk build (release mana pun di ~/releases dengan package-lock IDENTIK)"
NM_SRC=""
LOCK_NEW="$BK_DIR/lock-baru.json"; sg show "${DEPLOY_SHA}:frontend/package-lock.json" > "$LOCK_NEW" || die "gagal membaca package-lock rilis"
for d in "$PREV_DIR" "$RELEASES"/*/; do
  d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package-lock.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package-lock.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package-lock identik (build tidak bisa dilakukan tanpa npm ci)"
ok "node_modules build dari ${NM_SRC}"
NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang untuk salinan node_modules + backup"
ok "ruang disk cukup untuk salinan node_modules"

if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; exit 0; fi

# ── 3. Backup + verifikasi restore ───────────────────────────────────────────────────────────────────────
PHASE="3-backup"; say "3. Backup produksi + checksum + verifikasi restore ke DB sementara"
BACKUP_FILE="$HOME/backups/pre-finb38-${DEPLOY_SHORT}-${TS}.sql.gz"
COUNTS_SQL="select table_name||'|'||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
psql_live -At -c "$COUNTS_SQL" > "$BK_DIR/.counts_before.txt"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
psql_live -At -c "$COUNTS_SQL" > "$BK_DIR/.counts_after.txt"
SHA256="$(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 ${SHA256}"
PHASE="3b-verifikasi-restore"
VERIFY_DB="km_release_verify_${TS}"; [[ "$VERIFY_DB" =~ ^km_release_verify_[0-9]{8}_[0-9]{6}$ ]] || die "nama DB verifikasi tidak aman"
dcp "$PREV_DIR" exec -T postgres createdb -U "$DB_USER" "$VERIFY_DB" </dev/null || die "gagal membuat DB sementara"
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -X -q -o /dev/null || die "restore ke DB sementara GAGAL"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -c "$COUNTS_SQL" </dev/null > "$BK_DIR/.counts_restored.txt" || die "gagal menghitung baris hasil restore"
diff -q <(cut -d'|' -f1 "$BK_DIR/.counts_before.txt") <(cut -d'|' -f1 "$BK_DIR/.counts_restored.txt") >/dev/null || die "daftar tabel hasil restore berbeda"
BAD="$(awk -F'|' 'NR==FNR{b[$1]=$2;next} FILENAME==ARGV[2]{a[$1]=$2;next} {t=$1; r=$2; d=r-b[t]; if(d<0)d=-d; lim=b[t]*0.02; if(lim<25)lim=25; if(d>lim && !(r>=b[t] && r<=a[t]) && !(r<=b[t] && r>=a[t])) print t": sebelum="b[t]" sesudah="a[t]" restore="r}' "$BK_DIR/.counts_before.txt" "$BK_DIR/.counts_after.txt" "$BK_DIR/.counts_restored.txt")"
[ -z "$BAD" ] || die "jumlah baris hasil restore tidak cocok: ${BAD}"
[ "$(psql_live -At -c 'select count(*) from _prisma_migrations')" = "$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -c 'select count(*) from _prisma_migrations' </dev/null)" ] || die "_prisma_migrations berbeda pada hasil restore"
ok "restore terverifikasi: $(wc -l < "$BK_DIR/.counts_restored.txt") tabel cocok"
dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" "$VERIFY_DB" </dev/null && VERIFY_DB="" && ok "DB sementara dihapus"
rm -f "$BK_DIR"/.counts_*.txt

# ── 4. Release dir + build frontend ──────────────────────────────────────────────────────────────────────
PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive SHA rilis; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cmp -s <(sg show "${PROD_FULL}:frontend/package-lock.json") <(sg show "${DEPLOY_SHA}:frontend/package-lock.json") || die "package-lock frontend berubah"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
if grep -rl $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat (source dari git archive); compose identik"

say "4b. Build frontend di release dir (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && node -v >/dev/null && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
[ -n "$(grep -l "Export Excel" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat tombol Export Excel"
[ -n "$(grep -l "Koreksi Tagihan" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat menu Koreksi Tagihan"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY (peta akan mati)"
[ "$NEW_INDEX" != "$DIST_INDEX" ] || die "bundel baru identik dengan lama (tidak diharapkan: frontend berubah)"
[ -n "$(grep -l "Perlu Verifikasi Finance" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat halaman Finance yang sudah ada"
ok "dist baru ${NEW_INDEX} (lama ${DIST_INDEX}); memuat Export Excel, Koreksi Tagihan, dan kunci peta"

# ── 5. Build image ───────────────────────────────────────────────────────────────────────────────────────
PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-finb38-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

# ── 6. Migration ─────────────────────────────────────────────────────────────────────────────────────────
PHASE="6-migrate"; say "6. prisma migrate deploy (image baru; hanya ${NEW_MIGRATION})"
snapshot > "$BK_DIR/baseline-pra-migrasi.txt" || die "snapshot pra-migrasi gagal"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null || true
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration setengah jalan; JANGAN switch"
[ "$(psql_live -At -c 'select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null')" = "$(( $(wc -l < "$BK_DIR/applied.txt") + 1 ))" ] || die "jumlah applied != baseline + 1"
psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${NEW_MIGRATION}'" | grep -Fx t >/dev/null || die "${NEW_MIGRATION} tidak tercatat selesai"
ok "migration diterapkan: ${NEW_MIGRATION} (applied $(wc -l < "$BK_DIR/applied.txt") -> $(( $(wc -l < "$BK_DIR/applied.txt") + 1 ))); tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi"
ok "backend lama tetap sehat setelah migrasi (aditif)"

# ── 7. Switch ────────────────────────────────────────────────────────────────────────────────────────────
PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
SWITCH_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
CDIR="$NEW_DIR"; ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

# ── 8. Healthcheck & restart ─────────────────────────────────────────────────────────────────────────────
PHASE="8-healthcheck"; say "8. Healthcheck internal/publik dan stabilitas restart"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal gagal"; ok "internal 200"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru (${NEW_INDEX})"; ok "bundel web publik = dist baru ${NEW_INDEX}"
IDS_AFTER="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" | sort | tr '\n' ' ')"
[ "$(comm -3 <(printf '%s\n' $IDS_BEFORE) <(printf '%s\n' $IDS_AFTER) | grep -c . || true)" = "2" ] || warn "container lain di project berubah (diharapkan hanya backend)"
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch (RestartCount != 0)"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"

# ── 9. Invariant hotfix & Production V2 ──────────────────────────────────────────────────────────────────
PHASE="9-invariant-v2"; say "9. Hotfix ${PROD_FULL:0:8} dan invariant Production V2 tetap ada"
for f in $HOTFIX_SRC; do
  want="$(sg show "${PROD_FULL}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat hotfix persis: ${f}"
done
ok "7 berkas src hotfix di container baru identik dengan ${PROD_FULL:0:8}"
dcp "$NEW_DIR" exec -T backend node --input-type=module -e 'const m = await import("/app/src/services/productionPhaseLifecycle.js"); const f = await import("/app/src/services/v2FeatureFlags.js"); if (!m || !f.V2_FLAGS) process.exit(1); console.log("modul lifecycle + V2_FLAGS termuat: " + Object.keys(m).length + " ekspor, " + Object.keys(f.V2_FLAGS).length + " flag")' </dev/null || die "modul hotfix/V2 gagal dimuat"

# ── 10. Smoke (BACA-SAJA) ────────────────────────────────────────────────────────────────────────────────
PHASE="10-smoke"; say "10. Smoke test izin endpoint Export & B3.8 (baca-saja; tidak ada tulis, tidak ada Idempotency-Key)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function api(method, path, token, body, extra = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const tipe = r.headers.get("content-type") || "";
  let json = null; let bytes = 0;
  if (tipe.includes("spreadsheetml")) bytes = (await r.arrayBuffer()).byteLength; else { try { json = await r.json(); } catch { /* bukan JSON */ } }
  return { status: r.status, json, tipe, bytes };
}
const tokenUntuk = async (user) => {
  const roles = (await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } })).map((r) => r.role);
  return jwt.sign({ id: user.id, name: user.name, role: user.role, roles: roles.length ? roles : [user.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });
};
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
const sales = await prisma.user.findFirst({ where: { role: "SALES", active: true } });
if (!adm || !sales) { rec("akun ADMIN & SALES aktif tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const nol = "00000000-0000-4000-8000-000000000000";
const cacah = async () => [await prisma.finSupplierBill.count(), await prisma.finRefund.count(), await prisma.finJournalEntry.count(), await prisma.payment.count()];
const sebelum = await cacah();

for (const modul of ["kasbon", "jurnal-umum"]) {
  const body = modul === "jurnal-umum" ? { periode: { from: "2026-09-01", to: "2026-09-30" } } : {};
  rec(`export ${modul}: tanpa token -> 401`, (await api("POST", `/api/finance/export/${modul}`, null, body)).status === 401);
  rec(`export ${modul}: SALES -> 403`, (await api("POST", `/api/finance/export/${modul}`, tS, body)).status === 403);
  const ok = await api("POST", `/api/finance/export/${modul}`, tA, body);
  rec(`export ${modul}: admin -> 200 berkas xlsx tidak kosong`, ok.status === 200 && ok.tipe.includes("spreadsheetml") && ok.bytes > 2000, `status ${ok.status}, ${ok.bytes} byte`);
}
rec("export modul tak dikenal -> 404", (await api("POST", "/api/finance/export/tidak-ada", tA, {})).status === 404);
rec("export periode rusak -> 400 (bukan 500)", (await api("POST", "/api/finance/export/kasbon", tA, { periode: { from: "2026-13-45" } })).status === 400);

for (const [jenis, id] of [["bills", nol], ["refunds", nol]]) {
  rec(`${jenis}/koreksi: tanpa token -> 401`, (await api("POST", `/api/finance/${jenis}/${id}/koreksi`, null, { reason: "x", amount: 1 })).status === 401);
  rec(`${jenis}/koreksi: SALES -> 403`, (await api("POST", `/api/finance/${jenis}/${id}/koreksi`, tS, { reason: "x", amount: 1 })).status === 403);
  const tanpaKunci = await api("POST", `/api/finance/${jenis}/${id}/koreksi`, tA, { reason: "x", amount: 1 });
  rec(`${jenis}/koreksi: admin tanpa Idempotency-Key -> 428 (tanpa PIN, tanpa tulis)`, tanpaKunci.status === 428, `status ${tanpaKunci.status}`);
  const pv = await api("POST", `/api/finance/${jenis}/${id}/koreksi`, tA, { reason: "x", amount: 1, preview: true });
  rec(`${jenis}/koreksi: pratinjau dokumen tak ada -> 404`, pv.status === 404, `status ${pv.status}`);
  rec(`${jenis}/info: SALES -> 403`, (await api("POST", `/api/finance/${jenis}/${id}/info`, tS, { reason: "x" })).status === 403);
  rec(`${jenis}/info: admin tanpa Idempotency-Key -> 428`, (await api("POST", `/api/finance/${jenis}/${id}/info`, tA, { reason: "x" })).status === 428);
}
const b = await api("GET", "/api/finance/bills", tA);
rec("GET /bills: 200 dan tiap tagihan memuat menu koreksi dari server", b.status === 200 && Array.isArray(b.json?.bills) && b.json.bills.every((x) => x.koreksi && typeof x.koreksi.aktif === "boolean"), `${b.json?.bills?.length ?? "?"} tagihan`);
const r = await api("GET", "/api/finance/refunds", tA);
rec("GET /refunds: 200 dan tiap refund memuat menu koreksi dari server", r.status === 200 && Array.isArray(r.json?.refunds) && r.json.refunds.every((x) => x.koreksi && typeof x.koreksi.aktif === "boolean"), `${r.json?.refunds?.length ?? "?"} refund`);
const k = await prisma.finKasbon.findFirst({ select: { id: true } });
if (k) rec("GET /riwayat-versi/kasbon/:id -> 200", (await api("GET", `/api/finance/riwayat-versi/kasbon/${k.id}`, tA)).status === 200);
rec("SALES tidak bisa membaca riwayat-versi -> 403", (await api("GET", `/api/finance/riwayat-versi/kasbon/${k?.id || nol}`, tS)).status === 403);

const sesudah = await cacah();
rec("tidak ada tagihan/refund/jurnal/payment baru selama smoke", sebelum.every((n, i) => n === sesudah[i]), `${sebelum.join(",")} -> ${sesudah.join(",")}`);
rec("kolom versi baru masih kosong (Prisma)", (await prisma.finSupplierBill.count({ where: { replacesBillId: { not: null } } })) === 0 && (await prisma.finRefund.count({ where: { replacesRefundId: { not: null } } })) === 0);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus"

# ── 11. Verifikasi data sesudah ──────────────────────────────────────────────────────────────────────────
PHASE="11-verifikasi-data"; say "11. Data SESUDAH vs SEBELUM (baca-saja)"
snapshot > "$BK_DIR/baseline-sesudah.txt" || die "snapshot sesudah gagal"
grep -Fx 'kolom_versi_ada|2' "$BK_DIR/baseline-sesudah.txt" >/dev/null || die "kolom versi belum ada setelah migrasi"; ok "2 kolom versi ada"
grep -Fx 'versi_tagihan_terisi|0' "$BK_DIR/baseline-sesudah.txt" >/dev/null || die "replaces_bill_id tidak kosong"; ok "fin_supplier_bills.replaces_bill_id semua NULL"
grep -Fx 'versi_refund_terisi|0' "$BK_DIR/baseline-sesudah.txt" >/dev/null || die "replaces_refund_id tidak kosong"; ok "fin_refunds.replaces_refund_id semua NULL"
DIFFS_MIG="$(diff <(grep -Ev "$SKIP_KOLOM" "$BK_DIR/baseline-pra-migrasi.txt") <(grep -Ev "$SKIP_KOLOM" "$BK_DIR/baseline-sesudah.txt") || true)"
DIFFS_AWAL="$(diff <(grep -Ev "$SKIP_KOLOM" "$BK_DIR/baseline-sebelum.txt") <(grep -Ev "$SKIP_KOLOM" "$BK_DIR/baseline-sesudah.txt") || true)"
if [ -z "$DIFFS_MIG" ]; then ok "hash jurnal/baris/saldo akun & rekening/payment/alokasi/tagihan/pembayaran supplier/refund/pengeluaran/pembelian/kasbon/persediaan awal/settings/order/unit/job/flag V2 IDENTIK (pra-migrasi vs sesudah rilis)"
else warn "ADA selisih pra-migrasi vs sesudah (kemungkinan aktivitas normal saat rilis berjalan). Tinjau manual:"; printf '%s\n' "$DIFFS_MIG" | sed 's/^/        /' | sed -n 1,30p; fi
[ -z "$DIFFS_AWAL" ] && ok "IDENTIK juga terhadap snapshot awal preflight" || warn "selisih terhadap snapshot awal (lihat ${BK_DIR}/baseline-*.txt)"
diff <(grep '^flag_v2|' "$BK_DIR/baseline-sebelum.txt") <(grep '^flag_v2|' "$BK_DIR/baseline-sesudah.txt") >/dev/null || die "flag Production/Delivery V2 BERUBAH oleh rilis (tidak boleh)"
ok "flag Production/Delivery V2 identik dengan sebelum rilis"

# ── 12. Log & migration ──────────────────────────────────────────────────────────────────────────────────
PHASE="12-log"; say "12. Log backend sejak switch (${SWITCH_AT}) dan migration"
LOGS="$(dcp "$NEW_DIR" logs --since "$SWITCH_AT" --no-color backend </dev/null 2>&1 | cut -c1-240 || true)"
FATAL="$(printf '%s\n' "$LOGS" | grep -Ei 'P2021|P2022|does not exist|PrismaClientInitializationError|Cannot find module|EADDRINUSE' || true)"
[ -z "$FATAL" ] || { printf '%s\n' "$FATAL" | sed -n 1,10p; die "log backend memuat error skema/inisialisasi"; }
ERRN="$(printf '%s\n' "$LOGS" | grep -Eic 'error|exception|unhandled' || true)"; ok "tanpa error skema/inisialisasi; baris 'error/exception': ${ERRN}"
[ "$ERRN" = "0" ] || printf '%s\n' "$LOGS" | grep -Ei 'error|exception|unhandled' | sed -n 1,8p | sed 's/^/        /'
dcp "$NEW_DIR" exec -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null && ok "prisma migrate status: database schema is up to date (tidak ada migrasi pending)" || die "migrate status tidak 'up to date'"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung setelah rilis"

PHASE="13-selesai"; say "13. Ringkasan"
dcp "$NEW_DIR" ps </dev/null
cat <<EOF

RILIS FINANCE B3.8 + B3.9 SELESAI (koreksi Tagihan/Refund tanpa PIN, Export Excel; tanpa backfill; tanpa transaksi produksi baru).
  release aktif : ${NEW_DIR}  (commit ${DEPLOY_SHA})
  release lama  : ${PREV_DIR}  (commit ${PREV_COMMIT}; tidak dihapus)
  image lama    : ${ROLLBACK_TAG}
  backup        : ${BACKUP_FILE}
  sha256        : ${SHA256}
  log/baseline  : ${BK_DIR}
EOF
trap - EXIT
exit 0
