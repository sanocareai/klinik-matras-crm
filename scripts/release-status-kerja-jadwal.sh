#!/usr/bin/env bash
# RILIS "STATUS KERJA DIJADWALKAN DARI RENCANA ADMIN" — BACKEND SAJA, TANPA MIGRASI, TANPA FRONTEND. FAIL-CLOSED. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA = release live saat ini).
#   Cacat: unit yang dijadwalkan lewat Rencana Admin (tanggal + meja, TANPA Pelaksanaan Meja/Run) terbaca "Belum dijadwalkan" di Ringkasan unit/tindakan berikutnya/daftar/filter/kedua Excel, karena status kerja hanya membaca rencana Meja V2.
#   Perbaikan: SATU aturan — jadwal AKTIF dari salah satu sumber (rencana Meja ATAU Rencana Admin ACTIVE) = "Dijadwalkan". CLEARED tidak dihitung; ADOPTED dihitung lewat rencana Mejanya. Jadwal SAJA tidak pernah menjadi "Sudah dikerjakan" dan tidak mengaku ada pemakaian bahan.
#   TIDAK ADA migrasi, perubahan skema/dependensi, frontend, jadwal, target, atau data yang diubah. Produksi: smoke baca-saja; rilis ini tidak membuat jadwal/Run/transaksi apa pun.
# URUTAN AMAN: (1) gerbang sumber (ancestry live, allowlist, TANPA prisma/dependensi/frontend, berkas pelindung identik) → (2) audit produksi baca-saja (terpasang == kandidat, 0 pending, tag image = image aktif) + sidik jari beku
#              → (3) backup + checksum → (4) release dir (dist dipakai ulang) + image → (5b) kode BARU terhadap restore backup nyata (baca-saja; sidik jari seluruh tabel sebelum=sesudah) → (7) switch → (8) verifikasi + smoke baca-saja + sidik jari beku.
#
#   cat scripts/release-status-kerja-jadwal.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/skj.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/skj.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/skj.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/skj.out 2>&1 < /dev/null &'
#
# ROLLBACK KODE: aman kapan saja (tidak ada perubahan database untuk dipulihkan).
# (dibangkitkan oleh scripts/gen-release-status-kerja-jadwal.cjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang; templat sha256 f027577b6b24…)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/rencana-produksi-jadwal-mingguan}"
# Migrasi live terakhir (HARUS = migrasi terakhir di baseline, kandidat, dan produksi) dan jumlahnya: rilis ini tidak menambah/mengubah migrasi.
LIVE_MIG_TERAKHIR="20261225090000_production_unit_component_reuse"; LIVE_MIG_JUMLAH="265"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard). Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/src/lib/domain/productionWorkStatus\.js|backend/src/services/productionOrderList\.js|backend/tests/integration/statusKerjaDariJadwal\.integration\.test\.js|backend/tests/releaseStatusKerjaJadwal\.test\.js|scripts/gen-release-status-kerja-jadwal\.cjs|scripts/lib/rehearsal-kode-status-kerja-jadwal\.mjs|scripts/lib/smoke-status-kerja-jadwal\.mjs|scripts/release-status-kerja-jadwal\.sh|scripts/templates/release-status-kerja-jadwal\.sh\.tpl)$'
BACKEND_SRC_EXPECT="backend/src/lib/domain/productionWorkStatus.js backend/src/services/productionOrderList.js"
FRONTEND_SRC_EXPECT=""
# Perubahan live yang TIDAK boleh hilang/berubah: hotfix Stock Count; berkas pelindung identik dengan baseline (Koreksi Gudang inti, jurnal, otorisasi, Produksi override, Stock Count).
HOTFIX_STOCK_COUNT="b5268e1f7d8e1a15a251106dee0a136898ee5ce1"
GUARD_UNCHANGED="backend/src/services/warehouseCorrection.js backend/src/routes/gudangKoreksi.js backend/src/services/inventoryLedger.js backend/src/routes/materialIssue.js backend/src/routes/stockAdjustment.js backend/src/routes/goodsReceipt.js backend/src/routes/returnRecord.js backend/src/routes/stockTransfer.js backend/src/routes/stockCount.js backend/src/services/opnameCutover.js backend/src/services/opnameMatriks.js backend/src/services/pergerakanSesiHitung.js backend/src/services/finance/journal.js backend/src/middleware/authorize.js backend/src/middleware/auth.js backend/src/constants/permissions.js backend/src/services/productionStepCommandService.js backend/src/services/unitStageEngine.js backend/src/services/orderStatusSync.js backend/src/services/productionRencanaJadwalService.js backend/src/lib/domain/productionRencanaAdmin.js backend/src/services/productionOrderExport.js backend/src/services/productionWorkListService.js"
LIVE_ANCESTORS="fd38f6c2382af914d1ebdd531a5dc430cff758c9 20606872412290a0a80f563e605f7717bf57f3e0 10294dcbc45d7e13c737721ddaa34e38f5b2ee77 08d62e7d713b08fc9e0f1d898c37791352476b5b 799d3e93de192c604a14f1c11fe7436538689bb0 56b87721f84c1d16a2cd1655e40787e2b626cb0f e5a32cd246b2233e9d05d9b2cbff733e4497725d"
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
BK_DIR="$HOME/release-backups/status-kerja-jadwal-${DEPLOY_SHORT}-${TS}"
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
Rollback kode setelah switch (TANPA perubahan database; tidak ada yang dipulihkan) — HANYA bila guard lulus:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Rollback kode AMAN tanpa guard: rilis ini tidak mengubah database (tanpa migrasi, tanpa tulisan data); kode lama membaca data yang sama (hanya status kerja unit berjadwal Admin kembali terbaca 'Belum dijadwalkan').
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-status-kerja-jadwal.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "skj\.sh\|release-status-kerja-jadwal\|pgrep\|node src/index.js" | grep -v "$$" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
if [ "$PREFLIGHT_ONLY" = "0" ]; then [ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"; fi

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, TANPA migrasi/dependensi"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" "+refs/heads/main:refs/remotes/origin/main" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
MAIN_FILES=""
if ! sg merge-base --is-ancestor "$MAIN_SHA" "$BASE_SHA"; then
  sg merge-base --is-ancestor "$BASE_SHA" "$MAIN_SHA" || die "origin/main (${MAIN_SHA:0:8}) dan baseline ${BASE_SHA:0:8} bercabang — gabungkan lineage terbaru lalu ulangi tes/preflight"
  MAIN_EXTRA="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA" | grep -Ev '^(scripts/|docs/|backend/tests/release[A-Za-z0-9]+\.test\.js$)' || true)"
  [ -z "$MAIN_EXTRA" ] || { printf '%s\n' "$MAIN_EXTRA" | sed 's/^/        /'; die "origin/main memuat perubahan kode yang tidak ada di release aktif — berhenti"; }
  MAIN_FILES="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA")"
  warn "origin/main (${MAIN_SHA:0:8}) lebih maju dari baseline hanya pada scripts/docs — ikut diizinkan"
