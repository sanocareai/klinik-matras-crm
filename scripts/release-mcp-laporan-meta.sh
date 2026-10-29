#!/usr/bin/env bash
# RILIS "MCP LAPORAN META ADS" (konektor Claude + ChatGPT): BACKEND-SAJA, TANPA migrasi, TANPA perubahan schema.prisma, TANPA perubahan frontend/env — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • Tiga tool MCP baca-saja (performa_campaign_meta, rekap_harian_meta, kesehatan_atribusi_meta) di /mcp dan (sebagai sales_*) di /mcp-chatgpt, memakai hitungLaporanIklan yang SAMA dengan GET /api/atribusi/iklan.
#     Tidak ada tabel, tracking, atau rumus bisnis kedua; respons hanya agregat + ID/nama iklan (tanpa data customer). Tool lama performa_iklan tetap kompatibel.
#   • Perubahan service lama bersifat ADITIF (customerPernahMembayar pada baris /iklan; penjaga satu-perhitungan-sekaligus dipindah ke modul bersama). allowlist EKSPLISIT di bawah = pin.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore; smoke lewat TIGA jalur auth — OAuth ChatGPT, OAuth Claude, token statis — dan hasil tool == endpoint;
#     tidak ada baris berubah; direktori data/uploads production TIDAK dipasang); frontend/dist release aktif DIBAWA APA ADANYA (tidak dibangun ulang); switch SATU kali; verifikasi; smoke baca-saja pasca-switch
#     dengan kode yang sama lewat jalur auth yang sebenarnya.
#   • BASELINE = release aktif. GERBANG IDENTITAS KODE LIVE membandingkan ISI kode (hash blob SEMUA berkas terlacak baseline, berkas tambahan, container == folder release, identitas proses) di fase 2, fase 6,
#     dan TEPAT sebelum switch; selisih isi apa pun / berkas tambahan / proses berganti = berhenti sebelum switch (perubahan sesi lain tidak pernah ditimpa diam-diam).
#   • UJI LOKAL ≠ DISCOVERY KONEKTOR: skrip membuktikan kode server, auth, dan hasil. Bahwa claude.ai / ChatGPT melihat tool baru hanya terbukti SESUDAH rilis lewat refresh konektor (langkah manual, lihat CATATAN akhir).
#   • Pembersihan release lama (fase 9) DINONAKTIFKAN pada rilis ini: tidak ada folder release/image rollback/backup/volume yang dihapus oleh skrip.
#
#   cat scripts/release-mcp-laporan-meta.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/mlm.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/mlm.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/mlm.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/mlmr.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/mlm.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/mlm.out 2>&1 < /dev/null &'   # rilis penuh (hanya setelah persetujuan)
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru, tanpa tulisan data). Setelah rollback daftar tool kembali ke versi lama; klien konektor perlu refresh lagi.
# (dibangkitkan oleh scripts/gen-release-mcp-laporan-meta.cjs dari scripts/release-mcp-laporan-meta.sh + scripts/templates/release-mcp-laporan-meta/*; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/mcp-laporan-meta-ads}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/src/mcp/chatgptPlugin\.js|backend/src/mcp/gptActions\.js|backend/src/mcp/index\.js|backend/src/mcp/penjagaAksesLaporan\.js|backend/src/mcp/toolsAtribusiIklan\.js|backend/src/mcp/toolsTraffic\.js|backend/src/routes/attributionAds\.js|backend/src/services/attribution/biayaKpi\.js|backend/src/services/attribution/iklanReport\.js|backend/src/services/attribution/laporanMeta\.js|backend/src/services/attribution/penjagaLaporan\.js|backend/tests/integration/mcpChatGptSales\.integration\.test\.js|backend/tests/integration/mcpLaporanMeta\.integration\.test\.js|backend/tests/integration/mcpLaporanMetaAkses\.integration\.test\.js|backend/tests/integration/mcpOAuthIssuer\.integration\.test\.js|backend/tests/integration/releaseMcpLaporanMetaLib\.integration\.test\.js|backend/tests/integration/setup/metaAdsSeed\.js|backend/tests/laporanMeta\.test\.js|backend/tests/mcp-chatgpt-plugin\.test\.js|backend/tests/mcp\.test\.js|backend/tests/releaseMcpLaporanMeta\.test\.js|docs/CHATGPT-MCP-PLUGIN\.md|docs/MCP-LAPORAN-META-ADS\.md|plugins/sanss-sales-crm/plugin\.json|scripts/gen-release-mcp-laporan-meta\.cjs|scripts/lib/rehearsal-mcp-laporan-meta\.mjs|scripts/lib/smoke-mcp-laporan-meta\.mjs|scripts/release-mcp-laporan-meta\.sh|scripts/templates/release-mcp-laporan-meta/header\.txt|scripts/templates/release-mcp-laporan-meta/rollback\.txt)$'
BACKEND_SRC_EXPECT="backend/src/mcp/chatgptPlugin.js backend/src/mcp/gptActions.js backend/src/mcp/index.js backend/src/mcp/penjagaAksesLaporan.js backend/src/mcp/toolsAtribusiIklan.js backend/src/mcp/toolsTraffic.js backend/src/routes/attributionAds.js backend/src/services/attribution/biayaKpi.js backend/src/services/attribution/iklanReport.js backend/src/services/attribution/laporanMeta.js backend/src/services/attribution/penjagaLaporan.js"
FRONTEND_SRC_EXPECT=""   # rilis backend-saja: tidak ada berkas frontend yang boleh berubah
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
BK_DIR="$HOME/release-backups/mcp-laporan-meta-${DEPLOY_SHORT}-${TS}"
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
Rilis ini TANPA migrasi dan TANPA tulisan data oleh skripnya: rollback KODE aman kapan pun. Bila rollback setelah switch:
Tujuan rollback = image dan folder release LIVE SEBELUM rilis ini (gerbang kode live membuktikan kode di container == folder == baseline disetujui). Folder ${PREV_DIR} tidak dihapus.
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
frontend/dist tidak diubah oleh rilis ini (dibawa apa adanya), jadi tidak ada yang perlu dikembalikan di web.
Setelah rollback: /mcp dan /mcp-chatgpt kembali ke daftar tool lama (tiga tool Meta hilang). Klien konektor (claude.ai, ChatGPT) menyimpan daftar tool per koneksi — lakukan refresh/sambung ulang lagi agar tool yang sudah tidak ada tidak tampil.
Rilis ini tidak membuat atau mengubah data apa pun (tool baca-saja); tidak ada yang perlu dibalik di database.
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
exec 9>/tmp/release-mcp-laporan-meta.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "mlm\|release-mcp-laporan-meta\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
[ -z "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/' || true)" ] || die "rilis ini BACKEND-SAJA: ada berkas frontend/ yang berbeda dari baseline"
[ -z "$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)" ] || { printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/'; die "backend/prisma berubah — rilis ini TANPA migrasi dan TANPA perubahan schema.prisma"; }
[ -z "$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma backend/prisma/migrations)" ] || die "schema.prisma/migrations berbeda dari baseline"
ok "tanpa migrasi, tanpa perubahan schema.prisma; kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit"

# ── GERBANG IDENTITAS KODE LIVE (marker .release-commit SAJA TIDAK CUKUP) ─────────────────────────────────────────────────────────
# Kejadian 28 Okt 2026: release aktif bc8b81ab bermarker 8527e9b8 tetapi memuat hotfix performa yang diterapkan langsung ke folder (tidak pernah dikomit);
# rilis lewat git archive akan menimpanya diam-diam. Gerbang ini membandingkan ISI kode yang BENAR-BENAR berjalan dengan snapshot baseline yang
# disetujui (pohon git BASE_SHA), bukan label:
#   (a) setiap berkas terlacak baseline (kecuali frontend/dist) di release aktif harus sama (hash blob git). Selisih HANYA akhir baris (CRLF vs LF)
#       dicatat terpisah; selisih isi apa pun = berhenti;
#   (b) tidak boleh ada berkas tambahan di release aktif yang tidak ada di baseline (selain .release-commit, node_modules, uploads, frontend/dist);
#   (c) kode backend DI DALAM container yang sedang berjalan harus identik dengan folder release aktifnya (src, prisma, scripts, tests, package*.json);
#   (d) identitas proses tidak bergeser sejak audit awal (container, image, waktu mulai).
# Marker hanya boleh = baseline atau LELUHUR baseline. Dijalankan di fase 2, sebelum switch (fase 6), dan sekali lagi TEPAT sebelum switch (fase 7).
gerbang_kode_live() {
  local label="$1" d="$PREV_DIR" tsv="$BK_DIR/base-tree.tsv" p oid mc total nbeda neol CID
  mkdir -p "$BK_DIR"
  mc="$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)"
  [ -n "$mc" ] || die "[${label}] marker release aktif (${PREV_COMMIT}) tidak dikenal di repo sumber"
  if [ "$mc" != "$BASE_SHA" ]; then sg merge-base --is-ancestor "$mc" "$BASE_SHA" || die "[${label}] marker ${PREV_COMMIT} BUKAN baseline/leluhur baseline ${BASE_SHA:0:8}; produksi bergeser — berhenti"; fi
  # (a) isi berkas terlacak
  sg -c core.quotepath=false ls-tree -r "$BASE_SHA" | awk -F'\t' '$1 ~ /^100[0-9]+ blob/ && $2 !~ /^frontend\/dist\// { split($1, a, " "); print a[3] "\t" $2 }' > "$tsv"
  total="$(wc -l < "$tsv" | tr -d ' ')"; [ "$total" -gt 1000 ] || die "[${label}] daftar berkas baseline terlalu pendek (${total})"
  p="$(cut -f2 "$tsv" | while IFS= read -r f; do [ -f "$d/$f" ] || printf '%s\n' "$f"; done | head -10)"
  [ -z "$p" ] || { printf '%s\n' "$p" | sed 's/^/        HILANG: /'; die "[${label}] berkas baseline HILANG di release aktif ${d}"; }
  ( cd "$d" && cut -f2 "$tsv" | git hash-object --no-filters --stdin-paths ) > "$BK_DIR/live-hash.txt"
  [ "$(wc -l < "$BK_DIR/live-hash.txt" | tr -d ' ')" = "$total" ] || die "[${label}] jumlah hash live != jumlah berkas baseline"
  paste "$tsv" "$BK_DIR/live-hash.txt" | awk -F'\t' '$1 != $3 { print $2 "\t" $1 }' > "$BK_DIR/beda-mentah.tsv"
  nbeda="$(wc -l < "$BK_DIR/beda-mentah.tsv" | tr -d ' ')"
  : > "$BK_DIR/beda-eol.txt"; : > "$BK_DIR/beda-isi.txt"
  while IFS=$'\t' read -r p oid; do
    case "$p" in
      *.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.html|*.md|*.txt|*.sh|*.yml|*.yaml|*.sql|*.prisma|*.ts|*.tsx|*.svg)
        if [ "$(tr -d '\r' < "$d/$p" | git hash-object --stdin)" = "$oid" ]; then printf '%s\n' "$p" >> "$BK_DIR/beda-eol.txt"; continue; fi;;
    esac
    printf '%s\n' "$p" >> "$BK_DIR/beda-isi.txt"
  done < "$BK_DIR/beda-mentah.tsv"
  neol="$(wc -l < "$BK_DIR/beda-eol.txt" | tr -d ' ')"
  if [ -s "$BK_DIR/beda-isi.txt" ]; then head -20 "$BK_DIR/beda-isi.txt" | sed 's/^/        BEDA ISI: /'; die "[${label}] KODE LIVE menyimpang dari baseline ${BASE_SHA:0:8}: $(wc -l < "$BK_DIR/beda-isi.txt" | tr -d ' ') berkas berbeda isi — berhenti, JANGAN switch"; fi
  # (b) berkas tambahan di release aktif
  ( cd "$d" && find . -type f -not -path './frontend/dist/*' -not -path '*/node_modules/*' -not -path './backend/uploads/*' | sed 's|^\./||' | LC_ALL=C sort ) > "$BK_DIR/live-files.txt"
  sg -c core.quotepath=false ls-tree -r --name-only "$BASE_SHA" | LC_ALL=C sort > "$BK_DIR/base-files.txt"
  p="$(LC_ALL=C comm -13 "$BK_DIR/base-files.txt" "$BK_DIR/live-files.txt" | grep -vxF '.release-commit' || true)"
  [ -z "$p" ] || { printf '%s\n' "$p" | head -20 | sed 's/^/        TAMBAHAN: /'; die "[${label}] release aktif memuat berkas yang TIDAK ada di baseline ${BASE_SHA:0:8} — berhenti"; }
  # (c) container berjalan == folder release aktif
  CID="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
  [ "$(printf '%s\n' "$CID" | grep -c .)" = "1" ] || die "[${label}] harus tepat satu container backend"
  docker exec "$CID" sh -c 'cd /app && { for x in src prisma scripts tests; do [ -d "$x" ] && find "$x" -type f; done; } | LC_ALL=C sort | xargs sha256sum && sha256sum package.json package-lock.json' > "$BK_DIR/container-sha.txt" || die "[${label}] gagal membaca kode di dalam container"
  ( cd "$d/backend" && { for x in src prisma scripts tests; do [ -d "$x" ] && find "$x" -type f; done; } | LC_ALL=C sort | xargs sha256sum && sha256sum package.json package-lock.json ) > "$BK_DIR/dir-sha.txt"
  cmp -s "$BK_DIR/container-sha.txt" "$BK_DIR/dir-sha.txt" || { diff "$BK_DIR/container-sha.txt" "$BK_DIR/dir-sha.txt" | head -10 | sed 's/^/        /'; die "[${label}] kode di dalam container BERBEDA dari folder release aktif ${d}"; }
  # (d) identitas proses tidak bergeser
  [ "$CID" = "$CID_OLD" ] || die "[${label}] container backend berganti sejak audit awal"
  [ "$(docker inspect -f '{{.Image}}' "$CID")" = "$PREV_IMG_ID" ] || die "[${label}] image container berubah sejak audit awal"
  [ "$(docker inspect -f '{{.State.StartedAt}}' "$CID")" = "$PREV_STARTED" ] || die "[${label}] container dimulai ulang sejak audit awal"
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID")" = "$PREV_DIR" ] || die "[${label}] folder release aktif berubah sejak audit awal"
  {
    echo "gerbang=${label} waktu=$(date -u +%FT%TZ)"
    echo "release aktif=${d} marker=${PREV_COMMIT} (-> ${mc}) image=${PREV_IMG_ID} container=${CID:0:12} mulai=${PREV_STARTED}"
    echo "baseline disetujui=${BASE_SHA}"
    echo "berkas terlacak dibandingkan=${total}; sama persis=$((total - nbeda)); beda akhir-baris saja=${neol}; beda isi=0; berkas tambahan=0"
    echo "container == folder release: $(wc -l < "$BK_DIR/container-sha.txt" | tr -d ' ') berkas identik"
    echo "-- berkas yang hanya beda akhir baris (CRLF di live, LF di baseline):"; cat "$BK_DIR/beda-eol.txt"
  } >> "$BK_DIR/kode-live.txt"
  ok "[${label}] kode live == baseline ${BASE_SHA:0:8}: ${total} berkas terlacak sama isi (${neol} hanya beda akhir baris), 0 berkas tambahan, container == folder release; marker ${PREV_COMMIT}"
}
# Tepat sebelum switch: pastikan tidak ada deploy/build/migrasi lain (mengulang pemeriksaan fase 0, kecuali kunci rilis ini sendiri).
tidak_ada_deploy_lain_lagi() {
  local lf OTHER
  for lf in /tmp/release-*.lock; do
    [ -e "$lf" ] || continue; [ "$lf" = "/tmp/release-mcp-laporan-meta.lock" ] && continue
    ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain mulai berjalan (kunci ${lf} dipegang) — berhenti sebelum switch"
  done
  OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "mlm\|release-mcp-laporan-meta\|pgrep\|node src/index.js" | grep -v "$$" || true)"
  [ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain tepat sebelum switch — berhenti"; }
  ok "tepat sebelum switch: tidak ada deploy/build/migrasi lain"
}

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
# marker TIDAK dipakai sebagai bukti identitas: gerbang_kode_live (di atas) membandingkan ISI kode live dengan snapshot baseline
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
ok "release aktif ${PREV_DIR} (marker ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
PREV_STARTED="$(docker inspect -f '{{.State.StartedAt}}' "$CID_OLD")"
gerbang_kode_live "fase-2-audit"
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

