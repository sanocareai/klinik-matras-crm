#!/usr/bin/env bash
# Rilis "ATRIBUSI CTWA FASE 2 — touch iklan (Ad ID) + laporan per ad/ad set/campaign": backend + 1 migrasi ADITIF (3 tabel baru kosong) — workflow RELEASE-DIRECTORY
# di atas release aktif (BASE_SHA). FAIL-CLOSED. Kode di-deploy dengan flag ATRIBUSI_TOUCH_CAPTURE_ENABLED MATI.
#
# YANG DILAKUKAN : backup + verifikasi restore; REHEARSAL migrasi pada DB hasil restore (struktur + uji perilaku constraint + sidik jari tabel lama);
#                  migrasi aditif ke produksi; build image backend; backend di-recreate SATU kali; verifikasi baca-saja (RBAC, rekonsiliasi, privasi, inbox).
# YANG TIDAK     : TIDAK mengubah .env (hash dibandingkan sebelum/sesudah) dan TIDAK menyalakan flag capture touch; TIDAK membangun frontend (dist disalin dari release aktif);
#                  TIDAK menyentuh capture CTWA Fase 0; TIDAK mem-push/merge; TIDAK menghapus release/image/berkas; TIDAK pernah DROP/DELETE/UPDATE data produksi;
#                  TIDAK mengirim webhook/pesan sintetis ke produksi (smoke inbox = baca-saja: log + hitungan Message).
# BERHENTI BILA  : baseline live berubah (SHA/image/release); mount /app/data tidak sesuai; disk bebas < 5 GiB; pg_dump/verifikasi restore gagal; ada berkas di luar
#                  allowlist; isi berkas runtime/migrasi berbeda dari pin sha256; pemindai DDL menolak; rehearsal gagal atau mengubah tabel lama; flag sudah menyala;
#                  ada migration pending selain milik rilis ini; .env berubah.
#
# Pemakaian (dari laptop; sumber: bundle git, TANPA push):
#   git bundle create /tmp/atri2.bundle <BASE_SHA>..<CAND_BRANCH>
#   scp /tmp/atri2.bundle ubuntu@43.133.152.6:/tmp/atri2.bundle
#   cat scripts/release-atribusi-iklan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/atri2.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/atri2.bundle bash /tmp/atri2.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/atri2.bundle bash /tmp/atri2.sh <DEPLOY_SHA_40> <BASE_SHA_40>'                    # rilis (flag MATI)
#   ssh ubuntu@43.133.152.6 'bash /tmp/atri2.sh <DEPLOY_SHA_40> <BASE_SHA_40> --verify-only'                               # verifikasi ulang (baca-saja)
#   ssh ubuntu@43.133.152.6 'bash /tmp/atri2.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rollback'                                  # kode kembali ke release/image sebelum rilis; tabel TIDAK dihapus
#
# Menyalakan flag (ATRIBUSI_TOUCH_CAPTURE_ENABLED=true di backend/.env + recreate backend) adalah keputusan Owner yang TERPISAH dan tidak dilakukan skrip ini.
# Kode keluar: 0 selesai & terverifikasi | 1 berhenti (lihat instruksi rollback).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
MODE=release
for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --verify-only) MODE=verify;; --rollback) MODE=rollback;; esac; done

MIN_FREE_KB=$((5 * 1024 * 1024))     # 5 GiB — gerbang keras (awal, setelah backup, sebelum build, sebelum switch)
CAND_BRANCH="${CAND_BRANCH:-feat/atribusi-fase2-touch-ad}"
CAND_REF="refs/remotes/origin/cand-atri2"      # ref UNIK: repo sumber dipakai bersama skrip rilis lain
BUNDLE="${BUNDLE:-}"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"
TAG_KODE="atri2"
FLAG_NAME="ATRIBUSI_TOUCH_CAPTURE_ENABLED"

# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261107090000_atribusi_touch_iklan:6df8640b8045113a0012ee1c2a817c3cecd34f7a12becc1cd59b86777f3dc03f"
# Hasil pemindai untuk migrasi di atas. Selisih = berhenti.
SCAN_EXPECT='{"total":13,"create_table":3,"create_index":6,"fk":4,"check":13}'
# Hanya berkas ini yang BOLEH berbeda dari baseline (path persis; paket/compose/Dockerfile/frontend/Finance/Production = berhenti).
ALLOWED_RE='^(backend/prisma/migrations/20261107090000_atribusi_touch_iklan/migration\.sql|backend/prisma/schema\.prisma|backend/src/index\.js|backend/src/routes/(attributionAds|webhooks)\.js|backend/src/services/attribution/(adReferensi|captureHealth|cohortLoader|iklanReport|touchCapture)\.js|backend/tests/(atribusiIklanReport|atribusiTouchAtomik|atribusiTouchReferensi|releaseAtribusiIklan)\.test\.js|backend/tests/fixtures/metaAdsFixture\.js|backend/tests/integration/(atribusiIklan|atribusiTouchCrash|releaseAtribusiIklan)\.integration\.test\.js|backend/tests/integration/helpers/(atribusiCrashChild\.mjs|ctwaPayload\.js)|backend/tests/integration/perf/atribusiIklan\.perf\.manual\.test\.js|docs/ATRIBUSI-FASE2-TOUCH-IKLAN\.md|scripts/(release-atribusi-iklan|release-atribusi-kohort|release-ctwa-capture-flag-off)\.sh)$'
# Berkas backend/src yang berubah HARUS tepat daftar ini.
BACKEND_SRC_EXPECT="backend/src/index.js backend/src/routes/attributionAds.js backend/src/routes/webhooks.js backend/src/services/attribution/adReferensi.js backend/src/services/attribution/captureHealth.js backend/src/services/attribution/cohortLoader.js backend/src/services/attribution/iklanReport.js backend/src/services/attribution/touchCapture.js"
# Pin sha256 (teks LF) berkas RUNTIME. Isi berbeda dari pin = berhenti sampai ditinjau ulang.
declare -A PINS=(
  ["backend/src/index.js"]="5fec0d94fdfdebaa09c5b00a8c3239a3d06d86b90fa15df1a8617b59bc01ad01"
  ["backend/src/routes/attributionAds.js"]="c3dfafa620ad36111bedb795bd2b3573dd887eb45b487a26c7165d2a406c86ed"
  ["backend/src/routes/webhooks.js"]="2e87e63edf4ed6c5088c61cb1eaffe4489f79df3575417fd44ab4c5ebc28f5e8"
  ["backend/src/services/attribution/adReferensi.js"]="0ea832f4177eee974edf4222318ef7b05831b5f80f5e3634c8f97dea64f494dc"
  ["backend/src/services/attribution/captureHealth.js"]="931c04278ea097affc1051fc53e251d43220eb3501f07e71efd615df28120b31"
  ["backend/src/services/attribution/cohortLoader.js"]="03d54a1feb5a64d5f1fd5b9a3ced908d58e0ba38e7dcce519a745dfb0cb3a57b"
  ["backend/src/services/attribution/iklanReport.js"]="67250a173d32564fd8ec68cd2df0ea30451b52ce413eb840f452c753de0ded51"
  ["backend/src/services/attribution/touchCapture.js"]="8ccaa9b1729106b3f812f4a18dcfdf4cfc1b67140e9747025ca2d4ad634117b8"
  ["backend/prisma/schema.prisma"]="f176793d53c6c5af46ca59c5d8d90470bda824ca862770a477ccf28592f50ea5"
)

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

