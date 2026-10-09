#!/usr/bin/env bash
# RILIS "PO TERINTEGRASI FINANCE–GUDANG" (Barang Akan Datang, kedatangan per penerimaan, pengiriman pengganti, termin dari tanggal tiba): web + backend + 1 migrasi ADITIF —
# workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   20261101090000_po_terintegrasi_kedatangan : kolom nullable (kedatangan, pendamping, replacement_for_line_id) + 1 tabel baru goods_receipt_events (APPEND-ONLY lewat 1 fungsi + 1 trigger)
#                                               + CHECK baru + 1 pelebaran CHECK fin_supplier_bills_term_chk (DROP lalu ADD; hanya MENAMBAH nilai TANGGAL_TIBA).
# TANPA backfill/UPDATE/DELETE: PO, penerimaan, stok, jurnal, faktur, pembayaran yang sudah ada TIDAK berubah. Penerimaan lama tidak ditebak tanggal tibanya ("Tanggal belum ditetapkan").
# Produksi: verifikasi hanya baca + penolakan izin; TIDAK ada PO/penerimaan/transaksi QA. Uji perilaku constraint/trigger dijalankan di DB REHEARSAL (hasil restore backup), bukan di produksi.
#
#   cat scripts/release-po-terintegrasi.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/poti1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/poti1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/poti1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/poti1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode HANYA boleh di-rollback bila belum ada data TANGGAL_TIBA / kedatangan tercatat. Periksa dulu dengan scripts/rollback-guard-po-terintegrasi.sh (baca-saja; menolak bila ada data baru).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/po-terintegrasi-gudang-finance}"
# Migrasi aditif yang SUDAH diaudit: nama → sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIG="20261101090000_po_terintegrasi_kedatangan"
MIG_PIN="d146f2b181be9e1d237b0affe317d7f6fd76d9e5e2e0c86ad9217086c1de9140"
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261101090000_po_terintegrasi_kedatangan/migration\.sql|backend/prisma/schema\.prisma|backend/src/index\.js|backend/src/lib/domain/pendamping\.js|backend/src/routes/barangAkanDatang\.js|backend/src/routes/financeUtang\.js|backend/src/routes/goodsReceipt\.js|backend/src/routes/purchaseOrders\.js|backend/src/services/finance/agingUtang\.js|backend/src/services/finance/export/aging-utang\.js|backend/src/services/finance/jadwalJatuhTempo\.js|backend/src/services/finance/kedatangan\.js|backend/src/services/finance/progresPO\.js|backend/src/services/finance/purchaseOrder\.js|backend/src/services/finance/purchaseOrderBill\.js|backend/src/services/finance/purchaseOrderDocument\.js|backend/src/services/finance/reports\.js|backend/src/services/finance/termin\.js|backend/src/services/purchaseOrderPdf\.js|backend/tests/integration/biayaBahanKonkurensi\.integration\.test\.js|backend/tests/integration/biayaBahanUnit\.integration\.test\.js|backend/tests/integration/poTerintegrasi\.integration\.test\.js|backend/tests/integration/purchaseOrderBahanBaku\.integration\.test\.js|backend/tests/integration/purchaseOrderFaktur\.integration\.test\.js|backend/tests/integration/purchaseOrderSkuBaru\.integration\.test\.js|backend/tests/integration/setup/kedatangan\.js|backend/tests/integration/setup/testApp\.js|backend/tests/integration/terminAgingUtang\.integration\.test\.js|docs/PO-TERINTEGRASI-GUDANG-FINANCE\.md|frontend/src/api\.js|frontend/src/components/Layout\.jsx|frontend/src/components/Topbar\.jsx|frontend/src/features/finance/JadwalAgingUtang\.jsx|frontend/src/features/finance/TerminFaktur\.jsx|frontend/src/features/finance/purchaseOrderLogic\.js|frontend/src/features/kedatangan/PanelKedatangan\.jsx|frontend/src/features/kedatangan/kedatanganLogic\.js|frontend/src/features/portal/divisionContent\.js|frontend/src/features/warehouse/components/GoodsReceiptDetailDrawer\.jsx|frontend/src/features/warehouse/components/GoodsReceiptFormModal\.jsx|frontend/src/pages/finance/FinancePurchaseOrders\.jsx|frontend/src/pages/warehouse/WarehouseBarangAkanDatang\.jsx|frontend/src/routes/pageRegistry\.jsx|frontend/tests/poSkuBaruUI\.test\.js|frontend/tests/poTerintegrasiUI\.test\.js|frontend/tests/purchaseOrderUI\.test\.js|scripts/release-po-terintegrasi\.sh|scripts/rollback-guard-po-terintegrasi\.sh)$'
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
BK_DIR="$HOME/release-backups/poti-${DEPLOY_SHORT}-${TS}"
PHASE="init"; BACKUP_FILE=""; ROLLBACK_TAG=""; PREV_DIR=""; PREV_IMG_ID=""; IMG_NAME=""

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  OK    %s\n' "$*"; }
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
   bash ${NEW_DIR}/scripts/rollback-guard-po-terintegrasi.sh
Guard menolak (exit 1) bila SUDAH ADA data yang hanya dipahami kode baru:
   - faktur supplier dengan term_basis = 'TANGGAL_TIBA' (jatuh tempo per penerimaan; kode lama membaca due_date terawal sebagai SATU-SATUNYA jatuh tempo),
   - penerimaan dengan arrival_revision > 0 (kedatangan dicatat; kode lama membuka kembali jalur ganti status ke Tiba / isi jumlah datang langsung),
   - baris pengganti (replacement_for_line_id), riwayat goods_receipt_events.
   Bila guard menolak: JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau rencanakan migrasi balik DATA (term_basis -> 'TANGGAL_FAKTUR' + hitung ulang due_date) dengan backup dan persetujuan Owner.
