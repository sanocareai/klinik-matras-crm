#!/usr/bin/env bash
# Rilis KODE-SAJA "Fase 3.2 — spend rentang tidak lengkap: CPL/CPA/ROAS CRM null (SPEND_TIDAK_LENGKAP) + peringatan hari hilang/hari berjalan parsial": backend saja (web dipakai ulang), TANPA migrasi dan TANPA perubahan skema.
# Workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED. Tidak menyentuh data: spend/target/touch/referensi TIDAK ditulis; .env TIDAK diubah; sinkronisasi spend tetap OFF.
#
# BERHENTI BILA  : baseline live berubah; disk < 5 GiB; backup gagal; berkas di luar allowlist; backend/prisma, package, Docker/compose, .env berubah; isi berkas runtime berbeda dari pin sha256;
#                  ada migrasi pending; SPEND_SYNC_ENABLED=true; baris/total spend atau touch berubah selama rilis; respons memuat token/PII/reach; web/aset lama tidak sehat.
#
#   git bundle create /tmp/atri4.bundle <BASE_SHA>..<CAND_BRANCH> ; scp ke server
#   cat scripts/release-atribusi-spend-lengkap.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/atri4.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/atri4.bundle bash /tmp/atri4.sh <DEPLOY_SHA_40> <BASE_SHA_40> [--preflight-only]'
#   ssh ubuntu@43.133.152.6 'bash /tmp/atri4.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rollback'     # kode kembali; tidak ada data yang dihapus
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
MODE=release
for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --rollback) MODE=rollback;; esac; done
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA kandidat 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }

MIN_FREE_KB=$((5 * 1024 * 1024))
CAND_BRANCH="${CAND_BRANCH:-rc/atribusi-spend-lengkap-on-live-29e54208}"
CAND_REF="refs/remotes/origin/cand-atri4"
BUNDLE="${BUNDLE:-}"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PUBLIC_URL="https://app.sanomatrassehat.com"; INTERNAL_URL="http://127.0.0.1:4000"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"
TAG_KODE="atri4"; FLAG_SYNC="SPEND_SYNC_ENABLED"; FLAG_CAPTURE="ATRIBUSI_TOUCH_CAPTURE_ENABLED"
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; BASE_SHORT="${BASE_SHA:0:8}"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/${TAG_KODE}-${DEPLOY_SHORT}-${TS}"
ROLLBACK_TAG="klinik-matras-backend:rollback-pre-${TAG_KODE}-${DEPLOY_SHORT}"

