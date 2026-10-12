#!/usr/bin/env bash
# RILIS GABUNGAN "MILESTONE DITERIMA DI WORKSHOP + EXPORT EXCEL RENCANA + CORNER (PIC)": web + backend, TANPA migrasi, TANPA perubahan data — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
# Diturunkan dari release-milestone-corner.sh. Tiga lini kode: (1) status global milestone (read-model berbasis bukti; WA "unit sampai bengkel" dipindah dari pickup selesai ke command Terima Unit di Workshop,
# DELIVERY_NOTIF_AKTIF tetap false), (2) Export Excel Rencana Produksi (snapshot baca-saja; harga hanya Admin/Owner), (3) Corner di Rencana (papan baca + command Tetapkan/Ganti PIC Corner, hanya cornerOperatorId).
# Rilis ini hanya KODE: tidak mengubah flag/cohort/setting/operator/pemetaan layanan/Run/rencana, tidak mengaktifkan unit/pilot, tidak mengirim WA, tidak membuat transaksi QA di produksi.
#
#   cat scripts/release-milestone-corner.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/mcx1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/mcx1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/mcx1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/mcx1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-rilis/milestone-export-gabungan}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/src/lib/activityLog\.js|backend/src/lib/domain/productionCornerBoard\.js|backend/src/lib/domain/productionDisplay\.js|backend/src/lib/domain/productionRencanaExport\.js|backend/src/lib/domain/workshopKpi\.js|backend/src/lib/domain/workshopMilestone\.js|backend/src/mcp/tools\.js|backend/src/mcp/toolsShared\.js|backend/src/routes/armada\.js|backend/src/routes/customers\.js|backend/src/routes/orders\.js|backend/src/routes/pipeline\.js|backend/src/routes/production\.js|backend/src/routes/productionExperience\.js|backend/src/routes/productionReports\.js|backend/src/services/customerNotifications\.js|backend/src/services/orderMilestoneService\.js|backend/src/services/productionBacklog\.js|backend/src/services/productionCornerService\.js|backend/src/services/productionExperienceReadService\.js|backend/src/services/productionPlanningCommandService\.js|backend/src/services/productionRencanaExportService\.js|backend/src/services/productionUnitOverviewService\.js|backend/src/services/unitCustodyCommandService\.js|backend/src/services/workshopMilestoneEvidence\.js|backend/src/services/workshopTimelineService\.js|backend/tests/integration/milestoneFase2\.integration\.test\.js|backend/tests/integration/notifikasiUnitDiterimaWorkshop\.integration\.test\.js|backend/tests/integration/productionSimplifikasiSlice1\.integration\.test\.js|backend/tests/integration/rencanaCorner\.integration\.test\.js|backend/tests/integration/rencanaExportExcel\.integration\.test\.js|backend/tests/integration/rencanaOrderNyata\.integration\.test\.js|backend/tests/integration/workshopMilestone\.integration\.test\.js|backend/tests/productionCornerBoard\.test\.js|backend/tests/workshopKpi\.test\.js|backend/tests/workshopMilestone\.test\.js|docs/MILESTONE-DITERIMA-WORKSHOP\.md|frontend/src/api\.js|frontend/src/components/OrderMilestoneBadge\.jsx|frontend/src/components/customer/OrderSection\.jsx|frontend/src/features/armada/components/JobBadges\.jsx|frontend/src/features/pipeline/components/KanbanCard\.jsx|frontend/src/features/production/BacklogCard\.jsx|frontend/src/features/production/PlanCard\.jsx|frontend/src/features/production/RencanaCornerView\.jsx|frontend/src/features/production/RencanaExportButton\.jsx|frontend/src/features/production/ScheduleModals\.jsx|frontend/src/features/production/UnitOverviewDrawer\.jsx|frontend/src/features/production/experience\.js|frontend/src/features/production/productionLabels\.js|frontend/src/features/production/useBacklog\.js|frontend/src/features/production/v1Source\.jsx|frontend/src/pages/Orders\.jsx|frontend/src/pages/armada/ArmadaOrders\.jsx|frontend/src/pages/bengkel/ProductionPlannerV2\.jsx|frontend/src/pages/bengkel/ProductionRencanaWorkspace\.jsx|frontend/src/pages/bengkel/ProductionWorkOrders\.jsx|frontend/src/pages/bengkel/ProductionWorkflowSettings\.jsx|frontend/src/pages/warehouse/WarehouseUnitCustody\.jsx|frontend/src/utils/excelCommon\.js|frontend/src/utils/exportOrdersStyled\.js|frontend/src/utils/exportRencanaProduksi\.js|frontend/tests/exportRencanaProduksi\.test\.js|frontend/tests/orderMilestoneBadge\.test\.js|frontend/tests/orderProduksiDirectList\.test\.js|frontend/tests/productionSidebarConsolidation\.test\.js|frontend/tests/productionSimplificationSlice1\.test\.js|frontend/tests/rencanaCornerView\.test\.js|frontend/tests/uxRealignment\.test\.js|frontend/tests/workshopMilestoneLabels\.test\.js|mobile/src/screens/OrdersScreen\.js)$'
BACKEND_SRC_EXPECT="backend/src/lib/activityLog.js backend/src/lib/domain/productionCornerBoard.js backend/src/lib/domain/productionDisplay.js backend/src/lib/domain/productionRencanaExport.js backend/src/lib/domain/workshopKpi.js backend/src/lib/domain/workshopMilestone.js backend/src/mcp/tools.js backend/src/mcp/toolsShared.js backend/src/routes/armada.js backend/src/routes/customers.js backend/src/routes/orders.js backend/src/routes/pipeline.js backend/src/routes/production.js backend/src/routes/productionExperience.js backend/src/routes/productionReports.js backend/src/services/customerNotifications.js backend/src/services/orderMilestoneService.js backend/src/services/productionBacklog.js backend/src/services/productionCornerService.js backend/src/services/productionExperienceReadService.js backend/src/services/productionPlanningCommandService.js backend/src/services/productionRencanaExportService.js backend/src/services/productionUnitOverviewService.js backend/src/services/unitCustodyCommandService.js backend/src/services/workshopMilestoneEvidence.js backend/src/services/workshopTimelineService.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/components/OrderMilestoneBadge.jsx frontend/src/components/customer/OrderSection.jsx frontend/src/features/armada/components/JobBadges.jsx frontend/src/features/pipeline/components/KanbanCard.jsx frontend/src/features/production/BacklogCard.jsx frontend/src/features/production/PlanCard.jsx frontend/src/features/production/RencanaCornerView.jsx frontend/src/features/production/RencanaExportButton.jsx frontend/src/features/production/ScheduleModals.jsx frontend/src/features/production/UnitOverviewDrawer.jsx frontend/src/features/production/experience.js frontend/src/features/production/productionLabels.js frontend/src/features/production/useBacklog.js frontend/src/features/production/v1Source.jsx frontend/src/pages/Orders.jsx frontend/src/pages/armada/ArmadaOrders.jsx frontend/src/pages/bengkel/ProductionPlannerV2.jsx frontend/src/pages/bengkel/ProductionRencanaWorkspace.jsx frontend/src/pages/bengkel/ProductionWorkOrders.jsx frontend/src/pages/bengkel/ProductionWorkflowSettings.jsx frontend/src/pages/warehouse/WarehouseUnitCustody.jsx frontend/src/utils/excelCommon.js frontend/src/utils/exportOrdersStyled.js frontend/src/utils/exportRencanaProduksi.js"
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
BK_DIR="$HOME/release-backups/mcx-${DEPLOY_SHORT}-${TS}"
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
Setelah switch bermasalah (rilis ini TANPA migrasi dan TANPA perubahan data: rollback kode tidak butuh pemulihan database dan aman kapan saja; unit yang sudah diaktifkan lewat fitur ini tetap di cohort — itu keputusan, bukan kerusakan):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
   (web: dist release sebelumnya ada di ${PREV_DIR:-<release-sebelumnya>}/frontend/dist — compose release menunjuk dist release yang berjalan)
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas).
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
exec 9>/tmp/release-milestone-corner.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "mcx1\|release-milestone-corner\|kori1\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan (tanpa migrasi, tanpa dependensi)"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" "+refs/heads/main:refs/remotes/origin/main" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat ${DEPLOY_SHORT}: rilis akan menghilangkan isi main — gabungkan main ke kandidat dulu"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE '^backend/prisma/' || die "backend/prisma berubah — rilis ini HARUS tanpa migrasi/skema"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE 'production-evidence|receipt-proofs' || die "artefak unggahan/foto uji ikut ter-commit"
# Kode sumber yang berubah HARUS tepat yang diaudit: 26 berkas backend/src dan 25 berkas frontend/src (tidak ada yang lain).
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat: ${FRONTEND_SRC_EXPECT}"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist; tanpa prisma/dependensi/Docker; backend/src = 26 berkas, frontend/src = 25 berkas"
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

