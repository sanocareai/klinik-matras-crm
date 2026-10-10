#!/usr/bin/env bash
# RILIS "RETUR SUPPLIER & DEBIT NOTE" (retur untuk kredit, Debit Note, saldo kredit supplier, progres Diterima bersih dari PO): web + backend + 1 migrasi ADITIF —
# workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   20261102090000_retur_supplier_debit_note : 3 nilai enum baru + 1 kolom fin_supplier_bills.credit_applied (NOT NULL DEFAULT 0, CHECK) + 6 tabel baru
#                                              + 1 fungsi/trigger pengaman penerimaan (hanya SELECT + RAISE; menolak ubah jumlah baris penerimaan yang punya retur KELUAR/SELESAI).
# TANPA backfill/UPDATE/DELETE: PO, penerimaan, stok, jurnal, faktur, pembayaran yang sudah ada TIDAK berubah. Fitur tidak punya sakelar: dampaknya baru ada setelah pengguna membuat retur.
# Produksi: verifikasi hanya baca + penolakan izin; TIDAK ada retur/PO/transaksi QA. Uji perilaku constraint/trigger dijalankan di DB REHEARSAL (hasil restore backup), bukan di produksi.
#
#   cat scripts/release-retur-supplier.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/reti1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/reti1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/reti1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/reti1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode HANYA boleh di-rollback bila belum ada retur keluar / debit note / saldo kredit. Periksa dulu dengan scripts/rollback-guard-retur-supplier.sh (baca-saja; menolak bila ada data baru).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/retur-supplier-debit-note}"
# Migrasi aditif yang SUDAH diaudit: nama → sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIG="20261102090000_retur_supplier_debit_note"
MIG_PIN="785d52368e0e039f28eddebac2f1512f011f44cce6326d77bccfa1a866d8a508"
# Hasil pemindai untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":52,"enum_value":3,"alter_add_column":1,"check_existing":1,"create_table":6,"create_index":18,"fk":15,"check_new":6,"fungsi":1,"trigger":1}'
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261102090000_retur_supplier_debit_note/migration\.sql|backend/prisma/schema\.prisma|backend/src/index\.js|backend/src/lib/activityLog\.js|backend/src/routes/financeTransactions\.js|backend/src/routes/financeUtang\.js|backend/src/routes/returSupplier\.js|backend/src/services/finance/agingUtang\.js|backend/src/services/finance/biayaBahanSumber\.js|backend/src/services/finance/kedatangan\.js|backend/src/services/finance/posting/inventory\.js|backend/src/services/finance/posting/supplier\.js|backend/src/services/finance/progresPO\.js|backend/src/services/finance/purchaseOrder\.js|backend/src/services/finance/purchaseOrderBill\.js|backend/src/services/finance/reports\.js|backend/src/services/finance/returSupplier\.js|backend/src/services/finance/supplierRead\.js|backend/src/services/finance/transaksi\.js|backend/src/services/inventoryLedger\.js|backend/tests/integration/poTerintegrasi\.integration\.test\.js|backend/tests/integration/returSupplier\.integration\.test\.js|backend/tests/integration/returSupplierFinal\.integration\.test\.js|backend/tests/integration/setup/testApp\.js|docs/FINANCE-EXPORT-COVERAGE\.md|docs/RETUR-SUPPLIER-DEBIT-NOTE\.md|frontend/src/api\.js|frontend/src/components/Layout\.jsx|frontend/src/components/Topbar\.jsx|frontend/src/features/kedatangan/PanelKedatangan\.jsx|frontend/src/features/portal/divisionContent\.js|frontend/src/features/returSupplier/ReturSupplierWorkspace\.jsx|frontend/src/features/returSupplier/returLogic\.js|frontend/src/features/warehouse/components/JejakPemakaianPenerimaan\.jsx|frontend/src/features/warehouse/inventoryReal\.js|frontend/src/pages/finance/FinancePurchaseOrders\.jsx|frontend/src/pages/finance/FinanceReturSupplier\.jsx|frontend/src/pages/warehouse/WarehouseReturSupplier\.jsx|frontend/src/routes/pageRegistry\.jsx|frontend/tests/financeDetailCoverage\.test\.js|frontend/tests/financeExportCoverage\.test\.js|frontend/tests/returSupplierUI\.test\.js|scripts/release-retur-supplier\.sh|scripts/rollback-guard-retur-supplier\.sh)$'
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
BK_DIR="$HOME/release-backups/retur-${DEPLOY_SHORT}-${TS}"
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
   bash ${NEW_DIR}/scripts/rollback-guard-retur-supplier.sh
Guard menolak (exit 1) bila SUDAH ADA data yang hanya dipahami kode baru:
   - retur supplier dengan barang sudah keluar (status KELUAR/SELESAI) dan pergerakan stok SUPPLIER_RETURN,
   - debit note (menunggu/disetujui), saldo kredit supplier dan pemakaiannya, faktur dengan credit_applied > 0,
   - jurnal sumber RETUR_SUPPLIER / DEBIT_NOTE_SUPPLIER.
   Kode lama TIDAK mengenal kredit pada faktur: sisa utang/aging/pelunasan menjadi salah, dan rata-rata harga bahan menghitung barang yang sudah diretur.
   Bila guard menolak: JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau rencanakan koreksi DATA (batalkan debit note/pemakaian kredit/retur lewat aplikasi) dengan backup dan persetujuan Owner.
