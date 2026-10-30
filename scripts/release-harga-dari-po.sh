#!/usr/bin/env bash
# RILIS "HARGA BERLAKU OTOMATIS DARI PO" (Finance → Purchase Order → Baru/Ubah draf; Gudang → Stok → Harga Berlaku → Riwayat): WEB + BACKEND, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • Aturan (keputusan Owner 30 Okt 2026): harga bahan pada baris PO menjadi Harga Berlaku operasional SAAT PO BERHASIL DISIMPAN (draf baru dan ubah draf), lewat layanan Harga Berlaku resmi, di TRANSAKSI YANG SAMA dengan penyimpanan PO. Isian yang belum
#     disimpan tidak mengubah harga. Tidak ada izin harga tambahan dan tidak ada dialog persetujuan harga (cukup izin menyimpan PO, finance:post); dampak dijelaskan di formulir (harga lama → baru per baris, di baris terkait).
#   • Hanya baris yang harga/satuan/faktornya BERUBAH yang menulis (ubah jumlah, simpan ulang, klik ganda/retry tidak menimpa harga yang lebih baru). Persetujuan PO TIDAK menulis ulang harga dan TIDAK mengembalikan harga lebih baru; pembatalan PO
#     TIDAK menghapus riwayat dan TIDAK mengembalikan harga secara buta. Ubah harga manual dan harga terjadwal tetap berjalan. Konversi satuan hanya dengan faktor sah (pembulatan maks 4 desimal ditampilkan sebelum simpan); konflik harga bahan yang
#     sama dan faktor tidak sah ditolak di barisnya, tanpa tulisan sebagian. Saklar darurat HARGA_DARI_PO=0 menghentikan penulisan harga tanpa mematikan penyimpanan PO.
#   • Rilis ini TIDAK memproses PO historis, TIDAK menambah/mengubah stok, valuasi Finance, jurnal, biaya beku operasional, atau pemakaian lama, dan TIDAK membuat PO/harga percobaan di production. Efek nyata baru terjadi saat pengguna menyimpan PO.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore: harga tertulis saat simpan, tanpa izin harga, klik ganda/retry, ubah jumlah/harga draf, harga lebih baru tidak tertimpa, persetujuan/pembatalan,
#     harga terjadwal, konflik/konversi tidak sah tanpa tulisan sebagian, saklar =0, izin, stok/valuasi/jurnal identik, seluruh baris Harga Berlaku lama identik); build web di release dir; switch SATU kali; verifikasi; smoke baca-saja pasca-switch.
#   • PENGUNCIAN: kunci deploy BERSAMA (release-deploy-bersama.lock) + kunci sendiri diambil ATOMIK sebelum memeriksa kunci/proses lain; kepemilikan ditentukan oleh proses (perangkat:inode fd 7/9), BUKAN nama berkas; diperiksa di fase 0,
#     sebelum persiapan akhir, dan tepat sebelum switch. Rehearsal MENGUJI logika ini (kunci sendiri/lain, bagian kritis, baseline bergeser) lalu gerbang fase 7 pada production nyata tanpa switch.
#   • BASELINE = release aktif. GERBANG IDENTITAS KODE LIVE membandingkan ISI kode (hash blob SEMUA berkas terlacak baseline, berkas tambahan, identitas proses) di fase 2, fase 6, dan TEPAT sebelum switch; selisih isi / berkas tambahan / proses
#     berganti = berhenti sebelum switch. Pembersihan release lama (fase 9) DINONAKTIFKAN: tidak ada folder release/image rollback/backup/volume yang dihapus oleh skrip. Gerbang disk (minimal 5 GiB) TIDAK diturunkan.
#
#   cat scripts/release-harga-dari-po.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/hpo.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/hpo.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/hpo.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/hpor.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/hpo.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/hpo.out 2>&1 < /dev/null &'   # rilis penuh
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru). Rollback mengembalikan perilaku lama (PO tidak menulis Harga Berlaku). Baris Harga Berlaku yang SUDAH tertulis dari PO tetap ada (append-only, riwayat tidak dihapus)
# dan tetap berlaku sampai diubah lewat Ubah harga; pembalikan harga adalah keputusan Owner (Ubah harga/koreksi resmi), bukan bagian rollback kode.
# (dibangkitkan oleh scripts/gen-release-harga-dari-po.cjs dari scripts/release-penjadwalan-langsung.sh + scripts/templates/release-harga-dari-po/* + pustaka scripts/lib/{rehearsal,smoke}-harga-dari-po.mjs; JANGAN edit tangan — ubah generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/harga-berlaku-dari-po-on-c063779c}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/src/routes/purchaseOrders\.js|backend/src/services/finance/hargaBerlaku\.js|backend/src/services/finance/hargaDariPO\.js|backend/src/services/finance/purchaseOrder\.js|backend/tests/integration/hargaDariPO\.integration\.test\.js|backend/tests/integration/purchaseOrderBarangMirip\.integration\.test\.js|backend/tests/releaseHargaDariPo\.test\.js|frontend/src/api\.js|frontend/src/features/finance/hargaDariPOLogic\.js|frontend/src/features/warehouse/stok/HargaBerlakuPanel\.jsx|frontend/src/pages/finance/FinancePurchaseOrders\.jsx|frontend/tests/hargaDariPOLogic\.test\.js|scripts/gen-release-harga-dari-po\.cjs|scripts/lib/gen-kunci-laporan\.cjs|scripts/lib/rehearsal-harga-dari-po\.mjs|scripts/lib/smoke-harga-dari-po\.mjs|scripts/release-harga-dari-po\.sh|scripts/templates/release-harga-dari-po/cek-ulang-kunci\.txt|scripts/templates/release-harga-dari-po/fase0-kunci\.txt|scripts/templates/release-harga-dari-po/header\.txt|scripts/templates/release-harga-dari-po/kunci\.txt|scripts/templates/release-harga-dari-po/rehearsal-pra-switch\.txt|scripts/templates/release-harga-dari-po/rollback\.txt|scripts/templates/release-harga-dari-po/uji-pra-switch\.txt)$'
BACKEND_SRC_EXPECT="backend/src/routes/purchaseOrders.js backend/src/services/finance/hargaBerlaku.js backend/src/services/finance/hargaDariPO.js backend/src/services/finance/purchaseOrder.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/finance/hargaDariPOLogic.js frontend/src/features/warehouse/stok/HargaBerlakuPanel.jsx frontend/src/pages/finance/FinancePurchaseOrders.jsx"
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
BK_DIR="$HOME/release-backups/harga-dari-po-${DEPLOY_SHORT}-${TS}"
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
Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Kode lama: Simpan PO tidak lagi menulis Harga Berlaku; endpoint /purchase-orders/pratinjau-harga hilang; formulir PO kembali tanpa baris dampak harga.
Saklar tanpa rollback: set HARGA_DARI_PO=0 di backend/.env lalu recreate backend (penyimpanan PO tetap berfungsi, penulisan harga berhenti) — keputusan terpisah, bukan bagian skrip ini.
Baris Harga Berlaku yang sudah tertulis dari PO (alasan "Otomatis dari PO ...", kunci "po-harga:...") TIDAK dihapus oleh rollback (append-only) dan tetap berlaku; mengubahnya = Ubah harga resmi atas keputusan Owner.
Stok, Material Issue, valuasi Finance, biaya beku, jurnal, unit, pernyataan, jadwal/Run, dan status tidak disentuh oleh rilis ini: tidak ada yang perlu dibalik.
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS semua perubahan sesudah backup (termasuk PO yang disimpan pengguna); gunakan hanya atas keputusan Owner.
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
#   - kunci sendiri  : release-harga-dari-po.lock  (fd 9) — satu instansi rilis ini.
#   - kunci bersama  : release-deploy-bersama.lock (fd 7) — mutex deploy bersama; diambil ATOMIK (flock) SEBELUM memeriksa kunci lain, supaya dua proses yang mulai bersamaan tidak sama-sama lolos.
# Berkas pemilik (*.owner, bukan *.lock) hanya untuk diagnosis (pid/waktu/SHA/token); keputusan "milik sendiri" TIDAK bergantung padanya.
LOCK_DIR="${LOCK_DIR:-/tmp}"
KUNCI_SENDIRI="${LOCK_DIR}/release-harga-dari-po.lock"
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
  bash -c 'exec 8>>"$1"; flock -n 8; : > "$2"; exec sleep 25' _ "$T/lock/release-harga-dari-po.lock" "$T/lain.siap" & HP=$!
  tunggu_berkas "$T/lain.siap" || gagal_uji "pemegang kunci bernama sama tidak siap"
  res="$(K 'kunci_ambil' 2>&1)" && gagal_uji "instansi kedua rilis ini LOLOS saat kunci sendiri dipegang proses lain: ${res}"
  printf '%s' "$res" | grep -q 'sudah berjalan' || gagal_uji "penolakan instansi kedua bukan 'sudah berjalan': ${res}"
  res="$(K 'kunci_cek_lain; rc=$?; echo "RC=$rc LAIN=$KUNCI_LAIN"; exit $rc' 2>&1)" && gagal_uji "kunci ber-NAMA sendiri tetapi milik proses lain dilewati hanya karena namanya: ${res}"
  printf '%s' "$res" | grep -q 'LAIN=.*release-harga-dari-po.lock' || gagal_uji "kunci bernama sama tidak dilaporkan: ${res}"
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
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"; BASE_GANDA="$(psql_live -At -c "$SQL_GANDA")"; BASE_HARGA_PO="$(psql_live -At -c "select count(*)::int from material_harga_berlaku where impact->>'sumber' = 'PO'")"
for v in "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA" "$BASE_HARGA_PO"; do [[ "$v" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$v'"; done
printf 'BASE_TIDAK_SEIMBANG=%q\nBASE_GANDA=%q\nBASE_HARGA_PO=%q\nORDER_N=%q\nJOB_N=%q\nPKR_N=%q\nEVT_N=%q\n' "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA" "$BASE_HARGA_PO" "$ORDER_N" "$JOB_N" "$PKR_N" "$EVT_N" > "$BK_DIR/garis-dasar.env"
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
BACKUP_FILE="$HOME/backups/pre-harga-dari-po-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Harga Berlaku otomatis" "Apa dampaknya?" "Isian yang belum disimpan tidak mengubah harga" "Saat PO berhasil disimpan"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; [ -z "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks fitur baru '${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done
for s2 in "Total lead (termasuk spam)" "Pola lead & respons" "Customer lunas (ledger)" "Kesehatan & referensi" "Lead CTWA terbukti" "Tindakan lainnya" "Perkiraan biaya penanganan" "Penyebab masalah" "Solusi yang disepakati" "Bahan belum dicatat" "Bahan perlu dicek" "HPP belum lengkap" "Data order kurang" "Paling lama belum ditangani" "Unit ini memang tanpa bahan baru" "Saldo nol atau minus" "Saring harga berlaku" "Saring kelengkapan data bahan" "Belum ada harga berlaku" "pkr_nilai_penjualan" "pkr_sisa_ditagih" "Ada stok" "Stok belum diketahui" "Nol menurut pergerakan" "Saldo minus" "Koreksi saldo" "Ubah harga" "Pilih meja" "Pilih semua unit order ini" "Belum dijadwalkan" "Riwayat dan dokumen pemakaian" "Tanpa pengeluaran stok" "Mengurangi stok" "Beranda Gudang" "Pengeluaran Material" "Konfirmasi Barang Jadi" "Perlu keputusan Anda" "Varian serupa yang sudah ada" "Batalkan barang baru ini" "Ubah barang baru" "Periode order masuk" "Lengkapi di Order Produksi" "Selesai bertanggal pada periode" "tanpa tanggal tercatat" "Hanya order yang punya pemakaian bahan pada periode" "Tampilkan semua bahan" "Ada stok, belum ada harga" "Saringan aktif" "Harga Berlaku (HPP operasional)" "Nilai Finance dan harga pembanding" "Tambah pemakaian" "Tambah pemakaian" "Ganti bahan" "Ajukan perubahan" "Lihat dampak" "Konfirmasi & kurangi stok" "Harga Berlaku (HPP operasional)" "Bahan belum tercatat" "Detail teknis" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-hpo-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
[ "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"
ok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR}: memuat hotfix performa (kode container == folder == baseline disetujui, terbukti gerbang kode live)"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_hpo_${TS}"
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
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): Harga Berlaku otomatis dari PO: harga tertulis saat PO disimpan (draf baru/ubah draf) tanpa izin harga tambahan; hanya baris berubah menulis; klik ganda/retry satu hasil; harga lebih baru dan terjadwal tidak tertimpa; persetujuan/pembatalan tidak menulis atau mengembalikan harga; konflik/konversi tidak sah ditolak tanpa tulisan sebagian; saklar HARGA_DARI_PO=0; izin; stok/valuasi/jurnal/biaya beku/pemakaian lama dan seluruh baris Harga Berlaku lama identik; data uji hanya di salinan dan DB dihapus di akhir.
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji Harga Berlaku dari PO terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
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
const SMOKE_SRC = "import { createRequire } from \"node:module\";\nimport { pathToFileURL } from \"node:url\";\nimport path from \"node:path\";\nconst require = createRequire(process.cwd() + \"/\");\nconst jwt = require(\"jsonwebtoken\");\nconst { PrismaClient } = require(\"@prisma/client\");\nconst prisma = new PrismaClient();\nconst BASE = process.env.SMOKE_BASE ?? \"http://127.0.0.1:4000\"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)\nconst APP = process.env.APP_DIR ?? \"/app\";\nlet fail = 0; let dilewati = 0;\nconst rec = (n, ok, d = \"\") => { if (!ok) fail++; console.log(`  ${ok ? \"PASS\" : \"FAIL\"}  ${n}${d ? \" — \" + d : \"\"}`); };\nconst skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };\n// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang dipakai hanya pratinjau harga formulir PO (baca-saja, tidak menulis) dan PENOLAKAN sebelum menyentuh data (tanpa token, tanpa izin, masukan kosong).\n// TIDAK ada PO dan TIDAK ada Harga Berlaku percobaan yang dibuat. Jejak tulis (PO, baris PO, Harga Berlaku, stok, valuasi, jurnal, biaya beku, catatan pemakaian) harus identik sebelum vs sesudah.\n// PO historis TIDAK diproses oleh rilis ini: jumlah Harga Berlaku bersumber PO (impact.sumber = 'PO') tidak boleh bertambah akibat smoke.\nconst { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, \"src/constants/permissions.js\")).href);\nconst rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);\nconst bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));\nconst tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: \"10m\" });\nconst hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);\nconst B = (k) => Number(process.env[k]);\nconst post = async (p, token, body = {}, hdr = {}) => { const r = await fetch(BASE + p, { method: \"POST\", headers: { \"Content-Type\": \"application/json\", ...(token ? { Authorization: \"Bearer \" + token } : {}), ...hdr }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };\nconst users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: \"asc\" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });\nconst pembaca = info.find((x) => bisa(x.rs, P.FINANCE_READ))?.u; const penyimpan = info.find((x) => bisa(x.rs, P.FINANCE_POST))?.u; const tanpaIzin = info.find((x) => !bisa(x.rs, P.FINANCE_READ))?.u;\nif (!pembaca) { rec(\"akun dengan finance:read tersedia\", false); process.exit(1); }\nconst tR = await tokenUntuk(pembaca); const tP = penyimpan ? await tokenUntuk(penyimpan) : null; const tN = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;\nconst jejak = async () => ({\n  po: await hitung(\"select count(*)::int n from fin_purchase_orders\"), poBaris: await hitung(\"select count(*)::int n from fin_purchase_order_lines\"), poStatus: await hitung(\"select coalesce(sum(length(status::text)),0)::int n from fin_purchase_orders\"),\n  harga: await hitung(\"select count(*)::int n from material_harga_berlaku\"), hargaPO: await hitung(\"select count(*)::int n from material_harga_berlaku where impact->>'sumber' = 'PO' or idempotency_key like 'po-harga:%'\"),\n  stok: await hitung(\"select count(*)::int n from stock_movements\"), valuasi: await hitung(\"select count(*)::int n from fin_stock_movement_valuations\"), jurnal: await hitung(\"select count(*)::int n from fin_journal_entries\"), jurnalBaris: await hitung(\"select count(*)::int n from fin_journal_lines\"),\n  biayaBeku: await hitung(\"select count(*)::int n from stock_movement_biaya_operasional\"), catatan: await hitung(\"select count(*)::int n from unit_usage_notes\"), material: await hitung(\"select count(*)::int n from materials\"),\n});\n// sidik isi Harga Berlaku (append-only): tidak satu baris pun berubah\nconst sidikHarga = async () => String((await prisma.$queryRawUnsafe(\"select coalesce(md5(string_agg(h::text, '|' order by h.id::text)), '-') as n from material_harga_berlaku h\"))[0].n);\nconst s0 = await jejak(); const h0 = await sidikHarga();\nconst PO = \"/api/finance/purchase-orders\"; const PV = `${PO}/pratinjau-harga`;\n\n// ── pratinjau baca-saja pada bahan NYATA yang punya Harga Berlaku sekarang (harga stok + satuan dari tabel)\nconst nyata = await prisma.$queryRawUnsafe(\"select distinct on (h.material_id) h.material_id::text id, m.code, m.name, m.unit, h.unit_price::float8 harga, h.satuan from material_harga_berlaku h join materials m on m.id = h.material_id where h.jenis = 'HARGA' and h.effective_from <= now() and m.active = true and h.satuan = m.unit::text and h.unit_price > 0 and not exists (select 1 from material_harga_berlaku k where k.corrects_id = h.id) order by h.material_id, h.effective_from desc, h.created_at desc limit 40\");\nconst tanpaHarga = await prisma.$queryRawUnsafe(\"select m.id::text id, m.code, m.unit from materials m where m.active = true and not exists (select 1 from material_harga_berlaku h where h.material_id = m.id) order by m.code limit 1\");\nif (nyata.length >= 1) {\n  const m = nyata[0]; const asing = m.unit === \"BOX\" ? \"CAN\" : \"BOX\"; // satuan beli sah yang berbeda dari satuan stok\n  const same = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga }] });\n  rec(`pratinjau ${m.code}: harga yang SAMA dengan Harga Berlaku sekarang (${m.harga}/${m.satuan}) = SAMA, tidak ada yang akan ditulis`, same.status === 200 && same.json?.baris?.[0]?.status === \"SAMA\" && same.json?.ringkas?.akanMenulis === 0, `${same.status} ${same.json?.baris?.[0]?.status}`);\n  const naik = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: Math.round(m.harga * 1.1 * 10000) / 10000 }] });\n  rec(`pratinjau ${m.code}: harga naik 10% = NAIK dengan harga lama ${m.harga} dan sumber/satuan terbaca; hanya pratinjau (nol penulisan)`, naik.status === 200 && naik.json?.baris?.[0]?.status === \"NAIK\" && Number(naik.json.baris[0].hargaLama) === Number(m.harga) && naik.json.ringkas.akanMenulis === 1, `${naik.status} ${naik.json?.baris?.[0]?.status} lama=${naik.json?.baris?.[0]?.hargaLama}`);\n  const tak = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga, satuanBeli: asing }] });\n  rec(`pratinjau ${m.code}: satuan beli berbeda tanpa faktor konversi = masalah KONVERSI_TIDAK_ADA (tidak ditebak; PO akan ditolak di baris itu)`, tak.status === 200 && tak.json?.baris?.[0]?.status === \"KONVERSI_TIDAK_ADA\" && tak.json.ringkas.masalah === 1, `${tak.status} ${tak.json?.baris?.[0]?.status}`);\n  const tidakSah = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga, satuanBeli: asing, faktorKonversi: \"0\" }] });\n  rec(`pratinjau ${m.code}: faktor konversi 0 = KONVERSI_TIDAK_SAH`, tidakSah.status === 200 && tidakSah.json?.baris?.[0]?.status === \"KONVERSI_TIDAK_SAH\", `${tidakSah.status} ${tidakSah.json?.baris?.[0]?.status}`);\n  const konflik = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga }, { materialId: m.id, unitPrice: Math.round(m.harga * 1.5 * 10000) / 10000 }] });\n  rec(`pratinjau ${m.code}: dua baris bahan sama dengan harga stok berbeda = KONFLIK_HARGA_BEDA (tidak memilih salah satu)`, konflik.status === 200 && konflik.json?.baris?.length === 1 && konflik.json.baris[0].status === \"KONFLIK_HARGA_BEDA\", `${konflik.status} ${konflik.json?.baris?.[0]?.status}`);\n} else skip(\"pratinjau pada bahan nyata ber-Harga Berlaku\", \"tidak ada bahan aktif dengan Harga Berlaku berlaku sekarang (satuan = satuan stok)\");\nif (tanpaHarga.length >= 1) {\n  const t = tanpaHarga[0]; const baru = await post(PV, tR, { lines: [{ materialId: t.id, unitPrice: 1234 }] });\n  rec(`pratinjau ${t.code} (belum punya Harga Berlaku): BARU, harga lama kosong; nol penulisan`, baru.status === 200 && baru.json?.baris?.[0]?.status === \"BARU\" && baru.json.baris[0].hargaLama == null, `${baru.status} ${baru.json?.baris?.[0]?.status}`);\n} else skip(\"pratinjau bahan tanpa Harga Berlaku\", \"semua bahan aktif sudah punya Harga Berlaku\");\n\n// ── penolakan SEBELUM menulis\nrec(\"pratinjau-harga tanpa token = 401\", (await post(PV, null, { lines: [] })).status === 401);\nrec(\"simpan PO tanpa token = 401 (tidak menulis)\", (await post(PO, null, { lines: [] }, { \"Idempotency-Key\": \"smoke-hpo-tidak-menulis-0001\" })).status === 401);\nif (tN) {\n  rec(\"pratinjau-harga akun tanpa finance:read = 403\", (await post(PV, tN, { lines: [] })).status === 403);\n  rec(\"simpan PO oleh akun tanpa izin finance:post = 403 (tidak menulis)\", (await post(PO, tN, { supplierId: \"00000000-0000-4000-8000-000000000000\", orderDate: \"2026-10-30\", lines: [{ materialId: \"00000000-0000-4000-8000-000000000000\", qty: 1, unitPrice: 1 }] }, { \"Idempotency-Key\": \"smoke-hpo-tanpa-izin-0002\" })).status === 403);\n} else skip(\"penolakan 403 akun tanpa izin\", \"semua akun aktif punya finance:read\");\nif (tP) rec(\"simpan PO tanpa baris (lines kosong) oleh pemegang finance:post = 4xx (ditolak sebelum menulis apa pun)\", (await post(PO, tP, { supplierId: \"00000000-0000-4000-8000-000000000000\", orderDate: \"2026-10-30\", lines: [] }, { \"Idempotency-Key\": \"smoke-hpo-kosong-0003\" })).status >= 400);\nelse skip(\"penolakan PO tanpa baris\", \"tidak ada akun aktif dengan finance:post\");\n\n// ── PO historis tidak diproses; tidak ada jejak tulis\nconst s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]); const h1 = await sidikHarga();\nrec(\"TIDAK ada jejak tulis: PO, baris PO, Harga Berlaku, stok, valuasi Finance, jurnal, baris jurnal, biaya beku, catatan pemakaian, material sama persis sebelum vs sesudah smoke\", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(\",\") || \"identik\");\nrec(\"isi LENGKAP semua baris Harga Berlaku identik sebelum vs sesudah smoke (append-only; tidak ada yang ditulis ulang)\", h0 === h1, h0 === h1 ? \"identik\" : `${h0} → ${h1}`);\nrec(`PO historis TIDAK diproses oleh rilis: Harga Berlaku bersumber PO = ${s1.hargaPO} (sebelum rilis: ${B(\"BASE_HARGA_PO\")}; tidak bertambah)`, s1.hargaPO <= B(\"BASE_HARGA_PO\"));\nrec(\"jurnal tidak seimbang (sebelum rilis: \" + B(\"BASE_TIDAK_SEIMBANG\") + \", tidak bertambah)\", (await hitung(\"select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x\")) <= B(\"BASE_TIDAK_SEIMBANG\"));\nrec(\"jumlah Order & Job tidak berkurang (sebelum: \" + B(\"ORDER_N\") + \" / \" + B(\"JOB_N\") + \")\", (await hitung('select count(*)::int n from \"Order\"')) >= B(\"ORDER_N\") && (await hitung(\"select count(*)::int n from jobs\")) >= B(\"JOB_N\"));\nconsole.log(`  INFO  saklar HARGA_DARI_PO pada proses smoke: ${process.env.HARGA_DARI_PO === undefined ? \"tidak diset (aktif)\" : JSON.stringify(process.env.HARGA_DARI_PO)}`);\nawait prisma.$disconnect();\nconsole.log(\"\\nRINGKASAN smoke: \" + fail + \" gagal, \" + dilewati + \" dilewati (SKIP)\");\nconsole.log(\"SMOKE_HASIL fail=\" + fail + \" skip=\" + dilewati);\nprocess.exit(fail ? 1 : 0);\n"; // diganti generator dengan isi smoke-harga-dari-po.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji Harga Berlaku dari PO hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Harga Berlaku otomatis dari PO": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Semua tulisan hanya di DB sementara ini. Di salinan inilah bahan nyata ber-Harga Berlaku dipakai: harga tertulis saat PO disimpan, tanpa menyentuh stok/valuasi/jurnal; seluruh baris Harga Berlaku lama harus identik.
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
const buat = async (nama, role) => prisma.user.create({ data: { name: `REH ${nama}`, email: `reh-${nama.toLowerCase()}-${stamp}@example.test`, passwordHash: "x", role } });
// pembuat PO: finance:post TANPA izin harga (harga_berlaku:edit) bila ada — membuktikan tidak butuh izin harga tambahan
const penyimpan = info.filter((x) => bisa(x.rs, P.FINANCE_POST)); const tanpaIzinHarga = penyimpan.filter((x) => !bisa(x.rs, P.FINANCE_HARGA_BERLAKU_EDIT));
const uSimpan = (tanpaIzinHarga[0] ?? penyimpan[0])?.u ?? await buat("Simpan", "ADMIN"); const uSimpan2 = (tanpaIzinHarga[1] ?? penyimpan.find((x) => x.u.id !== uSimpan.id) ?? {}).u ?? await buat("Simpan2", "ADMIN");
const uSetuju = info.find((x) => bisa(x.rs, P.FINANCE_APPROVE))?.u ?? await buat("Setuju", "ADMIN"); const uHarga = info.find((x) => bisa(x.rs, P.FINANCE_HARGA_BERLAKU_EDIT))?.u ?? await buat("Harga", "OWNER");
const uTanpa = info.find((x) => !bisa(x.rs, P.FINANCE_POST))?.u ?? await buat("Sales", "SALES");
const tS = await token(uSimpan); const tS2 = await token(uSimpan2); const tA = await token(uSetuju); const tH = await token(uHarga); const tN = await token(uTanpa);
cek("akun uji tersedia: dua penyimpan PO (finance:post), penyetuju, pengubah harga manual, dan akun tanpa finance:post", !!uSimpan && !!uSimpan2 && uSimpan.id !== uSimpan2.id && !!uSetuju && !!uHarga && !!uTanpa, `penyimpan tanpa izin harga: ${bisa(await rolesDari(uSimpan), P.FINANCE_HARGA_BERLAKU_EDIT) ? "TIDAK (punya)" : "YA (tanpa finance:harga_berlaku:edit)"}`);
const H = async (metode, p, tok, body = null, kunci = null) => { const r = await fetch(BASE + p, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kunci ? { "Idempotency-Key": kunci } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
let seq = 0; const kunci = (p) => `po-reh-${p}-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 10)}`;
const PO = "/api/finance/purchase-orders"; const PV = `${PO}/pratinjau-harga`; const HB = "/api/finance/biaya-bahan/harga-berlaku";
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const sup = await prisma.finSupplier.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }) ?? await prisma.finSupplier.create({ data: { code: `SUP-REH-${stamp}`, name: "PEMASOK REH" } });
const bentukPO = (lines) => ({ supplierId: sup.id, orderDate: hariIni, expectedDate: hariIni, notes: "uji rehearsal harga dari PO", lines });
const jejak = async () => ({
  stok: await prisma.stockMovement.count(), valuasi: await num("select count(*)::int n from fin_stock_movement_valuations"), jurnal: await prisma.finJournalEntry.count(), jurnalBaris: await prisma.finJournalLine.count(),
  biayaBeku: await prisma.stockMovementBiayaOperasional.count(), catatan: await prisma.unitUsageNote.count(), material: await prisma.material.count(),
});
const sama = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const semuaHarga = () => prisma.materialHargaBerlaku.count();
const hargaPO = () => num("select count(*)::int n from material_harga_berlaku where impact->>'sumber' = 'PO' or idempotency_key like 'po-harga:%'");
const barisH = (id) => prisma.materialHargaBerlaku.findMany({ where: { materialId: id }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] });
const poCount = () => prisma.finPurchaseOrder.count();
const riwayat = async (id) => (await H("GET", `${HB}/bahan/${id}/riwayat`, tH)).body?.riwayat ?? [];
const bulat = (x) => Math.round(Number(x) * 10000) / 10000;
const naik = (h, f = 1.1) => { const b = Math.round(Number(h) * f); return b === Math.round(Number(h)) ? b + 1 : b; };
const sidikHarga = async (ids) => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(h::text, '|' order by h.id::text)), '-') as n from material_harga_berlaku h where h.id::text = any($1::text[])", ids))[0].n);

