#!/usr/bin/env bash
# RILIS "EVALUASI CATATAN PEMAKAIAN HISTORIS: GLOBAL + ATOMIK + EFEKTIF + BATCH LATAR" — KODE SAJA (backend), TANPA MIGRASI, TANPA FRONTEND, TANPA DATA. FAIL-CLOSED. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA = release live saat ini).
#   Cacat 1: setelah posting, evaluasi hanya melihat unit yang diposting → SIAP_POSTING PALSU (24 Okt: 5 catatan; rencana berikutnya 384 trx, benar 379), dan evaluasi berjalan di luar transaksi posting/koreksi.
#   Cacat 2: GR resmi / pengeluaran stok biasa mengubah saldo di luar modul catatan → catatan lain yang memakai bahan sama tampil SIAP_POSTING basi sampai evaluasi berikutnya.
#   Perbaikan: evaluator SELALU global, terkunci (kunci advisory, urutan kunci seragam), berjalan DI DALAM transaksi posting/koreksi. Pembaca (tampilan Produksi, ringkasan, rencana posting, ekspor Excel, biaya bahan, laporan) dan mesin posting memakai
#          keadaan EFEKTIF terhadap ledger sekarang (cap ledger murah; klasifikasi ulang hanya bila cap berubah) + penyegaran latar yang menyimpan keadaan benar; penulis GR/pengeluaran biasa TIDAK disentuh. Cache pemetaan bahan: evaluasi 1,3 dtk → 0,3 dtk.
#          Posting batch besar di LATAR (API 202 + progres; id = hash rencana yang disetujui, idempoten; sewa pekerja + pulihan setelah putus; hentikan/lanjut) — peristiwa append-only di activity_events, tanpa tabel baru. Posting SATU order sinkron via unitIds.
#   TIDAK ADA migrasi, perubahan skema/dependensi, frontend, atau data yang diubah. Rilis ini TIDAK memposting, TIDAK mengoreksi stok, TIDAK membuat GR historis/jurnal; batch hanya berjalan bila Owner menyetujui hash rencana.
# URUTAN AMAN: (1) gerbang sumber (ancestry live, allowlist, TANPA prisma/dependensi/frontend, berkas pelindung identik) → (2) audit produksi baca-saja (terpasang == kandidat, 0 pending, tag image = image aktif) + sidik jari beku
#              → (3) backup + checksum → (4) release dir (dist dipakai ulang) + image → (5b) kode BARU terhadap restore backup nyata (audit baca-saja: sidik jari seluruh tabel sebelum=sesudah; LALU simulasi tulis pada DB rehearsal yang dihapus)
#              → (7) switch → (8) verifikasi + smoke baca-saja + sidik jari beku.
#
#   cat scripts/release-evaluasi-catatan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/evl.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/evl.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/evl.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-penuh > /tmp/evl.out 2>&1 < /dev/null &'   # backup + image BERTAG REHEARSAL + restore nyata + kode baru; TANPA switch; menulis bukti (berlaku 36 jam)
#   (rilis penuh tanpa flag WAJIB didahului --rehearsal-penuh LULUS untuk SHA + baseline yang sama)
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/evl.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/evl.out 2>&1 < /dev/null &'
#
# ROLLBACK KODE: aman kapan saja (tidak ada perubahan database untuk dipulihkan; image lama = release live yang SUDAH memuat tabel catatan).
# (dibangkitkan oleh scripts/gen-release-evaluasi-catatan.cjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang; templat sha256 c02a5e397981…)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/evaluasi-catatan-atomik-global}"
# Migrasi live terakhir (HARUS = migrasi terakhir di baseline, kandidat, dan produksi) dan jumlahnya: rilis ini tidak menambah/mengubah migrasi.
LIVE_MIG_TERAKHIR="20261228090000_catatan_pemakaian_historis"; LIVE_MIG_JUMLAH="268"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard). Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/src/index\.js|backend/src/routes/pemakaianKoreksi\.js|backend/src/services/catatanPemakaianHistoris\.js|backend/src/services/finance/biayaBahan\.js|backend/src/services/koreksiPemakaian\.js|backend/src/services/laporanRekonsiliasiPemakaian\.js|backend/src/services/postingBatchLatar\.js|backend/src/services/postingPemakaianHistoris\.js|backend/src/services/productionOrderExport\.js|backend/tests/imporTerkelolaPemakaianHistoris\.test\.js|backend/tests/integration/evaluasiCatatanAtomik\.integration\.test\.js|backend/tests/integration/evaluasiCatatanBasi\.integration\.test\.js|backend/tests/integration/postingBatchLatar\.integration\.test\.js|backend/tests/integration/rekonsiliasiKoreksiPosting\.integration\.test\.js|backend/tests/releaseEvaluasiCatatan\.test\.js|docs/impor-catatan-historis-production\.md|docs/rekonsiliasi-pemakaian-historis\.md|scripts/gen-release-evaluasi-catatan\.cjs|scripts/lib/impor-terkelola-pemakaian-historis\.mjs|scripts/lib/rehearsal-kode-evaluasi-catatan\.mjs|scripts/lib/simulasi-evaluasi-catatan\.mjs|scripts/lib/smoke-evaluasi-catatan\.mjs|scripts/release-evaluasi-catatan\.sh|scripts/release-rekon-pemakaian\.sh|scripts/templates/release-evaluasi-catatan\.sh\.tpl)$'
BACKEND_SRC_EXPECT="backend/src/index.js backend/src/routes/pemakaianKoreksi.js backend/src/services/catatanPemakaianHistoris.js backend/src/services/finance/biayaBahan.js backend/src/services/koreksiPemakaian.js backend/src/services/laporanRekonsiliasiPemakaian.js backend/src/services/postingBatchLatar.js backend/src/services/postingPemakaianHistoris.js backend/src/services/productionOrderExport.js"
FRONTEND_SRC_EXPECT=""
# Perubahan live yang TIDAK boleh hilang/berubah: hotfix Stock Count; berkas pelindung identik dengan baseline (Koreksi Gudang inti, jurnal, otorisasi, Produksi override, Stock Count).
HOTFIX_STOCK_COUNT="b5268e1f7d8e1a15a251106dee0a136898ee5ce1"
GUARD_UNCHANGED="backend/src/services/warehouseCorrection.js backend/src/routes/gudangKoreksi.js backend/src/services/inventoryLedger.js backend/src/routes/materialIssue.js backend/src/routes/stockAdjustment.js backend/src/routes/goodsReceipt.js backend/src/routes/returnRecord.js backend/src/routes/stockTransfer.js backend/src/routes/stockCount.js backend/src/services/opnameCutover.js backend/src/services/opnameMatriks.js backend/src/services/pergerakanSesiHitung.js backend/src/services/inventorySegregation.js backend/src/services/finance/journal.js backend/src/services/finance/posting/inventory.js backend/src/middleware/authorize.js backend/src/middleware/auth.js backend/src/constants/permissions.js backend/src/services/productionStepCommandService.js backend/src/services/unitStageEngine.js backend/src/services/orderStatusSync.js backend/src/lib/domain/pemakaianHistoris.js"
LIVE_ANCESTORS="df00edb69d382fa290c08c978cfb5b9a86881446 693b8c52d58b520c5e36111ccfaa511d8fcb0a0c fa6beb8608387c8107f730e48ac121aa6beef76e 4394c8288944a7116fbe5970c037d66a14e4ec12 624f08d8b5a77305a152e915e24f0023a2e35524 d82e6e3d9ced46b423be57ca0eab680f38953587 fd38f6c2382af914d1ebdd531a5dc430cff758c9 e47f37e2d6690130525681863ff467682e30f3c4 58cbc284aa71038ce2694e4579282f5e5abf3a05 20606872412290a0a80f563e605f7717bf57f3e0 10294dcbc45d7e13c737721ddaa34e38f5b2ee77 08d62e7d713b08fc9e0f1d898c37791352476b5b 799d3e93de192c604a14f1c11fe7436538689bb0 56b87721f84c1d16a2cd1655e40787e2b626cb0f e5a32cd246b2233e9d05d9b2cbff733e4497725d f293c5879fdac10e5ef0e1bb8a1169ef9ce8bef6 ca9bdea72a03df5794658fb485c6f3a79b360eee"
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
REHEARSAL_PENUH=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; [ "$a" = "--rehearsal-penuh" ] && REHEARSAL_PENUH=1; done
[ "$((PREFLIGHT_ONLY + REHEARSAL_PENUH))" -le 1 ] || die "pilih SATU mode saja (--preflight-only | --rehearsal-penuh)"
WS=""; REH_IMG=""; REH_DB=""; NET=""
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/evaluasi-catatan-${DEPLOY_SHORT}-${TS}"
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
Rollback kode AMAN tanpa guard: rilis ini tidak mengubah database (tanpa migrasi, tanpa tulisan data); image lama = release live yang SUDAH memuat tabel catatan. Catatan: kode lama kembali memiliki cacat SIAP_POSTING palsu — JANGAN memposting dengan kode lama.
─────────────────────────────────────────────────────────────────────────
EOF
}
# Pembersih --rehearsal-penuh (dipanggil di trap EXIT, juga saat gagal): hapus direktori kerja, image bertag rehearsal (SATU tag itu saja), dan DB sementara bernama rehearsal_evl_*. TIDAK menyentuh production.
cleanup_penuh() {
  [ "$REHEARSAL_PENUH" = "1" ] || return 0
  if [[ "${REH_DB:-}" =~ ^rehearsal_evl_[0-9_]+$ ]] && [ -n "${PREV_DIR:-}" ]; then dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; fi
  if [ -n "${WS:-}" ] && [[ "$WS" == "$HOME/release-rehearsal/evl-"* ]]; then rm -rf -- "$WS" 2>/dev/null || sudo -n rm -rf -- "$WS" 2>/dev/null || true; fi
  if [ -n "${REH_IMG:-}" ] && [[ "$REH_IMG" == *":rehearsal-evl-"* ]]; then docker rmi "$REH_IMG" >/dev/null 2>&1 || true; fi
  return 0
}
trap 'rc=$?; [ $rc -ne 0 ] && [ "$REHEARSAL_PENUH" = "0" ] && rollback_instructions; cleanup_penuh; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-evaluasi-catatan.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "evl\.sh\|release-evaluasi-catatan\|pgrep\|node src/index.js" | grep -v "$$" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
if [ "$PREFLIGHT_ONLY" = "0" ] && [ "$REHEARSAL_PENUH" = "0" ]; then [ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"; fi

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
for T in stock_movements goods_receipts goods_receipt_lines goods_receipt_events materials '"User"' activity_events warehouse_corrections stock_counts material_issues fin_journal_entries fin_journal_lines fin_purchase_orders fin_supplier_bills fin_supplier_bill_allocations fin_supplier_payments production_runs_v2 unit_usage_notes unit_usage_note_events usage_import_batches; do
  [ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename='${T//\"/}'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
[ "$(wc -l < "$BK_DIR/applied-sebelum.txt" | tr -d ' ')" = "$LIVE_MIG_JUMLAH" ] || die "jumlah migrasi terpasang di produksi != ${LIVE_MIG_JUMLAH}"
[ "$(tail -n 1 "$BK_DIR/applied-sebelum.txt")" = "$LIVE_MIG_TERAKHIR" ] || die "migrasi terakhir terpasang bukan ${LIVE_MIG_TERAKHIR}"
cmp -s <(printf '%s\n' "$CAND_MIGS") "$BK_DIR/applied-sebelum.txt" || { diff <(printf '%s\n' "$CAND_MIGS") "$BK_DIR/applied-sebelum.txt" || true; die "migrasi terpasang di produksi TIDAK sama dengan migrasi kandidat (harus 0 pending dan 0 berlebih)"; }
ok "migrasi terpasang di produksi (${LIVE_MIG_JUMLAH}) = migrasi kandidat; 0 pending; terakhir = ${LIVE_MIG_TERAKHIR}"
CAT_N="$(psql_live -At -c "select count(*) from unit_usage_notes")"; CAT_SIAP_N="$(psql_live -At -c "select count(*) from unit_usage_notes where state = 'SIAP_POSTING'")"; CAT_POST_N="$(psql_live -At -c "select count(*) from unit_usage_notes where state = 'DIPOSTING'")"
CAT_EV_N="$(psql_live -At -c "select count(*) from unit_usage_note_events")"; MV_HIST_N="$(psql_live -At -c "select count(*) from stock_movements where note like 'Impor pemakaian historis Sep%'")"
[[ "$CAT_N" =~ ^[0-9]+$ ]] && [[ "$CAT_SIAP_N" =~ ^[0-9]+$ ]] && [[ "$CAT_POST_N" =~ ^[0-9]+$ ]] && [[ "$CAT_EV_N" =~ ^[0-9]+$ ]] && [[ "$MV_HIST_N" =~ ^[0-9]+$ ]] || die "audit awal bukan angka"
[ "$CAT_N" -gt 0 ] || die "tabel catatan pemakaian historis kosong di produksi — impor v2 belum ada; rilis ini tidak relevan"
ok "keadaan: catatan=${CAT_N} (SIAP_POSTING=${CAT_SIAP_N}, DIPOSTING=${CAT_POST_N}), peristiwa=${CAT_EV_N}, pergerakan hasil posting historis=${MV_HIST_N} (rilis ini tidak mengubah satu pun)"
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
union all select 'catatan_pemakaian', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from unit_usage_notes x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'catatan_pemakaian_event', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from unit_usage_note_events x where x.created_at < '$T0'::timestamp
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

# Kode BARU terhadap restore backup NYATA (baca-saja). Dipakai rilis penuh (container dari release dir) dan --rehearsal-penuh (image bertag rehearsal, TANPA env production).
rehearsal_kode() {
REH_DB="rehearsal_evl_${TS}"
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
if [ "$REHEARSAL_PENUH" = "1" ]; then RUNNER=(docker run --rm -i --network "$NET" -w /app -e JWT_SECRET="rehearsal-sekali-pakai-${TS}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" "$REH_IMG" node --input-type=module -)
else RUNNER=(dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module -); fi
"${RUNNER[@]}" <<'REHNODE' > "$BK_DIR/rehearsal-kode-baru.log" 2>&1 || { cat "$BK_DIR/rehearsal-kode-baru.log"; reh_drop; die "pemeriksaan kode baru terhadap data restore GAGAL"; }
// Pemeriksaan KODE BARU "evaluasi catatan pemakaian historis: global + atomik + terserialisasi" terhadap data restore backup NYATA. Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal (salinan).
// BACA-SAJA: skrip rilis membuktikan isi seluruh tabel sama sebelum dan sesudah. Yang diperiksa: keadaan catatan production SUDAH titik tetap menurut kode baru (evaluasi global tidak punya apa pun untuk diubah),
// rencana posting dapat dibangun, dan kunci evaluasi tersedia di Postgres (pg_advisory_xact_lock) tanpa menahan apa pun.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { periksaKeadaanCatatan, kunciEvaluasiCatatan } = await import("/app/src/services/catatanPemakaianHistoris.js");
const { rencanakanPosting } = await import("/app/src/services/postingPemakaianHistoris.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 240) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);

const dbNama = (await prisma.$queryRawUnsafe("select current_database() n"))[0].n;
cek("berjalan di DB rehearsal (bukan production)", /^rehearsal_evl_\d+_\d+$/.test(dbNama), dbNama);
const n0 = await hitung("select count(*)::int n from unit_usage_notes");
cek("tabel catatan pemakaian historis berisi (impor v2 ada di data restore)", n0 > 0, n0);

// 1) keadaan production = titik tetap (potret konsisten RepeatableRead; tanpa kunci; tanpa tulisan)
const r = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 });
cek("keadaan catatan production = titik tetap: evaluasi global tidak mengubah satu pun catatan", r.berubah === 0, `berubah=${r.berubah} ${JSON.stringify((r.detail ?? []).slice(0, 2))}`);
cek("semua catatan Excel + LEDGER diperiksa (bukan sebagian)", r.diperiksa >= n0 - 1, `diperiksa=${r.diperiksa} dari ${n0}`);

// 2) rencana posting dapat dibangun dari keadaan yang sama (tanpa menulis) dan konsisten antar-bacaan
const a = await rencanakanPosting(prisma); const b = await rencanakanPosting(prisma);
cek("rencana posting stabil (hash sama dua kali) dan hanya memuat catatan SIAP_POSTING", a.hash === b.hash && a.jumlah === b.jumlah, `${a.jumlah} trx / ${a.orderUnik} order; hash ${a.hash.slice(0, 12)}`);
cek("transaksi rencana = kelompok unit × bahan dari catatan SIAP_POSTING", a.jumlah <= (await hitung("select count(*)::int n from unit_usage_notes where state = 'SIAP_POSTING'")));

// 3) kunci evaluasi: pg_advisory_xact_lock tersedia dan re-entrant dalam satu transaksi (dipakai berlapis oleh posting → evaluasi); dilepas saat transaksi berakhir
const ok3 = await prisma.$transaction(async (tx) => { await kunciEvaluasiCatatan(tx); await kunciEvaluasiCatatan(tx); return true; }, { timeout: 30_000 }).catch((e) => String(e.message).slice(0, 160));
cek("kunci evaluasi advisory dapat diambil dua kali dalam satu transaksi (re-entrant) lalu dilepas", ok3 === true, ok3);
cek("tidak ada kunci advisory tersisa setelah transaksi", (await hitung("select count(*)::int n from pg_locks where locktype = 'advisory' and granted and pid <> pg_backend_pid() and database = (select oid from pg_database where datname = current_database())")) === 0);

// 4) tidak ada tulisan: jumlah baris tabel kunci tidak berubah
const n1 = await hitung("select count(*)::int n from unit_usage_notes");
cek("pemeriksaan tidak menulis (jumlah catatan sama)", n0 === n1, `${n0} → ${n1}`);
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
await prisma.$disconnect();
process.exit(gagal ? 1 : 0);
REHNODE
ok "kode baru terhadap data restore: $(tail -n 1 "$BK_DIR/rehearsal-kode-baru.log"); $(grep -c '^PASS' "$BK_DIR/rehearsal-kode-baru.log") pemeriksaan lulus"
RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sesudah.txt" || { reh_drop; die "sidik jari penuh sesudah gagal"; }
cmp -s "$BK_DIR/fp-all-sebelum.txt" "$BK_DIR/fp-all-sesudah.txt" || { diff "$BK_DIR/fp-all-sebelum.txt" "$BK_DIR/fp-all-sesudah.txt" || true; reh_drop; die "pemeriksaan kode baru MENGUBAH isi tabel (harus baca-saja)"; }
ok "audit baca-saja lulus: isi $(printf '%s\n' "$TABEL_LAMA" | grep -c .) tabel IDENTIK sebelum vs sesudah"
# SIMULASI TULIS — HANYA di DB rehearsal (salinan restore; dihapus sesudahnya). Pustaka menolak jalan bila nama DB bukan rehearsal_evl_*. Production tidak tersentuh.
"${RUNNER[@]}" <<'SIMNODE' > "$BK_DIR/simulasi-evaluasi.log" 2>&1 || { cat "$BK_DIR/simulasi-evaluasi.log"; reh_drop; die "simulasi posting bersamaan terhadap data restore GAGAL"; }
// SIMULASI TULIS pada DB REHEARSAL (salinan restore backup nyata; DIHAPUS sesudahnya) — BUKAN production. Dijalankan skrip rilis SETELAH sidik jari baca-saja lulus.
// Membuktikan, dengan data nyata: posting beberapa unit secara bersamaan + klik ganda + pembaca yang mengaudit setiap potret konsisten → tidak pernah ada keadaan palsu, tidak ada deadlock, hasil titik tetap,
// satu pergerakan per transaksi, jurnal/GL tidak berubah (jurnalHPP=false). Pagar keras: menolak jalan bila bukan DB bernama rehearsal_evl_*.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { periksaKeadaanCatatan, ambilCatatanHistoris, tungguPenyegaran } = await import("/app/src/services/catatanPemakaianHistoris.js");
const { postStockMovement } = await import("/app/src/services/inventoryLedger.js");
const { ajukanBatch, jalankanBatch, statusBatch } = await import("/app/src/services/postingBatchLatar.js");
const { rencanakanPosting, jalankanPosting } = await import("/app/src/services/postingPemakaianHistoris.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 260) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const dbNama = (await prisma.$queryRawUnsafe("select current_database() n"))[0].n;
if (!/^rehearsal_evl_\d+_\d+$/.test(dbNama)) { console.log("FAIL pagar: simulasi tulis HANYA di DB rehearsal_evl_* (ini: " + dbNama + ")"); console.log("SIMULASI_EVALUASI gagal=1"); process.exit(1); }

const admin = (await prisma.$queryRawUnsafe(`select id from "User" where email = 'admin@klinikmatras.com' limit 1`))[0];
cek("akun Admin impor ada di data restore (aktor posting)", !!admin);
const S = async () => ({
  gerak: await hitung("select count(*)::int n from stock_movements"), jurnal: await hitung("select count(*)::int n from fin_journal_entries"),
  gl1400: Number((await prisma.$queryRawUnsafe(`select coalesce(sum(l.debit - l.credit),0)::float n from fin_journal_lines l join fin_accounts a on a.id = l.account_id where a.code = '1-1400'`))[0].n),
  negatif: await hitung("select count(*)::int n from (select material_id from stock_movements group by 1 having sum(qty) < -0.0001) x"),
  siap: await hitung("select count(*)::int n from unit_usage_notes where state = 'SIAP_POSTING'"),
});
const plan0 = await rencanakanPosting(prisma);
const unitKandidat = [...new Set(plan0.transaksi.map((t) => t.unitId))].slice(0, 3);
cek("ada minimal 2 unit siap posting untuk disimulasikan", unitKandidat.length >= 2, unitKandidat.length);
const A = unitKandidat.slice(0, 1); const B = unitKandidat.slice(1, 3);
const pA = await rencanakanPosting(prisma, { unitIds: A }); const pB = await rencanakanPosting(prisma, { unitIds: B });
const s0 = await S();
let jalan = true; let potret = 0; let palsu = 0; let galatPembaca = 0;
const pembaca = (async () => { while (jalan) { try { const r = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 }); potret++; palsu += r.berubah; } catch { galatPembaca++; } } })();
const P = (hash, unitIds) => jalankanPosting(prisma, { persetujuan: { hashDisetujui: hash, rujukan: "REHEARSAL-SANDBOX-bukan-production", disetujuiOleh: "simulasi rilis" }, aktor: { id: admin.id }, unitIds });
const r = await Promise.allSettled([P(pA.hash, A), P(pB.hash, B), P(pA.hash, A)]);
jalan = false; await pembaca;
cek("tiga pemanggilan serentak (dua proses + klik ganda) semuanya selesai tanpa galat/deadlock", r.every((x) => x.status === "fulfilled" && x.value.gagal.length === 0), JSON.stringify(r.map((x) => x.status === "fulfilled" ? [x.value.diposting.length, x.value.dilewati.length, x.value.gagal.length] : String(x.reason?.message).slice(0, 80))));
const dipostingTotal = r.filter((x) => x.status === "fulfilled").reduce((n, x) => n + x.value.diposting.length, 0);
cek("setiap transaksi rencana diposting TEPAT SEKALI (klik ganda tidak menggandakan)", dipostingTotal === pA.jumlah + pB.jumlah, `${dipostingTotal} vs ${pA.jumlah + pB.jumlah}`);
cek("pembaca serentak mengaudit potret konsisten dan TIDAK menemukan keadaan palsu", potret > 0 && palsu === 0 && galatPembaca === 0, `potret=${potret} palsu=${palsu} galatPembaca=${galatPembaca}`);
const akhir = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 });
cek("keadaan akhir = titik tetap (evaluasi global tidak punya apa pun untuk diubah)", akhir.berubah === 0, `berubah=${akhir.berubah}`);
const s1 = await S();
cek("pergerakan stok bertambah tepat sebanyak transaksi", s1.gerak === s0.gerak + pA.jumlah + pB.jumlah, `${s0.gerak} → ${s1.gerak}`);
cek("jurnal dan GL 1-1400 TIDAK berubah (kuantitas dulu, tanpa jurnal HPP)", s1.jurnal === s0.jurnal && s1.gl1400 === s0.gl1400, `jurnal ${s0.jurnal}→${s1.jurnal}; GL ${s0.gl1400}→${s1.gl1400}`);
cek("tidak ada bahan baru yang menjadi negatif", s1.negatif <= s0.negatif, `${s0.negatif} → ${s1.negatif}`);
const rb = await rencanakanPosting(prisma);
cek("rencana berikutnya = rencana awal dikurangi yang sudah diposting (tidak memuat transaksi palsu)", rb.jumlah === plan0.jumlah - pA.jumlah - pB.jumlah, `${plan0.jumlah} → ${rb.jumlah}`);

