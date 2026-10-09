#!/usr/bin/env bash
# RILIS "SINKRONISASI PENJUALAN KARYAWAN → ORDER CRM → UNIT PRODUKSI → DELIVERY": web + backend + 2 migrasi ADITIF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   20261031090000_penjualan_karyawan_order_crm : 2 kolom nullable di "Order" + indeks unik + FK + 1 FUNGSI pengaman + 5 TRIGGER pengaman (tolak posting customer untuk order PKR)
#   20261031100000_customer_profil_karyawan     : 1 kolom nullable di "Customer" + indeks unik + FK (profil internal per karyawan)
# TANPA default, TANPA backfill/UPDATE/DELETE: order, pelanggan, pembayaran, jurnal, PKR yang sudah ada TIDAK berubah. PKR lama TIDAK dibuatkan order otomatis (aksi eksplisit per dokumen oleh Finance).
# Produksi: TIDAK ADA PKR/order/pelanggan/transaksi QA; verifikasi hanya baca + penolakan izin. Uji perilaku trigger dijalankan di DB REHEARSAL (hasil restore backup), bukan di produksi.
#
#   cat scripts/release-penjualan-karyawan-order-crm.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/pkroc1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/pkroc1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pkroc1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/pkroc1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/penjualan-karyawan-order-crm}"
# Migrasi aditif yang SUDAH diaudit: nama → sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
declare -a MIGRASI=("20261031090000_penjualan_karyawan_order_crm" "20261031100000_customer_profil_karyawan")
declare -A MIGRASI_SHA=( ["20261031090000_penjualan_karyawan_order_crm"]="43e75335d6ba266a14f89329668fa5d00c5786587ff08f5ee40900285c05f890" ["20261031100000_customer_profil_karyawan"]="ff319cd8a43465ec7bd0170a9a460ab1b4d36846696271364f49c8f9888074b9" )
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(CLAUDE\.md|backend/prisma/migrations/20261031090000_penjualan_karyawan_order_crm/migration\.sql|backend/prisma/migrations/20261031100000_customer_profil_karyawan/migration\.sql|backend/prisma/schema\.prisma|backend/src/lib/activityLog\.js|backend/src/lib/domain/pkrSpesifikasi\.js|backend/src/lib/domain/productionRencana\.js|backend/src/mcp/tools\.js|backend/src/routes/analytics\.js|backend/src/routes/armada\.js|backend/src/routes/financePenjualanKaryawan\.js|backend/src/routes/orders\.js|backend/src/routes/pipeline\.js|backend/src/routes/production\.js|backend/src/routes/units\.js|backend/src/services/deliveryHandoff\.js|backend/src/services/finance/piutangDiagnosis\.js|backend/src/services/finance/posting/orderRevenue\.js|backend/src/services/finance/rekonsiliasi2026\.js|backend/src/services/finance/transaksi\.js|backend/src/services/invoice\.js|backend/src/services/orderCreation\.js|backend/src/services/penjualanKaryawanOrder\.js|backend/src/services/pkrGuard\.js|backend/src/services/pkrProduksiGuard\.js|backend/src/services/productionBacklog\.js|backend/src/services/productionExperienceReadService\.js|backend/src/services/productionPlanningCommandService\.js|backend/src/services/productionRencanaService\.js|backend/src/services/productionUnitOverviewService\.js|backend/src/services/productionWorkshopExecutionCommandService\.js|backend/src/services/salesReminderDigestJob\.js|backend/src/services/unitStageEngine\.js|backend/tests/integration/penjualanKaryawanManual\.integration\.test\.js|backend/tests/integration/penjualanKaryawanOrderCrm\.integration\.test\.js|backend/tests/integration/penjualanKaryawanOrderCrmFinal\.integration\.test\.js|frontend/src/api\.js|frontend/src/features/armada/components/JobDetailDrawer\.jsx|frontend/src/features/finance/PkrOrderCrm\.jsx|frontend/src/features/finance/detailSpecs\.js|frontend/src/features/finance/pkrOrderCrmLogic\.js|frontend/src/features/production/BacklogCard\.jsx|frontend/src/features/production/PkrRujukan\.jsx|frontend/src/features/production/PlanCard\.jsx|frontend/src/features/production/UnitCard\.jsx|frontend/src/features/production/UnitOrderFallback\.jsx|frontend/src/features/production/UnitOverviewDrawer\.jsx|frontend/src/features/production/pkrRujukanModel\.js|frontend/src/features/production/v1Source\.jsx|frontend/src/pages/Orders\.jsx|frontend/src/pages/bengkel/ProductionOrders\.jsx|frontend/src/pages/bengkel/ProductionPlannerV2\.jsx|frontend/src/pages/bengkel/ProductionWorkOrders\.jsx|frontend/src/pages/finance/FinancePenjualanKaryawan\.jsx|frontend/tests/penjualanKaryawanManualUi\.test\.js|frontend/tests/pkrOrderCrmUI\.test\.js|frontend/tests/pkrRujukanProduksi\.test\.js|scripts/release-penjualan-karyawan-order-crm\.sh)$'
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
BK_DIR="$HOME/release-backups/pkroc-${DEPLOY_SHORT}-${TS}"
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
Migrasi hanya MENAMBAH kolom nullable + indeks/FK + fungsi/trigger pengaman: rollback kode aman tanpa memulihkan database SELAMA belum ada order Penjualan Karyawan.
PERINGATAN rollback KODE setelah ada order PKR (cek: select count(*) from "Order" where penjualan_karyawan_id is not null;): kode lama memperlakukan order itu sebagai order biasa bernilai 0 —
pengakuan pendapatan saat 'diserahkan' dapat memunculkan catatan celah posting (NILAI_ORDER_NOL) dan invoice/pembayaran biasa tidak lagi dijaga aplikasi (trigger DB TETAP menolak posting customer).
Jangan rollback kode dalam keadaan itu; batalkan/tutup order PKR yang berjalan lebih dulu atau perbaiki maju. Order PKR dan profil Customer karyawan tidak dihapus oleh rollback.
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
exec 9>/tmp/release-penjualan-karyawan-order-crm.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rpk\|rpm\|rpl\|rbr\|rpo\|sku1\|tau2\|pkroc1\|release-penjualan-karyawan\|release-bank-rekon\|release-po-bahan-baku\|release-po-sku-baru\|pgrep\|node src/index.js" || true)"
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
ALLOWED_ALL="$ALLOWED_RE"; [ -z "${EXTRA_ALLOWED_RE:-}" ] || ALLOWED_ALL="${ALLOWED_RE}|${EXTRA_ALLOWED_RE}"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_ALL" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
# frontend/dist TIDAK boleh ikut commit: rilis ini MEMBANGUN frontend di release dir (langkah 4b). Berkas dist di kandidat = berhenti.
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
EXPECT_PRISMA="$( { printf 'backend/prisma/schema.prisma\n'; for m in "${MIGRASI[@]}"; do printf 'backend/prisma/migrations/%s/migration.sql\n' "$m"; done; } | LC_ALL=C sort)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$EXPECT_PRISMA" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat schema.prisma + 2 migrasi PKR"; }
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
// Pemindai migrasi "Penjualan Karyawan → Order CRM" (dijalankan di VPS oleh skrip rilis; juga dijalankan lokal terhadap berkas migrasi). FAIL-CLOSED, daftar putih per pernyataan.
//  (a) SATU fungsi plpgsql fn_tolak_keuangan_order_pkr (blok dollar-quoted): badan HANYA membaca (tanpa INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/CREATE/EXECUTE/PERFORM di luar literal string),
//  (b) LIMA trigger BEFORE INSERT OR UPDATE OF <kolom order> pada payments / invoices / fin_journal_lines / fin_payment_allocations / OrderItem yang memanggil fungsi itu,
//  (c) ALTER TABLE "Order" ADD COLUMN penjualan_karyawan_id UUID + pkr_perlu_dikirim BOOLEAN (nullable, tanpa default), indeks unik + FK RESTRICT ke fin_penjualan_karyawan,
//  (d) ALTER TABLE "Customer" ADD COLUMN staff_user_id TEXT (nullable, tanpa default), indeks unik + FK RESTRICT ke "User".
// Tidak ada DROP/UPDATE/INSERT/DELETE/ALTER COLUMN/TRUNCATE/RENAME di luar badan fungsi yang diperiksa.
import fs from "node:fs";
let sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const hitung = {};
const tambah = (k) => { hitung[k] = (hitung[k] ?? 0) + 1; };
const gagal = (m) => { console.error(m); process.exit(1); };
const FN_RE = /CREATE FUNCTION fn_tolak_keuangan_order_pkr\(\) RETURNS trigger AS \$fn\$([\s\S]*?)\$fn\$ LANGUAGE plpgsql;/g;
const fungsi = [...sql.matchAll(FN_RE)];
if (fungsi.length !== 1) gagal(`jumlah fungsi fn_tolak_keuangan_order_pkr harus tepat 1 (ditemukan ${fungsi.length})`);
const badan = fungsi[0][1].replace(/'(?:[^']|'')*'/g, "''");
if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXECUTE|PERFORM|GRANT|REVOKE|COPY)\b/i.test(badan)) gagal("badan fungsi memuat perintah menulis/DDL di luar daftar putih");
if (/\$[a-z_]*\$/i.test(badan)) gagal("badan fungsi memuat dollar-quote bersarang");
tambah("fungsi");
sql = sql.replace(FN_RE, "");
const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
const PASANGAN = { payments: "order_id", invoices: "order_id", fin_journal_lines: "order_id", fin_payment_allocations: "order_id", OrderItem: '"orderId"' };
const triggerTabel = new Set();
for (const st of stmts) {
  const r = rapat(st);
  let m;
  if (r === 'ALTER TABLE "Order" ADD COLUMN "penjualan_karyawan_id" UUID, ADD COLUMN "pkr_perlu_dikirim" BOOLEAN') { tambah("alter_order"); continue; }
  if (r === 'CREATE UNIQUE INDEX "Order_penjualan_karyawan_id_key" ON "Order"("penjualan_karyawan_id")') { tambah("indeks"); continue; }
  if (r === 'ALTER TABLE "Order" ADD CONSTRAINT "Order_penjualan_karyawan_id_fkey" FOREIGN KEY ("penjualan_karyawan_id") REFERENCES "fin_penjualan_karyawan"("id") ON DELETE RESTRICT ON UPDATE CASCADE') { tambah("fk"); continue; }
  if (r === 'ALTER TABLE "Customer" ADD COLUMN "staff_user_id" TEXT') { tambah("alter_customer"); continue; }
  if (r === 'CREATE UNIQUE INDEX "Customer_staff_user_id_key" ON "Customer"("staff_user_id")') { tambah("indeks"); continue; }
  if (r === 'ALTER TABLE "Customer" ADD CONSTRAINT "Customer_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE') { tambah("fk"); continue; }
  if ((m = /^CREATE TRIGGER trg_[a-z_]+_tolak_order_pkr BEFORE INSERT OR UPDATE OF (order_id|"orderId") ON "(payments|invoices|fin_journal_lines|fin_payment_allocations|OrderItem)" FOR EACH ROW EXECUTE FUNCTION fn_tolak_keuangan_order_pkr\(\)$/.exec(r))) {
    if (PASANGAN[m[2]] !== m[1]) gagal(`kolom trigger tidak cocok untuk tabel ${m[2]}: ${m[1]}`);
    if (triggerTabel.has(m[2])) gagal(`trigger ganda untuk tabel ${m[2]}`);
    triggerTabel.add(m[2]); tambah("trigger"); continue;
  }
  gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
}
if (triggerTabel.size !== 5) gagal(`trigger harus tepat 5 tabel, ditemukan ${triggerTabel.size}`);
console.log(JSON.stringify({ total: stmts.length + 1, ...hitung }));
SCANJS
HASIL_SCAN="$(printf '%s' "$ALL_ISI" | node "$BK_DIR/scan-migrasi.mjs")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = '{"total":12,"fungsi":1,"alter_order":1,"indeks":2,"fk":2,"trigger":5,"alter_customer":1}' ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi PKR: DDL aditif (2 ALTER ADD COLUMN nullable = 3 kolom, 2 indeks unik, 2 FK, 1 fungsi pengaman baca-saja, 5 trigger BEFORE INSERT/UPDATE OF order); tanpa DROP/UPDATE/INSERT/DELETE pada tabel lama"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit + 2 migrasi aditif"

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
# Prasyarat skema: tabel PKR (target FK) harus sudah ada; kolom/tabel rilis ini belum boleh ada.
[ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='fin_penjualan_karyawan'")" = "1" ] || die "tabel fin_penjualan_karyawan belum ada di produksi (migrasi PKR manual belum terpasang)"
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and ((table_name='Order' and column_name in ('penjualan_karyawan_id','pkr_perlu_dikirim')) or (table_name='Customer' and column_name='staff_user_id'))")" = "0" ] || die "kolom rilis ini SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_proc where proname='fn_tolak_keuangan_order_pkr'")" = "0" ] || die "fungsi pengaman SUDAH ada di produksi (tidak diharapkan)"
GATE_SEBELUM="$(psql_live -At -c "select coalesce((select value from fin_settings where key='klaim_lunas_gate_aktif'),'false')")"
LAPDIV_SEBELUM="$(psql_live -At -c "select coalesce((select value from fin_settings where key='laporan_divisi_aktif'),'')")"
STAFF_SEBELUM="$(psql_live -At -c "select count(*) from \"Order\" where staff_seller_id is not null")"
PKR_AKTIF="$(psql_live -At -c "select count(*) from fin_penjualan_karyawan where status='AKTIF'")"
ok "order bertanda Penjualan Karyawan lama (staff_seller_id) = ${STAFF_SEBELUM}; dokumen PKR Finance aktif = ${PKR_AKTIF} (TIDAK dibuatkan order otomatis)"
ok "sakelar klaim_lunas_gate_aktif sebelum rilis = ${GATE_SEBELUM} (harus tidak berubah); laporan_divisi_aktif = '${LAPDIV_SEBELUM:-<belum ada>}'"
SNAP_SQL="select 'order_status', count(*), md5(coalesce(string_agg(x.id::text||x.\"paymentStatus\"::text||coalesce(x.paid_at::text,''), '|' order by x.id),'')) from \"Order\" x union all select 'order_nilai', count(*), md5(coalesce(string_agg(x.id::text||x.value::text||x.status::text||coalesce(x.\"customerId\",''), '|' order by x.id),'')) from \"Order\" x union all select 'pelanggan', count(*), md5(coalesce(string_agg(x.id::text||coalesce(x.name,'')||coalesce(x.phone,''), '|' order by x.id),'')) from \"Customer\" x union all select 'unit', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from units x union all select 'job', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from jobs x union all select 'invoice', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from invoices x union all select 'pkr', count(*), md5(coalesce(string_agg(x.id::text||x.nomor||x.status::text||x.total::text, '|' order by x.id),'')) from fin_penjualan_karyawan x union all select 'pkr_bayar', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text||coalesce(x.cancelled_at::text,''), '|' order by x.id),'')) from fin_penjualan_karyawan_payments x union all select 'alokasi', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from fin_payment_allocations x union all select 'verifikasi', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from payment_verifications x union all select 'pengaturan_bool', count(*), md5(coalesce(string_agg(x.key||'='||x.value, '|' order by x.key),'')) from fin_settings x where x.key in ('payment_verification_gate','payment_verification_gate_since','resi_pembayaran_aktif','resi_input_aktif','klaim_lunas_gate_aktif','bank_reconciliation_v2_active') union all select 'jurnal_hash_penuh', count(*), md5(coalesce(string_agg(e.id::text||e.entry_number||e.date::text||e.status::text||e.created_at::text||l.id::text||l.account_id::text||l.debit::text||l.credit::text||coalesce(l.cash_account_id::text,''), '|' order by l.id),'')) from fin_journal_entries e join fin_journal_lines l on l.entry_id=e.id union all select 'rekening_kas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_cash_accounts x union all select 'jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from fin_journal_entries x union all select 'baris_jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.debit::text||x.credit::text, '|' order by x.id),'')) from fin_journal_lines x union all select 'payment', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from payments x union all select 'flag_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from v2_feature_flags x union all select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text||coalesce(x.unit_cost::text,'')||x.material_id::text||x.type::text, '|' order by x.id),'')) from stock_movements x union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(a.account_id::text||':'||a.d::text||':'||a.k::text, '|' order by a.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) k from fin_journal_lines l group by l.account_id) a"
psql_live -At -c "$SNAP_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "snapshot data sebelum gagal"
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
BACKUP_FILE="$HOME/backups/pre-pkroc-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s2 in "Mutasi & Rekonsiliasi" "Impor rekening koran" "Cocokkan otomatis" "Selisih belum dijelaskan" "Penyelesaian periode" "Pencocokan & pengecualian aktif" "Pengecualian Tanggal Lunas" "Penjualan Karyawan (di luar tim Sales)" "Catat Penjualan Karyawan"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur: $s2"; done
for s3 in "Jadwal & Aging" "Total Utang Aktif" "Tanggal jatuh tempo" "Ganti termin" "Tanpa Jatuh Tempo" "Pratinjau PDF" "Unduh PDF" "Buat Barang Baru" "Periksa & pakai di PO"; do [ -n "$(grep -lF "$s3" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN fitur live (termin/PDF/SKU PO): $s3"; done
for s4 in "Buat/Tautkan Order CRM" "Lengkapi spesifikasi order" "Order untuk Produksi dan Delivery" "Perlu dilengkapi" "Penjualan Karyawan" "Ambil sendiri"; do [ -n "$(grep -lF "$s4" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur PKR→Order CRM: $s4"; done
if [ "$NEW_INDEX" = "$PREV_INDEX" ]; then
  ! sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | grep -q '^frontend/' || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
  ok "dist identik (${NEW_INDEX}) — wajar: rilis ini tidak mengubah frontend"
else
  ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX})"
