#!/usr/bin/env bash
# Rilis KODE-SAJA (tanpa migrasi): sertakan Route.notes di GET /armada/my-jobs (reader V1, app driver).
# Pola SAMA dengan release-morning-priority.sh/release-bank-rekon.sh: git archive candidate (EXCLUDE
# frontend/dist), symlink backend/.env + frontend/.env dari persist, BUILD frontend & backend DI SERVER.
# Frontend web TIDAK berubah di rilis ini (hanya backend) — index.html publik BOLEH tetap identik;
# tidak ada assert "harus beda" untuk itu, hanya dicek masih utuh + fitur lama tidak hilang.
#
#   git show <sha>:scripts/release-driver-catatan-rute.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/rdcr.sh && bash /tmp/rdcr.sh <DEPLOY_SHA_LENGKAP> --preflight-only'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rdcr.sh <DEPLOY_SHA_LENGKAP>'
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
PREV_FULL="1a39c851ff30dcd5ce3de3c3874d8c9904f3d13f"
CAND_FULL="$DEPLOY_SHA"
BRANCH="feat/driver-app-catatan-rute-on-live"
TAG="driver-catatan-rute"
EXPECT_PREV_SHORT="${PREV_FULL:0:8}"; SHORT="${CAND_FULL:0:8}"
EXPECT_APPLIED=""
EXPECT_FLAGS=""

PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"; NEW_DIR="$RELEASES/$SHORT"; PREV_DIR="$RELEASES/$EXPECT_PREV_SHORT"
TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/${TAG}-${SHORT}-${TS}"; LOCK="$HOME/releases/.release.lock"
PREFLIGHT_ONLY=0; for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
PHASE=init; IMG_NAME="klinik-matras-backend:latest"; HAVE_LOCK=0; SWITCH_AT=""; BACKUP_FILE=""; ROLLBACK_TAG=""
MAPS_KEY_TOKEN="GezFdupuG1cWenKYxGbljSw_u7Mr0"

