#!/usr/bin/env bash
# RILIS "KELENGKAPAN ORDER PRODUKSI (penyaring Bahan belum dicatat / Bahan perlu dicek / HPP belum lengkap / Data order kurang + pernyataan tanpa bahan baru)": WEB + BACKEND + 1 MIGRASI ADITIF (1 tabel baru; isi dibaca aktual, tidak diasumsikan kosong). RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Kode: chip penyaring di Order Produksi dengan jumlah dari SERVER (seluruh unit yang cocok, bukan halaman), periode (dasar: tanggal order masuk = unit dibuat) + urutan "paling lama belum ditangani", label ringkas per baris + ikon info + satu tombol "Lengkapi",
#     bagian "Kelengkapan data" di drawer, kolom kelengkapan di Export Excel. SATU klasifikasi untuk daftar, drawer, filter/hitungan, dan ekspor (lib/domain/kelengkapanOrderProduksi.js). Membuka daftar/filter/drawer/ekspor TIDAK menulis apa pun.
#   ATURAN: status RESMI unit/order Siap Kirim/Dikirim/Terkirim menjadi dasar pemeriksaan bahan walau status kerja tertinggal; data order tanpa aturan wajib = "Belum dinilai" (bukan lengkap); HPP = HPP OPERASIONAL (harga berlaku), bukan biaya Finance;
#     target/PIC/rencana bahan opsional tidak dihitung kekurangan; pernyataan "tanpa bahan baru" tidak menyembunyikan masalah bila catatan bahan ditambahkan kemudian (dihitung saat dibaca → "Bahan perlu dicek: PERNYATAAN_BERTENTANGAN").
#   PENGUNCIAN: kunci sendiri (release-kelengkapan.lock) + kunci deploy BERSAMA (release-deploy-bersama.lock) diambil ATOMIK sebelum memeriksa kunci lain; kepemilikan ditentukan oleh proses (perangkat:inode fd 7/9), BUKAN nama berkas. Diperiksa di fase 0, sebelum migrasi, dan tepat sebelum switch.
#   Tulisan HANYA oleh pengguna berizin (UNIT_ROUTING_WRITE): pernyataan eksplisit "tanpa bahan baru" (alasan wajib, idempoten, satu aktif per unit, pencabutan tercatat, log aktivitas). TIDAK membuat stok, Material Issue, Run, jadwal, status, biaya, atau jurnal.
#   Migrasi: 1 CREATE TABLE baru + 3 indeks (2 unik, 1 parsial 'satu pernyataan AKTIF per unit') + 1 FK ON DELETE RESTRICT ke units. Tanpa ALTER pada tabel lama, tanpa backfill, TANPA pernyataan massal. Keadaan SEGAR (migrasi belum terpasang) maupun LANJUT (sudah terpasang oleh percobaan sebelumnya: checksum, status, STRUKTUR persis; isi tabel DIBACA aktual, tidak diasumsikan kosong; tidak diterapkan ulang, tidak dihapus).
#   BASELINE = release aktif yang disetujui Owner pada argumen --base (saat ditulis 188220e7: Redesign Komplain di atas e89bb0ea laporan Meta Ads MCP di atas aed5d9c9 Export Excel PKR di atas e7883bc6 PO barang mirip, drawer 17305848, penjadwalan+hotfix c518209e). GERBANG IDENTITAS KODE LIVE membandingkan ISI kode (hash blob semua berkas terlacak baseline, berkas tambahan, container == folder release, identitas proses)
#     di fase audit, tepat sebelum migrasi, dan tepat sebelum switch; marker .release-commit bukan bukti. Pembersihan release lama (fase 9) DINONAKTIFKAN: tidak ada folder release/image rollback/backup/volume yang dihapus oleh skrip.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, pin sha256 migrasi + diff schema, pemindai DDL + mutan negatif) → (2) audit produksi baca-saja + keadaan (SEGAR/LANJUT) + gerbang kode live → (3) backup + checksum → (4) build web + image
#              → (5) REHEARSAL (restore NYATA terbaru, migrasi dengan image baru, struktur, kode baru terhadap data restore: jumlah per kategori, WAKTU RESPONS + deteksi permintaan per unit, skenario tulis/pertentangan/bersamaan, guard rollback, image LAMA tetap bisa start) → (6) migrate deploy produksi SATU kali (backend lama tetap melayani) → (7) switch → (8) verifikasi + smoke
#
#   cat scripts/release-kelengkapan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/kl1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/kl1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/kl1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/kl1r.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata (migrasi HANYA pada DB sementara); TANPA migrasi/switch prod
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/kl1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/kl1.out 2>&1 < /dev/null &'   # rilis penuh (hanya setelah persetujuan)
#
# ROLLBACK KODE: tabel baru ADITIF; kode lama mengabaikannya. Dampak (DINILAI: RENDAH, hanya penglihatan): pernyataan yang sudah tersimpan TIDAK TERLIHAT/TIDAK BISA dicabut di kode lama dan penanda pertentangan tidak dihitung; tidak ada data yang salah,
#   dan dihitung ulang saat kode baru terpasang lagi. GUARD (scripts/rollback-guard-kelengkapan.sh, baca-saja) TIDAK memblokir, tetapi WAJIB dijalankan: mencetak jumlah + contoh, menulis SNAPSHOT pernyataan aktif, dan memperingatkan yang bertentangan.
#   Rehearsal juga membuktikan IMAGE LAMA tetap bisa start (migrate deploy image lama pada DB yang sudah bermigrasi: tidak gagal, tidak menerapkan apa pun).
# (dibangkitkan oleh scripts/gen-release-kelengkapan.cjs dari scripts/release-status-kerja-buka-pekerjaan.sh + scripts/templates/release-kelengkapan/* + blok gerbang di scripts/templates/release-penjadwalan-langsung/*; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/order-produksi-kelengkapan}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/prisma/migrations/20261231110000_pernyataan_tanpa_bahan/migration\.sql|backend/prisma/schema\.prisma|backend/src/lib/activityLog\.js|backend/src/lib/domain/kelengkapanOrderProduksi\.js|backend/src/routes/productionAdopsi\.js|backend/src/services/productionKelengkapan\.js|backend/src/services/productionOrderExport\.js|backend/src/services/productionOrderList\.js|backend/src/services/productionRencanaJadwalService\.js|backend/src/services/productionWorkListService\.js|backend/src/services/unitMaterialDeclarationService\.js|backend/tests/integration/kelengkapanOrderProduksi\.integration\.test\.js|backend/tests/integration/setup/testDb\.js|backend/tests/kelengkapanOrderProduksi\.test\.js|backend/tests/releaseKelengkapan\.test\.js|frontend/src/api\.js|frontend/src/features/production/KelengkapanBagian\.jsx|frontend/src/features/production/KelengkapanBaris\.jsx|frontend/src/features/production/KelengkapanFilter\.jsx|frontend/src/features/production/OrderProduksiPanel\.jsx|frontend/src/features/production/orderProduksiModel\.js|frontend/src/pages/bengkel/ProductionWorkOrders\.jsx|frontend/tests/kelengkapanOrderProduksi\.test\.js|frontend/tests/orderProduksiAdopsi\.test\.js|frontend/tests/orderProduksiDirectList\.test\.js|scripts/gen-release-kelengkapan\.cjs|scripts/lib/gen-kunci-kelengkapan\.cjs|scripts/lib/rehearsal-kelengkapan\.mjs|scripts/lib/scan-migrasi-kelengkapan\.mjs|scripts/lib/smoke-kelengkapan\.mjs|scripts/lib/uji-kunci-kelengkapan\.sh|scripts/release-kelengkapan\.sh|scripts/rollback-guard-kelengkapan\.sh|scripts/templates/release-kelengkapan/cek-ulang-kunci\.txt|scripts/templates/release-kelengkapan/fase0-kunci\.txt|scripts/templates/release-kelengkapan/gate-prisma\.txt|scripts/templates/release-kelengkapan/guard-pasca\.txt|scripts/templates/release-kelengkapan/header\.txt|scripts/templates/release-kelengkapan/isi-pasca-switch\.txt|scripts/templates/release-kelengkapan/isi-pra-switch\.txt|scripts/templates/release-kelengkapan/keadaan\.txt|scripts/templates/release-kelengkapan/kunci\.txt|scripts/templates/release-kelengkapan/rehearsal-guard\.txt|scripts/templates/release-kelengkapan/rehearsal-migrasi\.txt|scripts/templates/release-kelengkapan/rehearsal-pra-switch\.txt|scripts/templates/release-kelengkapan/rollback\.txt|scripts/templates/release-kelengkapan/step6\.txt|scripts/templates/release-kelengkapan/struktur\.txt|scripts/templates/release-kelengkapan/uji-pra-switch\.txt|scripts/templates/release-kelengkapan/vars\.txt)$'
BACKEND_SRC_EXPECT="backend/src/lib/activityLog.js backend/src/lib/domain/kelengkapanOrderProduksi.js backend/src/routes/productionAdopsi.js backend/src/services/productionKelengkapan.js backend/src/services/productionOrderExport.js backend/src/services/productionOrderList.js backend/src/services/productionRencanaJadwalService.js backend/src/services/productionWorkListService.js backend/src/services/unitMaterialDeclarationService.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/production/KelengkapanBagian.jsx frontend/src/features/production/KelengkapanBaris.jsx frontend/src/features/production/KelengkapanFilter.jsx frontend/src/features/production/OrderProduksiPanel.jsx frontend/src/features/production/orderProduksiModel.js frontend/src/pages/bengkel/ProductionWorkOrders.jsx"
# Migrasi aditif yang SUDAH diaudit (nama + sha256 isi, LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIG_NAME="20261231110000_pernyataan_tanpa_bahan"
MIG_PIN="12bcff8a88bfd7c0adfa1372710aec3fe592c7611d9e69e1c244b674a9b9bc58"
# Hasil pemindai DDL untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":5,"create_table":1,"index":3,"index_unik":2,"index_parsial":1,"fk":1}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index dan tanpa nomor baris hunk) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="d23b022c4288adfe1664db66d839b79dace7daa8855e9107233872b8ab1914d7"
# Objek rilis yang HARUS ada di database sesudah migrasi (nama persis; dibaca dari migrasi yang dipin).
TBL_BARU="unit_material_declarations"
IDX_BARU="unit_material_declarations_pkey unit_material_declarations_idempotency_key_key unit_material_declarations_unit_id_status_idx unit_material_declarations_unit_aktif_uq"
IDX_PARSIAL="unit_material_declarations_unit_aktif_uq"
CHK_BARU="unit_material_declarations_kind_chk unit_material_declarations_status_chk unit_material_declarations_reason_chk unit_material_declarations_revoke_chk"
FK_BARU="unit_material_declarations_unit_id_fkey"
TRG_BARU=""
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
BK_DIR="$HOME/release-backups/kelengkapan-${DEPLOY_SHORT}-${TS}"
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
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (bila sudah lewat tahap migrasi: tabel pernyataan baru KOSONG terpasang, tidak berbahaya).
LANGKAH WAJIB sebelum rollback KODE setelah migrasi/switch: jalankan GUARD (baca-saja)
   bash ${NEW_DIR}/scripts/rollback-guard-kelengkapan.sh
   - exit 0 "GUARD LULUS": tidak ada pernyataan aktif; rollback kode rutin diperbolehkan.
   - exit 0 "GUARD LULUS DENGAN PERINGATAN": ada pernyataan "tanpa bahan baru" aktif. Dampak HANYA penglihatan (kode lama tidak melihat/mencabutnya; tidak ada data yang salah). Guard menulis SNAPSHOT (berkas .tsv) dan menyorot yang bertentangan dengan catatan bahan; simpan snapshot. Rollback rutin diperbolehkan.
   - exit 2 "GUARD DITOLAK": hitungan tidak terbaca/keadaan tidak dikenal — JANGAN rollback sebelum dijelaskan.