// ── bahan NYATA di salinan restore (punya Harga Berlaku berlaku sekarang; satuan harga = satuan stok)
const nyata = await prisma.$queryRawUnsafe("select distinct on (h.material_id) h.material_id::text id, m.code, m.unit, h.unit_price::float8 harga from material_harga_berlaku h join materials m on m.id = h.material_id where h.jenis = 'HARGA' and h.effective_from <= now() and m.active = true and h.satuan = m.unit::text and h.unit_price > 100 and h.unit_price < 100000000 and not exists (select 1 from material_harga_berlaku k where k.corrects_id = h.id) order by h.material_id, h.effective_from desc, h.created_at desc limit 12");
cek("ada >= 3 bahan nyata ber-Harga Berlaku di salinan restore untuk uji", nyata.length >= 3, `${nyata.length} bahan`);
if (nyata.length < 3) { berhenti(); await prisma.$disconnect(); console.log("PEMERIKSAAN=" + n + " gagal=" + gagal); process.exit(1); }
const [A, B, C] = nyata; const t0 = new Date(Date.now() - 2000);
const asing = (m) => (m.unit === "BOX" ? "CAN" : "BOX"); // satuan beli SAH (SATUAN_VALID) yang berbeda dari satuan stok bahan
const idHargaAwal = (await prisma.materialHargaBerlaku.findMany({ select: { id: true } })).map((r) => r.id); const sidik0 = await sidikHarga(idHargaAwal);
const j0 = await jejak(); const hargaPO0 = await hargaPO(); const harga0 = await semuaHarga(); const po0 = await poCount();
cek(`PO historis di salinan: Harga Berlaku bersumber PO sebelum uji = ${hargaPO0} (rilis tidak memproses PO historis; bila >0 itu bukan dari rilis ini)`, true);

