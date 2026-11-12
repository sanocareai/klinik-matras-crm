#!/usr/bin/env bash
# RILIS BACKEND + FRONTEND: AI Studio MVP 1 (workspace latih & uji agent AI "Mattress Consultant").
#   Satu migrasi ADITIF (6 tabel studio_* + 4 enum Studio*, tanpa FK ke tabel lama, tanpa perubahan data).
#   TIDAK ada jalur kirim ke customer: balasan AI hanya tampil di Playground internal. FAIL-CLOSED.
#   Kandidat dikirim lewat bundle: BUNDLE=/tmp/ais1.bundle (branch feat/ai-studio-on-257e6112).
#   tr -d '\r' < scripts/release-ai-studio.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/ais1.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/ais1.bundle bash /tmp/ais1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/ais1.bundle nohup bash /tmp/ais1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/ais1.out 2>&1 < /dev/null &'
# PRASYARAT OPERATOR (skrip ini TIDAK menulis .env): ~/klinik-matras/backend/.env memuat TEPAT satu baris
#   STUDIO_ANTHROPIC_API_KEY=<kunci organisasi yang ditautkan ke Max> (nilai tidak pernah dicetak).
#   Opsional STUDIO_MAX_COST_USD_MONTH (default 20). Kode lama mengabaikan kedua variabel ini.
# ROLLBACK: kode saja, tanpa pemulihan database (lihat instruksi saat berhenti). Tabel studio_* diabaikan kode lama.
# Pola dan pagar = scripts/release-task-meeting-sso.sh (live cce91dd7 → 257e6112). Kelonggaran KHUSUS rilis ini:
#   - schema.prisma: hanya baris tambahan yang sidik jarinya dipin (SCHEMA_ADD_SHA); satu baris dihapus pun = berhenti.
#   - migrasi: tepat SATU berkas dengan sha256 dipin + pemindai pernyataan (allow-list per pernyataan) + uji negatif pemindai.
#   - skill bawaan: 26 berkas .md di backend/src/services/agentStudio/skill-bawaan (tree git dipin; bukan kode yang dieksekusi).
#   - frontend/dist boleh berbeda di git: dist tidak pernah diambil dari git (archive mengecualikannya; dibangun ulang di sini).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/ai-studio-on-257e6112}"
EXPECT_BASE="257e611248c86d21c65d6873445d99f5cd5da7a0"
[ "$BASE_SHA" = "$EXPECT_BASE" ] || { echo "STOP: skrip ini diaudit untuk baseline ${EXPECT_BASE:0:8}, bukan ${BASE_SHA:0:8}" >&2; exit 1; }
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis (+ skill bawaan .md, + frontend/dist, lihat kepala berkas).
ALLOWED_RE='^(backend/prisma/schema\.prisma|backend/prisma/migrations/20270101090000_add_ai_studio/migration\.sql|backend/src/constants/permissions\.js|backend/src/index\.js|backend/src/routes/studio\.js|backend/src/services/agentStudio/checks\.js|backend/src/services/agentStudio/runtime\.js|backend/src/services/agentStudio/skillLoader\.js|backend/src/services/agentStudio/skill-bawaan/sano-mattress-consultant/[A-Za-z0-9._/-]+\.md|backend/tests/agentStudio\.test\.js|backend/tests/authorize\.test\.js|docs/migration-log/ai-studio-mvp1\.md|frontend/src/api\.js|frontend/src/components/Layout\.jsx|frontend/src/components/WorkspaceSwitcher\.jsx|frontend/src/pages/Portal\.jsx|frontend/src/pages/aiStudio/AiStudio\.jsx|frontend/src/routes/pageRegistry\.jsx|frontend/dist/.+|scripts/release-ai-studio\.sh)$'
BACKEND_SRC_EXPECT="backend/src/constants/permissions.js backend/src/index.js backend/src/routes/studio.js backend/src/services/agentStudio/checks.js backend/src/services/agentStudio/runtime.js backend/src/services/agentStudio/skillLoader.js"
SKILL_DIR="backend/src/services/agentStudio/skill-bawaan"
SKILL_TREE_EXPECT="02e7ab68ff6f0182f055d0332eeb7dd4f3864836"; SKILL_N_EXPECT="26"
MIG_NAME="20270101090000_add_ai_studio"
MIG1="backend/prisma/migrations/${MIG_NAME}/migration.sql"
MIG1_SHA="d7ef88cbb1473e7e7d0639ac766c5114e1b02865d0371ae32888d402e13f4371"
# sha256 dari baris '+' pada `git diff -U0 BASE DEPLOY -- backend/prisma/schema.prisma` (tanpa \r, tanpa header +++).
SCHEMA_ADD_SHA="317f0b0da5435cef1f616eb648cb88884d6aaac90c58cae212e6fae03d1cef4c"
STUDIO_TABLES="studio_agents studio_feedback studio_messages studio_sessions studio_skill_versions studio_test_cases"
STUDIO_ENUMS="StudioFeedbackStatus StudioMessageRole StudioRating StudioVersionStatus"
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
for a in "$@"; do [ "$a" = "--preflight-only" ] && PREFLIGHT_ONLY=1; done
TS="$(date +%Y%m%d_%H%M%S)"
BK_DIR="$HOME/release-backups/ai-studio-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  \033[33mPERHATIAN\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }

# Pemindai migrasi: setiap pernyataan (dipisah ';', komentar dibuang) HARUS cocok persis satu pola yang diizinkan.
# Hanya objek studio_*/Studio*; FK hanya antar-tabel studio_*. Mencetak jumlah pernyataan; exit != 0 bila ada yang asing.
scan_migrations() {
  awk '
    { sub(/--.*/, "") } { buf = buf " " $0 }
    END {
      n = split(buf, st, ";"); c = 0
      for (i = 1; i <= n; i++) {
        s = st[i]; gsub(/[ \t\r\n]+/, " ", s); sub(/^ /, "", s); sub(/ $/, "", s)
        if (s == "") continue
        c++
        if (s ~ /^CREATE TYPE "Studio[A-Za-z]+" AS ENUM \(('"'"'[A-Z_]+'"'"'(, )?)+\)$/) continue
        if (s ~ /^CREATE TABLE "studio_[a-z_]+" \(/ && s !~ /REFERENCES|DEFAULT nextval|TRIGGER/) continue
        if (s ~ /^CREATE (UNIQUE )?INDEX "studio_[A-Za-z_]+" ON "studio_[a-z_]+" ?\([" A-Za-z_,]+\)$/) continue
        if (s ~ /^ALTER TABLE "studio_[a-z_]+" ADD CONSTRAINT "studio_[A-Za-z_]+_fkey" FOREIGN KEY \("[A-Za-z]+"\) REFERENCES "studio_[a-z_]+" ?\("id"\) ON DELETE CASCADE ON UPDATE CASCADE$/) continue
        print "PERNYATAAN ASING: " s > "/dev/stderr"; bad = 1
      }
      if (c == 0) bad = 1
      print c; exit bad
    }'
}
SCAN_EXPECT="26"

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
Migrasi TIDAK dibalik: tabel studio_* dan enum Studio* aditif, tanpa FK ke tabel lama, diabaikan kode lama.
Bila perlu dibuang (setelah rollback, hanya atas keputusan Owner): lihat baris Rollback di ${MIG1}.
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
[ ! -e "$HOME/releases/DEPLOY_LOCK" ] || die "kunci ${HOME}/releases/DEPLOY_LOCK ada — sesi rilis lain sedang deploy"
exec 9>/tmp/release-ai-studio.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "ais1\|release-ai-studio\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
# Pemindai migrasi wajib menolak mutan sebelum dipercaya.
for m in 'DROP TABLE "studio_agents";' 'ALTER TABLE "User" ADD COLUMN "x" TEXT;' 'UPDATE "User" SET role = '"'"'ADMIN'"'"';' 'DELETE FROM user_roles;' \
  'CREATE INDEX "studio_x_idx" ON "User"("id");' 'GRANT ALL ON "studio_agents" TO public;' 'CREATE TYPE "Role2" AS ENUM ('"'"'A'"'"');' \
  'ALTER TABLE "studio_sessions" ADD CONSTRAINT "studio_sessions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;' \
  'CREATE TABLE "studio_x" ("id" TEXT NOT NULL, "u" TEXT REFERENCES "User"("id"));' 'ALTER TYPE "Role" ADD VALUE IF NOT EXISTS '"'"'X'"'"';'; do
  if printf '%s\n' "$m" | scan_migrations >/dev/null 2>&1; then die "[skrip] pemindai migrasi MENERIMA mutan: $m"; fi
done
printf '' | scan_migrations >/dev/null 2>&1 && die "[skrip] pemindai migrasi menerima masukan kosong"
ok "pemindai migrasi menolak 11 mutan"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"
# Kunci AI wajib ada (nilai tidak pernah dicetak) — tanpa ini Studio jatuh ke kunci BYOK lama yang bukan organisasi Max.
[ "$(tr -d '\r' < "$PERSIST/backend/.env" | grep -c '^STUDIO_ANTHROPIC_API_KEY=')" = "1" ] || die "backend/.env harus memuat TEPAT satu baris STUDIO_ANTHROPIC_API_KEY"
[ "$(tr -d '\r' < "$PERSIST/backend/.env" | grep -cE '^STUDIO_ANTHROPIC_API_KEY="?sk-ant-[A-Za-z0-9_-]{20,}"?$')" = "1" ] || die "STUDIO_ANTHROPIC_API_KEY kosong/berformat tidak dikenal (nilai tidak dicetak)"
ok "STUDIO_ANTHROPIC_API_KEY ada di env persisten (nilai tidak dicetak)"
BATAS="$(tr -d '\r' < "$PERSIST/backend/.env" | sed -n 's/^STUDIO_MAX_COST_USD_MONTH=//p' | tr -d '"' | tail -n 1)"
ok "batas biaya Studio per bulan: \$${BATAS:-20 (default)}"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, dan batas perubahan"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
[ -f "${BUNDLE:-}" ] || die "BUNDLE tidak ada"
sg fetch -q origin "+refs/heads/main:refs/remotes/origin/main" || die "git fetch main gagal"
sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" || die "fetch bundle gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "${CAND_BRANCH} di bundle bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
sg merge-base --is-ancestor "$MAIN_SHA" "$BASE_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur baseline ${BASE_SHA:0:8} — main memuat pekerjaan yang tidak ada di release aktif"
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat — fast-forward main tidak akan mungkin"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | grep -v "^${SKILL_DIR}/" | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "daftar berkas backend/src (kode) yang berubah tidak sama dengan yang diaudit"
[ "$(sg rev-parse "${DEPLOY_SHA}:${SKILL_DIR}")" = "$SKILL_TREE_EXPECT" ] || die "isi skill bawaan berbeda dari yang diaudit"
[ "$(sg ls-tree -r --name-only "$DEPLOY_SHA" "$SKILL_DIR" | wc -l)" = "$SKILL_N_EXPECT" ] || die "jumlah berkas skill bawaan bukan ${SKILL_N_EXPECT}"
[ -z "$(sg ls-tree -r --name-only "$DEPLOY_SHA" "$SKILL_DIR" | grep -v '\.md$' || true)" ] || die "skill bawaan memuat berkas selain .md"
[ -z "$(printf '%s\n' "$CHANGED" | grep -E '(^|/)package(-lock)?\.json$|^docker-compose|Dockerfile|\.dockerignore$' || true)" ] || die "dependensi/compose/Dockerfile aplikasi berubah"
[ -z "$(sg diff "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | tr -d '\r' | grep -E '^-[^-]' || true)" ] || die "schema.prisma bukan murni penambahan"
[ "$(sg diff -U0 "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | tr -d '\r' | grep -E '^\+' | grep -v '^+++' | sha256sum | cut -d' ' -f1)" = "$SCHEMA_ADD_SHA" ] || die "tambahan schema.prisma berbeda dari yang diaudit (6 model Studio* + 4 enum)"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/migrations/' | tr '\n' ' ' | sed 's/ $//')" = "$MIG1" ] || die "migrasi kandidat bukan tepat satu berkas yang diaudit"
[ "$(sg show "${DEPLOY_SHA}:${MIG1}" | tr -d '\r' | sha256sum | cut -d' ' -f1)" = "$MIG1_SHA" ] || die "isi ${MIG1} berbeda dari yang diaudit"
SCAN="$(sg show "${DEPLOY_SHA}:${MIG1}" | tr -d '\r' | scan_migrations)" || die "pemindai migrasi menemukan pernyataan di luar allow-list"
[ "$SCAN" = "$SCAN_EXPECT" ] || die "jumlah pernyataan migrasi ${SCAN} != ${SCAN_EXPECT}"
LAST_BASE_MIG="$(sg ls-tree -d --name-only "${BASE_SHA}:backend/prisma/migrations" | LC_ALL=C sort | tail -n 1)"
[[ "$LAST_BASE_MIG" < "$MIG_NAME" ]] || die "migrasi baru tidak terurut SESUDAH migrasi terakhir baseline (${LAST_BASE_MIG})"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; origin/main (${MAIN_SHA:0:8}) leluhur keduanya; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist; backend/src = $(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w) berkas kode diaudit + ${SKILL_N_EXPECT} berkas skill .md (tree dipin); schema = tambahan yang dipin; 1 migrasi dipin, ${SCAN} pernyataan diizinkan, terurut sesudah ${LAST_BASE_MIG}"

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
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "0" ] || die "backend aktif pernah restart (RestartCount != 0) — periksa dulu"
[ -n "$(dcp "$PREV_DIR" ps -q postgres </dev/null)" ] || die "container postgres tidak berjalan"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name like '%ai_studio%'")" = "0" ] || die "produksi SUDAH punya jejak migrasi AI Studio — tidak diharapkan; periksa manual"
for t in $STUDIO_TABLES; do [ "$(psql_live -At -c "select to_regclass('public.${t}') is null")" = "t" ] || die "tabel ${t} SUDAH ada di produksi — tidak diharapkan"; done
for e in $STUDIO_ENUMS; do [ "$(psql_live -At -c "select count(*) from pg_type where typname='${e}'")" = "0" ] || die "tipe ${e} SUDAH ada di produksi — tidak diharapkan"; done
MIG_SEBELUM="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
ok "migrasi terpasang sebelum rilis = ${MIG_SEBELUM}; tidak ada jejak AI Studio di produksi"
SNAP_SQL="select 'jurnal', count(*), md5(coalesce(string_agg(e.id::text||e.status::text||e.entry_number, '|' order by e.id),'')) from fin_journal_entries e union all select 'baris_jurnal_saldo', count(*), md5(coalesce(string_agg(l.id::text||l.debit::text||l.credit::text||l.account_id::text||coalesce(l.order_id,'')||coalesce(l.cash_account_id::text,''), '|' order by l.id),'')) from fin_journal_lines l union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(t.k||t.s, '|' order by t.k),'')) from (select a.code as k, sum(l.debit-l.credit)::text as s from fin_journal_lines l join fin_accounts a on a.id=l.account_id join fin_journal_entries e on e.id=l.entry_id where e.status in ('POSTED','REVERSED') group by a.code) t union all select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text||coalesce(x.unit_cost::text,'')||x.material_id::text||x.type::text, '|' order by x.id),'')) from stock_movements x union all select 'po', count(*), md5(coalesce(string_agg(p::text, '|' order by p.id),'')) from fin_purchase_orders p union all select 'payment', count(*), md5(coalesce(string_agg(p.id::text||p.amount::text||coalesce(p.cancelled_at::text,''), '|' order by p.id),'')) from payments p union all select 'order', count(*), md5(coalesce(string_agg(o.id||o.status::text||o.\"paymentStatus\"::text||coalesce(o.paid_at::text,''), '|' order by o.id),'')) from \"Order\" o union all select 'job', count(*), md5(coalesce(string_agg(j.id::text||j.status::text||coalesce(j.route_id::text,''), '|' order by j.id),'')) from jobs j union all select 'pengguna', count(*), md5(coalesce(string_agg(u.id||u.role::text||u.active::text, '|' order by u.id),'')) from \"User\" u union all select 'user_roles', count(*), md5(coalesce(string_agg(r.user_id||r.role::text, '|' order by r.user_id, r.role),'')) from user_roles r union all select 'flag_v2', count(*), md5(coalesce(string_agg(f.key||f.enabled::text||f.config::text, '|' order by f.key),'')) from v2_feature_flags f union all select 'fin_settings', count(*), md5(coalesce(string_agg(f.key||f.value, '|' order by f.key),'')) from fin_settings f union all select 'produk', count(*), md5(coalesce(string_agg(p.id||p.name||coalesce(p.price::text,'')||p.active::text, '|' order by p.id),'')) from \"Product\" p"
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sebelum.txt" || die "snapshot sebelum gagal"
[ "$(wc -l < "$BK_DIR/snap-sebelum.txt")" -ge 13 ] || die "snapshot sebelum tidak lengkap"
ok "snapshot sebelum tersimpan ($(wc -l < "$BK_DIR/snap-sebelum.txt") kelompok): jurnal, saldo, stok, PO, Payment, order, job, pengguna, peran, flag, pengaturan, katalog produk"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 3 + 2 * 1024 * 1024 )) ] || die "ruang disk kurang (butuh 3x ukuran DB + 2 GiB)"
ok "ruang disk cukup ($(( AVAIL_KB / 1024 / 1024 )) GiB bebas)"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-ai-studio-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