Rollback kode (tidak menghapus tabel maupun riwayat; image LAMA terbukti tetap bisa start pada DB bermigrasi):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
   Tujuan rollback = image dan folder release LIVE SEBELUM rilis ini (baseline ${BASE_SHA:0:8} yang memuat hotfix performa, penjadwalan, drawer, PO barang mirip, Export PKR); gerbang kode live membuktikan kode container == folder == baseline.
Migrasi bersifat ADITIF (1 tabel + 3 indeks + 1 FK): tabel dibiarkan terpasang setelah rollback kode, berikut seluruh baris pernyataan yang ada (tidak dihapus). Rilis ini tidak membuat pergerakan stok, Material Issue, Run, jadwal, status, biaya, jurnal, atau harga; satu-satunya tulisan baru adalah pernyataan eksplisit oleh pengguna berizin SESUDAH rilis.
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS semua perubahan sesudah backup (pernyataan, transaksi, pesan); gunakan hanya atas keputusan Owner.
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
#   - kunci sendiri  : release-kelengkapan.lock  (fd 9) — satu instansi rilis ini.
#   - kunci bersama  : release-deploy-bersama.lock (fd 7) — mutex deploy bersama; diambil ATOMIK (flock) SEBELUM memeriksa kunci lain, supaya dua proses yang mulai bersamaan tidak sama-sama lolos.
# Berkas pemilik (*.owner, bukan *.lock) hanya untuk diagnosis (pid/waktu/SHA/token); keputusan "milik sendiri" TIDAK bergantung padanya.
LOCK_DIR="${LOCK_DIR:-/tmp}"
KUNCI_SENDIRI="${LOCK_DIR}/release-kelengkapan.lock"
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
  bash -c 'exec 8>>"$1"; flock -n 8; : > "$2"; exec sleep 25' _ "$T/lock/release-kelengkapan.lock" "$T/lain.siap" & HP=$!
  tunggu_berkas "$T/lain.siap" || gagal_uji "pemegang kunci bernama sama tidak siap"
  res="$(K 'kunci_ambil' 2>&1)" && gagal_uji "instansi kedua rilis ini LOLOS saat kunci sendiri dipegang proses lain: ${res}"
  printf '%s' "$res" | grep -q 'sudah berjalan' || gagal_uji "penolakan instansi kedua bukan 'sudah berjalan': ${res}"
  res="$(K 'kunci_cek_lain; rc=$?; echo "RC=$rc LAIN=$KUNCI_LAIN"; exit $rc' 2>&1)" && gagal_uji "kunci ber-NAMA sendiri tetapi milik proses lain dilewati hanya karena namanya: ${res}"
  printf '%s' "$res" | grep -q 'LAIN=.*release-kelengkapan.lock' || gagal_uji "kunci bernama sama tidak dilaporkan: ${res}"
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
ok "schema.prisma: diff identik dengan yang diaudit (aditif: model UnitMaterialDeclaration + relasi balik pada Unit)"
[[ "$MIG_NAME" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $MIG_NAME"
ALL_SQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | tr -d '\r')"
h="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
[ "$MIG_PIN" = "$h" ] || die "isi migrasi ${MIG_NAME} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
ok "migrasi ${MIG_NAME}: sha256 cocok pin (${h:0:12})"
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai DDL migrasi rilis "Kelengkapan Order Produksi" (pernyataan tanpa bahan baru). Membaca SQL (komentar/baris kosong sudah dibuang) dari stdin.
// DAFTAR PUTIH SEMPIT: hanya objek BARU milik rilis ini (1 tabel, 3 indeks [1 unik parsial], 1 FK RESTRICT ke units). Pernyataan lain (DROP/UPDATE/INSERT/DELETE/ALTER tabel lama/GRANT/EXTENSION/fungsi/trigger) = DITOLAK.
// Keluaran (exit 0): JSON ringkas jumlah per jenis; skrip rilis membandingkannya dengan hasil yang sudah diaudit (SCAN_EXPECT).
import fs from "node:fs";

const BARU = ["unit_material_declarations"];
const REF_OK = ["units"];
const tolak = (m) => { console.error("DITOLAK: " + m); process.exit(2); };

const sql = fs.readFileSync(0, "utf8");
// pecah per pernyataan
const stmts = []; let buf = "";
for (let i = 0; i < sql.length; i++) {
  if (sql.startsWith("$$", i)) tolak("blok $$ (fungsi/trigger) tidak diizinkan pada rilis ini");
  const c = sql[i];
  if (c === ";") { if (buf.trim()) stmts.push(buf.trim()); buf = ""; } else buf += c;
}
if (buf.trim()) tolak("pernyataan terakhir tanpa titik koma");

const n = { create_table: 0, index: 0, index_unik: 0, index_parsial: 0, fk: 0 };
const tabelDibuat = new Set();
const q = (s) => s.replace(/\s+/g, " ").trim();
for (const raw of stmts) {
  const s = q(raw); let m;
  if ((m = s.match(/^CREATE TABLE "([a-z_]+)" \(/))) {
    if (!BARU.includes(m[1])) tolak("CREATE TABLE di luar daftar: " + m[1]);
    if (tabelDibuat.has(m[1])) tolak("tabel ganda: " + m[1]);
    // tidak ada FK inline/DML: isi hanya kolom + CONSTRAINT pkey/CHECK
    const isi = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
    if (/\bREFERENCES\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(isi.replace(/CHECK \(.*?\)(?=,\s*CONSTRAINT|$)/g, ""))) tolak("CREATE TABLE memuat REFERENCES/DML inline: " + m[1]);
    tabelDibuat.add(m[1]); n.create_table++; continue;
  }
  if ((m = s.match(/^CREATE (UNIQUE )?INDEX "([a-z0-9_]+)" ON "([a-z_]+)"\(([^)]*)\)( WHERE "status" = 'ACTIVE')?$/))) {
    if (!BARU.includes(m[3])) tolak("indeks pada tabel di luar rilis: " + m[3]);
    if (m[5] && !m[1]) tolak("indeks parsial harus UNIQUE");
    n.index++; if (m[1]) n.index_unik++; if (m[5]) n.index_parsial++; continue;
  }
  if ((m = s.match(/^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z0-9_]+)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "([a-z_]+)"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE$/))) {
    if (!BARU.includes(m[1])) tolak("FK pada tabel di luar rilis: " + m[1]);
    if (!REF_OK.includes(m[4])) tolak("FK ke tabel di luar daftar: " + m[4]);
    n.fk++; continue;
  }
  tolak("pernyataan di luar daftar putih: " + s.slice(0, 100));
}
if (n.create_table !== 1) tolak("harus tepat 1 CREATE TABLE");
console.log(JSON.stringify({ total: stmts.length, ...n }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (1 CREATE TABLE baru kosong, 3 indeks [2 unik, 1 parsial], 1 FK ON DELETE RESTRICT ke units); tanpa fungsi/trigger, tanpa ALTER pada tabel lama, tanpa DROP/DELETE/UPDATE/INSERT/RENAME/GRANT/EXTENSION"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE units" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "DROP TABLE tabel baru" "$(tambah_stmt 'DROP TABLE "unit_material_declarations";')"
harus_ditolak "UPDATE units (backfill)" "$(tambah_stmt "UPDATE \"units\" SET \"status\" = 'RECEIVED';")"
harus_ditolak "UPDATE stock_movements" "$(tambah_stmt 'UPDATE "stock_movements" SET "qty" = 0;')"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "units";')"
harus_ditolak "INSERT ke tabel baru (backfill)" "$(tambah_stmt "INSERT INTO \"unit_material_declarations\" (id) VALUES ('x');")"
harus_ditolak "INSERT ... SELECT ke tabel baru" "$(tambah_stmt 'INSERT INTO "unit_material_declarations" SELECT * FROM "units";')"
harus_ditolak "INSERT ke tabel lama" "$(tambah_stmt "INSERT INTO \"stock_movements\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "units";')"
harus_ditolak "ADD COLUMN pada units" "$(tambah_stmt 'ALTER TABLE "units" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada materials" "$(tambah_stmt 'ALTER TABLE "materials" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada tabel baru" "$(tambah_stmt 'ALTER TABLE "unit_material_declarations" ADD COLUMN "x" TEXT;')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "units" DROP COLUMN "status";')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "units" RENAME COLUMN "status" TO "s";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "units" ALTER COLUMN "status" TYPE TEXT;')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "salinan tabel lama (CREATE TABLE AS)" "$(tambah_stmt 'CREATE TABLE "unit_material_declarations_copy" AS SELECT * FROM "units";')"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("status");')"
harus_ditolak "indeks unik pada tabel lama" "$(tambah_stmt 'CREATE UNIQUE INDEX "x_uq" ON "stock_movements"("id");')"
harus_ditolak "FK ke tabel lain" "$(tambah_stmt 'ALTER TABLE "unit_material_declarations" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("declared_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "FK CASCADE (semua RESTRICT → CASCADE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE CASCADE/')"
harus_ditolak "FK SET NULL" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE SET NULL/')"
harus_ditolak "indeks parsial dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'unit_material_declarations_unit_aktif_uq')"
harus_ditolak "indeks parsial dilonggarkan (tanpa WHERE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ WHERE "status" = .ACTIVE.//')"
harus_ditolak "FK ke tabel lain (bukan units)" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "units"/REFERENCES "Order"/')"
harus_ditolak "tabel tanpa FK" "$(printf '%s\n' "$ALL_SQL" | grep -v 'ADD CONSTRAINT "unit_material_declarations_unit_id_fkey"')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "units" DROP CONSTRAINT "units_pkey";')"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "unit_material_declarations" TO PUBLIC;')"
harus_ditolak "REVOKE" "$(tambah_stmt 'REVOKE ALL ON "units" FROM PUBLIC;')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"UnitStatus\" ADD VALUE IF NOT EXISTS 'LIAR';")"
ok "uji negatif pemindai: ${NEG} mutan (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER lama/FK CASCADE+SET NULL/indeks parsial dibuang atau dilonggarkan/fungsi-trigger/EXTENSION/GRANT) SEMUA ditolak"

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

