#!/usr/bin/env bash
# RILIS "PO UANG MUKA SUPPLIER + EMPAT STATUS PO": web + backend + 1 migrasi ADITIF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Uang Muka Supplier = FinPurchase kategori UANG_MUKA_PEMBELIAN tertaut PO (kolom baru fin_purchases.purchase_order_id/payment_reference/advance_over_po_reason, semua NULL) dan
#   tabel baru fin_supplier_bill_advance_applications (kosong) untuk alokasi uang muka ke faktur. Detail PO: empat status (barang/faktur/utang/pembayaran), rincian uang muka dibayar,
#   uang muka dialokasikan ke faktur, pembayaran faktur, sisa utang; PO tanpa faktur disetujui TIDAK berlabel Lunas. Pembayaran awal tidak membuat stok/GRNI/utang faktur.
#   Migrasi: 1 tabel kosong + 3 kolom NULL pada fin_purchases + 2 CHECK. Tanpa backfill. Tanpa perubahan data lama.
# Produksi: verifikasi hanya baca + penolakan izin; TIDAK ada pembayaran uang muka, alokasi, atau transaksi QA di produksi. Perilaku constraint diuji di DB REHEARSAL (hasil restore backup) lalu dibatalkan.
#
#   cat scripts/release-po-uang-muka.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/pum1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/pum1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pum1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/pum1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode aman di-rollback HANYA bila belum ada uang muka tertaut PO / penerapan ke faktur. Periksa dulu dengan scripts/rollback-guard-po-uang-muka.sh (baca-saja).
#   Bila sudah ada data: kode lama tidak mengenal tabel penerapan — penerapan aktif tetap terbaca lewat credit_applied faktur, tetapi pembatalan/koreksi uang muka bisa meninggalkan penerapan yatim.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/finance-po-uang-muka-supplier}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261116090000_uang_muka_supplier_po:1dc940c848caf15c659e75fb096e0cb35893a9ffe0113e6d7657ea3adc136ea9"
# Hasil pemindai untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":17,"tabel":1,"indeks":6,"kolom":1,"fk":7,"check":2}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="10b63fbd3b43d3a78ae12e3d332144af6074738617e5ceb0bef1a2e7890b1f66"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261116090000_uang_muka_supplier_po/migration\.sql|backend/prisma/schema\.prisma|backend/src/routes/financeTransactions\.js|backend/src/routes/purchaseOrders\.js|backend/src/services/finance/export/registry\.js|backend/src/services/finance/export/supplier-utang\.js|backend/src/services/finance/export/uang-muka-supplier\.js|backend/src/services/finance/kontrakMetrik\.js|backend/src/services/finance/posting/uangMukaSupplier\.js|backend/src/services/finance/purchaseOrder\.js|backend/src/services/finance/statusEmpatPO\.js|backend/src/services/finance/uangMukaSupplier\.js|backend/tests/integration/poAlurEmpatStatus\.integration\.test\.js|backend/tests/integration/uangMukaSupplierPO\.integration\.test\.js|backend/tests/statusEmpatPO\.test\.js|docs/FINANCE-EXPORT-COVERAGE\.md|frontend/src/api\.js|frontend/src/features/finance/UangMukaPO\.jsx|frontend/src/features/finance/UangMukaSupplierTabel\.jsx|frontend/src/features/finance/purchaseOrderLogic\.js|frontend/src/features/finance/uangMukaLogic\.js|frontend/src/features/warehouse/components/GoodsReceiptDetailDrawer\.jsx|frontend/src/pages/finance/FinancePurchaseOrders\.jsx|frontend/src/pages/finance/FinancePurchases\.jsx|frontend/src/pages/finance/FinanceSuppliers\.jsx|frontend/tests/financeExportCoverage\.test\.js|frontend/tests/uangMukaSupplier\.test\.js|scripts/release-po-uang-muka\.sh|scripts/rollback-guard-po-uang-muka\.sh)$'
BACKEND_SRC_EXPECT="backend/src/routes/financeTransactions.js backend/src/routes/purchaseOrders.js backend/src/services/finance/export/registry.js backend/src/services/finance/export/supplier-utang.js backend/src/services/finance/export/uang-muka-supplier.js backend/src/services/finance/kontrakMetrik.js backend/src/services/finance/posting/uangMukaSupplier.js backend/src/services/finance/purchaseOrder.js backend/src/services/finance/statusEmpatPO.js backend/src/services/finance/uangMukaSupplier.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/finance/UangMukaPO.jsx frontend/src/features/finance/UangMukaSupplierTabel.jsx frontend/src/features/finance/purchaseOrderLogic.js frontend/src/features/finance/uangMukaLogic.js frontend/src/features/warehouse/components/GoodsReceiptDetailDrawer.jsx frontend/src/pages/finance/FinancePurchaseOrders.jsx frontend/src/pages/finance/FinancePurchases.jsx frontend/src/pages/finance/FinanceSuppliers.jsx"
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
BK_DIR="$HOME/release-backups/po-uang-muka-${DEPLOY_SHORT}-${TS}"
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
   bash ${NEW_DIR}/scripts/rollback-guard-po-uang-muka.sh
