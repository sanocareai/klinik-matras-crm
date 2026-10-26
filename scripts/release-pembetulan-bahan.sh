#!/usr/bin/env bash
# RILIS "PEMBETULAN BAHAN UNIT TERKIRIM (drawer Order Produksi)": WEB + BACKEND, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • Hanya unit TERKIRIM (DELIVERED); unit dibatalkan dan unit aktif TIDAK diperluas. Panel "Pembetulan bahan" menggantikan kalimat buntu "pemakaian tidak dicatat lagi" pada unit terkirim.
#   • Layanan resmi yang sudah ada: pengeluaran/pengembalian stok (POST /units/:id/materials), koreksi jumlah berpersetujuan, pemakaian sementara, komponen lama (catatan TANPA stok). Posting Pemakaian Historis TIDAK dipakai.
#   • Aturan server pada unit terkirim: ALASAN wajib, TANGGAL PEMAKAIAN yang dilaporkan wajib (terpisah dari waktu pencatatan), SALDO yang dilihat di pratinjau harus masih sama (409 bila bergeser), dan konfirmasi eksplisit bila ada pengeluaran yang MUNGKIN SUDAH TERCATAT
#     (kandidat ditampilkan; tidak pernah disamakan/ditautkan otomatis). Pratinjau (baca-saja) menyatakan tegas: catatan saja vs PENGELUARAN/PENGEMBALIAN STOK baru, dampak stok, jurnal/celah Finance, HPP operasional. Dasar harga & tanggal jurnal = WAKTU PENCATATAN.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore; semua skenario pembetulan ditulis HANYA ke DB sementara; direktori data/uploads production TIDAK dipasang ke rehearsal); build web di release dir;
#     smoke baca-saja pasca-switch (pratinjau, penolakan sebelum menulis, tanpa jejak tulis). Produksi: rilis ini TIDAK membuat catatan/pergerakan/koreksi apa pun; tidak ada transaksi QA.
#
#   cat scripts/release-pembetulan-bahan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/pb1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/pb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/pb1r.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/pb1.out 2>&1 < /dev/null &'   # rilis penuh (hanya setelah persetujuan)
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru). Data yang sudah dibuat lewat pembetulan (pergerakan stok bertaut unit, catatan sementara/komponen lama, koreksi) tetap sah sebagai data biasa;
#   kode lama hanya kembali mengunci input pada unit terkirim. Tidak ada guard rollback khusus.
# (dibangkitkan oleh scripts/gen-release-pembetulan-bahan.cjs dari scripts/release-status-kerja-buka-pekerjaan.sh + scripts/templates/release-pembetulan-bahan/*; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/pemakaian-drawer-order}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/src/lib/activityLog\.js|backend/src/routes/pemakaianKoreksi\.js|backend/src/routes/units\.js|backend/src/services/pembetulanBahanUnit\.js|backend/src/services/productionAdoptionService\.js|backend/src/services/productionComponentReuseService\.js|backend/src/services/unitProvisionalUsageService\.js|backend/tests/integration/pembetulanBahanUnit\.integration\.test\.js|backend/tests/releasePembetulanBahan\.test\.js|frontend/src/api\.js|frontend/src/features/production/bahan/FormKomponenLama\.jsx|frontend/src/features/production/bahan/FormSementaraKatalog\.jsx|frontend/src/features/production/bahan/KomponenLamaDaftar\.jsx|frontend/src/features/production/bahan/PemakaianAktualBagian\.jsx|frontend/src/features/production/bahan/PemakaianSementaraDaftar\.jsx|frontend/src/features/production/bahan/PembetulanUnitSelesai\.jsx|frontend/src/features/production/bahan/RiwayatBahanBaru\.jsx|frontend/src/features/production/bahan/pembetulanModel\.js|frontend/tests/bahanDrawerRilis\.test\.js|frontend/tests/orderProduksiAdopsi\.test\.js|frontend/tests/pembetulanBahan\.test\.js|scripts/gen-release-pembetulan-bahan\.cjs|scripts/lib/rehearsal-pembetulan-bahan\.mjs|scripts/lib/smoke-pembetulan-bahan\.mjs|scripts/release-pembetulan-bahan\.sh|scripts/templates/release-pembetulan-bahan/header\.txt|scripts/templates/release-pembetulan-bahan/rollback\.txt)$'
BACKEND_SRC_EXPECT="backend/src/lib/activityLog.js backend/src/routes/pemakaianKoreksi.js backend/src/routes/units.js backend/src/services/pembetulanBahanUnit.js backend/src/services/productionAdoptionService.js backend/src/services/productionComponentReuseService.js backend/src/services/unitProvisionalUsageService.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/production/bahan/FormKomponenLama.jsx frontend/src/features/production/bahan/FormSementaraKatalog.jsx frontend/src/features/production/bahan/KomponenLamaDaftar.jsx frontend/src/features/production/bahan/PemakaianAktualBagian.jsx frontend/src/features/production/bahan/PemakaianSementaraDaftar.jsx frontend/src/features/production/bahan/PembetulanUnitSelesai.jsx frontend/src/features/production/bahan/RiwayatBahanBaru.jsx frontend/src/features/production/bahan/pembetulanModel.js"
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
BK_DIR="$HOME/release-backups/pembetulan-bahan-${DEPLOY_SHORT}-${TS}"
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
Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya: rollback KODE aman kapan pun. Bila rollback setelah switch:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Kode lama hanya kembali mengunci input bahan pada unit terkirim dan tidak lagi menegakkan alasan/tanggal dilaporkan; data yang sudah dibuat lewat pembetulan (pergerakan stok bertaut unit, catatan sementara, komponen lama, koreksi) tetap valid dan tidak dibalik.
Rilis ini tidak menyentuh Harga Berlaku, Persediaan Awal, PSA/GR, atau jurnal; tidak ada guard rollback khusus.
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS semua perubahan sesudah backup; gunakan hanya atas keputusan Owner.
─────────────────────────────────────────────────────────────────────────
EOF
}
# Mode --rehearsal-only: bila berhenti (sukses atau gagal) sebelum switch, kembalikan tag image produksi ke image container aktif dan hapus release dir yang dibuat (tidak ada sisa build).
pulihkan_jejak() {
  [ "${REHEARSAL_ONLY:-0}" = "1" ] || return 0
  if [ -n "${PREV_IMG_ID:-}" ] && [ -n "${IMG_NAME:-}" ]; then docker tag "$PREV_IMG_ID" "$IMG_NAME" 2>/dev/null || true; fi
  if [ -n "${NEW_IMG_ID:-}" ] && [ "${NEW_IMG_ID:-}" != "${PREV_IMG_ID:-}" ]; then docker rmi "$NEW_IMG_ID" >/dev/null 2>&1 || true; fi
  if [ -n "${ROLLBACK_TAG:-}" ]; then docker rmi "$ROLLBACK_TAG" >/dev/null 2>&1 || true; fi
  if [ -n "${NEW_DIR:-}" ] && [ -n "${RELEASES:-}" ] && [ "${NEW_DIR#"$RELEASES"/}" != "${NEW_DIR}" ] && [ -d "$NEW_DIR" ]; then rm -rf "$NEW_DIR"; fi
}
trap 'rc=$?; pulihkan_jejak; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-pembetulan-bahan.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "pb1\|release-pembetulan-bahan\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
ok "prasyarat: rilis ini tidak bergantung pada migrasi baru dan tidak menulis data bisnis"
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
BACKUP_FILE="$HOME/backups/pre-pembetulan-bahan-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Pembetulan bahan" "Tambah pengeluaran bahan" "Kembalikan sebagian (pengembalian baru)" "Catat komponen lama" "Catat pemakaian sementara" "Lihat dampak" "dilaporkan dipakai"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Buka pekerjaan" "Catat pekerjaan selesai" "Tandai sudah dikerjakan" "Harga Berlaku (HPP operasional)" "Koreksi salah input historis" "Beri harga ke pemakaian lama" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
# (pemeriksaan negatif 'Hitung Kas' dari rilis lama tidak relevan untuk rilis ini)

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-pbu-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_pembetulan_${TS}"
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
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): pratinjau baca-saja; pembetulan unit terkirim (alasan, tanggal dilaporkan, saldo bergeser, kemungkinan ganda, pengembalian, koreksi berpersetujuan, catatan sementara, komponen lama); unit dibatalkan/aktif ditolak. DB dihapus di akhir.
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji Pembetulan Bahan terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import("/app/src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji pembetulan hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL pembetulan bahan unit TERKIRIM: kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production. Semua tulisan hanya di DB sementara ini.
const { neutralizeExternalEnv } = await import("/app/src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = 4101; const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: "/app", env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "20m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const adm = info.find((x) => bisa(x.rs, P.UNIT_MATERIAL_WRITE) && bisa(x.rs, P.INVENTORY_WRITE) && !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u; const own = info.find((x) => x.rs.has("OWNER"))?.u; const sls = info.find((x) => !bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.INVENTORY_WRITE))?.u;
cek("akun uji tersedia pada salinan: pemohon (izin tulis, bukan penyetuju), Owner penyetuju, akun tanpa izin", !!adm && !!own && !!sls, `${!!adm}/${!!own}/${!!sls}`); if (!adm || !own || !sls) { berhenti(); process.exit(1); }
const tA = await token(adm); const tO = await token(own); const tS = await token(sls);
const H = async (metode, path, tok, body = null, kunci = null) => { const r = await fetch(BASE + path, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kunci ? { "Idempotency-Key": kunci } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
let seq = 0; const kunci = (p) => `reh-pb-${p}-${Date.now().toString(36)}-${++seq}-xxxxxxxx`;
const bulat4 = (v) => Math.round(Number(v) * 10000) / 10000;
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const saldo = async (m) => Number((await prisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${m}::uuid`)[0].s);
// data uji dari salinan restore
const unit = (await prisma.$queryRawUnsafe(`select u.id::text id, u.unit_code kode, u.order_id oid, u.created_at dibuat from units u where u.status::text = 'DELIVERED' and not exists (select 1 from stock_movements s where s.unit_id = u.id) and not exists (select 1 from unit_usage_notes x where x.unit_id = u.id) and not exists (select 1 from unit_provisional_usages y where y.unit_id = u.id) and not exists (select 1 from unit_component_reuse_entries z where z.unit_id = u.id) order by u.created_at desc limit 1`))[0];
const mat = (await prisma.$queryRawUnsafe(`select m.id::text id, m.code kode, m.unit satuan from materials m where m.active and coalesce(m.kind::text,'') <> 'PERLENGKAPAN_STOK' and (select coalesce(sum(qty),0) from stock_movements s where s.material_id = m.id) >= 20 and not exists (select 1 from stock_movements s where s.material_id = m.id and s.unit_id is null and s.type::text in ('ISSUE','WASTE') and s.created_at > now() - interval '60 days') order by m.code limit 1`))[0];
const kosong = (await prisma.$queryRawUnsafe(`select m.id::text id, m.code kode from materials m where m.active and coalesce(m.kind::text,'') <> 'PERLENGKAPAN_STOK' and not exists (select 1 from stock_movements s where s.material_id = m.id) order by m.code limit 1`))[0];
const batal = (await prisma.$queryRawUnsafe(`select id::text id from units where status::text = 'CANCELLED' limit 1`))[0]; const aktif = (await prisma.$queryRawUnsafe(`select id::text id from units where status::text = 'IN_PRODUCTION' limit 1`))[0];
cek(`data uji tersedia: unit terkirim bersih ${unit?.kode}, bahan ${mat?.kode} (saldo ≥ 20), bahan tanpa catatan stok ${kosong?.kode}, unit dibatalkan, unit aktif`, !!unit && !!mat && !!kosong && !!batal && !!aktif); if (!unit || !mat || !kosong || !batal || !aktif) { berhenti(); process.exit(1); }
const TGL = wib(unit.dibuat); const hariIni = wib(new Date());
const PRA = (u) => `/api/production/units/${u}/pembetulan-bahan/pratinjau`; const POSTM = (u) => `/api/units/${u}/materials`;
const snapUnit = async () => ({ mov: await num("select count(*)::int n from stock_movements where unit_id = $1::uuid", unit.id), sem: await num("select count(*)::int n from unit_provisional_usages where unit_id = $1::uuid", unit.id), komp: await num("select count(*)::int n from unit_component_reuse_entries where unit_id = $1::uuid", unit.id), kor: await num("select count(*)::int n from warehouse_corrections where doc_id = $1::uuid", unit.id) });
const tetap = ["fin_inventory_openings", "goods_receipts", "fin_purchase_orders", "fin_supplier_bills", "material_harga_berlaku", "fin_stock_movement_valuation_corrections", "unit_usage_notes"];
const hitungTetap = async () => { const o = {}; for (const t of tetap) o[t] = await num(`select count(*)::int n from "${t}"`); return o; }; const tetap0 = await hitungTetap();

// A. izin dan pratinjau baca-saja
cek("tanpa token = 401; akun tanpa izin = 403 (pratinjau dan pengeluaran)", (await H("POST", PRA(unit.id), null, { jenis: "TAMBAH" })).status === 401 && (await H("POST", PRA(unit.id), tS, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: TGL })).status === 403 && (await H("POST", POSTM(unit.id), tS, { materialId: mat.id, qty: 1 })).status === 403);
const s0 = await snapUnit(); const saldo0 = await saldo(mat.id);
const p = await H("POST", PRA(unit.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: TGL });
cek("pratinjau 200: tegas 'PENGELUARAN STOK BARU', waktu terpisah (dasar harga/jurnal = waktu pencatatan), stok sebelum/sesudah = ledger, baca-saja", p.status === 200 && p.body.tindakan?.jenis === "PENGELUARAN_STOK_BARU" && p.body.waktu?.pemakaianDilaporkan === TGL && p.body.waktu?.dasarHargaDanJurnal === "WAKTU_PENCATATAN" && Math.abs(p.body.stok?.saldoSebelum - saldo0) < 1e-6 && Math.abs(p.body.stok?.saldoSesudah - bulat4(saldo0 - 1)) < 1e-6 && JSON.stringify(await snapUnit()) === JSON.stringify(s0), JSON.stringify(p.body)?.slice(0, 120));
const tgl0 = await H("POST", PRA(unit.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1 }); cek("pratinjau tanpa tanggal dilaporkan ditolak (UNIT_TANGGAL_PEMAKAIAN_WAJIB)", tgl0.status === 400 && tgl0.body.code === "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
const batalP = await H("POST", PRA(batal.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni }); const aktifP = await H("POST", PRA(aktif.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni });
cek("unit DIBATALKAN dan unit AKTIF ditolak pratinjau pembetulan (409) — perluasan hanya unit terkirim", batalP.status === 409 && batalP.body.code === "UNIT_DIBATALKAN" && aktifP.status === 409 && aktifP.body.code === "UNIT_BELUM_TERKIRIM");
const stokK = await H("POST", PRA(unit.id), tA, { materialId: kosong.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: TGL }); cek("bahan tanpa catatan stok: penghalang jujur STOK_BELUM_DIKETAHUI (saldo 'belum diketahui', bukan 0)", stokK.body.boleh === false && stokK.body.penghalang?.[0]?.kode === "STOK_BELUM_DIKETAHUI" && stokK.body.stok?.saldoSebelum === null);

// B. aturan server pada POST (ditolak = tidak ada tulisan)
const dasar = { materialId: mat.id, qty: 1, alasanPembetulan: "Rehearsal: bahan terlewat dicatat", tanggalPemakaian: TGL, saldoDilihat: saldo0 };
const r1 = await H("POST", POSTM(unit.id), tA, { ...dasar, alasanPembetulan: undefined }); const r2 = await H("POST", POSTM(unit.id), tA, { ...dasar, tanggalPemakaian: undefined }); const r3 = await H("POST", POSTM(unit.id), tA, { ...dasar, saldoDilihat: undefined }); const r4 = await H("POST", POSTM(unit.id), tA, { ...dasar, tanggalPemakaian: "2099-01-01" });
cek("POST tanpa alasan / tanpa tanggal dilaporkan / tanpa saldo yang dilihat / tanggal masa depan = 400 dan TIDAK ada yang tersimpan", [r1, r2, r3, r4].every((r) => r.status === 400) && r1.body.code === "UNIT_ALASAN_PEMBETULAN_WAJIB" && r2.body.code === "UNIT_TANGGAL_PEMAKAIAN_WAJIB" && r3.body.code === "UNIT_PRATINJAU_WAJIB" && JSON.stringify(await snapUnit()) === JSON.stringify(s0));

// C. pencatatan ganda: kandidat ditampilkan, pengeluaran baru wajib konfirmasi, tidak ditautkan otomatis
const kand = (await prisma.$queryRawUnsafe(`insert into stock_movements (id, material_id, type, qty, note, created_at) values (gen_random_uuid(), $1::uuid, 'ISSUE', -1, 'REH: pengeluaran lama tanpa unit', now() - interval '1 day') returning id::text id`, mat.id))[0];
const saldo1 = await saldo(mat.id); const pg = await H("POST", PRA(unit.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni });
cek("pratinjau menampilkan kandidat 'pengeluaran tanpa unit' (jumlah sama) dan meminta pernyataan pemeriksaan; tidak menyamakan otomatis", pg.body.sudahTercatat?.perluKonfirmasi === true && pg.body.sudahTercatat.kemungkinan.some((x) => x.id === kand.id && x.alasan.includes("Jumlah sama persis")) && /TIDAK menyamakan/.test(pg.body.sudahTercatat.catatan));
const d0 = { ...dasar, tanggalPemakaian: hariIni, saldoDilihat: saldo1 };
const tolak = await H("POST", POSTM(unit.id), tA, d0, kunci("tolak")); cek("pengeluaran baru TANPA konfirmasi saat ada kandidat = 409 UNIT_KEMUNGKINAN_GANDA, tidak ada yang tersimpan", tolak.status === 409 && tolak.body.code === "UNIT_KEMUNGKINAN_GANDA" && JSON.stringify(await snapUnit()) === JSON.stringify(s0));
const jur0 = await num("select count(*)::int n from fin_journal_entries"); const gap0 = await num("select count(*)::int n from fin_posting_gaps");
const kk = kunci("ok"); const ok = await H("POST", POSTM(unit.id), tA, { ...d0, konfirmasiBukanGanda: true }, kk); const ok2 = await H("POST", POSTM(unit.id), tA, { ...d0, konfirmasiBukanGanda: true }, kk);
const mv = ok.body?.id ? (await prisma.stockMovement.findUnique({ where: { id: ok.body.id } })) : null;
cek("dengan konfirmasi: tercatat SATU pergerakan ISSUE bertaut unit (klik ganda = replay); catatan memuat alasan + tanggal dilaporkan; waktu pencatatan = hari ini", ok.status === 201 && [200, 409].includes(ok2.status) && (await snapUnit()).mov === s0.mov + 1 && mv?.type === "ISSUE" && Number(mv.qty) === -1 && mv.note.startsWith(`Pembetulan unit terkirim (${unit.kode}) [dilaporkan ${hariIni}]: Rehearsal`) && wib(mv.createdAt) === hariIni, `${ok.status}/${ok2.status}`);
cek("kandidat lama TIDAK ditautkan otomatis (unit_id tetap kosong)", (await prisma.$queryRawUnsafe(`select unit_id from stock_movements where id = $1::uuid`, kand.id))[0].unit_id === null);
cek("stok ledger sesudah = prediksi pratinjau", Math.abs((await saldo(mat.id)) - Math.round((saldo1 - 1) * 10000) / 10000) < 1e-6);
const hasil = pg.body.finance?.hasil; const jurBaru = (await num("select count(*)::int n from fin_journal_entries")) - jur0; const gapBaru = await num("select count(*)::int n from fin_posting_gaps where source_id = $1", mv?.id ?? "x");
const sesuai = hasil === "JURNAL" ? jurBaru >= 1 : hasil === "TIDAK_DIJURNAL" ? jurBaru === 0 && gapBaru === 0 : jurBaru === 0 && gapBaru === 1;
cek(`hasil Finance nyata = prediksi pratinjau (${hasil}): jurnal baru ${jurBaru}, celah ${gapBaru}`, sesuai);
const op = (await prisma.$queryRawUnsafe(`select status, unit_cost::float uc from stock_movement_biaya_operasional where movement_id = $1::uuid`, mv?.id ?? "00000000-0000-0000-0000-000000000000"))[0];
cek(`HPP operasional dibekukan sesuai prediksi (${pg.body.hppOperasional?.dibekukan ? "ada harga berlaku" : "tanpa harga → TANPA_HARGA, bukan Rp0"})`, pg.body.hppOperasional?.dibekukan ? op?.status === "DINILAI" && Number(op.uc) === pg.body.hppOperasional.harga : op?.status === "TANPA_HARGA");

// D. saldo berubah setelah pratinjau
const sd = await saldo(mat.id); const pra2 = await H("POST", PRA(unit.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni });
await prisma.$executeRawUnsafe(`insert into stock_movements (id, material_id, type, qty, note) values (gen_random_uuid(), $1::uuid, 'ISSUE', -2, 'REH: pengeluaran orang lain setelah pratinjau')`, mat.id);
const sBefore = await snapUnit(); const gser = await H("POST", POSTM(unit.id), tA, { ...dasar, tanggalPemakaian: hariIni, saldoDilihat: pra2.body.stok.saldoDilihat, konfirmasiBukanGanda: true }, kunci("geser"));
cek("saldo bergeser setelah pratinjau → 409 UNIT_SALDO_BERGESER, tidak ada yang tersimpan", gser.status === 409 && gser.body.code === "UNIT_SALDO_BERGESER" && JSON.stringify(await snapUnit()) === JSON.stringify(sBefore) && Math.abs(gser.body.detail.saldoSekarang - (sd - 2)) < 1e-6);

// E. pengembalian (baris asli utuh) dan koreksi berpersetujuan
const sdK = await saldo(mat.id); const ret = await H("POST", POSTM(unit.id), tA, { materialId: mat.id, qty: -1, alasanPembetulan: "Rehearsal: kelebihan catat", tanggalPemakaian: hariIni, saldoDilihat: sdK }, kunci("ret"));
const barisUnit = await prisma.$queryRawUnsafe(`select type::text, qty::float from stock_movements where unit_id = $1::uuid order by created_at`, unit.id);
cek("pengembalian = RETURN BARU bertaut unit; ISSUE asli utuh; stok naik 1", ret.status === 201 && barisUnit.length === 2 && barisUnit[0].type === "ISSUE" && barisUnit[0].qty === -1 && barisUnit[1].type === "RETURN" && Math.abs((await saldo(mat.id)) - (sdK + 1)) < 1e-6);
const i2 = await H("POST", POSTM(unit.id), tA, { materialId: mat.id, qty: 3, alasanPembetulan: "Rehearsal: tambah 3 untuk uji koreksi", tanggalPemakaian: hariIni, saldoDilihat: await saldo(mat.id), konfirmasiBukanGanda: true }, kunci("i2"));
const aj = await H("POST", `/api/production/units/${unit.id}/koreksi-pemakaian`, tA, { materialId: mat.id, qtyBaru: 1, alasan: "Rehearsal: pemakaian sebenarnya 1" }, kunci("kor")); const sendiri = await H("POST", `/api/production/koreksi-pemakaian/${aj.body?.id}/setujui`, tA, {}); const sA = await saldo(mat.id);
const stj = await H("POST", `/api/production/koreksi-pemakaian/${aj.body?.id}/setujui`, tO, {});
cek("koreksi berpersetujuan pada unit terkirim: diajukan (stok belum berubah), pemohon tidak bisa menyetujui sendiri (403), Owner menyetujui → POSTED dan stok berubah", i2.status === 201 && aj.status === 201 && sendiri.status === 403 && stj.status === 200 && (await saldo(mat.id)) !== sA, `${i2.status}/${aj.status}/${sendiri.status}/${stj.status}`);

// F. catatan TANPA stok: pemakaian sementara dan komponen lama
const sPre = await snapUnit(); const jurPre = await num("select count(*)::int n from fin_journal_entries"); const stokPre = await num("select count(*)::int n from stock_movements");
const sem0 = await H("POST", `/api/production/units/${unit.id}/provisional-usages`, tA, { name: "Busa sisa rehearsal XQZ", qty: 2, uom: "KG", originNote: "sisa meja" }, kunci("sem0")); const sem1 = await H("POST", `/api/production/units/${unit.id}/provisional-usages`, tA, { name: "Busa sisa rehearsal XQZ", qty: 2, uom: "KG", originNote: "sisa meja", alasanPembetulan: "Rehearsal: catatan terlewat", tanggalPemakaian: TGL }, kunci("sem1"));
const komp0 = await H("POST", `/api/production/units/${unit.id}/komponen-lama`, tA, { name: "Pegas rehearsal", qty: 1, uom: "PCS", condition: "bagus", outcome: "RETURNED_TO_CUSTOMER" }, kunci("komp0abc")); const komp1 = await H("POST", `/api/production/units/${unit.id}/komponen-lama`, tA, { name: "Pegas rehearsal", qty: 1, uom: "PCS", condition: "bagus", outcome: "RETURNED_TO_CUSTOMER", alasanPembetulan: "Rehearsal: komponen terlewat", tanggalPemakaian: TGL }, kunci("komp1abc"));
const semRow = (await prisma.$queryRawUnsafe(`select used_at "u", note from unit_provisional_usages where unit_id = $1::uuid`, unit.id))[0];
cek("catatan sementara + komponen lama pada unit terkirim: TANPA alasan/tanggal ditolak (409/400); lengkap tersimpan dengan tanggal dilaporkan; stok & jurnal TIDAK berubah", sem0.status === 409 && komp0.status === 409 && sem1.status === 201 && komp1.status === 201 && wib(semRow.u) === TGL && semRow.note.includes(`[dilaporkan ${TGL}]`) && (await num("select count(*)::int n from stock_movements")) === stokPre && (await num("select count(*)::int n from fin_journal_entries")) === jurPre && (await snapUnit()).sem === sPre.sem + 1 && (await snapUnit()).komp === sPre.komp + 1, `${sem0.status}/${komp0.status}/${sem1.status}/${komp1.status}`);
const bs = await H("POST", `/api/production/units/${batal.id}/provisional-usages`, tA, { name: "Busa sisa batal XQZ", qty: 1, uom: "KG", alasanPembetulan: "uji unit dibatalkan", tanggalPemakaian: hariIni }, kunci("bs")); const bk = await H("POST", `/api/production/units/${batal.id}/komponen-lama`, tA, { name: "Pegas batal", qty: 1, uom: "PCS", condition: "bagus", outcome: "REUSED", workPart: "xx", alasanPembetulan: "uji unit dibatalkan", tanggalPemakaian: hariIni }, kunci("bk1abc"));
cek("unit DIBATALKAN tetap menolak pemakaian sementara dan komponen lama (409)", bs.status === 409 && bk.status === 409, `${bs.status} ${bs.body?.code} ${bs.body?.error} | ${bk.status} ${bk.body?.code} ${bk.body?.error}`);
const ad = await H("GET", `/api/production/units/${unit.id}/adopsi`, tA); const baris = ad.body?.pemakaianAktual?.baris ?? [];
cek("data order: riwayat pemakaian membawa tanggal dilaporkan terpisah dari waktu pencatatan", ad.status === 200 && baris.some((b) => b.dilaporkan === hariIni && wib(b.tanggal) === hariIni) && baris.every((b) => Object.hasOwn(b, "dilaporkan")));
const tetap1 = await hitungTetap(); const bedaTetap = tetap.filter((t) => tetap0[t] !== tetap1[t]);
cek("persediaan awal, penerimaan, PO, tagihan supplier, Harga Berlaku, koreksi valuasi, catatan historis: TIDAK berubah oleh pembetulan", bedaTetap.length === 0, bedaTetap.join(",") || "identik");
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
# direktori sementara dibuat root oleh kontainer: dihapus lewat kontainer (rm biasa ditolak); kegagalan pembersihan tidak menggagalkan rilis
dcp "$NEW_DIR" run --rm --no-deps -T -v "$BK_DIR:/bk" backend sh -c 'rm -rf /bk/reh-data /bk/reh-uploads /bk/reh-dd' </dev/null >/dev/null 2>&1 || true
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; uji tulis pembetulan dilakukan HANYA pada salinan restore lalu DB sementara dihapus"
if [ "$REHEARSAL_ONLY" = "1" ]; then
  say "REHEARSAL-ONLY: semua gerbang sampai rehearsal pada restore backup nyata LULUS; berhenti SEBELUM switch (produksi tidak diubah)"
  pulihkan_jejak
  [ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag image produksi tidak kembali ke image container aktif"
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah"
  [ ! -d "$NEW_DIR" ] || die "release dir sementara tidak terhapus"
  ok "jejak build dibersihkan: tag ${IMG_NAME} = image container aktif (${PREV_IMG_ID:7:12}); release dir sementara dihapus; backup disimpan di ${BACKUP_FILE}"
  say "REHEARSAL-ONLY SELESAI — kandidat ${DEPLOY_SHORT} siap untuk persetujuan deploy (jalankan ulang TANPA --rehearsal-only)"
  trap - EXIT; exit 0
fi

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
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin (401/403), pratinjau pembetulan unit terkirim (baca-saja), unit dibatalkan/aktif ditolak, penolakan POST sebelum menulis (alasan/tanggal/saldo), tanpa jejak tulis"
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
// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang diuji hanya pratinjau (baca-saja) dan penolakan SEBELUM menyentuh data. Sidik jari data unit uji (stok, catatan sementara, komponen lama, koreksi, aktivitas) harus identik sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import("/app/src/constants/permissions.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const post = async (path, token, body = {}) => { const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const penulis = info.find((x) => bisa(x.rs, P.UNIT_MATERIAL_WRITE))?.u; const tanpaIzin = info.find((x) => !bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.INVENTORY_WRITE))?.u;
if (!penulis) { rec("akun berizin pembetulan (unit:material_write) tersedia", false); process.exit(1); }
const tW = await tokenUntuk(penulis); const tN = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;
const unitT = (await prisma.$queryRawUnsafe(`select id::text id, unit_code kode from units where status::text = 'DELIVERED' order by created_at desc limit 1`))[0];
const unitB = (await prisma.$queryRawUnsafe(`select id::text id from units where status::text = 'CANCELLED' order by created_at desc limit 1`))[0];
const unitA = (await prisma.$queryRawUnsafe(`select id::text id from units where status::text not in ('DELIVERED','CANCELLED') order by created_at desc limit 1`))[0];
const bahan = (await prisma.$queryRawUnsafe(`select m.id::text id from materials m where m.active order by (select coalesce(sum(qty),0) from stock_movements s where s.material_id = m.id) desc limit 1`))[0];
if (!unitT || !bahan) { rec("unit terkirim dan bahan uji tersedia", false); process.exit(1); }
const sidik = async () => ({
  mov: await hitung("select count(*)::int n from stock_movements where unit_id = $1::uuid", unitT.id), sem: await hitung("select count(*)::int n from unit_provisional_usages where unit_id = $1::uuid", unitT.id),
  komp: await hitung("select count(*)::int n from unit_component_reuse_entries where unit_id = $1::uuid", unitT.id), kor: await hitung("select count(*)::int n from warehouse_corrections where doc_id = $1::uuid", unitT.id),
  akt: await hitung("select count(*)::int n from activity_events where entity_id = $1", unitT.id), catatan: await hitung("select count(*)::int n from unit_usage_notes where unit_id = $1::uuid", unitT.id),
});
const sebelum = await sidik();
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const PRA = (u) => `/api/production/units/${u}/pembetulan-bahan/pratinjau`;

rec("pratinjau pembetulan: tanpa token 401", (await post(PRA(unitT.id), null, { materialId: bahan.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni })).status === 401);
if (tN) rec("pratinjau pembetulan: akun tanpa izin 403", (await post(PRA(unitT.id), tN, { materialId: bahan.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni })).status === 403); else skip("akun tanpa izin 403", "tidak ada akun tanpa izin aktif (diuji di rehearsal)");
const p = await post(PRA(unitT.id), tW, { materialId: bahan.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni });
rec(`pratinjau unit terkirim ${unitT.kode}: 200, tegas 'PENGELUARAN STOK BARU', waktu pencatatan terpisah, struktur dampak lengkap`, p.status === 200 && p.json?.tindakan?.jenis === "PENGELUARAN_STOK_BARU" && p.json?.waktu?.dasarHargaDanJurnal === "WAKTU_PENCATATAN" && !!p.json?.finance?.hasil && !!p.json?.hppOperasional && Array.isArray(p.json?.sudahTercatat?.tertaut) && Array.isArray(p.json?.sudahTercatat?.kemungkinan) && typeof p.json?.boleh === "boolean", String(p.status));
for (const jenis of ["CATATAN_SEMENTARA", "KOMPONEN_LAMA"]) { const c = await post(PRA(unitT.id), tW, { jenis, tanggalPemakaian: hariIni }); rec(`pratinjau ${jenis}: hanya catatan (stok tidak berubah)`, c.status === 200 && c.json?.tindakan?.jenis === "CATATAN_SAJA" && c.json?.stok === null, String(c.status)); }
const tgl = await post(PRA(unitT.id), tW, { materialId: bahan.id, jenis: "TAMBAH", qty: 1 }); rec("pratinjau tanpa tanggal pemakaian dilaporkan ditolak 400", tgl.status === 400 && tgl.json?.code === "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
if (unitB) { const b = await post(PRA(unitB.id), tW, { materialId: bahan.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni }); rec("unit DIBATALKAN ditolak 409 (tidak diperluas)", b.status === 409 && b.json?.code === "UNIT_DIBATALKAN"); } else skip("unit dibatalkan ditolak", "tidak ada unit dibatalkan");
if (unitA) { const a = await post(PRA(unitA.id), tW, { materialId: bahan.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni }); rec("unit AKTIF ditolak 409 (hanya unit terkirim)", a.status === 409 && a.json?.code === "UNIT_BELUM_TERKIRIM"); } else skip("unit aktif ditolak", "tidak ada unit aktif");
// penegakan server pada POST (ditolak SEBELUM transaksi/penulisan; tanpa Idempotency-Key)
const m1 = await post(`/api/units/${unitT.id}/materials`, tW, { materialId: bahan.id, qty: 1 }); rec("POST pengeluaran pada unit terkirim TANPA alasan = 400 UNIT_ALASAN_PEMBETULAN_WAJIB (tidak menulis)", m1.status === 400 && m1.json?.code === "UNIT_ALASAN_PEMBETULAN_WAJIB");
const m2 = await post(`/api/units/${unitT.id}/materials`, tW, { materialId: bahan.id, qty: 1, alasanPembetulan: "smoke: uji penolakan" }); rec("POST tanpa tanggal pemakaian dilaporkan = 400 UNIT_TANGGAL_PEMAKAIAN_WAJIB (tidak menulis)", m2.status === 400 && m2.json?.code === "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
const m3 = await post(`/api/units/${unitT.id}/materials`, tW, { materialId: bahan.id, qty: 1, alasanPembetulan: "smoke: uji penolakan", tanggalPemakaian: hariIni }); rec("POST tanpa saldo yang dilihat di pratinjau = 400 UNIT_PRATINJAU_WAJIB (transaksi dibatalkan, tidak menulis)", m3.status === 400 && m3.json?.code === "UNIT_PRATINJAU_WAJIB");
const s1 = await post(`/api/production/units/${unitT.id}/provisional-usages`, tW, { name: "Smoke tanpa alasan XQZ", qty: 1, uom: "KG" }); rec("pemakaian sementara pada unit terkirim tanpa alasan = ditolak 409 (UNIT_TIDAK_AKTIF)", s1.status === 409 && s1.json?.code === "UNIT_TIDAK_AKTIF");
const ad = await get(`/api/production/units/${unitT.id}/adopsi`, tW); const baris = ad.json?.pemakaianAktual?.baris ?? [];
if (ad.status === 200 && baris.length) rec("data order: riwayat pemakaian membawa kolom 'dilaporkan' (null untuk pencatatan biasa)", baris.every((b) => Object.hasOwn(b, "dilaporkan"))); else if (ad.status === 200) skip("kolom 'dilaporkan' pada riwayat", "unit uji belum punya pemakaian"); else rec("GET adopsi unit terkirim 200", false, String(ad.status));

const sesudah = await sidik(); const beda = Object.keys(sebelum).filter((k) => sebelum[k] !== sesudah[k]);
rec("TIDAK ada jejak tulis pada unit uji: pergerakan stok, catatan sementara, komponen lama, koreksi, catatan historis, aktivitas sama persis sebelum vs sesudah smoke", beda.length === 0, beda.join(",") || "identik");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
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
  ok "smoke test lulus (izin, pratinjau baca-saja, batas unit terkirim, penolakan sebelum menulis, tanpa jejak tulis, invarian)"
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
say "CATATAN: Rilis ini membawa Pembetulan Bahan unit TERKIRIM (alasan + tanggal pemakaian dilaporkan wajib; pratinjau dampak; pemeriksaan kemungkinan pencatatan ganda). TANPA migrasi. Tidak ada pergerakan stok, catatan sementara, komponen lama, koreksi, jurnal, atau harga yang dibuat/diubah oleh rilis; pembetulan nyata baru terjadi saat pengguna berizin memakainya."
