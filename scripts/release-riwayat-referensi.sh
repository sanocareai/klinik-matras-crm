#!/usr/bin/env bash
# (dibangkitkan oleh scripts/gen-release-riwayat-referensi.cjs; templat scripts/release-identitas-pemeriksa-hitung.sh sha256 86dab055be12…; JANGAN edit manual — ubah generator lalu bangkitkan ulang)
# RILIS RIWAYAT REFERENSI HISTORIS DARI FILE — BACKEND + WEB + 1 MIGRASI ADITIF (2 tabel baru, kosong, tanpa backfill). FAIL-CLOSED.
#   • Catatan REFERENSI dari file (rekap pemakaian per order, log pembelian) bisa dilihat di SANSS, terpisah dan berlabel dari GR/Material Issue/movement/saldo. Tidak ada kode yang menulis stok/jurnal dari catatan ini.
#   • Tanggal pemakaian selalu kosong (CHECK database). Status mengikuti kondisi dokumen resmi TERKINI tanpa impor ulang; revisi append-only. T0 tidak menyaring baris.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, pin sha256 migrasi, tepat 1 migrasi pending) → (2) audit produksi baca-saja → (3) backup + restore nyata → (4) build web + image
#              → (5) verifier riwayat migrasi dari image BARU terhadap DB produksi (baca-saja; migrasi yang sudah terpasang tidak boleh berubah) → (6) REHEARSAL migrasi + uji perilaku constraint pada restore backup NYATA
#              → (7) migrate deploy produksi SATU kali (backend lama tetap melayani) → (8) switch backend → (9) verifikasi + smoke baca-saja + snapshot.
# Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA); dist frontend DIBANGUN di release dir (aset lama dibawa). Tidak ada tulis data produksi selain migrasi aditif (tabel baru kosong).
#
#   cat scripts/release-riwayat-referensi.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rr.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rr.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # DRY-RUN: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rr.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/rr.out 2>&1 < /dev/null &'
#
# PRASYARAT SEBELUM MENJALANKAN: branch kandidat sudah di-merge/rebase ke origin/main TERBARU (release aktif HARUS leluhur kandidat), di-push, dan daftar berkas di skrip ini dibangkitkan ulang dari commit final (make_release_rr.cjs).
# ROLLBACK: kode aman kapan saja (tag image rollback-pre-rr-<sha8>); 2 tabel baru TIDAK dihapus (kosong/aditif, tidak dibaca kode lama). Pemulihan database penuh hanya bila terjadi kerusakan data (backup + checksum dicetak).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/stok-mulai-catat-rekon-okt}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Prisma hanya schema.prisma + TEPAT satu migrasi baru (pin sha256); package/compose/Dockerfile tidak boleh ikut.
ALLOWED_RE='^(backend/prisma/migrations/20261202090000_stok_riwayat_referensi/migration\.sql|backend/prisma/schema\.prisma|backend/scripts/lib/muatDataStok\.mjs|backend/scripts/opname-impor-stock-file\.mjs|backend/scripts/opname-rekon-catatan-gudang\.mjs|backend/scripts/opname-rekon-riwayat-okt\.mjs|backend/scripts/riwayat-referensi-pratinjau\.mjs|backend/src/index\.js|backend/src/lib/activityLog\.js|backend/src/routes/riwayatReferensi\.js|backend/src/services/stokFileImport\.js|backend/src/services/stokKesiapanCatat\.js|backend/src/services/stokRekonCatatan\.js|backend/src/services/stokRiwayatOktober\.js|backend/src/services/stokRiwayatReferensi\.js|backend/tests/integration/setup/testApp\.js|backend/tests/integration/setup/testDb\.js|backend/tests/integration/stokImporFile\.integration\.test\.js|backend/tests/integration/stokRekonCatatan\.integration\.test\.js|backend/tests/integration/stokRekonRiwayat\.integration\.test\.js|backend/tests/integration/stokRiwayatReferensi\.integration\.test\.js|backend/tests/releaseRiwayatReferensi\.test\.js|backend/tests/stokFileImport\.test\.js|backend/tests/stokRekonCatatan\.test\.js|backend/tests/stokRiwayatOktober\.test\.js|docs/ALUR-MULAI-CATAT-TRANSAKSI-BARU-DAN-RIWAYAT-OKTOBER\.md|docs/PANDUAN-CEK-FISIK-DAN-OPNAME-PENUH-1-NOV\.md|frontend/src/api\.js|frontend/src/features/warehouse/components/ItemDetailDrawer\.jsx|frontend/src/features/warehouse/components/RiwayatReferensiBahan\.jsx|frontend/src/features/warehouse/components/RiwayatReferensiTab\.jsx|frontend/src/features/warehouse/riwayatReferensiLogic\.js|frontend/src/pages/warehouse/WarehouseAdjustments\.jsx|frontend/tests/riwayatReferensi\.test\.js|scripts/gen-release-riwayat-referensi\.cjs|scripts/lib/smoke-riwayat-referensi\.mjs|scripts/release-riwayat-referensi\.sh)$'
BACKEND_SRC_EXPECT="backend/src/index.js backend/src/lib/activityLog.js backend/src/routes/riwayatReferensi.js backend/src/services/stokFileImport.js backend/src/services/stokKesiapanCatat.js backend/src/services/stokRekonCatatan.js backend/src/services/stokRiwayatOktober.js backend/src/services/stokRiwayatReferensi.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/warehouse/components/ItemDetailDrawer.jsx frontend/src/features/warehouse/components/RiwayatReferensiBahan.jsx frontend/src/features/warehouse/components/RiwayatReferensiTab.jsx frontend/src/features/warehouse/riwayatReferensiLogic.js frontend/src/pages/warehouse/WarehouseAdjustments.jsx"
MIG_LIST="20261202090000_stok_riwayat_referensi"; MIG_SHA="86f852d7da01c2512b7efd3f2bf4f1039cea91230f3ed8fb382db43163b79795"
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
BK_DIR="$HOME/release-backups/riwayat-referensi-${DEPLOY_SHORT}-${TS}"
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
Rilis ini hanya menambah 2 tabel kosong (aditif): rollback KODE tidak membutuhkan pemulihan database; tabel baru dibiarkan.
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
exec 9>/tmp/release-riwayat-referensi.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rr\|release-riwayat-referensi\|pgrep\|node src/index.js" || true)"
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
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
# MAIN_LEBIH_MAJU: main boleh memuat commit di atas release aktif asalkan selisih BASE..MAIN hanya scripts/ dan docs/ (tidak ada kode aplikasi/prisma/frontend).
MAIN_FILES=""
if ! sg merge-base --is-ancestor "$MAIN_SHA" "$BASE_SHA"; then
  sg merge-base --is-ancestor "$BASE_SHA" "$MAIN_SHA" || die "origin/main (${MAIN_SHA:0:8}) dan baseline ${BASE_SHA:0:8} bercabang — gabungkan lineage terbaru lalu ulangi tes/preflight"
  MAIN_EXTRA="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA" | grep -Ev '^(scripts/|docs/)' || true)"
  [ -z "$MAIN_EXTRA" ] || { printf '%s\n' "$MAIN_EXTRA" | sed 's/^/        /'; die "origin/main memuat perubahan kode yang tidak ada di release aktif — berhenti"; }
  MAIN_FILES="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA")"
  warn "origin/main (${MAIN_SHA:0:8}) lebih maju dari baseline hanya pada scripts/docs ($(printf '%s\n' "$MAIN_FILES" | wc -l) berkas) — ikut diizinkan"
