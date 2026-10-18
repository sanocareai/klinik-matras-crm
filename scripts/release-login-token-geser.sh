#!/usr/bin/env bash
# RILIS FRONTEND-SAJA "token geser lama tidak boleh menimpa token login baru" (Sesi Berakhir berulang setelah login) — TANPA backend, TANPA migrasi, TANPA schema,
# TANPA tulisan data, TANPA build image. Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED. Dist web dibangun di release dir baru; backend DI-RECREATE
# dari release baru dengan IMAGE YANG SAMA (dist di-bind-mount dari direktori release). .env tidak diubah (sha dibandingkan sebelum/sesudah).
# BERHENTI BILA: baseline live berubah; ada deploy lain; disk < 5 GiB; ada berkas di luar allowlist; backend/, prisma, package, Docker/compose, .env, dist ikut berubah;
#                dist baru tidak memuat patch atau kehilangan teks fitur lama; image berubah setelah recreate; RestartCount != 0; .env berubah.
#
#   git bundle create /tmp/loginfix.bundle <BASE_SHA>..fix/login-token-geser-on-live ; scp ke server
#   cat scripts/release-login-token-geser.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/loginfix.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/loginfix.bundle bash /tmp/loginfix.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/loginfix.bundle bash /tmp/loginfix.sh <DEPLOY_SHA_40> <BASE_SHA_40>'
#   ssh ubuntu@43.133.152.6 'bash /tmp/loginfix.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rollback'     # kembali ke release sebelumnya (image sama; tidak ada data yang dihapus)
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
MODE=release
for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --rollback) MODE=rollback;; esac; done
CAND_BRANCH="${CAND_BRANCH:-fix/login-token-geser-on-live}"
CAND_REF="refs/remotes/origin/cand-loginfix"
BUNDLE="${BUNDLE:-}"
ALLOWED_RE='^(frontend/src/api\.js|frontend/src/lib/tokenGeser\.js|frontend/tests/loginSesi401\.test\.js|scripts/release-login-token-geser\.sh)$'
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/lib/tokenGeser.js"
PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MIN_FREE_KB=$((5 * 1024 * 1024))
TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/loginfix-${DEPLOY_SHORT}-${TS}"
PHASE="init"; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  \033[33mPERHATIAN\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
bebas_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
cek_disk() { [ "$(bebas_kb)" -ge "$MIN_FREE_KB" ] || die "disk bebas < 5 GiB ($1)"; ok "disk bebas $(( $(bebas_kb) / 1024 )) MiB >= 5 GiB ($1)"; }

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa; image sama dengan release baru)
Berhenti SEBELUM 'Switch' -> backend lama tidak pernah dimatikan. Setelah switch:
   bash /tmp/loginfix.sh ${DEPLOY_SHA:-<sha>} ${BASE_SHA:-<base>} --rollback
   (setara: cd ${PREV_DIR:-<release-sebelumnya>} && SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend)
Rilis ini hanya mengganti dist web. Tidak ada migrasi/data baru; .env TIDAK disentuh.
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"; done
exec 9>/tmp/release-login-token-geser.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "loginfix\|release-login-token-geser\|pgrep\|node src/index.js" | grep -v "$$" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src"; exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
cek_disk "awal"

PHASE="1-aktif"; say "1. Release aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
ENV_SHA="$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)"
ok "release aktif ${PREV_DIR} (commit ${PREV_COMMIT}); image ${IMG_NAME} (${PREV_IMG_ID:7:12}); .env sha ${ENV_SHA}"

if [ "$MODE" = "rollback" ]; then
  PHASE="rollback"; say "ROLLBACK ke release sebelumnya (kode saja)"
  CAND_DIR_NOW="$PREV_DIR"; [ "$(basename "$CAND_DIR_NOW")" = "$DEPLOY_SHORT" ] || die "release aktif bukan ${DEPLOY_SHORT}; tidak ada yang di-rollback"
  TARGET="${BASE_SHA:0:8}"; [ -d "$RELEASES/$TARGET" ] || die "release ${TARGET} tidak ada di ${RELEASES}"
  dcp "$RELEASES/$TARGET" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "recreate dari ${TARGET} gagal"
  for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && break; sleep 2; done
  curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend tidak sehat setelah rollback"
  ok "rollback ke ${TARGET} selesai; .env sha $(sha256sum "$PERSIST/backend/.env" | cut -c1-16)"; trap - EXIT; exit 0
