#!/usr/bin/env bash

# RILIS FRONTEND-SAJA "tab Marketing" (Laporan) — TANPA backend, TANPA migrasi, TANPA schema, TANPA tulisan data, TANPA build image, TANPA perubahan campaign/budget/Meta.
# Isi: tab Laporan "Marketing" menggantikan Traffic + Akuisisi + Iklan (ringkasan semua sumber → detail sumber → Meta campaign → ad set → ad); URL lama ?tab=Traffic|Akuisisi|Iklan dialihkan ke Marketing
# dengan periode yang sama; label "Total lead (termasuk spam)" vs "Tren lead harian (tanpa spam)"; ekspor CSV/XLSX = layar (periode, basis, cutoff, null bukan nol); request basi dibuang; Back/Forward per tab shell.
# Dibangun dari SUMBER GIT YANG DAPAT DILACAK (git archive SHA kandidat) — tanpa overlay/salinan berkas.
# BASELINE = release aktif (BASE_SHA, argumen 2). backend/ harus IDENTIK dengan release aktif; image backend SAMA.
# Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED. Dist web dibangun di release dir baru; backend DI-RECREATE dari release baru dengan IMAGE YANG SAMA
# (dist di-bind-mount dari direktori release). .env tidak diubah (sha dibandingkan sebelum/sesudah). Tidak ada folder release/image/backup/volume yang dihapus.
# GERBANG IDENTITAS KODE LIVE (isi, bukan marker): hash blob semua berkas terlacak baseline vs release aktif, berkas tambahan, container == folder release, identitas proses — di fase 3, sebelum switch, dan TEPAT sebelum switch.
# AUDIT PERUBAHAN FRONTEND SEJAK BASELINE (ancestry saja tidak cukup): daftar berkas (nama + status), tepat daftar frontend/src yang diaudit, berkas yang dihapus = tepat tiga tab lama,
#   dan SIDIK JARI isi diff `frontend/` (sha256 dari git diff --full-index BASE..DEPLOY) = nilai yang diaudit saat skrip dibangkitkan; satu baris tambahan di berkas mana pun mengubah sidik jari → berhenti.
# BERHENTI BILA: kode live menyimpang dari baseline; ada deploy lain; disk < 5 GiB; berkas di luar allowlist; backend/, prisma, package, Docker/compose, .env, dist ikut berubah; sidik jari diff frontend berbeda;
#                bundel lama kehilangan teks fitur; dist baru tidak memuat tampilan baru atau masih memuat teks tab lama; hotfix performa hilang; image berubah setelah recreate; RestartCount != 0;
#                URL lama / endpoint Marketing / aset gagal smoke; .env atau hitungan data berubah.
#
#   git bundle create /tmp/mkt.bundle <BASE_SHA>..feat/marketing-tab-terpadu ; scp ke server /tmp/mkt.bundle        (atau tanpa BUNDLE: fetch dari origin setelah branch di-push)
#   cat scripts/release-marketing-tab.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/mkt.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/mkt.bundle bash /tmp/mkt.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'   # gerbang awal; produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/mkt.bundle bash /tmp/mkt.sh <DEPLOY_SHA_40> <BASE_SHA_40> --build-only'       # + release dir sementara, build dist terisolasi, semua pemeriksaan dist; release dir sementara dihapus; TANPA switch
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/mkt.bundle bash /tmp/mkt.sh <DEPLOY_SHA_40> <BASE_SHA_40>'                    # rilis penuh (hanya setelah persetujuan)
#   ssh ubuntu@43.133.152.6 'bash /tmp/mkt.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rollback'                                 # kembali ke baseline (folder BASE, image SAMA); tidak ada data yang dihapus
# (dibangkitkan oleh scripts/gen-release-marketing-tab.cjs dari scripts/release-gudang-pintu-masuk.sh + scripts/templates/release-marketing-tab/* + blok gerbang di scripts/templates/release-penjadwalan-langsung/*; JANGAN edit manual)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
MODE=release
for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --build-only) MODE=buildonly;; --rollback) MODE=rollback;; esac; done
CAND_BRANCH="${CAND_BRANCH:-feat/marketing-tab-terpadu}"
CAND_REF="refs/remotes/origin/cand-mkt"
BUNDLE="${BUNDLE:-}"
ALLOWED_RE='^(docs/MARKETING-LAPORAN-TERPADU\.md|frontend/qa-harness/marketing-browser-salinan\.cjs|frontend/qa-harness/marketing-browser\.cjs|frontend/qa-harness/marketing-navigasi\.cjs|frontend/qa-harness/marketing-prodcopy-server\.mjs|frontend/qa-harness/marketing-rekon-api\.cjs|frontend/qa-harness/marketing-rekon-salinan-db\.cjs|frontend/qa-harness/marketing-server\.mjs|frontend/qa-harness/qa-util\.cjs|frontend/qa-harness/serve-dist\.mjs|frontend/src/api\.js|frontend/src/features/laporan/akuisisiLogic\.js|frontend/src/features/laporan/components/AkuisisiTab\.jsx|frontend/src/features/laporan/components/BannerPeriode\.jsx|frontend/src/features/laporan/components/DetailSumberAkuisisi\.jsx|frontend/src/features/laporan/components/IklanCampaignTab\.jsx|frontend/src/features/laporan/components/KelolaBiayaIklan\.jsx|frontend/src/features/laporan/components/MarketingTab\.jsx|frontend/src/features/laporan/components/marketing/DetailSumberMarketing\.jsx|frontend/src/features/laporan/components/marketing/Disclosure\.jsx|frontend/src/features/laporan/components/marketing/KartuAngka\.jsx|frontend/src/features/laporan/components/marketing/KesehatanReferensi\.jsx|frontend/src/features/laporan/components/marketing/KualitasDataPanel\.jsx|frontend/src/features/laporan/components/marketing/MetaDetail\.jsx|frontend/src/features/laporan/components/marketing/PolaLeadRespons\.jsx|frontend/src/features/laporan/components/marketing/RincianKreatif\.jsx|frontend/src/features/laporan/components/marketing/RingkasanMarketing\.jsx|frontend/src/features/laporan/components/marketing/TabelSumber\.jsx|frontend/src/features/laporan/components/marketing/TrenLeadChart\.jsx|frontend/src/features/laporan/iklanCampaignLogic\.js|frontend/src/features/laporan/marketingData\.js|frontend/src/features/laporan/marketingLogic\.js|frontend/src/features/laporan/periodeLaporan\.js|frontend/src/lib/TabsContext\.jsx|frontend/src/pages/Laporan\.jsx|frontend/src/utils/exportLaporan\.js|frontend/src/utils/marketingXlsx\.js|frontend/src/utils/sheetBuilder\.js|frontend/tests/biayaIklanLogic\.test\.js|frontend/tests/marketingData\.test\.js|frontend/tests/marketingEkspor\.test\.js|frontend/tests/marketingLogic\.test\.js|frontend/tests/periodeLaporan\.test\.js|scripts/gen-release-marketing-tab\.cjs|scripts/release-marketing-tab\.sh|scripts/templates/release-marketing-tab/audit-frontend\.txt|scripts/templates/release-marketing-tab/build-only\.txt|scripts/templates/release-marketing-tab/container-baru\.txt|scripts/templates/release-marketing-tab/fitur-dist\.txt|scripts/templates/release-marketing-tab/header\.txt|scripts/templates/release-marketing-tab/smoke-marketing\.txt|scripts/templates/release-marketing-tab/uji-logika\.txt|scripts/templates/release-marketing-tab/verifikasi-hotfix\.txt|scripts/templates/release-penjadwalan-langsung/gerbang-kode-live\.txt|scripts/templates/release-penjadwalan-langsung/hitung-pasca\.txt|scripts/templates/release-penjadwalan-langsung/hitung-pra\.txt)$'
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/laporan/akuisisiLogic.js frontend/src/features/laporan/components/AkuisisiTab.jsx frontend/src/features/laporan/components/BannerPeriode.jsx frontend/src/features/laporan/components/DetailSumberAkuisisi.jsx frontend/src/features/laporan/components/IklanCampaignTab.jsx frontend/src/features/laporan/components/KelolaBiayaIklan.jsx frontend/src/features/laporan/components/MarketingTab.jsx frontend/src/features/laporan/components/marketing/DetailSumberMarketing.jsx frontend/src/features/laporan/components/marketing/Disclosure.jsx frontend/src/features/laporan/components/marketing/KartuAngka.jsx frontend/src/features/laporan/components/marketing/KesehatanReferensi.jsx frontend/src/features/laporan/components/marketing/KualitasDataPanel.jsx frontend/src/features/laporan/components/marketing/MetaDetail.jsx frontend/src/features/laporan/components/marketing/PolaLeadRespons.jsx frontend/src/features/laporan/components/marketing/RincianKreatif.jsx frontend/src/features/laporan/components/marketing/RingkasanMarketing.jsx frontend/src/features/laporan/components/marketing/TabelSumber.jsx frontend/src/features/laporan/components/marketing/TrenLeadChart.jsx frontend/src/features/laporan/iklanCampaignLogic.js frontend/src/features/laporan/marketingData.js frontend/src/features/laporan/marketingLogic.js frontend/src/features/laporan/periodeLaporan.js frontend/src/lib/TabsContext.jsx frontend/src/pages/Laporan.jsx frontend/src/utils/exportLaporan.js frontend/src/utils/marketingXlsx.js frontend/src/utils/sheetBuilder.js"
FRONTEND_DELETED_EXPECT="frontend/src/features/laporan/components/AkuisisiTab.jsx frontend/src/features/laporan/components/IklanCampaignTab.jsx frontend/src/features/laporan/components/TrafficTab.jsx"
FRONTEND_DIFF_SHA="990f9fce602a4576f6e085fa0c66b54a1f455f74bc7ffa2730d005c1eb2fd0cb"
PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MIN_FREE_KB=$((5 * 1024 * 1024))
TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/marketing-tab-${DEPLOY_SHORT}-${TS}"
PHASE="init"; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  \033[33mPERHATIAN\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
bebas_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
cek_disk() { [ "$(bebas_kb)" -ge "$MIN_FREE_KB" ] || die "disk bebas < 5 GiB ($1)"; ok "disk bebas $(( $(bebas_kb) / 1024 )) MiB >= 5 GiB ($1)"; }

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa; image sama dengan release baru)
Berhenti SEBELUM 'Switch' -> backend lama tidak pernah dimatikan. Setelah switch:
   bash /tmp/mkt.sh ${DEPLOY_SHA:-<sha>} ${BASE_SHA:-<base>} --rollback
   (setara: cd ${PREV_DIR:-<release-sebelumnya>} && SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend)
