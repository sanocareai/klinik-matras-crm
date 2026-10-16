#!/usr/bin/env bash
# Rilis "ATRIBUSI META ADS FASE 3 — spend harian per Ad ID, KPI biaya (CPL/CPA/ROAS), target ADMIN, monitoring": backend + web + 1 migrasi ADITIF (5 tabel baru kosong)
# — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED. Sinkronisasi otomatis spend dan notifikasi WA TIDAK diaktifkan oleh skrip ini.
#
# YANG DILAKUKAN : backup + verifikasi restore; REHEARSAL migrasi pada DB hasil restore (struktur + uji perilaku constraint + sidik jari tabel lama dan tabel atribusi Fase 2);
#                  build web (dist baru; aset lama dibawa); migrasi aditif ke produksi; build image backend; backend di-recreate SATU kali; verifikasi baca-saja.
# YANG TIDAK     : TIDAK mengubah .env (hash dibandingkan sebelum/sesudah; flag capture touch TIDAK diubah, apa pun nilainya); TIDAK menyalakan SPEND_SYNC_ENABLED; TIDAK memasang cron;
#                  TIDAK menyentuh Meta Ads (tidak ada panggilan ke Meta); TIDAK mem-push/merge; TIDAK menghapus release/image/berkas; TIDAK pernah DROP/DELETE/UPDATE data produksi;
#                  TIDAK menulis spend/target/alarm (smoke impor = DRY-RUN; semua tabel baru tetap kosong).
# BERHENTI BILA  : baseline live berubah (SHA/image/release); mount /app/data tidak sesuai; disk bebas < 5 GiB; pg_dump/verifikasi restore gagal; ada berkas di luar allowlist;
#                  isi berkas runtime/migrasi berbeda dari pin sha256; pemindai DDL menolak; rehearsal gagal atau mengubah tabel lama/atribusi; SPEND_SYNC_ENABLED sudah true;
#                  migrasi pending selain milik rilis ini; .env berubah; touch berkurang; data pribadi/token muncul pada respons.
#
# Pemakaian (dari laptop; sumber: bundle git, TANPA push):
#   git bundle create /tmp/atri3.bundle <BASE_SHA>..<CAND_BRANCH> ; scp ke server
#   cat scripts/release-atribusi-spend.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/atri3.sh'
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/atri3.bundle bash /tmp/atri3.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'   # baca-saja
#   ssh ubuntu@43.133.152.6 'BUNDLE=/tmp/atri3.bundle bash /tmp/atri3.sh <DEPLOY_SHA_40> <BASE_SHA_40>'                    # rilis
#   ssh ubuntu@43.133.152.6 'bash /tmp/atri3.sh <DEPLOY_SHA_40> <BASE_SHA_40> --verify-only'                               # verifikasi ulang (baca-saja)
#   ssh ubuntu@43.133.152.6 'bash /tmp/atri3.sh <DEPLOY_SHA_40> <BASE_SHA_40> --rollback'                                  # kode kembali ke release/image sebelum rilis; tabel TIDAK dihapus
# Kode keluar: 0 selesai & terverifikasi | 1 berhenti (lihat instruksi rollback).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
MODE=release
for a in "$@"; do case "$a" in --preflight-only) MODE=preflight;; --verify-only) MODE=verify;; --rollback) MODE=rollback;; esac; done

MIN_FREE_KB=$((5 * 1024 * 1024))
CAND_BRANCH="${CAND_BRANCH:-feat/atribusi-fase3-spend}"
CAND_REF="refs/remotes/origin/cand-atri3"
BUNDLE="${BUNDLE:-}"
REPO_URL="https://github.com/sanocareai/klinik-matras-crm.git"
PUBLIC_URL="https://app.sanomatrassehat.com"
INTERNAL_URL="http://127.0.0.1:4000"
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
RELEASES="$HOME/releases/klinik-matras"; PERSIST="$HOME/klinik-matras"; SRC="$HOME/release-src/klinik-matras.git"
TAG_KODE="atri3"
FLAG_CAPTURE="ATRIBUSI_TOUCH_CAPTURE_ENABLED"
FLAG_SYNC="SPEND_SYNC_ENABLED"
TABEL_BARU="meta_spend_imports meta_ad_daily_spend meta_ad_spend_revisions attribution_kpi_targets attribution_alert_state"
TABEL_BARU_SQL="'meta_spend_imports','meta_ad_daily_spend','meta_ad_spend_revisions','attribution_kpi_targets','attribution_alert_state'"