say "2b. Ruang disk (rilis backend-saja: tanpa build dan tanpa node_modules frontend)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-mcp-laporan-meta-${DEPLOY_SHORT}-${TS}.sql.gz"
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
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin frontend/dist release aktif"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat; compose identik"

PHASE="4b-dist-tetap"; say "4b. Rilis BACKEND-SAJA: frontend/dist release aktif dibawa APA ADANYA (tidak dibangun ulang; tidak ada aset yang berubah)"
diff -rq "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" >/dev/null || die "frontend/dist release baru berbeda dari release aktif"
NEW_INDEX="$PREV_INDEX"
[ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "bundel utama tidak ada di dist yang dibawa"
ok "frontend/dist identik dengan release aktif (${NEW_INDEX}); tidak ada build frontend"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-mlm-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
[ "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"
ok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR}: memuat hotfix performa (kode container == folder == baseline disetujui, terbukti gerbang kode live)"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_mlm_${TS}"
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
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): MCP laporan Meta Ads — server kode baru, tiga jalur auth (OAuth ChatGPT, OAuth Claude, token statis), hasil tool == endpoint, tidak ada baris berubah. Tool baca-saja, jadi tanpa skenario tulis. DB dihapus di akhir.
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji MCP laporan Meta Ads terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "import { createRequire } from \"node:module\";\nimport { pathToFileURL } from \"node:url\";\nimport path from \"node:path\";\nconst require = createRequire(process.cwd() + \"/\");\nconst jwt = require(\"jsonwebtoken\");\nconst { PrismaClient } = require(\"@prisma/client\");\nconst prisma = new PrismaClient();\nconst BASE = process.env.SMOKE_BASE ?? \"http://127.0.0.1:4000\"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)\nconst APP = process.env.APP_DIR ?? \"/app\";\nconst imp = (p) => import(pathToFileURL(path.join(APP, p)).href);\nlet fail = 0; let dilewati = 0;\nconst rec = (n, ok, d = \"\") => { if (!ok) fail++; console.log(`  ${ok ? \"PASS\" : \"FAIL\"}  ${n}${d ? \" — \" + String(d).slice(0, 260) : \"\"}`); };\nconst skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };\n// SMOKE BACA-SAJA terhadap server hidup lewat JALUR AUTH YANG SEBENARNYA (HTTP /mcp, /mcp-chatgpt, /api/atribusi/iklan). Token dibuat di dalam proses ini dari rahasia lingkungan\n// kontainer (tidak pernah dicetak/disimpan). Tidak ada tulisan: semua tool read-only; jumlah baris tabel kunci dan sidik referensi harus identik sebelum vs sesudah.\n// BEDA dengan discovery konektor: smoke ini membuktikan kode server + auth + hasil, BUKAN bahwa klien (claude.ai / ChatGPT) sudah menyegarkan daftar tool-nya — itu langkah pasca-rilis manual.\nconst { oauthConfigured, signAccessToken, publicUrl } = await imp(\"src/mcp/oauthCrypto.js\");\nconst rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);\nconst jwtUser = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: \"10m\" });\nconst hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);\nconst B = (k) => Number(process.env[k]);\nconst users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: \"asc\" } });\nlet admin = null, biasa = null;\nfor (const u of users) { const rs = await rolesDari(u); if (!admin && rs.has(\"ADMIN\")) admin = u; if (!biasa && !rs.has(\"ADMIN\")) biasa = u; }\nif (!admin) { rec(\"akun ADMIN aktif tersedia\", false); process.exit(1); }\n\nconst TABEL = { customer: 'select count(*)::int n from \"Customer\"', order: 'select count(*)::int n from \"Order\"', pembayaran: \"select count(*)::int n from payments\", touch: \"select count(*)::int n from attribution_touches\", spend: \"select count(*)::int n from meta_ad_daily_spend\",\n  impor: \"select count(*)::int n from meta_spend_imports\", referensi: \"select count(*)::int n from meta_ad_references\", biayaSumber: \"select count(*)::int n from ad_source_spend_entries\", jurnal: \"select count(*)::int n from fin_journal_entries\" };\nconst jejak = async () => { const o = {}; for (const [k, q] of Object.entries(TABEL)) o[k] = await hitung(q); o.sidikReferensi = String((await prisma.$queryRawUnsafe(\"select coalesce(md5(string_agg(r::text, '|' order by r.ad_id)), '-') as n from meta_ad_references r\"))[0].n); return o; };\nconst j0 = await jejak();\n\nlet rid = 0;\nconst rpc = async (jalur, token, method, params = {}) => {\n  const r = await fetch(BASE + jalur, { method: \"POST\", headers: { \"Content-Type\": \"application/json\", Accept: \"application/json, text/event-stream\", ...(token ? { Authorization: \"Bearer \" + token } : {}) }, body: JSON.stringify({ jsonrpc: \"2.0\", id: ++rid, method, params }) });\n  const t = await r.text(); const baris = t.split(\"\\n\").find((l) => l.startsWith(\"data:\")) ?? t; let json = null; try { json = JSON.parse(baris.replace(/^data:\\s*/, \"\")); } catch { /* bukan JSON */ }\n  return { status: r.status, json };\n};\nconst panggil = async (jalur, token, name, args = {}) => { const r = await rpc(jalur, token, \"tools/call\", { name, arguments: args }); const h = r.json?.result; let data = null; try { data = JSON.parse(h?.content?.[0]?.text ?? \"null\"); } catch { /* bukan JSON */ } return { status: r.status, isError: !!h?.isError, data }; };\nconst endpoint = async (p, token) => { const r = await fetch(BASE + \"/api/atribusi/iklan\" + p, { headers: { Authorization: \"Bearer \" + token } }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };\n\n// ── jalur auth yang tersedia (bukti jalur yang SEBENARNYA dipakai konektor) ──────────────────────────────────────────────────────────────────────\nconst JALUR = [];   // { nama, jalur, token, awalan }\nif (oauthConfigured()) {\n  JALUR.push({ nama: \"ChatGPT (OAuth ADMIN, audience /mcp-chatgpt)\", jalur: \"/mcp-chatgpt\", token: signAccessToken({ userId: admin.id, clientId: \"smoke-baca-saja\", resource: `${publicUrl()}/mcp-chatgpt` }), awalan: \"sales_\" });\n  JALUR.push({ nama: \"Claude (OAuth ADMIN, audience /mcp)\", jalur: \"/mcp\", token: signAccessToken({ userId: admin.id, clientId: \"smoke-baca-saja\", resource: `${publicUrl()}/mcp` }), awalan: \"\" });\n} else skip(\"jalur OAuth (ChatGPT dan claude.ai)\", \"MCP_OAUTH_JWT_SECRET tidak terisi di lingkungan ini\");\nconst statik = (process.env.MCP_API_TOKEN ?? \"\").trim();\nif (statik) JALUR.push({ nama: \"Claude Code/Desktop (token statis)\", jalur: \"/mcp\", token: statik, awalan: \"\" }); else skip(\"jalur token statis /mcp\", \"MCP_API_TOKEN tidak terisi di lingkungan ini\");\nrec(\"minimal satu jalur auth konektor yang sebenarnya dapat diuji\", JALUR.length >= 1, JALUR.map((j) => j.nama).join(\" | \"));\n\nconst BARU = [\"performa_campaign_meta\", \"rekap_harian_meta\", \"kesehatan_atribusi_meta\"];\nconst SEMBILAN = [\"sales_daftar_produk\", \"sales_kesehatan_atribusi_meta\", \"sales_performa_campaign_meta\", \"sales_performa_iklan\", \"sales_rekap_harian_meta\", \"sales_ringkasan_penjualan\", \"sales_ringkasan_pipeline\", \"sales_ringkasan_sumber_lead\", \"sales_tren_traffic_lead\"];\n\n// ── 1. penolakan auth ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────\nfor (const jl of [\"/mcp\", \"/mcp-chatgpt\"]) {\n  rec(`${jl}: tanpa token = 401`, (await rpc(jl, null, \"tools/list\")).status === 401);\n  rec(`${jl}: token ngawur = 401`, (await rpc(jl, \"token-ngawur-smoke\", \"tools/list\")).status === 401);\n  rec(`${jl}: JWT sesi pengguna (bukan token MCP) = 401`, (await rpc(jl, await jwtUser(admin), \"tools/list\")).status === 401);\n}\nif (oauthConfigured()) {\n  const tokChatKePlain = signAccessToken({ userId: admin.id, clientId: \"smoke-baca-saja\", resource: `${publicUrl()}/mcp` });\n  rec(\"token OAuth audience /mcp ditolak di /mcp-chatgpt (tidak bisa dipakai lintas resource)\", (await rpc(\"/mcp-chatgpt\", tokChatKePlain, \"tools/list\")).status === 401);\n  if (biasa) rec(\"token OAuth akun NON-ADMIN ditolak di /mcp-chatgpt (403)\", (await rpc(\"/mcp-chatgpt\", signAccessToken({ userId: biasa.id, clientId: \"smoke-baca-saja\", resource: `${publicUrl()}/mcp-chatgpt` }), \"tools/list\")).status === 403);\n  else skip(\"akun non-ADMIN ditolak di /mcp-chatgpt\", \"tidak ada akun non-ADMIN aktif\");\n}\n\n// ── 1b. akses /gpt-actions dan penjaga ADMIN tiga tool laporan (diizinkan vs ditolak, jalur auth sebenarnya) ───────────────────────\nconst TIGA = [\"performa_campaign_meta\", \"rekap_harian_meta\", \"kesehatan_atribusi_meta\"];\nconst gpt = async (token, name, body = { dari: \"2026-10-01\", sampai: \"2026-10-02\" }) => { const r = await fetch(BASE + \"/gpt-actions/tools/\" + name, { method: \"POST\", headers: { \"Content-Type\": \"application/json\", ...(token ? { Authorization: \"Bearer \" + token } : {}) }, body: JSON.stringify(body) }); const t = await r.text(); return { status: r.status, teks: t }; };\nrec(\"/gpt-actions: tanpa token = 401\", (await gpt(null, TIGA[0])).status === 401);\nrec(\"/gpt-actions: token ngawur = 401\", (await gpt(\"token-ngawur-smoke\", TIGA[0])).status === 401);\nrec(\"/gpt-actions: JWT sesi pengguna (bukan token MCP) = 401\", (await gpt(await jwtUser(admin), TIGA[0])).status === 401);\nconst stat0 = (process.env.MCP_API_TOKEN ?? \"\").trim();\nif (stat0) { for (const t of TIGA) rec(`/gpt-actions: token statis memanggil ${t} (200, tanpa data pribadi)`, await (async () => { const r = await gpt(stat0, t); return r.status === 200 && !/ctwaClid|customerId|phone|email/i.test(r.teks); })()); }\nelse skip(\"/gpt-actions dengan token statis\", \"MCP_API_TOKEN tidak terisi di lingkungan ini\");\nif (oauthConfigured()) {\n  const aud = (u, p) => signAccessToken({ userId: u.id, clientId: \"smoke-baca-saja\", resource: `${publicUrl()}${p}` });\n  rec(\"/gpt-actions: token OAuth audience /mcp-chatgpt ditolak (401)\", (await gpt(aud(admin, \"/mcp-chatgpt\"), TIGA[0])).status === 401);\n  for (const t of TIGA) rec(`/gpt-actions: OAuth ADMIN aktif memanggil ${t} (200)`, (await gpt(aud(admin, \"/mcp\"), t)).status === 200);\n  if (biasa) {\n    for (const t of TIGA) {\n      rec(`/gpt-actions: OAuth akun NON-ADMIN ditolak untuk ${t} (403)`, (await gpt(aud(biasa, \"/mcp\"), t)).status === 403);\n      rec(`/mcp: OAuth akun NON-ADMIN ditolak untuk ${t} (403)`, (await rpc(\"/mcp\", aud(biasa, \"/mcp\"), \"tools/call\", { name: t, arguments: {} })).status === 403);\n    }\n  } else skip(\"akun non-ADMIN ditolak untuk tiga tool di /mcp dan /gpt-actions\", \"tidak ada akun non-ADMIN aktif\");\n}\n\n// ── 2. discovery: tools/list lewat jalur auth sebenarnya ───────────────────────────────────────────────────────────────────────────────────────────\nfor (const jl of JALUR) {\n  const init = await rpc(jl.jalur, jl.token, \"initialize\", { protocolVersion: \"2025-06-18\", capabilities: {}, clientInfo: { name: \"smoke-baca-saja\", version: \"1\" } });\n  rec(`[${jl.nama}] initialize 200, versi server 1.1.0`, init.status === 200 && init.json?.result?.serverInfo?.version === \"1.1.0\", `${init.status} ${init.json?.result?.serverInfo?.name}@${init.json?.result?.serverInfo?.version}`);\n  const ls = await rpc(jl.jalur, jl.token, \"tools/list\");\n  const tools = ls.json?.result?.tools ?? []; const nama = tools.map((t) => t.name);\n  rec(`[${jl.nama}] tools/list memuat tiga tool baru${jl.awalan ? \" (awalan sales_)\" : \"\"}`, ls.status === 200 && BARU.every((b) => nama.includes(jl.awalan + b)), nama.filter((x) => /meta/.test(x)).join(\",\"));\n  rec(`[${jl.nama}] semua tool read-only dan tanpa 'unmask' di schema ChatGPT`, tools.length > 0 && tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false) && (jl.awalan ? tools.every((t) => !(\"unmask\" in (t.inputSchema?.properties ?? {}))) : true));\n  rec(`[${jl.nama}] tool lama performa_iklan tetap ada dan parameternya tidak berubah`, (() => { const lama = tools.find((t) => t.name === jl.awalan + \"performa_iklan\"); return !!lama && JSON.stringify(Object.keys(lama.inputSchema.properties).sort()) === JSON.stringify(jl.awalan ? [\"dari\", \"hanyaDikonfirmasi\", \"sampai\"] : [\"dari\", \"hanyaDikonfirmasi\", \"sampai\"]); })());\n  if (jl.awalan) rec(`[${jl.nama}] tepat sembilan tool aktif (allowlist ChatGPT)`, JSON.stringify([...nama].sort()) === JSON.stringify(SEMBILAN), nama.length);\n}\n\n// ── 3. hasil tool = endpoint pada snapshot yang sama (periode tertutup 7 hari, berakhir 3 hari lalu) ───────────────────────────────────────────────────\nconst hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);\nconst geser = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);\nconst P = { dari: process.env.SMOKE_DARI ?? geser(hariIni, -9), sampai: process.env.SMOKE_SAMPAI ?? geser(hariIni, -3) };   // SMOKE_DARI/SAMPAI hanya untuk uji lokal pada data fixture\nconst tA = await jwtUser(admin);\nconst kolomTool = (b) => [b.status, b.akuisisi.leadTerbukti, b.akuisisi.spam, b.order.customerBerOrder, b.order.jumlahOrderEligible, b.order.nilaiOrder, b.order.customerPernahMembayar, b.order.customerLunasTerbuktiLedger, b.uang.uangLedgerBersih, b.biaya.spend, b.biaya.cpaLunas];\nconst kolomEp = (g) => [g.status, g.lead.unik, g.lead.spam, g.customerDenganOrder, g.orderEligible, g.bookedValue, g.customerPernahMembayar, g.closingUtama.customerLunasTerbuktiLedger, g.uangBersihLedger, g.biaya.spend, g.biaya.cpa];\nasync function bandingkan(jl, level) {\n  const ep = await endpoint(`/?dari=${P.dari}&sampai=${P.sampai}&level=${level}`, tA);\n  const tl = await panggil(jl.jalur, jl.token, jl.awalan + \"performa_campaign_meta\", { ...P, level, batas: 100 });\n  if (ep.status !== 200 || tl.status !== 200 || tl.isError) return { ok: false, d: `endpoint ${ep.status} tool ${tl.status}${tl.isError ? \" isError\" : \"\"}` };\n  const semua = [...tl.data.baris, ...tl.data.tidakTerpetakan, ...(tl.data.unknown ? [tl.data.unknown] : [])];\n  const t = ep.json.jumlahTeratribusi;\n  const selisih = [];\n  if (semua.length !== ep.json.grup.length) selisih.push(`baris ${semua.length}≠${ep.json.grup.length}`);\n  for (const g of ep.json.grup) { const b = semua.find((x) => x.kunci === g.kunci); if (!b) { selisih.push(`hilang ${g.kunci}`); continue; } if (JSON.stringify(kolomTool(b)) !== JSON.stringify(kolomEp(g))) selisih.push(`beda ${g.kunci}`); }\n  const tt = [tl.data.total.akuisisi.leadTerbukti, tl.data.total.order.customerBerOrder, tl.data.total.order.customerPernahMembayar, tl.data.total.order.customerLunasTerbuktiLedger, tl.data.total.order.nilaiOrder, tl.data.total.uang.uangLedgerBersih];\n  const te = [t.leadUnik, t.customerDenganOrder, t.customerPernahMembayar, t.closingUtama.customerLunasTerbuktiLedger, t.bookedValue, t.uangBersihLedger];\n  if (JSON.stringify(tt) !== JSON.stringify(te)) selisih.push(`total ${tt}≠${te}`);\n  return { ok: selisih.length === 0 && tl.data.rekonsiliasi.ok === true && ep.json.rekonsiliasi.ok === true, d: `${semua.length} baris; ${selisih.join(\"; \") || \"identik\"}` };\n}\nfor (const jl of JALUR) {\n  for (const level of [\"campaign\", \"adset\", \"ad\"]) {\n    let hasil = null;\n    for (let i = 0; i < 3; i++) { hasil = await bandingkan(jl, level); if (hasil.ok) break; await new Promise((r) => setTimeout(r, 3000)); }   // data produksi hidup: ulangi bila ada tulisan sah di antara dua pembacaan\n    rec(`[${jl.nama}] ${level} ${P.dari}..${P.sampai}: hasil tool == endpoint (kolom per baris + total) dan rekonsiliasi lolos`, hasil.ok, hasil.d);\n  }\n}\nconst jl0 = JALUR[0];\nif (jl0) {\n  const rk = await panggil(jl0.jalur, jl0.token, jl0.awalan + \"rekap_harian_meta\", { dari: geser(P.sampai, -2), sampai: P.sampai });\n  rec(\"rekap_harian_meta: 3 hari penuh, Σ harian = akumulasi (pemeriksaan aditif tidak ada yang gagal), tampilan kohort\", !rk.isError && rk.data?.harian?.length === 3 && rk.data.pemeriksaanAditif.cek.every((c) => c.ok !== false) && rk.data.tampilan === \"KOHORT_AKUISISI\", rk.isError ? JSON.stringify(rk.data).slice(0, 160) : \"\");\n  const ks = await panggil(jl0.jalur, jl0.token, jl0.awalan + \"kesehatan_atribusi_meta\", { ...P, periksaLintasLevel: true });\n  rec(\"kesehatan_atribusi_meta: campaign = Σ ad set = Σ ad lolos; capture terbaca; tanpa data customer\", !ks.isError && ks.data?.rekonsiliasiLintasLevel?.ok === true && typeof ks.data.capture?.captureAktif === \"boolean\", ks.isError ? JSON.stringify(ks.data).slice(0, 160) : `${ks.data?.rekonsiliasiLintasLevel?.jumlahCek} pemeriksaan`);\n  const lama = await panggil(jl0.jalur, jl0.token, jl0.awalan + \"performa_iklan\", { dari: P.dari, sampai: P.sampai });\n  rec(\"tool lama performa_iklan masih berfungsi dengan bentuk lama\", !lama.isError && [\"periode\", \"totalLead\", \"perSumberLead\", \"perKreatifIklanMeta\", \"cakupanCtwa\", \"catatan\"].every((k) => k in (lama.data ?? {})));\n  const salah = await panggil(jl0.jalur, jl0.token, jl0.awalan + \"performa_campaign_meta\", { dari: P.dari });\n  rec(\"parameter salah → isError dengan kode PARAMETER_TIDAK_VALID (bukan crash)\", salah.isError === true && salah.data?.kode === \"PARAMETER_TIDAK_VALID\");\n  const teks = JSON.stringify([rk.data, ks.data]);\n  const ids = [...(await prisma.$queryRawUnsafe('select id::text id from \"Customer\" order by random() limit 40')).map((r) => r.id), ...(await prisma.$queryRawUnsafe('select phone p from \"Customer\" where phone is not null order by random() limit 40')).map((r) => r.p)];\n  rec(\"respons tidak memuat ID/nomor customer (40+40 sampel acak)\", ids.every((x) => !teks.includes(String(x))));\n}\n\n// ── 4. READ-ONLY: tidak ada baris berubah ─────────────────────────────────────────────────────────────────────────────────────────────────────────\nconst j1 = await jejak();\n// Produksi HIDUP: tabel lalu lintas (WhatsApp masuk, order, pembayaran) boleh bertambah selama smoke → hanya tidak boleh BERKURANG. Tabel yang bisa ditulis tool laporan yang salah\n// (spend, impor spend, referensi Ad, biaya sumber) harus IDENTIK (jumlah + sidik referensi); perubahan di sini hanya mungkin karena aksi Admin yang bersamaan (diulang sekali sebelum gagal).\nconst MONOTON = [\"customer\", \"order\", \"pembayaran\", \"touch\", \"jurnal\"]; const STRIK = [\"spend\", \"impor\", \"referensi\", \"biayaSumber\", \"sidikReferensi\"];\nlet turun = MONOTON.filter((k) => j1[k] < j0[k]); let beda = STRIK.filter((k) => j0[k] !== j1[k]);\nif (beda.length) { await new Promise((r) => setTimeout(r, 4000)); const j2 = await jejak(); beda = STRIK.filter((k) => j0[k] !== j2[k]); Object.assign(j1, j2); }\nrec(\"TIDAK ada jejak tulis: spend, impor spend, referensi Ad, biaya sumber, dan sidik referensi IDENTIK sebelum vs sesudah smoke; Customer/Order/pembayaran/touch/jurnal tidak berkurang (lalu lintas sah boleh bertambah)\", beda.length === 0 && turun.length === 0, [...beda.map((k) => `${k}:${j0[k]}→${j1[k]}`), ...turun.map((k) => `turun ${k}`)].join(\",\") || \"identik/monoton\");\nrec(\"jurnal tidak seimbang (sebelum rilis: \" + B(\"BASE_TIDAK_SEIMBANG\") + \", tidak bertambah)\", (await hitung(\"select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x\")) <= B(\"BASE_TIDAK_SEIMBANG\"));\nrec(\"jumlah Order & Job tidak berkurang (sebelum: \" + B(\"ORDER_N\") + \" / \" + B(\"JOB_N\") + \")\", (await hitung('select count(*)::int n from \"Order\"')) >= B(\"ORDER_N\") && (await hitung(\"select count(*)::int n from jobs\")) >= B(\"JOB_N\"));\nawait prisma.$disconnect();\nconsole.log(\"\\nRINGKASAN smoke: \" + fail + \" gagal, \" + dilewati + \" dilewati (SKIP)\");\nconsole.log(\"SMOKE_HASIL fail=\" + fail + \" skip=\" + dilewati);\nprocess.exit(fail ? 1 : 0);\n"; // diganti generator dengan isi smoke-mcp-laporan-meta.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji MCP laporan Meta Ads hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "MCP laporan Meta Ads": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Tool bersifat BACA-SAJA, jadi tidak ada skenario tulis; yang dibuktikan di sini: server hidup, tiga tool terlihat lewat TIGA jalur auth (OAuth ChatGPT, OAuth Claude, token statis) dengan
// rahasia khusus rehearsal, hasil tool == endpoint pada data produksi nyata (salinan), dan tidak ada satu baris pun berubah.
// INI UJI HANDLER/SERVER LOKAL. Discovery oleh klien konektor (claude.ai / ChatGPT) BARU bisa dibuktikan setelah rilis, lewat langkah refresh manual — lihat instruksi rilis.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4101); const BASE = `http://127.0.0.1:${PORT}`;
const REH_ENV = { MCP_API_TOKEN: "rehearsal-token-statis-0123456789", MCP_OAUTH_JWT_SECRET: "rehearsal-rahasia-oauth-0123456789abcdef", MCP_PUBLIC_URL: BASE };
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, ...REH_ENV, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const TABEL = ["Customer", "Order", "payments", "attribution_touches", "meta_ad_daily_spend", "meta_spend_imports", "meta_ad_references", "ad_source_spend_entries", "fin_journal_entries", "fin_journal_lines", "stock_movements", "units"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const fp0 = await fp();
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...REH_ENV, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_GANDA: "0", ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP)/.test(l)).join("\n"));
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE (kode yang sama dengan fase 8b) lulus terhadap server rehearsal lewat jalur OAuth ChatGPT, OAuth Claude, dan token statis: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
cek("tiga jalur auth benar-benar diuji di rehearsal (tidak ada yang dilewati)", /skip=0$/.test(smokeLine), smokeLine);
const fp1 = await fp(); const bedaTabel = TABEL.filter((t) => fp0[t].n !== fp1[t].n || fp0[t].h !== fp1[t].h);
cek(`isi ${TABEL.length} tabel kunci IDENTIK (jumlah baris + sidik isi) sebelum vs sesudah seluruh uji`, bedaTabel.length === 0, bedaTabel.join(","));
cek("log server tanpa galat tak tertangani selama uji", !/UnhandledPromiseRejection|Cannot find module|ERR_MODULE_NOT_FOUND/.test(log), log.slice(-200));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
# direktori sementara dibuat root oleh kontainer: dihapus lewat kontainer (rm biasa ditolak); kegagalan pembersihan tidak menggagalkan rilis
dcp "$NEW_DIR" run --rm --no-deps -T -v "$BK_DIR:/bk" backend sh -c 'rm -rf /bk/reh-data /bk/reh-uploads /bk/reh-dd' </dev/null >/dev/null 2>&1 || true
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; uji server/auth/tool dilakukan HANYA pada salinan restore lalu DB sementara dihapus"
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
gerbang_kode_live "fase-6-pra-switch"
COUNT_SQL="select 'customers', count(*) from \"Customer\" union all select 'orders', count(*) from \"Order\" union all select 'payments', count(*) from payments union all select 'touches', count(*) from attribution_touches union all select 'references', count(*) from meta_ad_references union all select 'spend_rows', count(*) from meta_ad_daily_spend union all select 'spend_imports', count(*) from meta_spend_imports union all select 'journal_entries', count(*) from fin_journal_entries"
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pra-switch.txt" || die "hitung baris pra-switch gagal"; ok "pra-switch: hitung baris customer/order/pembayaran/touch/referensi/spend/jurnal dicatat"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan di produksi; JANGAN switch"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi (image baru) TIDAK 'up to date' — rilis ini harus tanpa migrasi"
ok "tidak ada migrasi pending; skema produksi sudah sesuai image baru"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-switch.txt" || die "sidik jari dokumen beku pra-switch gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-switch.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-switch.txt" || true; die "dokumen pembanding beku BERUBAH sebelum switch"; }
ok "pra-switch: dokumen pembanding beku identik"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
tidak_ada_deploy_lain_lagi
gerbang_kode_live "fase-7-tepat-sebelum-switch"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"
# hotfix performa HARUS tetap ada: di container baru, di folder release baru, dan byte-identik dengan snapshot baseline untuk berkas yang tidak diubah kandidat
docker exec "$CID_NEW" test -f /app/src/middleware/cacheSingkat.js || die "hotfix HILANG: cacheSingkat.js tidak ada di container baru"
docker exec "$CID_NEW" sh -c 'grep -q "JOIN LATERAL" /app/src/routes/conversations.js && grep -q "JOIN LATERAL" /app/src/routes/analytics.js && grep -q "cacheSingkat(30_000)" /app/src/routes/analytics.js' || die "hotfix HILANG: query LATERAL / cacheSingkat tidak ada di container baru"
grep -q useOptionalTabs "$NEW_DIR/frontend/src/pages/Laporan.jsx" || die "hotfix HILANG: Laporan.jsx baru tanpa perbaikan tab"
for hf in backend/src/routes/analytics.js backend/src/routes/conversations.js backend/src/middleware/cacheSingkat.js frontend/src/pages/Laporan.jsx; do
  [ "$(git hash-object --no-filters "$NEW_DIR/$hf")" = "$(sg rev-parse "${BASE_SHA}:${hf}")" ] || die "hotfix berubah/hilang: ${hf} di release baru != snapshot baseline"
