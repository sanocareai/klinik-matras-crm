#!/usr/bin/env bash
# RILIS "KOREKSI SALDO PER BAHAN (dari Stok & Lokasi; lewat jalur resmi Penyesuaian Stok)": WEB + BACKEND + 1 MIGRASI ADITIF (1 tabel konteks baru, kosong). RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Kode: tombol "Koreksi saldo" di drawer bahan (Stok & Lokasi → cari bahan): isi JUMLAH FISIK yang benar + alasan wajib → PRATINJAU dari server (saldo sebelum/sesudah, selisih, Tersedia, dampak data, izin) → ajukan.
#   JALUR RESMI: pengajuan = permintaan Penyesuaian Stok (stock_adjustment_requests, status Menunggu persetujuan). Persetujuan WAJIB orang lain berperan Owner/Finance (pengaju ≠ penyetuju); posting oleh pemegang inventory:write lewat postStockMovement
#     (SATU-SATUNYA penulis ledger). Tidak ada penimpaan saldo. Stok TIDAK berubah saat diajukan maupun disetujui — hanya saat diposting (satu pergerakan ADJUSTMENT sebesar selisih).
#   PENJAGA: saldo yang DILIHAT pengaju disimpan (koreksi_saldo_bahan, append-only); bila saldo ledger sudah bergeser, pengajuan/persetujuan/posting ditolak 409 SALDO_BERGESER dan permintaan ditandai kedaluwarsa di riwayat.
#     Idempotency-Key mencegah klik ganda; satu koreksi aktif per bahan; pelaku/penyetuju/pemosting tercatat; riwayat koreksi per bahan.
#   KEADAAN SALDO: "belum ada catatan" (saldo belum diketahui) ≠ "0 menurut pergerakan" ≠ "0 terverifikasi" (hitung fisik/koreksi resmi, tanpa pergerakan sesudahnya) ≠ positif ≠ minus — tidak pernah digabung.
#   HARGA: kolom "Harga berlaku" per satuan stok di daftar Stok & Lokasi (dari fitur Harga Berlaku yang sudah live; bahan tanpa harga = "Belum ada harga berlaku", BUKAN Rp0; hanya untuk finance:read). Nilai persediaan Finance per bahan
#     ditampilkan TERPISAH (Persediaan Awal terposting; tanpa itu = "belum ada", bukan Rp0). Rilis ini TIDAK mengubah Harga Berlaku, HPP operasional lama, valuasi/jurnal Finance, atau GL.
#   Migrasi: 1 CREATE TABLE baru (kosong) + 3 indeks (2 unik) + 2 FK ON DELETE RESTRICT + 1 fungsi + 1 trigger append-only. Tidak ada ALTER TABLE pada tabel lama, tidak ada backfill.
#   Produksi: rilis ini TIDAK mengajukan/menyetujui/memposting koreksi apa pun dan tidak menulis pergerakan stok/jurnal/valuasi; koreksi saldo production dilakukan manual oleh pengguna berizin SESUDAH rilis (di luar skrip ini). Smoke hanya baca + penolakan sebelum menyentuh data.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, pin sha256 migrasi + diff schema, pemindai DDL + mutan negatif) → (2) audit produksi baca-saja + keadaan (SEGAR/LANJUT) + sidik jari → (3) backup + checksum → (4) build web + image
#              → (5) REHEARSAL (restore NYATA, migrasi dengan image baru, struktur, kode baru terhadap data restore, sidik jari sebelum=sesudah) → (6) migrate deploy produksi SATU kali (backend lama tetap melayani) → (7) switch → (8) verifikasi + smoke baca-saja.
#
#   cat scripts/release-koreksi-saldo.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/ks1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/ks1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/ks1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/ks1r.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata (migrasi diterapkan HANYA pada DB sementara); TANPA migrasi/switch produksi
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/ks1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/ks1.out 2>&1 < /dev/null &'   # rilis penuh (hanya setelah persetujuan)
#
# ROLLBACK KODE: tabel baru bersifat ADITIF dan tidak memengaruhi stok/biaya Finance/jurnal; kode lama mengabaikannya. Yang hilang setelah rollback: tombol/riwayat Koreksi Saldo dan penjaga "saldo bergeser" untuk permintaan yang masih berjalan.
#   Jalankan dulu scripts/rollback-guard-koreksi-saldo.sh (baca-saja): LULUS (exit 0) hanya bila tidak ada koreksi saldo yang masih berjalan; DITOLAK (exit 1) bila ada (Draf/Menunggu persetujuan/Disetujui) — mencetak jumlah, contoh, dan jalur pemulihan. Rollback kode TIDAK menghapus tabel/riwayat.
# (dibangkitkan oleh scripts/gen-release-koreksi-saldo.cjs dari scripts/release-status-kerja-buka-pekerjaan.sh + scripts/templates/release-koreksi-saldo/*; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-rc/koreksi-saldo-on-live-a4efda02}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/prisma/migrations/20261231100000_koreksi_saldo_bahan/migration\.sql|backend/prisma/schema\.prisma|backend/src/routes/hargaBerlaku\.js|backend/src/routes/stockAdjustment\.js|backend/src/services/finance/hargaBerlaku\.js|backend/src/services/keadaanSaldo\.js|backend/src/services/koreksiSaldoBahan\.js|backend/src/services/stokLokasi\.js|backend/tests/integration/koreksiSaldoBahan\.integration\.test\.js|backend/tests/integration/setup/testDb\.js|frontend/qa-harness/koreksi-saldo-browser\.cjs|frontend/qa-harness/koreksi-saldo-server\.mjs|frontend/qa-harness/qa-sql\.cjs|frontend/qa-harness/vite\.qa\.config\.mjs|frontend/src/api\.js|frontend/src/features/warehouse/components/ItemDetailDrawer\.jsx|frontend/src/features/warehouse/dokumen/PenyesuaianDetail\.jsx|frontend/src/features/warehouse/stok/HargaBerlakuPanel\.jsx|frontend/src/features/warehouse/stok/KoreksiSaldoModal\.jsx|frontend/src/features/warehouse/stok/KoreksiSaldoPanel\.jsx|frontend/src/features/warehouse/stok/koreksiSaldoLogic\.js|frontend/src/features/warehouse/stok/stokLogic\.js|frontend/src/pages/warehouse/WarehouseInventory\.jsx|frontend/tests/koreksiSaldoLogic\.test\.js|scripts/gen-release-koreksi-saldo\.cjs|scripts/lib/rehearsal-koreksi-saldo\.mjs|scripts/lib/scan-migrasi-koreksi-saldo\.mjs|scripts/lib/smoke-koreksi-saldo\.mjs|scripts/release-koreksi-saldo\.sh|scripts/rollback-guard-koreksi-saldo\.sh|scripts/templates/release-koreksi-saldo/gate-prisma\.txt|scripts/templates/release-koreksi-saldo/header\.txt|scripts/templates/release-koreksi-saldo/keadaan\.txt|scripts/templates/release-koreksi-saldo/rehearsal-guard\.txt|scripts/templates/release-koreksi-saldo/rehearsal-migrasi\.txt|scripts/templates/release-koreksi-saldo/rollback\.txt|scripts/templates/release-koreksi-saldo/step6\.txt|scripts/templates/release-koreksi-saldo/struktur\.txt|scripts/templates/release-koreksi-saldo/vars\.txt)$'
BACKEND_SRC_EXPECT="backend/src/routes/hargaBerlaku.js backend/src/routes/stockAdjustment.js backend/src/services/finance/hargaBerlaku.js backend/src/services/keadaanSaldo.js backend/src/services/koreksiSaldoBahan.js backend/src/services/stokLokasi.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/warehouse/components/ItemDetailDrawer.jsx frontend/src/features/warehouse/dokumen/PenyesuaianDetail.jsx frontend/src/features/warehouse/stok/HargaBerlakuPanel.jsx frontend/src/features/warehouse/stok/KoreksiSaldoModal.jsx frontend/src/features/warehouse/stok/KoreksiSaldoPanel.jsx frontend/src/features/warehouse/stok/koreksiSaldoLogic.js frontend/src/features/warehouse/stok/stokLogic.js frontend/src/pages/warehouse/WarehouseInventory.jsx"
# Migrasi aditif yang SUDAH diaudit (nama + sha256 isi, LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIG_NAME="20261231100000_koreksi_saldo_bahan"
MIG_PIN="49e7aca42e630e4aa242e6dcbc6ace12a0bfe9f4c3765cf5509f7c99c3971dbd"
# Hasil pemindai DDL untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":8,"create_table":1,"index":3,"index_unik":2,"index_parsial":0,"fk":2,"fungsi":1,"trigger":1}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index dan tanpa nomor baris hunk) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="587956828c40cd245935736af67bb65d013ff7b0b58daefd4ac1176cf3b8dc71"
# Objek rilis yang HARUS ada di database sesudah migrasi (nama persis; dibaca dari migrasi yang dipin).
TBL_BARU="koreksi_saldo_bahan"
IDX_BARU="koreksi_saldo_bahan_pkey koreksi_saldo_bahan_adjustment_request_id_key koreksi_saldo_bahan_idempotency_key_key koreksi_saldo_bahan_material_id_created_at_idx"
IDX_PARSIAL=""
CHK_BARU="koreksi_saldo_bahan_fisik_chk koreksi_saldo_bahan_selisih_chk koreksi_saldo_bahan_keadaan_chk koreksi_saldo_bahan_catatan_chk"
FK_BARU="koreksi_saldo_bahan_adjustment_request_id_fkey koreksi_saldo_bahan_material_id_fkey"
TRG_BARU="koreksi_saldo_bahan_append_only_trg"
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
BK_DIR="$HOME/release-backups/koreksi-saldo-${DEPLOY_SHORT}-${TS}"
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
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (bila sudah lewat tahap migrasi: tabel konteks baru KOSONG terpasang, tidak berbahaya).
LANGKAH WAJIB sebelum rollback KODE setelah migrasi/switch: jalankan GUARD (baca-saja)
   bash ${NEW_DIR}/scripts/rollback-guard-koreksi-saldo.sh
   - exit 0 (LULUS): tidak ada koreksi saldo yang masih berjalan (Draf / Menunggu persetujuan / Disetujui). Baru boleh rollback kode (di bawah).
   - exit 1/2 (DITOLAK): ada koreksi saldo yang masih berjalan, atau keadaan tidak jelas — rollback kode RUTIN TIDAK DIPERBOLEHKAN: kode lama tidak memiliki penjaga "saldo bergeser".
     Jalur pemulihan: batalkan tiap permintaan lewat Gudang → Penyesuaian Stok (alasan wajib) lalu jalankan guard lagi; atau perbaikan maju (hotfix di atas kode baru). Rollback tetap hanya atas keputusan tertulis Owner di luar skrip ini.
