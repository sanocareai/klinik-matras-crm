// Tes generator + skrip rilis Koreksi Gudang — TANPA menyentuh produksi dan tanpa jaringan. Mengunci: pin migrasi, hasil pemindai DDL (+ mutan negatif), konsistensi hitungan uji perilaku dengan templat,
// gerbang migrasi (tepat 1 pending, himpunan terpasang ⊆ kandidat), rehearsal sebelum migrate, migrate sebelum switch, smoke baca-saja, rollback guard yang tidak menghapus riwayat koreksi, dan tidak ada UX Tahap 1 di rilis.
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
const { bangkitkan } = require(path.join(root, "scripts/gen-release-koreksi-gudang.cjs"));
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(root, rel), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const migName = fs.readdirSync(path.join(root, "backend/prisma/migrations")).find((n) => n.endsWith("_gudang_koreksi_dokumen"));
const migRel = `backend/prisma/migrations/${migName}/migration.sql`;
const migSql = baca(migRel);
const sha = (t) => createHash("sha256").update(t).digest("hex");
const bersih = (sql) => lf(sql).split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n");
const pindai = (sql) => spawnSync(process.execPath, ["scripts/lib/scan-migrasi-koreksi-gudang.mjs"], { cwd: root, input: bersih(sql), encoding: "utf8" });
const tpl = baca("scripts/templates/release-koreksi-gudang.sh.tpl");
const masukan = (o = {}) => ({
  tplSrc: tpl, berkasList: ["backend/prisma/schema.prisma", migRel, "backend/src/routes/gudangKoreksi.js", "frontend/src/features/warehouse/koreksi/KartuJalurKoreksi.jsx"], migName, migSql,
  schemaDiffSha: "a".repeat(64), scanJs: baca("scripts/lib/scan-migrasi-koreksi-gudang.mjs"), scanExpect: '{"total":19}', liveMigTerakhir: "20261219090000_production_admin_override_siap_kirim",
  liveAncestors: ["1".repeat(40), "2".repeat(40)], rehNode: baca("scripts/lib/rehearsal-kode-koreksi-gudang.mjs"), smokeNode: baca("scripts/lib/smoke-koreksi-gudang.mjs"), ...o,
});
const { script, ringkasan } = bangkitkan(masukan());

test("migrasi: tepat satu nama migrasi Koreksi Gudang; terurut SETELAH migrasi Produksi override yang sudah live", () => {
  assert.equal(migName, "20261220090000_gudang_koreksi_dokumen");
  assert.ok(migName > "20261219090000_production_admin_override_siap_kirim", "harus sesudah migrasi live terakhir");
  const semua = fs.readdirSync(path.join(root, "backend/prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
  assert.equal(semua.filter((n) => n > "20261219090000_production_admin_override_siap_kirim").join(","), migName, "tidak ada migrasi lain yang menyelip/mengikuti");
});

test("generator: pin sha256 isi migrasi (LF) tertanam; hasil bangkit deterministik", () => {
  assert.ok(script.includes(`MIGS="${migName}:${sha(migSql)}"`));
  assert.equal(ringkasan.migSha, sha(migSql));
  assert.equal(bangkitkan(masukan()).script, script, "bangkit ulang dengan masukan sama = identik");
  assert.ok(!/@@[A-Z_]+@@/.test(script), "tidak ada placeholder tersisa");
});

test("generator: menolak masukan tidak aman (prisma lain, dependensi, berkas pelindung, tanpa migrasi)", () => {
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, "backend/prisma/migrations/20261230000000_liar/migration.sql"] })), /prisma lain/);
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, "backend/package.json"] })), /dependensi/);
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, "backend/src/routes/stockCount.js"] })), /pelindung/);
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/src/routes/gudangKoreksi.js"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ migName: "bukan-migrasi" })), /nama migrasi/);
});

