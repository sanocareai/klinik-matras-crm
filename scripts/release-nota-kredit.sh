#!/usr/bin/env bash
# RILIS "NOTA KREDIT / KERINGANAN ORDER + REFUND KELEBIHAN BAYAR": web + backend + 1 migrasi ADITIF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Nota Kredit = dokumen resmi pengurang TAGIHAN (potongan/keringanan), terpisah dari refund: mandiri (Dr Retur & Potongan / Cr Piutang, <= sisa piutang) atau TERTAUT refund (tanpa jurnal baru);
#   pratinjau server, token revisi optimistis, Idempotency-Key, pembatalan resmi, riwayat; refund kelebihan bayar kini menutup Uang Muka/kredit Piutang lebih dulu (bukan Retur).
#   Migrasi: 20261108090000_order_nota_kredit — 1 nilai enum + 1 tabel baru (kosong) + 7 indeks (1 parsial) + 6 FK + 4 CHECK. TANPA backfill/UPDATE/DELETE.
# Data lama TIDAK diubah: refund, order, jurnal, pembayaran tidak disentuh; status order Sofyan (RES-07102026-037) TIDAK dikoreksi oleh rilis ini (menunggu konfirmasi Owner).
# Produksi: verifikasi hanya baca + penolakan izin; TIDAK ada nota/refund/order/jurnal QA. Uji perilaku constraint dijalankan di DB REHEARSAL (hasil restore backup).
#
#   cat scripts/release-nota-kredit.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/nk1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/nk1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/nk1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/nk1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode HANYA boleh di-rollback bila belum ada nota kredit / jurnal NOTA_KREDIT_ORDER. Periksa dulu dengan scripts/rollback-guard-nota-kredit.sh (baca-saja;
# menolak bila ada data baru: kode lama mengabaikan nota dan tidak mengenal nilai enum NOTA_KREDIT_ORDER).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-fix/nota-kredit-status-bayar-v2}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261108090000_order_nota_kredit:9655c1e3011346df2951c57e2bf2b90fd72e63cc005e1550c973b88402c5dbb7"
# Hasil pemindai untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":19,"add_enum":1,"create_table":1,"create_index":7,"fk":6,"check":4}'
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261108090000_order_nota_kredit/migration\.sql|backend/prisma/schema\.prisma|backend/src/routes/financeTransactions\.js|backend/src/services/finance/koreksiLanjutan\.js|backend/src/services/finance/notaKredit\.js|backend/src/services/finance/posting/notaKredit\.js|backend/src/services/finance/posting/orderRevenue\.js|backend/src/services/finance/tagihanOrder\.js|backend/tests/integration/notaKreditOrder\.integration\.test\.js|backend/tests/integration/refundKelebihanBayar\.integration\.test\.js|docs/FINANCE-NOTA-KREDIT\.md|frontend/src/api\.js|frontend/src/features/finance/NotaKreditDialog\.jsx|frontend/src/features/finance/PiutangDetail\.jsx|frontend/src/features/finance/RiwayatNotaKredit\.jsx|frontend/src/features/finance/aksiMenu\.jsx|frontend/src/features/finance/matriksAksi\.js|frontend/src/features/finance/notaKreditLogic\.js|frontend/src/pages/finance/FinanceReceivables\.jsx|frontend/tests/notaKredit\.test\.js|scripts/release-nota-kredit\.sh|scripts/rollback-guard-nota-kredit\.sh)$'
BACKEND_SRC_EXPECT="backend/src/routes/financeTransactions.js backend/src/services/finance/koreksiLanjutan.js backend/src/services/finance/notaKredit.js backend/src/services/finance/posting/notaKredit.js backend/src/services/finance/posting/orderRevenue.js backend/src/services/finance/tagihanOrder.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/finance/NotaKreditDialog.jsx frontend/src/features/finance/PiutangDetail.jsx frontend/src/features/finance/RiwayatNotaKredit.jsx frontend/src/features/finance/aksiMenu.jsx frontend/src/features/finance/matriksAksi.js frontend/src/features/finance/notaKreditLogic.js frontend/src/pages/finance/FinanceReceivables.jsx"
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
BK_DIR="$HOME/release-backups/nota-kredit-${DEPLOY_SHORT}-${TS}"
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
   bash ${NEW_DIR}/scripts/rollback-guard-nota-kredit.sh
Guard menolak (exit 1) bila SUDAH ada data yang hanya dipahami kode baru:
   - nota kredit (fin_order_credits) — kode lama mengabaikannya: tagihan dihitung kotor, status bayar order bergeser (LUNAS -> DP),
   - jurnal bersumber NOTA_KREDIT_ORDER — nilai enum itu tidak dikenal Prisma kode lama (membaca baris tsb dapat gagal).
   Bila guard menolak: JANGAN rollback ke kode lama. Pilih perbaiki-maju, batalkan nota lewat aplikasi, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner.