# Prasyarat skema: rilis ini TANPA migrasi — semua tabel/kolom yang dipakai sudah ada (rilis Koreksi+Retur sebelumnya) dan tidak ada migrasi tertunda pada kode kandidat.
for T in units production_runs_v2 production_run_plans_v2 production_station_day_pics_v2 production_plan_schedule_events_v2 unit_custody_handoffs_v2 production_operators production_settings v2_feature_flags v2_commands activity_events stock_movements fin_journal_entries; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
PENDING0="$(comm -23 <(sg ls-tree --name-only "${DEPLOY_SHA}:backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null" | LC_ALL=C sort) || true)"
[ -z "$PENDING0" ] || die "ada migrasi tertunda pada kode kandidat (rilis ini harus TANPA migrasi): $(printf '%s' "$PENDING0" | tr '\n' ' ')"
ok "tanpa migrasi: seluruh migrasi kandidat sudah terpasang; tabel yang dipakai ada"
# DOKUMEN PEMBANDING DIBEKUKAN: hanya yang menurut aturan bisnis tidak mungkin berubah akibat rilis ini (penerimaan DITOLAK, PO DIBATALKAN tanpa penerimaan aktif, faktur Dibatalkan/Ditolak yang sudah diam sebelum T0 —
# penerimaan Selesai dan PO Selesai SENGAJA tidak dibekukan: Koreksi Penerimaan sah mengubahnya;
# baris stok dan jurnal yang dibuat sebelum T0 (append-only); saldo per akun dari jurnal itu; seluruh flag fin_settings). T0 = jam DB (UTC) 5 menit lalu. Dokumen terbuka dan transaksi baru TIDAK diperbandingkan.
# Daftar id Produksi DIBEKUKAN sekarang; sesudah rilis sidik jari dihitung ulang untuk id yang SAMA (tahan terhadap order/unit baru yang sah; aktivitas Run/rencana/PIC baru = berhenti,
# karena cohort hanya 1 unit dan rilis ini tidak boleh menyebabkannya).
idlist() { psql_live -At -c "select coalesce(',' || string_agg(quote_literal(id::text), ',' order by id::text), '') from $1 $2"; }
IDS_RUN="$(idlist production_runs_v2 '')"; IDS_PLAN="$(idlist production_run_plans_v2 '')"; IDS_PIC="$(idlist production_station_day_pics_v2 '')"
IDS_EVT="$(idlist production_plan_schedule_events_v2 '')"; IDS_HAND="$(idlist unit_custody_handoffs_v2 '')"
IDS_UNIT="$(idlist units "where status::text in ('DELIVERED','CANCELLED')")"; IDS_ORD="$(idlist '"Order"' "where status::text in ('DELIVERED','CANCELLED')")"
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'gr_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipts x where x.status = 'REJECTED' and x.updated_at < '$T0'::timestamp
union all select 'gr_final_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_lines x where x.goods_receipt_id in (select id from goods_receipts where status = 'REJECTED' and updated_at < '$T0'::timestamp)
union all select 'po_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_orders x where x.status = 'DIBATALKAN' and x.updated_at < '$T0'::timestamp and not exists (select 1 from goods_receipt_lines gl join goods_receipts g on g.id = gl.goods_receipt_id join fin_purchase_order_lines pl on pl.id = gl.purchase_order_line_id where pl.purchase_order_id = x.id and g.status <> 'REJECTED')
union all select 'bill_final', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['credit_applied'])::text, '|' order by x.id),'')) from fin_supplier_bills x where x.status in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'flag', count(*), md5(coalesce(string_agg(f.key || '=' || f.value, '|' order by f.key),'')) from fin_settings f
FPBEKU
)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "8" ] || die "sidik jari dokumen beku tidak 8 baris"
# SIDIK JARI PENUH pada cutoff T0 yang sama (sebelum dan sesudah rilis): migrasi terpasang, flag, jurnal (header+baris), saldo per akun, stok, PO, penerimaan (+baris+event), faktur, pembayaran.
VERIF_SQL="$(cat <<VERIF
select 'migrasi_terpasang', count(*), md5(coalesce(string_agg(migration_name, '|' order by migration_name), '')) from _prisma_migrations where finished_at is not null and rolled_back_at is null
union all select 'flags_v2', count(*), md5(coalesce(string_agg(key || '=' || enabled::text || scope || config::text, '|' order by key), '')) from v2_feature_flags
union all select 'fin_settings', count(*), md5(coalesce(string_agg(key || '=' || value::text, '|' order by key), '')) from fin_settings
union all select 'jurnal_header', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_journal_entries x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) from fin_journal_lines l where l.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id), '')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'saldo_total', 1, md5(coalesce(sum(l.debit),0)::text || '/' || coalesce(sum(l.credit),0)::text) from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp
union all select 'stok_pergerakan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'stok_per_bahan', count(*), md5(coalesce(string_agg(s.material_id::text || ':' || s.q::text, '|' order by s.material_id), '')) from (select material_id, sum(qty) q from stock_movements where created_at < '$T0'::timestamp group by material_id) s
union all select 'po', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_purchase_orders x where x.updated_at < '$T0'::timestamp
union all select 'po_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_purchase_order_lines x where x.purchase_order_id in (select id from fin_purchase_orders where updated_at < '$T0'::timestamp)
union all select 'penerimaan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from goods_receipts x where x.updated_at < '$T0'::timestamp
union all select 'penerimaan_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from goods_receipt_lines x where x.goods_receipt_id in (select id from goods_receipts where updated_at < '$T0'::timestamp)
union all select 'penerimaan_event', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from goods_receipt_events x where x.created_at < '$T0'::timestamp
union all select 'faktur', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_supplier_bills x where x.updated_at < '$T0'::timestamp
union all select 'faktur_alokasi', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_supplier_bill_allocations x where x.bill_id in (select id from fin_supplier_bills where updated_at < '$T0'::timestamp)
union all select 'pembayaran_supplier', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_supplier_payments x where x.created_at < '$T0'::timestamp
union all select 'retur_pergerakan_stok', count(*), '-' from stock_movements where type::text = 'SUPPLIER_RETURN' and created_at < '$T0'::timestamp
union all select 'koreksi_pembalik', count(*), '-' from stock_movements where type::text = 'RECEIPT' and qty < 0 and goods_receipt_id is not null and created_at < '$T0'::timestamp
union all select 'koreksi_jurnal', count(*), '-' from fin_journal_entries where idempotency_key like 'PENERIMAAN\_BAHAN:%:KOREKSI:%' and created_at < '$T0'::timestamp
union all select 'prod_run_beku', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from production_runs_v2 x where x.id::text in ('-'$IDS_RUN)
union all select 'prod_run_total', count(*), '-' from production_runs_v2
union all select 'prod_rencana_beku', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from production_run_plans_v2 x where x.id::text in ('-'$IDS_PLAN)
union all select 'prod_rencana_total', count(*), '-' from production_run_plans_v2
union all select 'prod_pic_meja', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from production_station_day_pics_v2 x where x.id::text in ('-'$IDS_PIC)
union all select 'prod_pic_meja_total', count(*), '-' from production_station_day_pics_v2
union all select 'prod_riwayat_jadwal', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from production_plan_schedule_events_v2 x where x.id::text in ('-'$IDS_EVT)
union all select 'prod_riwayat_total', count(*), '-' from production_plan_schedule_events_v2
union all select 'prod_handoff', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from unit_custody_handoffs_v2 x where x.id::text in ('-'$IDS_HAND)
union all select 'prod_handoff_total', count(*), '-' from unit_custody_handoffs_v2
union all select 'prod_operator', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from production_operators x
union all select 'prod_setting', count(*), md5(coalesce(string_agg(key || '=' || value::text, '|' order by key), '')) from production_settings
union all select 'prod_pemetaan_layanan', count(*), md5(coalesce(string_agg(id::text || ':' || coalesce(production_service_id::text, '-'), '|' order by id), '')) from price_items
union all select 'unit_final_beku', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from units x where x.id::text in ('-'$IDS_UNIT)
union all select 'order_final_beku', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from "Order" x where x.id::text in ('-'$IDS_ORD)
union all select 'aktivasi_rencana', count(*), '-' from activity_events where event_type = 'PRODUCTION_RENCANA_UNIT_ACTIVATED'
VERIF
)"
psql_live -At -c "$VERIF_SQL" | LC_ALL=C sort > "$BK_DIR/verif-sebelum.txt" || die "sidik jari penuh sebelum gagal"
[ "$(grep -c . "$BK_DIR/verif-sebelum.txt")" = "36" ] || die "sidik jari penuh tidak 36 baris ($(grep -c . "$BK_DIR/verif-sebelum.txt"))"
ok "sidik jari penuh sebelum rilis tersimpan (36 kunci termasuk Run/rencana/PIC/riwayat/handoff/operator/setting/pemetaan Produksi, cutoff T0=${T0} UTC)"
# Pembaca bentuk Backlog Rencana Produksi (fungsi SERVER yang sama dengan papan) — dijalankan di kode LAMA (live, baca-saja) dan nanti di kode BARU terhadap RESTORE backup.
# Kosakata tab berubah SENGAJA (milestone): himpunan unit dan aksi/kode/onboardable tiap kartu HARUS setara (lihat banding.mjs); pergeseran tab dilaporkan.
cat > "$BK_DIR/bentuk.mjs" <<'BENTUK'
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const mod = await import(pathToFileURL(process.cwd() + "/src/services/productionBacklog.js").href);
// STATUSES diberikan skrip rilis: kode LAMA = DIPROSES,PENGAMBILAN; kode BARU = SEMUA,MENUNGGU_DIJEMPUT,PENGAMBILAN,DITERIMA_WORKSHOP,DIPROSES.
const statuses = String(process.env.STATUSES || "DIPROSES,PENGAMBILAN").split(",").filter(Boolean);
const out = {};
for (const status of statuses) {
  const r = await mod.listBacklog(prisma, { status, page: 1, pageSize: 100, canActivate: true });
  out[status] = { total: r.total, counts: r.counts, rencanaCounts: r.rencanaCounts, items: r.items.map((i) => ({
    unitId: i.unitId, schedulable: !!i.schedulable, action: i.rencana?.action ?? null, code: i.rencana?.code ?? null, onboardable: !!i.rencana?.onboardable,
    activatable: i.rencana?.activatable === undefined ? null : i.rencana.activatable === true,
    globalKey: i.card?.globalStatus?.key ?? null,
  })) };
}
await prisma.$disconnect();
console.log(JSON.stringify(out));
BENTUK
cat > "$BK_DIR/banding.mjs" <<'BANDING'
import fs from "node:fs";
// Pembanding bentuk Backlog: KODE LAMA (live) vs KODE BARU (restore backup). Kosakata tab berubah SENGAJA (milestone global); himpunan unit TIDAK boleh hilang/bertambah:
//   B.SEMUA                      == A.DIPROSES   (himpunan lama "Diproses": unit order Diproses yang sudah dijemput / lahir di workshop)
//   A.PENGAMBILAN                == B.MENUNGGU_DIJEMPUT ∪ (B.PENGAMBILAN \ A.DIPROSES)   (pickup belum selesai)
//   B.PENGAMBILAN ∩ A.DIPROSES   = unit "pickup selesai tanpa bukti terima" (pindah dari Diproses ke Pengambilan — perubahan yang diharapkan)
//   B.DITERIMA_WORKSHOP ∪ B.DIPROSES ∪ (B.PENGAMBILAN ∩ A.DIPROSES) == B.SEMUA, saling lepas
// Per kartu: aksi/kode/onboardable/schedulable identik dengan kode lama; activatable hanya pada AWAIT_ACTIVATION tanpa Run.
const A = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), B = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const runCount = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
let gagal = 0; let aktif = 0; let kartu = 0;
const bad = (m) => { console.log(`  GAGAL  ${m}`); gagal++; };
const ids = (x) => new Set((x?.items || []).map((i) => i.unitId));
const eq = (s, t) => s.size === t.size && [...s].every((x) => t.has(x));
for (const k of ["DIPROSES", "PENGAMBILAN"]) if (!A[k]) bad(`kode lama tanpa ${k}`);
for (const k of ["SEMUA", "MENUNGGU_DIJEMPUT", "PENGAMBILAN", "DITERIMA_WORKSHOP", "DIPROSES"]) if (!B[k]) bad(`kode baru tanpa ${k}`);
if (!gagal) {
  const aD = ids(A.DIPROSES), aP = ids(A.PENGAMBILAN), bS = ids(B.SEMUA), bM = ids(B.MENUNGGU_DIJEMPUT), bP = ids(B.PENGAMBILAN), bT = ids(B.DITERIMA_WORKSHOP), bX = ids(B.DIPROSES);
  if (!eq(bS, aD)) bad(`SEMUA(${bS.size}) != DIPROSES lama(${aD.size})`);
  const pindah = new Set([...bP].filter((u) => aD.has(u)));
  const cabang1 = new Set([...bP].filter((u) => !aD.has(u)));
  if (!eq(aP, new Set([...bM, ...cabang1]))) bad(`PENGAMBILAN lama(${aP.size}) != MENUNGGU_DIJEMPUT(${bM.size}) + PENGAMBILAN baru di luar Diproses lama(${cabang1.size})`);
  for (const u of bM) if (bP.has(u) || bT.has(u) || bX.has(u)) bad(`unit ${u} MENUNGGU_DIJEMPUT juga ada di tab lain`);
  const union = new Set([...bT, ...bX, ...pindah]);
  if (!eq(union, bS)) bad(`DITERIMA(${bT.size}) + DIPROSES(${bX.size}) + Pengambilan-pindahan(${pindah.size}) != SEMUA(${bS.size})`);
  if (bT.size + bX.size + pindah.size !== union.size) bad("tab DITERIMA/DIPROSES/Pengambilan-pindahan tidak saling lepas");
  // tiap kartu: aksi/kode identik dengan kode lama (yang ada di salah satu tab lama)
  const lama = new Map([...A.DIPROSES.items, ...A.PENGAMBILAN.items].map((i) => [i.unitId, i]));
  for (const st of Object.keys(B)) {
    for (const ib of B[st].items) {
      kartu++;
      const ia = lama.get(ib.unitId);
      if (!ia) { bad(`${st}: kartu ${ib.unitId} tidak ada di kode lama`); continue; }
      if (ia.action !== ib.action || ia.code !== ib.code || ia.onboardable !== ib.onboardable || ia.schedulable !== ib.schedulable) bad(`${st}: kartu ${ib.unitId} berubah ${JSON.stringify(ia)} -> ${JSON.stringify(ib)}`);
      if (!ib.globalKey) bad(`${st}: kartu ${ib.unitId} tanpa status global`);
      if (st === "SEMUA" && ib.activatable === true) {
        aktif++;
        if (ib.action !== "AWAIT_ACTIVATION") bad(`${st}: ${ib.unitId} activatable padahal aksi ${ib.action}`);
        if ((runCount[ib.unitId] ?? 0) !== 0) bad(`${st}: ${ib.unitId} activatable padahal punya ${runCount[ib.unitId]} Run`);
      }
    }
  }
  // status global konsisten dengan tab
  const tabKey = { MENUNGGU_DIJEMPUT: "MENUNGGU_DIJEMPUT", PENGAMBILAN: "PENGAMBILAN", DITERIMA_WORKSHOP: "DITERIMA_WORKSHOP", DIPROSES: "DIPROSES" };
  for (const [tab, key] of Object.entries(tabKey)) for (const i of B[tab].items) if (i.globalKey !== key) bad(`tab ${tab}: kartu ${i.unitId} berstatus global ${i.globalKey}`);
  console.log(`  ok     himpunan unit: SEMUA == Diproses lama (${bS.size}); Pengambilan lama (${aP.size}) = Menunggu Dijemput (${bM.size}) + Pengambilan baru di luar Diproses lama (${cabang1.size})`);
  console.log(`  ok     perpindahan tab yang DIHARAPKAN: Diproses lama ${aD.size} -> Diproses ${bX.size} + Diterima di Workshop ${bT.size} + Pengambilan (pickup selesai, belum ada bukti terima) ${pindah.size}`);
  console.log(`  ok     ${kartu} kartu: aksi/kode/onboardable/schedulable identik dengan kode lama; setiap kartu membawa status global`);
  console.log(`PERGESERAN_TAB diproses_lama=${aD.size} diproses=${bX.size} diterima=${bT.size} pengambilan_dari_diproses=${pindah.size} menunggu_dijemput=${bM.size} pengambilan_lama=${aP.size}`);
}
console.log(`BANDING_HASIL gagal=${gagal} kartu=${kartu} activatable=${aktif}`);
process.exit(gagal ? 1 : 0);
BANDING
dcp "$PREV_DIR" exec -T -e STATUSES="DIPROSES,PENGAMBILAN" backend node --input-type=module - < "$BK_DIR/bentuk.mjs" > "$BK_DIR/bentuk-sebelum.json" 2>"$BK_DIR/bentuk-sebelum.err" || die "membaca bentuk Backlog (kode lama) gagal: $(head -c 300 "$BK_DIR/bentuk-sebelum.err")"
[ "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Object.keys(j).length)' "$BK_DIR/bentuk-sebelum.json")" = "2" ] || die "bentuk Backlog sebelum tidak lengkap"
ok "bentuk Backlog SEBELUM (kode lama, live, baca-saja): $(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Object.entries(j).map(([k,v])=>k+"="+v.items.length).join(", "))' "$BK_DIR/bentuk-sebelum.json") kartu"
psql_live -At -c "select coalesce(json_object_agg(u.id::text, c.n), '{}'::json) from units u join (select unit_id, count(*) n from production_runs_v2 group by unit_id) c on c.unit_id = u.id" > "$BK_DIR/run-per-unit.json" || die "hitungan Run per unit gagal"