done
ok "hotfix performa tetap ada (4 berkas == snapshot baseline; container baru memuat LATERAL + cacheSingkat)"
# performa memadai: health beberapa kali + query LATERAL baca-saja pada produksi
PERF_H="$(for i in 1 2 3 4 5; do curl -fsS -o /dev/null -w '%{time_total}\n' --max-time 10 "${INTERNAL_URL}/api/health"; done | tr '\n' ' ')"
LAT_SQL='SELECT COUNT(*) FROM "Conversation" c JOIN LATERAL (SELECT direction FROM "Message" WHERE "conversationId" = c.id ORDER BY "createdAt" DESC LIMIT 1) m ON TRUE WHERE m.direction = '"'"'INBOUND'"'"
T0=$(date +%s%N); psql_live -At -c "$LAT_SQL" >/dev/null || die "query LATERAL baca-saja gagal"; T1=$(date +%s%N)
LAT_MS=$(( (T1 - T0) / 1000000 )); [ "$LAT_MS" -lt 15000 ] || die "query LATERAL lambat (${LAT_MS} ms)"
ok "performa: health(detik)=${PERF_H}; query 'belum dibalas' (LATERAL, baca-saja) ${LAT_MS} ms"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik berubah (harus tetap ${NEW_INDEX})"; ok "bundel web publik tetap ${NEW_INDEX} (frontend tidak berubah)"
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
# hitung baris pasca-switch vs pra-switch (informasi: pengguna sungguhan bisa menulis selama jendela rilis; skrip ini sendiri tidak menulis apa pun)
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pasca-switch.txt" || die "hitung baris pasca-switch gagal"
if diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" >/dev/null; then ok "hitung baris customer/order/pembayaran/touch/referensi/spend/jurnal IDENTIK sebelum vs sesudah switch"; else warn "hitung baris berbeda sebelum vs sesudah switch (kemungkinan aktivitas pengguna sungguhan selama jendela rilis; skrip tidak menulis):"; diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" | sed 's/^/        /' || true; fi
PHASE="8b-smoke"; say "8b. Smoke test baca-saja lewat jalur auth yang sebenarnya (OAuth ChatGPT, OAuth Claude, token statis bila ada): tools/list memuat tiga tool, hasil tool == endpoint, tool lama kompatibel, tanpa jejak tulis"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap server hidup lewat JALUR AUTH YANG SEBENARNYA (HTTP /mcp, /mcp-chatgpt, /api/atribusi/iklan). Token dibuat di dalam proses ini dari rahasia lingkungan
// kontainer (tidak pernah dicetak/disimpan). Tidak ada tulisan: semua tool read-only; jumlah baris tabel kunci dan sidik referensi harus identik sebelum vs sesudah.
// BEDA dengan discovery konektor: smoke ini membuktikan kode server + auth + hasil, BUKAN bahwa klien (claude.ai / ChatGPT) sudah menyegarkan daftar tool-nya — itu langkah pasca-rilis manual.
const { oauthConfigured, signAccessToken, publicUrl } = await imp("src/mcp/oauthCrypto.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const jwtUser = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } });
let admin = null, biasa = null;
for (const u of users) { const rs = await rolesDari(u); if (!admin && rs.has("ADMIN")) admin = u; if (!biasa && !rs.has("ADMIN")) biasa = u; }
if (!admin) { rec("akun ADMIN aktif tersedia", false); process.exit(1); }

const TABEL = { customer: 'select count(*)::int n from "Customer"', order: 'select count(*)::int n from "Order"', pembayaran: "select count(*)::int n from payments", touch: "select count(*)::int n from attribution_touches", spend: "select count(*)::int n from meta_ad_daily_spend",
  impor: "select count(*)::int n from meta_spend_imports", referensi: "select count(*)::int n from meta_ad_references", biayaSumber: "select count(*)::int n from ad_source_spend_entries", jurnal: "select count(*)::int n from fin_journal_entries" };
const jejak = async () => { const o = {}; for (const [k, q] of Object.entries(TABEL)) o[k] = await hitung(q); o.sidikReferensi = String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(r::text, '|' order by r.ad_id)), '-') as n from meta_ad_references r"))[0].n); return o; };
const j0 = await jejak();

