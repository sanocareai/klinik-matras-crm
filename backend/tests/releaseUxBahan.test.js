// Skrip rilis "UX Bahan": pin migrasi sesuai berkas, pemindai DDL menolak mutan, generator konsisten, guard rollback baca-saja, mode rehearsal-only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(repo, rel), "utf8"));
const NAMA_MIG = "20261226090000_bahan_usulan_pemakaian_sementara";
const migSql = baca(`backend/prisma/migrations/${NAMA_MIG}/migration.sql`);
const skrip = baca("scripts/release-ux-bahan.sh");
const guard = baca("scripts/rollback-guard-ux-bahan.sh");
const bersih = (sql) => sql.split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n") + "\n";
const pindai = (sql) => spawnSync(process.execPath, [path.join(repo, "scripts/lib/scan-migrasi-ux-bahan.mjs")], { input: bersih(sql), encoding: "utf8" });

test("pin migrasi di skrip rilis = sha256 isi berkas migrasi (LF); nama migrasi cocok", () => {
  const pin = skrip.match(/^MIG_PIN="([0-9a-f]{64})"$/m)?.[1]; const nama = skrip.match(/^MIG_NAME="([^"]+)"$/m)?.[1];
  assert.equal(nama, NAMA_MIG); assert.equal(pin, crypto.createHash("sha256").update(migSql).digest("hex"));
});

test("pemindai DDL: migrasi asli lulus dengan hitungan yang dipin; semua mutan ditolak atau berhitungan beda", () => {
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), skrip.match(/^SCAN_EXPECT='([^']+)'$/m)[1]);
  const mutan = {
    "DROP TABLE units": migSql + 'DROP TABLE "units";\n', "UPDATE units": migSql + "UPDATE \"units\" SET \"status\" = 'X';\n", "DELETE": migSql + 'DELETE FROM "units";\n', "INSERT": migSql + "INSERT INTO \"stock_movements\" (id) VALUES ('x');\n",
    "ALTER units": migSql + 'ALTER TABLE "units" ADD COLUMN "x" TEXT;\n', "ALTER tabel baru": migSql + 'ALTER TABLE "material_proposals" ADD COLUMN "x" TEXT;\n', "CREATE TABLE liar": migSql + 'CREATE TABLE "x" ("id" UUID NOT NULL);\n',
    "FK CASCADE": migSql.split("ON DELETE RESTRICT").join("ON DELETE CASCADE"), "FK SET NULL": migSql.split("ON DELETE RESTRICT").join("ON DELETE SET NULL"),
    "trigger dibuang": migSql.split("\n").filter((l) => !l.includes('CREATE TRIGGER "material_proposals_guard_trg"')).join("\n"), "fungsi liar": migSql + 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;\n',
    "badan fungsi DROP": migSql.replace("RAISE EXCEPTION 'riwayat penyelesaian tidak boleh berubah saat dibatalkan';", "DROP TABLE units;"), "GRANT": migSql + 'GRANT ALL ON "units" TO PUBLIC;\n', "EXTENSION": migSql + 'CREATE EXTENSION "pgcrypto";\n',
    "indeks di tabel lama": migSql + 'CREATE INDEX "x" ON "units"("status");\n', "FK ke tabel lain": migSql + 'ALTER TABLE "material_proposals" ADD CONSTRAINT "x" FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;\n',
  };
  for (const [nama, sql] of Object.entries(mutan)) { const r = pindai(sql); assert.ok(r.status !== 0 || r.stdout.trim() !== ok.stdout.trim(), `mutan '${nama}' lolos pemindai`); }
});

test("skrip rilis: gerbang prisma/keadaan/rehearsal/migrasi/switch berurutan; mode --rehearsal-only berhenti sebelum migrasi produksi; produksi tidak ditulis saat rehearsal", () => {
  const urut = ['PHASE="1-sumber"', 'PHASE="2-audit-produksi"', 'PHASE="3-backup"', 'PHASE="5-build-image"', 'PHASE="5b-rehearsal"', 'PHASE="6-migrate"', 'PHASE="7-switch"', 'PHASE="8-verifikasi"', 'PHASE="8b-smoke"'].map((p) => skrip.indexOf(p));
  assert.ok(urut.every((x) => x > 0) && urut.every((x, i) => i === 0 || x > urut[i - 1]), `urutan fase: ${urut}`);
  const reh = skrip.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]; then'); assert.ok(reh > urut[4] && reh < urut[5], "rehearsal-only keluar sebelum fase 6 (migrasi produksi)");
  assert.match(skrip, /keadaan_produksi\(\) \{/); assert.match(skrip, /tentukan_keadaan\(\) \{/); assert.match(skrip, /KEADAAN2="\$\(keadaan_produksi "2"\)"/); assert.match(skrip, /struktur_baru RPSQL gagal_reh/);
  assert.match(skrip, /migrate deploy <\/dev\/null > "\$BK_DIR\/migrate-rehearsal\.log"/); assert.ok(!/prisma migrate deploy[^\n]*REH_DB/.test(skrip.slice(urut[5])), "migrate deploy produksi tidak menunjuk DB rehearsal");
  assert.match(skrip, /harus_ditolak "FK CASCADE/); assert.match(skrip, /ok "uji negatif pemindai: \$\{NEG\} mutan/);
  assert.match(skrip, /rollback-guard-ux-bahan\.sh/);
  assert.ok(!/status-kerja|rjm\.sh|jadwal-mingguan/.test(skrip.replace(/\n# \(dibangkitkan[^\n]*\n/, "\n").replace(/scripts\/release-status-kerja-buka-pekerjaan\.sh/g, "")), "tidak ada sisa nama rilis lain");
  assert.match(skrip, /ALLOWED_RE='\^\(/); const tanpaEsc = skrip.split("\\.").join("."); assert.ok(tanpaEsc.includes("backend/src/services/materialProposalService.js") && tanpaEsc.includes("backend/src/services/unitProvisionalUsageService.js") && tanpaEsc.includes(`backend/prisma/migrations/${NAMA_MIG}/migration.sql`));
  assert.ok(!skrip.includes("backend/src/index.js\\|") && !/ALLOWED_RE='[^']*backend\/src\/index\\\.js/.test(skrip), "index.js tidak diizinkan berubah");
});

test("guard rollback: baca-saja (transaksi READ ONLY), menolak bila ada usulan menunggu / pemakaian sementara perlu rekonsiliasi, keadaan tak dikenal = tolak", () => {
  assert.match(guard, /BEGIN READ ONLY/); assert.ok(!/\b(insert into|update [a-z_"]+ set|delete from|drop |truncate|alter table)\b/i.test(guard.replace(/\n#[^\n]*/g, "")), "guard tidak menulis");
  for (const t of ["PERLU_REKONSILIASI", "MENUNGGU_GUDANG", "GUARD DITOLAK", "GUARD LULUS", "exit 2", "exit 1", "exit 0", "hanya ${ADA} dari 2 tabel"]) assert.ok(guard.includes(t), t);
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/rollback-guard-ux-bahan.sh")], { encoding: "utf8" }); if (r.error) return; assert.equal(r.status, 0, r.stderr);
});

test("skrip rilis lolos sintaks bash", () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-ux-bahan.sh")], { encoding: "utf8" }); if (r.error) return; assert.equal(r.status, 0, r.stderr);
});
