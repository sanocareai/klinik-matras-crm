#!/usr/bin/env bash
# RILIS "PEMISAHAN PIC MEJA BONGKAR vs CORNER & FINISHING + TOMBOL KEMBALI APLIKASI MEJA/CORNER": web + backend + 1 migrasi ADITIF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   PIC Meja dan PIC Corner = dua penugasan terpisah; operator hanya boleh jadi PIC suatu lini bila Admin mencentangnya di Pengaturan Operator (production_operators.work_lanes, BERMULA KOSONG);
#   PIC Corner kosong TIDAK lagi memakai PIC Meja; dropdown PIC Rencana/Unit 360/Corner disaring per lini; ADMIN/OWNER tetap tidak ditawarkan; PIC Bahan tidak berubah.
#   Tombol "Kembali ke SANSS" di header layar tab Aplikasi Meja/Corner/QC/Dokumentasi (Admin/Owner/Kepala Produksi).
#   Migrasi: 20261106090000_production_operator_work_lanes — 1 kolom TEXT[] NOT NULL DEFAULT '{}' (metadata-only, tanpa rewrite) + 1 CHECK (TABLE/CORNER). TANPA backfill/UPDATE/DELETE/INSERT/nama.
# Produksi: verifikasi hanya baca + penolakan izin/validasi sebelum menyentuh data; TIDAK ada operator/lini/PIC/jadwal/order dibuat atau diubah; TIDAK ada flag/cohort/setting/akun/role diubah.
# Penetapan lini operator SESUDAH rilis = tindakan eksplisit Admin lewat UI (bukan bagian rilis ini).
#
#   cat scripts/release-pic-lini-tombol-kembali.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/plc1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/plc1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/plc1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/plc1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode boleh di-rollback kapan pun (migrasi aditif; kode lama mengabaikan work_lanes). Periksa dulu dengan scripts/rollback-guard-pic-lini-tombol-kembali.sh (baca-saja; informatif).
# Catatan perilaku rollback: PIC Corner kosong kembali memakai PIC Meja dan dropdown tidak lagi disaring per lini.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-rilis/pic-lini-tombol-kembali}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261106090000_production_operator_work_lanes:26d0be61181ec3f299306ff536dcbea2cb13037b35b46465cc597dae6e7d8b7d"
# Hasil pemindai untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":2,"add_column":1,"check":1}'
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261106090000_production_operator_work_lanes/migration\.sql|backend/prisma/schema\.prisma|backend/src/lib/domain/productionLanes\.js|backend/src/routes/production\.js|backend/src/services/productionCornerService\.js|backend/src/services/productionExperienceReadService\.js|backend/src/services/productionPlanningCommandService\.js|backend/src/services/productionRencanaService\.js|backend/src/services/productionRouting\.js|backend/src/services/productionWorkshopExecutionCommandService\.js|backend/tests/integration/penjualanKaryawanOrderCrmFinal\.integration\.test\.js|backend/tests/integration/picDropdownTanpaAdmin\.integration\.test\.js|backend/tests/integration/picLiniMejaCorner\.integration\.test\.js|backend/tests/integration/productionAdaptationSlice2\.integration\.test\.js|backend/tests/integration/productionBuildTrack\.integration\.test\.js|backend/tests/integration/productionCommandCenter\.integration\.test\.js|backend/tests/integration/productionDiagnosis\.integration\.test\.js|backend/tests/integration/productionDocumentation\.integration\.test\.js|backend/tests/integration/productionExperience\.integration\.test\.js|backend/tests/integration/productionMaterialIssue\.integration\.test\.js|backend/tests/integration/productionOneLocationIntake\.integration\.test\.js|backend/tests/integration/productionPlanStationPicTarget\.integration\.test\.js|backend/tests/integration/productionPlanning\.integration\.test\.js|backend/tests/integration/productionPreTeardown\.integration\.test\.js|backend/tests/integration/productionQcFinishedGoods\.integration\.test\.js|backend/tests/integration/productionReturnQueueReorder\.integration\.test\.js|backend/tests/integration/productionUnitOverview\.integration\.test\.js|backend/tests/integration/productionWorkshopExecution\.integration\.test\.js|backend/tests/integration/rencanaAktivasiSaatJadwalkan\.integration\.test\.js|backend/tests/integration/rencanaCorner\.integration\.test\.js|backend/tests/integration/rencanaExportExcel\.integration\.test\.js|backend/tests/integration/rencanaOrderNyata\.integration\.test\.js|backend/tests/integration/rencanaPostPlansAudit\.integration\.test\.js|backend/tests/integration/setup/fixtures\.js|backend/tests/integration/setup/p11Fixture\.js|backend/tests/integration/v1StageActorGuard\.integration\.test\.js|backend/tests/integration/v1WorkerQueue\.integration\.test\.js|backend/tests/picDropdownFilter\.test\.js|backend/tests/productionLanes\.test\.js|frontend/src/api\.js|frontend/src/features/production/RencanaCornerView\.jsx|frontend/src/features/production/ScheduleModals\.jsx|frontend/src/features/production/UnitV1Stage\.jsx|frontend/src/features/production/picLanes\.js|frontend/src/features/production/workerApp/Tabs\.jsx|frontend/src/features/production/workerApp/WorkerAppShell\.jsx|frontend/src/pages/bengkel/ProductionOperators\.jsx|frontend/src/pages/bengkel/ProductionPlannerV2\.jsx|frontend/src/pages/bengkel/ProductionRencanaWorkspace\.jsx|frontend/src/pages/produksi/ProductionDocumentation\.jsx|frontend/src/pages/produksi/ProductionQcApp\.jsx|frontend/src/pages/produksi/WorkerLane\.jsx|frontend/tests/picDropdownPilihan\.test\.js|frontend/tests/workerAppExit\.test\.js|scripts/rollback-guard-pic-lini-tombol-kembali\.sh)$'
BACKEND_SRC_EXPECT="backend/src/lib/domain/productionLanes.js backend/src/routes/production.js backend/src/services/productionCornerService.js backend/src/services/productionExperienceReadService.js backend/src/services/productionPlanningCommandService.js backend/src/services/productionRencanaService.js backend/src/services/productionRouting.js backend/src/services/productionWorkshopExecutionCommandService.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/production/RencanaCornerView.jsx frontend/src/features/production/ScheduleModals.jsx frontend/src/features/production/UnitV1Stage.jsx frontend/src/features/production/picLanes.js frontend/src/features/production/workerApp/Tabs.jsx frontend/src/features/production/workerApp/WorkerAppShell.jsx frontend/src/pages/bengkel/ProductionOperators.jsx frontend/src/pages/bengkel/ProductionPlannerV2.jsx frontend/src/pages/bengkel/ProductionRencanaWorkspace.jsx frontend/src/pages/produksi/ProductionDocumentation.jsx frontend/src/pages/produksi/ProductionQcApp.jsx frontend/src/pages/produksi/WorkerLane.jsx"
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
BK_DIR="$HOME/release-backups/plc-${DEPLOY_SHORT}-${TS}"
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
Guard rollback (baca-saja, informatif) setelah switch:
   bash ${NEW_DIR}/scripts/rollback-guard-pic-lini-tombol-kembali.sh
