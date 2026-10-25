// Skrip rilis "Harga Berlaku Bahan": pin migrasi sesuai berkas, pemindai DDL menolak mutan, gerbang berurutan, allowlist tidak memuat jalur Finance yang ditahan, izin eksplisit, guard rollback baca-saja, bash lolos sintaks.
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
const NAMA_MIG = "20261230090000_harga_berlaku_bahan";
const migSql = baca(`backend/prisma/migrations/${NAMA_MIG}/migration.sql`);
const skrip = baca("scripts/release-harga-berlaku.sh");
const guard = baca("scripts/rollback-guard-harga-berlaku.sh");
const bersih = (sql) => sql.split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n") + "\n";
const pindai = (sql) => spawnSync(process.execPath, [path.join(repo, "scripts/lib/scan-migrasi-harga-berlaku.mjs")], { input: bersih(sql), encoding: "utf8" });

test("pin migrasi di skrip rilis = sha256 isi berkas migrasi (LF); nama migrasi cocok; migrasi hanya objek baru (tanpa ALTER tabel lama)", () => {
  const pin = skrip.match(/^MIG_PIN="([0-9a-f]{64})"$/m)?.[1]; const nama = skrip.match(/^MIG_NAME="([^"]+)"$/m)?.[1];
  assert.equal(nama, NAMA_MIG); assert.equal(pin, crypto.createHash("sha256").update(migSql).digest("hex"));
  const stmt = bersih(migSql).split(";").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const alter = stmt.filter((x) => /^ALTER TABLE/.test(x)); assert.ok(alter.length === 7 && alter.every((x) => /ADD CONSTRAINT "[a-z0-9_]+" FOREIGN KEY .* ON DELETE RESTRICT ON UPDATE CASCADE$/.test(x)), "ALTER hanya 7 FK RESTRICT pada tabel baru");
  assert.ok(alter.every((x) => /^ALTER TABLE "(material_harga_berlaku|stock_movement_biaya_operasional|biaya_operasional_penerapan)"/.test(x)), "ALTER hanya pada tabel baru");
});

test("migrasi: CHECK tanpa-mundur, koreksi wajib berdampak, harga > 0, trigger append-only pada kedua tabel riwayat", () => {
  for (const s of ["material_harga_berlaku_tanpa_mundur_chk", "\"jenis\" = 'KOREKSI' OR \"effective_from\" >= \"created_at\"", "material_harga_berlaku_koreksi_dampak_chk", "material_harga_berlaku_harga_chk", "stock_movement_biaya_operasional_basis_chk", "stock_movement_biaya_operasional_satu_beku", "biaya_operasional_penerapan_satu_aktif"]) assert.ok(migSql.includes(s), s);
  assert.match(migSql, /CREATE TRIGGER "material_harga_berlaku_append_only_trg" BEFORE UPDATE OR DELETE ON "material_harga_berlaku"/); assert.match(migSql, /CREATE TRIGGER "stock_movement_biaya_operasional_append_only_trg" BEFORE UPDATE OR DELETE ON "stock_movement_biaya_operasional"/);
});

test("pemindai DDL: migrasi asli lulus dengan hitungan yang dipin; semua mutan ditolak atau berhitungan beda", () => {
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), skrip.match(/^SCAN_EXPECT='([^']+)'$/m)[1]);
  const mutan = {
    "DROP TABLE units": migSql + 'DROP TABLE "units";\n', "UPDATE units": migSql + "UPDATE \"units\" SET \"status\" = 'X';\n", "DELETE": migSql + 'DELETE FROM "units";\n', "INSERT tabel baru": migSql + "INSERT INTO \"material_harga_berlaku\" (id) VALUES ('x');\n",
    "ALTER materials": migSql + 'ALTER TABLE "materials" ADD COLUMN "x" TEXT;\n', "ALTER tabel baru": migSql + 'ALTER TABLE "material_harga_berlaku" ADD COLUMN "x" TEXT;\n', "CREATE TABLE liar": migSql + 'CREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));\n',
    "FK CASCADE": migSql.split("ON DELETE RESTRICT").join("ON DELETE CASCADE"), "FK SET NULL": migSql.split("ON DELETE RESTRICT").join("ON DELETE SET NULL"),
    "trigger dibuang": migSql.split("\n").filter((l) => !l.includes('CREATE TRIGGER "material_harga_berlaku_append_only_trg"')).join("\n"), "fungsi liar": migSql + 'CREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;\n',
    "badan fungsi DROP": migSql.replace("RAISE EXCEPTION", "DROP TABLE units; RAISE EXCEPTION"), "GRANT": migSql + 'GRANT ALL ON "units" TO PUBLIC;\n', "EXTENSION": migSql + 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";\n', "DISABLE TRIGGER": migSql + 'ALTER TABLE "material_harga_berlaku" DISABLE TRIGGER ALL;\n',
    "indeks di tabel lama": migSql + 'CREATE INDEX "x" ON "units"("status");\n', "FK ke tabel lain": migSql + 'ALTER TABLE "material_harga_berlaku" ADD CONSTRAINT "x" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;\n',
    "FK ke units": migSql + 'ALTER TABLE "material_harga_berlaku" ADD CONSTRAINT "x" FOREIGN KEY ("created_by") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;\n',
  };
  for (const [nama, sql] of Object.entries(mutan)) { const r = pindai(sql); assert.ok(r.status !== 0 || r.stdout.trim() !== ok.stdout.trim(), `mutan '${nama}' lolos pemindai`); }
});

