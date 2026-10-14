#!/usr/bin/env bash
# RILIS "MANIFEST DELIVERY + GABUNGKAN ORDER DUPLIKAT": web + backend + 2 migrasi ADITIF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Manifest barang dibangun server dari unit tertaut job (stop ≠ unit ≠ jenis produk) dan dipakai web, WA, sheet, dan app driver; konfirmasi muat unit + gerbang penyelesaian
#   (env DELIVERY_UNIT_CONFIRM_REQUIRED, DEFAULT MATI — rilis ini TIDAK menyalakannya); Gabungkan Order Duplikat = relasi saja (tanpa menghapus/memindah data).
#   Migrasi: tabel job_unit_loads (kosong), 4 kolom NULL pada "Order", tabel order_merges append-only (kosong). Tanpa backfill.
# Data lama TIDAK diubah. Produksi: verifikasi hanya baca + penolakan izin; TIDAK ada konfirmasi muat/penggabungan/transaksi QA. Uji perilaku constraint/trigger di DB REHEARSAL (hasil restore backup).
#
#   cat scripts/release-delivery-manifest.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/dm1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/dm1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/dm1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/dm1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode HANYA boleh di-rollback bila belum ada penggabungan (order_merges) / konfirmasi muat (job_unit_loads). Periksa dulu dengan scripts/rollback-guard-delivery-manifest.sh (baca-saja).
# APLIKASI RN (driver-mobile, delivery-control) dirilis TERPISAH lewat OTA — lihat docs/DELIVERY-MANIFEST-GABUNG-ORDER.md (urutan + gerbang versi). Skrip ini hanya server + web.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/delivery-manifest}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261115090000_job_unit_loads:06cd07c370771fd392ccaebc5908d8e28d258a8c76fa335d3c9e967df17119b0 20261115100000_order_merge:7ba3329e5fa22d3b77d00c28cbfb3182248caa8cd6dab8df2a22707507958507"
# Hasil pemindai untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":22,"tabel":2,"indeks":6,"kolom":4,"fk":7,"check":1,"fungsi":1,"trigger":1}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="07fa71d17f260f804506881f179ad29c01b66a6ffdde19a62384aec3da38ca7f"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261115090000_job_unit_loads/migration\.sql|backend/prisma/migrations/20261115100000_order_merge/migration\.sql|backend/prisma/schema\.prisma|backend/scripts/order-gabung-dry-run\.js|backend/src/lib/domain/deliveryManifest\.js|backend/src/routes/armada\.js|backend/src/routes/deliveryV2\.js|backend/src/routes/orders\.js|backend/src/services/deliveryManifestAttach\.js|backend/src/services/deliveryManifestInclude\.js|backend/src/services/deliveryUnitLoad\.js|backend/src/services/driverSnapshotV2\.js|backend/src/services/orderMerge\.js|backend/src/services/routeSheetImage\.js|backend/tests/deliveryManifest\.test\.js|backend/tests/integration/deliveryManifestGabung\.integration\.test\.js|backend/tests/integration/deliveryUnitLoadGate\.integration\.test\.js|backend/tests/integration/setup/testApp\.js|delivery-control/src/screens/MasalahDetailScreen\.js|delivery-control/src/screens/RuteDetailScreen\.js|delivery-control/src/uiSource\.test\.js|docs/DELIVERY-MANIFEST-GABUNG-ORDER\.md|driver-mobile/src/api\.js|driver-mobile/src/components/JobCard\.js|driver-mobile/src/components/ManifestSection\.js|driver-mobile/src/hooks/useUnitLoadGate\.js|driver-mobile/src/lib/executionCore\.js|driver-mobile/src/lib/executionQueue\.js|driver-mobile/src/lib/jobHelpers\.js|driver-mobile/src/lib/manifestView\.js|driver-mobile/src/lib/unitLoadOffline\.test\.js|driver-mobile/src/screens/PersiapanPerjalananScreen\.js|frontend/src/api\.js|frontend/src/features/armada/components/JobBadges\.jsx|frontend/src/features/armada/components/JobDetailDrawer\.jsx|frontend/src/features/armada/components/ManifestBlock\.jsx|frontend/src/features/armada/components/MuatBarangPanel\.jsx|frontend/src/features/armada/components/RouteCard\.jsx|frontend/src/features/armada/components/RoutePrepChecklistAdminModal\.jsx|frontend/src/features/armada/components/RoutePrepChecklistDriverPanel\.jsx|frontend/src/features/armada/components/UnroutedJobsPanel\.jsx|frontend/src/features/armada/jobStatus\.js|frontend/src/features/armada/manifest\.js|frontend/src/features/orders/GabungOrderDialog\.jsx|frontend/src/features/orders/OrderTimelineDrawer\.jsx|frontend/src/features/orders/PanelIdentitasPkr\.jsx|frontend/src/features/orders/PkrUnitBaris\.jsx|frontend/src/features/orders/SumberPkr\.jsx|frontend/src/features/orders/pkrUnitLogic\.js|frontend/src/pages/DriverJobs\.jsx|frontend/src/pages/Orders\.jsx|frontend/src/pages/armada/ArmadaDashboard\.jsx|frontend/src/pages/armada/ArmadaJobs\.jsx|frontend/src/utils/submitJobAction\.js|frontend/tests/deliveryManifestGabungUI\.test\.js|packages/delivery-shared/src/index\.js|packages/delivery-shared/src/operasional/manifest\.js|packages/delivery-shared/test/manifest\.test\.js|scripts/release-delivery-manifest\.sh|scripts/rollback-guard-delivery-manifest\.sh)$'
BACKEND_SRC_EXPECT="backend/src/lib/domain/deliveryManifest.js backend/src/routes/armada.js backend/src/routes/deliveryV2.js backend/src/routes/orders.js backend/src/services/deliveryManifestAttach.js backend/src/services/deliveryManifestInclude.js backend/src/services/deliveryUnitLoad.js backend/src/services/driverSnapshotV2.js backend/src/services/orderMerge.js backend/src/services/routeSheetImage.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/armada/components/JobBadges.jsx frontend/src/features/armada/components/JobDetailDrawer.jsx frontend/src/features/armada/components/ManifestBlock.jsx frontend/src/features/armada/components/MuatBarangPanel.jsx frontend/src/features/armada/components/RouteCard.jsx frontend/src/features/armada/components/RoutePrepChecklistAdminModal.jsx frontend/src/features/armada/components/RoutePrepChecklistDriverPanel.jsx frontend/src/features/armada/components/UnroutedJobsPanel.jsx frontend/src/features/armada/jobStatus.js frontend/src/features/armada/manifest.js frontend/src/features/orders/GabungOrderDialog.jsx frontend/src/features/orders/OrderTimelineDrawer.jsx frontend/src/features/orders/PanelIdentitasPkr.jsx frontend/src/features/orders/PkrUnitBaris.jsx frontend/src/features/orders/SumberPkr.jsx frontend/src/features/orders/pkrUnitLogic.js frontend/src/pages/DriverJobs.jsx frontend/src/pages/Orders.jsx frontend/src/pages/armada/ArmadaDashboard.jsx frontend/src/pages/armada/ArmadaJobs.jsx frontend/src/utils/submitJobAction.js"
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
BK_DIR="$HOME/release-backups/delivery-manifest-${DEPLOY_SHORT}-${TS}"
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
   bash ${NEW_DIR}/scripts/rollback-guard-delivery-manifest.sh