Bila guard lulus (belum ada data baru), rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi hanya MENAMBAH nilai enum/kolom/tabel/constraint/trigger: dibiarkan terpasang pun aman bagi kode lama SELAMA belum ada data baru. (Tidak dihapus oleh rollback kode.)
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
exec 9>/tmp/release-retur-supplier.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "reti1\|release-retur-supplier\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
SCAN="$BK_DIR/scan-migrasi.mjs"
cat > "$SCAN" <<'SCANJS'
// Pemindai migrasi "Retur Supplier & Debit Note" (dijalankan di VPS oleh skrip rilis; juga dijalankan lokal terhadap berkas migrasi). FAIL-CLOSED, daftar putih per pernyataan.
//  (a) SATU fungsi plpgsql fn_goods_receipt_line_terkunci_retur: badan HANYA membaca (SELECT dari supplier_return_lines/supplier_returns) lalu RAISE EXCEPTION atau RETURN NEW; tanpa INSERT/UPDATE/DELETE/DROP/...
//  (b) SATU trigger BEFORE UPDATE OF kolom-jumlah pada goods_receipt_lines yang memanggil fungsi itu,
//  (c) ALTER TYPE ... ADD VALUE hanya untuk 3 nilai enum yang diaudit,
//  (d) SATU ALTER TABLE fin_supplier_bills ADD COLUMN credit_applied (NOT NULL DEFAULT 0) + satu CHECK-nya,
//  (e) CREATE TABLE hanya untuk 6 tabel baru (+ indeks pada tabel baru itu saja; FK hanya DARI tabel baru),
//  (f) CHECK pada tabel baru dengan nama yang diaudit, tanpa subquery.
// Tidak ada DROP/UPDATE/INSERT/DELETE/TRUNCATE/RENAME/ALTER COLUMN, tidak ada indeks/FK/kolom baru pada tabel yang sudah ada selain kolom credit_applied.
import fs from "node:fs";
let sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const hitung = {};
const tambah = (k) => { hitung[k] = (hitung[k] ?? 0) + 1; };
const gagal = (m) => { console.error(m); process.exit(1); };
const TABEL_BARU = new Set(["supplier_returns", "supplier_return_lines", "fin_supplier_debit_notes", "fin_supplier_debit_note_lines", "fin_supplier_credits", "fin_supplier_credit_applications"]);
const REF_OK = new Set([...TABEL_BARU, "fin_suppliers", "fin_purchase_orders", "goods_receipt_lines", "fin_purchase_order_lines", "materials", "fin_supplier_bills"]);
const ENUM_OK = { StockMovementType: ["SUPPLIER_RETURN"], FinJournalSource: ["RETUR_SUPPLIER", "DEBIT_NOTE_SUPPLIER"] };
const CHECK_NEW_OK = new Set(["supplier_returns_status_chk", "supplier_return_lines_qty_chk", "fin_supplier_debit_notes_chk", "fin_supplier_debit_note_lines_chk", "fin_supplier_credits_chk", "fin_supplier_credit_applications_chk"]);
const FN_RE = /CREATE FUNCTION fn_goods_receipt_line_terkunci_retur\(\) RETURNS trigger AS \$fn\$([\s\S]*?)\$fn\$ LANGUAGE plpgsql;/g;
const fungsi = [...sql.matchAll(FN_RE)];
if (fungsi.length !== 1) gagal(`jumlah fungsi fn_goods_receipt_line_terkunci_retur harus tepat 1 (ditemukan ${fungsi.length})`);
const badan = fungsi[0][1].replace(/'(?:[^']|'')*'/g, "''");
if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXECUTE|PERFORM|GRANT|REVOKE|COPY|SET|CALL|DO)\b/i.test(badan)) gagal("badan fungsi memuat perintah menulis/DDL di luar daftar putih");
if ((badan.match(/RAISE EXCEPTION/g) ?? []).length !== 1 || (badan.match(/\bRETURN NEW\b/g) ?? []).length !== 1) gagal("badan fungsi harus memuat tepat satu RAISE EXCEPTION dan satu RETURN NEW");
if ((badan.match(/\bSELECT\b/gi) ?? []).length !== 1) gagal("badan fungsi harus memuat tepat satu SELECT");
for (const t of [...badan.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)].map((x) => x[1].toLowerCase())) if (!["supplier_return_lines", "supplier_returns"].includes(t)) gagal(`fungsi membaca tabel di luar daftar putih: ${t}`);
if (/\$[a-z_]*\$/i.test(badan)) gagal("badan fungsi memuat dollar-quote bersarang");
tambah("fungsi");
sql = sql.replace(FN_RE, "");
const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
const dilihat = { tabel: new Set(), indeks: new Set(), constraint: new Set(), enum: new Set() };
const unik = (jenis, nama) => { if (dilihat[jenis].has(nama)) gagal(`${jenis} duplikat: ${nama}`); dilihat[jenis].add(nama); };
for (const st of stmts) {
  const r = rapat(st);
  let m;
  if ((m = /^ALTER TYPE "([A-Za-z]+)" ADD VALUE '([A-Z_]+)'$/.exec(r))) {
    if (!ENUM_OK[m[1]]?.includes(m[2])) gagal(`nilai enum di luar daftar putih: ${m[1]}.${m[2]}`);
    unik("enum", `${m[1]}.${m[2]}`); tambah("enum_value"); continue;
  }
  if (r === 'ALTER TABLE "fin_supplier_bills" ADD COLUMN "credit_applied" DECIMAL(18,2) NOT NULL DEFAULT 0') { tambah("alter_add_column"); continue; }
  if (r === 'ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_credit_applied_chk" CHECK ("credit_applied" >= 0 AND "credit_applied" <= "amount")') { unik("constraint", "fin_supplier_bills_credit_applied_chk"); tambah("check_existing"); continue; }
  if ((m = /^CREATE TABLE "([a-z_]+)" \((.+)\)$/.exec(r))) {
    if (!TABEL_BARU.has(m[1])) gagal(`CREATE TABLE di luar daftar putih: ${m[1]}`);
    unik("tabel", m[1]);
    if (!new RegExp(`CONSTRAINT "${m[1]}_pkey" PRIMARY KEY \\("id"\\)`).test(m[2])) gagal(`tabel ${m[1]} tanpa primary key standar`);
    if (/\b(REFERENCES|UNIQUE|GENERATED|SERIAL|CHECK)\b/i.test(m[2])) gagal(`CREATE TABLE ${m[1]} memuat klausa di luar daftar putih`);
    const semuaDefault = (m[2].match(/\bDEFAULT\b/g) ?? []).length;
    const defaultOk = (m[2].match(/\bDEFAULT ('[A-Z]+'|ARRAY\[\]::TEXT\[\]|CURRENT_TIMESTAMP|0)(?![A-Za-z0-9_])/g) ?? []).length;
    if (semuaDefault !== defaultOk) gagal(`CREATE TABLE ${m[1]} memuat DEFAULT di luar daftar putih`);
    tambah("create_table"); continue;
  }
  if ((m = /^CREATE (UNIQUE )?INDEX "([a-z_]+)" ON "([a-z_]+)"\(("[a-z_]+"(?:, "[a-z_]+")*)\)( WHERE "status" <> 'DIBATALKAN')?$/.exec(r))) {
    if (!TABEL_BARU.has(m[3])) gagal(`indeks pada tabel di luar tabel baru: ${m[3]}`);
    if (m[5] && !m[1]) gagal(`indeks parsial harus UNIQUE: ${m[2]}`);
    unik("indeks", m[2]); tambah("create_index"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+_fkey)" FOREIGN KEY \("[a-z_]+"\) REFERENCES "([a-z_]+)"\("id"\) ON DELETE (RESTRICT|CASCADE) ON UPDATE CASCADE$/.exec(r))) {
    if (!TABEL_BARU.has(m[1])) gagal(`FK dari tabel di luar tabel baru: ${m[1]}`);
    if (!REF_OK.has(m[3])) gagal(`FK ke tabel di luar daftar putih: ${m[3]}`);
    unik("constraint", m[2]); tambah("fk"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+)" CHECK \((.+)\)$/.exec(r))) {
    if (!TABEL_BARU.has(m[1])) gagal(`CHECK pada tabel di luar tabel baru: ${m[1]}`);
    if (!CHECK_NEW_OK.has(m[2])) gagal(`CHECK dengan nama di luar yang diaudit: ${m[2]}`);
    if (/\b(SELECT|FROM|INSERT|UPDATE|DELETE)\b/i.test(m[3])) gagal(`CHECK memuat subquery/perintah menulis: ${m[2]}`);
    unik("constraint", m[2]); tambah("check_new"); continue;
  }
  if (r === 'CREATE TRIGGER trg_goods_receipt_line_terkunci_retur BEFORE UPDATE OF "received_qty", "accepted_qty", "rejected_qty", "purchase_order_line_id", "material_id", "goods_receipt_id" ON "goods_receipt_lines" FOR EACH ROW EXECUTE FUNCTION fn_goods_receipt_line_terkunci_retur()') { tambah("trigger"); continue; }
  gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
}
if (dilihat.tabel.size !== TABEL_BARU.size) gagal(`tabel baru harus tepat ${TABEL_BARU.size} (ada ${dilihat.tabel.size})`);
console.log(JSON.stringify({ total: stmts.length + 1, enum_value: 0, alter_add_column: 0, check_existing: 0, create_table: 0, create_index: 0, fk: 0, check_new: 0, fungsi: 0, trigger: 0, ...hitung }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$MIGSQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (3 nilai enum, 1 kolom + CHECK pada fin_supplier_bills, 6 tabel baru, 18 indeks, 15 FK, 6 CHECK, 1 fungsi baca-saja + 1 trigger); tanpa DROP, UPDATE, INSERT, DELETE, ALTER COLUMN"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$MIGSQL" "$1"; }
harus_ditolak "DROP TABLE tabel lama" "$(tambah_stmt 'DROP TABLE "fin_supplier_bills";')"
harus_ditolak "UPDATE tabel lama (backfill)" "$(tambah_stmt 'UPDATE "fin_supplier_bills" SET "credit_applied" = 0;')"
harus_ditolak "DELETE tabel lama" "$(tambah_stmt 'DELETE FROM "stock_movements";')"
harus_ditolak "INSERT tabel lama" "$(tambah_stmt "INSERT INTO \"fin_settings\" (\"key\", \"value\") VALUES ('x', 'y');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "fin_journal_lines";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "fin_supplier_bills" DROP COLUMN "amount";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "fin_supplier_bills" ALTER COLUMN "amount" TYPE DECIMAL(20,2);')"
harus_ditolak "kolom baru di tabel lama selain credit_applied" "$(tambah_stmt 'ALTER TABLE "stock_movements" ADD COLUMN "x" TEXT;')"
harus_ditolak "nilai enum di luar daftar" "$(tambah_stmt "ALTER TYPE \"StockMovementType\" ADD VALUE 'LAIN';")"
harus_ditolak "enum pada tipe lain" "$(tambah_stmt "ALTER TYPE \"OrderStatus\" ADD VALUE 'SUPPLIER_RETURN';")"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "stock_movements"("created_at");')"
harus_ditolak "FK dari tabel lama" "$(tambah_stmt 'ALTER TABLE "stock_movements" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "CHECK dengan nama tak diaudit" "$(tambah_stmt 'ALTER TABLE "supplier_returns" ADD CONSTRAINT "evil_chk" CHECK (true);')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "fin_supplier_bills" TO PUBLIC;')"
harus_ditolak "trigger kedua pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION fn_goods_receipt_line_terkunci_retur();')"
harus_ditolak "fungsi menulis (DELETE di badan)" "$(printf '%s\n' "$MIGSQL" | sed 's/  RETURN NEW;/  DELETE FROM supplier_returns; RETURN NEW;/')"
harus_ditolak "fungsi membaca tabel lain" "$(printf '%s\n' "$MIGSQL" | sed 's/FROM supplier_return_lines rl JOIN supplier_returns r/FROM supplier_return_lines rl JOIN stock_movements r/')"
harus_ditolak "fungsi tanpa RAISE" "$(printf '%s\n' "$MIGSQL" | sed 's/    RAISE EXCEPTION .*$/    NULL;/')"
harus_ditolak "nilai enum diubah" "$(printf '%s\n' "$MIGSQL" | sed "s/'SUPPLIER_RETURN';/'SUPPLIER_RETURNX';/")"
harus_ditolak "nama CHECK diganti" "$(printf '%s\n' "$MIGSQL" | sed 's/"supplier_returns_status_chk"/"supplier_returns_evil_chk"/')"
harus_ditolak "FK ke tabel di luar daftar" "$(printf '%s\n' "$MIGSQL" | sed 's/REFERENCES "fin_suppliers"("id")/REFERENCES "Customer"("id")/')"
harus_ditolak "satu indeks hilang (hitungan beda)" "$(printf '%s\n' "$MIGSQL" | grep -v 'supplier_returns_status_idx')"
harus_ditolak "default liar pada tabel baru" "$(printf '%s\n' "$MIGSQL" | sed "s/\"decision\" VARCHAR(20) NOT NULL DEFAULT 'KREDIT',/\"decision\" VARCHAR(20) NOT NULL DEFAULT now(),/")"
harus_ditolak "kolom credit_applied tanpa default" "$(printf '%s\n' "$MIGSQL" | sed 's/"credit_applied" DECIMAL(18,2) NOT NULL DEFAULT 0;/"credit_applied" DECIMAL(18,2) NOT NULL;/')"
[ "$NEG" -ge 22 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 22)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER COLUMN/kolom-indeks-FK di tabel lama/enum liar/GRANT/trigger liar/fungsi menulis/hitungan beda) SEMUANYA ditolak"
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
# Prasyarat skema: tabel yang disentuh harus sudah ada; objek rilis ini belum boleh ada.
for T in goods_receipts goods_receipt_lines goods_receipt_events fin_purchase_orders fin_purchase_order_lines fin_supplier_bills fin_supplier_bill_allocations fin_suppliers materials stock_movements; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
for T in supplier_returns supplier_return_lines fin_supplier_debit_notes fin_supplier_debit_note_lines fin_supplier_credits fin_supplier_credit_applications; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "0" ] || die "tabel $T SUDAH ada di produksi (tidak diharapkan)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='fin_supplier_bills' and column_name='credit_applied'")" = "0" ] || die "kolom credit_applied SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_proc where proname='fn_goods_receipt_line_terkunci_retur'")" = "0" ] || die "fungsi pengaman retur SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid where (t.typname='StockMovementType' and e.enumlabel='SUPPLIER_RETURN') or (t.typname='FinJournalSource' and e.enumlabel in ('RETUR_SUPPLIER','DEBIT_NOTE_SUPPLIER'))")" = "0" ] || die "nilai enum rilis ini SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from stock_movements where type::text = 'SUPPLIER_RETURN'" 2>/dev/null || echo 0)" = "0" ] || die "sudah ada pergerakan SUPPLIER_RETURN sebelum rilis"
GR_N="$(psql_live -At -c "select count(*) from goods_receipts")"; PO_N="$(psql_live -At -c "select count(*) from fin_purchase_orders")"; BILL_N="$(psql_live -At -c "select count(*) from fin_supplier_bills")"
[ "$BILL_N" -gt 0 ] && [ "$PO_N" -gt 0 ] || die "tidak ada faktur supplier/PO di produksi: uji perilaku rehearsal butuh contoh baris (penolakan terbukti terlalu sedikit) — berhenti"
ok "prasyarat skema terpenuhi; penerimaan=${GR_N}, PO=${PO_N}, faktur supplier=${BILL_N} (semua dibiarkan apa adanya — tanpa backfill)"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel, TANPA kolom yang ditambahkan rilis ini (fin_supplier_bills.credit_applied). Membuktikan restore identik dan migrasi tidak mengubah data lama.
FP_SQL="select 'fin_supplier_bills', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['credit_applied'])::text, '|' order by x.id),'')) from fin_supplier_bills x
union all select 'fin_supplier_bill_po_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bill_po_lines x
union all select 'fin_supplier_bill_allocations', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_bill_allocations x
union all select 'fin_supplier_payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_payments x
union all select 'fin_supplier_payment_allocations', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_supplier_payment_allocations x
union all select 'fin_suppliers', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_suppliers x
union all select 'fin_purchase_orders', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_orders x
union all select 'fin_purchase_order_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_order_lines x
union all select 'goods_receipts', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipts x
union all select 'goods_receipt_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_lines x
union all select 'goods_receipt_events', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_events x
union all select 'stock_movements', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x
union all select 'materials', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from materials x
union all select 'fin_journal_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_entries x
union all select 'fin_journal_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x
union all select 'order', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Order\" x
union all select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x"
# DOKUMEN PEMBANDING DIBEKUKAN: hanya yang menurut aturan bisnis tidak mungkin berubah akibat rilis ini (penerimaan Selesai/Ditolak, PO Selesai/Dibatalkan, faktur Dibatalkan/Ditolak yang sudah diam sebelum T0;
# baris stok dan jurnal yang dibuat sebelum T0 (append-only); saldo per akun dari jurnal itu; seluruh flag fin_settings). T0 = jam DB (UTC) 5 menit lalu. Dokumen terbuka dan transaksi baru TIDAK diperbandingkan.
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'gr_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipts x where x.status in ('COMPLETED','REJECTED') and x.updated_at < '$T0'::timestamp
union all select 'gr_final_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from goods_receipt_lines x where x.goods_receipt_id in (select id from goods_receipts where status in ('COMPLETED','REJECTED') and updated_at < '$T0'::timestamp)
union all select 'po_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_purchase_orders x where x.status in ('SELESAI','DIBATALKAN') and x.updated_at < '$T0'::timestamp
union all select 'bill_final', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['credit_applied'])::text, '|' order by x.id),'')) from fin_supplier_bills x where x.status in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'stok', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from stock_movements x where x.created_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'flag', count(*), md5(coalesce(string_agg(f.key || '=' || f.value, '|' order by f.key),'')) from fin_settings f
FPBEKU
)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "8" ] || die "sidik jari dokumen beku tidak 8 baris"
# PO TERMINAL beku (maks 200) untuk smoke: pembanding invarian progres pada data lama yang tidak mungkin berubah menurut aturan bisnis.
LEGACY_PO_FINAL="$(psql_live -At -c "select coalesce(string_agg(id::text, ',' order by id), '') from (select id from fin_purchase_orders where status in ('SELESAI','DIBATALKAN') and updated_at < '$T0'::timestamp order by id limit 200) s")"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di 8 kelompok); PO terminal beku untuk smoke: $(printf '%s' "$LEGACY_PO_FINAL" | tr ',' '\n' | grep -c .)"

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
BACKUP_FILE="$HOME/backups/pre-retur-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-retur-supplier.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Retur & Debit Note" "Dua keputusan untuk barang bermasalah" "Konfirmasi Barang Keluar" "Pakai saldo kredit" "Diterima bersih dari PO" "Tercatat di riwayat audit"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat fitur: ${s1}"; done
for s2 in "Barang Akan Datang" "Catat Barang Tiba" "Arti tiap angka" "Ajukan Klaim Lunas" "Laporan Biaya Divisi" "Pratinjau PDF" "Rencana Produksi" "Status Produksi" "Perlu konfirmasi Sales"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan fitur rilis sebelumnya: ${s2}"; done
# Label lama yang SENGAJA diganti tidak boleh tersisa (angka itu bukan stok tersedia).
[ -z "$(grep -lF "Stok bersih" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru masih memuat label 'Stok bersih' (harus 'Diterima bersih dari PO')"
if [ "$NEW_INDEX" = "$PREV_INDEX" ]; then die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"; fi
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); 6 teks fitur baru + 9 teks fitur lama ada; label 'Stok bersih' tidak tersisa"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-retur-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_retur_${TS}"
dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -X -q -c "CREATE DATABASE \"${REH_DB}\"" </dev/null || die "gagal membuat DB rehearsal"
reh_drop() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS \"${REH_DB}\"" </dev/null >/dev/null 2>&1 || true; }
gzip -dc "$BACKUP_FILE" | dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -v ON_ERROR_STOP=0 -X -q > "$BK_DIR/restore-rehearsal.log" 2>&1 || true
RPSQL() { dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -At -q -c "$1" </dev/null; }
# Restore dibandingkan dengan DOKUMEN BEKU (kondisi dibekukan sebelum backup), bukan tabel hidup: transaksi sah selama rilis boleh menambah/mengubah dokumen terbuka tanpa menggagalkan rehearsal.
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-prod-beku.txt" || { reh_drop; die "sidik jari dokumen beku produksi gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-prod-beku.txt" || true; reh_drop; die "dokumen pembanding beku BERUBAH selama backup (produksi)"; }
RPSQL "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-beku.txt" || { reh_drop; die "sidik jari dokumen beku rehearsal gagal"; }
cmp -s "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/fp-reh-beku.txt" || true; reh_drop; die "hasil RESTORE berbeda dari dokumen beku produksi (backup/restore bermasalah)"; }
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sebelum.txt" || { reh_drop; die "sidik jari penuh rehearsal gagal"; }
[ "$(grep -c . "$BK_DIR/fp-reh-sebelum.txt")" = "17" ] || { reh_drop; die "sidik jari penuh rehearsal tidak 17 tabel"; }
ok "restore nyata IDENTIK dengan dokumen beku produksi (penerimaan/PO/faktur terminal, stok, jurnal, saldo per akun, flag) — transaksi sah selama rilis tidak diperbandingkan"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$REH_PEND" = "$MIG" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat ${MIG}: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
# Struktur: 6 tabel baru KOSONG; kolom credit_applied NOT NULL DEFAULT 0 dan 0 pada SEMUA baris lama (tanpa backfill); 3 nilai enum; fungsi + trigger tepat satu.
for T in supplier_returns supplier_return_lines fin_supplier_debit_notes fin_supplier_debit_note_lines fin_supplier_credits fin_supplier_credit_applications; do
  [ "$(RPSQL "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || { reh_drop; die "tabel baru $T tidak ada setelah migrasi"; }
  [ "$(RPSQL "select count(*) from $T")" = "0" ] || { reh_drop; die "tabel baru $T TIDAK kosong setelah migrasi"; }
done
[ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and table_name='fin_supplier_bills' and column_name='credit_applied' and is_nullable='NO' and column_default like '0%'")" = "1" ] || { reh_drop; die "credit_applied harus NOT NULL DEFAULT 0"; }
[ "$(RPSQL "select count(*) from fin_supplier_bills where credit_applied <> 0")" = "0" ] || { reh_drop; die "ada faktur lama dengan credit_applied <> 0 setelah migrasi (backfill tidak diizinkan)"; }
[ "$(RPSQL "select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid where (t.typname='StockMovementType' and e.enumlabel='SUPPLIER_RETURN') or (t.typname='FinJournalSource' and e.enumlabel in ('RETUR_SUPPLIER','DEBIT_NOTE_SUPPLIER'))")" = "3" ] || { reh_drop; die "tiga nilai enum baru tidak tepat terpasang"; }
for C in fin_supplier_bills_credit_applied_chk supplier_returns_status_chk supplier_return_lines_qty_chk fin_supplier_debit_notes_chk fin_supplier_debit_note_lines_chk fin_supplier_credits_chk fin_supplier_credit_applications_chk; do
  [ "$(RPSQL "select count(*) from pg_constraint where conname='$C'")" = "1" ] || { reh_drop; die "constraint $C tidak ada tepat satu"; }
done
[ "$(RPSQL "select count(*) from pg_constraint where conname like '%\_fkey' and conrelid::regclass::text in ('supplier_returns','supplier_return_lines','fin_supplier_debit_notes','fin_supplier_debit_note_lines','fin_supplier_credits','fin_supplier_credit_applications')")" = "15" ] || { reh_drop; die "jumlah FK tabel baru bukan 15"; }
[ "$(RPSQL "select count(*) from pg_indexes where schemaname='public' and indexname='fin_supplier_debit_notes_return_aktif_key' and indexdef like '%DIBATALKAN%'")" = "1" ] || { reh_drop; die "indeks unik parsial debit note aktif tidak ada"; }
[ "$(RPSQL "select count(*) from pg_proc where proname='fn_goods_receipt_line_terkunci_retur'")" = "1" ] || { reh_drop; die "fungsi pengaman retur tidak ada tepat satu"; }
[ "$(RPSQL "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname='trg_goods_receipt_line_terkunci_retur' and not t.tgisinternal and c.relname='goods_receipt_lines'")" = "1" ] || { reh_drop; die "trigger pengaman retur tidak ada tepat satu"; }
ok "6 tabel baru kosong; credit_applied NOT NULL DEFAULT 0 dan 0 di semua faktur lama; 3 nilai enum; 7 CHECK; 15 FK; indeks unik parsial; fungsi + trigger pengaman terpasang"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan di akhir): CHECK menolak data salah dan meloloskan data benar; trigger mengunci baris penerimaan yang punya retur KELUAR; indeks unik parsial; enum dapat dipakai.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE
  sup uuid; po uuid; pol uuid; mat uuid; bill uuid; bill_amt numeric;
  g uuid := gen_random_uuid(); ln uuid := gen_random_uuid();
  r1 uuid := gen_random_uuid(); rl1 uuid := gen_random_uuid(); dn1 uuid := gen_random_uuid(); dn2 uuid := gen_random_uuid(); cr uuid := gen_random_uuid();
  tolak int := 0; lolos int := 0; lewat int := 0;
