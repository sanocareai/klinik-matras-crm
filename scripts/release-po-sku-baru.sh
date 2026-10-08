#!/usr/bin/env bash
# RILIS "BUAT SKU BARU LANGSUNG DARI PURCHASE ORDER": web + backend + 1 migrasi ADITIF (20261030090000_po_sku_baru_katalog_supplier) — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA).
# Diturunkan dari release-po-sku-baru.sh. Migrasi: HANYA 11 kolom baru NULLABLE (materials, stock_movements, fin_purchase_order_lines), 2 tabel baru (fin_material_sku_origins, fin_supplier_materials),
# indeks, 6 FK, 4 CHECK — TANPA default, TANPA backfill/UPDATE/DELETE. Material, stok, jurnal, PO, penerimaan, tagihan, pembayaran yang sudah ada TIDAK berubah. Produksi: TIDAK ADA SKU/PO/penerimaan/transaksi QA;
# verifikasi hanya baca + penolakan izin.
#
#   cat scripts/release-po-sku-baru.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/sku1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/sku1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/sku1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/sku1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/finance-po-buat-sku-langsung}"
# Migrasi SKU/katalog/konversi (aditif) yang SUDAH diaudit: nama → sha256 isi (LF).
declare -a MIGRASI=("20261030090000_po_sku_baru_katalog_supplier")
declare -A MIGRASI_SHA=( ["20261030090000_po_sku_baru_katalog_supplier"]="c7a717d7844ea4ef9a956b5c3b62ef555b577e9ac688f380f7e7cfde878225ab" )
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (31 berkas). Production (Delivery/MCP/Inbox/Sales) tidak boleh ikut, kecuali 5 berkas Produksi yang MEMANG diubah
# (pemilih bahan Produksi + guard BOM) — semuanya ada di daftar ini; apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261030090000_po_sku_baru_katalog_supplier/migration\.sql|backend/prisma/schema\.prisma|backend/src/routes/finance\.js|backend/src/routes/goodsReceipt\.js|backend/src/routes/inventory\.js|backend/src/routes/materialIssue\.js|backend/src/routes/purchaseOrders\.js|backend/src/services/finance/biayaBahan\.js|backend/src/services/finance/posting/inventory\.js|backend/src/services/finance/posting/supplier\.js|backend/src/services/finance/purchaseOrder\.js|backend/src/services/finance/purchaseOrderDocument\.js|backend/src/services/finance/skuBaru\.js|backend/src/services/finance/supplierRead\.js|backend/src/services/inventoryLedger\.js|backend/src/services/productionDiagnosisCommandService\.js|backend/src/services/productionPlanningCommandService\.js|backend/src/services/purchaseOrderPdf\.js|backend/tests/integration/purchaseOrderSkuBaru\.integration\.test\.js|frontend/src/api\.js|frontend/src/features/finance/purchaseOrderLogic\.js|frontend/src/features/production/UnitV1Materials\.jsx|frontend/src/features/production/workerApp/V1Panels\.jsx|frontend/src/features/production/workerApp/workerSheets\.jsx|frontend/src/features/warehouse/components/GoodsReceiptDetailDrawer\.jsx|frontend/src/features/warehouse/components/ItemDetailDrawer\.jsx|frontend/src/pages/bengkel/ProductionMaterialUsage\.jsx|frontend/src/pages/bengkel/ProductionRencanaWorkspace\.jsx|frontend/src/pages/finance/FinancePurchaseOrders\.jsx|frontend/tests/poSkuBaruUI\.test\.js|scripts/release-po-sku-baru\.sh)$'
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
BK_DIR="$HOME/release-backups/sku-${DEPLOY_SHORT}-${TS}"
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
Migrasi SKU hanya MENAMBAH tabel baru + kolom nullable + indeks/FK/CHECK: rollback kode aman tanpa memulihkan database (kode lama mengabaikan kolom/tabel baru).
PERINGATAN rollback KODE: kode lama TIDAK mengenal konversi satuan. Bila SUDAH ada baris PO berkonversi satuan yang menunggu penerimaan (fin_purchase_order_lines.purchase_unit IS NOT NULL), JANGAN rollback kode
sebelum penerimaannya selesai — putaway kode lama akan menambah stok dalam satuan beli (bukan satuan stok). Cek: select count(*) from fin_purchase_order_lines where purchase_unit is not null;
SKU yang sudah dibuat dari PO tetap sah sebagai material biasa setelah rollback (kolom jenis/asal diabaikan kode lama).
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
exec 9>/tmp/release-po-sku-baru.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rpk\|rpm\|rpl\|rbr\|rpo\|sku1\|tau2\|release-penjualan-karyawan\|release-bank-rekon\|release-po-bahan-baku\|release-po-sku-baru\|pgrep\|node src/index.js" || true)"
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
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
# Migrasi SKU/katalog/konversi: SATU migrasi aditif (kolom nullable + 2 tabel baru + indeks/FK/CHECK) yang sudah diaudit (nama → sha256 isi LF). Pemeriksaan di bawah FAIL-CLOSED; perubahan sekecil apa pun = berhenti sampai diaudit ulang.
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
EXPECT_PRISMA="$( { printf 'backend/prisma/schema.prisma\n'; for m in "${MIGRASI[@]}"; do printf 'backend/prisma/migrations/%s/migration.sql\n' "$m"; done; } | LC_ALL=C sort)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$EXPECT_PRISMA" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat schema.prisma + migrasi SKU"; }
# Migrasi yang sudah ada di baseline TIDAK boleh diubah/dihapus (yang sudah pernah diterapkan di produksi): hanya penambahan.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
# schema.prisma: hanya penambahan baris (nol baris dihapus/diubah di model yang sudah ada)
SCHEMA_DEL="$(sg diff --numstat "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | awk '{print $2}')"
[ "$SCHEMA_DEL" = "0" ] || die "schema.prisma menghapus/mengubah ${SCHEMA_DEL} baris yang sudah ada — hanya penambahan yang diizinkan"
ALL_ISI=""
for m in "${MIGRASI[@]}"; do
  [[ "$m" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $m"
  MIGSQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${m}/migration.sql" | tr -d '\r')"
  MIG_SHA="$(printf '%s\n' "$MIGSQL" | sha256sum | cut -d' ' -f1)"
  [ "${MIGRASI_SHA[$m]}" = "$MIG_SHA" ] || die "isi migrasi ${m} BERBEDA dari yang diaudit (sha256 ${MIG_SHA}) — audit ulang lalu perbarui pin"
  ALL_ISI+="$(printf '%s\n' "$MIGSQL" | grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$' || true)"$'\n'
  ok "migrasi ${m}: sha256 cocok pin (${MIG_SHA:0:12})"
done
cat > "$BK_DIR/scan-migrasi.mjs" <<'SCANJS'
// Pemindai migrasi "SKU baru dari PO + Katalog Supplier + konversi satuan" (dijalankan di VPS oleh skrip rilis; juga dijalankan lokal terhadap berkas migrasi).
// Daftar putih per pernyataan — HANYA:
//  (a) ALTER TABLE {materials|stock_movements|fin_purchase_order_lines} yang seluruh klausanya "ADD COLUMN" nullable TANPA default/NOT NULL,
//  (b) CREATE TABLE untuk DUA tabel baru (fin_material_sku_origins, fin_supplier_materials) — tabel yang belum ada, jadi tidak ada baris lama yang tersentuh,
//  (c) CREATE [UNIQUE] INDEX hanya pada dua tabel baru itu,
//  (d) ADD CONSTRAINT ... FOREIGN KEY: satu dari fin_purchase_order_lines (SET NULL) + empat pada tabel baru,
//  (e) ADD CONSTRAINT ... CHECK pada materials / fin_purchase_order_lines / fin_supplier_materials / stock_movements.
// Tidak ada DROP/UPDATE/INSERT/DELETE/ALTER COLUMN/TRIGGER/FUNCTION/TRUNCATE.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
const rapat = (x) => x.replace(/\s+/g, " ");
const TBL_LAMA = '"(materials|stock_movements|fin_purchase_order_lines)"';
const TBL_BARU = ["fin_material_sku_origins", "fin_supplier_materials"];
const hitung = {};
const tambah = (k) => { hitung[k] = (hitung[k] ?? 0) + 1; };
const TERLARANG = /\b(DROP|UPDATE|INSERT|DELETE|TRIGGER|FUNCTION|TRUNCATE|ALTER COLUMN|RENAME)\b/i;
for (const st of stmts) {
  const r = rapat(st);
  let m;
  if ((m = new RegExp(`^ALTER TABLE ${TBL_LAMA} (ADD COLUMN .+)$`).exec(r))) {
    const klausa = m[2].split(/,\s*(?=ADD COLUMN )/);
    for (const k of klausa) {
      if (!/^ADD COLUMN "[a-z_]+" (VARCHAR\(\d+\)|INTEGER|TEXT|TIMESTAMP\(3\)|DATE|UUID|DECIMAL\(\d+,\d+\))$/.test(k.trim())) { console.error(`KLAUSA KOLOM DI LUAR DAFTAR PUTIH: ${k.slice(0, 120)}`); process.exit(1); }
    }
    tambah("kolom_alter"); hitung.kolom = (hitung.kolom ?? 0) + klausa.length; continue;
  }
  if ((m = /^CREATE TABLE "([a-z_]+)" \(/.exec(r)) && TBL_BARU.includes(m[1])) {
    if (TERLARANG.test(r) || /REFERENCES/i.test(r)) { console.error(`CREATE TABLE memuat konstruksi terlarang: ${r.slice(0, 160)}`); process.exit(1); }
    tambah("tabel_baru"); continue;
  }
  if (new RegExp(`^CREATE (UNIQUE )?INDEX "[a-z_]+" ON "(${TBL_BARU.join("|")})"\\("[a-z_]+"(, "[a-z_]+")*\\)$`).test(r)) { tambah("indeks"); continue; }
  if (/^ALTER TABLE "fin_purchase_order_lines" ADD CONSTRAINT "fin_purchase_order_lines_supplier_material_id_fkey" FOREIGN KEY \("supplier_material_id"\) REFERENCES "fin_supplier_materials"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE$/.test(r)) { tambah("fk"); continue; }
  if (new RegExp(`^ALTER TABLE "(${TBL_BARU.join("|")})" ADD CONSTRAINT "[a-z_]+_fkey" FOREIGN KEY \\("[a-z_]+"\\) REFERENCES "(materials|fin_purchase_orders|fin_suppliers)"\\("id"\\) ON DELETE (RESTRICT|SET NULL) ON UPDATE CASCADE$`).test(r)) { tambah("fk"); continue; }
  if (new RegExp(`^ALTER TABLE "(materials|fin_purchase_order_lines|fin_supplier_materials|stock_movements)" ADD CONSTRAINT "[a-z_]+_chk" CHECK \\(`).test(r) && !TERLARANG.test(r)) { tambah("check"); continue; }
  console.error(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`); process.exit(1);
}
console.log(JSON.stringify({ total: stmts.length, ...hitung }));
SCANJS
HASIL_SCAN="$(printf '%s' "$ALL_ISI" | node "$BK_DIR/scan-migrasi.mjs")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = '{"total":19,"kolom_alter":3,"kolom":11,"tabel_baru":2,"indeks":4,"fk":6,"check":4}' ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi SKU: DDL aditif (3 ALTER TABLE ADD COLUMN nullable tanpa default = 11 kolom, 2 CREATE TABLE baru, 4 indeks pada tabel baru, 6 FK, 4 CHECK); tanpa DROP/UPDATE/INSERT/DELETE/ALTER COLUMN pada tabel lama"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit + 1 migrasi aditif (SKU/katalog/konversi)"

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
SNAP_SQL="select 'order_status', count(*), md5(coalesce(string_agg(x.id::text||x.\"paymentStatus\"::text||coalesce(x.paid_at::text,''), '|' order by x.id),'')) from \"Order\" x union all select 'alokasi', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from fin_payment_allocations x union all select 'verifikasi', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from payment_verifications x union all select 'pengaturan_bool', count(*), md5(coalesce(string_agg(x.key||'='||x.value, '|' order by x.key),'')) from fin_settings x where x.key in ('payment_verification_gate','payment_verification_gate_since','resi_pembayaran_aktif','resi_input_aktif','klaim_lunas_gate_aktif','bank_reconciliation_v2_active') union all select 'jurnal_hash_penuh', count(*), md5(coalesce(string_agg(e.id::text||e.entry_number||e.date::text||e.status::text||e.created_at::text||l.id::text||l.account_id::text||l.debit::text||l.credit::text||coalesce(l.cash_account_id::text,''), '|' order by l.id),'')) from fin_journal_entries e join fin_journal_lines l on l.entry_id=e.id union all select 'rekening_kas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_cash_accounts x union all select 'jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from fin_journal_entries x union all select 'baris_jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.debit::text||x.credit::text, '|' order by x.id),'')) from fin_journal_lines x union all select 'payment', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from payments x union all select 'flag_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from v2_feature_flags x union all select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text||coalesce(x.unit_cost::text,'')||x.material_id::text||x.type::text, '|' order by x.id),'')) from stock_movements x union all select 'penerimaan', count(*), md5(coalesce(string_agg(x.id::text||x.receipt_number||x.status::text||coalesce(x.supplier,''), '|' order by x.id),'')) from goods_receipts x union all select 'penerimaan_baris', count(*), md5(coalesce(string_agg(x.id::text||coalesce(x.received_qty::text,'')||coalesce(x.accepted_qty::text,'')||x.material_id::text, '|' order by x.id),'')) from goods_receipt_lines x union all select 'tagihan_supplier', count(*), md5(coalesce(string_agg(x.id::text||x.bill_number||x.status::text||x.amount::text||coalesce(x.goods_receipt_id::text,'')||coalesce(x.bill_type,''), '|' order by x.id),'')) from fin_supplier_bills x union all select 'bayar_supplier', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text||coalesce(x.cancelled_at::text,''), '|' order by x.id),'')) from fin_supplier_payments x union all select 'alokasi_bayar_supplier', count(*), md5(coalesce(string_agg(x.id::text||x.bill_id::text||x.amount::text, '|' order by x.id),'')) from fin_supplier_payment_allocations x union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(a.account_id::text||':'||a.d::text||':'||a.k::text, '|' order by a.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) k from fin_journal_lines l group by l.account_id) a union all select 'material', count(*), md5(coalesce(string_agg(m.id::text||m.code||m.name||m.unit::text||m.active::text||coalesce(m.category::text,''), '|' order by m.id),'')) from materials m union all select 'po_baris', count(*), md5(coalesce(string_agg(x.id::text||x.material_id::text||x.qty::text||x.unit||x.unit_price::text, '|' order by x.id),'')) from fin_purchase_order_lines x union all select 'po', count(*), md5(coalesce(string_agg(x.id::text||x.status::text||x.po_number, '|' order by x.id),'')) from fin_purchase_orders x"
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/data-sebelum.txt" || die "snapshot data sebelum gagal"
ok "snapshot data sebelum tersimpan ($(wc -l < "$BK_DIR/data-sebelum.txt") baris)"

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
BACKUP_FILE="$HOME/backups/pre-sku-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Ajukan Klaim Lunas" "Ajukan Pembayaran DP" "Laporan Biaya Divisi" "Kenapa angka Finance dan Sales berbeda?" "Isi Diagnosis" "Sales per Stage" "Rencana Produksi" "Status Produksi"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN fitur live: $s1"; done
for s2 in "Mutasi & Rekonsiliasi" "Impor rekening koran" "Cocokkan otomatis" "Selisih belum dijelaskan" "Penyelesaian periode" "Pencocokan & pengecualian aktif" "Pengecualian Tanggal Lunas" "Penjualan Karyawan (di luar tim Sales)" "Catat Penjualan Karyawan" "Ajukan Klaim Lunas" "Laporan Biaya Divisi"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur: $s2"; done
for s3 in "Jadwal & Aging" "Total Utang Aktif" "Tanggal jatuh tempo" "Ganti termin" "Tanpa Jatuh Tempo" "Pratinjau PDF" "Unduh PDF"; do [ -n "$(grep -lF "$s3" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN fitur live (termin/aging/PDF PO): $s3"; done
for s4 in "Buat Barang Baru" "Barang baru — akan dibuat saat PO disimpan" "Periksa & pakai di PO" "Barang ini sudah ada di master material" "Setara dengan"; do [ -n "$(grep -lF "$s4" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur SKU dari PO: $s4"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-sku-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"
PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi SKU dengan image baru, verifikasi, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_sku_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
KUNCI_TABEL='"Order" payments fin_journal_entries fin_journal_lines fin_payment_allocations stock_movements goods_receipts goods_receipt_lines materials material_issues material_issue_lines fin_supplier_bills fin_supplier_payments fin_purchase_orders fin_supplier_bill_allocations units fin_purchase_order_lines'
for T in $KUNCI_TABEL; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$A" = "$B" ] || { reh_drop; die "restore rehearsal tidak identik untuk $T (produksi=$A restore=$B) — backup/restore bermasalah"; }
done
ok "restore nyata identik (jumlah baris) untuk 16 tabel kunci"
FP_SQL="select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text||coalesce(x.unit_cost::text,'')||x.material_id::text||x.type::text||coalesce(x.unit_id::text,'')||coalesce(x.material_issue_id::text,''), '|' order by x.id),'')) from stock_movements x union all select 'issue', count(*), md5(coalesce(string_agg(x.id::text||x.status::text||coalesce(x.unit_id::text,''), '|' order by x.id),'')) from material_issues x union all select 'issue_baris', count(*), md5(coalesce(string_agg(x.id::text||x.requested_qty::text||coalesce(x.issued_qty::text,''), '|' order by x.id),'')) from material_issue_lines x union all select 'penerimaan', count(*), md5(coalesce(string_agg(x.id::text||x.receipt_number||x.status::text, '|' order by x.id),'')) from goods_receipts x union all select 'tagihan_supplier', count(*), md5(coalesce(string_agg(x.id::text||x.bill_number||x.status::text||x.amount::text, '|' order by x.id),'')) from fin_supplier_bills x union all select 'jurnal_penuh', count(*), md5(coalesce(string_agg(l.id::text||l.entry_id::text||l.account_id::text||l.debit::text||l.credit::text, '|' order by l.id),'')) from fin_journal_lines l union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(a.account_id::text||':'||a.d::text||':'||a.k::text, '|' order by a.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) k from fin_journal_lines l group by l.account_id) a union all select 'material', count(*), md5(coalesce(string_agg(m.id::text||m.code||m.name||m.unit::text||m.active::text||coalesce(m.category::text,''), '|' order by m.id),'')) from materials m union all select 'po_baris', count(*), md5(coalesce(string_agg(x.id::text||x.material_id::text||x.qty::text||x.unit||x.unit_price::text, '|' order by x.id),'')) from fin_purchase_order_lines x"
psql_live -At -c "$FP_SQL" > "$BK_DIR/fp-prod.txt" || { reh_drop; die "sidik jari produksi gagal"; }
RPSQL "$FP_SQL" > "$BK_DIR/fp-reh-sebelum.txt" || { reh_drop; die "sidik jari rehearsal gagal"; }
cmp -s "$BK_DIR/fp-prod.txt" "$BK_DIR/fp-reh-sebelum.txt" || { diff "$BK_DIR/fp-prod.txt" "$BK_DIR/fp-reh-sebelum.txt" || true; reh_drop; die "isi hasil restore BERBEDA dari produksi (sidik jari)"; }
ok "restore nyata identik (sidik jari isi stok, Material Issue, penerimaan, tagihan, jurnal, saldo per akun, material, baris PO)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$REH_PEND" = "$(printf '%s\n' "${MIGRASI[@]}" | LC_ALL=C sort)" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat migrasi SKU: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy pada DB rehearsal GAGAL"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
KOLOM_BARU="materials.kind materials.specification materials.storage_hint materials.created_via materials.created_by stock_movements.unit_cost_exact fin_purchase_order_lines.purchase_unit fin_purchase_order_lines.conversion_factor fin_purchase_order_lines.supplier_material_id fin_purchase_order_lines.supplier_item_name fin_purchase_order_lines.supplier_sku"
for KB in $KOLOM_BARU; do
  TB="${KB%%.*}"; KL="${KB##*.}"
  [ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='$TB' and column_name='$KL' and is_nullable='YES' and column_default is null")" = "1" ] || { reh_drop; die "kolom baru $KB tidak ada / tidak nullable / punya default"; }
  [ "$(RPSQL "select count(*) from $TB where $KL is not null")" = "0" ] || { reh_drop; die "kolom baru $KB TIDAK kosong setelah migrasi (tidak boleh ada backfill)"; }
done
ok "11 kolom baru: ada, nullable, tanpa default, SELURUHNYA kosong pada semua baris lama (tanpa backfill)"
for TB in fin_material_sku_origins fin_supplier_materials; do
  [ "$(RPSQL "select count(*) from information_schema.tables where table_schema='public' and table_name='$TB'")" = "1" ] || { reh_drop; die "tabel baru $TB tidak ada"; }
  [ "$(RPSQL "select count(*) from $TB")" = "0" ] || { reh_drop; die "tabel baru $TB TIDAK kosong (tidak ada backfill yang diizinkan)"; }
done
ok "2 tabel baru ada dan KOSONG (tidak ada material lama yang dianggap SKU dari PO, tidak ada katalog supplier yang ditebak)"
[ "$(RPSQL "select count(*) from pg_constraint where conname in ('materials_kind_chk','fin_purchase_order_lines_konversi_chk','fin_supplier_materials_faktor_chk','stock_movements_unit_cost_exact_chk','fin_purchase_order_lines_supplier_material_id_fkey','fin_material_sku_origins_material_id_fkey','fin_material_sku_origins_first_purchase_order_id_fkey','fin_material_sku_origins_first_supplier_id_fkey','fin_supplier_materials_supplier_id_fkey','fin_supplier_materials_material_id_fkey')")" = "10" ] || { reh_drop; die "CHECK/FK SKU baru tidak lengkap"; }
# Uji CHECK pada DB rehearsal (bukan produksi): nilai di luar aturan harus ditolak.
RPSQL "update materials set kind = 'NGAWUR' where id = (select id from materials limit 1)" >/dev/null 2>&1 && { reh_drop; die "CHECK jenis SKU TIDAK menolak nilai di luar daftar"; }
RPSQL "update stock_movements set unit_cost_exact = 0 where id = (select id from stock_movements limit 1)" >/dev/null 2>&1 && { reh_drop; die "CHECK harga eksak TIDAK menolak nol"; }
RPSQL "update materials set kind = 'BAHAN_PRODUKSI' where false" >/dev/null 2>&1 || { reh_drop; die "UPDATE kosong pada materials gagal tak terduga"; }
ok "CHECK terbukti menolak jenis SKU di luar daftar dan harga eksak nol (DB rehearsal)"
RPSQL "$FP_SQL" > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi rehearsal MENGUBAH isi tabel lama"; }
for T in $KUNCI_TABEL; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$A" = "$B" ] || { reh_drop; die "jumlah baris $T berubah oleh migrasi rehearsal (produksi=$A rehearsal=$B)"; }
done
reh_drop
ok "rehearsal lulus: isi stok/Material Issue/penerimaan/tagihan/jurnal/saldo/material/baris PO IDENTIK sebelum vs sesudah migrasi; 11 kolom baru + 2 tabel baru kosong (tanpa backfill); CHECK terbukti; DB sementara dihapus"

PHASE="6-migrate"; say "6. Migrasi aditif SKU/katalog/konversi (image baru; backend lama tetap melayani)"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
for m in "${MIGRASI[@]}"; do grep -Fx "$m" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${m} SUDAH terpasang sebelum rilis (tidak diharapkan)"; done
PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") || true)"
[ "$PENDING" = "$(printf '%s\n' "${MIGRASI[@]}" | LC_ALL=C sort)" ] || die "migrasi pending bukan tepat migrasi SKU: $(printf '%s' "$PENDING" | tr '\n' ' ')"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
for m in "${MIGRASI[@]}"; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 1 ))" ] || die "jumlah migrasi terpasang != sebelum + 1"
ok "migrasi diterapkan: SKU/katalog/konversi; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"
SW_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"  # batas waktu: pergerakan SETELAH ini boleh sudah dibekukan (transaksi pengguna sah)

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
[ "$NBE" -ge 5 ] || die "terlalu sedikit berkas backend yang diverifikasi (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
[ "$(PSQLN "select count(*) from information_schema.columns where table_schema='public' and ((table_name='materials' and column_name in ('kind','specification','storage_hint','created_via','created_by')) or (table_name='stock_movements' and column_name='unit_cost_exact') or (table_name='fin_purchase_order_lines' and column_name in ('purchase_unit','conversion_factor','supplier_material_id','supplier_item_name','supplier_sku')))")" = "11" ] || die "kolom SKU/konversi tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from information_schema.tables where table_schema='public' and table_name in ('fin_material_sku_origins','fin_supplier_materials')")" = "2" ] || die "tabel SKU/katalog tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from materials where created_via is not null or kind is not null or specification is not null")" = "0" ] || die "ADA material lama yang terisi jenis/asal SKU (backfill tidak diizinkan)"
[ "$(PSQLN "select count(*) from stock_movements where unit_cost_exact is not null")" = "0" ] || die "ADA pergerakan stok lama yang terisi harga eksak (backfill tidak diizinkan)"
[ "$(PSQLN "select count(*) from fin_purchase_order_lines where purchase_unit is not null or conversion_factor is not null or supplier_material_id is not null")" = "0" ] || die "ADA baris PO lama yang terisi konversi/katalog (backfill tidak diizinkan)"
ok "kolom & tabel SKU/katalog ada; material, stok, dan baris PO lama TIDAK terisi (tanpa backfill)"
echo "  INFO  material = $(PSQLN "select count(*) from materials"); SKU dari PO = $(PSQLN "select count(*) from fin_material_sku_origins"); katalog supplier = $(PSQLN "select count(*) from fin_supplier_materials"); PO = $(PSQLN "select count(*) from fin_purchase_orders")"
PHASE="8b-smoke"; say "8b. Smoke test izin + pembacaan (baca-saja; TIDAK ada SKU/PO/penerimaan/transaksi QA di produksi)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json, type: r.headers.get("content-type") || "" };
}
const tokenUntuk = async (user) => {
  const roles = (await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } })).map((r) => r.role);
  return jwt.sign({ id: user.id, name: user.name, role: user.role, roles: roles.length ? roles : [user.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });
};
const FIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) {
    const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
    if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u;
  }
  return null;
}
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
const sales = await userDengan("SALES", FIN);
const prod = await userDengan("PRODUCTION_LEAD", FIN);
const gudang = await userDengan("WAREHOUSE", FIN);
const finBiasa = await userDengan("FINANCE", new Set(["ADMIN", "OWNER"]));
if (!adm || !sales) { rec("akun ADMIN & SALES murni tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales), tP = prod ? await tokenUntuk(prod) : null, tG = gudang ? await tokenUntuk(gudang) : null, tF = finBiasa ? await tokenUntuk(finBiasa) : null;
const nol = "00000000-0000-4000-8000-000000000000";
const cacah = async () => [await prisma.finJournalEntry.count(), await prisma.finJournalLine.count(), await prisma.finSupplierPayment.count(), await prisma.stockMovement.count(), await prisma.goodsReceipt.count(), await prisma.finSupplierBill.count(), await prisma.finPurchaseOrder.count(), await prisma.finPurchaseOrderLine.count(), await prisma.material.count(), await prisma.finMaterialSkuOrigin.count(), await prisma.finSupplierMaterial.count(), await prisma.finSupplierPaymentAllocation.count()];
const sebelum = await cacah();
const material = await prisma.material.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
const po = await prisma.finPurchaseOrder.findFirst({ orderBy: { createdAt: "asc" } });
const contohBaru = { jenis: "BAHAN_PRODUKSI", kategori: "Uji", satuanStok: "PCS", nama: "Zzqx Barang Uji Smoke 000" };

// 401 tanpa sesi
rec("cek-duplikat SKU: tanpa token -> 401", (await api("POST", "/api/finance/purchase-orders/sku/cek-duplikat")).status === 401);
rec("katalog supplier: tanpa token -> 401", (await api("GET", "/api/finance/purchase-orders/katalog-supplier")).status === 401);
rec("asal SKU: tanpa token -> 401", (await api("GET", `/api/finance/purchase-orders/sku/${nol}`)).status === 401);
rec("perbaiki SKU: tanpa token -> 401", (await api("PATCH", `/api/finance/purchase-orders/sku/${nol}`)).status === 401);
// 403 tanpa izin
for (const [nama, t] of [["SALES", tS], ["PRODUCTION_LEAD", tP], ["WAREHOUSE", tG]]) {
  if (!t) continue;
  rec(`cek-duplikat SKU: ${nama} -> 403`, (await api("POST", "/api/finance/purchase-orders/sku/cek-duplikat", t, { materialBaru: contohBaru })).status === 403);
  rec(`katalog supplier: ${nama} -> 403`, (await api("GET", "/api/finance/purchase-orders/katalog-supplier", t)).status === 403);
}
if (tF) {
  rec("cek-duplikat SKU: FINANCE biasa (bukan admin) -> 403", (await api("POST", "/api/finance/purchase-orders/sku/cek-duplikat", tF, { materialBaru: contohBaru })).status === 403);
  rec("perbaiki SKU: FINANCE biasa (bukan admin) -> 403", (await api("PATCH", `/api/finance/purchase-orders/sku/${nol}`, tF, { nama: "x" })).status === 403);
  rec("katalog supplier: FINANCE biasa -> 200 (finance:read)", (await api("GET", "/api/finance/purchase-orders/katalog-supplier", tF)).status === 200);
} else console.log("  INFO  tidak ada akun FINANCE murni — uji FINANCE biasa dilewati (dicakup tes integrasi)");

// Admin: pembacaan nyata
const kat = await api("GET", "/api/finance/purchase-orders/katalog-supplier", tA);
rec("katalog supplier (admin) -> 200, kosong sebelum PO pertama dengan SKU baru", kat.status === 200 && Array.isArray(kat.json?.katalog) && kat.json.katalog.length === sebelum[10], `${kat.json?.katalog?.length ?? "?"} relasi`);
if (material) {
  const dup = await api("POST", "/api/finance/purchase-orders/sku/cek-duplikat", tA, { materialBaru: { jenis: "BAHAN_PRODUKSI", kategori: "Uji", satuanStok: material.unit, nama: material.name } });
  rec("cek-duplikat pada data produksi: nama + satuan material yang ADA terdeteksi sebagai duplikat pasti", dup.status === 200 && dup.json?.bolehLanjut === false && dup.json?.pasti?.some((p) => p.materialId === material.id), `${material.code} ${material.name}`);
  const asal = await api("GET", `/api/finance/purchase-orders/sku/${material.id}`, tA);
  rec("asal SKU material lama: bukan dari PO, kode terkunci", asal.status === 200 && asal.json?.dibuatLewatPO === false && asal.json?.terkunci?.kode === true);
}
const baru = await api("POST", "/api/finance/purchase-orders/sku/cek-duplikat", tA, { materialBaru: contohBaru });
rec("cek-duplikat nama fiktif -> boleh lanjut (tidak ada duplikat)", baru.status === 200 && baru.json?.bolehLanjut === true && baru.json?.pasti?.length === 0, `prefix ${baru.json?.prefixKode}`);
const jasa = await api("POST", "/api/finance/purchase-orders/sku/cek-duplikat", tA, { materialBaru: { ...contohBaru, jenis: "JASA" } });
rec("jasa/non-stok ditolak dengan arahan ke Pengeluaran/Pengajuan Biaya/Tagihan Supplier", jasa.status === 400 && /Pengeluaran/.test(jasa.json?.error ?? ""));
rec("asal SKU id tak dikenal (admin) -> 404", (await api("GET", `/api/finance/purchase-orders/sku/${nol}`, tA)).status === 404);
const semua = await api("GET", "/api/inventory/materials?active=true", tA);
const prodList = await api("GET", "/api/inventory/materials?active=true&untuk=produksi", tA);
rec("pilihan bahan Produksi = semua material aktif (belum ada Perlengkapan Stok)", semua.status === 200 && prodList.status === 200 && semua.json.length === prodList.json.length, `${prodList.json?.length} vs ${semua.json?.length}`);
const stok = await api("GET", "/api/inventory/stock", tA);
rec("snapshot stok memuat kolom jenis/asal SKU (kosong untuk material lama)", stok.status === 200 && Array.isArray(stok.json) && stok.json.length > 0 && "kind" in stok.json[0] && stok.json.every((r) => r.kind == null && r.createdVia == null));
if (po) {
  const d = await api("GET", `/api/finance/purchase-orders/${po.id}`, tA);
  rec("PO lama tampil normal tanpa konversi satuan", d.status === 200 && d.json?.lines?.every((l) => !l.konversi), `${d.json?.poNumber} ${d.json?.lines?.length} baris`);
  const pdf = await api("GET", `/api/finance/purchase-orders/${po.id}/pdf`, tA);
  rec("PDF PO lama masih 200 application/pdf", pdf.status === 200 && /application\/pdf/.test(pdf.type), pdf.type);
}
const sesudah = await cacah();
rec("tidak ada jurnal/pembayaran/stok/penerimaan/tagihan/PO/baris PO/material/SKU/katalog/alokasi yang berubah selama smoke", sebelum.every((n, i) => n === sesudah[i]), `${sebelum.join(",")} -> ${sesudah.join(",")}`);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus (izin, pratinjau duplikat pada data nyata, katalog kosong, PO/PDF lama normal, tidak ada data berubah)"
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
ok "jurnal, saldo, payment, order, stok, material, baris PO, tagihan, pembayaran, dan flag Production V2 IDENTIK sebelum vs sesudah rilis"
# Pembersihan release lama (setelah rilis TERBUKTI sehat): tiap rilis menyalin node_modules frontend (~350 MB) — 67 folder pernah menumpuk ±19 GB dan membuat disk VPS penuh.
# Dipertahankan: 4 terbaru (mtime), release baru (NEW_DIR), release sebelumnya (PREV_DIR), dan release yang dirujuk container berjalan. Kegagalan di sini TIDAK menggagalkan rilis.
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