Bila guard lulus (belum ada data baru), rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi hanya MENAMBAH kolom/tabel/constraint: dibiarkan terpasang pun aman bagi kode lama SELAMA belum ada data baru. (Kolom/tabel baru tidak dihapus oleh rollback kode.)
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
exec 9>/tmp/release-po-terintegrasi.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "poti1\|release-po-terintegrasi\|pgrep" | grep -v "$$" || true)"
[ -z "$OTHER" ] || { printf '%s\n' "$OTHER" | sed 's/^/        /'; die "ada proses deploy/build/migrasi lain yang berjalan"; }
ok "tidak ada deploy lain"
mkdir -p "$BK_DIR" "$HOME/release-src" "$HOME/backups"
exec > >(tee -a "$BK_DIR/release.log") 2>&1
[ -f "$PERSIST/backend/.env" ] && [ -f "$PERSIST/frontend/.env" ] || die "file .env persisten tidak lengkap"
grep -Eq '^VITE_GOOGLE_MAPS_JS_KEY=.+' "$PERSIST/frontend/.env" || die "VITE_GOOGLE_MAPS_JS_KEY kosong (peta akan mati)"
for d in frontend/dist-driver backend/uploads backend/data; do [ -d "$PERSIST/$d" ] || die "root persisten kurang: ${PERSIST}/${d}"; done
[ ! -e "$NEW_DIR" ] || die "release dir ${NEW_DIR} SUDAH ADA (tidak akan ditimpa)"

