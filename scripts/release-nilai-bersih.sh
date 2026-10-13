#!/usr/bin/env bash
# RILIS "NILAI BERSIH DI SEMUA LAPORAN" (Nota Kredit memengaruhi omset/komisi/target/nilai pelanggan): web + backend, TANPA migrasi, TANPA perubahan data — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Order.value tetap nilai item (kotor); semua laporan/penyajian nilai penjualan kini = Order.value − Nota Kredit AKTIF (omset, "Lunas"/komisi, target, AOV, nilai pelanggan, pipeline, promo,
#   invoice pelanggan, MCP, webhook, Intelligence/Sales-Risk). Dokumen: docs/AUDIT-NILAI-BERSIH.md. Pengaman: tes statis registri + kontrak PILIH_TAGIHAN.
# Data lama TIDAK diubah oleh rilis ini (tanpa migrasi/backfill). Satu kolom turunan Customer.orderValue pelanggan terkait nota disinkron lewat skrip TERPISAH
# (backend/scripts/sync-customer-order-value.js; dry-run default) SETELAH Owner menyetujui. Verifikasi pasca-rilis hanya BACA (tidak membuat nota/order/jurnal/unggahan).
#
#   cat scripts/release-nilai-bersih.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/nb1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/nb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/nb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/nb1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: tanpa migrasi & tanpa perubahan data → rollback kode aman kapan saja (laporan kembali memakai Order.value kotor). Customer.orderValue yang sudah disinkron tetap bersih.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/nota-kredit-nilai-bersih-sales}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/scripts/sync-customer-order-value\.js|backend/src/lib/domain/pkrUnitBaris\.js|backend/src/mcp/tools\.js|backend/src/mcp/toolsShared\.js|backend/src/routes/analytics\.js|backend/src/routes/b2b\.js|backend/src/routes/customers\.js|backend/src/routes/finance\.js|backend/src/routes/financeTransactions\.js|backend/src/routes/orders\.js|backend/src/routes/pipeline\.js|backend/src/routes/promos\.js|backend/src/routes/replyAssistant\.js|backend/src/services/attribution/cohortLoader\.js|backend/src/services/automationWebhook\.js|backend/src/services/customerOrderAggregate\.js|backend/src/services/finance/customerPaymentRead\.js|backend/src/services/finance/klaimDariChat\.js|backend/src/services/finance/klaimLunas\.js|backend/src/services/finance/notaKredit\.js|backend/src/services/finance/notaKreditPiutang\.js|backend/src/services/finance/pembayaran\.js|backend/src/services/finance/piutangDiagnosis\.js|backend/src/services/finance/rekonSalesFinance\.js|backend/src/services/finance/reports\.js|backend/src/services/finance/tagihanOrder\.js|backend/src/services/finance/transaksi\.js|backend/src/services/intelligence/index\.js|backend/src/services/intelligence/signals\.js|backend/src/services/invoice\.js|backend/src/services/invoicePdf\.js|backend/src/services/orderNilaiBersih\.js|backend/src/services/pengecualianPaidAt\.js|backend/src/services/penjualanKaryawanOrder\.js|backend/src/services/productionExperienceReadService\.js|backend/src/services/productionRencanaExportService\.js|backend/src/services/productionUnitOverviewService\.js|backend/src/services/resiPembayaran\.js|backend/src/services/salesRisk/index\.js|backend/src/services/salesRisk/signals\.js|backend/src/utils/kreditOrderPerpindahan\.js|backend/tests/integration/financePerluVerifikasi\.integration\.test\.js|backend/tests/integration/financeVerifikasiPembayaran\.integration\.test\.js|backend/tests/integration/nilaiBersihLaporan\.integration\.test\.js|backend/tests/integration/pkrUnitCrmBaris\.integration\.test\.js|backend/tests/integration/resiPembayaran\.integration\.test\.js|backend/tests/integration/setup/env\.js|backend/tests/integration/setup/testApp\.js|backend/tests/nilaiBersihRegistry\.test\.js|backend/tests/pkrUnitBaris\.test\.js|docs/AUDIT-NILAI-BERSIH\.md|docs/PKR-MULTI-UNIT-CRM\.md|frontend/src/components/customer/OrderSection\.jsx|frontend/src/components/customer360/lib/customerSignals\.js|frontend/src/components/customer360/lib/timelineAdapter\.js|frontend/src/features/finance/PiutangDetail\.jsx|frontend/src/features/inbox/components/CustomerPanel/ActiveOrderCard\.jsx|frontend/src/features/inbox/components/CustomerPanel/OrderHistoryList\.jsx|frontend/src/features/laporan/components/SalesReportTab\.jsx|frontend/src/features/orders/InvoicePanel\.jsx|frontend/src/features/orders/OrderTimelineDrawer\.jsx|frontend/src/features/orders/PkrUnitBaris\.jsx|frontend/src/features/orders/ReadinessBadge\.jsx|frontend/src/features/orders/pkrUnitLogic\.js|frontend/src/pages/Orders\.jsx|frontend/src/pages/armada/ArmadaOrders\.jsx|frontend/src/pages/b2b/B2BOrders\.jsx|frontend/src/pages/bengkel/ProductionOrders\.jsx|frontend/src/pages/finance/FinancePayments\.jsx|frontend/src/utils/format\.js|frontend/src/utils/nilaiBersih\.js|frontend/tests/nilaiBersihOrder\.test\.js|frontend/tests/pkrUnitLogic\.test\.js|scripts/release-atribusi-kohort\.sh|scripts/release-nilai-bersih\.sh)$'
BACKEND_SRC_EXPECT="backend/src/lib/domain/pkrUnitBaris.js backend/src/mcp/tools.js backend/src/mcp/toolsShared.js backend/src/routes/analytics.js backend/src/routes/b2b.js backend/src/routes/customers.js backend/src/routes/finance.js backend/src/routes/financeTransactions.js backend/src/routes/orders.js backend/src/routes/pipeline.js backend/src/routes/promos.js backend/src/routes/replyAssistant.js backend/src/services/attribution/cohortLoader.js backend/src/services/automationWebhook.js backend/src/services/customerOrderAggregate.js backend/src/services/finance/customerPaymentRead.js backend/src/services/finance/klaimDariChat.js backend/src/services/finance/klaimLunas.js backend/src/services/finance/notaKredit.js backend/src/services/finance/notaKreditPiutang.js backend/src/services/finance/pembayaran.js backend/src/services/finance/piutangDiagnosis.js backend/src/services/finance/rekonSalesFinance.js backend/src/services/finance/reports.js backend/src/services/finance/tagihanOrder.js backend/src/services/finance/transaksi.js backend/src/services/intelligence/index.js backend/src/services/intelligence/signals.js backend/src/services/invoice.js backend/src/services/invoicePdf.js backend/src/services/orderNilaiBersih.js backend/src/services/pengecualianPaidAt.js backend/src/services/penjualanKaryawanOrder.js backend/src/services/productionExperienceReadService.js backend/src/services/productionRencanaExportService.js backend/src/services/productionUnitOverviewService.js backend/src/services/resiPembayaran.js backend/src/services/salesRisk/index.js backend/src/services/salesRisk/signals.js backend/src/utils/kreditOrderPerpindahan.js"
FRONTEND_SRC_EXPECT="frontend/src/components/customer/OrderSection.jsx frontend/src/components/customer360/lib/customerSignals.js frontend/src/components/customer360/lib/timelineAdapter.js frontend/src/features/finance/PiutangDetail.jsx frontend/src/features/inbox/components/CustomerPanel/ActiveOrderCard.jsx frontend/src/features/inbox/components/CustomerPanel/OrderHistoryList.jsx frontend/src/features/laporan/components/SalesReportTab.jsx frontend/src/features/orders/InvoicePanel.jsx frontend/src/features/orders/OrderTimelineDrawer.jsx frontend/src/features/orders/PkrUnitBaris.jsx frontend/src/features/orders/ReadinessBadge.jsx frontend/src/features/orders/pkrUnitLogic.js frontend/src/pages/Orders.jsx frontend/src/pages/armada/ArmadaOrders.jsx frontend/src/pages/b2b/B2BOrders.jsx frontend/src/pages/bengkel/ProductionOrders.jsx frontend/src/pages/finance/FinancePayments.jsx frontend/src/utils/format.js frontend/src/utils/nilaiBersih.js"
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
BK_DIR="$HOME/release-backups/nilai-bersih-${DEPLOY_SHORT}-${TS}"
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
Rilis ini TIDAK punya migrasi dan TIDAK mengubah data: rollback kode aman kapan saja (angka laporan kembali kotor).
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
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
exec 9>/tmp/release-nilai-bersih.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "nb1\|release-nilai-bersih\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan"
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
# frontend/dist TIDAK boleh ikut commit: rilis ini MEMBANGUN frontend di release dir (langkah 4b). Berkas dist di kandidat = berhenti.
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -q 'production-evidence' || die "artefak foto uji ikut ter-commit (backend/data/production-evidence) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -q 'receipt-proofs' || die "artefak unggahan uji ikut ter-commit (backend/data/receipt-proofs) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)\.env' || die "berkas .env ikut ter-commit — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -qx 'backend/src/index.js' || die "backend/src/index.js berubah (dipatok tes atribusi)"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
NBE_EXPECT="$(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w)"
MIG_LIST=""
! printf '%s\n' "$CHANGED" | grep -qE '^backend/prisma/' || die "backend/prisma berubah — rilis ini TANPA migrasi/skema; berhenti"
ok "tanpa perubahan skema/migrasi (backend/prisma tidak berubah)"
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
# Prasyarat: fitur Nota Kredit sudah live (tabel + enum); rilis ini hanya mengubah cara laporan membaca nilai.
for T in fin_order_credits fin_refunds fin_journal_entries fin_journal_lines "Order" "Customer" payments; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'FinJournalSource' and e.enumlabel = 'NOTA_KREDIT_ORDER'")" = "1" ] || die "enum NOTA_KREDIT_ORDER belum ada (rilis Nota Kredit harus sudah live)"
NOTA_AKTIF_N="$(psql_live -At -c "select count(*) from fin_order_credits where status = 'AKTIF'")"
PELANGGAN_BEDA_N="$(psql_live -At -c "select count(*) from (select c.id from \"Customer\" c where exists (select 1 from \"Order\" o join fin_order_credits k on k.order_id = o.id where o.\"customerId\" = c.id) and c.\"orderValue\" <> coalesce((select sum(greatest(0, o.value - coalesce((select sum(k.amount) from fin_order_credits k where k.order_id = o.id and k.status = 'AKTIF'), 0))) from \"Order\" o where o.\"customerId\" = c.id and o.status::text <> 'CANCELLED'), 0)) x")"
for v in "$NOTA_AKTIF_N" "$PELANGGAN_BEDA_N"; do [[ "$v" =~ ^[0-9]+$ ]] || die "audit awal bukan angka: '$v'"; done
ok "prasyarat terpenuhi; nota kredit aktif=${NOTA_AKTIF_N}; pelanggan terkait nota dengan Customer.orderValue ≠ nilai bersih=${PELANGGAN_BEDA_N} (disinkron lewat skrip terpisah, bukan oleh rilis ini)"
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
SQL_GANDA="select count(*)::int from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"; BASE_GANDA="$(psql_live -At -c "$SQL_GANDA")"
for v in "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA"; do [[ "$v" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$v'"; done
printf 'BASE_TIDAK_SEIMBANG=%s BASE_GANDA=%s NOTA_AKTIF_N=%s PELANGGAN_BEDA_N=%s\n' "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA" "$NOTA_AKTIF_N" "$PELANGGAN_BEDA_N" > "$BK_DIR/garis-dasar.env"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}; refund dengan >1 jurnal berlaku = ${BASE_GANDA}"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel. Membuktikan restore identik dan migrasi tidak mengubah data lama (rilis ini tidak menambah kolom pada tabel lama).
FP_SQL="select 'fin_refunds', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_refunds x
union all select 'fin_expenses', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_expenses x
union all select 'fin_expense_categories', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_expense_categories x
union all select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x
union all select 'order', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Order\" x
union all select 'fin_journal_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_entries x
union all select 'fin_journal_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x
union all select 'fin_accounts', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_accounts x
union all select 'fin_cash_accounts', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_cash_accounts x
union all select 'fin_settings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from fin_settings x
union all select 'fin_bank_statements', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_bank_statements x
union all select 'fin_bank_statement_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_bank_statement_lines x"
FP_N=12
# DOKUMEN PEMBANDING DIBEKUKAN: hanya yang menurut aturan bisnis tidak mungkin berubah akibat rilis ini (refund & pengeluaran yang sudah DIBATALKAN/DITOLAK dan diam sebelum T0,
# baris jurnal yang dibuat sebelum T0 (append-only), saldo per akun dari jurnal itu, pembayaran lama, seluruh flag fin_settings). T0 = jam DB (UTC) 5 menit lalu. Dokumen terbuka dan transaksi baru TIDAK diperbandingkan.
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'refund_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_refunds x where x.status::text in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'pengeluaran_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_expenses x where x.status::text in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'pembayaran_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x where x.created_at < '$T0'::timestamp
union all select 'flag', count(*), md5(coalesce(string_agg(f.key || '=' || f.value, '|' order by f.key),'')) from fin_settings f
union all select 'order_lunas_beku', count(*), md5(coalesce(string_agg(x.id || ':' || x."paymentStatus"::text || ':' || coalesce(x.paid_at::text, ''), '|' order by x.id),'')) from "Order" x where x."paymentStatus"::text = 'LUNAS' and x."updatedAt" < '$T0'::timestamp
FPBEKU
)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "7" ] || die "sidik jari dokumen beku tidak 7 baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di 7 kelompok)"

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
BACKUP_FILE="$HOME/backups/pre-nilai-bersih-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/release-nilai-bersih.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
# Fitur rilis ini + fitur rilis sebelumnya (jangan sampai hilang dari bundel).
for s1 in "Potongan (Nota Kredit)" "Nilai bersih" "Unit Produksi" "Semua Status Unit" "Buat Nota Kredit" "Tanpa jurnal—sudah dicatat oleh refund" "Dampak (dihitung server)"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Gunakan bukti lama" "Lampirkan Bukti" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Penjualan & Piutang" "Katalog Item PKR" "Kirim sebagian" "Retur & Debit Note" "Rencana Produksi" "Penjualan Karyawan" "Barang Akan Datang"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
[ -z "$(grep -lF "Hitung Kas" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru memuat Hitung Kas (halamannya belum ada)"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + 9 teks fitur lama ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-nilai-bersih-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

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
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date (rilis ini tanpa migrasi baru)"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: satu definisi nilai bersih (Lunas ringkasan = rincian), izin, invarian jurnal (tidak menulis; tahan terhadap transaksi sah yang muncul saat rilis)"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e NOTA_AKTIF_N="$NOTA_AKTIF_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(path, token) {
  const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const tokenUntuk = async (u) => { const roles = (await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role); return jwt.sign({ id: u.id, name: u.name, role: u.role, roles: roles.length ? roles : [u.role] }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
const hitungSql = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const adm = (await prisma.user.findMany({ where: { active: true } })).find((u) => u.role === "ADMIN" || u.role === "OWNER");
if (!adm) { rec("akun ADMIN/OWNER tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm);
const wib = new Date(Date.now() + 7 * 3600e3);
const awal = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), 1)).toISOString().slice(0, 10);
const akhir = wib.toISOString().slice(0, 10);
const q = `from=${awal}&to=${akhir}`;

// ── izin ──
rec("laporan sales tanpa token → 401", (await api(`/api/analytics/sales-report?${q}`)).status === 401);
// ── SATU definisi: angka Lunas per sales (ringkasan) = total rincian lunas-detail (dasar komisi) ──
const sr = await api(`/api/analytics/sales-report?${q}`, tA);
rec("sales-report (admin) 200 memuat baris per sales", sr.status === 200 && Array.isArray(sr.json?.rows), String(sr.status));
let diperiksa = 0; const beda = [];
for (const r of (sr.json?.rows ?? []).filter((x) => x.userId && (x.collectedValue ?? 0) > 0).slice(0, 12)) {
  const ld = await api(`/api/analytics/sales-report/lunas-detail?userId=${r.userId}&${q}`, tA);
  diperiksa++;
  if (ld.status !== 200 || ld.json?.total !== r.collectedValue) beda.push(`${r.name}: ringkasan ${r.collectedValue} ≠ rincian ${ld.json?.total}`);
  const konsisten = (ld.json?.orders ?? []).every((o) => typeof o.value === "number" && typeof o.nilaiKotor === "number" && o.value === o.nilaiKotor - o.notaKredit);
  if (!konsisten) beda.push(`${r.name}: baris rincian tidak konsisten (value ≠ nilaiKotor − notaKredit)`);
}
rec(`ringkasan Lunas = total rincian untuk ${diperiksa} sales (satu definisi nilai bersih)`, beda.length === 0, beda.join("; "));
if (diperiksa === 0) skip("konsistensi ringkasan vs rincian", "tidak ada sales dengan Lunas > 0 pada bulan berjalan");
// ── order bernota: daftar order memuat relasi nota & nilai bersih menurut DB ──
const bernota = await prisma.$queryRawUnsafe(`select o.id, o."orderNumber", o.value, (select sum(k.amount) from fin_order_credits k where k.order_id = o.id and k.status = 'AKTIF')::bigint as nota from "Order" o where exists (select 1 from fin_order_credits k where k.order_id = o.id and k.status = 'AKTIF') limit 5`);
if (bernota.length) {
  const od = await api(`/api/orders?limit=5000`, tA);
  const peta = new Map((od.json?.items ?? []).map((x) => [x.id, x]));
  const salah = bernota.filter((b) => { const it = peta.get(b.id); if (!it) return false; return (it.orderCredits ?? []).reduce((s, c) => s + Math.round(Number(c.amount)), 0) !== Number(b.nota); });
  rec(`daftar order memuat nota kredit aktif untuk ${bernota.length} order bernota`, od.status === 200 && salah.length === 0, salah.map((s) => s.orderNumber).join(","));
} else skip("order bernota pada daftar order", "belum ada nota kredit aktif");
// ── representasi multi-unit: tiap order PKR menampilkan SEMUA unit aktifnya sebagai sub-baris (read-model = DB; tanpa order/unit baru) ──
const pkrOrder = await prisma.$queryRawUnsafe(`select o.id, o."orderNumber" as nomor, (select count(*) from units u where u.order_id = o.id and u.status::text <> 'CANCELLED')::int as n from "Order" o where o.penjualan_karyawan_id is not null and o.status::text <> 'CANCELLED' order by o."createdAt" desc limit 50`);
if (pkrOrder.length) {
  const odp = await api(`/api/orders?limit=5000`, tA);
  const petaP = new Map((odp.json?.items ?? []).map((x) => [x.id, x]));
  const salahP = pkrOrder.filter((p) => { const it = petaP.get(p.id); if (!it) return false; return (it.penjualanKaryawan?.unitBaris?.length ?? -1) !== p.n; });
  rec(`order PKR: jumlah sub-baris unit = jumlah unit aktif di DB untuk ${pkrOrder.length} order`, odp.status === 200 && salahP.length === 0, salahP.map((p) => p.nomor).join(","));
  const ganda = (odp.json?.items ?? []).filter((x) => x.penjualanKaryawan && new Set((x.penjualanKaryawan.unitBaris ?? []).map((u) => u.id)).size !== (x.penjualanKaryawan.unitBaris ?? []).length);
  rec("order PKR: Unit ID pada sub-baris unik (tanpa baris ganda)", ganda.length === 0, ganda.map((x) => x.orderNumber).join(","));
} else skip("sub-baris unit order PKR", "belum ada order Penjualan Karyawan aktif");
// ── invarian jurnal (tidak bertambah dari garis dasar) ──
const B = (k) => Number(process.env[k]);
rec(`jurnal tidak seimbang (sebelum rilis: ${B("BASE_TIDAK_SEIMBANG")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x`)) <= B("BASE_TIDAK_SEIMBANG"));
rec(`tiap refund punya paling banyak SATU jurnal berlaku (ganda sebelum rilis: ${B("BASE_GANDA")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x`)) <= B("BASE_GANDA"));
rec("tidak ada dua nota AKTIF pada refund yang sama", (await hitungSql(`select count(*)::int n from (select refund_id from fin_order_credits where status = 'AKTIF' and refund_id is not null group by refund_id having count(*) > 1) x`)) === 0);
rec(`jumlah nota aktif tidak berkurang oleh rilis (sebelum: ${B("NOTA_AKTIF_N")}; boleh bertambah bila ada nota sah selama rilis)`, (await hitungSql(`select count(*)::int n from fin_order_credits where status = 'AKTIF'`)) >= B("NOTA_AKTIF_N"));
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal, ${dilewati} dilewati (SKIP)`);
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else
  ok "smoke test lulus (satu definisi nilai bersih ringkasan = rincian, order bernota termuat, invarian jurnal)"
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
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$FP_BEKU_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/data-sesudah.txt" || die "sidik jari dokumen beku sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis — periksa dengan backup"; }
ok "dokumen pembanding beku (refund & pengeluaran final, baris jurnal, saldo per akun, pembayaran lama, flag) IDENTIK sebelum vs sesudah rilis; transaksi sah yang muncul saat rilis tidak diperbandingkan"
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
say "TINDAK LANJUT OWNER: data TIDAK berubah oleh rilis ini. Sinkron Customer.orderValue pelanggan terkait nota: docker compose exec backend node scripts/sync-customer-order-value.js (dry-run default; --apply setelah ditinjau). Koreksi order apa pun tetap manual lewat aplikasi."
