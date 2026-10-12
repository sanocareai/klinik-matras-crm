#!/usr/bin/env bash
# RILIS "KOREKSI REFUND — BUKTI TRANSFER + BIAYA ADMIN BANK": web + backend + 1 migrasi ADITIF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Bukti transfer pada Koreksi Refund (unggah/tempel/seret; JPG/PNG/WEBP/PDF 8 MB; relasi eksplisit dokumen<->bukti, append-only; URL bertanda-tangan 5 menit; tidak statis),
#   nomor referensi transfer, pratinjau lengkap (lama->baru, bukti, jurnal dibalik/pengganti, dampak saldo), peringatan potensi biaya admin ganda, revisi optimistis,
#   rincian tiap versi di Riwayat, kolom Referensi + Jumlah Bukti di Export Refund.
#   Migrasi: 20261105090000_refund_bukti_biaya_admin — 1 kolom NULL + 2 tabel baru (kosong) + 4 indeks + 4 FK + 5 CHECK + 2 fungsi + 2 trigger penjaga. TANPA backfill/UPDATE/DELETE.
# Refund yang sudah ada TIDAK diubah (transfer_reference NULL, tanpa tautan bukti = "refund lama"). Biaya admin bank sudah ada di skema sejak 24 Sep 2026 (tidak ada kolom baru).
# Produksi: verifikasi hanya baca + penolakan izin/tipe; TIDAK ada refund/koreksi/unggahan/transaksi QA. Uji perilaku constraint/trigger dijalankan di DB REHEARSAL (hasil restore backup).
#
#   cat scripts/release-refund-bukti-biaya-admin.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/rbk1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/rbk1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/rbk1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/rbk1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode HANYA boleh di-rollback bila belum ada bukti/tautan bukti, referensi transfer, atau koreksi refund ber-biaya-admin yang dibuat sesudah rilis. Periksa dulu dengan
# scripts/rollback-guard-refund-bukti-biaya-admin.sh (baca-saja; menolak bila ada data baru: kode lama tidak memelihara relasi bukti dan menyalin biaya admin tanpa konfirmasi duplikasi).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/koreksi-refund-bukti-biaya-admin}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261105090000_refund_bukti_biaya_admin:dbe4a4f8023839b4175b99e4f993df4d446f7762569b4a13767220d81e247e53"
# Hasil pemindai untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":20,"add_column":1,"create_table":2,"create_index":4,"fk":4,"check":5,"trigger":2,"fungsi":2}'
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261105090000_refund_bukti_biaya_admin/migration\.sql|backend/prisma/schema\.prisma|backend/src/routes/financeMedia\.js|backend/src/routes/financeTransactions\.js|backend/src/services/finance/export/piutang-refund\.js|backend/src/services/finance/klaimLunasBerkas\.js|backend/src/services/finance/koreksiGate\.js|backend/src/services/finance/koreksiLanjutan\.js|backend/src/services/finance/posting/orderRevenue\.js|backend/src/services/finance/refundBiayaGanda\.js|backend/src/services/finance/refundBukti\.js|backend/tests/integration/financeExportPiutangRefund\.integration\.test\.js|backend/tests/integration/financeKoreksiLanjutan\.integration\.test\.js|backend/tests/integration/refundBuktiBiayaAdmin\.integration\.test\.js|backend/tests/integration/setup/refundBuktiTmpEnv\.js|backend/tests/integration/setup/testDb\.js|docs/KOREKSI-REFUND-BUKTI\.md|frontend/src/api\.js|frontend/src/features/finance/KoreksiAman\.jsx|frontend/src/features/finance/KoreksiRefundDialog\.jsx|frontend/src/features/finance/matriksAksi\.js|frontend/src/features/finance/refundKoreksiLogic\.js|frontend/src/pages/finance/FinanceReceivables\.jsx|frontend/tests/refundKoreksiBukti\.test\.js|scripts/release-refund-bukti-biaya-admin\.sh|scripts/rollback-guard-refund-bukti-biaya-admin\.sh)$'
BACKEND_SRC_EXPECT="backend/src/routes/financeMedia.js backend/src/routes/financeTransactions.js backend/src/services/finance/export/piutang-refund.js backend/src/services/finance/klaimLunasBerkas.js backend/src/services/finance/koreksiGate.js backend/src/services/finance/koreksiLanjutan.js backend/src/services/finance/posting/orderRevenue.js backend/src/services/finance/refundBiayaGanda.js backend/src/services/finance/refundBukti.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/finance/KoreksiAman.jsx frontend/src/features/finance/KoreksiRefundDialog.jsx frontend/src/features/finance/matriksAksi.js frontend/src/features/finance/refundKoreksiLogic.js frontend/src/pages/finance/FinanceReceivables.jsx"
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
BK_DIR="$HOME/release-backups/refund-bukti-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
warn() { printf '  \033[33mPERHATIAN\033[0m %s\n' "$*"; }
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
LANGKAH WAJIB sebelum rollback KODE setelah switch: jalankan GUARD (baca-saja)
   bash ${NEW_DIR}/scripts/rollback-guard-refund-bukti-biaya-admin.sh
Guard menolak (exit 1) bila SUDAH ada data yang hanya dipahami kode baru:
   - bukti transfer refund (fin_refund_evidences) atau relasi bukti dokumen (fin_refund_evidence_links),
   - refund ber-nomor referensi transfer (fin_refunds.transfer_reference terisi),
   - koreksi refund (dokumen pengganti) ber-biaya-admin yang dibuat SESUDAH migrasi ini terpasang.
   Bila guard menolak: JANGAN rollback ke kode lama (kode lama tidak memelihara relasi bukti dokumen, tidak membawa referensi transfer, dan tidak memeriksa biaya admin ganda).
   Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner.
Bila guard lulus (belum ada data baru), rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi hanya MENAMBAH 1 kolom NULL + 2 tabel kosong + penjaga: dibiarkan terpasang pun aman bagi kode lama SELAMA belum ada data baru. (Tidak dihapus oleh rollback kode.)
Pemulihan database penuh hanya bila terjadi kerusakan data: gzip -dc ${BACKUP_FILE:-<backup>} | psql ... (lihat checksum di atas).
─────────────────────────────────────────────────────────────────────────
EOF
}
trap 'rc=$?; [ $rc -ne 0 ] && rollback_instructions; exit $rc' EXIT

PHASE="0-lingkungan"; say "0. Lingkungan dan kunci deploy"
for c in git docker curl gzip sha256sum awk grep flock tar sed df node npm; do command -v "$c" >/dev/null 2>&1 || die "perintah '$c' tidak ada"; done
for lf in /tmp/release-*.lock; do
  [ -e "$lf" ] || continue
  ( exec 8>"$lf"; flock -n 8 ) || die "deploy lain sedang berjalan (kunci ${lf} dipegang)"