fi

PHASE="2-sumber"; say "2. Sumber kode, ancestry, batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
if [ -n "$BUNDLE" ]; then
  [ -r "$BUNDLE" ] || die "BUNDLE=${BUNDLE} tidak terbaca"
  sg bundle verify "$BUNDLE" >/dev/null 2>&1 || die "git bundle tidak valid / prasyarat tidak ada di repo sumber"
  sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch dari bundle gagal"
else
  sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "git fetch gagal"
fi
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat (${CAND_BRANCH}) BUKAN SHA rilis; bergeser"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHA:0:8}; produksi bergeser — berhenti"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat — gabungkan live terbaru dulu"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -qE '^(backend/|frontend/dist|docker-compose|.*Dockerfile|.*package(-lock)?\.json$|.*\.env)' || die "backend/dist/Docker/package/.env berubah — rilis ini frontend-saja"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas, semuanya dalam allowlist; backend/schema/package/Docker tidak berubah"

PHASE="3-audit"; say "3. Audit produksi aktif"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"
PUB_BEFORE="$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$PUB_BEFORE" = "$PREV_INDEX" ] || die "bundel publik (${PUB_BEFORE}) != dist release aktif (${PREV_INDEX})"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung"
MSG_N0="$(psql_live -At -c 'select count(*) from "Message"')"; [[ "$MSG_N0" =~ ^[0-9]+$ ]] || die "hitungan Message bukan angka"
ok "health sehat; bundel publik = dist aktif (${PREV_INDEX}); tidak ada migrasi menggantung; Message=${MSG_N0}"
LOCK_NEW="$BK_DIR/pkg-baru.json"; sg show "${DEPLOY_SHA}:frontend/package.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package.json identik"
NM_KB="$(du -sk "$NM_SRC" | cut -f1)"
[ "$(bebas_kb)" -ge $(( NM_KB * 2 + 2 * 1024 * 1024 )) ] || die "ruang disk kurang untuk salinan node_modules + build"
ok "node_modules build dari ${NM_SRC}; ruang cukup"
if [ "$MODE" = "preflight" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.yml") >/dev/null || die "docker-compose.yml berbeda dari release aktif"
diff -rq --exclude=node_modules --exclude=dist --exclude=.env --exclude=.release-commit "$PREV_DIR/backend" "$NEW_DIR/backend" >/dev/null || die "backend/ di release baru BERBEDA dari release aktif (rilis ini frontend-saja)"
ok "release dir dibuat; compose + seluruh backend/ identik dengan release aktif"

say "4b. Build frontend (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "bundel baru identik dengan lama"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
# Patch (harus ada di chunk index BARU, dan TIDAK ada di chunk index aktif): rantai decode base64url klaim token + header token geser.
MARK='.replace(/-/g,"+").replace(/_/g,"/")'
grep -qF "X-Refreshed-Token" "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" && grep -qF -- "$MARK" "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" || die "chunk index baru TIDAK memuat patch token geser"
! grep -qF -- "$MARK" "$PREV_DIR/frontend/dist/assets/$PREV_INDEX" || die "[skrip] penanda patch sudah ada di chunk index aktif — perbaiki pembanding"
for s2 in "Sesi Berakhir" "Login Kembali" "Konfirmasi Barang Jadi" "Menunggu konfirmasi siap kirim" "Rencana Produksi" "Checklist Persiapan Perjalanan" "Uang Muka"; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); patch token geser ada di chunk index; 7 teks fitur lama ada"

