#!/usr/bin/env bash
# RILIS "TRANSISI SATUAN BAHAN" (satuan operasional mengikuti Excel SO): BACKEND-SAJA + 1 migrasi ADITIF (2 kolom nullable di stock_movements, 1 tabel dokumen KOSONG, 3 fungsi + 3 trigger) — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • ISI: rute POST /api/inventory/materials/transisi-satuan/{pratinjau,terapkan} (Owner/penyetuju) dan GET /api/inventory/materials/:id/riwayat-satuan. Transisi satuan = SATU transaksi: tutup saldo satuan lama,
#     ubah satuan master, buka saldo satuan baru, catat dokumen append-only, dan pasang tautan SO bila catatan historis menunggu. Pergerakan baru diberi penanda satuan oleh trigger DB; pagar DB menolak
#     perubahan satuan master yang punya pergerakan di luar jalur transisi. Laporan Nilai Persediaan menandai bahan bertransisi (harga satuan lama TIDAK dipakai untuk satuan baru; cakupan PARSIAL bila ada kewajiban konversi terbuka).
#   • Skrip rilis TIDAK menjalankan transisi, TIDAK mengubah satuan bahan, TIDAK membuat/mengubah stok, harga, PO/GR, jurnal, PSA, penyesuaian, hasil SO, tautan, pemetaan, atau deklarasi historis. Migrasi hanya MENAMBAH struktur
#     (tabel dokumen tetap kosong; pergerakan lama TIDAK diisi ulang). Smoke pasca-switch = GET + POST yang DITOLAK sebelum menulis.
#   • Gate: preflight (keadaan production SEGAR/LANJUT/TOLAK, pin sha256 migrasi + diff schema, pemindai DDL + uji negatif); backup + RESTORE rehearsal (migrate deploy pada salinan restore dari data nyata; skema tabel lama identik; kode baru
#     berjalan sebagai SERVER terhadap salinan restore dan menjalankan transisi nyata HANYA pada salinan itu); TANPA build web (frontend/dist release aktif DIBAWA APA ADANYA dari disk); migrasi aditif ke production SEBELUM switch
#     (backend lama tetap melayani); switch SATU kali; verifikasi; smoke pasca-switch (kode smoke yang sama dengan rehearsal).
#   • PENGUNCIAN: kunci deploy BERSAMA + kunci sendiri diambil ATOMIK; kepemilikan ditentukan proses (perangkat:inode fd 7/9), BUKAN nama berkas. GERBANG IDENTITAS KODE LIVE (hash blob semua berkas terlacak baseline) di fase 2, 6, dan TEPAT sebelum switch.
#     Pembersihan release lama DINONAKTIFKAN; gerbang disk minimal 5 GiB tidak diturunkan.
#
#   cat scripts/release-transisi-satuan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/tsb.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/tsb.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/tsb.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/tsbr.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA migrasi production dan TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/tsb.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/tsb.out 2>&1 < /dev/null &'   # rilis penuh
#
# ROLLBACK: kode aman di-rollback kapan pun. Migrasi ADITIF dibiarkan terpasang (kolom nullable, tabel dokumen, trigger penanda satuan, pagar satuan master); kode lama berjalan normal di atas skema bermigrasi.
# Transisi yang SUDAH dijalankan lewat rute rilis ini (data) TIDAK dibalik oleh rollback kode; satuan master dan saldo satuan baru tetap. Rollback mengembalikan kode lama saja.
# (dibangkitkan oleh scripts/gen-release-transisi-satuan.cjs dari scripts/release-master-bertautan.sh + templat scripts/templates/release-transisi-satuan/* + pustaka scripts/lib/{rehearsal,smoke}-transisi-satuan.mjs; JANGAN edit tangan — ubah generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/transisi-satuan-bahan-on-5acf24db}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti (backend/prisma: hanya migrasi rilis + schema.prisma).
# Rilis backend + 1 migrasi aditif (diaudit, dipin sha256): apa pun di backend/prisma di luar migrasi rilis + schema.prisma = berhenti; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/prisma/migrations/20261231120000_transisi_satuan_bahan/migration\.sql|backend/prisma/schema\.prisma|backend/src/routes/inventory\.js|backend/src/services/inventoryLedger\.js|backend/src/services/nilaiPersediaan\.js|backend/src/services/transisiSatuanBahan\.js|backend/tests/integration/transisiSatuanBahan\.integration\.test\.js|scripts/gen-release-transisi-satuan\.cjs|scripts/lib/rehearsal-transisi-satuan\.mjs|scripts/lib/smoke-transisi-satuan\.mjs|scripts/release-transisi-satuan\.sh|scripts/templates/release-transisi-satuan/gate-prisma\.txt|scripts/templates/release-transisi-satuan/header\.txt|scripts/templates/release-transisi-satuan/keadaan\.txt|scripts/templates/release-transisi-satuan/rehearsal-migrasi\.txt|scripts/templates/release-transisi-satuan/rollback\.txt|scripts/templates/release-transisi-satuan/step6\.txt|scripts/templates/release-transisi-satuan/struktur\.txt|scripts/templates/release-transisi-satuan/vars\.txt)$'
BACKEND_SRC_EXPECT="backend/src/routes/inventory.js backend/src/services/inventoryLedger.js backend/src/services/nilaiPersediaan.js backend/src/services/transisiSatuanBahan.js"
FRONTEND_SRC_EXPECT=""
# Migrasi ADITIF yang SUDAH diaudit (nama + sha256 isi, LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIG_NAME="20261231120000_transisi_satuan_bahan"
MIG_PIN="089c20dc9387eb5df55b515c259ff76688f50e3de82958880fe693710a9a1219"
# Hitungan pernyataan migrasi (hasil pemindai) yang diaudit. Selisih = berhenti.
SCAN_EXPECT='add_col=2|alter_lain=0|create_table=1|index=2|fk=1|fungsi=3|trigger=3'
# Diff schema.prisma baseline→kandidat (U0, tanpa baris index dan nomor hunk) yang diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="e3ace92218dd3f8cc5104aebbb46b1113332e288377e7471e5526dc62a05dc4c"
# Objek rilis yang HARUS ada sesudah migrasi (nama persis; dibaca dari migrasi yang dipin).
TBL_BARU="material_unit_transitions"
KOL_BARU="unit_at_entry unit_transition_id"
IDX_BARU="material_unit_transitions_pkey material_unit_transitions_idempotency_key_key material_unit_transitions_material_id_created_at_idx"
CHK_BARU="material_unit_transitions_beda_satuan_chk material_unit_transitions_saldo_baru_chk material_unit_transitions_gerakan_chk"
FK_BARU="material_unit_transitions_material_id_fkey"
TRG_BARU="material_unit_transitions_append_only_trg stock_movements_stamp_unit_trg materials_unit_guard_trg"
FN_BARU="material_unit_transitions_append_only stock_movements_stamp_unit materials_unit_guard"
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
BK_DIR="$HOME/release-backups/transisi-satuan-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

