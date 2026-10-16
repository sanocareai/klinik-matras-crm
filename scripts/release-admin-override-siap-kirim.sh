#!/usr/bin/env bash
# RILIS "ADMIN OVERRIDE: SIAP KIRIM SAAT PENCATATAN PRODUKSI BELUM SELESAI" (kasus Rika): web + backend + 1 migrasi ADITIF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Pencatatan Production Run masih dalam pengembangan, jadi unit yang oleh Admin/Owner DITETAPKAN siap untuk proses pengiriman perlu bisa masuk Route Planner walau Run masih ACTIVE.
#   Ini KEPUTUSAN ADMIN per unit (alasan + lokasi pengambilan + konfirmasi eksplisit + audit), BUKAN hasil pemeriksaan: tidak ada klaim pemeriksaan fisik/QC; tidak ada bukti/QC/foto/serah terima/movement palsu.
#   Migrasi: 2 kolom NULL pada production_runs_v2 (delivery_released_at, delivery_release) + 1 CHECK (keduanya terisi bersamaan atau kosong bersamaan). Tanpa backfill. Tanpa perubahan data lama.
#   Kode: POST/GET /production-v2/units/:unitId/delivery-release (Admin/Owner), pagar tahap/bahan pada Run yang unitnya sudah di-override, penanda jujur di Route Planner/app Driver, UI Sales + Unit 360.
#   driver-mobile/JobCard.js ikut dalam commit tetapi aplikasi RN TIDAK dibangun/OTA oleh rilis ini (OTA terpisah, atas keputusan Owner).
# Produksi: verifikasi hanya baca + penolakan izin; TIDAK ada override, status unit, job, rute, atau penugasan driver yang dibuat. Rika HANYA dibaca dan dibandingkan sebelum vs sesudah.
#
#   cat scripts/release-admin-override-siap-kirim.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/ao1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/ao1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/ao1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only'     # backup NYATA + restore ke DB sementara + migrasi + uji CHECK; TANPA build/release dir/migrasi produksi/switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/ao1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/ao1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode aman di-rollback HANYA bila belum ada Run yang di-override. Periksa dulu dengan scripts/rollback-guard-admin-override-siap-kirim.sh (baca-saja).
#   Bila sudah ada: kode lama tidak mengenal override — unit READY_FOR_DELIVERY dengan Run ACTIVE akan tampil sebagai konflik V1 dan command tahap tidak lagi menolak Run itu.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/lepas-pengiriman-pengecualian-fisik}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261201100000_production_admin_override_siap_kirim:c5e6afc321791b2a6636eebec4c3bfcc4d1da51625c147fe7091cd076ba099d8"
# Hasil pemindai untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":3,"kolom":2,"check":1}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index dan tanpa nomor baris hunk) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="ad2e5f9b0dd6720475b46e619306bc0b88b8b5e7e66d5fa5ca8958fdf0a0a2d8"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard rollback). Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261201100000_production_admin_override_siap_kirim/migration\.sql|backend/prisma/schema\.prisma|backend/src/lib/activityLog\.js|backend/src/routes/armada\.js|backend/src/routes/productionExperience\.js|backend/src/services/adminOverrideSwitch\.js|backend/src/services/deliveryOverrideAdmin\.js|backend/src/services/driverSnapshotV2\.js|backend/src/services/productionExperienceReadService\.js|backend/src/services/productionRunGuards\.js|backend/src/services/productionStepCommandService\.js|backend/src/services/productionWorkshopExecutionCommandService\.js|backend/src/services/unitCustodyCommandService\.js|backend/src/services/unitStageEngine\.js|backend/tests/integration/adminOverrideSiapKirim\.integration\.test\.js|frontend/src/api\.js|frontend/src/features/armada/components/(JobBadges|RouteCard|UnroutedJobsPanel)\.jsx|frontend/src/features/orders/OrderTimelineDrawer\.jsx|frontend/src/features/production/(AdminOverrideSiapKirim|UnitOverviewDrawer)\.jsx|frontend/src/features/production/UnitCard\.jsx|frontend/src/features/production/adminOverrideSiapKirimLogic\.js|frontend/tests/adminOverrideSiapKirim\.test\.js|docs/RUNBOOK-ADMIN-OVERRIDE-SIAP-KIRIM\.md|frontend/src/pages/bengkel/ProductionWorkflowSettings\.jsx|frontend/src/features/production/AdminOverrideSaklarCard\.jsx|scripts/release-konfirmasi-barang-jadi\.sh|scripts/release-admin-override-siap-kirim\.sh|scripts/rollback-guard-admin-override-siap-kirim\.sh)$'
BACKEND_SRC_EXPECT="backend/src/lib/activityLog.js backend/src/routes/armada.js backend/src/routes/productionExperience.js backend/src/services/adminOverrideSwitch.js backend/src/services/deliveryOverrideAdmin.js backend/src/services/driverSnapshotV2.js backend/src/services/productionExperienceReadService.js backend/src/services/productionRunGuards.js backend/src/services/productionStepCommandService.js backend/src/services/productionWorkshopExecutionCommandService.js backend/src/services/unitCustodyCommandService.js backend/src/services/unitStageEngine.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/armada/components/JobBadges.jsx frontend/src/features/armada/components/RouteCard.jsx frontend/src/features/armada/components/UnroutedJobsPanel.jsx frontend/src/features/orders/OrderTimelineDrawer.jsx frontend/src/features/production/AdminOverrideSaklarCard.jsx frontend/src/features/production/AdminOverrideSiapKirim.jsx frontend/src/features/production/UnitCard.jsx frontend/src/features/production/UnitOverviewDrawer.jsx frontend/src/features/production/adminOverrideSiapKirimLogic.js frontend/src/pages/bengkel/ProductionWorkflowSettings.jsx"
# Hotfix Stock Count + penutupan jalur cepat opname: harus ada di kandidat DAN berkasnya identik dengan baseline (rilis ini tidak boleh menyentuhnya).
HOTFIX_STOCK_COUNT="b5268e1f7d8e1a15a251106dee0a136898ee5ce1"
GUARD_UNCHANGED="backend/src/routes/stockCount.js backend/src/services/opnameCutover.js backend/src/services/opnameMatriks.js backend/src/services/pergerakanSesiHitung.js backend/src/services/finance/journal.js backend/src/middleware/authorize.js backend/src/middleware/auth.js"
# Kasus Rika (HANYA DIBACA): unit dan run yang diaudit 16 Okt 2026. Tidak pernah ditulis oleh rilis ini.
RIKA_UNIT="RES-03102026-018-U1"
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
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; [ "$a" = "--rehearsal-only" ] && REHEARSAL_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/admin-override-${DEPLOY_SHORT}-${TS}"
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
   bash ${NEW_DIR}/scripts/rollback-guard-admin-override-siap-kirim.sh
Guard menolak (exit 1) bila SUDAH ada Run yang di-override (production_runs_v2.delivery_released_at terisi): kode lama tidak mengenal override.
   Bila guard menolak: JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner.