# ── Fungsi gerbang MURNI (diuji lewat ATRI2_RELEASE_SELFTEST=1 tanpa menyentuh produksi) ─────────────────────────────────
gate_disk_kb()   { [[ "${1:-}" =~ ^[0-9]+$ ]] || return 2; [ "$1" -ge "$MIN_FREE_KB" ]; }
gate_mount_text(){ printf '%s\n' "$1" | grep -Fxq "bind|${2}|/app/data|true"; }
sha_lf()         { tr -d '\r' | sha256sum | cut -d' ' -f1; }
# 0 bila teks env/.env ($1) TIDAK menyalakan flag capture touch (tidak ada, atau bukan persis "true").
flag_mati_teks() { ! printf '%s\n' "$1" | grep -Eq "^${FLAG_NAME}=[\"']?true[\"']?[[:space:]]*$"; }
# Kunci/kata terlarang pada JSON respons ($1): pengenal pribadi dan clid mentah. 0 bila BERSIH.
respons_bersih() { ! printf '%s' "$1" | grep -Eq '"(phone|name|customerId|messageId|orderId|ctwaClid|leadSourceDetail|waId|jid|content|body)"[[:space:]]*:'; }
# Hitungan integer (>= 0): $1 harus angka.
angka_ok()       { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

if [ "${ATRI2_RELEASE_SELFTEST:-}" = "1" ]; then
  fail=0
  t() { if "$@"; then printf 'PASS %s\n' "$*"; else printf 'FAIL %s\n' "$*"; fail=1; fi; }
  f() { if "$@"; then printf 'FAIL(harus gagal) %s\n' "$*"; fail=1; else printf 'PASS(gagal sesuai harapan) %s\n' "$*"; fi; }
  t gate_disk_kb 5242880; t gate_disk_kb 9999999; f gate_disk_kb 5242879; f gate_disk_kb 0; f gate_disk_kb ""; f gate_disk_kb "abc"; f gate_disk_kb "4.6G"
  M=$'bind|/home/ubuntu/klinik-matras/backend/uploads|/app/uploads|true\nbind|/home/ubuntu/klinik-matras/backend/data|/app/data|true'
  t gate_mount_text "$M" /home/ubuntu/klinik-matras/backend/data
  f gate_mount_text "$M" /home/ubuntu/lain/backend/data
  f gate_mount_text $'bind|/home/ubuntu/klinik-matras/backend/data|/app/data|false' /home/ubuntu/klinik-matras/backend/data
  f gate_mount_text "" /home/ubuntu/klinik-matras/backend/data
  t flag_mati_teks $'JWT_SECRET=x\nCTWA_CAPTURE_HASH_SALT=y'
  t flag_mati_teks "ATRIBUSI_TOUCH_CAPTURE_ENABLED=false"
  t flag_mati_teks "ATRIBUSI_TOUCH_CAPTURE_ENABLED="
  t flag_mati_teks "ATRIBUSI_TOUCH_CAPTURE_ENABLED=TRUE"
  f flag_mati_teks "ATRIBUSI_TOUCH_CAPTURE_ENABLED=true"
  f flag_mati_teks 'ATRIBUSI_TOUCH_CAPTURE_ENABLED="true"'
  f flag_mati_teks $'A=b\nATRIBUSI_TOUCH_CAPTURE_ENABLED=true\nC=d'
  t respons_bersih '{"grup":[{"kunci":"UNMAPPED","lead":{"unik":1}}],"biaya":{"cpa":null,"roas":null}}'
  f respons_bersih '{"x":{"phone":"62"}}'; f respons_bersih '{"customerId":"c1"}'; f respons_bersih '{"ctwaClid":"abc"}'; f respons_bersih '{"name":"Budi"}'; f respons_bersih '{"messageId":"m"}'
  t angka_ok 0; t angka_ok 123; f angka_ok ""; f angka_ok "-1"; f angka_ok "1.5"; f angka_ok "x"
  [ "$(printf 'a\r\nb\r\n' | sha_lf)" = "$(printf 'a\nb\n' | sha_lf)" ] && echo "PASS sha_lf CRLF=LF" || { echo "FAIL sha_lf"; fail=1; }
  exit "$fail"
fi

[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA kandidat 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; BASE_SHORT="${BASE_SHA:0:8}"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/${TAG_KODE}-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; VERIFY_DB=""; REH_DB=""
ROLLBACK_TAG="klinik-matras-backend:rollback-pre-${TAG_KODE}-${DEPLOY_SHORT}"

sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
avail_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
disk_gate() { local a; a="$(avail_kb)"; gate_disk_kb "$a" || die "disk bebas $(( ${a:-0} / 1024 )) MiB < 5 GiB (${1}) — berhenti, tidak ada yang diubah setelah titik ini"; ok "disk bebas $(( a / 1024 )) MiB >= 5 GiB (${1})"; }
mounts_of() { docker inspect -f '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{"\n"}}{{end}}' "$1"; }
mount_gate() { gate_mount_text "$(mounts_of "$1")" "$PERSIST/backend/data" || die "mount /app/data ($2) BUKAN bind rw ke ${PERSIST}/backend/data — berhenti"; ok "mount /app/data ($2) = bind rw ${PERSIST}/backend/data"; }
drop_temp_dbs() {
  [ -n "$PREV_DIR" ] || return 0
  local d
  for d in "$VERIFY_DB" "$REH_DB"; do
    [ -n "$d" ] && dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${d}\"" </dev/null >/dev/null 2>&1 || true
  done
}
backend_cid() { docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend"; }
env_sha() { sha256sum "$PERSIST/backend/.env" | cut -d' ' -f1; }
env_flag_text() { grep -E "^${FLAG_NAME}=" "$PERSIST/backend/.env" 2>/dev/null || true; }
ctwa_env_count() { docker exec "$1" sh -c 'env | grep -c "^CTWA_" || true'; }
capture_count() { docker exec "$1" sh -c 'find /app/data -maxdepth 2 -name "ctwa-capture*" 2>/dev/null | wc -l'; }
container_flag() { docker exec "$1" sh -c "printenv ${FLAG_NAME} || true" | tr -d '\r\n'; }

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa)
Image sebelumnya   : ${ROLLBACK_TAG}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}
Berhenti SEBELUM 'Switch backend' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.
  Bila berhenti SESUDAH migrasi: tabel baru (3, kosong) dibiarkan; kode lama mengabaikannya. TIDAK ada DROP.
Setelah switch bermasalah (satu perintah, bergerbang):
   bash /tmp/atri2.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback
Setara manual:
   docker tag ${ROLLBACK_TAG} klinik-matras-backend:latest
   cd ${RELEASES}/${BASE_SHORT} && SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Rollback = KODE saja. Tabel attribution_touches / meta_ad_references / meta_ad_reference_imports TIDAK dihapus (data atribusi yang sudah terekam tetap utuh;
kode lama tidak membacanya). Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum).
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; drop_temp_dbs; [ $rc -ne 0 ] && [ "$MODE" = "release" ] && rollback_instructions; exit $rc' EXIT

# Smoke di DALAM container: token ADMIN/SALES dibuat di memori (rahasia JWT tidak keluar dari container, token tidak dicetak), hanya agregat dicetak. BACA-SAJA.
read -r -d '' SMOKE_JS <<'JS' || true
const jwt = require("jsonwebtoken"); const http = require("http"); const { PrismaClient } = require("@prisma/client");
const port = Number(process.env.PORT || 4000);
const get = (path, token) => new Promise((res, rej) => {
  const r = http.get({ host: "127.0.0.1", port, path, headers: token ? { Authorization: "Bearer " + token } : {} }, (x) => {
    let b = ""; x.on("data", (c) => (b += c)); x.on("end", () => res({ status: x.statusCode, headers: x.headers, body: b }));
  });
  r.on("error", rej); r.setTimeout(60000, () => r.destroy(new Error("timeout")));
});
const TERLARANG = /"(phone|name|customerId|messageId|orderId|ctwaClid|leadSourceDetail|waId|jid|content|body)"\s*:/;
(async () => {
  const prisma = new PrismaClient();
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true } });
  await prisma.$disconnect();
  if (!admin) { console.log("ERROR=tidak ada user ADMIN aktif"); process.exit(2); }
  const sign = (id, roles) => jwt.sign({ id, name: "smoke", role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: 600 });
  const tA = sign(admin.id, ["ADMIN"]), tS = sign("00000000-0000-0000-0000-000000000000", ["SALES"]);
  const wib = (ms) => new Date(Date.now() + 7 * 3600e3 + ms).toISOString().slice(0, 10);
  const q = `dari=${wib(-6 * 86400e3)}&sampai=${wib(0)}`;
  const base = "/api/atribusi/iklan";
  const noAuth = await get(`${base}?${q}`);
  const sales = await get(`${base}?${q}`, tS);
  const tanpaRentang = await get(base, tA);
  const bad = await get(`${base}?dari=2026-13-01&sampai=2026-13-02`, tA);
  const semua = await get(`${base}?${q}&sinyal=SEMUA`, tA);
  const r = await get(`${base}?${q}&level=campaign`, tA);
  console.log("STATUS_NOAUTH=" + noAuth.status); console.log("STATUS_SALES=" + sales.status);
  console.log("STATUS_TANPA_RENTANG=" + tanpaRentang.status); console.log("STATUS_PARAM_SALAH=" + bad.status); console.log("STATUS_SINYAL_SEMUA=" + semua.status);
  console.log("STATUS_ADMIN=" + r.status); console.log("CACHE=" + (r.headers["cache-control"] || ""));
  if (r.status !== 200) { console.log("ERROR=admin status " + r.status); process.exit(3); }
  const j = JSON.parse(r.body);
  console.log("REKON_OK=" + j.rekonsiliasi.ok); console.log("REKON_CEK=" + j.rekonsiliasi.cek.length);
  console.log("REKON_GAGAL=" + j.rekonsiliasi.cek.filter((c) => !c.ok).map((c) => c.id).join(","));
  console.log("CPA_ROAS_NULL=" + (j.biaya.cpa === null && j.biaya.roas === null && j.grup.every((g) => g.biaya.cpa === null && g.biaya.roas === null)));
  console.log("SINYAL=" + j.atribusi.sinyalDipakai.join(","));
  console.log("AUDIT_MASUK_ATRIBUSI=" + j.audit.adReplyTanpaPenanda.masukAtribusi);
  console.log("LEAD_UNIK=" + j.jumlahTeratribusi.leadUnik); console.log("CLOSING_UTAMA=" + j.jumlahTeratribusi.closingUtama.customerLunasTerbuktiLedger);
  console.log("JUMLAH_GRUP=" + j.jumlahGrup);
  console.log("PERINGATAN=" + j.peringatan.map((w) => w.kode).join(","));
  const terlarang = TERLARANG.exec(r.body);
  console.log("FORBIDDEN=" + (terlarang ? terlarang[1] : "none"));
  const kes = await get(`${base}/kesehatan`, tA);
  console.log("KES_STATUS=" + kes.status);
  if (kes.status === 200) {
    const k = JSON.parse(kes.body);
    console.log("KES_CAPTURE_AKTIF=" + k.captureAktif);
    console.log("KES_TOUCH_TOTAL=" + k.db.touchTotal); console.log("KES_TOUCH_24JAM=" + k.db.touch24Jam);
    console.log("KES_GAGAL=" + k.proses.gagal); console.log("KES_GAGAL_PULIH=" + k.proses.gagalPulih); console.log("KES_FALLBACK=" + k.proses.fallbackTransaksi);
    console.log("KES_TERTUNDA=" + k.proses.tertunda); console.log("KES_PENDING_PEMETAAN=" + k.db.pendingPemetaan.touch);
    const t2 = TERLARANG.exec(kes.body);
    console.log("KES_FORBIDDEN=" + (t2 ? t2[1] : "none"));
  }
  const refA = await get(`${base}/referensi`, tA), refS = await get(`${base}/referensi`, tS), ekspor = await get(`${base}/ekspor-id`, tA);
  console.log("REF_STATUS_ADMIN=" + refA.status); console.log("REF_STATUS_SALES=" + refS.status); console.log("EKSPOR_STATUS=" + ekspor.status);
  const t3 = TERLARANG.exec(refA.body + ekspor.body);
  console.log("REF_FORBIDDEN=" + (t3 ? t3[1] : "none"));
})().catch((e) => { console.log("ERROR=" + String(e.message).slice(0, 120)); process.exit(4); });
JS