PHASE="1-sumber"; say "1. Sumber kode, ancestry, batas perubahan, pin migrasi, dan pemindai DDL"
[ -d "$SRC" ] || git init -q --bare "$SRC"
sg remote get-url origin >/dev/null 2>&1 || sg remote add origin "$REPO_URL"
sg fetch -q --depth=200 origin "+refs/heads/${CAND_BRANCH}:refs/remotes/origin/cand" || die "git fetch gagal"
[ "$(sg rev-parse refs/remotes/origin/cand)" = "$DEPLOY_SHA" ] || die "origin/${CAND_BRANCH} bukan SHA rilis; kandidat bergeser"
sg cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "baseline ${BASE_SHA:0:8} tidak ada di repo sumber"
sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA" || die "baseline ${BASE_SHA:0:8} BUKAN leluhur kandidat ${DEPLOY_SHORT}"
CHANGED="$(sg diff --name-only "$BASE_SHA" "$DEPLOY_SHA" | LC_ALL=C sort)"
[ -n "$CHANGED" ] || die "kandidat identik dengan baseline (tidak ada perubahan)"
LUAR="$(printf '%s\n' "$CHANGED" | grep -Ev "$ALLOWED_RE" || true)"
[ -z "$LUAR" ] || { printf '%s\n' "$LUAR" | sed 's/^/        /'; die "ada berkas di LUAR allowlist eksplisit yang berbeda dari baseline — berhenti"; }
# frontend/dist TIDAK boleh ikut commit: rilis ini MEMBANGUN frontend di release dir (langkah 4b). Berkas dist di kandidat = berhenti.
! printf '%s\n' "$CHANGED" | grep -q '^frontend/dist/' || die "kandidat memuat frontend/dist — dist dibangun saat rilis, bukan di-commit"
! printf '%s\n' "$CHANGED" | grep -qE 'package(-lock)?\.json$' || die "dependensi (package.json/lock) berubah — tidak diizinkan pada rilis ini"
! printf '%s\n' "$CHANGED" | grep -q 'production-evidence' || die "artefak foto uji ikut ter-commit (backend/data/production-evidence) — hapus dari kandidat"
! printf '%s\n' "$CHANGED" | grep -qE '(^|/)docker-compose[^/]*\.yml$|(^|/)Dockerfile$' || die "berkas Docker/compose berubah — tidak diizinkan pada rilis ini"
PRISMA_CHANGED="$(printf '%s\n' "$CHANGED" | grep -E '^backend/prisma/' || true)"
EXPECT_PRISMA="$(printf 'backend/prisma/schema.prisma\nbackend/prisma/migrations/%s/migration.sql\n' "$MIG" | LC_ALL=C sort)"
[ "$(printf '%s\n' "$PRISMA_CHANGED" | LC_ALL=C sort)" = "$EXPECT_PRISMA" ] || { printf '%s\n' "$PRISMA_CHANGED"; die "berkas prisma yang berubah HARUS tepat schema.prisma + migrasi ${MIG}"; }
# Migrasi yang sudah ada di baseline TIDAK boleh diubah/dihapus (yang sudah pernah diterapkan di produksi): hanya penambahan.
[ -z "$(sg diff --name-status "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/migrations | grep -v '^A' || true)" ] || die "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang"
# schema.prisma: hanya penambahan baris (nol baris dihapus/diubah di model yang sudah ada)
SCHEMA_DEL="$(sg diff --numstat "$BASE_SHA" "$DEPLOY_SHA" -- backend/prisma/schema.prisma | awk '{print $2}')"
[ "$SCHEMA_DEL" = "0" ] || die "schema.prisma menghapus/mengubah ${SCHEMA_DEL} baris yang sudah ada — hanya penambahan yang diizinkan"
[[ "$MIG" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || die "nama migrasi tidak valid: $MIG"
MIGSQL="$(sg show "${DEPLOY_SHA}:backend/prisma/migrations/${MIG}/migration.sql" | tr -d '\r')"
MIG_SHA="$(printf '%s\n' "$MIGSQL" | sha256sum | cut -d' ' -f1)"
[ "$MIG_PIN" = "$MIG_SHA" ] || die "isi migrasi ${MIG} BERBEDA dari yang diaudit (sha256 ${MIG_SHA}) — audit ulang lalu perbarui pin"
ok "migrasi ${MIG}: sha256 cocok pin (${MIG_SHA:0:12})"
cat > "$BK_DIR/scan-migrasi.mjs" <<'SCANJS'
// Pemindai migrasi "PO Terintegrasi Finance–Gudang" (dijalankan di VPS oleh skrip rilis; juga dijalankan lokal terhadap berkas migrasi). FAIL-CLOSED, daftar putih per pernyataan.
//  (a) SATU fungsi plpgsql fn_goods_receipt_events_append_only (blok dollar-quoted): badan HANYA RAISE EXCEPTION (tanpa INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/CREATE/EXECUTE/PERFORM di luar literal string),
//  (b) SATU trigger BEFORE UPDATE OR DELETE pada goods_receipt_events yang memanggil fungsi itu (append-only),
//  (c) ALTER TABLE ... ADD COLUMN (nullable/berdefault konstan) hanya pada goods_receipts, goods_receipt_lines, fin_purchase_order_lines,
//  (d) CREATE TABLE goods_receipt_events + indeks + FK (RESTRICT/SET NULL) ke tabel yang sudah ada,
//  (e) ADD CONSTRAINT CHECK dengan nama yang diaudit, dan SATU DROP CONSTRAINT fin_supplier_bills_term_chk yang langsung diikuti ADD CONSTRAINT nama yang sama (pelebaran).
// Tidak ada DROP TABLE/COLUMN, UPDATE/INSERT/DELETE, ALTER COLUMN, TRUNCATE, RENAME di luar badan fungsi yang diperiksa.
import fs from "node:fs";
let sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const hitung = {};
const tambah = (k) => { hitung[k] = (hitung[k] ?? 0) + 1; };
const gagal = (m) => { console.error(m); process.exit(1); };
const FN_RE = /CREATE FUNCTION fn_goods_receipt_events_append_only\(\) RETURNS trigger AS \$fn\$([\s\S]*?)\$fn\$ LANGUAGE plpgsql;/g;
const fungsi = [...sql.matchAll(FN_RE)];
if (fungsi.length !== 1) gagal(`jumlah fungsi fn_goods_receipt_events_append_only harus tepat 1 (ditemukan ${fungsi.length})`);
const badan = fungsi[0][1].replace(/'(?:[^']|'')*'/g, "''");
if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXECUTE|PERFORM|GRANT|REVOKE|COPY)\b/i.test(badan)) gagal("badan fungsi memuat perintah menulis/DDL di luar daftar putih");
if (!/RAISE EXCEPTION/.test(badan) || /\bRETURN\b/i.test(badan)) gagal("badan fungsi append-only harus selalu RAISE EXCEPTION (tanpa RETURN)");
if (/\$[a-z_]*\$/i.test(badan)) gagal("badan fungsi memuat dollar-quote bersarang");
tambah("fungsi");
sql = sql.replace(FN_RE, "");
const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
const TABEL_ADD = new Set(["goods_receipts", "goods_receipt_lines", "fin_purchase_order_lines"]);
const CHECK_OK = new Set(["goods_receipts_kedatangan_chk", "goods_receipt_lines_companion_chk", "goods_receipt_lines_pengganti_chk", "fin_purchase_order_lines_pendamping_chk", "goods_receipt_events_jenis_chk", "fin_supplier_bills_term_chk"]);
let drop = 0; let addTermSetelahDrop = false; let berikutnyaHarusAddTerm = false;
for (const st of stmts) {
  const r = rapat(st);
  let m;
  if (berikutnyaHarusAddTerm) {
    if (!/^ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_term_chk" CHECK \(/.test(r)) gagal("setelah DROP term_chk pernyataan berikutnya HARUS ADD CONSTRAINT term_chk");
    if (!/'TANGGAL_FAKTUR', 'TANGGAL_TIBA'/.test(r) || !/'TUNAI', 'HARI', 'TANGGAL_KHUSUS'/.test(r)) gagal("term_chk baru tidak memuat nilai lama + TANGGAL_TIBA");
    berikutnyaHarusAddTerm = false; addTermSetelahDrop = true; tambah("check"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD COLUMN (.+)$/.exec(r))) {
    if (!TABEL_ADD.has(m[1])) gagal(`ADD COLUMN pada tabel di luar daftar putih: ${m[1]}`);
    // setiap kolom: nama + tipe; NOT NULL hanya dengan DEFAULT konstan (arrival_revision INTEGER NOT NULL DEFAULT 0)
    const bagian = m[2].split(/,\s*ADD COLUMN\s+/);
    for (const b of bagian) {
      if (/NOT NULL/i.test(b) && !/NOT NULL DEFAULT 0$/i.test(b)) gagal(`kolom NOT NULL tanpa DEFAULT 0: ${b}`);
      if (/\b(REFERENCES|UNIQUE|PRIMARY|GENERATED|SERIAL)\b/i.test(b)) gagal(`kolom memuat klausa di luar daftar putih: ${b}`);
    }
    tambah("alter_add_column"); continue;
  }
  if (/^CREATE TABLE "goods_receipt_events" \(/.test(r)) {
    if (/\bDEFAULT\b(?! CURRENT_TIMESTAMP)/.test(r.replace(/NOT NULL DEFAULT CURRENT_TIMESTAMP/, ""))) gagal("CREATE TABLE memuat DEFAULT di luar CURRENT_TIMESTAMP");
    tambah("create_table"); continue;
  }
  if (/^CREATE INDEX "(goods_receipt_events_goods_receipt_id_created_at_idx|goods_receipt_lines_replacement_for_line_id_idx)" ON "(goods_receipt_events|goods_receipt_lines)"\("[a-z_]+"(, "[a-z_]+")?\)$/.test(r)) { tambah("create_index"); continue; }
  if ((m = /^ALTER TABLE "(goods_receipts|goods_receipt_events|goods_receipt_lines)" ADD CONSTRAINT "([a-z_]+_fkey)" FOREIGN KEY \("[a-z_]+"\) REFERENCES "([A-Za-z_]+)"\("id"\) ON DELETE (RESTRICT|SET NULL) ON UPDATE CASCADE$/.exec(r))) {
    if (!["User", "goods_receipts", "goods_receipt_lines"].includes(m[3])) gagal(`FK ke tabel di luar daftar putih: ${m[3]}`);
    tambah("fk"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+_chk)" CHECK \(/.exec(r))) {
    if (!CHECK_OK.has(m[2])) gagal(`CHECK dengan nama di luar yang diaudit: ${m[2]}`);
    if (m[2] === "fin_supplier_bills_term_chk") gagal("ADD term_chk tanpa DROP terlebih dulu");
    if (/\b(SELECT|FROM|INSERT|UPDATE|DELETE)\b/i.test(r)) gagal(`CHECK memuat subquery/perintah menulis: ${m[2]}`);
    tambah("check"); continue;
  }
  if (r === 'ALTER TABLE "fin_supplier_bills" DROP CONSTRAINT "fin_supplier_bills_term_chk"') { drop += 1; berikutnyaHarusAddTerm = true; tambah("drop_constraint"); continue; }
  if (r === 'CREATE TRIGGER trg_goods_receipt_events_append_only BEFORE UPDATE OR DELETE ON "goods_receipt_events" FOR EACH ROW EXECUTE FUNCTION fn_goods_receipt_events_append_only()') { tambah("trigger"); continue; }
  gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
}
if (drop !== 1 || !addTermSetelahDrop || berikutnyaHarusAddTerm) gagal("DROP/ADD term_chk harus tepat sepasang");
console.log(JSON.stringify({ total: stmts.length + 1, ...hitung }));
SCANJS
HASIL_SCAN="$(printf '%s\n' "$MIGSQL" | grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$' | node "$BK_DIR/scan-migrasi.mjs")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = '{"total":20,"fungsi":1,"alter_add_column":4,"create_table":1,"create_index":2,"fk":4,"check":6,"trigger":1,"drop_constraint":1}' ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (4 ALTER ADD COLUMN, 1 tabel baru append-only, 2 indeks, 4 FK, 6 CHECK termasuk pelebaran term_chk, 1 fungsi + 1 trigger append-only baca-saja); tanpa DROP TABLE/COLUMN, UPDATE, INSERT, DELETE pada tabel lama"
ok "kandidat ${DEPLOY_SHORT} turunan baseline ${BASE_SHA:0:8}; $(printf '%s\n' "$CHANGED" | wc -l) berkas dalam allowlist eksplisit + 1 migrasi aditif"

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
# Prasyarat skema: tabel/constraint yang dilebarkan harus sudah ada; kolom/tabel/fungsi rilis ini belum boleh ada.
for T in goods_receipts goods_receipt_lines fin_purchase_orders fin_purchase_order_lines fin_supplier_bills fin_supplier_bill_allocations; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from pg_constraint where conname='fin_supplier_bills_term_chk'")" = "1" ] || die "constraint fin_supplier_bills_term_chk TIDAK ada di produksi (migrasi termin belum terpasang)"
[ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='goods_receipt_events'")" = "0" ] || die "tabel goods_receipt_events SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and ((table_name='goods_receipts' and column_name like 'arriv%') or (table_name='goods_receipt_lines' and column_name in ('companion_qty','replacement_for_line_id')) or (table_name='fin_purchase_order_lines' and column_name like 'companion%'))")" = "0" ] || die "kolom rilis ini SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_proc where proname='fn_goods_receipt_events_append_only'")" = "0" ] || die "fungsi append-only SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from fin_supplier_bills where term_basis='TANGGAL_TIBA'")" = "0" ] || die "sudah ada faktur TANGGAL_TIBA sebelum rilis (tidak diharapkan)"
GR_N="$(psql_live -At -c "select count(*) from goods_receipts")"; PO_N="$(psql_live -At -c "select count(*) from fin_purchase_orders")"; BILL_N="$(psql_live -At -c "select count(*) from fin_supplier_bills")"
ok "prasyarat skema terpenuhi; penerimaan=${GR_N}, PO=${PO_N}, faktur supplier=${BILL_N} (semua dibiarkan apa adanya — tanpa backfill)"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel, TANPA kolom yang ditambahkan rilis ini. Dipakai untuk membuktikan restore identik dan migrasi tidak mengubah data lama.
FP_SQL="select 'goods_receipts', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['arrived_date','arrival_recorded_by','arrival_recorded_at','arrival_actor_roles','arrival_workspace','arrival_receiver','arrival_note','arrival_proof_urls','arrival_revision'])::text, '|' order by x.id),'')) from goods_receipts x
union all select 'goods_receipt_lines', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['companion_qty','replacement_for_line_id'])::text, '|' order by x.id),'')) from goods_receipt_lines x
union all select 'fin_purchase_order_lines', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['companion_unit','companion_mode','companion_ratio','companion_estimate'])::text, '|' order by x.id),'')) from fin_purchase_order_lines x
union all select 'fin_purchase_orders', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_orders x
union all select 'fin_purchase_order_events', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_order_events x
union all select 'fin_supplier_bills', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bills x
union all select 'fin_supplier_bill_po_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bill_po_lines x
union all select 'fin_supplier_bill_allocations', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bill_allocations x
union all select 'fin_supplier_payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_payments x
union all select 'fin_supplier_payment_allocations', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_payment_allocations x
union all select 'fin_suppliers', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_suppliers x
union all select 'stock_movements', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x
union all select 'materials', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from materials x
union all select 'fin_journal_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_entries x
union all select 'fin_journal_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x
union all select 'order', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Order\" x
union all select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x"
psql_live -At -c "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari data sebelum gagal"
ok "sidik jari tabel lama sebelum rilis tersimpan ($(wc -l < "$BK_DIR/data-sebelum.txt") tabel)"

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
BACKUP_FILE="$HOME/backups/pre-poti-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-po-terintegrasi.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Barang Akan Datang" "Catat Barang Tiba" "Arti tiap angka" "Menunggu pengganti" "Belum dilampirkan" "Pengganti untuk" "Ini pengiriman pengganti" "Menunggu tanggal penerimaan"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur: ${s1}"; done
for s2 in "Jadwal & Aging" "Total Utang Aktif" "Pratinjau PDF" "Buat Barang Baru" "Buat/Tautkan Order CRM" "Penjualan Karyawan" "Ajukan Klaim Lunas" "Mutasi & Rekonsiliasi" "Laporan Biaya Divisi"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan fitur rilis sebelumnya: ${s2}"; done
if [ "$NEW_INDEX" = "$PREV_INDEX" ]; then die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"; fi
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); 8 teks fitur baru + 9 teks fitur lama ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-poti-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_poti_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
KUNCI_TABEL='goods_receipts goods_receipt_lines fin_purchase_orders fin_purchase_order_lines fin_purchase_order_events fin_supplier_bills fin_supplier_bill_po_lines fin_supplier_bill_allocations fin_supplier_payments fin_supplier_payment_allocations fin_suppliers stock_movements materials fin_journal_entries fin_journal_lines "Order" payments "Customer" "User"'
for T in $KUNCI_TABEL; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$A" = "$B" ] || { reh_drop; die "restore rehearsal tidak identik untuk $T (produksi=$A restore=$B) — backup/restore bermasalah"; }
done
ok "restore nyata identik (jumlah baris) untuk 19 tabel kunci"
psql_live -At -c "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod.txt" || { reh_drop; die "sidik jari produksi gagal"; }
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sebelum.txt" || { reh_drop; die "sidik jari rehearsal gagal"; }
cmp -s "$BK_DIR/fp-prod.txt" "$BK_DIR/fp-reh-sebelum.txt" || { diff "$BK_DIR/fp-prod.txt" "$BK_DIR/fp-reh-sebelum.txt" || true; reh_drop; die "isi hasil restore BERBEDA dari produksi (sidik jari)"; }
ok "restore nyata identik dengan produksi (sidik jari isi baris penuh: penerimaan, baris penerimaan, PO, baris PO, faktur, alokasi, pembayaran, stok, jurnal, order, payment)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$REH_PEND" = "$MIG" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat ${MIG}: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
# Struktur: kolom baru ada & nullable (kecuali arrival_revision NOT NULL DEFAULT 0), SELURUHNYA kosong/0 pada baris lama (tanpa backfill)
for KB in goods_receipts.arrived_date goods_receipts.arrival_recorded_by goods_receipts.arrival_recorded_at goods_receipts.arrival_actor_roles goods_receipts.arrival_workspace goods_receipts.arrival_receiver goods_receipts.arrival_note goods_receipts.arrival_proof_urls goods_receipt_lines.companion_qty goods_receipt_lines.replacement_for_line_id fin_purchase_order_lines.companion_unit fin_purchase_order_lines.companion_mode fin_purchase_order_lines.companion_ratio fin_purchase_order_lines.companion_estimate; do
  TB="${KB%%.*}"; KL="${KB##*.}"
  [ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='$TB' and column_name='$KL' and is_nullable='YES' and column_default is null")" = "1" ] || { reh_drop; die "kolom baru $KB tidak ada / tidak nullable / punya default"; }
  [ "$(RPSQL "select count(*) from $TB where $KL is not null")" = "0" ] || { reh_drop; die "kolom baru $KB TIDAK kosong setelah migrasi (tidak boleh ada backfill)"; }