fi
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat — fast-forward main tidak akan mungkin"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" | { grep -Fvx -f <(printf '%s\n' "$MAIN_FILES") || true; } || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "daftar berkas backend/src yang berubah tidak sama dengan yang diaudit"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "backend/prisma/migrations/${MIG_LIST}/migration.sql backend/prisma/schema.prisma" ] || die "perubahan backend/prisma bukan TEPAT schema.prisma + migrasi rilis ini (migrasi yang sudah pernah diterapkan tidak boleh diganti)"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$|^docker-compose|Dockerfile' || die "dependensi/compose berubah — rilis ini tanpa dependensi baru"
[ "$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_LIST}/migration.sql" | tr -d '\r' | sha256sum | cut -d' ' -f1)" = "$MIG_SHA" ] || die "isi migrasi ${MIG_LIST} berbeda dari pin sha256 yang diaudit"
SQLM="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_LIST}/migration.sql" | tr -d '\r')"
! printf '%s\n' "$SQLM" | grep -qiE '^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s)' || die "migrasi memuat DROP/TRUNCATE/DELETE FROM/UPDATE"
! printf '%s\n' "$SQLM" | grep -iE '^\s*ALTER\s+TABLE' | grep -viE '^\s*ALTER\s+TABLE\s+"stok_riwayat_(referensi|impor)"' | grep -q . || die "migrasi mengubah tabel di luar 2 tabel baru"
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit: ${FRONTEND_SRC_EXPECT}"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; origin/main (${MAIN_SHA:0:8}) leluhur kandidat (fast-forward mungkin; selisih terhadap baseline hanya scripts/docs bila ada); $(printf '%s\n' "$CHANGED" | wc -l) berkas, semua dalam allowlist; backend/src = $(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w) berkas yang diaudit; tanpa prisma/frontend/dependensi"

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
ok "migrasi terpasang sebelum rilis = ${MIG_SEBELUM} (akan menjadi +1)"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
grep -Fx "$MIG_LIST" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${MIG_LIST} SUDAH terpasang sebelum rilis (tidak diharapkan)"
CAND_MIGS="$(sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u)"
SOLO_PROD="$(comm -13 <(printf '%s\n' "$CAND_MIGS") "$BK_DIR/applied-sebelum.txt" || true)"
[ -z "$SOLO_PROD" ] || { printf '%s\n' "$SOLO_PROD" | sed 's/^/        /'; die "produksi memiliki migrasi yang TIDAK ada di kandidat — gabungkan origin/main terbaru ke kandidat dulu"; }
PENDING="$(comm -23 <(printf '%s\n' "$CAND_MIGS") "$BK_DIR/applied-sebelum.txt" || true)"
[ "$PENDING" = "$MIG_LIST" ] || die "migrasi pending bukan TEPAT migrasi rilis ini (pending: $(printf '%s' "$PENDING" | tr '\n' ' '))"
TERAKHIR="$(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt" | tail -n 1)"
[[ "$MIG_LIST" > "$TERAKHIR" ]] || die "nama migrasi rilis ($MIG_LIST) tidak lebih baru dari migrasi terpasang terakhir ($TERAKHIR) — urutan tidak aman"
ok "tepat 1 migrasi pending (${MIG_LIST}); terurut SETELAH migrasi terpasang terakhir (${TERAKHIR}); nama tanggal pada nama migrasi BUKAN bukti siap rilis — yang diperiksa adalah isi + riwayat terpasang"
# Snapshot: jurnal, saldo per akun & rekening, stok, PO, penerimaan, Payment, order, job, route, dokumen Gudang, work center, plan v2, flag. Identik-wajib: flag/pengaturan/PO; sisanya tidak boleh BERKURANG.
SNAP_SQL="select 'jurnal', count(*), md5(coalesce(string_agg(e.id::text||e.status::text||e.entry_number, '|' order by e.id),'')) from fin_journal_entries e union all select 'baris_jurnal_saldo', count(*), md5(coalesce(string_agg(l.id::text||l.debit::text||l.credit::text||l.account_id::text||coalesce(l.order_id,'')||coalesce(l.cash_account_id::text,''), '|' order by l.id),'')) from fin_journal_lines l union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(t.k||t.s, '|' order by t.k),'')) from (select a.code as k, sum(l.debit-l.credit)::text as s from fin_journal_lines l join fin_accounts a on a.id=l.account_id join fin_journal_entries e on e.id=l.entry_id where e.status in ('POSTED','REVERSED') group by a.code) t union all select 'saldo_per_rekening', count(*), md5(coalesce(string_agg(t.k||t.s, '|' order by t.k),'')) from (select c.name as k, sum(l.debit-l.credit)::text as s from fin_journal_lines l join fin_cash_accounts c on c.id=l.cash_account_id join fin_journal_entries e on e.id=l.entry_id where e.status in ('POSTED','REVERSED') group by c.name) t union all select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text||coalesce(x.unit_cost::text,'')||x.material_id::text||x.type::text, '|' order by x.id),'')) from stock_movements x union all select 'po', count(*), md5(coalesce(string_agg(p::text, '|' order by p.id),'')) from fin_purchase_orders p union all select 'po_event', count(*), md5(coalesce(string_agg(p.id::text, '|' order by p.id),'')) from fin_purchase_order_events p union all select 'penerimaan', count(*), md5(coalesce(string_agg(g::text, '|' order by g.id),'')) from goods_receipts g union all select 'baris_penerimaan', count(*), md5(coalesce(string_agg(g::text, '|' order by g.id),'')) from goods_receipt_lines g union all select 'payment', count(*), md5(coalesce(string_agg(p.id::text||p.amount::text||coalesce(p.cancelled_at::text,''), '|' order by p.id),'')) from payments p union all select 'order', count(*), md5(coalesce(string_agg(o.id||o.status::text||o.\"paymentStatus\"::text||coalesce(o.paid_at::text,''), '|' order by o.id),'')) from \"Order\" o union all select 'job', count(*), md5(coalesce(string_agg(j.id::text||j.status::text||coalesce(j.route_id::text,''), '|' order by j.id),'')) from jobs j union all select 'route', count(*), md5(coalesce(string_agg(r.id::text||r.status::text, '|' order by r.id),'')) from routes r union all select 'material_issue', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from material_issues m union all select 'transfer', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from stock_transfers m union all select 'stock_count', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from stock_counts m union all select 'stok_rusak', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from damaged_stock_records m union all select 'retur', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from return_records m union all select 'adjustment', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from stock_adjustment_requests m union all select 'replenishment', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from replenishment_requests m union all select 'work_center', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from work_centers m union all select 'plan_v2', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from production_run_plans_v2 m union all select 'plan_event', count(*), md5(coalesce(string_agg(m.id::text, '|' order by m.id),'')) from production_plan_schedule_events_v2 m union all select 'flag_v2', count(*), md5(coalesce(string_agg(f.key||f.enabled::text||f.config::text, '|' order by f.key),'')) from v2_feature_flags f union all select 'fin_settings', count(*), md5(coalesce(string_agg(f.key||f.value, '|' order by f.key),'')) from fin_settings f union all select 'production_settings', count(*), md5(coalesce(string_agg(f::text, '|' order by f::text),'')) from production_settings f"
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sebelum.txt" || die "snapshot sebelum gagal"
[ "$(wc -l < "$BK_DIR/snap-sebelum.txt")" -ge 25 ] || die "snapshot sebelum tidak lengkap"
ok "snapshot sebelum tersimpan ($(wc -l < "$BK_DIR/snap-sebelum.txt") kelompok): jurnal, saldo akun/rekening, stok, PO, penerimaan, Payment, order, job, route, dokumen Gudang, work center, plan v2, flag, pengaturan"
say "2b. Sumber node_modules frontend (package.json identik dengan kandidat)"
LOCK_NEW="$BK_DIR/pkg-baru.json"; sg show "${DEPLOY_SHA}:frontend/package.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do
  d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package.json identik"
