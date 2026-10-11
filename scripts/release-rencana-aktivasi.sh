#!/usr/bin/env bash
# RILIS "RENCANA PRODUKSI — SERET UNIT BELUM AKTIF": web + backend, TANPA migrasi, TANPA perubahan data — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
# Diturunkan dari release-penerimaan-kosong.sh. Perubahan: ADMIN/OWNER boleh menyeret/menjadwalkan unit yang BELUM diaktifkan; unit ditambahkan ke cohort SAAT jadwal disimpan, dalam SATU
# transaksi dengan Run + rencana, hanya untuk unit TANPA Run apa pun dan tanpa progres V1, dan hanya dengan persetujuan eksplisit di modal. Rilis ini hanya KODE: tidak mengaktifkan unit,
# tidak mengubah cohort/setting/PIC/pemetaan, tidak menjadwalkan order nyata, tidak membuat transaksi QA di produksi.
#
#   cat scripts/release-rencana-aktivasi.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rnak1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rnak1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rnak1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/rnak1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/rencana-drag-belum-aktif}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/src/lib/activityLog\.js|backend/src/lib/domain/productionRencana\.js|backend/src/routes/productionExperience\.js|backend/src/services/productionBacklog\.js|backend/src/services/productionRencanaService\.js|backend/tests/rencanaAktivasiSaatJadwalkan\.test\.js|backend/tests/integration/rencanaAktivasiSaatJadwalkan\.integration\.test\.js|frontend/src/features/production/(BacklogCard\.jsx|ScheduleModals\.jsx|experience\.js|unitCardModel\.js)|frontend/src/pages/bengkel/ProductionRencanaWorkspace\.jsx|frontend/tests/rencanaOrderNyata\.test\.js|scripts/release-rencana-aktivasi\.sh)$'
BACKEND_SRC_EXPECT="backend/src/lib/activityLog.js backend/src/lib/domain/productionRencana.js backend/src/routes/productionExperience.js backend/src/services/productionBacklog.js backend/src/services/productionRencanaService.js"
FRONTEND_SRC_EXPECT="frontend/src/features/production/BacklogCard.jsx frontend/src/features/production/ScheduleModals.jsx frontend/src/features/production/experience.js frontend/src/features/production/unitCardModel.js frontend/src/pages/bengkel/ProductionRencanaWorkspace.jsx"
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
BK_DIR="$HOME/release-backups/rnak-${DEPLOY_SHORT}-${TS}"
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
Setelah switch bermasalah (rilis ini TANPA migrasi dan TANPA perubahan data: rollback kode tidak butuh pemulihan database dan aman kapan saja; unit yang sudah diaktifkan lewat fitur ini tetap di cohort — itu keputusan, bukan kerusakan):
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
exec 9>/tmp/release-rencana-aktivasi.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rnak1\|release-rencana-aktivasi\|kori1\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE '^backend/prisma/' || die "backend/prisma berubah — rilis ini HARUS tanpa migrasi/skema"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE 'production-evidence|receipt-proofs' || die "artefak unggahan/foto uji ikut ter-commit"
# Kode sumber yang berubah HARUS tepat yang diaudit: LIMA berkas backend/src dan LIMA berkas frontend/src (tidak ada yang lain).
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat: ${FRONTEND_SRC_EXPECT}"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist; tanpa prisma/dependensi/Docker; backend/src = 5 berkas, frontend/src = 5 berkas"
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

