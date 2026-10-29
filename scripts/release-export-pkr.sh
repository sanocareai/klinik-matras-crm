#!/usr/bin/env bash
# RILIS "EXPORT EXCEL PENJUALAN KARYAWAN" (Finance → Penjualan Karyawan → tombol Export Excel): WEB + BACKEND, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • Modul export baru `penjualan-karyawan` (POST /api/finance/export/penjualan-karyawan; izin finance:read, SAMA dengan daftar layar): sheet Daftar Penjualan, Per Karyawan, Pembayaran. Mengikuti periode, status, pencarian, dan karyawan yang dipilih
#     di layar dan memuat SELURUH hasil filter (batas teknis 50.000 baris, ditolak 413 — tidak dipotong diam-diam); layar tetap memotong di 500 baris.
#   • Angka sama dengan daftar layar (bentukPenjualan yang sama). TOTAL hanya menjumlahkan dokumen AKTIF; dokumen batal tampil sebagai riwayat "Dibatalkan — tidak ditagih" (sisa Rp0, nilai historis tetap) dan dirangkum terpisah;
#     pembayaran batal berstatus Dibatalkan dan TIDAK masuk total pembayaran aktif. Label filter memakai NAMA karyawan. Kolom sensitif (Catatan Internal, Rekening) hanya untuk Finance Admin.
#   • Kontrak metrik: dua definisi baru (pkr_nilai_penjualan, pkr_sisa_ditagih) ditautkan ke kartu layar; dokumen cakupan export diperbarui (21 modul).
#   • Rilis ini TIDAK membuat atau mengubah dokumen PKR, pembayaran, jurnal, order, stok, atau data bisnis apa pun; export hanya membaca. Smoke pasca-switch tidak membuat transaksi percobaan.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore; 524 dokumen uji, dokumen dan pembayaran batal, filter, izin, tanpa jejak tulis — data uji hanya di salinan);
#     build web di release dir; switch SATU kali; verifikasi; smoke baca-saja pasca-switch (angka Excel = hitungan langsung dari tabel = daftar layar; izin 401/403; data identik sebelum vs sesudah).
#   • BASELINE = release aktif. GERBANG IDENTITAS KODE LIVE membandingkan ISI kode (hash blob SEMUA berkas terlacak baseline, berkas tambahan, identitas proses) di fase 2, fase 6, dan TEPAT sebelum switch; selisih isi apa pun /
#     berkas tambahan / proses berganti = berhenti sebelum switch. Pembersihan release lama (fase 9) DINONAKTIFKAN: tidak ada folder release/image rollback/backup/volume yang dihapus oleh skrip.
#
#   cat scripts/release-export-pkr.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/xpk.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/xpk.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/xpk.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/xpkr.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/xpk.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/xpk.out 2>&1 < /dev/null &'   # rilis penuh
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru). Rollback hanya menghilangkan tombol/endpoint export PKR dan dua definisi metrik; tidak ada data yang berubah.
# (dibangkitkan oleh scripts/gen-release-export-pkr.cjs dari scripts/release-penjadwalan-langsung.sh + scripts/templates/release-export-pkr/* + pustaka scripts/lib/{rehearsal,smoke}-export-pkr.mjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/finance-export-pkr}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/src/services/finance/export/penjualan-karyawan\.js|backend/src/services/finance/export/registry\.js|backend/src/services/finance/kontrakMetrik\.js|backend/tests/financeExportPenjualanKaryawan\.test\.js|backend/tests/integration/financeExportPenjualanKaryawan\.integration\.test\.js|backend/tests/releaseExportPkr\.test\.js|docs/FINANCE-EXPORT-COVERAGE\.md|frontend/src/pages/finance/FinancePenjualanKaryawan\.jsx|frontend/tests/financeExportCoverage\.test\.js|scripts/gen-release-export-pkr\.cjs|scripts/lib/rehearsal-export-pkr\.mjs|scripts/lib/smoke-export-pkr\.mjs|scripts/release-export-pkr\.sh|scripts/templates/release-export-pkr/header\.txt|scripts/templates/release-export-pkr/rollback\.txt)$'
BACKEND_SRC_EXPECT="backend/src/services/finance/export/penjualan-karyawan.js backend/src/services/finance/export/registry.js backend/src/services/finance/kontrakMetrik.js"
FRONTEND_SRC_EXPECT="frontend/src/pages/finance/FinancePenjualanKaryawan.jsx"
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
BK_DIR="$HOME/release-backups/export-pkr-${DEPLOY_SHORT}-${TS}"
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
Tujuan rollback = image dan folder release LIVE SEBELUM rilis ini; keduanya MEMUAT hotfix performa dan fitur live lain (gerbang kode live membuktikan kode di container == folder == baseline diset sebelum switch).
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama tidak punya tombol dan endpoint Export Excel Penjualan Karyawan (halaman PKR kembali tanpa tombol export).
Dokumen PKR, pembayaran, jurnal, order, dan stok tidak disentuh oleh rilis ini: tidak ada yang perlu dibalik. File Excel yang sudah diunduh pengguna tetap sah sebagai berkas biasa.
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
exec 9>/tmp/release-export-pkr.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "xpk\|release-export-pkr\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
    [ -e "$lf" ] || continue; [ "$lf" = "/tmp/release-export-pkr.lock" ] && continue
    ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain mulai berjalan (kunci ${lf} dipegang) — berhenti sebelum switch"
  done
  OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "xpk\|release-export-pkr\|pgrep\|node src/index.js" | grep -v "$$" || true)"
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
BACKUP_FILE="$HOME/backups/pre-export-pkr-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "pkr_nilai_penjualan" "pkr_sisa_ditagih"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; [ -z "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks fitur baru '${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done
for s2 in "Ada stok" "Stok belum diketahui" "Nol menurut pergerakan" "Saldo minus" "Koreksi saldo" "Ubah harga" "Pilih meja" "Pilih semua unit order ini" "Belum dijadwalkan" "Riwayat dan dokumen pemakaian" "Tanpa pengeluaran stok" "Mengurangi stok" "Beranda Gudang" "Pengeluaran Material" "Konfirmasi Barang Jadi" "Perlu keputusan Anda" "Varian serupa yang sudah ada" "Batalkan barang baru ini" "Ubah barang baru" "Tambah pemakaian" "Ganti bahan" "Ajukan perubahan" "Lihat dampak" "Konfirmasi & kurangi stok" "Harga Berlaku (HPP operasional)" "Bahan belum tercatat" "Detail teknis" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-xpk-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
[ "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"
ok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR}: memuat hotfix performa (kode container == folder == baseline disetujui, terbukti gerbang kode live)"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_xpk_${TS}"
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
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): Export Excel Penjualan Karyawan (524 dokumen uji lebih dari batas 500 layar, dokumen dan pembayaran batal, filter status/pencarian/karyawan/periode, izin, tanpa jejak tulis pada dokumen/pembayaran/jurnal) pada salinan; data uji hanya di salinan dan DB dihapus di akhir.
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji export PKR terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "import { createRequire } from \"node:module\";\nimport { pathToFileURL } from \"node:url\";\nimport path from \"node:path\";\nconst require = createRequire(process.cwd() + \"/\");\nconst jwt = require(\"jsonwebtoken\");\nconst ExcelJS = require(\"exceljs\");\nconst { PrismaClient } = require(\"@prisma/client\");\nconst prisma = new PrismaClient();\nconst BASE = process.env.SMOKE_BASE ?? \"http://127.0.0.1:4000\"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)\nconst APP = process.env.APP_DIR ?? \"/app\";\nlet fail = 0; let dilewati = 0;\nconst rec = (n, ok, d = \"\") => { if (!ok) fail++; console.log(`  ${ok ? \"PASS\" : \"FAIL\"}  ${n}${d ? \" — \" + String(d).slice(0, 220) : \"\"}`); };\nconst skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };\n// SMOKE BACA-SAJA terhadap production hidup: Export Excel Penjualan Karyawan (PKR). Tidak ada tulisan dan tidak ada transaksi/dokumen percobaan. Setiap angka Excel dibandingkan dengan hitungan\n// LANGSUNG dari tabel (bukan dari kode export) dan dengan daftar layar (GET /api/finance/penjualan-karyawan). Dokumen, pembayaran, dan jurnal harus identik sebelum vs sesudah.\nconst { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, \"src/constants/permissions.js\")).href);\nconst rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);\nconst bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));\nconst tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: \"10m\" });\nconst hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);\nconst B = (k) => Number(process.env[k]);\nconst r2 = (x) => Math.round(Number(x) * 100) / 100;\nconst users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: \"asc\" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });\nconst finAdmin = info.find((x) => bisa(x.rs, P.FINANCE_ADMIN))?.u;\nconst finBiasa = info.find((x) => bisa(x.rs, P.FINANCE_READ) && !bisa(x.rs, P.FINANCE_ADMIN))?.u;\nconst tanpaIzin = info.find((x) => !bisa(x.rs, P.FINANCE_READ))?.u;\nif (!finAdmin) { rec(\"akun Finance Admin (finance:admin) tersedia\", false); process.exit(1); }\nconst tA = await tokenUntuk(finAdmin); const tF = finBiasa ? await tokenUntuk(finBiasa) : null; const tX = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;\n\nconst jejak = async () => ({\n  dokumen: await hitung(\"select count(*)::int n from fin_penjualan_karyawan\"), item: await hitung(\"select count(*)::int n from fin_penjualan_karyawan_items\"), bayar: await hitung(\"select count(*)::int n from fin_penjualan_karyawan_payments\"),\n  batalDok: await hitung(\"select count(*)::int n from fin_penjualan_karyawan where status::text = 'DIBATALKAN'\"), batalBayar: await hitung(\"select count(*)::int n from fin_penjualan_karyawan_payments where cancelled_at is not null\"),\n  nilai: String((await prisma.$queryRawUnsafe(\"select coalesce(sum(total),0)::text n from fin_penjualan_karyawan\"))[0].n),\n  jurnal: await hitung(\"select count(*)::int n from fin_journal_entries\"), baris: await hitung(\"select count(*)::int n from fin_journal_lines\"), order: await hitung('select count(*)::int n from \"Order\"'), stok: await hitung(\"select count(*)::int n from stock_movements\"),\n});\nconst s0 = await jejak();\n\nconst unduh = async (token, body) => {\n  const r = await fetch(BASE + \"/api/finance/export/penjualan-karyawan\", { method: \"POST\", headers: { \"Content-Type\": \"application/json\", ...(token ? { Authorization: \"Bearer \" + token } : {}) }, body: JSON.stringify(body) });\n  const tipe = r.headers.get(\"content-type\") || \"\"; if (!tipe.includes(\"spreadsheetml\")) { let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, wb: null, json: j }; }\n  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return { status: r.status, wb, json: null };\n};\nconst sel = (c) => (c.value && typeof c.value === \"object\" && !(c.value instanceof Date) && \"text\" in c.value ? c.value.text : c.value);\nconst sheet = (wb, nama) => { const ws = wb.getWorksheet(nama); if (!ws) return { header: [], baris: [], total: null, ada: false };\n  const header = []; ws.getRow(6).eachCell({ includeEmpty: false }, (c, i) => { header[i - 1] = sel(c); }); const baris = []; let total = null;\n  for (let r = 7; r <= ws.rowCount; r++) { const row = ws.getRow(r); if (row.actualCellCount === 0) continue; const o = {}; header.forEach((h, i) => { o[h] = sel(row.getCell(i + 1)) ?? null; });\n    if (typeof o[header[0]] === \"string\" && /^Tidak ada data sesuai/.test(o[header[0]])) continue; // pesan sheet kosong, bukan baris data\n    if (typeof o[header[0]] === \"string\" && /^TOTAL/i.test(o[header[0]])) { total = o; break; } baris.push(o); }\n  return { header, baris, total, ada: true }; };\nconst num = (v) => Number(v ?? 0);\nconst layar = async (q) => { const r = await fetch(BASE + \"/api/finance/penjualan-karyawan?\" + new URLSearchParams(q).toString(), { headers: { Authorization: \"Bearer \" + tA } }); return { status: r.status, json: r.status === 200 ? await r.json() : null }; };\n\n// ── sumber kebenaran LANGSUNG dari tabel untuk satu periode\nconst dariTabel = async (from, to) => {\n  const dok = await prisma.$queryRawUnsafe(\"select p.id::text id, p.nomor, p.status::text status, p.total::float8 total from fin_penjualan_karyawan p where p.date between $1::date and $2::date order by p.nomor\", from, to);\n  const bayar = await prisma.$queryRawUnsafe(\"select y.penjualan_id::text pid, y.amount::float8 amount, (y.cancelled_at is not null) batal from fin_penjualan_karyawan_payments y join fin_penjualan_karyawan p on p.id = y.penjualan_id where p.date between $1::date and $2::date\", from, to);\n  const aktifPer = new Map(); for (const y of bayar) if (!y.batal) aktifPer.set(y.pid, r2((aktifPer.get(y.pid) ?? 0) + y.amount));\n  const baris = dok.map((d) => { const aktif = d.status === \"AKTIF\"; const terbayar = aktif ? (aktifPer.get(d.id) ?? 0) : 0; return { nomor: d.nomor, aktif, total: r2(d.total), terbayar: r2(terbayar), sisa: aktif ? r2(d.total - terbayar) : 0 }; });\n  return { baris, nBayar: bayar.length, bayarAktif: r2(bayar.filter((y) => !y.batal).reduce((s, y) => s + y.amount, 0)), nBayarAktif: bayar.filter((y) => !y.batal).length };\n};\nconst PERIODES = [[\"2025-01-01\", \"2026-12-31\", \"seluruh periode data\"], [\"2026-10-01\", \"2026-10-31\", \"Oktober 2026\"]];\nfor (const [from, to, nama] of PERIODES) {\n  const t = await dariTabel(from, to); const ex = await unduh(tA, { periode: { from, to }, filter: {} });\n  rec(`export PKR ${nama}: 200 dan berkas .xlsx`, ex.status === 200 && !!ex.wb, ex.status);\n  if (!ex.wb) continue;\n  const d = sheet(ex.wb, \"Daftar Penjualan\");\n  rec(`${nama}: sheet Daftar memuat SEMUA ${t.baris.length} dokumen periode (hitungan langsung dari tabel), tanpa batas 500 layar`, d.baris.length === t.baris.length, `${d.baris.length} vs ${t.baris.length}`);\n  let beda = 0; for (const x of t.baris) { const b = d.baris.find((r) => r[\"Nomor PKR\"] === x.nomor); if (!b || r2(num(b[\"Nilai (Rp)\"])) !== x.total || r2(num(b[\"Dibayar (Rp)\"])) !== x.terbayar || r2(num(b[\"Sisa Ditagih (Rp)\"])) !== x.sisa) beda++;\n    else if (!x.aktif && b.Status !== \"Dibatalkan — tidak ditagih\") beda++; else if (x.aktif && ![\"Lunas\", \"Dibayar sebagian\", \"Belum dibayar\"].includes(b.Status)) beda++; }\n  rec(`${nama}: setiap dokumen (nilai, dibayar, sisa, status) sama dengan hitungan langsung dari tabel; dokumen batal = \"Dibatalkan — tidak ditagih\" dengan sisa Rp0`, beda === 0, beda ? `${beda} dokumen berbeda` : \"identik\");\n  const aktif = t.baris.filter((x) => x.aktif);\n  rec(`${nama}: baris TOTAL hanya dokumen aktif (nilai, dibayar, sisa)`, !!d.total && r2(num(d.total[\"Nilai (Rp)\"])) === r2(aktif.reduce((s, x) => s + x.total, 0)) && r2(num(d.total[\"Dibayar (Rp)\"])) === r2(aktif.reduce((s, x) => s + x.terbayar, 0)) && r2(num(d.total[\"Sisa Ditagih (Rp)\"])) === r2(aktif.reduce((s, x) => s + x.sisa, 0)), d.total ? String(d.total[\"Nomor PKR\"]) : \"tanpa baris total\");\n  const y = sheet(ex.wb, \"Pembayaran\");\n  rec(`${nama}: sheet Pembayaran memuat semua pembayaran (${t.nBayar}), pembayaran batal berstatus Dibatalkan dan TIDAK masuk total aktif (${t.nBayarAktif} pembayaran, Rp${t.bayarAktif})`, y.baris.length === t.nBayar && y.baris.filter((r) => r.Status === \"Aktif\").length === t.nBayarAktif && (t.nBayar === 0 || (!!y.total && r2(num(y.total[\"Nominal (Rp)\"])) === t.bayarAktif)), `${y.baris.length}/${t.nBayar}`);\n  rec(`${nama}: kolom sensitif (Catatan Internal, Rekening) hadir untuk Finance Admin`, d.header.includes(\"Catatan Internal\") && y.header.includes(\"Rekening\"));\n  rec(`${nama}: sheet Per Karyawan ada`, sheet(ex.wb, \"Per Karyawan\").ada);\n  const sc = await layar({ from, to }); rec(`${nama}: daftar layar 200`, sc.status === 200);\n  if (sc.json) { let sk = 0; for (const p of sc.json.penjualan) { const b = d.baris.find((r) => r[\"Nomor PKR\"] === p.nomor); if (!b || r2(num(b[\"Nilai (Rp)\"])) !== r2(p.total) || r2(num(b[\"Dibayar (Rp)\"])) !== r2(p.terbayar) || r2(num(b[\"Sisa Ditagih (Rp)\"])) !== r2(p.sisa)) sk++; }\n    rec(`${nama}: angka Excel sama dengan daftar layar untuk ${sc.json.penjualan.length} dokumen yang tampil di layar`, sk === 0, sk ? `${sk} berbeda` : \"identik\"); }\n}\n\n// ── filter status/pencarian/karyawan: hasil Excel = hasil layar. PEMBANDING SAH hanya bila seluruh data < 500 dokumen: layar memotong 500 baris TERBARU lebih dulu, baru menyaring status turunan (Lunas/Sebagian/Belum),\n// sehingga pada data lebih besar layar menampilkan lebih sedikit dari hasil sebenarnya (Excel memuat semuanya).\nconst layarSah = (await hitung(\"select count(*)::int n from fin_penjualan_karyawan\")) < 500;\nconst [F0, T0] = [\"2025-01-01\", \"2026-12-31\"];\nfor (const st of [\"LUNAS\", \"SEBAGIAN\", \"BELUM_BAYAR\", \"DIBATALKAN\"]) {\n  const ex = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { status: st } }); const sc = await layar({ from: F0, to: T0, status: st });\n  const n = ex.wb ? sheet(ex.wb, \"Daftar Penjualan\").baris.length : -1;\n  if (layarSah && sc.json) rec(`filter status ${st}: jumlah dokumen Excel = layar`, ex.status === 200 && n === sc.json.penjualan.length, `${n} vs ${sc.json.penjualan.length}`); else skip(`filter status ${st}`, \"data lebih dari 500 dokumen: layar memotong sebelum menyaring status, bukan pembanding sah (Excel memuat semuanya)\");\n}\nconst contoh = (await prisma.$queryRawUnsafe(\"select nomor, buyer_name, seller_id from fin_penjualan_karyawan order by nomor limit 1\"))[0];\nif (contoh && layarSah) {\n  const kata = String(contoh.buyer_name).split(/\\s+/)[0]; const ex = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { q: kata } }); const sc = await layar({ from: F0, to: T0, q: kata });\n  rec(`filter pencarian \"${kata}\": jumlah dokumen Excel = layar`, ex.status === 200 && !!sc.json && sheet(ex.wb, \"Daftar Penjualan\").baris.length === sc.json.penjualan.length, ex.status);\n  const exK = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { sellerId: contoh.seller_id } }); const scK = await layar({ from: F0, to: T0, sellerId: contoh.seller_id });\n  rec(\"filter karyawan: jumlah dokumen Excel = layar dan label filter memakai NAMA (bukan id)\", exK.status === 200 && !!scK.json && sheet(exK.wb, \"Daftar Penjualan\").baris.length === scK.json.penjualan.length && !JSON.stringify(sheet(exK.wb, \"Daftar Penjualan\")).includes(contoh.seller_id) && JSON.stringify([1, 2, 3, 4].map((i) => sel(exK.wb.getWorksheet(\"Daftar Penjualan\").getCell(`A${i}`)))).includes(\"Karyawan: \"), exK.status);\n} else skip(\"filter pencarian/karyawan dibanding layar\", contoh ? \"data lebih dari 500 dokumen: layar terpotong, bukan pembanding sah\" : \"tidak ada dokumen PKR\");\n\n// ── izin & penolakan sebelum menyentuh data\nrec(\"tanpa token = 401\", (await unduh(null, { periode: { from: F0, to: T0 }, filter: {} })).status === 401);\nif (tX) rec(\"akun tanpa izin Finance = 403 (TIDAK_BERHAK)\", (await unduh(tX, { periode: { from: F0, to: T0 }, filter: {} })).status === 403); else skip(\"akun tanpa izin Finance = 403\", \"tidak ada akun aktif tanpa izin finance:read\");\nif (tF) { const ex = await unduh(tF, { periode: { from: F0, to: T0 }, filter: {} }); rec(\"akun Finance non-Admin: 200 dan TANPA kolom sensitif (Catatan Internal, Rekening)\", ex.status === 200 && !!ex.wb && !sheet(ex.wb, \"Daftar Penjualan\").header.includes(\"Catatan Internal\") && !sheet(ex.wb, \"Pembayaran\").header.includes(\"Rekening\")); } else skip(\"akun Finance non-Admin tanpa kolom sensitif\", \"tidak ada akun aktif ber-izin finance:read tanpa finance:admin\");\nrec(\"status tidak valid = 400 FILTER_TIDAK_VALID (tidak menyentuh data)\", await (async () => { const r = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { status: \"APA_SAJA\" } }); return r.status === 400 && r.json?.code === \"FILTER_TIDAK_VALID\"; })());\nrec(\"periode tidak valid = 400\", (await unduh(tA, { periode: { from: \"2026-13-45\", to: T0 }, filter: {} })).status === 400);\n\nconst s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]);\nrec(\"TIDAK ada jejak tulis: dokumen, item, pembayaran (aktif/batal), nilai, jurnal, baris jurnal, order, stok sama persis sebelum vs sesudah smoke\", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(\",\") || \"identik\");\nrec(\"jurnal tidak seimbang (sebelum rilis: \" + B(\"BASE_TIDAK_SEIMBANG\") + \", tidak bertambah)\", (await hitung(\"select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x\")) <= B(\"BASE_TIDAK_SEIMBANG\"));\nrec(\"jumlah Order & Job tidak berkurang (sebelum: \" + B(\"ORDER_N\") + \" / \" + B(\"JOB_N\") + \")\", (await hitung('select count(*)::int n from \"Order\"')) >= B(\"ORDER_N\") && (await hitung(\"select count(*)::int n from jobs\")) >= B(\"JOB_N\"));\nawait prisma.$disconnect();\nconsole.log(\"\\nRINGKASAN smoke: \" + fail + \" gagal, \" + dilewati + \" dilewati (SKIP)\");\nconsole.log(\"SMOKE_HASIL fail=\" + fail + \" skip=\" + dilewati);\nprocess.exit(fail ? 1 : 0);\n"; // diganti generator dengan isi smoke-export-pkr.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji export PKR hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Export Excel Penjualan Karyawan": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Semua tulisan hanya di DB sementara ini: 524 dokumen uji (lebih dari batas 500 layar) + dokumen batal + pembayaran batal. Export tidak boleh mengubah apa pun; angka harus sama dengan hitungan langsung dan daftar layar.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4101); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const adm = info.find((x) => bisa(x.rs, P.FINANCE_ADMIN))?.u ?? await prisma.user.create({ data: { name: "REH Admin", email: `reh-adm-${stamp}@example.test`, passwordHash: "x", role: "ADMIN" } });
const fin = info.find((x) => bisa(x.rs, P.FINANCE_READ) && !bisa(x.rs, P.FINANCE_ADMIN))?.u ?? await prisma.user.create({ data: { name: "REH Finance", email: `reh-fin-${stamp}@example.test`, passwordHash: "x", role: "FINANCE" } });
const sls = info.find((x) => !bisa(x.rs, P.FINANCE_READ))?.u ?? await prisma.user.create({ data: { name: "REH Sales", email: `reh-sls-${stamp}@example.test`, passwordHash: "x", role: "SALES" } });
cek("akun uji tersedia: Finance Admin, Finance non-Admin, dan akun tanpa izin Finance", !!adm && !!fin && !!sls && adm.id !== fin.id && fin.id !== sls.id);
const tA = await token(adm); const tF = await token(fin); const tS = await token(sls);
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const unduh = async (tok, body) => { const r = await fetch(BASE + "/api/finance/export/penjualan-karyawan", { method: "POST", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) });
  const tipe = r.headers.get("content-type") || ""; if (!tipe.includes("spreadsheetml")) { let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, wb: null, json: j }; }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return { status: r.status, wb, json: null }; };
