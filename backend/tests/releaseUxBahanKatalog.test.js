// Gerbang skrip rilis "UX Bahan: pemakaian sementara bahan katalog + kunci material_id": skrip tersimpan = hasil bangkitan ulang; bash valid; TEPAT 1 migrasi yang di-pin + pemindai DDL (diuji pada migrasi nyata dan mutan);
// rehearsal-penuh menerapkan migrasi hanya pada salinan; bukti 36 jam wajib; migrasi production sebelum switch; verifikasi fungsi penjaga = hasil rehearsal; rollback tanpa membalik migrasi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-ux-bahan-katalog.sh"); const tpl = baca("scripts/templates/release-ux-bahan-katalog.sh.tpl");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;
const migNama = fs.readdirSync(path.join(repo, "backend/prisma/migrations")).find((n) => n.endsWith("_pemakaian_sementara_material_id_terkunci"));
const migSql = baca(`backend/prisma/migrations/${migNama}/migration.sql`);
const pindai = (sql) => spawnSync(process.execPath, [path.join(repo, "scripts/lib/scan-migrasi-material-id-terkunci.mjs")], { input: sql.split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n") + "\n", encoding: "utf8" });

test("skrip: tanpa placeholder tersisa; pin migrasi = sha256 berkas; BACKEND_SRC_EXPECT = tepat 4 berkas backend yang diaudit; tanpa nama rilis lain", () => {
  assert.ok(!/@@[A-Z_]+@@/.test(script), "placeholder tersisa");
  assert.match(script, new RegExp(`MIG_NAME="${migNama}"; MIG_PIN="${crypto.createHash("sha256").update(migSql).digest("hex")}"`));
  assert.match(script, /^BACKEND_SRC_EXPECT="backend\/src\/lib\/domain\/bahanUsulan\.js backend\/src\/routes\/productionAdopsi\.js backend\/src\/services\/productionOrderExport\.js backend\/src\/services\/unitProvisionalUsageService\.js"$/m);
  assert.ok(!/gsb|gudang-sidebar|\bubd\b|route-planner|\bskj\b/.test(script), "tidak ada sisa nama rilis lain");
});

test("skrip: sintaks bash lulus; skrip tersimpan diturunkan dari templat (sha templat di kepala)", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-ux-bahan-katalog.sh")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  const sha = script.match(/templat sha256 ([0-9a-f]{12})…/); assert.ok(sha); assert.equal(crypto.createHash("sha256").update(tpl).digest("hex").slice(0, 12), sha[1]);
});

test("pemindai DDL: migrasi nyata lolos (SATU CREATE OR REPLACE FUNCTION); mutan DROP/UPDATE/DELETE/ALTER/CREATE/EXTENSION/GRANT/badan berbahaya/nama fungsi lain DITOLAK", () => {
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr); assert.equal(ok.stdout.trim(), "FUNGSI_PENJAGA=1;PERNYATAAN=1");
  const tolak = (nama, sql) => { const r = pindai(sql); assert.notEqual(r.status, 0, `mutan lolos: ${nama}`); };
  for (const [n, t] of [["DROP TABLE", `${migSql}\nDROP TABLE "units";`], ["UPDATE", `${migSql}\nUPDATE "units" SET "status" = 'RECEIVED';`], ["DELETE", `${migSql}\nDELETE FROM "units";`], ["INSERT", `${migSql}\nINSERT INTO "stock_movements" (id) VALUES ('x');`],
    ["ALTER", `${migSql}\nALTER TABLE "units" ADD COLUMN "x" TEXT;`], ["CREATE TABLE", `${migSql}\nCREATE TABLE "x" ("id" UUID);`], ["CREATE INDEX", `${migSql}\nCREATE INDEX "x" ON "units"("status");`], ["TRUNCATE", `${migSql}\nTRUNCATE "units";`], ["EXTENSION", `${migSql}\nCREATE EXTENSION pgcrypto;`], ["GRANT", `${migSql}\nGRANT ALL ON "units" TO PUBLIC;`],
    ["fungsi kedua", `${migSql}\nCREATE FUNCTION evil() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;`], ["nama fungsi lain", migSql.replace("unit_provisional_usages_guard()", "unit_lain_guard()")],
    ["badan DROP", migSql.replace("RAISE EXCEPTION 'riwayat penyelesaian tidak boleh berubah saat dibatalkan';", "DROP TABLE units;")], ["badan DELETE FROM", migSql.replace("RAISE EXCEPTION 'kolom asal catatan pemakaian sementara tidak boleh diubah';", "DELETE FROM units;")],
    ["tanpa LANGUAGE", migSql.replace("LANGUAGE plpgsql;", "")], ["RAISE NOTICE", migSql.replace("RAISE EXCEPTION 'tautan", "RAISE NOTICE 'tautan")]]) tolak(n, t);
});

