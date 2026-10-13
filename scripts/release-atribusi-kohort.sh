#!/usr/bin/env bash
# Rilis KODE SAJA "Kohort atribusi Fase 1" (GET /api/atribusi/kohort, ADMIN, baca-saja) — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA).
#
# YANG DILAKUKAN : deploy kode (route, service attribution/*, tes, dokumen) + backend di-recreate SATU kali dengan image baru.
# YANG TIDAK     : TIDAK ada migrasi/skema, TIDAK mengubah .env (hash dibandingkan sebelum/sesudah), TIDAK membangun frontend (dist disalin dari release aktif),
#                  TIDAK menyentuh capture CTWA (env CTWA_* dan berkas capture dibandingkan sebelum/sesudah), TIDAK menghapus release/image/berkas lama,
#                  TIDAK rollback otomatis (rollback = mode --rollback, dijalankan manual), TIDAK push/merge.
# BERHENTI BILA  : baseline live berubah (SHA/image/release); mount /app/data tidak sesuai; disk bebas < 5 GiB; pg_dump/verifikasi restore gagal;
#                  ada berkas di luar allowlist; isi berkas runtime berbeda dari pin sha256; ada migration pending; .env berubah; angka endpoint != SQL independen.
#
# Pemakaian (dari laptop; sumber: bundle git, TANPA push):
#   git bundle create /tmp/atrk.bundle <BASE_SHA>..<CAND_BRANCH>
#   scp /tmp/atrk.bundle ubuntu@43.133.152.6:/tmp/atrk.bundle
#   cat scripts/release-atribusi-kohort.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/atrk1.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/atrk.bundle bash /tmp/atrk1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/atrk.bundle bash /tmp/atrk1.sh <DEPLOY_SHA_40> <BASE_SHA_40>'                    # rilis
#   ssh ubuntu@43.133.152.6 'bash /tmp/atrk1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --verify-only'                              # smoke ulang (baca-saja)
#   ssh ubuntu@43.133.152.6 'bash /tmp/atrk1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rollback'                                 # kembali ke release/image sebelum rilis
#
# Kode keluar: 0 selesai & terverifikasi | 1 berhenti (lihat instruksi rollback) | 3 rilis aktif tetapi angka belum stabil untuk dibandingkan (trafik) — jalankan --verify-only.
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
MODE=release
for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --verify-only) MODE=verify;; --rollback) MODE=rollback;; esac; done

MIN_FREE_KB=$((5 * 1024 * 1024))     # 5 GiB — gerbang keras (awal, setelah backup, sebelum build, sebelum switch)
CAND_BRANCH="${CAND_BRANCH:-rc/atribusi-kohort-on-live-c220e72d}"
CAND_REF="refs/remotes/origin/cand-atrk"      # ref UNIK: repo sumber dipakai bersama skrip rilis lain (refs/remotes/origin/cand bisa tertimpa sesi lain)
BUNDLE="${BUNDLE:-}"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"
TAG_KODE="atrk"

# Hanya berkas ini yang BOLEH berbeda dari baseline (path persis; migrasi/schema/package/compose/frontend/Finance/Production/CTWA = berhenti).
ALLOWED_RE='^(backend/src/index\.js|backend/src/routes/attributionCohort\.js|backend/src/services/attribution/(cohort|cohortDefinitions|cohortLoader|cohortReport)\.js|backend/tests/(attributionCohort|attributionCohortAudit|attributionCohortReport|releaseAtribusiKohort)\.test\.js|backend/tests/fixtures/attributionAuditShape\.js|backend/tests/integration/attributionCohort\.integration\.test\.js|docs/ATRIBUSI-COHORT-FASE1\.md|scripts/release-atribusi-kohort\.sh)$'
# Pin sha256 (teks LF) berkas RUNTIME. Isi berbeda dari pin = berhenti sampai ditinjau ulang.
declare -A PINS=(
  ["backend/src/index.js"]="6096bddae110a9b78cb33ebebcae8e53c10cb5aa69e28d07adc2b00beb16d80b"
  ["backend/src/routes/attributionCohort.js"]="dc332e106ed5727067ff6eaa52e66427cda8ac6b9bf4f2ec9fa78f7bc0c453d3"
  ["backend/src/services/attribution/cohort.js"]="c74d0f45feeba0baac178a23fc0c635bb608cc074f87b6ba11a883ede53eb495"
  ["backend/src/services/attribution/cohortDefinitions.js"]="3f6589c364f20dcb6717c77bd009fda64ccae4375621ade2bd225f721e442a53"
  ["backend/src/services/attribution/cohortLoader.js"]="153054a65609a251c111096c09011d992bf66f7c37944f1ba4675f58f99ad359"
  ["backend/src/services/attribution/cohortReport.js"]="c5b35ed938ba983f09baec8915dbe7acfcae7ebcc621f9ea22139dc48536c979"
)

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