MIGS="20261201090000_atribusi_spend_kpi:2f153d36603776732b01930df8976d9796991b835f5daff7329c9c500a22ebd3"
SCAN_EXPECT='{"total":12,"create_table":5,"create_index":5,"fk":2,"check":14}'
ALLOWED_RE='^(backend/prisma/migrations/20261201090000_atribusi_spend_kpi/migration\.sql|backend/prisma/schema\.prisma|backend/src/routes/(attributionAds|attributionSpend)\.js|backend/src/services/attribution/(biayaKpi|iklanReport|monitor|spend|spendSyncMeta)\.js|backend/scripts/(atribusi-monitor|sync-spend-meta)\.js|backend/tests/(atribusiSpendKpi|releaseAtribusiSpend|releaseAtribusiIklan)\.test\.js|backend/tests/integration/(atribusiIklan|releaseAtribusiSpend)\.integration\.test\.js|frontend/src/api\.js|frontend/src/features/laporan/(iklanCampaignLogic\.js|components/(IklanCampaignTab|IklanBiayaPanel)\.jsx)|frontend/tests/iklanCampaignLogic\.test\.js|docs/ATRIBUSI-SPEND-KPI-FASE3\.md|scripts/(release-atribusi-spend|atribusi-monitor-cron|release-iklan-tab-frontend)\.sh)$'
BACKEND_SRC_EXPECT="backend/src/routes/attributionAds.js backend/src/routes/attributionSpend.js backend/src/services/attribution/biayaKpi.js backend/src/services/attribution/iklanReport.js backend/src/services/attribution/monitor.js backend/src/services/attribution/spend.js backend/src/services/attribution/spendSyncMeta.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/laporan/components/IklanBiayaPanel.jsx frontend/src/features/laporan/components/IklanCampaignTab.jsx frontend/src/features/laporan/iklanCampaignLogic.js"
declare -A PINS=(
  ["backend/src/routes/attributionAds.js"]="bfb906bf35746ff3c368c06e34155c6b0af00d4f35436ac7a42b1e02c4ef7b0b"
  ["backend/src/routes/attributionSpend.js"]="f9439b0f82b885d559390f615ae440b0ae0b14f93bfd6002583166c88c818495"
  ["backend/src/services/attribution/biayaKpi.js"]="02fa8837eaae840774f9908a94df13d309e5fa39e5145105953f0a87096e40ae"
  ["backend/src/services/attribution/iklanReport.js"]="fb59ee657aa4fe08a3c2e289db2259f20c4d21bb940c8c39352c8f8820ccb9dd"
  ["backend/src/services/attribution/monitor.js"]="c2277f687a27e07dd26b2921189f54ce1df462291934bf9dbdf76fe25558727d"
  ["backend/src/services/attribution/spend.js"]="95d65d6f47a86d46e0795f18f9b3ef995b55f1f5939b889a9c8b9f4c75786b0e"
  ["backend/src/services/attribution/spendSyncMeta.js"]="f9998fb5d6457500f9cf95788cf818a908baba7e3a4f5e0ab4fef2f04d5548b2"
  ["backend/scripts/atribusi-monitor.js"]="d831d9957b6d61c6e80687d03d49c8d9f033e6527d77ff0c50f2838faa07d4a3"
  ["backend/scripts/sync-spend-meta.js"]="b10408694c71ba192f6b08a02d9f257ec2a1fa57464ae8458ba2a6c83462796d"
  ["backend/prisma/schema.prisma"]="ef587efcf4fc61caf030387176a25f881d4e378df59efb387c1bdaf079b57230"
)

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
die()  { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

gate_disk_kb()   { [[ "${1:-}" =~ ^[0-9]+$ ]] || return 2; [ "$1" -ge "$MIN_FREE_KB" ]; }
gate_mount_text(){ printf '%s\n' "$1" | grep -Fxq "bind|${2}|/app/data|true"; }
sha_lf()         { tr -d '\r' | sha256sum | cut -d' ' -f1; }
# Kunci/kata terlarang pada JSON respons: pengenal pribadi, clid mentah, token. 0 bila BERSIH.
respons_bersih() { ! printf '%s' "$1" | grep -Eq '"(phone|name|customerId|messageId|orderId|ctwaClid|leadSourceDetail|waId|jid|content|body|token|accessToken|access_token|secret|authorization)"[[:space:]]*:'; }
angka_ok()       { [[ "${1:-}" =~ ^[0-9]+$ ]]; }
# Nilai flag dari teks .env ($1): "true" persis (boleh dikutip) → 0.
flag_true_teks() { printf '%s\n' "$2" | grep -Eq "^${1}=[\"']?true[\"']?[[:space:]]*$"; }

[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || [ -n "${ATRI3_SCAN_SELFTEST_FILE:-}" ] || { echo "STOP: argumen 1 harus SHA kandidat 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || [ -n "${ATRI3_SCAN_SELFTEST_FILE:-}" ] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
DEPLOY_SHORT="${DEPLOY_SHA:0:8}"; BASE_SHORT="${BASE_SHA:0:8}"; NEW_DIR="$RELEASES/$DEPLOY_SHORT"
TS="$(date +%Y%m%d_%H%M%S)"; BK_DIR="$HOME/release-backups/${TAG_KODE}-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""; REH_DB=""
ROLLBACK_TAG="klinik-matras-backend:rollback-pre-${TAG_KODE}-${DEPLOY_SHORT}"

sg()   { git --git-dir="$SRC" "$@"; }
dcp()  { local d="$1"; shift; ( cd "$d" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
psql_live() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q "$@" </dev/null; }
avail_kb() { df -Pk "$HOME" | awk 'NR==2{print $4}'; }
disk_gate() { local a; a="$(avail_kb)"; gate_disk_kb "$a" || die "disk bebas $(( ${a:-0} / 1024 )) MiB < 5 GiB (${1}) — berhenti, tidak ada yang diubah setelah titik ini"; ok "disk bebas $(( a / 1024 )) MiB >= 5 GiB (${1})"; }
mounts_of() { docker inspect -f '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{"\n"}}{{end}}' "$1"; }
mount_gate() { gate_mount_text "$(mounts_of "$1")" "$PERSIST/backend/data" || die "mount /app/data ($2) BUKAN bind rw ke ${PERSIST}/backend/data — berhenti"; ok "mount /app/data ($2) = bind rw ${PERSIST}/backend/data"; }
drop_temp_dbs() { [ -n "$PREV_DIR" ] && [ -n "$REH_DB" ] && dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
backend_cid() { docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend"; }
env_sha() { sha256sum "$PERSIST/backend/.env" | cut -d' ' -f1; }
env_flag_text() { grep -E "^${1}=" "$PERSIST/backend/.env" 2>/dev/null || true; }
ctwa_env_count() { docker exec "$1" sh -c 'env | grep -c "^CTWA_" || true'; }
capture_count() { docker exec "$1" sh -c 'find /app/data -maxdepth 2 -name "ctwa-capture*" 2>/dev/null | wc -l'; }
container_env() { docker exec "$1" sh -c "printenv ${2} || true" | tr -d '\r\n'; }

rollback_instructions() {
  cat <<EOF

────────────  INSTRUKSI ROLLBACK (TIDAK dijalankan otomatis)  ────────────
Fase saat berhenti : ${PHASE}
Release sebelumnya : ${PREV_DIR:-<belum terbaca>} (TIDAK dihapus/ditimpa)
Image sebelumnya   : ${ROLLBACK_TAG}
Backup + checksum  : ${BACKUP_FILE:-<belum dibuat>}
Berhenti SEBELUM 'Switch' -> backend lama tidak pernah dimatikan; produksi tetap di release sebelumnya.
  Bila berhenti SESUDAH migrasi: 5 tabel baru (kosong) dibiarkan; kode lama mengabaikannya. TIDAK ada DROP.
Setelah switch bermasalah (satu perintah, bergerbang):
   bash /tmp/atri3.sh ${DEPLOY_SHA} ${BASE_SHA} --rollback
Rollback = KODE saja (web + backend). Tabel spend/target/alarm dan tabel atribusi Fase 2 (touch, referensi) TIDAK dihapus. Spend yang sudah diimpor tetap tersimpan.
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum).
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; drop_temp_dbs; [ $rc -ne 0 ] && [ "$MODE" = "release" ] && rollback_instructions; exit $rc' EXIT

# Smoke di DALAM container: token ADMIN/SALES dibuat di memori (rahasia JWT tidak keluar dari container, token tidak dicetak). BACA-SAJA (impor = DRY-RUN).
read -r -d '' SMOKE_JS <<'JS' || true
const jwt = require("jsonwebtoken"); const http = require("http"); const { PrismaClient } = require("@prisma/client");
const port = Number(process.env.PORT || 4000);
const req = (method, path, token, body) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : null;
  const r = http.request({ host: "127.0.0.1", port, path, method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) } }, (x) => {
    let b = ""; x.on("data", (c) => (b += c)); x.on("end", () => res({ status: x.statusCode, headers: x.headers, body: b }));
  });
  r.on("error", rej); r.setTimeout(60000, () => r.destroy(new Error("timeout"))); if (data) r.write(data); r.end();
});
const TERLARANG = /"(phone|name|customerId|messageId|orderId|ctwaClid|leadSourceDetail|waId|jid|content|body|token|accessToken|access_token|secret|authorization)"\s*:/;
(async () => {
  const prisma = new PrismaClient();
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true } });
  const jumlah = async () => ({ spend: await prisma.metaAdDailySpend.count(), impor: await prisma.metaSpendImport.count(), rev: await prisma.metaAdSpendRevision.count(), target: await prisma.attributionKpiTarget.count(), alarm: await prisma.attributionAlertState.count() });
  const sebelum = await jumlah();
  if (!admin) { console.log("ERROR=tidak ada user ADMIN aktif"); process.exit(2); }
  const sign = (id, roles) => jwt.sign({ id, name: "smoke", role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: 600 });
  const tA = sign(admin.id, ["ADMIN"]), tS = sign("00000000-0000-0000-0000-000000000000", ["SALES"]);
  const wib = (ms) => new Date(Date.now() + 7 * 3600e3 + ms).toISOString().slice(0, 10);
  const base = "/api/atribusi/iklan";
  for (const [nama, m, p] of [["SPEND", "GET", "/spend"], ["SPEND_POST", "POST", "/spend"], ["TARGET", "GET", "/target"], ["TARGET_PUT", "PUT", "/target"], ["MONITOR", "GET", "/monitor"]]) {
    console.log(`NOAUTH_${nama}=` + (await req(m, base + p, null, m === "GET" ? null : {})).status);
    console.log(`SALES_${nama}=` + (await req(m, base + p, tS, m === "GET" ? null : {})).status);
  }
  const sp = await req("GET", `${base}/spend?dari=${wib(-6 * 86400e3)}&sampai=${wib(0)}`, tA);
  console.log("SPEND_STATUS=" + sp.status); if (sp.status === 200) { const j = JSON.parse(sp.body); console.log("SPEND_HARI=" + j.harian.length); console.log("SPEND_TOTAL=" + j.totalSpend); }
  console.log("SPEND_RANGE_SALAH=" + (await req("GET", `${base}/spend?dari=2026-01-01&sampai=2026-12-31`, tA)).status);
  // impor DRY-RUN: contoh sah (akun fiktif; tidak ditulis) dan contoh buruk (harus ditolak per baris)
  const csv = ["Day,Account ID,Campaign ID,Ad set ID,Ad ID,Amount spent (IDR)", `${wib(-1 * 86400e3)},9999999999,52694481763084,52694481763284,52694481763484,1000`, `${wib(-1 * 86400e3)},9999999999,52694481763084,52694481763284,5.2E+13,1000`, `${wib(-1 * 86400e3)},9999999999,52694481763084,52694481763284,52694485574084,-5`].join("\n");
  const dr = await req("POST", `${base}/spend`, tA, { csv, accountId: "9999999999", totalSumber: "1000" });
  console.log("IMPOR_DRY_STATUS=" + dr.status);
  if (dr.status === 200) { const j = JSON.parse(dr.body); console.log("IMPOR_DRY_FLAG=" + j.dryRun); console.log("IMPOR_DRY_BARU=" + j.ringkasan.baru); console.log("IMPOR_DRY_DITOLAK=" + j.ringkasan.ditolak); console.log("IMPOR_DRY_COCOK=" + j.rekonsiliasi.cocok); }
  const commitTanpaZona = await req("POST", `${base}/spend`, tA, { csv, accountId: "9999999999", dryRun: false });
  console.log("IMPOR_KOMIT_TANPA_ZONA=" + commitTanpaZona.status);
  const tg = await req("GET", `${base}/target`, tA);
  console.log("TARGET_STATUS=" + tg.status); if (tg.status === 200) { const j = JSON.parse(tg.body); console.log("TARGET_SEMUA_NULL=" + Object.values(j.target).every((v) => v === null)); }
  console.log("TARGET_PUT_BURUK=" + (await req("PUT", `${base}/target`, tA, { matikanIklan: true })).status);
  const mo = await req("GET", `${base}/monitor`, tA);
  console.log("MONITOR_STATUS=" + mo.status);
  if (mo.status === 200) { const j = JSON.parse(mo.body); console.log("MONITOR_ALARM_N=" + j.alarm.length); console.log("MONITOR_KUNCI=" + ["waha", "inbound", "touch", "capture", "referensi", "spend"].every((k) => k in j.snapshot)); console.log("MONITOR_TOKEN=" + (TERLARANG.exec(mo.body) ? "TERLARANG" : "none")); console.log("MONITOR_STATUS_GABUNGAN=" + j.status); console.log("MONITOR_WAHA=" + j.alarm.filter((a) => a.key === "waha_session").map((a) => a.level).join("")); console.log("MONITOR_DUPLIKAT=" + j.snapshot.touch.duplikat); }
  const r = await req("GET", `${base}?dari=${wib(-6 * 86400e3)}&sampai=${wib(0)}&level=campaign`, tA);
  console.log("LAPORAN_STATUS=" + r.status);
  if (r.status !== 200) { console.log("ERROR=laporan " + r.status); process.exit(3); }
  const j = JSON.parse(r.body);
  console.log("REKON_OK=" + j.rekonsiliasi.ok); console.log("REKON_CEK=" + j.rekonsiliasi.cek.length); console.log("REKON_GAGAL=" + j.rekonsiliasi.cek.filter((c) => !c.ok).map((c) => c.id).join(","));
  console.log("BIAYA_STATUS=" + j.biaya.status); console.log("BIAYA_NULL=" + (j.biaya.spend === null && j.biaya.cpl === null && j.biaya.cpa === null && j.biaya.roas === null && j.biaya.bookedRoas === null && j.biaya.cashRoas === null));
  console.log("BIAYA_GRUP_NULL=" + j.grup.every((g) => g.biaya && g.biaya.spend === null && g.biaya.cpl === null && g.biaya.cpa === null && g.biaya.evaluasi.status === null));
  console.log("SINYAL=" + j.atribusi.sinyalDipakai.join(",")); console.log("LEAD_UNIK=" + j.jumlahTeratribusi.leadUnik); console.log("CLOSING_UTAMA=" + j.jumlahTeratribusi.closingUtama.customerLunasTerbuktiLedger);
  console.log("PERINGATAN=" + j.peringatan.map((w) => w.kode).join(","));
  console.log("CACHE=" + (r.headers["cache-control"] || ""));
  const gabung = r.body + sp.body + dr.body + tg.body;
  console.log("FORBIDDEN=" + (TERLARANG.exec(gabung) ? TERLARANG.exec(gabung)[1] : "none"));
  const sesudah = await jumlah();
  console.log("TABEL_BARU_BERUBAH=" + (JSON.stringify(sebelum) !== JSON.stringify(sesudah)));
  console.log("TABEL_BARU_JUMLAH=" + JSON.stringify(sesudah));
  await prisma.$disconnect();
})().catch((e) => { console.log("ERROR=" + String(e.message).slice(0, 120)); process.exit(4); });
JS

