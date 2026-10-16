#!/usr/bin/env bash
# REHEARSAL-ONLY RIWAYAT REFERENSI — TIDAK PUNYA JALUR TULIS KE PRODUKSI. (dibangkitkan oleh scripts/gen-release-riwayat-referensi.cjs dari scripts/templates/rehearsal-riwayat-referensi.sh.tpl; JANGAN edit manual)
#
# Membuktikan migrasi 20261202090000_stok_riwayat_referensi pada SALINAN NYATA data produksi, terisolasi:
#   backup produksi TERBARU (pg_dump, baca-saja) → dipulihkan ke container Postgres SEMENTARA di jaringan Docker sendiri (tanpa port, tanpa akses ke jaringan produksi)
#   → image kandidat dibangun dengan tag sementara (TIDAK memakai/retag nama image produksi) → verifier riwayat migrasi → snapshot 26 kelompok SEBELUM
#   → prisma migrate deploy HANYA ke Postgres sementara → uji tabel + constraint + trigger → snapshot SESUDAH (harus identik) → smoke terhadap hasil restore (router saja, tanpa scheduler/WA)
#   → snapshot sesudah smoke (harus identik) → semua container/jaringan/volume/image/berkas sementara dihapus.
#
# JAMINAN (dikunci tes backend/tests/releaseRiwayatReferensi.test.js):
#   • tidak ada `docker compose`, `docker tag`, `up`, `restart`, `migrate deploy` ke produksi, atau tulis ke release aktif / ~/releases;
#   • akses ke produksi HANYA lewat fungsi live_ro (psql dengan default_transaction_read_only=on; dibuktikan menolak CREATE TEMP TABLE) dan pg_dump;
#   • `prisma migrate deploy` hanya dengan DATABASE_URL ke Postgres sementara (nama rr-reh-*, kata sandi acak, tanpa rute ke produksi);
#   • semua docker rm/stop/network rm/volume rm/rmi hanya menyasar nama rr-reh-* yang dibuat skrip ini.
#
#   cat scripts/rehearsal-riwayat-referensi.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rr-reh.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rr-reh.sh <DEPLOY_SHA_40> <BASE_SHA_40>'
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA kandidat 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (live) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/stok-mulai-catat-rekon-okt}"
MIG_LIST="20261202090000_stok_riwayat_referensi"; MIG_SHA="86f852d7da01c2512b7efd3f2bf4f1039cea91230f3ed8fb382db43163b79795"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"
RELEASES="$HOME/releases/klinik-matras"
SRC="$HOME/release-src/klinik-matras.git"
TS="$(date +%Y%m%d_%H%M%S)"
WORK="$HOME/rehearsal-rr/${DEPLOY_SHORT}-${TS}"
RR_NET="rr-reh-net-${TS}"; RR_PG="rr-reh-pg-${TS}"; RR_API="rr-reh-api-${TS}"; RR_VOL="rr-reh-vol-${TS}"; RR_IMG="rr-reh-image:${DEPLOY_SHORT}-${TS}"
REH_PW="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
REH_URL="postgresql://${DB_USER}:${REH_PW}@${RR_PG}:5432/${DB_NAME}"
JWT_REH="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
DUMP="$WORK/live.sql.gz"
PHASE="init"; LIVE_PG=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sg()   { git --git-dir="$SRC" "$@"; }
# SATU-SATUNYA jalur ke produksi: baca-saja di tingkat database (menolak semua tulis, termasuk tabel sementara).
live_ro() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$LIVE_PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
# Postgres SEMENTARA (hasil restore).
rpsql() { docker exec -i "$RR_PG" psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
RPSQL() { rpsql "$1"; }
ROK() { docker exec -i "$RR_PG" psql -U "$DB_USER" -d "$DB_NAME" -X -q -v ON_ERROR_STOP=1 -c "$1" </dev/null >/dev/null 2>&1 || die "perintah yang seharusnya LOLOS ditolak: $2"; }
RTOLAK() { if docker exec -i "$RR_PG" psql -U "$DB_USER" -d "$DB_NAME" -X -q -v ON_ERROR_STOP=1 -c "$1" </dev/null >/dev/null 2>&1; then die "perilaku SALAH — perintah ini seharusnya DITOLAK: $2"; fi; }

cleanup() {
  local rc=$?
  docker rm -f "$RR_API" "$RR_PG" >/dev/null 2>&1 || true
  docker network rm "$RR_NET" >/dev/null 2>&1 || true
  docker volume rm "$RR_VOL" >/dev/null 2>&1 || true
  docker rmi "$RR_IMG" >/dev/null 2>&1 || true
  rm -rf "$WORK" 2>/dev/null || true
  if [ $rc -ne 0 ]; then echo; echo "REHEARSAL GAGAL pada fase ${PHASE}. Produksi TIDAK disentuh (akses hanya baca-saja). Semua sumber daya sementara rr-reh-* dihapus." >&2; fi
  exit $rc
}
trap cleanup EXIT

PHASE="0-lingkungan"; say "0. Lingkungan"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node od; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang) — rehearsal ditunda"
done
exec 9>/tmp/release-rr-rehearsal.lock; flock -n 9 || die "rehearsal ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rr-reh\|rr.reh\|release-rr-rehearsal\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
mkdir -p "$WORK" "$HOME/release-src"
ok "tidak ada deploy lain; direktori kerja sementara ${WORK}"

