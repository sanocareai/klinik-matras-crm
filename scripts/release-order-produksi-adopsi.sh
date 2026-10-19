#!/usr/bin/env bash
# RILIS "ORDER PRODUKSI ADOPSI ADMIN" — BACKEND + WEB + 1 MIGRASI ADITIF (3 tabel baru kosong: status kerja manual, rencana bahan, riwayat revisi rencana). FAIL-CLOSED. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA).
#   Kode: tiga sumbu status di Order Produksi (status order · posisi unit · status kerja), Admin boleh mencatat status kerja TANPA aplikasi Meja (ditolak bila bukti aplikasi ada), rencana bahan per kelompok Gudang
#   (tidak mengurangi stok) terpisah dari pemakaian aktual (transaksi stok resmi, kini idempoten), ekspor Excel .xlsx, panel fokus + daftar baru. Status order diubah lewat jalur Sales/Delivery yang SAMA (tidak ada jalur baru).
#   Migrasi: 3 CREATE TABLE baru (kosong) + 3 indeks + 3 FK ON DELETE RESTRICT + fungsi/trigger append-only pada 2 tabel baru. Tidak ada ALTER TABLE pada tabel lama, tidak ada backfill, tidak ada perubahan data lama.
#   Produksi: rilis ini TIDAK membuat status kerja, rencana, pemakaian bahan, stok, jurnal, job, Run, atau QC; smoke hanya baca + penolakan sebelum menyentuh data.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, pin sha256 migrasi, pemindai DDL + mutan negatif, tepat 1 migrasi pending) → (2) audit produksi baca-saja + sidik jari → (3) backup + restore nyata
#              → (4) build web + image → (5) REHEARSAL (restore nyata, migrasi dengan image baru, uji constraint/trigger/FK, kode baru terhadap data restore, sidik jari sebelum=sesudah)
#              → (6) migrate deploy produksi SATU kali (backend lama tetap melayani) → (7) switch → (8) verifikasi + smoke baca-saja.
#
#   cat scripts/release-order-produksi-adopsi.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/opa.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/opa.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah (tanpa backup, tanpa DB sementara)
#   ssh ubuntu@43.133.152.6 'bash /tmp/opa.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only'      # backup NYATA + restore ke DB sementara + migrasi (SQL dari git) + uji; TANPA build/release dir/migrasi produksi
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/opa.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-penuh > /tmp/opa.out 2>&1 < /dev/null &'   # build web + image BERTAG REHEARSAL, restore nyata, migrasi, smoke, skenario pada klon, TES INTEGRASI terarah (Postgres sekali-pakai), guard rollback; production TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/opa.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/opa.out 2>&1 < /dev/null &'                    # rilis penuh: WAJIB ada bukti --rehearsal-penuh LULUS untuk SHA + baseline yang sama (<36 jam)
#
# ROLLBACK KODE: aman kapan saja (kode lama tidak membaca tabel baru). Periksa dulu dengan scripts/rollback-guard-order-produksi-adopsi.sh (baca-saja; hanya mencetak jumlah data adopsi). Rollback kode TIDAK menghapus tabel/riwayat;
#   yang hilang hanya tampilan status kerja manual dan rencana bahan. Pemakaian aktual adalah transaksi stok biasa dan tetap berlaku.
# (dibangkitkan oleh scripts/gen-release-order-produksi-adopsi.cjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang; templat sha256 a26b6f1d6d0a…)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/order-produksi-adopsi-admin}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261221090000_production_adopsi_admin:b4285f928e994bbdcdf740391a5d4575039e1a1fdd828f556909ac4a0e08cf98"
# Hasil pemindai DDL untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":12,"create_table":3,"index":3,"fk":3,"fungsi":1,"trigger":2}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index dan tanpa nomor baris hunk) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="e7b3c3daef77bf566bc5f672d121d6b204bc73f574dba52c2c2ac2816dd300ef"
# Migrasi live terakhir yang HARUS sudah terpasang di produksi dan ada di kandidat (Produksi: admin override siap kirim). Bila lebih baru muncul di produksi, gabungkan baseline terbaru dulu.
LIVE_MIG_TERAKHIR="20261220090000_gudang_koreksi_dokumen"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard rollback). Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261221090000_production_adopsi_admin/migration\.sql|backend/prisma/schema\.prisma|backend/scripts/production-delivery-v2/audit-production-experience-writers\.js|backend/src/index\.js|backend/src/lib/activityLog\.js|backend/src/lib/domain/productionMaterialPlan\.js|backend/src/lib/domain/productionWorkStatus\.js|backend/src/routes/orders\.js|backend/src/routes/production\.js|backend/src/routes/productionAdopsi\.js|backend/src/routes/units\.js|backend/src/services/productionAdoptionService\.js|backend/src/services/productionOrderExport\.js|backend/src/services/productionOrderList\.js|backend/src/services/productionSettingsService\.js|backend/tests/integration/productionAdopsi\.integration\.test\.js|backend/tests/integration/setup/testApp\.js|backend/tests/integration/setup/testDb\.js|backend/tests/productionExperience\.test\.js|backend/tests/productionWorkStatus\.test\.js|backend/tests/releaseKoreksiGudang\.test\.js|backend/tests/releaseOrderProduksiAdopsi\.test\.js|backend/tests/workshopMilestone\.test\.js|frontend/src/api\.js|frontend/src/features/bengkel/unitStatus\.js|frontend/src/features/production/MaterialPlanEditor\.jsx|frontend/src/features/production/OrderProduksiPanel\.jsx|frontend/src/features/production/UnitOrderFallback\.jsx|frontend/src/features/production/orderProduksiModel\.js|frontend/src/features/production/unitOrderFallbackModel\.js|frontend/src/pages/bengkel/ProductionWorkOrders\.jsx|frontend/tests/orderProduksiAdopsi\.test\.js|frontend/tests/orderProduksiDirectList\.test\.js|frontend/tests/productionSidebarConsolidation\.test\.js|frontend/tests/unitV1Actions\.test\.js|frontend/tests/workshopMilestoneLabels\.test\.js|scripts/gen-release-order-produksi-adopsi\.cjs|scripts/lib/rehearsal-kode-lama-order-produksi-adopsi\.mjs|scripts/lib/rehearsal-kode-order-produksi-adopsi\.mjs|scripts/lib/rehearsal-skenario-order-produksi-adopsi\.mjs|scripts/lib/scan-migrasi-order-produksi-adopsi\.mjs|scripts/lib/smoke-order-produksi-adopsi\.mjs|scripts/release-order-produksi-adopsi\.sh|scripts/rollback-guard-order-produksi-adopsi\.sh|scripts/templates/release-order-produksi-adopsi\.sh\.tpl)$'
BACKEND_SRC_EXPECT="backend/src/index.js backend/src/lib/activityLog.js backend/src/lib/domain/productionMaterialPlan.js backend/src/lib/domain/productionWorkStatus.js backend/src/routes/orders.js backend/src/routes/production.js backend/src/routes/productionAdopsi.js backend/src/routes/units.js backend/src/services/productionAdoptionService.js backend/src/services/productionOrderExport.js backend/src/services/productionOrderList.js backend/src/services/productionSettingsService.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/bengkel/unitStatus.js frontend/src/features/production/MaterialPlanEditor.jsx frontend/src/features/production/OrderProduksiPanel.jsx frontend/src/features/production/UnitOrderFallback.jsx frontend/src/features/production/orderProduksiModel.js frontend/src/features/production/unitOrderFallbackModel.js frontend/src/pages/bengkel/ProductionWorkOrders.jsx"
# Berkas pelindung: identik dengan baseline (rilis ini tidak menyentuhnya).
GUARD_UNCHANGED="backend/src/services/inventoryLedger.js backend/src/services/stokLokasi.js backend/src/constants/kelompokBahan.js backend/src/services/statusUnitLintasWorkspace.js backend/src/services/finance/journal.js backend/src/middleware/authorize.js backend/src/middleware/auth.js backend/src/constants/permissions.js backend/src/routes/stockCount.js backend/src/services/adminOverrideSwitch.js backend/src/services/deliveryOverrideAdmin.js backend/src/services/productionStepCommandService.js backend/src/services/finance/kedatangan.js"
# Tes integrasi terarah (Produksi, unit, workshop, PKR/Sales, Gudang, Delivery) yang dijalankan di rehearsal-penuh pada Postgres sekali-pakai: berkas pinned + jumlah tes yang HARUS lulus semuanya.
TES_FILES="tests/integration/deliveryCrossBoundaryV2.integration.test.js tests/integration/deliveryUnitLoadGate.integration.test.js tests/integration/gudangKoreksi.integration.test.js tests/integration/gudangPusatKerja.integration.test.js tests/integration/gudangStatusMundur.integration.test.js tests/integration/penjualanKaryawanOrderCrm.integration.test.js tests/integration/penjualanKaryawanOrderCrmFinal.integration.test.js tests/integration/pkrCustomerAktual.integration.test.js tests/integration/pkrEditProgres.integration.test.js tests/integration/pkrItemInvarian.integration.test.js tests/integration/pkrItemTerpadu.integration.test.js tests/integration/pkrKoreksiOrder.integration.test.js tests/integration/pkrLeadSourceNull.integration.test.js tests/integration/pkrMultiItem.integration.test.js tests/integration/pkrPembatalan.integration.test.js tests/integration/pkrRuteTransisi.integration.test.js tests/integration/pkrUnitCrmBaris.integration.test.js tests/integration/productionAdaptationSlice2.integration.test.js tests/integration/productionAdopsi.integration.test.js tests/integration/productionBuildTrack.integration.test.js tests/integration/productionCommandCenter.integration.test.js tests/integration/productionComponentNotes.integration.test.js tests/integration/productionComponentPermissions.integration.test.js tests/integration/productionDiagnosis.integration.test.js tests/integration/productionDocumentation.integration.test.js tests/integration/productionExperience.integration.test.js tests/integration/productionMaterialIssue.integration.test.js tests/integration/productionOneLocationIntake.integration.test.js tests/integration/productionPlanStationPicTarget.integration.test.js tests/integration/productionPlanning.integration.test.js tests/integration/productionPreTeardown.integration.test.js tests/integration/productionQcFinishedGoods.integration.test.js tests/integration/productionQcPermissionMatrix.integration.test.js tests/integration/productionReporting.integration.test.js tests/integration/productionReturnQueueReorder.integration.test.js tests/integration/productionSimplifikasiSlice1.integration.test.js tests/integration/productionTargets.integration.test.js tests/integration/productionUnitOverview.integration.test.js tests/integration/productionUnitPhoto.integration.test.js tests/integration/productionWorkshopExecution.integration.test.js tests/integration/stokAdjustmentSegregasi.integration.test.js tests/integration/stokIdentitasPemeriksa.integration.test.js tests/integration/stokImporFile.integration.test.js tests/integration/stokJalurCepatSesiHitung.integration.test.js tests/integration/stokPenyesuaianAlurUI.integration.test.js tests/integration/stokRekonCatatan.integration.test.js tests/integration/stokRekonRiwayat.integration.test.js tests/integration/stokRekonsiliasi.integration.test.js tests/integration/stokResmi.integration.test.js tests/integration/stokResmiReleaseSmoke.integration.test.js tests/integration/stokRiwayatReferensi.integration.test.js tests/integration/stokSesiHitungPergerakan.integration.test.js tests/integration/unitCustodyContinuation.integration.test.js tests/integration/unitCustodyInbound.integration.test.js tests/integration/unitRevisionJobLink.integration.test.js tests/integration/unitTimelineSalesContext.integration.test.js tests/integration/unitV1Actions.integration.test.js tests/integration/unitV2Ownership.integration.test.js tests/integration/workshopMilestone.integration.test.js"
TES_N_EXPECT="578"
# Commit Produksi (admin override siap kirim), Riwayat Referensi, dan bukti serah yang sudah live: HARUS leluhur kandidat (rilis tidak boleh menghilangkannya).
LIVE_ANCESTORS="799d3e93de192c604a14f1c11fe7436538689bb0 56b87721f84c1d16a2cd1655e40787e2b626cb0f e5a32cd246b2233e9d05d9b2cbff733e4497725d e47f37e2d6690130525681863ff467682e30f3c4 57198ad687045519a12af14a3097ccf6b61e9054 cb33a07d4dc61652867960fdf6c528647f350611"
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
REHEARSAL_ONLY=0
REHEARSAL_PENUH=0
TAHAN_UI=0
CAND_DIR="$NEW_DIR"   # sumber kode kandidat untuk rehearsal: release dir (rilis penuh) atau direktori kerja sementara (--rehearsal-penuh)
for a in "$@"; do
  [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; [ "$a" = "--rehearsal-only" ] && REHEARSAL_ONLY=1; [ "$a" = "--rehearsal-penuh" ] && REHEARSAL_PENUH=1
  case "$a" in --tahan-ui=*) TAHAN_UI="${a#--tahan-ui=}";; esac
done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/order-produksi-adopsi-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  \033[33mPERHATIAN\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }

[ "$((PREFLIGHT_ONLY + REHEARSAL_ONLY + REHEARSAL_PENUH))" -le 1 ] || die "pilih SATU mode saja (--preflight-only | --rehearsal-only | --rehearsal-penuh)"
[[ "$TAHAN_UI" =~ ^[0-9]+$ ]] || die "--tahan-ui=MENIT harus angka"
[ "$TAHAN_UI" = "0" ] || [ "$REHEARSAL_PENUH" = "1" ] || die "--tahan-ui hanya bersama --rehearsal-penuh"
WS=""; REH_IMG=""; REH_DB=""; NET=""
# Pembersih --rehearsal-penuh (dipanggil di trap EXIT, juga saat gagal): hapus container UI, direktori kerja, image bertag rehearsal (SATU tag itu saja), dan DB sementara bernama rehearsal_opa_test_*. TIDAK menyentuh production.
cleanup_penuh() {
  [ "$REHEARSAL_PENUH" = "1" ] || return 0
  docker rm -f "rh-opa-pg-${TS}" >/dev/null 2>&1 || true
  if [ -n "${PREV_DIR:-}" ]; then dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"rehearsal_opa_test_klon_${TS}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; fi
  if [ -n "${WS:-}" ] && [[ "$WS" == "$HOME/release-rehearsal/opa-"* ]]; then rm -rf -- "$WS" 2>/dev/null || sudo -n rm -rf -- "$WS" 2>/dev/null || true; fi
  if [ -n "${REH_IMG:-}" ] && [[ "$REH_IMG" == *":rehearsal-opa-"* ]]; then docker rmi "$REH_IMG" >/dev/null 2>&1 || true; fi
  if [[ "${REH_DB:-}" =~ ^rehearsal_opa_test_image_[0-9_]+$ ]] && [ -n "${PREV_DIR:-}" ]; then dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; fi
  return 0
}

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa)
Image sebelumnya   : ${ROLLBACK_TAG:-<belum ditandai>}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.
LANGKAH sebelum rollback KODE setelah switch: jalankan GUARD (baca-saja; informasi saja, tidak menolak)
   bash ${NEW_DIR}/scripts/rollback-guard-order-produksi-adopsi.sh
Rollback kode (TIDAK menghapus tabel adopsi, catatan status kerja, rencana bahan, maupun pergerakan stok pemakaian aktual):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi bersifat ADITIF (3 tabel baru kosong + 3 indeks + 3 FK + trigger append-only): dibiarkan terpasang pun aman bagi kode lama (kode lama tidak membacanya). Catatan di tabel baru tetap tersimpan tetapi tidak tampil setelah rollback.
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS semua perubahan sesudah backup (status kerja, rencana, transaksi stok); gunakan hanya atas keputusan Owner.
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && [ "$REHEARSAL_PENUH" = "0" ] && rollback_instructions; cleanup_penuh; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-order-produksi-adopsi.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "opa\.sh\|release-order-produksi-adopsi\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
if [ "$PREFLIGHT_ONLY" = "0" ] && [ "$REHEARSAL_ONLY" = "0" ] && [ "$REHEARSAL_PENUH" = "0" ]; then [ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"; fi

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, pin migrasi, pemindai DDL (+ uji negatif pemindai)"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" "+refs/heads/main:refs/remotes/origin/main" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
# MAIN_LEBIH_MAJU: main boleh memuat commit di atas release aktif asalkan selisih BASE..MAIN hanya scripts/, docs/, dan tes skrip rilis (tidak ada kode aplikasi/prisma/frontend).
MAIN_FILES=""
if ! sg merge-base --is-ancestor "$MAIN_SHA" "$BASE_SHA"; then
  sg merge-base --is-ancestor "$BASE_SHA" "$MAIN_SHA" || die "origin/main (${MAIN_SHA:0:8}) dan baseline ${BASE_SHA:0:8} bercabang — gabungkan lineage terbaru lalu ulangi tes/preflight"
  MAIN_EXTRA="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA" | grep -Ev '^(scripts/|docs/|backend/tests/release[A-Za-z0-9]+\.test\.js$)' || true)"
  [ -z "$MAIN_EXTRA" ] || { printf '%s\n' "$MAIN_EXTRA" | sed 's/^/        /'; die "origin/main memuat perubahan kode yang tidak ada di release aktif — berhenti"; }
  MAIN_FILES="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA")"
  warn "origin/main (${MAIN_SHA:0:8}) lebih maju dari baseline hanya pada scripts/docs ($(printf '%s\n' "$MAIN_FILES" | wc -l) berkas) — ikut diizinkan"
fi
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat ${DEPLOY_SHORT}: rilis akan menghilangkan isi main — gabungkan main ke kandidat dulu"
for A in $LIVE_ANCESTORS; do
  sg cat-file -e "${A}^{commit}" 2>/dev/null || die "commit live ${A:0:8} tidak ada di repo sumber"
  sg merge-base --is-ancestor "$A" "$DEPLOY_SHA" || die "commit live ${A:0:8} BUKAN leluhur kandidat — rilis akan menghilangkan perubahan live; gabungkan baseline terbaru dulu"
done
ok "semua commit live yang wajib (Produksi override, Riwayat Referensi, bukti serah, Koreksi Gudang, UX Gudang, Sidebar) adalah leluhur kandidat"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" | { grep -Fvx -f <(printf '%s\n' "$MAIN_FILES") || true; } || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -q 'production-evidence' || die "artefak foto uji ikut ter-commit (backend/data/production-evidence) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -q 'receipt-proofs' || die "artefak unggahan uji ikut ter-commit (backend/data/receipt-proofs) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)\.env' || die "berkas .env ikut ter-commit — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -q '^driver-mobile/' || die "driver-mobile berubah — rilis ini tidak membawa app Driver"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
MIG_LIST=""; EXPECT_PRISMA=""; NLX="$(printf '\nx')"; NLX="${NLX%x}"
for e in $MIGS; do MIG_LIST="$MIG_LIST ${e%%:*}"; EXPECT_PRISMA="${EXPECT_PRISMA:+${EXPECT_PRISMA}${NLX}}backend/prisma/migrations/${e%%:*}/migration.sql"; done
EXPECT_PRISMA="${EXPECT_PRISMA}${NLX}backend/prisma/schema.prisma"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat migrasi rilis ini (1 migrasi + schema.prisma yang diaudit)"; }
# Migrasi yang sudah ada di baseline TIDAK boleh diubah/dihapus (yang sudah pernah diterapkan di produksi): hanya penambahan.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
[ "$(sg diff -U0 --no-color "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | grep -v '^index ' | sed -E 's/^@@ [^@]*@@.*$/@@/' | { cat; echo; } | sha256sum | cut -d' ' -f1)" = "$SCHEMA_DIFF_SHA" ] || die "diff schema.prisma BERBEDA dari yang diaudit (pin SCHEMA_DIFF_SHA) — audit ulang lalu perbarui pin"
ok "schema.prisma: diff identik dengan yang diaudit (aditif: 3 model baru ProductionUnitWorkProgress/MaterialPlan/MaterialPlanRevision + 2 field relasi pada Unit)"
ALL_SQL=""
for e in $MIGS; do
  n="${e%%:*}"; pin="${e##*:}"
  [[ "$n" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $n"
  s="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${n}/migration.sql" | tr -d '\r')"
  h="$(printf '%s\n' "$s" | sha256sum | cut -d' ' -f1)"
  [ "$pin" = "$h" ] || die "isi migrasi ${n} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
  ok "migrasi ${n}: sha256 cocok pin (${h:0:12})"
  ALL_SQL="$ALL_SQL
$s"
done
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai migrasi rilis "Order Produksi adopsi Admin" (1 migrasi ADITIF). FAIL-CLOSED: setiap pernyataan harus cocok PERSIS salah satu bentuk yang diaudit. Membaca SQL dari stdin (komentar baris "--" sudah dibuang pemanggil).
//   • 3 CREATE TABLE baru (production_unit_work_progress, production_unit_material_plans, production_unit_material_plan_revisions) — masing-masing memuat CHECK yang diaudit.
//   • 3 indeks (1 biasa, 2 unik) HANYA pada tabel baru; 3 foreign key ON DELETE RESTRICT (ke units / production_unit_material_plans); 1 fungsi append-only + 2 trigger HANYA pada tabel baru.
// Tidak ada ALTER TABLE pada tabel lama (units, stock_movements, dst), tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/ALTER COLUMN/RENAME/CREATE TYPE/ADD VALUE/CREATE EXTENSION di luar badan fungsi.
// Isi migrasi juga dipatok sha256 di skrip rilis; pemindai ini adalah lapisan kedua (bentuk pernyataan), diuji dengan mutan negatif.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };

/** Pecah per ';' di luar blok $$ ... $$ (fungsi). */
function pecah(t) {
  const out = []; let cur = ""; let dalam = false;
  for (let i = 0; i < t.length; i += 1) {
    if (t[i] === "$" && t[i + 1] === "$") { dalam = !dalam; cur += "$$"; i += 1; continue; }
    if (t[i] === ";" && !dalam) { out.push(cur); cur = ""; continue; }
    cur += t[i];
  }
  if (dalam) gagal("blok $$ tidak tertutup");
  if (rapat(cur)) out.push(cur);
  return out.map(rapat).filter(Boolean);
}
const T_BARU = "(?:production_unit_work_progress|production_unit_material_plans|production_unit_material_plan_revisions)";
// CHECK/constraint wajib ada di CREATE TABLE tertentu (hilangnya CHECK = migrasi berubah).
const WAJIB_DI_TABEL = {
  production_unit_work_progress: ['CONSTRAINT "production_unit_work_progress_status_chk" CHECK ("status" IN (\'BELUM_DIJADWALKAN\',\'DIJADWALKAN\',\'DIKERJAKAN\',\'TERTUNDA\',\'SELESAI\'))'],
  production_unit_material_plans: ['CONSTRAINT "production_unit_material_plans_lines_array_chk" CHECK (jsonb_typeof("lines") = \'array\')'],
  production_unit_material_plan_revisions: [],
};
const BENTUK = [
  ["create_table", new RegExp(`^CREATE TABLE "${T_BARU}" \\(.*\\)$`)],
  ["index", new RegExp(`^CREATE (?:UNIQUE )?INDEX "[a-z0-9_]+" ON "${T_BARU}"\\("[a-z_]+"(?:, "[a-z_]+")*\\)$`)],
  ["fk", new RegExp(`^ALTER TABLE "${T_BARU}" ADD CONSTRAINT "[a-z0-9_]+_fkey" FOREIGN KEY \\("[a-z_]+"\\) REFERENCES "(?:units|production_unit_material_plans)"\\("id"\\) ON DELETE RESTRICT ON UPDATE CASCADE$`)],
  ["fungsi", /^CREATE OR REPLACE FUNCTION production_adopsi_append_only\(\) RETURNS TRIGGER AS \$\$ BEGIN RAISE EXCEPTION '% bersifat append-only \(% ditolak\)', TG_TABLE_NAME, TG_OP; END; \$\$ LANGUAGE plpgsql$/],
  ["trigger", /^CREATE TRIGGER "(?:production_unit_work_progress_append_only_trg" BEFORE UPDATE OR DELETE ON "production_unit_work_progress"|production_unit_material_plan_revisions_append_only_trg" BEFORE UPDATE OR DELETE ON "production_unit_material_plan_revisions") FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only\(\)$/],
];
// kata terlarang DI LUAR badan $$ (fungsi): perubahan/penghapusan data atau struktur lama, hak akses, ekstensi
const TERLARANG = /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|GRANT|REVOKE|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|CREATE\s+TYPE|ADD\s+VALUE|ADD\s+COLUMN|DISABLE|CREATE\s+EXTENSION|DEFAULT\s+[^,)]+)\b/i;
const hitung = { total: 0, create_table: 0, index: 0, fk: 0, fungsi: 0, trigger: 0 };
const lihat = new Set();
for (const r of pecah(sql)) {
  hitung.total += 1;
  if (lihat.has(r)) gagal("pernyataan ganda: " + r.slice(0, 120));
  lihat.add(r);
  const jenis = BENTUK.find(([, re]) => re.test(r))?.[0];
  if (!jenis) gagal("PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 220));
  const luarBadan = r.replace(/\$\$.*\$\$/g, "$$$$");
  if (jenis === "create_table") {
    const nama = /^CREATE TABLE "([a-z_]+)"/.exec(r)[1];
    for (const w of WAJIB_DI_TABEL[nama] ?? []) if (!r.includes(w)) gagal(`CREATE TABLE ${nama} kehilangan constraint yang diaudit: ${w.slice(0, 80)}`);
    if (/\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|GRANT)\b/i.test(r)) gagal("CREATE TABLE memuat kata terlarang");
  } else if (TERLARANG.test(luarBadan)) gagal("kata terlarang di luar badan fungsi: " + r.slice(0, 160));
  hitung[jenis] += 1;
}
console.log(JSON.stringify(hitung));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (3 CREATE TABLE baru kosong, 3 indeks, 3 FK ON DELETE RESTRICT, 1 fungsi + 2 trigger append-only pada tabel baru); tanpa ALTER pada tabel lama, tanpa DROP/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT/EXTENSION"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE units" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "DROP TABLE stock_movements" "$(tambah_stmt 'DROP TABLE "stock_movements";')"
harus_ditolak "DROP TABLE tabel baru" "$(tambah_stmt 'DROP TABLE "production_unit_work_progress";')"
harus_ditolak "UPDATE units (backfill)" "$(tambah_stmt "UPDATE \"units\" SET \"status\" = 'RECEIVED';")"
harus_ditolak "UPDATE stock_movements (backfill)" "$(tambah_stmt "UPDATE \"stock_movements\" SET \"qty\" = 0;")"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "units";')"
harus_ditolak "INSERT ke tabel baru (backfill)" "$(tambah_stmt "INSERT INTO \"production_unit_work_progress\" (id) VALUES ('x');")"
harus_ditolak "INSERT ke tabel lama" "$(tambah_stmt "INSERT INTO \"stock_movements\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "units";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "units" DROP COLUMN "status";')"
harus_ditolak "ADD COLUMN pada units" "$(tambah_stmt 'ALTER TABLE "units" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada stock_movements" "$(tambah_stmt 'ALTER TABLE "stock_movements" ADD COLUMN "x" TEXT;')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "units" ALTER COLUMN "status" TYPE TEXT;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "units" RENAME COLUMN "status" TO "s";')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("status");')"
harus_ditolak "indeks unik pada tabel lama" "$(tambah_stmt 'CREATE UNIQUE INDEX "x_uq" ON "stock_movements"("id");')"
harus_ditolak "FK ke tabel lain" "$(tambah_stmt 'ALTER TABLE "production_unit_work_progress" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "FK CASCADE pada progress" "$(printf '%s\n' "$ALL_SQL" | sed 's/production_unit_work_progress_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT/production_unit_work_progress_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE/')"
harus_ditolak "FK CASCADE pada rencana" "$(printf '%s\n' "$ALL_SQL" | sed 's/production_unit_material_plans_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT/production_unit_material_plans_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE/')"
harus_ditolak "FK SET NULL pada revisi" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "production_unit_material_plans"("id") ON DELETE RESTRICT/REFERENCES "production_unit_material_plans"("id") ON DELETE SET NULL/')"
harus_ditolak "CHECK status dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'production_unit_work_progress_status_chk')"
harus_ditolak "CHECK status dilonggarkan" "$(printf '%s\n' "$ALL_SQL" | sed "s/'TERTUNDA','SELESAI'/'TERTUNDA','SELESAI','LIAR'/")"
harus_ditolak "CHECK lines dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'production_unit_material_plans_lines_array_chk')"
harus_ditolak "trigger append-only progress dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'production_unit_work_progress_append_only_trg')"
harus_ditolak "trigger append-only revisi dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'production_unit_material_plan_revisions_append_only_trg')"
harus_ditolak "DISABLE TRIGGER" "$(tambah_stmt 'ALTER TABLE "production_unit_work_progress" DISABLE TRIGGER ALL;')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "units" DROP CONSTRAINT "units_pkey";')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"UnitStatus\" ADD VALUE IF NOT EXISTS 'LIAR';")"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "production_unit_work_progress" TO PUBLIC;')"
harus_ditolak "REVOKE" "$(tambah_stmt 'REVOKE ALL ON "units" FROM PUBLIC;')"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "fungsi append-only diubah" "$(printf '%s\n' "$ALL_SQL" | sed 's/RAISE EXCEPTION/RAISE NOTICE/')"
harus_ditolak "trigger pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "units" FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();')"
harus_ditolak "pernyataan ganda" "$(tambah_stmt 'CREATE INDEX "production_unit_work_progress_unit_id_created_at_idx" ON "production_unit_work_progress"("unit_id", "created_at");')"
harus_ditolak "blok DO liar" "$(tambah_stmt 'DO $$ BEGIN DELETE FROM "units"; END $$;')"
[ "$NEG" -ge 36 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 36)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ADD-DROP-ALTER-RENAME COLUMN/tabel-indeks-FK-trigger-fungsi liar/CASCADE/SET NULL/CHECK dibuang atau dilonggarkan/trigger dibuang/DISABLE/GRANT/REVOKE/EXTENSION/DO liar/pernyataan ganda) SEMUANYA ditolak"
for f in $GUARD_UNCHANGED; do
  [ "$(sg rev-parse "${BASE_SHA}:${f}")" = "$(sg rev-parse "${DEPLOY_SHA}:${f}")" ] || die "${f} berbeda antara baseline dan kandidat — rilis ini tidak boleh menyentuhnya (ledger, jurnal, otorisasi, status lintas workspace, Produksi V2, Delivery, Stock Count)"