fi

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-pkroc-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan 2 migrasi dengan image baru, uji perilaku trigger, verifikasi, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_pkroc_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
KUNCI_TABEL='"Order" "Customer" payments invoices "OrderItem" fin_journal_entries fin_journal_lines fin_payment_allocations units jobs fin_penjualan_karyawan fin_penjualan_karyawan_payments fin_penjualan_karyawan_items stock_movements fin_supplier_bills fin_purchase_orders'
for T in $KUNCI_TABEL; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$A" = "$B" ] || { reh_drop; die "restore rehearsal tidak identik untuk $T (produksi=$A restore=$B) — backup/restore bermasalah"; }
done
ok "restore nyata identik (jumlah baris) untuk 16 tabel kunci"
FP_SQL="select 'order', count(*), md5(coalesce(string_agg(x.id::text||x.value::text||x.status::text||x.\"paymentStatus\"::text||coalesce(x.\"customerId\",'')||coalesce(x.paid_at::text,''), '|' order by x.id),'')) from \"Order\" x union all select 'pelanggan', count(*), md5(coalesce(string_agg(x.id::text||coalesce(x.name,'')||coalesce(x.phone,''), '|' order by x.id),'')) from \"Customer\" x union all select 'order_item', count(*), md5(coalesce(string_agg(x.id::text||x.harga::text, '|' order by x.id),'')) from \"OrderItem\" x union all select 'payment', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text||x.order_id, '|' order by x.id),'')) from payments x union all select 'invoice', count(*), md5(coalesce(string_agg(x.id::text||x.order_id, '|' order by x.id),'')) from invoices x union all select 'alokasi', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text||x.order_id, '|' order by x.id),'')) from fin_payment_allocations x union all select 'unit', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from units x union all select 'job', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from jobs x union all select 'pkr', count(*), md5(coalesce(string_agg(x.id::text||x.nomor||x.status::text||x.total::text, '|' order by x.id),'')) from fin_penjualan_karyawan x union all select 'pkr_bayar', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from fin_penjualan_karyawan_payments x union all select 'jurnal_penuh', count(*), md5(coalesce(string_agg(l.id::text||l.entry_id::text||l.account_id::text||l.debit::text||l.credit::text||coalesce(l.order_id,''), '|' order by l.id),'')) from fin_journal_lines l union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(a.account_id::text||':'||a.d::text||':'||a.k::text, '|' order by a.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) k from fin_journal_lines l group by l.account_id) a"
psql_live -At -c "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod.txt" || { reh_drop; die "sidik jari produksi gagal"; }
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sebelum.txt" || { reh_drop; die "sidik jari rehearsal gagal"; }
cmp -s "$BK_DIR/fp-prod.txt" "$BK_DIR/fp-reh-sebelum.txt" || { diff "$BK_DIR/fp-prod.txt" "$BK_DIR/fp-reh-sebelum.txt" || true; reh_drop; die "isi hasil restore BERBEDA dari produksi (sidik jari)"; }
ok "restore nyata identik (sidik jari order, pelanggan, item, payment, invoice, alokasi, unit, job, PKR, pembayaran PKR, jurnal, saldo per akun)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$REH_PEND" = "$(printf '%s\n' "${MIGRASI[@]}" | LC_ALL=C sort)" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat 2 migrasi PKR: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy pada DB rehearsal GAGAL"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
for KB in 'Order.penjualan_karyawan_id' 'Order.pkr_perlu_dikirim' 'Customer.staff_user_id'; do
  TB="${KB%%.*}"; KL="${KB##*.}"
  [ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='$TB' and column_name='$KL' and is_nullable='YES' and column_default is null")" = "1" ] || { reh_drop; die "kolom baru $KB tidak ada / tidak nullable / punya default"; }
  [ "$(RPSQL "select count(*) from \"$TB\" where $KL is not null")" = "0" ] || { reh_drop; die "kolom baru $KB TIDAK kosong setelah migrasi (tidak boleh ada backfill)"; }
