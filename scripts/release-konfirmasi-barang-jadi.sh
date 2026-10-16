#!/usr/bin/env bash
# RILIS "KONFIRMASI BARANG JADI + DRAF ROUTE PLANNER 'Menunggu konfirmasi siap kirim'" (kasus Rika): web + backend, TANPA migrasi dan TANPA perubahan schema.prisma —
# workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED. RILIS KODE SAJA: data bisnis TIDAK ditulis (tidak ada Konfirmasi Barang Jadi, tidak ada perubahan status unit,
# tidak ada job/rute/penugasan driver dibuat oleh rilis ini; unit Rika hanya DIBACA dan dibandingkan sebelum vs sesudah).
#   • Route Planner: unit yang masih dikerjakan Produksi boleh ditempatkan sebagai job DELIVERY DRAF berlabel "Menunggu konfirmasi siap kirim" (status unit tidak berubah, tanpa driver).
#     Pagar fail-closed: publish rute, penugasan driver, penambahan ke rute terbit, dan mulai job DITOLAK (409) selama ada unit yang menunggu.
#   • Konfirmasi Barang Jadi (adaptasi saja): POST /api/production-v2/runs/:id/confirm-finished-goods lewat jalur resmi finishProduction; wajib alasan, kode unit diketik ulang, lokasi barang jadi sah,
#     verifikasi fisik. Tahap sisa DILEWATI, QC tidak dilakukan; TIDAK mengarang foto/QC/serah terima Gudang/pergerakan stok. Hanya ADMIN/OWNER/PRODUCTION_LEAD atau PIC run.
#   • Hotfix Stock Count b5268e1f (dan jalur cepat opname ditutup, K5) WAJIB tetap ada: dibuktikan leluhur kandidat + berkas stockCount.js identik dengan baseline.
#
#   cat scripts/release-konfirmasi-barang-jadi.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/kbj1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/kbj1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/kbj1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/kbj1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa data baru dari rilis ini). Konfirmasi Barang Jadi yang dilakukan petugas sesudah rilis adalah baris data biasa (event/tahap SKIPPED) dan tetap valid di kode lama.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/konfirmasi-barang-jadi-rika}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini). Apa pun di luar daftar (termasuk backend/prisma, stockCount.js) = berhenti.
ALLOWED_RE='^(backend/src/routes/armada\.js|backend/src/routes/productionExperience\.js|backend/src/services/deliveryMenungguKonfirmasi\.js|backend/src/services/productionStepCommandService\.js|backend/tests/integration/kesiapanBarangJadi\.integration\.test\.js|frontend/src/api\.js|frontend/src/features/armada/components/(JobBadges|RouteCard|UnroutedJobsPanel)\.jsx|frontend/src/features/production/(KonfirmasiBarangJadi|UnitOverviewDrawer)\.jsx|frontend/src/features/production/konfirmasiBarangJadiLogic\.js|frontend/src/pages/Armada\.jsx|frontend/tests/konfirmasiBarangJadi\.test\.js|scripts/release-konfirmasi-barang-jadi\.sh)$'
BACKEND_SRC_EXPECT="backend/src/routes/armada.js backend/src/routes/productionExperience.js backend/src/services/deliveryMenungguKonfirmasi.js backend/src/services/productionStepCommandService.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/armada/components/JobBadges.jsx frontend/src/features/armada/components/RouteCard.jsx frontend/src/features/armada/components/UnroutedJobsPanel.jsx frontend/src/features/production/KonfirmasiBarangJadi.jsx frontend/src/features/production/UnitOverviewDrawer.jsx frontend/src/features/production/konfirmasiBarangJadiLogic.js frontend/src/pages/Armada.jsx"
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
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/kbj-${DEPLOY_SHORT}-${TS}"
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
Rilis ini TANPA migrasi dan TANPA tulisan data: rollback KODE aman kapan pun.
Bila rollback setelah switch:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Kode lama: tidak ada draf "Menunggu konfirmasi siap kirim" dan tidak ada tombol/endpoint Konfirmasi Barang Jadi. Job draf yang sudah dibuat dengan kode baru adalah baris job biasa (tanpa driver) dan tetap valid.
Env DELIVERY_UNIT_CONFIRM_REQUIRED, OTA RN, flag V2 TIDAK disentuh rilis ini.
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
exec 9>/tmp/release-konfirmasi-barang-jadi.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "kbj1\|release-konfirmasi-barang-jadi\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA" || die "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} BUKAN leluhur kandidat — rilis akan menghilangkannya; gabungkan live terbaru dulu"
sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$BASE_SHA" || die "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} belum ada di baseline live ${BASE_SHA:0:8} — baseline bukan yang diharapkan"
for f in $GUARD_UNCHANGED; do
  [ "$(sg rev-parse "${BASE_SHA}:${f}")" = "$(sg rev-parse "${DEPLOY_SHA}:${f}")" ] || die "${f} berbeda antara baseline dan kandidat — rilis ini tidak boleh menyentuhnya (hotfix Stock Count/ledger/otorisasi)"
