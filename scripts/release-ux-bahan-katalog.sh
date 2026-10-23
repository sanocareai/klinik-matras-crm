#!/usr/bin/env bash
# RILIS "UX BAHAN: PEMAKAIAN SEMENTARA BAHAN KATALOG (STOK BELUM DIKETAHUI) + KUNCI material_id" — BACKEND + WEB + 1 MIGRASI (hanya mengganti ISI fungsi penjaga trigger; tanpa tabel/kolom/indeks/data baru). FAIL-CLOSED. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA = release live saat ini).
#   Kode: pemakaian sementara bisa TERTAUT KE ID BAHAN KATALOG (materialId) khusus bila stok bahan itu benar-benar belum diketahui (tidak ada satu pun pergerakan); wajib jumlah, satuan (=katalog), asal barang, alasan; "Perlu rekonsiliasi Gudang";
#   BUKAN Material Issue/pergerakan/saldo/biaya/jurnal. Bahan bersaldo diketahui (termasuk kurang/minus) ditolak (BAHAN_STOK_DIKETAHUI). Gudang menindaklanjuti lewat jalur stok resmi (stok awal/opname → pengeluaran resmi → tautkan; anti hitung ganda).
#   UI: drawer Order Produksi (tiga sumber selalu terlihat, fokus bahan, usulan tertinggal + retry idempoten, label hanya-lihat) + "Catat sementara — stok belum diketahui".
#   MIGRASI: trigger unit_provisional_usages_guard sebelumnya baru mengunci material_id SESUDAH status final; kini material_id TIDAK bisa diubah lewat SQL langsung (kecuali rekonsiliasi TAUTKAN_ISSUE NULL → bahan pergerakan resmi). Koreksi tetap = baris versi baru.
#   Kompatibel mundur: kode lama (baseline) tidak pernah mengisi/mengubah material_id di luar rekonsiliasi, jadi trigger baru aman untuk kode lama (rollback kode aman; rekonsiliasi ke bahan BERBEDA dari tautan katalog ditolak trigger).
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, TEPAT 1 migrasi yang di-pin + pemindai DDL + uji negatif, schema.prisma/dependensi/Docker identik) → (2) audit produksi baca-saja + sidik jari beku + sidik jari skema
#              → (R) --rehearsal-penuh: backup nyata + image kandidat bertag rehearsal + restore + MIGRASI pada salinan + uji aplikasi pada salinan + build web final + bukti 36 jam
#              → rilis penuh: (3) backup → (4) release dir + build web → (5) image baru → pemeriksaan data nyata (restore + migrasi pada salinan) → (6) migrasi production (backend lama tetap melayani) → (7) switch → (8) verifikasi + smoke baca-saja + sidik jari beku.
#
#   cat scripts/release-ux-bahan-katalog.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/ubk.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/ubk.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/ubk.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-penuh > /tmp/ubk.out 2>&1 < /dev/null &'   # TANPA release dir/switch/migrasi production; menulis bukti 36 jam
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/ubk.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/ubk.out 2>&1 < /dev/null &'                    # rilis penuh: WAJIB ada bukti --rehearsal-penuh LULUS untuk SHA + baseline yang sama (<36 jam)
#
# ROLLBACK: kode: pasang kembali image lama (tag rollback-pre-ubk-<sha8>) dan buat ulang container dari release sebelumnya; migrasi TIDAK perlu dibalik (hanya fungsi penjaga yang lebih ketat; tabel/kolom/data tidak berubah) dan aman untuk kode lama.
#   Catatan tertaut katalog yang dibuat kode baru tampil sebagai pemakaian sementara biasa di UI lama; menautkannya ke bahan BERBEDA ditolak trigger.
# (dibangkitkan oleh scripts/gen-release-ux-bahan-katalog.cjs; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang; templat sha256 bd68ce2f31c3…)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/ux-bahan-drawer-pemakaian}"
# Migrasi live terakhir (HARUS = migrasi terakhir di baseline, kandidat, dan produksi) dan jumlahnya: rilis ini tidak menambah/mengubah migrasi.
# Baseline: migrasi terakhir + jumlah (kandidat = baseline + TEPAT 1 migrasi rilis).
LIVE_MIG_TERAKHIR="20261226090000_bahan_usulan_pemakaian_sementara"; LIVE_MIG_JUMLAH="266"
# Migrasi rilis yang SUDAH diaudit (nama + sha256 isi LF) dan hasil pemindai DDL-nya. Selisih sekecil apa pun = berhenti.
MIG_NAME="20261227090000_pemakaian_sementara_material_id_terkunci"; MIG_PIN="febdc91370b7669263746913ba122c23e27aea0e5b5793f2626d95b41986fd40"; SCAN_EXPECT='FUNGSI_PENJAGA=1;PERNYATAAN=1'
FUNGSI_PENJAGA="unit_provisional_usages_guard"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skrip rilis ini + guard). Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261227090000_pemakaian_sementara_material_id_terkunci/migration\.sql|backend/src/lib/domain/bahanUsulan\.js|backend/src/routes/productionAdopsi\.js|backend/src/services/productionOrderExport\.js|backend/src/services/unitProvisionalUsageService\.js|backend/tests/bahanUsulan\.test\.js|backend/tests/integration/pemakaianSementaraBahanKatalog\.integration\.test\.js|backend/tests/releaseUxBahanDrawer\.test\.js|backend/tests/releaseUxBahanKatalog\.test\.js|frontend/src/features/production/OrderProduksiPanel\.jsx|frontend/src/features/production/bahan/BahanBelumAda\.jsx|frontend/src/features/production/bahan/BahanTab\.jsx|frontend/src/features/production/bahan/CatatBahanBaru\.jsx|frontend/src/features/production/bahan/FormSementaraKatalog\.jsx|frontend/src/features/production/bahan/PemakaianAktualBagian\.jsx|frontend/src/features/production/bahan/PemakaianSementaraDaftar\.jsx|frontend/src/features/production/bahan/bahanModel\.js|frontend/src/lib/roles\.js|frontend/src/pages/bengkel/ProductionWorkOrders\.jsx|frontend/src/pages/warehouse/WarehouseUsulanBahan\.jsx|frontend/tests/bahanDrawerRilis\.test\.js|frontend/tests/bahanModel\.test\.js|frontend/tests/bahanUsulanSementara\.test\.js|frontend/tests/orderProduksiAdopsi\.test\.js|frontend/tests/orderProduksiDirectList\.test\.js|scripts/gen-release-ux-bahan-drawer\.cjs|scripts/gen-release-ux-bahan-katalog\.cjs|scripts/lib/rehearsal-kode-ux-bahan-drawer\.mjs|scripts/lib/rehearsal-ux-bahan-katalog\.mjs|scripts/lib/scan-migrasi-material-id-terkunci\.mjs|scripts/lib/smoke-ux-bahan-drawer\.mjs|scripts/lib/smoke-ux-bahan-katalog\.mjs|scripts/release-ux-bahan-drawer\.sh|scripts/release-ux-bahan-katalog\.sh|scripts/templates/release-ux-bahan-drawer\.sh\.tpl|scripts/templates/release-ux-bahan-katalog\.sh\.tpl)$'
BACKEND_SRC_EXPECT="backend/src/lib/domain/bahanUsulan.js backend/src/routes/productionAdopsi.js backend/src/services/productionOrderExport.js backend/src/services/unitProvisionalUsageService.js"
FRONTEND_SRC_EXPECT="frontend/src/features/production/OrderProduksiPanel.jsx frontend/src/features/production/bahan/BahanBelumAda.jsx frontend/src/features/production/bahan/BahanTab.jsx frontend/src/features/production/bahan/CatatBahanBaru.jsx frontend/src/features/production/bahan/FormSementaraKatalog.jsx frontend/src/features/production/bahan/PemakaianAktualBagian.jsx frontend/src/features/production/bahan/PemakaianSementaraDaftar.jsx frontend/src/features/production/bahan/bahanModel.js frontend/src/lib/roles.js frontend/src/pages/bengkel/ProductionWorkOrders.jsx frontend/src/pages/warehouse/WarehouseUsulanBahan.jsx"
# Perubahan live yang TIDAK boleh hilang/berubah: hotfix Stock Count; berkas pelindung identik dengan baseline (Koreksi Gudang inti, jurnal, otorisasi, Produksi override, Stock Count).
HOTFIX_STOCK_COUNT="b5268e1f7d8e1a15a251106dee0a136898ee5ce1"
GUARD_UNCHANGED="backend/src/services/warehouseCorrection.js backend/src/routes/gudangKoreksi.js backend/src/services/inventoryLedger.js backend/src/services/inventorySegregation.js backend/src/services/opnameCutover.js backend/src/services/opnameMatriks.js backend/src/services/pergerakanSesiHitung.js backend/src/services/identitasHitung.js backend/src/services/finance/journal.js backend/src/services/finance/posting/inventory.js backend/src/middleware/authorize.js backend/src/middleware/auth.js backend/src/constants/permissions.js backend/src/lib/activityLog.js backend/src/lib/jejakPerubahan.js backend/src/services/gudangBeranda.js backend/src/services/adminOverrideSwitch.js backend/src/services/deliveryOverrideAdmin.js backend/src/services/productionStepCommandService.js backend/src/services/productionMaterialIssueCommandService.js backend/src/routes/productionPlanning.js"
LIVE_ANCESTORS="0cd0262be54b40665577816d71609e1a49c21547 4394c8288944a7116fbe5970c037d66a14e4ec12 1f79ddd28264d8b8fdf6ebb6cda111e9758cb628 624f08d8b5a77305a152e915e24f0023a2e35524 d82e6e3d9ced46b423be57ca0eab680f38953587 fd38f6c2382af914d1ebdd531a5dc430cff758c9 96cced3f9ba271bf1ecf4b9842d99bd035568994 e47f37e2d6690130525681863ff467682e30f3c4 57198ad687045519a12af14a3097ccf6b61e9054 58cbc284aa71038ce2694e4579282f5e5abf3a05 bcf8b77031100bb62ebfb7ed27f5e15a243981d0 20606872412290a0a80f563e605f7717bf57f3e0 10294dcbc45d7e13c737721ddaa34e38f5b2ee77 08d62e7d713b08fc9e0f1d898c37791352476b5b 799d3e93de192c604a14f1c11fe7436538689bb0 56b87721f84c1d16a2cd1655e40787e2b626cb0f e5a32cd246b2233e9d05d9b2cbff733e4497725d 229755d6eae125f82671d173898f71815d13f080 f293c5879fdac10e5ef0e1bb8a1169ef9ce8bef6 ca9bdea72a03df5794658fb485c6f3a79b360eee 694f21846f206edba5542e68ffe4c3ea98a47c24"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
PREFLIGHT_ONLY=0; REHEARSAL_ONLY=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; [ "$a" = "--rehearsal-penuh" ] && REHEARSAL_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/ux-bahan-katalog-${DEPLOY_SHORT}-${TS}"
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
Rollback kode setelah switch (migrasi TIDAK dibalik: hanya fungsi penjaga yang lebih ketat; tabel/kolom/data tidak berubah; kode lama kompatibel):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Catatan tertaut bahan katalog yang sudah dibuat kode baru tetap utuh; di UI lama tampil sebagai pemakaian sementara biasa dan menautkannya ke bahan BERBEDA ditolak trigger.
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-ux-bahan-katalog.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "ubk\.sh\|release-ux-bahan-katalog\|pgrep\|node src/index.js" | grep -v "$$" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
if [ "$PREFLIGHT_ONLY" = "0" ] && [ "$REHEARSAL_ONLY" = "0" ]; then [ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"; fi

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, TANPA migrasi/dependensi"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" "+refs/heads/main:refs/remotes/origin/main" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
MAIN_FILES=""
if ! sg merge-base --is-ancestor "$MAIN_SHA" "$BASE_SHA"; then
  sg merge-base --is-ancestor "$BASE_SHA" "$MAIN_SHA" || die "origin/main (${MAIN_SHA:0:8}) dan baseline ${BASE_SHA:0:8} bercabang — gabungkan lineage terbaru lalu ulangi tes/preflight"
  MAIN_EXTRA="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA" | grep -Ev '^(scripts/|docs/|backend/tests/release[A-Za-z0-9]+\.test\.js$)' || true)"
  [ -z "$MAIN_EXTRA" ] || { printf '%s\n' "$MAIN_EXTRA" | sed 's/^/        /'; die "origin/main memuat perubahan kode yang tidak ada di release aktif — berhenti"; }
  MAIN_FILES="$(sg diff --name-only "$BASE_SHA" "$MAIN_SHA")"
  warn "origin/main (${MAIN_SHA:0:8}) lebih maju dari baseline hanya pada scripts/docs — ikut diizinkan"
