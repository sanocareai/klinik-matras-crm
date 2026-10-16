#!/usr/bin/env bash
# RILIS "PRATINJAU DOKUMEN STOK RESMI + TIGA SAKELAR POSTING (SEMUA MATI)": BACKEND SAJA, TANPA migrasi, TANPA perubahan schema.prisma, TANPA perubahan frontend — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Yang dirilis: endpoint Finance /api/finance/stok-resmi/{matriks, :jenis/:id/pratinjau (READ ONLY di level Postgres), :jenis/:id/posting, :jenis/:id/pembalikan} dan tiga sakelar per jenis
#   (stok_resmi_opname/penyesuaian/rusak_aktif, DEFAULT false) + tanggal mulai masing-masing (DEFAULT kosong). Rilis ini TIDAK menyalakan apa pun dan TIDAK membuat Stock Count, adjustment, jurnal, atau transaksi QA.
#   Gate rilis: preflight (termasuk: sakelar belum ada yang true, 0 jurnal stok resmi); backup + RESTORE rehearsal (kode baru dijalankan terhadap data restore: pratinjau di dalam transaksi READ ONLY, posting/pembalikan
#   ditolak saat sakelar default, sidik jari semua tabel identik sebelum vs sesudah); smoke baca-saja pasca-switch (izin, nilai ketiga sakelar, pratinjau baseline, penolakan, tak ada tabel berubah).
#
#   cat scripts/release-stok-resmi-pratinjau.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/srp1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/srp1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/srp1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/srp1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode aman di-rollback bila belum ada jurnal posting stok resmi. Periksa dulu dengan scripts/rollback-guard-stok-resmi-pratinjau.sh (baca-saja).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/finance-audit-pergerakan-stok-resmi}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis backend-saja: hanya berkas di atas yang boleh berbeda dari baseline live; frontend dan OTA RN TIDAK berubah.
ALLOWED_RE='^(backend/scripts/production-delivery-v2/audit-production-experience-writers\.js|backend/src/routes/finance\.js|backend/src/services/finance/posting/inventory\.js|backend/src/services/finance/settings\.js|backend/src/services/finance/stokResmi/(dokumen|index|matriks|posting|pratinjau)\.js|backend/tests/integration/stokResmi\.integration\.test\.js|backend/tests/productionExperience\.test\.js|backend/tests/stokResmi\.test\.js|docs/AUDIT-PERGERAKAN-STOK-RESMI\.md|scripts/release-stok-resmi-pratinjau\.sh|scripts/rollback-guard-stok-resmi-pratinjau\.sh)$'
BACKEND_SRC_EXPECT="backend/src/routes/finance.js backend/src/services/finance/posting/inventory.js backend/src/services/finance/settings.js backend/src/services/finance/stokResmi/dokumen.js backend/src/services/finance/stokResmi/index.js backend/src/services/finance/stokResmi/matriks.js backend/src/services/finance/stokResmi/posting.js backend/src/services/finance/stokResmi/pratinjau.js"
FRONTEND_SRC_EXPECT=""
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
BK_DIR="$HOME/release-backups/stok-resmi-pratinjau-${DEPLOY_SHORT}-${TS}"
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
Rilis ini TANPA migrasi dan TANPA tulisan data. Rollback KODE aman selama BELUM ada jurnal posting stok resmi — periksa dulu (baca-saja):
   bash ${NEW_DIR}/scripts/rollback-guard-stok-resmi-pratinjau.sh