const sel = (c) => (c.value && typeof c.value === "object" && !(c.value instanceof Date) && "text" in c.value ? c.value.text : c.value);
const sheet = (wb, nama) => { const ws = wb.getWorksheet(nama); const header = []; ws.getRow(6).eachCell({ includeEmpty: false }, (c, i) => { header[i - 1] = sel(c); }); const baris = []; let total = null;
  for (let r = 7; r <= ws.rowCount; r++) { const row = ws.getRow(r); if (row.actualCellCount === 0) continue; const o = {}; header.forEach((h, i) => { o[h] = sel(row.getCell(i + 1)) ?? null; });
    if (typeof o[header[0]] === "string" && /^Tidak ada data sesuai/.test(o[header[0]])) continue; // pesan sheet kosong, bukan baris data
    if (typeof o[header[0]] === "string" && /^TOTAL/i.test(o[header[0]])) { total = o; break; } baris.push(o); } return { header, baris, total }; };
const layar = async (q) => { const r = await fetch(BASE + "/api/finance/penjualan-karyawan?" + new URLSearchParams(q).toString(), { headers: { Authorization: "Bearer " + tA } }); return { status: r.status, json: r.status === 200 ? await r.json() : null }; };
const jejak = async () => ({ dok: await num("select count(*)::int n from fin_penjualan_karyawan"), bayar: await num("select count(*)::int n from fin_penjualan_karyawan_payments"), jurnal: await num("select count(*)::int n from fin_journal_entries"), baris: await num("select count(*)::int n from fin_journal_lines") });
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

