#!/usr/bin/env bash
# RILIS "AKUISISI — periode tunggal + biaya iklan tingkat SUMBER + navigasi sumber": WEB + BACKEND + 1 MIGRASI ADITIF (2 tabel baru kosong). RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Kode: tab Akuisisi & Iklan memakai SATU periode (filter global Laporan, state di URL ?tab&dari&sampai&sumber); /sumber memuat biaya per sumber ("Atribusi label CRM": biaya sumber ÷ kohort label CRM — BUKAN CPA campaign),
#   nilai order vs pembayaran tercatat bersih, CPA lunas, Booked/Cash ROAS, total sumber berbayar, cutoff evaluasi; "Kelola biaya iklan" (input manual harian / total rentang / impor detail Ad; audit append-only; idempoten);
#   prioritas biaya: override manual eksplisit > detail Ad (API > Windsor > CSV) > manual (hanya hari tanpa detail); detail Ad PARSIAL (manual > detail) = DETAIL_AD_SELISIH, KPI null; ekspor CSV; logo merek lokal.
#   Migrasi: 2 CREATE TABLE baru (kosong) + 3 indeks (2 unik) + 1 FK ON DELETE RESTRICT + 8 CHECK + 1 fungsi + 1 trigger (revisi append-only). Tidak ada ALTER TABLE pada tabel lama, tidak ada backfill. Tabel AdSpend (Pengaturan Sales) TIDAK diubah (hanya dibaca).
#   Produksi: rilis ini TIDAK mengimpor atau menulis biaya iklan apa pun, tidak mengubah campaign/budget Meta, leadSource, pembayaran, atau label customer. Smoke hanya baca + penolakan/dry-run sebelum menyentuh data.
# URUTAN AMAN: (1) gerbang sumber (ancestry, allowlist, pin sha256 migrasi + diff schema, pemindai DDL + mutan negatif) → (2) audit produksi baca-saja + keadaan (SEGAR/LANJUT) + sidik jari → (3) backup + checksum → (4) build web + image
#              → (5) REHEARSAL (restore NYATA, migrasi dengan image baru, struktur + uji constraint fungsional, kode baru terhadap data restore, kode LAMA terhadap DB bermigrasi, rekonsiliasi lama=baru, sidik jari sebelum=sesudah)
#              → (6) migrate deploy produksi SATU kali (backend lama tetap melayani) → (7) switch → (8) verifikasi + smoke baca-saja (izin, periode/URL, rekonsiliasi, tanpa jejak tulis).
#
#   cat scripts/release-akuisisi-biaya.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/ab1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/ab1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'      # baca-saja: produksi TIDAK diubah
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/ab1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/ab1r.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata (migrasi diterapkan HANYA pada DB sementara); TANPA migrasi/switch produksi
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/ab1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/ab1.out 2>&1 < /dev/null &'   # rilis penuh (hanya setelah persetujuan)
#
# ROLLBACK KODE: tabel baru ADITIF dan tidak memengaruhi pembayaran/jurnal/stok; kode lama mengabaikannya (TERBUKTI pada rehearsal: image lama menghitung /sumber, /iklan, /d7 identik terhadap DB bermigrasi berisi entri biaya).
#   Dampak rollback: entri biaya manual (bila sudah diinput) tetap tersimpan tetapi tidak terlihat oleh kode lama; KPI biaya per sumber hilang dari layar. Jalankan scripts/rollback-guard-akuisisi-biaya.sh (baca-saja) untuk melihat jumlah entri dan perintah ekspor sebelum rollback.
# (dibangkitkan oleh scripts/gen-release-akuisisi-biaya.cjs dari scripts/release-status-kerja-buka-pekerjaan.sh + scripts/templates/release-akuisisi-biaya/*; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/akuisisi-biaya-navigasi}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/prisma/migrations/20261230090000_biaya_iklan_sumber_manual/migration\.sql|backend/prisma/schema\.prisma|backend/src/routes/attributionAds\.js|backend/src/routes/attributionBiayaSumber\.js|backend/src/services/attribution/biayaSumber\.js|backend/src/services/attribution/sumber\.js|backend/tests/atribusiSumber\.test\.js|backend/tests/atribusiSumberKontrak\.test\.js|backend/tests/biayaSumber\.test\.js|backend/tests/integration/atribusiIklan\.integration\.test\.js|backend/tests/integration/biayaSumber\.integration\.test\.js|backend/tests/releaseAkuisisiBiaya\.test\.js|backend/tests/releaseAkuisisiSumber\.test\.js|docs/ASET-LOGO-AKUISISI\.md|frontend/src/api\.js|frontend/src/features/laporan/akuisisiLogic\.js|frontend/src/features/laporan/biayaIklanLogic\.js|frontend/src/features/laporan/components/AkuisisiTab\.jsx|frontend/src/features/laporan/components/BannerPeriode\.jsx|frontend/src/features/laporan/components/DetailSumberAkuisisi\.jsx|frontend/src/features/laporan/components/IklanCampaignTab\.jsx|frontend/src/features/laporan/components/KelolaBiayaIklan\.jsx|frontend/src/features/laporan/components/LogoSumber\.jsx|frontend/src/features/laporan/components/TrafficTab\.jsx|frontend/src/features/laporan/periodeLaporan\.js|frontend/src/pages/Laporan\.jsx|frontend/tests/biayaIklanLogic\.test\.js|frontend/tests/periodeLaporan\.test\.js|scripts/gen-release-akuisisi-biaya\.cjs|scripts/lib/constraint-akuisisi-biaya\.sql|scripts/lib/hash-live-akuisisi-biaya\.mjs|scripts/lib/rehearsal-akuisisi-biaya\.mjs|scripts/lib/rehearsal-kompat-lama-akuisisi-biaya\.mjs|scripts/lib/scan-migrasi-akuisisi-biaya\.mjs|scripts/lib/smoke-akuisisi-biaya\.mjs|scripts/release-akuisisi-biaya\.sh|scripts/rollback-guard-akuisisi-biaya\.sh|scripts/templates/release-akuisisi-biaya/gate-prisma\.txt|scripts/templates/release-akuisisi-biaya/header\.txt|scripts/templates/release-akuisisi-biaya/keadaan\.txt|scripts/templates/release-akuisisi-biaya/live-konsisten\.txt|scripts/templates/release-akuisisi-biaya/rehearsal-lama\.txt|scripts/templates/release-akuisisi-biaya/rehearsal-migrasi\.txt|scripts/templates/release-akuisisi-biaya/rollback\.txt|scripts/templates/release-akuisisi-biaya/spa\.txt|scripts/templates/release-akuisisi-biaya/step6\.txt|scripts/templates/release-akuisisi-biaya/struktur\.txt|scripts/templates/release-akuisisi-biaya/vars\.txt)$'
BACKEND_SRC_EXPECT="backend/src/routes/attributionAds.js backend/src/routes/attributionBiayaSumber.js backend/src/services/attribution/biayaSumber.js backend/src/services/attribution/sumber.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/laporan/akuisisiLogic.js frontend/src/features/laporan/biayaIklanLogic.js frontend/src/features/laporan/components/AkuisisiTab.jsx frontend/src/features/laporan/components/BannerPeriode.jsx frontend/src/features/laporan/components/DetailSumberAkuisisi.jsx frontend/src/features/laporan/components/IklanCampaignTab.jsx frontend/src/features/laporan/components/KelolaBiayaIklan.jsx frontend/src/features/laporan/components/LogoSumber.jsx frontend/src/features/laporan/components/TrafficTab.jsx frontend/src/features/laporan/periodeLaporan.js frontend/src/pages/Laporan.jsx"
# Migrasi aditif yang SUDAH diaudit (nama + sha256 isi, LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIG_NAME="20261230090000_biaya_iklan_sumber_manual"
MIG_PIN="a0340f590360cf54b2aa4a055b0fa10a8182cbb42e4e4ff41b222d6b26066c4e"
# Hasil pemindai DDL untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":7,"create_table":2,"index":3,"index_unik":2,"fk":1,"check":8,"fungsi":1,"trigger":1}'
# Diff schema.prisma antara baseline dan kandidat (U0, tanpa baris index dan tanpa nomor baris hunk) yang SUDAH diaudit: sha256. Selisih = berhenti.
SCHEMA_DIFF_SHA="fb8a3fd7ebd562c6aa1f80919d71e3916aa913a515424840bb82297218ec9c09"
# Objek rilis yang HARUS ada di database sesudah migrasi (nama persis; dibaca dari migrasi yang dipin).
TBL_BARU="ad_source_spend_entries ad_source_spend_revisions"
IDX_BARU="ad_source_spend_entries_pkey ad_source_spend_revisions_pkey ad_source_spend_entries_key ad_source_spend_entries_source_date_idx ad_source_spend_revisions_entry_rev"
IDX_UNIK="ad_source_spend_entries_key ad_source_spend_revisions_entry_rev"
CHK_BARU="ad_source_spend_entries_source_chk ad_source_spend_entries_kind_chk ad_source_spend_entries_status_chk ad_source_spend_entries_amount_chk ad_source_spend_entries_idr_chk ad_source_spend_entries_range_chk ad_source_spend_entries_override_chk ad_source_spend_revisions_action_chk"
FK_BARU="ad_source_spend_revisions_entry_id_fkey"
TRG_BARU="ad_source_spend_revisions_no_update"
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
BK_DIR="$HOME/release-backups/akuisisi-biaya-${DEPLOY_SHORT}-${TS}"
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
LANGKAH disarankan sebelum rollback KODE setelah migrasi/switch: jalankan GUARD (baca-saja)
   bash ${NEW_DIR}/scripts/rollback-guard-akuisisi-biaya.sh
   - Guard TIDAK memblokir (tabel biaya tidak memengaruhi pembayaran/jurnal/stok); ia mencetak jumlah entri biaya manual + revisi yang akan TIDAK TERLIHAT oleh kode lama dan perintah ekspor CSV untuk menyimpannya. exit 2 = guard gagal membaca (periksa dulu).
