// Tes generator + skrip rilis gabungan Status Produksi + Penerimaan Workshop — TANPA menyentuh produksi dan tanpa jaringan. Mengunci: pin migrasi, hasil pemindai DDL (+ mutan negatif), konsistensi hitungan uji perilaku dengan templat,
// gerbang migrasi (tepat 1 pending, himpunan terpasang ⊆ kandidat), rehearsal sebelum migrate, migrate sebelum switch, smoke baca-saja, bukti rehearsal-penuh sebagai syarat rilis, tes integrasi di Postgres sekali-pakai tanpa volume
// production, dan rollback guard yang tidak menghapus riwayat penerimaan.
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
const { bangkitkan, TES_N_EXPECT } = require(path.join(root, "scripts/gen-release-status-produksi-penerimaan.cjs"));
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(root, rel), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const migName = fs.readdirSync(path.join(root, "backend/prisma/migrations")).find((n) => n.endsWith("_unit_workshop_receipts"));
const migRel = `backend/prisma/migrations/${migName}/migration.sql`;
const migSql = baca(migRel);
const sha = (t) => createHash("sha256").update(t).digest("hex");
const bersih = (sql) => lf(sql).split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n");
const pindai = (sql) => spawnSync(process.execPath, ["scripts/lib/scan-migrasi-status-produksi-penerimaan.mjs"], { cwd: root, input: bersih(sql), encoding: "utf8" });
const tpl = baca("scripts/templates/release-status-produksi-penerimaan.sh.tpl");
const TES = ["tests/integration/workshopReceipt.integration.test.js", "tests/integration/statusProduksiPenerimaan.integration.test.js"];
const masukan = (o = {}) => ({
  tplSrc: tpl, berkasList: ["backend/prisma/schema.prisma", migRel, "backend/src/services/unitWorkshopReceiptService.js", "frontend/src/features/production/PenerimaanWorkshopModal.jsx"], migName, migSql,
  schemaDiffSha: "a".repeat(64), scanJs: baca("scripts/lib/scan-migrasi-status-produksi-penerimaan.mjs"), scanExpect: '{"total":14}', liveMigTerakhir: "20261222090000_stock_count_sesi_penuh",
  liveAncestors: ["1".repeat(40), "2".repeat(40)], rehNode: baca("scripts/lib/rehearsal-kode-status-produksi-penerimaan.mjs"), smokeNode: baca("scripts/lib/smoke-status-produksi-penerimaan.mjs"), tesFiles: TES, ...o,
});
const { script, ringkasan } = bangkitkan(masukan());

test("migrasi: tepat satu nama migrasi penerimaan workshop; terurut SETELAH migrasi live terakhir (Stock Opname penuh)", () => {
  assert.equal(migName, "20261223090000_unit_workshop_receipts");
  assert.ok(migName > "20261222090000_stock_count_sesi_penuh", "harus sesudah migrasi live terakhir");
  assert.equal(fs.readdirSync(path.join(root, "backend/prisma/migrations")).filter((n) => n.endsWith("_unit_workshop_receipts")).length, 1);
});