let rid = 0;
const rpc = async (jalur, token, method, params = {}) => {
  const r = await fetch(BASE + jalur, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }) });
  const t = await r.text(); const baris = t.split("\n").find((l) => l.startsWith("data:")) ?? t; let json = null; try { json = JSON.parse(baris.replace(/^data:\s*/, "")); } catch { /* bukan JSON */ }
  return { status: r.status, json };
};
const panggil = async (jalur, token, name, args = {}) => { const r = await rpc(jalur, token, "tools/call", { name, arguments: args }); const h = r.json?.result; let data = null; try { data = JSON.parse(h?.content?.[0]?.text ?? "null"); } catch { /* bukan JSON */ } return { status: r.status, isError: !!h?.isError, data }; };
const endpoint = async (p, token) => { const r = await fetch(BASE + "/api/atribusi/iklan" + p, { headers: { Authorization: "Bearer " + token } }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };

// ── jalur auth yang tersedia (bukti jalur yang SEBENARNYA dipakai konektor) ──────────────────────────────────────────────────────────────────────
const JALUR = [];   // { nama, jalur, token, awalan }
if (oauthConfigured()) {
  JALUR.push({ nama: "ChatGPT (OAuth ADMIN, audience /mcp-chatgpt)", jalur: "/mcp-chatgpt", token: signAccessToken({ userId: admin.id, clientId: "smoke-baca-saja", resource: `${publicUrl()}/mcp-chatgpt` }), awalan: "sales_" });
  JALUR.push({ nama: "Claude (OAuth ADMIN, audience /mcp)", jalur: "/mcp", token: signAccessToken({ userId: admin.id, clientId: "smoke-baca-saja", resource: `${publicUrl()}/mcp` }), awalan: "" });
} else skip("jalur OAuth (ChatGPT dan claude.ai)", "MCP_OAUTH_JWT_SECRET tidak terisi di lingkungan ini");
const statik = (process.env.MCP_API_TOKEN ?? "").trim();
if (statik) JALUR.push({ nama: "Claude Code/Desktop (token statis)", jalur: "/mcp", token: statik, awalan: "" }); else skip("jalur token statis /mcp", "MCP_API_TOKEN tidak terisi di lingkungan ini");
rec("minimal satu jalur auth konektor yang sebenarnya dapat diuji", JALUR.length >= 1, JALUR.map((j) => j.nama).join(" | "));

const BARU = ["performa_campaign_meta", "rekap_harian_meta", "kesehatan_atribusi_meta"];
const SEMBILAN = ["sales_daftar_produk", "sales_kesehatan_atribusi_meta", "sales_performa_campaign_meta", "sales_performa_iklan", "sales_rekap_harian_meta", "sales_ringkasan_penjualan", "sales_ringkasan_pipeline", "sales_ringkasan_sumber_lead", "sales_tren_traffic_lead"];

// ── 1. penolakan auth ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const jl of ["/mcp", "/mcp-chatgpt"]) {
  rec(`${jl}: tanpa token = 401`, (await rpc(jl, null, "tools/list")).status === 401);
  rec(`${jl}: token ngawur = 401`, (await rpc(jl, "token-ngawur-smoke", "tools/list")).status === 401);
  rec(`${jl}: JWT sesi pengguna (bukan token MCP) = 401`, (await rpc(jl, await jwtUser(admin), "tools/list")).status === 401);
}
if (oauthConfigured()) {
  const tokChatKePlain = signAccessToken({ userId: admin.id, clientId: "smoke-baca-saja", resource: `${publicUrl()}/mcp` });
  rec("token OAuth audience /mcp ditolak di /mcp-chatgpt (tidak bisa dipakai lintas resource)", (await rpc("/mcp-chatgpt", tokChatKePlain, "tools/list")).status === 401);
  if (biasa) rec("token OAuth akun NON-ADMIN ditolak di /mcp-chatgpt (403)", (await rpc("/mcp-chatgpt", signAccessToken({ userId: biasa.id, clientId: "smoke-baca-saja", resource: `${publicUrl()}/mcp-chatgpt` }), "tools/list")).status === 403);
  else skip("akun non-ADMIN ditolak di /mcp-chatgpt", "tidak ada akun non-ADMIN aktif");
}

