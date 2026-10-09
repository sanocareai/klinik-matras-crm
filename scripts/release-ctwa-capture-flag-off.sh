#!/usr/bin/env bash
# Rilis KODE SAJA "capture atribusi CTWA Fase 0" dengan flag OFF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA).
#
# YANG DILAKUKAN : deploy kode (webhooks.js, ctwaCapture*.js, leadAttribution.js, skrip report/purge, tes, dokumen).
# YANG TIDAK     : TIDAK mengubah .env / variabel lingkungan apa pun, TIDAK mengaktifkan capture, TIDAK ada migrasi, TIDAK membangun frontend
#                  (dist disalin dari release aktif), TIDAK menghapus release/image/berkas lama (tidak ada fase pembersihan), TIDAK rollback otomatis.
# BERHENTI BILA  : baseline live berubah; mount /app/data tidak sesuai; disk bebas < 5 GiB; pg_dump/verifikasi restore pra-rilis gagal;
#                  .env sudah memuat CTWA_*; folder capture sudah ada; ada berkas di luar allowlist; isi berkas runtime berbeda dari pin sha256.
#
# Pemakaian (dari laptop; sumber kode: bundle git, TANPA push — atau branch di origin bila CAND_BRANCH sudah dipush Owner):
#   git bundle create /tmp/ctwa.bundle <BASE_SHA>..<CAND_BRANCH>      # di repo kandidat
#   scp /tmp/ctwa.bundle ubuntu@43.133.152.6:/tmp/ctwa.bundle
#   cat scripts/release-ctwa-capture-flag-off.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rcc.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/ctwa.bundle bash /tmp/rcc.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/ctwa.bundle bash /tmp/rcc.sh <DEPLOY_SHA_40> <BASE_SHA_40>'                    # rilis
#   ssh ubuntu@43.133.152.6 'bash /tmp/rcc.sh <DEPLOY_SHA_40> <BASE_SHA_40> --verify-only'                               # smoke ulang (baca-saja)
#
# Kode keluar: 0 selesai & terverifikasi | 1 berhenti (lihat instruksi rollback) | 3 rilis aktif tetapi smoke inbox TERTUNDA (belum ada trafik) — jalankan --verify-only.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
MODE=release
for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --verify-only) MODE=verify;; esac; done

MIN_FREE_KB=$((5 * 1024 * 1024))     # 5 GiB — gerbang keras (dicek di awal, sebelum build, dan sebelum switch)
SMOKE_WAIT_SEC="${SMOKE_WAIT_SEC:-300}"
CAND_BRANCH="${CAND_BRANCH:-rc/ctwa-capture-phase0-on-live-934142cd}"
BUNDLE="${BUNDLE:-}"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"
TAG_KODE="ctwa0"

# Hanya berkas ini yang BOLEH berbeda dari baseline (EKSPLISIT; Production/Delivery/Finance/Inbox-selain-webhooks/schema/package/compose = berhenti).
ALLOWED_RE='^(\.gitignore|backend/\.env\.example|backend/scripts/ctwa-capture-(purge|report)\.js|backend/src/routes/webhooks\.js|backend/src/services/(ctwaCapture|ctwaCaptureAnalysis|leadAttribution)\.js|backend/tests/(ctwaCapture|leadAttribution|releaseCtwaCapture)\.test\.js|backend/tests/integration/ctwaCapture\.integration\.test\.js|docs/CTWA-[A-Z0-9-]+\.md|scripts/release-ctwa-capture-flag-off\.sh)$'
# Pin sha256 (teks LF) berkas RUNTIME. Isi berbeda dari pin = berhenti sampai ditinjau ulang. Diisi saat kandidat dibekukan.
declare -A PINS=(
  ["backend/src/routes/webhooks.js"]="95759a967921d1ab181a3cdb9879a75cbaa757641a5d5ae304c8a53dcdedb94b"
  ["backend/src/services/ctwaCapture.js"]="99a0bb004278c6189324097d3c99320eb0156d1b9881a93115a8b8ae46850302"
  ["backend/src/services/ctwaCaptureAnalysis.js"]="2944100f78ffa5594035d2077cfd280d0c702ca3e36660d055872b1f2d6ba3d0"
  ["backend/src/services/leadAttribution.js"]="69ac495ececa57c65bd5a370a7bfa6f7bd8fa7fb63725027ce334a53f4a46218"
)

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

