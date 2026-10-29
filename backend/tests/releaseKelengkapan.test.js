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
  assert.equal((sql.match(/CREATE TABLE/g) || []).length, 1); assert.ok(!/\b(DROP|DELETE FROM|INSERT|TRUNCATE|GRANT|TRIGGER|FUNCTION)\b|\bUPDATE "?[a-z_]+"? SET\b/.test(sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")), "migrasi tanpa DML/DROP/fungsi/trigger");
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
  assert.ok(script.includes("tidak_ada_deploy_lain_lagi") && script.includes("release-kelengkapan.lock"));
  assert.ok(!script.includes("\"$lf\" = \"/tmp/release-"), "kunci sendiri TIDAK boleh dilewati berdasarkan nama berkas");
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
  assert.ok(script.includes('tag rollback tidak menunjuk image live') && script.includes("baseline ${BASE_SHA:0:8}"), "rollback ke image live yang memuat baseline");
});

test("TANPA PENGHAPUSAN: fase pembersihan dinonaktifkan; tidak ada rm/docker rmi/prune/volume terhadap release lama, image rollback, backup, volume (selain jejak sementara rehearsal-only)", () => {
  const f9 = script.slice(script.indexOf('PHASE="9-pembersihan"'), script.indexOf('trap - EXIT\nsay "SELESAI'));
  assert.ok(f9.includes("DINONAKTIFKAN") && !/rm -rf|docker rmi|docker volume|docker system|docker builder/.test(f9));
  assert.ok(!/docker (system|builder|volume) (prune|rm)|docker volume prune/.test(script));
  assert.ok(!/rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume)/.test(script.replace('"${NEW_DIR#"$RELEASES"/}" != "${NEW_DIR}"', "")), "tidak menghapus release lama/backup");
});

