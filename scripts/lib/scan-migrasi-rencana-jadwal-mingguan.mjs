// Pemindai migrasi rilis "Rencana Produksi — jadwal mingguan + komponen lama" (2 migrasi ADITIF, dipindai bersama). FAIL-CLOSED: setiap pernyataan harus cocok PERSIS salah satu bentuk yang diaudit. Membaca SQL dari stdin (komentar baris "--" sudah dibuang pemanggil).
//   • 3 CREATE TABLE baru (production_unit_schedules, production_unit_schedule_events, unit_component_reuse_entries) — masing-masing memuat CHECK yang diaudit.
//   • 8 indeks HANYA pada tabel baru (dua unik parsial dengan klausa WHERE yang diaudit); 6 foreign key ON DELETE RESTRICT (ke units / production_run_plans_v2 / production_unit_schedules / materials);
//     2 trigger append-only HANYA pada production_unit_schedule_events dan unit_component_reuse_entries yang memakai fungsi production_adopsi_append_only() YANG SUDAH ADA di produksi (migrasi 20261221090000) — migrasi ini TIDAK membuat atau mengubah fungsi.
// Tidak ada ALTER TABLE pada tabel lama (units, materials, production_run_plans_v2, dst), tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/ALTER COLUMN/RENAME/CREATE TYPE/ADD VALUE/CREATE EXTENSION/CREATE FUNCTION.
// Isi migrasi juga dipatok sha256 di skrip rilis; pemindai ini adalah lapisan kedua (bentuk pernyataan), diuji dengan mutan negatif.
import fs from "node:fs";
const sql = fs.readFileSync(0, "utf8");
const rapat = (x) => x.replace(/\s+/g, " ").trim();
const gagal = (m) => { console.error(m); process.exit(1); };

