#!/usr/bin/env bash
# RILIS "ORDER PKR MULTI-ITEM": web + backend + 3 migrasi ADITIF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Katalog Item PKR (kategori/produk dikelola Admin, izin pkr_catalog:manage), item produksi per PKR (kasur + divan + sandaran + service + custom), bundel Set Kasur Lengkap
#   (dipecah jadi komponen), order CAMPURAN (kategori/rute/kelengkapan/status per item), pemetaan rute Produksi WAJIB (produk belum dipetakan diblokir), Koreksi Item PKR
#   (alasan, pratinjau dampak, revisi optimistis, Idempotency-Key, atomik), Delivery satu job gabungan + kirim sebagian eksplisit.
#   Migrasi (urut): 20261103090000_pkr_katalog_item_order, 20261103090050_order_category_campuran, 20261103090100_pkr_campuran_bundel_rute_koreksi.
# TANPA backfill/UPDATE/DELETE pada tabel lama: Order, unit, job, PKR, pembayaran, jurnal yang sudah ada TIDAK berubah. units mendapat 3 kolom NULL (NULL = perilaku lama persis).
# Produksi: verifikasi hanya baca + penolakan izin; TIDAK ada PKR/koreksi/pengiriman/transaksi QA. Uji perilaku constraint/trigger dijalankan di DB REHEARSAL (hasil restore backup).
#
#   cat scripts/release-pkr-multi-item.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/pkrm1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/pkrm1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pkrm1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/pkrm1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode HANYA boleh di-rollback bila belum ada item PKR / order CAMPURAN / revisi / pengiriman sebagian. Periksa dulu dengan scripts/rollback-guard-pkr-multi-item.sh
# (baca-saja; menolak bila ada data baru: kode lama gagal membaca nilai enum CAMPURAN dan merutekan unit per order, bukan per item).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/pkr-multi-item}"
# Migrasi aditif yang SUDAH diaudit (urut): nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261103090000_pkr_katalog_item_order:53ffca5579ace93463ad64cc26868336521b150d684d1c469c1f5b8ba011c216 20261103090050_order_category_campuran:097701c9e807a74c7978b8c08546816fbb8511c59869cc8f90210c7c9747e715 20261103090100_pkr_campuran_bundel_rute_koreksi:0c51f18e747ba059d39bee0c5f4ea85093d478c7803a56baa5be0df9493a8fe6"
# Hasil pemindai untuk gabungan migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":76,"enum_value":1,"create_table":7,"add_column":14,"check_units":1,"check_inline":5,"check_new":7,"create_index":15,"fk":18,"update_seed":5,"insert_seed":6,"fungsi":1,"trigger":1}'
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261103090000_pkr_katalog_item_order/migration\.sql|backend/prisma/migrations/20261103090050_order_category_campuran/migration\.sql|backend/prisma/migrations/20261103090100_pkr_campuran_bundel_rute_koreksi/migration\.sql|backend/prisma/schema\.prisma|backend/scripts/production-delivery-v2/audit-qc-handoff-writers\.js|backend/src/constants/permissions\.js|backend/src/lib/activityLog\.js|backend/src/lib/domain/pkrItem\.js|backend/src/lib/domain/pkrSpesifikasi\.js|backend/src/lib/domain/productionBuildTrack\.js|backend/src/lib/domain/unitKategori\.js|backend/src/mcp/toolsShared\.js|backend/src/routes/armada\.js|backend/src/routes/armadaPkrPengiriman\.js|backend/src/routes/financePenjualanKaryawan\.js|backend/src/routes/orders\.js|backend/src/routes/production\.js|backend/src/routes/units\.js|backend/src/services/deliveryHandoff\.js|backend/src/services/deliveryJobCancellationService\.js|backend/src/services/orderNumberGenerator\.js|backend/src/services/penjualanKaryawanItem\.js|backend/src/services/penjualanKaryawanKoreksi\.js|backend/src/services/penjualanKaryawanOrder\.js|backend/src/services/pkrItemRevisi\.js|backend/src/services/pkrPengirimanSebagian\.js|backend/src/services/pkrProduksiGuard\.js|backend/src/services/productionBacklog\.js|backend/src/services/productionExperienceReadService\.js|backend/src/services/productionPlanningCommandService\.js|backend/src/services/productionQcHandoffCommandService\.js|backend/src/services/productionRencanaService\.js|backend/src/services/productionStepCommandService\.js|backend/src/services/productionUnitOverviewService\.js|backend/src/services/productionWorkshopExecutionCommandService\.js|backend/src/services/unitKategoriDb\.js|backend/src/services/unitStageEngine\.js|backend/tests/integration/pkrMultiItem\.integration\.test\.js|backend/tests/integration/setup/testDb\.js|backend/tests/pkrCatalogPermission\.test\.js|backend/tests/pkrItem\.test\.js|docs/PKR-MULTI-ITEM\.md|frontend/src/api\.js|frontend/src/components/customer/OrderSection\.jsx|frontend/src/features/armada/components/PkrPengirimanPanel\.jsx|frontend/src/features/finance/PkrItemForm\.jsx|frontend/src/features/finance/PkrKoreksiItem\.jsx|frontend/src/features/finance/PkrOrderCrm\.jsx|frontend/src/features/finance/PkrPratinjau\.jsx|frontend/src/features/finance/pkrItemLogic\.js|frontend/src/features/finance/pkrOrderCrmLogic\.js|frontend/src/features/inbox/components/ChatWindow/CatatPembayaranDariChat\.jsx|frontend/src/features/pipeline/components/OrderPipelineBoard\.jsx|frontend/src/features/production/PkrRujukan\.jsx|frontend/src/features/production/pkrRujukanModel\.js|frontend/src/lib/productionSettings\.js|frontend/src/pages/Orders\.jsx|frontend/src/pages/armada/ArmadaJobs\.jsx|frontend/src/pages/armada/ArmadaOrders\.jsx|frontend/src/pages/b2b/B2BOrders\.jsx|frontend/src/pages/bengkel/PkrKatalogItem\.jsx|frontend/src/pages/bengkel/ProductionOrders\.jsx|frontend/src/pages/bengkel/ProductionSettings\.jsx|frontend/src/pages/finance/FinancePenjualanKaryawan\.jsx|frontend/src/utils/exportLaporan\.js|frontend/tests/pkrItemUI\.test\.js|frontend/tests/pkrOrderCrmUI\.test\.js|frontend/tests/productionSidebarConsolidation\.test\.js|mobile/src/utils/format\.js|scripts/release-pkr-multi-item\.sh|scripts/rollback-guard-pkr-multi-item\.sh)$'
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
BK_DIR="$HOME/release-backups/pkr-multi-item-${DEPLOY_SHORT}-${TS}"
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
LANGKAH WAJIB sebelum rollback KODE setelah switch: jalankan GUARD (baca-saja)
   bash ${NEW_DIR}/scripts/rollback-guard-pkr-multi-item.sh
Guard menolak (exit 1) bila SUDAH ADA data yang hanya dipahami kode baru:
   - item order PKR (pkr_order_items) atau unit bertanda kategori/rute efektif (units.work_category),
   - order berkategori CAMPURAN (kode lama GAGAL membaca nilai enum ini pada Prisma-nya),
   - revisi item (pkr_item_revisions) atau pengiriman sebagian (pkr_pengiriman_sebagian).
   Bila guard menolak: JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner.