// ── 1b. akses /gpt-actions dan penjaga ADMIN tiga tool laporan (diizinkan vs ditolak, jalur auth sebenarnya) ───────────────────────
const TIGA = ["performa_campaign_meta", "rekap_harian_meta", "kesehatan_atribusi_meta"];
const gpt = async (token, name, body = { dari: "2026-10-01", sampai: "2026-10-02" }) => { const r = await fetch(BASE + "/gpt-actions/tools/" + name, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); const t = await r.text(); return { status: r.status, teks: t }; };
rec("/gpt-actions: tanpa token = 401", (await gpt(null, TIGA[0])).status === 401);
rec("/gpt-actions: token ngawur = 401", (await gpt("token-ngawur-smoke", TIGA[0])).status === 401);
rec("/gpt-actions: JWT sesi pengguna (bukan token MCP) = 401", (await gpt(await jwtUser(admin), TIGA[0])).status === 401);
const stat0 = (process.env.MCP_API_TOKEN ?? "").trim();
if (stat0) { for (const t of TIGA) rec(`/gpt-actions: token statis memanggil ${t} (200, tanpa data pribadi)`, await (async () => { const r = await gpt(stat0, t); return r.status === 200 && !/ctwaClid|customerId|phone|email/i.test(r.teks); })()); }
else skip("/gpt-actions dengan token statis", "MCP_API_TOKEN tidak terisi di lingkungan ini");
if (oauthConfigured()) {
  const aud = (u, p) => signAccessToken({ userId: u.id, clientId: "smoke-baca-saja", resource: `${publicUrl()}${p}` });
  rec("/gpt-actions: token OAuth audience /mcp-chatgpt ditolak (401)", (await gpt(aud(admin, "/mcp-chatgpt"), TIGA[0])).status === 401);
  for (const t of TIGA) rec(`/gpt-actions: OAuth ADMIN aktif memanggil ${t} (200)`, (await gpt(aud(admin, "/mcp"), t)).status === 200);
  if (biasa) {
    for (const t of TIGA) {
      rec(`/gpt-actions: OAuth akun NON-ADMIN ditolak untuk ${t} (403)`, (await gpt(aud(biasa, "/mcp"), t)).status === 403);
      rec(`/mcp: OAuth akun NON-ADMIN ditolak untuk ${t} (403)`, (await rpc("/mcp", aud(biasa, "/mcp"), "tools/call", { name: t, arguments: {} })).status === 403);
    }
  } else skip("akun non-ADMIN ditolak untuk tiga tool di /mcp dan /gpt-actions", "tidak ada akun non-ADMIN aktif");
}

