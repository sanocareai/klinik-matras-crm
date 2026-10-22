// Tes generator + skrip rilis Rencana Produksi (jadwal mingguan) — TANPA menyentuh produksi dan tanpa jaringan. Mengunci: pin migrasi, hasil pemindai DDL (+ mutan negatif), konsistensi hitungan uji perilaku dengan templat,
// gerbang migrasi (tepat 1 pending, himpunan terpasang ⊆ kandidat), rehearsal sebelum migrate, migrate sebelum switch, smoke baca-saja, bukti rehearsal-penuh sebagai syarat rilis, tes integrasi di Postgres sekali-pakai tanpa volume
// production, dan rollback guard yang tidak menghapus jadwal/riwayat.
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
const { bangkitkan, TES_N_EXPECT } = require(path.join(root, "scripts/gen-release-rencana-jadwal-mingguan.cjs"));
const lf = (t) => t.replace(/\r\n/g, "\n");
const sha = (t) => createHash("sha256").update(t).digest("hex");
const baca = (rel) => lf(fs.readFileSync(path.join(root, rel), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const semuaMig = fs.readdirSync(path.join(root, "backend/prisma/migrations"));
const migName = semuaMig.find((n) => n.endsWith("_production_unit_schedules")); const mig2Name = semuaMig.find((n) => n.endsWith("_production_unit_component_reuse"));
const migRel = `backend/prisma/migrations/${migName}/migration.sql`; const mig2Rel = `backend/prisma/migrations/${mig2Name}/migration.sql`;
const migSql1 = baca(migRel); const migSql2 = baca(mig2Rel); const migSql = `${migSql1}\n${migSql2}`; // gabungan kedua migrasi (pemindai + mutan bekerja pada gabungan)
const migs = [{ name: migName, sql: migSql1 }, { name: mig2Name, sql: migSql2 }];
const MIGS_STR = migs.map((m) => `${m.name}:${sha(lf(m.sql))}`).join(" ");
const bersih = (sql) => lf(sql).split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n");
const pindai = (sql) => spawnSync(process.execPath, ["scripts/lib/scan-migrasi-rencana-jadwal-mingguan.mjs"], { cwd: root, input: bersih(sql), encoding: "utf8" });
const tpl = baca("scripts/templates/release-rencana-jadwal-mingguan.sh.tpl");
const TES = ["tests/integration/rencanaAdminJadwal.integration.test.js", "tests/integration/rencanaExportExcel.integration.test.js"];
const masukan = (o = {}) => ({
  tplSrc: tpl, berkasList: ["backend/prisma/schema.prisma", migRel, mig2Rel, mig2Rel, "backend/src/services/productionRencanaJadwalService.js", "frontend/src/features/production/rencana/JadwalModal.jsx"], migs,
  migNKandidat: semuaMig.filter((n) => /^\d{14}_/.test(n)).length, schemaDiffSha: "a".repeat(64), scanJs: baca("scripts/lib/scan-migrasi-rencana-jadwal-mingguan.mjs"), scanExpect: '{"total":12}', liveMigTerakhir: "20261223090000_unit_workshop_receipts",
  liveAncestors: ["1".repeat(40), "2".repeat(40)], rehNode: baca("scripts/lib/rehearsal-kode-rencana-jadwal-mingguan.mjs"), smokeNode: baca("scripts/lib/smoke-rencana-jadwal-mingguan.mjs"), tesFiles: TES, ...o,
});
const { script, ringkasan } = bangkitkan(masukan());

test("migrasi: tepat satu nama migrasi jadwal Admin; terurut SETELAH migrasi live terakhir (penerimaan workshop)", () => {
  assert.equal(migName, "20261224090000_production_unit_schedules"); assert.equal(mig2Name, "20261225090000_production_unit_component_reuse"); assert.ok(mig2Name > migName, "migrasi komponen lama terurut sesudah migrasi jadwal");
  assert.ok(migName > "20261223090000_unit_workshop_receipts", "harus sesudah migrasi live terakhir");
  assert.equal(fs.readdirSync(path.join(root, "backend/prisma/migrations")).filter((n) => n.endsWith("_production_unit_schedules")).length, 1);
});

test("migrasi aditif: hanya CREATE tabel/indeks/FK/trigger BARU pada 2 tabel baru; tanpa ALTER tabel lama, UPDATE, DELETE, INSERT, DROP, fungsi baru", () => {
  const b = bersih(migSql);
  assert.doesNotMatch(b, /\b(DROP|DELETE\s+FROM|INSERT\s+INTO|TRUNCATE|UPDATE\s+"|RENAME|ALTER\s+COLUMN|ADD\s+COLUMN|GRANT|REVOKE|CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|CREATE\s+EXTENSION)\b/i);
  const alter = [...b.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(alter.length === 6 && alter.every((t) => t.startsWith("production_unit_schedule") || t === "unit_component_reuse_entries"), `ALTER hanya pada tabel baru: ${alter}`);
  assert.equal((b.match(/ON DELETE RESTRICT/g) ?? []).length, 6); assert.doesNotMatch(b, /ON DELETE CASCADE|SET NULL/);
  assert.equal((b.match(/EXECUTE FUNCTION production_adopsi_append_only\(\)/g) ?? []).length, 2, "dua trigger (riwayat jadwal + komponen lama) memakai fungsi lama; tabel jadwal boleh diubah");
  assert.equal((b.match(/^CREATE TABLE "/gm) ?? []).length, 3); assert.match(b, /CREATE UNIQUE INDEX "unit_component_reuse_entries_item_id_version_key"/, "versi unik per komponen"); assert.match(b, /"source" = 'OWN_UNIT'/, "sumber dikunci unit ini (tanpa lintas unit)"); assert.doesNotMatch(b, /(ALTER TABLE "(units|materials)")/, "tabel lama tidak diubah");
  assert.match(b, /CREATE UNIQUE INDEX "production_unit_schedules_unit_id_key"/, "satu jadwal per unit");
});

test("generator: pin sha256 isi migrasi (LF) tertanam; hasil bangkit deterministik; daftar tes + jumlah tes tertanam", () => {
  assert.ok(script.includes(`MIGS="${MIGS_STR}"`));
  assert.deepEqual(ringkasan.migShas, migs.map((m) => sha(lf(m.sql))));
  assert.equal(bangkitkan(masukan()).script, script, "bangkit ulang dengan masukan sama = identik");
  assert.ok(!/@@[A-Z_]+@@/.test(script.replace(/s\/\^@@ \[\^@\]\*@@\.\*\$\/@@\//g, "")), "tidak ada placeholder tersisa");
  assert.ok(script.includes(`TES_FILES="${TES.join(" ")}"`) && script.includes(`TES_N_EXPECT="${TES_N_EXPECT}"`));
  assert.ok(TES_N_EXPECT > 0, "jumlah tes dipatok (dihitung dari himpunan berkas pinned)");
});

test("generator: menolak masukan tidak aman (prisma lain, dependensi, berkas pelindung, tanpa migrasi, tanpa daftar tes)", () => {
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, mig2Rel, "backend/prisma/migrations/20261230000000_liar/migration.sql"] })), /prisma lain/);
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, mig2Rel, "backend/package.json"] })), /dependensi/);
  for (const f of ["backend/src/services/statusUnitLintasWorkspace.js", "backend/src/services/inventoryLedger.js", "backend/src/constants/permissions.js", "backend/src/services/finance/journal.js", "backend/src/services/productionStepCommandService.js"]) {
    assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, mig2Rel, f] })), /pelindung/, f);
  }
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/src/services/productionRencanaJadwalService.js"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ migs: [{ name: "bukan-migrasi", sql: "" }] })), /nama migrasi/); assert.throws(() => bangkitkan(masukan({ migs: [migs[0], migs[0]] })), /ganda/);
  assert.throws(() => bangkitkan(masukan({ tesFiles: [] })), /tes integrasi/);
});

