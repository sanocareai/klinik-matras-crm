// Pemindai migrasi rilis "Status Produksi + Penerimaan Workshop" (1 migrasi ADITIF). FAIL-CLOSED: setiap pernyataan harus cocok PERSIS salah satu bentuk yang diaudit. Membaca SQL dari stdin (komentar baris "--" sudah dibuang pemanggil).
//   • 2 CREATE TABLE baru (unit_workshop_receipts, unit_workshop_receipt_corrections) — masing-masing memuat CHECK yang diaudit.
//   • 6 indeks HANYA pada tabel baru (dua di antaranya unik parsial dengan klausa WHERE yang diaudit); 4 foreign key ON DELETE RESTRICT (ke units / storage_locations / unit_workshop_receipts);
//     2 trigger append-only HANYA pada tabel baru yang memakai fungsi production_adopsi_append_only() YANG SUDAH ADA di produksi (migrasi 20261221090000) — migrasi ini TIDAK membuat atau mengubah fungsi.
// Tidak ada ALTER TABLE pada tabel lama (units, stock_movements, dst), tidak ada DROP/DELETE/UPDATE/INSERT/TRUNCATE/GRANT/ALTER COLUMN/RENAME/CREATE TYPE/ADD VALUE/CREATE EXTENSION/CREATE FUNCTION.
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
const T_BARU = "(?:unit_workshop_receipts|unit_workshop_receipt_corrections)";
// CHECK/constraint wajib ada di CREATE TABLE tertentu (hilangnya CHECK = migrasi berubah).
const WAJIB_DI_TABEL = {
  unit_workshop_receipts: ['CONSTRAINT "unit_workshop_receipts_seq_chk" CHECK ("seq" >= 1)'],
  unit_workshop_receipt_corrections: [
    'CONSTRAINT "unit_workshop_receipt_corrections_kind_chk" CHECK ("kind" IN (\'LOCATION\',\'NOT_RECEIVED\'))',
    'CONSTRAINT "unit_workshop_receipt_corrections_reason_chk" CHECK (length(btrim("reason")) >= 3)',
    'CONSTRAINT "unit_workshop_receipt_corrections_new_chk" CHECK (("kind" = \'LOCATION\' AND "new_value" IS NOT NULL) OR ("kind" = \'NOT_RECEIVED\' AND "new_value" IS NULL))',
  ],
};
// Indeks unik parsial: klausa WHERE wajib persis (dibuangnya WHERE mengubah makna: satu koreksi per penerimaan / kunci idempotensi unik).
const WAJIB_WHERE = {
  unit_workshop_receipt_corrections_void_once_key: ' WHERE "kind" = \'NOT_RECEIVED\'',
  unit_workshop_receipt_corrections_idem_key: ' WHERE "idempotency_key" IS NOT NULL',
};
const BENTUK = [
  ["create_table", new RegExp(`^CREATE TABLE "${T_BARU}" \\(.*\\)$`)],
  ["index", new RegExp(`^CREATE (?:UNIQUE )?INDEX "[a-z0-9_]+" ON "${T_BARU}"\\("[a-z_]+"(?:, "[a-z_]+")*\\)(?: WHERE "kind" = 'NOT_RECEIVED'| WHERE "idempotency_key" IS NOT NULL)?$`)],
  ["fk", new RegExp(`^ALTER TABLE "${T_BARU}" ADD CONSTRAINT "[a-z0-9_]+_fkey" FOREIGN KEY \\("[a-z_]+"\\) REFERENCES "(?:units|storage_locations|unit_workshop_receipts)"\\("id"\\) ON DELETE RESTRICT ON UPDATE CASCADE$`)],
  ["trigger", /^CREATE TRIGGER "(?:unit_workshop_receipts_append_only_trg" BEFORE UPDATE OR DELETE ON "unit_workshop_receipts"|unit_workshop_receipt_corrections_append_only_trg" BEFORE UPDATE OR DELETE ON "unit_workshop_receipt_corrections") FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only\(\)$/],
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
