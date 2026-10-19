#!/usr/bin/env bash
# RILIS "STOCK OPNAME PENUH + MODEL WAKTU" — BACKEND + WEB + 1 MIGRASI ADITIF (kolom baru pada stock_counts dan stock_count_lines). FAIL-CLOSED. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA).
#   Kode: sesi opname model 2 (cakupan tersimpan: penuh / per kelompok / Cycle Count; bahan yang saldonya DILACAK secara fisik), halaman kerja hitung, TIGA WAKTU terpisah (dihitung / disimpan / diposting), pembanding dari waktu pengamatan,
#   seluruh pergerakan sejak bahan dihitung diputuskan pemeriksa, Selesaikan tepat sekali dengan penyetuju berbeda. Sesi LAMA (model 1, termasuk yang berisi 106 bahan) tetap model 1 dan dibaca dengan aturan lama; tidak ada yang ditafsirkan ulang sebagai opname penuh.
#   Migrasi: 3 kolom pada stock_counts + 12 kolom pada stock_count_lines (NULL atau DEFAULT konstan; tanpa rewrite tabel) + 5 CHECK ringan. Tidak ada tabel/indeks/FK/trigger baru, tidak ada backfill, tidak ada perubahan data lama, tidak menyentuh ledger/jurnal/Finance.
#   Produksi: rilis ini TIDAK membuat sesi opname dan TIDAK menulis stok; smoke hanya baca + penolakan izin.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, pin sha256 migrasi, pemindai DDL + mutan negatif, tepat 1 migrasi pending) → (2) audit produksi baca-saja + sidik jari → (3) backup + restore nyata
#              → (4) build web + image → (5) REHEARSAL (restore nyata, migrasi dengan image baru, uji constraint, kode baru terhadap data restore, sidik jari sebelum=sesudah)
#              → (6) migrate deploy produksi SATU kali (backend lama tetap melayani) → (7) switch → (8) verifikasi + smoke baca-saja.
#
#   cat scripts/release-opname-penuh.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/op.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/op.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah (tanpa backup, tanpa DB sementara)
#   ssh ubuntu@43.133.152.6 'bash /tmp/op.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only'      # backup NYATA + restore ke DB sementara + migrasi (SQL dari git) + uji; TANPA build/release dir/migrasi produksi
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/op.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/op.out 2>&1 < /dev/null &'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/op.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-penuh [--tahan-ui=40] > /tmp/op.out 2>&1 < /dev/null &'
#        # REHEARSAL PENUH (tanpa deploy): backup NYATA + restore ke DB sementara + build web + image kandidat bertag rehearsal (TAG PRODUCTION TIDAK DISENTUH) + migrasi pada DB rehearsal + uji perilaku + sidik jari semua tabel
#        # + smoke baca-saja + skenario model waktu/konkurensi/klik ganda/sesi penuh nyata + guard rollback — SEMUA terhadap DB rehearsal lewat server Express minimal (tanpa cron/WAHA/Socket.IO, JWT acak bukan production).
#        # --tahan-ui=MENIT menahan DB rehearsal + server UI di 127.0.0.1:4311 (loopback VPS) untuk simulasi HP lewat terowongan SSH; berhenti setelah MENIT atau berkas rhctl/stop; DB lalu dihapus.
#
# ROLLBACK KODE: aman kapan saja SELAMA tidak ada sesi model baru yang terbuka (SCHEDULED / IN_PROGRESS / WAITING_REVIEW) — kode lama tidak mengenal sesi itu dan akan menulis penyesuaian keliru. Periksa dulu dengan
#   scripts/rollback-guard-opname-penuh.sh (baca-saja). Rollback kode TIDAK menghapus kolom/riwayat hitung/penyesuaian yang sudah diposting (saldo ledger tetap benar); yang hilang hanya halaman kerja hitung dan aturan waktu.