test("PASCA-SWITCH: hotfix performa tetap ada; hitung baris sebelum/sesudah; smoke baca-saja (401/403, hitungan=daftar, penulisan ditolak sebelum menyentuh data, isi tabel rilis dibaca aktual dan tidak berubah, tanpa jejak tulis)", () => {
  assert.ok(script.includes("hotfix HILANG: cacheSingkat.js") && script.includes("hitung baris jadwal/Run/stok/pemakaian/harga/jurnal"));
  for (const k of ["tanpa token = 401", "Idempotency-Key = 400", "403", "total filter di daftar = hitungan server", "SMOKE_DECL_N", "tidak ada jejak tulis"]) assert.ok(smoke.includes(k), `smoke memuat: ${k}`);
  assert.ok(!/\.(create|update|delete|upsert)\(|\bINSERT INTO\b|\bUPDATE\b [a-z_"]+ SET/.test(smoke), "smoke tidak menulis langsung");
});

// ── PENGUNCIAN DEPLOY (berbasis kepemilikan proses), keadaan LANJUT dengan isi tabel aktual, urutan pra-switch ──
const fungsi = (nama) => {
  const L = script.split("\n"); const i = L.findIndex((l) => l.startsWith(`${nama}() {`)); assert.ok(i >= 0, `fungsi ${nama} ada di skrip`);
  if (L[i].trimEnd().endsWith("}") && L[i].length > nama.length + 5) return L[i];
  let j = i; while (j < L.length && L[j] !== "}") j++; assert.ok(j < L.length, `akhir fungsi ${nama}`);
  return L.slice(i, j + 1).join("\n");
};
const bashJalan = (kode, env = {}) => spawnSync("bash", ["-c", kode], { encoding: "utf8", env: { ...process.env, ...env } });

test("PENGUNCIAN: kunci bersama + kunci sendiri diambil ATOMIK sebelum memeriksa yang lain; kepemilikan dari proses (perangkat:inode fd 7/9), bukan nama; diperiksa di fase 0, sebelum migrasi, dan tepat sebelum switch", () => {
  const f0 = script.indexOf("kunci_ambil   #"); const cek0 = script.indexOf("kunci_cek_lain || die \"deploy lain sedang berjalan", f0);
  assert.ok(f0 > 0 && cek0 > f0, "kunci diambil SEBELUM kunci lain diperiksa (fase 0)");
  assert.ok(script.includes("release-deploy-bersama.lock") && script.includes("exec 7>>") && script.includes("exec 9>>") && script.includes("/proc/$$/fd/$fd") && script.includes("stat -Lc '%d:%i'"), "kepemilikan = identitas berkas yang dibuka proses ini");
  assert.ok(script.includes("exec 8<\"$lf\"; flock -n 8"), "probe kunci lain membuka read-only (tidak memotong isi)");
  const fn = fungsi("tidak_ada_deploy_lain_lagi"); assert.ok(fn.includes("kunci_milik_sendiri") && fn.includes("kunci_cek_lain") && fn.includes("proses_lain"), "pemeriksaan ulang memakai kepemilikan");
  const p6 = script.indexOf('gerbang_kode_live "fase-6-pra-migrasi"'); const mig = script.indexOf("migrate deploy GAGAL", p6);
  assert.ok(script.slice(p6, mig).includes("tidak_ada_deploy_lain_lagi"), "dicek ulang sebelum migrasi");
  const p7 = script.indexOf('PHASE="7-switch"'); const up = script.indexOf('up -d --no-deps backend', p7);
  const antara = script.slice(p7, up);
  assert.ok(antara.indexOf("tidak_ada_deploy_lain_lagi") > 0 && antara.indexOf("tidak_ada_deploy_lain_lagi") < antara.indexOf('gerbang_kode_live "fase-7-tepat-sebelum-switch"'), "kunci lalu gerbang kode live tepat sebelum switch");
  assert.ok(antara.includes("kandidat berubah sebelum switch") && antara.includes("isi tabel pernyataan BERUBAH sejak preflight"), "kandidat dan isi tabel diperiksa tepat sebelum switch");
});

test("REHEARSAL menguji logika pra-switch yang sebelumnya gagal: uji kunci terisolasi + uji negatif baseline bergeser + gerbang fase 7 pada production nyata, SEBELUM berhenti/rehearsal-only", () => {
  const u = script.indexOf('PHASE="5c-uji-pra-switch"'); const stop = script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]; then', u);
  assert.ok(u > 0 && stop > u, "uji pra-switch sebelum berhenti pada rehearsal-only");
  const blok = script.slice(u, stop);
  for (const k of ["uji_gerbang_kunci", "uji_baseline_bergeser", "tidak_ada_deploy_lain_lagi", 'gerbang_kode_live "rehearsal-pra-switch"']) assert.ok(blok.includes(k), k);
  for (const k of ["baseline-bergeser", "container-dimulai-ulang", "image-berganti", "BUKAN baseline/leluhur baseline", "dimulai ulang sejak audit awal", "image container berubah sejak audit awal"]) assert.ok(script.includes(k), k);
});

test("KEADAAN LANJUT: migrasi sudah terpasang (checksum+status+struktur) diterima walau tabel BERISI; isi dibaca aktual, tidak diasumsikan kosong; SEGAR/LANJUT lain ditolak (fail-closed)", { skip: !punyaBash }, () => {
  const kode = `MIG_NAME=20261231110000_x\n${fungsi("tentukan_keadaan")}\n`;
  const t = (...a) => { const r = bashJalan(`${kode}\ntentukan_keadaan "$@"`.replace('"$@"', a.map((x) => `'${x}'`).join(" "))); return { out: r.stdout.trim(), rc: r.status }; };
  assert.deepEqual(t(0, 0, 0, 0, "20261231110000_x"), { out: "SEGAR", rc: 0 });
  assert.deepEqual(t(1, 0, 1, 1, ""), { out: "LANJUT", rc: 0 }, "LANJUT dengan tabel kosong");
  assert.deepEqual(t(1, 7, 1, 1, ""), { out: "LANJUT", rc: 0 }, "LANJUT dengan tabel berisi (pernyataan pengguna sah) TIDAK ditolak");
  assert.match(t(1, 0, 1, 0, "").out, /^TOLAK: status\/checksum/, "checksum/status tidak sesuai");
  assert.match(t(1, 0, 1, 1, "20261231120000_lain").out, /^TOLAK: masih ada migrasi pending/);
  assert.match(t(1, "abc", 1, 1, "").out, /^TOLAK: isi tabel rilis tidak terbaca/, "isi tabel tak terbaca = tolak");
  assert.match(t(1, 0, 0, 0, "").out, /^TOLAK: keadaan campuran/, "tabel ada tetapi migrasi tidak tercatat = campuran");
  assert.match(t(0, 0, 1, 1, "").out, /^TOLAK: keadaan campuran/, "migrasi tercatat tetapi tabel tidak ada = campuran");
  assert.match(t(0, 0, 0, 0, "20261231110000_x\n20261231120000_y").out, /^TOLAK: migrasi pending bukan tepat/);
  assert.ok(!script.includes("tabel rilis TIDAK kosong (${nisi} baris)"), "tidak ada lagi penolakan karena tabel berisi pada LANJUT");
});

test("ISI TABEL: pembaca isi_n/isi_aktif/isi_fp/isi_ids mem-parse keluaran isi_tabel_rilis; ABSEN = 0; penyimpangan sesudah switch (baris hilang/berubah) dihentikan", { skip: !punyaBash }, () => {
  const kode = ["isi_n", "isi_aktif", "isi_fp", "isi_ids"].map(fungsi).join("\n");
  const j = (k) => bashJalan(`${kode}\n${k}`).stdout.trim();
  assert.equal(j('isi_n "3|2|abcd1234|id1,id2,id3"'), "3"); assert.equal(j('isi_aktif "3|2|abcd1234|id1,id2,id3"'), "2");
  assert.equal(j('isi_fp "3|2|abcd1234|id1,id2,id3"'), "abcd1234"); assert.equal(j('isi_ids "3|2|abcd1234|id1,id2,id3"'), "id1,id2,id3");
  assert.equal(j('isi_n ABSEN'), "0"); assert.equal(j('isi_aktif ABSEN'), "0"); assert.equal(j('isi_fp ABSEN'), "-"); assert.equal(j('isi_ids "0|0|-|"'), "");
  for (const k of ["baris pernyataan yang ada sebelum switch HILANG sesudah switch", "jumlah baris pernyataan BERKURANG sesudah switch", "isi tabel pernyataan BERUBAH oleh switch", "isi tabel pernyataan BERUBAH pada tahap LANJUT"]) assert.ok(script.includes(k), k);
  assert.ok(script.includes('[ "$ISI_REH" = "$ISI_PRA" ]'), "restore rehearsal harus sama persis dengan isi production saat preflight (LANJUT)");
  assert.ok(script.includes('SMOKE_DECL_N="$(isi_n "$ISI_SEBELUM_SWITCH")"') && script.includes("-e SMOKE_DECL_IDS=") && script.includes('-e REH_DECL_AWAL='), "isi tabel diteruskan ke smoke dan rehearsal");
});

test("UJI KUNCI: tidak ada 'wait' tanpa argumen (macet karena proses latar tee di skrip rilis)", () => {
  const blokUji = script.slice(script.indexOf("uji_gerbang_kunci() {"), script.indexOf("uji_baseline_bergeser() {"));
  assert.ok(blokUji.length > 500);
  const kode = blokUji.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.ok(!/\bwait\s*(;|\|\||&&|$)/m.test(kode), "wait tanpa argumen");
  assert.ok(blokUji.includes('wait "${PIDS[@]}"'));
});

test("UJI KUNCI TERISOLASI (Linux): kunci sendiri diterima, kunci lain/bernama-sama ditolak, dua proses tidak memasuki bagian kritis bersamaan — memuat blok yang SAMA dari skrip rilis", { skip: !(punyaBash && process.platform === "linux" && spawnSync("bash", ["-c", "command -v flock && command -v pgrep && command -v setsid"]).status === 0) }, () => {
  const r = spawnSync("bash", [path.join(repo, "scripts/lib/uji-kunci-kelengkapan.sh"), path.join(repo, "scripts/release-kelengkapan.sh")], { encoding: "utf8", timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /SEMUA UJI KUNCI LULUS/);
});