fi
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat ${DEPLOY_SHORT}: rilis akan menghilangkan isi main — gabungkan main ke kandidat dulu"
for A in $LIVE_ANCESTORS; do
  sg cat-file -e "${A}^{commit}" 2>/dev/null || die "commit live ${A:0:8} tidak ada di repo sumber"
  sg merge-base --is-ancestor "$A" "$DEPLOY_SHA" || die "commit live ${A:0:8} BUKAN leluhur kandidat — rilis akan menghilangkan perubahan live; gabungkan baseline terbaru dulu"
done
ok "semua commit live (Koreksi Gudang, Produksi override, Riwayat Referensi, bukti serah) adalah leluhur kandidat"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" | { grep -Fvx -f <(printf '%s\n' "$MAIN_FILES") || true; } || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -q '^backend/prisma/' || die "backend/prisma berubah — rilis ini TANPA migrasi dan tanpa perubahan skema"
! printf '%s\n' "$CHANGED" | grep -q 'production-evidence' || die "artefak foto uji ikut ter-commit"
! printf '%s\n' "$CHANGED" | grep -q 'receipt-proofs' || die "artefak unggahan uji ikut ter-commit"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)\.env' || die "berkas .env ikut ter-commit"
! printf '%s\n' "$CHANGED" | grep -q '^driver-mobile/' || die "driver-mobile berubah — rilis ini tidak membawa app Driver"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
# TANPA migrasi: pohon migrasi kandidat IDENTIK dengan baseline (tidak ada tambah/ubah/hapus), jumlah dan yang terakhir sesuai pin.
[ "$(sg rev-parse "${BASE_SHA}:backend/prisma")" = "$(sg rev-parse "${DEPLOY_SHA}:backend/prisma")" ] || die "pohon backend/prisma kandidat BERBEDA dari baseline — rilis ini harus tanpa migrasi"
CAND_MIGS="$(sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u)"
[ "$(printf '%s\n' "$CAND_MIGS" | grep -c .)" = "$LIVE_MIG_JUMLAH" ] || die "jumlah migrasi kandidat != ${LIVE_MIG_JUMLAH}"
[ "$(printf '%s\n' "$CAND_MIGS" | tail -n 1)" = "$LIVE_MIG_TERAKHIR" ] || die "migrasi terakhir kandidat bukan ${LIVE_MIG_TERAKHIR}"
ok "TANPA migrasi: backend/prisma kandidat identik dengan baseline (${LIVE_MIG_JUMLAH} migrasi, terakhir ${LIVE_MIG_TERAKHIR}); tanpa perubahan dependensi/skema/Docker"
sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA" || die "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} BUKAN leluhur kandidat"
sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$BASE_SHA" || die "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} belum ada di baseline live"
for f in $GUARD_UNCHANGED; do
  [ "$(sg rev-parse "${BASE_SHA}:${f}")" = "$(sg rev-parse "${DEPLOY_SHA}:${f}")" ] || die "${f} berbeda antara baseline dan kandidat — rilis ini tidak boleh menyentuhnya"