Bila guard lulus (belum ada override), rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi bersifat ADITIF (2 kolom NULL + 1 CHECK): dibiarkan terpasang pun aman bagi kode lama SELAMA belum ada override. (Tidak dihapus oleh rollback kode.)
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
exec 9>/tmp/release-admin-override-siap-kirim.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "ao1\|release-admin-override-siap-kirim\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
# MAIN_LEBIH_MAJU: main boleh memuat commit di atas release aktif asalkan selisih BASE..MAIN hanya scripts/, docs/, dan tes skrip rilis (backend/tests/release*.test.js) (tidak ada kode aplikasi/prisma/frontend). Berkas itu ikut diizinkan (bukan bagian audit rilis ini).
MAIN_FILES=""
if ! sg merge-base --is-ancestor "$MAIN_SHA" "$BASE_SHA"; then
  sg merge-base --is-ancestor "$BASE_SHA" "$MAIN_SHA" || die "origin/main (${MAIN_SHA:0:8}) dan baseline ${BASE_SHA:0:8} bercabang — gabungkan lineage terbaru lalu ulangi tes/preflight"
  MAIN_EXTRA="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA" | grep -Ev '^(scripts/|docs/|backend/tests/release[A-Za-z0-9]+\.test\.js$)' || true)"
  [ -z "$MAIN_EXTRA" ] || { printf '%s\n' "$MAIN_EXTRA" | sed 's/^/        /'; die "origin/main memuat perubahan kode yang tidak ada di release aktif — berhenti"; }
  MAIN_FILES="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA")"
  warn "origin/main (${MAIN_SHA:0:8}) lebih maju dari baseline hanya pada scripts/docs ($(printf '%s\n' "$MAIN_FILES" | wc -l) berkas) — ikut diizinkan"
fi
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat ${DEPLOY_SHORT}: rilis akan menghilangkan isi main — gabungkan main ke kandidat dulu"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" | { grep -Fvx -f <(printf '%s\n' "$MAIN_FILES") || true; } || true)"
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
[ "$(sg diff -U0 --no-color "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | grep -v '^index ' | sed -E 's/^@@ [^@]*@@.*$/@@/' | { cat; echo; } | sha256sum | cut -d' ' -f1)" = "$SCHEMA_DIFF_SHA" ] || die "diff schema.prisma BERBEDA dari yang diaudit (pin SCHEMA_DIFF_SHA) — audit ulang lalu perbarui pin"
ok "schema.prisma: diff identik dengan yang diaudit (aditif: 2 field baru pada ProductionRun, tanpa mengubah kolom lama)"
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
// Pemindai migrasi rilis "Admin override Siap Kirim" (1 migrasi aditif). FAIL-CLOSED: setiap pernyataan harus cocok PERSIS salah satu bentuk yang diaudit.
//  - ALTER TABLE "production_runs_v2" ADD COLUMN tepat 2 kolom nullable: "delivery_released_at" TIMESTAMP(3) dan "delivery_release" JSONB (masing-masing SATU pernyataan).
//  - SATU CHECK pada "production_runs_v2": keduanya terisi bersamaan atau kosong bersamaan.
// Tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/ALTER COLUMN/RENAME/GRANT/CREATE TABLE/INDEX/FK/ENUM/FUNGSI/TRIGGER, tidak ada kolom lain, tidak ada tabel lain.
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
const BOLEH = new Map([
  ["kolom", new Set([
    "ALTER TABLE \"production_runs_v2\" ADD COLUMN \"delivery_released_at\" TIMESTAMP(3)",
    "ALTER TABLE \"production_runs_v2\" ADD COLUMN \"delivery_release\" JSONB",
  ])],
  ["check", new Set([
    "ALTER TABLE \"production_runs_v2\" ADD CONSTRAINT \"production_runs_v2_delivery_release_pair_chk\" CHECK ((\"delivery_released_at\" IS NULL) = (\"delivery_release\" IS NULL))",
  ])],
]);
const hitung = { total: 0, kolom: 0, check: 0 };
const lihat = new Set();
for (const r of pecah(sql)) {
  hitung.total += 1;
  if (lihat.has(r)) gagal("pernyataan ganda: " + r.slice(0, 120));
  lihat.add(r);
  const jenis = [...BOLEH.entries()].find(([, set]) => set.has(r))?.[0];
  if (!jenis) gagal("PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 200));
  hitung[jenis] += 1;
}
console.log(JSON.stringify(hitung));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (2 kolom NULL + 1 CHECK pada production_runs_v2); tanpa DROP/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT/tabel-indeks-FK-fungsi-trigger baru"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE tabel run" "$(tambah_stmt 'DROP TABLE "production_runs_v2";')"
harus_ditolak "DROP TABLE tabel lain" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "UPDATE run (backfill)" "$(tambah_stmt "UPDATE \"production_runs_v2\" SET \"delivery_released_at\" = now();")"
harus_ditolak "UPDATE unit (ubah status)" "$(tambah_stmt "UPDATE \"units\" SET \"status\" = 'READY_FOR_DELIVERY';")"
harus_ditolak "UPDATE order" "$(tambah_stmt "UPDATE \"Order\" SET \"status\" = 'READY';")"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "production_runs_v2";')"
harus_ditolak "INSERT" "$(tambah_stmt "INSERT INTO \"production_settings\" (key) VALUES ('x');")"
harus_ditolak "INSERT ... SELECT (backfill)" "$(tambah_stmt 'INSERT INTO "production_runs_v2" SELECT * FROM "production_runs_v2";')"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "production_runs_v2";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "production_runs_v2" DROP COLUMN "status";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "production_runs_v2" ALTER COLUMN "revision" TYPE BIGINT;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "production_runs_v2" RENAME COLUMN "status" TO "state";')"
harus_ditolak "kolom liar pada production_runs_v2" "$(tambah_stmt 'ALTER TABLE "production_runs_v2" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom pada tabel lain (units)" "$(tambah_stmt 'ALTER TABLE "units" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom NOT NULL (bukan nullable)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ADD COLUMN "delivery_released_at" TIMESTAMP(3)/ADD COLUMN "delivery_released_at" TIMESTAMP(3) NOT NULL/')"
harus_ditolak "kolom dengan DEFAULT (backfill terselubung)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ADD COLUMN "delivery_release" JSONB/ADD COLUMN "delivery_release" JSONB DEFAULT '"'"'{}'"'"'/')"
harus_ditolak "tipe kolom diubah" "$(printf '%s\n' "$ALL_SQL" | sed 's/"delivery_release" JSONB/"delivery_release" TEXT/')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "indeks liar" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "production_runs_v2"("status");')"
harus_ditolak "FK liar" "$(tambah_stmt 'ALTER TABLE "production_runs_v2" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;')"
harus_ditolak "CHECK dilonggarkan" "$(printf '%s\n' "$ALL_SQL" | sed 's/("delivery_released_at" IS NULL) = ("delivery_release" IS NULL)/("delivery_released_at" IS NULL) OR ("delivery_release" IS NULL)/')"
harus_ditolak "CHECK dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'delivery_release_pair_chk')"
harus_ditolak "CHECK ganda" "$(tambah_stmt 'ALTER TABLE "production_runs_v2" ADD CONSTRAINT "x_chk" CHECK ("revision" > 0);')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "production_runs_v2" DROP CONSTRAINT "production_runs_v2_pkey";')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"UnitStatus\" ADD VALUE IF NOT EXISTS 'LIAR';")"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "production_runs_v2" TO PUBLIC;')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "trigger liar" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "production_runs_v2" FOR EACH ROW EXECUTE FUNCTION evil();')"
harus_ditolak "pernyataan ganda" "$(tambah_stmt 'ALTER TABLE "production_runs_v2" ADD COLUMN "delivery_release" JSONB;')"
[ "$NEG" -ge 28 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 28)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER COLUMN/RENAME/kolom liar/NOT NULL/DEFAULT/tipe diubah/tabel-indeks-FK liar/CHECK longgar/GRANT/fungsi-trigger liar) SEMUANYA ditolak"
! printf '%s\n' "$CHANGED" | grep -q '^driver-mobile/' || die "driver-mobile berubah — rilis ini TIDAK membawa app Driver (OTA dari branch ota/driver-override-siap-kirim-on-20261015, terpisah)"
sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA" || die "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} BUKAN leluhur kandidat — rilis akan menghilangkannya; gabungkan live terbaru dulu"
sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$BASE_SHA" || die "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} belum ada di baseline live ${BASE_SHA:0:8} — baseline bukan yang diharapkan"
for f in $GUARD_UNCHANGED; do
  [ "$(sg rev-parse "${BASE_SHA}:${f}")" = "$(sg rev-parse "${DEPLOY_SHA}:${f}")" ] || die "${f} berbeda antara baseline dan kandidat — rilis ini tidak boleh menyentuhnya (hotfix Stock Count/ledger/otorisasi)"
