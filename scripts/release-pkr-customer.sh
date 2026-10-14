#!/usr/bin/env bash
# RILIS "CUSTOMER AKTUAL PENJUALAN KARYAWAN + FORM TERPADU + KOREKSI PEMBELI + JUMLAH HINGGA 200": web + backend + 4 migrasi ADITIF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Customer/pembeli (Bpk. Indra) menjadi Order.customerId; karyawan penjual (Kemal) hanya sumber transaksi; penerima boleh berbeda. Form PKR 7 langkah setara input Order CRM Inbox;
#   "Edit/Lengkapi Data Customer" (pratinjau dampak, alasan, revisi optimistis, Idempotency-Key, audit) tanpa jurnal/Order/Unit/Job baru; jumlah per item hingga 200.
#   Migrasi (TANPA backfill/UPDATE/DELETE): 20261109090000 +1 nilai enum LeadSource | 20261109090100 +5 kolom NULL pada "Order" | 20261109090200 CHECK qty 20→200 | 20261109090300 +jenis revisi PEMBELI.
# Data lama TIDAK diubah: order PKR lama tetap menunjuk profil karyawan (legacy, ditandai "Data customer belum lengkap"); dilengkapi Admin per order lewat UI — TANPA backfill otomatis.
# Produksi: verifikasi hanya baca + penolakan izin; TIDAK ada customer/order/PKR/jurnal QA. Uji perilaku constraint dijalankan di DB REHEARSAL (hasil restore backup).
#
#   cat scripts/release-pkr-customer.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/cu1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/cu1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/cu1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/cu1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode HANYA boleh di-rollback bila belum ada Customer ber-sumber PENJUALAN_KARYAWAN. Periksa dulu dengan scripts/rollback-guard-pkr-customer.sh (baca-saja;
# menolak bila ada data baru: kode lama tidak mengenal nilai enum LeadSource baru — membaca baris Customer tsb dapat gagal).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/pkr-customer-aktual}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261109090000_leadsource_penjualan_karyawan:81124504de7cf86e2274851466ca2ac835cecd69b39f83f743eb6b3eb88943c3 20261109090100_order_pkr_penerima_catatan:7d15fd1fc0345da4d541264a5777ae5c7ea722626de1bfb625227e11b1c26f29 20261109090200_pkr_item_qty_hingga_200:df4dcaf28071733eae43a1d211f6ba9d76f02322f26b3b260ea1639efce92604 20261109090300_pkr_revisi_jenis_pembeli:24010678ee252ab74faebeb3b0c4a9ca89695010e766bbcc26fa076093c32b8b"
# Hasil pemindai untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":6,"cocok":6}'
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261109090000_leadsource_penjualan_karyawan/migration\.sql|backend/prisma/migrations/20261109090100_order_pkr_penerima_catatan/migration\.sql|backend/prisma/migrations/20261109090200_pkr_item_qty_hingga_200/migration\.sql|backend/prisma/migrations/20261109090300_pkr_revisi_jenis_pembeli/migration\.sql|backend/prisma/schema\.prisma|backend/scripts/pkr-pembeli-dry-run\.js|backend/src/lib/domain/pkrIdentitas\.js|backend/src/lib/domain/pkrItem\.js|backend/src/lib/domain/pkrPembeli\.js|backend/src/mcp/tools\.js|backend/src/routes/analytics\.js|backend/src/routes/financePenjualanKaryawan\.js|backend/src/routes/orders\.js|backend/src/routes/pipeline\.js|backend/src/services/attribution/cohort\.js|backend/src/services/attribution/cohortDefinitions\.js|backend/src/services/penjualanKaryawanOrder\.js|backend/src/services/penjualanKaryawanPembeli\.js|backend/src/services/penjualanKaryawanPembeliKoreksi\.js|backend/src/services/pkrProduksiGuard\.js|backend/tests/integration/pkrCustomerAktual\.integration\.test\.js|backend/tests/integration/pkrEditProgres\.integration\.test\.js|backend/tests/integration/pkrItemTerpadu\.integration\.test\.js|backend/tests/integration/pkrMultiItem\.integration\.test\.js|backend/tests/pkrItem\.test\.js|docs/PKR-CUSTOMER-AKTUAL\.md|frontend/src/api\.js|frontend/src/features/armada/components/JobDetailDrawer\.jsx|frontend/src/features/finance/PkrEditCustomer\.jsx|frontend/src/features/finance/PkrItemForm\.jsx|frontend/src/features/finance/PkrOrderCrm\.jsx|frontend/src/features/finance/PkrPembeliForm\.jsx|frontend/src/features/finance/detailSpecs\.js|frontend/src/features/finance/pkrItemLogic\.js|frontend/src/features/finance/pkrOrderCrmLogic\.js|frontend/src/features/finance/pkrPembeliLogic\.js|frontend/src/features/orders/OrderTimelineDrawer\.jsx|frontend/src/features/orders/RincianPkr\.jsx|frontend/src/features/orders/SumberPkr\.jsx|frontend/src/features/orders/pkrSumberModel\.js|frontend/src/features/production/PkrRujukan\.jsx|frontend/src/features/production/pkrRujukanModel\.js|frontend/src/pages/Orders\.jsx|frontend/src/pages/finance/FinancePenjualanKaryawan\.jsx|frontend/src/utils/mapsLink\.js|frontend/src/utils/nomorTelepon\.js|frontend/tests/pkrPembeliLogic\.test\.js|scripts/release-pkr-customer\.sh|scripts/rollback-guard-pkr-customer\.sh)$'
BACKEND_SRC_EXPECT="backend/src/lib/domain/pkrIdentitas.js backend/src/lib/domain/pkrItem.js backend/src/lib/domain/pkrPembeli.js backend/src/mcp/tools.js backend/src/routes/analytics.js backend/src/routes/financePenjualanKaryawan.js backend/src/routes/orders.js backend/src/routes/pipeline.js backend/src/services/attribution/cohort.js backend/src/services/attribution/cohortDefinitions.js backend/src/services/penjualanKaryawanOrder.js backend/src/services/penjualanKaryawanPembeli.js backend/src/services/penjualanKaryawanPembeliKoreksi.js backend/src/services/pkrProduksiGuard.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/armada/components/JobDetailDrawer.jsx frontend/src/features/finance/PkrEditCustomer.jsx frontend/src/features/finance/PkrItemForm.jsx frontend/src/features/finance/PkrOrderCrm.jsx frontend/src/features/finance/PkrPembeliForm.jsx frontend/src/features/finance/detailSpecs.js frontend/src/features/finance/pkrItemLogic.js frontend/src/features/finance/pkrOrderCrmLogic.js frontend/src/features/finance/pkrPembeliLogic.js frontend/src/features/orders/OrderTimelineDrawer.jsx frontend/src/features/orders/RincianPkr.jsx frontend/src/features/orders/SumberPkr.jsx frontend/src/features/orders/pkrSumberModel.js frontend/src/features/production/PkrRujukan.jsx frontend/src/features/production/pkrRujukanModel.js frontend/src/pages/Orders.jsx frontend/src/pages/finance/FinancePenjualanKaryawan.jsx frontend/src/utils/mapsLink.js frontend/src/utils/nomorTelepon.js"
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
BK_DIR="$HOME/release-backups/pkr-customer-${DEPLOY_SHORT}-${TS}"
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
   bash ${NEW_DIR}/scripts/rollback-guard-pkr-customer.sh