Bila guard lulus (belum ada nota), rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi hanya MENAMBAH 1 nilai enum + 1 tabel kosong: dibiarkan terpasang pun aman bagi kode lama SELAMA belum ada nota/jurnal baru. (Tidak dihapus oleh rollback kode.)
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
exec 9>/tmp/release-nota-kredit.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "nk1\|release-nota-kredit\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
// Pemindai migrasi rilis "Nota Kredit / Keringanan order" (1 migrasi aditif). Dijalankan di VPS oleh skrip rilis; juga dijalankan lokal terhadap berkas migrasi. FAIL-CLOSED, daftar putih per pernyataan.
//  (a) SATU nilai enum baru: ALTER TYPE "FinJournalSource" ADD VALUE 'NOTA_KREDIT_ORDER' (tidak ada nilai lain),
//  (b) SATU tabel baru fin_order_credits dengan kolom persis yang diaudit (DEFAULT hanya CURRENT_TIMESTAMP / 'POTONGAN_HARGA' / 'AKTIF'),
//  (c) 7 indeks hanya pada tabel baru (4 UNIQUE biasa, 2 biasa, 1 UNIQUE parsial dengan WHERE persis),
//  (d) 6 FK dari tabel baru (RESTRICT atau SET NULL; tidak ada CASCADE), 4 CHECK bernama tanpa subquery.
// Tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/RENAME/ALTER COLUMN/TRIGGER/FUNCTION, tidak ada perubahan apa pun pada tabel lama.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const hitung = {};
const tambah = (k) => { hitung[k] = (hitung[k] ?? 0) + 1; };
const gagal = (m) => { console.error(m); process.exit(1); };
const KOLOM = ["id", "credit_number", "order_id", "amount", "reason", "kind", "credit_date", "refund_id", "journal_id", "reversal_journal_id", "status", "idempotency_key", "created_by", "created_at", "cancelled_by", "cancelled_at", "cancel_reason"];
const INDEKS_OK = new Map([
  ["fin_order_credits_credit_number_key", ["credit_number"]], ["fin_order_credits_journal_id_key", ["journal_id"]],
  ["fin_order_credits_reversal_journal_id_key", ["reversal_journal_id"]], ["fin_order_credits_idempotency_key_key", ["idempotency_key"]],
  ["fin_order_credits_order_id_status_idx", ["order_id", "status"]], ["fin_order_credits_refund_id_idx", ["refund_id"]],
  ["fin_order_credits_refund_aktif_uniq", ["refund_id"]],
]);
const FK_OK = new Set([
  "order_id>Order:RESTRICT", "refund_id>fin_refunds:RESTRICT", "journal_id>fin_journal_entries:RESTRICT",
  "reversal_journal_id>fin_journal_entries:SET NULL", "created_by>User:SET NULL", "cancelled_by>User:SET NULL",
]);
const CHECK_OK = new Set(["fin_order_credits_amount_pos_chk", "fin_order_credits_status_chk", "fin_order_credits_batal_chk", "fin_order_credits_jurnal_chk"]);
const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
const dilihat = new Set();
const unik = (jenis, nama) => { const k = `${jenis}:${nama}`; if (dilihat.has(k)) gagal(`${jenis} duplikat: ${nama}`); dilihat.add(k); };
for (const st of stmts) {
  const r = rapat(st);
  let m;
  if (r === `ALTER TYPE "FinJournalSource" ADD VALUE 'NOTA_KREDIT_ORDER'`) { unik("enum", "NOTA_KREDIT_ORDER"); tambah("add_enum"); continue; }
  if ((m = /^CREATE TABLE "fin_order_credits" \((.+)\)$/.exec(r))) {
    unik("tabel", "fin_order_credits");
    const isi = m[1].trim();
    if (/\b(REFERENCES|GENERATED|SERIAL|CHECK)\b/i.test(isi)) gagal("CREATE TABLE memuat klausa di luar daftar putih");
    // Pecah di koma tingkat-atas (koma di dalam tanda kurung, mis. DECIMAL(18,2), tidak memecah).
    const bagian = isi.split(/,\s*(?![^()]*\))/).map((x) => x.trim());
    const pk = bagian.pop();
    if (!/^CONSTRAINT "fin_order_credits_pkey" PRIMARY KEY \("id"\)$/.test(pk ?? "")) gagal("tabel tanpa primary key standar");
    const nama = [];
    let nDefault = 0;
    for (const p of bagian) {
      const k = /^"([a-z0-9_]+)" (UUID|TEXT|VARCHAR\(\d+\)|DECIMAL\(18,2\)|DATE|TIMESTAMP\(3\))( NOT NULL)?( DEFAULT (CURRENT_TIMESTAMP|'POTONGAN_HARGA'|'AKTIF'))?$/.exec(p);
      if (!k) gagal(`definisi kolom di luar daftar putih: ${p.slice(0, 80)}`);
      nama.push(k[1]); if (k[4]) nDefault++;
    }
    if (JSON.stringify(nama) !== JSON.stringify(KOLOM)) gagal(`kolom tabel bukan yang diaudit: ${nama.join(",")}`);
    if (nDefault !== 3) gagal("CREATE TABLE memuat DEFAULT di luar daftar putih");
    tambah("create_table"); continue;
  }
  if ((m = /^CREATE (UNIQUE )?INDEX "([a-z_]+)" ON "([A-Za-z_]+)"\("([a-z_]+)"(?:, "([a-z_]+)")?\)(?: WHERE (.+))?$/.exec(r))) {
    const kolom = INDEKS_OK.get(m[2]);
    if (!kolom || m[3] !== "fin_order_credits") gagal(`indeks di luar daftar putih: ${m[2]} pada ${m[3]}`);
    if (JSON.stringify([m[4], m[5]].filter(Boolean)) !== JSON.stringify(kolom)) gagal(`kolom indeks ${m[2]} bukan yang diaudit`);
    const parsial = m[2] === "fin_order_credits_refund_aktif_uniq";
    if (parsial && (!m[1] || m[6] !== `"refund_id" IS NOT NULL AND "status" = 'AKTIF'`)) gagal("indeks parsial refund aktif bukan yang diaudit");
    if (!parsial && m[6]) gagal(`indeks ${m[2]} tidak boleh parsial`);
    unik("indeks", m[2]); tambah("create_index"); continue;
  }
  if ((m = /^ALTER TABLE "fin_order_credits" ADD CONSTRAINT "([a-z_]+_fkey)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "([A-Za-z_]+)"\("id"\) ON DELETE (RESTRICT|SET NULL) ON UPDATE CASCADE$/.exec(r))) {
    const k = `${m[2]}>${m[3]}:${m[4]}`;
    if (!FK_OK.has(k)) gagal(`FK di luar daftar putih: ${k}`);
    unik("fk", k); tambah("fk"); continue;
  }
  if ((m = /^ALTER TABLE "fin_order_credits" ADD CONSTRAINT "([a-z_]+)" CHECK \((.+)\)$/.exec(r))) {
    if (!CHECK_OK.has(m[1])) gagal(`CHECK di luar daftar putih: ${m[1]}`);
    if (/\b(SELECT|FROM|INSERT|UPDATE|DELETE)\b/i.test(m[2])) gagal(`CHECK memuat subquery/perintah menulis: ${m[1]}`);
    unik("check", m[1]); tambah("check"); continue;
  }
  gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
}
if ((hitung.add_enum ?? 0) !== 1) gagal("nilai enum baru harus tepat 1");
if ((hitung.create_table ?? 0) !== 1) gagal("tabel baru harus tepat 1");
if ((hitung.create_index ?? 0) !== INDEKS_OK.size) gagal(`indeks harus tepat ${INDEKS_OK.size}`);
if ((hitung.fk ?? 0) !== FK_OK.size) gagal(`FK harus tepat ${FK_OK.size}`);
if ((hitung.check ?? 0) !== CHECK_OK.size) gagal(`CHECK harus tepat ${CHECK_OK.size}`);
console.log(JSON.stringify({ total: stmts.length, add_enum: 0, create_table: 0, create_index: 0, fk: 0, check: 0, ...hitung }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (1 nilai enum, 1 tabel baru, 7 indeks termasuk 1 parsial, 6 FK, 4 CHECK bernama); tanpa DROP/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT/trigger"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE tabel lama" "$(tambah_stmt 'DROP TABLE "Order";')"
harus_ditolak "UPDATE tabel lama (status bayar order)" "$(tambah_stmt "UPDATE \"Order\" SET \"paymentStatus\" = 'LUNAS';")"
harus_ditolak "UPDATE tabel lama (refund)" "$(tambah_stmt "UPDATE \"fin_refunds\" SET \"amount\" = 0;")"
harus_ditolak "DELETE tabel lama" "$(tambah_stmt 'DELETE FROM "fin_journal_lines";')"
harus_ditolak "INSERT tabel lama" "$(tambah_stmt "INSERT INTO \"fin_settings\" (\"key\", \"value\") VALUES ('x', 'y');")"
harus_ditolak "INSERT ke tabel nota baru (seed/backfill)" "$(tambah_stmt "INSERT INTO \"fin_order_credits\" (\"id\") VALUES (gen_random_uuid());")"
harus_ditolak "INSERT ... SELECT (backfill nota dari refund)" "$(tambah_stmt 'INSERT INTO "fin_order_credits" SELECT * FROM "fin_refunds";')"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "fin_order_credits";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "Order" DROP COLUMN "value";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "fin_refunds" ALTER COLUMN "amount" TYPE INTEGER;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "fin_refunds" RENAME COLUMN "amount" TO "nominal";')"
harus_ditolak "kolom baru pada tabel lama (Order)" "$(tambah_stmt 'ALTER TABLE "Order" ADD COLUMN "x" TEXT;')"
harus_ditolak "kolom baru pada tabel lama (fin_refunds)" "$(tambah_stmt 'ALTER TABLE "fin_refunds" ADD COLUMN "x" TEXT;')"
harus_ditolak "nilai enum kedua" "$(tambah_stmt "ALTER TYPE \"FinJournalSource\" ADD VALUE 'LIAR';")"
harus_ditolak "nilai enum liar menggantikan yang diaudit" "$(printf '%s\n' "$ALL_SQL" | sed "s/'NOTA_KREDIT_ORDER'/'LIAR'/")"
harus_ditolak "RENAME enum value" "$(tambah_stmt "ALTER TYPE \"FinJournalSource\" RENAME VALUE 'REFUND' TO 'X';")"
harus_ditolak "kolom tambahan pada tabel baru" "$(printf '%s\n' "$ALL_SQL" | sed 's/    "cancel_reason" TEXT,/    "cancel_reason" TEXT,\n    "harga" INTEGER,/')"
harus_ditolak "kolom hilang dari tabel baru" "$(printf '%s\n' "$ALL_SQL" | grep -v '"reason" TEXT NOT NULL,')"
harus_ditolak "tabel baru kedua" "$(tambah_stmt 'CREATE TABLE "fin_order_extra" ("id" UUID NOT NULL, CONSTRAINT "fin_order_extra_pkey" PRIMARY KEY ("id"));')"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "fin_refunds"("order_id");')"
harus_ditolak "indeks parsial dengan WHERE longgar" "$(printf '%s\n' "$ALL_SQL" | sed "s/WHERE \"refund_id\" IS NOT NULL AND \"status\" = 'AKTIF'/WHERE true/")"
harus_ditolak "indeks unik refund-aktif hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'fin_order_credits_refund_aktif_uniq')"
harus_ditolak "indeks tambahan di luar daftar" "$(tambah_stmt 'CREATE INDEX "fin_order_credits_x_idx" ON "fin_order_credits"("reason");')"
harus_ditolak "DROP INDEX" "$(tambah_stmt 'DROP INDEX "fin_order_credits_refund_id_idx";')"
harus_ditolak "FK ke tabel di luar daftar" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "fin_refunds"("id")/REFERENCES "Customer"("id")/')"
harus_ditolak "FK dengan CASCADE (menghapus nota bersama order)" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "Order"("id") ON DELETE RESTRICT/REFERENCES "Order"("id") ON DELETE CASCADE/')"
harus_ditolak "FK baru dari tabel lama" "$(tambah_stmt 'ALTER TABLE "fin_refunds" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "CHECK dengan nama tak diaudit" "$(tambah_stmt 'ALTER TABLE "fin_order_credits" ADD CONSTRAINT "evil_chk" CHECK (true);')"
harus_ditolak "nama CHECK diganti" "$(printf '%s\n' "$ALL_SQL" | sed 's/"fin_order_credits_status_chk"/"fin_order_credits_evil_chk"/')"
harus_ditolak "CHECK memuat subquery" "$(printf '%s\n' "$ALL_SQL" | sed 's/CHECK ("amount" > 0)/CHECK ((SELECT count(*) FROM "fin_refunds") >= 0)/')"
harus_ditolak "CHECK hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'fin_order_credits_amount_pos_chk')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "fin_order_credits" TO PUBLIC;')"
harus_ditolak "trigger apa pun" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "fin_refunds" FOR EACH ROW EXECUTE FUNCTION "x"();')"
harus_ditolak "fungsi liar" "$(tambah_stmt 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "default liar pada tabel baru" "$(printf '%s\n' "$ALL_SQL" | sed "s/DEFAULT 'AKTIF'/DEFAULT now()/")"
harus_ditolak "default tambahan pada kolom nominal" "$(printf '%s\n' "$ALL_SQL" | sed 's/"amount" DECIMAL(18,2) NOT NULL,/"amount" DECIMAL(18,2) NOT NULL DEFAULT 1,/')"
harus_ditolak "trigger dimatikan" "$(tambah_stmt 'ALTER TABLE "fin_order_credits" DISABLE TRIGGER ALL;')"
[ "$NEG" -ge 30 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 30)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/backfill/TRUNCATE/ALTER COLUMN/RENAME/kolom-tabel-indeks-FK di luar daftar/FK CASCADE/CHECK liar/subquery/GRANT/trigger/fungsi/default liar/hitungan beda) SEMUANYA ditolak"
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
for T in fin_refunds fin_journal_entries fin_journal_lines fin_cash_accounts fin_accounts payments "Order" fin_settings fin_expenses; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='fin_refunds' and column_name in ('transfer_fee_amount','transfer_reference','replaces_refund_id','attachment_url')")" = "4" ] || die "kolom refund belum lengkap di produksi (prasyarat: rilis Koreksi Refund + Bukti harus sudah live)"
[ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='fin_order_credits'")" = "0" ] || die "tabel fin_order_credits SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'FinJournalSource' and e.enumlabel = 'NOTA_KREDIT_ORDER'")" = "0" ] || die "nilai enum NOTA_KREDIT_ORDER SUDAH ada di produksi (tidak diharapkan)"
for m in $MIG_LIST; do [ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${m}'")" = "0" ] || die "migrasi ${m} SUDAH tercatat di produksi (tidak diharapkan)"; done
[ "$(psql_live -At -c "select count(*) from fin_accounts where system_key in ('RETUR_PENJUALAN','PIUTANG_USAHA','UANG_MUKA_PELANGGAN') and active and is_postable")" = "3" ] || die "akun sistem Retur & Potongan / Piutang Usaha / Uang Muka Pelanggan belum aktif & dapat diposting — nota kredit dan refund kelebihan bayar akan gagal"
REF_N="$(psql_live -At -c "select count(*) from fin_refunds")"; REF_OK_N="$(psql_live -At -c "select count(*) from fin_refunds where status::text = 'DISETUJUI'")"
ORD_LUNAS_N="$(psql_live -At -c "select count(*) from \"Order\" where \"paymentStatus\"::text = 'LUNAS'")"; ORD_DP_N="$(psql_live -At -c "select count(*) from \"Order\" where \"paymentStatus\"::text = 'DP'")"
[ "$REF_N" -gt 0 ] || die "tidak ada refund di produksi: uji perilaku rehearsal butuh contoh baris — berhenti"
ok "prasyarat skema terpenuhi; refund=${REF_N} (disetujui ${REF_OK_N}); order LUNAS=${ORD_LUNAS_N}, DP=${ORD_DP_N} — semua dibiarkan apa adanya, tanpa backfill"
# AUDIT DATA LAMA (baca-saja): jurnal refund AKTIF yang mendebet Retur & Potongan padahal pada saat itu order masih punya saldo Uang Muka (kredit) atau kredit Piutang = pola "kelebihan bayar" yang dulu salah dijurnal.
# Perbaikan rilis ini HANYA berlaku untuk refund BARU; data lama TIDAK diubah/backfill. Angka ini informasi bagi Owner (kelas A di laporan audit), bukan syarat berhenti.
SQL_REFUND_KELEBIHAN="select count(*)::int from (select e.id, l.order_id, e.created_at from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id join fin_accounts a on a.id = l.account_id where e.source::text = 'REFUND' and e.status::text = 'POSTED' and a.system_key = 'RETUR_PENJUALAN' and l.debit > 0 and l.order_id is not null group by e.id, l.order_id, e.created_at) r where (select coalesce(sum(l.credit - l.debit), 0) from fin_journal_lines l join fin_journal_entries x on x.id = l.entry_id join fin_accounts a on a.id = l.account_id where l.order_id = r.order_id and a.system_key = 'UANG_MUKA_PELANGGAN' and x.status::text in ('POSTED','REVERSED') and x.created_at < r.created_at) > 0 or (select coalesce(sum(l.debit - l.credit), 0) from fin_journal_lines l join fin_journal_entries x on x.id = l.entry_id join fin_accounts a on a.id = l.account_id where l.order_id = r.order_id and a.system_key = 'PIUTANG_USAHA' and x.status::text in ('POSTED','REVERSED') and x.created_at < r.created_at) < 0"
BASE_KELEBIHAN="$(psql_live -At -c "$SQL_REFUND_KELEBIHAN")"
[[ "$BASE_KELEBIHAN" =~ ^[0-9]+$ ]] || die "audit refund kelebihan bayar bukan angka: '$BASE_KELEBIHAN'"
if [ "$BASE_KELEBIHAN" != "0" ]; then warn "audit data lama: ${BASE_KELEBIHAN} jurnal refund aktif mendebet Retur padahal order punya saldo Uang Muka/kredit Piutang saat itu (kelas A). TIDAK diubah oleh rilis ini — butuh keputusan Owner per order."; else ok "audit data lama: 0 jurnal refund aktif pola kelebihan-bayar-salah-jurnal (semua kelas C)"; fi
# GARIS DASAR invarian (dibandingkan sesudah rilis; yang dijaga = TIDAK BERTAMBAH oleh rilis ini).
SQL_TIDAK_SEIMBANG="select count(*)::int from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x"
SQL_GANDA="select count(*)::int from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x"
SQL_TANPA_JURNAL="select count(*)::int from fin_refunds r where r.status::text = 'DISETUJUI' and not exists (select 1 from fin_journal_entries e where e.source::text = 'REFUND' and e.source_id = r.id::text and e.status::text = 'POSTED')"
BASE_TIDAK_SEIMBANG="$(psql_live -At -c "$SQL_TIDAK_SEIMBANG")"; BASE_GANDA="$(psql_live -At -c "$SQL_GANDA")"; BASE_TANPA_JURNAL="$(psql_live -At -c "$SQL_TANPA_JURNAL")"
for v in "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA" "$BASE_TANPA_JURNAL"; do [[ "$v" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$v'"; done
printf 'BASE_TIDAK_SEIMBANG=%s BASE_GANDA=%s BASE_TANPA_JURNAL=%s REF_N=%s BASE_KELEBIHAN=%s\n' "$BASE_TIDAK_SEIMBANG" "$BASE_GANDA" "$BASE_TANPA_JURNAL" "$REF_N" "$BASE_KELEBIHAN" > "$BK_DIR/garis-dasar.env"
ok "garis dasar: jurnal tidak seimbang = ${BASE_TIDAK_SEIMBANG}; refund dengan >1 jurnal berlaku = ${BASE_GANDA}; disetujui tanpa jurnal = ${BASE_TANPA_JURNAL}"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel. Membuktikan restore identik dan migrasi tidak mengubah data lama (rilis ini tidak menambah kolom pada tabel lama).
FP_SQL="select 'fin_refunds', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_refunds x
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
select 'refund_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_refunds x where x.status::text in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'pengeluaran_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_expenses x where x.status::text in ('DIBATALKAN','DITOLAK') and x.updated_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'pembayaran_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x where x.created_at < '$T0'::timestamp
union all select 'flag', count(*), md5(coalesce(string_agg(f.key || '=' || f.value, '|' order by f.key),'')) from fin_settings f
union all select 'order_lunas_beku', count(*), md5(coalesce(string_agg(x.id || ':' || x."paymentStatus"::text || ':' || coalesce(x.paid_at::text, ''), '|' order by x.id),'')) from "Order" x where x."paymentStatus"::text = 'LUNAS' and x."updatedAt" < '$T0'::timestamp
FPBEKU
)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "7" ] || die "sidik jari dokumen beku tidak 7 baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di 7 kelompok)"

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
BACKUP_FILE="$HOME/backups/pre-nota-kredit-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-nota-kredit.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Buat Nota Kredit" "Tanpa jurnal—sudah dicatat oleh refund" "Dampak (dihitung server)" "Batalkan Nota Kredit" "Tertaut Refund" "Potongan/Keringanan Mandiri"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Gunakan bukti lama" "Lampirkan Bukti" "Item Penjualan & Pemenuhan" "Piutang & Refund" "Penjualan & Piutang" "Katalog Item PKR" "Kirim sebagian" "Retur & Debit Note" "Rencana Produksi" "Penjualan Karyawan" "Barang Akan Datang"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-nota-kredit-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_nota_kredit_${TS}"
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
# Struktur: 1 nilai enum; tabel baru KOSONG; 4 CHECK; 7 indeks (1 parsial unik); 6 FK.
[ "$(RPSQL "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'FinJournalSource' and e.enumlabel = 'NOTA_KREDIT_ORDER'")" = "1" ] || { reh_drop; die "nilai enum NOTA_KREDIT_ORDER tidak terpasang"; }
[ "$(RPSQL "select count(*) from fin_order_credits")" = "0" ] || { reh_drop; die "tabel baru fin_order_credits TIDAK kosong setelah migrasi"; }
for C in fin_order_credits_amount_pos_chk fin_order_credits_status_chk fin_order_credits_batal_chk fin_order_credits_jurnal_chk; do
  [ "$(RPSQL "select count(*) from pg_constraint where conname='$C'")" = "1" ] || { reh_drop; die "constraint $C tidak ada tepat satu"; }