test("migrasi: hanya mengganti isi fungsi penjaga; aturan baru material_id; pengecualian TAUTKAN_ISSUE NULL → bahan pergerakan; semua aturan lama dipertahankan; tanpa DDL/DML lain", () => {
  assert.match(migSql, /^CREATE OR REPLACE FUNCTION unit_provisional_usages_guard\(\) RETURNS trigger AS \$\$/m);
  assert.ok(migSql.includes("NEW.material_id IS DISTINCT FROM OLD.material_id") && migSql.includes("OLD.material_id IS NULL AND NEW.status = 'DIREKONSILIASI' AND NEW.resolution = 'TAUTKAN_ISSUE' AND NEW.stock_movement_id IS NOT NULL") && migSql.includes("tautan bahan katalog (material_id) catatan pemakaian sementara tidak boleh diubah"));
  const lama = baca("backend/prisma/migrations/20261226090000_bahan_usulan_pemakaian_sementara/migration.sql"); const iLama = lama.indexOf("CREATE OR REPLACE FUNCTION unit_provisional_usages_guard()");
  const badanLama = lama.slice(iLama, lama.indexOf("END $$ LANGUAGE plpgsql;", iLama)); const badanBaru = migSql.slice(migSql.indexOf("CREATE OR REPLACE FUNCTION unit_provisional_usages_guard()"), migSql.indexOf("END $$ LANGUAGE plpgsql;"));
  for (const baris of badanLama.split("\n").map((x) => x.trim()).filter(Boolean)) assert.ok(badanBaru.includes(baris), "aturan lama hilang: " + baris.slice(0, 80));
  assert.ok(!/\b(CREATE TABLE|CREATE INDEX|CREATE TRIGGER|ALTER TABLE|DROP|INSERT|UPDATE\s+\S+\s+SET|DELETE FROM|TRUNCATE)\b/i.test(migSql.replace(/RAISE EXCEPTION '[^']*'/g, "")), "tanpa DDL/DML lain");
});

test("gerbang sumber: berkas prisma yang berubah = tepat migrasi rilis; schema/dependensi/Dockerfile/compose identik; baseline tidak diubah; kandidat = baseline + 1 migrasi", () => {
  for (const k of ['EXPECT_PRISMA="backend/prisma/migrations/${MIG_NAME}/migration.sql"', "berkas prisma yang berubah HARUS tepat migrasi rilis ini", "ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang", "backend/prisma/schema.prisma backend/package.json backend/package-lock.json backend/Dockerfile docker-compose.yml docker-compose.release.yml",
    "migrasi kandidat = baseline", "himpunan migrasi kandidat bukan tepat baseline + migrasi rilis", 'SCAN_EXPECT=\'FUNGSI_PENJAGA=1;PERNYATAAN=1\'', "uji negatif pemindai", "mutan '${nama}' LOLOS"]) assert.ok(script.includes(k), k);
  assert.ok(!script.includes("prisma/ berubah — rilis ini TANPA migrasi"), "gerbang 'tanpa migrasi' sudah diganti");
});

test("keadaan production SEGAR/LANJUT; sidik jari skema (semua tabel) + fungsi penjaga; rehearsal-penuh menerapkan migrasi HANYA pada salinan dengan image kandidat bertag rehearsal; bukti memuat sidik jari fungsi", () => {
  for (const k of ["keadaan_produksi()", "echo SEGAR", "echo LANJUT", "TOLAK: migrasi terpasang BUKAN baseline atau baseline + migrasi rilis", "SKEMA_SQL=", "FUNC_SQL=", "rehearsal_migrasi()", 'npx prisma migrate deploy > "$BK_DIR/migrate-rehearsal.log"', "migrate deploy pada salinan GAGAL", "migrasi MENGUBAH skema", "migrasi MENGUBAH isi tabel", "hanya isi fungsi penjaga berubah",
    "isi fungsi penjaga tidak berubah/terbaca setelah migrasi", 'REH_IMG="${IMG_NAME%%:*}:rehearsal-ubk-${DEPLOY_SHORT}"', "uji tulis dilakukan HANYA pada salinan", "FUNC_MD5=%s", "sidik jari fungsi penjaga pasca-migrasi", ".rehearsal-penuh-ok-ux-bahan-katalog-", "-mmin -2160", "belum ada bukti --rehearsal-penuh LULUS"]) assert.ok(script.includes(k), k);
  const blokR = script.slice(script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]; then\n  PHASE="3-backup-rehearsal"'), script.indexOf("# Rilis penuh: WAJIB ada bukti"));
  assert.ok(blokR.length > 800 && !/up -d|docker tag|mkdir "\$NEW_DIR"|dcp "\$NEW_DIR" run|psql_live[^\n]*(INSERT|UPDATE|DELETE|DROP|ALTER)/.test(blokR), "blok rehearsal: tanpa release dir, tanpa switch, tanpa migrasi/tulis ke production");
});

test("rilis penuh: urutan bukti → backup → release dir + web → image baru → rehearsal migrasi pada salinan → MIGRASI production (backend lama melayani) → switch → verifikasi; fungsi penjaga = hasil rehearsal; checksum; rollback tanpa membalik migrasi", () => {
  const idx = (k) => { const i = script.indexOf(k); assert.ok(i > 0, k); return i; };
  assert.ok(idx("# Rilis penuh: WAJIB ada bukti") < idx('PHASE="3-backup"; say') && idx('PHASE="3-backup"; say') < idx('PHASE="5-build-image"') && idx('PHASE="5-build-image"') < idx('rehearsal_migrasi "$NEW_IMG_ID"') && idx('rehearsal_migrasi "$NEW_IMG_ID"') < idx('PHASE="6-migrate"') && idx('PHASE="6-migrate"') < idx('PHASE="7-switch"') && idx('PHASE="7-switch"') < idx('PHASE="8-verifikasi"'));
  for (const k of ['dcp "$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy', "keadaan production berubah sejak preflight", "isi fungsi penjaga production != hasil rehearsal (jangan switch)", "checksum ${MIG_NAME} tidak cocok berkas kandidat", "skema tabel/kolom/constraint/indeks/trigger BERUBAH oleh migrasi (jangan switch)", "keadaan LANJUT: isi fungsi penjaga production BERBEDA dari hasil rehearsal",
    "container baru TIDAK memuat ${f} persis", "fungsi penjaga pasca-switch berbeda dari hasil rehearsal", "jumlah migrasi terpasang != baseline + 1", "migrasi TIDAK dibalik", "kompatibel", "rollback-pre-ubk-", "SMOKE_HASIL fail=0 skip=", "dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis"]) assert.ok(script.includes(k), k);
  assert.ok(script.indexOf('dcp "$NEW_DIR" build backend') > 0, "image backend dibangun (backend berubah)");
});

test("sidik jari beku: 30 kelompok termasuk usulan + pemakaian sementara (id saja, baris boleh berubah status oleh pengguna sah)", () => {
  assert.ok(script.includes("usulan_bahan_id") && script.includes("pemakaian_sementara_id") && script.includes("FPB_N=30")); assert.equal((script.match(/union all select '/g) || []).length + 1, 30);
});

test("pustaka rehearsal dan smoke: rehearsal menulis HANYA pada salinan (dokumentasi + cek), smoke baca-saja; keduanya mencetak ringkasan yang dicek skrip", () => {
  const reh = baca("scripts/lib/rehearsal-ux-bahan-katalog.mjs"); const smoke = baca("scripts/lib/smoke-ux-bahan-katalog.mjs");
  assert.match(reh, /REHEARSAL_KODE_BARU gagal=/); assert.match(reh, /SALINAN RESTORE/); assert.ok(reh.includes("pemeriksaan ini") || reh.includes("TANPA Material Issue"));
  assert.ok(!/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(smoke) && !/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(smoke) && !/method:\s*["'](PUT|PATCH|DELETE)/i.test(smoke), "smoke baca-saja");
  assert.match(smoke, /SMOKE_HASIL fail=" \+ fail \+ " skip=" \+ dilewati/);
  assert.ok(script.includes("rehearsal-kode.mjs") && script.includes("REHEARSAL_KODE_BARU gagal=0") === false, "skrip memeriksa exit code uji aplikasi (bukan teks tetap)");
});