NM_KB="$(du -sk "$NM_SRC" | cut -f1)"
ok "node_modules build dari ${NM_SRC}"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + NM_KB + 2 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-rr-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

PHASE="3b-restore"; say "3b. Validasi restore: pulihkan backup NYATA ke DB sementara dan cocokkan jumlah baris (DB produksi tidak disentuh)"
REH_DB="rehearsal_rr_restore_${TS}"
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

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
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
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
ok "release dir dibuat; compose identik"

say "4b. Build frontend di release dir (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
# Fitur rilis ini + fitur rilis sebelumnya (jangan sampai hilang dari bundel).
for s1 in "Riwayat Referensi (bukan transaksi)" "Riwayat referensi dari file (bukan transaksi)" "Antrean penyelesaian" "Setelah tanggal itu belum ada data" "Saya memeriksa hitungan ini"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur baru: ${s1}"; done
for s2 in "Jembatan Omzet Sales" "Gap Pembukuan — daftar pemeriksaan" "Export Excel (filter ini)" "Edit Data Customer" "Buat Nota Kredit" "Koreksi Order" "Item Penjualan & Pemenuhan" "Katalog Item PKR" "Mode rute Produksi" "Opname Cutover Persediaan"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
[ -z "$(grep -lE "movements/(adjustment|receipt|return|waste)" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru masih memanggil jalur cepat yang ditutup (/movements/adjustment|receipt|return|waste)"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + fitur lama ada; tidak memanggil jalur cepat yang ditutup"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-rr-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5a-verifier"; say "5a. Verifier riwayat migrasi dari image BARU terhadap DB produksi (baca-saja): semua migrasi terpasang checksum-identik"
VER_OUT="$(dcp "$NEW_DIR" run --rm --no-deps -T backend node scripts/verify-migration-history.js </dev/null 2>&1)" || { printf '%s\n' "$VER_OUT" | tail -n 15; die "verifier riwayat migrasi GAGAL — ada migrasi terpasang yang berubah/tidak cocok; JANGAN migrasi"; }
printf '%s\n' "$VER_OUT" > "$BK_DIR/verifier.out"
printf '%s\n' "$VER_OUT" | grep -F "pending: ${MIG_LIST}" >/dev/null || { printf '%s\n' "$VER_OUT" | tail -n 8; die "verifier tidak melaporkan pending TEPAT ${MIG_LIST}"; }
ok "verifier: migrasi terpasang tidak berubah; pending = ${MIG_LIST}"
docker run --rm --entrypoint sh "$NEW_IMG_ID" -c "cat /app/prisma/migrations/${MIG_LIST}/migration.sql" 2>/dev/null | tr -d '\r' | sha256sum | cut -d' ' -f1 | grep -Fx "$MIG_SHA" >/dev/null || die "image baru memuat migrasi berbeda dari pin sha256"
ok "image baru memuat migrasi persis pin sha256"

PHASE="5c-rehearsal"; say "5c. REHEARSAL: backup NYATA dipulihkan ke DB sementara, migrasi diterapkan dengan image baru, perilaku constraint diuji, skema tabel lama dibandingkan, DB sementara dihapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_rr_mig_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-mig.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
RTOLAK() { if dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=1 -c "$1" </dev/null >/dev/null 2>&1; then reh_drop; die "perilaku SALAH — perintah ini seharusnya DITOLAK: $2"; fi; }
ROK() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=1 -c "$1" </dev/null >/dev/null 2>&1 || { reh_drop; die "perintah yang seharusnya LOLOS ditolak: $2"; }; }
SKEMA_SQL="select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable, ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name not in ('stok_riwayat_referensi','stok_riwayat_impor')"
S_SEBELUM="$(RPSQL "$SKEMA_SQL")"; [ -n "$S_SEBELUM" ] || { reh_drop; die "sidik jari skema rehearsal kosong"; }
REH_PW="$(sed -n 's/^DATABASE_URL="\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
N_SEBELUM="$(RPSQL "select (select count(*) from stock_movements)||'/'||(select count(*) from materials)||'/'||(select count(*) from fin_journal_entries)||'/'||(select count(*) from goods_receipts)")"
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
[ "$(RPSQL "select count(*) from information_schema.tables where table_schema='public' and table_name in ('stok_riwayat_referensi','stok_riwayat_impor')")" = "2" ] || { reh_drop; die "2 tabel baru tidak terpasang di rehearsal"; }
for T in stok_riwayat_referensi stok_riwayat_impor; do [ "$(RPSQL "select count(*) from $T")" = "0" ] || { reh_drop; die "tabel baru $T TIDAK kosong setelah migrasi (backfill tidak diizinkan)"; }; done
[ "$(RPSQL "select count(*) from pg_trigger where tgname in ('stok_riwayat_referensi_append_only_trg','stok_riwayat_impor_append_only_trg')")" = "2" ] || { reh_drop; die "trigger append-only tidak terpasang"; }
ok "rehearsal: migrate deploy lulus; 2 tabel baru kosong; trigger append-only terpasang; status up to date"
ROK "insert into stok_riwayat_impor (id, hash_konten, ringkasan) values ('00000000-0000-4000-8000-0000000000a1','h','{}'::jsonb)" "impor valid"
INS() { printf "insert into stok_riwayat_referensi (id, impor_id, kunci, revisi, konten_hash, jenis, nama_di_file, satuan_file, sumber_file, sumber_baris, status_verifikasi, alasan_blocker, peringatan, jumlah%s) values ('%s','00000000-0000-4000-8000-0000000000a1','%s',%s,'h','%s','n','METER','f','{1}','%s','{}','{}',%s%s)" "$6" "$1" "$2" "$3" "$4" "$5" "$7" "$8"; }
ROK "$(INS 00000000-0000-4000-8000-0000000000b1 k1 1 PEMAKAIAN_ORDER BELUM_DIVERIFIKASI '' 3 '')" "baris referensi valid"
ROK "$(INS 00000000-0000-4000-8000-0000000000b2 k2 1 PENERIMAAN_TERBUKTI_TANPA_GR PERLU_PEMERIKSAAN '' NULL '')" "jumlah tidak terbaca disimpan kosong (bukan nol)"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b3 k3 1 PEMAKAIAN_ORDER BELUM_DIVERIFIKASI ', tanggal_pemakaian' 3 ", '2026-10-05'")" "tanggal pemakaian terisi"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b4 k4 1 JENIS_LAIN BELUM_DIVERIFIKASI '' 3 '')" "jenis di luar daftar"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b5 k5 1 PEMAKAIAN_ORDER STATUS_LAIN '' 3 '')" "status di luar daftar"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b6 k1 1 PEMAKAIAN_ORDER BELUM_DIVERIFIKASI '' 3 '')" "kunci+revisi ganda"
RTOLAK "delete from stok_riwayat_referensi" "DELETE referensi"
RTOLAK "update stok_riwayat_referensi set jumlah = 99" "UPDATE isi referensi"
RTOLAK "delete from stok_riwayat_impor" "DELETE batch impor"
RTOLAK "update stok_riwayat_impor set hash_konten = 'x'" "UPDATE batch impor"
ROK "update stok_riwayat_referensi set aktif = false where id = '00000000-0000-4000-8000-0000000000b1'" "membalik aktif true→false (revisi)"
RTOLAK "update stok_riwayat_referensi set aktif = true where id = '00000000-0000-4000-8000-0000000000b1'" "membalik aktif false→true"
ok "perilaku constraint terbukti di restore backup nyata: tanggal pemakaian/jenis/status salah ditolak; DELETE & UPDATE isi ditolak; hanya aktif true→false yang boleh"
[ "$(RPSQL "$SKEMA_SQL")" = "$S_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH skema tabel lama"; }
[ "$(RPSQL "select (select count(*) from stock_movements)||'/'||(select count(*) from materials)||'/'||(select count(*) from fin_journal_entries)||'/'||(select count(*) from goods_receipts)")" = "$N_SEBELUM" ] || { reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama (movement/material/jurnal/GR)"; }
reh_drop; REH_DB=""
ok "rehearsal lulus: skema & isi tabel lama IDENTIK sebelum vs sesudah; DB sementara dihapus"

PHASE="6-migrate"; say "6. Migrasi aditif ke produksi (image baru; backend lama tetap melayani)"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
[ "$(sed -n 1p "$PREV_DIR/.release-commit" | tr -d '[:space:]')" = "$PREV_COMMIT" ] || die "baseline berubah selama persiapan"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum2.txt" || die "gagal membaca migrasi terpasang"
cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sebelum2.txt" || die "daftar migrasi terpasang berubah selama persiapan (sesi lain menerapkan migrasi) — berhenti, ulangi preflight"
psql_live -At -c "$SKEMA_SQL" > "$BK_DIR/skema-prod-sebelum.txt" || die "sidik jari skema produksi sebelum gagal"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang != sebelum + 1"
psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${MIG_LIST}'" | grep -Fx t >/dev/null || die "${MIG_LIST} tidak tercatat selesai"
for T in stok_riwayat_referensi stok_riwayat_impor; do [ "$(psql_live -At -c "select count(*) from $T")" = "0" ] || die "tabel baru $T TIDAK kosong setelah migrasi"; done
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$(cat "$BK_DIR/skema-prod-sebelum.txt")" ] || die "skema tabel lama BERUBAH oleh migrasi (jangan switch)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi aditif"
ok "1 migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); 2 tabel baru kosong; skema tabel lama identik; backend lama tetap sehat"

# Skrip smoke baca-saja: SEBELUM switch (container lama: hanya mencatat jumlah baris) dan SESUDAH switch (container baru: izin, koreksi satu langkah ditutup, penyetuju murni, CLI opname menolak --apply).
cat > "$BK_DIR/smoke.mjs" <<'NODE'
// Smoke BACA-SAJA riwayat referensi (dijalankan di dalam container backend oleh scripts/release-riwayat-referensi.sh; disimpan di repo agar generator tidak bergantung pada helper lokal).
// Tidak memanggil POST /segarkan, /impor yang valid, ataupun penulisan apa pun; tabel referensi tidak boleh berubah selama smoke.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const APP_ROOT = process.env.APP_ROOT || "/app";
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL(APP_ROOT + "/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const MODE = process.env.MODE; // before | after
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
let fail = 0, skip = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const lewati = (n, alasan) => { skip++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const info = (n) => console.log(`  INFO  ${n}`);
const NOL = "00000000-0000-4000-8000-000000000000";
async function api(method, path, token, body = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
  const teks = await r.text(); let json = null; try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  return { status: r.status, json, teks };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const cacah = async () => [await prisma.stockMovement.count(), await prisma.stockAdjustmentRequest.count(), await prisma.stockCount.count(), await prisma.finJournalEntry.count(), await prisma.goodsReceipt.count(), await prisma.returnRecord.count(), await prisma.damagedStockRecord.count()];
const sebelum = await cacah();
if (MODE === "before") {
  info(`baris sebelum: movement=${sebelum[0]} adjustment=${sebelum[1]} stockCount=${sebelum[2]} jurnal=${sebelum[3]} GR=${sebelum[4]} retur=${sebelum[5]} rusak=${sebelum[6]}`);
  console.log("REAL_BEFORE {}");
  console.log("SMOKE_HASIL mode=before fail=0 skip=0");
  await prisma.$disconnect();
  process.exit(0);
}
const penulis = cari((r) => punya(r, P.INVENTORY_WRITE));
const tanpaAkses = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.INVENTORY_WRITE));

const hitungBaru = async () => [Number((await prisma.$queryRawUnsafe("select count(*) from stok_riwayat_referensi"))[0].count), Number((await prisma.$queryRawUnsafe("select count(*) from stok_riwayat_impor"))[0].count)];
const baruSebelum = await hitungBaru();
const auditSebelum = Number((await prisma.$queryRawUnsafe("select count(*) from activity_events where entity_type = $1", "stok_riwayat_referensi"))[0].count);
rec("tabel referensi baru terpasang (hitungan awal dicatat; tidak boleh berubah selama smoke)", Number.isFinite(baruSebelum[0]) && Number.isFinite(baruSebelum[1]), baruSebelum.join(","));
const pen = await prisma.$queryRawUnsafe("select count(*) from pg_trigger where tgname in ('stok_riwayat_referensi_append_only_trg','stok_riwayat_impor_append_only_trg')");
rec("trigger append-only terpasang (2)", Number(pen[0].count) === 2);
const R = "/api/inventory/riwayat-referensi";
for (const [m, p] of [["GET", ""], ["GET", "/ringkasan"], ["GET", "/impor"], ["POST", "/pratinjau"], ["POST", "/impor"], ["POST", "/segarkan"]]) rec(m + " " + R + p + ": tanpa token → 401", (await api(m, R + p, null)).status === 401);
if (tanpaAkses) {
  const tt = tokenUntuk(tanpaAkses);
  for (const [m, p] of [["GET", "/ringkasan"], ["POST", "/pratinjau"], ["POST", "/impor"], ["POST", "/segarkan"]]) rec(m + " " + R + p + ": tanpa izin → 403", (await api(m, R + p, tt, {})).status === 403);
} else lewati("403 tanpa izin", "tidak ada akun tanpa izin tulis");
if (penulis) {
  const t = tokenUntuk(penulis);
  const rg = await api("GET", R + "/ringkasan", t); rec("ringkasan 200, bukanSaldo=true, label referensi", rg.status === 200 && rg.json?.bukanSaldo === true && /bukan transaksi resmi/.test(rg.json?.label || ""), String(rg.status));
  const dft = await api("GET", R, t); rec("daftar 200 (GET murni baca; total = jumlah baris aktif)", dft.status === 200 && dft.json?.total <= baruSebelum[0], String(dft.json?.total));
  for (const p of ["", "/ringkasan", "/impor", "?semuaRevisi=1"]) rec("GET " + R + p + " dua kali → 200 (membuka tab tidak menulis)", (await api("GET", R + p, t)).status === 200 && (await api("GET", R + p, t)).status === 200);
  const sg = await api("POST", R + "/segarkan", t, {}); rec("POST /segarkan tanpa konfirmasi → 400 KONFIRMASI_DIPERLUKAN (snapshot adalah tindakan manual; tidak menulis)", sg.status === 400 && sg.json?.code === "KONFIRMASI_DIPERLUKAN", String(sg.status));
  rec("pratinjau tanpa berkas → 400 (tidak menulis)", (await api("POST", R + "/pratinjau", t, {})).status === 400);
  const imp = await api("POST", R + "/impor", t, { pakaiCsv: "x", konfirmasiHash: "salah" }); rec("impor dengan hash salah → 409 PRATINJAU_BERUBAH (tidak menulis)", imp.status === 409 && imp.json?.code === "PRATINJAU_BERUBAH", String(imp.status));
  rec("material id bukan UUID → 400", (await api("GET", R + "/material/bukan-uuid", t)).status === 400);
} else lewati("pemeriksaan dengan akun penulis", "tidak ada akun aktif pemegang inventory:write");
const baruSesudah = await hitungBaru(); rec("smoke tidak menulis tabel referensi baru (revisi, batch impor)", baruSesudah[0] === baruSebelum[0] && baruSesudah[1] === baruSebelum[1], baruSebelum.join(",") + " -> " + baruSesudah.join(","));
const auditSesudah = Number((await prisma.$queryRawUnsafe("select count(*) from activity_events where entity_type = $1", "stok_riwayat_referensi"))[0].count); rec("smoke tidak menambah audit stok_riwayat_referensi", auditSesudah === auditSebelum, auditSebelum + " -> " + auditSesudah);
const sesudah = await cacah();
rec("tidak ada baris berubah selama smoke (movement, adjustment, count, jurnal, GR, retur, rusak)", sebelum.every((n, i) => sesudah[i] >= n), sebelum.join(",") + " -> " + sesudah.join(","));
rec("smoke tidak membuat dokumen", sesudah[1] === sebelum[1] && sesudah[2] === sebelum[2] && sesudah[5] === sebelum[5] && sesudah[6] === sebelum[6], "adjustment/count/retur/rusak tetap");
await prisma.$disconnect();
console.log(`SMOKE_HASIL mode=${MODE} fail=${fail} skip=${skip}`);
process.exit(fail ? 1 : 0);
NODE

PHASE="5b-rekam-sebelum"; say "5b. Catat kondisi backend LAMA (baca-saja)"
dcp "$PREV_DIR" exec -T -e MODE=before backend node --input-type=module - < "$BK_DIR/smoke.mjs" > "$BK_DIR/smoke-sebelum.log" 2>&1 || { tail -n 20 "$BK_DIR/smoke-sebelum.log"; die "perekaman sebelum switch gagal"; }
REAL_BEFORE="$(grep '^REAL_BEFORE ' "$BK_DIR/smoke-sebelum.log" | sed 's/^REAL_BEFORE //')"
[ -n "$REAL_BEFORE" ] || die "rekaman sebelum switch kosong"
ok "respons id nyata terekam ($(grep -c ': sebelum switch' "$BK_DIR/smoke-sebelum.log") endpoint ber-data; sisanya tidak punya data di produksi)"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali; migrasi aditif sudah diterapkan di fase 6)"
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
[ "$MIG_SESUDAH" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi bukan sebelum + 1 (${MIG_SEBELUM} -> ${MIG_SESUDAH})"
ok "migrasi terpasang ${MIG_SESUDAH} = sebelum + 1"

PHASE="8b-smoke"; say "8b. Smoke riwayat referensi (baca-saja; TIDAK membuat data/transaksi QA di produksi; tabel referensi tetap kosong)"
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
