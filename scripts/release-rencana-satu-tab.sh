#!/usr/bin/env bash
# RILIS "Rencana Produksi satu tab" (rst1) — keputusan Owner 12 Nov 2026: Produksi bekerja dari SATU tab tanpa menunggu tim lain.
# Backend: penerimaan workshop boleh menutup pickup yang belum ditutup driver (services/pickupDitutupProduksi.js), izin baru di respons Rencana (terima/statusOrder/pic),
# Armada tidak memundurkan unit yang sudah diterima Produksi. Web: tandai tiba, seret sentuh (Pointer Events), panel ruang kerja unit, PIC Meja, tampilan Corner di tab.
# TANPA migrasi, TANPA schema, TANPA tulis data oleh rilis. Image backend DIBANGUN ULANG; web dibangun di folder rilis; image lama diberi tag rollback lebih dulu.
# Kerangka = rilis nls1 (backend + web tanpa migrasi) + pembanding fitur dist dari rilis ssc1 (live 9eedb8a0) — dipin ulang ke live bbadd538 (AI Studio).
#   ssh ubuntu@43.133.152.6 'bash /tmp/rst1.sh <DEPLOY_SHA> <BASE_SHA> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'bash /tmp/rst1.sh <DEPLOY_SHA> <BASE_SHA> --build-only'       # + release dir, build web+image; tag image dikembalikan; release dir dihapus; TANPA switch
#   ssh ubuntu@43.133.152.6 'bash /tmp/rst1.sh <DEPLOY_SHA> <BASE_SHA>'                    # rilis penuh
#   ssh ubuntu@43.133.152.6 'bash /tmp/rst1.sh <DEPLOY_SHA> <BASE_SHA> --rollback'         # kembali ke folder+image baseline (rilis ini tidak mengubah data)
set -Eeuo pipefail
umask 077
DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ && "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen harus DEPLOY_SHA BASE_SHA 40 karakter" >&2; exit 1; }
MODE=release; for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --build-only) MODE=buildonly;; --rollback) MODE=rollback;; esac; done
CAND_BRANCH="${CAND_BRANCH:-feat/rencana-satu-tab-on-bbadd538}"; CAND_REF="refs/remotes/origin/cand-rst1"
ALLOWED_RE='^(backend/scripts/production-delivery-v2/audit-custody-writers\.js|backend/scripts/production-delivery-v2/audit-qc-handoff-writers\.js|backend/src/lib/activityLog\.js|backend/src/routes/armada\.js|backend/src/routes/productionAdopsi\.js|backend/src/routes/productionRencanaJadwal\.js|backend/src/services/pickupDitutupProduksi\.js|backend/src/services/productionRencanaJadwalService\.js|backend/src/services/unitWorkshopReceiptService\.js|backend/tests/integration/pickupDitutupProduksi\.integration\.test\.js|frontend/src/api\.js|frontend/src/features/production/rencana/[A-Za-z]+\.(jsx|js|css)|frontend/src/features/production/workspace/UnitWorkspace\.jsx|frontend/src/pages/bengkel/ProductionRencanaMinggu\.jsx|frontend/tests/rencanaMinggu\.test\.js|frontend/tests/rencanaTandaiTiba\.test\.js|scripts/release-rencana-satu-tab\.sh)$'
DIFF_SHA='9dfcff86c70946f8ac6a090def0ab6098cc3e4713811c073e785c76e71702f26'
PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"; PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MIN_FREE_KB=$((5 * 1024 * 1024)); TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/rencana-satu-tab-${DEPLOY_SHORT}-${TS}"
PHASE=init; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; ROLLBACK_TAG=""; DIBANGUN=0; DIR_BARU=0
say() { printf '\n== %s\n' "$*"; }; ok() { printf '  OK    %s\n' "$*"; }; warn() { printf '  PERHATIAN %s\n' "$*"; }; die() { printf '\nSTOP [%s]: %s\n' "$PHASE" "$*" >&2; exit 1; }
sg() { git --git-dir="$SRC" "$@"; }
dcp() { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { docker exec -i "$PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
bebas_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
cari_dist() { find "$1/frontend/dist/assets" -maxdepth 1 -type f -name "*.$2" -print0 2>/dev/null | xargs -0 grep -lF -- "$3" 2>/dev/null | sed -n 1p; } # BUKAN glob (>21.000 chunk melampaui ARG_MAX)
# Bila berhenti SEBELUM switch: kembalikan tag image ke image yang sedang berjalan dan hapus release dir buatan rilis ini (container lama tidak tersentuh).
pulihkan() {
  if [ "$DIBANGUN" = 1 ] && [ -n "$PREV_IMG_ID" ] && [ -n "$IMG_NAME" ]; then docker tag "$PREV_IMG_ID" "$IMG_NAME" >/dev/null 2>&1 || true; fi
  if [ "$DIR_BARU" = 1 ] && [ "$NEW_DIR" = "$RELEASES/$DEPLOY_SHORT" ] && [ "$NEW_DIR" != "$PREV_DIR" ]; then rm -rf -- "$NEW_DIR"; fi
}
trap 'rc=$?; [ $rc -ne 0 ] && { pulihkan; printf "Berhenti di fase %s. Bila sudah switch: bash /tmp/rst1.sh %s %s --rollback\n" "$PHASE" "$DEPLOY_SHA" "$BASE_SHA"; }; exit $rc' EXIT

# ── GERBANG DATA (sama dengan nls1/sbp1): A. statis identik persis; B. tabel operasional identik pada batas cutoff (baris baru sesudah cutoff = trafik sah) ──
GD_BERGERAK=( 'Message|"Message"|"createdAt"' 'stock_movements|stock_movements|created_at' 'material_issues|material_issues|created_at' 'stock_transfers|stock_transfers|created_at'
  'warehouse_corrections|warehouse_corrections|requested_at' 'units|units|created_at' 'Order|"Order"|"createdAt"' 'order_biaya_tanpa_stok|order_biaya_tanpa_stok|diajukan_pada' )
GD_SQL_STATIS="select 'migrasi|' || count(*) filter (where finished_at is not null) || '|' || md5(coalesce(string_agg(migration_name || ':' || checksum || ':' || (finished_at is not null)::text, ',' order by migration_name), '')) from _prisma_migrations
union all select 'skema|' || md5(coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || udt_name || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema = 'public'
union all select 'indeks|' || md5(coalesce(string_agg(tablename || ':' || indexdef, ',' order by tablename, indexname), '')) from pg_indexes where schemaname = 'public'
union all select 'constraint|' || md5(coalesce(string_agg(conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname), '')) from pg_constraint where connamespace = 'public'::regnamespace
union all select 'konfig attribution_kpi_targets|' || count(*) || '|' || md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from attribution_kpi_targets t"
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
  ok "baseline data dicatat (statis 5 sidik; ${#GD_BERGERAK[@]} tabel bergerak, cutoff ${FP_CUTOFF} UTC)"
}
gd_verifikasi() {
  local s1 b1 d
  s1="$(psql_live -At -c "$GD_SQL_STATIS")" || die "data statis sesudah switch gagal dibaca"
  b1="$(psql_live -At -c "$(gd_sql_bergerak)")" || die "tabel bergerak sesudah switch gagal dibaca"
  { echo "--statis sesudah"; echo "$s1"; echo "--bergerak sesudah (<= cutoff ${FP_CUTOFF})"; echo "$b1"; } > "$BK_DIR/gerbang-data-sesudah.txt"
  if [ "$s1" != "$FP_STATIS_0" ]; then d="$(diff <(printf '%s\n' "$FP_STATIS_0") <(printf '%s\n' "$s1") | grep '^[<>]' | cut -c1-160 | head -6 | sed 's/^/        /' || true)"; printf '%s\n' "$d"; die "DATA STATIS BERUBAH selama rilis"; fi
  if [ "$b1" != "$FP_BERGERAK_0" ]; then d="$(diff <(printf '%s\n' "$FP_BERGERAK_0") <(printf '%s\n' "$b1") | grep '^[<>]' | cut -c1-160 | head -8 | sed 's/^/        /' || true)"; printf '%s\n' "$d"; die "baris berstempel <= cutoff ${FP_CUTOFF} BERUBAH — bukan trafik baru"; fi
  ok "data statis identik; tabel operasional identik pada cutoff ${FP_CUTOFF} UTC"
}

PHASE=0; say "0. Kunci dan konkurensi"
[ ! -e "$HOME/releases/DEPLOY_LOCK" ] || die "~/releases/DEPLOY_LOCK ada — sesi lain sedang merilis: $(head -c 300 "$HOME/releases/DEPLOY_LOCK" | tr '\n' ' ')"
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain berjalan (${lf})"; done
exec 9>/tmp/release-rencana-satu-tab.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate deploy|/tmp/[a-z0-9]+\.sh' | grep -v 'rst1\.sh\|pgrep\|node src/index.js' | grep -v "$$" || true)"; [ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/   /'; die "ada proses deploy/build/migrasi lain"; }
mkdir -p "$BK_DIR" "$HOME/release-src"; exec > >(tee -a "$BK_DIR/release.log") 2>&1
ok "tidak ada deploy lain"

PHASE=1; say "1. Release aktif"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = 1 ] || die "harus tepat satu backend"
PG="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=postgres")"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"; PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"; ENV_SHA="$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)"
ok "aktif ${PREV_DIR} marker ${PREV_COMMIT} image ${PREV_IMG_ID:7:12} env ${ENV_SHA}"
if [ "$MODE" = rollback ]; then
  PHASE=rollback; [ "$(basename "$PREV_DIR")" = "$DEPLOY_SHORT" ] || die "release aktif bukan ${DEPLOY_SHORT}; rollback ditolak agar tidak menimpa rilis lain"
  T="$RELEASES/${BASE_SHA:0:8}"; [ -d "$T" ] || die "folder baseline tidak ada"; TAG="${IMG_NAME%%:*}:rollback-pre-rst1-${DEPLOY_SHORT}"; docker image inspect "$TAG" >/dev/null 2>&1 || die "tag rollback tidak ada"
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
CHANGED="$(sg -c core.quotepath=false diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"; [ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/   /'; die "berkas di luar allowlist"; }
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)(docker-compose[^/]*|Dockerfile)$|package(-lock)?\.json$|\.env|^frontend/dist' || die "Docker/package/env/dist berubah"
[ -z "$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma)" ] || die "rilis ini TANPA migrasi/schema"
[ "$(sg -c core.quotepath=false diff --no-renames --no-color --no-ext-diff --binary --full-index "$BASE_SHA" "$DEPLOY_SHA" -- backend frontend | sha256sum | cut -d' ' -f1)" = "$DIFF_SHA" ] || die "isi diff backend+frontend berbeda dari yang diaudit"
ok "$(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist; backend/prisma & package tidak berubah; isi diff sesuai pin"