Guard menolak (exit 1) bila SUDAH ada data yang hanya dipahami kode baru:
   - uang muka tertaut PO (fin_purchases.purchase_order_id) dan/atau penerapan uang muka ke faktur (fin_supplier_bill_advance_applications).
   Bila guard menolak: JANGAN rollback ke kode lama (penerapan yatim, jurnal Dr Utang / Cr Uang Muka tanpa jalur batal). Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner.
Bila guard lulus (belum ada data fitur), rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi bersifat ADITIF (1 tabel kosong + 3 kolom NULL): dibiarkan terpasang pun aman bagi kode lama SELAMA belum ada data fitur. (Tidak dihapus oleh rollback kode.)
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
exec 9>/tmp/release-po-uang-muka.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "pum1\|release-po-uang-muka\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
! printf '%s\n' "$CHANGED" | grep -qx 'backend/src/index.js' || die "backend/src/index.js berubah (dipatok tes atribusi)"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
NBE_EXPECT="$(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w)"
MIG_LIST=""; EXPECT_PRISMA=""; NLX="$(printf '\nx')"; NLX="${NLX%x}"
for e in $MIGS; do MIG_LIST="$MIG_LIST ${e%%:*}"; EXPECT_PRISMA="${EXPECT_PRISMA:+${EXPECT_PRISMA}${NLX}}backend/prisma/migrations/${e%%:*}/migration.sql"; done
EXPECT_PRISMA="${EXPECT_PRISMA}${NLX}backend/prisma/schema.prisma"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat migrasi rilis ini (1 migrasi + schema.prisma yang diaudit)"; }
# Migrasi yang sudah ada di baseline TIDAK boleh diubah/dihapus (yang sudah pernah diterapkan di produksi): hanya penambahan.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
[ "$(sg diff -U0 --no-color "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | grep -v '^index ' | { cat; echo; } | sha256sum | cut -d' ' -f1)" = "$SCHEMA_DIFF_SHA" ] || die "diff schema.prisma BERBEDA dari yang diaudit (pin SCHEMA_DIFF_SHA) — audit ulang";
ok "schema.prisma: diff identik dengan yang diaudit (aditif: model/relasi baru, tanpa mengubah kolom lama)"
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
// Pemindai migrasi rilis "PO Uang Muka Supplier" (1 migrasi aditif). FAIL-CLOSED: setiap pernyataan harus cocok PERSIS salah satu bentuk yang diaudit.
//  - CREATE TABLE hanya "fin_supplier_bill_advance_applications"; CREATE [UNIQUE] INDEX hanya pada tabel itu + "fin_purchases".
//  - ALTER TABLE "fin_purchases" ADD COLUMN tepat 3 kolom nullable (purchase_order_id UUID, payment_reference VARCHAR(120), advance_over_po_reason TEXT) dalam SATU pernyataan.
//  - FK: dari "fin_purchases" hanya ke fin_purchase_orders (RESTRICT); dari tabel baru hanya ke fin_purchases/fin_supplier_bills/fin_journal_entries (RESTRICT, jurnal balik SET NULL)/"User" (SET NULL).
//  - Dua CHECK pada tabel baru (nominal positif; status ACTIVE <-> ada jurnal balik).
// Tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/ALTER COLUMN/RENAME/GRANT/ENUM/FUNGSI/TRIGGER, tidak ada kolom lain pada tabel lama.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };
function pecah(t) {
  const out = []; let cur = "";
  for (let i = 0; i < t.length; i += 1) { const c = t[i]; if (c === ";") { out.push(cur); cur = ""; } else cur += c; }
  if (rapat(cur)) out.push(cur);
  return out.map(rapat).filter(Boolean);
}
const KOLOM = "ALTER TABLE \"fin_purchases\" ADD COLUMN \"purchase_order_id\" UUID, ADD COLUMN \"payment_reference\" VARCHAR(120), ADD COLUMN \"advance_over_po_reason\" TEXT";
const CHECK_NOMINAL = "ALTER TABLE \"fin_supplier_bill_advance_applications\" ADD CONSTRAINT \"fin_sb_adv_app_amount_pos_chk\" CHECK (\"amount\" > 0)";
const CHECK_BALIK = "ALTER TABLE \"fin_supplier_bill_advance_applications\" ADD CONSTRAINT \"fin_sb_adv_app_reversal_chk\" CHECK ((\"status\" = 'ACTIVE' AND \"reversal_journal_id\" IS NULL) OR (\"status\" = 'REVERSED' AND \"reversal_journal_id\" IS NOT NULL))";
const BENTUK = [
  ["tabel", /^CREATE TABLE "fin_supplier_bill_advance_applications" \([^;]*\)$/],
  ["indeks", /^CREATE (UNIQUE )?INDEX "[A-Za-z0-9_]+" ON "(fin_purchases|fin_supplier_bill_advance_applications)"\("[a-z_]+"(, "[a-z_]+")*\)$/],
  ["fk", /^ALTER TABLE "(fin_purchases|fin_supplier_bill_advance_applications)" ADD CONSTRAINT "[A-Za-z0-9_]+" FOREIGN KEY \("[a-z_]+"\) REFERENCES "(fin_purchase_orders|fin_purchases|fin_supplier_bills|fin_journal_entries|User)"\("id"\) ON DELETE (RESTRICT|SET NULL) ON UPDATE CASCADE$/],
];
const hitung = { total: 0, tabel: 0, indeks: 0, kolom: 0, fk: 0, check: 0 };
const lihat = new Set();
for (const r of pecah(sql)) {
  hitung.total += 1;
  if (lihat.has(r)) gagal("pernyataan ganda: " + r.slice(0, 120));
  lihat.add(r);
  if (r === KOLOM) { hitung.kolom += 1; continue; }
  if (r === CHECK_NOMINAL || r === CHECK_BALIK) { hitung.check += 1; continue; }
  const b = BENTUK.find(([, re]) => re.test(r));
  if (!b) gagal("PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 200));
  if (b[0] === "fk") {
    // FK dari tabel LAMA (fin_purchases) hanya boleh ke fin_purchase_orders RESTRICT; tabel baru tidak boleh CASCADE.
    if (/^ALTER TABLE "fin_purchases"/.test(r) && !(/REFERENCES "fin_purchase_orders"\("id"\) ON DELETE RESTRICT/.test(r))) gagal("FK dari fin_purchases hanya boleh ke fin_purchase_orders RESTRICT: " + r.slice(0, 160));
    if (/ON DELETE CASCADE/.test(r)) gagal("CASCADE tidak diizinkan: " + r.slice(0, 160));
  }
  if (b[0] === "indeks" && /ON "fin_purchases"/.test(r) && !/\("purchase_order_id"\)$/.test(r)) gagal("indeks pada tabel lama hanya boleh purchase_order_id: " + r.slice(0, 160));
  hitung[b[0]] += 1;
}
console.log(JSON.stringify(hitung));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (1 tabel baru kosong, 3 kolom NULL pada fin_purchases, 6 indeks, 7 FK tanpa CASCADE, 2 CHECK); tanpa DROP/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT/fungsi/trigger"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE tabel lama" "$(tambah_stmt 'DROP TABLE "fin_purchases";')"
harus_ditolak "DROP TABLE tabel baru" "$(tambah_stmt 'DROP TABLE "fin_supplier_bill_advance_applications";')"
harus_ditolak "UPDATE tabel lama (fin_purchases)" "$(tambah_stmt "UPDATE \"fin_purchases\" SET \"amount\" = 0;")"
harus_ditolak "UPDATE tabel lama (fin_supplier_bills)" "$(tambah_stmt "UPDATE \"fin_supplier_bills\" SET \"credit_applied\" = 0;")"
harus_ditolak "DELETE tabel lama" "$(tambah_stmt 'DELETE FROM "fin_journal_lines";')"
harus_ditolak "INSERT" "$(tambah_stmt "INSERT INTO \"fin_settings\" (key) VALUES ('x');")"
harus_ditolak "INSERT ... SELECT (backfill)" "$(tambah_stmt 'INSERT INTO "fin_supplier_bill_advance_applications" SELECT * FROM "fin_supplier_bill_advance_applications";')"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "fin_supplier_bill_advance_applications";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "fin_purchases" DROP COLUMN "amount";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "fin_purchases" ALTER COLUMN "amount" TYPE BIGINT;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "fin_purchases" RENAME COLUMN "amount" TO "nominal";')"
harus_ditolak "kolom liar pada fin_purchases" "$(tambah_stmt 'ALTER TABLE "fin_purchases" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom pada tabel lain (fin_supplier_bills)" "$(tambah_stmt 'ALTER TABLE "fin_supplier_bills" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom NOT NULL (bukan nullable)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ADD COLUMN "payment_reference" VARCHAR(120)/ADD COLUMN "payment_reference" VARCHAR(120) NOT NULL/')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "indeks pada tabel lama lain" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "fin_supplier_bills"("status");')"
harus_ditolak "indeks liar pada fin_purchases" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "fin_purchases"("amount");')"
harus_ditolak "FK dari fin_purchases ke tabel lain" "$(tambah_stmt 'ALTER TABLE "fin_purchases" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "FK dari fin_purchases dengan CASCADE" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "fin_purchase_orders"("id") ON DELETE RESTRICT/REFERENCES "fin_purchase_orders"("id") ON DELETE CASCADE/')"
harus_ditolak "FK tabel baru CASCADE" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "fin_supplier_bills"("id") ON DELETE RESTRICT/REFERENCES "fin_supplier_bills"("id") ON DELETE CASCADE/')"
harus_ditolak "CHECK nominal dilonggarkan" "$(printf '%s\n' "$ALL_SQL" | sed 's/CHECK ("amount" > 0)/CHECK ("amount" >= 0)/')"
harus_ditolak "CHECK jurnal balik dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'fin_sb_adv_app_reversal_chk')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "fin_purchases" DROP CONSTRAINT "fin_purchases_pkey";')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"FinAdvanceApplicationStatus\" ADD VALUE IF NOT EXISTS 'LIAR';")"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "fin_purchases" TO PUBLIC;')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "trigger liar" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "fin_purchases" FOR EACH ROW EXECUTE FUNCTION evil();')"
harus_ditolak "pernyataan ganda" "$(tambah_stmt 'CREATE INDEX "fin_purchases_purchase_order_id_idx" ON "fin_purchases"("purchase_order_id");')"
[ "$NEG" -ge 24 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 24)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER COLUMN/RENAME/kolom liar/NOT NULL/tabel-indeks-FK liar/CASCADE/CHECK longgar/GRANT/fungsi-trigger liar) SEMUANYA ditolak"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit (termasuk 1 migrasi aditif + schema.prisma yang diaudit)"

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
# Prasyarat skema: tabel yang disentuh HARUS sudah ada; objek rilis ini belum boleh ada.
for T in fin_purchases fin_purchase_orders fin_purchase_categories fin_supplier_bills fin_supplier_payments fin_supplier_payment_allocations fin_purchase_advance_applications fin_journal_entries fin_journal_lines fin_settings "User"; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='fin_supplier_bill_advance_applications'")" = "0" ] || die "tabel fin_supplier_bill_advance_applications SUDAH ada di produksi (tidak diharapkan sebelum rilis)"
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='fin_purchases' and column_name in ('purchase_order_id','payment_reference','advance_over_po_reason')")" = "0" ] || die "kolom uang muka PO SUDAH ada di fin_purchases (tidak diharapkan sebelum rilis)"
for m in $MIG_LIST; do [ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${m}'")" = "0" ] || die "migrasi ${m} SUDAH tercatat di produksi (tidak diharapkan)"; done
PO_N="$(psql_live -At -c "select count(*) from fin_purchase_orders")"
BILL_N="$(psql_live -At -c "select count(*) from fin_supplier_bills")"
PURCH_N="$(psql_live -At -c "select count(*) from fin_purchases")"
PAY_N="$(psql_live -At -c "select count(*) from fin_supplier_payments")"
for v in "$PO_N" "$BILL_N" "$PURCH_N" "$PAY_N"; do [[ "$v" =~ ^[0-9]+$ ]] || die "audit awal bukan angka: '$v'"; done
[ "$PURCH_N" -ge 1 ] && [ "$BILL_N" -ge 1 ] || die "data contoh produksi kurang untuk uji perilaku rehearsal (butuh >=1 pembelian dan >=1 faktur)"
ok "prasyarat skema terpenuhi; PO=${PO_N}, faktur=${BILL_N}, pembelian=${PURCH_N}, pembayaran supplier=${PAY_N}; objek rilis ini belum ada — tanpa backfill"
# GARIS DASAR invarian (dibandingkan sesudah rilis; yang dijaga = TIDAK BERTAMBAH oleh rilis ini).
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
SQL_GANDA="select count(*)::int from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"; BASE_GANDA="$(psql_live -At -c "$SQL_GANDA")"
for v in "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA"; do [[ "$v" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$v'"; done
printf 'BASE_TIDAK_SEIMBANG=%s BASE_GANDA=%s PO_N=%s BILL_N=%s PURCH_N=%s\n' "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA" "$PO_N" "$BILL_N" "$PURCH_N" > "$BK_DIR/garis-dasar.env"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}; refund dengan >1 jurnal berlaku = ${BASE_GANDA}"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel. Membuktikan restore identik dan migrasi tidak mengubah data lama (rilis ini tidak menambah kolom pada tabel lama).
FP_SQL="select 'fin_purchases', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'purchase_order_id' - 'payment_reference' - 'advance_over_po_reason')::text, '|' order by x.id),'')) from fin_purchases x
union all select 'fin_supplier_bills', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bills x
union all select 'fin_purchase_orders', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_orders x
union all select 'fin_purchase_order_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_order_lines x
union all select 'fin_supplier_payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_payments x
union all select 'fin_supplier_payment_allocations', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_payment_allocations x
union all select 'fin_purchase_advance_applications', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_advance_applications x
union all select 'goods_receipts', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipts x
union all select 'stock_movements', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x
union all select 'fin_journal_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_entries x
union all select 'fin_journal_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x
union all select 'fin_settings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from fin_settings x"
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
BACKUP_FILE="$HOME/backups/pre-po-uang-muka-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-po-uang-muka.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Uang muka dialokasikan ke faktur" "Total kas keluar" "Riwayat pembayaran ke supplier atas PO ini" "Lihat riwayat pembayaran" "Bayar Uang Muka" "Terapkan Uang Muka" "Faktur disetujui" "Uang Muka Supplier Belum Diterapkan"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
[ -z "$(grep -lF "Hitung Kas" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru memuat Hitung Kas (halamannya belum ada)"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + teks fitur lama ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-po-uang-muka-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_po_uang_muka_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod-beku.txt" || { reh_drop; die "sidik jari dokumen beku produksi gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || true; reh_drop; die "dokumen pembanding beku BERUBAH selama backup (produksi)"; }
RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi (backup/restore bermasalah)"; }
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sebelum.txt" || { reh_drop; die "sidik jari penuh rehearsal gagal"; }
[ "$(grep -c . "$BK_DIR/fp-reh-sebelum.txt")" = "$FP_N" ] || { reh_drop; die "sidik jari penuh rehearsal tidak ${FP_N} tabel"; }
ok "restore nyata IDENTIK dengan dokumen beku produksi (refund & pengeluaran final, baris jurnal, saldo per akun, pembayaran lama, flag)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$(printf '%s\n' "$REH_PEND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat migrasi rilis ini: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
# Struktur: tabel baru KOSONG, 3 kolom fin_purchases NULL semua, 2 CHECK terpasang.
[ "$(RPSQL "select count(*) from information_schema.tables where table_schema='public' and table_name='fin_supplier_bill_advance_applications'")" = "1" ] || { reh_drop; die "tabel baru tidak terbentuk"; }
[ "$(RPSQL "select count(*) from fin_supplier_bill_advance_applications")" = "0" ] || { reh_drop; die "tabel baru tidak kosong setelah migrasi (backfill tidak diharapkan)"; }
[ "$(RPSQL "select count(*) from fin_purchases where purchase_order_id is not null or payment_reference is not null or advance_over_po_reason is not null")" = "0" ] || { reh_drop; die "ada pembelian bertaut PO setelah migrasi (backfill tidak diharapkan)"; }
[ "$(RPSQL "select count(*) from pg_constraint where conname in ('fin_sb_adv_app_amount_pos_chk','fin_sb_adv_app_reversal_chk')")" = "2" ] || { reh_drop; die "CHECK tabel baru tidak terpasang"; }
ok "struktur: tabel baru kosong, kolom PO pada fin_purchases NULL semua, 2 CHECK terpasang"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan): memakai baris NYATA hasil restore dalam satu blok yang di-RAISE di akhir.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE p uuid; b uuid; po uuid; j1 uuid; j2 uuid; j3 uuid; j4 uuid; tolak int := 0; lolos int := 0;
BEGIN
  SELECT id INTO p FROM fin_purchases ORDER BY id LIMIT 1;
  SELECT id INTO b FROM fin_supplier_bills ORDER BY id LIMIT 1;
  SELECT id INTO po FROM fin_purchase_orders ORDER BY id LIMIT 1;
  SELECT id INTO j1 FROM fin_journal_entries ORDER BY id LIMIT 1 OFFSET 0;
  SELECT id INTO j2 FROM fin_journal_entries ORDER BY id LIMIT 1 OFFSET 1;
  SELECT id INTO j3 FROM fin_journal_entries ORDER BY id LIMIT 1 OFFSET 2;
  SELECT id INTO j4 FROM fin_journal_entries ORDER BY id LIMIT 1 OFFSET 3;
  IF p IS NULL OR b IS NULL OR po IS NULL OR j4 IS NULL THEN RAISE EXCEPTION 'DATA_CONTOH_KURANG'; END IF;
  -- yang SAH
  UPDATE fin_purchases SET purchase_order_id = po, payment_reference = 'uji', advance_over_po_reason = NULL WHERE id = p; lolos := lolos + 1;
  INSERT INTO fin_supplier_bill_advance_applications (id, advance_purchase_id, bill_id, amount, journal_id, idempotency_key) VALUES (gen_random_uuid(), p, b, 100, j1, 'uji-1'); lolos := lolos + 1;
  INSERT INTO fin_supplier_bill_advance_applications (id, advance_purchase_id, bill_id, amount, journal_id, reversal_journal_id, status, idempotency_key) VALUES (gen_random_uuid(), p, b, 50, j3, j2, 'REVERSED', 'uji-2'); lolos := lolos + 1;
  -- yang HARUS DITOLAK
  BEGIN INSERT INTO fin_supplier_bill_advance_applications (id, advance_purchase_id, bill_id, amount, journal_id, idempotency_key) VALUES (gen_random_uuid(), p, b, 0, j4, 'uji-3'); RAISE EXCEPTION 'TIDAK_DITOLAK_nominal_nol';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_supplier_bill_advance_applications (id, advance_purchase_id, bill_id, amount, journal_id, reversal_journal_id, idempotency_key) VALUES (gen_random_uuid(), p, b, 10, j4, j2, 'uji-4'); RAISE EXCEPTION 'TIDAK_DITOLAK_aktif_punya_jurnal_balik';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_supplier_bill_advance_applications (id, advance_purchase_id, bill_id, amount, journal_id, status, idempotency_key) VALUES (gen_random_uuid(), p, b, 10, j4, 'REVERSED', 'uji-5'); RAISE EXCEPTION 'TIDAK_DITOLAK_dibalik_tanpa_jurnal_balik';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_supplier_bill_advance_applications (id, advance_purchase_id, bill_id, amount, journal_id, idempotency_key) VALUES (gen_random_uuid(), p, b, 10, j4, 'uji-1'); RAISE EXCEPTION 'TIDAK_DITOLAK_kunci_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_supplier_bill_advance_applications (id, advance_purchase_id, bill_id, amount, journal_id, idempotency_key) VALUES (gen_random_uuid(), p, b, 10, j1, 'uji-6'); RAISE EXCEPTION 'TIDAK_DITOLAK_jurnal_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE fin_purchases SET purchase_order_id = gen_random_uuid() WHERE id = p; RAISE EXCEPTION 'TIDAK_DITOLAK_po_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_supplier_bill_advance_applications (id, advance_purchase_id, bill_id, amount, journal_id, idempotency_key) VALUES (gen_random_uuid(), p, gen_random_uuid(), 10, j4, 'uji-7'); RAISE EXCEPTION 'TIDAK_DITOLAK_faktur_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM fin_purchase_orders WHERE id = po; RAISE EXCEPTION 'TIDAK_DITOLAK_hapus_po_bertaut';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM fin_purchases WHERE id = p; RAISE EXCEPTION 'TIDAK_DITOLAK_hapus_uang_muka_diterapkan';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM fin_journal_entries WHERE id = j1; RAISE EXCEPTION 'TIDAK_DITOLAK_hapus_jurnal_penerapan';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'DATA_CONTOH_KURANG' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data contoh di hasil restore kurang (butuh >=1 pembelian, faktur, PO dan >=4 jurnal)"; }
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" = "10" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti ${UJI_TOLAK:-?} (harus 10)"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" = "3" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos ${UJI_LOLOS:-?} (harus 3)"; }
ok "perilaku terbukti di DB rehearsal: tolak=${UJI_TOLAK} lolos=${UJI_LOLOS} — tautan PO & penerapan sah lolos; nominal nol, aktif+jurnal balik, dibalik tanpa jurnal balik, kunci ganda, jurnal ganda, PO/faktur tak ada, hapus PO/uang muka/jurnal bertaut ditolak; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from fin_supplier_bill_advance_applications")" = "0" ] && [ "$(RPSQL "select count(*) from fin_purchases where purchase_order_id is not null")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrasi + uji perilaku (sidik jari baris penuh; tanpa backfill); DB sementara dihapus"

