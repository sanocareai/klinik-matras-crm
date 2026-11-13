#!/usr/bin/env bash
# RILIS BACKEND + WEB "AI Studio MVP 2 — Copilot Inbox" (aic2) — keputusan Owner 13–14 Nov 2026 (docs/AI-STUDIO-MVP2-COPILOT.md).
#   Backend: skill bawaan + mode copilot + sinkron skill bawaan → versi LIVE baru, perakit konteks, endpoint /api/studio/copilot/*.
#   Web: panel "Saran AI" (Copilot) di Inbox untuk user pilot (ADMIN/OWNER; non-pilot tetap Saran AI lama) + AI Studio → Copilot Inbox.
#   Satu migrasi ADITIF: tabel studio_copilot_drafts + enum StudioDraftOutcome (tanpa FK, tanpa ubah tabel lama, tanpa tulis data).
#   Copilot TIDAK PERNAH mengirim pesan / memanggil WAHA: draft hanya tampil ke sales; kirim tetap lewat jalur Inbox yang ada.
# Di atas live 12536621 (rpu1). Kerangka = release-profil-unit.sh (rpu1) + bagian migrasi dari release-ai-studio.sh (ais1).
# Kandidat lewat bundle (tanpa push GitHub):
#   git bundle create /tmp/aic2.bundle 125366219d607cf392cd6a29712d89ef9f09b6bf..feat/ai-studio-copilot-on-12536621
#   scp /tmp/aic2.bundle ubuntu@43.133.152.6:/tmp/ ; tr -d '\r' < scripts/release-ai-studio-copilot.sh | ssh ubuntu@43.133.152.6 'cat > /tmp/aic2.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/aic2.bundle bash /tmp/aic2.sh <DEPLOY_SHA> <BASE_SHA> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/aic2.bundle bash /tmp/aic2.sh <DEPLOY_SHA> <BASE_SHA> --build-only'       # + backup, uji migrasi di salinan, build web+image; TANPA switch
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/aic2.bundle nohup bash /tmp/aic2.sh <DEPLOY_SHA> <BASE_SHA> > /tmp/aic2.out 2>&1 < /dev/null &'   # rilis penuh
#   ssh ubuntu@43.133.152.6 'bash /tmp/aic2.sh <DEPLOY_SHA> <BASE_SHA> --rollback'   # kembali ke folder + image baseline (tabel aditif dibiarkan; kode lama mengabaikannya)
# Prasyarat (sudah ada sejak ais1, TIDAK ditulis skrip): backend/.env memuat tepat satu STUDIO_ANTHROPIC_API_KEY. Opsional STUDIO_COPILOT_DAILY_USD (default 3).
# Efek pertama kali AI Studio dibuka sesudah rilis: skill LIVE v1 (dari folder) diarsipkan dan v2 "Sinkron skill bawaan (tanggal)" dibuat LIVE (perilaku kode, bukan skrip).
set -Eeuo pipefail
umask 077
DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ && "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen harus DEPLOY_SHA BASE_SHA 40 karakter" >&2; exit 1; }
MODE=release; for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --build-only) MODE=buildonly;; --rollback) MODE=rollback;; esac; done
EXPECT_BASE="125366219d607cf392cd6a29712d89ef9f09b6bf"
[ "$BASE_SHA" = "$EXPECT_BASE" ] || { echo "STOP: skrip ini diaudit untuk baseline ${EXPECT_BASE:0:8}, bukan ${BASE_SHA:0:8}" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/ai-studio-copilot-on-12536621}"; CAND_REF="refs/remotes/origin/cand-aic2"
ALLOWED_RE='^(backend/prisma/schema\.prisma|backend/prisma/migrations/20270102090000_add_ai_studio_copilot/migration\.sql|backend/src/routes/studio\.js|backend/src/services/agentStudio/(checks|copilotContext|copilotPolicy|runtime|skillLoader)\.js|backend/src/services/agentStudio/skill-bawaan/sano-mattress-consultant/[A-Za-z0-9._/-]+\.md|backend/tests/(agentStudio|copilotContext|copilotPolicy)\.test\.js|docs/AI-STUDIO-MVP2-COPILOT\.md|frontend/src/api\.js|frontend/src/components/Layout\.jsx|frontend/src/features/inbox/components/ChatWindow/(Composer\.jsx|CopilotPanel\.jsx|copilotLogic\.js|copilotPanel\.css)|frontend/src/features/inbox/hooks/useSendMessage\.js|frontend/src/pages/aiStudio/(AiStudio|CopilotStudio)\.jsx|frontend/src/routes/pageRegistry\.jsx|frontend/tests/copilotPanel\.test\.js|scripts/release-ai-studio-copilot\.sh)$'
BACKEND_SRC_EXPECT="backend/src/routes/studio.js backend/src/services/agentStudio/checks.js backend/src/services/agentStudio/copilotContext.js backend/src/services/agentStudio/copilotPolicy.js backend/src/services/agentStudio/runtime.js backend/src/services/agentStudio/skillLoader.js"
# sha256 dari `git diff --no-renames --binary --full-index BASE DEPLOY -- backend frontend` (isi backend+web dipin persis).
DIFF_SHA='c0a0de9d422bcefe3ac5d581f3426dc3e1320a82105bee0f02d2f64da238daea'
MIG_NAME="20270102090000_add_ai_studio_copilot"; MIG1="backend/prisma/migrations/${MIG_NAME}/migration.sql"
MIG1_SHA="d518f2de8930ac12d2394b08752d961e6e515d3ef129f12f30f22f791c6ce8f9"; SCAN_EXPECT="6"
PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"; PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
MIN_FREE_KB=$((5 * 1024 * 1024)); TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/ai-studio-copilot-${DEPLOY_SHORT}-${TS}"
PHASE=init; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; DIBANGUN=0; DIR_BARU=0; BACKUP_FILE=""; ROLLBACK_TAG=""; REH_DB=""
say() { printf '\n== %s\n' "$*"; }; ok() { printf '  OK    %s\n' "$*"; }; warn() { printf '  PERHATIAN %s\n' "$*"; }; die() { printf '\nSTOP [%s]: %s\n' "$PHASE" "$*" >&2; exit 1; }
sg() { git --git-dir="$SRC" "$@"; }
dcp() { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { docker exec -i "$PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
bebas_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
cari_dist() { find "$1/frontend/dist/assets" -maxdepth 1 -type f -name "*.$2" -print0 2>/dev/null | xargs -0 grep -lF -- "$3" 2>/dev/null | sed -n 1p; } # BUKAN glob (>21.000 chunk melampaui ARG_MAX)
reh_drop() { [ -n "$REH_DB" ] && docker exec -i "$PG" psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
# Bila berhenti SEBELUM switch: kembalikan tag image ke image yang sedang berjalan, hapus release dir buatan rilis ini & DB rehearsal (container lama tidak tersentuh).
pulihkan() {
  reh_drop
  if [ "$DIBANGUN" = 1 ] && [ -n "$PREV_IMG_ID" ] && [ -n "$IMG_NAME" ]; then docker tag "$PREV_IMG_ID" "$IMG_NAME" >/dev/null 2>&1 || true; fi
  if [ "$DIR_BARU" = 1 ] && [ "$NEW_DIR" = "$RELEASES/$DEPLOY_SHORT" ] && [ "$NEW_DIR" != "$PREV_DIR" ]; then rm -rf -- "$NEW_DIR"; fi
}
trap 'rc=$?; [ $rc -ne 0 ] && { pulihkan; printf "Berhenti di fase %s. Sebelum switch: produksi tidak berubah. Sesudah switch: bash /tmp/aic2.sh %s %s --rollback (backup: %s)\n" "$PHASE" "$DEPLOY_SHA" "$BASE_SHA" "${BACKUP_FILE:-belum dibuat}"; }; exit $rc' EXIT

# Pemindai migrasi: setiap pernyataan (dipisah ';', komentar dibuang) HARUS cocok persis satu pola. Hanya objek studio_*/Studio*, tanpa FK.
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
        print "PERNYATAAN ASING: " s > "/dev/stderr"; bad = 1
      }
      if (c == 0) bad = 1
      print c; exit bad
    }'
}