done
exec 9>/tmp/release-refund-bukti-biaya-admin.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "rbk1\|release-refund-bukti-biaya-admin\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, pin migrasi, pemindai DDL (+ uji negatif pemindai)"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=400 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" "+refs/heads/main:refs/remotes/origin/main" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
MAIN_SHA="$(sg rev-parse refs/remotes/origin/main)"
sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA" || die "origin/main (${MAIN_SHA:0:8}) BUKAN leluhur kandidat ${DEPLOY_SHORT}: rilis akan menghilangkan isi main — gabungkan main ke kandidat dulu"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
# frontend/dist TIDAK boleh ikut commit: rilis ini MEMBANGUN frontend di release dir (langkah 4b). Berkas dist di kandidat = berhenti.
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -q 'production-evidence' || die "artefak foto uji ikut ter-commit (backend/data/production-evidence) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -q 'receipt-proofs' || die "artefak unggahan uji ikut ter-commit (backend/data/receipt-proofs) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)\.env' || die "berkas .env ikut ter-commit — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -qx 'backend/src/index.js' || die "backend/src/index.js berubah (dipatok tes atribusi)"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$BACKEND_SRC_EXPECT" ] || die "backend/src yang berubah bukan tepat yang diaudit: ${BACKEND_SRC_EXPECT}"
[ "$(printf '%s\n' "$CHANGED" | grep -E '^frontend/src/' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" = "$FRONTEND_SRC_EXPECT" ] || die "frontend/src yang berubah bukan tepat daftar yang diaudit"
NBE_EXPECT="$(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w)"
MIG_LIST=""; EXPECT_PRISMA="backend/prisma/schema.prisma"
for e in $MIGS; do MIG_LIST="$MIG_LIST ${e%%:*}"; EXPECT_PRISMA="$(printf '%s\nbackend/prisma/migrations/%s/migration.sql' "$EXPECT_PRISMA" "${e%%:*}")"; done
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$(printf '%s\n' "$EXPECT_PRISMA" | LC_ALL=C sort)" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat schema.prisma + migrasi rilis ini"; }
# Migrasi yang sudah ada di baseline TIDAK boleh diubah/dihapus (yang sudah pernah diterapkan di produksi): hanya penambahan.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
# schema.prisma: hanya penambahan baris di model yang sudah ada + model baru; baris lama TIDAK dihapus/diubah selain yang diaudit (nol baris dihapus)
SCHEMA_DEL="$(sg diff --numstat "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | awk '{print $2}')"
[ "$SCHEMA_DEL" = "0" ] || die "schema.prisma menghapus/mengubah ${SCHEMA_DEL} baris yang sudah ada — hanya penambahan yang diizinkan"
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
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai migrasi rilis "Koreksi Refund: bukti transfer + referensi" (1 migrasi aditif). Dijalankan di VPS oleh skrip rilis; juga dijalankan lokal terhadap berkas migrasi. FAIL-CLOSED, daftar putih per pernyataan.
//  (a) SATU kolom baru pada tabel lama: fin_refunds.transfer_reference VARCHAR(120) NULL (tanpa DEFAULT/NOT NULL -> tanpa rewrite/backfill),
//  (b) DUA tabel baru (fin_refund_evidences, fin_refund_evidence_links) dengan kolom persis yang diaudit,
//  (c) 4 indeks (2 UNIQUE) hanya pada tabel baru, 4 FK dari tabel baru, 5 CHECK bernama tanpa subquery,
//  (d) 2 fungsi plpgsql penjaga (badan hanya IF/RAISE/RETURN; tanpa INSERT/UPDATE/DELETE/EXECUTE) + 2 trigger BEFORE UPDATE OR DELETE pada tabel baru.
// Tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/RENAME/ALTER COLUMN, tidak ada perubahan lain pada tabel lama.
import fs from "node:fs";
let sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const hitung = {};
const tambah = (k) => { hitung[k] = (hitung[k] ?? 0) + 1; };
const gagal = (m) => { console.error(m); process.exit(1); };
const TABEL_BARU = {
  fin_refund_evidences: ["id", "stored_name", "original_name", "mime_type", "size_bytes", "sha256", "status", "uploaded_by_id", "created_at", "attached_at"],
  fin_refund_evidence_links: ["id", "refund_id", "evidence_id", "origin", "created_by_id", "created_at"],
};
const INDEKS_OK = new Map([
  ["fin_refund_evidences_stored_name_key", "fin_refund_evidences"], ["fin_refund_evidences_status_created_at_idx", "fin_refund_evidences"],
  ["fin_refund_evidence_links_refund_id_evidence_id_key", "fin_refund_evidence_links"], ["fin_refund_evidence_links_evidence_id_idx", "fin_refund_evidence_links"],
]);
const FK_OK = new Set([
  "fin_refund_evidences.uploaded_by_id>User:SET NULL", "fin_refund_evidence_links.refund_id>fin_refunds:RESTRICT",
  "fin_refund_evidence_links.evidence_id>fin_refund_evidences:RESTRICT", "fin_refund_evidence_links.created_by_id>User:SET NULL",
]);
const CHECK_OK = new Map([
  ["fin_refund_evidences_status_chk", "fin_refund_evidences"], ["fin_refund_evidences_size_chk", "fin_refund_evidences"], ["fin_refund_evidences_mime_chk", "fin_refund_evidences"],
  ["fin_refund_evidences_attached_chk", "fin_refund_evidences"], ["fin_refund_evidence_links_origin_chk", "fin_refund_evidence_links"],
]);
const FUNGSI_OK = new Set(["fin_refund_evidence_guard", "fin_refund_evidence_link_guard"]);
const TRIGGER_OK = new Set([
  'CREATE TRIGGER "fin_refund_evidences_guard_trg" BEFORE UPDATE OR DELETE ON "fin_refund_evidences" FOR EACH ROW EXECUTE FUNCTION "fin_refund_evidence_guard"()',
  'CREATE TRIGGER "fin_refund_evidence_links_guard_trg" BEFORE UPDATE OR DELETE ON "fin_refund_evidence_links" FOR EACH ROW EXECUTE FUNCTION "fin_refund_evidence_link_guard"()',
]);
const TERLARANG = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXECUTE|PERFORM|GRANT|REVOKE|COPY|SELECT|CALL|DO|COMMIT|ROLLBACK|SET)\b/i;

// (d) fungsi: badan hanya IF/RAISE/RETURN.
const FN_RE = /CREATE FUNCTION "([a-z_]+)"\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/g;
const sudah = new Set();
for (const m of sql.matchAll(FN_RE)) {
  const [, nama, tubuh] = m;
  if (!FUNGSI_OK.has(nama)) gagal(`fungsi di luar daftar putih: ${nama}`);
  if (sudah.has(nama)) gagal(`fungsi duplikat: ${nama}`);
  sudah.add(nama);
  const badan = tubuh.replace(/'(?:[^']|'')*'/g, "''");
  if (TERLARANG.test(badan)) gagal(`badan fungsi ${nama} memuat perintah di luar daftar putih`);
  if (/\$[a-z_]*\$/i.test(badan)) gagal(`badan fungsi ${nama} memuat dollar-quote bersarang`);
  if ((tubuh.match(/RAISE EXCEPTION/g) ?? []).length < 2) gagal(`fungsi ${nama} harus menolak (RAISE EXCEPTION) minimal 2 jalur`);
  tambah("fungsi");
}
if (sudah.size !== FUNGSI_OK.size) gagal(`fungsi harus tepat ${FUNGSI_OK.size} (ditemukan ${sudah.size})`);
sql = sql.replace(FN_RE, "");

