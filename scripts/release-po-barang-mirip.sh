#!/usr/bin/env bash
# RILIS "PO BARANG MIRIP" (Finance → Purchase Order Baru): WEB + BACKEND, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • Pencocokan barang baru terhadap katalog dibedakan tiga kelas (lib/domain/kemiripanBarang.js): SAMA (setelah normalisasi ejaan/spasi/×-x-*/cm-mm-m/urutan kata/kata satuan) = diblokir dan diarahkan ke katalog;
#     BERBEDA JELAS (ukuran, ketebalan, grade/density, angka spesifikasi, merek/jenis berbeda pada kedua sisi) = hanya saran, TANPA konfirmasi/alasan paksaan; AMBIGU (atribut hanya tertulis di satu sisi, ejaan hampir sama, urutan ukuran terbalik,
#     kata tambahan) = butuh keputusan pengguna (konfirmasi + alasan). Pilihan pengguna tidak pernah diganti otomatis.
#   • Form PO memeriksa SEMUA barang baru sekaligus sebelum simpan (POST /finance/purchase-orders/sku/cek-duplikat-po, baca-saja, urutan sama dengan penyimpanan): masalah tampil PER BARIS dengan aksi (Pakai {kode} / Periksa & konfirmasi / Ubah / Hapus baris),
#     bukan pesan galat di bawah. Duplikat antar-baris dalam satu PO ditunjuk (SKU_DUPLIKAT_DALAM_PO).
#   • Server tetap penjaga akhir: nama kanonik diserialkan dengan advisory lock berurutan (dua pengguna menyimpan barang yang sama bersamaan, urutan baris berlawanan = satu menang, satu 409, tanpa deadlock); pembuatan SKU + katalog supplier + asal SKU + PO
#     satu transaksi (gagal di mana pun = tidak ada material/PO setengah jadi); klik ganda diamankan middleware Idempotency-Key global yang sudah ada (tidak ada mekanisme idempotensi baru).
#   • Rilis ini TIDAK membuat PO, material, katalog, stok, jurnal, atau Harga Berlaku apa pun; delapan material yang sudah ada (BUS-008..015) tidak dibuat ulang, diganti kode, digabung, atau dihapus (dibuktikan sidik isi barisnya di smoke dan rehearsal).
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore; semua skenario tulis — delapan varian, klik ganda, ambigu, antar-baris, gagal-simpan, dua pengguna bersamaan, izin — ditulis HANYA ke DB sementara;
#     direktori data/uploads production TIDAK dipasang); build web di release dir; switch SATU kali; verifikasi; smoke baca-saja pasca-switch (pratinjau cek-duplikat-po + penolakan sebelum menulis; tidak ada PO/material percobaan di production).
#   • BASELINE = release aktif yang sudah memuat hotfix performa resmi (c518209e) dan drawer bahan ringkas (173058487). GERBANG IDENTITAS KODE LIVE membandingkan ISI kode (hash blob SEMUA berkas terlacak baseline, berkas tambahan, container == folder release,
#     identitas proses) di fase 2, fase 6, dan TEPAT sebelum switch; selisih isi apa pun / berkas tambahan / proses berganti = berhenti sebelum switch.
#   • Pembersihan release lama (fase 9) DINONAKTIFKAN pada rilis ini: tidak ada folder release/image rollback/backup/volume yang dihapus oleh skrip.
#
#   cat scripts/release-po-barang-mirip.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/pbm.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/pbm.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pbm.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/pbmr.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pbm.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/pbm.out 2>&1 < /dev/null &'   # rilis penuh (hanya setelah persetujuan)
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru). Material/PO yang dibuat lewat rilis ini tetap sah sebagai data biasa; kode lama membacanya seperti SKU/PO biasa (kolom initialData.varianSerupa hanya informasi tambahan).
# (dibangkitkan oleh scripts/gen-release-po-barang-mirip.cjs dari scripts/release-penjadwalan-langsung.sh + scripts/templates/release-po-barang-mirip/*; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/po-barang-mirip-on-17305848}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/src/lib/domain/kemiripanBarang\.js|backend/src/routes/purchaseOrders\.js|backend/src/services/finance/purchaseOrder\.js|backend/src/services/finance/skuBaru\.js|backend/tests/integration/purchaseOrderBarangMirip\.integration\.test\.js|backend/tests/kemiripanBarang\.test\.js|frontend/src/api\.js|frontend/src/features/finance/purchaseOrderLogic\.js|frontend/src/pages/finance/FinancePurchaseOrders\.jsx|frontend/tests/poBarangMirip\.test\.js|scripts/gen-release-po-barang-mirip\.cjs|scripts/lib/rehearsal-po-barang-mirip\.mjs|scripts/lib/smoke-po-barang-mirip\.mjs|scripts/release-po-barang-mirip\.sh|scripts/templates/release-po-barang-mirip/header\.txt|scripts/templates/release-po-barang-mirip/rollback\.txt)$'
BACKEND_SRC_EXPECT="backend/src/lib/domain/kemiripanBarang.js backend/src/routes/purchaseOrders.js backend/src/services/finance/purchaseOrder.js backend/src/services/finance/skuBaru.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/finance/purchaseOrderLogic.js frontend/src/pages/finance/FinancePurchaseOrders.jsx"
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
BK_DIR="$HOME/release-backups/po-barang-mirip-${DEPLOY_SHORT}-${TS}"
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
Tujuan rollback = image dan folder release LIVE SEBELUM rilis ini; keduanya MEMUAT hotfix performa dan drawer bahan ringkas (gerbang kode live membuktikan kode di container == folder == baseline disetujui) — rollback tidak membuang keduanya. Folder ${PREV_DIR} tidak dihapus.
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama kembali ke pencocokan kemiripan nama saja (varian berbeda ukuran/ketebalan kembali dipaksa konfirmasi + alasan; galat duplikat antar-baris muncul saat simpan).
PO dan material yang dibuat saat rilis ini aktif tetap sah (baris biasa; kode SKU, katalog supplier, dan asal SKU tidak berubah bentuk); tidak ada yang dihapus atau dibalik otomatis.
Rilis ini tidak menyentuh stok, jurnal, utang, Harga Berlaku, Koreksi Saldo, Produksi, maupun delapan material BUS-008..015 yang sudah ada.
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
exec 9>/tmp/release-po-barang-mirip.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "pbm\|release-po-barang-mirip\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
    [ -e "$lf" ] || continue; [ "$lf" = "/tmp/release-po-barang-mirip.lock" ] && continue
    ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain mulai berjalan (kunci ${lf} dipegang) — berhenti sebelum switch"
  done
  OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "pbm\|release-po-barang-mirip\|pgrep\|node src/index.js" | grep -v "$$" || true)"
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
BACKUP_FILE="$HOME/backups/pre-po-barang-mirip-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Perlu keputusan Anda" "Varian serupa yang sudah ada" "Batalkan barang baru ini" "Ubah barang baru"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; [ -z "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks fitur baru '${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done
for s2 in "Ada stok" "Stok belum diketahui" "Nol menurut pergerakan" "Saldo minus" "Koreksi saldo" "Ubah harga" "Pilih meja" "Pilih semua unit order ini" "Belum dijadwalkan" "Riwayat dan dokumen pemakaian" "Tanpa pengeluaran stok" "Mengurangi stok" "Beranda Gudang" "Pengeluaran Material" "Konfirmasi Barang Jadi" "Tambah pemakaian" "Ganti bahan" "Ajukan perubahan" "Lihat dampak" "Konfirmasi & kurangi stok" "Harga Berlaku (HPP operasional)" "Bahan belum tercatat" "Detail teknis" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-pbm-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
[ "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"
ok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR}: memuat hotfix performa (kode container == folder == baseline disetujui, terbukti gerbang kode live)"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_pbm_${TS}"
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
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): PO barang mirip (delapan varian tanpa paksaan alasan, klik ganda, ambigu, duplikat antar-baris, gagal simpan tanpa setengah jadi, dua pengguna bersamaan, izin) pada salinan; pada material nyata di salinan: pratinjau menunjuk kodenya sendiri dan isi barisnya tidak berubah. Stok/jurnal/Harga Berlaku tidak berubah. DB dihapus di akhir.
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji PO barang mirip terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
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
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "import { createRequire } from \"node:module\";\nimport { pathToFileURL } from \"node:url\";\nimport path from \"node:path\";\nconst require = createRequire(process.cwd() + \"/\");\nconst jwt = require(\"jsonwebtoken\");\nconst { PrismaClient } = require(\"@prisma/client\");\nconst prisma = new PrismaClient();\nconst BASE = process.env.SMOKE_BASE ?? \"http://127.0.0.1:4000\"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)\nconst APP = process.env.APP_DIR ?? \"/app\";\nlet fail = 0; let dilewati = 0;\nconst rec = (n, ok, d = \"\") => { if (!ok) fail++; console.log(`  ${ok ? \"PASS\" : \"FAIL\"}  ${n}${d ? \" — \" + d : \"\"}`); };\nconst skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };\n// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang dipakai hanya pratinjau cek-duplikat-po (baca-saja) dan PENOLAKAN sebelum menyentuh data (tanpa token, tanpa izin, masukan tidak sah).\n// Tidak ada PO dan tidak ada material percobaan yang dibuat. Jejak tulis (material, katalog supplier, asal SKU, PO, Harga Berlaku, stok, jurnal) dan isi material nyata harus identik sebelum vs sesudah.\nconst { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, \"src/constants/permissions.js\")).href);\nconst rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);\nconst bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));\nconst tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: \"10m\" });\nconst hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);\nconst B = (k) => Number(process.env[k]);\nconst post = async (p, token, body = {}, hdr = {}) => { const r = await fetch(BASE + p, { method: \"POST\", headers: { \"Content-Type\": \"application/json\", ...(token ? { Authorization: \"Bearer \" + token } : {}), ...hdr }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };\nconst users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: \"asc\" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });\nconst finAdmin = info.find((x) => bisa(x.rs, P.FINANCE_ADMIN))?.u; const bukanAdmin = info.find((x) => !bisa(x.rs, P.FINANCE_ADMIN))?.u;\nif (!finAdmin) { rec(\"akun Finance Admin (finance:admin) tersedia\", false); process.exit(1); }\nconst tA = await tokenUntuk(finAdmin); const tN = bukanAdmin ? await tokenUntuk(bukanAdmin) : null;\nconst jejak = async () => ({\n  material: await hitung(\"select count(*)::int n from materials\"), katalog: await hitung(\"select count(*)::int n from fin_supplier_materials\"), asal: await hitung(\"select count(*)::int n from fin_material_sku_origins\"),\n  po: await hitung(\"select count(*)::int n from fin_purchase_orders\"), poBaris: await hitung(\"select count(*)::int n from fin_purchase_order_lines\"), harga: await hitung(\"select count(*)::int n from material_harga_berlaku\"),\n  stok: await hitung(\"select count(*)::int n from stock_movements\"), jurnal: await hitung(\"select count(*)::int n from fin_journal_entries\"),\n});\n// isi LENGKAP semua material bahan baku (BUS-*): tidak boleh berubah apa pun (delapan BUS-008..015 ikut terjaga)\nconst sidikMaterial = async () => String((await prisma.$queryRawUnsafe(\"select coalesce(md5(string_agg(m::text, '|' order by m.id::text)), '-') as n from materials m\"))[0].n);\nconst s0 = await jejak(); const h0 = await sidikMaterial();\nconst PO = \"/api/finance/purchase-orders\"; const CEK_PO = `${PO}/sku/cek-duplikat-po`;\nconst sup = (await prisma.$queryRawUnsafe(\"select id::text id from fin_suppliers order by created_at asc limit 1\"))[0]?.id;\nif (!sup) { rec(\"ada supplier di katalog\", false); process.exit(1); }\nconst mb = (nama) => ({ nama, kategori: \"Busa\", jenis: \"BAHAN_PRODUKSI\", spesifikasi: null, satuanBeli: \"SHEET\", satuanStok: \"SHEET\" });\n\n// ── pratinjau baca-saja pada katalog NYATA\nconst nyata = await prisma.$queryRawUnsafe(\"select id::text id, code, name, unit from materials where active = true and code like 'BUS-%' and name ~ '[0-9]+ ?[xX×] ?[0-9]+' order by (code between 'BUS-008' and 'BUS-015') desc, code limit 8\");\nif (nyata.length >= 1) {\n  const pv = await post(CEK_PO, tA, { supplierId: sup, barisBaru: nyata.map((m, i) => ({ baris: i + 1, materialBaru: { ...mb(m.name), satuanStok: m.unit, satuanBeli: m.unit } })) });\n  rec(`cek-duplikat-po (${nyata.length} nama material NYATA): 200 dan setiap baris menunjuk kode materialnya sendiri sebagai SAMA (diblokir, diarahkan ke katalog)`, pv.status === 200 && pv.json?.bolehSimpan === false && (pv.json?.baris ?? []).length === nyata.length && pv.json.baris.every((r, i) => r.diblokir === true && (r.pasti ?? []).some((c) => c.materialId === nyata[i].id)), `${pv.status} ${JSON.stringify((pv.json?.baris ?? []).map((r) => r.pasti?.[0]?.kode))}`.slice(0, 220));\n  const m = nyata[0]; const tebal = m.name.replace(/(\\d+(?:[.,]\\d+)?\\s*[xX×]\\s*\\d+(?:[.,]\\d+)?\\s*[xX×]\\s*)\\d+(?:[.,]\\d+)?/, (_, depan) => depan + \"97\");\n  if (tebal !== m.name) {\n    const pb = await post(CEK_PO, tA, { supplierId: sup, barisBaru: [{ baris: 1, materialBaru: { ...mb(tebal), satuanStok: m.unit, satuanBeli: m.unit } }] });\n    rec(`varian dengan ketebalan jelas berbeda (\"${tebal}\") TIDAK diblokir dan TIDAK butuh konfirmasi/alasan; ditampilkan sebagai saran serupa`, pb.status === 200 && pb.json?.bolehSimpan === true && pb.json.baris[0].diblokir === false && pb.json.baris[0].perluKonfirmasi === false && pb.json.baris[0].pasti.length === 0, `${pb.status} ${JSON.stringify(pb.json?.baris?.[0] ?? {}).slice(0, 160)}`);\n  } else skip(\"varian ketebalan berbeda dari nama nyata\", \"nama material nyata pertama tidak memuat ukuran tiga dimensi (PxLxT)\");\n} else skip(\"pratinjau pada material nyata BUS-*\", \"tidak ada material BUS-* beraturan ukuran di katalog\");\nconst asing = await post(CEK_PO, tA, { supplierId: sup, barisBaru: [{ baris: 1, materialBaru: mb(\"ZZ UJI ASING 997X998X9 CM QQ\") }, { baris: 2, materialBaru: mb(\"ZZ UJI ASING 997X998X9 cm qq\") }] });\nrec(\"dua baris yang sama setelah normalisasi pada form yang sama: baris ke-2 ditunjuk sebagai duplikat dalam PO (SATU baris diblokir, baris ke-1 tidak)\", asing.status === 200 && asing.json?.bolehSimpan === false && asing.json.baris[0].diblokir === false && asing.json.baris[1].diblokir === true && asing.json.baris[1].dalamPO === true, `${asing.status}`);\n\n// ── penolakan SEBELUM menulis\nrec(\"cek-duplikat-po tanpa token = 401\", (await post(CEK_PO, null, { supplierId: sup, barisBaru: [] })).status === 401);\nrec(\"simpan PO tanpa token = 401 (tidak menulis)\", (await post(PO, null, { supplierId: sup, lines: [] }, { \"Idempotency-Key\": \"smoke-pbm-tidak-menulis-0001\" })).status === 401);\nif (tN) { rec(\"cek-duplikat-po akun non-Admin Finance = 403\", (await post(CEK_PO, tN, { supplierId: sup, barisBaru: [] })).status === 403); rec(\"simpan PO dengan barang baru oleh non-Admin = 403 (tidak menulis)\", (await post(PO, tN, { supplierId: sup, orderDate: \"2026-10-29\", lines: [{ materialBaru: mb(\"ZZ UJI ASING 997X998X9 CM QQ\"), qty: 1, unitPrice: 1 }] }, { \"Idempotency-Key\": \"smoke-pbm-tidak-menulis-0002\" })).status === 403); } else skip(\"akun non-Admin Finance ditolak 403\", \"tidak ada akun non-Admin aktif (diuji di rehearsal)\");\nrec(\"cek-duplikat-po dengan nama kosong = 4xx (tidak menulis)\", (await post(CEK_PO, tA, { supplierId: sup, barisBaru: [{ baris: 1, materialBaru: mb(\"\") }] })).status >= 400);\n\nconst s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]); const h1 = await sidikMaterial();\nrec(\"TIDAK ada jejak tulis: material, katalog supplier, asal SKU, PO, baris PO, Harga Berlaku, stok, jurnal sama persis sebelum vs sesudah smoke\", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(\",\") || \"identik\");\nrec(\"isi LENGKAP semua baris material (termasuk BUS-008..015) identik sebelum vs sesudah smoke (tidak dibuat ulang/diganti kode/digabung/dihapus)\", h0 === h1, h0 === h1 ? \"identik\" : `${h0} → ${h1}`);\nrec(\"jurnal tidak seimbang (sebelum rilis: \" + B(\"BASE_TIDAK_SEIMBANG\") + \", tidak bertambah)\", (await hitung(\"select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x\")) <= B(\"BASE_TIDAK_SEIMBANG\"));\nrec(\"jumlah Order & Job tidak berkurang (sebelum: \" + B(\"ORDER_N\") + \" / \" + B(\"JOB_N\") + \")\", (await hitung('select count(*)::int n from \"Order\"')) >= B(\"ORDER_N\") && (await hitung(\"select count(*)::int n from jobs\")) >= B(\"JOB_N\"));\nawait prisma.$disconnect();\nconsole.log(\"\\nRINGKASAN smoke: \" + fail + \" gagal, \" + dilewati + \" dilewati (SKIP)\");\nconsole.log(\"SMOKE_HASIL fail=\" + fail + \" skip=\" + dilewati);\nprocess.exit(fail ? 1 : 0);\n"; // diganti generator dengan isi smoke-po-barang-mirip.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji PO barang mirip hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "PO barang mirip": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Semua tulisan hanya di DB sementara ini. Di salinan inilah delapan material nyata (BUS-008..015 bila ada) diperiksa: pratinjau, penolakan, dan SIDIK ISI LENGKAP barisnya harus tidak berubah apa pun yang dilakukan uji.
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
const admins = info.filter((x) => bisa(x.rs, P.FINANCE_ADMIN)).map((x) => x.u); const nonAdmin = info.find((x) => !bisa(x.rs, P.FINANCE_ADMIN))?.u;
const stamp = Date.now().toString(36);
const adm1 = admins[0] ?? await prisma.user.create({ data: { name: "REH Admin 1", email: `reh-adm1-${stamp}@example.test`, passwordHash: "x", role: "ADMIN" } });
const adm2 = admins[1] ?? await prisma.user.create({ data: { name: "REH Admin 2", email: `reh-adm2-${stamp}@example.test`, passwordHash: "x", role: "ADMIN" } });
const biasa = nonAdmin ?? await prisma.user.create({ data: { name: "REH Sales", email: `reh-sls-${stamp}@example.test`, passwordHash: "x", role: "SALES" } });
cek("akun uji tersedia: dua Admin Finance (finance:admin) dan satu akun non-Admin", !!adm1 && !!adm2 && adm1.id !== adm2.id && !!biasa);
const t1 = await token(adm1); const t2 = await token(adm2); const tN = await token(biasa);
const H = async (metode, p, tok, body = null, kunci = null) => { const r = await fetch(BASE + p, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kunci ? { "Idempotency-Key": kunci } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
let seq = 0; const kunci = (p) => `reh-pbm-${p}-${Date.now().toString(36)}-${++seq}-xxxxxxxx`;
const PO = "/api/finance/purchase-orders"; const CEK_PO = `${PO}/sku/cek-duplikat-po`;
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const mb = (nama, o = {}) => ({ nama, kategori: "Busa", jenis: "BAHAN_PRODUKSI", spesifikasi: null, satuanBeli: "SHEET", satuanStok: "SHEET", ...o });
const baris = (nama, q = 10, harga = 150_000, o = {}) => ({ materialBaru: mb(nama, o), qty: q, unitPrice: harga });
const sup = await prisma.finSupplier.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }) ?? await prisma.finSupplier.create({ data: { code: `SUP-REH-${stamp}`, name: "PEMASOK REH" } });
const po = (lines, supplierId = sup.id) => ({ supplierId, orderDate: hariIni, lines });
const jejak = async () => ({
  material: await prisma.material.count(), katalog: await prisma.finSupplierMaterial.count(), asal: await prisma.finMaterialSkuOrigin.count(), po: await prisma.finPurchaseOrder.count(), poBaris: await prisma.finPurchaseOrderLine.count(),
  harga: await prisma.materialHargaBerlaku.count(), stok: await prisma.stockMovement.count(), jurnal: await prisma.finJournalEntry.count(), jurnalBaris: await prisma.finJournalLine.count(),
});
const sama = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const sidik = async (ids) => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(m::text, '|' order by m.id::text)), '-') as n from materials m where m.id::text = any($1::text[])", ids))[0].n);