ALLOWED_RE='^(backend/src/services/attribution/(biayaKpi|iklanReport|spend)\.js|backend/tests/(atribusiSpendKpi|releaseAtribusiKpiKode|releaseAtribusiSpendLengkap)\.test\.js|backend/tests/integration/atribusiIklan.integration.test.js|docs/ATRIBUSI-SPEND-LENGKAP\.md|scripts/release-atribusi-spend-lengkap\.sh)$'
BACKEND_SRC_EXPECT="backend/src/services/attribution/biayaKpi.js backend/src/services/attribution/iklanReport.js backend/src/services/attribution/spend.js"
FRONTEND_SRC_EXPECT=""
declare -A PINS=(
  ["backend/src/services/attribution/biayaKpi.js"]="458e70cd9e47d688dd34c9f68e2920815e2072eeb7e40c096cfe6c6bdf4c6088"
  ["backend/src/services/attribution/iklanReport.js"]="50b410a541cf1b5cb43ce8710dfc8a5e2e30459bf4663805a7b31140e8511d8c"
  ["backend/src/services/attribution/spend.js"]="671ed90a5ea0136ce513c1a01e9f73761ef51320162a0857049cb90f9fabe7f6"
)

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
sha_lf() { tr -d '\r' | sha256sum | cut -d' ' -f1; }
angka_ok() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }
sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
PREV_DIR=""; BACKUP_FILE=""; PREV_IMG_ID=""; IMG_NAME=""
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
avail_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
disk_gate() { local a; a="$(avail_kb)"; [ "${a:-0}" -ge "$MIN_FREE_KB" ] || die "disk bebas $(( ${a:-0} / 1024 )) MiB < 5 GiB (${1})"; ok "disk bebas $(( a / 1024 )) MiB >= 5 GiB (${1})"; }
backend_cid() { docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend"; }
env_sha() { sha256sum "$PERSIST/backend/.env" | cut -d' ' -f1; }
env_flag_text() { grep -E "^${1}=" "$PERSIST/backend/.env" 2>/dev/null || true; }
container_env() { docker exec "$1" sh -c "printenv ${2} || true" | tr -d '\r\n'; }
mounts_of() { docker inspect -f '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{"\n"}}{{end}}' "$1"; }
mount_gate() { mounts_of "$1" | grep -Fxq "bind|${PERSIST}/backend/data|/app/data|true" || die "mount /app/data ($2) BUKAN bind rw ke ${PERSIST}/backend/data"; ok "mount /app/data ($2) = bind rw"; }
# keadaan data yang HARUS identik sebelum vs sesudah (baca-saja): baris + total spend, revisi, impor, touch, referensi, target
estado_sql="select (select count(*)||':'||coalesce(sum(spend),0) from meta_ad_daily_spend)||'|'||(select count(*) from meta_ad_spend_revisions)||'|'||(select count(*) from meta_spend_imports)||'|'||(select count(*) from attribution_touches)||'|'||(select count(*) from meta_ad_references)||'|'||(select count(*) from attribution_kpi_targets)"

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE:-init}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa)
Image sebelumnya   : ${ROLLBACK_TAG}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}
Berhenti SEBELUM 'Switch' -> backend lama tidak pernah dimatikan. Rilis ini TANPA migrasi dan TANPA tulisan data.
Setelah switch bermasalah:   bash /tmp/atri4.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback
NB: bila build image sempat menggeser tag :latest dan rilis berhenti sebelum switch, kembalikan: docker tag ${ROLLBACK_TAG} ${IMG_NAME:-klinik-matras-backend:latest}
─────────────────────────────────────────────────────────────────────────
EOF
}
PHASE="init"
trap 'rc=$?; [ $rc -ne 0 ] && [ "$MODE" = "release" ] && rollback_instructions; exit $rc' EXIT

