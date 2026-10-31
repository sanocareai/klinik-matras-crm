#!/usr/bin/env bash
# RILIS "FOTO BAHAN" (Gudang → Stok & Lokasi → drawer bahan: unggah/ganti/putar/hapus satu foto per bahan; thumbnail di daftar): WEB + BACKEND + 1 MIGRASI ADITIF (dua kolom NULL pada materials) — RELEASE-DIRECTORY, FAIL-CLOSED.
#   • Fitur: foto diproses di server (isi gambar divalidasi dari header: format, ukuran berkas ≤10 MB, dimensi ≤12000 px, ≤64 megapiksel; WebP ≤1280 px, metadata/GPS dibuang, thumbnail 192 px); disimpan di data/material-photos (volume persisten /app/data);
#     nama berkas acak dan tidak pernah ditimpa (ganti/putar = nama baru, cache tidak menampilkan foto lama); hapus HANYA berkas milik bahan itu; ganti/putar/hapus yang gagal tidak merusak foto lama. Izin = izin ubah bahan (inventory:write); jejak audit per perubahan.
#   • Akses foto: TIDAK ada penyajian statis direktori. GET /api/inventory/foto-bahan/<nama> hanya lewat URL bertanda-tangan berumur pendek (disisipkan pada respons berizin) atau Bearer pemegang izin baca bahan. backend/src/index.js TIDAK berubah.
#   • Rilis ini TIDAK menulis foto/contoh apa pun di production, TIDAK mengubah bahan, stok, harga, valuasi, jurnal, atau izin; migrasi TANPA backfill (semua bahan tetap tanpa foto sampai pengguna mengunggah).
#   • Migrasi: ALTER TABLE materials ADD COLUMN ×2 (nullable, tanpa default) tetap membutuhkan kunci ACCESS EXCLUSIVE singkat pada materials → berkas migrasi memasang lock_timeout 5 s dan statement_timeout 30 s: bila database sibuk migrasi BERHENTI (gagal bersih, tanpa kolom), tidak antre.
#     Pin sha256 migrasi + diff schema.prisma + pemindai DDL daftar-putih (uji negatif) di preflight; rehearsal menguji batas tunggu kunci pada salinan restore dan pemulihan resmi (migrate resolve --rolled-back).
#   • Gate: preflight (baca-saja); backup + RESTORE rehearsal pada salinan NYATA (kode baru sebagai SERVER terhadap salinan yang sudah bermigrasi: unggah/putar/ganti/hapus, akses 401/403/404, validasi, serentak, kegagalan aman, tanpa efek ke stok/harga/jurnal);
#     bukti persistensi file lintas recreate container (direktori data SEMENTARA — direktori data production TIDAK pernah dipasang pada rehearsal) + kontrol negatif tanpa volume; kompatibilitas kode lama (image rollback + migrate deploy + kueri lama di atas skema baru);
#     build web di release dir; migrasi sebelum switch (backend lama tetap melayani); switch SATU kali; verifikasi; smoke baca-saja. TIDAK ada foto/bahan/PO percobaan di production.
#   • PENGUNCIAN + GERBANG IDENTITAS KODE LIVE: sama dengan rilis sebelumnya (kunci deploy bersama, kepemilikan proses; hash isi kode live == baseline di fase 2, fase 6, dan tepat sebelum switch). Pembersihan release lama (fase 9) DINONAKTIFKAN: tidak ada folder release/image rollback/backup/volume yang dihapus.
#   • DISK: gerbang 5 GiB TIDAK diturunkan dan diperiksa di awal, setelah build image, setelah rehearsal, sebelum migrasi, dan sebelum switch; skrip juga menghitung kebutuhan menetap dan puncak dari ukuran nyata (node_modules, dist, database) dan berhenti bila ruang tidak cukup.
#
#   cat scripts/release-foto-bahan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/fb1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/fb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/fb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/fb1r.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA migrasi production dan TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/fb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/fb1.out 2>&1 < /dev/null &'   # rilis penuh (hanya setelah persetujuan deploy)
#
# ROLLBACK: KODE aman di-rollback kapan pun (image + folder release LIVE sebelumnya). Skema TIDAK dibalik: dua kolom NULL tetap (tidak dibaca kode lama; teruji). File foto TETAP di folder persisten (kode lama tidak menyajikannya). Detail di blok rollback skrip.
# (dibangkitkan oleh scripts/gen-release-foto-bahan.cjs dari scripts/release-harga-dari-po.sh + scripts/templates/release-foto-bahan/* + pustaka scripts/lib/{scan-migrasi,rehearsal,smoke,kompat-lama}-foto-bahan.mjs; JANGAN edit tangan — bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/foto-bahan-on-60b5df10}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis web + backend dengan SATU migrasi aditif (dua kolom NULL pada materials); backend/src/index.js dan dependensi TIDAK berubah; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/prisma/migrations/20261231120000_foto_bahan/migration\.sql|backend/prisma/schema\.prisma|backend/scripts/rekonsiliasi-foto-bahan\.mjs|backend/scripts/uji-foto-bahan-persisten\.mjs|backend/src/routes/inventory\.js|backend/src/routes/materialPhotoMedia\.js|backend/src/services/fotoBahan\.js|backend/src/services/stokLokasi\.js|backend/tests/integration/fotoBahan\.integration\.test\.js|backend/tests/integration/fotoBahanKeamanan\.integration\.test\.js|backend/tests/integration/setup/env\.js|frontend/qa-harness/stok-foto-browser\.cjs|frontend/qa-harness/stok-foto-server\.mjs|frontend/src/api\.js|frontend/src/features/warehouse/components/ItemDetailDrawer\.jsx|frontend/src/features/warehouse/stok/DaftarBahan\.jsx|frontend/src/features/warehouse/stok/FotoBahan\.jsx|frontend/src/features/warehouse/stok/IkonBahan\.jsx|frontend/src/features/warehouse/stok/fotoBahanLogic\.js|frontend/tests/fotoBahan\.test\.js|frontend/tests/stokTampilanLogic\.test\.js|scripts/gen-release-foto-bahan\.cjs|scripts/lib/kompat-lama-foto-bahan\.mjs|scripts/lib/rehearsal-foto-bahan\.mjs|scripts/lib/scan-migrasi-foto-bahan\.mjs|scripts/lib/smoke-foto-bahan\.mjs|scripts/release-foto-bahan\.sh|scripts/templates/release-foto-bahan/disk\.txt|scripts/templates/release-foto-bahan/gate-prisma\.txt|scripts/templates/release-foto-bahan/header\.txt|scripts/templates/release-foto-bahan/keadaan\.txt|scripts/templates/release-foto-bahan/rehearsal-migrasi\.txt|scripts/templates/release-foto-bahan/rehearsal-pasca\.txt|scripts/templates/release-foto-bahan/rollback\.txt|scripts/templates/release-foto-bahan/step6\.txt|scripts/templates/release-foto-bahan/struktur\.txt|scripts/templates/release-foto-bahan/vars\.txt)$'
BACKEND_SRC_EXPECT="backend/src/routes/inventory.js backend/src/routes/materialPhotoMedia.js backend/src/services/fotoBahan.js backend/src/services/stokLokasi.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/warehouse/components/ItemDetailDrawer.jsx frontend/src/features/warehouse/stok/DaftarBahan.jsx frontend/src/features/warehouse/stok/FotoBahan.jsx frontend/src/features/warehouse/stok/IkonBahan.jsx frontend/src/features/warehouse/stok/fotoBahanLogic.js"
# Migrasi aditif yang SUDAH diaudit (nama + sha256 isi, LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIG_NAME="20261231120000_foto_bahan"
MIG_PIN="74585ce36c906a27f02b213fe3aa44ccbf11635f8ee27d997cc774f43ced83a4"
# Hasil pemindai DDL untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"set_local_lock_timeout":1,"set_local_statement_timeout":1,"add_column":2}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index dan tanpa nomor baris hunk) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="9b8c650377004f521d38da40aa2e399a5f9240e95587cca3c22a124da097e49a"
# Kolom yang HARUS ada di database sesudah migrasi (nama persis; dibaca dari migrasi yang dipin).
KOL_BARU="photo_file photo_updated_at"
# Gerbang disk: minimal 5 GiB bebas (TIDAK diturunkan). Diperiksa berkali-kali; lolos di awal saja tidak cukup.
MIN_FREE_KB=$((5 * 1024 * 1024))
bebas_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
cek_disk() { local b; b="$(bebas_kb)"; [ "$b" -ge "$MIN_FREE_KB" ] || die "disk bebas $(( b / 1024 )) MiB < 5 GiB ($1) — berhenti; pembersihan VPS ditangani sesi lain, skrip ini tidak menghapus apa pun"; ok "disk bebas $(( b / 1024 )) MiB >= 5 GiB ($1)"; }
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
BK_DIR="$HOME/release-backups/foto-bahan-${DEPLOY_SHORT}-${TS}"
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
Berhenti SEBELUM tahap migrasi (fase 6) -> production tidak berubah sama sekali (skema, kode, data).
Berhenti SESUDAH migrasi tetapi SEBELUM 'Switch backend' -> dua kolom foto (NULL) sudah terpasang; backend lama tidak pernah dimatikan dan terus melayani. Kolom itu aditif dan tidak mengganggu kode lama (teruji pada rehearsal); TIDAK perlu dibalik. Jalankan ulang skrip: keadaan LANJUT dikenali dan tervalidasi.
Bila migrasi berhenti karena batas tunggu kunci (lock_timeout 5 detik; database sibuk): migrasi tercatat GAGAL di _prisma_migrations dan TIDAK ada kolom yang terpasang. Pemulihan resmi: (1) pastikan tidak ada sesi yang menahan tabel materials; (2) di folder release baru:
   cd ${NEW_DIR:-<release-baru>} && SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml run --rm --no-deps backend npx prisma migrate resolve --rolled-back ${MIG_NAME}
   lalu jalankan ulang skrip dari awal (preflight menolak selama ada migrasi menggantung).
