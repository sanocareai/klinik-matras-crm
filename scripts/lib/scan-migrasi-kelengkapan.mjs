// Pemindai DDL migrasi rilis "Kelengkapan Order Produksi" (pernyataan tanpa bahan baru). Membaca SQL (komentar/baris kosong sudah dibuang) dari stdin.
// DAFTAR PUTIH SEMPIT: hanya objek BARU milik rilis ini (1 tabel, 3 indeks [1 unik parsial], 1 FK RESTRICT ke units). Pernyataan lain (DROP/UPDATE/INSERT/DELETE/ALTER tabel lama/GRANT/EXTENSION/fungsi/trigger) = DITOLAK.
// Keluaran (exit 0): JSON ringkas jumlah per jenis; skrip rilis membandingkannya dengan hasil yang sudah diaudit (SCAN_EXPECT).
import fs from "node:fs";

const BARU = ["unit_material_declarations"];
const REF_OK = ["units"];
const tolak = (m) => { console.error("DITOLAK: " + m); process.exit(2); };

const sql = fs.readFileSync(0, "utf8");
// pecah per pernyataan
const stmts = []; let buf = "";
for (let i = 0; i < sql.length; i++) {
  if (sql.startsWith("$$", i)) tolak("blok $$ (fungsi/trigger) tidak diizinkan pada rilis ini");
  const c = sql[i];
  if (c === ";") { if (buf.trim()) stmts.push(buf.trim()); buf = ""; } else buf += c;
}
if (buf.trim()) tolak("pernyataan terakhir tanpa titik koma");

const n = { create_table: 0, index: 0, index_unik: 0, index_parsial: 0, fk: 0 };
const tabelDibuat = new Set();
const q = (s) => s.replace(/\s+/g, " ").trim();
for (const raw of stmts) {
  const s = q(raw); let m;
  if ((m = s.match(/^CREATE TABLE "([a-z_]+)" \(/))) {
    if (!BARU.includes(m[1])) tolak("CREATE TABLE di luar daftar: " + m[1]);
    if (tabelDibuat.has(m[1])) tolak("tabel ganda: " + m[1]);
    // tidak ada FK inline/DML: isi hanya kolom + CONSTRAINT pkey/CHECK
    const isi = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
    if (/\bREFERENCES\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(isi.replace(/CHECK \(.*?\)(?=,\s*CONSTRAINT|$)/g, ""))) tolak("CREATE TABLE memuat REFERENCES/DML inline: " + m[1]);
    tabelDibuat.add(m[1]); n.create_table++; continue;
  }
  if ((m = s.match(/^CREATE (UNIQUE )?INDEX "([a-z0-9_]+)" ON "([a-z_]+)"\(([^)]*)\)( WHERE "status" = 'ACTIVE')?$/))) {
    if (!BARU.includes(m[3])) tolak("indeks pada tabel di luar rilis: " + m[3]);
    if (m[5] && !m[1]) tolak("indeks parsial harus UNIQUE");
    n.index++; if (m[1]) n.index_unik++; if (m[5]) n.index_parsial++; continue;
  }
  if ((m = s.match(/^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z0-9_]+)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "([a-z_]+)"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE$/))) {
    if (!BARU.includes(m[1])) tolak("FK pada tabel di luar rilis: " + m[1]);
    if (!REF_OK.includes(m[4])) tolak("FK ke tabel di luar daftar: " + m[4]);
    n.fk++; continue;
  }
  tolak("pernyataan di luar daftar putih: " + s.slice(0, 100));
}
if (n.create_table !== 1) tolak("harus tepat 1 CREATE TABLE");
console.log(JSON.stringify({ total: stmts.length, ...n }));