# ── Fungsi gerbang MURNI (diuji lewat ATRK_RELEASE_SELFTEST=1 tanpa menyentuh produksi) ──────────────────────────────────
gate_disk_kb()   { [[ "${1:-}" =~ ^[0-9]+$ ]] || return 2; [ "$1" -ge "$MIN_FREE_KB" ]; }
gate_mount_text(){ printf '%s\n' "$1" | grep -Fxq "bind|${2}|/app/data|true"; }
sha_lf()         { tr -d '\r' | sha256sum | cut -d' ' -f1; }
# Bandingkan dua baris snapshot 'a|b|c|...' : 0 = identik; 1 = berbeda; 2 = salah satu kosong/bukan angka-pipa.
snap_valid()     { [[ "${1:-}" =~ ^[0-9]+(\|[0-9-]+)+$ ]]; }
snap_equal()     { snap_valid "$1" && snap_valid "$2" || return 2; [ "$1" = "$2" ]; }
# Kunci data terlarang pada JSON respons ($1): campaign/ad set/ad ID, CPA, ROAS, pengenal pribadi. Mengembalikan 0 bila BERSIH.
respons_bersih() { ! printf '%s' "$1" | grep -Eq '"(campaignId|adSetId|adId|campaign|adSet|ad|cpa|roas|ctwaClid|leadSourceDetail|phone|name)"[[:space:]]*:'; }

if [ "${ATRK_RELEASE_SELFTEST:-}" = "1" ]; then
  fail=0
  t() { if "$@"; then printf 'PASS %s\n' "$*"; else printf 'FAIL %s\n' "$*"; fail=1; fi; }
  f() { if "$@"; then printf 'FAIL(harus gagal) %s\n' "$*"; fail=1; else printf 'PASS(gagal sesuai harapan) %s\n' "$*"; fi; }
  t gate_disk_kb 5242880; t gate_disk_kb 9999999; f gate_disk_kb 5242879; f gate_disk_kb 0; f gate_disk_kb ""; f gate_disk_kb "abc"; f gate_disk_kb "4.6G"
  M=$'bind|/home/ubuntu/klinik-matras/backend/uploads|/app/uploads|true\nbind|/home/ubuntu/klinik-matras/backend/data|/app/data|true'
  t gate_mount_text "$M" /home/ubuntu/klinik-matras/backend/data
  f gate_mount_text "$M" /home/ubuntu/lain/backend/data
  f gate_mount_text $'bind|/home/ubuntu/klinik-matras/backend/data|/app/data|false' /home/ubuntu/klinik-matras/backend/data
  f gate_mount_text "" /home/ubuntu/klinik-matras/backend/data
  t snap_equal "8849|617|1365529000|558|292|287|270|1|2250000|639041000" "8849|617|1365529000|558|292|287|270|1|2250000|639041000"
  f snap_equal "8849|617|1365529000|558|292|287|270|1|2250000|639041000" "8849|617|1365529000|558|292|287|270|0|0|639041000"
  f snap_equal "" "8849|617"; f snap_equal "8849|617" "x|y"
  t respons_bersih '{"perBulanLead":{"2026-09":{"leads":1}},"definisi":[{"id":"atribusi_campaign","label":"Atribusi campaign"}]}'
  f respons_bersih '{"x":{"campaignId":"123"}}'; f respons_bersih '{"roas": 1.2}'; f respons_bersih '{"cpa":null}'; f respons_bersih '{"ad":{"id":null}}'; f respons_bersih '{"phone":"62"}'
  [ "$(printf 'a\r\nb\r\n' | sha_lf)" = "$(printf 'a\nb\n' | sha_lf)" ] && echo "PASS sha_lf CRLF=LF" || { echo "FAIL sha_lf"; fail=1; }
  exit "$fail"
fi