# Struktur objek rilis (1 tabel; isi diverifikasi terpisah lewat isi_tabel_rilis, TIDAK diasumsikan kosong; 1 FK RESTRICT; 4 CHECK; 4 indeks termasuk primary key [3 unik, 1 parsial 'satu pernyataan AKTIF per unit']) — SATU definisi dipakai production (sebelum switch) dan rehearsal.
# $1 = fungsi pembaca SQL (menerima satu argumen SQL, mencetak hasil -At), $2 = fungsi kegagalan (menerima pesan).
in_list() { local o="" x; for x in $1; do o="${o:+$o,}'$x'"; done; printf '%s' "$o"; }
struktur_baru() {
  local Q="$1" G="$2" n
  [ "$("$Q" "select count(*) from pg_tables where schemaname='public' and tablename in ($(in_list "$TBL_BARU"))")" = "1" ] || "$G" "tabel rilis (unit_material_declarations) tidak terpasang"
  n="$(printf '%s\n' $FK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$FK_BARU")) and contype='f' and confdeltype='r' and convalidated")" = "$n" ] || "$G" "${n} FK ON DELETE RESTRICT tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $CHK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$CHK_BARU")) and contype='c' and convalidated")" = "$n" ] || "$G" "${n} CHECK tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $IDX_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ($(in_list "$IDX_BARU"))")" = "$n" ] || "$G" "${n} indeks tidak terpasang"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and tablename='unit_material_declarations' and indexdef like '%UNIQUE%'")" = "3" ] || "$G" "3 indeks unik (primary key, satu Idempotency-Key, satu pernyataan aktif per unit) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ($(in_list "$IDX_PARSIAL")) and indexdef like '%UNIQUE%' and indexdef like '%WHERE%status%ACTIVE%'")" = "1" ] || "$G" "indeks unik PARSIAL 'satu pernyataan aktif per unit' tidak terpasang dengan benar"
  [ "$("$Q" "select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'unit_material_declarations' and not t.tgisinternal")" = "0" ] || "$G" "tabel rilis tidak boleh punya trigger"
}
SKEMA_SQL="select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name <> 'unit_material_declarations'"

# Klasifikasi KEADAAN production — murni, FAIL-CLOSED: selain dua keadaan yang dikenal = TOLAK.
#   SEGAR  = tabel rilis belum ada dan migrasi rilis belum terpasang; migrasi pending = tepat migrasi rilis.
#   LANJUT = migrasi rilis SUDAH terpasang: tabel rilis ada, migrasi rilis selesai (1 langkah, tidak di-rollback, checksum = berkas kandidat), tidak ada pending. Isi tabel boleh berapa saja (pernyataan pengguna sah); isinya DIBACA dan dicatat (isi_tabel_rilis), tidak diasumsikan kosong. Struktur persis divalidasi terpisah (struktur_baru).
# Argumen: ntab nisi mig_terpasang(0/1) csok(0/1) pending(teks)
tentukan_keadaan() {
  local ntab="$1" nisi="$2" terpasang="$3" csok="$4" pend="$5"
  if [ "$ntab" = "0" ] && [ "$terpasang" = "0" ]; then
    [ "$pend" = "$MIG_NAME" ] || { echo "TOLAK: migrasi pending bukan tepat migrasi rilis ini ($(printf '%s' "$pend" | tr '\n' ' '))"; return 1; }
    echo SEGAR; return 0
  fi
  if [ "$ntab" = "1" ] && [ "$terpasang" = "1" ]; then
    [ -z "$pend" ] || { echo "TOLAK: masih ada migrasi pending ($(printf '%s' "$pend" | tr '\n' ' '))"; return 1; }
    [ "$csok" = "1" ] || { echo "TOLAK: status/checksum migrasi rilis tidak sesuai berkas kandidat"; return 1; }
    [[ "$nisi" =~ ^[0-9]+$ ]] || { echo "TOLAK: isi tabel rilis tidak terbaca (${nisi})"; return 1; }
    echo LANJUT; return 0
  fi
  echo "TOLAK: keadaan campuran/tidak dikenal (tabel rilis=${ntab}, migrasi rilis terpasang=${terpasang})"; return 1
}
LQ() { psql_live -At -c "$1"; }
# Isi AKTUAL tabel rilis (dibaca, tidak diasumsikan): "ABSEN" bila tabel belum ada; selain itu "jumlah|aktif|sidik-jari-baris|daftar-id". $1 = fungsi pembaca SQL.
isi_tabel_rilis() {
  local Q="$1"
  [ "$("$Q" "select count(*) from pg_tables where schemaname='public' and tablename='unit_material_declarations'")" = "1" ] || { echo ABSEN; return 0; }
  "$Q" "select count(*)||'|'||count(*) filter (where t.status='ACTIVE')||'|'||coalesce(md5(string_agg(t::text, '~' order by t.id::text)), '-')||'|'||coalesce(string_agg(t.id::text, ',' order by t.id::text), '') from unit_material_declarations t"
}
isi_n() { case "$1" in ABSEN) echo 0;; *) echo "${1%%|*}";; esac; }
isi_aktif() { case "$1" in ABSEN) echo 0;; *) local r="${1#*|}"; echo "${r%%|*}";; esac; }
isi_fp() { case "$1" in ABSEN) echo -;; *) local r="${1#*|}"; r="${r#*|}"; echo "${r%%|*}";; esac; }
isi_ids() { case "$1" in ABSEN) echo "";; *) echo "${1##*|}";; esac; }
# Keadaan production SAAT INI (membaca production; menulis daftar ke $BK_DIR/applied-sebelum${1}.txt). Cetak SEGAR | LANJUT | "TOLAK: ..." (exit 1). Dipakai di preflight dan diulang sesaat sebelum migrasi.
keadaan_produksi() {
  local sfx="$1" ntab nisi=0 terpasang csok=0 raw row pend solo lama
  psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum${sfx}.txt" || { echo "TOLAK: gagal membaca migrasi terpasang"; return 1; }
  sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u > "$BK_DIR/cand-pra.txt"
  sg ls-tree --name-only "$BASE_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u > "$BK_DIR/base-pra.txt"
  solo="$(comm -13 "$BK_DIR/cand-pra.txt" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  [ -z "$solo" ] || { echo "TOLAK: production memiliki migrasi yang TIDAK ada di kandidat: $(printf '%s' "$solo" | tr '\n' ' ')"; return 1; }
  lama="$(grep -vxF "$MIG_NAME" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  [ "$lama" = "$(cat "$BK_DIR/base-pra.txt")" ] || { echo "TOLAK: migrasi terpasang (di luar migrasi rilis) BUKAN tepat himpunan baseline"; return 1; }
  ntab="$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename = 'unit_material_declarations'")"
  [[ "$ntab" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan tabel rilis bukan angka"; return 1; }
  if [ "$ntab" = "1" ]; then nisi="$(psql_live -At -c "select count(*) from unit_material_declarations")"; fi
  [[ "$nisi" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan isi tabel rilis bukan angka"; return 1; }
  terpasang="$(grep -Fxc "$MIG_NAME" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  raw="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | sha256sum | cut -d' ' -f1)"
  row="$(psql_live -At -c "select checksum||'|'||applied_steps_count::text||'|'||(finished_at is not null)::text||'|'||(rolled_back_at is null)::text from _prisma_migrations where migration_name='${MIG_NAME}'")"
  [ "$row" = "${raw}|1|true|true" ] && csok=1
  pend="$(comm -23 "$BK_DIR/cand-pra.txt" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  tentukan_keadaan "$ntab" "$nisi" "$terpasang" "$csok" "$pend"
}
KEADAAN="$(keadaan_produksi "")" || die "${KEADAAN}"
[ "$KEADAAN" = "SEGAR" ] || [ "$KEADAAN" = "LANJUT" ] || die "keadaan production tidak dikenal: ${KEADAAN}"
MIG_SEBELUM="$(grep -c . "$BK_DIR/base-pra.txt")"
ISI_PRA="$(isi_tabel_rilis LQ)" || die "gagal membaca isi tabel pernyataan"
{ [ "$ISI_PRA" = "ABSEN" ] || [[ "$ISI_PRA" =~ ^[0-9]+\|[0-9]+\|[0-9a-f-]+\| ]]; } || die "isi tabel pernyataan tidak terbaca: ${ISI_PRA:0:80}"
{ [ "$KEADAAN" = "SEGAR" ] && [ "$ISI_PRA" = "ABSEN" ]; } || { [ "$KEADAAN" = "LANJUT" ] && [ "$ISI_PRA" != "ABSEN" ]; } || die "keadaan ${KEADAAN} tidak cocok dengan tabel pernyataan (${ISI_PRA:0:40})"
if [ "$KEADAAN" = "LANJUT" ]; then struktur_baru LQ die; fi
ok "keadaan production: ${KEADAAN} (baseline ${MIG_SEBELUM} migrasi terpasang; migrasi rilis ${MIG_NAME} $([ "$KEADAAN" = "SEGAR" ] && echo 'pending' || echo "SUDAH terpasang: checksum, status, dan STRUKTUR cocok persis; isi tabel DIBACA: $(isi_n "$ISI_PRA") baris, $(isi_aktif "$ISI_PRA") aktif, sidik jari $(isi_fp "$ISI_PRA" | cut -c1-12)"))"
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
BACKUP_FILE="$HOME/backups/pre-kelengkapan-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Bahan belum dicatat" "Bahan perlu dicek" "HPP belum lengkap" "Data order kurang" "Kelengkapan data" "Unit ini memang tanpa bahan baru" "Paling lama belum ditangani" "Tanggal order masuk (unit dibuat)"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Buka pekerjaan" "Catat pekerjaan selesai" "Tandai sudah dikerjakan" "Harga Berlaku (HPP operasional)" "Koreksi salah input historis" "Ada stok" "Pilih meja" "Belum dijadwalkan" "Tambah pemakaian" "Koreksi saldo" "Konfirmasi Barang Jadi" "Pengeluaran Material" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-kl-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
[ "$(docker image inspect -f '{{.Id}}' "$ROLLBACK_TAG")" = "$PREV_IMG_ID" ] || die "tag rollback tidak menunjuk image live"
ok "tujuan rollback = image live ${PREV_IMG_ID:7:12} + folder ${PREV_DIR} (memuat hotfix performa, penjadwalan, drawer, PO barang mirip; terbukti gerbang kode live)"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_kelengkapan_${TS}"
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
S_SEBELUM="$(RPSQL "$SKEMA_SQL")"; [ -n "$S_SEBELUM" ] || { reh_drop; die "sidik jari skema rehearsal kosong"; }
[ "$S_SEBELUM" = "$SKEMA_PRA" ] || { reh_drop; die "skema tabel lama pada RESTORE berbeda dari produksi (backup/restore bermasalah)"; }
RH_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
if [ "$KEADAAN" = "SEGAR" ]; then
  dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$RH_URL" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
  [ "$(grep -c 'Applying migration' "$BK_DIR/migrate-rehearsal.log")" = "1" ] || { tail -n 12 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy harus menerapkan TEPAT 1 migrasi rilis"; }
else
  dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$RH_URL" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 12 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy (LANJUT) di DB rehearsal GAGAL"; }
  ! grep -q 'Applying migration' "$BK_DIR/migrate-rehearsal.log" || { reh_drop; die "keadaan LANJUT: migrate deploy MENERAPKAN sesuatu (seharusnya tidak ada yang pending)"; }
fi
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$RH_URL" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal (image baru) TIDAK 'up to date'"; }
struktur_baru RPSQL gagal_reh
ISI_REH="$(isi_tabel_rilis RPSQL)" || { reh_drop; die "gagal membaca isi tabel pernyataan pada restore"; }
if [ "$KEADAAN" = "SEGAR" ]; then [ "$(isi_n "$ISI_REH")" = "0" ] || { reh_drop; die "migrasi baru pada restore menghasilkan tabel BERISI ($(isi_n "$ISI_REH") baris): backfill dilarang"; }; else [ "$ISI_REH" = "$ISI_PRA" ] || { reh_drop; die "isi tabel pernyataan pada RESTORE ($(isi_n "$ISI_REH") baris, $(isi_fp "$ISI_REH" | cut -c1-12)) != production saat preflight ($(isi_n "$ISI_PRA") baris, $(isi_fp "$ISI_PRA" | cut -c1-12))"; }; fi
AKTIF_REH="$(isi_aktif "$ISI_REH")"
[ "$(RPSQL "$SKEMA_SQL")" = "$S_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH skema (kolom/tipe/nullable/default) tabel lama"; }
ok "image baru: migrasi rilis $([ "$KEADAAN" = "SEGAR" ] && echo 'diterapkan' || echo 'SUDAH terpasang (tidak diterapkan ulang)') pada DB rehearsal (hasil restore nyata); isi tabel pernyataan pada restore DIBACA: $(isi_n "$ISI_REH") baris (${AKTIF_REH} aktif), $([ "$KEADAAN" = "SEGAR" ] && echo 'kosong' || echo 'sama persis dengan production saat preflight'); 1 FK RESTRICT, 4 CHECK, 4 indeks (3 unik, 1 parsial) tervalidasi; tanpa trigger; skema tabel lama IDENTIK"
# Guard rollback pada keadaan KOSONG (migrasi terpasang, belum ada pernyataan) → LULUS; baca-saja.
set +e; mkdir -p "$BK_DIR/guard-awal"; GUARD_OUT1="$(GUARD_DB="$REH_DB" GUARD_OUT_DIR="$BK_DIR/guard-awal" bash "$NEW_DIR/scripts/rollback-guard-kelengkapan.sh" 2>&1)"; GUARD_RC1=$?; set -e
printf '%s
' "$GUARD_OUT1" > "$BK_DIR/guard-kosong.log"
if [ "$AKTIF_REH" = "0" ]; then
  { [ "$GUARD_RC1" = "0" ] && printf '%s' "$GUARD_OUT1" | grep -q 'GUARD LULUS' && ! printf '%s' "$GUARD_OUT1" | grep -q 'DENGAN PERINGATAN'; } || { printf '%s\n' "$GUARD_OUT1"; reh_drop; die "guard rollback TIDAK meluluskan keadaan awal tanpa pernyataan aktif"; }
  ok "guard rollback pada keadaan awal restore (tabel rilis ada, tanpa pernyataan aktif): LULUS"
else
  { [ "$GUARD_RC1" = "0" ] && printf '%s' "$GUARD_OUT1" | grep -q 'GUARD LULUS DENGAN PERINGATAN'; } || { printf '%s\n' "$GUARD_OUT1"; reh_drop; die "guard rollback TIDAK memberi PERINGATAN untuk ${AKTIF_REH} pernyataan aktif yang sudah ada pada restore"; }
  ok "guard rollback pada keadaan awal restore (${AKTIF_REH} pernyataan aktif sudah ada): LULUS DENGAN PERINGATAN (sesuai; snapshot ditulis ke ${BK_DIR}/guard-awal)"
fi
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "rehearsal MENGUBAH isi tabel"; }
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): jumlah per kategori, WAKTU RESPONS (daftar, hitungan, filter gabungan, pagination, ekspor, drawer) + deteksi permintaan per unit, skenario tulis (pernyataan, pertentangan, bersamaan, cabut); stok/Material Issue/jurnal/harga/jadwal/Run/status tidak berubah. DB dihapus di akhir.
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" -e REH_DECL_AWAL="$(isi_n "$ISI_PRA")" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-kelengkapan.log" 2>&1 || { cat "$BK_DIR/rehearsal-kelengkapan.log"; reh_drop; die "uji Kelengkapan Order Produksi terhadap salinan restore GAGAL (lihat rehearsal-kelengkapan.log)"; }
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const express = require("express");
const ExcelJS = require("exceljs");
const prisma = new PrismaClient();
// REH_SRC hanya untuk uji lokal skrip ini; di rehearsal sebenarnya kode kandidat ada di /app/src (image baru).
const imp = (p) => import(process.env.REH_SRC ? pathToFileURL(path.join(process.env.REH_SRC, p)).href : "/app/src/" + p);
process.env.JWT_SECRET ||= "rehearsal-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
const { productionRouter } = await imp("routes/production.js");
const { productionAdopsiRouter } = await imp("routes/productionAdopsi.js");
const { prisma: appPrisma } = await imp("db.js");
let operasi = 0; appPrisma.$use(async (params, next) => { operasi += 1; return next(params); }); // hitung operasi Prisma yang dipicu aplikasi (deteksi permintaan per unit)
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const ts = Date.now().toString(36); let seq = 0; const kunci = (t) => `reh-kl-${t}-${ts}-${++seq}-aaaa`;
const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