fi
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat ${DEPLOY_SHORT}: rilis akan menghilangkan isi main — gabungkan main ke kandidat dulu"
for A in $LIVE_ANCESTORS; do
  sg cat-file -e "${A}^{commit}" 2>/dev/null || die "commit live ${A:0:8} tidak ada di repo sumber"
  sg merge-base --is-ancestor "$A" "$DEPLOY_SHA" || die "commit live ${A:0:8} BUKAN leluhur kandidat — rilis akan menghilangkan perubahan live; gabungkan baseline terbaru dulu"
done
ok "semua commit live (Koreksi Gudang, Produksi override, Riwayat Referensi, bukti serah) adalah leluhur kandidat"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" | { grep -Fvx -f <(printf '%s\n' "$MAIN_FILES") || true; } || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -q 'production-evidence' || die "artefak foto uji ikut ter-commit"
! printf '%s\n' "$CHANGED" | grep -q 'receipt-proofs' || die "artefak unggahan uji ikut ter-commit"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)\.env' || die "berkas .env ikut ter-commit"
! printf '%s\n' "$CHANGED" | grep -q '^driver-mobile/' || die "driver-mobile berubah — rilis ini tidak membawa app Driver"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
# MIGRASI: berkas backend/prisma yang berubah HARUS tepat 1 migrasi rilis; skema (schema.prisma), dependensi, Dockerfile, dan compose IDENTIK; migrasi baseline tidak diubah/dihapus.
EXPECT_PRISMA="backend/prisma/migrations/${MIG_NAME}/migration.sql"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$PRISMA_CHANGED" = "$EXPECT_PRISMA" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat migrasi rilis ini (tanpa perubahan schema.prisma)"; }
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
for p in backend/prisma/schema.prisma backend/package.json backend/package-lock.json backend/Dockerfile docker-compose.yml docker-compose.release.yml; do
  [ "$(sg rev-parse -q --verify "${BASE_SHA}:${p}" 2>/dev/null || echo tidak-ada)" = "$(sg rev-parse -q --verify "${DEPLOY_SHA}:${p}" 2>/dev/null || echo tidak-ada)" ] || die "${p} BERBEDA antara baseline dan kandidat — rilis ini hanya mengganti isi fungsi penjaga"