Data baru rilis ini hanya kolom production_operators.work_lanes: kode lama tidak membacanya dan tidak menulisnya, jadi rollback KODE aman.
Perilaku setelah rollback: PIC Corner kosong kembali memakai PIC Meja; dropdown PIC tidak lagi disaring per lini; centang lini Admin tetap tersimpan.
Rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi hanya MENAMBAH 1 kolom (DEFAULT '{}') + 1 CHECK: dibiarkan terpasang pun aman bagi kode lama. (Tidak dihapus oleh rollback kode.)
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
exec 9>/tmp/release-pic-lini-tombol-kembali.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "plc1\|release-pic-lini-tombol-kembali\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
// Pemindai migrasi rilis "PIC lini Meja/Corner" (1 migrasi aditif). Dijalankan di VPS oleh skrip rilis. FAIL-CLOSED, daftar putih per pernyataan (KECOCOKAN PERSIS setelah spasi dirapatkan):
//  (a) ALTER TABLE "production_operators" ADD COLUMN "work_lanes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]   (DEFAULT konstan = metadata-only, tanpa rewrite/backfill)
//  (b) ALTER TABLE "production_operators" ADD CONSTRAINT "production_operators_work_lanes_valid" CHECK ("work_lanes" <@ ARRAY['TABLE','CORNER']::TEXT[])
// Tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/RENAME/ALTER COLUMN/CREATE apa pun, tidak ada perubahan lain pada tabel lama, tidak ada pernyataan ganda.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };
const OK = new Map([
  ['ALTER TABLE "production_operators" ADD COLUMN "work_lanes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]', "add_column"],
  [`ALTER TABLE "production_operators" ADD CONSTRAINT "production_operators_work_lanes_valid" CHECK ("work_lanes" <@ ARRAY['TABLE','CORNER']::TEXT[])`, "check"],
]);
const hitung = {};
const dilihat = new Set();
const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
for (const st of stmts) {
  const r = rapat(st);
  const jenis = OK.get(r);
  if (!jenis) gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
  if (dilihat.has(r)) gagal(`pernyataan duplikat: ${r.slice(0, 120)}`);
  dilihat.add(r);
  hitung[jenis] = (hitung[jenis] ?? 0) + 1;
}
if (dilihat.size !== OK.size) gagal(`pernyataan harus tepat ${OK.size} (ditemukan ${dilihat.size})`);
console.log(JSON.stringify({ total: stmts.length, add_column: 0, check: 0, ...hitung }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (1 kolom TEXT[] NOT NULL DEFAULT '{}' + 1 CHECK TABLE/CORNER); tanpa DROP/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT/backfill/berbasis nama"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE operator" "$(tambah_stmt 'DROP TABLE "production_operators";')"
harus_ditolak "UPDATE operator (backfill lini)" "$(tambah_stmt "UPDATE \"production_operators\" SET \"work_lanes\" = ARRAY['TABLE']::TEXT[];")"
harus_ditolak "UPDATE operator berbasis nama (set lini siapa pun)" "$(tambah_stmt "UPDATE \"production_operators\" SET \"work_lanes\" = ARRAY['CORNER']::TEXT[] WHERE \"user_id\" IN (SELECT \"id\" FROM \"User\" WHERE \"name\" ILIKE '%farel%');")"
harus_ditolak "UPDATE operator (nonaktifkan)" "$(tambah_stmt 'UPDATE "production_operators" SET "active" = false;')"
harus_ditolak "DELETE operator" "$(tambah_stmt 'DELETE FROM "production_operators";')"
harus_ditolak "INSERT operator" "$(tambah_stmt "INSERT INTO \"production_operators\" (\"id\", \"user_id\") VALUES (gen_random_uuid(), 'x');")"
harus_ditolak "UPDATE rencana produksi (PIC)" "$(tambah_stmt 'UPDATE "production_run_plans_v2" SET "corner_operator_id" = "operator_id";')"
harus_ditolak "UPDATE flag cohort" "$(tambah_stmt "UPDATE \"v2_feature_flags\" SET \"enabled\" = true;")"
harus_ditolak "UPDATE peran akun" "$(tambah_stmt "UPDATE \"User\" SET \"role\" = 'ADMIN';")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "production_operators";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "production_operators" DROP COLUMN "active";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "production_operators" ALTER COLUMN "employee_code" TYPE INTEGER;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "production_operators" RENAME COLUMN "active" TO "aktif";')"
harus_ditolak "kolom baru kedua pada production_operators" "$(tambah_stmt 'ALTER TABLE "production_operators" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom baru pada tabel lama lain" "$(tambah_stmt 'ALTER TABLE "production_run_plans_v2" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom baru pada User" "$(tambah_stmt 'ALTER TABLE "User" ADD COLUMN "x" TEXT;')"
harus_ditolak "DEFAULT berisi lini (menetapkan lini ke semua operator baru)" "$(printf '%s\n' "$ALL_SQL" | sed "s/DEFAULT ARRAY\[\]::TEXT\[\]/DEFAULT ARRAY['TABLE']::TEXT[]/")"
harus_ditolak "NOT NULL dibuang" "$(printf '%s\n' "$ALL_SQL" | sed 's/ NOT NULL//')"
harus_ditolak "tipe kolom diganti" "$(printf '%s\n' "$ALL_SQL" | sed 's/"work_lanes" TEXT\[\]/"work_lanes" TEXT/')"
harus_ditolak "CHECK diperlebar (nilai QC ikut sah)" "$(printf '%s\n' "$ALL_SQL" | sed "s/'CORNER'\]/'CORNER','QC']/")"
harus_ditolak "CHECK memuat subquery" "$(printf '%s\n' "$ALL_SQL" | sed 's/CHECK ("work_lanes" <@ ARRAY\[.TABLE.,.CORNER.\]::TEXT\[\])/CHECK ((SELECT count(*) FROM "production_operators") >= 0)/')"
harus_ditolak "CHECK diganti nama" "$(printf '%s\n' "$ALL_SQL" | sed 's/production_operators_work_lanes_valid/production_operators_evil_chk/')"
harus_ditolak "CHECK hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'work_lanes_valid')"
harus_ditolak "kolom hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'ADD COLUMN')"
harus_ditolak "CHECK tambahan liar" "$(tambah_stmt 'ALTER TABLE "production_operators" ADD CONSTRAINT "evil_chk" CHECK (true);')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "production_operators" DROP CONSTRAINT "production_operators_pkey";')"
harus_ditolak "pernyataan ganda" "$(tambah_stmt "$(printf '%s\n' "$ALL_SQL" | sql_bersih)")"
harus_ditolak "tabel baru" "$(tambah_stmt 'CREATE TABLE "production_lane_extra" ("id" UUID NOT NULL, CONSTRAINT "production_lane_extra_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "indeks" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "production_operators"("user_id");')"
harus_ditolak "FK baru" "$(tambah_stmt 'ALTER TABLE "production_operators" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "production_operators" TO PUBLIC;')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "trigger liar" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE UPDATE ON "production_operators" FOR EACH ROW EXECUTE FUNCTION "evil"();')"
harus_ditolak "DISABLE TRIGGER" "$(tambah_stmt 'ALTER TABLE "production_operators" DISABLE TRIGGER ALL;')"
[ "$NEG" -ge 25 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 25)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER COLUMN/RENAME/UPDATE berbasis nama/DEFAULT berisi lini/NOT NULL dibuang/CHECK diperlebar atau bersubquery/kolom-tabel-indeks-FK-fungsi-trigger liar/GRANT/ganda/hitungan beda) SEMUANYA ditolak"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit + 1 migrasi aditif"

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
for T in production_operators production_run_plans_v2 stage_assignments production_station_day_pics_v2 operator_skills production_runs_v2 production_operation_runs_v2 v2_feature_flags work_centers production_run_build_settings_v2 units activity_events; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='production_operators' and column_name='work_lanes'")" = "0" ] || die "kolom work_lanes SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_constraint where conname='production_operators_work_lanes_valid'")" = "0" ] || die "constraint production_operators_work_lanes_valid SUDAH ada di produksi (tidak diharapkan)"
for m in $MIG_LIST; do [ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${m}'")" = "0" ] || die "migrasi ${m} SUDAH tercatat di produksi (tidak diharapkan)"; done
OP_N="$(psql_live -At -c "select count(*) from production_operators")"
OP_AKTIF="$(psql_live -At -c "select count(*) from production_operators where active")"
PLAN_AKTIF_N="$(psql_live -At -c "select count(*) from production_run_plans_v2 where status::text <> 'CANCELLED'")"
PLAN_CORNER_N="$(psql_live -At -c "select count(*) from production_run_plans_v2 where status::text <> 'CANCELLED' and corner_operator_id is not null")"
PLAN_TANPA_CORNER_N="$(psql_live -At -c "select count(*) from production_run_plans_v2 where status::text <> 'CANCELLED' and corner_operator_id is null")"
for v in "$OP_N" "$OP_AKTIF" "$PLAN_AKTIF_N" "$PLAN_CORNER_N" "$PLAN_TANPA_CORNER_N"; do [[ "$v" =~ ^[0-9]+$ ]] || die "garis dasar bukan angka: '$v'"; done
[ "$OP_N" -gt 0 ] || die "tidak ada operator produksi di produksi: uji perilaku rehearsal butuh contoh baris — berhenti"
printf 'OP_N=%s OP_AKTIF=%s PLAN_AKTIF_N=%s PLAN_CORNER_N=%s PLAN_TANPA_CORNER_N=%s\n' "$OP_N" "$OP_AKTIF" "$PLAN_AKTIF_N" "$PLAN_CORNER_N" "$PLAN_TANPA_CORNER_N" > "$BK_DIR/garis-dasar.env"
ok "prasyarat skema terpenuhi; operator=${OP_N} (aktif ${OP_AKTIF}); rencana aktif=${PLAN_AKTIF_N} (PIC Corner terisi ${PLAN_CORNER_N}, kosong ${PLAN_TANPA_CORNER_N}) — dibiarkan apa adanya; semua operator akan bermula TANPA lini (Admin menetapkan eksplisit)"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel, TANPA kolom yang ditambahkan rilis ini (production_operators.work_lanes). Membuktikan restore identik dan migrasi tidak mengubah data lama.
FP_SQL="select 'production_operators', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'work_lanes')::text, '|' order by x.id),'')) from production_operators x
union all select 'production_run_plans_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_run_plans_v2 x
union all select 'stage_assignments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stage_assignments x
union all select 'production_station_day_pics_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_station_day_pics_v2 x
union all select 'operator_skills', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from operator_skills x
union all select 'production_runs_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_runs_v2 x
union all select 'production_operation_runs_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_operation_runs_v2 x
union all select 'v2_feature_flags', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from v2_feature_flags x
union all select 'work_centers', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from work_centers x
union all select 'production_run_build_settings_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_run_build_settings_v2 x
union all select 'units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from units x
union all select 'user_peran', count(*), md5(coalesce(string_agg(x.id::text || ':' || x.role::text || ':' || x.active::text, '|' order by x.id),'')) from \"User\" x"
FP_N=12
# DOKUMEN PEMBANDING DIBEKUKAN: hanya yang menurut aturan bisnis tidak mungkin berubah akibat rilis ini (rencana BATAL dan run SELESAI/BATAL yang diam sebelum T0, jejak aktivitas lama (append-only),
# identitas operator lama (id + akun), seluruh flag/cohort v2). T0 = jam DB (UTC) 5 menit lalu. Operator/rencana/penugasan aktif dan transaksi baru TIDAK diperbandingkan (Admin boleh bekerja saat rilis).
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'flag_v2', count(*), md5(coalesce(string_agg(f.key || '=' || f.enabled::text || '=' || f.scope || '=' || f.config::text, '|' order by f.key),'')) from v2_feature_flags f
union all select 'operator_identitas', count(*), md5(coalesce(string_agg(x.id::text || ':' || x.user_id, '|' order by x.id),'')) from production_operators x where x.created_at < '$T0'::timestamp
union all select 'rencana_batal', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_run_plans_v2 x where x.status::text = 'CANCELLED' and x.updated_at < '$T0'::timestamp
union all select 'run_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_runs_v2 x where x.status::text in ('COMPLETED','CANCELLED') and x.updated_at < '$T0'::timestamp
union all select 'aktivitas_lama', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from activity_events x where x.created_at < '$T0'::timestamp
FPBEKU
)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "5" ] || die "sidik jari dokumen beku tidak 5 baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di 5 kelompok)"

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
BACKUP_FILE="$HOME/backups/pre-plc-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-pic-lini-tombol-kembali.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Lini PIC" "Meja Bongkar" "Corner & Finishing" "tidak otomatis memakai PIC meja" "belum berlini" "Kembali ke SANSS"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Gunakan bukti lama" "Tambah bukti baru" "Potensi biaya admin tercatat dua kali" "Bukti yang akan dilampirkan" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Penjualan & Piutang" "Katalog Item PKR" "Kirim sebagian" "Retur & Debit Note" "Rencana Produksi" "Penjualan Karyawan" "Barang Akan Datang"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
[ -z "$(grep -lF "Sama dengan PIC meja" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru masih memuat opsi 'Sama dengan PIC meja' (pemisahan PIC tidak lengkap)"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + teks fitur lama ada; opsi 'Sama dengan PIC meja' tidak ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-plc-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_pic_lini_${TS}"
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
ok "restore nyata IDENTIK dengan dokumen beku produksi (flag/cohort, rencana batal, run final, jejak aktivitas lama, identitas operator)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$(printf '%s\n' "$REH_PEND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat migrasi rilis ini: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
# Struktur: kolom baru NOT NULL DEFAULT '{}' (tanpa backfill: SEMUA operator lama bermula tanpa lini); 1 CHECK tervalidasi; jumlah operator tidak berubah.
REH_OP_SEBELUM="$(awk -F'|' '$1=="production_operators"{print $2}' "$BK_DIR/fp-reh-sebelum.txt")"
[[ "$REH_OP_SEBELUM" =~ ^[0-9]+$ ]] || { reh_drop; die "jumlah operator rehearsal sebelum migrasi tidak terbaca"; }
[ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='production_operators' and column_name='work_lanes' and is_nullable='NO' and data_type='ARRAY'")" = "1" ] || { reh_drop; die "kolom work_lanes tidak terpasang sebagai ARRAY NOT NULL"; }
RPSQL "select column_default from information_schema.columns where table_schema='public' and table_name='production_operators' and column_name='work_lanes'" | grep -F 'ARRAY[]' >/dev/null || { reh_drop; die "DEFAULT kolom work_lanes bukan array kosong"; }
[ "$(RPSQL "select count(*) from production_operators where cardinality(work_lanes) > 0")" = "0" ] || { reh_drop; die "ada operator lama dengan lini terisi (backfill tidak diizinkan)"; }
[ "$(RPSQL "select count(*) from production_operators")" = "$REH_OP_SEBELUM" ] || { reh_drop; die "jumlah operator berubah oleh migrasi"; }
[ "$(RPSQL "select count(*) from pg_constraint where conname='production_operators_work_lanes_valid' and convalidated")" = "1" ] || { reh_drop; die "constraint production_operators_work_lanes_valid tidak ada tepat satu/tervalidasi"; }
ok "kolom work_lanes ARRAY NOT NULL DEFAULT '{}' terpasang; ${REH_OP_SEBELUM} operator lama SEMUANYA tanpa lini (tanpa backfill); 1 CHECK tervalidasi"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan di akhir): CHECK menolak nilai di luar TABLE/CORNER dan NULL; nilai sah lolos.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE
  op uuid; tolak int := 0; lolos int := 0;