// ── 1. pratinjau formulir: baca-saja
const pv = await H("POST", PV, tS, { lines: [{ materialId: A.id, unitPrice: naik(A.harga) }] });
cek("pratinjau formulir: 200, status NAIK dengan harga lama = Harga Berlaku sekarang, akan menulis 1 — dan TIDAK menulis apa pun (Harga Berlaku & PO tidak bertambah)", pv.status === 200 && pv.body?.baris?.[0]?.status === "NAIK" && Number(pv.body.baris[0].hargaLama) === Number(A.harga) && pv.body.ringkas.akanMenulis === 1 && (await semuaHarga()) === harga0 && (await poCount()) === po0, `${pv.status} ${pv.body?.baris?.[0]?.status}`);

// ── 2. simpan PO BARU (draf): harga langsung jadi Harga Berlaku operasional oleh pembuat PO TANPA izin harga
const hargaA1 = naik(A.harga); const k1 = kunci("buat");
const r1 = await H("POST", PO, tS, bentukPO([{ materialId: A.id, qty: 3, unitPrice: hargaA1 }, { materialId: B.id, qty: 2, unitPrice: B.harga }]), k1);
const hA = await barisH(A.id); const barisBaruA = hA[hA.length - 1];
cek("simpan PO baru: 201 DRAFT; Harga Berlaku bahan yang naik tertulis SAAT DISIMPAN (bukan menunggu persetujuan) dengan harga lama tercatat; bahan yang harganya sama TIDAK menulis baris baru", r1.status === 201 && r1.body?.status === "DRAFT" && hA.length >= 2 && Number(barisBaruA.unitPrice) === hargaA1 && Number(barisBaruA.previousPrice) === Number(A.harga) && (await barisH(B.id)).length === (await prisma.materialHargaBerlaku.count({ where: { materialId: B.id } })) && r1.body?.hargaDariPO?.diterapkan?.length === 1 && (await semuaHarga()) === harga0 + 1, `${r1.status} diterapkan=${r1.body?.hargaDariPO?.diterapkan?.length} baris=${(await semuaHarga()) - harga0}`);
cek("sumber tercatat lengkap: nomor PO, baris, revisi 0, pelaku = penyimpan, alasan otomatis, efektif saat disimpan (tanpa mundur), tanpa bukti ⇒ label ‘Belum didukung bukti’", barisBaruA.impact?.sumber === "PO" && barisBaruA.impact?.poId === r1.body.id && barisBaruA.impact?.barisPO === 1 && barisBaruA.impact?.revisi === 0 && barisBaruA.impact?.pelakuId === uSimpan.id && barisBaruA.createdById === uSimpan.id && String(barisBaruA.reason).startsWith(`Otomatis dari PO ${r1.body.poNumber} (baris 1, revisi 0)`) && Math.abs(barisBaruA.effectiveFrom.getTime() - barisBaruA.createdAt.getTime()) < 5 && barisBaruA.evidenceNote === null, String(barisBaruA.reason).slice(0, 120));
const rw = await riwayat(A.id);
cek("riwayat bahan menampilkan sumber ‘Dari PO <nomor> — belum diterima’ dan label bukti ‘Belum didukung bukti’; baris Harga Berlaku sebelumnya utuh (riwayat tidak dihapus)", rw[0]?.sumber?.teks === `Dari PO ${r1.body.poNumber} — belum diterima` && rw[0]?.teksLabelBukti === "Belum didukung bukti" && rw.length === hA.length, `${rw[0]?.sumber?.teks}`);
cek("stok, valuasi Finance, jurnal, baris jurnal, biaya beku operasional, catatan pemakaian, material TIDAK berubah oleh simpan PO", sama(await jejak(), j0), JSON.stringify(await jejak()));

