#!/usr/bin/env bash
# RILIS "UX GUDANG TAHAP 1" — BACKEND + WEB, TANPA MIGRASI. FAIL-CLOSED. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA = Koreksi Gudang live).
#   Kode: Beranda Gudang (tugas hari ini dari dokumen nyata), halaman detail Penerimaan Barang (alur PO → jadwal → tiba → periksa → masuk stok, tabel per item), Stok & Lokasi yang jujur,
#   navigasi per alur, pemulihan dokumen (batalkan catatan tiba, pulihkan, buat penerimaan baru tertaut), panel PO ringkas di HP khusus Gudang (Finance tidak berubah), izin hanya-lihat.
#   TIDAK ADA migrasi, TIDAK ada perubahan skema/dependensi. Endpoint baru menulis hanya status header + jejak aktivitas dokumen penerimaan (tanpa pergerakan stok/jurnal) dan hanya dipanggil pengguna.
#   Produksi: smoke baca-saja + penolakan izin; tidak ada dokumen yang dibuat/diubah oleh rilis ini.
# URUTAN AMAN: (1) gerbang sumber (ancestry live, allowlist, TANPA prisma/dependensi, berkas pelindung identik) → (2) audit produksi baca-saja (terpasang == kandidat, 0 pending) + sidik jari beku
#              → (3) backup + checksum → (4) build web + image → (5b) kode BARU terhadap restore backup nyata (baca-saja, sidik jari sebelum=sesudah) → (7) switch → (8) verifikasi + smoke baca-saja + sidik jari beku.
#
#   cat scripts/release-ux-gudang-tahap1.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/ux.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/ux.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/ux.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/ux.out 2>&1 < /dev/null &'
#
# ROLLBACK KODE: aman kapan saja (tag image rollback-pre-uxg-<sha8>); tidak ada perubahan database untuk dipulihkan. Dokumen yang sudah dipulihkan/dibatalkan lewat UI tetap sebagai catatan (status header + jejak),
#   kode lama menampilkannya dengan status lama (Draf/Terjadwal/Ditolak) tanpa kehilangan data. Koreksi Gudang tidak terpengaruh.
# (dibangkitkan oleh scripts/gen-release-ux-gudang-tahap1.cjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang; templat sha256 9c6608024d95…)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/gudang-ux-tahap1}"
# Migrasi live terakhir (HARUS = migrasi terakhir di baseline, kandidat, dan produksi) dan jumlahnya: rilis ini tidak menambah/mengubah migrasi.
LIVE_MIG_TERAKHIR="20261220090000_gudang_koreksi_dokumen"; LIVE_MIG_JUMLAH="260"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard). Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/src/index\.js|backend/src/routes/goodsReceipt\.js|backend/src/routes/gudangBeranda\.js|backend/src/routes/warehouseReports\.js|backend/src/services/finance/kedatangan\.js|backend/src/services/gudangBeranda\.js|backend/src/services/penerimaanStatus\.js|backend/src/services/stokLokasi\.js|backend/src/services/warehouseCoverage\.js|backend/tests/integration/gudangUx\.integration\.test\.js|backend/tests/integration/setup/testApp\.js|backend/tests/releaseUxGudangTahap1\.test\.js|docs/GUDANG-UX-TAHAP1\.md|frontend/src/api\.js|frontend/src/components/Layout\.jsx|frontend/src/components/Topbar\.jsx|frontend/src/features/kedatangan/PanelKedatangan\.jsx|frontend/src/features/warehouse/aksi/AksiDokumen\.jsx|frontend/src/features/warehouse/aksi/aksiLogic\.js|frontend/src/features/warehouse/components/AdjustmentsTab\.jsx|frontend/src/features/warehouse/components/DamagedStockTab\.jsx|frontend/src/features/warehouse/components/GoodsReceiptFormModal\.jsx|frontend/src/features/warehouse/components/MaterialIssueDetailDrawer\.jsx|frontend/src/features/warehouse/components/ReturnsTab\.jsx|frontend/src/features/warehouse/components/StockCountDetailDrawer\.jsx|frontend/src/features/warehouse/components/StockTransferDetailDrawer\.jsx|frontend/src/features/warehouse/koreksi/KartuJalurKoreksi\.jsx|frontend/src/features/warehouse/penerimaan/AlurPenerimaan\.jsx|frontend/src/features/warehouse/penerimaan/PenerimaanDetail\.jsx|frontend/src/features/warehouse/penerimaan/TabelPerItem\.jsx|frontend/src/features/warehouse/penerimaan/penerimaanLogic\.js|frontend/src/features/warehouse/stok/stokLogic\.js|frontend/src/lib/tabTitles\.js|frontend/src/pages/warehouse/WarehouseBarangAkanDatang\.jsx|frontend/src/pages/warehouse/WarehouseDashboard\.jsx|frontend/src/pages/warehouse/WarehouseGoodsReceipt\.jsx|frontend/src/pages/warehouse/WarehouseInventory\.jsx|frontend/src/routes/pageRegistry\.jsx|frontend/tests/gudangUxTahap1\.test\.js|frontend/tests/tabTitles\.test\.js|scripts/gen-release-ux-gudang-tahap1\.cjs|scripts/lib/rehearsal-kode-ux-gudang\.mjs|scripts/lib/smoke-koreksi-gudang\.mjs|scripts/lib/smoke-ux-gudang-tahap1\.mjs|scripts/release-koreksi-gudang\.sh|scripts/release-ux-gudang-tahap1\.sh|scripts/templates/release-ux-gudang-tahap1\.sh\.tpl)$'
BACKEND_SRC_EXPECT="backend/src/index.js backend/src/routes/goodsReceipt.js backend/src/routes/gudangBeranda.js backend/src/routes/warehouseReports.js backend/src/services/finance/kedatangan.js backend/src/services/gudangBeranda.js backend/src/services/penerimaanStatus.js backend/src/services/stokLokasi.js backend/src/services/warehouseCoverage.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/components/Layout.jsx frontend/src/components/Topbar.jsx frontend/src/features/kedatangan/PanelKedatangan.jsx frontend/src/features/warehouse/aksi/AksiDokumen.jsx frontend/src/features/warehouse/aksi/aksiLogic.js frontend/src/features/warehouse/components/AdjustmentsTab.jsx frontend/src/features/warehouse/components/DamagedStockTab.jsx frontend/src/features/warehouse/components/GoodsReceiptFormModal.jsx frontend/src/features/warehouse/components/MaterialIssueDetailDrawer.jsx frontend/src/features/warehouse/components/ReturnsTab.jsx frontend/src/features/warehouse/components/StockCountDetailDrawer.jsx frontend/src/features/warehouse/components/StockTransferDetailDrawer.jsx frontend/src/features/warehouse/koreksi/KartuJalurKoreksi.jsx frontend/src/features/warehouse/penerimaan/AlurPenerimaan.jsx frontend/src/features/warehouse/penerimaan/PenerimaanDetail.jsx frontend/src/features/warehouse/penerimaan/TabelPerItem.jsx frontend/src/features/warehouse/penerimaan/penerimaanLogic.js frontend/src/features/warehouse/stok/stokLogic.js frontend/src/lib/tabTitles.js frontend/src/pages/warehouse/WarehouseBarangAkanDatang.jsx frontend/src/pages/warehouse/WarehouseDashboard.jsx frontend/src/pages/warehouse/WarehouseGoodsReceipt.jsx frontend/src/pages/warehouse/WarehouseInventory.jsx frontend/src/routes/pageRegistry.jsx"
# Perubahan live yang TIDAK boleh hilang/berubah: hotfix Stock Count; berkas pelindung identik dengan baseline (Koreksi Gudang inti, jurnal, otorisasi, Produksi override, Stock Count).
HOTFIX_STOCK_COUNT="b5268e1f7d8e1a15a251106dee0a136898ee5ce1"
GUARD_UNCHANGED="backend/src/services/warehouseCorrection.js backend/src/routes/gudangKoreksi.js backend/src/services/inventoryLedger.js backend/src/routes/materialIssue.js backend/src/routes/stockAdjustment.js backend/src/routes/stockTransfer.js backend/src/routes/returnRecord.js backend/src/routes/stockCount.js backend/src/services/opnameCutover.js backend/src/services/opnameMatriks.js backend/src/services/pergerakanSesiHitung.js backend/src/services/finance/journal.js backend/src/middleware/authorize.js backend/src/middleware/auth.js backend/src/constants/permissions.js backend/src/services/adminOverrideSwitch.js backend/src/services/deliveryOverrideAdmin.js backend/src/services/productionStepCommandService.js"
LIVE_ANCESTORS="10294dcbc45d7e13c737721ddaa34e38f5b2ee77 08d62e7d713b08fc9e0f1d898c37791352476b5b 799d3e93de192c604a14f1c11fe7436538689bb0 56b87721f84c1d16a2cd1655e40787e2b626cb0f e5a32cd246b2233e9d05d9b2cbff733e4497725d"
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
BK_DIR="$HOME/release-backups/ux-gudang-tahap1-${DEPLOY_SHORT}-${TS}"
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
Rollback kode setelah switch (TANPA perubahan database; tidak ada yang dipulihkan):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Dokumen yang dibatalkan/dipulihkan/dibuat ulang lewat UI tetap utuh (status header + jejak); koreksi Gudang tidak terpengaruh.
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
exec 9>/tmp/release-ux-gudang-tahap1.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "ux\.sh\|release-ux-gudang\|pgrep\|node src/index.js" | grep -v "$$" || true)"
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
KOREKSI_N="$(psql_live -At -c "select count(*) from warehouse_corrections")"; SM_N="$(psql_live -At -c "select count(*) from stock_movements")"; GR_N="$(psql_live -At -c "select count(*) from goods_receipts")"
[[ "$KOREKSI_N" =~ ^[0-9]+$ ]] && [[ "$SM_N" =~ ^[0-9]+$ ]] && [[ "$GR_N" =~ ^[0-9]+$ ]] || die "audit awal bukan angka"
ok "keadaan: koreksi=${KOREKSI_N}, pergerakan stok=${SM_N}, penerimaan=${GR_N} (rilis ini tidak mengubah satu pun)"
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
BACKUP_FILE="$HOME/backups/pre-uxg-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Beranda Gudang" "Batalkan catatan tiba" "Pulihkan ke Draf" "Riwayat dokumen" "Riwayat penerimaan" "Yang bisa dilakukan sekarang"; do
  [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru TIDAK memuat teks fitur rilis ini: ${s1}"
done
for s2 in "Ajukan Koreksi Stok" "Koreksi Penerimaan" "Simpan Koreksi Data" "Konfirmasi Barang Jadi" "Selesaikan Produksi" "Rencana Produksi" "Uang muka dialokasikan ke faktur" "Tetapkan Siap Kirim (override)" "Riwayat referensi dari file (bukan transaksi)" "Simpan ke Stok"; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur UX Gudang ada; teks fitur live lama (Koreksi, Produksi, Riwayat Referensi) tetap ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-uxg-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal-kode"; say "5b. Kode BARU terhadap restore backup NYATA (baca-saja): restore bersih, Beranda/Stok & Lokasi/status penerimaan dihitung pada data nyata, sidik jari sebelum = sesudah, DB sementara dihapus"
REH_DB="rehearsal_uxg_${TS}"
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
// Pemeriksaan KODE BARU UX Gudang Tahap 1 terhadap data restore backup NYATA (BACA-SAJA; tidak ada tulisan). Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { berandaGudang } = await import("/app/src/services/gudangBeranda.js");
const { stokLokasi } = await import("/app/src/services/stokLokasi.js");
const { tampilanPenerimaan, penghalangBatalJadwal } = await import("/app/src/services/penerimaanStatus.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const sm0 = await n("select count(*)::int n from stock_movements"), gr0 = await n("select count(*)::int n from goods_receipts"), kor0 = await n("select count(*)::int n from warehouse_corrections");

// Beranda: lima tugas, hitungan konsisten dengan penghitungan langsung dari tabel
const b = await berandaGudang(prisma);
cek("Beranda: tepat 5 tugas dengan jumlah numerik, definisi, dan tautan", b.tugas.length === 5 && b.tugas.every((t) => Number.isInteger(t.jumlah) && t.tautan && t.judul) && Object.keys(b.definisi).length === 5, b.tugas.map((t) => `${t.kode}=${t.jumlah}`).join(" "));
const tugas = Object.fromEntries(b.tugas.map((t) => [t.kode, t]));
const berjalan = await n("select count(*)::int n from goods_receipts where status in ('ARRIVED','INSPECTION','READY_FOR_PUTAWAY') and not (arrival_revision = 0 and arrived_date is null and not exists (select 1 from goods_receipt_lines l where l.goods_receipt_id = goods_receipts.id and (coalesce(l.received_qty,0) <> 0 or coalesce(l.accepted_qty,0) <> 0 or coalesce(l.rejected_qty,0) <> 0 or coalesce(l.companion_qty,0) <> 0)))");
cek("Beranda: 'belum masuk stok' = jumlah penerimaan berjalan yang berisi barang (hitung langsung)", tugas.BELUM_MASUK_STOK.jumlah === berjalan, `${tugas.BELUM_MASUK_STOK.jumlah} vs ${berjalan}`);
cek("Beranda: 'selisih menunggu' = hitungan stok menunggu review + penyesuaian + koreksi", tugas.SELISIH_MENUNGGU.jumlah === (await n("select ((select count(*) from stock_counts where status = 'WAITING_REVIEW') + (select count(*) from stock_adjustment_requests where status in ('WAITING_APPROVAL','APPROVED')) + (select count(*) from warehouse_corrections where status = 'PENDING_APPROVAL'))::int n")));

// Stok & Lokasi: setiap bahan terwakili; null = belum ada catatan (bukan nol)
const s = await stokLokasi(prisma); const nBahan = await n("select count(*)::int n from materials");
cek("Stok & Lokasi: setiap bahan terdaftar muncul sekali", s.rows.length === nBahan && s.ringkasan.terdaftar === nBahan, `${s.rows.length}/${nBahan}`);
const gerak = new Map((await prisma.$queryRawUnsafe("select material_id::text id, count(*)::int n from stock_movements group by 1")).map((r) => [r.id, r.n]));
cek("Stok & Lokasi: saldo kosong (belum diketahui) HANYA untuk bahan tanpa pergerakan; yang bergerak punya angka", s.rows.every((r) => (r.saldo === null) === !(gerak.get(r.materialId) > 0)));
cek("Stok & Lokasi: ringkasan konsisten (ada + belum ada catatan + nol + minus = aktif)", s.ringkasan.ada + s.ringkasan.belumAdaCatatan + s.ringkasan.nolTerhitung + s.ringkasan.minus === s.ringkasan.aktif, JSON.stringify({ aktif: s.ringkasan.aktif, ada: s.ringkasan.ada, belum: s.ringkasan.belumAdaCatatan, nol: s.ringkasan.nolTerhitung, minus: s.ringkasan.minus }));

// Status per penerimaan nyata
const grs = await prisma.goodsReceipt.findMany({ include: { lines: true } });
let salah = 0; let terjadwalBersih = 0;
for (const g of grs) {
  const t = tampilanPenerimaan(g); const kodeAksi = t.aksi.map((a) => a.kode);
  const final = g.status === "REJECTED" || g.status === "COMPLETED";
  if (!t.label || !Array.isArray(t.tahap) || t.tahap.length !== 5) salah += 1;
  if (g.status === "COMPLETED" && !(kodeAksi.length === 1 && /^KOREKSI_/.test(kodeAksi[0]))) salah += 1;
  if (!final && kodeAksi.length === 0) salah += 1;
  if (g.status === "SCHEDULED" && g.arrivalRevision === 0 && !g.arrivedDate) { const h = penghalangBatalJadwal(g, await n(`select count(*)::int n from stock_movements where goods_receipt_id = '${g.id}'`)); if (h === null) terjadwalBersih += 1; else salah += 1; }
}
cek(`Status ${grs.length} penerimaan nyata: label + 5 tahap; Sudah masuk stok hanya aksi Koreksi; yang belum final selalu punya aksi; Terjadwal tanpa tiba boleh dibatalkan`, salah === 0, `penyimpangan=${salah}; terjadwal bersih=${terjadwalBersih}`);
cek("tidak ada pergerakan/penerimaan/koreksi yang ditulis oleh pemeriksaan ini", (await n("select count(*)::int n from stock_movements")) === sm0 && (await n("select count(*)::int n from goods_receipts")) === gr0 && (await n("select count(*)::int n from warehouse_corrections")) === kor0);
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
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: Beranda, Stok & Lokasi, status per penerimaan nyata, izin, penolakan sebelum menyentuh data, Koreksi Gudang tetap utuh"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
// Smoke BACA-SAJA rilis UX Gudang Tahap 1 terhadap backend yang SUDAH melayani (dijalankan di container baru). Tidak membuat/mengubah penerimaan, koreksi, stok, jurnal, PO, atau Produksi.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, UUID/tipe tidak valid).
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
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const penulis = cari((r) => punya(r, P.INVENTORY_WRITE) && r.includes("ADMIN")) ?? cari((r) => punya(r, P.INVENTORY_WRITE));
const pembacaSaja = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && punya(r, P.INVENTORY_READ) && !punya(r, P.INVENTORY_WRITE));
const tanpaBaca = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.INVENTORY_READ));
if (!penulis) { rec("akun dengan izin tulis Inventory tersedia", false); process.exit(1); }
const tW = tokenUntuk(penulis); const nol = "00000000-0000-4000-8000-000000000000";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const awal = { sm: await hitung("select count(*)::int n from stock_movements"), kor: await hitung("select count(*)::int n from warehouse_corrections"), act: await hitung("select count(*)::int n from activity_events where event_type in ('DOCUMENT_EDITED','DOCUMENT_CANCELLED') and entity_type = 'goods_receipt'"),
  status: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from goods_receipts group by 1 order by 1")) };

// ── Pintu baru: tanpa token / tanpa izin / bentuk salah ──
rec("Beranda tanpa token → 401", (await api("GET", "/api/inventory/beranda", null)).status === 401);
rec("Stok & Lokasi tanpa token → 401", (await api("GET", "/api/inventory/beranda/stok", null)).status === 401);
if (tanpaBaca) rec("Beranda akun tanpa izin baca Inventory → 403", (await api("GET", "/api/inventory/beranda", tokenUntuk(tanpaBaca))).status === 403); else skip("Beranda 403", "tidak ada akun aktif tanpa izin baca Inventory");
const AKSI_BARU = ["kembali-draft", "batalkan-jadwal", "batalkan-tiba", "pulihkan", "buat-ulang"];
for (const a of AKSI_BARU) {
  rec(`${a} tanpa token → 401`, (await api("POST", `/api/inventory/goods-receipts/${nol}/${a}`, null, { alasan: "uji smoke" })).status === 401);
  if (pembacaSaja) { const s = (await api("POST", `/api/inventory/goods-receipts/${nol}/${a}`, tokenUntuk(pembacaSaja), { alasan: "uji smoke tanpa izin" })).status; rec(`${a} akun hanya-baca → 403`, s === 403, String(s)); }
  const u = (await api("POST", `/api/inventory/goods-receipts/bukan-uuid/${a}`, tW, { alasan: "uji smoke uuid" })).status; rec(`${a} UUID tidak valid → 400 (tanpa menyentuh data)`, u === 400, String(u));
  const t = (await api("POST", `/api/inventory/goods-receipts/${nol}/${a}`, tW, {})).status; rec(`${a} dokumen tidak ada/alasan kosong → 400/404 (tanpa menulis)`, t === 400 || t === 404, String(t));
}
if (!pembacaSaja) skip("aksi baru 403 untuk akun hanya-baca", "tidak ada akun aktif hanya-baca");

// ── Baca: Beranda, Stok & Lokasi, status per penerimaan NYATA, panel PO ──
const b = await api("GET", "/api/inventory/beranda", tW);
rec("Beranda: 200, 5 tugas, definisi, dihitung server", b.status === 200 && b.json?.tugas?.length === 5 && b.json?.definisi && typeof b.json?.dihitungPada === "string", `${b.status} ${b.json?.tugas?.map((t) => t.kode + "=" + t.jumlah).join(" ")}`);
const s = await api("GET", "/api/inventory/beranda/stok", tW); const nBahan = await hitung("select count(*)::int n from materials");
rec("Stok & Lokasi: 200; setiap bahan sekali; ringkasan menyebut yang belum ada catatan/minus/batas minimum", s.status === 200 && s.json?.rows?.length === nBahan && s.json?.ringkasan?.terdaftar === nBahan && !!s.json?.ringkasan?.kesimpulan?.reorder, `${s.status} bahan=${s.json?.rows?.length}`);
const grs = await prisma.goodsReceipt.findMany({ select: { id: true, receiptNumber: true, status: true, purchaseOrderId: true }, orderBy: { receiptNumber: "asc" } });
let n = 0;
for (const g of grs) {
  const r = await api("GET", `/api/inventory/goods-receipts/${g.id}`, tW); const t = r.json?.tampilan; const final = ["COMPLETED", "REJECTED"].includes(g.status);
  const okAksi = g.status === "COMPLETED" ? t?.aksi?.length === 1 && /^KOREKSI_/.test(t.aksi[0].kode) : final ? true : t?.aksi?.length > 0;
  rec(`detail ${g.receiptNumber} (${g.status}): 200, status + aksi sesuai, izin.tulis=true`, r.status === 200 && !!t?.label && okAksi && r.json?.izin?.tulis === true && Array.isArray(r.json?.jejak), `${r.status} ${t?.kode}`); n += 1;
  if (pembacaSaja && n === 1) { const rb = await api("GET", `/api/inventory/goods-receipts/${g.id}`, tokenUntuk(pembacaSaja)); if (rb.status === 200) rec("akun hanya-baca: izin.tulis=false dan aksi kosong", rb.json?.izin?.tulis === false && rb.json?.tampilan?.aksi?.length === 0, JSON.stringify(rb.json?.izin)); else rec("akun hanya-baca: ditolak 403 (tidak ada akses baca)", rb.status === 403, String(rb.status)); }
}
const po = await prisma.finPurchaseOrder.findFirst({ where: { status: { in: ["DISETUJUI", "DITERIMA_SEBAGIAN"] } }, select: { id: true, poNumber: true } });
if (po) { const r = await api("GET", `/api/inventory/barang-akan-datang/${po.id}`, tW); rec(`Barang Akan Datang ${po.poNumber}: 200; setiap penerimaan membawa status petugas (tampilan)`, r.status === 200 && (r.json?.penerimaan ?? []).every((x) => !!x.tampilan?.label), `${r.status} n=${r.json?.penerimaan?.length}`); } else skip("Barang Akan Datang detail", "tidak ada PO aktif");
// Koreksi Gudang tetap utuh
const c = await api("GET", "/api/inventory/koreksi/cakupan", tW); rec("Koreksi Gudang: cakupan 200 (menu tetap)", c.status === 200 && c.json?.menu?.length > 0, `menu=${c.json?.menu?.length}`);
const selesai = grs.find((g) => g.status === "COMPLETED");
if (selesai) { const k = await api("GET", `/api/inventory/koreksi/dokumen/GOODS_RECEIPT/${selesai.id}`, tW); rec(`Koreksi Gudang: jalur ${selesai.receiptNumber} tetap ${selesai.purchaseOrderId ? "ALUR_RESMI" : "KOREKSI_UI"}`, k.status === 200 && k.json?.jalur === (selesai.purchaseOrderId ? "ALUR_RESMI" : "KOREKSI_UI"), `${k.status} ${k.json?.jalur}`); } else skip("jalur Koreksi", "tidak ada penerimaan COMPLETED");
rec("Finance: daftar PO tetap 200", (await api("GET", "/api/finance/purchase-orders", tW)).status === 200);
rec("Produksi: board tetap 200", (await api("GET", "/api/production/board", tW)).status === 200);
// Tidak ada tulisan oleh smoke
const akhir = { sm: await hitung("select count(*)::int n from stock_movements"), kor: await hitung("select count(*)::int n from warehouse_corrections"), act: await hitung("select count(*)::int n from activity_events where event_type in ('DOCUMENT_EDITED','DOCUMENT_CANCELLED') and entity_type = 'goods_receipt'"),
  status: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from goods_receipts group by 1 order by 1")) };
rec("smoke tidak menulis: pergerakan stok, koreksi, jejak dokumen penerimaan, dan sebaran status penerimaan tidak berubah", akhir.sm === awal.sm && akhir.kor === awal.kor && akhir.act === awal.act && akhir.status === awal.status, JSON.stringify({ sm: [awal.sm, akhir.sm], kor: [awal.kor, akhir.kor], act: [awal.act, akhir.act] }));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP); " + n + " penerimaan nyata diperiksa");
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
[ "$(PSQLN "select count(*) from warehouse_corrections")" = "$KOREKSI_N" ] || warn "jumlah koreksi berubah dari ${KOREKSI_N} (pengguna sah dapat mengajukan koreksi selama rilis; rilis ini tidak membuatnya)"
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
say "CATATAN: rilis ini tidak membuat dokumen/koreksi. QA manual pertama oleh petugas Gudang pada dokumen uji yang disepakati, bukan pada GR Ocean."