// ── 2. discovery: tools/list lewat jalur auth sebenarnya ───────────────────────────────────────────────────────────────────────────────────────────
for (const jl of JALUR) {
  const init = await rpc(jl.jalur, jl.token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke-baca-saja", version: "1" } });
  rec(`[${jl.nama}] initialize 200, versi server 1.1.0`, init.status === 200 && init.json?.result?.serverInfo?.version === "1.1.0", `${init.status} ${init.json?.result?.serverInfo?.name}@${init.json?.result?.serverInfo?.version}`);
  const ls = await rpc(jl.jalur, jl.token, "tools/list");
  const tools = ls.json?.result?.tools ?? []; const nama = tools.map((t) => t.name);
  rec(`[${jl.nama}] tools/list memuat tiga tool baru${jl.awalan ? " (awalan sales_)" : ""}`, ls.status === 200 && BARU.every((b) => nama.includes(jl.awalan + b)), nama.filter((x) => /meta/.test(x)).join(","));
  rec(`[${jl.nama}] semua tool read-only dan tanpa 'unmask' di schema ChatGPT`, tools.length > 0 && tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false) && (jl.awalan ? tools.every((t) => !("unmask" in (t.inputSchema?.properties ?? {}))) : true));
  rec(`[${jl.nama}] tool lama performa_iklan tetap ada dan parameternya tidak berubah`, (() => { const lama = tools.find((t) => t.name === jl.awalan + "performa_iklan"); return !!lama && JSON.stringify(Object.keys(lama.inputSchema.properties).sort()) === JSON.stringify(jl.awalan ? ["dari", "hanyaDikonfirmasi", "sampai"] : ["dari", "hanyaDikonfirmasi", "sampai"]); })());
  if (jl.awalan) rec(`[${jl.nama}] tepat sembilan tool aktif (allowlist ChatGPT)`, JSON.stringify([...nama].sort()) === JSON.stringify(SEMBILAN), nama.length);
}

