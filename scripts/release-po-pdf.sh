#!/usr/bin/env bash
# RILIS PDF PURCHASE ORDER: web + backend, TANPA migrasi — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). Diturunkan dari release-po-pdf.sh.
# Perubahan: komponen dokumen PDF bersama (invoicePdf.js memakainya, tampilan invoice dikunci tes snapshot), PDF Purchase Order (GET /api/finance/purchase-orders/:id/pdf, finance:read, murni baca), tombol PDF di detail PO.
# Sebelum switch: backup + validasi gzip + RESTORE ke DB sementara. Verifikasi pasca-rilis HANYA baca: TIDAK membuat PO/transaksi QA di produksi.
#
#   cat scripts/release-po-pdf.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/ppd.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/ppd.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/ppd.sh <DEPLOY_SHA_40> <BASE_SHA_40>'
#
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/finance-po-pdf}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (16 berkas: komponen PDF, PDF PO, rute PO, tombol PDF, tes, skrip). Production/Delivery/MCP/prisma/package tidak boleh ikut.
ALLOWED_RE='^(backend/src/routes/purchaseOrders\.js|backend/src/services/documentPdf\.js|backend/src/services/finance/purchaseOrderDocument\.js|backend/src/services/invoicePdf\.js|backend/src/services/purchaseOrderPdf\.js|backend/tests/fixtures/invoicePdfGolden\.json|backend/tests/fixtures/invoicePdfNormalisasi\.js|backend/tests/fixtures/invoicePdfViews\.js|backend/tests/fixtures/poPdfViews\.js|backend/tests/integration/purchaseOrderPdf\.integration\.test\.js|backend/tests/invoicePdfSnapshot\.test\.js|backend/tests/purchaseOrderPdf\.test\.js|frontend/src/api\.js|frontend/src/pages/finance/FinancePurchaseOrders\.jsx|frontend/tests/purchaseOrderUI\.test\.js|scripts/release-po-pdf\.sh)$'
BACKEND_SRC_CHANGED_RE='^backend/src/'
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
BK_DIR="$HOME/release-backups/ppd-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
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
Setelah switch bermasalah:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Rilis ini TIDAK punya migrasi dan TIDAK mengubah data: rollback kode tidak membutuhkan pemulihan database.
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
exec 9>/tmp/release-po-pdf.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rpk\|rpm\|rpl\|rbr\|rpo\|ppd\|release-penjualan-karyawan\|release-bank-rekon\|release-po-bahan-baku\|release-po-pdf\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, dan batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
# EXTRA_ALLOWED_RE (opsional, per-rilis): pola berkas TAMBAHAN di luar area Finance yang MEMANG diubah rilis ini dengan persetujuan Owner (mis. laporan Sales).
# Tetap ketat: berkas Production/Delivery/Inbox tidak boleh masuk pola ini; semua berkas di luar allowlist + pola tambahan = berhenti.
ALLOWED_ALL="$ALLOWED_RE"; [ -z "${EXTRA_ALLOWED_RE:-}" ] || ALLOWED_ALL="${ALLOWED_RE}|${EXTRA_ALLOWED_RE}"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_ALL" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR area Finance yang berbeda dari baseline (Production/Delivery/Inbox/schema/migration?) — berhenti"; }
# Kode sumber backend yang berubah HARUS tepat enam berkas (komponen bersama, invoicePdf, PDF PO, view PO, rute PO); tidak ada yang lain.
[ "$(printf '%s\n' "$CHANGED" | grep -E "$BACKEND_SRC_CHANGED_RE" | LC_ALL=C sort | tr '\n' ' ')" = "backend/src/routes/purchaseOrders.js backend/src/services/documentPdf.js backend/src/services/finance/purchaseOrderDocument.js backend/src/services/invoicePdf.js backend/src/services/purchaseOrderPdf.js " ] || { printf '%s\n' "$CHANGED" | grep -E "$BACKEND_SRC_CHANGED_RE"; die "berkas backend/src yang berubah bukan tepat lima berkas PDF/PO yang diaudit"; }
! printf '%s\n' "$CHANGED" | grep -qE '^backend/prisma/|package(-lock)?\.json$' || die "prisma/dependensi berubah — rilis ini harus TANPA migrasi dan TANPA dependensi baru"
# Aset PDF (font, logo) TIDAK boleh berubah: PDF invoice produksi dan PO memakai berkas yang sama persis.
[ -z "$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" -- backend/assets)" ] || die "backend/assets (logo/font) berubah — tidak diizinkan"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit; tanpa prisma/dependensi/aset; backend/src tepat 5 berkas PDF/PO"

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
GATE_SEBELUM="$(psql_live -At -c "select coalesce((select value from fin_settings where key='klaim_lunas_gate_aktif'),'false')")"
LAPDIV_SEBELUM="$(psql_live -At -c "select coalesce((select value from fin_settings where key='laporan_divisi_aktif'),'')")"
STAFF_SEBELUM="$(psql_live -At -c "select count(*) from \"Order\" where staff_seller_id is not null")"
ok "order bertanda Penjualan Karyawan sebelum rilis = ${STAFF_SEBELUM} (harus tidak berubah)"
ok "sakelar klaim_lunas_gate_aktif sebelum rilis = ${GATE_SEBELUM} (harus tidak berubah); laporan_divisi_aktif = '${LAPDIV_SEBELUM:-<belum ada>}'"
SNAP_SQL="select 'order_status', count(*), md5(coalesce(string_agg(x.id::text||x.\"paymentStatus\"::text||coalesce(x.paid_at::text,''), '|' order by x.id),'')) from \"Order\" x union all select 'alokasi', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from fin_payment_allocations x union all select 'verifikasi', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from payment_verifications x union all select 'pengaturan_bool', count(*), md5(coalesce(string_agg(x.key||'='||x.value, '|' order by x.key),'')) from fin_settings x where x.key in ('payment_verification_gate','payment_verification_gate_since','resi_pembayaran_aktif','resi_input_aktif','klaim_lunas_gate_aktif','bank_reconciliation_v2_active') union all select 'jurnal_hash_penuh', count(*), md5(coalesce(string_agg(e.id::text||e.entry_number||e.date::text||e.status::text||e.created_at::text||l.id::text||l.account_id::text||l.debit::text||l.credit::text||coalesce(l.cash_account_id::text,''), '|' order by l.id),'')) from fin_journal_entries e join fin_journal_lines l on l.entry_id=e.id union all select 'rekening_kas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_cash_accounts x union all select 'jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from fin_journal_entries x union all select 'baris_jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.debit::text||x.credit::text, '|' order by x.id),'')) from fin_journal_lines x union all select 'payment', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from payments x union all select 'flag_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from v2_feature_flags x union all select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text||coalesce(x.unit_cost::text,'')||x.material_id::text||x.type::text, '|' order by x.id),'')) from stock_movements x union all select 'penerimaan', count(*), md5(coalesce(string_agg(x.id::text||x.receipt_number||x.status::text||coalesce(x.supplier,''), '|' order by x.id),'')) from goods_receipts x union all select 'penerimaan_baris', count(*), md5(coalesce(string_agg(x.id::text||coalesce(x.received_qty::text,'')||coalesce(x.accepted_qty::text,'')||x.material_id::text, '|' order by x.id),'')) from goods_receipt_lines x union all select 'tagihan_supplier', count(*), md5(coalesce(string_agg(x.id::text||x.bill_number||x.status::text||x.amount::text||coalesce(x.goods_receipt_id::text,'')||coalesce(x.bill_type,''), '|' order by x.id),'')) from fin_supplier_bills x union all select 'bayar_supplier', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text||coalesce(x.cancelled_at::text,''), '|' order by x.id),'')) from fin_supplier_payments x union all select 'alokasi_bayar_supplier', count(*), md5(coalesce(string_agg(x.id::text||x.bill_id::text||x.amount::text, '|' order by x.id),'')) from fin_supplier_payment_allocations x union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(a.account_id::text||':'||a.d::text||':'||a.k::text, '|' order by a.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) k from fin_journal_lines l group by l.account_id) a"
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/data-sebelum.txt" || die "snapshot data sebelum gagal"
ok "snapshot data sebelum tersimpan ($(wc -l < "$BK_DIR/data-sebelum.txt") baris)"
SNAP2_SQL="select 'jurnal', count(*), md5(coalesce(string_agg(e.id::text||e.status::text||e.entry_number, '|' order by e.id),'')) from fin_journal_entries e union all select 'baris_jurnal_saldo', count(*), md5(coalesce(string_agg(l.id::text||l.debit::text||l.credit::text||l.account_id::text||coalesce(l.order_id,'')||coalesce(l.cash_account_id::text,''), '|' order by l.id),'')) from fin_journal_lines l union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(t.k||t.s, '|' order by t.k),'')) from (select a.code as k, sum(l.debit-l.credit)::text as s from fin_journal_lines l join fin_accounts a on a.id=l.account_id join fin_journal_entries e on e.id=l.entry_id where e.status in ('POSTED','REVERSED') group by a.code) t union all select 'saldo_per_rekening', count(*), md5(coalesce(string_agg(t.k||t.s, '|' order by t.k),'')) from (select c.name as k, sum(l.debit-l.credit)::text as s from fin_journal_lines l join fin_cash_accounts c on c.id=l.cash_account_id join fin_journal_entries e on e.id=l.entry_id where e.status in ('POSTED','REVERSED') group by c.name) t union all select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text||coalesce(x.unit_cost::text,'')||x.material_id::text||x.type::text, '|' order by x.id),'')) from stock_movements x union all select 'tagihan_supplier', count(*), md5(coalesce(string_agg(b.id::text||b.status::text||b.amount::text||coalesce(b.due_date::text,'')||coalesce(b.term_type,'')||coalesce(b.scheduled_pay_date::text,''), '|' order by b.id),'')) from fin_supplier_bills b union all select 'po', count(*), md5(coalesce(string_agg(p.id::text||p.status::text||coalesce(p.term_type,'')||p.updated_at::text, '|' order by p.id),'')) from fin_purchase_orders p union all select 'po_event', count(*), md5(coalesce(string_agg(p.id::text, '|' order by p.id),'')) from fin_purchase_order_events p union all select 'bayar_supplier', count(*), md5(coalesce(string_agg(p.id::text||p.amount::text||coalesce(p.cancelled_at::text,''), '|' order by p.id),'')) from fin_supplier_payments p union all select 'payment', count(*), md5(coalesce(string_agg(p.id::text||p.amount::text||coalesce(p.cancelled_at::text,''), '|' order by p.id),'')) from payments p union all select 'order', count(*), md5(coalesce(string_agg(o.id||o.status::text||o.\"paymentStatus\"::text||coalesce(o.paid_at::text,''), '|' order by o.id),'')) from \"Order\" o union all select 'flag_v2', count(*), md5(coalesce(string_agg(f.key||f.enabled::text||f.config::text, '|' order by f.key),'')) from v2_feature_flags f union all select 'fin_settings', count(*), md5(coalesce(string_agg(f.key||f.value, '|' order by f.key),'')) from fin_settings f union all select 'production_settings', count(*), md5(coalesce(string_agg(f::text, '|' order by f::text),'')) from production_settings f"
psql_live -At -c "$SNAP2_SQL" > "$BK_DIR/snap2-sebelum.txt" || die "snapshot diperluas sebelum gagal"
SISA_UTANG_SEBELUM="$(psql_live -At -c "select coalesce(sum(b.amount - coalesce((select sum(a.amount) from fin_supplier_payment_allocations a join fin_supplier_payments p on p.id=a.payment_id where a.bill_id=b.id and p.cancelled_at is null),0)),0)::numeric(18,2) from fin_supplier_bills b where b.status in ('DISETUJUI','DIBAYAR_SEBAGIAN')")"
PO_SEBELUM="$(psql_live -At -c "select count(*) from fin_purchase_orders")"
ok "snapshot diperluas tersimpan ($(wc -l < "$BK_DIR/snap2-sebelum.txt") baris): jurnal, saldo per akun & rekening, stok, tagihan, PO, pembayaran, order, flag; sisa utang aktif=${SISA_UTANG_SEBELUM}; PO=${PO_SEBELUM}"

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
BACKUP_FILE="$HOME/backups/pre-ppd-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