PHASE=3; say "3. Audit produksi (isi kode, bukan marker)"
curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "health internal"; curl -fsS -m15 "${PUBLIC_URL}/api/health" | grep -q '"ok":true' || die "health publik"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = 0 ] || die "migrasi menggantung"
sg -c core.quotepath=false ls-tree -r "$BASE_SHA" | awk -F'\t' '$1 ~ /^100[0-9]+ blob/ && $2 !~ /^frontend\/dist\// { split($1,a," "); print a[3] "\t" $2 }' > "$BK_DIR/base.tsv"
cut -f2 "$BK_DIR/base.tsv" | sed "s#^#${PREV_DIR}/#" | git hash-object --no-filters --stdin-paths > "$BK_DIR/live.txt" || die "berkas baseline hilang di release aktif"
BEDA="$(paste "$BK_DIR/base.tsv" "$BK_DIR/live.txt" | awk -F'\t' '$1 != $3' | wc -l)"; [ "$BEDA" = 0 ] || die "kode live menyimpang dari baseline: ${BEDA} berkas"
ok "kode live == baseline ($(wc -l < "$BK_DIR/base.tsv") berkas)"
for f in src/services/unitWorkshopReceiptService.js src/routes/armada.js src/routes/productionRencanaJadwal.js; do docker exec "$CID_OLD" cat "/app/$f" | cmp -s - "$PREV_DIR/backend/$f" || die "${f} di container berbeda dari folder release aktif"; done
! docker exec "$CID_OLD" test -e /app/src/services/pickupDitutupProduksi.js || die "container aktif sudah memuat pickupDitutupProduksi.js"
ok "kode di container == folder release aktif (belum memuat penutupan pickup oleh Produksi)"
FREE="$(bebas_kb)"; if [ "$MODE" = preflight ]; then [ "$FREE" -ge $((MIN_FREE_KB + 2 * 1024 * 1024)) ] && ok "disk bebas $((FREE/1024)) MiB" || warn "disk bebas $((FREE/1024)) MiB < 7 GiB; build akan berhenti"; say "Preflight selesai: produksi TIDAK diubah"; trap - EXIT; exit 0; fi
[ "$FREE" -ge $((MIN_FREE_KB + 2 * 1024 * 1024)) ] || die "butuh >= 7 GiB bebas untuk image+web"
[ ! -e "$NEW_DIR" ] || die "release dir sudah ada"