done
ok "3 kolom baru: ada, nullable, tanpa default, SELURUHNYA kosong pada semua baris lama (tanpa backfill; tidak ada order/profil dibuat)"
[ "$(RPSQL "select count(*) from pg_indexes where schemaname='public' and indexname in ('Order_penjualan_karyawan_id_key','Customer_staff_user_id_key') and indexdef like 'CREATE UNIQUE INDEX%'")" = "2" ] || { reh_drop; die "indeks unik 1:1 / satu-profil-per-karyawan tidak lengkap"; }
[ "$(RPSQL "select count(*) from pg_constraint where conname in ('Order_penjualan_karyawan_id_fkey','Customer_staff_user_id_fkey')")" = "2" ] || { reh_drop; die "FK baru tidak lengkap"; }
[ "$(RPSQL "select count(*) from pg_proc where proname='fn_tolak_keuangan_order_pkr'")" = "1" ] || { reh_drop; die "fungsi pengaman tidak ada tepat satu"; }
[ "$(RPSQL "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname like 'trg_%_tolak_order_pkr' and not t.tgisinternal and c.relname in ('payments','invoices','fin_journal_lines','fin_payment_allocations','OrderItem')")" = "5" ] || { reh_drop; die "trigger pengaman tidak tepat 5 pada 5 tabel yang benar"; }
ok "indeks unik, FK, fungsi pengaman, dan 5 trigger terpasang di DB rehearsal"
# UJI PERILAKU TRIGGER (hanya DB rehearsal, dibatalkan di akhir): posting customer ke order PKR ditolak; jurnal resmi PKR/biaya operasional dan order biasa lolos.
cat > "$BK_DIR/uji-trigger.sql" <<'TRIGSQL'
DO $t$
DECLARE
  o text; pid uuid := gen_random_uuid(); x text;
  tolak int := 0; lolos int := 0; lewat int := 0;
