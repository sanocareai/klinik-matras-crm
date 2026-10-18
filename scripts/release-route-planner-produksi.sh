#!/usr/bin/env bash
# RILIS "STATUS PRODUKSI TIDAK MENAHAN PENGIRIMAN (ROUTE PLANNER)" — BACKEND + WEB, TANPA MIGRASI. FAIL-CLOSED. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA = release live saat ini).
#   Keputusan Owner 18 Okt 2026 (kasus RES-03102026-018-U1 / rute RTE-161026-02): unit yang masih dalam Produksi (RECEIVED/IN_PRODUCTION, order PROCESSING/READY) boleh masuk Route Planner sebagai job
#   BIASA — boleh diberi driver, diterbitkan, dijalankan, dan diselesaikan — tanpa saklar, tanpa catatan wajib, tanpa Admin override. Status unit/Run TIDAK diubah saat penempatan; saat unit BENAR-BENAR
#   berangkat/terkirim sementara Run belum ditutup, Run diberi penanda "dilepas untuk pengiriman" otomatis (kind DISPATCH_ROUTE_PLANNER; kolom yang sudah ada: tanpa migrasi). Tanpa QC/foto/custody/stok palsu.
#   Yang tetap ditolak: unit batal/terkirim/sudah berangkat, barang yang belum sampai di bengkel, order selain PROCESSING/READY, dan job pengiriman ganda. Admin override (saklar) tetap ada dan TIDAK berubah.
#   TIDAK ADA migrasi, TIDAK ada perubahan skema/dependensi. Produksi: smoke baca-saja + penolakan sebelum menyentuh data; rilis ini tidak membuat job, rute, penanda Run, atau perubahan status unit apa pun.
# URUTAN AMAN: (1) gerbang sumber (ancestry live, allowlist, TANPA prisma/dependensi, berkas pelindung identik) → (2) audit produksi baca-saja (terpasang == kandidat, 0 pending) + sidik jari beku
#              → (3) backup + checksum → (4) build web + image → (5b) kode BARU terhadap restore backup nyata (pelepasan Run dicoba DI DALAM transaksi yang dibatalkan; sidik jari sebelum=sesudah) → (7) switch → (8) verifikasi + smoke baca-saja + sidik jari beku.
#
#   cat scripts/release-route-planner-produksi.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rpp.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rpp.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rpp.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/rpp.out 2>&1 < /dev/null &'
#
# ROLLBACK KODE: aman SELAMA belum ada Run yang dilepas karena dispatch (production_runs_v2.delivery_released_at terisi dengan kind DISPATCH_ROUTE_PLANNER) — periksa dengan scripts/rollback-guard-route-planner-produksi.sh
#   (baca-saja). Bila sudah ada: kode lama menandai unit terkirim + Run aktif sebagai konflik V1; pilih perbaiki-maju, atau tutup Run administratif (Selesaikan Produksi / Konfirmasi Barang Jadi) lebih dulu.
#   Tidak ada perubahan database untuk dipulihkan; job/rute yang dibuat lewat aturan baru tetap sebagai catatan.
# (dibangkitkan oleh scripts/gen-release-route-planner-produksi.cjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang; templat sha256 f77b5ad0d554…)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/route-planner-bebas-status-produksi}"
# Migrasi live terakhir (HARUS = migrasi terakhir di baseline, kandidat, dan produksi) dan jumlahnya: rilis ini tidak menambah/mengubah migrasi.
LIVE_MIG_TERAKHIR="20261220090000_gudang_koreksi_dokumen"; LIVE_MIG_JUMLAH="260"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard). Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/src/lib/activityLog\.js|backend/src/routes/armada\.js|backend/src/services/adminOverrideSwitch\.js|backend/src/services/deliveryMenungguKonfirmasi\.js|backend/src/services/deliveryOverrideAdmin\.js|backend/src/services/productionExperienceReadService\.js|backend/src/services/productionRunGuards\.js|backend/src/services/unitCustodyCommandService\.js|backend/tests/integration/adminOverrideSiapKirim\.integration\.test\.js|backend/tests/integration/kesiapanBarangJadi\.integration\.test\.js|backend/tests/releaseRoutePlannerProduksi\.test\.js|frontend/src/api\.js|frontend/src/features/armada/components/JobBadges\.jsx|frontend/src/features/armada/components/RouteCard\.jsx|frontend/src/features/production/AdminOverrideSiapKirim\.jsx|frontend/src/pages/Armada\.jsx|frontend/tests/konfirmasiBarangJadi\.test\.js|scripts/gen-release-route-planner-produksi\.cjs|scripts/lib/rehearsal-kode-route-planner-produksi\.mjs|scripts/lib/smoke-route-planner-produksi\.mjs|scripts/release-route-planner-produksi\.sh|scripts/rollback-guard-route-planner-produksi\.sh|scripts/templates/release-route-planner-produksi\.sh\.tpl)$'
BACKEND_SRC_EXPECT="backend/src/lib/activityLog.js backend/src/routes/armada.js backend/src/services/adminOverrideSwitch.js backend/src/services/deliveryMenungguKonfirmasi.js backend/src/services/deliveryOverrideAdmin.js backend/src/services/productionExperienceReadService.js backend/src/services/productionRunGuards.js backend/src/services/unitCustodyCommandService.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/armada/components/JobBadges.jsx frontend/src/features/armada/components/RouteCard.jsx frontend/src/features/production/AdminOverrideSiapKirim.jsx frontend/src/pages/Armada.jsx"
# Perubahan live yang TIDAK boleh hilang/berubah: hotfix Stock Count; berkas pelindung identik dengan baseline (Koreksi Gudang inti, jurnal, otorisasi, Produksi override, Stock Count).
HOTFIX_STOCK_COUNT="b5268e1f7d8e1a15a251106dee0a136898ee5ce1"
GUARD_UNCHANGED="backend/src/services/warehouseCorrection.js backend/src/routes/gudangKoreksi.js backend/src/services/inventoryLedger.js backend/src/routes/materialIssue.js backend/src/routes/stockAdjustment.js backend/src/routes/goodsReceipt.js backend/src/routes/returnRecord.js backend/src/routes/stockTransfer.js backend/src/routes/stockCount.js backend/src/services/opnameCutover.js backend/src/services/opnameMatriks.js backend/src/services/pergerakanSesiHitung.js backend/src/services/finance/journal.js backend/src/middleware/authorize.js backend/src/middleware/auth.js backend/src/constants/permissions.js backend/src/services/productionStepCommandService.js backend/src/services/unitStageEngine.js backend/src/services/orderStatusSync.js"
LIVE_ANCESTORS="20606872412290a0a80f563e605f7717bf57f3e0 10294dcbc45d7e13c737721ddaa34e38f5b2ee77 08d62e7d713b08fc9e0f1d898c37791352476b5b 799d3e93de192c604a14f1c11fe7436538689bb0 56b87721f84c1d16a2cd1655e40787e2b626cb0f e5a32cd246b2233e9d05d9b2cbff733e4497725d"
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
BK_DIR="$HOME/release-backups/route-planner-produksi-${DEPLOY_SHORT}-${TS}"
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
PERIKSA DULU (baca-saja): bash ${NEW_DIR}/scripts/rollback-guard-route-planner-produksi.sh — menolak (exit 1) bila sudah ada Run yang dilepas karena dispatch; bila menolak, JANGAN rollback kode (lihat kepala skrip).
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
exec 9>/tmp/release-route-planner-produksi.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rpp\.sh\|release-route-planner-produksi\|pgrep\|node src/index.js" | grep -v "$$" || true)"
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
RILIS_DISPATCH_N="$(psql_live -At -c "select count(*) from production_runs_v2 where delivery_released_at is not null and delivery_release->>'kind' = 'DISPATCH_ROUTE_PLANNER'")"; OVERRIDE_N="$(psql_live -At -c "select count(*) from production_runs_v2 where delivery_released_at is not null and delivery_release->>'kind' = 'ADMIN_OVERRIDE'")"
UNIT_PROD_N="$(psql_live -At -c "select count(*) from units u join \"Order\" o on o.id = u.order_id where u.status in ('RECEIVED','IN_PRODUCTION') and o.status in ('PROCESSING','READY') and o.penjualan_karyawan_id is null and not exists (select 1 from job_units ju join jobs j on j.id = ju.job_id where ju.unit_id = u.id and j.type = 'DELIVERY' and j.status in ('UNSCHEDULED','SCHEDULED','ASSIGNED','EN_ROUTE','ARRIVED'))")"
JOB_N="$(psql_live -At -c "select count(*) from jobs")"; UNIT_N="$(psql_live -At -c "select count(*) from units")"
[[ "$RILIS_DISPATCH_N" =~ ^[0-9]+$ ]] && [[ "$OVERRIDE_N" =~ ^[0-9]+$ ]] && [[ "$UNIT_PROD_N" =~ ^[0-9]+$ ]] && [[ "$JOB_N" =~ ^[0-9]+$ ]] && [[ "$UNIT_N" =~ ^[0-9]+$ ]] || die "audit awal bukan angka"
[ "$RILIS_DISPATCH_N" = "0" ] || die "sudah ada Run yang dilepas karena dispatch (${RILIS_DISPATCH_N}) sebelum rilis — tidak diharapkan; periksa dulu"
ok "keadaan: unit=${UNIT_N}, job=${JOB_N}, override Admin=${OVERRIDE_N}, unit produksi yang BARU bisa dijadwalkan lewat aturan ini=${UNIT_PROD_N} (rilis ini tidak mengubah satu pun)"
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
FPBEKU
)"
FPB_N=15
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "$FPB_N" ] || die "sidik jari dokumen beku tidak ${FPB_N} baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di ${FPB_N} kelompok)"