// ── A. material NYATA di salinan (BUS-008..015 bila ada): pratinjau menunjuk kode sendiri; PO yang mengulang namanya ditolak; isi barisnya tidak berubah sama sekali
const nyata = await prisma.$queryRawUnsafe("select id::text id, code, name, unit from materials where active = true and code like 'BUS-%' and name ~ '[0-9]+ ?[xX×] ?[0-9]+' order by (code between 'BUS-008' and 'BUS-015') desc, code limit 8");
// SEMUA baris material yang sudah ada sebelum uji (termasuk BUS-008..015 bila ada): isi lengkapnya harus identik setelah SELURUH uji selesai
const semuaId = (await prisma.$queryRawUnsafe("select id::text id from materials")).map((r) => r.id); const sidikSemua0 = await sidik(semuaId);
const bus815 = (await prisma.$queryRawUnsafe("select code from materials where code between 'BUS-008' and 'BUS-015' and code ~ '^BUS-0(0[89]|1[0-5])$' order by code")).map((r) => r.code);
cek(`material BUS-008..BUS-015 di salinan restore: ${bus815.length ? bus815.join(", ") : "tidak ada"} (dijadikan sasaran uji bila ada)`, true);
if (nyata.length >= 1) {
  const ids = nyata.map((m) => m.id); const s0 = await sidik(ids); const j0 = await jejak();
  const tulisUlang = nyata.map((m, i) => (i % 2 ? m.name.toLowerCase().replace(/\s*x\s*/g, " × ") : m.name.replace(/\s+/g, "  ")));
  const pv = await H("POST", CEK_PO, t1, { supplierId: sup.id, barisBaru: nyata.map((m, i) => ({ baris: i + 1, materialBaru: mb(tulisUlang[i], { satuanStok: m.unit, satuanBeli: m.unit }) })) });
  cek(`material NYATA (${nyata.map((m) => m.code).join(", ")}): pratinjau menunjuk KODE MATERIALNYA SENDIRI (juga setelah ejaan/spasi/× diubah) dan memblokir tiap baris`, pv.status === 200 && pv.body?.bolehSimpan === false && pv.body.baris.every((r, i) => r.diblokir && r.pasti.some((c) => c.materialId === nyata[i].id)), `${pv.status} ${JSON.stringify((pv.body?.baris ?? []).map((r) => r.pasti?.[0]?.kode))}`);
  const tolak = await H("POST", PO, t1, po(nyata.map((m, i) => baris(tulisUlang[i], 5, 150_000, { satuanStok: m.unit, satuanBeli: m.unit }))), kunci("nyata"));
  cek("PO yang mengulang nama material nyata ditolak 409 SKU_DUPLIKAT_PASTI, menunjuk baris dan kode; tidak ada yang dibuat ulang", tolak.status === 409 && tolak.body?.code === "SKU_DUPLIKAT_PASTI" && tolak.body?.baris === 1 && sama(await jejak(), j0), `${tolak.status} ${tolak.body?.code}`);
  cek("isi LENGKAP baris material nyata identik (kode tidak diganti, tidak digabung, tidak dihapus, tidak diubah)", (await sidik(ids)) === s0 && (await num("select count(*)::int n from materials where id::text = any($1::text[])", ids)) === nyata.length);
} else cek("material nyata BUS-* beraturan ukuran di salinan (dilewati: tidak ada)", true, "dilewati");

