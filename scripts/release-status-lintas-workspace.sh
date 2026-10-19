#!/usr/bin/env bash
# RILIS "STATUS LINTAS WORKSPACE" (Sales fleksibel + Route Planner bebas status Produksi + riwayat lengkap + SATU fungsi domain) — BACKEND + WEB, TANPA MIGRASI. FAIL-CLOSED. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA = release live saat ini).
#   SATU fungsi domain (services/statusUnitLintasWorkspace.js: ubahStatusUnitInTx) = satu-satunya jalur status unit lintas workspace; Sales (dropdown + Batalkan Order), Delivery (berangkat/terkirim/gagal), dan Admin override memanggilnya.
#   Kelayakan Route Planner: unit & order sah, belum berangkat/terkirim/batal, tidak ada job pengiriman aktif ganda; status Produksi bukan syarat. PKR tetap aturan khusus.
#   Koreksi Rika (RES-03102026-018-U1 → RTE-161026-02) TIDAK dijalankan oleh rilis ini: hanya PRATINJAU baca-saja (fase 8b) dan rehearsal pada salinan (fase 5b); penerapan = langkah terpisah atas persetujuan Owner (scripts koreksi-pengiriman-rute.js).
#   Keputusan Owner 19 Okt 2026: Sales boleh membatalkan order / menandainya Siap Kirim / Terkirim walau unit masih punya Production Run yang berjalan; Produksi & Gudang DISELARASKAN otomatis di transaksi yang sama:
#     • Batalkan  — Run dibatalkan (fase/operasi ditutup), permintaan bahan yang belum diserahkan dibatalkan + reservasi dilepas, rencana dibatalkan; bahan yang SUDAH diserahkan TIDAK dibalik otomatis (tanpa pergerakan stok)
#                   dan dicatat sebagai baris PENDING di Antrean Retur Bahan Gudang (Gudang menerima jumlah nyata lewat jalur resmi; pembatalan tidak menunggu koreksi stok).
#     • Siap Kirim/Terkirim — Run tetap berjalan, ditandai "dilepas untuk pengiriman" (kind SALES_STATUS_CHANGE; bukan override Admin, bukan hasil pemeriksaan/QC).
#   Riwayat: tab Aktivitas Unit 360 kini memuat SEMUA tindakan Produksi/Gudang/Sales/Pengiriman dengan NAMA PIC, waktu, dan rincian sebelum → sesudah (activity_events, bukti per versi, custody, QC, riwayat status order).
#   Tanpa migrasi, tanpa saklar, tanpa perubahan skema/dependensi. Order penjualan karyawan (PKR) tidak berubah. Buka-kembali order untuk pengiriman/pickup tetap dipagari (V2).
#   Produksi: smoke baca-saja + penolakan sebelum menyentuh data; rilis ini tidak membatalkan/mengubah order, Run, rencana, job, atau permintaan bahan apa pun.
# URUTAN AMAN: (1) gerbang sumber (ancestry live, allowlist, TANPA prisma/dependensi, berkas pelindung identik) → (2) audit produksi baca-saja + sidik jari beku → (3) backup + checksum → (4) build web + image
#              → (5b) kode BARU terhadap restore backup nyata (fungsi domain + koreksi Rika dicoba DI DALAM transaksi yang dibatalkan; sidik jari sebelum=sesudah) → (7) switch → (8) verifikasi + smoke baca-saja + sidik jari beku.
#
#   cat scripts/release-status-lintas-workspace.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/slw.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/slw.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'bash /tmp/slw.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only'      # fase 0–5b (backup, build, REHEARSAL pada restore backup nyata di DB sementara) lalu BERHENTI: TIDAK switch, release dir percobaan + DB sementara dibersihkan, tag image dipulihkan
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/slw.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/slw.out 2>&1 < /dev/null &'
#
# ROLLBACK KODE: aman kapan saja (tag image rollback-pre-slw-<sha8>); tidak ada perubahan database untuk dipulihkan. Order yang sudah dibatalkan/diubah Sales beserta Run/rencana/permintaan bahan yang diselaraskan TETAP
#   sebagaimana tercatat (kode lama hanya kembali menolak perubahan baru selama Run berjalan). Periksa ringkasan dengan scripts/rollback-guard-status-lintas-workspace.sh (baca-saja, selalu informasi).
# (dibangkitkan oleh scripts/gen-release-status-lintas-workspace.cjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang; templat sha256 569980d69be6…)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/status-lintas-workspace}"
# Migrasi live terakhir (HARUS = migrasi terakhir di baseline, kandidat, dan produksi) dan jumlahnya: rilis ini tidak menambah/mengubah migrasi.
LIVE_MIG_TERAKHIR="20261220090000_gudang_koreksi_dokumen"; LIVE_MIG_JUMLAH="260"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard). Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/scripts/koreksi-pengiriman-rute\.js|backend/src/lib/activityLog\.js|backend/src/services/koreksiPengirimanRute\.js|backend/tests/integration/adminOverrideSiapKirim\.integration\.test\.js|scripts/gen-release-status-lintas-workspace\.cjs|scripts/lib/rehearsal-kode-status-lintas-workspace\.mjs|scripts/lib/smoke-status-lintas-workspace\.mjs|scripts/release-status-lintas-workspace\.sh|scripts/rollback-guard-status-lintas-workspace\.sh|scripts/templates/release-status-lintas-workspace\.sh\.tpl)$'
BACKEND_SRC_EXPECT="backend/src/lib/activityLog.js backend/src/services/koreksiPengirimanRute.js"
FRONTEND_SRC_EXPECT=""
# Perubahan live yang TIDAK boleh hilang/berubah: hotfix Stock Count; berkas pelindung identik dengan baseline (Koreksi Gudang inti, jurnal, otorisasi, Produksi override, Stock Count).
HOTFIX_STOCK_COUNT="b5268e1f7d8e1a15a251106dee0a136898ee5ce1"
GUARD_UNCHANGED="backend/src/services/warehouseCorrection.js backend/src/routes/gudangKoreksi.js backend/src/services/inventoryLedger.js backend/src/routes/materialIssue.js backend/src/routes/stockAdjustment.js backend/src/routes/goodsReceipt.js backend/src/routes/returnRecord.js backend/src/routes/stockTransfer.js backend/src/routes/stockCount.js backend/src/services/opnameCutover.js backend/src/services/opnameMatriks.js backend/src/services/pergerakanSesiHitung.js backend/src/services/finance/journal.js backend/src/middleware/authorize.js backend/src/middleware/auth.js backend/src/constants/permissions.js backend/src/services/productionStepCommandService.js backend/src/services/orderStatusSync.js"
LIVE_ANCESTORS="d66f36ad1972d5dbd9fa7248208bd212f0b8f474 f293c5879fdac10e5ef0e1bb8a1169ef9ce8bef6 229755d6eae125f82671d173898f71815d13f080 08d62e7d713b08fc9e0f1d898c37791352476b5b 799d3e93de192c604a14f1c11fe7436538689bb0 56b87721f84c1d16a2cd1655e40787e2b626cb0f 442d5c137e6017964f415ecf806f43f989b2de76 ca9bdea72a03df5794658fb485c6f3a79b360eee 694f21846f206edba5542e68ffe4c3ea98a47c24 58cbc284aa71038ce2694e4579282f5e5abf3a05 57198ad687045519a12af14a3097ccf6b61e9054 e47f37e2d6690130525681863ff467682e30f3c4"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
PREFLIGHT_ONLY=0; REHEARSAL_ONLY=0; NEW_DIR_DIBUAT=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; [ "$a" = "--rehearsal-only" ] && REHEARSAL_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/status-lintas-workspace-${DEPLOY_SHORT}-${TS}"
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
Ringkasan (baca-saja): bash ${NEW_DIR}/scripts/rollback-guard-status-lintas-workspace.sh — rollback kode selalu aman; data yang sudah diselaraskan tidak dibalik.
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
exec 9>/tmp/release-status-lintas-workspace.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "slw\.sh\|release-status-lintas-workspace\|pgrep\|node src/index.js" | grep -v "$$" || true)"
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
RUN_AKTIF_N="$(psql_live -At -c "select count(*) from production_runs_v2 where status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED')")"; ORDER_BATAL_RUN_N="$(psql_live -At -c "select count(*) from \"Order\" o where o.status = 'CANCELLED' and exists (select 1 from units u join production_runs_v2 r on r.unit_id = u.id where u.order_id = o.id and r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED'))")"
SELARAS_N="$(psql_live -At -c "select count(*) from activity_events where event_type = 'PRODUCTION_FOLLOWS_ORDER'")"; UNIT_N="$(psql_live -At -c "select count(*) from units")"; ORDER_N="$(psql_live -At -c "select count(*) from \"Order\"")"
[[ "$RUN_AKTIF_N" =~ ^[0-9]+$ ]] && [[ "$ORDER_BATAL_RUN_N" =~ ^[0-9]+$ ]] && [[ "$SELARAS_N" =~ ^[0-9]+$ ]] && [[ "$UNIT_N" =~ ^[0-9]+$ ]] && [[ "$ORDER_N" =~ ^[0-9]+$ ]] || die "audit awal bukan angka"
[ "$SELARAS_N" = "0" ] || die "sudah ada ${SELARAS_N} jejak PRODUCTION_FOLLOWS_ORDER sebelum rilis — tidak diharapkan; periksa dulu"
ok "keadaan: order=${ORDER_N}, unit=${UNIT_N}, Run berjalan=${RUN_AKTIF_N}, order BATAL yang Run-nya masih berjalan (akan bisa diselaraskan lewat aturan ini)=${ORDER_BATAL_RUN_N} (rilis ini tidak mengubah satu pun)"
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
# --rehearsal-only hanya membangun image backend + restore DB sementara (tanpa salinan node_modules, build frontend, atau aset dist): gerbang disk lebih kecil. Rilis penuh tetap memakai gerbang penuh.
if [ "$REHEARSAL_ONLY" = "1" ]; then DISK_BUTUH_KB=$(( DB_BYTES / 1024 * 3 + 2 * 1024 * 1024 )); else DISK_BUTUH_KB=$(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )); fi
[ "$AVAIL_KB" -ge "$DISK_BUTUH_KB" ] || die "ruang disk kurang (tersedia ${AVAIL_KB} KB, butuh ${DISK_BUTUH_KB} KB)"
ok "ruang disk cukup (tersedia ${AVAIL_KB} KB)"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-slw-${DEPLOY_SHORT}-${TS}.sql.gz"
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
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"; NEW_DIR_DIBUAT=1
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
if [ "$REHEARSAL_ONLY" = "0" ]; then cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"; fi
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat; compose identik"

