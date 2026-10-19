// Tes generator + skrip rilis Order Produksi adopsi Admin — TANPA menyentuh produksi dan tanpa jaringan. Mengunci: pin migrasi, hasil pemindai DDL (+ mutan negatif), konsistensi hitungan uji perilaku dengan templat,
// gerbang migrasi (tepat 1 pending, himpunan terpasang ⊆ kandidat), rehearsal sebelum migrate, migrate sebelum switch, smoke baca-saja, bukti rehearsal-penuh sebagai syarat rilis, tes integrasi di Postgres sekali-pakai tanpa volume
// production, dan rollback guard yang tidak menghapus riwayat adopsi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { bangkitkan, TES_N_EXPECT } = require(path.join(root, "scripts/gen-release-order-produksi-adopsi.cjs"));
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(root, rel), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const migName = fs.readdirSync(path.join(root, "backend/prisma/migrations")).find((n) => n.endsWith("_production_adopsi_admin"));
const migRel = `backend/prisma/migrations/${migName}/migration.sql`;
const migSql = baca(migRel);
const sha = (t) => createHash("sha256").update(t).digest("hex");
const bersih = (sql) => lf(sql).split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n");
const pindai = (sql) => spawnSync(process.execPath, ["scripts/lib/scan-migrasi-order-produksi-adopsi.mjs"], { cwd: root, input: bersih(sql), encoding: "utf8" });
const tpl = baca("scripts/templates/release-order-produksi-adopsi.sh.tpl");
const TES = ["tests/integration/productionAdopsi.integration.test.js", "tests/integration/unitV1Actions.integration.test.js"];
const masukan = (o = {}) => ({
  tplSrc: tpl, berkasList: ["backend/prisma/schema.prisma", migRel, "backend/src/routes/productionAdopsi.js", "frontend/src/features/production/OrderProduksiPanel.jsx"], migName, migSql,
  schemaDiffSha: "a".repeat(64), scanJs: baca("scripts/lib/scan-migrasi-order-produksi-adopsi.mjs"), scanExpect: '{"total":12}', liveMigTerakhir: "20261220090000_gudang_koreksi_dokumen",
  liveAncestors: ["1".repeat(40), "2".repeat(40)], rehNode: baca("scripts/lib/rehearsal-kode-order-produksi-adopsi.mjs"), smokeNode: baca("scripts/lib/smoke-order-produksi-adopsi.mjs"), tesFiles: TES, ...o,
});
const { script, ringkasan } = bangkitkan(masukan());

test("migrasi: tepat satu nama migrasi adopsi Admin; terurut SETELAH migrasi live terakhir (Koreksi Gudang)", () => {
  assert.equal(migName, "20261221090000_production_adopsi_admin");
  assert.ok(migName > "20261220090000_gudang_koreksi_dokumen", "harus sesudah migrasi live terakhir");
  assert.equal(fs.readdirSync(path.join(root, "backend/prisma/migrations")).filter((n) => n.endsWith("_production_adopsi_admin")).length, 1);
});