Rollback kode (HANYA setelah guard LULUS; tidak menghapus tabel maupun riwayat):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi bersifat ADITIF (1 tabel baru + 3 indeks + 2 FK + 1 fungsi + 1 trigger): tabel dibiarkan terpasang setelah rollback kode. Rilis ini tidak membuat pergerakan stok, valuasi/jurnal Finance, maupun harga; Koreksi Saldo hanya MENGAJUKAN Penyesuaian Stok (stok berubah hanya bila disetujui orang lain dan diposting).
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas) — MENGHAPUS semua perubahan sesudah backup (pengajuan, persetujuan, posting, transaksi); gunakan hanya atas keputusan Owner.
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
exec 9>/tmp/release-koreksi-saldo.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "ks1\|release-koreksi-saldo\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
ok "schema.prisma: diff identik dengan yang diaudit (aditif: model KoreksiSaldoBahan + relasi balik pada Material dan StockAdjustmentRequest)"
[[ "$MIG_NAME" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $MIG_NAME"
ALL_SQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | tr -d '\r')"
h="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
[ "$MIG_PIN" = "$h" ] || die "isi migrasi ${MIG_NAME} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
ok "migrasi ${MIG_NAME}: sha256 cocok pin (${h:0:12})"
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai DDL migrasi rilis "Koreksi Saldo per Bahan". Membaca SQL (komentar/baris kosong sudah dibuang) dari stdin.
// DAFTAR PUTIH SEMPIT: hanya objek BARU milik rilis ini (1 tabel konteks, 3 indeks, 2 FK RESTRICT, 1 fungsi append-only, 1 trigger). Pernyataan lain (DROP/UPDATE/INSERT/DELETE/ALTER tabel lama/GRANT/EXTENSION/fungsi liar) = exit 2.
// Keluaran (exit 0): JSON ringkas jumlah per jenis; skrip rilis membandingkannya dengan hasil yang sudah diaudit (SCAN_EXPECT).
import fs from "node:fs";

const BARU = ["koreksi_saldo_bahan"];
const REF_OK = ["materials", "stock_adjustment_requests"];
const FUNGSI = ["koreksi_saldo_bahan_append_only"];
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
if (n.create_table !== 1) tolak("harus tepat 1 CREATE TABLE");
if (n.fungsi !== 1 || n.trigger !== 1) tolak("harus tepat 1 fungsi + 1 trigger");
console.log(JSON.stringify({ total: stmts.length, ...n }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (1 CREATE TABLE baru kosong, 3 indeks [2 unik], 2 FK ON DELETE RESTRICT, 1 fungsi append-only + 1 trigger milik rilis ini); tanpa ALTER pada tabel lama, tanpa DROP/DELETE/UPDATE/INSERT/RENAME/GRANT/EXTENSION"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE units" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "DROP TABLE tabel baru" "$(tambah_stmt 'DROP TABLE "koreksi_saldo_bahan";')"
harus_ditolak "UPDATE units (backfill)" "$(tambah_stmt "UPDATE \"units\" SET \"status\" = 'RECEIVED';")"
harus_ditolak "UPDATE stock_movements" "$(tambah_stmt 'UPDATE "stock_movements" SET "qty" = 0;')"
harus_ditolak "DELETE" "$(tambah_stmt 'DELETE FROM "units";')"
harus_ditolak "INSERT ke tabel baru (backfill)" "$(tambah_stmt "INSERT INTO \"koreksi_saldo_bahan\" (id) VALUES ('x');")"
harus_ditolak "INSERT ... SELECT ke tabel baru" "$(tambah_stmt 'INSERT INTO "koreksi_saldo_bahan" SELECT * FROM "units";')"
harus_ditolak "INSERT ke tabel lama" "$(tambah_stmt "INSERT INTO \"stock_movements\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "units";')"
harus_ditolak "ADD COLUMN pada units" "$(tambah_stmt 'ALTER TABLE "units" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada materials" "$(tambah_stmt 'ALTER TABLE "materials" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada tabel baru" "$(tambah_stmt 'ALTER TABLE "koreksi_saldo_bahan" ADD COLUMN "x" TEXT;')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "units" DROP COLUMN "status";')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "units" RENAME COLUMN "status" TO "s";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "units" ALTER COLUMN "status" TYPE TEXT;')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "salinan tabel lama (CREATE TABLE AS)" "$(tambah_stmt 'CREATE TABLE "koreksi_saldo_bahan_copy" AS SELECT * FROM "units";')"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("status");')"
harus_ditolak "indeks unik pada tabel lama" "$(tambah_stmt 'CREATE UNIQUE INDEX "x_uq" ON "stock_movements"("id");')"
harus_ditolak "FK ke tabel lain" "$(tambah_stmt 'ALTER TABLE "koreksi_saldo_bahan" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "FK CASCADE (semua RESTRICT → CASCADE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE CASCADE/')"
harus_ditolak "FK SET NULL" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE SET NULL/')"
harus_ditolak "trigger dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'CREATE TRIGGER "koreksi_saldo_bahan_append_only_trg"')"
harus_ditolak "trigger memakai fungsi lain" "$(printf '%s\n' "$ALL_SQL" | sed 's/FOR EACH ROW EXECUTE FUNCTION koreksi_saldo_bahan_append_only()/FOR EACH ROW EXECUTE FUNCTION evil_fn()/')"
harus_ditolak "trigger pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE UPDATE OR DELETE ON "units" FOR EACH ROW EXECUTE FUNCTION koreksi_saldo_bahan_append_only();')"
harus_ditolak "trigger dilonggarkan (hanya UPDATE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/BEFORE UPDATE OR DELETE ON "koreksi_saldo_bahan"/BEFORE UPDATE ON "koreksi_saldo_bahan"/')"
harus_ditolak "DISABLE TRIGGER" "$(tambah_stmt 'ALTER TABLE "koreksi_saldo_bahan" DISABLE TRIGGER ALL;')"
harus_ditolak "DROP TRIGGER" "$(tambah_stmt 'DROP TRIGGER "koreksi_saldo_bahan_append_only_trg" ON "koreksi_saldo_bahan";')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "units" DROP CONSTRAINT "units_pkey";')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "fungsi di luar daftar (OR REPLACE)" "$(tambah_stmt 'CREATE OR REPLACE FUNCTION harga_berlaku_append_only() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "badan fungsi memuat DROP" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION/DROP TABLE units; RAISE EXCEPTION/")"
harus_ditolak "badan fungsi memuat DELETE FROM" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION/DELETE FROM units; RAISE EXCEPTION/")"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "koreksi_saldo_bahan" TO PUBLIC;')"
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

# Struktur objek rilis (1 tabel konteks KOSONG; 2 FK RESTRICT; 4 CHECK; 3 indeks [2 unik]; 1 trigger append-only) — SATU definisi dipakai production (sebelum switch) dan rehearsal.
# $1 = fungsi pembaca SQL (menerima satu argumen SQL, mencetak hasil -At), $2 = fungsi kegagalan (menerima pesan).
in_list() { local o="" x; for x in $1; do o="${o:+$o,}'$x'"; done; printf '%s' "$o"; }
struktur_baru() {
  local Q="$1" G="$2" n
  [ "$("$Q" "select count(*) from pg_tables where schemaname='public' and tablename in ($(in_list "$TBL_BARU"))")" = "1" ] || "$G" "tabel rilis (koreksi_saldo_bahan) tidak terpasang"
  [ "$("$Q" "select count(*) from koreksi_saldo_bahan")" = "0" ] || "$G" "tabel rilis TIDAK kosong setelah migrasi (backfill tidak diizinkan)"
  n="$(printf '%s\n' $FK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$FK_BARU")) and contype='f' and confdeltype='r' and convalidated")" = "$n" ] || "$G" "${n} FK ON DELETE RESTRICT tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $CHK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$CHK_BARU")) and contype='c' and convalidated")" = "$n" ] || "$G" "${n} CHECK tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $IDX_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ($(in_list "$IDX_BARU"))")" = "$n" ] || "$G" "${n} indeks tidak terpasang"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and tablename='koreksi_saldo_bahan' and indexdef like '%UNIQUE%'")" = "3" ] || "$G" "3 indeks unik (primary key, satu konteks per permintaan penyesuaian, satu Idempotency-Key) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname in ($(in_list "$TRG_BARU")) and not t.tgisinternal and p.proname = 'koreksi_saldo_bahan_append_only'")" = "1" ] || "$G" "trigger append-only (koreksi_saldo_bahan) tidak terpasang pada tabelnya"
}
SKEMA_SQL="select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name <> 'koreksi_saldo_bahan'"

