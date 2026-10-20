// Tes generator + skrip rilis Stock Opname penuh — TANPA menyentuh produksi dan tanpa jaringan. Mengunci: pin migrasi, hasil pemindai DDL (+ mutan negatif), konsistensi hitungan uji perilaku dengan templat,
// gerbang migrasi (tepat 1 pending, himpunan terpasang ⊆ kandidat), rehearsal sebelum migrate, migrate sebelum switch, smoke baca-saja, dan rollback guard yang menolak sesi model baru yang terbuka.
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
const { bangkitkan } = require(path.join(root, "scripts/gen-release-opname-penuh.cjs"));
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(root, rel), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const migName = fs.readdirSync(path.join(root, "backend/prisma/migrations")).find((n) => n.endsWith("_stock_count_sesi_penuh"));
const migRel = `backend/prisma/migrations/${migName}/migration.sql`;
const migSql = baca(migRel);
const sha = (t) => createHash("sha256").update(t).digest("hex");
const bersih = (sql) => lf(sql).split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n");
const pindai = (sql) => spawnSync(process.execPath, ["scripts/lib/scan-migrasi-opname-penuh.mjs"], { cwd: root, input: bersih(sql), encoding: "utf8" });
const tpl = baca("scripts/templates/release-opname-penuh.sh.tpl");
const LIVE_MIG = "20261220090000_gudang_koreksi_dokumen";
const masukan = (o = {}) => ({
  tplSrc: tpl, berkasList: ["backend/prisma/schema.prisma", migRel, "backend/src/routes/stockCountSesi.js", "frontend/src/pages/warehouse/WarehouseOpnameKerja.jsx"], migName, migSql,
  schemaDiffSha: "a".repeat(64), scanJs: baca("scripts/lib/scan-migrasi-opname-penuh.mjs"), scanExpect: '{"total":7}', liveMigTerakhir: LIVE_MIG,
  liveAncestors: ["1".repeat(40), "2".repeat(40)], rehNode: baca("scripts/lib/rehearsal-kode-opname-penuh.mjs"), smokeNode: baca("scripts/lib/smoke-opname-penuh.mjs"), ...o,
});
const { script, ringkasan } = bangkitkan(masukan());

test("migrasi: tepat satu migrasi Stock Opname penuh; terurut SETELAH migrasi live terakhir (Koreksi Gudang)", () => {
  assert.equal(migName, "20261222090000_stock_count_sesi_penuh");
  assert.ok(migName > LIVE_MIG, "harus sesudah migrasi live terakhir");
  const semua = fs.readdirSync(path.join(root, "backend/prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
  // Migrasi Opname sudah LIVE (abf2b75e). Satu-satunya migrasi yang boleh bernama di antara Koreksi dan Opname adalah Order Produksi adopsi Admin (20261221…, diterapkan di atas Opname dan dibuktikan aman: Prisma menerapkan migrasi pending berapa pun namanya).
  const sela = semua.filter((n) => n > LIVE_MIG && n < migName);
  assert.deepEqual(sela, ["20261221090000_production_adopsi_admin"].filter((n) => semua.includes(n)), "hanya migrasi Produksi adopsi yang boleh bernama di antara Koreksi dan Opname");
});

test("migrasi: aditif murni — hanya ALTER TABLE ADD COLUMN pada 2 tabel hitung dan 5 CHECK; tidak menyentuh ledger", () => {
  const b = bersih(migSql);
  assert.ok(!/\b(DROP|DELETE|TRUNCATE|INSERT|UPDATE|GRANT|RENAME|CREATE|stock_movements)\b/i.test(b), "tidak ada pernyataan merusak / tidak menyentuh ledger");
  assert.equal((b.match(/ALTER TABLE/g) ?? []).length, 7); assert.equal((b.match(/ADD COLUMN/g) ?? []).length, 15); assert.equal((b.match(/ADD CONSTRAINT/g) ?? []).length, 5);
  assert.ok(/"model_version" INTEGER NOT NULL DEFAULT 1/.test(b), "satu-satunya kolom NOT NULL ber-DEFAULT konstan: model_version = 1 (sesi lama = model 1)");
  assert.ok(/"observed_at" TIMESTAMP\(3\)/.test(b) && /"saved_at" TIMESTAMP\(3\)/.test(b) && !/"observed_at"[^,]*NOT NULL/.test(b), "waktu pengamatan NULL = tidak diketahui; tidak ada default waktu");
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
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, "backend/src/services/inventoryLedger.js"] })), /pelindung/);
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/prisma/schema.prisma", migRel, "backend/src/services/inventorySegregation.js"] })), /pelindung/);
  assert.throws(() => bangkitkan(masukan({ berkasList: ["backend/src/routes/stockCountSesi.js"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ migName: "bukan-migrasi" })), /nama migrasi/);
});