[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA kandidat 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; BASE_SHORT="${BASE_SHA:0:8}"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/${TAG_KODE}-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; VERIFY_DB=""
ROLLBACK_TAG="klinik-matras-backend:rollback-pre-${TAG_KODE}-${DEPLOY_SHORT}"

sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
avail_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
disk_gate() { local a; a="$(avail_kb)"; gate_disk_kb "$a" || die "disk bebas $(( ${a:-0} / 1024 )) MiB < 5 GiB (${1}) — berhenti, tidak ada yang diubah setelah titik ini"; ok "disk bebas $(( a / 1024 )) MiB >= 5 GiB (${1})"; }
mounts_of() { docker inspect -f '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{"\n"}}{{end}}' "$1"; }
mount_gate() { gate_mount_text "$(mounts_of "$1")" "$PERSIST/backend/data" || die "mount /app/data ($2) BUKAN bind rw ke ${PERSIST}/backend/data — berhenti"; ok "mount /app/data ($2) = bind rw ${PERSIST}/backend/data"; }
drop_verify_db() { [ -n "$VERIFY_DB" ] && [ -n "$PREV_DIR" ] && dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${VERIFY_DB}\"" </dev/null >/dev/null 2>&1 || true; }
backend_cid() { docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend"; }
env_sha() { sha256sum "$PERSIST/backend/.env" | cut -d' ' -f1; }
ctwa_env_count() { docker exec "$1" sh -c 'env | grep -c "^CTWA_" || true'; }
capture_count() { docker exec "$1" sh -c 'find /app/data -maxdepth 2 -name "ctwa-capture*" 2>/dev/null | wc -l'; }

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa)
Image sebelumnya   : ${ROLLBACK_TAG}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya (tidak ada yang perlu dipulihkan).
Setelah switch bermasalah (satu perintah, bergerbang):
   bash /tmp/atrk1.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback
Setara manual:
   docker tag ${ROLLBACK_TAG} klinik-matras-backend:latest
   cd ${RELEASES}/${BASE_SHORT} && SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Tidak ada migrasi, tidak ada tulis data oleh endpoint: rollback = kode saja; pemulihan database TIDAK diperlukan. .env dan capture CTWA tidak disentuh.
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; drop_verify_db; [ $rc -ne 0 ] && [ "$MODE" = "release" ] && rollback_instructions; exit $rc' EXIT

# ── SQL pembanding INDEPENDEN (bukan kode kohort): angka yang harus sama dengan riwayatPenuh endpoint ────────────────────
# Format: leads|eligible|booked|lunasCrm|berLedger|terbuktiLedger|lunasTanpaLedger|konflik|kekuranganKonflik|uangLedger
# Valid persis hanya bila alokasi=0, refund DISETUJUI=0, order group=0 (dicek terpisah; bila tidak, hanya 4 angka pertama yang dibandingkan).
read -r -d '' SNAP_SQL <<'SQL' || true
with g as (
  select (coalesce((select value from fin_settings where key='payment_verification_gate'),'false')='true') as aktif,
         nullif((select value from fin_settings where key='payment_verification_gate_since'),'')::timestamptz as since
), lead as (
  select id from "Customer"
  where "pipelineStage"<>'SPAM' and coalesce("leadSource"::text,'')<>'B2B_DIRECT' and not is_internal_staff and staff_user_id is null
), ord as (
  select o.id, o.value, coalesce(o.ongkir,0) as ongkir, o."paymentStatus"::text as pst, o.status::text as st
  from "Order" o join lead l on l.id=o."customerId"
  where o.penjualan_karyawan_id is null and o.status<>'CANCELLED'
), pc as (
  select p.order_id, sum(p.amount)::bigint as amt, count(*) as n
  from payments p cross join g
  where p.cancelled_at is null
    and (not g.aktif or g.since is null or p.created_at < g.since or exists (select 1 from payment_verifications v where v.payment_id=p.id))
  group by p.order_id
), el as (
  select ord.*, pc.amt, pc.n from ord left join pc on pc.order_id=ord.id where ord.st<>'PENDING'
)
select concat_ws('|',
  (select count(*) from lead),
  (select count(*) from el),
  (select coalesce(sum(value),0) from el),
  (select count(*) from el where pst='LUNAS'),
  (select count(*) from el where n>0),
  (select count(*) from el where n>0 and value+ongkir>0 and amt>=value+ongkir),
  (select count(*) from el where pst='LUNAS' and n is null),
  (select count(*) from el where pst='LUNAS' and n>0 and amt<value+ongkir),
  (select coalesce(sum(value+ongkir-amt),0) from el where pst='LUNAS' and n>0 and amt<value+ongkir),
  (select coalesce(sum(pc.amt),0) from ord join pc on pc.order_id=ord.id)
);
SQL
snap_sql() { psql_live -At -c "$SNAP_SQL"; }
exact_sql_ok() {
  local a r gcount
  a="$(psql_live -At -c "select count(*) from fin_payment_allocations")"
  r="$(psql_live -At -c "select count(*) from fin_refunds where status='DISETUJUI'")"
  gcount="$(psql_live -At -c "select count(*) from order_groups")"
  [ "$a" = "0" ] && [ "$r" = "0" ] && [ "$gcount" = "0" ]
}

# Smoke di DALAM container: token ADMIN/SALES dibuat di memori (rahasia JWT tidak keluar dari container, token tidak dicetak), hanya agregat dicetak.
read -r -d '' SMOKE_JS <<'JS' || true
const jwt = require("jsonwebtoken"); const http = require("http"); const { PrismaClient } = require("@prisma/client");
const port = Number(process.env.PORT || 4000);
const get = (path, token) => new Promise((res, rej) => {
  const r = http.get({ host: "127.0.0.1", port, path, headers: token ? { Authorization: "Bearer " + token } : {} }, (x) => {
    let b = ""; x.on("data", (c) => (b += c)); x.on("end", () => res({ status: x.statusCode, headers: x.headers, body: b }));
  });
  r.on("error", rej); r.setTimeout(60000, () => r.destroy(new Error("timeout")));
});
(async () => {
  const prisma = new PrismaClient();
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true } });
  await prisma.$disconnect();
  if (!admin) { console.log("ERROR=tidak ada user ADMIN aktif"); process.exit(2); }
  const sign = (id, roles) => jwt.sign({ id, name: "smoke", role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: 600 });
  const bulan = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
  const path = `/api/atribusi/kohort?dari=2026-07&sampai=${bulan}`;
  const noAuth = await get(path);
  const sales = await get(path, sign("00000000-0000-0000-0000-000000000000", ["SALES"]));
  const bad = await get("/api/atribusi/kohort?dari=2026-13", sign(admin.id, ["ADMIN"]));
  const r = await get(path, sign(admin.id, ["ADMIN"]));
  console.log("STATUS_NOAUTH=" + noAuth.status); console.log("STATUS_SALES=" + sales.status); console.log("STATUS_PARAM_SALAH=" + bad.status); console.log("STATUS_ADMIN=" + r.status);
  console.log("CACHE=" + (r.headers["cache-control"] || ""));
  if (r.status !== 200) { console.log("ERROR=admin status " + r.status); process.exit(3); }
  const j = JSON.parse(r.body);
  const t = j.riwayatPenuh.total, b = t.buktiPelunasan;
  console.log("REKON_OK=" + j.rekonsiliasi.ok); console.log("REKON_CEK=" + j.rekonsiliasi.cek.length);
  console.log("REKON_GAGAL=" + j.rekonsiliasi.cek.filter((c) => !c.ok).map((c) => c.id).join(","));
  const partisi = t.lunasMenurutCrm.jumlah === b.lunasTerbuktiLedger + b.lunasTanpaLedger + b.konflikLunasTersimpanLedgerTidakCukup
    && t.lunasTerbuktiLedger.jumlah === b.lunasTerbuktiLedger + b.konflikBelumLunasTersimpanLedgerCukup;
  console.log("PARTISI_OK=" + partisi);
  console.log("SNAP=" + [t.leads, t.orders, t.nilaiOrder, t.lunasMenurutCrm.jumlah, t.orderBerLedger, t.lunasTerbuktiLedger.jumlah, b.lunasTanpaLedger, b.konflikLunasTersimpanLedgerTidakCukup, b.kekuranganRupiahKonflik, t.uangLedger].join("|"));
  console.log("KONFLIK=" + b.konflikLunasTersimpanLedgerTidakCukup); console.log("KEKURANGAN=" + b.kekuranganRupiahKonflik);
  console.log("BELUM_LUNAS_LEDGER_CUKUP=" + b.konflikBelumLunasTersimpanLedgerCukup);
  console.log("CRM=" + t.lunasMenurutCrm.jumlah); console.log("TERBUKTI_LEDGER=" + t.lunasTerbuktiLedger.jumlah); console.log("TANPA_LEDGER=" + b.lunasTanpaLedger);
  console.log("BACKFILL_TIDAK_PASTI=" + t.lunasMenurutCrm.tanggalTidakPasti);
  console.log("BOOKED=" + t.nilaiOrder); console.log("UANG_LEDGER=" + t.uangLedger);
  console.log("PERINGATAN=" + j.peringatan.map((w) => w.kode).join(","));
  const terlarang = /"(campaignId|adSetId|adId|campaign|adSet|ad|cpa|roas|ctwaClid|leadSourceDetail|phone|name)"\s*:/.exec(r.body);
  console.log("FORBIDDEN=" + (terlarang ? terlarang[1] : "none"));
  console.log("ROAS_CPA_KATA=" + /\b(roas|cpa)\b/i.test(r.body));
})().catch((e) => { console.log("ERROR=" + String(e.message).slice(0, 120)); process.exit(4); });
JS