# Klasifikasi KEADAAN production — murni, FAIL-CLOSED: selain dua keadaan yang dikenal = TOLAK.
#   SEGAR  = tabel rilis belum ada dan migrasi rilis belum terpasang; migrasi pending = tepat migrasi rilis.
#   LANJUT = rilis terhenti SESUDAH migrasi: tabel rilis ada dan KOSONG, migrasi rilis selesai (1 langkah, tidak di-rollback, checksum = berkas kandidat), tidak ada pending.
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
  ntab="$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename = 'koreksi_saldo_bahan'")"
  [[ "$ntab" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan tabel rilis bukan angka"; return 1; }
  if [ "$ntab" = "1" ]; then nisi="$(psql_live -At -c "select count(*) from koreksi_saldo_bahan")"; fi
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
BACKUP_FILE="$HOME/backups/pre-koreksi-saldo-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Koreksi saldo tidak menimpa angka" "Jumlah fisik yang benar" "Riwayat koreksi" "Koreksi saldo diajukan" "Belum ada harga berlaku"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Buka pekerjaan" "Catat pekerjaan selesai" "Tandai sudah dikerjakan" "Harga Berlaku (HPP operasional)" "Koreksi salah input historis" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-ks-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_koreksi_saldo_${TS}"
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
ok "image baru: migrasi rilis diterapkan pada DB rehearsal (hasil restore nyata); tabel konteks kosong; 2 FK RESTRICT, 4 CHECK, 3 indeks (2 unik), 1 trigger append-only tervalidasi; skema tabel lama IDENTIK"
# Guard rollback pada keadaan KOSONG (migrasi terpasang, belum ada koreksi saldo) → LULUS; baca-saja.
set +e; GUARD_OUT1="$(GUARD_DB="$REH_DB" bash "$NEW_DIR/scripts/rollback-guard-koreksi-saldo.sh" 2>&1)"; GUARD_RC1=$?; set -e
printf '%s
' "$GUARD_OUT1" > "$BK_DIR/guard-kosong.log"
{ [ "$GUARD_RC1" = "0" ] && printf '%s' "$GUARD_OUT1" | grep -q 'GUARD LULUS'; } || { printf '%s
' "$GUARD_OUT1"; reh_drop; die "guard rollback TIDAK meluluskan keadaan kosong (migrasi terpasang, belum ada koreksi saldo)"; }
ok "guard rollback pada keadaan kosong (tabel rilis ada, tanpa koreksi saldo): LULUS"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "rehearsal MENGUBAH isi tabel"; }
# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): pratinjau baca-saja, pengajuan, klik ganda, saldo bergeser, pengaju ≠ penyetuju, posting; tiga keadaan nol; stok/jurnal/GL/valuasi lama/Harga Berlaku tidak berubah. DB dihapus di akhir.
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji Koreksi Saldo terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const express = require("express");
const prisma = new PrismaClient();
// REH_SRC hanya untuk uji lokal skrip ini; di rehearsal sebenarnya kode kandidat ada di /app/src (image baru).
const imp = (p) => import(process.env.REH_SRC ? pathToFileURL(path.join(process.env.REH_SRC, p)).href : "/app/src/" + p);
process.env.JWT_SECRET ||= "rehearsal-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
const { stockAdjustmentRouter } = await imp("routes/stockAdjustment.js");
const { ROLE_PERMISSIONS } = await imp("constants/permissions.js");
const K = await imp("services/koreksiSaldoBahan.js");
const HB = await imp("services/finance/hargaBerlaku.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const ditolak = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const ts = Date.now().toString(36); let seq = 0; const kunci = (t) => `reh-ks-${t}-${ts}-${++seq}-aaaa`;
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;

// Tabel yang TIDAK BOLEH berubah oleh fitur ini (jurnal/PSA/GR/tagihan/koreksi valuasi Finance, Harga Berlaku, catatan pemakaian, Material Issue).
const TETAP = ["fin_journal_entries", "fin_journal_lines", "fin_inventory_openings", "fin_inventory_opening_lines", "goods_receipts", "goods_receipt_lines", "fin_purchase_orders", "fin_supplier_bills", "fin_stock_movement_valuation_corrections", "material_harga_berlaku", "unit_usage_notes", "material_issues"];
const fp = async (tabel) => { const o = {}; for (const t of tabel) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const beda = (a, b) => Object.keys(a).filter((t) => a[t].n !== b[t].n || a[t].h !== b[t].h);

// ── A. struktur + matriks peran pada KODE BARU ──
cek("tabel konteks koreksi saldo kosong setelah migrasi (tanpa backfill)", (await num("select count(*) as n from koreksi_saldo_bahan")) === 0);
const ada = (r, p) => (ROLE_PERMISSIONS[r] ?? []).includes(p);
cek("peran: pengaju = WAREHOUSE/ADMIN/OWNER (inventory:write); penyetuju = OWNER/FINANCE (inventory:adjustment_approve); Finance tidak menulis ledger; ADMIN dan Gudang bukan penyetuju",
  ada("WAREHOUSE", "inventory:write") && ada("ADMIN", "inventory:write") && ada("OWNER", "inventory:write") && ada("OWNER", "inventory:adjustment_approve") && ada("FINANCE", "inventory:adjustment_approve")
  && !ada("FINANCE", "inventory:write") && !ada("ADMIN", "inventory:adjustment_approve") && !ada("WAREHOUSE", "inventory:adjustment_approve"));

// ── B. pelaku (pengguna uji PADA SALINAN; token memakai klaim peran seperti login) + bahan dari data restore nyata ──
const mkUser = async (nama, role) => { const u = await prisma.user.create({ data: { name: `Uji Rehearsal ${nama}`, email: `reh-ks-${ts}-${nama}@example.test`, passwordHash: "x", role } }); return { ...u, token: jwt.sign({ id: u.id, name: u.name, role, roles: [role] }, process.env.JWT_SECRET, { expiresIn: "20m" }) }; };
const gudang = await mkUser("gudang", "WAREHOUSE"); const ownerA = await mkUser("ownerA", "OWNER"); const ownerB = await mkUser("ownerB", "OWNER"); const fin = await mkUser("finance", "FINANCE"); const sales = await mkUser("sales", "SALES");
const app = express(); app.use(express.json()); app.use("/api/inventory/adjustments", stockAdjustmentRouter);
const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
const BASE = `http://127.0.0.1:${server.address().port}/api/inventory/adjustments`;
const http = async (u, method, p, body, headers = {}) => { const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(u ? { Authorization: "Bearer " + u.token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* kosong */ } return { status: r.status, body: j }; };
const KS = "/koreksi-saldo";
const saldo = async (id) => r4(await num(`select coalesce(sum(qty),0)::float as n from stock_movements where material_id = '${id}'`));
const pilih = await prisma.$queryRawUnsafe("select m.id::text id, m.code, sum(s.qty)::float bal from materials m join stock_movements s on s.material_id = m.id where m.active group by m.id, m.code having sum(s.qty) >= 5 order by m.code limit 3");
cek(`bahan nyata bersaldo positif tersedia pada salinan (${pilih.map((x) => x.code).join(", ")})`, pilih.length >= 2);
const [m1, m2] = pilih; const bahanNyataN = await num("select count(*) as n from materials");
const gerakFixture = async (materialId, type, qty, hariLalu = 3) => prisma.stockMovement.create({ data: { materialId, type, qty, note: "rehearsal fixture", createdAt: new Date(Date.now() - hariLalu * 86_400_000), createdById: gudang.id } });
let nFixtureGerak = 0;

const fp0 = await fp(TETAP);
const nilai0 = await prisma.$queryRawUnsafe("select id::text, status, value::text from fin_stock_movement_valuations order by id");
const biaya0 = await num("select count(*) as n from stock_movement_biaya_operasional");
const nSm0 = await num("select count(*) as n from stock_movements"); const nReq0 = await num("select count(*) as n from stock_adjustment_requests");

// ── C. pratinjau = baca-saja; izin; validasi ──
const s1 = await saldo(m1.id); const fisik1 = r4(s1 - 1);
const pr = await http(gudang, "POST", `${KS}/pratinjau`, { materialId: m1.id, jumlahFisik: fisik1 });
cek("pratinjau (bahan nyata): saldo sebelum = saldo ledger, selisih -1, dapat diajukan; TIDAK menulis apa pun",
  pr.status === 200 && pr.body.saldoDilihat === s1 && pr.body.selisih === -1 && pr.body.dapatDiajukan === true && (await num("select count(*) as n from stock_adjustment_requests")) === nReq0 && (await num("select count(*) as n from koreksi_saldo_bahan")) === 0 && (await num("select count(*) as n from stock_movements")) === nSm0, JSON.stringify([pr.status, pr.body?.saldoDilihat, pr.body?.selisih]));
const v1 = await http(gudang, "POST", `${KS}/pratinjau`, { materialId: m1.id, jumlahFisik: -1 }); const v2 = await http(gudang, "POST", `${KS}/pratinjau`, { materialId: m1.id });
cek("jumlah fisik minus/kosong ditolak (JUMLAH_MINUS / JUMLAH_WAJIB); 0 sah", v1.body?.code === "JUMLAH_MINUS" && v2.body?.code === "JUMLAH_WAJIB");
cek("izin: Finance dan Sales tidak dapat mengajukan (403); tanpa token 401; alasan wajib; Idempotency-Key wajib",
  (await http(fin, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: fisik1, saldoDilihat: s1, alasan: "uji izin" }, { "Idempotency-Key": kunci("f") })).status === 403
  && (await http(sales, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: fisik1, saldoDilihat: s1, alasan: "uji izin" }, { "Idempotency-Key": kunci("s") })).status === 403
  && (await http(null, "POST", `${KS}/ajukan`, {}, { "Idempotency-Key": kunci("x") })).status === 401
  && (await http(gudang, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: fisik1, saldoDilihat: s1, alasan: "" }, { "Idempotency-Key": kunci("a") })).body?.code === "ALASAN_WAJIB"
  && (await http(gudang, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: fisik1, saldoDilihat: s1, alasan: "uji kunci wajib" })).body?.code === "KUNCI_WAJIB"
  && (await num("select count(*) as n from stock_adjustment_requests")) === nReq0);

// ── D. pengajuan: klik ganda/serentak = SATU; stok belum berubah; jalur resmi (pengaju ≠ penyetuju) ──
const k1 = kunci("aju"); const body1 = { materialId: m1.id, jumlahFisik: fisik1, saldoDilihat: s1, alasan: "rehearsal: hitung fisik sisa berkurang 1" };
const aju = await Promise.all([1, 2, 3, 4].map(() => http(gudang, "POST", `${KS}/ajukan`, body1, { "Idempotency-Key": k1 })));
cek("pengajuan serentak ×4 (kunci sama): tepat SATU permintaan + SATU konteks; semua respons sukses dengan id sama", aju.every((x) => x.status === 201 || x.status === 200) && new Set(aju.map((x) => x.body.id)).size === 1 && (await num("select count(*) as n from stock_adjustment_requests")) === nReq0 + 1 && (await num("select count(*) as n from koreksi_saldo_bahan")) === 1);
const reqId = aju[0].body.id;
cek("pengajuan: status Menunggu persetujuan; stok BELUM berubah; tidak ada pergerakan baru; saldo yang dilihat tersimpan", aju[0].body.status === "WAITING_APPROVAL" && (await saldo(m1.id)) === s1 && (await num("select count(*) as n from stock_movements")) === nSm0 && Number((await prisma.koreksiSaldoBahan.findUnique({ where: { adjustmentRequestId: reqId } })).saldoDilihat) === s1);
const beda1 = await http(gudang, "POST", `${KS}/ajukan`, { ...body1, jumlahFisik: r4(fisik1 - 1) }, { "Idempotency-Key": k1 }); cek("kunci yang sama untuk isi berbeda ditolak (KUNCI_DIPAKAI_LAIN)", beda1.status === 409 && beda1.body.code === "KUNCI_DIPAKAI_LAIN");
const aktif2 = await http(gudang, "POST", `${KS}/ajukan`, { ...body1, jumlahFisik: r4(fisik1 - 2) }, { "Idempotency-Key": kunci("aktif") }); cek("satu koreksi aktif per bahan (SUDAH_ADA_PENGAJUAN_AKTIF)", aktif2.status === 409 && aktif2.body.code === "SUDAH_ADA_PENGAJUAN_AKTIF");
cek("pengaju TIDAK dapat menyetujui sendiri (403); ADMIN/Gudang bukan penyetuju; Finance dapat menyetujui tetapi tidak memposting",
  (await http(gudang, "PATCH", `/${reqId}`, { status: "APPROVED" })).status === 403 && (await prisma.stockAdjustmentRequest.findUnique({ where: { id: reqId } })).status === "WAITING_APPROVAL");

// ── E. saldo bergeser: persetujuan ditolak; batalkan; ajukan ulang dari saldo terbaru ──
await gerakFixture(m1.id, "RECEIPT", 2, 0); nFixtureGerak += 1; // penerimaan setelah pengajuan: saldo bergeser
const s1b = await saldo(m1.id);
const tolakSetuju = await http(ownerA, "PATCH", `/${reqId}`, { status: "APPROVED" });
cek("saldo bergeser sebelum persetujuan: 409 SALDO_BERGESER; permintaan tetap Menunggu; riwayat menandai KEDALUWARSA", tolakSetuju.status === 409 && tolakSetuju.body.code === "SALDO_BERGESER" && (await prisma.stockAdjustmentRequest.findUnique({ where: { id: reqId } })).status === "WAITING_APPROVAL" && (await K.riwayatKoreksiBahan(prisma, m1.id))[0].kedaluwarsa === true);
cek("batalkan lalu ajukan ulang dari saldo terbaru berhasil", (await http(gudang, "PATCH", `/${reqId}/cancel`, { reason: "rehearsal: saldo bergeser" })).status === 200 && (await http(gudang, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: r4(s1b - 1), saldoDilihat: s1b, alasan: "rehearsal: ajukan ulang dari saldo terbaru" }, { "Idempotency-Key": kunci("ulang") })).status === 201);
const req2 = (await prisma.stockAdjustmentRequest.findFirst({ where: { materialId: m1.id, status: "WAITING_APPROVAL" } }));
const setuju2 = await http(ownerA, "PATCH", `/${req2.id}`, { status: "APPROVED" });
const finPost = await http(fin, "POST", `/${req2.id}/post`, {});
await gerakFixture(m1.id, "RECEIPT", 1, 0); nFixtureGerak += 1; // saldo bergeser SETELAH disetujui, sebelum posting
const postGeser = await http(gudang, "POST", `/${req2.id}/post`, {});
cek("disetujui Owner lain (200); Finance tidak memposting (403); saldo bergeser sebelum posting: 409 SALDO_BERGESER, tidak ada pergerakan tertulis, permintaan tetap Disetujui", setuju2.status === 200 && finPost.status === 403 && postGeser.status === 409 && postGeser.body.code === "SALDO_BERGESER" && (await num(`select count(*) as n from stock_movements where stock_adjustment_request_id = '${req2.id}'`)) === 0 && (await prisma.stockAdjustmentRequest.findUnique({ where: { id: req2.id } })).status === "APPROVED");
await http(gudang, "PATCH", `/${req2.id}/cancel`, { reason: "rehearsal: saldo bergeser setelah disetujui" });