// ── 3. klik ganda / retry: kunci sama, isi sama
const hCPO0 = (await barisH(C.id)).filter((x) => x.impact?.sumber === "PO").length;
const ganda = await Promise.all([H("POST", PO, tS, bentukPO([{ materialId: C.id, qty: 1, unitPrice: naik(C.harga) }]), "po-reh-ganda-" + stamp + "-0001xxxx"), H("POST", PO, tS, bentukPO([{ materialId: C.id, qty: 1, unitPrice: naik(C.harga) }]), "po-reh-ganda-" + stamp + "-0001xxxx")]);
const susulan = await H("POST", PO, tS, bentukPO([{ materialId: C.id, qty: 1, unitPrice: naik(C.harga) }]), "po-reh-ganda-" + stamp + "-0001xxxx");
const hC = await barisH(C.id); const hCPO = hC.filter((x) => x.impact?.sumber === "PO");
cek("klik ganda (paralel + susulan, kunci sama): tepat SATU PO dan SATU baris Harga Berlaku untuk bahan itu; respons susulan = PO yang sama", ganda.some((x) => x.status === 201) && ganda.every((x) => [200, 201, 409].includes(x.status)) && [200, 201].includes(susulan.status) && hCPO.length === hCPO0 + 1 && (await poCount()) === po0 + 2 && (new Set([...ganda, susulan].filter((x) => x.body?.id).map((x) => x.body.id))).size === 1, `${ganda.map((x) => x.status)} ${susulan.status} baris baru=${hCPO.length - hCPO0}`);