PHASE="1-sumber"; say "1. Sumber kandidat (baca-saja) dan gerbang migrasi"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" "+refs/heads/main:refs/remotes/origin/main" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA kandidat; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "live ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT} — gabungkan baseline terbaru, ulangi"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan live"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "backend/prisma/migrations/${MIG_LIST}/migration.sql backend/prisma/schema.prisma" ] || die "perubahan backend/prisma bukan TEPAT schema.prisma + migrasi rilis ini"
[ "$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_LIST}/migration.sql" | tr -d '\r' | sha256sum | cut -d' ' -f1)" = "$MIG_SHA" ] || die "isi migrasi ${MIG_LIST} berbeda dari pin sha256 yang diaudit"
SQLM="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG_LIST}/migration.sql" | tr -d '\r')"
! printf '%s\n' "$SQLM" | grep -qiE '^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s)' || die "migrasi memuat DROP/TRUNCATE/DELETE FROM/UPDATE"
! printf '%s\n' "$SQLM" | grep -iE '^\s*ALTER\s+TABLE' | grep -viE '^\s*ALTER\s+TABLE\s+"stok_riwayat_(referensi|impor)"' | grep -q . || die "migrasi mengubah tabel di luar 2 tabel baru"
ok "kandidat ${DEPLOY_SHORT} turunan live ${BASE_SHA:0:8}; prisma = schema.prisma + tepat ${MIG_LIST} (pin sha256 cocok); migrasi aditif murni"