Rollback kode (tidak menghapus tabel maupun entri; TERBUKTI aman pada rehearsal: kode lama menghitung /sumber, /iklan, /d7 identik terhadap DB bermigrasi berisi entri biaya):
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi bersifat ADITIF (2 tabel baru + 3 indeks + 1 FK + 8 CHECK + 1 fungsi + 1 trigger): tabel dibiarkan terpasang setelah rollback kode. Tidak ada pembayaran, jurnal, stok, label customer, atau spend per Ad yang dibuat/diubah oleh rilis ini; yang hilang dari layar hanya tampilan biaya per sumber, CPA/ROAS sumber, dan tombol Kelola biaya iklan.
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

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-akuisisi-biaya.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "ab1\|release-akuisisi-biaya\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
ENV_SHA_SEBELUM="$(sha256sum "$PERSIST/backend/.env" "$PERSIST/frontend/.env" | awk '{print $1}' | tr '\n' ' ')"
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
! printf '%s\n' "$CHANGED" | grep -qx 'backend/src/index.js' || die "backend/src/index.js berubah (dipatok tes atribusi)"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
EXPECT_PRISMA="backend/prisma/migrations/${MIG_NAME}/migration.sql"$'\n'"backend/prisma/schema.prisma"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat migrasi rilis ini (1 migrasi + schema.prisma yang diaudit)"; }
# Migrasi yang sudah ada di baseline TIDAK boleh diubah/dihapus (yang sudah diterapkan di produksi): hanya penambahan.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
[ "$(sg diff -U0 --no-color "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | grep -v '^index ' | sed -E 's/^@@ [^@]*@@.*$/@@/' | { cat; echo; } | sha256sum | cut -d' ' -f1)" = "$SCHEMA_DIFF_SHA" ] || die "diff schema.prisma BERBEDA dari yang diaudit (pin SCHEMA_DIFF_SHA) — audit ulang lalu perbarui pin"
[ -z "$(sg diff -U0 --no-color "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | grep '^-' | grep -v '^---' || true)" ] || die "schema.prisma: ada baris DIHAPUS/DIUBAH (harus murni penambahan model baru)"
ok "schema.prisma: diff identik dengan yang diaudit dan MURNI penambahan (model AdSourceSpendEntry + AdSourceSpendRevision; tabel AdSpend/meta_ad_daily_spend tidak disentuh)"
[[ "$MIG_NAME" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $MIG_NAME"
ALL_SQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_NAME}/migration.sql" | tr -d '\r')"
h="$(printf '%s\n' "$ALL_SQL" | sha256sum | cut -d' ' -f1)"
[ "$MIG_PIN" = "$h" ] || die "isi migrasi ${MIG_NAME} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
ok "migrasi ${MIG_NAME}: sha256 cocok pin (${h:0:12})"
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai DDL migrasi rilis "Akuisisi — biaya iklan tingkat sumber". Membaca SQL (komentar/baris kosong sudah dibuang) dari stdin.
// DAFTAR PUTIH SEMPIT: hanya objek BARU milik rilis ini (2 tabel, 3 indeks, 1 FK inline RESTRICT, 8 CHECK, 1 fungsi penjaga append-only, 1 trigger).
// Pernyataan lain (DROP/UPDATE/INSERT/DELETE/ALTER tabel lama/GRANT/EXTENSION/fungsi liar) = exit 2. Keluaran (exit 0): JSON ringkas jumlah per jenis; skrip rilis membandingkannya dengan hasil yang sudah diaudit (SCAN_EXPECT).
import fs from "node:fs";

const BARU = ["ad_source_spend_entries", "ad_source_spend_revisions"];
const FUNGSI = "ad_source_spend_revisions_append_only";
const FK_OK = 'FOREIGN KEY ("entry_id") REFERENCES "ad_source_spend_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
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

const n = { create_table: 0, index: 0, index_unik: 0, fk: 0, check: 0, fungsi: 0, trigger: 0 };
const tabelDibuat = new Set();
const q = (s) => s.replace(/\s+/g, " ").trim();
for (const raw of stmts) {
  const s = q(raw); let m;
  if ((m = s.match(/^CREATE TABLE "([a-z_]+)" \(/))) {
    if (!BARU.includes(m[1])) tolak("CREATE TABLE di luar daftar: " + m[1]);
    if (tabelDibuat.has(m[1])) tolak("tabel ganda: " + m[1]);
    const isi = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
    if (/\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bGRANT\b/i.test(isi.split(FK_OK).join("").replace(/'[^']*'/g, ""))) tolak("CREATE TABLE memuat DML/DDL inline: " + m[1]);
    // satu-satunya REFERENCES yang boleh: FK RESTRICT dari revisi ke entri
    const refs = isi.match(/REFERENCES "[a-z_]+"/g) || [];
    if (refs.length) {
      if (m[1] !== "ad_source_spend_revisions" || refs.length !== 1 || !isi.includes(FK_OK)) tolak("REFERENCES di luar FK RESTRICT yang diaudit: " + m[1]);
      n.fk++;
    }
    n.check += (isi.match(/CONSTRAINT "[a-z0-9_]+" CHECK \(/g) || []).length;
    tabelDibuat.add(m[1]); n.create_table++; continue;
  }
  if ((m = s.match(/^CREATE (UNIQUE )?INDEX "([a-z0-9_]+)" ON "([a-z_]+)"\(([^)]*)\)$/))) {
    if (!BARU.includes(m[3])) tolak("indeks pada tabel di luar rilis: " + m[3]);
    n.index++; if (m[1]) n.index_unik++; continue;
  }
  if ((m = s.match(new RegExp(`^CREATE FUNCTION "${FUNGSI}"\\(\\) RETURNS trigger LANGUAGE plpgsql AS \\$\\$ (.*) \\$\\$$`)))) {
    if (!/^BEGIN RAISE EXCEPTION '[^']*'; END;$/.test(m[1])) tolak("badan fungsi bukan 'RAISE EXCEPTION' murni");
    n.fungsi++; continue;
  }
  if ((m = s.match(new RegExp(`^CREATE TRIGGER "([a-z0-9_]+)" BEFORE UPDATE OR DELETE ON "ad_source_spend_revisions" FOR EACH ROW EXECUTE FUNCTION "${FUNGSI}"\\(\\)$`)))) { n.trigger++; continue; }
  tolak("pernyataan di luar daftar putih: " + s.slice(0, 100));
}
if (n.create_table !== 2) tolak("harus tepat 2 CREATE TABLE");
if (n.fungsi !== 1 || n.trigger !== 1) tolak("harus tepat 1 fungsi + 1 trigger");
if (n.fk !== 1) tolak("harus tepat 1 FK");
console.log(JSON.stringify({ total: stmts.length, ...n }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (2 CREATE TABLE baru kosong, 3 indeks [2 unik], 1 FK ON DELETE RESTRICT, 8 CHECK, 1 fungsi + 1 trigger append-only); tanpa ALTER pada tabel lama, tanpa DROP/DELETE/UPDATE/INSERT/RENAME/GRANT/EXTENSION"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE AdSpend (tabel lama)" "$(tambah_stmt 'DROP TABLE "AdSpend";')"
harus_ditolak "DROP TABLE meta_ad_daily_spend" "$(tambah_stmt 'DROP TABLE "meta_ad_daily_spend";')"
harus_ditolak "DROP TABLE tabel baru" "$(tambah_stmt 'DROP TABLE "ad_source_spend_revisions";')"
harus_ditolak "UPDATE AdSpend (backfill/koreksi)" "$(tambah_stmt 'UPDATE "AdSpend" SET "amount" = 0;')"
harus_ditolak "UPDATE meta_ad_daily_spend" "$(tambah_stmt 'UPDATE "meta_ad_daily_spend" SET "spend" = 0;')"
harus_ditolak "DELETE FROM payments" "$(tambah_stmt 'DELETE FROM "payments";')"
harus_ditolak "INSERT ke tabel baru (backfill)" "$(tambah_stmt "INSERT INTO \"ad_source_spend_entries\" (id) VALUES ('x');")"
harus_ditolak "INSERT ... SELECT dari AdSpend (impor biaya produksi)" "$(tambah_stmt 'INSERT INTO "ad_source_spend_entries" SELECT * FROM "AdSpend";')"
harus_ditolak "INSERT ke tabel lama" "$(tambah_stmt "INSERT INTO \"AdSpend\" (id) VALUES ('x');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "AdSpend";')"
harus_ditolak "ADD COLUMN pada AdSpend" "$(tambah_stmt 'ALTER TABLE "AdSpend" ADD COLUMN "x" TEXT;')"
harus_ditolak "ADD COLUMN pada tabel baru" "$(tambah_stmt 'ALTER TABLE "ad_source_spend_entries" ADD COLUMN "x" TEXT;')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "AdSpend" DROP COLUMN "amount";')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "AdSpend" RENAME COLUMN "amount" TO "a";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "AdSpend" ALTER COLUMN "amount" TYPE BIGINT;')"
harus_ditolak "tabel baru liar" "$(tambah_stmt 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "salinan tabel lama (CREATE TABLE AS)" "$(tambah_stmt 'CREATE TABLE "ad_source_spend_copy" AS SELECT * FROM "AdSpend";')"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "AdSpend"("amount");')"
harus_ditolak "indeks unik pada tabel lama" "$(tambah_stmt 'CREATE UNIQUE INDEX "x_uq" ON "meta_ad_daily_spend"("id");')"
harus_ditolak "FK ke tabel lain" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "ad_source_spend_entries"("id")/REFERENCES "User"("id")/')"
harus_ditolak "FK CASCADE (RESTRICT → CASCADE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE CASCADE/')"
harus_ditolak "FK SET NULL" "$(printf '%s\n' "$ALL_SQL" | sed 's/ON DELETE RESTRICT/ON DELETE SET NULL/')"
harus_ditolak "FK ditambah pada tabel lama" "$(tambah_stmt 'ALTER TABLE "payments" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("id") REFERENCES "ad_source_spend_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "trigger dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'CREATE TRIGGER')"
harus_ditolak "trigger memakai fungsi lain" "$(printf '%s\n' "$ALL_SQL" | sed 's/EXECUTE FUNCTION "ad_source_spend_revisions_append_only"()/EXECUTE FUNCTION "evil_fn"()/')"
harus_ditolak "trigger pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE UPDATE OR DELETE ON "AdSpend" FOR EACH ROW EXECUTE FUNCTION "ad_source_spend_revisions_append_only"();')"
harus_ditolak "trigger pada tabel entri (menghambat pembaruan sah)" "$(tambah_stmt 'CREATE TRIGGER "x_trg" BEFORE UPDATE OR DELETE ON "ad_source_spend_entries" FOR EACH ROW EXECUTE FUNCTION "ad_source_spend_revisions_append_only"();')"
harus_ditolak "trigger dilonggarkan (hanya UPDATE)" "$(printf '%s\n' "$ALL_SQL" | sed 's/BEFORE UPDATE OR DELETE ON "ad_source_spend_revisions"/BEFORE UPDATE ON "ad_source_spend_revisions"/')"
harus_ditolak "DISABLE TRIGGER" "$(tambah_stmt 'ALTER TABLE "ad_source_spend_revisions" DISABLE TRIGGER ALL;')"
harus_ditolak "DROP TRIGGER" "$(tambah_stmt 'DROP TRIGGER "ad_source_spend_revisions_no_update" ON "ad_source_spend_revisions";')"
harus_ditolak "DROP CONSTRAINT" "$(tambah_stmt 'ALTER TABLE "ad_source_spend_entries" DROP CONSTRAINT "ad_source_spend_entries_amount_chk";')"
harus_ditolak "salah satu CHECK dibuang (nominal tak lagi >= 0)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'ad_source_spend_entries_amount_chk')"
harus_ditolak "indeks unik kunci idempotensi dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'CREATE UNIQUE INDEX "ad_source_spend_entries_key"')"
harus_ditolak "indeks unik dijadikan tidak unik" "$(printf '%s\n' "$ALL_SQL" | sed 's/CREATE UNIQUE INDEX "ad_source_spend_entries_key"/CREATE INDEX "ad_source_spend_entries_key"/')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;')"
harus_ditolak "fungsi di luar daftar (OR REPLACE fungsi lama)" "$(tambah_stmt 'CREATE OR REPLACE FUNCTION production_adopsi_append_only() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "badan fungsi memuat DROP" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION 'ad_source_spend_revisions bersifat append-only';/DROP TABLE \"AdSpend\";/")"
harus_ditolak "badan fungsi dilonggarkan (RETURN NEW)" "$(printf '%s\n' "$ALL_SQL" | sed "s/RAISE EXCEPTION 'ad_source_spend_revisions bersifat append-only';/RETURN NEW;/")"
harus_ditolak "CREATE EXTENSION" "$(tambah_stmt 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "ad_source_spend_entries" TO PUBLIC;')"
harus_ditolak "REVOKE" "$(tambah_stmt 'REVOKE ALL ON "AdSpend" FROM PUBLIC;')"
harus_ditolak "enum diubah" "$(tambah_stmt "ALTER TYPE \"LeadSource\" ADD VALUE IF NOT EXISTS 'LIAR';")"
ok "uji negatif pemindai: ${NEG} mutan (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER lama/FK CASCADE+SET NULL/trigger/CHECK/indeks unik/fungsi liar/EXTENSION/GRANT) SEMUA ditolak"

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

# Struktur objek rilis (2 tabel KOSONG; 1 FK RESTRICT; CHECK; indeks [unik]; trigger penjaga append-only) — SATU definisi dipakai production (sebelum switch) dan rehearsal.
# $1 = fungsi pembaca SQL (menerima satu argumen SQL, mencetak hasil -At), $2 = fungsi kegagalan (menerima pesan).
in_list() { local o="" x; for x in $1; do o="${o:+$o,}'$x'"; done; printf '%s' "$o"; }
struktur_baru() {
  local Q="$1" G="$2" n
  [ "$("$Q" "select count(*) from pg_tables where schemaname='public' and tablename in ($(in_list "$TBL_BARU"))")" = "2" ] || "$G" "2 tabel rilis (biaya sumber + revisi) tidak terpasang"
  [ "$("$Q" "select (select count(*) from ad_source_spend_entries) + (select count(*) from ad_source_spend_revisions)")" = "0" ] || "$G" "tabel rilis TIDAK kosong setelah migrasi (backfill tidak diizinkan)"
  n="$(printf '%s\n' $FK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$FK_BARU")) and contype='f' and confdeltype='r' and convalidated")" = "$n" ] || "$G" "${n} FK ON DELETE RESTRICT tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $CHK_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_constraint where conname in ($(in_list "$CHK_BARU")) and contype='c' and convalidated")" = "$n" ] || "$G" "${n} CHECK tidak terpasang/tervalidasi"
  n="$(printf '%s\n' $IDX_BARU | grep -c .)"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ($(in_list "$IDX_BARU"))")" = "$n" ] || "$G" "${n} indeks tidak terpasang"
  n="$(printf '%s\n' $IDX_UNIK | grep -c .)"
  [ "$("$Q" "select count(*) from pg_indexes where schemaname='public' and indexname in ($(in_list "$IDX_UNIK")) and indexdef like '%UNIQUE%'")" = "$n" ] || "$G" "${n} indeks UNIK (kunci idempotensi entri; nomor revisi) tidak terpasang"
  [ "$("$Q" "select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname in ($(in_list "$TRG_BARU")) and not t.tgisinternal and p.proname = 'ad_source_spend_revisions_append_only'")" = "1" ] || "$G" "trigger penjaga append-only revisi tidak terpasang"
}
SKEMA_SQL="select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name not in ('ad_source_spend_entries','ad_source_spend_revisions')"
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
  ntab="$(psql_live -At -c "select count(*) from pg_tables where schemaname='public' and tablename in ('ad_source_spend_entries','ad_source_spend_revisions')")"
  [[ "$ntab" =~ ^[0-9]+$ ]] || { echo "TOLAK: hitungan tabel rilis bukan angka"; return 1; }
  if [ "$ntab" = "2" ]; then nisi="$(psql_live -At -c "select (select count(*) from ad_source_spend_entries) + (select count(*) from ad_source_spend_revisions)")"; fi
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
BACKUP_FILE="$HOME/backups/pre-akuisisi-biaya-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Kelola biaya iklan" "Atribusi label CRM" "Impor detail Ad" "Total rentang" "Sumber biaya yang dipakai" "Detail Ad mungkin parsial" "Biaya terisi setiap hari" "Verifikasi kelengkapan"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Performa Akuisisi" "Customer ber-order" "Perbandingan sumber" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-akuisisi-biaya-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_akuisisi_biaya_${TS}"
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
# idempotensi migrasi: menjalankan migrate deploy sekali lagi tidak menerapkan apa pun
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="$RH_URL" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal-2.log" 2>&1 || { tail -n 12 "$BK_DIR/migrate-rehearsal-2.log"; reh_drop; die "migrate deploy ke-2 di DB rehearsal GAGAL"; }
! grep -q 'Applying migration' "$BK_DIR/migrate-rehearsal-2.log" || { reh_drop; die "migrate deploy ke-2 MENERAPKAN sesuatu (migrasi tidak idempoten)"; }
struktur_baru RPSQL gagal_reh
[ "$(RPSQL "$SKEMA_SQL")" = "$S_SEBELUM" ] || { reh_drop; die "migrasi MENGUBAH skema (kolom/tipe/nullable/default) tabel lama"; }
ok "image baru: migrasi rilis diterapkan pada DB rehearsal (hasil restore nyata) dan idempoten; 2 tabel kosong; 1 FK RESTRICT, 8 CHECK, 3 indeks (2 unik), trigger append-only tervalidasi; skema tabel lama IDENTIK"
# UJI CONSTRAINT FUNGSIONAL pada DB rehearsal (semua dalam satu transaksi yang DIBATALKAN): setiap pelanggaran harus ditolak DB; entri/revisi sah diterima.
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -v ON_ERROR_STOP=0 > "$BK_DIR/constraint-rehearsal.log" 2>&1 <<'CONSTRAINTSQL' || { reh_drop; die "uji constraint fungsional tidak dapat dijalankan"; }
-- Uji constraint migrasi biaya sumber pada RESTORE disposable. Tiap pernyataan melanggar satu aturan; PASS = ditolak DB. Semua di pg_temp + dibatalkan (ROLLBACK).
BEGIN;
CREATE FUNCTION pg_temp.tolak(nama text, stmt text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE stmt; RAISE NOTICE 'FAIL   % (tidak ditolak)', nama;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS   % [%]', nama, SQLSTATE; END;
END $f$;
CREATE FUNCTION pg_temp.terima(nama text, stmt text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE stmt; RAISE NOTICE 'PASS   % (diterima)', nama;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL   % (ditolak: %)', nama, SQLERRM; END;
END $f$;

SELECT pg_temp.terima('entri HARIAN sah', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES ('00000000-0000-4000-8000-000000000001','TIKTOK','HARIAN','2026-08-01','2026-08-01',150000,'FIXTURE uji',now())$$);
SELECT pg_temp.tolak('sumber organik (WHATSAPP)', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'WHATSAPP','HARIAN','2026-08-02','2026-08-02',1,'x',now())$$);
SELECT pg_temp.tolak('sumber huruf kecil', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'tiktok','HARIAN','2026-08-02','2026-08-02',1,'x',now())$$);
SELECT pg_temp.tolak('jenis tidak dikenal', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','BULANAN','2026-08-02','2026-08-02',1,'x',now())$$);
SELECT pg_temp.tolak('status tidak dikenal', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,status,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-02','2026-08-02',1,'HAPUS','x',now())$$);
SELECT pg_temp.tolak('nominal negatif', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-02','2026-08-02',-1,'x',now())$$);
SELECT pg_temp.tolak('mata uang selain IDR', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,currency,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-02','2026-08-02','USD',1,'x',now())$$);
SELECT pg_temp.tolak('tanggal terbalik', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','TOTAL_RENTANG','2026-08-05','2026-08-02',1,'x',now())$$);
SELECT pg_temp.tolak('HARIAN dengan dua tanggal', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-02','2026-08-03',1,'x',now())$$);
SELECT pg_temp.tolak('override untuk sumber non-META', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,override_ad_detail,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-02','2026-08-02',1,true,'x',now())$$);
SELECT pg_temp.terima('override META sah', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,override_ad_detail,reason,updated_at) VALUES ('00000000-0000-4000-8000-000000000002','META','HARIAN','2026-08-02','2026-08-02',1,true,'FIXTURE uji',now())$$);
SELECT pg_temp.tolak('kunci unik ganda (sumber,jenis,dari,sampai,akun)', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-01','2026-08-01',9,'x',now())$$);
SELECT pg_temp.terima('akun berbeda = kunci berbeda', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,account_id,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-01','2026-08-01','123456',9,'FIXTURE uji',now())$$);
SELECT pg_temp.tolak('alasan kosong (NOT NULL)', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-09','2026-08-09',1,NULL,now())$$);
SELECT pg_temp.terima('revisi sah (BUAT)', $$INSERT INTO ad_source_spend_revisions (id,entry_id,revision,action,prev_amount,new_amount,prev_status,new_status,prev_override,new_override,reason) VALUES (gen_random_uuid(),'00000000-0000-4000-8000-000000000001',1,'BUAT',NULL,150000,NULL,'AKTIF',NULL,false,'FIXTURE uji')$$);
SELECT pg_temp.tolak('revisi ganda nomor sama (unik entry,revisi)', $$INSERT INTO ad_source_spend_revisions (id,entry_id,revision,action,prev_amount,new_amount,prev_status,new_status,prev_override,new_override,reason) VALUES (gen_random_uuid(),'00000000-0000-4000-8000-000000000001',1,'UBAH',150000,1,'AKTIF','AKTIF',false,false,'x')$$);
SELECT pg_temp.tolak('revisi yatim (FK entry tidak ada)', $$INSERT INTO ad_source_spend_revisions (id,entry_id,revision,action,new_amount,new_status,new_override,reason) VALUES (gen_random_uuid(),'00000000-0000-4000-8000-0000000000ff',1,'BUAT',1,'AKTIF',false,'x')$$);
SELECT pg_temp.tolak('aksi revisi tidak dikenal', $$INSERT INTO ad_source_spend_revisions (id,entry_id,revision,action,new_amount,new_status,new_override,reason) VALUES (gen_random_uuid(),'00000000-0000-4000-8000-000000000001',2,'HAPUS',1,'AKTIF',false,'x')$$);
SELECT pg_temp.tolak('UPDATE revisi (append-only)', $$UPDATE ad_source_spend_revisions SET reason='diubah'$$);
SELECT pg_temp.tolak('DELETE revisi (append-only)', $$DELETE FROM ad_source_spend_revisions$$);
SELECT pg_temp.tolak('hapus entri yang punya revisi ditolak (FK RESTRICT)', $$DELETE FROM ad_source_spend_entries WHERE id='00000000-0000-4000-8000-000000000001'$$);
SELECT pg_temp.terima('hapus entri TANPA revisi (tidak ada jejak yang hilang)', $$DELETE FROM ad_source_spend_entries WHERE id='00000000-0000-4000-8000-000000000002'$$);
ROLLBACK;
CONSTRAINTSQL
[ "$(grep -c 'NOTICE:  PASS' "$BK_DIR/constraint-rehearsal.log")" = "22" ] && ! grep -q 'NOTICE:  FAIL' "$BK_DIR/constraint-rehearsal.log" || { grep -E 'NOTICE:  (PASS|FAIL)' "$BK_DIR/constraint-rehearsal.log" | grep FAIL || true; reh_drop; die "uji constraint fungsional: harus 22 PASS dan 0 FAIL (lihat constraint-rehearsal.log)"; }
[ "$(RPSQL "select (select count(*) from ad_source_spend_entries) + (select count(*) from ad_source_spend_revisions)")" = "0" ] || { reh_drop; die "uji constraint meninggalkan baris (transaksi harus dibatalkan)"; }
ok "constraint fungsional: 22 PASS / 0 FAIL (sumber organik, jenis, status, nominal negatif, IDR, tanggal, HARIAN 2 tanggal, override non-META, kunci unik ganda, nomor revisi ganda, FK yatim, UPDATE/DELETE revisi, hapus entri berevisi ditolak); transaksi dibatalkan, tabel tetap kosong"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "rehearsal MENGUBAH isi tabel"; }
# UJI APLIKASI pada SALINAN RESTORE (kode BARU, data produksi nyata, DB sementara): izin, validasi, periode, rekonsiliasi SQL independen, input biaya (idempoten/ubah/batal/konflik), detail Ad parsial/override/pencabutan; tabel lama tidak berubah. DB dihapus di akhir.
PER_SAMPAI="$(date -u -d "@$(( $(date +%s) + 25200 - 86400 ))" +%F)"; PER_DARI="$(date -u -d "@$(( $(date +%s) + 25200 - 86400 * 30 ))" +%F)"   # 30 hari PENUH berakhir kemarin (WIB)
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" -e PER_DARI="$PER_DARI" -e PER_SAMPAI="$PER_SAMPAI" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji Akuisisi biaya terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { attributionAdsRouter } = await import("/app/src/routes/attributionAds.js");
let gagal = 0; let n = 0; let dilewati = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const skip = (nama, alasan) => { dilewati += 1; console.log(`SKIP  ${nama} — DILEWATI: ${alasan}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const DARI = process.env.PER_DARI, SAMPAI = process.env.PER_SAMPAI;
if (!/^\d{4}-\d{2}-\d{2}$/.test(DARI || "") || !/^\d{4}-\d{2}-\d{2}$/.test(SAMPAI || "")) { console.log("GAGAL periode tidak diberikan"); process.exit(1); }
const ALASAN = "FIXTURE UJI rehearsal (angka fiktif; DB sementara)";
const hariDari = (a, b) => { const o = []; for (let d = Date.parse(a + "T00:00:00Z"); d <= Date.parse(b + "T00:00:00Z"); d += 864e5) o.push(new Date(d).toISOString().slice(0, 10)); return o; };

// A. struktur baru kosong; tabel tidak berpengaruh pada tabel lama
cek("tabel rilis kosong setelah migrasi (tidak ada backfill)", (await num("select (select count(*) from ad_source_spend_entries) + (select count(*) from ad_source_spend_revisions) as n")) === 0);
const TABEL = ["Customer", "Order", "payments", "AdSpend", "meta_ad_daily_spend", "meta_spend_imports", "attribution_touches", "fin_journal_entries", "fin_journal_lines", "stock_movements", "units"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const bedaTabel = (a, b) => TABEL.filter((t) => a[t].n !== b[t].n || a[t].h !== b[t].h);
const fp0 = await fp();

// B. server dengan router ASLI + sesi ADMIN nyata (token ditandatangani dengan JWT_SECRET lingkungan)
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER", "PRODUCTION_LEAD", "WAREHOUSE"]);
let adm = null, sales = null;
for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (!adm && rs.has("ADMIN")) adm = u; if (!sales && rs.has("SALES") && ![...rs].some((r) => BERIZIN.has(r))) sales = u; }
if (!adm) { cek("akun ADMIN tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm); const tS = sales ? await tokenUntuk(sales) : null;
const app = express(); app.use(express.json()); app.use("/api/atribusi/iklan", attributionAdsRouter);
const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); }); const BASE = `http://127.0.0.1:${srv.address().port}/api/atribusi/iklan`;
const call = async (m, p, { token = tA, body } = {}) => { const r = await fetch(BASE + p, { method: m, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { s: r.status, j }; };

// C. izin
for (const [m, p] of [["GET", `/biaya-sumber?dari=${DARI}&sampai=${SAMPAI}`], ["PUT", "/biaya-sumber"], ["POST", "/biaya-sumber/00000000-0000-4000-8000-000000000000/batalkan"], ["GET", "/biaya-sumber/00000000-0000-4000-8000-000000000000/riwayat"], ["GET", `/sumber?dari=${DARI}&sampai=${SAMPAI}`]]) {
  cek(`${m} ${p.split("?")[0]}: tanpa token 401`, (await call(m, p, { token: null, body: m === "GET" ? undefined : {} })).s === 401);
  if (tS) cek(`${m} ${p.split("?")[0]}: SALES 403`, (await call(m, p, { token: tS, body: m === "GET" ? undefined : {} })).s === 403); else skip(`${m} ${p.split("?")[0]}: SALES 403`, "tidak ada akun SALES murni aktif");
}
cek("validasi: nominal negatif 400, sumber organik 400, hari berjalan 400 (sebelum menyentuh data)",
  (await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: SAMPAI, nominal: "-1", alasan: ALASAN } })).s === 400
  && (await call("PUT", "/biaya-sumber", { body: { sumber: "WHATSAPP", jenis: "HARIAN", dari: SAMPAI, nominal: "1", alasan: ALASAN } })).s === 400
  && (await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), nominal: "1", alasan: ALASAN } })).s === 400);
cek("parameter periode salah 400 (satu batas / terbalik / masa depan)", (await call("GET", `/sumber?dari=${DARI}`)).s === 400 && (await call("GET", `/sumber?dari=${SAMPAI}&sampai=${DARI}`)).s === 400 && (await call("GET", "/sumber?dari=2099-01-01&sampai=2099-01-02")).s === 400);

// D. periode: respons mengembalikan periode yang diminta (URL → API → tampilan)
const ambil = async (d = DARI, s = SAMPAI) => { const r = await call("GET", `/sumber?dari=${d}&sampai=${s}`); if (r.s !== 200) throw new Error("GET /sumber " + r.s); return r.j; };
const agregat = (j) => Object.fromEntries(j.sumber.map((x) => [x.id, [x.lead, x.spam, x.leadSah, x.berOrder, x.membayar, x.lunas, x.pernahDp, x.dpSaatIni, x.uang.nilaiOrderSaatIni, x.uang.uangLedger, x.uang.refund, x.uang.uangBersih]]));
const j0 = await ambil();
cek("periode di respons = periode yang diminta; 6 sumber; organik 'tidak tersedia'; TikTok & Lainnya belum diisi; dasar 'Atribusi label CRM'",
  j0.periode.dari === DARI && j0.periode.sampai === SAMPAI && j0.sumber.length === 6 && j0.sumber.filter((x) => x.jenis === "ORGANIK").every((x) => x.biaya.status === "TIDAK_TERSEDIA_ORGANIK" && x.biaya.spend === null)
  && j0.sumber.find((x) => x.id === "TIKTOK").biaya.status === "BELUM_DIISI" && j0.sumber.every((x) => x.biaya.dasar === "ATRIBUSI_LABEL_CRM"), JSON.stringify(j0.sumber.map((x) => [x.id, x.biaya.status])));
cek("kontrak: biayaCampaignTerbukti hanya Meta; total.berbayar ada dan null selama biaya belum lengkap; cutoff evaluasi ada", j0.sumber.filter((x) => x.biayaCampaignTerbukti).map((x) => x.id).join() === "META" && j0.total.berbayar.lengkap === false && j0.total.berbayar.cpa === null && /WIB$/.test(j0.cutoffEvaluasi?.waktuWib || ""));
// rekonsiliasi independen (SQL) untuk label iklan
const lo = new Date(Date.parse(DARI + "T00:00:00Z") - 7 * 3600e3), hi = new Date(Date.parse(SAMPAI + "T00:00:00Z") + 864e5 - 7 * 3600e3);
for (const [id, label] of [["META", "META_ADS"], ["TIKTOK", "TIKTOK_ADS"], ["WHATSAPP", "WHATSAPP_DIRECT"]]) {
  const sql = await prisma.customer.count({ where: { leadSource: label, createdAt: { gte: lo, lt: hi } } });
  cek(`rekonsiliasi SQL independen: lead ${id} = ${sql}`, j0.sumber.find((x) => x.id === id).lead === sql);
}
const jumlah = (k) => j0.sumber.reduce((a, x) => a + x[k], 0);
cek("rekonsiliasi: jumlah per sumber = total (lead, spam, ber-order, membayar, lunas)", ["lead", "spam", "berOrder", "membayar", "lunas"].every((k) => jumlah(k) === j0.total[k]));
const A0 = agregat(j0);
// referensi laporan LAIN sebelum penulisan biaya apa pun (dibandingkan lagi di bagian H)
const hapusVolatil = (o) => JSON.parse(JSON.stringify(o, (k, v) => (["dihitungPada", "waktuWib", "waktu"].includes(k) ? undefined : v)));
const D7_DARI = hariDari(SAMPAI, SAMPAI).length ? new Date(Date.parse(SAMPAI + "T00:00:00Z") - 9 * 864e5).toISOString().slice(0, 10) : SAMPAI;
const iklan0 = hapusVolatil((await call("GET", "/?level=campaign&dari=" + DARI + "&sampai=" + SAMPAI)).j);
const d7_0 = hapusVolatil((await call("GET", "/d7?dari=" + D7_DARI + "&sampai=" + SAMPAI)).j);
cek("referensi: setiap sumber 'LENGKAP' memuat tingkat verifikasi JUJUR (independen=false) dan peringatan BIAYA_TIDAK_DIVERIFIKASI bila ada yang LENGKAP", j0.sumber.filter((x) => x.jenis !== "ORGANIK").every((x) => x.biaya.cakupan && x.biaya.cakupan.verifikasi && x.biaya.cakupan.verifikasi.independen === false) && j0.sumber.filter((x) => x.biaya.status === "LENGKAP").every((x) => j0.peringatan.some((p) => p.kode === "BIAYA_TIDAK_DIVERIFIKASI" && p.data.sumber === x.id)));
cek("referensi: /iklan (campaign) dan /d7 menjawab 200 sebelum penulisan biaya", !!iklan0 && !iklan0.error && !!d7_0 && !d7_0.error);

// E. TikTok: isi setiap hari periode (FIXTURE) → LENGKAP; CPA = biaya ÷ customer lunas unik; idempoten; ubah; konflik; batal
const hari = hariDari(DARI, SAMPAI); let dibuat = 0;
for (const d of hari) { const r = await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: d, nominal: "150000", alasan: ALASAN } }); if (r.s === 201) dibuat++; }
cek(`TikTok: ${hari.length} entri harian dibuat (201) dan satu entri per hari`, dibuat === hari.length && (await num("select count(*) as n from ad_source_spend_entries where source_id='TIKTOK'")) === hari.length);
const ulang = await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: hari[0], nominal: "150000", alasan: ALASAN } });
cek("input ulang identik = TIDAK_BERUBAH, tanpa revisi baru (idempoten)", ulang.s === 200 && ulang.j.aksi === "TIDAK_BERUBAH" && ulang.j.ditulis === false && (await num("select count(*) as n from ad_source_spend_revisions")) === hari.length);
const par = await Promise.all([1, 2, 3, 4].map(() => call("PUT", "/biaya-sumber", { body: { sumber: "LAINNYA", jenis: "HARIAN", dari: hari[0], nominal: "7000", alasan: ALASAN } })));
cek("empat permintaan serentak pada kunci yang sama menulis tepat SATU entri", par.filter((x) => x.j?.ditulis).length === 1 && (await num("select count(*) as n from ad_source_spend_entries where source_id='LAINNYA'")) === 1);
const j1 = await ambil(); const tt = j1.sumber.find((x) => x.id === "TIKTOK");
cek("TikTok LENGKAP: spend = 150000 × hari; CPA = spend ÷ customer lunas unik (atau null 'BELUM_ADA_KONVERSI'); ROAS tanpa spend nol", tt.biaya.status === "LENGKAP" && tt.biaya.spend === 150000 * hari.length
  && (tt.lunas > 0 ? Math.abs(tt.biaya.cpa - Math.round((tt.biaya.spend / tt.lunas) * 100) / 100) < 0.01 : (tt.biaya.cpa === null && tt.biaya.alasanNull.cpa === "BELUM_ADA_KONVERSI")), JSON.stringify([tt.biaya.spend, tt.lunas, tt.biaya.cpa, tt.biaya.bookedRoas, tt.biaya.cashRoas]));