done
ok "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} ada di baseline DAN kandidat; $(printf '%s\n' $GUARD_UNCHANGED | wc -l) berkas pelindung (Stock Count, opname, ledger, otorisasi) identik dengan baseline"
# Urutan migrasi: nama migrasi rilis ini HARUS terurut SETELAH migrasi terbaru di baseline (Prisma menerapkan menurut nama); konvensi repo memakai stempel yang sudah mendahului tanggal kalender.
MIG_BASE_MAX="$(sg ls-tree --name-only "$BASE_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort | tail -n 1)"
for e in $MIGS; do [[ "${e%%:*}" > "$MIG_BASE_MAX" ]] || die "migrasi ${e%%:*} tidak terurut SETELAH migrasi baseline terbaru (${MIG_BASE_MAX})"; done
ok "urutan migrasi:${MIG_LIST} terurut setelah migrasi baseline terbaru (${MIG_BASE_MAX})"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit (termasuk 1 migrasi aditif + schema.prisma yang diaudit; driver-mobile/JobCard.js tanpa OTA)"

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
# Prasyarat skema: tabel yang dibaca/ditulis kode baru HARUS sudah ada di produksi; objek rilis ini belum boleh ada.
for T in "Order" units jobs job_units routes production_runs_v2 production_phase_runs_v2 production_operation_runs_v2 production_step_evidence_v2 quality_inspections_v2 unit_custody_handoffs_v2 stock_movements activity_events v2_commands v2_feature_flags storage_locations fin_journal_entries fin_journal_lines; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='production_runs_v2' and column_name in ('delivery_released_at','delivery_release')")" = "0" ] || die "kolom override SUDAH ada di production_runs_v2 (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_constraint where conname = 'production_runs_v2_delivery_release_pair_chk'")" = "0" ] || die "CHECK override SUDAH ada (tidak diharapkan)"
for m in $MIG_LIST; do [ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${m}'")" = "0" ] || die "migrasi ${m} SUDAH tercatat di produksi (tidak diharapkan)"; done
UNIT_N="$(psql_live -At -c "select count(*) from units")"; JOB_N="$(psql_live -At -c "select count(*) from jobs")"; RUN_N="$(psql_live -At -c "select count(*) from production_runs_v2")"; ROUTE_N="$(psql_live -At -c "select count(*) from routes")"
SM_N="$(psql_live -At -c "select count(*) from stock_movements")"; CUS_N="$(psql_live -At -c "select count(*) from unit_custody_handoffs_v2")"; QI_N="$(psql_live -At -c "select count(*) from quality_inspections_v2")"
for v in "$UNIT_N" "$JOB_N" "$RUN_N" "$ROUTE_N" "$SM_N" "$CUS_N" "$QI_N"; do [[ "$v" =~ ^[0-9]+$ ]] || die "audit awal bukan angka: '$v'"; done
[ "$RUN_N" -ge 1 ] && [ "$UNIT_N" -ge 1 ] || die "data contoh produksi kurang untuk uji perilaku rehearsal (butuh >=1 run dan >=1 unit)"
ok "prasyarat skema terpenuhi; unit=${UNIT_N}, job=${JOB_N}, rute=${ROUTE_N}, run V2=${RUN_N}, pergerakan stok=${SM_N}, custody V2=${CUS_N}, inspeksi QC V2=${QI_N}; objek rilis ini belum ada — tanpa backfill"
# KASUS RIKA (baca-saja). Format: status unit|lokasi|status run|revisi|fase|kebijakan|jumlah job pengiriman|md5 (fase, operasi, bukti, custody, stok, QC, event aktivitas, job). Dicatat SEBELUM dan dibandingkan SESUDAH rilis.
RIKA_SQL="select concat_ws('|', u.status::text, coalesce(u.storage_location,'-'), r.status::text, r.revision::text, coalesce(r.current_phase::text,'-'), coalesce(r.adaptation_policy,'-'),
  (select count(*) from job_units ju join jobs j on j.id = ju.job_id where ju.unit_id = u.id and j.type::text = 'DELIVERY'),
  md5(concat((select coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'') from production_phase_runs_v2 x where x.run_id = r.id),
             (select coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'') from production_operation_runs_v2 x where x.run_id = r.id),
             (select coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'') from production_step_evidence_v2 x where x.run_id = r.id),
             (select coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'') from unit_custody_handoffs_v2 x where x.unit_id = u.id),
             (select coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'') from stock_movements x where x.unit_id = u.id),
             (select coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'') from quality_inspections_v2 x where x.run_id = r.id),
             (select coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'') from activity_events x where x.entity_id = u.id::text),
             (select coalesce(string_agg(to_jsonb(j)::text, '|' order by j.id),'') from job_units ju join jobs j on j.id = ju.job_id where ju.unit_id = u.id)))
  ) from units u join production_runs_v2 r on r.unit_id = u.id where u.unit_code = '${RIKA_UNIT}' order by r.created_at desc limit 1"
RIKA_SEBELUM="$(psql_live -At -c "$RIKA_SQL")"
[ -n "$RIKA_SEBELUM" ] || die "unit ${RIKA_UNIT} atau run V2-nya tidak ditemukan di produksi"
RIKA_STATUS="${RIKA_SEBELUM%%|*}"
case "$RIKA_STATUS" in
  IN_PRODUCTION|RECEIVED) ok "kasus Rika ${RIKA_UNIT} sebelum rilis: ${RIKA_SEBELUM} (belum Siap Kirim, sesuai diagnosis)";;
  *) warn "kasus Rika ${RIKA_UNIT} berstatus ${RIKA_STATUS} — TIDAK sesuai diagnosis (IN_PRODUCTION); rilis tetap aman (hanya dibaca), tetapi laporkan keadaan ini: ${RIKA_SEBELUM}";;