Bila guard lulus (belum ada data baru), rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi hanya MENAMBAH nilai enum/kolom/tabel/constraint/trigger: dibiarkan terpasang pun aman bagi kode lama SELAMA belum ada data baru. (Tidak dihapus oleh rollback kode.)
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
exec 9>/tmp/release-pkr-multi-item.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "pkrm1\|release-pkr-multi-item\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, pin migrasi, pemindai DDL (+ uji negatif pemindai)"
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
MIG_LIST=""; EXPECT_PRISMA="backend/prisma/schema.prisma"
for e in $MIGS; do MIG_LIST="$MIG_LIST ${e%%:*}"; EXPECT_PRISMA="$(printf '%s\nbackend/prisma/migrations/%s/migration.sql' "$EXPECT_PRISMA" "${e%%:*}")"; done
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat schema.prisma + 3 migrasi rilis ini"; }
# Migrasi yang sudah ada di baseline TIDAK boleh diubah/dihapus (yang sudah pernah diterapkan di produksi): hanya penambahan.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
# schema.prisma: hanya penambahan baris di model yang sudah ada + model baru; baris lama TIDAK dihapus/diubah selain yang diaudit (nol baris dihapus)
SCHEMA_DEL="$(sg diff --numstat "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | awk '{print $2}')"
[ "$SCHEMA_DEL" = "0" ] || die "schema.prisma menghapus/mengubah ${SCHEMA_DEL} baris yang sudah ada — hanya penambahan yang diizinkan"
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
// Pemindai migrasi rilis "Order PKR multi-item" (3 migrasi aditif). Dijalankan di VPS oleh skrip rilis; juga dijalankan lokal terhadap berkas migrasi. FAIL-CLOSED, daftar putih per pernyataan.
//  (a) SATU nilai enum: OrderCategory.CAMPURAN,
//  (b) CREATE TABLE hanya untuk 7 tabel baru (PK standar; CHECK inline hanya dengan nama yang diaudit, tanpa subquery),
//  (c) kolom baru: tepat 3 pada units (nullable) dan kolom yang diaudit pada tabel baru; tidak ada kolom baru pada tabel lama lain,
//  (d) indeks hanya pada tabel baru; FK hanya DARI tabel baru ke tabel yang diaudit,
//  (e) CHECK hanya pada tabel baru + SATU CHECK units_work_category_chk pada units,
//  (f) UPDATE/INSERT HANYA pada tabel baru katalog (pkr_item_categories, pkr_item_products, pkr_bundle_components), hanya kolom pemetaan yang diaudit, membaca hanya price_items/service_catalog/katalog,
//  (g) SATU fungsi plpgsql pkr_item_revisions_append_only (badan hanya RAISE EXCEPTION) + SATU trigger BEFORE UPDATE OR DELETE pada pkr_item_revisions.
// Tidak ada DROP/DELETE/TRUNCATE/GRANT/RENAME/ALTER COLUMN, tidak ada indeks/FK/kolom/UPDATE pada tabel lama (Order, units selain 3 kolom + 1 CHECK, jobs, service_catalog, dst).
import fs from "node:fs";
let sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const hitung = {};
const tambah = (k) => { hitung[k] = (hitung[k] ?? 0) + 1; };
const gagal = (m) => { console.error(m); process.exit(1); };
const TABEL_BARU = new Set(["pkr_item_categories", "pkr_item_products", "pkr_order_items", "pkr_order_item_units", "pkr_bundle_components", "pkr_item_revisions", "pkr_pengiriman_sebagian"]);
const REF_OK = new Set([...TABEL_BARU, "service_catalog", "fin_penjualan_karyawan", "Order", "units", "jobs"]);
const KOLOM_TAMBAH_OK = new Set([
  "units.work_category", "units.product_line", "units.product_type",
  "pkr_item_categories.product_line", "pkr_item_categories.product_type", "pkr_item_categories.production_service_id",
  "pkr_item_products.product_line", "pkr_item_products.product_type",
  "pkr_order_items.bundle_no", "pkr_order_items.bundle_category_code", "pkr_order_items.bundle_name", "pkr_order_items.removed_at", "pkr_order_items.removed_by_id", "pkr_order_items.removed_reason",
]);
const TIPE_KOLOM_OK = /^("OrderCategory"|"ProductLine"|"ProductType"|UUID|INTEGER|TIMESTAMP\(3\)|TEXT|VARCHAR\(\d+\))$/;
const CHECK_OK = new Set([
  "pkr_item_categories_shape_chk", "pkr_item_categories_work_kind_chk", "pkr_order_items_shape_chk", "pkr_order_items_work_kind_chk", "pkr_order_items_qty_chk", "pkr_order_items_dim_chk",
  "pkr_order_items_removed_chk", "pkr_bundle_components_qty_chk", "pkr_item_revisions_kind_chk", "pkr_item_revisions_revision_chk", "pkr_item_revisions_alasan_chk", "pkr_pengiriman_sebagian_alasan_chk",
]);
const SET_OK = new Set(["product_line", "product_type", "production_service_id"]);
const SEED_FROM_OK = new Set(["price_items", "service_catalog", "pkr_item_categories"]);

// (g) fungsi append-only: badan HANYA RAISE EXCEPTION.
const FN_RE = /CREATE OR REPLACE FUNCTION pkr_item_revisions_append_only\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$;/g;
const fungsi = [...sql.matchAll(FN_RE)];
if (fungsi.length !== 1) gagal(`jumlah fungsi pkr_item_revisions_append_only harus tepat 1 (ditemukan ${fungsi.length})`);
const badan = fungsi[0][1].replace(/'(?:[^']|'')*'/g, "''");
if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXECUTE|PERFORM|GRANT|REVOKE|COPY|SELECT|CALL|DO)\b/i.test(badan)) gagal("badan fungsi memuat perintah di luar daftar putih");
if ((badan.match(/RAISE EXCEPTION/g) ?? []).length !== 1) gagal("badan fungsi harus memuat tepat satu RAISE EXCEPTION");
if (/\bRETURN\b/i.test(badan)) gagal("badan fungsi tidak boleh RETURN (selalu menolak)");
if (/\$[a-z_]*\$/i.test(badan)) gagal("badan fungsi memuat dollar-quote bersarang");
tambah("fungsi");
sql = sql.replace(FN_RE, "");

const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
const dilihat = { tabel: new Set(), indeks: new Set(), constraint: new Set(), kolom: new Set() };
const unik = (jenis, nama) => { if (dilihat[jenis].has(nama)) gagal(`${jenis} duplikat: ${nama}`); dilihat[jenis].add(nama); };
const tanpaSubquery = (t, nama) => { if (/\b(SELECT|FROM|INSERT|UPDATE|DELETE)\b/i.test(t)) gagal(`CHECK memuat subquery/perintah menulis: ${nama}`); };