done
ok "hotfix Stock Count ada di baseline DAN kandidat; $(printf '%s\n' $GUARD_UNCHANGED | wc -w) berkas pelindung (Koreksi Gudang inti, jurnal, otorisasi, izin, Stock Count, Produksi override) identik dengan baseline"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHA:0:8}; produksi bergeser — berhenti"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
[ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME" 2>/dev/null)" = "$PREV_IMG_ID" ] || die "tag image ${IMG_NAME} TIDAK menunjuk image container aktif (${PREV_IMG_ID:7:12}); mungkin tersisa dari rilis yang terhenti sesudah build — pulihkan tag ke image container aktif dulu, lalu ulangi"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
ok "health sehat; bundel publik = dist release aktif (${PREV_INDEX})"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung"
for T in stock_movements goods_receipts goods_receipt_lines goods_receipt_events materials '"User"' activity_events warehouse_corrections stock_counts material_issues fin_journal_entries fin_journal_lines fin_purchase_orders fin_supplier_bills fin_supplier_bill_allocations fin_supplier_payments production_runs_v2; do
  [ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename='${T//\"/}'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
[ "$(wc -l < "$BK_DIR/applied-sebelum.txt" | tr -d ' ')" = "$LIVE_MIG_JUMLAH" ] || die "jumlah migrasi terpasang di produksi != ${LIVE_MIG_JUMLAH}"
[ "$(tail -n 1 "$BK_DIR/applied-sebelum.txt")" = "$LIVE_MIG_TERAKHIR" ] || die "migrasi terakhir terpasang bukan ${LIVE_MIG_TERAKHIR}"
cmp -s <(printf '%s\n' "$CAND_MIGS") "$BK_DIR/applied-sebelum.txt" || { diff <(printf '%s\n' "$CAND_MIGS") "$BK_DIR/applied-sebelum.txt" || true; die "migrasi terpasang di produksi TIDAK sama dengan migrasi kandidat (harus 0 pending dan 0 berlebih)"; }
ok "migrasi terpasang di produksi (${LIVE_MIG_JUMLAH}) = migrasi kandidat; 0 pending; terakhir = ${LIVE_MIG_TERAKHIR}"
JAD_ACTIVE_N="$(psql_live -At -c "select count(*) from production_unit_schedules where status = 'ACTIVE'")"; JAD_CLEARED_N="$(psql_live -At -c "select count(*) from production_unit_schedules where status = 'CLEARED'")"; JAD_ADOPTED_N="$(psql_live -At -c "select count(*) from production_unit_schedules where status = 'ADOPTED'")"
JAD_EV_N="$(psql_live -At -c "select count(*) from production_unit_schedule_events")"; UNIT_N="$(psql_live -At -c "select count(*) from units")"
JAD_TANPA_PLAN_N="$(psql_live -At -c "select count(*) from production_unit_schedules s where s.status = 'ACTIVE' and not exists (select 1 from production_runs_v2 r join production_run_plans_v2 p on p.id = r.plan_id where r.unit_id = s.unit_id and r.status not in ('COMPLETED','CANCELLED') and p.station_code is not null and p.status <> 'CANCELLED')")"
[[ "$JAD_ACTIVE_N" =~ ^[0-9]+$ ]] && [[ "$JAD_CLEARED_N" =~ ^[0-9]+$ ]] && [[ "$JAD_ADOPTED_N" =~ ^[0-9]+$ ]] && [[ "$JAD_EV_N" =~ ^[0-9]+$ ]] && [[ "$UNIT_N" =~ ^[0-9]+$ ]] && [[ "$JAD_TANPA_PLAN_N" =~ ^[0-9]+$ ]] || die "audit awal bukan angka"
ok "keadaan: unit=${UNIT_N}; jadwal Admin ACTIVE=${JAD_ACTIVE_N} (TANPA rencana Meja — yang berubah terbaca Dijadwalkan: ${JAD_TANPA_PLAN_N}), CLEARED=${JAD_CLEARED_N}, ADOPTED=${JAD_ADOPTED_N}, peristiwa=${JAD_EV_N} (rilis ini tidak mengubah satu pun)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")"
[[ "$BASE_TIDAK_SEIMBANG" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}"
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'pergerakan_stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'saldo_per_bahan', count(*), md5(coalesce(string_agg(s.material_id::text || ':' || s.q::text, '|' order by s.material_id),'')) from (select material_id, sum(qty) q from stock_movements where created_at < '$T0'::timestamp group by material_id) s
union all select 'penerimaan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipts x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'penerimaan_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_lines x where x.goods_receipt_id in (select id from goods_receipts where created_at < '$T0'::timestamp and updated_at < '$T0'::timestamp)
union all select 'penerimaan_event', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_events x where x.created_at < '$T0'::timestamp
union all select 'koreksi', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from warehouse_corrections x where x.requested_at < '$T0'::timestamp
union all select 'bahan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from materials x where x.created_at < '$T0'::timestamp
union all select 'jurnal_induk', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from fin_journal_entries x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'po', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_orders x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'tagihan_supplier', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bills x where x.created_at < '$T0'::timestamp
union all select 'alokasi_tagihan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bill_allocations x where x.bill_id in (select id from fin_supplier_bills where created_at < '$T0'::timestamp)
union all select 'pembayaran_supplier', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_payments x where x.created_at < '$T0'::timestamp
union all select 'run_produksi_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_runs_v2 x where x.created_at < '$T0'::timestamp
union all select 'event_aktivitas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from activity_events x where x.created_at < '$T0'::timestamp
union all select 'jadwal_admin', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_unit_schedules x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'jadwal_admin_event', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_unit_schedule_events x where x.created_at < '$T0'::timestamp
FPBEKU
)"
FPB_N=17
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "$FPB_N" ] || die "sidik jari dokumen beku tidak ${FPB_N} baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di ${FPB_N} kelompok)"

