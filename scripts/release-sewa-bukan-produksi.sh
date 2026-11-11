#!/usr/bin/env bash
# RILIS "Kasur sewa bukan pekerjaan Produksi" (sbp1) — keputusan Owner 12 Nov 2026.
# Order/unit SEWA tidak lagi muncul di Order Produksi (daftar, hitungan, kelengkapan, Excel), Papan Produksi, Command Center, Status Produksi, Laporan Produksi
# (kecuali unit sewa yang SUDAH punya pergerakan stok), dan antrean HPP Order; di laporan laba unit sewa tanpa biaya = selesai (HPP bahan Rp0).
# BACKEND SAJA: image backend DIBANGUN ULANG (kode tertanam di image); frontend TIDAK berubah → dist disalin dari folder rilis AKTIF on-disk (bukan git, lihat
# jebakan dist-only) dan diverifikasi byte-identik. TANPA migrasi, TANPA schema, TANPA tulis data, TANPA endpoint/izin baru. Status unit/order TIDAK diubah.
# Kerangka diturunkan dari rilis nls1 (backend tanpa migrasi, live 10 Nov) + cek baca-saja atas data production dengan image BARU sebelum switch.
#   ssh ubuntu@43.133.152.6 'bash /tmp/sbp1.sh <DEPLOY_SHA> <BASE_SHA> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'bash /tmp/sbp1.sh <DEPLOY_SHA> <BASE_SHA> --build-only'       # + release dir, image, cek baca-saja di data production; TANPA switch; dibersihkan
#   ssh ubuntu@43.133.152.6 'bash /tmp/sbp1.sh <DEPLOY_SHA> <BASE_SHA>'                    # rilis penuh
#   ssh ubuntu@43.133.152.6 'bash /tmp/sbp1.sh <DEPLOY_SHA> <BASE_SHA> --rollback'         # kembali ke folder+image baseline (rilis ini tidak mengubah data)
set -Eeuo pipefail
umask 077
DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ && "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen harus DEPLOY_SHA BASE_SHA 40 karakter" >&2; exit 1; }
MODE=release; for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --build-only) MODE=buildonly;; --rollback) MODE=rollback;; esac; done
CAND_BRANCH="${CAND_BRANCH:-feat/sewa-bukan-produksi-on-fba65a14}"; CAND_REF="refs/remotes/origin/cand-sbp1"
ALLOWED_RE='^(backend/src/lib/domain/unitBukanProduksi\.js|backend/src/lib/domain/hppOrder\.js|backend/src/routes/production\.js|backend/src/services/finance/hppOrder\.js|backend/src/services/laporanProduksi\.js|backend/src/services/productionOrderList\.js|backend/src/services/productionWorkListService\.js|backend/scripts/cekSewaBukanProduksi\.mjs|backend/tests/integration/sewaBukanProduksi\.integration\.test\.js|scripts/release-sewa-bukan-produksi\.sh)$'
DIFF_SHA='83592406e40909c4f4df5e56f997b76d64e1c1852279f4fad89dbeb6092f0533'
PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"; PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MIN_FREE_KB=$((5 * 1024 * 1024)); TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/sewa-bukan-produksi-${DEPLOY_SHORT}-${TS}"
PHASE=init; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; ROLLBACK_TAG=""; DIBANGUN=0; DIR_BARU=0
say() { printf '\n== %s\n' "$*"; }; ok() { printf '  OK    %s\n' "$*"; }; warn() { printf '  PERHATIAN %s\n' "$*"; }; die() { printf '\nSTOP [%s]: %s\n' "$PHASE" "$*" >&2; exit 1; }
sg() { git --git-dir="$SRC" "$@"; }
dcp() { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { docker exec -i "$PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
bebas_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
# Bila berhenti SEBELUM switch: kembalikan tag image ke image yang sedang berjalan dan hapus release dir yang dibuat rilis ini (container lama tidak tersentuh).
pulihkan() {
  if [ "$DIBANGUN" = 1 ] && [ -n "$PREV_IMG_ID" ] && [ -n "$IMG_NAME" ]; then docker tag "$PREV_IMG_ID" "$IMG_NAME" >/dev/null 2>&1 || true; fi
  if [ "$DIR_BARU" = 1 ] && [ "$NEW_DIR" = "$RELEASES/$DEPLOY_SHORT" ] && [ "$NEW_DIR" != "$PREV_DIR" ]; then rm -rf -- "$NEW_DIR"; fi
}
trap 'rc=$?; [ $rc -ne 0 ] && { pulihkan; printf "Berhenti di fase %s. Bila sudah switch: bash /tmp/sbp1.sh %s %s --rollback\n" "$PHASE" "$DEPLOY_SHA" "$BASE_SHA"; }; exit $rc' EXIT

# ── GERBANG DATA (sama dengan nls1): A. statis identik persis; B. tabel operasional identik pada batas cutoff (baris baru sesudah cutoff = trafik sah) ──
GD_BERGERAK=( 'Message|"Message"|"createdAt"' 'stock_movements|stock_movements|created_at' 'material_issues|material_issues|created_at' 'stock_transfers|stock_transfers|created_at'
  'warehouse_corrections|warehouse_corrections|requested_at' 'units|units|created_at' 'Order|"Order"|"createdAt"' 'order_biaya_tanpa_stok|order_biaya_tanpa_stok|created_at' )
GD_SQL_STATIS="select 'migrasi|' || count(*) filter (where finished_at is not null) || '|' || md5(coalesce(string_agg(migration_name || ':' || checksum || ':' || (finished_at is not null)::text, ',' order by migration_name), '')) from _prisma_migrations
union all select 'skema|' || md5(coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || udt_name || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema = 'public'
union all select 'indeks|' || md5(coalesce(string_agg(tablename || ':' || indexdef, ',' order by tablename, indexname), '')) from pg_indexes where schemaname = 'public'
union all select 'constraint|' || md5(coalesce(string_agg(conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname), '')) from pg_constraint where connamespace = 'public'::regnamespace
union all select 'unit sewa (status+kategori)|' || count(*) || '|' || md5(coalesce(string_agg(u.unit_code || ':' || u.status || ':' || o.status || ':' || coalesce(u.work_category::text, '-'), ',' order by u.unit_code), '')) from units u join \"Order\" o on o.id = u.order_id where o.category = 'SEWA' and u.created_at <= now() - interval '1 day'"
gd_sql_bergerak() {
  local spec lab tbl col first=1
  for spec in "${GD_BERGERAK[@]}"; do
    IFS='|' read -r lab tbl col <<< "$spec"
    [ "$first" = 1 ] && first=0 || printf ' union all '
    printf "select '%s|' || count(*) || '|' || coalesce(max(%s)::text, '-') from %s where %s <= '%s'::timestamp" "$lab" "$col" "$tbl" "$col" "$FP_CUTOFF"
  done
}
gd_baseline() {
  FP_CUTOFF="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '120 seconds', 'YYYY-MM-DD HH24:MI:SS.US')")"
  [[ "$FP_CUTOFF" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9:.]+$ ]] || die "cutoff baseline tidak terbaca: ${FP_CUTOFF}"
  FP_STATIS_0="$(psql_live -At -c "$GD_SQL_STATIS")" || die "baseline data statis gagal dibaca"
  FP_BERGERAK_0="$(psql_live -At -c "$(gd_sql_bergerak)")" || die "baseline tabel bergerak gagal dibaca"
  [ "$(printf '%s\n' "$FP_STATIS_0" | grep -c .)" = 5 ] && [ "$(printf '%s\n' "$FP_BERGERAK_0" | grep -c .)" = "${#GD_BERGERAK[@]}" ] || die "sidik jari baseline tidak lengkap"
  { echo "cutoff(UTC)=${FP_CUTOFF}"; echo "--statis"; echo "$FP_STATIS_0"; echo "--bergerak (<= cutoff)"; echo "$FP_BERGERAK_0"; } > "$BK_DIR/gerbang-data-baseline.txt"
  ok "baseline data dicatat (statis 5 sidik; ${#GD_BERGERAK[@]} tabel bergerak, cutoff ${FP_CUTOFF} UTC); $(printf '%s\n' "$FP_STATIS_0" | grep '^unit sewa' | cut -d'|' -f1-2)"
}
gd_verifikasi() {
  local s1 b1 d
  s1="$(psql_live -At -c "$GD_SQL_STATIS")" || die "data statis sesudah switch gagal dibaca"
  b1="$(psql_live -At -c "$(gd_sql_bergerak)")" || die "tabel bergerak sesudah switch gagal dibaca"
  { echo "--statis sesudah"; echo "$s1"; echo "--bergerak sesudah (<= cutoff ${FP_CUTOFF})"; echo "$b1"; } > "$BK_DIR/gerbang-data-sesudah.txt"
  if [ "$s1" != "$FP_STATIS_0" ]; then d="$(diff <(printf '%s\n' "$FP_STATIS_0") <(printf '%s\n' "$s1") | grep '^[<>]' | cut -c1-160 | head -6 | sed 's/^/        /' || true)"; printf '%s\n' "$d"; die "DATA STATIS BERUBAH selama rilis (termasuk status unit/order sewa)"; fi
  if [ "$b1" != "$FP_BERGERAK_0" ]; then d="$(diff <(printf '%s\n' "$FP_BERGERAK_0") <(printf '%s\n' "$b1") | grep '^[<>]' | cut -c1-160 | head -8 | sed 's/^/        /' || true)"; printf '%s\n' "$d"; die "baris berstempel <= cutoff ${FP_CUTOFF} BERUBAH — bukan trafik baru"; fi
  ok "data statis identik (migrasi/skema/indeks/constraint + status unit & order sewa); tabel operasional identik pada cutoff ${FP_CUTOFF} UTC"
}
# Cek baca-saja kode BARU atas data production (sesi DB READ ONLY, satu koneksi). $1 = "image <id>" atau "container <id>".
cek_data() {
  local jenis="$1" id="$2" net url out
  url="$(docker exec "$CID_OLD_ATAU_BARU" printenv DATABASE_URL)" || die "DATABASE_URL tidak terbaca dari container"
  if [ "$jenis" = image ]; then
    net="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CID_OLD_ATAU_BARU" | awk '{print $1}')"
    out="$(docker run --rm --network "$net" -e DATABASE_URL="$url" -e NODE_ENV=production --entrypoint node "$id" scripts/cekSewaBukanProduksi.mjs 2>&1)" || { printf '%s\n' "$out" | tail -n 20 | sed 's/^/    /'; die "cek baca-saja image baru atas data production GAGAL"; }
  else
    out="$(docker exec "$id" node scripts/cekSewaBukanProduksi.mjs 2>&1)" || { printf '%s\n' "$out" | tail -n 20 | sed 's/^/    /'; die "cek baca-saja container baru GAGAL"; }
  fi
  printf '%s\n' "$out" | sed 's/^/    /'; printf '%s\n' "$out" | grep -q '^HASIL LULUS$' || die "cek baca-saja tanpa HASIL LULUS"
}