BEGIN
  SELECT id INTO o FROM "Order" ORDER BY id LIMIT 1;
  IF o IS NULL THEN RAISE EXCEPTION 'TIDAK_ADA_ORDER'; END IF;
  INSERT INTO fin_penjualan_karyawan (id, nomor, date, seller_id, buyer_name, total, updated_at) VALUES (pid, 'PKR-UJI-REHEARSAL', current_date, (SELECT id FROM "User" ORDER BY id LIMIT 1), 'uji', 1, now());
  UPDATE "Order" SET penjualan_karyawan_id = pid WHERE id = o; -- order uji = order PKR
  -- (1) payments: pindahkan pembayaran order lain ke order PKR -> HARUS ditolak
  SELECT id::text INTO x FROM payments WHERE order_id <> o LIMIT 1;
  IF x IS NULL THEN lewat := lewat + 1; ELSE
    BEGIN UPDATE payments SET order_id = o WHERE id = x::uuid; RAISE EXCEPTION 'TIDAK_DITOLAK_payments';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  END IF;
  -- (2) invoices
  SELECT id::text INTO x FROM invoices WHERE order_id <> o LIMIT 1;
  IF x IS NULL THEN lewat := lewat + 1; ELSE
    BEGIN UPDATE invoices SET order_id = o WHERE id = x; RAISE EXCEPTION 'TIDAK_DITOLAK_invoices';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  END IF;
  -- (3) OrderItem
  SELECT id INTO x FROM "OrderItem" WHERE "orderId" <> o LIMIT 1;
  IF x IS NULL THEN lewat := lewat + 1; ELSE
    BEGIN UPDATE "OrderItem" SET "orderId" = o WHERE id = x; RAISE EXCEPTION 'TIDAK_DITOLAK_orderitem';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  END IF;
  -- (4) alokasi pembayaran
  SELECT id::text INTO x FROM fin_payment_allocations WHERE order_id <> o LIMIT 1;
  IF x IS NULL THEN lewat := lewat + 1; ELSE
    BEGIN UPDATE fin_payment_allocations SET order_id = o WHERE id = x::uuid; RAISE EXCEPTION 'TIDAK_DITOLAK_alokasi';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  END IF;
  -- (5) baris jurnal: posting customer (PEMBAYARAN_ORDER) ditolak
  SELECT l.id::text INTO x FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id = l.entry_id WHERE e.source::text = 'PEMBAYARAN_ORDER' LIMIT 1;
  IF x IS NULL THEN lewat := lewat + 1; ELSE
    BEGIN UPDATE fin_journal_lines SET order_id = o WHERE id = x::uuid; RAISE EXCEPTION 'TIDAK_DITOLAK_jurnal_bayar';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  END IF;
  -- (6) biaya operasional bertanda order PKR LOLOS (dimensi analitik); jurnal resmi PKR (sumber PENJUALAN_KARYAWAN) juga lolos
  SELECT l.id::text INTO x FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id = l.entry_id WHERE e.source::text = 'PENGELUARAN' LIMIT 1;
  IF x IS NULL THEN lewat := lewat + 1; ELSE
    BEGIN UPDATE fin_journal_lines SET order_id = o WHERE id = x::uuid; lolos := lolos + 1;
    EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'BIAYA_DITOLAK'; END;
  END IF;
  SELECT l.id::text INTO x FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id = l.entry_id WHERE e.source::text = 'PENJUALAN_KARYAWAN' LIMIT 1;
  IF x IS NOT NULL THEN
    BEGIN UPDATE fin_journal_lines SET order_id = o WHERE id = x::uuid; lolos := lolos + 1;
    EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'JURNAL_PKR_DITOLAK'; END;
  END IF;
  -- (7) order BIASA tidak terpengaruh: setelah order uji dilepas, memindahkan pembayaran ke order itu lolos
  UPDATE "Order" SET penjualan_karyawan_id = NULL WHERE id = o;
  SELECT id::text INTO x FROM payments WHERE order_id <> o LIMIT 1;
  IF x IS NOT NULL THEN
    BEGIN UPDATE payments SET order_id = o WHERE id = x::uuid; lolos := lolos + 1;
    EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'ORDER_BIASA_DITOLAK'; END;
  END IF;
  RAISE NOTICE 'HASIL tolak=% lolos=% lewat=%', tolak, lolos, lewat;
  RAISE EXCEPTION 'ROLLBACK_UJI';