// ── 4. ubah draf: jumlah saja & simpan ulang tidak menulis; harga berubah menulis revisi baru; baris lama utuh
const nSebelumUbah = await semuaHarga();
const q = await H("PATCH", `${PO}/${r1.body.id}`, tS, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: A.id, qty: 9, unitPrice: hargaA1 }, { materialId: B.id, qty: 2, unitPrice: B.harga }] });
const q2 = await H("PATCH", `${PO}/${r1.body.id}`, tS2, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: A.id, qty: 9, unitPrice: hargaA1 }, { materialId: B.id, qty: 2, unitPrice: B.harga }] });
cek("ubah jumlah saja, lalu simpan ulang yang sama (pengguna lain): 200 dan TIDAK ada baris Harga Berlaku baru (klik ganda/retry aman)", q.status === 200 && q2.status === 200 && q.body?.hargaDariPO?.diterapkan?.length === 0 && q2.body?.hargaDariPO?.diterapkan?.length === 0 && (await semuaHarga()) === nSebelumUbah, `${q.status}/${q2.status}`);
const hargaA2 = naik(hargaA1);
const u = await H("PATCH", `${PO}/${r1.body.id}`, tS, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: A.id, qty: 9, unitPrice: hargaA2 }, { materialId: B.id, qty: 2, unitPrice: B.harga }] });
const hA2 = await barisH(A.id); const rev1 = hA2[hA2.length - 1];
cek("ubah harga di draf: tepat 1 baris baru (revisi 1) dengan harga lama = baris sebelumnya; baris sebelumnya UTUH (append-only)", u.status === 200 && u.body?.hargaDariPO?.diterapkan?.length === 1 && Number(rev1.unitPrice) === hargaA2 && Number(rev1.previousPrice) === hargaA1 && rev1.impact?.revisi === 1 && /:r1$/.test(rev1.idempotencyKey) && sama(hA2.slice(0, hA.length).map((x) => x.id), hA.map((x) => x.id)) && Number(hA2[hA.length - 1].unitPrice) === hargaA1, `${u.status}`);

// ── 5. harga LEBIH BARU dari sumber lain tidak ditimpa: simpan ulang draf lama, lalu persetujuan
const manual = { materialId: A.id, hargaBaru: String(naik(hargaA2, 1.2)), satuan: A.unit, alasan: "Harga nota supplier (uji rehearsal)", berlakuMulai: null };
const pm = await H("POST", `${HB}/pratinjau`, tH, manual); const sm1 = await H("POST", HB, tH, { ...manual, hashPratinjau: pm.body?.hash }, "manual-reh-" + stamp + "-0001xxxx");
cek("Ubah harga manual tetap tersedia (pratinjau + simpan dengan alasan): 201", pm.status === 200 && sm1.status === 201, `${pm.status}/${sm1.status}`);
const nAkhirManual = await semuaHarga(); const hargaManual = bulat(manual.hargaBaru);
const basi = await H("PATCH", `${PO}/${r1.body.id}`, tS, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: A.id, qty: 11, unitPrice: hargaA2 }, { materialId: B.id, qty: 2, unitPrice: B.harga }] });
const hA3 = await barisH(A.id);
cek("simpan ulang draf LAMA (jumlah saja) sesudah ada harga yang lebih baru: harga TIDAK dikembalikan ke harga draf, tidak ada baris baru", basi.status === 200 && basi.body?.hargaDariPO?.diterapkan?.length === 0 && (await semuaHarga()) === nAkhirManual && Number(hA3[hA3.length - 1].unitPrice) === hargaManual, `${basi.status}`);
const ap = await H("POST", `${PO}/${r1.body.id}/approve`, tA, {}); const ap2 = await H("POST", `${PO}/${r1.body.id}/approve`, tA, {});
const hA4 = await barisH(A.id);
cek("persetujuan PO: 200 DISETUJUI, TIDAK menulis ulang dan TIDAK mengembalikan harga yang lebih baru (jumlah baris sama, harga terakhir = manual); persetujuan ulang 409", ap.status === 200 && ap.body?.status === "DISETUJUI" && ap2.status === 409 && (await semuaHarga()) === nAkhirManual && Number(hA4[hA4.length - 1].unitPrice) === hargaManual, `${ap.status}/${ap2.status}`);

