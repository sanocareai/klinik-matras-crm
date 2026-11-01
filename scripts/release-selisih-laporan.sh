#!/usr/bin/env bash
# RILIS "AUDIT SELISIH LAPORAN" (Finance > Pemasukan, Laporan Sales/Ringkasan, Export Excel, Rekonsiliasi Sales-Finance): WEB + BACKEND, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • Export Excel Pemasukan: kolom "Nilai (Rp)" historis dipertahankan; ditambah "Dihitung ke Total?", "Nilai yang Dihitung (Rp)", "Alasan Tidak Dihitung". SUM kolom baru = TOTAL = angka layar. Baris Dikecualikan, Ditolak, Dibatalkan, dan arsip historis
#     yang tidak dihitung tetap tampil dengan alasan per baris (pembayaran pengganti ditautkan). Layar Pemasukan menampilkan "total dihitung" dan jumlah baris tidak dihitung.
#   • Rekonsiliasi Sales-Finance: jembatan KOHORT baru (Sudah Lunas order dibuat di periode -> Total Perusahaan lunas di periode) sampai nomor order, dokumen pembayaran (ID, tanggal WIB, rekening, nomor jurnal), alasan pengecualian lunas
#     (aktif atau sudah dicabut), dan order Penjualan Karyawan dikecualikan dari himpunan lunas-periode (sama dengan kartu Sales). Label/tooltip kartu Sales dan Ringkasan menyebut basis tanggal dan cakupan.
#   • Rilis ini TIDAK membuat atau mengubah payments, verifikasi, order, jurnal, refund, nota kredit, atau pengecualian lunas; smoke pasca-switch hanya membaca (GET dan POST export) dan tidak membuat data percobaan.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore memakai data produksi nyata Agustus-Oktober 2026: parity layar = API = Excel = SQL, tanpa jejak tulis);
#     build web di release dir; switch SATU kali; verifikasi; smoke baca-saja pasca-switch (angka API = hitungan langsung dari tabel; izin 401/403; data identik sebelum vs sesudah).
#   • BASELINE = release aktif. GERBANG IDENTITAS KODE LIVE membandingkan ISI kode (hash blob SEMUA berkas terlacak baseline, berkas tambahan, identitas proses) di fase 2, fase 6, dan TEPAT sebelum switch; selisih isi apa pun /
#     berkas tambahan / proses berganti = berhenti sebelum switch. Pembersihan release lama (fase 9) DINONAKTIFKAN: tidak ada folder release/image rollback/backup/volume yang dihapus oleh skrip.
#
#   cat scripts/release-selisih-laporan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/sel.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/sel.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/sel.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/selr.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/sel.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/sel.out 2>&1 < /dev/null &'   # rilis penuh
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru). Rollback hanya mengembalikan kolom/label/jembatan lama; tidak ada data yang berubah.
# (dibangkitkan oleh scripts/gen-release-selisih-laporan.cjs dari scripts/release-penjadwalan-langsung.sh + scripts/templates/release-selisih-laporan/* + pustaka scripts/lib/{rehearsal,smoke}-selisih-laporan.mjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/audit-selisih-laporan-okt-on-a0dbe2fb}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/src/services/finance/export/pemasukan\.js|backend/src/services/finance/export/rekon-sales-finance\.js|backend/src/services/finance/kontrakMetrik\.js|backend/src/services/finance/pemasukan\.js|backend/src/services/finance/rekonSalesFinance\.js|backend/tests/integration/financeExportPemasukan\.integration\.test\.js|backend/tests/integration/rekonSalesFinance\.integration\.test\.js|backend/tests/releaseSelisihLaporan\.test\.js|docs/AUDIT-SELISIH-LAPORAN-OKT-2026\.md|docs/FINANCE-KONTRAK-METRIK\.md|frontend/src/features/laporan/components/RekonSalesFinance\.jsx|frontend/src/features/laporan/components/RingkasanTab\.jsx|frontend/src/features/laporan/components/SalesReportTab\.jsx|frontend/src/pages/finance/FinancePemasukan\.jsx|frontend/tests/laporanRedesignRekon\.test\.js|frontend/tests/rekonSalesFinanceUi\.test\.js|scripts/gen-release-selisih-laporan\.cjs|scripts/lib/rehearsal-selisih-laporan\.mjs|scripts/lib/smoke-selisih-laporan\.mjs|scripts/release-selisih-laporan\.sh|scripts/templates/release-selisih-laporan/header\.txt|scripts/templates/release-selisih-laporan/rollback\.txt)$'
BACKEND_SRC_EXPECT="backend/src/services/finance/export/pemasukan.js backend/src/services/finance/export/rekon-sales-finance.js backend/src/services/finance/kontrakMetrik.js backend/src/services/finance/pemasukan.js backend/src/services/finance/rekonSalesFinance.js"
FRONTEND_SRC_EXPECT="frontend/src/features/laporan/components/RekonSalesFinance.jsx frontend/src/features/laporan/components/RingkasanTab.jsx frontend/src/features/laporan/components/SalesReportTab.jsx frontend/src/pages/finance/FinancePemasukan.jsx"
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
BK_DIR="$HOME/release-backups/selisih-laporan-${DEPLOY_SHORT}-${TS}"
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
Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama kembali ke Excel Pemasukan tanpa kolom "Dihitung ke Total?" dan rekonsiliasi tanpa jembatan kohort; angka Sales/Finance di database tidak berubah.
Payments, verifikasi, order, jurnal, refund, nota kredit, dan pengecualian lunas tidak disentuh oleh rilis ini: tidak ada yang perlu dibalik.
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
exec 9>/tmp/release-selisih-laporan.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "sel\|release-selisih-laporan\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
    [ -e "$lf" ] || continue; [ "$lf" = "/tmp/release-selisih-laporan.lock" ] && continue
    ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain mulai berjalan (kunci ${lf} dipegang) — berhenti sebelum switch"
  done
  OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "sel\|release-selisih-laporan\|pgrep\|node src/index.js" | grep -v "$$" || true)"
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
BACKUP_FILE="$HOME/backups/pre-selisih-laporan-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Jembatan kohort" "BASIS: tanggal order DIBUAT" "BASIS: tanggal order MENJADI LUNAS" "perlu_verifikasi_finance"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; [ -z "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks fitur baru '${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done
for s2 in "crm-rk-alur" "rekon-tahap-tombol" "crm-pl-posisi" "bottleneck-info" "Rasio antar tahap" "crm-pt-tabel" "Tindakan lainnya" "Perkiraan biaya penanganan" "Penyebab masalah" "Solusi yang disepakati" "pkr_nilai_penjualan" "pkr_sisa_ditagih" "Ada stok" "Stok belum diketahui" "Nol menurut pergerakan" "Saldo minus" "Koreksi saldo" "Ubah harga" "Pilih meja" "Pilih semua unit order ini" "Belum dijadwalkan" "Riwayat dan dokumen pemakaian" "Tanpa pengeluaran stok" "Mengurangi stok" "Beranda Gudang" "Pengeluaran Material" "Konfirmasi Barang Jadi" "Perlu keputusan Anda" "Varian serupa yang sudah ada" "Batalkan barang baru ini" "Ubah barang baru" "Biaya dicatat saat disetujui" "Ajukan kebutuhan divisi dan pantau prosesnya" "Panduan pengajuan" "Persetujuan dan pembayaran dilakukan melalui" "Tambah pemakaian" "Ganti bahan" "Ajukan perubahan" "Lihat dampak" "Konfirmasi & kurangi stok" "Harga Berlaku (HPP operasional)" "Bahan belum tercatat" "Detail teknis" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-sel-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
[ "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"
ok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR}: memuat hotfix performa (kode container == folder == baseline disetujui, terbukti gerbang kode live)"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_sel_${TS}"
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
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): Audit selisih laporan Pemasukan/Rekonsiliasi Sales-Finance/Excel pada data produksi nyata Agustus-Oktober 2026 (parity layar = API = Excel = SQL, jembatan kohort menutup persis, alasan per baris, pembayaran dibatalkan/ditolak tidak dihitung, izin, tanpa jejak tulis pada payments/order/jurnal/refund/nota kredit/pengecualian lunas) pada salinan; tidak ada data uji.
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji audit selisih laporan terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "import { createRequire } from \"node:module\";\nimport { pathToFileURL } from \"node:url\";\nimport path from \"node:path\";\nconst require = createRequire(process.cwd() + \"/\");\nconst jwt = require(\"jsonwebtoken\");\nconst ExcelJS = require(\"exceljs\");\nconst { PrismaClient } = require(\"@prisma/client\");\nconst prisma = new PrismaClient();\nconst BASE = process.env.SMOKE_BASE ?? \"http://127.0.0.1:4000\"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)\nconst APP = process.env.APP_DIR ?? \"/app\";\nconst FROM = process.env.SMOKE_FROM ?? \"2026-10-01\"; const TO = process.env.SMOKE_TO ?? \"2026-10-31\";\nlet fail = 0; let dilewati = 0;\nconst rec = (n, ok, d = \"\") => { if (!ok) fail++; console.log(`  ${ok ? \"PASS\" : \"FAIL\"}  ${n}${d ? \" — \" + String(d).slice(0, 240) : \"\"}`); };\nconst skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };\n// SMOKE BACA-SAJA terhadap production hidup: parity layar–API–Excel–tabel untuk Pemasukan (Uang Masuk) dan Rekonsiliasi Sales–Finance, periode FROM..TO (WIB).\n// Setiap angka API dibandingkan dengan hitungan LANGSUNG dari tabel (SQL), bukan dari kode rute. Tidak ada tulisan dan tidak ada data percobaan.\nconst { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, \"src/constants/permissions.js\")).href);\nconst rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);\nconst bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));\nconst tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: \"10m\" });\nconst hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);\nconst B = (k) => Number(process.env[k]);\nconst users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: \"asc\" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });\nconst pembaca = info.find((x) => bisa(x.rs, P.FINANCE_READ) && x.rs.has(\"ADMIN\"))?.u ?? info.find((x) => bisa(x.rs, P.FINANCE_READ))?.u;\nconst tanpaIzin = info.find((x) => !bisa(x.rs, P.FINANCE_READ) && !x.rs.has(\"ADMIN\") && !x.rs.has(\"SALES\"))?.u;\nif (!pembaca) { rec(\"akun dengan izin finance:read tersedia\", false); process.exit(1); }\nconst tok = await tokenUntuk(pembaca); const tokX = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;\nconst get = async (url, token = tok) => { const r = await fetch(BASE + url, { headers: token ? { Authorization: \"Bearer \" + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };\nconst unduh = async (modul, body, token = tok) => { const r = await fetch(`${BASE}/api/finance/export/${modul}`, { method: \"POST\", headers: { \"Content-Type\": \"application/json\", ...(token ? { Authorization: \"Bearer \" + token } : {}) }, body: JSON.stringify(body) });\n  if (!(r.headers.get(\"content-type\") || \"\").includes(\"spreadsheetml\")) { let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, wb: null, json: j }; }\n  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return { status: r.status, wb, json: null }; };\nconst nilaiSel = (c) => (c.value && typeof c.value === \"object\" && !(c.value instanceof Date) && \"text\" in c.value ? c.value.text : c.value);\nconst bacaSheet = (wb, nama) => { const ws = wb.getWorksheet(nama); const header = []; ws.getRow(6).eachCell({ includeEmpty: false }, (c, i) => { header[i - 1] = nilaiSel(c); }); const baris = []; let total = null;\n  for (let r = 7; r <= ws.rowCount; r++) { const row = ws.getRow(r); if (row.actualCellCount === 0) continue; if (nilaiSel(row.getCell(1)) === \"Tidak ada data sesuai periode dan filter\") continue; const o = {}; header.forEach((h, i) => { o[h] = nilaiSel(row.getCell(i + 1)) ?? null; }); const p = o[header[0]]; if (typeof p === \"string\" && /^TOTAL/i.test(p)) { total = o; break; } baris.push(o); }\n  return { header, baris, total }; };\n\nconst JEJAK = [[\"payments\", \"select count(*)::int n from payments\"], [\"verifikasi\", \"select count(*)::int n from payment_verifications\"], [\"order\", 'select count(*)::int n from \"Order\"'], [\"jurnal\", \"select count(*)::int n from fin_journal_entries\"],\n  [\"baris_jurnal\", \"select count(*)::int n from fin_journal_lines\"], [\"refund\", \"select count(*)::int n from fin_refunds\"], [\"nota_kredit\", \"select count(*)::int n from fin_order_credits\"], [\"pengecualian_lunas\", \"select count(*)::int n from order_paid_at_pengecualian\"]];\nconst jejak = async () => Object.fromEntries(await Promise.all(JEJAK.map(async ([k, q]) => [k, await hitung(q)])));\nconst s0 = await jejak();\n\n// batas periode WIB: awal hari inklusif, awal hari berikutnya eksklusif (UTC = WIB − 7 jam)\nconst mulai = new Date(`${FROM}T00:00:00+07:00`); const selesai = new Date(new Date(`${TO}T00:00:00+07:00`).getTime() + 86400000);\nconst NET = \"GREATEST(0, o.value - COALESCE((SELECT SUM(k.amount) FROM fin_order_credits k WHERE k.order_id = o.id AND k.status = 'AKTIF'), 0))\";\nconst sqlMasuk = await hitung(`select coalesce(sum(p.amount),0)::bigint n from payments p where p.cancelled_at is null and p.created_at >= $1 and p.created_at < $2 and exists (select 1 from payment_verifications v where v.payment_id = p.id)`, mulai, selesai);\nconst sqlLunas = await hitung(`select coalesce(sum(${NET}),0)::bigint n from \"Order\" o join \"Customer\" c on c.id = o.\"customerId\" where o.paid_at >= $1 and o.paid_at < $2 and o.status::text not in ('CANCELLED','PENDING') and c.\"pipelineStage\"::text <> 'SPAM' and o.penjualan_karyawan_id is null`, mulai, selesai);\nconst sqlKohort = await hitung(`select coalesce(sum(${NET}),0)::bigint n from \"Order\" o join \"Customer\" c on c.id = o.\"customerId\" where o.\"createdAt\" >= $1 and o.\"createdAt\" < $2 and o.status::text not in ('CANCELLED','PENDING') and o.\"paymentStatus\"::text = 'LUNAS' and c.\"pipelineStage\"::text <> 'SPAM' and o.penjualan_karyawan_id is null`, mulai, selesai);\nconst sqlTdkHitung = await hitung(`select count(*)::int n from payments p where p.created_at >= $1 and p.created_at < $2 and p.cancelled_at is not null`, mulai, selesai);\nconsole.log(`  (periode ${FROM}..${TO}: uang masuk terverifikasi ${sqlMasuk}; nilai lunas periode ${sqlLunas}; kohort dibuat-lunas ${sqlKohort}; pembayaran batal/tolak ${sqlTdkHitung})`);\n\n// ── Rekonsiliasi Sales–Finance\nconst rk = await get(`/api/sales-finance/rekon?from=${FROM}&to=${TO}`);\nrec(\"GET /sales-finance/rekon: 200 dan status perhitungan COCOK (semua residual Rp0)\", rk.status === 200 && rk.json?.status?.perhitungan === \"COCOK\" && rk.json?.residual === 0 && rk.json?.tahap1?.residual === 0 && rk.json?.tahap2?.residual === 0 && rk.json?.kohort?.residual === 0, rk.status === 200 ? JSON.stringify([rk.json.residual, rk.json.tahap1?.residual, rk.json.tahap2?.residual, rk.json.kohort?.residual]) : rk.status);\nif (rk.json) {\n  rec(\"Uang Masuk Terverifikasi (API) = Σ payments aktif terverifikasi di periode (SQL langsung)\", rk.json.kartu.uangMasukDariOrder === sqlMasuk, `${rk.json.kartu.uangMasukDariOrder} vs ${sqlMasuk}`);\n  rec(\"Total Perusahaan (API) = Σ nilai bersih order lunas di periode, tanpa PKR (SQL langsung)\", rk.json.kartu.totalPerusahaan === sqlLunas, `${rk.json.kartu.totalPerusahaan} vs ${sqlLunas}`);\n  rec(\"Sudah Lunas kohort dibuat (API) = Σ nilai bersih order dibuat di periode & Lunas (SQL langsung)\", rk.json.kartu.sudahLunasKohortDibuat === sqlKohort, `${rk.json.kartu.sudahLunasKohortDibuat} vs ${sqlKohort}`);\n  const g = (k) => rk.json.bridge.find((b) => b.kunci === k)?.jumlah ?? 0;\n  const jembatan = g(\"UANG_MASUK\") - g(\"DP_BELUM_LUNAS\") - g(\"ORDER_TIDAK_DIHITUNG\") - g(\"LUNAS_PERIODE_LAIN\") - g(\"REFUND_NON_LUNAS\") + g(\"DP_SEBELUMNYA\") - g(\"REFUND_LUNAS\") - g(\"ONGKIR\") - g(\"KLAIM_TANPA_PAYMENT\") - g(\"PAYMENT_MENUNGGU\") - g(\"PAYMENT_KURANG\") - g(\"KELEBIHAN_BAYAR\") - g(\"SELISIH_LAIN\");\n  rec(\"jembatan tahap 1 menutup persis: Uang Masuk − komponen = Total Perusahaan\", jembatan === rk.json.kartu.totalPerusahaan, `${jembatan} vs ${rk.json.kartu.totalPerusahaan}`);\n  const k = rk.json.kohort; const gk = (kunci) => k.langkah.find((b) => b.kunci === kunci)?.jumlah ?? 0;\n  rec(\"jembatan kohort menutup persis: Sudah Lunas − di luar + dibuat sebelum + bukan-lunas = Total Perusahaan\", gk(\"KOHORT_DIBUAT_LUNAS\") - gk(\"KOHORT_LUNAS_DI_LUAR\") + gk(\"KOHORT_DIBUAT_SEBELUM\") + gk(\"KOHORT_BELUM_LUNAS_PAIDAT\") === rk.json.kartu.totalPerusahaan);\n  if (rk.json.detailTersedia) {\n    const tanpaAlasan = Object.entries(rk.json.detail).filter(([kunci]) => [\"LUNAS_PERIODE_LAIN\", \"KOHORT_LUNAS_DI_LUAR\", \"KOHORT_DIBUAT_SEBELUM\", \"KOHORT_BELUM_LUNAS_PAIDAT\"].includes(kunci)).flatMap(([kunci, arr]) => arr.filter((o) => !o.alasan).map((o) => `${kunci}:${o.nomor}`));\n    rec(\"setiap order di jembatan lintas-periode/kohort membawa alasan tertulis dan nomor order\", tanpaAlasan.length === 0, tanpaAlasan.slice(0, 5).join(\",\"));\n    const payTanpaDok = Object.values(rk.json.detail).flat().flatMap((o) => o.pembayaran ?? []).filter((p) => !p.ref || p.tanggalWib === undefined);\n    rec(\"setiap pembayaran di rincian membawa ID dokumen (ref) dan tanggal WIB\", payTanpaDok.length === 0, payTanpaDok.length);\n    rec(\"Σ detail UANG_MASUK = kartu uang masuk (daftar order = angka)\", rk.json.detail.UANG_MASUK.reduce((a, o) => a + o.jumlah, 0) === rk.json.kartu.uangMasukDariOrder);\n  }\n}\n\n// ── Pemasukan (Uang Masuk): layar = SQL = Excel\nconst halaman = []; let page = 1; let totalNilai = null; let totalTidak = null; let totalBaris = null;\nfor (let h = 0; h < 40; h++) { const r = await get(`/api/finance/pemasukan?from=${FROM}&to=${TO}&kategori=PEMBAYARAN&limit=100&page=${page}`); if (r.status !== 200) { rec(\"GET /finance/pemasukan?kategori=PEMBAYARAN 200\", false, r.status); break; } halaman.push(...r.json.items); totalNilai = r.json.totalNilai; totalTidak = r.json.totalTidakDihitung; totalBaris = r.json.total; if (!r.json.adaLagi) break; page += 1; }\nrec(\"total layar Uang Masuk = Σ payments terverifikasi (SQL langsung)\", Number(totalNilai) === sqlMasuk, `${totalNilai} vs ${sqlMasuk}`);\nrec(\"jumlah baris layar = semua payment tercatat di periode (terverifikasi + menunggu + ditolak + dibatalkan); tidak ada baris hilang\", halaman.length === totalBaris && halaman.length === await hitung(\"select count(*)::int n from payments p where p.created_at >= $1 and p.created_at < $2\", mulai, selesai), `${halaman.length}/${totalBaris}`);\nconst sumDihitung = halaman.reduce((a, b) => a + Number(b.nilaiDihitung), 0);\nrec(\"Σ nilaiDihitung baris = total layar (satu aturan 'dihitung ke total')\", Math.round(sumDihitung * 100) === Math.round(Number(totalNilai) * 100), `${sumDihitung} vs ${totalNilai}`);\nconst tidakDihitung = halaman.filter((b) => b.dihitung === false);\nrec(\"setiap baris yang tidak dihitung membawa alasan tertulis; baris dihitung tanpa alasan\", tidakDihitung.every((b) => b.alasanTidakDihitung && Number(b.nilaiDihitung) === 0) && halaman.filter((b) => b.dihitung).every((b) => !b.alasanTidakDihitung && b.nilaiDihitung === b.nilai), `${tidakDihitung.length} tidak dihitung`);\nrec(\"jumlah & nilai 'tidak dihitung' di respons = Σ baris tidak dihitung\", totalTidak?.jumlah === tidakDihitung.length && Math.round(Number(totalTidak?.nilai) * 100) === Math.round(tidakDihitung.reduce((a, b) => a + Number(b.nilai), 0) * 100));\n// Tautan pengganti: tiap baris dibatalkan/ditolak yang order-nya masih punya pembayaran AKTIF harus menunjuk pembayaran aktif pada order yang SAMA; tanpa pembayaran aktif → tidak ada tautan.\nconst dibatalLayar = tidakDihitung.filter((b) => b.sub === \"PEMBAYARAN_TIDAK_DIHITUNG\");\nlet salahTaut = 0;\nfor (const b of dibatalLayar) {\n  const aktif = await prisma.$queryRawUnsafe(\"select p.id::text i from payments p where p.order_id = (select order_id from payments where id = $1::uuid) and p.cancelled_at is null\", b.id);\n  const ids = new Set(aktif.map((x) => x.i));\n  if (ids.size === 0 ? b.pengganti !== null : !(b.pengganti && ids.has(b.pengganti.id) && b.alasanTidakDihitung.includes(String(b.pengganti.id).slice(0, 8)))) salahTaut++;\n}\nrec(\"setiap pembayaran dibatalkan/ditolak menautkan pembayaran AKTIF pada order yang sama (atau tidak ada tautan bila order tak punya pembayaran aktif), id pengganti tercantum di alasan\", salahTaut === 0, salahTaut + \" salah\");\nfor (const b of dibatalLayar) console.log(\"  SNAPSHOT_TIDAK_DIHITUNG \" + [b.id.slice(0, 8), b.nomor, b.nilai, b.statusLabel, b.pengganti ? b.pengganti.kecocokan + \":\" + String(b.pengganti.id).slice(0, 8) : \"tanpa-pengganti\", JSON.stringify(b.alasanTidakDihitung).slice(0, 140)].join(\" | \"));\nconsole.log(\"  SNAPSHOT_TOTAL layar=\" + totalNilai + \" SUM_dihitung=\" + sumDihitung + \" tidak_dihitung=\" + tidakDihitung.reduce((a, b) => a + Number(b.nilai), 0));\nrec(\"pembayaran dibatalkan/ditolak di periode (SQL) = baris tidak dihitung di layar\", tidakDihitung.length === sqlTdkHitung, `${tidakDihitung.length} vs ${sqlTdkHitung}`);\n\nconst ex = await unduh(\"pemasukan\", { periode: { from: FROM, to: TO }, filter: { kategori: \"PEMBAYARAN\" } });\nrec(\"Export Excel Pemasukan (Uang Masuk): 200 berupa xlsx\", ex.status === 200 && !!ex.wb, ex.status);\nif (ex.wb) {\n  const s = bacaSheet(ex.wb, \"Pemasukan\");\n  rec(\"kolom baru ada: Dihitung ke Total? · Nilai yang Dihitung (Rp) · Alasan Tidak Dihitung; kolom Nilai (Rp) historis dipertahankan\", [\"Dihitung ke Total?\", \"Nilai yang Dihitung (Rp)\", \"Alasan Tidak Dihitung\", \"Nilai (Rp)\"].every((h) => s.header.includes(h)));\n  const sumKolom = s.baris.reduce((a, x) => a + (x[\"Nilai yang Dihitung (Rp)\"] || 0), 0); const sumMentah = s.baris.reduce((a, x) => a + (x[\"Nilai (Rp)\"] || 0), 0);\n  rec(\"SUM kolom 'Nilai yang Dihitung' = TOTAL Excel = total layar = SQL\", Math.round(sumKolom) === Math.round(s.total?.[\"Nilai yang Dihitung (Rp)\"] ?? 0) && Math.round(sumKolom) === sqlMasuk, `${sumKolom} / ${s.total?.[\"Nilai yang Dihitung (Rp)\"] ?? \"(tanpa baris total: periode kosong)\"} / ${sqlMasuk}`);\n  rec(\"SUM mentah kolom 'Nilai (Rp)' − TOTAL = Σ nilai baris yang tidak dihitung (selisih dijelaskan baris per baris)\", Math.round(sumMentah - sumKolom) === Math.round(tidakDihitung.reduce((a, b) => a + Number(b.nilai), 0)), `${sumMentah - sumKolom}`);\n  rec(\"jumlah baris Excel = jumlah baris layar\", s.baris.length === halaman.length, `${s.baris.length}/${halaman.length}`);\n  rec(\"setiap baris 'Tidak' di Excel punya alasan\", s.baris.filter((x) => x[\"Dihitung ke Total?\"] === \"Tidak\").every((x) => x[\"Alasan Tidak Dihitung\"] && x[\"Nilai yang Dihitung (Rp)\"] === 0));\n}\nconst exr = await unduh(\"rekon-sales-finance\", { periode: { from: FROM, to: TO } });\nrec(\"Export Excel Rekonsiliasi Sales-Finance: 200 dan memuat jembatan kohort\", exr.status === 200 && !!exr.wb && (() => { const ws = exr.wb.getWorksheet(\"Jembatan\"); return !!ws && JSON.stringify(ws.getSheetValues()).includes(\"Jembatan kohort\"); })(), exr.status);\n\n// ── izin & validasi\nrec(\"tanpa token = 401 (pemasukan dan rekon)\", (await get(`/api/finance/pemasukan?from=${FROM}&to=${TO}`, null)).status === 401 && (await get(`/api/sales-finance/rekon?from=${FROM}&to=${TO}`, null)).status === 401);\nrec(\"periode rekon tidak valid = 400\", (await get(\"/api/sales-finance/rekon?from=x&to=y\")).status === 400);\nif (tokX) rec(\"akun tanpa izin finance = 403 (pemasukan dan export)\", (await get(`/api/finance/pemasukan?from=${FROM}&to=${TO}`, tokX)).status === 403 && (await unduh(\"pemasukan\", { periode: { from: FROM, to: TO } }, tokX)).status === 403); else skip(\"akun tanpa izin finance = 403\", \"tidak ada akun aktif tanpa izin finance/ADMIN/SALES\");\n\n// ── tanpa jejak tulis (produksi hidup: tabel tidak boleh BERKURANG)\nconst s1 = await jejak(); const turun = Object.keys(s0).filter((k) => s1[k] < s0[k]);\nrec(\"TIDAK ada jejak tulis destruktif: payments, verifikasi, order, jurnal, baris jurnal, refund, nota kredit, pengecualian lunas tidak berkurang selama smoke\", turun.length === 0, turun.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(\",\") || \"tidak ada yang berkurang\");\nconst naik = Object.keys(s0).filter((k) => s1[k] > s0[k]); if (naik.length) console.log(\"  (info: bertambah selama smoke karena pengguna lain/aplikasi hidup — smoke ini hanya GET/POST export: \" + naik.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(\",\") + \")\");\nrec(\"jurnal tidak seimbang (sebelum rilis: \" + B(\"BASE_TIDAK_SEIMBANG\") + \", tidak bertambah)\", (await hitung(\"select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x\")) <= B(\"BASE_TIDAK_SEIMBANG\"));\nrec(\"jumlah Order & Payment tidak berkurang (sebelum: \" + B(\"ORDER_N\") + \" / \" + B(\"PAY_N\") + \")\", (await hitung('select count(*)::int n from \"Order\"')) >= B(\"ORDER_N\") && (await hitung(\"select count(*)::int n from payments\")) >= B(\"PAY_N\"));\nawait prisma.$disconnect();\nconsole.log(\"\\nRINGKASAN smoke: \" + fail + \" gagal, \" + dilewati + \" dilewati (SKIP)\");\nconsole.log(\"SMOKE_HASIL fail=\" + fail + \" skip=\" + dilewati);\nprocess.exit(fail ? 1 : 0);\n"; // diganti generator dengan isi smoke-selisih-laporan.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Audit Selisih Laporan": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4102, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// TANPA data uji dan TANPA tulisan sama sekali: pemeriksaan memakai data produksi nyata di salinan (Agustus–Oktober 2026), jadi parity dibuktikan pada data sungguhan.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4102); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const JEJAK = ["select count(*)::int n from payments", "select count(*)::int n from payment_verifications", 'select count(*)::int n from "Order"', "select count(*)::int n from fin_journal_entries", "select count(*)::int n from fin_journal_lines", "select count(*)::int n from fin_refunds", "select count(*)::int n from fin_order_credits", "select count(*)::int n from order_paid_at_pengecualian", "select count(*)::int n from activity_events"];
const jejak = async () => { const h = []; for (const q of JEJAK) h.push(await num(q)); return h; };
const j0 = await jejak();
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const env = { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), ORDER_N: String(await num('select count(*)::int n from "Order"')), PAY_N: String(await num("select count(*)::int n from payments")) };