PHASE="3b-restore"; say "3b. Validasi restore: pulihkan backup NYATA ke DB sementara dan cocokkan jumlah baris (DB produksi tidak disentuh)"
REH_DB="rehearsal_ppd_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
# Produksi hidup: transaksi sah bisa masuk antara backup dan pembandingan — toleransi HANYA penambahan (produksi >= restore, selisih kecil); data lama harus ada semua.
for T in fin_journal_entries fin_journal_lines payments fin_accounts fin_cash_accounts stock_movements fin_supplier_bills fin_supplier_payments fin_purchase_orders; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$B" -le "$A" ] && [ "$(( A - B ))" -le 25 ] || { reh_drop; die "restore tidak cocok untuk $T (produksi=$A restore=$B)"; }
  [ "$A" = "$B" ] && echo "  = $T $A" || echo "  ~ $T produksi=$A restore=$B (transaksi sah masuk sesudah backup)"
done
[ "$(RPSQL "select count(*) from _prisma_migrations")" = "$(psql_live -At -c "select count(*) from _prisma_migrations")" ] || { reh_drop; die "jumlah migrasi pada restore berbeda"; }
reh_drop
ok "restore backup ke DB sementara berhasil: tabel kunci cocok (selisih hanya transaksi baru sesudah backup); DB sementara dihapus"

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
for s1 in "Ajukan Klaim Lunas" "Ajukan Pembayaran DP" "Laporan Biaya Divisi" "Kenapa angka Finance dan Sales berbeda?" "Isi Diagnosis" "Sales per Stage" "Rencana Produksi" "Status Produksi"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN fitur live: $s1"; done
for s2 in "Mutasi & Rekonsiliasi" "Impor rekening koran" "Cocokkan otomatis" "Selisih belum dijelaskan" "Penyelesaian periode" "Pencocokan & pengecualian aktif" "Pengecualian Tanggal Lunas" "Penjualan Karyawan (di luar tim Sales)" "Catat Penjualan Karyawan" "Ajukan Klaim Lunas" "Laporan Biaya Divisi"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur: $s2"; done
for s3 in "Jadwal & Aging" "Total Utang Aktif" "Tanggal jatuh tempo" "Ganti termin" "Tanpa Jatuh Tempo"; do [ -n "$(grep -lF "$s3" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur termin/aging: $s3"; done
if [ "$NEW_INDEX" = "$PREV_INDEX" ]; then
  # Boleh identik HANYA bila kandidat tidak mengubah berkas frontend (rilis backend saja).
  ! sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | grep -q '^frontend/' || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
  ok "dist identik (${NEW_INDEX}) — wajar: rilis ini tidak mengubah frontend"
else
  ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX})"