Rollback KODE setelah switch: tujuan = image dan folder release LIVE SEBELUM rilis ini; keduanya MEMUAT hotfix performa dan fitur live lain (gerbang kode live membuktikan kode di container == folder == baseline diset sebelum rilis):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Web (frontend/dist) dikembalikan bersama folder release sebelumnya. Efek: drawer/daftar kembali tanpa foto; unggah foto tidak tersedia. Container lama saat start menjalankan migrate deploy: tidak ada migrasi baru -> lolos (teruji pada rehearsal dengan image rollback).
KOMPATIBILITAS SKEMA: kolom photo_file dan photo_updated_at TETAP (nullable, tanpa default, tidak dibaca/ditulis kode lama). TIDAK ada migrasi mundur; tidak perlu. Memasang ulang kode baru kapan saja memakai kolom yang sama.
NASIB FILE FOTO setelah rollback: berkas TETAP di ${PERSIST}/backend/data/material-photos (volume persisten). Kode lama tidak menyajikan, tidak membaca, dan tidak menghapusnya (tidak ada penyajian statis direktori), jadi tidak terlihat siapa pun. Baris database tetap menunjuk berkas itu: begitu kode baru dipasang lagi, foto tampil kembali. JANGAN menghapus folder itu.
BACKUP & PEMULIHAN FILE bersama database: backup harian (ops/backup-database.sh) dan backup pra-rilis skrip ini hanya memuat DUMP DATABASE — berkas foto TIDAK ikut. Salin folder ${PERSIST}/backend/data/material-photos secara berkala (mis. tar atau rclone ke Drive yang sama) agar foto dapat dipulihkan bersama database. Setelah pemulihan database dari dump, jalankan
   docker compose -p ${PROJECT} exec backend node scripts/rekonsiliasi-foto-bahan.mjs   (BACA-SAJA)
 yang melaporkan baris tanpa berkas (bahan menunjuk foto yang tidak ada -> aplikasi menampilkan ikon/petunjuk, cukup unggah ulang), berkas yatim (tidak dirujuk baris mana pun -> tidak disajikan siapa pun; aman dibiarkan atau dihapus manual), dan nama tidak valid. Dump dari SEBELUM rilis ini tidak memuat kolom foto: memulihkan dump itu = foto lama jadi yatim (tidak rusak).
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS semua perubahan sesudah backup (termasuk rujukan foto yang sudah diunggah); gunakan hanya atas keputusan Owner.
Stok, harga, valuasi Finance, jurnal, unit, pernyataan, jadwal/Run, dan status tidak disentuh oleh rilis ini: tidak ada yang perlu dibalik.
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
#   - kunci sendiri  : release-foto-bahan.lock  (fd 9) — satu instansi rilis ini.
#   - kunci bersama  : release-deploy-bersama.lock (fd 7) — mutex deploy bersama; diambil ATOMIK (flock) SEBELUM memeriksa kunci lain, supaya dua proses yang mulai bersamaan tidak sama-sama lolos.
# Berkas pemilik (*.owner, bukan *.lock) hanya untuk diagnosis (pid/waktu/SHA/token); keputusan "milik sendiri" TIDAK bergantung padanya.
LOCK_DIR="${LOCK_DIR:-/tmp}"
KUNCI_SENDIRI="${LOCK_DIR}/release-foto-bahan.lock"
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
  bash -c 'exec 8>>"$1"; flock -n 8; : > "$2"; exec sleep 25' _ "$T/lock/release-foto-bahan.lock" "$T/lain.siap" & HP=$!
  tunggu_berkas "$T/lain.siap" || gagal_uji "pemegang kunci bernama sama tidak siap"
  res="$(K 'kunci_ambil' 2>&1)" && gagal_uji "instansi kedua rilis ini LOLOS saat kunci sendiri dipegang proses lain: ${res}"
  printf '%s' "$res" | grep -q 'sudah berjalan' || gagal_uji "penolakan instansi kedua bukan 'sudah berjalan': ${res}"
  res="$(K 'kunci_cek_lain; rc=$?; echo "RC=$rc LAIN=$KUNCI_LAIN"; exit $rc' 2>&1)" && gagal_uji "kunci ber-NAMA sendiri tetapi milik proses lain dilewati hanya karena namanya: ${res}"
  printf '%s' "$res" | grep -q 'LAIN=.*release-foto-bahan.lock' || gagal_uji "kunci bernama sama tidak dilaporkan: ${res}"
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

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, pin migrasi + diff schema, pemindai DDL (+ uji negatif pemindai)"
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
EXPECT_PRISMA="backend/prisma/migrations/${MIG_NAME}/migration.sql"$'\n'"backend/prisma/schema.prisma"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat migrasi rilis ini (1 migrasi + schema.prisma yang diaudit)"; }
# Migrasi yang sudah ada di baseline TIDAK boleh diubah/dihapus (yang sudah diterapkan di produksi): hanya penambahan.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
[ "$(sg diff -U0 --no-color "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | grep -v '^index ' | sed -E 's/^@@ [^@]*@@.*$/@@/' | { cat; echo; } | sha256sum | cut -d' ' -f1)" = "$SCHEMA_DIFF_SHA" ] || die "diff schema.prisma BERBEDA dari yang diaudit (pin SCHEMA_DIFF_SHA) — audit ulang lalu perbarui pin"
ok "schema.prisma: diff identik dengan yang diaudit (aditif: dua kolom nullable pada Material — photoFile, photoUpdatedAt)"
[[ "$MIG_NAME" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $MIG_NAME"
ALL_SQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | tr -d '\r')"
h="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
[ "$MIG_PIN" = "$h" ] || die "isi migrasi ${MIG_NAME} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
ok "migrasi ${MIG_NAME}: sha256 cocok pin (${h:0:12})"
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai DDL migrasi rilis "Foto Bahan". Membaca SQL (komentar/baris kosong sudah dibuang) dari stdin.
// DAFTAR PUTIH SANGAT SEMPIT — tepat empat pernyataan, dalam urutan ini:
//   SET LOCAL lock_timeout = '5s';            batas tunggu kunci: migrasi BERHENTI (gagal bersih) bila tabel sibuk, bukan antre dan memblokir pembacaan "materials"
//   SET LOCAL statement_timeout = '30s';
//   ALTER TABLE "materials" ADD COLUMN "photo_file" VARCHAR(80);            nullable, tanpa DEFAULT
//   ALTER TABLE "materials" ADD COLUMN "photo_updated_at" TIMESTAMP(3);     nullable, tanpa DEFAULT
// Pernyataan lain apa pun (DROP/UPDATE/INSERT/DELETE/TRUNCATE/indeks/FK/trigger/fungsi/EXTENSION/GRANT/DEFAULT/NOT NULL/tabel lain/batas waktu lain) = exit 2.
// Keluaran (exit 0): JSON ringkas jumlah per jenis; skrip rilis membandingkannya dengan hasil yang sudah diaudit (SCAN_EXPECT).
import fs from "node:fs";

const tolak = (m) => { console.error("DITOLAK: " + m); process.exit(2); };
const sql = fs.readFileSync(0, "utf8");
if (sql.includes("$$")) tolak("blok $$ (fungsi) tidak diizinkan");
const stmts = []; let buf = "";
for (const c of sql) { if (c === ";") { if (buf.trim()) stmts.push(buf.trim()); buf = ""; } else buf += c; }
if (buf.trim()) tolak("pernyataan terakhir tanpa titik koma");

const q = (s) => s.replace(/\s+/g, " ").trim();
const DIHARAPKAN = [
  { jenis: "set_local_lock_timeout", re: /^SET LOCAL lock_timeout = '5s'$/ },
  { jenis: "set_local_statement_timeout", re: /^SET LOCAL statement_timeout = '30s'$/ },
  { jenis: "add_column", re: /^ALTER TABLE "materials" ADD COLUMN "photo_file" VARCHAR\(80\)$/ },
  { jenis: "add_column", re: /^ALTER TABLE "materials" ADD COLUMN "photo_updated_at" TIMESTAMP\(3\)$/ },
];
if (stmts.length !== DIHARAPKAN.length) tolak(`jumlah pernyataan ${stmts.length} != ${DIHARAPKAN.length} yang diaudit`);
const n = { set_local_lock_timeout: 0, set_local_statement_timeout: 0, add_column: 0 };
stmts.forEach((raw, i) => {
  const s = q(raw);
  if (!DIHARAPKAN[i].re.test(s)) tolak(`pernyataan #${i + 1} bukan yang diaudit: ${s.slice(0, 120)}`);
  n[DIHARAPKAN[i].jenis]++;
});
console.log(JSON.stringify(n));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (2 SET LOCAL batas waktu: lock_timeout 5s + statement_timeout 30s; 2 ADD COLUMN nullable tanpa default pada materials); tanpa DROP/DELETE/UPDATE/INSERT/RENAME/indeks/FK/trigger/fungsi/GRANT/EXTENSION"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "tanpa lock_timeout" "$(printf '%s\n' "$ALL_SQL" | grep -v 'lock_timeout')"
harus_ditolak "tanpa statement_timeout" "$(printf '%s\n' "$ALL_SQL" | grep -v 'statement_timeout')"
harus_ditolak "lock_timeout 60s" "$(printf '%s\n' "$ALL_SQL" | sed "s/lock_timeout = '5s'/lock_timeout = '60s'/")"
harus_ditolak "lock_timeout 0 (tanpa batas)" "$(printf '%s\n' "$ALL_SQL" | sed "s/lock_timeout = '5s'/lock_timeout = 0/")"
harus_ditolak "SET tanpa LOCAL" "$(printf '%s\n' "$ALL_SQL" | sed 's/SET LOCAL lock_timeout/SET lock_timeout/')"
harus_ditolak "kolom dengan DEFAULT" "$(printf '%s\n' "$ALL_SQL" | sed "s/VARCHAR(80)/VARCHAR(80) DEFAULT ''/")"
harus_ditolak "kolom NOT NULL" "$(printf '%s\n' "$ALL_SQL" | sed 's/VARCHAR(80)/VARCHAR(80) NOT NULL/')"
harus_ditolak "tipe kolom diubah" "$(printf '%s\n' "$ALL_SQL" | sed 's/VARCHAR(80)/TEXT/')"
harus_ditolak "ADD COLUMN pada tabel lain" "$(printf '%s\n' "$ALL_SQL" | sed 's/"materials"/"units"/')"
harus_ditolak "kolom ketiga" "$(tambah_stmt 'ALTER TABLE "materials" ADD COLUMN "x" TEXT;')"
harus_ditolak "UPDATE (backfill)" "$(tambah_stmt "UPDATE \"materials\" SET \"photo_file\" = 'x';")"
harus_ditolak "UPDATE tabel stok" "$(tambah_stmt 'UPDATE "stock_movements" SET "qty" = 0;')"
harus_ditolak "INSERT" "$(tambah_stmt "INSERT INTO \"materials\" (id) VALUES ('x');")"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "materials";')"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "materials";')"
harus_ditolak "DROP TABLE" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "materials" DROP COLUMN "name";')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "materials" RENAME COLUMN "name" TO "n";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "materials" ALTER COLUMN "name" TYPE TEXT;')"
harus_ditolak "CREATE INDEX" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "materials"("photo_file");')"
harus_ditolak "FOREIGN KEY" "$(tambah_stmt 'ALTER TABLE "materials" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("photo_file") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;')"
harus_ditolak "trigger" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE UPDATE ON "materials" FOR EACH ROW EXECUTE FUNCTION evil_fn();')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "materials" TO PUBLIC;')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"UnitStatus\" ADD VALUE IF NOT EXISTS 'LIAR';")"
harus_ditolak "urutan pernyataan dibalik" "$(printf '%s\n' "$ALL_SQL" | sql_bersih | tac)"
harus_ditolak "pernyataan terakhir tanpa titik koma" "$(printf '%s' "$ALL_SQL" | sed '$ s/;$//')"
ok "uji negatif pemindai: ${NEG} mutan (batas waktu dilonggarkan/dibuang, DEFAULT/NOT NULL, kolom/tabel lain, DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER lama, indeks/FK/trigger/fungsi liar, EXTENSION, GRANT) SEMUA ditolak"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit; migrasi + schema.prisma sesuai audit"

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
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung (gagal/terhenti, mis. batas tunggu kunci): selesaikan lebih dulu dengan prisma migrate resolve (lihat instruksi rollback) — berhenti"
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