// ── B. delapan varian BARU berbeda ukuran/ketebalan dalam satu PO: tanpa konfirmasi/alasan; stok/jurnal/Harga Berlaku tidak tersentuh
const dasarNama = `BUSA REH UJI ${stamp.toUpperCase()}`;
const DELAPAN = ["2CM", "4CM"].flatMap((t) => ["120X200", "160X200", "180X200", "200X200"].map((u) => `${dasarNama} ${u}X${t} R58`));
const jB0 = await jejak();
const pvB = await H("POST", CEK_PO, t1, { supplierId: sup.id, barisBaru: DELAPAN.map((nama, i) => ({ baris: i + 1, materialBaru: mb(nama) })) });
cek("pratinjau 8 varian (2/4 cm × 4 ukuran): boleh simpan, tanpa blokir dan tanpa konfirmasi; saran varian serupa hanya informasi; baca-saja", pvB.status === 200 && pvB.body?.bolehSimpan === true && pvB.body.baris.every((r) => !r.diblokir && !r.perluKonfirmasi) && sama(await jejak(), jB0), `${pvB.status}`);
const kB = kunci("lapan"); const rB = await H("POST", PO, t1, po(DELAPAN.map((nama, i) => baris(nama, 10 + i, 150_000, { kodeSupplier: `REH-${stamp}-${i + 1}` }))), kB);
const jB1 = await jejak(); const asalB = await prisma.finMaterialSkuOrigin.findMany({ where: { material: { name: { startsWith: dasarNama } } } });
cek("simpan 8 varian: 201, 1 PO, 8 material, 8 katalog supplier, 8 asal SKU; TANPA alasan override; stok/jurnal/baris jurnal/Harga Berlaku TIDAK berubah", rB.status === 201 && jB1.po === jB0.po + 1 && jB1.material === jB0.material + 8 && jB1.katalog === jB0.katalog + 8 && jB1.asal === jB0.asal + 8 && jB1.stok === jB0.stok && jB1.jurnal === jB0.jurnal && jB1.jurnalBaris === jB0.jurnalBaris && jB1.harga === jB0.harga && asalB.length === 8 && asalB.every((o) => o.duplicateOverrideReason === null), `${rB.status} ${JSON.stringify(rB.body?.error ?? "")}`);

