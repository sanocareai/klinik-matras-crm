// Pemindai migrasi rilis "Koreksi Gudang" (1 migrasi ADITIF). FAIL-CLOSED: setiap pernyataan harus cocok PERSIS salah satu bentuk yang diaudit. Membaca SQL dari stdin (komentar baris "--" sudah dibuang pemanggil).
//   • 1 CREATE TABLE "warehouse_corrections"; 1 ALTER TABLE "stock_movements" dengan tepat 2 ADD COLUMN nullable tanpa DEFAULT (correction_id, corrects_movement_id).
//   • 6 indeks, 4 foreign key, 4 CHECK, 1 fungsi + 1 trigger append-only HANYA pada warehouse_corrections, 1 blok DO yang hanya mencabut hak mcp_hub_readonly (bila role ada).
// Tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/ALTER COLUMN/RENAME/CREATE TYPE/ADD VALUE di luar badan fungsi/DO, tidak ada tabel lain yang diubah selain dua tabel itu.
// Isi migrasi juga dipatok sha256 di skrip rilis; pemindai ini adalah lapisan kedua (bentuk pernyataan), diuji dengan mutan negatif.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };

/** Pecah per ';' di luar blok $$ ... $$ (fungsi/DO). */
function pecah(t) {
  const out = []; let cur = ""; let dalam = false;
  for (let i = 0; i < t.length; i += 1) {
    if (t[i] === "$" && t[i + 1] === "$") { dalam = !dalam; cur += "$$"; i += 1; continue; }
    if (t[i] === ";" && !dalam) { out.push(cur); cur = ""; continue; }
    cur += t[i];
  }
  if (dalam) gagal("blok $$ tidak tertutup");
  if (rapat(cur)) out.push(cur);
  return out.map(rapat).filter(Boolean);
}
const TABEL = "(?:warehouse_corrections|stock_movements)";
const BENTUK = [
  ["create_table", /^CREATE TABLE "warehouse_corrections" \(.*\)$/],
  ["add_column", /^ALTER TABLE "stock_movements" ADD COLUMN "correction_id" UUID, ADD COLUMN "corrects_movement_id" UUID$/],
  ["index", new RegExp(`^CREATE (?:UNIQUE )?INDEX "[a-z0-9_]+" ON "${TABEL}"\\("[a-z_]+"(?:, "[a-z_]+")*\\)$`)],
  ["fk", new RegExp(`^ALTER TABLE "${TABEL}" ADD CONSTRAINT "[a-z0-9_]+_fkey" FOREIGN KEY \\("[a-z_]+"\\) REFERENCES "(?:warehouse_corrections|stock_movements|User)"\\("id"\\) ON DELETE (?:RESTRICT|SET NULL) ON UPDATE CASCADE$`)],
  ["check", new RegExp(`^ALTER TABLE "${TABEL}" ADD CONSTRAINT "[a-z0-9_]+_chk" CHECK \\(.*\\)$`)],
  ["fungsi", /^CREATE OR REPLACE FUNCTION warehouse_corrections_append_only\(\) RETURNS TRIGGER AS \$\$ .* \$\$ LANGUAGE plpgsql$/],
  ["trigger", /^CREATE TRIGGER "warehouse_corrections_append_only_trg" BEFORE UPDATE OR DELETE ON "warehouse_corrections" FOR EACH ROW EXECUTE FUNCTION warehouse_corrections_append_only\(\)$/],
  ["do_revoke", /^DO \$\$ BEGIN IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'mcp_hub_readonly'\) THEN REVOKE ALL ON TABLE "warehouse_corrections" FROM "mcp_hub_readonly"; END IF; END \$\$$/],
];
// kata terlarang DI LUAR badan $$ (fungsi/DO): perubahan/penghapusan data atau struktur lama
const TERLARANG = /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|GRANT|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|CREATE\s+TYPE|ADD\s+VALUE|DEFAULT\s+[^,)]+)\b/i;
const hitung = { total: 0, create_table: 0, add_column: 0, index: 0, fk: 0, check: 0, fungsi: 0, trigger: 0, do_revoke: 0 };
const lihat = new Set();
for (const r of pecah(sql)) {
  hitung.total += 1;
  if (lihat.has(r)) gagal("pernyataan ganda: " + r.slice(0, 120));
  lihat.add(r);
  const jenis = BENTUK.find(([, re]) => re.test(r))?.[0];
  if (!jenis) gagal("PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 220));
  const luarBadan = r.replace(/\$\$.*\$\$/g, "$$$$");
  if (jenis !== "create_table" && TERLARANG.test(luarBadan)) gagal("kata terlarang di luar badan fungsi: " + r.slice(0, 160));
  if (jenis === "create_table" && /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|GRANT)\b/i.test(r)) gagal("CREATE TABLE memuat kata terlarang");
  hitung[jenis] += 1;
}
console.log(JSON.stringify(hitung));