const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
const dilihat = new Set();
const unik = (jenis, nama) => { const k = `${jenis}:${nama}`; if (dilihat.has(k)) gagal(`${jenis} duplikat: ${nama}`); dilihat.add(k); };
for (const st of stmts) {
  const r = rapat(st);
  let m;
  if (r === 'ALTER TABLE "fin_refunds" ADD COLUMN "transfer_reference" VARCHAR(120)') { unik("kolom", "fin_refunds.transfer_reference"); tambah("add_column"); continue; }
  if ((m = /^CREATE TABLE "([a-z_]+)" \((.+)\)$/.exec(r))) {
    const kolomOk = TABEL_BARU[m[1]];
    if (!kolomOk) gagal(`CREATE TABLE di luar daftar putih: ${m[1]}`);
    unik("tabel", m[1]);
    if (!new RegExp(`CONSTRAINT "${m[1]}_pkey" PRIMARY KEY \\("id"\\)`).test(m[2])) gagal(`tabel ${m[1]} tanpa primary key standar`);
    if (/\b(REFERENCES|GENERATED|SERIAL|CHECK)\b/i.test(m[2])) gagal(`CREATE TABLE ${m[1]} memuat klausa di luar daftar putih`);
    const nama = [...m[2].trim().matchAll(/(?:^|, )"([a-z0-9_]+)" (?:UUID|TEXT|VARCHAR\(\d+\)|INTEGER|TIMESTAMP\(3\))/g)].map((x) => x[1]);
    if (JSON.stringify(nama) !== JSON.stringify(kolomOk)) gagal(`kolom tabel ${m[1]} bukan yang diaudit: ${nama.join(",")}`);
    const semuaDefault = (m[2].match(/\bDEFAULT\b/g) ?? []).length;
    const defaultOk = (m[2].match(/\bDEFAULT (CURRENT_TIMESTAMP|'STAGED')(?![A-Za-z0-9_])/g) ?? []).length;
    if (semuaDefault !== defaultOk) gagal(`CREATE TABLE ${m[1]} memuat DEFAULT di luar daftar putih`);
    tambah("create_table"); continue;
  }
  if ((m = /^CREATE (UNIQUE )?INDEX "([a-z_]+)" ON "([a-z_]+)"\("([a-z_]+)"(?:, "([a-z_]+)")?\)$/.exec(r))) {
    if (INDEKS_OK.get(m[2]) !== m[3]) gagal(`indeks di luar daftar putih: ${m[2]} pada ${m[3]}`);
    unik("indeks", m[2]); tambah("create_index"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+_fkey)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "([A-Za-z_]+)"\("id"\) ON DELETE (RESTRICT|SET NULL) ON UPDATE CASCADE$/.exec(r))) {
    const k = `${m[1]}.${m[3]}>${m[4]}:${m[5]}`;
    if (!FK_OK.has(k)) gagal(`FK di luar daftar putih: ${k}`);
    unik("fk", k); tambah("fk"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+)" CHECK \((.+)\)$/.exec(r))) {
    if (CHECK_OK.get(m[2]) !== m[1]) gagal(`CHECK di luar daftar putih: ${m[2]} pada ${m[1]}`);
    if (/\b(SELECT|FROM|INSERT|UPDATE|DELETE)\b/i.test(m[3])) gagal(`CHECK memuat subquery/perintah menulis: ${m[2]}`);
    unik("check", m[2]); tambah("check"); continue;
  }
  if (TRIGGER_OK.has(r)) { unik("trigger", r); tambah("trigger"); continue; }
  gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
}
if ((hitung.create_table ?? 0) !== Object.keys(TABEL_BARU).length) gagal("tabel baru harus tepat 2");
if ((hitung.create_index ?? 0) !== INDEKS_OK.size) gagal(`indeks harus tepat ${INDEKS_OK.size}`);
if ((hitung.fk ?? 0) !== FK_OK.size) gagal(`FK harus tepat ${FK_OK.size}`);
if ((hitung.check ?? 0) !== CHECK_OK.size) gagal(`CHECK harus tepat ${CHECK_OK.size}`);
if ((hitung.trigger ?? 0) !== TRIGGER_OK.size) gagal(`trigger harus tepat ${TRIGGER_OK.size}`);
if ((hitung.add_column ?? 0) !== 1) gagal("kolom tambahan harus tepat 1");
console.log(JSON.stringify({ total: stmts.length + (hitung.fungsi ?? 0), add_column: 0, create_table: 0, create_index: 0, fk: 0, check: 0, trigger: 0, fungsi: 0, ...hitung }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (1 kolom NULL, 2 tabel baru, 4 indeks, 4 FK, 5 CHECK bernama, 2 fungsi plpgsql penjaga + 2 trigger); tanpa DROP/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE tabel lama" "$(tambah_stmt 'DROP TABLE "fin_refunds";')"
harus_ditolak "UPDATE tabel lama (backfill transfer_reference)" "$(tambah_stmt "UPDATE \"fin_refunds\" SET \"transfer_reference\" = 'x';")"
harus_ditolak "UPDATE tabel lama (biaya admin refund)" "$(tambah_stmt "UPDATE \"fin_refunds\" SET \"transfer_fee_amount\" = 0;")"
harus_ditolak "DELETE tabel lama" "$(tambah_stmt 'DELETE FROM "fin_journal_lines";')"
harus_ditolak "INSERT tabel lama" "$(tambah_stmt "INSERT INTO \"fin_settings\" (\"key\", \"value\") VALUES ('x', 'y');")"
harus_ditolak "INSERT ke tabel bukti baru (seed)" "$(tambah_stmt "INSERT INTO \"fin_refund_evidences\" (\"id\") VALUES (gen_random_uuid());")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "fin_refunds";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "fin_refunds" DROP COLUMN "amount";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "fin_refunds" ALTER COLUMN "amount" TYPE INTEGER;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "fin_refunds" RENAME COLUMN "amount" TO "nominal";')"
harus_ditolak "kolom baru kedua pada fin_refunds" "$(tambah_stmt 'ALTER TABLE "fin_refunds" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom baru di tabel lama lain" "$(tambah_stmt 'ALTER TABLE "fin_journal_entries" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom NOT NULL DEFAULT pada tabel lama (rewrite)" "$(printf '%s\n' "$ALL_SQL" | sed 's/ADD COLUMN "transfer_reference" VARCHAR(120)/ADD COLUMN "transfer_reference" VARCHAR(120) NOT NULL DEFAULT '"'"'x'"'"'/')"
harus_ditolak "kolom tambahan pada tabel baru" "$(printf '%s\n' "$ALL_SQL" | sed 's/    "attached_at" TIMESTAMP(3),/    "attached_at" TIMESTAMP(3),\n    "harga" INTEGER,/')"
harus_ditolak "kolom hilang dari tabel baru" "$(printf '%s\n' "$ALL_SQL" | grep -v '"sha256" VARCHAR(64) NOT NULL,')"
harus_ditolak "tabel baru ketiga" "$(tambah_stmt 'CREATE TABLE "fin_refund_extra" ("id" UUID NOT NULL, CONSTRAINT "fin_refund_extra_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "fin_refunds"("order_id");')"
harus_ditolak "FK ke tabel di luar daftar" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "fin_refunds"("id")/REFERENCES "Customer"("id")/')"
harus_ditolak "FK baru dari tabel lama" "$(tambah_stmt 'ALTER TABLE "fin_refunds" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "FK dengan CASCADE (menghapus bukti bersama dokumen)" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "fin_refund_evidences"("id") ON DELETE RESTRICT/REFERENCES "fin_refund_evidences"("id") ON DELETE CASCADE/')"
harus_ditolak "CHECK dengan nama tak diaudit" "$(tambah_stmt 'ALTER TABLE "fin_refund_evidences" ADD CONSTRAINT "evil_chk" CHECK (true);')"
harus_ditolak "nama CHECK diganti" "$(printf '%s\n' "$ALL_SQL" | sed 's/"fin_refund_evidences_size_chk"/"fin_refund_evidences_evil_chk"/')"
harus_ditolak "CHECK memuat subquery" "$(printf '%s\n' "$ALL_SQL" | sed 's/CHECK ("origin" IN (.BARU., .DIBAWA.))/CHECK ((SELECT count(*) FROM fin_refunds) >= 0)/')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "fin_refund_evidences" TO PUBLIC;')"
harus_ditolak "trigger pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "fin_refunds" FOR EACH ROW EXECUTE FUNCTION "fin_refund_evidence_guard"();')"
harus_ditolak "trigger dimatikan" "$(tambah_stmt 'ALTER TABLE "fin_refund_evidences" DISABLE TRIGGER ALL;')"
harus_ditolak "trigger penjaga hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'fin_refund_evidence_links_guard_trg')"
harus_ditolak "fungsi menulis (DELETE di badan)" "$(printf '%s\n' "$ALL_SQL" | sed 's/^  IF TG_OP = .DELETE. THEN$/  DELETE FROM fin_refunds; IF TG_OP = '"'"'DELETE'"'"' THEN/')"
harus_ditolak "fungsi tambahan liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "fungsi tak lagi menolak (RAISE dibuang)" "$(printf '%s\n' "$ALL_SQL" | sed 's/RAISE EXCEPTION/-- RAISE EXCEPTION/g')"
harus_ditolak "satu indeks hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'fin_refund_evidences_status_created_at_idx')"
harus_ditolak "default liar pada tabel baru" "$(printf '%s\n' "$ALL_SQL" | sed "s/DEFAULT 'STAGED'/DEFAULT now()/")"
[ "$NEG" -ge 30 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 30)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER COLUMN/RENAME/kolom-tabel-indeks-FK di luar daftar/FK CASCADE/CHECK liar/subquery/GRANT/trigger liar atau dimatikan/fungsi menulis/RAISE dibuang/hitungan beda) SEMUANYA ditolak"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8} dan origin/main ${MAIN_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit + 1 migrasi aditif"