PHASE="2-audit-live-baca-saja"; say "2. Audit produksi — HANYA BACA (default_transaction_read_only=on)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
LIVE_PG="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=postgres")"
[ "$(printf '%s\n' "$LIVE_PG" | grep -c .)" = "1" ] || die "harus tepat satu container postgres"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN live yang diuji ${BASE_SHA:0:8}; produksi bergeser — berhenti"
IMG_LIVE_BEFORE="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; STARTED_BEFORE="$(docker inspect -f '{{.State.StartedAt}}' "$CID_OLD")"
PG_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$LIVE_PG")"
[ "$(live_ro -At -c 'show default_transaction_read_only')" = "on" ] || die "sesi baca-saja tidak aktif"
if live_ro -c 'create temp table rr_uji_tulis(i int)' >/dev/null 2>&1; then die "sesi produksi TIDAK baca-saja (CREATE TEMP TABLE lolos)"; fi
ok "live ${PREV_COMMIT} (container ${CID_OLD:0:12}, image ${IMG_LIVE_BEFORE:7:19}); akses DB produksi terbukti BACA-SAJA (tulis ditolak)"
live_ro -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$WORK/applied.txt"
CAND_MIGS="$(sg ls-tree --name-only "$DEPLOY_SHA" backend/prisma/migrations/ | sed 's|.*/||' | grep -E '^[0-9]{14}_' | LC_ALL=C sort -u)"
SOLO_PROD="$(comm -13 <(printf '%s\n' "$CAND_MIGS") "$WORK/applied.txt" || true)"
[ -z "$SOLO_PROD" ] || { printf '%s\n' "$SOLO_PROD" | sed 's/^/        /'; die "produksi memiliki migrasi yang TIDAK ada di kandidat"; }
PENDING="$(comm -23 <(printf '%s\n' "$CAND_MIGS") "$WORK/applied.txt" || true)"
[ "$PENDING" = "$MIG_LIST" ] || die "migrasi pending bukan TEPAT ${MIG_LIST} (pending: $(printf '%s' "$PENDING" | tr '\n' ' '))"
TERAKHIR="$(tail -n 1 "$WORK/applied.txt")"; [[ "$MIG_LIST" > "$TERAKHIR" ]] || die "nama migrasi tidak lebih baru dari migrasi terpasang terakhir ($TERAKHIR)"
MIG_N="$(wc -l < "$WORK/applied.txt")"
ok "terpasang di produksi: ${MIG_N} (semuanya ada di kandidat); pending = tepat ${MIG_LIST}; terakhir terpasang ${TERAKHIR}"
DB_BYTES="$(live_ro -At -c "select pg_database_size('${DB_NAME}')")"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( DB_BYTES / 1024 * 4 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang (butuh ≈ 4× ukuran DB + 3 GiB; tersedia ${AVAIL_KB} KiB; DB ${DB_BYTES} byte)"
ok "ruang disk cukup (DB $(( DB_BYTES / 1048576 )) MiB; tersedia $(( AVAIL_KB / 1024 )) MiB)"
SNAP_SQL="select 'jurnal', count(*), md5(coalesce(string_agg(e.id::text||e.status::text||e.entry_number, '|' order by e.id),'')) from fin_journal_entries e union all select 'baris_jurnal_saldo', count(*), md5(coalesce(string_agg(l.id::text||l.debit::text||l.credit::text||l.account_id::text||coalesce(l.order_id,'')||coalesce(l.cash_account_id::text,''), '|' order by l.id),'')) from fin_journal_lines l union all select 'saldo_per_akun', count(*), md5(coalesce(string_agg(t.k||t.s, '|' order by t.k),'')) from (select a.code as k, sum(l.debit-l.credit)::text as s from fin_journal_lines l join fin_accounts a on a.id=l.account_id join fin_journal_entries e on e.id=l.entry_id where e.status in ('POSTED','REVERSED') group by a.code) t union all select 'saldo_per_rekening', count(*), md5(coalesce(string_agg(t.k||t.s, '|' order by t.k),'')) from (select c.name as k, sum(l.debit-l.credit)::text as s from fin_journal_lines l join fin_cash_accounts c on c.id=l.cash_account_id join fin_journal_entries e on e.id=l.entry_id where e.status in ('POSTED','REVERSED') group by c.name) t union all select 'stok', count(*), md5(coalesce(string_agg(x.id::text||x.qty::text||coalesce(x.unit_cost::text,'')||x.material_id::text||x.type::text, '|' order by x.id),'')) from stock_movements x union all select 'po', count(*), md5(coalesce(string_agg(p::text, '|' order by p.id),'')) from fin_purchase_orders p union all select 'po_event', count(*), md5(coalesce(string_agg(p.id::text, '|' order by p.id),'')) from fin_purchase_order_events p union all select 'penerimaan', count(*), md5(coalesce(string_agg(g::text, '|' order by g.id),'')) from goods_receipts g union all select 'baris_penerimaan', count(*), md5(coalesce(string_agg(g::text, '|' order by g.id),'')) from goods_receipt_lines g union all select 'payment', count(*), md5(coalesce(string_agg(p.id::text||p.amount::text||coalesce(p.cancelled_at::text,''), '|' order by p.id),'')) from payments p union all select 'order', count(*), md5(coalesce(string_agg(o.id||o.status::text||o.\"paymentStatus\"::text||coalesce(o.paid_at::text,''), '|' order by o.id),'')) from \"Order\" o union all select 'job', count(*), md5(coalesce(string_agg(j.id::text||j.status::text||coalesce(j.route_id::text,''), '|' order by j.id),'')) from jobs j union all select 'route', count(*), md5(coalesce(string_agg(r.id::text||r.status::text, '|' order by r.id),'')) from routes r union all select 'material_issue', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from material_issues m union all select 'transfer', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from stock_transfers m union all select 'stock_count', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from stock_counts m union all select 'stok_rusak', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from damaged_stock_records m union all select 'retur', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from return_records m union all select 'adjustment', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from stock_adjustment_requests m union all select 'replenishment', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from replenishment_requests m union all select 'work_center', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from work_centers m union all select 'plan_v2', count(*), md5(coalesce(string_agg(m::text, '|' order by m.id),'')) from production_run_plans_v2 m union all select 'plan_event', count(*), md5(coalesce(string_agg(m.id::text, '|' order by m.id),'')) from production_plan_schedule_events_v2 m union all select 'flag_v2', count(*), md5(coalesce(string_agg(f.key||f.enabled::text||f.config::text, '|' order by f.key),'')) from v2_feature_flags f union all select 'fin_settings', count(*), md5(coalesce(string_agg(f.key||f.value, '|' order by f.key),'')) from fin_settings f union all select 'production_settings', count(*), md5(coalesce(string_agg(f::text, '|' order by f::text),'')) from production_settings f"

PHASE="3-backup"; say "3. Backup produksi TERBARU (pg_dump baca-saja) + checksum"
docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$LIVE_PG" pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${DUMP}.partial" || die "pg_dump gagal"
gzip -t "${DUMP}.partial" || die "arsip backup rusak"
gzip -dc "${DUMP}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${DUMP}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${DUMP}.partial" "$DUMP"; DUMP_SHA="$(sha256sum "$DUMP" | cut -d' ' -f1)"
live_ro -At -c "$SNAP_SQL" > "$WORK/snap-live.txt" || die "snapshot live gagal"
LC_ALL=C sort -o "$WORK/snap-live.txt" "$WORK/snap-live.txt"  # urutan UNION ALL tidak dijamin — bandingkan terurut
[ "$(wc -l < "$WORK/snap-live.txt")" -ge 25 ] || die "snapshot live tidak lengkap"
ok "backup $(du -h "$DUMP" | cut -f1) sha256 ${DUMP_SHA:0:16}…; snapshot live $(wc -l < "$WORK/snap-live.txt") kelompok"

PHASE="4-postgres-sementara"; say "4. Postgres SEMENTARA terisolasi (jaringan sendiri, tanpa port, kata sandi acak) + restore"
docker network create --internal "$RR_NET" >/dev/null || die "gagal membuat jaringan sementara"
docker volume create "$RR_VOL" >/dev/null || die "gagal membuat volume sementara"
docker run -d --name "$RR_PG" --network "$RR_NET" -v "$RR_VOL":/var/lib/postgresql/data -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$REH_PW" -e POSTGRES_DB="$DB_NAME" "$PG_IMAGE" -c fsync=off -c synchronous_commit=off -c full_page_writes=off >/dev/null || die "gagal menjalankan Postgres sementara"
for i in $(seq 1 60); do docker exec "$RR_PG" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 && break; sleep 2; [ "$i" = 60 ] && die "Postgres sementara tidak siap"; done
sleep 3
[ "$(docker inspect -f '{{len .NetworkSettings.Networks}}' "$RR_PG")" = "1" ] || die "Postgres sementara terhubung ke lebih dari satu jaringan"
[ -z "$(docker port "$RR_PG")" ] || die "Postgres sementara memublikasikan port"
gzip -dc "$DUMP" | docker exec -i "$RR_PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=0 -X -q > "$WORK/restore.log" 2>&1 || true
ERR_RESTORE="$(grep -c 'ERROR' "$WORK/restore.log" || true)"; [ "${ERR_RESTORE:-0}" = "0" ] || { echo "  INFO  ${ERR_RESTORE} baris ERROR saat restore (5 pertama):"; grep 'ERROR' "$WORK/restore.log" | head -n 5 | sed 's/^/        /'; }
[ "$(RPSQL "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" -ge "$MIG_N" ] || die "migrasi pada restore kurang dari produksi"
RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u > "$WORK/applied-restore.txt"
comm -3 "$WORK/applied-restore.txt" <(LC_ALL=C sort -u "$WORK/applied.txt") | grep -q . && echo "  INFO  daftar migrasi restore berbeda dari yang dibaca di live (migrasi baru di sela?):" || true
ok "restore selesai di ${RR_PG} (jaringan internal ${RR_NET}, 1 jaringan, tanpa port)"

PHASE="4b-kontrol-restore"; say "4b. Kontrol 26 kelompok: restore vs live (tepat setelah dump)"
RPSQL "$SNAP_SQL" > "$WORK/snap-sebelum.txt" || die "snapshot restore (sebelum) gagal"
LC_ALL=C sort -o "$WORK/snap-sebelum.txt" "$WORK/snap-sebelum.txt"  # urutan UNION ALL tidak dijamin — bandingkan terurut
[ "$(wc -l < "$WORK/snap-sebelum.txt")" -ge 25 ] || die "snapshot restore tidak lengkap"
if cmp -s "$WORK/snap-live.txt" "$WORK/snap-sebelum.txt"; then ok "restore IDENTIK dengan live pada $(wc -l < "$WORK/snap-sebelum.txt") kelompok"
else
  echo "  INFO  live vs restore berbeda — rincian (transaksi sah di live sejak dump harus tampak sebagai penambahan):"; diff "$WORK/snap-live.txt" "$WORK/snap-sebelum.txt" | sed 's/^/        /' | head -n 20 || true
  while IFS='|' read -r kk nn _; do
    r="$(awk -F'|' -v k="$kk" '$1==k{print $2}' "$WORK/snap-sebelum.txt")"; [ -n "$r" ] && [ "$nn" -ge "$r" ] && [ "$(( nn - r ))" -le 200 ] || die "kelompok $kk: live=$nn restore=${r:-?} (restore tidak boleh melebihi live; selisih wajar ≤ 200)"
  done < "$WORK/snap-live.txt"
  ok "selisih live vs restore hanya penambahan di live sejak dump"
fi

PHASE="5-build-image"; say "5. Build image kandidat dengan tag SEMENTARA (tidak menyentuh nama image produksi; backend produksi tidak disentuh)"
sg archive "$DEPLOY_SHA" backend | tar -x -C "$WORK" || die "git archive gagal"
[ -f "$WORK/backend/Dockerfile" ] && [ -f "$WORK/backend/prisma/migrations/${MIG_LIST}/migration.sql" ] || die "arsip backend tidak lengkap"
( cd "$WORK/backend" && docker build -q -t "$RR_IMG" . ) > "$WORK/build.log" 2>&1 </dev/null || { tail -n 20 "$WORK/build.log"; die "build image sementara gagal"; }
IMG_ID="$(docker image inspect -f '{{.Id}}' "$RR_IMG")"; [ "$IMG_ID" != "$IMG_LIVE_BEFORE" ] || die "image sementara identik dengan image produksi (tidak diharapkan)"
docker run --rm --entrypoint sh "$RR_IMG" -c "cat /app/prisma/migrations/${MIG_LIST}/migration.sql" | tr -d '\r' | sha256sum | cut -d' ' -f1 | grep -Fx "$MIG_SHA" >/dev/null || die "image memuat migrasi berbeda dari pin sha256"
ok "image sementara ${IMG_ID:7:12}; memuat migrasi persis pin sha256"

PHASE="5a-verifier"; say "5a. Verifier riwayat migrasi (image kandidat terhadap RESTORE)"
VER_OUT="$(docker run --rm --network "$RR_NET" -e DATABASE_URL="$REH_URL" "$RR_IMG" node scripts/verify-migration-history.js </dev/null 2>&1)" || { printf '%s\n' "$VER_OUT" | tail -n 12; die "verifier GAGAL"; }
printf '%s\n' "$VER_OUT" | grep -F "pending: ${MIG_LIST}" >/dev/null || { printf '%s\n' "$VER_OUT" | tail -n 6; die "verifier tidak melaporkan pending TEPAT ${MIG_LIST}"; }
ok "verifier: $(printf '%s\n' "$VER_OUT" | sed -n 1p)"

PHASE="6-migrate-rehearsal"; say "6. prisma migrate deploy HANYA ke Postgres sementara (${RR_PG})"
case "$REH_URL" in *"@${RR_PG}:5432/"*) ;; *) die "DATABASE_URL rehearsal tidak menunjuk Postgres sementara";; esac
S_SEBELUM="$(RPSQL "select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable, ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name not in ('stok_riwayat_referensi','stok_riwayat_impor')")"
[ -n "$S_SEBELUM" ] || die "sidik jari skema kosong"
docker run --rm --network "$RR_NET" -e DATABASE_URL="$REH_URL" "$RR_IMG" npx prisma migrate deploy </dev/null > "$WORK/migrate.log" 2>&1 || { tail -n 20 "$WORK/migrate.log"; die "migrate deploy di Postgres sementara GAGAL"; }
grep -E "Applying migration|have been successfully applied" "$WORK/migrate.log" | sed 's/^/        /'
[ "$(grep -c 'Applying migration' "$WORK/migrate.log")" = "1" ] && grep -F "Applying migration \`${MIG_LIST}\`" "$WORK/migrate.log" >/dev/null || die "migrate deploy menerapkan sesuatu selain TEPAT ${MIG_LIST}"
docker run --rm --network "$RR_NET" -e DATABASE_URL="$REH_URL" "$RR_IMG" npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status tidak 'up to date'"
[ "$(RPSQL "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_N + 1 ))" ] || die "jumlah migrasi terpasang pada restore bukan sebelum + 1"
[ "$(RPSQL "select count(*) from information_schema.tables where table_schema='public' and table_name in ('stok_riwayat_referensi','stok_riwayat_impor')")" = "2" ] || die "2 tabel baru tidak terpasang"
for T in stok_riwayat_referensi stok_riwayat_impor; do [ "$(RPSQL "select count(*) from $T")" = "0" ] || die "tabel baru $T TIDAK kosong setelah migrasi (backfill tidak diizinkan)"; done
[ "$(RPSQL "select count(*) from pg_trigger where tgname in ('stok_riwayat_referensi_append_only_trg','stok_riwayat_impor_append_only_trg')")" = "2" ] || die "trigger append-only tidak terpasang"
ok "migrate deploy: tepat ${MIG_LIST} diterapkan (terpasang ${MIG_N} → $(( MIG_N + 1 ))); status up to date; 2 tabel baru kosong; 2 trigger append-only terpasang"