cek("total berbayar tetap null selama Meta belum lengkap (tidak ada total semu)", j1.total.berbayar.lengkap === false || j1.sumber.find((x) => x.id === "META").biaya.status === "LENGKAP");
const ub = await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: hari[0], nominal: "175000.50", alasan: ALASAN + " (koreksi)" } });
cek("ubah nominal: UBAH + revisi 2 + nilai lama/baru", ub.j.aksi === "UBAH" && ub.j.revisi === 2 && ub.j.perubahan.nominalLama === 150000 && ub.j.perubahan.nominalBaru === 175000.5);
cek("konflik: total rentang menimpa entri harian aktif → 409 tanpa menulis", (await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "TOTAL_RENTANG", dari: hari[0], sampai: hari[1] ?? hari[0], nominal: "1", alasan: ALASAN } })).s === 409);
const rw = await call("GET", `/biaya-sumber/${ub.j.id}/riwayat`);
cek("audit: revisi append-only memuat pengubah, alasan, nilai lama→baru", rw.j.riwayat.length === 2 && rw.j.riwayat.every((x) => x.olehId === adm.id && x.alasan) && rw.j.riwayat[1].nominalLama === 150000 && rw.j.riwayat[1].nominalBaru === 175000.5);
const bt = await call("POST", `/biaya-sumber/${ub.j.id}/batalkan`, { body: { alasan: "FIXTURE UJI batal" } });
const j2 = await ambil();
cek("batal: entri tidak dihapus (riwayat tetap), hari itu kembali kosong → SPEND_TIDAK_LENGKAP + KPI null", bt.j.status === "DIBATALKAN" && j2.sumber.find((x) => x.id === "TIKTOK").biaya.status === "SPEND_TIDAK_LENGKAP" && j2.sumber.find((x) => x.id === "TIKTOK").biaya.cpa === null && (await num("select count(*) as n from ad_source_spend_entries where id = '" + ub.j.id + "'")) === 1);
const akt = await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: hari[0], nominal: "150000", alasan: ALASAN + " (aktifkan)" } });
cek("input ulang pada entri batal = AKTIFKAN kembali (bukan entri ganda)", akt.j.aksi === "AKTIFKAN" && (await num("select count(*) as n from ad_source_spend_entries where source_id='TIKTOK' and date_from = '" + hari[0] + "'")) === 1);