done
for I in fin_order_credits_credit_number_key fin_order_credits_journal_id_key fin_order_credits_reversal_journal_id_key fin_order_credits_idempotency_key_key fin_order_credits_order_id_status_idx fin_order_credits_refund_id_idx fin_order_credits_refund_aktif_uniq; do
  [ "$(RPSQL "select count(*) from pg_indexes where schemaname='public' and indexname='$I'")" = "1" ] || { reh_drop; die "indeks $I tidak ada tepat satu"; }
done
[ "$(RPSQL "select count(*) from pg_indexes where indexname='fin_order_credits_refund_aktif_uniq' and indexdef like '%WHERE%'")" = "1" ] || { reh_drop; die "indeks refund-aktif bukan parsial"; }
[ "$(RPSQL "select count(*) from pg_constraint where conrelid = 'fin_order_credits'::regclass and contype = 'f'")" = "6" ] || { reh_drop; die "FK fin_order_credits tidak tepat 6"; }
ok "nilai enum terpasang; tabel nota kredit baru kosong; 4 CHECK, 7 indeks (1 unik parsial), 6 FK terpasang"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan di akhir): CHECK/unique/FK menolak data salah; data sah lolos; satu nota aktif per refund.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE
  o text; rf uuid; je1 uuid; je2 uuid; c1 uuid := gen_random_uuid();
  tolak int := 0; lolos int := 0;