PHASE="2-audit-produksi"; say "2. Audit produksi aktif (baca-saja)"
CID_OLD="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID_OLD" | grep -c .)" = "1" ] || die "harus tepat satu container backend"
PREV_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")"
case "$PREV_DIR" in "$RELEASES"/*) ;; *) die "release aktif (${PREV_DIR}) bukan di bawah ${RELEASES}";; esac
[ -f "$PREV_DIR/.release-commit" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || die "release aktif tidak lengkap"
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
# Prasyarat skema: tabel yang disentuh HARUS sudah ada; objek rilis ini belum boleh ada.
for T in fin_refunds fin_journal_entries fin_journal_lines fin_cash_accounts fin_accounts fin_expenses fin_expense_categories payments "Order" fin_settings fin_bank_statements fin_bank_statement_lines; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='fin_refunds' and column_name in ('transfer_fee_amount','transfer_fee_type','payment_method','replaces_refund_id','attachment_url')")" = "5" ] || die "kolom biaya admin/penggantian refund belum lengkap di produksi (prasyarat: rilis Koreksi Refund B3.8 harus sudah live)"
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='fin_refunds' and column_name='transfer_reference'")" = "0" ] || die "kolom transfer_reference SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name in ('fin_refund_evidences','fin_refund_evidence_links')")" = "0" ] || die "tabel bukti refund SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_proc where proname in ('fin_refund_evidence_guard','fin_refund_evidence_link_guard')")" = "0" ] || die "fungsi penjaga rilis ini SUDAH ada di produksi (tidak diharapkan)"
for m in $MIG_LIST; do [ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${m}'")" = "0" ] || die "migrasi ${m} SUDAH tercatat di produksi (tidak diharapkan)"; done
[ "$(psql_live -At -c "select count(*) from fin_accounts where system_key = 'BEBAN_ADMIN_BANK' and active and is_postable")" = "1" ] || warn "akun sistem BEBAN_ADMIN_BANK belum aktif/dapat diposting di produksi: koreksi dengan biaya admin akan DITOLAK dengan arahan Indonesia sampai Bagan Akun diperbaiki (bukan kegagalan rilis)"
REF_N="$(psql_live -At -c "select count(*) from fin_refunds")"; REF_OK_N="$(psql_live -At -c "select count(*) from fin_refunds where status::text = 'DISETUJUI'")"
REF_FEE_N="$(psql_live -At -c "select count(*) from fin_refunds where status::text = 'DISETUJUI' and transfer_fee_amount > 0")"; REF_GANTI_N="$(psql_live -At -c "select count(*) from fin_refunds where replaces_refund_id is not null")"
[ "$REF_N" -gt 0 ] || die "tidak ada refund di produksi: uji perilaku rehearsal butuh contoh baris — berhenti"
ok "prasyarat skema terpenuhi; refund=${REF_N} (disetujui ${REF_OK_N}, ber-biaya-admin ${REF_FEE_N}, hasil koreksi ${REF_GANTI_N}) — semua dibiarkan apa adanya, tanpa backfill"
# GARIS DASAR invarian jurnal refund (dibandingkan sesudah rilis; yang dijaga = TIDAK BERTAMBAH oleh rilis ini).
SQL_SELISIH="select count(*)::int from fin_refunds r where r.status::text = 'DISETUJUI' and exists (select 1 from fin_journal_entries e where e.source::text = 'REFUND' and e.source_id = r.id::text and e.status::text = 'POSTED') and (select coalesce(sum(l.credit), 0) from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.source::text = 'REFUND' and e.source_id = r.id::text and e.status::text = 'POSTED' and l.cash_account_id is not null) <> r.amount + r.transfer_fee_amount"
SQL_GANDA="select count(*)::int from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x"
SQL_TANPA_JURNAL="select count(*)::int from fin_refunds r where r.status::text = 'DISETUJUI' and not exists (select 1 from fin_journal_entries e where e.source::text = 'REFUND' and e.source_id = r.id::text and e.status::text = 'POSTED')"
BASE_SELISIH="$(psql_live -At -c "$SQL_SELISIH")"; BASE_GANDA="$(psql_live -At -c "$SQL_GANDA")"; BASE_TANPA_JURNAL="$(psql_live -At -c "$SQL_TANPA_JURNAL")"
BASE_SUM="$(psql_live -At -c "select coalesce(sum(amount), 0)::text from fin_refunds where status::text = 'DISETUJUI' and updated_at < now() - interval '5 minutes'")"
for v in "$BASE_SELISIH" "$BASE_GANDA" "$BASE_TANPA_JURNAL"; do [[ "$v" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$v'"; done
printf 'BASE_SELISIH=%s BASE_GANDA=%s BASE_TANPA_JURNAL=%s REF_N=%s\n' "$BASE_SELISIH" "$BASE_GANDA" "$BASE_TANPA_JURNAL" "$REF_N" > "$BK_DIR/garis-dasar.env"
ok "garis dasar: refund disetujui yang kredit rekeningnya ≠ nominal + biaya admin = ${BASE_SELISIH}; refund dengan >1 jurnal berlaku = ${BASE_GANDA}; disetujui tanpa jurnal = ${BASE_TANPA_JURNAL}"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel, TANPA kolom yang ditambahkan rilis ini (fin_refunds.transfer_reference). Membuktikan restore identik dan migrasi tidak mengubah data lama.
FP_SQL="select 'fin_refunds', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'transfer_reference')::text, '|' order by x.id),'')) from fin_refunds x
union all select 'fin_expenses', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_expenses x
union all select 'fin_expense_categories', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_expense_categories x
union all select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x
union all select 'order', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Order\" x
union all select 'fin_journal_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_entries x
union all select 'fin_journal_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x
union all select 'fin_accounts', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_accounts x
union all select 'fin_cash_accounts', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_cash_accounts x
union all select 'fin_settings', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key),'')) from fin_settings x
union all select 'fin_bank_statements', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_bank_statements x
union all select 'fin_bank_statement_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_bank_statement_lines x"
FP_N=12
# DOKUMEN PEMBANDING DIBEKUKAN: hanya yang menurut aturan bisnis tidak mungkin berubah akibat rilis ini (refund & pengeluaran yang sudah DIBATALKAN/DITOLAK dan diam sebelum T0,
# baris jurnal yang dibuat sebelum T0 (append-only), saldo per akun dari jurnal itu, pembayaran lama, seluruh flag fin_settings). T0 = jam DB (UTC) 5 menit lalu. Dokumen terbuka dan transaksi baru TIDAK diperbandingkan.
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'refund_final', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'transfer_reference')::text, '|' order by x.id),'')) from fin_refunds x where x.status::text in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'pengeluaran_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_expenses x where x.status::text in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'pembayaran_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x where x.created_at < '$T0'::timestamp
union all select 'flag', count(*), md5(coalesce(string_agg(f.key || '=' || f.value, '|' order by f.key),'')) from fin_settings f
FPBEKU
)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "6" ] || die "sidik jari dokumen beku tidak 6 baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di 6 kelompok)"

say "2b. Sumber node_modules frontend (package.json identik dengan kandidat)"
LOCK_NEW="$BK_DIR/pkg-baru.json"; sg show "${DEPLOY_SHA}:frontend/package.json" > "$LOCK_NEW"
NM_SRC=""
for d in "$PREV_DIR" "$RELEASES"/*/; do
  d="${d%/}"
  if [ -d "$d/frontend/node_modules" ] && [ -f "$d/frontend/package.json" ] && cmp -s <(tr -d '\r' < "$d/frontend/package.json") <(tr -d '\r' < "$LOCK_NEW"); then NM_SRC="$d/frontend/node_modules"; break; fi
done
[ -n "$NM_SRC" ] || die "tidak ada release dengan frontend/node_modules dan package.json identik"
ok "node_modules build dari ${NM_SRC}"
DB_BYTES="$(psql_live -At -c "select pg_database_size('${DB_NAME}')")"; NM_KB="$(du -sk "$NM_SRC" | cut -f1)"; AVAIL_KB="$(df -Pk "$HOME" | awk 'NR==2{print $4}')"
[ "$AVAIL_KB" -ge $(( NM_KB * 2 + DB_BYTES / 1024 * 3 + 3 * 1024 * 1024 )) ] || die "ruang disk kurang"
ok "ruang disk cukup"
if [ "$PREFLIGHT_ONLY" = "1" ]; then say "Preflight selesai (--preflight-only): produksi TIDAK diubah"; trap - EXIT; exit 0; fi