// F. Meta: detail Ad (data produksi nyata pada salinan) vs manual — parsial/override/pencabutan
const ad = (await prisma.$queryRawUnsafe(`select to_char(date_wib,'YYYY-MM-DD') d, sum(spend)::text s from meta_ad_daily_spend where date_wib < (now() at time zone 'Asia/Jakarta')::date group by date_wib order by date_wib desc limit 1`))[0];
if (!ad) skip("Meta: detail Ad vs manual", "tidak ada detail Ad di salinan restore");
else {
  const det = Number(ad.s); const meta = async () => (await ambil(ad.d, ad.d)).sumber.find((x) => x.id === "META");
  const m0 = await meta(); cek(`Meta ${ad.d}: detail Ad saja → LENGKAP, sumber angka & alasan terbaca`, m0.biaya.status === "LENGKAP" && m0.biaya.spend === det && m0.biaya.cakupan.pemilihan[0].kode === "AD_DETAIL" && /diutamakan atas entri manual/.test(m0.biaya.cakupan.pemilihan[0].alasan), JSON.stringify(m0.biaya.cakupan.asalDetailAd));
  const man = (o) => ({ sumber: "META", jenis: "HARIAN", dari: ad.d, nominal: String(Math.round(det * 3)), alasan: ALASAN, ...o });
  await call("PUT", "/biaya-sumber", { body: man() }); const m1 = await meta();
  cek("manual 3× detail → DETAIL_AD_SELISIH (detail dianggap parsial), spend tetap = detail (tidak dijumlah), KPI null", m1.biaya.status === "DETAIL_AD_SELISIH" && m1.biaya.spend === det && m1.biaya.cpa === null && m1.biaya.cashRoas === null, m1.biaya.status);
  await call("PUT", "/biaya-sumber", { body: man({ gantiDetailAd: true, alasan: ALASAN + " (override)" }) }); const m2 = await meta();
  cek("override → LENGKAP memakai manual (menggantikan, bukan menambah)", m2.biaya.status === "LENGKAP" && m2.biaya.spend === Math.round(det * 3) && m2.biaya.cakupan.pemilihan[0].kode === "MANUAL_OVERRIDE");
  await call("PUT", "/biaya-sumber", { body: man({ alasan: ALASAN + " (cabut override)" }) }); const m3 = await meta();
  cek("pencabutan override → kembali ke detail Ad + selisih muncul lagi", m3.biaya.status === "DETAIL_AD_SELISIH" && m3.biaya.spend === det);
  const d0 = await call("PUT", "/biaya-sumber", { body: man({ nominal: String(det), alasan: ALASAN + " (sama dengan detail)" }) }); const m4 = await meta();
  cek("manual = detail Ad → LENGKAP (tidak ada selisih), detail dipakai", d0.s === 200 && m4.biaya.status === "LENGKAP" && m4.biaya.spend === det);
}

