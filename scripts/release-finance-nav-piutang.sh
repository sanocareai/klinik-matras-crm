#!/usr/bin/env bash
# RILIS "NAVIGASI FINANCE (10 HUB) + PIUTANG & REFUND": web + backend, TANPA migrasi, TANPA perubahan data — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
# Isi: sidebar Finance 10 hub (lib/financeHubs.js), bilah tab hub, judul/breadcrumb berbahasa Indonesia, layar Piutang & Refund bertab + drawer detail, label "Posisi per <tanggal> (WIB)",
# kategori Perlu Tindakan "Tanggal lunas berbeda dari tanggal pembayaran yang melunasi" (read-model server, satu order = satu entri), endpoint baca detail order piutang.
# Rilis ini hanya KODE + field respons AKTIF-TAMBAHAN: tidak mengubah angka lama, jurnal, saldo, rumus, Order.paidAt, Payment, akun, role, setting, atau data apa pun.
#
#   cat scripts/release-finance-nav-piutang.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/fnp1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/fnp1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/fnp1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/fnp1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/finance-nav-hub-piutang}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/src/routes/finance\.js|backend/src/services/finance/export/piutang-refund\.js|backend/src/services/finance/piutangDetail\.js|backend/src/services/finance/piutangDiagnosis\.js|backend/src/services/finance/piutangTanggalLunas\.js|backend/src/services/finance/reports\.js|backend/tests/integration/piutangDiagnosis\.integration\.test\.js|docs/FINANCE-NAV-HUB\.md|frontend/src/api\.js|frontend/src/components/Layout\.jsx|frontend/src/components/SidebarNavSection\.jsx|frontend/src/components/Topbar\.jsx|frontend/src/features/finance/DiagnosisPiutang\.jsx|frontend/src/features/finance/FinanceHubFrame\.jsx|frontend/src/features/finance/PanelDetail\.jsx|frontend/src/features/finance/PiutangDetail\.jsx|frontend/src/features/finance/piutangLogic\.js|frontend/src/lib/financeAntrean\.js|frontend/src/lib/financeHubs\.js|frontend/src/lib/sidebarActive\.js|frontend/src/lib/tabTitles\.js|frontend/src/lib/useUrlTab\.js|frontend/src/pages/finance/FinanceCash\.jsx|frontend/src/pages/finance/FinancePayments\.jsx|frontend/src/pages/finance/FinanceReceivables\.jsx|frontend/src/pages/finance/FinanceSuppliers\.jsx|frontend/src/routes/pageRegistry\.jsx|frontend/tests/biayaBahanUI\.test\.js|frontend/tests/diagnosisPiutangLogic\.test\.js|frontend/tests/financeDetailCoverage\.test\.js|frontend/tests/financeHubNav\.test\.js|frontend/tests/pengajuanBiayaWorkspace\.test\.js|frontend/tests/penjualanKaryawanManualUi\.test\.js|frontend/tests/perluVerifikasiFinance\.test\.js|frontend/tests/persediaanAwal\.test\.js|frontend/tests/piutangRedesign\.test\.js|frontend/tests/purchaseOrderUI\.test\.js|frontend/tests/returSupplierUI\.test\.js|frontend/tests/uangMukaOperasional\.test\.js|scripts/release-finance-nav-piutang\.sh|scripts/release-finance-nav-piutang\.sh)$'
BACKEND_SRC_EXPECT="backend/src/routes/finance.js backend/src/services/finance/export/piutang-refund.js backend/src/services/finance/piutangDetail.js backend/src/services/finance/piutangDiagnosis.js backend/src/services/finance/piutangTanggalLunas.js backend/src/services/finance/reports.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/components/Layout.jsx frontend/src/components/SidebarNavSection.jsx frontend/src/components/Topbar.jsx frontend/src/features/finance/DiagnosisPiutang.jsx frontend/src/features/finance/FinanceHubFrame.jsx frontend/src/features/finance/PanelDetail.jsx frontend/src/features/finance/PiutangDetail.jsx frontend/src/features/finance/piutangLogic.js frontend/src/lib/financeAntrean.js frontend/src/lib/financeHubs.js frontend/src/lib/sidebarActive.js frontend/src/lib/tabTitles.js frontend/src/lib/useUrlTab.js frontend/src/pages/finance/FinanceCash.jsx frontend/src/pages/finance/FinancePayments.jsx frontend/src/pages/finance/FinanceReceivables.jsx frontend/src/pages/finance/FinanceSuppliers.jsx frontend/src/routes/pageRegistry.jsx"
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
BK_DIR="$HOME/release-backups/fnp-${DEPLOY_SHORT}-${TS}"
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
Setelah switch bermasalah (rilis ini TANPA migrasi dan TANPA perubahan data: rollback kode tidak butuh pemulihan database dan aman kapan saja):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
   (web: dist release sebelumnya ada di ${PREV_DIR:-<release-sebelumnya>}/frontend/dist — compose release menunjuk dist release yang berjalan)
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
exec 9>/tmp/release-finance-nav-piutang.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "fnp1\|release-finance-nav-piutang\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan (tanpa migrasi, tanpa dependensi)"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=600 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" "+refs/heads/main:refs/remotes/origin/main" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
# Garis keturunan: kandidat HARUS memuat release aktif (BASE) dan seluruh origin/main — kalau tidak, rilis akan menghilangkan isi yang sudah live.
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}: gabungkan release aktif ke kandidat dulu"
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat ${DEPLOY_SHORT}: rilis akan menghilangkan isi main — gabungkan main ke kandidat dulu"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE '^backend/prisma/' || die "backend/prisma berubah — rilis ini HARUS tanpa migrasi/skema"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE 'production-evidence|receipt-proofs' || die "artefak unggahan/foto uji ikut ter-commit"
# backend/src/index.js dipatok sha-nya oleh tes atribusi: TIDAK boleh disentuh.
! printf '%s\n' "$CHANGED" | grep -qx 'backend/src/index.js' || die "backend/src/index.js berubah (dipatok tes atribusi)"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
NBE_EXPECT="$(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w)"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist; tanpa prisma/dependensi/Docker/index.js; backend/src = ${NBE_EXPECT} berkas"

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
for T in "Order" payments payment_verifications fin_journal_entries fin_journal_lines fin_accounts fin_refunds order_paid_at_pengecualian invoices fin_settings; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and lower(table_name)=lower('$T')")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
PENDING0="$(comm -23 <(sg ls-tree --name-only "${DEPLOY_SHA}:backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null" | LC_ALL=C sort) || true)"
[ -z "$PENDING0" ] || die "ada migrasi tertunda pada kode kandidat (rilis ini harus TANPA migrasi): $(printf '%s' "$PENDING0" | tr '\n' ' ')"
ok "tanpa migrasi: seluruh migrasi kandidat sudah terpasang; tabel yang dipakai ada"