done
[ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='goods_receipts' and column_name='arrival_revision' and is_nullable='NO' and column_default='0'")" = "1" ] || { reh_drop; die "arrival_revision harus NOT NULL DEFAULT 0"; }
[ "$(RPSQL "select count(*) from goods_receipts where arrival_revision <> 0")" = "0" ] || { reh_drop; die "ada penerimaan lama dengan arrival_revision <> 0 setelah migrasi (backfill tidak diizinkan)"; }
[ "$(RPSQL "select count(*) from goods_receipt_events")" = "0" ] || { reh_drop; die "goods_receipt_events TIDAK kosong setelah migrasi"; }
ok "14 kolom nullable baru + arrival_revision DEFAULT 0: seluruh baris lama kosong/0 (tanpa backfill); tabel goods_receipt_events kosong"
for C in goods_receipts_kedatangan_chk goods_receipt_lines_companion_chk goods_receipt_lines_pengganti_chk fin_purchase_order_lines_pendamping_chk goods_receipt_events_jenis_chk fin_supplier_bills_term_chk goods_receipt_lines_replacement_for_line_id_fkey goods_receipts_arrival_recorded_by_fkey goods_receipt_events_goods_receipt_id_fkey goods_receipt_events_actor_id_fkey; do
  [ "$(RPSQL "select count(*) from pg_constraint where conname='$C'")" = "1" ] || { reh_drop; die "constraint $C tidak ada tepat satu"; }