PHASE=0; say "0. Kunci dan konkurensi"
[ ! -e "$HOME/releases/DEPLOY_LOCK" ] || die "~/releases/DEPLOY_LOCK ada — sesi lain sedang merilis: $(head -c 300 "$HOME/releases/DEPLOY_LOCK" | tr '\n' ' ')"
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain berjalan (${lf})"; done
exec 9>/tmp/release-ai-studio-copilot.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate deploy|/tmp/[a-z0-9]+\.sh' | grep -v 'aic2\.sh\|pgrep\|node src/index.js' | grep -v "$$" || true)"; [ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/   /'; die "ada proses deploy/build/migrasi lain"; }
for m in 'DROP TABLE "studio_agents";' 'ALTER TABLE "User" ADD COLUMN "x" TEXT;' 'UPDATE "User" SET role = '"'"'ADMIN'"'"';' 'DELETE FROM user_roles;' \
  'CREATE INDEX "studio_x_idx" ON "User"("id");' 'GRANT ALL ON "studio_agents" TO public;' 'CREATE TYPE "Role2" AS ENUM ('"'"'A'"'"');' \
  'ALTER TABLE "studio_copilot_drafts" ADD CONSTRAINT "studio_copilot_drafts_x_fkey" FOREIGN KEY ("salesUserId") REFERENCES "User"("id");' \
  'CREATE TABLE "studio_x" ("id" TEXT NOT NULL, "u" TEXT REFERENCES "User"("id"));' 'ALTER TYPE "Role" ADD VALUE IF NOT EXISTS '"'"'X'"'"';' \
  'ALTER TABLE "Customer" ADD COLUMN "copilot" TEXT;' 'INSERT INTO studio_agents (id) VALUES ('"'"'x'"'"');'; do
  if printf '%s\n' "$m" | scan_migrations >/dev/null 2>&1; then die "[skrip] pemindai migrasi MENERIMA mutan: $m"; fi