read -r -d '' SMOKE_JS <<'JS' || true
const jwt = require("jsonwebtoken"); const http = require("http"); const { PrismaClient } = require("@prisma/client");
const port = Number(process.env.PORT || 4000);
const get = (path, token) => new Promise((res, rej) => { const r = http.get({ host: "127.0.0.1", port, path, headers: token ? { Authorization: "Bearer " + token } : {} }, (x) => { let b = ""; x.on("data", (c) => (b += c)); x.on("end", () => res({ status: x.statusCode, headers: x.headers, body: b })); }); r.on("error", rej); r.setTimeout(60000, () => r.destroy(new Error("timeout"))); });
const TERLARANG = /"(phone|name|customerId|messageId|orderId|ctwaClid|leadSourceDetail|waId|jid|content|body|token|accessToken|access_token|secret|authorization)"\s*:/;
(async () => {
  const prisma = new PrismaClient();
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true } });
  const awalSpend = await prisma.$queryRawUnsafe("select min(date_wib)::text d, max(date_wib)::text m, count(*)::int n, coalesce(sum(spend),0)::text s from meta_ad_daily_spend");
  const mulai = await prisma.$queryRawUnsafe("select to_char(min(touch_at) + interval '7 hours', 'YYYY-MM-DD') d from attribution_touches");
  await prisma.$disconnect();
  if (!admin) { console.log("ERROR=tidak ada ADMIN"); process.exit(2); }
  const sign = (id, roles) => jwt.sign({ id, name: "smoke", role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: 600 });
  const tA = sign(admin.id, ["ADMIN"]), tS = sign("00000000-0000-0000-0000-000000000000", ["SALES"]);
  const base = "/api/atribusi/iklan";
  console.log("NOAUTH=" + (await get(base)).status); console.log("SALES=" + (await get(base, tS)).status);
  const wib = (ms) => new Date(Date.now() + 7 * 3600e3 + ms).toISOString().slice(0, 10);
  const lap7 = await get(`${base}?dari=${wib(-6 * 86400e3)}&sampai=${wib(0)}&level=campaign`, tA);
  console.log("LAP7_STATUS=" + lap7.status);
  const j7 = JSON.parse(lap7.body); console.log("LAP7_REKON=" + j7.rekonsiliasi.ok); console.log("LAP7_BIAYA_TERHUBUNG=" + j7.biaya.sumber.terhubung);
  console.log("SPEND_BARIS=" + awalSpend[0].n); console.log("SPEND_MIN=" + (awalSpend[0].d || "")); console.log("SPEND_TOTAL_DB=" + awalSpend[0].s); console.log("TOUCH_MULAI=" + (mulai[0].d || ""));
  let gabung = lap7.body;
  if (awalSpend[0].d && mulai[0].d && awalSpend[0].d < mulai[0].d) {
    const d = awalSpend[0].d;
    const r = await get(`${base}?dari=${d}&sampai=${d}&level=campaign`, tA); gabung += r.body;
    console.log("SB_STATUS=" + r.status);
    const j = JSON.parse(r.body);
    console.log("SB_REKON=" + j.rekonsiliasi.ok);
    console.log("SB_STATUS_BIAYA=" + j.biaya.status);
    console.log("SB_PERINGATAN=" + j.peringatan.map((w) => w.kode).join(","));
    console.log("SB_EVAL=" + j.biaya.evaluasi.status);
    console.log("SB_SPEND_TOTAL=" + j.biaya.spendTotal);
    console.log("SB_CPL_CPA_NULL=" + (j.biaya.cpl === null && j.biaya.cpa === null && j.biaya.bookedRoas === null && j.biaya.cashRoas === null && j.grup.every((g) => g.biaya.cpl === null && g.biaya.cpa === null && g.biaya.status === "SEBELUM_ATRIBUSI" && g.biaya.evaluasi.status === "TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI")));
    console.log("SB_SPEND_PER_GRUP=" + j.grup.filter((g) => g.biaya.spend !== null).length);
    console.log("SB_SIGMA_GRUP=" + Math.round(j.grup.reduce((s, g) => s + (g.biaya.spend || 0), 0)));
    console.log("SB_REACH=" + (/reach/i.test(r.body) ? "ADA" : "tidak"));
  } else console.log("SB_DILEWATI=tidak ada spend sebelum hari atribusi");
  // rentang yang memuat hari tanpa data spend (sesudah spend terakhir, sesudah hari atribusi mulai) -> semua KPI CRM null, alasan SPEND_TIDAK_LENGKAP
  const maks = awalSpend[0].m; const kemarin = wib(-86400e3);
  if (maks && mulai[0].d && maks < kemarin) {
    const dr = new Date(Date.parse(maks + "T00:00:00Z") + 86400e3).toISOString().slice(0, 10);
    if (dr > mulai[0].d) {
      const r = await get(`${base}?dari=${dr}&sampai=${kemarin}&level=campaign`, tA); gabung += r.body; const j = JSON.parse(r.body);
      console.log("GAP_STATUS=" + r.status); console.log("GAP_REKON=" + j.rekonsiliasi.ok); console.log("GAP_STATUS_BIAYA=" + j.biaya.status);
      console.log("GAP_NULL=" + (j.biaya.cpl === null && j.biaya.cpa === null && j.biaya.bookedRoas === null && j.biaya.cashRoas === null && j.grup.every((g) => g.biaya.cpl === null && g.biaya.cpa === null && g.biaya.bookedRoas === null)));
      console.log("GAP_PERINGATAN=" + j.peringatan.map((w) => w.kode).join(",")); console.log("GAP_ALASAN=" + j.biaya.alasanNull.cpa); console.log("GAP_RENTANG=" + dr + ".." + kemarin);
    } else console.log("GAP_DILEWATI=tidak ada hari sesudah atribusi tanpa spend");
  } else console.log("GAP_DILEWATI=spend sudah sampai kemarin");
  console.log("FORBIDDEN=" + (TERLARANG.exec(gabung) ? TERLARANG.exec(gabung)[1] : "none"));
  console.log("REACH_DI_LAPORAN=" + (/reach/i.test(gabung) ? "ADA" : "tidak"));
})().catch((e) => { console.log("ERROR=" + String(e.message).slice(0, 120)); process.exit(4); });
JS