# Verifikasi pasca-rilis BACA-SAJA (fase 8 dan --verify-only). 0 = lulus penuh, 3 = lulus tetapi angka belum stabil untuk dibandingkan.
verify_live() {
  local since_utc="$1" cid dir out k
  cid="$(backend_cid)"
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
  done; ok "${#PINS[@]} berkas runtime di container = pin sha256"
  local logs errn
  logs="$(docker logs --since "$since_utc" "$cid" 2>&1 || true)"
  errn="$(printf '%s\n' "$logs" | grep -cE 'unhandledRejection|ReferenceError|SyntaxError|Cannot find module|TypeError|atribusi/kohort error' || true)"
  [ "$errn" = "0" ] || { printf '%s\n' "$logs" | grep -E 'unhandledRejection|ReferenceError|SyntaxError|Cannot find module|TypeError|atribusi/kohort error' | cut -c1-160 | head -5 | sed 's/^/        /'; die "${errn} baris galat runtime sejak switch"; }
  ok "log sejak ${since_utc}: 0 galat runtime"
  # ── smoke endpoint + pembanding SQL independen (dua snapshot SQL mengapit satu panggilan; harus identik agar adil terhadap trafik) ──
  local try s1 s2 stabil=0 exact=0
  exact_sql_ok && exact=1
  for try in 1 2 3; do
    s1="$(PREV_DIR="$dir" snap_sql)"
    out="$(printf '%s' "$SMOKE_JS" | docker exec -i "$cid" node - 2>&1)" || { printf '%s\n' "$out" | cut -c1-200 | head -5 | sed 's/^/        /'; die "smoke endpoint gagal"; }
    s2="$(PREV_DIR="$dir" snap_sql)"
    if snap_equal "$s1" "$s2"; then stabil=1; break; fi
    warn "trafik mengubah data antar snapshot (percobaan ${try}/3); ulangi"; sleep 5
  done
  val() { printf '%s\n' "$out" | sed -n "s/^$1=//p" | head -1; }
  [ "$(val STATUS_NOAUTH)" = "401" ] || die "tanpa token harus 401 (dapat $(val STATUS_NOAUTH))"
  [ "$(val STATUS_SALES)" = "403" ] || die "token SALES harus 403 (dapat $(val STATUS_SALES))"
  [ "$(val STATUS_PARAM_SALAH)" = "400" ] || die "parameter salah harus 400 (dapat $(val STATUS_PARAM_SALAH))"
  [ "$(val STATUS_ADMIN)" = "200" ] || die "ADMIN harus 200 (dapat $(val STATUS_ADMIN))"
  [ "$(val CACHE)" = "no-store" ] || die "Cache-Control harus no-store"
  ok "RBAC: tanpa token 401, SALES 403, parameter salah 400, ADMIN 200; no-store"
  [ "$(val REKON_OK)" = "true" ] || die "rekonsiliasi internal GAGAL: $(val REKON_GAGAL)"; ok "rekonsiliasi internal OK ($(val REKON_CEK) pemeriksaan)"
  [ "$(val PARTISI_OK)" = "true" ] || die "partisi bukti pelunasan tidak konsisten (LUNAS CRM != terbukti + tanpa ledger + konflik)"
  ok "LUNAS CRM = terbukti ledger + tanpa ledger + konflik; lunas terbukti ledger = terbukti + ledger-cukup-CRM-belum"
  [ "$(val FORBIDDEN)" = "none" ] && [ "$(val ROAS_CPA_KATA)" = "false" ] || die "respons memuat kunci/kata terlarang ($(val FORBIDDEN), roas/cpa=$(val ROAS_CPA_KATA))"
  ok "respons: 0 field campaign/ad set/ad ID/CPA/ROAS/pengenal pribadi"
  ok "angka: $(val CRM) LUNAS CRM | $(val TERBUKTI_LEDGER) terbukti ledger | $(val TANPA_LEDGER) tanpa ledger | $(val KONFLIK) konflik (kekurangan Rp$(val KEKURANGAN)) | backfill tidak pasti $(val BACKFILL_TIDAK_PASTI)"
  ok "booked $(val BOOKED) vs uang ledger $(val UANG_LEDGER) (angka berbeda, tidak dijumlahkan)"
  ok "peringatan: $(val PERINGATAN)"
  local snap; snap="$(val SNAP)"
  if [ "$stabil" = "1" ]; then
    if [ "$exact" = "1" ]; then
      snap_equal "$snap" "$s1" || die "angka endpoint != SQL independen: endpoint=${snap} sql=${s1}"
      ok "endpoint = SQL independen (10 angka identik): ${snap}"
    else
      [ "$(cut -d'|' -f1-4 <<<"$snap")" = "$(cut -d'|' -f1-4 <<<"$s1")" ] || die "angka dasar endpoint != SQL independen: endpoint=${snap} sql=${s1}"
      warn "alokasi/refund/order group > 0: hanya 4 angka dasar dibandingkan (leads, order, booked, LUNAS CRM)"
    fi
    return 0
  fi
  warn "data berubah di setiap percobaan (trafik): perbandingan SQL TERTUNDA (bukan gagal). Jalankan --verify-only"
  return 3
}