say "2b. Ruang disk"
AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 2 * 1024 * 1024 )) ] || die "ruang disk kurang (tersedia ${AVAIL_KB} KB)"
ok "ruang disk cukup (tersedia ${AVAIL_KB} KB)"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-skj-${DEPLOY_SHORT}-${TS}.sql.gz"
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

for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat; compose identik"

say "4b. Frontend TIDAK berubah: dist release aktif dipakai ulang (byte-identik; tidak ada build, tidak ada aset lama yang hilang)"
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin dist release aktif"
NEW_INDEX="$PREV_INDEX"
[ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] && cmp -s "$PREV_DIR/frontend/dist/index.html" "$NEW_DIR/frontend/dist/index.html" || die "dist yang dipakai ulang tidak identik dengan release aktif"
[ "$(printf '%s\n' "$CHANGED" | grep -c '^frontend/')" = "0" ] || die "kandidat mengubah frontend — rilis ini kode-saja backend"
ok "dist ${NEW_INDEX} dipakai ulang dari release aktif; frontend/ tidak berubah antara baseline dan kandidat"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-skj-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal-kode"; say "5b. Kode BARU terhadap restore backup NYATA (BACA-SAJA): setiap unit berjadwal Admin ACTIVE terbaca Dijadwalkan, CLEARED tidak; isi semua tabel IDENTIK sebelum vs sesudah; DB sementara dihapus"
REH_DB="rehearsal_skj_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
set +e; gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1; RESTORE_RC=$?; set -e
RESTORE_ERR="$(grep -ciE 'ERROR:|FATAL|PANIC' "$BK_DIR/restore-rehearsal.log" || true)"; RESTORE_WARN="$(grep -ciE 'WARNING' "$BK_DIR/restore-rehearsal.log" || true)"
[ "$RESTORE_RC" = "0" ] && [ "${RESTORE_ERR:-0}" = "0" ] || { grep -iE 'ERROR:|FATAL|PANIC' "$BK_DIR/restore-rehearsal.log" | LC_ALL=C sort | uniq -c | head -n 10 | sed 's/^/        /'; reh_drop; die "restore ke DB sementara TIDAK bersih (exit=${RESTORE_RC}, error=${RESTORE_ERR})"; }
ok "restore bersih: exit=0, error=0, warning=${RESTORE_WARN:-0}"
RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi"; }
TABEL_LAMA="$(RPSQL "select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1")"
[ "$(printf '%s\n' "$TABEL_LAMA" | grep -c .)" -ge 100 ] || { reh_drop; die "jumlah tabel di restore mencurigakan"; }
FP_ALL=""
while IFS= read -r t; do [ -n "$t" ] || continue; FP_ALL="${FP_ALL:+${FP_ALL} union all }select '${t}', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by md5(to_jsonb(x)::text)),'')) from \"${t}\" x"; done <<< "$TABEL_LAMA"
RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sebelum.txt" || { reh_drop; die "sidik jari penuh sebelum gagal"; }
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-kode-baru.log" 2>&1 || { cat "$BK_DIR/rehearsal-kode-baru.log"; reh_drop; die "pemeriksaan kode baru terhadap data restore GAGAL"; }
// Pemeriksaan KODE BARU "status kerja Dijadwalkan dari Rencana Admin" terhadap data restore backup NYATA. Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal (salinan). BACA-SAJA: tidak ada tulisan.
// Skrip rilis membuktikan isi seluruh tabel sama sebelum dan sesudah. Yang diperiksa: setiap unit berjadwal AKTIF terbaca "Dijadwalkan" (kecuali ada fakta yang lebih tinggi), jadwal CLEARED tidak, dan hanya unit berjadwal Admin yang berubah.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { perkayaBarisUnit, UNIT_INCLUDE } = await import("/app/src/services/productionOrderList.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 240) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const baris = async (ids) => ids.length ? perkayaBarisUnit(prisma, await prisma.unit.findMany({ where: { id: { in: ids } }, include: UNIT_INCLUDE })) : [];