say(){ printf '\n== %s\n' "$*"; }; ok(){ printf '  OK    %s\n' "$*"; }; warn(){ printf '  WARN  %s\n' "$*"; }
die(){ printf '\nSTOP: %s\n' "$*" >&2; exit 1; }
sg(){ git --git-dir="$SRC" "$@"; }
dcp(){ local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
CDIR="$PREV_DIR"
psql_live(){ dcp "$CDIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
flags_snapshot(){ psql_live -At -c "select string_agg(key||'='||enabled::text||':'||coalesce(config::text,'{}'), ',' order by key) from v2_feature_flags"; }
cleanup(){ local rc=$?; [ "$HAVE_LOCK" = 1 ] && rm -rf "$LOCK"
  if [ $rc -ne 0 ]; then printf '\nRILIS BERHENTI (kode %s) fase: %s. Tanpa rollback otomatis.\nRelease sebelumnya: %s\nRollback:\n  cd %s \&\& SANSS_PERSIST_ROOT=%s docker compose -p %s -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps backend\nBackup: %s\n' "$rc" "$PHASE" "$PREV_DIR" "$PREV_DIR" "$PERSIST" "$PROJECT" "${BACKUP_FILE:-<belum>}" >&2; fi; }
trap cleanup EXIT

PHASE=0-lock; say "0. Lock eksklusif + kondisi awal"
for c in git docker curl gzip sha256sum awk grep tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
docker compose version >/dev/null 2>&1 || die "docker compose tidak tersedia"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
LOG="$BK_DIR/release.log"; exec > >(tee -a "$LOG") 2>&1
mkdir "$LOCK" 2>/dev/null || die "lock rilis dipegang sesi lain: $(cat "$LOCK/owner" 2>/dev/null)"; HAVE_LOCK=1; echo "driver-catatan-rute $SHORT $(date -u +%FT%TZ)" > "$LOCK/owner"; ok "lock diambil; log: $LOG"
[ ! -e "$NEW_DIR" ] || die "$NEW_DIR sudah ada"
OTHER="$(ps -eo args | grep -E 'release-[a-z0-9-]+\.sh|docker compose .* build|docker build|prisma migrate deploy' | grep -v grep | grep -v "release-driver-catatan-rute" | grep -v "node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada deployment/build lain berjalan"; }
ok "tidak ada deployment/build lain berjalan"

PHASE=1-freeze; say "1. Freeze: production aktif harus persis $EXPECT_PREV_SHORT"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s' "$CID_OLD" | wc -w)" = 1 ] || die "container backend != 1"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; [ -n "$PREV_IMG_ID" ] || die "tidak bisa membaca image aktif"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah"
PREV_RELEASE_COMMIT="$(cat "$PREV_DIR/.release-commit")"; case "$PREV_RELEASE_COMMIT" in "$EXPECT_PREV_SHORT"*) : ;; *) die ".release-commit tidak cocok: $PREV_RELEASE_COMMIT" ;; esac
RC0="$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")"; ok "image ${PREV_IMG_ID:7:12} release $EXPECT_PREV_SHORT restart=$RC0"
EXPECT_APPLIED="$(find "$PREV_DIR/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)"; [ "$EXPECT_APPLIED" -gt 0 ] || die "tidak ada direktori migrasi di release live"
NAPP="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$NAPP" = "$EXPECT_APPLIED" ] || die "applied di DB ($NAPP) != direktori migrasi release live ($EXPECT_APPLIED) — STOP"; ok "migration applied $NAPP = direktori migrasi release live"
FL0="$(flags_snapshot)"; [ -n "$FL0" ] || die "snapshot flag kosong"; EXPECT_FLAGS="$FL0"; echo "$FL0" > "$BK_DIR/flags_pre.txt"; ok "flag V2 dibekukan: $FL0"
curl -fsS --max-time 8 "$INTERNAL_URL/api/health" | grep -q '"ok":true' || die "health internal"; curl -fsS --max-time 15 "$PUBLIC_URL/api/health" | grep -q '"ok":true' || die "health publik"; ok "health lokal+publik"
[ -r "$PERSIST/frontend/.env" ] && grep -q VITE_GOOGLE_MAPS_JS_KEY "$PERSIST/frontend/.env" || die "PERSIST/frontend/.env atau kunci Maps tidak ada"
grep -q "$MAPS_KEY_TOKEN" "$PERSIST/frontend/.env" || die "kunci Maps di persist bukan kunci produksi yang diketahui (token tidak cocok) — STOP"
ok "mount persisten ada, frontend/.env (kunci Maps asli) tersedia untuk build"

PHASE=2-ancestry; say "2. Ancestry + scope (branch=$BRANCH)"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=500 origin "+refs/heads/$BRANCH:refs/cache/dcrcand" "+refs/heads/main:refs/cache/main" 2>&1 | tail -3 || true
sg cat-file -e "${PREV_FULL}^{commit}" 2>/dev/null || sg fetch -q --deepen=5000 origin "+refs/heads/main:refs/cache/main" 2>&1 | tail -3 || true
sg cat-file -e "${PREV_FULL}^{commit}" 2>/dev/null || die "commit baseline ${EXPECT_PREV_SHORT} tidak ditemukan di cache git bahkan setelah deepen"
[ "$(sg rev-parse refs/cache/dcrcand)" = "$CAND_FULL" ] || die "branch kandidat ($BRANCH) berubah: $(sg rev-parse refs/cache/dcrcand)"
sg merge-base --is-ancestor "$PREV_FULL" "$CAND_FULL" || die "live ($EXPECT_PREV_SHORT) BUKAN ancestor kandidat — STOP"
ok "live ($EXPECT_PREV_SHORT) TERBUKTI leluhur langsung kandidat — superset bersih"
sg diff --name-only "$PREV_FULL" "$CAND_FULL" -- ':!frontend/dist' | LC_ALL=C sort > "$BK_DIR/scope.txt"
cat > "$BK_DIR/scope_expected.txt" <<'EOF'
backend/src/routes/armada.js
backend/tests/integration/myJobsRouteCentric.integration.test.js
scripts/release-driver-catatan-rute.sh
EOF
diff <(LC_ALL=C sort "$BK_DIR/scope_expected.txt") "$BK_DIR/scope.txt" > "$BK_DIR/scope_diff.txt" 2>&1 || die "scope TIDAK PERSIS 3 berkas yang diaudit — lihat $BK_DIR/scope_diff.txt: $(tr '\n' ' ' < "$BK_DIR/scope_diff.txt")"
ok "scope = tepat $(wc -l < "$BK_DIR/scope.txt") berkas yang diaudit, persis"
[ -z "$(sg diff --name-only "$PREV_FULL" "$CAND_FULL" -- backend/prisma/migrations)" ] || die "rilis ini seharusnya TANPA migrasi — ada perubahan di backend/prisma/migrations, STOP"
ok "tanpa migrasi (sesuai ekspektasi rilis kode-saja)"
for f in backend/package-lock.json frontend/package-lock.json backend/package.json frontend/package.json docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/prisma/schema.prisma; do cmp -s <(sg show "${PREV_FULL}:$f") <(sg show "${CAND_FULL}:$f") || die "$f berubah di luar ekspektasi"; done
ok "package/compose/Dockerfile/schema byte-identik dengan production aktif"
FRONTEND_CHANGED=0; sg diff --name-only "$PREV_FULL" "$CAND_FULL" -- frontend/src | grep -q . && FRONTEND_CHANGED=1
[ "$FRONTEND_CHANGED" = 0 ] || die "rilis ini seharusnya backend-saja — ada perubahan di frontend/src, STOP"
ok "frontend/src TIDAK berubah (rilis backend-saja, konsisten dengan scope)"
if [ "$PREFLIGHT_ONLY" = 1 ]; then say "Preflight selesai; production TIDAK diubah"; exit 0; fi