BEGIN
  SELECT id INTO sup FROM fin_suppliers LIMIT 1;
  SELECT id, purchase_order_id, material_id INTO pol, po, mat FROM fin_purchase_order_lines LIMIT 1;
  IF sup IS NULL OR pol IS NULL OR mat IS NULL THEN lewat := lewat + 1; RAISE NOTICE 'HASIL tolak=% lolos=% lewat=%', tolak, lolos, lewat; RAISE EXCEPTION 'ROLLBACK_UJI'; END IF;
  INSERT INTO goods_receipts (id, receipt_number, source_type, updated_at) VALUES (g, 'GR-UJI-RETUR', (SELECT e FROM unnest(enum_range(NULL::"ReceiptSourceType")) e LIMIT 1), now());
  INSERT INTO goods_receipt_lines (id, goods_receipt_id, material_id, purchase_order_line_id, received_qty, accepted_qty) VALUES (ln, g, mat, pol, 5, 5);
  -- (1) supplier_returns: keputusan selain KREDIT, alasan pendek, KELUAR tanpa konfirmasi penyerahan → ditolak; draf sah → lolos
  BEGIN INSERT INTO supplier_returns (id, return_number, supplier_id, purchase_order_id, decision, reason_code, reason, updated_at) VALUES (gen_random_uuid(), 'RTS-UJI-A', sup, po, 'PENGGANTI', 'RUSAK', 'Busa pecah saat dibongkar', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_keputusan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO supplier_returns (id, return_number, supplier_id, purchase_order_id, reason_code, reason, updated_at) VALUES (gen_random_uuid(), 'RTS-UJI-B', sup, po, 'RUSAK', 'xx', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_alasan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO supplier_returns (id, return_number, supplier_id, purchase_order_id, status, reason_code, reason, updated_at) VALUES (gen_random_uuid(), 'RTS-UJI-C', sup, po, 'KELUAR', 'RUSAK', 'Busa pecah saat dibongkar', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_keluar_tanpa_penyerahan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO supplier_returns (id, return_number, supplier_id, purchase_order_id, status, reason_code, reason, updated_at) VALUES (gen_random_uuid(), 'RTS-UJI-D', sup, po, 'DIBATALKAN', 'RUSAK', 'Busa pecah saat dibongkar', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_batal_tanpa_alasan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO supplier_returns (id, return_number, supplier_id, purchase_order_id, reason_code, reason, updated_at) VALUES (r1, 'RTS-UJI-1', sup, po, 'RUSAK', 'Busa pecah saat dibongkar', now()); lolos := lolos + 1;
  -- (2) supplier_return_lines: qty ≤ 0 dan jumlah bagian ≠ qty ditolak; baris sah lolos
  BEGIN INSERT INTO supplier_return_lines (id, return_id, goods_receipt_line_id, purchase_order_line_id, material_id, qty) VALUES (gen_random_uuid(), r1, ln, pol, mat, 0); RAISE EXCEPTION 'TIDAK_DITOLAK_qty_nol';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO supplier_return_lines (id, return_id, goods_receipt_line_id, purchase_order_line_id, material_id, qty, qty_unbilled, qty_billed) VALUES (gen_random_uuid(), r1, ln, pol, mat, 2, 1, 0); RAISE EXCEPTION 'TIDAK_DITOLAK_bagian';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO supplier_return_lines (id, return_id, goods_receipt_line_id, purchase_order_line_id, material_id, qty) VALUES (rl1, r1, ln, pol, mat, 2); lolos := lolos + 1;
  -- (3) TRIGGER PENGUNCI: retur DRAF tidak mengunci; retur KELUAR mengunci jumlah/material/PO baris; kolom lain (note) tetap boleh; retur DIBATALKAN melepas kunci
  UPDATE goods_receipt_lines SET accepted_qty = 4 WHERE id = ln; lolos := lolos + 1;
  UPDATE supplier_returns SET status = 'KELUAR', dispatched_at = now(), return_date = current_date, dispatch_pic = 'Uji PIC' WHERE id = r1; lolos := lolos + 1;
  BEGIN UPDATE goods_receipt_lines SET accepted_qty = 3 WHERE id = ln; RAISE EXCEPTION 'TIDAK_DITOLAK_trigger_accepted';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE goods_receipt_lines SET received_qty = 9 WHERE id = ln; RAISE EXCEPTION 'TIDAK_DITOLAK_trigger_received';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE goods_receipt_lines SET material_id = (SELECT id FROM materials WHERE id <> mat LIMIT 1) WHERE id = ln; RAISE EXCEPTION 'TIDAK_DITOLAK_trigger_material';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; WHEN not_null_violation THEN lewat := lewat + 1; END;
  UPDATE goods_receipt_lines SET notes = 'catatan uji' WHERE id = ln; lolos := lolos + 1;
  UPDATE supplier_returns SET status = 'DIBATALKAN', cancelled_at = now(), cancel_reason = 'Dibatalkan pada uji rehearsal' WHERE id = r1;
  UPDATE goods_receipt_lines SET accepted_qty = 5 WHERE id = ln; lolos := lolos + 1;
  -- (4) debit note: nilai ≤ 0 dan DISETUJUI tanpa persetujuan ditolak; hanya SATU debit note aktif per retur (indeks unik parsial)
  BEGIN INSERT INTO fin_supplier_debit_notes (id, debit_number, supplier_id, return_id, amount, stock_value, updated_at) VALUES (gen_random_uuid(), 'DN-UJI-A', sup, r1, 0, 0, now()); RAISE EXCEPTION 'TIDAK_DITOLAK_dn_nol';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_supplier_debit_notes (id, debit_number, supplier_id, return_id, status, amount, stock_value, updated_at) VALUES (gen_random_uuid(), 'DN-UJI-B', sup, r1, 'DISETUJUI', 100, 80, now()); RAISE EXCEPTION 'TIDAK_DITOLAK_dn_tanpa_persetujuan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO fin_supplier_debit_notes (id, debit_number, supplier_id, return_id, amount, stock_value, updated_at) VALUES (dn1, 'DN-UJI-1', sup, r1, 100, 80, now()); lolos := lolos + 1;
  BEGIN INSERT INTO fin_supplier_debit_notes (id, debit_number, supplier_id, return_id, amount, stock_value, updated_at) VALUES (dn2, 'DN-UJI-2', sup, r1, 100, 80, now()); RAISE EXCEPTION 'TIDAK_DITOLAK_dn_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  UPDATE fin_supplier_debit_notes SET status = 'DIBATALKAN', cancelled_at = now(), cancel_reason = 'Dibatalkan pada uji rehearsal' WHERE id = dn1;
  INSERT INTO fin_supplier_debit_notes (id, debit_number, supplier_id, return_id, amount, stock_value, updated_at) VALUES (dn2, 'DN-UJI-2', sup, r1, 100, 80, now()); lolos := lolos + 1;
  -- (5) saldo kredit & pemakaian: pemakaian melebihi jumlah ditolak; pembatalan pemakaian tanpa alasan ditolak
  BEGIN INSERT INTO fin_supplier_credits (id, supplier_id, debit_note_id, amount, used_amount, updated_at) VALUES (gen_random_uuid(), sup, dn2, 50, 60, now()); RAISE EXCEPTION 'TIDAK_DITOLAK_kredit_lebih';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO fin_supplier_credits (id, supplier_id, debit_note_id, amount, updated_at) VALUES (cr, sup, dn2, 50, now()); lolos := lolos + 1;
  -- (6) credit_applied pada faktur: melebihi nilai faktur dan negatif ditolak; 0 tetap boleh
  SELECT id, amount INTO bill, bill_amt FROM fin_supplier_bills WHERE amount > 0 LIMIT 1;
  IF bill IS NULL THEN lewat := lewat + 1; ELSE
    BEGIN UPDATE fin_supplier_bills SET credit_applied = bill_amt + 1 WHERE id = bill; RAISE EXCEPTION 'TIDAK_DITOLAK_credit_lebih_faktur';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
    BEGIN UPDATE fin_supplier_bills SET credit_applied = -1 WHERE id = bill; RAISE EXCEPTION 'TIDAK_DITOLAK_credit_negatif';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
    BEGIN INSERT INTO fin_supplier_credit_applications (id, credit_id, bill_id, supplier_id, amount, status) VALUES (gen_random_uuid(), cr, bill, sup, 10, 'DIBATALKAN'); RAISE EXCEPTION 'TIDAK_DITOLAK_pemakaian_batal_tanpa_alasan';
    EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
    UPDATE fin_supplier_bills SET credit_applied = 0 WHERE id = bill; lolos := lolos + 1;
  END IF;
  -- (7) nilai enum baru dapat dipakai
  PERFORM 'SUPPLIER_RETURN'::"StockMovementType", 'RETUR_SUPPLIER'::"FinJournalSource", 'DEBIT_NOTE_SUPPLIER'::"FinJournalSource"; lolos := lolos + 1;
  RAISE NOTICE 'HASIL tolak=% lolos=% lewat=%', tolak, lolos, lewat;
  RAISE EXCEPTION 'ROLLBACK_UJI';
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint/trigger SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*HASIL tolak=\([0-9]*\) lolos=\([0-9]*\) lewat=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*HASIL tolak=\([0-9]*\) lolos=\([0-9]*\) lewat=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 16 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti terlalu sedikit (${UJI_TOLAK:-?}; minimal 16) — constraint/trigger tidak aktif atau data contoh kurang"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" -ge 10 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos terlalu sedikit (${UJI_LOLOS:-?}; minimal 10)"; }
ok "perilaku terbukti di DB rehearsal: $(printf '%s\n' "$UJI_OUT" | sed -n 's/.*HASIL \(.*\)/\1/p' | sed -n 1p) — CHECK menolak data salah; trigger mengunci baris penerimaan dengan retur KELUAR (retur draf/dibatalkan tidak); satu debit note aktif per retur; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from goods_receipts where receipt_number='GR-UJI-RETUR'")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
[ "$(RPSQL "select count(*) from supplier_returns")" = "0" ] || { reh_drop; die "tabel supplier_returns tidak kosong setelah uji (pembatalan gagal)"; }
reh_drop
ok "rehearsal lulus: isi 17 tabel lama IDENTIK sebelum vs sesudah migrasi + uji perilaku (sidik jari baris penuh tanpa kolom baru); tabel baru kosong; DB sementara dihapus"

PHASE="6-migrate"; say "6. Migrasi aditif (image baru; backend lama tetap melayani)"
[ "$(sg ls-remote origin "refs/heads/${CAND_BRANCH}" | cut -f1)" = "$DEPLOY_SHA" ] || die "kandidat berubah sebelum migrasi"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID_OLD")" = "$PREV_DIR" ] || die "release aktif berubah sebelum migrasi"
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
# SETELAH migrasi, SEBELUM switch: hanya backend LAMA yang melayani dan ia tidak mengenal tabel/kolom baru → seluruh tabel baru HARUS kosong dan credit_applied 0 (tanpa backfill). Sah hanya di jendela ini.
for T in supplier_returns supplier_return_lines fin_supplier_debit_notes fin_supplier_debit_note_lines fin_supplier_credits fin_supplier_credit_applications; do
  [ "$(psql_live -At -c "select count(*) from $T")" = "0" ] || die "tabel baru $T TIDAK kosong setelah migrasi sebelum switch"
done
[ "$(psql_live -At -c "select count(*) from fin_supplier_bills where credit_applied <> 0")" = "0" ] || die "ada faktur dengan credit_applied <> 0 setelah migrasi sebelum switch"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari dokumen beku pasca-migrasi gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: seluruh tabel baru kosong, credit_applied 0 (tanpa backfill), dokumen pembanding beku identik"

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
[ "$NBE" -ge 12 ] || die "terlalu sedikit berkas backend yang diverifikasi (${NBE})"
ok "${NBE} berkas backend di container = kandidat (byte-identik)"
PSQLN() { dcp "$NEW_DIR" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null; }
[ "$(PSQLN "select count(*) from information_schema.tables where table_schema='public' and table_name in ('supplier_returns','supplier_return_lines','fin_supplier_debit_notes','fin_supplier_debit_note_lines','fin_supplier_credits','fin_supplier_credit_applications')")" = "6" ] || die "enam tabel retur tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_trigger where tgname='trg_goods_receipt_line_terkunci_retur' and not tgisinternal")" = "1" ] || die "trigger pengaman retur tidak ada setelah rilis"
ok "enam tabel retur dan trigger pengaman ada (tidak ada asumsi tentang dokumen baru: retur/debit note yang sah boleh sudah muncul)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
[ -d "$PERSIST/backend/data/receipt-proofs" ] || die "folder bukti (${PERSIST}/backend/data/receipt-proofs) tidak ada di root persisten (bukti retur memakainya)"
ok "folder bukti ada di root persisten (dipakai bukti kondisi & penyerahan retur)"
PHASE="8b-smoke"; say "8b. Smoke test izin + pembacaan + invarian (baca-saja; tidak menulis; tahan terhadap transaksi sah yang muncul saat rilis)"
dcp "$NEW_DIR" exec -T -e LEGACY_PO_FINAL="$LEGACY_PO_FINAL" backend node --input-type=module - <<'NODE' || die "smoke test GAGAL"
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
// SMOKE BACA-SAJA. Tanpa asumsi global ("tidak ada retur/debit note baru"): transaksi operasional sah yang muncul saat deploy TIDAK membuat smoke gagal.
// Pembanding = invarian yang berlaku untuk keadaan data apa pun. Tidak menulis: Prisma hanya count; setiap pemanggilan tulis lewat API memakai token tanpa izin / tanpa Idempotency-Key
// dan WAJIB dijawab 400/401/403/428 (dicatat di buku besar tulis di bawah).
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const LEGACY = new Set(String(process.env.LEGACY_PO_FINAL ?? "").split(",").filter(Boolean));
const bukuTulis = [];
async function api(method, path, token, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  if (method !== "GET") bukuTulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status });
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
const gudang = await userDengan("WAREHOUSE", FIN);
if (!adm || !sales || !gudang) { rec("akun ADMIN, SALES murni, dan WAREHOUSE murni (tanpa peran Finance) tersedia", false, `adm=${!!adm} sales=${!!sales} gudang=${!!gudang}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales), tG = await tokenUntuk(gudang);
const nol = "00000000-0000-4000-8000-000000000000";
const KUNCI_NILAI = ["nilaiPersediaan", "hargaPerolehan", "saldoKredit", "kurangiSisa", "stockValue", "unitCost", "amount", "hargaSatuan", "nilaiDipesan", "nilaiMasukStok", "nilaiDiterimaBersih", "totalDipesan", "totalMasukStok", "totalDiterimaBersih", "totalDiretur"];
const KUNCI_PROGRES = ["dipesan", "datangAsli", "pengganti", "datang", "belumDatang", "belumDiperiksa", "ditolak", "menungguPengganti", "baikBelumDisimpan", "masukStok", "diretur", "diterimaBersih", "belumDipenuhiSupplier", "belumMasukStok"];
const mentahTanpaNilai = (j) => { const s = JSON.stringify(j ?? {}); return KUNCI_NILAI.filter((k) => s.includes(`"${k}"`)); };

// ── Retur Supplier: izin & bentuk ──
rec("Retur Supplier (Gudang): tanpa token -> 401", (await api("GET", "/api/inventory/retur-supplier")).status === 401);
rec("Retur Supplier (Gudang): SALES -> 403", (await api("GET", "/api/inventory/retur-supplier", tS)).status === 403);
const rg = await api("GET", "/api/inventory/retur-supplier", tG);
rec("Retur Supplier (Gudang): WAREHOUSE -> 200 berisi daftar retur", rg.status === 200 && Array.isArray(rg.json?.retur), `${rg.json?.retur?.length} retur`);
rec("tampilan Gudang TIDAK memuat nilai rupiah/harga/saldo kredit", mentahTanpaNilai(rg.json).length === 0, mentahTanpaNilai(rg.json).join(","));
rec("Retur Supplier (Finance): SALES -> 403, WAREHOUSE murni -> 403, tanpa token -> 401",
  (await api("GET", "/api/finance/retur-supplier", tS)).status === 403 && (await api("GET", "/api/finance/retur-supplier", tG)).status === 403 && (await api("GET", "/api/finance/retur-supplier")).status === 401);
const rf = await api("GET", "/api/finance/retur-supplier", tA);
rec("Retur Supplier (Finance): admin -> 200", rf.status === 200 && Array.isArray(rf.json?.retur), `${rf.json?.retur?.length} retur`);
const dnl = await api("GET", "/api/finance/retur-supplier/debit-note/daftar", tA);
rec("Debit Note: admin -> 200 daftar; WAREHOUSE murni -> 403", dnl.status === 200 && Array.isArray(dnl.json?.debitNote) && (await api("GET", "/api/finance/retur-supplier/debit-note/daftar", tG)).status === 403, `${dnl.json?.debitNote?.length} DN`);
const krl = await api("GET", "/api/finance/retur-supplier/kredit/daftar", tA);
rec("Saldo kredit: admin -> 200 daftar; WAREHOUSE murni -> 403", krl.status === 200 && Array.isArray(krl.json?.kredit) && (await api("GET", "/api/finance/retur-supplier/kredit/daftar", tG)).status === 403, `${krl.json?.kredit?.length} saldo`);
rec("detail retur/DN/kredit id tak dikenal -> 404 (bukan 500)", (await api("GET", `/api/inventory/retur-supplier/${nol}`, tG)).status === 404 && (await api("GET", `/api/finance/retur-supplier/debit-note/${nol}/pratinjau`, tA)).status === 404);

// ── Progres PO: definisi server (14 angka), label baru, invarian untuk data apa pun ──
const bad = await api("GET", "/api/inventory/barang-akan-datang", tG);
const baris = bad.json?.purchaseOrders ?? [];
rec("Barang Akan Datang (Gudang) -> 200", bad.status === 200 && Array.isArray(baris), `${baris.length} PO`);
rec("tiap PO: 14 definisi progres; kunci 'diterimaBersih' berlabel 'Diterima bersih dari PO' (bukan 'stok bersih'); tanpa kunci lama", baris.every((p) => Array.isArray(p.progresDefinisi) && p.progresDefinisi.length === 14 && p.progresDefinisi.find((d) => d.kunci === "diterimaBersih")?.label === "Diterima bersih dari PO" && !p.progresDefinisi.some((d) => d.kunci === "stokBersih")), `${baris.length} PO`);
rec("tiap baris PO punya 14 angka numerik, dan Diterima bersih = Masuk stok − Diretur (berlaku untuk data apa pun)", baris.every((p) => p.lines.every((l) => KUNCI_PROGRES.every((k) => typeof l[k] === "number") && Math.abs(l.diterimaBersih - Math.max(0, l.masukStok - l.diretur)) < 0.0005)));
rec("tampilan Gudang (progres) TIDAK memuat harga/nilai", mentahTanpaNilai(bad.json).length === 0, mentahTanpaNilai(bad.json).join(","));
const lama = baris.filter((p) => LEGACY.has(p.id));
if (lama.length > 0) {
  const k = await api("GET", `/api/inventory/retur-supplier/kandidat/${lama[0].id}`, tG);
  rec("kandidat retur untuk PO lama terminal -> 200 (daftar) dan tanpa nilai", k.status === 200 && Array.isArray(k.json?.baris) && mentahTanpaNilai(k.json).length === 0, `${k.json?.baris?.length} baris`);
}
console.log(`  INFO  ${baris.length} PO di daftar; ${lama.length} PO beku diperiksa; retur/PO baru yang muncul saat rilis TIDAK memengaruhi hasil`);

// ── Penulisan: SEMUA ditolak izin/idempotensi SEBELUM menyentuh data ──
const kunci = (n) => ({ "Idempotency-Key": `smoke-reti-${n}` });
await api("POST", "/api/inventory/retur-supplier", null, { x: 1 }, kunci("anon"));
await api("POST", "/api/inventory/retur-supplier", tS, { x: 1 }, kunci("sales"));
await api("POST", `/api/inventory/retur-supplier/${nol}/keluar`, tS, { x: 1 }, kunci("sales-keluar"));
await api("POST", `/api/finance/retur-supplier/debit-note/${nol}/setujui`, tG, { x: 1 }, kunci("gudang-setuju"));
await api("POST", `/api/finance/retur-supplier/debit-note/${nol}/batal`, tS, { reason: "uji" }, kunci("sales-batal-dn"));
await api("POST", `/api/finance/retur-supplier/kredit/${nol}/terapkan`, tG, { x: 1 }, kunci("gudang-kredit"));
await api("POST", `/api/finance/retur-supplier/kredit-pemakaian/${nol}/batal`, tG, { reason: "uji" }, kunci("gudang-batal-kredit"));
await api("POST", "/api/inventory/retur-supplier", tA, { x: 1 }); // tanpa Idempotency-Key -> 428 sebelum handler
await api("POST", `/api/finance/retur-supplier/debit-note/${nol}/setujui`, tA, { x: 1 }); // tanpa Idempotency-Key -> 428
const SAH = new Set([400, 401, 403, 428]);
rec(`semua ${bukuTulis.length} pemanggilan tulis ditolak sebelum menyentuh data (hanya 400/401/403/428): smoke TIDAK menulis data produksi`, bukuTulis.length === 9 && bukuTulis.every((b) => SAH.has(b.status)), bukuTulis.map((b) => `${b.n}=${b.status}`).join("; "));

// ── Invarian basis data (berlaku untuk data apa pun, termasuk nol retur) ──
const hitungSql = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
rec("faktur: credit_applied tidak pernah melebihi nilai faktur", (await hitungSql(`select count(*)::int n from fin_supplier_bills where credit_applied > amount or credit_applied < 0`)) === 0);
rec("faktur: credit_applied = Σ debit note disetujui yang mengurangi sisa + Σ pemakaian saldo kredit aktif (per faktur)", (await hitungSql(`select count(*)::int n from fin_supplier_bills b where b.credit_applied <> coalesce((select sum(l.applied_to_bill) from fin_supplier_debit_note_lines l join fin_supplier_debit_notes d on d.id = l.debit_note_id where l.bill_id = b.id and d.status = 'DISETUJUI'), 0) + coalesce((select sum(a.amount) from fin_supplier_credit_applications a where a.bill_id = b.id and a.status = 'AKTIF'), 0)`)) === 0);
rec("saldo kredit: used_amount = Σ pemakaian aktif (per saldo)", (await hitungSql(`select count(*)::int n from fin_supplier_credits c where c.used_amount <> coalesce((select sum(a.amount) from fin_supplier_credit_applications a where a.credit_id = c.id and a.status = 'AKTIF'), 0)`)) === 0);
rec("retur berstatus KELUAR/SELESAI: setiap baris punya pergerakan stok SUPPLIER_RETURN keluar", (await hitungSql(`select count(*)::int n from supplier_return_lines l join supplier_returns r on r.id = l.return_id where r.status in ('KELUAR','SELESAI') and (l.stock_movement_id is null or not exists (select 1 from stock_movements m where m.id = l.stock_movement_id and m.type::text = 'SUPPLIER_RETURN' and m.qty < 0))`)) === 0);
rec("debit note DISETUJUI: punya jurnal DEBIT_NOTE_SUPPLIER yang berlaku (POSTED)", (await hitungSql(`select count(*)::int n from fin_supplier_debit_notes d where d.status = 'DISETUJUI' and not exists (select 1 from fin_journal_entries e where e.source::text = 'DEBIT_NOTE_SUPPLIER' and e.source_id::text = d.id::text and e.status::text = 'POSTED')`)) === 0);
rec("retur KELUAR/SELESAI: punya jurnal RETUR_SUPPLIER yang berlaku (POSTED)", (await hitungSql(`select count(*)::int n from supplier_returns r where r.status in ('KELUAR','SELESAI') and not exists (select 1 from fin_journal_entries e where e.source::text = 'RETUR_SUPPLIER' and e.source_id::text = r.id::text and e.status::text = 'POSTED')`)) === 0);
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal`);
process.exit(fail ? 1 : 0);
NODE
ok "smoke test lulus (izin Gudang/Finance/Sales, Gudang tanpa nilai, label & 14 angka progres, 9 penulisan ditolak sebelum menyentuh data, 6 invarian basis data); transaksi sah saat rilis tidak membuatnya gagal"
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
ok "dokumen pembanding beku (penerimaan/PO/faktur terminal, stok, jurnal, saldo per akun, flag) IDENTIK sebelum vs sesudah rilis; transaksi sah yang muncul saat rilis tidak diperbandingkan"
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