// ── C. klik ganda (kunci sama, isi sama): SATU hasil
const nGanda = `${dasarNama} 150X200X3CM R58`; const kG = kunci("ganda"); const bodyG = po([baris(nGanda, 4, 120_000, { kodeSupplier: `REH-${stamp}-G` })]); const jC0 = await jejak();
const dobel = await Promise.all([H("POST", PO, t1, bodyG, kG), H("POST", PO, t1, bodyG, kG)]); const susulan = await H("POST", PO, t1, bodyG, kG); const jC1 = await jejak();
cek("klik ganda (paralel + susulan) dengan kunci sama: tepat SATU PO dan SATU material baru; respons susulan = PO yang sama", dobel.some((x) => x.status === 201) && dobel.every((x) => [200, 201, 409].includes(x.status)) && [200, 201].includes(susulan.status) && jC1.po === jC0.po + 1 && jC1.material === jC0.material + 1, `${dobel.map((x) => x.status)} ${susulan.status}`);

// ── D. ambigu butuh keputusan; duplikat antar-baris ditunjuk; gagal simpan tidak meninggalkan setengah jadi
const ambigu = `${dasarNama} R58`; const jD0 = await jejak();
const pvD = await H("POST", CEK_PO, t1, { supplierId: sup.id, barisBaru: [{ baris: 1, materialBaru: mb(ambigu) }] });
cek("nama tanpa ukuran terhadap varian ber-ukuran = AMBIGU: perlu konfirmasi (bukan sama, bukan berbeda)", pvD.status === 200 && pvD.body?.baris?.[0]?.perluKonfirmasi === true && pvD.body.baris[0].diblokir === false, `${pvD.status}`);
const tolakD = await H("POST", PO, t1, po([baris(`${dasarNama} 175X200X3CM R58`), baris(ambigu)]), kunci("amb"));
cek("simpan tanpa keputusan ditolak 409 SKU_MIRIP_BUTUH_KONFIRMASI menunjuk baris 2; baris 1 (varian sah) ikut dibatalkan: tidak ada setengah jadi", tolakD.status === 409 && tolakD.body?.code === "SKU_MIRIP_BUTUH_KONFIRMASI" && tolakD.body?.baris === 2 && sama(await jejak(), jD0), `${tolakD.status} ${tolakD.body?.code}`);
const kembar = [baris(`${dasarNama} 190X200X3CM R58`), baris(`busa  reh uji ${stamp} 190 x 200 x 3 cm r58`)]; const tolakK = await H("POST", PO, t1, po(kembar), kunci("kembar"));
cek("duplikat antar-baris (ejaan lain, baris sama): 409 SKU_DUPLIKAT_DALAM_PO menunjuk baris 2 = baris 1; tidak ada yang tertulis", tolakK.status === 409 && tolakK.body?.code === "SKU_DUPLIKAT_DALAM_PO" && tolakK.body?.baris === 2 && tolakK.body?.barisSama === 1 && sama(await jejak(), jD0), `${tolakK.status} ${tolakK.body?.code}`);
const tolakQ = await H("POST", PO, t1, po([baris(`${dasarNama} 195X200X3CM R58`), baris(`${dasarNama} 195X200X5CM R58`, 0)]), kunci("qty0"));
cek("baris tak sah (jumlah 0) setelah baris varian sah: ditolak 4xx; material baris 1 TIDAK tertinggal", tolakQ.status >= 400 && tolakQ.status < 500 && sama(await jejak(), jD0), `${tolakQ.status}`);
const kBetul = kunci("betul"); const gagalDulu = await H("POST", PO, t1, po([baris(`${dasarNama} 185X200X3CM R58`), baris(`${dasarNama} 120 X 200 X 2 cm R58`)]), kBetul);
const okLagi = await H("POST", PO, t1, po([baris(`${dasarNama} 185X200X3CM R58`), baris(`${dasarNama} 185X200X6CM R58`)]), kBetul);
cek("kunci yang gagal tidak terkunci: baris dibetulkan lalu simpan ulang berhasil utuh (201, 2 material baru, 1 PO)", gagalDulu.status === 409 && okLagi.status === 201 && (await jejak()).material === jD0.material + 2 && (await jejak()).po === jD0.po + 1, `${gagalDulu.status}/${okLagi.status}`);
const dgn = await H("POST", PO, t1, po([baris(`${dasarNama} 170X200X3CM R58`), baris(ambigu, 10, 150_000, { konfirmasiMirip: true, alasanMirip: "Barang berbeda: nama tanpa ukuran, ini varian lain (uji rehearsal)" })]), kunci("kons"));
cek("dengan konfirmasi + alasan: ambigu tersimpan; alasan tercatat pada asal SKU; varian sah di baris lain tanpa alasan paksaan", dgn.status === 201 && (await prisma.finMaterialSkuOrigin.count({ where: { duplicateOverrideReason: { contains: "uji rehearsal" } } })) === 1, `${dgn.status}`);