BEGIN
  SELECT id INTO o FROM "Order" LIMIT 1;
  SELECT id INTO rf FROM fin_refunds LIMIT 1;
  SELECT id INTO je1 FROM fin_journal_entries ORDER BY id LIMIT 1;
  SELECT id INTO je2 FROM fin_journal_entries WHERE id <> je1 ORDER BY id LIMIT 1;
  IF o IS NULL OR rf IS NULL OR je1 IS NULL OR je2 IS NULL THEN RAISE EXCEPTION 'ROLLBACK_UJI tolak=0 lolos=0 (tidak ada contoh order/refund/jurnal)'; END IF;
  -- (1) CHECK: nominal nol/negatif, status liar, DIBATALKAN tanpa alasan, tanpa refund & tanpa jurnal
  BEGIN INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, refund_id, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-1', o, 0, 'x', current_date, rf, 'uji-1'); RAISE EXCEPTION 'TIDAK_DITOLAK_nol';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, refund_id, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-2', o, -5, 'x', current_date, rf, 'uji-2'); RAISE EXCEPTION 'TIDAK_DITOLAK_negatif';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, refund_id, status, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-3', o, 100, 'x', current_date, rf, 'LIAR', 'uji-3'); RAISE EXCEPTION 'TIDAK_DITOLAK_status';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, refund_id, status, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-4', o, 100, 'x', current_date, rf, 'DIBATALKAN', 'uji-4'); RAISE EXCEPTION 'TIDAK_DITOLAK_batal_tanpa_alasan';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-5', o, 100, 'x', current_date, 'uji-5'); RAISE EXCEPTION 'TIDAK_DITOLAK_tanpa_refund_jurnal';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  -- (2) FK: order yang tidak ada
  BEGIN INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, refund_id, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-6', 'order-tidak-ada-zz', 100, 'x', current_date, rf, 'uji-6'); RAISE EXCEPTION 'TIDAK_DITOLAK_fk_order';
  EXCEPTION WHEN foreign_key_violation THEN tolak := tolak + 1; END;
  -- (3) nota sah tertaut refund lolos; nota aktif kedua pada refund yang sama DITOLAK (indeks parsial); nomor/kunci/jurnal ganda DITOLAK
  INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, refund_id, idempotency_key) VALUES (c1, 'NK-UJI-7', o, 100, 'tertaut', current_date, rf, 'uji-7'); lolos := lolos + 1;
  BEGIN INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, refund_id, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-8', o, 50, 'kedua', current_date, rf, 'uji-8'); RAISE EXCEPTION 'TIDAK_DITOLAK_refund_aktif_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, journal_id, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-7', o, 50, 'nomor ganda', current_date, je1, 'uji-9'); RAISE EXCEPTION 'TIDAK_DITOLAK_nomor_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, journal_id, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-10', o, 50, 'kunci ganda', current_date, je1, 'uji-7'); RAISE EXCEPTION 'TIDAK_DITOLAK_kunci_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  -- (4) nota mandiri sah (dengan jurnal) lolos; jurnal yang sama tidak boleh dipakai dua nota; setelah nota refund DIBATALKAN, refund boleh ditautkan lagi
  INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, journal_id, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-11', o, 75, 'mandiri', current_date, je1, 'uji-11'); lolos := lolos + 1;
  BEGIN INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, journal_id, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-12', o, 75, 'jurnal ganda', current_date, je1, 'uji-12'); RAISE EXCEPTION 'TIDAK_DITOLAK_jurnal_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  UPDATE fin_order_credits SET status = 'DIBATALKAN', cancelled_at = now(), cancel_reason = 'uji pembatalan' WHERE id = c1; lolos := lolos + 1;
  INSERT INTO fin_order_credits (id, credit_number, order_id, amount, reason, credit_date, refund_id, idempotency_key) VALUES (gen_random_uuid(), 'NK-UJI-13', o, 80, 'ulang', current_date, rf, 'uji-13'); lolos := lolos + 1;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%', tolak, lolos;
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 10 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti terlalu sedikit (${UJI_TOLAK:-?}; minimal 10) — constraint tidak aktif atau data contoh kurang"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" -ge 4 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos terlalu sedikit (${UJI_LOLOS:-?}; minimal 4)"; }
ok "perilaku terbukti di DB rehearsal: tolak=${UJI_TOLAK} lolos=${UJI_LOLOS} — CHECK/unik/FK menolak data salah; satu nota aktif per refund; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from fin_order_credits")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi + uji perilaku (sidik jari baris penuh tanpa kolom baru); tabel nota kredit baru kosong; DB sementara dihapus"

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
# SETELAH migrasi, SEBELUM switch: hanya backend LAMA yang melayani dan ia tidak mengenal tabel baru → tabel nota kredit HARUS kosong (tanpa backfill).
[ "$(psql_live -At -c "select count(*) from fin_order_credits")" = "0" ] || die "tabel fin_order_credits TIDAK kosong setelah migrasi sebelum switch"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari dokumen beku pasca-migrasi gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: tabel nota kredit kosong (tanpa backfill), dokumen pembanding beku identik"

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
[ "$(PSQLN "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'FinJournalSource' and e.enumlabel = 'NOTA_KREDIT_ORDER'")" = "1" ] || die "nilai enum NOTA_KREDIT_ORDER tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_constraint where conrelid = 'fin_order_credits'::regclass and contype = 'c' and conname like 'fin_order_credits_%_chk'")" = "4" ] || die "4 CHECK nota kredit tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'fin_order_credits_refund_aktif_uniq' and indexdef like '%WHERE%'")" = "1" ] || die "indeks unik parsial refund-aktif tidak ada setelah rilis"
ok "enum + tabel + 4 CHECK + indeks parsial satu-nota-aktif-per-refund ada (tidak ada asumsi tentang dokumen baru: nota sah boleh sudah terjadi)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test izin + validasi + pembacaan + invarian jurnal (baca-saja; tidak menulis; tahan terhadap transaksi sah yang muncul saat rilis)"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_TIDAK_SEIMBANG="$BASE_TIDAK_SEIMBANG" -e BASE_GANDA="$BASE_GANDA" -e BASE_TANPA_JURNAL="$BASE_TANPA_JURNAL" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
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
  if (method !== "GET") tulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status, code: json?.code ?? null });
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
const orderTakAda = "cmtidakadaxxxxxxxxxxxxxx";
const hitungSql = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const B = (k) => Number(process.env[k]);

