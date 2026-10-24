#!/usr/bin/env bash
# RILIS "REKONSILIASI PEMAKAIAN HISTORIS" — KODE + 1 MIGRASI ADITIF (4 tabel baru KOSONG, 2 kolom nullable, 1 pagar CHECK yang diperlonggar satu hal). FAIL-CLOSED. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA = release live saat ini).
#   RILIS KODE ≠ TINDAKAN DATA. Skrip ini HANYA memasang kode + skema. Ia TIDAK mengimpor CSV, TIDAK menjalankan manifest, TIDAK memposting 384 transaksi, TIDAK menulis jurnal. Rilis selesai dengan ANTREAN KOSONG (tabel baru 0 baris; rencana posting 0 transaksi) dan smoke membuktikannya.
#   Impor catatan + posting adalah tindakan data TERPISAH yang membutuhkan persetujuan Owner sendiri SETELAH fitur live dan terverifikasi (lihat docs/rekonsiliasi-pemakaian-historis.md).
#   Kode: catatan pemakaian historis tampil di Order Produksi (nilai asli, "Perlu dicek"), koreksi catatan/pemakaian/saldo/harga berjejak (sebelum–sesudah, alasan, pelaku, waktu, asal), HPP PARSIAL + gap; posting terpadu bergerbang hash (tidak dijalankan di sini).
#   PRASYARAT: rilis UX Bahan katalog (fix/ux-bahan-drawer-pemakaian, commit 693b8c52, migrasi 20261227090000) HARUS sudah live; baseline (BASE_SHA) = commit release aktif itu. Skrip menolak berjalan bila release aktif BUKAN baseline itu (BASE_SHA) atau migrasi terpasang bukan himpunan baseline.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, prisma = TEPAT migrasi + schema.prisma, TEPAT 1 migrasi yang di-pin + pemindai DDL + uji negatif, dependensi/Docker identik, berkas pelindung identik, diff ledger/penyesuaian dipatok) → (2) audit produksi baca-saja + sidik jari beku + sidik jari skema lama
#              → (R) --rehearsal-penuh: backup nyata + image kandidat bertag rehearsal + restore + MIGRASI pada salinan + uji aplikasi pada salinan (antrean kosong + jalur tulis) + build web final + bukti 36 jam
#              → rilis penuh: (3) backup → (4) release dir + build web → (5) image baru → pemeriksaan data nyata (restore + migrasi pada salinan) → (6) migrasi production (backend lama tetap melayani) → (7) switch → (8) verifikasi + smoke baca-saja (antrean kosong) + sidik jari beku.
#
#   cat scripts/release-rekon-pemakaian.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rkp.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rkp.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rkp.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-penuh > /tmp/rkp.out 2>&1 < /dev/null &'   # TANPA release dir/switch/migrasi production; menulis bukti 36 jam
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rkp.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/rkp.out 2>&1 < /dev/null &'                    # rilis penuh: WAJIB ada bukti --rehearsal-penuh LULUS untuk SHA + baseline yang sama (<36 jam)
#
# ROLLBACK: HANYA lewat scripts/rollback-rekon-pemakaian.sh, yang menjalankan guard baca-saja dan MENOLAK setiap exit selain 0. Guard 0 = tabel baru kosong (tidak ada yang tersembunyi): image lama (tag rollback-pre-rkp-<sha8>) boleh dipasang kembali; migrasi TIDAK perlu dibalik.
#   Begitu tabel baru berisi impor/catatan/koreksi/posting, kode lama MENYEMBUNYIKAN data itu (label "Perlu dicek", HPP PARSIAL, koreksi) → rollback rutin DITOLAK (exit 10/20). Pemulihannya perbaikan maju atau keputusan pemulihan khusus setelah dampak data dinilai.
# (dibangkitkan oleh scripts/gen-release-rekon-pemakaian.cjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang; templat sha256 ef3c5009164d…)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/rekon-pemakaian-historis}"
# Migrasi live terakhir (HARUS = migrasi terakhir di baseline, kandidat, dan produksi) dan jumlahnya: rilis ini tidak menambah/mengubah migrasi.
# Baseline: migrasi terakhir + jumlah (kandidat = baseline + TEPAT 1 migrasi rilis).
LIVE_MIG_TERAKHIR="20261227090000_pemakaian_sementara_material_id_terkunci"; LIVE_MIG_JUMLAH="267"
# Migrasi rilis yang SUDAH diaudit (nama + sha256 isi LF) dan hasil pemindai DDL-nya. Selisih sekecil apa pun = berhenti.
MIG_NAME="20261228090000_catatan_pemakaian_historis"; MIG_PIN="fee1fb7d3f3ac8579585f3e8d4f38ada6e2663abddd5c4c731cf4854c9406722"; SCAN_EXPECT='{"total":34,"create_table":4,"index":12,"fk":7,"fungsi":3,"trigger":3,"alter_lama":5}'
PRASYARAT="rilis UX Bahan katalog (fix/ux-bahan-drawer-pemakaian, commit 693b8c52, migrasi 20261227090000) HARUS sudah live; baseline (BASE_SHA) = commit release aktif itu"
# Diff berkas yang menyentuh stok/penyesuaian terhadap baseline dipatok (sha256 isi diff): perubahan sekecil apa pun setelah audit = berhenti.
DIFF_PINS="backend/src/services/inventoryLedger.js:32229261cc91a9a80ae5bb7c3fd40e06affb81e950b8efaec8f6c03c6cee4028 backend/src/routes/stockAdjustment.js:0438b5189e34a381908ace033228bb93e21c0a128e931aef10a726603fc44950"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard). Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261228090000_catatan_pemakaian_historis/migration\.sql|backend/prisma/schema\.prisma|backend/scripts/import-pemakaian-historis\.js|backend/scripts/laporan-rekonsiliasi-pemakaian\.js|backend/src/index\.js|backend/src/lib/domain/pemakaianHistoris\.js|backend/src/routes/biayaBahan\.js|backend/src/routes/pemakaianKoreksi\.js|backend/src/routes/productionAdopsi\.js|backend/src/routes/stockAdjustment\.js|backend/src/services/asalKoreksiSaldo\.js|backend/src/services/catatanPemakaianHistoris\.js|backend/src/services/finance/biayaBahan\.js|backend/src/services/finance/koreksiValuasi\.js|backend/src/services/inventoryLedger\.js|backend/src/services/koreksiPemakaian\.js|backend/src/services/laporanRekonsiliasiPemakaian\.js|backend/src/services/postingPemakaianHistoris\.js|backend/src/services/productionOrderExport\.js|backend/src/services/productionOrderList\.js|backend/tests/imporTerkelolaPemakaianHistoris\.test\.js|backend/tests/integration/catatanHistorisProduksi\.integration\.test\.js|backend/tests/integration/catatanPemakaianHistoris\.integration\.test\.js|backend/tests/integration/productionAdopsi\.integration\.test\.js|backend/tests/integration/rekonsiliasiKoreksiPosting\.integration\.test\.js|backend/tests/integration/setup/testApp\.js|backend/tests/integration/setup/testDb\.js|backend/tests/pemakaianHistoris\.test\.js|backend/tests/releaseRekonPemakaian\.test\.js|docs/impor-catatan-historis-production\.md|docs/rekonsiliasi-pemakaian-historis\.md|frontend/src/api\.js|frontend/src/features/finance/biayaBahanLogic\.js|frontend/src/features/production/OrderProduksiPanel\.jsx|frontend/src/features/production/bahan/CatatanHistorisBagian\.jsx|frontend/src/features/production/bahan/PemakaianAktualBagian\.jsx|frontend/src/features/production/bahan/catatanHistorisModel\.js|frontend/src/features/warehouse/components/AdjustmentsTab\.jsx|frontend/src/features/warehouse/dokumen/PenyesuaianDetail\.jsx|frontend/tests/catatanHistoris\.test\.js|scripts/gen-release-rekon-pemakaian\.cjs|scripts/lib/impor-terkelola-pemakaian-historis\.mjs|scripts/lib/rehearsal-rekon-pemakaian\.mjs|scripts/lib/scan-migrasi-rekon-pemakaian\.mjs|scripts/lib/smoke-rekon-pemakaian\.mjs|scripts/release-rekon-pemakaian\.sh|scripts/rollback-guard-rekon-pemakaian\.sh|scripts/rollback-rekon-pemakaian\.sh|scripts/templates/release-rekon-pemakaian\.sh\.tpl)$'
BACKEND_SRC_EXPECT="backend/src/index.js backend/src/lib/domain/pemakaianHistoris.js backend/src/routes/biayaBahan.js backend/src/routes/pemakaianKoreksi.js backend/src/routes/productionAdopsi.js backend/src/routes/stockAdjustment.js backend/src/services/asalKoreksiSaldo.js backend/src/services/catatanPemakaianHistoris.js backend/src/services/finance/biayaBahan.js backend/src/services/finance/koreksiValuasi.js backend/src/services/inventoryLedger.js backend/src/services/koreksiPemakaian.js backend/src/services/laporanRekonsiliasiPemakaian.js backend/src/services/postingPemakaianHistoris.js backend/src/services/productionOrderExport.js backend/src/services/productionOrderList.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/finance/biayaBahanLogic.js frontend/src/features/production/OrderProduksiPanel.jsx frontend/src/features/production/bahan/CatatanHistorisBagian.jsx frontend/src/features/production/bahan/PemakaianAktualBagian.jsx frontend/src/features/production/bahan/catatanHistorisModel.js frontend/src/features/warehouse/components/AdjustmentsTab.jsx frontend/src/features/warehouse/dokumen/PenyesuaianDetail.jsx"
# Perubahan live yang TIDAK boleh hilang/berubah: hotfix Stock Count; berkas pelindung identik dengan baseline (Koreksi Gudang inti, jurnal, otorisasi, Produksi override, Stock Count).
HOTFIX_STOCK_COUNT="b5268e1f7d8e1a15a251106dee0a136898ee5ce1"
GUARD_UNCHANGED="backend/src/services/warehouseCorrection.js backend/src/routes/gudangKoreksi.js backend/src/services/inventorySegregation.js backend/src/services/opnameCutover.js backend/src/services/opnameMatriks.js backend/src/services/pergerakanSesiHitung.js backend/src/services/identitasHitung.js backend/src/services/finance/journal.js backend/src/services/finance/posting/inventory.js backend/src/middleware/authorize.js backend/src/middleware/auth.js backend/src/constants/permissions.js backend/src/lib/activityLog.js backend/src/lib/jejakPerubahan.js backend/src/services/gudangBeranda.js backend/src/services/adminOverrideSwitch.js backend/src/services/deliveryOverrideAdmin.js backend/src/services/productionStepCommandService.js backend/src/services/productionMaterialIssueCommandService.js backend/src/routes/productionPlanning.js"
LIVE_ANCESTORS="693b8c52d58b520c5e36111ccfaa511d8fcb0a0c fa6beb8608387c8107f730e48ac121aa6beef76e 0cd0262be54b40665577816d71609e1a49c21547 4394c8288944a7116fbe5970c037d66a14e4ec12 1f79ddd28264d8b8fdf6ebb6cda111e9758cb628 624f08d8b5a77305a152e915e24f0023a2e35524 d82e6e3d9ced46b423be57ca0eab680f38953587 fd38f6c2382af914d1ebdd531a5dc430cff758c9 96cced3f9ba271bf1ecf4b9842d99bd035568994 e47f37e2d6690130525681863ff467682e30f3c4 57198ad687045519a12af14a3097ccf6b61e9054 58cbc284aa71038ce2694e4579282f5e5abf3a05 bcf8b77031100bb62ebfb7ed27f5e15a243981d0 20606872412290a0a80f563e605f7717bf57f3e0 10294dcbc45d7e13c737721ddaa34e38f5b2ee77 08d62e7d713b08fc9e0f1d898c37791352476b5b 799d3e93de192c604a14f1c11fe7436538689bb0 56b87721f84c1d16a2cd1655e40787e2b626cb0f e5a32cd246b2233e9d05d9b2cbff733e4497725d 229755d6eae125f82671d173898f71815d13f080 f293c5879fdac10e5ef0e1bb8a1169ef9ce8bef6 ca9bdea72a03df5794658fb485c6f3a79b360eee 694f21846f206edba5542e68ffe4c3ea98a47c24"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
PREFLIGHT_ONLY=0; REHEARSAL_ONLY=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; [ "$a" = "--rehearsal-penuh" ] && REHEARSAL_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/rekon-pemakaian-${DEPLOY_SHORT}-${TS}"
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
Rollback kode setelah switch HANYA lewat pemanggil resmi (menjalankan guard baca-saja dan menolak semua exit selain 0; default = rencana saja):
   bash ${NEW_DIR:-<release-baru>}/scripts/rollback-rekon-pemakaian.sh ${PREV_DIR:-<release-sebelumnya>} ${ROLLBACK_TAG:-<tag-rollback>} [--jalankan]