for (const st of stmts) {
  const r = rapat(st);
  let m;
  if (r === `ALTER TYPE "OrderCategory" ADD VALUE IF NOT EXISTS 'CAMPURAN'`) { unik("constraint", "enum:OrderCategory.CAMPURAN"); tambah("enum_value"); continue; }
  if ((m = /^CREATE TABLE "([a-z_]+)" \((.+)\)$/.exec(r))) {
    if (!TABEL_BARU.has(m[1])) gagal(`CREATE TABLE di luar daftar putih: ${m[1]}`);
    unik("tabel", m[1]);
    if (!new RegExp(`CONSTRAINT "${m[1]}_pkey" PRIMARY KEY \\("id"\\)`).test(m[2])) gagal(`tabel ${m[1]} tanpa primary key standar`);
    if (/\b(REFERENCES|GENERATED|SERIAL)\b/i.test(m[2])) gagal(`CREATE TABLE ${m[1]} memuat klausa di luar daftar putih`);
    for (const c of m[2].trim().matchAll(/CONSTRAINT "([a-z_]+)" CHECK \((.+?)\)(?:,|$)/g)) {
      if (!CHECK_OK.has(c[1])) gagal(`CHECK inline dengan nama di luar yang diaudit: ${c[1]}`);
      tanpaSubquery(c[2], c[1]); unik("constraint", c[1]); tambah("check_inline");
    }
    const semuaDefault = (m[2].match(/\bDEFAULT\b/g) ?? []).length;
    const defaultOk = (m[2].match(/\bDEFAULT (CURRENT_TIMESTAMP|true|0|1)(?![A-Za-z0-9_])/g) ?? []).length;
    if (semuaDefault !== defaultOk) gagal(`CREATE TABLE ${m[1]} memuat DEFAULT di luar daftar putih`);
    tambah("create_table"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD COLUMN "([a-z_]+)" ("OrderCategory"|"ProductLine"|"ProductType"|UUID|INTEGER|TIMESTAMP\(3\)|TEXT|VARCHAR\(\d+\))$/.exec(r))) {
    const kunciKolom = `${m[1]}.${m[2]}`;
    if (!KOLOM_TAMBAH_OK.has(kunciKolom)) gagal(`ADD COLUMN di luar daftar putih: ${kunciKolom}`);
    if (!TIPE_KOLOM_OK.test(m[3])) gagal(`tipe kolom di luar daftar putih: ${m[3]}`);
    unik("kolom", kunciKolom); tambah("add_column"); continue; // semua nullable tanpa DEFAULT: tidak ada backfill/rewrite tabel
  }
  if (r === `ALTER TABLE "units" ADD CONSTRAINT "units_work_category_chk" CHECK ("work_category" IS NULL OR "work_category" IN ('BARU', 'LAYANAN'))`) { unik("constraint", "units_work_category_chk"); tambah("check_units"); continue; }
  if ((m = /^CREATE (UNIQUE )?INDEX "([a-z_]+)" ON "([a-z_]+)"\s?\((.+?)\)( WHERE "[a-z_]+" IS NOT NULL)?$/.exec(r))) {
    if (!TABEL_BARU.has(m[3])) gagal(`indeks pada tabel di luar tabel baru: ${m[3]}`);
    if (/\b(SELECT|FROM|INSERT|UPDATE|DELETE)\b/i.test(m[4])) gagal(`indeks memuat subquery: ${m[2]}`);
    if (m[5] && !m[1]) gagal(`indeks parsial harus UNIQUE: ${m[2]}`);
    unik("indeks", m[2]); tambah("create_index"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+_fkey)" FOREIGN KEY \("[a-z_]+"\) REFERENCES "([A-Za-z_]+)"\("id"\) ON DELETE (RESTRICT|CASCADE|SET NULL) ON UPDATE CASCADE$/.exec(r))) {
    if (!TABEL_BARU.has(m[1])) gagal(`FK dari tabel di luar tabel baru: ${m[1]}`);
    if (!REF_OK.has(m[3])) gagal(`FK ke tabel di luar daftar putih: ${m[3]}`);
    unik("constraint", m[2]); tambah("fk"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+)" CHECK \((.+)\)$/.exec(r))) {
    if (!TABEL_BARU.has(m[1])) gagal(`CHECK pada tabel di luar tabel baru: ${m[1]}`);
    if (!CHECK_OK.has(m[2])) gagal(`CHECK dengan nama di luar yang diaudit: ${m[2]}`);
    tanpaSubquery(m[3], m[2]);
    unik("constraint", m[2]); tambah("check_new"); continue;
  }
  if ((m = /^UPDATE "(pkr_item_categories|pkr_item_products)"( [a-z])? SET (.+?)( FROM "([a-z_]+)" [a-z])? WHERE (.+)$/.exec(r))) {
    for (const set of m[3].split(/,\s*(?=")/)) {
      const k = /^"([a-z_]+)" = /.exec(set.trim());
      if (!k || !SET_OK.has(k[1])) gagal(`UPDATE menyentuh kolom di luar daftar putih: ${set.slice(0, 60)}`);
    }
    if (m[5] && !SEED_FROM_OK.has(m[5])) gagal(`UPDATE membaca tabel di luar daftar putih: ${m[5]}`);
    if (/\b(SELECT|DELETE|INSERT|JOIN)\b/i.test(m[6])) gagal("UPDATE.WHERE memuat subquery/perintah menulis");
    tambah("update_seed"); continue;
  }
  if ((m = /^INSERT INTO "(pkr_item_categories|pkr_item_products|pkr_bundle_components)" \(.+?\) (VALUES|SELECT) /.exec(r))) {
    const dari = [...r.matchAll(/\b(?:FROM|JOIN)\s+"([a-z_]+)"/gi)].map((x) => x[1]);
    for (const t of dari) if (!SEED_FROM_OK.has(t)) gagal(`INSERT membaca tabel di luar daftar putih: ${t}`);
    if (/\b(DELETE|UPDATE|DROP|TRUNCATE)\b/i.test(r)) gagal("INSERT memuat perintah menulis lain");
    tambah("insert_seed"); continue;
  }
  if (r === 'CREATE TRIGGER pkr_item_revisions_append_only_trg BEFORE UPDATE OR DELETE ON "pkr_item_revisions" FOR EACH ROW EXECUTE FUNCTION pkr_item_revisions_append_only()') { tambah("trigger"); continue; }
  gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
}
if ((hitung.check_inline ?? 0) !== 5) gagal(`CHECK inline harus tepat 5 (ditemukan ${hitung.check_inline ?? 0}) — pemindai tidak membaca semua CHECK`);
if (dilihat.tabel.size !== TABEL_BARU.size) gagal(`tabel baru harus tepat ${TABEL_BARU.size} (ada ${dilihat.tabel.size})`);
if (dilihat.kolom.size !== KOLOM_TAMBAH_OK.size) gagal(`kolom tambahan harus tepat ${KOLOM_TAMBAH_OK.size} (ada ${dilihat.kolom.size})`);
console.log(JSON.stringify({ total: stmts.length + 1, enum_value: 0, create_table: 0, add_column: 0, check_units: 0, check_inline: 0, check_new: 0, create_index: 0, fk: 0, update_seed: 0, insert_seed: 0, fungsi: 0, trigger: 0, ...hitung }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (1 nilai enum, 7 tabel baru, 14 kolom NULL, 15 indeks, 18 FK, CHECK, seed katalog literal, 1 fungsi + 1 trigger append-only); tanpa DROP/DELETE/ALTER COLUMN/RENAME/GRANT; UPDATE hanya katalog baru"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE tabel lama" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "UPDATE tabel lama (backfill units)" "$(tambah_stmt "UPDATE \"units\" SET \"work_category\" = 'BARU';")"
harus_ditolak "UPDATE tabel lama (Order)" "$(tambah_stmt "UPDATE \"Order\" SET \"category\" = 'CAMPURAN';")"
harus_ditolak "DELETE tabel lama" "$(tambah_stmt 'DELETE FROM "jobs";')"
harus_ditolak "INSERT tabel lama" "$(tambah_stmt "INSERT INTO \"fin_settings\" (\"key\", \"value\") VALUES ('x', 'y');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "units";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "units" DROP COLUMN "service_id";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "units" ALTER COLUMN "merk" TYPE VARCHAR(10);')"
harus_ditolak "kolom baru di tabel lama selain 3 kolom units" "$(tambah_stmt 'ALTER TABLE "jobs" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom NOT NULL DEFAULT pada units (rewrite)" "$(tambah_stmt "ALTER TABLE \"units\" ADD COLUMN \"work_category2\" TEXT NOT NULL DEFAULT 'x';")"
harus_ditolak "nilai enum di luar daftar" "$(tambah_stmt "ALTER TYPE \"OrderCategory\" ADD VALUE IF NOT EXISTS 'LAIN';")"
harus_ditolak "enum pada tipe lain" "$(tambah_stmt "ALTER TYPE \"OrderStatus\" ADD VALUE IF NOT EXISTS 'CAMPURAN';")"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("work_category");')"
harus_ditolak "FK dari tabel lama" "$(tambah_stmt 'ALTER TABLE "units" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "CHECK dengan nama tak diaudit" "$(tambah_stmt 'ALTER TABLE "pkr_order_items" ADD CONSTRAINT "evil_chk" CHECK (true);')"
harus_ditolak "CHECK kedua pada units" "$(tambah_stmt 'ALTER TABLE "units" ADD CONSTRAINT "units_evil_chk" CHECK (true);')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "units" TO PUBLIC;')"
harus_ditolak "trigger kedua pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "units" FOR EACH ROW EXECUTE FUNCTION pkr_item_revisions_append_only();')"
harus_ditolak "fungsi menulis (DELETE di badan)" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION 'pkr_item_revisions append-only/DELETE FROM units; RAISE EXCEPTION 'pkr_item_revisions append-only/")"
harus_ditolak "fungsi RETURN (tidak lagi menolak)" "$(printf '%s\n' "$ALL_SQL" | sed 's/^  RAISE EXCEPTION \(.*\)$/  RETURN NEW; RAISE EXCEPTION \1/')"
harus_ditolak "UPDATE seed menyentuh kolom di luar pemetaan" "$(tambah_stmt "UPDATE \"pkr_item_categories\" SET \"name\" = 'x' WHERE \"code\" = 'DIVAN_BOX';")"
harus_ditolak "INSERT seed ke tabel di luar katalog" "$(tambah_stmt "INSERT INTO \"pkr_order_items\" (\"id\") VALUES (gen_random_uuid());")"
harus_ditolak "seed membaca tabel di luar daftar" "$(printf '%s\n' "$ALL_SQL" | sed 's/FROM "price_items" p JOIN/FROM "Customer" p JOIN/')"
harus_ditolak "nama CHECK diganti" "$(printf '%s\n' "$ALL_SQL" | sed 's/"pkr_order_items_qty_chk"/"pkr_order_items_evil_chk"/')"
harus_ditolak "FK ke tabel di luar daftar" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "service_catalog"("id")/REFERENCES "Customer"("id")/')"
harus_ditolak "satu indeks hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'pkr_item_products_category_id_active_sort_order_idx')"
harus_ditolak "default liar pada tabel baru" "$(printf '%s\n' "$ALL_SQL" | sed 's/"active" BOOLEAN NOT NULL DEFAULT true/"active" BOOLEAN NOT NULL DEFAULT now()/')"
[ "$NEG" -ge 24 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 24)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER COLUMN/kolom-indeks-FK di tabel lama/enum liar/GRANT/trigger liar/fungsi menulis/hitungan beda) SEMUANYA ditolak"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit + 3 migrasi aditif"

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
# Prasyarat skema: tabel yang disentuh harus sudah ada; objek rilis ini belum boleh ada.
for T in fin_penjualan_karyawan "Order" units jobs job_units service_catalog price_items fin_settings; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
for T in pkr_item_categories pkr_item_products pkr_order_items pkr_order_item_units pkr_bundle_components pkr_item_revisions pkr_pengiriman_sebagian; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "0" ] || die "tabel $T SUDAH ada di produksi (tidak diharapkan)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='units' and column_name in ('work_category','product_line','product_type')")" = "0" ] || die "kolom baru units SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='OrderCategory' and e.enumlabel='CAMPURAN'")" = "0" ] || die "nilai enum CAMPURAN SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from \"Order\" where category::text not in ('LAYANAN','SEWA','BARU')")" = "0" ] || die "ada order berkategori di luar LAYANAN/SEWA/BARU sebelum rilis (tidak diharapkan)"
PKR_N="$(psql_live -At -c "select count(*) from fin_penjualan_karyawan")"; PKR_ORD_N="$(psql_live -At -c "select count(*) from \"Order\" where penjualan_karyawan_id is not null")"
UNIT_N="$(psql_live -At -c "select count(*) from units")"; ORDER_N="$(psql_live -At -c "select count(*) from \"Order\"")"
[ "$UNIT_N" -gt 0 ] && [ "$ORDER_N" -gt 0 ] || die "tidak ada order/unit di produksi: uji perilaku rehearsal butuh contoh baris — berhenti"
ok "prasyarat skema terpenuhi; PKR=${PKR_N} (order tertaut ${PKR_ORD_N}), order=${ORDER_N}, unit=${UNIT_N} (semua dibiarkan apa adanya — tanpa backfill)"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel, TANPA kolom yang ditambahkan rilis ini (units.work_category/product_line/product_type). Membuktikan restore identik dan migrasi tidak mengubah data lama.
FP_SQL="select 'fin_penjualan_karyawan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan x
union all select 'fin_penjualan_karyawan_items', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan_items x
union all select 'fin_penjualan_karyawan_payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan_payments x
union all select 'order', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Order\" x
union all select 'units', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['work_category','product_line','product_type'])::text, '|' order by x.id),'')) from units x
union all select 'jobs', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from jobs x
union all select 'job_units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from job_units x
union all select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x
union all select 'service_catalog', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from service_catalog x
union all select 'service_catalog_modules', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from service_catalog_modules x
union all select 'price_items', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from price_items x
union all select 'production_runs_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_runs_v2 x
union all select 'production_run_plans_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_run_plans_v2 x
union all select 'fin_journal_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_entries x
union all select 'fin_journal_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x"
# DOKUMEN PEMBANDING DIBEKUKAN: hanya yang menurut aturan bisnis tidak mungkin berubah akibat rilis ini (PKR dibatalkan, order/unit terakhir Delivered/Cancelled, job tuntas yang sudah diam sebelum T0,
# baris jurnal yang dibuat sebelum T0 (append-only), saldo per akun dari jurnal itu, seluruh flag fin_settings). T0 = jam DB (UTC) 5 menit lalu. Dokumen terbuka dan transaksi baru TIDAK diperbandingkan.
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'pkr_batal', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan x where x.status = 'DIBATALKAN' and x.updated_at < '$T0'::timestamp
union all select 'order_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from "Order" x where x.status in ('DELIVERED','CANCELLED') and x."updatedAt" < '$T0'::timestamp
union all select 'unit_final', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['work_category','product_line','product_type'])::text, '|' order by x.id),'')) from units x where x.status in ('DELIVERED','CANCELLED') and x.updated_at < '$T0'::timestamp
union all select 'job_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from jobs x where x.status in ('COMPLETED','FAILED') and x.updated_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'flag', count(*), md5(coalesce(string_agg(f.key || '=' || f.value, '|' order by f.key),'')) from fin_settings f
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
# KEADAAN KATALOG sebelum rilis (informasi untuk Owner): produk/layanan akan perlu DIPETAKAN rute Produksinya oleh Admin setelah rilis; sebelum itu pembuatan order dengan produk tsb diblokir.
PRICE_PROD="$(psql_live -At -c "select count(*) from price_items where kind = 'PRODUCT' and \"productLine\" = 'KASUR' and (code like 'PRD_MS_CUSTOM%' or code = 'PRD_KASUR_2IN1')")"
ok "katalog awal akan memuat ±${PRICE_PROD} produk kasur dari daftar harga (belum dipetakan jenis produknya) + produk service dari service_catalog (dipetakan ke layanannya)"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-pkr-multi-item-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-pkr-multi-item.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Tambah Item Produksi" "Katalog Item PKR" "Koreksi item order" "Tinjau Dampak" "Kirim sebagian" "Rute belum dipetakan" "Set kasur lengkap"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur: ${s1}"; done
for s2 in "Barang Akan Datang" "Retur & Debit Note" "Ajukan Klaim Lunas" "Rencana Produksi" "Penjualan Karyawan"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan fitur rilis sebelumnya: ${s2}"; done
if [ "$NEW_INDEX" = "$PREV_INDEX" ]; then die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"; fi
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); 7 teks fitur baru + 5 teks fitur lama ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-pkr-multi-item-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan 3 migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_pkr_multi_item_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod-beku.txt" || { reh_drop; die "sidik jari dokumen beku produksi gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || true; reh_drop; die "dokumen pembanding beku BERUBAH selama backup (produksi)"; }
RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi (backup/restore bermasalah)"; }
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sebelum.txt" || { reh_drop; die "sidik jari penuh rehearsal gagal"; }
[ "$(grep -c . "$BK_DIR/fp-reh-sebelum.txt")" = "15" ] || { reh_drop; die "sidik jari penuh rehearsal tidak 15 tabel"; }
ok "restore nyata IDENTIK dengan dokumen beku produksi (PKR/order/unit/job terminal, jurnal, saldo per akun, flag)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$(printf '%s\n' "$REH_PEND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat 3 migrasi rilis ini: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
# Struktur: 7 tabel baru; yang BUKAN seed kosong; 3 kolom units NULL di SEMUA baris (tanpa backfill); enum CAMPURAN; fungsi + trigger tepat satu.
for T in pkr_order_items pkr_order_item_units pkr_item_revisions pkr_pengiriman_sebagian; do
  [ "$(RPSQL "select count(*) from $T")" = "0" ] || { reh_drop; die "tabel baru $T TIDAK kosong setelah migrasi"; }