# (dibangkitkan oleh scripts/gen-release-opname-penuh.cjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang; templat sha256 955dea3b4723…)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/gudang-opname-penuh}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261222090000_stock_count_sesi_penuh:8726f69b325cd507d9a49d2bfe1be946aa46a2f07340f89f4a22232a21fd7c53"
# Hasil pemindai DDL untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":7,"alter_stock_counts":1,"alter_stock_count_lines":1,"check":5}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index dan tanpa nomor baris hunk) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="654870cbc97c951d406c63cf33d77b867b53dce56f1e20768b974ab14d2b1193"
# Migrasi live terakhir yang HARUS sudah terpasang di produksi dan ada di kandidat (Produksi: admin override siap kirim). Bila lebih baru muncul di produksi, gabungkan baseline terbaru dulu.
LIVE_MIG_TERAKHIR="20261220090000_gudang_koreksi_dokumen"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard rollback). Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261222090000_stock_count_sesi_penuh/migration\.sql|backend/prisma/schema\.prisma|backend/src/index\.js|backend/src/routes/stockCount\.js|backend/src/routes/stockCountSesi\.js|backend/src/services/dokumenGudangLain\.js|backend/src/services/opnameSesi\.js|backend/src/services/pergerakanSesiHitung\.js|backend/src/services/stokFisik\.js|backend/tests/integration/setup/testApp\.js|backend/tests/integration/stockCountSesiPenuh\.integration\.test\.js|backend/tests/opnameSesi\.test\.js|backend/tests/releaseKoreksiGudang\.test\.js|backend/tests/releaseOpnamePenuh\.test\.js|docs/GUDANG-OPNAME-PENUH\.md|frontend/src/api\.js|frontend/src/components/Topbar\.jsx|frontend/src/features/warehouse/dokumen/OpnameDetail\.jsx|frontend/src/features/warehouse/opname/BarisHitung\.jsx|frontend/src/features/warehouse/opname/BuatSesiOpname\.jsx|frontend/src/features/warehouse/opname/OpnameSesiTinjau\.jsx|frontend/src/features/warehouse/opname/PanelDiLuarCakupan\.jsx|frontend/src/features/warehouse/opname/opnameLogic\.js|frontend/src/lib/tabTitles\.js|frontend/src/pages/warehouse/WarehouseOpnameKerja\.jsx|frontend/src/pages/warehouse/WarehouseStockCount\.jsx|frontend/src/routes/pageRegistry\.jsx|frontend/tests/gudangOpnameSesi\.test\.js|scripts/gen-release-opname-penuh\.cjs|scripts/lib/rehearsal-kode-opname-penuh\.mjs|scripts/lib/rehearsal-skenario-opname-penuh\.mjs|scripts/lib/scan-migrasi-opname-penuh\.mjs|scripts/lib/smoke-opname-penuh\.mjs|scripts/release-opname-penuh\.sh|scripts/rollback-guard-opname-penuh\.sh|scripts/templates/release-opname-penuh\.sh\.tpl)$'
BACKEND_SRC_EXPECT="backend/src/index.js backend/src/routes/stockCount.js backend/src/routes/stockCountSesi.js backend/src/services/dokumenGudangLain.js backend/src/services/opnameSesi.js backend/src/services/pergerakanSesiHitung.js backend/src/services/stokFisik.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/components/Topbar.jsx frontend/src/features/warehouse/dokumen/OpnameDetail.jsx frontend/src/features/warehouse/opname/BarisHitung.jsx frontend/src/features/warehouse/opname/BuatSesiOpname.jsx frontend/src/features/warehouse/opname/OpnameSesiTinjau.jsx frontend/src/features/warehouse/opname/PanelDiLuarCakupan.jsx frontend/src/features/warehouse/opname/opnameLogic.js frontend/src/lib/tabTitles.js frontend/src/pages/warehouse/WarehouseOpnameKerja.jsx frontend/src/pages/warehouse/WarehouseStockCount.jsx frontend/src/routes/pageRegistry.jsx"
# Perubahan live yang TIDAK boleh hilang: hotfix Stock Count harus ada di kandidat DAN baseline; berkas pelindung identik dengan baseline (rilis ini tidak menyentuhnya).
HOTFIX_STOCK_COUNT="b5268e1f7d8e1a15a251106dee0a136898ee5ce1"
GUARD_UNCHANGED="backend/src/services/inventoryLedger.js backend/src/services/inventorySegregation.js backend/src/services/identitasHitung.js backend/src/services/opnameCutover.js backend/src/services/stokLokasi.js backend/src/constants/kelompokBahan.js backend/src/services/finance/journal.js backend/src/middleware/authorize.js backend/src/middleware/auth.js backend/src/constants/permissions.js backend/src/routes/goodsReceipt.js backend/src/routes/materialIssue.js backend/src/services/adminOverrideSwitch.js backend/src/services/deliveryOverrideAdmin.js backend/src/services/productionStepCommandService.js backend/src/services/finance/kedatangan.js"
# Commit Produksi (admin override siap kirim), Riwayat Referensi, dan bukti serah yang sudah live: HARUS leluhur kandidat (rilis tidak boleh menghilangkannya).
LIVE_ANCESTORS="799d3e93de192c604a14f1c11fe7436538689bb0 56b87721f84c1d16a2cd1655e40787e2b626cb0f e5a32cd246b2233e9d05d9b2cbff733e4497725d e47f37e2d6690130525681863ff467682e30f3c4 cb33a07d4dc61652867960fdf6c528647f350611"
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
BK_DIR="$HOME/release-backups/opname-penuh-${DEPLOY_SHORT}-${TS}"
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
# Pembersih --rehearsal-penuh (dipanggil di trap EXIT, juga saat gagal): hapus container UI, direktori kerja, image bertag rehearsal (SATU tag itu saja), dan DB sementara bernama rehearsal_op_test_*. TIDAK menyentuh production.
cleanup_penuh() {
  [ "$REHEARSAL_PENUH" = "1" ] || return 0
  docker rm -f "rh-op-ui-${TS}" >/dev/null 2>&1 || true
  if [ -n "${WS:-}" ] && [[ "$WS" == "$HOME/release-rehearsal/op-"* ]]; then rm -rf -- "$WS" 2>/dev/null || sudo -n rm -rf -- "$WS" 2>/dev/null || true; fi
  if [ -n "${REH_IMG:-}" ] && [[ "$REH_IMG" == *":rehearsal-op-"* ]]; then docker rmi "$REH_IMG" >/dev/null 2>&1 || true; fi
  if [[ "${REH_DB:-}" =~ ^rehearsal_op_test_image_[0-9_]+$ ]] && [ -n "${PREV_DIR:-}" ]; then dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; fi
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
LANGKAH sebelum rollback KODE setelah switch: jalankan GUARD (baca-saja)
   bash ${NEW_DIR}/scripts/rollback-guard-opname-penuh.sh
Guard menolak (exit 1) bila masih ada sesi hitung model baru yang terbuka (SCHEDULED/IN_PROGRESS/WAITING_REVIEW): selesaikan atau batalkan dulu, karena kode lama tidak mengenal sesi itu dan akan menulis penyesuaian keliru.
Rollback kode (TIDAK menghapus kolom baru, hasil hitung, waktu pengamatan, maupun penyesuaian yang sudah diposting):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi bersifat ADITIF (kolom NULL/DEFAULT konstan + 5 CHECK): dibiarkan terpasang pun aman bagi kode lama. Penyesuaian yang sudah diposting ke ledger tetap di ledger (SUM(qty) tetap benar).
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS hasil hitung dan penyesuaian sesudah backup; gunakan hanya atas keputusan Owner.
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
exec 9>/tmp/release-opname-penuh.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "op\.sh\|release-opname-penuh\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
ok "schema.prisma: diff identik dengan yang diaudit (aditif: 3 field pada StockCount + 12 field pada StockCountLine)"
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
// Pemindai migrasi rilis "Stock Opname penuh + model waktu" (1 migrasi ADITIF). FAIL-CLOSED: setiap pernyataan harus SAMA PERSIS (setelah spasi dirapatkan) dengan salah satu dari tujuh bentuk yang diaudit, masing-masing tepat sekali.
// Membaca SQL dari stdin (komentar baris "--" sudah dibuang pemanggil).
//   • 1 ALTER TABLE "stock_counts": 3 kolom (model_version INTEGER NOT NULL DEFAULT 1 = konstanta, tanpa rewrite tabel; scope_mode VARCHAR(10) NULL; scope_info JSONB NULL).
//   • 1 ALTER TABLE "stock_count_lines": 12 kolom (NULL, atau NOT NULL dengan DEFAULT konstan 0 / false / 'SESI').
//   • 5 CHECK ringan (model_version IN (1,2); scope_mode NULL atau FULL/GROUP/ITEMS; origin IN (SESI, TAMBAHAN); observed_source NULL atau MULAI/DINYATAKAN/DIKOREKSI; observed_at dan observed_source NULL bersama-sama).
// Tidak ada tabel/indeks/FK/trigger/fungsi baru, tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/ALTER COLUMN/RENAME/CREATE TYPE, tidak menyentuh stock_movements (ledger) maupun tabel lain.
// Isi migrasi juga dipatok sha256 di skrip rilis; pemindai ini adalah lapisan kedua (bentuk pernyataan), diuji dengan mutan negatif.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };

const BENTUK = [
  ["alter_stock_counts", 'ALTER TABLE "stock_counts" ADD COLUMN "model_version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "scope_mode" VARCHAR(10), ADD COLUMN "scope_info" JSONB'],
  ["alter_stock_count_lines", 'ALTER TABLE "stock_count_lines" ADD COLUMN "saved_at" TIMESTAMP(3), ADD COLUMN "counted_by_id" TEXT, ADD COLUMN "observed_at" TIMESTAMP(3), ADD COLUMN "observed_source" VARCHAR(10), ADD COLUMN "observed_by_id" TEXT, ADD COLUMN "observed_recorded_at" TIMESTAMP(3), ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "needs_check" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "excluded_reason" TEXT, ADD COLUMN "excluded_at" TIMESTAMP(3), ADD COLUMN "excluded_by_id" TEXT, ADD COLUMN "origin" VARCHAR(10) NOT NULL DEFAULT \'SESI\''],
  ["check", 'ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_model_version_chk" CHECK ("model_version" IN (1, 2))'],
  ["check", 'ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_scope_mode_chk" CHECK ("scope_mode" IS NULL OR "scope_mode" IN (\'FULL\', \'GROUP\', \'ITEMS\'))'],
  ["check", 'ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_origin_chk" CHECK ("origin" IN (\'SESI\', \'TAMBAHAN\'))'],
  ["check", 'ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_observed_source_chk" CHECK ("observed_source" IS NULL OR "observed_source" IN (\'MULAI\', \'DINYATAKAN\', \'DIKOREKSI\'))'],
  ["check", 'ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_observed_pair_chk" CHECK (("observed_at" IS NULL) = ("observed_source" IS NULL))'],
];
// kata terlarang (lapisan tambahan; bentuk persis di atas sudah menolak semuanya)
const TERLARANG = /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|GRANT|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|CREATE\s+(?:TYPE|TABLE|INDEX|UNIQUE|TRIGGER|FUNCTION|OR)|ADD\s+VALUE|FOREIGN\s+KEY|REFERENCES|stock_movements)\b/i;