esac
# SAKLAR override (production_admin_override_siap_kirim): sebelum rilis TIDAK BOLEH aktif (bawaan OFF/fail-closed). Aktif sebelum rilis = ada yang menyalakan lebih dulu -> berhenti.
SAKLAR_AKTIF="$(psql_live -At -c "select count(*) from v2_feature_flags where key = 'production_admin_override_siap_kirim' and enabled = true")"
[ "$SAKLAR_AKTIF" = "0" ] || die "saklar production_admin_override_siap_kirim SUDAH aktif di produksi sebelum rilis — berhenti"
ok "saklar production_admin_override_siap_kirim: tidak aktif di produksi (baris=$(psql_live -At -c "select count(*) from v2_feature_flags where key = 'production_admin_override_siap_kirim'")); bawaan OFF/fail-closed tetap setelah rilis"
# GARIS DASAR invarian (dibandingkan sesudah rilis; yang dijaga = TIDAK BERTAMBAH oleh rilis ini).
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"
[[ "$BASE_TIDAK_SEIMBANG" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$BASE_TIDAK_SEIMBANG'"
printf 'BASE_TIDAK_SEIMBANG=%q\nUNIT_N=%q\nJOB_N=%q\nRUN_N=%q\nROUTE_N=%q\nSM_N=%q\nCUS_N=%q\nQI_N=%q\nRIKA_SEBELUM=%q\n' "$BASE_TIDAK_SEIMBANG" "$UNIT_N" "$JOB_N" "$RUN_N" "$ROUTE_N" "$SM_N" "$CUS_N" "$QI_N" "$RIKA_SEBELUM" > "$BK_DIR/garis-dasar.env"
( set -e; . "$BK_DIR/garis-dasar.env"; [ "$RIKA_SEBELUM" = "$(psql_live -At -c "$RIKA_SQL")" ] ) || die "garis-dasar.env tidak aman di-source / keadaan Rika berubah saat dicatat"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}"
# SIDIK JARI TABEL (seluruh isi baris, jsonb): dibandingkan SEBELUM vs SESUDAH migrasi + uji perilaku + kode baru pada DB rehearsal. production_runs_v2 dibandingkan TANPA 2 kolom baru (kolom itu memang baru).
FP_SQL="select 'units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from units x
union all select 'jobs', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from jobs x
union all select 'job_units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from job_units x
union all select 'routes', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from routes x
union all select 'production_runs_v2', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'delivery_released_at' - 'delivery_release')::text, '|' order by x.id),'')) from production_runs_v2 x
union all select 'production_phase_runs_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_phase_runs_v2 x
union all select 'production_operation_runs_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_operation_runs_v2 x
union all select 'production_step_evidence_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_step_evidence_v2 x
union all select 'quality_inspections_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from quality_inspections_v2 x
union all select 'unit_custody_handoffs_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from unit_custody_handoffs_v2 x
union all select 'stock_movements', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x
union all select 'activity_events', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from activity_events x
union all select 'v2_commands', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from v2_commands x
union all select 'v2_feature_flags', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from v2_feature_flags x"
FP_N=14
# DOKUMEN PEMBANDING DIBEKUKAN: hanya yang tidak mungkin berubah akibat rilis ini (append-only atau dibuat sebelum T0). T0 = jam DB (UTC) 5 menit lalu.
# Dokumen terbuka dan transaksi baru TIDAK diperbandingkan (pengguna sah boleh bertransaksi selama rilis).
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'pergerakan_stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'event_aktivitas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from activity_events x where x.created_at < '$T0'::timestamp
union all select 'bukti_tahap', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_step_evidence_v2 x where x.created_at < '$T0'::timestamp
union all select 'inspeksi_qc', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from quality_inspections_v2 x where x.created_at < '$T0'::timestamp
union all select 'custody_v2', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from unit_custody_handoffs_v2 x where x.created_at < '$T0'::timestamp
union all select 'run_v2', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from production_runs_v2 x where x.created_at < '$T0'::timestamp
union all select 'job', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from jobs x where x.created_at < '$T0'::timestamp
union all select 'rute', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from routes x where x.created_at < '$T0'::timestamp
union all select 'jurnal_induk', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from fin_journal_entries x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'flag_settings', count(*), md5(coalesce(string_agg(to_jsonb(f)::text, '|' order by f.key),'')) from fin_settings f
union all select 'flag_v2', count(*), md5(coalesce(string_agg(to_jsonb(f)::text, '|' order by f.key),'')) from v2_feature_flags f
FPBEKU
)"
FPB_N=12
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
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-ao-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