if [ "$MODE" = "verify" ]; then
  say "VERIFY-ONLY (baca-saja) rilis ${DEPLOY_SHORT}"
  PREV_DIR="$RELEASES/$DEPLOY_SHORT"; [ -d "$PREV_DIR" ] || die "release dir ${PREV_DIR} tidak ada"
  rc=0; verify_live "${VERIFY_SINCE_UTC:-$(date -u -d '-30 minutes' +%Y-%m-%dT%H:%M:%SZ)}" || rc=$?
  trap - EXIT; exit "$rc"
fi

if [ "$MODE" = "rollback" ]; then
  say "ROLLBACK ${DEPLOY_SHORT} -> ${BASE_SHORT} (kode saja; tanpa migrasi, tanpa data, .env tidak disentuh)"
  OLD_DIR="$RELEASES/$BASE_SHORT"
  [ -d "$OLD_DIR" ] && [ -f "$OLD_DIR/docker-compose.release.yml" ] || die "release sebelumnya ${OLD_DIR} tidak ada/tidak lengkap"
  docker image inspect "$ROLLBACK_TAG" >/dev/null 2>&1 || die "image rollback ${ROLLBACK_TAG} tidak ada"
  CID="$(backend_cid)"; [ "$(printf '%s\n' "$CID" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
  CUR_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID")"
  [ "$CUR_DIR" = "$NEW_DIR" ] || die "release aktif (${CUR_DIR}) BUKAN ${DEPLOY_SHORT}; rollback ini tidak berlaku (jangan menimpa rilis lain)"
  for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; [ "$lf" = "/tmp/release-atribusi-kohort.lock" ] && continue; [ "$lf" = "/tmp/release-atribusi-kohort-giliran.lock" ] && continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf})"; done
  exec 9>/tmp/release-atribusi-kohort.lock; flock -n 9 || die "rilis/rollback ini sudah berjalan"
  CTWA_B="$(ctwa_env_count "$CID")"; ENV_B="$(env_sha)"
  IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID")"
  docker tag "$ROLLBACK_TAG" "$IMG_NAME" || die "gagal menandai ulang image"
  dcp "$OLD_DIR" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "docker compose up (rollback) gagal"
  UP=0; for _ in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
  [ "$UP" = "1" ] || die "backend tidak sehat dalam 90 detik setelah rollback"
  CID2="$(backend_cid)"
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID2")" = "$OLD_DIR" ] || die "container tidak berasal dari ${OLD_DIR}"
  [ "$(tr -d '[:space:]' < "$OLD_DIR/.release-commit")" = "$BASE_SHORT" ] || die ".release-commit ${OLD_DIR} != ${BASE_SHORT}"
  [ "$(env_sha)" = "$ENV_B" ] || die ".env berubah selama rollback (tidak diharapkan)"
  [ "$(ctwa_env_count "$CID2")" = "$CTWA_B" ] || die "jumlah variabel CTWA_* berubah"
  [ "$(docker inspect -f '{{.RestartCount}}' "$CID2")" = "0" ] || die "RestartCount != 0"
  curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"
  ok "rollback selesai: release ${BASE_SHORT}, image $(docker inspect -f '{{.Image}}' "$CID2" | cut -c8-19), .env tidak berubah, CTWA_* ${CTWA_B}"
  trap - EXIT; exit 0
