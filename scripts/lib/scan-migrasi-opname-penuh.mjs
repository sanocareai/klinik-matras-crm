// Pemindai migrasi rilis "Stock Opname penuh + model waktu" (1 migrasi ADITIF). FAIL-CLOSED: setiap pernyataan harus SAMA PERSIS (setelah spasi dirapatkan) dengan salah satu dari tujuh bentuk yang diaudit, masing-masing tepat sekali.
// Membaca SQL dari stdin (komentar baris "--" sudah dibuang pemanggil).
//   • 1 ALTER TABLE "stock_counts": 3 kolom (model_version INTEGER NOT NULL DEFAULT 1 = konstanta, tanpa rewrite tabel; scope_mode VARCHAR(10) NULL; scope_info JSONB NULL).
//   • 1 ALTER TABLE "stock_count_lines": 12 kolom (NULL, atau NOT NULL dengan DEFAULT konstan 0 / false / 'SESI').
//   • 5 CHECK ringan (model_version IN (1,2); scope_mode NULL atau FULL/GROUP/ITEMS; origin IN (SESI, TAMBAHAN); observed_source NULL atau MULAI/DINYATAKAN/DIKOREKSI; observed_at dan observed_source NULL bersama-sama).
// Tidak ada tabel/indeks/FK/trigger/fungsi baru, tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/ALTER COLUMN/RENAME/CREATE TYPE, tidak menyentuh stock_movements (ledger) maupun tabel lain.
// Isi migrasi juga dipatok sha256 di skrip rilis; pemindai ini adalah lapisan kedua (bentuk pernyataan), diuji dengan mutan negatif.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };

const BENTUK = [
  ["alter_stock_counts", 'ALTER TABLE "stock_counts" ADD COLUMN "model_version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "scope_mode" VARCHAR(10), ADD COLUMN "scope_info" JSONB'],
  ["alter_stock_count_lines", 'ALTER TABLE "stock_count_lines" ADD COLUMN "saved_at" TIMESTAMP(3), ADD COLUMN "counted_by_id" TEXT, ADD COLUMN "observed_at" TIMESTAMP(3), ADD COLUMN "observed_source" VARCHAR(10), ADD COLUMN "observed_by_id" TEXT, ADD COLUMN "observed_recorded_at" TIMESTAMP(3), ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "needs_check" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "excluded_reason" TEXT, ADD COLUMN "excluded_at" TIMESTAMP(3), ADD COLUMN "excluded_by_id" TEXT, ADD COLUMN "origin" VARCHAR(10) NOT NULL DEFAULT \'SESI\''],
  ["check", 'ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_model_version_chk" CHECK ("model_version" IN (1, 2))'],
  ["check", 'ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_scope_mode_chk" CHECK ("scope_mode" IS NULL OR "scope_mode" IN (\'FULL\', \'GROUP\', \'ITEMS\'))'],
  ["check", 'ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_origin_chk" CHECK ("origin" IN (\'SESI\', \'TAMBAHAN\'))'],
  ["check", 'ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_observed_source_chk" CHECK ("observed_source" IS NULL OR "observed_source" IN (\'MULAI\', \'DINYATAKAN\', \'DIKOREKSI\'))'],
  ["check", 'ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_observed_pair_chk" CHECK (("observed_at" IS NULL) = ("observed_source" IS NULL))'],
];
// kata terlarang (lapisan tambahan; bentuk persis di atas sudah menolak semuanya)
const TERLARANG = /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|GRANT|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|CREATE\s+(?:TYPE|TABLE|INDEX|UNIQUE|TRIGGER|FUNCTION|OR)|ADD\s+VALUE|FOREIGN\s+KEY|REFERENCES|stock_movements)\b/i;

const pernyataan = sql.split(";").map(rapat).filter(Boolean);
const hitung = { total: 0, alter_stock_counts: 0, alter_stock_count_lines: 0, check: 0 };
const dipakai = new Set();
for (const r of pernyataan) {
  hitung.total += 1;
  if (TERLARANG.test(r)) gagal("kata terlarang: " + r.slice(0, 160));
  const i = BENTUK.findIndex(([, teks], idx) => teks === r && !dipakai.has(idx));
  if (i < 0) gagal(BENTUK.some(([, teks]) => teks === r) ? "pernyataan ganda: " + r.slice(0, 120) : "PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 220));
  dipakai.add(i);
  hitung[BENTUK[i][0]] += 1;
}
if (dipakai.size !== BENTUK.length) gagal(`pernyataan yang diaudit tidak lengkap: ada ${dipakai.size} dari ${BENTUK.length}`);
console.log(JSON.stringify(hitung));