if [ "$REHEARSAL_ONLY" = "1" ]; then say "4b/4c dilewati (--rehearsal-only: hanya backend + restore DB; build frontend + teks dist divalidasi terpisah dan pasti diperiksa pada rilis penuh SEBELUM switch)"; else
say "4b. Build frontend di release dir (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
for s1 in "Rute butuh kelengkapan alamat" "pelaku tidak tercatat" "Sumber riwayat" "Status order bisa diubah (Batal, Siap Kirim, Terkirim)"; do
  [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru TIDAK memuat teks fitur rilis ini: ${s1}"
done
for s2 in "Cari di Gudang" "Kelompok bahan" "Konfirmasi Barang Jadi" "Selesaikan Produksi" "Beranda Gudang" "Ajukan Koreksi Stok" "Tetapkan Siap Kirim" "Admin override: Siap Kirim" "Produksi unit ini belum selesai — tidak menahan pengiriman"; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
# Bila frontend/src TIDAK berubah (rilis hanya backend), bundel boleh identik dengan yang lama; bila berubah, bundel WAJIB berbeda.
if [ -n "$FRONTEND_SRC_EXPECT" ]; then [ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"; fi
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
fi

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-slw-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal-kode"; say "5b. Kode BARU terhadap restore backup NYATA: restore bersih; riwayat unit dihitung pada unit nyata; fungsi domain (batal/Siap Kirim/Terkirim/konflik) dan koreksi Rika dicoba di dalam transaksi yang DIBATALKAN; sidik jari sebelum = sesudah; DB sementara dihapus"
REH_DB="rehearsal_slw_${TS}"
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
// Pemeriksaan KODE BARU "Status lintas workspace" (fungsi domain tunggal + Sales fleksibel + riwayat + koreksi Rika) terhadap data restore backup NYATA. Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal (salinan).
// Satu-satunya tulisan terjadi DI DALAM transaksi yang selalu DIBATALKAN (rollback) pada salinan; skrip rilis membuktikan sidik jari seluruh tabel sama sebelum dan sesudah.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { selaraskanProduksiDenganOrderInTx } = await import("/app/src/services/orderProduksiSelaras.js");
const { loadRiwayatUnit, SUMBER_RIWAYAT } = await import("/app/src/services/productionRiwayatService.js");
const { ubahStatusUnitInTx, KE_STATUS, SUMBER_STATUS } = await import("/app/src/services/statusUnitLintasWorkspace.js");
const { pratinjauKoreksiPengirimanRute, terapkanKoreksiPengirimanRuteInTx } = await import("/app/src/services/koreksiPengirimanRute.js");
const { formatActivitySentence, EVENT_TYPES } = await import("/app/src/lib/activityLog.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const SUMBER = new Set(Object.values(SUMBER_RIWAYAT));

// 1. Riwayat unit pada data nyata: unit dengan Run (aktif/selesai/batal) dan tanpa Run
const unitBerRun = await prisma.unit.findMany({ where: { productionRunsV2: { some: {} } }, select: { id: true, unitCode: true, orderId: true }, orderBy: { id: "asc" }, take: 40 });
const unitTanpaRun = await prisma.unit.findMany({ where: { productionRunsV2: { none: {} } }, select: { id: true, unitCode: true, orderId: true }, orderBy: { id: "asc" }, take: 15 });
let baris = 0; let bernama = 0; let rusak = 0; let tidakUrut = 0;
for (const u of [...unitBerRun, ...unitTanpaRun]) {
  const run = await prisma.productionRun.findFirst({ where: { unitId: u.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const r = await loadRiwayatUnit(prisma, { unit: u, run });
  baris += r.length;
  for (let i = 0; i < r.length; i += 1) {
    const x = r[i];
    if (!SUMBER.has(x.source) || typeof x.label !== "string" || !x.label.trim() || /undefined|\[object Object\]/.test(x.label) || !("actor" in x) || !x.at) rusak += 1;
    if (x.actor) bernama += 1;
    if (i > 0 && new Date(r[i - 1].at).getTime() > new Date(x.at).getTime()) tidakUrut += 1;
  }
}
cek(`Riwayat: ${unitBerRun.length + unitTanpaRun.length} unit nyata dihitung tanpa galat; semua baris punya sumber sah, kalimat, waktu, dan kolom pelaku; urut waktu naik`, rusak === 0 && tidakUrut === 0, `baris=${baris}, bernama=${bernama}, rusak=${rusak}, tidakUrut=${tidakUrut}`);
cek("Riwayat: data nyata memuat baris dengan NAMA pelaku (bukan semuanya kosong)", baris === 0 || bernama > 0, `bernama=${bernama}/${baris}`);

// 2. Kalimat riwayat jenis baru (semua bentuk)
const kal = [
  { aksi: "CANCEL", unitCode: "U-1", runStatusBefore: "ACTIVE", runPhase: "PROCESS", planDibatalkan: true, reservasiDilepas: 2, issueDibatalkan: ["ISS-1"], bahanSudahDiserahkan: [{ code: "M1", qty: 5, unit: "KG" }], orderStatusBefore: "PROCESSING", orderStatusAfter: "CANCELLED", reason: "uji" },
  { aksi: "READY", unitCode: "U-1", runStatusBefore: "ACTIVE", orderStatusBefore: "PROCESSING", orderStatusAfter: "READY", reason: "uji" },
  { aksi: "DELIVERED", unitCode: "U-1", runStatusBefore: "ACTIVE", orderStatusBefore: "READY", orderStatusAfter: "DELIVERED" },
].map((metadata) => formatActivitySentence({ eventType: EVENT_TYPES.PRODUCTION_FOLLOWS_ORDER, metadata }));
cek("Kalimat PRODUCTION_FOLLOWS_ORDER: batal (dengan peringatan retur bahan), Siap Kirim, Terkirim", kal.every((x) => typeof x === "string" && x.length > 20 && !/undefined/.test(x)) && /PERHATIAN Gudang/.test(kal[0]) && /Retur Bahan/.test(kal[0]) && /Siap Kirim|READY/.test(kal[1]), kal[0]);

// 3. Penyelarasan pada order nyata — DICOBA di dalam transaksi yang selalu dibatalkan
class Batal extends Error {}
const orderDenganRun = await prisma.$queryRawUnsafe(`select distinct o.id::text id, o.status::text status from "Order" o join units u on u.order_id = o.id join production_runs_v2 r on r.unit_id = u.id where r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED') and o.status <> 'CANCELLED' order by 1 limit 3`);
if (orderDenganRun.length === 0) cek("Penyelarasan: tidak ada order dengan Run berjalan di data (dilewati)", true);
for (const o of orderDenganRun) {
  const sebelum = { run: await n(`select count(*)::int n from production_runs_v2 r join units u on u.id = r.unit_id where u.order_id = '${o.id}' and r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED')`), stok: await n("select count(*)::int n from stock_movements") };
  let hasil = null; let dalam = null; let galat = null;
  try {
    await prisma.$transaction(async (tx) => {
      hasil = await selaraskanProduksiDenganOrderInTx(tx, { orderId: o.id, aksi: "CANCEL", actorId: null, alasan: "rehearsal rilis", orderStatusSebelum: o.status });
      dalam = {
        runBerjalan: await tx.productionRun.count({ where: { unit: { orderId: o.id }, status: { in: ["PENDING_ARRIVAL", "ACTIVE", "BLOCKED"] } } }),
        reservasiAktifTanpaIssueDiserahkan: await tx.materialReservation.count({ where: { status: "ACTIVE", plan: { run: { unit: { orderId: o.id }, status: "CANCELLED" } } } }),
        stok: await tx.stockMovement.count(),
        jejak: await tx.activityEvent.count({ where: { entityType: "order", entityId: o.id, eventType: "PRODUCTION_FOLLOWS_ORDER" } }),
      };
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) galat = e?.message || String(e); }
  cek(`Penyelarasan BATAL pada order nyata ${o.id.slice(0, 8)} (status ${o.status}): tanpa galat`, galat === null, galat ?? "");
  if (galat === null) {
    cek(`... semua Run berjalan (${sebelum.run}) dibatalkan di dalam transaksi; jejak tercatat; stok tidak bergerak; reservasi aktif tak tersisa pada Run batal`,
      dalam.runBerjalan === 0 && hasil.runDibatalkan.length === sebelum.run && dalam.jejak === sebelum.run && dalam.stok === sebelum.stok && dalam.reservasiAktifTanpaIssueDiserahkan === 0 || (hasil.peringatan.length > 0 && dalam.runBerjalan === 0),
      JSON.stringify({ sebelum, dalam, dibatalkan: hasil.runDibatalkan.length, peringatan: hasil.peringatan.length }));
    const sesudahRollback = await n(`select count(*)::int n from production_runs_v2 r join units u on u.id = r.unit_id where u.order_id = '${o.id}' and r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED')`);
    cek("... transaksi percobaan DIBATALKAN: Run di salinan tidak berubah", sesudahRollback === sebelum.run);
  }
}
// READY pada unit yang masih diproduksi — dicoba di transaksi yang dibatalkan
const unitProduksi = await prisma.$queryRawUnsafe(`select o.id::text oid, o.status::text ost from "Order" o join units u on u.order_id = o.id join production_runs_v2 r on r.unit_id = u.id where r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED') and u.status in ('RECEIVED','IN_PRODUCTION') and o.status in ('PROCESSING','PENDING') limit 1`);
if (unitProduksi.length === 0) cek("Penyelarasan SIAP KIRIM: tidak ada unit produksi berjalan di data (dilewati)", true); else {
  let hasil = null; let galat = null; let penanda = null;
  try {
    await prisma.$transaction(async (tx) => {
      hasil = await selaraskanProduksiDenganOrderInTx(tx, { orderId: unitProduksi[0].oid, aksi: "READY", actorId: null, alasan: "rehearsal rilis", orderStatusSebelum: unitProduksi[0].ost });
      penanda = await tx.productionRun.findFirst({ where: { unit: { orderId: unitProduksi[0].oid }, deliveryRelease: { path: ["kind"], equals: "SALES_STATUS_CHANGE" } }, select: { status: true } });
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) galat = e?.message || String(e); }
  cek("Penyelarasan SIAP KIRIM pada order nyata: Run ditandai dilepas (SALES_STATUS_CHANGE) dan tetap berjalan", galat === null && hasil.runDilepas.length >= 1 && !!penanda && ["ACTIVE", "BLOCKED", "PENDING_ARRIVAL"].includes(penanda.status), galat ?? JSON.stringify(hasil));
}
// Order tanpa Run: tidak ada efek (perilaku V1 identik)
const tanpaRun = await prisma.$queryRawUnsafe(`select o.id::text id from "Order" o where not exists (select 1 from units u join production_runs_v2 r on r.unit_id = u.id where u.order_id = o.id) limit 1`);
if (tanpaRun.length) {
  let hasil = null;
  try { await prisma.$transaction(async (tx) => { hasil = await selaraskanProduksiDenganOrderInTx(tx, { orderId: tanpaRun[0].id, aksi: "CANCEL", actorId: null, alasan: "rehearsal", orderStatusSebelum: "PENDING" }); throw new Batal(); }); } catch (e) { if (!(e instanceof Batal)) hasil = { galat: e?.message }; }
  cek("Order tanpa Run: penyelarasan tidak berefek (kosong)", hasil && !hasil.galat && hasil.runDibatalkan.length === 0 && hasil.runDilepas.length === 0 && hasil.peringatan.length === 0, JSON.stringify(hasil));
}
// 4. FUNGSI DOMAIN TUNGGAL (ubahStatusUnitInTx) pada unit nyata — setiap percobaan di transaksi yang DIBATALKAN
const unitHidup = await prisma.$queryRawUnsafe(`select u.id::text id, u.order_id::text oid, o.status::text ost from units u join "Order" o on o.id = u.order_id join production_runs_v2 r on r.unit_id = u.id where r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED') and u.status in ('RECEIVED','IN_PRODUCTION') and o.penjualan_karyawan_id is null order by u.id limit 1`);
if (unitHidup.length === 0) cek("Fungsi domain: tidak ada unit produksi berjalan di data (dilewati)", true); else {
  const u = unitHidup[0]; let galat = null; let dalam = null;
  try {
    await prisma.$transaction(async (tx) => {
      const a = await ubahStatusUnitInTx(tx, { unitIds: [u.id], ke: KE_STATUS.SIAP_KIRIM, aktor: null, sumber: SUMBER_STATUS.SALES, orderId: u.oid, orderStatusSebelum: u.ost, sinkronOrder: true });
      const b = await ubahStatusUnitInTx(tx, { unitIds: [u.id], ke: KE_STATUS.SIAP_KIRIM, aktor: null, sumber: SUMBER_STATUS.SALES, orderId: u.oid, orderStatusSebelum: u.ost, sinkronOrder: true }); // ulang = tidak menggandakan
      dalam = {
        a: a.diubah.length, b: b.diubah.length,
        status: (await tx.unit.findUniqueOrThrow({ where: { id: u.id } })).status,
        jobAktif: await tx.jobUnit.count({ where: { unitId: u.id, job: { type: "DELIVERY", status: { in: ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"] } } } }),
        run: (await tx.productionRun.findFirst({ where: { unitId: u.id, deliveryRelease: { path: ["kind"], equals: "SALES_STATUS_CHANGE" } }, select: { status: true } }))?.status ?? null,
      };
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) galat = e?.message || String(e); }
  cek("Fungsi domain SIAP_KIRIM pada unit nyata: unit Siap Kirim, TEPAT SATU job pengiriman aktif, Run dilepas (SALES_STATUS_CHANGE) dan tetap berjalan, ulang tidak menggandakan", galat === null && dalam.a === 1 && dalam.b === 0 && dalam.status === "READY_FOR_DELIVERY" && dalam.jobAktif === 1 && ["ACTIVE", "BLOCKED", "PENDING_ARRIVAL"].includes(dalam.run), galat ?? JSON.stringify(dalam));
  let galat2 = null; let dalam2 = null;
  try {
    await prisma.$transaction(async (tx) => {
      const mv0 = await tx.stockMovement.count();
      const h = await ubahStatusUnitInTx(tx, { unitIds: [u.id], ke: KE_STATUS.BATAL, aktor: null, sumber: SUMBER_STATUS.SALES, orderId: u.oid, alasan: "rehearsal rilis", orderStatusSebelum: u.ost, sinkronOrder: false, batalkanJobOrder: true });
      dalam2 = { diubah: h.diubah.length, status: (await tx.unit.findUniqueOrThrow({ where: { id: u.id } })).status, runBerjalan: await tx.productionRun.count({ where: { unitId: u.id, status: { in: ["PENDING_ARRIVAL", "ACTIVE", "BLOCKED"] } } }), stokSama: (await tx.stockMovement.count()) === mv0 };
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) galat2 = e?.message || String(e); }
  cek("Fungsi domain BATAL pada unit nyata: unit dibatalkan, Run tak ada yang berjalan, TANPA pergerakan stok otomatis", galat2 === null && dalam2.diubah === 1 && dalam2.status === "CANCELLED" && dalam2.runBerjalan === 0 && dalam2.stokSama, galat2 ?? JSON.stringify(dalam2));
}
// Konflik fakta: unit yang SUDAH berangkat/terkirim tidak boleh dibatalkan (ditolak dengan pilihan koreksi, tanpa menulis)
const unitTuntas = await prisma.$queryRawUnsafe("select u.id::text id, u.order_id::text oid, u.status::text st from units u where u.status in ('IN_TRANSIT_OUT','DELIVERED') order by u.id limit 1");
if (unitTuntas.length === 0) cek("Konflik: tidak ada unit berangkat/terkirim di data (dilewati)", true); else {
  let tolak = null;
  try { await prisma.$transaction(async (tx) => { await ubahStatusUnitInTx(tx, { unitIds: [unitTuntas[0].id], ke: KE_STATUS.BATAL, aktor: null, sumber: SUMBER_STATUS.SALES, orderId: unitTuntas[0].oid, alasan: "rehearsal", sinkronOrder: false }); throw new Batal(); }); } catch (e) { if (!(e instanceof Batal)) tolak = e; }
  cek("Konflik: BATAL pada unit berangkat/terkirim DITOLAK 409 berkode dengan pilihan koreksi", !!tolak && tolak.statusCode === 409 && /^UNIT_SUDAH_/.test(tolak.code) && Array.isArray(tolak.pilihanKoreksi) && tolak.pilihanKoreksi.length >= 2, tolak ? tolak.code : "tidak ditolak");
}
// 5. KOREKSI RIKA (RES-03102026-018-U1 → RTE-161026-02): pratinjau baca-saja + penerapan DI DALAM transaksi yang dibatalkan
const TANGGAL_RIKA = "2026-10-16"; // jam serah-terima tidak terbukti: hanya tanggal
const FOTO_RIKA = "/app/uploads/1792112641064-27qruk2yfg3.jpg"; // foto helper di grup SANO DRIVETHRU (dibaca saja; rehearsal tidak menyalin berkas)
const { periksaBerkasFoto } = await import("/app/src/services/koreksiPengirimanRute.js");
const rika = await prisma.unit.findUnique({ where: { unitCode: "RES-03102026-018-U1" }, select: { id: true } });
const rute = await prisma.route.findUnique({ where: { code: "RTE-161026-02" }, select: { id: true } });
if (!rika || !rute) { console.log("INFO Rika: unit atau rute tidak ada di salinan"); console.log("REHEARSAL_RIKA status=tidak-ada"); } else {
  const p = await pratinjauKoreksiPengirimanRute(prisma, { unitCode: "RES-03102026-018-U1", routeCode: "RTE-161026-02", tanggalKejadian: TANGGAL_RIKA, foto: (await import("node:fs")).existsSync(FOTO_RIKA) ? { path: FOTO_RIKA } : null });
  console.log("INFO Rika kondisi: " + JSON.stringify(p.kondisiSekarang));
  if (p.sudahDiterapkan) { cek("Rika: koreksi SUDAH diterapkan sebelumnya (idempoten, tidak ada yang perlu ditulis)", true); console.log("REHEARSAL_RIKA status=sudah"); }
  else if (!p.layak) { console.log("INFO Rika rintangan: " + JSON.stringify(p.rintangan)); console.log("REHEARSAL_RIKA status=tidak-layak"); }
  else {
    const aktor = await prisma.user.findFirst({ where: { active: true, OR: [{ role: "OWNER" }, { role: "ADMIN" }, { roles: { some: { role: { in: ["OWNER", "ADMIN"] } } } }] }, select: { id: true } });
    if (!aktor) { cek("Rika: ada pengguna ADMIN/OWNER aktif untuk rehearsal", false); } else {
      const f = (await import("node:fs")).existsSync(FOTO_RIKA) ? periksaBerkasFoto(FOTO_RIKA) : null;
      const buktiRehearsal = f ? { urls: ["/media/job-photos/rehearsal-tidak-ditulis" + (f.ext)], sha256: f.sha256, ukuranByte: f.ukuranByte, mime: f.mime, sumber: FOTO_RIKA } : null;
      const sebelumRute = await prisma.job.findMany({ where: { routeId: rute.id }, orderBy: { sequence: "asc" }, select: { id: true, status: true, sequence: true, updatedAt: true } });
      let hasil = null; let galat = null; let dalam = null;
      try {
        await prisma.$transaction(async (tx) => {
          hasil = await terapkanKoreksiPengirimanRuteInTx(tx, { unitCode: "RES-03102026-018-U1", routeCode: "RTE-161026-02", aktorId: aktor.id, tanggalKejadian: TANGGAL_RIKA, bukti: buktiRehearsal, alasan: "Rehearsal rilis: Rika sudah terkirim bersama rute Bandung tetapi tidak masuk Route Planner" });
          const ulang = await terapkanKoreksiPengirimanRuteInTx(tx, { unitCode: "RES-03102026-018-U1", routeCode: "RTE-161026-02", aktorId: aktor.id, tanggalKejadian: TANGGAL_RIKA, bukti: buktiRehearsal, alasan: "Rehearsal rilis: Rika sudah terkirim bersama rute Bandung tetapi tidak masuk Route Planner" });
          dalam = {
            ulangSudah: ulang.sudahDiterapkan === true,
            jobRute: await tx.job.findMany({ where: { routeId: rute.id }, orderBy: { sequence: "asc" }, select: { id: true, status: true, sequence: true, updatedAt: true } }),
            unit: (await tx.unit.findUniqueOrThrow({ where: { id: rika.id } })).status,
            rute: (await tx.route.findUniqueOrThrow({ where: { id: rute.id } })).status,
            jobUnit: await tx.jobUnit.count({ where: { unitId: rika.id, job: { type: "DELIVERY" } } }),
            runMarker: (await tx.productionRun.findFirst({ where: { unitId: rika.id }, orderBy: { createdAt: "desc" }, select: { status: true, deliveryRelease: true } })),
            qc: await tx.qualityInspection.count({ where: { run: { unitId: rika.id } } }),
          };
          throw new Batal();
        });
      } catch (e) { if (!(e instanceof Batal)) galat = e?.message || String(e); }
      const lamaUtuh = galat === null && sebelumRute.every((j) => { const k = dalam.jobRute.find((x) => x.id === j.id); return k && k.status === j.status && k.updatedAt.getTime() === j.updatedAt.getTime(); });
      cek("Rika (salinan DB): koreksi diterapkan di transaksi yang dibatalkan — 1 job baru di stop berikutnya, unit Terkirim, rute tetap Completed, Run tidak ditutup (penanda dilepas), job lama tidak berubah, ulang idempoten, tanpa QC baru",
        galat === null && hasil?.diterapkan === true && dalam.ulangSudah && dalam.jobRute.length === sebelumRute.length + 1 && lamaUtuh && dalam.unit === "DELIVERED" && dalam.rute === "COMPLETED" && dalam.jobUnit === 1 && dalam.runMarker?.status !== "COMPLETED" && ["DISPATCH_ROUTE_PLANNER", "SALES_STATUS_CHANGE"].includes(dalam.runMarker?.deliveryRelease?.kind),
        galat ?? JSON.stringify({ hasil: hasil && { diterapkan: hasil.diterapkan, sequence: hasil.sequence }, dalam: dalam && { ...dalam, jobRute: dalam.jobRute.length } }));
      const sesudah = await prisma.job.count({ where: { routeId: rute.id } });
      cek("Rika (salinan DB): transaksi percobaan DIBATALKAN — jumlah job rute di salinan tidak berubah", sesudah === sebelumRute.length);
      console.log("REHEARSAL_RIKA status=layak");
    }
  }
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
if [ "$REHEARSAL_ONLY" = "1" ]; then
  say "Rehearsal selesai (--rehearsal-only): produksi TIDAK di-switch. Membersihkan percobaan (release dir, image baru, tag)."
  # build menandai ulang tag image backend ke image BARU; pulihkan ke image yang sedang melayani lalu hapus image percobaan (container aktif tidak disentuh).
  docker tag "$PREV_IMG_ID" "$IMG_NAME" || warn "gagal memulihkan tag ${IMG_NAME}"
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah selama rehearsal"
  [ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag ${IMG_NAME} tidak kembali ke image yang melayani"
  docker rmi "$NEW_IMG_ID" >/dev/null 2>&1 || warn "image percobaan ${NEW_IMG_ID:7:12} tidak dihapus (mungkin dipakai)"
  docker rmi "$ROLLBACK_TAG" >/dev/null 2>&1 || true
  [ "$NEW_DIR_DIBUAT" = "1" ] && rm -rf -- "$NEW_DIR"
  ok "bersih: tag ${IMG_NAME} = image yang melayani; release dir percobaan dihapus; backup tetap di ${BACKUP_FILE}"
  trap - EXIT; exit 0
fi

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
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: riwayat Unit 360 (sumber + nama PIC), penolakan sebelum menyentuh data, tidak ada order/Run/rencana/bahan/job yang berubah, Route Planner/override/Koreksi tetap utuh; PRATINJAU koreksi Rika (baca-saja)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
// Smoke BACA-SAJA rilis "Status lintas workspace" terhadap backend yang SUDAH melayani (dijalankan di container baru). Tidak membatalkan/mengubah order, Run, rencana, permintaan bahan, stok, jurnal, atau PO.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, order tidak ada).
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
const admin = cari((r) => r.includes("ADMIN") && punya(r, P.ORDER_WRITE)) ?? cari((r) => punya(r, P.ORDER_WRITE));
const tanpaIzin = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.ORDER_WRITE) && !punya(r, P.ORDER_READ));
if (!admin) { rec("akun dengan izin tulis Order tersedia", false); process.exit(1); }
const tA = tokenUntuk(admin); const nol = "00000000-0000-4000-8000-000000000000";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const keadaan = async () => ({
  statusOrder: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from \"Order\" group by 1 order by 1")),
  statusUnit: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from units group by 1 order by 1")),
  statusRun: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from production_runs_v2 group by 1 order by 1")),
  rencana: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from production_run_plans_v2 group by 1 order by 1")),
  reservasi: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from material_reservations_v2 group by 1 order by 1").catch(() => [])),
  permintaanBahan: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from material_issues group by 1 order by 1").catch(() => [])),
  jejakSelaras: await hitung("select count(*)::int n from activity_events where event_type = 'PRODUCTION_FOLLOWS_ORDER'"),
  pergerakan: await hitung("select count(*)::int n from stock_movements"),
  transisiOrder: await hitung("select count(*)::int n from order_status_transitions"),
  job: await hitung("select count(*)::int n from jobs"),
  jobUnit: await hitung("select count(*)::int n from job_units"),
  retur: await hitung("select count(*)::int n from production_material_returns_v2"),
});
const awal = await keadaan();

// ── Pintu: tanpa token / tanpa izin / order tidak ada (semua gagal SEBELUM menyentuh data) ──
rec("ubah status order tanpa token → 401", (await api("PATCH", `/api/orders/${nol}`, null, { status: "CANCELLED" })).status === 401);
rec("batalkan order tanpa token → 401", (await api("POST", `/api/orders/${nol}/cancel`, null, { reason: "uji smoke" })).status === 401);
if (tanpaIzin) rec("ubah status order akun tanpa izin Order → 403", (await api("PATCH", `/api/orders/${nol}`, tokenUntuk(tanpaIzin), { status: "CANCELLED" })).status === 403); else skip("ubah status 403", "tidak ada akun aktif tanpa izin Order");
const patchTak = await api("PATCH", `/api/orders/${nol}`, tA, { status: "CANCELLED", statusOverrideNote: "uji smoke" });
rec("ubah status order yang tidak ada → 404 (tanpa menulis)", patchTak.status === 404, `${patchTak.status} ${patchTak.json?.error ?? ""}`);
const batalTak = await api("POST", `/api/orders/${nol}/cancel`, tA, { reason: "uji smoke" });
rec("batalkan order yang tidak ada → 404 (tanpa menulis)", batalTak.status === 404, `${batalTak.status} ${batalTak.json?.error ?? ""}`);

// ── Route Planner: POST /jobs menolak sebelum menyentuh data (unit tidak ada / tanpa token) ──
rec("buat job tanpa token → 401", (await api("POST", "/api/armada/jobs", null, { type: "DELIVERY", unitIds: [nol] })).status === 401);
const jobTak = await api("POST", "/api/armada/jobs", tA, { type: "DELIVERY", unitIds: [nol], scheduledDate: "2099-01-01" });
rec("buat job untuk unit yang tidak ada → 400 (tanpa menulis)", jobTak.status === 400, `${jobTak.status} ${jobTak.json?.error ?? ""}`);

// ── Riwayat Unit 360: sumber + nama PIC pada unit nyata ──
const unitRun = await prisma.$queryRawUnsafe("select u.id::text id, u.unit_code code from units u join production_runs_v2 r on r.unit_id = u.id order by r.created_at desc limit 5");
if (unitRun.length === 0) skip("riwayat Unit 360", "tidak ada unit ber-Run di produksi");
let diperiksa = 0; let berpelaku = 0; let jenisSumber = new Set();
for (const u of unitRun) {
  const r = await api("GET", `/api/production-v2/units/${u.id}/overview`, tA);
  if (r.status !== 200) { if (r.status === 404) continue; rec(`Unit 360 ${u.code}: 200`, false, String(r.status)); continue; }
  diperiksa += 1;
  const a = r.json?.activity;
  rec(`Unit 360 ${u.code}: riwayat berbentuk benar (sumber, kalimat, waktu, kolom pelaku; urut naik)`, Array.isArray(a) && a.every((x) => x.source && x.label && x.at && "actor" in x) && a.every((x, i) => i === 0 || new Date(a[i - 1].at).getTime() <= new Date(x.at).getTime()), `baris=${a?.length}`);
  for (const x of a ?? []) { jenisSumber.add(x.source); if (x.actor) berpelaku += 1; }
}
if (diperiksa > 0) { rec("riwayat nyata memuat nama pelaku pada sebagian baris", berpelaku > 0, `berpelaku=${berpelaku}; sumber=${[...jenisSumber].join(",")}`); }
else if (unitRun.length > 0) skip("riwayat Unit 360", "unit ber-Run di luar cohort pembaca");

// ── Yang tetap utuh ──
rec("Route Planner: papan DELIVERY tetap 200", (await api("GET", "/api/armada/board?type=DELIVERY", tA)).status === 200);
const lap = await api("GET", "/api/production-v2/admin-override/report", tA);
rec("Admin override: laporan tetap 200", lap.status === 200, String(lap.status));
rec("Gudang: koreksi cakupan tetap 200", (await api("GET", "/api/inventory/koreksi/cakupan", tA)).status === 200);
rec("Aktivitas generik tetap 200 (GET /api/activity)", (await api("GET", `/api/activity?entityType=order&entityId=${nol}`, tA)).status === 200);
rec("Finance: daftar PO tetap 200", (await api("GET", "/api/finance/purchase-orders", tA)).status === 200);

// ── Tidak ada tulisan oleh smoke ──
const akhir = await keadaan();
rec("smoke tidak menulis: status order/unit/Run/rencana/reservasi/permintaan bahan, jejak penyelarasan, pergerakan stok, transisi order, job, job_units, dan antrean retur bahan tidak berubah", JSON.stringify(akhir) === JSON.stringify(awal), JSON.stringify({ awal, akhir }));
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
# PRATINJAU koreksi Rika dengan kode LIVE terhadap data produksi (BACA-SAJA: mode bawaan skrip tidak membuka transaksi tulis). Informasi untuk Owner; TIDAK menggagalkan rilis.
dcp "$NEW_DIR" exec -T backend node scripts/koreksi-pengiriman-rute.js --unit=RES-03102026-018-U1 --rute=RTE-161026-02 --tanggal=2026-10-16 --foto=/app/uploads/1792112641064-27qruk2yfg3.jpg </dev/null > "$BK_DIR/pratinjau-rika.json" 2>"$BK_DIR/pratinjau-rika.err" || true
if [ -s "$BK_DIR/pratinjau-rika.json" ]; then ok "pratinjau koreksi Rika (baca-saja) tersimpan: ${BK_DIR}/pratinjau-rika.json — layak=$(grep -o '"layak": *[a-z]*' "$BK_DIR/pratinjau-rika.json" | head -n 1 | sed 's/.*: *//') sudahDiterapkan=$(grep -o '"sudahDiterapkan": *[a-z]*' "$BK_DIR/pratinjau-rika.json" | head -n 1 | sed 's/.*: *//')"; else warn "pratinjau koreksi Rika tidak menghasilkan keluaran (lihat ${BK_DIR}/pratinjau-rika.err); koreksi Rika TIDAK dijalankan oleh rilis ini"; fi
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
[ "$(PSQLN "select count(*) from activity_events where event_type = 'PRODUCTION_FOLLOWS_ORDER'")" = "$SELARAS_N" ] || warn "jumlah jejak PRODUCTION_FOLLOWS_ORDER berubah dari ${SELARAS_N} (Sales sah dapat mengubah order selama rilis; rilis ini tidak membuatnya)"
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
say "CATATAN: rilis ini tidak membatalkan/mengubah order, Run, rencana, job, atau permintaan bahan, dan TIDAK menjalankan koreksi Rika (pratinjau: ${BK_DIR}/pratinjau-rika.json). Penerapan koreksi Rika = langkah terpisah atas persetujuan Owner. Uji nyata pertama oleh Sales/Admin pada order uji yang disepakati Owner (bukan PO Ocean production); cek tab Aktivitas Unit 360 sesudahnya."