test("allowlist: memuat migrasi + schema + berkas koreksi; menolak dist, kode UX Tahap 1, dan berkas Finance/Produksi", () => {
  const re = new RegExp(script.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  for (const f of [migRel, "backend/prisma/schema.prisma", "backend/src/routes/gudangKoreksi.js", "scripts/release-koreksi-gudang.sh", "scripts/rollback-guard-koreksi-gudang.sh"]) assert.ok(re.test(f), f);
  for (const f of ["frontend/dist/index.html", "frontend/src/pages/warehouse/WarehouseDashboard.jsx", "frontend/src/features/warehouse/penerimaan/PenerimaanDetail.jsx", "backend/src/routes/gudangBeranda.js", "backend/src/services/penerimaanStatus.js",
    "backend/src/services/finance/journal.js", "backend/src/services/productionStepCommandService.js", "backend/package.json"]) assert.ok(!re.test(f), `${f} tidak boleh lolos allowlist`);
});

test("pemindai DDL: migrasi nyata lolos dengan hitungan yang tertanam; semua mutan ditolak atau menyimpang", () => {
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).total, 19); assert.equal(ok.stdout.trim(), JSON.parse(JSON.stringify(ok.stdout.trim())));
  const mutan = {
    "DROP": `${migSql}\nDROP TABLE "stock_movements";`, "UPDATE": `${migSql}\nUPDATE "stock_movements" SET "qty" = 0;`, "DELETE": `${migSql}\nDELETE FROM "stock_movements";`,
    "INSERT": `${migSql}\nINSERT INTO "warehouse_corrections" (id) VALUES ('x');`, "TRUNCATE": `${migSql}\nTRUNCATE "stock_movements";`, "kolom liar": `${migSql}\nALTER TABLE "stock_movements" ADD COLUMN "x" TEXT;`,
    "tabel lain": `${migSql}\nALTER TABLE "goods_receipts" ADD COLUMN "x" TEXT;`, "NOT NULL": migSql.replace('ADD COLUMN "correction_id" UUID', 'ADD COLUMN "correction_id" UUID NOT NULL'),
    "DEFAULT": migSql.replace('ADD COLUMN "corrects_movement_id" UUID', 'ADD COLUMN "corrects_movement_id" UUID DEFAULT gen_random_uuid()'), "GRANT": `${migSql}\nGRANT ALL ON "warehouse_corrections" TO PUBLIC;`,
    "ALTER COLUMN": `${migSql}\nALTER TABLE "stock_movements" ALTER COLUMN "qty" TYPE BIGINT;`, "RENAME": `${migSql}\nALTER TABLE "stock_movements" RENAME COLUMN "qty" TO "q";`,
    "FK CASCADE": migSql.replace('REFERENCES "warehouse_corrections"("id") ON DELETE RESTRICT', 'REFERENCES "warehouse_corrections"("id") ON DELETE CASCADE'),
    "trigger pada stock_movements": `${migSql}\nCREATE TRIGGER trg_evil BEFORE DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION warehouse_corrections_append_only();`,
    "blok DO liar": `${migSql}\nDO $$ BEGIN DELETE FROM "stock_movements"; END $$;`, "pernyataan ganda": `${migSql}\nCREATE INDEX "stock_movements_correction_id_idx" ON "stock_movements"("correction_id");`,
    "CHECK dibuang": migSql.split("\n").filter((l) => !l.includes("warehouse_corrections_alasan_chk")).join("\n"), "trigger dibuang": migSql.split("\n").filter((l) => !l.includes("warehouse_corrections_append_only_trg")).join("\n"),
  };
  for (const [nama, sql] of Object.entries(mutan)) { const r = pindai(sql); assert.ok(r.status !== 0 || r.stdout.trim() !== ok.stdout.trim(), `mutan '${nama}' LOLOS pemindai`); }
  assert.ok(Object.keys(mutan).length >= 18);
});

test("skrip rilis: gerbang sumber — ancestry live, pin migrasi, pin diff schema, tepat 1 pending, terpasang ⊆ kandidat, hotfix Stock Count", () => {
  for (const s of ['sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA"', 'sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA"', 'for A in $LIVE_ANCESTORS', 'die "isi migrasi ${n} BERBEDA dari yang diaudit',
    'SCHEMA_DIFF_SHA', "migrasi pending terhadap live saat ini bukan TEPAT migrasi rilis ini", "produksi memiliki migrasi yang TIDAK ada di kandidat", "produksi memiliki migrasi LEBIH BARU dari",
    'sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA"', "ada migrasi baseline yang DIUBAH/DIHAPUS", "frontend/dist — dist dibangun saat rilis", "uji negatif pemindai"]) assert.ok(script.includes(s), s);
  assert.match(script, /^LIVE_ANCESTORS="1{40} 2{40}"$/m); assert.match(script, /^LIVE_MIG_TERAKHIR="20261219090000_production_admin_override_siap_kirim"$/m);
  assert.match(script, /^GUARD_UNCHANGED=".*backend\/src\/services\/adminOverrideSwitch\.js.*"$/m, "Produksi override dijaga identik");
});

test("rehearsal: restore bersih (exit + error), identik dengan produksi, struktur kolom/FK/CHECK/indeks/trigger, uji perilaku, kode baru, sidik jari SEMUA tabel + saldo + riwayat migrasi sebelum=sesudah, DB sementara dihapus", () => {
  for (const s of ["restore ke DB sementara TIDAK bersih", "RESTORE_WARN", "restore nyata IDENTIK dengan produksi", "TABEL_LAMA", "fp-all-sebelum", "fp-all-sesudah", "SALDO_SEBELUM", "saldo per bahan BERUBAH",
    "riwayat migrasi lama (checksum) BERUBAH", "ROLLBACK_UJI", "TIDAK_DITOLAK", "\\timing on", "terlama ${MAKS_MS} ms", "reh_drop", "migrasi MENGUBAH skema", "migrasi MENGUBAH indeks/constraint/trigger", "mcp_hub_readonly masih punya SELECT",
    "warehouse_corrections TIDAK kosong setelah migrasi", "dokumen pembanding beku (stok, saldo, jurnal, PO, tagihan, pembayaran, Produksi) berubah"]) assert.ok(script.includes(s), s);
  assert.equal((script.match(/TIDAK_DITOLAK_/g) ?? []).length, 16, "16 penolakan");
  assert.equal((script.match(/lolos := lolos \+ 1/g) ?? []).length, 4, "4 operasi sah");
  assert.ok(script.includes('[ "$UJI_TOLAK" = "16" ]') && script.includes('[ "$UJI_LOLOS" = "4" ]'), "hitungan yang diharapkan sama dengan isi blok uji");
  const iGit = script.indexOf("rehearsal git"), iImg = script.indexOf("rehearsal image"), iMig = script.indexOf('PHASE="6-migrate"'), iSw = script.indexOf('PHASE="7-switch"'), iSmoke = script.indexOf('PHASE="8b-smoke"');
  assert.ok(iGit > 0 && iImg > 0 && iMig > iImg && iSw > iMig && iSmoke > iSw, "urutan: rehearsal → migrate → switch → smoke");
  assert.ok(script.indexOf('PHASE="5-build-image"') < iImg, "rehearsal image memakai image baru");
  assert.ok(script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]') > script.indexOf('PHASE="3-backup"') && script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]') < script.indexOf('PHASE="4-release-dir"'), "--rehearsal-only: sesudah backup, sebelum release dir/build/migrasi");
  assert.ok(script.indexOf('if [ "$PREFLIGHT_ONLY" = "1" ]') < script.indexOf('PHASE="3-backup"'), "--preflight-only keluar sebelum backup");
});