// Fakta yang berkuasa di atas jadwal (urutan di productionWorkStatus): batal, bukti aplikasi, status order Siap Kirim+, pemakaian aktual, catatan manual. Jadwal hanya menentukan bila tidak ada satu pun.
const NAIK = new Set(["DIKERJAKAN", "DIKERJAKAN_ULANG", "MENUNGGU_QC", "SELESAI", "TERTUNDA", "DIBATALKAN"]);

// 1. Unit berjadwal Admin AKTIF
const aktif = await prisma.productionUnitSchedule.findMany({ where: { status: "ACTIVE" }, select: { unitId: true } });
const idAktif = aktif.map((x) => x.unitId);
const adaPlan = new Set((await prisma.productionRun.findMany({ where: { unitId: { in: idAktif }, status: { notIn: ["COMPLETED", "CANCELLED"] }, plan: { is: { stationCode: { not: null }, status: { not: "CANCELLED" } } } }, select: { unitId: true } })).map((x) => x.unitId));
const rA = await baris(idAktif);
const salah = rA.filter((r) => r.adopsi.kerja.key === "BELUM_DIJADWALKAN");
cek(`Jadwal Admin ACTIVE (${idAktif.length} unit): TIDAK ada yang masih terbaca 'Belum dijadwalkan'`, salah.length === 0, salah.map((r) => r.unitCode).join(","));
const hanyaJadwal = rA.filter((r) => !NAIK.has(r.adopsi.kerja.key));
cek("Jadwal Admin ACTIVE: yang tidak tertimpa fakta lain terbaca 'Dijadwalkan' dengan sumber 'Dari jadwal'", hanyaJadwal.every((r) => r.adopsi.kerja.key === "DIJADWALKAN" && (r.adopsi.kerja.source === "JADWAL" || adaPlan.has(r.id))), hanyaJadwal.map((r) => `${r.unitCode}:${r.adopsi.kerja.key}/${r.adopsi.kerja.source}`).join(" "));
cek("Jadwal Admin ACTIVE: ringkasan jadwal menampilkan sumber dan tanggal (bukan kosong)", rA.every((r) => r.adopsi.jadwal && r.adopsi.jadwal.tanggal && (r.adopsi.jadwal.sumber === "ADMIN" || r.adopsi.jadwal.sumber === "V2")));
// jadwal SAJA tidak mengaku ada pemakaian: bila tidak ada pergerakan ISSUE / komponen lama, hitungan pemakaian harus nol dan status bukan 'Sudah dikerjakan'
for (const r of rA) {
  const pakaiNyata = (r.adopsi.pemakaianBahan.baruCatatan + r.adopsi.pemakaianBahan.komponenLamaDipakaiKembali) > 0;
  if (!pakaiNyata && r.adopsi.kerja.key === "DIKERJAKAN") cek(`Unit ${r.unitCode}: 'Sudah dikerjakan' tanpa pemakaian nyata`, r.adopsi.kerja.source !== "PEMAKAIAN_BAHAN", r.adopsi.kerja.source);
}
cek("Jadwal SAJA tidak pernah menjadi 'Sudah dikerjakan' lewat sumber PEMAKAIAN_BAHAN tanpa pemakaian nyata", rA.every((r) => (r.adopsi.pemakaianBahan.baruCatatan + r.adopsi.pemakaianBahan.komponenLamaDipakaiKembali) > 0 || r.adopsi.kerja.source !== "PEMAKAIAN_BAHAN"));

// 2. Jadwal CLEARED tidak dihitung
const bersih = await prisma.productionUnitSchedule.findMany({ where: { status: "CLEARED" }, select: { unitId: true } });
const idBersih = bersih.map((x) => x.unitId).filter((id) => !idAktif.includes(id));
const planBersih = new Set((await prisma.productionRun.findMany({ where: { unitId: { in: idBersih }, status: { notIn: ["COMPLETED", "CANCELLED"] }, plan: { is: { stationCode: { not: null }, status: { not: "CANCELLED" } } } }, select: { unitId: true } })).map((x) => x.unitId));
const rB = await baris(idBersih);
cek(`Jadwal CLEARED (${idBersih.length} unit): tidak dibaca 'Dijadwalkan' dari jadwal yang sudah dikeluarkan`, rB.every((r) => !(r.adopsi.kerja.key === "DIJADWALKAN" && r.adopsi.kerja.source === "JADWAL" && !planBersih.has(r.id))), rB.filter((r) => r.adopsi.kerja.key === "DIJADWALKAN").map((r) => r.unitCode).join(","));