// ── 3. hasil tool = endpoint pada snapshot yang sama (periode tertutup 7 hari, berakhir 3 hari lalu) ───────────────────────────────────────────────────
const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const geser = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const P = { dari: process.env.SMOKE_DARI ?? geser(hariIni, -9), sampai: process.env.SMOKE_SAMPAI ?? geser(hariIni, -3) };   // SMOKE_DARI/SAMPAI hanya untuk uji lokal pada data fixture
const tA = await jwtUser(admin);
const kolomTool = (b) => [b.status, b.akuisisi.leadTerbukti, b.akuisisi.spam, b.order.customerBerOrder, b.order.jumlahOrderEligible, b.order.nilaiOrder, b.order.customerPernahMembayar, b.order.customerLunasTerbuktiLedger, b.uang.uangLedgerBersih, b.biaya.spend, b.biaya.cpaLunas];
const kolomEp = (g) => [g.status, g.lead.unik, g.lead.spam, g.customerDenganOrder, g.orderEligible, g.bookedValue, g.customerPernahMembayar, g.closingUtama.customerLunasTerbuktiLedger, g.uangBersihLedger, g.biaya.spend, g.biaya.cpa];
async function bandingkan(jl, level) {
  const ep = await endpoint(`/?dari=${P.dari}&sampai=${P.sampai}&level=${level}`, tA);
  const tl = await panggil(jl.jalur, jl.token, jl.awalan + "performa_campaign_meta", { ...P, level, batas: 100 });
  if (ep.status !== 200 || tl.status !== 200 || tl.isError) return { ok: false, d: `endpoint ${ep.status} tool ${tl.status}${tl.isError ? " isError" : ""}` };
  const semua = [...tl.data.baris, ...tl.data.tidakTerpetakan, ...(tl.data.unknown ? [tl.data.unknown] : [])];
  const t = ep.json.jumlahTeratribusi;
  const selisih = [];
  if (semua.length !== ep.json.grup.length) selisih.push(`baris ${semua.length}≠${ep.json.grup.length}`);
  for (const g of ep.json.grup) { const b = semua.find((x) => x.kunci === g.kunci); if (!b) { selisih.push(`hilang ${g.kunci}`); continue; } if (JSON.stringify(kolomTool(b)) !== JSON.stringify(kolomEp(g))) selisih.push(`beda ${g.kunci}`); }
  const tt = [tl.data.total.akuisisi.leadTerbukti, tl.data.total.order.customerBerOrder, tl.data.total.order.customerPernahMembayar, tl.data.total.order.customerLunasTerbuktiLedger, tl.data.total.order.nilaiOrder, tl.data.total.uang.uangLedgerBersih];
  const te = [t.leadUnik, t.customerDenganOrder, t.customerPernahMembayar, t.closingUtama.customerLunasTerbuktiLedger, t.bookedValue, t.uangBersihLedger];
  if (JSON.stringify(tt) !== JSON.stringify(te)) selisih.push(`total ${tt}≠${te}`);
  return { ok: selisih.length === 0 && tl.data.rekonsiliasi.ok === true && ep.json.rekonsiliasi.ok === true, d: `${semua.length} baris; ${selisih.join("; ") || "identik"}` };
}
for (const jl of JALUR) {
  for (const level of ["campaign", "adset", "ad"]) {
    let hasil = null;
    for (let i = 0; i < 3; i++) { hasil = await bandingkan(jl, level); if (hasil.ok) break; await new Promise((r) => setTimeout(r, 3000)); }   // data produksi hidup: ulangi bila ada tulisan sah di antara dua pembacaan
    rec(`[${jl.nama}] ${level} ${P.dari}..${P.sampai}: hasil tool == endpoint (kolom per baris + total) dan rekonsiliasi lolos`, hasil.ok, hasil.d);
  }
}
const jl0 = JALUR[0];
if (jl0) {
  const rk = await panggil(jl0.jalur, jl0.token, jl0.awalan + "rekap_harian_meta", { dari: geser(P.sampai, -2), sampai: P.sampai });
  rec("rekap_harian_meta: 3 hari penuh, Σ harian = akumulasi (pemeriksaan aditif tidak ada yang gagal), tampilan kohort", !rk.isError && rk.data?.harian?.length === 3 && rk.data.pemeriksaanAditif.cek.every((c) => c.ok !== false) && rk.data.tampilan === "KOHORT_AKUISISI", rk.isError ? JSON.stringify(rk.data).slice(0, 160) : "");
  const ks = await panggil(jl0.jalur, jl0.token, jl0.awalan + "kesehatan_atribusi_meta", { ...P, periksaLintasLevel: true });
  rec("kesehatan_atribusi_meta: campaign = Σ ad set = Σ ad lolos; capture terbaca; tanpa data customer", !ks.isError && ks.data?.rekonsiliasiLintasLevel?.ok === true && typeof ks.data.capture?.captureAktif === "boolean", ks.isError ? JSON.stringify(ks.data).slice(0, 160) : `${ks.data?.rekonsiliasiLintasLevel?.jumlahCek} pemeriksaan`);
  const lama = await panggil(jl0.jalur, jl0.token, jl0.awalan + "performa_iklan", { dari: P.dari, sampai: P.sampai });
  rec("tool lama performa_iklan masih berfungsi dengan bentuk lama", !lama.isError && ["periode", "totalLead", "perSumberLead", "perKreatifIklanMeta", "cakupanCtwa", "catatan"].every((k) => k in (lama.data ?? {})));
  const salah = await panggil(jl0.jalur, jl0.token, jl0.awalan + "performa_campaign_meta", { dari: P.dari });
  rec("parameter salah → isError dengan kode PARAMETER_TIDAK_VALID (bukan crash)", salah.isError === true && salah.data?.kode === "PARAMETER_TIDAK_VALID");
  const teks = JSON.stringify([rk.data, ks.data]);
  const ids = [...(await prisma.$queryRawUnsafe('select id::text id from "Customer" order by random() limit 40')).map((r) => r.id), ...(await prisma.$queryRawUnsafe('select phone p from "Customer" where phone is not null order by random() limit 40')).map((r) => r.p)];
  rec("respons tidak memuat ID/nomor customer (40+40 sampel acak)", ids.every((x) => !teks.includes(String(x))));
}

