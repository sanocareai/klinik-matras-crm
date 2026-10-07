#!/usr/bin/env bash
# RILIS "Formulir Finance dikosongkan saat dibuka + Pembelian dua pihak" — backend (GET /finance/reports/receivables/diagnosis, baca-saja; skrip penyesuaian pengakuan pendapatan & penuntasan Payment historis ikut terpasang, TIDAK dijalankan) + frontend (kartu Diagnosis Piutang di tab Piutang;
# daftar piutang lama tidak berubah). TANPA migrasi, TANPA perubahan data/jurnal/saldo/flag; impor rekening koran tetap MATI (sakelar). Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). Diturunkan dari release-bank-rekon.sh.
#
#   cat scripts/release-form-reset.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rfr.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rfr.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rfr.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/rfr.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-release/finance-diagnosis-piutang}"
# Migrasi CREATE (tabel/enum/indeks/FK) yang SUDAH diaudit: nama → sha256 isi (LF). Migrasi lain yang bukan "ADD COLUMN" murni = berhenti.
declare -A MIGRASI_TERAUDIT=( ["20261015100000_bank_reconciliation_v2"]="09277b25e49bbea6b752e02dbfd7609b3a280d9742207c616c670cb5084d1b8e" )
# NEW_MIGRATION= (di-set KOSONG secara eksplisit) = rilis KODE SAJA tanpa migrasi (mis. tambahan setelah migrasi sudah terpasang). Tidak di-set = migrasi terpin.
NEW_MIGRATION="${NEW_MIGRATION-}"
# Berkas yang BOLEH berbeda dari baseline: hanya area Finance + skrip/tes-nya. Apa pun di luar ini (Production, Delivery, Inbox, schema, migration,
# package-lock) = berhenti — supaya pekerjaan workspace lain yang sudah live tidak pernah tertimpa.
ALLOWED_RE='^(backend/src/services/finance/export/pengeluaran\.js|backend/tests/pihakPenerimaExport\.test\.js|frontend/src/features/finance/detailSpecs\.js|frontend/src/features/finance/pembelianPihak\.js|frontend/src/features/finance/resetSaatBuka\.jsx|frontend/src/pages/finance/FinanceCash\.jsx|frontend/src/pages/finance/FinanceExpenses\.jsx|frontend/src/pages/finance/FinanceJournal\.jsx|frontend/src/pages/finance/FinanceKasbon\.jsx|frontend/src/pages/finance/FinancePengecualianLunas\.jsx|frontend/src/pages/finance/FinancePenjualanKaryawan\.jsx|frontend/src/pages/finance/FinancePurchases\.jsx|frontend/src/pages/finance/FinanceReceivables\.jsx|frontend/src/pages/finance/FinanceReconciliation\.jsx|frontend/src/pages/finance/FinanceSettings\.jsx|frontend/src/pages/finance/FinanceSuppliers\.jsx|frontend/src/pages/finance/FinanceUangMuka\.jsx|frontend/tests/formulirResetPembelianPihak\.test\.js|scripts/release-form-reset\.sh)$'  # EKSPLISIT: path persis tiap berkas yang berubah (19); Production/Delivery/Inbox/schema/dependensi tidak boleh ikut
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
BK_DIR="$HOME/release-backups/pk-${DEPLOY_SHORT}-${TS}"
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
Rilis ini TANPA migrasi dan TANPA perubahan data: rollback kode aman tanpa memulihkan database.
CATATAN rollback: kartu Diagnosis Piutang dan endpoint-nya hilang; skrip penyesuaian/penuntasan ikut hilang dari image (tidak berpengaruh ke data). Data tidak terpengaruh.
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
exec 9>/tmp/release-form-reset.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rpk\|rpm\|rpl\|rbr\|rdg\|rpa\|rpd\|rga\|rgp\|rcp\|release-form-reset\|release-parser-mandiri-antrean\|release-penjualan-karyawan\|release-bank-rekon\|pgrep\|node src/index.js" || true)"
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
# NEW_MIGRATION sudah diisi di atas (default = migrasi yang diaudit). Pemeriksaan di bawah FAIL-CLOSED.
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
if [ -z "$NEW_MIGRATION" ]; then
  [ -z "$PRISMA_CHANGED" ] || die "schema/migration berubah tetapi NEW_MIGRATION tidak diisi — rilis ini harus kode Finance saja"
  ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas, SEMUA di area Finance (tanpa migration/schema/dependensi)"