BEGIN
  SELECT id INTO op FROM production_operators LIMIT 1;
  IF op IS NULL THEN RAISE EXCEPTION 'ROLLBACK_UJI tolak=0 lolos=0 (tidak ada operator contoh)'; END IF;
  BEGIN UPDATE production_operators SET work_lanes = ARRAY['MEJA']::text[] WHERE id = op; RAISE EXCEPTION 'TIDAK_DITOLAK_nilai_asing';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE production_operators SET work_lanes = ARRAY['TABLE','QC']::text[] WHERE id = op; RAISE EXCEPTION 'TIDAK_DITOLAK_campur_asing';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE production_operators SET work_lanes = ARRAY['table']::text[] WHERE id = op; RAISE EXCEPTION 'TIDAK_DITOLAK_huruf_kecil';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE production_operators SET work_lanes = NULL WHERE id = op; RAISE EXCEPTION 'TIDAK_DITOLAK_null';
  EXCEPTION WHEN not_null_violation THEN tolak := tolak + 1; END;
  UPDATE production_operators SET work_lanes = ARRAY['TABLE']::text[] WHERE id = op; lolos := lolos + 1;
  UPDATE production_operators SET work_lanes = ARRAY['CORNER','TABLE']::text[] WHERE id = op; lolos := lolos + 1;
  UPDATE production_operators SET work_lanes = ARRAY[]::text[] WHERE id = op; lolos := lolos + 1;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku CHECK/NOT NULL SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 4 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti terlalu sedikit (${UJI_TOLAK:-?}; minimal 4)"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" -ge 3 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos terlalu sedikit (${UJI_LOLOS:-?}; minimal 3)"; }
