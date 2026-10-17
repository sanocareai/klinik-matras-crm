#!/usr/bin/env bash
# RILIS "PERBAIKAN CAKUPAN KOREKSI DOKUMEN": web + backend, TANPA migrasi dan TANPA perubahan schema.prisma — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • Daftar Koreksi Dokumen memuat order yang pengakuannya sudah DIBALIK (REVERSED-saja) — sebelumnya tersembunyi (kasus NEW-23092026-040); mengakui ulang butuh persetujuan eksplisit + alasan pembalikan ditampilkan.
#   • Dampak uang muka pada pratinjau bertanda KEWAJIBAN (berkurang = negatif). Jurnal tidak berubah; hanya ringkasan.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru dijalankan terhadap salinan restore: daftar/detail, parity SQL independen, pengakuan sungguhan + replay + paralel + periode tertutup + pembalikan,
#     harga Rp0, keputusan atribusi — semuanya pada salinan, lalu dihapus); smoke baca-saja pasca-switch (izin, penolakan tulis, parity daftar ↔ SQL ↔ laporan ↔ Excel, margin belum final, tak ada jejak tulis).
#   • Produksi: TIDAK ada pengakuan, harga, atau keputusan yang disimpan. Tidak ada transaksi QA.
#
#   cat scripts/release-koreksi-cakupan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/kc1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/kc1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/kc1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/kc1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa data baru). Kode lama (2550bc7f) tetap kompatibel dengan data.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/finance-koreksi-dokumen-cakupan}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/src/services/finance/koreksiDokumen/pengakuan\.js|backend/tests/integration/koreksiDokumen\.integration\.test\.js|backend/tests/integration/koreksiDokumenReleaseSmoke\.integration\.test\.js|docs/KOREKSI-DOKUMEN-LAPORAN\.md|frontend/src/features/finance/koreksiDokumen/KoreksiDokumen\.jsx|frontend/src/features/finance/koreksiDokumen/logic\.js|frontend/tests/koreksiDokumenLogic\.test\.js|scripts/release-koreksi-cakupan\.sh|scripts/release-koreksi-dokumen\.sh)$'
BACKEND_SRC_EXPECT="backend/src/services/finance/koreksiDokumen/pengakuan.js"
FRONTEND_SRC_EXPECT="frontend/src/features/finance/koreksiDokumen/KoreksiDokumen.jsx frontend/src/features/finance/koreksiDokumen/logic.js"
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
BK_DIR="$HOME/release-backups/koreksi-cakupan-${DEPLOY_SHORT}-${TS}"
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
Rilis ini TANPA migrasi dan TANPA tulisan data bisnis: rollback KODE aman kapan pun. Bila rollback setelah switch:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Kode lama (2550bc7f) tidak memuat order berpengakuan-dibalik di daftar koreksi dan salah menandai arah uang muka pada ringkasan pratinjau; data tidak terpengaruh.
Bila sudah ada keputusan atribusi aktif, periksa dulu: bash ${NEW_DIR}/scripts/rollback-guard-koreksi-dokumen.sh (baca-saja).
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
exec 9>/tmp/release-koreksi-cakupan.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "kc1\|release-koreksi-cakupan\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
# Rilis ini bergantung pada migrasi rilis sebelumnya: tabel keputusan atribusi HARUS sudah ada.
[ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='fin_attribution_decisions'")" = "1" ] || die "tabel fin_attribution_decisions belum ada (rilis 2550bc7f belum aktif?) — prasyarat"
KEP_N="$(psql_live -At -c "select count(*) from fin_attribution_decisions")"; AUD_N="$(psql_live -At -c "select count(*) from activity_events where metadata->>'aksi' in ('KOREKSI_PENGAKUAN_PENDAPATAN','PEMBALIKAN_KOREKSI_PENGAKUAN_PENDAPATAN','TETAPKAN_HARGA_ORDER_RP0','KEPUTUSAN_ATRIBUSI_DIVISI','KEPUTUSAN_ATRIBUSI_DIVISI_DICABUT')")"
ok "prasyarat: tabel keputusan atribusi ada; keputusan tersimpan=${KEP_N}, audit aksi koreksi=${AUD_N} (rilis ini tidak menambahnya)"
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
union all select 'v2_feature_flags', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from v2_feature_flags x"
FP_N=15
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
BACKUP_FILE="$HOME/backups/pre-koreksi-cakupan-${DEPLOY_SHORT}-${TS}.sql.gz"
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
# Fitur rilis ini + fitur rilis sebelumnya (jangan sampai hilang dari bundel).
for s1 in "Koreksi Dokumen" "Pengakuan Pendapatan" "Atribusi Beban Divisi" "Lihat pratinjau jurnal" "Akui pendapatan (PIN)" "Alasan pembalikan sebelumnya sudah saya selesaikan"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-koreksi-cakupan-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_koreksi_cakupan_${TS}"
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
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "rehearsal MENGUBAH isi tabel"; }
# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): daftar & detail semua order, parity SQL independen, pengakuan terkendali sungguhan
# (pratinjau, nyata, replay, paralel, periode tertutup, pembalikan), penetapan harga Rp0, keputusan atribusi + cabut. Semua pada salinan; DB dihapus di akhir.
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji aplikasi koreksi dokumen terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const P = await import("/app/src/services/finance/koreksiDokumen/pengakuan.js");
const A = await import("/app/src/services/finance/koreksiDokumen/atribusiDivisi.js");
const { bacaLaporanTerinci } = await import("/app/src/services/finance/laporanTerinci/index.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const ledger = async () => (await prisma.$queryRawUnsafe(`select count(distinct e.id)::int n, coalesce(sum(l.debit),0)::text d, coalesce(sum(l.credit),0)::text c from fin_journal_entries e left join fin_journal_lines l on l.entry_id = e.id`))[0];
const acts = () => num(`select count(*)::int n from activity_events`);
const user = await prisma.user.findFirst({ where: { role: { in: ["ADMIN", "OWNER"] } }, select: { id: true } }) ?? await prisma.user.findFirst({ select: { id: true } });
const hariIni = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const tx = (fn) => prisma.$transaction(fn, P.OPSI_TX);
const pad = (x) => Math.round(Number(x) * 100) / 100;

// ── A. daftar, detail, parity SQL independen (baca-saja) ──
const sebelumL = await ledger(); const sebelumA = await acts();
const semua = {};
for (const k of ["", "RIWAYAT_PRA_BUKU", "LAIN"]) semua[k] = await P.daftarPengakuan(prisma, { kelas: k || null });
const r = semua[""].ringkasan; const total = r.perluKeputusan.jumlah + r.nilaiNol.jumlah + r.riwayatPraBuku.jumlah + r.lain.jumlah;
const sqlTotal = await num(`select count(*)::int n from "Order" o where (
  (o.status::text in ('DELIVERED','SEWA_DIKIRIM','SEWA_DIAMBIL') and o.penjualan_karyawan_id is null and o.merged_into_order_id is null)
  or exists (select 1 from fin_posting_gaps g where g.source::text = 'PENGAKUAN_PENDAPATAN' and g.reason = 'NILAI_ORDER_NOL' and g.resolved_at is null and g.source_id = o.id))
  and not exists (select 1 from fin_journal_entries e where e.source_id = o.id and (e.source::text = 'PENGAKUAN_PENDAPATAN' or e.idempotency_key like 'PENGAKUAN_PENDAPATAN:%') and e.status::text = 'POSTED')
  and not exists (select 1 from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where l.order_id = o.id and e.status::text = 'POSTED' and (e.source::text = 'PENGAKUAN_PENDAPATAN' or e.idempotency_key like 'PENGAKUAN_PENDAPATAN:%'))`);
cek(`daftar pengakuan: jumlah semua kelas (${total}) = SQL independen (${sqlTotal})`, total === sqlTotal);
const gapNolSql = await num(`select count(*)::int n from fin_posting_gaps where source::text = 'PENGAKUAN_PENDAPATAN' and reason = 'NILAI_ORDER_NOL' and resolved_at is null`);
const gapNolDaftar = [...semua[""].daftar, ...semua.LAIN.daftar].filter((x) => x.tahan.some((t) => t.kode === "NILAI_ORDER_NOL")).length;
cek(`semua gap NILAI_ORDER_NOL terbuka (${gapNolSql}) muncul di daftar koreksi (${gapNolDaftar})`, gapNolDaftar >= gapNolSql - (await num(`select count(*)::int n from fin_posting_gaps g join "Order" o on o.id = g.source_id where g.source::text='PENGAKUAN_PENDAPATAN' and g.resolved_at is null and (o.penjualan_karyawan_id is not null or o.merged_into_order_id is not null)`)));
let detailGalat = 0; const detailSemua = [];
for (const x of [...semua[""].daftar, ...semua.RIWAYAT_PRA_BUKU.daftar, ...semua.LAIN.daftar]) {
  try { const d = await P.detailPengakuan(prisma, x.orderId); detailSemua.push(d); if (!(d.penyebab.length || d.tahan.length) && d.kelas !== "SUDAH_DIAKUI") detailGalat += 1; } catch (e) { detailGalat += 1; console.log("  detail gagal " + x.nomor + ": " + e.message); }
}
cek(`detail ${detailSemua.length} order: bukti, penyebab/alasan tertahan terisi, tanpa galat`, detailGalat === 0);
cek("tidak ada tanggal/harga yang diisi otomatis oleh sistem (pilihan tanggal hanya dari bukti; Keputusan Owner tanpa tanggal bawaan)", detailSemua.every((d) => d.pilihanTanggal.find((p) => p.dasar === "KEPUTUSAN_OWNER").tanggal === null && d.items.every((i) => i.harga === 0 || i.harga > 0)));
const stlh = await ledger();
cek("pembacaan daftar/detail tidak mengubah ledger maupun audit", JSON.stringify(sebelumL) === JSON.stringify(stlh) && sebelumA === await acts());

// ── B. pengakuan terkendali sungguhan pada salinan ──
const kandidat = [];
for (const x of semua[""].daftar.filter((y) => y.kelas === "PERLU_KEPUTUSAN" && y.bisaDiproses)) kandidat.push(await P.detailPengakuan(prisma, x.orderId));
console.log(`INFO kandidat pengakuan yang bisa diproses pada salinan: ${kandidat.length}`);
const masukan = (d, alasan) => {
  const pod = d.pilihanTanggal.find((p) => p.dasar === "TANGGAL_SERAH_POD" && p.tersedia);
  const dibalik = d.tahan.some((t) => t.kode === "PENGAKUAN_DIBALIK_SENGAJA") ? { akuiSetelahDibalik: true } : {};
  if (pod && !d.praCutoff) return { dasarTanggal: pod.dasar, tanggal: pod.tanggal, alasan, ...dibalik };
  const st = d.pilihanTanggal.find((p) => p.dasar === "TANGGAL_STATUS_DISERAHKAN" && p.tersedia);
  if (st && !d.praCutoff && !d.tahan.some((t) => t.kode === "SERAH_TIDAK_TERBUKTI")) return { dasarTanggal: st.dasar, tanggal: st.tanggal, alasan, ...dibalik };
  return { dasarTanggal: "KEPUTUSAN_OWNER", tanggal: d.hariIni, buktiReferensi: "uji rehearsal pada salinan restore", alasan, ...(d.praCutoff ? { akuiPraCutoff: true } : {}), ...(d.tahan.some((t) => t.kode === "PENGAKUAN_DIBALIK_SENGAJA") ? { akuiSetelahDibalik: true } : {}) };
};
const ALASAN = "uji rehearsal pada salinan restore (bukan transaksi nyata)";
if (kandidat.length === 0) console.log("SKIP tidak ada order yang bisa diproses pada salinan — pengakuan sungguhan diuji di tes integrasi");
else {
  const d = kandidat[0]; const inp = masukan(d, ALASAN); const nilai = d.nilaiKotor + d.ongkir;
  const L0 = await ledger(); const A0 = await acts();
  const lap0 = await bacaLaporanTerinci(prisma, { fromStr: inp.tanggal, toStr: hariIni, bolehSensitif: true });
  const pr = await P.jalankanPratinjau(prisma, (t) => P.pengakuanTerkendali(t, { orderId: d.orderId, input: inp, userId: user.id, preview: true }));
  cek(`pratinjau ${d.nomor}: jurnal seimbang, dampak pendapatan = nilai order (${nilai})`, pr.jurnal.totalDebit === pr.jurnal.totalKredit && pad(pr.dampak.pendapatanBertambah) === pad(nilai));
  cek(`pratinjau ${d.nomor}: dampak uang muka bertanda kewajiban (${pr.dampak.uangMukaPelangganBerubah} ≤ 0 = berkurang)`, pr.dampak.uangMukaPelangganBerubah <= 0 && pad(pr.dampak.uangMukaPelangganBerubah) === pad(-Math.min(d.bukti.uangMukaDiBuku, nilai)));
  cek("pratinjau di-rollback: ledger & audit tidak berubah", JSON.stringify(await ledger()) === JSON.stringify(L0) && A0 === await acts());
  const h = await tx((t) => P.pengakuanTerkendali(t, { orderId: d.orderId, input: inp, userId: user.id }));
  cek(`pengakuan nyata ${d.nomor} (${inp.dasarTanggal} ${inp.tanggal}) dibuat`, h.dibuat === true && h.status === "DIAKUI", h.nomorJurnal);
  const L1 = await ledger();
  cek("ledger: tepat +1 jurnal dan debit = kredit global tetap seimbang", L1.n === L0.n + 1 && pad(Number(L1.d) - Number(L0.d)) === pad(Number(L1.c) - Number(L0.c)));
  const lap1 = await bacaLaporanTerinci(prisma, { fromStr: inp.tanggal, toStr: hariIni, bolehSensitif: true });
  cek("laporan terinci: pendapatan bertambah tepat sebesar nilai order; semua kontrol parity OK; residual jembatan Rp0", pad(lap1.ringkasan.pendapatanBersih - lap0.ringkasan.pendapatanBersih) === pad(nilai) && lap1.kontrol.semuaOk && lap1.jembatan.residual.nol, `Δ=${pad(lap1.ringkasan.pendapatanBersih - lap0.ringkasan.pendapatanBersih)}`);
  const ulang = await tx((t) => P.pengakuanTerkendali(t, { orderId: d.orderId, input: inp, userId: user.id }));
  cek("replay: SUDAH_DIAKUI tanpa jurnal kedua", ulang.dibuat === false && (await ledger()).n === L1.n);
  const kembali = await tx((t) => P.balikPengakuan(t, { orderId: d.orderId, alasan: "uji pembalikan pada salinan restore", userId: user.id })).catch((e) => e);
  if (kembali instanceof Error) cek(`pembalikan ditolak aman (${kembali.code})`, ["ADA_TRANSAKSI_BERGANTUNG", "BUKAN_HASIL_KOREKSI", "PERIODE_TERTUTUP"].includes(kembali.code), kembali.message);
  else {
    const lap2 = await bacaLaporanTerinci(prisma, { fromStr: inp.tanggal, toStr: hariIni, bolehSensitif: true });
    cek("pembalikan: pendapatan kembali ke semula; kontrol parity OK", kembali.status === "DIBALIK" && pad(lap2.ringkasan.pendapatanBersih) === pad(lap0.ringkasan.pendapatanBersih) && lap2.kontrol.semuaOk);
  }
  if (kandidat.length > 1) {
    const d2 = kandidat[1]; const inp2 = masukan(d2, ALASAN);
    await prisma.finPeriod.upsert({ where: { year_month: { year: Number(inp2.tanggal.slice(0, 4)), month: Number(inp2.tanggal.slice(5, 7)) } }, update: { status: "CLOSED" }, create: { year: Number(inp2.tanggal.slice(0, 4)), month: Number(inp2.tanggal.slice(5, 7)), status: "CLOSED" } });
    const Lc = await ledger(); const Ac = await acts();
    const tutup = await tx((t) => P.pengakuanTerkendali(t, { orderId: d2.orderId, input: inp2, userId: user.id })).catch((e) => e);
    cek(`periode tertutup menolak pengakuan ${d2.nomor} tanpa jejak`, tutup instanceof Error && tutup.code === "PERIODE_TERTUTUP" && JSON.stringify(await ledger()) === JSON.stringify(Lc) && Ac === await acts());
    await prisma.finPeriod.update({ where: { year_month: { year: Number(inp2.tanggal.slice(0, 4)), month: Number(inp2.tanggal.slice(5, 7)) } }, data: { status: "OPEN" } });
    const par = await Promise.all(Array.from({ length: 4 }, () => tx((t) => P.pengakuanTerkendali(t, { orderId: d2.orderId, input: inp2, userId: user.id })).catch((e) => e)));
    const dibuat = par.filter((x) => x && x.dibuat === true).length;
    cek(`paralel x4 untuk ${d2.nomor}: tepat satu jurnal`, dibuat === 1 && (await num(`select count(*)::int n from fin_journal_entries where idempotency_key like 'PENGAKUAN_PENDAPATAN:${d2.orderId}%' and status::text='POSTED'`)) === 1, par.map((x) => x?.status ?? x?.code).join(","));
  } else console.log("SKIP periode tertutup & paralel: hanya satu kandidat pada salinan (diuji di tes integrasi)");
}

// ── C. order Rp0: tetapkan harga (butuh bukti) lalu akui ──
const nol = semua[""].daftar.find((x) => x.kelas === "NILAI_NOL");
if (!nol) console.log("SKIP tidak ada order Rp0 pada salinan");
else {
  const d = await P.detailPengakuan(prisma, nol.orderId); const item = d.items.find((i) => !i.harga);
  if (!item) console.log(`SKIP ${d.nomor}: tidak ada item (harga tidak bisa diisi tanpa item)`);
  else {
    const tanpaBukti = await tx((t) => P.tetapkanHarga(t, { orderId: d.orderId, harga: [{ itemId: item.id, harga: 100000 }], buktiHarga: "", alasan: ALASAN, userId: user.id })).catch((e) => e);
    cek(`harga ${d.nomor}: tanpa bukti ditolak (sistem tidak menebak harga)`, tanpaBukti instanceof Error && tanpaBukti.code === "BUKTI_HARGA_WAJIB");
    const Lh = await ledger();
    const hasil = await tx((t) => P.tetapkanHarga(t, { orderId: d.orderId, harga: [{ itemId: item.id, harga: 100000 }], buktiHarga: "uji rehearsal salinan restore", alasan: ALASAN, userId: user.id }));
    cek("penetapan harga: Order.value = Σ item; TIDAK ada jurnal baru", hasil.dibuat === true && (await ledger()).n === Lh.n && (await num(`select (select coalesce(value,0) from "Order" where id='${d.orderId}') - (select coalesce(sum(harga),0) from "OrderItem" where "orderId"='${d.orderId}') as n`)) === 0);
    const lagi = await tx((t) => P.tetapkanHarga(t, { orderId: d.orderId, harga: [{ itemId: item.id, harga: 120000 }], buktiHarga: "uji rehearsal salinan restore", alasan: ALASAN, userId: user.id })).catch((e) => e);
    cek("harga yang sudah terisi tidak bisa diubah dari sini", lagi instanceof Error && lagi.code === "ITEM_SUDAH_BERHARGA");
    const d2 = await P.detailPengakuan(prisma, d.orderId);
    console.log(`INFO ${d.nomor} setelah harga: kelas=${d2.kelas} tahan=${d2.tahan.map((t) => t.kode).join(",") || "-"}`);
  }
}

// ── D. keputusan atribusi divisi ──
const awal = (await prisma.$queryRawUnsafe(`select min(date)::text d from fin_journal_entries`))[0].d?.slice(0, 10) ?? "2026-01-01";
const dAtr = await A.daftarAtribusi(prisma, { fromStr: awal, toStr: hariIni });
const lapAtr = await bacaLaporanTerinci(prisma, { fromStr: awal, toStr: hariIni, bolehSensitif: true });
cek(`atribusi: baris konflik daftar (${dAtr.ringkasan.barisKonflikLaporan}) = laporan (${lapAtr.bebanDivisi.konflik.jumlahBaris})`, dAtr.ringkasan.barisKonflikLaporan === lapAtr.bebanDivisi.konflik.jumlahBaris);
const calon = dAtr.daftar.find((x) => x.status === "MENUNGGU_KEPUTUSAN" && x.bisaDiputuskan);
if (!calon) console.log("SKIP tidak ada dokumen konflik atribusi yang bisa diputuskan pada salinan");
else {
  const scope = calon.kandidat.map((k) => k.scope).find((s) => s !== calon.divisiSaatIni);
  const pv = await A.pratinjauKeputusan(prisma, { modul: calon.modul, documentId: calon.dokumenId, scope });
  cek(`pratinjau atribusi ${calon.nomor}: ${pv.dampak?.dariDivisi} → ${pv.dampak?.keDivisi}`, pv.bisaDiputuskan && !!pv.dampak);
  const L0 = await ledger();
  const r1 = await tx((t) => A.putuskanAtribusi(t, { modul: calon.modul, documentId: calon.dokumenId, scope, alasan: "uji rehearsal pada salinan restore", userId: user.id }));
  const lap1 = await bacaLaporanTerinci(prisma, { fromStr: awal, toStr: hariIni, bolehSensitif: true });
  cek("keputusan: konflik dokumen itu hilang; total beban per divisi = ledger; jurnal tidak berubah; kontrol OK",
    r1.dibuat === true && lap1.bebanDivisi.konflik.jumlahBaris === lapAtr.bebanDivisi.konflik.jumlahBaris - calon.jumlahBaris && lap1.bebanDivisi.totalDivisi === lapAtr.bebanDivisi.totalDivisi && lap1.kontrol.semuaOk && JSON.stringify(await ledger()) === JSON.stringify(L0));
  const ulang = await tx((t) => A.putuskanAtribusi(t, { modul: calon.modul, documentId: calon.dokumenId, scope, alasan: "uji rehearsal pada salinan restore", userId: user.id }));
  cek("replay keputusan: SUDAH_DIPUTUSKAN, satu baris aktif", ulang.dibuat === false && (await num(`select count(*)::int n from fin_attribution_decisions where document_id='${calon.dokumenId}' and revoked_at is null`)) === 1);
  const cb = await tx((t) => A.cabutKeputusan(t, { modul: calon.modul, documentId: calon.dokumenId, alasan: "uji pencabutan pada salinan restore", userId: user.id }));
  const lap2 = await bacaLaporanTerinci(prisma, { fromStr: awal, toStr: hariIni, bolehSensitif: true });
  cek("pencabutan: konflik kembali seperti semula; riwayat tetap (2 baris? 1 baris dicabut)", cb.status === "DICABUT" && lap2.bebanDivisi.konflik.jumlahBaris === lapAtr.bebanDivisi.konflik.jumlahBaris && (await num(`select count(*)::int n from fin_attribution_decisions where document_id='${calon.dokumenId}'`)) === 1);
}
await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah uji baca-saja; uji tulis dilakukan pada salinan lalu DB sementara dihapus"

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
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin, penolakan tulis sebelum menyentuh data, parity daftar koreksi ↔ SQL independen ↔ laporan ↔ Excel, margin belum final, tak ada jejak tulis"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const tulis = [];
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  if (method !== "GET") tulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status, preview: !!(body && body.preview) });
  return { status: r.status, json };
}
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const fin = await userDengan("FINANCE", new Set(["ADMIN", "OWNER"]));
const sales = await userDengan("SALES", BERIZIN);
if (!adm || !sales) { rec("akun ADMIN dan SALES murni tersedia", false, `adm=${!!adm} sales=${!!sales}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales); const tF = fin ? await tokenUntuk(fin) : null;
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const B = (k) => Number(process.env[k]);
const sama = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
// Jejak tulis diukur pada artefak yang HANYA dibuat endpoint rilis ini (transaksi sah pengguna lain selama rilis tidak boleh membuat smoke gagal): keputusan atribusi dan audit aksi koreksi.
const snap = async () => ({ keputusan: await hitung("select count(*)::int n from fin_attribution_decisions"), auditKoreksi: await hitung("select count(*)::int n from activity_events where metadata->>'aksi' in ('KOREKSI_PENGAKUAN_PENDAPATAN','PEMBALIKAN_KOREKSI_PENGAKUAN_PENDAPATAN','TETAPKAN_HARGA_ORDER_RP0','KEPUTUSAN_ATRIBUSI_DIVISI','KEPUTUSAN_ATRIBUSI_DIVISI_DICABUT')") });
const sebelum = await snap();
const hariIni = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

// ── izin ──
const P0 = "/api/finance/koreksi/pengakuan"; const A0 = "/api/finance/koreksi/atribusi";
rec("daftar koreksi: tanpa token 401, SALES 403 (pengakuan & atribusi)", (await api("GET", P0, null)).status === 401 && (await api("GET", P0, tS)).status === 403 && (await api("GET", `${A0}?from=2026-10-01&to=${hariIni}`, tS)).status === 403);
const dft = await api("GET", P0, tA);
rec("Admin: daftar pengakuan 200", dft.status === 200, String(dft.status));
if (dft.status !== 200) process.exit(1);
const D = dft.json;
const lap = await api("GET", `/api/finance/reports/income-statement/terinci?from=2026-10-01&to=${hariIni}`, tA);
rec("laporan terinci 200; kontrol parity server semua OK; residual jembatan Rp0", lap.status === 200 && lap.json.kontrol.semuaOk && lap.json.jembatan.residual.nol, lap.json?.kontrol?.daftar?.filter((k) => !k.ok).map((k) => k.kunci).join(","));
// ── parity daftar ↔ SQL independen ──
const semuaKelas = [D, (await api("GET", P0 + "?kelas=RIWAYAT_PRA_BUKU", tA)).json, (await api("GET", P0 + "?kelas=LAIN", tA)).json];
const r = D.ringkasan; const total = r.perluKeputusan.jumlah + r.nilaiNol.jumlah + r.riwayatPraBuku.jumlah + r.lain.jumlah;
const sqlTotal = await hitung(`select count(*)::int n from "Order" o where (
  (o.status::text in ('DELIVERED','SEWA_DIKIRIM','SEWA_DIAMBIL') and o.penjualan_karyawan_id is null and o.merged_into_order_id is null)
  or exists (select 1 from fin_posting_gaps g where g.source::text = 'PENGAKUAN_PENDAPATAN' and g.reason = 'NILAI_ORDER_NOL' and g.resolved_at is null and g.source_id = o.id))
  and not exists (select 1 from fin_journal_entries e where e.source_id = o.id and (e.source::text = 'PENGAKUAN_PENDAPATAN' or e.idempotency_key like 'PENGAKUAN_PENDAPATAN:%') and e.status::text = 'POSTED')
  and not exists (select 1 from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where l.order_id = o.id and e.status::text = 'POSTED' and (e.source::text = 'PENGAKUAN_PENDAPATAN' or e.idempotency_key like 'PENGAKUAN_PENDAPATAN:%'))`);
// Cakupan: order berstatus serah yang pengakuannya HANYA REVERSED (sudah dibalik, tidak aktif) harus tampil (kasus NEW-23092026-040).
const dibalikSaja = await prisma.$queryRawUnsafe(`select o.id, o."orderNumber" nomor from "Order" o where o.status::text in ('DELIVERED','SEWA_DIKIRIM','SEWA_DIAMBIL') and o.penjualan_karyawan_id is null and o.merged_into_order_id is null and exists (select 1 from fin_journal_entries e where e.idempotency_key like 'PENGAKUAN_PENDAPATAN:' || o.id || '%' and e.status::text = 'REVERSED') and not exists (select 1 from fin_journal_entries e where e.idempotency_key like 'PENGAKUAN_PENDAPATAN:' || o.id || '%' and e.status::text = 'POSTED')`);
const idsSemua = new Set(semuaKelas.flatMap((x) => x?.daftar ?? []).map((x) => x.orderId));
rec(`order dengan pengakuan DIBALIK-saja (${dibalikSaja.length}: ${dibalikSaja.map((x) => x.nomor).join(",") || "-"}) semuanya tampil di daftar koreksi`, dibalikSaja.every((x) => idsSemua.has(x.id)));
rec(`jumlah order belum diakui semua kelas (${total}) = SQL independen (${sqlTotal})`, total === sqlTotal);
console.log(`  INFO  hitungan SAAT INI (dibaca ulang saat rilis): perlu keputusan ${r.perluKeputusan.jumlah} (Rp${r.perluKeputusan.nilai}), harga Rp0 ${r.nilaiNol.jumlah}, riwayat sebelum buku besar ${r.riwayatPraBuku.jumlah} (Rp${r.riwayatPraBuku.nilai}), lain-lain ${r.lain.jumlah}; cutoff ${D.cutoff}`);
const gapNolSql = await hitung(`select count(*)::int n from fin_posting_gaps g join "Order" o on o.id = g.source_id where g.source::text='PENGAKUAN_PENDAPATAN' and g.reason='NILAI_ORDER_NOL' and g.resolved_at is null and o.penjualan_karyawan_id is null and o.merged_into_order_id is null`);
const idsDaftar = new Set(semuaKelas.flatMap((x) => x?.daftar ?? []).map((x) => x.orderId));
const gapOrder = lap.json.gap.daftar.filter((g) => g.jenis === "BELUM_BERHARGA");
rec(`gap NILAI_ORDER_NOL non-PKR (${gapNolSql}) = BELUM_BERHARGA di laporan (${gapOrder.length}); semuanya punya orderId dan ada di daftar koreksi`, gapNolSql === gapOrder.length && gapOrder.every((g) => g.orderId && idsDaftar.has(g.orderId)));
rec("order 'diserahkan tanpa gap' di laporan semuanya ada di daftar koreksi (dengan kelas & alasan)", lap.json.gap.tanpaGap.every((g) => g.orderId && idsDaftar.has(g.orderId)), `${lap.json.gap.tanpaGap.length} order`);
rec("tiap baris daftar: bukti serah/alasan tertahan terisi; nilai Rp0 tidak diberi nilai karangan", semuaKelas.flatMap((x) => x?.daftar ?? []).every((x) => (x.tahan.length > 0 || x.tanggalSerah || x.dibayar >= 0) && (x.kelas !== "NILAI_NOL" || x.nilai === 0)));
// ── detail & PRATINJAU (di-rollback) untuk beberapa order ──
let n = 0; let pratinjauOk = true; let pratinjauJumlah = 0;
for (const x of semuaKelas.flatMap((y) => y?.daftar ?? []).slice(0, 12)) {
  const d = await api("GET", `${P0}/${x.orderId}`, tA);
  if (d.status !== 200 || !Array.isArray(d.json.penyebab) || !Array.isArray(d.json.tahan) || !Array.isArray(d.json.pilihanTanggal)) pratinjauOk = false;
  n += 1;
}
rec(`detail ${n} order pertama: 200 dengan bukti, penyebab, tanggal serah, pilihan tanggal`, pratinjauOk && n > 0);
const calon = D.daftar.find((x) => x.kelas === "PERLU_KEPUTUSAN" && x.bisaDiproses);
if (calon) {
  const det = (await api("GET", `${P0}/${calon.orderId}`, tA)).json;
  const pr = await api("POST", `${P0}/${calon.orderId}/akui`, tA, { preview: true, dasarTanggal: "KEPUTUSAN_OWNER", tanggal: hariIni, buktiReferensi: "smoke pratinjau (dibatalkan)", alasan: "smoke pratinjau rilis (di-rollback)", akuiPraCutoff: true, akuiSetelahDibalik: true });
  rec(`pratinjau pengakuan ${calon.nomor} (di-rollback): jurnal seimbang, dampak pendapatan = nilai order`, pr.status === 200 && pr.json.pratinjau.jurnal.totalDebit === pr.json.pratinjau.jurnal.totalKredit && sama(pr.json.pratinjau.dampak.pendapatanBertambah, calon.nilai), `${pr.status} ${pr.json?.error ?? ""}`);
  if (pr.status === 200) rec(`dampak uang muka bertanda KEWAJIBAN: uang muka di buku ${calon.uangMukaDiBuku} → perubahan ${pr.json.pratinjau.dampak.uangMukaPelangganBerubah} (≤ 0, berkurang)`, pr.json.pratinjau.dampak.uangMukaPelangganBerubah <= 0 && sama(pr.json.pratinjau.dampak.uangMukaPelangganBerubah, -Math.min(calon.uangMukaDiBuku, calon.nilai)));
  pratinjauJumlah += 1;
} else skip("pratinjau pengakuan sungguhan", "tidak ada order PERLU_KEPUTUSAN yang bisa diproses saat ini");
const dAtr = await api("GET", `${A0}?from=2026-10-01&to=${hariIni}`, tA);
rec("daftar atribusi 200", dAtr.status === 200, String(dAtr.status));
const kl = lap.json.bebanDivisi.konflik;
rec(`atribusi: baris konflik (${dAtr.json.ringkasan.barisKonflikLaporan}, Rp${dAtr.json.ringkasan.nilaiBarisKonflikLaporan}) = laporan Beban per Divisi (${kl.jumlahBaris}, Rp${kl.nominal})`, dAtr.json.ringkasan.barisKonflikLaporan === kl.jumlahBaris && sama(dAtr.json.ringkasan.nilaiBarisKonflikLaporan, kl.nominal));
console.log(`  INFO  atribusi menunggu keputusan: ${dAtr.json.ringkasan.menunggu} dokumen (Rp${dAtr.json.ringkasan.nilaiMenunggu}); sudah diputuskan ${dAtr.json.ringkasan.diputuskan}`);
const adaAtr = dAtr.json.daftar.find((x) => x.bisaDiputuskan);
if (adaAtr) {
  const pv = await api("GET", `${A0}/${adaAtr.modul}/${adaAtr.dokumenId}?scope=${adaAtr.kandidat[0].scope}`, tA);
  rec(`pratinjau atribusi ${adaAtr.nomor}: 200, bukti & kandidat tampil, dampak tidak mengubah total`, pv.status === 200 && pv.json.pratinjau.bukti.length >= 1 && pv.json.pratinjau.kandidat.length >= 2, String(pv.status));
} else skip("pratinjau atribusi", "tidak ada konflik atribusi pada periode");
rec("Σ beban per divisi = ledger (kontrol 'beban_divisi' OK) dan margin: status mutu dari server", lap.json.kontrol.daftar.find((k) => k.kunci === "beban_divisi")?.ok === true && typeof lap.json.hpp.status === "string");
const issueTanpaHarga = await hitung(`select count(*)::int n from stock_movements m where m.type::text = 'ISSUE' and not exists (select 1 from fin_stock_movement_valuations v where v.movement_id = m.id and v.status::text = 'DINILAI')`);
rec(`margin tetap 'belum final' selama HPP bahan belum lengkap (ISSUE tanpa nilai: ${issueTanpaHarga}; status=${lap.json.hpp.status})`, issueTanpaHarga === 0 || lap.json.hpp.status !== "LENGKAP");
// ── Excel = layar ──
const x = await fetch(BASE + "/api/finance/export/laporan-keuangan", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tA }, body: JSON.stringify({ periode: { from: "2026-10-01", to: hariIni }, filter: { cutoffLayar: lap.json.cutoff.diambilPadaWib } }) });
tulis.push({ n: "POST /api/finance/export/laporan-keuangan", status: x.status, preview: true });
if (!/spreadsheetml/.test(x.headers.get("content-type") || "")) rec("Export Excel terbit", false, String(x.status));
else {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await x.arrayBuffer()));
  const ws = wb.getWorksheet("Ringkasan"); const nil = (c) => (c.value && typeof c.value === "object" && "result" in c.value ? c.value.result : c.value);
  const peta = new Map(); ws.eachRow((row) => { const a = nil(row.getCell(1)); const b = nil(row.getCell(2)); if (typeof a === "string" && typeof b === "number") peta.set(a, b); });
  const R = lap.json.ringkasan;
  rec("Excel Ringkasan = kartu layar (pendapatan bersih, beban pokok, laba kotor, beban operasional, laba bersih) sampai rupiah", sama(peta.get("Pendapatan Bersih"), R.pendapatanBersih) && sama(peta.get("Beban Pokok (HPP)"), R.bebanPokok) && sama(peta.get("Laba Kotor"), R.labaKotor) && sama(peta.get("Beban Operasional"), R.bebanOperasional) && sama(peta.get("Laba Bersih"), R.labaBersih));
  const kf = wb.getWorksheet("Konflik Atribusi"); let nk = 0; kf.eachRow((row, i) => { if (i >= 6 && /^JV-/.test(String(nil(row.getCell(1)) ?? ""))) nk += 1; });
  rec(`Excel 'Konflik Atribusi' (${nk} baris) = layar (${kl.jumlahBaris})`, nk === kl.jumlahBaris);
}
// ── IZIN TULIS & penolakan sebelum menyentuh data ──
// Target uji penolakan: order yang LOLOS validasi (agar penolakan memang datang dari PIN step-up, bukan dari validasi data); bila tidak ada, order pertama mana pun.
const target = calon ?? D.daftar[0] ?? semuaKelas.flatMap((y) => y?.daftar ?? [])[0];
if (target) {
  const uAkui = `${P0}/${target.orderId}/akui`; const body = { dasarTanggal: "KEPUTUSAN_OWNER", tanggal: hariIni, buktiReferensi: "smoke penolakan", alasan: "smoke penolakan rilis (harus ditolak)", akuiPraCutoff: true, akuiSetelahDibalik: true };
  rec("tulis tanpa token 401; SALES 403", (await api("POST", uAkui, null, body, { "Idempotency-Key": "smoke-kd-anon-0001" })).status === 401 && (await api("POST", uAkui, tS, body, { "Idempotency-Key": "smoke-kd-sales-001" })).status === 403);
  if (tF) rec("Finance biasa (bukan Admin/Owner): pratinjau baca 200 tetapi menulis 403", (await api("GET", `${P0}/${target.orderId}`, tF)).status === 200 && (await api("POST", uAkui, tF, body, { "Idempotency-Key": "smoke-kd-fin-00001" })).status === 403 && (await api("POST", `${P0}/${target.orderId}/balik`, tF, { alasan: "smoke" }, { "Idempotency-Key": "smoke-kd-fin-00002" })).status === 403);
  else skip("izin Finance biasa", "tidak ada akun FINANCE murni aktif (diuji di tes integrasi)");
  const k428 = (await api("POST", uAkui, tA, body)).status; const k403 = await api("POST", uAkui, tA, body, { "Idempotency-Key": "smoke-kd-admin-0001" });
  if (calon) rec("Admin: tanpa Idempotency-Key 428; dengan kunci tetapi TANPA PIN step-up ditolak (403) sebelum menulis", k428 === 428 && k403.status === 403 && /STEPUP/.test(k403.json?.code ?? ""), `${k428},${k403.status},${k403.json?.code}`);
  else rec("Admin: tanpa Idempotency-Key 428; dengan kunci tetapi data ditolak validasi (4xx) sebelum menulis [tidak ada order yang lolos validasi untuk menguji PIN langsung — PIN diuji di tes integrasi]", k428 === 428 && k403.status >= 400 && k403.status < 500, `${k428},${k403.status}`);
  const a1 = await api("POST", `${P0}/${target.orderId}/harga`, tA, { harga: [{ itemId: "x", harga: 1 }], alasan: "smoke penolakan rilis", buktiHarga: "smoke penolakan" }, { "Idempotency-Key": "smoke-kd-admin-0002" });
  const a2 = await api("POST", `${P0}/${target.orderId}/balik`, tA, { alasan: "smoke penolakan rilis" }, { "Idempotency-Key": "smoke-kd-admin-0003" });
  // pembalikan untuk order TANPA pengakuan aktif = no-op idempoten (200, tidak menulis); untuk order berpengakuan butuh PIN (403).
  const noop = a2.status === 200 && a2.json?.status === "TIDAK_ADA_PENGAKUAN_AKTIF"; if (noop) tulis[tulis.length - 1].preview = true;
  rec("Admin tanpa PIN: tetapkan harga ditolak (4xx); pembalikan ditolak (4xx) atau no-op idempoten tanpa pengakuan aktif", a1.status >= 400 && a1.status < 500 && ((a2.status >= 400 && a2.status < 500) || noop), `${a1.status},${a2.status}${noop ? " (no-op)" : ""}`);
}
if (adaAtr) {
  const ua = `${A0}/${adaAtr.modul}/${adaAtr.dokumenId}`; const ba = { scope: adaAtr.kandidat[0].scope, alasan: "smoke penolakan rilis (harus ditolak)" };
  rec("atribusi: tanpa token 401; SALES 403; Admin tanpa PIN 403; tanpa Idempotency-Key 428", (await api("POST", ua, null, ba, { "Idempotency-Key": "smoke-kd-atr-00001" })).status === 401 && (await api("POST", ua, tS, ba, { "Idempotency-Key": "smoke-kd-atr-00002" })).status === 403 && (await api("POST", ua, tA, ba, { "Idempotency-Key": "smoke-kd-atr-00003" })).status === 403 && (await api("POST", ua, tA, ba)).status === 428);
}
rec("ID rusak 400; order tak ada 404; kelas ngawur 400", (await api("GET", P0 + "/!!!", tA)).status === 400 && (await api("GET", P0 + "/ordertidakada123456", tA)).status === 404 && (await api("GET", P0 + "?kelas=NGAWUR", tA)).status === 400);
// ── DAFTAR MENUNGGU Owner (dicetak ke log; bukan penyelesaian akuntansi) ──
console.log("  INFO  === DAFTAR YANG MASIH MENUNGGU BUKTI/KEPUTUSAN OWNER (tidak ditandai selesai) ===");
for (const g of [["PERLU_KEPUTUSAN", D.daftar.filter((y) => y.kelas === "PERLU_KEPUTUSAN")], ["NILAI_NOL", D.daftar.filter((y) => y.kelas === "NILAI_NOL")]]) for (const o of g[1]) console.log(`  INFO  ${g[0]} ${o.nomor} ${o.status}/${o.statusBayar} nilai=${o.nilai} serah=${o.tanggalSerah ?? "tidak terbukti"} dibayar=${o.dibayar} tahan=${o.tahan.map((t) => t.kode).join("+") || "-"} penyebab=${o.penyebab.join("+") || "-"}`);
console.log(`  INFO  RIWAYAT_PRA_BUKU ${semuaKelas[1].daftar.length} order (hanya dihitung; tidak diperinci)`);
for (const o of dAtr.json.daftar.filter((y) => y.status === "MENUNGGU_KEPUTUSAN")) console.log(`  INFO  ATRIBUSI ${o.nomor ?? o.jurnal.join(",")} Rp${o.nilai} saat ini=${o.divisiSaatIniLabel} kandidat=${o.kandidat.map((k) => k.label).join(" vs ")}`);
// ── tak ada jejak tulis ──
const sesudah = await snap();
rec("TIDAK ada jejak tulis dari smoke: tidak ada keputusan atribusi dan tidak ada audit aksi koreksi (pengakuan, harga, pembalikan, keputusan) yang tercipta — sama persis dengan sebelum smoke", JSON.stringify(sebelum) === JSON.stringify(sesudah), JSON.stringify(sesudah));
rec("semua " + tulis.length + " pemanggilan non-GET: pratinjau (di-rollback), export (baca-saja), atau DITOLAK sebelum menyentuh data (tidak ada 2xx tulis)", tulis.every((b) => b.preview ? [200, 400, 403, 422, 409].includes(b.status) : [401, 403, 428, 400, 404, 409, 422].includes(b.status)), tulis.map((b) => b.status).join(","));
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("tiap refund punya paling banyak SATU jurnal berlaku (ganda sebelum rilis: " + B("BASE_GANDA") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x")) <= B("BASE_GANDA"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP); pratinjau sungguhan di-rollback: " + pratinjauJumlah);
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else
  ok "smoke test lulus (izin, penolakan tulis sebelum menyentuh data, parity daftar koreksi ↔ SQL independen ↔ laporan ↔ Excel, cakupan order berpengakuan-dibalik, margin belum final, tak ada jejak tulis, invarian)"
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
say "CATATAN: Rilis ini hanya memperbaiki cakupan daftar Koreksi Dokumen (order berpengakuan-dibalik kini tampil) dan arah ringkasan uang muka. TIDAK ada pengakuan, harga, atau keputusan yang disimpan; tanpa migrasi; 254 ISSUE & harga referensi Excel tidak disentuh; margin tetap belum final. OTA RN dan DELIVERY_UNIT_CONFIRM_REQUIRED tidak disentuh."