# SIDIK JARI ANGKA FINANCE pada cutoff T0 (jam DB, 5 menit lalu; dokumen/transaksi baru sesudah T0 tidak diperbandingkan). Sebelum vs sesudah rilis harus IDENTIK.
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
VERIF_SQL="$(cat <<VERIF
select 'migrasi_terpasang', count(*), md5(coalesce(string_agg(migration_name, '|' order by migration_name), '')) from _prisma_migrations where finished_at is not null and rolled_back_at is null
union all select 'fin_settings', count(*), md5(coalesce(string_agg(key || '=' || value::text, '|' order by key), '')) from fin_settings
union all select 'akun', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_accounts x
union all select 'jurnal_header', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_journal_entries x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) from fin_journal_lines l where l.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id), '')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'saldo_total', 1, md5(coalesce(sum(l.debit),0)::text || '/' || coalesce(sum(l.credit),0)::text) from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp
union all select 'payment', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from payments x where x.created_at < '$T0'::timestamp
union all select 'payment_verifikasi', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from payment_verifications x where x.created_at < '$T0'::timestamp
union all select 'refund', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_refunds x where x.created_at < '$T0'::timestamp
union all select 'order_paid_at', count(*), md5(coalesce(string_agg(o.id::text || ':' || coalesce(o.paid_at::text, '-') || ':' || o."paymentStatus"::text, '|' order by o.id), '')) from "Order" o where o."createdAt" < '$T0'::timestamp
union all select 'order_nilai', count(*), md5(coalesce(string_agg(o.id::text || ':' || o.value::text || ':' || o.status::text, '|' order by o.id), '')) from "Order" o where o."createdAt" < '$T0'::timestamp
union all select 'pengecualian_tgl_lunas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from order_paid_at_pengecualian x
union all select 'invoice', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from invoices x where x.created_at < '$T0'::timestamp
VERIF
)"
psql_live -At -c "$VERIF_SQL" | LC_ALL=C sort > "$BK_DIR/verif-sebelum.txt" || die "sidik jari angka Finance sebelum gagal"
[ "$(grep -c . "$BK_DIR/verif-sebelum.txt")" = "14" ] || die "sidik jari angka Finance tidak 14 baris ($(grep -c . "$BK_DIR/verif-sebelum.txt"))"
ok "sidik jari angka Finance sebelum rilis tersimpan (14 kunci: jurnal+baris, saldo per akun/total, payment, verifikasi, refund, paidAt/nilai order, pengecualian, invoice, setting, migrasi; T0=${T0} UTC)"