done
printf '' | scan_migrations >/dev/null 2>&1 && die "[skrip] pemindai migrasi menerima masukan kosong"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"; exec > >(tee -a "$BK_DIR/release.log") 2>&1
ok "tidak ada deploy lain; pemindai migrasi menolak 12 mutan"

PHASE=1; say "1. Release aktif"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = 1 ] || die "harus tepat satu backend"
PG="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=postgres")"; [ "$(printf '%s\n' "$PG" | grep -c .)" = 1 ] || die "harus tepat satu postgres"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"; PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"; ENV_SHA="$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-aic2-${DEPLOY_SHORT}"
ok "aktif ${PREV_DIR} marker ${PREV_COMMIT} image ${PREV_IMG_ID:7:12} env ${ENV_SHA}"
if [ "$MODE" = rollback ]; then
  PHASE=rollback; [ "$(basename "$PREV_DIR")" = "$DEPLOY_SHORT" ] || die "release aktif bukan ${DEPLOY_SHORT}; rollback ditolak agar tidak menimpa rilis lain"
  T="$RELEASES/${BASE_SHA:0:8}"; [ -d "$T" ] || die "folder baseline tidak ada"
  docker image inspect "$ROLLBACK_TAG" >/dev/null 2>&1 || die "image rollback ${ROLLBACK_TAG} tidak ada"
  docker tag "$ROLLBACK_TAG" "$IMG_NAME" || die "gagal menandai image rollback"
  dcp "$T" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "recreate gagal"
  for i in $(seq 1 45); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && break; sleep 2; done; curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "tidak sehat setelah rollback"
  ok "rollback selesai: folder ${BASE_SHA:0:8}, image ${ROLLBACK_TAG}. Tabel studio_copilot_drafts dibiarkan (aditif, diabaikan kode lama)."; trap - EXIT; exit 0
fi

PHASE=2; say "2. Sumber, batas perubahan, pin isi diff & migrasi"
[ -d "$SRC" ] || die "repo sumber tidak ada"
[ -f "${BUNDLE:-}" ] || die "BUNDLE tidak ada (lihat kepala berkas)"
sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch bundle gagal"
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat di bundle bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline tidak ada di repo sumber"
[ "$(sg rev-parse --short=8 "$BASE_SHA")" = "$PREV_COMMIT" ] || die "baseline ${BASE_SHA:0:8} BUKAN release aktif ${PREV_COMMIT}: susun ulang di atas live"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline bukan leluhur kandidat"
[ "$(sg rev-list --count "${BASE_SHA}..${DEPLOY_SHA}")" -le 10 ] || die "kandidat lebih dari 10 commit di atas baseline — tidak sesuai audit"
CHANGED="$(sg -c core.quotepath=false diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"; [ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/   /'; die "berkas di luar allowlist"; }
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)(docker-compose[^/]*|Dockerfile|\.dockerignore)$|package(-lock)?\.json$|\.env|^frontend/dist' || die "Docker/package/env/dist berubah"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | grep -v '/skill-bawaan/' | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "daftar berkas kode backend/src yang berubah tidak sama dengan yang diaudit"
[ "$(sg -c core.quotepath=false diff --no-renames --no-color --no-ext-diff --binary --full-index "$BASE_SHA" "$DEPLOY_SHA" -- backend frontend | sha256sum | cut -d' ' -f1)" = "$DIFF_SHA" ] || die "isi diff backend+frontend berbeda dari yang diaudit"
[ -z "$(sg diff "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | tr -d '\r' | grep -E '^-[^-]' || true)" ] || die "schema.prisma bukan murni penambahan"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/migrations/' | tr '\n' ' ' | sed 's/ $//')" = "$MIG1" ] || die "migrasi kandidat bukan tepat satu berkas yang diaudit"
[ "$(sg show "${DEPLOY_SHA}:${MIG1}" | tr -d '\r' | sha256sum | cut -d' ' -f1)" = "$MIG1_SHA" ] || die "isi ${MIG1} berbeda dari yang diaudit"
SCAN="$(sg show "${DEPLOY_SHA}:${MIG1}" | tr -d '\r' | scan_migrations)" || die "pemindai migrasi menemukan pernyataan di luar allow-list"
[ "$SCAN" = "$SCAN_EXPECT" ] || die "jumlah pernyataan migrasi ${SCAN} != ${SCAN_EXPECT}"
LAST_BASE_MIG="$(sg ls-tree -d --name-only "${BASE_SHA}:backend/prisma/migrations" | LC_ALL=C sort | tail -n 1)"
[[ "$LAST_BASE_MIG" < "$MIG_NAME" ]] || die "migrasi baru tidak terurut SESUDAH migrasi terakhir baseline (${LAST_BASE_MIG})"
ok "$(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist; isi diff dipin; 1 migrasi dipin (${SCAN} pernyataan diizinkan, sesudah ${LAST_BASE_MIG}); Docker/package tidak berubah"