# Struktur objek rilis (2 kolom NULL pada materials, tanpa default; tanpa indeks/constraint/trigger baru) — SATU definisi dipakai production (sebelum switch), rehearsal, dan sesudah switch.
# $1 = fungsi pembaca SQL (menerima satu argumen SQL, mencetak hasil -At), $2 = fungsi kegagalan (menerima pesan), $3 = "1" bila kolom foto HARUS kosong semua (sebelum switch / rehearsal), "0" sesudah switch (pengguna boleh sudah mengunggah).
in_list() { local o="" x; for x in $1; do o="${o:+$o,}'$x'"; done; printf '%s' "$o"; }
struktur_baru() {
  local Q="$1" G="$2" K="${3:-1}" r
  r="$("$Q" "select string_agg(column_name||':'||data_type||':'||coalesce(character_maximum_length::text,'-')||':'||coalesce(datetime_precision::text,'-')||':'||is_nullable||':'||coalesce(column_default,'-'), ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='materials' and column_name in ($(in_list "$KOL_BARU"))")"
  [ "$r" = "photo_file:character varying:80:-:YES:-,photo_updated_at:timestamp without time zone:-:3:YES:-" ] || "$G" "kolom foto tidak sesuai migrasi yang diaudit: ${r}"
  [ "$("$Q" "select count(*) from materials where photo_file is not null and (photo_file !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{12}[.]webp$' or photo_file not like id::text || '-%')")" = "0" ] || "$G" "ada nilai photo_file yang bukan nama berkas sah milik bahannya"
  if [ "$K" = "1" ]; then [ "$("$Q" "select count(*) from materials where photo_file is not null or photo_updated_at is not null")" = "0" ] || "$G" "kolom foto TIDAK kosong (backfill tidak diizinkan; unggahan baru hanya setelah switch)"; fi
}
# Sidik jari skema LAMA: kolom semua tabel (tanpa dua kolom rilis), SEMUA constraint, SEMUA indeks, SEMUA trigger non-internal. Identik sebelum vs sesudah migrasi = migrasi hanya menambah dua kolom.
SKEMA_SQL="select md5(coalesce((select string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, ordinal_position) from information_schema.columns where table_schema='public' and not (table_name='materials' and column_name in ('photo_file','photo_updated_at'))),'') || '|' || coalesce((select string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname) from pg_constraint where connamespace='public'::regnamespace),'') || '|' || coalesce((select string_agg(indexdef, ',' order by indexname) from pg_indexes where schemaname='public'),'') || '|' || coalesce((select string_agg(tgrelid::regclass::text||':'||tgname, ',' order by tgrelid::regclass::text, tgname) from pg_trigger where not tgisinternal),''))"
# Isi bahan TANPA dua kolom rilis (jumlah + md5 seluruh baris): identik sebelum vs sesudah migrasi.
MAT_SQL="select count(*)::text || ':' || coalesce(md5(string_agg((to_jsonb(m) - 'photo_file' - 'photo_updated_at')::text, '|' order by m.id::text)), '-') from materials m"

# Klasifikasi KEADAAN production — murni, FAIL-CLOSED: selain dua keadaan yang dikenal = TOLAK.
#   SEGAR  = kolom foto belum ada dan migrasi rilis belum terpasang; migrasi pending = tepat migrasi rilis.
#   LANJUT = rilis terhenti SESUDAH migrasi: kedua kolom ada dan KOSONG, migrasi rilis selesai (1 langkah, tidak di-rollback, checksum = berkas kandidat), tidak ada pending.
# Argumen: nkol nisi mig_terpasang(0/1) csok(0/1) pending(teks)
tentukan_keadaan() {
  local nkol="$1" nisi="$2" terpasang="$3" csok="$4" pend="$5"
  if [ "$nkol" = "0" ] && [ "$terpasang" = "0" ]; then
    [ "$pend" = "$MIG_NAME" ] || { echo "TOLAK: migrasi pending bukan tepat migrasi rilis ini ($(printf '%s' "$pend" | tr '\n' ' '))"; return 1; }
    echo SEGAR; return 0
  fi
  if [ "$nkol" = "2" ] && [ "$terpasang" = "1" ]; then
    [ -z "$pend" ] || { echo "TOLAK: masih ada migrasi pending ($(printf '%s' "$pend" | tr '\n' ' '))"; return 1; }
    [ "$csok" = "1" ] || { echo "TOLAK: status/checksum migrasi rilis tidak sesuai berkas kandidat"; return 1; }
    [ "$nisi" = "0" ] || { echo "TOLAK: kolom foto TIDAK kosong (${nisi} bahan berfoto) — rilis ini mungkin sudah live; jangan diulang"; return 1; }
    echo LANJUT; return 0
  fi
  echo "TOLAK: keadaan campuran/tidak dikenal (kolom foto=${nkol}, migrasi rilis terpasang=${terpasang})"; return 1
}
LQ() { psql_live -At -c "$1"; }
# Keadaan production SAAT INI (membaca production; menulis daftar ke $BK_DIR/applied-sebelum${1}.txt). Cetak SEGAR | LANJUT | "TOLAK: ..." (exit 1). Dipakai di preflight dan diulang sesaat sebelum migrasi.
keadaan_produksi() {
  local sfx="$1" nkol nisi=0 terpasang csok=0 raw row pend solo lama
  psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum${sfx}.txt" || { echo "TOLAK: gagal membaca migrasi terpasang"; return 1; }
  sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u > "$BK_DIR/cand-pra.txt"
  sg ls-tree --name-only "$BASE_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u > "$BK_DIR/base-pra.txt"
  solo="$(comm -13 "$BK_DIR/cand-pra.txt" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  [ -z "$solo" ] || { echo "TOLAK: production memiliki migrasi yang TIDAK ada di kandidat: $(printf '%s' "$solo" | tr '\n' ' ')"; return 1; }
  lama="$(grep -vxF "$MIG_NAME" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  [ "$lama" = "$(cat "$BK_DIR/base-pra.txt")" ] || { echo "TOLAK: migrasi terpasang (di luar migrasi rilis) BUKAN tepat himpunan baseline"; return 1; }
  nkol="$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='materials' and column_name in ('photo_file','photo_updated_at')")"
  [[ "$nkol" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan kolom rilis bukan angka"; return 1; }
  if [ "$nkol" = "2" ]; then nisi="$(psql_live -At -c "select count(*) from materials where photo_file is not null or photo_updated_at is not null")"; fi
  [[ "$nisi" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan isi kolom rilis bukan angka"; return 1; }
  terpasang="$(grep -Fxc "$MIG_NAME" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  raw="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | sha256sum | cut -d' ' -f1)"
  row="$(psql_live -At -c "select checksum||'|'||applied_steps_count::text||'|'||(finished_at is not null)::text||'|'||(rolled_back_at is null)::text from _prisma_migrations where migration_name='${MIG_NAME}'")"
  [ "$row" = "${raw}|1|true|true" ] && csok=1
  pend="$(comm -23 "$BK_DIR/cand-pra.txt" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  tentukan_keadaan "$nkol" "$nisi" "$terpasang" "$csok" "$pend"
}
KEADAAN="$(keadaan_produksi "")" || die "${KEADAAN}"
[ "$KEADAAN" = "SEGAR" ] || [ "$KEADAAN" = "LANJUT" ] || die "keadaan production tidak dikenal: ${KEADAAN}"
MIG_SEBELUM="$(grep -c . "$BK_DIR/base-pra.txt")"
ok "keadaan production: ${KEADAAN} (baseline ${MIG_SEBELUM} migrasi terpasang; migrasi rilis ${MIG_NAME} $([ "$KEADAAN" = "SEGAR" ] && echo 'pending' || echo 'sudah terpasang, kolom kosong'))"
SKEMA_PRA="$(psql_live -At -c "$SKEMA_SQL")"; [ -n "$SKEMA_PRA" ] || die "sidik jari skema produksi kosong"
# PERSISTENSI FILE (baca-saja): folder data container LIVE harus berupa bind-mount dari penyimpanan persisten host, dan dapat ditulis proses backend.
mount_data() { docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}}:{{.Source}}:{{.RW}}{{end}}{{end}}' "$1"; }
MOUNT_DATA_LAMA="$(mount_data "$CID_OLD")"
[ "$MOUNT_DATA_LAMA" = "bind:${PERSIST}/backend/data:true" ] || die "folder /app/data container live BUKAN bind-mount ${PERSIST}/backend/data (rw): '${MOUNT_DATA_LAMA}' — foto akan hilang saat container dibuat ulang; berhenti"
docker exec "$CID_OLD" sh -c 'test -w /app/data' </dev/null || die "folder /app/data tidak dapat ditulis proses backend live"
[ "$(stat -c %d "$PERSIST/backend/data")" = "$(stat -c %d "$PERSIST")" ] || warn "folder data persisten berada di perangkat berbeda dari ${PERSIST}"
ok "persistensi file: /app/data container live = bind-mount ${PERSIST}/backend/data (rw, dapat ditulis); folder foto dibuat otomatis saat unggahan pertama; compose rilis baru identik (dibuktikan di fase 4)"
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
DIST_KB="$(du -sk "$PREV_DIR/frontend/dist" | cut -f1)"
PERM_KB=$(( NM_KB + DIST_KB + 60 * 1024 + 256 * 1024 ))                # MENETAP setelah rilis: folder release baru (node_modules + dist + sumber) + image baru (~125 MB: lapisan COPY + prisma generate) + cache build + backup + log
SEMENTARA_KB=$(( DB_BYTES / 1024 * 3 + NM_KB ))                         # hanya selama build/rehearsal: salinan restore DB (data + WAL) dan salinan node_modules saat disalin lalu dibangun
PUNCAK_KB=$(( PERM_KB + SEMENTARA_KB ))
NEED_PASCA_KB=$(( MIN_FREE_KB + PERM_KB ))                              # gerbang 5 GiB di 'sebelum switch' tetap harus terpenuhi SETELAH semua yang menetap terpasang
NEED_PUNCAK_KB=$(( PUNCAK_KB + 1024 * 1024 ))                           # lantai 1 GiB pada titik puncak
NEED_KB=$(( NEED_PASCA_KB > NEED_PUNCAK_KB ? NEED_PASCA_KB : NEED_PUNCAK_KB ))
ok "kebutuhan disk (dari ukuran nyata): menetap $(( PERM_KB / 1024 )) MiB, puncak $(( PUNCAK_KB / 1024 )) MiB; butuh bebas >= $(( NEED_KB / 1024 )) MiB di awal (= max(5 GiB + menetap, puncak + 1 GiB)); bebas sekarang $(( AVAIL_KB / 1024 )) MiB"
cek_disk "awal"
[ "$AVAIL_KB" -ge "$NEED_KB" ] || die "ruang disk kurang: bebas $(( AVAIL_KB / 1024 )) MiB < kebutuhan $(( NEED_KB / 1024 )) MiB (menetap $(( PERM_KB / 1024 )) + gerbang 5 GiB, atau puncak $(( PUNCAK_KB / 1024 )) + 1 GiB) — berhenti; skrip ini TIDAK membersihkan apa pun (pembersihan VPS ditangani sesi lain)"
ok "ruang disk cukup untuk build + backup + image + release + rehearsal dan gerbang 5 GiB tetap terpenuhi sebelum switch"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-foto-bahan-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Foto bahan" "Foto belum bisa dimuat" "Konfirmasi hapus foto" "Tidak mengubah stok, harga, atau nilai persediaan"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; [ -z "$(grep -lF -- "$s1" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks fitur baru '${s1}' SUDAH ada di dist release aktif — perbaiki daftar pembanding"; done
for s2 in "Total lead (termasuk spam)" "Pola lead & respons" "Customer lunas (ledger)" "Kesehatan & referensi" "Lead CTWA terbukti" "Tindakan lainnya" "Perkiraan biaya penanganan" "Penyebab masalah" "Solusi yang disepakati" "Bahan belum dicatat" "Bahan perlu dicek" "HPP belum lengkap" "Data order kurang" "Paling lama belum ditangani" "Unit ini memang tanpa bahan baru" "Saldo nol atau minus" "Saring harga berlaku" "Saring kelengkapan data bahan" "Belum ada harga berlaku" "pkr_nilai_penjualan" "pkr_sisa_ditagih" "Ada stok" "Stok belum diketahui" "Nol menurut pergerakan" "Saldo minus" "Koreksi saldo" "Ubah harga" "Pilih meja" "Pilih semua unit order ini" "Belum dijadwalkan" "Riwayat dan dokumen pemakaian" "Tanpa pengeluaran stok" "Mengurangi stok" "Beranda Gudang" "Pengeluaran Material" "Konfirmasi Barang Jadi" "Perlu keputusan Anda" "Varian serupa yang sudah ada" "Batalkan barang baru ini" "Ubah barang baru" "Periode order masuk" "Lengkapi di Order Produksi" "Selesai bertanggal pada periode" "tanpa tanggal tercatat" "Hanya order yang punya pemakaian bahan pada periode" "Tampilkan semua bahan" "Ada stok, belum ada harga" "Saringan aktif" "Harga Berlaku (HPP operasional)" "Nilai Finance dan harga pembanding" "Tambah pemakaian" "Ganti bahan" "Ajukan perubahan" "Lihat dampak" "Konfirmasi & kurangi stok" "Bahan belum tercatat" "Detail teknis" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa" "Harga Berlaku otomatis" "Apa dampaknya?" "Isian yang belum disimpan tidak mengubah harga" "Saat PO berhasil disimpan"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-fb-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
[ "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"
ok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR}: memuat hotfix performa (kode container == folder == baseline disetujui, terbukti gerbang kode live)"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"
cek_disk "setelah build image"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi pada salinan (uji batas tunggu kunci + pemulihan resmi), jalankan kode BARU sebagai server (foto), bukti persistensi file lintas recreate container, kompatibilitas kode lama, bandingkan sidik jari, hapus (DB dan data production tidak disentuh)"
REH_DB="rehearsal_fb_${TS}"
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
gagal_reh() { reh_drop; die "$@"; }
[ "$(bebas_kb)" -ge $(( DB_BYTES / 1024 * 3 + 1024 * 1024 )) ] || gagal_reh "ruang disk kurang untuk salinan restore (butuh >= $(( DB_BYTES / 1024 * 3 / 1024 + 1024 )) MiB bebas)"
# Skema salinan restore harus SAMA dengan production sebelum migrasi (restore setia) dan belum memuat kolom foto.
[ "$(RPSQL "$SKEMA_SQL")" = "$SKEMA_PRA" ] || gagal_reh "skema hasil restore BERBEDA dari production (sidik jari kolom/constraint/indeks/trigger)"
[ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='materials' and column_name in ('photo_file','photo_updated_at')")" = "0" ] || gagal_reh "salinan restore sudah memuat kolom foto (seharusnya belum: rilis belum dipasang)"
RMAT_PRA="$(RPSQL "$MAT_SQL")"; [ "$RMAT_PRA" = "$(psql_live -At -c "$MAT_SQL")" ] || gagal_reh "isi bahan hasil restore BERBEDA dari production"
ok "restore setia pada skema dan isi bahan production; kolom foto belum ada; migrasi rilis pending pada salinan"
# UJI BATAS TUNGGU KUNCI pada salinan restore: sesi lain memegang kunci baca pada materials → migrasi HARUS berhenti (bukan antre), tanpa kolom terpasang.
( dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -c "BEGIN; SELECT count(*) FROM materials; SELECT pg_sleep(40); COMMIT;" </dev/null >/dev/null 2>&1 & )
sleep 3
T_LK0="$(date +%s)"
if dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/reh-lock-timeout.log" 2>&1; then gagal_reh "migrasi TIDAK berhenti ketika tabel materials dikunci (lock_timeout tidak bekerja)"; fi
T_LK=$(( $(date +%s) - T_LK0 ))
grep -Eq '55P03|lock timeout' "$BK_DIR/reh-lock-timeout.log" || gagal_reh "migrasi gagal tetapi BUKAN karena batas tunggu kunci (lihat reh-lock-timeout.log)"
[ "$T_LK" -le 60 ] || gagal_reh "migrasi menunggu kunci terlalu lama (${T_LK} s)"
[ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='materials' and column_name in ('photo_file','photo_updated_at')")" = "0" ] || gagal_reh "kolom foto terpasang padahal migrasi berhenti (tidak atomik)"
ok "batas tunggu kunci teruji pada salinan: migrasi berhenti setelah ${T_LK} detik saat materials dikunci sesi lain; TIDAK ada kolom terpasang"
for i in $(seq 1 40); do [ "$(RPSQL "select count(*) from pg_stat_activity where datname = current_database() and query like '%pg_sleep(40)%' and pid <> pg_backend_pid()")" = "0" ] && break; sleep 2; done
# Pemulihan resmi migrasi yang berhenti (SAMA dengan yang dipakai di production bila ini terjadi): tandai rolled-back, lalu terapkan ulang.
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate resolve --rolled-back "$MIG_NAME" </dev/null > "$BK_DIR/reh-resolve.log" 2>&1 || { tail -n 8 "$BK_DIR/reh-resolve.log"; gagal_reh "migrate resolve --rolled-back pada salinan GAGAL"; }
T_M0="$(date +%s%N)"
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/reh-migrate-deploy.log" 2>&1 || { tail -n 12 "$BK_DIR/reh-migrate-deploy.log"; gagal_reh "migrate deploy pada salinan restore GAGAL"; }
T_M_MS=$(( ($(date +%s%N) - T_M0) / 1000000 ))
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || gagal_reh "migrate status rehearsal (image baru) setelah migrasi TIDAK 'up to date'"
struktur_baru RPSQL gagal_reh 1
[ "$(RPSQL "$SKEMA_SQL")" = "$SKEMA_PRA" ] || gagal_reh "skema lama / constraint / indeks / trigger BERUBAH oleh migrasi"
[ "$(RPSQL "$MAT_SQL")" = "$RMAT_PRA" ] || gagal_reh "isi bahan (tanpa kolom foto) BERUBAH oleh migrasi"
ok "migrasi diterapkan pada salinan restore (${T_M_MS} ms): 2 kolom NULL sesuai audit; skema/constraint/indeks/trigger lama IDENTIK; isi bahan IDENTIK; pemulihan resmi (resolve --rolled-back lalu deploy) teruji"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "rehearsal MENGUBAH isi tabel"; }
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata yang SUDAH bermigrasi, DB sementara, folder data SEMENTARA): Foto Bahan — unggah/putar/ganti/hapus, akses 401/403/404 dan URL bertanda-tangan, validasi isi/dimensi/format, serentak, kegagalan aman, hapus hanya berkas milik bahan, tanpa efek ke stok/harga/jurnal. Bahan uji hanya di salinan; DB dihapus di akhir.
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji Foto Bahan terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const sharp = require("sharp");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const selesai = async (kode) => { await prisma.$disconnect(); console.log(`\nRINGKASAN rehearsal Foto Bahan: ${n} pemeriksaan, ${gagal} gagal`); process.exit(kode); };

// REHEARSAL "Foto Bahan": kode BARU berjalan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production SETELAH migrasi.
// Semua tulisan hanya di DB sementara ini dan di folder data SEMENTARA (direktori data production TIDAK dipasang). Bahan uji dibuat di salinan (REH-FOTO-*), bukan bahan nyata; bahan nyata hanya DIBACA.
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji Foto Bahan hanya pada DB rehearsal", false, nm); await selesai(1); }
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const { FOTO_BAHAN_DIR, NAMA_VALID, namaThumb } = await imp("src/services/fotoBahan.js");
const dirTemp = process.env.FOTO_BAHAN_DIR ? true : FOTO_BAHAN_DIR.startsWith("/app/data/") && !fs.existsSync("/app/data/finance-receipts");
cek("folder foto memakai direktori data SEMENTARA (bukan direktori data production)", dirTemp, FOTO_BAHAN_DIR);
const PORT = Number(process.env.REH_PORT ?? 4101); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await selesai(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const buat = async (nama, role) => prisma.user.create({ data: { name: `REH ${nama}`, email: `reh-foto-${nama.toLowerCase()}-${stamp}@example.test`, passwordHash: "x", role } });
const uTulis = info.find((x) => bisa(x.rs, P.INVENTORY_WRITE) && bisa(x.rs, P.INVENTORY_READ))?.u ?? await buat("Tulis", "WAREHOUSE");
const uBaca = info.find((x) => bisa(x.rs, P.INVENTORY_READ) && !bisa(x.rs, P.INVENTORY_WRITE))?.u ?? null;
const uTanpa = info.find((x) => !bisa(x.rs, P.INVENTORY_READ) && !bisa(x.rs, P.UNIT_MATERIAL_WRITE))?.u ?? await buat("Sales", "SALES");
const tW = await token(uTulis); const tN = await token(uTanpa); const tR = uBaca ? await token(uBaca) : null;
cek("akun uji: penulis bahan (inventory:write), akun tanpa izin baca bahan" + (uBaca ? ", pembaca-saja" : " (pembaca-saja tidak ada di salinan: dilewati)"), !!uTulis && !!uTanpa);

const H = async (metode, p, tok, body = null) => { const r = await fetch(BASE + p, { method: metode, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const kirim = async (tok, id, buf, { nama = "foto.jpg", tipe = "image/jpeg" } = {}) => { const fd = new FormData(); fd.append("foto", new Blob([buf], { type: tipe }), nama); const r = await fetch(`${BASE}/api/inventory/materials/${id}/photo`, { method: "PUT", headers: tok ? { Authorization: "Bearer " + tok } : {}, body: fd }); let j = null; try { j = await r.json(); } catch { /* */ } return { status: r.status, json: j }; };
const jpeg = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 140, b: 90 } } }).jpeg().toBuffer();
const namaDari = (u) => new URL(u, "http://x").pathname.split("/").pop();
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const berkas = () => (fs.existsSync(FOTO_BAHAN_DIR) ? fs.readdirSync(FOTO_BAHAN_DIR).sort() : []);

// ── A. KEADAAN AWAL pada data NYATA hasil restore (hanya baca)
const jejak = async () => ({
  stok: await num("select count(*)::int n from stock_movements"), valuasi: await num("select count(*)::int n from fin_stock_movement_valuations"), jurnal: await num("select count(*)::int n from fin_journal_entries"), jurnalBaris: await num("select count(*)::int n from fin_journal_lines"),
  harga: await num("select count(*)::int n from material_harga_berlaku"), biayaBeku: await num("select count(*)::int n from stock_movement_biaya_operasional"), penyesuaian: await num("select count(*)::int n from stock_adjustment_requests"), material: await num("select count(*)::int n from materials"),
});
const sidikBahan = async () => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg((to_jsonb(m) - 'photo_file' - 'photo_updated_at')::text, '|' order by m.id::text)), '-') as n from materials m"))[0].n);
const sidikHarga = async () => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(h::text, '|' order by h.id::text)), '-') as n from material_harga_berlaku h"))[0].n);
const j0 = await jejak(); const b0 = await sidikBahan(); const h0 = await sidikHarga();
const sl0 = await H("GET", "/api/inventory/beranda/stok", tW);
cek("Stok & Lokasi pada data restore terbaca (200) dan memuat bahan nyata", sl0.status === 200 && Array.isArray(sl0.json?.rows) && sl0.json.rows.length > 0, `${sl0.status} ${sl0.json?.rows?.length} bahan`);
const baris0 = sl0.json?.rows ?? [];
cek("SEMUA bahan nyata tanpa foto: fotoUrl/fotoThumbUrl = null (bukan URL palsu), tanpa backfill", baris0.length > 0 && baris0.every((r) => r.fotoUrl === null && r.fotoThumbUrl === null), `${baris0.filter((r) => r.fotoUrl !== null).length} bahan berfoto`);
const bagian = (rows) => JSON.stringify(rows.map(({ fotoUrl, fotoThumbUrl, ...sisa }) => sisa));
const daftar0 = await H("GET", "/api/inventory/materials", tW);
cek("daftar bahan (/inventory/materials) terbaca; kolom mentah photoFile tidak bocor ke respons", daftar0.status === 200 && Array.isArray(daftar0.json) && daftar0.json.length === j0.material && daftar0.json.every((m) => !("photoFile" in m) && m.fotoUrl === null), `${daftar0.status}`);