# ── Fungsi gerbang MURNI (diuji lewat CTWA_RELEASE_SELFTEST=1 tanpa menyentuh produksi) ──────────────────────────────────
# disk: $1 = KB tersedia. 0 = cukup. 2 = masukan bukan angka (diperlakukan sebagai GAGAL).
gate_disk_kb() { [[ "${1:-}" =~ ^[0-9]+$ ]] || return 2; [ "$1" -ge "$MIN_FREE_KB" ]; }
# mount: $1 = keluaran 'Type|Source|Destination|RW' per baris, $2 = sumber host yang diharapkan untuk /app/data.
gate_mount_text() { printf '%s\n' "$1" | grep -Fxq "bind|${2}|/app/data|true"; }
# jumlah baris diawali CTWA_ pada teks ($1)
count_ctwa_lines() { printf '%s\n' "$1" | grep -c '^[[:space:]]*CTWA_' || true; }
# baris log "Lapis 0b" yang TIDAK berakhir 'clid: ada' / 'clid: tidak ada' (harus 0)
count_bad_clid_logs() { printf '%s\n' "$1" | grep 'Lapis 0b' | grep -vcE 'clid: (ada|tidak ada)[[:space:]]*$' || true; }
sha_lf() { tr -d '\r' | sha256sum | cut -d' ' -f1; }

if [ "${CTWA_RELEASE_SELFTEST:-}" = "1" ]; then
  fail=0; t() { if "$@"; then printf 'PASS %s\n' "$*"; else printf 'FAIL %s\n' "$*"; fail=1; fi; }
  f() { if "$@"; then printf 'FAIL(harus gagal) %s\n' "$*"; fail=1; else printf 'PASS(gagal sesuai harapan) %s\n' "$*"; fi; }
  t gate_disk_kb 5242880; t gate_disk_kb 9999999; f gate_disk_kb 5242879; f gate_disk_kb 0; f gate_disk_kb ""; f gate_disk_kb "abc"; f gate_disk_kb "6.0G"
  M=$'bind|/home/ubuntu/klinik-matras/backend/uploads|/app/uploads|true\nbind|/home/ubuntu/klinik-matras/backend/data|/app/data|true'
  t gate_mount_text "$M" /home/ubuntu/klinik-matras/backend/data
  f gate_mount_text "$M" /home/ubuntu/lain/backend/data
  f gate_mount_text $'bind|/home/ubuntu/klinik-matras/backend/data|/app/data|false' /home/ubuntu/klinik-matras/backend/data
  f gate_mount_text $'volume|/home/ubuntu/klinik-matras/backend/data|/app/data|true' /home/ubuntu/klinik-matras/backend/data
  f gate_mount_text "" /home/ubuntu/klinik-matras/backend/data
  [ "$(count_ctwa_lines $'A=1\nCTWA_ATTRIBUTION_CAPTURE_ENABLED=false\n  CTWA_CAPTURE_HASH_SALT=x')" = "2" ] && echo "PASS count_ctwa_lines=2" || { echo "FAIL count_ctwa_lines"; fail=1; }
  [ "$(count_ctwa_lines $'A=1\nB=2')" = "0" ] && echo "PASS count_ctwa_lines=0" || { echo "FAIL count_ctwa_lines0"; fail=1; }
  [ "$(count_bad_clid_logs $'[attribution] Lapis 0b Meta CTWA: x clid: ada\n[attribution] Lapis 0b Meta CTWA: y clid: tidak ada\nlain')" = "0" ] && echo "PASS clid log bersih" || { echo "FAIL clid log bersih"; fail=1; }
  [ "$(count_bad_clid_logs $'[attribution] Lapis 0b Meta CTWA: x clid: AfhKBK8ZBWyKw3p4')" = "1" ] && echo "PASS clid log bocor terdeteksi" || { echo "FAIL clid log bocor"; fail=1; }
  [ "$(printf 'a\r\nb\r\n' | sha_lf)" = "$(printf 'a\nb\n' | sha_lf)" ] && echo "PASS sha_lf CRLF=LF" || { echo "FAIL sha_lf"; fail=1; }
  exit "$fail"