PHASE=3; say "3. Audit produksi (baca-saja)"
curl -fsS -m8 "${INTERNAL_URL}/api/health" | grep -q '"ok":true' || die "health internal"; curl -fsS -m15 "${PUBLIC_URL}/api/health" | grep -q '"ok":true' || die "health publik"
sg -c core.quotepath=false ls-tree -r "$BASE_SHA" | awk -F'\t' '$1 ~ /^100[0-9]+ blob/ && $2 !~ /^frontend\/dist\// { split($1,a," "); print a[3] "\t" $2 }' > "$BK_DIR/base.tsv"
cut -f2 "$BK_DIR/base.tsv" | sed "s#^#${PREV_DIR}/#" | git hash-object --no-filters --stdin-paths > "$BK_DIR/live.txt" || die "berkas baseline hilang di release aktif"
BEDA="$(paste "$BK_DIR/base.tsv" "$BK_DIR/live.txt" | awk -F'\t' '$1 != $3' | wc -l)"; [ "$BEDA" = 0 ] || die "kode live menyimpang dari baseline: ${BEDA} berkas"
ok "kode live == baseline ($(wc -l < "$BK_DIR/base.tsv") berkas)"
[ "$(tr -d '\r' < "$PERSIST/backend/.env" | grep -cE '^STUDIO_ANTHROPIC_API_KEY="?sk-ant-[A-Za-z0-9_-]{20,}"?$')" = 1 ] || die "backend/.env harus memuat tepat satu STUDIO_ANTHROPIC_API_KEY yang valid (nilai tidak dicetak)"
BATAS="$(tr -d '\r' < "$PERSIST/backend/.env" | sed -n 's/^STUDIO_COPILOT_DAILY_USD=//p' | tr -d '"' | tail -n 1)"
ok "STUDIO_ANTHROPIC_API_KEY ada (nilai tidak dicetak); plafon Copilot per hari \$${BATAS:-3 (default)}"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = 0 ] || die "migrasi menggantung"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name = '${MIG_NAME}'")" = 0 ] || die "produksi SUDAH punya jejak ${MIG_NAME} — periksa manual"
[ "$(psql_live -At -c "select to_regclass('public.studio_copilot_drafts') is null")" = t ] || die "tabel studio_copilot_drafts SUDAH ada"
[ "$(psql_live -At -c "select count(*) from pg_type where typname = 'StudioDraftOutcome'")" = 0 ] || die "enum StudioDraftOutcome SUDAH ada"
[ "$(psql_live -At -c "select to_regclass('public.studio_agents') is not null")" = t ] || die "AI Studio MVP 1 (studio_agents) tidak ada di produksi"
MIG_SEBELUM="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
SKILL_LIVE="$(psql_live -At -c "select \"versionNumber\" || ' · ' || coalesce(\"changeNote\", '-') from studio_skill_versions where status = 'LIVE' order by \"versionNumber\" desc limit 1")"
ok "migrasi terpasang ${MIG_SEBELUM}; belum ada jejak Copilot; skill LIVE sekarang: v${SKILL_LIVE:-<belum ada agent>} (sinkron bawaan → versi baru saat Studio pertama dibuka)"
SNAP_SQL="select 'order', count(*), md5(coalesce(string_agg(o.id||o.status::text||o.\"paymentStatus\"::text||coalesce(o.paid_at::text,''), '|' order by o.id),'')) from \"Order\" o union all select 'payment', count(*), md5(coalesce(string_agg(p.id::text||p.amount::text||coalesce(p.cancelled_at::text,''), '|' order by p.id),'')) from payments p union all select 'jurnal', count(*), md5(coalesce(string_agg(e.id::text||e.status::text||e.entry_number, '|' order by e.id),'')) from fin_journal_entries e union all select 'pengguna', count(*), md5(coalesce(string_agg(u.id||u.role::text||u.active::text, '|' order by u.id),'')) from \"User\" u union all select 'user_roles', count(*), md5(coalesce(string_agg(r.user_id||r.role::text, '|' order by r.user_id, r.role),'')) from user_roles r union all select 'flag_v2', count(*), md5(coalesce(string_agg(f.key||f.enabled::text||f.config::text, '|' order by f.key),'')) from v2_feature_flags f union all select 'fin_settings', count(*), md5(coalesce(string_agg(f.key||f.value, '|' order by f.key),'')) from fin_settings f union all select 'produk', count(*), md5(coalesce(string_agg(p.id||p.name||coalesce(p.price::text,'')||p.active::text, '|' order by p.id),'')) from \"Product\" p union all select 'gold_standard', count(*), md5(coalesce(string_agg(g.id||g.quote, '|' order by g.id),'')) from \"GoldStandardExample\" g union all select 'customer_tags_city', count(*), md5(coalesce(string_agg(c.id||coalesce(c.city,'')||array_to_string(c.tags,','), '|' order by c.id),'')) from \"Customer\" c union all select 'studio_versi', count(*), md5(coalesce(string_agg(v.id||v.status::text, '|' order by v.id),'')) from studio_skill_versions v"
psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sebelum.txt" || die "snapshot sebelum gagal"; [ "$(wc -l < "$BK_DIR/snap-sebelum.txt")" = 11 ] || die "snapshot sebelum tidak lengkap"
ok "snapshot sebelum: order, payment, jurnal, pengguna, peran, flag, pengaturan, produk, gold standard, kota/tag customer, versi skill"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; FREE="$(bebas_kb)"; BUTUH=$(( DB_BYTES / 1024 * 3 + MIN_FREE_KB ))
if [ "$MODE" = preflight ]; then
  [ "$FREE" -ge "$BUTUH" ] && ok "disk bebas $((FREE/1024)) MiB (butuh $((BUTUH/1024)) MiB)" || warn "disk bebas $((FREE/1024)) MiB < butuh $((BUTUH/1024)) MiB (3x DB + 5 GiB)"
  say "Preflight selesai: produksi TIDAK diubah"; trap - EXIT; exit 0