test("allowlist: memuat migrasi + schema + berkas opname; menolak dist, ledger posting, pemisahan tugas, Finance/Produksi", () => {
  const re = new RegExp(script.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  for (const f of [migRel, "backend/prisma/schema.prisma", "backend/src/routes/stockCountSesi.js", "scripts/release-opname-penuh.sh", "scripts/rollback-guard-opname-penuh.sh"]) assert.ok(re.test(f), f);
  for (const f of ["frontend/dist/index.html", "backend/src/services/inventoryLedger.js", "backend/src/services/inventorySegregation.js", "backend/src/routes/goodsReceipt.js", "backend/src/routes/materialIssue.js",
    "backend/src/services/finance/journal.js", "backend/src/services/productionStepCommandService.js", "backend/src/middleware/authorize.js", "backend/package.json"]) assert.ok(!re.test(f), `${f} tidak boleh lolos allowlist`);
  assert.match(script, /^GUARD_UNCHANGED=".*backend\/src\/services\/inventoryLedger\.js.*backend\/src\/services\/inventorySegregation\.js.*"$/m, "posting ledger dan pemisahan tugas dijaga identik");
});

test("pemindai DDL: migrasi nyata lolos dengan hitungan yang tertanam; semua mutan ditolak atau menyimpang", () => {
  const ok = pindai(migSql); assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { total: 7, alter_stock_counts: 1, alter_stock_count_lines: 1, check: 5 });
  const mutan = {
    "DROP": `${migSql}\nDROP TABLE "stock_counts";`, "UPDATE": `${migSql}\nUPDATE "stock_counts" SET "model_version" = 2;`, "UPDATE ledger": `${migSql}\nUPDATE "stock_movements" SET "qty" = 0;`, "DELETE": `${migSql}\nDELETE FROM "stock_count_lines";`,
    "INSERT": `${migSql}\nINSERT INTO "stock_counts" (id) VALUES ('x');`, "TRUNCATE": `${migSql}\nTRUNCATE "stock_count_lines";`, "kolom liar": `${migSql}\nALTER TABLE "stock_count_lines" ADD COLUMN "x" TEXT;`,
    "kolom ledger": `${migSql}\nALTER TABLE "stock_movements" ADD COLUMN "x" TEXT;`, "tabel lain": `${migSql}\nALTER TABLE "goods_receipts" ADD COLUMN "x" TEXT;`,
    "DEFAULT diubah": migSql.replace('"model_version" INTEGER NOT NULL DEFAULT 1', '"model_version" INTEGER NOT NULL DEFAULT 2'), "NOT NULL": migSql.replace('ADD COLUMN "scope_mode" VARCHAR(10)', 'ADD COLUMN "scope_mode" VARCHAR(10) NOT NULL'),
    "kolom dibuang": migSql.split("\n").filter((l) => !l.includes('ADD COLUMN "scope_info"')).join("\n"), "GRANT": `${migSql}\nGRANT ALL ON "stock_counts" TO PUBLIC;`,
    "ALTER COLUMN": `${migSql}\nALTER TABLE "stock_count_lines" ALTER COLUMN "counted_qty" TYPE DOUBLE PRECISION;`, "RENAME": `${migSql}\nALTER TABLE "stock_count_lines" RENAME COLUMN "counted_qty" TO "q";`,
    "indeks baru": `${migSql}\nCREATE INDEX "x_idx" ON "stock_count_lines"("origin");`, "FK baru": `${migSql}\nALTER TABLE "stock_count_lines" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("observed_by_id") REFERENCES "User"("id");`,
    "CHECK tambahan": `${migSql}\nALTER TABLE "stock_count_lines" ADD CONSTRAINT "x_chk" CHECK ("revision" > 5);`, "CHECK dibuang": migSql.split("\n").filter((l) => !l.includes("observed_pair_chk")).join("\n"),
    "CHECK dilonggarkan": migSql.replace("'MULAI', 'DINYATAKAN', 'DIKOREKSI'", "'MULAI', 'DINYATAKAN', 'DIKOREKSI', 'LIAR'"), "trigger": `${migSql}\nCREATE TRIGGER trg_evil BEFORE DELETE ON "stock_counts" FOR EACH ROW EXECUTE FUNCTION evil();`,
    "blok DO liar": `${migSql}\nDO $$ BEGIN DELETE FROM "stock_count_lines"; END $$;`, "pernyataan ganda": `${migSql}\n${migSql.split("\n").find((l) => l.includes("stock_counts_model_version_chk"))}`,
  };
  for (const [nama, sql] of Object.entries(mutan)) { const r = pindai(sql); assert.ok(r.status !== 0 || r.stdout.trim() !== ok.stdout.trim(), `mutan '${nama}' LOLOS pemindai`); }
  assert.ok(Object.keys(mutan).length >= 22);
  assert.ok((script.match(/^harus_ditolak "/gm) ?? []).length >= 30, "skrip rilis menjalankan >= 30 mutan negatif");
});

test("skrip rilis: gerbang sumber — ancestry live, pin migrasi, pin diff schema, tepat 1 pending, terpasang ⊆ kandidat, hotfix Stock Count", () => {
  for (const s of ['sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA"', 'sg merge-base --is-ancestor "$MAIN_SHA" "$DEPLOY_SHA"', 'for A in $LIVE_ANCESTORS', 'die "isi migrasi ${n} BERBEDA dari yang diaudit',
    'SCHEMA_DIFF_SHA', "migrasi pending terhadap live saat ini bukan TEPAT migrasi rilis ini", "produksi memiliki migrasi yang TIDAK ada di kandidat", "produksi memiliki migrasi LEBIH BARU dari",
    'sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA"', "ada migrasi baseline yang DIUBAH/DIHAPUS", "frontend/dist — dist dibangun saat rilis", "uji negatif pemindai",
    "kolom opname model baru SUDAH ada di produksi", "release aktif (${PREV_COMMIT}) BUKAN baseline"]) assert.ok(script.includes(s), s);
  assert.match(script, /^LIVE_ANCESTORS="1{40} 2{40}"$/m); assert.match(script, new RegExp(`^LIVE_MIG_TERAKHIR="${LIVE_MIG}"$`, "m"));
  assert.match(script, /^GUARD_UNCHANGED=".*backend\/src\/services\/adminOverrideSwitch\.js.*"$/m, "Produksi override dijaga identik");
});

test("skrip rilis: perkiraan cakupan memakai aturan dilacak fisik yang SAMA dengan kode (jejak stok), tanpa nama kategori", () => {
  const kode = baca("backend/src/services/stokFisik.js");
  for (const tabel of ["stock_movements", "goods_receipt_lines", "material_issue_lines", "stock_transfer_lines", "stok_riwayat_referensi", "stock_count_lines", "planned_bom_lines_v2", "reference_stock_value", "reference_unit_cost", "reorder_point", "reorder_qty"]) {
    assert.ok(kode.includes(tabel), `kode memakai ${tabel}`); assert.ok(script.includes(tabel), `skrip memakai ${tabel}`);
  }
  const bagian = script.match(/CAKUPAN_INFO=.*\n/)[0]; assert.doesNotMatch(bagian, /category|CONSUMABLE|RAW_MATERIAL/i, "perkiraan tidak memutuskan dari kategori");
});

test("rehearsal: restore bersih, identik dengan produksi, struktur 15 kolom + 5 CHECK, uji perilaku, kode baru, sidik jari SEMUA tabel + saldo + riwayat migrasi sebelum=sesudah, DB sementara dihapus", () => {
  for (const s of ["restore ke DB sementara TIDAK bersih", "RESTORE_WARN", "restore nyata IDENTIK dengan produksi", "TABEL_LAMA", "fp-all-sebelum", "fp-all-sesudah", "SALDO_SEBELUM", "saldo per bahan BERUBAH",
    "riwayat migrasi lama (checksum) BERUBAH", "ROLLBACK_UJI", "TIDAK_DITOLAK", "\\timing on", "terlama ${MAKS_MS} ms", "reh_drop", "migrasi MENGUBAH skema", "migrasi MENGUBAH indeks/constraint/trigger",
    "3 kolom baru stock_counts tidak sesuai", "12 kolom baru stock_count_lines tidak sesuai", "5 CHECK opname tidak terpasang", "ada sesi lama yang berubah menjadi model baru", "migrasi MENAMBAH/MENGURANGI tabel",
    "-e EXPECT_AKTIF=", "dokumen pembanding beku (pergerakan stok, saldo, jurnal, PO, tagihan, pembayaran, Produksi, aktivitas, sesi hitung lama)".slice(0, 0)]) assert.ok(script.includes(s), s);
  assert.equal((script.match(/TIDAK_DITOLAK_/g) ?? []).length, 6, "6 penolakan");
  assert.equal((script.match(/lolos := lolos \+ 1/g) ?? []).length, 4, "4 operasi sah");
  assert.ok(script.includes('[ "$UJI_TOLAK" = "6" ]') && script.includes('[ "$UJI_LOLOS" = "4" ]'), "hitungan yang diharapkan sama dengan isi blok uji");
  assert.ok(script.includes("FPB_N=16") && script.includes("'sesi_hitung'") && script.includes("'sesi_hitung_baris'"), "sidik jari beku mencakup sesi hitung lama dan barisnya (tanpa kolom baru)");
  const iGit = script.indexOf("rehearsal git"), iImg = script.lastIndexOf("rehearsal image"), iMig = script.indexOf('PHASE="6-migrate"'), iSw = script.indexOf('PHASE="7-switch"'), iSmoke = script.indexOf('PHASE="8b-smoke"');
  assert.ok(iGit > 0 && iImg > 0 && iMig > iImg && iSw > iMig && iSmoke > iSw, "urutan: rehearsal → migrate → switch → smoke");
  assert.ok(script.indexOf('PHASE="5-build-image"') < iImg, "rehearsal image memakai image baru");
  assert.ok(script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]') > script.indexOf('PHASE="3-backup"') && script.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]') < script.indexOf('PHASE="4-release-dir"'), "--rehearsal-only: sesudah backup, sebelum release dir/build/migrasi/switch");
  assert.ok(script.indexOf('if [ "$PREFLIGHT_ONLY" = "1" ]') < script.indexOf('PHASE="3-backup"'), "--preflight-only keluar sebelum backup");
});

test("uji perilaku di templat: blok DO dibatalkan, sentinel tidak tertangkap penanganan galat, tidak ada tulisan permanen", () => {
  const blok = script.match(/DO \$t\$[\s\S]*?END \$t\$;/)[0];
  assert.match(blok, /RAISE EXCEPTION 'ROLLBACK_UJI tolak=% lolos=%'/);
  assert.equal((blok.match(/ERRCODE = 'P0999'/g) ?? []).length, 6, "setiap penolakan memakai sentinel P0999");
  assert.equal((blok.match(/WHEN check_violation/g) ?? []).length, 6);
  assert.doesNotMatch(blok, /\bCOMMIT\b/i); assert.doesNotMatch(blok, /WHEN OTHERS/i);
  assert.doesNotMatch(blok, /stock_movements/i, "uji perilaku tidak menyentuh ledger");
});

test("smoke dan kode-baru-terhadap-restore: baca-saja; penolakan hanya di pintu sebelum data disentuh; sesi lama tetap terbaca", () => {
  const smoke = baca("scripts/lib/smoke-opname-penuh.mjs"), reh = baca("scripts/lib/rehearsal-kode-opname-penuh.mjs");
  for (const f of [smoke, reh]) { assert.doesNotMatch(f, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/); assert.doesNotMatch(f, /\$executeRaw/); }
  assert.ok(smoke.includes("SMOKE_HASIL fail="));
  for (const s of ["tanpa token → 401", "SESI_LAMA", "bermodel 1", "smoke tidak menulis sesi", "masuk + tidak dilacak = bahan aktif"]) assert.ok(smoke.includes(s), s);
  // satu-satunya POST/PUT/DELETE ke endpoint tulis memakai token kosong (401) atau akun TANPA izin tulis (403) — gagal sebelum data disentuh
  const tulis = [...smoke.matchAll(/api\("(POST|PUT|PATCH|DELETE)", ([^,]+), ([^,]+),/g)].map((m) => ({ metode: m[1], path: m[2], token: m[3].trim() }));
  for (const t of tulis) assert.ok(["null", "t", "tB", 'tokenUntuk(tanpaBaca)'].includes(t.token) || /tanpaBaca/.test(t.token), `panggilan tulis ${t.metode} ${t.path} memakai token ${t.token}`);
  assert.ok(tulis.filter((t) => t.token === "tB").every((t) => /scope-preview/.test(t.path)), "dengan token berizin hanya pratinjau (baca-saja)");
  assert.ok(script.includes("SMOKE_HASIL fail=0 skip="), "skrip menolak smoke tanpa ringkasan");
  assert.ok(reh.includes("REHEARSAL_KODE_BARU gagal=") && reh.includes("EXPECT_AKTIF") && reh.includes("tidak ada yang hilang diam-diam"));
});

test("rollback guard: baca-saja; menolak hanya bila ada sesi model baru terbuka; TIDAK menghapus kolom/riwayat/penyesuaian", () => {
  const g = baca("scripts/rollback-guard-opname-penuh.sh");
  assert.doesNotMatch(g.replace(/^#.*$/gm, ""), /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER)\b/i, "guard hanya membaca");
  assert.ok(g.includes("model_version = 2") && g.includes("'SCHEDULED','IN_PROGRESS','WAITING_REVIEW'") && g.includes("exit 1") && g.includes("tidak dihapus"));
  assert.ok(script.includes("rollback-guard-opname-penuh.sh") && script.includes("TIDAK menghapus kolom baru"));
  assert.doesNotMatch(script.match(/rollback_instructions\(\)[\s\S]*?\nEOF/)[0], /DROP TABLE|DROP COLUMN|DELETE FROM stock_count/);
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/rollback-guard-opname-penuh.sh")]).status, 0);
});

test("rilis ini TIDAK membuat sesi opname dan TIDAK menyentuh ledger/jurnal: tidak ada pemanggilan pembuatan sesi atau posting di skrip", () => {
  assert.doesNotMatch(script, /stock-counts["'` ]*,?\s*-d|curl[^\n]*-X POST[^\n]*stock-counts/i);
  assert.ok(script.includes("TIDAK membuat sesi") && script.includes("belum ada sesi opname model baru dibuat oleh rilis ini"));
  assert.ok(ringkasan.frontendSrc >= 1);
});

test("skrip tersimpan identik dengan hasil generator terhadap repo ini (bila repo lengkap)", { skip: !fs.existsSync(path.join(root, "scripts/release-opname-penuh.sh")) }, () => {
  const tersimpan = baca("scripts/release-opname-penuh.sh");
  assert.ok(tersimpan.includes(`MIGS="${migName}:${sha(migSql)}"`), "pin migrasi pada skrip tersimpan = isi migrasi di repo");
  assert.ok(tersimpan.includes(`SCAN_EXPECT='${pindai(migSql).stdout.trim()}'`), "hasil pemindai tersimpan = hasil nyata");
  assert.equal(sha(lf(tpl)).slice(0, 12), tersimpan.match(/templat sha256 ([0-9a-f]{12})…/)[1], "skrip dibangkitkan dari templat yang sekarang");
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/release-opname-penuh.sh")]).status, 0, "sintaks bash valid");
});

test("--rehearsal-penuh: mode terpisah, production tidak disentuh (tag image, migrasi, container), pembersih hanya untuk artefak rehearsal, tanpa env production, JWT acak", () => {
  for (const x of ['REHEARSAL_PENUH=0', '--rehearsal-penuh', '--tahan-ui=*', 'pilih SATU mode saja', '--tahan-ui hanya bersama --rehearsal-penuh', 'cleanup_penuh()', 'rehearsal_penuh_lanjutan()', 'bk_run()',
    'tag image PRODUCTION berubah selama build', 'container production berubah', 'daftar migrasi production berubah selama rehearsal', 'kolom model_version muncul di production', 'dokumen pembanding production BERUBAH selama rehearsal',
    'DB rehearsal masih tersisa di server', 'REHEARSAL PENUH SELESAI — production TIDAK diubah']) assert.ok(script.includes(x), x);
  // urutan: backup → rehearsal penuh → (keluar) sebelum release dir / migrate / switch production
  const iBackup = script.indexOf('PHASE="3-backup"'), i3c = script.indexOf('PHASE="3c-rehearsal-penuh"'), iRel = script.indexOf('PHASE="4-release-dir"'), iExit = script.indexOf("REHEARSAL PENUH SELESAI");
  assert.ok(iBackup > 0 && i3c > iBackup && iExit > i3c && iExit < iRel, "rehearsal penuh keluar SEBELUM release dir, build production, migrate, dan switch");
  const blok = script.slice(i3c, iExit);
  assert.doesNotMatch(blok, /migrate deploy|up -d|docker compose[^\n]* up|docker tag |--force-recreate/, "blok rehearsal penuh tidak memigrasi production, tidak menyalakan/men-tag container production");
  assert.match(blok, /docker build -t "\$REH_IMG"/, "image dibangun dengan tag rehearsal sendiri");
  assert.doesNotMatch(blok, /docker build -t "\$IMG_NAME"|dcp "\$NEW_DIR" build/, "tag production tidak pernah ditimpa");
  // pembersih: hanya direktori kerja di ~/release-rehearsal/op-*, SATU tag rehearsal, dan DB rehearsal_op_test_image_*
  const pembersih = script.match(/cleanup_penuh\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(pembersih, /\$HOME\/release-rehearsal\/op-/); assert.match(pembersih, /:rehearsal-op-/); assert.match(pembersih, /\^rehearsal_op_test_image_\[0-9_\]\+\$/); assert.doesNotMatch(pembersih, /rm -rf[^\n]*\$HOME"|docker system prune|docker rmi "\$IMG_NAME"/);
  // container rehearsal tidak membawa env production
  const lanjutan = script.match(/rehearsal_penuh_lanjutan\(\) \{[\s\S]*?\n\}\n/)[0]; const bk = script.match(/bk_run\(\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(lanjutan + bk, /--env-file|backend\/\.env|SANSS_PERSIST_ROOT=.*docker run/, "container rehearsal TIDAK memakai env production");
  assert.match(lanjutan, /openssl rand -hex 32/, "JWT rehearsal acak, bukan rahasia production"); assert.doesNotMatch(lanjutan, /JWT_SECRET=\$\(.*\.env/);
  assert.match(lanjutan, /-p 127\.0\.0\.1:4311:4100/, "UI hanya di loopback VPS");
  for (const x of ["S3 Selesaikan DITOLAK", "S3 tidak ada keputusan bawaan", "S4a Selesaikan MENUNGGU kunci", "S4b ronde 2", "S5 Selesaikan ganda", "S6 Selesaikan sesi penuh lulus", "GUARD MENOLAK", "GUARD LULUS"]) assert.ok(lanjutan.includes(x), x);
  assert.match(script, /rehearsal_op_test_\$\{mode\}_\$\{TS\}/, "nama DB rehearsal memuat 'test' (pagar skenario)");
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/release-opname-penuh.sh")]).status, 0);
});

test("skenario rehearsal: hanya ke DB rehearsal (pagar nama), server Express minimal tanpa cron/WAHA, token UI tidak dicetak, pembuktian pergerakan baru setelah review ada", () => {
  const sk = baca("scripts/lib/rehearsal-skenario-opname-penuh.mjs");
  assert.match(sk, /tests\/integration\/setup\/env\.js/, "memakai pagar nama DB 'test'"); assert.doesNotMatch(sk, /import\(["'][^"']*src\/index\.js/, "tidak mengimpor app production utuh (cron/WAHA/Socket.IO)");
  assert.match(sk, /buildTestApp/); assert.match(sk, /RH_UI_SIAP"\)/, "UI tidak mencetak token"); assert.doesNotMatch(sk, /console\.log\([^)]*token/i);
  for (const x of ["S1 tiga waktu", "S2 mundur + MI", "S3 pergerakan baru setelah review", "S4a kunci", "S4b serentak", "S5 klik ganda", "S6 sesi penuh", "S7 sesi terbuka untuk guard", "PERGERAKAN_SESI_BELUM_DITANDAI", "tanda-massal", "complete"]) assert.ok(sk.includes(x), x);
  assert.doesNotMatch(sk, /process\.env\.PRODUCTION|klinik_matras["']/, "tidak menyebut database production");
  const guard = baca("scripts/rollback-guard-opname-penuh.sh"); assert.match(guard, /GUARD_DB:-klinik_matras/);
  assert.match(baca("scripts/lib/smoke-opname-penuh.mjs"), /SMOKE_BASE/);
});
