// Gerbang skrip rilis "Kelengkapan Order Produksi" (model migrasi, 1 tabel aditif): struktur skrip, allowlist, pin skema, pemindai DDL, gerbang kode live, guard rollback, rehearsal (waktu respons, N+1, bersamaan), tanpa penghapusan. Tidak menjalankan skrip.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-kelengkapan.sh"); const reh = baca("scripts/lib/rehearsal-kelengkapan.mjs"); const smoke = baca("scripts/lib/smoke-kelengkapan.mjs"); const guard = baca("scripts/rollback-guard-kelengkapan.sh");
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;
const allow = script.split("\n").find((l) => l.startsWith("ALLOWED_RE="));
const sql = baca("backend/prisma/migrations/20261231110000_pernyataan_tanpa_bahan/migration.sql");

test("skrip: sintaks valid; MIGRASI ADITIF tunggal; allowlist hanya prisma schema + 1 migrasi rilis; tanpa package/Docker/.env/index.js", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-kelengkapan.sh")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  assert.ok(allow.includes("backend/prisma/migrations/20261231110000_pernyataan_tanpa_bahan/migration\\.sql") && allow.includes("backend/prisma/schema\\.prisma"));
  assert.equal((allow.match(/backend\/prisma\//g) || []).length, 2, "hanya dua berkas prisma");
  for (const t of ["package", "Dockerfile", "docker-compose", ".env", "backend/src/index"]) assert.ok(!allow.includes(t), `allowlist tidak memuat ${t}`);
  for (const f of ["unitMaterialDeclarationService", "productionKelengkapan", "kelengkapanOrderProduksi", "KelengkapanBagian", "KelengkapanFilter", "KelengkapanBaris", "rollback-guard-kelengkapan", "gen-release-kelengkapan"]) assert.ok(allow.includes(f), `allowlist memuat ${f}`);
  assert.ok(!/@@[A-Z_]+@@/.test(script) && !/rehearsal-koreksi|Koreksi Saldo per Bahan|rollback-guard-koreksi/.test(script), "tanpa placeholder dan sisa nama rilis lain");
});

test("PIN SKEMA: sha256 migrasi + sha256 diff schema.prisma + hasil pemindai DDL ditanam; objek rilis dihitung (4 indeks [1 parsial], 1 FK, 4 CHECK, tanpa trigger)", () => {
  assert.match(script, /^MIG_PIN="[0-9a-f]{64}"$/m); assert.match(script, /^SCHEMA_DIFF_SHA="[0-9a-f]{64}"$/m);
  assert.ok(script.includes('SCAN_EXPECT=\'{"total":5,"create_table":1,"index":3,"index_unik":2,"index_parsial":1,"fk":1}\''), "hasil pemindai yang diaudit");
  assert.ok(script.includes('MIG_NAME="20261231110000_pernyataan_tanpa_bahan"') && script.includes('TBL_BARU="unit_material_declarations"'));
  assert.ok(script.includes("ada migrasi baseline yang DIUBAH/DIHAPUS — dilarang") && script.includes("isi migrasi ${MIG_NAME} BERBEDA dari yang diaudit"));
  assert.ok(script.includes("diff schema.prisma BERBEDA dari yang diaudit"), "pin diff schema");
  // migrasi nyata konsisten dengan yang dipin
  assert.equal((sql.match(/CREATE TABLE/g) || []).length, 1); assert.ok(!/\b(DROP|UPDATE|DELETE FROM|INSERT|TRUNCATE|GRANT|TRIGGER|FUNCTION)\b/.test(sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")), "migrasi tanpa DML/DROP/fungsi/trigger");
  assert.ok(/CREATE UNIQUE INDEX "unit_material_declarations_unit_aktif_uq"[^\n]*WHERE "status" = 'ACTIVE'/.test(sql), "satu pernyataan AKTIF per unit dijaga DB");
  assert.ok(sql.includes('ON DELETE RESTRICT'), "FK RESTRICT");
});

test("pemindai DDL: lulus migrasi nyata; semua mutan berbahaya DITOLAK (DROP/UPDATE/ALTER tabel lama/trigger/fungsi/indeks parsial dilonggarkan)", { skip: !punyaBash }, () => {
  const jalan = (teks) => spawnSync(process.execPath, [path.join(repo, "scripts/lib/scan-migrasi-kelengkapan.mjs")], { input: teks, encoding: "utf8" });
  const bersih = (t) => t.split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n") + "\n";
  const ok = jalan(bersih(sql)); assert.equal(ok.status, 0, ok.stderr);
  const harap = ok.stdout.trim();
  const mutan = {
    "DROP TABLE units": 'DROP TABLE "units";', "UPDATE units": "UPDATE \"units\" SET \"status\" = 'RECEIVED';", "INSERT backfill": "INSERT INTO \"unit_material_declarations\" (id) VALUES ('x');",
    "ALTER tabel lama": 'ALTER TABLE "units" ADD COLUMN "x" TEXT;', "trigger": 'CREATE TRIGGER "t" BEFORE UPDATE ON "units" FOR EACH ROW EXECUTE FUNCTION f();', "fungsi": "CREATE FUNCTION \"f\"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;",
    "indeks pada tabel lama": 'CREATE INDEX "x" ON "units"("status");', "GRANT": 'GRANT ALL ON "unit_material_declarations" TO PUBLIC;',
  };
  for (const [nama, tambah] of Object.entries(mutan)) { const r = jalan(bersih(sql + "\n" + tambah + "\n")); assert.ok(r.status !== 0 || r.stdout.trim() !== harap, `mutan lolos: ${nama}`); }
  const longgar = jalan(bersih(sql.replace(/ WHERE "status" = 'ACTIVE'/, ""))); assert.ok(longgar.status !== 0 || longgar.stdout.trim() !== harap, "indeks parsial dilonggarkan harus terdeteksi");
  const tanpaFk = jalan(bersih(sql.split("\n").filter((l) => !l.includes("ADD CONSTRAINT")).join("\n"))); assert.ok(tanpaFk.status !== 0 || tanpaFk.stdout.trim() !== harap, "FK dibuang harus terdeteksi");
  assert.ok(script.includes("uji negatif pemindai") && script.includes("indeks parsial dibuang") && script.includes("indeks parsial dilonggarkan"), "uji negatif ditanam di skrip");
});

test("GERBANG KODE LIVE (isi, bukan marker) di fase audit, tepat sebelum migrasi, dan tepat sebelum switch; deploy lain diperiksa ulang; baseline kode live harus sama", () => {
  assert.ok(script.includes("gerbang_kode_live()"));
  for (const f of ["fase-2-audit", "fase-6-pra-migrasi", "fase-7-tepat-sebelum-switch"]) assert.ok(script.includes(`gerbang_kode_live "${f}"`), f);
  assert.ok(!script.includes('= "$BASE_SHA" ] || die "release aktif (${PREV_COMMIT}) BUKAN baseline'), "marker tidak lagi dipercaya");
  for (const k of ["git hash-object --no-filters --stdin-paths", "KODE LIVE menyimpang dari baseline", "TAMBAHAN:", "container-sha.txt", "PREV_STARTED"]) assert.ok(script.includes(k), k);
  assert.ok(script.includes("tidak_ada_deploy_lain_lagi") && script.includes("/tmp/release-kelengkapan.lock"));
});

test("REHEARSAL: restore backup NYATA; migrasi dengan image baru; WAKTU RESPONS (dingin/hangat/maks) daftar, hitungan, filter gabungan, pagination, ekspor, drawer; deteksi permintaan per unit; baca-saja; skenario tulis + pertentangan + bersamaan", () => {
  assert.ok(script.includes("restore-rehearsal.log") && script.includes("migrate-rehearsal.log") && script.includes("struktur_baru RPSQL gagal_reh"));
  for (const k of ["const ukur = async", "WAKTU ${nama", "operasi DB", "TANPA permintaan per unit", "selisih ≤ 4", "filter GABUNGAN", "ekspor Excel SEMUA unit", "hitungan kelengkapan lingkup Semua", "pagination", "drawer unit"]) assert.ok(reh.includes(k), `rehearsal memuat: ${k}`);
  assert.ok(reh.includes("BACA-SAJA") && reh.includes("beda(fp0, fp1)"), "baca-saja dibuktikan lewat sidik jari");
  for (const k of ["Promise.all", "PERNYATAAN_BERTENTANGAN", "pernyataan & pencatatan BERSAMAAN", "aturan 1:", "aturan 2:", "HITUNG ${nama}", "BELUM_DINILAI"]) assert.ok(reh.includes(k), `rehearsal memuat: ${k}`);
  assert.ok(script.includes('-T "${REH_VOL[@]}"') && script.includes("rehearsal terisolasi"), "data/uploads production tidak dipasang saat rehearsal");
  assert.ok(script.includes("rehearsal_kelengkapan_"), "DB sementara bernama khusus");
});

test("GUARD ROLLBACK: dampak dinilai (hanya penglihatan, bukan data salah) → tidak memblokir tetapi mewajibkan snapshot + peringatan; baca-saja; gagal baca = tolak; image LAMA terbukti bisa start", () => {
  assert.ok(/READ ONLY/.test(guard) && guard.includes("exit 2") && guard.includes("GUARD LULUS DENGAN PERINGATAN") && guard.includes("SNAPSHOT pernyataan aktif") && guard.includes("BERTENTANGAN dengan catatan bahan") && guard.includes("TIDAK TERLIHAT") && guard.includes("TIDAK DAPAT dicabut"));
  assert.ok(!/\b(insert into|update |delete from|drop |truncate )/i.test(guard.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n").replace(/not exists|exists \(select/gi, "")), "guard tidak menulis ke DB");
  assert.ok(script.includes("guard-peringatan.log") && script.includes("guard-kosong.log") && script.includes("rollback-guard-kelengkapan.sh"));
  assert.ok(script.includes('docker run --rm --network "${PROJECT}_default" -e DATABASE_URL="$RH_URL" "$ROLLBACK_TAG" sh -c \'cd /app && npx prisma migrate deploy\''), "image lama diuji start pada DB bermigrasi");
  assert.ok(script.includes("IMAGE LAMA gagal 'prisma migrate deploy'") && script.includes("image lama MENERAPKAN migrasi"));
  assert.ok(script.includes('tag rollback tidak menunjuk image live') && script.includes("baseline e7883bc6"), "rollback ke image live yang memuat baseline");
});

test("TANPA PENGHAPUSAN: fase pembersihan dinonaktifkan; tidak ada rm/docker rmi/prune/volume terhadap release lama, image rollback, backup, volume (selain jejak sementara rehearsal-only)", () => {
  const f9 = script.slice(script.indexOf('PHASE="9-pembersihan"'), script.indexOf('trap - EXIT\nsay "SELESAI'));
  assert.ok(f9.includes("DINONAKTIFKAN") && !/rm -rf|docker rmi|docker volume|docker system|docker builder/.test(f9));
  assert.ok(!/docker (system|builder|volume) (prune|rm)|docker volume prune/.test(script));
  assert.ok(!/rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume)/.test(script.replace('"${NEW_DIR#"$RELEASES"/}" != "${NEW_DIR}"', "")), "tidak menghapus release lama/backup");
});

test("PASCA-SWITCH: hotfix performa tetap ada; hitung baris sebelum/sesudah; smoke baca-saja (401/403, hitungan=daftar, penulisan ditolak sebelum menyentuh data, tabel rilis kosong, tanpa jejak tulis)", () => {
  assert.ok(script.includes("hotfix HILANG: cacheSingkat.js") && script.includes("hitung baris jadwal/Run/stok/pemakaian/harga/jurnal"));
  for (const k of ["tanpa token = 401", "Idempotency-Key = 400", "403", "total filter di daftar = hitungan server", "tabel pernyataan ada dan KOSONG", "tidak ada jejak tulis"]) assert.ok(smoke.includes(k), `smoke memuat: ${k}`);
  assert.ok(!/\.(create|update|delete|upsert)\(|\bINSERT INTO\b|\bUPDATE\b [a-z_"]+ SET/.test(smoke), "smoke tidak menulis langsung");
});