const pernyataan = sql.split(";").map(rapat).filter(Boolean);
const hitung = { total: 0, alter_stock_counts: 0, alter_stock_count_lines: 0, check: 0 };
const dipakai = new Set();
for (const r of pernyataan) {
  hitung.total += 1;
  if (TERLARANG.test(r)) gagal("kata terlarang: " + r.slice(0, 160));
  const i = BENTUK.findIndex(([, teks], idx) => teks === r && !dipakai.has(idx));
  if (i < 0) gagal(BENTUK.some(([, teks]) => teks === r) ? "pernyataan ganda: " + r.slice(0, 120) : "PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 220));
  dipakai.add(i);
  hitung[BENTUK[i][0]] += 1;
}
if (dipakai.size !== BENTUK.length) gagal(`pernyataan yang diaudit tidak lengkap: ada ${dipakai.size} dari ${BENTUK.length}`);
console.log(JSON.stringify(hitung));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (ALTER TABLE stock_counts +3 kolom, stock_count_lines +12 kolom, 5 CHECK ringan); tanpa tabel/indeks/FK/trigger baru, tanpa DROP/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT, tanpa menyentuh stock_movements"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE stock_counts" "$(tambah_stmt 'DROP TABLE "stock_counts";')"
harus_ditolak "DROP TABLE ledger" "$(tambah_stmt 'DROP TABLE "stock_movements";')"
harus_ditolak "UPDATE stock_counts (backfill)" "$(tambah_stmt "UPDATE \"stock_counts\" SET \"model_version\" = 2;")"
harus_ditolak "UPDATE kolom baru (backfill)" "$(tambah_stmt "UPDATE \"stock_count_lines\" SET \"observed_at\" = now();")"
harus_ditolak "UPDATE ledger" "$(tambah_stmt "UPDATE \"stock_movements\" SET \"qty\" = 0;")"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "stock_count_lines";')"
harus_ditolak "INSERT" "$(tambah_stmt "INSERT INTO \"stock_counts\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "stock_count_lines";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "stock_count_lines" DROP COLUMN "counted_qty";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "stock_count_lines" ALTER COLUMN "counted_qty" TYPE DOUBLE PRECISION;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "stock_count_lines" RENAME COLUMN "counted_qty" TO "q";')"
harus_ditolak "kolom liar pada stock_count_lines" "$(tambah_stmt 'ALTER TABLE "stock_count_lines" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom pada ledger stock_movements" "$(tambah_stmt 'ALTER TABLE "stock_movements" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom pada tabel lain" "$(tambah_stmt 'ALTER TABLE "goods_receipts" ADD COLUMN "x" TEXT;')"
harus_ditolak "DEFAULT konstan diubah" "$(printf '%s\n' "$ALL_SQL" | sed 's/"model_version" INTEGER NOT NULL DEFAULT 1/"model_version" INTEGER NOT NULL DEFAULT 2/')"
harus_ditolak "DEFAULT non-konstan (backfill terselubung)" "$(printf '%s\n' "$ALL_SQL" | sed 's/"revision" INTEGER NOT NULL DEFAULT 0/"revision" INTEGER NOT NULL DEFAULT (random()*10)::int/')"
harus_ditolak "kolom baru NOT NULL tanpa default" "$(printf '%s\n' "$ALL_SQL" | sed 's/ADD COLUMN "scope_mode" VARCHAR(10)/ADD COLUMN "scope_mode" VARCHAR(10) NOT NULL/')"
harus_ditolak "kolom dibuang dari migrasi" "$(printf '%s\n' "$ALL_SQL" | grep -v 'ADD COLUMN "scope_info" JSONB')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "indeks baru" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "stock_count_lines"("origin");')"
harus_ditolak "indeks unik baru" "$(tambah_stmt 'CREATE UNIQUE INDEX "x_uq" ON "stock_count_lines"("stock_count_id", "material_id");')"
harus_ditolak "FK baru" "$(tambah_stmt 'ALTER TABLE "stock_count_lines" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("observed_by_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;')"
harus_ditolak "CHECK tambahan" "$(tambah_stmt 'ALTER TABLE "stock_count_lines" ADD CONSTRAINT "x_chk" CHECK ("revision" > 5);')"
harus_ditolak "CHECK dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'stock_count_lines_observed_pair_chk')"
harus_ditolak "CHECK dilonggarkan" "$(printf '%s\n' "$ALL_SQL" | sed "s/'MULAI', 'DINYATAKAN', 'DIKOREKSI'/'MULAI', 'DINYATAKAN', 'DIKOREKSI', 'LIAR'/")"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "stock_count_lines" DROP CONSTRAINT "stock_count_lines_pkey";')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"CountStatus\" ADD VALUE IF NOT EXISTS 'LIAR';")"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "stock_counts" TO PUBLIC;')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "trigger pada stock_counts" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "stock_counts" FOR EACH ROW EXECUTE FUNCTION evil();')"
harus_ditolak "pernyataan ganda" "$(printf '%s\n%s\n' "$ALL_SQL" "$(printf '%s\n' "$ALL_SQL" | grep 'stock_counts_model_version_chk')")"
harus_ditolak "blok DO liar" "$(tambah_stmt 'DO $$ BEGIN DELETE FROM "stock_count_lines"; END $$;')"
[ "$NEG" -ge 30 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 30)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER COLUMN/RENAME/kolom liar/ledger/DEFAULT/NOT NULL/tabel-indeks-FK liar/CHECK/trigger/fungsi/DO liar/GRANT) SEMUANYA ditolak"
sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA" || die "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} BUKAN leluhur kandidat — rilis akan menghilangkannya; gabungkan live terbaru dulu"
sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$BASE_SHA" || die "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} belum ada di baseline live ${BASE_SHA:0:8} — baseline bukan yang diharapkan"
for f in $GUARD_UNCHANGED; do
  [ "$(sg rev-parse "${BASE_SHA}:${f}")" = "$(sg rev-parse "${DEPLOY_SHA}:${f}")" ] || die "${f} berbeda antara baseline dan kandidat — rilis ini tidak boleh menyentuhnya (ledger/pemisahan tugas/jurnal/otorisasi/Penerimaan/Material Issue/Produksi)"