// ── B. AKSES & IZIN
const kode = `REH-FOTO-${stamp}`.toUpperCase();
const m = await prisma.material.create({ data: { code: kode, name: "Bahan uji rehearsal foto (hanya di salinan)", unit: "PCS" } });
const g1 = await kirim(tW, m.id, await jpeg(3000, 2000));
cek("penulis bahan mengunggah foto 3000×2000: 200 dan URL bertanda-tangan", g1.status === 200 && /\/api\/inventory\/foto-bahan\/[^?]+\.webp\?exp=\d+&sig=[0-9a-f]{64}$/.test(g1.json?.fotoUrl ?? "") && !("photoFile" in (g1.json ?? {})), `${g1.status} ${g1.json?.error ?? ""}`);
const n1 = namaDari(g1.json?.fotoUrl ?? "");
cek("nama berkas valid (<id bahan>-<hex>.webp) + pasangan thumbnail ada di folder SEMENTARA; tidak ada berkas lain", NAMA_VALID.test(n1) && JSON.stringify(berkas()) === JSON.stringify([n1, namaThumb(n1)].sort()), berkas().join(","));
const meta1 = await sharp(fs.readFileSync(path.join(FOTO_BAHAN_DIR, n1))).metadata();
cek("hasil WebP, sisi terpanjang 1280, metadata dibuang", meta1.format === "webp" && Math.max(meta1.width, meta1.height) === 1280 && !meta1.exif, `${meta1.format} ${meta1.width}x${meta1.height}`);
const aksesTtd = await fetch(BASE + g1.json.fotoUrl); const aksesThumb = await fetch(BASE + g1.json.fotoThumbUrl);
cek("URL bertanda-tangan menyajikan foto (200 image/webp, nosniff, private+immutable) dan thumbnail", aksesTtd.status === 200 && aksesThumb.status === 200 && aksesTtd.headers.get("content-type") === "image/webp" && aksesTtd.headers.get("x-content-type-options") === "nosniff" && /private/.test(aksesTtd.headers.get("cache-control") ?? "") && /immutable/.test(aksesTtd.headers.get("cache-control") ?? ""));
cek("tanpa kredensial = 401; tanda tangan salah = 403; Bearer penulis = 200; akun tanpa izin baca bahan = 403", (await fetch(`${BASE}/api/inventory/foto-bahan/${n1}`)).status === 401 && (await fetch(`${BASE}/api/inventory/foto-bahan/${n1}?exp=${Math.floor(Date.now() / 1000) + 600}&sig=${"0".repeat(64)}`)).status === 403 && (await fetch(`${BASE}/api/inventory/foto-bahan/${n1}`, { headers: { Authorization: "Bearer " + tW } })).status === 200 && (await fetch(`${BASE}/api/inventory/foto-bahan/${n1}`, { headers: { Authorization: "Bearer " + tN } })).status === 403);
const trav = []; for (const k of ["..%2f..%2fpackage.json", "%2e%2e%2fsettings.json", "settings.json", "finance-receipts", ""]) trav.push((await fetch(`${BASE}/api/inventory/foto-bahan/${k}?exp=1&sig=${"0".repeat(64)}`)).status);
cek("traversal / berkas lain / direktori tidak pernah tersaji (semua 401/403/404)", trav.every((s) => [401, 403, 404].includes(s)), trav.join(","));
cek("tanpa izin tulis bahan: unggah/putar/hapus ditolak 403" + (tR ? " (juga pembaca-saja)" : ""), (await kirim(tN, m.id, await jpeg(300, 300))).status === 403 && (await H("DELETE", `/api/inventory/materials/${m.id}/photo`, tN)).status === 403 && (await H("POST", `/api/inventory/materials/${m.id}/photo/rotate`, tN, { derajat: 90 })).status === 403 && (!tR || (await kirim(tR, m.id, await jpeg(300, 300))).status === 403));
cek("penolakan tidak mengubah apa pun: foto lama tetap, tak ada berkas baru", JSON.stringify(berkas()) === JSON.stringify([n1, namaThumb(n1)].sort()));