// ── Penolakan SEBELUM menyentuh data (izin, Idempotency-Key) ──
const badanNota = { amount: 1, reason: "uji smoke", kind: "POTONGAN_HARGA", revisi: "x" };
const s1 = (await api("POST", `/api/finance/orders/${orderTakAda}/nota-kredit`, null, badanNota, { "Idempotency-Key": "smoke-nk-anon-1" })).status;
const s2 = (await api("POST", `/api/finance/orders/${orderTakAda}/nota-kredit`, tS, badanNota, { "Idempotency-Key": "smoke-nk-sales-1" })).status;
const s3 = (await api("POST", `/api/finance/orders/${orderTakAda}/nota-kredit`, tA, badanNota)).status;
rec("buat nota kredit: tanpa token 401, SALES 403, admin tanpa Idempotency-Key 428 (semua sebelum menyentuh data)", s1 === 401 && s2 === 403 && s3 === 428, `${s1},${s2},${s3}`);
if (tF) rec("buat nota kredit: FINANCE murni (tanpa finance:admin) 403", (await api("POST", `/api/finance/orders/${orderTakAda}/nota-kredit`, tF, badanNota, { "Idempotency-Key": "smoke-nk-fin-1" })).status === 403);
else skip("buat nota kredit: FINANCE murni 403", "tidak ada akun FINANCE murni (aktif, tanpa ADMIN/OWNER); akun/token tidak dibuat — izin dijaga tes integrasi");
const b1 = (await api("POST", `/api/finance/nota-kredit/${nol}/batal`, null, { reason: "uji smoke", revisi: "x" }, { "Idempotency-Key": "smoke-nk-batal-anon" })).status;
const b2 = (await api("POST", `/api/finance/nota-kredit/${nol}/batal`, tS, { reason: "uji smoke", revisi: "x" }, { "Idempotency-Key": "smoke-nk-batal-sales" })).status;
const b3 = (await api("POST", `/api/finance/nota-kredit/${nol}/batal`, tA, { reason: "uji smoke", revisi: "x" })).status;
rec("batalkan nota kredit: tanpa token 401, SALES 403, admin tanpa Idempotency-Key 428", b1 === 401 && b2 === 403 && b3 === 428, `${b1},${b2},${b3}`);
const SAH = new Set([400, 401, 403, 428]);
rec(`semua ${tulis.length} pemanggilan tulis ditolak sebelum menyentuh data (hanya 400/401/403/428): smoke TIDAK menulis data produksi`, tulis.length >= 5 && tulis.every((b) => SAH.has(b.status)), tulis.map((b) => `${b.n}=${b.status}`).join("; "));
// parameter UUID rusak -> 400 (bukan 500)
rec("batalkan nota id bukan UUID -> 400 ID_TIDAK_VALID (bukan 500)", await (async () => { const r = await api("POST", "/api/finance/nota-kredit/bukan-uuid/batal", tA, { reason: "uji smoke", revisi: "x" }, {}); tulis.pop(); return r.status === 400 && r.json?.code === "ID_TIDAK_VALID"; })());