# Pemindai migrasi (VPS dan lokal). FAIL-CLOSED, daftar putih per pernyataan. Kolom divalidasi per bentuk + nama terlarang; isi persis dijaga pin sha256 migrasi.
read -r -d '' SCAN_JS <<'SCANJS' || true
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };
const hitung = {};
const tambah = (k, n = 1) => { hitung[k] = (hitung[k] ?? 0) + n; };
const TABEL = {
  meta_spend_imports: { pk: "id", cons: ["meta_spend_imports_pkey", "meta_spend_imports_source_check", "meta_spend_imports_account_check", "meta_spend_imports_counts_check", "meta_spend_imports_spend_check"] },
  meta_ad_daily_spend: { pk: "id", cons: ["meta_ad_daily_spend_pkey", "meta_ad_daily_spend_ids_check", "meta_ad_daily_spend_hierarchy_check", "meta_ad_daily_spend_currency_check", "meta_ad_daily_spend_spend_check", "meta_ad_daily_spend_metrics_check", "meta_ad_daily_spend_source_check", "meta_ad_daily_spend_revision_check"] },
  meta_ad_spend_revisions: { pk: "id", cons: ["meta_ad_spend_revisions_pkey"] },
  attribution_kpi_targets: { pk: "id", cons: ["attribution_kpi_targets_pkey", "attribution_kpi_targets_singleton_check", "attribution_kpi_targets_nonneg_check"] },
  attribution_alert_state: { pk: "key", cons: ["attribution_alert_state_pkey", "attribution_alert_state_status_check"] },
};
const INDEKS = new Map([
  ["meta_ad_daily_spend_key", ["meta_ad_daily_spend", "date_wib,account_id,ad_id,source", true]],
  ["meta_ad_daily_spend_date_wib_idx", ["meta_ad_daily_spend", "date_wib", false]],
  ["meta_ad_daily_spend_ad_id_date_wib_idx", ["meta_ad_daily_spend", "ad_id,date_wib", false]],
  ["meta_ad_daily_spend_campaign_id_date_wib_idx", ["meta_ad_daily_spend", "campaign_id,date_wib", false]],
  ["meta_ad_spend_revisions_spend_id_idx", ["meta_ad_spend_revisions", "spend_id", false]],
]);
const FK = new Set(["meta_ad_daily_spend.import_id>meta_spend_imports:RESTRICT", "meta_ad_spend_revisions.spend_id>meta_ad_daily_spend:RESTRICT"]);
const KOLOM_OK = /^"([a-z0-9_]+)" (UUID|TEXT|SMALLINT|INTEGER|BIGINT|DATE|TIMESTAMP\(3\)|VARCHAR\(\d{1,3}\)|DECIMAL\(\d{1,2},\d\))( NOT NULL)?( DEFAULT (CURRENT_TIMESTAMP|false|1))?$/;
const NAMA_TERLARANG = /(^|_)(phone|nomor|payload|token|secret|raw|chat|jid|customer_id|customer_name|message_id|message_text|clid|body|password)(_|$)|^content$/i;
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
      const k = KOLOM_OK.exec(it);
      if (!k) gagal(`kolom bukan bentuk yang diizinkan pada ${m[1]}: ${it.slice(0, 80)}`);
      if (NAMA_TERLARANG.test(k[1])) gagal(`nama kolom terlarang pada ${m[1]}: ${k[1]}`);
      kolom.push(k[1]);
    }
    if (new Set(kolom).size !== kolom.length) gagal(`kolom ganda pada ${m[1]}`);
    if (JSON.stringify([...cons].sort()) !== JSON.stringify([...def.cons].sort())) gagal(`constraint tabel ${m[1]} bukan yang diaudit: ${cons.join(",")}`);
    tambah("check", cons.filter((n) => n.endsWith("_check")).length);
    tambah("create_table"); continue;
  }
  if ((m = /^CREATE (UNIQUE )?INDEX "([a-z_]+)" ON "([a-z_]+)"\(((?:"[a-z_]+")(?:, "[a-z_]+")*)\)$/.exec(r))) {
    const def = INDEKS.get(m[2]);
    const cols = m[4].replace(/"/g, "").replace(/, /g, ",");
    if (!def || def[0] !== m[3] || def[1] !== cols) gagal(`indeks di luar daftar putih: ${m[2]} pada ${m[3]}(${cols})`);
    if (!!m[1] !== def[2]) gagal(`jenis UNIQUE indeks ${m[2]} salah`);
    unik("indeks", m[2]); tambah("create_index"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+_fkey)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "([A-Za-z_]+)"\("id"\) ON DELETE (RESTRICT) ON UPDATE CASCADE$/.exec(r))) {
    const k = `${m[1]}.${m[3]}>${m[4]}:${m[5]}`;
    if (!FK.has(k)) gagal(`FK di luar daftar putih: ${k}`);
    unik("fk", k); tambah("fk"); continue;
  }
  gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
}
if ((hitung.create_table ?? 0) !== Object.keys(TABEL).length) gagal("tabel baru harus tepat 5");
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
  harus_ditolak "DROP tabel lama" "$(tambah_stmt 'DROP TABLE "Customer";')"
  harus_ditolak "DROP tabel atribusi Fase 2" "$(tambah_stmt 'DROP TABLE "attribution_touches";')"
  harus_ditolak "DROP tabel baru" "$(tambah_stmt 'DROP TABLE "meta_ad_daily_spend";')"
  harus_ditolak "UPDATE tabel lama" "$(tambah_stmt "UPDATE \"Customer\" SET \"leadSource\" = 'META_ADS';")"
  harus_ditolak "DELETE touch" "$(tambah_stmt 'DELETE FROM "attribution_touches";')"
  harus_ditolak "INSERT seed spend" "$(tambah_stmt "INSERT INTO \"meta_ad_daily_spend\" (\"id\") VALUES (gen_random_uuid());")"
  harus_ditolak "INSERT seed target" "$(tambah_stmt "INSERT INTO \"attribution_kpi_targets\" (\"id\", \"max_cpl\") VALUES (1, 200000);")"
  harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "Message";')"
  harus_ditolak "ALTER tabel lama (kolom baru)" "$(tambah_stmt 'ALTER TABLE "Customer" ADD COLUMN "spend" TEXT;')"
  harus_ditolak "ALTER tabel atribusi Fase 2" "$(tambah_stmt 'ALTER TABLE "attribution_touches" ADD COLUMN "spend" TEXT;')"
  harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "Customer" DROP COLUMN "ctwa_clid";')"
  harus_ditolak "RENAME" "$(tambah_stmt 'ALTER TABLE "Customer" RENAME COLUMN "phone" TO "telp";')"
  harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "Customer"("createdAt");')"
  harus_ditolak "tabel baru keenam" "$(tambah_stmt 'CREATE TABLE "spend_extra" ("id" UUID NOT NULL, CONSTRAINT "spend_extra_pkey" PRIMARY KEY ("id"));')"
  harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "meta_ad_daily_spend" TO PUBLIC;')"
  harus_ditolak "fungsi/trigger liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
  harus_ditolak "trigger dimatikan" "$(tambah_stmt 'ALTER TABLE "meta_ad_daily_spend" DISABLE TRIGGER ALL;')"
  harus_ditolak "kolom token ditambahkan" "$(printf '%s\n' "$ALL_SQL" | sed '0,/    "link_clicks" BIGINT,/s//    "link_clicks" BIGINT,\n    "access_token" TEXT,/')"
  harus_ditolak "kolom respons mentah ditambahkan" "$(printf '%s\n' "$ALL_SQL" | sed '0,/    "link_clicks" BIGINT,/s//    "link_clicks" BIGINT,\n    "raw_response" TEXT,/')"
  harus_ditolak "kolom nomor telepon ditambahkan" "$(printf '%s\n' "$ALL_SQL" | sed '0,/    "link_clicks" BIGINT,/s//    "link_clicks" BIGINT,\n    "phone" TEXT,/')"
  harus_ditolak "kolom customer ditambahkan" "$(printf '%s\n' "$ALL_SQL" | sed '0,/    "link_clicks" BIGINT,/s//    "link_clicks" BIGINT,\n    "customer_id" TEXT,/')"
  harus_ditolak "tipe kolom JSONB" "$(printf '%s\n' "$ALL_SQL" | sed '0,/    "link_clicks" BIGINT,/s//    "link_clicks" JSONB,/')"
  harus_ditolak "CHECK IDR dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'meta_ad_daily_spend_currency_check')"
  harus_ditolak "CHECK spend >= 0 dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'meta_ad_daily_spend_spend_check')"
  harus_ditolak "nama CHECK diganti" "$(printf '%s\n' "$ALL_SQL" | sed 's/"meta_ad_daily_spend_source_check"/"meta_ad_daily_spend_evil_check"/')"
  harus_ditolak "CHECK memuat subquery" "$(printf '%s\n' "$ALL_SQL" | sed "s/CHECK (\"currency\" = 'IDR')/CHECK ((SELECT count(*) FROM \"Customer\") >= 0)/")"
  harus_ditolak "FK jadi CASCADE" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "meta_spend_imports"("id") ON DELETE RESTRICT/REFERENCES "meta_spend_imports"("id") ON DELETE CASCADE/')"
  harus_ditolak "FK ke tabel lain" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "meta_spend_imports"("id")/REFERENCES "Customer"("id")/')"
  harus_ditolak "FK baru dari tabel lama" "$(tambah_stmt 'ALTER TABLE "Customer" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("id") REFERENCES "meta_ad_daily_spend"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
  harus_ditolak "indeks UNIQUE dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'meta_ad_daily_spend_key')"
  harus_ditolak "indeks unik bukan UNIQUE" "$(printf '%s\n' "$ALL_SQL" | sed 's/CREATE UNIQUE INDEX "meta_ad_daily_spend_key"/CREATE INDEX "meta_ad_daily_spend_key"/')"
  harus_ditolak "kolom indeks unik diubah (tanpa source)" "$(printf '%s\n' "$ALL_SQL" | sed 's/("date_wib", "account_id", "ad_id", "source")/("date_wib", "account_id", "ad_id")/')"
  harus_ditolak "indeks tambahan" "$(tambah_stmt 'CREATE INDEX "meta_ad_daily_spend_extra_idx" ON "meta_ad_daily_spend"("created_at");')"
  harus_ditolak "singleton target dibuang" "$(printf '%s\n' "$ALL_SQL" | grep -v 'attribution_kpi_targets_singleton_check')"
  harus_ditolak "default liar" "$(printf '%s\n' "$ALL_SQL" | sed 's/DEFAULT CURRENT_TIMESTAMP/DEFAULT now()/')"
  [ "$NEG" -ge 30 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 30)"
  ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/pengosongan tabel/ALTER tabel lama & Fase 2/kolom token-PII-respons mentah/tipe/CHECK/FK/indeks/trigger/fungsi/GRANT) SEMUANYA ditolak"
}