// ── B. saldo diubah DI LUAR modul catatan (pengeluaran stok biasa lewat ledger inti): pembaca langsung sesudah commit tidak boleh melihat SIAP_POSTING basi; UI = mesin; tersimpan menyusul tanpa evaluasi manual ──
const sisa = await rencanakanPosting(prisma);
const perBahan = new Map(); for (const t of sisa.transaksi) perBahan.set(t.materialId, (perBahan.get(t.materialId) ?? 0) + 1);
const bahanUji = [...perBahan].sort((a, b) => b[1] - a[1])[0]?.[0];
const saldoBahan = bahanUji ? Number((await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float s from stock_movements where material_id = $1::uuid", bahanUji))[0].s) : 0;
cek("ada bahan dengan saldo positif dan transaksi siap untuk uji perubahan di luar modul", !!bahanUji && saldoBahan > 0, bahanUji + " saldo " + saldoBahan);
if (bahanUji && saldoBahan > 0) {
  const trxBahan = sisa.transaksi.filter((t) => t.materialId === bahanUji);
  await prisma.$transaction((tx) => postStockMovement(tx, { materialId: bahanUji, type: "ISSUE", qty: -saldoBahan, note: "simulasi: pengeluaran biasa di luar modul catatan", createdById: admin.id }), { timeout: 60_000 });
  const rencanaSetelah = await rencanakanPosting(prisma);
  cek("rencana mesin langsung sesudah commit TIDAK memuat transaksi bahan yang saldonya dihabiskan pengeluaran biasa", !rencanaSetelah.transaksi.some((t) => t.materialId === bahanUji), trxBahan.length + " trx sebelum");
  const tampil = await ambilCatatanHistoris(prisma, trxBahan[0].unitId);
  cek("tampilan unit (yang dilihat pengguna) langsung benar: tidak ada catatan bahan itu yang SIAP_POSTING", !tampil.items.some((i) => i.bahan?.id === bahanUji && i.origin === "EXCEL" && i.state === "SIAP_POSTING"), tampil.items.filter((i) => i.bahan?.id === bahanUji).map((i) => i.state).join(","));
  await tungguPenyegaran();
  const a2 = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 });
  cek("keadaan TERSIMPAN menyusul tanpa evaluasi global manual (titik tetap)", a2.berubah === 0, "berubah=" + a2.berubah);
}
// ── C. batch di latar atas sebagian rencana: progres, selesai, tanpa pergerakan ganda, titik tetap ──
const semuaSisa = await rencanakanPosting(prisma);
const unitBatch = [...new Set(semuaSisa.transaksi.map((t) => t.unitId))].slice(0, 8);
const rencanaBatch = unitBatch.length ? await rencanakanPosting(prisma, { unitIds: unitBatch }) : { jumlah: 0 };
if (rencanaBatch.jumlah) {
  const setuju = { hashDisetujui: rencanaBatch.hash, rujukan: "REHEARSAL-SANDBOX-bukan-production", disetujuiOleh: "simulasi rilis" };
  const bt = await ajukanBatch(prisma, { persetujuan: setuju, aktor: { id: admin.id }, unitIds: unitBatch });
  cek("mengajukan batch tidak memposting apa pun dan idempoten (batchId = hash rencana)", bt.baru === true && bt.status === "MENUNGGU" && bt.batchId === rencanaBatch.hash);
  const gerakSblm = await hitung("select count(*)::int n from stock_movements"); const prog = [];
  const rb = await jalankanBatch(prisma, bt.batchId, { setelahUnit: async () => { prog.push((await statusBatch(prisma, bt.batchId)).unitSelesai); } });
  const sb = await statusBatch(prisma, bt.batchId);
  cek("batch selesai di latar dengan progres naik per unit", ["SELESAI", "SELESAI_SEBAGIAN"].includes(rb.status) && prog.length === bt.totalUnit && prog.every((v, i) => v === i + 1), rb.status + "; progres " + prog.join(","));
  const ulang = await jalankanBatch(prisma, bt.batchId); const ajukanLagi = await ajukanBatch(prisma, { persetujuan: setuju, aktor: { id: admin.id }, unitIds: unitBatch });
  cek("jalankan ulang batch yang sama = nol tulisan; ajukan ulang = batch yang sama", ulang.dijalankan === false && ajukanLagi.baru === false);
  const gerakKini = await hitung("select count(*)::int n from stock_movements");
  cek("pergerakan bertambah tepat sebanyak transaksi yang diposting (tanpa ganda)", gerakKini - gerakSblm === sb.transaksiDiposting, "+" + (gerakKini - gerakSblm) + " vs " + sb.transaksiDiposting);
  await tungguPenyegaran();
  const a3 = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 });
  cek("titik tetap sesudah batch", a3.berubah === 0, "berubah=" + a3.berubah);
  const s2 = await S(); cek("jurnal dan GL 1-1400 tetap sesudah batch", s2.jurnal === s0.jurnal && s2.gl1400 === s0.gl1400);
}
console.log("SIMULASI_EVALUASI gagal=" + gagal);
await prisma.$disconnect();
process.exit(gagal ? 1 : 0);
SIMNODE
ok "simulasi tulis pada salinan: $(tail -n 1 "$BK_DIR/simulasi-evaluasi.log"); $(grep -c '^PASS' "$BK_DIR/simulasi-evaluasi.log") pemeriksaan lulus (posting bersamaan, klik ganda, pembaca mengaudit potret, titik tetap, jurnal/GL tetap)"
reh_drop
ok "DB rehearsal (yang ditulis simulasi) dihapus; production tidak pernah dihubungkan"
}