# Pemindai migrasi: dijalankan di VPS oleh skrip rilis; juga lokal terhadap berkas migrasi. FAIL-CLOSED, daftar putih per pernyataan.
read -r -d '' SCAN_JS <<'SCANJS' || true
// Migrasi aditif Fase 2: TEPAT 3 CREATE TABLE (kolom + constraint persis), 6 CREATE INDEX, 4 FK. Tidak ada ALTER/DROP/INSERT/UPDATE/DELETE/GRANT/fungsi/trigger.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };
const hitung = {};
const tambah = (k) => { hitung[k] = (hitung[k] ?? 0) + 1; };
const TABEL = {
  meta_ad_reference_imports: {
    pk: "id",
    kolom: ['"id" UUID NOT NULL', '"source" VARCHAR(24) NOT NULL', '"file_name" VARCHAR(120)', '"content_sha256" VARCHAR(64) NOT NULL', '"rows_total" INTEGER NOT NULL',
      '"rows_accepted" INTEGER NOT NULL', '"rows_rejected" INTEGER NOT NULL', '"rows_new" INTEGER NOT NULL', '"rows_changed" INTEGER NOT NULL',
      '"allow_correction" BOOLEAN NOT NULL DEFAULT false', '"created_by_id" TEXT', '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    constraint: ["meta_ad_reference_imports_pkey", "meta_ad_reference_imports_source_check", "meta_ad_reference_imports_counts_check"],
  },
  meta_ad_references: {
    pk: "ad_id",
    kolom: ['"ad_id" VARCHAR(32) NOT NULL', '"ad_set_id" VARCHAR(32) NOT NULL', '"campaign_id" VARCHAR(32) NOT NULL', '"ad_name" VARCHAR(200)', '"ad_set_name" VARCHAR(200)',
      '"campaign_name" VARCHAR(200)', '"source" VARCHAR(24) NOT NULL', '"synced_at" TIMESTAMP(3) NOT NULL', '"import_id" UUID',
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP', '"updated_at" TIMESTAMP(3) NOT NULL'],
    constraint: ["meta_ad_references_pkey", "meta_ad_references_ids_check", "meta_ad_references_hierarchy_check", "meta_ad_references_source_check"],
  },
  attribution_touches: {
    pk: "id",
    kolom: ['"id" UUID NOT NULL', '"customer_id" TEXT NOT NULL', '"message_id" TEXT', '"ad_id" VARCHAR(32) NOT NULL', '"ad_set_id" VARCHAR(32)', '"campaign_id" VARCHAR(32)',
      '"mapping_status_at_touch" VARCHAR(10) NOT NULL', '"touch_at" TIMESTAMP(3) NOT NULL', '"touch_date_wib" DATE NOT NULL', '"provider_ts" TIMESTAMP(3)',
      '"evidence_source" VARCHAR(24) NOT NULL', '"source_type" VARCHAR(16) NOT NULL', '"entry_point_source" VARCHAR(32)', '"entry_point_app" VARCHAR(32)',
      '"ctwa_clid_hash" VARCHAR(16)', '"customer_status_at_touch" VARCHAR(8) NOT NULL', '"customer_basis_at_touch" VARCHAR(24) NOT NULL', '"dedupe_key" VARCHAR(64) NOT NULL', '"capture_version" SMALLINT NOT NULL DEFAULT 1',
      '"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    constraint: ["attribution_touches_pkey", "attribution_touches_ad_id_check", "attribution_touches_parent_ids_check", "attribution_touches_mapping_check",
      "attribution_touches_evidence_check", "attribution_touches_source_type_check", "attribution_touches_customer_status_check", "attribution_touches_clid_hash_check", "attribution_touches_date_wib_check"],
  },
};
const INDEKS = new Map([
  ["attribution_touches_dedupe_key_key", "attribution_touches"], ["attribution_touches_customer_id_touch_at_idx", "attribution_touches"],
  ["attribution_touches_ad_id_touch_at_idx", "attribution_touches"], ["attribution_touches_touch_date_wib_idx", "attribution_touches"],
  ["meta_ad_references_campaign_id_idx", "meta_ad_references"], ["meta_ad_references_ad_set_id_idx", "meta_ad_references"],
]);
const FK = new Set([
  "meta_ad_reference_imports.created_by_id>User:SET NULL", "meta_ad_references.import_id>meta_ad_reference_imports:SET NULL",
  "attribution_touches.customer_id>Customer:CASCADE", "attribution_touches.message_id>Message:SET NULL",
]);
const dilihat = new Set();
const unik = (jenis, nama) => { const k = `${jenis}:${nama}`; if (dilihat.has(k)) gagal(`${jenis} duplikat: ${nama}`); dilihat.add(k); };
const bagiAtas = (s) => { const out = []; let d = 0, cur = "", q = false; for (const ch of s) { if (ch === "'") q = !q; if (!q) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { out.push(cur.trim()); cur = ""; continue; } } cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };

const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
for (const st of stmts) {
  const r = rapat(st);
  let m;
  if ((m = /^CREATE TABLE "([a-z_]+)" \((.+)\)$/.exec(r))) {
    const def = TABEL[m[1]];
    if (!def) gagal(`CREATE TABLE di luar daftar putih: ${m[1]}`);
    unik("tabel", m[1]);
    const kolom = [], cons = [];
    for (const it of bagiAtas(m[2])) {
      let c;
      if ((c = /^CONSTRAINT "([a-z_]+)" (?:PRIMARY KEY \("([a-z_]+)"\)|CHECK \((.+)\))$/.exec(it))) {
        cons.push(c[1]);
        if (c[2] !== undefined && c[2] !== def.pk) gagal(`PRIMARY KEY ${m[1]} bukan kolom ${def.pk}`);
        if (c[3] !== undefined && /\b(SELECT|FROM|INSERT|UPDATE|DELETE|EXECUTE|REFERENCES)\b/i.test(c[3])) gagal(`CHECK ${c[1]} memuat subquery/perintah terlarang`);
        continue;
      }
      if (/^CONSTRAINT\b/i.test(it) || /\b(REFERENCES|GENERATED|SERIAL|UNIQUE|CHECK)\b/i.test(it)) gagal(`klausa kolom di luar daftar putih pada ${m[1]}: ${it.slice(0, 80)}`);
      kolom.push(it);
    }
    if (JSON.stringify(kolom) !== JSON.stringify(def.kolom)) gagal(`kolom tabel ${m[1]} bukan yang diaudit: ${kolom.join(" | ")}`);
    if (JSON.stringify([...cons].sort()) !== JSON.stringify([...def.constraint].sort())) gagal(`constraint tabel ${m[1]} bukan yang diaudit: ${cons.join(",")}`);
    hitung.check = (hitung.check ?? 0) + cons.filter((n) => n.endsWith("_check")).length;
    tambah("create_table"); continue;
  }
  if ((m = /^CREATE (UNIQUE )?INDEX "([a-z_]+)" ON "([a-z_]+)"\("([a-z_]+)"(?:, "([a-z_]+)")?\)$/.exec(r))) {
    if (INDEKS.get(m[2]) !== m[3]) gagal(`indeks di luar daftar putih: ${m[2]} pada ${m[3]}`);
    if (!!m[1] !== (m[2] === "attribution_touches_dedupe_key_key")) gagal(`jenis UNIQUE indeks ${m[2]} salah`);
    unik("indeks", m[2]); tambah("create_index"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+_fkey)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "([A-Za-z_]+)"\("id"\) ON DELETE (CASCADE|SET NULL) ON UPDATE CASCADE$/.exec(r))) {
    const k = `${m[1]}.${m[3]}>${m[4]}:${m[5]}`;
    if (!FK.has(k)) gagal(`FK di luar daftar putih: ${k}`);
    unik("fk", k); tambah("fk"); continue;
  }
  gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
}
if ((hitung.create_table ?? 0) !== Object.keys(TABEL).length) gagal("tabel baru harus tepat 3");
if ((hitung.create_index ?? 0) !== INDEKS.size) gagal(`indeks harus tepat ${INDEKS.size}`);
if ((hitung.fk ?? 0) !== FK.size) gagal(`FK harus tepat ${FK.size}`);
console.log(JSON.stringify({ total: stmts.length, create_table: 0, create_index: 0, fk: 0, check: 0, ...hitung }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
uji_negatif_pemindai() {
  NEG=0
  harus_ditolak() {
    local nama="$1" teks="$2" o
    if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
    NEG=$((NEG+1))
  }
  tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
  harus_ditolak "DROP TABLE tabel lama" "$(tambah_stmt 'DROP TABLE "Customer";')"
  harus_ditolak "DROP tabel baru" "$(tambah_stmt 'DROP TABLE "attribution_touches";')"
  harus_ditolak "UPDATE tabel lama" "$(tambah_stmt "UPDATE \"Customer\" SET \"leadSource\" = 'META_ADS';")"
  harus_ditolak "DELETE tabel lama" "$(tambah_stmt 'DELETE FROM "Message";')"
  harus_ditolak "INSERT backfill touch" "$(tambah_stmt "INSERT INTO \"attribution_touches\" (\"id\") VALUES (gen_random_uuid());")"
  harus_ditolak "INSERT referensi (seed)" "$(tambah_stmt "INSERT INTO \"meta_ad_references\" (\"ad_id\") VALUES ('1');")"
  harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "Customer";')"
  harus_ditolak "ALTER TABLE tabel lama (kolom baru)" "$(tambah_stmt 'ALTER TABLE "Customer" ADD COLUMN "ad_id" TEXT;')"
  harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "Customer" DROP COLUMN "ctwa_clid";')"
  harus_ditolak "ALTER COLUMN" "$(tambah_stmt 'ALTER TABLE "Message" ALTER COLUMN "content" TYPE TEXT;')"
  harus_ditolak "RENAME" "$(tambah_stmt 'ALTER TABLE "Customer" RENAME COLUMN "phone" TO "telp";')"
  harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "Customer"("createdAt");')"
  harus_ditolak "tabel baru keempat" "$(tambah_stmt 'CREATE TABLE "attribution_extra" ("id" UUID NOT NULL, CONSTRAINT "attribution_extra_pkey" PRIMARY KEY ("id"));')"
  harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "attribution_touches" TO PUBLIC;')"
  harus_ditolak "fungsi/trigger liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
  harus_ditolak "trigger dimatikan" "$(tambah_stmt 'ALTER TABLE "attribution_touches" DISABLE TRIGGER ALL;')"
  harus_ditolak "kolom nomor telepon ditambahkan ke touch" "$(printf '%s\n' "$ALL_SQL" | sed 's/    "capture_version" SMALLINT NOT NULL DEFAULT 1,/    "capture_version" SMALLINT NOT NULL DEFAULT 1,\n    "phone" TEXT,/')"
  harus_ditolak "kolom clid mentah ditambahkan" "$(printf '%s\n' "$ALL_SQL" | sed 's/    "ctwa_clid_hash" VARCHAR(16),/    "ctwa_clid_hash" VARCHAR(16),\n    "ctwa_clid" TEXT,/')"
  harus_ditolak "kolom payload mentah ditambahkan" "$(printf '%s\n' "$ALL_SQL" | sed 's/    "dedupe_key" VARCHAR(64) NOT NULL,/    "dedupe_key" VARCHAR(64) NOT NULL,\n    "payload" JSONB,/')"
  harus_ditolak "kolom hilang" "$(printf '%s\n' "$ALL_SQL" | grep -v '"customer_status_at_touch" VARCHAR(8) NOT NULL,')"
  harus_ditolak "tipe kolom diubah (ad_id jadi BIGINT)" "$(printf '%s\n' "$ALL_SQL" | sed '0,/"ad_id" VARCHAR(32) NOT NULL,/s//"ad_id" BIGINT NOT NULL,/')"
  harus_ditolak "default liar" "$(printf '%s\n' "$ALL_SQL" | sed "s/DEFAULT CURRENT_TIMESTAMP/DEFAULT now()/")"
  harus_ditolak "CHECK Ad ID dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'attribution_touches_ad_id_check')"
  harus_ditolak "nama CHECK diganti" "$(printf '%s\n' "$ALL_SQL" | sed 's/"attribution_touches_evidence_check"/"attribution_touches_evil_check"/')"
  harus_ditolak "CHECK memuat subquery" "$(printf '%s\n' "$ALL_SQL" | sed "s/CHECK (\"source_type\" = 'ad')/CHECK ((SELECT count(*) FROM \"Customer\") >= 0)/")"
  harus_ditolak "FK Message jadi CASCADE" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "Message"("id") ON DELETE SET NULL/REFERENCES "Message"("id") ON DELETE CASCADE/')"
  harus_ditolak "FK Customer jadi RESTRICT" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "Customer"("id") ON DELETE CASCADE/REFERENCES "Customer"("id") ON DELETE RESTRICT/')"
  harus_ditolak "FK ke tabel di luar daftar" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "Customer"("id")/REFERENCES "Order"("id")/')"
  harus_ditolak "FK baru dari tabel lama" "$(tambah_stmt 'ALTER TABLE "Customer" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("id") REFERENCES "attribution_touches"("id") ON DELETE CASCADE ON UPDATE CASCADE;')"
  harus_ditolak "indeks UNIQUE dedupe dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'attribution_touches_dedupe_key_key')"
  harus_ditolak "indeks dedupe bukan UNIQUE" "$(printf '%s\n' "$ALL_SQL" | sed 's/CREATE UNIQUE INDEX "attribution_touches_dedupe_key_key"/CREATE INDEX "attribution_touches_dedupe_key_key"/')"
  harus_ditolak "indeks tambahan di tabel baru" "$(tambah_stmt 'CREATE INDEX "attribution_touches_extra_idx" ON "attribution_touches"("created_at");')"
  harus_ditolak "kolom PRIMARY KEY referensi diganti" "$(printf '%s\n' "$ALL_SQL" | sed 's/PRIMARY KEY ("ad_id")/PRIMARY KEY ("campaign_id")/')"
  [ "$NEG" -ge 30 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 30)"
  ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/pengosongan tabel/ALTER tabel lama/kolom PII-clid-payload/tipe/default/CHECK/FK/indeks/trigger/fungsi/GRANT) SEMUANYA ditolak"
}