Guard exit 0 (tabel baru KOSONG) = rollback rutin boleh. Exit 10 (ada data) / 20 (ada koreksi menunggu) / 1 / 2 = DITOLAK: kode lama menyembunyikan data itu. Pemulihan = PERBAIKAN MAJU atau KEPUTUSAN PEMULIHAN KHUSUS (Owner + Finance + Gudang) setelah dampak data dinilai — jangan memasang image lama dengan perintah docker manual.
Migrasi tidak dibalik; tabel/baris rekonsiliasi tidak boleh dihapus (riwayat append-only).
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
exec 9>/tmp/release-rekon-pemakaian.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rkp\.sh\|release-rekon-pemakaian\|pgrep\|node src/index.js" | grep -v "$$" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
if [ "$PREFLIGHT_ONLY" = "0" ] && [ "$REHEARSAL_ONLY" = "0" ]; then [ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"; fi

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
! printf '%s\n' "$CHANGED" | grep -q 'production-evidence' || die "artefak foto uji ikut ter-commit"
! printf '%s\n' "$CHANGED" | grep -q 'receipt-proofs' || die "artefak unggahan uji ikut ter-commit"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)\.env' || die "berkas .env ikut ter-commit"
! printf '%s\n' "$CHANGED" | grep -q '^driver-mobile/' || die "driver-mobile berubah — rilis ini tidak membawa app Driver"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
# MIGRASI: berkas backend/prisma yang berubah HARUS tepat migrasi rilis + schema.prisma (model baru); dependensi, Dockerfile, compose IDENTIK; migrasi baseline tidak diubah/dihapus.
EXPECT_PRISMA="$(printf '%s\n%s\n' "backend/prisma/migrations/${MIG_NAME}/migration.sql" "backend/prisma/schema.prisma" | LC_ALL=C sort)"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' | LC_ALL=C sort || true)"
[ "$PRISMA_CHANGED" = "$EXPECT_PRISMA" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat migrasi rilis ini + schema.prisma"; }
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
for p in backend/package.json backend/package-lock.json backend/Dockerfile docker-compose.yml docker-compose.release.yml frontend/package.json frontend/package-lock.json; do
  [ "$(sg rev-parse -q --verify "${BASE_SHA}:${p}" 2>/dev/null || echo tidak-ada)" = "$(sg rev-parse -q --verify "${DEPLOY_SHA}:${p}" 2>/dev/null || echo tidak-ada)" ] || die "${p} BERBEDA antara baseline dan kandidat — rilis ini tidak mengubah dependensi/Docker"
done
for pin in $DIFF_PINS; do
  f="${pin%%:*}"; want="${pin##*:}"; have="$(sg diff --full-index --no-color --no-ext-diff "$BASE_SHA" "$DEPLOY_SHA" -- "$f" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "diff ${f} terhadap baseline BERBEDA dari yang diaudit (sha256 ${have:0:12}…) — audit ulang lalu bangkitkan skrip"
done
ok "dependensi, Dockerfile, dan compose IDENTIK; berkas prisma yang berubah = migrasi rilis + schema.prisma; diff ledger/penyesuaian stok = yang diaudit ($(printf '%s\n' $DIFF_PINS | wc -l) berkas dipatok)"
[[ "$MIG_NAME" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $MIG_NAME"
ALL_SQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | tr -d '\r')"
h="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
[ "$MIG_PIN" = "$h" ] || die "isi migrasi ${MIG_NAME} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
ok "migrasi ${MIG_NAME}: sha256 cocok pin (${h:0:12})"
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai migrasi rilis "Rekonsiliasi pemakaian historis" (1 migrasi ADITIF). FAIL-CLOSED: setiap pernyataan harus cocok PERSIS salah satu bentuk yang diaudit. Membaca SQL dari stdin (komentar baris "--" sudah dibuang pemanggil).
//   • 4 CREATE TABLE baru (usage_import_batches, unit_usage_notes, unit_usage_note_events, fin_stock_movement_valuation_corrections) — wajib memuat CHECK yang diaudit.
//   • indeks HANYA pada tabel baru; foreign key HANYA dari tabel baru (ON DELETE RESTRICT); 3 fungsi penjaga + 3 trigger HANYA pada tabel baru (badan fungsi hanya IF/RAISE/RETURN, tanpa DDL/DML).
//   • TEPAT 5 pernyataan pada tabel LAMA, ditulis persis: warehouse_corrections (DROP + ADD CONSTRAINT jenis_chk yang diperlonggar satu hal: doc_type + 'UNIT_USAGE') dan stock_adjustment_requests (2 kolom TEXT nullable + CHECK pasangan).
// Tidak ada INSERT/UPDATE/DELETE/TRUNCATE/GRANT/RENAME/CREATE TYPE/EXTENSION; tidak ada kolom NOT NULL baru pada tabel lama. Isi migrasi juga dipatok sha256 di skrip rilis; pemindai ini lapisan kedua, diuji dengan mutan negatif.
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
const T_BARU = "(?:usage_import_batches|unit_usage_notes|unit_usage_note_events|fin_stock_movement_valuation_corrections)";
const F_BARU = "(?:unit_usage_notes_guard|unit_usage_note_events_guard|fin_smv_corr_append_only)";
const WAJIB_DI_TABEL = {
  usage_import_batches: ['CONSTRAINT "usage_import_batches_kind_chk" CHECK ("source_kind" IN (\'EXCEL_ADMIN_SALES_CSV\'))', 'CONSTRAINT "usage_import_batches_sha_chk"'],
  unit_usage_notes: ['CONSTRAINT "unit_usage_notes_origin_chk" CHECK ("origin" IN (\'EXCEL\',\'LEDGER\'))', 'CONSTRAINT "unit_usage_notes_state_chk"', 'CONSTRAINT "unit_usage_notes_posted_chk"', 'CONSTRAINT "unit_usage_notes_siap_chk"'],
  unit_usage_note_events: ['CONSTRAINT "unit_usage_note_events_kind_chk"', 'CONSTRAINT "unit_usage_note_events_reason_chk"'],
  fin_stock_movement_valuation_corrections: ['CONSTRAINT "fin_smv_corr_reason_chk" CHECK (length(btrim("reason")) >= 5)', 'CONSTRAINT "fin_smv_corr_cost_chk" CHECK ("unit_cost_basis" >= 0)'],
};
// Pernyataan pada tabel LAMA: hanya bentuk persis ini.
const LAMA_PERSIS = new Set([
  'ALTER TABLE "warehouse_corrections" DROP CONSTRAINT "warehouse_corrections_jenis_chk"',
  `ALTER TABLE "warehouse_corrections" ADD CONSTRAINT "warehouse_corrections_jenis_chk" CHECK ("doc_type" IN ('GOODS_RECEIPT', 'UNIT_USAGE') AND "kind" IN ('METADATA', 'STOCK') AND "status" IN ('PENDING_APPROVAL', 'POSTED', 'REJECTED', 'CANCELLED'))`,
  'ALTER TABLE "stock_adjustment_requests" ADD COLUMN "origin_type" TEXT',
  'ALTER TABLE "stock_adjustment_requests" ADD COLUMN "origin_id" TEXT',
  'ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_origin_chk" CHECK (("origin_type" IS NULL) = ("origin_id" IS NULL))',
]);
const BENTUK = [
  ["create_table", new RegExp(`^CREATE TABLE "${T_BARU}" \\(.*\\)$`)],
  ["index", new RegExp(`^CREATE (?:UNIQUE )?INDEX "[a-z0-9_]+" ON "${T_BARU}"\\("[a-z0-9_]+"(?:, "[a-z0-9_]+")*\\)(?: WHERE "[a-z_]+" IS NOT NULL)?$`)],
  ["fk", new RegExp(`^ALTER TABLE "${T_BARU}" ADD CONSTRAINT "[a-z0-9_]+_fkey" FOREIGN KEY \\("[a-z_]+"\\) REFERENCES "(?:usage_import_batches|Order|units|materials|stock_movements|unit_usage_notes)"\\("id"\\) ON DELETE RESTRICT ON UPDATE CASCADE$`)],
  ["fungsi", new RegExp(`^CREATE OR REPLACE FUNCTION ${F_BARU}\\(\\) RETURNS trigger AS \\$\\$ BEGIN .* END \\$\\$ LANGUAGE plpgsql$`)],
  ["trigger", new RegExp(`^CREATE TRIGGER "(?:unit_usage_notes_guard_trg|unit_usage_note_events_guard_trg|fin_smv_corr_append_only_trg)" BEFORE UPDATE OR DELETE ON "${T_BARU}" FOR EACH ROW EXECUTE FUNCTION ${F_BARU}\\(\\)$`)],
];
const TERLARANG = /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|GRANT|REVOKE|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|CREATE\s+TYPE|ADD\s+VALUE|DISABLE|CREATE\s+EXTENSION)\b/i;
// badan fungsi: setelah literal string dibuang, TIDAK boleh ada DDL/DML/EXECUTE/PERFORM
const TERLARANG_BADAN = /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT|UPDATE|CREATE|ALTER|GRANT|REVOKE|EXECUTE|PERFORM|COPY|SELECT|DO)\b/i;
const hitung = { total: 0, create_table: 0, index: 0, fk: 0, fungsi: 0, trigger: 0, alter_lama: 0 };
const lihat = new Set();
for (const r of pecah(sql)) {
  hitung.total += 1;
  if (lihat.has(r)) gagal("pernyataan ganda: " + r.slice(0, 120));
  lihat.add(r);
  let jenis = LAMA_PERSIS.has(r) ? "alter_lama" : BENTUK.find(([, re]) => re.test(r))?.[0];
  if (!jenis) gagal("PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 220));
  const luarBadan = r.replace(/\$\$.*\$\$/g, "$$$$");
  if (jenis === "create_table") {
    const nama = /^CREATE TABLE "([a-z_]+)"/.exec(r)[1];
    for (const w of WAJIB_DI_TABEL[nama] ?? []) if (!r.includes(w)) gagal(`CREATE TABLE ${nama} kehilangan constraint yang diaudit: ${w.slice(0, 90)}`);
    if (/\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|GRANT)\b/i.test(r)) gagal("CREATE TABLE memuat kata terlarang");
    if (/\bDEFAULT\s+(?!CURRENT_TIMESTAMP|'\{\}'|'\[\]')/i.test(r)) gagal("DEFAULT tidak dikenal di CREATE TABLE " + nama);
  } else if (jenis === "fungsi") {
    const badan = /\$\$(.*)\$\$/.exec(r)[1].replace(/'[^']*'/g, "''");
    if (TERLARANG_BADAN.test(badan)) gagal("badan fungsi memuat DDL/DML terlarang: " + badan.slice(0, 160));
  } else if (jenis !== "alter_lama" && TERLARANG.test(luarBadan)) gagal("kata terlarang di luar badan fungsi: " + r.slice(0, 160));
  hitung[jenis] += 1;
}
console.log(JSON.stringify(hitung));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hasil pemindai migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi (${HASIL_SCAN}): CREATE TABLE/INDEX/FK/FUNCTION/TRIGGER hanya pada 4 tabel baru; pada tabel LAMA hanya 5 pernyataan persis (jenis_chk koreksi Gudang + 2 kolom nullable + CHECK pasangan); tanpa INSERT/UPDATE/DELETE/TRUNCATE/GRANT/EXTENSION; tanpa kolom NOT NULL pada tabel lama"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hasil ≠ SCAN_EXPECT.
NEG=0
harus_ditolak() { local nama="$1" teks="$2" o; if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi; NEG=$((NEG+1)); }
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE units" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "UPDATE units" "$(tambah_stmt "UPDATE \"units\" SET \"status\" = 'RECEIVED';")"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "units";')"
harus_ditolak "INSERT backfill ke tabel baru" "$(tambah_stmt "INSERT INTO \"unit_usage_notes\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "unit_usage_notes";')"
harus_ditolak "ALTER TABLE tabel lama ADD COLUMN" "$(tambah_stmt 'ALTER TABLE "units" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom tambahan di tabel koreksi Gudang" "$(tambah_stmt 'ALTER TABLE "warehouse_corrections" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom NOT NULL pada penyesuaian stok" "$(tambah_stmt 'ALTER TABLE "stock_adjustment_requests" ADD COLUMN "origin_x" TEXT NOT NULL;')"
harus_ditolak "pagar jenis koreksi dilonggarkan lebih jauh" "$(printf '%s\n' "$ALL_SQL" | sed "s/'UNIT_USAGE'/'UNIT_USAGE', 'EVIL'/")"
harus_ditolak "CREATE TABLE liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL);')"
harus_ditolak "CREATE INDEX pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("status");')"
harus_ditolak "FK dari tabel lama ke tabel baru" "$(tambah_stmt 'ALTER TABLE "units" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("id") REFERENCES "unit_usage_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "FK tabel baru ON DELETE CASCADE" "$(tambah_stmt 'ALTER TABLE "unit_usage_notes" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;')"
harus_ditolak "CREATE TRIGGER pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE UPDATE ON "units" FOR EACH ROW EXECUTE FUNCTION unit_usage_notes_guard();')"
harus_ditolak "DROP TRIGGER" "$(tambah_stmt 'DROP TRIGGER "unit_usage_notes_guard_trg" ON "unit_usage_notes";')"
harus_ditolak "DISABLE TRIGGER" "$(tambah_stmt 'ALTER TABLE "unit_usage_notes" DISABLE TRIGGER ALL;')"
harus_ditolak "fungsi liar kedua" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql;')"
harus_ditolak "fungsi lain (OR REPLACE)" "$(tambah_stmt 'CREATE OR REPLACE FUNCTION production_adopsi_append_only() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql;')"
harus_ditolak "badan fungsi memuat DELETE FROM" "$(printf '%s\n' "$ALL_SQL" | sed 's/RETURN NEW;/DELETE FROM units; RETURN NEW;/')"
harus_ditolak "badan fungsi memuat EXECUTE" "$(printf '%s\n' "$ALL_SQL" | sed "s/RETURN NEW;/EXECUTE 'drop table units'; RETURN NEW;/")"
harus_ditolak "constraint audit dihapus dari tabel baru" "$(printf '%s\n' "$ALL_SQL" | sed 's/"unit_usage_notes_posted_chk"/"x_chk"/')"
harus_ditolak "CHECK pasangan origin dihapus" "$(printf '%s\n' "$ALL_SQL" | sed 's/stock_adjustment_requests_origin_chk/stock_adjustment_requests_x_chk/')"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "unit_usage_notes" TO PUBLIC;')"
harus_ditolak "DROP CONSTRAINT tabel lama lain" "$(tambah_stmt 'ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_pkey";')"
ok "uji negatif pemindai: ${NEG} mutan (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER tabel lama/kolom NOT NULL/pagar dilonggarkan/CREATE TABLE-INDEX-TRIGGER liar/FK dari tabel lama/FK CASCADE/DISABLE TRIGGER/fungsi liar/badan berbahaya/constraint audit hilang/EXTENSION/GRANT) SEMUA ditolak"
CAND_MIGS="$(sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u)"
BASE_MIGS="$(sg ls-tree --name-only "$BASE_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u)"
[ "$(printf '%s\n' "$BASE_MIGS" | grep -c .)" = "$LIVE_MIG_JUMLAH" ] && [ "$(printf '%s\n' "$BASE_MIGS" | tail -n 1)" = "$LIVE_MIG_TERAKHIR" ] || die "migrasi baseline tidak sesuai pin (${LIVE_MIG_JUMLAH}, terakhir ${LIVE_MIG_TERAKHIR})"
[ "$(printf '%s\n' "$CAND_MIGS" | grep -c .)" = "$(( LIVE_MIG_JUMLAH + 1 ))" ] && [ "$(printf '%s\n' "$CAND_MIGS" | tail -n 1)" = "$MIG_NAME" ] || die "migrasi kandidat harus = baseline + ${MIG_NAME} (terakhir)"
cmp -s <(printf '%s\n' "$BASE_MIGS" "$MIG_NAME") <(printf '%s\n' "$CAND_MIGS") || die "himpunan migrasi kandidat bukan tepat baseline + migrasi rilis"
ok "migrasi kandidat = baseline (${LIVE_MIG_JUMLAH}) + ${MIG_NAME}"
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
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHA:0:8} — PRASYARAT BELUM TERPENUHI atau produksi bergeser: ${PRASYARAT}. Berhenti."
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
for T in stock_movements goods_receipts goods_receipt_lines goods_receipt_events materials '"User"' activity_events warehouse_corrections stock_counts material_issues fin_journal_entries fin_journal_lines fin_purchase_orders fin_supplier_bills fin_supplier_bill_allocations fin_supplier_payments production_runs_v2 material_issue_lines stock_transfers stock_transfer_lines stock_count_lines replenishment_requests damaged_stock_records return_records stock_adjustment_requests material_reservations_v2 fin_stock_movement_valuations; do
  [ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename='${T//\"/}'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
# Keadaan production: SEGAR = tepat himpunan baseline (migrasi rilis pending); LANJUT = baseline + migrasi rilis SUDAH terpasang dengan checksum yang benar (rilis sebelumnya terhenti sesudah migrasi). Selain itu = berhenti.
RAW_SHA="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
keadaan_produksi() {
  local sfx="$1" lama row
  psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum${sfx}.txt" || { echo "TOLAK: gagal membaca migrasi terpasang"; return 1; }
  if cmp -s "$BK_DIR/applied-sebelum${sfx}.txt" <(printf '%s\n' "$BASE_MIGS"); then echo SEGAR; return 0; fi
  lama="$(grep -vxF "$MIG_NAME" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  [ "$lama" = "$BASE_MIGS" ] || { echo "TOLAK: migrasi terpasang BUKAN baseline atau baseline + migrasi rilis"; return 1; }
  row="$(psql_live -At -c "select checksum||'|'||applied_steps_count::text||'|'||(finished_at is not null)::text||'|'||(rolled_back_at is null)::text from _prisma_migrations where migration_name='${MIG_NAME}'")"
  [ "$row" = "$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | sha256sum | cut -d' ' -f1)|1|true|true" ] || { echo "TOLAK: migrasi rilis terpasang tetapi checksum/status tidak cocok"; return 1; }
  echo LANJUT
}
KEADAAN="$(keadaan_produksi "")" || die "${KEADAAN}"
[ "$KEADAAN" = "SEGAR" ] || [ "$KEADAAN" = "LANJUT" ] || die "keadaan production tidak dikenal: ${KEADAAN}"
MIG_SEBELUM="$LIVE_MIG_JUMLAH"
ok "keadaan production: ${KEADAAN} (baseline ${MIG_SEBELUM} migrasi; migrasi rilis ${MIG_NAME} $([ "$KEADAAN" = "SEGAR" ] && echo 'pending' || echo 'SUDAH terpasang'))"
NEW4="'usage_import_batches','unit_usage_notes','unit_usage_note_events','fin_stock_movement_valuation_corrections'"
# Sidik jari skema LAMA: semua tabel/kolom/constraint/indeks/trigger KECUALI 4 tabel baru dan 3 potong yang memang diubah migrasi (kolom origin_*, origin_chk, jenis_chk — diperiksa terpisah oleh STRUKTUR_SQL).
SKEMA_SQL="select md5(string_agg(x, '|' order by x)) from (select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') x from information_schema.columns where table_schema='public' and table_name not in (${NEW4}) and not (table_name='stock_adjustment_requests' and column_name in ('origin_type','origin_id')) union all select conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text not in (${NEW4}) and conname not in ('stock_adjustment_requests_origin_chk','warehouse_corrections_jenis_chk') union all select tablename||':'||indexname||':'||indexdef from pg_indexes where schemaname='public' and tablename not in (${NEW4}) union all select event_object_table||':'||trigger_name||':'||action_timing||':'||event_manipulation from information_schema.triggers where trigger_schema='public' and event_object_table not in (${NEW4})) s"
# Fungsi LAMA (semua fungsi public kecuali 3 penjaga baru) HARUS identik sebelum/sesudah migrasi (migrasi ini tidak mengganti fungsi lama).
FUNC_SQL="select md5(string_agg(x, '|' order by x)) from (select p.proname||':'||md5(pg_get_functiondef(p.oid)) x from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname not in ('unit_usage_notes_guard','unit_usage_note_events_guard','fin_smv_corr_append_only')) s"
# Struktur BARU: sebelum migrasi 0|0|0|1 (belum ada tabel/trigger/kolom; jenis_chk lama ada); sesudah 4|3|2|2.
STRUKTUR_SQL="select (select count(*) from pg_tables where schemaname='public' and tablename in (${NEW4}))||'|'||(select count(*) from pg_trigger where not tgisinternal and tgname in ('unit_usage_notes_guard_trg','unit_usage_note_events_guard_trg','fin_smv_corr_append_only_trg'))||'|'||(select count(*) from information_schema.columns where table_schema='public' and table_name='stock_adjustment_requests' and column_name in ('origin_type','origin_id'))||'|'||(select count(*) from pg_constraint where conname in ('stock_adjustment_requests_origin_chk','warehouse_corrections_jenis_chk'))"
BARU_KOSONG_SQL="select (select count(*) from usage_import_batches)+(select count(*) from unit_usage_notes)+(select count(*) from unit_usage_note_events)+(select count(*) from fin_stock_movement_valuation_corrections)+(select count(*) from warehouse_corrections where doc_type = 'UNIT_USAGE')+(select count(*) from stock_adjustment_requests where origin_type is not null or origin_id is not null)"
SKEMA_PRA="$(psql_live -At -c "$SKEMA_SQL")"; [ -n "$SKEMA_PRA" ] || die "sidik jari skema produksi kosong"
# Versi NORMAL untuk membandingkan production dengan salinan RESTORE: pg_dump/restore menampilkan ulang teks CHECK ... ANY (ARRAY[...]) secara berbeda (tanpa perubahan makna), jadi untuk constraint CHECK hanya nama yang dibandingkan.
# Definisi CHECK tetap diperiksa PENUH: salinan sebelum vs sesudah migrasi (rendering sama), dan production sebelum vs sesudah (SKEMA_PRA).
NORM_GANTI="case when contype='c' then 'CHECK' else pg_get_constraintdef(oid) end"; SKEMA_NORM_SQL="${SKEMA_SQL/pg_get_constraintdef(oid)/${NORM_GANTI}}"
[ "$SKEMA_NORM_SQL" != "$SKEMA_SQL" ] || die "[skrip] sidik jari normal tidak terbentuk"
SKEMA_NORM_PRA="$(psql_live -At -c "$SKEMA_NORM_SQL")"; [ -n "$SKEMA_NORM_PRA" ] || die "sidik jari skema (normal) produksi kosong"
FUNC_PRA="$(psql_live -At -c "$FUNC_SQL")"; [[ "$FUNC_PRA" =~ ^[0-9a-f]{32}$ ]] || die "sidik jari fungsi tidak terbaca"
STR_PRA="$(psql_live -At -c "$STRUKTUR_SQL")"
{ [ "$STR_PRA" = "0|0|0|1" ] && [ "$KEADAAN" = "SEGAR" ]; } || { [ "$STR_PRA" = "4|3|2|2" ] && [ "$KEADAAN" = "LANJUT" ]; } || die "struktur production (${STR_PRA}) tidak cocok dengan keadaan ${KEADAAN} (SEGAR=0|0|0|1, LANJUT=4|3|2|2)"
ok "sidik jari skema tabel LAMA ${SKEMA_PRA:0:12}…; fungsi lama ${FUNC_PRA:0:12}… (keduanya HARUS identik setelah migrasi); struktur ${STR_PRA}"
KOREKSI_N="$(psql_live -At -c "select count(*) from warehouse_corrections")"; SM_N="$(psql_live -At -c "select count(*) from stock_movements")"; GR_N="$(psql_live -At -c "select count(*) from goods_receipts")"
[[ "$KOREKSI_N" =~ ^[0-9]+$ ]] && [[ "$SM_N" =~ ^[0-9]+$ ]] && [[ "$GR_N" =~ ^[0-9]+$ ]] || die "audit awal bukan angka"
USUL_N="$(psql_live -At -c "select count(*) from material_proposals")"; SEM_N="$(psql_live -At -c "select count(*) from unit_provisional_usages")"
[[ "$USUL_N" =~ ^[0-9]+$ ]] && [[ "$SEM_N" =~ ^[0-9]+$ ]] || die "audit usulan/sementara bukan angka"
ok "keadaan: koreksi=${KOREKSI_N}, pergerakan stok=${SM_N}, penerimaan=${GR_N}, usulan bahan=${USUL_N}, pemakaian sementara=${SEM_N} (rilis ini tidak mengubah satu pun)"
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
union all select 'pengeluaran_material', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from material_issues x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'pengeluaran_material_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from material_issue_lines x where x.material_issue_id in (select id from material_issues where created_at < '$T0'::timestamp and updated_at < '$T0'::timestamp)
union all select 'transfer_stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_transfers x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'transfer_stok_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_transfer_lines x where x.stock_transfer_id in (select id from stock_transfers where created_at < '$T0'::timestamp and updated_at < '$T0'::timestamp)
union all select 'opname', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_counts x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'opname_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_count_lines x where x.stock_count_id in (select id from stock_counts where created_at < '$T0'::timestamp and updated_at < '$T0'::timestamp)
union all select 'restok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from replenishment_requests x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'barang_rusak', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from damaged_stock_records x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'retur', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from return_records x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'penyesuaian', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'origin_type' - 'origin_id')::text, '|' order by x.id),'')) from stock_adjustment_requests x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'reservasi_produksi_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from material_reservations_v2 x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'reservasi_v1_per_bahan', count(*), md5(coalesce(string_agg(r.material_id::text || ':' || r.q::text, '|' order by r.material_id),'')) from (select l.material_id, sum(l.requested_qty) q from material_issue_lines l join material_issues i on i.id = l.material_issue_id where i.created_at < '$T0'::timestamp and i.updated_at < '$T0'::timestamp and i.production_plan_id is null and i.status::text in ('APPROVED','READY_TO_PICK','PICKED') group by l.material_id) r
union all select 'valuasi_pergerakan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_stock_movement_valuations x where x.valued_at < '$T0'::timestamp
union all select 'usulan_bahan_id', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from material_proposals x where x.requested_at < '$T0'::timestamp
union all select 'pemakaian_sementara_id', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from unit_provisional_usages x where x.recorded_at < '$T0'::timestamp
union all select 'event_aktivitas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from activity_events x where x.created_at < '$T0'::timestamp
FPBEKU
)"
FPB_N=30
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

