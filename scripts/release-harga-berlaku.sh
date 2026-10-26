#!/usr/bin/env bash
# RILIS "HARGA BERLAKU BAHAN (HPP operasional, diedit dari layar Stok; DIPISAH dari nilai persediaan Finance)": WEB + BACKEND + 1 MIGRASI ADITIF (3 tabel baru kosong). RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Kode: panel Harga Berlaku di drawer bahan (Stok → cari bahan): harga per SATUAN STOK, waktu mulai berlaku, harga lama/baru, alasan wajib, catatan/bukti opsional, label "Belum didukung bukti"; pratinjau sebelum simpan; riwayat append-only.
#   ATURAN: (1) perubahan harga BIASA hanya berlaku "saat disimpan" atau waktu MENDATANG — tanggal mundur ditolak (server + CHECK DB); koreksi salah input historis = tindakan khusus (alasan ≥10 karakter, pratinjau SELURUH pemakaian terdampak,
#     konfirmasi, riwayat append-only; nilai beku lama TIDAK diubah diam-diam). (2) harga dibekukan per pergerakan saat pemakaian diposting pada harga yang berlaku di WAKTU PEMAKAIAN aktual; RETUR tertaut ISSUE memakai harga operasional ISSUE ASAL,
#     bukan harga saat retur; WASTE memakai harga saat waste dicatat dan sumbernya ditampilkan. (3) pemakaian lama hanya diberi harga lewat penerapan khusus: pengaju ≠ penyetuju, hash pratinjau, tidak otomatis.
#   IZIN EKSPLISIT: lihat = finance:read; ubah/koreksi/ajukan = finance:harga_berlaku:edit; setujui = finance:harga_berlaku:approve — dipegang peran FINANCE dan OWNER; akun ADMIN murni HANYA melihat sampai ada keputusan Owner.
#   PEMISAHAN ANGKA: HPP operasional (harga berlaku) ≠ nilai persediaan/jurnal Finance (biaya perolehan PSA/GR). Kartu terpisah di Jejak Biaya Bahan, sheet Excel "HPP Operasional" terpisah; rilis ini TIDAK mengubah valuasi/jurnal Finance, stok, ISSUE, PSA, GR.
#   Migrasi: 3 CREATE TABLE baru (kosong) + indeks (3 unik parsial) + 7 FK ON DELETE RESTRICT + 1 fungsi + 2 trigger append-only. Tidak ada ALTER TABLE pada tabel lama, tidak ada backfill. Hook di postStockMovement menulis baris biaya operasional (SAVEPOINT; tidak pernah menggagalkan Gudang).
#   PENANDA KEGAGALAN: bila pembekuan harga saat pemakaian diposting GAGAL, kegagalan dicatat PERSISTEN (status GAGAL_PEMBEKUAN, BEDA dari TANPA_HARGA = memang belum ada harga berlaku), dapat ditemukan (GET /gagal-pembekuan) dan diperbaiki lewat penerapan dua orang; bila penandanya sendiri gagal disimpan, transaksi stok DITOLAK.
#   Produksi: rilis ini TIDAK mengisi harga, tidak membuat penerapan, tidak menulis pergerakan stok/jurnal/valuasi; harga production diisi manual oleh pengguna berizin SESUDAH rilis (di luar skrip ini). Smoke hanya baca + penolakan sebelum menyentuh data.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, pin sha256 migrasi + diff schema, pemindai DDL + mutan negatif) → (2) audit produksi baca-saja + keadaan (SEGAR/LANJUT) + sidik jari → (3) backup + checksum → (4) build web + image
#              → (5) REHEARSAL (restore NYATA, migrasi dengan image baru, struktur, kode baru terhadap data restore, sidik jari sebelum=sesudah) → (6) migrate deploy produksi SATU kali (backend lama tetap melayani) → (7) switch → (8) verifikasi + smoke baca-saja.
#
#   cat scripts/release-harga-berlaku.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/hb1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/hb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/hb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/hb1r.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata (migrasi diterapkan HANYA pada DB sementara); TANPA migrasi/switch produksi
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/hb1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/hb1.out 2>&1 < /dev/null &'   # rilis penuh (hanya setelah persetujuan)
#
# ROLLBACK KODE: tabel baru bersifat ADITIF dan tidak memengaruhi stok/biaya Finance/jurnal; kode lama mengabaikannya. Yang hilang dari layar setelah rollback: harga berlaku, HPP operasional, antrean penerapan. Pemakaian yang diposting SELAMA kode lama berjalan
#   tidak dibekukan harga operasionalnya (akan tampil "belum dibekukan" setelah kode baru dipasang lagi dan hanya bisa diberi harga lewat penerapan khusus).
#   Jalankan dulu scripts/rollback-guard-harga-berlaku.sh (baca-saja): LULUS (exit 0) hanya bila ketiga tabel rilis KOSONG (fitur belum dipakai); DITOLAK (exit 1) bila sudah ada riwayat harga, snapshot biaya operasional (termasuk penanda pembekuan GAGAL) atau penerapan — mencetak jumlah, contoh, dan jalur pemulihan (perbaikan maju). Rollback kode TIDAK menghapus tabel/riwayat.
# (dibangkitkan oleh scripts/gen-release-harga-berlaku.cjs dari scripts/release-status-kerja-buka-pekerjaan.sh + scripts/templates/release-harga-berlaku/*; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-rc/harga-berlaku-on-live-59e027d6}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/prisma/migrations/20261231090000_harga_berlaku_bahan/migration\.sql|backend/prisma/schema\.prisma|backend/src/constants/permissions\.js|backend/src/routes/biayaBahan\.js|backend/src/routes/hargaBerlaku\.js|backend/src/services/finance/export/biaya-bahan\.js|backend/src/services/finance/hargaBerlaku\.js|backend/src/services/inventoryLedger\.js|backend/tests/integration/hargaBerlaku\.integration\.test\.js|backend/tests/releaseHargaBerlaku\.test\.js|frontend/src/api\.js|frontend/src/features/finance/HppOperasionalKartu\.jsx|frontend/src/features/finance/JejakBiayaBahan\.jsx|frontend/src/features/warehouse/components/ItemDetailDrawer\.jsx|frontend/src/features/warehouse/stok/HargaBerlakuPanel\.jsx|frontend/src/features/warehouse/stok/PenerapanLamaModal\.jsx|frontend/src/features/warehouse/stok/UbahHargaModal\.jsx|frontend/src/features/warehouse/stok/hargaBerlakuLogic\.js|frontend/tests/hargaBerlaku\.test\.js|scripts/gen-release-harga-berlaku\.cjs|scripts/lib/rehearsal-harga-berlaku\.mjs|scripts/lib/scan-migrasi-harga-berlaku\.mjs|scripts/lib/smoke-harga-berlaku\.mjs|scripts/release-harga-berlaku\.sh|scripts/rollback-guard-harga-berlaku\.sh|scripts/templates/release-harga-berlaku/gate-prisma\.txt|scripts/templates/release-harga-berlaku/header\.txt|scripts/templates/release-harga-berlaku/keadaan\.txt|scripts/templates/release-harga-berlaku/rehearsal-guard\.txt|scripts/templates/release-harga-berlaku/rehearsal-migrasi\.txt|scripts/templates/release-harga-berlaku/rollback\.txt|scripts/templates/release-harga-berlaku/step6\.txt|scripts/templates/release-harga-berlaku/struktur\.txt|scripts/templates/release-harga-berlaku/vars\.txt)$'
BACKEND_SRC_EXPECT="backend/src/constants/permissions.js backend/src/routes/biayaBahan.js backend/src/routes/hargaBerlaku.js backend/src/services/finance/export/biaya-bahan.js backend/src/services/finance/hargaBerlaku.js backend/src/services/inventoryLedger.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/finance/HppOperasionalKartu.jsx frontend/src/features/finance/JejakBiayaBahan.jsx frontend/src/features/warehouse/components/ItemDetailDrawer.jsx frontend/src/features/warehouse/stok/HargaBerlakuPanel.jsx frontend/src/features/warehouse/stok/PenerapanLamaModal.jsx frontend/src/features/warehouse/stok/UbahHargaModal.jsx frontend/src/features/warehouse/stok/hargaBerlakuLogic.js"
# Migrasi aditif yang SUDAH diaudit (nama + sha256 isi, LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIG_NAME="20261231090000_harga_berlaku_bahan"
MIG_PIN="35b1e3823bd0503d650e1e6b435906db9f8570f24f897ddc81e8ea188355ea04"
# Hasil pemindai DDL untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":24,"create_table":3,"index":11,"index_unik":6,"index_parsial":3,"fk":7,"fungsi":1,"trigger":2}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index dan tanpa nomor baris hunk) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="b1c997c54c2d6ea1836bd795c15f2cb5342548e592a41b5147043c6360ca7121"
# Objek rilis yang HARUS ada di database sesudah migrasi (nama persis; dibaca dari migrasi yang dipin).
TBL_BARU="material_harga_berlaku stock_movement_biaya_operasional biaya_operasional_penerapan"
IDX_BARU="material_harga_berlaku_pkey biaya_operasional_penerapan_pkey stock_movement_biaya_operasional_pkey material_harga_berlaku_idempotency_key_key material_harga_berlaku_corrects_id_key material_harga_berlaku_material_id_effective_from_idx biaya_operasional_penerapan_idempotency_key_key biaya_operasional_penerapan_material_id_status_idx biaya_operasional_penerapan_satu_aktif stock_movement_biaya_operasional_movement_id_created_at_idx stock_movement_biaya_operasional_material_id_idx stock_movement_biaya_operasional_application_id_idx stock_movement_biaya_operasional_satu_beku stock_movement_biaya_operasional_satu_gagal"
IDX_PARSIAL="biaya_operasional_penerapan_satu_aktif stock_movement_biaya_operasional_satu_beku stock_movement_biaya_operasional_satu_gagal"
CHK_BARU="material_harga_berlaku_tanpa_mundur_chk material_harga_berlaku_koreksi_dampak_chk material_harga_berlaku_jenis_chk material_harga_berlaku_harga_chk material_harga_berlaku_alasan_chk material_harga_berlaku_koreksi_chk biaya_operasional_penerapan_status_chk biaya_operasional_penerapan_alasan_chk stock_movement_biaya_operasional_status_chk stock_movement_biaya_operasional_basis_chk stock_movement_biaya_operasional_sumber_chk stock_movement_biaya_operasional_nilai_chk stock_movement_biaya_operasional_gagal_chk"
FK_BARU="material_harga_berlaku_material_id_fkey material_harga_berlaku_corrects_id_fkey biaya_operasional_penerapan_material_id_fkey stock_movement_biaya_operasional_movement_id_fkey stock_movement_biaya_operasional_material_id_fkey stock_movement_biaya_operasional_price_id_fkey stock_movement_biaya_operasional_application_id_fkey"
TRG_BARU="material_harga_berlaku_append_only_trg stock_movement_biaya_operasional_append_only_trg"
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
BK_DIR="$HOME/release-backups/harga-berlaku-${DEPLOY_SHORT}-${TS}"
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
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (bila sudah lewat tahap migrasi: 3 tabel baru KOSONG terpasang, tidak berbahaya).
LANGKAH WAJIB sebelum rollback KODE setelah migrasi/switch: jalankan GUARD (baca-saja)
   bash ${NEW_DIR}/scripts/rollback-guard-harga-berlaku.sh
   - exit 0 (LULUS): fitur belum dipakai — tabel rilis ada tetapi KOSONG (tanpa riwayat harga, snapshot biaya operasional, maupun penerapan). Baru boleh rollback kode (di bawah).
   - exit 1/2 (DITOLAK): sudah ada riwayat harga, ATAU snapshot biaya operasional (termasuk penanda pembekuan GAGAL), ATAU penerapan (status apa pun), atau keadaan tidak jelas — rollback kode RUTIN TIDAK DIPERBOLEHKAN.
     Jalur pemulihan = PERBAIKAN MAJU (kode baru tetap terpasang): rilis perbaikan di atas kode baru; putuskan/batalkan pengajuan penerapan lewat Stok → bahan → "Beri harga ke pemakaian lama"; perbaiki pembekuan gagal (GET /api/finance/biaya-bahan/harga-berlaku/gagal-pembekuan). Rollback tetap hanya atas keputusan tertulis Owner di luar skrip ini.