PHASE=0; say "0. Kunci dan konkurensi"
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain berjalan (${lf})"; done
exec 9>/tmp/release-sewa-bukan-produksi.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate deploy|/tmp/[a-z0-9]+\.sh' | grep -v 'sbp1\.sh\|pgrep\|node src/index.js' | grep -v "$$" || true)"; [ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/   /'; die "ada proses deploy/build/migrasi lain"; }
mkdir -p "$BK_DIR" "$HOME/release-src"; exec > >(tee -a "$BK_DIR/release.log") 2>&1
ok "tidak ada deploy lain"

PHASE=1; say "1. Release aktif"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = 1 ] || die "harus tepat satu backend"
CID_OLD_ATAU_BARU="$CID_OLD"
PG="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=postgres")"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"; PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"; ENV_SHA="$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)"
ok "aktif ${PREV_DIR} marker ${PREV_COMMIT} image ${PREV_IMG_ID:7:12} env ${ENV_SHA}"
if [ "$MODE" = rollback ]; then
  PHASE=rollback; [ "$(basename "$PREV_DIR")" = "$DEPLOY_SHORT" ] || die "release aktif bukan ${DEPLOY_SHORT}; rollback ditolak agar tidak menimpa rilis lain"
  T="$RELEASES/${BASE_SHA:0:8}"; [ -d "$T" ] || die "folder baseline tidak ada"; TAG="${IMG_NAME%%:*}:rollback-pre-sbp1-${DEPLOY_SHORT}"; docker image inspect "$TAG" >/dev/null 2>&1 || die "tag rollback tidak ada"
  docker tag "$TAG" "$IMG_NAME"; dcp "$T" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "recreate gagal"
  for i in $(seq 1 45); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && break; sleep 2; done; curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "tidak sehat setelah rollback"
  ok "rollback selesai: folder ${BASE_SHA:0:8} + image $(docker image inspect -f '{{.Id}}' "$TAG" | cut -c8-19)"; trap - EXIT; exit 0