# Prasyarat skema: rilis ini TANPA migrasi — semua tabel/kolom yang dipakai sudah ada (rilis Koreksi+Retur sebelumnya) dan tidak ada migrasi tertunda pada kode kandidat.
for T in units production_runs_v2 production_run_plans_v2 production_station_day_pics_v2 production_plan_schedule_events_v2 unit_custody_handoffs_v2 production_operators production_settings v2_feature_flags v2_commands activity_events stock_movements fin_journal_entries; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
PENDING0="$(comm -23 <(sg ls-tree --name-only "${DEPLOY_SHA}:backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null" | LC_ALL=C sort) || true)"
[ -z "$PENDING0" ] || die "ada migrasi tertunda pada kode kandidat (rilis ini harus TANPA migrasi): $(printf '%s' "$PENDING0" | tr '\n' ' ')"
ok "tanpa migrasi: seluruh migrasi kandidat sudah terpasang; tabel yang dipakai ada"
# DOKUMEN PEMBANDING DIBEKUKAN: hanya yang menurut aturan bisnis tidak mungkin berubah akibat rilis ini (penerimaan DITOLAK, PO DIBATALKAN tanpa penerimaan aktif, faktur Dibatalkan/Ditolak yang sudah diam sebelum T0 —
# penerimaan Selesai dan PO Selesai SENGAJA tidak dibekukan: Koreksi Penerimaan sah mengubahnya;
# baris stok dan jurnal yang dibuat sebelum T0 (append-only); saldo per akun dari jurnal itu; seluruh flag fin_settings). T0 = jam DB (UTC) 5 menit lalu. Dokumen terbuka dan transaksi baru TIDAK diperbandingkan.
# Daftar id Produksi DIBEKUKAN sekarang; sesudah rilis sidik jari dihitung ulang untuk id yang SAMA (tahan terhadap order/unit baru yang sah; aktivitas Run/rencana/PIC baru = berhenti,
# karena cohort hanya 1 unit dan rilis ini tidak boleh menyebabkannya).
idlist() { psql_live -At -c "select coalesce(string_agg(quote_literal(id::text), ',' order by id::text), '') from $1 $2"; }
IDS_RUN="$(idlist production_runs_v2 '')"; IDS_PLAN="$(idlist production_run_plans_v2 '')"; IDS_PIC="$(idlist production_station_day_pics_v2 '')"
IDS_EVT="$(idlist production_plan_schedule_events_v2 '')"; IDS_HAND="$(idlist unit_custody_handoffs_v2 '')"
IDS_UNIT="$(idlist units "where status::text in ('DELIVERED','CANCELLED')")"; IDS_ORD="$(idlist '"Order"' "where status::text in ('DELIVERED','CANCELLED')")"
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'gr_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipts x where x.status = 'REJECTED' and x.updated_at < '$T0'::timestamp
union all select 'gr_final_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_lines x where x.goods_receipt_id in (select id from goods_receipts where status = 'REJECTED' and updated_at < '$T0'::timestamp)
union all select 'po_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_orders x where x.status = 'DIBATALKAN' and x.updated_at < '$T0'::timestamp and not exists (select 1 from goods_receipt_lines gl join goods_receipts g on g.id = gl.goods_receipt_id join fin_purchase_order_lines pl on pl.id = gl.purchase_order_line_id where pl.purchase_order_id = x.id and g.status <> 'REJECTED')
union all select 'bill_final', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['credit_applied'])::text, '|' order by x.id),'')) from fin_supplier_bills x where x.status in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'flag', count(*), md5(coalesce(string_agg(f.key || '=' || f.value, '|' order by f.key),'')) from fin_settings f
FPBEKU
)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "8" ] || die "sidik jari dokumen beku tidak 8 baris"
# SIDIK JARI PENUH pada cutoff T0 yang sama (sebelum dan sesudah rilis): migrasi terpasang, flag, jurnal (header+baris), saldo per akun, stok, PO, penerimaan (+baris+event), faktur, pembayaran.
VERIF_SQL="$(cat <<VERIF
select 'migrasi_terpasang', count(*), md5(coalesce(string_agg(migration_name, '|' order by migration_name), '')) from _prisma_migrations where finished_at is not null and rolled_back_at is null
union all select 'flags_v2', count(*), md5(coalesce(string_agg(key || '=' || enabled::text || scope || config::text, '|' order by key), '')) from v2_feature_flags
union all select 'fin_settings', count(*), md5(coalesce(string_agg(key || '=' || value::text, '|' order by key), '')) from fin_settings
union all select 'jurnal_header', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_journal_entries x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) from fin_journal_lines l where l.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id), '')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'saldo_total', 1, md5(coalesce(sum(l.debit),0)::text || '/' || coalesce(sum(l.credit),0)::text) from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp
union all select 'stok_pergerakan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'stok_per_bahan', count(*), md5(coalesce(string_agg(s.material_id::text || ':' || s.q::text, '|' order by s.material_id), '')) from (select material_id, sum(qty) q from stock_movements where created_at < '$T0'::timestamp group by material_id) s
union all select 'po', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_purchase_orders x where x.updated_at < '$T0'::timestamp
union all select 'po_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_purchase_order_lines x where x.purchase_order_id in (select id from fin_purchase_orders where updated_at < '$T0'::timestamp)
union all select 'penerimaan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from goods_receipts x where x.updated_at < '$T0'::timestamp
union all select 'penerimaan_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from goods_receipt_lines x where x.goods_receipt_id in (select id from goods_receipts where updated_at < '$T0'::timestamp)
union all select 'penerimaan_event', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from goods_receipt_events x where x.created_at < '$T0'::timestamp
union all select 'faktur', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_supplier_bills x where x.updated_at < '$T0'::timestamp
union all select 'faktur_alokasi', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_supplier_bill_allocations x where x.bill_id in (select id from fin_supplier_bills where updated_at < '$T0'::timestamp)
union all select 'pembayaran_supplier', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from fin_supplier_payments x where x.created_at < '$T0'::timestamp
union all select 'retur_pergerakan_stok', count(*), '-' from stock_movements where type::text = 'SUPPLIER_RETURN' and created_at < '$T0'::timestamp
union all select 'koreksi_pembalik', count(*), '-' from stock_movements where type::text = 'RECEIPT' and qty < 0 and goods_receipt_id is not null and created_at < '$T0'::timestamp
union all select 'koreksi_jurnal', count(*), '-' from fin_journal_entries where idempotency_key like 'PENERIMAAN\_BAHAN:%:KOREKSI:%' and created_at < '$T0'::timestamp
union all select 'prod_run_beku', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from production_runs_v2 x where x.id::text in ('-',$IDS_RUN)
union all select 'prod_run_total', count(*), '-' from production_runs_v2
union all select 'prod_rencana_beku', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from production_run_plans_v2 x where x.id::text in ('-',$IDS_PLAN)
union all select 'prod_rencana_total', count(*), '-' from production_run_plans_v2
union all select 'prod_pic_meja', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from production_station_day_pics_v2 x where x.id::text in ('-',$IDS_PIC)
union all select 'prod_pic_meja_total', count(*), '-' from production_station_day_pics_v2
union all select 'prod_riwayat_jadwal', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from production_plan_schedule_events_v2 x where x.id::text in ('-',$IDS_EVT)
union all select 'prod_riwayat_total', count(*), '-' from production_plan_schedule_events_v2
union all select 'prod_handoff', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from unit_custody_handoffs_v2 x where x.id::text in ('-',$IDS_HAND)
union all select 'prod_handoff_total', count(*), '-' from unit_custody_handoffs_v2
union all select 'prod_operator', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from production_operators x
union all select 'prod_setting', count(*), md5(coalesce(string_agg(key || '=' || value::text, '|' order by key), '')) from production_settings
union all select 'prod_pemetaan_layanan', count(*), md5(coalesce(string_agg(id::text || ':' || coalesce(production_service_id::text, '-'), '|' order by id), '')) from price_items
union all select 'unit_final_beku', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from units x where x.id::text in ('-',$IDS_UNIT)
union all select 'order_final_beku', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from "Order" x where x.id::text in ('-',$IDS_ORD)
union all select 'aktivasi_rencana', count(*), '-' from activity_events where event_type = 'PRODUCTION_RENCANA_UNIT_ACTIVATED'
VERIF
)"
psql_live -At -c "$VERIF_SQL" | LC_ALL=C sort > "$BK_DIR/verif-sebelum.txt" || die "sidik jari penuh sebelum gagal"
[ "$(grep -c . "$BK_DIR/verif-sebelum.txt")" = "36" ] || die "sidik jari penuh tidak 36 baris ($(grep -c . "$BK_DIR/verif-sebelum.txt"))"
ok "sidik jari penuh sebelum rilis tersimpan (36 kunci termasuk Run/rencana/PIC/riwayat/handoff/operator/setting/pemetaan Produksi, cutoff T0=${T0} UTC)"
# Pembaca bentuk Backlog Rencana Produksi (fungsi SERVER yang sama dengan papan) — dijalankan di kode LAMA (live, baca-saja) dan nanti di kode BARU terhadap RESTORE backup.
# Kode baru hanya BOLEH menambah penanda `activatable`; aksi/kode/onboardable tiap kartu HARUS identik.
cat > "$BK_DIR/bentuk.mjs" <<'BENTUK'
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const mod = await import(pathToFileURL(process.cwd() + "/src/services/productionBacklog.js").href);
const out = {};
for (const status of ["DIPROSES", "PENGAMBILAN"]) {
  const r = await mod.listBacklog(prisma, { status, page: 1, pageSize: 100, canActivate: true });
  out[status] = { total: r.total, counts: r.counts, rencanaCounts: r.rencanaCounts, items: r.items.map((i) => ({
    unitId: i.unitId, schedulable: !!i.schedulable, action: i.rencana?.action ?? null, code: i.rencana?.code ?? null, onboardable: !!i.rencana?.onboardable,
    activatable: i.rencana?.activatable === undefined ? null : i.rencana.activatable === true,
  })) };
}
await prisma.$disconnect();
console.log(JSON.stringify(out));
BENTUK
cat > "$BK_DIR/banding.mjs" <<'BANDING'
import fs from "node:fs";
const A = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), B = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const runCount = JSON.parse(fs.readFileSync(process.argv[4], "utf8")); // { unitId: jumlahRunApaPun }
let gagal = 0; let aktif = 0; let kartu = 0;
for (const st of Object.keys(A)) {
  const a = A[st], b = B[st];
  if (a.total !== b.total || JSON.stringify(a.counts) !== JSON.stringify(b.counts) || JSON.stringify(a.rencanaCounts) !== JSON.stringify(b.rencanaCounts)) { console.log(`  GAGAL  ${st}: hitungan berubah ${JSON.stringify([a.total, a.rencanaCounts])} -> ${JSON.stringify([b.total, b.rencanaCounts])}`); gagal++; }
  const byA = new Map(a.items.map((i) => [i.unitId, i]));
  for (const ib of b.items) {
    kartu++;
    const ia = byA.get(ib.unitId);
    if (!ia) { console.log(`  GAGAL  ${st}: kartu ${ib.unitId} tidak ada di kode lama`); gagal++; continue; }
    if (ia.action !== ib.action || ia.code !== ib.code || ia.onboardable !== ib.onboardable || ia.schedulable !== ib.schedulable) { console.log(`  GAGAL  ${st}: kartu ${ib.unitId} berubah ${JSON.stringify(ia)} -> ${JSON.stringify(ib)}`); gagal++; }
    if (ib.activatable === true) {
      aktif++;
      if (ib.action !== "AWAIT_ACTIVATION") { console.log(`  GAGAL  ${st}: ${ib.unitId} activatable padahal aksi ${ib.action}`); gagal++; }
      if ((runCount[ib.unitId] ?? 0) !== 0) { console.log(`  GAGAL  ${st}: ${ib.unitId} activatable padahal punya ${runCount[ib.unitId]} Run`); gagal++; }
    }
    if (ib.action === "EXCEPTION" && ib.activatable === true) { console.log(`  GAGAL  ${st}: pengecualian ${ib.unitId} ditawarkan untuk diaktifkan`); gagal++; }
  }
  if (a.items.length !== b.items.length) { console.log(`  GAGAL  ${st}: jumlah kartu ${a.items.length} -> ${b.items.length}`); gagal++; }
  console.log(`  ok     ${st}: ${b.items.length} kartu; aksi/kode/onboardable identik dengan kode lama`);
}
console.log(`BANDING_HASIL gagal=${gagal} kartu=${kartu} activatable=${aktif}`);
process.exit(gagal ? 1 : 0);
BANDING
dcp "$PREV_DIR" exec -T backend node --input-type=module - < "$BK_DIR/bentuk.mjs" > "$BK_DIR/bentuk-sebelum.json" 2>"$BK_DIR/bentuk-sebelum.err" || die "membaca bentuk Backlog (kode lama) gagal: $(head -c 300 "$BK_DIR/bentuk-sebelum.err")"
[ "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Object.keys(j).length)' "$BK_DIR/bentuk-sebelum.json")" = "2" ] || die "bentuk Backlog sebelum tidak lengkap"
ok "bentuk Backlog SEBELUM (kode lama, live, baca-saja): $(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Object.entries(j).map(([k,v])=>k+"="+v.items.length).join(", "))' "$BK_DIR/bentuk-sebelum.json") kartu"
psql_live -At -c "select coalesce(json_object_agg(u.id::text, c.n), '{}'::json) from units u join (select unit_id, count(*) n from production_runs_v2 group by unit_id) c on c.unit_id = u.id" > "$BK_DIR/run-per-unit.json" || die "hitungan Run per unit gagal"

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
BACKUP_FILE="$HOME/backups/pre-rnak-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-koreksi-retur.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Unit ini belum diaktifkan untuk Rencana Produksi" "Ya, aktifkan unit ini dan jadwalkan" "otomatis diaktifkan saat jadwal disimpan"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: $s1"; done
for s2 in "Retur & Debit Note" "Diterima bersih dari PO" "Dokumen kosong — belum ada kedatangan" "Barang Akan Datang" "Catat Barang Tiba" "Rencana Produksi" "Status Produksi" "Perlu konfirmasi Sales" "Belum Dijadwalkan" "Mulai Uji Sebelum Bongkar"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: $s2"; done
# Label lama yang SENGAJA diganti tidak boleh tersisa (angka itu bukan stok tersedia).
[ -z "$(grep -lF "Stok bersih" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru masih memuat label 'Stok bersih' (harus 'Diterima bersih dari PO')"
if [ "$NEW_INDEX" = "$PREV_INDEX" ]; then die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"; fi
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); 3 teks fitur baru + 10 teks fitur lama ada; label 'Stok bersih' tidak tersisa"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-rnak-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"


PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, baca perilaku KODE BARU terhadapnya (angka PO identik, dokumen kosong ditandai), bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_rnak_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
# Restore dibandingkan dengan dokumen BEKU dan sidik jari penuh pada T0 yang sama (transaksi sah sesudah T0 tidak diperbandingkan).
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod-beku.txt" || { reh_drop; die "sidik jari dokumen beku produksi gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || true; reh_drop; die "dokumen pembanding beku BERUBAH selama backup (produksi)"; }
RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi (backup/restore bermasalah)"; }
RPSQL "$VERIF_SQL" | LC_ALL=C sort > "$BK_DIR/verif-reh.txt" || { reh_drop; die "sidik jari penuh rehearsal gagal"; }
cmp -s "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-reh.txt" || { diff "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-reh.txt" || true; reh_drop; die "RESTORE berbeda dari produksi pada sidik jari penuh (cutoff T0)"; }
ok "restore nyata IDENTIK dengan produksi: 8 kelompok dokumen beku + 36 kunci sidik jari penuh (jurnal, saldo, stok, PO, penerimaan, faktur, pembayaran, flag, migrasi, Run, rencana, PIC meja, riwayat jadwal, handoff, operator, setting, pemetaan layanan)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status (image baru, DB restore) tidak 'up to date' — ada migrasi tertunda?"; }
ok "image baru melihat DB restore 'up to date' (tanpa migrasi tertunda)"
# KODE BARU membaca data NYATA (restore): aksi/kode tiap kartu identik dengan kode lama; penanda activatable hanya pada unit AWAIT_ACTIVATION tanpa Run apa pun.
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$REH_URL" backend node --input-type=module - < "$BK_DIR/bentuk.mjs" > "$BK_DIR/bentuk-reh.json" 2>"$BK_DIR/bentuk-reh.err" || { reh_drop; die "membaca bentuk Backlog (kode BARU, restore) gagal: $(head -c 400 "$BK_DIR/bentuk-reh.err")"; }
BAND="$(node "$BK_DIR/banding.mjs" "$BK_DIR/bentuk-sebelum.json" "$BK_DIR/bentuk-reh.json" "$BK_DIR/run-per-unit.json")" || { printf '%s\n' "$BAND"; reh_drop; die "perilaku kode baru TIDAK sesuai harapan pada data nyata (lihat GAGAL di atas)"; }
printf '%s\n' "$BAND" | grep -v '^BANDING_HASIL'
printf '%s\n' "$BAND" | grep -q '^BANDING_HASIL gagal=0' || { reh_drop; die "ringkasan pembanding tidak ada/gagal"; }
RPSQL "$VERIF_SQL" | LC_ALL=C sort > "$BK_DIR/verif-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/verif-reh.txt" "$BK_DIR/verif-reh-sesudah.txt" || { diff "$BK_DIR/verif-reh.txt" "$BK_DIR/verif-reh-sesudah.txt" || true; reh_drop; die "membaca dengan kode baru MENGUBAH data (tidak boleh)"; }
reh_drop
ok "rehearsal lulus: kode baru hanya membaca (sidik jari restore tidak berubah); DB sementara dihapus"

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
[ "$NBE" = "5" ] || die "berkas backend yang diverifikasi harus tepat 5 (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date (tanpa migrasi baru)"