Guard menolak (exit 1) bila SUDAH ada data yang hanya dipahami kode baru:
   - Customer ber-sumber PENJUALAN_KARYAWAN — nilai enum LeadSource itu tidak dikenal Prisma kode lama; membaca baris Customer tsb dapat GAGAL.
   Bila guard menolak: JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner.
Bila guard lulus (belum ada customer PKR aktual), rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi hanya MENAMBAH 1 nilai enum + 5 kolom NULL + melonggarkan 2 CHECK: dibiarkan terpasang pun aman bagi kode lama SELAMA belum ada customer PKR aktual. (Tidak dihapus oleh rollback kode.)
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
exec 9>/tmp/release-pkr-customer.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "cu1\|release-pkr-customer\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
MIG_LIST=""; EXPECT_PRISMA="backend/prisma/schema.prisma"
for e in $MIGS; do MIG_LIST="$MIG_LIST ${e%%:*}"; EXPECT_PRISMA="$(printf '%s\nbackend/prisma/migrations/%s/migration.sql' "$EXPECT_PRISMA" "${e%%:*}")"; done
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat schema.prisma + migrasi rilis ini"; }
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
// Pemindai migrasi rilis "Customer aktual PKR" (4 migrasi aditif). FAIL-CLOSED: daftar putih pernyataan PERSIS (setelah spasi dirapatkan), tiap pernyataan tepat satu kali.
//  (a) SATU nilai enum baru LeadSource 'PENJUALAN_KARYAWAN';
//  (b) SATU ALTER TABLE "Order" yang menambah 5 kolom TEXT NULL (tanpa DEFAULT/NOT NULL);
//  (c) CHECK qty pkr_order_items dilonggarkan 20 → 200 (DROP + ADD bernama sama);
//  (d) CHECK jenis revisi pkr_item_revisions ditambah 'PEMBELI' (DROP + ADD bernama sama).
// Tidak ada DELETE/UPDATE/INSERT/TRUNCATE/CREATE/GRANT/RENAME/ALTER COLUMN/TRIGGER/FUNCTION, tidak ada perubahan lain pada tabel apa pun.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };
const OK = new Set([
  `ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'PENJUALAN_KARYAWAN'`,
  `ALTER TABLE "Order" ADD COLUMN "recipient_name" TEXT, ADD COLUMN "recipient_phone" TEXT, ADD COLUMN "delivery_landmark" TEXT, ADD COLUMN "production_note" TEXT, ADD COLUMN "delivery_note" TEXT`,
  `ALTER TABLE "pkr_order_items" DROP CONSTRAINT "pkr_order_items_qty_chk"`,
  `ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_qty_chk" CHECK ("qty" >= 1 AND "qty" <= 200)`,
  `ALTER TABLE "pkr_item_revisions" DROP CONSTRAINT "pkr_item_revisions_kind_chk"`,
  `ALTER TABLE "pkr_item_revisions" ADD CONSTRAINT "pkr_item_revisions_kind_chk" CHECK ("kind" IN ('DIBUAT', 'DILENGKAPI', 'DIKOREKSI', 'PEMBELI'))`,
]);
const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
const lihat = new Set();
for (const st of stmts) {
  const r = rapat(st);
  if (!OK.has(r)) gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
  if (lihat.has(r)) gagal(`pernyataan ganda: ${r.slice(0, 120)}`);
  lihat.add(r);
}
if (lihat.size !== OK.size) gagal(`pernyataan harus tepat ${OK.size} (ada ${lihat.size})`);
console.log(JSON.stringify({ total: stmts.length, cocok: lihat.size }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (1 nilai enum, 5 kolom NULL pada Order, 2 CHECK dilonggarkan); tanpa DROP TABLE/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT/trigger"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE tabel lama" "$(tambah_stmt 'DROP TABLE "Order";')"
harus_ditolak "UPDATE tabel lama (Order)" "$(tambah_stmt "UPDATE \"Order\" SET \"paymentStatus\" = 'LUNAS';")"
harus_ditolak "UPDATE customer (backfill sumber)" "$(tambah_stmt "UPDATE \"Customer\" SET \"leadSource\" = 'PENJUALAN_KARYAWAN' WHERE \"staffUserId\" IS NOT NULL;")"
harus_ditolak "UPDATE order PKR (backfill customer)" "$(tambah_stmt 'UPDATE "Order" SET "customerId" = (SELECT id FROM "Customer" LIMIT 1) WHERE penjualan_karyawan_id IS NOT NULL;')"
harus_ditolak "DELETE tabel lama" "$(tambah_stmt 'DELETE FROM "fin_journal_lines";')"
harus_ditolak "INSERT customer" "$(tambah_stmt "INSERT INTO \"Customer\" (id) VALUES ('x');")"
harus_ditolak "INSERT ... SELECT" "$(tambah_stmt 'INSERT INTO "fin_settings" SELECT * FROM "fin_settings";')"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "pkr_item_revisions";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "Order" DROP COLUMN "value";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "Order" ALTER COLUMN "value" TYPE BIGINT;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "Order" RENAME COLUMN "value" TO "nilai";')"
harus_ditolak "kolom tambahan pada Order" "$(tambah_stmt 'ALTER TABLE "Order" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom pada tabel lain" "$(tambah_stmt 'ALTER TABLE "Customer" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom baru bernilai default (backfill terselubung)" "$(printf '%s\n' "$ALL_SQL" | sed "s/ADD COLUMN \"delivery_note\" TEXT/ADD COLUMN \"delivery_note\" TEXT DEFAULT 'x'/")"
harus_ditolak "kolom baru NOT NULL" "$(printf '%s\n' "$ALL_SQL" | sed 's/ADD COLUMN "production_note" TEXT/ADD COLUMN "production_note" TEXT NOT NULL/')"
harus_ditolak "kolom baru hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | sed '/ADD COLUMN "delivery_note" TEXT;/d; s/ADD COLUMN "production_note" TEXT,/ADD COLUMN "production_note" TEXT;/')"
harus_ditolak "nilai enum kedua" "$(tambah_stmt "ALTER TYPE \"LeadSource\" ADD VALUE IF NOT EXISTS 'LIAR';")"
harus_ditolak "nilai enum diganti" "$(printf '%s\n' "$ALL_SQL" | sed "s/'PENJUALAN_KARYAWAN'/'LIAR'/")"
harus_ditolak "enum tipe lain" "$(printf '%s\n' "$ALL_SQL" | sed 's/ALTER TYPE "LeadSource"/ALTER TYPE "OrderStatus"/')"
harus_ditolak "RENAME enum value" "$(tambah_stmt "ALTER TYPE \"LeadSource\" RENAME VALUE 'OTHER' TO 'X';")"
harus_ditolak "batas qty diganti 500" "$(printf '%s\n' "$ALL_SQL" | sed 's/"qty" <= 200/"qty" <= 500/')"
harus_ditolak "batas qty dihapus (CHECK longgar)" "$(printf '%s\n' "$ALL_SQL" | sed 's/CHECK ("qty" >= 1 AND "qty" <= 200)/CHECK (true)/')"
harus_ditolak "constraint qty tidak ditambah lagi (hanya DROP)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'ADD CONSTRAINT "pkr_order_items_qty_chk"')"
harus_ditolak "constraint qty diganti nama" "$(printf '%s\n' "$ALL_SQL" | sed 's/ADD CONSTRAINT "pkr_order_items_qty_chk"/ADD CONSTRAINT "evil_chk"/')"
harus_ditolak "jenis revisi liar" "$(printf '%s\n' "$ALL_SQL" | sed "s/'PEMBELI')/'PEMBELI', 'LIAR')/")"
harus_ditolak "jenis revisi dibuka tanpa batas" "$(printf '%s\n' "$ALL_SQL" | sed 's/CHECK ("kind" IN (.*))/CHECK (true)/')"
harus_ditolak "constraint revisi tidak ditambah lagi" "$(printf '%s\n' "$ALL_SQL" | grep -v 'ADD CONSTRAINT "pkr_item_revisions_kind_chk"')"
harus_ditolak "DROP CONSTRAINT lain" "$(tambah_stmt 'ALTER TABLE "pkr_order_items" DROP CONSTRAINT "pkr_order_items_pkey";')"
harus_ditolak "tabel baru" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "indeks baru" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "Order"("recipient_name");')"
harus_ditolak "DROP INDEX" "$(tambah_stmt 'DROP INDEX "x_idx";')"
harus_ditolak "FK baru" "$(tambah_stmt 'ALTER TABLE "Order" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "Order" TO PUBLIC;')"
harus_ditolak "trigger apa pun" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "Order" FOR EACH ROW EXECUTE FUNCTION "x"();')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "trigger dimatikan" "$(tambah_stmt 'ALTER TABLE "Order" DISABLE TRIGGER ALL;')"
harus_ditolak "pernyataan ganda" "$(tambah_stmt "ALTER TYPE \"LeadSource\" ADD VALUE IF NOT EXISTS 'PENJUALAN_KARYAWAN';")"
[ "$NEG" -ge 30 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 30)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/backfill/TRUNCATE/ALTER COLUMN/RENAME/kolom-tabel-indeks-FK di luar daftar/CHECK liar/GRANT/trigger/fungsi/default/NOT NULL/hitungan beda) SEMUANYA ditolak"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit (termasuk 4 migrasi aditif)"

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
for T in "Order" "Customer" fin_penjualan_karyawan pkr_order_items pkr_item_revisions units jobs fin_journal_entries fin_journal_lines payments fin_settings; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='Order' and column_name in ('penjualan_karyawan_id','pkr_perlu_dikirim','location_url','delivery_address','delivery_city')")" = "5" ] || die "kolom prasyarat Order (PKR/alamat/Maps) belum lengkap"
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='Order' and column_name in ('recipient_name','recipient_phone','delivery_landmark','production_note','delivery_note')")" = "0" ] || die "kolom penerima/catatan SUDAH ada di Order produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'LeadSource' and e.enumlabel = 'PENJUALAN_KARYAWAN'")" = "0" ] || die "nilai enum PENJUALAN_KARYAWAN SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_constraint where conname = 'pkr_order_items_qty_chk' and pg_get_constraintdef(oid) like '%<= 20%'")" = "1" ] || die "CHECK qty produksi bukan batas 20 yang diharapkan"
[ "$(psql_live -At -c "select count(*) from pg_constraint where conname = 'pkr_item_revisions_kind_chk' and pg_get_constraintdef(oid) not like '%PEMBELI%'")" = "1" ] || die "CHECK jenis revisi produksi bukan yang diharapkan"
for m in $MIG_LIST; do [ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${m}'")" = "0" ] || die "migrasi ${m} SUDAH tercatat di produksi (tidak diharapkan)"; done
PKR_N="$(psql_live -At -c "select count(*) from fin_penjualan_karyawan")"
ORD_PKR_N="$(psql_live -At -c "select count(*) from \"Order\" where penjualan_karyawan_id is not null")"
PKR_ITEM_N="$(psql_live -At -c "select count(*) from pkr_order_items")"
LEGACY_N="$(psql_live -At -c "select count(*) from \"Order\" o join \"Customer\" c on c.id = o.\"customerId\" where o.penjualan_karyawan_id is not null and c.staff_user_id is not null")"
for v in "$PKR_N" "$ORD_PKR_N" "$PKR_ITEM_N" "$LEGACY_N"; do [[ "$v" =~ ^[0-9]+$ ]] || die "audit awal bukan angka: '$v'"; done
[ "$PKR_ITEM_N" -gt 0 ] || die "tidak ada pkr_order_items di produksi: uji perilaku rehearsal butuh contoh baris — berhenti"
ok "prasyarat skema terpenuhi; PKR=${PKR_N}, order PKR=${ORD_PKR_N} (legacy menunjuk profil karyawan: ${LEGACY_N}) — dibiarkan apa adanya, tanpa backfill"
# GARIS DASAR invarian (dibandingkan sesudah rilis; yang dijaga = TIDAK BERTAMBAH oleh rilis ini).
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
SQL_GANDA="select count(*)::int from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"; BASE_GANDA="$(psql_live -At -c "$SQL_GANDA")"
for v in "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA"; do [[ "$v" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$v'"; done
printf 'BASE_TIDAK_SEIMBANG=%s BASE_GANDA=%s PKR_N=%s ORD_PKR_N=%s LEGACY_N=%s\n' "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA" "$PKR_N" "$ORD_PKR_N" "$LEGACY_N" > "$BK_DIR/garis-dasar.env"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}; refund dengan >1 jurnal berlaku = ${BASE_GANDA}"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel. Membuktikan restore identik dan migrasi tidak mengubah data lama (rilis ini tidak menambah kolom pada tabel lama).
FP_SQL="select 'order', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'recipient_name' - 'recipient_phone' - 'delivery_landmark' - 'production_note' - 'delivery_note')::text, '|' order by x.id),'')) from \"Order\" x
union all select 'customer', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Customer\" x
union all select 'fin_penjualan_karyawan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan x
union all select 'pkr_order_items', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from pkr_order_items x
union all select 'pkr_item_revisions', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from pkr_item_revisions x
union all select 'units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from units x
union all select 'jobs', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from jobs x
union all select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x
union all select 'fin_journal_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_entries x
union all select 'fin_journal_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x
union all select 'fin_settings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from fin_settings x"
FP_N=11
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
BACKUP_FILE="$HOME/backups/pre-pkr-customer-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-pkr-customer.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Alamat & lokasi" "Keluhan & kebutuhan" "Pembayaran awal" "Dijual oleh"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Buat Nota Kredit" "Potongan (Nota Kredit)" "Nilai bersih" "Unit Produksi" "Semua Status Unit" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Penjualan & Piutang" "Katalog Item PKR" "Kirim sebagian" "Retur & Debit Note" "Rencana Produksi" "Penjualan Karyawan" "Barang Akan Datang"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
[ -z "$(grep -lF "Hitung Kas" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru memuat Hitung Kas (halamannya belum ada)"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + 14 teks fitur lama ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-pkr-customer-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_pkr_customer_${TS}"
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
# Struktur: 1 nilai enum; 5 kolom NULL pada Order (semua baris NULL); CHECK qty 200; CHECK jenis revisi memuat PEMBELI.
[ "$(RPSQL "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'LeadSource' and e.enumlabel = 'PENJUALAN_KARYAWAN'")" = "1" ] || { reh_drop; die "nilai enum PENJUALAN_KARYAWAN tidak terpasang"; }
[ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='Order' and column_name in ('recipient_name','recipient_phone','delivery_landmark','production_note','delivery_note')")" = "5" ] || { reh_drop; die "5 kolom baru pada Order tidak terpasang"; }
[ "$(RPSQL "select count(*) from \"Order\" where recipient_name is not null or recipient_phone is not null or delivery_landmark is not null or production_note is not null or delivery_note is not null")" = "0" ] || { reh_drop; die "kolom baru Order TIDAK NULL setelah migrasi (backfill tidak diharapkan)"; }
[ "$(RPSQL "select count(*) from pg_constraint where conname = 'pkr_order_items_qty_chk' and pg_get_constraintdef(oid) like '%<= 200%'")" = "1" ] || { reh_drop; die "CHECK qty 200 tidak terpasang"; }
[ "$(RPSQL "select count(*) from pg_constraint where conname = 'pkr_item_revisions_kind_chk' and pg_get_constraintdef(oid) like '%PEMBELI%'")" = "1" ] || { reh_drop; die "CHECK jenis revisi PEMBELI tidak terpasang"; }
ok "nilai enum terpasang; 5 kolom Order baru semuanya NULL; CHECK qty 200 dan jenis revisi PEMBELI terpasang"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan di akhir): enum baru dapat dipakai, kolom baru tersimpan, qty 200 sah / 201 dan 0 ditolak, revisi PEMBELI sah / jenis liar ditolak.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE
  o text; pk uuid; cu text; it uuid; rev int; tolak int := 0; lolos int := 0;
BEGIN
  SELECT id, penjualan_karyawan_id INTO o, pk FROM "Order" WHERE penjualan_karyawan_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id INTO cu FROM "Customer" ORDER BY id LIMIT 1;
  SELECT id INTO it FROM pkr_order_items ORDER BY id LIMIT 1;
  IF o IS NULL OR pk IS NULL OR cu IS NULL OR it IS NULL THEN RAISE EXCEPTION 'ROLLBACK_UJI tolak=0 lolos=0 (tidak ada contoh order PKR/customer/item)'; END IF;
  SELECT COALESCE(MAX(revision), 0) + 1 INTO rev FROM pkr_item_revisions WHERE order_id = o;
  -- (1) nilai enum baru dapat dipakai
  UPDATE "Customer" SET "leadSource" = 'PENJUALAN_KARYAWAN' WHERE id = cu; lolos := lolos + 1;
  -- (2) kolom penerima/catatan tersimpan
  UPDATE "Order" SET recipient_name = 'Penerima Uji', recipient_phone = '6281200000000', delivery_landmark = 'Patokan', production_note = 'Catatan P', delivery_note = 'Catatan D' WHERE id = o; lolos := lolos + 1;
  -- (3) jumlah per item sampai 200 sah; 201 dan 0 DITOLAK
  UPDATE pkr_order_items SET qty = 200 WHERE id = it; lolos := lolos + 1;
  BEGIN UPDATE pkr_order_items SET qty = 201 WHERE id = it; RAISE EXCEPTION 'TIDAK_DITOLAK_qty_201';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE pkr_order_items SET qty = 0 WHERE id = it; RAISE EXCEPTION 'TIDAK_DITOLAK_qty_0';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  -- (4) jenis revisi PEMBELI sah (INSERT: buku revisi append-only); jenis liar DITOLAK
  INSERT INTO pkr_item_revisions (id, order_id, penjualan_id, revision, kind, after_items) VALUES (gen_random_uuid(), o, pk, rev, 'PEMBELI', '[]'::jsonb); lolos := lolos + 1;
  BEGIN INSERT INTO pkr_item_revisions (id, order_id, penjualan_id, revision, kind, after_items) VALUES (gen_random_uuid(), o, pk, rev + 1, 'LIAR', '[]'::jsonb); RAISE EXCEPTION 'TIDAK_DITOLAK_kind_liar';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 3 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti terlalu sedikit (${UJI_TOLAK:-?}; minimal 3) — constraint tidak aktif atau data contoh kurang"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" -ge 4 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos terlalu sedikit (${UJI_LOLOS:-?}; minimal 4)"; }
ok "perilaku terbukti di DB rehearsal: tolak=${UJI_TOLAK} lolos=${UJI_LOLOS} — CHECK menolak qty 0/201 dan jenis revisi liar; enum/kolom baru dapat dipakai; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from \"Order\" where recipient_name is not null or production_note is not null or delivery_note is not null")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrasi + uji perilaku (sidik jari baris penuh tanpa 5 kolom baru); DB sementara dihapus"

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
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 4 ))" ] || die "jumlah migrasi terpasang != sebelum + 4"
ok "4 migrasi diterapkan; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"
# SETELAH migrasi, SEBELUM switch: hanya backend LAMA yang melayani dan ia tidak mengenal tabel baru → kolom penerima/catatan Order HARUS NULL dan tidak ada Customer PKR aktual (tanpa backfill).
[ "$(psql_live -At -c "select count(*) from \"Order\" where recipient_name is not null or recipient_phone is not null or delivery_landmark is not null or production_note is not null or delivery_note is not null")" = "0" ] || die "kolom baru Order TIDAK NULL setelah migrasi sebelum switch (backfill tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from \"Customer\" where \"leadSource\"::text = 'PENJUALAN_KARYAWAN'")" = "0" ] || die "ada Customer ber-sumber PENJUALAN_KARYAWAN sebelum switch (backend lama tidak bisa membuatnya)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari dokumen beku pasca-migrasi gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: kolom baru Order NULL dan tidak ada Customer PKR aktual (tanpa backfill), dokumen pembanding beku identik"

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
[ "$(PSQLN "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'LeadSource' and e.enumlabel = 'PENJUALAN_KARYAWAN'")" = "1" ] || die "nilai enum PENJUALAN_KARYAWAN tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'Order' and column_name in ('recipient_name','recipient_phone','delivery_landmark','production_note','delivery_note')")" = "5" ] || die "5 kolom baru Order tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_constraint where conname = 'pkr_order_items_qty_chk' and pg_get_constraintdef(oid) like '%<= 200%'")" = "1" ] || die "CHECK qty 200 tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_constraint where conname = 'pkr_item_revisions_kind_chk' and pg_get_constraintdef(oid) like '%PEMBELI%'")" = "1" ] || die "CHECK jenis revisi PEMBELI tidak ada setelah rilis"
ok "enum LeadSource baru + 5 kolom Order + CHECK qty 200 + jenis revisi PEMBELI ada (tidak ada asumsi tentang dokumen baru)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin + penolakan sebelum menyentuh data, identitas customer di daftar order, proyeksi Produksi (tanpa harga/telepon), dry-run legacy, invarian jurnal"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e LEGACY_N="$LEGACY_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
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
const tokenUntuk = async (u) => { const roles = (await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role); return jwt.sign({ id: u.id, name: u.name, role: u.role, roles: roles.length ? roles : [u.role] }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) {
    const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
    if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u;
  }
  return null;
}
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
if (!adm || !sales) { rec("akun ADMIN dan SALES murni tersedia", false, `adm=${!!adm} sales=${!!sales}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const produksi = await userDengan("PRODUCTION_LEAD", new Set([...BERIZIN, "SALES"]));
const tP = produksi ? await tokenUntuk(produksi) : null;
const nol = "00000000-0000-4000-8000-000000000000";
const orderTakAda = "cmtidakadaxxxxxxxxxxxxxx";
const hitungSql = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const B = (k) => Number(process.env[k]);

// ── Penolakan SEBELUM menyentuh data ──
const m1 = (await api("POST", `/api/finance/penjualan-karyawan/${nol}/koreksi-pembeli/pratinjau`, null, { pemenuhan: { patokan: "x" } }, { "Idempotency-Key": "smoke-cu-anon-1" })).status;
const m2 = (await api("POST", `/api/finance/penjualan-karyawan/${nol}/koreksi-pembeli/pratinjau`, tS, { pemenuhan: { patokan: "x" } }, { "Idempotency-Key": "smoke-cu-sales-1" })).status;
const m3 = (await api("POST", `/api/finance/penjualan-karyawan/${nol}/koreksi-pembeli/pratinjau`, tA, { pemenuhan: { patokan: "x" } }, { "Idempotency-Key": "smoke-cu-adm-1" })).status;
rec("pratinjau koreksi pembeli: tanpa token 401, SALES 403, admin id tak dikenal 404 (tidak menyentuh data)", m1 === 401 && m2 === 403 && m3 === 404, `${m1},${m2},${m3}`);
const k1 = (await api("POST", `/api/finance/penjualan-karyawan/${nol}/koreksi-pembeli`, null, { pemenuhan: { patokan: "x" }, expectedRevision: 0, alasan: "uji smoke" }, { "Idempotency-Key": "smoke-cu-anon-2" })).status;
const k2 = (await api("POST", `/api/finance/penjualan-karyawan/${nol}/koreksi-pembeli`, tS, { pemenuhan: { patokan: "x" }, expectedRevision: 0, alasan: "uji smoke" }, { "Idempotency-Key": "smoke-cu-sales-2" })).status;
const k3 = (await api("POST", `/api/finance/penjualan-karyawan/${nol}/koreksi-pembeli`, tA, { pemenuhan: { patokan: "x" }, expectedRevision: 0, alasan: "uji smoke" })).status;
rec("koreksi pembeli: tanpa token 401, SALES 403, admin tanpa Idempotency-Key 400/428", k1 === 401 && k2 === 403 && [400, 428].includes(k3), `${k1},${k2},${k3}`);
const o1 = (await api("POST", `/api/orders/${orderTakAda}/pkr/koreksi-pembeli/pratinjau`, tS, { pemenuhan: { patokan: "x" } }, { "Idempotency-Key": "smoke-cu-sales-3" })).status;
const o2 = (await api("POST", `/api/orders/${orderTakAda}/pkr/koreksi-pembeli/pratinjau`, tA, { pemenuhan: { patokan: "x" } }, { "Idempotency-Key": "smoke-cu-adm-3" })).status;
rec("jalur sempit order: SALES 403, admin order tak dikenal 404", o1 === 403 && o2 === 404, `${o1},${o2}`);
const SAH = new Set([400, 401, 403, 404, 428]);
rec(`semua ${tulis.length} pemanggilan tulis ditolak sebelum menyentuh data: smoke TIDAK menulis data produksi`, tulis.length >= 6 && tulis.every((b) => SAH.has(b.status)), tulis.map((b) => `${b.n}=${b.status}`).join("; "));
const c1 = (await api("GET", "/api/finance/penjualan-karyawan/pembeli/cari?telepon=081200000000", null)).status;
const c2 = (await api("GET", "/api/finance/penjualan-karyawan/pembeli/cari?telepon=081200000000", tS)).status;
const c3 = await api("GET", "/api/finance/penjualan-karyawan/pembeli/cari?telepon=081200000000", tA);
rec("cari customer lewat nomor: tanpa token 401, SALES 403, admin 200 (baca-saja)", c1 === 401 && c2 === 403 && c3.status === 200 && typeof c3.json?.ditemukan === "boolean", `${c1},${c2},${c3.status}`);

// ── Identitas customer di daftar order (read-model kanonis) ──
const pkr = await prisma.$queryRawUnsafe(`select o.id, o."orderNumber" as nomor, (c.staff_user_id is not null and coalesce(o.notes, '') not like '%"pembeliKaryawan":true%') as legacy from "Order" o join "Customer" c on c.id = o."customerId" where o.penjualan_karyawan_id is not null and o.status::text <> 'CANCELLED' order by o."createdAt" desc limit 60`);
if (pkr.length) {
  const od = await api("GET", "/api/orders?limit=5000", tA);
  const peta = new Map((od.json?.items ?? []).map((x) => [x.id, x]));
  const salah = pkr.filter((p) => { const it = peta.get(p.id); if (!it) return false; const id = it.penjualanKaryawan?.identitas; return !id || !id.customer?.nama || Boolean(id.legacy) !== Boolean(p.legacy); });
  rec(`daftar order: ${pkr.length} order PKR membawa identitas (nama customer terisi; legacy = profil karyawan tanpa penanda)`, od.status === 200 && salah.length === 0, salah.map((p) => p.nomor).join(","));
  const bocor = (od.json?.items ?? []).filter((x) => x.penjualanKaryawan && x.penjualanKaryawan.identitas?.customer?.nama && x.penjualanKaryawan.identitas.karyawanPenjual?.nama && x.penjualanKaryawan.identitas.customer.nama === x.penjualanKaryawan.identitas.karyawanPenjual.nama && x.penjualanKaryawan.identitas.legacy === false && !x.penjualanKaryawan.identitas.pembeliAdalahKaryawan);
  rec("tidak ada order PKR aktual yang namanya sama dengan karyawan penjual (selain jalur 'pembeli adalah karyawan')", bocor.length === 0, bocor.map((x) => x.orderNumber).join(","));
  if (tP) {
    const op = await api("GET", "/api/orders?limit=5000", tP);
    const sampel = (op.json?.items ?? []).filter((x) => x.penjualanKaryawan);
    rec(`peran Produksi: ${sampel.length} order PKR tanpa status pembayaran/harga, tanpa telepon & alamat pada identitas`, op.status === 200 && sampel.every((x) => x.penjualanKaryawan.pembayaran === null && x.penjualanKaryawan.identitas?.customer?.telepon === undefined && x.penjualanKaryawan.identitas?.alamat === undefined), "");
  } else skip("proyeksi Produksi tanpa harga/telepon", "tidak ada akun PRODUCTION_LEAD murni; token tidak dibuat — dijaga tes integrasi");
} else skip("identitas customer di daftar order", "belum ada order PKR aktif");
const dr = await api("GET", "/api/finance/penjualan-karyawan/pembeli/dry-run", tA);
rec("dry-run legacy (admin) 200 baca-saja; ringkasan legacy terhitung", dr.status === 200 && typeof dr.json?.ringkasan?.legacy === "number", `legacy=${dr.json?.ringkasan?.legacy} (sebelum rilis: ${B("LEGACY_N")})`);

// ── Invarian jurnal (tidak bertambah dari garis dasar) ──
rec(`jurnal tidak seimbang (sebelum rilis: ${B("BASE_TIDAK_SEIMBANG")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x`)) <= B("BASE_TIDAK_SEIMBANG"));
rec(`tiap refund punya paling banyak SATU jurnal berlaku (ganda sebelum rilis: ${B("BASE_GANDA")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x`)) <= B("BASE_GANDA"));
rec("tidak ada order PKR yang punya Payment/invoice (Order CRM tetap tanpa uang)", (await hitungSql(`select count(*)::int n from payments p join "Order" o on o.id = p.order_id where o.penjualan_karyawan_id is not null`)) === 0);
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
  ok "smoke test lulus (izin, penolakan sebelum menyentuh data, identitas customer di daftar order, proyeksi Produksi, dry-run legacy, invarian jurnal)"
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
say "TINDAK LANJUT OWNER: data lama TIDAK berubah. Order PKR lama (mis. PKR-11102026-005 Indra) tampil \"Data customer belum lengkap\" sampai Admin memilih Lengkapi Data Customer (nomor, alamat, Maps, keluhan) di Finance › Penjualan Karyawan. Dry-run: node backend/scripts/pkr-pembeli-dry-run.js."