// ── 6. harga terjadwal tetap mengikuti waktu berlakunya
const depan = new Date(Date.now() + 6 * 86_400_000).toISOString(); const jadwal = { materialId: B.id, hargaBaru: String(naik(B.harga, 1.3)), satuan: B.unit, alasan: "Kenaikan terjadwal (uji rehearsal)", berlakuMulai: depan };
const terjadwal0 = ((await H("GET", `${HB}/bahan/${B.id}`, tH)).body?.terjadwal ?? []).length;
const pj = await H("POST", `${HB}/pratinjau`, tH, jadwal); const sj = await H("POST", HB, tH, { ...jadwal, hashPratinjau: pj.body?.hash }, "jadwal-reh-" + stamp + "-0001xxxx");
const pvJ = await H("POST", PV, tS, { lines: [{ materialId: B.id, unitPrice: naik(B.harga, 1.05) }] });
const rB = await H("POST", PO, tS, bentukPO([{ materialId: B.id, qty: 1, unitPrice: naik(B.harga, 1.05) }]), kunci("jadwal"));
const ringB = (await H("GET", `${HB}/bahan/${B.id}`, tH)).body;
cek("harga TERJADWAL: pratinjau memperingatkan ADA_HARGA_TERJADWAL; PO menulis harga sekarang, sedangkan harga terjadwal tetap ada dengan waktu berlakunya (tidak berlaku lebih awal, tidak ditimpa)", sj.status === 201 && pvJ.body?.baris?.[0]?.peringatan?.some((x) => x.kode === "ADA_HARGA_TERJADWAL") && rB.status === 201 && ringB?.hargaBerlaku?.harga === naik(B.harga, 1.05) && ringB?.terjadwal?.length === terjadwal0 + 1 && ringB.terjadwal.some((x) => Number(x.harga) === bulat(jadwal.hargaBaru)), `${sj.status} ${rB.status} berlaku=${ringB?.hargaBerlaku?.harga} terjadwal=${ringB?.terjadwal?.length} (sebelum ${terjadwal0})`);

// ── 7. konflik & konversi tidak sah ditolak TANPA tulisan sebagian
const sebelumTolak = { po: await poCount(), harga: await semuaHarga(), jejak: await jejak() };
const tKonflik = await H("POST", PO, tS, bentukPO([{ materialId: C.id, qty: 1, unitPrice: C.harga }, { materialId: C.id, qty: 1, unitPrice: naik(C.harga, 1.5) }]), kunci("konflik"));
cek("dua baris bahan SAMA dengan harga stok berbeda: ditolak 4xx; tidak ada PO dan tidak ada Harga Berlaku yang tertulis", tKonflik.status >= 400 && tKonflik.status < 500 && (await poCount()) === sebelumTolak.po && (await semuaHarga()) === sebelumTolak.harga, `${tKonflik.status} ${String(tKonflik.body?.error ?? "").slice(0, 90)}`);
const tFaktor = await H("POST", PO, tS, bentukPO([{ materialId: A.id, qty: 1, unitPrice: naik(hargaManual, 1.2) }, { materialId: B.id, qty: 1, unitPrice: B.harga, satuanBeli: asing(B) }]), kunci("faktor"));
cek("satuan beli beda TANPA faktor konversi di baris 2 (baris 1 valid dan harganya naik): ditolak 400 menunjuk BARIS 2; baris 1 TIDAK tertulis; PO tidak tersimpan", tFaktor.status === 400 && String(tFaktor.body?.error ?? "").startsWith("Baris 2 (") && /faktor/i.test(String(tFaktor.body?.error ?? "")) && (await poCount()) === sebelumTolak.po && (await semuaHarga()) === sebelumTolak.harga, `${tFaktor.status} ${String(tFaktor.body?.error ?? "").slice(0, 110)}`);
const tNol = await H("POST", PO, tS, bentukPO([{ materialId: A.id, qty: 1, unitPrice: naik(hargaManual, 1.2) }, { materialId: B.id, qty: 1, unitPrice: B.harga, satuanBeli: asing(B), faktorKonversi: "0" }]), kunci("faktor0"));
cek("faktor konversi 0 (tidak sah): ditolak 4xx tanpa tulisan sebagian", tNol.status >= 400 && tNol.status < 500 && (await poCount()) === sebelumTolak.po && (await semuaHarga()) === sebelumTolak.harga, `${tNol.status}`);
const tUbahGagal = await H("PATCH", `${PO}/${rB.body.id}`, tS, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: B.id, qty: 1, unitPrice: naik(B.harga, 1.07) }, { materialId: C.id, qty: 1, unitPrice: 1_500_000_000 }] });
const barisPoB = await prisma.finPurchaseOrderLine.findMany({ where: { purchaseOrderId: rB.body.id } });
cek("ubah draf yang gagal di baris 2 (harga tak masuk akal): ditolak 400 baris 2; isi PO TETAP; harga baris 1 yang valid tidak ditulis (atomik)", tUbahGagal.status === 400 && tUbahGagal.body?.baris === 2 && barisPoB.length === 1 && Number(barisPoB[0].unitPrice) === naik(B.harga, 1.05) && (await semuaHarga()) === sebelumTolak.harga, `${tUbahGagal.status} baris=${tUbahGagal.body?.baris}`);
const konversi = await H("POST", PO, tS, bentukPO([{ materialId: C.id, qty: 1, unitPrice: bulat(naik(C.harga, 1.2) * 4), satuanBeli: asing(C), faktorKonversi: "4" }]), kunci("konversi"));
const hCk = (await barisH(C.id)).filter((x) => x.impact?.sumber === "PO").pop();
cek("konversi sah (1 satuan beli sah = 4 satuan stok): tersimpan; Harga Berlaku = harga beli ÷ faktor dalam satuan stok, faktor tercatat pada sumber", konversi.status === 201 && Number(hCk.unitPrice) === naik(C.harga, 1.2) && hCk.impact?.faktor != null && Number(hCk.impact.faktor) === 4 && hCk.satuan === C.unit, `${konversi.status} ${hCk?.unitPrice}/${hCk?.satuan}`);

// ── 8. pembatalan tidak menghapus riwayat dan tidak mengembalikan harga
const nSebelumBatal = await semuaHarga(); const hargaTerakhirB = Number((await barisH(B.id)).pop().unitPrice);
const cb = await H("POST", `${PO}/${rB.body.id}/cancel`, tS, { reason: "Uji rehearsal pembatalan" }); const hB2 = await barisH(B.id);
const rwB = await riwayat(B.id);
cek("pembatalan PO: 200 DIBATALKAN; Harga Berlaku TIDAK dikembalikan dan tidak ada baris dihapus/ditambah; sumber di riwayat berlabel ‘PO dibatalkan’; respons memberi peringatan", cb.status === 200 && cb.body?.status === "DIBATALKAN" && (await semuaHarga()) === nSebelumBatal && Number(hB2[hB2.length - 1].unitPrice) === hargaTerakhirB && /PO dibatalkan/.test(rwB.find((x) => x.sumber?.poNumber === rB.body.poNumber)?.sumber?.teks ?? "") && /TIDAK dikembalikan/.test(String(cb.body?.peringatanHarga ?? "")), `${cb.status}`);

// ── 9. izin
const jIzin0 = { po: await poCount(), harga: await semuaHarga() };
const i401 = await H("POST", PO, null, bentukPO([{ materialId: A.id, qty: 1, unitPrice: 1 }]), kunci("i401")); const i403 = await H("POST", PO, tN, bentukPO([{ materialId: A.id, qty: 1, unitPrice: 1 }]), kunci("i403")); const p403 = await H("POST", PV, tN, { lines: [] });
cek("izin: tanpa token 401; akun tanpa finance:post 403 (simpan) dan tanpa finance:read 403 (pratinjau); tidak ada tulisan", i401.status === 401 && i403.status === 403 && p403.status === 403 && (await poCount()) === jIzin0.po && (await semuaHarga()) === jIzin0.harga, `${i401.status}/${i403.status}/${p403.status}`);