fi

[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA kandidat 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/${TAG_KODE}-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; VERIFY_DB=""

sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
avail_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
disk_gate() { local a; a="$(avail_kb)"; gate_disk_kb "$a" || die "disk bebas $(( ${a:-0} / 1024 )) MiB < 5 GiB (${1}) — berhenti, tidak ada yang diubah setelah titik ini"; ok "disk bebas $(( a / 1024 )) MiB >= 5 GiB (${1})"; }
mounts_of() { docker inspect -f '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{"\n"}}{{end}}' "$1"; }
mount_gate() { gate_mount_text "$(mounts_of "$1")" "$PERSIST/backend/data" || die "mount /app/data ($2) BUKAN bind rw ke ${PERSIST}/backend/data — berhenti"; ok "mount /app/data ($2) = bind rw ${PERSIST}/backend/data"; }
drop_verify_db() { [ -n "$VERIFY_DB" ] && [ -n "$PREV_DIR" ] && dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${VERIFY_DB}\"" </dev/null >/dev/null 2>&1 || true; }

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa)
Image sebelumnya   : ${ROLLBACK_TAG:-<belum ditandai>}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (tidak ada yang perlu dipulihkan).
Setelah switch bermasalah:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Tidak ada migrasi dan tidak ada perubahan data: rollback = kode saja; pemulihan database TIDAK diperlukan.
Tidak ada .env yang diubah dan capture tidak pernah dinyalakan; bila ada folder ${PERSIST}/backend/data/ctwa-capture, itu BUKAN dari rilis ini — selidiki sebelum menghapus.
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; drop_verify_db; [ $rc -ne 0 ] && [ "$MODE" != "verify" ] && rollback_instructions; exit $rc' EXIT