// ── Pratinjau & pembacaan (baca-saja; pratinjau hanya pada id yang tidak ada → 404 sebelum transaksi) ──
const pr1 = (await api("GET", `/api/finance/orders/${orderTakAda}/nota-kredit/pratinjau?amount=1`, null)).status;
const pr2 = (await api("GET", `/api/finance/orders/${orderTakAda}/nota-kredit/pratinjau?amount=1`, tS)).status;
const pr3 = (await api("GET", `/api/finance/orders/${orderTakAda}/nota-kredit/pratinjau?amount=1`, tA)).status;
rec("pratinjau: tanpa token 401, SALES 403, admin order tak dikenal 404 (tidak membuat apa pun)", pr1 === 401 && pr2 === 403 && pr3 === 404, `${pr1},${pr2},${pr3}`);
if (tF) rec("pratinjau: FINANCE murni 403 (hanya Admin Keuangan)", (await api("GET", `/api/finance/orders/${orderTakAda}/nota-kredit/pratinjau?amount=1`, tF)).status === 403);
const pb = (await api("GET", `/api/finance/nota-kredit/${nol}/pratinjau-batal`, tA)).status;
rec("pratinjau pembatalan id tak dikenal -> 404", pb === 404, String(pb));
rec("daftar nota order tak dikenal -> 404; SALES 403; tanpa token 401", (await api("GET", `/api/finance/orders/${orderTakAda}/nota-kredit`, tA)).status === 404 && (await api("GET", `/api/finance/orders/${orderTakAda}/nota-kredit`, tS)).status === 403 && (await api("GET", `/api/finance/orders/${orderTakAda}/nota-kredit`)).status === 401);
const ord = await prisma.order.findFirst({ where: { paymentStatus: { in: ["LUNAS", "DP"] } }, orderBy: { updatedAt: "desc" }, select: { id: true } });
if (ord) {
  const g = await api("GET", `/api/finance/orders/${ord.id}/nota-kredit`, tA);
  const r = g.json?.ringkasan;
  rec("ringkasan order nyata (admin) 200: tagihan kotor/bersih, pembayaran bersih, sisa, status server vs tersimpan, token revisi", g.status === 200 && r && ["tagihanKotor", "tagihanBersih", "pembayaranBersih", "sisa", "statusServer", "statusTersimpan", "revisi"].every((k) => k in r) && typeof r.revisi === "string" && Array.isArray(g.json.notaKredit) && Array.isArray(g.json.refundKandidat), `${g.status}`);
  rec("belum ada nota kredit pada order nyata (rilis tidak membuat apa pun)", (g.json?.notaKredit ?? []).length === 0);
} else skip("ringkasan order nyata", "tidak ada order LUNAS/DP");
const daftar = await api("GET", "/api/finance/refunds", tA);
rec("daftar refund (admin) 200 memuat kolom notaKredit (null = belum tertaut) tanpa merusak nominal/biaya/total keluar", daftar.status === 200 && Array.isArray(daftar.json?.refunds) && daftar.json.refunds.every((x) => "notaKredit" in x && x.totalKeluarRekening === x.nominalDiterima + x.biayaAdmin), `${daftar.json?.refunds?.length} refund`);
const hari = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const ex = await fetch(`${BASE}/api/finance/export/piutang-refund`, { method: "POST", headers: { Authorization: "Bearer " + tA, "Content-Type": "application/json" }, body: JSON.stringify({ periode: { to: hari }, filter: {} }) });
const exBuf = Buffer.from(await ex.arrayBuffer());
rec("export Piutang & Refund (admin) 200 berkas .xlsx", ex.status === 200 && /spreadsheetml/.test(ex.headers.get("content-type") || "") && exBuf.length > 1000 && exBuf.subarray(0, 2).toString() === "PK", `${ex.status} ${exBuf.length} byte`);