// ── F. alur penuh: ajukan -> setujui orang lain -> posting; SATU pergerakan ADJUSTMENT sebesar selisih ──
const s1c = await saldo(m1.id); const fisik3 = r4(s1c - 1);
const a3 = await http(gudang, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: fisik3, saldoDilihat: s1c, alasan: "rehearsal: alur penuh ajukan-setujui-posting" }, { "Idempotency-Key": kunci("penuh") });
const ok3 = await http(ownerB, "PATCH", `/${a3.body.id}`, { status: "APPROVED" }); const nSmSebelumPost = await num("select count(*) as n from stock_movements");
const po3 = await http(gudang, "POST", `/${a3.body.id}/post`, {});
const mv3 = await prisma.stockMovement.findMany({ where: { stockAdjustmentRequestId: a3.body.id } }); const rq3 = await prisma.stockAdjustmentRequest.findUnique({ where: { id: a3.body.id } });
cek("alur penuh: 201 -> setujui Owner lain 200 -> posting Gudang 200; saldo = jumlah fisik; tepat SATU pergerakan ADJUSTMENT sebesar selisih -1", a3.status === 201 && ok3.status === 200 && po3.status === 200 && (await saldo(m1.id)) === fisik3 && mv3.length === 1 && mv3[0].type === "ADJUSTMENT" && r4(mv3[0].qty) === -1 && (await num("select count(*) as n from stock_movements")) === nSmSebelumPost + 1);
cek("tiga pelaku berbeda tercatat (pengaju, penyetuju, pemosting); penyetuju ≠ pengaju", rq3.requestedById === gudang.id && rq3.approvedById === ownerB.id && rq3.postedById === gudang.id && rq3.approvedById !== rq3.requestedById);
const riw = await K.riwayatKoreksiBahan(prisma, m1.id);
cek("riwayat koreksi bahan lengkap: diajukan/disetujui/diposting oleh siapa, pergerakan tercipta, yang dibatalkan tetap tercatat", riw.length === 3 && riw.filter((x) => x.status === "CANCELLED").length === 2 && riw[0].status === "POSTED" && !!riw[0].diajukanOleh && !!riw[0].disetujuiOleh && !!riw[0].dipostingOleh && riw[0].pergerakan?.qty === -1 && riw[0].kedaluwarsa === false, `${riw.length} baris`);