Rollback kode (HANYA setelah guard LULUS; tidak menghapus tabel maupun riwayat):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi bersifat ADITIF (3 tabel baru + indeks + 7 FK + 1 fungsi + 2 trigger): tabel dibiarkan terpasang setelah rollback kode. Tidak ada saldo, pergerakan stok, valuasi/jurnal Finance yang dibuat oleh fitur ini; yang hilang dari layar hanya harga berlaku/HPP operasional.
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS semua perubahan sesudah backup (harga berlaku, biaya operasional, transaksi); gunakan hanya atas keputusan Owner.
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
exec 9>/tmp/release-harga-berlaku.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "hb1\|release-harga-berlaku\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
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
ok "schema.prisma: diff identik dengan yang diaudit (aditif: model MaterialHargaBerlaku + StockMovementBiayaOperasional + BiayaOperasionalPenerapan + relasi balik pada Material dan StockMovement)"
[[ "$MIG_NAME" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $MIG_NAME"
ALL_SQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | tr -d '\r')"
h="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
[ "$MIG_PIN" = "$h" ] || die "isi migrasi ${MIG_NAME} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
ok "migrasi ${MIG_NAME}: sha256 cocok pin (${h:0:12})"
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai DDL migrasi rilis "Harga Berlaku Bahan" (HPP operasional). Membaca SQL (komentar/baris kosong sudah dibuang) dari stdin.
// DAFTAR PUTIH SEMPIT: hanya objek BARU milik rilis ini (3 tabel, indeks, FK RESTRICT, 1 fungsi append-only, 2 trigger). Pernyataan lain (DROP/UPDATE/INSERT/DELETE/ALTER tabel lama/GRANT/EXTENSION/fungsi liar) = exit 2.
// Keluaran (exit 0): JSON ringkas jumlah per jenis; skrip rilis membandingkannya dengan hasil yang sudah diaudit (SCAN_EXPECT).
import fs from "node:fs";

const BARU = ["material_harga_berlaku", "stock_movement_biaya_operasional", "biaya_operasional_penerapan"];
const REF_OK = ["materials", "stock_movements", "material_harga_berlaku", "stock_movement_biaya_operasional", "biaya_operasional_penerapan"];
const FUNGSI = ["harga_berlaku_append_only"];
const tolak = (m) => { console.error("DITOLAK: " + m); process.exit(2); };

const sql = fs.readFileSync(0, "utf8");
// pecah per pernyataan; isi fungsi ($$ ... $$) dijaga utuh
const stmts = []; let buf = ""; let dalam = false;
for (let i = 0; i < sql.length; i++) {
  if (sql.startsWith("$$", i)) { dalam = !dalam; buf += "$$"; i++; continue; }
  const c = sql[i];
  if (c === ";" && !dalam) { if (buf.trim()) stmts.push(buf.trim()); buf = ""; } else buf += c;
}
if (dalam) tolak("blok $$ tidak tertutup");
if (buf.trim()) tolak("pernyataan terakhir tanpa titik koma");

const n = { create_table: 0, index: 0, index_unik: 0, index_parsial: 0, fk: 0, fungsi: 0, trigger: 0 };
const tabelDibuat = new Set(); const fungsiDibuat = new Set();
const q = (s) => s.replace(/\s+/g, " ").trim();
for (const raw of stmts) {
  const s = q(raw); let m;
  if ((m = s.match(/^CREATE TABLE "([a-z_]+)" \(/))) {
    if (!BARU.includes(m[1])) tolak("CREATE TABLE di luar daftar: " + m[1]);
    if (tabelDibuat.has(m[1])) tolak("tabel ganda: " + m[1]);
    // tidak ada FK inline/DEFAULT berbahaya: isi hanya kolom + CONSTRAINT pkey/CHECK
    const isi = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
    if (/\bREFERENCES\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(isi.replace(/CHECK \(.*?\)(?=,\s*CONSTRAINT|$)/g, ""))) tolak("CREATE TABLE memuat REFERENCES/DML inline: " + m[1]);
    tabelDibuat.add(m[1]); n.create_table++; continue;
  }
  if ((m = s.match(/^CREATE (UNIQUE )?INDEX "([a-z0-9_]+)" ON "([a-z_]+)"\(([^)]*)\)( WHERE .+)?$/))) {
    if (!BARU.includes(m[3])) tolak("indeks pada tabel di luar rilis: " + m[3]);
    n.index++; if (m[1]) n.index_unik++; if (m[5]) n.index_parsial++; continue;
  }
  if ((m = s.match(/^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z0-9_]+)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "([a-z_]+)"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE$/))) {
    if (!BARU.includes(m[1])) tolak("FK pada tabel di luar rilis: " + m[1]);
    if (!REF_OK.includes(m[4])) tolak("FK ke tabel di luar daftar: " + m[4]);
    n.fk++; continue;
  }
  if ((m = s.match(/^CREATE OR REPLACE FUNCTION ([a-z_]+)\(\) RETURNS trigger AS \$\$ (.*) \$\$ LANGUAGE plpgsql$/))) {
    if (!FUNGSI.includes(m[1])) tolak("fungsi di luar daftar: " + m[1]);
    if (fungsiDibuat.has(m[1])) tolak("fungsi ganda: " + m[1]);
    const badan = m[2];
    if (/\b(INSERT|DROP|TRUNCATE|COPY|GRANT|CREATE|ALTER|PERFORM|DELETE FROM|UPDATE [a-z_"]+ SET)\b/i.test(badan)) tolak("badan fungsi memuat pernyataan terlarang: " + m[1]);
    fungsiDibuat.add(m[1]); n.fungsi++; continue;
  }
  if ((m = s.match(/^CREATE TRIGGER "([a-z0-9_]+)" BEFORE UPDATE OR DELETE ON "([a-z_]+)" FOR EACH ROW EXECUTE FUNCTION ([a-z_]+)\(\)$/))) {
    if (!BARU.includes(m[2])) tolak("trigger pada tabel di luar rilis: " + m[2]);
    if (!FUNGSI.includes(m[3])) tolak("trigger memakai fungsi di luar daftar: " + m[3]);
    n.trigger++; continue;
  }
  tolak("pernyataan di luar daftar putih: " + s.slice(0, 100));
}
if (n.create_table !== 3) tolak("harus tepat 3 CREATE TABLE");
if (n.fungsi !== 1 || n.trigger !== 2) tolak("harus tepat 1 fungsi + 2 trigger");
console.log(JSON.stringify({ total: stmts.length, ...n }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (3 CREATE TABLE baru kosong, indeks [3 unik parsial], 7 FK ON DELETE RESTRICT, 1 fungsi append-only + 2 trigger milik rilis ini); tanpa ALTER pada tabel lama, tanpa DROP/DELETE/UPDATE/INSERT/RENAME/GRANT/EXTENSION"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE units" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "DROP TABLE tabel baru" "$(tambah_stmt 'DROP TABLE "stock_movement_biaya_operasional";')"
harus_ditolak "UPDATE units (backfill)" "$(tambah_stmt "UPDATE \"units\" SET \"status\" = 'RECEIVED';")"
harus_ditolak "UPDATE stock_movements" "$(tambah_stmt 'UPDATE "stock_movements" SET "qty" = 0;')"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "units";')"
harus_ditolak "INSERT ke tabel baru (backfill)" "$(tambah_stmt "INSERT INTO \"material_harga_berlaku\" (id) VALUES ('x');")"
harus_ditolak "INSERT ... SELECT ke tabel baru" "$(tambah_stmt 'INSERT INTO "stock_movement_biaya_operasional" SELECT * FROM "units";')"
harus_ditolak "INSERT ke tabel lama" "$(tambah_stmt "INSERT INTO \"stock_movements\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "units";')"
harus_ditolak "ADD COLUMN pada units" "$(tambah_stmt 'ALTER TABLE "units" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada materials" "$(tambah_stmt 'ALTER TABLE "materials" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada tabel baru" "$(tambah_stmt 'ALTER TABLE "material_harga_berlaku" ADD COLUMN "x" TEXT;')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "units" DROP COLUMN "status";')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "units" RENAME COLUMN "status" TO "s";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "units" ALTER COLUMN "status" TYPE TEXT;')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "salinan tabel lama (CREATE TABLE AS)" "$(tambah_stmt 'CREATE TABLE "material_harga_berlaku_copy" AS SELECT * FROM "units";')"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("status");')"
harus_ditolak "indeks unik pada tabel lama" "$(tambah_stmt 'CREATE UNIQUE INDEX "x_uq" ON "stock_movements"("id");')"
harus_ditolak "FK ke tabel lain" "$(tambah_stmt 'ALTER TABLE "material_harga_berlaku" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "FK CASCADE (semua RESTRICT → CASCADE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE CASCADE/')"
harus_ditolak "FK SET NULL" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE SET NULL/')"
harus_ditolak "salah satu trigger dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'CREATE TRIGGER "material_harga_berlaku_append_only_trg"')"
harus_ditolak "trigger memakai fungsi lain" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON "stock_movement_biaya_operasional" FOR EACH ROW EXECUTE FUNCTION harga_berlaku_append_only()/ON "stock_movement_biaya_operasional" FOR EACH ROW EXECUTE FUNCTION evil_fn()/')"
harus_ditolak "trigger pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE UPDATE OR DELETE ON "units" FOR EACH ROW EXECUTE FUNCTION harga_berlaku_append_only();')"
harus_ditolak "trigger dilonggarkan (hanya UPDATE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/BEFORE UPDATE OR DELETE ON "material_harga_berlaku"/BEFORE UPDATE ON "material_harga_berlaku"/')"
harus_ditolak "DISABLE TRIGGER" "$(tambah_stmt 'ALTER TABLE "stock_movement_biaya_operasional" DISABLE TRIGGER ALL;')"
harus_ditolak "DROP TRIGGER" "$(tambah_stmt 'DROP TRIGGER "stock_movement_biaya_operasional_append_only_trg" ON "stock_movement_biaya_operasional";')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "units" DROP CONSTRAINT "units_pkey";')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "fungsi di luar daftar (OR REPLACE)" "$(tambah_stmt 'CREATE OR REPLACE FUNCTION production_adopsi_append_only() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "badan fungsi memuat DROP" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION/DROP TABLE units; RAISE EXCEPTION/")"
harus_ditolak "badan fungsi memuat DELETE FROM" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION/DELETE FROM units; RAISE EXCEPTION/")"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "material_harga_berlaku" TO PUBLIC;')"
harus_ditolak "REVOKE" "$(tambah_stmt 'REVOKE ALL ON "units" FROM PUBLIC;')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"UnitStatus\" ADD VALUE IF NOT EXISTS 'LIAR';")"
ok "uji negatif pemindai: ${NEG} mutan (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER lama/FK CASCADE+SET NULL/trigger/fungsi liar/EXTENSION/GRANT) SEMUA ditolak"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHA:0:8}; produksi bergeser — berhenti"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
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

# Struktur objek rilis (3 tabel KOSONG; 7 FK RESTRICT; CHECK; indeks [unik parsial]; 2 trigger append-only) — SATU definisi dipakai production (sebelum switch) dan rehearsal.
# $1 = fungsi pembaca SQL (menerima satu argumen SQL, mencetak hasil -At), $2 = fungsi kegagalan (menerima pesan).
in_list() { local o="" x; for x in $1; do o="${o:+$o,}'$x'"; done; printf '%s' "$o"; }
struktur_baru() {
  local Q="$1" G="$2" n
  [ "$("$Q" "select count(*) from pg_tables where schemaname='public' and tablename in ($(in_list "$TBL_BARU"))")" = "3" ] || "$G" "3 tabel rilis (harga berlaku, biaya operasional, penerapan) tidak terpasang"
  [ "$("$Q" "select (select count(*) from material_harga_berlaku) + (select count(*) from stock_movement_biaya_operasional) + (select count(*) from biaya_operasional_penerapan)")" = "0" ] || "$G" "tabel rilis TIDAK kosong setelah migrasi (backfill tidak diizinkan)"
  n="$(printf '%s\n' $FK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$FK_BARU")) and contype='f' and confdeltype='r' and convalidated")" = "$n" ] || "$G" "${n} FK ON DELETE RESTRICT tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $CHK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$CHK_BARU")) and contype='c' and convalidated")" = "$n" ] || "$G" "${n} CHECK tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $IDX_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ($(in_list "$IDX_BARU"))")" = "$n" ] || "$G" "${n} indeks tidak terpasang"
  n="$(printf '%s\n' $IDX_PARSIAL | grep -c .)"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ($(in_list "$IDX_PARSIAL")) and indexdef like '%UNIQUE%' and indexdef like '%WHERE%'")" = "$n" ] || "$G" "${n} indeks unik PARSIAL (satu pengajuan aktif per bahan; satu pembekuan per pergerakan) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname in ($(in_list "$TRG_BARU")) and not t.tgisinternal and p.proname = 'harga_berlaku_append_only'")" = "2" ] || "$G" "2 trigger append-only (harga berlaku, biaya operasional) tidak terpasang pada tabelnya (baris final) tidak terpasang"
}
SKEMA_SQL="select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name not in ('material_harga_berlaku','stock_movement_biaya_operasional','biaya_operasional_penerapan')"