done
ok "hotfix Stock Count ada di baseline DAN kandidat; $(printf '%s\n' $GUARD_UNCHANGED | wc -l) berkas pelindung (ledger posting, pemisahan tugas, jurnal, otorisasi, Penerimaan, Material Issue, opname cutover, Produksi override) identik dengan baseline"
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
# Prasyarat skema: tabel yang dibaca/ditulis kode baru HARUS sudah ada; kolom rilis ini belum boleh ada.
for T in stock_counts stock_count_lines stock_movements materials goods_receipts goods_receipt_lines material_issue_lines stock_transfer_lines stok_riwayat_referensi planned_bom_lines_v2 '"User"' activity_events fin_journal_entries fin_journal_lines; do
  [ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename='${T//\"/}'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and ((table_name='stock_counts' and column_name in ('model_version','scope_mode','scope_info')) or (table_name='stock_count_lines' and column_name in ('saved_at','counted_by_id','observed_at','observed_source','observed_by_id','observed_recorded_at','revision','needs_check','excluded_reason','excluded_at','excluded_by_id','origin')))")" = "0" ] || die "kolom opname model baru SUDAH ada di produksi (tidak diharapkan)"
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
# Ukuran tabel yang disentuh migrasi (dampak): kolom NULL / DEFAULT konstan = hanya metadata (PostgreSQL 11+ tanpa rewrite); 5 CHECK memindai seluruh baris kedua tabel sekali (tabel kecil = sekejap).
SC_N="$(psql_live -At -c "select count(*) from stock_counts")"; SCL_N="$(psql_live -At -c "select count(*) from stock_count_lines")"; MAT_N="$(psql_live -At -c "select count(*) from materials")"; MAT_AKTIF="$(psql_live -At -c "select count(*) from materials where active")"
[[ "$SC_N" =~ ^[0-9]+$ ]] && [[ "$SCL_N" =~ ^[0-9]+$ ]] && [[ "$MAT_N" =~ ^[0-9]+$ ]] && [[ "$MAT_AKTIF" =~ ^[0-9]+$ ]] || die "audit awal bukan angka"
SCL_BYTES="$(psql_live -At -c "select pg_total_relation_size('stock_count_lines')")"; DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"
ok "dampak migrasi: stock_counts ${SC_N} baris; stock_count_lines ${SCL_N} baris (${SCL_BYTES} byte); materials ${MAT_N} (aktif ${MAT_AKTIF}); DB ${DB_BYTES} byte — ALTER kolom NULL/DEFAULT konstan (metadata saja) + 5 CHECK memindai ${SC_N}+${SCL_N} baris"
SESI_INFO="$(psql_live -At -F ' | ' -c "select count_number, status, (select count(*) from stock_count_lines l where l.stock_count_id = c.id) from stock_counts c order by created_at")"
ok "sesi hitung yang ada (semuanya tetap model 1 setelah rilis): $(printf '%s\n' "$SESI_INFO" | grep -c .)"; printf '%s\n' "$SESI_INFO" | sed 's/^/        /'
# Perkiraan cakupan Opname penuh dengan aturan 'saldo dilacak fisik' (jejak stok; SAMA dengan services/stokFisik.js) — INFORMASI untuk keputusan Owner sebelum sesi 1 November, bukan gerbang.
CAKUPAN_INFO="$(psql_live -At -F ' | ' -c "select count(*) filter (where d.dilacak), count(*) filter (where not d.dilacak) from (select (exists (select 1 from stock_movements s where s.material_id = m.id) or m.reference_stock_value is not null or m.reference_unit_cost is not null or m.reorder_point is not null or m.reorder_qty is not null or m.kind is not null or exists (select 1 from goods_receipt_lines l where l.material_id = m.id) or exists (select 1 from material_issue_lines l where l.material_id = m.id) or exists (select 1 from stock_transfer_lines l where l.material_id = m.id) or exists (select 1 from stok_riwayat_referensi l where l.material_id = m.id) or exists (select 1 from stock_count_lines l join stock_counts c on c.id = l.stock_count_id where l.material_id = m.id and l.counted_qty is not null and c.status <> 'CANCELLED') or exists (select 1 from planned_bom_lines_v2 b where b.material_id = m.id)) as dilacak from materials m where m.active) d")"
ok "perkiraan cakupan Opname penuh (aturan dilacak fisik) di data produksi saat ini: dilacak | tidak dilacak = ${CAKUPAN_INFO} (dari ${MAT_AKTIF} bahan aktif) — daftar tidak dilacak tampil di pratinjau untuk diputuskan Owner"
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"
[[ "$BASE_TIDAK_SEIMBANG" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$BASE_TIDAK_SEIMBANG'"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}"
# T0 = jam DB (UTC) 5 menit lalu. Dokumen pembanding dibekukan: hanya yang dibuat sebelum T0 (transaksi sah baru tidak diperbandingkan).
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
# Tabel pembanding beku: ledger/Gudang (pergerakan stok, GR + baris + event), saldo per bahan, jurnal, tagihan/pembayaran supplier, PO, Produksi, aktivitas, dan SESI HITUNG LAMA (TANPA kolom baru).
FP_BEKU_SQL="$(cat <<FPBEKU
select 'pergerakan_stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'saldo_per_bahan', count(*), md5(coalesce(string_agg(s.material_id::text || ':' || s.q::text, '|' order by s.material_id),'')) from (select material_id, sum(qty) q from stock_movements where created_at < '$T0'::timestamp group by material_id) s
union all select 'penerimaan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipts x where x.created_at < '$T0'::timestamp
union all select 'penerimaan_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_lines x where x.goods_receipt_id in (select id from goods_receipts where created_at < '$T0'::timestamp)
union all select 'penerimaan_event', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_events x where x.created_at < '$T0'::timestamp
union all select 'bahan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from materials x where x.created_at < '$T0'::timestamp
union all select 'jurnal_induk', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from fin_journal_entries x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'po', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_orders x where x.created_at < '$T0'::timestamp
union all select 'tagihan_supplier', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bills x where x.created_at < '$T0'::timestamp
union all select 'alokasi_tagihan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bill_allocations x where x.bill_id in (select id from fin_supplier_bills where created_at < '$T0'::timestamp)
union all select 'pembayaran_supplier', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_payments x where x.created_at < '$T0'::timestamp
union all select 'run_produksi_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_runs_v2 x where x.created_at < '$T0'::timestamp
union all select 'event_aktivitas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from activity_events x where x.created_at < '$T0'::timestamp
union all select 'sesi_hitung', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'model_version' - 'scope_mode' - 'scope_info')::text, '|' order by x.id),'')) from stock_counts x where x.created_at < '$T0'::timestamp
union all select 'sesi_hitung_baris', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'saved_at' - 'counted_by_id' - 'observed_at' - 'observed_source' - 'observed_by_id' - 'observed_recorded_at' - 'revision' - 'needs_check' - 'excluded_reason' - 'excluded_at' - 'excluded_by_id' - 'origin')::text, '|' order by x.id),'')) from stock_count_lines x where x.stock_count_id in (select id from stock_counts where created_at < '$T0'::timestamp)
FPBEKU
)"
FPB_N=16
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "$FPB_N" ] || die "sidik jari dokumen beku tidak ${FPB_N} baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di ${FPB_N} kelompok)"
# Skema tabel lama (sidik jari kolom/tipe/nullable/default, TANPA 15 kolom baru): tidak boleh berubah oleh migrasi.
SKEMA_SQL="select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and not ((table_name='stock_counts' and column_name in ('model_version','scope_mode','scope_info')) or (table_name='stock_count_lines' and column_name in ('saved_at','counted_by_id','observed_at','observed_source','observed_by_id','observed_recorded_at','revision','needs_check','excluded_reason','excluded_at','excluded_by_id','origin')))"
# Katalog objek (indeks, constraint, trigger) SEMUA tabel: tidak boleh berubah selain 5 CHECK yang ditambahkan rilis ini (tidak ada indeks/FK/trigger baru).
KATALOG_SQL="select md5(coalesce(string_agg(x, ',' order by x), '')) from (
 select 'idx:'||tablename||':'||indexname as x from pg_indexes where schemaname='public'
 union all select 'con:'||conrelid::regclass::text||':'||conname from pg_constraint where connamespace='public'::regnamespace and conname not in ('stock_counts_model_version_chk','stock_counts_scope_mode_chk','stock_count_lines_origin_chk','stock_count_lines_observed_source_chk','stock_count_lines_observed_pair_chk')
 union all select 'trg:'||tgrelid::regclass::text||':'||tgname from pg_trigger where not tgisinternal) k"

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
BACKUP_FILE="$HOME/backups/pre-op-${DEPLOY_SHORT}-${TS}.sql.gz"
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
  say "Lanjutan rehearsal penuh: smoke baca-saja, skenario model waktu + konkurensi + klik ganda + sesi penuh nyata, guard rollback (DB rehearsal ${REH_DB}; production tidak disentuh)"
  local RH_DIR="$BK_DIR/rh"; mkdir -p "$RH_DIR" "$BK_DIR/rhctl"
  cp "$WS/scripts/lib/rehearsal-skenario-opname-penuh.mjs" "$WS/scripts/lib/smoke-opname-penuh.mjs" "$RH_DIR/" || { reh_drop; die "pustaka skenario tidak ada di arsip kandidat"; }
  local RH_JWT; RH_JWT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  [ "${#RH_JWT}" -ge 32 ] || { reh_drop; die "gagal membangkitkan rahasia JWT rehearsal"; }
  local EXPECT_MASUK="${CAKUPAN_INFO%% | *}"; [[ "$EXPECT_MASUK" =~ ^[0-9]+$ ]] || { reh_drop; die "perkiraan cakupan preflight tidak terbaca"; }
  rh_jalankan() { local fase="$1"; shift; docker run --rm --network "$NET" -v "$RH_DIR:/rh:ro" -w /app -e FASE="$fase" -e JWT_SECRET="$RH_JWT" -e DATABASE_URL="$REH_URL" -e TEST_DATABASE_URL="$REH_URL" "$@" "$REH_IMG" node /rh/rehearsal-skenario-opname-penuh.mjs </dev/null; }
  # 1) smoke baca-saja terhadap data restore (sesi lama terbaca, pratinjau cakupan atas bahan nyata, tidak ada tulisan)
  rh_jalankan smoke > "$BK_DIR/rh-smoke.log" 2>&1 || { grep -E 'FAIL|Error' "$BK_DIR/rh-smoke.log" | head -n 10; reh_drop; die "smoke baca-saja terhadap DB rehearsal GAGAL (log: $BK_DIR/rh-smoke.log)"; }
  grep -q '^RH_SMOKE kode=0' "$BK_DIR/rh-smoke.log" && grep -q '^SMOKE_HASIL fail=0 skip=' "$BK_DIR/rh-smoke.log" || { tail -n 8 "$BK_DIR/rh-smoke.log"; reh_drop; die "smoke tidak mencetak ringkasan lulus"; }
  grep -q 'sesi lama CC-' "$BK_DIR/rh-smoke.log" || { reh_drop; die "smoke tidak membuktikan sesi lama terbaca"; }
  ok "smoke baca-saja terhadap DB rehearsal: $(grep -c '  PASS' "$BK_DIR/rh-smoke.log") pemeriksaan lulus, $(grep '^SMOKE_HASIL' "$BK_DIR/rh-smoke.log" | sed 's/SMOKE_HASIL //'); sesi lama terbaca"
  # 2) skenario: waktu (tiga waktu, bertanggal mundur), PEMBUKTIAN pergerakan baru setelah review, konkurensi (kunci + serentak 3 ronde), klik ganda, sesi penuh nyata, sesi terbuka untuk guard
  rh_jalankan skenario -e EXPECT_MASUK="$EXPECT_MASUK" > "$BK_DIR/rh-skenario.log" 2>&1 || { grep -E '^FAIL' "$BK_DIR/rh-skenario.log" | head -n 12; reh_drop; die "skenario rehearsal GAGAL (log: $BK_DIR/rh-skenario.log)"; }
  grep -q '^RH_SKENARIO gagal=0' "$BK_DIR/rh-skenario.log" && ! grep -q '^FAIL' "$BK_DIR/rh-skenario.log" || { grep -E '^FAIL' "$BK_DIR/rh-skenario.log" | head -n 12; reh_drop; die "skenario rehearsal tidak lulus penuh"; }
  local NPASS; NPASS="$(grep -c '^PASS' "$BK_DIR/rh-skenario.log")"; [ "$NPASS" -ge 45 ] || { reh_drop; die "skenario hanya ${NPASS} pemeriksaan lulus (minimal 45)"; }
  for k in 'S3 Selesaikan DITOLAK' 'S3 tidak ada keputusan bawaan' 'S3 setelah diputuskan Selesaikan lulus' 'S4a Selesaikan MENUNGGU kunci' 'S4b ronde 2' 'S5 Selesaikan ganda' 'S6 Selesaikan sesi penuh lulus'; do grep -q "^PASS $k" "$BK_DIR/rh-skenario.log" || { reh_drop; die "pemeriksaan wajib tidak ada/lulus: $k"; }; done
  ok "skenario rehearsal: ${NPASS} pemeriksaan lulus, 0 gagal — termasuk pergerakan BARU setelah review ditolak lalu lanjut, konkurensi (kunci + 3 ronde serentak), klik ganda, dan sesi penuh nyata atas data restore"
  grep -E '^INFO' "$BK_DIR/rh-skenario.log" | sed 's/^/        /'
  grep -E 'S6 (pratinjau|sesi penuh dibuat|360|[0-9]+ bahan disimpan|Selesaikan sesi penuh)' "$BK_DIR/rh-skenario.log" | sed 's/^PASS /        /' | cut -c1-220
  # 3) guard rollback: sesi model baru terbuka → MENOLAK; setelah ditutup → LULUS
  local G1 G2; set +e; GUARD_DB="$REH_DB" bash "$WS/scripts/rollback-guard-opname-penuh.sh" > "$BK_DIR/guard-menolak.log" 2>&1; G1=$?; set -e
  [ "$G1" = "1" ] && grep -q 'GUARD MENOLAK' "$BK_DIR/guard-menolak.log" || { cat "$BK_DIR/guard-menolak.log"; reh_drop; die "guard rollback TIDAK menolak padahal ada sesi model baru terbuka (exit=${G1})"; }
  rh_jalankan tutup > "$BK_DIR/rh-tutup.log" 2>&1 && grep -q '^RH_TUTUP gagal=0' "$BK_DIR/rh-tutup.log" || { cat "$BK_DIR/rh-tutup.log"; reh_drop; die "gagal menutup sesi terbuka untuk uji guard"; }
  set +e; GUARD_DB="$REH_DB" bash "$WS/scripts/rollback-guard-opname-penuh.sh" > "$BK_DIR/guard-lulus.log" 2>&1; G2=$?; set -e
  [ "$G2" = "0" ] && grep -q 'GUARD LULUS' "$BK_DIR/guard-lulus.log" || { cat "$BK_DIR/guard-lulus.log"; reh_drop; die "guard rollback TIDAK lulus setelah semua sesi ditutup (exit=${G2})"; }
  ok "guard rollback: MENOLAK (exit 1) selama ada sesi model baru terbuka; LULUS (exit 0) setelah ditutup: $(sed -n 1p "$BK_DIR/guard-lulus.log")"
  # 4) UI (opsional): server sementara + dist baru di loopback VPS untuk simulasi HP lewat terowongan SSH
  if [ "$TAHAN_UI" != "0" ]; then
    local UIN="rh-op-ui-${TS}"
    docker run -d --name "$UIN" --network "$NET" -p 127.0.0.1:4311:4100 -v "$RH_DIR:/rh:ro" -v "$BK_DIR/rhctl:/rhctl" -v "$WS/frontend/dist:/dist:ro" -w /app -e FASE=ui -e RH_UI_MENIT="$TAHAN_UI" -e JWT_SECRET="$RH_JWT" -e DATABASE_URL="$REH_URL" -e TEST_DATABASE_URL="$REH_URL" "$REH_IMG" node /rh/rehearsal-skenario-opname-penuh.mjs >/dev/null || { reh_drop; die "gagal menyalakan server UI rehearsal"; }
    local siap=0; for i in $(seq 1 45); do docker logs "$UIN" 2>&1 | grep -q '^RH_UI_SIAP' && curl -fsS --max-time 4 http://127.0.0.1:4311/__rh/tokens >/dev/null 2>&1 && { siap=1; break; }; sleep 2; done
    [ "$siap" = "1" ] || { docker logs "$UIN" 2>&1 | tail -n 15; reh_drop; die "server UI rehearsal tidak siap"; }
    say "UI_REHEARSAL_SIAP http://127.0.0.1:4311 (hanya loopback VPS; DB rehearsal ${REH_DB}). Dari laptop: ssh -N -L 4311:127.0.0.1:4311 ubuntu@43.133.152.6 — menunggu ${TAHAN_UI} menit atau berkas ${BK_DIR}/rhctl/stop"
    until [ -e "$BK_DIR/rhctl/stop" ] || [ "$(docker inspect -f '{{.State.Running}}' "$UIN" 2>/dev/null)" != "true" ]; do sleep 5; done
    docker rm -f "$UIN" >/dev/null 2>&1 || true; ok "server UI rehearsal dihentikan"
  fi
}