fi
[ "$FREE" -ge "$BUTUH" ] || die "disk bebas $((FREE/1024)) MiB < butuh $((BUTUH/1024)) MiB"
[ ! -e "$NEW_DIR" ] || die "release dir sudah ada"

PHASE=4; say "4. Backup produksi + checksum, lalu uji migrasi pada salinan (DB produksi tidak disentuh)"
BACKUP_FILE="$HOME/backups/pre-aic2-${DEPLOY_SHORT}-${TS}.sql.gz"
docker exec -i "$PG" pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || die "dump tidak lengkap"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"
REH_DB="rehearsal_aic2_${TS}"
docker exec -i "$PG" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
gzip -dc "$BACKUP_FILE" | docker exec -i "$PG" psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { docker exec -i "$PG" psql -U "$DB_USER" -d "$REH_DB" -X -At -q -v ON_ERROR_STOP=1 -c "$1" </dev/null; }
[ "$(RPSQL "select count(*) from _prisma_migrations")" = "$(psql_live -At -c "select count(*) from _prisma_migrations")" ] || die "jumlah migrasi pada restore berbeda"
RPSQL "select id||role::text from \"User\" order by id" | sha256sum > "$BK_DIR/reh-pengguna.sha"
RPSQL "$(sg show "${DEPLOY_SHA}:${MIG1}" | tr -d '\r' | grep -vE '^--')" || die "migrasi gagal pada DB salinan"
[ "$(RPSQL "select count(*) from studio_copilot_drafts")" = 0 ] || die "studio_copilot_drafts tidak kosong pada salinan"
[ "$(RPSQL "select count(*) from pg_type where typname = 'StudioDraftOutcome'")" = 1 ] || die "enum StudioDraftOutcome tidak terpasang pada salinan"
[ "$(RPSQL "select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid where c.contype='f' and t.relname='studio_copilot_drafts'")" = 0 ] || die "ada FK dari studio_copilot_drafts"
RPSQL "select id||role::text from \"User\" order by id" | sha256sum | cmp -s - "$BK_DIR/reh-pengguna.sha" || die "data pengguna berubah karena migrasi pada salinan"
reh_drop; REH_DB=""
ok "migrasi diuji pada salinan backup nyata: tabel kosong, enum terpasang, tanpa FK, data pengguna identik; DB salinan dihapus"