# Verifikasi pasca-rilis BACA-SAJA. Dipakai fase 8 dan --verify-only. Mengembalikan 0 = lulus penuh, 3 = lulus tetapi belum ada trafik inbound.
verify_live() {
  local since_utc="$1" since_naive="$2" cid dir
  cid="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
  [ "$(printf '%s\n' "$cid" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
  dir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid")"
  [ "$(tr -d '[:space:]' < "$dir/.release-commit")" = "$DEPLOY_SHORT" ] || die "release aktif (${dir}) BUKAN ${DEPLOY_SHORT}"
  ok "release aktif = ${DEPLOY_SHORT}"
  curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal gagal"
  curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "health internal + publik"
  [ "$(docker inspect -f '{{.RestartCount}}' "$cid")" = "0" ] && [ "$(docker inspect -f '{{.State.Running}}' "$cid")" = "true" ] || die "backend restart/tidak berjalan"; ok "RestartCount=0, berjalan"
  mount_gate "$cid" "container aktif"
  local f have
  for f in "${!PINS[@]}"; do
    have="$(docker exec "$cid" sh -c "cat /app/${f#backend/}" | sha_lf)"
    [ "$have" = "${PINS[$f]}" ] || die "isi ${f} di container BERBEDA dari pin (${have:0:12} != ${PINS[$f]:0:12})"
  done; ok "4 berkas runtime di container = pin sha256"
  # ── BUKTI FLAG OFF ──
  local envn; envn="$(docker exec "$cid" sh -c 'env | grep -c "^CTWA_" || true')"
  [ "$envn" = "0" ] || die "container memuat ${envn} variabel CTWA_* — rilis ini harus flag OFF tanpa CTWA_*"; ok "env container: 0 variabel CTWA_* (capture mati)"
  local cdir; cdir="$(docker exec "$cid" sh -c 'find /app/data -maxdepth 2 -name "ctwa-capture*" 2>/dev/null | wc -l')"
  [ "$cdir" = "0" ] || die "ditemukan ${cdir} entri ctwa-capture* di /app/data padahal flag OFF"
  [ "$(find "$PERSIST/backend/data" -maxdepth 2 -name 'ctwa-capture*' 2>/dev/null | wc -l)" = "0" ] || die "ada entri ctwa-capture* di host backend/data padahal flag OFF"
  ok "folder/berkas capture TIDAK ada (container dan host)"
  local logs; logs="$(docker logs --since "$since_utc" "$cid" 2>&1 || true)"
  [ "$(printf '%s\n' "$logs" | grep -c '\[ctwa-capture\]' || true)" = "0" ] || die "log memuat baris [ctwa-capture] padahal flag OFF"
  local errn; errn="$(printf '%s\n' "$logs" | grep -cE 'Gagal proses webhook|unhandledRejection|ReferenceError|SyntaxError|Cannot find module|TypeError' || true)"
  [ "$errn" = "0" ] || { printf '%s\n' "$logs" | grep -E 'Gagal proses webhook|unhandledRejection|ReferenceError|SyntaxError|Cannot find module|TypeError' | cut -c1-160 | head -5 | sed 's/^/        /'; die "${errn} baris galat webhook/runtime sejak switch"; }
  ok "log sejak switch: 0 galat webhook/runtime, 0 baris [ctwa-capture]"
  [ "$(count_bad_clid_logs "$logs")" = "0" ] || die "log 'Lapis 0b' memuat nilai clid (harus 'clid: ada'/'clid: tidak ada')"; ok "log atribusi bersih dari potongan clid"
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${PUBLIC_URL}/api/conversations")" = "401" ] || die "/api/conversations tanpa login tidak menjawab 401 (route inbox bermasalah)"; ok "route inbox hidup (401 tanpa login)"
  # ── SMOKE INBOX: pesan inbound BARU harus tersimpan (agregat saja; isi tidak dibaca) ──
  local n=0 waited=0 q
  q="select count(*) from \"Message\" m join \"Conversation\" c on c.id=m.\"conversationId\" where m.direction='INBOUND' and c.type='INDIVIDUAL' and m.\"createdAt\" > timestamp '${since_naive}'"
  while :; do
    n="$(dcp "$dir" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$q" </dev/null)"
    [ "${n:-0}" -ge 1 ] && break
    [ "$waited" -ge "$SMOKE_WAIT_SEC" ] && break
    sleep 10; waited=$((waited + 10))
  done
  if [ "${n:-0}" -ge 1 ]; then
    ok "smoke inbox: ${n} pesan inbound BARU tersimpan sejak switch (folder capture tetap tidak ada, dicek ulang di bawah)"
    [ "$(docker exec "$cid" sh -c 'find /app/data -maxdepth 2 -name "ctwa-capture*" | wc -l')" = "0" ] || die "folder capture muncul SETELAH trafik inbound dengan flag OFF"
    ok "BUKTI: ada trafik inbound nyata dan tidak ada berkas capture dibuat (flag OFF)"
    return 0
  fi
  warn "belum ada pesan inbound baru dalam ${SMOKE_WAIT_SEC} dtk — smoke inbox TERTUNDA (bukan gagal). Jalankan: bash /tmp/rcc.sh ${DEPLOY_SHA} ${BASE_SHA} --verify-only"
  return 3
}

if [ "$MODE" = "verify" ]; then
  say "VERIFY-ONLY (baca-saja) rilis ${DEPLOY_SHORT}"
  PREV_DIR="$RELEASES/$DEPLOY_SHORT"; [ -d "$PREV_DIR" ] || die "release dir ${PREV_DIR} tidak ada"
  SINCE_UTC="${VERIFY_SINCE_UTC:-$(date -u -d '-30 minutes' +%Y-%m-%dT%H:%M:%SZ)}"; SINCE_NAIVE="$(date -u -d "$SINCE_UTC" '+%F %T')"
  SMOKE_WAIT_SEC="${SMOKE_WAIT_SEC:-60}"
  rc=0; verify_live "$SINCE_UTC" "$SINCE_NAIVE" || rc=$?
  trap - EXIT; exit "$rc"