// ── C. PUTAR / GANTI / VALIDASI / GAGAL-AMAN
const r90 = await H("POST", `/api/inventory/materials/${m.id}/photo/rotate`, tW, { derajat: 90 }); const n2 = namaDari(r90.json?.fotoUrl ?? "");
const meta2 = n2 ? await sharp(fs.readFileSync(path.join(FOTO_BAHAN_DIR, n2))).metadata() : {};
cek("putar 90°: dimensi bertukar, nama BARU (URL berganti, cache tidak menampilkan foto lama), berkas lama terhapus", r90.status === 200 && n2 !== n1 && meta2.width === meta1.height && meta2.height === meta1.width && JSON.stringify(berkas()) === JSON.stringify([n2, namaThumb(n2)].sort()), `${r90.status} ${meta2.width}x${meta2.height}`);
cek("URL lama (sebelum putar) tidak lagi tersaji (404)", (await fetch(BASE + g1.json.fotoUrl)).status === 404 && (await fetch(BASE + g1.json.fotoThumbUrl)).status === 404);
const g3 = await kirim(tW, m.id, await jpeg(700, 700)); const n3 = namaDari(g3.json?.fotoUrl ?? "");
cek("ganti foto: nama baru, daftar Stok & Lokasi langsung memuat URL thumbnail TERBARU", g3.status === 200 && n3 !== n2 && (await H("GET", "/api/inventory/beranda/stok", tW)).json.rows.find((r) => r.materialId === m.id)?.fotoThumbUrl === g3.json.fotoThumbUrl);
const lebar = await sharp({ create: { width: 13000, height: 64, channels: 3, background: "#888" } }).png({ compressionLevel: 9 }).toBuffer();
const tolak = [await kirim(tW, m.id, Buffer.from("bukan gambar")), await kirim(tW, m.id, Buffer.from("%PDF-1.4 palsu")), await kirim(tW, m.id, lebar, { nama: "a.png", tipe: "image/png" }), await kirim(tW, m.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>'), { nama: "a.png", tipe: "image/png" }), await kirim(tW, m.id, Buffer.alloc(10 * 1024 * 1024 + 4096, 1))];
cek("isi bukan gambar / PDF / dimensi 13000 / SVG / >10 MB ditolak (400/413) SEBELUM diproses", tolak.map((r) => r.status).join() === "400,400,400,400,413", tolak.map((r) => r.status).join());
cek("setelah semua penolakan: foto terakhir utuh dan tak ada berkas yatim", JSON.stringify(berkas()) === JSON.stringify([n3, namaThumb(n3)].sort()));
const ser = await Promise.all([jpeg(600, 400), jpeg(500, 500), jpeg(400, 600)].map(async (b) => kirim(tW, m.id, await b)));
const akhir = (await prisma.$queryRawUnsafe("select photo_file as f from materials where id = $1::uuid", m.id))[0].f;
cek("tiga unggahan SERENTAK untuk bahan yang sama: semua 200, tepat satu pasangan berkas tersisa dan dirujuk DB", ser.every((r) => r.status === 200) && JSON.stringify(berkas()) === JSON.stringify([akhir, namaThumb(akhir)].sort()), `${ser.map((r) => r.status).join()} ${berkas().length} berkas`);
const audit = await prisma.activityEvent.findMany({ where: { entityType: "material", entityId: m.id }, orderBy: { createdAt: "asc" } });
cek("jejak audit: satu per perubahan foto, rantai from→to tidak putus, pelaku tercatat", audit.length === 6 && audit.slice(1).every((a, i) => a.metadata.changes.foto.from === audit[i].metadata.changes.foto.to) && audit.every((a) => a.actorId === uTulis.id), `${audit.length} peristiwa`);
// foto dimanipulasi: nilai kolom menunjuk berkas lain → hapus TIDAK menyentuh berkas itu
fs.writeFileSync(path.join(FOTO_BAHAN_DIR, "bukan-milik-fitur.txt"), "jangan dihapus");
await prisma.$executeRawUnsafe("update materials set photo_file = $1 where id = $2::uuid", "../bukan-milik-fitur.txt", m.id);
const hp = await H("DELETE", `/api/inventory/materials/${m.id}/photo`, tW);
cek("kolom dimanipulasi (../bukan-milik-fitur.txt): hapus foto hanya membersihkan DB dan TIDAK menghapus berkas lain", hp.status === 200 && fs.existsSync(path.join(FOTO_BAHAN_DIR, "bukan-milik-fitur.txt")));
fs.rmSync(path.join(FOTO_BAHAN_DIR, "bukan-milik-fitur.txt"), { force: true });
for (const f of berkas()) fs.rmSync(path.join(FOTO_BAHAN_DIR, f), { force: true }); // sisa serentak milik bahan uji

// ── D. TIDAK ADA EFEK SAMPING PADA DATA NYATA
const hapusUji = await H("DELETE", `/api/inventory/materials/${m.id}/photo`, tW);
await prisma.activityEvent.deleteMany({ where: { entityType: "material", entityId: m.id } }); await prisma.material.delete({ where: { id: m.id } });
const j1 = await jejak(); const b1 = await sidikBahan(); const h1 = await sidikHarga();
cek("stok, valuasi, jurnal, harga berlaku, biaya beku, penyesuaian, dan jumlah bahan IDENTIK sebelum vs sesudah seluruh uji foto", JSON.stringify(j0) === JSON.stringify(j1), JSON.stringify({ j0, j1 }));
cek("seluruh isi data bahan (kecuali kolom foto) dan seluruh baris Harga Berlaku IDENTIK sebelum vs sesudah", b0 === b1 && h0 === h1);
const sl1 = await H("GET", "/api/inventory/beranda/stok", tW);
cek("angka Stok & Lokasi (saldo, tersedia, keadaan, batas minimum, lokasi terakhir) IDENTIK sebelum vs sesudah — foto tidak mengubah stok", sl1.status === 200 && bagian(sl1.json.rows) === bagian(baris0) && sl1.json.rows.every((r) => r.fotoUrl === null), `${hapusUji.status}`);
berhenti(); await new Promise((r) => setTimeout(r, 500));
await selesai(gagal ? 1 : 0);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
# BUKTI PERSISTENSI FILE (rehearsal; direktori data SEMENTARA — direktori data production TIDAK dipasang): kontainer 1 menulis foto → kontainer 1 DIHAPUS (--rm) → kontainer 2 BARU membacanya lewat router produksi; lalu kontrol negatif tanpa volume.
REH_DBURL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
FOTO_JSON="$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="$REH_DBURL" backend node scripts/uji-foto-bahan-persisten.mjs tulis </dev/null 2> "$BK_DIR/persisten-tulis.err" | tail -n 1)" || { cat "$BK_DIR/persisten-tulis.err"; gagal_reh "bukti persistensi: kontainer 1 gagal menulis foto"; }
FOTO_ID="$(printf '%s' "$FOTO_JSON" | sed -n 's/.*"materialId":"\([0-9a-f-]*\)".*/\1/p')"; FOTO_SHA="$(printf '%s' "$FOTO_JSON" | sed -n 's/.*"sha256":"\([0-9a-f]*\)".*/\1/p')"
[[ "$FOTO_ID" =~ ^[0-9a-f-]{36}$ ]] && [[ "$FOTO_SHA" =~ ^[0-9a-f]{64}$ ]] || gagal_reh "bukti persistensi: keluaran kontainer 1 tidak valid: ${FOTO_JSON}"
[ "$(ls "$BK_DIR/reh-data/material-photos" 2>/dev/null | wc -l)" = "2" ] || gagal_reh "bukti persistensi: host tidak melihat tepat 2 berkas (utama + thumbnail) di direktori data sementara"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="$REH_DBURL" backend node scripts/uji-foto-bahan-persisten.mjs baca "$FOTO_ID" "$FOTO_SHA" </dev/null > "$BK_DIR/persisten-baca.log" 2>&1 || { cat "$BK_DIR/persisten-baca.log"; gagal_reh "bukti persistensi: kontainer BARU (recreate) tidak dapat membaca foto dari volume yang sama"; }
grep -q '"shaCocok":true' "$BK_DIR/persisten-baca.log" || gagal_reh "bukti persistensi: isi foto setelah recreate berbeda"
REH_NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CID_OLD")"
if docker run --rm --network "$REH_NET" -e DATABASE_URL="$REH_DBURL" "$NEW_IMG_ID" node scripts/uji-foto-bahan-persisten.mjs baca "$FOTO_ID" "$FOTO_SHA" > "$BK_DIR/persisten-kontrol.log" 2>&1 </dev/null; then gagal_reh "kontrol negatif: kontainer TANPA volume seharusnya TIDAK menemukan foto"; fi
grep -q '"statusUtama":404' "$BK_DIR/persisten-kontrol.log" || gagal_reh "kontrol negatif: kontainer tanpa volume harus 404 (lihat persisten-kontrol.log)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="$REH_DBURL" backend node scripts/uji-foto-bahan-persisten.mjs bersih "$FOTO_ID" </dev/null > "$BK_DIR/persisten-bersih.log" 2>&1 || gagal_reh "bukti persistensi: pembersihan bahan uji gagal"
[ "$(ls "$BK_DIR/reh-data/material-photos" 2>/dev/null | wc -l)" = "0" ] || gagal_reh "berkas uji tersisa di direktori data sementara"
ok "persistensi file TERBUKTI: foto ditulis kontainer 1, kontainer 1 dihapus, kontainer 2 BARU membaca isi identik (sha256) lewat router produksi dan URL bertanda-tangan; tanpa volume = 404 (volume-lah yang menyimpan); production: /app/data = ${MOUNT_DATA_LAMA#bind:}"
# KOMPATIBILITAS KODE LAMA (rollback kode tanpa membalik skema): image LAMA (tag rollback) terhadap salinan yang SUDAH bermigrasi. CMD kontainer lama menjalankan migrate deploy saat start → harus lolos; kueri/penulisan bahan lama harus normal.
docker run --rm --network "$REH_NET" -e DATABASE_URL="$REH_DBURL" "$ROLLBACK_TAG" npx prisma migrate deploy > "$BK_DIR/kompat-migrate-deploy.log" 2>&1 </dev/null || { tail -n 12 "$BK_DIR/kompat-migrate-deploy.log"; gagal_reh "kompatibilitas: image LAMA gagal menjalankan migrate deploy pada skema baru (rollback akan gagal start)"; }
grep -qi 'No pending migrations' "$BK_DIR/kompat-migrate-deploy.log" || gagal_reh "kompatibilitas: image lama tidak melaporkan 'No pending migrations' pada skema baru"
docker run --rm -i --network "$REH_NET" -e DATABASE_URL="$REH_DBURL" "$ROLLBACK_TAG" node --input-type=module - > "$BK_DIR/kompat-lama.log" 2>&1 <<'KOMPATNODE' || { cat "$BK_DIR/kompat-lama.log"; gagal_reh "kompatibilitas kode lama GAGAL"; }
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app";
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
// KOMPATIBILITAS KODE LAMA: image LAMA (tag rollback) dijalankan terhadap salinan restore yang SUDAH bermigrasi (kolom foto ada). Ini yang terjadi bila rilis di-rollback KODE-nya tanpa membalik skema.
// Dijalankan HANYA pada DB salinan (nama "rehearsal_*" atau "*_test"): ada satu tulisan uji (bahan uji dibuat lalu dihapus) di salinan itu.
const nm = (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_|_test$/.test(nm)) { cek("uji kompatibilitas kode lama hanya pada DB salinan", false, nm); await prisma.$disconnect(); process.exit(1); }
const kolom = Number((await prisma.$queryRawUnsafe("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='materials' and column_name in ('photo_file','photo_updated_at')"))[0].n);
cek("skema salinan SUDAH memuat kolom foto (kode lama berjalan di atas skema BARU)", kolom === 2, `${kolom} kolom`);
const { stokLokasi } = await imp("src/services/stokLokasi.js");
let hasil = null; let galat = "";
try { hasil = await stokLokasi(prisma); } catch (e) { galat = String(e?.message ?? e).slice(0, 200); }
cek("kode lama: Stok & Lokasi (stokLokasi) berjalan tanpa galat dan mengembalikan seluruh bahan", !!hasil && Array.isArray(hasil.rows) && hasil.rows.length > 0, galat || `${hasil?.rows?.length} bahan`);
cek("kode lama: baris tidak memuat kolom foto (tidak tahu, tidak error)", !!hasil && hasil.rows.every((r) => !("fotoUrl" in r) && !("photoFile" in r)));
let semua = null; galat = "";
try { semua = await prisma.material.findMany({ take: 50 }); } catch (e) { galat = String(e?.message ?? e).slice(0, 200); }
cek("kode lama: prisma.material.findMany tidak terganggu kolom tak dikenal", Array.isArray(semua) && semua.length > 0, galat);
const kode = `REH-KOMPAT-${Date.now().toString(36)}`.toUpperCase(); let ok = false; galat = "";
try {
  const m = await prisma.material.create({ data: { code: kode, name: "Uji kompatibilitas kode lama (salinan)", unit: "PCS" } });
  await prisma.material.update({ where: { id: m.id }, data: { name: "Uji kompatibilitas kode lama (diubah)", reorderPoint: 3 } });
  const dibaca = await prisma.material.findUnique({ where: { id: m.id } });
  await prisma.material.delete({ where: { id: m.id } });
  ok = dibaca?.name?.endsWith("(diubah)") === true;
} catch (e) { galat = String(e?.message ?? e).slice(0, 200); }
cek("kode lama: membuat/mengubah/menghapus bahan tetap berfungsi (kolom foto nullable tanpa default tidak mengganggu INSERT/UPDATE)", ok, galat);
await prisma.$disconnect();
console.log(`\nRINGKASAN kompatibilitas kode lama: ${n} pemeriksaan, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
KOMPATNODE
ok "kompatibilitas rollback KODE: image LAMA ($(printf '%s' "$ROLLBACK_TAG" | sed 's/.*://')) menjalankan migrate deploy tanpa masalah ('No pending migrations') dan $(grep -c '^OK' "$BK_DIR/kompat-lama.log") pemeriksaan kueri/tulis bahan lulus di atas skema BARU"
reh_drop
# direktori sementara dibuat root oleh kontainer: dihapus lewat kontainer (rm biasa ditolak); kegagalan pembersihan tidak menggagalkan rilis
dcp "$NEW_DIR" run --rm --no-deps -T -v "$BK_DIR:/bk" backend sh -c 'rm -rf /bk/reh-data /bk/reh-uploads /bk/reh-dd' </dev/null >/dev/null 2>&1 || true
ok "rehearsal lulus: migrasi diterapkan pada salinan restore (kolom NULL, skema lama identik, batas tunggu kunci + pemulihan resmi teruji); isi ${FP_N} tabel lama IDENTIK; uji tulis foto dilakukan HANYA pada salinan restore + folder data sementara lalu DB sementara dihapus; production tidak disentuh"
cek_disk "setelah rehearsal"
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
cek_disk "sebelum migrasi"
gerbang_kode_live "fase-6-pra-migrasi"
tidak_ada_deploy_lain_lagi
# Keadaan production diputuskan ULANG sesaat sebelum bertindak: harus sama dengan preflight (tidak ada sesi lain yang menerapkan/mengubah migrasi).
KEADAAN2="$(keadaan_produksi "2")" || die "${KEADAAN2}"
[ "$KEADAAN2" = "$KEADAAN" ] || die "keadaan production berubah sejak preflight (${KEADAAN} → ${KEADAAN2})"
cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sebelum2.txt" || die "daftar migrasi terpasang berubah selama persiapan (sesi lain menerapkan migrasi) — berhenti, ulangi preflight"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
[ "$(mount_data "$CID_OLD")" = "$MOUNT_DATA_LAMA" ] || die "mount /app/data container live berubah selama persiapan"
COUNT_SQL="select 'materials', count(*) from materials union all select 'materials_berfoto', count(*) from materials where photo_file is not null union all select 'stock_movements', count(*) from stock_movements union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'valuasi_stok', count(*) from fin_stock_movement_valuations union all select 'jurnal', count(*) from fin_journal_entries union all select 'jurnal_baris', count(*) from fin_journal_lines union all select 'biaya_beku', count(*) from stock_movement_biaya_operasional union all select 'penyesuaian_stok', count(*) from stock_adjustment_requests union all select 'catatan_pemakaian', count(*) from unit_usage_notes union all select 'aktivitas_bahan', count(*) from activity_events where entity_type = 'material'"
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pra-switch.txt" || die "hitung baris pra-migrasi gagal"; ok "pra-migrasi: hitung baris bahan/foto/stok/harga/valuasi/jurnal/biaya beku/penyesuaian/catatan pemakaian/aktivitas bahan dicatat"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-migrasi.txt" || die "sidik jari beku pra-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH sebelum migrasi"; }
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema production berubah sejak preflight"
MAT_PRA="$(psql_live -At -c "$MAT_SQL")"
if [ "$KEADAAN" = "SEGAR" ]; then
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-deploy.log" 2>&1 || { tail -n 14 "$BK_DIR/migrate-deploy.log"; die "migrate deploy GAGAL (bila 55P03/lock timeout: database sibuk, tidak ada kolom terpasang — ikuti pemulihan di instruksi rollback: resolve --rolled-back lalu ulangi); backend baru TIDAK dinyalakan, backend lama tetap melayani"; }
  cat "$BK_DIR/migrate-deploy.log" | tail -n 4 | sed 's/^/        /'
else
  # LANJUT: migrasi SUDAH terpasang dan terbukti (checksum, struktur, kosong). TIDAK menjalankan migrate deploy: hanya membaca status.
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | tee "$BK_DIR/migrate-status-lanjut.log" | grep -i 'up to date' >/dev/null || die "keadaan LANJUT: migrate status production tidak 'up to date'"
fi
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang != baseline + 1 ($(( MIG_SEBELUM + 1 )))"
psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${MIG_NAME}'" | grep -Fx t >/dev/null || die "${MIG_NAME} tidak tercatat selesai"
struktur_baru LQ die 1
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema lama / constraint / indeks / trigger BERUBAH oleh migrasi (jangan switch)"
[ "$(psql_live -At -c "$MAT_SQL")" = "$MAT_PRA" ] || die "isi bahan (tanpa kolom foto) BERUBAH oleh migrasi (jangan switch)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah tahap migrasi"
ok "migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); 2 kolom NULL, struktur tervalidasi; skema/constraint/indeks/trigger lama identik; isi bahan identik; backend lama tetap sehat dan melayani"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari beku pasca-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh tahap migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: dokumen pembanding beku IDENTIK"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
cek_disk "sebelum switch"
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
struktur_baru PSQLN die 0
[ "$(mount_data "$CID_NEW")" = "$MOUNT_DATA_LAMA" ] || die "mount /app/data container BARU ($(mount_data "$CID_NEW")) berbeda dari container lama (${MOUNT_DATA_LAMA}) — foto bisa tidak terbaca"
docker exec "$CID_NEW" sh -c 'test -w /app/data' </dev/null || die "folder /app/data tidak dapat ditulis container baru"
ok "kolom foto terpasang tepat sesuai audit; /app/data container baru = bind-mount persisten yang sama dengan container lama (${MOUNT_DATA_LAMA#bind:})"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
# hitung baris pasca-switch vs pra-switch (informasi: pengguna sungguhan bisa menulis selama jendela rilis; skrip ini sendiri tidak menulis apa pun)
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pasca-switch.txt" || die "hitung baris pasca-switch gagal"
if diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" >/dev/null; then ok "hitung baris bahan/foto/stok/harga/valuasi/jurnal/biaya beku/penyesuaian/catatan pemakaian/aktivitas bahan IDENTIK sebelum vs sesudah switch"; else warn "hitung baris berbeda sebelum vs sesudah switch (kemungkinan aktivitas pengguna sungguhan selama jendela rilis; skrip tidak menulis):"; diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" | sed 's/^/        /' || true; fi
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: kolom foto, Stok & Lokasi (baris = bahan; URL foto null atau bertanda-tangan), akses media 401/403/404, unggah/hapus/putar tanpa token = 401 dan tanpa izin = 403; TANPA unggahan dan TANPA foto/bahan percobaan; bahan, foto, stok, harga, valuasi, jurnal identik"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal/lokal menjalankan kode smoke YANG SAMA terhadap server uji (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup. TIDAK ada unggahan, TIDAK ada foto contoh, TIDAK ada perubahan bahan. Yang dilakukan: membaca Stok & Lokasi, memeriksa skema/kolom, dan menguji PENOLAKAN
// (tanpa token, tanpa izin, tanda tangan salah) yang terjadi SEBELUM menyentuh data. Jejak tulis (bahan, foto, stok, harga, jurnal, aktivitas bahan) harus identik sebelum vs sesudah smoke.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const get = async (p, tok) => { const r = await fetch(BASE + p, { headers: tok ? { Authorization: "Bearer " + tok } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.INVENTORY_READ))?.u; const tanpaIzin = info.find((x) => !bisa(x.rs, P.INVENTORY_READ) && !bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.INVENTORY_WRITE))?.u;
if (!pembaca) { rec("akun dengan inventory:read tersedia", false); process.exit(1); }
const tR = await tokenUntuk(pembaca); const tN = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;
const jejak = async () => ({
  material: await hitung("select count(*)::int n from materials"), berfoto: await hitung("select count(*)::int n from materials where photo_file is not null"),
  stok: await hitung("select count(*)::int n from stock_movements"), harga: await hitung("select count(*)::int n from material_harga_berlaku"), valuasi: await hitung("select count(*)::int n from fin_stock_movement_valuations"), jurnal: await hitung("select count(*)::int n from fin_journal_entries"),
  aktivitasBahan: await hitung("select count(*)::int n from activity_events where entity_type = 'material'"),
});
const s0 = await jejak();

// ── skema
const kol = await prisma.$queryRawUnsafe("select column_name c, data_type t, character_maximum_length l, is_nullable nl, column_default d from information_schema.columns where table_schema='public' and table_name='materials' and column_name in ('photo_file','photo_updated_at') order by column_name");
rec("kolom foto terpasang tepat seperti migrasi: photo_file varchar(80) NULL tanpa default; photo_updated_at timestamp NULL tanpa default", kol.length === 2 && kol[0].c === "photo_file" && kol[0].t === "character varying" && Number(kol[0].l) === 80 && kol[0].nl === "YES" && kol[0].d === null && kol[1].c === "photo_updated_at" && kol[1].t === "timestamp without time zone" && kol[1].nl === "YES" && kol[1].d === null, JSON.stringify(kol));
rec("isi kolom photo_file hanya NULL atau nama berkas sah (<id bahan>-<hex>.webp) milik bahan itu sendiri", (await hitung("select count(*)::int n from materials where photo_file is not null and (photo_file !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{12}[.]webp$' or photo_file not like id::text || '-%')")) === 0);
let dapatTulis = false; try { fs.accessSync(path.join(process.env.FOTO_BAHAN_DIR ?? "/app/data"), fs.constants.W_OK); dapatTulis = true; } catch { /* tidak bisa */ }
rec("folder data aplikasi dapat ditulis proses backend (syarat unggah foto); folder foto dibuat otomatis saat unggahan pertama", dapatTulis);

// ── Stok & Lokasi (baca-saja)
const sl = await get("/api/inventory/beranda/stok", tR);
rec("Stok & Lokasi terbaca (200) dan jumlah baris = jumlah bahan di database", sl.status === 200 && Array.isArray(sl.json?.rows) && sl.json.rows.length === s0.material, `${sl.status} ${sl.json?.rows?.length}/${s0.material}`);
const rows = sl.json?.rows ?? [];
const ttd = /^\/api\/inventory\/foto-bahan\/[0-9a-f-]{36}-[0-9a-f]{12}(-t)?\.webp\?exp=\d+&sig=[0-9a-f]{64}$/;
rec("setiap baris: fotoUrl/fotoThumbUrl null (belum ada foto) ATAU URL bertanda-tangan sah — tidak ada nama berkas mentah/path/URL statis", rows.length > 0 && rows.every((r) => (r.fotoUrl === null && r.fotoThumbUrl === null) || (ttd.test(r.fotoUrl ?? "") && ttd.test(r.fotoThumbUrl ?? ""))) && rows.every((r) => !("photoFile" in r)), `${rows.filter((r) => r.fotoUrl).length} berfoto`);
const bf = rows.find((r) => r.fotoUrl);
if (bf) { const a = await fetch(BASE + bf.fotoThumbUrl); rec("satu thumbnail nyata tersaji lewat URL bertanda-tangan (200 image/webp)", a.status === 200 && a.headers.get("content-type") === "image/webp"); } else skip("thumbnail nyata tersaji", "belum ada bahan berfoto di production (diharapkan tepat setelah rilis pertama)");
const dm = await get("/api/inventory/materials", tR);
rec("katalog bahan terbaca (200); kolom mentah photoFile tidak bocor", dm.status === 200 && Array.isArray(dm.json) && dm.json.length === s0.material && dm.json.every((m) => !("photoFile" in m)), `${dm.status}`);

// ── akses: penolakan sebelum menyentuh data
const sampel = rows[0]?.materialId ?? null; const namaPalsu = "00000000-0000-4000-8000-000000000000-aaaaaaaaaaaa.webp";
rec("media tanpa kredensial = 401; tanda tangan salah = 403; nama tak sah / traversal = 404/401/403", (await fetch(`${BASE}/api/inventory/foto-bahan/${namaPalsu}`)).status === 401 && (await fetch(`${BASE}/api/inventory/foto-bahan/${namaPalsu}?exp=${Math.floor(Date.now() / 1000) + 600}&sig=${"0".repeat(64)}`)).status === 403 && [404, 401, 403].includes((await fetch(`${BASE}/api/inventory/foto-bahan/..%2f..%2fpackage.json?exp=1&sig=${"0".repeat(64)}`)).status));
rec("media dengan Bearer berizin tetapi berkas tidak ada = 404 (bukan 500, tidak membocorkan jalur)", (await fetch(`${BASE}/api/inventory/foto-bahan/${namaPalsu}`, { headers: { Authorization: "Bearer " + tR } })).status === 404);
if (tN) rec("akun tanpa izin baca bahan: media Bearer = 403", (await fetch(`${BASE}/api/inventory/foto-bahan/${namaPalsu}`, { headers: { Authorization: "Bearer " + tN } })).status === 403); else skip("akun tanpa izin baca bahan ditolak", "tidak ada akun aktif tanpa izin bahan");
if (sampel) {
  const tanpaToken = await Promise.all([fetch(`${BASE}/api/inventory/materials/${sampel}/photo`, { method: "PUT" }), fetch(`${BASE}/api/inventory/materials/${sampel}/photo`, { method: "DELETE" }), fetch(`${BASE}/api/inventory/materials/${sampel}/photo/rotate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })]);
  rec("unggah/hapus/putar TANPA token = 401 (ditolak sebelum menyentuh data; tidak ada unggahan dilakukan)", tanpaToken.every((r) => r.status === 401), tanpaToken.map((r) => r.status).join());
  if (tN) { const tanpaIzinTulis = await Promise.all([fetch(`${BASE}/api/inventory/materials/${sampel}/photo`, { method: "DELETE", headers: { Authorization: "Bearer " + tN } }), fetch(`${BASE}/api/inventory/materials/${sampel}/photo/rotate`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tN }, body: JSON.stringify({ derajat: 90 }) })]); rec("hapus/putar oleh akun tanpa izin = 403 (tanpa efek)", tanpaIzinTulis.every((r) => r.status === 403), tanpaIzinTulis.map((r) => r.status).join()); }
} else skip("penolakan tulis", "tidak ada bahan di production");

