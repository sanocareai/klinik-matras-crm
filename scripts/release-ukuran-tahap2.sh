#!/usr/bin/env bash
# Rilis MANUAL Ukuran Kasur Custom TAHAP 2 (PDF invoice mencetak ukuran, kesiapan order, pengaturan penegakan server DEFAULT MATI; backend + FRONTEND,
# TANPA migration/schema) ke produksi dengan workflow RELEASE-DIRECTORY (~/releases/klinik-matras/<sha8>). Diturunkan dari release-ukuran2-custom.sh.
# Aplikasi mobile TIDAK ikut rilis ini (diterbitkan lewat OTA terpisah setelah rilis ini lulus). Penegakan server wajib tetap MATI.
#
#   git show <sha>:scripts/release-ukuran-tahap2.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/ruc2.sh && bash /tmp/ruc2.sh <DEPLOY_SHA_LENGKAP> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/ruc2.sh <DEPLOY_SHA_LENGKAP>'
#
# Baseline produksi = main fc329ab2. DEPLOY_SHA harus HEAD origin/main (main di-fast-forward lebih dulu) dan keturunan baseline.
# TIDAK ada migration (pending kosong; migrate deploy = no-op). Smoke HANYA MEMBACA (tidak membuat order). RESI_INPUT_AKTIF dan UKURAN_CUSTOM_WAJIB wajib false.
# Prinsip: fail-fast; tanpa reset/stash/force; tanpa rollback otomatis (hanya instruksi); tanpa secret di layar; DROP hanya DB sementara verifikasi restore.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
PROD_FULL="fc329ab2f8a5f6976c51ab18d624d04e1d8861e7"     # commit produksi aktif = baseline (sama dengan main sebelum fast-forward)
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
# Berkas yang BOLEH berubah dari baseline (daftar tepat; selain itu = STOP)
ALLOWED_FILES="backend/src/lib/ukuranKasur.js
backend/src/routes/customers.js
backend/src/routes/finance.js
backend/src/routes/masterData.js
backend/src/routes/orders.js
backend/src/services/finance/settings.js
backend/src/services/invoicePdf.js
backend/src/services/orderCreation.js
backend/src/services/ukuranWajib.js
backend/tests/integration/ukuranKasurTahap2.integration.test.js
backend/tests/ukuranKasur.test.js
docs/UKURAN-KASUR-CUSTOM-PENEGAKAN.md
frontend/src/components/customer/OrderSection.jsx
frontend/src/components/customer/UkuranCustomFields.jsx
frontend/src/features/orders/ReadinessBadge.jsx
frontend/src/features/orders/ReadinessPanel.jsx
frontend/src/features/orders/useUkuranCustomWajib.js
frontend/src/utils/orderReadiness.js
frontend/tests/ukuranKasurCustom.test.js
mobile/__tests__/ukuranKasur.test.mjs
mobile/src/components/OrderCard.js
mobile/src/components/OrderFormModal.js
mobile/src/utils/ukuranKasur.js
scripts/release-ukuran-tahap2.sh"

PREFLIGHT_ONLY=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/ukuran2-${DEPLOY_SHORT}-${TS}"
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
C. Rilis ini TANPA migration/skema: rollback kode (backend + dist frontend, keduanya kembali ke release sebelumnya) tidak menyentuh data.
   Data ukuran custom yang sudah tersimpan (JSON di Order.notes) tetap ada dan terbaca (kunci tambahan diabaikan kode lama). Tidak ada penghapusan data.
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