test("allowlist: memuat migrasi + schema + berkas jadwal; menolak dist, Finance, ledger, fungsi status lintas workspace, Delivery, Gudang", () => {
  const re = new RegExp(script.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  for (const f of [migRel, mig2Rel, "backend/prisma/schema.prisma", "backend/src/services/productionRencanaJadwalService.js", "frontend/src/features/production/rencana/JadwalModal.jsx", "scripts/release-rencana-jadwal-mingguan.sh", "scripts/rollback-guard-rencana-jadwal-mingguan.sh", "scripts/lib/smoke-rencana-jadwal-mingguan.mjs"]) assert.match(f, re, f);
  for (const f of ["frontend/dist/index.html", "backend/src/services/finance/journal.js", "backend/src/services/inventoryLedger.js", "backend/src/services/statusUnitLintasWorkspace.js", "backend/src/services/productionStepCommandService.js", "backend/src/routes/stockCount.js", "backend/package.json", "docker-compose.yml"]) assert.doesNotMatch(f, re, f);
});

test("pemindai DDL: migrasi nyata lolos dengan hitungan yang tertanam; semua mutan ditolak atau menyimpang", () => {
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { total: 19, create_table: 3, index: 8, fk: 6, trigger: 2 });
  const hapusBaris = (kunci) => migSql.split("\n").filter((l) => !l.includes(kunci)).join("\n");
  const mutan = {
    "DROP": `${migSql}\nDROP TABLE "units";`, "UPDATE": `${migSql}\nUPDATE "units" SET "status" = 'RECEIVED';`, "DELETE": `${migSql}\nDELETE FROM "units";`, "INSERT": `${migSql}\nINSERT INTO "production_unit_schedules" (id) VALUES ('x');`,
    "INSERT SELECT": `${migSql}\nINSERT INTO "production_unit_schedules" SELECT * FROM "units";`, "TRUNCATE": `${migSql}\nTRUNCATE "units";`, "kolom pada tabel lama": `${migSql}\nALTER TABLE "units" ADD COLUMN "x" TEXT;`,
    "kolom pada rencana Meja": `${migSql}\nALTER TABLE "production_run_plans_v2" ADD COLUMN "x" TEXT;`, "kolom pada tabel baru": `${migSql}\nALTER TABLE "production_unit_schedules" ADD COLUMN "x" TEXT;`,
    "ALTER COLUMN": `${migSql}\nALTER TABLE "units" ALTER COLUMN "status" TYPE TEXT;`, "RENAME": `${migSql}\nALTER TABLE "units" RENAME COLUMN "status" TO "s";`, "GRANT": `${migSql}\nGRANT ALL ON "production_unit_schedules" TO PUBLIC;`, "REVOKE": `${migSql}\nREVOKE ALL ON "units" FROM PUBLIC;`,
    "FK CASCADE units": migSql.replace('"unit_id") REFERENCES "units"("id") ON DELETE RESTRICT', '"unit_id") REFERENCES "units"("id") ON DELETE CASCADE'),
    "FK CASCADE rencana": migSql.replace('REFERENCES "production_run_plans_v2"("id") ON DELETE RESTRICT', 'REFERENCES "production_run_plans_v2"("id") ON DELETE CASCADE'),
    "FK SET NULL riwayat": migSql.replace('REFERENCES "production_unit_schedules"("id") ON DELETE RESTRICT', 'REFERENCES "production_unit_schedules"("id") ON DELETE SET NULL'),
    "tabel liar": `${migSql}\nCREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));`, "indeks pada tabel lama": `${migSql}\nCREATE INDEX "x_idx" ON "units"("status");`,
    "trigger pada tabel lama": `${migSql}\nCREATE TRIGGER trg_evil BEFORE DELETE ON "units" FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();`, "blok DO liar": `${migSql}\nDO $$ BEGIN DELETE FROM "units"; END $$;`,
    "trigger pada tabel jadwal": `${migSql}\nCREATE TRIGGER x_trg BEFORE UPDATE OR DELETE ON "production_unit_schedules" FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();`,
    "pernyataan ganda": `${migSql}\nCREATE UNIQUE INDEX "production_unit_schedules_unit_id_key" ON "production_unit_schedules"("unit_id");`, "CREATE EXTENSION": `${migSql}\nCREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
    "fungsi liar": `${migSql}\nCREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;`,
    "fungsi lama ditimpa": `${migSql}\nCREATE OR REPLACE FUNCTION production_adopsi_append_only() RETURNS TRIGGER AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;`,
    "CHECK status dibuang": hapusBaris("production_unit_schedules_status_chk"), "CHECK meja dibuang": hapusBaris("production_unit_schedules_station_chk"), "CHECK revisi dibuang": hapusBaris("production_unit_schedules_revision_chk"), "CHECK jenis dibuang": hapusBaris("production_unit_schedule_events_kind_chk"),
    "CHECK status dilonggarkan": migSql.replace("'ACTIVE','CLEARED','ADOPTED'", "'ACTIVE','CLEARED','ADOPTED','LIAR'"), "CHECK jenis dilonggarkan": migSql.replace("'UNDONE','ADOPTED'", "'UNDONE','ADOPTED','LIAR'"), "CHECK revisi dilonggarkan": migSql.replace('"revision" >= 1', '"revision" >= 0'),
    "DROP komponen lama": `${migSql}\nDROP TABLE "unit_component_reuse_entries";`, "ALTER materials": `${migSql}\nALTER TABLE "materials" ADD COLUMN "x" TEXT;`, "INSERT komponen": `${migSql}\nINSERT INTO "unit_component_reuse_entries" (id) VALUES ('x');`,
    "CHECK sumber komponen dibuang": hapusBaris("unit_component_reuse_entries_source_chk"), "CHECK sumber dilonggarkan": migSql.replace(`"source" = 'OWN_UNIT'`, `"source" IN ('OWN_UNIT','OTHER_UNIT')`), "CHECK versi komponen dibuang": hapusBaris("unit_component_reuse_entries_version_chk"),
    "CHECK alasan koreksi dibuang": hapusBaris("unit_component_reuse_entries_reason_chk"), "CHECK hasil dilonggarkan": migSql.replace("'KEPT_WITH_UNIT','DISCARDED'", "'KEPT_WITH_UNIT','DISCARDED','LIAR'"), "trigger komponen dibuang": hapusBaris("unit_component_reuse_entries_append_only_trg"),
    "FK komponen CASCADE": migSql.replace('unit_component_reuse_entries_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT', 'unit_component_reuse_entries_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE'), "FK bahan SET NULL": migSql.replace('REFERENCES "materials"("id") ON DELETE RESTRICT', 'REFERENCES "materials"("id") ON DELETE SET NULL'),
    "WHERE unik kunci idempotensi dibuang": migSql.replace(' WHERE "idempotency_key" IS NOT NULL', ""),
    "trigger dibuang": hapusBaris("production_unit_schedule_events_append_only_trg"), "trigger fungsi lain": migSql.replace("EXECUTE FUNCTION production_adopsi_append_only()", "EXECUTE FUNCTION evil_fn()"), "trigger dilonggarkan": migSql.replace('BEFORE UPDATE OR DELETE ON "production_unit_schedule_events"', 'BEFORE UPDATE ON "production_unit_schedule_events"'),
    "DISABLE TRIGGER": `${migSql}\nALTER TABLE "production_unit_schedule_events" DISABLE TRIGGER ALL;`, "DROP CONSTRAINT": `${migSql}\nALTER TABLE "units" DROP CONSTRAINT "units_pkey";`, "SET DEFAULT": `${migSql}\nALTER TABLE "production_unit_schedules" ALTER COLUMN "revision" SET DEFAULT 1;`,
  };
  for (const [nama, sql] of Object.entries(mutan)) { const r = pindai(sql); assert.ok(r.status !== 0 || r.stdout.trim() !== ok.stdout.trim(), `mutan '${nama}' LOLOS pemindai`); }
  assert.ok(Object.keys(mutan).length >= 30);
  assert.ok((script.match(/^harus_ditolak "/gm) ?? []).length >= 50, "skrip memuat ≥ 50 mutan negatif");
});

test("skrip rilis: gerbang sumber — ancestry live, pin migrasi, pin diff schema, tepat 1 pending, terpasang ⊆ kandidat, berkas pelindung, prasyarat fungsi append-only live", () => {
  for (const s of ['sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA"', 'sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA"', 'for A in $LIVE_ANCESTORS', 'die "isi migrasi ${n} BERBEDA dari yang diaudit',
    "SCHEMA_DIFF_SHA", "keadaan production tidak dikenal", "production memiliki migrasi yang TIDAK ada di kandidat", "BUKAN tepat himpunan baseline", "migrasi pending bukan tepat migrasi rilis ini",
    "ada migrasi baseline yang DIUBAH/DIHAPUS", "frontend/dist — dist dibangun saat rilis", "uji negatif pemindai", "for f in $GUARD_UNCHANGED"]) assert.ok(script.includes(s), s);
  assert.ok(script.includes(`pg_proc where proname = 'production_adopsi_append_only'")" = "1"`), "fungsi append-only WAJIB sudah ada di produksi (migrasi memakainya, tidak membuatnya)");
  assert.ok(script.includes("keadaan production: LANJUT — rilis sebelumnya terhenti SESUDAH migrasi") && script.includes("keadaan production: SEGAR"));
  assert.match(script, /backend\/src\/services\/opnameSesi\.js.*backend\/src\/services\/pergerakanSesiHitung\.js/, "berkas Opname live dijaga identik");
  assert.match(script, /^LIVE_ANCESTORS="1{40} 2{40}"$/m); assert.match(script, /^LIVE_MIG_TERAKHIR="20261223090000_unit_workshop_receipts"$/m);
  assert.match(script, /^GUARD_UNCHANGED=".*backend\/src\/services\/inventoryLedger\.js.*backend\/src\/services\/statusUnitLintasWorkspace\.js.*"$/m);
  assert.match(script, /^MIG_URUT_LAMA_OK=""$/m, "migrasi bernama SESUDAH baseline: tidak perlu izin urutan");
});

test("rehearsal: restore bersih, identik dengan produksi (17 kelompok), struktur tabel/FK/CHECK/indeks/trigger, uji perilaku, kode baru, sidik jari SEMUA tabel + saldo + riwayat migrasi sebelum=sesudah, fungsi append-only tak berubah, DB sementara dihapus", () => {
  for (const s of ["restore ke DB sementara TIDAK bersih", "RESTORE_WARN", "restore nyata IDENTIK dengan produksi", "TABEL_LAMA", "fp-all-sebelum", "fp-all-sesudah", "SALDO_SEBELUM", "saldo per bahan BERUBAH",
    "riwayat migrasi lama (checksum) BERUBAH", "ROLLBACK_UJI", "TIDAK_DITOLAK", "\\timing on", "terlama ${MAKS_MS} ms", "reh_drop", "migrasi MENGUBAH skema", "migrasi MENGUBAH indeks/constraint/trigger tabel lama",
    "tabel baru TIDAK kosong setelah migrasi", "4 FK ON DELETE RESTRICT tidak terpasang", "FPB_N=17", "FN_SEBELUM", "fungsi production_adopsi_append_only BERUBAH oleh migrasi", "indeks unik parsial kunci idempotensi", "satu jadwal per unit (UNIQUE unit_id)"]) assert.ok(script.includes(s), s);
  assert.equal((script.match(/^union all select '/gm) ?? []).length + 1, 17, "17 kelompok pembanding beku (1 select awal + 16 union)");
  assert.equal((script.match(/TIDAK_DITOLAK_/g) ?? []).length, 32, "32 penolakan (14 jadwal + 18 komponen lama)");
  assert.equal((script.match(/lolos := lolos \+ 1/g) ?? []).length, 12, "12 operasi sah (6 jadwal + 6 komponen lama)");
  assert.ok(script.includes('[ "$UJI_TOLAK" = "32" ]') && script.includes('[ "$UJI_LOLOS" = "12" ]'), "hitungan yang diharapkan sama dengan isi blok uji");
  const iGit = script.indexOf("rehearsal_jalur git"), iImg = script.lastIndexOf("\nrehearsal_jalur image\n"), iMig = script.indexOf('PHASE="6-migrate"'), iSw = script.indexOf('PHASE="7-switch"'), iSmoke = script.indexOf('PHASE="8b-smoke"');
  assert.ok(iGit > 0 && iImg > 0 && iMig > iImg && iSw > iMig && iSmoke > iSw, "urutan: rehearsal → migrate → switch → smoke");
  assert.ok(script.indexOf('PHASE="5-build-image"') < iImg, "rehearsal image memakai image baru");
  assert.ok(script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]') > script.indexOf('PHASE="3-backup"') && script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]') < script.indexOf('PHASE="4-release-dir"'), "--rehearsal-only: sesudah backup, sebelum release dir/build/migrasi");
  assert.ok(script.indexOf('if [ "$PREFLIGHT_ONLY" = "1" ]') < script.indexOf('PHASE="3-backup"'), "--preflight-only keluar sebelum backup");
});

test("uji perilaku di templat: blok DO dibatalkan, sentinel tidak tertangkap penanganan galat, tidak ada tulisan permanen", () => {
  const blok = script.match(/DO \$t\$[\s\S]*?END \$t\$;/)[0];
  assert.match(blok, /RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%'/);
  assert.equal((blok.match(/ERRCODE = 'P0999'/g) ?? []).length, 32, "setiap penolakan memakai sentinel P0999 (bukan P0001 yang ditangkap trigger-handler)");
  assert.doesNotMatch(blok, /\bCOMMIT\b/i); assert.doesNotMatch(blok, /WHEN OTHERS/i);
  for (const s of ["unique_violation", "check_violation", "foreign_key_violation", "sqlstate 'P0001'", "'CLEARED'", "idempotency_key", "DELETE FROM production_unit_schedules", "DELETE FROM units"]) assert.ok(blok.includes(s), s);
  assert.ok(/UPDATE production_unit_schedules SET revision = 2/.test(blok), "jadwal (boleh diubah) diuji UPDATE sah; riwayat append-only diuji tertolak");
});

test("rehearsal-penuh: build image BERTAG rehearsal (tag production utuh), skenario pada KLON, DB utama tidak berubah, guard, tes integrasi di Postgres sekali-pakai TANPA volume dan TANPA Postgres production, pembersihan", () => {
  const lanjut = script.match(/rehearsal_penuh_lanjutan\(\) \{[\s\S]*?\n\}\n/)[0];
  for (const s of ["CREATE DATABASE \\\"${KLON_DB}\\\" TEMPLATE \\\"${REH_DB}\\\"", "DB rehearsal UTAMA tetap tidak berubah oleh skenario", "guard_ke \"$KLON_DB\"", "guard_ke \"$KLON_G\"", "tes_jalankan \"$BK_DIR/tes-integrasi.log\" $TES_FILES", "node tests/integration/setup/runDisposable.js \"$@\"", "--tmpfs /var/lib/postgresql/data", "docker rm -f \"$PGT\"", "TEST_DB_SERVER_URL=\"postgresql://${DB_USER}:${PGPW}@${PGT}:5432/postgres?connection_limit=30\"",
    "di luar batas kebijakan ulang", '[ "$T_N" = "$TES_N_EXPECT" ]', "sekali-pakai", "KEBIJAKAN FLAKY (eksplisit, SATU kali)", "tes integrasi GAGAL lagi pada percobaan ulang", "ringkasan tes integrasi tidak terbaca", "mengulang HANYA berkas itu di DB baru (sekali)"]) assert.ok(lanjut.includes(s), s);
  assert.ok(lanjut.includes('[ "$NG" -le 3 ] && [ "$T_FAIL" -le 3 ]'), "ulang hanya bila kegagalan terbatas (≤ 3 berkas, ≤ 3 tes)");
  for (const l of lanjut.split("\n").filter((x) => /grep -(oE|E) /.test(x) && /(tes-integrasi(-ulang)?\.log)/.test(x))) assert.ok(/\|\| true/.test(l), `grep pada log tes tanpa '|| true': ${l.slice(0, 90)}`);
  assert.equal((lanjut.match(/tes_jalankan "\$BK_DIR/g) ?? []).length, 2, "tepat satu percobaan ulang (dua pemanggilan: pertama + ulang)");
  const dockerTes = lanjut.split("\n").find((l) => l.includes("runDisposable.js"));
  const mount = [...dockerTes.matchAll(/ -v "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(mount, ["$WS/scripts:/scripts:ro", "$WS/frontend/src:/frontend/src:ro"], "satu-satunya mount = arsip kandidat READ-ONLY (scripts, frontend/src); tidak ada volume production");
  assert.ok(!/--env-file|--volume|PERSIST|uploads|\/app\/data/.test(dockerTes), "tes integrasi tanpa env production dan tanpa data/uploads production");
  assert.ok(dockerTes.includes("connection_limit=30"), "kolam koneksi memadai untuk tes paralel");
  assert.ok(!/\$PREV_DIR.*runDisposable|dcp .*runDisposable/.test(lanjut), "tes tidak lewat compose production");
  assert.ok(script.includes('REH_IMG="${IMG_NAME%%:*}:rehearsal-rjm-${DEPLOY_SHORT}"') && script.includes('[ "$(docker image inspect -f \'{{.Id}}\' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag image PRODUCTION berubah'));
  assert.ok(script.includes("production TIDAK berubah: container/image/release sama"), "verifikasi production tidak berubah sesudah rehearsal-penuh");
  assert.ok(script.includes('docker rm -f "rh-rjm-pg-${TS}"') && script.includes("rehearsal_rjm_test_klon_${TS}"), "pembersihan Postgres sekali-pakai + klon");
});

test("bukti rehearsal-penuh adalah SYARAT rilis penuh (SHA + baseline sama, <36 jam); ditulis hanya di akhir rehearsal-penuh yang lulus", () => {
  const iGate = script.indexOf("belum ada bukti --rehearsal-penuh LULUS"), iBackup = script.indexOf('PHASE="3-backup"');
  assert.ok(iGate > 0 && iGate < iBackup, "gerbang bukti sebelum backup/migrasi");
  assert.ok(script.includes('grep -qx "BASE=${BASE_SHA}" "$MARK"') && script.includes('grep -qx "DEPLOY=${DEPLOY_SHA}" "$MARK"') && script.includes("-mmin -2160"));
  const iTulis = script.indexOf(".rehearsal-penuh-ok-rencana-jadwal-mingguan-${DEPLOY_SHA}\"", script.indexOf("printf 'BASE=%s"));
  assert.ok(iTulis > script.indexOf('PHASE="3d-production-tidak-berubah"'), "bukti ditulis SESUDAH verifikasi production tidak berubah");
});

test("smoke, skenario, dan kode-baru-terhadap-restore: smoke/kode BACA-SAJA; skenario menulis HANYA di klon; pesan pelanggan hanya dihitung; penolakan di pintu sebelum data disentuh", () => {
  const smoke = baca("scripts/lib/smoke-rencana-jadwal-mingguan.mjs"), reh = baca("scripts/lib/rehearsal-kode-rencana-jadwal-mingguan.mjs"), sken = baca("scripts/lib/rehearsal-skenario-rencana-jadwal-mingguan.mjs");
  for (const f of [smoke, reh]) { assert.doesNotMatch(f, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/); assert.doesNotMatch(f, /\$executeRaw/); }
  assert.ok(smoke.includes("SMOKE_HASIL fail=") && reh.includes("REHEARSAL_KODE_BARU gagal=") && sken.includes("RH_SKENARIO gagal="));
  for (const s of ["tanpa token → 401", "smoke tidak menulis", "ekspor xlsx: 200", "IDEMPOTENCY_KEY_INVALID", "JADWAL_HARI_LIBUR", "JADWAL_TANGGAL_INVALID", "totalMinggu === 72"]) assert.ok(smoke.includes(s), s);
  for (const s of ["Promise.all", "PLAN_STATION_FULL", "JADWAL_HARI_LIBUR", "UNIT_V2_OWNED", "ADOPTED", "custodyHooks.unitReceivedAtWorkshop", "SINTETIS: klik ganda", "SINTETIS: aktivasi Meja mengambil alih", "SINTETIS: ekspor Excel memuat"]) assert.ok(sken.includes(s), s);
  assert.ok(script.includes("SMOKE_HASIL fail=0 skip="), "skrip menolak smoke tanpa ringkasan");
  assert.ok(sken.indexOf('if (FASE === "smoke")') > 0 && sken.indexOf('if (FASE === "smoke")') < sken.indexOf("async function pengguna"), "fase smoke keluar SEBELUM pengguna rehearsal dibuat (smoke tidak menulis apa pun, termasuk tabel User)");
  assert.ok(sken.includes("startTestServer(buildTestApp())") && !/import\(["']\/app\/src\/index\.js/.test(sken), "server minimal tanpa cron/worker/WAHA");
});

test("rollback kode terbukti pada data: image LAMA (baseline) membaca KLON berisi jadwal Admin; hanya bacaan + satu probe hapus pada klon; data utuh", () => {
  const lama = baca("scripts/lib/rehearsal-kode-lama-rencana-jadwal-mingguan.mjs");
  for (const s of ["image ini LAMA: rute Rencana Admin tidak ada (404)", "RH_KODE_LAMA gagal=", "kode lama: daftar Order Produksi tetap 200", "kode lama: bacaan tidak mengubah stok, Run, maupun jadwal", "TETAP utuh", "klon berisi data jadwal Admin"]) assert.ok(lama.includes(s), s);
  assert.doesNotMatch(lama, /\.(create|update|upsert|createMany|updateMany|deleteMany|delete)\(/, "tanpa penulisan lewat Prisma");
  assert.ok(script.includes('"$PREV_IMG_ID" node /rh/rehearsal-kode-lama-rencana-jadwal-mingguan.mjs'), "dijalankan di image LAMA (PREV_IMG_ID), bukan image kandidat");
  assert.ok(script.indexOf("rollback kode terbukti pada data") < script.indexOf('DROP DATABASE IF EXISTS \\"${KLON_DB}\\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true\n  # 4) TES INTEGRASI'), "dijalankan sebelum klon dibuang");
});

test("rollback guard: LULUS bila tak ada jadwal ACTIVE; DITOLAK bila ada (jumlah+contoh+alasan); ADOPTED hanya bila rencana Meja sah; bila ragu tolak; baca-saja", () => {
  const g = baca("scripts/rollback-guard-rencana-jadwal-mingguan.sh"); const kode = g.replace(/^#.*$/gm, "");
  assert.doesNotMatch(kode, /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER|GRANT)\b/i, "guard hanya membaca");
  assert.ok(g.includes("BEGIN READ ONLY"), "pembacaan dalam transaksi READ ONLY");
  // aturan keputusan
  for (const k of ["s.status = 'ACTIVE'", "s.status = 'ADOPTED' and (s.adopted_plan_id is null or p.id is null or r.unit_id is distinct from s.unit_id or p.status = 'CANCELLED')", "s.status not in ('ACTIVE','ADOPTED','CLEARED')", "limit 10"]) assert.ok(kode.includes(k), k);
  assert.ok(kode.includes('"$ADA" = "0"') && /GUARD LULUS: tidak ada jadwal Admin yang bisa tersembunyi/.test(kode), "tabel belum ada = lulus");
  assert.match(kode, /\[ "\$ADA" = "2" \] \|\| \{.*GUARD DITOLAK.*exit 1; \}/, "hanya satu tabel = tolak");
  assert.match(kode, /if \[ "\$NBLOK" != "0" \]; then[\s\S]*?GUARD DITOLAK[\s\S]*?exit 1\nfi/, "penghalang = exit 1");
  assert.ok(/exit 2/.test(kode) && (kode.match(/exit 2/g) ?? []).length >= 3, "hitungan tak terbaca = ditolak (exit 2)");
  for (const k of ["Contoh unit terdampak", "ALASAN:", "TINDAKAN:", "PERBAIKAN MAJU", "jadwal Admin=${JAD}", "DIBATALKAN", "rencana Meja pengambil-alih bukan milik unit ini"]) assert.ok(kode.includes(k), k);
  assert.doesNotMatch(g, /rollback kode aman\b(?!.*tidak)/i, "tidak menyebut rollback 'aman' hanya karena tabel ada");
  assert.match(g.split("\n").slice(0, 20).join("\n"), /ACTIVE[\s\S]*tersembunyi[\s\S]*KEDUA/, "alasan penolakan terdokumentasi di kepala berkas");
  // teks rollback di skrip rilis: jangan menyebut rollback kode 'aman' tanpa syarat guard; tunjuk perbaikan maju
  assert.ok(!script.includes("ROLLBACK KODE: aman kapan saja") && !script.includes("dibiarkan terpasang pun aman bagi kode lama"));
  const ins = script.match(/rollback_instructions\(\)[\s\S]*?\nEOF/)[0];
  for (const k of ["LANGKAH WAJIB sebelum rollback KODE", "exit 1/2 (DITOLAK)", "PERBAIKAN MAJU", "HANYA setelah guard LULUS", "jadwal berlaku TIDAK aman"]) assert.ok(ins.includes(k), k);
  assert.doesNotMatch(ins, /DROP TABLE|DROP COLUMN|DELETE FROM production_unit/);
  assert.match(script, /^# ROLLBACK KODE: TIDAK otomatis aman\./m);
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/rollback-guard-rencana-jadwal-mingguan.sh")]).status, 0);
});

test("rehearsal guard: empat pembuktian terikat pada SHA (sebelum jadwal → lulus; satu jadwal → tolak tanpa ubah data; diambil alih/dibatalkan/dikeluarkan sesuai aturan; kode lama tidak menggandakan)", () => {
  const lanjut = script.match(/rehearsal_penuh_lanjutan\(\) \{[\s\S]*?\n\}\n/)[0];
  for (const k of ["PEMBUKTIAN 1 — sebelum jadwal Admin pertama: guard LULUS", "PEMBUKTIAN 2 — setelah satu jadwal Admin: guard DITOLAK", "PEMBUKTIAN 3 —", "PEMBUKTIAN 4 — kode LAMA", "guard rollback MENGUBAH data", "gfase g1", "gfase g2", "gfase g3", "gfase g3b", "gfase g4", "gfase g5", "INFO bahaya terbukti=ya", "TEMPLATE \\\"${REH_DB}\\\"", "rehearsal_rjm_test_klong_${TS}"]) assert.ok(lanjut.includes(k) || script.includes(k), k);
  assert.ok(lanjut.includes('[ "$GX" = "0" ]') && lanjut.includes('[ "$GX" = "1" ]'));
  assert.ok(script.includes('"$PREV_IMG_ID" node /rh/rehearsal-guard-kode-lama-rencana-jadwal-mingguan.mjs'), "pembuktian 4 dijalankan di image LAMA");
  assert.ok(script.includes('rehearsal_rjm_test_klong_${TS}\\" WITH (FORCE)'), "klon guard dibersihkan (juga pada kegagalan)");
  const gl = baca("scripts/lib/rehearsal-guard-rencana-jadwal-mingguan.mjs"), gk = baca("scripts/lib/rehearsal-guard-kode-lama-rencana-jadwal-mingguan.mjs");
  for (const k of ['FASE === "g1"', 'FASE === "g2"', 'FASE === "g3"', 'FASE === "g3b"', 'FASE === "g4"', 'FASE === "g5"', "RH-GRD-", "ADOPTED", "CLEARED", "CANCELLED"]) assert.ok(gl.includes(k), k);
  assert.doesNotMatch(gk, /prisma\.[a-zA-Z]+\.(create|update|upsert|createMany|updateMany|deleteMany|delete)\(/, "kode-lama menulis hanya lewat API lama");
  for (const k of ["image ini LAMA", "unit X (ADOPTED", "unit Y (CLEARED)", "BAHAYA yang dicegah guard", "INFO bahaya terbukti="]) assert.ok(gk.includes(k), k);
  assert.ok(script.includes("scripts/lib/rehearsal-guard-rencana-jadwal-mingguan.mjs scripts/lib/rehearsal-guard-kode-lama-rencana-jadwal-mingguan.mjs docker-compose.yml"), "pustaka guard wajib ada di arsip kandidat");
  const re = new RegExp(script.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  assert.match("scripts/lib/rehearsal-guard-rencana-jadwal-mingguan.mjs", re); assert.match("scripts/lib/rehearsal-guard-kode-lama-rencana-jadwal-mingguan.mjs", re);
});

test("skrip tersimpan identik dengan hasil generator terhadap repo ini (bila repo lengkap)", { skip: !fs.existsSync(path.join(root, "scripts/release-rencana-jadwal-mingguan.sh")) }, () => {
  const tersimpan = baca("scripts/release-rencana-jadwal-mingguan.sh");
  assert.ok(tersimpan.includes(`MIGS="${MIGS_STR}"`), "pin kedua migrasi pada skrip tersimpan = isi migrasi di repo");
  assert.ok(tersimpan.includes(`SCAN_EXPECT='${pindai(migSql).stdout.trim()}'`), "hasil pemindai tersimpan = hasil nyata");
  assert.equal(sha(lf(tpl)).slice(0, 12), tersimpan.match(/templat sha256 ([0-9a-f]{12})…/)[1], "skrip dibangkitkan dari templat yang sekarang");
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/release-rencana-jadwal-mingguan.sh")]).status, 0, "sintaks bash valid");
});

test("urutan migrasi: bernama SESUDAH migrasi live terbaru; baseline terbaru dipatok; tidak boleh ada nama sama; masukan dengan migrasi lebih baru dari nama ini wajib diizinkan eksplisit", () => {
  assert.ok(migName > "20261223090000_unit_workshop_receipts", "migrasi jadwal bernama setelah migrasi penerimaan live");
  for (const s of ['[ "$MIG_BASE_MAX" = "$LIVE_MIG_TERAKHIR" ] || die', "TIDAK tercantum di MIG_URUT_LAMA_OK", "bernama lebih LAMA dari ${MIG_BASE_MAX}; urutan tidak-berurutan sudah diaudit aman", "sudah ada di baseline"]) assert.ok(script.includes(s), s);
  assert.match(bangkitkan(masukan({ liveMigTerakhir: "20261230090000_lebih_baru" })).script, new RegExp(`^MIG_URUT_LAMA_OK="${migName} ${mig2Name}"$`, "m"));
});

// ───────────── KEADAAN production: SEGAR (263) vs LANJUT (265, rilis terhenti sesudah migrasi) ─────────────
import os from "node:os";
const klasifikasi = (() => {
  const m = script.match(/# <<TENTUKAN_KEADAAN\n([\s\S]*?)\n# TENTUKAN_KEADAAN>>/); assert.ok(m, "fungsi tentukan_keadaan ada di skrip");
  return m[1];
})();
function jalankanKeadaan({ ntab, nisi, applied, cand, base, kand, csok }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keadaan-")); const tulis = (n, a) => { const p = path.join(dir, n); fs.writeFileSync(p, a.length ? a.slice().sort().join("\n") + "\n" : ""); return p.replace(/\\/g, "/"); };
  const A = tulis("a", applied), C = tulis("c", cand), B = tulis("b", base);
  const r = spawnSync("bash", ["-c", klasifikasi + '\ntentukan_keadaan "$1" "$2" "$3" "$4" "$5" "$6" "$7"', "x", String(ntab), String(nisi), A, C, B, kand.join(" "), String(csok)], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true }); return { kode: r.status, out: r.stdout.trim() };
}
const BASE = ["20261101_a", "20261102_b", "20261223090000_unit_workshop_receipts"]; const KAND = [migName, mig2Name]; const CAND = [...BASE, ...KAND];
test("keadaan: SEGAR — baseline tepat, tanpa tabel rilis, pending tepat migrasi rilis", { skip: !punyaBash }, () => {
  assert.deepEqual(jalankanKeadaan({ ntab: 0, nisi: 0, applied: BASE, cand: CAND, base: BASE, kand: KAND, csok: 0 }), { kode: 0, out: "SEGAR" });
});
test("keadaan: LANJUT — 265 terpasang (baseline + dua migrasi rilis ber-checksum sesuai), tiga tabel kosong", { skip: !punyaBash }, () => {
  assert.deepEqual(jalankanKeadaan({ ntab: 3, nisi: 0, applied: CAND, cand: CAND, base: BASE, kand: KAND, csok: 2 }), { kode: 0, out: "LANJUT" });
});
test("keadaan: SEMUA selisih = TOLAK (berhenti): sebagian migrasi rilis, sebagian tabel, checksum salah, tabel berisi, migrasi asing, baseline berubah, pending tersisa", { skip: !punyaBash }, () => {
  const tolak = (o, pola) => { const r = jalankanKeadaan(o); assert.equal(r.kode, 1, JSON.stringify(o)); assert.match(r.out, /^TOLAK: /); assert.match(r.out, pola); };
  tolak({ ntab: 3, nisi: 0, applied: [...BASE, KAND[0]], cand: CAND, base: BASE, kand: KAND, csok: 1 }, /campuran/); // hanya satu migrasi rilis terpasang
  tolak({ ntab: 2, nisi: 0, applied: CAND, cand: CAND, base: BASE, kand: KAND, csok: 2 }, /campuran/); // tabel parsial
  tolak({ ntab: 1, nisi: 0, applied: BASE, cand: CAND, base: BASE, kand: KAND, csok: 0 }, /campuran/); // tabel ada tanpa migrasi tercatat
  tolak({ ntab: 0, nisi: 0, applied: CAND, cand: CAND, base: BASE, kand: KAND, csok: 2 }, /campuran/); // migrasi tercatat tanpa tabel
  tolak({ ntab: 3, nisi: 0, applied: CAND, cand: CAND, base: BASE, kand: KAND, csok: 1 }, /checksum/); // checksum/status satu migrasi tidak cocok
  tolak({ ntab: 3, nisi: 0, applied: CAND, cand: CAND, base: BASE, kand: KAND, csok: 0 }, /checksum/);
  tolak({ ntab: 3, nisi: 1, applied: CAND, cand: CAND, base: BASE, kand: KAND, csok: 2 }, /TIDAK kosong/); // sudah ada data
  tolak({ ntab: 3, nisi: 7, applied: CAND, cand: CAND, base: BASE, kand: KAND, csok: 2 }, /TIDAK kosong/);
  tolak({ ntab: 3, nisi: 0, applied: [...CAND, "20261230_asing"], cand: CAND, base: BASE, kand: KAND, csok: 2 }, /TIDAK ada di kandidat/); // migrasi asing di production
  tolak({ ntab: 0, nisi: 0, applied: [...BASE, "20261230_asing"], cand: CAND, base: BASE, kand: KAND, csok: 0 }, /TIDAK ada di kandidat/);
  tolak({ ntab: 0, nisi: 0, applied: BASE.slice(1), cand: CAND, base: BASE, kand: KAND, csok: 0 }, /baseline/); // baseline kekurangan satu
  tolak({ ntab: 3, nisi: 0, applied: [...CAND.filter((x) => x !== BASE[0])], cand: CAND, base: BASE, kand: KAND, csok: 2 }, /baseline/);
  tolak({ ntab: 0, nisi: 0, applied: BASE, cand: [...CAND, "20261231_baru"], base: BASE, kand: KAND, csok: 0 }, /pending bukan tepat/); // ada migrasi pending lain
  tolak({ ntab: 3, nisi: 0, applied: CAND, cand: [...CAND, "20261231_baru"], base: BASE, kand: KAND, csok: 2 }, /pending/);
});
test("skrip: gerbang LANJUT/SEGAR terpasang di preflight, diputuskan ULANG sebelum migrasi, hitungan migrasi = baseline + N (bukan +1), migrate deploy TIDAK dijalankan pada LANJUT", () => {
  assert.match(script, /^MIG_N_KANDIDAT="\d+"$/m);
  assert.ok(!script.includes("sebelum + 1") && !/MIG_SEBELUM \+ 1\b/.test(script), "tidak ada hitungan +1 yang tertinggal");
  for (const k of ['KEADAAN_TEKS="$(keadaan_produksi "")"', 'KEADAAN2="$(keadaan_produksi "2")"', "keadaan production berubah sejak preflight", "$(( MIG_SEBELUM + N_MIG ))", "keadaan LANJUT: migrasi TIDAK diulang dan tidak ada yang dilewati", "struktur_baru LQ die", "npx prisma migrate status", "npx prisma migrate deploy", "jumlah migrasi pohon kandidat"]) assert.ok(script.includes(k), k);
  const p6 = script.slice(script.indexOf('PHASE="6-migrate"'), script.indexOf('PHASE="7-switch"'));
  assert.match(p6, /if \[ "\$KEADAAN" = "SEGAR" \]; then\n  dcp "\$NEW_DIR" run --rm --no-deps -T backend npx prisma migrate deploy[^\n]*\nelse\n[^\n]*\n[^\n]*migrate status/, "migrate deploy hanya pada SEGAR; LANJUT hanya migrate status (baca-saja)");
  assert.ok(script.includes('[ "$MIG_TERPASANG" = "$MIG_N_KANDIDAT" ]') && script.includes("migrasi TIDAK akan diulang"), "LANJUT menuntut tepat 265 terpasang");
  assert.ok(script.includes('= "3" ] || die "3 tabel rilis tidak ada di produksi"'), "verifikasi pasca-switch menuntut 3 tabel (bukan 2)");
});
test("rehearsal: tiga jalur (segar | lanjut | pra); LANJUT wajib kedua jalur + backup pra terverifikasi (sha256); bukti memuat KEADAAN + JALUR dan dicek saat rilis", () => {
  for (const k of ["rehearsal_jalur()", 'rehearsal "$1" lanjut', 'rehearsal "$1" pra', 'rehearsal "$1" segar', "JALUR PRA: backup NYATA sebelum rilis", "'No pending migrations'", "keadaan LANJUT: migrate deploy MENERAPKAN sesuatu", "checksum migrasi ${n} di restore BERBEDA dari berkas kandidat",
    "--backup-pra", "--sha-pra", "sha256 backup pra-rilis TIDAK sama dengan --sha-pra", "backup pra-rilis tidak boleh backup yang baru diambil", 'KEADAAN=%s\\nJALUR=%s', 'grep -qx "JALUR=lanjut+pra"', 'grep -qx "KEADAAN=${KEADAAN}"', "baris migrasi rilis BERUBAH (migrasi diulang/diubah) pada keadaan LANJUT"]) assert.ok(script.includes(k), k);
  assert.ok(script.includes('if [ "$REHEARSAL_PENUH" = "1" ] && [ "$sken" != "lanjut" ]; then rehearsal_penuh_lanjutan; fi'), "skenario+tes integrasi berjalan pada jalur segar/pra (jalur lanjut = proses restore + gerbang)");
  assert.ok(script.includes("local TAMBAH_TABEL=3; [ \"$sken\" = \"lanjut\" ] && TAMBAH_TABEL=0"), "jalur lanjut: tidak ada tabel yang ditambah");
  assert.match(script, /struktur_baru RPSQL gagal_reh/); assert.match(script, /struktur_baru LQ die/);
});