// Tabel yang TIDAK BOLEH berubah oleh fitur ini (stok, Material Issue, jurnal/valuasi Finance, harga operasional, jadwal/Run).
const TETAP = ["stock_movements", "material_issues", "material_issue_lines", "fin_journal_entries", "fin_journal_lines", "fin_stock_movement_valuations", "material_harga_berlaku", "stock_movement_biaya_operasional", "production_unit_schedules", "production_unit_schedule_events", "production_runs_v2", "production_run_plans_v2", "units", "Order"];
const fp = async (tabel) => { const o = {}; for (const t of tabel) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const beda = (a, b) => Object.keys(a).filter((t) => a[t].n !== b[t].n || a[t].h !== b[t].h);

// ── A. struktur (kode baru terhadap hasil restore nyata + migrasi) ──
const declAwal = await num("select count(*) as n from unit_material_declarations");
cek(`tabel pernyataan ada; isi awal pada restore DIBACA aktual = ${declAwal} baris (tidak diasumsikan kosong)${process.env.REH_DECL_AWAL === undefined ? "" : `; sama dengan production saat preflight (${process.env.REH_DECL_AWAL})`} — migrasi tidak mengisinya (tanpa backfill/pernyataan massal)`, process.env.REH_DECL_AWAL === undefined || declAwal === Number(process.env.REH_DECL_AWAL));
const nUnit = await num('select count(*) as n from units'); const nUnitNonBatal = await num("select count(*) as n from units where status <> 'CANCELLED'");
console.log(`INFO  salinan restore: ${nUnit} unit (${nUnitNonBatal} non-batal), ${await num("select count(*) as n from unit_usage_notes")} catatan historis, ${await num("select count(*) as n from stock_movements where type = 'ISSUE' and unit_id is not null")} ISSUE bertaut unit, ${await num("select count(*) as n from unit_provisional_usages")} pemakaian sementara`);

// ── B. pelaku (pengguna uji PADA SALINAN) + aplikasi ──
const mkUser = async (nama, role) => { const u = await prisma.user.create({ data: { name: `Uji Rehearsal ${nama}`, email: `reh-kl-${ts}-${nama}@example.test`, passwordHash: "x", role } }); await prisma.userRole.create({ data: { userId: u.id, role } }).catch(() => {}); return { ...u, token: jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [u.role] }, process.env.JWT_SECRET, { expiresIn: "2h" }) }; };
const admin = await mkUser("admin", "ADMIN"); const sales = await mkUser("sales", "SALES");
const app = express(); app.use(express.json()); app.use("/api/production", productionRouter); app.use("/api/production", productionAdopsiRouter);
const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
const BASE = `http://127.0.0.1:${server.address().port}/api/production`;
const http = async (u, method, p, body, headers = {}) => { const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(u ? { Authorization: "Bearer " + u.token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
const AKTIF = "displayStatus=PENGAMBILAN,DIPROSES,SIAP_KIRIM";

const fp0 = await fp(TETAP);
const evt0 = await num("select count(*) as n from activity_events"); const decl0 = await num("select count(*) as n from unit_material_declarations");

// ── C. jumlah per kategori pada salinan restore (BACA-SAJA) ──
const hitAktif = (await http(admin, "GET", `/work-orders/kelengkapan-hitung?${AKTIF}`)).body;
const hitSemua = (await http(admin, "GET", "/work-orders/kelengkapan-hitung")).body;
const hitRiwayat = (await http(admin, "GET", "/work-orders/kelengkapan-hitung?displayStatus=TERKIRIM")).body;
cek("hitungan server tersedia (lingkup Aktif, Semua, Terkirim)", !!hitAktif?.counts && !!hitSemua?.counts && !!hitRiwayat?.counts);
const tampil = (nama, h) => console.log(`HITUNG ${nama}: unit=${h.totalUnit} unik_berkekurangan=${h.unik} | bahan_belum_dicatat=${h.counts.BAHAN_BELUM_DICATAT} bahan_perlu_dicek=${h.counts.BAHAN_PERLU_DICEK} hpp_belum_lengkap=${h.counts.HPP_BELUM_LENGKAP} data_order_kurang=${h.counts.DATA_ORDER_KURANG} | data_order lengkap=${h.dataOrder.lengkap} kurang=${h.dataOrder.kurang} belum_dinilai=${h.dataOrder.belumDinilai}`);
tampil("AKTIF", hitAktif); tampil("TERKIRIM(riwayat)", hitRiwayat); tampil("SEMUA", hitSemua);
cek("konsistensi: total filter di daftar = hitungan server untuk SETIAP kategori (lingkup Aktif) dan gabungan = unit unik", await (async () => {
  for (const k of ["BAHAN_BELUM_DICATAT", "BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP", "DATA_ORDER_KURANG"]) { const t = (await http(admin, "GET", `/work-orders?${AKTIF}&kelengkapan=${k}&pageSize=1`)).body.total; if (t !== hitAktif.counts[k]) { console.log(`      ${k}: daftar=${t} hitung=${hitAktif.counts[k]}`); return false; } }
  return (await http(admin, "GET", `/work-orders?${AKTIF}&kelengkapan=BAHAN_BELUM_DICATAT,BAHAN_PERLU_DICEK,HPP_BELUM_LENGKAP,DATA_ORDER_KURANG&pageSize=1`)).body.total === hitAktif.unik;
})());
cek("jumlah unit Terkirim berkekurangan (riwayat) dapat ditemukan lewat lingkup Riwayat dan sama dengan hitungan", (await http(admin, "GET", "/work-orders?displayStatus=TERKIRIM&kelengkapan=BAHAN_BELUM_DICATAT,BAHAN_PERLU_DICEK,HPP_BELUM_LENGKAP,DATA_ORDER_KURANG&pageSize=1")).body.total === hitRiwayat.unik);

// aturan 1 pada data nyata: unit yang lolos HANYA karena status resmi order
{
  const lolos = []; let page = 1; let hasMore = true;
  while (hasMore && page <= 30) { const r = (await http(admin, "GET", `/work-orders?kelengkapan=BAHAN_BELUM_DICATAT&pageSize=200&page=${page}`)).body; for (const u of r.units) lolos.push(u); hasMore = r.hasMore; page += 1; }
  const resmiOrder = lolos.filter((u) => u.adopsi.kelengkapan.dasarBahan === "STATUS_RESMI_ORDER");
  console.log(`INFO  Bahan belum dicatat (semua lingkup): ${lolos.length} unit; dasar STATUS_RESMI_UNIT=${lolos.filter((u) => u.adopsi.kelengkapan.dasarBahan === "STATUS_RESMI_UNIT").length}, STATUS_RESMI_ORDER=${resmiOrder.length} (status kerja tertinggal: ${resmiOrder.map((u) => `${u.unitCode}[unit ${u.status}/order ${u.order?.status}/kerja ${u.adopsi.kerja.key}]`).join(", ") || "-"}), STATUS_KERJA=${lolos.filter((u) => u.adopsi.kelengkapan.dasarBahan === "STATUS_KERJA").length}`);
  cek("aturan 1: unit pada order Siap Kirim/Dikirim/Terkirim tetapi unitnya tertinggal TIDAK lolos dari filter", (await prisma.$queryRawUnsafe(`select count(*)::int n from units u join "Order" o on o.id = u.order_id where u.status in ('RECEIVED','IN_PRODUCTION') and o.status::text in ('READY','SHIPPING','DELIVERED')`))[0].n === resmiOrder.length + (await prisma.$queryRawUnsafe(`select count(*)::int n from units u join "Order" o on o.id = u.order_id where u.status in ('RECEIVED','IN_PRODUCTION') and o.status::text in ('READY','SHIPPING','DELIVERED') and (exists (select 1 from stock_movements s where s.unit_id = u.id and s.type = 'ISSUE') or exists (select 1 from unit_provisional_usages p where p.unit_id = u.id and p.status <> 'DIBATALKAN') or exists (select 1 from unit_usage_notes c where c.unit_id = u.id and c.state <> 'TIDAK_DIHITUNG'))`))[0].n);
  cek("aturan 2: seluruh data order non-PKR berstatus BELUM_DINILAI (tidak ada yang 'lengkap' tanpa aturan)", hitSemua.dataOrder.belumDinilai > 0 && hitSemua.dataOrder.lengkap + hitSemua.dataOrder.kurang === (await num(`select count(*) as n from units u join "Order" o on o.id = u.order_id where u.status <> 'CANCELLED' and o.penjualan_karyawan_id is not null`)));
}

// ── D. WAKTU RESPONS + deteksi permintaan per unit ──
const ukur = async (nama, fn, { ulang = 5, batas = 10000 } = {}) => {
  const waktu = []; let ops0 = 0; let ukuran = 0;
  for (let i = 0; i < ulang + 1; i++) { operasi = 0; const t0 = process.hrtime.bigint(); const r = await fn(); waktu.push(ms(t0)); if (i === 0) ops0 = operasi; ukuran = r?.ukuran ?? ukuran; if (r && r.ok === false) { cek(`respons ${nama} berhasil`, false, JSON.stringify(r).slice(0, 200)); return null; } }
  const dingin = waktu[0]; const hangat = waktu.slice(1).sort((a, b) => a - b); const p50 = hangat[Math.floor(hangat.length / 2)]; const maks = Math.max(...waktu);
  console.log(`WAKTU ${nama.padEnd(70)} dingin=${String(dingin).padStart(5)} ms | hangat p50=${String(p50).padStart(5)} ms maks=${String(Math.max(...hangat)).padStart(5)} ms | operasi DB=${ops0}${ukuran ? ` | ${ukuran} byte` : ""}`);
  cek(`waktu ${nama} di bawah batas ${batas} ms (maks ${maks} ms)`, maks < batas);
  return { dingin, p50, maks, ops: ops0 };
};
const get = async (p) => { const r = await http(admin, "GET", p); return { ok: r.status === 200, total: r.body?.total, n: r.body?.units?.length }; };
const ekspor = async (q) => { const r = await fetch(BASE + `/work-orders/export.xlsx${q}`, { headers: { Authorization: "Bearer " + admin.token } }); const b = Buffer.from(await r.arrayBuffer()); return { ok: r.status === 200 && b.length > 1000, ukuran: b.length, buf: b }; };
const gab = "kelengkapan=BAHAN_BELUM_DICATAT,BAHAN_PERLU_DICEK,HPP_BELUM_LENGKAP,DATA_ORDER_KURANG";
const dari90 = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10); const hariIni = new Date().toISOString().slice(0, 10);
const t1 = await ukur("daftar Aktif halaman 1 (50 baris, tanpa filter kelengkapan)", () => get(`/work-orders?${AKTIF}&pageSize=50`));
const t10 = await ukur("daftar Aktif halaman 1 (10 baris)", () => get(`/work-orders?${AKTIF}&pageSize=10`));
cek(`TANPA permintaan per unit: operasi DB daftar 50 baris (${t1?.ops}) ≈ 10 baris (${t10?.ops}) — selisih ≤ 4`, !!t1 && !!t10 && Math.abs(t1.ops - t10.ops) <= 4 && t1.ops < 120);
const t200 = await ukur("daftar Aktif 200 baris (batas halaman)", () => get(`/work-orders?${AKTIF}&pageSize=200`));
cek(`TANPA permintaan per unit: operasi DB 200 baris (${t200?.ops}) ≈ 10 baris (${t10?.ops}) — selisih ≤ 4`, !!t200 && !!t10 && Math.abs(t200.ops - t10.ops) <= 4);
await ukur("hitungan kelengkapan lingkup Aktif", async () => ({ ok: (await http(admin, "GET", `/work-orders/kelengkapan-hitung?${AKTIF}`)).status === 200 }));
await ukur("hitungan kelengkapan lingkup Semua (seluruh unit)", async () => ({ ok: (await http(admin, "GET", "/work-orders/kelengkapan-hitung")).status === 200 }));
await ukur("filter tunggal Bahan belum dicatat — halaman 1 (50)", () => get(`/work-orders?${AKTIF}&kelengkapan=BAHAN_BELUM_DICATAT&pageSize=50&page=1`));
await ukur("filter tunggal Bahan belum dicatat — halaman 2 (pagination)", () => get(`/work-orders?${AKTIF}&kelengkapan=BAHAN_BELUM_DICATAT&pageSize=50&page=2`));
await ukur("filter tunggal Bahan belum dicatat — lingkup Semua halaman 3", () => get(`/work-orders?kelengkapan=BAHAN_BELUM_DICATAT&pageSize=50&page=3`));
await ukur("filter GABUNGAN 4 kategori × lingkup Semua × urut terlama — halaman 1", () => get(`/work-orders?${gab}&urut=terlama&pageSize=50&page=1`));
await ukur("filter GABUNGAN × status kerja Selesai × periode 90 hari × terlama — halaman 2", () => get(`/work-orders?${gab}&statusKerja=SELESAI&dari=${dari90}&sampai=${hariIni}&urut=terlama&pageSize=50&page=2`));
await ukur("filter GABUNGAN × pencarian teks × periode", () => get(`/work-orders?${gab}&q=RES-&dari=${dari90}&sampai=${hariIni}&pageSize=50`));
await ukur("ekspor Excel dengan filter gabungan (periode 90 hari, terlama)", () => ekspor(`?${gab}&dari=${dari90}&sampai=${hariIni}&urut=terlama`), { ulang: 2, batas: 30000 });
const eksporSemua = await ukur("ekspor Excel SEMUA unit (tanpa filter)", () => ekspor(""), { ulang: 2, batas: 30000 });
{ const x = await ekspor(`?${gab}`); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf); const ws = wb.getWorksheet("Ringkasan Unit");
  const semuaTotal = (await http(admin, "GET", `/work-orders?${gab}&pageSize=1`)).body.total;
  cek(`ekspor = daftar yang sama: baris ekspor (${ws.rowCount - 1}) = total daftar (${semuaTotal}) untuk filter gabungan`, ws.rowCount - 1 === semuaTotal); }
{ const contoh = (await http(admin, "GET", `/work-orders?${gab}&pageSize=3`)).body.units;
  let i = 0; await ukur("drawer unit (adopsi + kelengkapan + pernyataan) — satu unit", async () => ({ ok: (await http(admin, "GET", `/units/${contoh[i++ % contoh.length].id}/adopsi`)).status === 200 }), { ulang: 3 }); }

// ── E. BACA-SAJA: seluruh pengukuran di atas tidak menulis apa pun ──
const fp1 = await fp(TETAP);
cek("daftar/hitungan/filter/ekspor/drawer BACA-SAJA: tabel stok, Material Issue, jurnal, harga, jadwal/Run, unit, order IDENTIK; tidak ada peristiwa audit baru", beda(fp0, fp1).length === 0 && (await num("select count(*) as n from activity_events")) === evt0 && (await num("select count(*) as n from unit_material_declarations")) === decl0, beda(fp0, fp1).join(","));

// ── F. pernyataan + pertentangan + bersamaan, PADA SALINAN ──
// utamakan unit BELUM terkirim (pencatatan sementara pada unit terkirim butuh alasan pembetulan); cadangan: unit terkirim dengan alasan pembetulan + tanggal hari ini (WIB)
const semuaKand = (await http(admin, "GET", `/work-orders?kelengkapan=BAHAN_BELUM_DICATAT&pageSize=200`)).body.units.filter((u) => u.status !== "CANCELLED");
const urutKand = process.env.REH_URUT === "terkirim" ? (a, b) => (b.status === "DELIVERED") - (a.status === "DELIVERED") : (a, b) => (a.status === "DELIVERED") - (b.status === "DELIVERED");
const kandidat = [...semuaKand].sort(urutKand).slice(0, 12);
const tglWib = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); const pembetulan = { alasanPembetulan: "Uji rehearsal pada salinan restore", tanggalPemakaian: tglWib };
cek(`tersedia unit nyata 'Bahan belum dicatat' pada salinan untuk skenario tulis (${kandidat.length}; belum terkirim: ${kandidat.filter((u) => u.status !== "DELIVERED").length})`, kandidat.length >= 6);
const [uA, uB, ...sisa] = kandidat; const hitung0 = (await http(admin, "GET", "/work-orders/kelengkapan-hitung")).body;
const url = (u) => `/units/${u.id}/pernyataan-tanpa-bahan`;
const bukti = async (u) => (await http(admin, "GET", `/work-orders?q=${encodeURIComponent(u.unitCode)}&pageSize=5`)).body.units.find((x) => x.id === u.id);
const f1 = await http(admin, "POST", url(uA), { alasan: "ok" }, { "Idempotency-Key": kunci("a") }); cek("alasan terlalu pendek ditolak (400)", f1.status === 400);
const f2 = await http(admin, "POST", url(uA), { alasan: "Rehearsal: hanya servis, tanpa bahan" }, { "Idempotency-Key": kunci("a") }); cek("pernyataan disimpan (201) atas nama pengguna uji", f2.status === 201 && f2.body.pernyataan.status === "ACTIVE");
const sudah = await bukti(uA); cek("unit yang dinyatakan hilang dari 'Bahan belum dicatat'; dasar bahan & HPP-karena-bahan ikut hilang", !sudah.adopsi.kelengkapan.keys.includes("BAHAN_BELUM_DICATAT") && !sudah.adopsi.kelengkapan.keys.includes("HPP_BELUM_LENGKAP"));
const hitung1 = (await http(admin, "GET", "/work-orders/kelengkapan-hitung")).body; cek("hitungan 'Bahan belum dicatat' turun tepat 1 setelah pernyataan", hitung1.counts.BAHAN_BELUM_DICATAT === hitung0.counts.BAHAN_BELUM_DICATAT - 1);
cek("Sales ditolak (403) menyatakan", (await http(sales, "POST", url(uB), { alasan: "Sales mencoba menyatakan" }, { "Idempotency-Key": kunci("s") })).status === 403);
// pertentangan: pernyataan lalu catatan sementara ditambahkan kemudian
const p1 = await http(admin, "POST", url(uB), { alasan: "Rehearsal: pernyataan lalu bahan dicatat" }, { "Idempotency-Key": kunci("b") }); cek("pernyataan unit B disimpan", p1.status === 201);
const s1 = await http(admin, "POST", `/units/${uB.id}/provisional-usages`, { name: "BAHAN REHEARSAL BELUM DI KATALOG", qty: 1, uom: "KG", originNote: "Beli sendiri", alasanPencatatan: "Uji rehearsal pada salinan", ...pembetulan }, { "Idempotency-Key": kunci("sem") }); cek("catatan bahan sementara ditambahkan SESUDAH pernyataan (201)", s1.status === 201, JSON.stringify(s1.body).slice(0, 120));
const kb = await bukti(uB); cek("pernyataan BERTENTANGAN terdeteksi: Bahan perlu dicek (PERNYATAAN_BERTENTANGAN); tidak tersembunyi", kb.adopsi.kelengkapan.pernyataanBertentangan === true && kb.adopsi.kelengkapan.keys.includes("BAHAN_PERLU_DICEK") && kb.adopsi.kelengkapan.items.BAHAN_PERLU_DICEK.alasan[0].kode === "PERNYATAAN_BERTENTANGAN");
// bersamaan: pernyataan vs pencatatan sementara, beberapa unit
const hasilBersamaan = [];
for (const u of sisa.slice(0, 4)) {
  const [p, c] = await Promise.all([http(admin, "POST", url(u), { alasan: "Rehearsal bersamaan: tanpa bahan" }, { "Idempotency-Key": kunci("p") }), http(admin, "POST", `/units/${u.id}/provisional-usages`, { name: `BAHAN BERSAMAAN ${u.unitCode}`, qty: 1, uom: "KG", originNote: "Beli sendiri", alasanPencatatan: "Uji bersamaan rehearsal", ...pembetulan }, { "Idempotency-Key": kunci("c") })]);
  const k = (await bukti(u)).adopsi.kelengkapan; const aktif = await num(`select count(*) as n from unit_material_declarations where unit_id = '${u.id}' and status = 'ACTIVE'`);
  const konsisten = c.status === 201 && !k.keys.includes("BAHAN_BELUM_DICATAT") && (aktif === 1 ? p.status === 201 && k.pernyataanBertentangan === true && k.keys.includes("BAHAN_PERLU_DICEK") : p.status === 409 && !k.pernyataanBertentangan);
  hasilBersamaan.push(`${p.status}/${c.status}${konsisten ? "" : "!"}`); if (!konsisten) cek(`bersamaan ${u.unitCode} konsisten`, false, JSON.stringify({ p: p.status, c: c.status, aktif, keys: k.keys }));
}
cek(`pernyataan & pencatatan BERSAMAAN (4 unit nyata): hasil akhir selalu konsisten (${hasilBersamaan.join(" ")})`, hasilBersamaan.every((x) => !x.endsWith("!")));
// pencabutan: baris tidak dihapus
const cb = await http(admin, "POST", `${url(uA)}/cabut`, { alasan: "Rehearsal: pencabutan" }); cek("pencabutan dengan alasan berhasil; baris tidak dihapus", cb.status === 200 && (await num(`select count(*) as n from unit_material_declarations where unit_id = '${uA.id}'`)) === 1 && (await bukti(uA)).adopsi.kelengkapan.keys.includes("BAHAN_BELUM_DICATAT"));
// Sesudah skenario DIBIARKAN: pernyataan aktif pada unit B (bertentangan) + unit-unit bersamaan, supaya guard rollback diuji pada keadaan NYATA.
console.log(`INFO  sisa keadaan untuk guard: pernyataan AKTIF=${await num("select count(*) as n from unit_material_declarations where status = 'ACTIVE'")}, total baris=${await num("select count(*) as n from unit_material_declarations")}`);