Guard menolak (exit 1) bila SUDAH ada data yang hanya dipahami kode baru:
   - penggabungan di order_merges / "Order".merged_into_order_id — kode lama tidak menyaring order digabung: order duplikat tampil lagi sebagai pesanan aktif kedua.
   - konfirmasi muat di job_unit_loads — kode lama tidak membaca/menghormatinya (gerbang hilang tanpa jejak).
   Bila guard menolak: JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner.
Bila guard lulus (belum ada data fitur), rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi bersifat ADITIF (tabel/kolom baru kosong): dibiarkan terpasang pun aman bagi kode lama SELAMA belum ada data fitur. (Tidak dihapus oleh rollback kode.)
Env DELIVERY_UNIT_CONFIRM_REQUIRED TIDAK diubah oleh rilis ini (default MATI). Bila kelak dinyalakan lalu perlu dimatikan: hapus/kosongkan env itu dan recreate backend (data konfirmasi tetap tersimpan).
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
exec 9>/tmp/release-delivery-manifest.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "dm1\|release-delivery-manifest\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat migrasi rilis ini (2 migrasi + schema.prisma yang diaudit)"; }
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
// Pemindai migrasi rilis "Manifest Delivery + Gabung Order" (2 migrasi aditif). FAIL-CLOSED: setiap pernyataan harus cocok PERSIS salah satu bentuk yang diaudit.
//  - CREATE TABLE hanya "job_unit_loads" dan "order_merges"; CREATE [UNIQUE] INDEX hanya pada 3 tabel itu + "Order" (kolom baru).
//  - ALTER TABLE "Order" ADD COLUMN hanya 4 kolom penggabungan (nullable); FK baru hanya dari/ke tabel yang diaudit (Order self-ref RESTRICT).
//  - Satu CHECK pada "Order" (bukan diri sendiri), satu fungsi trigger append-only dan satu trigger pada "order_merges".
// Tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/ALTER COLUMN/RENAME/GRANT/ENUM, tidak ada kolom lain pada tabel lama.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };
function pecah(t) {
  const out = []; let cur = ""; let dalam = false;
  for (let i = 0; i < t.length; i += 1) {
    if (t.startsWith("$$", i)) { dalam = !dalam; cur += "$$"; i += 1; continue; }
    const c = t[i];
    if (c === ";" && !dalam) { out.push(cur); cur = ""; } else cur += c;
  }
  if (rapat(cur)) out.push(cur);
  return out.map(rapat).filter(Boolean);
}
const FUNGSI = "CREATE OR REPLACE FUNCTION order_merges_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'order_merges append-only: baris % tidak boleh diubah atau dihapus', OLD.\"id\" USING ERRCODE = 'restrict_violation'; END $$";
const TRIGGER = "CREATE TRIGGER order_merges_append_only_trg BEFORE UPDATE OR DELETE ON \"order_merges\" FOR EACH ROW EXECUTE FUNCTION order_merges_append_only()";
const CHECK_ORDER = "ALTER TABLE \"Order\" ADD CONSTRAINT \"Order_merge_bukan_diri_sendiri_chk\" CHECK (\"merged_into_order_id\" IS NULL OR \"merged_into_order_id\" <> \"id\")";
const BENTUK = [
  ["tabel", /^CREATE TABLE "(job_unit_loads|order_merges)" \([^;]*\)$/],
  ["indeks", /^CREATE (UNIQUE )?INDEX "[A-Za-z0-9_]+" ON "(job_unit_loads|order_merges|Order)"\("[a-z_]+"(, "[a-z_]+")*\)$/],
  ["kolom", /^ALTER TABLE "Order" ADD COLUMN "(merged_into_order_id|merged_at|merged_by_id|merge_reason)" (TEXT|TIMESTAMP\(3\)|VARCHAR\(500\))$/],
  ["fk", /^ALTER TABLE "(Order|order_merges|job_unit_loads)" ADD CONSTRAINT "[A-Za-z0-9_]+" FOREIGN KEY \("[a-z_]+"\) REFERENCES "(Order|User|jobs|units)"\("id"\) ON DELETE (RESTRICT|CASCADE|SET NULL) ON UPDATE CASCADE$/],
];
const hitung = { total: 0, tabel: 0, indeks: 0, kolom: 0, fk: 0, check: 0, fungsi: 0, trigger: 0 };
const lihat = new Set();
for (const r of pecah(sql)) {
  hitung.total += 1;
  if (lihat.has(r)) gagal("pernyataan ganda: " + r.slice(0, 120));
  lihat.add(r);
  if (r === CHECK_ORDER) { hitung.check += 1; continue; }
  if (r === FUNGSI) { hitung.fungsi += 1; continue; }
  if (r === TRIGGER) { hitung.trigger += 1; continue; }
  const b = BENTUK.find(([, re]) => re.test(r));
  if (!b) gagal("PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 200));
  if (b[0] === "fk") {
    // FK dari tabel LAMA ("Order") hanya boleh self-ref RESTRICT; kaskade hanya dari tabel baru ke induknya.
    const dariOrder = /^ALTER TABLE "Order"/.test(r);
    if (dariOrder && !(/REFERENCES "Order"\("id"\) ON DELETE RESTRICT/.test(r))) gagal("FK dari Order hanya boleh self-ref RESTRICT: " + r.slice(0, 160));
  }
  hitung[b[0]] += 1;
}
console.log(JSON.stringify(hitung));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (2 tabel baru kosong, 4 kolom NULL pada Order, 1 CHECK, 1 trigger append-only); tanpa DROP/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE tabel lama" "$(tambah_stmt 'DROP TABLE "Order";')"
harus_ditolak "DROP TABLE tabel baru" "$(tambah_stmt 'DROP TABLE "order_merges";')"
harus_ditolak "UPDATE tabel lama (Order)" "$(tambah_stmt "UPDATE \"Order\" SET \"paymentStatus\" = 'LUNAS';")"
harus_ditolak "UPDATE tabel lama (jobs)" "$(tambah_stmt "UPDATE \"jobs\" SET \"status\" = 'COMPLETED';")"
harus_ditolak "DELETE tabel lama" "$(tambah_stmt 'DELETE FROM "fin_journal_lines";')"
harus_ditolak "INSERT" "$(tambah_stmt "INSERT INTO \"fin_settings\" (key) VALUES ('x');")"
harus_ditolak "INSERT ... SELECT" "$(tambah_stmt 'INSERT INTO "job_unit_loads" SELECT * FROM "job_unit_loads";')"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "order_merges";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "Order" DROP COLUMN "value";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "Order" ALTER COLUMN "value" TYPE BIGINT;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "Order" RENAME COLUMN "value" TO "nilai";')"
harus_ditolak "kolom liar pada Order" "$(tambah_stmt 'ALTER TABLE "Order" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom pada tabel lain (jobs)" "$(tambah_stmt 'ALTER TABLE "jobs" ADD COLUMN "merged_at" TIMESTAMP(3);')"
harus_ditolak "kolom penggabungan NOT NULL (bukan nullable)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ADD COLUMN "merge_reason" VARCHAR(500)/ADD COLUMN "merge_reason" VARCHAR(500) NOT NULL/')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "indeks pada tabel lama (jobs)" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "jobs"("status");')"
harus_ditolak "FK dari Order ke Customer dengan CASCADE" "$(tambah_stmt 'ALTER TABLE "Order" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;')"
harus_ditolak "FK Order self-ref diubah CASCADE" "$(printf '%s\n' "$ALL_SQL" | sed 's/"Order_merged_into_order_id_fkey" FOREIGN KEY ("merged_into_order_id") REFERENCES "Order"("id") ON DELETE RESTRICT/"Order_merged_into_order_id_fkey" FOREIGN KEY ("merged_into_order_id") REFERENCES "Order"("id") ON DELETE CASCADE/')"
harus_ditolak "CHECK Order dilonggarkan" "$(printf '%s\n' "$ALL_SQL" | sed 's/"merged_into_order_id" <> "id"/true/')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "Order" DROP CONSTRAINT "Order_pkey";')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"LeadSource\" ADD VALUE IF NOT EXISTS 'LIAR';")"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "Order" TO PUBLIC;')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "fungsi append-only dilemahkan" "$(printf '%s\n' "$ALL_SQL" | sed 's/RAISE EXCEPTION/RETURN NEW; --/')"
harus_ditolak "trigger pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "Order" FOR EACH ROW EXECUTE FUNCTION order_merges_append_only();')"
harus_ditolak "trigger append-only dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'CREATE TRIGGER')"
harus_ditolak "trigger dimatikan" "$(tambah_stmt 'ALTER TABLE "order_merges" DISABLE TRIGGER ALL;')"
harus_ditolak "pernyataan ganda" "$(tambah_stmt 'ALTER TABLE "Order" ADD COLUMN "merged_at" TIMESTAMP(3);')"
[ "$NEG" -ge 24 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 24)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER COLUMN/RENAME/kolom liar/NOT NULL/tabel-indeks-FK liar/CASCADE/CHECK longgar/GRANT/fungsi dilemahkan/trigger liar) SEMUANYA ditolak"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit (termasuk 2 migrasi aditif + schema.prisma yang diaudit)"

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
for T in "Order" "Customer" "User" jobs units job_units fin_penjualan_karyawan pkr_order_items pkr_order_item_units payments fin_journal_entries fin_journal_lines fin_settings; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
for T in job_unit_loads order_merges; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "0" ] || die "tabel $T SUDAH ada di produksi (tidak diharapkan sebelum rilis)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='Order' and column_name in ('merged_into_order_id','merged_at','merged_by_id','merge_reason')")" = "0" ] || die "kolom penggabungan SUDAH ada di Order (tidak diharapkan sebelum rilis)"
for m in $MIG_LIST; do [ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${m}'")" = "0" ] || die "migrasi ${m} SUDAH tercatat di produksi (tidak diharapkan)"; done
ORDER_N="$(psql_live -At -c "select count(*) from \"Order\"")"
JOB_N="$(psql_live -At -c "select count(*) from jobs")"
PKR_N="$(psql_live -At -c "select count(*) from fin_penjualan_karyawan")"
LINK_N="$(psql_live -At -c "select count(*) from job_units")"
for v in "$ORDER_N" "$JOB_N" "$PKR_N" "$LINK_N"; do [[ "$v" =~ ^[0-9]+$ ]] || die "audit awal bukan angka: '$v'"; done
ok "prasyarat skema terpenuhi; order=${ORDER_N}, job=${JOB_N}, PKR=${PKR_N}, tautan job-unit=${LINK_N}; objek rilis ini belum ada — tanpa backfill"
# GARIS DASAR invarian (dibandingkan sesudah rilis; yang dijaga = TIDAK BERTAMBAH oleh rilis ini).
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
SQL_GANDA="select count(*)::int from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"; BASE_GANDA="$(psql_live -At -c "$SQL_GANDA")"
for v in "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA"; do [[ "$v" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$v'"; done
printf 'BASE_TIDAK_SEIMBANG=%s BASE_GANDA=%s ORDER_N=%s JOB_N=%s PKR_N=%s\n' "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA" "$ORDER_N" "$JOB_N" "$PKR_N" > "$BK_DIR/garis-dasar.env"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}; refund dengan >1 jurnal berlaku = ${BASE_GANDA}"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel. Membuktikan restore identik dan migrasi tidak mengubah data lama (rilis ini tidak menambah kolom pada tabel lama).
FP_SQL="select 'order', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'merged_into_order_id' - 'merged_at' - 'merged_by_id' - 'merge_reason')::text, '|' order by x.id),'')) from \"Order\" x
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
BACKUP_FILE="$HOME/backups/pre-delivery-manifest-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-delivery-manifest.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa" "Semua dimuat" "Alasan pengecualian"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
[ -z "$(grep -lF "Hitung Kas" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru memuat Hitung Kas (halamannya belum ada)"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + 15 teks fitur lama ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-delivery-manifest-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_delivery_manifest_${TS}"
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
# Struktur: 2 tabel baru KOSONG, 4 kolom Order NULL semua, trigger append-only terpasang.
[ "$(RPSQL "select count(*) from information_schema.tables where table_schema='public' and table_name in ('job_unit_loads','order_merges')")" = "2" ] || { reh_drop; die "tabel baru tidak terbentuk"; }
[ "$(RPSQL "select count(*) from job_unit_loads")" = "0" ] && [ "$(RPSQL "select count(*) from order_merges")" = "0" ] || { reh_drop; die "tabel baru tidak kosong setelah migrasi (backfill tidak diharapkan)"; }
[ "$(RPSQL "select count(*) from \"Order\" where merged_into_order_id is not null or merged_at is not null or merged_by_id is not null or merge_reason is not null")" = "0" ] || { reh_drop; die "ada order bertanda digabung setelah migrasi (backfill tidak diharapkan)"; }
[ "$(RPSQL "select count(*) from pg_trigger where tgname = 'order_merges_append_only_trg' and not tgisinternal")" = "1" ] || { reh_drop; die "trigger append-only tidak terpasang"; }
[ "$(RPSQL "select count(*) from pg_constraint where conname = 'Order_merge_bukan_diri_sendiri_chk'")" = "1" ] || { reh_drop; die "CHECK Order tidak terpasang"; }
ok "struktur: 2 tabel baru kosong, kolom penggabungan NULL semua, trigger append-only + CHECK terpasang"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan): memakai baris NYATA hasil restore (3 order, 1 tautan job-unit) di dalam satu blok yang di-RAISE di akhir.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE a text; b text; c text; jb uuid; un uuid; tolak int := 0; lolos int := 0;
BEGIN
  SELECT id INTO a FROM "Order" ORDER BY id LIMIT 1 OFFSET 0;
  SELECT id INTO b FROM "Order" ORDER BY id LIMIT 1 OFFSET 1;
  SELECT id INTO c FROM "Order" ORDER BY id LIMIT 1 OFFSET 2;
  SELECT job_id, unit_id INTO jb, un FROM job_units ORDER BY job_id LIMIT 1;
  IF a IS NULL OR b IS NULL OR c IS NULL OR jb IS NULL THEN RAISE EXCEPTION 'DATA_CONTOH_KURANG'; END IF;
  -- yang SAH
  INSERT INTO order_merges (id, primary_order_id, duplicate_order_id, reason, idempotency_key, "before", "after") VALUES (gen_random_uuid(), a, b, 'alasan uji cukup panjang', 'uji-1', '{}', '{}'); lolos := lolos + 1;
  UPDATE "Order" SET merged_into_order_id = a, merged_at = now(), merge_reason = 'uji' WHERE id = b; lolos := lolos + 1;
  INSERT INTO job_unit_loads (id, job_id, unit_id) VALUES (gen_random_uuid(), jb, un); lolos := lolos + 1;
  -- yang HARUS DITOLAK
  BEGIN INSERT INTO order_merges (id, primary_order_id, duplicate_order_id, reason, idempotency_key, "before", "after") VALUES (gen_random_uuid(), c, b, 'alasan uji cukup panjang', 'uji-2', '{}', '{}'); RAISE EXCEPTION 'TIDAK_DITOLAK_duplikat_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO order_merges (id, primary_order_id, duplicate_order_id, reason, idempotency_key, "before", "after") VALUES (gen_random_uuid(), a, c, 'alasan uji cukup panjang', 'uji-1', '{}', '{}'); RAISE EXCEPTION 'TIDAK_DITOLAK_kunci_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO order_merges (id, primary_order_id, duplicate_order_id, reason, idempotency_key, "before", "after") VALUES (gen_random_uuid(), c, c, 'alasan uji cukup panjang', 'uji-3', '{}', '{}'); RAISE EXCEPTION 'TIDAK_DITOLAK_diri_sendiri';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO order_merges (id, primary_order_id, duplicate_order_id, reason, idempotency_key, "before", "after") VALUES (gen_random_uuid(), a, c, 'abc', 'uji-4', '{}', '{}'); RAISE EXCEPTION 'TIDAK_DITOLAK_alasan_pendek';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE "Order" SET merged_into_order_id = c WHERE id = c; RAISE EXCEPTION 'TIDAK_DITOLAK_order_ke_diri_sendiri';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE order_merges SET reason = 'diubah paksa oleh uji'; RAISE EXCEPTION 'TIDAK_DITOLAK_update_buku';
  EXCEPTION WHEN restrict_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM order_merges; RAISE EXCEPTION 'TIDAK_DITOLAK_delete_buku';
  EXCEPTION WHEN restrict_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM "Order" WHERE id = b; RAISE EXCEPTION 'TIDAK_DITOLAK_hapus_order_tergabung';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO job_unit_loads (id, job_id, unit_id) VALUES (gen_random_uuid(), jb, un); RAISE EXCEPTION 'TIDAK_DITOLAK_muat_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO job_unit_loads (id, job_id, unit_id) VALUES (gen_random_uuid(), gen_random_uuid(), un); RAISE EXCEPTION 'TIDAK_DITOLAK_job_tak_ada';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'DATA_CONTOH_KURANG' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data contoh di hasil restore kurang (butuh >=3 order dan 1 tautan job-unit)"; }
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint/trigger SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" = "10" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti ${UJI_TOLAK:-?} (harus 10)"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" = "3" ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos ${UJI_LOLOS:-?} (harus 3)"; }
ok "perilaku terbukti di DB rehearsal: tolak=${UJI_TOLAK} lolos=${UJI_LOLOS} — penggabungan/muat sah lolos; duplikat ganda, kunci ganda, diri sendiri, alasan pendek, update/delete buku, hapus order tergabung, muat ganda, job tak ada ditolak; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from order_merges")" = "0" ] && [ "$(RPSQL "select count(*) from job_unit_loads")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrasi + uji perilaku (sidik jari baris penuh); DB sementara dihapus"

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
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 2 ))" ] || die "jumlah migrasi terpasang != sebelum + 2"
ok "2 migrasi diterapkan; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"
# SETELAH migrasi, SEBELUM switch: hanya backend LAMA yang melayani dan ia tidak mengenal penggabungan/konfirmasi muat → kedua tabel HARUS kosong dan tidak ada order bertanda digabung (tanpa backfill).
[ "$(psql_live -At -c "select (select count(*) from order_merges) + (select count(*) from job_unit_loads) + (select count(*) from \"Order\" where merged_into_order_id is not null)")" = "0" ] || die "ada data penggabungan/konfirmasi muat sebelum switch (backend lama tidak bisa membuatnya; backfill tidak diharapkan)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari dokumen beku pasca-migrasi gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: tabel baru kosong, tidak ada order tergabung (tanpa backfill), dokumen pembanding beku identik"

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
[ "$(PSQLN "select count(*) from pg_trigger where tgname = 'order_merges_append_only_trg' and not tgisinternal")" = "1" ] || die "trigger append-only tidak ada di produksi"
ok "objek rilis terpasang di produksi: trigger append-only order_merges (tabel baru kosong, tanpa asumsi data)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin + penolakan sebelum menyentuh data, config gerbang, manifest pada daftar job, dry-run penggabungan, invarian"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
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
  if (method !== "GET") tulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status, valid: json?.valid });
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
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
if (!adm || !sales) { rec("akun ADMIN dan SALES murni tersedia", false, `adm=${!!adm} sales=${!!sales}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const produksi = await userDengan("PRODUCTION_LEAD", new Set([...BERIZIN, "SALES"]));
const tP = produksi ? await tokenUntuk(produksi) : null;
const nol = "00000000-0000-4000-8000-000000000000";
const hitungSql = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const B = (k) => Number(process.env[k]);
const BASE_PKR = "/api/finance/penjualan-karyawan";
const DRV = await userDengan("DRIVER", new Set([...BERIZIN, "SALES"]));
const tD = DRV ? await tokenUntuk(DRV) : null;
const ENV_MODE = (() => { const v = String(process.env.DELIVERY_UNIT_CONFIRM_REQUIRED ?? "").trim().toLowerCase(); return v === "1" || v === "strict" || v === "ketat" || v === "true" ? "KETAT" : (v === "capable" || v === "kapabel") ? "KAPABEL" : "MATI"; })();

// ── Penolakan SEBELUM menyentuh data ──
const u1 = (await api("POST", "/api/armada/jobs/" + nol + "/unit-load", null, { semua: true })).status;
const u2 = (await api("POST", "/api/armada/jobs/" + nol + "/unit-load", tS, { semua: true })).status;
const u3 = (await api("POST", "/api/armada/jobs/" + nol + "/unit-load", tA, { semua: true })).status;
rec("konfirmasi muat: tanpa token 401, SALES 403, admin job tak dikenal 404 (tidak menyentuh data)", u1 === 401 && u2 === 403 && [400, 404].includes(u3), u1 + "," + u2 + "," + u3);
const m1 = (await api("POST", "/api/orders/gabung", null, { utama: nol, duplikat: nol, alasan: "uji smoke", sidikJari: "x" }, { "Idempotency-Key": "smoke-dm-anon" })).status;
const m2 = (await api("POST", "/api/orders/gabung", tS, { utama: nol, duplikat: nol, alasan: "uji smoke", sidikJari: "x" }, { "Idempotency-Key": "smoke-dm-sales" })).status;
const m3 = (await api("POST", "/api/orders/gabung", tA, { utama: nol, duplikat: nol, alasan: "uji smoke", sidikJari: "x" }, { "Idempotency-Key": "smoke-dm-adm" })).status;
rec("gabung order: tanpa token 401, SALES 403, admin id tak dikenal ditolak (400/404/409/428, tidak menggabungkan apa pun)", m1 === 401 && m2 === 403 && [400, 404, 409, 428].includes(m3), m1 + "," + m2 + "," + m3);
const p1 = (await api("GET", "/api/orders/gabung/pratinjau?utama=" + nol + "&duplikat=" + nol, tS)).status;
const k1 = (await api("GET", "/api/orders/" + nol + "/kandidat-duplikat", tS)).status;
rec("pratinjau & kandidat gabung: SALES 403", p1 === 403 && k1 === 403, p1 + "," + k1);
const SAH = new Set([400, 401, 403, 404, 409, 428]);
rec("semua " + tulis.length + " pemanggilan tulis ditolak/galat sebelum menyentuh data: smoke TIDAK menulis data produksi", tulis.length >= 3 && tulis.every((b) => SAH.has(b.status)), tulis.map((b) => b.n + "=" + b.status).join("; "));

// ── Config gerbang (baca-saja) ──
const c0 = (await api("GET", "/api/armada/unit-load/config", null)).status;
rec("config gerbang: tanpa token 401", c0 === 401, String(c0));
if (tD) {
  const cr = await api("GET", "/api/armada/unit-load/config", tD);
  rec("config gerbang: mode server = mode dari env container (" + ENV_MODE + "); rilis ini tidak mengubah env", cr.status === 200 && cr.json?.mode === ENV_MODE, JSON.stringify(cr.json));
  console.log("  INFO  mode gerbang muat unit di produksi: " + cr.json?.mode + " (klien tanpa header X-Capability ditegakkan=" + cr.json?.ditegakkanUntukKlienIni + ")");
} else skip("config gerbang untuk driver", "tidak ada akun DRIVER murni");

// ── Manifest pada daftar job (baca-saja) ──
const lj = await api("GET", "/api/armada/jobs", tA);
const daftar = Array.isArray(lj.json?.jobs) ? lj.json.jobs : (Array.isArray(lj.json) ? lj.json : []);
const dgManifest = daftar.filter((j) => j.manifest);
if (lj.status === 200 && dgManifest.length) {
  const salah = [];
  for (const j of dgManifest) {
    const mf = j.manifest;
    const sumQty = (mf.baris || []).reduce((n, b) => n + b.qty, 0);
    const ok1 = mf.stop === 1 && mf.unit === sumQty && mf.jenisProduk === (mf.baris || []).length && mf.ringkas === "1 stop • " + mf.unit + " unit • " + mf.jenisProduk + " jenis produk";
    const ok2 = mf.muat && mf.muat.total === mf.unit && mf.muat.dimuat === 0 && mf.muat.label === "Barang dimuat 0/" + mf.unit + " unit";
    const ok3 = !/harga|price|nominal|amount|payment|piutang|subtotal/i.test(JSON.stringify(mf));
    if (!(ok1 && ok2 && ok3)) salah.push(j.id.slice(0, 8));
  }
  rec("manifest pada " + dgManifest.length + " job: 1 stop • N unit • M jenis produk konsisten, muat 0/N (belum ada konfirmasi), tanpa harga", salah.length === 0, salah.join(","));
} else skip("manifest pada daftar job", "tidak ada job ber-manifest di daftar default (status " + lj.status + ")");

// ── Dry-run penggabungan (baca-saja): kasus Indra, hanya bila kedua order ada ──
const indra = await prisma.$queryRawUnsafe("select id, \"orderNumber\" from \"Order\" where \"orderNumber\" in ('NEW-11102026-023','NEW-01092026-001')");
const utama = indra.find((o) => o.orderNumber === "NEW-11102026-023");
const lama = indra.find((o) => o.orderNumber === "NEW-01092026-001");
if (utama && lama) {
  const pr = await api("GET", "/api/orders/gabung/pratinjau?utama=" + utama.id + "&duplikat=" + lama.id, tA);
  const kode = (pr.json?.hambatan || []).map((h) => h.kode).join(",");
  console.log("  INFO  dry-run Indra: bolehDigabung=" + pr.json?.bolehDigabung + " hambatan=[" + kode + "] peringatan=" + (pr.json?.peringatan || []).length);
  rec("dry-run Indra (baca-saja): dua order transaksi BERBEDA → penggabungan TIDAK diizinkan oleh mesin (bolehDigabung=false)", pr.status === 200 && pr.json?.bolehDigabung === false, JSON.stringify({ s: pr.status, b: pr.json?.bolehDigabung, kode }));
} else skip("dry-run Indra", "salah satu order (NEW-11102026-023 / NEW-01092026-001) tidak ditemukan");

// ── Invarian ──
rec("tabel baru KOSONG setelah smoke (order_merges, job_unit_loads) dan tidak ada order bertanda digabung", (await hitungSql("select ((select count(*) from order_merges) + (select count(*) from job_unit_loads) + (select count(*) from \"Order\" where merged_into_order_id is not null))::int n")) === 0);
rec("jumlah Order & Job tidak berubah oleh rilis (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + "; boleh bertambah oleh transaksi sah, tidak berkurang)", (await hitungSql("select count(*)::int n from \"Order\"")) >= B("ORDER_N") && (await hitungSql("select count(*)::int n from jobs")) >= B("JOB_N"));
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
  ok "smoke test lulus (izin, penolakan sebelum menyentuh data, config gerbang, manifest, dry-run penggabungan, invarian)"
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
say "TINDAK LANJUT OWNER: data lama TIDAK berubah; gerbang konfirmasi muat tetap MATI (env DELIVERY_UNIT_CONFIRM_REQUIRED tidak disentuh). Menyalakan = langkah TERPISAH setelah OTA RN terbit: mode capable dulu, pantau sinyal UNIT_LOAD_LEGACY_CLIENT, baru strict — lihat docs/DELIVERY-MANIFEST-GABUNG-ORDER.md. Penggabungan order Indra TIDAK diterapkan."