// ── E. dua pengguna menyimpan barang yang sama BERSAMAAN, urutan baris berlawanan
/* keluarga nama lain dari skenario D (yang sengaja membuat nama tanpa ukuran) */ const X = "PITA REH PARALEL 5 CM"; const Y = "PITA REH PARALEL 7 CM"; const jE0 = await jejak();
const [ra, rb] = await Promise.all([H("POST", PO, t1, po([baris(X, 10, 5_000, { kategori: "Aksesori" }), baris(Y, 10, 5_000, { kategori: "Aksesori" })]), kunci("e1")), H("POST", PO, t2, po([baris("pita  reh paralel 7cm", 10, 5_000, { kategori: "Aksesori" }), baris("Pita Reh Paralel 5 cm", 10, 5_000, { kategori: "Aksesori" })]), kunci("e2"))]); const jE1 = await jejak();
cek("dua pengguna bersamaan (urutan berlawanan): tepat satu 201 dan satu 409 SKU_DUPLIKAT_PASTI (tanpa deadlock/500); tepat 2 material baru dan 1 PO", [ra.status, rb.status].sort().join() === "201,409" && [ra, rb].some((x) => x.body?.code === "SKU_DUPLIKAT_PASTI") && jE1.material === jE0.material + 2 && jE1.po === jE0.po + 1, `${ra.status}/${rb.status} ${ra.body?.code ?? ""}/${rb.body?.code ?? ""}`);