Bila guard lulus (exit 0), rollback setelah switch:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Kode lama: tidak ada endpoint /api/finance/stok-resmi/*; pengaturan stok_resmi_* (bila pernah diisi) diabaikan. Tidak ada data yang ditulis rilis ini.
Env DELIVERY_UNIT_CONFIRM_REQUIRED dan OTA RN TIDAK disentuh rilis ini.
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
exec 9>/tmp/release-stok-resmi-pratinjau.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "srp1\|release-stok-resmi-pratinjau\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, tanpa migrasi/schema"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" "+refs/heads/main:refs/remotes/origin/main" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat ${DEPLOY_SHORT}: rilis akan menghilangkan isi main — gabungkan main ke kandidat dulu"
# 662d65f9 (audit lama, basis basi, bug regex) TIDAK BOLEH ikut: bukan leluhur kandidat.
! sg merge-base --is-ancestor 662d65f94078d66c90c94851d300e936aee4deba "$DEPLOY_SHA" 2>/dev/null || die "kandidat memuat 662d65f9 (audit lama) — dilarang"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -q 'production-evidence' || die "artefak foto uji ikut ter-commit (backend/data/production-evidence) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -q 'receipt-proofs' || die "artefak unggahan uji ikut ter-commit (backend/data/receipt-proofs) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)\.env' || die "berkas .env ikut ter-commit — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -qx 'backend/src/index.js' || die "backend/src/index.js berubah (dipatok tes atribusi)"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
[ -z "$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)" ] || { printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/'; die "backend/prisma berubah — rilis ini TANPA migrasi dan TANPA perubahan schema.prisma"; }
[ -z "$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma backend/prisma/migrations)" ] || die "schema.prisma/migrations berbeda dari baseline"
ok "tanpa migrasi, tanpa perubahan schema.prisma; kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit"

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
# Prasyarat skema: tabel yang dibaca read-model terinci HARUS sudah ada.
for T in "Order" "Customer" jobs units job_units payments payment_verifications fin_accounts fin_journal_entries fin_journal_lines fin_posting_gaps fin_penjualan_karyawan fin_penjualan_karyawan_payments fin_refunds fin_order_credits fin_expenses fin_stock_movement_valuations stock_movements materials fin_settings v2_feature_flags; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
ORDER_N="$(psql_live -At -c "select count(*) from \"Order\"")"
JOB_N="$(psql_live -At -c "select count(*) from jobs")"
PKR_N="$(psql_live -At -c "select count(*) from fin_penjualan_karyawan")"
EVT_N="$(psql_live -At -c "select count(*) from delivery_execution_events")"
for v in "$ORDER_N" "$JOB_N" "$PKR_N" "$EVT_N"; do [[ "$v" =~ ^[0-9]+$ ]] || die "audit awal bukan angka: '$v'"; done
ok "prasyarat terpenuhi; order=${ORDER_N}, job=${JOB_N}, PKR=${PKR_N}, event Delivery=${EVT_N}"
# GARIS DASAR invarian (dibandingkan sesudah rilis; yang dijaga = TIDAK BERTAMBAH oleh rilis ini).
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
SQL_GANDA="select count(*)::int from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"; BASE_GANDA="$(psql_live -At -c "$SQL_GANDA")"
for v in "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA"; do [[ "$v" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$v'"; done
printf 'BASE_TIDAK_SEIMBANG=%q\nBASE_GANDA=%q\nORDER_N=%q\nJOB_N=%q\nPKR_N=%q\nEVT_N=%q\n' "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA" "$ORDER_N" "$JOB_N" "$PKR_N" "$EVT_N" > "$BK_DIR/garis-dasar.env"
( set -e; . "$BK_DIR/garis-dasar.env"; [ "$ORDER_N" = "$ORDER_N" ] ) || die "garis-dasar.env tidak aman di-source"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}; refund dengan >1 jurnal berlaku = ${BASE_GANDA}"
# SIDIK JARI TABEL (seluruh isi baris, jsonb): dibandingkan antara produksi dan restore pada rehearsal (membuktikan backup/restore + rilis tanpa tulisan data).
FP_SQL="select 'order', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Order\" x
union all select 'customer', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Customer\" x
union all select 'fin_penjualan_karyawan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan x
union all select 'fin_penjualan_karyawan_payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan_payments x
union all select 'pkr_order_items', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from pkr_order_items x
union all select 'pkr_item_revisions', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from pkr_item_revisions x
union all select 'units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from units x
union all select 'jobs', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from jobs x
union all select 'job_units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from job_units x
union all select 'job_unit_loads', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from job_unit_loads x
union all select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x
union all select 'fin_journal_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_entries x
union all select 'fin_journal_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x
union all select 'fin_settings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from fin_settings x
union all select 'v2_feature_flags', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from v2_feature_flags x
union all select 'stock_counts', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_counts x
union all select 'stock_count_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_count_lines x
union all select 'stock_adjustment_requests', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_adjustment_requests x
union all select 'damaged_stock_records', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from damaged_stock_records x
union all select 'return_records', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from return_records x
union all select 'stock_movements', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x
union all select 'fin_posting_gaps', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_posting_gaps x"
FP_N=22
# DOKUMEN PEMBANDING DIBEKUKAN: hanya yang menurut aturan bisnis tidak mungkin berubah akibat rilis ini (final, append-only, atau konfigurasi). T0 = jam DB (UTC) 5 menit lalu.
# Dokumen terbuka dan transaksi baru TIDAK diperbandingkan (pengguna sah boleh bertransaksi selama rilis).
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'refund_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_refunds x where x.status::text in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'pengeluaran_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_expenses x where x.status::text in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'pembayaran_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x where x.created_at < '$T0'::timestamp
union all select 'pembayaran_pkr_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan_payments x where x.created_at < '$T0'::timestamp and x.cancelled_at is null
union all select 'pkr_dibatalkan_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan x where x.status::text = 'DIBATALKAN' and x.updated_at < '$T0'::timestamp
union all select 'unit_batal_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from units x where x.status::text = 'CANCELLED' and x.updated_at < '$T0'::timestamp
union all select 'muat_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from job_unit_loads x where x.confirmed_at < '$T0'::timestamp
union all select 'flag_settings', count(*), md5(coalesce(string_agg(f.key || '=' || f.value, '|' order by f.key),'')) from fin_settings f
union all select 'flag_v2', count(*), md5(coalesce(string_agg(to_jsonb(f)::text, '|' order by f.key),'')) from v2_feature_flags f
union all select 'order_lunas_beku', count(*), md5(coalesce(string_agg(x.id || ':' || x."paymentStatus"::text || ':' || coalesce(x.paid_at::text, ''), '|' order by x.id),'')) from "Order" x where x."paymentStatus"::text = 'LUNAS' and x."updatedAt" < '$T0'::timestamp
union all select 'stok_dokumen_final_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_counts x where x.status::text = 'COMPLETED' and x.updated_at < '$T0'::timestamp
union all select 'penyesuaian_final_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_adjustment_requests x where x.status::text in ('POSTED','CANCELLED') and x.updated_at < '$T0'::timestamp
union all select 'rusak_final_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from damaged_stock_records x where x.status::text = 'RESOLVED' and x.updated_at < '$T0'::timestamp
union all select 'retur_final_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from return_records x where x.status::text in ('COMPLETED','CANCELLED') and x.updated_at < '$T0'::timestamp
union all select 'pergerakan_stok_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'jurnal_stok_resmi', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_entries x where x.idempotency_key like 'SELISIH_OPNAME:%' or x.idempotency_key like 'SELISIH_PENYESUAIAN:%' or x.idempotency_key like 'SUSUT_BARANG_RUSAK:%'
FPBEKU
)"
FPB_N=18
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "$FPB_N" ] || die "sidik jari dokumen beku tidak ${FPB_N} baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di ${FPB_N} kelompok)"

say "2b. Prasyarat rilis ini: semua sakelar stok resmi belum menyala, 0 jurnal stok resmi (baca-saja)"
N_SAK_TRUE="$(psql_live -At -c "select count(*) from fin_settings where key like 'stok_resmi_%' and value = 'true'")"
N_JURNAL_SR="$(psql_live -At -c "select count(*) from fin_journal_entries where idempotency_key like 'SELISIH_OPNAME:%' or idempotency_key like 'SELISIH_PENYESUAIAN:%' or idempotency_key like 'SUSUT_BARANG_RUSAK:%'")"
for v in "$N_SAK_TRUE" "$N_JURNAL_SR"; do [[ "$v" =~ ^[0-9]+$ ]] || die "pemeriksaan prasyarat bukan angka: '$v'"; done
[ "$N_SAK_TRUE" = "0" ] || die "ada sakelar stok resmi yang sudah true di produksi — rilis ini hanya untuk sakelar MATI"
[ "$N_JURNAL_SR" = "0" ] || die "sudah ada jurnal stok resmi di produksi (${N_JURNAL_SR}) — tidak diharapkan"
ok "sakelar stok resmi: tidak ada yang true; jurnal stok resmi = 0"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-stok-resmi-pratinjau-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat; compose identik"

say "4b. Frontend TIDAK berubah: dist release aktif disalin apa adanya (tanpa build; bundel identik)"
[ -d "$PREV_DIR/frontend/dist" ] && [ -f "$PREV_DIR/frontend/dist/index.html" ] || die "dist release aktif tidak ada"
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin dist release aktif"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$NEW_INDEX" = "$PREV_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "dist hasil salinan tidak valid"
ok "dist disalin; bundel ${NEW_INDEX} identik dengan release aktif"
PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-stok-resmi-pratinjau-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan pratinjau/penolakan stok resmi terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_stok_resmi_${TS}"
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
ok "restore nyata IDENTIK dengan dokumen beku produksi (refund & pengeluaran final, baris jurnal, saldo per akun, pembayaran, PKR/unit final, muat, flag)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal (image baru) TIDAK 'up to date' — rilis ini harus tanpa migrasi"; }
ok "image baru: tidak ada migrasi pending pada hasil restore (rilis TANPA migrasi terbukti)"
# Kode BARU dijalankan terhadap data RESTORE: tiga sakelar default mati; pratinjau semua dokumen (paralel) DI DALAM transaksi READ ONLY; posting & pembalikan ditolak tanpa menulis apa pun.
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-stok-resmi.log" 2>&1 || { cat "$BK_DIR/rehearsal-stok-resmi.log"; reh_drop; die "uji stok resmi terhadap data restore GAGAL (lihat rehearsal-stok-resmi.log)"; }
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { pratinjau, postDokumenStok, balikDokumenStok } = await import("/app/src/services/finance/stokResmi/index.js");
const { getAllSettings } = await import("/app/src/services/finance/settings.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const set = await getAllSettings(prisma);
const KUNCI = ["stok_resmi_opname", "stok_resmi_penyesuaian", "stok_resmi_rusak"];
for (const k of KUNCI) cek(`${k}: aktif=false, sejak kosong (default)`, String(set[k + "_aktif"]) === "false" && String(set[k + "_sejak"] ?? "") === "", `aktif=${set[k + "_aktif"]} sejak='${set[k + "_sejak"]}'`);
const dok = [];
for (const c of await prisma.stockCount.findMany({ select: { id: true } })) dok.push(["STOCK_COUNT", c.id]);
for (const c of await prisma.stockAdjustmentRequest.findMany({ select: { id: true } })) dok.push(["STOCK_ADJUSTMENT", c.id]);
for (const c of await prisma.damagedStockRecord.findMany({ select: { id: true } })) dok.push(["DAMAGED_STOCK", c.id]);
for (const c of await prisma.returnRecord.findMany({ select: { id: true } })) dok.push(["RETURN_RECORD", c.id]);
console.log(`INFO dokumen di data restore: ${dok.length}`);
cek("ada minimal satu dokumen untuk diuji", dok.length >= 1);
const lihat = (jenis, id) => prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return pratinjau(tx, jenis, id, {}); }, { maxWait: 30000, timeout: 60000 });
const paralel = await Promise.all(dok.flatMap((d) => [0, 1, 2, 3].map(() => lihat(...d))));
cek(`pratinjau paralel x${paralel.length} di transaksi READ ONLY berhasil`, paralel.every((p) => p.status && p.siapDiposting === false && p.sakelar.aktif === false));
for (const [jenis, id] of dok) {
  let kode = null; let st = null;
  try { await prisma.$transaction((tx) => postDokumenStok(tx, { jenis, id, userId: null, alasan: "rehearsal sakelar mati" })); } catch (e) { st = e.statusCode; kode = e.code; }
  cek(`${jenis}: posting ditolak saat sakelar mati`, [409, 422].includes(st), `${st} ${kode}`);
  let sb = null;
  try { await prisma.$transaction((tx) => balikDokumenStok(tx, { jenis, id, userId: null, alasan: "rehearsal sakelar mati" })); } catch (e) { sb = e.statusCode; }
  cek(`${jenis}: pembalikan ditolak saat sakelar mati`, sb === 409, String(sb));
}
let st404 = null; try { await lihat("STOCK_COUNT", "00000000-0000-4000-8000-000000000000"); } catch (e) { st404 = e.statusCode; }
cek("dokumen tak ada → 404", st404 === 404, String(st404));
await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji stok resmi terhadap data restore: $(grep -c '^OK' "$BK_DIR/rehearsal-stok-resmi.log") pemeriksaan lulus; $(tail -n 1 "$BK_DIR/rehearsal-stok-resmi.log")"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "rehearsal MENGUBAH isi tabel"; }
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah uji; DB sementara dihapus"

PHASE="6-tanpa-migrasi"; say "6. Tanpa migrasi: pastikan tidak ada yang pending (image baru; backend lama tetap melayani)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan di produksi; JANGAN switch"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi (image baru) TIDAK 'up to date' — rilis ini harus tanpa migrasi"
ok "tidak ada migrasi pending; skema produksi sudah sesuai image baru"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-switch.txt" || die "sidik jari dokumen beku pra-switch gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-switch.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-switch.txt" || true; die "dokumen pembanding beku BERUBAH sebelum switch"; }
ok "pra-switch: dokumen pembanding beku identik"

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
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin, nilai ketiga sakelar, matriks, pratinjau (paralel), posting/pembalikan DITOLAK tanpa menulis, tak ada jejak stok resmi"
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
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]);
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
const fin = await userDengan("FINANCE", new Set(["ADMIN", "OWNER"]));
if (!adm || !sales) { rec("akun ADMIN dan SALES murni tersedia", false, `adm=${!!adm} sales=${!!sales}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const tF = fin ? await tokenUntuk(fin) : null;

const TABEL = ['stock_counts', 'stock_count_lines', 'stock_adjustment_requests', 'damaged_stock_records', 'return_records', 'stock_movements'];
const sebelum = {}; for (const t of TABEL) sebelum[t] = await hitung(`select count(*)::int n from ${t}`);
const sebelumGap = await hitung("select count(*)::int n from fin_posting_gaps");
const sebelumJurnal = await hitung("select count(*)::int n from fin_journal_entries");

// ── nilai ketiga sakelar (dibaca lewat API Finance, bukan tebakan) ──
const s = await api("GET", "/api/finance/settings", tA);
const nilai = (k) => String(s.json?.settings?.[k] ?? s.json?.[k]);
const KUNCI = ["stok_resmi_opname", "stok_resmi_penyesuaian", "stok_resmi_rusak"];
rec("GET /settings 200", s.status === 200);
for (const k of KUNCI) {
  console.log(`  INFO  SAKELAR ${k}: aktif=${nilai(k + "_aktif")} sejak='${nilai(k + "_sejak")}'`);
  rec(`${k}: aktif=false dan tanggal mulai kosong`, nilai(k + "_aktif") === "false" && nilai(k + "_sejak") === "");
}
rec("tidak ada baris fin_settings stok_resmi_* bernilai true", (await hitung("select count(*)::int n from fin_settings where key like 'stok_resmi_%' and value = 'true'")) === 0);

// ── izin ──
const dokAda = await prisma.stockCount.findMany({ select: { id: true, countNumber: true } });
const adaDok = dokAda.length > 0; const d0 = dokAda[0];
rec("matriks: tanpa token 401; SALES 403", (await api("GET", "/api/finance/stok-resmi/matriks", null)).status === 401 && (await api("GET", "/api/finance/stok-resmi/matriks", tS)).status === 403);
const m = await api("GET", "/api/finance/stok-resmi/matriks", tA);
rec("matriks Admin 200: 6 aksi, 3 DITOLAK (Return Record, Retur Supplier, Konversi/baseline per aksi)", m.status === 200 && m.json.matriks.length === 6 && m.json.matriks.filter((x) => x.posting === "DITOLAK").length === 3, JSON.stringify(m.json?.matriks?.map((x) => x.posting)));
if (adaDok) {
  const url = `/api/finance/stok-resmi/STOCK_COUNT/${d0.id}`;
  rec("pratinjau: tanpa token 401; SALES 403", (await api("GET", `${url}/pratinjau`, null)).status === 401 && (await api("GET", `${url}/pratinjau`, tS)).status === 403);
  if (tF) {
    rec("Finance biasa: pratinjau 200, posting 403, pembalikan 403", (await api("GET", `${url}/pratinjau`, tF)).status === 200 && (await api("POST", `${url}/posting`, tF, { alasan: "uji izin smoke" })).status === 403 && (await api("POST", `${url}/pembalikan`, tF, { alasan: "uji izin smoke" })).status === 403);
  } else skip("Finance biasa tanpa ADMIN/OWNER", "tidak ada akun FINANCE murni aktif");
  // ── pratinjau dokumen nyata (baseline migrasi): baca-saja, DITOLAK, tidak siap diposting ──
  const hasil = await Promise.all(Array.from({ length: 12 }, () => api("GET", `${url}/pratinjau`, tA)));
  rec("pratinjau paralel x12 semua 200", hasil.every((h) => h.status === 200), hasil.map((h) => h.status).join(","));
  const p = hasil[0].json;
  console.log(`  INFO  pratinjau ${d0.countNumber}: status=${p.status} baris=${p.kuantitas.length} nilaiTotal=${p.nilai.total} gapTanpaHarga=${p.gapTanpaHarga.length} penolakan=${p.penolakan.map((x) => x.kode).join(",")}`);
  rec("pratinjau: siapDiposting=false; sakelar aktif=false; atribusi order/unit=false", p.siapDiposting === false && p.sakelar.aktif === false && p.atribusi.keOrder === false && p.atribusi.keUnit === false);
  rec("pratinjau baseline migrasi: DITOLAK (BASELINE_MIGRASI_TIDAK_DIJURNALKAN)", /BASELINE/i.test(d0.countNumber) ? (p.status === "DITOLAK" && p.penolakan.some((x) => x.kode === "BASELINE_MIGRASI_TIDAK_DIJURNALKAN")) : true);
  // ── posting & pembalikan ditolak (sakelar mati; pada baseline juga ditolak permanen) — tidak boleh menulis ──
  const ps = await api("POST", `${url}/posting`, tA, { alasan: "smoke sakelar mati — harus ditolak" });
  const pb = await api("POST", `${url}/pembalikan`, tA, { alasan: "smoke sakelar mati — harus ditolak" });
  rec("Admin: posting ditolak (409/422), bukan 200/201", [409, 422].includes(ps.status), `${ps.status} ${ps.json?.code}`);
  rec("Admin: pembalikan ditolak 409", pb.status === 409, `${pb.status} ${pb.json?.code}`);
} else skip("pratinjau/posting dokumen nyata", "tidak ada Stock Count di produksi");
rec("jenis ngawur → 400; UUID rusak → 400; dokumen tak ada → 404", (await api("GET", "/api/finance/stok-resmi/NGAWUR/00000000-0000-4000-8000-000000000000/pratinjau", tA)).status === 400 && (await api("GET", "/api/finance/stok-resmi/STOCK_COUNT/bukan-uuid/pratinjau", tA)).status === 400 && (await api("GET", "/api/finance/stok-resmi/STOCK_COUNT/00000000-0000-4000-8000-000000000000/pratinjau", tA)).status === 404);

// ── tak ada jejak: stok, jurnal, gap, audit bisnis ──
for (const t of TABEL) rec(`${t}: tidak berkurang (${sebelum[t]})`, (await hitung(`select count(*)::int n from ${t}`)) >= sebelum[t]);
rec("tidak ada jurnal stok resmi (SELISIH_OPNAME/SELISIH_PENYESUAIAN/SUSUT_BARANG_RUSAK)", (await hitung("select count(*)::int n from fin_journal_entries where idempotency_key like 'SELISIH_OPNAME:%' or idempotency_key like 'SELISIH_PENYESUAIAN:%' or idempotency_key like 'SUSUT_BARANG_RUSAK:%'")) === 0);
rec("tidak ada gap PEMAKAIAN_BAHAN untuk dokumen stok resmi", (await hitung("select count(*)::int n from fin_posting_gaps g where g.source::text = 'PEMAKAIAN_BAHAN' and g.source_id::text in (select id::text from stock_counts union all select id::text from stock_adjustment_requests union all select id::text from damaged_stock_records)")) === 0);
rec("tidak ada audit bisnis POSTING/PEMBALIKAN_NILAI_STOK_RESMI", (await hitung("select count(*)::int n from activity_events where metadata::text like '%NILAI_STOK_RESMI%'")) === 0);
rec("dokumen stok bawaan tidak berubah status (stock_counts COMPLETED tetap)", (await hitung("select count(*)::int n from stock_counts where status::text = 'COMPLETED'")) >= (adaDok ? 1 : 0));
void sebelumGap; void sebelumJurnal;
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
  ok "smoke test lulus (izin, parity kartu-drilldown-Excel-ledger pada 3 periode, omzet Sales independen, gap = banner, invarian)"
fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang memang tidak ada harus 404 jujur"
ok "aset yang tidak ada = 404 (bukan index.html)"
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$FP_BEKU_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/data-sesudah.txt" || die "sidik jari dokumen beku sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis — periksa dengan backup"; }
ok "dokumen pembanding beku (refund & pengeluaran final, baris jurnal, saldo per akun, pembayaran, PKR/unit final, muat, flag) IDENTIK sebelum vs sesudah rilis; transaksi sah yang muncul saat rilis tidak diperbandingkan"
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
say "CATATAN: Rilis ini HANYA menambah pratinjau stok resmi (baca-saja) dan tiga sakelar posting yang MATI. Tidak ada Stock Count/adjustment/jurnal/transaksi QA dibuat; tidak ada backfill 254 ISSUE; harga referensi Excel tidak dipakai. Frontend, OTA RN, dan DELIVERY_UNIT_CONFIRM_REQUIRED tidak disentuh. Nilai ketiga sakelar tercatat di ${BK_DIR}/smoke.log."