/** Pecah per ';' di luar blok $$ ... $$ (blok DO/fungsi — tidak diizinkan, tetapi dipecah benar agar ditolak dengan pesan jelas). */
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
const T_BARU = "(?:production_unit_schedules|production_unit_schedule_events|unit_component_reuse_entries)";
// CHECK/constraint wajib ada di CREATE TABLE tertentu (hilangnya CHECK = migrasi berubah).
const WAJIB_DI_TABEL = {
  production_unit_schedules: [
    'CONSTRAINT "production_unit_schedules_status_chk" CHECK ("status" IN (\'ACTIVE\',\'CLEARED\',\'ADOPTED\'))',
    'CONSTRAINT "production_unit_schedules_station_chk" CHECK ("station_code" IS NULL OR "station_code" ~ \'^TABLE_[0-9]{1,2}$\')',
    'CONSTRAINT "production_unit_schedules_revision_chk" CHECK ("revision" >= 1)',
  ],
  production_unit_schedule_events: [
    'CONSTRAINT "production_unit_schedule_events_kind_chk" CHECK ("kind" IN (\'SCHEDULED\',\'RESCHEDULED\',\'UNSCHEDULED\',\'TARGET_CHANGED\',\'UNDONE\',\'ADOPTED\'))',
  ],
  unit_component_reuse_entries: [
    'CONSTRAINT "unit_component_reuse_entries_kind_chk" CHECK ("kind" IN (\'CREATED\',\'CORRECTED\',\'VOIDED\'))',
    'CONSTRAINT "unit_component_reuse_entries_version_chk" CHECK ("version" >= 1 AND (("kind" = \'CREATED\') = ("version" = 1)))',
    'CONSTRAINT "unit_component_reuse_entries_source_chk" CHECK ("source" = \'OWN_UNIT\')',
    'CONSTRAINT "unit_component_reuse_entries_outcome_chk" CHECK ("outcome" IN (\'REUSED\',\'RETURNED_TO_CUSTOMER\',\'KEPT_WITH_UNIT\',\'DISCARDED\'))',
    'CONSTRAINT "unit_component_reuse_entries_qty_chk" CHECK ("qty" > 0)',
    'CONSTRAINT "unit_component_reuse_entries_name_chk" CHECK (length(btrim("name")) >= 2)',
    'CONSTRAINT "unit_component_reuse_entries_uom_chk" CHECK ("uom" ~ \'^[A-Z0-9]{1,12}$\')',
    'CONSTRAINT "unit_component_reuse_entries_reason_chk" CHECK ("kind" = \'CREATED\' OR ("reason" IS NOT NULL AND length(btrim("reason")) >= 3))',
    'CONSTRAINT "unit_component_reuse_entries_photos_chk" CHECK (jsonb_typeof("photo_urls") = \'array\')',
  ],
};
// Indeks unik parsial: klausa WHERE wajib persis (dibuangnya WHERE mengubah makna: kunci idempotensi unik per unit hanya bila terisi).
const WHERE_IDEM = ' WHERE "idempotency_key" IS NOT NULL';
const WAJIB_WHERE = { production_unit_schedule_events_unit_id_idempotency_key_key: WHERE_IDEM, unit_component_reuse_entries_unit_id_idempotency_key_key: WHERE_IDEM };
const BENTUK = [
  ["create_table", new RegExp(`^CREATE TABLE "${T_BARU}" \\(.*\\)$`)],
  ["index", new RegExp(`^CREATE (?:UNIQUE )?INDEX "[a-z0-9_]+" ON "${T_BARU}"\\("[a-z_]+"(?:, "[a-z_]+")*\\)(?: WHERE "idempotency_key" IS NOT NULL)?$`)],
  ["fk", new RegExp(`^ALTER TABLE "${T_BARU}" ADD CONSTRAINT "[a-z0-9_]+_fkey" FOREIGN KEY \\("[a-z_]+"\\) REFERENCES "(?:units|production_run_plans_v2|production_unit_schedules|materials)"\\("id"\\) ON DELETE RESTRICT ON UPDATE CASCADE$`)],
  ["trigger", /^CREATE TRIGGER "(production_unit_schedule_events|unit_component_reuse_entries)_append_only_trg" BEFORE UPDATE OR DELETE ON "\1" FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only\(\)$/],
];
// kata terlarang DI LUAR CREATE TABLE: perubahan/penghapusan data atau struktur lama, hak akses, ekstensi, fungsi
const TERLARANG = /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|GRANT|REVOKE|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|CREATE\s+TYPE|ADD\s+VALUE|ADD\s+COLUMN|DISABLE|CREATE\s+EXTENSION|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|DEFAULT\s+[^,)]+)\b/i;
const hitung = { total: 0, create_table: 0, index: 0, fk: 0, trigger: 0 };
const lihat = new Set();
for (const r of pecah(sql)) {
  hitung.total += 1;
  if (lihat.has(r)) gagal("pernyataan ganda: " + r.slice(0, 120));
  lihat.add(r);
  const jenis = BENTUK.find(([, re]) => re.test(r))?.[0];
  if (!jenis) gagal("PERNYATAAN DI LUAR DAFTAR PUTIH: " + r.slice(0, 220));
  if (jenis === "create_table") {
    const nama = /^CREATE TABLE "([a-z_]+)"/.exec(r)[1];
    for (const w of WAJIB_DI_TABEL[nama] ?? []) if (!r.includes(w)) gagal(`CREATE TABLE ${nama} kehilangan constraint yang diaudit: ${w.slice(0, 90)}`);
    if (/\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|GRANT)\b/i.test(r)) gagal("CREATE TABLE memuat kata terlarang");
  } else {
    if (TERLARANG.test(r)) gagal("kata terlarang: " + r.slice(0, 160));
    if (jenis === "index") {
      const nama = /^CREATE (?:UNIQUE )?INDEX "([a-z0-9_]+)"/.exec(r)[1];
      if (WAJIB_WHERE[nama] && !r.endsWith(WAJIB_WHERE[nama])) gagal(`indeks ${nama} kehilangan klausa WHERE yang diaudit`);
      if (!WAJIB_WHERE[nama] && / WHERE /.test(r)) gagal(`indeks ${nama} memuat WHERE yang tidak diaudit`);
    }
  }
  hitung[jenis] += 1;
}
console.log(JSON.stringify(hitung));