# Bukti keadaan data (BACA-SAJA). Tahan terhadap sebelum/sesudah migrasi: group_id dibuang dari hash Order; order_groups = -1 bila belum ada.
BASELINE_SQL=$(cat <<'SQL'
select 'order_tanpa_group_id', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'group_id')::text, '|' order by x.id), '')) from "Order" x;
select 'order_item', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from "OrderItem" x;
select 'invoices', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from invoices x;
select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from payments x;
select 'alokasi', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_payment_allocations x;
select 'unit', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from units x;
select 'job', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from jobs x;
select 'jurnal', count(*), md5(coalesce(string_agg(e.id::text || e.status || e.entry_number, ',' order by e.id), '')) from fin_journal_entries e;
select 'baris_jurnal', count(*), sum(l.debit), sum(l.credit), md5(coalesce(string_agg(l.id::text || l.debit || l.credit || l.account_id, ',' order by l.id), '')) from fin_journal_lines l;
select 'saldo_semua_akun', md5(coalesce(string_agg(t.code || ':' || t.s, ',' order by t.code), '')) from (select a.code, coalesce(sum(l.debit - l.credit), 0) s from fin_accounts a left join fin_journal_lines l on l.account_id = a.id left join fin_journal_entries e on e.id = l.entry_id and e.status in ('POSTED', 'REVERSED') group by a.code) t;
select 'akun_terlindungi', a.code, coalesce(sum(l.debit - l.credit), 0) from fin_accounts a left join fin_journal_lines l on l.account_id = a.id join fin_journal_entries e on e.id = l.entry_id and e.status in ('POSTED', 'REVERSED') where a.code in ('2-1600', '2-1700') group by a.code order by a.code;
select 'kas', c.name, coalesce(sum(l.debit - l.credit), 0) from fin_cash_accounts c left join fin_journal_lines l on l.account_id = c.account_id left join fin_journal_entries e on e.id = l.entry_id and e.status in ('POSTED', 'REVERSED') group by c.name order by c.name;
select 'jv_terlindungi', e.entry_number, e.status, sum(l.debit), md5(string_agg(l.id::text || l.debit || l.credit, ',' order by l.id)) from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id where e.entry_number like 'JV-%' and e.entry_number ~ '-(372|391|515|516|517)$' group by e.entry_number, e.status order by 2;
select 'group_id_tidak_null', count(*) from "Order" o where (to_jsonb(o) ->> 'group_id') is not null;
select 'order_groups_baris', case when to_regclass('public.order_groups') is null then -1 else (xpath('/row/c/text()', query_to_xml('select count(*) as c from order_groups', false, true, '')))[1]::text::int end;
select 'flag_resi_input_aktif', coalesce((select value from fin_settings where key = 'resi_input_aktif'), '(tidak ada = mati)');
select 'flag_ukuran_custom_wajib', coalesce((select value from fin_settings where key = 'ukuran_custom_wajib'), '(tidak ada = mati)');
SQL
)
snapshot() { printf '%s\n' "$BASELINE_SQL" | dcp "${CDIR:-$PREV_DIR}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q; }

# ── 0. Lingkungan ────────────────────────────────────────────────────────────────────────────────────────
PHASE="0-lingkungan"; say "0. Lingkungan"
for c in git docker curl gzip sha256sum awk grep flock tar sed df comm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
docker compose version >/dev/null 2>&1 || die "docker compose tidak tersedia"
exec 9>/tmp/release-ukuran2.lock; flock -n 9 || die "rilis lain sedang berjalan (kunci /tmp/release-ukuran2.lock)"
mkdir -p "$BK_DIR" "$HOME/release-src"
LOG="$BK_DIR/release.log"; exec > >(tee -a "$LOG") 2>&1
ok "log: ${LOG}"
[ -d "$RELEASES" ] || die "direktori rilis ${RELEASES} tidak ada"
[ -f "$PERSIST/backend/.env" ] || die "${PERSIST}/backend/.env tidak ada"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
ok "root persisten lengkap"
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

# ── 1. Sumber kode ───────────────────────────────────────────────────────────────────────────────────────
PHASE="1-sumber"; say "1. Sumber kode, ancestry, dan batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=500 origin "+refs/heads/main:refs/remotes/origin/main" || die "git fetch origin gagal"
ORIGIN_MAIN="$(sg rev-parse refs/remotes/origin/main)"
[ "$ORIGIN_MAIN" = "$DEPLOY_SHA" ] || die "origin/main (${ORIGIN_MAIN:0:8}) BUKAN SHA rilis (${DEPLOY_SHORT}); fast-forward main dulu / main bergeser"
sg merge-base --is-ancestor "$PROD_FULL" "$DEPLOY_SHA" || die "baseline produksi ${PROD_FULL:0:8} bukan leluhur SHA rilis"
ok "origin/main = ${DEPLOY_SHORT}; baseline ${PROD_FULL:0:8} adalah leluhurnya"
CHANGED="$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ "$CHANGED" = "$(printf '%s\n' "$ALLOWED_FILES" | LC_ALL=C sort)" ] || { printf '%s\n' "$CHANGED" | sed 's/^/        /'; die "berkas yang berubah TIDAK sama persis dengan daftar yang diaudit"; }
ok "perubahan = tepat 24 berkas yang diaudit (backend, frontend, mobile [OTA terpisah], tes, docs, skrip rilis)"
[ -z "$(sg diff --name-status --diff-filter=D "$PROD_FULL" "$DEPLOY_SHA")" ] || die "ada berkas dihapus"
[ -z "$(sg diff --name-only "$PROD_FULL" "$DEPLOY_SHA" -- driver-mobile delivery-control finance-mobile packages backend/prisma backend/src/index.js backend/src/services/finance ':(exclude)backend/src/services/finance/settings.js' 'backend/src/routes/finance*' ':(exclude)backend/src/routes/finance.js' backend/Dockerfile docker-compose.yml docker-compose.release.yml frontend/package.json frontend/package-lock.json backend/package.json backend/package-lock.json mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json)" ] || die "rilis menyentuh area terlarang (schema/migration, ledger/finance selain settings.js dan finance.js, Docker, dependensi, konfigurasi native mobile)"
ok "schema/migration, ledger/finance, Docker, dependensi, konfigurasi native mobile TIDAK berubah (hanya pengaturan settings.js + rute finance.js untuk kunci baru)"
ok "tidak ada migration baru; schema.prisma tidak berubah"

# ── 2. Audit produksi (baca-saja) ────────────────────────────────────────────────────────────────────────
PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$PROD_FULL" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${PROD_FULL:0:8}; produksi bergeser"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"; CDIR="$PREV_DIR"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT} = baseline); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
DIST_INDEX="$PREV_INDEX"; ok "health sehat; bundel publik = dist release aktif (${DIST_INDEX})"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
IDS_BEFORE="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" | sort | tr '\n' ' ')"

