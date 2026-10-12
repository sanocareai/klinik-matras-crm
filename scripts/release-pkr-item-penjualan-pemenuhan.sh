#!/usr/bin/env bash
# RILIS "ITEM PENJUALAN & PEMENUHAN TERPADU" (Penjualan Karyawan): web + backend + 1 migrasi ADITIF — workflow RELEASE-DIRECTORY di atas release aktif (BASE_SHA). FAIL-CLOSED.
#   Satu baris item penjualan = sumber kanonis (fin_penjualan_karyawan_items): Finance menghitung total/piutang/jurnal dari baris itu; Order CRM (nilai 0) membuat item operasional dari baris yang
#   sama (pkr_order_items.sale_item_id), Produksi membuat unit, Delivery/Pickup mengikuti cara pemenuhan. Koreksi baris atomik (Finance + operasional + jurnal dibalik-posting ulang).
#   Migrasi: 20261104090000_pkr_item_penjualan_pemenuhan — 17 kolom NULL + 3 FK + 3 indeks + 7 CHECK + 4 fungsi + 3 trigger penjaga. TANPA tabel baru, TANPA backfill/UPDATE/DELETE.
# Order PKR lama dan PKR multi-item yang sudah ada TIDAK diubah (kolom baru NULL = "data lama"). Produksi: verifikasi hanya baca + penolakan izin; TIDAK ada PKR/koreksi/pengiriman/transaksi QA.
# Uji perilaku constraint/trigger dijalankan di DB REHEARSAL (hasil restore backup), seluruhnya dibatalkan.
#
#   cat scripts/release-pkr-item-penjualan-pemenuhan.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/pkri1.sh'
#   ssh ubuntu@43.133.152.6 'bash /tmp/pkri1.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'
#   ssh ubuntu@43.133.152.6 'nohup bash /tmp/pkri1.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/pkri1.out 2>&1 < /dev/null &'   # upload & jalankan TERPISAH
#
# ROLLBACK: kode HANYA boleh di-rollback bila belum ada baris penjualan terpadu / item operasional bertaut / revisi bersisi Finance. Periksa dulu dengan
# scripts/rollback-guard-pkr-item-penjualan-pemenuhan.sh (baca-saja; menolak bila kanonis sudah dipakai: kode lama tidak memelihara tautan baris penjualan <-> item operasional,
# sehingga koreksi lewat kode lama bisa menyimpangkan jumlah/nama dan ditolak penjaga DB).
set -Eeuo pipefail
umask 077

DEPLOY_SHA="${1:-}"; BASE_SHA="${2:-}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 1 harus SHA rilis 40 karakter" >&2; exit 1; }
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: argumen 2 harus SHA release aktif (baseline) 40 karakter" >&2; exit 1; }
CAND_BRANCH="${CAND_BRANCH:-feat/pkr-item-penjualan-pemenuhan}"
# Migrasi aditif yang SUDAH diaudit: nama:sha256 isi (LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
MIGS="20261104090000_pkr_item_penjualan_pemenuhan:a71d9ac8e244615e5ecee9491f727a2b8743cccc133b630e32c19ff2195ee6c9"
# Hasil pemindai untuk migrasi di atas (jumlah per jenis pernyataan). Selisih = berhenti.
SCAN_EXPECT='{"total":37,"add_column":17,"fk":3,"create_index":3,"check":7,"trigger":3,"fungsi":4}'
# Berkas yang BOLEH berbeda dari baseline: EKSPLISIT path persis. Apa pun di luar daftar = berhenti.
ALLOWED_RE='^(backend/prisma/migrations/20261104090000_pkr_item_penjualan_pemenuhan/migration\.sql|backend/prisma/schema\.prisma|backend/src/lib/domain/pkrPenjualanItem\.js|backend/src/routes/financePenjualanKaryawan\.js|backend/src/services/finance/penjualanKaryawanManual\.js|backend/src/services/finance/posting/penjualanKaryawan\.js|backend/src/services/penjualanKaryawanItem\.js|backend/src/services/penjualanKaryawanKoreksi\.js|backend/src/services/penjualanKaryawanKoreksiBaris\.js|backend/src/services/penjualanKaryawanOrder\.js|backend/src/services/penjualanKaryawanTerpadu\.js|backend/src/services/pkrItemRevisi\.js|backend/tests/integration/pkrItemInvarian\.integration\.test\.js|backend/tests/integration/pkrItemTerpadu\.integration\.test\.js|docs/PKR-ITEM-TERPADU-PEMETAAN\.md|frontend/src/api\.js|frontend/src/features/finance/PkrItemForm\.jsx|frontend/src/features/finance/PkrItemPenjualanForm\.jsx|frontend/src/features/finance/PkrKoreksiBaris\.jsx|frontend/src/features/finance/PkrPratinjau\.jsx|frontend/src/features/finance/detailSpecs\.js|frontend/src/features/finance/pkrItemLogic\.js|frontend/src/pages/finance/FinancePenjualanKaryawan\.jsx|frontend/tests/penjualanKaryawanDesimal\.test\.js|frontend/tests/pkrItemPenjualanUI\.test\.js|frontend/tests/pkrItemUI\.test\.js|frontend/tests/pkrOrderCrmUI\.test\.js|scripts/release-pkr-item-penjualan-pemenuhan\.sh|scripts/rollback-guard-pkr-item-penjualan-pemenuhan\.sh)$'
BACKEND_SRC_EXPECT="backend/src/lib/domain/pkrPenjualanItem.js backend/src/routes/financePenjualanKaryawan.js backend/src/services/finance/penjualanKaryawanManual.js backend/src/services/finance/posting/penjualanKaryawan.js backend/src/services/penjualanKaryawanItem.js backend/src/services/penjualanKaryawanKoreksi.js backend/src/services/penjualanKaryawanKoreksiBaris.js backend/src/services/penjualanKaryawanOrder.js backend/src/services/penjualanKaryawanTerpadu.js backend/src/services/pkrItemRevisi.js"
FRONTEND_SRC_EXPECT="frontend/src/api.js frontend/src/features/finance/PkrItemForm.jsx frontend/src/features/finance/PkrItemPenjualanForm.jsx frontend/src/features/finance/PkrKoreksiBaris.jsx frontend/src/features/finance/PkrPratinjau.jsx frontend/src/features/finance/detailSpecs.js frontend/src/features/finance/pkrItemLogic.js frontend/src/pages/finance/FinancePenjualanKaryawan.jsx"
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
BK_DIR="$HOME/release-backups/pkr-item-terpadu-${DEPLOY_SHORT}-${TS}"
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
   bash ${NEW_DIR}/scripts/rollback-guard-pkr-item-penjualan-pemenuhan.sh
Guard menolak (exit 1) bila kanonis SUDAH dipakai:
   - baris penjualan terpadu (fin_penjualan_karyawan_items.fulfillment terisi),
   - item operasional bertaut baris penjualan (pkr_order_items.sale_item_id terisi),
   - revisi bersisi Finance (pkr_item_revisions.finance_before/finance_after terisi).
   Bila guard menolak: JANGAN rollback ke kode lama (kode lama tidak memelihara tautan baris penjualan <-> item operasional dan penjaga DB menolak koreksinya).
   Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner (pembatalan PKR lewat jalur resmi).
Bila guard lulus (kanonis belum dipakai), rollback kode:
   cd ${PREV_DIR:-<release-sebelumnya>}
   docker tag ${ROLLBACK_TAG:-<tag-rollback>} ${IMG_NAME:-klinik-matras-backend:latest}
   SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend
Migrasi hanya MENAMBAH kolom NULL/indeks/CHECK/fungsi/trigger: dibiarkan terpasang pun aman bagi kode lama SELAMA kanonis belum dipakai. (Tidak dihapus oleh rollback kode.)
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
exec 9>/tmp/release-pkr-item-pemenuhan.lock; flock -n 9 || die "rilis ini sudah berjalan"
OTHER="$(pgrep -af 'release-[a-z0-9-]+\.sh|docker compose .*(up|build)|docker build|prisma migrate' | grep -v "pkri1\|release-pkr-item-pemenuhan\|pgrep\|node src/index.js" | grep -v "$$" || true)"  # 'node src/index.js' = perintah start container backend yang SEDANG melayani (bukan deploy)
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
// Pemindai migrasi rilis "Item Penjualan & Pemenuhan terpadu" (1 migrasi aditif). Dijalankan di VPS oleh skrip rilis; juga dijalankan lokal terhadap berkas migrasi. FAIL-CLOSED, daftar putih per pernyataan.
//  (a) kolom BARU nullable: tepat 11 pada fin_penjualan_karyawan_items, 4 pada pkr_order_items, 2 pada pkr_item_revisions (tanpa DEFAULT/NOT NULL -> tidak ada rewrite/backfill),
//  (b) 3 FK (dari tabel yang diaudit ke tabel yang diaudit), 3 indeks (1 UNIQUE), 7 CHECK bernama, tanpa subquery,
//  (c) 4 fungsi plpgsql (badan hanya membaca 2 tabel yang diaudit, hanya RAISE/PERFORM/RETURN) + 3 trigger (2 constraint trigger tertunda + 1 BEFORE DELETE).
// Tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/RENAME/ALTER COLUMN, tidak ada tabel baru, tidak ada perubahan pada tabel lama selain penambahan di atas.
import fs from "node:fs";
let sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const hitung = {};
const tambah = (k) => { hitung[k] = (hitung[k] ?? 0) + 1; };
const gagal = (m) => { console.error(m); process.exit(1); };
const KOLOM_OK = new Set([
  "fin_penjualan_karyawan_items.category_id", "fin_penjualan_karyawan_items.product_id", "fin_penjualan_karyawan_items.category_code", "fin_penjualan_karyawan_items.category_name",
  "fin_penjualan_karyawan_items.fulfillment", "fin_penjualan_karyawan_items.perlu_dikirim", "fin_penjualan_karyawan_items.length_cm", "fin_penjualan_karyawan_items.width_cm",
  "fin_penjualan_karyawan_items.thickness_cm", "fin_penjualan_karyawan_items.height_cm", "fin_penjualan_karyawan_items.spec_notes",
  "pkr_order_items.sale_item_id", "pkr_order_items.component_seq", "pkr_order_items.component_qty", "pkr_order_items.fulfillment",
  "pkr_item_revisions.finance_before", "pkr_item_revisions.finance_after",
]);
const FK_OK = new Set([
  "fin_penjualan_karyawan_items.category_id>pkr_item_categories:RESTRICT", "fin_penjualan_karyawan_items.product_id>pkr_item_products:SET NULL",
  "pkr_order_items.sale_item_id>fin_penjualan_karyawan_items:SET NULL",
]);
const INDEKS_OK = new Set(["fin_penjualan_karyawan_items_category_id_idx", "pkr_order_items_sale_item_id_idx", "pkr_order_items_sale_component_key"]);
const CHECK_OK = new Set([
  "fin_pkr_items_fulfillment_chk", "fin_pkr_items_lama_polos_chk", "fin_pkr_items_operasional_kategori_chk", "fin_pkr_items_tanpa_unit_kirim_chk", "fin_pkr_items_dim_chk",
  "pkr_order_items_fulfillment_chk", "pkr_order_items_tautan_chk",
]);
const TABEL_CHECK_OK = { fin_penjualan_karyawan_items: 5, pkr_order_items: 2 };
const TRIGGER_OK = new Set([
  'CREATE CONSTRAINT TRIGGER "pkr_order_items_tautan_trg" AFTER INSERT OR UPDATE ON "pkr_order_items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pkr_trg_tautan_item_order"()',
  'CREATE CONSTRAINT TRIGGER "fin_penjualan_karyawan_items_tautan_trg" AFTER UPDATE OF "quantity", "name" ON "fin_penjualan_karyawan_items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pkr_trg_tautan_item_penjualan"()',
  'CREATE TRIGGER "fin_penjualan_karyawan_items_cegah_hapus_trg" BEFORE DELETE ON "fin_penjualan_karyawan_items" FOR EACH ROW EXECUTE FUNCTION "pkr_trg_cegah_hapus_item_penjualan"()',
]);
// Badan fungsi diaudit per fungsi: argumen, tipe kembali, tabel yang dibaca, fungsi yang dipanggil, jumlah RAISE.
const FUNGSI_OK = {
  pkr_validasi_tautan_item: { args: "p_sale UUID", ret: "void", from: ["fin_penjualan_karyawan_items", "pkr_order_items"], perform: [], raise: 3 },
  pkr_trg_tautan_item_order: { args: "", ret: "trigger", from: [], perform: ["pkr_validasi_tautan_item"], raise: 0 },
  pkr_trg_tautan_item_penjualan: { args: "", ret: "trigger", from: [], perform: ["pkr_validasi_tautan_item"], raise: 0 },
  pkr_trg_cegah_hapus_item_penjualan: { args: "", ret: "trigger", from: ["pkr_order_items"], perform: [], raise: 1 },
};
const TERLARANG = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|EXECUTE|GRANT|REVOKE|COPY|CALL|DO|COMMIT|ROLLBACK|SET)\b/i;

const FN_RE = /CREATE FUNCTION "([a-z_]+)"\(([^)]*)\) RETURNS (void|trigger) AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/g;
const sudah = new Set();
for (const m of sql.matchAll(FN_RE)) {
  const [, nama, args, ret, tubuh] = m;
  const spek = FUNGSI_OK[nama];
  if (!spek) gagal(`fungsi di luar daftar putih: ${nama}`);
  if (sudah.has(nama)) gagal(`fungsi duplikat: ${nama}`);
  sudah.add(nama);
  if (rapat(args) !== spek.args) gagal(`argumen fungsi ${nama} berubah: ${args}`);
  if (ret !== spek.ret) gagal(`tipe kembali fungsi ${nama} berubah: ${ret}`);
  const badan = tubuh.replace(/'(?:[^']|'')*'/g, "''");
  if (TERLARANG.test(badan)) gagal(`badan fungsi ${nama} memuat perintah di luar daftar putih`);
  if (/\$[a-z_]*\$/i.test(badan)) gagal(`badan fungsi ${nama} memuat dollar-quote bersarang`);
  const dari = [...badan.matchAll(/\bFROM\s+"([a-z_]+)"/gi)].map((x) => x[1]).sort();
  if (JSON.stringify(dari) !== JSON.stringify([...spek.from].sort())) gagal(`fungsi ${nama} membaca tabel di luar yang diaudit: ${dari.join(",")}`);
  const panggil = [...badan.matchAll(/\bPERFORM\s+"([a-z_]+)"/gi)].map((x) => x[1]);
  if (JSON.stringify(panggil) !== JSON.stringify(spek.perform)) gagal(`fungsi ${nama} memanggil fungsi di luar yang diaudit`);
  if ((badan.match(/RAISE EXCEPTION/g) ?? []).length !== spek.raise) gagal(`fungsi ${nama}: jumlah RAISE EXCEPTION bukan ${spek.raise}`);
  tambah("fungsi");
}
if (sudah.size !== Object.keys(FUNGSI_OK).length) gagal(`fungsi harus tepat ${Object.keys(FUNGSI_OK).length} (ditemukan ${sudah.size})`);
sql = sql.replace(FN_RE, "");