# Pembaca angka Piutang (fungsi SERVER yang sama dengan layar): dijalankan pada kode LAMA dan kode BARU terhadap DB yang SAMA. Kode baru boleh MENAMBAH field; setiap field lama HARUS identik.
cat > "$BK_DIR/piutang.mjs" <<'PIUTANG'
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const imp = (p) => import(pathToFileURL(process.cwd() + "/src/services/finance/" + p).href);
const { umurPiutang } = await imp("reports.js");
const { diagnosisPiutang } = await imp("piutangDiagnosis.js");
const hari = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // posisi = hari ini WIB
const POSISI = ["2026-09-30", hari];
const out = {};
for (const to of POSISI) out[to] = { umur: await umurPiutang(prisma, { to }), diagnosis: await diagnosisPiutang(prisma, { to }) };
await prisma.$disconnect();
console.log(JSON.stringify(out));
PIUTANG
cat > "$BK_DIR/banding-piutang.mjs" <<'BANDING'
import fs from "node:fs";
const lama = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), baru = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
let gagal = 0, dicek = 0, tambahan = 0;
// SUBSET: setiap field di respons LAMA harus ada dan IDENTIK di respons BARU; field yang hanya ada di BARU = tambahan aditif.
function subset(a, b, path) {
  if (a === null || typeof a !== "object") {
    dicek++;
    if (!Object.is(a, b) && JSON.stringify(a) !== JSON.stringify(b)) { if (gagal++ < 15) console.log(`  GAGAL  ${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`); }
    return;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) { if (gagal++ < 15) console.log(`  GAGAL  ${path}: panjang array ${a.length} -> ${Array.isArray(b) ? b.length : typeof b}`); return; }
    a.forEach((x, i) => subset(x, b[i], `${path}[${i}]`));
    return;
  }
  if (b === null || typeof b !== "object") { if (gagal++ < 15) console.log(`  GAGAL  ${path}: objek hilang`); return; }
  for (const k of Object.keys(a)) {
    if (!(k in b)) { if (gagal++ < 15) console.log(`  GAGAL  ${path}.${k}: field lama HILANG di kode baru`); continue; }
    subset(a[k], b[k], `${path}.${k}`);
  }
  for (const k of Object.keys(b)) if (!(k in a)) tambahan++;
}
for (const to of Object.keys(lama)) {
  if (!baru[to]) { gagal++; console.log(`  GAGAL  posisi ${to} tidak ada di kode baru`); continue; }
  subset(lama[to].umur, baru[to].umur, `${to}.umur`);
  // diagnosis: field LAMA identik. `perluTindakan*`/`alasanTindakan` baru (aditif) tidak ada di lama sehingga tidak dibandingkan di sini.
  subset(lama[to].diagnosis, baru[to].diagnosis, `${to}.diagnosis`);
  const o = baru[to].diagnosis;
  const ids = (o.perluTindakanOrder || []).map((e) => e.orderId);
  if (new Set(ids).size !== ids.length) { gagal++; console.log(`  GAGAL  ${to}: perluTindakanOrder memuat order ganda`); }
  if ((o.perluTindakan?.jumlah ?? ids.length) !== ids.length) { gagal++; console.log(`  GAGAL  ${to}: perluTindakan.jumlah ${o.perluTindakan?.jumlah} != order unik ${ids.length}`); }
  const adaDua = (o.perluTindakanOrder || []).filter((e) => (e.alasan || []).length > 1).length;
  console.log(`  ok     posisi ${to}: ${lama[to].umur.baris.length} baris piutang, neraca ${lama[to].diagnosis.neraca}; perlu tindakan ${ids.length} order unik (${adaDua} dengan >1 alasan)`);
}
console.log(`BANDING_HASIL gagal=${gagal} dicek=${dicek} tambahan=${tambahan}`);
process.exit(gagal ? 1 : 0);
BANDING
dcp "$PREV_DIR" exec -T backend node --input-type=module - < "$BK_DIR/piutang.mjs" > "$BK_DIR/piutang-lama-live.json" 2>"$BK_DIR/piutang-lama-live.err" || die "membaca angka Piutang (kode lama, live) gagal: $(head -c 300 "$BK_DIR/piutang-lama-live.err")"
ok "angka Piutang SEBELUM (kode lama, live, baca-saja): $(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Object.entries(j).map(([k,v])=>k+": "+v.umur.baris.length+" baris, total "+v.umur.total+", neraca "+v.diagnosis.neraca).join(" | "))' "$BK_DIR/piutang-lama-live.json")"

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
BACKUP_FILE="$HOME/backups/pre-fnp-${DEPLOY_SHORT}-${TS}.sql.gz"
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