Rilis ini hanya mengganti dist web. Tidak ada migrasi/data baru.
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

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
    [ -e "$lf" ] || continue; [ "$lf" = "/tmp/release-marketing-tab.lock" ] && continue
    ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain mulai berjalan (kunci ${lf} dipegang) — berhenti sebelum switch"
  done
  OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "mkt\|release-marketing-tab\|pgrep\|node src/index.js" | grep -v "$$" || true)"
  [ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain tepat sebelum switch — berhenti"; }
  ok "tepat sebelum switch: tidak ada deploy/build/migrasi lain"
}

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"; done
exec 9>/tmp/release-marketing-tab.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "mkt\|release-marketing-tab\|pgrep\|node src/index.js" | grep -v "$$" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src"; exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
if [ "$MODE" = "preflight" ]; then if [ "$(bebas_kb)" -ge "$MIN_FREE_KB" ]; then ok "disk bebas $(( $(bebas_kb) / 1024 )) MiB >= 5 GiB (awal)"; else warn "disk bebas $(( $(bebas_kb) / 1024 )) MiB < 5 GiB — preflight (baca-saja) tetap berjalan; --build-only dan rilis penuh akan BERHENTI di gerbang ini sampai disk dibebaskan pemilik"; fi; else cek_disk "awal"; fi