const stmts = sql.split(";").map((x) => x.trim()).filter(Boolean);
const dilihat = new Set();
const unik = (jenis, nama) => { const k = `${jenis}:${nama}`; if (dilihat.has(k)) gagal(`${jenis} duplikat: ${nama}`); dilihat.add(k); };
const checkPerTabel = {};
for (const st of stmts) {
  const r = rapat(st);
  let m;
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD COLUMN "([a-z_]+)" (UUID|VARCHAR\(\d+\)|BOOLEAN|DECIMAL\(7,1\)|INTEGER|JSONB)$/.exec(r))) {
    const k = `${m[1]}.${m[2]}`;
    if (!KOLOM_OK.has(k)) gagal(`ADD COLUMN di luar daftar putih: ${k}`);
    unik("kolom", k); tambah("add_column"); continue; // nullable, tanpa DEFAULT: tidak ada backfill/rewrite
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+_fkey)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "([a-z_]+)"\("id"\) ON DELETE (RESTRICT|SET NULL) ON UPDATE CASCADE$/.exec(r))) {
    const k = `${m[1]}.${m[3]}>${m[4]}:${m[5]}`;
    if (!FK_OK.has(k)) gagal(`FK di luar daftar putih: ${k}`);
    unik("fk", k); tambah("fk"); continue;
  }
  if ((m = /^CREATE (UNIQUE )?INDEX "([a-z_]+)" ON "([a-z_]+)"\("([a-z_]+)"(?:, "([a-z_]+)")?\)$/.exec(r))) {
    if (!INDEKS_OK.has(m[2])) gagal(`indeks di luar daftar putih: ${m[2]}`);
    if (m[3] !== "fin_penjualan_karyawan_items" && m[3] !== "pkr_order_items") gagal(`indeks pada tabel di luar daftar: ${m[3]}`);
    unik("indeks", m[2]); tambah("create_index"); continue;
  }
  if ((m = /^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+)" CHECK \((.+)\)$/.exec(r))) {
    if (!CHECK_OK.has(m[2])) gagal(`CHECK dengan nama di luar yang diaudit: ${m[2]}`);
    if (!(m[1] in TABEL_CHECK_OK)) gagal(`CHECK pada tabel di luar daftar: ${m[1]}`);
    if (/\b(SELECT|FROM|INSERT|UPDATE|DELETE)\b/i.test(m[3])) gagal(`CHECK memuat subquery/perintah menulis: ${m[2]}`);
    checkPerTabel[m[1]] = (checkPerTabel[m[1]] ?? 0) + 1;
    unik("check", m[2]); tambah("check"); continue;
  }
  if (TRIGGER_OK.has(r)) { unik("trigger", r); tambah("trigger"); continue; }
  gagal(`PERNYATAAN DI LUAR DAFTAR PUTIH: ${r.slice(0, 200)}`);
}
for (const [t, n] of Object.entries(TABEL_CHECK_OK)) if ((checkPerTabel[t] ?? 0) !== n) gagal(`CHECK pada ${t} harus tepat ${n} (ada ${checkPerTabel[t] ?? 0})`);
if ((hitung.add_column ?? 0) !== KOLOM_OK.size) gagal(`kolom tambahan harus tepat ${KOLOM_OK.size}`);
if ((hitung.fk ?? 0) !== FK_OK.size) gagal(`FK harus tepat ${FK_OK.size}`);
if ((hitung.create_index ?? 0) !== INDEKS_OK.size) gagal(`indeks harus tepat ${INDEKS_OK.size}`);
if ((hitung.trigger ?? 0) !== TRIGGER_OK.size) gagal(`trigger harus tepat ${TRIGGER_OK.size}`);
console.log(JSON.stringify({ total: stmts.length + (hitung.fungsi ?? 0), add_column: 0, fk: 0, create_index: 0, check: 0, trigger: 0, fungsi: 0, ...hitung }));
SCANJS
sql_bersih() { grep -v '^[[:space:]]*--' | grep -v '^[[:space:]]*$'; }
HASIL_SCAN="$(printf '%s\n' "$ALL_SQL" | sql_bersih | node "$SCAN")" || die "migrasi memuat pernyataan di luar daftar putih yang diaudit"
[ "$HASIL_SCAN" = "$SCAN_EXPECT" ] || die "hitungan pernyataan migrasi BERBEDA dari yang diaudit: ${HASIL_SCAN}"
ok "migrasi: DDL aditif (17 kolom NULL, 3 FK, 3 indeks, 7 CHECK bernama, 4 fungsi plpgsql penjaga + 3 trigger); tanpa DROP/DELETE/UPDATE/INSERT/ALTER COLUMN/RENAME/GRANT; tanpa tabel baru"
# UJI NEGATIF PEMINDAI: setiap mutan HARUS ditolak (exit ≠ 0) atau menghasilkan hitungan ≠ SCAN_EXPECT. Mutan yang lolos = pemindai tidak bisa dipercaya → berhenti.
NEG=0
harus_ditolak() {
  local nama="$1" teks="$2" o
  if o="$(printf '%s\n' "$teks" | sql_bersih | node "$SCAN" 2>/dev/null)" && [ "$o" = "$SCAN_EXPECT" ]; then die "uji negatif pemindai: mutan '${nama}' LOLOS (seharusnya ditolak)"; fi
  NEG=$((NEG+1))
}
tambah_stmt() { printf '%s\n%s\n' "$ALL_SQL" "$1"; }
harus_ditolak "DROP TABLE tabel lama" "$(tambah_stmt 'DROP TABLE "units";')"
harus_ditolak "UPDATE tabel lama (backfill baris penjualan)" "$(tambah_stmt "UPDATE \"fin_penjualan_karyawan_items\" SET \"fulfillment\" = 'PRODUKSI_BARU';")"
harus_ditolak "UPDATE tabel lama (item operasional)" "$(tambah_stmt "UPDATE \"pkr_order_items\" SET \"fulfillment\" = 'PRODUKSI_BARU';")"
harus_ditolak "UPDATE tabel lama (Order.value)" "$(tambah_stmt "UPDATE \"Order\" SET \"value\" = 0;")"
harus_ditolak "DELETE tabel lama" "$(tambah_stmt 'DELETE FROM "jobs";')"
harus_ditolak "INSERT tabel lama" "$(tambah_stmt "INSERT INTO \"fin_settings\" (\"key\", \"value\") VALUES ('x', 'y');")"
harus_ditolak "TRUNCATE" "$(tambah_stmt 'TRUNCATE "fin_penjualan_karyawan_items";')"
harus_ditolak "DROP COLUMN" "$(tambah_stmt 'ALTER TABLE "fin_penjualan_karyawan_items" DROP COLUMN "unit_price";')"
harus_ditolak "ALTER COLUMN tipe" "$(tambah_stmt 'ALTER TABLE "fin_penjualan_karyawan_items" ALTER COLUMN "unit_price" TYPE INTEGER;')"
harus_ditolak "RENAME COLUMN" "$(tambah_stmt 'ALTER TABLE "fin_penjualan_karyawan_items" RENAME COLUMN "unit_price" TO "harga";')"
harus_ditolak "kolom baru NOT NULL DEFAULT (rewrite tabel)" "$(tambah_stmt "ALTER TABLE \"fin_penjualan_karyawan_items\" ADD COLUMN \"fulfillment2\" VARCHAR(24) NOT NULL DEFAULT 'x';")"
harus_ditolak "kolom baru di luar daftar (kolom harga di item operasional)" "$(tambah_stmt 'ALTER TABLE "pkr_order_items" ADD COLUMN "harga" DECIMAL(7,1);')"
harus_ditolak "kolom baru di tabel lain (Order)" "$(tambah_stmt 'ALTER TABLE "Order" ADD COLUMN "x" TEXT;')"
harus_ditolak "indeks pada tabel lama" "$(tambah_stmt 'CREATE INDEX "x_idx" ON "units"("service_id");')"
harus_ditolak "FK ke tabel di luar daftar" "$(printf '%s\n' "$ALL_SQL" | sed 's/REFERENCES "pkr_item_categories"("id")/REFERENCES "Customer"("id")/')"
harus_ditolak "FK baru dari tabel lama" "$(tambah_stmt 'ALTER TABLE "units" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')"
harus_ditolak "CHECK dengan nama tak diaudit" "$(tambah_stmt 'ALTER TABLE "pkr_order_items" ADD CONSTRAINT "evil_chk" CHECK (true);')"
harus_ditolak "nama CHECK diganti" "$(printf '%s\n' "$ALL_SQL" | sed 's/"fin_pkr_items_dim_chk"/"fin_pkr_items_evil_chk"/')"
harus_ditolak "CHECK memuat subquery" "$(printf '%s\n' "$ALL_SQL" | sed 's/CHECK ("fulfillment" IS NULL OR "fulfillment" IN (.PRODUKSI_BARU., .SERVICE_PICKUP., .AMBIL_STOK., .TANPA_OPERASIONAL.))/CHECK ((SELECT count(*) FROM units) >= 0)/')"
harus_ditolak "GRANT" "$(tambah_stmt 'GRANT ALL ON "fin_penjualan_karyawan_items" TO PUBLIC;')"
harus_ditolak "trigger kedua pada tabel lama" "$(tambah_stmt 'CREATE TRIGGER trg_evil BEFORE DELETE ON "units" FOR EACH ROW EXECUTE FUNCTION "pkr_trg_cegah_hapus_item_penjualan"();')"
harus_ditolak "trigger dimatikan" "$(tambah_stmt 'ALTER TABLE "pkr_order_items" DISABLE TRIGGER ALL;')"
harus_ditolak "fungsi menulis (DELETE di badan)" "$(printf '%s\n' "$ALL_SQL" | sed 's/^  IF EXISTS (SELECT 1 FROM "pkr_order_items"/  DELETE FROM units; IF EXISTS (SELECT 1 FROM "pkr_order_items"/')"
harus_ditolak "fungsi membaca tabel di luar daftar" "$(printf '%s\n' "$ALL_SQL" | sed 's/FROM "fin_penjualan_karyawan_items" WHERE "id" = p_sale/FROM "fin_settings" WHERE "id" = p_sale/')"
harus_ditolak "fungsi menolak lebih sedikit (RAISE hilang)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'PKR_ITEM_MASIH_DIPAKAI')"
harus_ditolak "fungsi tambahan liar" "$(tambah_stmt 'CREATE FUNCTION "pkr_evil"() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;')"
harus_ditolak "satu indeks hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'pkr_order_items_sale_item_id_idx')"
harus_ditolak "satu kolom hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'ADD COLUMN "spec_notes"')"
harus_ditolak "trigger hilang (hitungan beda)" "$(printf '%s\n' "$ALL_SQL" | grep -v 'fin_penjualan_karyawan_items_cegah_hapus_trg')"
[ "$NEG" -ge 28 ] || die "uji negatif pemindai hanya ${NEG} mutan (minimal 28)"
ok "uji negatif pemindai: ${NEG} mutan migrasi (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER COLUMN/RENAME/kolom-indeks-FK di luar daftar/CHECK liar/subquery/GRANT/trigger liar atau dimatikan/fungsi menulis/membaca tabel lain/RAISE hilang/hitungan beda) SEMUANYA ditolak"
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
# Prasyarat skema: tabel yang disentuh HARUS sudah ada (rilis PKR multi-item sebelumnya); objek rilis ini belum boleh ada.
for T in fin_penjualan_karyawan fin_penjualan_karyawan_items pkr_order_items pkr_order_item_units pkr_item_revisions pkr_item_categories pkr_item_products pkr_bundle_components pkr_pengiriman_sebagian "Order" units jobs job_units payments invoices fin_journal_entries fin_journal_lines fin_settings; do
  [ "$(psql_live -At -c "select count(*) from information_schema.tables where table_schema='public' and table_name='$T'")" = "1" ] || die "tabel $T belum ada di produksi (prasyarat: rilis PKR multi-item harus sudah live)"