# Cari teks (tetap, bukan regex) di dist: cetak nama berkas PERTAMA yang memuat teks, kosong bila tidak ada. Memakai find|xargs (bukan glob): dist release aktif memuat >21.000 chunk (≈1,94 MB nama berkas) sehingga
# glob "assets/*.js" melampaui ARG_MAX dan grep GAGAL diam-diam (dianggap "tidak ada"). $1 = folder release, $2 = js|css, $3 = teks.
cari_dist() { find "$1/frontend/dist/assets" -maxdepth 1 -type f -name "*.$2" -print0 2>/dev/null | xargs -0 grep -lF -- "$3" 2>/dev/null | sed -n 1p; }
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
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (bila sudah lewat tahap migrasi: struktur aditif terpasang, tabel dokumen KOSONG, tidak berbahaya bagi kode lama).
Rilis ini membawa 1 migrasi ADITIF dan TANPA tulisan data bisnis oleh skripnya: rollback KODE aman kapan pun. Bila rollback setelah switch:
Tujuan rollback = image dan folder release LIVE SEBELUM rilis ini; keduanya MEMUAT kode live lain (gerbang kode live membuktikan kode di container == folder == baseline diset sebelum rilis).
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Web (frontend/dist) tidak diubah oleh rilis ini (dibawa apa adanya) dan dikembalikan bersama folder release sebelumnya. Kode lama: rute transisi-satuan dan riwayat-satuan hilang.
Migrasi (2 kolom nullable + 1 tabel dokumen + 3 fungsi + 3 trigger) DIBIARKAN terpasang: kode lama tidak mengenal kolom/tabel itu dan tetap berjalan; trigger penanda satuan hanya mengisi kolom nullable baru; pagar satuan master hanya menolak
perubahan satuan bahan yang sudah punya pergerakan (kode lama tidak melakukannya). Tidak ada yang perlu dibalik di skema.
Transisi yang SUDAH dijalankan lewat rute rilis ini adalah DATA (pergerakan tutup/buka, satuan master, dokumen append-only, tautan SO): rollback kode TIDAK membalikkannya. Koreksi hanya lewat jalur resmi dengan persetujuan Owner.
Stok, harga, biaya beku, PO/GR, jurnal, PSA, penyesuaian, hasil SO, dan pengaturan Finance tidak disentuh oleh skrip rilis maupun oleh kode ini sampai Owner menjalankan transisi: tidak ada yang perlu dibalik oleh rollback.
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS semua perubahan sesudah backup (transaksi sah pengguna); gunakan hanya atas keputusan Owner.
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
#   - kunci sendiri  : release-transisi-satuan.lock  (fd 9) — satu instansi rilis ini.
#   - kunci bersama  : release-deploy-bersama.lock (fd 7) — mutex deploy bersama; diambil ATOMIK (flock) SEBELUM memeriksa kunci lain, supaya dua proses yang mulai bersamaan tidak sama-sama lolos.
# Berkas pemilik (*.owner, bukan *.lock) hanya untuk diagnosis (pid/waktu/SHA/token); keputusan "milik sendiri" TIDAK bergantung padanya.
LOCK_DIR="${LOCK_DIR:-/tmp}"
KUNCI_SENDIRI="${LOCK_DIR}/release-transisi-satuan.lock"
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
  bash -c 'exec 8>>"$1"; flock -n 8; : > "$2"; exec sleep 25' _ "$T/lock/release-transisi-satuan.lock" "$T/lain.siap" & HP=$!
  tunggu_berkas "$T/lain.siap" || gagal_uji "pemegang kunci bernama sama tidak siap"
  res="$(K 'kunci_ambil' 2>&1)" && gagal_uji "instansi kedua rilis ini LOLOS saat kunci sendiri dipegang proses lain: ${res}"
  printf '%s' "$res" | grep -q 'sudah berjalan' || gagal_uji "penolakan instansi kedua bukan 'sudah berjalan': ${res}"
  res="$(K 'kunci_cek_lain; rc=$?; echo "RC=$rc LAIN=$KUNCI_LAIN"; exit $rc' 2>&1)" && gagal_uji "kunci ber-NAMA sendiri tetapi milik proses lain dilewati hanya karena namanya: ${res}"
  printf '%s' "$res" | grep -q 'LAIN=.*release-transisi-satuan.lock' || gagal_uji "kunci bernama sama tidak dilaporkan: ${res}"
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

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, pin migrasi + diff schema (murni tambahan), pemindai DDL (+ uji negatif pemindai)"
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
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
EXPECT_PRISMA="backend/prisma/migrations/${MIG_NAME}/migration.sql"$'\n'"backend/prisma/schema.prisma"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat migrasi rilis ini (1 migrasi + schema.prisma yang diaudit)"; }
# Migrasi yang sudah ada di baseline TIDAK boleh diubah/dihapus: hanya penambahan.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
[ "$(sg diff -U0 --no-color "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | grep -v '^index ' | sed -E 's/^@@ [^@]*@@.*$/@@/' | { cat; echo; } | sha256sum | cut -d' ' -f1)" = "$SCHEMA_DIFF_SHA" ] || die "diff schema.prisma BERBEDA dari yang diaudit — audit ulang lalu perbarui pin"
ok "schema.prisma: diff identik dengan yang diaudit (aditif: 2 kolom nullable di StockMovement + model MaterialUnitTransition + relasi balik)"
[[ "$MIG_NAME" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $MIG_NAME"
ALL_SQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | tr -d '\r')"
h="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
[ "$MIG_PIN" = "$h" ] || die "isi migrasi ${MIG_NAME} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
ok "migrasi ${MIG_NAME}: sha256 cocok pin (${h:0:12})"
# Pemindai migrasi: tanpa pernyataan terlarang (DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/REVOKE/EXTENSION/RENAME/CASCADE-hapus) + hitungan pernyataan sama dengan yang diaudit. Komentar dibuang lebih dulu.
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
pindai_migrasi() {
  local t terlarang
  t="$(sql_bersih)"
  terlarang="$(printf '%s\n' "$t" | grep -E 'DROP |DELETE FROM|UPDATE "|INSERT INTO|TRUNCATE|GRANT |REVOKE |CREATE EXTENSION|ALTER TYPE|RENAME |DISABLE TRIGGER|ON DELETE CASCADE|ON DELETE SET NULL' || true)"
  if [ -n "$terlarang" ]; then echo "TERLARANG"; return 0; fi
  echo "add_col=$(printf '%s\n' "$t" | grep -c '^ALTER TABLE "stock_movements" ADD COLUMN')|alter_lain=$(printf '%s\n' "$t" | grep '^ALTER TABLE' | grep -vc '^ALTER TABLE "stock_movements" ADD COLUMN\|ADD CONSTRAINT')|create_table=$(printf '%s\n' "$t" | grep -c '^CREATE TABLE ')|index=$(printf '%s\n' "$t" | grep -c '^CREATE \(UNIQUE \)\?INDEX')|fk=$(printf '%s\n' "$t" | grep -c 'FOREIGN KEY')|fungsi=$(printf '%s\n' "$t" | grep -c '^CREATE OR REPLACE FUNCTION')|trigger=$(printf '%s\n' "$t" | grep -c '^CREATE TRIGGER')"
}
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | pindai_migrasi)"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan/isi pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (2 kolom nullable di stock_movements, 1 tabel dokumen kosong, 2 indeks, 1 FK RESTRICT, 3 fungsi + 3 trigger); tanpa DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/EXTENSION/RENAME/hapus-CASCADE"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS menghasilkan hasil ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() { local nama="$1" teks="$2" o; o="$(printf '%s\n' "$teks" | pindai_migrasi)"; if [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi; NEG=$((NEG+1)); }
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE units" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "UPDATE stock_movements (backfill)" "$(tambah_stmt 'UPDATE "stock_movements" SET "unit_at_entry" = (SELECT 1);')"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "units";')"
harus_ditolak "INSERT" "$(tambah_stmt "INSERT INTO \"material_unit_transitions\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "stock_movements";')"
harus_ditolak "ADD COLUMN lain pada stock_movements" "$(tambah_stmt 'ALTER TABLE "stock_movements" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada materials" "$(tambah_stmt 'ALTER TABLE "materials" ADD COLUMN "x" TEXT;')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "materials" DROP COLUMN "unit";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "materials" ALTER COLUMN "unit" TYPE TEXT;')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL);')"
harus_ditolak "indeks tambahan" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("status");')"
harus_ditolak "FK CASCADE" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE CASCADE/')"
harus_ditolak "trigger tambahan" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE INSERT ON "units" FOR EACH ROW EXECUTE FUNCTION stock_movements_stamp_unit();')"
harus_ditolak "fungsi tambahan" "$(tambah_stmt 'CREATE OR REPLACE FUNCTION evil() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql;')"
harus_ditolak "DISABLE TRIGGER" "$(tambah_stmt 'ALTER TABLE "stock_movements" DISABLE TRIGGER ALL;')"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "materials" TO PUBLIC;')"
harus_ditolak "RENAME" "$(tambah_stmt 'ALTER TABLE "materials" RENAME COLUMN "unit" TO "u";')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"MaterialUnit\" ADD VALUE IF NOT EXISTS 'LIAR';")"
harus_ditolak "badan fungsi memuat DROP" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION/DROP TABLE units; RAISE EXCEPTION/")"
ok "uji negatif pemindai: ${NEG} mutan (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER lama/FK CASCADE/trigger+fungsi liar/EXTENSION/GRANT/RENAME/enum) SEMUA ditolak"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit"

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