done
[ "$(RPSQL "select count(*) from pg_constraint where conname='fin_supplier_bills_term_chk' and pg_get_constraintdef(oid) like '%TANGGAL_TIBA%' and pg_get_constraintdef(oid) like '%TANGGAL_FAKTUR%' and pg_get_constraintdef(oid) like '%TANGGAL_KHUSUS%'")" = "1" ] || { reh_drop; die "term_chk tidak memuat nilai lama + TANGGAL_TIBA"; }
[ "$(RPSQL "select count(*) from pg_proc where proname='fn_goods_receipt_events_append_only'")" = "1" ] || { reh_drop; die "fungsi append-only tidak ada tepat satu"; }
[ "$(RPSQL "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname='trg_goods_receipt_events_append_only' and not t.tgisinternal and c.relname='goods_receipt_events'")" = "1" ] || { reh_drop; die "trigger append-only tidak ada tepat satu"; }
ok "10 constraint (6 CHECK + 4 FK), fungsi append-only, dan trigger append-only terpasang di DB rehearsal; term_chk memuat nilai lama + TANGGAL_TIBA"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan di akhir): append-only menolak UPDATE/DELETE; CHECK menolak data salah dan meloloskan data benar; term_chk menerima TANGGAL_TIBA.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE
  g uuid := gen_random_uuid(); ev uuid := gen_random_uuid(); ev2 uuid := gen_random_uuid(); ln uuid := gen_random_uuid();
  mat uuid; b text;
  tolak int := 0; lolos int := 0; lewat int := 0;