done
[ "$(RPSQL "select count(*) from pkr_item_categories")" = "6" ] || { reh_drop; die "seed kategori bukan 6"; }
[ "$(RPSQL "select count(*) from pkr_bundle_components")" = "3" ] || { reh_drop; die "seed komposisi Set bukan 3 komponen"; }
[ "$(RPSQL "select count(*) from units where work_category is not null or product_line is not null or product_type is not null")" = "0" ] || { reh_drop; die "ada unit lama dengan kolom baru terisi (backfill tidak diizinkan)"; }
[ "$(RPSQL "select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='OrderCategory' and e.enumlabel='CAMPURAN'")" = "1" ] || { reh_drop; die "nilai enum CAMPURAN tidak terpasang tepat satu"; }
for C in units_work_category_chk pkr_item_categories_shape_chk pkr_item_categories_work_kind_chk pkr_order_items_shape_chk pkr_order_items_work_kind_chk pkr_order_items_qty_chk pkr_order_items_dim_chk pkr_order_items_removed_chk pkr_bundle_components_qty_chk pkr_item_revisions_kind_chk pkr_item_revisions_revision_chk pkr_item_revisions_alasan_chk pkr_pengiriman_sebagian_alasan_chk; do
  [ "$(RPSQL "select count(*) from pg_constraint where conname='$C'")" = "1" ] || { reh_drop; die "constraint $C tidak ada tepat satu"; }