done
ok "schema.prisma, dependensi, Dockerfile, dan compose IDENTIK dengan baseline; berkas prisma yang berubah = tepat migrasi rilis"
[[ "$MIG_NAME" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $MIG_NAME"
ALL_SQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | tr -d '\r')"
h="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
[ "$MIG_PIN" = "$h" ] || die "isi migrasi ${MIG_NAME} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
ok "migrasi ${MIG_NAME}: sha256 cocok pin (${h:0:12})"
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai DDL migrasi "material_id catatan pemakaian sementara terkunci" (baca stdin = SQL tanpa komentar/baris kosong; exit 1 + pesan bila ada yang di luar daftar putih).
// Daftar putih = SATU pernyataan: CREATE OR REPLACE FUNCTION unit_provisional_usages_guard() RETURNS trigger AS $$ ...badan... $$ LANGUAGE plpgsql;
// Badan fungsi tidak boleh memuat DDL/DML (DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, EXTENSION, DELETE FROM, INSERT, UPDATE ... SET, COPY, EXECUTE, DO). Tidak ada pernyataan lain (tidak ada ALTER/CREATE TABLE/INDEX/TRIGGER, tidak ada DROP/UPDATE/DELETE/INSERT).
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8").replace(/\r\n/g, "\n").trim();
const gagal = (m) => { console.error("DITOLAK: " + m); process.exit(1); };
const awal = /^CREATE OR REPLACE FUNCTION unit_provisional_usages_guard\(\) RETURNS trigger AS \$\$\n/;
const akhir = /\n\$\$ LANGUAGE plpgsql;$|\nEND \$\$ LANGUAGE plpgsql;$/;
if (!awal.test(sql)) gagal("pernyataan pertama bukan CREATE OR REPLACE FUNCTION unit_provisional_usages_guard() RETURNS trigger AS $$");
if (!akhir.test(sql)) gagal("pernyataan tidak diakhiri $$ LANGUAGE plpgsql;");
const hitungDolar = (sql.match(/\$\$/g) || []).length; if (hitungDolar !== 2) gagal(`jumlah penanda $$ harus 2 (satu fungsi), ditemukan ${hitungDolar}`);
const badan = sql.slice(sql.indexOf("$$") + 2, sql.lastIndexOf("$$"));
const sisa = sql.slice(sql.lastIndexOf("$$") + 2).replace(/\s*LANGUAGE plpgsql;\s*/, "");
if (sisa.trim() !== "") gagal("ada teks setelah fungsi: " + sisa.trim().slice(0, 60));
const terlarang = [/\bDROP\b/i, /\bALTER\b/i, /\bCREATE\b/i, /\bTRUNCATE\b/i, /\bGRANT\b/i, /\bREVOKE\b/i, /\bEXTENSION\b/i, /\bDELETE\s+FROM\b/i, /\bINSERT\b/i, /\bUPDATE\s+\S+\s+SET\b/i, /\bCOPY\b/i, /\bEXECUTE\b(?!\s+FUNCTION)/i, /\bDO\s+\$/i, /\bPERFORM\b/i];
for (const re of terlarang) if (re.test(badan)) gagal("badan fungsi memuat " + re.source);
// semua RAISE hanya RAISE EXCEPTION (tidak ada NOTICE/ASSERT yang menulis)
if ((badan.match(/\bRAISE\b/g) || []).length !== (badan.match(/\bRAISE EXCEPTION\b/g) || []).length) gagal("RAISE selain EXCEPTION");
// satu-satunya pernyataan akhir fungsi (tidak ada ';' di luar badan)
if (/;/.test(sql.slice(0, sql.indexOf("$$"))) ) gagal("tanda ';' sebelum badan fungsi");
console.log("FUNGSI_PENJAGA=1;PERNYATAAN=1");
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hasil pemindai migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: SATU pernyataan CREATE OR REPLACE FUNCTION ${FUNGSI_PENJAGA}(); badan fungsi tanpa DDL/DML; tanpa tabel/kolom/indeks/trigger baru, tanpa DROP/ALTER/UPDATE/DELETE/INSERT/GRANT/EXTENSION"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hasil ≠ SCAN_EXPECT.
NEG=0
harus_ditolak() { local nama="$1" teks="$2" o; if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi; NEG=$((NEG+1)); }
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE units" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "UPDATE units" "$(tambah_stmt "UPDATE \"units\" SET \"status\" = 'RECEIVED';")"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "units";')"
harus_ditolak "INSERT" "$(tambah_stmt "INSERT INTO \"stock_movements\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "units";')"
harus_ditolak "ALTER TABLE ADD COLUMN" "$(tambah_stmt 'ALTER TABLE "units" ADD COLUMN "x" TEXT;')"
harus_ditolak "CREATE TABLE liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL);')"
harus_ditolak "CREATE INDEX" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("status");')"
harus_ditolak "CREATE TRIGGER pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE UPDATE ON "units" FOR EACH ROW EXECUTE FUNCTION unit_provisional_usages_guard();')"
harus_ditolak "DROP TRIGGER" "$(tambah_stmt 'DROP TRIGGER "unit_provisional_usages_guard_trg" ON "unit_provisional_usages";')"
harus_ditolak "DISABLE TRIGGER" "$(tambah_stmt 'ALTER TABLE "unit_provisional_usages" DISABLE TRIGGER ALL;')"
harus_ditolak "fungsi liar kedua" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "fungsi lain (OR REPLACE)" "$(tambah_stmt 'CREATE OR REPLACE FUNCTION production_adopsi_append_only() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "badan fungsi memuat DROP" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION 'riwayat penyelesaian tidak boleh berubah saat dibatalkan';/DROP TABLE units;/")"
harus_ditolak "badan fungsi memuat DELETE FROM" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION 'tautan bahan katalog (material_id) catatan pemakaian sementara tidak boleh diubah; koreksi memakai catatan versi baru';/DELETE FROM units;/")"
harus_ditolak "nama fungsi diganti" "$(printf '%s\n' "$ALL_SQL" | sed 's/FUNCTION unit_provisional_usages_guard()/FUNCTION unit_lain_guard()/')"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "units" TO PUBLIC;')"
ok "uji negatif pemindai: ${NEG} mutan (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER/CREATE TABLE-INDEX-TRIGGER/DISABLE TRIGGER/fungsi liar/badan berbahaya/EXTENSION/GRANT) SEMUA ditolak"
CAND_MIGS="$(sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u)"
BASE_MIGS="$(sg ls-tree --name-only "$BASE_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u)"
[ "$(printf '%s\n' "$BASE_MIGS" | grep -c .)" = "$LIVE_MIG_JUMLAH" ] && [ "$(printf '%s\n' "$BASE_MIGS" | tail -n 1)" = "$LIVE_MIG_TERAKHIR" ] || die "migrasi baseline tidak sesuai pin (${LIVE_MIG_JUMLAH}, terakhir ${LIVE_MIG_TERAKHIR})"
[ "$(printf '%s\n' "$CAND_MIGS" | grep -c .)" = "$(( LIVE_MIG_JUMLAH + 1 ))" ] && [ "$(printf '%s\n' "$CAND_MIGS" | tail -n 1)" = "$MIG_NAME" ] || die "migrasi kandidat harus = baseline + ${MIG_NAME} (terakhir)"
cmp -s <(printf '%s\n' "$BASE_MIGS" "$MIG_NAME") <(printf '%s\n' "$CAND_MIGS") || die "himpunan migrasi kandidat bukan tepat baseline + migrasi rilis"
ok "migrasi kandidat = baseline (${LIVE_MIG_JUMLAH}) + ${MIG_NAME}"
sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA" || die "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} BUKAN leluhur kandidat"
sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$BASE_SHA" || die "hotfix Stock Count ${HOTFIX_STOCK_COUNT:0:8} belum ada di baseline live"
for f in $GUARD_UNCHANGED; do
  [ "$(sg rev-parse "${BASE_SHA}:${f}")" = "$(sg rev-parse "${DEPLOY_SHA}:${f}")" ] || die "${f} berbeda antara baseline dan kandidat — rilis ini tidak boleh menyentuhnya"