fi

PHASE="4c-aset-lama"; say "4c. Bawa aset ber-hash dari dist release aktif (tab terbuka saat deploy tetap bisa memuat chunk lama)"
OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"
BARU_ASSETS="$BK_DIR/aset-baru.txt"; ls -1 "$NEW_DIR/frontend/dist/assets" | LC_ALL=C sort > "$BARU_ASSETS"
n=0
for f in "$PREV_DIR"/frontend/dist/assets/*; do
  [ -f "$f" ] || continue; b="$(basename "$f")"
  # Nama = hash isi: berkas dengan nama sama PASTI identik, jadi tidak pernah ditimpa; hanya yang BELUM ada yang dibawa (mtime asli dipertahankan untuk pemangkasan).
  [ -e "$NEW_DIR/frontend/dist/assets/$b" ] && continue
  cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b" && { printf '%s\n' "$b" >> "$OLD_ASSETS"; n=$((n+1)); }
done
# Pangkas bawaan yang sudah > 21 hari (umur dari mtime build aslinya) supaya tidak menumpuk dari rilis ke rilis. Berkas build BARU selalu segar, tidak ikut terpangkas.
find "$NEW_DIR/frontend/dist/assets" -type f -mtime +21 -delete
ok "${n} aset lama dibawa ke dist baru; index.html baru tetap hanya merujuk aset baru"
[ -n "$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "index/bundel baru rusak setelah membawa aset lama"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-ppd-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"
MIG_SEBELUM="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
ok "migrasi terpasang sebelum rilis = ${MIG_SEBELUM} (rilis ini TANPA migrasi; harus tidak berubah)"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali; tanpa migrasi)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru (${NEW_INDEX})"; ok "bundel web publik = dist baru ${NEW_INDEX} (lama ${PREV_INDEX})"
# Bundel baru benar-benar memuat tombol PDF PO.
for s3 in "Pratinjau PDF" "Unduh PDF" "Gagal membuat PDF Purchase Order"; do [ -n "$(grep -lF "$s3" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur PDF PO: $s3"; done
ok "dist baru memuat tombol Pratinjau/Unduh PDF PO"
NBE=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in backend/src/*) ;; *) continue;; esac
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
  NBE=$((NBE+1))
done <<< "$CHANGED"
[ "$NBE" -eq 5 ] || die "berkas backend yang diverifikasi harus tepat 5 (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
# Logo dan font PDF di container IDENTIK dengan baseline (invoice produksi memakai berkas yang sama persis dengan PO).
for a in logo-invoice-blue.png fonts/Inter-Regular.woff fonts/Inter-Medium.woff fonts/PlusJakartaSans-Bold.woff fonts/PlusJakartaSans-ExtraBold.woff fonts/fa-solid-900.ttf; do
  want="$(sg show "${BASE_SHA}:backend/assets/${a}" | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/assets/${a}" | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "aset PDF ${a} di container BERBEDA dari baseline"
done
ok "logo + 5 font PDF di container identik dengan baseline (invoice & PO memakai berkas yang sama)"

PHASE="8b-smoke"; say "8b. Smoke test izin + PDF (baca-saja; TIDAK membuat PO/transaksi QA di produksi)"
sg show "${DEPLOY_SHA}:backend/tests/fixtures/invoicePdfViews.js" | tr -d '\r' > "$BK_DIR/fx-views.js"
sg show "${DEPLOY_SHA}:backend/tests/fixtures/invoicePdfNormalisasi.js" | tr -d '\r' > "$BK_DIR/fx-norm.js"
sg show "${DEPLOY_SHA}:backend/tests/fixtures/invoicePdfGolden.json" | tr -d '\r' > "$BK_DIR/fx-golden.json"
for f in fx-views.js fx-norm.js fx-golden.json; do docker exec -i "$CID_NEW" sh -c "mkdir -p /tmp/fx && cat > /tmp/fx/${f}" < "$BK_DIR/$f"; done
docker exec "$CID_NEW" sh -c 'cd /tmp/fx && mv fx-views.js invoicePdfViews.js && mv fx-norm.js invoicePdfNormalisasi.js && mv fx-golden.json invoicePdfGolden.json && echo "{\"type\":\"module\"}" > package.json'
dcp "$NEW_DIR" exec -T -e TANPA_PO="$PO_SEBELUM" backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PDFParse } = require("pdf-parse");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function api(method, path, token, base = BASE) {
  const r = await fetch(base + path, { method, headers: token ? { Authorization: "Bearer " + token } : {} });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers: r.headers, buf };
}
const tokenUntuk = async (user) => {
  const roles = (await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } })).map((r) => r.role);
  return jwt.sign({ id: user.id, name: user.name, role: user.role, roles: roles.length ? roles : [user.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });
};
const FIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]);
async function userMurni(role) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) {
    const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
    if (rs.has(role) && ![...rs].some((r) => FIN.has(r))) return u;
  }
  return null;
}
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
const sales = await userMurni("SALES"), prod = await userMurni("PRODUCTION_LEAD"), gudang = await userMurni("WAREHOUSE");
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const tP = prod ? await tokenUntuk(prod) : null, tG = gudang ? await tokenUntuk(gudang) : null;
const nol = "00000000-0000-4000-8000-000000000000";
const cacah = async () => [await prisma.finJournalEntry.count(), await prisma.finJournalLine.count(), await prisma.finSupplierPayment.count(), await prisma.payment.count(), await prisma.stockMovement.count(), await prisma.finSupplierBill.count(), await prisma.finPurchaseOrder.count(), await prisma.finPurchaseOrderEvent.count(), await prisma.goodsReceipt.count(), await prisma.activityEvent.count()];
const sebelum = await cacah();

// 1. Izin endpoint PDF
rec("PDF PO: tanpa token (lokal) -> 401", (await api("GET", `/api/finance/purchase-orders/${nol}/pdf`)).status === 401);
rec("PDF PO: tanpa token (domain publik) -> 401", (await api("GET", `/api/finance/purchase-orders/${nol}/pdf`, null, "https://app.sanomatrassehat.com")).status === 401);
for (const [nama, t] of [["SALES", tS], ["PRODUCTION_LEAD", tP], ["WAREHOUSE", tG]]) {
  if (!t) { console.log(`  INFO  tidak ada akun ${nama} murni — dilewati`); continue; }
  rec(`PDF PO: ${nama} -> 403`, (await api("GET", `/api/finance/purchase-orders/${nol}/pdf`, t)).status === 403);
}
rec("PDF PO: id tak dikenal (admin) -> 404 (rute terpasang & terjaga)", (await api("GET", `/api/finance/purchase-orders/${nol}/pdf`, tA)).status === 404);
rec("PDF PO: bukan UUID (admin) -> 404", (await api("GET", `/api/finance/purchase-orders/bukan-uuid/pdf`, tA)).status === 404);

// 2. PDF nyata dari PO yang SUDAH ADA (hanya membaca; tidak membuat PO)
const po = await prisma.finPurchaseOrder.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, poNumber: true, status: true } });
if (!po) console.log("  INFO  belum ada PO di produksi — render PDF PO nyata dilewati (PO tidak dibuat untuk uji)");
else {
  const r = await api("GET", `/api/finance/purchase-orders/${po.id}/pdf`, tA);
  rec(`PDF PO nyata ${po.poNumber} (${po.status}) -> 200 application/pdf inline`, r.status === 200 && r.headers.get("content-type") === "application/pdf" && /^inline; filename="/.test(r.headers.get("content-disposition") || ""), r.headers.get("content-disposition"));
  rec("berkas diawali %PDF-", r.buf.subarray(0, 5).toString() === "%PDF-");
  const p = new PDFParse({ data: new Uint8Array(r.buf) }); const t = (await p.getText()).text.replace(/\s+/g, " "); await p.destroy?.();
  for (const x of ["PURCHASE ORDER", po.poNumber, "DIPESAN DARI", "TERMIN PEMBAYARAN", "ALAMAT PENERIMAAN BARANG", "Pancoran Mas, Kota Depok", "TOTAL PESANAN", "CATATAN & KETENTUAN", "BUTUH BANTUAN?", "0851 8728 3900", "www.sanomatrassehat.com"]) rec(`PDF PO memuat "${x}"`, t.includes(x));
  for (const x of ["INVOICE", "DITERBITKAN UNTUK", "Garansi", "Sudah dibayar"]) rec(`PDF PO tidak memuat "${x}"`, !t.includes(x));
  rec("tiga butir Catatan & Ketentuan tampil", t.includes("Cantumkan nomor PO pada surat jalan dan faktur.") && t.includes("Hanya barang berkondisi baik yang diterima dan ditagihkan.") && t.includes("Faktur dicocokkan dengan PO; bayar sesuai termin."));
}

// 3. Invoice produksi TIDAK berubah: render lima fixture di container = golden sebelum refactor
const { renderInvoicePdf } = await import("/app/src/services/invoicePdf.js");
const { VIEWS } = await import("/tmp/fx/invoicePdfViews.js");
const { hashPdf } = await import("/tmp/fx/invoicePdfNormalisasi.js");
const golden = JSON.parse(fs.readFileSync("/tmp/fx/invoicePdfGolden.json", "utf8"));
for (const k of Object.keys(VIEWS)) rec(`invoice "${k}" di container identik dengan golden sebelum refactor`, hashPdf(await renderInvoicePdf(VIEWS[k])) === golden[k].sha256);
const { renderWarrantyPdf } = await import("/app/src/services/warrantyPdf.js");
rec("warrantyPdf (impor ikon dari invoicePdf) termuat", typeof renderWarrantyPdf === "function");

// 4. Aging = tabel (satu read-model) dan tidak ada data berubah
const ag = await api("GET", "/api/finance/utang/aging", tA);
const aj = JSON.parse(ag.buf.toString());
rec("aging utang (admin) -> 200", ag.status === 200, `${aj.baris?.length} faktur aktif; total ${aj.ringkasan?.kartu?.totalUtangAktif}`);
const sumSisa = (aj.baris ?? []).reduce((a, r) => a + r.sisaUtang, 0);
rec("kartu aging = jumlah baris", Math.abs(aj.ringkasan.kartu.totalUtangAktif - sumSisa) < 0.01);
const sesudah = await cacah();
rec("tidak ada jurnal/baris jurnal/pembayaran/stok/tagihan/PO/riwayat PO/penerimaan/aktivitas yang berubah selama smoke", sebelum.every((n, i) => n === sesudah[i]), `${sebelum.join(",")} -> ${sesudah.join(",")}`);
rec("jumlah PO tetap (tidak ada PO dibuat oleh rilis/QA)", sesudah[6] === Number(process.env.TANPA_PO), `${sesudah[6]} vs ${process.env.TANPA_PO}`);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus (izin PDF, PDF PO nyata baca-saja, invoice identik golden, tidak ada data berubah)"
docker exec "$CID_NEW" sh -c 'rm -rf /tmp/fx' >/dev/null 2>&1 || true
PHASE="8c-snapshot"; say "8c. Snapshot data diperluas: sebelum vs sesudah (jurnal, saldo akun & rekening, stok, tagihan, PO, pembayaran, order, flag)"
sleep 5
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$SNAP2_SQL" </dev/null > "$BK_DIR/snap2-sesudah.txt" || die "snapshot diperluas sesudah gagal"
if cmp -s "$BK_DIR/snap2-sebelum.txt" "$BK_DIR/snap2-sesudah.txt"; then ok "SELURUH snapshot IDENTIK: jurnal, saldo per akun & rekening, stok, tagihan supplier, PO, pembayaran, order, flag V2, fin_settings, production_settings"; else
  echo "  INFO  snapshot berbeda — rincian (transaksi pengguna sah di sela rilis harus terlihat sebagai penambahan):"; diff "$BK_DIR/snap2-sebelum.txt" "$BK_DIR/snap2-sesudah.txt" || true
  for k in flag_v2 fin_settings production_settings po po_event; do
    [ "$(awk -F'|' -v k="$k" '$1==k' "$BK_DIR/snap2-sebelum.txt")" = "$(awk -F'|' -v k="$k" '$1==k' "$BK_DIR/snap2-sesudah.txt")" ] || die "$k BERUBAH selama rilis (flag/pengaturan/PO tidak boleh berubah)"
  done
  while IFS='|' read -r kk nn _; do
    [ "$(awk -F'|' -v k="$kk" '$1==k{print $2}' "$BK_DIR/snap2-sesudah.txt")" -ge "$nn" ] || die "jumlah baris $kk BERKURANG selama rilis"
  done < "$BK_DIR/snap2-sebelum.txt"
  ok "flag, pengaturan, dan PO identik; selisih lain hanya penambahan (transaksi pengguna sah di sela rilis, tercatat di log)"
fi
# Aset lama tetap bisa diunduh publik (tab yang terbuka saat deploy): ambil satu chunk yang ada di dist lama tetapi TIDAK ada di build baru.
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
CDIR_NEW="$NEW_DIR"
dcp "$CDIR_NEW" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$SNAP_SQL" </dev/null > "$BK_DIR/data-sesudah.txt" || die "snapshot data sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "data berubah selama rilis (jurnal/payment/flag) — periksa (transaksi pengguna yang sah juga bisa menyebabkan ini)"; }
ok "jurnal, baris jurnal (saldo), payment, order, alokasi, dan flag Production V2 IDENTIK sebelum vs sesudah rilis"
# Pembersihan release lama (setelah rilis TERBUKTI sehat): tiap rilis menyalin node_modules frontend (~350 MB) — 67 folder pernah menumpuk ±19 GB dan membuat disk VPS penuh.
# Dipertahankan: 4 terbaru (mtime), release baru (NEW_DIR), release sebelumnya (PREV_DIR), dan release yang dirujuk container berjalan. Kegagalan di sini TIDAK menggagalkan rilis.
MIG_SESUDAH="$(dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null" </dev/null)"
[ "$MIG_SESUDAH" = "$MIG_SEBELUM" ] || die "jumlah migrasi berubah (${MIG_SEBELUM} -> ${MIG_SESUDAH}) padahal rilis ini tanpa migrasi"
ok "migrasi terpasang tetap ${MIG_SESUDAH} (tanpa migrasi)"
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