BEGIN
  INSERT INTO goods_receipts (id, receipt_number, source_type, updated_at) VALUES (g, 'GR-UJI-REHEARSAL', (SELECT e FROM unnest(enum_range(NULL::"ReceiptSourceType")) e LIMIT 1), now());
  -- (1) riwayat kedatangan: INSERT sah lolos; jenis liar ditolak; koreksi tanpa alasan ditolak; koreksi beralasan lolos
  INSERT INTO goods_receipt_events (id, goods_receipt_id, type) VALUES (ev, g, 'KEDATANGAN_DICATAT'); lolos := lolos + 1;
  BEGIN INSERT INTO goods_receipt_events (id, goods_receipt_id, type) VALUES (gen_random_uuid(), g, 'LAIN'); RAISE EXCEPTION 'TIDAK_DITOLAK_jenis';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO goods_receipt_events (id, goods_receipt_id, type) VALUES (gen_random_uuid(), g, 'KEDATANGAN_DIKOREKSI'); RAISE EXCEPTION 'TIDAK_DITOLAK_alasan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO goods_receipt_events (id, goods_receipt_id, type, reason) VALUES (ev2, g, 'KEDATANGAN_DIKOREKSI', 'Salah ketik tanggal'); lolos := lolos + 1;
  -- (2) APPEND-ONLY: UPDATE dan DELETE ditolak
  BEGIN UPDATE goods_receipt_events SET reason = 'ubah' WHERE id = ev; RAISE EXCEPTION 'TIDAK_DITOLAK_update';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM goods_receipt_events WHERE id = ev; RAISE EXCEPTION 'TIDAK_DITOLAK_delete';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  -- (3) kedatangan pada penerimaan: tanggal tanpa pasangan ditolak; lengkap lolos; workspace liar ditolak
  BEGIN UPDATE goods_receipts SET arrived_date = current_date WHERE id = g; RAISE EXCEPTION 'TIDAK_DITOLAK_pasangan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE goods_receipts SET arrived_date = current_date, arrival_recorded_at = now(), arrival_revision = 1, arrival_receiver = 'Uji', arrival_note = 'x', arrival_workspace = 'LAIN' WHERE id = g; RAISE EXCEPTION 'TIDAK_DITOLAK_workspace';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  UPDATE goods_receipts SET arrived_date = current_date, arrival_recorded_at = now(), arrival_revision = 1, arrival_receiver = 'Uji', arrival_note = 'x', arrival_workspace = 'GUDANG' WHERE id = g; lolos := lolos + 1;
  -- (4) baris penerimaan: pendamping negatif ditolak; pengganti menunjuk diri sendiri ditolak; pengganti ke baris asal lolos
  SELECT id INTO mat FROM materials LIMIT 1;
  IF mat IS NULL THEN lewat := lewat + 1; ELSE
    INSERT INTO goods_receipt_lines (id, goods_receipt_id, material_id) VALUES (ln, g, mat);
    BEGIN UPDATE goods_receipt_lines SET companion_qty = -1 WHERE id = ln; RAISE EXCEPTION 'TIDAK_DITOLAK_pendamping';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
    BEGIN UPDATE goods_receipt_lines SET replacement_for_line_id = ln WHERE id = ln; RAISE EXCEPTION 'TIDAK_DITOLAK_pengganti_diri';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
    INSERT INTO goods_receipt_lines (id, goods_receipt_id, material_id, replacement_for_line_id, companion_qty) VALUES (gen_random_uuid(), g, mat, ln, 1.5); lolos := lolos + 1;
  END IF;
  -- (5) term_chk: nilai liar ditolak; TANGGAL_TIBA diterima (pada faktur contoh bila ada)
  SELECT id::text INTO b FROM fin_supplier_bills LIMIT 1;
  IF b IS NULL THEN lewat := lewat + 1; ELSE
    BEGIN UPDATE fin_supplier_bills SET term_basis = 'LAIN' WHERE id::text = b; RAISE EXCEPTION 'TIDAK_DITOLAK_term_liar';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
    BEGIN UPDATE fin_supplier_bills SET term_basis = 'TANGGAL_TIBA' WHERE id::text = b; lolos := lolos + 1;
    EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'TANGGAL_TIBA_DITOLAK'; END;
  END IF;
  RAISE NOTICE 'HASIL tolak=% lolos=% lewat=%', tolak, lolos, lewat;
  RAISE EXCEPTION 'ROLLBACK_UJI';
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK|TANGGAL_TIBA_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint/trigger SALAH (ada data salah yang lolos, atau TANGGAL_TIBA ditolak)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*HASIL tolak=\([0-9]*\) lolos=\([0-9]*\) lewat=\([0-9]*\).*/\1/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 8 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti terlalu sedikit (${UJI_TOLAK:-?}; minimal 8) — constraint/trigger tidak aktif atau data contoh kurang"; }
ok "perilaku terbukti di DB rehearsal: $(printf '%s\n' "$UJI_OUT" | sed -n 's/.*HASIL \(.*\)/\1/p' | sed -n 1p) — append-only menolak UPDATE/DELETE; data salah ditolak, data benar lolos; TANGGAL_TIBA diterima; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from goods_receipts where receipt_number='GR-UJI-REHEARSAL'")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
for T in $KUNCI_TABEL; do
  A="$(psql_live -At -c "select count(*) from $T")"; B="$(RPSQL "select count(*) from $T")"
  [ "$A" = "$B" ] || { reh_drop; die "jumlah baris $T berubah oleh migrasi rehearsal (produksi=$A rehearsal=$B)"; }