done
ok "$(printf '%s\n' $GUARD_UNCHANGED | wc -w) berkas pelindung (ledger stok, jurnal Finance, otorisasi/izin, fungsi status lintas workspace, Produksi V2 tahap/QC, Delivery override, Stock Count) identik dengan baseline"
# Urutan migrasi: nama migrasi rilis ini HARUS terurut SETELAH migrasi terbaru di baseline (Prisma menerapkan menurut nama).
MIG_BASE_MAX="$(sg ls-tree --name-only "$BASE_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort | tail -n 1)"
[ "$MIG_BASE_MAX" = "$LIVE_MIG_TERAKHIR" ] || die "migrasi terbaru di baseline (${MIG_BASE_MAX}) bukan yang diaudit (${LIVE_MIG_TERAKHIR}) — baseline bergeser; audit ulang"
for e in $MIGS; do [[ "${e%%:*}" > "$MIG_BASE_MAX" ]] || die "migrasi ${e%%:*} tidak terurut SETELAH migrasi baseline terbaru (${MIG_BASE_MAX})"; done
ok "urutan migrasi:${MIG_LIST} terurut setelah migrasi baseline terbaru (${MIG_BASE_MAX})"
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
# Prasyarat skema: tabel yang dibaca/ditulis kode baru HARUS sudah ada; objek rilis ini belum boleh ada.
for T in units stock_movements materials v2_commands activity_events jobs production_runs_v2 production_operation_runs_v2 production_step_evidence_v2 unit_stage_logs quality_inspections_v2 unit_custody_handoffs_v2 material_issues material_reservations_v2 payments order_groups '"User"' user_roles fin_journal_entries fin_journal_lines goods_receipts; do
  [ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename='${T//\"/}'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename in ('production_unit_work_progress','production_unit_material_plans','production_unit_material_plan_revisions')")" = "0" ] || die "tabel adopsi Admin SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_proc where proname = 'production_adopsi_append_only'")" = "0" ] || die "fungsi production_adopsi_append_only SUDAH ada di produksi (tidak diharapkan)"
for m in $MIG_LIST; do [ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${m}'")" = "0" ] || die "migrasi ${m} SUDAH tercatat di produksi (tidak diharapkan)"; done
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
grep -Fx "$LIVE_MIG_TERAKHIR" "$BK_DIR/applied-sebelum.txt" >/dev/null || die "migrasi live ${LIVE_MIG_TERAKHIR} belum terpasang di produksi — baseline bukan yang diharapkan"
[ "$(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt" | tail -n 1)" = "$LIVE_MIG_TERAKHIR" ] || die "produksi memiliki migrasi LEBIH BARU dari ${LIVE_MIG_TERAKHIR}: gabungkan baseline terbaru ke kandidat dulu"
CAND_PRE="$(sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u)"
SOLO_PROD_PRE="$(comm -13 <(printf '%s\n' "$CAND_PRE") "$BK_DIR/applied-sebelum.txt" || true)"
[ -z "$SOLO_PROD_PRE" ] || die "produksi memiliki migrasi yang TIDAK ada di kandidat (gabungkan live terbaru ke kandidat dulu): $(printf '%s' "$SOLO_PROD_PRE" | tr '\n' ' ')"
PEND_PRE="$(comm -23 <(printf '%s\n' "$CAND_PRE") "$BK_DIR/applied-sebelum.txt" || true)"
[ "$(printf '%s\n' "$PEND_PRE" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || die "migrasi pending terhadap live saat ini bukan TEPAT migrasi rilis ini: $(printf '%s' "$PEND_PRE" | tr '\n' ' ')"
MIG_SEBELUM="$(wc -l < "$BK_DIR/applied-sebelum.txt" | tr -d ' ')"
ok "migrasi terpasang di produksi (${MIG_SEBELUM}) semuanya ada di kandidat; terakhir = ${LIVE_MIG_TERAKHIR}; pending terhadap live = tepat:${MIG_LIST}"
# Dampak migrasi: hanya CREATE TABLE tabel baru kosong + FK ke units (FK pada tabel kosong = tanpa validasi baris; tabel lama TIDAK disentuh sama sekali, tanpa kunci pada tabel aktif selain ACCESS SHARE pada units saat FK dibuat).
UNIT_N="$(psql_live -At -c "select count(*) from units")"; SM_N="$(psql_live -At -c "select count(*) from stock_movements")"; MAT_N="$(psql_live -At -c "select count(*) from materials")"
[[ "$UNIT_N" =~ ^[0-9]+$ ]] && [[ "$SM_N" =~ ^[0-9]+$ ]] && [[ "$MAT_N" =~ ^[0-9]+$ ]] || die "audit awal bukan angka"
[ "$UNIT_N" -le 4900 ] || die "jumlah unit ${UNIT_N} mendekati batas ekspor Excel (5000) — tinjau batas BATAS_EKSPOR sebelum rilis"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"
ok "dampak migrasi: units ${UNIT_N} baris; stock_movements ${SM_N}; materials ${MAT_N}; DB ${DB_BYTES} byte — hanya 3 tabel baru kosong (tabel lama tidak diubah); ekspor Excel memuat seluruh ${UNIT_N} unit (batas 5000)"
ADM_AKTIF="$(psql_live -At -c "select count(*) from \"User\" where active and (role::text in ('ADMIN','OWNER') or id in (select user_id from user_roles where role::text in ('ADMIN','OWNER')))")"
ok "akun aktif ADMIN/OWNER yang akan melihat panel adopsi: ${ADM_AKTIF}"
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"
[[ "$BASE_TIDAK_SEIMBANG" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$BASE_TIDAK_SEIMBANG'"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}"
# T0 = jam DB (UTC) 5 menit lalu. Dokumen pembanding dibekukan: hanya yang dibuat sebelum T0 (transaksi sah baru tidak diperbandingkan).
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
# Tabel pembanding beku: HANYA data append-only atau daftar id yang tidak berubah oleh operasi harian, dibekukan pada T0 (baris yang dibuat sesudah T0 tidak ikut dibandingkan). Tabel yang berubah setiap hari (units, jobs, Run, dst) dibandingkan lewat DAFTAR ID, bukan isi baris.
# Mencakup semua yang TIDAK boleh dibuat/diubah oleh rilis ini: ledger stok (isi penuh) + saldo per bahan, jurnal Finance (induk + baris), pembayaran, penerimaan, Material Issue, reservasi, dan id unit/job/Run/operasi/bukti tahap/log tahap/QC/serah/aktivitas.
FP_BEKU_SQL="$(cat <<FPBEKU
select 'pergerakan_stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'saldo_per_bahan', count(*), md5(coalesce(string_agg(s.material_id::text || ':' || s.q::text, '|' order by s.material_id),'')) from (select material_id, sum(qty) q from stock_movements where created_at < '$T0'::timestamp group by material_id) s
union all select 'jurnal_induk', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from fin_journal_entries x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'id_unit', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from units x where x.created_at < '$T0'::timestamp
union all select 'id_penerimaan', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from goods_receipts x where x.created_at < '$T0'::timestamp
union all select 'id_material_issue', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from material_issues x where x.created_at < '$T0'::timestamp
union all select 'id_reservasi', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from material_reservations_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_job', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from jobs x where x.created_at < '$T0'::timestamp
union all select 'id_run_produksi', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from production_runs_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_operasi_run', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from production_operation_runs_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_bukti_tahap', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from production_step_evidence_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_log_tahap', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from unit_stage_logs x where x.created_at < '$T0'::timestamp
union all select 'id_qc', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from quality_inspections_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_serah_unit', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from unit_custody_handoffs_v2 x where x.created_at < '$T0'::timestamp
union all select 'id_pembayaran', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from payments x where x.created_at < '$T0'::timestamp
union all select 'id_aktivitas', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from activity_events x where x.created_at < '$T0'::timestamp
FPBEKU
)"
FPB_N=17
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "$FPB_N" ] || die "sidik jari dokumen beku tidak ${FPB_N} baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di ${FPB_N} kelompok)"
# Skema tabel LAMA (sidik jari kolom/tipe/nullable/default): tidak boleh berubah oleh migrasi (3 tabel baru dikecualikan).
SKEMA_SQL="select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name not in ('production_unit_work_progress','production_unit_material_plans','production_unit_material_plan_revisions')"
# Katalog objek (indeks, constraint, trigger) SEMUA tabel LAMA: tidak boleh berubah (objek rilis ini hanya ada pada 3 tabel baru).
KATALOG_SQL="select md5(coalesce(string_agg(x, ',' order by x), '')) from (
 select 'idx:'||tablename||':'||indexname as x from pg_indexes where schemaname='public' and tablename not in ('production_unit_work_progress','production_unit_material_plans','production_unit_material_plan_revisions')
 union all select 'con:'||conrelid::regclass::text||':'||conname from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text not in ('production_unit_work_progress','production_unit_material_plans','production_unit_material_plan_revisions')
 union all select 'trg:'||tgrelid::regclass::text||':'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text not in ('production_unit_work_progress','production_unit_material_plans','production_unit_material_plan_revisions')) k"

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