PHASE="3-backup"; say "3. Backup produksi + checksum"
BACKUP_FILE="$HOME/backups/pre-refund-bukti-${DEPLOY_SHORT}-${TS}.sql.gz"
dcp "$PREV_DIR" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" </dev/null | gzip > "${BACKUP_FILE}.partial" || die "pg_dump gagal"
gzip -t "${BACKUP_FILE}.partial" || die "arsip backup rusak"
gzip -dc "${BACKUP_FILE}.partial" | tail -n 5 | grep 'PostgreSQL database dump complete' >/dev/null || die "dump tidak lengkap"
[ "$(stat -c %s "${BACKUP_FILE}.partial")" -gt 1024 ] || die "file backup terlalu kecil"
mv "${BACKUP_FILE}.partial" "$BACKUP_FILE"
( cd "$(dirname "$BACKUP_FILE")" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null ) || die "checksum backup gagal"
ok "backup: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1)); sha256 $(cut -d' ' -f1 "${BACKUP_FILE}.sha256")"

PHASE="4-release-dir"; say "4. Release dir ${NEW_DIR} (git archive; release aktif tidak disentuh)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah selama backup"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah selama backup"
mkdir "$NEW_DIR" || die "gagal membuat ${NEW_DIR}"
sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR" --exclude='frontend/dist' || die "git archive gagal"
cp -a "$NM_SRC" "$NEW_DIR/frontend/node_modules" || die "gagal menyalin node_modules frontend"
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-refund-bukti-biaya-admin.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
[ ! -e "$NEW_DIR/backend/.env" ] || die "backend/.env tidak boleh ada di arsip"
printf '%s\n' "$DEPLOY_SHORT" > "$NEW_DIR/.release-commit"
ln -s "$PERSIST/backend/.env" "$NEW_DIR/backend/.env"; [ -r "$NEW_DIR/backend/.env" ] || die "symlink backend/.env tidak terbaca"
if grep -l $'\r' "$NEW_DIR/backend/Dockerfile" "$NEW_DIR/docker-compose.yml" "$NEW_DIR/docker-compose.release.yml" >/dev/null 2>&1; then die "berkas Docker/compose mengandung CRLF"; fi
diff -q <(tr -d '\r' < "$PREV_DIR/docker-compose.release.yml") <(tr -d '\r' < "$NEW_DIR/docker-compose.release.yml") >/dev/null || die "docker-compose.release.yml berbeda dari release aktif"
ok "release dir dibuat; compose identik"