// H. BUKTI KHUSUS (permintaan Owner): campaign tak terisi manual; detail parsial; cakupan override; tanpa jumlah ganda; pemisahan angka; definisi CPA; hari berjalan; /iklan & /d7 tak berubah
const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const putB = (o) => call("PUT", "/biaya-sumber", { body: { alasan: ALASAN + " (bukti khusus)", ...o } });
const batal = (id) => call("POST", `/biaya-sumber/${id}/batalkan`, { body: { alasan: "FIXTURE UJI bukti khusus: dibatalkan" } });
const sm = async (d, s) => (await ambil(d, s));
const metaDi = async (d, s) => (await sm(d, s)).sumber.find((x) => x.id === "META");
// H1. biaya sumber MANUAL tidak mengisi/melengkapi biaya CAMPAIGN: laporan /iklan (campaign) sebelum = sesudah semua penulisan; blok campaign di /sumber sama
const iklan1 = hapusVolatil((await call("GET", `/?level=campaign&dari=${DARI}&sampai=${SAMPAI}`)).j);
cek("H1 /iklan (campaign) SESUDAH semua penulisan biaya manual = SEBELUM (biaya campaign tidak terisi/terlengkapi oleh manual)", JSON.stringify(iklan0) === JSON.stringify(iklan1) && iklan1.biaya?.spendTotal === iklan0.biaya?.spendTotal, `status biaya campaign=${iklan1.biaya?.status}`);
const jH1 = await ambil();
cek("H1 blok campaign Meta di /sumber (biayaCampaignTerbukti) tidak berubah oleh biaya sumber; sedangkan biaya sumber (label CRM) memang bergerak", JSON.stringify(j0.sumber.find((x) => x.id === "META").biayaCampaignTerbukti) === JSON.stringify(jH1.sumber.find((x) => x.id === "META").biayaCampaignTerbukti) && jH1.sumber.find((x) => x.id === "META").biaya.dasar === "ATRIBUSI_LABEL_CRM");
// H7 sebagian: /d7 tidak berubah
const d7_1 = hapusVolatil((await call("GET", `/d7?dari=${D7_DARI}&sampai=${SAMPAI}`)).j);
cek("H8 /d7 SESUDAH penulisan biaya = SEBELUM", JSON.stringify(d7_0) === JSON.stringify(d7_1) && d7_1 && !d7_1.error);
console.log("HASH_IKLAN=" + createHash("sha256").update(JSON.stringify(iklan1)).digest("hex") + " HASH_D7=" + createHash("sha256").update(JSON.stringify(d7_1)).digest("hex"));
// bersihkan sisa F supaya skenario H bebas konflik
const semuaMeta = (await prisma.$queryRawUnsafe("select id::text id from ad_source_spend_entries where source_id='META' and status='AKTIF'")).map((r) => r.id);
for (const id of semuaMeta) await batal(id);
// H2. DETAIL PARSIAL tidak otomatis LENGKAP walau ADA BARIS SETIAP HARI
const hariAd = (await prisma.$queryRawUnsafe(`select to_char(date_wib,'YYYY-MM-DD') d, sum(spend)::numeric s from meta_ad_daily_spend where date_wib < (now() at time zone 'Asia/Jakarta')::date group by date_wib order by date_wib`)).map((r) => ({ d: r.d, s: Number(r.s) }));
let run = []; let terbaik = [];
for (const h of hariAd) { if (run.length && Date.parse(h.d + "T00:00:00Z") - Date.parse(run[run.length - 1].d + "T00:00:00Z") === 864e5) run.push(h); else run = [h]; if (run.length > terbaik.length) terbaik = [...run]; }
if (terbaik.length < 3) skip("H2/H3 detail Ad: butuh ≥ 3 hari berurutan berdetail Ad", "tidak ada di salinan restore");
else {
  const a = terbaik[0].d, b = terbaik[terbaik.length - 1].d, jumlah = terbaik.reduce((x, y) => x + y.s, 0);
  const m0 = await metaDi(a, b);
  cek(`H2 ${terbaik.length} hari ${a}..${b}: baris detail ADA di setiap hari → LENGKAP hanya karena benar-benar tanpa pembanding`, m0.biaya.status === "LENGKAP" && m0.biaya.cakupan.hari.adDetail === terbaik.length && Math.abs(m0.biaya.spend - jumlah) < 0.01 && m0.biaya.cakupan.verifikasi.tingkat === "TANPA_PEMBANDING" && m0.biaya.cakupan.verifikasi.independen === false);
  const tr = await putB({ sumber: "META", jenis: "TOTAL_RENTANG", dari: a, sampai: b, nominal: String(Math.round(jumlah * 2)) });
  const m1 = await metaDi(a, b);
  cek("H2 total rentang pembanding 2× jumlah detail → status DETAIL_AD_SELISIH (BUKAN LENGKAP walau ada baris setiap hari); spend tetap = detail (tidak dijumlah); CPA/ROAS null", tr.s === 201 && m1.biaya.status === "DETAIL_AD_SELISIH" && m1.biaya.spendLengkap === false && Math.abs(m1.biaya.spend - jumlah) < 0.01 && m1.biaya.cpa === null && m1.biaya.cashRoas === null && m1.biaya.bookedRoas === null, m1.biaya.status);
  await batal(tr.j.id);
  const tr2 = await putB({ sumber: "META", jenis: "TOTAL_RENTANG", dari: a, sampai: b, nominal: String(jumlah) });
  const m2 = await metaDi(a, b);
  cek("H2 total rentang = jumlah detail → LENGKAP dengan spend = jumlah detail (satu kali, tidak 2×); kunci yang sama diaktifkan kembali, bukan entri ganda", tr2.j.aksi === "AKTIFKAN" && tr2.j.id === tr.j.id && m2.biaya.cakupan.verifikasi.tingkat === "COCOK_TOTAL_KONTROL_INPUT" && m2.biaya.cakupan.verifikasi.independen === false && /BUKAN verifikasi independen/.test(m2.biaya.cakupan.verifikasi.catatan) && m2.biaya.status === "LENGKAP" && Math.abs(m2.biaya.spend - jumlah) < 0.01, `${m2.biaya.spend} vs ${jumlah}`);
  await batal(tr2.j.id);
  // H3. OVERRIDE: hanya sumber/periode yang dipilih; alasan wajib; audit; dapat dicabut
  const d1 = terbaik[1].d, d2 = terbaik[2].d, det1 = terbaik[1].s, det2 = terbaik[2].s;
  const jTT0 = (await sm(d1, d1)).sumber.find((x) => x.id === "TIKTOK").biaya.status;
  cek("H3 override tanpa alasan ditolak 400 ALASAN_WAJIB; override untuk TikTok ditolak 400 OVERRIDE_TIDAK_VALID", (await call("PUT", "/biaya-sumber", { body: { sumber: "META", jenis: "HARIAN", dari: d1, nominal: "5000000", gantiDetailAd: true, alasan: "" } })).j?.code === "ALASAN_WAJIB" && (await call("PUT", "/biaya-sumber", { body: { sumber: "TIKTOK", jenis: "HARIAN", dari: d1, nominal: "5", gantiDetailAd: true, alasan: ALASAN } })).j?.code === "OVERRIDE_TIDAK_VALID");
  const ov = await putB({ sumber: "META", jenis: "HARIAN", dari: d1, nominal: String(Math.round(det1 * 3)), gantiDetailAd: true, alasan: "FIXTURE UJI bukti khusus: override hari " + d1 });
  const mA = await metaDi(d1, d1), mB = await metaDi(d2, d2), mAB = await metaDi(d1, d2);
  cek(`H3 override pada ${d1} saja: hari itu memakai manual; ${d2} (hari lain) tetap detail Ad; rentang gabungan = override + detail hari lain (tanpa jumlah ganda); TikTok tak terpengaruh`,
    ov.s === 201 && mA.biaya.spend === Math.round(det1 * 3) && mA.biaya.cakupan.hari.override === 1 && Math.abs(mB.biaya.spend - det2) < 0.01 && mB.biaya.cakupan.hari.override === 0 && Math.abs(mAB.biaya.spend - (Math.round(det1 * 3) + det2)) < 0.01 && (await sm(d1, d1)).sumber.find((x) => x.id === "TIKTOK").biaya.status === jTT0);
  const revOv = (await prisma.$queryRawUnsafe(`select r.new_override::text no, r.reason, r.changed_by_id cb from ad_source_spend_revisions r where r.entry_id = '${ov.j.id}'::uuid order by r.revision desc limit 1`))[0];
  cek("H3 audit override: new_override=true, alasan tercatat, pengubah = ADMIN", revOv.no === "true" && /override hari/.test(revOv.reason) && revOv.cb === adm.id);
  const cab = await putB({ sumber: "META", jenis: "HARIAN", dari: d1, nominal: String(Math.round(det1 * 3)), alasan: "FIXTURE UJI bukti khusus: cabut override" });
  const mC = await metaDi(d1, d1);
  const revCab = (await prisma.$queryRawUnsafe(`select r.prev_override::text po, r.new_override::text no from ad_source_spend_revisions r where r.entry_id = '${ov.j.id}'::uuid order by r.revision desc limit 1`))[0];
  cek("H3 pencabutan override: kembali ke detail Ad (+ selisih terlihat); audit prev=true → new=false", cab.j.aksi === "UBAH" && mC.biaya.status === "DETAIL_AD_SELISIH" && Math.abs(mC.biaya.spend - det1) < 0.01 && revCab.po === "true" && revCab.no === "false");
  await batal(ov.j.id);
}
// H4. biaya bulanan lama (AdSpend) + manual harian + detail Ad tidak dijumlah ganda
const bulan = (await prisma.$queryRawUnsafe(`select year, month, amount from "AdSpend" where source::text = 'META_ADS' and amount > 0 and make_date(year, month, 1) + interval '1 month' <= (now() at time zone 'Asia/Jakarta')::date and not exists (select 1 from meta_ad_daily_spend d where d.date_wib >= make_date(year, month, 1) and d.date_wib < make_date(year, month, 1) + interval '1 month') order by year desc, month desc limit 1`))[0];
if (!bulan) skip("H4 biaya bulanan lama + manual", "tidak ada AdSpend META bulan lampau di salinan restore");
else {
  const y = Number(bulan.year), mo = Number(bulan.month), awal = `${y}-${String(mo).padStart(2, "0")}-01`; const akhir = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); const nominal = Number(bulan.amount);
  const mm0 = await metaDi(awal, akhir);
  cek(`H4 bulan ${awal}..${akhir} (tanpa detail Ad): hanya biaya bulanan lama (AdSpend Rp${nominal.toLocaleString("id-ID")}) → dipakai SEKALI sebagai total (tidak diprorata ke hari)`, mm0.biaya.status === "LENGKAP" && mm0.biaya.spend === nominal && mm0.biaya.cakupan.biayaBulananPengaturan.some((b) => b.dipakai), `${mm0.biaya.status} ${mm0.biaya.spend}`);
  const mh = await putB({ sumber: "META", jenis: "HARIAN", dari: awal, nominal: "1000000" });
  const mm1 = await metaDi(awal, akhir);
  const bul = mm1.biaya.cakupan.biayaBulananPengaturan.find((b) => b.tahun === y && b.bulan === mo);
  cek("H4 + manual harian pada bulan itu: biaya bulanan lama DIABAIKAN (bukan ditambah) → spend = manual saja (bukan bulanan + manual); status tidak lengkap", mh.s === 201 && bul && bul.dipakai === false && /ADA_ENTRI_SUMBER_PADA_BULAN_INI/.test(bul.alasan) && mm1.biaya.spend === 1000000 && mm1.biaya.status === "SPEND_TIDAK_LENGKAP", `${mm1.biaya.spend} (bulanan ${nominal})`);
  const jSep = await sm(awal, akhir);
  cek("H4 KASUS SEPTEMBER: bulanan 42 jt diganti satu entri harian 1 jt → periode sebulan tetap SPEND_TIDAK_LENGKAP dan SELURUH CPL/CPA/Booked/Cash ROAS (semua sumber + total berbayar) null dengan alasan", jSep.sumber.every((x) => x.biaya.cpa === null && x.biaya.cpl === null && x.biaya.bookedRoas === null && x.biaya.cashRoas === null) && jSep.total.berbayar.cpa === null && jSep.total.berbayar.bookedRoas === null && jSep.total.berbayar.cashRoas === null && jSep.total.berbayar.lengkap === false && jSep.sumber.find((x) => x.id === "META").biaya.alasanNull.cpa === "SPEND_TIDAK_LENGKAP", JSON.stringify(jSep.sumber.map((x) => [x.id, x.biaya.status])));
  await batal(mh.j.id);
  cek("H4 entri manual dibatalkan → kembali ke biaya bulanan lama sekali (tanpa sisa ganda)", (await metaDi(awal, akhir)).biaya.spend === nominal);
}
// H7. hari berjalan & data tidak lengkap menahan KPI
const sHB = await sm(SAMPAI, hariIni);
cek("H7 rentang memuat hari ini: periode.termasukHariBerjalan, peringatan HARI_BERJALAN, dan CPA/Booked/Cash ROAS SEMUA sumber null walau entri biaya hari lampau ada", sHB.periode.termasukHariBerjalan === true && sHB.peringatan.some((p) => p.kode === "HARI_BERJALAN") && sHB.sumber.every((x) => x.biaya.cpa === null && x.biaya.bookedRoas === null && x.biaya.cashRoas === null) && sHB.total.berbayar.cpa === null);
const idTT = (await prisma.$queryRawUnsafe(`select id::text id from ad_source_spend_entries where source_id='TIKTOK' and status='AKTIF' and date_from = '${hari[3]}'`))[0].id;
await batal(idTT);
const ttHilang = (await ambil()).sumber.find((x) => x.id === "TIKTOK");
cek("H7 biaya TIDAK lengkap (satu hari TikTok dibatalkan): status SPEND_TIDAK_LENGKAP + hari hilang tercatat; spend ada tetapi CPA/CPL/Booked/Cash ROAS null; total berbayar null", ttHilang.biaya.status === "SPEND_TIDAK_LENGKAP" && ttHilang.biaya.cakupan.hariHilang.includes(hari[3]) && ttHilang.biaya.spend > 0 && ttHilang.biaya.cpa === null && ttHilang.biaya.cpl === null && ttHilang.biaya.bookedRoas === null && ttHilang.biaya.cashRoas === null && (await ambil()).total.berbayar.cpa === null);
await putB({ sumber: "TIKTOK", jenis: "HARIAN", dari: hari[3], nominal: "150000", alasan: ALASAN + " (aktifkan lagi)" });
// H5/H6. angka TERPISAH + definisi CPA (customer unik lunas)
const jj = await ambil(); const t6 = jj.sumber.find((x) => x.id === "TIKTOK");
cek("H5 invarian pemisahan: lunas ≤ membayar ≤ ber-order ≤ lead sah ≤ lead; kategori saling lepas = ber-order; uang bersih = ledger − refund; nilai order & uang adalah dua angka berbeda", jj.sumber.every((x) => x.lunas <= x.membayar && x.membayar <= x.berOrder && x.berOrder <= x.leadSah && x.leadSah <= x.lead && x.kategoriEksklusif.jumlah === x.berOrder && Math.abs(x.uang.uangBersih - (x.uang.uangLedger - x.uang.refund)) < 0.01) && jj.sumber.some((x) => x.uang.nilaiOrderSaatIni !== x.uang.uangBersih));
cek(`H6 CPA = biaya ÷ CUSTOMER UNIK lunas (penyebut ${t6.biaya.penyebut?.customerLunas}), bukan jumlah order lunas (${t6.order.lunas}) / customer membayar (${t6.membayar}) / ber-order (${t6.berOrder})`, t6.biaya.penyebut.customerLunas === t6.lunas && (t6.biaya.status !== "LENGKAP" ? t6.biaya.cpa === null : (t6.lunas > 0 ? Math.abs(t6.biaya.cpa - t6.biaya.spend / t6.lunas) < 0.01 : t6.biaya.cpa === null)));
// G. rekonsiliasi sesudah penulisan: hitungan & uang tidak berubah karena biaya; tabel lama tidak tersentuh
const j3 = await ambil(); const A1 = agregat(j3);
cek("rekonsiliasi: lead/ber-order/membayar/lunas/nilai/uang per sumber IDENTIK sebelum vs sesudah menulis biaya", JSON.stringify(A0) === JSON.stringify(A1));
const fp1 = await fp();
cek("TIDAK menyentuh tabel lama: Customer, Order, Payment, AdSpend, spend per Ad, touch, jurnal, stok, unit identik", bedaTabel(fp0, fp1).length === 0, bedaTabel(fp0, fp1).join(","));
cek("jejak audit: setiap entri punya revisi; jumlah revisi ≥ jumlah entri", (await num("select count(*) as n from ad_source_spend_revisions")) >= (await num("select count(*) as n from ad_source_spend_entries")));
const e1 = await prisma.$executeRawUnsafe("update ad_source_spend_revisions set reason = 'x'").then(() => null, (e) => e); const e2 = await prisma.$executeRawUnsafe("delete from ad_source_spend_revisions").then(() => null, (e) => e);
cek("trigger DB: revisi tidak bisa diubah/dihapus", !!e1 && !!e2);
console.log("AGREGAT_BARU=" + JSON.stringify(A1));
srv.close(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal + " dilewati=" + dilewati);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
# KOMPATIBILITAS ROLLBACK KODE + REKONSILIASI LAMA=BARU: image LAMA (yang sedang melayani produksi) dijalankan terhadap salinan restore yang SUDAH bermigrasi dan berisi entri biaya uji (FIXTURE; hanya di DB sementara).
# Kode lama harus menghitung /sumber persis seperti kode baru untuk semua angka non-biaya (lead, spam, ber-order, membayar, lunas, nilai order, uang) dan tidak melihat biaya manual.
NET_PROD="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CID_OLD" | awk '{print $1}')"
[ -n "$NET_PROD" ] || { reh_drop; die "jaringan docker produksi tidak terbaca (uji kode lama)"; }
docker run --rm -i --network "$NET_PROD" --env-file "$PERSIST/backend/.env" -e DATABASE_URL="$RH_URL" -e PER_DARI="$PER_DARI" -e PER_SAMPAI="$PER_SAMPAI" "$ROLLBACK_TAG" node --input-type=module - <<'LAMANODE' > "$BK_DIR/rehearsal-kode-lama.log" 2>&1 || { cat "$BK_DIR/rehearsal-kode-lama.log"; reh_drop; die "uji KODE LAMA terhadap DB bermigrasi GAGAL — rollback kode TIDAK terbukti aman (lihat rehearsal-kode-lama.log)"; }
// Dijalankan di dalam IMAGE LAMA (yang sedang melayani produksi) terhadap salinan restore yang SUDAH bermigrasi dan berisi entri biaya uji: bukti rollback kode aman.
// Kode lama tidak mengenal tabel baru; ia harus tetap menghitung /sumber, laporan iklan, dan D7 persis seperti sebelum migrasi. Hanya BACA. Mencetak AGREGAT_LAMA=<json> (sama bentuk dengan AGREGAT_BARU).
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const DARI = process.env.PER_DARI, SAMPAI = process.env.PER_SAMPAI;
const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const { hitungSumberPerforma } = await import("/app/src/services/attribution/sumber.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const tabelBaru = Number((await prisma.$queryRawUnsafe("select count(*)::int n from pg_tables where schemaname='public' and tablename in ('ad_source_spend_entries','ad_source_spend_revisions')"))[0].n);
const entri = Number((await prisma.$queryRawUnsafe("select count(*)::int n from ad_source_spend_entries"))[0].n);
cek("image LAMA berjalan terhadap DB bermigrasi (2 tabel baru ada, berisi entri uji)", tabelBaru === 2 && entri > 0, `tabel=${tabelBaru} entri=${entri}`);
const j = await hitungSumberPerforma(prisma, { dari: DARI, sampai: SAMPAI, hariIni, bawaan: false });
cek("kode LAMA menghitung /sumber tanpa galat: 6 sumber", j.sumber.length === 6);
const A = Object.fromEntries(j.sumber.map((x) => [x.id, [x.lead, x.spam, x.leadSah, x.berOrder, x.membayar, x.lunas, x.pernahDp, x.dpSaatIni, x.uang.nilaiOrderSaatIni, x.uang.uangLedger, x.uang.refund, x.uang.uangBersih]]));
cek("kode LAMA tidak melihat biaya manual (biaya per sumber non-Meta = 'tanpa sumber spend'; tidak ada angka biaya dari tabel baru)", j.sumber.filter((x) => x.id !== "META").every((x) => x.biaya.spend === null && x.biaya.cpa === null));
console.log("AGREGAT_LAMA=" + JSON.stringify(A));
// /iklan (campaign) dan /d7 lewat ROUTER lama asli + sesi ADMIN nyata: hash harus sama dengan kode baru (laporan lain tidak berubah)
const jwt = require("jsonwebtoken"); const express = require("express");
const { attributionAdsRouter } = await import("/app/src/routes/attributionAds.js");
let adm = null; for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]); if (rs.has("ADMIN")) { adm = u; break; } }
const tA = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: ["ADMIN"] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const app = express(); app.use("/api/atribusi/iklan", attributionAdsRouter);
const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); }); const BASE = `http://127.0.0.1:${srv.address().port}/api/atribusi/iklan`;
const ambil = async (p) => { const r = await fetch(BASE + p, { headers: { Authorization: "Bearer " + tA } }); return r.json(); };
const hapusVolatil = (o) => JSON.parse(JSON.stringify(o, (k, v) => (["dihitungPada", "waktuWib", "waktu"].includes(k) ? undefined : v)));
const D7_DARI = new Date(Date.parse(SAMPAI + "T00:00:00Z") - 9 * 864e5).toISOString().slice(0, 10);
const iklan = hapusVolatil(await ambil(`/?level=campaign&dari=${DARI}&sampai=${SAMPAI}`)); const d7 = hapusVolatil(await ambil(`/d7?dari=${D7_DARI}&sampai=${SAMPAI}`));
cek("kode LAMA: /iklan (campaign) dan /d7 menjawab tanpa galat terhadap DB bermigrasi berisi entri biaya", !iklan.error && !d7.error && Array.isArray(iklan.grup));
console.log("HASH_IKLAN=" + createHash("sha256").update(JSON.stringify(iklan)).digest("hex") + " HASH_D7=" + createHash("sha256").update(JSON.stringify(d7)).digest("hex"));
srv.close();
await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
LAMANODE
AG_BARU="$(grep '^AGREGAT_BARU=' "$BK_DIR/rehearsal-koreksi.log" | tail -n 1 | sed 's/^AGREGAT_BARU=//')"
AG_LAMA="$(grep '^AGREGAT_LAMA=' "$BK_DIR/rehearsal-kode-lama.log" | tail -n 1 | sed 's/^AGREGAT_LAMA=//')"
[ -n "$AG_BARU" ] && [ -n "$AG_LAMA" ] || { reh_drop; die "agregat lama/baru tidak tercetak"; }
[ "$AG_BARU" = "$AG_LAMA" ] || { printf 'baru: %s\nlama: %s\n' "$AG_BARU" "$AG_LAMA"; reh_drop; die "REKONSILIASI GAGAL: angka kode LAMA ≠ kode BARU pada data restore yang sama (lead/ber-order/membayar/lunas/nilai/uang per sumber)"; }
HS_BARU="$(grep '^HASH_IKLAN=' "$BK_DIR/rehearsal-koreksi.log" | tail -n 1)"; HS_LAMA="$(grep '^HASH_IKLAN=' "$BK_DIR/rehearsal-kode-lama.log" | tail -n 1)"
[ -n "$HS_BARU" ] && [ "$HS_BARU" = "$HS_LAMA" ] || { printf 'baru: %s\nlama: %s\n' "$HS_BARU" "$HS_LAMA"; reh_drop; die "/iklan (campaign) atau /d7 BERBEDA antara kode LAMA dan BARU pada data restore yang sama — laporan lain tidak boleh berubah"; }
ok "kode LAMA terhadap DB bermigrasi berisi entri biaya: $(grep -c '^OK' "$BK_DIR/rehearsal-kode-lama.log") pemeriksaan lulus; agregat per sumber DAN hash /iklan (campaign) + /d7 IDENTIK dengan kode baru (rekonsiliasi lama=baru; laporan lain tidak berubah) → ROLLBACK KODE aman"
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi; uji tulis biaya manual (idempoten/ubah/batal/konflik/override) + uji KODE LAMA dilakukan pada salinan lalu DB sementara dihapus"
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