test("uji perilaku di templat: blok DO dibatalkan, sentinel tidak tertangkap penanganan galat, tidak ada tulisan permanen", () => {
  const blok = script.match(/DO \$t\$[\s\S]*?END \$t\$;/)[0];
  assert.match(blok, /RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%'/);
  assert.equal((blok.match(/ERRCODE = 'P0999'/g) ?? []).length, 16, "setiap penolakan memakai sentinel P0999 (bukan P0001 yang ditangkap trigger-handler)");
  assert.doesNotMatch(blok, /\bCOMMIT\b/i);
  assert.doesNotMatch(blok, /WHEN OTHERS/i);
});

test("smoke dan kode-baru-terhadap-restore: baca-saja; penolakan hanya di pintu sebelum data disentuh", () => {
  const smoke = baca("scripts/lib/smoke-koreksi-gudang.mjs"), reh = baca("scripts/lib/rehearsal-kode-koreksi-gudang.mjs");
  for (const f of [smoke, reh]) { assert.doesNotMatch(f, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/); assert.doesNotMatch(f, /\$executeRaw/); }
  assert.ok(smoke.includes("SMOKE_HASIL fail="));
  for (const s of ["tanpa token → 401", "Idempotency-Key", "TIPE_TIDAK_DIKENAL", "jumlah koreksi tidak berubah oleh smoke"]) assert.ok(smoke.includes(s), s);
  assert.ok(script.includes("SMOKE_HASIL fail=0 skip="), "skrip menolak smoke tanpa ringkasan");
  assert.ok(reh.includes("REHEARSAL_KODE_BARU gagal="));
});

test("rollback guard: baca-saja, menolak hanya bila ada koreksi menunggu, TIDAK menghapus tabel/kolom/riwayat koreksi", () => {
  const g = baca("scripts/rollback-guard-koreksi-gudang.sh");
  assert.doesNotMatch(g.replace(/^#.*$/gm, ""), /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER)\b/i, "guard hanya membaca");
  assert.ok(g.includes("PENDING_APPROVAL") && g.includes("exit 1") && g.includes("tidak dihapus"));
  assert.ok(script.includes("rollback-guard-koreksi-gudang.sh") && script.includes("TIDAK menghapus riwayat koreksi"));
  assert.doesNotMatch(script.match(/rollback_instructions\(\)[\s\S]*?\nEOF/)[0], /DROP TABLE|DROP COLUMN|DELETE FROM warehouse_corrections/);
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/rollback-guard-koreksi-gudang.sh")]).status, 0);
});

test("rilis Koreksi TIDAK membawa UX Tahap 1 (rilis berikutnya)", () => {
  assert.ok(!script.includes("penerimaanStatus") && !script.includes("gudangBeranda") && !script.includes("PenerimaanDetail") && !script.includes("Beranda Gudang"));
  const fe = ringkasan.frontendSrc; assert.ok(fe >= 1);
});

test("skrip tersimpan identik dengan hasil generator terhadap repo ini (bila repo lengkap)", { skip: !fs.existsSync(path.join(root, "scripts/release-koreksi-gudang.sh")) }, () => {
  const tersimpan = baca("scripts/release-koreksi-gudang.sh");
  assert.ok(tersimpan.includes(`MIGS="${migName}:${sha(migSql)}"`), "pin migrasi pada skrip tersimpan = isi migrasi di repo");
  assert.ok(tersimpan.includes(`SCAN_EXPECT='${pindai(migSql).stdout.trim()}'`), "hasil pemindai tersimpan = hasil nyata");
  assert.equal(sha(lf(tpl)).slice(0, 12), tersimpan.match(/templat sha256 ([0-9a-f]{12})…/)[1], "skrip dibangkitkan dari templat yang sekarang");
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/release-koreksi-gudang.sh")]).status, 0, "sintaks bash valid");
});