# Mode uji mandiri pemindai (tanpa produksi): ATRI2_SCAN_SELFTEST_FILE=<migration.sql> -> pemindai harus menerima berkas dan menolak SEMUA mutan.
if [ -n "${ATRI2_SCAN_SELFTEST_FILE:-}" ]; then
  BK_DIR="$(mktemp -d)"; SCAN="$BK_DIR/scan-migrasi.mjs"; printf '%s\n' "$SCAN_JS" > "$SCAN"
  ALL_SQL="$(tr -d '\r' < "$ATRI2_SCAN_SELFTEST_FILE")"
  H="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || { echo "SCAN_DITOLAK"; exit 1; }
  [ "$H" = "$SCAN_EXPECT" ] || { echo "SCAN_HITUNGAN_BEDA $H"; exit 1; }
  echo "SCAN_OK $H"
  uji_negatif_pemindai
  rm -f "$SCAN"; rmdir "$BK_DIR" 2>/dev/null || true
  exit 0
fi

# Uji PERILAKU di DB rehearsal (hasil restore backup nyata). Seluruhnya dibatalkan di akhir (RAISE EXCEPTION ROLLBACK_UJI).
read -r -d '' UJI_SQL <<'UJISQL' || true
DO $t$
DECLARE
  cid text; tolak int := 0; lolos int := 0; imp uuid := gen_random_uuid();
