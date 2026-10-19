// Pemindai migrasi rilis "Order Produksi adopsi Admin" (1 migrasi ADITIF). FAIL-CLOSED: setiap pernyataan harus cocok PERSIS salah satu bentuk yang diaudit. Membaca SQL dari stdin (komentar baris "--" sudah dibuang pemanggil).
//   • 3 CREATE TABLE baru (production_unit_work_progress, production_unit_material_plans, production_unit_material_plan_revisions) — masing-masing memuat CHECK yang diaudit.
//   • 3 indeks (1 biasa, 2 unik) HANYA pada tabel baru; 3 foreign key ON DELETE RESTRICT (ke units / production_unit_material_plans); 1 fungsi append-only + 2 trigger HANYA pada tabel baru.
// Tidak ada ALTER TABLE pada tabel lama (units, stock_movements, dst), tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/ALTER COLUMN/RENAME/CREATE TYPE/ADD VALUE/CREATE EXTENSION di luar badan fungsi.
// Isi migrasi juga dipatok sha256 di skrip rilis; pemindai ini adalah lapisan kedua (bentuk pernyataan), diuji dengan mutan negatif.
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
const T_BARU = "(?:production_unit_work_progress|production_unit_material_plans|production_unit_material_plan_revisions)";
// CHECK/constraint wajib ada di CREATE TABLE tertentu (hilangnya CHECK = migrasi berubah).
const WAJIB_DI_TABEL = {
  production_unit_work_progress: ['CONSTRAINT "production_unit_work_progress_status_chk" CHECK ("status" IN (\'BELUM_DIJADWALKAN\',\'DIJADWALKAN\',\'DIKERJAKAN\',\'TERTUNDA\',\'SELESAI\'))'],
  production_unit_material_plans: ['CONSTRAINT "production_unit_material_plans_lines_array_chk" CHECK (jsonb_typeof("lines") = \'array\')'],
  production_unit_material_plan_revisions: [],
};
const BENTUK = [
  ["create_table", new RegExp(`^CREATE TABLE "${T_BARU}" \\(.*\\)$`)],
  ["index", new RegExp(`^CREATE (?:UNIQUE )?INDEX "[a-z0-9_]+" ON "${T_BARU}"\\("[a-z_]+"(?:, "[a-z_]+")*\\)$`)],
  ["fk", new RegExp(`^ALTER TABLE "${T_BARU}" ADD CONSTRAINT "[a-z0-9_]+_fkey" FOREIGN KEY \\("[a-z_]+"\\) REFERENCES "(?:units|production_unit_material_plans)"\\("id"\\) ON DELETE RESTRICT ON UPDATE CASCADE$`)],
  ["fungsi", /^CREATE OR REPLACE FUNCTION production_adopsi_append_only\(\) RETURNS TRIGGER AS \$\$ BEGIN RAISE EXCEPTION '% bersifat append-only \(% ditolak\)', TG_TABLE_NAME, TG_OP; END; \$\$ LANGUAGE plpgsql$/],
  ["trigger", /^CREATE TRIGGER "(?:production_unit_work_progress_append_only_trg" BEFORE UPDATE OR DELETE ON "production_unit_work_progress"|production_unit_material_plan_revisions_append_only_trg" BEFORE UPDATE OR DELETE ON "production_unit_material_plan_revisions") FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only\(\)$/],
];
// kata terlarang DI LUAR badan $$ (fungsi): perubahan/penghapusan data atau struktur lama, hak akses, ekstensi
const TERLARANG = /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|GRANT|REVOKE|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|CREATE\s+TYPE|ADD\s+VALUE|ADD\s+COLUMN|DISABLE|CREATE\s+EXTENSION|DEFAULT\s+[^,)]+)\b/i;
const hitung = { total: 0, create_table: 0, index: 0, fk: 0, fungsi: 0, trigger: 0 };
const lihat = new Set();
for (const r of pecah(sql)) {
  hitung.total += 1;
  if (lihat.has(r)) gagal("pernyataan ganda: " + r.slice(0, 120));
  lihat.add(r);
  const jenis = BENTUK.find(([, re]) => re.test(r))?.[0];
  if (!jenis) gagal("PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 220));
  const luarBadan = r.replace(/\$\$.*\$\$/g, "$$$$");
  if (jenis === "create_table") {
    const nama = /^CREATE TABLE "([a-z_]+)"/.exec(r)[1];
    for (const w of WAJIB_DI_TABEL[nama] ?? []) if (!r.includes(w)) gagal(`CREATE TABLE ${nama} kehilangan constraint yang diaudit: ${w.slice(0, 80)}`);
    if (/\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|GRANT)\b/i.test(r)) gagal("CREATE TABLE memuat kata terlarang");
  } else if (TERLARANG.test(luarBadan)) gagal("kata terlarang di luar badan fungsi: " + r.slice(0, 160));
  hitung[jenis] += 1;
}
console.log(JSON.stringify(hitung));