test("migrasi aditif: hanya CREATE tabel/indeks/FK/fungsi/trigger BARU; tanpa ALTER tabel lama, UPDATE, DELETE, INSERT, DROP", () => {
  const b = bersih(migSql).replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
  assert.doesNotMatch(b, /\b(DROP|DELETE\s+FROM|INSERT\s+INTO|TRUNCATE|UPDATE\s+"|RENAME|ALTER\s+COLUMN|ADD\s+COLUMN|GRANT|REVOKE)\b/i);
  const alter = [...b.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(alter.length === 3 && alter.every((t) => t.startsWith("production_unit_")), `ALTER hanya pada tabel baru: ${alter}`);
  assert.equal((b.match(/ON DELETE RESTRICT/g) ?? []).length, 3); assert.doesNotMatch(b, /ON DELETE CASCADE|SET NULL/);
});

test("generator: pin sha256 isi migrasi (LF) tertanam; hasil bangkit deterministik; daftar tes + jumlah tes tertanam", () => {
  assert.ok(script.includes(`MIGS="${migName}:${sha(migSql)}"`));
  assert.equal(ringkasan.migSha, sha(migSql));
  assert.equal(bangkitkan(masukan()).script, script, "bangkit ulang dengan masukan sama = identik");
  assert.ok(!/@@[A-Z_]+@@/.test(script.replace(/s\/\^@@ \[\^@\]\*@@\.\*\$\/@@\//g, "")), "tidak ada placeholder tersisa");
  assert.ok(script.includes(`TES_FILES="${TES.join(" ")}"`) && script.includes(`TES_N_EXPECT="${TES_N_EXPECT}"`));
});

test("generator: menolak masukan tidak aman (prisma lain, dependensi, berkas pelindung, tanpa migrasi, tanpa daftar tes)", () => {
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, "backend/prisma/migrations/20261230000000_liar/migration.sql"] })), /prisma lain/);
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, "backend/package.json"] })), /dependensi/);
  for (const f of ["backend/src/services/statusUnitLintasWorkspace.js", "backend/src/services/inventoryLedger.js", "backend/src/constants/permissions.js", "backend/src/services/finance/journal.js", "backend/src/services/productionStepCommandService.js"]) {
    assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, f] })), /pelindung/, f);
  }
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/src/routes/productionAdopsi.js"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ migName: "bukan-migrasi" })), /nama migrasi/);
  assert.throws(() => bangkitkan(masukan({ tesFiles: [] })), /tes integrasi/);
});