verify_live() {
  local since_utc="$1" cid dir out
  cid="$(backend_cid)"; [ "$(printf '%s\n' "$cid" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
  dir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid")"
  [ "$(tr -d '[:space:]' < "$dir/.release-commit")" = "$DEPLOY_SHORT" ] || die "release aktif (${dir}) BUKAN ${DEPLOY_SHORT}"; ok "release aktif = ${DEPLOY_SHORT}"
  curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck internal gagal"
  curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "health internal + publik"
  [ "$(docker inspect -f '{{.RestartCount}}' "$cid")" = "0" ] && [ "$(docker inspect -f '{{.State.Running}}' "$cid")" = "true" ] || die "backend restart/tidak berjalan"; ok "RestartCount=0, berjalan"
  mount_gate "$cid" "container aktif"
  local f have
  for f in "${!PINS[@]}"; do have="$(docker exec "$cid" sh -c "cat /app/${f#backend/}" | sha_lf)"; [ "$have" = "${PINS[$f]}" ] || die "isi ${f} di container BERBEDA dari pin"; done; ok "berkas runtime di container = pin sha256"
  local logs errn; logs="$(docker logs --since "$since_utc" "$cid" 2>&1 || true)"
  errn="$(printf '%s\n' "$logs" | grep -cE 'unhandledRejection|ReferenceError|SyntaxError|Cannot find module|TypeError|atribusi/iklan[a-z/-]* error|Gagal proses webhook WAHA' || true)"
  [ "$errn" = "0" ] || die "${errn} baris galat runtime/webhook sejak switch"; ok "log sejak ${since_utc}: 0 galat runtime, 0 'Gagal proses webhook WAHA'"
  printf '%s\n' "$logs" | grep -Eq 'META_ADS_ACCESS_TOKEN|access_token=|Bearer [A-Za-z0-9]' && die "log memuat token/Bearer"; ok "log: tidak ada token/Bearer"
  [ "$(container_env "$cid" "$FLAG_SYNC")" != "true" ] || die "${FLAG_SYNC}=true — sinkronisasi otomatis tidak boleh menyala"; ok "${FLAG_SYNC} tidak menyala"
  [ "$(container_env "$cid" "$FLAG_CAPTURE")" = "$CAPTURE_FLAG_BEFORE" ] || die "nilai ${FLAG_CAPTURE} berubah"; ok "${FLAG_CAPTURE} tidak berubah ('${CAPTURE_FLAG_BEFORE:-<kosong>}')"
  local inbound; inbound="$(PREV_DIR="$dir" psql_live -At -c "select count(*) from \"Message\" where direction::text='INBOUND' and \"createdAt\" >= '${since_utc}'::timestamptz")"; angka_ok "$inbound" || die "hitungan inbound tidak valid"
  [ "$inbound" -gt 0 ] && ok "inbox hidup: ${inbound} pesan inbound tersimpan sejak ${since_utc}" || warn "belum ada INBOUND baru sejak ${since_utc} (sepi/WAHA?) — ulangi dengan cek manual"
  out="$(printf '%s' "$SMOKE_JS" | docker exec -i "$cid" node - 2>&1)" || { printf '%s\n' "$out" | cut -c1-200 | head -5 | sed 's/^/        /'; die "smoke gagal"; }
  val() { printf '%s\n' "$out" | sed -n "s/^$1=//p" | head -1; }
  [ "$(val NOAUTH)" = "401" ] && [ "$(val SALES)" = "403" ] || die "RBAC laporan salah (401/403)"; ok "RBAC: tanpa token 401, SALES 403"
  [ "$(val LAP7_STATUS)" = "200" ] && [ "$(val LAP7_REKON)" = "true" ] || die "laporan 7 hari: status/rekonsiliasi tidak OK"; ok "laporan 7 hari default: 200, rekonsiliasi OK; biaya terhubung=$(val LAP7_BIAYA_TERHUBUNG)"
  [ "$(val FORBIDDEN)" = "none" ] || die "respons memuat kunci terlarang ($(val FORBIDDEN))"
  [ "$(val REACH_DI_LAPORAN)" = "tidak" ] || die "laporan memuat reach (non-additive; tidak boleh ditampilkan)"; ok "respons: 0 nomor/nama/ID pelanggan/token; reach tidak ditampilkan"
  if [ -n "$(val SB_STATUS)" ]; then
    [ "$(val SB_STATUS)" = "200" ] && [ "$(val SB_REKON)" = "true" ] || die "laporan sebelum atribusi: status/rekonsiliasi tidak OK"
    [ "$(val SB_STATUS_BIAYA)" = "SEBELUM_ATRIBUSI" ] && [ "$(val SB_EVAL)" = "TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI" ] || die "status sebelum atribusi salah ($(val SB_STATUS_BIAYA)/$(val SB_EVAL))"
    printf '%s' "$(val SB_PERINGATAN)" | grep -q 'RENTANG_SEBELUM_ATRIBUSI' && printf '%s' "$(val SB_PERINGATAN)" | grep -q 'BIAYA_SEBELUM_ATRIBUSI' || die "peringatan sebelum atribusi tidak lengkap ($(val SB_PERINGATAN))"
    [ "$(val SB_CPL_CPA_NULL)" = "true" ] || die "CPL/CPA/ROAS CRM harus null sebelum atribusi"
    [ "$(val SB_REACH)" = "tidak" ] || die "rentang sebelum atribusi memuat reach"
    ok "rentang $(val SPEND_MIN) (sebelum atribusi ${TOUCH_MULAI_HARI:-$(val TOUCH_MULAI)}): spend tampil Rp$(val SB_SPEND_TOTAL), CPL/CPA/ROAS null, evaluasi TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI, peringatan: $(val SB_PERINGATAN)"
    [ "$(val SB_SPEND_TOTAL)" = "$(val SPEND_TOTAL_DB | sed 's/\.00$//')" ] || warn "spend total hari pertama ($(val SB_SPEND_TOTAL)) ≠ total DB ($(val SPEND_TOTAL_DB)) — wajar bila ada spend hari lain"
  else warn "$(val SB_DILEWATI)"; fi
  if [ -n "$(val GAP_STATUS)" ]; then
    [ "$(val GAP_STATUS)" = "200" ] && [ "$(val GAP_REKON)" = "true" ] || die "laporan rentang tanpa spend lengkap: status/rekonsiliasi tidak OK"
    { [ "$(val GAP_STATUS_BIAYA)" = "SPEND_TIDAK_LENGKAP" ] || [ "$(val GAP_STATUS_BIAYA)" = "DATA_TERLAMBAT" ]; } && [ "$(val GAP_NULL)" = "true" ] && [ "$(val GAP_ALASAN)" = "SPEND_TIDAK_LENGKAP" ] || die "rentang dengan hari tanpa spend: CPL/CPA/ROAS CRM harus null dengan alasan SPEND_TIDAK_LENGKAP ($(val GAP_STATUS_BIAYA)/$(val GAP_NULL)/$(val GAP_ALASAN))"
    printf '%s' "$(val GAP_PERINGATAN)" | grep -q 'SPEND_TIDAK_LENGKAP' || die "peringatan SPEND_TIDAK_LENGKAP tidak muncul ($(val GAP_PERINGATAN))"
    ok "rentang $(val GAP_RENTANG) (hari tanpa spend): CPL/CPA/ROAS CRM null, alasan SPEND_TIDAK_LENGKAP, status $(val GAP_STATUS_BIAYA), peringatan: $(val GAP_PERINGATAN)"
  else warn "$(val GAP_DILEWATI)"; fi
  local sesudah; sesudah="$(psql_live -At -c "$estado_sql")"
  # touch BOLEH bertambah (capture aktif menerima pesan CTWA nyata selama rilis) tetapi tidak boleh berkurang; semua lainnya HARUS persis sama
  
  local tb ta; tb="$(printf '%s' "$ESTADO_BEFORE" | cut -d'|' -f4)"; ta="$(printf '%s' "$sesudah" | cut -d'|' -f4)"
  local lain_b lain_a; lain_b="$(printf '%s' "$ESTADO_BEFORE" | cut -d'|' -f1-3,5-)"; lain_a="$(printf '%s' "$sesudah" | cut -d'|' -f1-3,5-)"
  angka_ok "$tb" && angka_ok "$ta" && [ "$ta" -ge "$tb" ] || die "touch BERKURANG (sebelum=${tb} sesudah=${ta})"
  [ "$lain_a" = "$lain_b" ] || { [ "$MODE" = "verify" ] && warn "spend/revisi/impor/referensi/target berubah sejak rilis (sah bila ada impor baru): ${lain_a}" || die "data BERUBAH selama rilis (sebelum=${lain_b} sesudah=${lain_a})"; }
  ok "data tidak ditulis rilis: spend|revisi|impor|referensi|target identik (${lain_a}); touch ${tb} -> ${ta} (tambahan sah dari capture aktif)"
  return 0
}

if [ "$MODE" = "rollback" ]; then
  say "ROLLBACK ${DEPLOY_SHORT} -> ${BASE_SHORT} (KODE saja; data tidak disentuh)"
  OLD_DIR="$RELEASES/$BASE_SHORT"; [ -d "$OLD_DIR" ] && [ -f "$OLD_DIR/docker-compose.release.yml" ] || die "release sebelumnya ${OLD_DIR} tidak ada/tidak lengkap"
  docker image inspect "$ROLLBACK_TAG" >/dev/null 2>&1 || die "image rollback ${ROLLBACK_TAG} tidak ada"
  CID="$(backend_cid)"; [ "$(printf '%s\n' "$CID" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID")" = "$NEW_DIR" ] || die "release aktif BUKAN ${DEPLOY_SHORT}; rollback tidak berlaku"
  for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; [ "$lf" = "/tmp/release-atribusi-spend-lengkap.lock" ] && continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain berjalan (${lf})"; done
  exec 9>/tmp/release-atribusi-spend-lengkap.lock; flock -n 9 || die "rilis/rollback ini sudah berjalan"
  ENV_B="$(env_sha)"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID")"
  docker tag "$ROLLBACK_TAG" "$IMG_NAME" || die "gagal menandai ulang image"
  dcp "$OLD_DIR" up -d --no-deps --force-recreate backend </dev/null >/dev/null 2>&1 || die "recreate (rollback) gagal"
  UP=0; for _ in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = "1" ] || die "backend tidak sehat setelah rollback"
  CID2="$(backend_cid)"; [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID2")" = "$OLD_DIR" ] || die "container bukan dari ${OLD_DIR}"
  [ "$(env_sha)" = "$ENV_B" ] || die ".env berubah selama rollback"; [ "$(docker inspect -f '{{.RestartCount}}' "$CID2")" = "0" ] || die "RestartCount != 0"
  curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "health publik gagal"
  PREV_DIR="$OLD_DIR"; ok "rollback selesai: release ${BASE_SHORT}; .env utuh; data: $(psql_live -At -c "$estado_sql") (spend|revisi|impor|touch|referensi|target — tidak dihapus)"
  trap - EXIT; exit 0
