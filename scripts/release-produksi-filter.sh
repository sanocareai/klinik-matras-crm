#!/usr/bin/env bash
# RILIS "FILTER ORDER PRODUKSI LENGKAP + RINGKASAN" (Produksi → Order Produksi: filter Posisi unit · PIC · Target selesai di server, Urutan di toolbar, chip filter aktif, Reset, lembar filter HP; Ringkasan: warna KPI tegas, panel mengikuti isi): WEB + BACKEND BACA-SAJA, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • Backend (aditif, BACA-SAJA): GET /api/production/work-orders, /work-orders/kelengkapan-hitung, dan /work-orders/export.xlsx menerima tiga parameter baru: posisi (daftar kunci posisi fisik; salah satu cocok), pic (nama persis atau ~tanpa) dan target (terlambat|hari_ini|tujuh_hari|belum_ada; hari menurut WIB).
#     Penyaringan dilakukan di SERVER atas seluruh hasil (baris yang sudah diperkaya, tanpa query per unit): total, hasMore, Muat berikutnya, hitungan, dan Excel mengikuti filter yang SAMA. Nilai tidak dikenal = 400 (bukan diabaikan). Izin tidak berubah (unit:read). Batas jalur penuh 5000 unit tetap (413 jujur).
#     Hitungan kelengkapan mengembalikan faset PIC (nama + jumlah, tanpaPic) secara aditif untuk pilihan filter. Info Ekspor mencatat filter baru.
#   • Frontend: Urutan pindah ke toolbar utama (tanpa baris "Terbaru dulu" ganda), "Semua status order"/"Semua status kerja", periode "Semua waktu", panel Filter lainnya (Posisi unit · PIC · Target · Kelengkapan + keterangan DAN/ATAU), chip filter aktif yang bisa dihapus + Reset
#     (tidak mengganti Aktif/Riwayat/Semua), lembar filter di HP, layanan dan ukuran dipisah, sumber status kerja Selesai diberi keterangan; Ringkasan: KPI #3965FA/#99B7FC/#E9EBFF + Menunggu mulai netral beraksen amber, sama di terang dan gelap; kolom kanan mengikuti isi.
#   • Rilis ini TIDAK membuat atau mengubah data bisnis: tidak ada tulis ke stok, Material Issue, harga, biaya beku, jurnal, unit, pernyataan, run, jadwal, atau status. Smoke pasca-switch hanya membaca; tidak ada transaksi uji di produksi.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore; invarian filter: partisi posisi, PIC = hitungan, target per hari WIB, halaman bertahap di luar 50 pertama, ekspor, waktu respons, izin, tanpa jejak tulis);
#     build web di release dir; switch SATU kali; verifikasi; smoke baca-saja pasca-switch (kode smoke yang sama dengan rehearsal; data identik sebelum vs sesudah).
#   • PENGUNCIAN: kunci deploy BERSAMA (release-deploy-bersama.lock) + kunci sendiri diambil ATOMIK sebelum memeriksa kunci/proses lain; kepemilikan ditentukan oleh proses (perangkat:inode fd 7/9), BUKAN nama berkas; diperiksa di fase 0,
#     sebelum persiapan akhir, dan tepat sebelum switch. Rehearsal MENGUJI logika ini (kunci sendiri/lain, bagian kritis, baseline bergeser) lalu gerbang fase 7 pada production nyata tanpa switch.
#   • BASELINE = release aktif. GERBANG IDENTITAS KODE LIVE membandingkan ISI kode (hash blob SEMUA berkas terlacak baseline, berkas tambahan, identitas proses) di fase 2, fase 6, dan TEPAT sebelum switch; selisih isi / berkas tambahan / proses
#     berganti = berhenti sebelum switch. Pembersihan release lama (fase 9) DINONAKTIFKAN: tidak ada folder release/image rollback/backup/volume yang dihapus oleh skrip. Gerbang disk (minimal 5 GiB) TIDAK diturunkan.
#
#   cat scripts/release-produksi-filter.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/pof.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/pof.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pof.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/pofr.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pof.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/pof.out 2>&1 < /dev/null &'   # rilis penuh
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru, tanpa data baru). Rollback hanya mengembalikan daftar Order Produksi dan Ringkasan ke tampilan sebelumnya; tidak ada data yang berubah.
# (dibangkitkan oleh scripts/gen-release-produksi-filter.cjs dari scripts/release-penjadwalan-langsung.sh + scripts/templates/release-produksi-filter/* + pustaka scripts/lib/{rehearsal,smoke}-produksi-filter.mjs; JANGAN edit tangan — ubah generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/produksi-ringkasan-filter-on-8aca40ac}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/src/lib/domain/filterDaftarOrderProduksi\.js|backend/src/services/productionOrderExport\.js|backend/src/services/productionOrderList\.js|backend/tests/filterDaftarOrderProduksi\.test\.js|frontend/src/features/production/ChipFilterAktif\.jsx|frontend/src/features/production/FilterLainnya\.jsx|frontend/src/features/production/PilihanUrutan\.jsx|frontend/src/features/production/orderProduksiModel\.js|frontend/src/pages/bengkel/ProductionRingkasan\.jsx|frontend/src/pages/bengkel/ProductionWorkOrders\.jsx|frontend/src/styles/sanss-produksi\.css|frontend/tests/kelengkapanOrderProduksi\.test\.js|frontend/tests/orderProduksiAdopsi\.test\.js|frontend/tests/orderProduksiFilterLengkap\.test\.js|frontend/tests/periodeOrderProduksi\.test\.js|scripts/gen-release-produksi-filter\.cjs|scripts/lib/gen-kunci-produksi-filter\.cjs|scripts/lib/rehearsal-produksi-filter\.mjs|scripts/lib/smoke-produksi-filter\.mjs|scripts/release-produksi-filter\.sh|scripts/templates/release-produksi-filter/cek-ulang-kunci\.txt|scripts/templates/release-produksi-filter/fase0-kunci\.txt|scripts/templates/release-produksi-filter/fitur-css\.txt|scripts/templates/release-produksi-filter/header\.txt|scripts/templates/release-produksi-filter/kunci\.txt|scripts/templates/release-produksi-filter/rehearsal-pra-switch\.txt|scripts/templates/release-produksi-filter/rollback\.txt|scripts/templates/release-produksi-filter/uji-pra-switch\.txt)$'
BACKEND_SRC_EXPECT="backend/src/lib/domain/filterDaftarOrderProduksi.js backend/src/services/productionOrderExport.js backend/src/services/productionOrderList.js"
FRONTEND_SRC_EXPECT="frontend/src/features/production/ChipFilterAktif.jsx frontend/src/features/production/FilterLainnya.jsx frontend/src/features/production/PilihanUrutan.jsx frontend/src/features/production/orderProduksiModel.js frontend/src/pages/bengkel/ProductionRingkasan.jsx frontend/src/pages/bengkel/ProductionWorkOrders.jsx frontend/src/styles/sanss-produksi.css"
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
BK_DIR="$HOME/release-backups/produksi-filter-${DEPLOY_SHORT}-${TS}"
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
Tujuan rollback = image dan folder release LIVE SEBELUM rilis ini; keduanya MEMUAT hotfix performa dan fitur live lain (gerbang kode live membuktikan kode di container == folder == baseline diset sebelum rilis).
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama kembali ke daftar Order Produksi tanpa filter posisi/PIC/target dan ke Ringkasan sebelumnya; parameter posisi/pic/target yang masih dikirim peramban lama diabaikan oleh kode lama.
Stok, Material Issue, harga, biaya beku, jurnal, unit, pernyataan, jadwal/Run, dan status tidak disentuh oleh rilis ini: tidak ada yang perlu dibalik.
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