done
ok "hotfix Stock Count ada di baseline DAN kandidat; $(printf '%s\n' $GUARD_UNCHANGED | wc -w) berkas pelindung (Koreksi Gudang inti, jurnal, otorisasi, izin, Stock Count, Produksi override) identik dengan baseline"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit"

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
for T in stock_movements goods_receipts goods_receipt_lines goods_receipt_events materials '"User"' activity_events warehouse_corrections stock_counts material_issues fin_journal_entries fin_journal_lines fin_purchase_orders fin_supplier_bills fin_supplier_bill_allocations fin_supplier_payments production_runs_v2 material_issue_lines stock_transfers stock_transfer_lines stock_count_lines replenishment_requests damaged_stock_records return_records stock_adjustment_requests material_reservations_v2 fin_stock_movement_valuations; do
  [ "$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename='${T//\"/}'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
# Keadaan production: SEGAR = tepat himpunan baseline (migrasi rilis pending); LANJUT = baseline + migrasi rilis SUDAH terpasang dengan checksum yang benar (rilis sebelumnya terhenti sesudah migrasi). Selain itu = berhenti.
RAW_SHA="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
keadaan_produksi() {
  local sfx="$1" lama row
  psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$BK_DIR/applied-sebelum${sfx}.txt" || { echo "TOLAK: gagal membaca migrasi terpasang"; return 1; }
  if cmp -s "$BK_DIR/applied-sebelum${sfx}.txt" <(printf '%s\n' "$BASE_MIGS"); then echo SEGAR; return 0; fi
  lama="$(grep -vxF "$MIG_NAME" "$BK_DIR/applied-sebelum${sfx}.txt" || true)"
  [ "$lama" = "$BASE_MIGS" ] || { echo "TOLAK: migrasi terpasang BUKAN baseline atau baseline + migrasi rilis"; return 1; }
  row="$(psql_live -At -c "select checksum||'|'||applied_steps_count::text||'|'||(finished_at is not null)::text||'|'||(rolled_back_at is null)::text from _prisma_migrations where migration_name='${MIG_NAME}'")"
  [ "$row" = "$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | sha256sum | cut -d' ' -f1)|1|true|true" ] || { echo "TOLAK: migrasi rilis terpasang tetapi checksum/status tidak cocok"; return 1; }
  echo LANJUT
}
KEADAAN="$(keadaan_produksi "")" || die "${KEADAAN}"
[ "$KEADAAN" = "SEGAR" ] || [ "$KEADAAN" = "LANJUT" ] || die "keadaan production tidak dikenal: ${KEADAAN}"
MIG_SEBELUM="$LIVE_MIG_JUMLAH"
ok "keadaan production: ${KEADAAN} (baseline ${MIG_SEBELUM} migrasi; migrasi rilis ${MIG_NAME} $([ "$KEADAAN" = "SEGAR" ] && echo 'pending' || echo 'SUDAH terpasang'))"
SKEMA_SQL="select md5(string_agg(x, '|' order by x)) from (select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') x from information_schema.columns where table_schema='public' union all select conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace union all select tablename||':'||indexname||':'||indexdef from pg_indexes where schemaname='public' union all select event_object_table||':'||trigger_name||':'||action_timing||':'||event_manipulation from information_schema.triggers where trigger_schema='public') s"
FUNC_SQL="select md5(pg_get_functiondef('unit_provisional_usages_guard'::regproc))"
SKEMA_PRA="$(psql_live -At -c "$SKEMA_SQL")"; [ -n "$SKEMA_PRA" ] || die "sidik jari skema produksi kosong"
FUNC_PRA="$(psql_live -At -c "$FUNC_SQL")"; [[ "$FUNC_PRA" =~ ^[0-9a-f]{32}$ ]] || die "sidik jari fungsi penjaga tidak terbaca"
ok "sidik jari skema (semua tabel/kolom/constraint/indeks/trigger) ${SKEMA_PRA:0:12}…; fungsi penjaga sebelum ${FUNC_PRA:0:12}…"
KOREKSI_N="$(psql_live -At -c "select count(*) from warehouse_corrections")"; SM_N="$(psql_live -At -c "select count(*) from stock_movements")"; GR_N="$(psql_live -At -c "select count(*) from goods_receipts")"
[[ "$KOREKSI_N" =~ ^[0-9]+$ ]] && [[ "$SM_N" =~ ^[0-9]+$ ]] && [[ "$GR_N" =~ ^[0-9]+$ ]] || die "audit awal bukan angka"
USUL_N="$(psql_live -At -c "select count(*) from material_proposals")"; SEM_N="$(psql_live -At -c "select count(*) from unit_provisional_usages")"
[[ "$USUL_N" =~ ^[0-9]+$ ]] && [[ "$SEM_N" =~ ^[0-9]+$ ]] || die "audit usulan/sementara bukan angka"
ok "keadaan: koreksi=${KOREKSI_N}, pergerakan stok=${SM_N}, penerimaan=${GR_N}, usulan bahan=${USUL_N}, pemakaian sementara=${SEM_N} (rilis ini tidak mengubah satu pun)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")"
[[ "$BASE_TIDAK_SEIMBANG" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}"
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'pergerakan_stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'saldo_per_bahan', count(*), md5(coalesce(string_agg(s.material_id::text || ':' || s.q::text, '|' order by s.material_id),'')) from (select material_id, sum(qty) q from stock_movements where created_at < '$T0'::timestamp group by material_id) s
union all select 'penerimaan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipts x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'penerimaan_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_lines x where x.goods_receipt_id in (select id from goods_receipts where created_at < '$T0'::timestamp and updated_at < '$T0'::timestamp)
union all select 'penerimaan_event', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_events x where x.created_at < '$T0'::timestamp
union all select 'koreksi', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from warehouse_corrections x where x.requested_at < '$T0'::timestamp
union all select 'bahan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from materials x where x.created_at < '$T0'::timestamp
union all select 'jurnal_induk', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from fin_journal_entries x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'po', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_orders x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'tagihan_supplier', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bills x where x.created_at < '$T0'::timestamp
union all select 'alokasi_tagihan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bill_allocations x where x.bill_id in (select id from fin_supplier_bills where created_at < '$T0'::timestamp)
union all select 'pembayaran_supplier', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_payments x where x.created_at < '$T0'::timestamp
union all select 'run_produksi_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_runs_v2 x where x.created_at < '$T0'::timestamp
union all select 'pengeluaran_material', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from material_issues x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'pengeluaran_material_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from material_issue_lines x where x.material_issue_id in (select id from material_issues where created_at < '$T0'::timestamp and updated_at < '$T0'::timestamp)
union all select 'transfer_stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_transfers x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'transfer_stok_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_transfer_lines x where x.stock_transfer_id in (select id from stock_transfers where created_at < '$T0'::timestamp and updated_at < '$T0'::timestamp)
union all select 'opname', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_counts x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'opname_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_count_lines x where x.stock_count_id in (select id from stock_counts where created_at < '$T0'::timestamp and updated_at < '$T0'::timestamp)
union all select 'restok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from replenishment_requests x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'barang_rusak', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from damaged_stock_records x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'retur', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from return_records x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'penyesuaian', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_adjustment_requests x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'reservasi_produksi_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from material_reservations_v2 x where x.created_at < '$T0'::timestamp and x.updated_at < '$T0'::timestamp
union all select 'reservasi_v1_per_bahan', count(*), md5(coalesce(string_agg(r.material_id::text || ':' || r.q::text, '|' order by r.material_id),'')) from (select l.material_id, sum(l.requested_qty) q from material_issue_lines l join material_issues i on i.id = l.material_issue_id where i.created_at < '$T0'::timestamp and i.updated_at < '$T0'::timestamp and i.production_plan_id is null and i.status::text in ('APPROVED','READY_TO_PICK','PICKED') group by l.material_id) r
union all select 'valuasi_pergerakan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_stock_movement_valuations x where x.valued_at < '$T0'::timestamp
union all select 'usulan_bahan_id', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from material_proposals x where x.requested_at < '$T0'::timestamp
union all select 'pemakaian_sementara_id', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id),'')) from unit_provisional_usages x where x.recorded_at < '$T0'::timestamp
union all select 'event_aktivitas', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from activity_events x where x.created_at < '$T0'::timestamp
FPBEKU
)"
FPB_N=30
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
NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang (tersedia ${AVAIL_KB} KB)"
ok "ruang disk cukup (tersedia ${AVAIL_KB} KB)"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