say "2b. Sumber node_modules frontend (package.json identik dengan kandidat)"
LOCK_NEW="$BK_DIR/pkg-baru.json"; sg show "${DEPLOY_SHA}:frontend/package.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do
  d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package.json identik"
ok "node_modules build dari ${NM_SRC}"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-mcx-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-koreksi-retur.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
# Teks fitur rilis ini (milestone, Export Excel, Corner) + teks fitur lama yang tidak boleh hilang dari bundel.
for s1 in "Terima Unit di Workshop" "Menunggu Dijemput" "Status global" "Waktu alur" "Export Excel" "Unduh .xlsx" "Hanya kartu yang sedang terlihat" "Aplikasi Corner" "Belum ada unit untuk Corner" "Tidak ada permintaan ganti kain"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur rilis ini: ${s1}"; done
for s2 in "Rencana Produksi" "Status Produksi" "Belum Dijadwalkan" "Perlu konfirmasi Sales" "Diterima di Workshop" "Retur & Debit Note" "Barang Akan Datang"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
# Label lama yang SENGAJA diganti tidak boleh tersisa.
[ -z "$(grep -lF "Unit Tiba di Workshop" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru masih memuat label lama 'Unit Tiba di Workshop' (harus 'Terima Unit di Workshop')"
if [ "$NEW_INDEX" = "$PREV_INDEX" ]; then die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"; fi
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); 10 teks fitur rilis ini + 7 teks fitur lama ada; label lama 'Unit Tiba di Workshop' tidak tersisa"

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