fi

PHASE=2; say "2. Sumber, batas perubahan, pin isi diff"
[ -d "$SRC" ] || die "repo sumber tidak ada"
sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch gagal"
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline tidak ada di repo sumber"
[ "$(sg rev-parse --short=8 "$BASE_SHA")" = "$PREV_COMMIT" ] || die "baseline ${BASE_SHA:0:8} BUKAN release aktif ${PREV_COMMIT}: susun ulang di atas live"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline bukan leluhur kandidat"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"; [ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/   /'; die "berkas di luar allowlist"; }
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)(docker-compose[^/]*|Dockerfile)$|package(-lock)?\.json$|\.env|^frontend/' || die "Docker/package/env/frontend berubah"
[ -z "$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma)" ] || die "rilis ini TANPA migrasi/schema"
[ "$(sg -c core.quotepath=false diff --no-renames --no-color --no-ext-diff --binary --full-index "$BASE_SHA" "$DEPLOY_SHA" -- backend | sha256sum | cut -d' ' -f1)" = "$DIFF_SHA" ] || die "isi diff backend berbeda dari yang diaudit"
ok "$(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist; frontend & backend/prisma tidak berubah; isi diff sesuai pin"

PHASE=3; say "3. Audit produksi (isi kode, bukan marker)"
curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "health internal"; curl -fsS -m15 "${PUBLIC_URL}/api/health" | grep -q '"ok":true' || die "health publik"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = 0 ] || die "migrasi menggantung"
sg -c core.quotepath=false ls-tree -r "$BASE_SHA" | awk -F'\t' '$1 ~ /^100[0-9]+ blob/ && $2 !~ /^frontend\/dist\// { split($1,a," "); print a[3] "\t" $2 }' > "$BK_DIR/base.tsv"
cut -f2 "$BK_DIR/base.tsv" | sed "s#^#${PREV_DIR}/#" | git hash-object --no-filters --stdin-paths > "$BK_DIR/live.txt" || die "berkas baseline hilang di release aktif"
BEDA="$(paste "$BK_DIR/base.tsv" "$BK_DIR/live.txt" | awk -F'\t' '$1 != $3' | wc -l)"; [ "$BEDA" = 0 ] || die "kode live menyimpang dari baseline: ${BEDA} berkas"
ok "kode live == baseline ($(wc -l < "$BK_DIR/base.tsv") berkas)"
for f in src/services/productionOrderList.js src/services/finance/hppOrder.js src/routes/production.js; do docker exec "$CID_OLD" cat "/app/$f" | cmp -s - "$PREV_DIR/backend/$f" || die "${f} di container berbeda dari folder release aktif"; done
! docker exec "$CID_OLD" test -e /app/src/lib/domain/unitBukanProduksi.js || die "container aktif sudah memuat unitBukanProduksi.js"
ok "kode di container == folder release aktif (belum memuat aturan sewa)"
N_SEWA="$(psql_live -At -c "select count(*) from units u join \"Order\" o on o.id = u.order_id where o.category = 'SEWA'")"; ok "unit sewa di production: ${N_SEWA} (tidak diubah rilis ini)"
FREE="$(bebas_kb)"; if [ "$MODE" = preflight ]; then [ "$FREE" -ge $((MIN_FREE_KB + 2 * 1024 * 1024)) ] && ok "disk bebas $((FREE/1024)) MiB" || warn "disk bebas $((FREE/1024)) MiB < 7 GiB; build akan berhenti"; say "Preflight selesai: produksi TIDAK diubah"; trap - EXIT; exit 0; fi
[ "$FREE" -ge $((MIN_FREE_KB + 2 * 1024 * 1024)) ] || die "butuh >= 7 GiB bebas untuk image"
[ ! -e "$NEW_DIR" ] || die "release dir sudah ada"