# rehearsal_migrasi <image>: restore backup NYATA ke DB sementara → sidik jari identik → MIGRASI rilis pada salinan (image yang diuji) → skema/data lama identik, hanya isi fungsi penjaga berubah → uji aplikasi pada salinan → DB sementara DIHAPUS (production tidak tersentuh).
rehearsal_migrasi() {
  local IMG="$1"
  PHASE="5b-rehearsal-migrasi"; say "5b. Restore backup NYATA ke DB sementara, MIGRASI rilis pada salinan, uji aplikasi pada data nyata, sidik jari sebelum/sesudah, DB sementara dihapus (production tidak disentuh)"
  REH_DB="rehearsal_ubk_${TS}"
  dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
  reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true; }
  RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
  set +e; gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1; RESTORE_RC=$?; set -e
  RESTORE_ERR="$(grep -ciE 'ERROR:|FATAL|PANIC' "$BK_DIR/restore-rehearsal.log" || true)"; RESTORE_WARN="$(grep -ciE 'WARNING' "$BK_DIR/restore-rehearsal.log" || true)"
  [ "$RESTORE_RC" = "0" ] && [ "${RESTORE_ERR:-0}" = "0" ] || { grep -iE 'ERROR:|FATAL|PANIC' "$BK_DIR/restore-rehearsal.log" | LC_ALL=C sort | uniq -c | head -n 10 | sed 's/^/        /'; reh_drop; die "restore ke DB sementara TIDAK bersih (exit=${RESTORE_RC}, error=${RESTORE_ERR})"; }
  ok "restore bersih: exit=0, error=0, warning=${RESTORE_WARN:-0}"
  RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
  cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi"; }
  [ "$(RPSQL "$SKEMA_SQL")" = "$SKEMA_PRA" ] || { reh_drop; die "skema hasil RESTORE berbeda dari skema produksi"; }
  [ "$(RPSQL "$FUNC_SQL")" = "$FUNC_PRA" ] || { reh_drop; die "fungsi penjaga hasil RESTORE berbeda dari produksi"; }
  TABEL_LAMA="$(RPSQL "select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1")"
  [ "$(printf '%s\n' "$TABEL_LAMA" | grep -c .)" -ge 100 ] || { reh_drop; die "jumlah tabel di restore mencurigakan"; }
  FP_ALL=""
  while IFS= read -r t; do [ -n "$t" ] || continue; FP_ALL="${FP_ALL:+${FP_ALL} union all }select '${t}', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by md5(to_jsonb(x)::text)),'')) from \"${t}\" x"; done <<< "$TABEL_LAMA"
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-sebelum.txt" || { reh_drop; die "sidik jari penuh sebelum gagal"; }
  REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
  [ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
  REH_NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$CID_OLD")"; [ -n "$REH_NET" ] || { reh_drop; die "jaringan docker tidak terbaca"; }
  local URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}"
  # MIGRASI pada salinan, dengan IMAGE yang diuji
  docker run --rm --network "$REH_NET" -e DATABASE_URL="$URL" -e JWT_SECRET=rehearsal-tidak-dipakai "$IMG" npx prisma migrate deploy > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy pada salinan GAGAL"; }
  grep -q "${MIG_NAME}" "$BK_DIR/migrate-rehearsal.log" || { reh_drop; die "migrate deploy pada salinan tidak menerapkan ${MIG_NAME}"; }
  [ "$(RPSQL "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( LIVE_MIG_JUMLAH + 1 ))" ] || { reh_drop; die "jumlah migrasi pada salinan != baseline + 1"; }
  [ "$(RPSQL "select checksum from _prisma_migrations where migration_name='${MIG_NAME}'")" = "$RAW_SHA" ] || { reh_drop; die "checksum migrasi pada salinan BERBEDA dari berkas kandidat"; }
  [ "$(RPSQL "$SKEMA_SQL")" = "$SKEMA_PRA" ] || { reh_drop; die "migrasi MENGUBAH skema tabel/kolom/constraint/indeks/trigger (hanya isi fungsi yang boleh berubah)"; }
  FUNC_REH="$(RPSQL "$FUNC_SQL")"; [[ "$FUNC_REH" =~ ^[0-9a-f]{32}$ ]] && [ "$FUNC_REH" != "$FUNC_PRA" ] || { reh_drop; die "isi fungsi penjaga tidak berubah/terbaca setelah migrasi"; }
  [ "$(RPSQL "select count(*) from pg_trigger where tgname='unit_provisional_usages_guard_trg' and not tgisinternal")" = "1" ] || { reh_drop; die "trigger penjaga tidak tepat satu setelah migrasi"; }
  RPSQL "$FP_ALL" | LC_ALL=C sort > "$BK_DIR/fp-all-pasca-migrasi.txt" || { reh_drop; die "sidik jari penuh pasca-migrasi gagal"; }
  cmp -s "$BK_DIR/fp-all-sebelum.txt" "$BK_DIR/fp-all-pasca-migrasi.txt" || { diff "$BK_DIR/fp-all-sebelum.txt" "$BK_DIR/fp-all-pasca-migrasi.txt" || true; reh_drop; die "migrasi MENGUBAH isi tabel (harus tidak menulis data)"; }
  ok "migrasi pada salinan: ${MIG_NAME} diterapkan (${LIVE_MIG_JUMLAH} → $(( LIVE_MIG_JUMLAH + 1 ))); skema semua tabel IDENTIK; isi \$(printf '%s\n' "$TABEL_LAMA" | grep -c .) tabel IDENTIK; hanya isi fungsi penjaga berubah (${FUNC_PRA:0:8} → ${FUNC_REH:0:8})"
  cat > "$BK_DIR/rehearsal-kode.mjs" <<'REHNODE'
// Uji KODE BARU + migrasi "material_id catatan pemakaian sementara terkunci" pada SALINAN RESTORE backup nyata (DB sementara yang DIHAPUS skrip rilis; production tidak tersentuh).
// Dijalankan di image kandidat dengan DATABASE_URL = DB rehearsal SESUDAH migrasi diterapkan dan sidik jari tabel lama terbukti identik. Boleh menulis (pada salinan): mencatat/koreksi/menolak pemakaian sementara bahan katalog
// pada unit dan bahan NYATA dari restore, lalu membuktikan stok/Material Issue/jurnal tidak berubah, trigger menolak ubah material_id lewat SQL, dan jalur resmi tetap menolak bahan bersaldo diketahui.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
let gagal = 0; let dilewati = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 240) : "")); };
const lewati = (n, a) => { dilewati += 1; console.log(`SKIP ${n} — DILEWATI: ${a}`); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const svc = await import("/app/src/services/unitProvisionalUsageService.js");
const inti = async () => ({ sm: await hitung("select count(*)::int n from stock_movements"), mi: await hitung("select count(*)::int n from material_issues"), jur: await hitung("select count(*)::int n from fin_journal_entries"), mat: await hitung("select count(*)::int n from materials"), usul: await hitung("select count(*)::int n from material_proposals") });

// 1. migrasi tercatat + fungsi penjaga memuat aturan baru
const mig = await prisma.$queryRawUnsafe("select migration_name from _prisma_migrations where migration_name like '%pemakaian_sementara_material_id_terkunci' and finished_at is not null and rolled_back_at is null");
cek("migrasi material_id terkunci tercatat selesai pada salinan", mig.length === 1, mig.map((m) => m.migration_name).join());
const def = (await prisma.$queryRawUnsafe("select pg_get_functiondef('unit_provisional_usages_guard'::regproc) d"))[0].d;
cek("fungsi penjaga memuat aturan 'tautan bahan katalog (material_id) ... tidak boleh diubah'", /material_id\) catatan pemakaian sementara tidak boleh diubah/.test(def));
cek("trigger penjaga tetap terpasang sekali pada tabel", await hitung("select count(*)::int n from pg_trigger where tgname='unit_provisional_usages_guard_trg' and not tgisinternal") === 1);

