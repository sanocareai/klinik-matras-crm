#!/usr/bin/env bash
# REHEARSAL restore production → migrate kandidat → verifier → smoke baca-saja, pada DB SEMENTARA di Postgres production. TIDAK mengubah DB/aplikasi production
# (production hanya DIBACA: pg_dump + SELECT). Jumlah migration pending DIHITUNG AKTUAL dari DB production vs sumber kandidat — tidak diasumsikan.
#   env CAND_FULL=<40 hex commit kandidat di origin> BRANCH=<branch kandidat> bash scripts/rehearsal-restore-production.sh
# Langkah: lock rilis bersama → freeze (container/image/release/flag/applied) → fetch+ancestry kandidat → dump production + restore ke DB sementara (+ verifikasi) →
#   verifier history (sebelum) → prisma migrate deploy pada SALINAN → verifier (sesudah) + migrate status → sidik jumlah baris SEMUA tabel (sebelum/sesudah) →
#   smoke baca-saja kode kandidat pada salinan → kesiapan-rollback adaptasi (baca-saja) → cleanup (drop DB, hapus dump & kerja) → bukti production tak berubah.
# Dump berisi data nyata: mode 600, hanya di VPS, DIHAPUS di akhir (sha256 dicatat). Container satu-kali memakai image live + kode kandidat (read-only mount); tanpa build, tanpa port.
set -Eeuo pipefail
umask 077
: "${CAND_FULL:?CAND_FULL wajib (40 hex)}"; : "${BRANCH:?BRANCH wajib}"
[[ "$CAND_FULL" =~ ^[0-9a-f]{40}$ ]] || { echo "CAND_FULL bukan 40 hex"; exit 2; }
SHORT="${CAND_FULL:0:8}"; TS="$(date +%Y%m%d_%H%M%S)"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"; PERSIST="$HOME/klinik-matras"; RELEASES="$HOME/releases/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"; LOCK="$HOME/releases/.release.lock"; HAVE_LOCK=0
WORK="$HOME/rehearsal-$SHORT-$TS"; LOGDIR="$HOME/rehearsal-logs"; LOG="$LOGDIR/rehearsal-$SHORT-$TS.log"; DUMP="$HOME/backups/rehearsal-$SHORT-$TS.sql.gz"; TEMP_DB="km_rehearsal_${SHORT}_$TS"
mkdir -p "$LOGDIR" "$HOME/backups"; exec > >(tee -a "$LOG") 2>&1
say(){ printf '\n== %s\n' "$*"; }; ok(){ printf '  OK    %s\n' "$*"; }; warn(){ printf '  WARN  %s\n' "$*"; }; die(){ printf '\nSTOP: %s\n' "$*" >&2; exit 1; }
sg(){ git --git-dir="$SRC" "$@"; }
PG="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=postgres")"; [ "$(printf '%s' "$PG" | wc -w)" = 1 ] || die "container postgres tidak tunggal"
BE="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=backend")"; [ "$(printf '%s' "$BE" | wc -w)" = 1 ] || die "container backend tidak tunggal"
psql_live(){ docker exec -i "$PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
psql_tmp(){ docker exec -i "$PG" psql -U "$DB_USER" -d "$TEMP_DB" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
live_state(){ printf 'image=%s started=%s restarts=%s release=%s applied=%s flags=%s' "$(docker inspect -f '{{.Image}}' "$BE")" "$(docker inspect -f '{{.State.StartedAt}}' "$BE")" "$(docker inspect -f '{{.RestartCount}}' "$BE")" \
  "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$BE")" "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" \
  "$(psql_live -At -c "select md5(string_agg(key||'='||enabled::text||':'||coalesce(config::text,'{}'), ',' order by key)) from v2_feature_flags")"; }
row_counts(){ psql_tmp -At -F'|' -c "select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"; }
cleanup(){ local rc=$?; set +e
  docker exec -i "$PG" dropdb -U "$DB_USER" --if-exists --force "$TEMP_DB" </dev/null >/dev/null 2>&1 && echo "  cleanup: DB sementara $TEMP_DB dihapus"
  [ -f "$DUMP" ] && { echo "  cleanup: dump dihapus ($(basename "$DUMP") sha256=$(cat "$DUMP.sha256" 2>/dev/null | cut -d' ' -f1))"; rm -f "$DUMP" "$DUMP.sha256" "$DUMP.partial"; }
  rm -rf "$WORK"; [ "$HAVE_LOCK" = 1 ] && rm -rf "$LOCK"
  [ $rc -eq 0 ] && echo "REHEARSAL SELESAI: OK (log: $LOG)" || echo "REHEARSAL BERHENTI kode $rc — production TIDAK diubah (log: $LOG)"; }
trap cleanup EXIT

say "0. Lock rilis bersama + freeze production"
mkdir "$LOCK" 2>/dev/null || die "lock rilis dipegang sesi lain: $(cat "$LOCK/owner" 2>/dev/null)"; HAVE_LOCK=1; echo "rehearsal $SHORT $(date -u +%FT%TZ)" > "$LOCK/owner"; ok "lock diambil"
LIVE0="$(live_state)"; ok "production aktif: $LIVE0"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$BE")"; PREV_SHORT="$(cat "$PREV_DIR/.release-commit")"; ok "release live: $PREV_SHORT ($PREV_DIR)"
IMG="$(docker inspect -f '{{.Image}}' "$BE")"
echo "  flag V2 live:"; psql_live -At -c "select '    '||key||' enabled='||enabled::text||' '||left(coalesce(config::text,'{}'),90) from v2_feature_flags order by key"
curl -fsS --max-time 8 http://127.0.0.1:4000/api/health | grep -q '"ok":true' && ok "health internal OK" || warn "health internal tidak OK"
FREE_KB="$(df --output=avail -k "$HOME" | tail -1 | tr -d ' ')"; DBB="$(psql_live -At -c "select pg_database_size(current_database())")"; [ "$FREE_KB" -gt $(( DBB / 1024 * 6 )) ] || die "disk kurang untuk dump+restore (free ${FREE_KB}KB, db ${DBB}B)"; ok "disk cukup (free ${FREE_KB}KB, db $((DBB/1048576)) MB)"

say "1. Kandidat: fetch + ancestry + pending AKTUAL"
[ -d "$SRC" ] || die "cache git $SRC tidak ada"
sg fetch -q origin "+refs/heads/$BRANCH:refs/cache/rehearsal" "+refs/heads/main:refs/cache/main" "+refs/heads/*:refs/cache/all/*" 2>&1 | tail -2 || true
[ "$(sg rev-parse refs/cache/rehearsal)" = "$CAND_FULL" ] || die "branch $BRANCH di origin = $(sg rev-parse refs/cache/rehearsal), bukan kandidat $CAND_FULL"
MAIN_NOW="$(sg rev-parse refs/cache/main)"; sg merge-base --is-ancestor "$MAIN_NOW" "$CAND_FULL" || die "origin/main ($MAIN_NOW) tidak termuat di kandidat"; ok "origin/main ${MAIN_NOW:0:8} termuat di kandidat"
LIVE_FULL="$(sg rev-parse "$PREV_SHORT^{commit}" 2>/dev/null)" || die "commit live $PREV_SHORT tidak ada di cache"; sg merge-base --is-ancestor "$LIVE_FULL" "$CAND_FULL" || die "live bukan leluhur kandidat"; ok "live ${LIVE_FULL:0:8} leluhur langsung kandidat"
mkdir -p "$WORK"; sg archive "$CAND_FULL" backend | tar -x -C "$WORK"; [ -d "$WORK/backend/prisma/migrations" ] || die "arsip kandidat tanpa migration"
for f in package.json package-lock.json Dockerfile; do cmp -s <(sg show "$LIVE_FULL:backend/$f") <(sg show "$CAND_FULL:backend/$f") || die "backend/$f kandidat berbeda dari live (image live tidak bisa dipakai ulang untuk rehearsal)"; done; ok "package.json/lock/Dockerfile backend byte-identik dengan live"
find "$WORK/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort > "$WORK/repo_migs.txt"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort > "$WORK/applied_migs.txt"
LC_ALL=C comm -13 "$WORK/applied_migs.txt" "$WORK/repo_migs.txt" > "$WORK/pending.txt"; LC_ALL=C comm -23 "$WORK/applied_migs.txt" "$WORK/repo_migs.txt" > "$WORK/orphan.txt"
NPEND="$(wc -l < "$WORK/pending.txt")"; NAPP="$(wc -l < "$WORK/applied_migs.txt")"; NREPO="$(wc -l < "$WORK/repo_migs.txt")"
ok "sumber kandidat: $NREPO migration; applied production: $NAPP; PENDING AKTUAL: $NPEND"; sed 's/^/    pending: /' "$WORK/pending.txt"
[ ! -s "$WORK/orphan.txt" ] || die "migration applied di production yang TIDAK ada di kandidat: $(tr '\n' ' ' < "$WORK/orphan.txt")"
while read -r m; do sg cat-file -e "$LIVE_FULL:backend/prisma/migrations/$m/migration.sql" 2>/dev/null && die "pending $m sudah ada di commit live (aneh)"; done < "$WORK/pending.txt"
if grep -hEi '\b(DROP|DELETE[[:space:]]+FROM|TRUNCATE)\b' $(sed "s#^#$WORK/backend/prisma/migrations/#; s#\$#/migration.sql#" "$WORK/pending.txt") 2>/dev/null | grep -vE '^[[:space:]]*--' | grep -q .; then warn "pending berisi DROP/DELETE/TRUNCATE — periksa manual"; else ok "pending aditif: tanpa DROP/DELETE/TRUNCATE"; fi
echo "$NPEND" > "$WORK/npend"

say "2. Dump production + restore ke DB sementara $TEMP_DB"
docker exec "$PG" pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "$DUMP.partial" || die "pg_dump gagal"
gzip -t "$DUMP.partial" || die "gzip -t gagal"; gzip -dc "$DUMP.partial" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || die "dump tidak lengkap"
mv "$DUMP.partial" "$DUMP"; chmod 600 "$DUMP"; ( cd "$(dirname "$DUMP")" && sha256sum "$(basename "$DUMP")" > "$(basename "$DUMP").sha256" && sha256sum -c "$(basename "$DUMP").sha256" >/dev/null ) || die "sha256 dump"
ok "dump $(du -h "$DUMP" | cut -f1) sha256=$(cut -d' ' -f1 "$DUMP.sha256")"
docker exec -i "$PG" createdb -U "$DB_USER" "$TEMP_DB" </dev/null || die "createdb sementara"
gzip -dc "$DUMP" | docker exec -i "$PG" psql -U "$DB_USER" -d "$TEMP_DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>"$WORK/restore.err" || { tail -5 "$WORK/restore.err"; die "restore ke DB sementara gagal"; }
[ "$(psql_tmp -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$NAPP" ] || die "applied di salinan != production"; ok "restore OK; applied di salinan = $NAPP"
row_counts > "$WORK/counts_before.txt"; ok "sidik jumlah baris dicatat ($(wc -l < "$WORK/counts_before.txt") tabel)"
LIVE_ROWS="$(psql_live -At -c "select count(*) from units") $(psql_live -At -c "select count(*) from production_runs_v2")"; TMP_ROWS="$(psql_tmp -At -c "select count(*) from units") $(psql_tmp -At -c "select count(*) from production_runs_v2")"; [ "$LIVE_ROWS" = "$TMP_ROWS" ] && ok "units/runs salinan = production ($LIVE_ROWS)" || warn "units/runs berbeda karena production berjalan selama dump ($LIVE_ROWS vs $TMP_ROWS) — wajar"

say "3. Kode kandidat pada SALINAN: verifier → migrate deploy → verifier → status → smoke → kesiapan rollback"
NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$BE")"
PW="$(grep -E '^DATABASE_URL=' "$PERSIST/backend/.env" | sed -E 's#^DATABASE_URL=[^:]+://[^:]+:([^@]+)@.*#\1#')"; [ -n "$PW" ] || die "password DB tidak terbaca"
printf 'DATABASE_URL=postgresql://%s:%s@postgres:5432/%s\nNODE_ENV=production\nDISABLE_BACKGROUND_JOBS=1\nJWT_SECRET=rehearsal-only-bukan-rahasia\n' "$DB_USER" "$PW" "$TEMP_DB" > "$WORK/rehearsal.env"; chmod 600 "$WORK/rehearsal.env"; unset PW
cat > "$WORK/run.sh" <<'INNER'
set -e
echo "-- prisma generate (skema kandidat)"; npx prisma generate 2>&1 | grep -E "Generated|error" || true
echo "-- A. verifier SEBELUM migrate"; node scripts/verify-migration-history.js || true
echo "-- B. prisma migrate deploy (SALINAN)"; npx prisma migrate deploy 2>&1 | grep -E "migrations found|Applying|applied|No pending|Error" || true
echo "-- C. verifier SESUDAH migrate"; node scripts/verify-migration-history.js
echo "-- D. migrate status"; npx prisma migrate status 2>&1 | tail -3
echo "-- E. smoke baca-saja kode kandidat"; node scripts/production-delivery-v2/rehearsal-readonly-smoke.js
echo "-- F. kesiapan rollback adaptasi (baca-saja)"; node scripts/production-delivery-v2/adaptation-rollback-readiness.js
INNER
docker run --rm --network "$NET" --env-file "$WORK/rehearsal.env" -v "$WORK/backend/prisma:/app/prisma:ro" -v "$WORK/backend/src:/app/src:ro" -v "$WORK/backend/scripts:/app/scripts:ro" -v "$WORK/run.sh:/run.sh:ro" --entrypoint sh "$IMG" /run.sh > "$WORK/container.out" 2>&1 || { cat "$WORK/container.out" | sed -E 's#(://[^:]+:)[^@]+@#\1***@#' | tail -60; die "langkah di container gagal"; }
sed -E 's#(://[^:]+:)[^@]+@#\1***@#' "$WORK/container.out"
grep -q "tanpa drift\|migration history: OK" "$WORK/container.out" || die "verifier sesudah migrate tidak OK"
grep -q "SMOKE BACA-SAJA: semua lulus" "$WORK/container.out" || die "smoke baca-saja GAGAL"
grep -q "Database schema is up to date" "$WORK/container.out" || die "migrate status tidak up to date"

say "4. Sidik jumlah baris SEMUA tabel: sebelum vs sesudah migrate (hanya tabel baru + _prisma_migrations yang boleh berubah)"
row_counts > "$WORK/counts_after.txt"
EXPECT_NEW="$(wc -l < "$WORK/pending.txt")"
DIFF="$(diff "$WORK/counts_before.txt" "$WORK/counts_after.txt" || true)"
CHG="$(printf '%s\n' "$DIFF" | grep -E '^[<>]' | sed -E 's/^[<>] //' | cut -d'|' -f1 | sort -u | grep -vx '_prisma_migrations' || true)"
echo "$DIFF" | grep -E '^[<>]' | head -20 | sed 's/^/    /'
for t in $CHG; do grep -q "^$t|" "$WORK/counts_before.txt" && die "tabel lama $t berubah jumlah barisnya oleh migration"; done
ok "tabel lama: jumlah baris identik; tabel baru (tanpa data lama): $(printf '%s' "$CHG" | tr '\n' ' ')"
[ "$(psql_tmp -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$((NAPP + EXPECT_NEW))" ] || die "applied sesudah != applied + pending"; ok "applied di salinan = $NAPP + $EXPECT_NEW = $((NAPP + EXPECT_NEW))"

say "5. Bukti production TIDAK berubah"
LIVE1="$(live_state)"; [ "$LIVE0" = "$LIVE1" ] || die "state production berubah!\n  sebelum: $LIVE0\n  sesudah: $LIVE1"; ok "container/image/restart/release/applied/flag production identik"
curl -fsS --max-time 8 http://127.0.0.1:4000/api/health | grep -q '"ok":true' && ok "health internal OK" || die "health internal tidak OK"
echo "  ringkasan: pending aktual=$NPEND; restore=OK; verifier=OK; migrate salinan=OK; smoke=OK; production tidak diubah"