PHASE="4d-gerbang-kontrak"; say "4d. Gerbang kontrak pada sumber release dir (SEBELUM build image dan switch)"
gate() { local desc="$1"; shift; "$@" >/dev/null 2>&1 || die "gerbang kontrak GAGAL: ${desc}"; ok "$desc"; }
NS="$NEW_DIR/backend/src"
gate "DELIVERY_NOTIF_AKTIF tetap false (tidak ada WA customer yang dinyalakan)" grep -Eq '^const DELIVERY_NOTIF_AKTIF = false;' "$NS/services/customerNotifications.js"
gate "pickup selesai (POST /armada/jobs/:id/complete) tidak lagi memanggil notifyUnitReceived" bash -c "! grep -Eq 'notifyUnitReceived\(' '$NS/routes/armada.js' && grep -Fq 'owned.type !== \"PICKUP\") notifyDelivered' '$NS/routes/armada.js'"
gate "event penerimaan workshop idempoten: dedupeKey unik per handoff/Run + hook hanya pada transisi (bukan replay)" bash -c "grep -Fq 'unit-received-workshop:' '$NS/services/unitCustodyCommandService.js' && grep -Eq 'if \(!result \|\| result\.replayed' '$NS/services/unitCustodyCommandService.js'"
gate "PIC Corner: satu-satunya penulis rencana = writeCornerOperatorInTx (hanya cornerOperatorId, revision, commandId)" bash -c "grep -Fq 'data: { cornerOperatorId, revision, commandId }' '$NS/services/productionPlanningCommandService.js' && ! grep -Eq '\.productionRunPlan\.(update|updateMany|create|upsert|delete)' '$NS/services/productionCornerService.js'"
gate "PIC Corner menolak pekerjaan yang sudah berjalan (CORNER_WORK_STARTED) dan operator Admin/Owner/nonaktif" bash -c "grep -Fq 'CORNER_WORK_STARTED' '$NS/lib/domain/productionCornerBoard.js' && grep -Fq 'bukanAdminOwner' '$NS/services/productionCornerService.js' && grep -Fq 'CORNER_OPERATOR_INVALID' '$NS/services/productionCornerService.js'"
gate "export Rencana: nilai order hanya ADMIN/OWNER yang memintanya (403 untuk selain itu; field harga tidak dimuat)" bash -c "grep -Fq 'EXPORT_VALUE_FORBIDDEN' '$NS/routes/productionExperience.js' && grep -Fq 'includeValue = !!(canIncludeValue && query.includeValue)' '$NS/services/productionRencanaExportService.js'"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-mcx-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"


PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, baca perilaku KODE BARU terhadapnya (angka PO identik, dokumen kosong ditandai), bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_mcx_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
# Restore dibandingkan dengan dokumen BEKU dan sidik jari penuh pada T0 yang sama (transaksi sah sesudah T0 tidak diperbandingkan).
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod-beku.txt" || { reh_drop; die "sidik jari dokumen beku produksi gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || true; reh_drop; die "dokumen pembanding beku BERUBAH selama backup (produksi)"; }
RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi (backup/restore bermasalah)"; }
RPSQL "$VERIF_SQL" | LC_ALL=C sort > "$BK_DIR/verif-reh.txt" || { reh_drop; die "sidik jari penuh rehearsal gagal"; }
cmp -s "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-reh.txt" || { diff "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-reh.txt" || true; reh_drop; die "RESTORE berbeda dari produksi pada sidik jari penuh (cutoff T0)"; }
ok "restore nyata IDENTIK dengan produksi: 8 kelompok dokumen beku + 36 kunci sidik jari penuh (jurnal, saldo, stok, PO, penerimaan, faktur, pembayaran, flag, migrasi, Run, rencana, PIC meja, riwayat jadwal, handoff, operator, setting, pemetaan layanan)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status (image baru, DB restore) tidak 'up to date' — ada migrasi tertunda?"; }
ok "image baru melihat DB restore 'up to date' (tanpa migrasi tertunda)"
# KODE BARU membaca data NYATA (restore): aksi/kode tiap kartu identik dengan kode lama; penanda activatable hanya pada unit AWAIT_ACTIVATION tanpa Run apa pun.
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" -e STATUSES="SEMUA,MENUNGGU_DIJEMPUT,PENGAMBILAN,DITERIMA_WORKSHOP,DIPROSES" backend node --input-type=module - < "$BK_DIR/bentuk.mjs" > "$BK_DIR/bentuk-reh.json" 2>"$BK_DIR/bentuk-reh.err" || { reh_drop; die "membaca bentuk Backlog (kode BARU, restore) gagal: $(head -c 400 "$BK_DIR/bentuk-reh.err")"; }
BAND="$(node "$BK_DIR/banding.mjs" "$BK_DIR/bentuk-sebelum.json" "$BK_DIR/bentuk-reh.json" "$BK_DIR/run-per-unit.json")" || { printf '%s\n' "$BAND"; reh_drop; die "perilaku kode baru TIDAK sesuai harapan pada data nyata (lihat GAGAL di atas)"; }
printf '%s\n' "$BAND" | grep -v '^BANDING_HASIL'
printf '%s\n' "$BAND" | grep -q '^BANDING_HASIL gagal=0' || { reh_drop; die "ringkasan pembanding tidak ada/gagal"; }
cat > "$BK_DIR/baca-baru.mjs" <<'BACABARU'
// Pembaca KODE BARU terhadap DB restore (baca-saja): papan Corner, export Rencana (tanpa harga), status global order, timeline KPI. Gagal = berhenti sebelum switch.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const imp = (p) => import(pathToFileURL(process.cwd() + "/src/" + p).href);
const flags = await imp("services/v2FeatureFlags.js");
const board = await imp("lib/domain/productionBoard.js");
const exp = await imp("lib/domain/productionRencanaExport.js");
const corner = await imp("services/productionCornerService.js");
const exportSvc = await imp("services/productionRencanaExportService.js");
const ordMs = await imp("services/orderMilestoneService.js");
const tl = await imp("services/workshopTimelineService.js");
const custody = await imp("services/unitCustodyCommandService.js");
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const state = flags.resolveProductionReaderState(await flags.loadV2Flags(prisma));
const unitIds = state.mode === "OFF" ? [] : [...state.unitIds];
rec("hook penerimaan workshop terpasang (fungsi) — pickup selesai bukan pemicunya", typeof custody.custodyHooks?.unitReceivedAtWorkshop === "function");
const cb = await corner.getCornerBoard(prisma, { unitIds });
rec("papan Corner: tepat 4 kelompok bernama sesuai kontrak", cb.groups.map((g) => g.label).join("|") === "Menunggu prasyarat|Siap Corner|Sedang dikerjakan|Selesai", `${cb.groups.map((g) => g.count).join("/")} + ${cb.notApplicable} tidak berlaku`);
const items = cb.groups.flatMap((g) => g.items);
rec("kartu Corner: izin pengalihan + hambatan dari server (bukan klien)", items.every((i) => typeof i.assign?.allowed === "boolean" && Array.isArray(i.blockers)));
rec("tanpa urutan/kapasitas/target Corner", !/cornerSequence|cornerCapacity|cornerTarget/.test(JSON.stringify(cb)));
const today = board.todayWib();
const from = new Date(Date.parse(today + "T00:00:00Z") - 30 * 86400000).toISOString().slice(0, 10);
const q = exp.normalizeExportQuery({ from, to: today, includeUnscheduled: true }, { today, stations: board.BOARD_DEFAULTS.stations });
const ex = await exportSvc.buildRencanaExport(prisma, { cohortUnitIds: unitIds, query: q, canIncludeValue: false });
rec("export Rencana: 26 kolom, tanpa kolom/field harga", ex.columns.length === 26 && !ex.columns.some((c) => c.key === "nilaiOrder") && !JSON.stringify(ex.rows).includes("nilaiOrder"), `${ex.rows.length} baris`);
rec("export Rencana: includeValue tanpa izin diabaikan (canIncludeValue=false)", (await exportSvc.buildRencanaExport(prisma, { cohortUnitIds: unitIds, query: { ...q, includeValue: true }, canIncludeValue: false })).columns.length === 26);
const orders = await prisma.order.findMany({ take: 200, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
const ms = await ordMs.loadOrderMilestones(prisma, orders);
const FLOW = ["MENUNGGU_DIJEMPUT", "PENGAMBILAN", "DITERIMA_WORKSHOP", "DIPROSES", "SIAP_KIRIM", "DALAM_PENGIRIMAN", "TERKIRIM"];
let salah = 0; let mixed = 0;
for (const m of ms.values()) {
  if (!m || m.legacy || !m.key) continue;
  if (m.items.length && m.items[0].key !== m.key) salah++;
  if (m.mixed) { mixed++; if (!/ dari \d+ unit/.test(m.summary)) salah++; if (m.items.length < 2) salah++; }
  if (["SIAP_KIRIM", "TERKIRIM"].includes(m.key) && m.mixed && m.items.some((i) => FLOW.indexOf(i.key) < FLOW.indexOf("SIAP_KIRIM"))) salah++;
}
rec("status order: unit tertinggal + rincian konsisten untuk 200 order terbaru", ms.size === orders.length && salah === 0, `${mixed} order campuran posisi; pelanggaran=${salah}`);
const tls = await tl.loadWorkshopTimelines(prisma, unitIds.slice(0, 200));
rec("timeline KPI: setiap unit cohort punya 6 durasi; tanpa timestamp dikarang", [...tls.values()].every((t) => t.durations.length === 6 && t.durations.every((d) => d.available || d.minutes === null)), `${tls.size} unit`);
const nUnits = await prisma.unit.count({ where: { status: { not: "CANCELLED" } } });
const evi = await (await imp("services/workshopMilestoneEvidence.js")).countByGlobalStatus(prisma, {});
const total = Object.values(evi).reduce((s, n) => s + n, 0);
rec("status global unit: tiap unit non-batal tepat satu status (partisi lengkap)", total === nUnits, `${total} = ${nUnits}`);
console.log("BACA_BARU " + JSON.stringify({ corner: cb.groups.map((g) => g.count), notApplicable: cb.notApplicable, export: ex.rows.length, order: ms.size, mixed, unit: nUnits, global: evi }));
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
BACABARU
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" backend node --input-type=module - < "$BK_DIR/baca-baru.mjs" > "$BK_DIR/baca-baru.log" 2>"$BK_DIR/baca-baru.err" || { cat "$BK_DIR/baca-baru.log"; reh_drop; die "pembaca kode BARU pada data restore GAGAL: $(head -c 400 "$BK_DIR/baca-baru.err")"; }
grep -v '^BACA_BARU' "$BK_DIR/baca-baru.log"
grep -q '^BACA_BARU ' "$BK_DIR/baca-baru.log" || { reh_drop; die "pembaca kode baru tidak mencetak ringkasan (jangan anggap lulus)"; }
RPSQL "$VERIF_SQL" | LC_ALL=C sort > "$BK_DIR/verif-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/verif-reh.txt" "$BK_DIR/verif-reh-sesudah.txt" || { diff "$BK_DIR/verif-reh.txt" "$BK_DIR/verif-reh-sesudah.txt" || true; reh_drop; die "membaca dengan kode baru MENGUBAH data (tidak boleh)"; }
reh_drop
ok "rehearsal lulus: kode baru hanya membaca (sidik jari restore tidak berubah); DB sementara dihapus"

PHASE="6-tanpa-migrasi"; say "6. Rilis TANPA migrasi: konfirmasi kandidat, release aktif, dan skema tidak bergeser sebelum switch"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum switch"
[ "$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")" = "${BASE_SHA:0:8}" ] || die "release aktif bukan baseline"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
PENDING1="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null" | LC_ALL=C sort) || true)"
[ -z "$PENDING1" ] || die "ada migrasi tertunda pada release dir (rilis ini harus tanpa migrasi): $(printf '%s' "$PENDING1" | tr '\n' ' ')"
ok "tanpa migrasi; kandidat dan release aktif tidak bergeser"

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
[ "$NBE" = "26" ] || die "berkas backend yang diverifikasi harus tepat 26 (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date (tanpa migrasi baru)"