PHASE=4; say "4. Release dir, build web + image"
mkdir "$NEW_DIR"; DIR_BARU=1; sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist'; printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; FE_NM=""; for d in "$PREV_DIR" $(ls -dt "$(dirname "$PREV_DIR")"/*/); do d="${d%/}"; if [ -d "$d/frontend/node_modules" ] && cmp -s "$d/frontend/package-lock.json" "$NEW_DIR/frontend/package-lock.json"; then FE_NM="$d/frontend/node_modules"; break; fi; done
[ -n "$FE_NM" ] || die "node_modules frontend dengan package-lock sama tidak ditemukan"; ok "node_modules frontend dari $(basename "$(dirname "$(dirname "$FE_NM")")")"; cp -a "$FE_NM" "$NEW_DIR/frontend/node_modules" || die "salin node_modules frontend gagal"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env"; ( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/web.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 20 "$BK_DIR/web.log"; die "build web gagal"; }; rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"; [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "dist tidak valid"
# Fitur BARU: ada di dist baru, belum ada di dist aktif (diperiksa SEBELUM aset lama dibawa)
for j in "Lepas untuk menaruh di sini" "Tandai sudah tiba di workshop" "rc-panel-tombol"; do [ -z "$(cari_dist "$PREV_DIR" js "$j")" ] || die "[skrip] '${j}' sudah ada di dist aktif — perbaiki pembanding"; [ -n "$(cari_dist "$NEW_DIR" js "$j")" ] || die "dist baru tanpa '${j}'"; done
for c in ".rc-salinan" ".rc-segmen-latar" ".rc-pic-teks"; do [ -z "$(cari_dist "$PREV_DIR" css "$c")" ] || die "[skrip] '${c}' sudah ada di CSS aktif — perbaiki pembanding"; [ -n "$(cari_dist "$NEW_DIR" css "$c")" ] || die "CSS baru tanpa ${c}"; done
# Fitur live (Rencana lama + daftar ssc1) HARUS tetap ada di KEDUANYA
for j in "Belum dijadwalkan" "Butuh keputusan" "Rencana Admin" "Daftar kerja" 'to:"/broadcast-sales"' 'to:"/laporan"' 'to:"/komplain"' 'path:"/marketing/pengajuan-biaya"' "Lead tanpa spam" "Cari halaman, pelanggan, order" "sanss.cari.riwayat.v1" "Aktif di periode" "Peringkat hanya di dalam kelompok" "Catat hasil SO" "Satu dokumen, satu baris" "ap-kepala-judul" "portal-kartu"; do
  [ -n "$(cari_dist "$PREV_DIR" js "$j")" ] || die "[skrip] '${j}' tidak ada di dist aktif — perbaiki pembanding"; [ -n "$(cari_dist "$NEW_DIR" js "$j")" ] || die "dist baru KEHILANGAN '${j}'"; done
for j in 'to:"/sales-intelligence"' 'to:"/copilot"' 'section:"AI & OTOMASI"' 'sidebar-help-btn'; do [ -z "$(cari_dist "$NEW_DIR" js "$j")" ] || die "dist baru MEMUNCULKAN LAGI menu yang dicabut ssc1: ${j}"; done
for c in ".prod-rc-kartu" ".prod-rc-meja" ".sp-panel" ".nt-kapsul" ".mk-kpi-grid" ".ap-hero" ".gud-pi-grid" ".fin-tg-kpi"; do [ -n "$(cari_dist "$PREV_DIR" css "$c")" ] || die "[skrip] '${c}' tidak ada di CSS aktif — perbaiki pembanding"; [ -n "$(cari_dist "$NEW_DIR" css "$c")" ] || die "CSS baru KEHILANGAN ${c}"; done
[ -f "$NEW_DIR/frontend/dist/sw.js" ] && ! grep -qF '"url":"index.html"' "$NEW_DIR/frontend/dist/sw.js" && grep -qF 'addEventListener("push"' "$NEW_DIR/frontend/dist/sw.js" || die "service worker baru tidak sesuai (precache index.html / push hilang)"
[ -n "$(ls "$NEW_DIR"/frontend/dist/assets/ | grep -E '^bca-.*\.svg$' | sed -n 1p)" ] && [ -n "$(ls "$NEW_DIR"/frontend/dist/assets/ | grep -E '^mandiri-.*\.png$' | sed -n 1p)" ] || die "dist baru tanpa logo bank"
n=0; for f in "$PREV_DIR"/frontend/dist/assets/*; do b="${f##*/}"; [ -e "$NEW_DIR/frontend/dist/assets/$b" ] || { cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b"; n=$((n+1)); }; done; ok "web ${NEW_INDEX}; ${n} aset lama dibawa; fitur baru ada, fitur live tetap ada, menu yang dicabut tetap hilang"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-rst1-${DEPLOY_SHORT}"; docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG"; DIBANGUN=1
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 20 "$BK_DIR/build.log"; die "build image gagal"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"; [ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image tidak berubah setelah build"
docker run --rm --entrypoint sh "$NEW_IMG_ID" -c 'test -f /app/src/services/pickupDitutupProduksi.js && for f in src/services/pickupDitutupProduksi.js src/services/unitWorkshopReceiptService.js src/routes/armada.js src/routes/productionAdopsi.js src/routes/productionRencanaJadwal.js src/services/productionRencanaJadwalService.js src/lib/activityLog.js; do node --check "/app/$f" || exit 1; done' || die "image baru tidak memuat kode baru / sintaks gagal"
ok "image baru ${NEW_IMG_ID:7:12}; rollback ${ROLLBACK_TAG}"
FREE="$(bebas_kb)"; [ "$FREE" -ge "$MIN_FREE_KB" ] || die "disk bebas $((FREE/1024)) MiB < 5 GiB sesudah build"
if [ "$MODE" = buildonly ]; then
  docker tag "$PREV_IMG_ID" "$IMG_NAME"; DIBANGUN=0; rm -rf -- "$NEW_DIR"; DIR_BARU=0
  say "Build-only selesai: produksi TIDAK di-switch; tag image dikembalikan ke ${PREV_IMG_ID:7:12}; release dir dihapus; tag ${ROLLBACK_TAG} disimpan"; trap - EXIT; exit 0