# pasca_cek <fungsi-psql> <sidik-jari-skema-lama-yang-diharapkan>: pemeriksaan DB sesudah migrasi (= keadaan baseline + 1). DIPAKAI SAMA oleh rehearsal (salinan restore) dan fase 8 (production sesudah switch) — satu kode, bukan dua salinan yang bisa berbeda.
# Mengembalikan 0 bila lulus; 1 bila gagal dengan alasan di PASCA_GALAT. Bandingkan jumlah migrasi dengan baseline + 1 (BUKAN baseline: rilis prasyarat sebelumnya berhenti di fase 8 karena membandingkan dengan baseline setelah migrasi diterapkan).
PASCA_GALAT=""
pasca_cek() {
  local Q="$1" skema_harap="$2" n
  n="$($Q "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$n" = "$(( LIVE_MIG_JUMLAH + 1 ))" ] || { PASCA_GALAT="jumlah migrasi terpasang ${n} != baseline + 1 ($(( LIVE_MIG_JUMLAH + 1 )))"; return 1; }
  n="$($Q "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")"; [ "$n" = "0" ] || { PASCA_GALAT="ada ${n} migrasi menggantung"; return 1; }
  n="$($Q "select checksum from _prisma_migrations where migration_name='${MIG_NAME}'")"; [ "$n" = "$RAW_SHA" ] || { PASCA_GALAT="checksum ${MIG_NAME} tidak cocok berkas kandidat"; return 1; }
  n="$($Q "$FUNC_SQL")"; [ "$n" = "$FUNC_PRA" ] || { PASCA_GALAT="fungsi lama berubah"; return 1; }
  n="$($Q "$SKEMA_SQL")"; [ "$n" = "$skema_harap" ] || { PASCA_GALAT="skema tabel lama berubah"; return 1; } # production: SKEMA_PRA (DB yang sama); salinan restore: SKEMA_REH_PRE (salinan itu sebelum migrasi — teks CHECK hasil restore dirender berbeda dari production)
  n="$($Q "$STRUKTUR_SQL")"; [ "$n" = "4|3|2|2" ] || { PASCA_GALAT="struktur baru ${n} bukan 4|3|2|2"; return 1; }
  PASCA_GALAT=""; return 0
}
# rehearsal_migrasi <image>: restore backup NYATA ke DB sementara → sidik jari identik → MIGRASI rilis pada salinan (image yang diuji) → skema/data lama identik, hanya 4 tabel baru + 5 pernyataan terdaftar berubah → uji aplikasi pada salinan → DB sementara DIHAPUS (production tidak tersentuh).
rehearsal_migrasi() {
  local IMG="$1"
  PHASE="5b-rehearsal-migrasi"; say "5b. Restore backup NYATA ke DB sementara, MIGRASI rilis pada salinan, uji aplikasi pada data nyata, sidik jari sebelum/sesudah, DB sementara dihapus (production tidak disentuh)"
  REH_DB="rehearsal_rkp_${TS}"
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
  reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; }
  RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
  set +e; gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1; RESTORE_RC=$?; set -e
  RESTORE_ERR="$(grep -ciE 'ERROR:|FATAL|PANIC' "$BK_DIR/restore-rehearsal.log" || true)"; RESTORE_WARN="$(grep -ciE 'WARNING' "$BK_DIR/restore-rehearsal.log" || true)"
  [ "$RESTORE_RC" = "0" ] && [ "${RESTORE_ERR:-0}" = "0" ] || { grep -iE 'ERROR:|FATAL|PANIC' "$BK_DIR/restore-rehearsal.log" | LC_ALL=C sort | uniq -c | head -n 10 | sed 's/^/        /'; reh_drop; die "restore ke DB sementara TIDAK bersih (exit=${RESTORE_RC}, error=${RESTORE_ERR})"; }
  ok "restore bersih: exit=0, error=0, warning=${RESTORE_WARN:-0}"
  RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
  cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi"; }
  [ "$(RPSQL "$SKEMA_NORM_SQL")" = "$SKEMA_NORM_PRA" ] || { reh_drop; die "skema hasil RESTORE berbeda dari skema produksi"; }
  SKEMA_REH_PRE="$(RPSQL "$SKEMA_SQL")"; [ -n "$SKEMA_REH_PRE" ] || { reh_drop; die "sidik jari skema salinan (sebelum migrasi) kosong"; }
  [ "$(RPSQL "$FUNC_SQL")" = "$FUNC_PRA" ] || { reh_drop; die "fungsi hasil RESTORE berbeda dari produksi"; }
  [ "$(RPSQL "$STRUKTUR_SQL")" = "0|0|0|1" ] || { reh_drop; die "salinan RESTORE sudah memuat objek rilis ini (bukan keadaan sebelum migrasi)"; }
  if pasca_cek RPSQL "$SKEMA_REH_PRE"; then reh_drop; die "pemeriksaan pasca-switch LOLOS pada salinan SEBELUM migrasi (tidak membedakan keadaan baseline vs baseline + 1)"; fi
  ok "uji negatif pemeriksaan pasca-switch: pada keadaan baseline (${LIVE_MIG_JUMLAH} migrasi) DITOLAK — ${PASCA_GALAT}"
  mkdir -p "$BK_DIR/rb/scripts"; for sk in rollback-guard-rekon-pemakaian.sh rollback-rekon-pemakaian.sh; do sg show "${DEPLOY_SHA}:scripts/$sk" | tr -d '\r' > "$BK_DIR/rb/scripts/$sk" || { reh_drop; die "skrip rollback $sk tidak ada di kandidat"; }; done
  PGC_ID="$(dcp "$PREV_DIR" ps -q postgres </dev/null)"; [ -n "$PGC_ID" ] || { reh_drop; die "container postgres tidak terbaca"; }
  # sidik jari SELURUH salinan (semua tabel, termasuk 4 tabel baru) — dipakai membuktikan guard/pemanggil tidak mengubah data
  fp_penuh() { local t q="" ex; while IFS= read -r t; do [ -n "$t" ] || continue; ex="to_jsonb(x)"; q="${q:+${q} union all }select '${t}', count(*), md5(coalesce(string_agg(md5(${ex}::text), '' order by md5(${ex}::text)),'')) from \"${t}\" x"; done < <(RPSQL "select tablename from pg_tables where schemaname='public' order by 1"); RPSQL "$q" | LC_ALL=C sort | md5sum | cut -d' ' -f1; }
  # guard_reh <exit-diharapkan>: guard dijalankan pada salinan; exit HARUS persis yang diharapkan DAN seluruh salinan tidak berubah. Exit selain 0 = penolakan (diuji sebagai penolakan yang benar).
  guard_reh() { local harap="$1" out rc f0 f1; f0="$(fp_penuh)"; set +e; out="$(GUARD_PSQL="docker exec -i ${PGC_ID} psql -U ${DB_USER} -d ${REH_DB}" bash "$BK_DIR/rb/scripts/rollback-guard-rekon-pemakaian.sh" 2>&1)"; rc=$?; set -e; printf '%s\n' "$out" | sed 's/^/        /'; [ "$rc" = "$harap" ] || { reh_drop; die "guard rollback: exit ${rc}, diharapkan ${harap}"; }; f1="$(fp_penuh)"; [ "$f0" = "$f1" ] || { reh_drop; die "guard MENGUBAH data: sidik jari seluruh salinan berbeda sebelum vs sesudah"; }; GUARD_FP="${f0:0:12}"; }
  # caller_reh <exit-diharapkan>: pemanggil resmi (rencana saja) — exit 0 hanya bila guard 0; selain itu HARUS 30 (ditolak) tanpa menjalankan apa pun.
  caller_reh() { local harap="$1" out rc; set +e; out="$(GUARD_PSQL="docker exec -i ${PGC_ID} psql -U ${DB_USER} -d ${REH_DB}" bash "$BK_DIR/rb/scripts/rollback-rekon-pemakaian.sh" "$PREV_DIR" "$IMG_NAME" 2>&1)"; rc=$?; set -e; printf '%s\n' "$out" | tail -n 3 | sed 's/^/        /'; [ "$rc" = "$harap" ] || { reh_drop; die "pemanggil rollback: exit ${rc}, diharapkan ${harap}"; }; }
  TABEL_LAMA="$(RPSQL "select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1")"
  [ "$(printf '%s\n' "$TABEL_LAMA" | grep -c .)" -ge 100 ] || { reh_drop; die "jumlah tabel di restore mencurigakan"; }
  FP_ALL=""
  while IFS= read -r t; do [ -n "$t" ] || continue; EX="to_jsonb(x)"; [ "$t" = "stock_adjustment_requests" ] && EX="(to_jsonb(x) - 'origin_type' - 'origin_id')"; FP_ALL="${FP_ALL:+${FP_ALL} union all }select '${t}', count(*), md5(coalesce(string_agg(md5(${EX}::text), '' order by md5(${EX}::text)),'')) from \"${t}\" x"; done <<< "$TABEL_LAMA"
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sebelum.txt" || { reh_drop; die "sidik jari penuh sebelum gagal"; }
  REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
  [ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
  REH_NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CID_OLD")"; [ -n "$REH_NET" ] || { reh_drop; die "jaringan docker tidak terbaca"; }
  local URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
  # MIGRASI pada salinan, dengan IMAGE yang diuji
  docker run --rm --network "$REH_NET" -e DATABASE_URL="$URL" -e JWT_SECRET=rehearsal-tidak-dipakai "$IMG" npx prisma migrate deploy > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy pada salinan GAGAL"; }
  grep -q "${MIG_NAME}" "$BK_DIR/migrate-rehearsal.log" || { reh_drop; die "migrate deploy pada salinan tidak menerapkan ${MIG_NAME}"; }
  [ "$(RPSQL "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( LIVE_MIG_JUMLAH + 1 ))" ] || { reh_drop; die "jumlah migrasi pada salinan != baseline + 1"; }
  [ "$(RPSQL "select checksum from _prisma_migrations where migration_name='${MIG_NAME}'")" = "$RAW_SHA" ] || { reh_drop; die "checksum migrasi pada salinan BERBEDA dari berkas kandidat"; }
  [ "$(RPSQL "$SKEMA_SQL")" = "$SKEMA_REH_PRE" ] || { reh_drop; die "migrasi MENGUBAH skema tabel LAMA di luar 5 pernyataan yang diaudit"; }
  FUNC_REH="$(RPSQL "$FUNC_SQL")"; [[ "$FUNC_REH" =~ ^[0-9a-f]{32}$ ]] && [ "$FUNC_REH" = "$FUNC_PRA" ] || { reh_drop; die "fungsi LAMA berubah setelah migrasi (tidak boleh)"; }
  [ "$(RPSQL "$STRUKTUR_SQL")" = "4|3|2|2" ] || { reh_drop; die "struktur baru pada salinan bukan 4 tabel|3 trigger|2 kolom|2 constraint"; }
  [ "$(RPSQL "$BARU_KOSONG_SQL")" = "0" ] || { reh_drop; die "tabel/kolom baru TIDAK kosong setelah migrasi (migrasi tidak boleh menulis data)"; }
  [ "$(RPSQL "select pg_get_constraintdef(oid) from pg_constraint where conname='warehouse_corrections_jenis_chk'" | grep -c "UNIT_USAGE")" = "1" ] || { reh_drop; die "pagar jenis koreksi Gudang tidak memuat UNIT_USAGE"; }
  docker run --rm --network "$REH_NET" -e DATABASE_URL="$URL" -e JWT_SECRET=rehearsal-tidak-dipakai "$IMG" npx prisma migrate diff --from-url "$URL" --to-schema-datamodel prisma/schema.prisma --script > "$BK_DIR/schema-diff-rehearsal.sql" 2> "$BK_DIR/schema-diff-rehearsal.err" || true
  [ -s "$BK_DIR/schema-diff-rehearsal.sql" ] || [ ! -s "$BK_DIR/schema-diff-rehearsal.err" ] || { cat "$BK_DIR/schema-diff-rehearsal.err" | head -n 8; reh_drop; die "prisma migrate diff gagal pada salinan"; }
  if grep -qE 'usage_import_batches|unit_usage_note|fin_stock_movement_valuation_corrections|origin_type|origin_id|warehouse_corrections_jenis_chk|stock_adjustment_requests_origin_chk' "$BK_DIR/schema-diff-rehearsal.sql"; then grep -E 'usage_import_batches|unit_usage_note|fin_stock_movement_valuation_corrections|origin_type|origin_id' "$BK_DIR/schema-diff-rehearsal.sql" | head -n 8 | sed 's/^/        /'; reh_drop; die "schema.prisma kandidat tidak sama dengan skema hasil migrasi (drift pada objek rilis ini)"; fi
  ok "schema.prisma kandidat = skema hasil migrasi untuk objek rilis ini (drift lama baseline, bila ada, tidak diubah)"
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-pasca-migrasi.txt" || { reh_drop; die "sidik jari penuh pasca-migrasi gagal"; }
  cmp -s "$BK_DIR/fp-all-sebelum.txt" "$BK_DIR/fp-all-pasca-migrasi.txt" || { diff "$BK_DIR/fp-all-sebelum.txt" "$BK_DIR/fp-all-pasca-migrasi.txt" || true; reh_drop; die "migrasi MENGUBAH isi tabel (harus tidak menulis data)"; }
  ok "migrasi pada salinan: ${MIG_NAME} diterapkan (${LIVE_MIG_JUMLAH} → $(( LIVE_MIG_JUMLAH + 1 ))); skema tabel LAMA + fungsi lama IDENTIK; isi $(printf '%s\n' "$TABEL_LAMA" | grep -c .) tabel lama IDENTIK; 4 tabel baru + 3 trigger + 2 kolom + 2 constraint ada; semua KOSONG"
  pasca_cek RPSQL "$SKEMA_REH_PRE" || { reh_drop; die "pemeriksaan pasca-switch pada salinan baseline + 1 GAGAL: ${PASCA_GALAT}"; }
  ok "pemeriksaan pasca-switch (kode yang SAMA dengan fase 8) LULUS pada salinan baseline + 1 ($(( LIVE_MIG_JUMLAH + 1 )) migrasi; fungsi lama, skema lama, struktur 4|3|2|2)"
  GUARD_PSQL="docker exec -i ${PGC_ID} psql -U ${DB_USER} -d ${REH_DB}" bash "$BK_DIR/rb/scripts/rollback-guard-rekon-pemakaian.sh" --uji-baca-saja | sed 's/^/        /'; [ "${PIPESTATUS[0]}" = "0" ] || { reh_drop; die "guard tidak terbukti baca-saja"; }
  guard_reh 0; caller_reh 0; ok "guard rollback pada salinan baru dimigrasi = KOSONG (exit 0): rollback rutin BOLEH; pemanggil memberi rencana; sidik jari seluruh salinan tidak berubah ($GUARD_FP…)"
  cat > "$BK_DIR/rehearsal-kode.mjs" <<'REHNODE'
// Uji KODE BARU + migrasi "catatan pemakaian historis" pada SALINAN RESTORE backup nyata (DB sementara yang DIHAPUS skrip rilis; production tidak tersentuh).
// Dijalankan di image kandidat dengan DATABASE_URL = DB rehearsal SESUDAH migrasi diterapkan dan sidik jari tabel lama terbukti identik.
// Bagian A (baca-saja): tabel baru KOSONG, antrean posting KOSONG, kode baru memuat data nyata tanpa menulis apa pun — inilah keadaan production saat rilis.
// Bagian B (menulis HANYA pada salinan): satu impor mini + posting + koreksi pada unit/bahan NYATA dari restore, untuk membuktikan trigger/constraint/ledger pada skema nyata. Ini BUKAN impor manifest production dan BUKAN posting 384 transaksi.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
let gagal = 0; let dilewati = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 260) : "")); };
const lewati = (n, a) => { dilewati += 1; console.log(`SKIP ${n} — DILEWATI: ${a}`); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const baris = async (sql) => prisma.$queryRawUnsafe(sql);
const S = "/app/src/";
const cat = await import(S + "services/catatanPemakaianHistoris.js");
const pos = await import(S + "services/postingPemakaianHistoris.js");
const kor = await import(S + "services/koreksiPemakaian.js");
const val = await import(S + "services/finance/koreksiValuasi.js");
const jejak = await import(S + "services/finance/biayaBahan.js");
await import(S + "routes/pemakaianKoreksi.js"); // modul rute memuat tanpa galat (impor + dependensi)
const TABEL_BARU = ["usage_import_batches", "unit_usage_notes", "unit_usage_note_events", "fin_stock_movement_valuation_corrections"];
const inti = async () => ({ sm: await hitung("select count(*)::int n from stock_movements"), mi: await hitung("select count(*)::int n from material_issues"), jur: await hitung("select count(*)::int n from fin_journal_entries"), val: await hitung("select count(*)::int n from fin_stock_movement_valuations"), mat: await hitung("select count(*)::int n from materials"), unit: await hitung("select count(*)::int n from units"), koreksi: await hitung("select count(*)::int n from warehouse_corrections") });

// FASE "selesaikan": hanya menolak koreksi pemakaian yang menunggu (dibiarkan terbuka oleh uji utama untuk menguji guard rollback), lalu selesai.
if (process.env.REH_FASE === "selesaikan") {
  const pend = await prisma.warehouseCorrection.findMany({ where: { docType: "UNIT_USAGE", status: "PENDING_APPROVAL" }, select: { id: true } });
  const penolak = (await baris("select id::text id, name from \"User\" where active order by \"createdAt\" offset 1 limit 1"))[0];
  for (const k of pend) await kor.tolakKoreksiPemakaian(prisma, { koreksiId: k.id, aktor: penolak, catatan: "Rehearsal: menyelesaikan koreksi menunggu agar guard rollback diuji pada keadaan ADA DATA" });
  cek(`koreksi menunggu diselesaikan (ditolak): ${pend.length}`, pend.length >= 1 && await hitung("select count(*)::int n from warehouse_corrections where doc_type = 'UNIT_USAGE' and status = 'PENDING_APPROVAL'") === 0);
  await prisma.$disconnect(); console.log("REHEARSAL_KODE_BARU gagal=" + gagal + " skip=" + dilewati); process.exit(gagal ? 1 : 0);
}
let guardHarap = 10; // setelah jalur tulis ada data → guard exit 10; bila koreksi dibiarkan menunggu → 20

// ───────── A. keadaan saat rilis (baca-saja) ─────────
const mig = await baris("select migration_name from _prisma_migrations where migration_name like '%catatan_pemakaian_historis' and finished_at is not null and rolled_back_at is null");
cek("migrasi catatan_pemakaian_historis tercatat selesai pada salinan", mig.length === 1, mig.map((m) => m.migration_name).join());
for (const t of TABEL_BARU) cek(`tabel baru ${t} ada dan KOSONG`, await hitung(`select count(*)::int n from ${t}`) === 0);
cek("kolom origin_type/origin_id di penyesuaian stok ada dan NULL di semua baris lama", await hitung("select count(*)::int n from stock_adjustment_requests where origin_type is not null or origin_id is not null") === 0 && await hitung("select count(*)::int n from information_schema.columns where table_name='stock_adjustment_requests' and column_name in ('origin_type','origin_id')") === 2);
const defJenis = (await baris("select pg_get_constraintdef(oid) d from pg_constraint where conname='warehouse_corrections_jenis_chk'"))[0]?.d ?? "";
cek("pagar jenis koreksi Gudang kini memuat GOODS_RECEIPT dan UNIT_USAGE (tetap dua jenis, kind/status tak berubah)", /GOODS_RECEIPT/.test(defJenis) && /UNIT_USAGE/.test(defJenis) && /PENDING_APPROVAL/.test(defJenis), defJenis);
cek("semua koreksi Gudang lama tetap sah (tidak ada baris yang melanggar pagar)", await hitung("select count(*)::int n from warehouse_corrections where doc_type not in ('GOODS_RECEIPT','UNIT_USAGE')") === 0);
const trig = await baris("select tgname from pg_trigger where not tgisinternal and tgname in ('unit_usage_notes_guard_trg','unit_usage_note_events_guard_trg','fin_smv_corr_append_only_trg') order by 1");
cek("3 trigger penjaga terpasang pada tabel baru", trig.length === 3, trig.map((t) => t.tgname).join());
const e0 = await inti();
const r0 = await pos.rencanakanPosting(prisma);
cek("ANTREAN POSTING KOSONG pada salinan data nyata (tidak ada catatan siap-posting; tidak ada 384 transaksi)", r0.jumlah === 0 && r0.orderUnik === 0, `jumlah=${r0.jumlah}`);
const ev0 = await cat.evaluasiUlang(prisma, { actorId: null });
cek("evaluasi ulang pada antrean kosong = nol perubahan", ev0.berubah === 0, JSON.stringify(ev0).slice(0, 120));
const unitContoh = (await baris("select u.id::text id, u.unit_code from units u where exists (select 1 from stock_movements s where s.unit_id = u.id and s.type = 'ISSUE') order by u.unit_code limit 1"))[0];
if (unitContoh) { const ch = await cat.ambilCatatanHistoris(prisma, unitContoh.id); cek("unit nyata ber-ISSUE: catatan historis kosong (tidak ada yang muncul sendiri)", ch.ringkas.total === 0, `${unitContoh.unit_code}`); const hj = await jejak.bacaJejakUnit(prisma, unitContoh.id, { izinHarga: true }); cek("jejak biaya unit nyata terbaca (kode baru + data lama)", !!hj && Array.isArray(hj.belumFinal ?? []), `gap=${hj?.belumFinal?.length}`); } else lewati("catatan historis unit nyata", "tidak ada unit ber-ISSUE pada restore");
const e1 = await inti(); cek("bagian A tidak menulis apa pun (pergerakan, Material Issue, jurnal, valuasi, bahan, unit, koreksi tetap)", JSON.stringify(e1) === JSON.stringify(e0), JSON.stringify(e1));
cek("tabel baru tetap kosong setelah semua pemeriksaan bagian A", (await Promise.all(TABEL_BARU.map((t) => hitung(`select count(*)::int n from ${t}`)))).every((n) => n === 0));

// ───────── B. jalur tulis pada SALINAN (impor mini → posting → koreksi → koreksi harga) ─────────
const u = (await baris(`select u.id::text id, u.unit_code, o."orderNumber" order_number from units u join "Order" o on o.id = u.order_id where o."orderNumber" ~ '^(RES|NEW)-[0-9]{8}-[0-9]+$' and u.status <> 'CANCELLED' and not exists (select 1 from stock_movements s where s.unit_id = u.id) and (select count(*) from units x where x.order_id = o.id) = 1 order by o."createdAt" desc limit 1`))[0];
const m = (await baris(`select m.id::text id, m.code, m.name, m.unit::text unit from materials m where m.active and (m.kind is null or m.kind <> 'PERLENGKAPAN_STOK') and (select count(*) from materials y where upper(y.name) = upper(m.name)) = 1 and (select coalesce(sum(qty),0) from stock_movements s where s.material_id = m.id) >= 10 and exists (select 1 from stock_movements s where s.material_id = m.id and s.qty > 0 and s.created_at < '2026-10-01') and m.name !~ '[",]' order by m.code limit 1`))[0];
const pelaku = await baris("select id::text id, name from \"User\" where active order by \"createdAt\" limit 2");
if (!u || !m || pelaku.length < 2) { lewati("jalur tulis pada salinan", `butuh unit tanpa pergerakan, bahan bersaldo, dan 2 pengguna aktif (unit=${!!u} bahan=${!!m} pengguna=${pelaku.length})`); }
else {
  const A = pelaku[0]; const O = pelaku[1]; const NL = String.fromCharCode(10);
  const HDR = ["No", "No. Resi / Order", "Tgl Selesai", "Bulan Selesai", "Nama Pelanggan", "Nama Sales", "Ukuran Kasur", "Jenis Layanan", "Tgl Komplain", "PIC Komplain", "PIC / Teknisi", "CORNER", "Kategori Bahan", "Nama Material / Bahan (SANO)", "Spesifikasi / Detail", "Barang", "Qty Pakai", "Satuan", "Harga Satuan (Rp)", "Total Biaya Bahan (Rp)", `"Total Penjualan${NL}(Rp)"`, "Insentif PIC", "Insentif Corner", "Keterangan / QC"].join(",");
  const QTY = "2,0";
  const csv = ["JURNAL RINCIAN REHEARSAL", "Data", HDR, `1,${u.order_number},5 Okt 26,OKT,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,Lain-lain,${m.name},,BAHAN,"${QTY}",${m.unit},,,,,,QC OK`].join(NL);
  const ledgerLama = await hitung("select count(*)::int n from stock_movements where type = 'ISSUE' and unit_id is not null");
  const saldo = async () => Number((await baris(`select coalesce(sum(qty),0)::float n from stock_movements where material_id = '${m.id}'`))[0].n);
  const s0 = await saldo(); const sm0 = await hitung("select count(*)::int n from stock_movements"); const jur0 = await hitung("select count(*)::int n from fin_journal_entries"); const status0 = (await prisma.unit.findUnique({ where: { id: u.id }, select: { status: true } })).status;
  const rn = await cat.rencanakanImpor(prisma, { csvText: csv, namaBerkas: "rehearsal-mini.csv" });
  const ap = await cat.terapkanImpor(prisma, rn, { actorId: A.id });
  cek("impor mini (1 baris, unit nyata) membuat 1 catatan Excel + catatan LEDGER hanya untuk ISSUE lama; TANPA pergerakan baru", ap.batchBaru === true && await hitung("select count(*)::int n from unit_usage_notes where origin = 'EXCEL'") === 1 && await hitung("select count(*)::int n from unit_usage_notes where origin = 'LEDGER'") === ledgerLama && await hitung("select count(*)::int n from stock_movements") === sm0, `ledger=${ledgerLama}`);
  const ulang = await cat.terapkanImpor(prisma, await cat.rencanakanImpor(prisma, { csvText: csv, namaBerkas: "rehearsal-mini.csv" }), { actorId: A.id });
  cek("impor ulang berkas yang sama = nol perubahan (idempoten)", ulang.batchBaru === false && ulang.dibuat === 0);
  const n = await prisma.unitUsageNote.findFirst({ where: { origin: "EXCEL" } });
  cek("nilai asli berkas tersimpan apa adanya (raw_qty '2,0')", n.rawQty === QTY && n.rawUom === m.unit);
  let tolak = null; try { await prisma.$executeRawUnsafe(`update unit_usage_notes set raw_qty = '9' where id = '${n.id}'`); } catch (e) { tolak = String(e.message); }
  cek("trigger menolak mengubah nilai asli lewat SQL langsung", /tidak boleh diubah/.test(tolak ?? ""), tolak?.slice(0, 80));
  if (n.state !== "SIAP_POSTING") lewati("posting satu transaksi pada salinan", `catatan contoh berstatus ${n.state} (${(n.flags ?? []).map((f) => f.kode).join(",")}) — bukan SIAP_POSTING pada data restore ini`);
  else {
    const rp = await pos.rencanakanPosting(prisma, { unitIds: [u.id] });
    cek("rencana posting memuat tepat 1 transaksi untuk unit contoh", rp.jumlah === 1, `jumlah=${rp.jumlah}`);
    let tanpaPersetujuan = null; try { await pos.jalankanPosting(prisma, { persetujuan: { hashDisetujui: "salah", rujukan: "x", disetujuiOleh: "x" }, aktor: A, unitIds: [u.id] }); } catch (e) { tanpaPersetujuan = e.code ?? e.message; }
    cek("posting TANPA hash persetujuan yang benar ditolak (gerbang persetujuan)", !!tanpaPersetujuan, tanpaPersetujuan);
    const h = await pos.jalankanPosting(prisma, { persetujuan: { hashDisetujui: rp.hash, rujukan: "REHEARSAL-SALINAN", disetujuiOleh: "Rehearsal (salinan)" }, aktor: A, unitIds: [u.id] });
    const mv = await prisma.stockMovement.findFirst({ where: { unitId: u.id, materialId: m.id, type: "ISSUE" } });
    cek("posting: 1 ISSUE bertaut unit+bahan, tanggal HISTORIS (5 Okt WIB), pelaku terisi, saldo turun tepat 2,0", !!mv && Number(mv.qty) === -2 && mv.createdById === A.id && new Date(mv.createdAt).toISOString().startsWith("2026-10-0") && Math.abs((await saldo()) - (s0 - 2)) < 1e-6, mv ? mv.createdAt.toISOString() : "tidak ada");
    cek("posting: tidak ada jurnal HPP otomatis (jurnalHPP default MATI) dan valuasi dibekukan", await hitung(`select count(*)::int n from fin_stock_movement_valuations where movement_id = '${mv.id}'`) === 1 && await hitung("select count(*)::int n from fin_journal_entries") === jur0);
    const ulangPos = await pos.jalankanPosting(prisma, { persetujuan: { hashDisetujui: (await pos.rencanakanPosting(prisma, { unitIds: [u.id] })).hash, rujukan: "REHEARSAL-SALINAN", disetujuiOleh: "Rehearsal (salinan)" }, aktor: A, unitIds: [u.id] });
    cek("posting ulang = nol transaksi baru (idempoten)", (await hitung(`select count(*)::int n from stock_movements where unit_id = '${u.id}' and material_id = '${m.id}' and type = 'ISSUE'`)) === 1, JSON.stringify(ulangPos).slice(0, 100));
    const k = await kor.ajukanKoreksiPemakaian(prisma, { unitId: u.id, materialId: m.id, qtyBaru: 1.25, alasan: "Rehearsal: Excel terverifikasi 1,25", kunci: "rehearsal-kor-0001", aktor: A });
    let sendiri = null; try { await kor.setujuiKoreksiPemakaian(prisma, { koreksiId: k.id, aktor: A }); } catch (e) { sendiri = e.code ?? e.message; }
    cek("pemohon tidak bisa menyetujui koreksinya sendiri (pemisahan tugas)", !!sendiri, sendiri);
    const ok = await kor.setujuiKoreksiPemakaian(prisma, { koreksiId: k.id, aktor: O });
    const pembalik = await prisma.stockMovement.findUnique({ where: { id: ok.hasil.pergerakanId } });
    cek("koreksi disetujui orang lain: pergerakan pembalik bertaut ke pemakaian asal; saldo = awal − 1,25; asal tidak diubah", pembalik.correctsMovementId === mv.id && Math.abs((await saldo()) - (s0 - 1.25)) < 1e-6 && Number((await prisma.stockMovement.findUnique({ where: { id: mv.id } })).qty) === -2, `selisih=${ok.hasil.selisih}`);
    const kv = await val.koreksiValuasiPergerakan(prisma, { movementId: ok.hasil.pergerakanId, hargaBaru: 1000, alasan: "Rehearsal: harga manual (bukan tebakan production)", kunci: "rehearsal-val-0001", aktor: O });
    cek("koreksi harga memakai tabel terpisah; valuasi asli tidak diubah; tanpa jurnal otomatis", !!kv.koreksi && await hitung("select count(*)::int n from fin_stock_movement_valuation_corrections") === 1);
    let ubahKoreksi = null; try { await prisma.$executeRawUnsafe("update fin_stock_movement_valuation_corrections set reason = 'x'"); } catch (e) { ubahKoreksi = String(e.message); }
    cek("tabel koreksi harga append-only (UPDATE ditolak)", /append-only/.test(ubahKoreksi ?? ""));
    const k2 = await kor.ajukanKoreksiPemakaian(prisma, { unitId: u.id, materialId: m.id, qtyBaru: 1.0, alasan: "Rehearsal: koreksi dibiarkan menunggu untuk menguji guard rollback", kunci: "rehearsal-kor-0002", aktor: A });
    cek("koreksi pemakaian kedua dibiarkan MENUNGGU (uji guard rollback keadaan TERBUKA)", !!k2.id); guardHarap = 20;
    const neg = await hitung("select count(*)::int n from (select material_id from stock_movements group by material_id having sum(qty) < 0) x");
    const negAwal = await hitung(`select count(*)::int n from (select material_id from stock_movements where material_id <> '${m.id}' group by material_id having sum(qty) < 0) x`);
    cek("bahan contoh tidak menjadi minus akibat posting/koreksi", (await saldo()) >= 0, `bahan minus total=${neg}, selain contoh=${negAwal} (sudah ada sebelum rehearsal)`);
    const unitSesudah = await prisma.unit.findUnique({ where: { id: u.id }, select: { status: true } }); cek("status unit tidak berubah oleh posting/koreksi", unitSesudah.status === status0, `${status0} → ${unitSesudah.status}`);
  }
}
await prisma.$disconnect();
console.log("GUARD_HARAP=" + guardHarap);
console.log("REHEARSAL_KODE_BARU gagal=" + gagal + " skip=" + dilewati);
process.exit(gagal ? 1 : 0);
REHNODE
  docker run --rm -i --network "$REH_NET" -e DATABASE_URL="$URL" -e JWT_SECRET=rehearsal-tidak-dipakai "$IMG" node --input-type=module - < "$BK_DIR/rehearsal-kode.mjs" > "$BK_DIR/rehearsal-kode-baru.log" 2>&1 || { cat "$BK_DIR/rehearsal-kode-baru.log"; reh_drop; die "uji aplikasi pada salinan restore GAGAL"; }
  ok "uji aplikasi pada salinan (kode BARU, data produksi nyata): $(grep 'REHEARSAL_KODE_BARU' "$BK_DIR/rehearsal-kode-baru.log" | tail -n 1); $(grep -c '^PASS' "$BK_DIR/rehearsal-kode-baru.log") pemeriksaan lulus"
  GUARD_HARAP="$(sed -n 's/^GUARD_HARAP=//p' "$BK_DIR/rehearsal-kode-baru.log" | tail -n 1)"; [[ "$GUARD_HARAP" =~ ^(10|20)$ ]] || { reh_drop; die "uji aplikasi tidak melaporkan keadaan guard yang diharapkan"; }
  guard_reh "$GUARD_HARAP"; caller_reh 30; ok "guard rollback sesudah jalur tulis pada salinan: exit $GUARD_HARAP — rollback rutin DITOLAK ($([ "$GUARD_HARAP" = 20 ] && echo 'ada catatan/posting + koreksi menunggu' || echo 'ada catatan/posting')); pemanggil menolak (exit 30); sidik jari salinan tidak berubah ($GUARD_FP…)"
  if [ "$GUARD_HARAP" = "20" ]; then
    docker run --rm -i --network "$REH_NET" -e REH_FASE=selesaikan -e DATABASE_URL="$URL" -e JWT_SECRET=rehearsal-tidak-dipakai "$IMG" node --input-type=module - < "$BK_DIR/rehearsal-kode.mjs" > "$BK_DIR/rehearsal-selesaikan.log" 2>&1 || { cat "$BK_DIR/rehearsal-selesaikan.log"; reh_drop; die "menyelesaikan koreksi menunggu pada salinan GAGAL"; }
    guard_reh 10; caller_reh 30; ok "guard rollback sesudah koreksi menunggu diselesaikan: exit 10 — tetap DITOLAK karena ada catatan/posting (kode lama akan menyembunyikannya); pemanggil menolak (exit 30); sidik jari salinan tidak berubah ($GUARD_FP…)"
  fi
  reh_drop
  [ "$(psql_live -At -c "select count(*) from pg_database where datname = '${REH_DB}'")" = "0" ] || die "DB rehearsal masih tersisa"
  ok "DB sementara dihapus; uji tulis dilakukan HANYA pada salinan"
}
WS=""
cleanup_ws() { if [ -n "${WS:-}" ] && [[ "$WS" == "$HOME/release-rehearsal/rkp-"* ]]; then rm -rf -- "$WS" 2>/dev/null || sudo -n rm -rf -- "$WS" 2>/dev/null || true; fi; }
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; cleanup_ws; exit $rc' EXIT
MARK="$HOME/release-backups/.rehearsal-penuh-ok-rekon-pemakaian-${DEPLOY_SHA}"
if [ "$REHEARSAL_ONLY" = "1" ]; then
  PHASE="3-backup-rehearsal"; say "R1. Backup produksi NYATA + checksum (untuk rehearsal)"
  BACKUP_FILE="$HOME/backups/pre-rkp-${DEPLOY_SHORT}-${TS}-rehearsal.sql.gz"
  dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
  gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
  gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
  mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"; ( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
  ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"
  PHASE="4-build-web-rehearsal"; say "R2. Build web FINAL di ruang kerja sementara (dist production TIDAK disentuh; ruang kerja dihapus setelahnya)"
  WS="$HOME/release-rehearsal/rkp-${DEPLOY_SHORT}-${TS}"; mkdir -p "$WS" || die "gagal membuat ${WS}"
  [ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
  sg archive "$DEPLOY_SHA" frontend | tar -x -C "$WS" --exclude='frontend/dist' || die "git archive frontend gagal"
  cp -a "$NM_SRC" "$WS/frontend/node_modules" || die "gagal menyalin node_modules frontend"
  install -m 600 "$PERSIST/frontend/.env" "$WS/frontend/.env" || die "gagal menyalin frontend/.env"
  ( cd "$WS/frontend" && npm run build ) > "$BK_DIR/build-frontend-rehearsal.log" 2>&1 || { rm -f "$WS/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend-rehearsal.log"; die "build web gagal (production tidak berubah)"; }
  rm -f "$WS/frontend/.env"
  RH_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$WS/frontend/dist/index.html" | sed -n 1p)"; [ -n "$RH_INDEX" ] && [ -f "$WS/frontend/dist/assets/$RH_INDEX" ] || die "hasil build web tidak valid"
  MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
  [ -n "$(grep -lF "$MAPS_KEY" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
  for s1 in "Catatan pemakaian historis" "Koreksi pemakaian menunggu persetujuan" "Setujui & terapkan" "Saldo yang benar" "HPP bahan PARSIAL" "Ajukan koreksi pemakaian" "Kecualikan dari perhitungan"; do [ -n "$(grep -lF "$s1" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal TIDAK memuat teks fitur rilis ini: ${s1}"; done
  for s2 in "Bahan belum ada di katalog" "Catat sementara — stok belum diketahui" "Yang saya pakai bukan bahan ini" "Simpan pemakaian lagi" "Ada yang belum selesai" "Tidak bisa dicatat sebagai bahan baru" "Perlu rekonsiliasi Gudang" "Konfirmasi & kurangi stok" "Rencana bahan (opsional, belum mengurangi stok)" "Usulkan ke Gudang" "Beranda Gudang" "Selesaikan Produksi" "Tetapkan Siap Kirim" "Pembalik beban bersih" "Dibatalkan — tidak ditagih"; do
    [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
    [ -n "$(grep -lF "$s2" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal KEHILANGAN teks fitur lama: ${s2}"
  done
  [ "$RH_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel rehearsal identik dengan live"
  ok "build web final: ${RH_INDEX} (live ${PREV_INDEX}); teks fitur baru ada; teks fitur live lama tetap ada; kunci peta ada"
  cleanup_ws; [ ! -e "$WS" ] || die "ruang kerja rehearsal masih ada"
  PHASE="5-image-rehearsal"; say "R3. Build image backend kandidat dengan tag rehearsal (tag production TIDAK digeser; backend yang melayani tidak disentuh)"
  RSRC="$BK_DIR/reh-src"; mkdir -p "$RSRC"; sg archive "$DEPLOY_SHA" backend | tar -x -C "$RSRC" || die "git archive backend gagal"
  REH_IMG="${IMG_NAME%%:*}:rehearsal-rkp-${DEPLOY_SHORT}"
  docker build -q -t "$REH_IMG" "$RSRC/backend" > "$BK_DIR/build-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/build-rehearsal.log"; die "build image rehearsal gagal"; }
  [ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag latest bergeser (tidak diharapkan)"
  ok "image rehearsal $(docker image inspect -f '{{.Id}}' "$REH_IMG" | cut -c8-19) dibangun; image yang melayani tetap ${PREV_IMG_ID:7:12}"
  rehearsal_migrasi "$REH_IMG"
  docker rmi "$REH_IMG" >/dev/null 2>&1 || true; rm -rf "$RSRC"
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah selama rehearsal"
  [ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag image production bergeser (tidak diharapkan)"
  [ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] && [ "$(psql_live -At -c "$FUNC_SQL")" = "$FUNC_PRA" ] && [ "$(psql_live -At -c "$STRUKTUR_SQL")" = "$STR_PRA" ] || die "skema/fungsi/struktur production berubah selama rehearsal (production TIDAK boleh tersentuh)"
  [ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$LIVE_MIG_JUMLAH" ] || die "jumlah migrasi production berubah selama rehearsal"
  psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sesudah-rehearsal.txt" || die "sidik jari beku sesudah rehearsal gagal"
  cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" || true; die "dokumen pembanding beku BERUBAH selama rehearsal"; }
  [ "$(psql_live -At -c "select count(*) from pg_database where datname like 'rehearsal_rkp_%'")" = "0" ] || die "DB rehearsal masih tersisa di server"
  ok "produksi tidak berubah selama rehearsal (container/image sama; migrasi, skema, fungsi, struktur, dan sidik jari beku identik; DB sementara, image rehearsal, dan ruang kerja dihapus)"
  printf 'BASE=%s\nDEPLOY=%s\nTS=%s\nFUNC_MD5=%s\n' "$BASE_SHA" "$DEPLOY_SHA" "$TS" "$FUNC_REH" > "$MARK"
  say "REHEARSAL PENUH SELESAI — PRODUKSI TIDAK DIUBAH (tanpa release dir, tanpa switch, tanpa migrasi production, tanpa data baru). Bukti berlaku 36 jam. Backup: ${BACKUP_FILE}. Log: ${BK_DIR}/release.log"
  trap - EXIT; exit 0
fi
# Rilis penuh: WAJIB ada bukti rehearsal-penuh untuk SHA + baseline yang sama (<36 jam)
[ -f "$MARK" ] || die "belum ada bukti --rehearsal-penuh LULUS untuk SHA ${DEPLOY_SHORT}: jalankan --rehearsal-penuh dulu"
grep -qx "BASE=${BASE_SHA}" "$MARK" && grep -qx "DEPLOY=${DEPLOY_SHA}" "$MARK" || die "bukti rehearsal-penuh bukan untuk SHA/baseline ini — ulangi terhadap baseline live saat ini"
[ -n "$(find "$MARK" -mmin -2160 2>/dev/null)" ] || die "bukti rehearsal-penuh lebih dari 36 jam — ulangi terhadap data production terbaru"
FUNC_MD5_MARK="$(sed -n 's/^FUNC_MD5=//p' "$MARK" | sed -n 1p)"; [[ "$FUNC_MD5_MARK" =~ ^[0-9a-f]{32}$ ]] || die "bukti rehearsal tidak memuat sidik jari fungsi pasca-migrasi"
ok "bukti --rehearsal-penuh LULUS untuk SHA ${DEPLOY_SHORT} + baseline ${BASE_SHA:0:8}; sidik jari fungsi lama (identik sebelum/sesudah migrasi) ${FUNC_MD5_MARK:0:12}…"


PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-rkp-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Catatan pemakaian historis" "Koreksi pemakaian menunggu persetujuan" "Setujui & terapkan" "Saldo yang benar" "HPP bahan PARSIAL" "Ajukan koreksi pemakaian" "Kecualikan dari perhitungan"; do
  [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru TIDAK memuat teks fitur rilis ini: ${s1}"
done
for s2 in "Bahan belum ada di katalog" "Catat sementara — stok belum diketahui" "Yang saya pakai bukan bahan ini" "Simpan pemakaian lagi" "Ada yang belum selesai" "Tidak bisa dicatat sebagai bahan baru" "Perlu rekonsiliasi Gudang" "Konfirmasi & kurangi stok" "Rencana bahan (opsional, belum mengurangi stok)" "Usulkan ke Gudang" "Beranda Gudang" "Selesaikan Produksi" "Tetapkan Siap Kirim" "Pembalik beban bersih" "Dibatalkan — tidak ditagih"; do
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-rkp-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama (backend berubah; tidak diharapkan)"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

rehearsal_migrasi "$NEW_IMG_ID"

PHASE="6-migrate"; say "6. Migrasi (4 tabel baru kosong + 5 pernyataan pada 2 tabel lama; image baru; backend lama tetap melayani) — keadaan ${KEADAAN}"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum migrasi"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum migrasi"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
KEADAAN2="$(keadaan_produksi "2")" || die "${KEADAAN2}"
[ "$KEADAAN2" = "$KEADAAN" ] || die "keadaan production berubah sejak preflight (${KEADAAN} → ${KEADAAN2})"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-migrasi.txt" || die "sidik jari beku pra-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH sebelum migrasi"; }
if [ "$KEADAAN" = "SEGAR" ]; then
  [ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] && [ "$(psql_live -At -c "$FUNC_SQL")" = "$FUNC_PRA" ] && [ "$(psql_live -At -c "$STRUKTUR_SQL")" = "0|0|0|1" ] || die "skema/fungsi/struktur production berubah sejak preflight"
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
else
  # LANJUT: migrasi SUDAH terpasang dan terbukti (checksum). TIDAK menjalankan migrate deploy: hanya membaca status; fungsi lama harus = hasil rehearsal dan tabel baru kosong.
  [ "$(psql_live -At -c "$FUNC_SQL")" = "$FUNC_MD5_MARK" ] && [ "$(psql_live -At -c "$BARU_KOSONG_SQL")" = "0" ] || die "keadaan LANJUT: fungsi lama production BERBEDA dari hasil rehearsal atau objek baru TIDAK kosong"
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | tee "$BK_DIR/migrate-status-lanjut.log" | grep -i 'up to date' >/dev/null || die "keadaan LANJUT: migrate status production tidak 'up to date'"
fi
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang != baseline + 1 ($(( MIG_SEBELUM + 1 )))"
[ "$(psql_live -At -c "select checksum from _prisma_migrations where migration_name='${MIG_NAME}'")" = "$RAW_SHA" ] || die "checksum ${MIG_NAME} tidak cocok berkas kandidat"
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema tabel/kolom/constraint/indeks/trigger BERUBAH oleh migrasi (jangan switch)"
[ "$(psql_live -At -c "$FUNC_SQL")" = "$FUNC_MD5_MARK" ] || die "fungsi lama production != hasil rehearsal (jangan switch)"
[ "$(psql_live -At -c "$STRUKTUR_SQL")" = "4|3|2|2" ] || die "struktur baru production bukan 4 tabel|3 trigger|2 kolom|2 constraint (jangan switch)"
[ "$(psql_live -At -c "$BARU_KOSONG_SQL")" = "0" ] || die "tabel/kolom baru TIDAK kosong sesudah migrasi (jangan switch)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah tahap migrasi"
ok "migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); skema tabel lama identik; fungsi lama = hasil rehearsal; 4 tabel baru KOSONG (${FUNC_MD5_MARK:0:12}…); backend lama tetap sehat"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari beku pasca-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh tahap migrasi (jangan switch)"; }
ok "pasca-tahap-migrasi sebelum switch: dokumen pembanding beku IDENTIK"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
dcp "$NEW_DIR" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
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
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan bukan image baru"
ok "${NBE} berkas backend di container = kandidat (byte-identik); image baru"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
pasca_cek PSQLN "$SKEMA_PRA" || die "pemeriksaan pasca-switch: ${PASCA_GALAT}"
[ "$(PSQLN "$FUNC_SQL")" = "$FUNC_MD5_MARK" ] || die "fungsi lama pasca-switch berbeda dari hasil rehearsal"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "$(( LIVE_MIG_JUMLAH + 1 )) migrasi terpasang (baseline + migrasi rilis); migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: ANTREAN KOSONG (tabel baru 0 baris, rencana posting 0 transaksi), panel unit + izin, catatan historis kosong, penolakan tanpa token/hanya-lihat; tidak ada tulisan"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
// Smoke BACA-SAJA rilis "Rekonsiliasi pemakaian historis" terhadap backend BARU yang sudah melayani. Hanya GET (+ penolakan di pintu yang gagal sebelum menyentuh data).
// Memastikan rilis KODE selesai dengan antrean KOSONG: tidak ada batch impor, catatan, peristiwa, koreksi harga; rencana posting 0 transaksi; tidak ada posting 384 transaksi.
// Hitungan tabel bisnis sebelum vs sesudah smoke dibandingkan (smoke tidak menulis).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000"; const PUB = process.env.SMOKE_PUBLIK || "https://app.sanomatrassehat.com";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "PRODUCTION_WORKER", "PRODUCTION_LEAD", "WAREHOUSE"]);
async function userDengan(role, tanpa) { for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u; } return null; }
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
if (!adm) { rec("akun ADMIN tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm); const tS = sales ? await tokenUntuk(sales) : null;
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const post = async (path, token, body = {}) => { const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "smoke-rekon-0001", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); return r.status; };
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const BARU = { batch: "select count(*)::int n from usage_import_batches", catatan: "select count(*)::int n from unit_usage_notes", peristiwa: "select count(*)::int n from unit_usage_note_events", koreksiHarga: "select count(*)::int n from fin_stock_movement_valuation_corrections", koreksiPemakaian: "select count(*)::int n from warehouse_corrections where doc_type = 'UNIT_USAGE'", penyesuaianAsal: "select count(*)::int n from stock_adjustment_requests where origin_type is not null" };
const TULIS = { sm: "select count(*)::int n from stock_movements", mi: "select count(*)::int n from material_issues", jur: "select count(*)::int n from fin_journal_entries", val: "select count(*)::int n from fin_stock_movement_valuations", bahan: "select count(*)::int n from materials", unit: "select count(*)::int n from units", ...BARU };
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);
const ISI_AWAL = ["batch", "catatan", "peristiwa", "koreksiHarga", "koreksiPemakaian", "penyesuaianAsal"];

rec("health sehat", (await get("/api/health")).json?.ok === true);
// ── ANTREAN KOSONG: inilah bukti "tidak ada impor / tidak ada posting" saat rilis kode ──
rec("tabel impor/catatan/peristiwa/koreksi harga/koreksi pemakaian KOSONG saat rilis (tidak ada manifest yang dijalankan)", ISI_AWAL.every((k) => awal[k] === 0), ISI_AWAL.map((k) => `${k}=${awal[k]}`).join(" "));
const rp = await get("/api/production/posting-historis/rencana", tA);
rec("rencana posting historis (Admin) 200 dan 0 transaksi — tidak ada 384 transaksi yang menunggu", rp.status === 200 && rp.json?.jumlah === 0 && (rp.json?.transaksi ?? []).length === 0, `${rp.status} jumlah=${rp.json?.jumlah}`);
const kd = await get("/api/production/koreksi-pemakaian", tA);
rec("antrean koreksi pemakaian (Admin) 200 dan kosong", kd.status === 200 && Array.isArray(kd.json?.koreksi) && kd.json.koreksi.length === 0, `${kd.status}`);
// ── layar yang dipakai UI baru ──
const wo = await get("/api/production/work-orders?pageSize=5", tA);
rec("daftar Order Produksi (Admin) 200 dan memuat unit", wo.status === 200 && Array.isArray(wo.json?.units) && wo.json.units.length > 0, `${wo.status}`);
const unit = wo.json?.units?.find((u) => !["CANCELLED"].includes(u.status)) ?? wo.json?.units?.[0];
if (unit) {
  const ad = await get(`/api/production/units/${unit.id}/adopsi`, tA); const iz = ad.json?.izin ?? {};
  rec("panel unit (Admin) 200: catatanHistoris kosong (total 0), koreksiMenunggu [], hppBahan ada, izin catatanHistoris + koreksiSetuju", ad.status === 200 && ad.json?.catatanHistoris?.ringkas?.total === 0 && Array.isArray(ad.json?.koreksiMenunggu) && ad.json.koreksiMenunggu.length === 0 && "hppBahan" in ad.json && iz.catatanHistoris === true && "koreksiSetuju" in iz, `${ad.status} ${JSON.stringify(ad.json?.catatanHistoris?.ringkas)}`);
  const ch = await get(`/api/production/units/${unit.id}/catatan-historis`, tA);
  rec("catatan historis unit (Admin) 200, kosong", ch.status === 200 && ch.json?.ringkas?.total === 0, `${ch.status}`);
  if (tS) { const as = await get(`/api/production/units/${unit.id}/adopsi`, tS); rec("panel unit (hanya-lihat/Sales): izin catatanHistoris=false dan koreksiSetuju=false (UI tanpa tombol aksi)", as.status === 200 && as.json?.izin?.catatanHistoris === false && as.json?.izin?.koreksiSetuju === false, `${as.status}`); } else skip("panel unit akun hanya-lihat", "tidak ada akun SALES murni");
} else skip("panel unit", "tidak ada unit");
const ex = await fetch(BASE + "/api/production/work-orders/export.xlsx", { headers: { Authorization: "Bearer " + tA } }).catch(() => null);
if (ex) rec("ekspor Excel Order Produksi (Admin) tetap 200", ex.status === 200, `${ex.status}`); else skip("ekspor Excel", "permintaan gagal");
// ── penolakan di pintu (tidak menyentuh data) ──
const Z = "00000000-0000-4000-8000-000000000000";
rec("koreksi catatan tanpa token → 401", (await post(`/api/production/catatan-historis/${Z}/koreksi`, null, { qty: 1, alasan: "smoke" })) === 401);
rec("posting historis tanpa token → 401", (await post("/api/production/posting-historis/jalankan", null, { hashDisetujui: "x", rujukan: "x" })) === 401);
rec("posting historis Admin dengan hash salah → ditolak (bukan 2xx), tanpa menulis", ![200, 201].includes(await post("/api/production/posting-historis/jalankan", tA, { hashDisetujui: "hash-salah", rujukan: "smoke" })));
if (tS) {
  rec("koreksi catatan akun hanya-lihat → 403", (await post(`/api/production/catatan-historis/${Z}/koreksi`, tS, { qty: 1, alasan: "smoke" })) === 403);
  rec("setujui koreksi pemakaian akun hanya-lihat → 403", (await post(`/api/production/koreksi-pemakaian/${Z}/setujui`, tS, {})) === 403);
  rec("posting historis akun hanya-lihat → 403", (await post("/api/production/posting-historis/jalankan", tS, { hashDisetujui: "x", rujukan: "x" })) === 403);
}
// ── bundel web publik memuat teks UI baru ──
const html = await (await fetch(PUB + "/")).text(); const idx = (html.match(/assets\/index-[A-Za-z0-9_-]*\.js/) || [])[0];
if (idx) {
  const asetPublik = [...html.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]); let gabung = await (await fetch(PUB + "/" + idx)).text();
  for (const a of asetPublik.slice(0, 6)) { try { gabung += await (await fetch(PUB + "/" + a)).text(); } catch { /* lewati */ } }
  rec("bundel publik terbuka (index + aset)", gabung.length > 10000, `${gabung.length} byte`);
} else rec("bundel publik punya index-*.js", false);
const akhir = {}; for (const [k, q] of Object.entries(TULIS)) akhir[k] = await hitung(q);
const berubah = Object.keys(BARU).filter((k) => awal[k] !== akhir[k]);
rec("smoke tidak menulis: semua tabel/jejak rekonsiliasi (batch, catatan, peristiwa, koreksi harga, koreksi pemakaian, asal penyesuaian) tetap tidak berubah", berubah.length === 0, berubah.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
const info = Object.keys(awal).filter((k) => !(k in BARU) && awal[k] !== akhir[k]); if (info.length) console.log("  INFO  tabel yang juga ditulis pengguna nyata berubah selama smoke (bukan oleh smoke ini): " + info.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
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
set +e; GUARD_OUT="$(bash "$NEW_DIR/scripts/rollback-guard-rekon-pemakaian.sh" 2>&1)"; GUARD_RC=$?; set -e
printf '%s\n' "$GUARD_OUT" | sed 's/^/        /'
# Pemanggil guard menolak SEMUA exit selain 0. Tepat sesudah rilis kode tabel baru HARUS kosong (rilis ini tidak mengimpor/memposting; smoke juga menuntut kosong); selain itu = berhenti dan laporkan.
[ "$GUARD_RC" = "0" ] || die "guard rollback exit $GUARD_RC (bukan 0): tabel rekonsiliasi tidak kosong tepat sesudah rilis kode — periksa; rollback rutin DITOLAK; pemulihan = perbaikan maju atau keputusan pemulihan khusus"
ok "guard rollback (baca-saja) pada production: exit 0 = KOSONG; rollback rutin tersedia hanya selama tetap kosong"
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
[ "$(PSQLN "select count(*) from material_proposals")" = "$USUL_N" ] && [ "$(PSQLN "select count(*) from unit_provisional_usages")" = "$SEM_N" ] || warn "jumlah usulan/pemakaian sementara berubah dari ${USUL_N}/${SEM_N} (pengguna sah dapat mencatat selama rilis; rilis ini tidak membuatnya)"
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
say "CATATAN: rilis ini hanya memasang KODE + skema kosong. TIDAK ada impor CSV, TIDAK ada posting 384 transaksi, TIDAK ada jurnal, TIDAK ada perubahan stok. Impor catatan dan posting adalah persetujuan TERPISAH (rencana + hash + rujukan Owner). JANGAN membuat transaksi uji di production."