PHASE="4c-aset-lama"; say "4c. Bawa aset ber-hash dari dist aktif (tab terbuka saat deploy tetap bisa memuat chunk lama)"
OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"; n=0
for f in "$PREV_DIR"/frontend/dist/assets/*; do
  [ -f "$f" ] || continue; b="$(basename "$f")"; [ -e "$NEW_DIR/frontend/dist/assets/$b" ] && continue
  cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b" && { printf '%s\n' "$b" >> "$OLD_ASSETS"; n=$((n+1)); }
done
find "$NEW_DIR/frontend/dist/assets" -type f -mtime +21 -delete
[ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "bundel baru rusak setelah membawa aset lama"
ok "${n} aset lama dibawa; index.html baru hanya merujuk aset baru"
cek_disk "sebelum switch"
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum switch"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah sebelum switch"

PHASE="5-switch"; say "5. Switch (recreate backend dari release baru, image SAMA; SATU kali)"
T_SWITCH="$(date -u +%FT%TZ)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$PREV_IMG_ID" ] || die "image berubah (rilis ini tidak boleh mengganti image)"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend sehat dari ${DEPLOY_SHORT}; image sama ${PREV_IMG_ID:7:12}; switch ${T_SWITCH}"

PHASE="6-verifikasi"; say "6. Verifikasi pasca-rilis (baca-saja)"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru"
ok "publik 200; bundel web publik = dist baru ${NEW_INDEX}"
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} 404"; ok "aset lama masih 200"; fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang tidak ada harus 404 jujur"
ok "aset yang tidak ada = 404"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env BERUBAH selama rilis"
ok ".env identik (sha ${ENV_SHA})"
# Smoke baca-saja: /api/auth/me tanpa token 401, token tidak valid 401 TOKEN_INVALID, token ADMIN sah 200 (token ditandatangani lokal di container, tidak dicetak; TIDAK memanggil /auth/login).
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke endpoint GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken"); const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient();
let fail = 0; const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const adm = await prisma.user.findFirst({ where: { active: true, role: "ADMIN" } });
if (!adm) { rec("akun ADMIN aktif", false, "tidak ada"); process.exit(1); }
const roles = (await prisma.userRole.findMany({ where: { userId: adm.id }, select: { role: true } })).map((r) => r.role);
const tok = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: roles.length ? roles : [adm.role] }, process.env.JWT_SECRET, { expiresIn: "5m" });
const get = async (p, t) => { const r = await fetch("http://127.0.0.1:4000" + p, { headers: t ? { Authorization: "Bearer " + t } : {} }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
rec("/api/auth/me tanpa token -> 401", (await get("/api/auth/me")).s === 401);
const bad = await get("/api/auth/me", "bukan-token"); rec("token tidak valid -> 401 TOKEN_INVALID", bad.s === 401 && bad.j?.code === "TOKEN_INVALID", `${bad.s}`);
rec("token ADMIN sah -> 200", (await get("/api/auth/me", tok)).s === 200);
await prisma.$disconnect(); console.log("SMOKE_HASIL fail=" + fail); process.exit(fail ? 1 : 0);
NODE
grep -q '^SMOKE_HASIL fail=0$' "$BK_DIR/smoke.log" || die "smoke endpoint tidak lulus"
ok "smoke endpoint lulus"
# Inbox: pesan INBOUND baru sejak switch harus muncul (tunggu sampai 3 menit). Event keluar tidak dihitung.
INB=0; for i in $(seq 1 18); do INB="$(psql_live -At -c "select count(*) from \"Message\" where direction='INBOUND' and \"createdAt\" > '${T_SWITCH}'::timestamptz")"; [ "${INB:-0}" -ge 1 ] && break; sleep 10; done
[ "${INB:-0}" -ge 1 ] && ok "inbox hidup: ${INB} pesan INBOUND baru sejak switch" || warn "belum ada pesan INBOUND baru dalam 3 menit sejak switch (mungkin sepi); periksa manual"
sleep 15
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0"
trap - EXIT
say "SELESAI — frontend ${DEPLOY_SHORT} aktif (switch ${T_SWITCH}). Rollback: bash /tmp/loginfix.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback. Log: ${BK_DIR}/release.log"