done
[ "$(RPSQL "select count(*) from pg_proc where proname='pkr_item_revisions_append_only'")" = "1" ] || { reh_drop; die "fungsi append-only tidak ada tepat satu"; }
[ "$(RPSQL "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname='pkr_item_revisions_append_only_trg' and not t.tgisinternal and c.relname='pkr_item_revisions'")" = "1" ] || { reh_drop; die "trigger append-only tidak ada tepat satu"; }
ok "tabel transaksi baru kosong; seed 6 kategori + 3 komponen Set; units.work_category/product_line/product_type NULL di semua unit lama; enum CAMPURAN; 13 CHECK; fungsi + trigger append-only terpasang"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan di akhir): CHECK menolak data salah; riwayat revisi append-only; unik per (order, revision) dan per kunci idempotensi; enum dapat dipakai.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE
  ord text; pkr uuid; unit_id uuid; job uuid; cat uuid; svc uuid;
  tolak int := 0; lolos int := 0; lewat int := 0;
  r1 uuid := gen_random_uuid(); it1 uuid := gen_random_uuid();
BEGIN
  SELECT id, penjualan_karyawan_id INTO ord, pkr FROM "Order" WHERE penjualan_karyawan_id IS NOT NULL LIMIT 1;
  IF ord IS NULL THEN
    SELECT o.id INTO ord FROM "Order" o LIMIT 1; SELECT id INTO pkr FROM fin_penjualan_karyawan LIMIT 1;
  END IF;
  SELECT id INTO unit_id FROM units LIMIT 1; SELECT id INTO job FROM jobs LIMIT 1; SELECT id INTO cat FROM pkr_item_categories WHERE code = 'KASUR_BARU';
  IF ord IS NULL OR pkr IS NULL OR unit_id IS NULL OR job IS NULL OR cat IS NULL THEN lewat := lewat + 1; RAISE NOTICE 'HASIL tolak=% lolos=% lewat=%', tolak, lolos, lewat; RAISE EXCEPTION 'ROLLBACK_UJI'; END IF;
  -- (1) units.work_category: nilai di luar BARU/LAYANAN ditolak (CAMPURAN/SEWA); BARU dan NULL lolos
  BEGIN UPDATE units SET work_category = 'CAMPURAN' WHERE id = unit_id; RAISE EXCEPTION 'TIDAK_DITOLAK_unit_campuran';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE units SET work_category = 'SEWA' WHERE id = unit_id; RAISE EXCEPTION 'TIDAK_DITOLAK_unit_sewa';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  UPDATE units SET work_category = 'BARU', product_line = 'KASUR', product_type = 'KASUR_SEHAT' WHERE id = unit_id; lolos := lolos + 1;
  -- (2) pkr_order_items: bentuk/jenis liar, qty di luar 1..20, dimensi <= 0, penghapusan tanpa alasan ditolak; baris sah lolos
  BEGIN INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, updated_at) VALUES (gen_random_uuid(), pkr, ord, 9001, cat, 'X', 'X', 'LIAR', 'BARU', 1, now()); RAISE EXCEPTION 'TIDAK_DITOLAK_shape';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, updated_at) VALUES (gen_random_uuid(), pkr, ord, 9002, cat, 'X', 'X', 'KASUR', 'BARU', 21, now()); RAISE EXCEPTION 'TIDAK_DITOLAK_qty';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, length_cm, updated_at) VALUES (gen_random_uuid(), pkr, ord, 9003, cat, 'X', 'X', 'KASUR', 'BARU', 1, 0, now()); RAISE EXCEPTION 'TIDAK_DITOLAK_dim';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, removed_at, updated_at) VALUES (gen_random_uuid(), pkr, ord, 9004, cat, 'X', 'X', 'KASUR', 'BARU', 1, now(), now()); RAISE EXCEPTION 'TIDAK_DITOLAK_hapus_tanpa_alasan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, updated_at) VALUES (it1, pkr, ord, 9010, cat, 'KASUR_BARU', 'Kasur Baru', 'KASUR', 'BARU', 2, now()); lolos := lolos + 1;
  BEGIN INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, updated_at) VALUES (gen_random_uuid(), pkr, ord, 9010, cat, 'KASUR_BARU', 'Kasur Baru', 'KASUR', 'BARU', 1, now()); RAISE EXCEPTION 'TIDAK_DITOLAK_seq_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  -- (3) satu unit hanya milik satu item
  INSERT INTO pkr_order_item_units (id, item_id, unit_id) VALUES (gen_random_uuid(), it1, unit_id); lolos := lolos + 1;
  BEGIN INSERT INTO pkr_order_item_units (id, item_id, unit_id) VALUES (gen_random_uuid(), it1, unit_id); RAISE EXCEPTION 'TIDAK_DITOLAK_unit_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  -- (4) buku revisi: alasan wajib untuk DIKOREKSI, nomor unik per order, kunci idempotensi unik per order, append-only (UPDATE/DELETE ditolak)
  BEGIN INSERT INTO pkr_item_revisions (id, order_id, penjualan_id, revision, kind, after_items) VALUES (gen_random_uuid(), ord, pkr, 1, 'DIKOREKSI', '[]'::jsonb); RAISE EXCEPTION 'TIDAK_DITOLAK_koreksi_tanpa_alasan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO pkr_item_revisions (id, order_id, penjualan_id, revision, kind, after_items) VALUES (gen_random_uuid(), ord, pkr, 0, 'DIBUAT', '[]'::jsonb); RAISE EXCEPTION 'TIDAK_DITOLAK_revisi_nol';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO pkr_item_revisions (id, order_id, penjualan_id, revision, kind, after_items) VALUES (gen_random_uuid(), ord, pkr, 1, 'LIAR', '[]'::jsonb); RAISE EXCEPTION 'TIDAK_DITOLAK_jenis';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO pkr_item_revisions (id, order_id, penjualan_id, revision, kind, after_items, idempotency_key) VALUES (r1, ord, pkr, 1, 'DIBUAT', '[]'::jsonb, 'uji-kunci-1'); lolos := lolos + 1;
  BEGIN INSERT INTO pkr_item_revisions (id, order_id, penjualan_id, revision, kind, after_items) VALUES (gen_random_uuid(), ord, pkr, 1, 'DIBUAT', '[]'::jsonb); RAISE EXCEPTION 'TIDAK_DITOLAK_revisi_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO pkr_item_revisions (id, order_id, penjualan_id, revision, kind, after_items, idempotency_key) VALUES (gen_random_uuid(), ord, pkr, 2, 'DILENGKAPI', '[]'::jsonb, 'uji-kunci-1'); RAISE EXCEPTION 'TIDAK_DITOLAK_kunci_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  INSERT INTO pkr_item_revisions (id, order_id, penjualan_id, revision, kind, reason, after_items) VALUES (gen_random_uuid(), ord, pkr, 2, 'DIKOREKSI', 'Alasan koreksi uji rehearsal', '[]'::jsonb); lolos := lolos + 1;
  BEGIN UPDATE pkr_item_revisions SET reason = 'diubah' WHERE id = r1; RAISE EXCEPTION 'TIDAK_DITOLAK_update_revisi';
  EXCEPTION WHEN restrict_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM pkr_item_revisions WHERE id = r1; RAISE EXCEPTION 'TIDAK_DITOLAK_delete_revisi';
  EXCEPTION WHEN restrict_violation THEN tolak := tolak + 1; END;
  -- (5) komposisi bundel: qty di luar 1..20 ditolak; kombinasi komponen unik (NULL varian dianggap satu nilai)
  BEGIN INSERT INTO pkr_bundle_components (id, bundle_category_id, component_category_id, qty, updated_at) VALUES (gen_random_uuid(), (SELECT id FROM pkr_item_categories WHERE code='SET_LENGKAP'), cat, 0, now()); RAISE EXCEPTION 'TIDAK_DITOLAK_komposisi_qty';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO pkr_bundle_components (id, bundle_category_id, component_category_id, qty, updated_at) VALUES (gen_random_uuid(), (SELECT id FROM pkr_item_categories WHERE code='SET_LENGKAP'), cat, 1, now()); RAISE EXCEPTION 'TIDAK_DITOLAK_komposisi_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  -- (6) pengiriman sebagian: alasan wajib; kunci idempotensi unik per order
  BEGIN INSERT INTO pkr_pengiriman_sebagian (id, order_id, penjualan_id, job_id, unit_ids, unit_codes, unit_ditunda, reason, idempotency_key) VALUES (gen_random_uuid(), ord, pkr, job, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'x', 'uji-sebagian-0'); RAISE EXCEPTION 'TIDAK_DITOLAK_sebagian_tanpa_alasan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO pkr_pengiriman_sebagian (id, order_id, penjualan_id, job_id, unit_ids, unit_codes, unit_ditunda, reason, idempotency_key) VALUES (gen_random_uuid(), ord, pkr, job, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'Alasan sah uji rehearsal', 'uji-sebagian-1'); lolos := lolos + 1;
  BEGIN INSERT INTO pkr_pengiriman_sebagian (id, order_id, penjualan_id, job_id, unit_ids, unit_codes, unit_ditunda, reason, idempotency_key) VALUES (gen_random_uuid(), ord, pkr, job, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'Alasan sah uji rehearsal', 'uji-sebagian-1'); RAISE EXCEPTION 'TIDAK_DITOLAK_sebagian_kunci_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  -- (7) enum baru dapat dipakai
  PERFORM 'CAMPURAN'::"OrderCategory"; lolos := lolos + 1;
  RAISE NOTICE 'HASIL tolak=% lolos=% lewat=%', tolak, lolos, lewat;
  RAISE EXCEPTION 'ROLLBACK_UJI';
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint/trigger SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*HASIL tolak=\([0-9]*\) lolos=\([0-9]*\) lewat=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*HASIL tolak=\([0-9]*\) lolos=\([0-9]*\) lewat=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 17 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti terlalu sedikit (${UJI_TOLAK:-?}; minimal 17) — constraint/trigger tidak aktif atau data contoh kurang"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" -ge 7 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos terlalu sedikit (${UJI_LOLOS:-?}; minimal 7)"; }
ok "perilaku terbukti di DB rehearsal: $(printf '%s\n' "$UJI_OUT" | sed -n 's/.*HASIL \(.*\)/\1/p' | sed -n 1p) — CHECK menolak data salah; riwayat revisi append-only; unik per order/kunci; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from pkr_order_items")" = "0" ] && [ "$(RPSQL "select count(*) from pkr_item_revisions")" = "0" ] && [ "$(RPSQL "select count(*) from units where work_category is not null")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
reh_drop
ok "rehearsal lulus: isi 15 tabel lama IDENTIK sebelum vs sesudah migrasi + uji perilaku (sidik jari baris penuh tanpa kolom baru); tabel transaksi baru kosong; DB sementara dihapus"

