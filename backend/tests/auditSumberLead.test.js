// Skrip audit sumber lead harus BACA-SAJA dan tidak boleh memuat pengenal pribadi pada keluaran.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sql = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/audit-sumber-lead.sql"), "utf8").replace(/\r\n/g, "\n");
const kode = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

test("audit sumber lead: transaksi READ ONLY, diakhiri COMMIT, tanpa perintah menulis atau tabel sementara", () => {
  assert.match(kode, /^BEGIN READ ONLY;/);
  assert.match(kode.trim(), /COMMIT;$/);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|COPY)\b/i.test(kode.replace(/'[^']*'/g, "''")), "tidak boleh ada perintah menulis");
});

test("audit sumber lead: keluaran hanya agregat (tidak memilih nomor, nama, isi chat, clid mentah, atau teks detail)", () => {
  const select = kode.split("\n").filter((l) => /^SELECT (?!c\.id)/.test(l)).join("\n");
  for (const kolom of ['phone', 'name', 'content', 'ctwa_clid,', 'ctwa_source_url,', 'leadSourceDetail"\s*,']) assert.ok(!new RegExp(`\bSELECT\b[^;]*\b${kolom}`, "i").test(select.replace(/count\([^)]*\)/gi, "").replace(/FILTER \([^)]*\)/gi, "")) || kolom === "name", kolom);
  assert.ok(!/\bSELECT\b[^;]*"leadSourceDetail"[^;]*FROM "Customer" c WHERE/i.test(kode.replace(/CASE[\s\S]*?END AS detail[_a-z]*/g, "")), "teks detail hanya dipakai di klasifikasi CASE");
  assert.ok((sql.match(/\echo ==/g) || []).length >= 6);
});