PHASE="6b-constraint"; say "6b. Uji perilaku tabel/constraint/trigger pada hasil restore"
ROK "insert into stok_riwayat_impor (id, hash_konten, ringkasan) values ('00000000-0000-4000-8000-0000000000a1','h','{}'::jsonb)" "impor valid"
INS() { printf "insert into stok_riwayat_referensi (id, impor_id, kunci, revisi, konten_hash, jenis, nama_di_file, satuan_file, sumber_file, sumber_baris, status_verifikasi, alasan_blocker, peringatan, jumlah%s) values ('%s','00000000-0000-4000-8000-0000000000a1','%s',%s,'h','%s','n','METER','f','{1}','%s','{}','{}',%s%s)" "$6" "$1" "$2" "$3" "$4" "$5" "$7" "$8"; }
ROK "$(INS 00000000-0000-4000-8000-0000000000b1 k1 1 PEMAKAIAN_ORDER BELUM_DIVERIFIKASI '' 3 '')" "baris referensi valid"
ROK "$(INS 00000000-0000-4000-8000-0000000000b2 k2 1 PENERIMAAN_TERBUKTI_TANPA_GR PERLU_PEMERIKSAAN '' NULL '')" "jumlah tidak terbaca disimpan kosong (bukan nol)"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b3 k3 1 PEMAKAIAN_ORDER BELUM_DIVERIFIKASI ', tanggal_pemakaian' 3 ", '2026-10-05'")" "tanggal pemakaian terisi"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b4 k4 1 JENIS_LAIN BELUM_DIVERIFIKASI '' 3 '')" "jenis di luar daftar"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b5 k5 1 PEMAKAIAN_ORDER STATUS_LAIN '' 3 '')" "status di luar daftar"
RTOLAK "$(INS 00000000-0000-4000-8000-0000000000b6 k1 1 PEMAKAIAN_ORDER BELUM_DIVERIFIKASI '' 3 '')" "kunci+revisi ganda"
RTOLAK "delete from stok_riwayat_referensi" "DELETE referensi"
RTOLAK "update stok_riwayat_referensi set jumlah = 99" "UPDATE isi referensi"
RTOLAK "delete from stok_riwayat_impor" "DELETE batch impor"
RTOLAK "update stok_riwayat_impor set hash_konten = 'x'" "UPDATE batch impor"
ROK "update stok_riwayat_referensi set aktif = false where id = '00000000-0000-4000-8000-0000000000b1'" "membalik aktif true→false (revisi)"
RTOLAK "update stok_riwayat_referensi set aktif = true where id = '00000000-0000-4000-8000-0000000000b1'" "membalik aktif false→true"
ok "perilaku constraint terbukti di restore backup nyata: tanggal pemakaian/jenis/status salah ditolak; DELETE & UPDATE isi ditolak; hanya aktif true→false yang boleh"
[ "$(RPSQL "select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable, ',' order by table_name, ordinal_position), '')) from information_schema.columns where table_schema='public' and table_name not in ('stok_riwayat_referensi','stok_riwayat_impor')")" = "$S_SEBELUM" ] || die "migrasi MENGUBAH skema tabel lama"
# uji constraint menulis ke tabel baru pada SALINAN; bersihkan agar tabel baru kembali kosong untuk smoke? Tabel append-only tidak bisa dihapus (trigger) — kontrol berikut membuktikan tabel LAMA tidak berubah.
ok "skema tabel lama identik sebelum vs sesudah migrasi"