# Klasifikasi KEADAAN production — murni, FAIL-CLOSED: selain dua keadaan yang dikenal = TOLAK.
#   SEGAR  = tidak ada tabel rilis dan migrasi rilis belum terpasang; migrasi pending = tepat migrasi rilis.
#   LANJUT = rilis terhenti SESUDAH migrasi: 3 tabel rilis ada dan KOSONG, migrasi rilis selesai (1 langkah, tidak di-rollback, checksum = berkas kandidat), tidak ada pending.
# Argumen: ntab nisi mig_terpasang(0/1) csok(0/1) pending(teks)
tentukan_keadaan() {
  local ntab="$1" nisi="$2" terpasang="$3" csok="$4" pend="$5"
  if [ "$ntab" = "0" ] && [ "$terpasang" = "0" ]; then
    [ "$pend" = "$MIG_NAME" ] || { echo "TOLAK: migrasi pending bukan tepat migrasi rilis ini ($(printf '%s' "$pend" | tr '\n' ' '))"; return 1; }
    echo SEGAR; return 0
  fi
  if [ "$ntab" = "3" ] && [ "$terpasang" = "1" ]; then
    [ -z "$pend" ] || { echo "TOLAK: masih ada migrasi pending ($(printf '%s' "$pend" | tr '\n' ' '))"; return 1; }
    [ "$csok" = "1" ] || { echo "TOLAK: status/checksum migrasi rilis tidak sesuai berkas kandidat"; return 1; }
    [ "$nisi" = "0" ] || { echo "TOLAK: tabel rilis TIDAK kosong (${nisi} baris)"; return 1; }
    echo LANJUT; return 0
  fi
  echo "TOLAK: keadaan campuran/tidak dikenal (tabel rilis=${ntab}, migrasi rilis terpasang=${terpasang})"; return 1
}
LQ() { psql_live -At -c "$1"; }
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
  ntab="$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename in ('material_harga_berlaku','stock_movement_biaya_operasional','biaya_operasional_penerapan')")"
  [[ "$ntab" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan tabel rilis bukan angka"; return 1; }
  if [ "$ntab" = "3" ]; then nisi="$(psql_live -At -c "select (select count(*) from material_harga_berlaku) + (select count(*) from stock_movement_biaya_operasional) + (select count(*) from biaya_operasional_penerapan)")"; fi
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
BACKUP_FILE="$HOME/backups/pre-harga-berlaku-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Harga Berlaku (HPP operasional)" "Koreksi salah input historis" "Beri harga ke pemakaian lama" "HPP operasional (harga berlaku)" "Saat disimpan (sekarang)" "Belum didukung bukti"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Buka pekerjaan" "Catat pekerjaan selesai" "Tandai sudah dikerjakan" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-hb-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_ux_bahan_${TS}"
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
[ "$(RPSQL "$SKEMA_SQL")" = "$S_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH skema (kolom/tipe/nullable/default) tabel lama"; }
ok "image baru: migrasi rilis diterapkan pada DB rehearsal (hasil restore nyata); 3 tabel kosong; 7 FK RESTRICT, CHECK (termasuk tanpa-mundur), indeks (3 unik parsial), 2 trigger append-only tervalidasi; skema tabel lama IDENTIK"
# Guard rollback pada keadaan KOSONG (migrasi terpasang, fitur belum dipakai) → LULUS; baca-saja.
set +e; GUARD_OUT1="$(GUARD_DB="$REH_DB" bash "$NEW_DIR/scripts/rollback-guard-harga-berlaku.sh" 2>&1)"; GUARD_RC1=$?; set -e
printf '%s
' "$GUARD_OUT1" > "$BK_DIR/guard-kosong.log"
{ [ "$GUARD_RC1" = "0" ] && printf '%s' "$GUARD_OUT1" | grep -q 'GUARD LULUS'; } || { printf '%s
' "$GUARD_OUT1"; reh_drop; die "guard rollback TIDAK meluluskan keadaan kosong (migrasi terpasang, fitur belum dipakai)"; }
ok "guard rollback pada keadaan kosong (tabel rilis ada, tanpa riwayat/snapshot/penerapan): LULUS"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "rehearsal MENGUBAH isi tabel"; }
# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): harga berlaku, tanpa mundur, koreksi berdampak, retur/waste, penerapan dua orang; stok/ISSUE/jurnal/GL/valuasi Finance tidak berubah. DB dihapus di akhir.
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji Harga Berlaku terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const H = await import("/app/src/services/finance/hargaBerlaku.js");
const { postStockMovement } = await import("/app/src/services/inventoryLedger.js");
const { ROLE_PERMISSIONS } = await import("/app/src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const ditolak = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const ts = Date.now().toString(36); let seq = 0; const kunci = (t) => `reh-hb-${t}-${ts}-${++seq}-aaaa`;
// Tabel yang TIDAK BOLEH berubah oleh fitur ini (valuasi/jurnal Finance, PSA/GR, penerimaan). stock_movements & fin_stock_movement_valuations bertambah HANYA oleh pergerakan uji (perilaku lama postStockMovement) — diperiksa terpisah.
const TETAP = ["fin_journal_entries", "fin_journal_lines", "fin_inventory_openings", "fin_inventory_opening_lines", "goods_receipts", "goods_receipt_lines", "fin_purchase_orders", "fin_supplier_bills", "fin_stock_movement_valuation_corrections", "unit_usage_notes", "material_issues"];
const fp = async (tabel) => { const o = {}; for (const t of tabel) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const beda = (a, b) => Object.keys(a).filter((t) => a[t].n !== b[t].n || a[t].h !== b[t].h);

// A. struktur baru terpasang dan KOSONG; izin eksplisit di kode baru
cek("3 tabel rilis kosong setelah migrasi (tanpa backfill)", (await num("select (select count(*) from material_harga_berlaku) + (select count(*) from stock_movement_biaya_operasional) + (select count(*) from biaya_operasional_penerapan) as n")) === 0);
const ada = (r, p) => (ROLE_PERMISSIONS[r] ?? []).includes(p);
cek("izin eksplisit: FINANCE dan OWNER memegang finance:harga_berlaku:edit + :approve", ada("FINANCE", "finance:harga_berlaku:edit") && ada("FINANCE", "finance:harga_berlaku:approve") && ada("OWNER", "finance:harga_berlaku:edit") && ada("OWNER", "finance:harga_berlaku:approve"));
cek("izin eksplisit: ADMIN murni TIDAK memegang izin ubah/setujui harga berlaku (menunggu keputusan Owner)", !ada("ADMIN", "finance:harga_berlaku:edit") && !ada("ADMIN", "finance:harga_berlaku:approve") && !ada("WAREHOUSE", "finance:harga_berlaku:edit") && !ada("SALES", "finance:harga_berlaku:edit"));

// B. pelaku dan bahan uji (data restore nyata)
const finUsers = await prisma.user.findMany({ where: { OR: [{ role: { in: ["FINANCE", "OWNER"] } }, { roles: { some: { role: { in: ["FINANCE", "OWNER"] } } } }] }, select: { id: true, name: true }, orderBy: { id: "asc" }, take: 2 });
if (finUsers.length < 2) { cek("dua pengguna Finance/Owner tersedia pada salinan", false); await prisma.$disconnect(); process.exit(1); }
const [pengaju, penyetuju] = finUsers;
const mat = (await prisma.material.findFirst({ where: { code: "SPANBON-75GRAM" }, select: { id: true, code: true, unit: true } })) ?? (await prisma.material.findFirst({ where: { active: true }, select: { id: true, code: true, unit: true } }));
const unit = await prisma.unit.findFirst({ select: { id: true, unitCode: true } });
cek(`bahan uji ${mat?.code} dan unit uji ${unit?.unitCode} tersedia`, !!mat && !!unit);
const saldoMat = await num(`select coalesce(sum(qty),0)::float as n from stock_movements where material_id = '${mat.id}'`);
const fp0 = await fp(TETAP); const nilaiFin0 = await prisma.$queryRawUnsafe("select id::text, status, value::text from fin_stock_movement_valuations order by id");
const nSm0 = await num("select count(*) as n from stock_movements"); const nFv0 = await num("select count(*) as n from fin_stock_movement_valuations");
const gerak = (type, qty, extra = {}) => prisma.$transaction((tx) => postStockMovement(tx, { materialId: mat.id, type, qty, unitId: unit.id, reason: "rehearsal", note: `rehearsal ${type}`, createdById: pengaju.id, ...extra }));

// C. membaca = baca-saja
const ring0 = await H.ringkasanBahan(prisma, mat.id); const riw0 = await H.riwayatHarga(prisma, mat.id);
cek("ringkasan + riwayat terbaca (kosong) tanpa menulis; teks izin eksplisit tersedia", ring0.hargaBerlaku === null && riw0.length === 0 && /Finance dan Owner/.test(ring0.izinTeks.ubah) && /keputusan Owner/.test(ring0.izinTeks.admin) && beda(fp0, await fp(TETAP)).length === 0);

// D. tulis pada SALINAN: harga berlaku TANPA tanggal mundur
const dasar = { materialId: mat.id, hargaBaru: "100", satuan: mat.unit, alasan: "rehearsal harga awal" };
const eMundur = await ditolak(() => H.pratinjauUbahHarga(prisma, { ...dasar, berlakuMulai: "2026-10-01T00:00:00Z" }));
cek("perubahan harga biasa dengan tanggal mundur DITOLAK (WAKTU_MUNDUR, 422)", eMundur?.code === "WAKTU_MUNDUR" && eMundur?.statusCode === 422, eMundur?.code);
const eSatuan = await ditolak(() => H.pratinjauUbahHarga(prisma, { ...dasar, satuan: "PAK-UJI" })); cek("satuan selain satuan stok ditolak (SATUAN_BEDA)", eSatuan?.code === "SATUAN_BEDA", eSatuan?.code);
const p1 = await H.pratinjauUbahHarga(prisma, dasar); const k1 = kunci("simpan");
const hasil = await Promise.allSettled([1, 2, 3].map(() => H.simpanHarga(prisma, { ...dasar, hashPratinjau: p1.hash }, { aktor: pengaju, kunci: k1 })));
cek("simpan harga (serentak ×3, kunci sama): tepat SATU baris; berlaku mulai = waktu simpan", hasil.every((h) => h.status === "fulfilled") && await num("select count(*) as n from material_harga_berlaku") === 1 && await num("select count(*) as n from material_harga_berlaku where effective_from = created_at") === 1);
const baris1 = await prisma.materialHargaBerlaku.findFirst({ where: { materialId: mat.id } });
const pakai = await gerak("ISSUE", -1); const opP = await prisma.stockMovementBiayaOperasional.findMany({ where: { movementId: pakai.id } });
cek("pemakaian baru dibekukan pada harga berlaku saat itu (Rp100, dasar WAKTU_PEMAKAIAN)", opP.length === 1 && Number(opP[0].unitCost) === 100 && opP[0].basisHarga === "WAKTU_PEMAKAIAN" && opP[0].sumber === "BEKU_SAAT_POSTING");

// E. retur memakai harga ISSUE asal (harga berubah di antara ISSUE dan retur); waste memakai harga saat waste
const p2 = await H.pratinjauUbahHarga(prisma, { ...dasar, hargaBaru: "150", alasan: "rehearsal kenaikan harga" }); await H.simpanHarga(prisma, { ...dasar, hargaBaru: "150", alasan: "rehearsal kenaikan harga", hashPratinjau: p2.hash }, { aktor: pengaju, kunci: kunci("naik") });
const retur = await gerak("RETURN", 1); const opR = (await prisma.stockMovementBiayaOperasional.findMany({ where: { movementId: retur.id } }))[0];
cek("RETUR memakai harga operasional ISSUE ASAL Rp100 (bukan Rp150 yang berlaku saat retur)", Number(opR.unitCost) === 100 && opR.basisHarga === "HARGA_ISSUE_ASAL" && Number(opR.value) === -100, `${opR?.unitCost} ${opR?.basisHarga}`);
const wst = await gerak("WASTE", -1, { reason: "rehearsal waste" }); const opW = (await prisma.stockMovementBiayaOperasional.findMany({ where: { movementId: wst.id } }))[0];
cek("WASTE memakai harga saat waste dicatat Rp150; sumber WAKTU_WASTE", Number(opW.unitCost) === 150 && opW.basisHarga === "WAKTU_WASTE");
const hpp = await H.hppOperasionalUnit(prisma, unit.id); cek("HPP operasional unit menampilkan dasar harga + pemisahan dari nilai Finance", hpp.baris.some((b) => /ISSUE asal/.test(b.basisTeks ?? "")) && /BUKAN nilai persediaan\/jurnal Finance/.test(hpp.peringatan));

// F. koreksi = tindakan khusus berdampak (nilai beku TIDAK ditimpa); penerapan dua orang
const kor = { ...dasar, hargaBaru: "120", berlakuMulai: baris1.effectiveFrom.toISOString(), alasan: "rehearsal koreksi salah input historis", koreksiId: baris1.id };
const eAlasan = await ditolak(() => H.pratinjauUbahHarga(prisma, { ...kor, alasan: "pendek" })); cek("koreksi dengan alasan < 10 karakter ditolak", eAlasan?.code === "ALASAN_WAJIB", eAlasan?.code);
const pk = await H.pratinjauUbahHarga(prisma, kor);
cek("pratinjau koreksi menampilkan SELURUH pemakaian terdampak (ISSUE + retur yang mengikuti)", pk.dampakKoreksi.jumlah >= 2 && pk.dampakKoreksi.dibekukanDenganHargaLama >= 2 && pk.dampakKoreksi.baris.some((x) => x.tipe === "RETURN" && x.ikutIssueAsal));
const eKonf = await ditolak(() => H.simpanHarga(prisma, { ...kor, hashPratinjau: pk.hash }, { aktor: pengaju, kunci: kunci("kor") })); cek("koreksi tanpa konfirmasi dampak ditolak", eKonf?.code === "KONFIRMASI_DAMPAK_WAJIB", eKonf?.code);
const koreksi = await H.simpanHarga(prisma, { ...kor, hashPratinjau: pk.hash, konfirmasiDampak: true }, { aktor: pengaju, kunci: kunci("kor2") });
const opPakaiSetelah = await prisma.stockMovementBiayaOperasional.findMany({ where: { movementId: pakai.id } });
cek("koreksi tersimpan (riwayat bertambah, baris lama tetap); NILAI BEKU LAMA TIDAK BERUBAH", koreksi.jenis === "KOREKSI" && await num("select count(*) as n from material_harga_berlaku") === 3 && opPakaiSetelah.length === 1 && Number(opPakaiSetelah[0].unitCost) === 100);
const pp = await H.pratinjauPenerapan(prisma, { materialId: mat.id, groups: ["SELARAS_ULANG"] });
cek("pratinjau penerapan: ISSUE yang dibekukan dengan harga lama muncul sebagai SELARAS_ULANG (retur menunggu ISSUE asal)", pp.penerapan.jumlah >= 1 && pp.penerapan.baris.every((x) => x.tipe !== "RETURN"));
const aj = await H.ajukanPenerapan(prisma, { materialId: mat.id, groups: ["SELARAS_ULANG"], hashPratinjau: pp.hash, alasan: "rehearsal penerapan koreksi" }, { aktor: pengaju, kunci: kunci("aj") });
const eSendiri = await ditolak(() => H.setujuiPenerapan(prisma, { id: aj.id, hashPratinjau: pp.hash, aktor: pengaju })); cek("pengaju TIDAK boleh menyetujui sendiri (PEMOHON_SAMA)", eSendiri?.code === "PEMOHON_SAMA", eSendiri?.code);
const setuju = await Promise.allSettled([1, 2, 3].map(() => H.setujuiPenerapan(prisma, { id: aj.id, hashPratinjau: pp.hash, aktor: penyetuju })));
cek("penerapan disetujui orang lain (serentak ×3): satu penerapan; baris beku asli tetap + baris penerapan baru", setuju.every((x) => x.status === "fulfilled") && await num(`select count(*) as n from stock_movement_biaya_operasional where movement_id = '${pakai.id}'`) === 2 && await num("select count(*) as n from stock_movement_biaya_operasional where sumber = 'PENERAPAN_DISETUJUI'") === pp.penerapan.jumlah);

// G. append-only di tingkat database
const e1 = await ditolak(() => prisma.$executeRawUnsafe(`update material_harga_berlaku set unit_price = 1 where id = '${baris1.id}'`)); const e2 = await ditolak(() => prisma.$executeRawUnsafe(`delete from stock_movement_biaya_operasional where movement_id = '${pakai.id}'`));
const e3 = await ditolak(() => prisma.$executeRawUnsafe(`insert into material_harga_berlaku (id, material_id, jenis, unit_price, satuan, effective_from, created_at, reason, idempotency_key) values (gen_random_uuid(), '${mat.id}', 'HARGA', 5, '${mat.unit}', now() - interval '1 day', now(), 'mundur lewat SQL', 'reh-mundur-${ts}')`));
cek("trigger DB: baris harga/biaya tidak bisa diubah/dihapus; CHECK DB menolak harga biasa berlaku mundur", !!e1 && !!e2 && !!e3);

// H. invarian: Finance/PSA/GR/jurnal tidak berubah; hanya pergerakan uji (perilaku lama) yang bertambah
const fp1 = await fp(TETAP); cek("jurnal, baris jurnal, PSA, penerimaan, tagihan, koreksi valuasi Finance, catatan pemakaian, Material Issue: IDENTIK sebelum vs sesudah", beda(fp0, fp1).length === 0, beda(fp0, fp1).join(","));
const nilaiFin1 = await prisma.$queryRawUnsafe("select id::text, status, value::text from fin_stock_movement_valuations order by id");
const lama = new Map(nilaiFin0.map((x) => [x.id, x])); const berubah = nilaiFin1.filter((x) => lama.has(x.id) && (lama.get(x.id).status !== x.status || lama.get(x.id).value !== x.value));
cek("valuasi Finance yang sudah ada TIDAK berubah (hanya +3 baris dari 3 pergerakan uji)", berubah.length === 0 && (await num("select count(*) as n from fin_stock_movement_valuations")) === nFv0 + 3);
cek("stok: hanya 3 pergerakan uji (ISSUE, RETURN, WASTE) yang bertambah; saldo bahan = saldo awal − 1 + 1 − 1", (await num("select count(*) as n from stock_movements")) === nSm0 + 3 && Math.abs((await num(`select coalesce(sum(qty),0)::float as n from stock_movements where material_id = '${mat.id}'`)) - (saldoMat - 1)) < 1e-6);
// I. kegagalan hook DIPAKSA (pemicu uji HANYA di DB sementara rehearsal): perintah stok tetap berhasil karena kegagalan tercatat PERSISTEN dan dapat ditemukan; bila penandanya gagal disimpan, transaksi DITOLAK.
//    Satu penanda kegagalan sengaja DIBIARKAN belum diperbaiki agar guard rollback (dijalankan sesudah skenario) terbukti menolak.
const namaDb = (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(namaDb)) { cek("uji kegagalan paksa hanya pada DB rehearsal", false, namaDb); await prisma.$disconnect(); process.exit(1); }
const pasangPemaksa = async (semua) => {
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION uji_paksa_gagal() RETURNS trigger AS $fn$ BEGIN IF ${semua ? "true" : "NEW.status <> 'GAGAL_PEMBEKUAN'"} THEN RAISE EXCEPTION 'uji: pembekuan dipaksa gagal'; END IF; RETURN NEW; END $fn$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS uji_paksa_gagal_trg ON stock_movement_biaya_operasional");
  await prisma.$executeRawUnsafe("CREATE TRIGGER uji_paksa_gagal_trg BEFORE INSERT ON stock_movement_biaya_operasional FOR EACH ROW EXECUTE FUNCTION uji_paksa_gagal()");
};
const lepasPemaksa = async () => { await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS uji_paksa_gagal_trg ON stock_movement_biaya_operasional"); await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS uji_paksa_gagal()"); };
const smI = await num("select count(*) as n from stock_movements");
let gg = null; await pasangPemaksa(false); try { gg = await gerak("ISSUE", -0.01, { reason: "rehearsal hook dipaksa gagal" }); } finally { await lepasPemaksa(); }
const mkI = gg ? await prisma.stockMovementBiayaOperasional.findMany({ where: { movementId: gg.id } }) : [];
cek("hook dipaksa gagal: perintah stok BERHASIL + penanda persisten GAGAL_PEMBEKUAN (bukan TANPA_HARGA) dengan alasan tercatat", !!gg && mkI.length === 1 && mkI[0].status === "GAGAL_PEMBEKUAN" && mkI[0].sumber === "GAGAL_SAAT_POSTING" && mkI[0].basisHarga === "TIDAK_DIKETAHUI" && /dipaksa gagal/.test(mkI[0].gagalAlasan ?? "") && (await num("select count(*) as n from stock_movements")) === smI + 1);
const dftI = await H.daftarGagalPembekuan(prisma); cek("kegagalan dapat DITEMUKAN (daftarGagalPembekuan) untuk diperbaiki", dftI.jumlah === 1 && dftI.baris[0].movementId === gg?.id && dftI.baris[0].kode === mat.code);
const smJ = await num("select count(*) as n from stock_movements"); const opJ = await num("select count(*) as n from stock_movement_biaya_operasional");
let eI = null; await pasangPemaksa(true); try { eI = await ditolak(() => gerak("ISSUE", -0.01, { reason: "rehearsal penanda ikut gagal" })); } finally { await lepasPemaksa(); }
cek("penanda kegagalan SENDIRI gagal disimpan → transaksi stok DITOLAK (PENANDA_PEMBEKUAN_GAGAL); pergerakan dan baris biaya tidak tersimpan", eI?.code === "PENANDA_PEMBEKUAN_GAGAL" && (await num("select count(*) as n from stock_movements")) === smJ && (await num("select count(*) as n from stock_movement_biaya_operasional")) === opJ, eI?.code);
cek("pemicu uji dilepas dari DB rehearsal", (await num("select count(*) as n from pg_trigger where tgname = 'uji_paksa_gagal_trg'")) === 0);

await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
# Guard rollback SESUDAH skenario rehearsal (riwayat harga, snapshot biaya operasional, penerapan, dan satu penanda GAGAL_PEMBEKUAN belum diperbaiki ada di DB sementara) → HARUS MENOLAK; baca-saja.
GFP_SQL="select (select count(*) from material_harga_berlaku)||'/'||(select count(*) from stock_movement_biaya_operasional)||'/'||(select count(*) from biaya_operasional_penerapan)||'/'||(select count(*) from stock_movements)"
GFP0="$( { RPSQL "$FP_SQL" | LC_ALL=C sort; RPSQL "$GFP_SQL"; } | md5sum )"
set +e; GUARD_OUT2="$(GUARD_DB="$REH_DB" bash "$NEW_DIR/scripts/rollback-guard-harga-berlaku.sh" 2>&1)"; GUARD_RC2=$?; set -e
printf '%s\n' "$GUARD_OUT2" > "$BK_DIR/guard-menolak.log"
GFP1="$( { RPSQL "$FP_SQL" | LC_ALL=C sort; RPSQL "$GFP_SQL"; } | md5sum )"
[ "$GUARD_RC2" = "1" ] || { printf '%s\n' "$GUARD_OUT2"; reh_drop; die "guard rollback TIDAK menolak (exit ${GUARD_RC2}) padahal riwayat harga/snapshot/penerapan sudah ada"; }
for t in 'GUARD DITOLAK' 'RUTIN TIDAK DIPERBOLEHKAN' 'riwayat harga berlaku' 'snapshot biaya operasional' 'pembekuan harga GAGAL' 'PERBAIKAN MAJU' 'gagal-pembekuan'; do printf '%s' "$GUARD_OUT2" | grep -q -- "$t" || { printf '%s\n' "$GUARD_OUT2"; reh_drop; die "pesan guard tidak memuat: $t"; }; done
[ "$GFP0" = "$GFP1" ] || { reh_drop; die "guard rollback MENGUBAH data (harus baca-saja)"; }
ok "guard rollback sesudah ada riwayat harga + snapshot + penerapan + penanda gagal: MENOLAK (exit 1) dengan pesan pemulihan (perbaikan maju); data tidak berubah oleh guard"
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi; uji tulis (harga berlaku/koreksi/retur/waste/penerapan) dilakukan pada salinan lalu DB sementara dihapus"
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
# Keadaan production diputuskan ULANG sesaat sebelum bertindak: harus sama dengan preflight (tidak ada sesi lain yang menerapkan/mengubah migrasi).
KEADAAN2="$(keadaan_produksi "2")" || die "${KEADAAN2}"
[ "$KEADAAN2" = "$KEADAAN" ] || die "keadaan production berubah sejak preflight (${KEADAAN} → ${KEADAAN2})"
cmp -s "$BK_DIR/applied-sebelum.txt" "$BK_DIR/applied-sebelum2.txt" || die "daftar migrasi terpasang berubah selama persiapan (sesi lain menerapkan migrasi) — berhenti, ulangi preflight"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-migrasi.txt" || die "sidik jari beku pra-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH sebelum migrasi"; }
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema tabel lama produksi berubah sejak preflight"
if [ "$KEADAAN" = "SEGAR" ]; then
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
else
  # LANJUT: migrasi SUDAH terpasang dan terbukti (checksum, struktur, kosong). TIDAK menjalankan migrate deploy: hanya membaca status.
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | tee "$BK_DIR/migrate-status-lanjut.log" | grep -i 'up to date' >/dev/null || die "keadaan LANJUT: migrate status production tidak 'up to date'"
fi
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang != baseline + 1 ($(( MIG_SEBELUM + 1 )))"
psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${MIG_NAME}'" | grep -Fx t >/dev/null || die "${MIG_NAME} tidak tercatat selesai"
struktur_baru LQ die
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema tabel lama BERUBAH oleh migrasi (jangan switch)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah tahap migrasi"
ok "migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); 3 tabel rilis kosong, struktur lengkap tervalidasi; skema tabel lama identik; backend lama tetap sehat"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari beku pasca-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh tahap migrasi (jangan switch)"; }
ok "pasca-tahap-migrasi sebelum switch: dokumen pembanding beku IDENTIK"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"
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
ok "objek rilis terpasang di produksi: 3 tabel (harga berlaku, biaya operasional, penerapan) — kosong; 7 FK RESTRICT, CHECK, indeks (3 unik parsial), 2 trigger append-only tervalidasi"
set +e; GUARD_PROD="$(bash "$NEW_DIR/scripts/rollback-guard-harga-berlaku.sh" 2>&1)"; GUARD_PROD_RC=$?; set -e
printf '%s\n' "$GUARD_PROD" | sed 's/^/        guard: /'
[ "$GUARD_PROD_RC" = "0" ] || die "guard rollback produksi pasca-switch tidak LULUS pada keadaan kosong (exit ${GUARD_PROD_RC})"
ok "guard rollback (baca-saja) di produksi: LULUS karena fitur belum dipakai (3 tabel kosong); setelah harga/pemakaian terisi, guard akan MENOLAK rollback rutin"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin (401/403, ADMIN murni hanya-lihat), ringkasan harga berlaku, riwayat, pratinjau (tanggal mundur ditolak), jejak unit, ekspor Excel; tabel rilis tetap kosong; tidak ada jejak tulis"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const { ROLE_PERMISSIONS } = await import("/app/src/constants/permissions.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function userDengan(rolesAda, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if ([...rolesAda].some((r) => rs.has(r)) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
// ADMIN murni = punya ADMIN tetapi TIDAK punya FINANCE/OWNER; FINANCE/OWNER = pemegang izin harga berlaku; SALES murni = tanpa peran berizin
const adminMurni = await userDengan(["ADMIN"], new Set(["FINANCE", "OWNER"]));
const finOwner = (await userDengan(["OWNER"], new Set())) ?? (await userDengan(["FINANCE"], new Set()));
const gudang = await userDengan(["WAREHOUSE"], new Set(["ADMIN", "OWNER", "FINANCE"]));
const sales = await userDengan(["SALES"], new Set(["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "PRODUCTION_LEAD"]));
if (!finOwner) { rec("akun FINANCE/OWNER tersedia", false); process.exit(1); }
const tF = await tokenUntuk(finOwner); const tA = adminMurni ? await tokenUntuk(adminMurni) : null; const tG = gudang ? await tokenUntuk(gudang) : null; const tS = sales ? await tokenUntuk(sales) : null;
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const B = (k) => Number(process.env[k]);
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.clone().json(); } catch { /* bukan JSON */ } return { status: r.status, json: j, res: r }; };
const post = async (path, token, body = {}) => { const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* */ } return { status: r.status, json: j }; };
const TABEL = ["stock_movements", "material_issues", "goods_receipts", "fin_journal_entries", "fin_journal_lines", "fin_stock_movement_valuations", "fin_stock_movement_valuation_corrections", "fin_inventory_openings", "fin_inventory_opening_lines", "materials", "units", "unit_usage_notes", "material_harga_berlaku", "stock_movement_biaya_operasional", "biaya_operasional_penerapan"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const sebelum = await fp();

// kode yang berjalan = kode kandidat
rec("kode berjalan: izin eksplisit harga berlaku ada; ADMIN murni tidak memegangnya", (ROLE_PERMISSIONS.FINANCE ?? []).includes("finance:harga_berlaku:edit") && (ROLE_PERMISSIONS.OWNER ?? []).includes("finance:harga_berlaku:approve") && !(ROLE_PERMISSIONS.ADMIN ?? []).includes("finance:harga_berlaku:edit"));
rec("3 tabel rilis ada dan kosong (tidak ada yang mengisi harga saat rilis)", (await hitung("select (select count(*) from material_harga_berlaku) + (select count(*) from stock_movement_biaya_operasional) + (select count(*) from biaya_operasional_penerapan) as n")) === 0);
const mat = (await prisma.material.findFirst({ where: { code: "SPANBON-75GRAM" }, select: { id: true, unit: true } })) ?? (await prisma.material.findFirst({ where: { active: true }, select: { id: true, unit: true } }));
const R = "/api/finance/biaya-bahan/harga-berlaku"; const ID0 = "00000000-0000-4000-8000-000000000000";

// izin: ditolak SEBELUM menyentuh data
rec("ringkasan harga berlaku: tanpa token 401", (await get(`${R}/bahan/${mat.id}`, null)).status === 401);
rec("simpan harga: tanpa token 401", (await post(R, null)).status === 401);
rec("setujui penerapan: tanpa token 401", (await post(`${R}/penerapan/${ID0}/setujui`, null)).status === 401);
if (tS) rec("ringkasan harga berlaku: SALES 403 (tanpa finance:read)", (await get(`${R}/bahan/${mat.id}`, tS)).status === 403); else skip("SALES 403", "tidak ada akun SALES murni aktif (diuji di tes integrasi)");
if (tG) { rec("ringkasan harga berlaku: Gudang 403", (await get(`${R}/bahan/${mat.id}`, tG)).status === 403); rec("simpan harga: Gudang 403", (await post(R, tG)).status === 403); } else skip("Gudang 403", "tidak ada akun Gudang murni aktif (diuji di tes integrasi)");
if (tA) {
  const ra = await get(`${R}/bahan/${mat.id}`, tA);
  rec("ADMIN murni: ringkasan 200 tetapi hanya-lihat (bolehUbah=false, bolehSetujui=false) + teks izin eksplisit", ra.status === 200 && ra.json?.bolehUbah === false && ra.json?.bolehSetujui === false && /keputusan Owner/.test(ra.json?.izinTeks?.admin ?? ""), String(ra.status));
  rec("ADMIN murni: simpan harga 403 (tidak diperluas ke semua Admin tanpa keputusan Owner)", (await post(R, tA, { materialId: mat.id })).status === 403);
  rec("ADMIN murni: ajukan penerapan 403", (await post(`${R}/penerapan`, tA, { materialId: mat.id })).status === 403);
  rec("ADMIN murni: setujui penerapan 403", (await post(`${R}/penerapan/${ID0}/setujui`, tA, {})).status === 403);
} else skip("ADMIN murni hanya-lihat", "tidak ada akun ADMIN murni aktif (diuji di tes integrasi)");

// baca-saja untuk pemegang izin
const rf = await get(`${R}/bahan/${mat.id}`, tF);
rec("FINANCE/OWNER: ringkasan 200, kosong (belum ada harga), bolehUbah=true", rf.status === 200 && rf.json?.hargaBerlaku === null && rf.json?.bolehUbah === true && rf.json?.bolehSetujui === true && /bukan nilai buku dan bukan HPP final Finance/.test(rf.json?.labelHarga ?? ""), String(rf.status));
const rw = await get(`${R}/bahan/${mat.id}/riwayat`, tF); rec("riwayat 200 dan kosong", rw.status === 200 && (rw.json?.riwayat ?? []).length === 0);
rec("daftar pembekuan gagal: tanpa token 401", (await get(`${R}/gagal-pembekuan`, null)).status === 401);
if (tG) rec("daftar pembekuan gagal: Gudang 403", (await get(`${R}/gagal-pembekuan`, tG)).status === 403);
const gp = await get(`${R}/gagal-pembekuan`, tF); rec("daftar pembekuan gagal (FINANCE/OWNER) 200 dan KOSONG — tidak ada pemakaian dengan pembekuan harga gagal", gp.status === 200 && gp.json?.jumlah === 0 && Array.isArray(gp.json?.baris), String(gp.status));
const dasar = { materialId: mat.id, hargaBaru: "100", satuan: mat.unit, alasan: "smoke pratinjau (tidak disimpan)" };
const pm = await post(`${R}/pratinjau`, tF, { ...dasar, berlakuMulai: "2026-10-01T00:00:00Z" });
rec("pratinjau dengan tanggal MUNDUR ditolak 422 WAKTU_MUNDUR (tanpa menulis)", pm.status === 422 && pm.json?.code === "WAKTU_MUNDUR", `${pm.status} ${pm.json?.code}`);
const ps = await post(`${R}/pratinjau`, tF, dasar); rec("pratinjau 'saat disimpan' 200: label Belum didukung bukti, tanpa menulis", ps.status === 200 && ps.json?.saatDisimpan === true && ps.json?.labelBukti === "BELUM_DIDUKUNG_BUKTI");
const psat = await post(`${R}/pratinjau`, tF, { ...dasar, satuan: "PAK-UJI" }); rec("pratinjau satuan selain satuan stok ditolak (SATUAN_BEDA)", psat.status === 422 && psat.json?.code === "SATUAN_BEDA");
const unit = await prisma.unit.findFirst({ select: { id: true, unitCode: true }, orderBy: { createdAt: "desc" } });
if (!unit) skip("jejak unit memuat hppOperasional", "tidak ada unit");
else {
  const j = await get(`/api/units/${unit.id}/jejak-bahan`, tF); rec(`jejak bahan unit ${unit.unitCode} (Finance): hppOperasional ada, terpisah dari ringkasan Finance`, j.status === 200 && !!j.json?.hppOperasional && !!j.json?.ringkasan && /BUKAN nilai persediaan\/jurnal Finance/.test(j.json.hppOperasional.peringatan ?? ""), String(j.status));
  if (tG) { const jg = await get(`/api/units/${unit.id}/jejak-bahan`, tG); rec("jejak bahan unit (Gudang): tanpa angka operasional/harga", jg.status === 200 && jg.json?.hppOperasional === undefined); }
}
const ex = await fetch(BASE + "/api/finance/export/biaya-bahan", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tF }, body: JSON.stringify({ filter: {} }) });
if (ex.status !== 200) rec("ekspor Excel Biaya Bahan 200", false, String(ex.status));
else { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.arrayBuffer())); const nm = wb.worksheets.map((s) => s.name); rec("ekspor Excel memuat sheet 'HPP Operasional' TERPISAH + sheet Finance lama utuh", nm.includes("HPP Operasional") && nm.includes("Rincian Pergerakan") && nm.includes("Ringkasan per Unit")); }

// tak ada jejak tulis: semua tabel (lama + baru) sama persis sebelum vs sesudah smoke
const sesudah = await fp(); const beda = TABEL.filter((t) => sebelum[t].n !== sesudah[t].n || sebelum[t].h !== sesudah[t].h);
rec("TIDAK ada jejak tulis: stok, Material Issue, penerimaan, jurnal, valuasi/koreksi Finance, PSA, katalog, catatan pemakaian, dan 3 tabel rilis sama persis sebelum vs sesudah smoke", beda.length === 0, beda.join(",") || "identik");
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
  ok "smoke test lulus (izin eksplisit, ringkasan/riwayat kosong, pratinjau tanpa mundur, jejak unit, ekspor Excel, tabel rilis kosong, tanpa jejak tulis, invarian)"
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
PHASE="9-pembersihan"; say "9. Pembersihan release lama (menyisakan 4 terbaru + yang dipakai container)"
(
  cd "$RELEASES" || exit 0
  KEEP="$(ls -1dt */ | head -4 | tr -d /)
$(basename "$NEW_DIR")
$(basename "$PREV_DIR")"
  for c in $(docker ps -q); do w="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null)"; [ -n "$w" ] && KEEP="$KEEP
$(basename "$w")"; done
  HAPUS="$(ls -1d */ | tr -d / | grep -vxF -f <(echo "$KEEP" | sort -u) || true)"
  n=0; for d in $HAPUS; do case "$d" in ""|"."|"..") continue;; esac; [ -d "$d" ] || continue; rm -rf -- "$d" 2>/dev/null || sudo -n rm -rf -- "$d" 2>/dev/null; n=$((n+1)); done
  echo "  OK    release lama dihapus: $n folder; disk: $(df -h "$HOME" | awk 'NR==2{print $4" bebas"}')"
) || echo "  (pembersihan dilewati)"
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
say "CATATAN: Rilis ini membawa fitur Harga Berlaku Bahan (HPP operasional, dipisah dari nilai persediaan Finance). Migrasi aditif: 3 tabel baru KOSONG. Tidak ada harga berlaku, biaya operasional, penerapan, pergerakan stok, jurnal, valuasi Finance, atau PSA/GR yang dibuat/diubah oleh rilis; harga production TIDAK diisi oleh rilis. Rollback kode: jalankan scripts/rollback-guard-harga-berlaku.sh dulu."