# Struktur objek rilis (2 kolom nullable di stock_movements; 1 tabel dokumen KOSONG; 1 FK RESTRICT; 3 CHECK; 3 indeks; 3 fungsi + 3 trigger) — SATU definisi dipakai production (sebelum switch) dan rehearsal.
# $1 = fungsi pembaca SQL (menerima satu argumen SQL, mencetak hasil -At), $2 = fungsi kegagalan (menerima pesan).
in_list() { local o="" x; for x in $1; do o="${o:+$o,}'$x'"; done; printf '%s' "$o"; }
struktur_baru() {
  local Q="$1" G="$2" n
  [ "$("$Q" "select count(*) from information_schema.columns where table_schema='public' and table_name='stock_movements' and column_name in ($(in_list "$KOL_BARU")) and is_nullable='YES'")" = "2" ] || "$G" "2 kolom nullable (unit_at_entry, unit_transition_id) di stock_movements tidak terpasang"
  [ "$("$Q" "select count(*) from pg_tables where schemaname='public' and tablename in ($(in_list "$TBL_BARU"))")" = "1" ] || "$G" "tabel rilis (material_unit_transitions) tidak terpasang"
  [ "$("$Q" "select count(*) from material_unit_transitions")" = "0" ] || "$G" "tabel rilis TIDAK kosong setelah migrasi (backfill tidak diizinkan)"
  n="$(printf '%s\n' $FK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$FK_BARU")) and contype='f' and confdeltype='r' and convalidated")" = "$n" ] || "$G" "${n} FK ON DELETE RESTRICT tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $CHK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$CHK_BARU")) and contype='c' and convalidated")" = "$n" ] || "$G" "${n} CHECK tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $IDX_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ($(in_list "$IDX_BARU"))")" = "$n" ] || "$G" "${n} indeks tidak terpasang"
  n="$(printf '%s\n' $TRG_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname in ($(in_list "$TRG_BARU")) and not t.tgisinternal and p.proname in ($(in_list "$FN_BARU"))")" = "$n" ] || "$G" "${n} trigger (penanda satuan, pagar satuan master, dokumen append-only) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_trigger t where t.tgname = 'stock_movements_stamp_unit_trg' and t.tgrelid = 'stock_movements'::regclass and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4")" = "1" ] || "$G" "trigger penanda satuan bukan BEFORE INSERT pada stock_movements"
  [ "$("$Q" "select count(*) from pg_trigger t where t.tgname = 'materials_unit_guard_trg' and t.tgrelid = 'materials'::regclass and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16")" = "1" ] || "$G" "pagar satuan master bukan BEFORE UPDATE pada materials"
}
SKEMA_SQL="select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name <> 'material_unit_transitions' and not (table_name = 'stock_movements' and column_name in ('unit_at_entry','unit_transition_id'))"
LQ() { psql_live -At -c "$1"; }
# Keadaan production SAAT INI terhadap migrasi rilis (membaca production). SEGAR = migrasi belum terpasang dan tepat itu satu-satunya yang pending; LANJUT = migrasi SUDAH terpasang dan terbukti (checksum = berkas kandidat, 1 langkah, tabel kosong).
# Selain itu = TOLAK (fail-closed). Dipakai di preflight dan diulang sesaat sebelum migrasi.
keadaan_produksi() {
  local sfx="$1" terpasang ntab nisi=0 raw row pend solo lama
  psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum${sfx}.txt" || { echo "TOLAK: gagal membaca migrasi terpasang"; return 1; }
  sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u > "$BK_DIR/cand-pra.txt"
  sg ls-tree --name-only "$BASE_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u > "$BK_DIR/base-pra.txt"
  solo="$(comm -13 "$BK_DIR/cand-pra.txt" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  [ -z "$solo" ] || { echo "TOLAK: production memiliki migrasi yang TIDAK ada di kandidat: $(printf '%s' "$solo" | tr '\n' ' ')"; return 1; }
  lama="$(grep -vxF "$MIG_NAME" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  [ "$lama" = "$(cat "$BK_DIR/base-pra.txt")" ] || { echo "TOLAK: migrasi terpasang (di luar migrasi rilis) BUKAN tepat himpunan baseline"; return 1; }
  terpasang="$(grep -Fxc "$MIG_NAME" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  ntab="$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename = '${TBL_BARU}'")"
  [[ "$ntab" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan tabel rilis bukan angka"; return 1; }
  pend="$(comm -23 "$BK_DIR/cand-pra.txt" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  if [ "$terpasang" = "0" ] && [ "$ntab" = "0" ]; then
    [ "$pend" = "$MIG_NAME" ] || { echo "TOLAK: migrasi pending bukan tepat migrasi rilis ini ($(printf '%s' "$pend" | tr '\n' ' '))"; return 1; }
    echo SEGAR; return 0
  fi
  if [ "$terpasang" = "1" ] && [ "$ntab" = "1" ]; then
    [ -z "$pend" ] || { echo "TOLAK: masih ada migrasi pending ($(printf '%s' "$pend" | tr '\n' ' '))"; return 1; }
    nisi="$(psql_live -At -c "select count(*) from ${TBL_BARU}")"; [ "$nisi" = "0" ] || { echo "TOLAK: tabel rilis TIDAK kosong (${nisi} baris): transisi sudah dijalankan — rilis ulang tidak berlaku"; return 1; }
    raw="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | sha256sum | cut -d' ' -f1)"
    row="$(psql_live -At -c "select checksum||'|'||applied_steps_count::text||'|'||(finished_at is not null)::text||'|'||(rolled_back_at is null)::text from _prisma_migrations where migration_name='${MIG_NAME}'")"
    [ "$row" = "${raw}|1|true|true" ] || { echo "TOLAK: status/checksum migrasi rilis tidak sesuai berkas kandidat"; return 1; }
    echo LANJUT; return 0
  fi
  echo "TOLAK: keadaan campuran/tidak dikenal (tabel rilis=${ntab}, migrasi rilis terpasang=${terpasang})"; return 1
}
KEADAAN="$(keadaan_produksi "")" || die "${KEADAAN}"
[ "$KEADAAN" = "SEGAR" ] || [ "$KEADAAN" = "LANJUT" ] || die "keadaan production tidak dikenal: ${KEADAAN}"
MIG_SEBELUM="$(grep -c . "$BK_DIR/base-pra.txt")"
ok "keadaan production: ${KEADAAN} (baseline ${MIG_SEBELUM} migrasi terpasang; migrasi rilis ${MIG_NAME} $([ "$KEADAAN" = "SEGAR" ] && echo 'pending' || echo 'sudah terpasang, tabel kosong'))"
SKEMA_PRA="$(psql_live -At -c "$SKEMA_SQL")"; [ -n "$SKEMA_PRA" ] || die "sidik jari skema produksi kosong"
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

say "2b. Rilis backend-saja: tidak ada build web dan tidak ada node_modules frontend yang disalin; gerbang disk memperhitungkan salinan frontend/dist"
NM_KB="$(du -sk "$PREV_DIR/frontend/dist" | cut -f1)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-transisi-satuan-${DEPLOY_SHORT}-${TS}.sql.gz"
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
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal membawa frontend/dist dari release aktif (dist on-disk, BUKAN dari git)"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat; compose identik"

say "4b. Web TIDAK dibangun ulang: frontend/dist DIBAWA APA ADANYA dari release aktif (dist on-disk, bukan dari git)"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ "$NEW_INDEX" = "$PREV_INDEX" ] || die "bundel di release dir (${NEW_INDEX}) != bundel release aktif (${PREV_INDEX})"
cmp -s "$PREV_DIR/frontend/dist/index.html" "$NEW_DIR/frontend/dist/index.html" || die "index.html dist berbeda dari release aktif"
[ "$(find "$PREV_DIR/frontend/dist" -type f | wc -l)" = "$(find "$NEW_DIR/frontend/dist" -type f | wc -l)" ] || die "jumlah berkas dist berbeda dari release aktif"
OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"
ok "dist dibawa apa adanya (${NEW_INDEX}); tidak ada aset lama yang perlu dibawa terpisah"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-tsb-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
[ "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"
ok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR}: memuat hotfix performa (kode container == folder == baseline disetujui, terbukti gerbang kode live)"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_tsb_${TS}"
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
gagal_reh() { reh_drop; die "$1"; }
S_SEBELUM="$(RPSQL "$SKEMA_SQL")"; [ -n "$S_SEBELUM" ] || gagal_reh "sidik jari skema rehearsal kosong"
[ "$S_SEBELUM" = "$SKEMA_PRA" ] || gagal_reh "skema tabel lama pada RESTORE berbeda dari produksi (backup/restore bermasalah)"
RH_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
SM_N0="$(RPSQL "select count(*) from stock_movements")"
if [ "$KEADAAN" = "SEGAR" ]; then
  dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$RH_URL" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; gagal_reh "migrate deploy di DB rehearsal GAGAL"; }
  [ "$(grep -c 'Applying migration' "$BK_DIR/migrate-rehearsal.log")" = "1" ] || { tail -n 12 "$BK_DIR/migrate-rehearsal.log"; gagal_reh "migrate deploy harus menerapkan TEPAT 1 migrasi rilis"; }
else
  dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$RH_URL" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 12 "$BK_DIR/migrate-rehearsal.log"; gagal_reh "migrate deploy (LANJUT) di DB rehearsal GAGAL"; }
  ! grep -q 'Applying migration' "$BK_DIR/migrate-rehearsal.log" || gagal_reh "keadaan LANJUT: migrate deploy MENERAPKAN sesuatu (seharusnya tidak ada yang pending)"
fi
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$RH_URL" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || gagal_reh "migrate status rehearsal (image baru) TIDAK 'up to date'"
struktur_baru RPSQL gagal_reh
[ "$(RPSQL "$SKEMA_SQL")" = "$S_SEBELUM" ] || gagal_reh "migrasi MENGUBAH skema (kolom/tipe/nullable/default) tabel lama"
[ "$(RPSQL "select count(*) from stock_movements")" = "$SM_N0" ] || gagal_reh "migrasi mengubah jumlah pergerakan stok"
[ "$(RPSQL "select count(*) from stock_movements where unit_at_entry is not null")" = "0" ] || gagal_reh "migrasi MENGISI ulang pergerakan lama (unit_at_entry harus NULL untuk semua pergerakan sebelum migrasi)"
ok "image baru: migrasi rilis diterapkan pada DB rehearsal (hasil restore nyata); tabel dokumen kosong; 2 kolom nullable tanpa isi ulang; FK RESTRICT, CHECK, indeks, 3 fungsi + 3 trigger tervalidasi; skema tabel lama IDENTIK; jumlah pergerakan sama"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "rehearsal MENGUBAH isi tabel"; }
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): rute transisi satuan (pratinjau, hash, atomik, riwayat per satuan, harga lama tidak dibawa, pengaman historis, izin, idempotensi) — hanya pada salinan restore, dibuang sesudahnya.
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji transisi satuan terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
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
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const info = (nama, d = "") => console.log(`INFO  ${nama}${d ? " — " + String(d).slice(0, 260) : ""}`);
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "import { createRequire } from \"node:module\";\nimport { pathToFileURL } from \"node:url\";\nimport path from \"node:path\";\nconst require = createRequire(process.cwd() + \"/\");\nconst jwt = require(\"jsonwebtoken\");\nconst { PrismaClient } = require(\"@prisma/client\");\nconst prisma = new PrismaClient();\nconst BASE = process.env.SMOKE_BASE ?? \"http://127.0.0.1:4000\"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)\nconst APP = process.env.APP_DIR ?? \"/app\";\nlet fail = 0; let dilewati = 0;\nconst rec = (n, ok, d = \"\") => { if (!ok) fail++; console.log(`  ${ok ? \"PASS\" : \"FAIL\"}  ${n}${d ? \" — \" + String(d).slice(0, 240) : \"\"}`); };\nconst skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };\n// SMOKE \"TIDAK MENULIS\" transisi satuan: hanya GET, pratinjau (baca-saja), dan POST terapkan yang DITOLAK sebelum menulis (401/403/400/409). Tidak ada satuan yang berubah, tidak ada pergerakan baru.\nconst { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, \"src/constants/permissions.js\")).href);\nconst rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);\nconst bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));\nconst tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: \"10m\" });\nconst hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);\nconst users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: \"asc\" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });\nconst penyetuju = info.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE) && bisa(x.rs, P.INVENTORY_WRITE))?.u;\nconst bukanPenyetuju = info.find((x) => !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u;\nconst http = async (method, url, token, body = null, header = {}) => { const r = await fetch(BASE + url, { method, headers: { ...(token ? { Authorization: \"Bearer \" + token } : {}), ...(body ? { \"Content-Type\": \"application/json\" } : {}), ...header }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; if (/json/.test(r.headers.get(\"content-type\") ?? \"\")) { try { j = await r.json(); } catch { j = null; } } return { status: r.status, json: j }; };\nconst JEJAK = [[\"materials\", \"select count(*)::int n from materials\"], [\"transisi\", \"select count(*)::int n from material_unit_transitions\"], [\"tautan_so\", \"select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so'\"], [\"stock_movements\", \"select count(*)::int n from stock_movements\"],\n  [\"harga_berlaku\", \"select count(*)::int n from material_harga_berlaku\"], [\"jurnal\", \"select count(*)::int n from fin_journal_entries\"], [\"penyesuaian\", \"select count(*)::int n from stock_adjustment_requests\"], [\"goods_receipts\", \"select count(*)::int n from goods_receipts\"], [\"persediaan_awal\", \"select count(*)::int n from fin_inventory_openings\"],\n  [\"satuan_master\", \"select md5(coalesce(string_agg(code || ':' || unit::text, ',' order by code), '')) n from materials\"]];\nconst jejak = async () => { const o = {}; for (const [k, q] of JEJAK) { try { const r = (await prisma.$queryRawUnsafe(q))[0].n; o[k] = typeof r === \"string\" ? r : Number(r); } catch { o[k] = null; } } return o; };\nconst s0 = await jejak(); const BASE_PATH = \"/api/inventory/materials\";\nrec(\"health 200\", (await http(\"GET\", \"/api/health\")).status === 200);\nconst strukturOk = (await hitung(\"select count(*)::int n from information_schema.columns where table_name = 'stock_movements' and column_name in ('unit_at_entry','unit_transition_id')\")) === 2\n  && (await hitung(\"select count(*)::int n from pg_trigger t where t.tgname in ('stock_movements_stamp_unit_trg','materials_unit_guard_trg','material_unit_transitions_append_only_trg') and not t.tgisinternal\")) === 3;\nrec(\"struktur migrasi ada: 2 kolom penanda satuan + 3 trigger (penanda satuan, pagar satuan master, dokumen append-only)\", strukturOk);\nconst r1 = await http(\"POST\", `${BASE_PATH}/transisi-satuan/terapkan`, null, { transisi: [] }, { \"Idempotency-Key\": \"smoke-tsb-0001\" }); rec(\"rute terapkan ada dan dijaga login: tanpa token = 401 (bukan 404)\", r1.status === 401, `${r1.status}`);\nconst r1b = await http(\"POST\", `${BASE_PATH}/transisi-satuan/pratinjau`, null, { transisi: [] }); rec(\"rute pratinjau dijaga login: tanpa token = 401\", r1b.status === 401, `${r1b.status}`);\nif (bukanPenyetuju) { const r2 = await http(\"POST\", `${BASE_PATH}/transisi-satuan/terapkan`, await tokenUntuk(bukanPenyetuju), { transisi: [] }, { \"Idempotency-Key\": \"smoke-tsb-0002\" }); rec(\"akun tanpa inventory:adjustment_approve ditolak 403\", r2.status === 403, `${r2.status}`); } else skip(\"akun bukan penyetuju ditolak\", \"tidak ada akun aktif tanpa inventory:adjustment_approve\");\nconst contoh = (await prisma.$queryRawUnsafe(\"select m.id::text id, m.code, m.unit::text unit from materials m join stock_movements s on s.material_id = m.id where m.active group by m.id, m.code, m.unit order by count(*) desc limit 1\"))[0];\nif (penyetuju && contoh) {\n  const t = await tokenUntuk(penyetuju);\n  const lain = [\"METER\", \"PCS\", \"KG\"].find((u) => u !== contoh.unit);\n  const pr = await http(\"POST\", `${BASE_PATH}/transisi-satuan/pratinjau`, t, { transisi: [{ materialId: contoh.id, satuanBaru: lain, saldoBaru: 1 }] });\n  rec(\"pratinjau (baca-saja) bahan nyata: 200, memuat hash 64 heksadesimal, satuan lama, saldo lama, pergerakan, dan penghalang\", pr.status === 200 && /^[0-9a-f]{64}$/.test(pr.json?.transisi?.[0]?.hash ?? \"\") && pr.json.transisi[0].satuanLama === contoh.unit && typeof pr.json.transisi[0].saldoLama === \"number\" && Array.isArray(pr.json.transisi[0].penghalang), `${pr.status} ${contoh.code} ${contoh.unit}->${lain}`);\n  const base = { transisi: [{ materialId: contoh.id, satuanBaru: lain, saldoBaru: 1, hashPratinjau: \"0\".repeat(64) }], sumber: \"smoke rilis (tidak boleh menulis)\", alasan: \"Smoke rilis: permintaan ini harus ditolak sebelum menulis\", rujukanHash: \"smoke-tidak-menulis-0001\" };\n  const r3 = await http(\"POST\", `${BASE_PATH}/transisi-satuan/terapkan`, t, base); rec(\"penyetuju tanpa Idempotency-Key ditolak 428, tidak menulis\", r3.status === 428, `${r3.status}`);\n  const r4 = await http(\"POST\", `${BASE_PATH}/transisi-satuan/terapkan`, t, { ...base, transisi: [{ ...base.transisi[0], hashPratinjau: \"bukan-hash\" }] }, { \"Idempotency-Key\": \"smoke-tsb-0004\" }); rec(\"hash pratinjau tidak valid ditolak 400\", r4.status === 400, `${r4.status}`);\n  const r5 = await http(\"POST\", `${BASE_PATH}/transisi-satuan/terapkan`, t, base, { \"Idempotency-Key\": \"smoke-tsb-0005\" }); rec(\"hash pratinjau berformat benar tetapi tidak cocok keadaan = 409 PRATINJAU_BERUBAH (atau ditolak penghalang), tidak menulis\", r5.status === 409, `${r5.status} ${r5.json?.code}`);\n  const rw = await http(\"GET\", `${BASE_PATH}/${contoh.id}/riwayat-satuan`, t); rec(\"riwayat satuan (baca): 200 dengan periode per satuan dan pemeriksaan konsistensi\", rw.status === 200 && Array.isArray(rw.json?.periode) && rw.json.konsisten === true && rw.json.satuanSekarang === contoh.unit, `${rw.status} konsisten=${rw.json?.konsisten}`);\n  const mv = await http(\"GET\", `/api/inventory/movements?materialId=${contoh.id}&limit=5`, t); rec(\"daftar pergerakan menyebut satuan saat dicatat (satuanCatat) pada setiap baris\", mv.status === 200 && Array.isArray(mv.json) && mv.json.length > 0 && mv.json.every((x) => typeof x.satuanCatat === \"string\"), `${mv.status}`);\n  const lap = await http(\"GET\", \"/api/inventory/nilai-persediaan\", t); rec(\"laporan Nilai Persediaan tetap 200 dan memuat penanda transisi pada cakupan\", lap.status === 200 && lap.json?.cakupan?.transisiSatuan && Number.isInteger(lap.json.cakupan.transisiSatuan.bahan), `${lap.status}`);\n} else skip(\"pemeriksaan penyetuju\", \"tidak ada akun penyetuju + inventory:write atau tidak ada bahan berpergerakan\");\nconst s1 = await jejak(); rec(\"SMOKE tidak menulis: master, satuan master, dokumen transisi, tautan SO, stok, harga, jurnal, penyesuaian, GR, persediaan awal — sama\", Object.keys(s0).every((k) => s0[k] === s1[k]), JSON.stringify({ s0, s1 }));\nconsole.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);\nawait prisma.$disconnect();\nprocess.exit(fail === 0 ? 0 : 1);\n"; // diganti generator dengan isi smoke-transisi-satuan.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji transisi satuan hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "transisi satuan bahan": kode BARU berjalan sebagai SERVER sungguhan (index.js, port 4103, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production yang SUDAH dimigrasi.
// Bagian A = kode SMOKE yang sama dengan fase 8b (tidak menulis). Bagian B MENULIS — HANYA pada salinan restore (DB rehearsal_*, dibuang sesudahnya, dijaga di atas): transisi pada DATA NYATA (bahan, saldo, riwayat, catatan,
// PO/GR/harga asli): atomik, hash pratinjau, pengaman historis, riwayat per satuan, harga lama tidak dibawa, tanpa ISSUE/jurnal/valuasi/posting.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4103); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const infoU = []; for (const u of semua) infoU.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const penyetuju = infoU.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE) && bisa(x.rs, P.INVENTORY_WRITE))?.u ?? await prisma.user.create({ data: { name: "REH Penyetuju", email: `reh-tsb-a-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
const bukan = infoU.find((x) => !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u ?? await prisma.user.create({ data: { name: "REH Gudang", email: `reh-tsb-g-${stamp}@example.test`, passwordHash: "x", role: "WAREHOUSE" } });
const tA = await token(penyetuju); const tB = await token(bukan);
const TABEL = [["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["valuasi", "select count(*)::int n from fin_stock_movement_valuations"], ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"],
  ["goods_receipts", "select count(*)::int n from goods_receipts"], ["gr_lines", "select count(*)::int n from goods_receipt_lines"], ["po_lines", "select count(*)::int n from fin_purchase_order_lines"], ["persediaan_awal", "select count(*)::int n from fin_inventory_openings"], ["hasil_so", "select count(*)::int n from activity_events where entity_type = 'hasil_so_bahan'"],
  ["pernyataan", "select count(*)::int n from activity_events where event_type = 'SO_HISTORIS_DINYATAKAN'"], ["issue", "select count(*)::int n from stock_movements where type::text = 'ISSUE'"], ["catatan_diposting", "select count(*)::int n from unit_usage_notes where state::text = 'DIPOSTING'"]];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async ([k, q]) => [k, await num(q)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
const j0 = await jejak();

// ── A. SMOKE pasca-switch (kode yang sama dengan fase 8b) terhadap server rehearsal ──
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP|INFO)/.test(l)).join("\n"));
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));