PHASE="3b-restore"; say "3b. Validasi restore + migrasi pada salinan (DB produksi tidak disentuh)"
REH_DB="rehearsal_ais1_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -v ON_ERROR_STOP=1 -c "$1" </dev/null; }
for T in fin_journal_entries fin_journal_lines payments fin_accounts stock_movements jobs \"User\" user_roles \"Product\"; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$B" -le "$A" ] && [ "$(( A - B ))" -le 25 ] || { reh_drop; die "restore tidak cocok untuk $T (produksi=$A restore=$B)"; }
  [ "$A" = "$B" ] && echo "  = $T $A" || echo "  ~ $T produksi=$A restore=$B (transaksi sah masuk sesudah backup)"
done
[ "$(RPSQL "select count(*) from _prisma_migrations")" = "$(psql_live -At -c "select count(*) from _prisma_migrations")" ] || { reh_drop; die "jumlah migrasi pada restore berbeda"; }
RPSQL "select u.id||u.role::text from \"User\" u order by u.id" | sha256sum > "$BK_DIR/reh-pengguna-sebelum.sha" || { reh_drop; die "sidik jari pengguna salinan gagal"; }
RPSQL "$(sg show "${DEPLOY_SHA}:${MIG1}" | tr -d '\r' | grep -vE '^--')" || { reh_drop; die "migrasi gagal pada DB sementara"; }
for t in $STUDIO_TABLES; do [ "$(RPSQL "select count(*) from ${t}")" = "0" ] || { reh_drop; die "${t} tidak kosong pada salinan"; }; done
[ "$(RPSQL "select count(*) from pg_type where typname in ('StudioFeedbackStatus','StudioMessageRole','StudioRating','StudioVersionStatus')")" = "4" ] || { reh_drop; die "4 enum Studio* tidak terpasang pada salinan"; }
[ "$(RPSQL "select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_class r on r.oid=c.confrelid where c.contype='f' and t.relname like 'studio\_%' and r.relname not like 'studio\_%'")" = "0" ] || { reh_drop; die "ada FK dari studio_* ke tabel lama"; }
RPSQL "select u.id||u.role::text from \"User\" u order by u.id" | sha256sum | cmp -s - "$BK_DIR/reh-pengguna-sebelum.sha" || { reh_drop; die "data pengguna berubah karena migrasi pada salinan"; }
ok "migrasi diuji pada salinan backup nyata: 6 tabel studio_* kosong, 4 enum terpasang, tanpa FK ke tabel lama, data pengguna identik"
reh_drop
[ "$(psql_live -At -c "select count(*) from pg_database where datname = '${REH_DB}'")" = "0" ] || die "DB rehearsal masih tersisa"
ok "restore backup ke DB sementara berhasil; DB sementara dihapus"

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; dist dibangun baru; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/main" | cut -f1)" = "$MAIN_SHA" ] || die "origin/main bergeser selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json "${SKILL_DIR}/sano-mattress-consultant/SKILL.md"; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
ln -s "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env"; [ -r "$NEW_DIR/frontend/.env" ] || die "symlink frontend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.yml") >/dev/null || die "docker-compose.yml berbeda dari release aktif"
ok "release dir dibuat; compose identik; skill bawaan ada di dalam konteks build (bukan backend/data)"