// Smoke pasca-switch yang SAMA dijalankan pada tiga periode nyata: Oktober (lintas bulan: order September lunas Oktober), September (pengecualian lunas dikunci), dan Agustus.
for (const [label, from, to] of [["Oktober 2026", "2026-10-01", "2026-10-31"], ["September 2026", "2026-09-01", "2026-09-30"], ["Agustus 2026", "2026-08-01", "2026-08-31"]]) {
  const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 300000, env: { ...env, SMOKE_FROM: from, SMOKE_TO: to } });
  const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
  cek(`SMOKE (kode yang sama dengan fase 8b) lulus pada salinan restore, periode ${label}: 0 gagal`, sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
}
const j1 = await jejak();
cek("seluruh pemeriksaan (daftar, rekon, export) tidak mengubah payments, verifikasi, order, jurnal, baris jurnal, refund, nota kredit, pengecualian lunas, atau aktivitas — identik persis", JSON.stringify(j0) === JSON.stringify(j1), JSON.stringify([j0, j1]));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
# direktori sementara dibuat root oleh kontainer: dihapus lewat kontainer (rm biasa ditolak); kegagalan pembersihan tidak menggagalkan rilis
dcp "$NEW_DIR" run --rm --no-deps -T -v "$BK_DIR:/bk" backend sh -c 'rm -rf /bk/reh-data /bk/reh-uploads /bk/reh-dd' </dev/null >/dev/null 2>&1 || true
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; pemeriksaan audit selisih laporan pada salinan restore TANPA tulisan data lalu DB sementara dihapus"
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
COUNT_SQL="select 'payments', count(*) from payments union all select 'payment_verifications', count(*) from payment_verifications union all select 'orders', count(*) from \"Order\" union all select 'journal_entries', count(*) from fin_journal_entries union all select 'journal_lines', count(*) from fin_journal_lines union all select 'refunds', count(*) from fin_refunds union all select 'order_credits', count(*) from fin_order_credits union all select 'paidat_pengecualian', count(*) from order_paid_at_pengecualian union all select 'pkr', count(*) from fin_penjualan_karyawan"
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pra-switch.txt" || die "hitung baris pra-switch gagal"; ok "pra-switch: hitung baris payments/verifikasi/order/jurnal/refund/nota kredit/pengecualian lunas/PKR dicatat"
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
if diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" >/dev/null; then ok "hitung baris payments/verifikasi/order/jurnal/refund/nota kredit/pengecualian lunas/PKR IDENTIK sebelum vs sesudah switch"; else warn "hitung baris berbeda sebelum vs sesudah switch (kemungkinan aktivitas pengguna sungguhan selama jendela rilis; skrip tidak menulis):"; diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" | sed 's/^/        /' || true; fi
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: Pemasukan (total layar = SQL = Excel), kolom Dihitung ke Total?, Rekonsiliasi Sales-Finance (jembatan tahap 1/2/kohort menutup persis), izin (401/403), validasi 400, tanpa data percobaan; payments/order/jurnal/refund/nota kredit identik"
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
const FROM = process.env.SMOKE_FROM ?? "2026-10-01"; const TO = process.env.SMOKE_TO ?? "2026-10-31";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup: parity layar–API–Excel–tabel untuk Pemasukan (Uang Masuk) dan Rekonsiliasi Sales–Finance, periode FROM..TO (WIB).
// Setiap angka API dibandingkan dengan hitungan LANGSUNG dari tabel (SQL), bukan dari kode rute. Tidak ada tulisan dan tidak ada data percobaan.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.FINANCE_READ) && x.rs.has("ADMIN"))?.u ?? info.find((x) => bisa(x.rs, P.FINANCE_READ))?.u;
const tanpaIzin = info.find((x) => !bisa(x.rs, P.FINANCE_READ) && !x.rs.has("ADMIN") && !x.rs.has("SALES"))?.u;
if (!pembaca) { rec("akun dengan izin finance:read tersedia", false); process.exit(1); }
const tok = await tokenUntuk(pembaca); const tokX = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;
const get = async (url, token = tok) => { const r = await fetch(BASE + url, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const unduh = async (modul, body, token = tok) => { const r = await fetch(`${BASE}/api/finance/export/${modul}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
  if (!(r.headers.get("content-type") || "").includes("spreadsheetml")) { let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, wb: null, json: j }; }
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer())); return { status: r.status, wb, json: null }; };
const nilaiSel = (c) => (c.value && typeof c.value === "object" && !(c.value instanceof Date) && "text" in c.value ? c.value.text : c.value);
const bacaSheet = (wb, nama) => { const ws = wb.getWorksheet(nama); const header = []; ws.getRow(6).eachCell({ includeEmpty: false }, (c, i) => { header[i - 1] = nilaiSel(c); }); const baris = []; let total = null;
  for (let r = 7; r <= ws.rowCount; r++) { const row = ws.getRow(r); if (row.actualCellCount === 0) continue; if (nilaiSel(row.getCell(1)) === "Tidak ada data sesuai periode dan filter") continue; const o = {}; header.forEach((h, i) => { o[h] = nilaiSel(row.getCell(i + 1)) ?? null; }); const p = o[header[0]]; if (typeof p === "string" && /^TOTAL/i.test(p)) { total = o; break; } baris.push(o); }
  return { header, baris, total }; };

const JEJAK = [["payments", "select count(*)::int n from payments"], ["verifikasi", "select count(*)::int n from payment_verifications"], ["order", 'select count(*)::int n from "Order"'], ["jurnal", "select count(*)::int n from fin_journal_entries"],
  ["baris_jurnal", "select count(*)::int n from fin_journal_lines"], ["refund", "select count(*)::int n from fin_refunds"], ["nota_kredit", "select count(*)::int n from fin_order_credits"], ["pengecualian_lunas", "select count(*)::int n from order_paid_at_pengecualian"]];
const jejak = async () => Object.fromEntries(await Promise.all(JEJAK.map(async ([k, q]) => [k, await hitung(q)])));
const s0 = await jejak();

// batas periode WIB: awal hari inklusif, awal hari berikutnya eksklusif (UTC = WIB − 7 jam)
const mulai = new Date(`${FROM}T00:00:00+07:00`); const selesai = new Date(new Date(`${TO}T00:00:00+07:00`).getTime() + 86400000);
const NET = "GREATEST(0, o.value - COALESCE((SELECT SUM(k.amount) FROM fin_order_credits k WHERE k.order_id = o.id AND k.status = 'AKTIF'), 0))";
const sqlMasuk = await hitung(`select coalesce(sum(p.amount),0)::bigint n from payments p where p.cancelled_at is null and p.created_at >= $1 and p.created_at < $2 and exists (select 1 from payment_verifications v where v.payment_id = p.id)`, mulai, selesai);
const sqlLunas = await hitung(`select coalesce(sum(${NET}),0)::bigint n from "Order" o join "Customer" c on c.id = o."customerId" where o.paid_at >= $1 and o.paid_at < $2 and o.status::text not in ('CANCELLED','PENDING') and c."pipelineStage"::text <> 'SPAM' and o.penjualan_karyawan_id is null`, mulai, selesai);
const sqlKohort = await hitung(`select coalesce(sum(${NET}),0)::bigint n from "Order" o join "Customer" c on c.id = o."customerId" where o."createdAt" >= $1 and o."createdAt" < $2 and o.status::text not in ('CANCELLED','PENDING') and o."paymentStatus"::text = 'LUNAS' and c."pipelineStage"::text <> 'SPAM' and o.penjualan_karyawan_id is null`, mulai, selesai);
const sqlTdkHitung = await hitung(`select count(*)::int n from payments p where p.created_at >= $1 and p.created_at < $2 and p.cancelled_at is not null`, mulai, selesai);
console.log(`  (periode ${FROM}..${TO}: uang masuk terverifikasi ${sqlMasuk}; nilai lunas periode ${sqlLunas}; kohort dibuat-lunas ${sqlKohort}; pembayaran batal/tolak ${sqlTdkHitung})`);

// ── Rekonsiliasi Sales–Finance
const rk = await get(`/api/sales-finance/rekon?from=${FROM}&to=${TO}`);
rec("GET /sales-finance/rekon: 200 dan status perhitungan COCOK (semua residual Rp0)", rk.status === 200 && rk.json?.status?.perhitungan === "COCOK" && rk.json?.residual === 0 && rk.json?.tahap1?.residual === 0 && rk.json?.tahap2?.residual === 0 && rk.json?.kohort?.residual === 0, rk.status === 200 ? JSON.stringify([rk.json.residual, rk.json.tahap1?.residual, rk.json.tahap2?.residual, rk.json.kohort?.residual]) : rk.status);
if (rk.json) {
  rec("Uang Masuk Terverifikasi (API) = Σ payments aktif terverifikasi di periode (SQL langsung)", rk.json.kartu.uangMasukDariOrder === sqlMasuk, `${rk.json.kartu.uangMasukDariOrder} vs ${sqlMasuk}`);
  rec("Total Perusahaan (API) = Σ nilai bersih order lunas di periode, tanpa PKR (SQL langsung)", rk.json.kartu.totalPerusahaan === sqlLunas, `${rk.json.kartu.totalPerusahaan} vs ${sqlLunas}`);
  rec("Sudah Lunas kohort dibuat (API) = Σ nilai bersih order dibuat di periode & Lunas (SQL langsung)", rk.json.kartu.sudahLunasKohortDibuat === sqlKohort, `${rk.json.kartu.sudahLunasKohortDibuat} vs ${sqlKohort}`);
  const g = (k) => rk.json.bridge.find((b) => b.kunci === k)?.jumlah ?? 0;
  const jembatan = g("UANG_MASUK") - g("DP_BELUM_LUNAS") - g("ORDER_TIDAK_DIHITUNG") - g("LUNAS_PERIODE_LAIN") - g("REFUND_NON_LUNAS") + g("DP_SEBELUMNYA") - g("REFUND_LUNAS") - g("ONGKIR") - g("KLAIM_TANPA_PAYMENT") - g("PAYMENT_MENUNGGU") - g("PAYMENT_KURANG") - g("KELEBIHAN_BAYAR") - g("SELISIH_LAIN");
  rec("jembatan tahap 1 menutup persis: Uang Masuk − komponen = Total Perusahaan", jembatan === rk.json.kartu.totalPerusahaan, `${jembatan} vs ${rk.json.kartu.totalPerusahaan}`);
  const k = rk.json.kohort; const gk = (kunci) => k.langkah.find((b) => b.kunci === kunci)?.jumlah ?? 0;
  rec("jembatan kohort menutup persis: Sudah Lunas − di luar + dibuat sebelum + bukan-lunas = Total Perusahaan", gk("KOHORT_DIBUAT_LUNAS") - gk("KOHORT_LUNAS_DI_LUAR") + gk("KOHORT_DIBUAT_SEBELUM") + gk("KOHORT_BELUM_LUNAS_PAIDAT") === rk.json.kartu.totalPerusahaan);
  if (rk.json.detailTersedia) {
    const tanpaAlasan = Object.entries(rk.json.detail).filter(([kunci]) => ["LUNAS_PERIODE_LAIN", "KOHORT_LUNAS_DI_LUAR", "KOHORT_DIBUAT_SEBELUM", "KOHORT_BELUM_LUNAS_PAIDAT"].includes(kunci)).flatMap(([kunci, arr]) => arr.filter((o) => !o.alasan).map((o) => `${kunci}:${o.nomor}`));
    rec("setiap order di jembatan lintas-periode/kohort membawa alasan tertulis dan nomor order", tanpaAlasan.length === 0, tanpaAlasan.slice(0, 5).join(","));
    const payTanpaDok = Object.values(rk.json.detail).flat().flatMap((o) => o.pembayaran ?? []).filter((p) => !p.ref || p.tanggalWib === undefined);
    rec("setiap pembayaran di rincian membawa ID dokumen (ref) dan tanggal WIB", payTanpaDok.length === 0, payTanpaDok.length);
    rec("Σ detail UANG_MASUK = kartu uang masuk (daftar order = angka)", rk.json.detail.UANG_MASUK.reduce((a, o) => a + o.jumlah, 0) === rk.json.kartu.uangMasukDariOrder);
  }
}

// ── Pemasukan (Uang Masuk): layar = SQL = Excel
const halaman = []; let page = 1; let totalNilai = null; let totalTidak = null; let totalBaris = null;
for (let h = 0; h < 40; h++) { const r = await get(`/api/finance/pemasukan?from=${FROM}&to=${TO}&kategori=PEMBAYARAN&limit=100&page=${page}`); if (r.status !== 200) { rec("GET /finance/pemasukan?kategori=PEMBAYARAN 200", false, r.status); break; } halaman.push(...r.json.items); totalNilai = r.json.totalNilai; totalTidak = r.json.totalTidakDihitung; totalBaris = r.json.total; if (!r.json.adaLagi) break; page += 1; }
rec("total layar Uang Masuk = Σ payments terverifikasi (SQL langsung)", Number(totalNilai) === sqlMasuk, `${totalNilai} vs ${sqlMasuk}`);
rec("jumlah baris layar = semua payment tercatat di periode (terverifikasi + menunggu + ditolak + dibatalkan); tidak ada baris hilang", halaman.length === totalBaris && halaman.length === await hitung("select count(*)::int n from payments p where p.created_at >= $1 and p.created_at < $2", mulai, selesai), `${halaman.length}/${totalBaris}`);
const sumDihitung = halaman.reduce((a, b) => a + Number(b.nilaiDihitung), 0);
rec("Σ nilaiDihitung baris = total layar (satu aturan 'dihitung ke total')", Math.round(sumDihitung * 100) === Math.round(Number(totalNilai) * 100), `${sumDihitung} vs ${totalNilai}`);
const tidakDihitung = halaman.filter((b) => b.dihitung === false);
rec("setiap baris yang tidak dihitung membawa alasan tertulis; baris dihitung tanpa alasan", tidakDihitung.every((b) => b.alasanTidakDihitung && Number(b.nilaiDihitung) === 0) && halaman.filter((b) => b.dihitung).every((b) => !b.alasanTidakDihitung && b.nilaiDihitung === b.nilai), `${tidakDihitung.length} tidak dihitung`);
rec("jumlah & nilai 'tidak dihitung' di respons = Σ baris tidak dihitung", totalTidak?.jumlah === tidakDihitung.length && Math.round(Number(totalTidak?.nilai) * 100) === Math.round(tidakDihitung.reduce((a, b) => a + Number(b.nilai), 0) * 100));
// Tautan pengganti: tiap baris dibatalkan/ditolak yang order-nya masih punya pembayaran AKTIF harus menunjuk pembayaran aktif pada order yang SAMA; tanpa pembayaran aktif → tidak ada tautan.
const dibatalLayar = tidakDihitung.filter((b) => b.sub === "PEMBAYARAN_TIDAK_DIHITUNG");
let salahTaut = 0;
for (const b of dibatalLayar) {
  const aktif = await prisma.$queryRawUnsafe("select p.id::text i from payments p where p.order_id = (select order_id from payments where id = $1::uuid) and p.cancelled_at is null", b.id);
  const ids = new Set(aktif.map((x) => x.i));
  if (ids.size === 0 ? b.pengganti !== null : !(b.pengganti && ids.has(b.pengganti.id) && b.alasanTidakDihitung.includes(String(b.pengganti.id).slice(0, 8)))) salahTaut++;
}
rec("setiap pembayaran dibatalkan/ditolak menautkan pembayaran AKTIF pada order yang sama (atau tidak ada tautan bila order tak punya pembayaran aktif), id pengganti tercantum di alasan", salahTaut === 0, salahTaut + " salah");
for (const b of dibatalLayar) console.log("  SNAPSHOT_TIDAK_DIHITUNG " + [b.id.slice(0, 8), b.nomor, b.nilai, b.statusLabel, b.pengganti ? b.pengganti.kecocokan + ":" + String(b.pengganti.id).slice(0, 8) : "tanpa-pengganti", JSON.stringify(b.alasanTidakDihitung).slice(0, 140)].join(" | "));
console.log("  SNAPSHOT_TOTAL layar=" + totalNilai + " SUM_dihitung=" + sumDihitung + " tidak_dihitung=" + tidakDihitung.reduce((a, b) => a + Number(b.nilai), 0));
rec("pembayaran dibatalkan/ditolak di periode (SQL) = baris tidak dihitung di layar", tidakDihitung.length === sqlTdkHitung, `${tidakDihitung.length} vs ${sqlTdkHitung}`);

const ex = await unduh("pemasukan", { periode: { from: FROM, to: TO }, filter: { kategori: "PEMBAYARAN" } });
rec("Export Excel Pemasukan (Uang Masuk): 200 berupa xlsx", ex.status === 200 && !!ex.wb, ex.status);
if (ex.wb) {
  const s = bacaSheet(ex.wb, "Pemasukan");
  rec("kolom baru ada: Dihitung ke Total? · Nilai yang Dihitung (Rp) · Alasan Tidak Dihitung; kolom Nilai (Rp) historis dipertahankan", ["Dihitung ke Total?", "Nilai yang Dihitung (Rp)", "Alasan Tidak Dihitung", "Nilai (Rp)"].every((h) => s.header.includes(h)));
  const sumKolom = s.baris.reduce((a, x) => a + (x["Nilai yang Dihitung (Rp)"] || 0), 0); const sumMentah = s.baris.reduce((a, x) => a + (x["Nilai (Rp)"] || 0), 0);
  rec("SUM kolom 'Nilai yang Dihitung' = TOTAL Excel = total layar = SQL", Math.round(sumKolom) === Math.round(s.total?.["Nilai yang Dihitung (Rp)"] ?? 0) && Math.round(sumKolom) === sqlMasuk, `${sumKolom} / ${s.total?.["Nilai yang Dihitung (Rp)"] ?? "(tanpa baris total: periode kosong)"} / ${sqlMasuk}`);
  rec("SUM mentah kolom 'Nilai (Rp)' − TOTAL = Σ nilai baris yang tidak dihitung (selisih dijelaskan baris per baris)", Math.round(sumMentah - sumKolom) === Math.round(tidakDihitung.reduce((a, b) => a + Number(b.nilai), 0)), `${sumMentah - sumKolom}`);
  rec("jumlah baris Excel = jumlah baris layar", s.baris.length === halaman.length, `${s.baris.length}/${halaman.length}`);
  rec("setiap baris 'Tidak' di Excel punya alasan", s.baris.filter((x) => x["Dihitung ke Total?"] === "Tidak").every((x) => x["Alasan Tidak Dihitung"] && x["Nilai yang Dihitung (Rp)"] === 0));
}
const exr = await unduh("rekon-sales-finance", { periode: { from: FROM, to: TO } });
rec("Export Excel Rekonsiliasi Sales-Finance: 200 dan memuat jembatan kohort", exr.status === 200 && !!exr.wb && (() => { const ws = exr.wb.getWorksheet("Jembatan"); return !!ws && JSON.stringify(ws.getSheetValues()).includes("Jembatan kohort"); })(), exr.status);

// ── izin & validasi
rec("tanpa token = 401 (pemasukan dan rekon)", (await get(`/api/finance/pemasukan?from=${FROM}&to=${TO}`, null)).status === 401 && (await get(`/api/sales-finance/rekon?from=${FROM}&to=${TO}`, null)).status === 401);
rec("periode rekon tidak valid = 400", (await get("/api/sales-finance/rekon?from=x&to=y")).status === 400);
if (tokX) rec("akun tanpa izin finance = 403 (pemasukan dan export)", (await get(`/api/finance/pemasukan?from=${FROM}&to=${TO}`, tokX)).status === 403 && (await unduh("pemasukan", { periode: { from: FROM, to: TO } }, tokX)).status === 403); else skip("akun tanpa izin finance = 403", "tidak ada akun aktif tanpa izin finance/ADMIN/SALES");

// ── tanpa jejak tulis (produksi hidup: tabel tidak boleh BERKURANG)
const s1 = await jejak(); const turun = Object.keys(s0).filter((k) => s1[k] < s0[k]);
rec("TIDAK ada jejak tulis destruktif: payments, verifikasi, order, jurnal, baris jurnal, refund, nota kredit, pengecualian lunas tidak berkurang selama smoke", turun.length === 0, turun.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "tidak ada yang berkurang");
const naik = Object.keys(s0).filter((k) => s1[k] > s0[k]); if (naik.length) console.log("  (info: bertambah selama smoke karena pengguna lain/aplikasi hidup — smoke ini hanya GET/POST export: " + naik.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") + ")");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Payment tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("PAY_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from payments")) >= B("PAY_N"));
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
  ok "smoke test lulus (Pemasukan layar = SQL = Excel, kolom Dihitung ke Total?, jembatan tahap 1/2/kohort residual Rp0, izin, validasi, tanpa jejak tulis, invarian)"
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
say "CATATAN: Rilis ini membawa audit selisih laporan Oktober 2026: kolom Dihitung ke Total? di Excel Pemasukan, jembatan kohort + dokumen pembayaran di Rekonsiliasi Sales-Finance, label basis tanggal. TANPA migrasi. Tidak ada angka pembukuan, pembayaran, order, atau tanggal lunas yang diubah oleh rilis. Keputusan Owner yang tersisa (pemilik order Suci nonaktif, pencabutan pengecualian lunas, order staf) TIDAK ditangani rilis ini."