# Mode uji mandiri pemindai (tanpa produksi): ATRI3_SCAN_SELFTEST_FILE=<migration.sql> -> pemindai harus menerima berkas dan menolak SEMUA mutan.
if [ -n "${ATRI3_SCAN_SELFTEST_FILE:-}" ]; then
  BK_DIR="$(mktemp -d)"; SCAN="$BK_DIR/scan-migrasi.mjs"; printf '%s\n' "$SCAN_JS" > "$SCAN"
  ALL_SQL="$(tr -d '\r' < "$ATRI3_SCAN_SELFTEST_FILE")"
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
  imp uuid := gen_random_uuid(); sp uuid := gen_random_uuid(); tolak int := 0; lolos int := 0;
BEGIN
  INSERT INTO meta_spend_imports (id, source, account_id, content_sha256, rows_total, rows_accepted, rows_rejected, rows_new, rows_updated, rows_unchanged, spend_total) VALUES (imp, 'ADS_MANAGER_CSV', '1234567890123', 'x', 1, 1, 0, 1, 0, 0, 1000); lolos := lolos + 1;
  BEGIN INSERT INTO meta_spend_imports (id, source, account_id, content_sha256, rows_total, rows_accepted, rows_rejected, rows_new, rows_updated, rows_unchanged, spend_total) VALUES (gen_random_uuid(), 'LIAR', '1234567890123', 'x', 1, 1, 0, 1, 0, 0, 1); RAISE EXCEPTION 'TIDAK_DITOLAK_sumber_impor';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_spend_imports (id, source, account_id, content_sha256, rows_total, rows_accepted, rows_rejected, rows_new, rows_updated, rows_unchanged, spend_total) VALUES (gen_random_uuid(), 'ADS_MANAGER_CSV', 'act_1', 'x', 1, 1, 0, 1, 0, 0, 1); RAISE EXCEPTION 'TIDAK_DITOLAK_akun_impor';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_spend_imports (id, source, account_id, content_sha256, rows_total, rows_accepted, rows_rejected, rows_new, rows_updated, rows_unchanged, spend_total) VALUES (gen_random_uuid(), 'ADS_MANAGER_CSV', '1234567890123', 'x', -1, 1, 0, 1, 0, 0, 1); RAISE EXCEPTION 'TIDAK_DITOLAK_hitungan_negatif';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_spend_imports (id, source, account_id, content_sha256, rows_total, rows_accepted, rows_rejected, rows_new, rows_updated, rows_unchanged, spend_total) VALUES (gen_random_uuid(), 'ADS_MANAGER_CSV', '1234567890123', 'x', 1, 1, 0, 1, 0, 0, -1); RAISE EXCEPTION 'TIDAK_DITOLAK_spend_total_negatif';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO meta_ad_daily_spend (id, date_wib, account_id, campaign_id, ad_set_id, ad_id, currency, spend, source, imported_at, import_id, row_checksum, updated_at) VALUES (sp, '2026-10-16', '1234567890123', '52694481763084', '52694481763284', '52694481763484', 'IDR', 150000.50, 'ADS_MANAGER_CSV', now(), imp, 'c', now()); lolos := lolos + 1;
  BEGIN INSERT INTO meta_ad_daily_spend (id, date_wib, account_id, campaign_id, ad_set_id, ad_id, currency, spend, source, imported_at, import_id, row_checksum, updated_at) VALUES (gen_random_uuid(), '2026-10-16', '1234567890123', '52694481763084', '52694481763284', '52694481763484', 'IDR', 1, 'ADS_MANAGER_CSV', now(), imp, 'c', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_unik_hari_akun_ad_sumber';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  INSERT INTO meta_ad_daily_spend (id, date_wib, account_id, campaign_id, ad_set_id, ad_id, currency, spend, source, imported_at, import_id, row_checksum, updated_at) VALUES (gen_random_uuid(), '2026-10-16', '1234567890123', '52694481763084', '52694481763284', '52694481763484', 'IDR', 1, 'WINDSOR_API', now(), imp, 'c', now()); lolos := lolos + 1;
  BEGIN INSERT INTO meta_ad_daily_spend (id, date_wib, account_id, campaign_id, ad_set_id, ad_id, currency, spend, source, imported_at, import_id, row_checksum, updated_at) VALUES (gen_random_uuid(), '2026-10-17', '1234567890123', '52694481763084', '52694481763284', '5.2E+13', 'IDR', 1, 'ADS_MANAGER_CSV', now(), imp, 'c', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_notasi_ilmiah';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_ad_daily_spend (id, date_wib, account_id, campaign_id, ad_set_id, ad_id, currency, spend, source, imported_at, import_id, row_checksum, updated_at) VALUES (gen_random_uuid(), '2026-10-17', '1234567890123', '52694481763084', '52694481763284', '52694481763484', 'USD', 1, 'ADS_MANAGER_CSV', now(), imp, 'c', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_mata_uang';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_ad_daily_spend (id, date_wib, account_id, campaign_id, ad_set_id, ad_id, currency, spend, source, imported_at, import_id, row_checksum, updated_at) VALUES (gen_random_uuid(), '2026-10-17', '1234567890123', '52694481763084', '52694481763284', '52694481763484', 'IDR', -1, 'ADS_MANAGER_CSV', now(), imp, 'c', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_spend_negatif';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_ad_daily_spend (id, date_wib, account_id, campaign_id, ad_set_id, ad_id, currency, spend, source, imported_at, import_id, row_checksum, updated_at) VALUES (gen_random_uuid(), '2026-10-17', '1234567890123', '52694481763084', '52694481763484', '52694481763484', 'IDR', 1, 'ADS_MANAGER_CSV', now(), imp, 'c', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_hierarki';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_ad_daily_spend (id, date_wib, account_id, campaign_id, ad_set_id, ad_id, currency, spend, source, imported_at, import_id, row_checksum, updated_at) VALUES (gen_random_uuid(), '2026-10-17', '1234567890123', '52694481763084', '52694481763284', '52694481763484', 'IDR', 1, 'TEBAKAN', now(), imp, 'c', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_sumber_spend';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_ad_daily_spend (id, date_wib, account_id, campaign_id, ad_set_id, ad_id, currency, spend, impressions, source, imported_at, import_id, row_checksum, updated_at) VALUES (gen_random_uuid(), '2026-10-17', '1234567890123', '52694481763084', '52694481763284', '52694481763484', 'IDR', 1, -5, 'ADS_MANAGER_CSV', now(), imp, 'c', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_impresi_negatif';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO meta_ad_daily_spend (id, date_wib, account_id, campaign_id, ad_set_id, ad_id, currency, spend, source, imported_at, import_id, row_checksum, updated_at) VALUES (gen_random_uuid(), '2026-10-17', '1234567890123', '52694481763084', '52694481763284', '52694481763484', 'IDR', 1, 'ADS_MANAGER_CSV', now(), gen_random_uuid(), 'c', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_fk_impor';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  INSERT INTO meta_ad_spend_revisions (id, spend_id, revision, prev_spend, prev_checksum, prev_import_id, prev_imported_at, new_import_id) VALUES (gen_random_uuid(), sp, 1, 100, 'c', imp, now(), imp); lolos := lolos + 1;
  BEGIN INSERT INTO meta_ad_spend_revisions (id, spend_id, revision, prev_spend, prev_checksum, prev_import_id, prev_imported_at, new_import_id) VALUES (gen_random_uuid(), gen_random_uuid(), 1, 100, 'c', imp, now(), imp); RAISE EXCEPTION 'TIDAK_DITOLAK_fk_revisi';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM meta_spend_imports WHERE id = imp; RAISE EXCEPTION 'TIDAK_DITOLAK_hapus_impor_bertaut';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  INSERT INTO attribution_kpi_targets (id) VALUES (1); lolos := lolos + 1;
  BEGIN INSERT INTO attribution_kpi_targets (id) VALUES (2); RAISE EXCEPTION 'TIDAK_DITOLAK_target_singleton';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE attribution_kpi_targets SET max_cpl = -1 WHERE id = 1; RAISE EXCEPTION 'TIDAK_DITOLAK_target_negatif';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE attribution_kpi_targets SET max_spam_share_percent = 101 WHERE id = 1; RAISE EXCEPTION 'TIDAK_DITOLAK_spam_lebih_100';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO attribution_alert_state (key, status, since, updated_at) VALUES ('uji', 'OK', now(), now()); lolos := lolos + 1;
  BEGIN INSERT INTO attribution_alert_state (key, status, since, updated_at) VALUES ('uji2', 'MERAH', now(), now()); RAISE EXCEPTION 'TIDAK_DITOLAK_status_alarm';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL

# Verifikasi pasca-rilis BACA-SAJA (fase 8 dan --verify-only). $1 = batas waktu log (UTC ISO).
verify_live() {
  local since_utc="$1" cid dir out
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
    case "$f" in backend/prisma/*) continue;; esac
    have="$(docker exec "$cid" sh -c "cat /app/${f#backend/}" | sha_lf)"
    [ "$have" = "${PINS[$f]}" ] || die "isi ${f} di container BERBEDA dari pin (${have:0:12} != ${PINS[$f]:0:12})"
  done; ok "berkas runtime di container = pin sha256"
  local logs errn
  logs="$(docker logs --since "$since_utc" "$cid" 2>&1 || true)"
  errn="$(printf '%s\n' "$logs" | grep -cE 'unhandledRejection|ReferenceError|SyntaxError|Cannot find module|TypeError|atribusi/iklan[a-z/-]* error|Gagal proses webhook WAHA' || true)"
  [ "$errn" = "0" ] || { printf '%s\n' "$logs" | grep -E 'unhandledRejection|ReferenceError|SyntaxError|Cannot find module|TypeError|atribusi/iklan[a-z/-]* error|Gagal proses webhook WAHA' | cut -c1-160 | head -5 | sed 's/^/        /'; die "${errn} baris galat runtime/webhook sejak switch"; }
  ok "log sejak ${since_utc}: 0 galat runtime, 0 'Gagal proses webhook WAHA'"
  printf '%s\n' "$logs" | grep -Eq 'META_ADS_ACCESS_TOKEN|access_token=|Bearer [A-Za-z0-9]' && die "log memuat token/Bearer — berhenti"
  ok "log: tidak ada token/Bearer"
  [ "$(container_env "$cid" "$FLAG_SYNC")" != "true" ] && ! flag_true_teks "$FLAG_SYNC" "$(env_flag_text "$FLAG_SYNC")" || die "${FLAG_SYNC}=true — sinkronisasi otomatis TIDAK boleh menyala pada rilis ini"
  ok "${FLAG_SYNC} tidak menyala (sinkronisasi otomatis OFF)"
  [ "$(container_env "$cid" "$FLAG_CAPTURE")" = "$CAPTURE_FLAG_BEFORE" ] || die "nilai ${FLAG_CAPTURE} di container berubah (sebelum='${CAPTURE_FLAG_BEFORE}')"
  ok "${FLAG_CAPTURE} tidak berubah (container='${CAPTURE_FLAG_BEFORE:-<kosong>}')"
  local inbound
  inbound="$(PREV_DIR="$dir" psql_live -At -c "select count(*) from \"Message\" where direction::text='INBOUND' and \"createdAt\" >= '${since_utc}'::timestamptz")"
  angka_ok "$inbound" || die "hitungan Message inbound tidak valid: '${inbound}'"
  [ "$inbound" -gt 0 ] && ok "inbox hidup: ${inbound} pesan inbound tersimpan sejak ${since_utc}" || warn "belum ada pesan INBOUND baru sejak ${since_utc} (sepi/sesi WAHA?) — ulangi dengan --verify-only"
  out="$(printf '%s' "$SMOKE_JS" | docker exec -i "$cid" node - 2>&1)" || { printf '%s\n' "$out" | cut -c1-200 | head -5 | sed 's/^/        /'; die "smoke endpoint gagal"; }
  val() { printf '%s\n' "$out" | sed -n "s/^$1=//p" | head -1; }
  local n
  for n in SPEND SPEND_POST TARGET TARGET_PUT MONITOR; do
    [ "$(val NOAUTH_$n)" = "401" ] || die "tanpa token ($n) harus 401 (dapat $(val NOAUTH_$n))"
    [ "$(val SALES_$n)" = "403" ] || die "token SALES ($n) harus 403 (dapat $(val SALES_$n))"
  done
  ok "RBAC /spend /target /monitor: tanpa token 401, SALES 403"
  [ "$(val SPEND_STATUS)" = "200" ] && [ "$(val SPEND_RANGE_SALAH)" = "400" ] || die "/spend: ADMIN harus 200 dan rentang >93 hari 400"
  [ "$(val IMPOR_DRY_STATUS)" = "200" ] && [ "$(val IMPOR_DRY_FLAG)" = "true" ] && [ "$(val IMPOR_DRY_BARU)" = "1" ] && [ "$(val IMPOR_DRY_DITOLAK)" = "2" ] && [ "$(val IMPOR_DRY_COCOK)" = "true" ] || die "impor DRY-RUN tidak sesuai (baru=$(val IMPOR_DRY_BARU) ditolak=$(val IMPOR_DRY_DITOLAK) cocok=$(val IMPOR_DRY_COCOK))"
  [ "$(val IMPOR_KOMIT_TANPA_ZONA)" = "400" ] || die "commit tanpa zonaWaktuAkun harus 400 (dapat $(val IMPOR_KOMIT_TANPA_ZONA))"
  ok "impor spend: dry-run 1 baris sah + 2 ditolak (notasi ilmiah, negatif), total cocok; commit tanpa zona WIB 400"
  [ "$(val TARGET_STATUS)" = "200" ] && [ "$(val TARGET_SEMUA_NULL)" = "true" ] && [ "$(val TARGET_PUT_BURUK)" = "400" ] || die "/target: default harus semua null dan kunci asing 400"
  ok "target KPI: default semua null; kunci asing ditolak"
  [ "$(val MONITOR_STATUS)" = "200" ] && [ "$(val MONITOR_KUNCI)" = "true" ] && [ "$(val MONITOR_TOKEN)" = "none" ] || die "/monitor tidak sesuai"
  ok "monitoring: ADMIN 200, $(val MONITOR_ALARM_N) kondisi, status gabungan $(val MONITOR_STATUS_GABUNGAN), WAHA=$(val MONITOR_WAHA), duplikat touch=$(val MONITOR_DUPLIKAT)"
  [ "$(val MONITOR_DUPLIKAT)" = "0" ] || die "ada touch ganda"
  [ "$(val LAPORAN_STATUS)" = "200" ] && [ "$(val CACHE)" = "no-store" ] || die "laporan ADMIN harus 200 dan no-store"
  [ "$(val REKON_OK)" = "true" ] || die "rekonsiliasi internal GAGAL: $(val REKON_GAGAL)"; ok "rekonsiliasi internal OK ($(val REKON_CEK) pemeriksaan)"
  [ "$(val BIAYA_STATUS)" = "BELUM_TERHUBUNG" ] && [ "$(val BIAYA_NULL)" = "true" ] && [ "$(val BIAYA_GRUP_NULL)" = "true" ] || die "tanpa spend: biaya harus BELUM_TERHUBUNG dan semua null (status=$(val BIAYA_STATUS))"
  ok "tanpa spend tersimpan: BELUM_TERHUBUNG; spend/CPL/CPA/ROAS null (tanpa nol palsu)"
  [ "$(val SINYAL)" = "CTWA_AD" ] || die "atribusi utama harus hanya CTWA_AD"
  [ "$(val FORBIDDEN)" = "none" ] || die "respons memuat kunci terlarang ($(val FORBIDDEN))"
  ok "respons: 0 nomor/nama/customerId/messageId/orderId/clid mentah/token"
  [ "$(val TABEL_BARU_BERUBAH)" = "false" ] || die "smoke mengubah tabel baru: $(val TABEL_BARU_JUMLAH)"
  ok "smoke tidak menulis apa pun ke tabel baru ($(val TABEL_BARU_JUMLAH))"
  local tch
  tch="$(psql_live -At -c "select count(*) from attribution_touches")"; angka_ok "$tch" || die "hitungan touch tidak valid"
  [ "$tch" -ge "${TOUCH_BEFORE:-0}" ] || die "touch BERKURANG (${tch} < ${TOUCH_BEFORE})"
  ok "laporan: lead teratribusi=$(val LEAD_UNIK), closing utama=$(val CLOSING_UTAMA); touch tersimpan=${tch} (sebelum ${TOUCH_BEFORE:-?}); peringatan: $(val PERINGATAN)"
  return 0
}

if [ "$MODE" = "verify" ]; then
  say "VERIFY-ONLY (baca-saja) rilis ${DEPLOY_SHORT}"
  PREV_DIR="$RELEASES/$DEPLOY_SHORT"; [ -d "$PREV_DIR" ] || die "release dir ${PREV_DIR} tidak ada"
  CAPTURE_FLAG_BEFORE="$(container_env "$(backend_cid)" "$FLAG_CAPTURE")"; TOUCH_BEFORE=0
  rc=0; verify_live "${VERIFY_SINCE_UTC:-$(date -u -d '-30 minutes' +%Y-%m-%dT%H:%M:%SZ)}" || rc=$?
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
  for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; [ "$lf" = "/tmp/release-atribusi-spend.lock" ] && continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf})"; done
  exec 9>/tmp/release-atribusi-spend.lock; flock -n 9 || die "rilis/rollback ini sudah berjalan"
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
  [ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$OLD_DIR/frontend/dist/index.html" | sed -n 1p)" ] || die "bundel web publik bukan dist release sebelumnya"
  PREV_DIR="$OLD_DIR"
  TBL="$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('attribution_touches','meta_ad_references','meta_ad_reference_imports',${TABEL_BARU_SQL})")"
  [ "$TBL" = "8" ] || die "tabel atribusi/spend tidak lengkap setelah rollback (${TBL}/8) — rollback kode tidak boleh menghapus tabel"
  ok "rollback selesai: release ${BASE_SHORT}, image $(docker inspect -f '{{.Image}}' "$CID2" | cut -c8-19), .env tidak berubah; 8 tabel atribusi+spend UTUH ($(psql_live -At -c "select count(*) from meta_ad_daily_spend") baris spend, $(psql_live -At -c "select count(*) from attribution_touches") touch — tidak dihapus)"
  trap - EXIT; exit 0
fi

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df find node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do [ -e "$lf" ] || continue; ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"; done
exec 9>/tmp/release-atribusi-spend.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "atri3\|release-atribusi-spend\|pgrep\|node src/index.js" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
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
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$|^docker-compose|(^|/)Dockerfile$|^frontend/dist/|(^|/)\.env' || die "dependensi/compose/Dockerfile/dist/.env berubah — rilis ini TIDAK boleh mengubahnya"
! printf '%s\n' "$CHANGED" | grep -qiE 'campaign.?automation|budget|meta.?write|ads.?write' || die "diff menyentuh jalur otomasi campaign/budget — dilarang"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
MIG_LIST=""; EXPECT_PRISMA="backend/prisma/schema.prisma"
for e in $MIGS; do MIG_LIST="$MIG_LIST ${e%%:*}"; EXPECT_PRISMA="$(printf '%s\nbackend/prisma/migrations/%s/migration.sql' "$EXPECT_PRISMA" "${e%%:*}")"; done
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat schema.prisma + migrasi rilis ini"; }
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
ok "migrasi: DDL aditif (5 tabel baru, 5 indeks, 2 FK RESTRICT, 14 CHECK bernama); tanpa ALTER tabel lama/DROP/INSERT/UPDATE/DELETE/GRANT/fungsi/trigger"
uji_negatif_pemindai
! sg grep -nE "method:[[:space:]]*[\"'](POST|PUT|PATCH|DELETE)[\"']" "$DEPLOY_SHA" -- backend/src/services/attribution/spendSyncMeta.js >/dev/null 2>&1 || die "adapter Meta memuat metode non-GET — dilarang (hanya baca dari Meta)"
ok "adapter Meta: hanya GET (tidak ada POST/PUT/PATCH/DELETE ke Meta)"
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
[ "$(docker image inspect -f '{{.Id}}' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag ${IMG_NAME} menunjuk image lain dari container aktif"
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
CAND_MIGS="$(sg ls-tree --name-only "${DEPLOY_SHA}" backend/prisma/migrations/ | sed 's#.*/##' | grep -E '^[0-9]{14}_' | LC_ALL=C sort)"
PROD_MIGS="$(psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort)"
SOLO_PROD="$(comm -13 <(printf '%s\n' "$CAND_MIGS") <(printf '%s\n' "$PROD_MIGS") || true)"
[ -z "$SOLO_PROD" ] || { printf '%s\n' "$SOLO_PROD" | sed 's/^/        /'; die "produksi memiliki migrasi yang TIDAK ada di kandidat — bawa kandidat ke baseline terbaru"; }
SOLO_CAND="$(comm -23 <(printf '%s\n' "$CAND_MIGS") <(printf '%s\n' "$PROD_MIGS") || true)"
[ "$(printf '%s\n' "$SOLO_CAND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || { printf '%s\n' "$SOLO_CAND" | sed 's/^/        /'; die "migrasi yang belum terpasang bukan tepat migrasi rilis ini"; }
ok "migrasi: terpasang di produksi ($(printf '%s\n' "$PROD_MIGS" | grep -c .)) ⊆ kandidat; belum terpasang = tepat migrasi rilis ini"
for T in Customer Message Order User attribution_touches meta_ad_references meta_ad_reference_imports; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in (${TABEL_BARU_SQL})")" = "0" ] || die "tabel spend/KPI SUDAH ada di produksi (tidak diharapkan)"
ENV_BEFORE="$(env_sha)"; CTWA_BEFORE="$(ctwa_env_count "$CID_OLD")"; CAPTURE_BEFORE="$(capture_count "$CID_OLD")"
CAPTURE_FLAG_BEFORE="$(container_env "$CID_OLD" "$FLAG_CAPTURE")"
TOUCH_BEFORE="$(psql_live -At -c "select count(*) from attribution_touches")"; angka_ok "$TOUCH_BEFORE" || die "hitungan touch tidak valid"
REF_BEFORE="$(psql_live -At -c "select count(*) from meta_ad_references")"
ok "keadaan yang HARUS tetap: .env sha ${ENV_BEFORE:0:12}…, CTWA_* = ${CTWA_BEFORE}, entri capture = ${CAPTURE_BEFORE}, migrasi = ${MIG_SEBELUM}, ${FLAG_CAPTURE}='${CAPTURE_FLAG_BEFORE:-<kosong>}', touch=${TOUCH_BEFORE}, referensi=${REF_BEFORE}"
[ "$(container_env "$CID_OLD" "$FLAG_SYNC")" != "true" ] && ! flag_true_teks "$FLAG_SYNC" "$(env_flag_text "$FLAG_SYNC")" || die "${FLAG_SYNC}=true SUDAH menyala di produksi — rilis ini harus berangkat dengan sinkronisasi OFF"
ok "${FLAG_SYNC} tidak menyala"
[ "$(docker exec "$CID_OLD" sh -c 'env | grep -c "^WEBHOOK_DEBUG=1$" || true')" = "0" ] || die "WEBHOOK_DEBUG=1 aktif di produksi — matikan dulu"
CUST_N="$(psql_live -At -c "select count(*) from \"Customer\"")"; MSG_N="$(psql_live -At -c "select count(*) from \"Message\"")"
ok "volume: Customer=${CUST_N}, Message=${MSG_N} (tabel lama tidak diubah oleh migrasi)"
FP_SQL="select 'Customer', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Customer\" x
union all select 'Message_n', count(*), '-' from \"Message\" x
union all select 'Order', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Order\" x
union all select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x
union all select 'fin_settings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from fin_settings x
union all select 'attribution_touches', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from attribution_touches x
union all select 'meta_ad_references', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.ad_id),'')) from meta_ad_references x"
FP_N=7
SKEMA_SQL="select table_name, count(*), md5(string_agg(column_name || ':' || data_type, ',' order by ordinal_position)) from information_schema.columns where table_schema='public' and table_name in ('Customer','Message','Order','payments','User','attribution_touches','meta_ad_references','meta_ad_reference_imports') group by table_name"
SKEMA_N=8

say "2b. Sumber node_modules frontend (package.json identik dengan kandidat)"
LOCK_NEW="$BK_DIR/pkg-baru.json"; sg show "${DEPLOY_SHA}:frontend/package.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package.json identik"
ok "node_modules build dari ${NM_SRC}"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; AVAIL_KB="$(avail_kb)"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang untuk salinan node_modules + backup + build"
ok "DB $(( DB_BYTES / 1048576 )) MiB; ruang cukup"
disk_gate "preflight"
if [ "$MODE" = "preflight" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup pra-rilis + checksum + verifikasi restore"
BACKUP_TARGET="$HOME/backups/pre-${TAG_KODE}-${DEPLOY_SHORT}-${TS}.sql.gz"
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
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.yml") >/dev/null || die "docker-compose.yml berbeda dari release aktif"
diff -q <(tr -d '\r' < "$PREV_DIR/backend/package.json") <(tr -d '\r' < "$NEW_DIR/backend/package.json") >/dev/null || die "backend/package.json berbeda dari release aktif"
ok "release dir dibuat; compose + backend/package.json identik dengan release aktif"

say "4b. Build web (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build web gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build web tidak valid"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "bundel baru identik dengan lama"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
for s1 in "Impor spend harian (CSV Ads Manager)" "Target KPI (diisi Owner)" "Cost / qualified" "Belum tersambung" "Atribusi tersimpan sejak"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur baru: ${s1}"; done
for s2 in "Konfirmasi Barang Jadi" "Menunggu konfirmasi siap kirim" "Rencana Produksi" "Checklist Persiapan Perjalanan" "Uang Muka" "Atribusi tersimpan sejak"; do
  [ -n "$(grep -lF "$s2" "$PREV_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "[skrip] teks lama '${s2}' tidak ada di dist release aktif — perbaiki daftar pembanding"
  [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru KEHILANGAN teks fitur lama: ${s2}"
done
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru dan 6 teks fitur lama ada"

PHASE="4c-aset-lama"; say "4c. Bawa aset ber-hash dari dist aktif (tab terbuka saat deploy tetap bisa memuat chunk lama)"
OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"; n=0
for f in "$PREV_DIR"/frontend/dist/assets/*; do
  [ -f "$f" ] || continue; b="$(basename "$f")"; [ -e "$NEW_DIR/frontend/dist/assets/$b" ] && continue
  cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b" && { printf '%s\n' "$b" >> "$OLD_ASSETS"; n=$((n+1)); }
done
find "$NEW_DIR/frontend/dist/assets" -type f -mtime +21 -delete
[ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "bundel baru rusak setelah membawa aset lama"
ok "${n} aset lama dibawa; index.html baru hanya merujuk aset baru"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
disk_gate "sebelum build"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"
for f in "${!PINS[@]}"; do
  case "$f" in backend/prisma/*) continue;; esac
  have="$(dcp "$NEW_DIR" run --rm --no-deps -T --entrypoint sh backend -c "cat /app/${f#backend/}" </dev/null | sha_lf)"
  [ "$have" = "${PINS[$f]}" ] || die "image baru memuat ${f} berbeda dari pin"
done; ok "image baru memuat berkas runtime persis pin (sebelum switch)"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint, bandingkan sidik jari tabel lama + atribusi, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_${TAG_KODE}_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
for T in '"Order"' '"Customer"' '"Message"' payments fin_settings attribution_touches meta_ad_references; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  TOL=50; [ "$T" = '"Message"' ] && TOL=2000
  [ "$B" -le "$A" ] && [ $(( A - B )) -le "$TOL" ] || die "restore rehearsal tidak cocok untuk $T (produksi=$A restore=$B)"
done
ok "restore nyata ke DB sementara cocok (Order, Customer, Message, payments, pengaturan, touch, referensi)"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sebelum.txt" || die "sidik jari rehearsal sebelum gagal"
[ "$(grep -c . "$BK_DIR/fp-reh-sebelum.txt")" = "$FP_N" ] || die "sidik jari rehearsal tidak ${FP_N} tabel"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$(printf '%s\n' "$REH_PEND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || die "migrasi pending pada DB rehearsal bukan tepat migrasi rilis ini: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status rehearsal tidak 'up to date'"
[ "$(RPSQL "select count(*) from information_schema.tables where table_schema='public' and table_name in (${TABEL_BARU_SQL})")" = "5" ] || die "5 tabel baru tidak terpasang di rehearsal"
for T in $TABEL_BARU; do [ "$(RPSQL "select count(*) from $T")" = "0" ] || die "tabel baru $T TIDAK kosong setelah migrasi (backfill tidak diizinkan)"; done
[ "$(RPSQL "select count(*) from pg_constraint where conrelid in ('meta_spend_imports'::regclass,'meta_ad_daily_spend'::regclass,'meta_ad_spend_revisions'::regclass,'attribution_kpi_targets'::regclass,'attribution_alert_state'::regclass) and contype='c'")" = "14" ] || die "jumlah CHECK pada tabel baru bukan 14"
[ "$(RPSQL "select count(*) from pg_indexes where tablename in (${TABEL_BARU_SQL})")" = "10" ] || die "jumlah indeks (5 pkey + 5) pada tabel baru bukan 10"
ok "5 tabel baru kosong; 14 CHECK; 10 indeks (termasuk pkey); migrate status up to date"
UJI_OUT="$(printf '%s\n' "$UJI_SQL" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; die "perilaku constraint SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 18 ] || { printf '%s\n' "$UJI_OUT"; die "uji perilaku: penolakan terbukti terlalu sedikit (${UJI_TOLAK:-?}; minimal 18)"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" -ge 6 ] || { printf '%s\n' "$UJI_OUT"; die "uji perilaku: data benar yang lolos terlalu sedikit (${UJI_LOLOS:-?}; minimal 6)"; }
ok "perilaku terbukti di DB rehearsal: tolak=${UJI_TOLAK} lolos=${UJI_LOLOS} — notasi ilmiah/IDR/negatif/hierarki/sumber/unik harian/FK/singleton target ditolak bila salah; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || die "sidik jari rehearsal sesudah gagal"
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; die "migrasi/uji rehearsal MENGUBAH isi tabel lama atau tabel atribusi Fase 2"; }
for T in $TABEL_BARU; do [ "$(RPSQL "select count(*) from $T")" = "0" ] || die "data uji rehearsal tidak dibatalkan ($T)"; done
drop_temp_dbs; REH_DB=""
ok "rehearsal lulus: isi ${FP_N} tabel (lama + touch + referensi) IDENTIK sebelum vs sesudah migrasi + uji perilaku; tabel baru kosong; DB sementara dihapus"
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
[ "$(grep -c . "$BK_DIR/skema-prod-sebelum.txt")" = "$SKEMA_N" ] || die "sidik jari skema tidak ${SKEMA_N} tabel"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
for m in $MIG_LIST; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 1 ))" ] || die "jumlah migrasi terpasang != sebelum + 1"
ok "1 migrasi diterapkan; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"
for T in $TABEL_BARU; do [ "$(psql_live -At -c "select count(*) from $T")" = "0" ] || die "tabel baru $T TIDAK kosong setelah migrasi sebelum switch"; done
psql_live -At -c "$SKEMA_SQL" | LC_ALL=C sort > "$BK_DIR/skema-prod-sesudah.txt" || die "sidik jari skema produksi sesudah migrasi gagal"
cmp -s "$BK_DIR/skema-prod-sebelum.txt" "$BK_DIR/skema-prod-sesudah.txt" || { diff "$BK_DIR/skema-prod-sebelum.txt" "$BK_DIR/skema-prod-sesudah.txt" || true; die "skema tabel lama/atribusi BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: 5 tabel baru kosong; skema ${SKEMA_N} tabel lama+atribusi identik"
[ "$(env_sha)" = "$ENV_BEFORE" ] || die ".env berubah selama rilis — JANGAN switch"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "image container aktif berubah — JANGAN switch"
[ "$(sg rev-parse "$CAND_REF")" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"

PHASE="7-switch"; say "7. Switch backend + web ke release baru (SATU kali; env TIDAK diubah; sinkronisasi spend OFF)"
SWITCH_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for _ in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(backend_cid)"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT}); switch ${SWITCH_UTC}"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja): RBAC, rekonsiliasi, privasi, flag, inbox, web"
PREV_DIR="$NEW_DIR"
sleep 20
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( MIG_SEBELUM + 1 ))" ] || die "jumlah migrasi terpasang bukan sebelum + 1"; ok "migrasi terpasang = sebelum + 1 (${MIG_SEBELUM} + 1)"
[ "$(env_sha)" = "$ENV_BEFORE" ] || die ".env berubah setelah rilis"; ok ".env identik (sha ${ENV_BEFORE:0:12}…)"
[ "$(ctwa_env_count "$CID_NEW")" = "$CTWA_BEFORE" ] || die "jumlah variabel CTWA_* di container berubah"
[ "$(capture_count "$CID_NEW")" -ge "$CAPTURE_BEFORE" ] || die "entri capture CTWA berkurang"
ok "capture CTWA Fase 0 tidak tersentuh: CTWA_* = ${CTWA_BEFORE}, entri capture $(capture_count "$CID_NEW") (sebelum ${CAPTURE_BEFORE})"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel web publik BUKAN dist baru (${NEW_INDEX})"; ok "bundel web publik = dist baru ${NEW_INDEX}"
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} 404"; ok "aset lama masih 200 (tab terbuka tidak kena 404)"; fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang tidak ada harus 404 jujur"
ok "aset yang tidak ada = 404"
rc=0; verify_live "$SWITCH_UTC" || rc=$?
trap - EXIT
[ "$rc" = "0" ] || { say "RILIS AKTIF TETAPI VERIFIKASI GAGAL (kode ${rc}) — ${DEPLOY_SHORT}. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}."; exit "$rc"; }
say "SELESAI — ${DEPLOY_SHORT} aktif (switch ${SWITCH_UTC}); sinkronisasi spend OFF. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
say "TINDAK LANJUT: (1) impor satu hari spend (CSV Ads Manager, dry-run dulu) dan rekonsiliasi ke total sumber; (2) kredensial Marketing API (ads_read) via secret resmi bila Owner mengizinkan; (3) cron monitoring: scripts/atribusi-monitor-cron.sh."
exit 0