PHASE="4b-build-frontend"; say "4b. Build frontend (dist aktif tidak disentuh)"
cari_dist() { find "$1/frontend/dist/assets" -maxdepth 1 -type f -name "*.$2" -print0 2>/dev/null | xargs -0 grep -lF -- "$3" 2>/dev/null | sed -n 1p; }
PKG_BARU="$BK_DIR/pkg-baru.json"; sg show "${DEPLOY_SHA}:frontend/package.json" > "$PKG_BARU"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package.json") <(tr -d '\r' < "$PKG_BARU"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package.json identik"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -rf "$NEW_DIR/frontend/node_modules"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "bundel baru sama dengan bundel aktif"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$MAPS_KEY" ] && [ -n "$(cari_dist "$NEW_DIR" js "$MAPS_KEY")" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
for s in "Ketik sebagai customer" "/studio/sessions"; do
  [ -z "$(cari_dist "$PREV_DIR" js "$s")" ] || die "[skrip] '${s}' SUDAH ada di dist aktif — perbaiki pembanding"
  [ -n "$(cari_dist "$NEW_DIR" js "$s")" ] || die "dist baru TIDAK memuat '${s}'"
done
for s in "hub/summary/me" "Pantauan Leader" "Lead tanpa spam" "Dibeli per pack" "drawer-deskripsi" "Catat hasil SO" "Definisi dan sumber angka" "Sumber & Link" "Kelola biaya iklan" "Iklan tidak terbaca" "Per kreatif" "Tanpa persetujuan (koreksi langsung Admin)" "Biaya kosong" "Catat dari catatan ini" "Batalkan pengajuan saya" "Dilaporkan sebagai pengajuan" "Aktif di periode" "ROAS (Booked) = nilai order"; do
  [ -n "$(cari_dist "$PREV_DIR" js "$s")" ] || die "[skrip] '${s}' tidak ada di dist aktif — perbaiki pembanding"
  [ -n "$(cari_dist "$NEW_DIR" js "$s")" ] || die "dist baru KEHILANGAN fitur: ${s}"