fi

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df find; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"; done
exec 9>/tmp/release-ctwa-capture.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rcc\|release-ctwa-capture\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"
disk_gate "awal"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, pin isi"
[ -d "$SRC" ] || die "repo sumber ${SRC} tidak ada (baseline tidak dapat diverifikasi)"
if [ -n "$BUNDLE" ]; then
  [ -r "$BUNDLE" ] || die "BUNDLE=${BUNDLE} tidak terbaca"
  sg bundle verify "$BUNDLE" >/dev/null 2>&1 || die "git bundle tidak valid / prasyarat (baseline) tidak ada di repo sumber"
  sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" || die "fetch dari bundle gagal"
else
  sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
  sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" || die "git fetch gagal (branch kandidat sudah dipush?)"
fi
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "kandidat (${CAND_BRANCH}) BUKAN SHA rilis; bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist CTWA yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -qE '^backend/prisma/|package(-lock)?\.json$|^docker-compose|Dockerfile$|^frontend/' || die "schema/migration/dependensi/compose/frontend berubah — rilis ini harus KODE SAJA"
ok "$(printf '%s\n' "$CHANGED" | wc -l) berkas berbeda dari baseline ${BASE_SHA:0:8}, SEMUA dalam allowlist CTWA; tanpa migration/dependensi/compose/frontend"
for f in "${!PINS[@]}"; do
  have="$(sg show "${DEPLOY_SHA}:${f}" | sha_lf)"
  [ "$have" = "${PINS[$f]}" ] || die "isi ${f} di kandidat (${have:0:12}) BERBEDA dari pin (${PINS[$f]:0:12}) — tinjau ulang lalu perbarui pin"
done; ok "4 berkas runtime di kandidat = pin sha256"
! sg show "${DEPLOY_SHA}:backend/src/routes/webhooks.js" | grep -Eq 'clid[^\n]*\.slice\(|JSON\.stringify\([[:space:]]*ctwa' || die "webhooks.js memuat pola log/serialisasi clid yang dilarang"
ok "webhooks.js tidak memuat pola log/serialisasi clid"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHA:0:8}; produksi bergeser — berhenti, rebase kandidat"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
ok "baseline live = ${PREV_COMMIT} (${PREV_DIR}); image ${IMG_NAME} (${PREV_IMG_ID:7:12})"
mount_gate "$CID_OLD" "baseline"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal sebelum rilis gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik sebelum rilis gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
ok "health sehat; bundel publik = dist release aktif (${PREV_INDEX})"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung"
MIG_SEBELUM="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
# ── Gerbang FLAG OFF: rilis ini tidak mengubah env, jadi env HARUS sudah bersih dari CTWA_* ──
[ "$(count_ctwa_lines "$(cat "$PERSIST/backend/.env")")" = "0" ] || die "backend/.env sudah memuat baris CTWA_* — rilis ini harus flag OFF tanpa CTWA_* (selesaikan dulu)"
[ "$(docker exec "$CID_OLD" sh -c 'env | grep -c "^CTWA_" || true')" = "0" ] || die "container aktif memuat variabel CTWA_*"
[ "$(find "$PERSIST/backend/data" -maxdepth 2 -name 'ctwa-capture*' 2>/dev/null | wc -l)" = "0" ] || die "sudah ada entri ctwa-capture* di backend/data sebelum rilis"
ok "flag OFF terbukti: .env 0 baris CTWA_*, container 0 variabel CTWA_*, folder capture belum ada"
[ "$(docker exec "$CID_OLD" sh -c 'env | grep -c "^WEBHOOK_DEBUG=1$" || true')" = "0" ] || die "WEBHOOK_DEBUG=1 aktif di produksi (payload penuh masuk log) — matikan dulu"
ok "WEBHOOK_DEBUG tidak aktif"
INB_30="$(psql_live -At -c "select count(*) from \"Message\" m join \"Conversation\" c on c.id=m.\"conversationId\" where m.direction='INBOUND' and c.type='INDIVIDUAL' and m.\"createdAt\" > (now() at time zone 'utc') - interval '30 minutes'")"
ok "baseline trafik: ${INB_30} pesan inbound 30 menit terakhir (agregat)"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; DIST_KB="$(du -sk "$PREV_DIR/frontend/dist" | cut -f1)"
ok "DB $(( DB_BYTES / 1048576 )) MiB, dist aktif $(( DIST_KB / 1024 )) MiB (kebutuhan rilis ±500 MiB di atas gerbang 5 GiB)"
if [ "$MODE" = "preflight" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup pra-rilis + checksum + verifikasi restore"
BACKUP_TARGET="$HOME/backups/pre-${TAG_KODE}-${DEPLOY_SHORT}-${TS}.sql.gz"   # BACKUP_FILE baru diisi SETELAH backup valid (instruksi rollback tidak menyebut berkas yang belum ada)
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_TARGET}.partial" || die "pg_dump gagal — berhenti, tidak ada yang diubah"
gzip -t "${BACKUP_TARGET}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_TARGET}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_TARGET}.partial")" -gt 1000000 ] || die "file backup terlalu kecil"
mv "${BACKUP_TARGET}.partial" "$BACKUP_TARGET"; BACKUP_FILE="$BACKUP_TARGET"; chmod 600 "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
chmod 600 "${BACKUP_FILE}.sha256"
ok "backup ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256" | cut -c1-16)…"
VERIFY_DB="verify_${TAG_KODE}_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${VERIFY_DB}\"" </dev/null || die "gagal membuat DB verifikasi"
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-verify.log" 2>&1 || true
for T in '"Order"' '"Customer"' '"Message"' payments fin_journal_entries; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -q -c "select count(*) from $T" </dev/null)"
  # Message/Customer boleh bertambah oleh trafik selama dump berjalan; kurang dari produksi-saat-dump = restore cacat. Toleransi: restore <= produksi; selisih <= 50 (Message: 2000).
  TOL=50; [ "$T" = '"Message"' ] && TOL=2000
  [ "$B" -le "$A" ] && [ $(( A - B )) -le "$TOL" ] || die "restore verifikasi tidak cocok untuk $T (produksi=$A restore=$B)"