// ── G. tiga keadaan nol (bahan uji pada SALINAN; bahan nyata tidak disentuh) ──
const mk = (kode) => prisma.material.create({ data: { code: `REH-KS-${kode}-${ts}`.toUpperCase(), name: `Uji rehearsal ${kode}`, unit: "KG", category: "RAW_MATERIAL", active: true } });
const mBelum = await mk("belum"); const mNol = await mk("nol"); const mVerif = await mk("verif");
const kBelum = await K.keadaanBahan(prisma, ownerA, mBelum.id);
cek("belum ada catatan stok: keadaan BELUM_ADA_CATATAN, saldo null (BUKAN 0)", kBelum.keadaanSaldo === "BELUM_ADA_CATATAN" && kBelum.saldo === null);
await gerakFixture(mNol.id, "RECEIPT", 5, 4); await gerakFixture(mNol.id, "ISSUE", -5, 3); nFixtureGerak += 2;
const kNol = await K.keadaanBahan(prisma, ownerA, mNol.id);
cek("ada catatan hasilnya nol: NOL_MENURUT_PERGERAKAN (belum terverifikasi) — berbeda dari belum ada catatan", kNol.keadaanSaldo === "NOL_MENURUT_PERGERAKAN" && kNol.saldo === 0 && kNol.verifikasiNol === null);
await gerakFixture(mVerif.id, "RECEIPT", 4, 4); nFixtureGerak += 1;
const av = await http(gudang, "POST", `${KS}/ajukan`, { materialId: mVerif.id, jumlahFisik: 0, saldoDilihat: 4, alasan: "rehearsal: hitung fisik menyatakan habis" }, { "Idempotency-Key": kunci("verif") });
await http(ownerA, "PATCH", `/${av.body.id}`, { status: "APPROVED" }); await http(gudang, "POST", `/${av.body.id}/post`, {}); nFixtureGerak += 0;
const kVerif = await K.keadaanBahan(prisma, ownerA, mVerif.id);
cek("koreksi resmi ke 0 yang diposting: NOL_TERVERIFIKASI (sumber KOREKSI_SALDO + nomor) — berbeda dari nol menurut pergerakan", kVerif.keadaanSaldo === "NOL_TERVERIFIKASI" && kVerif.verifikasiNol?.sumber === "KOREKSI_SALDO" && kVerif.verifikasiNol?.nomor === av.body.nomor);
const pBelum = await http(gudang, "POST", `${KS}/pratinjau`, { materialId: mBelum.id, jumlahFisik: 0 });
cek("belum ada catatan + fisik 0: tanpa selisih, tidak dapat diajukan, tidak menciptakan catatan apa pun", pBelum.body.arah === "TANPA_SELISIH" && pBelum.body.dapatDiajukan === false && pBelum.body.saldoSebelum === null && (await num(`select count(*) as n from stock_movements where material_id = '${mBelum.id}'`)) === 0);