# >>> KUNCI-DEPLOY (blok ini DIUJI TERISOLASI di rehearsal: dimuat ulang dari berkas skrip ini ke proses anak dengan LOCK_DIR sementara; production tidak disentuh)
# Penguncian deploy. Kepemilikan kunci ditentukan oleh PROSES (berkas yang dibuka dan dikunci oleh proses ini: perangkat+inode fd 7/9), BUKAN oleh nama berkas.
#   - kunci sendiri  : release-produksi-filter.lock  (fd 9) — satu instansi rilis ini.
#   - kunci bersama  : release-deploy-bersama.lock (fd 7) — mutex deploy bersama; diambil ATOMIK (flock) SEBELUM memeriksa kunci lain, supaya dua proses yang mulai bersamaan tidak sama-sama lolos.
# Berkas pemilik (*.owner, bukan *.lock) hanya untuk diagnosis (pid/waktu/SHA/token); keputusan "milik sendiri" TIDAK bergantung padanya.
LOCK_DIR="${LOCK_DIR:-/tmp}"
KUNCI_SENDIRI="${LOCK_DIR}/release-produksi-filter.lock"
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
  bash -c 'exec 8>>"$1"; flock -n 8; : > "$2"; exec sleep 25' _ "$T/lock/release-produksi-filter.lock" "$T/lain.siap" & HP=$!
  tunggu_berkas "$T/lain.siap" || gagal_uji "pemegang kunci bernama sama tidak siap"
  res="$(K 'kunci_ambil' 2>&1)" && gagal_uji "instansi kedua rilis ini LOLOS saat kunci sendiri dipegang proses lain: ${res}"
  printf '%s' "$res" | grep -q 'sudah berjalan' || gagal_uji "penolakan instansi kedua bukan 'sudah berjalan': ${res}"
  res="$(K 'kunci_cek_lain; rc=$?; echo "RC=$rc LAIN=$KUNCI_LAIN"; exit $rc' 2>&1)" && gagal_uji "kunci ber-NAMA sendiri tetapi milik proses lain dilewati hanya karena namanya: ${res}"
  printf '%s' "$res" | grep -q 'LAIN=.*release-produksi-filter.lock' || gagal_uji "kunci bernama sama tidak dilaporkan: ${res}"
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
BACKUP_FILE="$HOME/backups/pre-produksi-filter-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Semua status kerja" "Belum ada filter tambahan" "Filter digabung dengan DAN" "bukan bukti tahap kerja atau QC" "Cara filter digabung"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; [ -z "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks fitur baru '${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done
for s2 in "prod-app-logo" "Belum ada faktur tercatat" "Lengkapi nomor faktur supplier" "Ubah nomor faktur supplier" "Nomor supplier belum diisi" "Hanya nomor faktur supplier yang berubah" "Pencocokan bank belum aktif" "Rekening koran belum diimpor" "Kas fisik belum dihitung" "Saldo tidak tersedia — rekening nonaktif" "Pergerakan rekening menurut pembukuan" "hasil mungkin belum mencakup seluruh data" "Alur pembelian" "Estimasi belum masuk stok" "Rincian perhitungan" "Nilai PO belum tertutup pembayaran" "Bukan saldo utang supplier" "Pantau pesanan pembelian (PO) ke supplier" "Periksa bukti dan rekening tujuan sebelum pembayaran masuk pembukuan" "Klaim pembayaran dari Sales" "Dua antrean ini tidak dijumlahkan" "Berkas yang diunggah, bukan jaminan uangnya sudah masuk" "Pantau invoice, sisa tagihan, dan jatuh tempo" "Posisi terkini semua invoice, tanpa pilihan periode" "Nominal pembayaran mungkin belum tercatat" "Sisa tagihan belum lunas" "Dari 500 invoice terbaru, bukan seluruh data" "Sales Overview" "Deal Pipeline" "Top Performing Reps" "Needs Action" "Hot Leads" "Recent Activity" "Kasus Komplain Butuh Follow-up" "Lihat semua sales" "Buka Inbox" "Buka Pipeline" "crm-kpi-tile" "komplain perlu ditindaklanjuti" "sanss-crm-skin" "Tutup emoji" "inbox-page-head" "Nilai Penjualan Tim" "needs-action-daftar" "hot-leads-daftar" "aktivitas-toggle" "crm-pipe-baris" "crm-so-c" "crm-pipe-ikon" "topbar-searchfield" "sidebar-help-btn" "tab-chip-konteks" "Cari halaman atau menu" "workspace-switcher-ringkas" "crm-pel-tabel" "pelanggan-kolom:v1" "Kolom tambahan" "Total estimasi nilai" "Seret kartu ke sini" "crm-pipe-kolom" "Metrik lainnya" "Lihat cakupan angka" "crm-rk-alur" "rekon-tahap-tombol" "crm-pl-posisi" "bottleneck-info" "Rasio antar tahap" "crm-pt-tabel" "crm-ord-kolom" "crm-ord-kelengkapan" "Kelola biaya iklan" "Tren lead harian" "Rekonsiliasi Sales–Finance" "Leaderboard Sales" "Performa Sumber" "Sebaran Tahap" "crm-mk-kel" "tren-satu-titik" "crm-lap-metrik" "crm-lap-alert" "Posisi terbaru dalam pembukuan" "Tentang pencocokan saldo" "Tidak ada selisih tercatat" "Cara menghitung laba" "Gerbang verifikasi pembayaran" "Kenapa angkanya berbeda" "bukti terdeteksi" "Umur tagihan pelanggan" "Pencatatan terbaru" "Pemeriksaan angka" "Tidak ada kekurangan pencatatan yang terdeteksi" "Kategori aktif" "Biaya dicatat saat disetujui" "Ajukan kebutuhan divisi dan pantau prosesnya" "Panduan pengajuan" "Persetujuan dan pembayaran dilakukan melalui" "Tentang angka" "Alur pembelian" "Estimasi belum masuk stok" "jadi ini bukan total seluruh PO" "Rincian perhitungan" "Nilai PO belum tertutup pembayaran" "Bukan saldo utang supplier" "Pantau pesanan pembelian (PO) ke supplier" "Menyimpan draf dapat memperbarui Harga Berlaku bahan." "Sudah menerima faktur supplier?" "Supplier sudah memberi faktur?" "Cari supplier…" "Tahun sebelumnya" "Pakai termin supplier" "Arti status ini" "Cara membaca kolom item" "Pekerjaan hari ini" "Jadwal hari ini" "Lihat semua tahap" "Rework pelanggan" "Pilih tanggal target" "Ringkas tahap" "Kosongkan target" "Seret unit ke sini" "Tambah pemakaian" "Ganti bahan" "Ajukan perubahan" "Lihat dampak" "Konfirmasi & kurangi stok" "Harga Berlaku (HPP operasional)" "Bahan belum tercatat" "Detail teknis" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
# CSS: aturan HANYA di rilis ini (tidak ada di CSS release aktif) harus ada di dist baru; aturan fitur live (Finance, Produksi tahap 1-2, CRM) harus ada di KEDUANYA.
for c1 in ".prod-fl-dua" ".prod-ol-chip-aktif" ".prod-ol-urut-pemicu" ".prod-kolom" ".prod-kpi.netral"; do
  [ -z "$(grep -lF -- "$c1" "$PREV_DIR"/frontend/dist/assets/*.css 2>/dev/null | sed -n 1p)" ] || die "[skrip] ${c1} SUDAH ada di CSS release aktif — perbaiki daftar pembanding"
  [ -n "$(grep -lF -- "$c1" "$NEW_DIR"/frontend/dist/assets/*.css 2>/dev/null | sed -n 1p)" ] || die "CSS baru TIDAK memuat aturan ${c1}"
done
for c0 in ".prod-app-logo" ".prod-tv" ".prod-app" ".fin-pof-tabel" ".fin-pof-aksi" ".fin-pof-dobel" ".fin-ks-kartu" ".fin-ks-persamaan" ".fin-ks-trf" ".fin-ks-rincian" ".fin-ks-total" ".fin-ks-seg-item" ".fin-ks-baris" ".fin-po-baris" ".fin-po-bar" ".fin-po-strip" ".fin-poed-baris" ".fin-poed-popup" ".fin-pod-kartu" ".fin-vf-ringkasan" ".fin-vf-tabel" ".fin-vf-kartu" ".fin-vp-kepala" ".fin-vp-bukti-gulir" ".fin-vp-aksi-utama" ".fin-inv-baris" ".fin-inv-seg-item" ".fin-inv-kepala" ".fin-inv-peringatan-btn" ".fin-inv-r-bagian-judul" ".fin-inv-pintas" ".crm-dash" ".crm-skin" ".crm-pipe-isi" ".crm-utama" ".crm-so-c" ".topbar-searchfield" ".sidebar-help-btn" ".crm-ws-menu" ".tab-chip-konteks" ".crm-pel-tabel" ".crm-pel-bulk" ".stage-field" ".crm-pipe-toolbar" ".crm-pipe-kolom" ".ord-chip" ".crm-ord-toolbar" ".crm-ord-kolom" ".crm-lap" ".crm-ss-sebaran" ".crm-mk-tabel" ".crm-lap-alert" ".crm-rk-alur" ".crm-rk-tahap" ".crm-pl-posisi" ".crm-pt-legenda" ".fin-kpi-grid" ".fin-logo-merek" ".fin-lr-akhir" ".fin-tl-baris" ".fin-rek-item" ".fin-bk-item" ".fin-tg-stat" ".fin-umur-bar" ".fin-dua" ".fin-pill" ".fin-nav" ".fin-by-baris" ".fin-pbd-baris" ".fin-seg-item" ".fin-kpi-statis" ".fin-by-toolbar" ".fin-pbd-kosong" ".fin-po-baris" ".fin-po-bar" ".fin-po-strip" ".fin-poed-baris" ".fin-poed-popup" ".fin-poed-harga" ".fin-pod-kartu" ".fin-pod-item-tabel" ".fin-tgl-pop" ".fin-termin-panel" ".fin-select-pemicu" ".fin-pod-uraian-isi" ".fin-poed-faktur-pilih" ".fin-pod-petunjuk-faktur" ".prod-kpi" ".prod-panel" ".prod-toolbar" ".prod-tab-unit" ".prod-sumber" ".prod-st-ikon" ".prod-kartu" ".prod-tanggal" ".prod-rc-kartu" ".prod-rc-meja" ".prod-rc-hari" ".prod-pop" ".prod-rc-toast"; do
  [ -n "$(grep -lF -- "$c0" "$PREV_DIR"/frontend/dist/assets/*.css 2>/dev/null | sed -n 1p)" ] || die "[skrip] '${c0}' tidak ada di CSS release aktif — perbaiki daftar pembanding"
  [ -n "$(grep -lF -- "$c0" "$NEW_DIR"/frontend/dist/assets/*.css 2>/dev/null | sed -n 1p)" ] || die "CSS baru KEHILANGAN ${c0}"
done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-pof-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
[ "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"
ok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR}: memuat hotfix performa (kode container == folder == baseline disetujui, terbukti gerbang kode live)"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_pof_${TS}"
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
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): filter Order Produksi: partisi posisi unit, PIC = hitungan, target per hari WIB, halaman bertahap di luar 50 pertama, hitungan/ekspor mengikuti filter, validasi parameter, izin, waktu respons, tanpa jejak tulis (tanpa data uji).
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji filter Order Produksi terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
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
const SMOKE_SRC = "import { createRequire } from \"node:module\";\nimport { pathToFileURL } from \"node:url\";\nimport path from \"node:path\";\nconst require = createRequire(process.cwd() + \"/\");\nconst jwt = require(\"jsonwebtoken\");\nconst { PrismaClient } = require(\"@prisma/client\");\nconst ExcelJS = require(\"exceljs\");\nconst prisma = new PrismaClient();\nconst BASE = process.env.SMOKE_BASE ?? \"http://127.0.0.1:4000\"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)\nconst APP = process.env.APP_DIR ?? \"/app\";\nlet fail = 0; let dilewati = 0;\nconst rec = (n, ok, d = \"\") => { if (!ok) fail++; console.log(`  ${ok ? \"PASS\" : \"FAIL\"}  ${n}${d ? \" — \" + String(d).slice(0, 220) : \"\"}`); };\nconst skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };\n// SMOKE BACA-SAJA: filter daftar Order Produksi (posisi unit · PIC · target selesai) pada GET /api/production/work-orders, /work-orders/kelengkapan-hitung, dan /work-orders/export.xlsx.\n// Tidak ada tulisan dan tidak ada data percobaan. Kebenaran diperiksa dengan INVARIAN atas data nyata (bukan angka tetap): partisi, hitungan = daftar, setiap baris hasil memenuhi filternya,\n// halaman bertahap tidak menghilangkan/menggandakan unit di luar 50 pertama, ekspor = filter yang sama.\nconst { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, \"src/constants/permissions.js\")).href);\nconst rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);\nconst bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));\nconst tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: \"10m\" });\nconst hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);\nconst users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: \"asc\" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });\nconst pembaca = info.find((x) => bisa(x.rs, P.UNIT_READ))?.u;\nconst tanpaIzin = info.find((x) => !bisa(x.rs, P.UNIT_READ))?.u;\nif (!pembaca) { rec(\"akun dengan unit:read tersedia\", false); process.exit(1); }\nconst tok = await tokenUntuk(pembaca);\nconst W = \"/api/production/work-orders\";\nconst get = async (url, token = tok) => { const t0 = process.hrtime.bigint(); const r = await fetch(BASE + url, { headers: token ? { Authorization: \"Bearer \" + token } : {} }); let j = null; const ct = r.headers.get(\"content-type\") ?? \"\"; if (/json/.test(ct)) { try { j = await r.json(); } catch { /* bukan JSON */ } } else await r.arrayBuffer(); return { status: r.status, json: j, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };\nconst wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);\nconst tambah = (t, n) => new Date(Date.parse(t + \"T00:00:00Z\") + n * 86400_000).toISOString().slice(0, 10);\nconst POSISI = [\"MENUNGGU_DIJEMPUT\", \"DALAM_PENJEMPUTAN\", \"SUDAH_DIJEMPUT\", \"DI_WORKSHOP\", \"DI_WORKSHOP_TANPA_BUKTI\", \"DI_WORKSHOP_SIAP\", \"DALAM_PENGIRIMAN\", \"DI_PELANGGAN\"];\nconst JEJAK = [[\"stock_movements\", \"select count(*)::int n from stock_movements\"], [\"biaya_beku\", \"select count(*)::int n from stock_movement_biaya_operasional\"], [\"harga_berlaku\", \"select count(*)::int n from material_harga_berlaku\"], [\"material_issues\", \"select count(*)::int n from material_issues\"],\n  [\"jurnal\", \"select count(*)::int n from fin_journal_entries\"], [\"units\", \"select count(*)::int n from units\"], [\"pernyataan\", \"select count(*)::int n from unit_material_declarations\"], [\"runs\", \"select count(*)::int n from production_runs_v2\"]];\nconst jejak = async () => Object.fromEntries(await Promise.all(JEJAK.map(async ([k, q]) => [k, await hitung(q)])));\nconst s0 = await jejak();\nconst nUnit = await hitung(\"select count(*)::int n from units\"); const nBatal = await hitung(\"select count(*)::int n from units where status = 'CANCELLED'\");\nconst hariIni = wib(new Date());\n\n// ── izin dan validasi parameter ──\nrec(\"daftar tanpa token = 401 (juga dengan filter baru)\", (await get(`${W}?pic=x&target=terlambat`, null)).status === 401);\nrec(\"hitungan tanpa token = 401\", (await get(`${W}/kelengkapan-hitung?target=terlambat`, null)).status === 401);\nif (tanpaIzin) { const tX = await tokenUntuk(tanpaIzin); rec(\"akun tanpa unit:read: daftar dengan filter = 403\", (await get(`${W}?posisi=DI_WORKSHOP`, tX)).status === 403); } else skip(\"akun tanpa unit:read\", \"semua akun aktif punya unit:read\");\nrec(\"posisi tidak dikenal = 400 (ditolak, bukan diabaikan)\", (await get(`${W}?posisi=SURGA`)).status === 400);\nrec(\"target tidak dikenal = 400\", (await get(`${W}?target=kapan_saja`)).status === 400);\nrec(\"PIC terlalu panjang = 400\", (await get(`${W}?pic=${\"x\".repeat(121)}`)).status === 400);\nrec(\"hitungan juga menolak nilai tidak dikenal (400)\", (await get(`${W}/kelengkapan-hitung?posisi=SURGA`)).status === 400);\n\n// ── jumlah dasar: tanpa filter = seluruh unit (sama dengan tabel); semua jalur penuh tidak melampaui batas ──\nconst dasar = await get(`${W}?page=1&pageSize=1`);\nrec(`daftar tanpa filter: total = unit di tabel (${nUnit})`, dasar.status === 200 && dasar.json.total === nUnit, `${dasar.json?.total}`);\nconst penuh = await get(`${W}?posisi=${POSISI.join(\",\")}&page=1&pageSize=1`);\nif (penuh.status === 413) skip(\"partisi posisi unit\", `unit > batas ${5000} untuk jalur penuh (dilaporkan 413 jujur)`);\nelse {\n  // ── partisi posisi: Σ delapan posisi fisik + unit Dibatalkan = seluruh unit (tiap unit tepat satu posisi) ──\n  let jumlah = 0; const per = {};\n  for (const k of POSISI) { const r = await get(`${W}?posisi=${k}&page=1&pageSize=1`); per[k] = r.json?.total ?? 0; jumlah += per[k]; }\n  rec(`partisi posisi unit: Σ 8 posisi (${jumlah}) + Dibatalkan (${nBatal}) = seluruh unit (${nUnit})`, jumlah + nBatal === nUnit, JSON.stringify(per));\n  rec(\"posisi OR: dua posisi = jumlah keduanya (tanpa tumpang tindih)\", (await get(`${W}?posisi=DI_WORKSHOP,DALAM_PENGIRIMAN&page=1&pageSize=1`)).json?.total === per.DI_WORKSHOP + per.DALAM_PENGIRIMAN);\n  // setiap baris hasil memenuhi filternya (posisi berasal dari adopsi.posisi.key yang tampil di daftar)\n  const tp = POSISI.find((k) => per[k] > 0);\n  if (tp) { const r = await get(`${W}?posisi=${tp}&page=1&pageSize=200`); rec(`semua baris filter posisi ${tp} berposisi ${tp}`, r.json.units.length > 0 && r.json.units.every((u) => u.adopsi.posisi.key === tp)); }\n\n  // ── PIC: partisi, hitungan = daftar, nama persis, Belum ditugaskan ──\n  const h = await get(`${W}/kelengkapan-hitung`);\n  rec(\"hitungan memuat faset PIC (pic[], tanpaPic) dan Σ = jumlah unit pada lingkup\", h.status === 200 && Array.isArray(h.json.pic) && typeof h.json.tanpaPic === \"number\" && h.json.pic.reduce((a, p) => a + p.jumlah, 0) + h.json.tanpaPic === h.json.totalUnit, `${h.json?.totalUnit}`);\n  const tanpa = await get(`${W}?pic=${encodeURIComponent(\"~tanpa\")}&page=1&pageSize=200`);\n  rec(`PIC Belum ditugaskan: total daftar = hitungan (${h.json?.tanpaPic}); semua baris tanpa PIC`, tanpa.status === 200 && tanpa.json.total === h.json.tanpaPic && tanpa.json.units.every((u) => !u.adopsi.pic), `${tanpa.json?.total}`);\n  const picTop = [...(h.json?.pic ?? [])].sort((a, b) => b.jumlah - a.jumlah)[0];\n  if (picTop) {\n    const r = await get(`${W}?pic=${encodeURIComponent(picTop.nama)}&page=1&pageSize=200`);\n    rec(`PIC ${picTop.nama}: total daftar = hitungan faset (${picTop.jumlah}); semua baris PIC itu`, r.status === 200 && r.json.total === picTop.jumlah && r.json.units.every((u) => u.adopsi.pic?.nama === picTop.nama), `${r.json?.total}`);\n    const awalan = picTop.nama.slice(0, -1);\n    if (awalan && !h.json.pic.some((p) => p.nama === awalan)) { const bagian = await get(`${W}?pic=${encodeURIComponent(awalan)}&page=1&pageSize=1`); rec(\"PIC dicocokkan PERSIS: awalan nama bukan PIC → 0 hasil\", bagian.status === 200 && bagian.json.total === 0, `${bagian.json?.total}`); }\n    // ── kombinasi AND + hitungan ikut filter ──\n    const posTop = POSISI.map((k) => [k, per[k]]).sort((a, b) => b[1] - a[1])[0][0];\n    const both = await get(`${W}?posisi=${posTop}&pic=${encodeURIComponent(picTop.nama)}&page=1&pageSize=200`);\n    rec(`posisi ${posTop} DAN PIC ${picTop.nama}: semua baris memenuhi keduanya; total ≤ min(masing-masing)`, both.status === 200 && both.json.units.every((u) => u.adopsi.posisi.key === posTop && u.adopsi.pic?.nama === picTop.nama) && both.json.total <= Math.min(per[posTop], picTop.jumlah), `${both.json?.total}`);\n    const hb = await get(`${W}/kelengkapan-hitung?posisi=${posTop}&pic=${encodeURIComponent(picTop.nama)}`);\n    rec(\"hitungan mengikuti filter yang sama: totalUnit = total daftar\", hb.status === 200 && hb.json.totalUnit === both.json.total, `${hb.json?.totalUnit} vs ${both.json?.total}`);\n  } else skip(\"PIC\", \"tidak ada unit ber-PIC pada data\");\n\n  // ── target selesai (hari WIB) ──\n  const tgt = {};\n  for (const t of [\"terlambat\", \"hari_ini\", \"tujuh_hari\", \"belum_ada\"]) tgt[t] = await get(`${W}?target=${t}&page=1&pageSize=200`);\n  rec(\"keempat filter target menjawab 200\", Object.values(tgt).every((r) => r.status === 200), Object.entries(tgt).map(([k, r]) => `${k}=${r.json?.total}`).join(\" \"));\n  const at = (u) => u.adopsi.targetSelesai?.at;\n  rec(\"terlambat: setiap baris bertarget SEBELUM hari ini (WIB), unit belum Terkirim/Dibatalkan dan status kerja bukan Selesai\", tgt.terlambat.json.units.every((u) => at(u) && wib(at(u)) < hariIni && ![\"DELIVERED\", \"CANCELLED\"].includes(u.status) && ![\"SELESAI\", \"DIBATALKAN\"].includes(u.adopsi.kerja.key)));\n  rec(\"hari ini: setiap baris bertarget TEPAT hari ini (WIB)\", tgt.hari_ini.json.units.every((u) => at(u) && wib(at(u)) === hariIni));\n  rec(\"7 hari ke depan: setiap baris bertarget hari ini .. +6 hari (WIB); ⊇ hari ini\", tgt.tujuh_hari.json.units.every((u) => at(u) && wib(at(u)) >= hariIni && wib(at(u)) <= tambah(hariIni, 6)) && tgt.tujuh_hari.json.total >= tgt.hari_ini.json.total);\n  rec(\"belum ada target: setiap baris tanpa target; unit bertarget TIDAK masuk\", tgt.belum_ada.json.units.every((u) => !at(u)));\n  const hbT = await get(`${W}/kelengkapan-hitung?target=belum_ada`);\n  rec(\"hitungan target=belum_ada: totalUnit = total daftar\", hbT.status === 200 && hbT.json.totalUnit === tgt.belum_ada.json.total, `${hbT.json?.totalUnit} vs ${tgt.belum_ada.json?.total}`);\n\n  // ── hasil di luar 50 unit pertama: halaman bertahap lengkap, tanpa duplikat, total/hasMore mengikuti filter ──\n  const kandidat = [[\"posisi\", `posisi=${POSISI.map((k) => [k, per[k]]).sort((a, b) => b[1] - a[1])[0][0]}`], [\"target\", \"target=belum_ada\"], [\"target\", \"target=tujuh_hari\"]];\n  let diuji = false;\n  for (const [, qs] of kandidat) {\n    const satu = await get(`${W}?${qs}&page=1&pageSize=1`); const total = satu.json?.total ?? 0; if (total < 7) continue;\n    const ukuran = total > 50 ? 50 : Math.max(2, Math.floor(total / 3)); const id = new Set(); let halaman = 1; let terakhir = null; let urut = true;\n    for (;;) { const r = await get(`${W}?${qs}&page=${halaman}&pageSize=${ukuran}`); if (r.status !== 200) { urut = false; break; } for (const u of r.json.units) id.add(u.id); terakhir = r.json; if (!r.json.hasMore) break; halaman += 1; if (halaman > 200) { urut = false; break; } }\n    rec(`halaman bertahap ${qs} (ukuran ${ukuran}${total > 50 ? \", >50 hasil\" : \"\"}): ${halaman} halaman memuat ${id.size} unit = total ${total}; tanpa duplikat; hasMore salah di halaman terakhir`, urut && id.size === total && terakhir.hasMore === false && terakhir.total === total);\n    diuji = true; if (total > 50) break;\n  }\n  if (!diuji) skip(\"halaman bertahap dengan filter\", \"tidak ada filter dengan ≥ 7 hasil pada data ini\");\n\n  // ── ekspor Excel memakai filter yang sama (dicatat di Info Ekspor) ──\n  if (picTop) {\n    const ex = await fetch(BASE + `${W}/export.xlsx?pic=${encodeURIComponent(picTop.nama)}&target=belum_ada`, { headers: { Authorization: \"Bearer \" + tok } });\n    rec(\"ekspor dengan filter baru: 200, xlsx\", ex.status === 200 && /spreadsheetml/.test(ex.headers.get(\"content-type\") ?? \"\"), `${ex.status}`);\n    if (ex.status === 200) {\n      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.arrayBuffer())); const wi = wb.getWorksheet(\"Info Ekspor\"); const baris = []; wi?.eachRow((row) => baris.push([String(row.getCell(1).value ?? \"\"), String(row.getCell(2).value ?? \"\")]));\n      rec(\"Info Ekspor mencatat filter PIC dan target\", baris.some(([k, v]) => k === \"Filter: PIC\" && v === picTop.nama) && baris.some(([k, v]) => k === \"Filter: target selesai\" && v === \"Belum ada target\"), JSON.stringify(baris.filter(([k]) => /^Filter: (PIC|target)/.test(k))));\n    }\n  }\n}\n\n// ── tanpa jejak tulis ──\nconst s1 = await jejak(); const turun = Object.keys(s0).filter((k) => s1[k] < s0[k]);\nrec(\"TIDAK ada jejak tulis destruktif: stok, biaya beku, harga berlaku, Material Issue, jurnal, unit, pernyataan, run tidak berkurang selama smoke\", turun.length === 0, turun.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(\" \"));\nconst naik = Object.keys(s0).filter((k) => s1[k] > s0[k]); if (naik.length) console.log(\"  (info: bertambah selama smoke karena pengguna lain/aplikasi hidup — smoke ini hanya GET: \" + naik.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(\" \") + \")\");\nawait prisma.$disconnect();\nconsole.log(\"\\nRINGKASAN smoke: \" + fail + \" gagal, \" + dilewati + \" dilewati (SKIP)\");\nconsole.log(\"SMOKE_HASIL fail=\" + fail + \" skip=\" + dilewati);\nprocess.exit(fail ? 1 : 0);\n"; // diganti generator dengan isi smoke-produksi-filter.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji filter Order Produksi hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Filter Order Produksi + Ringkasan": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4102, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// TIDAK ada tulisan sama sekali (smoke dan ukur waktu hanya GET). Endpoint daftar/hitungan/ekspor tidak boleh mengubah apa pun; hasil filter harus memenuhi invarian (partisi, hitungan = daftar, baris memenuhi filter, halaman bertahap lengkap).
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4102); const BASE = `http://127.0.0.1:${PORT}`;
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
const pembaca = info.find((x) => bisa(x.rs, P.UNIT_READ))?.u ?? await prisma.user.create({ data: { name: "REH Pembaca", email: `reh-pof-r-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
cek("akun uji dengan unit:read tersedia", !!pembaca && bisa(await rolesDari(pembaca), P.UNIT_READ));
const tP = await token(pembaca);
const get = async (url, tok = tP) => { const t0 = process.hrtime.bigint(); const r = await fetch(BASE + url, { headers: tok ? { Authorization: "Bearer " + tok } : {} }); let j = null; try { if (/json/.test(r.headers.get("content-type") ?? "")) j = await r.json(); else await r.arrayBuffer(); } catch { /* bukan JSON */ } return { status: r.status, json: j, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };
const W = "/api/production/work-orders";
const TABEL = ["stock_movements", "stock_movement_biaya_operasional", "material_harga_berlaku", "material_issues", "fin_journal_entries", "units", "unit_material_declarations", "production_runs_v2", "unit_custody_handoffs_v2", "production_unit_work_progress"];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async (t) => [t, await num(`select count(*)::int n from ${t}`)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

// ── A. jalur lama tetap: daftar tanpa filter dan hitungan kelengkapan masih sama bentuknya (aditif) ──
const j0 = await jejak();
const dasar = await get(`${W}?page=1&pageSize=50`); const hit = await get(`${W}/kelengkapan-hitung`);
cek("daftar tanpa filter: 200, bentuk lama utuh (units, total, hasMore, displayStatusCounts, filterDipakai)", dasar.status === 200 && Array.isArray(dasar.json.units) && typeof dasar.json.total === "number" && "hasMore" in dasar.json && !!dasar.json.displayStatusCounts && !!dasar.json.filterDipakai, `${dasar.status}`);
cek("hitungan kelengkapan: 200, bentuk lama utuh + faset PIC aditif", hit.status === 200 && !!hit.json.counts && typeof hit.json.unik === "number" && !!hit.json.dataOrder && Array.isArray(hit.json.pic), `${hit.status}`);
cek("filterDipakai mencatat posisi/pic/target (kosong bila tak dipakai)", Array.isArray(dasar.json.filterDipakai.posisi) && dasar.json.filterDipakai.pic === null && dasar.json.filterDipakai.target === null);

// ── B. WAKTU RESPONS pada data nyata (jalur penuh: pengayaan seluruh unit lalu saring) ──
const ukur = async (nama, url, batas, n3 = 3) => { const t = []; let st = 0; for (let i = 0; i < n3; i++) { const r = await get(url); st = r.status; t.push(r.ms); } const h = t.slice(1).sort((a, b) => a - b);
  console.log(`WAKTU ${nama.padEnd(60)} dingin=${String(Math.round(t[0])).padStart(5)} ms | hangat p50=${String(Math.round(h[Math.floor(h.length / 2)])).padStart(5)} ms maks=${String(Math.round(Math.max(...h))).padStart(5)} ms`);
  cek(`waktu ${nama} di bawah batas ${batas} ms (maks ${Math.round(Math.max(...t))} ms)`, st === 200 && Math.max(...t) < batas); };
await ukur("daftar tanpa filter (halaman 1)", `${W}?page=1&pageSize=50`, 10000);
await ukur("daftar filter posisi Di workshop", `${W}?posisi=DI_WORKSHOP&page=1&pageSize=50`, 20000);
await ukur("daftar filter target terlambat", `${W}?target=terlambat&page=1&pageSize=50`, 20000);
await ukur("daftar filter gabungan posisi+target (halaman 2)", `${W}?posisi=DI_WORKSHOP,SUDAH_DIJEMPUT&target=tujuh_hari&page=2&pageSize=50`, 20000);
await ukur("hitungan kelengkapan + faset PIC", `${W}/kelengkapan-hitung?target=terlambat`, 20000);
await ukur("ekspor Excel dengan filter PIC kosong", `${W}/export.xlsx?pic=${encodeURIComponent("~tanpa")}`, 40000, 2);
cek("endpoint daftar/hitungan/ekspor tidak mengubah stok, biaya beku, harga, Material Issue, jurnal, unit, pernyataan, run, custody, status kerja", sama(await jejak(), j0));

// ── C. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP)/.test(l)).join("\n"));
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
# direktori sementara dibuat root oleh kontainer: dihapus lewat kontainer (rm biasa ditolak); kegagalan pembersihan tidak menggagalkan rilis
dcp "$NEW_DIR" run --rm --no-deps -T -v "$BK_DIR:/bk" backend sh -c 'rm -rf /bk/reh-data /bk/reh-uploads /bk/reh-dd' </dev/null >/dev/null 2>&1 || true
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; smoke dan ukur waktu filter Order Produksi (hanya GET) dijalankan pada salinan restore lalu DB sementara dihapus"
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
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: filter Order Produksi (partisi posisi, PIC = hitungan, target WIB, halaman di luar 50 pertama, ekspor, validasi 400, izin 401/403); stok, biaya beku, harga, jurnal, unit, pernyataan, run identik"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA: filter daftar Order Produksi (posisi unit · PIC · target selesai) pada GET /api/production/work-orders, /work-orders/kelengkapan-hitung, dan /work-orders/export.xlsx.
// Tidak ada tulisan dan tidak ada data percobaan. Kebenaran diperiksa dengan INVARIAN atas data nyata (bukan angka tetap): partisi, hitungan = daftar, setiap baris hasil memenuhi filternya,
// halaman bertahap tidak menghilangkan/menggandakan unit di luar 50 pertama, ekspor = filter yang sama.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.UNIT_READ))?.u;
const tanpaIzin = info.find((x) => !bisa(x.rs, P.UNIT_READ))?.u;
if (!pembaca) { rec("akun dengan unit:read tersedia", false); process.exit(1); }
const tok = await tokenUntuk(pembaca);
const W = "/api/production/work-orders";
const get = async (url, token = tok) => { const t0 = process.hrtime.bigint(); const r = await fetch(BASE + url, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; const ct = r.headers.get("content-type") ?? ""; if (/json/.test(ct)) { try { j = await r.json(); } catch { /* bukan JSON */ } } else await r.arrayBuffer(); return { status: r.status, json: j, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const tambah = (t, n) => new Date(Date.parse(t + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const POSISI = ["MENUNGGU_DIJEMPUT", "DALAM_PENJEMPUTAN", "SUDAH_DIJEMPUT", "DI_WORKSHOP", "DI_WORKSHOP_TANPA_BUKTI", "DI_WORKSHOP_SIAP", "DALAM_PENGIRIMAN", "DI_PELANGGAN"];
const JEJAK = [["stock_movements", "select count(*)::int n from stock_movements"], ["biaya_beku", "select count(*)::int n from stock_movement_biaya_operasional"], ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["material_issues", "select count(*)::int n from material_issues"],
  ["jurnal", "select count(*)::int n from fin_journal_entries"], ["units", "select count(*)::int n from units"], ["pernyataan", "select count(*)::int n from unit_material_declarations"], ["runs", "select count(*)::int n from production_runs_v2"]];
const jejak = async () => Object.fromEntries(await Promise.all(JEJAK.map(async ([k, q]) => [k, await hitung(q)])));
const s0 = await jejak();
const nUnit = await hitung("select count(*)::int n from units"); const nBatal = await hitung("select count(*)::int n from units where status = 'CANCELLED'");
const hariIni = wib(new Date());

// ── izin dan validasi parameter ──
rec("daftar tanpa token = 401 (juga dengan filter baru)", (await get(`${W}?pic=x&target=terlambat`, null)).status === 401);
rec("hitungan tanpa token = 401", (await get(`${W}/kelengkapan-hitung?target=terlambat`, null)).status === 401);
if (tanpaIzin) { const tX = await tokenUntuk(tanpaIzin); rec("akun tanpa unit:read: daftar dengan filter = 403", (await get(`${W}?posisi=DI_WORKSHOP`, tX)).status === 403); } else skip("akun tanpa unit:read", "semua akun aktif punya unit:read");
rec("posisi tidak dikenal = 400 (ditolak, bukan diabaikan)", (await get(`${W}?posisi=SURGA`)).status === 400);
rec("target tidak dikenal = 400", (await get(`${W}?target=kapan_saja`)).status === 400);
rec("PIC terlalu panjang = 400", (await get(`${W}?pic=${"x".repeat(121)}`)).status === 400);
rec("hitungan juga menolak nilai tidak dikenal (400)", (await get(`${W}/kelengkapan-hitung?posisi=SURGA`)).status === 400);

// ── jumlah dasar: tanpa filter = seluruh unit (sama dengan tabel); semua jalur penuh tidak melampaui batas ──
const dasar = await get(`${W}?page=1&pageSize=1`);
rec(`daftar tanpa filter: total = unit di tabel (${nUnit})`, dasar.status === 200 && dasar.json.total === nUnit, `${dasar.json?.total}`);
const penuh = await get(`${W}?posisi=${POSISI.join(",")}&page=1&pageSize=1`);
if (penuh.status === 413) skip("partisi posisi unit", `unit > batas ${5000} untuk jalur penuh (dilaporkan 413 jujur)`);
else {
  // ── partisi posisi: Σ delapan posisi fisik + unit Dibatalkan = seluruh unit (tiap unit tepat satu posisi) ──
  let jumlah = 0; const per = {};
  for (const k of POSISI) { const r = await get(`${W}?posisi=${k}&page=1&pageSize=1`); per[k] = r.json?.total ?? 0; jumlah += per[k]; }
  rec(`partisi posisi unit: Σ 8 posisi (${jumlah}) + Dibatalkan (${nBatal}) = seluruh unit (${nUnit})`, jumlah + nBatal === nUnit, JSON.stringify(per));
  rec("posisi OR: dua posisi = jumlah keduanya (tanpa tumpang tindih)", (await get(`${W}?posisi=DI_WORKSHOP,DALAM_PENGIRIMAN&page=1&pageSize=1`)).json?.total === per.DI_WORKSHOP + per.DALAM_PENGIRIMAN);
  // setiap baris hasil memenuhi filternya (posisi berasal dari adopsi.posisi.key yang tampil di daftar)
  const tp = POSISI.find((k) => per[k] > 0);
  if (tp) { const r = await get(`${W}?posisi=${tp}&page=1&pageSize=200`); rec(`semua baris filter posisi ${tp} berposisi ${tp}`, r.json.units.length > 0 && r.json.units.every((u) => u.adopsi.posisi.key === tp)); }

  // ── PIC: partisi, hitungan = daftar, nama persis, Belum ditugaskan ──
  const h = await get(`${W}/kelengkapan-hitung`);
  rec("hitungan memuat faset PIC (pic[], tanpaPic) dan Σ = jumlah unit pada lingkup", h.status === 200 && Array.isArray(h.json.pic) && typeof h.json.tanpaPic === "number" && h.json.pic.reduce((a, p) => a + p.jumlah, 0) + h.json.tanpaPic === h.json.totalUnit, `${h.json?.totalUnit}`);
  const tanpa = await get(`${W}?pic=${encodeURIComponent("~tanpa")}&page=1&pageSize=200`);
  rec(`PIC Belum ditugaskan: total daftar = hitungan (${h.json?.tanpaPic}); semua baris tanpa PIC`, tanpa.status === 200 && tanpa.json.total === h.json.tanpaPic && tanpa.json.units.every((u) => !u.adopsi.pic), `${tanpa.json?.total}`);
  const picTop = [...(h.json?.pic ?? [])].sort((a, b) => b.jumlah - a.jumlah)[0];
  if (picTop) {
    const r = await get(`${W}?pic=${encodeURIComponent(picTop.nama)}&page=1&pageSize=200`);
    rec(`PIC ${picTop.nama}: total daftar = hitungan faset (${picTop.jumlah}); semua baris PIC itu`, r.status === 200 && r.json.total === picTop.jumlah && r.json.units.every((u) => u.adopsi.pic?.nama === picTop.nama), `${r.json?.total}`);
    const awalan = picTop.nama.slice(0, -1);
    if (awalan && !h.json.pic.some((p) => p.nama === awalan)) { const bagian = await get(`${W}?pic=${encodeURIComponent(awalan)}&page=1&pageSize=1`); rec("PIC dicocokkan PERSIS: awalan nama bukan PIC → 0 hasil", bagian.status === 200 && bagian.json.total === 0, `${bagian.json?.total}`); }
    // ── kombinasi AND + hitungan ikut filter ──
    const posTop = POSISI.map((k) => [k, per[k]]).sort((a, b) => b[1] - a[1])[0][0];
    const both = await get(`${W}?posisi=${posTop}&pic=${encodeURIComponent(picTop.nama)}&page=1&pageSize=200`);
    rec(`posisi ${posTop} DAN PIC ${picTop.nama}: semua baris memenuhi keduanya; total ≤ min(masing-masing)`, both.status === 200 && both.json.units.every((u) => u.adopsi.posisi.key === posTop && u.adopsi.pic?.nama === picTop.nama) && both.json.total <= Math.min(per[posTop], picTop.jumlah), `${both.json?.total}`);
    const hb = await get(`${W}/kelengkapan-hitung?posisi=${posTop}&pic=${encodeURIComponent(picTop.nama)}`);
    rec("hitungan mengikuti filter yang sama: totalUnit = total daftar", hb.status === 200 && hb.json.totalUnit === both.json.total, `${hb.json?.totalUnit} vs ${both.json?.total}`);
  } else skip("PIC", "tidak ada unit ber-PIC pada data");

  // ── target selesai (hari WIB) ──
  const tgt = {};
  for (const t of ["terlambat", "hari_ini", "tujuh_hari", "belum_ada"]) tgt[t] = await get(`${W}?target=${t}&page=1&pageSize=200`);
  rec("keempat filter target menjawab 200", Object.values(tgt).every((r) => r.status === 200), Object.entries(tgt).map(([k, r]) => `${k}=${r.json?.total}`).join(" "));
  const at = (u) => u.adopsi.targetSelesai?.at;
  rec("terlambat: setiap baris bertarget SEBELUM hari ini (WIB), unit belum Terkirim/Dibatalkan dan status kerja bukan Selesai", tgt.terlambat.json.units.every((u) => at(u) && wib(at(u)) < hariIni && !["DELIVERED", "CANCELLED"].includes(u.status) && !["SELESAI", "DIBATALKAN"].includes(u.adopsi.kerja.key)));
  rec("hari ini: setiap baris bertarget TEPAT hari ini (WIB)", tgt.hari_ini.json.units.every((u) => at(u) && wib(at(u)) === hariIni));
  rec("7 hari ke depan: setiap baris bertarget hari ini .. +6 hari (WIB); ⊇ hari ini", tgt.tujuh_hari.json.units.every((u) => at(u) && wib(at(u)) >= hariIni && wib(at(u)) <= tambah(hariIni, 6)) && tgt.tujuh_hari.json.total >= tgt.hari_ini.json.total);
  rec("belum ada target: setiap baris tanpa target; unit bertarget TIDAK masuk", tgt.belum_ada.json.units.every((u) => !at(u)));
  const hbT = await get(`${W}/kelengkapan-hitung?target=belum_ada`);
  rec("hitungan target=belum_ada: totalUnit = total daftar", hbT.status === 200 && hbT.json.totalUnit === tgt.belum_ada.json.total, `${hbT.json?.totalUnit} vs ${tgt.belum_ada.json?.total}`);

  // ── hasil di luar 50 unit pertama: halaman bertahap lengkap, tanpa duplikat, total/hasMore mengikuti filter ──
  const kandidat = [["posisi", `posisi=${POSISI.map((k) => [k, per[k]]).sort((a, b) => b[1] - a[1])[0][0]}`], ["target", "target=belum_ada"], ["target", "target=tujuh_hari"]];
  let diuji = false;
  for (const [, qs] of kandidat) {
    const satu = await get(`${W}?${qs}&page=1&pageSize=1`); const total = satu.json?.total ?? 0; if (total < 7) continue;
    const ukuran = total > 50 ? 50 : Math.max(2, Math.floor(total / 3)); const id = new Set(); let halaman = 1; let terakhir = null; let urut = true;
    for (;;) { const r = await get(`${W}?${qs}&page=${halaman}&pageSize=${ukuran}`); if (r.status !== 200) { urut = false; break; } for (const u of r.json.units) id.add(u.id); terakhir = r.json; if (!r.json.hasMore) break; halaman += 1; if (halaman > 200) { urut = false; break; } }
    rec(`halaman bertahap ${qs} (ukuran ${ukuran}${total > 50 ? ", >50 hasil" : ""}): ${halaman} halaman memuat ${id.size} unit = total ${total}; tanpa duplikat; hasMore salah di halaman terakhir`, urut && id.size === total && terakhir.hasMore === false && terakhir.total === total);
    diuji = true; if (total > 50) break;
  }
  if (!diuji) skip("halaman bertahap dengan filter", "tidak ada filter dengan ≥ 7 hasil pada data ini");

  // ── ekspor Excel memakai filter yang sama (dicatat di Info Ekspor) ──
  if (picTop) {
    const ex = await fetch(BASE + `${W}/export.xlsx?pic=${encodeURIComponent(picTop.nama)}&target=belum_ada`, { headers: { Authorization: "Bearer " + tok } });
    rec("ekspor dengan filter baru: 200, xlsx", ex.status === 200 && /spreadsheetml/.test(ex.headers.get("content-type") ?? ""), `${ex.status}`);
    if (ex.status === 200) {
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.arrayBuffer())); const wi = wb.getWorksheet("Info Ekspor"); const baris = []; wi?.eachRow((row) => baris.push([String(row.getCell(1).value ?? ""), String(row.getCell(2).value ?? "")]));
      rec("Info Ekspor mencatat filter PIC dan target", baris.some(([k, v]) => k === "Filter: PIC" && v === picTop.nama) && baris.some(([k, v]) => k === "Filter: target selesai" && v === "Belum ada target"), JSON.stringify(baris.filter(([k]) => /^Filter: (PIC|target)/.test(k))));
    }
  }
}

// ── tanpa jejak tulis ──
const s1 = await jejak(); const turun = Object.keys(s0).filter((k) => s1[k] < s0[k]);
rec("TIDAK ada jejak tulis destruktif: stok, biaya beku, harga berlaku, Material Issue, jurnal, unit, pernyataan, run tidak berkurang selama smoke", turun.length === 0, turun.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(" "));
const naik = Object.keys(s0).filter((k) => s1[k] > s0[k]); if (naik.length) console.log("  (info: bertambah selama smoke karena pengguna lain/aplikasi hidup — smoke ini hanya GET: " + naik.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(" ") + ")");
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
  ok "smoke test lulus (filter Order Produksi: invarian atas data nyata, ekspor, validasi, izin, tanpa jejak tulis)"
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
say "CATATAN: Rilis ini membawa filter Order Produksi lengkap (posisi unit, PIC, target selesai; disaring di server atas seluruh hasil) + Ringkasan (warna KPI, susunan panel) + penguncian deploy bersama. TANPA migrasi, TANPA data baru. Tidak ada transaksi uji di produksi."