done
drop_verify_db; VERIFY_DB=""
ok "restore nyata ke DB sementara cocok (Order, Customer, Message, payments, jurnal); DB sementara dihapus"
disk_gate "setelah backup+verifikasi restore"

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] && [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "release/image aktif berubah selama backup — baseline bergeser"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin dist aktif"
[ "$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)" = "$PREV_INDEX" ] || die "dist salinan berbeda dari dist aktif"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.yml") >/dev/null || die "docker-compose.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/backend/package.json") <(tr -d '\r' < "$NEW_DIR/backend/package.json") >/dev/null || die "backend/package.json berbeda dari release aktif"
ok "release dir dibuat; compose + package.json identik dengan release aktif; dist = salinan dist aktif"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
disk_gate "sebelum build"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-${TAG_KODE}-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"
for f in "${!PINS[@]}"; do
  have="$(dcp "$NEW_DIR" run --rm --no-deps -T --entrypoint sh backend -c "cat /app/${f#backend/}" </dev/null | sha_lf)"
  [ "$have" = "${PINS[$f]}" ] || die "image baru memuat ${f} berbeda dari pin"
done; ok "image baru memuat 4 berkas runtime persis pin (sebelum switch)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status tidak 'up to date' (rilis ini TIDAK boleh ada migration)"
ok "tidak ada migration pending"
disk_gate "sebelum switch"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama build — baseline bergeser, JANGAN switch"
[ "$(sed -n 1p "$PREV_DIR/.release-commit" | tr -d '[:space:]')" = "$PREV_COMMIT" ] || die "baseline berubah selama build"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali; env TIDAK diubah)"
SWITCH_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; SWITCH_NAIVE="$(date -u '+%F %T')"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for _ in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis + smoke inbox (baca-saja)"
PREV_DIR="$NEW_DIR"
sleep 20
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$MIG_SEBELUM" ] || die "jumlah migrasi terpasang berubah (tidak diharapkan)"; ok "jumlah migrasi terpasang tidak berubah (${MIG_SEBELUM})"
rc=0; verify_live "$SWITCH_UTC" "$SWITCH_NAIVE" || rc=$?
trap - EXIT
if [ "$rc" = "0" ]; then
  say "SELESAI — ${DEPLOY_SHORT} aktif, flag OFF terbukti. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
  exit 0
fi
say "RILIS AKTIF, SMOKE INBOX TERTUNDA — ${DEPLOY_SHORT}. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}."
exit 3