END $t$;
TRIGSQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-trigger.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-trigger.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku trigger tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK|BIAYA_DITOLAK|JURNAL_PKR_DITOLAK|ORDER_BIASA_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku trigger SALAH (ada posting customer yang lolos, atau biaya/jurnal PKR/order biasa yang ditolak)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*HASIL tolak=\([0-9]*\) lolos=\([0-9]*\) lewat=\([0-9]*\).*/\1/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 3 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji trigger terlalu sedikit penolakan terbukti (${UJI_TOLAK:-?}) — data contoh produksi tidak cukup atau trigger tidak aktif"; }
ok "perilaku trigger terbukti di DB rehearsal: $(printf '%s\n' "$UJI_OUT" | sed -n 's/.*HASIL \(.*\)/\1/p' | sed -n 1p) — posting customer ke order PKR ditolak; biaya operasional, jurnal resmi PKR, dan order biasa lolos; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
for T in $KUNCI_TABEL; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$A" = "$B" ] || { reh_drop; die "jumlah baris $T berubah oleh migrasi rehearsal (produksi=$A rehearsal=$B)"; }
done
reh_drop
ok "rehearsal lulus: isi order/pelanggan/item/payment/invoice/alokasi/unit/job/PKR/jurnal/saldo IDENTIK sebelum vs sesudah migrasi + uji trigger; 3 kolom baru kosong (tanpa backfill); DB sementara dihapus"