say "4b. Build frontend di release dir SEKALI (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
# Fitur rilis ini + fitur lama (jangan sampai hilang dari bundel).
for s1 in "Penjualan & Piutang" "Posisi per" "Mengapa perlu tindakan" "Tanggal lunas berbeda dari tanggal pembayaran yang melunasi" "Piutang & Refund" "Rekonsiliasi Sales-Finance"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: $s1"; done
for s2 in "Verifikasi Pembayaran" "Retur & Debit Note" "Catat Barang Tiba" "Rencana Produksi" "Status Produksi" "Perlu Verifikasi Finance" "Klaim Lunas dari Sales"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: $s2"; done
# "Hitung Kas" TIDAK boleh tampil sebelum halamannya ada.
[ -z "$(grep -lF "Hitung Kas" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru memuat 'Hitung Kas' (halamannya belum ada)"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + lama ada; 'Hitung Kas' tidak ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-fnp-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara; kode LAMA dan kode BARU membaca DB yang SAMA; angka lama harus identik (hanya field tambahan boleh muncul); DB produksi tidak disentuh"
REH_DB="rehearsal_fnp_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
RPSQL "$VERIF_SQL" | LC_ALL=C sort > "$BK_DIR/verif-reh.txt" || { reh_drop; die "sidik jari rehearsal gagal"; }
cmp -s "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-reh.txt" || { diff "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-reh.txt" || true; reh_drop; die "RESTORE berbeda dari produksi pada sidik jari angka Finance (cutoff T0) — backup/restore bermasalah"; }
ok "restore nyata IDENTIK dengan produksi pada 14 kunci sidik jari angka Finance"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status (image baru, DB restore) tidak 'up to date' — ada migrasi tertunda?"; }
ok "image baru melihat DB restore 'up to date' (tanpa migrasi tertunda)"
# KODE LAMA (container live, DATABASE_URL dialihkan ke DB restore — hanya membaca) vs KODE BARU (image baru) pada DB restore yang sama.
docker exec -i -e DATABASE_URL="$REH_URL" "$CID_OLD" node --input-type=module - < "$BK_DIR/piutang.mjs" > "$BK_DIR/piutang-lama-reh.json" 2>"$BK_DIR/piutang-lama-reh.err" || { reh_drop; die "membaca angka Piutang (kode lama, restore) gagal: $(head -c 400 "$BK_DIR/piutang-lama-reh.err")"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" backend node --input-type=module - < "$BK_DIR/piutang.mjs" > "$BK_DIR/piutang-baru-reh.json" 2>"$BK_DIR/piutang-baru-reh.err" || { reh_drop; die "membaca angka Piutang (kode BARU, restore) gagal: $(head -c 400 "$BK_DIR/piutang-baru-reh.err")"; }
BAND="$(node "$BK_DIR/banding-piutang.mjs" "$BK_DIR/piutang-lama-reh.json" "$BK_DIR/piutang-baru-reh.json")" || { printf '%s\n' "$BAND"; reh_drop; die "angka lama BERUBAH pada kode baru (lihat GAGAL di atas)"; }
printf '%s\n' "$BAND" | grep -v '^BANDING_HASIL'
printf '%s\n' "$BAND" | grep -q '^BANDING_HASIL gagal=0' || { reh_drop; die "ringkasan pembanding tidak ada/gagal"; }
RPSQL "$VERIF_SQL" | LC_ALL=C sort > "$BK_DIR/verif-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/verif-reh.txt" "$BK_DIR/verif-reh-sesudah.txt" || { diff "$BK_DIR/verif-reh.txt" "$BK_DIR/verif-reh-sesudah.txt" || true; reh_drop; die "membaca dengan kode baru MENGUBAH data (tidak boleh)"; }
reh_drop
ok "rehearsal lulus: angka Piutang & Diagnosis lama identik di kode baru; kategori baru tanpa order ganda; data restore tidak berubah; DB sementara dihapus"

PHASE="6-tanpa-migrasi"; say "6. Rilis TANPA migrasi: konfirmasi kandidat, release aktif, dan skema tidak bergeser sebelum switch"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum switch"
[ "$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")" = "${BASE_SHA:0:8}" ] || die "release aktif bukan baseline"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
PENDING1="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null" | LC_ALL=C sort) || true)"
[ -z "$PENDING1" ] || die "ada migrasi tertunda pada release dir (rilis ini harus tanpa migrasi): $(printf '%s' "$PENDING1" | tr '\n' ' ')"
ok "tanpa migrasi; kandidat dan release aktif tidak bergeser"

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
[ "$NBE" = "$NBE_EXPECT" ] || die "berkas backend yang diverifikasi harus tepat ${NBE_EXPECT} (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date (tanpa migrasi baru)"