say "4b. Build frontend di release dir (dist BARU; dist aktif tidak disentuh)"
install -m 600 "$PERSIST/frontend/.env" "$NEW_DIR/frontend/.env" || die "gagal menyalin frontend/.env"
( cd "$NEW_DIR/frontend" && npm run build ) > "$BK_DIR/build-frontend.log" 2>&1 || { rm -f "$NEW_DIR/frontend/.env"; tail -n 25 "$BK_DIR/build-frontend.log"; die "build frontend gagal (produksi tidak berubah)"; }
rm -f "$NEW_DIR/frontend/.env"
NEW_INDEX="$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)"
[ -n "$NEW_INDEX" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "hasil build frontend tidak valid"
MAPS_KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_JS_KEY=//p' "$PERSIST/frontend/.env" | tr -d '\r"'"'"' ')"
[ -n "$(grep -lF "$MAPS_KEY" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat VITE_GOOGLE_MAPS_JS_KEY"
# Fitur rilis ini + fitur rilis sebelumnya (jangan sampai hilang dari bundel).
for s1 in "Gunakan bukti lama" "Tambah bukti baru" "Ganti bukti pada dokumen pengganti" "Potensi biaya admin tercatat dua kali" "Rincian tiap versi refund" "Nomor referensi transfer"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Item Penjualan & Pemenuhan" "Piutang & Refund" "Penjualan & Piutang" "Katalog Item PKR" "Kirim sebagian" "Retur & Debit Note" "Rencana Produksi" "Penjualan Karyawan" "Barang Akan Datang"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
[ -z "$(grep -lF "Hitung Kas" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru memuat Hitung Kas (halamannya belum ada)"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + 9 teks fitur lama ada"

PHASE="4c-aset-lama"; say "4c. Bawa aset ber-hash dari dist release aktif (tab terbuka saat deploy tetap bisa memuat chunk lama)"
OLD_ASSETS="$BK_DIR/aset-lama.txt"; : > "$OLD_ASSETS"
n=0
for f in "$PREV_DIR"/frontend/dist/assets/*; do
  [ -f "$f" ] || continue; b="$(basename "$f")"
  [ -e "$NEW_DIR/frontend/dist/assets/$b" ] && continue
  cp -p "$f" "$NEW_DIR/frontend/dist/assets/$b" && { printf '%s\n' "$b" >> "$OLD_ASSETS"; n=$((n+1)); }
done
find "$NEW_DIR/frontend/dist/assets" -type f -mtime +21 -delete
ok "${n} aset lama dibawa ke dist baru; index.html baru tetap hanya merujuk aset baru"
[ -n "$(grep -o 'index-[A-Za-z0-9_-]*\.js' "$NEW_DIR/frontend/dist/index.html" | sed -n 1p)" ] && [ -f "$NEW_DIR/frontend/dist/assets/$NEW_INDEX" ] || die "index/bundel baru rusak setelah membawa aset lama"

PHASE="5-build-image"; say "5. Build image backend baru (backend lama tetap melayani)"
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-refund-bukti-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_refund_bukti_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod-beku.txt" || { reh_drop; die "sidik jari dokumen beku produksi gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || true; reh_drop; die "dokumen pembanding beku BERUBAH selama backup (produksi)"; }
RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi (backup/restore bermasalah)"; }
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sebelum.txt" || { reh_drop; die "sidik jari penuh rehearsal gagal"; }
[ "$(grep -c . "$BK_DIR/fp-reh-sebelum.txt")" = "$FP_N" ] || { reh_drop; die "sidik jari penuh rehearsal tidak ${FP_N} tabel"; }
ok "restore nyata IDENTIK dengan dokumen beku produksi (refund & pengeluaran final, baris jurnal, saldo per akun, pembayaran lama, flag)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$(printf '%s\n' "$REH_PEND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat migrasi rilis ini: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
# Struktur: kolom baru NULL di SEMUA refund lama (tanpa backfill); 2 tabel baru KOSONG; 5 CHECK; 2 fungsi; 2 trigger; 4 indeks.
[ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='fin_refunds' and column_name='transfer_reference'")" = "1" ] || { reh_drop; die "kolom transfer_reference tidak terpasang"; }
[ "$(RPSQL "select count(*) from fin_refunds where transfer_reference is not null")" = "0" ] || { reh_drop; die "ada refund lama dengan transfer_reference terisi (backfill tidak diizinkan)"; }
for T in fin_refund_evidences fin_refund_evidence_links; do [ "$(RPSQL "select count(*) from $T")" = "0" ] || { reh_drop; die "tabel baru $T TIDAK kosong setelah migrasi"; }; done
for C in fin_refund_evidences_status_chk fin_refund_evidences_size_chk fin_refund_evidences_mime_chk fin_refund_evidences_attached_chk fin_refund_evidence_links_origin_chk; do
  [ "$(RPSQL "select count(*) from pg_constraint where conname='$C'")" = "1" ] || { reh_drop; die "constraint $C tidak ada tepat satu"; }
done
for F in fin_refund_evidence_guard fin_refund_evidence_link_guard; do [ "$(RPSQL "select count(*) from pg_proc where proname='$F'")" = "1" ] || { reh_drop; die "fungsi $F tidak ada tepat satu"; }; done
for G in fin_refund_evidences_guard_trg fin_refund_evidence_links_guard_trg; do [ "$(RPSQL "select count(*) from pg_trigger where tgname='$G' and not tgisinternal")" = "1" ] || { reh_drop; die "trigger $G tidak ada tepat satu"; }; done
ok "kolom baru NULL di semua refund lama (tanpa backfill); 2 tabel bukti baru kosong; 5 CHECK; 2 fungsi + 2 trigger penjaga terpasang"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan di akhir): CHECK menolak data salah; bukti yang sudah dipakai tidak bisa diubah/dihapus; relasi append-only.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE
  rf uuid; ev uuid := gen_random_uuid(); ev2 uuid := gen_random_uuid(); lk uuid := gen_random_uuid();
  tolak int := 0; lolos int := 0;
BEGIN
  SELECT id INTO rf FROM fin_refunds LIMIT 1;
  IF rf IS NULL THEN RAISE EXCEPTION 'ROLLBACK_UJI tolak=0 lolos=0 (tidak ada refund contoh)'; END IF;
  -- (1) CHECK pada berkas bukti: status liar, ukuran 0 / > 8 MB, tipe bukan JPG/PNG/WEBP/PDF, STAGED berstempel attached_at
  BEGIN INSERT INTO fin_refund_evidences (id, stored_name, original_name, mime_type, size_bytes, sha256, status) VALUES (gen_random_uuid(), 'a1.jpg', 'a', 'image/jpeg', 10, 'x', 'LIAR'); RAISE EXCEPTION 'TIDAK_DITOLAK_status';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_refund_evidences (id, stored_name, original_name, mime_type, size_bytes, sha256) VALUES (gen_random_uuid(), 'a2.jpg', 'a', 'image/jpeg', 0, 'x'); RAISE EXCEPTION 'TIDAK_DITOLAK_ukuran_nol';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_refund_evidences (id, stored_name, original_name, mime_type, size_bytes, sha256) VALUES (gen_random_uuid(), 'a3.jpg', 'a', 'image/jpeg', 8388609, 'x'); RAISE EXCEPTION 'TIDAK_DITOLAK_ukuran_besar';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_refund_evidences (id, stored_name, original_name, mime_type, size_bytes, sha256) VALUES (gen_random_uuid(), 'a4.html', 'a', 'text/html', 10, 'x'); RAISE EXCEPTION 'TIDAK_DITOLAK_mime';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_refund_evidences (id, stored_name, original_name, mime_type, size_bytes, sha256, status, attached_at) VALUES (gen_random_uuid(), 'a5.jpg', 'a', 'image/jpeg', 10, 'x', 'STAGED', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_staged_attached';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO fin_refund_evidences (id, stored_name, original_name, mime_type, size_bytes, sha256) VALUES (ev, 'uji-rehearsal-1.jpg', 'bukti.jpg', 'image/jpeg', 1024, 'abc'); lolos := lolos + 1;
  BEGIN INSERT INTO fin_refund_evidences (id, stored_name, original_name, mime_type, size_bytes, sha256) VALUES (gen_random_uuid(), 'uji-rehearsal-1.jpg', 'dobel.jpg', 'image/jpeg', 1024, 'abc'); RAISE EXCEPTION 'TIDAK_DITOLAK_nama_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  -- (2) bukti STAGED boleh dihapus; yang DIGUNAKAN tidak boleh diubah isinya, dikembalikan, atau dihapus
  INSERT INTO fin_refund_evidences (id, stored_name, original_name, mime_type, size_bytes, sha256) VALUES (ev2, 'uji-rehearsal-2.jpg', 'sementara.jpg', 'image/jpeg', 512, 'def'); DELETE FROM fin_refund_evidences WHERE id = ev2; lolos := lolos + 1;
  UPDATE fin_refund_evidences SET status = 'DIGUNAKAN', attached_at = now() WHERE id = ev; lolos := lolos + 1;
  BEGIN UPDATE fin_refund_evidences SET original_name = 'diganti.jpg' WHERE id = ev; RAISE EXCEPTION 'TIDAK_DITOLAK_ubah_isi';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE fin_refund_evidences SET status = 'STAGED', attached_at = NULL WHERE id = ev; RAISE EXCEPTION 'TIDAK_DITOLAK_kembali_staged';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM fin_refund_evidences WHERE id = ev; RAISE EXCEPTION 'TIDAK_DITOLAK_hapus_dipakai';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  -- (3) relasi dokumen<->bukti: origin liar, ganda, ubah, hapus ditolak; yang sah lolos; created_by boleh di-NULL-kan (ON DELETE SET NULL pada User)
  BEGIN INSERT INTO fin_refund_evidence_links (id, refund_id, evidence_id, origin) VALUES (gen_random_uuid(), rf, ev, 'LIAR'); RAISE EXCEPTION 'TIDAK_DITOLAK_origin';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO fin_refund_evidence_links (id, refund_id, evidence_id, origin) VALUES (lk, rf, ev, 'BARU'); lolos := lolos + 1;
  BEGIN INSERT INTO fin_refund_evidence_links (id, refund_id, evidence_id, origin) VALUES (gen_random_uuid(), rf, ev, 'DIBAWA'); RAISE EXCEPTION 'TIDAK_DITOLAK_tautan_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE fin_refund_evidence_links SET origin = 'DIBAWA' WHERE id = lk; RAISE EXCEPTION 'TIDAK_DITOLAK_ubah_tautan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM fin_refund_evidence_links WHERE id = lk; RAISE EXCEPTION 'TIDAK_DITOLAK_hapus_tautan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  UPDATE fin_refund_evidence_links SET created_by_id = NULL WHERE id = lk; lolos := lolos + 1;
  -- (4) referensi transfer: maksimal 120 karakter
  BEGIN UPDATE fin_refunds SET transfer_reference = repeat('x', 121) WHERE id = rf; RAISE EXCEPTION 'TIDAK_DITOLAK_referensi_panjang';
  EXCEPTION WHEN string_data_right_truncation THEN tolak := tolak + 1; END;
  UPDATE fin_refunds SET transfer_reference = 'TRF-UJI-1' WHERE id = rf; lolos := lolos + 1;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint/trigger SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 14 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti terlalu sedikit (${UJI_TOLAK:-?}; minimal 14) — constraint/trigger tidak aktif atau data contoh kurang"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" -ge 6 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos terlalu sedikit (${UJI_LOLOS:-?}; minimal 6)"; }
ok "perilaku terbukti di DB rehearsal: tolak=${UJI_TOLAK} lolos=${UJI_LOLOS} — CHECK menolak data salah; bukti yang dipakai tidak bisa diubah/dihapus; relasi append-only; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from fin_refund_evidences")" = "0" ] && [ "$(RPSQL "select count(*) from fin_refund_evidence_links")" = "0" ] && [ "$(RPSQL "select count(*) from fin_refunds where transfer_reference is not null")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi + uji perilaku (sidik jari baris penuh tanpa kolom baru); tabel baru kosong; DB sementara dihapus"

PHASE="6-migrate"; say "6. Migrasi aditif (image baru; backend lama tetap melayani)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum migrasi"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum migrasi"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
for m in $MIG_LIST; do grep -Fx "$m" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${m} SUDAH terpasang sebelum rilis (tidak diharapkan)"; done
PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") || true)"
[ "$(printf '%s\n' "$PENDING" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || die "migrasi pending bukan tepat migrasi rilis ini: $(printf '%s' "$PENDING" | tr '\n' ' ')"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
for m in $MIG_LIST; do psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${m}'" | grep -Fx t >/dev/null || die "${m} tidak tercatat selesai"; done
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 1 ))" ] || die "jumlah migrasi terpasang != sebelum + 1"
ok "1 migrasi diterapkan; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"
# SETELAH migrasi, SEBELUM switch: hanya backend LAMA yang melayani dan ia tidak mengenal tabel/kolom baru → tabel baru HARUS kosong dan kolom baru NULL (tanpa backfill).
for T in fin_refund_evidences fin_refund_evidence_links; do [ "$(psql_live -At -c "select count(*) from $T")" = "0" ] || die "tabel baru $T TIDAK kosong setelah migrasi sebelum switch"; done
[ "$(psql_live -At -c "select count(*) from fin_refunds where transfer_reference is not null")" = "0" ] || die "ada refund dengan transfer_reference terisi setelah migrasi sebelum switch"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari dokumen beku pasca-migrasi gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: tabel bukti kosong, transfer_reference NULL di semua refund (tanpa backfill), dokumen pembanding beku identik"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum switch"
dcp "$NEW_DIR" up -d --no-deps backend </dev/null >/dev/null 2>&1 || die "docker compose up backend gagal"
UP=0; for i in $(seq 1 45); do curl -fsS --max-time 4 "${INTERNAL_URL}/api/health" >/dev/null 2>&1 && { UP=1; break; }; sleep 2; done
[ "$UP" = "1" ] || die "backend baru tidak sehat dalam 90 detik"
CID_NEW="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(docker inspect -f '{{.Image}}' "$CID_NEW")" = "$NEW_IMG_ID" ] || die "container berjalan tetapi bukan image baru"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_NEW")" = "$NEW_DIR" ] || die "container tidak berasal dari ${NEW_DIR}"
ok "backend baru sehat (image ${NEW_IMG_ID:7:12}, release ${DEPLOY_SHORT})"

PHASE="8-verifikasi"; say "8. Verifikasi pasca-rilis (baca-saja)"
curl -fsS --max-time 15 "${PUBLIC_URL}/api/health" | grep '"ok":true' >/dev/null || die "healthcheck publik gagal"; ok "publik 200"
[ "$(curl -fsS --max-time 15 "${PUBLIC_URL}/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | sed -n 1p)" = "$NEW_INDEX" ] || die "bundel publik BUKAN dist baru (${NEW_INDEX})"; ok "bundel web publik = dist baru ${NEW_INDEX}"
NBE=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in backend/src/*) ;; *) continue;; esac
  want="$(sg show "${DEPLOY_SHA}:${f}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  have="$(docker exec "$CID_NEW" sh -c "cat /app/${f#backend/}" | tr -d '\r' | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$have" ] || die "container baru TIDAK memuat ${f} persis"
  NBE=$((NBE+1))
done <<< "$CHANGED"
NBE_EXPECT="$(printf '%s\n' "$BACKEND_SRC_EXPECT" | wc -w)"
[ "$NBE" = "$NBE_EXPECT" ] || die "berkas backend yang diverifikasi harus tepat ${NBE_EXPECT} (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
[ "$(PSQLN "select count(*) from pg_proc where proname in ('fin_refund_evidence_guard','fin_refund_evidence_link_guard')")" = "2" ] || die "dua fungsi penjaga tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_trigger where tgname in ('fin_refund_evidences_guard_trg','fin_refund_evidence_links_guard_trg') and not tgisinternal")" = "2" ] || die "dua trigger penjaga tidak ada setelah rilis"
ok "fungsi + trigger penjaga ada (tidak ada asumsi tentang dokumen baru: koreksi sah boleh sudah terjadi)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test izin + tipe berkas + pembacaan + invarian jurnal refund (baca-saja; tidak menulis; tahan terhadap transaksi sah yang muncul saat rilis)"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_SELISIH="$BASE_SELISIH" -e BASE_GANDA="$BASE_GANDA" -e BASE_TANPA_JURNAL="$BASE_TANPA_JURNAL" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const tulis = [];
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  if (method !== "GET" && /koreksi$/.test(path)) tulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status, code: json?.code ?? null });
  return { status: r.status, json, headers: r.headers };
}
const tokenUntuk = async (u) => { const roles = (await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role); return jwt.sign({ id: u.id, name: u.name, role: u.role, roles: roles.length ? roles : [u.role] }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) {
    const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
    if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u;
  }
  return null;
}
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
const finMurni = await userDengan("FINANCE", new Set(["ADMIN", "OWNER"]));
if (!adm || !sales) { rec("akun ADMIN dan SALES murni tersedia", false, `adm=${!!adm} sales=${!!sales}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const tF = finMurni ? await tokenUntuk(finMurni) : null;
const nol = "00000000-0000-4000-8000-000000000000";
const hitungSql = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const B = (k) => Number(process.env[k]);

// ── Berkas bukti: izin & tipe (penolakan SEBELUM menyentuh data) ──
async function unggah(token, isi, nama, mime) {
  const fd = new FormData(); fd.append("berkas", new Blob([isi], { type: mime }), nama);
  const r = await fetch(`${BASE}/api/finance/refunds/bukti/upload`, { method: "POST", headers: token ? { Authorization: "Bearer " + token } : {}, body: fd });
  let j = null; try { j = await r.json(); } catch { /* kosong */ }
  return { status: r.status, json: j };
}
const html = Buffer.from("<html><script>alert(1)</script></html>".padEnd(64, " "));
rec("unggah bukti: tanpa token 401, SALES 403", (await unggah(null, html, "x.jpg", "image/jpeg")).status === 401 && (await unggah(tS, html, "x.jpg", "image/jpeg")).status === 403);
if (tF) rec("unggah bukti: FINANCE murni (tanpa finance:admin) 403", (await unggah(tF, html, "x.jpg", "image/jpeg")).status === 403);
else skip("unggah bukti: FINANCE murni 403", "tidak ada akun FINANCE murni (aktif, tanpa ADMIN/OWNER); akun/token tidak dibuat atau direkayasa — izin dijaga tes integrasi");
const palsu = await unggah(tA, html, "evil.jpg", "image/jpeg");
rec("unggah bukti: isi HTML berlabel .jpg/image/jpeg ditolak dari ISI (415 TIPE_TIDAK_DIIZINKAN) — tidak ada berkas/baris tersimpan", palsu.status === 415 && palsu.json?.code === "TIPE_TIDAK_DIIZINKAN", `${palsu.status} ${palsu.json?.code}`);
let dirDapatTulis = false; try { fs.accessSync("/app/data", fs.constants.W_OK); dirDapatTulis = true; } catch { dirDapatTulis = false; }
rec("folder data persisten (/app/data) dapat ditulis container (tempat folder refund-bukti dibuat saat unggahan pertama)", dirDapatTulis);
rec("hapus bukti: SALES 403, tanpa token 401", (await api("DELETE", `/api/finance/refunds/bukti/${nol}`, tS)).status === 403 && (await api("DELETE", `/api/finance/refunds/bukti/${nol}`)).status === 401);
rec("hapus bukti id tak dikenal (admin) -> 404 (bukan 500)", (await api("DELETE", `/api/finance/refunds/bukti/${nol}`, tA)).status === 404);
const dir0 = await fetch(`${BASE}/media/finance-receipts/refund-bukti/${"a".repeat(32)}.jpg`);
rec("penyaji bukti: tanpa tanda tangan & tanpa token 401; tanda tangan salah 403 (bukan file statis)", dir0.status === 401 && (await fetch(`${BASE}/media/finance-receipts/refund-bukti/${"a".repeat(32)}.jpg?exp=9999999999&sig=${"0".repeat(64)}`)).status === 403);

// ── Koreksi: penolakan SEBELUM menyentuh data ──
const kunci = (n) => ({ "Idempotency-Key": `smoke-rbk-${n}` });
const badan = { reason: "uji smoke", amount: 1, bukti: { mode: "LAMA" }, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" };
await api("POST", `/api/finance/refunds/${nol}/koreksi`, null, badan, kunci("anon"));
await api("POST", `/api/finance/refunds/${nol}/koreksi`, tS, badan, kunci("sales"));
await api("POST", `/api/finance/refunds/${nol}/koreksi`, tA, badan); // tanpa Idempotency-Key -> 428 sebelum menyentuh data
const SAH = new Set([400, 401, 403, 428]);
rec(`semua ${tulis.length} pemanggilan koreksi ditolak sebelum menyentuh data (hanya 400/401/403/428): smoke TIDAK menulis data produksi`, tulis.length === 3 && tulis.every((b) => SAH.has(b.status)), tulis.map((b) => `${b.n}=${b.status}`).join("; "));
rec("koreksi tanpa Idempotency-Key -> 428", tulis.find((b) => b.status === 428) !== undefined);
const pv = await api("POST", `/api/finance/refunds/${nol}/koreksi`, tA, { ...badan, preview: true });
rec("pratinjau koreksi refund id tak dikenal -> 404 (bukan 500; tanpa menulis)", pv.status === 404, String(pv.status));

// ── Pembacaan (baca-saja) ──
const daftar = await api("GET", "/api/finance/refunds", tA);
rec("daftar refund (admin) 200 dengan nominal / biaya admin / total keluar / jumlah bukti", daftar.status === 200 && Array.isArray(daftar.json?.refunds) && daftar.json.refunds.every((r) => typeof r.jumlahBukti === "number" && r.totalKeluarRekening === r.nominalDiterima + r.biayaAdmin), `${daftar.json?.refunds?.length} refund`);
rec("daftar refund: SALES 403", (await api("GET", "/api/finance/refunds", tS)).status === 403);
const r0 = (daftar.json?.refunds ?? []).find((r) => r.status === "DISETUJUI") ?? (daftar.json?.refunds ?? [])[0];
if (r0) {
  const b = await api("GET", `/api/finance/refunds/${r0.id}/bukti`, tA);
  rec("bukti dokumen (admin) 200: refund lama tanpa tautan tetap terbaca (jumlah = lampiran lama saja)", b.status === 200 && Array.isArray(b.json?.berkas) && b.json.jumlah === b.json.berkas.length + (b.json.lampiranLama ? 1 : 0), JSON.stringify({ n: b.json?.jumlah }));
  rec("bukti dokumen: SALES 403, tanpa token 401", (await api("GET", `/api/finance/refunds/${r0.id}/bukti`, tS)).status === 403 && (await api("GET", `/api/finance/refunds/${r0.id}/bukti`)).status === 401);
  const rw = await api("GET", `/api/finance/riwayat-versi/refunds/${r0.id}`, tA);
  rec("riwayat versi refund 200 memuat rincian tiap versi (biaya admin, total keluar, bukti)", rw.status === 200 && Array.isArray(rw.json?.versiRefund) && rw.json.versiRefund.length >= 1 && rw.json.versiRefund.every((v) => typeof v.biayaAdmin === "number" && typeof v.jumlahBukti === "number"));
} else skip("bukti dokumen & riwayat versi", "tidak ada refund di produksi");
const hari = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const ex = await fetch(`${BASE}/api/finance/export/piutang-refund`, { method: "POST", headers: { Authorization: "Bearer " + tA, "Content-Type": "application/json" }, body: JSON.stringify({ periode: { to: hari }, filter: {} }) });
const exBuf = Buffer.from(await ex.arrayBuffer());
rec("export Piutang & Refund (admin) 200 berkas .xlsx (kolom Referensi + Jumlah Bukti tidak merusak export)", ex.status === 200 && /spreadsheetml/.test(ex.headers.get("content-type") || "") && exBuf.length > 1000 && exBuf.subarray(0, 2).toString() === "PK", `${ex.status} ${exBuf.length} byte`);

// ── Invarian (data apa pun; dibandingkan dengan garis dasar sebelum rilis) ──
rec(`jurnal refund: kredit rekening = nominal + biaya admin (menyimpang sebelum rilis: ${B("BASE_SELISIH")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from fin_refunds r where r.status::text = 'DISETUJUI' and exists (select 1 from fin_journal_entries e where e.source::text = 'REFUND' and e.source_id = r.id::text and e.status::text = 'POSTED') and (select coalesce(sum(l.credit), 0) from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.source::text = 'REFUND' and e.source_id = r.id::text and e.status::text = 'POSTED' and l.cash_account_id is not null) <> r.amount + r.transfer_fee_amount`)) <= B("BASE_SELISIH"));
rec(`tiap refund punya paling banyak SATU jurnal berlaku (ganda sebelum rilis: ${B("BASE_GANDA")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x`)) <= B("BASE_GANDA"));
rec(`refund disetujui tanpa jurnal berlaku (sebelum rilis: ${B("BASE_TANPA_JURNAL")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from fin_refunds r where r.status::text = 'DISETUJUI' and not exists (select 1 from fin_journal_entries e where e.source::text = 'REFUND' and e.source_id = r.id::text and e.status::text = 'POSTED')`)) <= B("BASE_TANPA_JURNAL"));
rec("setiap tautan bukti menunjuk bukti berstatus DIGUNAKAN, dan setiap bukti DIGUNAKAN punya minimal satu tautan", (await hitungSql(`select count(*)::int n from fin_refund_evidence_links l join fin_refund_evidences e on e.id = l.evidence_id where e.status <> 'DIGUNAKAN'`)) === 0 && (await hitungSql(`select count(*)::int n from fin_refund_evidences e where e.status = 'DIGUNAKAN' and not exists (select 1 from fin_refund_evidence_links l where l.evidence_id = e.id)`)) === 0);
rec("tautan bukti berasal DIBAWA hanya ada pada dokumen pengganti (bukan dokumen asli)", (await hitungSql(`select count(*)::int n from fin_refund_evidence_links l join fin_refunds r on r.id = l.refund_id where r.replaces_refund_id is null and l.origin = 'DIBAWA'`)) === 0);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal, ${dilewati} dilewati (SKIP)`);
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log (akun peran-murni tidak ada; tidak ada akun/token/transaksi dibuat). Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else
  ok "smoke test lulus (izin, tipe berkas dari ISI, penyaji bukti bertanda-tangan, penolakan koreksi sebelum menyentuh data, pembacaan refund/bukti/riwayat/export, invarian jurnal refund)"
fi
OLD_ONLY="$(sed -n 1p "$OLD_ASSETS" || true)"
if [ -n "$OLD_ONLY" ]; then
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/${OLD_ONLY}")" = "200" ] || die "aset lama /assets/${OLD_ONLY} tidak bisa diunduh (404) — pembawaan aset lama gagal"
  ok "aset lama ${OLD_ONLY} masih 200 (tab terbuka tidak kena 404)"
fi
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${PUBLIC_URL}/assets/tidak-ada-zz.js")" = "404" ] || die "aset yang memang tidak ada harus 404 jujur"
ok "aset yang tidak ada = 404 (bukan index.html)"
sleep 20
[ "$(docker inspect -f '{{.RestartCount}}' "$CID_NEW")" = "0" ] || die "backend restart sendiri setelah switch"
[ "$(docker inspect -f '{{.State.Running}}' "$CID_NEW")" = "true" ] || die "backend tidak berjalan"
ok "backend stabil: RestartCount=0 setelah 20 detik"
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$FP_BEKU_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/data-sesudah.txt" || die "sidik jari dokumen beku sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis — periksa dengan backup"; }
ok "dokumen pembanding beku (refund & pengeluaran final, baris jurnal, saldo per akun, pembayaran lama, flag) IDENTIK sebelum vs sesudah rilis; transaksi sah yang muncul saat rilis tidak diperbandingkan"
# Pembersihan release lama (setelah rilis TERBUKTI sehat). Dipertahankan: 4 terbaru (mtime), release baru, release sebelumnya, dan release yang dirujuk container berjalan. Kegagalan di sini TIDAK menggagalkan rilis.
PHASE="9-pembersihan"; say "9. Pembersihan release lama (menyisakan 4 terbaru + yang dipakai container)"
(
  cd "$RELEASES" || exit 0
  KEEP="$(ls -1dt */ | head -4 | tr -d /)
$(basename "$NEW_DIR")
$(basename "$PREV_DIR")"
  for c in $(docker ps -q); do w="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null)"; [ -n "$w" ] && KEEP="$KEEP
$(basename "$w")"; done
  HAPUS="$(ls -1d */ | tr -d / | grep -vxF -f <(echo "$KEEP" | sort -u) || true)"
  n=0; for d in $HAPUS; do case "$d" in ""|"."|"..") continue;; esac; [ -d "$d" ] || continue; rm -rf -- "$d" 2>/dev/null || sudo -n rm -rf -- "$d" 2>/dev/null; n=$((n+1)); done
  echo "  OK    release lama dihapus: $n folder; disk: $(df -h "$HOME" | awk 'NR==2{print $4" bebas"}')"
) || echo "  (pembersihan dilewati)"
trap - EXIT
say "SELESAI — rilis ${DEPLOY_SHORT} aktif. Backup: ${BACKUP_FILE}. Image rollback: ${ROLLBACK_TAG}. Log: ${BK_DIR}/release.log"
say "TINDAK LANJUT OWNER: refund lama TIDAK berubah. Koreksi Refund kini mewajibkan minimal satu bukti transfer pada dokumen pengganti (refund lama tanpa bukti harus mengunggah saat dikoreksi); biaya admin bank dicatat di akun Beban Administrasi Bank."