// ── B. TRANSISI pada data nyata (salinan restore) ──
const http = async (method, url, tok, body = null, header = {}) => { const r = await fetch(BASE + url, { method, headers: { Authorization: "Bearer " + tok, ...(body ? { "Content-Type": "application/json" } : {}), ...header }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { j = null; } return { status: r.status, json: j }; };
const kodeAda = async (kode) => (await prisma.$queryRawUnsafe("select id::text id, code, unit::text unit from materials where code = $1", kode))[0];
// rencana percontohan: bahan nyata dari keputusan satuan operasional (target = hasil SO final); dipilih hanya yang ADA di salinan restore
const RENCANA = [["LIST-WIBING-PUTIH", "METER", 180], ["LIST-WIBING-ABU", "METER", 540], ["LIST-WIBING-COKLAT", "METER", 270], ["BUSA-REBONDED-BATU", "SHEET", 22], ["STREPLES-10-13", "ROD", 250], ["BENANG-KATUN-PUTIH", "PCS", 5], ["PE-ENCASEMENT-200X18X4CM", "PCS", 1]];
const ada = []; for (const [kode, baru, saldo] of RENCANA) { const m = await kodeAda(kode); if (m && m.unit !== baru) ada.push({ ...m, baru, saldo }); }
if (!ada.length) { info("uji nyata dilewati", "tidak ada bahan rencana yang masih perlu transisi di salinan restore"); } else {
  const awal = Object.fromEntries(await Promise.all(ada.map(async (m) => [m.code, { unit: m.unit, gerak: await num("select count(*)::int n from stock_movements where material_id = $1::uuid", m.id), saldo: Number((await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", m.id))[0].n), harga: await num("select count(*)::int n from material_harga_berlaku where material_id = $1::uuid", m.id), catatan: await num("select count(*)::int n from unit_usage_notes where material_id = $1::uuid and origin::text = 'EXCEL' and state::text in ('SIAP_POSTING','PERLU_DICEK')", m.id) }])));
  const lama = Object.fromEntries(await Promise.all(ada.map(async (m) => [m.code, JSON.stringify(await prisma.$queryRawUnsafe("select id::text, type::text, qty::float, created_at::text from stock_movements where material_id = $1::uuid order by created_at, id", m.id))])));
  const tt0 = await num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN'");
  const mintaBody = ada.map((m) => ({ materialId: m.id, satuanBaru: m.baru, saldoBaru: m.saldo, kewajibanTerbuka: m.code === "LIST-WIBING-PUTIH" ? [{ rujukan: "GR-051126-02", jumlah: 10, satuan: "ROLL", keterangan: "penerimaan satuan lama belum diterjemahkan" }] : m.code === "BENANG-KATUN-PUTIH" ? [{ rujukan: "GR-051126-02", jumlah: 4, satuan: "PACK", keterangan: "penerimaan satuan lama belum diterjemahkan" }] : [] }));
  const pr = await http("POST", "/api/inventory/materials/transisi-satuan/pratinjau", tA, { transisi: mintaBody });
  cek("pratinjau data nyata: 200, memuat hash untuk setiap bahan, tanpa menulis", pr.status === 200 && pr.json?.transisi?.length === ada.length && (await jejak()) && sama(await jejak(), j0), `${pr.status} bahan=${ada.length} boleh=${pr.json?.bolehDiterapkan}`);
  for (const t of pr.json?.transisi ?? []) info(`pratinjau ${t.kode}: ${t.satuanLama}→${t.satuanBaru} saldo lama ${t.saldoLama}; gerak ${t.pergerakan.jumlah}; catatan EXCEL ${t.catatanHistoris.excelBelumDiposting} (tautan ${t.catatanHistoris.tautanSOAktif}); penghalang ${t.penghalang.map((p) => p.kode).join(",") || "-"}`);
  const dasar = { sumber: "Uji rehearsal (salinan restore): hasil SO final", alasan: "Uji rehearsal transisi satuan pada data nyata salinan restore", rujukanHash: "rehearsal-transisi-satuan-0001", tautan: { soTanggal: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10), sumber: "Uji rehearsal (salinan restore)", alasan: "Tautan SO dipasang bersama transisi satuan (rehearsal)", rujukanHash: "rehearsal-transisi-satuan-0001" } };
  const body = (hashes) => ({ ...dasar, transisi: mintaBody.map((m, i) => ({ ...m, hashPratinjau: hashes[i] })) });
  const hashes = (pr.json?.transisi ?? []).map((t) => t.hash);
  const k1 = `reh-tsb-${stamp}-0001`;
  const buruk = hashes.map((h, i) => (i === hashes.length - 1 ? "f".repeat(64) : h));
  const g1 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tA, body(buruk), { "Idempotency-Key": `reh-tsb-${stamp}-0000` });
  cek("satu hash tidak cocok membatalkan SELURUH batch: 409, tidak ada satuan berubah, tidak ada dokumen/tautan baru", g1.status === 409 && (await num("select count(*)::int n from material_unit_transitions")) === 0 && (await num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN'")) === tt0 && (await Promise.all(ada.map(async (m) => (await kodeAda(m.code)).unit === m.unit))).every(Boolean), `${g1.status} ${g1.json?.code}`);
  const g2 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tB, body(hashes), { "Idempotency-Key": k1 }); cek("bukan penyetuju: 403, tidak menulis", g2.status === 403 && (await num("select count(*)::int n from material_unit_transitions")) === 0, `${g2.status}`);
  const t1 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tA, body(hashes), { "Idempotency-Key": k1 });
  cek("terapkan batch data nyata: 201, semua bahan bertransisi dalam satu transaksi", t1.status === 201 && t1.json?.transisi?.length === ada.length, `${t1.status} ${JSON.stringify(t1.json).slice(0, 160)}`);
  if (t1.status === 201) {
    for (const m of ada) {
      const a0 = awal[m.code]; const sk = await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float n from stock_movements where material_id = $1::uuid", m.id); const u = (await kodeAda(m.code)).unit;
      cek(`${m.code}: satuan ${m.unit}→${m.baru}; SUM ledger = hasil SO ${m.saldo} (tidak pernah saldo lama berlabel satuan baru)`, u === m.baru && Math.abs(Number(sk[0].n) - m.saldo) < 1e-6, `${u} ${sk[0].n}`);
      const sekarang = JSON.parse(lama[m.code]); const kini = await prisma.$queryRawUnsafe("select id::text, type::text, qty::float, created_at::text from stock_movements where material_id = $1::uuid order by created_at, id", m.id);
      const kiniMap = new Map(kini.map((x) => [x.id, x])); const utuh = sekarang.every((x) => { const y = kiniMap.get(x.id); return y && y.qty === x.qty && y.type === x.type && y.created_at === x.created_at; });
      cek(`${m.code}: ${a0.gerak} pergerakan lama utuh (id, jenis, qty, waktu); tepat ${kini.length - a0.gerak} pergerakan baru (penutup/pembuka)`, utuh && kini.length - a0.gerak === (Math.abs(a0.saldo) > 1e-9 ? 1 : 0) + (m.saldo !== 0 ? 1 : 0), `${kini.length - a0.gerak}`);
      const rs = await http("GET", `/api/inventory/materials/${m.id}/riwayat-satuan`, tA); const lamaP = rs.json?.periode?.find((p) => p.satuan === m.unit);
      cek(`${m.code}: riwayat satuan membedakan periode ${m.unit} (saldo ditutup 0) dan ${m.baru} (${m.saldo}); konsisten`, rs.status === 200 && rs.json.konsisten === true && rs.json.satuanSekarang === m.baru && (!lamaP || Math.abs(lamaP.saldo) < 1e-6) && Math.abs((rs.json.periode.find((p) => p.satuan === m.baru)?.saldo ?? 0) - m.saldo) < 1e-6, `${rs.status}`);
      if (a0.catatan > 0) cek(`${m.code}: ${a0.catatan} catatan historis EXCEL bertaut SO sebelum satuan baru terlihat`, (await num("select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN' and entity_id = $1", m.id)) === 1);
    }
    const d1 = await prisma.$queryRawUnsafe("select count(*)::int n from material_unit_transitions"); cek("tepat satu dokumen transisi per bahan", Number(d1[0].n) === ada.length);
    const t2 = await http("POST", "/api/inventory/materials/transisi-satuan/terapkan", tA, body(hashes), { "Idempotency-Key": k1 }); cek("ulang kunci+isi sama: 200 ulang, tidak ada dokumen/pergerakan baru", t2.status === 200 && t2.json?.ulang === true && (await num("select count(*)::int n from material_unit_transitions")) === ada.length, `${t2.status}`);
    const { evaluasiUlang } = await imp("src/services/catatanPemakaianHistoris.js"); const { daftarPengaman } = await imp("src/services/pengamanHistorisPascaSO.js"); const { rencanakanPosting } = await imp("src/services/postingPemakaianHistoris.js");
    await evaluasiUlang(prisma, {}); const dp = await daftarPengaman(prisma); const idList = ada.map((m) => m.id);
    const sisaTak = await num("select count(*)::int n from unit_usage_notes where material_id::text = any($1::text[]) and origin::text = 'EXCEL' and state::text in ('SIAP_POSTING','PERLU_DICEK')", idList);
    const tertahan = dp.baris.filter((b) => idList.includes(b.materialId)).length;
    cek("sesudah evaluasi otomatis (flag 'satuan beda master' hilang): SEMUA catatan EXCEL bahan bertransisi TERTAHAN_PASCA_SO", tertahan === sisaTak && dp.baris.filter((b) => idList.includes(b.materialId)).every((b) => b.keadaan === "TERTAHAN_PASCA_SO"), `${tertahan} dari ${sisaTak}`);
    const rp = await rencanakanPosting(prisma); cek("rencana posting historis tidak memuat bahan bertransisi", !rp.transaksi.some((x) => ada.some((m) => m.code === x.kodeBahan)), `${rp.transaksi.length} transaksi`);
    const lap = await http("GET", "/api/inventory/nilai-persediaan", tA); const barisLap = lap.json?.baris ?? [];
    cek("laporan: harga bersatuan lama TIDAK dipakai (bahan bertransisi tidak berstatus DINILAI); yang berkewajiban terbuka bertanda cakupan parsial", ada.every((m) => { const b = barisLap.find((x) => x.kode === m.code); return b && b.status !== "DINILAI"; }) && (lap.json?.cakupan?.transisiSatuan?.parsial ?? 0) >= 1, `${lap.status}`);
    const j2 = await jejak(); cek("transisi dan evaluasi TIDAK membuat ISSUE, jurnal, valuasi, harga, PO/GR, penyesuaian, hasil SO, deklarasi, atau posting historis", sama(j0, j2), JSON.stringify({ j0, j2 }));
  }
}
const j3 = await jejak(); cek("seluruh uji: tabel bisnis tidak berubah selain pergerakan penutup/pembuka, dokumen transisi, tautan SO, dan pemetaan/evaluasi catatan pada salinan restore", sama(j0, j3), JSON.stringify({ j0, j3 }));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
# direktori sementara dibuat root oleh kontainer: dihapus lewat kontainer (rm biasa ditolak); kegagalan pembersihan tidak menggagalkan rilis
dcp "$NEW_DIR" run --rm --no-deps -T -v "$BK_DIR:/bk" backend sh -c 'rm -rf /bk/reh-data /bk/reh-uploads /bk/reh-dd' </dev/null >/dev/null 2>&1 || true
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi; uji tulis transisi satuan dilakukan HANYA pada salinan restore (DB rehearsal_*, dibuang); production hanya dibaca lalu DB sementara dihapus"
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

PHASE="6-migrate"; say "6. Migrasi aditif (image baru; backend lama tetap melayani) — keadaan ${KEADAAN}"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum migrasi"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum migrasi"
gerbang_kode_live "fase-6-pra-migrasi"
tidak_ada_deploy_lain_lagi
KEADAAN2="$(keadaan_produksi "2")" || die "${KEADAAN2}"
[ "$KEADAAN2" = "$KEADAAN" ] || die "keadaan production berubah sejak preflight (${KEADAAN} → ${KEADAAN2})"
cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sebelum2.txt" || die "daftar migrasi terpasang berubah selama persiapan (sesi lain menerapkan migrasi) — berhenti, ulangi preflight"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema tabel lama produksi berubah sejak preflight"
SM_NULL0="$(psql_live -At -c "select count(*) from stock_movements")"
if [ "$KEADAAN" = "SEGAR" ]; then
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
else
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | tee "$BK_DIR/migrate-status-lanjut.log" | grep -i 'up to date' >/dev/null || die "keadaan LANJUT: migrate status production tidak 'up to date'"
fi
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang != baseline + 1 ($(( MIG_SEBELUM + 1 )))"
psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${MIG_NAME}'" | grep -Fx t >/dev/null || die "${MIG_NAME} tidak tercatat selesai"
struktur_baru LQ die
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema tabel lama BERUBAH oleh migrasi (jangan switch)"
[ "$(psql_live -At -c "select count(*) from stock_movements where unit_at_entry is null")" -ge "$SM_NULL0" ] || die "pergerakan lama terisi ulang oleh migrasi (seharusnya tetap NULL)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah tahap migrasi"
ok "migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); tabel dokumen kosong, struktur lengkap tervalidasi; skema tabel lama identik; pergerakan lama tidak terisi ulang; backend lama tetap sehat (trigger penanda satuan aktif untuk penulisan oleh kode lama)"
COUNT_SQL="select 'stock_movements', count(*) from stock_movements union all select 'biaya_beku', count(*) from stock_movement_biaya_operasional union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'jurnal', count(*) from fin_journal_entries union all select 'penyesuaian', count(*) from stock_adjustment_requests union all select 'goods_receipts', count(*) from goods_receipts union all select 'persediaan_awal', count(*) from fin_inventory_openings union all select 'pengaturan_finance', count(*) from fin_settings union all select 'hasil_so', count(*) from activity_events where entity_type = 'hasil_so_bahan' union all select 'materials', count(*) from materials union all select 'tautan_so', count(*) from activity_events where entity_type = 'pernyataan_historis_so' and event_type = 'SO_DITAUTKAN' union all select 'transisi_satuan', count(*) from material_unit_transitions union all select 'gerak_bersatuan', count(*) from stock_movements where unit_at_entry is not null"
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pra-switch.txt" || die "hitung baris pra-switch gagal"; ok "pra-switch: hitung baris stok/biaya beku/harga/penyesuaian/GR/persediaan awal/pengaturan Finance/hasil SO/jurnal/master/tautan SO/transisi satuan/pergerakan bersatuan dicatat"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan di produksi; JANGAN switch"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi (image baru) TIDAK 'up to date' setelah tahap migrasi"
ok "tidak ada migrasi pending; skema produksi sudah sesuai image baru (struktur transisi satuan terpasang)"
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
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
struktur_baru PSQLN die
ok "objek rilis terpasang di production: 2 kolom nullable, 1 tabel dokumen (KOSONG), 1 FK RESTRICT, 3 CHECK, 3 indeks, 3 fungsi + 3 trigger tervalidasi; tidak ada transisi dijalankan oleh rilis"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
# hitung baris pasca-switch vs pra-switch (informasi: pengguna sungguhan bisa menulis selama jendela rilis; skrip ini sendiri tidak menulis apa pun)
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pasca-switch.txt" || die "hitung baris pasca-switch gagal"
if diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" >/dev/null; then ok "hitung baris stok/biaya beku/harga/penyesuaian/GR/persediaan awal/pengaturan Finance/hasil SO/jurnal/master/tautan SO/transisi satuan/pergerakan bersatuan IDENTIK sebelum vs sesudah switch"; else warn "hitung baris berbeda sebelum vs sesudah switch (kemungkinan aktivitas pengguna sungguhan selama jendela rilis; skrip tidak menulis):"; diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" | sed 's/^/        /' || true; fi
PHASE="8b-smoke"; say "8b. Smoke: rute transisi satuan ada dan dijaga (401/403/400/428 sebelum menulis), riwayat satuan terbaca, TANPA menjalankan transisi dan TANPA perubahan jumlah baris"
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
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE "TIDAK MENULIS" transisi satuan: hanya GET, pratinjau (baca-saja), dan POST terapkan yang DITOLAK sebelum menulis (401/403/400/409). Tidak ada satuan yang berubah, tidak ada pergerakan baru.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const penyetuju = info.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE) && bisa(x.rs, P.INVENTORY_WRITE))?.u;
const bukanPenyetuju = info.find((x) => !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u;
const http = async (method, url, token, body = null, header = {}) => { const r = await fetch(BASE + url, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...header }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; if (/json/.test(r.headers.get("content-type") ?? "")) { try { j = await r.json(); } catch { j = null; } } return { status: r.status, json: j }; };
const JEJAK = [["materials", "select count(*)::int n from materials"], ["transisi", "select count(*)::int n from material_unit_transitions"], ["tautan_so", "select count(*)::int n from activity_events where entity_type = 'pernyataan_historis_so'"], ["stock_movements", "select count(*)::int n from stock_movements"],
  ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"], ["goods_receipts", "select count(*)::int n from goods_receipts"], ["persediaan_awal", "select count(*)::int n from fin_inventory_openings"],
  ["satuan_master", "select md5(coalesce(string_agg(code || ':' || unit::text, ',' order by code), '')) n from materials"]];
const jejak = async () => { const o = {}; for (const [k, q] of JEJAK) { try { const r = (await prisma.$queryRawUnsafe(q))[0].n; o[k] = typeof r === "string" ? r : Number(r); } catch { o[k] = null; } } return o; };
const s0 = await jejak(); const BASE_PATH = "/api/inventory/materials";
rec("health 200", (await http("GET", "/api/health")).status === 200);
const strukturOk = (await hitung("select count(*)::int n from information_schema.columns where table_name = 'stock_movements' and column_name in ('unit_at_entry','unit_transition_id')")) === 2
  && (await hitung("select count(*)::int n from pg_trigger t where t.tgname in ('stock_movements_stamp_unit_trg','materials_unit_guard_trg','material_unit_transitions_append_only_trg') and not t.tgisinternal")) === 3;
rec("struktur migrasi ada: 2 kolom penanda satuan + 3 trigger (penanda satuan, pagar satuan master, dokumen append-only)", strukturOk);
const r1 = await http("POST", `${BASE_PATH}/transisi-satuan/terapkan`, null, { transisi: [] }, { "Idempotency-Key": "smoke-tsb-0001" }); rec("rute terapkan ada dan dijaga login: tanpa token = 401 (bukan 404)", r1.status === 401, `${r1.status}`);
const r1b = await http("POST", `${BASE_PATH}/transisi-satuan/pratinjau`, null, { transisi: [] }); rec("rute pratinjau dijaga login: tanpa token = 401", r1b.status === 401, `${r1b.status}`);
if (bukanPenyetuju) { const r2 = await http("POST", `${BASE_PATH}/transisi-satuan/terapkan`, await tokenUntuk(bukanPenyetuju), { transisi: [] }, { "Idempotency-Key": "smoke-tsb-0002" }); rec("akun tanpa inventory:adjustment_approve ditolak 403", r2.status === 403, `${r2.status}`); } else skip("akun bukan penyetuju ditolak", "tidak ada akun aktif tanpa inventory:adjustment_approve");
const contoh = (await prisma.$queryRawUnsafe("select m.id::text id, m.code, m.unit::text unit from materials m join stock_movements s on s.material_id = m.id where m.active group by m.id, m.code, m.unit order by count(*) desc limit 1"))[0];
if (penyetuju && contoh) {
  const t = await tokenUntuk(penyetuju);
  const lain = ["METER", "PCS", "KG"].find((u) => u !== contoh.unit);
  const pr = await http("POST", `${BASE_PATH}/transisi-satuan/pratinjau`, t, { transisi: [{ materialId: contoh.id, satuanBaru: lain, saldoBaru: 1 }] });
  rec("pratinjau (baca-saja) bahan nyata: 200, memuat hash 64 heksadesimal, satuan lama, saldo lama, pergerakan, dan penghalang", pr.status === 200 && /^[0-9a-f]{64}$/.test(pr.json?.transisi?.[0]?.hash ?? "") && pr.json.transisi[0].satuanLama === contoh.unit && typeof pr.json.transisi[0].saldoLama === "number" && Array.isArray(pr.json.transisi[0].penghalang), `${pr.status} ${contoh.code} ${contoh.unit}->${lain}`);
  const base = { transisi: [{ materialId: contoh.id, satuanBaru: lain, saldoBaru: 1, hashPratinjau: "0".repeat(64) }], sumber: "smoke rilis (tidak boleh menulis)", alasan: "Smoke rilis: permintaan ini harus ditolak sebelum menulis", rujukanHash: "smoke-tidak-menulis-0001" };
  const r3 = await http("POST", `${BASE_PATH}/transisi-satuan/terapkan`, t, base); rec("penyetuju tanpa Idempotency-Key ditolak 428, tidak menulis", r3.status === 428, `${r3.status}`);
  const r4 = await http("POST", `${BASE_PATH}/transisi-satuan/terapkan`, t, { ...base, transisi: [{ ...base.transisi[0], hashPratinjau: "bukan-hash" }] }, { "Idempotency-Key": "smoke-tsb-0004" }); rec("hash pratinjau tidak valid ditolak 400", r4.status === 400, `${r4.status}`);
  const r5 = await http("POST", `${BASE_PATH}/transisi-satuan/terapkan`, t, base, { "Idempotency-Key": "smoke-tsb-0005" }); rec("hash pratinjau berformat benar tetapi tidak cocok keadaan = 409 PRATINJAU_BERUBAH (atau ditolak penghalang), tidak menulis", r5.status === 409, `${r5.status} ${r5.json?.code}`);
  const rw = await http("GET", `${BASE_PATH}/${contoh.id}/riwayat-satuan`, t); rec("riwayat satuan (baca): 200 dengan periode per satuan dan pemeriksaan konsistensi", rw.status === 200 && Array.isArray(rw.json?.periode) && rw.json.konsisten === true && rw.json.satuanSekarang === contoh.unit, `${rw.status} konsisten=${rw.json?.konsisten}`);
  const mv = await http("GET", `/api/inventory/movements?materialId=${contoh.id}&limit=5`, t); rec("daftar pergerakan menyebut satuan saat dicatat (satuanCatat) pada setiap baris", mv.status === 200 && Array.isArray(mv.json) && mv.json.length > 0 && mv.json.every((x) => typeof x.satuanCatat === "string"), `${mv.status}`);
  const lap = await http("GET", "/api/inventory/nilai-persediaan", t); rec("laporan Nilai Persediaan tetap 200 dan memuat penanda transisi pada cakupan", lap.status === 200 && lap.json?.cakupan?.transisiSatuan && Number.isInteger(lap.json.cakupan.transisiSatuan.bahan), `${lap.status}`);
} else skip("pemeriksaan penyetuju", "tidak ada akun penyetuju + inventory:write atau tidak ada bahan berpergerakan");
const s1 = await jejak(); rec("SMOKE tidak menulis: master, satuan master, dokumen transisi, tautan SO, stok, harga, jurnal, penyesuaian, GR, persediaan awal — sama", Object.keys(s0).every((k) => s0[k] === s1[k]), JSON.stringify({ s0, s1 }));
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else
  ok "smoke test lulus (transisi satuan: rute dijaga, tanpa jejak tulis)"
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
say "CATATAN: Rilis ini membawa rute transisi satuan bahan (pratinjau + terapkan, penyetuju) dan riwayat satuan, serta 1 migrasi aditif (tabel dokumen KOSONG; pergerakan lama tidak diisi ulang). Skrip rilis TIDAK menjalankan transisi apa pun: satuan bahan, saldo, harga, PO/GR, jurnal, dan tautan SO tidak berubah. Transisi dijalankan sesudah rilis oleh Owner lewat rute itu dengan pratinjau baru dan persetujuan hash terpisah."