fi

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df find; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; [ "$lf" = "/tmp/release-atribusi-kohort-giliran.lock" ] && continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"; done
exec 9>/tmp/release-atribusi-kohort.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "atrk1\|release-atribusi-kohort\|pgrep\|node src/index.js" || true)"
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
  sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch dari bundle gagal"
else
  sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
  sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "git fetch gagal (branch kandidat sudah dipush?)"
fi
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat (${CAND_BRANCH}) BUKAN SHA rilis; bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHORT} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHORT} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist yang berbeda dari baseline — berhenti"; }
! printf '%s\n' "$CHANGED" | grep -qE '^backend/prisma/|package(-lock)?\.json$|^docker-compose|Dockerfile$|^frontend/|touchContract|cohort-report' || die "schema/migration/dependensi/compose/frontend/touch-contract/CLI berubah — rilis ini harus KODE SAJA"
ok "$(printf '%s\n' "$CHANGED" | wc -l) berkas berbeda dari baseline ${BASE_SHORT}, SEMUA dalam allowlist; tanpa migration/dependensi/compose/frontend"
for f in "${!PINS[@]}"; do
  have="$(sg show "${DEPLOY_SHA}:${f}" | sha_lf)"
  [ "$have" = "${PINS[$f]}" ] || die "isi ${f} di kandidat (${have:0:12}) BERBEDA dari pin (${PINS[$f]:0:12}) — tinjau ulang lalu perbarui pin"