// ── 10. SAKLAR HARGA_DARI_PO=0: server kedua (kode yang sama) menghentikan penulisan harga, simpan PO tetap berfungsi
const PORT2 = PORT + 1; const BASE2 = `http://127.0.0.1:${PORT2}`;
const child2 = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT2), DISABLE_BACKGROUND_JOBS: "1", HARGA_DARI_PO: "0" }, stdio: ["ignore", "pipe", "pipe"] });
let log2 = ""; child2.stdout.on("data", (d) => { log2 += d; }); child2.stderr.on("data", (d) => { log2 += d; }); const berhenti2 = () => { try { child2.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat2 = false; for (let i = 0; i < 60 && !sehat2; i++) { try { sehat2 = (await fetch(BASE2 + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kedua dengan HARGA_DARI_PO=0 hidup (kode sama, hanya saklar yang berbeda)", sehat2, sehat2 ? "" : log2.slice(-300));
if (sehat2) {
  const H2 = async (metode, p, tok, body = null, kn = null) => { const r = await fetch(BASE2 + p, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kn ? { "Idempotency-Key": kn } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
  const nH = await semuaHarga(); const nP = await poCount();
  const pvOff = await H2("POST", PV, tS, { lines: [{ materialId: A.id, unitPrice: naik(hargaManual, 1.3) }] });
  const mati = await H2("POST", PO, tS, bentukPO([{ materialId: A.id, qty: 1, unitPrice: naik(hargaManual, 1.3) }]), kunci("saklar"));
  const dr = mati.body?.id ? await H2("PATCH", `${PO}/${mati.body.id}`, tS, { supplierId: sup.id, orderDate: hariIni, lines: [{ materialId: A.id, qty: 2, unitPrice: naik(hargaManual, 1.4) }] }) : { status: 0 };
  cek("saklar HARGA_DARI_PO=0: simpan PO baru 201 dan ubah draf 200 TETAP berfungsi, tetapi TIDAK ada Harga Berlaku yang ditulis (aktif=false) dan pratinjau menyatakan tidak aktif", mati.status === 201 && dr.status === 200 && mati.body?.hargaDariPO?.aktif === false && pvOff.body?.aktif === false && (await semuaHarga()) === nH && (await poCount()) === nP + 1, `${mati.status}/${dr.status} aktif=${mati.body?.hargaDariPO?.aktif}`);
  berhenti2();
}

// ── 11. invarian: tidak ada yang selain PO + Harga Berlaku bersumber PO/manual uji yang berubah
const jAkhir = await jejak();
cek("SETELAH seluruh uji: stok, valuasi Finance, jurnal, baris jurnal, biaya beku operasional, catatan pemakaian, dan material IDENTIK dengan sebelum uji (tidak ada penilaian ulang pemakaian lama, tidak ada jurnal)", sama(jAkhir, j0), JSON.stringify({ sebelum: j0, sesudah: jAkhir }));
cek("SETELAH seluruh uji: SEMUA baris Harga Berlaku yang sudah ada sebelum uji identik (append-only; tidak ada yang diubah, ditulis ulang, atau dihapus)", (await sidikHarga(idHargaAwal)) === sidik0 && (await num("select count(*)::int n from material_harga_berlaku where id::text = any($1::text[])", idHargaAwal)) === idHargaAwal.length);
const barisPOBaru = (await hargaPO()) - hargaPO0;
cek(`Harga Berlaku bersumber PO bertambah HANYA oleh PO uji ini (${barisPOBaru} baris); tak satu pun PO historis diproses`, barisPOBaru > 0 && (await num("select count(*)::int n from material_harga_berlaku h where (h.impact->>'sumber' = 'PO') and not exists (select 1 from fin_purchase_orders p where p.id::text = h.impact->>'poId' and p.created_at >= $1)", t0)) === 0);

// ── 12. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_HARGA_PO: String(await hargaPO()), ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-700));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
# direktori sementara dibuat root oleh kontainer: dihapus lewat kontainer (rm biasa ditolak); kegagalan pembersihan tidak menggagalkan rilis
dcp "$NEW_DIR" run --rm --no-deps -T -v "$BK_DIR:/bk" backend sh -c 'rm -rf /bk/reh-data /bk/reh-uploads /bk/reh-dd' </dev/null >/dev/null 2>&1 || true
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; uji tulis PO uji dan harga manual/terjadwal uji dilakukan HANYA pada salinan restore lalu DB sementara dihapus"
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
COUNT_SQL="select 'purchase_orders', count(*) from fin_purchase_orders union all select 'purchase_order_lines', count(*) from fin_purchase_order_lines union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'harga_dari_po', count(*) from material_harga_berlaku where impact->>'sumber' = 'PO' union all select 'stock_movements', count(*) from stock_movements union all select 'valuasi_stok', count(*) from fin_stock_movement_valuations union all select 'biaya_beku', count(*) from stock_movement_biaya_operasional union all select 'material_issues', count(*) from material_issues union all select 'jurnal', count(*) from fin_journal_entries union all select 'baris_jurnal', count(*) from fin_journal_lines union all select 'materials', count(*) from materials union all select 'catatan_pemakaian', count(*) from unit_usage_notes union all select 'units', count(*) from units union all select 'order', count(*) from \"Order\" union all select 'jobs', count(*) from jobs"
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
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: pratinjau harga formulir PO pada bahan nyata (SAMA/NAIK/konversi/konflik/BARU; nol penulisan), izin 401/403, penolakan sebelum menulis; TANPA PO/harga percobaan; PO, Harga Berlaku, stok, valuasi, jurnal, biaya beku identik"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e BASE_HARGA_PO="$BASE_HARGA_PO" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
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
// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang dipakai hanya pratinjau harga formulir PO (baca-saja, tidak menulis) dan PENOLAKAN sebelum menyentuh data (tanpa token, tanpa izin, masukan kosong).
// TIDAK ada PO dan TIDAK ada Harga Berlaku percobaan yang dibuat. Jejak tulis (PO, baris PO, Harga Berlaku, stok, valuasi, jurnal, biaya beku, catatan pemakaian) harus identik sebelum vs sesudah.
// PO historis TIDAK diproses oleh rilis ini: jumlah Harga Berlaku bersumber PO (impact.sumber = 'PO') tidak boleh bertambah akibat smoke.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const post = async (p, token, body = {}, hdr = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...hdr }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.FINANCE_READ))?.u; const penyimpan = info.find((x) => bisa(x.rs, P.FINANCE_POST))?.u; const tanpaIzin = info.find((x) => !bisa(x.rs, P.FINANCE_READ))?.u;
if (!pembaca) { rec("akun dengan finance:read tersedia", false); process.exit(1); }
const tR = await tokenUntuk(pembaca); const tP = penyimpan ? await tokenUntuk(penyimpan) : null; const tN = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;
const jejak = async () => ({
  po: await hitung("select count(*)::int n from fin_purchase_orders"), poBaris: await hitung("select count(*)::int n from fin_purchase_order_lines"), poStatus: await hitung("select coalesce(sum(length(status::text)),0)::int n from fin_purchase_orders"),
  harga: await hitung("select count(*)::int n from material_harga_berlaku"), hargaPO: await hitung("select count(*)::int n from material_harga_berlaku where impact->>'sumber' = 'PO' or idempotency_key like 'po-harga:%'"),
  stok: await hitung("select count(*)::int n from stock_movements"), valuasi: await hitung("select count(*)::int n from fin_stock_movement_valuations"), jurnal: await hitung("select count(*)::int n from fin_journal_entries"), jurnalBaris: await hitung("select count(*)::int n from fin_journal_lines"),
  biayaBeku: await hitung("select count(*)::int n from stock_movement_biaya_operasional"), catatan: await hitung("select count(*)::int n from unit_usage_notes"), material: await hitung("select count(*)::int n from materials"),
});
// sidik isi Harga Berlaku (append-only): tidak satu baris pun berubah
const sidikHarga = async () => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(h::text, '|' order by h.id::text)), '-') as n from material_harga_berlaku h"))[0].n);
const s0 = await jejak(); const h0 = await sidikHarga();
const PO = "/api/finance/purchase-orders"; const PV = `${PO}/pratinjau-harga`;

// ── pratinjau baca-saja pada bahan NYATA yang punya Harga Berlaku sekarang (harga stok + satuan dari tabel)
const nyata = await prisma.$queryRawUnsafe("select distinct on (h.material_id) h.material_id::text id, m.code, m.name, m.unit, h.unit_price::float8 harga, h.satuan from material_harga_berlaku h join materials m on m.id = h.material_id where h.jenis = 'HARGA' and h.effective_from <= now() and m.active = true and h.satuan = m.unit::text and h.unit_price > 0 and not exists (select 1 from material_harga_berlaku k where k.corrects_id = h.id) order by h.material_id, h.effective_from desc, h.created_at desc limit 40");
const tanpaHarga = await prisma.$queryRawUnsafe("select m.id::text id, m.code, m.unit from materials m where m.active = true and not exists (select 1 from material_harga_berlaku h where h.material_id = m.id) order by m.code limit 1");
if (nyata.length >= 1) {
  const m = nyata[0]; const asing = m.unit === "BOX" ? "CAN" : "BOX"; // satuan beli sah yang berbeda dari satuan stok
  const same = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga }] });
  rec(`pratinjau ${m.code}: harga yang SAMA dengan Harga Berlaku sekarang (${m.harga}/${m.satuan}) = SAMA, tidak ada yang akan ditulis`, same.status === 200 && same.json?.baris?.[0]?.status === "SAMA" && same.json?.ringkas?.akanMenulis === 0, `${same.status} ${same.json?.baris?.[0]?.status}`);
  const naik = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: Math.round(m.harga * 1.1 * 10000) / 10000 }] });
  rec(`pratinjau ${m.code}: harga naik 10% = NAIK dengan harga lama ${m.harga} dan sumber/satuan terbaca; hanya pratinjau (nol penulisan)`, naik.status === 200 && naik.json?.baris?.[0]?.status === "NAIK" && Number(naik.json.baris[0].hargaLama) === Number(m.harga) && naik.json.ringkas.akanMenulis === 1, `${naik.status} ${naik.json?.baris?.[0]?.status} lama=${naik.json?.baris?.[0]?.hargaLama}`);
  const tak = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga, satuanBeli: asing }] });
  rec(`pratinjau ${m.code}: satuan beli berbeda tanpa faktor konversi = masalah KONVERSI_TIDAK_ADA (tidak ditebak; PO akan ditolak di baris itu)`, tak.status === 200 && tak.json?.baris?.[0]?.status === "KONVERSI_TIDAK_ADA" && tak.json.ringkas.masalah === 1, `${tak.status} ${tak.json?.baris?.[0]?.status}`);
  const tidakSah = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga, satuanBeli: asing, faktorKonversi: "0" }] });
  rec(`pratinjau ${m.code}: faktor konversi 0 = KONVERSI_TIDAK_SAH`, tidakSah.status === 200 && tidakSah.json?.baris?.[0]?.status === "KONVERSI_TIDAK_SAH", `${tidakSah.status} ${tidakSah.json?.baris?.[0]?.status}`);
  const konflik = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga }, { materialId: m.id, unitPrice: Math.round(m.harga * 1.5 * 10000) / 10000 }] });
  rec(`pratinjau ${m.code}: dua baris bahan sama dengan harga stok berbeda = KONFLIK_HARGA_BEDA (tidak memilih salah satu)`, konflik.status === 200 && konflik.json?.baris?.length === 1 && konflik.json.baris[0].status === "KONFLIK_HARGA_BEDA", `${konflik.status} ${konflik.json?.baris?.[0]?.status}`);
} else skip("pratinjau pada bahan nyata ber-Harga Berlaku", "tidak ada bahan aktif dengan Harga Berlaku berlaku sekarang (satuan = satuan stok)");
if (tanpaHarga.length >= 1) {
  const t = tanpaHarga[0]; const baru = await post(PV, tR, { lines: [{ materialId: t.id, unitPrice: 1234 }] });
  rec(`pratinjau ${t.code} (belum punya Harga Berlaku): BARU, harga lama kosong; nol penulisan`, baru.status === 200 && baru.json?.baris?.[0]?.status === "BARU" && baru.json.baris[0].hargaLama == null, `${baru.status} ${baru.json?.baris?.[0]?.status}`);
} else skip("pratinjau bahan tanpa Harga Berlaku", "semua bahan aktif sudah punya Harga Berlaku");