SWITCH_AT_ISO="$(date -u +%FT%TZ)"
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
ok "objek rilis terpasang di produksi: 2 tabel (biaya sumber + revisi) — kosong; 1 FK RESTRICT, 8 CHECK, indeks (2 unik), trigger append-only tervalidasi"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: izin (401/403), validasi + dryRun tanpa menulis, periode/parameter, kontrak /sumber, rekonsiliasi SQL independen, deep-link URL laporan; tabel biaya tetap kosong; tidak ada jejak tulis"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e SWITCH_AT_ISO="$SWITCH_AT_ISO" -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e ORDER_N="$ORDER_N" -e JOB_N="$JOB_N" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER", "PRODUCTION_LEAD", "WAREHOUSE"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
const adm = await userDengan("ADMIN", new Set());
const sales = await userDengan("SALES", BERIZIN);
if (!adm) { rec("akun ADMIN tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm); const tS = sales ? await tokenUntuk(sales) : null;
const B = (k) => Number(process.env[k]);
const req = async (method, path, token, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.clone().json(); } catch { /* bukan JSON */ } return { status: r.status, json: j, teks: await r.text().catch(() => "") }; };
const get = (p, t) => req("GET", p, t);
// PRODUKSI HIDUP: tabel yang bergerak karena lalu lintas (customer baru, order, pembayaran, touch, jurnal, stok) TIDAK boleh dibandingkan identik (gagal palsu). Dua kelompok:
//  STRIK  = tabel yang HANYA boleh berubah oleh penulisan biaya/spend yang disengaja (tidak ada di rilis ini) → isi harus IDENTIK sebelum vs sesudah smoke;
//  MONOTON = tabel yang boleh bertambah oleh lalu lintas sah tetapi TIDAK BOLEH BERKURANG (tidak ada yang terhapus/ter-rollback oleh smoke).
const STRIK = ["AdSpend", "meta_ad_daily_spend", "meta_spend_imports", "ad_source_spend_entries", "ad_source_spend_revisions"];
const MONOTON = ["Customer", "Order", "payments", "attribution_touches", "fin_journal_entries", "fin_journal_lines", "stock_movements", "units"];
const TABEL = [...STRIK, ...MONOTON];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const sebelum = await fp();
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);