PHASE=4; say "4. Release dir (dist dari rilis aktif), build image, cek baca-saja atas data production"
mkdir "$NEW_DIR"; DIR_BARU=1; sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist'; printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "salin dist aktif gagal"
cmp -s "$PREV_DIR/frontend/dist/index.html" "$NEW_DIR/frontend/dist/index.html" || die "index.html baru tidak identik dengan yang aktif"
[ "$(cd "$PREV_DIR/frontend/dist" && find . -type f | LC_ALL=C sort | md5sum)" = "$(cd "$NEW_DIR/frontend/dist" && find . -type f | LC_ALL=C sort | md5sum)" ] || die "daftar berkas dist tidak sama"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"; ok "dist = salinan rilis aktif (${NEW_INDEX})"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-sbp1-${DEPLOY_SHORT}"; docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG"; DIBANGUN=1
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 20 "$BK_DIR/build.log"; die "build image gagal"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"; [ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image tidak berubah setelah build"
docker run --rm --entrypoint sh "$NEW_IMG_ID" -c 'test -f /app/src/lib/domain/unitBukanProduksi.js && for f in src/lib/domain/unitBukanProduksi.js src/services/productionOrderList.js src/services/productionWorkListService.js src/services/finance/hppOrder.js src/services/laporanProduksi.js src/routes/production.js scripts/cekSewaBukanProduksi.mjs; do node --check "/app/$f" || exit 1; done' || die "image baru tidak memuat kode baru / sintaks gagal"
ok "image baru ${NEW_IMG_ID:7:12}; rollback ${ROLLBACK_TAG}"
say "4b. Cek baca-saja: image BARU membaca data production (sesi READ ONLY) — produksi belum di-switch"
cek_data image "$NEW_IMG_ID"
FREE="$(bebas_kb)"; [ "$FREE" -ge "$MIN_FREE_KB" ] || die "disk bebas $((FREE/1024)) MiB < 5 GiB sesudah build"
if [ "$MODE" = buildonly ]; then
  docker tag "$PREV_IMG_ID" "$IMG_NAME"; DIBANGUN=0; rm -rf -- "$NEW_DIR"; DIR_BARU=0
  say "Build-only selesai: produksi TIDAK di-switch; tag image dikembalikan ke ${PREV_IMG_ID:7:12}; release dir dihapus; tag ${ROLLBACK_TAG} disimpan"; trap - EXIT; exit 0