PHASE=5; say "5. Release dir, build web + image (backend lama tetap melayani)"
mkdir "$NEW_DIR"; DIR_BARU=1; sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist'; printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/src/services/agentStudio/skill-bawaan/sano-mattress-consultant/references/52-gaya-wa-dan-mode-copilot.md; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.yml") >/dev/null || die "docker-compose.yml berbeda dari release aktif"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; FE_NM=""; for d in "$PREV_DIR" $(ls -dt "$(dirname "$PREV_DIR")"/*/); do d="${d%/}"; if [ -d "$d/frontend/node_modules" ] && cmp -s "$d/frontend/package-lock.json" "$NEW_DIR/frontend/package-lock.json"; then FE_NM="$d/frontend/node_modules"; break; fi; done
[ -n "$FE_NM" ] || die "node_modules frontend dengan package-lock sama tidak ditemukan"; cp -a "$FE_NM" "$NEW_DIR/frontend/node_modules" || die "salin node_modules frontend gagal"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env"; ( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/web.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 20 "$BK_DIR/web.log"; die "build web gagal"; }; rm -f "$NEW_DIR/frontend/.env"; rm -rf "$NEW_DIR/frontend/node_modules"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"; [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "dist tidak valid"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"; [ "$NEW_INDEX" != "$PREV_INDEX" ] || die "bundel baru sama dengan bundel aktif"
for j in "/studio/copilot/akses" "Copilot Inbox" "Kirim semua bubble"; do
  [ -z "$(cari_dist "$PREV_DIR" js "$j")" ] || die "[skrip] '${j}' sudah ada di dist aktif — perbaiki pembanding"; [ -n "$(cari_dist "$NEW_DIR" js "$j")" ] || die "dist baru tanpa '${j}'"; done
[ -z "$(cari_dist "$PREV_DIR" css "copilot-panel")" ] || die "[skrip] 'copilot-panel' sudah ada di CSS aktif"; [ -n "$(cari_dist "$NEW_DIR" css "copilot-panel")" ] || die "CSS baru tanpa panel Copilot"
for j in "pf-kerja-pil-" "/studio/sessions" "Saran Balasan AI" "tiba-catat" "TargetRingkas" "open-tabs:v1" "Target Produksi Harian" "Tandai sudah tiba di workshop" "Rencana Admin" 'to:"/broadcast-sales"' 'to:"/laporan"' 'to:"/komplain"' 'to:"/ai-studio/test-case"' 'path:"/marketing/pengajuan-biaya"' "Lead tanpa spam" "Cari halaman, pelanggan, order" "Aktif di periode" "Catat hasil SO" "ap-kepala-judul" "portal-kartu"; do
  [ -n "$(cari_dist "$PREV_DIR" js "$j")" ] || die "[skrip] '${j}' tidak ada di dist aktif — perbaiki pembanding"; [ -n "$(cari_dist "$NEW_DIR" js "$j")" ] || die "dist baru KEHILANGAN '${j}'"; done
for j in 'to:"/sales-intelligence"' 'to:"/copilot"' 'section:"AI & OTOMASI"' 'sidebar-help-btn'; do [ -z "$(cari_dist "$NEW_DIR" js "$j")" ] || die "dist baru MEMUNCULKAN LAGI menu yang dicabut ssc1: ${j}"; done
for c in "pf-segmen-pil" ".rc-tiba-baru" ".prod-rc-kartu" ".sp-panel" ".mk-kpi-grid" ".ap-hero" ".gud-pi-grid" ".fin-tg-kpi" ".as-halaman"; do [ -n "$(cari_dist "$PREV_DIR" css "$c")" ] || die "[skrip] '${c}' tidak ada di CSS aktif — perbaiki pembanding"; [ -n "$(cari_dist "$NEW_DIR" css "$c")" ] || die "CSS baru KEHILANGAN ${c}"; done
[ -f "$NEW_DIR/frontend/dist/sw.js" ] && ! grep -qF '"url":"index.html"' "$NEW_DIR/frontend/dist/sw.js" && grep -qF 'addEventListener("push"' "$NEW_DIR/frontend/dist/sw.js" || die "service worker baru tidak sesuai (precache index.html / push hilang)"
n=0; for f in "$PREV_DIR"/frontend/dist/assets/*; do b="${f##*/}"; [ -e "$NEW_DIR/frontend/dist/assets/$b" ] || { cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b"; n=$((n+1)); }; done
ok "web ${NEW_INDEX} (live ${PREV_INDEX}); ${n} aset lama dibawa; Copilot ada; fitur live tetap; menu yang dicabut tetap hilang"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
DIBANGUN=1; dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"; [ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
docker run --rm --entrypoint sh "$NEW_IMG_ID" -c "test -f /app/src/services/agentStudio/copilotContext.js && test -f /app/src/services/agentStudio/skill-bawaan/sano-mattress-consultant/references/52-gaya-wa-dan-mode-copilot.md" || die "image baru tanpa berkas Copilot / skill 52"
FREE="$(bebas_kb)"; [ "$FREE" -ge "$MIN_FREE_KB" ] || die "disk bebas $((FREE/1024)) MiB < 5 GiB sesudah build"
ok "image baru ${NEW_IMG_ID:7:12} memuat Copilot + skill 52; container aktif masih ${PREV_IMG_ID:7:12}"
if [ "$MODE" = buildonly ]; then
  docker tag "$PREV_IMG_ID" "$IMG_NAME"; DIBANGUN=0; rm -rf -- "$NEW_DIR"; DIR_BARU=0
  say "Build-only selesai: produksi TIDAK di-switch; tag image dikembalikan; release dir dihapus. Backup tetap: ${BACKUP_FILE}"; trap - EXIT; exit 0