PHASE="6-migrate"; say "6. Migrasi aditif (image baru; backend lama tetap melayani)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum migrasi"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum migrasi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
for m in $MIG_LIST; do grep -Fx "$m" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${m} SUDAH terpasang sebelum rilis (tidak diharapkan)"; done
PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") || true)"
[ "$(printf '%s\n' "$PENDING" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || die "migrasi pending bukan tepat migrasi rilis ini: $(printf '%s' "$PENDING" | tr '\n' ' ')"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
for m in $MIG_LIST; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 1 ))" ] || die "jumlah migrasi terpasang != sebelum + 1"
ok "1 migrasi diterapkan; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"
# SETELAH migrasi, SEBELUM switch: hanya backend LAMA yang melayani dan ia tidak mengenal uang muka PO → tabel baru HARUS kosong dan tidak ada pembelian bertaut PO (tanpa backfill).
[ "$(psql_live -At -c "select (select count(*) from fin_supplier_bill_advance_applications) + (select count(*) from fin_purchases where purchase_order_id is not null)")" = "0" ] || die "ada data uang muka PO sebelum switch (backend lama tidak bisa membuatnya; tidak diharapkan)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari dokumen beku pasca-migrasi gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: tabel baru kosong, tidak ada pembelian bertaut PO (tanpa backfill), dokumen pembanding beku identik"

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
[ "$(PSQLN "select count(*) from information_schema.tables where table_schema='public' and table_name='fin_supplier_bill_advance_applications'")" = "1" ] || die "tabel penerapan uang muka tidak ada di produksi"
[ "$(PSQLN "select count(*) from pg_constraint where conname in ('fin_sb_adv_app_amount_pos_chk','fin_sb_adv_app_reversal_chk')")" = "2" ] || die "CHECK tabel penerapan tidak terpasang di produksi"
ok "objek rilis terpasang di produksi: tabel penerapan uang muka (kosong) + 2 CHECK"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin + penolakan sebelum menyentuh data, config gerbang, manifest pada daftar job, dry-run penggabungan, invarian"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e PO_N="$PO_N" -e BILL_N="$BILL_N" -e PURCH_N="$PURCH_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const tulis = [];
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  if (method !== "GET") tulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status });
  return { status: r.status, json };
}
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) {
    const rs = await rolesDari(u);
    if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u;
  }
  return null;
}
const fin = (await userDengan("FINANCE", new Set(["SALES"]))) ?? (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
if (!fin || !sales) { rec("akun Finance/Admin dan SALES murni tersedia", false, `fin=${!!fin} sales=${!!sales}`); process.exit(1); }
const tF = await tokenUntuk(fin), tS = await tokenUntuk(sales);
const nol = "00000000-0000-4000-8000-000000000000";
const sql = async (q) => (await prisma.$queryRawUnsafe(q));
const hitungSql = async (q) => Number((await sql(q))[0].n);
const B = (k) => Number(process.env[k]);
const rp = (v) => Math.round(Number(v) * 100) / 100;
const sama = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// ── Penolakan SEBELUM menyentuh data ──
const g1 = (await api("GET", "/api/finance/purchase-orders/uang-muka", null)).status;
const g2 = (await api("GET", "/api/finance/purchase-orders/uang-muka", tS)).status;
rec("daftar uang muka: tanpa token 401, SALES 403", g1 === 401 && g2 === 403, g1 + "," + g2);
const w1 = (await api("POST", "/api/finance/purchase-orders/" + nol + "/uang-muka", null, { amount: 1 })).status;
const w2 = (await api("POST", "/api/finance/purchase-orders/" + nol + "/uang-muka", tS, { amount: 1 }, { "Idempotency-Key": "smoke-pum-sales" })).status;
const w3 = (await api("POST", "/api/finance/purchase-orders/" + nol + "/uang-muka", tF, { amount: 1 })).status;
rec("bayar uang muka: tanpa token 401, SALES 403, Finance tanpa Idempotency-Key ditolak sebelum menyentuh data (428/400)", w1 === 401 && w2 === 403 && [400, 428].includes(w3), w1 + "," + w2 + "," + w3);
const t1 = (await api("POST", "/api/finance/purchase-orders/uang-muka/terapkan", null, { advanceId: nol, billId: nol, amount: 1 })).status;
const t2 = (await api("POST", "/api/finance/purchase-orders/uang-muka/terapkan", tS, { advanceId: nol, billId: nol, amount: 1 }, { "Idempotency-Key": "smoke-pum-sales2" })).status;
const t3 = (await api("POST", "/api/finance/purchase-orders/uang-muka/terapkan", tF, { advanceId: nol, billId: nol, amount: 1 })).status;
rec("terapkan uang muka: tanpa token 401, SALES 403, Finance tanpa Idempotency-Key ditolak (428/400)", t1 === 401 && t2 === 403 && [400, 428].includes(t3), t1 + "," + t2 + "," + t3);
const SAH = new Set([400, 401, 403, 404, 409, 428]);
rec("semua " + tulis.length + " pemanggilan tulis ditolak/galat sebelum menyentuh data: smoke TIDAK membuat pembayaran/alokasi di produksi", tulis.length >= 5 && tulis.every((b) => SAH.has(b.status)), tulis.map((b) => b.n + "=" + b.status).join("; "));

// ── Detail PO: empat status + angka = SQL independen (baca-saja) ──
const lst = await api("GET", "/api/finance/purchase-orders", tF);
const pos = (lst.json?.purchaseOrders ?? []).filter((p) => p.status !== "DRAFT");
rec("daftar PO terbaca (Finance)", lst.status === 200, "status " + lst.status + ", PO bukan draf: " + pos.length);
const KODE = { barang: ["PO_DRAFT", "PO_DIBATALKAN", "BELUM_DATANG", "DATANG_SEBAGIAN", "LENGKAP"], faktur: ["BELUM_ADA", "MENUNGGU_PERSETUJUAN", "DISETUJUI_SEBAGIAN", "DISETUJUI_LENGKAP"], utang: ["BELUM_ADA", "ADA_UTANG", "LUNAS"], pembayaran: ["BELUM_ADA", "UANG_MUKA_SAJA", "DIBAYAR_SEBAGIAN", "LUNAS", "KELEBIHAN"] };
let diperiksa = 0; const salah = []; const lunasTanpaFaktur = []; const beda = [];
for (const p of pos) {
  const d = await api("GET", "/api/finance/purchase-orders/" + p.id, tF);
  const k = d.json?.keuangan;
  if (d.status !== 200 || !k?.statusEmpat) { salah.push(p.poNumber + ":tanpa statusEmpat"); continue; }
  diperiksa += 1;
  for (const s of Object.keys(KODE)) if (!KODE[s].includes(k.statusEmpat[s]?.kode)) salah.push(p.poNumber + ":" + s + "=" + k.statusEmpat[s]?.kode);
  const [r] = await sql(`select coalesce(sum(b.amount),0)::text ditagih, coalesce(sum(b.amount - b.credit_applied - coalesce((select sum(a.amount) from fin_supplier_payment_allocations a join fin_supplier_payments y on y.id = a.payment_id where a.bill_id = b.id and y.cancelled_at is null),0)),0)::text sisa, count(*)::int n from fin_supplier_bills b where b.purchase_order_id = '${p.id}' and b.status::text in ('DISETUJUI','DIBAYAR_SEBAGIAN','LUNAS')`);
  if (!sama(k.totalFakturDisetujui, r.ditagih) || !sama(k.sisaUtang, r.sisa)) beda.push(`${p.poNumber}: faktur ${k.totalFakturDisetujui}/${r.ditagih} sisa ${k.sisaUtang}/${r.sisa}`);
  if (k.statusEmpat.pembayaran.kode === "LUNAS" && k.statusEmpat.faktur.kode !== "DISETUJUI_LENGKAP") lunasTanpaFaktur.push(p.poNumber);
}
rec("kode empat status valid untuk " + diperiksa + " PO bukan draf", diperiksa === pos.length && salah.length === 0, salah.join("; "));
rec("total faktur disetujui & sisa utang PO = SQL independen untuk semua PO", beda.length === 0, beda.join("; "));
rec("tidak ada PO berlabel Lunas tanpa faktur disetujui lengkap", lunasTanpaFaktur.length === 0, lunasTanpaFaktur.join(","));
rec("belum ada uang muka tertaut PO di produksi (tanpa backfill)", (await hitungSql("select count(*)::int n from fin_purchases where purchase_order_id is not null")) === 0 && (await hitungSql("select count(*)::int n from fin_supplier_bill_advance_applications")) === 0);

// ── Ringkasan per supplier (baca-saja) = SQL independen ──
const rs = await api("GET", "/api/finance/purchase-orders/uang-muka/ringkasan-supplier", tF);
const [u] = await sql(`select coalesce(sum(b.amount - b.credit_applied - coalesce((select sum(a.amount) from fin_supplier_payment_allocations a join fin_supplier_payments y on y.id = a.payment_id where a.bill_id = b.id and y.cancelled_at is null),0)),0)::text utang from fin_supplier_bills b where b.status::text in ('DISETUJUI','DIBAYAR_SEBAGIAN')`);
rec("ringkasan uang muka per supplier: utang aktif = SQL independen", rs.status === 200 && sama(rs.json?.kartu?.utangAktif, u.utang), `${rs.json?.kartu?.utangAktif} vs ${u.utang}`);
const ag = await api("GET", "/api/finance/utang/aging", tF);
console.log("  INFO  total utang aktif aging: " + ag.json?.ringkasan?.kartu?.totalUtangAktif + " (pembanding informatif)");
const ex = await api("GET", "/api/finance/export/uang-muka-supplier?format=xlsx", tF);
console.log("  INFO  endpoint export uang-muka-supplier status " + ex.status + " (tidak dipakai sebagai syarat)");

// ── Invarian ──
rec("jumlah PO, faktur, pembelian tidak berkurang (sebelum: " + B("PO_N") + " / " + B("BILL_N") + " / " + B("PURCH_N") + "; boleh bertambah oleh transaksi sah)", (await hitungSql('select count(*)::int n from fin_purchase_orders')) >= B("PO_N") && (await hitungSql('select count(*)::int n from fin_supplier_bills')) >= B("BILL_N") && (await hitungSql('select count(*)::int n from fin_purchases')) >= B("PURCH_N"));
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitungSql("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("tiap refund punya paling banyak SATU jurnal berlaku (ganda sebelum rilis: " + B("BASE_GANDA") + ", tidak bertambah)", (await hitungSql("select count(*)::int n from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x")) <= B("BASE_GANDA"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else
  ok "smoke test lulus (izin, penolakan sebelum menyentuh data, empat status & total PO = SQL independen, tidak ada Lunas tanpa faktur, ringkasan supplier, invarian)"
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
say "TINDAK LANJUT OWNER: data lama TIDAK berubah. Tombol Bayar Uang Muka muncul di detail PO disetujui (Finance). Uang muka bukan stok/utang; Lunas hanya setelah faktur disetujui lengkap dan uang muka dialokasikan. Tidak ada transaksi QA di produksi."