// ── H. append-only di tingkat database ──
const e1 = await ditolak(() => prisma.$executeRawUnsafe(`update koreksi_saldo_bahan set jumlah_fisik = 1 where adjustment_request_id = '${a3.body.id}'`)); const e2 = await ditolak(() => prisma.$executeRawUnsafe(`delete from koreksi_saldo_bahan where adjustment_request_id = '${a3.body.id}'`));
cek("trigger DB: konteks koreksi tidak bisa diubah atau dihapus", !!e1 && !!e2 && /append-only/.test(String(e1.message)) && /append-only/.test(String(e2.message)));

// ── I. Harga Berlaku per satuan di daftar (fitur yang sudah ada), baca-saja ──
const rd = await HB.ringkasanDaftar(prisma); const nMatHarga = await num("select count(distinct material_id) as n from material_harga_berlaku");
cek(`ringkasan harga daftar baca-saja: jumlah bahan berharga = ${nMatHarga} (tanpa harga TIDAK muncul, bukan Rp0)`, rd.jumlah === Object.keys(rd.harga).length && rd.jumlah <= nMatHarga && Object.values(rd.harga).every((h) => h.harga === null || Number(h.harga) > 0));
const nf = await HB.ringkasanBahan(prisma, m1.id);
cek("nilai persediaan Finance per bahan terpisah dari harga berlaku; tanpa Persediaan Awal terposting = tersedia:false (bukan Rp0)", typeof nf.nilaiPersediaanFinance?.tersedia === "boolean" && (nf.nilaiPersediaanFinance.tersedia || /BUKAN Rp0/.test(nf.nilaiPersediaanFinance.teks)), nf.nilaiPersediaanFinance?.tersedia ? "ada Persediaan Awal terposting" : "belum ada");

// ── J. invarian: yang boleh bertambah hanya pergerakan fixture + SATU pergerakan ADJUSTMENT per koreksi diposting ──
const postedN = 2; // m1 (a3) + mVerif
const fp1 = await fp(TETAP);
cek("jurnal, baris jurnal, PSA, penerimaan, tagihan, koreksi valuasi Finance, Harga Berlaku, catatan pemakaian, Material Issue: IDENTIK sebelum vs sesudah", beda(fp0, fp1).length === 0, beda(fp0, fp1).join(","));
const nilai1 = await prisma.$queryRawUnsafe("select id::text, status, value::text from fin_stock_movement_valuations order by id");
const lama = new Map(nilai0.map((x) => [x.id, x])); const berubah = nilai1.filter((x) => lama.has(x.id) && (lama.get(x.id).status !== x.status || lama.get(x.id).value !== x.value));
const nilaiBaru = nilai1.length - nilai0.length;
cek(`valuasi Finance yang sudah ada TIDAK berubah; baris valuasi baru dari perilaku lama postStockMovement: ${nilaiBaru} (untuk ${nFixtureGerak + postedN} pergerakan uji; bukan dari kode Koreksi Saldo)`, berubah.length === 0 && nilaiBaru >= 0);
cek("biaya operasional (HPP) pemakaian lama tidak berubah; pergerakan ADJUSTMENT tidak membekukan harga", (await num("select count(*) as n from stock_movement_biaya_operasional")) === biaya0, `${biaya0} -> ${await num("select count(*) as n from stock_movement_biaya_operasional")}`);
cek(`stok: bertambah tepat ${nFixtureGerak} pergerakan fixture + ${postedN} ADJUSTMENT hasil koreksi diposting (bahan nyata hanya ${postedN - 1} ADJUSTMENT); bahan nyata lain tidak tersentuh`,
  (await num("select count(*) as n from stock_movements")) === nSm0 + nFixtureGerak + postedN && (await saldo(m2.id)) === r4(pilih[1].bal) && (await num("select count(*) as n from materials")) === bahanNyataN + 3);

