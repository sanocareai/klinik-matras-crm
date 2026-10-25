// Pemindai DDL migrasi rilis "Akuisisi — biaya iklan tingkat sumber". Membaca SQL (komentar/baris kosong sudah dibuang) dari stdin.
// DAFTAR PUTIH SEMPIT: hanya objek BARU milik rilis ini (2 tabel, 3 indeks, 1 FK inline RESTRICT, 8 CHECK, 1 fungsi penjaga append-only, 1 trigger).
// Pernyataan lain (DROP/UPDATE/INSERT/DELETE/ALTER tabel lama/GRANT/EXTENSION/fungsi liar) = exit 2. Keluaran (exit 0): JSON ringkas jumlah per jenis; skrip rilis membandingkannya dengan hasil yang sudah diaudit (SCAN_EXPECT).
import fs from "node:fs";

const BARU = ["ad_source_spend_entries", "ad_source_spend_revisions"];
const FUNGSI = "ad_source_spend_revisions_append_only";
const FK_OK = 'FOREIGN KEY ("entry_id") REFERENCES "ad_source_spend_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
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

const n = { create_table: 0, index: 0, index_unik: 0, fk: 0, check: 0, fungsi: 0, trigger: 0 };
const tabelDibuat = new Set();
const q = (s) => s.replace(/\s+/g, " ").trim();
for (const raw of stmts) {
  const s = q(raw); let m;
  if ((m = s.match(/^CREATE TABLE "([a-z_]+)" \(/))) {
    if (!BARU.includes(m[1])) tolak("CREATE TABLE di luar daftar: " + m[1]);
    if (tabelDibuat.has(m[1])) tolak("tabel ganda: " + m[1]);
    const isi = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
    if (/\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bGRANT\b/i.test(isi.split(FK_OK).join("").replace(/'[^']*'/g, ""))) tolak("CREATE TABLE memuat DML/DDL inline: " + m[1]);
    // satu-satunya REFERENCES yang boleh: FK RESTRICT dari revisi ke entri
    const refs = isi.match(/REFERENCES "[a-z_]+"/g) || [];
    if (refs.length) {
      if (m[1] !== "ad_source_spend_revisions" || refs.length !== 1 || !isi.includes(FK_OK)) tolak("REFERENCES di luar FK RESTRICT yang diaudit: " + m[1]);
      n.fk++;
    }
    n.check += (isi.match(/CONSTRAINT "[a-z0-9_]+" CHECK \(/g) || []).length;
    tabelDibuat.add(m[1]); n.create_table++; continue;
  }
  if ((m = s.match(/^CREATE (UNIQUE )?INDEX "([a-z0-9_]+)" ON "([a-z_]+)"\(([^)]*)\)$/))) {
    if (!BARU.includes(m[3])) tolak("indeks pada tabel di luar rilis: " + m[3]);
    n.index++; if (m[1]) n.index_unik++; continue;
  }
  if ((m = s.match(new RegExp(`^CREATE FUNCTION "${FUNGSI}"\\(\\) RETURNS trigger LANGUAGE plpgsql AS \\$\\$ (.*) \\$\\$$`)))) {
    if (!/^BEGIN RAISE EXCEPTION '[^']*'; END;$/.test(m[1])) tolak("badan fungsi bukan 'RAISE EXCEPTION' murni");
    n.fungsi++; continue;
  }
  if ((m = s.match(new RegExp(`^CREATE TRIGGER "([a-z0-9_]+)" BEFORE UPDATE OR DELETE ON "ad_source_spend_revisions" FOR EACH ROW EXECUTE FUNCTION "${FUNGSI}"\\(\\)$`)))) { n.trigger++; continue; }
  tolak("pernyataan di luar daftar putih: " + s.slice(0, 100));
}
if (n.create_table !== 2) tolak("harus tepat 2 CREATE TABLE");
if (n.fungsi !== 1 || n.trigger !== 1) tolak("harus tepat 1 fungsi + 1 trigger");
if (n.fk !== 1) tolak("harus tepat 1 FK");
console.log(JSON.stringify({ total: stmts.length, ...n }));