if [ "$PREFLIGHT_ONLY" = "0" ] && [ "$REHEARSAL_ONLY" = "0" ] && [ "$REHEARSAL_PENUH" = "0" ]; then
  MARK="$HOME/release-backups/.rehearsal-penuh-ok-order-produksi-adopsi-${DEPLOY_SHA}"
  [ -f "$MARK" ] || die "belum ada bukti --rehearsal-penuh LULUS untuk SHA ${DEPLOY_SHORT}: jalankan --rehearsal-penuh dulu"
  grep -qx "BASE=${BASE_SHA}" "$MARK" && grep -qx "DEPLOY=${DEPLOY_SHA}" "$MARK" || die "bukti rehearsal-penuh bukan untuk SHA/baseline ini — ulangi terhadap baseline live saat ini"
  [ -n "$(find "$MARK" -mmin -2160 2>/dev/null)" ] || die "bukti rehearsal-penuh lebih dari 36 jam — ulangi terhadap data production terbaru"
  ok "bukti --rehearsal-penuh LULUS untuk SHA ${DEPLOY_SHORT} + baseline ${BASE_SHA:0:8} ($(sed -n 4p "$MARK" | sed s/TES=/tes\ integrasi\ lulus:\ /))"
fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-opa-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

# bk_run: menjalankan perintah di container backend. Rilis penuh = compose release dir (env production); --rehearsal-penuh = image bertag rehearsal TANPA env production (hanya variabel yang diberikan eksplisit).
bk_run() {
  local o=(); while [ "$1" != "--" ]; do o+=("$1"); shift; done; shift
  if [ "$REHEARSAL_PENUH" = "1" ]; then docker run --rm -i --network "$NET" -w /app "${o[@]}" "$REH_IMG" "$@"
  else dcp "$NEW_DIR" run --rm --no-deps -T "${o[@]}" backend "$@"; fi
}
# Lanjutan --rehearsal-penuh di DALAM rehearsal(): semuanya terhadap DB rehearsal yang SUDAH dimigrasi dan lolos sidik jari.
rehearsal_penuh_lanjutan() {
  say "Lanjutan rehearsal penuh: smoke baca-saja pada DB rehearsal, skenario pada KLON (status kerja manual, rencana vs aktual, idempotensi, status order lintas workspace, bukti aplikasi), guard rollback, TES INTEGRASI terarah (Postgres sekali-pakai); production tidak disentuh"
  local RH_DIR="$BK_DIR/rh"; mkdir -p "$RH_DIR"
  cp "$WS/scripts/lib/rehearsal-skenario-order-produksi-adopsi.mjs" "$WS/scripts/lib/smoke-order-produksi-adopsi.mjs" "$WS/scripts/lib/rehearsal-kode-lama-order-produksi-adopsi.mjs" "$RH_DIR/" || { reh_drop; die "pustaka skenario tidak ada di arsip kandidat"; }
  local RH_JWT; RH_JWT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  [ "${#RH_JWT}" -ge 32 ] || { reh_drop; die "gagal membangkitkan rahasia JWT rehearsal"; }
  # 1) smoke baca-saja terhadap data restore (DB rehearsal yang SUDAH dimigrasi): tidak ada tulisan; sidik jari tabel lama diperiksa lagi sesudahnya
  docker run --rm --network "$NET" -v "$RH_DIR:/rh:ro" -w /app -e FASE=smoke -e JWT_SECRET="$RH_JWT" -e DATABASE_URL="$REH_URL" -e TEST_DATABASE_URL="$REH_URL" "$REH_IMG" node /rh/rehearsal-skenario-order-produksi-adopsi.mjs </dev/null > "$BK_DIR/rh-smoke.log" 2>&1 || { grep -E 'FAIL|Error' "$BK_DIR/rh-smoke.log" | head -n 10; reh_drop; die "smoke baca-saja terhadap DB rehearsal GAGAL (log: $BK_DIR/rh-smoke.log)"; }
  grep -q '^RH_SMOKE kode=0' "$BK_DIR/rh-smoke.log" && grep -q '^SMOKE_HASIL fail=0 skip=' "$BK_DIR/rh-smoke.log" || { tail -n 8 "$BK_DIR/rh-smoke.log"; reh_drop; die "smoke tidak mencetak ringkasan lulus"; }
  grep -q 'ekspor xlsx: 200' "$BK_DIR/rh-smoke.log" && grep -q 'panel unit .*: 200' "$BK_DIR/rh-smoke.log" || { reh_drop; die "smoke tidak membuktikan panel unit nyata + ekspor xlsx"; }
  ok "smoke baca-saja terhadap DB rehearsal: $(grep -c '  PASS' "$BK_DIR/rh-smoke.log") pemeriksaan lulus, $(grep '^SMOKE_HASIL' "$BK_DIR/rh-smoke.log" | sed 's/SMOKE_HASIL //')"
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sesudah-smoke-${mode}.txt" || { reh_drop; die "sidik jari penuh sesudah smoke gagal"; }
  cmp -s "$BK_DIR/fp-all-sebelum-${mode}.txt" "$BK_DIR/fp-all-sesudah-smoke-${mode}.txt" || { diff "$BK_DIR/fp-all-sebelum-${mode}.txt" "$BK_DIR/fp-all-sesudah-smoke-${mode}.txt" || true; reh_drop; die "smoke baca-saja MENGUBAH isi tabel lama"; }
  [ "$(RPSQL "select (select count(*) from production_unit_work_progress) + (select count(*) from production_unit_material_plans) + (select count(*) from production_unit_material_plan_revisions)")" = "0" ] || { reh_drop; die "smoke baca-saja menulis ke tabel adopsi"; }
  ok "sesudah smoke: isi semua tabel lama IDENTIK dengan sebelum migrasi; tabel adopsi tetap kosong (read-only terbukti)"
  # 2) skenario menulis pada KLON DB rehearsal (CREATE DATABASE ... TEMPLATE); DB rehearsal utama tidak ikut berubah
  KLON_DB="rehearsal_opa_test_klon_${TS}"
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${KLON_DB}\" TEMPLATE \"${REH_DB}\"" </dev/null || { reh_drop; die "gagal membuat klon DB rehearsal"; }
  local KLON_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${KLON_DB}"
  docker run --rm --network "$NET" -v "$RH_DIR:/rh:ro" -w /app -e FASE=skenario -e JWT_SECRET="$RH_JWT" -e DATABASE_URL="$KLON_URL" -e TEST_DATABASE_URL="$KLON_URL" "$REH_IMG" node /rh/rehearsal-skenario-order-produksi-adopsi.mjs </dev/null > "$BK_DIR/rh-skenario.log" 2>&1 || { grep -E '^FAIL' "$BK_DIR/rh-skenario.log" | head -n 12; tail -n 5 "$BK_DIR/rh-skenario.log"; dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${KLON_DB}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; reh_drop; die "skenario rehearsal GAGAL (log: $BK_DIR/rh-skenario.log)"; }
  grep -q '^RH_SKENARIO gagal=0' "$BK_DIR/rh-skenario.log" && ! grep -q '^FAIL' "$BK_DIR/rh-skenario.log" || { grep -E '^FAIL' "$BK_DIR/rh-skenario.log" | head -n 12; reh_drop; die "skenario rehearsal tidak lulus penuh"; }
  local NPASS; NPASS="$(grep -c '^PASS' "$BK_DIR/rh-skenario.log")"; [ "$NPASS" -ge 40 ] || { reh_drop; die "skenario hanya ${NPASS} pemeriksaan lulus (minimal 40)"; }
  for k in 'SINTETIS: catatan manual TIDAK membuat stok' 'SINTETIS: rencana TIDAK mengubah stok' 'SINTETIS: dua permintaan BERSAMAAN kunci sama' 'SINTETIS: kunci sama dengan isian berbeda' 'STATUS ORDER dari Produksi: PATCH' 'Sales melihat status yang SAMA' 'bukti aplikasi ada → catatan manual DITOLAK' 'SINTETIS: ekspor xlsx memuat unit ini'; do grep -q "^PASS ${k}" "$BK_DIR/rh-skenario.log" || { reh_drop; die "pemeriksaan wajib tidak ada/lulus: $k"; }; done
  ok "skenario rehearsal pada KLON data production: ${NPASS} pemeriksaan lulus, 0 gagal — catatan manual tanpa bukti palsu, rencana tanpa efek stok, pemakaian aktual tepat sekali (kunci sama, serentak, isian beda), status order lewat jalur Sales yang sama, bukti aplikasi menang, ekspor xlsx"
  grep -E '^INFO' "$BK_DIR/rh-skenario.log" | sed 's/^/        /'
  # DB rehearsal UTAMA tetap tidak berubah oleh skenario (skenario hanya menulis di klon)
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sesudah-skenario-${mode}.txt" || { reh_drop; die "sidik jari penuh sesudah skenario gagal"; }
  cmp -s "$BK_DIR/fp-all-sebelum-${mode}.txt" "$BK_DIR/fp-all-sesudah-skenario-${mode}.txt" || { reh_drop; die "DB rehearsal utama berubah oleh skenario (seharusnya hanya klon)"; }
  # 3) guard rollback terhadap KLON yang memuat data adopsi: LULUS dan melaporkan jumlah (kode lama tidak membaca tabel adopsi)
  local G1; set +e; GUARD_DB="$KLON_DB" bash "$WS/scripts/rollback-guard-order-produksi-adopsi.sh" > "$BK_DIR/guard-klon.log" 2>&1; G1=$?; set -e
  [ "$G1" = "0" ] && grep -q 'GUARD LULUS' "$BK_DIR/guard-klon.log" && grep -Eq 'catatan status kerja=[1-9]' "$BK_DIR/guard-klon.log" || { cat "$BK_DIR/guard-klon.log"; reh_drop; die "guard rollback pada klon berisi data adopsi gagal (exit=${G1})"; }
  ok "guard rollback pada klon berisi data adopsi: LULUS (exit 0); $(sed -n 1p "$BK_DIR/guard-klon.log")"
  # 3b) ROLLBACK KODE terbukti pada DATA: image LAMA (baseline live, tanpa kode adopsi) membaca KLON yang berisi data adopsi — bacaan lama tetap benar, stok tidak berubah, hapus unit berjejak tidak menghilangkan data
  docker run --rm --network "$NET" -v "$RH_DIR:/rh:ro" -w /app -e JWT_SECRET="$RH_JWT" -e DATABASE_URL="$KLON_URL" -e TEST_DATABASE_URL="$KLON_URL" "$PREV_IMG_ID" node /rh/rehearsal-kode-lama-order-produksi-adopsi.mjs </dev/null > "$BK_DIR/rh-kode-lama.log" 2>&1 || { grep -E '^FAIL|Error' "$BK_DIR/rh-kode-lama.log" | head -n 10; tail -n 4 "$BK_DIR/rh-kode-lama.log"; dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${KLON_DB}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; reh_drop; die "rollback kode: image LAMA terhadap data adopsi GAGAL (log: $BK_DIR/rh-kode-lama.log)"; }
  grep -q '^RH_KODE_LAMA gagal=0' "$BK_DIR/rh-kode-lama.log" && ! grep -q '^FAIL' "$BK_DIR/rh-kode-lama.log" && grep -q '^PASS image ini LAMA' "$BK_DIR/rh-kode-lama.log" || { tail -n 6 "$BK_DIR/rh-kode-lama.log"; reh_drop; die "rollback kode terhadap data adopsi tidak lulus penuh"; }
  ok "rollback kode terbukti pada data: image LAMA ($(docker image inspect -f '{{.Id}}' "$PREV_IMG_ID" | cut -c8-19)) membaca klon berisi data adopsi — $(grep -c '^PASS' "$BK_DIR/rh-kode-lama.log") pemeriksaan lulus; $(grep '^INFO' "$BK_DIR/rh-kode-lama.log" | sed 's/^INFO //')"
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${KLON_DB}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true
  # 4) TES INTEGRASI terarah di Postgres SEKALI-PAKAI (container sementara, tanpa volume, TIDAK memakai Postgres production): image kandidat, node 20 Linux, DB dibuat dari NOL oleh runDisposable
  #    (tes memuat TRUNCATE sehingga TIDAK dijalankan pada salinan data production; yang dijalankan pada data production = skenario klon di atas)
  say "Tes integrasi terarah (${TES_N_EXPECT} tes di $(printf '%s\n' $TES_FILES | wc -l) berkas) pada Postgres sekali-pakai — bisa 40–70 menit; log: $BK_DIR/tes-integrasi.log"
  PG_IMG="$(docker inspect -f '{{.Config.Image}}' "$(dcp "$PREV_DIR" ps -q postgres </dev/null)")"; [ -n "$PG_IMG" ] || { reh_drop; die "image postgres tidak terbaca"; }
  PGT="rh-opa-pg-${TS}"; local PGPW; PGPW="$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  docker run -d --name "$PGT" --network "$NET" --tmpfs /var/lib/postgresql/data:rw,size=3g -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$PGPW" "$PG_IMG" -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=300 >/dev/null || { reh_drop; die "gagal menjalankan Postgres sekali-pakai"; }
  local siap=0; for i in $(seq 1 40); do docker exec "$PGT" pg_isready -U "$DB_USER" >/dev/null 2>&1 && { siap=1; break; }; sleep 2; done
  [ "$siap" = "1" ] || { docker logs "$PGT" 2>&1 | tail -n 8; reh_drop; die "Postgres sekali-pakai tidak siap"; }
  for f in $TES_FILES; do [ -f "$WS/backend/$f" ] || { reh_drop; die "berkas tes pinned tidak ada di arsip kandidat: $f"; }; done
  # Dua penyesuaian lingkungan (bukan pelonggaran gerbang): (1) sebagian tes membaca berkas repo di luar backend/ (scripts/, frontend/src) lewat ../../../ → dipasang READ-ONLY dari arsip kandidat (bukan data production);
  # (2) kolam koneksi Prisma bawaan = 2×CPU+1 = 5 pada VPS 2 vCPU, terlalu kecil untuk tes paralel (P2024 → 503); connection_limit=30 menyamai kolam mesin pengembangan.
  tes_jalankan() { # $1 = log; sisanya = berkas tes. Mengembalikan kode keluar runDisposable (output TAP/spec ke log)
    local log="$1"; shift
    docker run --rm --network "$NET" -w /app -v "$WS/scripts:/scripts:ro" -v "$WS/frontend/src:/frontend/src:ro" -e TZ=Asia/Jakarta -e JWT_SECRET="$RH_JWT" -e TEST_DB_SERVER_URL="postgresql://${DB_USER}:${PGPW}@${PGT}:5432/postgres?connection_limit=30" "$REH_IMG" node tests/integration/setup/runDisposable.js "$@" </dev/null > "$log" 2>&1
  }
  # Pelapor tes bergantung versi node: node 20 (image) non-TTY = TAP ("# tests N"); node ≥ 22 = spec ("ℹ tests N"). Keduanya diterima.
  tes_angka() { sed -n -e "s/^ℹ $2 \([0-9]*\)\$/\1/p" -e "s/^# $2 \([0-9]*\)\$/\1/p" "$1" | tail -n 1; }
  set +e; tes_jalankan "$BK_DIR/tes-integrasi.log" $TES_FILES; local TES_RC=$?; set -e
  local T_N T_PASS T_FAIL; T_N="$(tes_angka "$BK_DIR/tes-integrasi.log" tests)"; T_PASS="$(tes_angka "$BK_DIR/tes-integrasi.log" pass)"; T_FAIL="$(tes_angka "$BK_DIR/tes-integrasi.log" fail)"
  [[ "$T_N" =~ ^[0-9]+$ ]] && [[ "$T_PASS" =~ ^[0-9]+$ ]] && [[ "$T_FAIL" =~ ^[0-9]+$ ]] || { tail -n 12 "$BK_DIR/tes-integrasi.log"; docker rm -f "$PGT" >/dev/null 2>&1 || true; reh_drop; die "ringkasan tes integrasi tidak terbaca (exit=${TES_RC}) — jangan anggap lulus"; }
  [ "$T_N" = "$TES_N_EXPECT" ] || { grep -E '^✖|^not ok' "$BK_DIR/tes-integrasi.log" | sort -u | head -n 15; docker rm -f "$PGT" >/dev/null 2>&1 || true; reh_drop; die "jumlah tes ${T_N} != ${TES_N_EXPECT} yang dipatok (berkas gagal dimuat atau daftar berubah)"; }
  TES_ULANG_INFO="percobaan pertama bersih"
  if [ "$TES_RC" != "0" ] || [ "$T_FAIL" != "0" ] || [ "$T_PASS" != "$TES_N_EXPECT" ]; then
    # KEBIJAKAN FLAKY (eksplisit, SATU kali): kegagalan boleh dicoba ulang HANYA bila terbatas pada ≤ 3 berkas tes; berkas itu dijalankan ulang di DB baru dan HARUS lulus penuh. Kegagalan pertama + hasil ulang dilaporkan apa adanya.
    local GAGAL_NAMA GAGAL_FILES NG; GAGAL_NAMA="$(grep -E '^not ok' "$BK_DIR/tes-integrasi.log" | sed 's/^not ok [0-9]* - //' | sort -u | cut -c1-140)"
    GAGAL_FILES="$(grep -oE "location: '/app/tests/integration/[A-Za-z0-9]+\.integration\.test\.js" "$BK_DIR/tes-integrasi.log" | sed "s#location: '/app/#tests/#" | sort -u)"
    NG="$(printf '%s\n' "$GAGAL_FILES" | grep -c . || true)"
    printf '%s\n' "$GAGAL_NAMA" | sed 's/^/        GAGAL percobaan pertama: /'
    { [ "$NG" -ge 1 ] && [ "$NG" -le 3 ] && [ "$T_FAIL" -le 3 ]; } || { tail -n 12 "$BK_DIR/tes-integrasi.log"; docker rm -f "$PGT" >/dev/null 2>&1 || true; reh_drop; die "tes integrasi terarah TIDAK lulus (exit=${TES_RC}, tests=${T_N}, pass=${T_PASS}, fail=${T_FAIL}, berkas gagal=${NG}); di luar batas kebijakan ulang"; }
    for f in $GAGAL_FILES; do case " $TES_FILES " in *" $f "*) ;; *) docker rm -f "$PGT" >/dev/null 2>&1 || true; reh_drop; die "berkas gagal ${f} bukan bagian daftar tes pinned";; esac; done
    warn "tes integrasi: ${T_FAIL} gagal pada percobaan pertama di ${NG} berkas ($(printf '%s' "$GAGAL_FILES" | tr '\n' ' ')); mengulang HANYA berkas itu di DB baru (sekali)"
    set +e; tes_jalankan "$BK_DIR/tes-integrasi-ulang.log" $GAGAL_FILES; local ULANG_RC=$?; set -e
    local U_FAIL U_N; U_FAIL="$(tes_angka "$BK_DIR/tes-integrasi-ulang.log" fail)"; U_N="$(tes_angka "$BK_DIR/tes-integrasi-ulang.log" tests)"
    if [ "$ULANG_RC" != "0" ] || [ "$U_FAIL" != "0" ] || ! [[ "$U_N" =~ ^[0-9]+$ ]] || [ "$U_N" -lt 1 ]; then grep -E '^✖|^not ok' "$BK_DIR/tes-integrasi-ulang.log" | sort -u | head -n 10; docker rm -f "$PGT" >/dev/null 2>&1 || true; reh_drop; die "tes integrasi GAGAL lagi pada percobaan ulang (${ULANG_RC}; fail=${U_FAIL:-?}) — bukan flaky; berhenti"; fi
    TES_ULANG_INFO="${T_FAIL} gagal pada percobaan pertama (${NG} berkas) lalu LULUS PENUH pada percobaan ulang (${U_N} tes di berkas itu)"
  fi
  docker rm -f "$PGT" >/dev/null 2>&1 || true
  ok "tes integrasi terarah: ${T_N} tes dijalankan (image kandidat, DB dari nol, container sekali-pakai dihapus); ${TES_ULANG_INFO}"
}