# ── REHEARSAL (satu fungsi, dipakai --rehearsal-only, --rehearsal-penuh dan alur rilis penuh) ───────────────────────────────────────────────────────────────────────────
# $1 = "git" (SQL migrasi dari git, diberi waktu per pernyataan) | "image" (prisma migrate deploy dari image baru + kode baru terhadap data restore)
rehearsal() {
  local mode="$1"
  REH_DB="rehearsal_op_test_${mode}_${TS}"  # nama WAJIB memuat "test": pagar env.js skenario menolak DB lain
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
    [ "$t" = "stock_counts" ] && expr="(to_jsonb(x) - 'model_version' - 'scope_mode' - 'scope_info')"
    [ "$t" = "stock_count_lines" ] && expr="(to_jsonb(x) - 'saved_at' - 'counted_by_id' - 'observed_at' - 'observed_source' - 'observed_by_id' - 'observed_recorded_at' - 'revision' - 'needs_check' - 'excluded_reason' - 'excluded_at' - 'excluded_by_id' - 'origin')"
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
  # 5) STRUKTUR: 15 kolom baru bertipe benar; semua baris lama memegang nilai bawaan (tanpa backfill); 5 CHECK tervalidasi; tidak ada tabel baru; skema + katalog objek lama identik
  [ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='stock_counts' and ((column_name='model_version' and data_type='integer' and is_nullable='NO' and column_default='1') or (column_name='scope_mode' and data_type='character varying' and is_nullable='YES' and column_default is null) or (column_name='scope_info' and data_type='jsonb' and is_nullable='YES' and column_default is null))")" = "3" ] || { reh_drop; die "3 kolom baru stock_counts tidak sesuai (tipe/nullable/default)"; }
  [ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='stock_count_lines' and ((column_name in ('saved_at','observed_at','observed_recorded_at','excluded_at') and data_type='timestamp without time zone' and is_nullable='YES' and column_default is null) or (column_name in ('counted_by_id','observed_by_id','excluded_by_id','excluded_reason') and data_type='text' and is_nullable='YES' and column_default is null) or (column_name='observed_source' and data_type='character varying' and is_nullable='YES' and column_default is null) or (column_name='revision' and data_type='integer' and is_nullable='NO' and column_default='0') or (column_name='needs_check' and data_type='boolean' and is_nullable='NO' and column_default='false') or (column_name='origin' and data_type='character varying' and is_nullable='NO' and column_default like '''SESI''%'))")" = "12" ] || { reh_drop; die "12 kolom baru stock_count_lines tidak sesuai (tipe/nullable/default)"; }
  [ "$(RPSQL "select count(*) from stock_counts where model_version <> 1 or scope_mode is not null or scope_info is not null")" = "0" ] || { reh_drop; die "ada sesi lama yang berubah menjadi model baru setelah migrasi (backfill tidak diizinkan)"; }
  [ "$(RPSQL "select count(*) from stock_count_lines where saved_at is not null or counted_by_id is not null or observed_at is not null or observed_source is not null or observed_by_id is not null or observed_recorded_at is not null or revision <> 0 or needs_check or excluded_at is not null or excluded_reason is not null or excluded_by_id is not null or origin <> 'SESI'")" = "0" ] || { reh_drop; die "ada baris sesi lama yang terisi nilai baru setelah migrasi (backfill tidak diizinkan)"; }
  [ "$(RPSQL "select count(*) from pg_constraint where conname in ('stock_counts_model_version_chk','stock_counts_scope_mode_chk','stock_count_lines_origin_chk','stock_count_lines_observed_source_chk','stock_count_lines_observed_pair_chk') and convalidated")" = "5" ] || { reh_drop; die "5 CHECK opname tidak terpasang/tervalidasi"; }
  [ "$(RPSQL "select count(*) from pg_tables where schemaname='public'")" = "$N_TABEL_SEBELUM" ] || { reh_drop; die "migrasi MENAMBAH/MENGURANGI tabel (tidak diharapkan)"; }
  [ "$(RPSQL "$SKEMA_SQL")" = "$S_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH skema (kolom/tipe/nullable/default) tabel lama"; }
  [ "$(RPSQL "$KATALOG_SQL")" = "$K_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH indeks/constraint/trigger selain 5 CHECK yang ditambahkan"; }
  ok "struktur: 3+12 kolom baru bertipe benar, semua baris lama bernilai bawaan; 5 CHECK tervalidasi; tidak ada tabel/indeks/FK/trigger baru; skema + katalog objek lama identik"
  # 6) UJI PERILAKU 5 CHECK memakai baris NYATA hasil restore; SELURUHNYA dibatalkan (RAISE di akhir)
  cat > "$BK_DIR/uji-perilaku-${mode}.sql" <<'UJISQL'
DO $t$
DECLARE sc uuid; ln uuid; tolak int := 0; lolos int := 0;
BEGIN
  SELECT id INTO sc FROM stock_counts ORDER BY created_at, id LIMIT 1;
  SELECT l.id INTO ln FROM stock_count_lines l WHERE l.stock_count_id = sc ORDER BY l.id LIMIT 1;
  IF sc IS NULL OR ln IS NULL THEN RAISE EXCEPTION 'DATA_CONTOH_KURANG'; END IF;
  -- YANG SAH (4)
  UPDATE stock_counts SET model_version = 2, scope_mode = 'FULL' WHERE id = sc; lolos := lolos + 1;
  UPDATE stock_count_lines SET observed_at = now(), observed_source = 'MULAI', saved_at = now(), revision = 1 WHERE id = ln; lolos := lolos + 1;
  UPDATE stock_count_lines SET observed_source = 'DINYATAKAN' WHERE id = ln; lolos := lolos + 1;
  UPDATE stock_count_lines SET observed_at = NULL, observed_source = NULL WHERE id = ln; lolos := lolos + 1;
  -- YANG HARUS DITOLAK (6)
  BEGIN UPDATE stock_counts SET model_version = 3 WHERE id = sc; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_model_version';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE stock_counts SET scope_mode = 'LIAR' WHERE id = sc; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_scope_mode';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE stock_count_lines SET origin = 'LIAR' WHERE id = ln; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_origin';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE stock_count_lines SET observed_at = now(), observed_source = 'LIAR' WHERE id = ln; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_sumber_waktu';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE stock_count_lines SET observed_at = now(), observed_source = NULL WHERE id = ln; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_waktu_tanpa_sumber';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE stock_count_lines SET observed_at = NULL, observed_source = 'MULAI' WHERE id = ln; RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'TIDAK_DITOLAK_sumber_tanpa_waktu';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
  UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku-${mode}.sql" 2>&1 || true)"
  printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku-${mode}.out"
  printf '%s\n' "$UJI_OUT" | grep -q 'DATA_CONTOH_KURANG' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data contoh di hasil restore kurang (butuh >=1 sesi hitung dengan >=1 baris)"; }
  printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
  printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku CHECK SALAH (ada data yang seharusnya ditolak lolos)"; }
  UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
  UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
  [ "$UJI_TOLAK" = "6" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti ${UJI_TOLAK:-?} (harus 6)"; }
  [ "$UJI_LOLOS" = "4" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data sah yang lolos ${UJI_LOLOS:-?} (harus 4)"; }
  ok "perilaku terbukti pada hasil restore: ${UJI_TOLAK} penolakan (model_version, scope_mode, origin, sumber waktu, waktu tanpa sumber, sumber tanpa waktu) dan ${UJI_LOLOS} operasi sah lolos; seluruh uji dibatalkan"
  # 7) Mode image: kode BARU terhadap data restore yang SUDAH dimigrasi (baca-saja)
  if [ "$mode" = "image" ]; then
    bk_run -e DATABASE_URL="$REH_URL" -e EXPECT_AKTIF="$MAT_AKTIF" -- node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-kode-baru.log" 2>&1 || { cat "$BK_DIR/rehearsal-kode-baru.log"; reh_drop; die "pemeriksaan kode baru terhadap data restore GAGAL"; }
// Pemeriksaan KODE BARU terhadap data restore yang SUDAH dimigrasi (rehearsal mode image; BACA-SAJA — tidak ada tulisan). Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal dan EXPECT_AKTIF = jumlah bahan aktif di produksi.
// Membuktikan: (1) semua sesi hitung lama tetap model 1 dan terbaca (termasuk sesi 106 bahan) oleh kode baru; (2) bahan aktif seluruhnya terklasifikasi: masuk Opname penuh (saldo dilacak fisik) atau tampil sebagai tidak dilacak
// dengan alasan — tidak ada yang hilang diam-diam; (3) aturan waktu murni bekerja; (4) tidak ada tulisan (sesi, baris, pergerakan stok).
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { muatBahan, bangunCakupan, klasifikasiPergerakan, hitungPembanding, KELAS } = await import("/app/src/services/opnameSesi.js");
const { muatJejakStok } = await import("/app/src/services/stokFisik.js");
const { muatPergerakanSesi } = await import("/app/src/services/pergerakanSesiHitung.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const awal = { sesi: await hitung("select count(*)::int n from stock_counts"), baris: await hitung("select count(*)::int n from stock_count_lines"), mov: await hitung("select count(*)::int n from stock_movements") };

// 1) sesi lama
const sesi = await prisma.stockCount.findMany({ include: { lines: { select: { id: true, materialId: true, countedQty: true, systemQty: true, savedAt: true, observedAt: true } } }, orderBy: { createdAt: "asc" } });
cek("data restore memuat sesi hitung lama", sesi.length > 0, "n=" + sesi.length);
cek("semua sesi lama tetap model 1 tanpa cakupan tersimpan", sesi.every((s) => s.modelVersion === 1 && s.scopeMode === null && s.scopeInfo === null));
cek("semua baris sesi lama tanpa waktu pengamatan/simpan baru (tidak ada backfill)", sesi.every((s) => s.lines.every((l) => l.savedAt === null && l.observedAt === null)));
const terbesar = sesi.reduce((m, s) => (s.lines.length > m.lines.length ? s : m), sesi[0]);
cek("sesi terbesar terbaca penuh oleh kode baru", terbesar.lines.length > 0, `${terbesar.countNumber}: ${terbesar.lines.length} baris`);
for (const s of sesi) {
  const full = await prisma.stockCount.findUnique({ where: { id: s.id }, include: { lines: { include: { material: { select: { id: true, code: true, name: true, unit: true, itemGroup: true, active: true } } } } } });
  const { pergerakan } = await muatPergerakanSesi(prisma, full);
  cek(`sesi ${s.countNumber} (${s.status}, ${s.lines.length} baris): dibaca dan pergerakan sesi dimuat dengan aturan lama`, full.lines.length === s.lines.length && Array.isArray(pergerakan));
}

// 2) cakupan Opname penuh di atas data nyata
const bahan = await muatBahan(prisma); const aktif = bahan.filter((m) => m.active);
const harapAktif = Number(process.env.EXPECT_AKTIF);
cek("jumlah bahan aktif di data restore = produksi", Number.isInteger(harapAktif) && aktif.length === harapAktif, `restore=${aktif.length} produksi=${process.env.EXPECT_AKTIF}`);
const { ringkasan, materialIds } = bangunCakupan(bahan, { mode: "FULL" });
cek("setiap bahan aktif terklasifikasi: masuk sesi penuh ATAU tampil sebagai tidak dilacak (tidak ada yang hilang diam-diam)", ringkasan.masuk + ringkasan.tidakDilacak.jumlah === aktif.length, `masuk=${ringkasan.masuk} tidak dilacak=${ringkasan.tidakDilacak.jumlah} aktif=${aktif.length}`);
cek("daftar Material ID cakupan unik dan semuanya bahan aktif", new Set(materialIds).size === materialIds.length && materialIds.every((id) => aktif.some((m) => m.id === id)));
cek("setiap bahan tidak dilacak membawa alasan", ringkasan.tidakDilacak.daftar.every((x) => /Tidak ada jejak stok/.test(x.alasan)));
const jejak = await muatJejakStok(prisma);
cek("keputusan dilacak berasal dari bukti (jejak stok), bukan nama kategori: Habis Pakai berjejak ikut, tanpa jejak tidak", aktif.filter((m) => m.category === "CONSUMABLE").every((m) => (materialIds.includes(m.id)) === !!jejak.get(m.id)?.dilacak), `Habis Pakai aktif=${aktif.filter((m) => m.category === "CONSUMABLE").length}`);
cek("bahan nonaktif tidak pernah masuk cakupan", bahan.filter((m) => !m.active).every((m) => !materialIds.includes(m.id)));
console.log(`INFO cakupan penuh = ${ringkasan.masuk} bahan dilacak; ${ringkasan.tidakDilacak.jumlah} tidak dilacak; belum dikelompokkan ${ringkasan.belumDikelompokkan.masuk}; nonaktif ${ringkasan.nonaktif.jumlah}`);

// 3) aturan waktu murni
const O = new Date("2026-11-01T03:00:00Z");
cek("aturan waktu: sebelum pengamatan otomatis; sesudah ditandai (tanpa jendela menit)", klasifikasiPergerakan({ createdAt: new Date(O.getTime() - 20 * 60000), observedAt: O }) === KELAS.SEBELUM && klasifikasiPergerakan({ createdAt: new Date(O.getTime() + 5 * 60000), observedAt: O, savedAt: new Date(O.getTime() + 40 * 60000) }) === KELAS.SAAT_HITUNG);
const h = hitungPembanding({ saldoSebelum: 100, countedQty: 100, pergerakan: [{ id: "x", qty: 20, kelas: KELAS.SAAT_HITUNG, tanda: null }] });
cek("pergerakan sejak pengamatan tidak masuk pembanding diam-diam dan menahan penyelesaian", h.pembanding === 100 && h.belumDiputuskan.length === 1);

// 4) tidak ada tulisan
cek("tidak ada sesi/baris/pergerakan stok yang ditulis oleh pemeriksaan ini", (await hitung("select count(*)::int n from stock_counts")) === awal.sesi && (await hitung("select count(*)::int n from stock_count_lines")) === awal.baris && (await hitung("select count(*)::int n from stock_movements")) === awal.mov);
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
  [ "$(RPSQL "select count(*) from stock_counts where model_version <> 1 or scope_mode is not null or scope_info is not null")" = "0" ] && [ "$(RPSQL "select count(*) from stock_count_lines where observed_at is not null or observed_source is not null or saved_at is not null or revision <> 0")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
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
  WS="$HOME/release-rehearsal/op-${DEPLOY_SHORT}-${TS}"; CAND_DIR="$WS"; REH_IMG="${IMG_NAME%%:*}:rehearsal-op-${DEPLOY_SHORT}"
  NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" | awk '{print $1}')"; [ -n "$NET" ] || die "jaringan docker postgres tidak terbaca"
  [ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
  mkdir -p "$WS" || die "gagal membuat ${WS}"
  sg archive "$DEPLOY_SHA" | tar -x -C "$WS" --exclude='frontend/dist' || die "git archive gagal"
  [ ! -e "$WS/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
  for f in backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-opname-penuh.sh scripts/lib/rehearsal-skenario-opname-penuh.mjs scripts/lib/smoke-opname-penuh.mjs docker-compose.yml docker-compose.release.yml; do [ -f "$WS/$f" ] || die "direktori kerja tidak lengkap: $f"; done
  cp -a "$NM_SRC" "$WS/frontend/node_modules" || die "gagal menyalin node_modules frontend"
  install -m 600 "$PERSIST/frontend/.env" "$WS/frontend/.env" || die "gagal menyalin frontend/.env"
  ( cd "$WS/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$WS/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (production tidak berubah)"; }
  rm -f "$WS/frontend/.env"
  RH_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$WS/frontend/dist/index.html" | sed -n 1p)"; [ -n "$RH_INDEX" ] && [ -f "$WS/frontend/dist/assets/$RH_INDEX" ] || die "hasil build frontend tidak valid"
  for s1 in "Kapan barang ini dihitung?" "Mulai hitung semua yang tampil" "Pergerakan sejak bahan dihitung" "Tekan tepat sebelum menghitung barangnya" "bahan aktif tidak dilacak"; do [ -n "$(grep -lF "$s1" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal TIDAK memuat teks fitur rilis ini: ${s1}"; done
  for s2 in "Ajukan Koreksi Stok" "Koreksi Penerimaan" "Konfirmasi Barang Jadi" "Selesaikan Produksi" "Rencana Produksi" "Uang muka dialokasikan ke faktur" "Tetapkan Siap Kirim (override)" "Riwayat referensi dari file (bukan transaksi)" "Simpan ke Stok" "Barang Akan Datang"; do [ -n "$(grep -lF "$s2" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal KEHILANGAN teks fitur lama: ${s2}"; done
  [ "$RH_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel rehearsal identik dengan live"
  ok "build web kandidat: ${RH_INDEX} (live ${PREV_INDEX}); teks fitur opname baru ada; teks fitur live lama tetap ada"
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
  [ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='stock_counts' and column_name='model_version'")" = "0" ] || die "kolom model_version muncul di production (rehearsal tidak boleh memigrasi production)"
  psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sesudah-rehearsal.txt" || die "sidik jari beku production sesudah rehearsal gagal"
  diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" || true; die "dokumen pembanding production BERUBAH selama rehearsal"; }
  [ "$(psql_live -At -c "select count(*) from pg_database where datname like 'rehearsal_op_test_%'")" = "0" ] || die "DB rehearsal masih tersisa di server"
  [ ! -e "$WS" ] || die "direktori kerja rehearsal masih ada"
  [ -z "$(docker images -q "$REH_IMG")" ] || die "image rehearsal masih ada"
  ok "production TIDAK berubah: container/image/release sama, 0 restart, migrasi sama (${MIG_SEBELUM}), 16 kelompok dokumen pembanding identik, tanpa kolom opname, DB rehearsal + direktori kerja + image rehearsal sudah dihapus; satu-satunya jejak: backup ${BACKUP_FILE}"
  trap - EXIT
  say "REHEARSAL PENUH SELESAI — production TIDAK diubah, tidak ada deploy, tidak ada sesi opname dibuat di production. Backup: ${BACKUP_FILE}. Log: ${BK_DIR}/release.log"
  exit 0
fi

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-opname-penuh.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Kapan barang ini dihitung?" "Mulai hitung semua yang tampil" "Pergerakan sejak bahan dihitung" "Tekan tepat sebelum menghitung barangnya" "bahan aktif tidak dilacak"; do
  [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru TIDAK memuat teks fitur rilis ini: ${s1}"
done
for s2 in "Ajukan Koreksi Stok" "Koreksi Penerimaan" "Konfirmasi Barang Jadi" "Selesaikan Produksi" "Rencana Produksi" "Uang muka dialokasikan ke faktur" "Tetapkan Siap Kirim (override)" "Riwayat referensi dari file (bukan transaksi)" "Simpan ke Stok" "Barang Akan Datang"; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur opname baru ada; teks fitur live lama tetap ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-op-${DEPLOY_SHORT}"
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
[ "$(psql_live -At -c "select count(*) from stock_counts where model_version <> 1 or scope_mode is not null or scope_info is not null")" = "0" ] || die "ada sesi bermodel baru tepat setelah migrasi (backfill tidak diizinkan)"
[ "$(psql_live -At -c "select count(*) from stock_count_lines where saved_at is not null or observed_at is not null or observed_source is not null or revision <> 0 or origin <> 'SESI'")" = "0" ] || die "ada baris sesi lama yang terisi nilai baru setelah migrasi"
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$(cat "$BK_DIR/skema-prod-sebelum.txt")" ] || die "skema tabel lama BERUBAH oleh migrasi (jangan switch)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi aditif"
ok "1 migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); semua sesi lama tetap model 1; skema tabel lama identik; backend lama tetap sehat"
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
[ "$(PSQLN "select count(*) from information_schema.columns where table_schema='public' and ((table_name='stock_counts' and column_name in ('model_version','scope_mode','scope_info')) or (table_name='stock_count_lines' and column_name in ('saved_at','counted_by_id','observed_at','observed_source','observed_by_id','observed_recorded_at','revision','needs_check','excluded_reason','excluded_at','excluded_by_id','origin')))")" = "15" ] || die "15 kolom opname model baru tidak lengkap di produksi"
[ "$(PSQLN "select count(*) from stock_counts where model_version = 2")" = "0" ] || die "ada sesi model baru tepat setelah switch (tidak ada yang boleh membuatnya)"
ok "objek rilis terpasang di produksi: 3 kolom stock_counts + 12 kolom stock_count_lines; semua sesi tetap model 1"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin, penolakan tanpa menyentuh data, sesi lama tetap terbaca, pratinjau cakupan atas bahan nyata"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
// Smoke BACA-SAJA rilis Stock Opname penuh terhadap backend yang SUDAH melayani (dijalankan di container baru). Tidak membuat sesi, tidak menulis stok/jurnal/PO/Produksi.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, UUID tidak valid). Pratinjau cakupan murni baca.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000"; // rehearsal memakai server sementara; production = backend yang melayani
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
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
const pembaca = cari((r) => punya(r, P.INVENTORY_READ) && r.includes("ADMIN")) ?? cari((r) => punya(r, P.INVENTORY_READ));
const tanpaTulis = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.INVENTORY_WRITE));
const tanpaBaca = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.INVENTORY_READ));
if (!pembaca) { rec("akun dengan izin baca Inventory tersedia", false); process.exit(1); }
const tB = tokenUntuk(pembaca);
const nol = "00000000-0000-4000-8000-000000000000";
const SC = "/api/inventory/stock-counts";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const awal = { sesi: await hitung("select count(*)::int n from stock_counts"), baris: await hitung("select count(*)::int n from stock_count_lines"), mov: await hitung("select count(*)::int n from stock_movements"), ev: await hitung("select count(*)::int n from activity_events") };

// ── Pintu: tanpa token / tanpa izin / bentuk salah — gagal SEBELUM menyentuh data ──
rec("daftar sesi tanpa token → 401", (await api("GET", SC, null)).status === 401);
rec("pratinjau cakupan tanpa token → 401", (await api("POST", SC + "/scope-preview", null, { mode: "FULL" })).status === 401);
rec("mulai hitung tanpa token → 401", (await api("POST", `${SC}/${nol}/lines/mulai`, null, { lineIds: [nol] })).status === 401);
if (tanpaTulis) {
  const t = tokenUntuk(tanpaTulis);
  rec("membuat sesi oleh akun tanpa izin tulis Inventory → 403", (await api("POST", SC, t, { mode: "FULL" })).status === 403);
  rec("simpan hasil hitung oleh akun tanpa izin tulis → 403", (await api("PUT", `${SC}/${nol}/hasil`, t, { items: [{ lineId: nol, revision: 0, countedQty: 1 }] })).status === 403);
  rec("mulai hitung oleh akun tanpa izin tulis → 403", (await api("POST", `${SC}/${nol}/lines/mulai`, t, { lineIds: [nol] })).status === 403);
  rec("koreksi waktu hitung oleh akun tanpa izin tulis → 403", (await api("POST", `${SC}/${nol}/lines/${nol}/waktu`, t, { observedAt: new Date().toISOString(), alasan: "uji smoke tanpa izin" })).status === 403);
  rec("keputusan massal pergerakan oleh akun tanpa izin tulis → 403", (await api("POST", `${SC}/${nol}/pergerakan/tanda-massal`, t, { tercermin: false })).status === 403);
} else skip("penolakan tulis 403", "tidak ada akun aktif tanpa izin tulis Inventory");
if (tanpaBaca) rec("pratinjau cakupan oleh akun tanpa izin baca → 403", (await api("POST", SC + "/scope-preview", tokenUntuk(tanpaBaca), { mode: "FULL" })).status === 403); else skip("pratinjau 403", "tidak ada akun aktif tanpa izin baca Inventory");
rec("kerja: UUID tidak valid → 400", (await api("GET", `${SC}/bukan-uuid/kerja`, tB)).status === 400);
rec("kerja: sesi tidak ada → 404", (await api("GET", `${SC}/${nol}/kerja`, tB)).status === 404);

// ── Baca: sesi lama tetap terbaca persis seperti sebelum rilis ──
const daftar = await api("GET", SC, tB);
rec("daftar sesi hitung: 200", daftar.status === 200 && Array.isArray(daftar.json?.counts), String(daftar.status));
const sesiDb = await prisma.stockCount.findMany({ select: { id: true, countNumber: true, status: true, modelVersion: true, _count: { select: { lines: true } } }, orderBy: { createdAt: "asc" } });
rec("semua sesi di produksi bermodel 1 (rilis ini tidak membuat sesi model baru)", sesiDb.every((s) => s.modelVersion === 1), `n=${sesiDb.length}`);
if (sesiDb.length === 0) skip("sesi lama terbaca", "tidak ada sesi hitung di produksi");
for (const s of sesiDb) {
  const d = await api("GET", `${SC}/${s.id}`, tB);
  rec(`sesi lama ${s.countNumber} (${s.status}, ${s._count.lines} baris) terbaca: 200, model 1, jumlah baris sama dengan database`, d.status === 200 && d.json?.sesi?.modelVersion === 1 && d.json?.lines?.length === s._count.lines, `${d.status} baris=${d.json?.lines?.length}`);
  const k = await api("GET", `${SC}/${s.id}/kerja`, tB);
  rec(`halaman kerja model baru menolak sesi lama ${s.countNumber} dengan SESI_LAMA (409)`, k.status === 409 && k.json?.code === "SESI_LAMA", `${k.status}`);
  const di = daftar.json?.counts?.find((c) => c.id === s.id);
  rec(`daftar memuat ${s.countNumber} dengan jumlahBahan ${s._count.lines}`, !!di && di.jumlahBahan === s._count.lines);
}
// ── Pratinjau cakupan Opname penuh di atas bahan NYATA (baca-saja) ──
const aktifN = await hitung("select count(*)::int n from materials where active");
const pr = await api("POST", SC + "/scope-preview", tB, { mode: "FULL" });
rec("pratinjau Opname penuh: 200", pr.status === 200, String(pr.status));
const r = pr.json?.ringkasan;
rec("pratinjau memuat seluruh bahan aktif: masuk + tidak dilacak = bahan aktif di database", !!r && r.bahanAktif === aktifN && r.masuk + r.tidakDilacak.jumlah === aktifN, `aktif=${aktifN} masuk=${r?.masuk} tidakDilacak=${r?.tidakDilacak?.jumlah}`);
rec("pratinjau menyebut dasar cakupan 'dilacak secara fisik' dan alasan tiap bahan tidak dilacak", typeof r?.dasarCakupan === "string" && /dilacak secara fisik/.test(r.dasarCakupan) && (r.tidakDilacak.daftar ?? []).every((x) => /Tidak ada jejak stok/.test(x.alasan)));
rec("pratinjau Cycle Count memerlukan bahan yang dipilih (400)", (await api("POST", SC + "/scope-preview", tB, { mode: "ITEMS", materialIds: [] })).status === 400);
rec("daftar bahan Cycle Count: 200", (await api("GET", SC + "/bahan?limit=5", tB)).status === 200);
// Jalur lama tidak rusak
rec("stok lama tetap 200", (await api("GET", "/api/inventory/stock", tB)).status === 200);
rec("daftar penerimaan lama tetap 200", (await api("GET", "/api/inventory/goods-receipts", tB)).status === 200);
// Tidak ada tulisan
rec("smoke tidak menulis sesi, baris hitung, pergerakan stok, maupun jejak aktivitas", (await hitung("select count(*)::int n from stock_counts")) === awal.sesi && (await hitung("select count(*)::int n from stock_count_lines")) === awal.baris && (await hitung("select count(*)::int n from stock_movements")) === awal.mov && (await hitung("select count(*)::int n from activity_events")) === awal.ev);
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP); " + sesiDb.length + " sesi lama diperiksa");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else ok "smoke test lulus (izin, penolakan sebelum menyentuh data, sesi lama terbaca, pratinjau cakupan atas bahan nyata)"; fi
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
ok "dokumen pembanding beku (pergerakan stok, saldo per bahan, GR + baris + event, jurnal, PO, tagihan, pembayaran, Produksi, aktivitas, sesi hitung lama) IDENTIK sebelum vs sesudah rilis"
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
say "CATATAN: belum ada sesi opname model baru dibuat oleh rilis ini (sesi 1 November dibuat Gudang lewat Jadwalkan Hitungan setelah Owner memutuskan daftar bahan tidak dilacak). Uji sesi pertama dengan Cycle Count kecil + penyetuju berbeda."