// 3. Perubahan HANYA pada unit berjadwal Admin: seluruh unit lain 'Dijadwalkan dari jadwal' harus punya rencana Meja (aturan lama)
const semuaJadwalan = await prisma.unit.findMany({ select: { id: true }, take: 5000 });
const rAll = await baris(semuaJadwalan.map((x) => x.id));
const dariJadwal = rAll.filter((r) => r.adopsi.kerja.key === "DIJADWALKAN" && r.adopsi.kerja.source === "JADWAL");
const planSemua = new Set((await prisma.productionRun.findMany({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] }, plan: { is: { stationCode: { not: null }, status: { not: "CANCELLED" } } } }, select: { unitId: true } })).map((x) => x.unitId));
const adaAdmin = new Set(idAktif);
cek(`Dari ${rAll.length} unit, 'Dijadwalkan dari jadwal' (${dariJadwal.length}) hanya untuk unit yang punya rencana Meja ATAU jadwal Admin ACTIVE`, dariJadwal.every((r) => planSemua.has(r.id) || adaAdmin.has(r.id)), dariJadwal.filter((r) => !planSemua.has(r.id) && !adaAdmin.has(r.id)).map((r) => r.unitCode).join(","));
cek("Unit tanpa jadwal apa pun TIDAK pernah terbaca 'Dijadwalkan'", rAll.filter((r) => !planSemua.has(r.id) && !adaAdmin.has(r.id)).every((r) => r.adopsi.kerja.key !== "DIJADWALKAN" || r.adopsi.kerja.source !== "JADWAL"));

// 4. Bukti tak ada tulisan sama sekali (sidik jari seluruh tabel dibandingkan oleh skrip rilis; di sini hitungan inti)
cek("Tidak ada baris jadwal/riwayat jadwal baru dari pemeriksaan ini", true, `jadwal=${await hitung("select count(*)::int n from production_unit_schedules")}, riwayat=${await hitung("select count(*)::int n from production_unit_schedule_events")}`);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
REHNODE
ok "kode baru terhadap data restore: $(tail -n 1 "$BK_DIR/rehearsal-kode-baru.log"); $(grep -c '^PASS' "$BK_DIR/rehearsal-kode-baru.log") pemeriksaan lulus"
RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sesudah.txt" || { reh_drop; die "sidik jari penuh sesudah gagal"; }
cmp -s "$BK_DIR/fp-all-sebelum.txt" "$BK_DIR/fp-all-sesudah.txt" || { diff "$BK_DIR/fp-all-sebelum.txt" "$BK_DIR/fp-all-sesudah.txt" || true; reh_drop; die "pemeriksaan kode baru MENGUBAH isi tabel (harus baca-saja)"; }
reh_drop
ok "rehearsal kode lulus: isi $(printf '%s\n' "$TABEL_LAMA" | grep -c .) tabel IDENTIK sebelum vs sesudah; DB sementara dihapus"

