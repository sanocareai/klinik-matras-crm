// Pemindai migrasi rilis "Rekonsiliasi pemakaian historis" (1 migrasi ADITIF). FAIL-CLOSED: setiap pernyataan harus cocok PERSIS salah satu bentuk yang diaudit. Membaca SQL dari stdin (komentar baris "--" sudah dibuang pemanggil).
//   • 4 CREATE TABLE baru (usage_import_batches, unit_usage_notes, unit_usage_note_events, fin_stock_movement_valuation_corrections) — wajib memuat CHECK yang diaudit.
//   • indeks HANYA pada tabel baru; foreign key HANYA dari tabel baru (ON DELETE RESTRICT); 3 fungsi penjaga + 3 trigger HANYA pada tabel baru (badan fungsi hanya IF/RAISE/RETURN, tanpa DDL/DML).
//   • TEPAT 5 pernyataan pada tabel LAMA, ditulis persis: warehouse_corrections (DROP + ADD CONSTRAINT jenis_chk yang diperlonggar satu hal: doc_type + 'UNIT_USAGE') dan stock_adjustment_requests (2 kolom TEXT nullable + CHECK pasangan).
// Tidak ada INSERT/UPDATE/DELETE/TRUNCATE/GRANT/RENAME/CREATE TYPE/EXTENSION; tidak ada kolom NOT NULL baru pada tabel lama. Isi migrasi juga dipatok sha256 di skrip rilis; pemindai ini lapisan kedua, diuji dengan mutan negatif.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };

/** Pecah per ';' di luar blok $$ ... $$ (fungsi). */
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
const T_BARU = "(?:usage_import_batches|unit_usage_notes|unit_usage_note_events|fin_stock_movement_valuation_corrections)";
const F_BARU = "(?:unit_usage_notes_guard|unit_usage_note_events_guard|fin_smv_corr_append_only)";
const WAJIB_DI_TABEL = {
  usage_import_batches: ['CONSTRAINT "usage_import_batches_kind_chk" CHECK ("source_kind" IN (\'EXCEL_ADMIN_SALES_CSV\'))', 'CONSTRAINT "usage_import_batches_sha_chk"'],
  unit_usage_notes: ['CONSTRAINT "unit_usage_notes_origin_chk" CHECK ("origin" IN (\'EXCEL\',\'LEDGER\'))', 'CONSTRAINT "unit_usage_notes_state_chk"', 'CONSTRAINT "unit_usage_notes_posted_chk"', 'CONSTRAINT "unit_usage_notes_siap_chk"'],
  unit_usage_note_events: ['CONSTRAINT "unit_usage_note_events_kind_chk"', 'CONSTRAINT "unit_usage_note_events_reason_chk"'],
  fin_stock_movement_valuation_corrections: ['CONSTRAINT "fin_smv_corr_reason_chk" CHECK (length(btrim("reason")) >= 5)', 'CONSTRAINT "fin_smv_corr_cost_chk" CHECK ("unit_cost_basis" >= 0)'],
};
// Pernyataan pada tabel LAMA: hanya bentuk persis ini.
const LAMA_PERSIS = new Set([
  'ALTER TABLE "warehouse_corrections" DROP CONSTRAINT "warehouse_corrections_jenis_chk"',
  `ALTER TABLE "warehouse_corrections" ADD CONSTRAINT "warehouse_corrections_jenis_chk" CHECK ("doc_type" IN ('GOODS_RECEIPT', 'UNIT_USAGE') AND "kind" IN ('METADATA', 'STOCK') AND "status" IN ('PENDING_APPROVAL', 'POSTED', 'REJECTED', 'CANCELLED'))`,
  'ALTER TABLE "stock_adjustment_requests" ADD COLUMN "origin_type" TEXT',
  'ALTER TABLE "stock_adjustment_requests" ADD COLUMN "origin_id" TEXT',
  'ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_origin_chk" CHECK (("origin_type" IS NULL) = ("origin_id" IS NULL))',
]);
const BENTUK = [
  ["create_table", new RegExp(`^CREATE TABLE "${T_BARU}" \\(.*\\)$`)],
  ["index", new RegExp(`^CREATE (?:UNIQUE )?INDEX "[a-z0-9_]+" ON "${T_BARU}"\\("[a-z0-9_]+"(?:, "[a-z0-9_]+")*\\)(?: WHERE "[a-z_]+" IS NOT NULL)?$`)],
  ["fk", new RegExp(`^ALTER TABLE "${T_BARU}" ADD CONSTRAINT "[a-z0-9_]+_fkey" FOREIGN KEY \\("[a-z_]+"\\) REFERENCES "(?:usage_import_batches|Order|units|materials|stock_movements|unit_usage_notes)"\\("id"\\) ON DELETE RESTRICT ON UPDATE CASCADE$`)],
  ["fungsi", new RegExp(`^CREATE OR REPLACE FUNCTION ${F_BARU}\\(\\) RETURNS trigger AS \\$\\$ BEGIN .* END \\$\\$ LANGUAGE plpgsql$`)],
  ["trigger", new RegExp(`^CREATE TRIGGER "(?:unit_usage_notes_guard_trg|unit_usage_note_events_guard_trg|fin_smv_corr_append_only_trg)" BEFORE UPDATE OR DELETE ON "${T_BARU}" FOR EACH ROW EXECUTE FUNCTION ${F_BARU}\\(\\)$`)],
];
const TERLARANG = /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|GRANT|REVOKE|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|CREATE\s+TYPE|ADD\s+VALUE|DISABLE|CREATE\s+EXTENSION)\b/i;
// badan fungsi: setelah literal string dibuang, TIDAK boleh ada DDL/DML/EXECUTE/PERFORM
const TERLARANG_BADAN = /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT|UPDATE|CREATE|ALTER|GRANT|REVOKE|EXECUTE|PERFORM|COPY|SELECT|DO)\b/i;
const hitung = { total: 0, create_table: 0, index: 0, fk: 0, fungsi: 0, trigger: 0, alter_lama: 0 };
const lihat = new Set();
for (const r of pecah(sql)) {
  hitung.total += 1;
  if (lihat.has(r)) gagal("pernyataan ganda: " + r.slice(0, 120));
  lihat.add(r);
  let jenis = LAMA_PERSIS.has(r) ? "alter_lama" : BENTUK.find(([, re]) => re.test(r))?.[0];
  if (!jenis) gagal("PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 220));
  const luarBadan = r.replace(/\$\$.*\$\$/g, "$$$$");
  if (jenis === "create_table") {
    const nama = /^CREATE TABLE "([a-z_]+)"/.exec(r)[1];
    for (const w of WAJIB_DI_TABEL[nama] ?? []) if (!r.includes(w)) gagal(`CREATE TABLE ${nama} kehilangan constraint yang diaudit: ${w.slice(0, 90)}`);
    if (/\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|GRANT)\b/i.test(r)) gagal("CREATE TABLE memuat kata terlarang");
    if (/\bDEFAULT\s+(?!CURRENT_TIMESTAMP|'\{\}'|'\[\]')/i.test(r)) gagal("DEFAULT tidak dikenal di CREATE TABLE " + nama);
  } else if (jenis === "fungsi") {
    const badan = /\$\$(.*)\$\$/.exec(r)[1].replace(/'[^']*'/g, "''");
    if (TERLARANG_BADAN.test(badan)) gagal("badan fungsi memuat DDL/DML terlarang: " + badan.slice(0, 160));
  } else if (jenis !== "alter_lama" && TERLARANG.test(luarBadan)) gagal("kata terlarang di luar badan fungsi: " + r.slice(0, 160));
  hitung[jenis] += 1;
}
console.log(JSON.stringify(hitung));
