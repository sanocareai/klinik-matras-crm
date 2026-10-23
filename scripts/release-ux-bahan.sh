#!/usr/bin/env bash
# RILIS "UX BAHAN — usulan bahan katalog ('Bahan belum ada?') + pemakaian sementara + rekonsiliasi Gudang": WEB + BACKEND + 1 MIGRASI ADITIF (2 tabel baru kosong). RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Kode: Pemakaian aktual di atas Rencana (Ruang Kerja Unit + drawer Order Produksi lama); pemilih bahan per kategori katalog + cari di dalam kategori + saldo/satuan sebelum konfirmasi; "Bahan belum ada?" = usulan ke Gudang (HANYA baris usulan:
#   tanpa Material, saldo, penerimaan, pergerakan, biaya, jurnal; Gudang/Admin berizin memutuskan: setujui → Material dibuat TANPA saldo awal / gabung / tolak); pemakaian SEMENTARA (bahan yang sudah terpakai tetapi belum punya sumber stok resmi:
#   BUKAN Material Issue, tanpa saldo/biaya/jurnal; "Perlu rekonsiliasi Gudang"; boleh menjadi bukti "Sudah dikerjakan" dengan sumber khusus; koreksi/pembatalan beralasan + audit — catatan batal TIDAK lagi menjadi bukti kerja; rekonsiliasi
#   HANYA menautkan pergerakan ISSUE resmi yang sudah ada atau menyatakan "bukan stok Gudang"); halaman Gudang › Usulan Bahan; sheet Excel "Pemakaian Sementara".
#   Migrasi: 2 CREATE TABLE baru (kosong) + 7 indeks (2 unik parsial) + 7 FK ON DELETE RESTRICT + 2 fungsi penjaga + 2 trigger (anti-hapus, kolom asal terkunci, baris final). Tidak ada ALTER TABLE pada tabel lama, tidak ada backfill, tidak ada perubahan data lama.
#   Produksi: rilis ini TIDAK membuat usulan, pemakaian sementara, bahan, pergerakan stok, jurnal, penerimaan, atau pesan pelanggan; smoke hanya baca + penolakan sebelum menyentuh data. Tidak ada transaksi QA.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, pin sha256 migrasi + diff schema, pemindai DDL + mutan negatif) → (2) audit produksi baca-saja + keadaan (SEGAR/LANJUT) + sidik jari → (3) backup + checksum → (4) build web + image
#              → (5) REHEARSAL (restore NYATA, migrasi dengan image baru, struktur, kode baru terhadap data restore, sidik jari sebelum=sesudah) → (6) migrate deploy produksi SATU kali (backend lama tetap melayani) → (7) switch → (8) verifikasi + smoke baca-saja.
#
#   cat scripts/release-ux-bahan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/ub1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/ub1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/ub1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/ub1r.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata (migrasi diterapkan HANYA pada DB sementara); TANPA migrasi/switch produksi
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/ub1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/ub1.out 2>&1 < /dev/null &'   # rilis penuh (hanya setelah persetujuan)
#
# ROLLBACK KODE: tabel baru bersifat ADITIF dan tidak memengaruhi stok/biaya/jurnal; kode lama mengabaikannya. TETAPI usulan MENUNGGU dan pemakaian sementara PERLU REKONSILIASI menjadi tak terlihat setelah rollback.
#   Jalankan dulu scripts/rollback-guard-ux-bahan.sh (baca-saja): LULUS (exit 0) hanya bila tidak ada usulan menunggu dan tidak ada pemakaian sementara yang perlu rekonsiliasi; DITOLAK (exit 1) mencetak jumlah + contoh + tindakan.
#   Bila ditolak, pemulihan = PERBAIKAN MAJU (kode baru tetap terpasang) sampai antrean selesai. Rollback kode (bila guard lulus) TIDAK menghapus tabel/riwayat; bahan yang sudah dibuat dari usulan tetap di katalog.
# (dibangkitkan oleh scripts/gen-release-ux-bahan.cjs dari scripts/release-status-kerja-buka-pekerjaan.sh + scripts/templates/release-ux-bahan/*; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/ux-bahan-usulan-pemakaian-sementara}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/prisma/migrations/20261226090000_bahan_usulan_pemakaian_sementara/migration\.sql|backend/prisma/schema\.prisma|backend/src/lib/activityLog\.js|backend/src/lib/domain/bahanUsulan\.js|backend/src/lib/domain/productionWorkStatus\.js|backend/src/routes/productionAdopsi\.js|backend/src/services/materialProposalService\.js|backend/src/services/productionOrderExport\.js|backend/src/services/productionOrderList\.js|backend/src/services/unitProvisionalUsageService\.js|backend/tests/bahanUsulan\.test\.js|backend/tests/integration/productionAdopsi\.integration\.test\.js|backend/tests/integration/setup/testDb\.js|backend/tests/integration/usulanBahanDanPemakaianSementara\.integration\.test\.js|backend/tests/integration/uxBahanReleaseSmoke\.integration\.test\.js|backend/tests/releaseUxBahan\.test\.js|frontend/src/api\.js|frontend/src/components/GudangNavGrup\.jsx|frontend/src/components/Layout\.jsx|frontend/src/components/Topbar\.jsx|frontend/src/features/production/OrderProduksiPanel\.jsx|frontend/src/features/production/bahan/BahanBelumAda\.jsx|frontend/src/features/production/bahan/BahanTab\.jsx|frontend/src/features/production/bahan/CatatBahanBaru\.jsx|frontend/src/features/production/bahan/FormPemakaianSementara\.jsx|frontend/src/features/production/bahan/PemakaianSementaraDaftar\.jsx|frontend/src/features/production/bahan/PemilihBahanKatalog\.jsx|frontend/src/features/production/bahan/RekonsiliasiPanel\.jsx|frontend/src/features/production/bahan/bahanModel\.js|frontend/src/features/production/orderProduksiModel\.js|frontend/src/lib/gudangNav\.js|frontend/src/pages/warehouse/WarehouseUsulanBahan\.jsx|frontend/src/routes/pageRegistry\.jsx|frontend/tests/bahanModel\.test\.js|frontend/tests/bahanUsulanSementara\.test\.js|frontend/tests/gudangUxTahap3\.test\.js|frontend/tests/orderProduksiAdopsi\.test\.js|scripts/gen-release-ux-bahan\.cjs|scripts/lib/rehearsal-ux-bahan\.mjs|scripts/lib/scan-migrasi-ux-bahan\.mjs|scripts/lib/smoke-ux-bahan\.mjs|scripts/release-ux-bahan\.sh|scripts/rollback-guard-ux-bahan\.sh|scripts/templates/release-ux-bahan/gate-prisma\.txt|scripts/templates/release-ux-bahan/header\.txt|scripts/templates/release-ux-bahan/keadaan\.txt|scripts/templates/release-ux-bahan/rehearsal-migrasi\.txt|scripts/templates/release-ux-bahan/rollback\.txt|scripts/templates/release-ux-bahan/step6\.txt|scripts/templates/release-ux-bahan/struktur\.txt|scripts/templates/release-ux-bahan/vars\.txt)$'
BACKEND_SRC_EXPECT="backend/src/lib/activityLog.js backend/src/lib/domain/bahanUsulan.js backend/src/lib/domain/productionWorkStatus.js backend/src/routes/productionAdopsi.js backend/src/services/materialProposalService.js backend/src/services/productionOrderExport.js backend/src/services/productionOrderList.js backend/src/services/unitProvisionalUsageService.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/components/GudangNavGrup.jsx frontend/src/components/Layout.jsx frontend/src/components/Topbar.jsx frontend/src/features/production/OrderProduksiPanel.jsx frontend/src/features/production/bahan/BahanBelumAda.jsx frontend/src/features/production/bahan/BahanTab.jsx frontend/src/features/production/bahan/CatatBahanBaru.jsx frontend/src/features/production/bahan/FormPemakaianSementara.jsx frontend/src/features/production/bahan/PemakaianSementaraDaftar.jsx frontend/src/features/production/bahan/PemilihBahanKatalog.jsx frontend/src/features/production/bahan/RekonsiliasiPanel.jsx frontend/src/features/production/bahan/bahanModel.js frontend/src/features/production/orderProduksiModel.js frontend/src/lib/gudangNav.js frontend/src/pages/warehouse/WarehouseUsulanBahan.jsx frontend/src/routes/pageRegistry.jsx"
# Migrasi aditif yang SUDAH diaudit (nama + sha256 isi, LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIG_NAME="20261226090000_bahan_usulan_pemakaian_sementara"
MIG_PIN="93470a74bdce4d2bdff35ba0632d43fe242cd059fb1ef9a32a25f4e55ec04205"
# Hasil pemindai DDL untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":20,"create_table":2,"index":7,"index_unik":4,"index_parsial":2,"fk":7,"fungsi":2,"trigger":2}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index dan tanpa nomor baris hunk) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="21c7280d0b89097235363eda448042aa3ee903e7fbf62668e151b604b4475f25"
# Objek rilis yang HARUS ada di database sesudah migrasi (nama persis; dibaca dari migrasi yang dipin).
TBL_BARU="material_proposals unit_provisional_usages"
IDX_BARU="material_proposals_pkey unit_provisional_usages_pkey material_proposals_open_name_key material_proposals_status_requested_at_idx unit_provisional_usages_stock_movement_id_key unit_provisional_usages_unit_id_idempotency_key_key unit_provisional_usages_corrected_from_id_key unit_provisional_usages_unit_id_recorded_at_idx unit_provisional_usages_status_recorded_at_idx"
IDX_PARSIAL="material_proposals_open_name_key unit_provisional_usages_unit_id_idempotency_key_key"
CHK_BARU="material_proposals_name_chk material_proposals_status_chk material_proposals_kelompok_chk material_proposals_unit_chk material_proposals_decision_chk material_proposals_material_chk material_proposals_reject_chk unit_provisional_usages_name_chk unit_provisional_usages_qty_chk unit_provisional_usages_uom_chk unit_provisional_usages_status_chk unit_provisional_usages_resolution_chk unit_provisional_usages_resolved_chk unit_provisional_usages_link_chk unit_provisional_usages_nostock_chk unit_provisional_usages_cancel_chk unit_provisional_usages_corrected_chk"
FK_BARU="material_proposals_unit_id_fkey material_proposals_material_id_fkey unit_provisional_usages_unit_id_fkey unit_provisional_usages_proposal_id_fkey unit_provisional_usages_corrected_from_id_fkey unit_provisional_usages_material_id_fkey unit_provisional_usages_stock_movement_id_fkey"
TRG_BARU="material_proposals_guard_trg unit_provisional_usages_guard_trg"
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
BK_DIR="$HOME/release-backups/ux-bahan-${DEPLOY_SHORT}-${TS}"
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
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (bila sudah lewat tahap migrasi: 2 tabel baru KOSONG terpasang, tidak berbahaya).
LANGKAH WAJIB sebelum rollback KODE setelah migrasi/switch: jalankan GUARD (baca-saja)
   bash ${NEW_DIR}/scripts/rollback-guard-ux-bahan.sh
   - exit 0 (LULUS): tidak ada usulan menunggu dan tidak ada pemakaian sementara yang perlu rekonsiliasi. Baru boleh rollback kode (di bawah).
   - exit 1/2 (DITOLAK): masih ada usulan menunggu / pemakaian sementara perlu rekonsiliasi (atau keadaan tidak jelas) — rollback kode TIDAK AMAN: antrean itu menjadi tak terlihat dan Gudang tidak lagi diingatkan.
     Jalur pemulihan = PERBAIKAN MAJU (kode baru tetap terpasang): Gudang › Usulan Bahan — putuskan usulan; selesaikan/batalkan pemakaian sementara; lalu jalankan guard lagi. Pemulihan database (di bawah) hanya atas keputusan Owner.