ok "perilaku terbukti di DB rehearsal: tolak=${UJI_TOLAK} lolos=${UJI_LOLOS} — CHECK menolak nilai asing/huruf kecil/campuran/NULL; nilai sah lolos; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from production_operators where cardinality(work_lanes) > 0")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi + uji perilaku (sidik jari baris penuh tanpa kolom baru); semua operator tanpa lini; DB sementara dihapus"

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
# SETELAH migrasi, SEBELUM switch: hanya backend LAMA yang melayani dan ia tidak mengenal kolom baru → SEMUA operator HARUS tanpa lini (DEFAULT '{}'; tanpa backfill).
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='production_operators' and column_name='work_lanes'")" = "1" ] || die "kolom work_lanes tidak ada setelah migrasi"
[ "$(psql_live -At -c "select count(*) from production_operators where cardinality(work_lanes) > 0")" = "0" ] || die "ada operator dengan lini terisi setelah migrasi sebelum switch (tidak boleh ada backfill)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari dokumen beku pasca-migrasi gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: semua operator tanpa lini (tanpa backfill), flag/cohort + rencana batal + run final + jejak aktivitas lama + identitas operator IDENTIK"

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
[ "$(PSQLN "select count(*) from information_schema.columns where table_schema='public' and table_name='production_operators' and column_name='work_lanes' and is_nullable='NO'")" = "1" ] || die "kolom work_lanes NOT NULL tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_constraint where conname='production_operators_work_lanes_valid' and convalidated")" = "1" ] || die "CHECK work_lanes tidak ada setelah rilis"
ok "kolom work_lanes + CHECK terpasang (tidak ada asumsi tentang jumlah operator berlini: Admin boleh sudah menetapkan lini)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test lini operator + izin + validasi sebelum menyentuh data + antrean/papan + kontrak kode (baca-saja; tidak menulis; tahan terhadap pekerjaan Admin yang sah saat rilis)"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e OP_N="$OP_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
const imp = (p) => import(pathToFileURL(process.cwd() + "/src/" + p).href);
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const tokenUntuk = async (u) => { const roles = (await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role); return jwt.sign({ id: u.id, name: u.name, role: u.role, roles: roles.length ? roles : [u.role] }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
const BERIZIN = new Set(["ADMIN", "OWNER", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) {
    const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
    if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u;
  }
  return null;
}
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
if (!adm) { rec("akun ADMIN/OWNER tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm);
const tS = sales ? await tokenUntuk(sales) : null;
const nol = "00000000-0000-4000-8000-000000000000";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const SEBELUM_LINI = await hitung(`select count(*)::int n from production_operators where cardinality(work_lanes) > 0`);
const SEBELUM_RIWAYAT = await hitung(`select count(*)::int n from activity_events where entity_id like 'operator-lanes:%'`);

// ── Operator + lini (baca) ──
const penuh = await api("GET", "/api/production/operators", tA);
const ops = penuh.json?.operators ?? [];
rec("GET /production/operators (admin) 200: daftar penuh membawa workLanes (array berisi hanya TABLE/CORNER) untuk SEMUA operator", penuh.status === 200 && ops.length === Number(process.env.OP_N) && ops.every((o) => Array.isArray(o.workLanes) && o.workLanes.every((l) => ["TABLE", "CORNER"].includes(l))), `${penuh.status} operator=${ops.length}`);
rec("lane tak dikenal -> 400 (bukan daftar kosong diam-diam)", (await api("GET", "/api/production/operators?lane=MEJA", tA)).status === 400);
for (const lane of ["TABLE", "CORNER"]) {
  const r = await api("GET", `/api/production/operators?pilihan=1&lane=${lane}`, tA);
  const list = r.json?.operators ?? [];
  const adminOwner = (await prisma.user.findMany({ where: { id: { in: list.map((o) => o.userId) } }, select: { id: true, role: true } })).filter((u) => ["ADMIN", "OWNER"].includes(u.role)).length;
  rec(`dropdown lini ${lane}: hanya operator AKTIF berlini itu, tanpa akun ADMIN/OWNER`, r.status === 200 && r.json?.lane === lane && list.every((o) => o.active && o.workLanes.includes(lane)) && adminOwner === 0, `${list.length} operator`);
}
const refs = await api("GET", "/api/production-v2/planning/refs", tA);
rec("planning/refs (admin) 200: operator membawa workLanes; masalah (bila ada) berupa alasan + tautan", refs.status === 200 && Array.isArray(refs.json?.operators) && refs.json.operators.every((o) => Array.isArray(o.workLanes)) && Array.isArray(refs.json?.problems) && refs.json.problems.every((p) => p.code && p.message), `${refs.status} masalah=${(refs.json?.problems ?? []).map((p) => p.code).join(",") || "-"}`);

// ── Penulisan ditolak SEBELUM menyentuh data ──
rec("PATCH lini tanpa token -> 401", (await api("PATCH", `/api/production/operators/${nol}`, null, { workLanes: ["TABLE"] })).status === 401);
if (tS) rec("PATCH lini oleh SALES -> 403", (await api("PATCH", `/api/production/operators/${nol}`, tS, { workLanes: ["TABLE"] })).status === 403);
else skip("PATCH lini oleh SALES -> 403", "tidak ada akun SALES murni; akun/token tidak dibuat atau direkayasa");
const buruk = await api("PATCH", `/api/production/operators/${nol}`, tA, { workLanes: ["MEJA"] });
rec("PATCH lini nilai asing (admin) -> 400 sebelum menyentuh data", buruk.status === 400, String(buruk.status));
const hilang = await api("PATCH", `/api/production/operators/${nol}`, tA, { workLanes: ["TABLE"] });
rec("PATCH lini operator tak dikenal (admin) -> 404 (bukan 500; tidak menulis)", hilang.status === 404, String(hilang.status));
if (tS) rec("tetapkan PIC bawaan Meja oleh SALES -> 403", (await api("PUT", "/api/production-v2/stations/TABLE_1/pic", tS, { productionDate: "2026-01-01", operatorId: null })).status === 403);
else skip("tetapkan PIC bawaan Meja oleh SALES -> 403", "tidak ada akun SALES murni");
const gantiCorner = await api("POST", `/api/production-v2/runs/${nol}/corner-operator`, tA, { operatorId: nol, expectedRevision: 1 }, { "Idempotency-Key": "smoke-plc-corner-0001-aaaa" });
rec("ganti PIC Corner untuk run tak dikenal (admin) ditolak (404/400/409/428), bukan 200", [400, 404, 409, 428].includes(gantiCorner.status), `${gantiCorner.status} ${gantiCorner.json?.code ?? ""}`);
rec("smoke TIDAK menulis: jumlah operator berlini dan riwayat perubahan lini tidak berubah", (await hitung(`select count(*)::int n from production_operators where cardinality(work_lanes) > 0`)) === SEBELUM_LINI && (await hitung(`select count(*)::int n from activity_events where entity_id like 'operator-lanes:%'`)) === SEBELUM_RIWAYAT, `berlini=${SEBELUM_LINI} riwayat=${SEBELUM_RIWAYAT}`);

// ── Antrean/papan (baca) ──
for (const p of ["/api/production-v2/corner-board", "/api/production-v2/worker/corner", "/api/production-v2/worker/table"]) {
  const r = await api("GET", p, tA);
  rec(`${p} (admin) 200`, r.status === 200, String(r.status));
}

// ── Kontrak kode di container (fungsi murni; tanpa DB) ──
const lanes = await imp("lib/domain/productionLanes.js");
rec("kontrak lini: nilai asing ditolak, urutan baku, kosong sah", lanes.normalizeWorkLanes(["MEJA"]) === null && JSON.stringify(lanes.normalizeWorkLanes(["CORNER", "TABLE"])) === '["TABLE","CORNER"]' && JSON.stringify(lanes.normalizeWorkLanes([])) === "[]");
const exec = await imp("services/productionWorkshopExecutionCommandService.js");
let kode = null; try { exec.assertAssignedCornerOperator({ operatorId: "meja", cornerOperatorId: null, workCenterId: "w" }, { id: "meja", active: true }, "w"); } catch (e) { kode = e.code; }
rec("PIC Corner kosong TIDAK jatuh ke PIC Meja (CORNER_OPERATOR_REQUIRED)", kode === "CORNER_OPERATOR_REQUIRED", String(kode));
const plan = await imp("services/productionPlanningCommandService.js");
let kode2 = null; try { plan.assertOperatorLane({ id: "x", workLanes: ["CORNER"] }, "TABLE"); } catch (e) { kode2 = e.code; }
rec("operator berlini Corner ditolak sebagai PIC Meja (PLAN_OPERATOR_LANE_INVALID)", kode2 === "PLAN_OPERATOR_LANE_INVALID", String(kode2));
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal, ${dilewati} dilewati (SKIP)`);
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log (akun peran-murni tidak ada; tidak ada akun/token/transaksi dibuat). Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else
    ok "smoke test lulus (daftar operator membawa lini, dropdown per lini tanpa ADMIN/OWNER, lane tak dikenal 400, PATCH lini/PIC ditolak sebelum menyentuh data, antrean/papan Corner terbaca, kontrak PIC Corner tanpa fallback di container)"
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
ok "dokumen pembanding beku (flag/cohort, rencana batal, run final, jejak aktivitas lama, identitas operator) IDENTIK sebelum vs sesudah rilis; transaksi sah yang muncul saat rilis tidak diperbandingkan"
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
say "TINDAK LANJUT ADMIN: semua operator bermula TANPA lini — dropdown PIC Meja/Corner kosong sampai Admin mencentang lini di Pengaturan > Operator (Meja Bongkar / Corner & Finishing). PIC Corner kosong tidak lagi memakai PIC Meja: unit yang sudah di Corner tanpa PIC Corner perlu PIC Corner ditetapkan dari tab Corner di Rencana Produksi."