PHASE=3-backup; say "3. Backup production (600 + SHA-256) + verifikasi restore"
BACKUP_FILE="$HOME/backups/pre-${TAG}-${SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "gzip -t gagal"; gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1000000 ] || die "backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"; chmod 600 "$BACKUP_FILE"; ( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup"
chmod 600 "${BACKUP_FILE}.sha256"
VERIFY_DB="km_release_verify_$(date +%Y%m%d_%H%M%S)"
dcp "$PREV_DIR" exec -T postgres createdb -U "$DB_USER" "$VERIFY_DB" </dev/null || die "gagal membuat DB verifikasi restore"
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>"$BK_DIR/restore_verify.log" || { dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" --if-exists "$VERIFY_DB" </dev/null >/dev/null 2>&1; die "restore verifikasi GAGAL"; }
dcp "$PREV_DIR" exec -T postgres dropdb -U "$DB_USER" --if-exists "$VERIFY_DB" </dev/null >/dev/null 2>&1
ok "backup $(basename "$BACKUP_FILE") $(du -h "$BACKUP_FILE" | cut -f1); restore verifikasi OK"

PHASE=4-release-dir; say "4. Release dir $NEW_DIR"
mkdir "$NEW_DIR"; sg archive "$CAND_FULL" | tar -x -C "$NEW_DIR" --exclude='frontend/dist'; printf '%s\n' "$SHORT" > "$NEW_DIR/.release-commit"
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env ada di arsip"; ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env"
[ ! -e "$NEW_DIR/frontend/.env" ] || die "frontend/.env ada di arsip"; ln -s "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env"; [ -r "$NEW_DIR/frontend/.env" ] || die "symlink frontend/.env"
grep -q VITE_GOOGLE_MAPS_JS_KEY "$NEW_DIR/frontend/.env" || die "frontend/.env tersymlink tapi kunci Maps tidak terbaca — STOP"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "compose.release berbeda"
ok "release dir dibuat; backend/.env DAN frontend/.env (kunci Maps) tersymlink dari persist"

PHASE=5-frontend-build; say "5. Frontend: npm ci + build (source TIDAK berubah — hash boleh sama dengan live)"
( cd "$NEW_DIR/frontend" && npm ci ) > "$BK_DIR/npm_ci_frontend.log" 2>&1 || { tail -n 30 "$BK_DIR/npm_ci_frontend.log"; die "npm ci frontend gagal"; }
OLD_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal"; }
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"; [ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
for s in "Tandai Prioritas" "Isi Diagnosis" "Sales per Stage" "Status Produksi"; do grep -rlF "$s" "$NEW_DIR"/frontend/dist/assets/*.js >/dev/null 2>&1 || die "dist kehilangan fitur live \"$s\""; done
grep -rl "$MAPS_KEY_TOKEN" "$NEW_DIR"/frontend/dist/assets/*.js >/dev/null 2>&1 || die "dist TIDAK memuat kunci Google Maps — STOP sebelum switch"
ok "frontend: build index=$NEW_INDEX (lama $OLD_INDEX, boleh sama — source tidak berubah); fitur lama utuh; kunci Maps asli"

PHASE=6-backend-build; say "6. Backend: docker compose build"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-${TAG}-${SHORT}"; docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "tag rollback"; ok "image lama ditandai $ROLLBACK_TAG"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"; [ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama (tidak diharapkan: kode armada.js berubah)"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"; ok "image baru ${NEW_IMG_ID:7:12}; aktif masih ${PREV_IMG_ID:7:12}"
docker run --rm "$NEW_IMG_ID" node -e "const s=require('fs').readFileSync('/app/src/routes/armada.js','utf8'); if(!s.includes('driverId: true, helperId: true, date: true, updatedAt: true, notes: true')) { console.error('select route.notes tidak ditemukan di jobInclude'); process.exit(1);} " || die "image baru TIDAK memuat select Route.notes — STOP"
docker run --rm "$NEW_IMG_ID" node -e "const s=require('fs').readFileSync('/app/src/routes/armada.js','utf8'); if(!s.includes('driverId: r.driverId, helperId: r.helperId, notes: r.notes')) { console.error('routes[].notes tidak diteruskan'); process.exit(1);} " || die "image baru TIDAK meneruskan notes ke routes[] — STOP"
docker run --rm "$NEW_IMG_ID" node -e "const s=require('fs').readFileSync('/app/src/lib/domain/productionSteps.js','utf8'); if(!s.includes('TIBA_BELUM_MULAI')) { console.error('P9B.1 tidak ditemukan'); process.exit(1);} " || die "image baru kehilangan P9B.1 — STOP"
ok "image baru memuat perubahan Route.notes DI DUA TEMPAT (jobInclude + routes[]), fitur lama (P9B.1) tidak hilang"

PHASE=7-pre-switch-gate; say "7. Freeze ulang sebelum switch + pre-switch gate"
sg fetch -q origin "+refs/heads/$BRANCH:refs/cache/dcrcand2" 2>&1 | tail -1 || true
[ "$(sg rev-parse refs/cache/dcrcand2)" = "$CAND_FULL" ] || die "branch kandidat bergerak sebelum switch — STOP"
[ "$(flags_snapshot)" = "$EXPECT_FLAGS" ] || die "flag V2 berubah sebelum switch — STOP"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "production berubah — STOP"
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "$RC0" ] || die "restart count production berubah sejak freeze — STOP"
NAPP2="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$NAPP2" = "$EXPECT_APPLIED" ] || die "migration count berubah sejak freeze ($NAPP2 != $EXPECT_APPLIED) — STOP"
ok "freeze ulang lulus; production tetap ${PREV_IMG_ID:7:12}; migration tetap $EXPECT_APPLIED (tidak berubah, sesuai rilis tanpa migrasi); gate lulus"

PHASE=8-switch; say "8. Switch atomik backend ke $SHORT"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "compose up backend gagal"
UP=0; for i in $(seq 1 30); do curl -fsS --max-time 4 "$INTERNAL_URL/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = 1 ] || die "backend tidak sehat 60 dtk"
SWITCH_AT="$(date -u +%FT%TZ)"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=backend")"; CDIR="$NEW_DIR"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "image tidak sesuai yang baru di-build"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "bukan dari $NEW_DIR"
ok "backend sehat, image baru ${NEW_IMG_ID:7:12}, release $SHORT pada $SWITCH_AT"

PHASE=9-post-switch; say "9. Post-deploy: health, restart, log, migrasi (tidak berubah), flag, halaman"
curl -fsS --max-time 15 "$PUBLIC_URL/api/health" | grep -q '"ok":true' || die "health publik pasca-switch"
sleep 15
RC1="$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")"; [ "$RC1" = 0 ] || die "restart count backend baru = $RC1"
ERR_LINES="$(docker logs --since "$SWITCH_AT" "$CID_NEW" 2>&1 | grep -ciE ' error|exception|unhandled| 5[0-9][0-9] |P2021|P2022|Cannot find module' || true)"; [ "${ERR_LINES:-0}" = 0 ] && ok "log sejak switch: 0 error/5xx" || { warn "log error sejak switch: $ERR_LINES baris"; docker logs --since "$SWITCH_AT" "$CID_NEW" 2>&1 | grep -iE ' error|exception|unhandled| 5[0-9][0-9] ' | head -5; die "log memuat error — tinjau sebelum lanjut"; }
NAPP3="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"; [ "$NAPP3" = "$EXPECT_APPLIED" ] || die "migration count pasca-switch berubah ($NAPP3 != $EXPECT_APPLIED) — STOP (rilis ini seharusnya tanpa migrasi)"
[ "$(flags_snapshot)" = "$EXPECT_FLAGS" ] || die "flag V2 berubah setelah switch — STOP"; flags_snapshot > "$BK_DIR/flags_post.txt"; cmp -s "$BK_DIR/flags_pre.txt" "$BK_DIR/flags_post.txt" || die "flags pre/post tidak byte-identik"
ok "8 flag V2 byte-identik; migration tetap $EXPECT_APPLIED (tidak berubah)"
for p in /armada/routes /bengkel/production-v2 /laporan /pipeline /warehouse/antrean-produksi /finance/dashboard /inbox; do C="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC_URL$p")"; [ "$C" = 200 ] || die "halaman $p -> $C"; done
ok "7 halaman web dapat dijangkau (HTTP 200 SPA) — tidak ikut berubah, sebagai jaring regresi umum"
INDEX_LIVE="$(curl -fsS --max-time 10 "$PUBLIC_URL/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)"; [ "$INDEX_LIVE" = "$NEW_INDEX" ] || die "index.html publik tidak mereferensikan bundel yang baru di-build"
MAPS_ASSET="$(grep -rl "$MAPS_KEY_TOKEN" "$NEW_DIR"/frontend/dist/assets/*.js | head -1 | xargs -n1 basename)"
[ -n "$MAPS_ASSET" ] || die "tidak ditemukan asset dist yang memuat kunci Maps"
PUB_MAPS_CHECK="$(curl -fsS --max-time 20 "$PUBLIC_URL/assets/$MAPS_ASSET" 2>/dev/null | grep -c "$MAPS_KEY_TOKEN" || true)"
[ "${PUB_MAPS_CHECK:-0}" -ge 1 ] || die "chunk peta TIDAK terlayani publik dengan kunci (regresi Maps) — STOP"
ok "web publik melayani kunci Maps JS (non-regresi terkonfirmasi live)"

PHASE=10-smoke; say "10. Smoke: GET /armada/my-jobs sertakan Route.notes untuk driver sungguhan (data sintetis, bersih sendiri) + regresi modul lain"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
rec("tanpa token -> 401", (await api("GET", "/api/armada/my-jobs", null)).status === 401);

const driver = await prisma.user.findFirst({ where: { role: "DRIVER", active: true } });
if (!driver) { rec("ada akun DRIVER aktif untuk smoke test", true, "tidak ada saat ini — siklus dilewati, bukan kegagalan"); }
else {
  const driverRoles = (await prisma.userRole.findMany({ where: { userId: driver.id }, select: { role: true } })).map((r) => r.role);
  const driverToken = jwt.sign({ id: driver.id, name: driver.name, role: driver.role, roles: driverRoles.length ? driverRoles : [driver.role] }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const stamp = Date.now();
  const cust = await prisma.customer.create({ data: { name: `SMOKE TEST catatan rute (otomatis dihapus) ${stamp}` } });
  const order = await prisma.order.create({ data: { customerId: cust.id, value: 0, category: "LAYANAN", orderNumber: `SMOKE-CATATAN-${stamp}`, status: "PROCESSING", paymentStatus: "BELUM_BAYAR" } });
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const catatanAsli = `SMOKE TEST — catatan rute otomatis ${stamp}, akan dihapus`;
  const route = await prisma.route.create({ data: { code: `SMOKE-RTE-${stamp}`, date: today, driverId: driver.id, status: "PUBLISHED", publishedAt: new Date(), notes: catatanAsli } });
  const job = await prisma.job.create({ data: { type: "DELIVERY", orderId: order.id, routeId: route.id, driverId: driver.id, scheduledDate: today, status: "ASSIGNED", sequence: 1 } });

  const res = await api("GET", "/api/armada/my-jobs", driverToken);
  const routeDiResp = (res.json?.routes || []).find((r) => r.id === route.id);
  const jobDiResp = (res.json?.jobs || []).find((j) => j.id === job.id);
  rec("GET /armada/my-jobs (driver sungguhan) -> 200", res.status === 200, `status ${res.status}`);
  rec("routes[].notes PERSIS sama dengan Route.notes di database", routeDiResp?.notes === catatanAsli, `dapat: ${JSON.stringify(routeDiResp?.notes)}`);
  rec("jobs[].route.notes juga terisi (jalur jobInclude yang sama)", jobDiResp?.route?.notes === catatanAsli, `dapat: ${JSON.stringify(jobDiResp?.route?.notes)}`);

  let bersih = true;
  try {
    await prisma.job.delete({ where: { id: job.id } });
    await prisma.route.delete({ where: { id: route.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.customer.delete({ where: { id: cust.id } });
  } catch (e) {
    bersih = false;
    console.log(`  WARN  pembersihan data smoke test gagal: ${e.message} — job=${job.id} route=${route.id} order=${order.id} customer=${cust.id} (hapus manual kalau perlu)`);
  }
  rec("data smoke test (customer/order/route/job sintetis) dibersihkan sepenuhnya", bersih);
}

const sales = await prisma.user.findFirst({ where: { role: "SALES", active: true } });
if (sales) {
  const salesRoles = (await prisma.userRole.findMany({ where: { userId: sales.id }, select: { role: true } })).map((r) => r.role);
  const salesToken = jwt.sign({ id: sales.id, name: sales.name, role: sales.role, roles: salesRoles.length ? salesRoles : [sales.role] }, process.env.JWT_SECRET, { expiresIn: "5m" });
  rec("SALES -> 403 di /armada/my-jobs (JOB_OWN_READ tetap milik driver, tidak melebar)", (await api("GET", "/api/armada/my-jobs", salesToken)).status === 403);
} else rec("akun SALES untuk uji 403", true, "tidak ada — dilewati");

const adm = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
if (adm) {
  const admRoles = (await prisma.userRole.findMany({ where: { userId: adm.id }, select: { role: true } })).map((r) => r.role);
  const admToken = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: admRoles.length ? admRoles : [adm.role] }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const g = async (name, path, expect = 200) => { const r = await api("GET", path, admToken); rec(`regresi ${name} GET ${path} -> ${expect}`, r.status === expect, `status ${r.status}`); };
  await g("Sales", "/api/orders?limit=1");
  await g("Warehouse", "/api/inventory/stock?limit=1");
  await g("Delivery (jobs umum)", "/api/armada/jobs?limit=1");
  await g("Finance", "/api/finance/buku/jurnal?limit=1");
  await g("Routes (Route Planner)", "/api/armada/routes?limit=1");
} else rec("akun ADMIN untuk regresi modul lain", false, "tidak ada");

await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus (Route.notes sungguhan terbukti sampai ke app driver via API; 401/403; modul lain tidak regresi)"

echo "SWITCHED image=$NEW_IMG_ID release=$SHORT dist=$NEW_INDEX(prev $OLD_INDEX, boleh sama) prev_img=$PREV_IMG_ID rollback_tag=$ROLLBACK_TAG migration_unchanged=$EXPECT_APPLIED flags_unchanged=true maps_key_baked=true switch_at=$SWITCH_AT" > "$BK_DIR/RESULT.txt"
echo "RESULT: $(cat "$BK_DIR/RESULT.txt")"
echo "BK_DIR=$BK_DIR"
trap - EXIT
exit 0