# Bukti rehearsal: rilis penuh WAJIB didahului --rehearsal-penuh yang LULUS untuk SHA + baseline yang sama (<36 jam).
MARK="$HOME/release-backups/.rehearsal-penuh-ok-evaluasi-catatan-${DEPLOY_SHA}"
if [ "$REHEARSAL_PENUH" = "0" ]; then
  [ -f "$MARK" ] || die "belum ada bukti --rehearsal-penuh LULUS untuk SHA ${DEPLOY_SHORT}: jalankan --rehearsal-penuh dulu"
  grep -qx "BASE=${BASE_SHA}" "$MARK" && grep -qx "DEPLOY=${DEPLOY_SHA}" "$MARK" || die "bukti rehearsal-penuh bukan untuk SHA/baseline ini — ulangi terhadap baseline live saat ini"
  [ -n "$(find "$MARK" -mmin -2160 2>/dev/null)" ] || die "bukti rehearsal-penuh lebih dari 36 jam — ulangi terhadap data production terbaru"
  ok "bukti --rehearsal-penuh LULUS untuk SHA ${DEPLOY_SHORT} + baseline ${BASE_SHA:0:8}"
fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-evl-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

if [ "$REHEARSAL_PENUH" = "1" ]; then
  PHASE="3c-rehearsal-penuh"; say "3c. REHEARSAL PENUH: image kandidat bertag rehearsal (tag production tidak disentuh), restore backup NYATA, kode BARU baca-saja pada data restore — production TIDAK diubah selain backup dan DB sementara"
  WS="$HOME/release-rehearsal/evl-${DEPLOY_SHORT}-${TS}"; REH_IMG="${IMG_NAME%%:*}:rehearsal-evl-${DEPLOY_SHORT}"
  NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" | awk '{print $1}')"; [ -n "$NET" ] || die "jaringan docker postgres tidak terbaca"
  [ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
  mkdir -p "$WS" || die "gagal membuat ${WS}"
  sg archive "$DEPLOY_SHA" | tar -x -C "$WS" --exclude='frontend/dist' || die "git archive gagal"
  [ ! -e "$WS/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
  for f in backend/Dockerfile backend/package.json; do [ -f "$WS/$f" ] || die "direktori kerja tidak lengkap: $f"; done
  docker build -t "$REH_IMG" -f "$WS/backend/Dockerfile" "$WS/backend" > "$BK_DIR/build-rehearsal.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build-rehearsal.log"; die "build image rehearsal gagal (production tidak berubah)"; }
  RH_IMG_ID="$(docker image inspect -f '{{.Id}}' "$REH_IMG")"; [ "$RH_IMG_ID" != "$PREV_IMG_ID" ] || die "image rehearsal identik dengan live"
  [ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag image PRODUCTION berubah selama build — berhenti"
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
  ok "image rehearsal $REH_IMG (${RH_IMG_ID:7:12}); tag production ${IMG_NAME} tetap ${PREV_IMG_ID:7:12}; container aktif tidak tersentuh"
  PHASE="5b-rehearsal-kode"; say "5b. Kode BARU terhadap restore backup NYATA (baca-saja)"
  rehearsal_kode
  cleanup_penuh
  PHASE="3d-production-tidak-berubah"; say "3d. Verifikasi production TIDAK berubah oleh rehearsal"
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] && [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] && [ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "0" ] && [ "$(docker inspect -f '{{.State.Running}}' "$CID_OLD")" = "true" ] || die "container production berubah"
  [ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag image production bergeser"
  curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal setelah rehearsal gagal"
  psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sesudah-rehearsal.txt"
  cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sesudah-rehearsal.txt" || die "daftar migrasi production berubah selama rehearsal"
  psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sesudah-rehearsal.txt" || die "sidik jari beku production sesudah rehearsal gagal"
  diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" || true; die "dokumen pembanding production BERUBAH selama rehearsal"; }
  [ "$(psql_live -At -c "select count(*) from pg_database where datname like 'rehearsal_evl_%'")" = "0" ] || die "DB rehearsal masih tersisa di server"
  [ ! -e "$WS" ] || die "direktori kerja rehearsal masih ada"
  [ -z "$(docker images -q "$REH_IMG")" ] || die "image rehearsal masih ada"
  ok "production TIDAK berubah: container/image/release sama, 0 restart, migrasi sama (${LIVE_MIG_JUMLAH}), ${FPB_N} kelompok dokumen pembanding identik, DB rehearsal + direktori kerja + image rehearsal sudah dihapus; satu-satunya jejak: backup ${BACKUP_FILE}"
  trap - EXIT
  printf 'BASE=%s\nDEPLOY=%s\nTS=%s\n' "$BASE_SHA" "$DEPLOY_SHA" "$TS" > "$MARK"
  say "REHEARSAL PENUH SELESAI — production TIDAK diubah, tidak ada deploy, tidak ada jadwal/Run/pesan dibuat di production. Backup: ${BACKUP_FILE}. Log: ${BK_DIR}/release.log"
  exit 0
fi

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-evl-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal-kode"; say "5b. Kode BARU terhadap restore backup NYATA: audit baca-saja (keadaan production = titik tetap; isi semua tabel IDENTIK) lalu simulasi tulis pada salinan; DB sementara dihapus"
rehearsal_kode

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
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: keadaan catatan production = titik tetap; Ringkasan unit konsisten; smoke tidak menulis"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
// Smoke BACA-SAJA rilis "evaluasi catatan pemakaian historis: global + atomik" terhadap backend yang SUDAH melayani (container baru). TIDAK memposting, mengoreksi, mengevaluasi-ulang-dengan-tulisan, atau menyentuh stok/jurnal.
// Hanya: audit kering (potret konsisten RepeatableRead; tanpa kunci; tanpa tulisan), GET Ringkasan catatan unit, hitungan tabel sebelum vs sesudah.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const { periksaKeadaanCatatan } = await import("/app/src/services/catatanPemakaianHistoris.js");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 300) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(method, path, token) {
  const r = await fetch(BASE + path, { method, headers: token ? { Authorization: "Bearer " + token } : {} });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TULIS = {
  catatan: "select count(*)::int n from unit_usage_notes", peristiwa: "select count(*)::int n from unit_usage_note_events", sm: "select count(*)::int n from stock_movements", jur: "select count(*)::int n from fin_journal_entries",
  val: "select count(*)::int n from fin_stock_movement_valuations", kor: "select count(*)::int n from warehouse_corrections", act: "select count(*)::int n from activity_events", job: "select count(*)::int n from jobs",
};
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);
const stateAwal = JSON.stringify(await prisma.$queryRawUnsafe("select state, count(*)::int n from unit_usage_notes group by 1 order by 1"));

rec("health publik sehat", (await api("GET", "/api/health", null)).json?.ok === true);
const dbNama = (await prisma.$queryRawUnsafe("select current_database() n"))[0].n;
rec("smoke berjalan pada DB production (bukan DB rehearsal)", !/^rehearsal_/.test(dbNama), dbNama);

// 1) audit kering: keadaan production = titik tetap menurut kode yang sedang melayani
const a = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 });
rec("keadaan catatan production = titik tetap (evaluasi global tidak punya apa pun untuk diubah)", a.berubah === 0, `berubah=${a.berubah} diperiksa=${a.diperiksa} ${JSON.stringify((a.detail ?? []).slice(0, 2))}`);