fi

cat > "$BK_DIR/smoke.mjs" <<'NODE'
const { prisma } = await import("/app/src/db.js");
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " - " + d : ""}`); };
rec("STUDIO_ANTHROPIC_API_KEY terbaca proses (nilai tidak dicetak)", /^sk-ant-/.test(process.env.STUDIO_ANTHROPIC_API_KEY || ""));
for (const [m, p] of [["GET", "/api/studio/copilot/akses"], ["POST", "/api/studio/copilot/x/draft"], ["POST", "/api/studio/copilot/drafts/x/outcome"], ["POST", "/api/studio/copilot/drafts/x/crm"], ["GET", "/api/studio/copilot/stats"], ["PUT", "/api/studio/copilot/users"], ["GET", "/api/studio/copilot/contoh-gaya"], ["GET", "/api/studio/agents"]]) {
  const r = await fetch(`http://127.0.0.1:4000${p}`, { method: m, headers: { "content-type": "application/json" }, body: m === "GET" ? undefined : "{}" });
  rec(`${m} ${p} tanpa token -> 401`, r.status === 401, String(r.status));
}
rec("studioCopilotDraft kosong", (await prisma.studioCopilotDraft.count()) === 0);
await prisma.$disconnect();
console.log(`SMOKE_HASIL fail=${fail}`);
process.exit(fail ? 1 : 0);
NODE

PHASE=6; say "6. Switch satu kali (container baru menjalankan migrasi aditif saat mulai)"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container berubah sebelum switch"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate deploy|/tmp/[a-z0-9]+\.sh' | grep -v 'aic2\.sh\|pgrep\|node src/index.js' | grep -v "$$" || true)"; [ -z "$OTHER" ] || die "ada proses deploy/build/migrasi lain tepat sebelum switch"
[ ! -e "$HOME/releases/DEPLOY_LOCK" ] || die "DEPLOY_LOCK muncul sebelum switch"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah sebelum switch"
T_SWITCH="$(date -u +%FT%TZ)"; DIR_BARU=0; dcp "$NEW_DIR" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "up gagal"
UP=0; for i in $(seq 1 60); do curl -fsS -m4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = 1 ] || die "backend baru tidak sehat"
CID_NEW=""; for i in $(seq 1 30); do CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s\n' "$CID_NEW" | grep -c .)" = 1 ] && [ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] && break; sleep 2; done
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan bukan image baru"
DIBANGUN=0
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "switch ${T_SWITCH}; image ${NEW_IMG_ID:7:12}"

