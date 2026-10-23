// Pemindai DDL migrasi "material_id catatan pemakaian sementara terkunci" (baca stdin = SQL tanpa komentar/baris kosong; exit 1 + pesan bila ada yang di luar daftar putih).
// Daftar putih = SATU pernyataan: CREATE OR REPLACE FUNCTION unit_provisional_usages_guard() RETURNS trigger AS $$ ...badan... $$ LANGUAGE plpgsql;
// Badan fungsi tidak boleh memuat DDL/DML (DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, EXTENSION, DELETE FROM, INSERT, UPDATE ... SET, COPY, EXECUTE, DO). Tidak ada pernyataan lain (tidak ada ALTER/CREATE TABLE/INDEX/TRIGGER, tidak ada DROP/UPDATE/DELETE/INSERT).
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8").replace(/\r\n/g, "\n").trim();
const gagal = (m) => { console.error("DITOLAK: " + m); process.exit(1); };
const awal = /^CREATE OR REPLACE FUNCTION unit_provisional_usages_guard\(\) RETURNS trigger AS \$\$\n/;
const akhir = /\n\$\$ LANGUAGE plpgsql;$|\nEND \$\$ LANGUAGE plpgsql;$/;
if (!awal.test(sql)) gagal("pernyataan pertama bukan CREATE OR REPLACE FUNCTION unit_provisional_usages_guard() RETURNS trigger AS $$");
if (!akhir.test(sql)) gagal("pernyataan tidak diakhiri $$ LANGUAGE plpgsql;");
const hitungDolar = (sql.match(/\$\$/g) || []).length; if (hitungDolar !== 2) gagal(`jumlah penanda $$ harus 2 (satu fungsi), ditemukan ${hitungDolar}`);
const badan = sql.slice(sql.indexOf("$$") + 2, sql.lastIndexOf("$$"));
const sisa = sql.slice(sql.lastIndexOf("$$") + 2).replace(/\s*LANGUAGE plpgsql;\s*/, "");
if (sisa.trim() !== "") gagal("ada teks setelah fungsi: " + sisa.trim().slice(0, 60));
const terlarang = [/\bDROP\b/i, /\bALTER\b/i, /\bCREATE\b/i, /\bTRUNCATE\b/i, /\bGRANT\b/i, /\bREVOKE\b/i, /\bEXTENSION\b/i, /\bDELETE\s+FROM\b/i, /\bINSERT\b/i, /\bUPDATE\s+\S+\s+SET\b/i, /\bCOPY\b/i, /\bEXECUTE\b(?!\s+FUNCTION)/i, /\bDO\s+\$/i, /\bPERFORM\b/i];
for (const re of terlarang) if (re.test(badan)) gagal("badan fungsi memuat " + re.source);
// semua RAISE hanya RAISE EXCEPTION (tidak ada NOTICE/ASSERT yang menulis)
if ((badan.match(/\bRAISE\b/g) || []).length !== (badan.match(/\bRAISE EXCEPTION\b/g) || []).length) gagal("RAISE selain EXCEPTION");
// satu-satunya pernyataan akhir fungsi (tidak ada ';' di luar badan)
if (/;/.test(sql.slice(0, sql.indexOf("$$"))) ) gagal("tanda ';' sebelum badan fungsi");
console.log("FUNGSI_PENJAGA=1;PERNYATAAN=1");