test("skrip rilis: gerbang berurutan; --rehearsal-only berhenti sebelum migrasi produksi; allowlist hanya fitur ini (tanpa jalur nilai resmi/PSA yang ditahan)", () => {
  const urut = ['PHASE="1-sumber"', 'PHASE="2-audit-produksi"', 'PHASE="3-backup"', 'PHASE="5-build-image"', 'PHASE="5b-rehearsal"', 'PHASE="6-migrate"', 'PHASE="7-switch"', 'PHASE="8-verifikasi"', 'PHASE="8b-smoke"'].map((x) => skrip.indexOf(x));
  assert.ok(urut.every((x) => x > 0) && urut.every((x, i) => i === 0 || x > urut[i - 1]), `urutan fase: ${urut}`);
  const reh = skrip.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]; then'); assert.ok(reh > urut[4] && reh < urut[5], "rehearsal-only keluar sebelum fase 6 (migrasi produksi)");
  assert.match(skrip, /keadaan_produksi\(\) \{/); assert.match(skrip, /KEADAAN2="\$\(keadaan_produksi "2"\)"/); assert.match(skrip, /struktur_baru RPSQL gagal_reh/); assert.match(skrip, /harus_ditolak "FK CASCADE/);
  assert.match(skrip, /rollback-guard-harga-berlaku\.sh/); assert.ok(!/status-kerja|rjm\.sh|ux-bahan|usulan/i.test(skrip.replace(/\n# \(dibangkitkan[^\n]*\n/, "\n").replace(/scripts\/release-status-kerja-buka-pekerjaan\.sh/g, "")), "tidak ada sisa nama rilis lain");
  const allow = skrip.match(/^ALLOWED_RE='(.*)'$/m)[1].split("\\.").join(".");
  for (const harus of ["backend/src/services/finance/hargaBerlaku.js", "backend/src/routes/hargaBerlaku.js", "backend/src/constants/permissions.js", "backend/src/routes/biayaBahan.js", "backend/src/services/inventoryLedger.js", "backend/prisma/schema.prisma", `backend/prisma/migrations/${NAMA_MIG}/migration.sql`, "frontend/src/features/warehouse/stok/HargaBerlakuPanel.jsx"]) assert.ok(allow.includes(harus), harus);
  for (const dilarang of ["nilaiResmi.js", "penetapanNilai.js", "persediaanAwal.js", "koreksiValuasi.js", "20261229090000_penetapan_nilai_bahan", "services/finance/biayaBahan.js"]) assert.ok(!allow.includes(dilarang), `jalur yang ditahan ikut terbawa: ${dilarang}`);
  assert.ok(!/backend\/prisma\/migrations\/2026122[0-9]/.test(allow), "tidak membawa migrasi lain");
  assert.ok(!allow.includes("backend/src/index.js"), "index.js TIDAK berubah (dipatok tes atribusi); router dipasang lewat routes/biayaBahan.js");
});

test("izin eksplisit di kode: rute ubah/koreksi/ajukan memakai finance:harga_berlaku:edit, setujui/tolak :approve; ADMIN tidak otomatis", () => {
  const rute = baca("backend/src/routes/hargaBerlaku.js"); const izin = baca("backend/src/constants/permissions.js");
  assert.match(rute, /hargaBerlakuRouter\.post\("\/", requirePermission\(P\.FINANCE_HARGA_BERLAKU_EDIT\)/); assert.match(rute, /"\/penerapan", requirePermission\(P\.FINANCE_HARGA_BERLAKU_EDIT\)/);
  assert.match(rute, /"\/penerapan\/:id\/setujui", requirePermission\(P\.FINANCE_HARGA_BERLAKU_APPROVE\)/); assert.ok(!/requirePermission\(P\.FINANCE_POST\)|requirePermission\(P\.FINANCE_APPROVE\)/.test(rute), "tidak memakai izin Finance umum yang juga dipegang semua ADMIN");
  const admin = izin.slice(izin.indexOf("ADMIN_PERMS = ["), izin.indexOf("ADMIN_PERMS = [") + 12000).split("\n]")[0]; assert.ok(!/HARGA_BERLAKU/.test(admin), "ADMIN_PERMS tidak memuat izin harga berlaku");
});

test("guard rollback: baca-saja (transaksi READ ONLY), menolak bila ada penerapan menunggu, keadaan tak dikenal = tolak; bash lolos sintaks", () => {
  assert.match(guard, /BEGIN READ ONLY/); assert.ok(!/\b(insert into|update [a-z_"]+ set|delete from|drop |truncate|alter table)\b/i.test(guard.replace(/\n#[^\n]*/g, "")), "guard tidak menulis");
  for (const t of ["DIAJUKAN", "GUARD DITOLAK", "GUARD LULUS", "exit 2", "exit 1", "exit 0", "hanya ${ADA} dari 3 tabel"]) assert.ok(guard.includes(t), t);
  for (const f of ["scripts/rollback-guard-harga-berlaku.sh", "scripts/release-harga-berlaku.sh"]) { const r = spawnSync("bash", ["-n", path.join(repo, f)], { encoding: "utf8" }); if (r.error) continue; assert.equal(r.status, 0, r.stderr); }
});
