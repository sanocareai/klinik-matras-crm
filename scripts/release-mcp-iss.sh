#!/usr/bin/env bash
# RILIS MCP ChatGPT: callback stabil + issuer identification (RFC 9207) + openid-configuration 404 — BACKEND SAJA, TANPA migrasi, TANPA perubahan frontend/dependensi.
# Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). Diturunkan dari release-po-bahan-baku.sh tanpa fase migrasi/rehearsal/build frontend:
# dist frontend DISALIN dari release aktif (frontend tidak berubah), image backend dibangun ulang, switch sekali, verifikasi baca-saja (tanpa menulis data bisnis maupun OAuth).
#
#   cat scripts/release-mcp-iss.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rmi.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rmi.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rmi.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/rmi.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/chatgpt-mcp-iss-callback}"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Prisma/package/frontend/Production/Finance/tool catalog tidak boleh ikut.
ALLOWED_RE='^(backend/src/mcp/oauth\.js|backend/src/mcp/oauthCrypto\.js|backend/tests/mcp-oauth\.test\.js|backend/tests/integration/mcpOAuthIssuer\.integration\.test\.js|docs/CHATGPT-MCP-PLUGIN\.md|scripts/release-mcp-iss\.sh)$'
BACKEND_SRC_CHANGED_RE='^backend/src/'
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
STABLE_CB="https://chatgpt.com/connector_platform_oauth_redirect"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
NEW_DIR="$RELEASES/$DEPLOY_SHORT"
PREFLIGHT_ONLY=0
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/mcpiss-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
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
Setelah switch bermasalah:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Rilis ini TIDAK punya migrasi dan TIDAK mengubah data: rollback kode tidak membutuhkan pemulihan database.
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas).
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-mcp-iss.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rmi\|release-mcp-iss\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, dan batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
# Kode sumber backend yang berubah HARUS tepat dua berkas OAuth (tool catalog, plugin, permission, tools*.js tidak boleh tersentuh).
[ "$(printf '%s\n' "$CHANGED" | grep -E "$BACKEND_SRC_CHANGED_RE" | LC_ALL=C sort | tr '\n' ' ')" = "backend/src/mcp/oauth.js backend/src/mcp/oauthCrypto.js " ] || die "berkas backend/src yang berubah bukan tepat oauth.js + oauthCrypto.js"
! printf '%s\n' "$CHANGED" | grep -qE '^(backend/prisma/|frontend/)|package(-lock)?\.json$' || die "prisma/frontend/dependensi berubah — rilis ini harus TANPA migrasi dan TANPA frontend"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas, semua dalam allowlist; tanpa prisma/frontend/dependensi"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] && [ -d "$PREV_DIR/frontend/dist" ] || die "release aktif tidak lengkap"
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
MIG_SEBELUM="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
ok "migrasi terpasang sebelum rilis = ${MIG_SEBELUM} (harus tidak berubah)"
# Kondisi MCP sebelum rilis (baca-saja): nilai baru dipakai membandingkan sesudah rilis.
PSEBELUM_META="$(curl -fsS --max-time 15 "${PUBLIC_URL}/.well-known/oauth-authorization-server" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);console.log(JSON.stringify({iss:m.authorization_response_iss_parameter_supported??null,issuer:m.issuer}))})')"
ok "metadata sebelum rilis: ${PSEBELUM_META}"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 2 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-mcpiss-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; dist frontend disalin dari release aktif; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
# frontend/.env juga di-symlink (kunci Maps) — regresi lama bila hanya backend/.env.
ln -s "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env"; [ -r "$NEW_DIR/frontend/.env" ] || die "symlink frontend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin dist dari release aktif"
cmp -s "$PREV_DIR/frontend/dist/index.html" "$NEW_DIR/frontend/dist/index.html" || die "index.html hasil salinan berbeda"
ok "release dir dibuat; compose identik; dist = salinan release aktif (${PREV_INDEX}); aset lama otomatis terbawa"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-mcpiss-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali; tanpa migrasi)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja: tidak ada registrasi klien, login, atau tulis data)"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$PREV_INDEX" ] || die "bundel publik berubah (frontend tidak boleh berubah)"; ok "bundel web publik tidak berubah (${PREV_INDEX})"
for f in backend/src/mcp/oauth.js backend/src/mcp/oauthCrypto.js; do
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
done
ok "oauth.js dan oauthCrypto.js di container = kandidat (byte-identik)"
# Berkas MCP lain (katalog 6 tool, plugin, tools*.js, security.js) di container HARUS identik dengan baseline: perizinan/tool tidak berubah.
for f in chatgptPlugin.js tools.js toolsChat.js toolsTraffic.js toolsShared.js security.js index.js; do
  want="$(sg show "${BASE_SHA}:backend/src/mcp/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/src/mcp/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "backend/src/mcp/${f} di container BERBEDA dari baseline (tool/izin tidak boleh berubah)"
done
ok "chatgptPlugin.js, tools*.js, security.js, index.js tidak berubah dari baseline (enam tool, ADMIN-only, masking utuh)"

for BASE_URL in "$INTERNAL_URL" "$PUBLIC_URL"; do
  META="$(curl -fsS --max-time 15 "${BASE_URL}/.well-known/oauth-authorization-server")"
  printf '%s' "$META" | PUBLIC="$PUBLIC_URL" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);const e=[];
    if(m.authorization_response_iss_parameter_supported!==true)e.push("iss tidak diiklankan");
    if(m.issuer!==process.env.PUBLIC)e.push("issuer salah");
    if(JSON.stringify(m.code_challenge_methods_supported)!=="[\"S256\"]")e.push("PKCE bukan S256 saja");
    if(JSON.stringify(m.token_endpoint_auth_methods_supported)!=="[\"none\"]")e.push("auth method berubah");
    if(JSON.stringify(m.scopes_supported)!=="[\"mcp:read\"]")e.push("scope berubah");
    if(e.length){console.error(e.join("; "));process.exit(1)}})' || die "metadata authorization server (${BASE_URL}) tidak sesuai"