done
[ "$(psql_live -At -c "select count(*) from information_schema.columns where table_schema='public' and ((table_name='fin_penjualan_karyawan_items' and column_name in ('category_id','product_id','category_code','category_name','fulfillment','perlu_dikirim','length_cm','width_cm','thickness_cm','height_cm','spec_notes')) or (table_name='pkr_order_items' and column_name in ('sale_item_id','component_seq','component_qty','fulfillment')) or (table_name='pkr_item_revisions' and column_name in ('finance_before','finance_after')))")" = "0" ] || die "kolom rilis ini SUDAH ada di produksi (tidak diharapkan)"
[ "$(psql_live -At -c "select count(*) from pg_proc where proname in ('pkr_validasi_tautan_item','pkr_trg_tautan_item_order','pkr_trg_tautan_item_penjualan','pkr_trg_cegah_hapus_item_penjualan')")" = "0" ] || die "fungsi penjaga rilis ini SUDAH ada di produksi (tidak diharapkan)"
for m in $MIG_LIST; do [ "$(psql_live -At -c "select count(*) from _prisma_migrations where migration_name='${m}'")" = "0" ] || die "migrasi ${m} SUDAH tercatat di produksi (tidak diharapkan)"; done
PKR_N="$(psql_live -At -c "select count(*) from fin_penjualan_karyawan")"; PKR_ITEM_N="$(psql_live -At -c "select count(*) from fin_penjualan_karyawan_items")"
PKR_ORD_N="$(psql_live -At -c "select count(*) from \"Order\" where penjualan_karyawan_id is not null")"; OPS_ITEM_N="$(psql_live -At -c "select count(*) from pkr_order_items")"
ok "prasyarat skema terpenuhi; PKR=${PKR_N} (baris penjualan ${PKR_ITEM_N}; order tertaut ${PKR_ORD_N}; item operasional ${OPS_ITEM_N}) — semua dibiarkan apa adanya, tanpa backfill"
# GARIS DASAR invarian lama (dibandingkan sesudah rilis; angka lama nol atau tidak, yang dijaga = TIDAK BERTAMBAH oleh rilis ini).
BASE_PAY="$(psql_live -At -c "select count(*) from payments p join \"Order\" o on o.id = p.order_id where o.penjualan_karyawan_id is not null")"
BASE_INV="$(psql_live -At -c "select count(*) from invoices i join \"Order\" o on o.id = i.order_id where o.penjualan_karyawan_id is not null")"
BASE_VAL="$(psql_live -At -c "select count(*) from \"Order\" o where o.penjualan_karyawan_id is not null and o.value <> 0")"
BASE_REV="$(psql_live -At -c "select count(*) from fin_journal_entries e where e.source::text = 'PENGAKUAN_PENDAPATAN' and e.source_id in (select id from \"Order\" where penjualan_karyawan_id is not null)")"
BASE_JGANDA="$(psql_live -At -c "select count(*) from (select source_id from fin_journal_entries where source::text = 'PENJUALAN_KARYAWAN' and status::text = 'POSTED' group by source_id having count(*) > 1) x")"
BASE_TOTAL="$(psql_live -At -c "select count(*) from fin_penjualan_karyawan p where abs(p.total - coalesce((select sum(i.quantity * i.unit_price) from fin_penjualan_karyawan_items i where i.penjualan_id = p.id), 0)) > 0.005")"
for v in "$BASE_PAY" "$BASE_INV" "$BASE_VAL" "$BASE_REV" "$BASE_JGANDA" "$BASE_TOTAL"; do [[ "$v" =~ ^[0-9]+$ ]] || die "garis dasar invarian bukan angka: '$v'"; done
printf 'BASE_PAY=%s BASE_INV=%s BASE_VAL=%s BASE_REV=%s BASE_JGANDA=%s BASE_TOTAL=%s\n' "$BASE_PAY" "$BASE_INV" "$BASE_VAL" "$BASE_REV" "$BASE_JGANDA" "$BASE_TOTAL" > "$BK_DIR/garis-dasar.env"
ok "garis dasar invarian: pembayaran/invoice/pendapatan pada order PKR = ${BASE_PAY}/${BASE_INV}/${BASE_REV}; order PKR bernilai ≠ 0 = ${BASE_VAL}; PKR dengan >1 jurnal berlaku = ${BASE_JGANDA}; total ≠ Σ baris = ${BASE_TOTAL}"
# SIDIK JARI TABEL LAMA: seluruh isi baris (jsonb) per tabel, TANPA kolom yang ditambahkan rilis ini. Membuktikan restore identik dan migrasi tidak mengubah data lama.
FP_SQL="select 'fin_penjualan_karyawan', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan x
union all select 'fin_penjualan_karyawan_items', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['category_id','product_id','category_code','category_name','fulfillment','perlu_dikirim','length_cm','width_cm','thickness_cm','height_cm','spec_notes'])::text, '|' order by x.id),'')) from fin_penjualan_karyawan_items x
union all select 'fin_penjualan_karyawan_payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan_payments x
union all select 'order', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from \"Order\" x
union all select 'units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from units x
union all select 'jobs', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from jobs x
union all select 'job_units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from job_units x
union all select 'payments', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x
union all select 'invoices', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from invoices x
union all select 'pkr_order_items', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['sale_item_id','component_seq','component_qty','fulfillment'])::text, '|' order by x.id),'')) from pkr_order_items x
union all select 'pkr_order_item_units', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from pkr_order_item_units x
union all select 'pkr_item_revisions', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['finance_before','finance_after'])::text, '|' order by x.id),'')) from pkr_item_revisions x
union all select 'pkr_pengiriman_sebagian', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from pkr_pengiriman_sebagian x
union all select 'pkr_item_categories', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from pkr_item_categories x
union all select 'pkr_item_products', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from pkr_item_products x
union all select 'pkr_bundle_components', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from pkr_bundle_components x
union all select 'service_catalog', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from service_catalog x
union all select 'production_runs_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_runs_v2 x
union all select 'production_run_plans_v2', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from production_run_plans_v2 x
union all select 'fin_journal_entries', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_entries x
union all select 'fin_journal_lines', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x"
FP_N=21
# DOKUMEN PEMBANDING DIBEKUKAN: hanya yang menurut aturan bisnis tidak mungkin berubah akibat rilis ini (PKR dibatalkan, order/unit terakhir Delivered/Cancelled, job tuntas yang sudah diam sebelum T0,
# baris jurnal yang dibuat sebelum T0 (append-only), saldo per akun dari jurnal itu, seluruh flag fin_settings). T0 = jam DB (UTC) 5 menit lalu. Dokumen terbuka dan transaksi baru TIDAK diperbandingkan.
T0="$(psql_live -At -c "select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS')")"
[[ "$T0" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$ ]] || die "T0 tidak valid: $T0"
FP_BEKU_SQL="$(cat <<FPBEKU
select 'pkr_batal', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_penjualan_karyawan x where x.status = 'DIBATALKAN' and x.updated_at < '$T0'::timestamp
union all select 'pkr_batal_baris', count(*), md5(coalesce(string_agg((to_jsonb(x) - ARRAY['category_id','product_id','category_code','category_name','fulfillment','perlu_dikirim','length_cm','width_cm','thickness_cm','height_cm','spec_notes'])::text, '|' order by x.id),'')) from fin_penjualan_karyawan_items x where x.penjualan_id in (select id from fin_penjualan_karyawan where status = 'DIBATALKAN' and updated_at < '$T0'::timestamp)
union all select 'order_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from "Order" x where x.status in ('DELIVERED','CANCELLED') and x."updatedAt" < '$T0'::timestamp
union all select 'unit_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from units x where x.status in ('DELIVERED','CANCELLED') and x.updated_at < '$T0'::timestamp
union all select 'job_final', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from jobs x where x.status in ('COMPLETED','FAILED') and x.updated_at < '$T0'::timestamp
union all select 'jurnal_baris', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from fin_journal_lines x where x.entry_id in (select id from fin_journal_entries where created_at < '$T0'::timestamp)
union all select 'saldo_akun', count(*), md5(coalesce(string_agg(s.account_id::text || ':' || s.d::text || ':' || s.c::text, '|' order by s.account_id),'')) from (select l.account_id, sum(l.debit) d, sum(l.credit) c from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id where e.created_at < '$T0'::timestamp group by l.account_id) s
union all select 'pembayaran_lama', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id),'')) from payments x where x.created_at < '$T0'::timestamp
union all select 'flag', count(*), md5(coalesce(string_agg(f.key || '=' || f.value, '|' order by f.key),'')) from fin_settings f
FPBEKU
)"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-sebelum.txt" || die "sidik jari dokumen beku sebelum gagal"
[ "$(grep -c . "$BK_DIR/data-sebelum.txt")" = "9" ] || die "sidik jari dokumen beku tidak 9 baris"
ok "dokumen pembanding dibekukan pada T0=${T0} UTC ($(awk -F'|' '{n+=$2} END{print n+0}' "$BK_DIR/data-sebelum.txt") baris di 9 kelompok)"

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
BACKUP_FILE="$HOME/backups/pre-pkr-item-terpadu-${DEPLOY_SHORT}-${TS}.sql.gz"
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
for f in docker-compose.yml docker-compose.release.yml backend/Dockerfile backend/package.json frontend/package.json scripts/rollback-guard-pkr-item-penjualan-pemenuhan.sh; do [ -f "$NEW_DIR/$f" ] || die "release dir tidak lengkap: $f"; done
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
for s1 in "Item Penjualan & Pemenuhan" "Cara pemenuhan" "Koreksi item"; do [ -n "$(grep -lF "$s1" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru tidak memuat teks fitur: ${s1}"; done
for s2 in "Katalog Item PKR" "Kirim sebagian" "Barang Akan Datang" "Retur & Debit Note" "Rencana Produksi" "Penjualan Karyawan" "Penjualan & Piutang" "Piutang & Refund"; do [ -n "$(grep -lF "$s2" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru kehilangan teks fitur lama: ${s2}"; done
[ -z "$(grep -lF "Hitung Kas" "$NEW_DIR"/frontend/dist/assets/*.js 2>/dev/null | sed -n 1p)" ] || die "dist baru memuat Hitung Kas (halamannya belum ada)"
[ "$NEW_INDEX" != "$PREV_INDEX" ] || die "frontend berubah tetapi bundel baru identik dengan lama (tidak diharapkan)"
ok "dist baru ${NEW_INDEX} (lama ${PREV_INDEX}); teks fitur baru + 8 teks fitur lama ada"

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
ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-pkr-item-terpadu-${DEPLOY_SHORT}"
docker tag "$PREV_IMG_ID" "$ROLLBACK_TAG" || die "gagal menandai image lama"; ok "image lama ditandai ${ROLLBACK_TAG}"
dcp "$NEW_DIR" build backend > "$BK_DIR/build.log" 2>&1 </dev/null || { tail -n 25 "$BK_DIR/build.log"; die "build image gagal (backend lama tetap berjalan)"; }
NEW_IMG_ID="$(docker image inspect -f '{{.Id}}' "$IMG_NAME")"
[ "$NEW_IMG_ID" != "$PREV_IMG_ID" ] || die "image baru identik dengan lama"
[ "$(docker inspect -f '{{.Image}}' "$CID_OLD")" = "$PREV_IMG_ID" ] || die "container aktif berubah saat build"
ok "image baru ${NEW_IMG_ID:7:12}; container aktif masih ${PREV_IMG_ID:7:12}"

PHASE="5b-rehearsal"; say "5b. REHEARSAL: restore backup NYATA ke DB sementara, terapkan migrasi dengan image baru, uji perilaku constraint/trigger, bandingkan sidik jari, hapus (DB produksi tidak disentuh)"
REH_DB="rehearsal_pkr_item_terpadu_${TS}"
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
ok "restore nyata IDENTIK dengan dokumen beku produksi (PKR/baris/order/unit/job terminal, jurnal, saldo per akun, pembayaran lama, flag)"
REH_PW="$(sed -n 's/^DATABASE_URL=\"\?postgresql:\/\/[^:]*:\([^@]*\)@.*/\1/p' "$PERSIST/backend/.env" | sed -n 1p)"
[ -n "$REH_PW" ] || { reh_drop; die "tidak bisa membaca kata sandi DB dari .env untuk rehearsal"; }
REH_PEND="$(comm -23 <(ls -1 "$NEW_DIR/backend/prisma/migrations" | grep -E '^[0-9]{14}_' | LC_ALL=C sort) <(RPSQL "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by 1" | LC_ALL=C sort) || true)"
[ "$(printf '%s\n' "$REH_PEND" | tr -d ' ')" = "$(printf '%s\n' $MIG_LIST | LC_ALL=C sort | tr -d ' ')" ] || { reh_drop; die "migrasi pending pada DB rehearsal bukan tepat migrasi rilis ini: $(printf '%s' "$REH_PEND" | tr '\n' ' ')"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate deploy </dev/null > "$BK_DIR/migrate-rehearsal.log" 2>&1 || { tail -n 20 "$BK_DIR/migrate-rehearsal.log"; reh_drop; die "migrate deploy di DB rehearsal GAGAL (produksi tidak disentuh)"; }
dcp "$NEW_DIR" run --rm --no-deps -T -e DATABASE_URL="postgresql://${DB_USER}:${REH_PW}@postgres:5432/${REH_DB}" backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || { reh_drop; die "migrate status rehearsal tidak 'up to date'"; }
# Struktur: 17 kolom baru, NULL di SEMUA baris lama (tanpa backfill); 7 CHECK; 4 fungsi; 3 trigger; 3 indeks.
[ "$(RPSQL "select count(*) from information_schema.columns where table_schema='public' and ((table_name='fin_penjualan_karyawan_items' and column_name in ('category_id','product_id','category_code','category_name','fulfillment','perlu_dikirim','length_cm','width_cm','thickness_cm','height_cm','spec_notes')) or (table_name='pkr_order_items' and column_name in ('sale_item_id','component_seq','component_qty','fulfillment')) or (table_name='pkr_item_revisions' and column_name in ('finance_before','finance_after')))")" = "17" ] || { reh_drop; die "kolom baru tidak tepat 17"; }
[ "$(RPSQL "select count(*) from fin_penjualan_karyawan_items where fulfillment is not null or category_id is not null or product_id is not null or category_code is not null or category_name is not null or perlu_dikirim is not null or length_cm is not null or width_cm is not null or thickness_cm is not null or height_cm is not null or spec_notes is not null")" = "0" ] || { reh_drop; die "ada baris penjualan lama dengan kolom baru terisi (backfill tidak diizinkan)"; }
[ "$(RPSQL "select count(*) from pkr_order_items where sale_item_id is not null or component_seq is not null or component_qty is not null or fulfillment is not null")" = "0" ] || { reh_drop; die "ada item operasional lama dengan kolom baru terisi (backfill tidak diizinkan)"; }
[ "$(RPSQL "select count(*) from pkr_item_revisions where finance_before is not null or finance_after is not null")" = "0" ] || { reh_drop; die "ada revisi lama dengan kolom baru terisi (backfill tidak diizinkan)"; }
for C in fin_pkr_items_fulfillment_chk fin_pkr_items_lama_polos_chk fin_pkr_items_operasional_kategori_chk fin_pkr_items_tanpa_unit_kirim_chk fin_pkr_items_dim_chk pkr_order_items_fulfillment_chk pkr_order_items_tautan_chk; do
  [ "$(RPSQL "select count(*) from pg_constraint where conname='$C'")" = "1" ] || { reh_drop; die "constraint $C tidak ada tepat satu"; }
done
for F in pkr_validasi_tautan_item pkr_trg_tautan_item_order pkr_trg_tautan_item_penjualan pkr_trg_cegah_hapus_item_penjualan; do
  [ "$(RPSQL "select count(*) from pg_proc where proname='$F'")" = "1" ] || { reh_drop; die "fungsi $F tidak ada tepat satu"; }
done
for G in pkr_order_items_tautan_trg fin_penjualan_karyawan_items_tautan_trg fin_penjualan_karyawan_items_cegah_hapus_trg; do
  [ "$(RPSQL "select count(*) from pg_trigger where tgname='$G' and not tgisinternal")" = "1" ] || { reh_drop; die "trigger $G tidak ada tepat satu"; }
done
[ "$(RPSQL "select count(*) from pg_trigger where tgname in ('pkr_order_items_tautan_trg','fin_penjualan_karyawan_items_tautan_trg') and tgdeferrable and tginitdeferred")" = "2" ] || { reh_drop; die "dua constraint trigger harus DEFERRABLE INITIALLY DEFERRED"; }
ok "kolom baru NULL di semua baris lama (tanpa backfill); 7 CHECK; 4 fungsi + 3 trigger penjaga (2 tertunda ke akhir transaksi) terpasang"
# UJI PERILAKU (hanya DB rehearsal, SELURUHNYA dibatalkan di akhir): CHECK menolak data salah; penjaga DB menolak jumlah/nama yang menyimpang dan penghapusan baris yang masih dipakai.
# SET CONSTRAINTS ALL IMMEDIATE membuat trigger tertunda menembak SEGERA supaya penolakannya teramati di dalam blok uji.
cat > "$BK_DIR/uji-perilaku.sql" <<'UJISQL'
DO $t$
DECLARE
  ord text; pkr uuid; cat uuid;
  sale uuid := gen_random_uuid(); sale2 uuid := gen_random_uuid(); it uuid := gen_random_uuid();
  tolak int := 0; lolos int := 0; lewat int := 0;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT id, penjualan_karyawan_id INTO ord, pkr FROM "Order" WHERE penjualan_karyawan_id IS NOT NULL LIMIT 1;
  IF ord IS NULL THEN
    SELECT o.id INTO ord FROM "Order" o LIMIT 1; SELECT id INTO pkr FROM fin_penjualan_karyawan LIMIT 1;
  END IF;
  SELECT id INTO cat FROM pkr_item_categories WHERE code = 'KASUR_BARU';
  IF ord IS NULL OR pkr IS NULL OR cat IS NULL THEN lewat := lewat + 1; RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=% lewat=%', tolak, lolos, lewat; END IF;
  -- (1) baris penjualan: cara pemenuhan liar, kolom operasional pada baris lama, produksi tanpa kategori, stok yang "dikirim", dimensi <= 0 — semua ditolak
  BEGIN INSERT INTO fin_penjualan_karyawan_items (id, penjualan_id, name, quantity, unit_price, fulfillment) VALUES (gen_random_uuid(), pkr, 'Uji', 1, 1000, 'LIAR'); RAISE EXCEPTION 'TIDAK_DITOLAK_fulfillment_liar';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_penjualan_karyawan_items (id, penjualan_id, name, quantity, unit_price, category_name) VALUES (gen_random_uuid(), pkr, 'Uji', 1, 1000, 'Kasur'); RAISE EXCEPTION 'TIDAK_DITOLAK_lama_membawa_kolom';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_penjualan_karyawan_items (id, penjualan_id, name, quantity, unit_price, fulfillment) VALUES (gen_random_uuid(), pkr, 'Uji', 1, 1000, 'PRODUKSI_BARU'); RAISE EXCEPTION 'TIDAK_DITOLAK_produksi_tanpa_kategori';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_penjualan_karyawan_items (id, penjualan_id, name, quantity, unit_price, fulfillment, perlu_dikirim) VALUES (gen_random_uuid(), pkr, 'Uji', 1, 1000, 'AMBIL_STOK', true); RAISE EXCEPTION 'TIDAK_DITOLAK_stok_dikirim';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO fin_penjualan_karyawan_items (id, penjualan_id, name, quantity, unit_price, fulfillment, category_id, length_cm) VALUES (gen_random_uuid(), pkr, 'Uji', 1, 1000, 'PRODUKSI_BARU', cat, 0); RAISE EXCEPTION 'TIDAK_DITOLAK_dimensi_nol';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO fin_penjualan_karyawan_items (id, penjualan_id, name, quantity, unit_price, sort_order, fulfillment, category_id, category_code, category_name, perlu_dikirim) VALUES (sale, pkr, 'Kasur Uji Rehearsal', 2, 1000, 900, 'PRODUKSI_BARU', cat, 'KASUR_BARU', 'Kasur Baru', true); lolos := lolos + 1;
  -- (2) item operasional bertaut: pemenuhan liar, tautan tanpa komponen, jumlah/nama menyimpang ditolak; tautan sah lolos; satu komponen per baris
  BEGIN INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, product_name, sale_item_id, component_seq, component_qty, fulfillment, updated_at) VALUES (gen_random_uuid(), pkr, ord, 9101, cat, 'KASUR_BARU', 'Kasur Baru', 'KASUR', 'BARU', 2, 'Kasur Uji Rehearsal', sale, 1, 1, 'LIAR', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_item_fulfillment_liar';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, product_name, sale_item_id, fulfillment, updated_at) VALUES (gen_random_uuid(), pkr, ord, 9102, cat, 'KASUR_BARU', 'Kasur Baru', 'KASUR', 'BARU', 2, 'Kasur Uji Rehearsal', sale, 'PRODUKSI_BARU', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_tautan_tanpa_komponen';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, product_name, sale_item_id, component_seq, component_qty, fulfillment, updated_at) VALUES (gen_random_uuid(), pkr, ord, 9103, cat, 'KASUR_BARU', 'Kasur Baru', 'KASUR', 'BARU', 3, 'Kasur Uji Rehearsal', sale, 1, 1, 'PRODUKSI_BARU', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_jumlah_menyimpang';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, product_name, sale_item_id, component_seq, component_qty, fulfillment, updated_at) VALUES (gen_random_uuid(), pkr, ord, 9104, cat, 'KASUR_BARU', 'Kasur Baru', 'KASUR', 'BARU', 2, 'Nama Lain', sale, 1, 1, 'PRODUKSI_BARU', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_nama_menyimpang';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, product_name, sale_item_id, component_seq, component_qty, fulfillment, updated_at) VALUES (it, pkr, ord, 9105, cat, 'KASUR_BARU', 'Kasur Baru', 'KASUR', 'BARU', 2, 'Kasur Uji Rehearsal', sale, 1, 1, 'PRODUKSI_BARU', now()); lolos := lolos + 1;
  BEGIN INSERT INTO pkr_order_items (id, penjualan_id, order_id, seq, category_id, category_code, category_name, shape, work_kind, qty, product_name, sale_item_id, component_seq, component_qty, fulfillment, updated_at) VALUES (gen_random_uuid(), pkr, ord, 9106, cat, 'KASUR_BARU', 'Kasur Baru', 'KASUR', 'BARU', 2, 'Kasur Uji Rehearsal', sale, 1, 1, 'PRODUKSI_BARU', now()); RAISE EXCEPTION 'TIDAK_DITOLAK_komponen_ganda';
  EXCEPTION WHEN unique_violation THEN tolak := tolak + 1; END;
  -- (3) penjaga dua arah: ubah jumlah/nama baris penjualan tanpa item operasional, hapus baris yang masih dipakai — ditolak
  BEGIN UPDATE fin_penjualan_karyawan_items SET quantity = 5 WHERE id = sale; RAISE EXCEPTION 'TIDAK_DITOLAK_ubah_jumlah_baris';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE fin_penjualan_karyawan_items SET name = 'Nama Lain' WHERE id = sale; RAISE EXCEPTION 'TIDAK_DITOLAK_ubah_nama_baris';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN UPDATE pkr_order_items SET qty = 4 WHERE id = it; RAISE EXCEPTION 'TIDAK_DITOLAK_ubah_qty_item';
  EXCEPTION WHEN check_violation THEN tolak := tolak + 1; END;
  BEGIN DELETE FROM fin_penjualan_karyawan_items WHERE id = sale; RAISE EXCEPTION 'TIDAK_DITOLAK_hapus_baris_dipakai';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'PKR_ITEM_MASIH_DIPAKAI%' THEN tolak := tolak + 1; ELSE RAISE; END IF;
  END;
  -- item yang sudah dihapus lunak tidak menghalangi hapus baris
  UPDATE pkr_order_items SET removed_at = now(), removed_by_id = NULL, removed_reason = 'Uji rehearsal' WHERE id = it; lolos := lolos + 1;
  DELETE FROM fin_penjualan_karyawan_items WHERE id = sale; lolos := lolos + 1;
  -- (4) revisi: sisi Finance tersimpan di kolom baru
  INSERT INTO pkr_item_revisions (id, order_id, penjualan_id, revision, kind, after_items, finance_before, finance_after) VALUES (gen_random_uuid(), ord, pkr, 990001, 'DIBUAT', '[]'::jsonb, '{"total":1}'::jsonb, '{"total":2}'::jsonb); lolos := lolos + 1;
  RAISE NOTICE 'HASIL tolak=% lolos=% lewat=%', tolak, lolos, lewat;
  RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=% lewat=%', tolak, lolos, lewat;
END $t$;
UJISQL
UJI_OUT="$(dcp "$PREV_DIR" exec -T postgres psql -U "$DB_USER" -d "$REH_DB" -X -q -v ON_ERROR_STOP=0 < "$BK_DIR/uji-perilaku.sql" 2>&1 || true)"
printf '%s\n' "$UJI_OUT" > "$BK_DIR/uji-perilaku.out"
printf '%s\n' "$UJI_OUT" | grep -q 'ROLLBACK_UJI' || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku tidak selesai sampai rollback yang diharapkan"; }
printf '%s\n' "$UJI_OUT" | grep -Eq 'TIDAK_DITOLAK' && { printf '%s\n' "$UJI_OUT"; reh_drop; die "perilaku constraint/trigger SALAH (ada data salah yang lolos)"; }
UJI_TOLAK="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\) lewat=\([0-9]*\).*/\1/p' | sed -n 1p)"
UJI_LOLOS="$(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI tolak=\([0-9]*\) lolos=\([0-9]*\) lewat=\([0-9]*\).*/\2/p' | sed -n 1p)"
[ -n "$UJI_TOLAK" ] && [ "$UJI_TOLAK" -ge 14 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: penolakan terbukti terlalu sedikit (${UJI_TOLAK:-?}; minimal 14) — constraint/trigger tidak aktif atau data contoh kurang"; }
[ -n "$UJI_LOLOS" ] && [ "$UJI_LOLOS" -ge 5 ] || { printf '%s\n' "$UJI_OUT"; reh_drop; die "uji perilaku: data benar yang lolos terlalu sedikit (${UJI_LOLOS:-?}; minimal 5)"; }
ok "perilaku terbukti di DB rehearsal: $(printf '%s\n' "$UJI_OUT" | sed -n 's/.*ROLLBACK_UJI \(tolak=.*\)/\1/p' | sed -n 1p) — CHECK menolak data salah; penjaga menolak jumlah/nama menyimpang dan hapus baris yang dipakai; semuanya dibatalkan"
RPSQL "$FP_SQL" | LC_ALL=C sort > "$BK_DIR/fp-reh-sesudah.txt" || { reh_drop; die "sidik jari rehearsal sesudah gagal"; }
cmp -s "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || { diff "$BK_DIR/fp-reh-sebelum.txt" "$BK_DIR/fp-reh-sesudah.txt" || true; reh_drop; die "migrasi/uji rehearsal MENGUBAH isi tabel lama"; }
[ "$(RPSQL "select count(*) from fin_penjualan_karyawan_items where fulfillment is not null")" = "0" ] && [ "$(RPSQL "select count(*) from pkr_item_revisions where finance_before is not null")" = "0" ] || { reh_drop; die "data uji rehearsal tidak dibatalkan"; }
reh_drop
ok "rehearsal lulus: isi ${FP_N} tabel lama IDENTIK sebelum vs sesudah migrasi + uji perilaku (sidik jari baris penuh tanpa kolom baru); kolom baru NULL; DB sementara dihapus"

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
# SETELAH migrasi, SEBELUM switch: hanya backend LAMA yang melayani dan ia tidak mengenal kolom baru → kolom baru HARUS NULL di semua baris (tanpa backfill).
[ "$(psql_live -At -c "select count(*) from fin_penjualan_karyawan_items where fulfillment is not null or category_id is not null or perlu_dikirim is not null")" = "0" ] || die "ada baris penjualan dengan kolom baru terisi setelah migrasi sebelum switch"
[ "$(psql_live -At -c "select count(*) from pkr_order_items where sale_item_id is not null or fulfillment is not null")" = "0" ] || die "ada item operasional dengan kolom baru terisi setelah migrasi sebelum switch"
psql_live -At -c "$FP_BEKU_SQL" | LC_ALL=C sort > "$BK_DIR/data-pasca-migrasi.txt" || die "sidik jari dokumen beku pasca-migrasi gagal"
diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" >/dev/null || { diff "$BK_DIR/data-sebelum.txt" "$BK_DIR/data-pasca-migrasi.txt" || true; die "dokumen pembanding beku BERUBAH oleh migrasi (jangan switch)"; }
ok "pasca-migrasi sebelum switch: kolom baru NULL di semua baris (tanpa backfill), dokumen pembanding beku identik"

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
[ "$(PSQLN "select count(*) from pg_proc where proname in ('pkr_validasi_tautan_item','pkr_trg_tautan_item_order','pkr_trg_tautan_item_penjualan','pkr_trg_cegah_hapus_item_penjualan')")" = "4" ] || die "empat fungsi penjaga tidak ada setelah rilis"
[ "$(PSQLN "select count(*) from pg_trigger where tgname in ('pkr_order_items_tautan_trg','fin_penjualan_karyawan_items_tautan_trg','fin_penjualan_karyawan_items_cegah_hapus_trg') and not tgisinternal")" = "3" ] || die "tiga trigger penjaga tidak ada setelah rilis"
ok "fungsi + trigger penjaga ada (tidak ada asumsi tentang dokumen baru: PKR terpadu yang sah boleh sudah muncul)"
dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate status </dev/null 2>&1 | grep -i 'up to date' >/dev/null || die "migrate status produksi tidak 'up to date'"
ok "migrate status up to date"
PHASE="8b-smoke"; say "8b. Smoke test izin + pratinjau + invarian nilai (baca-saja; tidak menulis; tahan terhadap transaksi sah yang muncul saat rilis)"
# shellcheck disable=SC1090
. "$BK_DIR/garis-dasar.env"
dcp "$NEW_DIR" exec -T -e BASE_PAY="$BASE_PAY" -e BASE_INV="$BASE_INV" -e BASE_VAL="$BASE_VAL" -e BASE_REV="$BASE_REV" -e BASE_JGANDA="$BASE_JGANDA" -e BASE_TOTAL="$BASE_TOTAL" backend node --input-type=module - <<'NODE' | tee "$BK_DIR/smoke.log" || die "smoke test GAGAL"
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
  if (method !== "GET" && /koreksi-baris$/.test(path)) tulis.push({ n: `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, status: r.status, code: json?.code ?? null });
  return { status: r.status, json };
}
const tokenUntuk = async (u) => { const roles = (await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role); return jwt.sign({ id: u.id, name: u.name, role: u.role, roles: roles.length ? roles : [u.role] }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER", "DISPATCHER", "PRODUCTION_LEAD"]);
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
const prodMurni = await userDengan("PRODUCTION_LEAD", new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]));
if (!adm || !sales) { rec("akun ADMIN dan SALES murni tersedia", false, `adm=${!!adm} sales=${!!sales}`); process.exit(1); }
const tA = await tokenUntuk(adm), tS = await tokenUntuk(sales);
const tF = finMurni ? await tokenUntuk(finMurni) : null;
const tP = prodMurni ? await tokenUntuk(prodMurni) : null;
const nol = "00000000-0000-4000-8000-000000000000";
const BASEF = "/api/finance/penjualan-karyawan";
const hitungSql = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const B = (k) => Number(process.env[k]);

// ── Izin: harga & koreksi hanya untuk peran Finance ──
const itemJasa = { pemenuhan: "TANPA_OPERASIONAL", nama: "Jasa uji smoke", jumlah: 1, harga: 12345 };
rec("pratinjau terpadu: tanpa token 401, SALES 403", (await api("POST", `${BASEF}/order-crm/pratinjau`, null, { items: [itemJasa] })).status === 401 && (await api("POST", `${BASEF}/order-crm/pratinjau`, tS, { items: [itemJasa] })).status === 403);
rec("pratinjau koreksi baris: SALES 403, tanpa token 401", (await api("POST", `${BASEF}/${nol}/koreksi-baris/pratinjau`, tS, { operasi: [] })).status === 403 && (await api("POST", `${BASEF}/${nol}/koreksi-baris/pratinjau`, null, { operasi: [] })).status === 401);
rec("daftar & detail PKR (harga): SALES 403", (await api("GET", BASEF, tS)).status === 403);
if (tP) rec("daftar PKR (harga): Production Lead murni 403", (await api("GET", BASEF, tP)).status === 403);
else skip("daftar PKR (harga): Production Lead murni 403", "tidak ada akun PRODUCTION_LEAD murni (aktif, tanpa ADMIN/OWNER/FINANCE/ACCOUNTANT/APPROVER); akun/token tidak dibuat atau direkayasa — izin dijaga tes integrasi");
if (tF) rec("pratinjau terpadu: FINANCE murni 200", (await api("POST", `${BASEF}/order-crm/pratinjau`, tF, { items: [itemJasa] })).status === 200);
else skip("pratinjau terpadu: FINANCE murni 200", "tidak ada akun FINANCE murni; akun/token tidak dibuat atau direkayasa");

// ── Penulisan: SEMUA ditolak izin/idempotensi SEBELUM menyentuh data ──
const kunci = (n) => ({ "Idempotency-Key": `smoke-pkri-${n}` });
const opsi = { operasi: [{ op: "ubah", no: 1, harga: 1 }], expectedRevision: 1, alasan: "uji smoke" };
await api("POST", `${BASEF}/${nol}/koreksi-baris`, null, opsi, kunci("anon"));
await api("POST", `${BASEF}/${nol}/koreksi-baris`, tS, opsi, kunci("sales"));
await api("POST", `${BASEF}/${nol}/koreksi-baris`, tA, opsi); // tanpa Idempotency-Key -> 428 sebelum menyentuh data
const SAH = new Set([400, 401, 403, 428]);
rec(`semua ${tulis.length} pemanggilan tulis ditolak sebelum menyentuh data (hanya 400/401/403/428): smoke TIDAK menulis data produksi`, tulis.length === 3 && tulis.every((b) => SAH.has(b.status)), tulis.map((b) => `${b.n}=${b.status}`).join("; "));
rec("koreksi baris tanpa Idempotency-Key -> 428", tulis.find((b) => b.status === 428) !== undefined);

// ── Pratinjau & pembacaan (read-only) ──
const sebelum = { pkr: await hitungSql(`select count(*)::int n from fin_penjualan_karyawan`), baris: await hitungSql(`select count(*)::int n from fin_penjualan_karyawan_items`), order: await hitungSql(`select count(*)::int n from "Order"`), unit: await hitungSql(`select count(*)::int n from units`), item: await hitungSql(`select count(*)::int n from pkr_order_items`), jurnal: await hitungSql(`select count(*)::int n from fin_journal_entries`) };
const jasa = await api("POST", `${BASEF}/order-crm/pratinjau`, tA, { items: [itemJasa] });
rec("pratinjau item tanpa operasional: valid, total = harga x jumlah, nilai Order CRM 0, tanpa order", jasa.status === 200 && jasa.json?.valid === true && jasa.json?.keuangan?.total === 12345 && jasa.json?.keuangan?.nilaiOrderCrm === 0 && jasa.json?.adaOrder === false, JSON.stringify(jasa.json?.keuangan));
const salah = await api("POST", `${BASEF}/order-crm/pratinjau`, tA, { items: [{ kategori: "KASUR_BARU", produkNama: "Kasur uji", jumlah: 1, harga: 1000 }] });
rec("pratinjau tanpa cara pemenuhan -> 200 valid:false PEMENUHAN_WAJIB (bukan 500)", salah.status === 200 && salah.json?.valid === false && salah.json?.galat?.kode === "PEMENUHAN_WAJIB", JSON.stringify(salah.json?.galat));
const kasur = await api("POST", `${BASEF}/order-crm/pratinjau`, tA, { items: [{ pemenuhan: "PRODUKSI_BARU", kategori: "KASUR_BARU", produkNama: "Kasur uji smoke", jumlah: 1, harga: 999, panjang: 200, lebar: 160, tebal: 20, perluDikirim: true }], orderCrm: { alamat: "Jl. Uji 1", kota: "Bekasi" } });
if (kasur.status === 200 && kasur.json?.valid === true) rec("pratinjau kasur produksi baru: 1 unit, total = harga, nilai Order CRM 0", kasur.json?.order?.jumlahUnit === 1 && kasur.json?.keuangan?.total === 999 && kasur.json?.keuangan?.nilaiOrderCrm === 0, JSON.stringify({ o: kasur.json?.order?.jumlahUnit, k: kasur.json?.keuangan }));
else if (kasur.status === 200 && kasur.json?.valid === false) console.log(`  INFO  pratinjau kasur produksi baru belum valid di produksi: ${kasur.json?.galat?.kode} — Admin perlu memetakan rute Produksi katalog (bukan kegagalan rilis)`);
else rec("pratinjau kasur produksi baru: 200 (valid atau valid:false)", false, `status ${kasur.status}`);
const k0 = await api("POST", `${BASEF}/${nol}/koreksi-baris/pratinjau`, tA, { operasi: [{ op: "ubah", no: 1, harga: 1 }], expectedRevision: 1 });
rec("pratinjau koreksi id tak dikenal -> 200 valid:false atau 404 (bukan 500; tanpa Idempotency-Key; tanpa menulis)", (k0.status === 200 && k0.json?.valid === false) || k0.status === 404, `${k0.status}/${k0.json?.valid}`);
const setelah = { pkr: await hitungSql(`select count(*)::int n from fin_penjualan_karyawan`), baris: await hitungSql(`select count(*)::int n from fin_penjualan_karyawan_items`), order: await hitungSql(`select count(*)::int n from "Order"`), unit: await hitungSql(`select count(*)::int n from units`), item: await hitungSql(`select count(*)::int n from pkr_order_items`), jurnal: await hitungSql(`select count(*)::int n from fin_journal_entries`) };
console.log(`  INFO  jumlah sebelum/sesudah pratinjau (pratinjau tidak menulis; selisih hanya mungkin dari transaksi sah yang bersamaan): ${JSON.stringify({ sebelum, setelah })}`);

// ── Kompatibilitas PKR lama ──
const daftar = await api("GET", `${BASEF}?limit=50`, tA);
rec("daftar PKR -> 200", daftar.status === 200 && Array.isArray(daftar.json?.penjualan), `${daftar.json?.penjualan?.length} PKR`);
const p0 = (daftar.json?.penjualan ?? [])[0];
if (p0) {
  const d = await api("GET", `${BASEF}/${p0.id}`, tA);
  rec("detail PKR terbaca (admin): total sama dengan daftar; tiap baris membawa penanda terpadu; baris lama tanpa pemenuhan tidak diubah artinya", d.status === 200 && d.json?.total === p0.total && Array.isArray(d.json?.items) && d.json.items.every((i) => typeof i.terpadu === "boolean" && (i.terpadu || i.pemenuhan === null)), JSON.stringify({ s: d.status, n: d.json?.items?.length }));
} else skip("detail PKR terbaca", "belum ada PKR di produksi");

// ── Invarian nilai (data apa pun, termasuk nol PKR terpadu; angka lama dibandingkan dengan garis dasar sebelum rilis) ──
rec("item operasional bertaut: qty = jumlah baris x komponen (tidak ada yang menyimpang)", (await hitungSql(`select count(*)::int n from pkr_order_items i join fin_penjualan_karyawan_items s on s.id = i.sale_item_id where i.removed_at is null and i.qty::numeric <> s.quantity * i.component_qty`)) === 0);
rec("item operasional bertaut: nama = nama baris penjualan (non-Set) / nama Set (bundel)", (await hitungSql(`select count(*)::int n from pkr_order_items i join fin_penjualan_karyawan_items s on s.id = i.sale_item_id where i.removed_at is null and ((i.bundle_no is null and i.product_name is distinct from s.name) or (i.bundle_no is not null and i.bundle_name is distinct from s.name))`)) === 0);
rec("baris stok/tanpa operasional tidak punya item operasional aktif", (await hitungSql(`select count(*)::int n from pkr_order_items i join fin_penjualan_karyawan_items s on s.id = i.sale_item_id where i.removed_at is null and s.fulfillment in ('AMBIL_STOK','TANPA_OPERASIONAL')`)) === 0);
rec("baris produksi/service pada PKR aktif selalu punya item operasional aktif", (await hitungSql(`select count(*)::int n from fin_penjualan_karyawan_items s join fin_penjualan_karyawan p on p.id = s.penjualan_id where s.fulfillment in ('PRODUKSI_BARU','SERVICE_PICKUP') and p.status::text = 'AKTIF' and not exists (select 1 from pkr_order_items i where i.sale_item_id = s.id and i.removed_at is null)`)) === 0);
rec(`Order CRM PKR tidak membawa uang (bernilai ≠ 0: ${B("BASE_VAL")} sebelum rilis, tidak bertambah)`, (await hitungSql(`select count(*)::int n from "Order" o where o.penjualan_karyawan_id is not null and o.value <> 0`)) <= B("BASE_VAL"));
rec(`tidak ada Payment kedua pada order PKR (sebelum rilis ${B("BASE_PAY")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from payments p join "Order" o on o.id = p.order_id where o.penjualan_karyawan_id is not null`)) <= B("BASE_PAY"));
rec(`tidak ada invoice pelanggan pada order PKR (sebelum rilis ${B("BASE_INV")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from invoices i join "Order" o on o.id = i.order_id where o.penjualan_karyawan_id is not null`)) <= B("BASE_INV"));
rec(`tidak ada pengakuan pendapatan pada order PKR (sebelum rilis ${B("BASE_REV")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from fin_journal_entries e where e.source::text = 'PENGAKUAN_PENDAPATAN' and e.source_id in (select id from "Order" where penjualan_karyawan_id is not null)`)) <= B("BASE_REV"));
rec(`tiap PKR punya paling banyak SATU jurnal penjualan berlaku (yang ganda sebelum rilis: ${B("BASE_JGANDA")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from (select source_id from fin_journal_entries where source::text = 'PENJUALAN_KARYAWAN' and status::text = 'POSTED' group by source_id having count(*) > 1) x`)) <= B("BASE_JGANDA"));
rec(`total PKR = Σ jumlah x harga baris (yang menyimpang sebelum rilis: ${B("BASE_TOTAL")}, tidak bertambah)`, (await hitungSql(`select count(*)::int n from fin_penjualan_karyawan p where abs(p.total - coalesce((select sum(i.quantity * i.unit_price) from fin_penjualan_karyawan_items i where i.penjualan_id = p.id), 0)) > 0.005`)) <= B("BASE_TOTAL"));

// ── Kebocoran harga (dinamis): bila sudah ada PKR terpadu, order/unit-nya tidak boleh memuat harga bagi SALES/Production Lead ──
const terpadu = await prisma.$queryRawUnsafe(`select p.id, p.total::text total, o.id order_id, (select u.id from units u where u.order_id = o.id limit 1) unit_id from fin_penjualan_karyawan p join "Order" o on o.penjualan_karyawan_id = p.id where exists (select 1 from fin_penjualan_karyawan_items s where s.penjualan_id = p.id and s.fulfillment is not null) order by p.created_at desc limit 3`);
if (terpadu.length) {
  const angka = new Set();
  for (const t of terpadu) {
    angka.add(String(Math.trunc(Number(t.total))));
    for (const s of await prisma.$queryRawUnsafe(`select unit_price::text hp from fin_penjualan_karyawan_items where penjualan_id = '${t.id}'`)) angka.add(String(Math.trunc(Number(s.hp))));
  }
  const pola = new RegExp(`(?<![0-9])(${[...angka].filter((a) => a.length >= 5).join("|")})(?![0-9.])`);
  let bocor = 0; let cek = 0;
  for (const tok of [tS, tP].filter(Boolean)) for (const t of terpadu) for (const url of [`/api/orders/${t.order_id}`, t.unit_id ? `/api/units/${t.unit_id}` : null].filter(Boolean)) {
    const r = await fetch(BASE + url, { headers: { Authorization: "Bearer " + tok } }); const teks = await r.text(); cek++;
    if (pola.test(teks)) bocor++;
  }
  rec(`harga/total PKR terpadu tidak bocor ke order/unit bagi SALES${tP ? " dan Production Lead" : ""} (${cek} pembacaan, ${terpadu.length} PKR)`, bocor === 0, `${bocor} kebocoran`);
} else skip("kebocoran harga ke order/unit", "belum ada PKR terpadu di produksi (smoke tidak membuat transaksi); perilaku dikunci tes integrasi pkrItemInvarian + sapuan 577 URL x 8 peran");
await prisma.$disconnect();
console.log(`\nRINGKASAN smoke: ${fail} gagal, ${dilewati} dilewati (SKIP)`);
console.log(`SMOKE_HASIL fail=${fail} skip=${dilewati}`);
process.exit(fail ? 1 : 0);
NODE
SMOKE_LINE="$(grep '^SMOKE_HASIL ' "$BK_DIR/smoke.log" | tail -n 1)"
SMOKE_SKIP="$(printf '%s' "$SMOKE_LINE" | sed -n 's/^SMOKE_HASIL fail=0 skip=\([0-9][0-9]*\)$/\1/p')"
[ -n "$SMOKE_SKIP" ] || die "smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus (jangan anggap lulus)"
if [ "$SMOKE_SKIP" != "0" ]; then
  warn "smoke test lulus dengan ${SMOKE_SKIP} pemeriksaan DILEWATI (SKIP): lihat alasan di ${BK_DIR}/smoke.log (akun peran-murni tidak ada atau belum ada PKR terpadu; tidak ada akun/token/transaksi dibuat). Ini BUKAN PASS untuk pemeriksaan yang dilewati."
else
  ok "smoke test lulus (izin, pratinjau baca-saja, penulisan ditolak sebelum menyentuh data, PKR lama terbaca, invarian nilai satu-sumber, harga tidak bocor)"
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
ok "dokumen pembanding beku (PKR batal, order/unit/job terminal, jurnal, saldo per akun, flag) IDENTIK sebelum vs sesudah rilis; transaksi sah yang muncul saat rilis tidak diperbandingkan"
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
say "TINDAK LANJUT OWNER: PKR lama dan PKR multi-item yang sudah ada TIDAK berubah. Item Penjualan & Pemenuhan terpadu dipakai untuk PKR BARU; produk kasur yang belum dipetakan rute Produksinya tetap diblokir sampai Admin memetakan."
