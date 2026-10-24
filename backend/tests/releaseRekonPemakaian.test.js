// Gerbang skrip rilis "Rekonsiliasi pemakaian historis": RILIS KODE ≠ TINDAKAN DATA. Skrip tersimpan = turunan templat; bash valid; migrasi di-pin + pemindai DDL (diuji pada migrasi nyata dan mutan);
// skrip tidak memuat langkah impor/posting di luar salinan rehearsal; smoke membuktikan antrean kosong; prasyarat baseline (693b8c52 harus live) dijaga; bukti rehearsal-penuh 36 jam wajib.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-rekon-pemakaian.sh"); const tpl = baca("scripts/templates/release-rekon-pemakaian.sh.tpl");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;
const MIG = "20261228090000_catatan_pemakaian_historis";
const migSql = baca(`backend/prisma/migrations/${MIG}/migration.sql`);
const pindai = (sql) => spawnSync(process.execPath, [path.join(repo, "scripts/lib/scan-migrasi-rekon-pemakaian.mjs")], { input: sql.split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n") + "\n", encoding: "utf8" });

test("skrip: tanpa placeholder tersisa; pin migrasi = sha256 berkas; SCAN_EXPECT = hasil pemindai pada migrasi nyata; prasyarat tertulis; tanpa nama rilis lain", () => {
  assert.ok(!/@@[A-Z_]+@@/.test(script), "placeholder tersisa");
  assert.match(script, new RegExp(`MIG_NAME="${MIG}"; MIG_PIN="${crypto.createHash("sha256").update(migSql).digest("hex")}"`));
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr);
  assert.ok(script.includes(`SCAN_EXPECT='${ok.stdout.trim()}'`), "SCAN_EXPECT tidak sama dengan hasil pemindai");
  assert.match(script, /PRASYARAT="rilis UX Bahan katalog \(fix\/ux-bahan-drawer-pemakaian, commit 693b8c52/);
  assert.match(script, /DIFF_PINS="backend\/src\/services\/inventoryLedger\.js:[0-9a-f]{64} backend\/src\/routes\/stockAdjustment\.js:[0-9a-f]{64}"/);
  assert.ok(!/ubk|ux-bahan-katalog|gsb|gudang-sidebar|route-planner|\bskj\b/.test(script.replace(/rilis UX Bahan katalog \(fix\/ux-bahan-drawer-pemakaian[^"]*/, "")), "sisa nama rilis lain");
});

test("skrip: sintaks bash lulus; sha templat di kepala = sha templat sekarang", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-rekon-pemakaian.sh")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  const sha = script.match(/templat sha256 ([0-9a-f]{12})…/); assert.ok(sha); assert.equal(crypto.createHash("sha256").update(tpl).digest("hex").slice(0, 12), sha[1]);
});

test("RILIS KODE ≠ TINDAKAN DATA: di luar salinan rehearsal skrip tidak mengimpor CSV, tidak memposting, tidak memanggil skrip impor/posting; kebijakan tertulis", () => {
  const tanpaBlok = script.replace(/<<'(REHNODE|NODE|SCANJS)'[^\n]*\n[\s\S]*?\n\s*\1\n/g, "<<$1 (blok dibuang)\n").split("\n").filter((l) => !/^(ALLOWED_RE|BACKEND_SRC_EXPECT|FRONTEND_SRC_EXPECT)=/.test(l)).join("\n"); // daftar berkas yang BOLEH ikut rilis memang menyebut berkas skrip impor; itu bukan pemanggilannya
  for (const kata of ["import-pemakaian-historis", "laporan-rekonsiliasi-pemakaian", "terapkanImpor", "rencanakanImpor", "jalankanPosting", "posting-historis/jalankan", "--apply", "DIPOSTING"]) assert.ok(!tanpaBlok.includes(kata), `skrip memuat langkah data di luar blok uji: ${kata}`);
  assert.match(script, /RILIS KODE ≠ TINDAKAN DATA/); assert.match(script, /TIDAK memposting 384 transaksi/); assert.match(script, /persetujuan Owner sendiri SETELAH fitur live/);
  assert.match(script, /ANTREAN KOSONG/);
});

test("rehearsal (salinan restore) dan smoke (production) membuktikan ANTREAN KOSONG: tabel baru 0 baris, rencana posting 0 transaksi, tidak menulis", () => {
  const reh = baca("scripts/lib/rehearsal-rekon-pemakaian.mjs"); const smoke = baca("scripts/lib/smoke-rekon-pemakaian.mjs");
  assert.match(reh, /ANTREAN POSTING KOSONG/); assert.match(reh, /r0\.jumlah === 0/); assert.match(reh, /bagian A tidak menulis apa pun/);
  assert.match(smoke, /rencana posting historis \(Admin\) 200 dan 0 transaksi/); assert.match(smoke, /KOSONG saat rilis/); assert.match(smoke, /smoke tidak menulis/);
  assert.match(smoke, /posting historis tanpa token → 401/); assert.match(smoke, /akun hanya-lihat → 403/);
  assert.match(script, /smoke test lulus|SMOKE_HASIL fail=0/);
});

test("gerbang: baseline = release aktif (prasyarat 693b8c52); migrasi kandidat = baseline + 1; prisma = migrasi + schema.prisma; dependensi/Docker identik; diff ledger dipatok; berkas pelindung identik", () => {
  assert.match(script, /PRASYARAT BELUM TERPENUHI atau produksi bergeser/);
  assert.match(script, /migrasi kandidat harus = baseline \+ \$\{MIG_NAME\} \(terakhir\)/);
  assert.match(script, /berkas prisma yang berubah HARUS tepat migrasi rilis ini \+ schema\.prisma/);
  assert.match(script, /dependensi\/Docker/); assert.match(script, /diff \$\{f\} terhadap baseline BERBEDA dari yang diaudit/);
  assert.match(script, /--full-index/); assert.match(script, /GUARD_UNCHANGED="[^"]*warehouseCorrection\.js/);
  assert.ok(!/GUARD_UNCHANGED="[^"]*inventoryLedger\.js/.test(script), "inventoryLedger.js berubah (createdAt historis) dan dijaga lewat DIFF_PINS, bukan daftar identik");
  assert.match(script, /LIVE_MIG_JUMLAH="267"/); assert.match(script, /LIVE_MIG_TERAKHIR="20261227090000_pemakaian_sementara_material_id_terkunci"/);
});

test("rehearsal-penuh wajib sebelum rilis penuh (bukti 36 jam, SHA + baseline sama); migrasi production sebelum switch; struktur 0|0|0|1 → 4|3|2|2; tabel lama + fungsi lama identik; tanpa drift schema.prisma", () => {
  assert.match(script, /belum ada bukti --rehearsal-penuh LULUS/); assert.match(script, /-mmin -2160/);
  assert.match(script, /"0\|0\|0\|1"/); assert.match(script, /"4\|3\|2\|2"/);
  assert.match(script, /migrate diff --from-url/); assert.match(script, /drift pada objek rilis ini/);
  assert.match(script, /fungsi LAMA berubah setelah migrasi/); assert.match(script, /migrasi MENGUBAH skema tabel LAMA di luar 5 pernyataan yang diaudit/);
  assert.match(script, /\(to_jsonb\(x\) - 'origin_type' - 'origin_id'\)/, "sidik jari penyesuaian stok mengecualikan kolom baru");
  assert.ok(script.indexOf('PHASE="6-migrate"') < script.indexOf('PHASE="7-switch"') && script.indexOf('PHASE="7-switch"') < script.indexOf('PHASE="8b-smoke"'));
  assert.match(script, /rollback-pre-rkp-/); assert.match(script, /migrasi TIDAK dibalik|Migrasi TIDAK perlu dibalik/);
});

test("pemindai DDL: migrasi nyata lolos (4 CREATE TABLE, 5 pernyataan tabel lama persis); mutan DROP/UPDATE/DELETE/INSERT/ALTER/kolom NOT NULL/pagar longgar/FK CASCADE/fungsi liar/badan berbahaya/constraint audit hilang DITOLAK", () => {
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr); assert.deepEqual(JSON.parse(ok.stdout), { total: 34, create_table: 4, index: 12, fk: 7, fungsi: 3, trigger: 3, alter_lama: 5 });
  const tolak = (nama, sql) => { const r = pindai(sql); assert.notEqual(r.status, 0, `mutan lolos: ${nama}`); };
  const tambah = (s) => `${migSql}\n${s}`;
  const mutan = [
    ["DROP TABLE", tambah('DROP TABLE "units";')], ["UPDATE", tambah(`UPDATE "units" SET "status" = 'RECEIVED';`)], ["DELETE", tambah('DELETE FROM "units";')], ["INSERT backfill", tambah(`INSERT INTO "unit_usage_notes" (id) VALUES ('x');`)],
    ["TRUNCATE", tambah('TRUNCATE "unit_usage_notes";')], ["ALTER tabel lama", tambah('ALTER TABLE "units" ADD COLUMN "x" TEXT;')], ["kolom tambahan koreksi Gudang", tambah('ALTER TABLE "warehouse_corrections" ADD COLUMN "x" TEXT;')],
    ["kolom NOT NULL", tambah('ALTER TABLE "stock_adjustment_requests" ADD COLUMN "origin_x" TEXT NOT NULL;')], ["pagar dilonggarkan", migSql.replace("'UNIT_USAGE'", "'UNIT_USAGE', 'EVIL'")],
    ["CREATE TABLE liar", tambah('CREATE TABLE "x" ("id" UUID NOT NULL);')], ["INDEX tabel lama", tambah('CREATE INDEX "x_idx" ON "units"("status");')], ["FK dari tabel lama", tambah('ALTER TABLE "units" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("id") REFERENCES "unit_usage_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;')],
    ["FK CASCADE", tambah('ALTER TABLE "unit_usage_notes" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;')],
    ["TRIGGER tabel lama", tambah('CREATE TRIGGER "x_trg" BEFORE UPDATE ON "units" FOR EACH ROW EXECUTE FUNCTION unit_usage_notes_guard();')], ["DROP TRIGGER", tambah('DROP TRIGGER "unit_usage_notes_guard_trg" ON "unit_usage_notes";')],
    ["DISABLE TRIGGER", tambah('ALTER TABLE "unit_usage_notes" DISABLE TRIGGER ALL;')], ["fungsi liar", tambah('CREATE FUNCTION evil() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql;')],
    ["badan DELETE", migSql.replace("RETURN NEW;", "DELETE FROM units; RETURN NEW;")], ["badan EXECUTE", migSql.replace("RETURN NEW;", "EXECUTE 'x'; RETURN NEW;")],
    ["constraint audit hilang", migSql.replace('"unit_usage_notes_posted_chk"', '"x_chk"')], ["CHECK pasangan hilang", migSql.replace("stock_adjustment_requests_origin_chk", "stock_adjustment_requests_x_chk")],
    ["EXTENSION", tambah('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')], ["GRANT", tambah('GRANT ALL ON "unit_usage_notes" TO PUBLIC;')], ["DROP CONSTRAINT lama", tambah('ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_pkey";')],
  ];
  for (const [n, t] of mutan) tolak(n, t);
});

test("migrasi disamakan dengan schema.prisma: unik biasa, nama FK dan indeks sesuai konvensi Prisma (tanpa drift pada objek rilis)", () => {
  assert.ok(!/WHERE "idempotency_key" IS NOT NULL/.test(migSql.replace(/^--.*$/gm, "")), "indeks unik peristiwa harus biasa (sama dengan @@unique)");
  assert.match(migSql, /"fin_stock_movement_valuation_corrections_movement_id_fkey"/); assert.match(migSql, /"fin_stock_movement_valuation_corrections_movement_id_create_idx"/);
  assert.ok(!/fin_smv_corr_movement_fkey|movement_id_created_at_idx/.test(migSql));
});