// ── A. data NYATA di salinan: export tidak menulis apa pun dan sama dengan layar
const j0 = await jejak();
const eksNyata = await unduh(tA, { periode: { from: "2025-01-01", to: "2026-12-31" }, filter: {} });
const dNyata = eksNyata.wb ? sheet(eksNyata.wb, "Daftar Penjualan") : { baris: [] };
cek(`export seluruh data nyata di salinan: 200 dan memuat ${j0.dok} dokumen (semua dokumen PKR yang ada)`, eksNyata.status === 200 && dNyata.baris.length === j0.dok, `${dNyata.baris.length}/${j0.dok}`);
cek("export pada data nyata tidak mengubah dokumen, pembayaran, atau jurnal", sama(await jejak(), j0));

// ── B. data uji (HANYA di salinan): 520 dokumen + P1 lunas + P2 sebagian (1 pembayaran batal) + P3 batal (pembayaran batal) + P4 karyawan lain + P5 September
const tag = `PKR-REH-${stamp}`; const D = (s) => new Date(`${s}T00:00:00.000Z`);
const s2 = await prisma.user.create({ data: { name: `REH Penjual B ${stamp}`, email: `reh-pb-${stamp}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
const ids = Array.from({ length: 520 }, () => crypto.randomUUID());
await prisma.finPenjualanKaryawan.createMany({ data: ids.map((id, i) => ({ id, nomor: `${tag}-M${String(i + 1).padStart(4, "0")}`, date: D("2026-10-05"), sellerId: adm.id, buyerName: `Pembeli Masal ${i + 1}`, total: 100, status: "AKTIF" })) });
await prisma.finPenjualanKaryawanItem.createMany({ data: ids.map((id) => ({ penjualanId: id, name: "Kasur Masal", quantity: 1, unitPrice: 100, sortOrder: 0 })) });
const doc = async (kode, date, seller, buyer, total, status = "AKTIF", payments = []) => { const id = crypto.randomUUID();
  await prisma.finPenjualanKaryawan.create({ data: { id, nomor: `${tag}-${kode}`, date: D(date), sellerId: seller.id, buyerName: buyer, total, status, ...(status === "DIBATALKAN" && { cancelledAt: new Date("2026-10-20T05:00:00Z"), cancelReason: "uji rehearsal" }), items: { create: [{ name: "Kasur Uji", quantity: 1, unitPrice: total, sortOrder: 0 }] } } });
  for (const p of payments) await prisma.finPenjualanKaryawanPayment.create({ data: { penjualanId: id, date: D(date), amount: p.amount, method: "TUNAI", ...(p.batal && { cancelledAt: new Date("2026-10-21T05:00:00Z"), cancelReason: "uji rehearsal" }) } }); return id; };
await doc("P1", "2026-10-10", adm, "Lunas Uji", 200, "AKTIF", [{ amount: 200 }]);
await doc("P2", "2026-10-11", adm, "Sebagian Uji", 300, "AKTIF", [{ amount: 100 }, { amount: 50, batal: true }]);
await doc("P3", "2026-10-12", adm, "Batal Uji", 400, "DIBATALKAN", [{ amount: 150, batal: true }]);
await doc("P4", "2026-10-13", s2, `Kerabat Cari ${stamp}`, 250);
await doc("P5", "2026-09-15", adm, "September Uji", 700);
const OKT = { from: "2026-10-01", to: "2026-10-31" };
const sc = await layar({ ...OKT, q: tag });
cek("layar memotong di 500 baris (524 dokumen uji) — pembanding", sc.status === 200 && sc.json.penjualan.length === 500 && sc.json.terpotong === true, sc.json ? `${sc.json.penjualan.length}/${sc.json.terpotong}` : sc.status);
const ex = await unduh(tA, { periode: OKT, filter: { q: tag } }); const d = ex.wb ? sheet(ex.wb, "Daftar Penjualan") : { baris: [], total: null, header: [] };
cek("export memuat SELURUH hasil filter: 524 dokumen uji periode Oktober (520 masal + P1..P4; P5 September tidak ikut) — lebih dari batas 500 layar", ex.status === 200 && d.baris.length === 524, d.baris.length);
const p3 = d.baris.find((b) => b["Nomor PKR"] === `${tag}-P3`);
cek("dokumen batal: status 'Dibatalkan — tidak ditagih', sisa Rp0, nilai historis Rp400 tetap", !!p3 && p3.Status === "Dibatalkan — tidak ditagih" && Number(p3["Sisa Ditagih (Rp)"]) === 0 && Number(p3["Nilai (Rp)"]) === 400, p3 ? p3.Status : "tidak ada");
cek("TOTAL aktif: 523 dari 524 dokumen; nilai tanpa dokumen batal (52.000 + 200 + 300 + 250); dibayar hanya pembayaran aktif (300)", !!d.total && /523 dari 524/.test(String(d.total["Nomor PKR"])) && Number(d.total["Nilai (Rp)"]) === 52750 && Number(d.total["Dibayar (Rp)"]) === 300, d.total ? JSON.stringify([d.total["Nomor PKR"], d.total["Nilai (Rp)"], d.total["Dibayar (Rp)"]]) : "tanpa total");
const by = ex.wb ? sheet(ex.wb, "Pembayaran") : { baris: [], total: null };
cek("sheet Pembayaran: 4 pembayaran, 2 berstatus Dibatalkan (50 dan 150) TIDAK masuk total aktif Rp300", by.baris.length === 4 && by.baris.filter((r) => r.Status === "Dibatalkan").length === 2 && !!by.total && Number(by.total["Nominal (Rp)"]) === 300, by.total ? by.total["Nominal (Rp)"] : "tanpa total");
let sk = 0; for (const p of sc.json?.penjualan ?? []) { const b = d.baris.find((r) => r["Nomor PKR"] === p.nomor); if (!b || r2(b["Nilai (Rp)"]) !== r2(p.total) || r2(b["Dibayar (Rp)"]) !== r2(p.terbayar) || r2(b["Sisa Ditagih (Rp)"]) !== r2(p.sisa)) sk++; }
cek("500 baris layar adalah himpunan bagian Excel dengan angka identik", sk === 0, sk ? `${sk} berbeda` : "identik");
for (const [nama, filter, harap] of [["status LUNAS", { status: "LUNAS" }, [`${tag}-P1`]], ["status SEBAGIAN", { status: "SEBAGIAN" }, [`${tag}-P2`]], ["status DIBATALKAN", { status: "DIBATALKAN" }, [`${tag}-P3`]], ["pencarian", { q: `Kerabat Cari ${stamp}` }, [`${tag}-P4`]], ["karyawan lain", { sellerId: s2.id, q: tag }, [`${tag}-P4`]]]) {
  const e = await unduh(tA, { periode: OKT, filter: { q: tag, ...filter } }); const baris = e.wb ? sheet(e.wb, "Daftar Penjualan").baris.map((b) => b["Nomor PKR"]) : [];
  cek(`filter ${nama}: tepat dokumen yang diharapkan`, e.status === 200 && JSON.stringify(baris.sort()) === JSON.stringify([...harap].sort()), baris.slice(0, 3).join(","));
}
const eS = await unduh(tA, { periode: { from: "2026-09-01", to: "2026-09-30" }, filter: { q: tag } }); cek("filter periode September: hanya P5", eS.status === 200 && JSON.stringify(sheet(eS.wb, "Daftar Penjualan").baris.map((b) => b["Nomor PKR"])) === JSON.stringify([`${tag}-P5`]));
const eK = await unduh(tA, { periode: OKT, filter: { sellerId: s2.id, q: tag } }); const kep = eK.wb ? JSON.stringify([1, 2, 3, 4].map((i) => sel(eK.wb.getWorksheet("Daftar Penjualan").getCell(`A${i}`)))) : "";
cek("label filter memakai NAMA karyawan, bukan id", eK.status === 200 && kep.includes(`REH Penjual B ${stamp}`) && !kep.includes(s2.id), kep.slice(0, 120));
const pk = eK.wb ? sheet(eK.wb, "Per Karyawan").baris.filter((b) => b["Penjualan Aktif"] != null) : [];
cek("sheet Per Karyawan mengikuti filter karyawan dan periode (aktif saja)", pk.length === 1 && Number(pk[0]["Nilai (Rp)"]) === 250, JSON.stringify(pk).slice(0, 120));
const adminKolom = d.header.includes("Catatan Internal"); const eF = await unduh(tF, { periode: OKT, filter: { q: tag } });
cek("izin: Finance Admin menerima Catatan Internal; Finance non-Admin 200 TANPA kolom sensitif; tanpa izin 403; tanpa token 401", adminKolom && eF.status === 200 && !sheet(eF.wb, "Daftar Penjualan").header.includes("Catatan Internal") && (await unduh(tS, { periode: OKT, filter: {} })).status === 403 && (await unduh(null, { periode: OKT, filter: {} })).status === 401);
cek("status tidak valid 400 FILTER_TIDAK_VALID", await (async () => { const r = await unduh(tA, { periode: OKT, filter: { status: "APA_SAJA" } }); return r.status === 400 && r.json?.code === "FILTER_TIDAK_VALID"; })());
const j1 = await jejak(); cek("setelah seluruh export: jumlah dokumen/pembayaran/jurnal hanya bertambah oleh data uji (jurnal dan baris jurnal TIDAK berubah)", j1.dok === j0.dok + 525 && j1.bayar === j0.bayar + 4 && j1.jurnal === j0.jurnal && j1.baris === j0.baris, JSON.stringify(j1));

// ── G. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_GANDA: "0", ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
# direktori sementara dibuat root oleh kontainer: dihapus lewat kontainer (rm biasa ditolak); kegagalan pembersihan tidak menggagalkan rilis
dcp "$NEW_DIR" run --rm --no-deps -T -v "$BK_DIR:/bk" backend sh -c 'rm -rf /bk/reh-data /bk/reh-uploads /bk/reh-dd' </dev/null >/dev/null 2>&1 || true
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; uji tulis data uji PKR dilakukan HANYA pada salinan restore lalu DB sementara dihapus"
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
COUNT_SQL="select 'penjualan_karyawan', count(*) from fin_penjualan_karyawan union all select 'pkr_items', count(*) from fin_penjualan_karyawan_items union all select 'pkr_payments', count(*) from fin_penjualan_karyawan_payments union all select 'journal_entries', count(*) from fin_journal_entries union all select 'journal_lines', count(*) from fin_journal_lines union all select 'orders', count(*) from \"Order\" union all select 'stock_movements', count(*) from stock_movements union all select 'materials', count(*) from materials"
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pra-switch.txt" || die "hitung baris pra-switch gagal"; ok "pra-switch: hitung baris dokumen PKR/item/pembayaran/jurnal/order/stok/material dicatat"
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
# hitung baris pasca-switch vs pra-switch (informasi: pengguna sungguhan bisa menulis selama jendela rilis; skrip ini sendiri tidak menulis apa pun)
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pasca-switch.txt" || die "hitung baris pasca-switch gagal"
if diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" >/dev/null; then ok "hitung baris dokumen PKR/item/pembayaran/jurnal/order/stok/material IDENTIK sebelum vs sesudah switch"; else warn "hitung baris berbeda sebelum vs sesudah switch (kemungkinan aktivitas pengguna sungguhan selama jendela rilis; skrip tidak menulis):"; diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" | sed 's/^/        /' || true; fi
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: export PKR (angka Excel = hitungan langsung dari tabel = daftar layar), filter, izin (401/403), tanpa transaksi percobaan; dokumen/pembayaran/jurnal identik"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup: Export Excel Penjualan Karyawan (PKR). Tidak ada tulisan dan tidak ada transaksi/dokumen percobaan. Setiap angka Excel dibandingkan dengan hitungan
// LANGSUNG dari tabel (bukan dari kode export) dan dengan daftar layar (GET /api/finance/penjualan-karyawan). Dokumen, pembayaran, dan jurnal harus identik sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const r2 = (x) => Math.round(Number(x) * 100) / 100;
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const finAdmin = info.find((x) => bisa(x.rs, P.FINANCE_ADMIN))?.u;
const finBiasa = info.find((x) => bisa(x.rs, P.FINANCE_READ) && !bisa(x.rs, P.FINANCE_ADMIN))?.u;
const tanpaIzin = info.find((x) => !bisa(x.rs, P.FINANCE_READ))?.u;
if (!finAdmin) { rec("akun Finance Admin (finance:admin) tersedia", false); process.exit(1); }
const tA = await tokenUntuk(finAdmin); const tF = finBiasa ? await tokenUntuk(finBiasa) : null; const tX = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;

const jejak = async () => ({
  dokumen: await hitung("select count(*)::int n from fin_penjualan_karyawan"), item: await hitung("select count(*)::int n from fin_penjualan_karyawan_items"), bayar: await hitung("select count(*)::int n from fin_penjualan_karyawan_payments"),
  batalDok: await hitung("select count(*)::int n from fin_penjualan_karyawan where status::text = 'DIBATALKAN'"), batalBayar: await hitung("select count(*)::int n from fin_penjualan_karyawan_payments where cancelled_at is not null"),
  nilai: String((await prisma.$queryRawUnsafe("select coalesce(sum(total),0)::text n from fin_penjualan_karyawan"))[0].n),
  jurnal: await hitung("select count(*)::int n from fin_journal_entries"), baris: await hitung("select count(*)::int n from fin_journal_lines"), order: await hitung('select count(*)::int n from "Order"'), stok: await hitung("select count(*)::int n from stock_movements"),
});
const s0 = await jejak();

const unduh = async (token, body) => {
  const r = await fetch(BASE + "/api/finance/export/penjualan-karyawan", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
  const tipe = r.headers.get("content-type") || ""; if (!tipe.includes("spreadsheetml")) { let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, wb: null, json: j }; }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return { status: r.status, wb, json: null };
};
const sel = (c) => (c.value && typeof c.value === "object" && !(c.value instanceof Date) && "text" in c.value ? c.value.text : c.value);
const sheet = (wb, nama) => { const ws = wb.getWorksheet(nama); if (!ws) return { header: [], baris: [], total: null, ada: false };
  const header = []; ws.getRow(6).eachCell({ includeEmpty: false }, (c, i) => { header[i - 1] = sel(c); }); const baris = []; let total = null;
  for (let r = 7; r <= ws.rowCount; r++) { const row = ws.getRow(r); if (row.actualCellCount === 0) continue; const o = {}; header.forEach((h, i) => { o[h] = sel(row.getCell(i + 1)) ?? null; });
    if (typeof o[header[0]] === "string" && /^Tidak ada data sesuai/.test(o[header[0]])) continue; // pesan sheet kosong, bukan baris data
    if (typeof o[header[0]] === "string" && /^TOTAL/i.test(o[header[0]])) { total = o; break; } baris.push(o); }
  return { header, baris, total, ada: true }; };
const num = (v) => Number(v ?? 0);
const layar = async (q) => { const r = await fetch(BASE + "/api/finance/penjualan-karyawan?" + new URLSearchParams(q).toString(), { headers: { Authorization: "Bearer " + tA } }); return { status: r.status, json: r.status === 200 ? await r.json() : null }; };

// ── sumber kebenaran LANGSUNG dari tabel untuk satu periode
const dariTabel = async (from, to) => {
  const dok = await prisma.$queryRawUnsafe("select p.id::text id, p.nomor, p.status::text status, p.total::float8 total from fin_penjualan_karyawan p where p.date between $1::date and $2::date order by p.nomor", from, to);
  const bayar = await prisma.$queryRawUnsafe("select y.penjualan_id::text pid, y.amount::float8 amount, (y.cancelled_at is not null) batal from fin_penjualan_karyawan_payments y join fin_penjualan_karyawan p on p.id = y.penjualan_id where p.date between $1::date and $2::date", from, to);
  const aktifPer = new Map(); for (const y of bayar) if (!y.batal) aktifPer.set(y.pid, r2((aktifPer.get(y.pid) ?? 0) + y.amount));
  const baris = dok.map((d) => { const aktif = d.status === "AKTIF"; const terbayar = aktif ? (aktifPer.get(d.id) ?? 0) : 0; return { nomor: d.nomor, aktif, total: r2(d.total), terbayar: r2(terbayar), sisa: aktif ? r2(d.total - terbayar) : 0 }; });
  return { baris, nBayar: bayar.length, bayarAktif: r2(bayar.filter((y) => !y.batal).reduce((s, y) => s + y.amount, 0)), nBayarAktif: bayar.filter((y) => !y.batal).length };
};
const PERIODES = [["2025-01-01", "2026-12-31", "seluruh periode data"], ["2026-10-01", "2026-10-31", "Oktober 2026"]];
for (const [from, to, nama] of PERIODES) {
  const t = await dariTabel(from, to); const ex = await unduh(tA, { periode: { from, to }, filter: {} });
  rec(`export PKR ${nama}: 200 dan berkas .xlsx`, ex.status === 200 && !!ex.wb, ex.status);
  if (!ex.wb) continue;
  const d = sheet(ex.wb, "Daftar Penjualan");
  rec(`${nama}: sheet Daftar memuat SEMUA ${t.baris.length} dokumen periode (hitungan langsung dari tabel), tanpa batas 500 layar`, d.baris.length === t.baris.length, `${d.baris.length} vs ${t.baris.length}`);
  let beda = 0; for (const x of t.baris) { const b = d.baris.find((r) => r["Nomor PKR"] === x.nomor); if (!b || r2(num(b["Nilai (Rp)"])) !== x.total || r2(num(b["Dibayar (Rp)"])) !== x.terbayar || r2(num(b["Sisa Ditagih (Rp)"])) !== x.sisa) beda++;
    else if (!x.aktif && b.Status !== "Dibatalkan — tidak ditagih") beda++; else if (x.aktif && !["Lunas", "Dibayar sebagian", "Belum dibayar"].includes(b.Status)) beda++; }
  rec(`${nama}: setiap dokumen (nilai, dibayar, sisa, status) sama dengan hitungan langsung dari tabel; dokumen batal = "Dibatalkan — tidak ditagih" dengan sisa Rp0`, beda === 0, beda ? `${beda} dokumen berbeda` : "identik");
  const aktif = t.baris.filter((x) => x.aktif);
  rec(`${nama}: baris TOTAL hanya dokumen aktif (nilai, dibayar, sisa)`, !!d.total && r2(num(d.total["Nilai (Rp)"])) === r2(aktif.reduce((s, x) => s + x.total, 0)) && r2(num(d.total["Dibayar (Rp)"])) === r2(aktif.reduce((s, x) => s + x.terbayar, 0)) && r2(num(d.total["Sisa Ditagih (Rp)"])) === r2(aktif.reduce((s, x) => s + x.sisa, 0)), d.total ? String(d.total["Nomor PKR"]) : "tanpa baris total");
  const y = sheet(ex.wb, "Pembayaran");
  rec(`${nama}: sheet Pembayaran memuat semua pembayaran (${t.nBayar}), pembayaran batal berstatus Dibatalkan dan TIDAK masuk total aktif (${t.nBayarAktif} pembayaran, Rp${t.bayarAktif})`, y.baris.length === t.nBayar && y.baris.filter((r) => r.Status === "Aktif").length === t.nBayarAktif && (t.nBayar === 0 || (!!y.total && r2(num(y.total["Nominal (Rp)"])) === t.bayarAktif)), `${y.baris.length}/${t.nBayar}`);
  rec(`${nama}: kolom sensitif (Catatan Internal, Rekening) hadir untuk Finance Admin`, d.header.includes("Catatan Internal") && y.header.includes("Rekening"));
  rec(`${nama}: sheet Per Karyawan ada`, sheet(ex.wb, "Per Karyawan").ada);
  const sc = await layar({ from, to }); rec(`${nama}: daftar layar 200`, sc.status === 200);
  if (sc.json) { let sk = 0; for (const p of sc.json.penjualan) { const b = d.baris.find((r) => r["Nomor PKR"] === p.nomor); if (!b || r2(num(b["Nilai (Rp)"])) !== r2(p.total) || r2(num(b["Dibayar (Rp)"])) !== r2(p.terbayar) || r2(num(b["Sisa Ditagih (Rp)"])) !== r2(p.sisa)) sk++; }
    rec(`${nama}: angka Excel sama dengan daftar layar untuk ${sc.json.penjualan.length} dokumen yang tampil di layar`, sk === 0, sk ? `${sk} berbeda` : "identik"); }
}

// ── filter status/pencarian/karyawan: hasil Excel = hasil layar. PEMBANDING SAH hanya bila seluruh data < 500 dokumen: layar memotong 500 baris TERBARU lebih dulu, baru menyaring status turunan (Lunas/Sebagian/Belum),
// sehingga pada data lebih besar layar menampilkan lebih sedikit dari hasil sebenarnya (Excel memuat semuanya).
const layarSah = (await hitung("select count(*)::int n from fin_penjualan_karyawan")) < 500;
const [F0, T0] = ["2025-01-01", "2026-12-31"];
for (const st of ["LUNAS", "SEBAGIAN", "BELUM_BAYAR", "DIBATALKAN"]) {
  const ex = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { status: st } }); const sc = await layar({ from: F0, to: T0, status: st });
  const n = ex.wb ? sheet(ex.wb, "Daftar Penjualan").baris.length : -1;
  if (layarSah && sc.json) rec(`filter status ${st}: jumlah dokumen Excel = layar`, ex.status === 200 && n === sc.json.penjualan.length, `${n} vs ${sc.json.penjualan.length}`); else skip(`filter status ${st}`, "data lebih dari 500 dokumen: layar memotong sebelum menyaring status, bukan pembanding sah (Excel memuat semuanya)");
}
const contoh = (await prisma.$queryRawUnsafe("select nomor, buyer_name, seller_id from fin_penjualan_karyawan order by nomor limit 1"))[0];
if (contoh && layarSah) {
  const kata = String(contoh.buyer_name).split(/\s+/)[0]; const ex = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { q: kata } }); const sc = await layar({ from: F0, to: T0, q: kata });
  rec(`filter pencarian "${kata}": jumlah dokumen Excel = layar`, ex.status === 200 && !!sc.json && sheet(ex.wb, "Daftar Penjualan").baris.length === sc.json.penjualan.length, ex.status);
  const exK = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { sellerId: contoh.seller_id } }); const scK = await layar({ from: F0, to: T0, sellerId: contoh.seller_id });
  rec("filter karyawan: jumlah dokumen Excel = layar dan label filter memakai NAMA (bukan id)", exK.status === 200 && !!scK.json && sheet(exK.wb, "Daftar Penjualan").baris.length === scK.json.penjualan.length && !JSON.stringify(sheet(exK.wb, "Daftar Penjualan")).includes(contoh.seller_id) && JSON.stringify([1, 2, 3, 4].map((i) => sel(exK.wb.getWorksheet("Daftar Penjualan").getCell(`A${i}`)))).includes("Karyawan: "), exK.status);
} else skip("filter pencarian/karyawan dibanding layar", contoh ? "data lebih dari 500 dokumen: layar terpotong, bukan pembanding sah" : "tidak ada dokumen PKR");

// ── izin & penolakan sebelum menyentuh data
rec("tanpa token = 401", (await unduh(null, { periode: { from: F0, to: T0 }, filter: {} })).status === 401);
if (tX) rec("akun tanpa izin Finance = 403 (TIDAK_BERHAK)", (await unduh(tX, { periode: { from: F0, to: T0 }, filter: {} })).status === 403); else skip("akun tanpa izin Finance = 403", "tidak ada akun aktif tanpa izin finance:read");
if (tF) { const ex = await unduh(tF, { periode: { from: F0, to: T0 }, filter: {} }); rec("akun Finance non-Admin: 200 dan TANPA kolom sensitif (Catatan Internal, Rekening)", ex.status === 200 && !!ex.wb && !sheet(ex.wb, "Daftar Penjualan").header.includes("Catatan Internal") && !sheet(ex.wb, "Pembayaran").header.includes("Rekening")); } else skip("akun Finance non-Admin tanpa kolom sensitif", "tidak ada akun aktif ber-izin finance:read tanpa finance:admin");
rec("status tidak valid = 400 FILTER_TIDAK_VALID (tidak menyentuh data)", await (async () => { const r = await unduh(tA, { periode: { from: F0, to: T0 }, filter: { status: "APA_SAJA" } }); return r.status === 400 && r.json?.code === "FILTER_TIDAK_VALID"; })());
rec("periode tidak valid = 400", (await unduh(tA, { periode: { from: "2026-13-45", to: T0 }, filter: {} })).status === 400);

const s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]);
rec("TIDAK ada jejak tulis: dokumen, item, pembayaran (aktif/batal), nilai, jurnal, baris jurnal, order, stok sama persis sebelum vs sesudah smoke", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "identik");
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
  ok "smoke test lulus (export PKR sama dengan tabel dan layar, filter, izin, penolakan sebelum menyentuh data, tanpa jejak tulis, invarian)"
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
PHASE="9-pembersihan"; say "9. Pembersihan release lama DINONAKTIFKAN (instruksi Owner: folder hotfix dan release lama TIDAK dihapus)"
ok "tidak ada folder release/image/backup/volume yang dihapus oleh skrip ini; disk: $(df -h "$HOME" | awk 'NR==2{print $4" bebas"}')"
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
say "CATATAN: Rilis ini membawa Export Excel Penjualan Karyawan (periode, status, pencarian, karyawan; seluruh hasil filter; total hanya dokumen aktif; batal dipisah). TANPA migrasi. Rilis TIDAK membuat atau mengubah dokumen PKR, pembayaran, jurnal, order, atau stok; export hanya membaca."