PHASE="1-aktif"; say "1. Release aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
ENV_SHA="$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12}); .env sha ${ENV_SHA}"
PREV_STARTED="$(docker inspect -f '{{.State.StartedAt}}' "$CID_OLD")"

if [ "$MODE" = "rollback" ]; then
  PHASE="rollback"; say "ROLLBACK ke release sebelumnya (kode saja)"
  CAND_DIR_NOW="$PREV_DIR"; [ "$(basename "$CAND_DIR_NOW")" = "$DEPLOY_SHORT" ] || die "release aktif bukan ${DEPLOY_SHORT}; tidak ada yang di-rollback"
  TARGET="${BASE_SHA:0:8}"; [ -d "$RELEASES/$TARGET" ] || die "release ${TARGET} tidak ada di ${RELEASES}"
  dcp "$RELEASES/$TARGET" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "recreate dari ${TARGET} gagal"
  for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && break; sleep 2; done
  curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend tidak sehat setelah rollback"
  ok "rollback ke ${TARGET} selesai; .env sha $(sha256sum "$PERSIST/backend/.env" | cut -c1-16)"; trap - EXIT; exit 0
fi

PHASE="2-sumber"; say "2. Sumber kode, ancestry, batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
if [ -n "$BUNDLE" ]; then
  [ -r "$BUNDLE" ] || die "BUNDLE=${BUNDLE} tidak terbaca"
  sg bundle verify "$BUNDLE" >/dev/null 2>&1 || die "git bundle tidak valid / prasyarat tidak ada di repo sumber"
  sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch dari bundle gagal"