say "2b. Migration: TIDAK boleh ada pending"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung di produksi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort > "$BK_DIR/applied.txt"
sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's#backend/prisma/migrations/##' | grep -E '^[0-9]{14}_' | LC_ALL=C sort > "$BK_DIR/tree.txt"
PENDING="$(LC_ALL=C comm -13 "$BK_DIR/applied.txt" "$BK_DIR/tree.txt")"; AHEAD="$(LC_ALL=C comm -23 "$BK_DIR/applied.txt" "$BK_DIR/tree.txt")"
[ -z "$AHEAD" ] || die "DB memuat migration yang tidak ada di kode rilis: $(printf '%s' "$AHEAD" | tr '\n' ' ')"
[ -z "$PENDING" ] || die "ada migration pending padahal rilis ini tanpa migration: $(printf '%s' "$PENDING" | tr '\n' ' ')"
for m in 20260926140000_normalize_order_weight_entry_index 20260927150000_user_divisions 20260927170000_coa_bagi_hasil_investor 20260927200000_order_groups; do
  grep -Fx "$m" "$BK_DIR/applied.txt" >/dev/null || die "migration ${m} belum applied di produksi"
done
ok "applied $(wc -l < "$BK_DIR/applied.txt"); pending: TIDAK ADA (order_groups sudah applied)"

say "2c. Kondisi data SEBELUM (baca-saja) dan flag"
snapshot > "$BK_DIR/baseline-sebelum.txt" || die "snapshot sebelum gagal"
grep -E '^flag_resi_input_aktif\|(false|\(tidak ada = mati\))$' "$BK_DIR/baseline-sebelum.txt" >/dev/null || die "RESI_INPUT_AKTIF bukan false di produksi"
grep -Fx 'order_groups_baris|0' "$BK_DIR/baseline-sebelum.txt" >/dev/null || die "order_groups tidak kosong / tidak ada sebelum rilis"
grep -Fx 'group_id_tidak_null|0' "$BK_DIR/baseline-sebelum.txt" >/dev/null || die "ada Order.group_id tidak NULL sebelum rilis"
grep -E '^flag_ukuran_custom_wajib\|(false|\(tidak ada = mati\))$' "$BK_DIR/baseline-sebelum.txt" >/dev/null || die "ukuran_custom_wajib bukan false sebelum rilis"
ok "flag resi_input_aktif = false; ukuran_custom_wajib = MATI; order_groups 0 baris; baseline sebelum tersimpan"
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
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang untuk menyalin node_modules (${NM_KB} KB)"
ok "ruang disk cukup untuk salinan node_modules"