done
[ -n "$(cari_dist "$NEW_DIR" css ".gud-halaman")" ] || die "CSS baru KEHILANGAN .gud-halaman"
grep -qF 'addEventListener("push"' "$NEW_DIR/frontend/dist/sw.js" || die "sw.js baru KEHILANGAN penerima notifikasi push"
! grep -qF '"url":"index.html"' "$NEW_DIR/frontend/dist/sw.js" || die "sw.js baru MEMPRECACHE index.html (regresi)"
n=0; while IFS= read -r -d '' f; do b="$(basename "$f")"; [ -e "$NEW_DIR/frontend/dist/assets/$b" ] && continue; cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b" && n=$((n+1)); done < <(find "$PREV_DIR/frontend/dist/assets" -maxdepth 1 -type f -print0)
find "$NEW_DIR/frontend/dist/assets" -type f -mtime +21 -delete
[ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "bundel baru rusak setelah membawa aset lama"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); ${n} aset lama dibawa untuk tab yang masih terbuka"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-ai-studio-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
[ "$(docker run --rm --entrypoint sh "$NEW_IMG_ID" -c "ls /app/src/services/agentStudio/skill-bawaan/sano-mattress-consultant/references | wc -l")" -ge 9 ] || die "image baru TIDAK memuat skill bawaan"
ok "image baru ${NEW_IMG_ID:7:12} memuat skill bawaan; container aktif masih ${PREV_IMG_ID:7:12}"