else
  [[ "$NEW_MIGRATION" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "NEW_MIGRATION tidak valid: ${NEW_MIGRATION}"
  MIG_PATH="backend/prisma/migrations/${NEW_MIGRATION}/migration.sql"
  [ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf 'backend/prisma/schema.prisma\n%s\n' "$MIG_PATH" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat schema.prisma + ${MIG_PATH}"; }
  MIGSQL="$(sg show "${DEPLOY_SHA}:${MIG_PATH}" | tr -d '\r')"
  ISI="$(printf '%s\n' "$MIGSQL" | grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$' || true)"
  [ -n "$ISI" ] || die "migrasi kosong"
  MIG_SHA="$(printf '%s\n' "$MIGSQL" | sha256sum | cut -d' ' -f1)"
  if [ -n "${MIGRASI_TERAUDIT[$NEW_MIGRATION]:-}" ]; then
    # Migrasi yang sudah diaudit: SHA-256 isi WAJIB sama dengan pin (perubahan sekecil apa pun = berhenti sampai diaudit ulang).
    [ "${MIGRASI_TERAUDIT[$NEW_MIGRATION]}" = "$MIG_SHA" ] || die "isi migrasi ${NEW_MIGRATION} BERBEDA dari yang diaudit (sha256 ${MIG_SHA}) — audit ulang lalu perbarui pin"
    # Hapus klausa referensial ON DELETE/UPDATE (bukan perintah DELETE/UPDATE) lalu larang perintah destruktif/non-aditif. -w (kata utuh).
    # Daftar putih per pernyataan (pemindai Node) — pernyataan di luar daftar, atau badan fungsi trigger yang memuat DML/DDL, menghentikan rilis. Hitungan harus tepat sama dengan yang diaudit.
    cat > "$BK_DIR/scan-migrasi.mjs" <<'SCANJS'
// Pemindai migrasi V2 (dijalankan di VPS oleh skrip rilis). Membaca SQL migrasi (tanpa baris komentar) dari stdin, memecah per pernyataan (memperhatikan badan fungsi $$...$$) dan
// MEMASTIKAN tiap pernyataan termasuk daftar putih yang diaudit. Badan fungsi trigger hanya boleh membaca fin_* (SELECT ... INTO) dan melempar RAISE — tidak boleh menulis/menghapus apa pun.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const stmts = [];
let cur = "", dalam = false;
for (let i = 0; i < sql.length; i += 1) {
  if (sql[i] === "$" && sql[i + 1] === "$") { dalam = !dalam; cur += "$$"; i += 1; continue; }
  if (sql[i] === ";" && !dalam) { if (cur.trim()) stmts.push(cur.trim()); cur = ""; continue; }
  cur += sql[i];
}
if (cur.trim()) stmts.push(cur.trim());

const rapat = (s) => s.replace(/\s+/g, " ");
const POLA = [
  ["enum", /^CREATE TYPE "Fin[A-Za-z]+" AS ENUM \(/],
  ["tabel", /^CREATE TABLE "fin_[a-z_]+" \(/],
  ["indeks", /^CREATE INDEX "fin_[a-z_0-9]+" ON "fin_[a-z_]+"\(/],
  ["indeks_unik", /^CREATE UNIQUE INDEX "fin_[a-z_0-9]+" ON "fin_[a-z_]+"\(/],
  ["fk", /^ALTER TABLE "fin_[a-z_]+" ADD CONSTRAINT "fin_[a-z_0-9]+" FOREIGN KEY \("[a-z_]+"\) REFERENCES "(fin_[a-z_]+|User)"\("id"\) ON DELETE (RESTRICT|SET NULL) ON UPDATE CASCADE$/],
  ["check", /^ALTER TABLE "fin_[a-z_]+" ADD CONSTRAINT "fin_[a-z_0-9]+_chk" CHECK \(/],
  ["fungsi", /^CREATE OR REPLACE FUNCTION fin_[a-z_]+\(\) RETURNS trigger AS \$\$/],
  ["trigger", /^CREATE TRIGGER fin_[a-z_]+_trg BEFORE (INSERT OR UPDATE OR DELETE|UPDATE OR DELETE) ON "fin_[a-z_]+" FOR EACH ROW EXECUTE FUNCTION fin_[a-z_]+\(\)$/],
];
const TERLARANG_BADAN = /\b(DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+[A-Za-z_"]+\s+SET|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COPY|EXECUTE)\b/i;
const hitung = {};
for (const s of stmts) {
  const r = rapat(s);
  const cocok = POLA.find(([, p]) => p.test(r));
  if (!cocok) { console.error(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`); process.exit(1); }
  if (cocok[0] === "fungsi") {
    const badan = r.slice(r.indexOf("$$") + 2, r.lastIndexOf("$$"));
    if (TERLARANG_BADAN.test(badan)) { console.error(`BADAN FUNGSI MEMUAT PERINTAH TERLARANG: ${r.slice(0, 120)}`); process.exit(1); }
    if (!/LANGUAGE plpgsql$/.test(r)) { console.error("fungsi bukan plpgsql"); process.exit(1); }
  }
  hitung[cocok[0]] = (hitung[cocok[0]] ?? 0) + 1;
}
console.log(JSON.stringify({ total: stmts.length, ...hitung }));
SCANJS
    HASIL_SCAN="$(printf '%s\n' "$ISI" | node "$BK_DIR/scan-migrasi.mjs")" || die "migrasi terpin memuat pernyataan di luar daftar putih yang diaudit"
    [ "$HASIL_SCAN" = '{"total":51,"enum":2,"tabel":6,"indeks":7,"fk":16,"indeks_unik":5,"check":3,"fungsi":6,"trigger":6}' ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
    ok "migrasi ${NEW_MIGRATION}: sha256 cocok pin (${MIG_SHA:0:12}); hanya DDL pada 6 tabel fin_* baru + 2 enum + 6 trigger immutabilitas (daftar putih per pernyataan, 51 pernyataan)"
  else
    # Migrasi yang TIDAK dikenal: hanya ALTER TABLE ... ADD COLUMN murni (aturan hotfix asli) — selain itu berhenti.
    printf '%s\n' "$ISI" | grep -Eiq 'DROP|DELETE|UPDATE|INSERT|TRUNCATE|RENAME|ALTER[[:space:]]+COLUMN|ADD[[:space:]]+CONSTRAINT|CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX|CREATE[[:space:]]+(TABLE|TYPE)' && die "migrasi ${NEW_MIGRATION} tidak dikenal dan BUKAN aditif murni (tidak ada di MIGRASI_TERAUDIT)"
    [ "$(printf '%s\n' "$ISI" | grep -Eic '^[[:space:]]*ALTER[[:space:]]+TABLE.*ADD[[:space:]]+COLUMN')" = "$(printf '%s\n' "$ISI" | grep -c ';')" ] || die "setiap perintah migrasi harus ALTER TABLE ... ADD COLUMN"
    ok "migrasi ${NEW_MIGRATION}: aditif murni ADD COLUMN"
  fi
  ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit + SATU migrasi (${NEW_MIGRATION})"
fi

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
SNAP_SQL="select 'order_status', count(*), md5(coalesce(string_agg(x.id::text||x.\"paymentStatus\"::text||coalesce(x.paid_at::text,''), '|' order by x.id),'')) from \"Order\" x union all select 'alokasi', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from fin_payment_allocations x union all select 'verifikasi', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from payment_verifications x union all select 'pengaturan_bool', count(*), md5(coalesce(string_agg(x.key||'='||x.value, '|' order by x.key),'')) from fin_settings x where x.key in ('payment_verification_gate','payment_verification_gate_since','resi_pembayaran_aktif','resi_input_aktif','klaim_lunas_gate_aktif','bank_reconciliation_v2_active') union all select 'jurnal_hash_penuh', count(*), md5(coalesce(string_agg(e.id::text||e.entry_number||e.date::text||e.status::text||e.created_at::text||l.id::text||l.account_id::text||l.debit::text||l.credit::text||coalesce(l.cash_account_id::text,''), '|' order by l.id),'')) from fin_journal_entries e join fin_journal_lines l on l.entry_id=e.id union all select 'rekening_kas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_cash_accounts x union all select 'jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.status::text, '|' order by x.id),'')) from fin_journal_entries x union all select 'baris_jurnal', count(*), md5(coalesce(string_agg(x.id::text||x.debit::text||x.credit::text, '|' order by x.id),'')) from fin_journal_lines x union all select 'payment', count(*), md5(coalesce(string_agg(x.id::text||x.amount::text, '|' order by x.id),'')) from payments x union all select 'flag_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from v2_feature_flags x"
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/data-sebelum.txt" || die "snapshot data sebelum gagal"
ok "snapshot data sebelum tersimpan ($(wc -l < "$BK_DIR/data-sebelum.txt") baris)"

say "2b. Sumber node_modules frontend (package-lock identik dengan kandidat)"
LOCK_NEW="$BK_DIR/lock-baru.json"; sg show "${DEPLOY_SHA}:frontend/package-lock.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do
  d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package-lock.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package-lock.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package-lock identik"
ok "node_modules build dari ${NM_SRC}"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-pbr-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "peringatan-supplier-beda" "dibeli-dari" "Edit data supplier"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat penanda: $s1"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-pbr-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"
if [ -z "$NEW_MIGRATION" ]; then
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status tidak 'up to date' (tidak diharapkan ada migration pada rilis ini)"
  ok "tidak ada migration pending"
else
  PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, verifikasi, hapus (DB produksi tidak disentuh)"
  REH_DB="rehearsal_pbr_${TS}"
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
  reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
  gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
  # Kesamaan restore vs produksi (tabel kunci) — bukti bahwa backup benar-benar bisa dipulihkan.
  for T in '"Order"' payments fin_journal_entries fin_payment_allocations; do
    A="$(psql_live -At -c "select count(*) from $T")"; B="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "select count(*) from $T" </dev/null)"
    [ "$A" = "$B" ] || { reh_drop; die "restore rehearsal tidak identik untuk $T (produksi=$A restore=$B) — backup/restore bermasalah"; }
  done
  ok "restore nyata identik untuk Order, payments, jurnal, alokasi"
  REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
  [ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
  dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "REHEARSAL migrate deploy GAGAL (DB produksi tidak disentuh)"; }
  RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
  [ "$(RPSQL "select count(*) from information_schema.tables where table_name in ('fin_bank_import_batches','fin_bank_import_lines','fin_bank_match_groups','fin_bank_match_items','fin_bank_recon_periods','fin_cash_counts')")" = "6" ] || { reh_drop; die "6 tabel V2 tidak lengkap setelah migrasi rehearsal"; }
  for T in fin_bank_import_batches fin_bank_import_lines fin_bank_match_groups fin_bank_match_items fin_bank_recon_periods fin_cash_counts; do [ "$(RPSQL "select count(*) from $T")" = "0" ] || { reh_drop; die "tabel $T tidak kosong setelah migrasi rehearsal"; }; done
  [ "$(RPSQL "select count(*) from pg_trigger where tgname in ('fin_bank_import_line_immutable_trg','fin_bank_import_batch_immutable_trg','fin_bank_match_group_immutable_trg','fin_bank_match_item_guard_trg','fin_bank_recon_period_immutable_trg','fin_cash_count_immutable_trg')")" = "6" ] || { reh_drop; die "6 trigger immutabilitas tidak ada setelah migrasi rehearsal"; }
  [ "$(RPSQL "select count(*) from pg_indexes where indexname in ('fin_bank_import_batches_file_aktif_uniq','fin_bank_import_lines_fp_aktif_uniq','fin_bank_match_items_bank_aktif_uniq','fin_bank_match_items_jurnal_aktif_uniq','fin_bank_recon_periods_aktif_uniq')")" = "5" ] || { reh_drop; die "5 indeks unik parsial tidak ada setelah migrasi rehearsal"; }
  # Uji trigger pada DB rehearsal (bukan produksi): tulis lalu coba ubah/hapus — harus ditolak. Seluruhnya di DB sementara yang dihapus sesudahnya.
  RPSQL "insert into fin_cash_counts(id, cash_account_id, count_date, amount) select gen_random_uuid(), id, current_date, 1 from fin_cash_accounts limit 1" >/dev/null 2>&1 || true
  if [ "$(RPSQL "select count(*) from fin_cash_counts")" = "1" ]; then
    RPSQL "update fin_cash_counts set amount = 2" >/dev/null 2>&1 && { reh_drop; die "trigger immutabilitas fin_cash_counts TIDAK menolak UPDATE"; }
    RPSQL "delete from fin_cash_counts" >/dev/null 2>&1 && { reh_drop; die "trigger immutabilitas fin_cash_counts TIDAK menolak DELETE"; }
    ok "trigger immutabilitas terbukti menolak UPDATE/DELETE (DB rehearsal)"
  fi
  for T in '"Order"' payments fin_journal_entries fin_payment_allocations fin_accounts; do
    A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
    [ "$A" = "$B" ] || { reh_drop; die "jumlah baris $T berubah oleh migrasi rehearsal (produksi=$A rehearsal=$B)"; }
  done
  reh_drop
  ok "rehearsal lulus: migrate dari schema produksi (restore nyata) → up to date; 6 tabel V2 kosong, 6 trigger + 5 indeks unik parsial ada, trigger terbukti menolak ubah/hapus; jumlah baris tabel kunci tidak berubah; DB sementara dihapus"

  PHASE="6-migrate"; say "6. Migrasi aditif ${NEW_MIGRATION} (image baru; backend lama tetap melayani)"
  psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
  grep -Fx "$NEW_MIGRATION" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${NEW_MIGRATION} SUDAH terpasang sebelum rilis (tidak diharapkan)"
  # Pending = folder migrasi di release baru yang BELUM ada di _prisma_migrations (bandingkan daftar, bukan menebak teks keluaran Prisma).
  PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") || true)"
  [ "$PENDING" = "$NEW_MIGRATION" ] || die "migrasi pending bukan tepat ${NEW_MIGRATION}: $(printf '%s' "$PENDING" | tr '\n' ' ')"
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
  [ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
  psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${NEW_MIGRATION}'" | grep -Fx t >/dev/null || die "${NEW_MIGRATION} tidak tercatat selesai"
  [ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 1 ))" ] || die "jumlah migrasi terpasang != sebelum + 1"
  ok "migrasi diterapkan: ${NEW_MIGRATION}; tidak ada yang menggantung"
  curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
  ok "backend lama tetap sehat setelah migrasi aditif"
fi

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
for f in backend/src/services/finance/export/pengeluaran.js; do
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
done
ok "1 berkas backend di container = kandidat (byte-identik)"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
[ "$(PSQLN "select coalesce((select value from fin_settings where key='bank_reconciliation_v2_active'),'false')")" = "false" ] || die "sakelar bank_reconciliation_v2_active BUKAN false setelah rilis"
ok "sakelar bank_reconciliation_v2_active = MATI"
[ "$(PSQLN "select coalesce((select value from fin_settings where key='klaim_lunas_gate_aktif'),'false')")" = "$GATE_SEBELUM" ] || die "sakelar klaim_lunas_gate_aktif BERUBAH selama rilis"
ok "sakelar klaim lunas tidak berubah"
PHASE="8b-smoke"; say "8b. Smoke test (baca-saja; TIDAK membuat transaksi produksi)"
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
const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
const sales = await prisma.user.findFirst({ where: { role: "SALES", active: true } });
if (!adm || !sales) { rec("akun ADMIN & SALES aktif tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const cacah = async () => [await prisma.payment.count(), await prisma.paymentVerification.count(), await prisma.finJournalEntry.count(), await prisma.finJournalLine.count(), await prisma.finPaymentAllocation.count(), await prisma.orderPaymentClaim.count(), await prisma.finBankImportBatch.count(), await prisma.finBankImportLine.count()];
const sebelum = await cacah();

// ── Diagnosis Piutang (baca-saja) ──
const akunP = await prisma.finAccount.findUnique({ where: { systemKey: "PIUTANG_USAHA" }, select: { id: true } });
const agg = await prisma.finJournalLine.aggregate({ where: { accountId: akunP.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
const neracaDb = Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
const dg = await api("GET", "/api/finance/reports/receivables/diagnosis", tA);
rec("diagnosis piutang: admin -> 200 dengan bentuk lengkap", dg.status === 200 && Array.isArray(dg.json?.baris) && dg.json?.rekonsiliasi && dg.json?.belumDiakui && dg.json?.keringananLunas && dg.json?.kategori, `status ${dg.status}`);
rec("diagnosis: saldo neraca = saldo Piutang Usaha di buku besar", dg.status === 200 && Math.abs(dg.json.neraca - neracaDb) < 0.005, `diagnosis ${dg.json?.neraca} = buku besar ${neracaDb}`);
rec("diagnosis: jumlah semua penyebab = saldo neraca (selisih 0)", dg.status === 200 && dg.json.rekonsiliasi.selisih === 0, `selisih ${dg.json?.rekonsiliasi?.selisih}`);
rec("diagnosis: setiap baris punya kategori, penjelasan, dan tindakan", dg.status === 200 && dg.json.baris.every((b) => b.kategori && b.penjelasan && b.tindakan));
rec("diagnosis: tanpa token -> 401", (await api("GET", "/api/finance/reports/receivables/diagnosis")).status === 401);
rec("diagnosis: SALES -> 403", (await api("GET", "/api/finance/reports/receivables/diagnosis", tS)).status === 403);
const lama = await api("GET", "/api/finance/reports/receivables", tA);
rec("daftar piutang: bidang `dibatalkan` ada; daftar + menungguVerifikasi + dibatalkan = saldo buku besar", lama.status === 200 && lama.json?.dibatalkan && Math.abs(lama.json.total + lama.json.menungguVerifikasi.total + lama.json.dibatalkan.total - neracaDb) < 0.005, `${lama.json?.total} + ${lama.json?.menungguVerifikasi?.total} + ${lama.json?.dibatalkan?.total} = ${neracaDb}`);
rec("daftar piutang lama tetap 200 dengan kontrak yang sama (baris, ringkasan, total)", lama.status === 200 && Array.isArray(lama.json?.baris) && lama.json?.ringkasan && typeof lama.json?.total === "number", `status ${lama.status}`);
console.log(`  info  neraca ${dg.json?.neraca}; ${dg.json?.baris?.length} order bersaldo; keringanan lunas ${dg.json?.keringananLunas?.jumlah} order, sisa ${dg.json?.keringananLunas?.totalSisa}`);
// ── Armada: rute pembayaran driver tetap termuat dengan pengaman baru (job fiktif -> 4xx; TIDAK ada Payment tercipta) ──
const fiktif = "00000000-0000-4000-8000-000000000000";
const pb = await api("POST", `/api/armada/jobs/${fiktif}/payment`, tA, { amount: 1, method: "CASH" });
rec("armada payment: job fiktif -> 4xx (bukan 5xx), rute termuat", pb.status >= 400 && pb.status < 500, `status ${pb.status}`);
const sl = await api("GET", "/api/finance/suppliers?includeInactive=1", tA);
rec("supplier: GET includeInactive=1 -> 200 daftar", sl.status === 200 && Array.isArray(sl.json?.suppliers), `status ${sl.status}`);
rec("supplier: GET default memuat HANYA yang aktif", (await api("GET", "/api/finance/suppliers", tA)).json?.suppliers?.every((x) => x.active !== false) === true);
const fk = "00000000-0000-4000-8000-000000000000";
rec("supplier: PATCH id tak dikenal (admin) -> 404 tanpa efek", (await api("PATCH", `/api/finance/suppliers/${fk}`, tA, { name: "X" })).status === 404);
rec("supplier: PATCH oleh SALES -> 403", (await api("PATCH", `/api/finance/suppliers/${fk}`, tS, { name: "X" })).status === 403);
rec("supplier: PATCH tanpa token -> 401", (await api("PATCH", `/api/finance/suppliers/${fk}`, null, { name: "X" })).status === 401);
rec("armada payment: tanpa token -> 401", (await api("POST", `/api/armada/jobs/${fiktif}/payment`, null, { amount: 1, method: "CASH" })).status === 401);
// ── impor rekening koran tetap MATI ──
const bank = await prisma.finCashAccount.findFirst({ where: { active: true, kind: "BANK" } });
if (bank) {
  const unggah = async (jalur) => { const fd = new FormData(); fd.append("file", new Blob(["Tanggal,Keterangan,Debit,Kredit\n01/10/2026,UJI SMOKE,0,100\n"], { type: "text/csv" }), "smoke.csv"); const r = await fetch(BASE + `/api/finance/rekon-bank/${bank.id}/${jalur}`, { method: "POST", headers: { Authorization: "Bearer " + tA }, body: fd }); let json = null; try { json = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json }; };
  const p1 = await unggah("impor/pratinjau");
  rec("impor/pratinjau rekening koran: admin -> 403 SAKELAR_MATI (sakelar tetap mati)", p1.status === 403 && p1.json?.code === "SAKELAR_MATI", `status ${p1.status} ${p1.json?.code ?? ""}`);
  const p2 = await unggah("impor");
  rec("impor rekening koran: admin -> 403 SAKELAR_MATI", p2.status === 403 && p2.json?.code === "SAKELAR_MATI", `status ${p2.status}`);
}
// ── tidak ada yang berubah ──
const sesudah = await cacah();
rec("tidak ada Payment/verifikasi/jurnal/alokasi/klaim/impor bank yang berubah selama smoke", sebelum.every((n, i) => n === sesudah[i]), `${sebelum.join(",")} -> ${sesudah.join(",")}`);
rec("tabel impor bank tetap kosong", sesudah[6] === 0 && sesudah[7] === 0);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus (diagnosis piutang, rute pembayaran driver, kontrak lama utuh, impor tetap mati, data tidak berubah)"
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
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