// ── F. izin dan penegakan sebelum menulis
const jF0 = await jejak();
const f401 = await H("POST", PO, null, po([baris(`${dasarNama} 230X200X3CM R58`)]), kunci("f1")); const f403 = await H("POST", PO, tN, po([baris(`${dasarNama} 230X200X3CM R58`)]), kunci("f2")); const c403 = await H("POST", CEK_PO, tN, { supplierId: sup.id, barisBaru: [] }); const c401 = await H("POST", CEK_PO, null, { supplierId: sup.id, barisBaru: [] });
cek("izin: tanpa token 401; akun non-Admin 403 (simpan dan cek-duplikat-po); tidak ada tulisan", f401.status === 401 && f403.status === 403 && c403.status === 403 && c401.status === 401 && sama(await jejak(), jF0), `${f401.status}/${f403.status}/${c403.status}/${c401.status}`);

// ── F2. setelah SELURUH uji tulis: tidak satu pun baris material yang sudah ada berubah, hilang, atau berganti kode (BUS-008..015 ikut)
cek(`SETELAH seluruh uji: isi LENGKAP ${semuaId.length} baris material yang sudah ada identik (tidak dibuat ulang, diganti kode, digabung, diubah, atau dihapus; BUS-008..015: ${bus815.length ? bus815.join(", ") : "tidak ada di salinan"})`, (await sidik(semuaId)) === sidikSemua0 && (await num("select count(*)::int n from materials where id::text = any($1::text[])", semuaId)) === semuaId.length);

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
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; uji tulis PO/SKU dilakukan HANYA pada salinan restore lalu DB sementara dihapus"
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
COUNT_SQL="select 'materials', count(*) from materials union all select 'supplier_materials', count(*) from fin_supplier_materials union all select 'sku_origins', count(*) from fin_material_sku_origins union all select 'purchase_orders', count(*) from fin_purchase_orders union all select 'purchase_order_lines', count(*) from fin_purchase_order_lines union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'stock_movements', count(*) from stock_movements union all select 'journal_entries', count(*) from fin_journal_entries union all select 'journal_lines', count(*) from fin_journal_lines union all select 'material_issues', count(*) from material_issues"
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pra-switch.txt" || die "hitung baris pra-switch gagal"; ok "pra-switch: hitung baris material/katalog/asal SKU/PO/Harga Berlaku/stok/jurnal dicatat"
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
if diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" >/dev/null; then ok "hitung baris material/katalog/asal SKU/PO/Harga Berlaku/stok/jurnal IDENTIK sebelum vs sesudah switch"; else warn "hitung baris berbeda sebelum vs sesudah switch (kemungkinan aktivitas pengguna sungguhan selama jendela rilis; skrip tidak menulis):"; diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" | sed 's/^/        /' || true; fi
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: pratinjau cek-duplikat-po pada katalog nyata, izin (401/403), penolakan sebelum menulis; tanpa PO/material percobaan; isi baris material (termasuk BUS-008..015) identik"
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
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang dipakai hanya pratinjau cek-duplikat-po (baca-saja) dan PENOLAKAN sebelum menyentuh data (tanpa token, tanpa izin, masukan tidak sah).
// Tidak ada PO dan tidak ada material percobaan yang dibuat. Jejak tulis (material, katalog supplier, asal SKU, PO, Harga Berlaku, stok, jurnal) dan isi material nyata harus identik sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const post = async (p, token, body = {}, hdr = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...hdr }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const finAdmin = info.find((x) => bisa(x.rs, P.FINANCE_ADMIN))?.u; const bukanAdmin = info.find((x) => !bisa(x.rs, P.FINANCE_ADMIN))?.u;
if (!finAdmin) { rec("akun Finance Admin (finance:admin) tersedia", false); process.exit(1); }
const tA = await tokenUntuk(finAdmin); const tN = bukanAdmin ? await tokenUntuk(bukanAdmin) : null;
const jejak = async () => ({
  material: await hitung("select count(*)::int n from materials"), katalog: await hitung("select count(*)::int n from fin_supplier_materials"), asal: await hitung("select count(*)::int n from fin_material_sku_origins"),
  po: await hitung("select count(*)::int n from fin_purchase_orders"), poBaris: await hitung("select count(*)::int n from fin_purchase_order_lines"), harga: await hitung("select count(*)::int n from material_harga_berlaku"),
  stok: await hitung("select count(*)::int n from stock_movements"), jurnal: await hitung("select count(*)::int n from fin_journal_entries"),
});
// isi LENGKAP semua material bahan baku (BUS-*): tidak boleh berubah apa pun (delapan BUS-008..015 ikut terjaga)
const sidikMaterial = async () => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(m::text, '|' order by m.id::text)), '-') as n from materials m"))[0].n);
const s0 = await jejak(); const h0 = await sidikMaterial();
const PO = "/api/finance/purchase-orders"; const CEK_PO = `${PO}/sku/cek-duplikat-po`;
const sup = (await prisma.$queryRawUnsafe("select id::text id from fin_suppliers order by created_at asc limit 1"))[0]?.id;
if (!sup) { rec("ada supplier di katalog", false); process.exit(1); }
const mb = (nama) => ({ nama, kategori: "Busa", jenis: "BAHAN_PRODUKSI", spesifikasi: null, satuanBeli: "SHEET", satuanStok: "SHEET" });