# Smoke baca-saja: rute Studio terpasang & terkunci; tabel kosong (agent ditanam saat pertama kali dibuka Owner).
cat > "$BK_DIR/smoke.mjs" <<'NODE'
const { prisma } = await import("/app/src/db.js");
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " - " + d : ""}`); };
rec("STUDIO_ANTHROPIC_API_KEY terbaca proses (nilai tidak dicetak)", /^sk-ant-/.test(process.env.STUDIO_ANTHROPIC_API_KEY || ""));
for (const [m, p] of [["GET", "/api/studio/agents"], ["GET", "/api/studio/summary"], ["GET", "/api/studio/sessions"], ["POST", "/api/studio/sessions"], ["GET", "/api/studio/feedback"], ["GET", "/api/studio/test-cases"]]) {
  const r = await fetch(`http://127.0.0.1:4000${p}`, { method: m, headers: { "content-type": "application/json" }, body: m === "POST" ? "{}" : undefined });
  rec(`${m} ${p} tanpa token -> 401`, r.status === 401, String(r.status));
}
const li = await fetch("http://127.0.0.1:4000/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
rec("POST /api/auth/login tanpa isi -> 4xx (bukan 5xx)", li.status >= 400 && li.status < 500, String(li.status));
for (const k of ["studioAgent", "studioSkillVersion", "studioSession", "studioMessage", "studioFeedback", "studioTestCase"]) rec(`${k} kosong`, (await prisma[k].count()) === 0);
await prisma.$disconnect();
console.log(`SMOKE_HASIL mode=after fail=${fail} skip=0`);
process.exit(fail ? 1 : 0);
NODE

PHASE="7-switch"; say "7. Switch backend dan web ke release baru (SATU kali; container baru menjalankan migrasi aditif saat mulai)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW=""
for i in $(seq 1 30); do
  CAL="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
  if [ "$(printf '%s\n' "$CAL" | grep -c .)" = "1" ] && [ "$(docker inspect -f '{{.Image}}' "$CAL" 2>/dev/null)" = "$NEW_IMG_ID" ]; then CID_NEW="$CAL"; break; fi
  sleep 2
done
[ -n "$CID_NEW" ] || die "container berjalan tetapi bukan image baru"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat setelah pergantian"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru"; ok "bundel web publik = dist baru (${NEW_INDEX})"
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/api/studio/agents")" = "401" ] || die "publik /api/studio/agents tanpa token bukan 401"
ok "publik /api/studio/agents tanpa token = 401"
for f in $BACKEND_SRC_EXPECT; do
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
done
ok "$(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w) berkas backend/src di container = kandidat (byte-identik)"
for f in services/finance/journal.js services/finance/posting/orderRevenue.js middleware/authorize.js middleware/auth.js services/providers/anthropicProvider.js; do
  want="$(sg show "${BASE_SHA}:backend/src/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/src/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "${f} di container BERBEDA dari baseline"