PHASE="6c-kontrol-sesudah"; say "6c. Kontrol 26 kelompok SEBELUM vs SESUDAH migrasi + uji constraint (harus IDENTIK)"
RPSQL "$SNAP_SQL" > "$WORK/snap-sesudah-migrasi.txt" || die "snapshot sesudah migrasi gagal"
LC_ALL=C sort -o "$WORK/snap-sesudah-migrasi.txt" "$WORK/snap-sesudah-migrasi.txt"  # urutan UNION ALL tidak dijamin — bandingkan terurut
cmp -s "$WORK/snap-sebelum.txt" "$WORK/snap-sesudah-migrasi.txt" || { diff "$WORK/snap-sebelum.txt" "$WORK/snap-sesudah-migrasi.txt" | head -n 20; die "kontrol data BERUBAH setelah migrasi"; }
ok "SELURUH $(wc -l < "$WORK/snap-sesudah-migrasi.txt") kelompok data IDENTIK sebelum vs sesudah migrasi"

PHASE="7-smoke"; say "7. Smoke baca-saja terhadap hasil restore (router Riwayat Referensi saja di image kandidat; tanpa scheduler/WhatsApp/webhook; env produksi TIDAK dimuat)"
docker create --name "$RR_API" --network "$RR_NET" -e DATABASE_URL="$REH_URL" -e JWT_SECRET="$JWT_REH" -e NODE_ENV=production "$RR_IMG" node /app/rr-server.mjs >/dev/null || die "gagal membuat container smoke"
cat > "$WORK/rr-server.mjs" <<'SERVER'
import express from "express";
import { riwayatReferensiRouter } from "/app/src/routes/riwayatReferensi.js";
const app = express();
app.use(express.json({ limit: "10mb" }));
app.get("/api/health", (_q, r) => r.json({ ok: true }));
app.use("/api/inventory/riwayat-referensi", riwayatReferensiRouter);
app.listen(4100, "127.0.0.1", () => console.log("rr-server siap 4100"));
SERVER
cat > "$WORK/rr-smoke.mjs" <<'NODE'
// Smoke BACA-SAJA riwayat referensi (dijalankan di dalam container backend oleh scripts/release-riwayat-referensi.sh; disimpan di repo agar generator tidak bergantung pada helper lokal).
// Tidak memanggil POST /segarkan, /impor yang valid, ataupun penulisan apa pun; tabel referensi tidak boleh berubah selama smoke.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const APP_ROOT = process.env.APP_ROOT || "/app";
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL(APP_ROOT + "/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const MODE = process.env.MODE; // before | after
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
let fail = 0, skip = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const lewati = (n, alasan) => { skip++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const info = (n) => console.log(`  INFO  ${n}`);
const NOL = "00000000-0000-4000-8000-000000000000";
async function api(method, path, token, body = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
  const teks = await r.text(); let json = null; try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  return { status: r.status, json, teks };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const cacah = async () => [await prisma.stockMovement.count(), await prisma.stockAdjustmentRequest.count(), await prisma.stockCount.count(), await prisma.finJournalEntry.count(), await prisma.goodsReceipt.count(), await prisma.returnRecord.count(), await prisma.damagedStockRecord.count()];
const sebelum = await cacah();
if (MODE === "before") {
  info(`baris sebelum: movement=${sebelum[0]} adjustment=${sebelum[1]} stockCount=${sebelum[2]} jurnal=${sebelum[3]} GR=${sebelum[4]} retur=${sebelum[5]} rusak=${sebelum[6]}`);
  console.log("REAL_BEFORE {}");
  console.log("SMOKE_HASIL mode=before fail=0 skip=0");
  await prisma.$disconnect();
  process.exit(0);
}
const penulis = cari((r) => punya(r, P.INVENTORY_WRITE));
const tanpaAkses = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.INVENTORY_WRITE));

const hitungBaru = async () => [Number((await prisma.$queryRawUnsafe("select count(*) from stok_riwayat_referensi"))[0].count), Number((await prisma.$queryRawUnsafe("select count(*) from stok_riwayat_impor"))[0].count)];
const baruSebelum = await hitungBaru();
const auditSebelum = Number((await prisma.$queryRawUnsafe("select count(*) from activity_events where entity_type = $1", "stok_riwayat_referensi"))[0].count);
rec("tabel referensi baru terpasang (hitungan awal dicatat; tidak boleh berubah selama smoke)", Number.isFinite(baruSebelum[0]) && Number.isFinite(baruSebelum[1]), baruSebelum.join(","));
const pen = await prisma.$queryRawUnsafe("select count(*) from pg_trigger where tgname in ('stok_riwayat_referensi_append_only_trg','stok_riwayat_impor_append_only_trg')");
rec("trigger append-only terpasang (2)", Number(pen[0].count) === 2);
const R = "/api/inventory/riwayat-referensi";
for (const [m, p] of [["GET", ""], ["GET", "/ringkasan"], ["GET", "/impor"], ["POST", "/pratinjau"], ["POST", "/impor"], ["POST", "/segarkan"]]) rec(m + " " + R + p + ": tanpa token → 401", (await api(m, R + p, null)).status === 401);
if (tanpaAkses) {
  const tt = tokenUntuk(tanpaAkses);
  for (const [m, p] of [["GET", "/ringkasan"], ["POST", "/pratinjau"], ["POST", "/impor"], ["POST", "/segarkan"]]) rec(m + " " + R + p + ": tanpa izin → 403", (await api(m, R + p, tt, {})).status === 403);
} else lewati("403 tanpa izin", "tidak ada akun tanpa izin tulis");
if (penulis) {
  const t = tokenUntuk(penulis);
  const rg = await api("GET", R + "/ringkasan", t); rec("ringkasan 200, bukanSaldo=true, label referensi", rg.status === 200 && rg.json?.bukanSaldo === true && /bukan transaksi resmi/.test(rg.json?.label || ""), String(rg.status));
  const dft = await api("GET", R, t); rec("daftar 200 (GET murni baca; total = jumlah baris aktif)", dft.status === 200 && dft.json?.total <= baruSebelum[0], String(dft.json?.total));
  for (const p of ["", "/ringkasan", "/impor", "?semuaRevisi=1"]) rec("GET " + R + p + " dua kali → 200 (membuka tab tidak menulis)", (await api("GET", R + p, t)).status === 200 && (await api("GET", R + p, t)).status === 200);
  const sg = await api("POST", R + "/segarkan", t, {}); rec("POST /segarkan tanpa konfirmasi → 400 KONFIRMASI_DIPERLUKAN (snapshot adalah tindakan manual; tidak menulis)", sg.status === 400 && sg.json?.code === "KONFIRMASI_DIPERLUKAN", String(sg.status));
  rec("pratinjau tanpa berkas → 400 (tidak menulis)", (await api("POST", R + "/pratinjau", t, {})).status === 400);
  const imp = await api("POST", R + "/impor", t, { pakaiCsv: "x", konfirmasiHash: "salah" }); rec("impor dengan hash salah → 409 PRATINJAU_BERUBAH (tidak menulis)", imp.status === 409 && imp.json?.code === "PRATINJAU_BERUBAH", String(imp.status));
  rec("material id bukan UUID → 400", (await api("GET", R + "/material/bukan-uuid", t)).status === 400);
} else lewati("pemeriksaan dengan akun penulis", "tidak ada akun aktif pemegang inventory:write");
const baruSesudah = await hitungBaru(); rec("smoke tidak menulis tabel referensi baru (revisi, batch impor)", baruSesudah[0] === baruSebelum[0] && baruSesudah[1] === baruSebelum[1], baruSebelum.join(",") + " -> " + baruSesudah.join(","));
const auditSesudah = Number((await prisma.$queryRawUnsafe("select count(*) from activity_events where entity_type = $1", "stok_riwayat_referensi"))[0].count); rec("smoke tidak menambah audit stok_riwayat_referensi", auditSesudah === auditSebelum, auditSebelum + " -> " + auditSesudah);
const sesudah = await cacah();
rec("tidak ada baris berubah selama smoke (movement, adjustment, count, jurnal, GR, retur, rusak)", sebelum.every((n, i) => sesudah[i] >= n), sebelum.join(",") + " -> " + sesudah.join(","));
rec("smoke tidak membuat dokumen", sesudah[1] === sebelum[1] && sesudah[2] === sebelum[2] && sesudah[5] === sebelum[5] && sesudah[6] === sebelum[6], "adjustment/count/retur/rusak tetap");
await prisma.$disconnect();
console.log(`SMOKE_HASIL mode=${MODE} fail=${fail} skip=${skip}`);
process.exit(fail ? 1 : 0);
NODE
docker cp "$WORK/rr-server.mjs" "$RR_API":/app/rr-server.mjs && docker cp "$WORK/rr-smoke.mjs" "$RR_API":/app/rr-smoke.mjs || die "gagal menyalin berkas smoke"
docker start "$RR_API" >/dev/null || die "gagal menjalankan server smoke"
for i in $(seq 1 30); do docker exec "$RR_API" node -e 'fetch("http://127.0.0.1:4100/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1 && break; sleep 2; [ "$i" = 30 ] && { docker logs "$RR_API" 2>&1 | tail -n 15; die "server smoke tidak siap"; }; done
SMOKE_OUT="$(docker exec -w /app -e MODE=after -e SMOKE_BASE=http://127.0.0.1:4100 "$RR_API" node rr-smoke.mjs 2>&1)" || { printf '%s\n' "$SMOKE_OUT" | tail -n 30; die "smoke GAGAL"; }
printf '%s\n' "$SMOKE_OUT" | sed 's/^/        /'
printf '%s\n' "$SMOKE_OUT" | grep -E 'SMOKE_HASIL mode=after fail=0' >/dev/null || die "smoke tidak melaporkan fail=0"
ok "smoke lulus: $(printf '%s\n' "$SMOKE_OUT" | grep SMOKE_HASIL)"
RPSQL "$SNAP_SQL" > "$WORK/snap-sesudah-smoke.txt" || die "snapshot sesudah smoke gagal"
LC_ALL=C sort -o "$WORK/snap-sesudah-smoke.txt" "$WORK/snap-sesudah-smoke.txt"  # urutan UNION ALL tidak dijamin — bandingkan terurut
cmp -s "$WORK/snap-sebelum.txt" "$WORK/snap-sesudah-smoke.txt" || { diff "$WORK/snap-sebelum.txt" "$WORK/snap-sesudah-smoke.txt" | head -n 20; die "kontrol data BERUBAH setelah smoke"; }
ok "SELURUH kelompok data tetap IDENTIK sesudah smoke"

PHASE="8-bukti-produksi-tak-berubah"; say "8. Bukti produksi TIDAK berubah"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$IMG_LIVE_BEFORE" ] && [ "$(docker inspect -f '{{.State.StartedAt}}' "$CID_OLD")" = "$STARTED_BEFORE" ] || die "container backend produksi berubah"
[ "$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")" = "$PREV_COMMIT" ] || die "release aktif berubah"
live_ro -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort -u | cmp -s - "$WORK/applied.txt" || die "daftar migrasi produksi berubah"
[ "$(live_ro -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('stok_riwayat_referensi','stok_riwayat_impor')")" = "0" ] || die "tabel baru muncul di PRODUKSI (tidak diharapkan)"
curl -fsS --max-time 8 http://127.0.0.1:4000/api/health | grep '"ok":true' >/dev/null || die "health produksi tidak ok"
ok "produksi: container/image/StartedAt sama, release aktif sama, ${MIG_N} migrasi sama, tabel baru TIDAK ada di produksi, health ok"

say "REHEARSAL LULUS — kandidat ${DEPLOY_SHORT} di atas live ${BASE_SHA:0:8}; produksi tidak berubah; sumber daya sementara dihapus"