fi

PHASE=5; say "5. Switch satu kali"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container berubah sebelum switch"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate deploy|/tmp/[a-z0-9]+\.sh' | grep -v 'rst1\.sh\|pgrep\|node src/index.js' | grep -v "$$" || true)"; [ -z "$OTHER" ] || die "ada proses deploy/build/migrasi lain tepat sebelum switch"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah sebelum switch"
gd_baseline
T_SWITCH="$(date -u +%FT%TZ)"; DIR_BARU=0; dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "up gagal"
UP=0; for i in $(seq 1 60); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = 1 ] || die "backend baru tidak sehat"
CID_NEW=""; for i in $(seq 1 30); do CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s\n' "$CID_NEW" | grep -c .)" = 1 ] && break; sleep 2; done; [ "$(printf '%s\n' "$CID_NEW" | grep -c .)" = 1 ] || die "harus tepat satu backend setelah switch"
DIBANGUN=0
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container baru tidak memakai image yang dibangun"
ok "switch ${T_SWITCH}; image ${NEW_IMG_ID:7:12}"

PHASE=6; say "6. Verifikasi dan smoke (baca-saja)"
[ "$(curl -fsS -m15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik bukan dist baru"
[ "$(docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$CID_NEW" | tr ' ' '\n' | grep -c "^${NEW_DIR}/frontend/dist$")" = 1 ] || die "bind mount dist bukan folder rilis baru"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah"
gd_verifikasi
for ep in /api/production/rencana/minggu /api/production/rencana/antrean /api/production/penerimaan-workshop/pilihan /api/production-v2/corner-board /api/production/work-orders; do [ "$(curl -s -o /dev/null -w '%{http_code}' -m15 "${PUBLIC_URL}${ep}")" = 401 ] || die "${ep} tanpa token harus 401"; done
docker exec "$CID_NEW" test -f /app/src/services/pickupDitutupProduksi.js || die "container baru tanpa pickupDitutupProduksi.js"
OLDF="$(find "$PREV_DIR/frontend/dist/assets" -maxdepth 1 -name '*.js' -print -quit)"; [ "$(curl -s -o /dev/null -w '%{http_code}' -m15 "${PUBLIC_URL}/assets/${OLDF##*/}")" = 200 ] || die "aset lama tidak lagi 200"
# Lokasi workshop bawaan (dibutuhkan "Tandai tiba"): dibaca-saja dari container baru; tidak valid = PERHATIAN (fitur menolak dengan pesan jelas, tidak ada yang berubah), bukan STOP.
LOK="$(docker exec "$CID_NEW" node --input-type=module -e 'import { prisma } from "./src/db.js"; import { inspectWorkshopDefaultLocation } from "./src/services/productionSettingsService.js"; const s = await inspectWorkshopDefaultLocation(prisma); console.log(s.valid ? "VALID " + s.location.code : "TIDAK_VALID " + s.problem); await prisma.$disconnect();' 2>&1 | tail -n 1)"
case "$LOK" in VALID*) ok "lokasi workshop bawaan: ${LOK#VALID }";; *) warn "lokasi workshop bawaan ${LOK} — 'Tandai tiba' akan menolak sampai Admin mengaturnya di Pengaturan Produksi › Alur Kerja";; esac
sleep 15; [ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = 0 ] || die "backend restart sendiri"
ok "smoke lulus: endpoint tanpa token 401, aset lama 200, RestartCount 0"
trap - EXIT; say "SELESAI ${DEPLOY_SHORT}: Rencana Produksi satu tab. TANPA migrasi/tulis data. Rollback: bash /tmp/rst1.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback (image ${ROLLBACK_TAG}). Log: ${BK_DIR}/release.log"