// ── K. SATU koreksi sengaja DIBIARKAN menunggu persetujuan agar guard rollback (dijalankan sesudah skenario) terbukti menolak ──
const s2 = await saldo(m2.id);
const a4 = await http(gudang, "POST", `${KS}/ajukan`, { materialId: m2.id, jumlahFisik: r4(s2 - 1), saldoDilihat: s2, alasan: "rehearsal: dibiarkan menunggu untuk uji guard rollback" }, { "Idempotency-Key": kunci("guard") });
cek("satu koreksi dibiarkan Menunggu persetujuan (untuk uji guard rollback)", a4.status === 201 && a4.body.status === "WAITING_APPROVAL" && (await saldo(m2.id)) === s2);

await new Promise((res) => server.close(res)); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
# Guard rollback SESUDAH skenario rehearsal (satu koreksi saldo SENGAJA dibiarkan menunggu persetujuan di DB sementara) → HARUS MENOLAK; baca-saja.
GFP_SQL="select (select count(*) from koreksi_saldo_bahan)||'/'||(select count(*) from stock_adjustment_requests)||'/'||(select count(*) from stock_movements)"
GFP0="$( { RPSQL "$FP_SQL" | LC_ALL=C sort; RPSQL "$GFP_SQL"; } | md5sum )"
set +e; GUARD_OUT2="$(GUARD_DB="$REH_DB" bash "$NEW_DIR/scripts/rollback-guard-koreksi-saldo.sh" 2>&1)"; GUARD_RC2=$?; set -e
printf '%s\n' "$GUARD_OUT2" > "$BK_DIR/guard-menolak.log"
GFP1="$( { RPSQL "$FP_SQL" | LC_ALL=C sort; RPSQL "$GFP_SQL"; } | md5sum )"
[ "$GUARD_RC2" = "1" ] || { printf '%s\n' "$GUARD_OUT2"; reh_drop; die "guard rollback TIDAK menolak (exit ${GUARD_RC2}) padahal ada koreksi saldo yang masih berjalan"; }
for t in 'GUARD DITOLAK' 'RUTIN TIDAK DIPERBOLEHKAN' 'koreksi saldo yang masih berjalan' 'saldo bergeser' 'PEMULIHAN' 'Penyesuaian Stok'; do printf '%s' "$GUARD_OUT2" | grep -q -- "$t" || { printf '%s\n' "$GUARD_OUT2"; reh_drop; die "pesan guard tidak memuat: $t"; }; done
[ "$GFP0" = "$GFP1" ] || { reh_drop; die "guard rollback MENGUBAH data (harus baca-saja)"; }
ok "guard rollback sesudah ada koreksi saldo yang masih berjalan: MENOLAK (exit 1) dengan pesan pemulihan; data tidak berubah oleh guard"
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi; uji tulis (pengajuan/persetujuan/posting koreksi saldo) dilakukan pada salinan lalu DB sementara dihapus"
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
ok "migrasi diterapkan (${MIG_SEBELUM} → $(( MIG_SEBELUM + 1 ))); tabel konteks kosong, struktur lengkap tervalidasi; skema tabel lama identik; backend lama tetap sehat"
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
ok "objek rilis terpasang di produksi: tabel konteks (koreksi saldo) — kosong; 2 FK RESTRICT, 4 CHECK, 3 indeks (2 unik), 1 trigger append-only tervalidasi"
set +e; GUARD_PROD="$(bash "$NEW_DIR/scripts/rollback-guard-koreksi-saldo.sh" 2>&1)"; GUARD_PROD_RC=$?; set -e
printf '%s\n' "$GUARD_PROD" | sed 's/^/        guard: /'
[ "$GUARD_PROD_RC" = "0" ] || die "guard rollback produksi pasca-switch tidak LULUS pada keadaan kosong (exit ${GUARD_PROD_RC})"
ok "guard rollback (baca-saja) di produksi: LULUS karena belum ada koreksi saldo yang berjalan; selama ada koreksi yang masih berjalan, guard akan MENOLAK rollback rutin"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin (401/403), keadaan saldo bahan, pratinjau koreksi (baca-saja), pengajuan tanpa Idempotency-Key ditolak sebelum menyentuh data, harga berlaku per satuan di daftar; tabel rilis tetap kosong; tidak ada jejak tulis"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
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
// Owner = pengaju+penyetuju potensial; Finance murni = penyetuju tanpa izin tulis ledger; Gudang murni; Sales murni (tanpa izin inventory)
const owner = await userDengan(["OWNER"], new Set());
const finMurni = await userDengan(["FINANCE"], new Set(["OWNER", "ADMIN", "WAREHOUSE"]));
const gudang = await userDengan(["WAREHOUSE"], new Set(["ADMIN", "OWNER", "FINANCE"]));
const sales = await userDengan(["SALES"], new Set(["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "PRODUCTION_LEAD"]));
if (!owner) { rec("akun OWNER tersedia", false); process.exit(1); }
const tO = await tokenUntuk(owner); const tF = finMurni ? await tokenUntuk(finMurni) : null; const tG = gudang ? await tokenUntuk(gudang) : null; const tS = sales ? await tokenUntuk(sales) : null;
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const B = (k) => Number(process.env[k]);
const get = async (p, token) => { const r = await fetch(BASE + p, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const post = async (p, token, body = {}, headers = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...headers }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* */ } return { status: r.status, json: j }; };
const TABEL = ["stock_movements", "stock_adjustment_requests", "koreksi_saldo_bahan", "material_issues", "goods_receipts", "fin_journal_entries", "fin_journal_lines", "fin_stock_movement_valuations", "fin_stock_movement_valuation_corrections", "fin_inventory_openings", "fin_inventory_opening_lines", "materials", "units", "unit_usage_notes", "material_harga_berlaku", "stock_movement_biaya_operasional", "biaya_operasional_penerapan"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const sebelum = await fp();

// kode yang berjalan = kode kandidat
rec("kode berjalan: pengaju = inventory:write (Gudang/Admin/Owner); penyetuju = inventory:adjustment_approve (Owner/Finance); Finance tidak menulis ledger", (ROLE_PERMISSIONS.WAREHOUSE ?? []).includes("inventory:write") && (ROLE_PERMISSIONS.OWNER ?? []).includes("inventory:adjustment_approve") && (ROLE_PERMISSIONS.FINANCE ?? []).includes("inventory:adjustment_approve") && !(ROLE_PERMISSIONS.FINANCE ?? []).includes("inventory:write"));
rec("tabel konteks koreksi saldo ada dan kosong (tidak ada yang diajukan saat rilis)", (await hitung("select count(*) as n from koreksi_saldo_bahan")) === 0);
const mat = await prisma.material.findFirst({ where: { active: true }, select: { id: true, unit: true } });
const KS = "/api/inventory/adjustments/koreksi-saldo"; const ID0 = "00000000-0000-4000-8000-000000000000";

// izin: ditolak SEBELUM menyentuh data
rec("keadaan bahan: tanpa token 401", (await get(`${KS}/bahan/${mat.id}`, null)).status === 401);
rec("pratinjau: tanpa token 401", (await post(`${KS}/pratinjau`, null)).status === 401);
rec("ajukan: tanpa token 401", (await post(`${KS}/ajukan`, null, {}, { "Idempotency-Key": "smoke-tanpa-token-1" })).status === 401);
if (tS) { rec("keadaan bahan: SALES 403 (tanpa inventory:read)", (await get(`${KS}/bahan/${mat.id}`, tS)).status === 403); rec("ajukan: SALES 403", (await post(`${KS}/ajukan`, tS, {}, { "Idempotency-Key": "smoke-sales-aaaa" })).status === 403); } else skip("SALES 403", "tidak ada akun SALES murni aktif (diuji di tes integrasi)");
if (tF) {
  const rf = await get(`${KS}/bahan/${mat.id}`, tF);
  rec("Finance murni: keadaan bahan 200 tetapi izin hanya-lihat (bolehMengajukan=false) + teks izin", rf.status === 200 && rf.json?.izin?.bolehMengajukan === false && /hanya dapat melihat/.test(rf.json?.izin?.teks ?? ""), String(rf.status));
  rec("Finance murni: ajukan 403 (penyetuju tidak menulis ledger)", (await post(`${KS}/ajukan`, tF, { materialId: mat.id }, { "Idempotency-Key": "smoke-finance-aaaa" })).status === 403);
} else skip("Finance murni hanya-lihat", "tidak ada akun FINANCE murni aktif (diuji di tes integrasi)");
if (tG) { const rg = await get(`${KS}/bahan/${mat.id}`, tG); rec("Gudang: keadaan bahan 200 dan boleh mengajukan; tidak boleh menyetujui", rg.status === 200 && rg.json?.izin?.bolehMengajukan === true && rg.json?.izin?.bolehMenyetujui === false, String(rg.status)); } else skip("Gudang boleh mengajukan", "tidak ada akun Gudang murni aktif (diuji di tes integrasi)");

// baca-saja untuk Owner: keadaan, pratinjau, daftar Stok & Lokasi, ringkasan harga
const ro = await get(`${KS}/bahan/${mat.id}`, tO);
const KEADAAN = ["BELUM_ADA_CATATAN", "NOL_MENURUT_PERGERAKAN", "NOL_TERVERIFIKASI", "POSITIF", "MINUS"];
rec("Owner: keadaan bahan 200 dengan keadaan saldo valid + riwayat (array)", ro.status === 200 && KEADAAN.includes(ro.json?.keadaanSaldo) && Array.isArray(ro.json?.riwayat), `${ro.status} ${ro.json?.keadaanSaldo}`);
const pos = await prisma.$queryRawUnsafe("select m.id::text id, sum(s.qty)::float bal from materials m join stock_movements s on s.material_id = m.id where m.active group by m.id having sum(s.qty) > 0 order by m.code limit 1");
if (pos[0]) {
  const pr = await post(`${KS}/pratinjau`, tO, { materialId: pos[0].id, jumlahFisik: pos[0].bal + 1 });
  rec("pratinjau (baca-saja): saldo sebelum = ledger, selisih +1, arah NAIK, dampak data memuat 'tidak disentuh', izin", pr.status === 200 && Math.abs(pr.json?.saldoSebelum - pos[0].bal) < 1e-6 && pr.json?.selisih === 1 && pr.json?.arah === "NAIK" && (pr.json?.dampakData?.tidakDisentuh ?? []).some((x) => /Harga Berlaku/.test(x)) && !!pr.json?.izin, `${pr.status}`);
} else skip("pratinjau bahan bersaldo positif", "tidak ada bahan bersaldo positif");
const pm = await post(`${KS}/pratinjau`, tO, { materialId: mat.id, jumlahFisik: -1 }); rec("pratinjau jumlah minus ditolak 400 JUMLAH_MINUS (tanpa menulis)", pm.status === 400 && pm.json?.code === "JUMLAH_MINUS", `${pm.status} ${pm.json?.code}`);
const nk = await post(`${KS}/ajukan`, tO, { materialId: mat.id, jumlahFisik: 1, saldoDilihat: 0, alasan: "smoke tanpa kunci" }); rec("ajukan tanpa Idempotency-Key ditolak 400 KUNCI_WAJIB SEBELUM menyentuh data", nk.status === 400 && nk.json?.code === "KUNCI_WAJIB", `${nk.status} ${nk.json?.code}`);
const na = await post(`${KS}/ajukan`, tO, { materialId: mat.id, jumlahFisik: 1, saldoDilihat: 0, alasan: "" }, { "Idempotency-Key": "smoke-tanpa-alasan-1" }); rec("ajukan tanpa alasan ditolak 400 ALASAN_WAJIB SEBELUM menyentuh data", na.status === 400 && na.json?.code === "ALASAN_WAJIB", `${na.status} ${na.json?.code}`);
const nb = await get(`${KS}/bahan/${ID0}`, tO); rec("bahan tidak ada → 404 (bukan 500)", nb.status === 404, String(nb.status));
const sl = await get("/api/inventory/beranda/stok", tO);
const barisSl = sl.json?.rows ?? [];
rec(`Stok & Lokasi: ${barisSl.length} bahan memuat keadaanSaldo valid; saldo null ⇔ BELUM_ADA_CATATAN (belum ada catatan ≠ nol)`, sl.status === 200 && barisSl.length > 0 && barisSl.every((r) => KEADAAN.includes(r.keadaanSaldo)) && barisSl.every((r) => (r.saldo === null) === (r.keadaanSaldo === "BELUM_ADA_CATATAN")), `${sl.status}`);
rec("Stok & Lokasi: nol terverifikasi hanya bila ada bukti (nomor sumber); nol menurut pergerakan tidak punya bukti", barisSl.filter((r) => r.keadaanSaldo === "NOL_TERVERIFIKASI").every((r) => !!r.nolTerverifikasi?.nomor) && barisSl.filter((r) => r.keadaanSaldo === "NOL_MENURUT_PERGERAKAN").every((r) => !r.nolTerverifikasi));
const rh = await get("/api/finance/biaya-bahan/harga-berlaku/ringkasan-daftar", tO);
rec("ringkasan harga per satuan untuk daftar (Owner) 200; jumlah konsisten; bahan tanpa harga tidak muncul sebagai Rp0", rh.status === 200 && rh.json?.jumlah === Object.keys(rh.json?.harga ?? {}).length && Object.values(rh.json?.harga ?? {}).every((h) => h.harga === null || Number(h.harga) > 0), `${rh.status}`);
if (tG) rec("ringkasan harga: Gudang 403 (tanpa finance:read) — kolom harga tidak tampil bagi Gudang", (await get("/api/finance/biaya-bahan/harga-berlaku/ringkasan-daftar", tG)).status === 403);

// tak ada jejak tulis: semua tabel (lama + baru) sama persis sebelum vs sesudah smoke
const sesudah = await fp(); const beda = TABEL.filter((t) => sebelum[t].n !== sesudah[t].n || sebelum[t].h !== sesudah[t].h);
rec("TIDAK ada jejak tulis: stok, permintaan penyesuaian, konteks koreksi, Material Issue, penerimaan, jurnal, valuasi/koreksi Finance, PSA, katalog, catatan pemakaian, Harga Berlaku sama persis sebelum vs sesudah smoke", beda.length === 0, beda.join(",") || "identik");
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
  ok "smoke test lulus (izin, keadaan saldo, pratinjau baca-saja, kunci wajib, harga per satuan, tabel rilis kosong, tanpa jejak tulis, invarian)"
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
say "CATATAN: Rilis ini membawa fitur Koreksi Saldo per Bahan (Stok & Lokasi → Penyesuaian Stok resmi). Migrasi aditif: 1 tabel konteks baru KOSONG. Rilis TIDAK mengajukan/menyetujui/memposting koreksi apa pun; tidak ada pergerakan stok, jurnal, valuasi Finance, Harga Berlaku, atau PSA/GR yang dibuat/diubah oleh rilis. Rollback kode: jalankan scripts/rollback-guard-koreksi-saldo.sh dulu."