else
  sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "git fetch gagal"
fi
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat (${CAND_BRANCH}) BUKAN SHA rilis; bergeser"
# marker TIDAK dipakai sebagai bukti identitas: gerbang_kode_live membandingkan ISI kode live dengan snapshot baseline
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat — gabungkan live terbaru dulu"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -qE '^(backend/|frontend/dist|docker-compose|.*Dockerfile|.*package(-lock)?\.json$|.*\.env)' || die "backend/dist/Docker/package/.env berubah — rilis ini frontend-saja"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas, semuanya dalam allowlist; backend/schema/package/Docker tidak berubah"
# AUDIT PERUBAHAN FRONTEND SEJAK BASELINE — ancestry saja tidak cukup. Kandidat harus memuat TEPAT perubahan yang diaudit, bukan sekadar turunan baseline.
AUDIT_FE="$BK_DIR/audit-frontend.txt"
sg -c core.quotepath=false diff --no-renames --name-status "$BASE_SHA" "$DEPLOY_SHA" -- frontend | LC_ALL=C sort -k2 > "$AUDIT_FE.status"
sg -c core.quotepath=false diff --no-renames --numstat "$BASE_SHA" "$DEPLOY_SHA" -- frontend | LC_ALL=C sort -k3 > "$AUDIT_FE.numstat"
[ -s "$AUDIT_FE.status" ] || die "tidak ada perubahan frontend vs baseline"
DIHAPUS="$(awk '$1 == "D" { print $2 }' "$AUDIT_FE.status" | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"
[ "$DIHAPUS" = "$FRONTEND_DELETED_EXPECT" ] || die "berkas frontend yang DIHAPUS bukan tepat tiga tab lama (${DIHAPUS})"
awk '$1 != "A" && $1 != "M" && $1 != "D" { bad=1 } END { exit bad ? 1 : 0 }' "$AUDIT_FE.status" || die "ada perubahan frontend selain tambah/ubah/hapus (rename/mode) — berhenti"
FE_SHA="$(sg -c core.quotepath=false diff --no-renames --no-color --no-ext-diff --binary --full-index "$BASE_SHA" "$DEPLOY_SHA" -- frontend | sha256sum | cut -c1-64)"
[ "$FE_SHA" = "$FRONTEND_DIFF_SHA" ] || die "SIDIK JARI diff frontend (${FE_SHA:0:16}) != yang diaudit (${FRONTEND_DIFF_SHA:0:16}) — isi frontend berubah sejak audit; bangkitkan ulang skrip setelah audit ulang"
{
  echo "baseline=${BASE_SHA} kandidat=${DEPLOY_SHA} sidik-jari-diff-frontend=${FE_SHA}"
  echo "berkas berubah: $(wc -l < "$AUDIT_FE.status" | tr -d ' ') (tambah $(awk '$1=="A"' "$AUDIT_FE.status" | wc -l | tr -d ' '), ubah $(awk '$1=="M"' "$AUDIT_FE.status" | wc -l | tr -d ' '), hapus $(awk '$1=="D"' "$AUDIT_FE.status" | wc -l | tr -d ' '))"
  awk '{ ins += $1; del += $2 } END { printf "baris: +%d -%d\n", ins, del }' "$AUDIT_FE.numstat"
  echo "--- status"; cat "$AUDIT_FE.status"; echo "--- numstat"; cat "$AUDIT_FE.numstat"
} > "$AUDIT_FE"
ok "audit frontend: $(wc -l < "$AUDIT_FE.status" | tr -d ' ') berkas; hanya 3 tab lama dihapus; sidik jari isi diff ${FE_SHA:0:16} == yang diaudit (rincian: ${AUDIT_FE})"