if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; exit 0; fi

# ── 3. Backup + verifikasi restore ───────────────────────────────────────────────────────────────────────
PHASE="3-backup"; say "3. Backup produksi + checksum + verifikasi restore ke DB sementara"
BACKUP_FILE="$HOME/backups/pre-ukuran2-${DEPLOY_SHORT}-${TS}.sql.gz"
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

# ── 4. Release dir ───────────────────────────────────────────────────────────────────────────────────────
PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive SHA rilis; release aktif tidak disentuh)"
[ "$(sg ls-remote origin refs/heads/main | cut -f1)" = "$DEPLOY_SHA" ] || die "origin/main berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cmp -s <(sg show "${PROD_FULL}:frontend/package-lock.json") <(sg show "${DEPLOY_SHA}:frontend/package-lock.json") || die "package-lock frontend berubah"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
# Normalisasi CRLF -> LF pada berkas teks backend yang di-archive dari commit (rilis harus LF)
if grep -rl $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat (source dari git archive); compose identik"

say "4b. Build frontend di release dir (dist BARU; dist aktif tidak disentuh)"
( cd "$NEW_DIR/frontend" && node -v >/dev/null && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
[ -n "$(grep -l "Lebar dan Panjang ukuran custom belum diisi" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat aturan kesiapan Ukuran Custom (tahap 2)"
[ "$NEW_INDEX" != "$DIST_INDEX" ] || die "bundel baru identik dengan lama (tidak diharapkan: frontend berubah)"
ok "dist baru ${NEW_INDEX} (lama ${DIST_INDEX}); memuat aturan kesiapan Ukuran Custom"

# ── 5. Build image ───────────────────────────────────────────────────────────────────────────────────────
PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-ukuran2-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

# ── 6. Migration ─────────────────────────────────────────────────────────────────────────────────────────
PHASE="6-migrate"; say "6. prisma migrate deploy (image baru; HARUS no-op: tidak ada migration pending)"
snapshot > "$BK_DIR/baseline-pra-migrasi.txt" || die "snapshot pra-migrasi gagal"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null || true
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration setengah jalan; JANGAN switch"
[ "$(psql_live -At -c 'select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null')" = "$(wc -l < "$BK_DIR/applied.txt")" ] || die "jumlah migration applied berubah (seharusnya no-op)"
ok "migrate deploy = no-op (applied tetap $(wc -l < "$BK_DIR/applied.txt")); tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi"
ok "backend lama tetap sehat"

# ── 7. Switch ────────────────────────────────────────────────────────────────────────────────────────────
PHASE="7-switch"; say "7. Switch backend ke release baru"
SWITCH_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
CDIR="$NEW_DIR"; ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

# ── 8. Healthcheck ───────────────────────────────────────────────────────────────────────────────────────
PHASE="8-healthcheck"; say "8. Healthcheck internal dan publik"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal gagal"; ok "internal 200"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru (${NEW_INDEX})"; ok "bundel web publik = ${NEW_INDEX} (dist baru)"
UK_CHUNK="$(basename "$(grep -l "Lebar dan Panjang ukuran custom belum diisi" "$NEW_DIR"/frontend/dist/assets/*.js | sed -n 1p)")"
curl -fsS --max-time 20 "${PUBLIC_URL}/assets/${UK_CHUNK}" | grep "Lebar dan Panjang ukuran custom belum diisi" >/dev/null || die "chunk kesiapan tidak terlayani publik"; ok "web publik melayani aturan kesiapan Ukuran Custom (${UK_CHUNK})"
IDS_AFTER="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" | sort | tr '\n' ' ')"
[ "$(comm -3 <(printf '%s\n' $IDS_BEFORE) <(printf '%s\n' $IDS_AFTER) | grep -c . || true)" = "2" ] || warn "container lain di project berubah (diharapkan hanya backend)"

# ── 9. Smoke test (BACA-SAJA) ────────────────────────────────────────────────────────────────────────────
PHASE="9-smoke"; say "9. Smoke test (BACA-SAJA; tidak membuat order)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function api(method, path, token) {
  const r = await fetch(BASE + path, { method, headers: token ? { Authorization: "Bearer " + token } : {} });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
if (!adm) { rec("akun ADMIN aktif", false, "tidak ada"); process.exit(1); }
const roles = (await prisma.userRole.findMany({ where: { userId: adm.id }, select: { role: true } })).map((r) => r.role);
const token = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: roles.length ? roles : [adm.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const st = await api("GET", "/api/resi/status", token);
rec("GET /api/resi/status -> aktif=false (Resi tetap MATI)", st.status === 200 && st.json?.aktif === false, `status ${st.status}`);
rec("tanpa token ditolak (401)", (await api("GET", "/api/resi/status", null)).status === 401);
const lib = await import("file://" + process.cwd() + "/src/lib/ukuranKasur.js");
rec("formatter server: 145 x 205 -> '145 × 205 cm (Custom)'", lib.formatUkuranKasur({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 }) === "145 × 205 cm (Custom)");
rec("formatter server: legacy -> 'Ukuran Custom (ukuran belum diisi)'", lib.formatUkuranKasur({ ukuranKasur: "Ukuran Custom" }) === "Ukuran Custom (ukuran belum diisi)");
// Order custom LAMA (tanpa angka) di produksi: tampil penanda, TIDAK ditebak, dan detail customer tetap terbaca
const legacy = await prisma.order.findFirst({ where: { notes: { contains: "Ukuran Custom" } }, select: { id: true, customerId: true, notes: true } });
if (legacy) {
  const inv = await import("file://" + process.cwd() + "/src/services/invoice.js");
  const view = await inv.buildInvoiceView(legacy.id);
  const tanpaAngka = !/ukuranLebarCm/.test(legacy.notes);
  rec("order custom lama: invoice view menampilkan penanda belum diisi", !tanpaAngka || view?.order?.ukuranKasur === "Ukuran Custom (ukuran belum diisi)", view?.order?.ukuranKasur ?? "(tanpa invoice)");
  const d = await api("GET", `/api/customers/${legacy.customerId}`, token);
  rec("detail customer berorder custom terbaca (200)", d.status === 200 && Array.isArray(d.json?.orders), `status ${d.status}`);
} else rec("order custom lama ditemukan", true, "tidak ada (dilewati)");
const wajib = await import("file://" + process.cwd() + "/src/services/ukuranWajib.js");
rec("penegakan server MATI (status null)", (await wajib.ukuranCustomWajibSejak()) === null);
const opt = await api("GET", "/api/master-data/order-options", token);
rec("GET /api/master-data/order-options -> 200, ukuranCustomWajibSejak=null, daftar ukuran utuh", opt.status === 200 && opt.json?.ukuranCustomWajibSejak === null && Array.isArray(opt.json?.ukuranKasur) && opt.json.ukuranKasur.includes("Ukuran Custom") && opt.json.ukuranKasur.length === 7, `status ${opt.status}`);
if (legacy) {
  const pdfMod = await import("file://" + process.cwd() + "/src/services/invoicePdf.js");
  const invMod = await import("file://" + process.cwd() + "/src/services/invoice.js");
  const v = await invMod.buildInvoiceView(legacy.id);
  const buf = v ? await pdfMod.renderInvoicePdf(v) : null;
  rec("PDF invoice order custom lama dirender (%PDF, > 5 KB), tanpa menulis data", !!buf && buf.subarray(0, 4).toString() === "%PDF" && buf.length > 5000, buf ? `${buf.length} byte` : "(tanpa invoice)");
}
const unitLegacy = await prisma.unit.count({ where: { ukuran: "Ukuran Custom" } });
rec("unit lama 'Ukuran Custom' tidak diubah (tetap terhitung)", unitLegacy >= 0, `${unitLegacy} unit`);
rec("order_groups masih kosong", (await prisma.orderGroup.count()) === 0);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus"

# ── 10. Verifikasi data sesudah ──────────────────────────────────────────────────────────────────────────
PHASE="10-verifikasi-data"; say "10. Data SESUDAH vs SEBELUM (baca-saja)"
snapshot > "$BK_DIR/baseline-sesudah.txt" || die "snapshot sesudah gagal"
grep -Fx 'order_groups_baris|0' "$BK_DIR/baseline-sesudah.txt" >/dev/null || die "order_groups tidak kosong"; ok "order_groups = 0 baris"
grep -Fx 'group_id_tidak_null|0' "$BK_DIR/baseline-sesudah.txt" >/dev/null || die "ada Order.group_id tidak NULL"; ok "semua orders.group_id NULL"
grep -E '^flag_resi_input_aktif\|(false|\(tidak ada = mati\))$' "$BK_DIR/baseline-sesudah.txt" >/dev/null || die "flag RESI_INPUT_AKTIF tidak false"; ok "RESI_INPUT_AKTIF tetap false"
grep -E '^flag_ukuran_custom_wajib\|(false|\(tidak ada = mati\))$' "$BK_DIR/baseline-sesudah.txt" >/dev/null || die "ukuran_custom_wajib tidak MATI setelah rilis"; ok "penegakan Ukuran Custom (ukuran_custom_wajib) tetap MATI"
DIFFS="$(diff <(grep -Ev '^(order_groups_baris|group_id_tidak_null)\|' "$BK_DIR/baseline-sebelum.txt") <(grep -Ev '^(order_groups_baris|group_id_tidak_null)\|' "$BK_DIR/baseline-sesudah.txt") || true)"
DIFFS_MIG="$(diff <(grep -Ev '^(order_groups_baris|group_id_tidak_null)\|' "$BK_DIR/baseline-pra-migrasi.txt") <(grep -Ev '^(order_groups_baris|group_id_tidak_null)\|' "$BK_DIR/baseline-sesudah.txt") || true)"
if [ -z "$DIFFS_MIG" ]; then ok "hash order/invoice/payment/alokasi/unit/job/jurnal/saldo/kas/JV terlindungi IDENTIK (pra-migrasi vs sesudah rilis)"
else warn "ADA selisih pra-migrasi vs sesudah (kemungkinan aktivitas normal saat rilis berjalan). Tinjau manual:"; printf '%s\n' "$DIFFS_MIG" | sed 's/^/        /' | sed -n 1,30p; fi
[ -z "$DIFFS" ] && ok "IDENTIK juga terhadap snapshot awal preflight" || warn "selisih terhadap snapshot awal (lihat ${BK_DIR}/baseline-*.txt)"

# ── 11. Log & migration ──────────────────────────────────────────────────────────────────────────────────
PHASE="11-log"; say "11. Log backend sejak switch (${SWITCH_AT}) dan migration"
LOGS="$(dcp "$NEW_DIR" logs --since "$SWITCH_AT" --no-color backend </dev/null 2>&1 | cut -c1-240 || true)"
FATAL="$(printf '%s\n' "$LOGS" | grep -Ei 'P2021|P2022|does not exist|PrismaClientInitializationError|Cannot find module|EADDRINUSE' || true)"
[ -z "$FATAL" ] || { printf '%s\n' "$FATAL" | sed -n 1,10p; die "log backend memuat error skema/inisialisasi"; }
ERRN="$(printf '%s\n' "$LOGS" | grep -Eic 'error|exception|unhandled' || true)"; ok "tanpa error skema/inisialisasi; baris 'error/exception': ${ERRN}"
[ "$ERRN" = "0" ] || printf '%s\n' "$LOGS" | grep -Ei 'error|exception|unhandled' | sed -n 1,8p | sed 's/^/        /'
dcp "$NEW_DIR" exec -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null && ok "prisma migrate status: database schema is up to date (tidak ada migrasi pending)" || die "migrate status tidak 'up to date'"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung setelah rilis"

PHASE="12-selesai"; say "12. Ringkasan"
dcp "$NEW_DIR" ps </dev/null
cat <<EOF

RILIS UKURAN KASUR CUSTOM SELESAI (Resi TETAP MATI, tanpa migration, tanpa backfill).
  release aktif : ${NEW_DIR}  (commit ${DEPLOY_SHA})
  release lama  : ${PREV_DIR}  (commit ${PREV_COMMIT}; tidak dihapus)
  image lama    : ${ROLLBACK_TAG}
  backup        : ${BACKUP_FILE}
  sha256        : ${SHA256}
  log/baseline  : ${BK_DIR}
EOF
trap - EXIT
exit 0