// periode: 30 hari PENUH berakhir kemarin (WIB)
const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const geser = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const SAMPAI = geser(hariIni, -1), DARI = geser(hariIni, -30);

// tabel rilis terpasang dan KOSONG; kode berjalan memuat modul rilis
rec("2 tabel rilis ada dan KOSONG (rilis tidak mengimpor/menulis biaya)", (await hitung("select (select count(*) from ad_source_spend_entries) + (select count(*) from ad_source_spend_revisions) as n")) === 0 && (await hitung("select count(*) as n from pg_tables where schemaname='public' and tablename in ('ad_source_spend_entries','ad_source_spend_revisions')")) === 2);
const M = await import("/app/src/services/attribution/biayaSumber.js");
rec("kode berjalan = kandidat: modul biayaSumber memuat prioritas 'detail Ad parsial' (DETAIL_AD_SELISIH)", typeof M.hitungCakupan === "function" && M.hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-20", hariIni: "2026-10-26", entries: [{ id: "x", sourceId: "META", kind: "HARIAN", dateFrom: "2026-10-20", dateTo: "2026-10-20", accountId: "", amount: 2000000, override: false, status: "AKTIF" }], adHarian: new Map([["2026-10-20", 500000]]) }).status === "DETAIL_AD_SELISIH");

// izin: ditolak SEBELUM menyentuh data
for (const [m, p] of [["GET", `/api/atribusi/iklan/sumber?dari=${DARI}&sampai=${SAMPAI}`], ["GET", `/api/atribusi/iklan/biaya-sumber?dari=${DARI}&sampai=${SAMPAI}`], ["PUT", "/api/atribusi/iklan/biaya-sumber"], ["POST", "/api/atribusi/iklan/biaya-sumber/00000000-0000-4000-8000-000000000000/batalkan"], ["GET", "/api/atribusi/iklan/biaya-sumber/00000000-0000-4000-8000-000000000000/riwayat"]]) {
  rec(`${m} ${p.split("?")[0].replace("/api/atribusi/iklan", "")}: tanpa token 401`, (await req(m, p, null, m === "GET" ? undefined : {})).status === 401);
  if (tS) rec(`${m} ${p.split("?")[0].replace("/api/atribusi/iklan", "")}: SALES 403`, (await req(m, p, tS, m === "GET" ? undefined : {})).status === 403);
}
if (!tS) skip("izin SALES 403", "tidak ada akun SALES murni aktif (diuji pada rehearsal dan tes integrasi)");
// validasi ditolak sebelum menyentuh data (TIDAK ada penulisan produksi)
rec("PUT biaya: nominal negatif 400; sumber organik 400; hari berjalan 400", (await req("PUT", "/api/atribusi/iklan/biaya-sumber", tA, { sumber: "TIKTOK", jenis: "HARIAN", dari: SAMPAI, nominal: "-5", alasan: "uji smoke" })).status === 400
  && (await req("PUT", "/api/atribusi/iklan/biaya-sumber", tA, { sumber: "INSTAGRAM", jenis: "HARIAN", dari: SAMPAI, nominal: "5", alasan: "uji smoke" })).status === 400
  && (await req("PUT", "/api/atribusi/iklan/biaya-sumber", tA, { sumber: "TIKTOK", jenis: "HARIAN", dari: hariIni, nominal: "5", alasan: "uji smoke" })).status === 400);
const dry = await req("PUT", "/api/atribusi/iklan/biaya-sumber", tA, { sumber: "TIKTOK", jenis: "HARIAN", dari: SAMPAI, nominal: "1", alasan: "uji smoke dry-run", dryRun: true });
rec("PUT biaya dryRun = rencana saja (200, ditulis=false)", dry.status === 200 && dry.json?.ditulis === false && dry.json?.dryRun === true, String(dry.status));

// periode (URL → API): respons memuat periode yang diminta; parameter salah ditolak
const s = await get(`/api/atribusi/iklan/sumber?dari=${DARI}&sampai=${SAMPAI}`, tA);
rec("GET /sumber (ADMIN) 200 dan periode = periode yang diminta", s.status === 200 && s.json?.periode?.dari === DARI && s.json?.periode?.sampai === SAMPAI && s.json?.periode?.termasukHariBerjalan === false, `${DARI}..${SAMPAI}`);
rec("GET /sumber: satu batas / terbalik / masa depan = 400", (await get(`/api/atribusi/iklan/sumber?dari=${DARI}`, tA)).status === 400 && (await get(`/api/atribusi/iklan/sumber?dari=${SAMPAI}&sampai=${DARI}`, tA)).status === 400 && (await get("/api/atribusi/iklan/sumber?dari=2099-01-01&sampai=2099-01-02", tA)).status === 400);
const hi = await get(`/api/atribusi/iklan/sumber?dari=${DARI}&sampai=${hariIni}`, tA);
const meta0 = hi.json?.sumber?.find((x) => x.id === "META");
rec("rentang memuat hari ini: peringatan HARI_BERJALAN dan semua CPA/ROAS null (tidak ada angka semu)", hi.status === 200 && hi.json.periode.termasukHariBerjalan === true && hi.json.peringatan.some((p) => p.kode === "HARI_BERJALAN") && hi.json.sumber.every((x) => x.biaya.cpa === null && x.biaya.cashRoas === null && x.biaya.bookedRoas === null));
const j = s.json;
// kontrak
rec("kontrak: 6 sumber; dasar biaya 'ATRIBUSI_LABEL_CRM'; organik 'TIDAK_TERSEDIA_ORGANIK'; biayaCampaignTerbukti hanya Meta; total.berbayar & cutoffEvaluasi ada",
  j?.sumber?.length === 6 && j.sumber.every((x) => x.biaya.dasar === "ATRIBUSI_LABEL_CRM") && j.sumber.filter((x) => x.jenis === "ORGANIK").every((x) => x.biaya.status === "TIDAK_TERSEDIA_ORGANIK" && x.biaya.spend === null)
  && j.sumber.filter((x) => x.biayaCampaignTerbukti).map((x) => x.id).join() === "META" && !!j.total.berbayar && /WIB$/.test(j.cutoffEvaluasi?.waktuWib || ""));
rec("biaya belum diisi ≠ Rp0: TikTok & Lainnya 'BELUM_DIISI', spend/CPA/ROAS null; total berbayar tidak dihitung (null)", ["TIKTOK", "LAINNYA"].every((id) => { const b = j.sumber.find((x) => x.id === id).biaya; return b.status === "BELUM_DIISI" && b.spend === null && b.cpa === null && b.cashRoas === null; }) && j.total.berbayar.cpa === null && j.total.berbayar.spend === null);
// rekonsiliasi (SQL independen + konsistensi internal); rentang berakhir kemarin → stabil selama rilis
const lo = new Date(Date.parse(DARI + "T00:00:00Z") - 7 * 3600e3), hiT = new Date(Date.parse(SAMPAI + "T00:00:00Z") + 864e5 - 7 * 3600e3);
for (const [id, label] of [["META", "META_ADS"], ["TIKTOK", "TIKTOK_ADS"], ["WHATSAPP", "WHATSAPP_DIRECT"]]) {
  const sql = await prisma.customer.count({ where: { leadSource: label, createdAt: { gte: lo, lt: hiT } } });
  rec(`rekonsiliasi SQL independen: lead ${id} = ${sql}`, j.sumber.find((x) => x.id === id).lead === sql);
}
const jml = (k) => j.sumber.reduce((a, x) => a + x[k], 0);
rec("rekonsiliasi: Σ per sumber = total (lead, spam, ber-order, membayar, lunas); nilai order & pembayaran bersih", ["lead", "spam", "berOrder", "membayar", "lunas"].every((k) => jml(k) === j.total[k]) && Math.abs(j.sumber.reduce((a, x) => a + x.uang.nilaiOrderSaatIni, 0) - j.total.nilaiOrderSaatIni) < 0.01 && Math.abs(j.sumber.reduce((a, x) => a + x.uang.uangBersih, 0) - j.total.uangBersih) < 0.01);
rec("rekonsiliasi: kategori saling lepas = ber-order per sumber", j.sumber.every((x) => x.kategoriEksklusif.jumlah === x.berOrder));
// laporan lain tidak berubah kontraknya
const ik = await get(`/api/atribusi/iklan?level=campaign&dari=${DARI}&sampai=${SAMPAI}`, tA);
rec("laporan iklan per campaign (tab Iklan) 200 dan memakai periode yang sama", ik.status === 200 && ik.json?.periode?.dari === DARI && ik.json?.periode?.sampai === SAMPAI && Array.isArray(ik.json?.grup));
const d7 = await get(`/api/atribusi/iklan/d7?dari=${geser(hariIni, -9)}&sampai=${SAMPAI}`, tA);
rec("D7 200 (kontrak tidak berubah)", d7.status === 200);
// tak ada jejak tulis
const sesudah = await fp(); const beda = STRIK.filter((t) => sebelum[t].n !== sesudah[t].n || sebelum[t].h !== sesudah[t].h); const berkurang = MONOTON.filter((t) => sesudah[t].n < sebelum[t].n);
rec("lalu lintas produksi hidup: Customer, Order, pembayaran, touch, jurnal, stok, unit TIDAK BERKURANG selama smoke (boleh bertambah oleh pengguna sah)", berkurang.length === 0, berkurang.join(",") || "tidak ada yang berkurang");
rec("TIDAK ada jejak tulis smoke: AdSpend, spend per Ad, impor spend, dan 2 tabel biaya sama persis sebelum vs sesudah smoke", beda.length === 0, beda.join(",") || "identik");
// INBOX & CAPTURE (read-only): ADMIN dapat membuka inbox; monitor capture sehat; flag capture tidak berubah; bila ada inbound sesudah switch, tercatat oleh kode baru
const inbox = await get("/api/conversations", tA);
rec("inbox: GET /api/conversations (ADMIN) 200", inbox.status === 200, String(inbox.status));
const mon = await get("/api/atribusi/iklan/monitor", tA); const ms = mon.json?.snapshot;
rec("monitor capture (ADMIN) 200: snapshot inbound + touch ada; capture tidak melaporkan kegagalan/tertunda pada proses baru", mon.status === 200 && !!ms?.inbound && !!ms?.touch && ms.touch.gagal === 0 && ms.touch.gagalPulih === 0 && ms.touch.tertunda === 0, mon.status === 200 ? JSON.stringify({ captureAktif: ms?.touch?.captureAktif, gagal: ms?.touch?.gagal, tertunda: ms?.touch?.tertunda, total: ms?.touch?.total }) : String(mon.status));
if (tS) rec("monitor capture: SALES 403", (await get("/api/atribusi/iklan/monitor", tS)).status === 403);
const T0 = process.env.SWITCH_AT_ISO ? Date.parse(process.env.SWITCH_AT_ISO) : null;
if (T0) {
  let ada = false; for (let i = 0; i < 18 && !ada; i++) { const m2 = (await get("/api/atribusi/iklan/monitor", tA)).json?.snapshot; const t = m2?.inbound?.terakhirAt ? Date.parse(m2.inbound.terakhirAt) : 0; if (t > T0) ada = true; else await new Promise((r) => setTimeout(r, 10000)); }
  if (ada) rec("inbound BARU sesudah switch tercatat oleh backend baru (inbox hidup)", true); else skip("inbound baru sesudah switch dalam 180 dtk", "tidak ada pesan masuk di jendela itu (bergantung lalu lintas); inbox & monitor tetap 200");
}
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
  ok "smoke test lulus (izin 401/403, validasi + dryRun tanpa menulis, periode/parameter, kontrak, rekonsiliasi SQL independen, tabel biaya kosong, tanpa jejak tulis, invarian)"
fi
# KONSISTENSI LIVE (BACA-SAJA): laporan dihitung oleh kode LAMA (image rollback, DB produksi) dan kode BARU (container baru, DB yang sama) → agregat per sumber, /iklan (campaign), /d7, dan flag capture harus SAMA.
# Periode = 30 hari penuh berakhir kemarin (stabil). Bila beda (mis. pembayaran masuk tepat di antara dua pembacaan), ulangi s/d 3×; tetap beda = berhenti (rollback kode).
PER_SAMPAI_L="$(date -u -d "@$(( $(date +%s) + 25200 - 86400 ))" +%F)"; PER_DARI_L="$(date -u -d "@$(( $(date +%s) + 25200 - 86400 * 30 ))" +%F)"
IFS= read -r -d '' HASH_JS <<'HASHNODE' || true
// BACA-SAJA. Dijalankan di image LAMA (rollback) dan di container BARU terhadap DB PRODUKSI yang sama: menghitung laporan lewat router asli masing-masing dengan sesi ADMIN sintetis (JWT dari JWT_SECRET lingkungan; tidak ada akun/kata sandi).
// Keluaran: AGREGAT (lead/ber-order/membayar/lunas/nilai/uang per sumber), HASH_IKLAN + HASH_D7 (laporan per campaign dan D7), MONITOR_CAPTURE (flag capture). Skrip rilis membandingkan keluaran lama vs baru.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken"); const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const DARI = process.env.PER_DARI, SAMPAI = process.env.PER_SAMPAI;
const { attributionAdsRouter } = await import("/app/src/routes/attributionAds.js");
let adm = null;
for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]); if (rs.has("ADMIN")) { adm = u; break; } }
if (!adm) { console.log("GAGAL tidak ada akun ADMIN aktif"); process.exit(1); }
const tok = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: ["ADMIN"] }, process.env.JWT_SECRET, { expiresIn: "5m" });
const app = express(); app.use("/api/atribusi/iklan", attributionAdsRouter);
const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); }); const BASE = `http://127.0.0.1:${srv.address().port}/api/atribusi/iklan`;
const ambil = async (p) => { const r = await fetch(BASE + p, { headers: { Authorization: "Bearer " + tok } }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { s: r.status, j }; };
const bersih = (o) => JSON.parse(JSON.stringify(o, (k, v) => (["dihitungPada", "waktuWib", "waktu"].includes(k) ? undefined : v)));
const D7_DARI = new Date(Date.parse(SAMPAI + "T00:00:00Z") - 9 * 864e5).toISOString().slice(0, 10);
const sm = await ambil(`/sumber?dari=${DARI}&sampai=${SAMPAI}`); const ik = await ambil(`/?level=campaign&dari=${DARI}&sampai=${SAMPAI}`); const d7 = await ambil(`/d7?dari=${D7_DARI}&sampai=${SAMPAI}`);
if (sm.s !== 200 || ik.s !== 200 || d7.s !== 200) { console.log(`GAGAL status sumber=${sm.s} iklan=${ik.s} d7=${d7.s}`); process.exit(1); }
const A = Object.fromEntries(sm.j.sumber.map((x) => [x.id, [x.lead, x.spam, x.leadSah, x.berOrder, x.membayar, x.lunas, x.pernahDp, x.dpSaatIni, x.uang.nilaiOrderSaatIni, x.uang.uangLedger, x.uang.refund, x.uang.uangBersih]]));
console.log("AGREGAT=" + JSON.stringify(A));
console.log("HASH_IKLAN=" + createHash("sha256").update(JSON.stringify(bersih(ik.j))).digest("hex"));
console.log("HASH_D7=" + createHash("sha256").update(JSON.stringify(bersih(d7.j))).digest("hex"));
const mon = await ambil("/monitor");
console.log("MONITOR_CAPTURE=" + (mon.s === 200 ? String(mon.j?.snapshot?.touch?.captureAktif) : "tidak_tersedia(" + mon.s + ")"));
await prisma.$disconnect(); srv.close(); process.exit(0);
HASHNODE
NET_LIVE="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CID_NEW" | awk '{print $1}')"
[ -n "$NET_LIVE" ] || die "jaringan docker produksi tidak terbaca (konsistensi live)"
# DATABASE_URL eksplisit (docker --env-file mempertahankan tanda kutip di .env → Prisma menolak URL). Kata sandi dibaca seperti pada rehearsal; tidak dicetak.
LIVE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${DB_NAME}"
hash_lama() { printf '%s\n' "$HASH_JS" | docker run --rm -i --network "$NET_LIVE" --env-file "$PERSIST/backend/.env" -e DATABASE_URL="$LIVE_URL" -e PER_DARI="$PER_DARI_L" -e PER_SAMPAI="$PER_SAMPAI_L" "$ROLLBACK_TAG" node --input-type=module - 2>&1; }
hash_baru() { printf '%s\n' "$HASH_JS" | dcp "$NEW_DIR" exec -T -e PER_DARI="$PER_DARI_L" -e PER_SAMPAI="$PER_SAMPAI_L" backend node --input-type=module - 2>&1; }
LIVE_SAMA=0
for try in 1 2 3; do
  HL="$(hash_lama)" || { printf '%s\n' "$HL" | tail -n 5; die "kode LAMA gagal menghitung laporan terhadap DB produksi (konsistensi live)"; }
  HB="$(hash_baru)" || { printf '%s\n' "$HB" | tail -n 5; die "kode BARU gagal menghitung laporan (konsistensi live)"; }
  printf '%s\n' "$HL" > "$BK_DIR/live-lama.log"; printf '%s\n' "$HB" > "$BK_DIR/live-baru.log"
  if [ "$(printf '%s\n' "$HL" | grep -E '^(AGREGAT|HASH_IKLAN|HASH_D7)=')" = "$(printf '%s\n' "$HB" | grep -E '^(AGREGAT|HASH_IKLAN|HASH_D7)=')" ] && [ -n "$(printf '%s\n' "$HB" | grep '^HASH_IKLAN=')" ]; then LIVE_SAMA=1; break; fi
  warn "percobaan ${try}: keluaran lama ≠ baru (mungkin data berubah di antara dua pembacaan); ulangi"; sleep 20