Rollback kode (HANYA setelah guard LULUS; tidak menghapus tabel, riwayat, maupun bahan yang dibuat dari usulan):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi bersifat ADITIF (2 tabel baru + 7 indeks + 7 FK + 2 fungsi + 2 trigger): tabel dibiarkan terpasang setelah rollback kode. Tidak ada saldo, pergerakan stok, biaya, atau jurnal yang dibuat oleh fitur ini; hanya tampilan (usulan, pemakaian sementara, sumber status kerja) yang hilang dari layar lama.
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS semua perubahan sesudah backup (usulan, pemakaian sementara, transaksi); gunakan hanya atas keputusan Owner.
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
exec 9>/tmp/release-ux-bahan.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "ub1\|release-ux-bahan\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
ok "schema.prisma: diff identik dengan yang diaudit (aditif: model MaterialProposal + UnitProvisionalUsage + relasi balik pada Unit, Material, StockMovement)"
[[ "$MIG_NAME" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $MIG_NAME"
ALL_SQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | tr -d '\r')"
h="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
[ "$MIG_PIN" = "$h" ] || die "isi migrasi ${MIG_NAME} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
ok "migrasi ${MIG_NAME}: sha256 cocok pin (${h:0:12})"
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai DDL migrasi rilis "UX Bahan" (usulan bahan + pemakaian sementara). Membaca SQL (komentar/baris kosong sudah dibuang) dari stdin.
// DAFTAR PUTIH SEMPIT: hanya objek BARU milik rilis ini (2 tabel, indeks, FK RESTRICT, 2 fungsi penjaga, 2 trigger). Pernyataan lain (DROP/UPDATE/INSERT/DELETE/ALTER tabel lama/GRANT/EXTENSION/fungsi liar) = exit 2.
// Keluaran (exit 0): JSON ringkas jumlah per jenis; skrip rilis membandingkannya dengan hasil yang sudah diaudit (SCAN_EXPECT).
import fs from "node:fs";

const BARU = ["material_proposals", "unit_provisional_usages"];
const REF_OK = ["units", "materials", "stock_movements", "material_proposals", "unit_provisional_usages"];
const FUNGSI = ["material_proposals_guard", "unit_provisional_usages_guard"];
const tolak = (m) => { console.error("DITOLAK: " + m); process.exit(2); };

const sql = fs.readFileSync(0, "utf8");
// pecah per pernyataan; isi fungsi ($ ... $) dijaga utuh
const stmts = []; let buf = ""; let dalam = false;
for (let i = 0; i < sql.length; i++) {
  if (sql.startsWith("$", i)) { dalam = !dalam; buf += "$"; i++; continue; }
  const c = sql[i];
  if (c === ";" && !dalam) { if (buf.trim()) stmts.push(buf.trim()); buf = ""; } else buf += c;
}
if (dalam) tolak("blok $ tidak tertutup");
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
if (n.create_table !== 2) tolak("harus tepat 2 CREATE TABLE");
if (n.fungsi !== 2 || n.trigger !== 2) tolak("harus tepat 2 fungsi + 2 trigger");
console.log(JSON.stringify({ total: stmts.length, ...n }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (2 CREATE TABLE baru kosong, 7 indeks [2 unik parsial], 7 FK ON DELETE RESTRICT, 2 fungsi penjaga + 2 trigger milik rilis ini); tanpa ALTER pada tabel lama, tanpa DROP/DELETE/UPDATE/INSERT/RENAME/GRANT/EXTENSION"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE units" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "DROP TABLE tabel baru" "$(tambah_stmt 'DROP TABLE "unit_provisional_usages";')"
harus_ditolak "UPDATE units (backfill)" "$(tambah_stmt "UPDATE \"units\" SET \"status\" = 'RECEIVED';")"
harus_ditolak "UPDATE stock_movements" "$(tambah_stmt 'UPDATE "stock_movements" SET "qty" = 0;')"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "units";')"
harus_ditolak "INSERT ke tabel baru (backfill)" "$(tambah_stmt "INSERT INTO \"material_proposals\" (id) VALUES ('x');")"
harus_ditolak "INSERT ... SELECT ke tabel baru" "$(tambah_stmt 'INSERT INTO "unit_provisional_usages" SELECT * FROM "units";')"
harus_ditolak "INSERT ke tabel lama" "$(tambah_stmt "INSERT INTO \"stock_movements\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "units";')"
harus_ditolak "ADD COLUMN pada units" "$(tambah_stmt 'ALTER TABLE "units" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada materials" "$(tambah_stmt 'ALTER TABLE "materials" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada tabel baru" "$(tambah_stmt 'ALTER TABLE "material_proposals" ADD COLUMN "x" TEXT;')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "units" DROP COLUMN "status";')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "units" RENAME COLUMN "status" TO "s";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "units" ALTER COLUMN "status" TYPE TEXT;')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "salinan tabel lama (CREATE TABLE AS)" "$(tambah_stmt 'CREATE TABLE "material_proposals_copy" AS SELECT * FROM "units";')"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("status");')"
harus_ditolak "indeks unik pada tabel lama" "$(tambah_stmt 'CREATE UNIQUE INDEX "x_uq" ON "stock_movements"("id");')"
harus_ditolak "FK ke tabel lain" "$(tambah_stmt 'ALTER TABLE "material_proposals" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "FK CASCADE (semua RESTRICT → CASCADE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE CASCADE/')"
harus_ditolak "FK SET NULL" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE SET NULL/')"
harus_ditolak "salah satu trigger dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'CREATE TRIGGER "material_proposals_guard_trg"')"
harus_ditolak "trigger memakai fungsi lain" "$(printf '%s\n' "$ALL_SQL" | sed 's/EXECUTE FUNCTION unit_provisional_usages_guard()/EXECUTE FUNCTION evil_fn()/')"
harus_ditolak "trigger pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE UPDATE OR DELETE ON "units" FOR EACH ROW EXECUTE FUNCTION material_proposals_guard();')"
harus_ditolak "trigger dilonggarkan (hanya UPDATE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/BEFORE UPDATE OR DELETE ON "material_proposals"/BEFORE UPDATE ON "material_proposals"/')"
harus_ditolak "DISABLE TRIGGER" "$(tambah_stmt 'ALTER TABLE "unit_provisional_usages" DISABLE TRIGGER ALL;')"
harus_ditolak "DROP TRIGGER" "$(tambah_stmt 'DROP TRIGGER "unit_provisional_usages_guard_trg" ON "unit_provisional_usages";')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "units" DROP CONSTRAINT "units_pkey";')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "fungsi di luar daftar (OR REPLACE)" "$(tambah_stmt 'CREATE OR REPLACE FUNCTION production_adopsi_append_only() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "badan fungsi memuat DROP" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION 'riwayat penyelesaian tidak boleh berubah saat dibatalkan';/DROP TABLE units;/")"
harus_ditolak "badan fungsi memuat DELETE FROM" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION 'kolom asal usulan bahan tidak boleh diubah';/DELETE FROM units;/")"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "material_proposals" TO PUBLIC;')"
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

# Struktur objek rilis (2 tabel KOSONG; 7 FK RESTRICT; CHECK; indeks [unik parsial]; 2 trigger penjaga) — SATU definisi dipakai production (sebelum switch) dan rehearsal.
# $1 = fungsi pembaca SQL (menerima satu argumen SQL, mencetak hasil -At), $2 = fungsi kegagalan (menerima pesan).
in_list() { local o="" x; for x in $1; do o="${o:+$o,}'$x'"; done; printf '%s' "$o"; }
struktur_baru() {
  local Q="$1" G="$2" n
  [ "$("$Q" "select count(*) from pg_tables where schemaname='public' and tablename in ($(in_list "$TBL_BARU"))")" = "2" ] || "$G" "2 tabel rilis (usulan bahan, pemakaian sementara) tidak terpasang"
  [ "$("$Q" "select (select count(*) from material_proposals) + (select count(*) from unit_provisional_usages)")" = "0" ] || "$G" "tabel rilis TIDAK kosong setelah migrasi (backfill tidak diizinkan)"
  n="$(printf '%s\n' $FK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$FK_BARU")) and contype='f' and confdeltype='r' and convalidated")" = "$n" ] || "$G" "${n} FK ON DELETE RESTRICT tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $CHK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$CHK_BARU")) and contype='c' and convalidated")" = "$n" ] || "$G" "${n} CHECK tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $IDX_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ($(in_list "$IDX_BARU"))")" = "$n" ] || "$G" "${n} indeks tidak terpasang"
  n="$(printf '%s\n' $IDX_PARSIAL | grep -c .)"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ($(in_list "$IDX_PARSIAL")) and indexdef like '%UNIQUE%' and indexdef like '%WHERE%'")" = "$n" ] || "$G" "${n} indeks unik PARSIAL (usulan terbuka per nama; kunci idempotensi) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname in ($(in_list "$TRG_BARU")) and not t.tgisinternal and p.proname in ('material_proposals_guard','unit_provisional_usages_guard')")" = "2" ] || "$G" "2 trigger penjaga (anti-hapus, kolom asal terkunci, baris final) tidak terpasang"
}
SKEMA_SQL="select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name not in ('material_proposals','unit_provisional_usages')"