done
reh_drop
ok "rehearsal lulus: isi 17 tabel lama IDENTIK sebelum vs sesudah migrasi + uji perilaku (sidik jari baris penuh tanpa kolom baru); kolom baru kosong; DB sementara dihapus"

PHASE="6-migrate"; say "6. Migrasi aditif (image baru; backend lama tetap melayani)"
psql_live -At -c "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" > "$BK_DIR/applied-sebelum.txt" || die "gagal membaca migrasi terpasang"
grep -Fx "$MIG" "$BK_DIR/applied-sebelum.txt" >/dev/null && die "migrasi ${MIG} SUDAH terpasang sebelum rilis (tidak diharapkan)"
PENDING="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(LC_ALL=C sort "$BK_DIR/applied-sebelum.txt") || true)"
[ "$PENDING" = "$MIG" ] || die "migrasi pending bukan tepat ${MIG}: $(printf '%s' "$PENDING" | tr '\n' ' ')"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy </dev/null || die "migrate deploy GAGAL; backend baru TIDAK dinyalakan (backend lama tetap melayani)"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null")" = "0" ] || die "ada migrasi setengah jalan; JANGAN switch"
psql_live -At -c "select finished_at is not null from _prisma_migrations where migration_name='${MIG}'" | grep -Fx t >/dev/null || die "${MIG} tidak tercatat selesai"
[ "$(psql_live -At -c "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null")" = "$(( $(wc -l < "$BK_DIR/applied-sebelum.txt") + 1 ))" ] || die "jumlah migrasi terpasang != sebelum + 1"
ok "migrasi diterapkan: ${MIG}; tidak ada yang menggantung"
curl -fsS --max-time 8 "${INTERNAL_URL}/api/health" | grep '"ok":true' >/dev/null || die "backend lama tidak sehat setelah migrasi (aditif, tidak diharapkan)"
ok "backend lama tetap sehat setelah migrasi aditif"