// ── tidak ada jejak tulis
const s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]);
rec("TIDAK ada jejak tulis akibat smoke: jumlah bahan, bahan berfoto, pergerakan stok, harga berlaku, valuasi, jurnal, aktivitas bahan sama persis sebelum vs sesudah", beda.length === 0, beda.length ? beda.map((k) => `${k}: ${s0[k]}→${s1[k]}`).join("; ") : "identik");
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
  ok "smoke test lulus (kolom foto, Stok & Lokasi, akses media, penolakan sebelum menulis, tanpa jejak tulis)"
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
say "CATATAN: Rilis ini membawa Foto Bahan (Gudang → Stok & Lokasi): unggah/ganti/putar/hapus satu foto per bahan oleh pemegang izin ubah bahan; foto disajikan lewat URL bertanda-tangan (tanpa penyajian statis); file di ${PERSIST}/backend/data/material-photos. Migrasi aditif: dua kolom NULL pada materials, tanpa backfill. Rilis TIDAK mengunggah foto atau mengubah bahan, stok, harga, valuasi, jurnal, atau izin. Backup database TIDAK memuat berkas foto: salin folder foto secara berkala. Rollback KODE: image ${ROLLBACK_TAG} + folder ${PREV_DIR} (kolom foto tetap, tidak dibaca kode lama; file foto tetap di folder persisten)."