done; ok "${#PINS[@]} berkas runtime di kandidat = pin sha256"
# Tidak ada kunci data terlarang pada kode produksi route/service
! sg grep -nE '\b(roas|cpa)\b|campaignId|adSetId' "$DEPLOY_SHA" -- backend/src/routes/attributionCohort.js backend/src/services/attribution >/dev/null 2>&1 || die "kode atribusi memuat kunci campaign/ad/CPA/ROAS"
ok "kode atribusi tidak memuat campaign/ad set/ad ID, CPA, ROAS"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(backend_cid)"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHORT}; produksi bergeser — berhenti, rebase kandidat"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
[ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag ${IMG_NAME} menunjuk image lain dari container aktif (recreate akan memakai image yang tidak sama)"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_OLD")" = "true" ] && [ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "0" ] || die "backend aktif tidak stabil (RestartCount != 0)"
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
ENV_BEFORE="$(env_sha)"; CTWA_BEFORE="$(ctwa_env_count "$CID_OLD")"; CAPTURE_BEFORE="$(capture_count "$CID_OLD")"
ok "keadaan yang HARUS tetap: .env sha ${ENV_BEFORE:0:12}…, variabel CTWA_* di container = ${CTWA_BEFORE}, entri capture = ${CAPTURE_BEFORE}, migrasi terpasang = ${MIG_SEBELUM}"
[ "$(docker exec "$CID_OLD" sh -c 'env | grep -c "^WEBHOOK_DEBUG=1$" || true')" = "0" ] || die "WEBHOOK_DEBUG=1 aktif di produksi — matikan dulu"
if exact_sql_ok; then EXACT=1; ok "alokasi=0, refund=0, order group=0: perbandingan SQL independen berlaku untuk 10 angka"; else EXACT=0; warn "alokasi/refund/order group > 0: hanya 4 angka dasar dibandingkan"; fi
SNAP_BEFORE="$(snap_sql)"; snap_valid "$SNAP_BEFORE" || die "snapshot SQL pra-rilis tidak valid: '${SNAP_BEFORE}'"
ok "snapshot SQL pra-rilis (leads|order|booked|lunasCRM|berLedger|terbukti|tanpaLedger|konflik|kekurangan|uang): ${SNAP_BEFORE}"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; DIST_KB="$(du -sk "$PREV_DIR/frontend/dist" | cut -f1)"
ok "DB $(( DB_BYTES / 1048576 )) MiB, dist aktif $(( DIST_KB / 1024 )) MiB (kebutuhan rilis ±500 MiB di atas gerbang 5 GiB)"
disk_gate "preflight"
if [ "$MODE" = "preflight" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup pra-rilis + checksum + verifikasi restore"
BACKUP_TARGET="$HOME/backups/pre-${TAG_KODE}-${DEPLOY_SHORT}-${TS}.sql.gz"   # BACKUP_FILE baru diisi SETELAH backup valid
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
for T in '"Order"' '"Customer"' '"Message"' payments fin_journal_entries fin_settings; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -q -c "select count(*) from $T" </dev/null)"
  TOL=50; [ "$T" = '"Message"' ] && TOL=2000
  [ "$B" -le "$A" ] && [ $(( A - B )) -le "$TOL" ] || die "restore verifikasi tidak cocok untuk $T (produksi=$A restore=$B)"