test("allowlist: memuat migrasi + schema + berkas adopsi; menolak dist, Finance, ledger, fungsi status lintas workspace, Delivery, Gudang", () => {
  const re = new RegExp(script.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  for (const f of [migRel, "backend/prisma/schema.prisma", "backend/src/routes/productionAdopsi.js", "frontend/src/features/production/OrderProduksiPanel.jsx", "scripts/release-order-produksi-adopsi.sh", "scripts/rollback-guard-order-produksi-adopsi.sh", "scripts/lib/rehearsal-skenario-order-produksi-adopsi.mjs"]) assert.ok(re.test(f), f);
  for (const f of ["frontend/dist/index.html", "backend/src/services/finance/journal.js", "backend/src/services/inventoryLedger.js", "backend/src/services/statusUnitLintasWorkspace.js", "backend/src/services/productionStepCommandService.js", "backend/src/routes/delivery.js", "backend/src/routes/goodsReceipt.js", "backend/package.json", "driver-mobile/app.json"]) assert.ok(!re.test(f), `${f} tidak boleh lolos allowlist`);
});

test("pemindai DDL: migrasi nyata lolos dengan hitungan yang tertanam; semua mutan ditolak atau menyimpang", () => {
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { total: 12, create_table: 3, index: 3, fk: 3, fungsi: 1, trigger: 2 });
  const mutan = {
    "DROP": `${migSql}\nDROP TABLE "units";`, "UPDATE": `${migSql}\nUPDATE "units" SET "status" = 'RECEIVED';`, "DELETE": `${migSql}\nDELETE FROM "units";`, "INSERT": `${migSql}\nINSERT INTO "production_unit_work_progress" (id) VALUES ('x');`,
    "TRUNCATE": `${migSql}\nTRUNCATE "units";`, "kolom pada tabel lama": `${migSql}\nALTER TABLE "units" ADD COLUMN "x" TEXT;`, "ALTER COLUMN": `${migSql}\nALTER TABLE "units" ALTER COLUMN "status" TYPE TEXT;`,
    "RENAME": `${migSql}\nALTER TABLE "units" RENAME COLUMN "status" TO "s";`, "GRANT": `${migSql}\nGRANT ALL ON "production_unit_work_progress" TO PUBLIC;`, "REVOKE": `${migSql}\nREVOKE ALL ON "units" FROM PUBLIC;`,
    "FK CASCADE progress": migSql.replace('REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;\n\nCREATE TABLE "production_unit_material_plans"', 'REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;\n\nCREATE TABLE "production_unit_material_plans"'),
    "FK SET NULL revisi": migSql.replace('REFERENCES "production_unit_material_plans"("id") ON DELETE RESTRICT', 'REFERENCES "production_unit_material_plans"("id") ON DELETE SET NULL'),
    "tabel liar": `${migSql}\nCREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));`, "indeks pada tabel lama": `${migSql}\nCREATE INDEX "x_idx" ON "units"("status");`,
    "trigger pada tabel lama": `${migSql}\nCREATE TRIGGER trg_evil BEFORE DELETE ON "units" FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();`, "blok DO liar": `${migSql}\nDO $$ BEGIN DELETE FROM "units"; END $$;`,
    "pernyataan ganda": `${migSql}\nCREATE INDEX "production_unit_work_progress_unit_id_created_at_idx" ON "production_unit_work_progress"("unit_id", "created_at");`, "CREATE EXTENSION": `${migSql}\nCREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
    "CHECK status dibuang": migSql.split("\n").filter((l) => !l.includes("production_unit_work_progress_status_chk")).join("\n"), "CHECK status dilonggarkan": migSql.replace("'TERTUNDA','SELESAI'", "'TERTUNDA','SELESAI','LIAR'"),
    "CHECK lines dibuang": migSql.split("\n").filter((l) => !l.includes("production_unit_material_plans_lines_array_chk")).join("\n"), "trigger dibuang": migSql.split("\n").filter((l) => !l.includes("production_unit_work_progress_append_only_trg")).join("\n"),
    "fungsi diubah": migSql.replace("RAISE EXCEPTION", "RAISE NOTICE"), "DISABLE TRIGGER": `${migSql}\nALTER TABLE "production_unit_work_progress" DISABLE TRIGGER ALL;`, "DROP CONSTRAINT": `${migSql}\nALTER TABLE "units" DROP CONSTRAINT "units_pkey";`,
  };
  for (const [nama, sql] of Object.entries(mutan)) { const r = pindai(sql); assert.ok(r.status !== 0 || r.stdout.trim() !== ok.stdout.trim(), `mutan '${nama}' LOLOS pemindai`); }
  assert.ok(Object.keys(mutan).length >= 24);
  assert.ok((script.match(/^harus_ditolak "/gm) ?? []).length >= 36, "skrip memuat ≥ 36 mutan negatif");
});

test("skrip rilis: gerbang sumber — ancestry live, pin migrasi, pin diff schema, tepat 1 pending, terpasang ⊆ kandidat, berkas pelindung, tanpa hotfix Stock Count", () => {
  for (const s of ['sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA"', 'sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA"', 'for A in $LIVE_ANCESTORS', 'die "isi migrasi ${n} BERBEDA dari yang diaudit',
    "SCHEMA_DIFF_SHA", "migrasi pending terhadap live saat ini bukan TEPAT migrasi rilis ini", "produksi memiliki migrasi yang TIDAK ada di kandidat", "produksi memiliki migrasi LEBIH BARU dari",
    "ada migrasi baseline yang DIUBAH/DIHAPUS", "frontend/dist — dist dibangun saat rilis", "uji negatif pemindai", "for f in $GUARD_UNCHANGED"]) assert.ok(script.includes(s), s);
  assert.ok(!script.includes("HOTFIX_STOCK_COUNT") && !/stock_count|opname/i.test(script.replace(/Stock Count/g, "")), "tidak ada sisa domain opname");
  assert.match(script, /^LIVE_ANCESTORS="1{40} 2{40}"$/m); assert.match(script, /^LIVE_MIG_TERAKHIR="20261220090000_gudang_koreksi_dokumen"$/m);
  assert.match(script, /^GUARD_UNCHANGED=".*backend\/src\/services\/inventoryLedger\.js.*backend\/src\/services\/statusUnitLintasWorkspace\.js.*"$/m);
});

test("rehearsal: restore bersih, identik dengan produksi (17 kelompok), struktur tabel/FK/CHECK/indeks/trigger, uji perilaku, kode baru, sidik jari SEMUA tabel + saldo + riwayat migrasi sebelum=sesudah, DB sementara dihapus", () => {
  for (const s of ["restore ke DB sementara TIDAK bersih", "RESTORE_WARN", "restore nyata IDENTIK dengan produksi", "TABEL_LAMA", "fp-all-sebelum", "fp-all-sesudah", "SALDO_SEBELUM", "saldo per bahan BERUBAH",
    "riwayat migrasi lama (checksum) BERUBAH", "ROLLBACK_UJI", "TIDAK_DITOLAK", "\\timing on", "terlama ${MAKS_MS} ms", "reh_drop", "migrasi MENGUBAH skema", "migrasi MENGUBAH indeks/constraint/trigger tabel lama",
    "tabel adopsi TIDAK kosong setelah migrasi", "3 FK ON DELETE RESTRICT tidak terpasang", "FPB_N=17"]) assert.ok(script.includes(s), s);
  assert.equal((script.match(/^union all select '/gm) ?? []).length + 1, 17, "17 kelompok pembanding beku (1 select awal + 16 union)");
  assert.equal((script.match(/TIDAK_DITOLAK_/g) ?? []).length, 12, "12 penolakan");
  assert.equal((script.match(/lolos := lolos \+ 1/g) ?? []).length, 5, "5 operasi sah");
  assert.ok(script.includes('[ "$UJI_TOLAK" = "12" ]') && script.includes('[ "$UJI_LOLOS" = "5" ]'), "hitungan yang diharapkan sama dengan isi blok uji");
  const iGit = script.indexOf("rehearsal git"), iImg = script.lastIndexOf("\nrehearsal image\n"), iMig = script.indexOf('PHASE="6-migrate"'), iSw = script.indexOf('PHASE="7-switch"'), iSmoke = script.indexOf('PHASE="8b-smoke"');
  assert.ok(iGit > 0 && iImg > 0 && iMig > iImg && iSw > iMig && iSmoke > iSw, "urutan: rehearsal → migrate → switch → smoke");
  assert.ok(script.indexOf('PHASE="5-build-image"') < iImg, "rehearsal image memakai image baru");
  assert.ok(script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]') > script.indexOf('PHASE="3-backup"') && script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]') < script.indexOf('PHASE="4-release-dir"'), "--rehearsal-only: sesudah backup, sebelum release dir/build/migrasi");
  assert.ok(script.indexOf('if [ "$PREFLIGHT_ONLY" = "1" ]') < script.indexOf('PHASE="3-backup"'), "--preflight-only keluar sebelum backup");
});

test("uji perilaku di templat: blok DO dibatalkan, sentinel tidak tertangkap penanganan galat, tidak ada tulisan permanen", () => {
  const blok = script.match(/DO \$t\$[\s\S]*?END \$t\$;/)[0];
  assert.match(blok, /RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%'/);
  assert.equal((blok.match(/ERRCODE = 'P0999'/g) ?? []).length, 12, "setiap penolakan memakai sentinel P0999 (bukan P0001 yang ditangkap trigger-handler)");
  assert.doesNotMatch(blok, /\bCOMMIT\b/i); assert.doesNotMatch(blok, /WHEN OTHERS/i);
});

test("rehearsal-penuh: build image BERTAG rehearsal (tag production utuh), skenario pada KLON, DB utama tidak berubah, guard, tes integrasi di Postgres sekali-pakai TANPA volume dan TANPA Postgres production, pembersihan", () => {
  const lanjut = script.match(/rehearsal_penuh_lanjutan\(\) \{[\s\S]*?\n\}\n/)[0];
  for (const s of ["CREATE DATABASE \\\"${KLON_DB}\\\" TEMPLATE \\\"${REH_DB}\\\"", "DB rehearsal UTAMA tetap tidak berubah oleh skenario", "GUARD_DB=\"$KLON_DB\"", "runDisposable.js $TES_FILES", "--tmpfs /var/lib/postgresql/data", "docker rm -f \"$PGT\"", "TEST_DB_SERVER_URL=\"postgresql://${DB_USER}:${PGPW}@${PGT}:5432/postgres?connection_limit=30\"",
    "tes integrasi terarah TIDAK lulus penuh", '[ "$T_N" != "$TES_N_EXPECT" ]', "sekali-pakai"]) assert.ok(lanjut.includes(s), s);
  const dockerTes = lanjut.split("\n").find((l) => l.includes("runDisposable.js"));
  const mount = [...dockerTes.matchAll(/ -v "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(mount, ["$WS/scripts:/scripts:ro", "$WS/frontend/src:/frontend/src:ro"], "satu-satunya mount = arsip kandidat READ-ONLY (scripts, frontend/src); tidak ada volume production");
  assert.ok(!/--env-file|--volume|PERSIST|uploads|\/app\/data/.test(dockerTes), "tes integrasi tanpa env production dan tanpa data/uploads production (tidak menulis berkas ke data production)");
  assert.ok(dockerTes.includes("connection_limit=30"), "kolam koneksi memadai untuk tes paralel");
  assert.ok(!/\$PREV_DIR.*runDisposable|dcp .*runDisposable/.test(lanjut), "tes tidak lewat compose production");
  assert.ok(script.includes('REH_IMG="${IMG_NAME%%:*}:rehearsal-opa-${DEPLOY_SHORT}"') && script.includes('[ "$(docker image inspect -f \'{{.Id}}\' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag image PRODUCTION berubah'));
  assert.ok(script.includes("production TIDAK berubah: container/image/release sama"), "verifikasi production tidak berubah sesudah rehearsal-penuh");
  assert.ok(script.includes('docker rm -f "rh-opa-pg-${TS}"') && script.includes("rehearsal_opa_test_klon_${TS}"), "pembersihan Postgres sekali-pakai + klon");
});

test("bukti rehearsal-penuh adalah SYARAT rilis penuh (SHA + baseline sama, <36 jam); ditulis hanya di akhir rehearsal-penuh yang lulus", () => {
  const iGate = script.indexOf("belum ada bukti --rehearsal-penuh LULUS"), iBackup = script.indexOf('PHASE="3-backup"');
  assert.ok(iGate > 0 && iGate < iBackup, "gerbang bukti sebelum backup/migrasi");
  assert.ok(script.includes('grep -qx "BASE=${BASE_SHA}" "$MARK"') && script.includes('grep -qx "DEPLOY=${DEPLOY_SHA}" "$MARK"') && script.includes("-mmin -2160"));
  const iTulis = script.indexOf(".rehearsal-penuh-ok-order-produksi-adopsi-${DEPLOY_SHA}\"", script.indexOf("printf 'BASE=%s"));
  assert.ok(iTulis > script.indexOf('PHASE="3d-production-tidak-berubah"'), "bukti ditulis SESUDAH verifikasi production tidak berubah");
});

test("smoke, skenario, dan kode-baru-terhadap-restore: smoke/kode BACA-SAJA; skenario menulis HANYA di klon; penolakan di pintu sebelum data disentuh", () => {
  const smoke = baca("scripts/lib/smoke-order-produksi-adopsi.mjs"), reh = baca("scripts/lib/rehearsal-kode-order-produksi-adopsi.mjs"), sken = baca("scripts/lib/rehearsal-skenario-order-produksi-adopsi.mjs");
  for (const f of [smoke, reh]) { assert.doesNotMatch(f, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/); assert.doesNotMatch(f, /\$executeRaw/); }
  assert.ok(smoke.includes("SMOKE_HASIL fail=") && reh.includes("REHEARSAL_KODE_BARU gagal=") && sken.includes("RH_SKENARIO gagal="));
  for (const s of ["tanpa token → 401", "IDEMPOTENCY_KEY_INVALID", "STATUS_KERJA_TIDAK_VALID", "smoke tidak menulis", "ekspor xlsx: 200", "akun hanya-lihat"]) assert.ok(smoke.includes(s), s);
  for (const s of ["KERJA_DIPEGANG_APLIKASI", "IDEMPOTENCY_KEY_REUSED", "Promise.all", "STATUS ORDER dari Produksi", "RIWAYAT_BERUBAH", "tepat satu pergerakan"]) assert.ok(sken.includes(s), s);
  assert.ok(script.includes("SMOKE_HASIL fail=0 skip="), "skrip menolak smoke tanpa ringkasan");
  assert.ok(sken.indexOf('if (FASE === "smoke")') > 0 && sken.indexOf('if (FASE === "smoke")') < sken.indexOf("async function pengguna"), "fase smoke keluar SEBELUM pengguna rehearsal dibuat (smoke tidak menulis apa pun, termasuk tabel User)");
  assert.ok(sken.includes('startTestServer(buildTestApp())') && !/import\(["']\/app\/src\/index\.js/.test(sken), "server minimal tanpa cron/worker/WAHA");
});

test("rollback kode terbukti pada data: image LAMA (baseline) membaca KLON berisi data adopsi; hanya bacaan + satu probe hapus pada klon; data utuh", () => {
  const lama = baca("scripts/lib/rehearsal-kode-lama-order-produksi-adopsi.mjs");
  for (const s of ["image ini LAMA: rute adopsi tidak ada (404)", "RH_KODE_LAMA gagal=", "kode lama: daftar Order Produksi tetap 200", "kode lama: bacaan tidak mengubah stok", "TETAP utuh", "klon berisi data adopsi"]) assert.ok(lama.includes(s), s);
  assert.doesNotMatch(lama, /\.(create|update|upsert|createMany|updateMany|deleteMany|delete)\(/, "tanpa penulisan lewat Prisma");
  assert.ok(script.includes('"$PREV_IMG_ID" node /rh/rehearsal-kode-lama-order-produksi-adopsi.mjs'), "dijalankan di image LAMA (PREV_IMG_ID), bukan image kandidat");
  assert.ok(script.indexOf("rollback kode terbukti pada data") < script.indexOf('DROP DATABASE IF EXISTS \\"${KLON_DB}\\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true\n  # 4) TES INTEGRASI'), "dijalankan sebelum klon dibuang");
});

test("rollback guard: baca-saja, informasi (exit 0), TIDAK menghapus tabel/riwayat adopsi, menolak hanya bila tabel tidak ada", () => {
  const g = baca("scripts/rollback-guard-order-produksi-adopsi.sh");
  assert.doesNotMatch(g.replace(/^#.*$/gm, ""), /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER)\b/i, "guard hanya membaca");
  assert.ok(g.includes("GUARD LULUS") && g.includes("exit 1") && g.includes("tidak dihapus") && g.includes("GUARD_DB"));
  assert.ok(script.includes("rollback-guard-order-produksi-adopsi.sh") && script.includes("TIDAK menghapus tabel adopsi"));
  assert.doesNotMatch(script.match(/rollback_instructions\(\)[\s\S]*?\nEOF/)[0], /DROP TABLE|DROP COLUMN|DELETE FROM production_unit/);
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/rollback-guard-order-produksi-adopsi.sh")]).status, 0);
});

test("skrip tersimpan identik dengan hasil generator terhadap repo ini (bila repo lengkap)", { skip: !fs.existsSync(path.join(root, "scripts/release-order-produksi-adopsi.sh")) }, () => {
  const tersimpan = baca("scripts/release-order-produksi-adopsi.sh");
  assert.ok(tersimpan.includes(`MIGS="${migName}:${sha(migSql)}"`), "pin migrasi pada skrip tersimpan = isi migrasi di repo");
  assert.ok(tersimpan.includes(`SCAN_EXPECT='${pindai(migSql).stdout.trim()}'`), "hasil pemindai tersimpan = hasil nyata");
  assert.equal(sha(lf(tpl)).slice(0, 12), tersimpan.match(/templat sha256 ([0-9a-f]{12})…/)[1], "skrip dibangkitkan dari templat yang sekarang");
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/release-order-produksi-adopsi.sh")]).status, 0, "sintaks bash valid");
});