// ── pratinjau baca-saja pada katalog NYATA
const nyata = await prisma.$queryRawUnsafe("select id::text id, code, name, unit from materials where active = true and code like 'BUS-%' and name ~ '[0-9]+ ?[xX×] ?[0-9]+' order by (code between 'BUS-008' and 'BUS-015') desc, code limit 8");
if (nyata.length >= 1) {
  const pv = await post(CEK_PO, tA, { supplierId: sup, barisBaru: nyata.map((m, i) => ({ baris: i + 1, materialBaru: { ...mb(m.name), satuanStok: m.unit, satuanBeli: m.unit } })) });
  rec(`cek-duplikat-po (${nyata.length} nama material NYATA): 200 dan setiap baris menunjuk kode materialnya sendiri sebagai SAMA (diblokir, diarahkan ke katalog)`, pv.status === 200 && pv.json?.bolehSimpan === false && (pv.json?.baris ?? []).length === nyata.length && pv.json.baris.every((r, i) => r.diblokir === true && (r.pasti ?? []).some((c) => c.materialId === nyata[i].id)), `${pv.status} ${JSON.stringify((pv.json?.baris ?? []).map((r) => r.pasti?.[0]?.kode))}`.slice(0, 220));
  const m = nyata[0]; const tebal = m.name.replace(/(\d+(?:[.,]\d+)?\s*[xX×]\s*\d+(?:[.,]\d+)?\s*[xX×]\s*)\d+(?:[.,]\d+)?/, (_, depan) => depan + "97");
  if (tebal !== m.name) {
    const pb = await post(CEK_PO, tA, { supplierId: sup, barisBaru: [{ baris: 1, materialBaru: { ...mb(tebal), satuanStok: m.unit, satuanBeli: m.unit } }] });
    rec(`varian dengan ketebalan jelas berbeda ("${tebal}") TIDAK diblokir dan TIDAK butuh konfirmasi/alasan; ditampilkan sebagai saran serupa`, pb.status === 200 && pb.json?.bolehSimpan === true && pb.json.baris[0].diblokir === false && pb.json.baris[0].perluKonfirmasi === false && pb.json.baris[0].pasti.length === 0, `${pb.status} ${JSON.stringify(pb.json?.baris?.[0] ?? {}).slice(0, 160)}`);
  } else skip("varian ketebalan berbeda dari nama nyata", "nama material nyata pertama tidak memuat ukuran tiga dimensi (PxLxT)");
} else skip("pratinjau pada material nyata BUS-*", "tidak ada material BUS-* beraturan ukuran di katalog");
const asing = await post(CEK_PO, tA, { supplierId: sup, barisBaru: [{ baris: 1, materialBaru: mb("ZZ UJI ASING 997X998X9 CM QQ") }, { baris: 2, materialBaru: mb("ZZ UJI ASING 997X998X9 cm qq") }] });
rec("dua baris yang sama setelah normalisasi pada form yang sama: baris ke-2 ditunjuk sebagai duplikat dalam PO (SATU baris diblokir, baris ke-1 tidak)", asing.status === 200 && asing.json?.bolehSimpan === false && asing.json.baris[0].diblokir === false && asing.json.baris[1].diblokir === true && asing.json.baris[1].dalamPO === true, `${asing.status}`);