PHASE=7; say "7. Verifikasi dan smoke (baca-saja)"
[ "$(curl -fsS -m15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik bukan dist baru"
[ "$(sha256sum "$PERSIST/backend/.env" | cut -c1-16)" = "$ENV_SHA" ] || die ".env berubah"
MIG_SESUDAH="$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")"
[ "$MIG_SESUDAH" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi tidak bertambah tepat satu (${MIG_SEBELUM} -> ${MIG_SESUDAH})"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and migration_name='${MIG_NAME}'")" = 1 ] || die "migrasi rilis tidak tercatat selesai"
ok "migrasi ${MIG_SEBELUM} -> ${MIG_SESUDAH} (${MIG_NAME})"
for f in $BACKEND_SRC_EXPECT; do
  [ "$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)" = "$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)" ] || die "container baru TIDAK memuat ${f} persis"
done
for f in routes/conversations.js middleware/auth.js middleware/authorize.js services/providers/anthropicProvider.js services/finance/journal.js; do
  [ "$(sg show "${BASE_SHA}:backend/src/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)" = "$(docker exec "$CID_NEW" sh -c "cat /app/src/${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)" ] || die "${f} di container BERBEDA dari baseline"
done
ok "6 berkas kode backend = kandidat (byte-identik); conversations/auth/authorize/anthropicProvider/journal tetap sama dengan baseline"
dcp "$NEW_DIR" exec -T backend node --input-type=module - < "$BK_DIR/smoke.mjs" > "$BK_DIR/smoke.log" 2>&1 || { tail -n 30 "$BK_DIR/smoke.log"; die "smoke test GAGAL"; }
cat "$BK_DIR/smoke.log"; grep -q '^SMOKE_HASIL fail=0$' "$BK_DIR/smoke.log" || die "smoke tidak lulus"
for ep in /api/conversations /api/studio/copilot/akses /api/studio/agents; do [ "$(curl -s -o /dev/null -w '%{http_code}' -m15 "${PUBLIC_URL}${ep}")" = 401 ] || die "${ep} publik tanpa token harus 401"; done
OLDF="$(find "$PREV_DIR/frontend/dist/assets" -maxdepth 1 -name '*.js' -print -quit)"; [ "$(curl -s -o /dev/null -w '%{http_code}' -m15 "${PUBLIC_URL}/assets/${OLDF##*/}")" = 200 ] || die "aset lama tidak lagi 200"
sleep 5; psql_live -At -c "$SNAP_SQL" > "$BK_DIR/snap-sesudah.txt" || die "snapshot sesudah gagal"
if cmp -s "$BK_DIR/snap-sebelum.txt" "$BK_DIR/snap-sesudah.txt"; then ok "SELURUH snapshot identik"; else
  diff "$BK_DIR/snap-sebelum.txt" "$BK_DIR/snap-sesudah.txt" || true
  for k in flag_v2 fin_settings user_roles produk gold_standard pengguna; do
    [ "$(awk -F'|' -v k="$k" '$1==k' "$BK_DIR/snap-sebelum.txt")" = "$(awk -F'|' -v k="$k" '$1==k' "$BK_DIR/snap-sesudah.txt")" ] || die "$k BERUBAH selama rilis"
  done
  while IFS='|' read -r kk nn _; do [ "$(awk -F'|' -v k="$kk" '$1==k{print $2}' "$BK_DIR/snap-sesudah.txt")" -ge "$nn" ] || die "jumlah baris $kk BERKURANG selama rilis"; done < "$BK_DIR/snap-sebelum.txt"
  ok "flag, pengaturan, peran, pengguna, produk, gold standard identik; selisih lain hanya trafik/penambahan (studio_versi berubah bila Owner sudah membuka Studio)"
fi
sleep 15; [ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = 0 ] || die "backend restart sendiri"
LOGERR="$(docker logs --since 5m "$CID_NEW" 2>&1 | grep -ciE 'unhandled|uncaught|Cannot find module|SyntaxError|\[copilot\]|sinkron skill' || true)"
[ "${LOGERR:-0}" = 0 ] || { docker logs --since 5m "$CID_NEW" 2>&1 | grep -iE 'unhandled|uncaught|Cannot find module|SyntaxError|\[copilot\]|sinkron skill' | tail -n 10; die "log backend memuat galat (${LOGERR})"; }
ok "smoke lulus; RestartCount 0; log bersih"
trap - EXIT; say "SELESAI ${DEPLOY_SHORT}: AI Studio MVP 2 Copilot Inbox (Tahap A: ADMIN/OWNER). Buka ${PUBLIC_URL}/ai-studio sekali sebagai Owner agar skill LIVE tersinkron. Backup: ${BACKUP_FILE}. Rollback: bash /tmp/aic2.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback. Log: ${BK_DIR}/release.log"