test("migrasi aditif: hanya CREATE tabel/indeks/FK/trigger BARU pada 2 tabel baru; tanpa ALTER tabel lama, UPDATE, DELETE, INSERT, DROP, fungsi baru", () => {
  const b = bersih(migSql);
  assert.doesNotMatch(b, /\b(DROP|DELETE\s+FROM|INSERT\s+INTO|TRUNCATE|UPDATE\s+"|RENAME|ALTER\s+COLUMN|ADD\s+COLUMN|GRANT|REVOKE|CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|CREATE\s+EXTENSION)\b/i);
  const alter = [...b.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(alter.length === 4 && alter.every((t) => t.startsWith("unit_workshop_receipt")), `ALTER hanya pada tabel baru: ${alter}`);
  assert.equal((b.match(/ON DELETE RESTRICT/g) ?? []).length, 4); assert.doesNotMatch(b, /ON DELETE CASCADE|SET NULL/);
  assert.equal((b.match(/EXECUTE FUNCTION production_adopsi_append_only\(\)/g) ?? []).length, 2, "dua trigger memakai fungsi lama");
  assert.equal((b.match(/^CREATE TABLE "/gm) ?? []).length, 2);
});

test("generator: pin sha256 isi migrasi (LF) tertanam; hasil bangkit deterministik; daftar tes + jumlah tes tertanam", () => {
  assert.ok(script.includes(`MIGS="${migName}:${sha(migSql)}"`));
  assert.equal(ringkasan.migSha, sha(migSql));
  assert.equal(bangkitkan(masukan()).script, script, "bangkit ulang dengan masukan sama = identik");
  assert.ok(!/@@[A-Z_]+@@/.test(script.replace(/s\/\^@@ \[\^@\]\*@@\.\*\$\/@@\//g, "")), "tidak ada placeholder tersisa");
  assert.ok(script.includes(`TES_FILES="${TES.join(" ")}"`) && script.includes(`TES_N_EXPECT="${TES_N_EXPECT}"`));
  assert.ok(TES_N_EXPECT > 0, "jumlah tes dipatok (dihitung dari himpunan berkas pinned)");
});

test("generator: menolak masukan tidak aman (prisma lain, dependensi, berkas pelindung, tanpa migrasi, tanpa daftar tes)", () => {
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, "backend/prisma/migrations/20261230000000_liar/migration.sql"] })), /prisma lain/);
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, "backend/package.json"] })), /dependensi/);
  for (const f of ["backend/src/services/statusUnitLintasWorkspace.js", "backend/src/services/inventoryLedger.js", "backend/src/constants/permissions.js", "backend/src/services/finance/journal.js", "backend/src/services/productionStepCommandService.js"]) {
    assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, f] })), /pelindung/, f);
  }
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/src/services/unitWorkshopReceiptService.js"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ migName: "bukan-migrasi" })), /nama migrasi/);
  assert.throws(() => bangkitkan(masukan({ tesFiles: [] })), /tes integrasi/);
});