BEGIN
  SELECT id INTO cid FROM "Customer" LIMIT 1;
  IF cid IS NULL THEN RAISE EXCEPTION 'ROLLBACK_UJI tolak=0 lolos=0 (tidak ada customer contoh)'; END IF;
  -- touch: bentuk Ad ID, sumber bukti, tipe sumber, konsistensi pemetaan, tanggal WIB, hash clid
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), cid, 'abc', 'UNMAPPED', '2026-10-05 03:00:00', '2026-10-05', 'CTWA_AD', 'ad', 'NEW', 'WEBHOOK_MEMBUAT', 'u1'); RAISE EXCEPTION 'TIDAK_DITOLAK_ad_id';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), cid, '52694481763484', 'UNMAPPED', '2026-10-05 03:00:00', '2026-10-05', 'TEBAKAN_NAMA', 'ad', 'NEW', 'WEBHOOK_MEMBUAT', 'u2'); RAISE EXCEPTION 'TIDAK_DITOLAK_evidence';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), cid, '52694481763484', 'UNMAPPED', '2026-10-05 03:00:00', '2026-10-05', 'CTWA_AD', 'post', 'NEW', 'WEBHOOK_MEMBUAT', 'u3'); RAISE EXCEPTION 'TIDAK_DITOLAK_source_type';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, ad_set_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), cid, '52694481763484', '52694481763284', 'MAPPED', '2026-10-05 03:00:00', '2026-10-05', 'CTWA_AD', 'ad', 'NEW', 'WEBHOOK_MEMBUAT', 'u4'); RAISE EXCEPTION 'TIDAK_DITOLAK_mapped_tanpa_campaign';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, campaign_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), cid, '52694481763484', '52694481763084', 'UNMAPPED', '2026-10-05 03:00:00', '2026-10-05', 'CTWA_AD', 'ad', 'NEW', 'WEBHOOK_MEMBUAT', 'u5'); RAISE EXCEPTION 'TIDAK_DITOLAK_unmapped_berisi_id';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), cid, '52694481763484', 'UNMAPPED', '2026-10-05 18:00:00', '2026-10-05', 'CTWA_AD', 'ad', 'NEW', 'WEBHOOK_MEMBUAT', 'u6'); RAISE EXCEPTION 'TIDAK_DITOLAK_tanggal_wib';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, ctwa_clid_hash, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), cid, '52694481763484', 'UNMAPPED', '2026-10-05 03:00:00', '2026-10-05', 'CTWA_AD', 'ad', 'AfhKBK8ZBWyKw3p4', 'NEW', 'WEBHOOK_MEMBUAT', 'u7'); RAISE EXCEPTION 'TIDAK_DITOLAK_clid_mentah';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), cid, '52694481763484', 'UNMAPPED', '2026-10-05 03:00:00', '2026-10-05', 'CTWA_AD', 'ad', 'NEW', 'TANPA_BUKTI', 'u9'); RAISE EXCEPTION 'TIDAK_DITOLAK_new_tanpa_bukti';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), cid, '52694481763484', 'UNMAPPED', '2026-10-05 03:00:00', '2026-10-05', 'CTWA_AD', 'ad', 'UNKNOWN', 'WEBHOOK_MEMBUAT', 'u10'); RAISE EXCEPTION 'TIDAK_DITOLAK_unknown_berbukti';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  -- baris sah, dedupe unik, FK customer
  INSERT INTO attribution_touches (id, customer_id, ad_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
    VALUES (gen_random_uuid(), cid, '52694481763484', 'UNMAPPED', '2026-10-05 03:00:00', '2026-10-05', 'CTWA_AD', 'ad', 'NEW', 'WEBHOOK_MEMBUAT', 'uji-sah-1'); lolos := lolos + 1;
  INSERT INTO attribution_touches (id, customer_id, ad_id, ad_set_id, campaign_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
    VALUES (gen_random_uuid(), cid, '52694481763484', '52694481763284', '52694481763084', 'MAPPED', '2026-10-05 18:00:00', '2026-10-06', 'CTWA_AD', 'ad', 'EXISTING', 'RIWAYAT_PESAN', 'uji-sah-2'); lolos := lolos + 1;
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), cid, '52694481763484', 'UNMAPPED', '2026-10-05 03:00:00', '2026-10-05', 'CTWA_AD', 'ad', 'NEW', 'WEBHOOK_MEMBUAT', 'uji-sah-1'); RAISE EXCEPTION 'TIDAK_DITOLAK_dedupe';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO attribution_touches (id, customer_id, ad_id, mapping_status_at_touch, touch_at, touch_date_wib, evidence_source, source_type, customer_status_at_touch, customer_basis_at_touch, dedupe_key)
        VALUES (gen_random_uuid(), 'tidak-ada-customer', '52694481763484', 'UNMAPPED', '2026-10-05 03:00:00', '2026-10-05', 'CTWA_AD', 'ad', 'NEW', 'WEBHOOK_MEMBUAT', 'u8'); RAISE EXCEPTION 'TIDAK_DITOLAK_fk_customer';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  -- referensi Ad -> Ad Set -> Campaign
  BEGIN INSERT INTO meta_ad_references (ad_id, ad_set_id, campaign_id, source, synced_at, updated_at) VALUES ('5.2E+13', '52694481763284', '52694481763084', 'MANUAL', now(), now()); RAISE EXCEPTION 'TIDAK_DITOLAK_notasi_ilmiah';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_ad_references (ad_id, ad_set_id, campaign_id, source, synced_at, updated_at) VALUES ('52694481763484', '52694481763484', '52694481763084', 'MANUAL', now(), now()); RAISE EXCEPTION 'TIDAK_DITOLAK_hierarki';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_ad_references (ad_id, ad_set_id, campaign_id, source, synced_at, updated_at) VALUES ('52694481763484', '52694481763284', '52694481763084', 'TEBAKAN', now(), now()); RAISE EXCEPTION 'TIDAK_DITOLAK_sumber_referensi';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO meta_ad_references (ad_id, ad_set_id, campaign_id, ad_name, source, synced_at, updated_at) VALUES ('52694481763484', '52694481763284', '52694481763084', 'Teardown Untuk Ibu', 'ADS_MANAGER_EXPORT', now(), now()); lolos := lolos + 1;
  BEGIN INSERT INTO meta_ad_references (ad_id, ad_set_id, campaign_id, source, synced_at, updated_at) VALUES ('52694481763484', '52694481763284', '52694481763084', 'MANUAL', now(), now()); RAISE EXCEPTION 'TIDAK_DITOLAK_pk_referensi';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  -- log impor
  BEGIN INSERT INTO meta_ad_reference_imports (id, source, content_sha256, rows_total, rows_accepted, rows_rejected, rows_new, rows_changed) VALUES (gen_random_uuid(), 'LIAR', 'x', 1, 1, 0, 1, 0); RAISE EXCEPTION 'TIDAK_DITOLAK_sumber_impor';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_ad_reference_imports (id, source, content_sha256, rows_total, rows_accepted, rows_rejected, rows_new, rows_changed) VALUES (gen_random_uuid(), 'MANUAL', 'x', -1, 0, 0, 0, 0); RAISE EXCEPTION 'TIDAK_DITOLAK_hitungan_negatif';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO meta_ad_reference_imports (id, source, content_sha256, rows_total, rows_accepted, rows_rejected, rows_new, rows_changed) VALUES (imp, 'ADS_MANAGER_EXPORT', 'abc', 6, 6, 0, 6, 0); lolos := lolos + 1;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL

# Verifikasi pasca-rilis BACA-SAJA (fase 8 dan --verify-only). $1 = batas waktu log (UTC ISO), $2 = flag yang diharapkan: "mati" (rilis) | "bebas" (verify-only).
verify_live() {
  local since_utc="$1" flag_harapan="${2:-mati}" cid dir out k
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
    case "$f" in backend/src/*) ;; *) continue;; esac
    have="$(docker exec "$cid" sh -c "cat /app/${f#backend/}" | sha_lf)"
    [ "$have" = "${PINS[$f]}" ] || die "isi ${f} di container BERBEDA dari pin (${have:0:12} != ${PINS[$f]:0:12})"
  done; ok "berkas runtime di container = pin sha256"
  local logs errn
  logs="$(docker logs --since "$since_utc" "$cid" 2>&1 || true)"
  errn="$(printf '%s\n' "$logs" | grep -cE 'unhandledRejection|ReferenceError|SyntaxError|Cannot find module|TypeError|atribusi/iklan[a-z/-]* error|Gagal proses webhook WAHA' || true)"
  [ "$errn" = "0" ] || { printf '%s\n' "$logs" | grep -E 'unhandledRejection|ReferenceError|SyntaxError|Cannot find module|TypeError|atribusi/iklan[a-z/-]* error|Gagal proses webhook WAHA' | cut -c1-160 | head -5 | sed 's/^/        /'; die "${errn} baris galat runtime/webhook sejak switch"; }
  ok "log sejak ${since_utc}: 0 galat runtime, 0 'Gagal proses webhook WAHA'"
  local atr_warn
  atr_warn="$(printf '%s\n' "$logs" | grep -c '\[atribusi-touch\]' || true)"
  [ "$atr_warn" = "0" ] && ok "log: 0 peringatan [atribusi-touch]" || warn "${atr_warn} baris [atribusi-touch] di log (kode galat saja; periksa /api/atribusi/iklan/kesehatan)"
  # flag
  local fenv ffile
  fenv="$(container_flag "$cid")"; ffile="$(env_flag_text)"
  if [ "$flag_harapan" = "mati" ]; then
    [ "$fenv" != "true" ] && flag_mati_teks "$ffile" || die "flag ${FLAG_NAME} MENYALA pada rilis ini (container='${fenv}' .env='${ffile}') — rilis ini harus flag MATI"
    ok "flag ${FLAG_NAME} MATI (container='${fenv:-<kosong>}', .env='${ffile:-<tidak ada>}')"
  else
    ok "flag ${FLAG_NAME}: container='${fenv:-<kosong>}', .env='${ffile:-<tidak ada>}' (verify-only: tidak dipaksa)"
  fi
  # inbox (baca-saja): Message inbound sejak switch + tidak ada kegagalan webhook
  local inbound webhook_n
  inbound="$(PREV_DIR="$dir" psql_live -At -c "select count(*) from \"Message\" where direction::text='INBOUND' and \"createdAt\" >= '${since_utc}'::timestamptz")"
  angka_ok "$inbound" || die "hitungan Message inbound tidak valid: '${inbound}'"
  webhook_n="$(printf '%s\n' "$logs" | grep -c '\[WAHA webhook\] message' || true)"
  if [ "$inbound" -gt 0 ]; then ok "inbox hidup: ${inbound} pesan inbound tersimpan sejak ${since_utc} (${webhook_n} event webhook di log)"
  elif [ "${webhook_n:-0}" -gt 0 ]; then die "ada ${webhook_n} event webhook di log tetapi 0 Message inbound tersimpan — inbox bermasalah"
  else warn "belum ada trafik inbound sejak ${since_utc}: smoke inbox belum dapat dibuktikan dari data (ulangi dengan --verify-only)"; fi
  # smoke endpoint
  out="$(printf '%s' "$SMOKE_JS" | docker exec -i "$cid" node - 2>&1)" || { printf '%s\n' "$out" | cut -c1-200 | head -5 | sed 's/^/        /'; die "smoke endpoint gagal"; }
  val() { printf '%s\n' "$out" | sed -n "s/^$1=//p" | head -1; }
  [ "$(val STATUS_NOAUTH)" = "401" ] || die "tanpa token harus 401 (dapat $(val STATUS_NOAUTH))"
  [ "$(val STATUS_SALES)" = "403" ] || die "token SALES harus 403 (dapat $(val STATUS_SALES))"
  [ "$(val STATUS_TANPA_RENTANG)" = "400" ] || die "tanpa dari/sampai harus 400 (dapat $(val STATUS_TANPA_RENTANG))"
  [ "$(val STATUS_PARAM_SALAH)" = "400" ] || die "parameter salah harus 400 (dapat $(val STATUS_PARAM_SALAH))"
  [ "$(val STATUS_SINYAL_SEMUA)" = "400" ] || die "sinyal=SEMUA harus 400 — AD_REPLY_UNMARKED hanya audit (dapat $(val STATUS_SINYAL_SEMUA))"
  [ "$(val STATUS_ADMIN)" = "200" ] || die "ADMIN harus 200 (dapat $(val STATUS_ADMIN))"
  [ "$(val CACHE)" = "no-store" ] || die "Cache-Control harus no-store"
  ok "RBAC: tanpa token 401, SALES 403, tanpa rentang 400, parameter salah 400, sinyal=SEMUA 400, ADMIN 200; no-store"
  [ "$(val REKON_OK)" = "true" ] || die "rekonsiliasi internal GAGAL: $(val REKON_GAGAL)"; ok "rekonsiliasi internal OK ($(val REKON_CEK) pemeriksaan)"
  [ "$(val CPA_ROAS_NULL)" = "true" ] || die "CPA/ROAS harus null (spend belum terhubung)"; ok "CPA/ROAS = null"
  [ "$(val SINYAL)" = "CTWA_AD" ] && [ "$(val AUDIT_MASUK_ATRIBUSI)" = "false" ] || die "atribusi utama harus hanya CTWA_AD dan audit tidak masuk atribusi"
  ok "atribusi utama = CTWA_AD; AD_REPLY_UNMARKED hanya audit"
  [ "$(val FORBIDDEN)" = "none" ] && [ "$(val KES_FORBIDDEN)" = "none" ] && [ "$(val REF_FORBIDDEN)" = "none" ] || die "respons memuat kunci terlarang (laporan=$(val FORBIDDEN) kesehatan=$(val KES_FORBIDDEN) referensi=$(val REF_FORBIDDEN))"
  ok "respons: 0 nomor/nama/customerId/messageId/orderId/clid mentah/isi chat"
  [ "$(val KES_STATUS)" = "200" ] || die "/kesehatan harus 200"
  [ "$(val REF_STATUS_ADMIN)" = "200" ] && [ "$(val REF_STATUS_SALES)" = "403" ] && [ "$(val EKSPOR_STATUS)" = "200" ] || die "referensi/ekspor-id: RBAC tidak sesuai"
  ok "referensi + ekspor-id: ADMIN 200, SALES 403"
  if [ "$flag_harapan" = "mati" ]; then
    [ "$(val KES_CAPTURE_AKTIF)" = "false" ] || die "/kesehatan melaporkan captureAktif=$(val KES_CAPTURE_AKTIF) pada rilis flag-MATI"
    [ "$(val KES_TOUCH_TOTAL)" = "0" ] || die "ada $(val KES_TOUCH_TOTAL) touch padahal flag MATI"
    ok "kesehatan: captureAktif=false, 0 touch (flag MATI), tertunda=$(val KES_TERTUNDA)"
  else
    ok "kesehatan: captureAktif=$(val KES_CAPTURE_AKTIF) touch=$(val KES_TOUCH_TOTAL) (24 jam: $(val KES_TOUCH_24JAM)) gagal=$(val KES_GAGAL) fallback=$(val KES_FALLBACK) gagalPulih=$(val KES_GAGAL_PULIH) tertunda=$(val KES_TERTUNDA) pendingPemetaan=$(val KES_PENDING_PEMETAAN)"
  fi
  ok "laporan: lead teratribusi=$(val LEAD_UNIK), closing utama=$(val CLOSING_UTAMA), grup=$(val JUMLAH_GRUP); peringatan: $(val PERINGATAN)"
  return 0
}

if [ "$MODE" = "verify" ]; then
  say "VERIFY-ONLY (baca-saja) rilis ${DEPLOY_SHORT}"
  PREV_DIR="$RELEASES/$DEPLOY_SHORT"; [ -d "$PREV_DIR" ] || die "release dir ${PREV_DIR} tidak ada"
  rc=0; verify_live "${VERIFY_SINCE_UTC:-$(date -u -d '-30 minutes' +%Y-%m-%dT%H:%M:%SZ)}" bebas || rc=$?
  trap - EXIT; exit "$rc"
fi

if [ "$MODE" = "rollback" ]; then
  say "ROLLBACK ${DEPLOY_SHORT} -> ${BASE_SHORT} (KODE saja; tabel TIDAK dihapus; .env tidak disentuh)"
  OLD_DIR="$RELEASES/$BASE_SHORT"
  [ -d "$OLD_DIR" ] && [ -f "$OLD_DIR/docker-compose.release.yml" ] || die "release sebelumnya ${OLD_DIR} tidak ada/tidak lengkap"
  docker image inspect "$ROLLBACK_TAG" >/dev/null 2>&1 || die "image rollback ${ROLLBACK_TAG} tidak ada"
  CID="$(backend_cid)"; [ "$(printf '%s\n' "$CID" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
  CUR_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID")"
  [ "$CUR_DIR" = "$NEW_DIR" ] || die "release aktif (${CUR_DIR}) BUKAN ${DEPLOY_SHORT}; rollback ini tidak berlaku (jangan menimpa rilis lain)"
  for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; [ "$lf" = "/tmp/release-atribusi-iklan.lock" ] && continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf})"; done
  exec 9>/tmp/release-atribusi-iklan.lock; flock -n 9 || die "rilis/rollback ini sudah berjalan"
  ENV_B="$(env_sha)"; CTWA_B="$(ctwa_env_count "$CID")"
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
  PREV_DIR="$OLD_DIR"
  TBL="$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('attribution_touches','meta_ad_references','meta_ad_reference_imports')")"
  [ "$TBL" = "3" ] || die "tabel atribusi tidak lengkap setelah rollback (${TBL}/3) — rollback kode tidak boleh menghapus tabel"
  TOUCH_N="$(psql_live -At -c "select count(*) from attribution_touches")"
  ok "rollback selesai: release ${BASE_SHORT}, image $(docker inspect -f '{{.Image}}' "$CID2" | cut -c8-19), .env tidak berubah, CTWA_* ${CTWA_B}; 3 tabel atribusi UTUH (${TOUCH_N} touch tersimpan, tidak dihapus)"
  [ "$(env_flag_text)" = "" ] || warn "backend/.env masih memuat ${FLAG_NAME}: kode lama mengabaikannya; hapus/ubah baris itu sebelum rilis ulang bila capture tidak diinginkan"
  trap - EXIT; exit 0
fi

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df find node; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"; done
exec 9>/tmp/release-atribusi-iklan.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "atri2\|release-atribusi-iklan\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"
disk_gate "awal"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, pin isi, pin migrasi, pemindai DDL (+ uji negatif pemindai)"
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
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$|^docker-compose|(^|/)Dockerfile$|^frontend/|(^|/)\.env' || die "dependensi/compose/Dockerfile/frontend/.env berubah — rilis ini TIDAK boleh mengubahnya"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
MIG_LIST=""; EXPECT_PRISMA="backend/prisma/schema.prisma"
for e in $MIGS; do MIG_LIST="$MIG_LIST ${e%%:*}"; EXPECT_PRISMA="$(printf '%s\nbackend/prisma/migrations/%s/migration.sql' "$EXPECT_PRISMA" "${e%%:*}")"; done
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat schema.prisma + migrasi rilis ini"; }
# Migrasi baseline TIDAK boleh diubah/dihapus: hanya penambahan. schema.prisma: nol baris dihapus/diubah.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
SCHEMA_DEL="$(sg diff --numstat "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | awk '{print $2}')"
[ "$SCHEMA_DEL" = "0" ] || die "schema.prisma menghapus/mengubah ${SCHEMA_DEL} baris yang sudah ada — hanya penambahan yang diizinkan"
for f in "${!PINS[@]}"; do
  have="$(sg show "${DEPLOY_SHA}:${f}" | sha_lf)"
  [ "$have" = "${PINS[$f]}" ] || die "isi ${f} di kandidat (${have:0:12}) BERBEDA dari pin (${PINS[$f]:0:12}) — tinjau ulang lalu perbarui pin"
done; ok "${#PINS[@]} berkas (runtime + skema) di kandidat = pin sha256"
ALL_SQL=""
for e in $MIGS; do
  n="${e%%:*}"; pin="${e##*:}"
  [[ "$n" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $n"
  s="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${n}/migration.sql" | tr -d '\r')"
  h="$(printf '%s\n' "$s" | sha256sum | cut -d' ' -f1)"
  [ "$pin" = "$h" ] || die "isi migrasi ${n} BERBEDA dari yang diaudit (sha256 ${h}) — audit ulang lalu perbarui pin"
  ok "migrasi ${n}: sha256 cocok pin (${h:0:12})"
  ALL_SQL="$ALL_SQL
$s"
done
SCAN="$BK_DIR/scan-migrasi.mjs"; printf '%s\n' "$SCAN_JS" > "$SCAN"
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (3 tabel baru, 6 indeks, 4 FK, 13 CHECK bernama); tanpa ALTER/DROP/INSERT/UPDATE/DELETE/GRANT/fungsi/trigger"
uji_negatif_pemindai
! sg grep -nE "ATRIBUSI_TOUCH_CAPTURE_ENABLED[[:space:]]*=" "$DEPLOY_SHA" -- backend/src >/dev/null 2>&1 || die "kode runtime menetapkan ${FLAG_NAME} (hanya boleh membaca)"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHORT}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist + 1 migrasi aditif"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(backend_cid)"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
PREV_COMMIT="$(tr -d '[:space:]' < "$PREV_DIR/.release-commit")"
[ "$(sg rev-parse --verify -q "${PREV_COMMIT}^{commit}" || true)" = "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline ${BASE_SHORT}; produksi bergeser — berhenti, bawa kandidat ke baseline terbaru"
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
for m in $MIG_LIST; do [ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${m}'")" = "0" ] || die "migrasi ${m} SUDAH tercatat di produksi (tidak diharapkan)"; done
for T in '"Customer"' '"Message"' '"Order"' '"User"'; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name=$(printf '%s' "$T" | tr '"' "'")")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('attribution_touches','meta_ad_references','meta_ad_reference_imports')")" = "0" ] || die "tabel atribusi SUDAH ada di produksi (tidak diharapkan)"
ENV_BEFORE="$(env_sha)"; CTWA_BEFORE="$(ctwa_env_count "$CID_OLD")"; CAPTURE_BEFORE="$(capture_count "$CID_OLD")"
ok "keadaan yang HARUS tetap: .env sha ${ENV_BEFORE:0:12}…, variabel CTWA_* di container = ${CTWA_BEFORE}, entri capture = ${CAPTURE_BEFORE}, migrasi terpasang = ${MIG_SEBELUM}"
[ "$(docker exec "$CID_OLD" sh -c 'env | grep -c "^WEBHOOK_DEBUG=1$" || true')" = "0" ] || die "WEBHOOK_DEBUG=1 aktif di produksi — matikan dulu"
FLAG_ENV_OLD="$(container_flag "$CID_OLD")"; FLAG_FILE_OLD="$(env_flag_text)"
{ [ "$FLAG_ENV_OLD" != "true" ] && flag_mati_teks "$FLAG_FILE_OLD"; } || die "flag ${FLAG_NAME} SUDAH menyala di produksi (container='${FLAG_ENV_OLD}' .env='${FLAG_FILE_OLD}') — rilis ini harus berangkat dengan flag MATI"
ok "flag ${FLAG_NAME} tidak menyala (container='${FLAG_ENV_OLD:-<kosong>}', .env='${FLAG_FILE_OLD:-<tidak ada>}')"
SALT_LEN="$(grep -E '^CTWA_CAPTURE_HASH_SALT=' "$PERSIST/backend/.env" | head -1 | sed 's/^[^=]*=//; s/["'"'"']//g' | tr -d '\r\n' | wc -c)"
[ "$SALT_LEN" -ge 16 ] && ok "CTWA_CAPTURE_HASH_SALT terisi (>= 16 karakter) — hash clid pada touch dapat dibuat" || warn "CTWA_CAPTURE_HASH_SALT kosong/pendek: touch akan tersimpan TANPA hash clid (ctwa_clid_hash NULL); atribusi Ad ID tidak terpengaruh"
CUST_N="$(psql_live -At -c "select count(*) from \"Customer\"")"; MSG_N="$(psql_live -At -c "select count(*) from \"Message\"")"
ok "volume: Customer=${CUST_N}, Message=${MSG_N} (tabel lama tidak diubah oleh migrasi)"
# SIDIK JARI tabel lama (seluruh baris, jsonb) sebelum migrasi — dibandingkan dengan hasil restore dan sesudah rehearsal. Migrasi ini tidak menyentuh tabel lama.
FP_SQL="select 'Customer', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Customer\" x
union all select 'Message_n', count(*), '-' from \"Message\" x
union all select 'Order', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Order\" x
union all select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x
union all select 'fin_settings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from fin_settings x"
FP_N=5
# Sidik jari SKEMA tabel lama (kolom + tipe + urutan): rilis ini tidak boleh mengubahnya.
SKEMA_SQL="select table_name, count(*), md5(string_agg(column_name || ':' || data_type, ',' order by ordinal_position)) from information_schema.columns where table_schema='public' and table_name in ('Customer','Message','Order','payments','User') group by table_name"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; DIST_KB="$(du -sk "$PREV_DIR/frontend/dist" | cut -f1)"
ok "DB $(( DB_BYTES / 1048576 )) MiB, dist aktif $(( DIST_KB / 1024 )) MiB"
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
disk_gate "setelah backup"

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
ln -s "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" 2>/dev/null || true
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.yml") >/dev/null || die "docker-compose.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/backend/package.json") <(tr -d '\r' < "$NEW_DIR/backend/package.json") >/dev/null || die "backend/package.json berbeda dari release aktif"
ok "release dir dibuat; compose + package.json identik dengan release aktif; dist = salinan dist aktif"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
disk_gate "sebelum build"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"
for f in "${!PINS[@]}"; do
  case "$f" in backend/src/*) ;; *) continue;; esac
  have="$(dcp "$NEW_DIR" run --rm --no-deps -T --entrypoint sh backend -c "cat /app/${f#backend/}" </dev/null | sha_lf)"
  [ "$have" = "${PINS[$f]}" ] || die "image baru memuat ${f} berbeda dari pin"
done; ok "image baru memuat berkas runtime persis pin (sebelum switch)"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint, bandingkan sidik jari tabel lama, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_${TAG_KODE}_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
for T in '"Order"' '"Customer"' '"Message"' payments fin_settings; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  TOL=50; [ "$T" = '"Message"' ] && TOL=2000
  [ "$B" -le "$A" ] && [ $(( A - B )) -le "$TOL" ] || die "restore rehearsal tidak cocok untuk $T (produksi=$A restore=$B)"
done
ok "restore nyata ke DB sementara cocok (Order, Customer, Message, payments, pengaturan)"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sebelum.txt" || die "sidik jari rehearsal sebelum gagal"
[ "$(grep -c . "$BK_DIR/fp-reh-sebelum.txt")" = "$FP_N" ] || die "sidik jari rehearsal tidak ${FP_N} tabel"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$(printf '%s\n' "$REH_PEND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || die "migrasi pending pada DB rehearsal bukan tepat migrasi rilis ini: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status rehearsal tidak 'up to date'"
[ "$(RPSQL "select count(*) from information_schema.tables where table_schema='public' and table_name in ('attribution_touches','meta_ad_references','meta_ad_reference_imports')")" = "3" ] || die "3 tabel atribusi tidak terpasang di rehearsal"
for T in attribution_touches meta_ad_references meta_ad_reference_imports; do [ "$(RPSQL "select count(*) from $T")" = "0" ] || die "tabel baru $T TIDAK kosong setelah migrasi (backfill tidak diizinkan)"; done
[ "$(RPSQL "select count(*) from pg_constraint where conrelid in ('attribution_touches'::regclass,'meta_ad_references'::regclass,'meta_ad_reference_imports'::regclass) and contype='c'")" = "13" ] || die "jumlah CHECK pada tabel baru bukan 13"
[ "$(RPSQL "select count(*) from pg_indexes where tablename in ('attribution_touches','meta_ad_references')")" = "8" ] || die "jumlah indeks (pkey + 6) pada tabel baru bukan 8"
ok "3 tabel baru kosong; 13 CHECK; 8 indeks (termasuk pkey); migrate status up to date"
UJI_OUT="$(printf '%s\n' "$UJI_SQL" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; die "perilaku constraint SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 17 ] || { printf '%s\n' "$UJI_OUT"; die "uji perilaku: penolakan terbukti terlalu sedikit (${UJI_TOLAK:-?}; minimal 17)"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" -ge 4 ] || { printf '%s\n' "$UJI_OUT"; die "uji perilaku: data benar yang lolos terlalu sedikit (${UJI_LOLOS:-?}; minimal 4)"; }
ok "perilaku terbukti di DB rehearsal: tolak=${UJI_TOLAK} lolos=${UJI_LOLOS} — Ad ID/bukti/tipe/pemetaan/tanggal WIB/clid mentah/dedupe/FK/hierarki ditolak bila salah; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || die "sidik jari rehearsal sesudah gagal"
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
for T in attribution_touches meta_ad_references meta_ad_reference_imports; do [ "$(RPSQL "select count(*) from $T")" = "0" ] || die "data uji rehearsal tidak dibatalkan ($T)"; done
drop_temp_dbs; REH_DB=""
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi + uji perilaku; tabel baru kosong; DB sementara dihapus"
disk_gate "sebelum switch"

PHASE="6-migrate"; say "6. Migrasi aditif (image baru; backend lama tetap melayani)"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum migrasi — baseline bergeser"
[ "$(sed -n 1p "$PREV_DIR/.release-commit" | tr -d '[:space:]')" = "$PREV_COMMIT" ] || die "baseline berubah selama persiapan"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah selama persiapan — JANGAN migrasi"
[ "$(env_sha)" = "$ENV_BEFORE" ] || die ".env berubah selama rilis — JANGAN migrasi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
for m in $MIG_LIST; do grep -Fx "$m" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${m} SUDAH terpasang sebelum rilis (tidak diharapkan)"; done
PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") || true)"
[ "$(printf '%s\n' "$PENDING" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || die "migrasi pending bukan tepat migrasi rilis ini: $(printf '%s' "$PENDING" | tr '\n' ' ')"
psql_live -At -c "$SKEMA_SQL" | LC_ALL=C sort > "$BK_DIR/skema-prod-sebelum.txt" || die "sidik jari skema produksi sebelum migrasi gagal"
[ "$(grep -c . "$BK_DIR/skema-prod-sebelum.txt")" = "5" ] || die "sidik jari skema tidak 5 tabel"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
for m in $MIG_LIST; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 1 ))" ] || die "jumlah migrasi terpasang != sebelum + 1"
ok "1 migrasi diterapkan; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"
for T in attribution_touches meta_ad_references meta_ad_reference_imports; do [ "$(psql_live -At -c "select count(*) from $T")" = "0" ] || die "tabel baru $T TIDAK kosong setelah migrasi sebelum switch"; done
psql_live -At -c "$SKEMA_SQL" | LC_ALL=C sort > "$BK_DIR/skema-prod-sesudah.txt" || die "sidik jari skema produksi sesudah migrasi gagal"
# Isi baris tabel lama berubah karena trafik sah selama rilis (tidak dibandingkan keras); yang dijaga: SKEMA tabel lama identik dan tabel baru kosong.
cmp -s "$BK_DIR/skema-prod-sebelum.txt" "$BK_DIR/skema-prod-sesudah.txt" || { diff "$BK_DIR/skema-prod-sebelum.txt" "$BK_DIR/skema-prod-sesudah.txt" || true; die "skema tabel lama BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: 3 tabel baru kosong; skema 5 tabel lama identik"
[ "$(env_sha)" = "$ENV_BEFORE" ] || die ".env berubah selama rilis — JANGAN switch"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah — JANGAN switch"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali; env TIDAK diubah; flag MATI)"
SWITCH_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for _ in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(backend_cid)"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja): RBAC, rekonsiliasi, privasi, flag MATI, inbox"
PREV_DIR="$NEW_DIR"
sleep 20
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang bukan sebelum + 1"; ok "migrasi terpasang = sebelum + 1 (${MIG_SEBELUM} + 1)"
[ "$(env_sha)" = "$ENV_BEFORE" ] || die ".env berubah setelah rilis"; ok ".env identik (sha ${ENV_BEFORE:0:12}…)"
[ "$(ctwa_env_count "$CID_NEW")" = "$CTWA_BEFORE" ] || die "jumlah variabel CTWA_* di container berubah ($(ctwa_env_count "$CID_NEW") != ${CTWA_BEFORE})"
[ "$(capture_count "$CID_NEW")" -ge "$CAPTURE_BEFORE" ] || die "entri capture CTWA berkurang"
ok "capture CTWA Fase 0 tidak tersentuh: CTWA_* = ${CTWA_BEFORE}, entri capture $(capture_count "$CID_NEW") (sebelum ${CAPTURE_BEFORE})"
rc=0; verify_live "$SWITCH_UTC" mati || rc=$?
trap - EXIT
[ "$rc" = "0" ] || { say "RILIS AKTIF TETAPI VERIFIKASI GAGAL (kode ${rc}) — ${DEPLOY_SHORT}. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}."; exit "$rc"; }
say "SELESAI — ${DEPLOY_SHORT} aktif dengan flag ${FLAG_NAME} MATI. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
say "TINDAK LANJUT OWNER: (1) impor pemetaan Ad ID dari Ads Manager (POST /api/atribusi/iklan/referensi, dryRun dulu); (2) menyalakan flag = ubah backend/.env + recreate backend (keputusan terpisah); (3) pantau GET /api/atribusi/iklan/kesehatan."
exit 0
