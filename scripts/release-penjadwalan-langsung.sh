#!/usr/bin/env bash
# RILIS "PENJADWALAN LANGSUNG (Rencana Produksi) + TABEL PEMAKAIAN AKTUAL TERPADU": WEB + BACKEND, TANPA migrasi dan TANPA perubahan schema.prisma — RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   • Rencana Produksi: hari terpilih (bawaan hari ini) = tanggal jadwal; unit ditarik dari antrean LANGSUNG ke Meja 1–4 (atau "Pilih meja" untuk HP/keyboard) dan tersimpan sebagai jadwal Admin resmi TANPA modal tanggal/target/PIC/rencana bahan.
#     Satu antrean "Belum dijadwalkan" (siap + menunggu tiba, label "Belum tiba"); order beberapa unit bernomor; pilih beberapa unit + penempatan BERSAMA di satu meja (POST /production/rencana/jadwal-batch, semua-atau-tidak-sama-sekali, "AUTO" = meja pertama yang muat semuanya;
#     undo batch atomik). Kapasitas bersama dengan rencana Meja, kunci slot, idempotensi, revisi basi, dan Urungkan (hanya bila belum ada perubahan sesudahnya) tetap.
#   • Penjadwalan HANYA menulis jadwal + riwayat jadwal + log aktivitas (+ prioritas/target bila diubah lewat formulir lanjutan): tidak membuka Run/tahap/QC/penerimaan, tidak mencatat pemakaian bahan/stok/Material Issue/jurnal, tidak mengubah status unit (unit selesai/batal ditolak).
#   • Unit dengan Run LAMA di luar cohort kini boleh dijadwalkan Admin (gerbang tulis khusus jadwal: tanpa penanda drift V1 pada Run, Run/riwayat lama tidak disentuh); unit yang sudah terjadwal di rencana Meja ditolak (cegah jadwal ganda).
#   • Pemakaian aktual (drawer Order Produksi + tab Bahan): SATU tabel untuk Bahan Gudang / Bahan belum tercatat / Komponen lama dengan label dampak singkat dan Edit per baris (formulir yang sudah ada: pratinjau dampak, izin, alasan, harga, persetujuan); Riwayat/Rencana/Detail teknis tertutup; blok kosong dihapus.
#   • Gate: preflight; backup + RESTORE rehearsal (kode baru berjalan sebagai SERVER terhadap salinan restore; semua skenario — jadwal, batch, kapasitas, atomik, undo, Run lama, jadwal ganda, izin — ditulis HANYA ke DB sementara; direktori data/uploads production TIDAK dipasang);
#     build web di release dir; switch SATU kali; verifikasi; smoke baca-saja pasca-switch. Produksi: rilis ini TIDAK membuat jadwal/Run/stok/jurnal apa pun; tidak ada transaksi QA.
#
#   cat scripts/release-penjadwalan-langsung.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/pjl.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/pjl.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pjl.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rehearsal-only > /tmp/pjlr.out 2>&1 < /dev/null &'   # SEMUA gerbang sampai rehearsal pada restore nyata; TANPA switch
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pjl.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/pjl.out 2>&1 < /dev/null &'   # rilis penuh (hanya setelah persetujuan)
#
# ROLLBACK: kode aman di-rollback kapan pun (tanpa migrasi, tanpa tabel baru). Jadwal Admin yang dibuat lewat rilis ini tetap sah sebagai data biasa (tabel jadwal + riwayat tidak berubah bentuk); kode lama membacanya seperti jadwal Admin biasa.
# (dibangkitkan oleh scripts/gen-release-penjadwalan-langsung.cjs dari scripts/release-status-kerja-buka-pekerjaan.sh + scripts/templates/release-penjadwalan-langsung/*; JANGAN edit manual — ubah templat/generator lalu bangkitkan ulang)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/rencana-penjadwalan-langsung}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar (termasuk backend/prisma) = berhenti.
# Rilis kode-saja: tanpa migrasi, tanpa perubahan schema.prisma; OTA RN TIDAK diterbitkan.
ALLOWED_RE='^(backend/src/lib/domain/productionRencanaAdmin\.js|backend/src/routes/productionRencanaJadwal\.js|backend/src/services/productionRencanaJadwalService\.js|backend/tests/integration/rencanaPenjadwalanLangsung\.integration\.test\.js|backend/tests/releasePenjadwalanLangsung\.test\.js|backend/tests/rencanaPenjadwalanLangsung\.test\.js|frontend/src/api\.js|frontend/src/features/production/OrderProduksiPanel\.jsx|frontend/src/features/production/bahan/CatatBahanBaru\.jsx|frontend/src/features/production/bahan/PemakaianAktualBagian\.jsx|frontend/src/features/production/bahan/PemakaianSementaraDaftar\.jsx|frontend/src/features/production/bahan/TabelPemakaian\.jsx|frontend/src/features/production/bahan/bahanModel\.js|frontend/src/features/production/rencana/KartuUnit\.jsx|frontend/src/features/production/rencana/PilihMeja\.jsx|frontend/src/features/production/rencana/RencanaAntrean\.jsx|frontend/src/features/production/rencana/RencanaKalender\.jsx|frontend/src/features/production/rencana/rencanaModel\.js|frontend/src/pages/bengkel/ProductionRencanaMinggu\.jsx|frontend/tests/orderProduksiAdopsi\.test\.js|frontend/tests/perubahanPemakaian\.test\.js|frontend/tests/rencanaMinggu\.test\.js|frontend/tests/tabelPemakaianAktual\.test\.js|scripts/gen-release-penjadwalan-langsung\.cjs|scripts/lib/rehearsal-penjadwalan-langsung\.mjs|scripts/lib/smoke-penjadwalan-langsung\.mjs|scripts/release-penjadwalan-langsung\.sh|scripts/templates/release-penjadwalan-langsung/header\.txt|scripts/templates/release-penjadwalan-langsung/rollback\.txt)$'
BACKEND_SRC_EXPECT="backend/src/lib/domain/productionRencanaAdmin.js backend/src/routes/productionRencanaJadwal.js backend/src/services/productionRencanaJadwalService.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/production/OrderProduksiPanel.jsx frontend/src/features/production/bahan/CatatBahanBaru.jsx frontend/src/features/production/bahan/PemakaianAktualBagian.jsx frontend/src/features/production/bahan/PemakaianSementaraDaftar.jsx frontend/src/features/production/bahan/TabelPemakaian.jsx frontend/src/features/production/bahan/bahanModel.js frontend/src/features/production/rencana/KartuUnit.jsx frontend/src/features/production/rencana/PilihMeja.jsx frontend/src/features/production/rencana/RencanaAntrean.jsx frontend/src/features/production/rencana/RencanaKalender.jsx frontend/src/features/production/rencana/rencanaModel.js frontend/src/pages/bengkel/ProductionRencanaMinggu.jsx"
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
BK_DIR="$HOME/release-backups/penjadwalan-langsung-${DEPLOY_SHORT}-${TS}"
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
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Kode lama kembali ke jadwal lewat formulir Jadwalkan (tanpa seret ke Meja, Pilih meja, atau penempatan beberapa unit) dan ke tabel Pemakaian aktual lama; jadwal Admin yang sudah dibuat tetap valid (satu baris per unit + riwayat append-only) dan terbaca kode lama.
Unit dengan Run lama yang sudah dijadwalkan Admin: kode lama menampilkannya lagi di "Butuh keputusan" (tanpa mencabut jadwal); jadwal tidak dibalik otomatis. Pencabutan jadwal massal, bila diperlukan, adalah keputusan terpisah (tombol Keluarkan/Urungkan per unit).
Rilis ini tidak menyentuh Run, tahap, QC, penerimaan, pemakaian bahan, stok, Material Issue, jurnal, Koreksi Saldo, atau Harga Berlaku.
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

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-penjadwalan-langsung.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "pjl\|release-penjadwalan-langsung\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
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
BACKUP_FILE="$HOME/backups/pre-penjadwalan-langsung-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for s1 in "Pilih meja" "Pilih semua unit order ini" "Belum dijadwalkan" "Belum tiba" "Lepas di sini untuk menjadwalkan" "Riwayat dan dokumen pemakaian" "Tanpa pengeluaran stok" "Mengurangi stok" "Biaya belum diketahui" "Menunggu persetujuan" "Hari Minggu libur"; do [ -n "$(grep -lF -- "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Tambah pemakaian" "Ganti bahan" "Ajukan perubahan" "Lihat dampak" "Konfirmasi & kurangi stok" "Harga Berlaku (HPP operasional)" "Bahan belum tercatat" "Detail teknis" "Koreksi Dokumen" "Pengakuan Pendapatan" "Rekap per Unit" "Pembayaran dicatat di Finance › Penjualan Karyawan" "Mode rute Produksi" "Menunggu penentuan alur Produksi" "Konfirmasi kesiapan fisik" "Edit Data Customer" "Lengkapi Data Customer" "Riwayat Perubahan" "Customer & penerima" "Dijual oleh" "Buat Nota Kredit" "Nilai bersih" "Unit Produksi" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Katalog Item PKR" "Kirim sebagian" "Penjualan Karyawan" "Koreksi Order" "Tambah Pesanan Customer" "Gabungkan Order Duplikat" "Histori dari order lama" "Barang yang dibawa"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-pjl-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, pastikan TIDAK ADA migrasi pending dengan image baru, jalankan laporan terinci terhadap data restore, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_pjl_${TS}"
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
# UJI APLIKASI pada SALINAN RESTORE (kode BARU sebagai server, data produksi nyata, DB sementara): penjadwalan langsung (satu unit, beberapa unit bersama semua-atau-tidak-sama-sekali, AUTO, kapasitas, idempotensi, Urungkan tidak menimpa perubahan lain, unit dengan Run lama di luar cohort tanpa penanda drift, unit selesai ditolak, izin) pada salinan; Run/tahap/QC/penerimaan/stok/Material Issue/jurnal tidak berubah. DB dihapus di akhir.
mkdir -p "$BK_DIR/reh-data" "$BK_DIR/reh-uploads" "$BK_DIR/reh-dd"
REH_VOL=(-v "$BK_DIR/reh-data:/app/data" -v "$BK_DIR/reh-uploads:/app/uploads" -v "$BK_DIR/reh-dd:/frontend/dist-driver")
[ "$(dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" backend sh -c 'find /app/data /app/uploads /frontend/dist-driver -mindepth 1 | wc -l' </dev/null | tr -d '[:space:]')" = "0" ] || { reh_drop; die "rehearsal TIDAK terisolasi dari direktori data/uploads production (mount tidak tertimpa) — berhenti"; }
ok "rehearsal terisolasi: direktori data/uploads/dist-driver production TIDAK dipasang (diganti direktori sementara kosong)"
dcp "$NEW_DIR" run --rm --no-deps -T "${REH_VOL[@]}" -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend node --input-type=module - <<'REHNODE' > "$BK_DIR/rehearsal-koreksi.log" 2>&1 || { cat "$BK_DIR/rehearsal-koreksi.log"; reh_drop; die "uji penjadwalan langsung terhadap salinan restore GAGAL (lihat rehearsal-koreksi.log)"; }
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
const SMOKE_SRC = "import { createRequire } from \"node:module\";\nimport { pathToFileURL } from \"node:url\";\nimport path from \"node:path\";\nconst require = createRequire(process.cwd() + \"/\");\nconst jwt = require(\"jsonwebtoken\");\nconst { PrismaClient } = require(\"@prisma/client\");\nconst prisma = new PrismaClient();\nconst BASE = process.env.SMOKE_BASE ?? \"http://127.0.0.1:4000\"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)\nconst APP = process.env.APP_DIR ?? \"/app\";\nlet fail = 0; let dilewati = 0;\nconst rec = (n, ok, d = \"\") => { if (!ok) fail++; console.log(`  ${ok ? \"PASS\" : \"FAIL\"}  ${n}${d ? \" — \" + d : \"\"}`); };\nconst skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };\n// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang diuji hanya bacaan jadwal bentuk baru dan PENOLAKAN sebelum menyentuh data (tanpa token, tanpa izin, kunci/bentuk/jumlah/tanggal tidak sah, unit tidak ada).\n// Jejak tulis (jadwal, riwayat jadwal, Run, tahap, stok, Material Issue, jurnal, aktivitas) harus identik sebelum vs sesudah.\nconst { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, \"src/constants/permissions.js\")).href);\nconst rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);\nconst bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));\nconst tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: \"10m\" });\nconst hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);\nconst B = (k) => Number(process.env[k]);\nconst post = async (p, token, body = {}, hdr = {}) => { const r = await fetch(BASE + p, { method: \"POST\", headers: { \"Content-Type\": \"application/json\", ...(token ? { Authorization: \"Bearer \" + token } : {}), ...hdr }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };\nconst get = async (p, token) => { const r = await fetch(BASE + p, { headers: token ? { Authorization: \"Bearer \" + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };\nconst users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: \"asc\" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });\nconst penjadwal = info.find((x) => bisa(x.rs, P.UNIT_ROUTING_WRITE))?.u; const hanyaLihat = info.find((x) => !bisa(x.rs, P.UNIT_ROUTING_WRITE) && bisa(x.rs, P.UNIT_READ))?.u;\nif (!penjadwal) { rec(\"akun penjadwal (unit:routing_write) tersedia\", false); process.exit(1); }\nconst tW = await tokenUntuk(penjadwal); const tL = hanyaLihat ? await tokenUntuk(hanyaLihat) : null;\nconst jejak = async () => ({\n  jadwal: await hitung(\"select count(*)::int n from production_unit_schedules\"), riwayat: await hitung(\"select count(*)::int n from production_unit_schedule_events\"), run: await hitung(\"select count(*)::int n from production_runs_v2\"),\n  tahap: await hitung(\"select count(*)::int n from unit_stage_logs\"), mov: await hitung(\"select count(*)::int n from stock_movements\"), mi: await hitung(\"select count(*)::int n from material_issues\"), jur: await hitung(\"select count(*)::int n from fin_journal_entries\"),\n  akt: await hitung(\"select count(*)::int n from activity_events where event_type = 'PRODUCTION_ADMIN_SCHEDULE_SET'\"), plan: await hitung(\"select count(*)::int n from production_run_plans_v2\"),\n});\nconst s0 = await jejak();\nconst hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);\nconst PRD = \"/api/production\";\n\n// ── bacaan bentuk baru\nconst mg = await get(`${PRD}/rencana/minggu?start=${hariIni}`, tW); rec(\"kalender minggu 200: 7 hari, kapasitas per meja, izin jadwalkan\", mg.status === 200 && mg.json?.days?.length === 7 && mg.json?.days?.every((d) => d.stations?.length === 4) && mg.json?.izin?.jadwalkan === true, `${mg.status}`);\nconst hr = await get(`${PRD}/rencana/hari?date=${hariIni}`, tW); rec(\"rincian hari 200: empat meja + tanpaMeja\", hr.status === 200 && hr.json?.stations?.length === 4 && Array.isArray(hr.json?.tanpaMeja), `${hr.status}`);\nconst bl = await get(`${PRD}/rencana/antrean?tab=BELUM&pageSize=50`, tW); const c = bl.json?.counts ?? {};\nrec(`antrean satu daftar (BELUM) 200: BELUM = SIAP + MENUNGGU_TIBA (${c.BELUM} = ${c.SIAP} + ${c.MENUNGGU_TIBA})`, bl.status === 200 && c.BELUM === c.SIAP + c.MENUNGGU_TIBA, `${bl.status}`);\nrec(\"kartu antrean memuat jumlahUnitOrder/unitKe/saudaraSiap/jalur/revisiJadwal/unitCas\", (bl.json?.items ?? []).length === 0 || (bl.json.items.every((i) => Number.isInteger(i.jumlahUnitOrder) && Number.isInteger(i.unitKe) && Array.isArray(i.saudaraSiap) && [\"ADMIN\", \"V2\"].includes(i.jalur) && \"unitCas\" in i && Number.isInteger(i.revisiJadwal))));\nfor (const tab of [\"TERJADWAL\", \"KEPUTUSAN\", \"SIAP\", \"MENUNGGU_TIBA\"]) { const r = await get(`${PRD}/rencana/antrean?tab=${tab}&pageSize=5`, tW); rec(`antrean ${tab} 200`, r.status === 200 && Array.isArray(r.json?.items), `${r.status}`); }\nconst kep = await get(`${PRD}/rencana/antrean?tab=KEPUTUSAN&pageSize=100`, tW); rec(\"Butuh keputusan tidak memuat hambatan 'Run lama di luar cohort'\", (kep.json?.items ?? []).every((i) => !/di luar cohort/i.test(i.alasan ?? \"\")));\nif (tL) { const r = await get(`${PRD}/rencana/minggu?start=${hariIni}`, tL); rec(\"akun hanya-lihat: kalender 200 dengan izin.jadwalkan=false\", r.status === 200 && r.json?.izin?.jadwalkan === false, `${r.status}`); } else skip(\"akun hanya-lihat membaca kalender\", \"tidak ada akun hanya-lihat aktif (diuji di rehearsal)\");\n\n// ── penolakan SEBELUM menulis\nconst unitAda = (await prisma.$queryRawUnsafe(\"select id::text id from units order by created_at desc limit 1\"))[0]?.id ?? \"00000000-0000-4000-8000-000000000001\";\nconst uBatch = (d, extra = {}) => ({ productionDate: d, stationCode: \"TABLE_1\", units: [{ unitId: unitAda, expectedRevision: 0 }], ...extra });\nconst kS = \"smoke-pjl-tidak-menulis-0001\";\nrec(\"jadwal-batch tanpa token = 401\", (await post(`${PRD}/rencana/jadwal-batch`, null, uBatch(hariIni), { \"Idempotency-Key\": kS })).status === 401);\nrec(\"jadwal-batch/undo tanpa token = 401\", (await post(`${PRD}/rencana/jadwal-batch/undo`, null, { items: [{ unitId: unitAda, eventId: \"x\" }] }, { \"Idempotency-Key\": kS })).status === 401);\nif (tL) { rec(\"jadwal-batch akun hanya-lihat = 403 (tidak menulis)\", (await post(`${PRD}/rencana/jadwal-batch`, tL, uBatch(hariIni), { \"Idempotency-Key\": kS })).status === 403); rec(\"jadwal-batch/undo akun hanya-lihat = 403\", (await post(`${PRD}/rencana/jadwal-batch/undo`, tL, { items: [{ unitId: unitAda, eventId: \"x\" }] }, { \"Idempotency-Key\": kS })).status === 403); } else skip(\"akun hanya-lihat 403 pada jadwal-batch\", \"tidak ada akun hanya-lihat aktif (diuji di rehearsal)\");\nrec(\"jadwal-batch tanpa Idempotency-Key = 400 (tidak menulis)\", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni))).status === 400);\nrec(\"jadwal-batch daftar unit kosong = 400; lebih dari 20 unit = 400\", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: [] }), { \"Idempotency-Key\": kS })).status === 400 && (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: Array.from({ length: 21 }, (_, i) => ({ unitId: `00000000-0000-4000-8000-${String(i).padStart(12, \"0\")}`, expectedRevision: 0 })) }), { \"Idempotency-Key\": kS })).status === 400);\nconst kemarin = new Date(Date.now() + 7 * 3600_000 - 86400_000).toISOString().slice(0, 10);\nrec(\"jadwal-batch tanggal lewat = 422 JADWAL_TANGGAL_LEWAT (tidak menulis)\", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(kemarin), { \"Idempotency-Key\": kS })).json?.code === \"JADWAL_TANGGAL_LEWAT\");\nlet minggu = new Date(Date.now() + 7 * 3600_000 + 86400_000).toISOString().slice(0, 10); while (new Date(`${minggu}T00:00:00Z`).getUTCDay() !== 0) minggu = new Date(new Date(`${minggu}T00:00:00Z`).getTime() + 86400_000).toISOString().slice(0, 10);\nrec(\"jadwal-batch hari Minggu = 422 JADWAL_HARI_LIBUR (tidak menulis)\", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(minggu), { \"Idempotency-Key\": kS })).json?.code === \"JADWAL_HARI_LIBUR\");\nrec(\"jadwal-batch meja tidak dikenal = 400 JADWAL_MEJA_INVALID (tidak menulis)\", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { stationCode: \"TABLE_9\" }), { \"Idempotency-Key\": kS })).json?.code === \"JADWAL_MEJA_INVALID\");\nrec(\"jadwal-batch unit tidak ada = 404 (tidak menulis)\", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: [{ unitId: \"00000000-0000-4000-8000-0000000000ff\", expectedRevision: 0 }] }), { \"Idempotency-Key\": kS })).status === 404);\nrec(\"jadwal-batch daftar ganda = 400 (tidak menulis)\", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: [{ unitId: unitAda, expectedRevision: 0 }, { unitId: unitAda, expectedRevision: 0 }] }), { \"Idempotency-Key\": kS })).status === 400);\n\nconst s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]);\nrec(\"TIDAK ada jejak tulis: jadwal, riwayat jadwal, Run, tahap, stok, Material Issue, jurnal, aktivitas jadwal, rencana Meja sama persis sebelum vs sesudah smoke\", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(\",\") || \"identik\");\nrec(\"jurnal tidak seimbang (sebelum rilis: \" + B(\"BASE_TIDAK_SEIMBANG\") + \", tidak bertambah)\", (await hitung(\"select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x\")) <= B(\"BASE_TIDAK_SEIMBANG\"));\nrec(\"jumlah Order & Job tidak berkurang (sebelum: \" + B(\"ORDER_N\") + \" / \" + B(\"JOB_N\") + \")\", (await hitung('select count(*)::int n from \"Order\"')) >= B(\"ORDER_N\") && (await hitung(\"select count(*)::int n from jobs\")) >= B(\"JOB_N\"));\nawait prisma.$disconnect();\nconsole.log(\"\\nRINGKASAN smoke: \" + fail + \" gagal, \" + dilewati + \" dilewati (SKIP)\");\nconsole.log(\"SMOKE_HASIL fail=\" + fail + \" skip=\" + dilewati);\nprocess.exit(fail ? 1 : 0);\n"; // diganti generator dengan isi smoke-penjadwalan-langsung.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji penjadwalan langsung hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Penjadwalan langsung": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Semua tulisan hanya di DB sementara ini: data uji sintetis (order/unit/Run) dibuat di DB ini; unit nyata hanya dijadwalkan lalu diurungkan pada salinan.
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
let adm = info.find((x) => bisa(x.rs, P.UNIT_ROUTING_WRITE))?.u; let lihat = info.find((x) => !bisa(x.rs, P.UNIT_ROUTING_WRITE) && bisa(x.rs, P.UNIT_READ))?.u;
if (!adm) adm = await prisma.user.create({ data: { name: "REH Admin", email: `reh-adm-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
if (!lihat) lihat = await prisma.user.create({ data: { name: "REH Sales", email: `reh-sls-${Date.now()}@example.test`, passwordHash: "x", role: "SALES" } });
cek("akun uji tersedia: penjadwal (UNIT_ROUTING_WRITE) dan akun hanya-lihat", !!adm && !!lihat && adm.id !== lihat.id);
const tA = await token(adm); const tS = await token(lihat);
const H = async (metode, p, tok, body = null, kunci = null) => { const r = await fetch(BASE + p, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kunci ? { "Idempotency-Key": kunci } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
let seq = 0; const kunci = (p) => `reh-pjl-${p}-${Date.now().toString(36)}-${++seq}-xxxxxxxx`;
const PRD = "/api/production"; const HARI = 86400_000;
const dkey = (d) => new Date(d).toISOString().slice(0, 10); const wibHariIni = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const tambahHari = (k, nHari) => dkey(new Date(`${k}T00:00:00Z`).getTime() + nHari * HARI); const dow = (k) => new Date(`${k}T00:00:00Z`).getUTCDay();

// ── A. Bacaan bentuk baru pada data produksi nyata (salinan): kalender, hari, antrean satu daftar
const hariIni = wibHariIni();
const mg = await H("GET", `${PRD}/rencana/minggu?start=${hariIni}`, tA); const hr = await H("GET", `${PRD}/rencana/hari?date=${hariIni}`, tA);
const bl = await H("GET", `${PRD}/rencana/antrean?tab=BELUM&pageSize=100`, tA); const sp = await H("GET", `${PRD}/rencana/antrean?tab=SIAP&pageSize=5`, tA); const mt = await H("GET", `${PRD}/rencana/antrean?tab=MENUNGGU_TIBA&pageSize=5`, tA);
cek("bacaan: minggu 7 hari, rincian hari, antrean BELUM/SIAP/MENUNGGU_TIBA 200 pada data nyata", mg.status === 200 && mg.body?.days?.length === 7 && hr.status === 200 && bl.status === 200 && sp.status === 200 && mt.status === 200, `${mg.status}/${hr.status}/${bl.status}/${sp.status}/${mt.status}`);
cek(`satu antrean: BELUM = SIAP + MENUNGGU_TIBA (${bl.body?.counts?.BELUM} = ${bl.body?.counts?.SIAP} + ${bl.body?.counts?.MENUNGGU_TIBA}); setiap kartu membawa jumlahUnitOrder/unitKe/saudaraSiap`, bl.body?.counts?.BELUM === bl.body?.counts?.SIAP + bl.body?.counts?.MENUNGGU_TIBA && (bl.body?.items ?? []).every((i) => Number.isInteger(i.jumlahUnitOrder) && i.jumlahUnitOrder >= 1 && i.unitKe >= 1 && Array.isArray(i.saudaraSiap)));
cek("antrean nyata: tidak ada unit dengan hambatan RUN_OUTSIDE_COHORT di 'Butuh keputusan'", !((await H("GET", `${PRD}/rencana/antrean?tab=KEPUTUSAN&pageSize=100`, tA)).body?.items ?? []).some((i) => /di luar cohort/i.test(i.alasan ?? "")));

// ── B. data uji sintetis pada DB sementara + hari kosong
const wh = await prisma.warehouse.create({ data: { code: `WH-REH-${Date.now().toString(36)}`, name: "Gudang REH" } });
const rcv = await prisma.storageLocation.create({ data: { warehouseId: wh.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-REH-${Date.now().toString(36)}` } });
let ns = 0;
async function mkOrder(jumlah = 1, { orderStatus = "PROCESSING", unitStatus = "RECEIVED", received = true } = {}) {
  const customer = await prisma.customer.create({ data: { name: `Pelanggan REH ${++ns}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await prisma.order.create({ data: { customerId: customer.id, orderNumber: `RES-REH-${Date.now().toString(36)}-${++ns}`, value: 1_000_000 * jumlah, category: "LAYANAN", status: orderStatus, pickupConfirmedDate: new Date(), items: { create: [{ layananName: "Service Fondasi", harga: 1_000_000, sortOrder: 1 }] } } });
  const units = [];
  for (let i = 1; i <= jumlah; i += 1) {
    const unit = await prisma.unit.create({ data: { unitCode: `${order.orderNumber}-U${i}`, orderId: order.id, seq: i, status: unitStatus, merk: "King Koil", ukuran: "160x200" } });
    const job = await prisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } }); await prisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
    if (received) await prisma.unitWorkshopReceipt.create({ data: { unitId: unit.id, seq: i, locationId: rcv.id, receivedById: adm.id } });
    units.push(unit);
  }
  return units;
}
// hari kerja yang KOSONG di salinan (tidak mengganggu rencana nyata): cari mulai 2 minggu ke depan
let H1 = null; for (let d = 14; d < 120 && !H1; d += 1) { const k = tambahHari(hariIni, d); if (dow(k) === 0) continue; const hh = await H("GET", `${PRD}/rencana/hari?date=${k}`, tA); if (hh.status === 200 && hh.body.stations.every((s) => s.items.length === 0) && hh.body.tanpaMeja.length === 0) H1 = k; }
let H2 = H1 ? tambahHari(H1, 1) : null; if (H2 && dow(H2) === 0) H2 = tambahHari(H2, 1);
cek(`hari kerja kosong ditemukan di salinan untuk uji (H1=${H1}, H2=${H2})`, !!H1 && !!H2);
if (!H1) { berhenti(); await prisma.$disconnect(); process.exit(1); }
const jejak = async () => ({ run: await prisma.productionRun.count(), op: await prisma.productionOperationRun.count(), tahap: await prisma.unitStageLog.count(), qc: await prisma.qualityInspection.count(), mov: await prisma.stockMovement.count(), mi: await prisma.materialIssue.count(), jur: await prisma.finJournalEntry.count(), rcp: await prisma.unitWorkshopReceipt.count(), plan: await prisma.productionRunPlan.count(), out: await prisma.domainOutbox.count(), msg: await prisma.message.count().catch(() => -1) });
const sama = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const batch = (tok, units, body = {}, k = kunci("jb")) => H("POST", `${PRD}/rencana/jadwal-batch`, tok, { productionDate: H1, stationCode: "TABLE_2", units: units.map((u) => ({ unitId: u.id, expectedRevision: 0 })), ...body }, k);
const jdw = (tok, u, body = {}, k = kunci("j1")) => H("POST", `${PRD}/units/${u.id}/jadwal`, tok, { productionDate: H1, stationCode: "TABLE_1", expectedRevision: 0, ...body }, k);

// ── C. satu unit: jadwal Admin resmi; tidak menyentuh tabel operasional
const [u1] = await mkOrder(1); const J0 = await jejak();
const r1 = await jdw(tA, u1); const J1 = await jejak();
cek("satu unit dijadwalkan (201, revisi 1); TIDAK ada Run/tahap/QC/penerimaan/stok/Material Issue/jurnal/rencana Meja/outbox baru", r1.status === 201 && r1.body?.revision === 1 && sama(J0, J1), `${r1.status} ${JSON.stringify(r1.body).slice(0, 100)}`);
const st1 = (await prisma.unit.findUniqueOrThrow({ where: { id: u1.id } })).status;
cek("status unit tidak berubah karena penjadwalan (RECEIVED tetap)", st1 === "RECEIVED", st1);
const ev1 = await prisma.activityEvent.count({ where: { entityId: u1.id, eventType: "PRODUCTION_ADMIN_SCHEDULE_SET" } }); const sch1 = await prisma.productionUnitSchedule.findUnique({ where: { unitId: u1.id } });
cek("jadwal tersimpan satu baris per unit + riwayat jadwal + log aktivitas (Riwayat unit)", sch1?.status === "ACTIVE" && dkey(sch1.productionDate) === H1 && sch1.stationCode === "TABLE_1" && ev1 === 1 && (await prisma.productionUnitScheduleEvent.count({ where: { unitId: u1.id } })) === 1);
const ad1 = await H("GET", `${PRD}/units/${u1.id}/adopsi`, tA); const wo = await H("GET", `${PRD}/work-orders?statusKerja=DIJADWALKAN&pageSize=100`, tA);
cek("status kerja 'Dijadwalkan' (drawer/Ringkasan) dan daftar+filter DIJADWALKAN memuat unit itu; bukan 'Sudah dikerjakan'", ad1.body?.adopsi?.kerja?.key === "DIJADWALKAN" && (wo.body?.units ?? []).some((x) => x.id === u1.id));
const kal = (await H("GET", `${PRD}/rencana/hari?date=${H1}`, tA)).body; const m1 = (await H("GET", `${PRD}/rencana/minggu?start=${H1}`, tA)).body.days.find((d) => d.date === H1);
cek("kalender hari + kapasitas minggu memuat jadwal itu (sumber data yang sama)", kal.stations.find((s) => s.code === "TABLE_1").items.some((x) => x.unitId === u1.id) && m1.terencana === 1 && m1.stations.find((s) => s.code === "TABLE_1").count === 1);
const un = await H("POST", `${PRD}/units/${u1.id}/jadwal/undo`, tA, { eventId: r1.body.eventId }, kunci("u1"));
cek("Urungkan satu unit: jadwal kembali kosong (CLEARED)", un.status === 201 && (await prisma.productionUnitSchedule.findUnique({ where: { unitId: u1.id } })).status === "CLEARED");

// ── D. beberapa unit: penempatan BERSAMA, semua-atau-tidak-sama-sekali, AUTO, idempoten
const tiga = await mkOrder(3); const kB = kunci("bt"); const b1 = await batch(tA, tiga, { stationCode: "TABLE_2" }, kB);
const baris = await prisma.productionUnitSchedule.findMany({ where: { unitId: { in: tiga.map((u) => u.id) }, status: "ACTIVE" } });
cek("batch 3 unit satu order → SATU meja (Meja 2) pada hari yang sama (201); hanya jadwal ditulis", b1.status === 201 && baris.length === 3 && baris.every((x) => x.stationCode === "TABLE_2" && dkey(x.productionDate) === H1), JSON.stringify(b1.body).slice(0, 120));
const bUlang = await batch(tA, tiga, { stationCode: "TABLE_2" }, kB); const bBeda = await batch(tA, tiga, { stationCode: "TABLE_3" }, kB);
cek("Idempotency-Key sama = hasil semula (200, replayed, tanpa baris baru); kunci sama untuk meja berbeda ditolak 409", bUlang.status === 200 && bUlang.body?.replayed === true && (await prisma.productionUnitSchedule.count({ where: { unitId: { in: tiga.map((u) => u.id) } } })) === 3 && bBeda.status === 409);
const dua = await mkOrder(2); const penuh = await batch(tA, dua, { stationCode: "TABLE_2" });
cek("kapasitas Meja 2 habis (3/3): 2 unit baru DITOLAK seluruhnya (409 PLAN_STATION_FULL) dengan penjelasan; tidak setengah tersimpan", penuh.status === 409 && penuh.body?.code === "PLAN_STATION_FULL" && /Tidak ada yang disimpan/.test(penuh.body?.error ?? "") && (await prisma.productionUnitSchedule.count({ where: { unitId: { in: dua.map((u) => u.id) } } })) === 0, penuh.body?.error);
const auto = await batch(tA, dua, { stationCode: "AUTO" }); cek("AUTO memilih meja pertama yang muat semua unit (Meja 1, kosong)", auto.status === 201 && auto.body?.stationCode === "TABLE_1", `${auto.status} ${auto.body?.stationCode}`);

// ── E. atomik: satu unit ditolak (selesai) / revisi basi → seluruh batch batal; unit selesai tidak berubah status
const e0 = await mkOrder(2); const [selesai] = await mkOrder(1, { unitStatus: "READY_FOR_DELIVERY" }); const cntE = await prisma.productionUnitSchedule.count();
const bs = await batch(tA, [e0[0], selesai], { productionDate: H2, stationCode: "TABLE_3" });
cek("batch dengan satu unit SELESAI ditolak 422 UNIT_FINISHED; unit lain TIDAK tersimpan; status unit selesai tidak mundur", bs.status === 422 && bs.body?.code === "JADWAL_UNIT_FINISHED" && (await prisma.productionUnitSchedule.count()) === cntE && (await prisma.unit.findUniqueOrThrow({ where: { id: selesai.id } })).status === "READY_FOR_DELIVERY", `${bs.status} ${bs.body?.code}`);
await jdw(tA, e0[1], { productionDate: H2, stationCode: "TABLE_4" }); const cntF = await prisma.productionUnitSchedule.count();
const basi = await batch(tA, e0, { productionDate: H2, stationCode: "TABLE_3" });
cek("batch dengan revisi basi (unit diubah orang lain) ditolak 409 JADWAL_REVISI_BASI dan menyebut unit penyebab; unit lain tidak tersimpan", basi.status === 409 && basi.body?.code === "JADWAL_REVISI_BASI" && (basi.body?.error ?? "").includes(e0[1].unitCode) && (await prisma.productionUnitSchedule.count()) === cntF, basi.body?.error);

// ── F. Urungkan batch: tidak menimpa perubahan orang lain; atomik
const items = b1.body.hasil.map((h) => ({ unitId: h.unitId, eventId: h.eventId }));
await jdw(tA, tiga[1], { productionDate: H2, stationCode: "TABLE_4", expectedRevision: 1 }); // orang lain memindahkan unit ke-2
const ug = await H("POST", `${PRD}/rencana/jadwal-batch/undo`, tA, { items }, kunci("ub"));
const sisa = await prisma.productionUnitSchedule.findMany({ where: { unitId: { in: tiga.map((u) => u.id) }, status: "ACTIVE" } });
cek("Urungkan batch ditolak 409 JADWAL_UNDO_TIDAK_BISA karena satu unit sudah diubah; SEMUA tetap (perubahan orang lain tidak ditimpa)", ug.status === 409 && ug.body?.code === "JADWAL_UNDO_TIDAK_BISA" && sisa.length === 3 && sisa.filter((x) => x.stationCode === "TABLE_2").length === 2 && sisa.some((x) => x.stationCode === "TABLE_4"), ug.body?.error);
const dua2 = await mkOrder(2); const bb = await batch(tA, dua2, { productionDate: H2, stationCode: "TABLE_1" }); const ug2 = await H("POST", `${PRD}/rencana/jadwal-batch/undo`, tA, { items: bb.body.hasil.map((h) => ({ unitId: h.unitId, eventId: h.eventId })) }, kunci("ub2"));
cek("Urungkan batch tanpa campur tangan: seluruhnya kembali belum dijadwalkan", ug2.status === 201 && (await prisma.productionUnitSchedule.count({ where: { unitId: { in: dua2.map((u) => u.id) }, status: "ACTIVE" } })) === 0);

// ── G. Run LAMA di luar cohort: bisa dijadwalkan tanpa menyentuh Run/riwayat lama dan tanpa penanda drift V1
const [lama] = await mkOrder(1); const run = await prisma.productionRun.create({ data: { unitId: lama.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS" } });
const runAwal = JSON.stringify(await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })); const jL0 = await jejak(); const rl = await jdw(tA, lama, { productionDate: H2, stationCode: "TABLE_2" });
const drift = await prisma.activityEvent.count({ where: { entityId: lama.id, eventType: "PRODUCTION_V1_WRITE_ON_V2_RUN" } }); const jL1 = await jejak();
cek(`unit dengan Run lama aktif: ${rl.status === 201 ? "dijadwalkan (201)" : "ditolak karena dimiliki V2 (409 UNIT_V2_OWNED) — writer V2 aktif untuk semua unit di salinan"}; Run tidak berubah; TANPA penanda drift V1; tabel operasional sama`, ((rl.status === 201) || (rl.status === 409 && rl.body?.code === "UNIT_V2_OWNED")) && JSON.stringify(await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })) === runAwal && drift === 0 && sama(jL0, jL1), `${rl.status} ${rl.body?.code ?? ""} drift=${drift}`);

// ── H. unit yang sudah punya jadwal bertanggal di rencana Meja tidak mendapat jadwal Admin kedua
const [dobel] = await mkOrder(1); const runD = await prisma.productionRun.create({ data: { unitId: dobel.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS" } });
await prisma.productionRunPlan.create({ data: { runId: runD.id, status: "PLANNED", productionDate: new Date(`${H2}T00:00:00.000Z`), stationCode: "TABLE_4" } });
const rd = await jdw(tA, dobel, { productionDate: H2, stationCode: "TABLE_2" });
cek("unit yang sudah terjadwal di rencana Meja: jadwal Admin kedua ditolak (409 JADWAL_SUDAH_DI_RENCANA_MEJA atau UNIT_V2_OWNED); tidak ada baris jadwal Admin", rd.status === 409 && ["JADWAL_SUDAH_DI_RENCANA_MEJA", "UNIT_V2_OWNED"].includes(rd.body?.code) && (await prisma.productionUnitSchedule.count({ where: { unitId: dobel.id } })) === 0, `${rd.status} ${rd.body?.code}`);

// ── I. izin dan penegakan sebelum menulis
const cntI = await prisma.productionUnitSchedule.count(); const [ui] = await mkOrder(1);
const i401 = await batch(null, [ui]); const i403 = await batch(tS, [ui]); const i403u = await H("POST", `${PRD}/rencana/jadwal-batch/undo`, tS, { items: [{ unitId: ui.id, eventId: "x" }] }, kunci("us"));
const iKunci = await H("POST", `${PRD}/rencana/jadwal-batch`, tA, { productionDate: H1, stationCode: "TABLE_1", units: [{ unitId: ui.id, expectedRevision: 0 }] });
const iBanyak = await H("POST", `${PRD}/rencana/jadwal-batch`, tA, { productionDate: H1, stationCode: "TABLE_1", units: Array.from({ length: 21 }, (_, i) => ({ unitId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, expectedRevision: 0 })) }, kunci("by"));
const iLewat = await batch(tA, [ui], { productionDate: tambahHari(hariIni, -1) }); let mg0 = tambahHari(hariIni, 1); while (dow(mg0) !== 0) mg0 = tambahHari(mg0, 1); const iMinggu = await batch(tA, [ui], { productionDate: mg0 });
cek("izin & penegakan: tanpa token 401; hanya-lihat 403 (batch dan undo batch); tanpa kunci 400; >20 unit 400; tanggal lewat/Minggu 422 — tidak ada tulisan", i401.status === 401 && i403.status === 403 && i403u.status === 403 && iKunci.status === 400 && iBanyak.status === 400 && iLewat.status === 422 && iMinggu.status === 422 && (await prisma.productionUnitSchedule.count()) === cntI, [i401, i403, i403u, iKunci, iBanyak, iLewat, iMinggu].map((x) => x.status).join("/"));

// ── J. unit NYATA dari salinan: jadwal + urungkan (bentuk data produksi sebenarnya)
const nyata = (await H("GET", `${PRD}/rencana/antrean?tab=BELUM&pageSize=100`, tA)).body?.items?.find((i) => i.boleh && i.jalur === "ADMIN" && !String(i.unitCode).includes("REH"));
if (nyata) {
  const jN0 = await jejak(); const rN = await H("POST", `${PRD}/units/${nyata.unitId}/jadwal`, tA, { productionDate: H2, stationCode: "TABLE_3", expectedRevision: nyata.revisiJadwal ?? 0, expectedUnit: nyata.unitCas }, kunci("nyata"));
  const uN = rN.status === 201 ? await H("POST", `${PRD}/units/${nyata.unitId}/jadwal/undo`, tA, { eventId: rN.body.eventId }, kunci("nyataU")) : null;
  cek(`unit NYATA di salinan (${nyata.unitCode}, ${nyata.diterima ? "di workshop" : "belum tiba"}): dijadwalkan lalu diurungkan; tabel operasional tidak berubah`, rN.status === 201 && uN?.status === 201 && sama(jN0, await jejak()), `${rN.status}/${uN?.status} ${rN.body?.code ?? ""}`);
} else cek("unit nyata siap dijadwalkan tersedia di salinan (dilewati: tidak ada unit nyata yang boleh dijadwalkan)", true, "dilewati");

// ── K. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_GANDA: "0", ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
REHNODE
ok "uji aplikasi pada SALINAN RESTORE: $(grep -c '^OK' "$BK_DIR/rehearsal-koreksi.log") pemeriksaan lulus ($(grep -c '^SKIP' "$BK_DIR/rehearsal-koreksi.log") dilewati, alasan tercatat); $(tail -n 1 "$BK_DIR/rehearsal-koreksi.log")"
reh_drop
# direktori sementara dibuat root oleh kontainer: dihapus lewat kontainer (rm biasa ditolak); kegagalan pembersihan tidak menggagalkan rilis
dcp "$NEW_DIR" run --rm --no-deps -T -v "$BK_DIR:/bk" backend sh -c 'rm -rf /bk/reh-data /bk/reh-uploads /bk/reh-dd' </dev/null >/dev/null 2>&1 || true
ok "rehearsal lulus: isi ${FP_N} tabel IDENTIK sebelum vs sesudah migrate status; uji tulis Edit pemakaian dilakukan HANYA pada salinan restore lalu DB sementara dihapus"
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
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan di produksi; JANGAN switch"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi (image baru) TIDAK 'up to date' — rilis ini harus tanpa migrasi"
ok "tidak ada migrasi pending; skema produksi sudah sesuai image baru"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pra-switch.txt" || die "sidik jari dokumen beku pra-switch gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-switch.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pra-switch.txt" || true; die "dokumen pembanding beku BERUBAH sebelum switch"; }
ok "pra-switch: dokumen pembanding beku identik"

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
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test baca-saja: kalender/hari/antrean (bentuk baru), izin (401/403) pada jadwal dan jadwal-batch, penolakan POST sebelum menulis (kunci/jumlah/bentuk), tanpa jejak tulis pada jadwal/Run/stok"
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
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang diuji hanya bacaan jadwal bentuk baru dan PENOLAKAN sebelum menyentuh data (tanpa token, tanpa izin, kunci/bentuk/jumlah/tanggal tidak sah, unit tidak ada).
// Jejak tulis (jadwal, riwayat jadwal, Run, tahap, stok, Material Issue, jurnal, aktivitas) harus identik sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const post = async (p, token, body = {}, hdr = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...hdr }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const get = async (p, token) => { const r = await fetch(BASE + p, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const penjadwal = info.find((x) => bisa(x.rs, P.UNIT_ROUTING_WRITE))?.u; const hanyaLihat = info.find((x) => !bisa(x.rs, P.UNIT_ROUTING_WRITE) && bisa(x.rs, P.UNIT_READ))?.u;
if (!penjadwal) { rec("akun penjadwal (unit:routing_write) tersedia", false); process.exit(1); }
const tW = await tokenUntuk(penjadwal); const tL = hanyaLihat ? await tokenUntuk(hanyaLihat) : null;
const jejak = async () => ({
  jadwal: await hitung("select count(*)::int n from production_unit_schedules"), riwayat: await hitung("select count(*)::int n from production_unit_schedule_events"), run: await hitung("select count(*)::int n from production_runs_v2"),
  tahap: await hitung("select count(*)::int n from unit_stage_logs"), mov: await hitung("select count(*)::int n from stock_movements"), mi: await hitung("select count(*)::int n from material_issues"), jur: await hitung("select count(*)::int n from fin_journal_entries"),
  akt: await hitung("select count(*)::int n from activity_events where event_type = 'PRODUCTION_ADMIN_SCHEDULE_SET'"), plan: await hitung("select count(*)::int n from production_run_plans_v2"),
});
const s0 = await jejak();
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const PRD = "/api/production";

// ── bacaan bentuk baru
const mg = await get(`${PRD}/rencana/minggu?start=${hariIni}`, tW); rec("kalender minggu 200: 7 hari, kapasitas per meja, izin jadwalkan", mg.status === 200 && mg.json?.days?.length === 7 && mg.json?.days?.every((d) => d.stations?.length === 4) && mg.json?.izin?.jadwalkan === true, `${mg.status}`);
const hr = await get(`${PRD}/rencana/hari?date=${hariIni}`, tW); rec("rincian hari 200: empat meja + tanpaMeja", hr.status === 200 && hr.json?.stations?.length === 4 && Array.isArray(hr.json?.tanpaMeja), `${hr.status}`);
const bl = await get(`${PRD}/rencana/antrean?tab=BELUM&pageSize=50`, tW); const c = bl.json?.counts ?? {};
rec(`antrean satu daftar (BELUM) 200: BELUM = SIAP + MENUNGGU_TIBA (${c.BELUM} = ${c.SIAP} + ${c.MENUNGGU_TIBA})`, bl.status === 200 && c.BELUM === c.SIAP + c.MENUNGGU_TIBA, `${bl.status}`);
rec("kartu antrean memuat jumlahUnitOrder/unitKe/saudaraSiap/jalur/revisiJadwal/unitCas", (bl.json?.items ?? []).length === 0 || (bl.json.items.every((i) => Number.isInteger(i.jumlahUnitOrder) && Number.isInteger(i.unitKe) && Array.isArray(i.saudaraSiap) && ["ADMIN", "V2"].includes(i.jalur) && "unitCas" in i && Number.isInteger(i.revisiJadwal))));
for (const tab of ["TERJADWAL", "KEPUTUSAN", "SIAP", "MENUNGGU_TIBA"]) { const r = await get(`${PRD}/rencana/antrean?tab=${tab}&pageSize=5`, tW); rec(`antrean ${tab} 200`, r.status === 200 && Array.isArray(r.json?.items), `${r.status}`); }
const kep = await get(`${PRD}/rencana/antrean?tab=KEPUTUSAN&pageSize=100`, tW); rec("Butuh keputusan tidak memuat hambatan 'Run lama di luar cohort'", (kep.json?.items ?? []).every((i) => !/di luar cohort/i.test(i.alasan ?? "")));
if (tL) { const r = await get(`${PRD}/rencana/minggu?start=${hariIni}`, tL); rec("akun hanya-lihat: kalender 200 dengan izin.jadwalkan=false", r.status === 200 && r.json?.izin?.jadwalkan === false, `${r.status}`); } else skip("akun hanya-lihat membaca kalender", "tidak ada akun hanya-lihat aktif (diuji di rehearsal)");

// ── penolakan SEBELUM menulis
const unitAda = (await prisma.$queryRawUnsafe("select id::text id from units order by created_at desc limit 1"))[0]?.id ?? "00000000-0000-4000-8000-000000000001";
const uBatch = (d, extra = {}) => ({ productionDate: d, stationCode: "TABLE_1", units: [{ unitId: unitAda, expectedRevision: 0 }], ...extra });
const kS = "smoke-pjl-tidak-menulis-0001";
rec("jadwal-batch tanpa token = 401", (await post(`${PRD}/rencana/jadwal-batch`, null, uBatch(hariIni), { "Idempotency-Key": kS })).status === 401);
rec("jadwal-batch/undo tanpa token = 401", (await post(`${PRD}/rencana/jadwal-batch/undo`, null, { items: [{ unitId: unitAda, eventId: "x" }] }, { "Idempotency-Key": kS })).status === 401);
if (tL) { rec("jadwal-batch akun hanya-lihat = 403 (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tL, uBatch(hariIni), { "Idempotency-Key": kS })).status === 403); rec("jadwal-batch/undo akun hanya-lihat = 403", (await post(`${PRD}/rencana/jadwal-batch/undo`, tL, { items: [{ unitId: unitAda, eventId: "x" }] }, { "Idempotency-Key": kS })).status === 403); } else skip("akun hanya-lihat 403 pada jadwal-batch", "tidak ada akun hanya-lihat aktif (diuji di rehearsal)");
rec("jadwal-batch tanpa Idempotency-Key = 400 (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni))).status === 400);
rec("jadwal-batch daftar unit kosong = 400; lebih dari 20 unit = 400", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: [] }), { "Idempotency-Key": kS })).status === 400 && (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: Array.from({ length: 21 }, (_, i) => ({ unitId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, expectedRevision: 0 })) }), { "Idempotency-Key": kS })).status === 400);
const kemarin = new Date(Date.now() + 7 * 3600_000 - 86400_000).toISOString().slice(0, 10);
rec("jadwal-batch tanggal lewat = 422 JADWAL_TANGGAL_LEWAT (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(kemarin), { "Idempotency-Key": kS })).json?.code === "JADWAL_TANGGAL_LEWAT");
let minggu = new Date(Date.now() + 7 * 3600_000 + 86400_000).toISOString().slice(0, 10); while (new Date(`${minggu}T00:00:00Z`).getUTCDay() !== 0) minggu = new Date(new Date(`${minggu}T00:00:00Z`).getTime() + 86400_000).toISOString().slice(0, 10);
rec("jadwal-batch hari Minggu = 422 JADWAL_HARI_LIBUR (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(minggu), { "Idempotency-Key": kS })).json?.code === "JADWAL_HARI_LIBUR");
rec("jadwal-batch meja tidak dikenal = 400 JADWAL_MEJA_INVALID (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { stationCode: "TABLE_9" }), { "Idempotency-Key": kS })).json?.code === "JADWAL_MEJA_INVALID");
rec("jadwal-batch unit tidak ada = 404 (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: [{ unitId: "00000000-0000-4000-8000-0000000000ff", expectedRevision: 0 }] }), { "Idempotency-Key": kS })).status === 404);
rec("jadwal-batch daftar ganda = 400 (tidak menulis)", (await post(`${PRD}/rencana/jadwal-batch`, tW, uBatch(hariIni, { units: [{ unitId: unitAda, expectedRevision: 0 }, { unitId: unitAda, expectedRevision: 0 }] }), { "Idempotency-Key": kS })).status === 400);

const s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]);
rec("TIDAK ada jejak tulis: jadwal, riwayat jadwal, Run, tahap, stok, Material Issue, jurnal, aktivitas jadwal, rencana Meja sama persis sebelum vs sesudah smoke", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "identik");
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
  ok "smoke test lulus (bacaan jadwal bentuk baru, izin, penolakan sebelum menulis, tanpa jejak tulis, invarian)"
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
say "CATATAN: Rilis ini membawa penjadwalan langsung Rencana Produksi (seret ke Meja / Pilih meja / beberapa unit; jadwal Admin resmi) dan tabel Pemakaian aktual terpadu. TANPA migrasi. Rilis TIDAK membuat jadwal, Run, tahap, QC, penerimaan, pergerakan stok, Material Issue, atau jurnal; perubahan nyata baru terjadi saat pengguna berizin memakainya."