done
ok "journal.js, orderRevenue.js, authorize.js, auth.js, anthropicProvider.js tidak berubah dari baseline"
MIG_SESUDAH="$(dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null" </dev/null)"
[ "$MIG_SESUDAH" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi tidak bertambah tepat satu (${MIG_SEBELUM} -> ${MIG_SESUDAH})"
[ "$(dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "select count(*) from _prisma_migrations where finished_at is not null and migration_name='${MIG_NAME}'" </dev/null)" = "1" ] || die "migrasi rilis tidak tercatat selesai"
ok "migrasi terpasang ${MIG_SEBELUM} -> ${MIG_SESUDAH} (${MIG_NAME} tercatat selesai)"

PHASE="8b-smoke"; say "8b. Smoke baca-saja"
dcp "$NEW_DIR" exec -T backend node --input-type=module - < "$BK_DIR/smoke.mjs" > "$BK_DIR/smoke.log" 2>&1 || { tail -n 60 "$BK_DIR/smoke.log"; die "smoke test GAGAL"; }
cat "$BK_DIR/smoke.log"
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL mode=after fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke tidak mencetak ringkasan SMOKE_HASIL yang lulus"
if [ "$SMOKE_SKIP" != "0" ]; then warn "smoke lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat ${BK_DIR}/smoke.log"; else ok "smoke test lulus tanpa SKIP"; fi

PHASE="8c-snapshot"; say "8c. Snapshot data sebelum vs sesudah"
sleep 5
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sesudah.txt" || die "snapshot sesudah gagal"
if cmp -s "$BK_DIR/snap-sebelum.txt" "$BK_DIR/snap-sesudah.txt"; then ok "SELURUH snapshot IDENTIK"; else
  echo "  INFO  snapshot berbeda — rincian (transaksi pengguna sah di sela rilis harus tampak sebagai penambahan):"; diff "$BK_DIR/snap-sebelum.txt" "$BK_DIR/snap-sesudah.txt" || true
  for k in flag_v2 fin_settings po user_roles produk; do
    [ "$(awk -F'|' -v k="$k" '$1==k' "$BK_DIR/snap-sebelum.txt")" = "$(awk -F'|' -v k="$k" '$1==k' "$BK_DIR/snap-sesudah.txt")" ] || die "$k BERUBAH selama rilis (flag/pengaturan/PO/peran/katalog tidak boleh berubah)"
  done
  while IFS='|' read -r kk nn _; do
    [ "$(awk -F'|' -v k="$kk" '$1==k{print $2}' "$BK_DIR/snap-sesudah.txt")" -ge "$nn" ] || die "jumlah baris $kk BERKURANG selama rilis"
  done < "$BK_DIR/snap-sebelum.txt"
  ok "flag, pengaturan, PO, peran, dan katalog identik; selisih lain hanya penambahan (tercatat di log)"
fi
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
LOGERR="$(docker logs --since 5m "$CID_NEW" 2>&1 | grep -ciE 'unhandled|uncaught|Cannot find module|SyntaxError|ENOENT.*skill' || true)"
[ "${LOGERR:-0}" = "0" ] || { docker logs --since 5m "$CID_NEW" 2>&1 | grep -iE 'unhandled|uncaught|Cannot find module|SyntaxError|ENOENT' | tail -n 10; die "log backend 5 menit terakhir memuat galat fatal (${LOGERR})"; }
ok "log backend 5 menit terakhir bersih"

trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. AI Studio: buka ${PUBLIC_URL}/ai-studio sebagai Owner (agent pertama ditanam saat dibuka). Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
