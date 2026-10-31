// Pemindai DDL migrasi rilis "Foto Bahan". Membaca SQL (komentar/baris kosong sudah dibuang) dari stdin.
// DAFTAR PUTIH SANGAT SEMPIT — tepat empat pernyataan, dalam urutan ini:
//   SET LOCAL lock_timeout = '5s';            batas tunggu kunci: migrasi BERHENTI (gagal bersih) bila tabel sibuk, bukan antre dan memblokir pembacaan "materials"
//   SET LOCAL statement_timeout = '30s';
//   ALTER TABLE "materials" ADD COLUMN "photo_file" VARCHAR(80);            nullable, tanpa DEFAULT
//   ALTER TABLE "materials" ADD COLUMN "photo_updated_at" TIMESTAMP(3);     nullable, tanpa DEFAULT
// Pernyataan lain apa pun (DROP/UPDATE/INSERT/DELETE/TRUNCATE/indeks/FK/trigger/fungsi/EXTENSION/GRANT/DEFAULT/NOT NULL/tabel lain/batas waktu lain) = exit 2.
// Keluaran (exit 0): JSON ringkas jumlah per jenis; skrip rilis membandingkannya dengan hasil yang sudah diaudit (SCAN_EXPECT).
import fs from "node:fs";

const tolak = (m) => { console.error("DITOLAK: " + m); process.exit(2); };
const sql = fs.readFileSync(0, "utf8");
if (sql.includes("$$")) tolak("blok $$ (fungsi) tidak diizinkan");
const stmts = []; let buf = "";
for (const c of sql) { if (c === ";") { if (buf.trim()) stmts.push(buf.trim()); buf = ""; } else buf += c; }
if (buf.trim()) tolak("pernyataan terakhir tanpa titik koma");

const q = (s) => s.replace(/\s+/g, " ").trim();
const DIHARAPKAN = [
  { jenis: "set_local_lock_timeout", re: /^SET LOCAL lock_timeout = '5s'$/ },
  { jenis: "set_local_statement_timeout", re: /^SET LOCAL statement_timeout = '30s'$/ },
  { jenis: "add_column", re: /^ALTER TABLE "materials" ADD COLUMN "photo_file" VARCHAR\(80\)$/ },
  { jenis: "add_column", re: /^ALTER TABLE "materials" ADD COLUMN "photo_updated_at" TIMESTAMP\(3\)$/ },
];
if (stmts.length !== DIHARAPKAN.length) tolak(`jumlah pernyataan ${stmts.length} != ${DIHARAPKAN.length} yang diaudit`);
const n = { set_local_lock_timeout: 0, set_local_statement_timeout: 0, add_column: 0 };
stmts.forEach((raw, i) => {
  const s = q(raw);
  if (!DIHARAPKAN[i].re.test(s)) tolak(`pernyataan #${i + 1} bukan yang diaudit: ${s.slice(0, 120)}`);
  n[DIHARAPKAN[i].jenis]++;
});
console.log(JSON.stringify(n));