fi

PHASE=5; say "5. Switch satu kali"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container berubah sebelum switch"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate deploy|/tmp/[a-z0-9]+\.sh' | grep -v 'sbp1\.sh\|pgrep\|node src/index.js' | grep -v "$$" || true)"; [ -z "$OTHER" ] || die "ada proses deploy/build/migrasi lain tepat sebelum switch"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah sebelum switch"
gd_baseline
T_SWITCH="$(date -u +%FT%TZ)"; DIR_BARU=0; dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "up gagal"
UP=0; for i in $(seq 1 60); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = 1 ] || die "backend baru tidak sehat"
CID_NEW=""; for i in $(seq 1 30); do CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s\n' "$CID_NEW" | grep -c .)" = 1 ] && break; sleep 2; done; [ "$(printf '%s\n' "$CID_NEW" | grep -c .)" = 1 ] || die "harus tepat satu backend setelah switch"
DIBANGUN=0; CID_OLD_ATAU_BARU="$CID_NEW"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container baru tidak memakai image yang dibangun"
ok "switch ${T_SWITCH}; image ${NEW_IMG_ID:7:12}"

PHASE=6; say "6. Verifikasi dan smoke (baca-saja)"
[ "$(curl -fsS -m15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik bukan dist yang sama"
[ "$(docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$CID_NEW" | tr ' ' '\n' | grep -c "^${NEW_DIR}/frontend/dist$")" = 1 ] || die "bind mount dist bukan folder rilis baru"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah"
for ep in /api/production/work-orders /api/production/work-orders/kelengkapan-hitung /api/production/work-list /api/production/board /api/production/command-center /api/finance/hpp-order/antrean; do [ "$(curl -s -o /dev/null -w '%{http_code}' -m15 "${PUBLIC_URL}${ep}")" = 401 ] || die "${ep} tanpa token harus 401"; done
cek_data container "$CID_NEW"
gd_verifikasi
sleep 15; [ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = 0 ] || die "backend restart sendiri"
ok "smoke lulus: endpoint tanpa token 401, cek data baca-saja lulus di container baru, RestartCount 0"
trap - EXIT; say "SELESAI ${DEPLOY_SHORT}: kasur sewa bukan pekerjaan Produksi. TANPA migrasi/tulis data. Rollback: bash /tmp/sbp1.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback (image ${ROLLBACK_TAG}). Log: ${BK_DIR}/release.log"