// 2. data nyata: unit aktif + pelaku + bahan katalog TANPA pergerakan (stok belum diketahui) dan bahan BERSALDO diketahui
const unit = await prisma.unit.findFirst({ where: { status: { notIn: ["CANCELLED", "DELIVERED"] } }, select: { id: true, unitCode: true } });
const aktor = await prisma.user.findFirst({ where: { active: true }, select: { id: true } });
const tanpa = (await prisma.$queryRawUnsafe(`select m.id::text id, m.code, m.name, m.unit::text unit from materials m where m.active and (m.kind is null or m.kind <> 'PERLENGKAPAN_STOK') and not exists (select 1 from stock_movements s where s.material_id = m.id) order by m.code limit 1`))[0];
const dengan = (await prisma.$queryRawUnsafe(`select m.id::text id, m.code, m.unit::text unit from materials m where m.active and (m.kind is null or m.kind <> 'PERLENGKAPAN_STOK') and exists (select 1 from stock_movements s where s.material_id = m.id) order by m.code limit 1`))[0];
cek("data restore punya unit aktif dan pelaku aktif", !!unit && !!aktor, unit?.unitCode);
cek("data restore punya bahan katalog TANPA catatan stok (kasus 'stok belum diketahui')", !!tanpa, tanpa ? `${tanpa.code}` : "tidak ada");
if (unit && aktor && tanpa) {
  const e0 = await inti(); const kunci = `rehearsal-katalog-${Date.now()}-aaaa`;
  const isi = { materialId: tanpa.id, qty: 2, uom: tanpa.unit, originNote: "Sisa bahan di meja produksi", alasanPencatatan: "Stok bahan belum tercatat di Gudang; bahan sudah terlanjur dipakai pada unit ini" };
  const a = await svc.catatPemakaianSementara(prisma, { unitId: unit.id, input: isi, actorId: aktor.id, idempotencyKey: kunci });
  cek("catat sementara bahan katalog stok belum diketahui: tertaut ke ID katalog, PERLU_REKONSILIASI, nama dari katalog", a.item.materialId === tanpa.id && a.item.status === "PERLU_REKONSILIASI" && a.item.name === tanpa.name && a.item.tertautKatalog === true && a.item.proposalId === null, `${a.item.name} ${a.item.status}`);
  const ulang = await svc.catatPemakaianSementara(prisma, { unitId: unit.id, input: isi, actorId: aktor.id, idempotencyKey: kunci });
  cek("klik ganda (kunci sama) = replay, satu baris", ulang.replayed === true && ulang.item.id === a.item.id && await hitung(`select count(*)::int n from unit_provisional_usages where material_id = '${tanpa.id}'`) === 1);
  const e1 = await inti(); cek("TANPA Material Issue/pergerakan/jurnal/bahan/usulan baru; stok bahan tetap tanpa catatan", JSON.stringify(e1) === JSON.stringify(e0) && await hitung(`select count(*)::int n from stock_movements where material_id = '${tanpa.id}'`) === 0, JSON.stringify(e1));
  let kode = null; try { await svc.catatPemakaianSementara(prisma, { unitId: unit.id, input: { ...isi, originNote: "" }, actorId: aktor.id, idempotencyKey: kunci + "x" }); } catch (e) { kode = e.code; }
  cek("asal barang kosong ditolak (SEMENTARA_ASAL_WAJIB)", kode === "SEMENTARA_ASAL_WAJIB", kode);
  if (dengan) { let k2 = null; try { await svc.catatPemakaianSementara(prisma, { unitId: unit.id, input: { ...isi, materialId: dengan.id, uom: dengan.unit }, actorId: aktor.id, idempotencyKey: kunci + "y" }); } catch (e) { k2 = e.code; } cek(`bahan bersaldo diketahui (${dengan.code}) ditolak (BAHAN_STOK_DIKETAHUI)`, k2 === "BAHAN_STOK_DIKETAHUI", k2); } else lewati("bahan bersaldo diketahui ditolak", "tidak ada bahan dengan pergerakan pada restore");
  // trigger: ubah material_id lewat SQL langsung harus ditolak
  const lain = (await prisma.$queryRawUnsafe(`select id::text id from materials where id <> '${tanpa.id}' limit 1`))[0];
  let err = null; try { await prisma.$executeRawUnsafe(`UPDATE unit_provisional_usages SET material_id = '${lain.id}' WHERE id = '${a.item.id}'`); } catch (e) { err = e; }
  cek("trigger menolak UPDATE material_id lewat SQL langsung pada catatan tertaut katalog", !!err && /material_id\) catatan pemakaian sementara tidak boleh diubah/.test(String(err.message)), err ? String(err.message).slice(0, 120) : "TIDAK ditolak");
  err = null; try { await prisma.$executeRawUnsafe(`UPDATE unit_provisional_usages SET material_id = NULL WHERE id = '${a.item.id}'`); } catch (e) { err = e; }
  cek("trigger menolak mengosongkan material_id", !!err);
  cek("tautan bahan tidak berubah setelah percobaan", (await prisma.unitProvisionalUsage.findUnique({ where: { id: a.item.id } })).materialId === tanpa.id);
  // koreksi = baris versi baru, bahan terkunci
  const kor = await svc.koreksiPemakaianSementara(prisma, { usageId: a.item.id, input: { qty: 3, originNote: "Sisa bahan di meja produksi (hitung ulang)" }, alasan: "Jumlah salah hitung", actorId: aktor.id, idempotencyKey: kunci + "k" });
  cek("koreksi: baris lama DIBATALKAN, baris baru membawa ID katalog yang sama (versi baru), tanpa mengubah baris lama", kor.item.materialId === tanpa.id && kor.item.correctedFromId === a.item.id && kor.lama.status === "DIBATALKAN" && (await prisma.unitProvisionalUsage.findUnique({ where: { id: a.item.id } })).materialId === tanpa.id);
  const kand = await svc.kandidatPergerakan(prisma, kor.item.id);
  cek("kandidat rekonsiliasi: petunjuk jalur stok resmi + bahan katalog; hanya bahan itu", kand.bahanTujuanId === tanpa.id && kand.bahanKatalog?.kode === tanpa.code && /stok awal\/opname/.test(kand.petunjuk), kand.petunjuk?.slice(0, 80));
  const unitList = await svc.ambilPemakaianSementaraUnit(prisma, unit.id);
  cek("daftar unit menandai tertautKatalog + bahanKatalog; total perlu rekonsiliasi terhitung", unitList.items.some((i) => i.tertautKatalog && i.bahanKatalog?.kode === tanpa.code) && unitList.total.perluRekonsiliasi >= 1);
  const e2 = await inti(); cek("setelah koreksi: stok/Material Issue/jurnal/bahan/usulan tetap tidak berubah", JSON.stringify(e2) === JSON.stringify(e0));
}
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal + " skip=" + dilewati);
process.exit(gagal ? 1 : 0);
REHNODE
  docker run --rm -i --network "$REH_NET" -e DATABASE_URL="$URL" -e JWT_SECRET=rehearsal-tidak-dipakai "$IMG" node --input-type=module - < "$BK_DIR/rehearsal-kode.mjs" > "$BK_DIR/rehearsal-kode-baru.log" 2>&1 || { cat "$BK_DIR/rehearsal-kode-baru.log"; reh_drop; die "uji aplikasi pada salinan restore GAGAL"; }
  ok "uji aplikasi pada salinan (kode BARU, data produksi nyata): $(tail -n 1 "$BK_DIR/rehearsal-kode-baru.log"); $(grep -c '^PASS' "$BK_DIR/rehearsal-kode-baru.log") pemeriksaan lulus"
  reh_drop
  [ "$(psql_live -At -c "select count(*) from pg_database where datname = '${REH_DB}'")" = "0" ] || die "DB rehearsal masih tersisa"
  ok "DB sementara dihapus; uji tulis dilakukan HANYA pada salinan"
}
WS=""
cleanup_ws() { if [ -n "${WS:-}" ] && [[ "$WS" == "$HOME/release-rehearsal/ubk-"* ]]; then rm -rf -- "$WS" 2>/dev/null || sudo -n rm -rf -- "$WS" 2>/dev/null || true; fi; }
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; cleanup_ws; exit $rc' EXIT
MARK="$HOME/release-backups/.rehearsal-penuh-ok-ux-bahan-katalog-${DEPLOY_SHA}"
if [ "$REHEARSAL_ONLY" = "1" ]; then
  PHASE="3-backup-rehearsal"; say "R1. Backup produksi NYATA + checksum (untuk rehearsal)"
  BACKUP_FILE="$HOME/backups/pre-ubk-${DEPLOY_SHORT}-${TS}-rehearsal.sql.gz"
  dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
  gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
  gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
  mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"; ( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
  ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"
  PHASE="4-build-web-rehearsal"; say "R2. Build web FINAL di ruang kerja sementara (dist production TIDAK disentuh; ruang kerja dihapus setelahnya)"
  WS="$HOME/release-rehearsal/ubk-${DEPLOY_SHORT}-${TS}"; mkdir -p "$WS" || die "gagal membuat ${WS}"
  [ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
  sg archive "$DEPLOY_SHA" frontend | tar -x -C "$WS" --exclude='frontend/dist' || die "git archive frontend gagal"
  cp -a "$NM_SRC" "$WS/frontend/node_modules" || die "gagal menyalin node_modules frontend"
  install -m 600 "$PERSIST/frontend/.env" "$WS/frontend/.env" || die "gagal menyalin frontend/.env"
  ( cd "$WS/frontend" && npm run build ) > "$BK_DIR/build-frontend-rehearsal.log" 2>&1 || { rm -f "$WS/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend-rehearsal.log"; die "build web gagal (production tidak berubah)"; }
  rm -f "$WS/frontend/.env"
  RH_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$WS/frontend/dist/index.html" | sed -n 1p)"; [ -n "$RH_INDEX" ] && [ -f "$WS/frontend/dist/assets/$RH_INDEX" ] || die "hasil build web tidak valid"
  MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
  [ -n "$(grep -lF "$MAPS_KEY" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
  for s1 in "Bahan belum ada di katalog" "Catat sementara — stok belum diketahui" "Yang saya pakai bukan bahan ini" "Simpan pemakaian lagi" "Ada yang belum selesai" "Lihat bahan" "Tidak bisa dicatat sebagai bahan baru"; do [ -n "$(grep -lF "$s1" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal TIDAK memuat teks fitur rilis ini: ${s1}"; done
  for s2 in "Perlu rekonsiliasi Gudang" "Konfirmasi & kurangi stok" "Rencana bahan (opsional, belum mengurangi stok)" "Usulkan ke Gudang" "Beranda Gudang" "Selesaikan Produksi" "Tetapkan Siap Kirim" "Pembalik beban bersih"; do
    [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
    [ -n "$(grep -lF "$s2" "$WS"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist rehearsal KEHILANGAN teks fitur lama: ${s2}"
  done
  [ "$RH_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel rehearsal identik dengan live"
  ok "build web final: ${RH_INDEX} (live ${PREV_INDEX}); teks fitur baru ada; teks fitur live lama tetap ada; kunci peta ada"
  cleanup_ws; [ ! -e "$WS" ] || die "ruang kerja rehearsal masih ada"
  PHASE="5-image-rehearsal"; say "R3. Build image backend kandidat dengan tag rehearsal (tag production TIDAK digeser; backend yang melayani tidak disentuh)"
  RSRC="$BK_DIR/reh-src"; mkdir -p "$RSRC"; sg archive "$DEPLOY_SHA" backend | tar -x -C "$RSRC" || die "git archive backend gagal"
  REH_IMG="${IMG_NAME%%:*}:rehearsal-ubk-${DEPLOY_SHORT}"
  docker build -q -t "$REH_IMG" "$RSRC/backend" > "$BK_DIR/build-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/build-rehearsal.log"; die "build image rehearsal gagal"; }
  [ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag latest bergeser (tidak diharapkan)"
  ok "image rehearsal $(docker image inspect -f '{{.Id}}' "$REH_IMG" | cut -c8-19) dibangun; image yang melayani tetap ${PREV_IMG_ID:7:12}"
  rehearsal_migrasi "$REH_IMG"
  docker rmi "$REH_IMG" >/dev/null 2>&1 || true; rm -rf "$RSRC"
  [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah selama rehearsal"
  [ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag image production bergeser (tidak diharapkan)"
  [ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] && [ "$(psql_live -At -c "$FUNC_SQL")" = "$FUNC_PRA" ] || die "skema/fungsi production berubah selama rehearsal (production TIDAK boleh tersentuh)"
  [ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$LIVE_MIG_JUMLAH" ] || die "jumlah migrasi production berubah selama rehearsal"
  psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sesudah-rehearsal.txt" || die "sidik jari beku sesudah rehearsal gagal"
  cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah-rehearsal.txt" || true; die "dokumen pembanding beku BERUBAH selama rehearsal"; }
  [ "$(psql_live -At -c "select count(*) from pg_database where datname like 'rehearsal_ubk_%'")" = "0" ] || die "DB rehearsal masih tersisa di server"
  ok "produksi tidak berubah selama rehearsal (container/image sama; migrasi, skema, fungsi penjaga, dan sidik jari beku identik; DB sementara, image rehearsal, dan ruang kerja dihapus)"
  printf 'BASE=%s\nDEPLOY=%s\nTS=%s\nFUNC_MD5=%s\n' "$BASE_SHA" "$DEPLOY_SHA" "$TS" "$FUNC_REH" > "$MARK"
  say "REHEARSAL PENUH SELESAI — PRODUKSI TIDAK DIUBAH (tanpa release dir, tanpa switch, tanpa migrasi production, tanpa data baru). Bukti berlaku 36 jam. Backup: ${BACKUP_FILE}. Log: ${BK_DIR}/release.log"
  trap - EXIT; exit 0
fi
# Rilis penuh: WAJIB ada bukti rehearsal-penuh untuk SHA + baseline yang sama (<36 jam)
[ -f "$MARK" ] || die "belum ada bukti --rehearsal-penuh LULUS untuk SHA ${DEPLOY_SHORT}: jalankan --rehearsal-penuh dulu"
grep -qx "BASE=${BASE_SHA}" "$MARK" && grep -qx "DEPLOY=${DEPLOY_SHA}" "$MARK" || die "bukti rehearsal-penuh bukan untuk SHA/baseline ini — ulangi terhadap baseline live saat ini"
[ -n "$(find "$MARK" -mmin -2160 2>/dev/null)" ] || die "bukti rehearsal-penuh lebih dari 36 jam — ulangi terhadap data production terbaru"
FUNC_MD5_MARK="$(sed -n 's/^FUNC_MD5=//p' "$MARK" | sed -n 1p)"; [[ "$FUNC_MD5_MARK" =~ ^[0-9a-f]{32}$ ]] || die "bukti rehearsal tidak memuat sidik jari fungsi penjaga pasca-migrasi"
ok "bukti --rehearsal-penuh LULUS untuk SHA ${DEPLOY_SHORT} + baseline ${BASE_SHA:0:8}; sidik jari fungsi penjaga pasca-migrasi ${FUNC_MD5_MARK:0:12}…"


PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-ubk-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Bahan belum ada di katalog" "Catat sementara — stok belum diketahui" "Yang saya pakai bukan bahan ini" "Simpan pemakaian lagi" "Ada yang belum selesai" "Lihat bahan" "Tidak bisa dicatat sebagai bahan baru"; do
  [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru TIDAK memuat teks fitur rilis ini: ${s1}"
done
for s2 in "Perlu rekonsiliasi Gudang" "Konfirmasi & kurangi stok" "Rencana bahan (opsional, belum mengurangi stok)" "Usulkan ke Gudang" "Beranda Gudang" "Selesaikan Produksi" "Tetapkan Siap Kirim" "Pembalik beban bersih"; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar teks pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur UX Gudang ada; teks fitur live lama (Koreksi, Produksi, Riwayat Referensi) tetap ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-ubk-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama (backend berubah; tidak diharapkan)"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

rehearsal_migrasi "$NEW_IMG_ID"

PHASE="6-migrate"; say "6. Migrasi (isi fungsi penjaga; image baru; backend lama tetap melayani) — keadaan ${KEADAAN}"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum migrasi"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum migrasi"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
KEADAAN2="$(keadaan_produksi "2")" || die "${KEADAAN2}"
[ "$KEADAAN2" = "$KEADAAN" ] || die "keadaan production berubah sejak preflight (${KEADAAN} → ${KEADAAN2})"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-migrasi.txt" || die "sidik jari beku pra-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH sebelum migrasi"; }
if [ "$KEADAAN" = "SEGAR" ]; then
  [ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] && [ "$(psql_live -At -c "$FUNC_SQL")" = "$FUNC_PRA" ] || die "skema/fungsi production berubah sejak preflight"
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
else
  # LANJUT: migrasi SUDAH terpasang dan terbukti (checksum). TIDAK menjalankan migrate deploy: hanya membaca status; fungsi penjaga harus = hasil rehearsal.
  [ "$(psql_live -At -c "$FUNC_SQL")" = "$FUNC_MD5_MARK" ] || die "keadaan LANJUT: isi fungsi penjaga production BERBEDA dari hasil rehearsal"
  dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | tee "$BK_DIR/migrate-status-lanjut.log" | grep -i 'up to date' >/dev/null || die "keadaan LANJUT: migrate status production tidak 'up to date'"
fi
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang != baseline + 1 ($(( MIG_SEBELUM + 1 )))"
[ "$(psql_live -At -c "select checksum from _prisma_migrations where migration_name='${MIG_NAME}'")" = "$RAW_SHA" ] || die "checksum ${MIG_NAME} tidak cocok berkas kandidat"
[ "$(psql_live -At -c "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema tabel/kolom/constraint/indeks/trigger BERUBAH oleh migrasi (jangan switch)"
[ "$(psql_live -At -c "$FUNC_SQL")" = "$FUNC_MD5_MARK" ] || die "isi fungsi penjaga production != hasil rehearsal (jangan switch)"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah tahap migrasi"
ok "migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); skema semua tabel identik; fungsi penjaga = hasil rehearsal (${FUNC_MD5_MARK:0:12}…); backend lama tetap sehat"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari beku pasca-migrasi gagal"
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh tahap migrasi (jangan switch)"; }
ok "pasca-tahap-migrasi sebelum switch: dokumen pembanding beku IDENTIK"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
dcp "$NEW_DIR" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
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
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan bukan image baru"
ok "${NBE} berkas backend di container = kandidat (byte-identik); image baru"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
[ "$(PSQLN "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( LIVE_MIG_JUMLAH + 1 ))" ] || die "jumlah migrasi terpasang != baseline + 1"
[ "$(PSQLN "$FUNC_SQL")" = "$FUNC_MD5_MARK" ] || die "fungsi penjaga pasca-switch berbeda dari hasil rehearsal"
[ "$(PSQLN "$SKEMA_SQL")" = "$SKEMA_PRA" ] || die "skema berubah pasca-switch"
[ "$(PSQLN "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$LIVE_MIG_JUMLAH" ] || die "jumlah migrasi terpasang berubah"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "$(( LIVE_MIG_JUMLAH + 1 )) migrasi terpasang (baseline + migrasi rilis); migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: daftar, panel unit + izin tulis bahan, katalog, duplikasi (SAMA), antrean usulan/sementara (field tertautKatalog), penolakan tanpa token/hanya-lihat; tidak ada tulisan"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
// Smoke BACA-SAJA rilis "drawer Pemakaian aktual + pemakaian sementara bahan katalog (stok belum diketahui)" terhadap backend BARU yang sudah melayani. Hanya GET (+ penolakan di pintu yang gagal sebelum menyentuh data).
// Memeriksa: backend yang sama masih menjawab untuk layar yang dipakai UI baru (daftar, panel unit + izin, katalog, duplikasi, antrean usulan/sementara) dan bundel web publik memuat teks UI baru.
// Hitungan tabel bisnis sebelum vs sesudah smoke dibandingkan (smoke tidak menulis).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000"; const PUB = process.env.SMOKE_PUBLIK || "https://app.sanomatrassehat.com";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "PRODUCTION_WORKER", "PRODUCTION_LEAD", "WAREHOUSE"]);
async function userDengan(role, tanpa) { for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u; } return null; }
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
if (!adm) { rec("akun ADMIN tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm); const tS = sales ? await tokenUntuk(sales) : null;
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const TULIS = { usulan: "select count(*)::int n from material_proposals", sementara: "select count(*)::int n from unit_provisional_usages", sm: "select count(*)::int n from stock_movements", mi: "select count(*)::int n from material_issues", jur: "select count(*)::int n from fin_journal_entries", bahan: "select count(*)::int n from materials", komp: "select count(*)::int n from unit_component_reuse_entries", jad: "select count(*)::int n from production_unit_schedules", run: "select count(*)::int n from production_runs_v2" };
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);

rec("health sehat", (await get("/api/health")).json?.ok === true);
const wo = await get("/api/production/work-orders?pageSize=5", tA);
rec("daftar Order Produksi (Admin) 200 dan memuat unit", wo.status === 200 && Array.isArray(wo.json?.units) && wo.json.units.length > 0, `${wo.status}`);
const unit = wo.json?.units?.find((u) => !["CANCELLED", "DELIVERED"].includes(u.status)) ?? wo.json?.units?.[0];
if (unit) {
  const ad = await get(`/api/production/units/${unit.id}/adopsi`, tA);
  const iz = ad.json?.izin ?? {};
  rec("panel unit (Admin) 200 dengan izin pemakaianAktual, usulBahan, catatPemakaianSementara (dasar kartu sumber + label tombol)", ad.status === 200 && iz.pemakaianAktual === true && "usulBahan" in iz && "catatPemakaianSementara" in iz, JSON.stringify(Object.fromEntries(Object.entries(iz).filter(([k]) => /pemakaian|usul|Sementara|putuskan/i.test(k)))));
  rec("panel unit memuat pemakaianSementara dan komponenLama dan rencanaBahan (tiga sumber)", ad.status === 200 && !!ad.json?.pemakaianSementara && !!ad.json?.komponenLama && "rencanaBahan" in ad.json, Object.keys(ad.json ?? {}).slice(0, 14).join(","));
  if (tS) { const as = await get(`/api/production/units/${unit.id}/adopsi`, tS); rec("panel unit (hanya-lihat/Sales): izin tulis bahan = false (UI memakai label 'Lihat bahan')", as.status === 200 && as.json?.izin?.pemakaianAktual === false && as.json?.izin?.catatPemakaianSementara === false, `${as.status}`); } else skip("panel unit hanya-lihat", "tidak ada akun aktif SALES tanpa peran ber-izin tulis bahan");
} else skip("panel unit", "tidak ada unit");
const kat = await get("/api/production/material-catalog?limit=20", tA);
rec("katalog bahan 200", kat.status === 200 && Array.isArray(kat.json?.rows), `${kat.status} total=${kat.json?.total}`);
const nama = kat.json?.rows?.[0]?.nama;
if (nama) { const d = await get("/api/production/material-duplicates?name=" + encodeURIComponent(nama), tA); rec("cek duplikasi nama katalog: adaSama=true dan kandidat bertingkat 'SAMA' (UI memblokir pemakaian sementara)", d.status === 200 && d.json?.adaSama === true && (d.json?.kandidat ?? []).some((k) => k.jenis === "KATALOG" && k.tingkat === "SAMA"), JSON.stringify(d.json?.kandidat?.slice(0, 1))); } else skip("cek duplikasi", "katalog kosong");
rec("antrean usulan bahan (Admin) 200", (await get("/api/production/material-proposals", tA)).status === 200);
rec("antrean pemakaian sementara (Admin) 200", (await get("/api/production/provisional-usages", tA)).status === 200);
// bentuk respons baru: baris pemakaian sementara membawa tertautKatalog + bahanKatalog (kosong di production saat rilis; dicek bentuknya bila ada baris)
const ps = await get("/api/production/provisional-usages?status=SEMUA", tA);
rec("antrean pemakaian sementara: baris (bila ada) membawa field tertautKatalog dan bahanKatalog", ps.status === 200 && Array.isArray(ps.json?.rows) && ps.json.rows.every((r) => "tertautKatalog" in r && "bahanKatalog" in r), `${ps.status} baris=${ps.json?.rows?.length}`);
rec("pencatatan sementara bahan katalog tanpa token → 401 (ditolak sebelum menyentuh data)", (await fetch(BASE + "/api/production/units/00000000-0000-4000-8000-000000000000/provisional-usages", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "smoke-katalog-0001" }, body: "{}" })).status === 401);
if (tS) rec("pencatatan sementara bahan katalog akun hanya-lihat → 403 (ditolak sebelum menyentuh data)", (await fetch(BASE + "/api/production/units/00000000-0000-4000-8000-000000000000/provisional-usages", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tS, "Idempotency-Key": "smoke-katalog-0002" }, body: JSON.stringify({ materialId: "00000000-0000-4000-8000-000000000001", qty: 1, uom: "PCS", originNote: "uji", alasanPencatatan: "uji penolakan" }) })).status === 403); else skip("pencatatan sementara hanya-lihat 403", "tidak ada akun aktif SALES tanpa peran ber-izin tulis bahan");
rec("antrean usulan tanpa token → 401", (await get("/api/production/material-proposals")).status === 401);
// bundel web publik memuat teks UI baru
const html = await (await fetch(PUB + "/")).text(); const idx = (html.match(/assets\/index-[A-Za-z0-9_-]*\.js/) || [])[0];
if (idx) {
  const kode = await (await fetch(PUB + "/" + idx)).text(); const asetPublik = [...html.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]);
  let gabung = kode; for (const a of asetPublik.slice(0, 6)) { try { gabung += await (await fetch(PUB + "/" + a)).text(); } catch { /* lewati */ } }
  rec("bundel publik terbuka (index + aset)", gabung.length > 10000, `${gabung.length} byte`);
} else rec("bundel publik punya index-*.js", false);
const akhir = {}; for (const [k, q] of Object.entries(TULIS)) akhir[k] = await hitung(q);
const KETAT = ["usulan", "sementara", "komp", "jad", "run"]; const berubah = KETAT.filter((k) => awal[k] !== akhir[k]);
rec("smoke tidak menulis: usulan, pemakaian sementara, komponen lama, jadwal, Run tidak berubah", berubah.length === 0, berubah.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
const info = Object.keys(awal).filter((k) => !KETAT.includes(k) && awal[k] !== akhir[k]); if (info.length) console.log("  INFO  tabel yang juga ditulis pengguna nyata berubah selama smoke (bukan oleh smoke ini): " + info.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat ${BK_DIR}/smoke.log. Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else ok "smoke test lulus"; fi
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} tidak bisa diunduh (404)"
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
ok "dokumen pembanding beku (pergerakan stok, saldo per bahan, penerimaan + baris + event, koreksi, jurnal, PO, tagihan, pembayaran, Produksi, aktivitas) IDENTIK sebelum vs sesudah rilis"
[ "$(PSQLN "select count(*) from warehouse_corrections")" = "$KOREKSI_N" ] || warn "jumlah koreksi berubah dari ${KOREKSI_N} (pengguna sah dapat mengajukan koreksi selama rilis; rilis ini tidak membuatnya)"
[ "$(PSQLN "select count(*) from material_proposals")" = "$USUL_N" ] && [ "$(PSQLN "select count(*) from unit_provisional_usages")" = "$SEM_N" ] || warn "jumlah usulan/pemakaian sementara berubah dari ${USUL_N}/${SEM_N} (pengguna sah dapat mencatat selama rilis; rilis ini tidak membuatnya)"
# Pembersihan release lama (setelah rilis TERBUKTI sehat). Dipertahankan: 4 terbaru (mtime), release baru, release sebelumnya (rollback), dan release yang dirujuk container berjalan. Kegagalan di sini TIDAK menggagalkan rilis.
PHASE="9-pembersihan"; say "9. Pembersihan release lama (menyisakan 4 terbaru + rollback + yang dipakai container)"
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
say "CATATAN: migrasi hanya mengganti isi fungsi penjaga (tanpa tabel/kolom/data). Rilis tidak membuat usulan, pemakaian sementara, Material Issue, stok, biaya, atau jurnal. JANGAN membuat transaksi uji di production. Pemakaian sementara bahan katalog (stok belum diketahui) yang dicatat pengguna tetap berlabel 'Perlu rekonsiliasi Gudang' dan bukan stok/biaya resmi sebelum diselesaikan lewat jalur Gudang."