// ── penolakan SEBELUM menulis
rec("cek-duplikat-po tanpa token = 401", (await post(CEK_PO, null, { supplierId: sup, barisBaru: [] })).status === 401);
rec("simpan PO tanpa token = 401 (tidak menulis)", (await post(PO, null, { supplierId: sup, lines: [] }, { "Idempotency-Key": "smoke-pbm-tidak-menulis-0001" })).status === 401);
if (tN) { rec("cek-duplikat-po akun non-Admin Finance = 403", (await post(CEK_PO, tN, { supplierId: sup, barisBaru: [] })).status === 403); rec("simpan PO dengan barang baru oleh non-Admin = 403 (tidak menulis)", (await post(PO, tN, { supplierId: sup, orderDate: "2026-10-29", lines: [{ materialBaru: mb("ZZ UJI ASING 997X998X9 CM QQ"), qty: 1, unitPrice: 1 }] }, { "Idempotency-Key": "smoke-pbm-tidak-menulis-0002" })).status === 403); } else skip("akun non-Admin Finance ditolak 403", "tidak ada akun non-Admin aktif (diuji di rehearsal)");
rec("cek-duplikat-po dengan nama kosong = 4xx (tidak menulis)", (await post(CEK_PO, tA, { supplierId: sup, barisBaru: [{ baris: 1, materialBaru: mb("") }] })).status >= 400);

const s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]); const h1 = await sidikMaterial();
rec("TIDAK ada jejak tulis: material, katalog supplier, asal SKU, PO, baris PO, Harga Berlaku, stok, jurnal sama persis sebelum vs sesudah smoke", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "identik");
rec("isi LENGKAP semua baris material (termasuk BUS-008..015) identik sebelum vs sesudah smoke (tidak dibuat ulang/diganti kode/digabung/dihapus)", h0 === h1, h0 === h1 ? "identik" : `${h0} → ${h1}`);
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
  ok "smoke test lulus (pratinjau cek-duplikat-po, izin, penolakan sebelum menulis, tanpa jejak tulis, sidik isi material identik, invarian)"
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
say "CATATAN: Rilis ini membawa pencocokan barang mirip pada Purchase Order Baru (SAMA / varian BERBEDA / AMBIGU; aksi penyelesaian per baris; cek duplikat antar-baris sebelum simpan). TANPA migrasi. Rilis TIDAK membuat PO, material, katalog supplier, stok, jurnal, atau Harga Berlaku, dan TIDAK menyentuh BUS-008..015; perubahan nyata baru terjadi saat Admin Finance menyimpan PO."