if [ "$REHEARSAL_ONLY" = "1" ]; then
  # MODE --rehearsal-only: backup NYATA + restore ke DB sementara + migrasi (SQL dari git) + uji CHECK + sidik jari; TANPA build image, TANPA release dir, TANPA migrasi/switch produksi. DB sementara selalu dihapus.
  PHASE="3b-rehearsal-saja"; say "3b. REHEARSAL SAJA: restore backup NYATA ke DB sementara, terapkan migrasi (SQL dari git, bukan dari produksi), uji CHECK, bandingkan sidik jari (produksi tidak diubah)"
  REH_DB="rehearsal_ao_${TS}"
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
  reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
  gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
  RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
  psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod-beku.txt" || { reh_drop; die "sidik jari dokumen beku produksi gagal"; }
  cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || true; reh_drop; die "dokumen pembanding beku BERUBAH selama backup (produksi)"; }
  RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
  cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi (backup/restore bermasalah)"; }
  [ "$(RPSQL "$RIKA_SQL")" = "$RIKA_SEBELUM" ] || { reh_drop; die "keadaan Rika pada hasil RESTORE berbeda dari produksi"; }
  RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sebelum.txt" || { reh_drop; die "sidik jari penuh rehearsal gagal"; }
  [ "$(grep -c . "$BK_DIR/fp-reh-sebelum.txt")" = "$FP_N" ] || { reh_drop; die "sidik jari penuh rehearsal tidak ${FP_N} tabel"; }
  ok "restore nyata IDENTIK dengan dokumen beku produksi; keadaan Rika identik"
  # Migrasi pending (menurut git kandidat vs terpasang di produksi) HARUS tepat migrasi rilis ini.
  PEND_SAJA="$(comm -23 <(sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
  [ "$(printf '%s\n' "$PEND_SAJA" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || { reh_drop; die "migrasi pending bukan tepat migrasi rilis ini: $(printf '%s' "$PEND_SAJA" | tr '\n' ' ')"; }
  ok "migrasi pending untuk rilis ini = tepat:${MIG_LIST}"
  for e in $MIGS; do
    sg show "${DEPLOY_SHA}:backend/prisma/migrations/${e%%:*}/migration.sql" | tr -d '\r' | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=1 -X -q > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 10 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrasi ${e%%:*} GAGAL pada DB rehearsal"; }
  done
  ok "migrasi diterapkan pada DB rehearsal (hasil restore); produksi tidak disentuh"
  # Struktur: 2 kolom baru ada, SEMUA baris Run tetap NULL (tanpa backfill), CHECK terpasang.
  [ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='production_runs_v2' and column_name in ('delivery_released_at','delivery_release')")" = "2" ] || { reh_drop; die "2 kolom override tidak terbentuk"; }
  [ "$(RPSQL "select count(*) from production_runs_v2 where delivery_released_at is not null or delivery_release is not null")" = "0" ] || { reh_drop; die "ada Run ber-override setelah migrasi (backfill tidak diharapkan)"; }
  [ "$(RPSQL "select count(*) from pg_constraint where conname = 'production_runs_v2_delivery_release_pair_chk'")" = "1" ] || { reh_drop; die "CHECK pasangan kolom override tidak terpasang"; }
  ok "struktur: 2 kolom override ada, semua Run tetap NULL (tanpa backfill), CHECK pasangan terpasang"
  # UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan): memakai baris NYATA hasil restore dalam satu blok yang di-RAISE di akhir.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE r uuid; tolak int := 0; lolos int := 0;
BEGIN
  SELECT id INTO r FROM production_runs_v2 ORDER BY id LIMIT 1;
  IF r IS NULL THEN RAISE EXCEPTION 'DATA_CONTOH_KURANG'; END IF;
  -- yang SAH: keduanya terisi bersamaan; lalu keduanya kosong bersamaan
  UPDATE production_runs_v2 SET delivery_released_at = now(), delivery_release = '{"kind":"ADMIN_OVERRIDE"}'::jsonb WHERE id = r; lolos := lolos + 1;
  UPDATE production_runs_v2 SET delivery_released_at = NULL, delivery_release = NULL WHERE id = r; lolos := lolos + 1;
  -- yang HARUS DITOLAK: setengah terisi (rekam audit tidak boleh setengah)
  BEGIN UPDATE production_runs_v2 SET delivery_released_at = now() WHERE id = r; RAISE EXCEPTION 'TIDAK_DITOLAK_waktu_tanpa_rekam';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE production_runs_v2 SET delivery_release = '{"kind":"ADMIN_OVERRIDE"}'::jsonb WHERE id = r; RAISE EXCEPTION 'TIDAK_DITOLAK_rekam_tanpa_waktu';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'DATA_CONTOH_KURANG' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data contoh di hasil restore kurang (butuh >=1 run)"; }
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku CHECK SALAH (ada data setengah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" = "2" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti ${UJI_TOLAK:-?} (harus 2)"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" = "2" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos ${UJI_LOLOS:-?} (harus 2)"; }
ok "perilaku CHECK terbukti di DB rehearsal: tolak=${UJI_TOLAK} lolos=${UJI_LOLOS} — keduanya terisi/kosong bersamaan lolos; waktu tanpa rekam dan rekam tanpa waktu ditolak; seluruh uji dibatalkan"

  RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
  cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
  [ "$(RPSQL "select count(*) from production_runs_v2 where delivery_released_at is not null or delivery_release is not null")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
  [ "$(RPSQL "$RIKA_SQL")" = "$RIKA_SEBELUM" ] || { reh_drop; die "keadaan Rika pada DB rehearsal BERUBAH oleh migrasi/uji"; }
  reh_drop
  ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrasi + uji CHECK; DB sementara dihapus; PRODUKSI TIDAK DIUBAH (tanpa build, tanpa release dir, tanpa migrasi, tanpa switch)"
  trap - EXIT; exit 0
fi

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-admin-override-siap-kirim.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
# Fitur rilis ini + fitur rilis sebelumnya (jangan sampai hilang dari bundel). Teks LAMA diverifikasi ada di dist release aktif (kalau tidak ada, skrip ini yang salah, bukan kandidat).
for s1 in "Admin override: Siap Kirim saat pencatatan produksi belum selesai" "Siap Kirim — override Admin (pencatatan produksi belum selesai)" "Lokasi pengambilan" "keputusan override Admin, bukan hasil pemeriksaan atau QC" "Unit lain pada order ini TIDAK ikut ditetapkan" "Tetapkan Siap Kirim (override)" "Admin override belum diaktifkan" "Hentikan override baru" "Aktifkan override"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Konfirmasi Barang Jadi" "Menunggu konfirmasi siap kirim" "Konfirmasi kesiapan fisik" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Buat Rute" "Checklist Persiapan Perjalanan" "Histori Waktu" "Selesaikan Produksi" "Rencana Produksi" "Uang muka dialokasikan ke faktur"; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
# Teks klaim pemeriksaan fisik yang sempat ada di kandidat sebelumnya TIDAK BOLEH muncul di dialog override (bundel baru).
for s3 in "Barang sudah diperiksa langsung dan benar-benar jadi" "Pemeriksa fisik" "Tandai Siap Kirim berdasarkan pemeriksaan fisik"; do
  ! grep -lF "$s3" "$NEW_DIR"/frontend/dist/assets/*.js >/dev/null 2>&1 || die "dist baru masih memuat klaim pemeriksaan fisik: ${s3}"
done
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + 11 teks fitur lama ada; tidak ada klaim pemeriksaan fisik di dialog override"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-ao-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_ao_${TS}"
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
[ "$(RPSQL "$RIKA_SQL")" = "$RIKA_SEBELUM" ] || { reh_drop; die "keadaan Rika pada hasil RESTORE berbeda dari produksi (backup/restore bermasalah)"; }
ok "restore nyata IDENTIK dengan dokumen beku produksi (pergerakan stok, event aktivitas, bukti tahap, inspeksi QC, custody, run/job/rute, jurnal, flag); keadaan Rika identik"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$(printf '%s\n' "$REH_PEND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat migrasi rilis ini: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
# Struktur: 2 kolom baru ada, SEMUA baris Run tetap NULL (tanpa backfill), CHECK terpasang.
[ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='production_runs_v2' and column_name in ('delivery_released_at','delivery_release')")" = "2" ] || { reh_drop; die "2 kolom override tidak terbentuk"; }
[ "$(RPSQL "select count(*) from production_runs_v2 where delivery_released_at is not null or delivery_release is not null")" = "0" ] || { reh_drop; die "ada Run ber-override setelah migrasi (backfill tidak diharapkan)"; }
[ "$(RPSQL "select count(*) from pg_constraint where conname = 'production_runs_v2_delivery_release_pair_chk'")" = "1" ] || { reh_drop; die "CHECK pasangan kolom override tidak terpasang"; }
ok "struktur: 2 kolom override ada, semua Run tetap NULL (tanpa backfill), CHECK pasangan terpasang"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan): memakai baris NYATA hasil restore dalam satu blok yang di-RAISE di akhir.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE r uuid; tolak int := 0; lolos int := 0;
BEGIN
  SELECT id INTO r FROM production_runs_v2 ORDER BY id LIMIT 1;
  IF r IS NULL THEN RAISE EXCEPTION 'DATA_CONTOH_KURANG'; END IF;
  -- yang SAH: keduanya terisi bersamaan; lalu keduanya kosong bersamaan
  UPDATE production_runs_v2 SET delivery_released_at = now(), delivery_release = '{"kind":"ADMIN_OVERRIDE"}'::jsonb WHERE id = r; lolos := lolos + 1;
  UPDATE production_runs_v2 SET delivery_released_at = NULL, delivery_release = NULL WHERE id = r; lolos := lolos + 1;
  -- yang HARUS DITOLAK: setengah terisi (rekam audit tidak boleh setengah)
  BEGIN UPDATE production_runs_v2 SET delivery_released_at = now() WHERE id = r; RAISE EXCEPTION 'TIDAK_DITOLAK_waktu_tanpa_rekam';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE production_runs_v2 SET delivery_release = '{"kind":"ADMIN_OVERRIDE"}'::jsonb WHERE id = r; RAISE EXCEPTION 'TIDAK_DITOLAK_rekam_tanpa_waktu';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'DATA_CONTOH_KURANG' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data contoh di hasil restore kurang (butuh >=1 run)"; }
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku CHECK SALAH (ada data setengah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" = "2" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti ${UJI_TOLAK:-?} (harus 2)"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" = "2" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos ${UJI_LOLOS:-?} (harus 2)"; }
ok "perilaku CHECK terbukti di DB rehearsal: tolak=${UJI_TOLAK} lolos=${UJI_LOLOS} — keduanya terisi/kosong bersamaan lolos; waktu tanpa rekam dan rekam tanpa waktu ditolak; seluruh uji dibatalkan"
# Kode BARU dijalankan terhadap data RESTORE yang SUDAH dimigrasi (baca-saja): pratinjau override untuk unit Rika + deteksi konflik V1 + penanda Route Planner. Tidak ada tulisan: sidik jari diperiksa sesudahnya.
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" -e RIKA_UNIT="$RIKA_UNIT" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-kode-baru.log" 2>&1 || { cat "$BK_DIR/rehearsal-kode-baru.log"; reh_drop; die "pemeriksaan kode baru terhadap data restore GAGAL"; }
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { previewDeliveryRelease, releaseBlockersOf } = await import("/app/src/services/productionStepCommandService.js");
const { tandaiJobOverrideAdmin, bacaOverrideAdmin } = await import("/app/src/services/deliveryOverrideAdmin.js");
const { detectRunInconsistency } = await import("/app/src/services/productionRunGuards.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const unit = await prisma.unit.findUnique({ where: { unitCode: process.env.RIKA_UNIT } });
cek("unit Rika ada pada data restore", !!unit);
if (unit) {
  const pv = await previewDeliveryRelease(prisma, { unitId: unit.id });
  cek("pratinjau override (kode baru, baca-saja) berjalan; berisi keputusan Admin dan TANPA daftar pemeriksa", /Admin menetapkan unit siap/.test(pv.decision) && pv.inspectors === undefined, "eligible=" + pv.eligible + " blockers=" + (pv.blockers ?? []).map((b) => b.code).join(","));
  cek("pratinjau memuat lokasi pengambilan sah (area barang jadi/dispatch)", Array.isArray(pv.locations) && pv.locations.every((l) => ["FINISHED_GOODS_AREA", "DISPATCH_AREA"].includes(l.locationType)), "n=" + pv.locations.length);
  cek("tidak ada Run yang sudah ber-override pada data restore", (await prisma.productionRun.count({ where: { deliveryReleasedAt: { not: null } } })) === 0);
}
const peta = await bacaOverrideAdmin(prisma, unit ? [unit.id] : []);
cek("penanda override Route Planner/Driver kosong pada data restore (tanpa backfill)", peta.size === 0);
const jobs = await prisma.job.findMany({ where: { type: "DELIVERY" }, select: { id: true }, take: 50 });
await tandaiJobOverrideAdmin(prisma, jobs);
cek("tidak ada job pengiriman yang tiba-tiba berlabel override", jobs.every((j) => Array.isArray(j.overrideAdmin) && j.overrideAdmin.length === 0 && j.labelOverrideAdmin === null), "diperiksa " + jobs.length);
const runs = await prisma.productionRun.findMany({ where: { status: { in: ["ACTIVE", "BLOCKED", "PENDING_ARRIVAL"] } }, include: { unit: { select: { status: true } } }, take: 500 });
cek("deteksi konflik V1 pada run aktif tidak berubah untuk data lama (tanpa override)", runs.every((r) => (detectRunInconsistency({ run: r, unit: r.unit }) === null) === (!["CANCELLED", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"].includes(r.unit.status))), "diperiksa " + runs.length);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
REHNODE
ok "kode baru terhadap data restore yang sudah dimigrasi: $(tail -n 1 "$BK_DIR/rehearsal-kode-baru.log"); $(grep -c '^PASS' "$BK_DIR/rehearsal-kode-baru.log") pemeriksaan lulus"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from production_runs_v2 where delivery_released_at is not null or delivery_release is not null")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
[ "$(RPSQL "$RIKA_SQL")" = "$RIKA_SEBELUM" ] || { reh_drop; die "keadaan Rika pada DB rehearsal BERUBAH oleh migrasi/uji"; }
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
# SETELAH migrasi, SEBELUM switch: hanya backend LAMA yang melayani dan ia tidak mengenal override → tidak boleh ada Run ber-override (tanpa backfill); Rika dan dokumen beku tidak berubah.
[ "$(psql_live -At -c "select count(*) from production_runs_v2 where delivery_released_at is not null or delivery_release is not null")" = "0" ] || die "ada Run ber-override sebelum switch (backend lama tidak mengenalnya; tanpa backfill)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari dokumen beku pasca-migrasi gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
[ "$(psql_live -At -c "$RIKA_SQL")" = "$RIKA_SEBELUM" ] || { echo "  sebelum: ${RIKA_SEBELUM}"; echo "  kini   : $(psql_live -At -c "$RIKA_SQL")"; die "keadaan Rika berubah sebelum switch (petugas mengerjakannya selama persiapan?) — periksa lalu ulangi rilis"; }
ok "pasca-migrasi sebelum switch: tidak ada Run ber-override (tanpa backfill), dokumen pembanding beku identik, keadaan Rika tidak berubah"

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
[ "$(PSQLN "select count(*) from information_schema.columns where table_schema='public' and table_name='production_runs_v2' and column_name in ('delivery_released_at','delivery_release')")" = "2" ] || die "kolom override tidak ada di produksi"
[ "$(PSQLN "select count(*) from pg_constraint where conname = 'production_runs_v2_delivery_release_pair_chk'")" = "1" ] || die "CHECK override tidak terpasang di produksi"
[ "$(PSQLN "select count(*) from production_runs_v2 where delivery_released_at is not null or delivery_release is not null")" = "0" ] || die "ada Run ber-override tepat setelah switch (tidak ada yang boleh membuatnya)"
ok "objek rilis terpasang di produksi: 2 kolom override (semua Run NULL) + CHECK pasangan"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin + penolakan Admin override sebelum menyentuh data, pratinjau override Rika, penanda Route Planner/Driver, gerbang penempatan/dispatch, invarian"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e UNIT_N="$UNIT_N" -e JOB_N="$JOB_N" -e ROUTE_N="$ROUTE_N" -e RIKA_UNIT="$RIKA_UNIT" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
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
const tulis = [];
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  if (method !== "GET") tulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status });
  return { status: r.status, json };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const adm = cari((r) => r.includes("ADMIN")) ?? cari((r) => r.includes("OWNER"));
const tanpaStage = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.UNIT_STAGE_WRITE) && !punya(r, P.ROUTE_WRITE));
if (!adm) { rec("akun ADMIN/OWNER aktif tersedia", false); process.exit(1); }
const tA = tokenUntuk(adm);
const nol = "00000000-0000-4000-8000-000000000000";
const hitungSql = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const B = (k) => Number(process.env[k]);
const PV2 = "/api/production-v2/runs/" + nol + "/confirm-finished-goods";

// ── Konfirmasi Barang Jadi: penolakan SEBELUM menyentuh data (run nol: tidak ada baris yang bisa berubah) ──
const k1 = (await api("POST", PV2, null, { expectedRevision: 1 }, { "Idempotency-Key": "smoke-kbj-anon-1" })).status;
rec("confirm-finished-goods: tanpa token → 401", k1 === 401, String(k1));
if (tanpaStage) {
  const k2 = (await api("POST", PV2, tokenUntuk(tanpaStage), { expectedRevision: 1, unitCode: "X", locationId: nol, reason: "uji smoke tanpa izin", physicalVerified: true }, { "Idempotency-Key": "smoke-kbj-noperm-1" })).status;
  rec("confirm-finished-goods: akun tanpa izin tahap produksi/rute → 403", k2 === 403, String(k2));
} else skip("confirm-finished-goods 403", "tidak ada akun aktif tanpa izin tahap produksi");
const k3 = await api("POST", PV2, tA, { expectedRevision: 1, unitCode: "X", locationId: nol, reason: "uji smoke verifikasi", physicalVerified: false }, { "Idempotency-Key": "smoke-kbj-verif-1" });
rec("confirm-finished-goods: verifikasi fisik tidak dicentang → 400 CONFIRM_FG_VERIFY_REQUIRED (tanpa menyentuh data)", k3.status === 400 && k3.json?.code === "CONFIRM_FG_VERIFY_REQUIRED", `${k3.status} ${k3.json?.code}`);
const k4 = await api("POST", PV2, tA, { expectedRevision: 1, unitCode: "X", locationId: nol, reason: "pendek", physicalVerified: true }, { "Idempotency-Key": "smoke-kbj-alasan-1" });
rec("confirm-finished-goods: alasan < 10 karakter → 400 CONFIRM_FG_REASON_REQUIRED (tanpa menyentuh data)", k4.status === 400 && k4.json?.code === "CONFIRM_FG_REASON_REQUIRED", `${k4.status} ${k4.json?.code}`);
const k5 = (await api("POST", PV2, tA, { expectedRevision: 1, physicalVerified: true, reason: "uji smoke tanpa kunci" })).status;
rec("confirm-finished-goods: tanpa Idempotency-Key → 400/428 (tidak menulis)", k5 === 400 || k5 === 428, String(k5));
const p1 = (await api("POST", "/api/armada/routes/" + nol + "/publish", null, {})).status;
const p2 = (await api("POST", "/api/armada/routes/" + nol + "/publish", tA, {})).status;
rec("publish rute: tanpa token 401; admin pada rute tak dikenal 404 (pagar tidak mengubah jalur lama)", p1 === 401 && p2 === 404, p1 + "," + p2);
const OV = "/api/production-v2/units/" + nol + "/delivery-release";
const o1 = (await api("POST", OV, null, { expectedRevision: 1 }, { "Idempotency-Key": "smoke-ao-anon-0001" })).status;
rec("Admin override POST: tanpa token → 401", o1 === 401, String(o1));
const bukanAdmin = cari((r) => r.includes("PRODUCTION_LEAD") && !r.includes("ADMIN") && !r.includes("OWNER"));
if (bukanAdmin) {
  const o2 = await api("POST", OV, tokenUntuk(bukanAdmin), { expectedRevision: 1, unitCode: "X", locationId: nol, reason: "uji smoke bukan admin", adminOverrideConfirmed: true }, { "Idempotency-Key": "smoke-ao-lead-0001" });
  rec("Admin override POST: Production Lead (bukan Admin/Owner) → 403 RELEASE_FORBIDDEN", o2.status === 403 && o2.json?.code === "RELEASE_FORBIDDEN", o2.status + " " + o2.json?.code);
  const o2g = (await api("GET", OV, tokenUntuk(bukanAdmin))).status;
  rec("Admin override GET pratinjau: Production Lead → 403", o2g === 403, String(o2g));
} else skip("Admin override 403 untuk non-Admin", "tidak ada akun aktif Production Lead murni");
const o3 = await api("POST", OV, tA, { expectedRevision: 1, unitCode: "X", locationId: nol, reason: "uji smoke konfirmasi", adminOverrideConfirmed: false }, { "Idempotency-Key": "smoke-ao-konf-0001" });
rec("Admin override POST: konfirmasi override tidak dicentang → 400 RELEASE_OVERRIDE_CONFIRM_REQUIRED (tanpa menyentuh data)", o3.status === 400 && o3.json?.code === "RELEASE_OVERRIDE_CONFIRM_REQUIRED", o3.status + " " + o3.json?.code);
const o3b = await api("POST", OV, tA, { expectedRevision: 1, unitCode: "X", locationId: nol, reason: "uji smoke klaim lama", physicalVerified: true }, { "Idempotency-Key": "smoke-ao-lama-0001" });
rec("Admin override POST: klaim lama physicalVerified TIDAK menggantikan konfirmasi override → 400", o3b.status === 400 && o3b.json?.code === "RELEASE_OVERRIDE_CONFIRM_REQUIRED", o3b.status + " " + o3b.json?.code);
const o4 = await api("POST", OV, tA, { expectedRevision: 1, unitCode: "X", locationId: nol, reason: "pendek", adminOverrideConfirmed: true }, { "Idempotency-Key": "smoke-ao-alasan-0001" });
rec("Admin override POST: alasan < 10 karakter → 400 RELEASE_REASON_REQUIRED", o4.status === 400 && o4.json?.code === "RELEASE_REASON_REQUIRED", o4.status + " " + o4.json?.code);
const o5 = (await api("POST", OV, tA, { expectedRevision: 1, adminOverrideConfirmed: true, reason: "uji smoke tanpa kunci" })).status;
rec("Admin override POST: tanpa Idempotency-Key → 400/428 (tidak menulis)", o5 === 400 || o5 === 428, String(o5));
const o6 = await api("POST", OV, tA, { expectedRevision: 1, unitCode: "X", locationId: nol, reason: "uji smoke unit tak ada", adminOverrideConfirmed: true }, { "Idempotency-Key": "smoke-ao-nol-0001" });
rec("Admin override POST: unit tak dikenal → 409 RELEASE_NO_ACTIVE_RUN (tanpa menyentuh data)", o6.status === 409 && o6.json?.code === "RELEASE_NO_ACTIVE_RUN", o6.status + " " + o6.json?.code);
// ── Saklar Admin override (BACA-SAJA): bawaan NONAKTIF (fail-closed); hanya Admin/Owner membaca; laporan kosong ──
const SWITCH = "/api/production-v2/admin-override/switch";
const swAnon = (await api("GET", SWITCH, null)).status;
rec("saklar override GET: tanpa token → 401", swAnon === 401, String(swAnon));
if (bukanAdmin) {
  const swLead = (await api("GET", SWITCH, tokenUntuk(bukanAdmin))).status;
  const swPut = await api("PUT", SWITCH, tokenUntuk(bukanAdmin), { enabled: true, reason: "uji smoke bukan admin tanpa efek" });
  rec("saklar override: Production Lead GET/PUT → 403 (tidak mengubah saklar)", swLead === 403 && swPut.status === 403, swLead + "," + swPut.status);
} else skip("saklar override 403 untuk non-Admin", "tidak ada akun aktif Production Lead murni");
const swAdm = await api("GET", SWITCH, tA);
rec("saklar override NONAKTIF bawaan di produksi (fail-closed; belum diaktifkan siapa pun)", swAdm.status === 200 && swAdm.json?.enabled === false, swAdm.status + " enabled=" + swAdm.json?.enabled + " configured=" + swAdm.json?.configured);
const rapAdm = await api("GET", "/api/production-v2/admin-override/report", tA);
rec("laporan override: 200 dan kosong (belum ada override)", rapAdm.status === 200 && rapAdm.json?.ringkas?.total === 0, rapAdm.status + " total=" + rapAdm.json?.ringkas?.total);
const kunciAktif = await hitungSql("select count(*)::int n from v2_feature_flags where key = 'production_admin_override_siap_kirim' and enabled = true");
rec("tidak ada baris saklar override yang aktif di produksi", kunciAktif === 0, String(kunciAktif));
const SAH = new Set([400, 401, 403, 404, 409, 428]);
rec("semua " + tulis.length + " pemanggilan tulis ditolak/galat sebelum menyentuh data: smoke TIDAK menulis data produksi", tulis.length >= 13 && tulis.every((b) => SAH.has(b.status)), tulis.map((b) => b.n + "=" + b.status).join("; "));

// ── Papan Delivery: kandidat draf (opt-in) — baca-saja ──
const papanAnon = (await api("GET", "/api/armada/board?type=DELIVERY&termasukMenunggu=1", null)).status;
rec("papan: tanpa token → 401", papanAnon === 401, String(papanAnon));
const rika = await prisma.unit.findUnique({ where: { unitCode: process.env.RIKA_UNIT }, include: { order: { select: { orderNumber: true, status: true } } } });
const lama = await api("GET", "/api/armada/board?type=DELIVERY", tA);
const baru = await api("GET", "/api/armada/board?type=DELIVERY&termasukMenunggu=1", tA);
rec("papan tanpa opt-in: respons lama utuh (200, `available` ada, TIDAK ada kandidat draf)", lama.status === 200 && Array.isArray(lama.json?.available) && !(lama.json?.availableMenunggu?.length > 0), `${lama.status}`);
rec("papan dengan opt-in: 200 dan `availableMenunggu` berupa daftar", baru.status === 200 && Array.isArray(baru.json?.availableMenunggu), `${baru.status} n=${baru.json?.availableMenunggu?.length}`);
if (rika) {
  const diLama = (lama.json?.available ?? []).some((u) => u.unitCode === rika.unitCode);
  const diBaru = (baru.json?.availableMenunggu ?? []).some((u) => u.unitCode === rika.unitCode);
  rec("Rika TIDAK muncul di kandidat siap-kirim biasa (belum siap)", rika.status === "READY_FOR_DELIVERY" ? true : diLama === false, rika.status);
  if (["RECEIVED", "IN_PRODUCTION"].includes(rika.status)) {
    if (["PROCESSING", "READY"].includes(rika.order?.status)) rec("Rika muncul sebagai kandidat DRAF 'Menunggu konfirmasi siap kirim' (belum dijadwalkan; tidak ada yang dibuat)", diBaru === true, "unit=" + rika.status + " order=" + rika.order?.status);
    else skip("Rika kandidat draf", "status order " + rika.order?.status + " bukan PROCESSING/READY — order harus dibereskan lebih dulu");
  } else info("status Rika " + rika.status + ": pemeriksaan kandidat draf dilewati");
} else skip("Rika", "unit tidak ditemukan");

// ── Lokasi barang jadi untuk run Rika (baca-saja) ──
const runRika = rika ? await prisma.productionRun.findFirst({ where: { unitId: rika.id }, orderBy: { createdAt: "desc" }, select: { id: true } }) : null;
if (runRika) {
  const lok = await api("GET", "/api/production-v2/runs/" + runRika.id + "/confirm-finished-goods/locations", tA);
  rec("lokasi barang jadi untuk run Rika: 200 (baca-saja)", lok.status === 200 && Array.isArray(lok.json?.locations), `${lok.status}`);
  const n = lok.json?.locations?.length ?? 0;
  if (n === 0) info("PERHATIAN OPERASIONAL: belum ada lokasi barang jadi aktif (FINISHED_GOODS_AREA/DISPATCH_AREA) — Gudang harus membuatnya sebelum Konfirmasi Barang Jadi bisa dipakai");
  else info("lokasi barang jadi aktif tersedia: " + lok.json.locations.map((l) => l.code).join(", "));
  const pvLok = await api("GET", "/api/production-v2/runs/" + runRika.id + "/confirm-finished-goods/locations", null);
  rec("lokasi barang jadi: tanpa token → 401", pvLok.status === 401, String(pvLok.status));
} else skip("lokasi barang jadi", "run Rika tidak ditemukan");


// ── Pratinjau Admin override untuk Rika (BACA-SAJA) + penanda Route Planner/Driver ──
if (rika) {
  const pvR = await api("GET", "/api/production-v2/units/" + rika.id + "/delivery-release", tA);
  rec("pratinjau override Rika: 200, keputusan Admin, lokasi pengambilan sah, TANPA daftar pemeriksa", pvR.status === 200 && /Admin menetapkan unit siap/.test(pvR.json?.decision || "") && Array.isArray(pvR.json?.locations) && pvR.json?.inspectors === undefined, pvR.status + " eligible=" + pvR.json?.eligible + " blockers=" + (pvR.json?.blockers ?? []).map((b) => b.code).join(","));
  info("lokasi pengambilan sah untuk override: " + (pvR.json?.locations ?? []).map((l) => l.code).join(", "));
  info("penghalang override Rika (bila ada): " + JSON.stringify((pvR.json?.blockers ?? []).map((b) => b.text)));
}
const adaOverride = await hitungSql("select count(*)::int n from production_runs_v2 where delivery_released_at is not null");
rec("belum ada Run ber-override di produksi (smoke/rilis tidak membuatnya)", adaOverride === 0, String(adaOverride));
const { tandaiJobOverrideAdmin } = await import("/app/src/services/deliveryOverrideAdmin.js");
const jobAktif = await prisma.job.findMany({ where: { type: "DELIVERY", status: { notIn: ["COMPLETED", "FAILED"] } }, select: { id: true }, take: 100 });
await tandaiJobOverrideAdmin(prisma, jobAktif);
rec("penanda override Route Planner/Driver: nol job berlabel override (tanpa backfill)", jobAktif.every((j) => j.overrideAdmin.length === 0 && j.labelOverrideAdmin === null), "diperiksa " + jobAktif.length);

// ── Gerbang penempatan draf & dispatch, dipanggil langsung (baca-saja; tidak menulis) ──
const { validasiPenempatanDraf, pastikanJobSiapDispatch } = await import("/app/src/services/deliveryMenungguKonfirmasi.js");
const coba = async (status) => { const u = await prisma.unit.findFirst({ where: { status }, include: { order: { select: { orderNumber: true, status: true } } } }); if (!u) return null; try { await validasiPenempatanDraf(prisma, [u]); return "tidak-ditolak"; } catch (e) { return e.code; } };
const siap = await coba("READY_FOR_DELIVERY"); const batal = await coba("CANCELLED");
if (siap === null) skip("penempatan draf unit yang sudah siap ditolak", "tidak ada unit READY_FOR_DELIVERY"); else rec("penempatan draf unit yang SUDAH siap kirim ditolak (UNIT_SUDAH_SIAP atau JOB_GANDA bila sudah dijadwalkan)", ["UNIT_SUDAH_SIAP", "JOB_GANDA"].includes(siap), siap);
if (batal === null) skip("penempatan draf unit batal ditolak", "tidak ada unit CANCELLED"); else rec("penempatan draf unit BATAL ditolak (UNIT_BATAL)", batal === "UNIT_BATAL" || batal === "JOB_GANDA", batal);
const jobSiap = await prisma.job.findMany({ where: { type: "DELIVERY", status: { notIn: ["COMPLETED", "FAILED"] } }, select: { id: true }, take: 50 });
let tertahan = 0; let lolos = 0;
for (const j of jobSiap) { try { await pastikanJobSiapDispatch(prisma, [j.id], { aksi: "diterbitkan" }); lolos += 1; } catch (e) { if (e.code === "MENUNGGU_KONFIRMASI_SIAP_KIRIM") tertahan += 1; else throw e; } }
info("job pengiriman aktif diperiksa " + jobSiap.length + ": lolos gerbang=" + lolos + ", tertahan 'menunggu konfirmasi'=" + tertahan);
rec("job pengiriman aktif yang ada (dibuat sebelum fitur ini) TIDAK tertahan oleh gerbang baru (unit mereka sudah siap/berangkat)", tertahan === 0, "tertahan=" + tertahan);

// ── Invarian ──
rec("jumlah unit/job/rute tidak berkurang (sebelum: " + B("UNIT_N") + "/" + B("JOB_N") + "/" + B("ROUTE_N") + ")", (await hitungSql("select count(*)::int n from units")) >= B("UNIT_N") && (await hitungSql("select count(*)::int n from jobs")) >= B("JOB_N") && (await hitungSql("select count(*)::int n from routes")) >= B("ROUTE_N"));
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitungSql("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
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
  ok "smoke test lulus (izin, penolakan Admin override sebelum menyentuh data, pratinjau override Rika, kandidat draf, lokasi barang jadi, penanda Route Planner/Driver, gerbang, invarian)"
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
ok "dokumen pembanding beku (pergerakan stok, event aktivitas, bukti tahap, inspeksi QC, custody, run/job/rute, jurnal, flag) IDENTIK sebelum vs sesudah rilis; transaksi sah yang muncul saat rilis tidak diperbandingkan"
RIKA_SESUDAH="$(dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$RIKA_SQL" </dev/null)"
if [ "$RIKA_SESUDAH" = "$RIKA_SEBELUM" ]; then
  ok "Rika tetap: ${RIKA_SESUDAH}; status unit TIDAK berubah, tidak ada job/QC/stok/custody/event baru pada unit ini"
else
  echo "  sebelum: ${RIKA_SEBELUM}"; echo "  sesudah: ${RIKA_SESUDAH}"
  [ "${RIKA_SESUDAH%%|*}" = "${RIKA_SEBELUM%%|*}" ] || die "STATUS unit Rika berubah selama rilis (${RIKA_SEBELUM%%|*} -> ${RIKA_SESUDAH%%|*}) — rilis ini tidak menulis data; periksa apakah petugas yang melakukannya (log aktivitas)"
  warn "isi riwayat Rika berbeda tetapi status unit sama (kemungkinan petugas mengerjakan run selama rilis); rilis ini sendiri tidak menulis data (sidik jari beku identik)"
fi
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
say "CATATAN: Admin override BELUM dijalankan untuk unit mana pun; status Rika sebelum/sesudah: ${RIKA_SEBELUM} -> ${RIKA_SESUDAH}. Override hanya atas keputusan Admin/Owner setelah lokasi pengambilan dan dampak status di seluruh workspace diverifikasi. OTA app Driver (JobCard override) TIDAK diterbitkan rilis ini."