# ── REHEARSAL (satu fungsi, dipakai --rehearsal-only, --rehearsal-penuh dan alur rilis penuh) ───────────────────────────────────────────────────────────────────────────
# $1 = "git" (SQL migrasi dari git, diberi waktu per pernyataan) | "image" (prisma migrate deploy dari image baru + kode baru terhadap data restore)
rehearsal() {
  local mode="$1"
  REH_DB="rehearsal_opa_test_${mode}_${TS}"  # nama WAJIB memuat "test": pagar env.js skenario menolak DB lain
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
  reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
  RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
  # 1) RESTORE bersih: exit code 0 dan tidak ada ERROR/FATAL/PANIC; WARNING dicatat dan dilaporkan.
  set +e; gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-${mode}.log" 2>&1; RESTORE_RC=$?; set -e
  RESTORE_ERR="$(grep -ciE 'ERROR:|FATAL|PANIC' "$BK_DIR/restore-${mode}.log" || true)"
  RESTORE_WARN="$(grep -ciE 'WARNING' "$BK_DIR/restore-${mode}.log" || true)"
  [ "$RESTORE_RC" = "0" ] && [ "${RESTORE_ERR:-0}" = "0" ] || { grep -iE 'ERROR:|FATAL|PANIC' "$BK_DIR/restore-${mode}.log" | LC_ALL=C sort | uniq -c | head -n 10 | sed 's/^/        /'; reh_drop; die "restore ke DB sementara TIDAK bersih (exit=${RESTORE_RC}, error=${RESTORE_ERR}; log: $BK_DIR/restore-${mode}.log) — berhenti; produksi tidak berubah"; }
  if [ "${RESTORE_WARN:-0}" != "0" ]; then warn "restore menghasilkan ${RESTORE_WARN} WARNING (log: $BK_DIR/restore-${mode}.log):"; grep -i 'WARNING' "$BK_DIR/restore-${mode}.log" | LC_ALL=C sort | uniq -c | head -n 5 | sed 's/^/        /'; fi
  ok "restore bersih: exit=0, error=0, warning=${RESTORE_WARN:-0}"
  # 2) Restore IDENTIK dengan dokumen beku produksi
  psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod-beku-${mode}.txt" || { reh_drop; die "sidik jari dokumen beku produksi gagal"; }
  cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku-${mode}.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku-${mode}.txt" || true; reh_drop; die "dokumen pembanding beku BERUBAH selama backup (produksi)"; }
  RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku-${mode}.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
  cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku-${mode}.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku-${mode}.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi (backup/restore bermasalah)"; }
  ok "restore nyata IDENTIK dengan produksi pada ${FPB_N} kelompok pembanding (pergerakan stok, saldo per bahan, GR + baris + event, jurnal, PO, tagihan, pembayaran, Produksi, aktivitas, sesi hitung lama + barisnya)"
  # 3) Sidik jari PENUH semua tabel lama (baris penuh) + skema + katalog objek, SEBELUM migrasi
  TABEL_LAMA="$(RPSQL "select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1")"
  [ "$(printf '%s\n' "$TABEL_LAMA" | grep -c .)" -ge 100 ] || { reh_drop; die "jumlah tabel lama di restore mencurigakan ($(printf '%s\n' "$TABEL_LAMA" | grep -c .))"; }
  FP_ALL=""
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    expr="to_jsonb(x)"
    FP_ALL="${FP_ALL:+${FP_ALL} union all }select '${t}', count(*), md5(coalesce(string_agg(md5(${expr}::text), '' order by md5(${expr}::text)),'')) from \"${t}\" x"
  done <<< "$TABEL_LAMA"
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sebelum-${mode}.txt" || { reh_drop; die "sidik jari penuh sebelum gagal"; }
  RPSQL "select md5(coalesce(string_agg(migration_name||':'||checksum, ',' order by migration_name),'')) from _prisma_migrations" > "$BK_DIR/mig-hash-sebelum-${mode}.txt" || { reh_drop; die "sidik jari riwayat migrasi gagal"; }
  S_SEBELUM="$(RPSQL "$SKEMA_SQL")"; K_SEBELUM="$(RPSQL "$KATALOG_SQL")"; [ -n "$S_SEBELUM" ] && [ -n "$K_SEBELUM" ] || { reh_drop; die "sidik jari skema/katalog kosong"; }
  SALDO_SEBELUM="$(RPSQL "select md5(coalesce(string_agg(material_id::text||':'||q::text, '|' order by material_id),'')) from (select material_id, sum(qty) q from stock_movements group by material_id) s")"
  N_SM="$(RPSQL "select count(*) from stock_movements")"; N_TABEL_SEBELUM="$(RPSQL "select count(*) from pg_tables where schemaname='public'")"
  ok "garis dasar rehearsal: $(printf '%s\n' "$TABEL_LAMA" | grep -c .) tabel lama disidik-jari; stock_movements=${N_SM} baris; saldo per bahan ${SALDO_SEBELUM:0:12}"
  # 4) Migrasi
  if [ "$mode" = "git" ]; then
    { printf '\\timing on\n'; for e in $MIGS; do sg show "${DEPLOY_SHA}:backend/prisma/migrations/${e%%:*}/migration.sql" | tr -d '\r'; done; } | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=1 -X -q > "$BK_DIR/migrate-rehearsal-${mode}.log" 2>&1 || { tail -n 12 "$BK_DIR/migrate-rehearsal-${mode}.log"; reh_drop; die "migrasi pada DB rehearsal GAGAL (produksi tidak disentuh)"; }
    MAKS_MS="$(grep -o 'Time: [0-9.]*' "$BK_DIR/migrate-rehearsal-${mode}.log" | awk '{ if ($2+0 > m) m = $2+0 } END { printf "%.1f", m+0 }')"
    TOTAL_MS="$(grep -o 'Time: [0-9.]*' "$BK_DIR/migrate-rehearsal-${mode}.log" | awk '{ t += $2 } END { printf "%.1f", t+0 }')"
    ok "migrasi diterapkan pada DB rehearsal: $(grep -c 'Time:' "$BK_DIR/migrate-rehearsal-${mode}.log") pernyataan, total ${TOTAL_MS} ms, terlama ${MAKS_MS} ms (stock_movements ${N_SM} baris) — kunci tabel hanya sepanjang itu"
  else
    REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
    [ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
    REH_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
    REH_PEND="$(comm -23 <(ls -1 "$CAND_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
    [ "$(printf '%s\n' "$REH_PEND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat migrasi rilis ini: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
    T_A="$(date +%s%N)"
    bk_run -e DATABASE_URL="$REH_URL" -- npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal-${mode}.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal-${mode}.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
    T_B="$(date +%s%N)"
    bk_run -e DATABASE_URL="$REH_URL" -- npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
    ok "prisma migrate deploy pada DB rehearsal: $(( (T_B - T_A) / 1000000 )) ms (termasuk start container); status up to date"
  fi
  # 5) STRUKTUR: 3 tabel baru KOSONG; kolom/tipe sesuai; 3 FK RESTRICT + CHECK + indeks + 2 trigger append-only terpasang dan tervalidasi; tabel lama identik (skema + katalog objek)
  [ "$(RPSQL "select count(*) from pg_tables where schemaname='public' and tablename in ('production_unit_work_progress','production_unit_material_plans','production_unit_material_plan_revisions')")" = "3" ] || { reh_drop; die "3 tabel adopsi tidak terpasang"; }
  [ "$(RPSQL "select (select count(*) from production_unit_work_progress) + (select count(*) from production_unit_material_plans) + (select count(*) from production_unit_material_plan_revisions)")" = "0" ] || { reh_drop; die "tabel adopsi TIDAK kosong setelah migrasi (backfill tidak diizinkan)"; }
  [ "$(RPSQL "select count(*) from pg_constraint where conname in ('production_unit_work_progress_unit_id_fkey','production_unit_material_plans_unit_id_fkey','production_unit_material_plan_revisions_plan_id_fkey') and contype='f' and confdeltype='r' and convalidated")" = "3" ] || { reh_drop; die "3 FK ON DELETE RESTRICT tidak terpasang/tervalidasi"; }
  [ "$(RPSQL "select count(*) from pg_constraint where conname in ('production_unit_work_progress_status_chk','production_unit_material_plans_lines_array_chk') and contype='c' and convalidated")" = "2" ] || { reh_drop; die "2 CHECK adopsi tidak terpasang/tervalidasi"; }
  [ "$(RPSQL "select count(*) from pg_indexes where schemaname='public' and indexname in ('production_unit_work_progress_unit_id_created_at_idx','production_unit_material_plans_unit_id_key','production_unit_material_plan_revisions_plan_id_revision_key')")" = "3" ] || { reh_drop; die "3 indeks adopsi tidak terpasang"; }
  [ "$(RPSQL "select count(*) from pg_trigger where tgname in ('production_unit_work_progress_append_only_trg','production_unit_material_plan_revisions_append_only_trg') and not tgisinternal")" = "2" ] || { reh_drop; die "2 trigger append-only tidak terpasang"; }
  [ "$(RPSQL "select count(*) from pg_trigger where tgrelid = 'production_unit_material_plans'::regclass and not tgisinternal")" = "0" ] || { reh_drop; die "tabel rencana (boleh diubah) memiliki trigger (tidak diharapkan)"; }
  [ "$(RPSQL "select count(*) from pg_tables where schemaname='public'")" = "$(( N_TABEL_SEBELUM + 3 ))" ] || { reh_drop; die "migrasi MENAMBAH/MENGURANGI tabel selain 3 tabel adopsi"; }
  [ "$(RPSQL "$SKEMA_SQL")" = "$S_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH skema (kolom/tipe/nullable/default) tabel lama"; }
  [ "$(RPSQL "$KATALOG_SQL")" = "$K_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH indeks/constraint/trigger tabel lama"; }
  ok "struktur: 3 tabel baru kosong; 3 FK RESTRICT + 2 CHECK + 3 indeks + 2 trigger append-only tervalidasi; tabel lama (skema + indeks/constraint/trigger) identik; jumlah tabel ${N_TABEL_SEBELUM} → $(( N_TABEL_SEBELUM + 3 ))"
  # 6) UJI PERILAKU constraint/trigger/FK memakai baris NYATA hasil restore (unit + pengguna asli); SELURUHNYA dibatalkan (RAISE di akhir)
  cat > "$BK_DIR/uji-perilaku-${mode}.sql" <<'UJISQL'
DO $t$
DECLARE u uuid; usr text; pl uuid := gen_random_uuid(); w1 uuid := gen_random_uuid(); r1 uuid := gen_random_uuid(); tolak int := 0; lolos int := 0;
BEGIN
  SELECT id INTO u FROM units ORDER BY created_at, id LIMIT 1;
  SELECT id INTO usr FROM "User" ORDER BY id LIMIT 1;
  IF u IS NULL OR usr IS NULL THEN RAISE EXCEPTION 'DATA_CONTOH_KURANG'; END IF;
  -- YANG SAH (5)
  INSERT INTO production_unit_work_progress (id, unit_id, status, note, actor_id) VALUES (w1, u, 'DIKERJAKAN', 'uji sah', usr); lolos := lolos + 1;
  INSERT INTO production_unit_work_progress (id, unit_id, status, actor_id) VALUES (gen_random_uuid(), u, 'SELESAI', usr); lolos := lolos + 1;
  INSERT INTO production_unit_material_plans (id, unit_id, revision, lines, created_by_id, updated_by_id) VALUES (pl, u, 1, '[{"materialId":"00000000-0000-4000-8000-000000000000","qty":1}]'::jsonb, usr, usr); lolos := lolos + 1;
  INSERT INTO production_unit_material_plan_revisions (id, plan_id, revision, lines, reason, actor_id) VALUES (r1, pl, 1, '[]'::jsonb, 'uji sah', usr); lolos := lolos + 1;
  UPDATE production_unit_material_plans SET revision = 2, updated_at = now() WHERE id = pl; lolos := lolos + 1;
  -- YANG HARUS DITOLAK: bentuk data
  BEGIN INSERT INTO production_unit_work_progress (id, unit_id, status) VALUES (gen_random_uuid(), u, 'LIAR'); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_status_liar';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_work_progress (id, unit_id, status) VALUES (gen_random_uuid(), gen_random_uuid(), 'DIKERJAKAN'); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_unit_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_material_plans (id, unit_id, revision, lines) VALUES (gen_random_uuid(), u, 1, '{}'::jsonb); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_lines_bukan_array';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_material_plans (id, unit_id, revision, lines) VALUES (gen_random_uuid(), u, 1, '[]'::jsonb); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_rencana_ganda_per_unit';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_material_plan_revisions (id, plan_id, revision, lines) VALUES (gen_random_uuid(), pl, 1, '[]'::jsonb); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_revisi_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO production_unit_material_plan_revisions (id, plan_id, revision, lines) VALUES (gen_random_uuid(), gen_random_uuid(), 1, '[]'::jsonb); RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_rencana_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  -- append-only (trigger): riwayat status kerja dan revisi rencana tidak bisa diubah/dihapus
  BEGIN UPDATE production_unit_work_progress SET note = 'diubah' WHERE id = w1; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_ubah_riwayat_kerja';
  EXCEPTION WHEN sqlstate 'P0001' THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM production_unit_work_progress WHERE id = w1; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_hapus_riwayat_kerja';
  EXCEPTION WHEN sqlstate 'P0001' THEN tolak := tolak + 1; END;
  BEGIN UPDATE production_unit_material_plan_revisions SET reason = 'diubah' WHERE id = r1; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_ubah_revisi';
  EXCEPTION WHEN sqlstate 'P0001' THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM production_unit_material_plan_revisions WHERE id = r1; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_hapus_revisi';
  EXCEPTION WHEN sqlstate 'P0001' THEN tolak := tolak + 1; END;
  -- FK RESTRICT: unit yang punya catatan, dan rencana yang punya revisi, tidak bisa dihapus
  BEGIN DELETE FROM units WHERE id = u; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_hapus_unit_berjejak';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM production_unit_material_plans WHERE id = pl; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_hapus_rencana_berrevisi';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
  UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku-${mode}.sql" 2>&1 || true)"
  printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku-${mode}.out"
  printf '%s\n' "$UJI_OUT" | grep -q 'DATA_CONTOH_KURANG' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data contoh di hasil restore kurang (butuh >=1 unit dan >=1 pengguna)"; }
  printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
  printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint/trigger/FK SALAH (ada data yang seharusnya ditolak lolos)"; }
  UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
  UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
  [ "$UJI_TOLAK" = "12" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti ${UJI_TOLAK:-?} (harus 12)"; }
  [ "$UJI_LOLOS" = "5" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data sah yang lolos ${UJI_LOLOS:-?} (harus 5)"; }
  ok "perilaku terbukti pada hasil restore: ${UJI_TOLAK} penolakan (CHECK status, CHECK lines, FK unit/rencana, unik rencana per unit, unik revisi, trigger append-only ×4, RESTRICT ×2) dan ${UJI_LOLOS} operasi sah lolos; seluruh uji dibatalkan"
  # 7) Mode image: kode BARU terhadap data restore yang SUDAH dimigrasi (baca-saja)
  if [ "$mode" = "image" ]; then
    bk_run -e DATABASE_URL="$REH_URL" -- node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-kode-baru.log" 2>&1 || { cat "$BK_DIR/rehearsal-kode-baru.log"; reh_drop; die "pemeriksaan kode baru terhadap data restore GAGAL"; }
// Pemeriksaan KODE BARU terhadap data restore yang SUDAH dimigrasi (rehearsal mode image; BACA-SAJA — tidak ada tulisan). Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const prisma = new PrismaClient();
const { listWorkOrders } = await import("/app/src/services/productionOrderList.js");
const { buatWorkbookOrderProduksi } = await import("/app/src/services/productionOrderExport.js");
const { katalogBahan, ambilRencanaBahan, ambilPemakaianAktual } = await import("/app/src/services/productionAdoptionService.js");
const { WORK_STATUS } = await import("/app/src/lib/domain/productionWorkStatus.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 200) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const awal = {
  sm: await hitung("select count(*)::int n from stock_movements"), unit: await hitung("select count(*)::int n from units"), job: await hitung("select count(*)::int n from jobs"), run: await hitung("select count(*)::int n from production_runs_v2"),
  qc: await hitung("select count(*)::int n from quality_inspections_v2"), jur: await hitung("select count(*)::int n from fin_journal_entries"), cmd: await hitung("select count(*)::int n from v2_commands"), act: await hitung("select count(*)::int n from activity_events"),
};
cek("data restore memuat unit nyata", awal.unit > 0, "unit=" + awal.unit);
for (const t of ["production_unit_work_progress", "production_unit_material_plans", "production_unit_material_plan_revisions"]) cek(`tabel baru ${t} kosong (tanpa backfill)`, (await hitung(`select count(*)::int n from ${t}`)) === 0);

// ── daftar Order Produksi: SEMUA unit nyata terbaca dengan kontrak tiga sumbu
const daftar = await listWorkOrders(prisma, { pageSize: "200" }, { semua: true });
cek("daftar memuat semua unit (jumlah = tabel units)", daftar.units.length === awal.unit && daftar.total === awal.unit, `${daftar.units.length}/${awal.unit}`);
const salah = daftar.units.filter((u) => !u.adopsi?.kerja || !WORK_STATUS[u.adopsi.kerja.key] || !u.adopsi.statusOrder?.label || !u.adopsi.posisi?.key || !u.adopsi.tindakan?.label);
cek("setiap unit punya status order + posisi + status kerja (kosakata kamus) + tindakan berikutnya", salah.length === 0, salah.slice(0, 3).map((u) => u.unitCode).join(","));
cek("tanpa catatan manual di data restore: tidak ada status kerja bersumber MANUAL", daftar.units.every((u) => u.adopsi.kerja.source !== "MANUAL"));
cek("satu unit = satu status kerja (tidak ada kunci ganda)", new Set(daftar.units.map((u) => u.id)).size === daftar.units.length);
const per = (k) => daftar.units.filter((u) => u.adopsi.kerja.key === k).length;
console.log(`INFO status kerja: ${Object.keys(WORK_STATUS).map((k) => `${k}=${per(k)}`).join(" ")}`);
const sesat = daftar.units.filter((u) => u.status === "CANCELLED" && u.adopsi.kerja.key !== "DIBATALKAN");
cek("unit dibatalkan selalu berstatus kerja Dibatalkan", sesat.length === 0);
const selesaiOrder = daftar.units.filter((u) => ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"].includes(u.status) && !u.adopsi.buktiAplikasi);
cek("unit Siap Kirim ke atas tanpa bukti aplikasi = status kerja Selesai (mengikuti status order)", selesaiOrder.every((u) => u.adopsi.kerja.key === "SELESAI"), `n=${selesaiOrder.length}`);
// filter status kerja memakai kamus yang sama
const f = await listWorkOrders(prisma, { statusKerja: "BELUM_DIJADWALKAN", pageSize: "200" }, {});
cek("filter statusKerja=BELUM_DIJADWALKAN konsisten dengan daftar penuh", f.total === per("BELUM_DIJADWALKAN"), `${f.total}/${per("BELUM_DIJADWALKAN")}`);
// kontrak lama tetap ada (aditif)
cek("field lama tetap ada (globalStatus, unitStatusDisplay, productionStatus, priorityDisplay)", daftar.units.every((u) => u.globalStatus && u.unitStatusDisplay && u.productionStatus && u.priorityDisplay));

// ── katalog bahan per kelompok dan pemakaian aktual dari ledger nyata
const kat = await katalogBahan(prisma, { limit: "300" });
cek("katalog bahan: kelompok Gudang terbaca, bahan aktif ada", kat.kelompok.length >= 8 && kat.total > 0, `bahan=${kat.total}; kelompok=${kat.kelompok.map((k) => `${k.kode}:${k.jumlah}`).join(" ")}`);
cek("katalog: saldo tidak diketahui TIDAK tampil sebagai nol", kat.rows.every((r) => r.saldoDiketahui || (r.saldo === null && r.tersedia === null)));
const unitIssue = (await prisma.$queryRawUnsafe(`select unit_id::text id, count(*)::int n from stock_movements where unit_id is not null and type::text = 'ISSUE' group by unit_id order by n desc limit 5`));
for (const u of unitIssue) {
  const a = await ambilPemakaianAktual(prisma, u.id); const r = await ambilRencanaBahan(prisma, u.id);
  cek(`pemakaian aktual unit ${u.id.slice(0, 8)}: ${u.n} pergerakan ISSUE terbaca lengkap dengan pelaku`, a.baris.filter((b) => b.tipe === "ISSUE").length === u.n && a.baris.every((b) => b.dokumen?.jenis), `${a.baris.length} baris`);
  cek(`rencana bahan unit ${u.id.slice(0, 8)}: kosong (belum dibuat), pemakaian aktual tidak dianggap rencana`, r.plan === null);
}
if (!unitIssue.length) console.log("INFO tidak ada unit dengan pergerakan ISSUE di data restore (pemeriksaan pemakaian aktual dilewati)");

// ── ekspor Excel dari data nyata (di memori): jumlah baris = daftar
const buf = await buatWorkbookOrderProduksi(prisma, { rows: daftar.units, unitIds: daftar.units.map((u) => u.id), filter: daftar.filterDipakai, pengguna: "rehearsal" });
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(buf));
const ws = wb.getWorksheet("Ringkasan Unit");
cek("ekspor xlsx: 4 sheet, baris data = jumlah unit, AutoFilter + freeze header", wb.worksheets.length === 4 && ws.rowCount - 1 === daftar.units.length && !!ws.autoFilter && ws.views?.[0]?.ySplit === 1, `sheet=${wb.worksheets.map((s) => s.name).join("|")} baris=${ws.rowCount - 1}`);

// ── tidak ada tulisan
const akhir = {
  sm: await hitung("select count(*)::int n from stock_movements"), unit: await hitung("select count(*)::int n from units"), job: await hitung("select count(*)::int n from jobs"), run: await hitung("select count(*)::int n from production_runs_v2"),
  qc: await hitung("select count(*)::int n from quality_inspections_v2"), jur: await hitung("select count(*)::int n from fin_journal_entries"), cmd: await hitung("select count(*)::int n from v2_commands"), act: await hitung("select count(*)::int n from activity_events"),
};
for (const k of Object.keys(awal)) cek(`tidak ada tulisan: ${k} tetap ${awal[k]}`, akhir[k] === awal[k]);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
REHNODE
    ok "kode baru terhadap data restore yang sudah dimigrasi: $(tail -n 1 "$BK_DIR/rehearsal-kode-baru.log"); $(grep -c '^PASS' "$BK_DIR/rehearsal-kode-baru.log") pemeriksaan lulus"
  fi
  # 8) SESUDAH: isi semua tabel lama identik; saldo identik; riwayat migrasi lama identik; tidak ada data uji tersisa
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sesudah-${mode}.txt" || { reh_drop; die "sidik jari penuh sesudah gagal"; }
  cmp -s "$BK_DIR/fp-all-sebelum-${mode}.txt" "$BK_DIR/fp-all-sesudah-${mode}.txt" || { diff "$BK_DIR/fp-all-sebelum-${mode}.txt" "$BK_DIR/fp-all-sesudah-${mode}.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
  [ "$(RPSQL "select md5(coalesce(string_agg(material_id::text||':'||q::text, '|' order by material_id),'')) from (select material_id, sum(qty) q from stock_movements group by material_id) s")" = "$SALDO_SEBELUM" ] || { reh_drop; die "saldo per bahan BERUBAH oleh migrasi/uji"; }
  [ "$(RPSQL "select count(*) from stock_movements")" = "$N_SM" ] || { reh_drop; die "jumlah pergerakan stok berubah"; }
  [ "$(RPSQL "select (select count(*) from production_unit_work_progress) + (select count(*) from production_unit_material_plans) + (select count(*) from production_unit_material_plan_revisions)")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan (tabel adopsi tidak kosong)"; }
  [ "$(RPSQL "select md5(coalesce(string_agg(migration_name||':'||checksum, ',' order by migration_name),'')) from _prisma_migrations where migration_name <> '${MIG_LIST# }'")" = "$(cat "$BK_DIR/mig-hash-sebelum-${mode}.txt")" ] || { reh_drop; die "riwayat migrasi lama (checksum) BERUBAH"; }
  RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku-sesudah-${mode}.txt" || { reh_drop; die "sidik jari beku sesudah gagal"; }
  cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku-sesudah-${mode}.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku-sesudah-${mode}.txt" || true; reh_drop; die "dokumen pembanding beku (stok, saldo, jurnal, PO, tagihan, pembayaran, Produksi) berubah oleh migrasi/uji"; }
  if [ "$REHEARSAL_PENUH" = "1" ]; then rehearsal_penuh_lanjutan; fi
  reh_drop
  ok "rehearsal (${mode}) lulus: isi $(printf '%s\n' "$TABEL_LAMA" | grep -c .) tabel lama IDENTIK sebelum vs sesudah; saldo per bahan + jurnal + PO + tagihan + pembayaran + Produksi tidak berubah; DB sementara dihapus"
}

if [ "$REHEARSAL_ONLY" = "1" ]; then
  # MODE --rehearsal-only: backup NYATA + restore ke DB sementara + migrasi (SQL dari git) + uji; TANPA build image, TANPA release dir, TANPA migrasi/switch produksi. DB sementara selalu dihapus.
  PHASE="3b-rehearsal-saja"; say "3b. REHEARSAL SAJA: restore backup NYATA ke DB sementara, migrasi (SQL dari git, bukan dari produksi), uji perilaku, bandingkan sidik jari (produksi tidak diubah)"
  rehearsal git
  say "Rehearsal selesai (--rehearsal-only): PRODUKSI TIDAK DIUBAH (tanpa build, tanpa release dir, tanpa migrasi produksi, tanpa switch). Backup: ${BACKUP_FILE}"
  trap - EXIT; exit 0
fi

if [ "$REHEARSAL_PENUH" = "1" ]; then
  PHASE="3c-rehearsal-penuh"; say "3c. REHEARSAL PENUH: build web + image kandidat bertag rehearsal (tag production tidak disentuh), restore backup NYATA, migrasi pada DB rehearsal, skenario — production TIDAK diubah selain backup dan DB sementara"
  WS="$HOME/release-rehearsal/opa-${DEPLOY_SHORT}-${TS}"; CAND_DIR="$WS"; REH_IMG="${IMG_NAME%%:*}:rehearsal-opa-${DEPLOY_SHORT}"
  NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" | awk '{print $1}')"; [ -n "$NET" ] || die "jaringan docker postgres tidak terbaca"
  [ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
  mkdir -p "$WS" || die "gagal membuat ${WS}"
  sg archive "$DEPLOY_SHA" | tar -x -C "$WS" --exclude='frontend/dist' || die "git archive gagal"
  [ ! -e "$WS/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
  for f in backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-order-produksi-adopsi.sh scripts/lib/rehearsal-skenario-order-produksi-adopsi.mjs scripts/lib/smoke-order-produksi-adopsi.mjs scripts/lib/rehearsal-kode-lama-order-produksi-adopsi.mjs docker-compose.yml docker-compose.release.yml; do [ -f "$WS/$f" ] || die "direktori kerja tidak lengkap: $f"; done
  cp -a "$NM_SRC" "$WS/frontend/node_modules" || die "gagal menyalin node_modules frontend"
  install -m 600 "$PERSIST/frontend/.env" "$WS/frontend/.env" || die "gagal menyalin frontend/.env"
  ( cd "$WS/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$WS/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (production tidak berubah)"; }
  rm -f "$WS/frontend/.env"
  RH_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$WS/frontend/dist/index.html" | sed -n 1p)"; [ -n "$RH_INDEX" ] && [ -f "$WS/frontend/dist/assets/$RH_INDEX" ] || die "hasil build frontend tidak valid"
  for s1 in "Rencana · tidak mengurangi stok" "Aktual · mengurangi stok" "Catat status kerja" "Belum ada catatan pekerjaan"; do [ -n "$(grep -lF "$s1" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal TIDAK memuat teks fitur rilis ini: ${s1}"; done
  for s2 in "Ajukan Koreksi Stok" "Koreksi Penerimaan" "Konfirmasi Barang Jadi" "Selesaikan Produksi" "Rencana Produksi" "Uang muka dialokasikan ke faktur" "Tetapkan Siap Kirim (override)" "Riwayat referensi dari file (bukan transaksi)" "Simpan ke Stok" "Barang Akan Datang"; do [ -n "$(grep -lF "$s2" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal KEHILANGAN teks fitur lama: ${s2}"; done
  [ "$RH_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel rehearsal identik dengan live"
  ok "build web kandidat: ${RH_INDEX} (live ${PREV_INDEX}); teks fitur Order Produksi baru ada; teks fitur live lama tetap ada"
  docker build -t "$REH_IMG" -f "$WS/backend/Dockerfile" "$WS/backend" > "$BK_DIR/build-rehearsal.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build-rehearsal.log"; die "build image rehearsal gagal (production tidak berubah)"; }
  RH_IMG_ID="$(docker image inspect -f '{{.Id}}' "$REH_IMG")"; [ "$RH_IMG_ID" != "$PREV_IMG_ID" ] || die "image rehearsal identik dengan live"
  [ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag image PRODUCTION berubah selama build — berhenti"
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
  ok "image rehearsal ${REH_IMG} (${RH_IMG_ID:7:12}); tag production ${IMG_NAME} tetap ${PREV_IMG_ID:7:12}; container aktif tidak tersentuh"
  PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, migrasi dengan image kandidat, uji perilaku, kode baru terhadap data restore, sidik jari semua tabel lama, lalu skenario (DB production tidak disentuh)"
  rehearsal image
  cleanup_penuh
  PHASE="3d-production-tidak-berubah"; say "3d. Verifikasi production TIDAK berubah oleh rehearsal"
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] && [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] && [ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "0" ] && [ "$(docker inspect -f '{{.State.Running}}' "$CID_OLD")" = "true" ] || die "container production berubah"
  curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal setelah rehearsal gagal"
  psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sesudah-rehearsal.txt"
  cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sesudah-rehearsal.txt" || die "daftar migrasi production berubah selama rehearsal"
  [ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename in ('production_unit_work_progress','production_unit_material_plans','production_unit_material_plan_revisions')")" = "0" ] || die "tabel adopsi muncul di production (rehearsal tidak boleh memigrasi production)"
  psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sesudah-rehearsal.txt" || die "sidik jari beku production sesudah rehearsal gagal"
  diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" || true; die "dokumen pembanding production BERUBAH selama rehearsal"; }
  [ "$(psql_live -At -c "select count(*) from pg_database where datname like 'rehearsal_opa_test_%'")" = "0" ] || die "DB rehearsal masih tersisa di server"
  [ ! -e "$WS" ] || die "direktori kerja rehearsal masih ada"
  [ -z "$(docker images -q "$REH_IMG")" ] || die "image rehearsal masih ada"
  ok "production TIDAK berubah: container/image/release sama, 0 restart, migrasi sama (${MIG_SEBELUM}), 17 kelompok dokumen pembanding identik, tanpa tabel adopsi, DB rehearsal + direktori kerja + image rehearsal sudah dihapus; satu-satunya jejak: backup ${BACKUP_FILE}"
  trap - EXIT
  printf 'BASE=%s\nDEPLOY=%s\nTS=%s\nTES=%s\nRETRY=%s\n' "$BASE_SHA" "$DEPLOY_SHA" "$TS" "$TES_N_EXPECT" "$TES_ULANG_INFO" > "$HOME/release-backups/.rehearsal-penuh-ok-order-produksi-adopsi-${DEPLOY_SHA}"
  say "REHEARSAL PENUH SELESAI — production TIDAK diubah, tidak ada deploy, tidak ada status kerja/rencana/pemakaian dibuat di production. Backup: ${BACKUP_FILE}. Log: ${BK_DIR}/release.log"
  exit 0
fi

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-order-produksi-adopsi.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
# Fitur rilis ini harus ada di bundel baru; fitur live sebelumnya (verifikasi ADA di dist release aktif dulu) tidak boleh hilang.
for s1 in "Rencana · tidak mengurangi stok" "Aktual · mengurangi stok" "Catat status kerja" "Belum ada catatan pekerjaan"; do
  [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru TIDAK memuat teks fitur rilis ini: ${s1}"
done
for s2 in "Ajukan Koreksi Stok" "Koreksi Penerimaan" "Konfirmasi Barang Jadi" "Selesaikan Produksi" "Rencana Produksi" "Uang muka dialokasikan ke faktur" "Tetapkan Siap Kirim (override)" "Riwayat referensi dari file (bukan transaksi)" "Simpan ke Stok" "Barang Akan Datang"; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur Order Produksi baru ada; teks fitur live lama tetap ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-opa-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, migrasi dengan image baru, uji perilaku, kode baru terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
rehearsal image

PHASE="6-migrate"; say "6. Migrasi aditif (image baru; backend lama tetap melayani)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum migrasi"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum migrasi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum2.txt" || die "gagal membaca migrasi terpasang"
cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sebelum2.txt" || die "daftar migrasi terpasang berubah selama persiapan (sesi lain menerapkan migrasi) — berhenti, ulangi preflight"
for m in $MIG_LIST; do grep -Fx "$m" "$BK_DIR/applied-sebelum2.txt" >/dev/null && die "migrasi ${m} SUDAH terpasang sebelum rilis (tidak diharapkan)"; done
SOLO_PROD="$(comm -13 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) "$BK_DIR/applied-sebelum2.txt" || true)"
[ -z "$SOLO_PROD" ] || die "produksi memiliki migrasi yang TIDAK ada di image baru: $(printf '%s' "$SOLO_PROD" | tr '\n' ' ')"
PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) "$BK_DIR/applied-sebelum2.txt" || true)"
[ "$(printf '%s\n' "$PENDING" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || die "migrasi pending bukan tepat migrasi rilis ini: $(printf '%s' "$PENDING" | tr '\n' ' ')"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-migrasi.txt" || die "sidik jari beku pra-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH sebelum migrasi"; }
psql_live -At -c "$SKEMA_SQL" > "$BK_DIR/skema-prod-sebelum.txt" || die "sidik jari skema produksi sebelum gagal"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang != sebelum + 1"
for m in $MIG_LIST; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
[ "$(psql_live -At -c "select (select count(*) from production_unit_work_progress) + (select count(*) from production_unit_material_plans) + (select count(*) from production_unit_material_plan_revisions)")" = "0" ] || die "tabel adopsi TIDAK kosong tepat setelah migrasi"
[ "$(psql_live -At -c "select count(*) from pg_constraint where conname in ('production_unit_work_progress_unit_id_fkey','production_unit_material_plans_unit_id_fkey','production_unit_material_plan_revisions_plan_id_fkey') and confdeltype='r' and convalidated")" = "3" ] || die "3 FK RESTRICT adopsi tidak terpasang/tervalidasi"
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$(cat "$BK_DIR/skema-prod-sebelum.txt")" ] || die "skema tabel lama BERUBAH oleh migrasi (jangan switch)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi aditif"
ok "1 migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); 3 tabel adopsi kosong; skema tabel lama identik; backend lama tetap sehat"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari beku pasca-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: dokumen pembanding beku IDENTIK"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
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
[ "$(PSQLN "select count(*) from pg_tables where schemaname='public' and tablename in ('production_unit_work_progress','production_unit_material_plans','production_unit_material_plan_revisions')")" = "3" ] || die "tabel adopsi tidak ada di produksi"
[ "$(PSQLN "select (select count(*) from production_unit_work_progress) + (select count(*) from production_unit_material_plans) + (select count(*) from production_unit_material_plan_revisions)")" = "0" ] || die "ada catatan adopsi tepat setelah switch (tidak ada yang boleh membuatnya)"
ok "objek rilis terpasang di produksi: 3 tabel adopsi (kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin, penolakan sebelum menyentuh data, daftar tiga status, panel unit nyata, katalog per kelompok, ekspor xlsx, pagar tulis; tidak ada tulisan"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
// Smoke BACA-SAJA rilis "Order Produksi adopsi Admin" terhadap backend yang SUDAH melayani (container baru; atau server rehearsal bila SMOKE_BASE diisi). Tidak membuat status kerja, rencana bahan, pemakaian bahan, stok, jurnal, job, Run, atau QC.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, status/UUID/kunci tidak valid).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(method, path, token, body, headers = {}, mentah = false) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  if (mentah) return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const admin = cari((r) => r.includes("ADMIN") && punya(r, P.UNIT_READ) && punya(r, P.UNIT_ROUTING_WRITE) && punya(r, P.UNIT_MATERIAL_WRITE) && punya(r, P.ORDER_WRITE));
const hanyaLihat = cari((r) => punya(r, P.UNIT_READ) && !punya(r, P.UNIT_ROUTING_WRITE) && !punya(r, P.UNIT_MATERIAL_WRITE));
const tanpaBaca = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.UNIT_READ));
if (!admin) { rec("akun ADMIN aktif dengan izin Produksi lengkap tersedia", false); process.exit(1); }
const tA = tokenUntuk(admin);
const nol = "00000000-0000-4000-8000-000000000000";
const PR = "/api/production";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TULIS = {
  sm: "select count(*)::int n from stock_movements", cmd: "select count(*)::int n from v2_commands", prog: "select count(*)::int n from production_unit_work_progress", plan: "select count(*)::int n from production_unit_material_plans",
  rev: "select count(*)::int n from production_unit_material_plan_revisions", job: "select count(*)::int n from jobs", run: "select count(*)::int n from production_runs_v2", qc: "select count(*)::int n from quality_inspections_v2", jur: "select count(*)::int n from fin_journal_entries",
};
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);
const nUnit = await hitung("select count(*)::int n from units");

// ── Pintu: tanpa token / tanpa izin / bentuk salah — gagal SEBELUM menyentuh data ──
rec("panel unit tanpa token → 401", (await api("GET", `${PR}/units/${nol}/adopsi`, null)).status === 401);
rec("ekspor tanpa token → 401", (await api("GET", `${PR}/work-orders/export.xlsx`, null)).status === 401);
rec("catat status kerja tanpa token → 401", (await api("POST", `${PR}/units/${nol}/work-progress`, null, { status: "DIKERJAKAN" })).status === 401);
rec("simpan rencana bahan tanpa token → 401", (await api("PUT", `${PR}/units/${nol}/material-plan`, null, { lines: [] })).status === 401);
if (tanpaBaca) { const s = (await api("GET", `${PR}/work-orders`, tokenUntuk(tanpaBaca))).status; rec("daftar Order Produksi akun tanpa izin baca Unit → 403", s === 403, String(s)); } else skip("daftar 403", "tidak ada akun aktif tanpa izin baca Unit");
if (hanyaLihat) {
  const t = tokenUntuk(hanyaLihat);
  const a = (await api("POST", `${PR}/units/${nol}/work-progress`, t, { status: "DIKERJAKAN" })).status; rec("catat status kerja akun hanya-lihat → 403 (sebelum menyentuh data)", a === 403, String(a));
  const b = (await api("PUT", `${PR}/units/${nol}/material-plan`, t, { lines: [], expectedRevision: 0 })).status; rec("simpan rencana bahan akun hanya-lihat → 403", b === 403, String(b));
  const c = (await api("GET", `${PR}/work-orders`, t)).status; rec("akun hanya-lihat tetap bisa membaca daftar → 200", c === 200, String(c));
} else skip("akun hanya-lihat", "tidak ada akun aktif dengan izin baca tetapi tanpa izin tulis Unit");
const k1 = await api("POST", `${PR}/units/${nol}/work-progress`, tA, { status: "LIAR" });
rec("status kerja tidak valid → 400 (kamus dijaga; tidak menulis)", k1.status === 400 && k1.json?.code === "STATUS_KERJA_TIDAK_VALID", `${k1.status} ${k1.json?.code}`);
rec("UUID unit tidak valid → 400", (await api("POST", `${PR}/units/bukan-uuid/work-progress`, tA, { status: "DIKERJAKAN" })).status === 400);
rec("panel unit tidak ada → 404", (await api("GET", `${PR}/units/${nol}/adopsi`, tA)).status === 404);

// ── Baca: daftar tiga sumbu, panel unit nyata, katalog per kelompok, ekspor xlsx ──
const daftar = await api("GET", `${PR}/work-orders?pageSize=200`, tA);
const baris = daftar.json?.units ?? [];
rec("daftar Order Produksi: 200, total = jumlah unit di database (toleransi 5 unit baru saat smoke berjalan)", daftar.status === 200 && Math.abs((daftar.json?.total ?? -99) - nUnit) <= 5, `total=${daftar.json?.total} unit=${nUnit}`);
rec("daftar: setiap baris memuat status order + posisi + status kerja + tindakan berikutnya", baris.length > 0 && baris.every((u) => u.adopsi?.statusOrder?.label && u.adopsi?.posisi?.key && u.adopsi?.kerja?.key && u.adopsi?.tindakan?.label), `n=${baris.length}`);
rec("daftar: kontrak lama utuh (globalStatus, unitStatusDisplay, productionStatus)", baris.every((u) => u.globalStatus && u.unitStatusDisplay && u.productionStatus));
rec("daftar: tanpa catatan manual → tidak ada status kerja bersumber MANUAL sebelum ada yang mencatat", awal.prog > 0 || baris.every((u) => u.adopsi.kerja.source !== "MANUAL"));
const f = await api("GET", `${PR}/work-orders?statusKerja=BELUM_DIJADWALKAN&pageSize=200`, tA);
rec("filter statusKerja bekerja di server (hasil ⊆ daftar, semuanya Belum dijadwalkan)", f.status === 200 && (f.json?.units ?? []).every((u) => u.adopsi.kerja.key === "BELUM_DIJADWALKAN") && f.json.total <= nUnit, `${f.json?.total}`);
const u1 = baris.find((u) => !["CANCELLED"].includes(u.status)) ?? baris[0];
if (u1) {
  const p = await api("GET", `${PR}/units/${u1.id}/adopsi`, tA);
  rec(`panel unit ${u1.unitCode}: 200, memuat unit + order + adopsi + rencana + pemakaian aktual + riwayat + izin`, p.status === 200 && p.json?.unit?.id === u1.id && p.json?.adopsi?.kerja && p.json?.rencanaBahan && p.json?.pemakaianAktual && Array.isArray(p.json?.riwayat) && p.json?.izin, String(p.status));
  rec("panel: izin Admin lengkap (status order, status kerja, target, rencana, pemakaian aktual)", p.json?.izin?.statusOrder && p.json?.izin?.statusKerja && p.json?.izin?.target && p.json?.izin?.rencanaBahan && p.json?.izin?.pemakaianAktual);
  const r = await api("GET", `${PR}/units/${u1.id}/material-plan`, tA);
  rec("rencana bahan unit: 200 (belum ada rencana = kosong, bukan galat)", r.status === 200 && (r.json?.plan === null || Array.isArray(r.json?.plan?.lines)), String(r.status));
} else skip("panel unit nyata", "tidak ada unit di database");
const kat = await api("GET", `${PR}/material-catalog?limit=40`, tA);
rec("katalog bahan: 200, kelompok Gudang + bahan aktif + saldo tidak diketahui tidak tampil nol", kat.status === 200 && (kat.json?.kelompok?.length ?? 0) >= 8 && (kat.json?.rows ?? []).every((x) => x.saldoDiketahui || (x.saldo === null && x.tersedia === null)), `bahan=${kat.json?.total}`);
const ex = await api("GET", `${PR}/work-orders/export.xlsx`, tA, null, {}, true);
let wbOk = false; let wbInfo = "";
if (ex.status === 200) {
  try {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(ex.buf); const ws = wb.getWorksheet("Ringkasan Unit");
    wbOk = wb.worksheets.length === 4 && Math.abs(ws.rowCount - 1 - nUnit) <= 5 && !!ws.autoFilter && ws.views?.[0]?.ySplit === 1; wbInfo = `sheet=${wb.worksheets.map((s) => s.name).join("|")} baris=${ws.rowCount - 1}/${nUnit}`;
  } catch (e) { wbInfo = "galat baca: " + e.message; }
}
rec("ekspor xlsx: 200, tipe spreadsheet, 4 sheet, baris data = jumlah unit (±5), AutoFilter + freeze header", ex.status === 200 && /spreadsheetml\.sheet/.test(ex.headers.get("content-type") || "") && /attachment; filename="Order-Produksi-\d{8}-\d{4}\.xlsx"/.test(ex.headers.get("content-disposition") || "") && wbOk, `${ex.status} ${wbInfo}`);
// ── Pagar tulis: pintu yang gagal SEBELUM transaksi ──
const mat = await prisma.material.findFirst({ where: { active: true }, select: { id: true } });
if (mat && u1) {
  const s = await api("POST", `/api/units/${u1.id}/materials`, tA, { materialId: mat.id, qty: 1 }, { "Idempotency-Key": "pendek" });
  rec("pemakaian bahan dengan Idempotency-Key terlalu pendek → 400 IDEMPOTENCY_KEY_INVALID (tidak menulis stok)", s.status === 400 && s.json?.code === "IDEMPOTENCY_KEY_INVALID", `${s.status} ${s.json?.code}`);
} else skip("kunci idempoten pendek", "tidak ada bahan aktif atau unit");
// ── Jalur lama tidak rusak ──
rec("Unit 360 / daftar unit lama tetap 200", (await api("GET", `${PR}/board`, tA)).status === 200);
rec("daftar order (Sales) tetap 200", (await api("GET", "/api/orders?limit=5", tA)).status === 200);
// ── Tidak ada tulisan ──
for (const [k, q] of Object.entries(TULIS)) rec(`smoke tidak menulis: ${k} tetap ${awal[k]}`, (await hitung(q)) === awal[k]);
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP); " + baris.length + " unit nyata dibaca");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else ok "smoke test lulus (izin, penolakan sebelum menyentuh data, daftar tiga status, panel unit nyata, katalog per kelompok, ekspor xlsx, pagar tulis, tanpa tulisan)"; fi
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} tidak bisa diunduh (404) — pembawaan aset lama gagal"
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
ok "dokumen pembanding beku (pergerakan stok, saldo per bahan, jurnal Finance, id unit/job/Run/operasi/bukti tahap/log tahap/QC/serah/pembayaran/aktivitas) IDENTIK sebelum vs sesudah rilis"
# Pembersihan release lama (setelah rilis TERBUKTI sehat). Dipertahankan: 4 terbaru (mtime), release baru, release sebelumnya, dan release yang dirujuk container berjalan. Kegagalan di sini TIDAK menggagalkan rilis.
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
say "CATATAN: rilis ini TIDAK membuat status kerja, rencana bahan, atau pemakaian bahan. Pencatatan pertama dilakukan Admin lewat panel Order Produksi; mulai dengan satu unit uji yang disepakati lalu periksa Riwayat unit dan Excel hasil ekspor."