// ── 4. READ-ONLY: tidak ada baris berubah ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const j1 = await jejak();
// Produksi HIDUP: tabel lalu lintas (WhatsApp masuk, order, pembayaran) boleh bertambah selama smoke → hanya tidak boleh BERKURANG. Tabel yang bisa ditulis tool laporan yang salah
// (spend, impor spend, referensi Ad, biaya sumber) harus IDENTIK (jumlah + sidik referensi); perubahan di sini hanya mungkin karena aksi Admin yang bersamaan (diulang sekali sebelum gagal).
const MONOTON = ["customer", "order", "pembayaran", "touch", "jurnal"]; const STRIK = ["spend", "impor", "referensi", "biayaSumber", "sidikReferensi"];
let turun = MONOTON.filter((k) => j1[k] < j0[k]); let beda = STRIK.filter((k) => j0[k] !== j1[k]);
if (beda.length) { await new Promise((r) => setTimeout(r, 4000)); const j2 = await jejak(); beda = STRIK.filter((k) => j0[k] !== j2[k]); Object.assign(j1, j2); }
rec("TIDAK ada jejak tulis: spend, impor spend, referensi Ad, biaya sumber, dan sidik referensi IDENTIK sebelum vs sesudah smoke; Customer/Order/pembayaran/touch/jurnal tidak berkurang (lalu lintas sah boleh bertambah)", beda.length === 0 && turun.length === 0, [...beda.map((k) => `${k}:${j0[k]}→${j1[k]}`), ...turun.map((k) => `turun ${k}`)].join(",") || "identik/monoton");
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
  ok "smoke test lulus (auth nyata, tools/list, hasil tool == endpoint, tool lama, tanpa jejak tulis, invarian)"
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
PHASE="9-pembersihan"; say "9. Pembersihan release lama DINONAKTIFKAN (instruksi Owner: folder hotfix dan release lama TIDAK dihapus)"
ok "tidak ada folder release/image/backup/volume yang dihapus oleh skrip ini; disk: $(df -h "$HOME" | awk 'NR==2{print $4" bebas"}')"
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
say "CATATAN: Rilis ini membawa tiga tool MCP laporan Meta Ads (/mcp dan /mcp-chatgpt sebagai sales_*). TANPA migrasi, TANPA perubahan frontend/env, TANPA tulisan data. SESUDAH rilis (manual, belum terbukti oleh skrip ini): (1) claude.ai: Pengaturan > Konektor > SANSS CRM > putuskan lalu sambungkan ulang atau mulai percakapan baru; (2) ChatGPT: Developer Mode > app SANSS > Refresh (atau buat ulang koneksi), lalu minta Mesa memanggil sales_kesehatan_atribusi_meta; (3) bila Custom GPT Actions dipakai, ambil ulang /gpt-actions/openapi.json. Jangan klaim konektor terhubung sebelum satu panggilan nyata dari klien berhasil."