done
# Rehearsal angka: kode kohort tidak dijalankan di sini; SQL independen dijalankan pada DB hasil restore agar format/skema terbukti kompatibel.
RS="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$VERIFY_DB" -X -At -q -c "$SNAP_SQL" </dev/null)"
snap_valid "$RS" || die "SQL pembanding gagal pada DB hasil restore"
ok "restore nyata ke DB sementara cocok (Order, Customer, Message, payments, jurnal, pengaturan); SQL pembanding berjalan di restore: ${RS}"
drop_verify_db; VERIFY_DB=""
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
diff -rq "$PREV_DIR/backend/prisma" "$NEW_DIR/backend/prisma" >/dev/null || die "backend/prisma berbeda dari release aktif (rilis ini TIDAK boleh mengubah skema/migrasi)"
ok "release dir dibuat; compose + package.json + prisma identik dengan release aktif; dist = salinan dist aktif"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
disk_gate "sebelum build"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"
for f in "${!PINS[@]}"; do
  have="$(dcp "$NEW_DIR" run --rm --no-deps -T --entrypoint sh backend -c "cat /app/${f#backend/}" </dev/null | sha_lf)"
  [ "$have" = "${PINS[$f]}" ] || die "image baru memuat ${f} berbeda dari pin"
done; ok "image baru memuat ${#PINS[@]} berkas runtime persis pin (sebelum switch)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status tidak 'up to date' (rilis ini TIDAK boleh ada migration)"
ok "tidak ada migration pending"
disk_gate "sebelum switch"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama build — baseline bergeser, JANGAN switch"
[ "$(sed -n 1p "$PREV_DIR/.release-commit" | tr -d '[:space:]')" = "$PREV_COMMIT" ] || die "baseline berubah selama build"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama build — JANGAN switch"
[ "$(env_sha)" = "$ENV_BEFORE" ] || die ".env berubah selama rilis — JANGAN switch"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali; env TIDAK diubah)"
SWITCH_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for _ in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(backend_cid)"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis + smoke endpoint ADMIN + pembanding SQL (baca-saja)"
PREV_DIR="$NEW_DIR"
sleep 20
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$MIG_SEBELUM" ] || die "jumlah migrasi terpasang berubah (tidak diharapkan)"; ok "jumlah migrasi terpasang tidak berubah (${MIG_SEBELUM})"
[ "$(env_sha)" = "$ENV_BEFORE" ] || die ".env berubah setelah rilis"; ok ".env identik (sha ${ENV_BEFORE:0:12}…)"
[ "$(ctwa_env_count "$CID_NEW")" = "$CTWA_BEFORE" ] || die "jumlah variabel CTWA_* di container berubah ($(ctwa_env_count "$CID_NEW") != ${CTWA_BEFORE})"
[ "$(capture_count "$CID_NEW")" -ge "$CAPTURE_BEFORE" ] || die "entri capture CTWA berkurang"
ok "capture CTWA tidak tersentuh: CTWA_* = ${CTWA_BEFORE}, entri capture $(capture_count "$CID_NEW") (sebelum ${CAPTURE_BEFORE})"
rc=0; verify_live "$SWITCH_UTC" || rc=$?
trap - EXIT
if [ "$rc" = "0" ]; then
  say "SELESAI — ${DEPLOY_SHORT} aktif. Snapshot SQL pra-rilis: ${SNAP_BEFORE}. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
  exit 0
fi
say "RILIS AKTIF, PERBANDINGAN ANGKA TERTUNDA — ${DEPLOY_SHORT}. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}."
exit 3