PHASE="7-switch"; say "7. Switch backend ke release baru (SATU kali)"
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
[ "$NBE" -ge 15 ] || die "terlalu sedikit berkas backend yang diverifikasi (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
[ "$(PSQLN "select count(*) from information_schema.tables where table_schema='public' and table_name='goods_receipt_events'")" = "1" ] || die "tabel goods_receipt_events tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_trigger where tgname='trg_goods_receipt_events_append_only' and not tgisinternal")" = "1" ] || die "trigger append-only tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from goods_receipts where arrival_revision <> 0 or arrived_date is not null")" = "0" ] || die "ADA penerimaan dengan kedatangan tercatat setelah rilis (backfill tidak diizinkan)"
[ "$(PSQLN "select count(*) from fin_supplier_bills where term_basis='TANGGAL_TIBA'")" = "0" ] || die "ADA faktur TANGGAL_TIBA setelah rilis (belum ada yang boleh)"
[ "$(PSQLN "select count(*) from goods_receipt_lines where replacement_for_line_id is not null or companion_qty is not null")" = "0" ] || die "ADA baris penerimaan berpendamping/pengganti setelah rilis (backfill tidak diizinkan)"
[ "$(PSQLN "select count(*) from goods_receipt_events")" = "0" ] || die "riwayat kedatangan tidak kosong setelah rilis"
ok "tabel/trigger ada; TIDAK ada kedatangan, faktur TANGGAL_TIBA, pendamping, pengganti, atau riwayat (tanpa backfill; data baru hanya lahir dari pemakaian)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
[ -d "$PERSIST/backend/data/receipt-proofs" ] || die "folder bukti kedatangan (${PERSIST}/backend/data/receipt-proofs) tidak terbentuk di root persisten"
ok "folder bukti kedatangan ada di root persisten; migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test izin + pembacaan (baca-saja; TIDAK ada PO/penerimaan/draf/transaksi QA di produksi)"
dcp "$NEW_DIR" exec -T backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const tokenUntuk = async (user) => {
  const roles = (await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } })).map((r) => r.role);
  return jwt.sign({ id: user.id, name: user.name, role: user.role, roles: roles.length ? roles : [user.role] }, process.env.JWT_SECRET, { expiresIn: "10m" });
};
const FIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) {
    const rs = new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
    if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u;
  }
  return null;
}
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", FIN);
const gudang = await userDengan("WAREHOUSE", new Set());
if (!adm || !sales || !gudang) { rec("akun ADMIN, SALES murni, dan WAREHOUSE tersedia", false, `adm=${!!adm} sales=${!!sales} gudang=${!!gudang}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales), tG = await tokenUntuk(gudang);
const nol = "00000000-0000-4000-8000-000000000000";
const cacah = async () => [await prisma.goodsReceipt.count(), await prisma.goodsReceiptLine.count(), await prisma.goodsReceiptEvent.count(), await prisma.finPurchaseOrder.count(), await prisma.finPurchaseOrderLine.count(), await prisma.finSupplierBill.count(), await prisma.stockMovement.count(), await prisma.finJournalEntry.count(), await prisma.finJournalLine.count(), await prisma.finSupplierPayment.count()];
const sebelum = await cacah();
const KUNCI_HARGA = ["hargaSatuan", "unitPrice", "nilaiDipesan", "nilaiMasukStok", "totalDipesan", "totalMasukStok", "termin", "jatuhTempo", "faktur", "utang", "pembayaran"];

rec("Barang Akan Datang (Gudang): tanpa token -> 401", (await api("GET", "/api/inventory/barang-akan-datang")).status === 401);
rec("Barang Akan Datang (Gudang): SALES -> 403", (await api("GET", "/api/inventory/barang-akan-datang", tS)).status === 403);
const bad = await api("GET", "/api/inventory/barang-akan-datang", tG);
rec("Barang Akan Datang (Gudang) -> 200 berisi daftar PO", bad.status === 200 && Array.isArray(bad.json?.purchaseOrders) && bad.json?.hitungan && typeof bad.json.hitungan === "object", `${bad.json?.purchaseOrders?.length} PO`);
const mentah = JSON.stringify(bad.json ?? {});
rec("tampilan Gudang TIDAK memuat harga/nilai/termin/faktur/utang/pembayaran", !KUNCI_HARGA.some((k) => mentah.includes(`"${k}"`)), KUNCI_HARGA.filter((k) => mentah.includes(`"${k}"`)).join(","));
const baris = bad.json?.purchaseOrders ?? [];
rec("tiap PO punya progres server (10 angka) dan definisi", baris.every((p) => p.progres && Array.isArray(p.progresDefinisi) && p.progresDefinisi.length === 10 && p.lines.every((l) => ["dipesan", "datang", "belumDatang", "belumDiperiksa", "ditolak", "menungguPengganti", "baikBelumDisimpan", "masukStok", "belumDipenuhiSupplier", "belumMasukStok"].every((k) => typeof l[k] === "number"))), `${baris.length} PO`);
rec("PO lama: tidak ada kedatangan tercatat; semua baris 'Tanggal belum ditetapkan'/menunggu — tidak ditebak", baris.every((p) => p.penerimaan.every((r) => r.kedatanganDicatat === false)), `${baris.reduce((n, p) => n + p.penerimaan.length, 0)} penerimaan`);
rec("detail PO id tak dikenal (Gudang) -> 404", (await api("GET", `/api/inventory/barang-akan-datang/${nol}`, tG)).status === 404);
const fin = await api("GET", "/api/finance/purchase-orders/kedatangan", tA);
rec("Finance: kedatangan semua PO (admin) -> 200", fin.status === 200 && Array.isArray(fin.json?.purchaseOrders), `${fin.json?.purchaseOrders?.length} PO`);
rec("Finance: kedatangan semua PO — SALES -> 403, tanpa token -> 401", (await api("GET", "/api/finance/purchase-orders/kedatangan", tS)).status === 403 && (await api("GET", "/api/finance/purchase-orders/kedatangan")).status === 401);
// Penulisan: harus ditolak izin/idempotensi TANPA menulis apa pun.
rec("catat tiba (Gudang) tanpa token -> 401", (await api("POST", `/api/inventory/barang-akan-datang/${nol}/kedatangan`, null, { x: 1 }, { "Idempotency-Key": "smoke-poti-anon" })).status === 401);
rec("catat tiba (Gudang) SALES -> 403", (await api("POST", `/api/inventory/barang-akan-datang/${nol}/kedatangan`, tS, { x: 1 }, { "Idempotency-Key": "smoke-poti-sales-g" })).status === 403);
rec("draf penerimaan (Gudang) SALES -> 403; tanpa token -> 401", (await api("POST", `/api/inventory/barang-akan-datang/${nol}/draf-penerimaan`, tS)).status === 403 && (await api("POST", `/api/inventory/barang-akan-datang/${nol}/draf-penerimaan`)).status === 401);
rec("catat tiba (Finance) SALES -> 403; draf penerimaan (Finance) SALES -> 403", (await api("POST", `/api/finance/purchase-orders/${nol}/kedatangan`, tS, { x: 1 }, { "Idempotency-Key": "smoke-poti-sales-f" })).status === 403 && (await api("POST", `/api/finance/purchase-orders/${nol}/draf-penerimaan`, tS)).status === 403);
rec("koreksi kedatangan SALES -> 403", (await api("POST", `/api/inventory/barang-akan-datang/penerimaan/${nol}/koreksi`, tS, { alasan: "uji" }, { "Idempotency-Key": "smoke-poti-sales-k" })).status === 403);
rec("catat tiba (admin) tanpa Idempotency-Key -> 428 (ditolak sebelum menulis)", (await api("POST", `/api/finance/purchase-orders/${nol}/kedatangan`, tA, { x: 1 })).status === 428);
// Aging & umur utang memakai jadwal per penerimaan; pada data lama (tanpa TANGGAL_TIBA) hasilnya sama dengan sebelumnya.
const ag = await api("GET", "/api/finance/utang/aging", tA);
rec("aging utang (admin) -> 200 dengan kartu ringkasan", ag.status === 200 && typeof ag.json?.ringkasan?.kartu?.totalUtangAktif === "number", `total aktif ${ag.json?.ringkasan?.kartu?.totalUtangAktif}`);
rec("aging utang: faktur lama tetap SATU baris tiap faktur (belum ada jadwal per penerimaan)", ag.json?.baris?.every((b) => !b.jadwal) && new Set(ag.json.baris.map((b) => b.billId)).size === ag.json.baris.length, `${ag.json?.baris?.length} baris`);
const um = await api("GET", "/api/finance/reports/payables", tA);
rec("umur utang (admin) -> 200", um.status === 200 && typeof um.json?.total === "number", `total ${um.json?.total}`);
console.log(`  INFO  umur utang total=${um.json?.total} vs aging total aktif=${ag.json?.ringkasan?.kartu?.totalUtangAktif} (data lama: dihitung per faktur, dua angka itu lazimnya sama)`);
const sesudah = await cacah();
rec("tidak ada penerimaan/baris/riwayat/PO/faktur/stok/jurnal/pembayaran yang berubah selama smoke (termasuk TIDAK ada draf penerimaan baru)", sebelum.every((n, i) => n === sesudah[i]), `${sebelum.join(",")} -> ${sesudah.join(",")}`);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus (izin Gudang/Finance/Sales, Gudang tanpa harga, penulisan ditolak tanpa efek, aging & umur utang data lama, tidak ada data berubah)"
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
dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$FP_SQL" </dev/null | LC_ALL=C sort > "$BK_DIR/data-sesudah.txt" || die "sidik jari data sesudah gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-sesudah.txt" || true; die "isi tabel lama berubah selama rilis — periksa (transaksi pengguna yang sah juga bisa menyebabkan ini; bandingkan dengan backup)"; }
ok "isi 17 tabel lama (penerimaan, PO, faktur, pembayaran, stok, jurnal, order, payment…) IDENTIK sebelum vs sesudah rilis"
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
