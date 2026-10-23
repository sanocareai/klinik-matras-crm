// Pemindai DDL migrasi rilis "UX Bahan" (usulan bahan + pemakaian sementara). Membaca SQL (komentar/baris kosong sudah dibuang) dari stdin.
// DAFTAR PUTIH SEMPIT: hanya objek BARU milik rilis ini (2 tabel, indeks, FK RESTRICT, 2 fungsi penjaga, 2 trigger). Pernyataan lain (DROP/UPDATE/INSERT/DELETE/ALTER tabel lama/GRANT/EXTENSION/fungsi liar) = exit 2.
// Keluaran (exit 0): JSON ringkas jumlah per jenis; skrip rilis membandingkannya dengan hasil yang sudah diaudit (SCAN_EXPECT).
import fs from "node:fs";

const BARU = ["material_proposals", "unit_provisional_usages"];
const REF_OK = ["units", "materials", "stock_movements", "material_proposals", "unit_provisional_usages"];
const FUNGSI = ["material_proposals_guard", "unit_provisional_usages_guard"];
const tolak = (m) => { console.error("DITOLAK: " + m); process.exit(2); };

const sql = fs.readFileSync(0, "utf8");
// pecah per pernyataan; isi fungsi ($$ ... $$) dijaga utuh
const stmts = []; let buf = ""; let dalam = false;
for (let i = 0; i < sql.length; i++) {
  if (sql.startsWith("$$", i)) { dalam = !dalam; buf += "$$"; i++; continue; }
  const c = sql[i];
  if (c === ";" && !dalam) { if (buf.trim()) stmts.push(buf.trim()); buf = ""; } else buf += c;
}
if (dalam) tolak("blok $$ tidak tertutup");
if (buf.trim()) tolak("pernyataan terakhir tanpa titik koma");

const n = { create_table: 0, index: 0, index_unik: 0, index_parsial: 0, fk: 0, fungsi: 0, trigger: 0 };
const tabelDibuat = new Set(); const fungsiDibuat = new Set();
const q = (s) => s.replace(/\s+/g, " ").trim();
for (const raw of stmts) {
  const s = q(raw); let m;
  if ((m = s.match(/^CREATE TABLE "([a-z_]+)" \(/))) {
    if (!BARU.includes(m[1])) tolak("CREATE TABLE di luar daftar: " + m[1]);
    if (tabelDibuat.has(m[1])) tolak("tabel ganda: " + m[1]);
    // tidak ada FK inline/DEFAULT berbahaya: isi hanya kolom + CONSTRAINT pkey/CHECK
    const isi = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
    if (/\bREFERENCES\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(isi.replace(/CHECK \(.*?\)(?=,\s*CONSTRAINT|$)/g, ""))) tolak("CREATE TABLE memuat REFERENCES/DML inline: " + m[1]);
    tabelDibuat.add(m[1]); n.create_table++; continue;
  }
  if ((m = s.match(/^CREATE (UNIQUE )?INDEX "([a-z0-9_]+)" ON "([a-z_]+)"\(([^)]*)\)( WHERE .+)?$/))) {
    if (!BARU.includes(m[3])) tolak("indeks pada tabel di luar rilis: " + m[3]);
    n.index++; if (m[1]) n.index_unik++; if (m[5]) n.index_parsial++; continue;
  }
  if ((m = s.match(/^ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z0-9_]+)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "([a-z_]+)"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE$/))) {
    if (!BARU.includes(m[1])) tolak("FK pada tabel di luar rilis: " + m[1]);
    if (!REF_OK.includes(m[4])) tolak("FK ke tabel di luar daftar: " + m[4]);
    n.fk++; continue;
  }
  if ((m = s.match(/^CREATE OR REPLACE FUNCTION ([a-z_]+)\(\) RETURNS trigger AS \$\$ (.*) \$\$ LANGUAGE plpgsql$/))) {
    if (!FUNGSI.includes(m[1])) tolak("fungsi di luar daftar: " + m[1]);
    if (fungsiDibuat.has(m[1])) tolak("fungsi ganda: " + m[1]);
    const badan = m[2];
    if (/\b(INSERT|DROP|TRUNCATE|COPY|GRANT|CREATE|ALTER|PERFORM|DELETE FROM|UPDATE [a-z_"]+ SET)\b/i.test(badan)) tolak("badan fungsi memuat pernyataan terlarang: " + m[1]);
    fungsiDibuat.add(m[1]); n.fungsi++; continue;
  }
  if ((m = s.match(/^CREATE TRIGGER "([a-z0-9_]+)" BEFORE UPDATE OR DELETE ON "([a-z_]+)" FOR EACH ROW EXECUTE FUNCTION ([a-z_]+)\(\)$/))) {
    if (!BARU.includes(m[2])) tolak("trigger pada tabel di luar rilis: " + m[2]);
    if (!FUNGSI.includes(m[3])) tolak("trigger memakai fungsi di luar daftar: " + m[3]);
    n.trigger++; continue;
  }
  tolak("pernyataan di luar daftar putih: " + s.slice(0, 100));
}
if (n.create_table !== 2) tolak("harus tepat 2 CREATE TABLE");
if (n.fungsi !== 2 || n.trigger !== 2) tolak("harus tepat 2 fungsi + 2 trigger");
console.log(JSON.stringify({ total: stmts.length, ...n }));