say "2b. Sumber node_modules frontend (package.json identik dengan kandidat)"
LOCK_NEW="$BK_DIR/pkg-baru.json"; sg show "${DEPLOY_SHA}:frontend/package.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do
  d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package.json identik"
ok "node_modules build dari ${NM_SRC}"
NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang (tersedia ${AVAIL_KB} KB)"
ok "ruang disk cukup (tersedia ${AVAIL_KB} KB)"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-rpp-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Produksi unit ini belum selesai — tidak menahan pengiriman" "berangkat/terkirim lewat Route Planner saat pencatatan produksinya belum selesai"; do
  [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru TIDAK memuat teks fitur rilis ini: ${s1}"
done
for s2 in "Konfirmasi Barang Jadi" "Selesaikan Produksi" "Beranda Gudang" "Ajukan Koreksi Stok" "Koreksi Penerimaan" "Tetapkan Siap Kirim" "Admin override: Siap Kirim"; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur rilis ini ada; teks fitur live lama (Koreksi, Produksi, Gudang) tetap ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-rpp-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal-kode"; say "5b. Kode BARU terhadap restore backup NYATA: restore bersih; penanda/penempatan dihitung pada unit nyata; pelepasan Run dicoba di dalam transaksi yang DIBATALKAN; sidik jari sebelum = sesudah; DB sementara dihapus"
REH_DB="rehearsal_rpp_${TS}"
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
// Pemeriksaan KODE BARU "status produksi tidak menahan pengiriman" terhadap data restore backup NYATA. Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal (salinan).
// Satu-satunya tulisan terjadi DI DALAM transaksi yang selalu DIBATALKAN (rollback) pada salinan; skrip rilis membuktikan sidik jari seluruh tabel sama sebelum dan sesudah.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { validasiPenempatanUnitProduksi, unitMenungguPerJob, STATUS_PRODUKSI_BISA_DIKIRIM, STATUS_ORDER_SAH_PRODUKSI } = await import("/app/src/services/deliveryMenungguKonfirmasi.js");
const { bacaOverrideAdmin } = await import("/app/src/services/deliveryOverrideAdmin.js");
const { adminOverrideReport } = await import("/app/src/services/adminOverrideSwitch.js");
const { tandaiRunDilepasKarenaDispatchInTx } = await import("/app/src/services/unitCustodyCommandService.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);

// 1. Penempatan: unit produksi nyata yang sah lolos validasi; unit/order yang tidak sah ditolak dengan kode
const kandidat = await prisma.unit.findMany({ where: { status: { in: [...STATUS_PRODUKSI_BISA_DIKIRIM] }, order: { status: { in: [...STATUS_ORDER_SAH_PRODUKSI] }, penjualanKaryawanId: null } }, include: { order: { select: { id: true, orderNumber: true, status: true } } }, take: 200 });
let lolos = 0; let tolakKode = 0; const alasan = new Set();
for (const u of kandidat) {
  try { await validasiPenempatanUnitProduksi(prisma, [u]); lolos += 1; } catch (e) { if (e?.code === "JOB_GANDA") tolakKode += 1; else alasan.add(e?.code || e?.message); }
}
cek(`Penempatan: ${kandidat.length} unit produksi sah dinilai; yang lolos = yang belum punya job pengiriman aktif; sisanya hanya ditolak JOB_GANDA`, alasan.size === 0 && lolos + tolakKode === kandidat.length, `lolos=${lolos}, JOB_GANDA=${tolakKode}, lain=[${[...alasan].join(",")}]`);
const sqlLolos = await n("select count(*)::int n from units u join \"Order\" o on o.id = u.order_id where u.status in ('RECEIVED','IN_PRODUCTION') and o.status in ('PROCESSING','READY') and o.penjualan_karyawan_id is null and not exists (select 1 from job_units ju join jobs j on j.id = ju.job_id where ju.unit_id = u.id and j.type = 'DELIVERY' and j.status in ('UNSCHEDULED','SCHEDULED','ASSIGNED','EN_ROUTE','ARRIVED'))");
cek("Penempatan: jumlah yang lolos = hitungan SQL independen", kandidat.length > 200 || lolos === sqlLolos, `kode=${lolos} sql=${sqlLolos}`);
const terminal = await prisma.unit.findFirst({ where: { status: { in: ["CANCELLED", "DELIVERED"] } }, include: { order: { select: { id: true, orderNumber: true, status: true } } } });
if (terminal) { let kode = null; try { await validasiPenempatanUnitProduksi(prisma, [terminal]); } catch (e) { kode = e?.code; } cek("Unit batal/terkirim ditolak (UNIT_BATAL / UNIT_SUDAH_BERANGKAT)", ["UNIT_BATAL", "UNIT_SUDAH_BERANGKAT"].includes(kode), String(kode)); } else cek("Unit batal/terkirim: tidak ada contoh di data (dilewati)", true);

// 2. Penanda informasi per job pada job pengiriman nyata (baca-saja)
const jobs = await prisma.job.findMany({ where: { type: "DELIVERY" }, select: { id: true }, take: 500 });
const peta = await unitMenungguPerJob(prisma, jobs.map((j) => j.id));
cek(`Penanda informasi: dihitung untuk ${jobs.length} job pengiriman nyata tanpa galat`, peta instanceof Map, `job bertanda=${peta.size}`);

// 3. Pembaca penanda memakai filter JSON kind pada data nyata (kolom JSONB) — override Admin tetap terbaca, dispatch tidak tercampur
const adaOverride = await n("select count(*)::int n from production_runs_v2 where delivery_released_at is not null and delivery_release->>'kind' = 'ADMIN_OVERRIDE'");
const unitOv = await prisma.productionRun.findMany({ where: { deliveryReleasedAt: { not: null } }, select: { unitId: true }, take: 50 });
const ov = await bacaOverrideAdmin(prisma, unitOv.map((r) => r.unitId));
cek("Pembaca override Admin: filter kind JSON berjalan pada data nyata", ov instanceof Map && ov.size <= unitOv.length, `override=${adaOverride}, terbaca=${ov.size}`);
const lap = await adminOverrideReport(prisma, { limit: 50 });
cek("Laporan override Admin: 200 baris bentuk benar; hanya kind ADMIN_OVERRIDE", Array.isArray(lap.items) && lap.items.length === Math.min(adaOverride, 50), `items=${lap.items.length}`);

// 4. Pelepasan Run karena dispatch — DICOBA di dalam transaksi yang selalu dibatalkan, pada unit nyata yang sah (RECEIVED/IN_PRODUCTION dengan Run berjalan)
const run = await prisma.productionRun.findFirst({ where: { status: { in: ["PENDING_ARRIVAL", "ACTIVE", "BLOCKED"] }, deliveryReleasedAt: null, unit: { status: { in: ["RECEIVED", "IN_PRODUCTION"] } } }, include: { unit: { select: { id: true, unitCode: true, status: true } } } });
if (!run) { cek("Pelepasan Run dispatch: tidak ada Run produksi berjalan di data (dilewati)", true); } else {
  class Batal extends Error {}
  let hasil = null; let sesudah = null;
  try {
    await prisma.$transaction(async (tx) => {
      hasil = await tandaiRunDilepasKarenaDispatchInTx(tx, { unitIds: [run.unit.id], jobId: null, actorId: null, via: "JOB_START" });
      sesudah = await tx.productionRun.findUnique({ where: { id: run.id }, select: { deliveryReleasedAt: true, deliveryRelease: true, revision: true, status: true } });
      const ulang = await tandaiRunDilepasKarenaDispatchInTx(tx, { unitIds: [run.unit.id], jobId: null, actorId: null, via: "JOB_START" });
      if (ulang.length !== 0) throw new Error("tidak idempoten");
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) { cek("Pelepasan Run dispatch (transaksi dibatalkan) tidak galat", false, e?.message); } }
  cek(`Pelepasan Run dispatch pada unit nyata ${run.unit.unitCode} (${run.unit.status}): penanda kind DISPATCH_ROUTE_PLANNER + revisi naik 1 + Run tetap ${run.status}; idempoten`, !!hasil && hasil.length === 1 && sesudah?.deliveryRelease?.kind === "DISPATCH_ROUTE_PLANNER" && sesudah.revision === run.revision + 1 && sesudah.status === run.status && !!sesudah.deliveryReleasedAt);
  const tetap = await prisma.productionRun.findUnique({ where: { id: run.id }, select: { deliveryReleasedAt: true, revision: true } });
  cek("Transaksi percobaan DIBATALKAN: Run di salinan tidak berubah", tetap.deliveryReleasedAt === null && tetap.revision === run.revision);
  const terkini = await prisma.unit.findUnique({ where: { id: run.unit.id }, select: { status: true } });
  cek("Status unit tidak tersentuh oleh pelepasan Run (ditulis pemanggil setelahnya)", terkini.status === run.unit.status);
}
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
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: papan pengiriman memuat unit produksi yang sah, tidak ada job/penanda baru, izin dan penolakan sebelum menyentuh data, override/Koreksi/Riwayat tetap utuh"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
// Smoke BACA-SAJA rilis "status produksi tidak menahan pengiriman" terhadap backend yang SUDAH melayani (dijalankan di container baru). Tidak membuat/mengubah job, rute, unit, Run, stok, jurnal, atau PO.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, unit tidak ada).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const info = (n) => console.log(`  INFO  ${n}`);
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const dispatcher = cari((r) => punya(r, P.JOB_WRITE) && r.includes("ADMIN")) ?? cari((r) => punya(r, P.JOB_WRITE));
const tanpaIzin = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.JOB_WRITE) && !punya(r, P.JOB_OWN_WRITE));
if (!dispatcher) { rec("akun dengan izin tulis Job tersedia", false); process.exit(1); }
const tD = tokenUntuk(dispatcher); const nol = "00000000-0000-4000-8000-000000000000";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const keadaan = async () => ({
  job: await hitung("select count(*)::int n from jobs"), jobUnit: await hitung("select count(*)::int n from job_units"), rute: await hitung("select count(*)::int n from routes"),
  rilisRun: await hitung("select count(*)::int n from production_runs_v2 where delivery_released_at is not null"),
  statusUnit: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from units group by 1 order by 1")),
  aktivitasDispatch: await hitung("select count(*)::int n from activity_events where event_type = 'PRODUCTION_DISPATCHED_BEFORE_DONE'"),
  pergerakan: await hitung("select count(*)::int n from stock_movements"),
});
const awal = await keadaan();

// ── Pintu: tanpa token / tanpa izin / unit tidak ada (semua gagal SEBELUM menyentuh data) ──
rec("papan pengiriman tanpa token → 401", (await api("GET", "/api/armada/board?type=DELIVERY", null)).status === 401);
rec("buat job tanpa token → 401", (await api("POST", "/api/armada/jobs", null, { type: "DELIVERY", unitIds: [nol] })).status === 401);
if (tanpaIzin) rec("buat job akun tanpa izin Job → 403", (await api("POST", "/api/armada/jobs", tokenUntuk(tanpaIzin), { type: "DELIVERY", unitIds: [nol] })).status === 403); else skip("buat job 403", "tidak ada akun aktif tanpa izin Job");
const tak = await api("POST", "/api/armada/jobs", tD, { type: "DELIVERY", unitIds: [nol], scheduledDate: "2026-12-31" });
rec("buat job untuk unit yang tidak ada → 400 (tanpa membuat job)", tak.status === 400, `${tak.status} ${tak.json?.error ?? ""}`);
rec("buat job tanpa unit → 400", (await api("POST", "/api/armada/jobs", tD, { type: "DELIVERY", unitIds: [] })).status === 400);

// ── Aturan baru terlihat di papan: unit produksi yang sah ada di `available` (sama dengan hitungan SQL independen) ──
const papan = await api("GET", "/api/armada/board?type=DELIVERY", tD);
const sqlProduksi = await prisma.$queryRawUnsafe("select u.id::text id, u.unit_code code from units u join \"Order\" o on o.id = u.order_id where u.status in ('RECEIVED','IN_PRODUCTION') and o.status in ('PROCESSING','READY') and o.penjualan_karyawan_id is null and not exists (select 1 from job_units ju join jobs j on j.id = ju.job_id where ju.unit_id = u.id and j.type = 'DELIVERY' and j.status in ('UNSCHEDULED','SCHEDULED','ASSIGNED','EN_ROUTE','ARRIVED','RESCHEDULED'))");
rec("papan DELIVERY: 200 dan bentuk lama utuh (jobs, available, availableMenunggu kosong untuk klien lama)", papan.status === 200 && Array.isArray(papan.json?.jobs) && Array.isArray(papan.json?.available) && Array.isArray(papan.json?.availableMenunggu) && papan.json.availableMenunggu.length === 0, String(papan.status));
const idAvail = new Set((papan.json?.available ?? []).map((u) => u.id));
const hilang = sqlProduksi.filter((u) => !idAvail.has(u.id));
rec(`papan DELIVERY: semua ${sqlProduksi.length} unit produksi yang sah (RECEIVED/IN_PRODUCTION, order biasa PROCESSING/READY, tanpa job aktif) ada di available`, hilang.length === 0, hilang.length ? `hilang: ${hilang.map((u) => u.code).join(",")}` : "");
const rika = await prisma.unit.findFirst({ where: { unitCode: "RES-03102026-018-U1" }, select: { id: true, status: true, order: { select: { status: true } } } });
if (rika) info(`RES-03102026-018-U1 (dibaca saja): unit ${rika.status}, order ${rika.order?.status}; ${idAvail.has(rika.id) ? "TAMPIL di available papan pengiriman" : "tidak di available (belum memenuhi syarat/ sudah punya job aktif)"}`);
const lama = await api("GET", "/api/armada/board?type=DELIVERY&termasukMenunggu=1", tD);
rec("klien lama (?termasukMenunggu=1): 200 dan availableMenunggu kosong", lama.status === 200 && lama.json?.availableMenunggu?.length === 0);
const pick = await api("GET", "/api/armada/board?type=PICKUP", tD);
rec("papan PICKUP tidak berubah bentuk: 200", pick.status === 200 && Array.isArray(pick.json?.available));
if (pick.status === 200) rec("papan PICKUP: tidak memuat unit produksi (hanya AWAITING_PICKUP)", (pick.json.available ?? []).every((u) => u.status === "AWAITING_PICKUP"));

// ── Yang tetap utuh ──
const lap = await api("GET", "/api/production-v2/admin-override/report", tD);
rec("Admin override: laporan tetap 200 (fitur override tidak berubah)", lap.status === 200 && Array.isArray(lap.json?.items), String(lap.status));
const sw = await api("GET", "/api/production-v2/admin-override/switch", tD);
rec("Admin override: saklar tetap terbaca (200) dan tidak dinyalakan oleh rilis ini", sw.status === 200, `${sw.status} aktif=${sw.json?.enabled}`);
rec("Gudang: koreksi cakupan tetap 200", (await api("GET", "/api/inventory/koreksi/cakupan", tD)).status === 200);
rec("Finance: daftar PO tetap 200", (await api("GET", "/api/finance/purchase-orders", tD)).status === 200);

// ── Tidak ada tulisan oleh smoke ──
const akhir = await keadaan();
rec("smoke tidak menulis: job, job_unit, rute, Run yang dilepas, status unit, aktivitas dispatch, dan pergerakan stok tidak berubah", JSON.stringify(akhir) === JSON.stringify(awal), JSON.stringify({ awal, akhir }));
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
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} tidak bisa diunduh (404)"
  ok "aset lama ${OLD_ONLY} masih 200 (tab terbuka tidak kena 404)"
fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang memang tidak ada harus 404 jujur"
ok "aset yang tidak ada = 404 (bukan index.html)"
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$FP_BEKU_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/data-sesudah.txt" || die "sidik jari dokumen beku sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis — periksa dengan backup"; }
ok "dokumen pembanding beku (pergerakan stok, saldo per bahan, penerimaan + baris + event, koreksi, jurnal, PO, tagihan, pembayaran, Produksi, aktivitas) IDENTIK sebelum vs sesudah rilis"
[ "$(PSQLN "select count(*) from production_runs_v2 where delivery_released_at is not null and delivery_release->>'kind' = 'DISPATCH_ROUTE_PLANNER'")" = "$RILIS_DISPATCH_N" ] || warn "jumlah Run yang dilepas karena dispatch berubah dari ${RILIS_DISPATCH_N} (dispatcher sah dapat menjalankan pengiriman selama rilis; rilis ini tidak membuatnya)"
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
say "CATATAN: rilis ini tidak membuat job/rute/penanda Run. Uji nyata pertama oleh dispatcher pada unit yang disepakati Owner (mis. RES-03102026-018-U1); jangan memakai PO Ocean production untuk uji."