done
[ "$LIVE_SAMA" = "1" ] || { diff "$BK_DIR/live-lama.log" "$BK_DIR/live-baru.log" || true; die "KONSISTENSI LIVE GAGAL: agregat/ /iklan / /d7 / flag capture kode LAMA ≠ BARU pada DB produksi — rollback kode (jangan DROP tabel)"; }
ok "konsistensi live: agregat per sumber, /iklan (campaign), dan /d7 IDENTIK antara kode LAMA dan BARU pada DB produksi (periode ${PER_DARI_L}..${PER_SAMPAI_L})"
ML="$(printf '%s\n' "$HL" | grep '^MONITOR_CAPTURE=' | tail -n 1)"; MB="$(printf '%s\n' "$HB" | grep '^MONITOR_CAPTURE=' | tail -n 1)"
if [[ "$ML" =~ ^MONITOR_CAPTURE=(true|false)$ ]] && [[ "$MB" =~ ^MONITOR_CAPTURE=(true|false)$ ]]; then
  [ "$ML" = "$MB" ] || die "flag capture BERBEDA antara kode lama (${ML}) dan baru (${MB}) — env tidak boleh berubah"; ok "flag capture identik lama vs baru (${MB})"
else warn "flag capture tidak dapat dibandingkan (lama: ${ML:-kosong}; baru: ${MB:-kosong})"; fi
# ENV TIDAK BERUBAH
ENV_SHA_SESUDAH="$(sha256sum "$PERSIST/backend/.env" "$PERSIST/frontend/.env" | awk '{print $1}' | tr '\n' ' ')"
[ "$ENV_SHA_SEBELUM" = "$ENV_SHA_SESUDAH" ] || die "backend/.env atau frontend/.env BERUBAH selama rilis (sha256 berbeda)"
ok "env (backend/.env + frontend/.env) IDENTIK sebelum vs sesudah rilis (sha256)"
# URL laporan ber-state (?tab&dari&sampai&sumber) harus dilayani aplikasi web dengan bundel BARU (refresh / tautan / tombol Back membaca periode dari URL).
URL_DEEP="${PUBLIC_URL}/laporan?tab=Akuisisi&dari=${PER_DARI}&sampai=${PER_SAMPAI}&sumber=TIKTOK"
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$URL_DEEP")" = "200" ] || die "URL laporan ber-state tidak dilayani (200): ${URL_DEEP}"
[ "$(curl -fsS --max-time 15 "$URL_DEEP" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "URL laporan ber-state melayani bundel BUKAN dist baru (${NEW_INDEX})"
ok "URL laporan ber-state (tab/periode/sumber) dilayani dengan bundel baru ${NEW_INDEX}"
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
# Pembersihan release lama DINONAKTIFKAN untuk rilis ini: tidak ada direktori release, image, atau backup (milik sesi mana pun) yang dihapus oleh skrip ini.
PHASE="9-tanpa-pembersihan"; say "9. Pembersihan release lama DINONAKTIFKAN (tidak ada release/image/backup yang dihapus)"
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
say "CATATAN: Rilis ini membawa Akuisisi: periode tunggal, biaya iklan tingkat sumber (input manual), navigasi sumber, logo. Migrasi aditif: 2 tabel baru KOSONG. TIDAK ada biaya iklan yang diimpor/ditulis oleh rilis; tidak ada perubahan campaign/budget Meta, pembayaran, jurnal, stok, atau label customer. Rollback kode: jalankan scripts/rollback-guard-akuisisi-biaya.sh dulu (informasi), lalu langkah rollback di atas."