PHASE="8b-smoke"; say "8b. Smoke test baca-saja (izin aktivasi, penanda activatable, penolakan sebelum menyentuh data; TIDAK mengaktifkan/menjadwalkan apa pun di produksi)"
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
const tulis = [];
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  if (method !== "GET") tulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status, code: json?.code ?? null });
  return { status: r.status, json };
}
const tokenUntuk = async (u) => { const roles = (await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role); return jwt.sign({ id: u.id, name: u.name, role: u.role, roles: roles.length ? roles : [u.role] }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
const FIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) {
    const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
    if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u;
  }
  return null;
}
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", FIN);
const lead = await userDengan("PRODUCTION_LEAD", FIN);
if (!adm || !sales) { rec("akun ADMIN dan SALES murni tersedia", false, `adm=${!!adm} sales=${!!sales}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const nol = "00000000-0000-4000-8000-000000000000";
const ALASAN_LEAD = "tidak ada akun PRODUCTION_LEAD murni (aktif, tanpa peran ADMIN/OWNER/FINANCE/ACCOUNTANT/APPROVER) di production; akun/token tidak dibuat atau direkayasa";
const tL = lead ? await tokenUntuk(lead) : null;
if (!lead) console.log(`  INFO  izin Production Lead tidak dapat diverifikasi di production: ${ALASAN_LEAD}`);

// ── Backlog: bentuk + penanda activatable (server = otoritas) ──
rec("backlog: tanpa token 401", (await api("GET", "/api/production-v2/backlog")).status === 401);
const bA = await api("GET", "/api/production-v2/backlog?pageSize=100", tA);
const itemsA = bA.json?.items ?? [];
rec("backlog (admin) 200 berisi kartu dengan rencana.action", bA.status === 200 && Array.isArray(itemsA) && itemsA.every((i) => typeof i.rencana?.action === "string"), `${itemsA.length} kartu`);
rec("penanda activatable berupa boolean pada setiap kartu", itemsA.every((i) => typeof i.rencana?.activatable === "boolean"));
const ids = itemsA.filter((i) => i.rencana.activatable).map((i) => i.unitId);
rec("activatable HANYA pada aksi AWAIT_ACTIVATION", itemsA.every((i) => !i.rencana.activatable || i.rencana.action === "AWAIT_ACTIVATION"));
const adaRun = ids.length ? await prisma.productionRun.count({ where: { unitId: { in: ids } } }) : 0;
const adaLog = ids.length ? await prisma.unitStageLog.count({ where: { unitId: { in: ids } } }) : 0;
rec("unit activatable TIDAK punya Run apa pun (aktif/selesai/dibatalkan) dan tidak punya log tahap V1", adaRun === 0 && adaLog === 0, `${ids.length} unit; run=${adaRun} log=${adaLog}`);
const pengecualian = itemsA.filter((i) => i.rencana.action === "EXCEPTION");
rec("kartu Pengecualian (termasuk Run lama di luar cohort) TIDAK ditawarkan untuk diaktifkan", pengecualian.every((i) => i.rencana.activatable === false), `${pengecualian.length} pengecualian`);
if (tL) { const bL = await api("GET", "/api/production-v2/backlog?pageSize=100", tL); rec("backlog (Production Lead): tidak ada kartu activatable (bukan ADMIN/OWNER)", bL.status === 200 && (bL.json?.items ?? []).every((i) => i.rencana?.activatable === false)); }
else skip("backlog (Production Lead): tidak ada kartu activatable", ALASAN_LEAD);

// ── Penulisan: SEMUA ditolak sebelum menyentuh data (tidak pernah memakai token ADMIN dengan kunci idempotensi) ──
const body = { unitId: nol, productionDate: "2026-10-12", stationCode: "TABLE_1", priority: 0, activateUnit: true };
const kunci = (n) => ({ "Idempotency-Key": `smoke-rnak-${n}-0000000` });
await api("POST", "/api/production-v2/plans", null, body, kunci("anon"));
await api("POST", "/api/production-v2/plans", tS, body, kunci("sales"));
await api("POST", "/api/production-v2/plans", tA, body); // tanpa Idempotency-Key -> 400 sebelum handler
if (tL) await api("POST", "/api/production-v2/plans", tL, body, kunci("lead")); // Production Lead + activateUnit -> 403 RENCANA_ACTIVATION_FORBIDDEN sebelum DB
const SAH = new Set([400, 401, 403]);
const TULIS_DIHARAPKAN = tL ? 4 : 3;
if (!tL) skip("penolakan activateUnit oleh Production Lead (403 RENCANA_ACTIVATION_FORBIDDEN)", ALASAN_LEAD);
rec(`semua ${tulis.length} pemanggilan tulis ditolak sebelum menyentuh data (hanya 400/401/403): smoke TIDAK menulis data produksi`, tulis.length === TULIS_DIHARAPKAN && tulis.every((x) => SAH.has(x.status)), tulis.map((x) => `${x.n}=${x.status}`).join("; "));
if (tL) rec("activateUnit oleh Production Lead ditolak dengan kode RENCANA_ACTIVATION_FORBIDDEN", tulis[3]?.status === 403 && tulis[3]?.code === "RENCANA_ACTIVATION_FORBIDDEN", JSON.stringify(tulis[3]));
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal, ${dilewati} dilewati (SKIP)`);
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
process.exit(fail ? 1 : 0);
NODE
SMOKE_SKIP="$(sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p' "$BK_DIR/smoke.log" | tail -n 1)"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL (jangan anggap lulus)"
if [ "$SMOKE_SKIP" = "0" ]; then
  ok "smoke test lulus (backlog + penanda activatable, izin aktivasi, penulisan ditolak sebelum menyentuh data)"
else
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di log; izin Production Lead TIDAK terverifikasi di production bila tidak ada akun PRODUCTION_LEAD murni (tidak ada akun/token dibuat). Ini BUKAN klaim lulus."
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
# BUKTI AKHIR: sidik jari pada T0 yang SAMA harus identik sebelum vs sesudah (jurnal, saldo, stok, PO, penerimaan, faktur, pembayaran, flag, migrasi).
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$VERIF_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/verif-sesudah.txt" || die "sidik jari penuh sesudah gagal"
diff "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-sesudah.txt" >/dev/null || { diff "$BK_DIR/verif-sebelum.txt" "$BK_DIR/verif-sesudah.txt" || true; die "sidik jari penuh BERUBAH selama rilis (jurnal/stok/tagihan/GR) — periksa dengan backup"; }
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$FP_BEKU_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/data-sesudah.txt" || die "sidik jari dokumen beku sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "dokumen PEMBANDING beku BERUBAH selama rilis"; }
ok "sidik jari IDENTIK sebelum vs sesudah pada T0=${T0}: 36 kunci penuh (jurnal+baris+saldo, stok, PO, penerimaan, faktur, pembayaran, flag, migrasi, Run, rencana, PIC meja, riwayat jadwal, handoff, operator, setting, pemetaan) dan 8 kelompok beku — rilis TIDAK mengubah data"
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
say "SELESAI — rilis ${DEPLOY_SHORT} aktif (kode saja; tidak ada unit diaktifkan, cohort/setting/PIC tidak berubah). Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