# Klasifikasi KEADAAN production — murni, FAIL-CLOSED: selain dua keadaan yang dikenal = TOLAK.
#   SEGAR  = tidak ada tabel rilis dan migrasi rilis belum terpasang; migrasi pending = tepat migrasi rilis.
#   LANJUT = rilis terhenti SESUDAH migrasi: 2 tabel rilis ada dan KOSONG, migrasi rilis selesai (1 langkah, tidak di-rollback, checksum = berkas kandidat), tidak ada pending.
# Argumen: ntab nisi mig_terpasang(0/1) csok(0/1) pending(teks)
tentukan_keadaan() {
  local ntab="$1" nisi="$2" terpasang="$3" csok="$4" pend="$5"
  if [ "$ntab" = "0" ] && [ "$terpasang" = "0" ]; then
    [ "$pend" = "$MIG_NAME" ] || { echo "TOLAK: migrasi pending bukan tepat migrasi rilis ini ($(printf '%s' "$pend" | tr '\n' ' '))"; return 1; }
    echo SEGAR; return 0
  fi
  if [ "$ntab" = "2" ] && [ "$terpasang" = "1" ]; then
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
  ntab="$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename in ('material_proposals','unit_provisional_usages')")"
  [[ "$ntab" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan tabel rilis bukan angka"; return 1; }
  if [ "$ntab" = "2" ]; then nisi="$(psql_live -At -c "select (select count(*) from material_proposals) + (select count(*) from unit_provisional_usages)")"; fi
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
BACKUP_FILE="$HOME/backups/pre-ux-bahan-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Bahan belum ada?" "Pemakaian sementara" "Usulan Bahan" "Catat bahan baru dari Gudang" "Perlu rekonsiliasi Gudang" "Simpan koreksi"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-ux-bahan-${DEPLOY_SHORT}"
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
ok "image baru: migrasi rilis diterapkan pada DB rehearsal (hasil restore nyata); 2 tabel kosong; 7 FK RESTRICT, CHECK, indeks (2 unik parsial), 2 trigger penjaga tervalidasi; skema tabel lama IDENTIK"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "rehearsal MENGUBAH isi tabel"; }
# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): usulan, keputusan, pemakaian sementara, koreksi, pembatalan, rekonsiliasi; stok/Material Issue/penerimaan/jurnal/Run/QC/jadwal tidak berubah. DB dihapus di akhir.
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji UX Bahan terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const P = await import("/app/src/services/materialProposalService.js");
const U = await import("/app/src/services/unitProvisionalUsageService.js");
const D = await import("/app/src/lib/domain/productionWorkStatus.js");
const { kunciNama } = await import("/app/src/lib/domain/bahanUsulan.js");
const { listWorkList } = await import("/app/src/services/productionWorkListService.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const TABEL = ["stock_movements", "material_issues", "goods_receipts", "fin_journal_entries", "fin_journal_lines", "units", "production_runs_v2", "production_run_plans_v2", "qc_fit_tests", "production_unit_schedules", "production_unit_work_progress", "unit_component_reuse_entries"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const bedaTabel = (a, b) => TABEL.filter((t) => a[t].n !== b[t].n || a[t].h !== b[t].h);
const ditolak = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const ts = Date.now().toString(36);

// A. struktur baru terpasang dan KOSONG
cek("tabel rilis kosong setelah migrasi (tanpa backfill)", (await num("select (select count(*) from material_proposals) + (select count(*) from unit_provisional_usages) as n")) === 0);

// B. kontrak murni: sumber status kerja baru
const dasar = { unitStatus: "RECEIVED", pemakaian: { pertamaAt: "2026-10-22T03:00:00Z", terakhirAt: "2026-10-22T03:00:00Z", hanyaSementara: true } };
const ks = D.effectiveWorkStatus(dasar);
cek("kode baru: hanya pemakaian sementara → 'Sudah dikerjakan' bersumber PEMAKAIAN_SEMENTARA", ks.key === "DIKERJAKAN" && ks.source === "PEMAKAIAN_SEMENTARA" && /perlu rekonsiliasi Gudang/.test(ks.sourceLabel));
cek("kode baru: bukti resmi tetap sumber PEMAKAIAN_BAHAN (sementara tidak menimpa)", D.effectiveWorkStatus({ ...dasar, pemakaian: { ...dasar.pemakaian, hanyaSementara: false } }).source === "PEMAKAIAN_BAHAN");

// C. membaca = baca-saja pada data produksi (salinan)
const fp0 = await fp();
const daftarU = await P.daftarUsulan(prisma); const daftarS = await U.daftarPemakaianSementara(prisma, { status: null });
cek("antrean usulan & pemakaian sementara terbaca (kosong) tanpa menulis", daftarU.rows.length === 0 && daftarS.rows.length === 0 && bedaTabel(fp0, await fp()).length === 0);
const daftar = await listWorkList(prisma, { scope: "aktif", pageSize: 100 });
const unitDaftar = daftar.orders.flatMap((o) => o.units.map((u) => ({ ...u, order: o })));
console.log(`INFO daftar kerja aktif pada salinan: ${daftar.orders.length} order, ${unitDaftar.length} unit`);
cek("daftar kerja dibaca dengan kode baru tanpa mengubah tabel kunci", bedaTabel(fp0, await fp()).length === 0);

// D. tulis pada SALINAN (DB sementara; dihapus): usulan, keputusan, pemakaian sementara, koreksi, batal, rekonsiliasi
const admin = await prisma.user.findFirst({ where: { role: { in: ["ADMIN", "OWNER"] } }, select: { id: true, name: true } }) ?? await prisma.user.findFirst({ select: { id: true, name: true } });
const matAwal = await num("select count(*) as n from materials");
const fpA = await fp();
const kunci = (t) => `reh-${t}-${ts}-aaaaaaaa`;
const kandidat = [];
for (const u of unitDaftar) {
  if (!["BELUM_DIJADWALKAN", "DIJADWALKAN"].includes(u.kerja?.key) || u.kerja?.source === "APLIKASI") continue;
  const ada = await num(`select (select count(*) from stock_movements where unit_id = '${u.id}' and type::text = 'ISSUE') + (select count(*) from unit_component_reuse_entries where unit_id = '${u.id}') + (select count(*) from production_unit_work_progress where unit_id = '${u.id}') as n`);
  if (ada === 0) { kandidat.push(u); break; }
}
const unit = kandidat[0] ?? null;

// D1. usulan: klik ganda serentak = satu baris; tanpa efek stok/katalog
const NAMA_USULAN = "Pelat Seng Gelombang Alfa"; const NAMA_SEMENTARA = "Pita Nilon Hitam Beta"; const NAMA_LEPAS = "Lem Aerosol Kuning Gamma";
const usulan = { name: NAMA_USULAN, unit: "PCS", kelompok: "LAINNYA", description: "rehearsal" };
const hasilU = await Promise.allSettled([1, 2, 3].map(() => P.ajukanBahanBaru(prisma, { input: usulan, actorId: admin.id })));
cek("usulan bahan (serentak ×3): tepat SATU baris usulan", hasilU.every((h) => h.status === "fulfilled") && await num(`select count(*) as n from material_proposals where name_key = '${kunciNama(NAMA_USULAN)}'`) === 1);
cek("usulan TIDAK membuat Material, saldo, penerimaan, pergerakan, biaya, atau jurnal", (await num("select count(*) as n from materials")) === matAwal && bedaTabel(fpA, await fp()).length === 0);
const material = await prisma.material.findFirst({ where: { active: true }, select: { name: true } });
if (material) { const e = await ditolak(() => P.ajukanBahanBaru(prisma, { input: { name: material.name, unit: "PCS", kelompok: "LAINNYA" }, actorId: admin.id })); cek("nama yang SAMA dengan bahan katalog ditolak (BAHAN_SUDAH_ADA)", e?.code === "BAHAN_SUDAH_ADA", e?.code); }
else console.log("SKIP tidak ada bahan aktif pada salinan untuk uji duplikasi");

// D2. keputusan Gudang/Admin: bahan dibuat TANPA saldo
const p1 = (await P.daftarUsulan(prisma, { status: "MENUNGGU_GUDANG" })).rows.find((r) => r.name === usulan.name);
const kodeUji = `REH-UJI-${ts}`.toUpperCase();
const setuju = await P.putuskanUsulan(prisma, { proposalId: p1.id, input: { keputusan: "SETUJUI", kode: kodeUji, itemGroup: "PE" }, actorId: admin.id });
const mBaru = await prisma.material.findFirst({ where: { code: kodeUji } });
cek("keputusan SETUJUI: Material dibuat di katalog, status DISETUJUI", setuju.usulan.status === "DISETUJUI" && !!mBaru && (await num("select count(*) as n from materials")) === matAwal + 1);
cek("membuat katalog TIDAK menambah saldo/penerimaan/pergerakan/biaya/jurnal", (await num(`select count(*) as n from stock_movements where material_id = '${mBaru.id}'`)) === 0 && bedaTabel(fpA, await fp()).length === 0);

// D3. pemakaian sementara
if (!unit) console.log("SKIP tidak ada unit tanpa bukti kerja pada salinan: uji pemakaian sementara pada unit nyata dilewati");
else {
  const p2 = await P.ajukanBahanBaru(prisma, { input: { name: NAMA_SEMENTARA, unit: "METER", kelompok: "AKSESORI" }, actorId: admin.id });
  const input = { name: NAMA_SEMENTARA, qty: 2, uom: "METER", originNote: "Dibeli sendiri / dari luar", proposalId: p2.usulan.id };
  const k1 = kunci("sem");
  const hasilS = await Promise.allSettled([1, 2, 3].map(() => U.catatPemakaianSementara(prisma, { unitId: unit.id, input, actorId: admin.id, idempotencyKey: k1 })));
  const baris = await prisma.unitProvisionalUsage.findMany({ where: { unitId: unit.id } });
  cek(`pemakaian sementara pada ${unit.unitCode} (serentak ×3, kunci sama): tepat SATU catatan`, hasilS.every((h) => h.status === "fulfilled") && baris.length === 1 && baris[0].status === "PERLU_REKONSILIASI");
  const fpB = await fp(); cek("pemakaian sementara TIDAK menyentuh stok/Material Issue/penerimaan/jurnal/Run/QC/jadwal/komponen lama", bedaTabel(fpA, fpB).length === 0, bedaTabel(fpA, fpB).join(","));
  const lihat = async () => (await listWorkList(prisma, { scope: "aktif", pageSize: 100, q: unit.unitCode })).orders.flatMap((o) => o.units).find((x) => x.id === unit.id);
  const u1 = await lihat(); cek("daftar kerja: 'Sudah dikerjakan' dengan sumber 'Pemakaian sementara — perlu rekonsiliasi Gudang'", u1?.kerja?.key === "DIKERJAKAN" && u1.kerja.source === "PEMAKAIAN_SEMENTARA", JSON.stringify([u1?.kerja?.key, u1?.kerja?.source]));
  // koreksi beralasan
  const kor = await U.koreksiPemakaianSementara(prisma, { usageId: baris[0].id, input: { qty: 3, uom: "METER", originNote: "Pinjam dari tempat lain" }, alasan: "Jumlah di meja ternyata 3 meter", actorId: admin.id, idempotencyKey: kunci("kor") });
  const lama = await prisma.unitProvisionalUsage.findUnique({ where: { id: baris[0].id } });
  cek("koreksi beralasan: catatan lama DIBATALKAN ('Dikoreksi: …'), catatan baru PERLU_REKONSILIASI menunjuk ke yang lama", lama.status === "DIBATALKAN" && lama.cancelReason.startsWith("Dikoreksi: ") && kor.item.hasilKoreksi === true && kor.item.status === "PERLU_REKONSILIASI");
  cek("setelah koreksi: bukti kerja pindah ke catatan baru (masih Pemakaian sementara)", (await lihat())?.kerja?.source === "PEMAKAIAN_SEMENTARA");
  // batal salah input -> bukan bukti kerja lagi
  await U.batalkanPemakaianSementara(prisma, { usageId: kor.item.id, alasan: "Salah unit (rehearsal)", actorId: admin.id, bolehSemua: true });
  const u3 = await lihat(); cek("setelah pembatalan salah input: status kerja KEMBALI seperti semula dan bukan lagi sumber sementara", u3?.kerja?.key === unit.kerja.key && u3.kerja.source !== "PEMAKAIAN_SEMENTARA", JSON.stringify([u3?.kerja?.key, u3?.kerja?.source]));
  const ev = await num(`select count(*) as n from activity_events where entity_id = '${unit.id}' and event_type in ('PRODUCTION_PEMAKAIAN_SEMENTARA_DICATAT','PRODUCTION_PEMAKAIAN_SEMENTARA_DISELESAIKAN')`);
  cek("audit tercatat untuk catat, koreksi, dan pembatalan (≥ 4 peristiwa)", ev >= 4, String(ev));
  // rekonsiliasi 'bukan stok Gudang' lalu pembatalan oleh Gudang
  const s3 = await U.catatPemakaianSementara(prisma, { unitId: unit.id, input: { name: NAMA_LEPAS, qty: 1, uom: "PCS" }, actorId: admin.id, idempotencyKey: kunci("lepas") });
  const rk = await U.rekonsiliasiPemakaianSementara(prisma, { usageId: s3.item.id, input: { resolusi: "TANPA_STOK", catatan: "Dibeli operator di toko luar (rehearsal)" }, actorId: admin.id });
  cek("rekonsiliasi 'bukan stok Gudang': DIREKONSILIASI tanpa pergerakan/jurnal", rk.item.status === "DIREKONSILIASI" && bedaTabel(fpA, await fp()).length === 0);
  const bt = await U.batalkanPemakaianSementara(prisma, { usageId: s3.item.id, alasan: "Salah input (rehearsal)", actorId: admin.id, bolehSemua: true });
  cek("pembatalan catatan 'bukan stok Gudang' oleh pemegang hak Gudang: DIBATALKAN, riwayat penyelesaian tetap", bt.item.status === "DIBATALKAN" && bt.item.resolusi === "TANPA_STOK");
  // trigger DB: baris final tidak bisa diubah/dihapus
  const e1 = await ditolak(() => prisma.$executeRawUnsafe(`update unit_provisional_usages set qty = 99 where id = '${s3.item.id}'`));
  const e2 = await ditolak(() => prisma.$executeRawUnsafe(`delete from unit_provisional_usages where id = '${s3.item.id}'`));
  const e3 = await ditolak(() => prisma.$executeRawUnsafe(`delete from material_proposals where id = '${p1.id}'`));
  cek("trigger DB: baris final tidak bisa diubah/dihapus (pemakaian sementara & usulan)", !!e1 && !!e2 && !!e3);
  const fpC = await fp(); cek("seluruh rangkaian tulis: stok, Material Issue, penerimaan, jurnal, Run, QC, jadwal, catatan kerja, komponen lama TIDAK berubah", bedaTabel(fpA, fpC).length === 0, bedaTabel(fpA, fpC).join(","));
}
await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi; uji tulis (usulan/sementara/koreksi/batal/rekonsiliasi) dilakukan pada salinan lalu DB sementara dihapus"
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
ok "migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); 2 tabel rilis kosong, struktur lengkap tervalidasi; skema tabel lama identik; backend lama tetap sehat"
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
ok "objek rilis terpasang di produksi: 2 tabel (usulan bahan, pemakaian sementara) — kosong; 7 FK RESTRICT, CHECK, indeks, 2 trigger penjaga tervalidasi"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin (401/403), antrean usulan/pemakaian sementara, cek duplikasi, katalog, panel unit, ekspor Excel; tabel rilis tetap kosong; tidak ada jejak tulis"
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
const D = await import("/app/src/lib/domain/productionWorkStatus.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER", "PRODUCTION_LEAD", "WAREHOUSE"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
if (!adm) { rec("akun ADMIN tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm); const tS = sales ? await tokenUntuk(sales) : null;
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const B = (k) => Number(process.env[k]);
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.clone().json(); } catch { /* bukan JSON */ } return { status: r.status, json: j, res: r }; };
const post = (path, token) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: "{}" });
const TABEL = ["stock_movements", "material_issues", "goods_receipts", "fin_journal_entries", "fin_journal_lines", "materials", "units", "production_runs_v2", "production_run_plans_v2", "qc_fit_tests", "production_unit_schedules", "production_unit_work_progress", "unit_component_reuse_entries", "material_proposals", "unit_provisional_usages"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const sebelum = await fp();

// kode yang berjalan = kode kandidat
rec("kode berjalan: sumber status kerja PEMAKAIAN_SEMENTARA tersedia", D.WORK_SOURCE.PEMAKAIAN_SEMENTARA === "PEMAKAIAN_SEMENTARA" && /perlu rekonsiliasi Gudang/.test(D.WORK_SOURCE_LABEL.PEMAKAIAN_SEMENTARA));
// tabel rilis terpasang dan KOSONG
rec("2 tabel rilis ada dan kosong (tidak ada yang membuat data saat rilis)", (await hitung("select (select count(*) from material_proposals) + (select count(*) from unit_provisional_usages) as n")) === 0);

// izin: ditolak SEBELUM menyentuh data
const ID0 = "00000000-0000-4000-8000-000000000000";
rec("usul bahan: tanpa token 401", (await post("/api/production/material-proposals", null)).status === 401);
rec("catat pemakaian sementara: tanpa token 401", (await post(`/api/production/units/${ID0}/provisional-usages`, null)).status === 401);
rec("keputusan usulan: tanpa token 401", (await post(`/api/production/material-proposals/${ID0}/decision`, null)).status === 401);
rec("rekonsiliasi: tanpa token 401", (await post(`/api/production/provisional-usages/${ID0}/reconcile`, null)).status === 401);
if (tS) {
  rec("usul bahan: SALES (hanya-lihat) 403", (await post("/api/production/material-proposals", tS)).status === 403);
  rec("catat pemakaian sementara: SALES 403", (await post(`/api/production/units/${ID0}/provisional-usages`, tS)).status === 403);
  rec("keputusan usulan: SALES 403", (await post(`/api/production/material-proposals/${ID0}/decision`, tS)).status === 403);
  rec("antrean usulan: SALES 403", (await get("/api/production/material-proposals", tS)).status === 403);
} else skip("izin SALES 403 (usul/catat/keputusan/antrean)", "tidak ada akun SALES murni aktif (diuji di tes integrasi)");

// baca-saja: antrean, cek kembar, katalog, panel unit, ekspor
const aU = await get("/api/production/material-proposals", tA); const aS = await get("/api/production/provisional-usages", tA);
rec("antrean usulan (Admin) 200 dan kosong", aU.status === 200 && (aU.json?.rows ?? []).length === 0, String(aU.status));
rec("antrean pemakaian sementara (Admin) 200 dan kosong", aS.status === 200 && (aS.json?.rows ?? []).length === 0, String(aS.status));
const kembar = await get("/api/production/material-duplicates?name=busa", tA);
rec("cek duplikasi nama (baca-saja) 200", kembar.status === 200 && Array.isArray(kembar.json?.kandidat), String(kembar.status));
const kat = await get("/api/production/material-catalog?limit=5", tA);
rec("katalog bahan 200 (kategori tetap)", kat.status === 200 && Array.isArray(kat.json?.kelompok), String(kat.status));
const unit = await prisma.unit.findFirst({ where: { status: { in: ["RECEIVED", "IN_PRODUCTION"] } }, select: { id: true, unitCode: true }, orderBy: { createdAt: "desc" } });
if (!unit) skip("panel unit memuat pemakaianSementara + izin", "tidak ada unit aktif saat ini (diuji di rehearsal salinan dan tes integrasi)");
else {
  const a1 = await get(`/api/production/units/${unit.id}/adopsi`, tA); const a2 = await get(`/api/production/units/${unit.id}/adopsi`, tA);
  rec(`panel unit ${unit.unitCode} (Admin) 200: pemakaianSementara ada dan kosong; izin usul/catat/putuskan tersedia`, a1.status === 200 && Array.isArray(a1.json?.pemakaianSementara?.items) && a1.json.pemakaianSementara.items.length === 0 && a1.json.izin?.usulBahan === true && a1.json.izin?.catatPemakaianSementara === true, String(a1.status));
  rec("membuka panel dua kali identik (status kerja tidak berubah karena dibuka)", JSON.stringify(a1.json?.adopsi?.kerja) === JSON.stringify(a2.json?.adopsi?.kerja));
  if (tS) { const as = await get(`/api/production/units/${unit.id}/adopsi`, tS); rec("panel unit (SALES hanya-lihat) 200 dan izin catat/usul = false", as.status === 200 && as.json?.izin?.usulBahan === false && as.json?.izin?.catatPemakaianSementara === false && as.json?.izin?.putuskanUsulan === false); }
}
const ex = await get("/api/production/work-orders/export.xlsx?scope=semua", tA);
if (ex.status !== 200) rec("ekspor Excel Order Produksi 200", false, String(ex.status));
else { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.res.arrayBuffer())); rec("ekspor Excel memuat sheet 'Pemakaian Sementara' (kosong) dan sheet lama", wb.worksheets.map((s) => s.name).includes("Pemakaian Sementara") && wb.worksheets.map((s) => s.name).includes("Ringkasan Unit")); }

// tak ada jejak tulis: semua tabel (lama + baru) sama persis sebelum vs sesudah smoke
const sesudah = await fp(); const beda = TABEL.filter((t) => sebelum[t].n !== sesudah[t].n || sebelum[t].h !== sesudah[t].h);
rec("TIDAK ada jejak tulis: stok, Material Issue, penerimaan, jurnal, katalog bahan, Run, QC, jadwal, catatan kerja, komponen lama, usulan, dan pemakaian sementara sama persis sebelum vs sesudah smoke", beda.length === 0, beda.join(",") || "identik");
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
  ok "smoke test lulus (izin, antrean kosong, panel unit, ekspor Excel, tabel rilis kosong, tanpa jejak tulis, invarian)"
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
say "CATATAN: Rilis ini membawa fitur UX Bahan (usulan bahan katalog, pemakaian sementara + rekonsiliasi Gudang). Migrasi aditif: 2 tabel baru KOSONG. Tidak ada usulan, pemakaian sementara, bahan, pergerakan stok, jurnal, penerimaan, atau pesan pelanggan yang dibuat/diubah oleh rilis. Rollback kode: jalankan scripts/rollback-guard-ux-bahan.sh dulu."