// ── G. invarian: skenario tulis TIDAK menyentuh stok/Material Issue/jurnal/harga/jadwal/Run/status unit-order ──
const fp2 = await fp(TETAP);
cek("sesudah skenario tulis: stok, Material Issue, jurnal, valuasi, harga, biaya operasional, jadwal/Run, unit, order IDENTIK dengan sebelum", beda(fp0, fp2).length === 0, beda(fp0, fp2).join(","));
cek("skenario tulis hanya menambah: pernyataan, pemakaian sementara, dan peristiwa audit", (await num("select count(*) as n from unit_provisional_usages where recorded_by = '" + admin.id + "'")) >= 1 && (await num("select count(*) as n from activity_events")) > evt0);
console.log(`\nPEMERIKSAAN=${n} gagal=${gagal}`);
server.close(); await prisma.$disconnect(); await appPrisma.$disconnect();
process.exit(gagal ? 1 : 0);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-kelengkapan.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-kelengkapan.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-kelengkapan.log")"
# Guard rollback SESUDAH skenario rehearsal (pernyataan aktif, termasuk yang BERTENTANGAN, SENGAJA dibiarkan di DB sementara) → LULUS DENGAN PERINGATAN + snapshot; baca-saja.
GFP_SQL="select (select count(*) from unit_material_declarations)||'/'||(select count(*) from stock_movements)||'/'||(select count(*) from unit_provisional_usages)"
GFP0="$( { RPSQL "$FP_SQL" | LC_ALL=C sort; RPSQL "$GFP_SQL"; } | md5sum )"
GUARD_DIR2="$BK_DIR/guard-snapshot"; mkdir -p "$GUARD_DIR2"
set +e; GUARD_OUT2="$(GUARD_DB="$REH_DB" GUARD_OUT_DIR="$GUARD_DIR2" bash "$NEW_DIR/scripts/rollback-guard-kelengkapan.sh" 2>&1)"; GUARD_RC2=$?; set -e
printf '%s\n' "$GUARD_OUT2" > "$BK_DIR/guard-peringatan.log"
GFP1="$( { RPSQL "$FP_SQL" | LC_ALL=C sort; RPSQL "$GFP_SQL"; } | md5sum )"
[ "$GUARD_RC2" = "0" ] || { printf '%s\n' "$GUARD_OUT2"; reh_drop; die "guard rollback gagal (exit ${GUARD_RC2}) pada keadaan yang seharusnya LULUS DENGAN PERINGATAN"; }
for t in 'GUARD LULUS DENGAN PERINGATAN' 'TIDAK TERLIHAT' 'TIDAK DAPAT dicabut' 'BERTENTANGAN dengan catatan bahan' 'SNAPSHOT pernyataan aktif' 'rollback kode rutin DIPERBOLEHKAN'; do printf '%s' "$GUARD_OUT2" | grep -q -- "$t" || { printf '%s\n' "$GUARD_OUT2"; reh_drop; die "pesan guard tidak memuat: $t"; }; done
SNAP_N="$(cat "$GUARD_DIR2"/pernyataan-tanpa-bahan-aktif-*.tsv 2>/dev/null | grep -c . || true)"
[ "$SNAP_N" = "$(RPSQL "select count(*) from unit_material_declarations where status = 'ACTIVE'")" ] && [ "$SNAP_N" -ge 1 ] || { reh_drop; die "snapshot guard (${SNAP_N} baris) != jumlah pernyataan aktif pada DB sementara"; }
[ "$GFP0" = "$GFP1" ] || { reh_drop; die "guard rollback MENGUBAH data (harus baca-saja)"; }
# IMAGE LAMA (sebelum rilis) harus tetap bisa start pada DB yang sudah bermigrasi + berisi pernyataan: migrate deploy image lama tidak boleh gagal dan tidak boleh menerapkan apa pun.
docker run --rm --network "${PROJECT}_default" -e DATABASE_URL="$RH_URL" "$ROLLBACK_TAG" sh -c 'cd /app && npx prisma migrate deploy' </dev/null > "$BK_DIR/image-lama-migrate.log" 2>&1 || { tail -n 15 "$BK_DIR/image-lama-migrate.log"; reh_drop; die "IMAGE LAMA gagal 'prisma migrate deploy' pada DB yang sudah bermigrasi — rollback kode akan gagal start"; }
! grep -q 'Applying migration' "$BK_DIR/image-lama-migrate.log" || { reh_drop; die "image lama MENERAPKAN migrasi pada DB bermigrasi (tidak boleh)"; }
[ "$(RPSQL "select count(*) from unit_material_declarations where status = 'ACTIVE'")" = "$SNAP_N" ] || { reh_drop; die "image lama mengubah pernyataan"; }
ok "guard rollback: LULUS DENGAN PERINGATAN (${SNAP_N} pernyataan aktif; snapshot ditulis; yang bertentangan disorot; rollback rutin diperbolehkan); data tidak berubah oleh guard; IMAGE LAMA tetap start (migrate deploy tanpa error, tanpa menerapkan apa pun)"
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi; uji tulis (pernyataan/pertentangan/bersamaan/cabut) dilakukan HANYA pada salinan lalu DB sementara dihapus"
PHASE="5c-uji-pra-switch"; say "5c. Uji fase pra-switch (TANPA switch): kunci sendiri/lain, bagian kritis, baseline bergeser; lalu gerbang yang SAMA dengan fase 7 pada production nyata"
uji_gerbang_kunci
uji_baseline_bergeser
tidak_ada_deploy_lain_lagi
gerbang_kode_live "rehearsal-pra-switch"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama rehearsal"
[ "$(isi_tabel_rilis LQ)" = "$ISI_PRA" ] || die "isi tabel pernyataan production berubah selama rehearsal"
ok "fase pra-switch teruji: kunci/bagian kritis/baseline bergeser (terisolasi) + gerbang fase 7 pada production nyata LULUS tanpa switch; isi tabel pernyataan tidak berubah"
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
COUNT_SQL="select 'schedules', count(*) from production_unit_schedules union all select 'schedule_events', count(*) from production_unit_schedule_events union all select 'run_plans_v2', count(*) from production_run_plans_v2 union all select 'runs_v2', count(*) from production_runs_v2 union all select 'stock_movements', count(*) from stock_movements union all select 'material_issues', count(*) from material_issues union all select 'material_issue_lines', count(*) from material_issue_lines union all select 'unit_provisional_usages', count(*) from unit_provisional_usages union all select 'harga_berlaku', count(*) from material_harga_berlaku union all select 'jurnal', count(*) from fin_journal_entries union all select 'jurnal_baris', count(*) from fin_journal_lines"
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pra-switch.txt" || die "hitung baris pra-switch gagal"; ok "pra-switch: hitung baris jadwal/Run/stok/pemakaian/harga/jurnal dicatat"
# Keadaan production diputuskan ULANG sesaat sebelum bertindak: harus sama dengan preflight (tidak ada sesi lain yang menerapkan/mengubah migrasi).
KEADAAN2="$(keadaan_produksi "2")" || die "${KEADAAN2}"
[ "$KEADAAN2" = "$KEADAAN" ] || die "keadaan production berubah sejak preflight (${KEADAAN} → ${KEADAAN2})"
ISI_PRA2="$(isi_tabel_rilis LQ)" || die "gagal membaca ulang isi tabel pernyataan"
[ "$ISI_PRA2" = "$ISI_PRA" ] || die "isi tabel pernyataan BERUBAH sejak preflight ($(isi_n "$ISI_PRA") → $(isi_n "$ISI_PRA2") baris; sidik jari $(isi_fp "$ISI_PRA" | cut -c1-12) → $(isi_fp "$ISI_PRA2" | cut -c1-12)) — berhenti, ulangi preflight"
cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sebelum2.txt" || die "daftar migrasi terpasang berubah selama persiapan (sesi lain menerapkan migrasi) — berhenti, ulangi preflight"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-migrasi.txt" || die "sidik jari beku pra-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH sebelum migrasi"; }
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema tabel lama produksi berubah sejak preflight"
if [ "$KEADAAN" = "SEGAR" ]; then
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
else
  # LANJUT: migrasi SUDAH terpasang dan terbukti (checksum, status, struktur persis; isi tabel dibaca dan tidak berubah). TIDAK menjalankan migrate deploy, TIDAK menerapkan ulang, TIDAK menyentuh tabel: hanya membaca status.
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | tee "$BK_DIR/migrate-status-lanjut.log" | grep -i 'up to date' >/dev/null || die "keadaan LANJUT: migrate status production tidak 'up to date'"
fi
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang != baseline + 1 ($(( MIG_SEBELUM + 1 )))"
psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${MIG_NAME}'" | grep -Fx t >/dev/null || die "${MIG_NAME} tidak tercatat selesai"
struktur_baru LQ die
ISI_PASCA_MIG="$(isi_tabel_rilis LQ)" || die "gagal membaca isi tabel pernyataan pasca-tahap migrasi"
if [ "$KEADAAN" = "SEGAR" ]; then [ "$(isi_n "$ISI_PASCA_MIG")" = "0" ] || die "tabel rilis TIDAK kosong tepat setelah migrasi baru (backfill/pernyataan massal dilarang): $(isi_n "$ISI_PASCA_MIG") baris"; else [ "$ISI_PASCA_MIG" = "$ISI_PRA" ] || die "isi tabel pernyataan BERUBAH pada tahap LANJUT (seharusnya hanya dibaca)"; fi
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema tabel lama BERUBAH oleh migrasi (jangan switch)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah tahap migrasi"
ok "migrasi $([ "$KEADAAN" = "SEGAR" ] && echo "diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 )))" || echo "SUDAH terpasang (${MIG_SEBELUM} + 1), TIDAK diterapkan ulang"); isi tabel pernyataan DIBACA: $(isi_n "$ISI_PASCA_MIG") baris ($(isi_aktif "$ISI_PASCA_MIG") aktif, sidik jari $(isi_fp "$ISI_PASCA_MIG" | cut -c1-12)); struktur lengkap tervalidasi; skema tabel lama identik; backend lama tetap sehat"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari beku pasca-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh tahap migrasi (jangan switch)"; }
ok "pasca-tahap-migrasi sebelum switch: dokumen pembanding beku IDENTIK"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
tidak_ada_deploy_lain_lagi
gerbang_kode_live "fase-7-tepat-sebelum-switch"
ISI_SEBELUM_SWITCH="$(isi_tabel_rilis LQ)" || die "gagal membaca isi tabel pernyataan tepat sebelum switch"
[ "$ISI_SEBELUM_SWITCH" = "$ISI_PRA" ] || die "isi tabel pernyataan BERUBAH sejak preflight ($(isi_n "$ISI_PRA") → $(isi_n "$ISI_SEBELUM_SWITCH") baris) — berhenti sebelum switch"
SMOKE_DECL_N="$(isi_n "$ISI_SEBELUM_SWITCH")"; SMOKE_DECL_FP="$(isi_fp "$ISI_SEBELUM_SWITCH")"; SMOKE_DECL_IDS="$(isi_ids "$ISI_SEBELUM_SWITCH")"
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
ok "objek rilis terpasang di produksi: struktur persis (1 FK RESTRICT, 4 CHECK, 4 indeks [3 unik, 1 parsial]) tervalidasi; tanpa trigger"
ISI_PASCA="$(isi_tabel_rilis PSQLN)" || die "gagal membaca isi tabel pernyataan sesudah switch"
HADIR="$(PSQLN "select count(*) from unit_material_declarations where id::text = any(string_to_array('$(isi_ids "$ISI_SEBELUM_SWITCH")', ','))")"
[ "$HADIR" = "$(isi_n "$ISI_SEBELUM_SWITCH")" ] || die "baris pernyataan yang ada sebelum switch HILANG sesudah switch (${HADIR}/$(isi_n "$ISI_SEBELUM_SWITCH"))"
[ "$(isi_n "$ISI_PASCA")" -ge "$(isi_n "$ISI_SEBELUM_SWITCH")" ] || die "jumlah baris pernyataan BERKURANG sesudah switch"
if [ "$(isi_n "$ISI_PASCA")" = "$(isi_n "$ISI_SEBELUM_SWITCH")" ]; then [ "$ISI_PASCA" = "$ISI_SEBELUM_SWITCH" ] || die "isi tabel pernyataan BERUBAH oleh switch (jumlah sama tetapi sidik jari berbeda)"; fi
ok "isi tabel pernyataan DIBACA aktual: sebelum switch $(isi_n "$ISI_SEBELUM_SWITCH") baris ($(isi_aktif "$ISI_SEBELUM_SWITCH") aktif, sidik jari $(isi_fp "$ISI_SEBELUM_SWITCH" | cut -c1-12)); sesudah switch $(isi_n "$ISI_PASCA") baris; semua baris lama masih ada; $([ "$(isi_n "$ISI_PASCA")" = "$(isi_n "$ISI_SEBELUM_SWITCH")" ] && echo 'IDENTIK byte-per-baris' || echo 'penambahan hanya dari pengguna sesudah switch')"
set +e; GUARD_PROD="$(GUARD_OUT_DIR="$BK_DIR" bash "$NEW_DIR/scripts/rollback-guard-kelengkapan.sh" 2>&1)"; GUARD_PROD_RC=$?; set -e
printf '%s\n' "$GUARD_PROD" | sed 's/^/        guard: /'
[ "$GUARD_PROD_RC" = "0" ] || die "guard rollback produksi pasca-switch gagal (exit ${GUARD_PROD_RC})"
ok "guard rollback (baca-saja) di produksi: $(if printf '%s' "$GUARD_PROD" | grep -q 'DENGAN PERINGATAN'; then echo "LULUS DENGAN PERINGATAN (ada pernyataan aktif; snapshot ditulis di ${BK_DIR})"; else echo 'LULUS (tidak ada pernyataan aktif)'; fi); guard hanya MENILAI dan tidak pernah memicu rollback; keputusan pemulihan spesifik tetap meminta persetujuan Owner"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
# hitung baris pasca-switch vs pra-switch (informasi: pengguna sungguhan bisa menulis selama jendela rilis; skrip ini sendiri tidak menulis apa pun)
psql_live -At -c "$COUNT_SQL" > "$BK_DIR/hitung-pasca-switch.txt" || die "hitung baris pasca-switch gagal"
if diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" >/dev/null; then ok "hitung baris jadwal/Run/stok/pemakaian/harga/jurnal IDENTIK sebelum vs sesudah switch"; else warn "hitung baris berbeda sebelum vs sesudah switch (kemungkinan aktivitas pengguna sungguhan selama jendela rilis; skrip tidak menulis):"; diff "$BK_DIR/hitung-pra-switch.txt" "$BK_DIR/hitung-pasca-switch.txt" | sed 's/^/        /' || true; fi
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin (401/403), hitungan kelengkapan = total filter di daftar, filter gabungan + urut terlama, drawer = daftar, ekspor, periode terbalik 400, penulisan ditolak sebelum menyentuh data; isi tabel rilis dibaca aktual dan tidak berubah oleh rilis; tidak ada jejak tulis"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" -e SMOKE_DECL_N="$SMOKE_DECL_N" -e SMOKE_DECL_FP="$SMOKE_DECL_FP" -e SMOKE_DECL_IDS="$SMOKE_DECL_IDS" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000"; // SMOKE_BASE/REH_SRC hanya untuk uji lokal skrip ini
const imp = (p) => import(process.env.REH_SRC ? pathToFileURL(path.join(process.env.REH_SRC, p)).href : "/app/src/" + p);
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const { ROLE_PERMISSIONS } = await imp("constants/permissions.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function userDengan(rolesAda, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if ([...rolesAda].some((r) => rs.has(r)) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
const admin = await userDengan(["ADMIN", "OWNER"], new Set());
const sales = await userDengan(["SALES"], new Set(["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "PRODUCTION_LEAD"]));
if (!admin) { rec("akun ADMIN/OWNER tersedia", false); process.exit(1); }
const tA = await tokenUntuk(admin); const tS = sales ? await tokenUntuk(sales) : null;
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const get = async (p, token) => { const t0 = Date.now(); const r = await fetch(BASE + p, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j, ms: Date.now() - t0 }; };
const post = async (p, token, body = {}, headers = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...headers }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const TABEL = ["stock_movements", "material_issues", "material_issue_lines", "fin_journal_entries", "fin_journal_lines", "material_harga_berlaku", "stock_movement_biaya_operasional", "production_unit_schedules", "production_unit_schedule_events", "production_runs_v2", "unit_provisional_usages", "unit_material_declarations", "units", "Order"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const sebelum = await fp();
const evt0 = await hitung("select count(*) as n from activity_events");

{
  // Isi tabel pernyataan DIBACA aktual dan dibandingkan dengan keadaan sebelum switch (SMOKE_DECL_* dari skrip rilis); tidak diasumsikan kosong.
  const nSkrg = await hitung("select count(*) as n from unit_material_declarations");
  const n0 = process.env.SMOKE_DECL_N === undefined || process.env.SMOKE_DECL_N === "" ? null : Number(process.env.SMOKE_DECL_N);
  const ids0 = (process.env.SMOKE_DECL_IDS || "").split(",").filter(Boolean);
  if (n0 === null) skip("isi tabel pernyataan vs sebelum switch", "SMOKE_DECL_N tidak diberikan (uji lokal)");
  else {
    const hadir = ids0.length ? (await prisma.$queryRawUnsafe('select count(*)::int n from unit_material_declarations where id::text = any($1::text[])', ids0))[0].n : 0;
    rec(`tabel pernyataan: ${n0} baris sebelum switch (dibaca aktual) — semuanya masih ada (${hadir}/${n0}); sekarang ${nSkrg} baris${nSkrg > n0 ? " (penambahan = pernyataan pengguna SESUDAH switch, bukan dari skrip rilis)" : ""}`, hadir === n0 && nSkrg >= n0);
    if (nSkrg === n0 && process.env.SMOKE_DECL_FP) {
      const fp = (await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(t::text, '~' order by t.id::text)), '-') h from unit_material_declarations t"))[0].h;
      rec("isi tabel pernyataan IDENTIK byte-per-baris dengan sebelum switch (rilis tidak mengubah/menghapus/mengisi)", fp === process.env.SMOKE_DECL_FP, fp.slice(0, 12));
    }
  }
}
rec("izin kode berjalan: pernyataan memakai izin Rute Unit (Admin/Owner/Kepala Produksi), bukan Sales", (ROLE_PERMISSIONS.ADMIN ?? []).includes("unit:routing:write") && !(ROLE_PERMISSIONS.SALES ?? []).includes("unit:routing:write"));
// tanpa token
for (const [m, p] of [["GET", "/api/production/work-orders/kelengkapan-hitung"], ["GET", "/api/production/work-orders?kelengkapan=BAHAN_BELUM_DICATAT"], ["GET", "/api/production/units/00000000-0000-4000-8000-000000000000/pernyataan-tanpa-bahan"]]) rec(`${m} ${p.split("?")[0]} tanpa token = 401`, (await get(p)).status === 401);
rec("POST pernyataan tanpa token = 401", (await post("/api/production/units/00000000-0000-4000-8000-000000000000/pernyataan-tanpa-bahan", null, { alasan: "tanpa token" }, { "Idempotency-Key": "smoke-tanpa-token-0001" })).status === 401);
// hitungan + konsistensi dengan daftar
const AKTIF = "displayStatus=PENGAMBILAN,DIPROSES,SIAP_KIRIM";
const h = await get(`/api/production/work-orders/kelengkapan-hitung?${AKTIF}`, tA);
rec(`hitungan kelengkapan (Aktif) terbaca dalam ${h.ms} ms`, h.status === 200 && !!h.json?.counts && Number.isInteger(h.json.unik) && !!h.json.dataOrder, `unik=${h.json?.unik} counts=${JSON.stringify(h.json?.counts)}`);
if (h.status === 200) {
  let sama = true; for (const k of ["BAHAN_BELUM_DICATAT", "BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP", "DATA_ORDER_KURANG"]) { const l = await get(`/api/production/work-orders?${AKTIF}&kelengkapan=${k}&pageSize=1`, tA); if (l.status !== 200 || l.json.total !== h.json.counts[k]) { sama = false; console.log(`        ${k}: daftar=${l.json?.total} hitung=${h.json.counts[k]}`); } }
  rec("total filter di daftar = hitungan server untuk setiap kategori", sama);
  const g = await get(`/api/production/work-orders?${AKTIF}&kelengkapan=BAHAN_BELUM_DICATAT,BAHAN_PERLU_DICEK,HPP_BELUM_LENGKAP,DATA_ORDER_KURANG&pageSize=50&urut=terlama`, tA);
  rec(`filter gabungan + urut terlama dalam ${g.ms} ms: total = unit unik (${h.json.unik}), halaman ≤ 50`, g.status === 200 && g.json.total === h.json.unik && g.json.units.length <= 50);
  const satu = g.json?.units?.[0];
  if (satu) { const d = await get(`/api/production/units/${satu.id}/adopsi`, tA); rec("drawer unit memuat klasifikasi yang SAMA dengan daftar + pernyataan", d.status === 200 && JSON.stringify(d.json.adopsi.kelengkapan.keys) === JSON.stringify(satu.adopsi.kelengkapan.keys) && (d.json.pernyataanTanpaBahan?.aktif === null || typeof d.json.pernyataanTanpaBahan?.aktif === 'object') && d.json.izin?.pernyataanTanpaBahan === true); }
  else skip("drawer unit", "tidak ada unit berkekurangan pada lingkup Aktif");
  const x = await fetch(BASE + `/api/production/work-orders/export.xlsx?${AKTIF}&kelengkapan=HPP_BELUM_LENGKAP`, { headers: { Authorization: "Bearer " + tA } }); const b = Buffer.from(await x.arrayBuffer());
  rec(`ekspor Excel dengan filter kelengkapan terunduh (${b.length} byte, berkas xlsx)`, x.status === 200 && b.length > 1000 && b.slice(0, 2).toString() === "PK");
}
rec("periode terbalik ditolak 400 (bukan diabaikan)", (await get("/api/production/work-orders?dari=2026-10-10&sampai=2026-10-01", tA)).status === 400);
// penulisan: ditolak SEBELUM menyentuh data
const unitContoh = (await get("/api/production/work-orders?pageSize=1", tA)).json?.units?.[0];
if (unitContoh) {
  rec("POST pernyataan tanpa Idempotency-Key = 400 (ditolak sebelum menulis)", (await post(`/api/production/units/${unitContoh.id}/pernyataan-tanpa-bahan`, tA, { alasan: "Smoke: tanpa kunci idempotensi" })).status === 400);
  rec("POST pernyataan dengan alasan terlalu pendek = 400 (ditolak sebelum menulis)", (await post(`/api/production/units/${unitContoh.id}/pernyataan-tanpa-bahan`, tA, { alasan: "ok" }, { "Idempotency-Key": "smoke-alasan-pendek-0001" })).status === 400);
  if (tS) rec("POST pernyataan oleh Sales = 403 (izin)", (await post(`/api/production/units/${unitContoh.id}/pernyataan-tanpa-bahan`, tS, { alasan: "Smoke: Sales mencoba menyatakan" }, { "Idempotency-Key": "smoke-sales-tolak-0001" })).status === 403);
  else skip("POST pernyataan oleh Sales = 403", "tidak ada akun Sales murni");
  rec("POST cabut tanpa pernyataan aktif = 404 (tidak menulis)", (await post(`/api/production/units/${unitContoh.id}/pernyataan-tanpa-bahan/cabut`, tA, { alasan: "Smoke: cabut tanpa pernyataan" })).status === 404);
} else skip("pengujian penulisan yang ditolak", "tidak ada unit");
// invarian: tidak ada jejak tulis
const sesudah = await fp(); const beda = Object.keys(sebelum).filter((t) => sebelum[t].n !== sesudah[t].n || sebelum[t].h !== sesudah[t].h);
rec("tidak ada jejak tulis: stok, Material Issue, jurnal, harga, biaya operasional, jadwal/Run, pemakaian sementara, pernyataan, unit, order IDENTIK", beda.length === 0, beda.join(","));
rec("tidak ada peristiwa audit baru dari smoke", (await hitung("select count(*) as n from activity_events")) === evt0);
console.log(`\nSMOKE: gagal=${fail} dilewati=${dilewati}`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else
  ok "smoke test lulus (izin, hitungan = daftar, filter, drawer, ekspor, penulisan ditolak, isi tabel rilis dibaca aktual dan tidak berubah, tanpa jejak tulis, invarian)"
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
PHASE="9-pembersihan"; say "9. Pembersihan release lama DINONAKTIFKAN (folder hotfix dan release lama TIDAK dihapus)"
ok "tidak ada folder release/image/backup/volume yang dihapus oleh skrip ini; disk: $(df -h "$HOME" | awk 'NR==2{print $4" bebas"}')"
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
say "CATATAN: Rilis ini membawa penyaring Kelengkapan Order Produksi (Bahan belum dicatat / perlu dicek / HPP belum lengkap / Data order kurang) + pernyataan tanpa bahan baru. Migrasi aditif: 1 tabel pernyataan (isi dibaca aktual, tidak diasumsikan kosong). Rilis TIDAK membuat pernyataan massal, stok, Material Issue, Run, jadwal, status, biaya, jurnal, atau harga. Rollback kode: jalankan scripts/rollback-guard-kelengkapan.sh dulu (peringatan + snapshot; rollback rutin diperbolehkan)."