PHASE="6-pra-switch"; say "6. Pemeriksaan sebelum switch (TANPA migrasi)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum switch"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN switch"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum2.txt" || die "gagal membaca migrasi terpasang"
cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sebelum2.txt" || die "daftar migrasi terpasang berubah selama persiapan (sesi lain menerapkan migrasi) — berhenti, ulangi preflight"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-switch.txt" || die "sidik jari beku pra-switch gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-switch.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-switch.txt" || true; die "dokumen pembanding beku BERUBAH sebelum switch"; }
ok "tidak ada migrasi untuk diterapkan; migrasi terpasang tidak berubah; dokumen pembanding beku identik"

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
NBE=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in backend/src/*) ;; *) continue;; esac
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
  NBE=$((NBE+1))
done <<< "$CHANGED"
NBE_EXPECT="$(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w)"
[ "$NBE" = "$NBE_EXPECT" ] || die "berkas backend yang diverifikasi harus tepat ${NBE_EXPECT} (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
[ "$(PSQLN "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$LIVE_MIG_JUMLAH" ] || die "jumlah migrasi terpasang berubah"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "${LIVE_MIG_JUMLAH} migrasi terpasang tidak berubah; migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: unit berjadwal Rencana Admin terbaca Dijadwalkan di Ringkasan/daftar/Excel; jadwal CLEARED tidak; tidak ada tulisan pada tabel jadwal/Run/Meja"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
// Smoke BACA-SAJA rilis "status kerja Dijadwalkan dari Rencana Admin" terhadap backend yang SUDAH melayani (container baru). TIDAK membuat jadwal, riwayat, Run, penerimaan, stok, job, jurnal, atau pesan.
// Hanya GET (Ringkasan unit, daftar + filter, ekspor Excel) dan penolakan di pintu yang gagal sebelum menyentuh data. Jumlah baris tabel penting dibandingkan sebelum vs sesudah.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 300) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(method, path, token, mentah = false) {
  const r = await fetch(BASE + path, { method, headers: token ? { Authorization: "Bearer " + token } : {} });
  if (mentah) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const admin = aktif.find((u) => peran.get(u.id).includes("ADMIN") && punya(peran.get(u.id), P.UNIT_READ));
if (!admin) { rec("akun ADMIN aktif dengan izin baca Unit tersedia", false); process.exit(1); }
const tA = tokenUntuk(admin);
const PR = "/api/production";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TULIS = {
  sm: "select count(*)::int n from stock_movements", jad: "select count(*)::int n from production_unit_schedules", ev: "select count(*)::int n from production_unit_schedule_events", plan: "select count(*)::int n from production_run_plans_v2",
  run: "select count(*)::int n from production_runs_v2", job: "select count(*)::int n from jobs", jur: "select count(*)::int n from fin_journal_entries", komp: "select count(*)::int n from unit_component_reuse_entries",
  prog: "select count(*)::int n from production_unit_work_progress", act: "select count(*)::int n from activity_events", unit: "select count(*)::int n from units", mi: "select count(*)::int n from material_issues",
};
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);

rec("health publik sehat", (await api("GET", "/api/health", null)).json?.ok === true);
rec("Ringkasan unit tanpa token → 401", (await api("GET", `${PR}/units/00000000-0000-4000-8000-000000000000/adopsi`, null)).status === 401);

// ── Unit berjadwal Admin AKTIF (tanpa rencana Meja): harus terbaca Dijadwalkan di Ringkasan, daftar, dan Excel ──
const aktifRows = await prisma.$queryRawUnsafe("select s.unit_id::text id, u.unit_code code from production_unit_schedules s join units u on u.id = s.unit_id where s.status = 'ACTIVE' order by s.updated_at desc limit 40");
const NAIK = new Set(["DIKERJAKAN", "DIKERJAKAN_ULANG", "MENUNGGU_QC", "SELESAI", "TERTUNDA", "DIBATALKAN"]);
if (!aktifRows.length) skip("unit berjadwal Admin ACTIVE terbaca 'Dijadwalkan'", "tidak ada jadwal Admin ACTIVE di produksi saat smoke");
const terbaca = [];
for (const u of aktifRows) {
  const r = await api("GET", `${PR}/units/${u.id}/adopsi`, tA); const k = r.json?.adopsi?.kerja;
  terbaca.push({ code: u.code, id: u.id, status: r.status, key: k?.key, source: k?.source, jad: r.json?.adopsi?.jadwal?.sumber, bahan: (r.json?.adopsi?.pemakaianBahan?.baruCatatan ?? 0) + (r.json?.adopsi?.pemakaianBahan?.komponenLamaDipakaiKembali ?? 0) });
}
if (aktifRows.length) {
  rec(`Ringkasan ${aktifRows.length} unit berjadwal Admin ACTIVE: semua 200 dan tidak ada yang 'Belum dijadwalkan'`, terbaca.every((x) => x.status === 200 && x.key && x.key !== "BELUM_DIJADWALKAN"), terbaca.filter((x) => x.key === "BELUM_DIJADWALKAN" || x.status !== 200).map((x) => `${x.code}:${x.status}/${x.key}`).join(" "));
  rec("yang tidak tertimpa fakta lain terbaca 'Dijadwalkan' (sumber 'Dari jadwal') dan jadwalnya ber-sumber ADMIN/V2", terbaca.filter((x) => !NAIK.has(x.key)).every((x) => x.key === "DIJADWALKAN" && (x.jad === "ADMIN" || x.jad === "V2")), terbaca.filter((x) => !NAIK.has(x.key) && x.key !== "DIJADWALKAN").map((x) => `${x.code}:${x.key}`).join(" "));
  rec("jadwal SAJA tidak mengaku ada pemakaian: unit 'Dijadwalkan' berhitungan pemakaian bahan nol", terbaca.filter((x) => x.key === "DIJADWALKAN" && x.source === "JADWAL").every((x) => x.bahan === 0));
  const dij = await api("GET", `${PR}/work-orders?statusKerja=DIJADWALKAN&pageSize=500`, tA);
  const idsDij = new Set((dij.json?.units ?? []).map((x) => x.id));
  rec("daftar + filter 'Dijadwalkan' memuat semua unit berjadwal Admin yang berstatus Dijadwalkan", dij.status === 200 && terbaca.filter((x) => x.key === "DIJADWALKAN").every((x) => idsDij.has(x.id)), `${dij.status} total=${dij.json?.total}`);
  const belum = await api("GET", `${PR}/work-orders?statusKerja=BELUM_DIJADWALKAN&pageSize=500`, tA);
  const idsBelum = new Set((belum.json?.units ?? []).map((x) => x.id));
  rec("daftar + filter 'Belum dijadwalkan' TIDAK memuat unit berjadwal Admin", belum.status === 200 && terbaca.every((x) => !idsBelum.has(x.id)), `${belum.status}`);
  const x = await api("GET", `${PR}/work-orders/export.xlsx?statusKerja=DIJADWALKAN`, tA, true);
  rec("ekspor Excel Order Produksi 200", x.status === 200, String(x.status));
  if (x.status === 200) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf); const ws = wb.getWorksheet("Ringkasan Unit"); const head = ws.getRow(1).values.slice(1);
    const iKode = head.indexOf("Kode Unit") + 1; const iStatus = head.indexOf("Status Kerja (Administratif)") + 1;
    const peta = new Map(); ws.eachRow((row, i) => { if (i > 1) peta.set(row.values[iKode], row.values[iStatus]); });
    rec("Excel memuat kolom status kerja dan menuliskan 'Dijadwalkan' untuk unit berjadwal Admin yang berstatus Dijadwalkan", iKode > 0 && iStatus > 0 && terbaca.filter((t) => t.key === "DIJADWALKAN").every((t) => peta.get(t.code) === "Dijadwalkan"), terbaca.filter((t) => t.key === "DIJADWALKAN" && peta.get(t.code) !== "Dijadwalkan").map((t) => `${t.code}:${peta.get(t.code)}`).join(" "));
  }
}

// ── Jadwal yang sudah dikeluarkan (CLEARED) tidak boleh dibaca sebagai jadwal ──
const bersih = await prisma.$queryRawUnsafe("select s.unit_id::text id, u.unit_code code from production_unit_schedules s join units u on u.id = s.unit_id where s.status = 'CLEARED' order by s.updated_at desc limit 20");
if (!bersih.length) skip("jadwal CLEARED tidak dibaca sebagai jadwal", "tidak ada jadwal CLEARED di produksi saat smoke");
else {
  const hasil = [];
  for (const u of bersih) { const r = await api("GET", `${PR}/units/${u.id}/adopsi`, tA); hasil.push({ code: u.code, key: r.json?.adopsi?.kerja?.key, source: r.json?.adopsi?.kerja?.source, sumber: r.json?.adopsi?.jadwal?.sumber ?? null }); }
  rec(`jadwal CLEARED (${bersih.length} unit): tidak ada yang terbaca 'Dijadwalkan' dari jadwal Admin`, hasil.every((x) => !(x.key === "DIJADWALKAN" && x.source === "JADWAL" && x.sumber !== "V2")), hasil.filter((x) => x.key === "DIJADWALKAN").map((x) => `${x.code}:${x.sumber}`).join(" "));
}

// ── Yang tetap utuh ──
rec("Rencana Produksi: kalender minggu tetap 200", (await api("GET", `${PR}/rencana/minggu`, tA)).status === 200);
rec("Rencana Produksi: antrean tetap 200", (await api("GET", `${PR}/rencana/antrean?tab=SEMUA`, tA)).status === 200);
rec("Daftar Order Produksi tetap 200", (await api("GET", `${PR}/work-orders?pageSize=20`, tA)).status === 200);

// ── Tidak ada tulisan oleh smoke ──
const akhir = {}; for (const [k, q] of Object.entries(TULIS)) akhir[k] = await hitung(q);
// Tabel yang HANYA ditulis oleh alur jadwal/Meja/komponen: smoke ini (dan rilis ini) tidak boleh mengubahnya. Tabel yang juga ditulis pengguna nyata selama rilis (stok, job, jurnal, aktivitas, unit, Material Issue) hanya dilaporkan, tidak menggagalkan.
const KETAT = ["jad", "ev", "plan", "run", "komp", "prog"];
const berubah = KETAT.filter((k) => awal[k] !== akhir[k]);
rec("smoke tidak menulis: jadwal, riwayat jadwal, rencana Meja, Run, komponen lama, progres kerja tidak berubah", berubah.length === 0, berubah.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
const info = Object.keys(awal).filter((k) => !KETAT.includes(k) && awal[k] !== akhir[k]);
if (info.length) console.log("  INFO  tabel yang juga ditulis pengguna nyata berubah selama smoke (bukan oleh smoke ini): " + info.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else ok "smoke test lulus"; fi

[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang memang tidak ada harus 404 jujur"
ok "aset yang tidak ada = 404 (bukan index.html)"
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$FP_BEKU_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/data-sesudah.txt" || die "sidik jari dokumen beku sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis — periksa dengan backup"; }
ok "dokumen pembanding beku (pergerakan stok, saldo per bahan, penerimaan + baris + event, koreksi, jurnal, PO, tagihan, pembayaran, Produksi, aktivitas) IDENTIK sebelum vs sesudah rilis"
[ "$(PSQLN "select count(*) from production_unit_schedules where status = 'ACTIVE'")" = "$JAD_ACTIVE_N" ] || warn "jumlah jadwal Admin ACTIVE berubah dari ${JAD_ACTIVE_N} (pengguna sah dapat menjadwalkan selama rilis; rilis ini tidak membuatnya)"
# Pembersihan release lama (setelah rilis TERBUKTI sehat). Dipertahankan: 4 terbaru (mtime), release baru, release sebelumnya (rollback), dan release yang dirujuk container berjalan. Kegagalan di sini TIDAK menggagalkan rilis.
PHASE="9-pembersihan"; say "9. Pembersihan release lama (menyisakan 4 terbaru + rollback + yang dipakai container)"
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
say "CATATAN: rilis ini kode-saja (tanpa migrasi, tanpa perubahan data, tanpa frontend). Setelah SELESAI, verifikasi baca-saja: unit yang berjadwal Rencana Admin (mis. RES-19102026-094-U1) harus terbaca Dijadwalkan di Ringkasan, daftar, dan kedua Excel; JANGAN membuat jadwal/transaksi uji di production."