fi

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df find node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"; done
exec 9>/tmp/release-atribusi-spend-lengkap.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "atri4\|release-atribusi-spend-lengkap\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"; exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA"
disk_gate "awal"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, pin isi"
[ -d "$SRC" ] || die "repo sumber ${SRC} tidak ada"
if [ -n "$BUNDLE" ]; then
  [ -r "$BUNDLE" ] || die "BUNDLE tidak terbaca"; sg bundle verify "$BUNDLE" >/dev/null 2>&1 || die "git bundle tidak valid / prasyarat tidak ada di repo sumber"
  sg fetch -q "$BUNDLE" "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "fetch dari bundle gagal"
else sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"; sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:${CAND_REF}" || die "git fetch gagal"; fi
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat BUKAN SHA rilis; bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHORT} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHORT} BUKAN leluhur kandidat"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"; [ -n "$CHANGED" ] || die "kandidat identik dengan baseline"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist yang berbeda dari baseline"; }
! printf '%s\n' "$CHANGED" | grep -qE '^backend/prisma/|package(-lock)?\.json$|^docker-compose|(^|/)Dockerfile$|^frontend/dist/|(^|/)\.env' || die "prisma/paket/Docker/dist/.env berubah — rilis ini tanpa migrasi dan tanpa skema"
! printf '%s\n' "$CHANGED" | grep -qiE 'campaign.?automation|meta.?write|ads.?write' || die "diff menyentuh jalur otomasi campaign — dilarang"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat yang diaudit"
for f in "${!PINS[@]}"; do have="$(sg show "${DEPLOY_SHA}:${f}" | sha_lf)"; [ "$have" = "${PINS[$f]}" ] || die "isi ${f} di kandidat BERBEDA dari pin"; done; ok "${#PINS[@]} berkas runtime di kandidat = pin sha256"
! sg grep -nE "method:[[:space:]]*[\"'](POST|PUT|PATCH|DELETE)[\"']" "$DEPLOY_SHA" -- backend/src/services/attribution/spendSyncMeta.js >/dev/null 2>&1 || die "adapter Meta memuat metode non-GET"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHORT}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist; tanpa migrasi/skema/paket"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(backend_cid)"; [ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHORT}; produksi bergeser"
PREV_IMG_ID="$(docker inspect -f '{{.Image}}' "$CID_OLD")"; IMG_NAME="$(docker inspect -f '{{.Config.Image}}' "$CID_OLD")"
[ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag ${IMG_NAME} menunjuk image lain dari container aktif (kembalikan: docker tag <tag-rollback> ${IMG_NAME})"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_OLD")" = "true" ] && [ "$(docker inspect -f '{{.RestartCount}}' "$CID_OLD")" = "0" ] || die "backend aktif tidak stabil"
ok "baseline live = ${PREV_COMMIT}; image ${IMG_NAME} (${PREV_IMG_ID:7:12})"; mount_gate "$CID_OLD" "baseline"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "health internal gagal"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "health publik gagal"
PREV_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$PREV_DIR/frontend/dist/index.html" | sed -n 1p)"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$PREV_INDEX" ] || die "bundel publik != dist release aktif"
ok "health sehat; bundel publik = dist aktif (${PREV_INDEX})"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migration menggantung"
CAND_MIGS="$(sg ls-tree --name-only "${DEPLOY_SHA}" backend/prisma/migrations/ | sed 's#.*/##' | grep -E '^[0-9]{14}_' | LC_ALL=C sort)"
PROD_MIGS="$(psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort)"
[ "$CAND_MIGS" = "$PROD_MIGS" ] || die "himpunan migrasi kandidat ≠ produksi (rilis ini harus tanpa migrasi)"; ok "migrasi kandidat = produksi ($(printf '%s\n' "$PROD_MIGS" | grep -c .)); tidak ada pending"
ENV_BEFORE="$(env_sha)"; CAPTURE_FLAG_BEFORE="$(container_env "$CID_OLD" "$FLAG_CAPTURE")"
[ "$(container_env "$CID_OLD" "$FLAG_SYNC")" != "true" ] && ! printf '%s\n' "$(env_flag_text "$FLAG_SYNC")" | grep -Eq "^${FLAG_SYNC}=[\"']?true" || die "${FLAG_SYNC}=true di produksi"
ESTADO_BEFORE="$(psql_live -At -c "$estado_sql")"; TOUCH_MULAI_HARI="$(psql_live -At -c "select to_char(min(touch_at) + interval '7 hours','YYYY-MM-DD') from attribution_touches")"
ok "keadaan yang HARUS tetap: .env sha ${ENV_BEFORE:0:12}…; ${FLAG_CAPTURE}='${CAPTURE_FLAG_BEFORE:-<kosong>}'; spend|revisi|impor|touch|referensi|target = ${ESTADO_BEFORE}; atribusi mulai ${TOUCH_MULAI_HARI} WIB; ${FLAG_SYNC} OFF"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"
[ "$(avail_kb)" -ge $(( DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"; ok "ruang disk cukup (backup + image backend baru)"
disk_gate "preflight"
if [ "$MODE" = "preflight" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup pra-rilis + checksum"
BT="$HOME/backups/pre-${TAG_KODE}-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BT}.partial" || die "pg_dump gagal"
gzip -t "${BT}.partial" || die "arsip rusak"; gzip -dc "${BT}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BT}.partial")" -gt 1000000 ] || die "backup terlalu kecil"
mv "${BT}.partial" "$BT"; BACKUP_FILE="$BT"; chmod 600 "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256" | cut -c1-16)…"; disk_gate "setelah backup"

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR}"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] && [ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "release/image aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink .env tidak terbaca"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.yml") >/dev/null || die "docker-compose.yml berbeda"
diff -q <(tr -d '\r' < "$PREV_DIR/backend/package.json") <(tr -d '\r' < "$NEW_DIR/backend/package.json") >/dev/null || die "backend/package.json berbeda"
[ "$(diff -rq --exclude=node_modules --exclude=dist --exclude=.env --exclude=.release-commit --exclude=tests --exclude=scripts "$PREV_DIR/backend/prisma" "$NEW_DIR/backend/prisma" | wc -l)" = "0" ] || die "backend/prisma berbeda dari release aktif"
ok "release dir dibuat; compose, package.json, dan backend/prisma identik dengan release aktif"
say "4b. Web: dist release aktif DIPAKAI ULANG (rilis ini tanpa perubahan frontend)"
[ -d "$PREV_DIR/frontend/dist" ] && [ -f "$PREV_DIR/frontend/dist/index.html" ] || die "dist release aktif tidak ada"
cp -a "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" || die "gagal menyalin dist"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ "$NEW_INDEX" = "$PREV_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "dist salinan tidak valid"
diff -rq "$PREV_DIR/frontend/dist" "$NEW_DIR/frontend/dist" >/dev/null || die "dist salinan berbeda dari release aktif"
PHASE="4c-dist"; OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"; ok "dist dipakai ulang (${NEW_INDEX}) identik dengan release aktif"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
disk_gate "sebelum build"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; docker tag "$ROLLBACK_TAG" "$IMG_NAME" || true; die "build image gagal (backend lama tetap berjalan; tag dikembalikan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"; [ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"; ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"
for f in "${!PINS[@]}"; do have="$(dcp "$NEW_DIR" run --rm --no-deps -T --entrypoint sh backend -c "cat /app/${f#backend/}" </dev/null | sha_lf)"; [ "$have" = "${PINS[$f]}" ] || die "image baru memuat ${f} berbeda dari pin"; done; ok "image baru memuat berkas runtime persis pin"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status (image baru) TIDAK 'up to date' — rilis ini harus tanpa migrasi"; ok "migrate status up to date (tanpa migrasi pending)"
disk_gate "sebelum switch"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum switch"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image aktif berubah — JANGAN switch"
[ "$(env_sha)" = "$ENV_BEFORE" ] || die ".env berubah selama rilis — JANGAN switch"
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
# keadaan data bisa berubah SAH selama rilis (impor/touch baru): dicatat ulang tepat sebelum switch
ESTADO_BEFORE="$(psql_live -At -c "$estado_sql")"

PHASE="7-switch"; say "7. Switch backend + web (SATU kali; env TIDAK diubah)"
SWITCH_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for _ in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done; [ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(backend_cid)"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container bukan dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT}); switch ${SWITCH_UTC}"
PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"
PREV_DIR="$NEW_DIR"; sleep 20
[ "$(env_sha)" = "$ENV_BEFORE" ] || die ".env berubah setelah rilis"; ok ".env identik (sha ${ENV_BEFORE:0:12}…)"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel web publik BUKAN dist baru"; ok "bundel web publik tetap ${NEW_INDEX} (dist dipakai ulang)"
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama 404"; ok "aset lama masih 200"; fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang tidak ada harus 404"; ok "aset yang tidak ada = 404"
rc=0; verify_live "$SWITCH_UTC" || rc=$?
trap - EXIT
[ "$rc" = "0" ] || { say "RILIS AKTIF TETAPI VERIFIKASI GAGAL (kode ${rc}) — ${DEPLOY_SHORT}. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}."; exit "$rc"; }
say "SELESAI — ${DEPLOY_SHORT} aktif (switch ${SWITCH_UTC}); tanpa migrasi, data tidak ditulis. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}."
exit 0
