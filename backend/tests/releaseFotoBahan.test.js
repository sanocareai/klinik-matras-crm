// Skrip rilis "Foto Bahan": gerbang, pin migrasi, batas allowlist, isolasi rehearsal dari data production, gerbang disk 5 GiB, instruksi rollback/pemulihan, dan kestabilan generator.
// Tes statis (tanpa database/VPS): membaca skrip hasil bangkitan + pustaka yang disematkan, dan menjalankan generator --check.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");
const BASE = "60b5df1041db63197d070fbf56b2da1ca5ce42b4"; // baseline live saat paket ini dibuat (harga otomatis dari PO)
const script = baca("scripts/release-foto-bahan.sh");
const MIG = "backend/prisma/migrations/20261231120000_foto_bahan/migration.sql";
const gitAda = () => spawnSync("git", ["cat-file", "-e", `${BASE}^{commit}`], { cwd: repo }).status === 0;
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const nilai = (nama) => (script.match(new RegExp(`^${nama}=(.+)$`, "m")) || [])[1]?.replace(/^["']|["']$/g, "");

test("skrip: sintaks bash valid, LF, tanpa placeholder, nama rilis lama tidak tersisa", () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-foto-bahan.sh")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.readFileSync(path.join(repo, "scripts/release-foto-bahan.sh"), "utf8").includes("\r"), "skrip harus LF");
  assert.ok(!/@@[A-Z_]+@@/.test(script), "tanpa placeholder");
  const sisa = script.split("\n").filter((l) => !l.startsWith("#") && /harga-dari-po|\bhpo\b|HARGA_DARI_PO|pratinjau-harga|release-penjadwalan/i.test(l));
  assert.deepEqual(sisa, [], "nama rilis lain tidak boleh tersisa di kode");
  assert.match(script, /release-foto-bahan\.lock/); assert.match(script, /rollback-pre-fb-/); assert.match(script, /rehearsal_fb_/);
});

test("allowlist: tepat migrasi + schema di prisma; index.js, dependensi, Docker/compose, .env, dist, backend/data TIDAK ikut; hanya 4 berkas backend/src", () => {
  const m = script.match(/^ALLOWED_RE='\^\((.+)\)\$'$/m); assert.ok(m, "ALLOWED_RE ada");
  const allow = m[1].replace(/\\\./g, ".").split("|");
  assert.ok(allow.includes("backend/prisma/schema.prisma") && allow.includes(MIG), "schema + migrasi rilis");
  assert.equal(allow.filter((f) => f.startsWith("backend/prisma/")).length, 2, "tidak ada berkas prisma lain");
  for (const terlarang of ["backend/src/index.js", "package.json", "package-lock.json", "Dockerfile", "docker-compose", ".env", "frontend/dist", "backend/data/", "backend/uploads/"]) assert.ok(!allow.some((f) => f.includes(terlarang)), `allowlist tidak boleh memuat ${terlarang}`);
  assert.deepEqual(script.match(/^BACKEND_SRC_EXPECT="(.+)"$/m)[1].split(" "), ["backend/src/routes/inventory.js", "backend/src/routes/materialPhotoMedia.js", "backend/src/services/fotoBahan.js", "backend/src/services/stokLokasi.js"]);
  assert.ok(!/analytics\.js|conversations\.js|cacheSingkat|Laporan\.jsx/.test(script.match(/^BACKEND_SRC_EXPECT=.*$/m)[0] + script.match(/^FRONTEND_SRC_EXPECT=.*$/m)[0]), "hotfix performa tidak disentuh");
  assert.match(script, /backend\/src\/index\.js' \|\| die "backend\/src\/index\.js berubah/, "gerbang: index.js tidak boleh berubah");
});

test("pin migrasi: sha256, hasil pemindai DDL, dan diff schema.prisma cocok dengan berkas di repo; batas tunggu kunci dan kolom tanpa default", { skip: gitAda() ? false : `commit ${BASE} tidak ada di klon ini` }, () => {
  const sql = baca(MIG);
  assert.equal(nilai("MIG_PIN"), sha(sql), "MIG_PIN = sha256 isi migrasi (LF)");
  assert.equal(nilai("MIG_NAME"), "20261231120000_foto_bahan");
  const bersih = sql.split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n") + "\n";
  const scan = execFileSync(process.execPath, [path.join(repo, "scripts/lib/scan-migrasi-foto-bahan.mjs")], { input: bersih, encoding: "utf8" }).trim();
  assert.equal(script.match(/^SCAN_EXPECT='(.+)'$/m)[1], scan); assert.deepEqual(JSON.parse(scan), { set_local_lock_timeout: 1, set_local_statement_timeout: 1, add_column: 2 });
  const diff = execFileSync("git", ["diff", "-U0", "--no-color", BASE, "HEAD", "--", "backend/prisma/schema.prisma"], { cwd: repo, encoding: "utf8" }).split("\n").filter((l) => !l.startsWith("index ")).map((l) => l.replace(/^@@ [^@]*@@.*$/, "@@")).join("\n");
  assert.equal(nilai("SCHEMA_DIFF_SHA"), sha(diff + "\n"), "SCHEMA_DIFF_SHA = diff schema.prisma yang diaudit");
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/); assert.match(sql, /SET LOCAL statement_timeout = '30s';/);
  assert.match(sql, /kunci ACCESS EXCLUSIVE/, "wording migrasi: ADD COLUMN tetap memerlukan kunci");
  assert.ok(!/metadata-only|tanpa kunci|tidak mengunci/i.test(sql), "tidak boleh mengklaim tanpa kunci");
  assert.ok(!/\b(DEFAULT|NOT NULL|UPDATE|INSERT|DELETE|CREATE INDEX)\b/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "kolom nullable tanpa default, tanpa backfill/indeks");
});

test("pemindai DDL: menolak mutan (batas waktu longgar/dibuang, DEFAULT, tabel lain, DML/DDL tambahan, urutan terbalik)", () => {
  const scan = (t) => spawnSync(process.execPath, [path.join(repo, "scripts/lib/scan-migrasi-foto-bahan.mjs")], { input: t, encoding: "utf8" }).status;
  const asli = baca(MIG).split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n") + "\n";
  assert.equal(scan(asli), 0);
  for (const mutan of [asli.replace("'5s'", "'60s'"), asli.replace(/.*lock_timeout.*\n/, ""), asli.replace("SET LOCAL lock", "SET lock"), asli.replace("VARCHAR(80)", "VARCHAR(80) DEFAULT ''"), asli.replace("VARCHAR(80)", "VARCHAR(80) NOT NULL"), asli.replace(/"materials"/g, '"units"'), asli + "UPDATE materials SET photo_file = 'x';\n", asli + 'DROP TABLE "units";\n', asli + 'CREATE INDEX i ON "materials"("photo_file");\n', asli.split("\n").reverse().join("\n")]) assert.notEqual(scan(mutan), 0);
});

test("isolasi rehearsal: direktori data production TIDAK dipasang; uji tulis foto hanya pada DB salinan + folder sementara; kontrol negatif tanpa volume", () => {
  assert.match(script, /REH_VOL=\(-v "\$BK_DIR\/reh-data:\/app\/data"/, "rehearsal memakai direktori data sementara");
  assert.match(script, /rehearsal TIDAK terisolasi dari direktori data/, "bukti isolasi (direktori kosong) tetap ada");
  for (const l of script.split("\n").filter((x) => x.includes("uji-foto-bahan-persisten.mjs") && !x.startsWith("#"))) assert.ok(/REH_VOL|REH_DBURL/.test(l), `skrip bukti persistensi harus terikat ke DB/volume rehearsal: ${l.slice(0, 120)}`);
  assert.ok(!/\$\{?PERSIST\}?\/backend\/data:\/app\/data/.test(script.replace(/^#.*$/gm, "")), "tidak ada mount direktori data production di perintah skrip");
  assert.match(script, /docker run --rm --network "\$REH_NET" -e DATABASE_URL="\$REH_DBURL" "\$NEW_IMG_ID" node scripts\/uji-foto-bahan-persisten\.mjs baca/, "kontrol negatif tanpa volume (docker run polos)");
  assert.match(script, /bukti persistensi: kontainer BARU \(recreate\) tidak dapat membaca foto dari volume yang sama/);
  const guard = baca("backend/scripts/uji-foto-bahan-persisten.mjs"); assert.match(guard, /test\|rehearsal/); assert.match(guard, /UJI-FOTO-PERSISTEN-/);
  const reh = baca("scripts/lib/rehearsal-foto-bahan.mjs"); assert.match(reh, /\^rehearsal_/, "uji aplikasi hanya pada DB rehearsal"); assert.match(reh, /folder foto memakai direktori data SEMENTARA/);
});

test("production: tidak ada unggahan/foto contoh/perubahan bahan oleh skrip; smoke baca-saja menolak sebelum menyentuh data", () => {
  const smoke = baca("scripts/lib/smoke-foto-bahan.mjs");
  const put = smoke.split("\n").filter((l) => /method: "(PUT|DELETE|POST)"/.test(l));
  for (const l of put) assert.ok(!/Authorization: "Bearer " \+ tR/.test(l), `smoke tidak boleh menulis dengan token pembaca: ${l.slice(0, 100)}`);
  assert.ok(!/FormData|uploadFile|sharp/.test(smoke), "smoke tidak mengunggah/membuat gambar");
  assert.match(smoke, /TIDAK ada jejak tulis akibat smoke/); assert.match(smoke, /unggah\/hapus\/putar TANPA token = 401/);
  assert.ok(!/prisma\.material\.(create|update|delete)/.test(smoke), "smoke tidak mengubah bahan");
  const rekon = baca("backend/scripts/rekonsiliasi-foto-bahan.mjs"); assert.ok(!/unlink|rmSync|\.delete|\.update|DELETE|UPDATE|writeFile/.test(rekon.replace(/\/\/.*$/gm, "")), "rekonsiliasi baca-saja");
  assert.ok(!/docker (system|builder|image|volume|container) prune|docker rmi .*-f/.test(script), "tidak ada prune/penghapusan image paksa");
  const rmRf = script.split("\n").filter((l) => !l.startsWith("#") && /rm -rf/.test(l));
  assert.ok(rmRf.every((l) => /\/bk\/reh-data \/bk\/reh-uploads \/bk\/reh-dd|"\$NEW_DIR"|"\$T"/.test(l)), `rm -rf hanya untuk direktori sementara rehearsal / release dir yang dibuat skrip: ${rmRf.join(" | ").slice(0, 300)}`);
});

test("disk: gerbang 5 GiB tidak diturunkan dan diperiksa di awal, setelah build, setelah rehearsal, sebelum migrasi, sebelum switch; kebutuhan menetap/puncak dihitung", () => {
  assert.match(script, /^MIN_FREE_KB=\$\(\(5 \* 1024 \* 1024\)\)$/m);
  for (const t of ["awal", "setelah build image", "setelah rehearsal", "sebelum migrasi", "sebelum switch"]) assert.ok(script.includes(`cek_disk "${t}"`), `cek_disk ${t}`);
  assert.match(script, /NEED_KB=\$\(\( NEED_PASCA_KB > NEED_PUNCAK_KB \? NEED_PASCA_KB : NEED_PUNCAK_KB \)\)/); assert.match(script, /NEED_PASCA_KB=\$\(\( MIN_FREE_KB \+ PERM_KB \)\)/);
  assert.match(script, /skrip ini TIDAK membersihkan apa pun/);
  assert.ok(!/MIN_FREE_KB=\$\(\(([0-4]) \*/.test(script), "tidak ada ambang di bawah 5 GiB");
});

test("migrasi production: setelah rehearsal, sebelum switch, backend lama melayani; keadaan SEGAR/LANJUT; gagal kunci = berhenti dengan panduan pemulihan", () => {
  const iReh = script.indexOf('PHASE="5b-rehearsal"'), iMig = script.indexOf('PHASE="6-migrate"'), iSw = script.indexOf('PHASE="7-switch"'); assert.ok(iReh > 0 && iMig > iReh && iSw > iMig);
  assert.match(script, /dcp "\$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy/);
  assert.ok(!script.slice(0, iMig).split("\n").some((l) => /backend npx prisma migrate deploy/.test(l) && !/REH_DB|reh-lock|rehearsal/.test(l) && !l.startsWith("#") && !/DATABASE_URL=/.test(l) && !/^\s*#/.test(l) && !/docker run|rollback_instructions|cat <<|Rollback|\$\{/.test(l)), "tidak ada migrate deploy ke production sebelum fase 6");
  assert.match(script, /55P03\/lock timeout: database sibuk, tidak ada kolom terpasang/); assert.match(script, /prisma migrate resolve --rolled-back/);
  assert.match(script, /uji batas tunggu kunci|BATAS TUNGGU KUNCI/i); assert.match(script, /pemulihan resmi \(resolve --rolled-back lalu deploy\) teruji/);
  assert.match(script, /keadaan production: \$\{KEADAAN\}/); assert.match(script, /tentukan_keadaan\(\)/);
});

test("rollback/pemulihan: kode, skema, nasib file foto, backup file bersama database, rekonsiliasi; kompatibilitas kode lama diuji di rehearsal", () => {
  for (const frasa of ["Rollback KODE setelah switch", "KOMPATIBILITAS SKEMA", "TIDAK ada migrasi mundur", "NASIB FILE FOTO", "TETAP di ${PERSIST}/backend/data/material-photos", "BACKUP & PEMULIHAN FILE", "hanya memuat DUMP DATABASE", "rekonsiliasi-foto-bahan.mjs", "migrate resolve --rolled-back ${MIG_NAME}", "JANGAN menghapus folder itu"]) assert.ok(script.includes(frasa), `instruksi rollback memuat: ${frasa}`);
  assert.match(script, /kompatibilitas: image LAMA gagal menjalankan migrate deploy pada skema baru/); assert.match(script, /No pending migrations/);
  const kompat = baca("scripts/lib/kompat-lama-foto-bahan.mjs"); assert.match(kompat, /kode lama: Stok & Lokasi \(stokLokasi\)/); assert.match(kompat, /_test\$/);
  assert.match(script, /persistensi file: \/app\/data container live = bind-mount/); assert.match(script, /bind:\$\{PERSIST\}\/backend\/data:true/);
});

test("generator stabil: skrip tersimpan identik dengan hasil bangkitan ulang dari commit ini", { skip: gitAda() ? false : `commit ${BASE} tidak ada di klon ini` }, () => {
  const r = spawnSync(process.execPath, [path.join(repo, "scripts/gen-release-foto-bahan.cjs"), "--base", BASE, "--check"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /SAMA:/);
});