done
ok "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} ada di baseline DAN kandidat; $(printf '%s\n' $GUARD_UNCHANGED | wc -l) berkas pelindung (Stock Count, opname, ledger, otorisasi) identik dengan baseline"
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
# Prasyarat skema: tabel yang dibaca/ditulis kode baru HARUS sudah ada di produksi.
for T in "Order" units jobs job_units routes production_runs_v2 production_phase_runs_v2 production_operation_runs_v2 production_step_evidence_v2 quality_inspections_v2 unit_custody_handoffs_v2 stock_movements activity_events v2_commands v2_feature_flags storage_locations fin_journal_entries fin_journal_lines; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
UNIT_N="$(psql_live -At -c "select count(*) from units")"; JOB_N="$(psql_live -At -c "select count(*) from jobs")"; RUN_N="$(psql_live -At -c "select count(*) from production_runs_v2")"; ROUTE_N="$(psql_live -At -c "select count(*) from routes")"
SM_N="$(psql_live -At -c "select count(*) from stock_movements")"; CUS_N="$(psql_live -At -c "select count(*) from unit_custody_handoffs_v2")"; QI_N="$(psql_live -At -c "select count(*) from quality_inspections_v2")"
for v in "$UNIT_N" "$JOB_N" "$RUN_N" "$ROUTE_N" "$SM_N" "$CUS_N" "$QI_N"; do [[ "$v" =~ ^[0-9]+$ ]] || die "audit awal bukan angka: '$v'"; done
ok "prasyarat terpenuhi; unit=${UNIT_N}, job=${JOB_N}, rute=${ROUTE_N}, run V2=${RUN_N}, pergerakan stok=${SM_N}, custody V2=${CUS_N}, inspeksi QC V2=${QI_N}"
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
# GARIS DASAR invarian (dibandingkan sesudah rilis; yang dijaga = TIDAK BERTAMBAH oleh rilis ini).
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"
[[ "$BASE_TIDAK_SEIMBANG" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$BASE_TIDAK_SEIMBANG'"
printf 'BASE_TIDAK_SEIMBANG=%q\nUNIT_N=%q\nJOB_N=%q\nRUN_N=%q\nROUTE_N=%q\nSM_N=%q\nCUS_N=%q\nQI_N=%q\nRIKA_SEBELUM=%q\n' "$BASE_TIDAK_SEIMBANG" "$UNIT_N" "$JOB_N" "$RUN_N" "$ROUTE_N" "$SM_N" "$CUS_N" "$QI_N" "$RIKA_SEBELUM" > "$BK_DIR/garis-dasar.env"
( set -e; . "$BK_DIR/garis-dasar.env"; [ "$RIKA_SEBELUM" = "$(psql_live -At -c "$RIKA_SQL")" ] ) || die "garis-dasar.env tidak aman di-source / keadaan Rika berubah saat dicatat"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}"
# SIDIK JARI TABEL (seluruh isi baris, jsonb): dibandingkan SEBELUM vs SESUDAH uji kode baru pada DB rehearsal (membuktikan kode baru yang dijalankan terhadap data restore tidak menulis apa pun).
FP_SQL="select 'units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from units x
union all select 'jobs', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from jobs x
union all select 'job_units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from job_units x
union all select 'routes', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from routes x
union all select 'production_runs_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_runs_v2 x
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
BACKUP_FILE="$HOME/backups/pre-kbj-${DEPLOY_SHORT}-${TS}.sql.gz"
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
# Fitur rilis ini + fitur rilis sebelumnya (jangan sampai hilang dari bundel). Teks LAMA diverifikasi ada di dist release aktif (kalau tidak ada, skrip ini yang salah, bukan kandidat).
for s1 in "Konfirmasi Barang Jadi" "Menunggu konfirmasi siap kirim" "Pekerjaan fisik sudah selesai, tapi tahap belum tercatat?" "Barang jadi dikonfirmasi" "Saya sudah melihat barangnya langsung dan pekerjaan fisik memang selesai." "status unit tidak berubah, tanpa driver"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Konfirmasi kesiapan fisik" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Buat Rute" "Checklist Persiapan Perjalanan" "Histori Waktu" "Selesaikan Produksi" "Rencana Produksi"; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + 8 teks fitur lama ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-kbj-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan pratinjau pembatalan terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_kbj_${TS}"
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
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal (image baru) TIDAK 'up to date' — rilis ini harus tanpa migrasi"; }
ok "image baru: tidak ada migrasi pending pada hasil restore (rilis TANPA migrasi terbukti)"
# Kode BARU dijalankan terhadap data RESTORE (baca-saja): pratinjau Selesaikan Produksi untuk run Rika + penilaian "menunggu konfirmasi" + validasi penempatan draf. Tidak ada tulisan: sidik jari diperiksa sesudahnya.
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" -e RIKA_UNIT="$RIKA_UNIT" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-kode-baru.log" 2>&1 || { cat "$BK_DIR/rehearsal-kode-baru.log"; reh_drop; die "pemeriksaan kode baru terhadap data restore GAGAL"; }
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { previewFinishProduction } = await import("/app/src/services/productionStepCommandService.js");
const { unitMenunggu, validasiPenempatanDraf, STATUS_BISA_DITEMPATKAN_DRAF } = await import("/app/src/services/deliveryMenungguKonfirmasi.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const unit = await prisma.unit.findUnique({ where: { unitCode: process.env.RIKA_UNIT }, include: { order: { select: { id: true, orderNumber: true, status: true } } } });
cek("unit Rika ada pada data restore", !!unit);
if (unit) {
  const run = await prisma.productionRun.findFirst({ where: { unitId: unit.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, adaptationPolicy: true } });
  cek("run V2 Rika ada", !!run, run ? run.status + "/" + run.adaptationPolicy : "");
  if (run) {
    const pv = await previewFinishProduction(prisma, run.id);
    cek("pratinjau Selesaikan Produksi (kode baru, baca-saja) berjalan; run adaptasi", pv.adaptation === true, "canFinish=" + pv.canFinish + " dilewati=" + pv.willSkipSteps.length + " qcTidakDilakukan=" + pv.qcNotPerformed);
  }
  if (STATUS_BISA_DITEMPATKAN_DRAF.includes(unit.status)) {
    cek("unit Rika dinilai MENUNGGU konfirmasi siap kirim (bukan siap)", unitMenunggu({ id: unit.id, unitCode: unit.unitCode, status: unit.status }, new Map()) === true, unit.status);
    let galat = null; try { await validasiPenempatanDraf(prisma, [unit], {}); } catch (e) { galat = e; }
    cek("penempatan draf unit Rika sah, ATAU ditolak dengan alasan eksplisit (job aktif ada / order tidak sah)", galat === null || (galat.code && /^(JOB_GANDA|ORDER_TIDAK_SAH|UNIT_)/.test(galat.code)), galat ? galat.code : "sah");
  } else console.log("INFO  status unit Rika " + unit.status + " (bukan RECEIVED/IN_PRODUCTION): penilaian draf dilewati");
}
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
REHNODE
ok "kode baru terhadap data restore: $(tail -n 1 "$BK_DIR/rehearsal-kode-baru.log"); $(grep -c '^PASS' "$BK_DIR/rehearsal-kode-baru.log") pemeriksaan lulus"
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
[ "$(psql_live -At -c "$RIKA_SQL")" = "$RIKA_SEBELUM" ] || { echo "  sebelum: ${RIKA_SEBELUM}"; echo "  kini   : $(psql_live -At -c "$RIKA_SQL")"; die "keadaan Rika berubah sebelum switch (petugas mengerjakannya selama persiapan?) — periksa lalu ulangi rilis"; }
ok "pra-switch: dokumen pembanding beku identik; keadaan Rika tidak berubah"

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
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin + penolakan sebelum menyentuh data, kandidat draf Rika di papan, lokasi barang jadi, gerbang penempatan/dispatch, invarian"
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
const SAH = new Set([400, 401, 403, 404, 409, 428]);
rec("semua " + tulis.length + " pemanggilan tulis ditolak/galat sebelum menyentuh data: smoke TIDAK menulis data produksi", tulis.length >= 5 && tulis.every((b) => SAH.has(b.status)), tulis.map((b) => b.n + "=" + b.status).join("; "));

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

// ── Gerbang penempatan draf & dispatch, dipanggil langsung (baca-saja; tidak menulis) ──
const { validasiPenempatanDraf, pastikanJobSiapDispatch } = await import("/app/src/services/deliveryMenungguKonfirmasi.js");
const coba = async (status) => { const u = await prisma.unit.findFirst({ where: { status }, include: { order: { select: { orderNumber: true, status: true } } } }); if (!u) return null; try { await validasiPenempatanDraf(prisma, [u]); return "tidak-ditolak"; } catch (e) { return e.code; } };
const siap = await coba("READY_FOR_DELIVERY"); const batal = await coba("CANCELLED");
if (siap === null) skip("penempatan draf unit yang sudah siap ditolak", "tidak ada unit READY_FOR_DELIVERY"); else rec("penempatan draf unit yang SUDAH siap kirim ditolak (UNIT_SUDAH_SIAP atau JOB_GANDA bila sudah dijadwalkan)", ["UNIT_SUDAH_SIAP", "JOB_GANDA"].includes(siap), siap);
if (batal === null) skip("penempatan draf unit batal ditolak", "tidak ada unit CANCELLED"); else rec("penempatan draf unit BATAL ditolak (UNIT_BATAL)", batal === "UNIT_BATAL" || batal === "JOB_GANDA", batal);
const jobSiap = await prisma.job.findMany({ where: { type: "DELIVERY", status: { notIn: ["COMPLETED", "FAILED", "CANCELLED"] } }, select: { id: true }, take: 50 });
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
  ok "smoke test lulus (izin, penolakan sebelum menyentuh data, kandidat draf, lokasi barang jadi, gerbang, invarian)"
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
say "CATATAN: Konfirmasi Barang Jadi BELUM dijalankan untuk unit mana pun. Petugas berwenang harus MEMERIKSA barang fisiknya lebih dulu, baru memakai tombol konfirmasi di Unit 360 (tab Pekerjaan). Status Rika sebelum/sesudah: ${RIKA_SEBELUM} -> ${RIKA_SESUDAH}."
