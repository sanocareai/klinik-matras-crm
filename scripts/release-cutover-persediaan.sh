#!/usr/bin/env bash
# RILIS PERBAIKAN BATAS CUTOVER PERSEDIAAN: BACKEND-SAJA, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA).
#   • ISI: (1) penerimaan yang ditulis sesudah waktu hitung Persediaan Awal tetap dijurnal walau tanggal terimanya sebelum cutover; (2) tanggal buku pergerakan dan tanggal terima memakai hari bisnis WIB;
#     (3) kuantitas Persediaan Awal disimpan 4 desimal tanpa pembulatan; (4) Pengembalian Bahan Produksi menolak jumlah yang diajukan sebelum transisi satuan.
#   • Skrip rilis TIDAK mengubah cutover, TIDAK membatalkan atau memposting PSA, TIDAK menghidupkan sakelar stok resmi, TIDAK menyelesaikan gap, TIDAK menulis harga, jurnal, atau stok.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru sebagai SERVER terhadap salinan restore data nyata); build web di release dir (sumber web tidak berubah); switch; smoke baca-saja.
#   • PENGUNCIAN: kunci deploy BERSAMA + kunci sendiri diambil ATOMIK; kepemilikan ditentukan proses (perangkat:inode fd 7/9), BUKAN nama berkas.
#     Pembersihan release lama DINONAKTIFKAN; gerbang disk minimal 5 GiB tidak diturunkan.
#
#   cat scripts/release-cutover-persediaan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/cpb.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/cpb.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/cpb.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/cpbr.out 2>&1 < /dev/null &'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/cpb.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/cpb.out 2>&1 < /dev/null &'   # rilis penuh; HANYA dengan izin Owner
#
# ROLLBACK: tanpa migrasi, tetapi rollback TIDAK dinyatakan aman otomatis: kode lama membuka kembali celah jurnal penerimaan dan tanggal UTC. Sesudah ada transisi satuan wajib scripts/rollback-guard-transisi-satuan.sh.
# (dibangkitkan oleh scripts/gen-release-cutover-persediaan.cjs dari scripts/release-cutover-persediaan.sh + scripts/templates/release-cutover-persediaan/* + pustaka scripts/lib/{rehearsal,smoke}-cutover-persediaan.mjs; JANGAN edit tangan)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/cutover-persediaan-on-1be098c6}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/src/routes/goodsReceipt\.js|backend/src/services/finance/persediaanAwal\.js|backend/src/services/finance/posting/inventory\.js|backend/src/services/finance/posting/supplier\.js|backend/src/services/productionMaterialReturnService\.js|backend/src/services/warehouseCorrection\.js|backend/tests/cutoverPersediaanBatas\.test\.js|scripts/gen-release-cutover-persediaan\.cjs|scripts/lib/rehearsal-cutover-persediaan\.mjs|scripts/lib/smoke-cutover-persediaan\.mjs|scripts/release-cutover-persediaan\.sh|scripts/templates/release-cutover-persediaan/fitur-dist\.txt|scripts/templates/release-cutover-persediaan/header\.txt|scripts/templates/release-cutover-persediaan/rollback\.txt)$'
BACKEND_SRC_EXPECT="backend/src/routes/goodsReceipt.js backend/src/services/finance/persediaanAwal.js backend/src/services/finance/posting/inventory.js backend/src/services/finance/posting/supplier.js backend/src/services/productionMaterialReturnService.js backend/src/services/warehouseCorrection.js"
FRONTEND_SRC_EXPECT=""
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
BK_DIR="$HOME/release-backups/cutover-persediaan-${DEPLOY_SHORT}-${TS}"
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
Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya. Rollback kode TIDAK dinyatakan aman otomatis. Bila rollback diputuskan setelah switch:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   (recreate backend dari folder release sebelumnya dengan image rollback; web = dist folder sebelumnya)
BATAS ROLLBACK: kode lama membulatkan kuantitas PSA ke 2 desimal, tidak menjurnal penerimaan bertanggal mundur sesudah PSA, dan memakai tanggal UTC. Jangan memposting PSA selama kode lama berjalan. Karena sudah ada transisi satuan tersimpan, wajib scripts/rollback-guard-transisi-satuan.sh dan evaluasi kompatibilitas.
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