PHASE="8b-smoke"; say "8b. Smoke test baca-saja (milestone di backlog/work-orders/orders, papan Corner, export tanpa harga, KPI waktu, kontrak notifikasi; penulisan ditolak sebelum menyentuh data; TIDAK mengubah/mengaktifkan/menjadwalkan apa pun, TIDAK mengirim WA)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const tulis = []; // HANYA percobaan tulis (ditolak sebelum menyentuh data); export = bacaan murni (POST hanya agar daftar id dapat dikirim)
async function api(method, path, token, body, headers = {}, { write = method !== "GET" } = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  if (write) tulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status, code: json?.code ?? null });
  return { status: r.status, json };
}
const tokenUntuk = async (u) => { const roles = (await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role); return jwt.sign({ id: u.id, name: u.name, role: u.role, roles: roles.length ? roles : [u.role] }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
const FIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) {
    const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
    if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u;
  }
  return null;
}
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", FIN);
const lead = await userDengan("PRODUCTION_LEAD", FIN);
const driver = await userDengan("DRIVER", FIN);
if (!adm || !sales) { rec("akun ADMIN dan SALES murni tersedia", false, `adm=${!!adm} sales=${!!sales}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const tL = lead ? await tokenUntuk(lead) : null; const tD = driver ? await tokenUntuk(driver) : null;
const ALASAN_LEAD = "tidak ada akun PRODUCTION_LEAD murni di production; akun/token tidak dibuat atau direkayasa";
if (!lead) console.log(`  INFO  izin Production Lead tidak dapat diverifikasi: ${ALASAN_LEAD}`);
const nol = "00000000-0000-4000-8000-000000000000";
const FLOW = ["MENUNGGU_DIJEMPUT", "PENGAMBILAN", "DITERIMA_WORKSHOP", "DIPROSES", "SIAP_KIRIM", "DALAM_PENGIRIMAN", "TERKIRIM"];

// ── Backlog: tab milestone + himpunan lama ──
rec("backlog: tanpa token 401", (await api("GET", "/api/production-v2/backlog")).status === 401);
const bl = await api("GET", "/api/production-v2/backlog?pageSize=100", tA);
rec("backlog (admin) 200, default = SEMUA (himpunan lama), tiap kartu membawa status global", bl.status === 200 && bl.json?.status === "SEMUA" && (bl.json?.items ?? []).every((i) => !!i.card?.globalStatus?.key && typeof i.rencana?.action === "string"), `${bl.json?.items?.length} kartu`);
const cnt = bl.json?.counts ?? {};
rec("hitungan tab: SEMUA, MENUNGGU_DIJEMPUT, PENGAMBILAN, DITERIMA_WORKSHOP, DIPROSES", ["SEMUA", "MENUNGGU_DIJEMPUT", "PENGAMBILAN", "DITERIMA_WORKSHOP", "DIPROSES"].every((k) => Number.isInteger(cnt[k])) && cnt.SEMUA >= cnt.DITERIMA_WORKSHOP + cnt.DIPROSES, JSON.stringify(cnt));
for (const st of ["MENUNGGU_DIJEMPUT", "PENGAMBILAN", "DITERIMA_WORKSHOP", "DIPROSES"]) {
  const r = await api("GET", `/api/production-v2/backlog?status=${st}&pageSize=50`, tA);
  rec(`backlog tab ${st}: 200, status & kartu konsisten`, r.status === 200 && r.json?.status === st && r.json?.total === cnt[st] && (r.json?.items ?? []).every((i) => i.card.globalStatus.key === st), `${r.json?.total} unit`);
}
const ids = (bl.json?.items ?? []).filter((i) => i.rencana.activatable).map((i) => i.unitId);
rec("activatable HANYA pada AWAIT_ACTIVATION tanpa Run apa pun", (bl.json?.items ?? []).every((i) => !i.rencana.activatable || i.rencana.action === "AWAIT_ACTIVATION") && (ids.length ? await prisma.productionRun.count({ where: { unitId: { in: ids } } }) : 0) === 0, `${ids.length} unit`);

// ── Status global di Order Produksi, Sales (orders), pipeline ──
const wo = await api("GET", "/api/production/work-orders?globalStatus=PENGAMBILAN,DITERIMA_WORKSHOP&pageSize=20", tA);
const gc = wo.json?.globalStatusCounts ?? {};
const nUnit = await prisma.unit.count({ where: { status: { not: "CANCELLED" } } });
rec("work-orders: globalStatusCounts 7 status, jumlahnya = unit non-batal (partisi lengkap, tanpa tebakan)", wo.status === 200 && FLOW.every((k) => Number.isInteger(gc[k])) && FLOW.reduce((s, k) => s + gc[k], 0) === nUnit, JSON.stringify(gc));
rec("work-orders: tiap baris membawa globalStatus + dasar bukti + status jadwal", (wo.json?.units ?? []).every((u) => u.globalStatus?.key && "receivedBasis" in u && u.scheduleStatus?.key));
const od = await api("GET", "/api/orders?limit=40", tA);
let ordSalah = 0; let ordCampur = 0;
for (const o of od.json?.items ?? []) {
  if (!("status" in o)) ordSalah++; // field lama tetap
  const m = o.milestone; if (!m) { ordSalah++; continue; }
  if (m.legacy) continue;
  if (m.items?.length && m.items[0].key !== m.key) ordSalah++;
  if (m.mixed) { ordCampur++; if (!/ dari \d+ unit/.test(m.summary || "")) ordSalah++; }
}
rec("orders: milestone ada, field status lama tetap, order campuran = unit tertinggal + rincian", od.status === 200 && ordSalah === 0, `${od.json?.items?.length} order; ${ordCampur} campuran`);
rec("orders: SALES tidak kehilangan akses (200)", (await api("GET", "/api/orders?limit=5", tS)).status === 200);

// ── Corner: papan baca + command PIC (ditolak sebelum data) ──
rec("corner-board: tanpa token 401", (await api("GET", "/api/production-v2/corner-board")).status === 401);
const cbA = await api("GET", "/api/production-v2/corner-board", tA);
rec("corner-board (admin) 200: 4 kelompok, izin pengalihan + hambatan dari server, tanpa urutan/kapasitas/target Corner",
  cbA.status === 200 && cbA.json?.groups?.map((g) => g.key).join(",") === "MENUNGGU_PRASYARAT,SIAP_CORNER,SEDANG_DIKERJAKAN,SELESAI"
    && cbA.json.groups.flatMap((g) => g.items).every((i) => typeof i.assign?.allowed === "boolean" && Array.isArray(i.blockers)) && !/cornerSequence|cornerCapacity|cornerTarget/.test(JSON.stringify(cbA.json)),
  cbA.json?.groups?.map((g) => g.count).join("/"));
rec("corner-board (Sales) 200 hanya-baca", (await api("GET", "/api/production-v2/corner-board", tS)).status === 200);
if (tD) rec("corner-board (Driver) 403", (await api("GET", "/api/production-v2/corner-board", tD)).status === 403); else skip("corner-board (Driver) 403", "tidak ada akun DRIVER murni");
const cornerBody = { operatorId: nol, expectedRevision: 1 };
const kunci = (n) => ({ "Idempotency-Key": `smoke-mcx-${n}-0000000` });
await api("POST", `/api/production-v2/runs/${nol}/corner-operator`, null, cornerBody, kunci("anon"));
await api("POST", `/api/production-v2/runs/${nol}/corner-operator`, tS, cornerBody, kunci("sales"));
await api("POST", `/api/production-v2/runs/${nol}/corner-operator`, tA, cornerBody); // tanpa Idempotency-Key -> 400 sebelum DB
if (tD) await api("POST", `/api/production-v2/runs/${nol}/corner-operator`, tD, cornerBody, kunci("driver"));
const SAH = new Set([400, 401, 403]);
const TULIS_DIHARAPKAN = tD ? 4 : 3;
rec(`command PIC Corner: ${tulis.length} percobaan tulis ditolak sebelum menyentuh data (hanya 400/401/403; route ada + izin ditegakkan)`, tulis.length === TULIS_DIHARAPKAN && tulis.every((x) => SAH.has(x.status)) && tulis[1]?.status === 403, tulis.map((x) => `${x.n}=${x.status}`).join("; "));
rec("command PIC Corner tanpa izin penugasan (Sales) = 403 (bukan 404: route terpasang)", tulis[1]?.status === 403 && tulis[1]?.code !== "NOT_FOUND");

// ── Export Rencana: tanpa harga untuk peran selain Admin/Owner; bacaan murni ──
const EXP = "/api/production-v2/rencana/export";
const xa = await api("POST", EXP, tA, { includeUnscheduled: true }, {}, { write: false });
rec("export (admin, tanpa 'Sertakan nilai order'): 200, 26 kolom, tanpa kolom/field harga", xa.status === 200 && xa.json?.columns?.length === 26 && !JSON.stringify(xa.json).includes("nilaiOrder") && xa.json?.meta?.includeValue === false && /^Target-Produksi-\d{2}-\w+-\d{4}\.xlsx$/.test(xa.json?.meta?.fileName ?? ""), `${xa.json?.rows?.length} baris; ${xa.json?.meta?.fileName}`);
const xs = await api("POST", EXP, tS, { includeValue: true }, {}, { write: false });
rec("export (Sales) meminta nilai order = 403 EXPORT_VALUE_FORBIDDEN", xs.status === 403 && xs.json?.code === "EXPORT_VALUE_FORBIDDEN" && !JSON.stringify(xs.json).includes("nilaiOrder"));
const xs2 = await api("POST", EXP, tS, {}, {}, { write: false });
rec("export (Sales) biasa: tanpa data harga", xs2.status === 200 && !JSON.stringify(xs2.json).includes("nilaiOrder") && xs2.json?.columns?.length === 26);
if (tL) { const xl = await api("POST", EXP, tL, { includeValue: true }, {}, { write: false }); rec("export (Production Lead) meminta nilai order = 403", xl.status === 403); } else skip("export (Production Lead) meminta nilai order = 403", ALASAN_LEAD);
rec("export: tanpa token 401", (await api("POST", EXP, null, {}, {}, { write: false })).status === 401);
rec("export: rentang >62 hari ditolak 400", (await api("POST", EXP, tA, { from: "2026-01-01", to: "2026-12-31" }, {}, { write: false })).status === 400);

// ── KPI waktu alur ──
const rep = await api("GET", "/api/production-v2/reports/milestone-durations", tA);
rec("laporan durasi milestone (admin) 200: 6 durasi, tanpa timestamp dikarang", rep.status === 200 && (rep.json?.readerMode === "OFF" || (rep.json?.durations?.length === 6 && rep.json.durations.every((d) => d.n + d.missing >= 0))), rep.json?.durations?.map((d) => `${d.key}:${d.n}/${d.missing}`).join(" ") ?? rep.json?.readerMode);
rec("laporan durasi milestone (Sales) 403", (await api("GET", "/api/production-v2/reports/milestone-durations", tS)).status === 403);
const flagRow = await prisma.v2FeatureFlag.findUnique({ where: { key: "production_v2_reader" } }).catch(() => null);
const cohortUnit = flagRow?.enabled ? (flagRow.config?.unitIds ?? [])[0] : null;
if (cohortUnit) { const ov = await api("GET", `/api/production-v2/units/${cohortUnit}/overview`, tA); rec("Unit 360 (unit cohort): status global + empat sumbu + 6 durasi 'Waktu alur'", ov.status === 200 && ov.json?.identity?.globalStatus?.key && ov.json?.timeline?.durations?.length === 6, `${ov.json?.identity?.globalStatus?.label}`); }
else skip("Unit 360: timeline + status global", "tidak ada unit di cohort reader");

// ── Kontrak notifikasi + penulis rencana (sumber di container, baca-saja) ──
const src = (p) => readFileSync(process.cwd() + "/src/" + p, "utf8");
rec("notifikasi: DELIVERY_NOTIF_AKTIF tetap false", /const DELIVERY_NOTIF_AKTIF = false;/.test(src("services/customerNotifications.js")));
rec("notifikasi: pickup selesai (armada /complete) TIDAK memanggil notifyUnitReceived", !/\bnotifyUnitReceived\(/.test(src("routes/armada.js")) && /owned\.type !== "PICKUP"\) notifyDelivered/.test(src("routes/armada.js")));
const cust = src("services/unitCustodyCommandService.js");
rec("penerimaan workshop: event outbox idempoten (dedupeKey unik) + hook sekali per transisi (bukan replay)", /unit-received-workshop:\$\{handoff\.id\}/.test(cust) && /if \(!result \|\| result\.replayed/.test(cust));
const pc = src("services/productionCornerService.js"); const pl = src("services/productionPlanningCommandService.js");
rec("PIC Corner: hanya cornerOperatorId (+revisi, commandId) lewat penulis command owner; tanpa penulisan rencana lain", /data: \{ cornerOperatorId, revision, commandId \}/.test(pl) && !/\.productionRunPlan\.(update|updateMany|create|upsert|delete)/.test(pc) && /writeCornerOperatorInTx\(tx/.test(pc));
rec("PIC Corner: menolak pekerjaan Corner yang sudah berjalan (CORNER_WORK_STARTED)", /CORNER_WORK_STARTED/.test(src("lib/domain/productionCornerBoard.js")) && /canReassignCorner\(/.test(pc));
// fungsi murni di container
const M = await import(pathToFileURL(process.cwd() + "/src/lib/domain/workshopMilestone.js").href);
const CB = await import(pathToFileURL(process.cwd() + "/src/lib/domain/productionCornerBoard.js").href);
const K = await import(pathToFileURL(process.cwd() + "/src/lib/domain/workshopKpi.js").href);
rec("domain di container: pickup selesai tanpa bukti ≠ Diterima; bukti custody = Diterima; mulai = Diproses; order campuran = unit tertinggal",
  M.globalStatusOf({ unitStatus: "RECEIVED", pickupCompleted: true }).key === "PENGAMBILAN" && M.globalStatusOf({ unitStatus: "RECEIVED", receivedBasis: "CUSTODY" }).key === "DITERIMA_WORKSHOP"
  && M.globalStatusOf({ unitStatus: "RECEIVED", receivedBasis: "CUSTODY", started: true }).key === "DIPROSES" && M.orderRollupOf([{ key: "DIPROSES" }, { key: "DITERIMA_WORKSHOP" }, { key: "TERKIRIM" }]).summary === "Diterima di Workshop · 1 dari 3 unit");
rec("domain di container: Corner tidak berlaku bukan pekerjaan Corner; pekerjaan berjalan tidak dialihkan; durasi tanpa data = 'Data waktu belum tersedia'",
  CB.cornerGroupOf("TIDAK_BERLAKU") === null && CB.canReassignCorner({ cornerStatus: "DIKERJAKAN", buildTrack: true, cornerRequired: true, runStatus: "ACTIVE", planStatus: "PLANNED", hasPlan: true }).code === "CORNER_WORK_STARTED"
  && K.timelineOf({}).durations.every((d) => d.text === "Data waktu belum tersedia"));
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal, ${dilewati} dilewati (SKIP)`);
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
process.exit(fail ? 1 : 0);
NODE
SMOKE_SKIP="$(sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p' "$BK_DIR/smoke.log" | tail -n 1)"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL (jangan anggap lulus)"
if [ "$SMOKE_SKIP" = "0" ]; then
  ok "smoke test lulus (tab milestone + himpunan lama, work-orders/orders/pipeline membawa status global, papan Corner 4 kelompok, command PIC Corner ditolak sebelum data, export tanpa harga + 403 nilai order untuk non-Admin/Owner, KPI waktu, kontrak notifikasi/penulis rencana di container)"
else
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di log; izin Production Lead TIDAK terverifikasi di production bila tidak ada akun PRODUCTION_LEAD murni (tidak ada akun/token dibuat). Ini BUKAN klaim lulus."
fi
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
# BUKTI AKHIR: sidik jari pada T0 yang SAMA harus identik sebelum vs sesudah (jurnal, saldo, stok, PO, penerimaan, faktur, pembayaran, flag, migrasi).
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$VERIF_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/verif-sesudah.txt" || die "sidik jari penuh sesudah gagal"
diff "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-sesudah.txt" >/dev/null || { diff "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-sesudah.txt" || true; die "sidik jari penuh BERUBAH selama rilis (jurnal/stok/tagihan/GR) — periksa dengan backup"; }
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$FP_BEKU_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/data-sesudah.txt" || die "sidik jari dokumen beku sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "dokumen PEMBANDING beku BERUBAH selama rilis"; }
ok "sidik jari IDENTIK sebelum vs sesudah pada T0=${T0}: 36 kunci penuh (jurnal+baris+saldo, stok, PO, penerimaan, faktur, pembayaran, flag, migrasi, Run, rencana, PIC meja, riwayat jadwal, handoff, operator, setting, pemetaan) dan 8 kelompok beku — rilis TIDAK mengubah data"
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
say "SELESAI — rilis ${DEPLOY_SHORT} aktif (kode saja; tidak ada flag/cohort/setting/operator/pemetaan/Run/rencana diubah; tidak ada WA dikirim). Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