// 2) GET Ringkasan catatan satu unit yang punya catatan SIAP_POSTING (tampilan yang dibaca pengguna)
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const admin = aktif.find((u) => peran.get(u.id).includes("ADMIN") && punya(peran.get(u.id), P.UNIT_READ));
const unit = (await prisma.$queryRawUnsafe("select unit_id from unit_usage_notes where state = 'SIAP_POSTING' and unit_id is not null limit 1"))[0];
if (!admin || !unit) skip("GET catatan historis satu unit", !admin ? "tidak ada akun ADMIN aktif dengan izin baca Unit" : "tidak ada catatan SIAP_POSTING");
else {
  const token = jwt.sign({ id: admin.id, name: admin.name, role: admin.role, roles: peran.get(admin.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const r = await api("GET", `/api/production/units/${unit.unit_id}/adopsi`, token);
  rec("Ringkasan unit memuat catatan historis dengan keadaan yang sama dengan database", r.status === 200 && Number(r.json?.catatanHistoris?.ringkas?.siapPosting ?? r.json?.adopsi?.catatanHistoris?.ringkas?.siapPosting ?? -1) === Number((await prisma.$queryRawUnsafe(`select count(*)::int n from unit_usage_notes where unit_id = '${unit.unit_id}' and state = 'SIAP_POSTING'`))[0].n), `status=${r.status}`);
}

// 3) tidak ada tulisan sama sekali oleh smoke ini
const akhir = {}; for (const [k, q] of Object.entries(TULIS)) akhir[k] = await hitung(q);
// Pengguna sah boleh bekerja selama smoke: perbedaan dilaporkan sebagai SKIP (bukan lulus palsu, bukan gagal palsu); smoke ini sendiri tidak punya satu pun jalur tulis.
for (const k of ["catatan", "peristiwa", "sm", "jur", "val", "kor"]) { if (akhir[k] === awal[k]) rec(`tabel ${k} tidak berubah oleh smoke`, true, `${awal[k]}`); else skip(`tabel ${k} tidak berubah oleh smoke`, `${awal[k]} → ${akhir[k]} (aktivitas pengguna sah selama smoke; smoke tidak menulis)`); }
{ const st = JSON.stringify(await prisma.$queryRawUnsafe("select state, count(*)::int n from unit_usage_notes group by 1 order by 1")); if (st === stateAwal) rec("distribusi keadaan catatan tidak berubah oleh smoke", true); else skip("distribusi keadaan catatan tidak berubah oleh smoke", "berubah selama smoke (aktivitas pengguna sah)"); }
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
await prisma.$disconnect();
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
[ "$(PSQLN "select count(*) from stock_movements where note like 'Impor pemakaian historis Sep%'")" = "$MV_HIST_N" ] || die "pergerakan hasil posting historis berubah selama rilis — rilis ini TIDAK boleh memposting"
[ "$(PSQLN "select count(*) from unit_usage_notes where state = 'DIPOSTING'")" = "$CAT_POST_N" ] || die "jumlah catatan DIPOSTING berubah selama rilis — rilis ini TIDAK boleh memposting"
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
say "CATATAN: rilis ini kode-saja (tanpa migrasi, tanpa perubahan data, tanpa frontend, tanpa posting). Setelah SELESAI: posting 1 unit (A-DIDUKUNG) dan 21 transaksi GR-091026-03 TETAP butuh persetujuan Owner terpisah; JANGAN memposting/mengoreksi sebagai uji di production."