// ── penolakan SEBELUM menulis
rec("pratinjau-harga tanpa token = 401", (await post(PV, null, { lines: [] })).status === 401);
rec("simpan PO tanpa token = 401 (tidak menulis)", (await post(PO, null, { lines: [] }, { "Idempotency-Key": "smoke-hpo-tidak-menulis-0001" })).status === 401);
if (tN) {
  rec("pratinjau-harga akun tanpa finance:read = 403", (await post(PV, tN, { lines: [] })).status === 403);
  rec("simpan PO oleh akun tanpa izin finance:post = 403 (tidak menulis)", (await post(PO, tN, { supplierId: "00000000-0000-4000-8000-000000000000", orderDate: "2026-10-30", lines: [{ materialId: "00000000-0000-4000-8000-000000000000", qty: 1, unitPrice: 1 }] }, { "Idempotency-Key": "smoke-hpo-tanpa-izin-0002" })).status === 403);
} else skip("penolakan 403 akun tanpa izin", "semua akun aktif punya finance:read");
if (tP) rec("simpan PO tanpa baris (lines kosong) oleh pemegang finance:post = 4xx (ditolak sebelum menulis apa pun)", (await post(PO, tP, { supplierId: "00000000-0000-4000-8000-000000000000", orderDate: "2026-10-30", lines: [] }, { "Idempotency-Key": "smoke-hpo-kosong-0003" })).status >= 400);
else skip("penolakan PO tanpa baris", "tidak ada akun aktif dengan finance:post");

// ── PO historis tidak diproses; tidak ada jejak tulis
const s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]); const h1 = await sidikHarga();
rec("TIDAK ada jejak tulis: PO, baris PO, Harga Berlaku, stok, valuasi Finance, jurnal, baris jurnal, biaya beku, catatan pemakaian, material sama persis sebelum vs sesudah smoke", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "identik");
rec("isi LENGKAP semua baris Harga Berlaku identik sebelum vs sesudah smoke (append-only; tidak ada yang ditulis ulang)", h0 === h1, h0 === h1 ? "identik" : `${h0} → ${h1}`);
rec(`PO historis TIDAK diproses oleh rilis: Harga Berlaku bersumber PO = ${s1.hargaPO} (sebelum rilis: ${B("BASE_HARGA_PO")}; tidak bertambah)`, s1.hargaPO <= B("BASE_HARGA_PO"));
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
console.log(`  INFO  saklar HARGA_DARI_PO pada proses smoke: ${process.env.HARGA_DARI_PO === undefined ? "tidak diset (aktif)" : JSON.stringify(process.env.HARGA_DARI_PO)}`);
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
  ok "smoke test lulus (pratinjau harga baca-saja, izin, penolakan sebelum menulis, tanpa jejak tulis, Harga Berlaku lama identik, PO historis tidak diproses, invarian)"
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
say "CATATAN: Rilis ini membawa Harga Berlaku otomatis dari PO: harga bahan menjadi Harga Berlaku operasional SAAT PO BERHASIL DISIMPAN (draf baru dan ubah draf), atomik dan idempoten, tanpa izin/dialog harga tambahan; persetujuan dan pembatalan PO tidak menulis atau mengembalikan harga; saklar darurat HARGA_DARI_PO=0. TANPA migrasi. Rilis TIDAK memproses PO historis dan TIDAK membuat PO/harga percobaan; tidak mengubah stok, valuasi Finance, jurnal, biaya beku, atau pemakaian lama. Perubahan nyata baru terjadi saat pengguna menyimpan PO. Rollback kode: harga yang sudah tertulis dari PO tetap ada (append-only)."