done
ok "metadata: authorization_response_iss_parameter_supported=true, issuer=${PUBLIC_URL}, S256, auth none, scope mcp:read (internal + publik)"
PRM="$(curl -fsS --max-time 15 "${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp-chatgpt")"
printf '%s' "$PRM" | PUBLIC="$PUBLIC_URL" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);if(m.resource!==process.env.PUBLIC+"/mcp-chatgpt"||JSON.stringify(m.authorization_servers)!==JSON.stringify([process.env.PUBLIC])||JSON.stringify(m.scopes_supported)!=="[\"mcp:read\"]")process.exit(1)})' || die "protected-resource metadata /mcp-chatgpt berubah"
ok "protected-resource /mcp-chatgpt: resource, authorization_servers, scope tidak berubah"
for P in /.well-known/openid-configuration /.well-known/openid-configuration/mcp-chatgpt; do
  CT="$(curl -s -o "$BK_DIR/oidc.body" -w '%{http_code} %{content_type}' --max-time 15 "${PUBLIC_URL}${P}")"
  case "$CT" in "404 application/json"*) ;; *) die "${P} -> '${CT}' (harus 404 application/json)";; esac
  ! grep -qi '<html' "$BK_DIR/oidc.body" || die "${P} masih berisi HTML"
done
ok "openid-configuration (+sub-path) -> 404 application/json, bukan HTML"
HDR="$(curl -s -D - -o /dev/null -X POST --max-time 15 -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "${PUBLIC_URL}/mcp-chatgpt")"
printf '%s' "$HDR" | head -1 | grep -q ' 401' || die "POST /mcp-chatgpt tanpa token bukan 401"
printf '%s' "$HDR" | grep -qi "^www-authenticate: Bearer resource_metadata=\"${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp-chatgpt\"" || die "WWW-Authenticate /mcp-chatgpt berubah"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST --max-time 15 -H 'Content-Type: application/json' -d '{}' "${PUBLIC_URL}/mcp")" = "401" ] || die "/mcp tanpa token bukan 401"
ok "/mcp-chatgpt dan /mcp tanpa token -> 401 (challenge OAuth /mcp-chatgpt utuh)"
# Allowlist: evaluasi kode terpasang di container (TIDAK memanggil /oauth/register => tidak ada baris klien OAuth baru). Hanya boolean/jumlah yang dicetak.
dcp "$NEW_DIR" exec -T -e STABLE="$STABLE_CB" backend node --input-type=module - <<'NODE' || die "pemeriksaan allowlist GAGAL"
import { validateRedirectUris, allowedRedirectUris, CHATGPT_STABLE_REDIRECT_URI, ALLOWED_REDIRECT_URI } from "/app/src/mcp/oauthCrypto.js";
const stable = process.env.STABLE;
const cek = (n, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); if (!ok) process.exitCode = 1; };
cek("konstanta callback stabil = nilai resmi", CHATGPT_STABLE_REDIRECT_URI === stable);
cek("callback stabil diterima (exact-match)", validateRedirectUris([stable]).valid === true);
cek("callback Claude tetap diterima", validateRedirectUris([ALLOWED_REDIRECT_URI]).valid === true);
for (const u of [stable + "/", stable + "?x=1", stable + "/x", "http://chatgpt.com/connector_platform_oauth_redirect", "https://chatgpt.com/*", "https://evil.example/cb", "https://chatgpt.com/connector/oauth/abc"]) {
  cek(`ditolak: ${u}`, validateRedirectUris([u]).valid === false);
}
cek("campuran sah+asing ditolak seluruhnya", validateRedirectUris([stable, "https://evil.example/cb"]).valid === false);
const list = allowedRedirectUris();
cek("tidak ada wildcard di allowlist", list.every((u) => !u.includes("*")), `${list.length} entri`);
NODE
ok "allowlist di container: callback stabil diterima, varian mirip/wildcard ditolak, callback Claude utuh"
# Permintaan otorisasi dengan client_id palsu + callback stabil: HARUS ditolak di halaman kita (400), tidak me-redirect, dan tidak menulis apa pun.
AU="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 -G "${PUBLIC_URL}/oauth/authorize" --data-urlencode "response_type=code" --data-urlencode "client_id=klien-tidak-ada-verifikasi-rilis" --data-urlencode "redirect_uri=${STABLE_CB}" --data-urlencode "code_challenge=x" --data-urlencode "code_challenge_method=S256" --data-urlencode "resource=${PUBLIC_URL}/mcp-chatgpt")"
[ "$AU" = "400 " ] || die "authorize dengan client palsu -> '${AU}' (harus 400 tanpa redirect)"
ok "authorize dengan client_id palsu -> 400 tanpa redirect"
REG="$(curl -s -o /dev/null -w '%{http_code}' -X POST --max-time 15 -H 'Content-Type: application/json' -d '{"redirect_uris":["https://evil.example/cb"]}' "${PUBLIC_URL}/oauth/register")"
[ "$REG" = "400" ] || die "register dengan URI asing bukan 400 (${REG})"
ok "register dengan URI asing -> 400 (tidak menulis)"

sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
MIG_SESUDAH="$(dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null" </dev/null)"
[ "$MIG_SESUDAH" = "$MIG_SEBELUM" ] || die "jumlah migrasi berubah (${MIG_SEBELUM} -> ${MIG_SESUDAH}) padahal rilis ini tanpa migrasi"
ok "migrasi terpasang tetap ${MIG_SESUDAH} (tanpa migrasi)"
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