PHASE="8b-smoke"; say "8b. Smoke test baca-saja (Piutang & Diagnosis, detail order, izin, penolakan; TIDAK membuat/mengubah apa pun di produksi)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
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
const hari = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

rec("piutang: tanpa token 401, SALES 403", (await api(`/api/finance/reports/receivables?to=${hari}`)).status === 401 && (await api(`/api/finance/reports/receivables?to=${hari}`, tS)).status === 403);
rec("diagnosis: tanpa token 401, SALES 403", (await api(`/api/finance/reports/receivables/diagnosis?to=${hari}`)).status === 401 && (await api(`/api/finance/reports/receivables/diagnosis?to=${hari}`, tS)).status === 403);
const ar = await api(`/api/finance/reports/receivables?to=${hari}`, tA);
rec("piutang (admin) 200 dengan baris + total + field tambahan aditif", ar.status === 200 && Array.isArray(ar.json?.baris) && typeof ar.json?.total === "number" && ar.json.baris.every((b) => "tagihanDiakui" in b && "statusBayar" in b), `${ar.json?.baris?.length} baris`);
const jumlahSisa = (ar.json?.baris ?? []).reduce((a, b) => a + (Number(b.sisaTagihan) || 0), 0);
rec("piutang: total = jumlah sisa tagihan per baris (angka dari ledger yang sama)", Math.abs(jumlahSisa - (ar.json?.total ?? NaN)) < 0.5, `${jumlahSisa} vs ${ar.json?.total}`);
const dg = await api(`/api/finance/reports/receivables/diagnosis?to=${hari}`, tA);
rec("diagnosis (admin) 200 dengan rekonsiliasi + perluTindakanOrder", dg.status === 200 && Array.isArray(dg.json?.perluTindakanOrder) && typeof dg.json?.rekonsiliasi?.selisih === "number");
const ids = (dg.json?.perluTindakanOrder ?? []).map((e) => e.orderId);
rec("Perlu Tindakan: SATU order = SATU entri (tidak ada order ganda)", new Set(ids).size === ids.length, `${ids.length} order`);
rec("Perlu Tindakan: jumlah = order unik", (dg.json?.perluTindakan?.jumlah ?? -1) === ids.length, `${dg.json?.perluTindakan?.jumlah} vs ${ids.length}`);
rec("Perlu Tindakan: setiap entri memuat >=1 alasan beralasan lengkap (label, penjelasan, tindakan)", (dg.json?.perluTindakanOrder ?? []).every((e) => (e.alasan ?? []).length >= 1 && e.alasan.every((a) => a.kode && a.label && a.penjelasan && a.tindakan)));
const tgl = (dg.json?.perluTindakanOrder ?? []).filter((e) => e.alasan.some((a) => a.kode === "TANGGAL_LUNAS_BEDA"));
console.log(`  INFO  kategori baru "Tanggal lunas berbeda dari tanggal pembayaran yang melunasi": ${tgl.length} order; dikecualikan Pengecualian Owner: ${dg.json?.perluTindakan?.perSumber?.tanggalLunasBeda?.dikecualikanPengecualianOwner ?? "?"}`);
// Detail order: baca-saja; order pertama dari daftar piutang
const o1 = (ar.json?.baris ?? [])[0];
if (o1) {
  const d1 = await api(`/api/finance/reports/receivables/order/${o1.orderId}`, tA);
  rec("detail order piutang (admin) 200 dengan tagihan/pembayaran/jurnal/riwayat", d1.status === 200 && d1.json?.tagihan && Array.isArray(d1.json?.pembayaran) && Array.isArray(d1.json?.jurnal) && Array.isArray(d1.json?.riwayat));
  rec("detail order piutang: SALES 403, tanpa token 401", (await api(`/api/finance/reports/receivables/order/${o1.orderId}`, tS)).status === 403 && (await api(`/api/finance/reports/receivables/order/${o1.orderId}`)).status === 401);
} else skip("detail order piutang", "tidak ada baris piutang di produksi pada tanggal ini");
rec("detail order piutang: id tidak dikenal -> 404 (bukan 500)", (await api(`/api/finance/reports/receivables/order/c000000000000000000000000`, tA)).status === 404);
// Rute lama dan antrean tetap hidup
for (const p of ["/api/finance/dashboard", "/api/finance/refunds", "/api/finance/pembayaran/ringkasan", "/api/finance/pembayaran?limit=1"]) {
  const r = await api(p, tA);
  rec(`rute lama ${p} (admin) tetap 200`, r.status === 200, String(r.status));
}
const sebelumOrder = await prisma.order.count();
await prisma.$disconnect();
console.log(`  INFO  jumlah order (tidak ditulis oleh smoke): ${sebelumOrder}`);
console.log(`\nRINGKASAN smoke: ${fail} gagal, ${dilewati} dilewati (SKIP)`);
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
process.exit(fail ? 1 : 0);
NODE
SMOKE_SKIP="$(sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p' "$BK_DIR/smoke.log" | tail -n 1)"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL (jangan anggap lulus)"
if [ "$SMOKE_SKIP" = "0" ]; then ok "smoke test lulus (piutang, diagnosis, Perlu Tindakan tanpa duplikasi, detail order, izin, rute lama)"; else warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat ${BK_DIR}/smoke.log. Ini BUKAN klaim lulus untuk yang dilewati."; fi
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
# BUKTI AKHIR: sidik jari angka Finance pada T0 yang SAMA harus identik sebelum vs sesudah.
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$VERIF_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/verif-sesudah.txt" || die "sidik jari angka Finance sesudah gagal"
diff "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-sesudah.txt" >/dev/null || { diff "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-sesudah.txt" || true; die "sidik jari angka Finance BERUBAH selama rilis (jurnal/saldo/payment/order/refund) — periksa dengan backup"; }
ok "sidik jari angka Finance IDENTIK sebelum vs sesudah pada T0=${T0}: 14 kunci (jurnal+baris, saldo per akun/total, payment, verifikasi, refund, paidAt/nilai order, pengecualian, invoice, setting, migrasi) — rilis TIDAK mengubah data"
# Angka Piutang LIVE kode baru vs kode lama (live sebelum switch): dipakai KETAT hanya bila buku besar tidak bergerak di antaranya; bukti utama = rehearsal restore.
dcp "$NEW_DIR" exec -T backend node --input-type=module - < "$BK_DIR/piutang.mjs" > "$BK_DIR/piutang-baru-live.json" 2>"$BK_DIR/piutang-baru-live.err" || die "membaca angka Piutang (kode baru, live) gagal: $(head -c 300 "$BK_DIR/piutang-baru-live.err")"
if BANDL="$(node "$BK_DIR/banding-piutang.mjs" "$BK_DIR/piutang-lama-live.json" "$BK_DIR/piutang-baru-live.json")"; then
  printf '%s\n' "$BANDL" | grep -v '^BANDING_HASIL'
  ok "angka Piutang LIVE kode baru identik dengan kode lama (field lama), bukti tambahan di luar rehearsal"
else
  printf '%s\n' "$BANDL" | head -n 12
  warn "angka Piutang live berbeda antara sebelum dan sesudah switch: bila ada transaksi sah (pembayaran/jurnal) di antaranya ini WAJAR — bukti angka identik ada pada rehearsal restore + sidik jari T0 di atas."
fi
# Pembersihan release lama (setelah rilis TERBUKTI sehat). Kegagalan di sini TIDAK menggagalkan rilis.
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
say "SELESAI — rilis ${DEPLOY_SHORT} aktif (kode saja; tidak ada data/akun/setting diubah). Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