test("allowlist: memuat migrasi + schema + berkas penerimaan/Status Produksi; menolak dist, Finance, ledger, fungsi status lintas workspace, Delivery, Gudang", () => {
  const re = new RegExp(script.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  for (const f of [migRel, "backend/prisma/schema.prisma", "backend/src/services/unitWorkshopReceiptService.js", "frontend/src/features/production/PenerimaanWorkshopModal.jsx", "scripts/release-status-produksi-penerimaan.sh", "scripts/rollback-guard-status-produksi-penerimaan.sh", "scripts/lib/smoke-status-produksi-penerimaan.mjs"]) assert.match(f, re, f);
  for (const f of ["frontend/dist/index.html", "backend/src/services/finance/journal.js", "backend/src/services/inventoryLedger.js", "backend/src/services/statusUnitLintasWorkspace.js", "backend/src/services/productionStepCommandService.js", "backend/src/routes/stockCount.js", "backend/package.json", "docker-compose.yml"]) assert.doesNotMatch(f, re, f);
});

test("pemindai DDL: migrasi nyata lolos dengan hitungan yang tertanam; semua mutan ditolak atau menyimpang", () => {
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { total: 14, create_table: 2, index: 6, fk: 4, trigger: 2 });
  const mutan = {
    "DROP": `${migSql}\nDROP TABLE "units";`, "UPDATE": `${migSql}\nUPDATE "units" SET "status" = 'RECEIVED';`, "DELETE": `${migSql}\nDELETE FROM "units";`, "INSERT": `${migSql}\nINSERT INTO "unit_workshop_receipts" (id) VALUES ('x');`,
    "INSERT SELECT": `${migSql}\nINSERT INTO "unit_workshop_receipts" SELECT * FROM "units";`, "TRUNCATE": `${migSql}\nTRUNCATE "units";`, "kolom pada tabel lama": `${migSql}\nALTER TABLE "units" ADD COLUMN "x" TEXT;`,
    "kolom pada tabel baru": `${migSql}\nALTER TABLE "unit_workshop_receipts" ADD COLUMN "x" TEXT;`, "ALTER COLUMN": `${migSql}\nALTER TABLE "units" ALTER COLUMN "status" TYPE TEXT;`,
    "RENAME": `${migSql}\nALTER TABLE "units" RENAME COLUMN "status" TO "s";`, "GRANT": `${migSql}\nGRANT ALL ON "unit_workshop_receipts" TO PUBLIC;`, "REVOKE": `${migSql}\nREVOKE ALL ON "units" FROM PUBLIC;`,
    "FK CASCADE units": migSql.replace('"unit_id") REFERENCES "units"("id") ON DELETE RESTRICT', '"unit_id") REFERENCES "units"("id") ON DELETE CASCADE'),
    "FK CASCADE lokasi": migSql.replace('REFERENCES "storage_locations"("id") ON DELETE RESTRICT', 'REFERENCES "storage_locations"("id") ON DELETE CASCADE'),
    "FK SET NULL koreksi": migSql.replace('REFERENCES "unit_workshop_receipts"("id") ON DELETE RESTRICT', 'REFERENCES "unit_workshop_receipts"("id") ON DELETE SET NULL'),
    "tabel liar": `${migSql}\nCREATE TABLE "x" ("id" UUID NOT NULL, CONSTRAINT "x_pkey" PRIMARY KEY ("id"));`, "indeks pada tabel lama": `${migSql}\nCREATE INDEX "x_idx" ON "units"("status");`,
    "trigger pada tabel lama": `${migSql}\nCREATE TRIGGER trg_evil BEFORE DELETE ON "units" FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();`, "blok DO liar": `${migSql}\nDO $$ BEGIN DELETE FROM "units"; END $$;`,
    "pernyataan ganda": `${migSql}\nCREATE UNIQUE INDEX "unit_workshop_receipts_unit_id_seq_key" ON "unit_workshop_receipts"("unit_id", "seq");`, "CREATE EXTENSION": `${migSql}\nCREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
    "fungsi liar": `${migSql}\nCREATE FUNCTION "evil"() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;`,
    "fungsi lama ditimpa": `${migSql}\nCREATE OR REPLACE FUNCTION production_adopsi_append_only() RETURNS TRIGGER AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;`,
    "CHECK seq dibuang": migSql.split("\n").filter((l) => !l.includes("unit_workshop_receipts_seq_chk")).join("\n"),
    "CHECK kind dibuang": migSql.split("\n").filter((l) => !l.includes("unit_workshop_receipt_corrections_kind_chk")).join("\n"),
    "CHECK alasan dibuang": migSql.split("\n").filter((l) => !l.includes("unit_workshop_receipt_corrections_reason_chk")).join("\n"),
    "CHECK nilai baru dibuang": migSql.split("\n").filter((l) => !l.includes("unit_workshop_receipt_corrections_new_chk")).join("\n"),
    "CHECK kind dilonggarkan": migSql.replace("'LOCATION','NOT_RECEIVED'", "'LOCATION','NOT_RECEIVED','LIAR'"), "CHECK alasan dilonggarkan": migSql.replace(">= 3", ">= 0"),
    "WHERE unik parsial NOT_RECEIVED dibuang": migSql.replace(` WHERE "kind" = 'NOT_RECEIVED'`, ""), "WHERE unik kunci idempotensi dibuang": migSql.replace(' WHERE "idempotency_key" IS NOT NULL', ""),
    "trigger dibuang": migSql.split("\n").filter((l) => !l.includes("unit_workshop_receipts_append_only_trg")).join("\n"),
    "trigger fungsi lain": migSql.replace("EXECUTE FUNCTION production_adopsi_append_only()", "EXECUTE FUNCTION evil_fn()"), "trigger dilonggarkan": migSql.replace('BEFORE UPDATE OR DELETE ON "unit_workshop_receipts"', 'BEFORE UPDATE ON "unit_workshop_receipts"'),
    "DISABLE TRIGGER": `${migSql}\nALTER TABLE "unit_workshop_receipts" DISABLE TRIGGER ALL;`, "DROP CONSTRAINT": `${migSql}\nALTER TABLE "units" DROP CONSTRAINT "units_pkey";`, "SET DEFAULT": `${migSql}\nALTER TABLE "unit_workshop_receipts" ALTER COLUMN "seq" SET DEFAULT 1;`,
  };
  for (const [nama, sql] of Object.entries(mutan)) { const r = pindai(sql); assert.ok(r.status !== 0 || r.stdout.trim() !== ok.stdout.trim(), `mutan '${nama}' LOLOS pemindai`); }
  assert.ok(Object.keys(mutan).length >= 30);
  assert.ok((script.match(/^harus_ditolak "/gm) ?? []).length >= 36, "skrip memuat ≥ 36 mutan negatif");
});

test("skrip rilis: gerbang sumber — ancestry live, pin migrasi, pin diff schema, tepat 1 pending, terpasang ⊆ kandidat, berkas pelindung, prasyarat fungsi append-only live", () => {
  for (const s of ['sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA"', 'sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA"', 'for A in $LIVE_ANCESTORS', 'die "isi migrasi ${n} BERBEDA dari yang diaudit',
    "SCHEMA_DIFF_SHA", "migrasi pending terhadap live saat ini bukan TEPAT migrasi rilis ini", "produksi memiliki migrasi yang TIDAK ada di kandidat", "produksi memiliki migrasi LEBIH BARU dari",
    "ada migrasi baseline yang DIUBAH/DIHAPUS", "frontend/dist — dist dibangun saat rilis", "uji negatif pemindai", "for f in $GUARD_UNCHANGED"]) assert.ok(script.includes(s), s);
  assert.ok(script.includes(`pg_proc where proname = 'production_adopsi_append_only'")" = "1"`), "fungsi append-only WAJIB sudah ada di produksi (migrasi memakainya, tidak membuatnya)");
  assert.ok(script.includes("tabel penerimaan workshop SUDAH ada di produksi"));
  assert.match(script, /backend\/src\/services\/opnameSesi\.js.*backend\/src\/services\/pergerakanSesiHitung\.js/, "berkas Opname live dijaga identik");
  assert.match(script, /^LIVE_ANCESTORS="1{40} 2{40}"$/m); assert.match(script, /^LIVE_MIG_TERAKHIR="20261222090000_stock_count_sesi_penuh"$/m);
  assert.match(script, /^GUARD_UNCHANGED=".*backend\/src\/services\/inventoryLedger\.js.*backend\/src\/services\/statusUnitLintasWorkspace\.js.*"$/m);
  assert.match(script, /^MIG_URUT_LAMA_OK=""$/m, "migrasi bernama SESUDAH baseline: tidak perlu izin urutan");
});

test("rehearsal: restore bersih, identik dengan produksi (17 kelompok), struktur tabel/FK/CHECK/indeks/trigger, uji perilaku, kode baru, sidik jari SEMUA tabel + saldo + riwayat migrasi sebelum=sesudah, fungsi append-only tak berubah, DB sementara dihapus", () => {
  for (const s of ["restore ke DB sementara TIDAK bersih", "RESTORE_WARN", "restore nyata IDENTIK dengan produksi", "TABEL_LAMA", "fp-all-sebelum", "fp-all-sesudah", "SALDO_SEBELUM", "saldo per bahan BERUBAH",
    "riwayat migrasi lama (checksum) BERUBAH", "ROLLBACK_UJI", "TIDAK_DITOLAK", "\\timing on", "terlama ${MAKS_MS} ms", "reh_drop", "migrasi MENGUBAH skema", "migrasi MENGUBAH indeks/constraint/trigger tabel lama",
    "tabel penerimaan TIDAK kosong setelah migrasi", "4 FK ON DELETE RESTRICT tidak terpasang", "FPB_N=17", "FN_SEBELUM", "fungsi production_adopsi_append_only BERUBAH oleh migrasi", "2 indeks unik parsial"]) assert.ok(script.includes(s), s);
  assert.equal((script.match(/^union all select '/gm) ?? []).length + 1, 17, "17 kelompok pembanding beku (1 select awal + 16 union)");
  assert.equal((script.match(/TIDAK_DITOLAK_/g) ?? []).length, 18, "18 penolakan");
  assert.equal((script.match(/lolos := lolos \+ 1/g) ?? []).length, 6, "6 operasi sah");
  assert.ok(script.includes('[ "$UJI_TOLAK" = "18" ]') && script.includes('[ "$UJI_LOLOS" = "6" ]'), "hitungan yang diharapkan sama dengan isi blok uji");
  const iGit = script.indexOf("rehearsal git"), iImg = script.lastIndexOf("\nrehearsal image\n"), iMig = script.indexOf('PHASE="6-migrate"'), iSw = script.indexOf('PHASE="7-switch"'), iSmoke = script.indexOf('PHASE="8b-smoke"');
  assert.ok(iGit > 0 && iImg > 0 && iMig > iImg && iSw > iMig && iSmoke > iSw, "urutan: rehearsal → migrate → switch → smoke");
  assert.ok(script.indexOf('PHASE="5-build-image"') < iImg, "rehearsal image memakai image baru");
  assert.ok(script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]') > script.indexOf('PHASE="3-backup"') && script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]') < script.indexOf('PHASE="4-release-dir"'), "--rehearsal-only: sesudah backup, sebelum release dir/build/migrasi");
  assert.ok(script.indexOf('if [ "$PREFLIGHT_ONLY" = "1" ]') < script.indexOf('PHASE="3-backup"'), "--preflight-only keluar sebelum backup");
});

test("uji perilaku di templat: blok DO dibatalkan, sentinel tidak tertangkap penanganan galat, tidak ada tulisan permanen", () => {
  const blok = script.match(/DO \$t\$[\s\S]*?END \$t\$;/)[0];
  assert.match(blok, /RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%'/);
  assert.equal((blok.match(/ERRCODE = 'P0999'/g) ?? []).length, 18, "setiap penolakan memakai sentinel P0999 (bukan P0001 yang ditangkap trigger-handler)");
  assert.doesNotMatch(blok, /\bCOMMIT\b/i); assert.doesNotMatch(blok, /WHEN OTHERS/i);
  for (const s of ["unique_violation", "check_violation", "foreign_key_violation", "sqlstate 'P0001'", "'NOT_RECEIVED'", "'LOCATION'", "idempotency_key", "DELETE FROM storage_locations", "DELETE FROM units"]) assert.ok(blok.includes(s), s);
});

test("rehearsal-penuh: build image BERTAG rehearsal (tag production utuh), skenario pada KLON, DB utama tidak berubah, guard, tes integrasi di Postgres sekali-pakai TANPA volume dan TANPA Postgres production, pembersihan", () => {
  const lanjut = script.match(/rehearsal_penuh_lanjutan\(\) \{[\s\S]*?\n\}\n/)[0];
  for (const s of ["CREATE DATABASE \\\"${KLON_DB}\\\" TEMPLATE \\\"${REH_DB}\\\"", "DB rehearsal UTAMA tetap tidak berubah oleh skenario", "GUARD_DB=\"$KLON_DB\"", "tes_jalankan \"$BK_DIR/tes-integrasi.log\" $TES_FILES", "node tests/integration/setup/runDisposable.js \"$@\"", "--tmpfs /var/lib/postgresql/data", "docker rm -f \"$PGT\"", "TEST_DB_SERVER_URL=\"postgresql://${DB_USER}:${PGPW}@${PGT}:5432/postgres?connection_limit=30\"",
    "di luar batas kebijakan ulang", '[ "$T_N" = "$TES_N_EXPECT" ]', "sekali-pakai", "KEBIJAKAN FLAKY (eksplisit, SATU kali)", "tes integrasi GAGAL lagi pada percobaan ulang", "ringkasan tes integrasi tidak terbaca", "mengulang HANYA berkas itu di DB baru (sekali)"]) assert.ok(lanjut.includes(s), s);
  assert.ok(lanjut.includes('[ "$NG" -le 3 ] && [ "$T_FAIL" -le 3 ]'), "ulang hanya bila kegagalan terbatas (≤ 3 berkas, ≤ 3 tes)");
  // errexit + pipefail: pipeline grep yang bisa kosong HARUS berujung `|| true`, kalau tidak skrip keluar diam-diam sebelum die (terjadi pada rehearsal 20 Okt)
  for (const l of lanjut.split("\n").filter((x) => /grep -(oE|E) /.test(x) && /(tes-integrasi(-ulang)?\.log)/.test(x))) assert.ok(/\|\| true/.test(l), `grep pada log tes tanpa '|| true': ${l.slice(0, 90)}`);
  assert.equal((lanjut.match(/tes_jalankan "\$BK_DIR/g) ?? []).length, 2, "tepat satu percobaan ulang (dua pemanggilan: pertama + ulang)");
  const dockerTes = lanjut.split("\n").find((l) => l.includes("runDisposable.js"));
  const mount = [...dockerTes.matchAll(/ -v "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(mount, ["$WS/scripts:/scripts:ro", "$WS/frontend/src:/frontend/src:ro"], "satu-satunya mount = arsip kandidat READ-ONLY (scripts, frontend/src); tidak ada volume production");
  assert.ok(!/--env-file|--volume|PERSIST|uploads|\/app\/data/.test(dockerTes), "tes integrasi tanpa env production dan tanpa data/uploads production (tidak menulis berkas ke data production)");
  assert.ok(dockerTes.includes("connection_limit=30"), "kolam koneksi memadai untuk tes paralel");
  assert.ok(!/\$PREV_DIR.*runDisposable|dcp .*runDisposable/.test(lanjut), "tes tidak lewat compose production");
  assert.ok(script.includes('REH_IMG="${IMG_NAME%%:*}:rehearsal-spp-${DEPLOY_SHORT}"') && script.includes('[ "$(docker image inspect -f \'{{.Id}}\' "$IMG_NAME")" = "$PREV_IMG_ID" ] || die "tag image PRODUCTION berubah'));
  assert.ok(script.includes("production TIDAK berubah: container/image/release sama"), "verifikasi production tidak berubah sesudah rehearsal-penuh");
  assert.ok(script.includes('docker rm -f "rh-spp-pg-${TS}"') && script.includes("rehearsal_spp_test_klon_${TS}"), "pembersihan Postgres sekali-pakai + klon");
});

test("bukti rehearsal-penuh adalah SYARAT rilis penuh (SHA + baseline sama, <36 jam); ditulis hanya di akhir rehearsal-penuh yang lulus", () => {
  const iGate = script.indexOf("belum ada bukti --rehearsal-penuh LULUS"), iBackup = script.indexOf('PHASE="3-backup"');
  assert.ok(iGate > 0 && iGate < iBackup, "gerbang bukti sebelum backup/migrasi");
  assert.ok(script.includes('grep -qx "BASE=${BASE_SHA}" "$MARK"') && script.includes('grep -qx "DEPLOY=${DEPLOY_SHA}" "$MARK"') && script.includes("-mmin -2160"));
  const iTulis = script.indexOf(".rehearsal-penuh-ok-status-produksi-penerimaan-${DEPLOY_SHA}\"", script.indexOf("printf 'BASE=%s"));
  assert.ok(iTulis > script.indexOf('PHASE="3d-production-tidak-berubah"'), "bukti ditulis SESUDAH verifikasi production tidak berubah");
});

test("smoke, skenario, dan kode-baru-terhadap-restore: smoke/kode BACA-SAJA; skenario menulis HANYA di klon; notifikasi lewat transport uji; penolakan di pintu sebelum data disentuh", () => {
  const smoke = baca("scripts/lib/smoke-status-produksi-penerimaan.mjs"), reh = baca("scripts/lib/rehearsal-kode-status-produksi-penerimaan.mjs"), sken = baca("scripts/lib/rehearsal-skenario-status-produksi-penerimaan.mjs");
  for (const f of [smoke, reh]) { assert.doesNotMatch(f, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/); assert.doesNotMatch(f, /\$executeRaw/); }
  assert.ok(smoke.includes("SMOKE_HASIL fail=") && reh.includes("REHEARSAL_KODE_BARU gagal=") && sken.includes("RH_SKENARIO gagal="));
  for (const s of ["tanpa token → 401", "smoke tidak menulis", "ekspor xlsx: 200", "PENERIMAAN_FISIK_WAJIB", "KOREKSI_IZIN_DITOLAK", "KOREKSI_ALASAN_WAJIB", "PENERIMAAN_TIDAK_ADA"]) assert.ok(smoke.includes(s), s);
  for (const s of ["Promise.all", "STATUS ORDER dari Produksi", "ujiNotifikasi", "KOREKSI_PERLU_JALUR_RESMI", "aktivasi V2 sesudah penerimaan", "production.unit.received-workshop", "notifikasi OFF", "notifikasi ON"]) assert.ok(sken.includes(s), s);
  assert.ok(script.includes("SMOKE_HASIL fail=0 skip="), "skrip menolak smoke tanpa ringkasan");
  assert.ok(sken.indexOf('if (FASE === "smoke")') > 0 && sken.indexOf('if (FASE === "smoke")') < sken.indexOf("async function pengguna"), "fase smoke keluar SEBELUM pengguna rehearsal dibuat (smoke tidak menulis apa pun, termasuk tabel User)");
  assert.ok(sken.includes("startTestServer(buildTestApp())") && !/import\(["']\/app\/src\/index\.js/.test(sken), "server minimal tanpa cron/worker/WAHA");
  assert.ok(sken.includes("ujiNotifikasi.transport = async") && sken.includes("ujiNotifikasi.transport = null"), "pesan pelanggan dicegat transport uji (tidak pernah ke WhatsApp)");
});

test("rollback kode terbukti pada data: image LAMA (baseline) membaca KLON berisi data penerimaan; hanya bacaan + satu probe hapus pada klon; data utuh", () => {
  const lama = baca("scripts/lib/rehearsal-kode-lama-status-produksi-penerimaan.mjs");
  for (const s of ["image ini LAMA: rute Status Produksi/Penerimaan tidak ada (404)", "RH_KODE_LAMA gagal=", "kode lama: daftar Order Produksi tetap 200", "kode lama: bacaan tidak mengubah stok maupun Run", "TETAP utuh", "klon berisi data penerimaan"]) assert.ok(lama.includes(s), s);
  assert.doesNotMatch(lama, /\.(create|update|upsert|createMany|updateMany|deleteMany|delete)\(/, "tanpa penulisan lewat Prisma");
  assert.ok(script.includes('"$PREV_IMG_ID" node /rh/rehearsal-kode-lama-status-produksi-penerimaan.mjs'), "dijalankan di image LAMA (PREV_IMG_ID), bukan image kandidat");
  assert.ok(script.indexOf("rollback kode terbukti pada data") < script.indexOf('DROP DATABASE IF EXISTS \\"${KLON_DB}\\" WITH (FORCE)" </dev/null >/dev/null 2>&1 || true\n  # 4) TES INTEGRASI'), "dijalankan sebelum klon dibuang");
});

test("rollback guard: baca-saja, informasi (exit 0), TIDAK menghapus tabel/riwayat penerimaan, menolak hanya bila tabel tidak ada", () => {
  const g = baca("scripts/rollback-guard-status-produksi-penerimaan.sh");
  assert.doesNotMatch(g.replace(/^#.*$/gm, ""), /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER)\b/i, "guard hanya membaca");
  assert.ok(g.includes("GUARD LULUS") && g.includes("exit 1") && g.includes("tidak dihapus") && g.includes("GUARD_DB"));
  assert.ok(script.includes("rollback-guard-status-produksi-penerimaan.sh") && script.includes("TIDAK menghapus tabel penerimaan"));
  assert.doesNotMatch(script.match(/rollback_instructions\(\)[\s\S]*?\nEOF/)[0], /DROP TABLE|DROP COLUMN|DELETE FROM unit_workshop/);
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/rollback-guard-status-produksi-penerimaan.sh")]).status, 0);
});

test("skrip tersimpan identik dengan hasil generator terhadap repo ini (bila repo lengkap)", { skip: !fs.existsSync(path.join(root, "scripts/release-status-produksi-penerimaan.sh")) }, () => {
  const tersimpan = baca("scripts/release-status-produksi-penerimaan.sh");
  assert.ok(tersimpan.includes(`MIGS="${migName}:${sha(migSql)}"`), "pin migrasi pada skrip tersimpan = isi migrasi di repo");
  assert.ok(tersimpan.includes(`SCAN_EXPECT='${pindai(migSql).stdout.trim()}'`), "hasil pemindai tersimpan = hasil nyata");
  assert.equal(sha(lf(tpl)).slice(0, 12), tersimpan.match(/templat sha256 ([0-9a-f]{12})…/)[1], "skrip dibangkitkan dari templat yang sekarang");
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/release-status-produksi-penerimaan.sh")]).status, 0, "sintaks bash valid");
});

test("urutan migrasi: bernama SESUDAH migrasi live terbaru; baseline terbaru dipatok; tidak boleh ada nama sama; masukan dengan migrasi lebih baru dari nama ini wajib diizinkan eksplisit", () => {
  assert.ok(migName > "20261222090000_stock_count_sesi_penuh", "migrasi penerimaan bernama setelah migrasi Opname live");
  for (const s of ['[ "$MIG_BASE_MAX" = "$LIVE_MIG_TERAKHIR" ] || die', "TIDAK tercantum di MIG_URUT_LAMA_OK", "bernama lebih LAMA dari ${MIG_BASE_MAX}; urutan tidak-berurutan sudah diaudit aman", "sudah ada di baseline"]) assert.ok(script.includes(s), s);
  // bila baseline kelak memuat migrasi lebih baru dari nama migrasi ini, MIG_URUT_LAMA_OK harus diisi (generator mengisinya otomatis) dan baseline dipatok
  assert.match(bangkitkan(masukan({ liveMigTerakhir: "20261230090000_lebih_baru" })).script, new RegExp(`^MIG_URUT_LAMA_OK="${migName}"$`, "m"));
});