PHASE="6-migrate"; say "6. Migrasi aditif (image baru; backend lama tetap melayani)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum migrasi"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum migrasi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
for m in $MIG_LIST; do grep -Fx "$m" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${m} SUDAH terpasang sebelum rilis (tidak diharapkan)"; done
PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") || true)"
[ "$(printf '%s\n' "$PENDING" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || die "migrasi pending bukan tepat 3 migrasi rilis ini: $(printf '%s' "$PENDING" | tr '\n' ' ')"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
for m in $MIG_LIST; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 3 ))" ] || die "jumlah migrasi terpasang != sebelum + 3"
ok "3 migrasi diterapkan; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"
# SETELAH migrasi, SEBELUM switch: hanya backend LAMA yang melayani dan ia tidak mengenal tabel/kolom baru → tabel transaksi baru HARUS kosong dan kolom baru units NULL (tanpa backfill).
for T in pkr_order_items pkr_order_item_units pkr_item_revisions pkr_pengiriman_sebagian; do
  [ "$(psql_live -At -c "select count(*) from $T")" = "0" ] || die "tabel baru $T TIDAK kosong setelah migrasi sebelum switch"
done
[ "$(psql_live -At -c "select count(*) from units where work_category is not null or product_line is not null or product_type is not null")" = "0" ] || die "ada unit dengan kolom baru terisi setelah migrasi sebelum switch"
[ "$(psql_live -At -c "select count(*) from \"Order\" where category::text = 'CAMPURAN'")" = "0" ] || die "ada order CAMPURAN sebelum switch"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari dokumen beku pasca-migrasi gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: tabel transaksi baru kosong, units kolom baru NULL (tanpa backfill), dokumen pembanding beku identik"

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
[ "$NBE" -ge 15 ] || die "terlalu sedikit berkas backend yang diverifikasi (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
[ "$(PSQLN "select count(*) from information_schema.tables where table_schema='public' and table_name in ('pkr_item_categories','pkr_item_products','pkr_order_items','pkr_order_item_units','pkr_bundle_components','pkr_item_revisions','pkr_pengiriman_sebagian')")" = "7" ] || die "tujuh tabel PKR multi-item tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_trigger where tgname='pkr_item_revisions_append_only_trg' and not tgisinternal")" = "1" ] || die "trigger append-only tidak ada setelah rilis"
ok "tujuh tabel dan trigger append-only ada (tidak ada asumsi tentang dokumen baru: order multi-item yang sah boleh sudah muncul)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test izin + pembacaan + invarian (baca-saja; tidak menulis; tahan terhadap transaksi sah yang muncul saat rilis)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
// SMOKE BACA-SAJA. Tanpa asumsi global: transaksi operasional sah yang muncul saat deploy TIDAK membuat smoke gagal. Pembanding = invarian yang berlaku untuk keadaan data apa pun.
// Tidak menulis: setiap pemanggilan tulis lewat API memakai token tanpa izin / tanpa Idempotency-Key dan WAJIB dijawab 400/401/403/428.
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const bukuTulis = [];
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  if (method !== "GET") bukuTulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status });
  return { status: r.status, json };
}
const tokenUntuk = async (user) => {
  const roles = (await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } })).map((r) => r.role);
  return jwt.sign({ id: user.id, name: user.name, role: user.role, roles: roles.length ? roles : [user.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });
};
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER", "DISPATCHER", "PRODUCTION_LEAD"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) {
    const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
    if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u;
  }
  return null;
}
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
const finMurni = await userDengan("FINANCE", new Set(["ADMIN", "OWNER"]));
if (!adm || !sales) { rec("akun ADMIN dan SALES murni tersedia", false, `adm=${!!adm} sales=${!!sales}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const tF = finMurni ? await tokenUntuk(finMurni) : null;
const nol = "00000000-0000-4000-8000-000000000000";
const nolOrder = "c000000000000000000000000";
const BASEF = "/api/finance/penjualan-karyawan";
const hitungSql = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);

// ── Katalog: izin & isi ──
rec("katalog (baca): tanpa token -> 401, SALES -> 403", (await api("GET", `${BASEF}/katalog-item`)).status === 401 && (await api("GET", `${BASEF}/katalog-item`, tS)).status === 403);
const kat = await api("GET", `${BASEF}/katalog-item`, tA);
rec("katalog (baca): admin -> 200 dengan 6 kategori awal + definisi bentuk (SET = bundel)", kat.status === 200 && ["KASUR_BARU", "SERVICE_UPGRADE", "DIVAN_BOX", "SANDARAN", "SET_LENGKAP", "CUSTOM_LAINNYA"].every((k) => kat.json?.kategori?.some((c) => c.kode === k)) && kat.json?.bentuk?.SET?.bundel === true, `${kat.json?.kategori?.length} kategori`);
const setKat = kat.json?.kategori?.find((c) => c.kode === "SET_LENGKAP");
rec("Set Kasur Lengkap: komposisi awal = Kasur + Divan + Sandaran", JSON.stringify((setKat?.komposisi ?? []).map((k) => k.kategoriKode)) === JSON.stringify(["KASUR_BARU", "DIVAN_BOX", "SANDARAN"]));
rec("pemetaan rute literal terpasang: Divan -> DIVAN/DIVAN_UTAMA, Sandaran -> DIVAN/DIVAN_SANDARAN", kat.json?.kategori?.find((c) => c.kode === "DIVAN_BOX")?.pemetaan?.productType === "DIVAN_UTAMA" && kat.json?.kategori?.find((c) => c.kode === "SANDARAN")?.pemetaan?.productType === "DIVAN_SANDARAN");
const kel = await api("GET", `${BASEF}/katalog-item/kelola`, tA);
rec("katalog (kelola): admin -> 200", kel.status === 200 && Array.isArray(kel.json?.ringkasan?.belumDipetakan));
rec("katalog (kelola): SALES -> 403, tanpa token -> 401", (await api("GET", `${BASEF}/katalog-item/kelola`, tS)).status === 403 && (await api("GET", `${BASEF}/katalog-item/kelola`)).status === 401);
if (tF) rec("katalog (kelola): FINANCE murni (tanpa pkr_catalog:manage) -> 403", (await api("GET", `${BASEF}/katalog-item/kelola`, tF)).status === 403);
else skip("katalog (kelola): FINANCE murni -> 403", "tidak ada akun FINANCE murni (aktif, tanpa ADMIN/OWNER); akun/token tidak dibuat atau direkayasa — izin dijaga tes integrasi + tes matriks izin");
for (const b of (kel.json?.ringkasan?.belumDipetakan ?? []).slice(0, 25)) console.log(`  INFO  PERLU DIPETAKAN ADMIN: ${b.tipe === "KATEGORI" ? "kategori" : "produk"} ${b.nama}${b.kategori ? ` (${b.kategori})` : ""}`);
console.log(`  INFO  ${kel.json?.ringkasan?.belumDipetakan?.length ?? "?"} produk/kategori aktif belum dipetakan rute Produksinya — order yang memakainya diblokir sampai Admin memetakan`);

// ── Penulisan: SEMUA ditolak izin/idempotensi SEBELUM menyentuh data ──
const kunci = (n) => ({ "Idempotency-Key": `smoke-pkrm-${n}` });
await api("PUT", `${BASEF}/katalog-item/komposisi`, tS, { kategoriId: nol, komponen: [] }, kunci("komp-sales"));
await api("POST", `${BASEF}/katalog-item/kategori`, tS, { kode: "XX", nama: "XX", bentuk: "KASUR", jenisKerja: "BARU" }, kunci("kat-sales"));
await api("POST", `${BASEF}/${nol}/koreksi-item`, tS, { operasi: [{ op: "hapus", no: 1 }], expectedRevision: 1, alasan: "uji smoke" }, kunci("kor-sales"));
await api("POST", `${BASEF}/${nol}/koreksi-item`, tA, { operasi: [{ op: "hapus", no: 1 }], expectedRevision: 1, alasan: "uji smoke" }); // tanpa Idempotency-Key -> 428 sebelum menyentuh data
await api("POST", `/api/armada/pkr-pengiriman/${nolOrder}/kirim-sebagian`, tS, { unitIds: [nol], alasan: "uji smoke" }, kunci("kirim-sales"));
await api("POST", `/api/armada/pkr-pengiriman/${nolOrder}/kirim-sebagian`, tA, { unitIds: [nol], alasan: "uji smoke" }); // tanpa Idempotency-Key -> 428
const SAH = new Set([400, 401, 403, 428]);
rec(`semua ${bukuTulis.length} pemanggilan tulis ditolak sebelum menyentuh data (hanya 400/401/403/428): smoke TIDAK menulis data produksi`, bukuTulis.length === 6 && bukuTulis.every((b) => SAH.has(b.status)), bukuTulis.map((b) => `${b.n}=${b.status}`).join("; "));
rec("penerapan koreksi tanpa Idempotency-Key -> 428 IDEMPOTENCY_KEY_REQUIRED", bukuTulis.find((b) => b.n.includes("koreksi-item") && b.status === 428) !== undefined);

// ── Pratinjau & pembacaan (read-only) ──
const sebelum = { order: await hitungSql(`select count(*)::int n from "Order"`), unit: await hitungSql(`select count(*)::int n from units`), item: await hitungSql(`select count(*)::int n from pkr_order_items`), pkr: await hitungSql(`select count(*)::int n from fin_penjualan_karyawan`) };
const pr = await api("POST", `${BASEF}/order-crm/pratinjau`, tA, { orderCrm: { items: [{ kategori: "SET_LENGKAP", jumlah: 1, perluDikirim: false }] } });
rec("pratinjau Set (bundel) -> 200 dengan valid boolean (baca-saja)", pr.status === 200 && typeof pr.json?.valid === "boolean", `valid=${pr.json?.valid}`);
const salah = await api("POST", `${BASEF}/order-crm/pratinjau`, tA, { orderCrm: { items: [{ kategori: "TIDAK_ADA", jumlah: 1 }] } });
rec("pratinjau kategori tak dikenal -> 200 valid:false KATEGORI_WAJIB (bukan 500)", salah.status === 200 && salah.json?.valid === false && salah.json?.galat?.kode === "KATEGORI_WAJIB");
rec("pratinjau SALES -> 403", (await api("POST", `${BASEF}/order-crm/pratinjau`, tS, { orderCrm: { items: [] } })).status === 403);
const setelah = { order: await hitungSql(`select count(*)::int n from "Order"`), unit: await hitungSql(`select count(*)::int n from units`), item: await hitungSql(`select count(*)::int n from pkr_order_items`), pkr: await hitungSql(`select count(*)::int n from fin_penjualan_karyawan`) };
console.log(`  INFO  jumlah sebelum/sesudah pratinjau (pratinjau tidak menulis; selisih hanya mungkin dari transaksi sah yang bersamaan): ${JSON.stringify({ sebelum, setelah })}`);
const korP = await api("POST", `${BASEF}/${nol}/koreksi-item/pratinjau`, tA, { operasi: [{ op: "hapus", no: 1 }], expectedRevision: 1 });
rec("pratinjau koreksi id tak dikenal -> 200 valid:false (bukan 500; tanpa Idempotency-Key; tanpa menulis)", korP.status === 200 && korP.json?.valid === false, `${korP.status}/${korP.json?.valid}`);
const pen = await api("GET", `/api/armada/pkr-pengiriman`, tA);
rec("Delivery: daftar order PKR menunggu unit lain -> 200 (admin)", pen.status === 200 && Array.isArray(pen.json?.menunggu), `${pen.json?.menunggu?.length} order`);
rec("Delivery: SALES -> 403", (await api("GET", `/api/armada/pkr-pengiriman`, tS)).status === 403);

// ── Kompatibilitas order PKR lama ──
const daftar = await api("GET", `${BASEF}?limit=50`, tA);
const lama = (daftar.json?.penjualan ?? []).filter((p) => p.sinkron?.order && p.sinkron.order.modeItem === false);
rec("daftar PKR -> 200; order lama (tanpa item) tetap terbaca dengan item virtual", daftar.status === 200 && lama.every((p) => p.sinkron.items?.length === 1 && p.sinkron.items[0].virtual === true), `${lama.length} order lama dari ${daftar.json?.penjualan?.length} PKR`);

// ── Invarian basis data (berlaku untuk data apa pun, termasuk nol order multi-item) ──
rec("unit bertanda work_category selalu punya tautan item", (await hitungSql(`select count(*)::int n from units u where u.work_category is not null and not exists (select 1 from pkr_order_item_units l where l.unit_id = u.id)`)) === 0);
rec("item aktif: qty = jumlah unit tertaut yang belum dibatalkan", (await hitungSql(`select count(*)::int n from pkr_order_items i where i.removed_at is null and i.qty <> (select count(*) from pkr_order_item_units l join units u on u.id = l.unit_id where l.item_id = i.id and u.status::text <> 'CANCELLED')`)) === 0);
rec("item dihapus: semua unit tertaut berstatus CANCELLED", (await hitungSql(`select count(*)::int n from pkr_order_items i where i.removed_at is not null and exists (select 1 from pkr_order_item_units l join units u on u.id = l.unit_id where l.item_id = i.id and u.status::text <> 'CANCELLED')`)) === 0);
rec("revisi item: nomor berurutan 1..n per order dan revisi pertama = DIBUAT", (await hitungSql(`select count(*)::int n from (select order_id, count(*) c, max(revision) m, min(revision) mn, (array_agg(kind order by revision))[1] k from pkr_item_revisions group by order_id) x where x.c <> x.m or x.mn <> 1 or x.k <> 'DIBUAT'`)) === 0);
rec("setiap order multi-item punya buku revisi", (await hitungSql(`select count(*)::int n from (select distinct order_id from pkr_order_items) o where not exists (select 1 from pkr_item_revisions r where r.order_id = o.order_id)`)) === 0);
rec("order CAMPURAN memuat item BARU dan LAYANAN aktif", (await hitungSql(`select count(*)::int n from "Order" o where o.category::text = 'CAMPURAN' and not (exists (select 1 from pkr_order_items i where i.order_id = o.id and i.removed_at is null and i.work_kind = 'BARU') and exists (select 1 from pkr_order_items i where i.order_id = o.id and i.removed_at is null and i.work_kind = 'LAYANAN'))`)) === 0);
rec("order multi-item: job pengiriman hidup tambahan hanya lewat aksi kirim sebagian yang tercatat", (await hitungSql(`select count(*)::int n from (select j.order_id, count(*) c from jobs j where j.type::text = 'DELIVERY' and not (j.status::text = 'FAILED' and exists (select 1 from delivery_job_cancellations_v2 x where x.job_id = j.id)) and j.order_id in (select distinct order_id from pkr_order_items) group by j.order_id) a where a.c > 1 + (select count(*) from pkr_pengiriman_sebagian s where s.order_id = a.order_id)`)) === 0);
rec("tak ada unit order multi-item di dua job pengiriman hidup", (await hitungSql(`select count(*)::int n from (select ju.unit_id from job_units ju join jobs j on j.id = ju.job_id where j.type::text = 'DELIVERY' and not (j.status::text = 'FAILED' and exists (select 1 from delivery_job_cancellations_v2 x where x.job_id = j.id)) and ju.unit_id in (select unit_id from pkr_order_item_units) group by ju.unit_id having count(*) > 1) d`)) === 0);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal, ${dilewati} dilewati (SKIP)`);
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log (akun peran-murni tidak ada; tidak ada akun/token dibuat atau direkayasa). Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else
  ok "smoke test lulus (izin katalog/koreksi/Delivery, katalog & komposisi Set, penulisan ditolak sebelum menyentuh data, pratinjau baca-saja, order lama terbaca, invarian basis data)"
fi
grep '  INFO  PERLU DIPETAKAN ADMIN' "$BK_DIR/smoke.log" | sed 's/^  INFO  /  PERHATIAN OWNER: /' || true
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
ok "dokumen pembanding beku (PKR batal, order/unit/job terminal, jurnal, saldo per akun, flag) IDENTIK sebelum vs sesudah rilis; transaksi sah yang muncul saat rilis tidak diperbandingkan"
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
say "TINDAK LANJUT OWNER: Admin memetakan rute Produksi produk/kategori di Pengaturan Produksi > Katalog Item PKR (lihat daftar PERHATIAN OWNER di atas); order dengan produk belum dipetakan diblokir."