PHASE="3-audit"; say "3. Audit produksi aktif"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung"
FP_SQL='select (select count(*) from _prisma_migrations where finished_at is not null) || chr(124) || (select count(*) from stock_movements) || chr(124) || (select count(*) from material_issues) || chr(124) || (select count(*) from stock_transfers) || chr(124) || (select count(*) from warehouse_corrections) || chr(124) || (select count(*) from "Message")'
FP_0="$(psql_live -At -c "$FP_SQL")"; [[ "$FP_0" =~ ^[0-9]+(\|[0-9]+){5}$ ]] || die "sidik jari hitungan data tidak terbaca: ${FP_0}"
ok "health sehat; bundel publik = dist aktif (${PREV_INDEX}); tidak ada migrasi menggantung; hitungan data (migrasi|stok|MI|ST|koreksi|pesan) = ${FP_0}"
gerbang_kode_live "fase-3-audit"
LOCK_NEW="$BK_DIR/pkg-baru.json"; sg show "${DEPLOY_SHA}:frontend/package.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package.json identik"
NM_KB="$(du -sk "$NM_SRC" | cut -f1)"
if [ "$(bebas_kb)" -ge $(( NM_KB * 2 + 2 * 1024 * 1024 )) ]; then :; elif [ "$MODE" = "preflight" ]; then warn "ruang disk belum cukup untuk salinan node_modules + build (butuh $(( (NM_KB * 2 + 2 * 1024 * 1024) / 1024 )) MiB, bebas $(( $(bebas_kb) / 1024 )) MiB) — build-only/rilis penuh akan berhenti"; else die "ruang disk kurang untuk salinan node_modules + build"; fi
ok "node_modules build dari ${NM_SRC}"
if [ "$MODE" = "preflight" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.yml") >/dev/null || die "docker-compose.yml berbeda dari release aktif"
diff -rq --exclude=node_modules --exclude=dist --exclude=.env --exclude=.release-commit "$PREV_DIR/backend" "$NEW_DIR/backend" >/dev/null || die "backend/ di release baru BERBEDA dari release aktif (rilis ini frontend-saja)"
ok "release dir dibuat; compose + seluruh backend/ identik dengan release aktif"
# UJI LOGIKA di atas ARSIP KANDIDAT (sebelum switch; node saja, tanpa jaringan/DB/produksi): pemetaan URL lama (?tab=Traffic|Akuisisi|Iklan → Marketing, periode dipertahankan), keadaan navigasi Marketing di URL
# (sumber/level/campaign/ad set/urutan/peringkat/umur), peringkat Meta, kartu & rekonsiliasi lead, ekspor CSV/XLSX (periode, basis, cutoff, null bukan nol), antrean baca (429 terbatas, permintaan basi dilewati).
( cd "$NEW_DIR/frontend" && node --test --test-reporter=tap tests/periodeLaporan.test.js tests/marketingLogic.test.js tests/marketingEkspor.test.js tests/marketingData.test.js tests/akuisisiLogic.test.js tests/biayaIklanLogic.test.js ) > "$BK_DIR/uji-logika.log" 2>&1 || { tail -n 30 "$BK_DIR/uji-logika.log"; die "uji logika Marketing gagal pada arsip kandidat (produksi tidak berubah)"; }
UJI_LULUS="$(grep -E '^# pass ' "$BK_DIR/uji-logika.log" | awk '{print $3}')"; UJI_GAGAL="$(grep -E '^# fail ' "$BK_DIR/uji-logika.log" | awk '{print $3}')"
[ "$UJI_GAGAL" = "0" ] && [ "${UJI_LULUS:-0}" -ge 40 ] || die "uji logika: lulus=${UJI_LULUS:-?} gagal=${UJI_GAGAL:-?} (butuh gagal=0 dan lulus>=40)"
ok "uji logika pada arsip kandidat: ${UJI_LULUS} lulus, 0 gagal (URL lama → Marketing, navigasi, ekspor, antrean 429)"

say "4b. Build frontend (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "bundel baru identik dengan lama"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
# Teks yang HANYA ada di tampilan baru (tidak boleh ada di dist aktif); teks tab lama yang HARUS hilang (ada di dist aktif, tidak di dist baru); fitur live yang HARUS ada di KEDUANYA.
for s0 in "Total lead (termasuk spam)" "Tren lead harian (tanpa spam)" "Pola lead & respons" "Kesehatan & referensi" "Kreatif & tautan" "Customer lunas (ledger)" "marketing-sumber-" "Lead CTWA terbukti"; do
  [ -z "$(grep -lF -- "$s0" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks tampilan baru '${s0}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"
  [ -n "$(grep -lF -- "$s0" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru TIDAK memuat tampilan baru: ${s0}"
done
for s1 in "Perbandingan sumber" "Tabel perbandingan sumber" "Jejak drilldown" "Closing utama"; do
  [ -n "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks tab lama '${s1}' tidak ada di dist release aktif — perbaiki daftar pembanding"
  [ -z "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru MASIH memuat teks tab lama: ${s1}"
done
for s2 in "Kelola biaya iklan" "Rincian per Iklan" "Performa per Platform" "Hari Tidak Normal" "Jam Paling Rawan" "Peta Traffic: Hari × Jam" "Atribusi label CRM" "Meta CTWA" "Kualitas data" "Rencana Produksi" "Beranda Gudang" "Koreksi saldo"; do
  [ -n "$(grep -lF -- "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar pembanding"
  [ -n "$(grep -lF -- "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur: ${s2}"
done
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}): 8 teks Marketing baru ada, 4 teks tab lama hilang, 12 teks fitur live (biaya iklan, rincian kreatif, pola jam, Meta, Rencana Produksi, Gudang) tetap ada"

PHASE="4c-aset-lama"; say "4c. Bawa aset ber-hash dari dist aktif (tab terbuka saat deploy tetap bisa memuat chunk lama)"
OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"; n=0
for f in "$PREV_DIR"/frontend/dist/assets/*; do
  [ -f "$f" ] || continue; b="$(basename "$f")"; [ -e "$NEW_DIR/frontend/dist/assets/$b" ] && continue
  cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b" && { printf '%s\n' "$b" >> "$OLD_ASSETS"; n=$((n+1)); }
done
find "$NEW_DIR/frontend/dist/assets" -type f -mtime +21 -delete
[ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "bundel baru rusak setelah membawa aset lama"
ok "${n} aset lama dibawa; index.html baru hanya merujuk aset baru"
cek_disk "sebelum switch"
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum switch"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah sebelum switch"
gerbang_kode_live "fase-4c-pra-switch"
COUNT_SQL="select 'schedules', count(*) from production_unit_schedules union all select 'schedule_events', count(*) from production_unit_schedule_events union all select 'run_plans_v2', count(*) from production_run_plans_v2 union all select 'runs_v2', count(*) from production_runs_v2 union all select 'stock_movements', count(*) from stock_movements union all select 'material_issues', count(*) from material_issues union all select 'material_issue_lines', count(*) from material_issue_lines union all select 'unit_provisional_usages', count(*) from unit_provisional_usages union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'jurnal', count(*) from fin_journal_entries union all select 'jurnal_baris', count(*) from fin_journal_lines"
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pra-switch.txt" || die "hitung baris pra-switch gagal"; ok "pra-switch: hitung baris jadwal/Run/stok/pemakaian/harga/jurnal dicatat"
if [ "$MODE" = "buildonly" ]; then
  say "Build terisolasi selesai (--build-only): semua gerbang sampai dist lulus; produksi TIDAK diubah"
  # hanya release dir SEMENTARA yang dibuat skrip ini (diverifikasi) yang dihapus; release aktif/lama, backup, image, volume TIDAK disentuh
  [ "$NEW_DIR" = "$RELEASES/$DEPLOY_SHORT" ] && [ "$(tr -d '[:space:]' < "$NEW_DIR/.release-commit")" = "$DEPLOY_SHORT" ] && [ "$NEW_DIR" != "$PREV_DIR" ] || die "release dir sementara tidak terverifikasi; tidak dihapus"
  rm -rf -- "$NEW_DIR"; ok "release dir sementara ${NEW_DIR} dihapus; disk bebas $(( $(bebas_kb) / 1024 )) MiB; bukti gerbang di ${BK_DIR}"
  trap - EXIT; exit 0
fi

PHASE="5-switch"; say "5. Switch (recreate backend dari release baru, image SAMA; SATU kali)"
tidak_ada_deploy_lain_lagi
gerbang_kode_live "fase-5-tepat-sebelum-switch"
T_SWITCH="$(date -u +%FT%TZ)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$PREV_IMG_ID" ] || die "image berubah (rilis ini tidak boleh mengganti image)"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend sehat dari ${DEPLOY_SHORT}; image sama ${PREV_IMG_ID:7:12}; switch ${T_SWITCH}"

PHASE="6-verifikasi"; say "6. Verifikasi pasca-rilis (baca-saja)"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru"
ok "publik 200; bundel web publik = dist baru ${NEW_INDEX}"
# hotfix performa backend HARUS tetap ada: di container baru dan byte-identik dengan snapshot baseline (rilis ini tidak mengubah backend sama sekali)
docker exec "$CID_NEW" test -f /app/src/middleware/cacheSingkat.js || die "hotfix HILANG: cacheSingkat.js tidak ada di container baru"
docker exec "$CID_NEW" sh -c 'grep -q "JOIN LATERAL" /app/src/routes/conversations.js && grep -q "JOIN LATERAL" /app/src/routes/analytics.js && grep -q "cacheSingkat(30_000)" /app/src/routes/analytics.js' || die "hotfix HILANG: query LATERAL / cacheSingkat tidak ada di container baru"
for hf in backend/src/routes/analytics.js backend/src/routes/conversations.js backend/src/middleware/cacheSingkat.js backend/src/routes/attributionAds.js; do
  [ "$(git hash-object --no-filters "$NEW_DIR/$hf")" = "$(sg rev-parse "${BASE_SHA}:${hf}")" ] || die "backend berubah/hilang: ${hf} di release baru != snapshot baseline"
done
# perbaikan tab shell di Laporan (useOptionalTabs) tetap ada pada kode frontend baru
grep -q useOptionalTabs "$NEW_DIR/frontend/src/pages/Laporan.jsx" || die "perbaikan tab shell HILANG: Laporan.jsx baru tanpa useOptionalTabs"
ok "hotfix performa tetap ada (4 berkas backend == snapshot baseline; container baru memuat LATERAL + cacheSingkat); Laporan.jsx memuat perbaikan tab shell"
# performa memadai: health beberapa kali + query LATERAL baca-saja pada produksi
PERF_H="$(for i in 1 2 3 4 5; do curl -fsS -o /dev/null -w '%{time_total}\n' --max-time 10 "${INTERNAL_URL}/api/health"; done | tr '\n' ' ')"
LAT_SQL='SELECT COUNT(*) FROM "Conversation" c JOIN LATERAL (SELECT direction FROM "Message" WHERE "conversationId" = c.id ORDER BY "createdAt" DESC LIMIT 1) m ON TRUE WHERE m.direction = '"'"'INBOUND'"'"
T0=$(date +%s%N); psql_live -At -c "$LAT_SQL" >/dev/null || die "query LATERAL baca-saja gagal"; T1=$(date +%s%N)
LAT_MS=$(( (T1 - T0) / 1000000 )); [ "$LAT_MS" -lt 15000 ] || die "query LATERAL lambat (${LAT_MS} ms)"
ok "performa: health(detik)=${PERF_H}; query 'belum dibalas' (LATERAL, baca-saja) ${LAT_MS} ms"
# backend IDENTIK: kode di dalam container SETELAH switch == folder release baru == kode di container SEBELUM switch (image sama, backend/ tidak berubah)
docker exec "$CID_NEW" sh -c 'cd /app && { for x in src prisma scripts tests; do [ -d "$x" ] && find "$x" -type f; done; } | LC_ALL=C sort | xargs sha256sum && sha256sum package.json package-lock.json' > "$BK_DIR/container-sha-baru.txt" || die "gagal membaca kode di dalam container baru"
( cd "$NEW_DIR/backend" && { for x in src prisma scripts tests; do [ -d "$x" ] && find "$x" -type f; done; } | LC_ALL=C sort | xargs sha256sum && sha256sum package.json package-lock.json ) > "$BK_DIR/dir-sha-baru.txt"
cmp -s "$BK_DIR/container-sha-baru.txt" "$BK_DIR/dir-sha-baru.txt" || die "kode di container baru BERBEDA dari folder release baru"
cmp -s "$BK_DIR/container-sha-baru.txt" "$BK_DIR/container-sha.txt" || die "kode backend di container BERUBAH setelah switch (harus identik dengan sebelum switch)"
ok "backend identik: kode di container sebelum == sesudah switch == folder release baru ($(wc -l < "$BK_DIR/container-sha-baru.txt" | tr -d ' ') berkas)"
# hitung baris pasca-switch vs pra-switch (informasi: pengguna sungguhan bisa menulis selama jendela rilis; skrip ini sendiri tidak menulis apa pun)
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pasca-switch.txt" || die "hitung baris pasca-switch gagal"
if diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" >/dev/null; then ok "hitung baris jadwal/Run/stok/pemakaian/harga/jurnal IDENTIK sebelum vs sesudah switch"; else warn "hitung baris berbeda sebelum vs sesudah switch (kemungkinan aktivitas pengguna sungguhan selama jendela rilis; skrip tidak menulis):"; diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" | sed 's/^/        /' || true; fi
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} 404"; ok "aset lama masih 200"; fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang tidak ada harus 404 jujur"
ok "aset yang tidak ada = 404"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env BERUBAH selama rilis"
FP_1="$(psql_live -At -c "$FP_SQL")"; [ "$FP_1" = "$FP_0" ] || die "hitungan data BERUBAH selama rilis: sebelum=${FP_0} sesudah=${FP_1}"
ok ".env identik (sha ${ENV_SHA}); hitungan data identik ${FP_1}"
# Smoke baca-saja: API tanpa token = 401 (backend hidup, tanpa menyentuh data). Halaman lama sudah dibuktikan HILANG di dist baru pada fase build (sebelum aset lama dibawa untuk tab terbuka).
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/api/inventory/material-issues")" = "401" ] || die "API tanpa token harus 401"
for ep in /api/production/rencana/jadwal-batch /api/analytics/sales-report /api/inventory/adjustments/koreksi-saldo/bahan/x; do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}${ep}")" = "401" ] || die "API ${ep} tanpa token harus 401"; done
ok "smoke lulus: API Gudang, jadwal-batch, sales-report, koreksi saldo tanpa token = 401 (backend hidup)"
# SMOKE PASCA-RILIS (baca-saja, tanpa token): URL lama dan baru Laporan menyajikan SPA dengan bundel BARU (200); endpoint yang dipakai Marketing hidup (401 tanpa token, bukan 404/5xx);
# aset ber-hash bundel baru 200; aset lama masih 200. Pengalihan URL lama → Marketing terjadi di klien dan sudah diuji pada arsip kandidat (uji logika) + browser nyata sebelum rilis.
for q in "tab=Marketing" "tab=Marketing&sumber=META&level=adset&campaign=1&adset=1" "tab=Traffic" "tab=Akuisisi&sumber=TIKTOK" "tab=Iklan"; do
  SC="$(curl -s -o "$BK_DIR/smoke-laporan.html" -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/laporan?${q}&dari=2026-10-01&sampai=2026-10-10")"
  [ "$SC" = "200" ] || die "smoke: /laporan?${q} -> ${SC} (harus 200)"
  grep -q "$NEW_INDEX" "$BK_DIR/smoke-laporan.html" || die "smoke: /laporan?${q} tidak menyajikan bundel baru ${NEW_INDEX}"
done
ok "smoke URL: /laporan dengan tab=Marketing (+detail Meta), Traffic, Akuisisi, Iklan -> 200 dan bundel baru ${NEW_INDEX}"
for ep in /api/atribusi/iklan/sumber /api/atribusi/iklan /api/atribusi/iklan/kesehatan /api/atribusi/iklan/referensi /api/atribusi/iklan/ekspor-id /api/analytics/traffic /api/analytics/lead-source-detail; do
  EC="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}${ep}")"
  [ "$EC" = "401" ] || die "smoke: ${ep} tanpa token -> ${EC} (harus 401: endpoint hidup dan tertutup)"
done
ok "smoke API Marketing: sumber, campaign/ad set/ad, kesehatan, referensi, ekspor-id, traffic, lead-source-detail tanpa token = 401"
CHUNKS="$(grep -oE 'assets/[A-Za-z0-9_.-]+\.js' "$NEW_DIR/frontend/dist/index.html" | sort -u | head -5)"
for a in $CHUNKS; do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/${a}")" = "200" ] || die "smoke: aset ${a} bukan 200"; done
ok "smoke aset: aset bundel baru yang dirujuk index.html = 200"
sleep 15
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0"
trap - EXIT
say "SELESAI — frontend ${DEPLOY_SHORT} aktif (switch ${T_SWITCH}). Rollback: bash /tmp/mkt.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback. Log: ${BK_DIR}/release.log"
say "CATATAN: rilis FRONTEND-SAJA. Backend, image, migrasi, data, .env, campaign/budget/Meta TIDAK berubah; hotfix performa tetap ada. Rollback = baseline ${BASE_SHA:0:8} (image sama): bash /tmp/mkt.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback. Tidak ada folder release/image/backup/volume yang dihapus."