// ── Invarian (data apa pun; dibandingkan dengan garis dasar sebelum rilis) ──
rec(`jurnal tidak seimbang (sebelum rilis: ${B("BASE_TIDAK_SEIMBANG")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x`)) <= B("BASE_TIDAK_SEIMBANG"));
rec(`tiap refund punya paling banyak SATU jurnal berlaku (ganda sebelum rilis: ${B("BASE_GANDA")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from (select source_id from fin_journal_entries where source::text = 'REFUND' and status::text = 'POSTED' group by source_id having count(*) > 1) x`)) <= B("BASE_GANDA"));
rec(`refund disetujui tanpa jurnal berlaku (sebelum rilis: ${B("BASE_TANPA_JURNAL")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from fin_refunds r where r.status::text = 'DISETUJUI' and not exists (select 1 from fin_journal_entries e where e.source::text = 'REFUND' and e.source_id = r.id::text and e.status::text = 'POSTED')`)) <= B("BASE_TANPA_JURNAL"));
rec("setiap nota kredit AKTIF punya refund tertaut ATAU jurnal (tidak ada nota yatim)", (await hitungSql(`select count(*)::int n from fin_order_credits where status = 'AKTIF' and refund_id is null and journal_id is null`)) === 0);
rec("tidak ada dua nota AKTIF pada refund yang sama", (await hitungSql(`select count(*)::int n from (select refund_id from fin_order_credits where status = 'AKTIF' and refund_id is not null group by refund_id having count(*) > 1) x`)) === 0);
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
  ok "smoke test lulus (izin, validasi, pratinjau tanpa menulis, pembacaan ringkasan/daftar refund/export, invarian jurnal)"
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
say "TINDAK LANJUT OWNER: data lama TIDAK berubah. Koreksi order Sofyan (RES-07102026-037) = satu Nota Kredit TERTAUT RFD-12102026-002 (tanpa jurnal baru) — dilakukan manual lewat aplikasi SETELAH Owner mengonfirmasi nama/customer. Tidak ada koreksi otomatis."