# >>> KUNCI-DEPLOY (blok ini DIUJI TERISOLASI di rehearsal: dimuat ulang dari berkas skrip ini ke proses anak dengan LOCK_DIR sementara; production tidak disentuh)
# Penguncian deploy. Kepemilikan kunci ditentukan oleh PROSES (berkas yang dibuka dan dikunci oleh proses ini: perangkat+inode fd 7/9), BUKAN oleh nama berkas.
#   - kunci sendiri  : release-cutover-persediaan.lock  (fd 9) — satu instansi rilis ini.
#   - kunci bersama  : release-deploy-bersama.lock (fd 7) — mutex deploy bersama; diambil ATOMIK (flock) SEBELUM memeriksa kunci lain, supaya dua proses yang mulai bersamaan tidak sama-sama lolos.
# Berkas pemilik (*.owner, bukan *.lock) hanya untuk diagnosis (pid/waktu/SHA/token); keputusan "milik sendiri" TIDAK bergantung padanya.
LOCK_DIR="${LOCK_DIR:-/tmp}"
KUNCI_SENDIRI="${LOCK_DIR}/release-cutover-persediaan.lock"
KUNCI_BERSAMA="${LOCK_DIR}/release-deploy-bersama.lock"
KUNCI_LAIN=""
kunci_ambil() {
  KUNCI_TOKEN="pid=$$ mulai=$(date -u +%FT%TZ) sha=${DEPLOY_SHORT:-?} token=${RANDOM}${RANDOM}${RANDOM}"
  mkdir -p "$LOCK_DIR"
  exec 7>>"$KUNCI_BERSAMA"
  flock -n 7 || die "kunci deploy BERSAMA (${KUNCI_BERSAMA}) dipegang proses lain ($(kunci_pemegang "$KUNCI_BERSAMA")) — deploy lain sedang berjalan"
  exec 9>>"$KUNCI_SENDIRI"
  flock -n 9 || die "rilis ini sudah berjalan ($(kunci_pemegang "$KUNCI_SENDIRI"))"
  printf '%s\n' "$KUNCI_TOKEN" > "${KUNCI_BERSAMA%.lock}.owner"
  printf '%s\n' "$KUNCI_TOKEN" > "${KUNCI_SENDIRI%.lock}.owner"
}
# Pemilik yang tercatat (diagnosis saja).
kunci_pemegang() { local o="${1%.lock}.owner"; if [ -s "$o" ]; then head -c 200 "$o" | tr '\n' ' '; else printf 'pemilik tidak tercatat'; fi; }
# 0 bila berkas $1 adalah berkas yang DIBUKA dan DIKUNCI proses ini (fd 7 atau 9): identitas = perangkat:inode, bukan nama.
kunci_milik_sendiri() {
  local lf="$1" fd
  for fd in 7 9; do
    [ -e "/proc/$$/fd/$fd" ] || continue
    [ "$(stat -Lc '%d:%i' "$lf" 2>/dev/null)" = "$(stat -Lc '%d:%i' "/proc/$$/fd/$fd" 2>/dev/null)" ] && return 0
  done
  return 1
}
# 0 = tidak ada kunci rilis LAIN yang dipegang; 1 = ada (nama di KUNCI_LAIN). Kunci milik proses ini dilewati berdasarkan kepemilikan; berkas dibuka read-only supaya tidak memotong isinya.
kunci_cek_lain() {
  local lf
  KUNCI_LAIN=""
  for lf in "$LOCK_DIR"/release-*.lock; do
    [ -e "$lf" ] || continue
    kunci_milik_sendiri "$lf" && continue
    if ! ( exec 8<"$lf"; flock -n 8 ); then KUNCI_LAIN="$lf"; return 1; fi
  done
  return 0
}
# Proses deploy/build/migrasi di luar pohon proses ini (leluhur: nohup/ssh/shell; keturunan: build/compose yang kita jalankan sendiri). Mencetak baris "PID perintah".
proses_lain() {
  local anc=" " p="$$" pid cmd q hit
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do anc="${anc}${p} "; p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"; done
  pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' 2>/dev/null | while IFS= read -r baris; do
    pid="${baris%% *}"; cmd="${baris#* }"
    case "$cmd" in *pgrep*|*"node src/index.js"*) continue;; esac
    case "$anc" in *" ${pid} "*) continue;; esac
    q="$pid"; hit=0
    while [ -n "$q" ] && [ "$q" -gt 1 ] 2>/dev/null; do [ "$q" = "$$" ] && { hit=1; break; }; q="$(ps -o ppid= -p "$q" 2>/dev/null | tr -d ' ')"; done
    [ "$hit" = "1" ] || printf '%s\n' "$baris"
  done
}
# <<< KUNCI-DEPLOY
# UJI TERARAH FASE PRA-SWITCH — dijalankan di rehearsal (tanpa switch, tanpa menyentuh kunci production: LOCK_DIR sementara).
#   (1) kunci sendiri diterima; kunci basi (tidak dipegang) tidak memblokir;
#   (2) kunci rilis LAIN yang dipegang ditolak — termasuk kunci dengan NAMA YANG SAMA dengan kunci sendiri bila bukan milik proses ini (kepemilikan, bukan nama);
#   (3) dua proses tidak bisa memasuki bagian kritis bersamaan (tepat satu masuk, satu ditolak; sesudah keluar, kunci bebas lagi);
#   (4) proses deploy lain terdeteksi, sedangkan proses leluhur/keturunan sendiri tidak dianggap "lain";
#   (5) baseline/identitas live yang bergeser MENGHENTIKAN switch (gerbang_kode_live yang SAMA dengan fase 7 dijalankan dengan keadaan yang dimutasi → harus berhenti).
uji_gerbang_kunci() {
  local SELF T HP res i n
  SELF="${UJI_SELF:-$(readlink -f "${BASH_SOURCE[0]:-$0}")}"
  T="$(mktemp -d /tmp/uji-kunci-XXXXXX)"; mkdir -p "$T/lock"
  sed -n '/^# >>> KUNCI-DEPLOY/,/^# <<< KUNCI-DEPLOY/p' "$SELF" > "$T/kunci.sh"
  [ "$(grep -c . "$T/kunci.sh")" -gt 40 ] || { rm -rf "$T"; die "uji kunci: blok KUNCI-DEPLOY tidak terbaca dari ${SELF}"; }
  K() { LOCK_DIR="$T/lock" DEPLOY_SHORT=uji bash -c 'die() { echo "DIE: $*"; exit 9; }; . "$1"; eval "$2"' _ "$T/kunci.sh" "$1"; }
  tunggu_berkas() { local k; for k in $(seq 1 50); do [ -e "$1" ] && return 0; sleep 0.1; done; return 1; }
  gagal_uji() { [ -z "${HP:-}" ] || kill "$HP" 2>/dev/null || true; rm -rf "$T"; die "uji kunci: $*"; }
  # (1) kunci sendiri diterima + kunci basi tidak memblokir
  : > "$T/lock/release-basi.lock"
  res="$(K 'kunci_ambil; kunci_cek_lain && echo SENDIRI-DITERIMA' 2>&1)" || gagal_uji "kunci sendiri DITOLAK: ${res}"
  printf '%s' "$res" | grep -q 'SENDIRI-DITERIMA' || gagal_uji "kunci sendiri tidak diterima: ${res}"
  # (2) kunci rilis lain ditolak
  bash -c 'exec 8>>"$1"; flock -n 8; : > "$2"; exec sleep 25' _ "$T/lock/release-lain.lock" "$T/lain.siap" & HP=$!
  tunggu_berkas "$T/lain.siap" || gagal_uji "pemegang kunci lain tidak siap"
  res="$(K 'kunci_ambil; kunci_cek_lain; rc=$?; echo "RC=$rc LAIN=$KUNCI_LAIN"; exit $rc' 2>&1)" && gagal_uji "kunci rilis LAIN lolos: ${res}"
  printf '%s' "$res" | grep -q 'RC=1 LAIN=.*release-lain.lock' || gagal_uji "kunci lain ditolak tetapi bukan karena release-lain.lock: ${res}"
  kill "$HP" 2>/dev/null || true; wait "$HP" 2>/dev/null || true; HP=""
  res="$(K 'kunci_ambil; kunci_cek_lain && echo SENDIRI-DITERIMA' 2>&1)" || gagal_uji "kunci tidak bebas lagi setelah pemegang lain berhenti: ${res}"
  # (3) NAMA sama dengan kunci sendiri tetapi dipegang proses lain: tidak boleh dianggap milik sendiri
  rm -f "$T/lain.siap"
  bash -c 'exec 8>>"$1"; flock -n 8; : > "$2"; exec sleep 25' _ "$T/lock/release-cutover-persediaan.lock" "$T/lain.siap" & HP=$!
  tunggu_berkas "$T/lain.siap" || gagal_uji "pemegang kunci bernama sama tidak siap"
  res="$(K 'kunci_ambil' 2>&1)" && gagal_uji "instansi kedua rilis ini LOLOS saat kunci sendiri dipegang proses lain: ${res}"
  printf '%s' "$res" | grep -q 'sudah berjalan' || gagal_uji "penolakan instansi kedua bukan 'sudah berjalan': ${res}"
  res="$(K 'kunci_cek_lain; rc=$?; echo "RC=$rc LAIN=$KUNCI_LAIN"; exit $rc' 2>&1)" && gagal_uji "kunci ber-NAMA sendiri tetapi milik proses lain dilewati hanya karena namanya: ${res}"
  printf '%s' "$res" | grep -q 'LAIN=.*release-cutover-persediaan.lock' || gagal_uji "kunci bernama sama tidak dilaporkan: ${res}"
  kill "$HP" 2>/dev/null || true; wait "$HP" 2>/dev/null || true; HP=""
  # (4) bagian kritis: dua proses bersamaan → tepat satu masuk
  : > "$T/kritis.log"
  PIDS=()
  for i in 1 2; do
    ( while [ ! -e "$T/go" ]; do :; done; { K "kunci_ambil; echo masuk >> '$T/kritis.log'; sleep 3; echo keluar >> '$T/kritis.log'" > "$T/c$i.out" 2>&1; echo $? > "$T/c$i.rc"; } || true ) & PIDS+=($!)
  done
  # JANGAN 'wait' tanpa argumen: di skrip rilis ada proses latar lain (tee pencatat log) yang tidak pernah selesai → macet.
  sleep 0.5; : > "$T/go"; wait "${PIDS[@]}" || true
  [ "$(grep -c '^masuk$' "$T/kritis.log")" = "1" ] && [ "$(grep -c '^keluar$' "$T/kritis.log")" = "1" ] || gagal_uji "bagian kritis dimasuki != 1 proses: $(tr '\n' ' ' < "$T/kritis.log")"
  [ -s "$T/c1.rc" ] && [ -s "$T/c2.rc" ] || gagal_uji "salah satu proses bagian kritis tidak selesai"
  [ "$(cat "$T"/c1.rc "$T"/c2.rc | grep -c '^0$')" = "1" ] && [ "$(cat "$T"/c1.out "$T"/c2.out | grep -c '^DIE:')" = "1" ] || gagal_uji "tepat satu proses harus ditolak: rc=$(cat "$T"/c1.rc "$T"/c2.rc | tr '
' ' ')"
  res="$(K 'kunci_ambil; echo BEBAS-LAGI' 2>&1)" || gagal_uji "kunci tidak bebas setelah proses keluar: ${res}"
  # (5) deteksi proses deploy lain (yatim, di luar pohon proses ini); leluhur/keturunan sendiri tidak dihitung
  ( setsid bash -c 'exec -a release-uji-lain.sh sleep 20' >/dev/null 2>&1 & )
  sleep 1
  n="$(proses_lain | grep -c 'release-uji-lain' || true)"; pkill -f 'release-uji-lain.sh 20' 2>/dev/null || true
  [ "$n" -ge 1 ] || gagal_uji "proses deploy lain (release-uji-lain.sh) tidak terdeteksi"
  ( exec -a release-uji-anak.sh sleep 20 ) & HP=$!
  sleep 1
  n="$(proses_lain | grep -c 'release-uji-anak' || true)"; kill "$HP" 2>/dev/null || true; wait "$HP" 2>/dev/null || true; HP=""
  [ "$n" = "0" ] || gagal_uji "proses KETURUNAN sendiri dianggap deploy lain"
  rm -rf "$T"
  ok "uji pra-switch (terisolasi): kunci sendiri diterima; kunci basi tidak memblokir; kunci rilis lain ditolak; kunci ber-nama sama tetapi bukan milik proses ditolak; 2 proses bersamaan → 1 masuk, 1 ditolak, kunci bebas lagi; proses deploy lain terdeteksi"
}
# Baseline/identitas live bergeser harus MENGHENTIKAN switch: fungsi gerbang YANG SAMA dengan fase 7, dijalankan di subshell dengan keadaan dimutasi — harus berhenti (exit ≠ 0) dengan alasan yang benar.
uji_baseline_bergeser() {
  local nama mut pola log
  for nama in "baseline-bergeser" "container-dimulai-ulang" "image-berganti"; do
    case "$nama" in
      baseline-bergeser)       mut='BASE_SHA="$(sg rev-parse "${BASE_SHA}^")"'; pola='BUKAN baseline/leluhur baseline';;
      container-dimulai-ulang) mut='PREV_STARTED="1970-01-01T00:00:00Z"';         pola='dimulai ulang sejak audit awal';;
      image-berganti)          mut='PREV_IMG_ID="sha256:0000000000000000"';       pola='image container berubah sejak audit awal';;
    esac
    log="$BK_DIR/uji-gerbang-${nama}.log"
    if ( eval "$mut"; gerbang_kode_live "uji-negatif-${nama}" ) > "$log" 2>&1; then die "uji negatif: gerbang kode live MELOLOSKAN keadaan '${nama}' (switch tidak akan berhenti)"; fi
    grep -q -- "$pola" "$log" || { tail -n 5 "$log"; die "uji negatif '${nama}': gerbang berhenti tetapi bukan karena '${pola}'"; }
  done
  ok "uji negatif gerbang pra-switch: baseline bergeser, container dimulai ulang, dan image berganti — SEMUA menghentikan switch (alasan sesuai)"
}

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
kunci_ambil   # kunci deploy BERSAMA + kunci sendiri, ATOMIK (flock), SEBELUM memeriksa yang lain
kunci_cek_lain || die "deploy lain sedang berjalan (kunci ${KUNCI_LAIN} dipegang; $(kunci_pemegang "$KUNCI_LAIN"))"
OTHER="$(proses_lain)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain (kunci bersama + kunci sendiri dipegang proses ini; tidak ada kunci rilis lain yang dipegang; tidak ada proses deploy/build/migrasi lain)"
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
# PERBANDINGAN KODE container vs folder release (sebelum switch). Image backend dibangun SEBELUM dua berkas tes pemeriksa kontrak metrik ada, sedangkan folder release aktif (Verifikasi 691d8a01) sudah memuatnya.
# Yang BOLEH berbeda HANYA dua jalur ini (pencocokan jalur PERSIS, bukan seluruh tests/ dan bukan seluruh tests/helpers/); selisih lain (kode runtime, prisma, scripts, tes lain, berkas tambahan, package*.json) tetap menggagalkan gerbang.
bandingkan_kode() { # $1 = daftar sha container, $2 = daftar sha folder release; exit 0 bila sama selain dua berkas yang diizinkan
  local a b
  a="$(grep -vE '  tests/(financeKontrakMetrik\.test\.js|helpers/pemeriksaMetrikUi\.js)$' "$1" || true)"
  b="$(grep -vE '  tests/(financeKontrakMetrik\.test\.js|helpers/pemeriksaMetrikUi\.js)$' "$2" || true)"
  [ -n "$a" ] && [ "$a" = "$b" ]
}
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
  bandingkan_kode "$BK_DIR/container-sha.txt" "$BK_DIR/dir-sha.txt" || { diff "$BK_DIR/container-sha.txt" "$BK_DIR/dir-sha.txt" | head -10 | sed 's/^/        /'; die "[${label}] kode di dalam container BERBEDA dari folder release aktif ${d}"; }
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
# Sebelum migrasi dan tepat sebelum switch: pastikan tidak ada deploy/build/migrasi lain. Kunci milik proses ini dikenali dari KEPEMILIKAN (perangkat:inode fd 7/9), bukan dari nama berkas; kunci rilis lain, dalam nama apa pun, ditolak.
tidak_ada_deploy_lain_lagi() {
  local OTHER
  { kunci_milik_sendiri "$KUNCI_SENDIRI" && kunci_milik_sendiri "$KUNCI_BERSAMA"; } || die "kunci deploy milik proses ini HILANG/diganti (berkas kunci dihapus atau dibuat ulang) — berhenti"
  kunci_cek_lain || die "deploy lain mulai berjalan (kunci ${KUNCI_LAIN} dipegang; $(kunci_pemegang "$KUNCI_LAIN")) — berhenti"
  OTHER="$(proses_lain)"
  [ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain berjalan — berhenti"; }
  ok "[${PHASE}] tidak ada deploy/build/migrasi lain (kunci sendiri dikenali dari kepemilikan proses; tidak ada kunci rilis lain yang dipegang)"
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
for d in "$PREV_DIR" "$RELEASES"/*/ "$HOME/klinik-matras"; do
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
BACKUP_FILE="$HOME/backups/pre-cutover-persediaan-${DEPLOY_SHORT}-${TS}.sql.gz"
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
cari_dist() { find "$1/frontend/dist/assets" -maxdepth 1 -type f -name "*.$2" -print0 2>/dev/null | xargs -0 grep -lF -- "$3" 2>/dev/null | sed -n 1p; } # $1=release dir $2=js|css $3=teks tetap; BUKAN glob (>21.000 chunk melampaui ARG_MAX)
# Rilis backend-saja: sumber web TIDAK berubah. Fitur live (drawer satuan asal, Gudang/Finance/Produksi/Sales CRM) HARUS ada di KEDUANYA (daftar divalidasi terhadap dist aktif 7606e537).
for s2 in "satuan lama; saldo sekarang dalam" "referensi-satuan-tidak-cocok" "Tidak berlaku pada satuan" "Catat hasil SO" "Definisi dan sumber angka" "Siapa melihat nominal" "Rincian verifikasi nol" "gud-br-kartu-besar" "Satu dokumen, satu baris" "Lokasi dari riwayat penerimaan" "tidak langsung mengubah saldo" "Filter daftar bahan"; do
  [ -n "$(cari_dist "$PREV_DIR" js "$s2")" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar pembanding"
  [ -n "$(cari_dist "$NEW_DIR" js "$s2")" ] || die "dist baru KEHILANGAN teks fitur: ${s2}"
done
for c0 in ".gud-gerak" ".gud-stok-baris" ".gud-strip" ".gud-halaman" ".gud-br-baris" ".nip-k-besar" ".gud-menu-item"; do
  [ -n "$(cari_dist "$PREV_DIR" css "$c0")" ] || die "[skrip] '${c0}' tidak ada di CSS release aktif — perbaiki daftar pembanding"
  [ -n "$(cari_dist "$NEW_DIR" css "$c0")" ] || die "CSS baru KEHILANGAN ${c0}"
done

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-cpb-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
[ "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"
ok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR}: memuat hotfix performa (kode container == folder == baseline disetujui, terbukti gerbang kode live)"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_cpb_${TS}"
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
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): batas cutover persediaan: presisi kuantitas PSA, posting dan pembalikan, penerimaan sesudah waktu hitung; UJI TULIS HANYA pada salinan (DB rehearsal_*, dibuang)
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji batas cutover terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
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
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const SMOKE_SRC = "import { createRequire } from \"node:module\";\nimport { pathToFileURL } from \"node:url\";\nimport path from \"node:path\";\nconst require = createRequire(process.cwd() + \"/\");\nconst { PrismaClient } = require(\"@prisma/client\");\nconst prisma = new PrismaClient();\nconst BASE = process.env.SMOKE_BASE ?? \"http://127.0.0.1:4000\"; // rehearsal menjalankan kode smoke YANG SAMA terhadap salinan restore\nconst APP = process.env.APP_DIR ?? \"/app\";\nlet fail = 0;\nconst rec = (n, ok, d = \"\") => { if (!ok) fail++; console.log(`  ${ok ? \"PASS\" : \"FAIL\"}  ${n}${d ? \" — \" + String(d).slice(0, 240) : \"\"}`); };\n// SMOKE \"TIDAK MENULIS\" perbaikan batas cutover: hanya membaca. Rilis ini TIDAK mengubah cutover, PSA, sakelar stok resmi, atau data bisnis.\nconst imp = (p) => import(pathToFileURL(path.join(APP, p)).href);\nconst nilai = async () => ({\n  pengaturan: JSON.stringify(await prisma.$queryRawUnsafe(\"select key, value from fin_settings where key like 'inventory_%' or key like 'stok_resmi_%' order by key\")),\n  pembuka: JSON.stringify(await prisma.$queryRawUnsafe(\"select number, status::text status from fin_inventory_openings order by number\")),\n  baris_pembuka: Number((await prisma.$queryRawUnsafe(\"select count(*)::int n from fin_inventory_opening_lines\"))[0].n),\n});\nconst s0 = await nilai();\nrec(\"health 200\", (await fetch(BASE + \"/api/health\").then((r) => r.status, () => 0)) === 200);\nconst inv = await imp(\"src/services/finance/posting/inventory.js\").catch(() => null);\nrec(\"hari bisnis WIB terpasang\", typeof inv?.hariBisnisWIB === \"function\" && inv.hariBisnisWIB(new Date(\"2026-11-08T21:30:00.000Z\")).toISOString().slice(0, 10) === \"2026-11-09\");\nconst psa = await imp(\"src/services/finance/persediaanAwal.js\").catch(() => null);\nrec(\"penjaga penerimaan terlambat terpasang\", typeof psa?.penerimaanTercakupPembuka === \"function\");\nrec(\"sakelar stok resmi tidak dihidupkan oleh rilis\", !/\"value\":\"true\"/.test(s0.pengaturan));\nconst s1 = await nilai();\nrec(\"SMOKE tidak menulis: pengaturan persediaan, sakelar stok resmi, dan PSA sama\", JSON.stringify(s0) === JSON.stringify(s1));\nconsole.log(`SMOKE_HASIL fail=${fail} skip=0`);\nawait prisma.$disconnect();\nprocess.exit(fail === 0 ? 0 : 1);\n"; // diganti generator dengan isi smoke-cutover-persediaan.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji batas cutover hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL perbaikan batas cutover: kode BARU sebagai SERVER terhadap SALINAN RESTORE (DB rehearsal_*, dibuang). Bagian A = smoke fase 8b; Bagian B MENULIS hanya pada salinan.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4103); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

// ── A. SMOKE (kode yang sama dengan fase 8b) ──
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0];
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP|INFO)/.test(l)).join("\n"));
cek("SMOKE lulus terhadap salinan restore: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + String(sm.stderr).slice(-200));

// ── B. Batas cutover pada salinan ──
const P = await imp("src/services/finance/persediaanAwal.js");
const { setSetting, SETTING_KEYS } = await imp("src/services/finance/settings.js");
const { todayBookDateWIB } = await imp("src/services/finance/journal.js");
const tx = (fn) => prisma.$transaction(fn, { timeout: 120000, maxWait: 20000 });
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const pembuat = await prisma.user.findFirst({ where: { active: true }, orderBy: { id: "asc" }, select: { id: true } });
const pemeriksa = await prisma.user.findFirst({ where: { active: true, id: { not: pembuat.id } }, orderBy: { id: "asc" }, select: { id: true } });
const hari = todayBookDateWIB().toISOString().slice(0, 10);
const gerak0 = await num("select count(*)::int n from stock_movements");
const lama = await prisma.finInventoryOpening.findMany({ where: { status: "DRAFT" }, select: { id: true } });
await tx(async (t) => { for (const o of lama) await P.batalkanDraf(t, { openingId: o.id }); await setSetting(t, SETTING_KEYS.INVENTORY_CUTOVER_DATE, hari, pembuat.id); });
const o = await tx((t) => P.buatDraf(t, { userId: pembuat.id, notes: "Uji rehearsal" }));
const m = (await prisma.$queryRawUnsafe("select m.code, m.unit::text unit from materials m where m.code = 'LEM-I-SR-1037-13-KG'"))[0] ?? (await prisma.$queryRawUnsafe("select m.code, m.unit::text unit from materials m where m.active order by m.code limit 1"))[0];
await tx((t) => P.isiBaris(t, { openingId: o.id, rows: [{ kode: m.code, qty: "17.2231", satuan: m.unit, harga: "1000", sumber: "LAINNYA", penjelasanHarga: "Uji rehearsal presisi kuantitas" }], mode: "ganti", userId: pembuat.id }));
const baris = await prisma.finInventoryOpeningLine.findFirst({ where: { openingId: o.id } });
cek("PSA menyimpan kuantitas 4 desimal tanpa pembulatan", String(baris.qty) === "17.2231" && Number(baris.value) === 17223.1, `${baris.qty} / ${baris.value}`);
await tx((t) => P.periksa(t, { openingId: o.id, peran: "FINANCE", userId: pembuat.id })); await tx((t) => P.periksa(t, { openingId: o.id, peran: "GUDANG", userId: pemeriksa.id }));
const post = await tx((t) => P.postingPembuka(t, { openingId: o.id, userId: pembuat.id, reason: "Uji rehearsal" }));
const post2 = await tx((t) => P.postingPembuka(t, { openingId: o.id, userId: pembuat.id, reason: "Uji rehearsal" }));
cek("posting PSA satu kali, ulang tidak ganda", post.dibuat === true && post2.dibuat === false);
const grLama = await prisma.goodsReceipt.findFirst({ where: { status: "COMPLETED", receivedDate: { lt: new Date(`${hari}T00:00:00Z`) }, movements: { some: {} } }, select: { id: true, receivedDate: true } }).catch(() => null);
if (grLama) cek("GR yang sudah di ledger sebelum waktu hitung tetap tercakup", (await P.penerimaanTercakupPembuka(prisma, grLama.id, grLama.receivedDate)) === true);
cek("uji cutover tidak menambah pergerakan stok", (await num("select count(*)::int n from stock_movements")) === gerak0);
if (grLama) { const { postStockMovement } = await imp("src/services/inventoryLedger.js"); const contoh = await prisma.stockMovement.findFirst({ where: { goodsReceiptId: grLama.id, type: "RECEIPT" }, select: { materialId: true } }); await tx((t) => postStockMovement(t, { materialId: contoh.materialId, type: "RECEIPT", qty: 1, goodsReceiptId: grLama.id, createdById: pembuat.id, note: "Uji rehearsal" })); cek("RECEIPT tertulis sesudah waktu hitung tidak dianggap tercakup", (await P.penerimaanTercakupPembuka(prisma, grLama.id, grLama.receivedDate)) === false); }
const balik = await tx((t) => P.balikPembuka(t, { openingId: o.id, userId: pembuat.id, reason: "Uji rehearsal" }));
cek("pembalikan PSA resmi berhasil", balik.dibuat === true && balik.opening.status === "DIBALIK");
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
# direktori sementara dibuat root oleh kontainer: dihapus lewat kontainer (rm biasa ditolak); kegagalan pembersihan tidak menggagalkan rilis
dcp "$NEW_DIR" run --rm --no-deps -T -v "$BK_DIR:/bk" backend sh -c 'rm -rf /bk/reh-data /bk/reh-uploads /bk/reh-dd' </dev/null >/dev/null 2>&1 || true
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; uji tulis (PSA, posting, pembalikan) dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca lalu DB sementara dihapus"
PHASE="5c-uji-pra-switch"; say "5c. Uji fase pra-switch (TANPA switch): kunci sendiri/lain, bagian kritis, baseline bergeser; lalu gerbang yang SAMA dengan fase 7 pada production nyata"
uji_gerbang_kunci
uji_baseline_bergeser
tidak_ada_deploy_lain_lagi
gerbang_kode_live "rehearsal-pra-switch"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama rehearsal"
ok "fase pra-switch teruji: kunci/bagian kritis/baseline bergeser (terisolasi) + gerbang fase 7 pada production nyata LULUS tanpa switch"
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
tidak_ada_deploy_lain_lagi
COUNT_SQL="select 'stock_movements', count(*) from stock_movements union all select 'biaya_beku', count(*) from stock_movement_biaya_operasional union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'material_issues', count(*) from material_issues union all select 'jurnal', count(*) from fin_journal_entries union all select 'baris_jurnal', count(*) from fin_journal_lines union all select 'units', count(*) from units union all select 'order', count(*) from \"Order\" union all select 'jobs', count(*) from jobs union all select 'pernyataan', count(*) from unit_material_declarations union all select 'runs_v2', count(*) from production_runs_v2 union all select 'jadwal', count(*) from production_unit_schedules union all select 'custody', count(*) from unit_custody_handoffs_v2 union all select 'status_kerja', count(*) from production_unit_work_progress"
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pra-switch.txt" || die "hitung baris pra-switch gagal"; ok "pra-switch: hitung baris stok/biaya beku/harga/Material Issue/jurnal/unit/order/job/pernyataan/run/jadwal/custody/status kerja dicatat"
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
if diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" >/dev/null; then ok "hitung baris stok/biaya beku/harga/Material Issue/jurnal/unit/order/job/pernyataan/run/jadwal/custody/status kerja IDENTIK sebelum vs sesudah switch"; else warn "hitung baris berbeda sebelum vs sesudah switch (kemungkinan aktivitas pengguna sungguhan selama jendela rilis; skrip tidak menulis):"; diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" | sed 's/^/        /' || true; fi
PHASE="8b-smoke"; say "8b. Smoke baca-saja: fungsi batas cutover terpasang; pengaturan persediaan, sakelar stok resmi, dan PSA tidak berubah"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap salinan restore
const APP = process.env.APP_DIR ?? "/app";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
// SMOKE "TIDAK MENULIS" perbaikan batas cutover: hanya membaca. Rilis ini TIDAK mengubah cutover, PSA, sakelar stok resmi, atau data bisnis.
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const nilai = async () => ({
  pengaturan: JSON.stringify(await prisma.$queryRawUnsafe("select key, value from fin_settings where key like 'inventory_%' or key like 'stok_resmi_%' order by key")),
  pembuka: JSON.stringify(await prisma.$queryRawUnsafe("select number, status::text status from fin_inventory_openings order by number")),
  baris_pembuka: Number((await prisma.$queryRawUnsafe("select count(*)::int n from fin_inventory_opening_lines"))[0].n),
});
const s0 = await nilai();
rec("health 200", (await fetch(BASE + "/api/health").then((r) => r.status, () => 0)) === 200);
const inv = await imp("src/services/finance/posting/inventory.js").catch(() => null);
rec("hari bisnis WIB terpasang", typeof inv?.hariBisnisWIB === "function" && inv.hariBisnisWIB(new Date("2026-11-08T21:30:00.000Z")).toISOString().slice(0, 10) === "2026-11-09");
const psa = await imp("src/services/finance/persediaanAwal.js").catch(() => null);
rec("penjaga penerimaan terlambat terpasang", typeof psa?.penerimaanTercakupPembuka === "function");
rec("sakelar stok resmi tidak dihidupkan oleh rilis", !/"value":"true"/.test(s0.pengaturan));
const s1 = await nilai();
rec("SMOKE tidak menulis: pengaturan persediaan, sakelar stok resmi, dan PSA sama", JSON.stringify(s0) === JSON.stringify(s1));
console.log(`SMOKE_HASIL fail=${fail} skip=0`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else
  ok "smoke test lulus (batas cutover terpasang, tanpa jejak tulis)"
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
say "CATATAN: Rilis ini hanya perbaikan batas cutover persediaan, backend saja. TIDAK ada migrasi, cutover, PSA, jurnal, gap, sakelar stok resmi, atau harga yang diubah. Rollback TIDAK dinyatakan aman otomatis."