PHASE="6-migrate"; say "6. Migrasi aditif PKR → Order CRM (image baru; backend lama tetap melayani)"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
for m in "${MIGRASI[@]}"; do grep -Fx "$m" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${m} SUDAH terpasang sebelum rilis (tidak diharapkan)"; done
PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") || true)"
[ "$PENDING" = "$(printf '%s\n' "${MIGRASI[@]}" | LC_ALL=C sort)" ] || die "migrasi pending bukan tepat 2 migrasi PKR: $(printf '%s' "$PENDING" | tr '\n' ' ')"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
for m in "${MIGRASI[@]}"; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 2 ))" ] || die "jumlah migrasi terpasang != sebelum + 2"
ok "migrasi diterapkan: 2 migrasi PKR; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"

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
[ "$NBE" -ge 10 ] || die "terlalu sedikit berkas backend yang diverifikasi (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
[ "$(PSQLN "select count(*) from information_schema.columns where table_schema='public' and ((table_name='Order' and column_name in ('penjualan_karyawan_id','pkr_perlu_dikirim')) or (table_name='Customer' and column_name='staff_user_id'))")" = "3" ] || die "kolom PKR→Order CRM tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname like 'trg_%_tolak_order_pkr' and not t.tgisinternal and c.relname in ('payments','invoices','fin_journal_lines','fin_payment_allocations','OrderItem')")" = "5" ] || die "trigger pengaman tidak 5 setelah rilis"
[ "$(PSQLN "select count(*) from \"Order\" where penjualan_karyawan_id is not null or pkr_perlu_dikirim is not null")" = "0" ] || die "ADA order tertaut PKR setelah rilis (backfill tidak diizinkan)"
[ "$(PSQLN "select count(*) from \"Customer\" where staff_user_id is not null")" = "0" ] || die "ADA profil karyawan terisi setelah rilis (backfill tidak diizinkan)"
ok "kolom & trigger ada; TIDAK ada order tertaut PKR dan TIDAK ada profil Customer karyawan (tanpa backfill)"
PHASE="8b-smoke"; say "8b. Smoke test izin + pembacaan (baca-saja; TIDAK ada PKR/order/pelanggan/transaksi QA di produksi)"
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
  return { status: r.status, json };
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
if (!adm || !sales) { rec("akun ADMIN & SALES murni tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales), tP = prod ? await tokenUntuk(prod) : null;
const nol = "00000000-0000-4000-8000-000000000000";
const cacah = async () => [await prisma.order.count(), await prisma.customer.count(), await prisma.unit.count(), await prisma.job.count(), await prisma.invoice.count(), await prisma.payment.count(), await prisma.finJournalEntry.count(), await prisma.finJournalLine.count(), await prisma.finPenjualanKaryawan.count(), await prisma.activityEvent.count({ where: { eventType: "PKR_ORDER_SINKRON" } })];
const sebelum = await cacah();
const U = "/api/finance/penjualan-karyawan";

rec("dry-run order CRM: tanpa token -> 401", (await api("GET", `${U}/order-crm/dry-run`)).status === 401);
rec("buat order CRM: tanpa token -> 401", (await api("POST", `${U}/${nol}/order-crm`)).status === 401);
for (const [nama, t] of [["SALES", tS], ["PRODUCTION_LEAD", tP]]) {
  if (!t) continue;
  rec(`dry-run order CRM: ${nama} -> 403`, (await api("GET", `${U}/order-crm/dry-run`, t)).status === 403);
  rec(`buat order CRM: ${nama} -> 403`, (await api("POST", `${U}/${nol}/order-crm`, t, { spesifikasi: {} })).status === 403);
  rec(`lengkapi order CRM: ${nama} -> 403`, (await api("PUT", `${U}/${nol}/order-crm`, t, { merk: "x" })).status === 403);
}
const dry = await api("GET", `${U}/order-crm/dry-run`, tA);
const aktif = await prisma.finPenjualanKaryawan.count({ where: { status: "AKTIF" } });
rec("dry-run (admin) -> 200, jumlah = PKR aktif (semua belum punya order) dan TIDAK menulis apa pun", dry.status === 200 && dry.json?.jumlah === aktif, `${dry.json?.jumlah} dari ${aktif} PKR aktif`);
const daftar = await api("GET", U, tA);
rec("daftar PKR (admin) -> 200; sinkron.order kosong untuk semua PKR lama", daftar.status === 200 && Array.isArray(daftar.json?.penjualan) && daftar.json.penjualan.every((p) => !p.sinkron?.order), `${daftar.json?.penjualan?.length} dokumen`);
const nolPut = await api("PUT", `${U}/${nol}/order-crm`, tA, { merk: "x" });
rec("lengkapi order CRM id tak dikenal (admin) -> 404", nolPut.status === 404 || nolPut.status === 400, String(nolPut.status));
if (tP) {
  const bl = await api("GET", "/api/production-v2/backlog?pageSize=50", tP);
  rec("backlog Rencana Produksi -> 200; semua kartu tanpa rujukan PKR (belum ada order PKR)", bl.status === 200 && bl.json?.items?.every((i) => i.card?.penjualanKaryawan === null), `${bl.json?.items?.length} kartu`);
  const wo = await api("GET", "/api/production/work-orders?displayStatus=DIPROSES&pageSize=50", tP);
  rec("daftar Work Order -> 200; semua unit tanpa rujukan PKR", wo.status === 200 && wo.json?.units?.every((u) => u.penjualanKaryawan === null), `${wo.json?.units?.length} unit`);
}
const ord = await api("GET", "/api/orders?limit=20", tA);
rec("daftar order CRM -> 200; tidak ada order tertaut PKR", ord.status === 200 && ord.json?.items?.every((o) => !o.penjualanKaryawan), `${ord.json?.items?.length} order`);
const sesudah = await cacah();
rec("tidak ada order/pelanggan/unit/job/invoice/payment/jurnal/PKR/audit yang berubah selama smoke", sebelum.every((n, i) => n === sesudah[i]), `${sebelum.join(",")} -> ${sesudah.join(",")}`);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus (izin, dry-run baca-saja, daftar PKR tanpa order, daftar Produksi tanpa rujukan, tidak ada data berubah)"
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
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$SNAP_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/data-sesudah.txt" || die "snapshot data sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "data berubah selama rilis (order/pelanggan/jurnal/payment/flag) — periksa (transaksi pengguna yang sah juga bisa menyebabkan ini)"; }
ok "order, pelanggan, unit, job, invoice, PKR, jurnal, saldo, payment, stok, dan flag Production V2 IDENTIK sebelum vs sesudah rilis"
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
