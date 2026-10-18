// Tes generator + skrip rilis UX Gudang Tahap 1 — TANPA menyentuh produksi, tanpa jaringan. Mengunci: rilis TANPA migrasi/skema/dependensi, ancestry live (Koreksi Gudang wajib leluhur), berkas pelindung,
// urutan (preflight → backup → build → kode-baru-terhadap-restore → pra-switch → switch → smoke), smoke/rehearsal baca-saja, dan rollback tanpa pemulihan database.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { bangkitkan } = require(path.join(root, "scripts/gen-release-ux-gudang-tahap1.cjs"));
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(root, rel), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const berkasUji = ["backend/src/routes/gudangBeranda.js", "backend/src/services/penerimaanStatus.js", "frontend/src/pages/warehouse/WarehouseDashboard.jsx", "frontend/src/features/warehouse/penerimaan/PenerimaanDetail.jsx"];
const masukan = (o = {}) => ({
  tplSrc: baca("scripts/templates/release-ux-gudang-tahap1.sh.tpl"), berkasList: berkasUji, liveMigTerakhir: "20261220090000_gudang_koreksi_dokumen", liveMigJumlah: 260,
  liveAncestors: ["1".repeat(40), "2".repeat(40)], rehNode: baca("scripts/lib/rehearsal-kode-ux-gudang.mjs"), smokeNode: baca("scripts/lib/smoke-ux-gudang-tahap1.mjs"), ...o,
});
const { script, ringkasan } = bangkitkan(masukan());

test("generator: deterministik, tanpa placeholder tersisa, pin migrasi live = 260 (tanpa migrasi baru)", () => {
  assert.equal(bangkitkan(masukan()).script, script);
  assert.ok(!/@@[A-Z_]+@@/.test(script));
  assert.match(script, /^LIVE_MIG_TERAKHIR="20261220090000_gudang_koreksi_dokumen"; LIVE_MIG_JUMLAH="260"$/m);
  assert.equal(ringkasan.liveMigJumlah, 260);
});

test("generator menolak masukan tidak aman: prisma/migrasi, dependensi, berkas pelindung Koreksi/Finance/Produksi", () => {
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "backend/prisma/schema.prisma"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "backend/prisma/migrations/20261230000000_x/migration.sql"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "frontend/package.json"] })), /dependensi/);
  for (const f of ["backend/src/services/warehouseCorrection.js", "backend/src/routes/gudangKoreksi.js", "backend/src/services/finance/journal.js", "backend/src/services/adminOverrideSwitch.js"]) assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, f] })), /pelindung/, f);
});

test("allowlist: berkas UX lolos; migrasi/schema/dist/Koreksi inti/package tidak", () => {
  const re = new RegExp(script.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  for (const f of [...berkasUji, "scripts/release-ux-gudang-tahap1.sh"]) assert.ok(re.test(f), f);
  for (const f of ["backend/prisma/schema.prisma", "backend/prisma/migrations/20261230000000_x/migration.sql", "frontend/dist/index.html", "backend/src/services/warehouseCorrection.js", "backend/package.json", "frontend/package-lock.json"]) assert.ok(!re.test(f), `${f} tidak boleh lolos`);
});

test("gerbang: ancestry live (Koreksi wajib leluhur), TANPA prisma/dependensi/Docker, pohon prisma identik, terpasang == kandidat (0 pending), hotfix Stock Count", () => {
  for (const s of ['for A in $LIVE_ANCESTORS', 'sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA"', "backend/prisma berubah — rilis ini TANPA migrasi", 'sg rev-parse "${BASE_SHA}:backend/prisma"', "pohon backend/prisma kandidat BERBEDA",
    "TIDAK sama dengan migrasi kandidat (harus 0 pending dan 0 berlebih)", "dependensi (package.json/lock) berubah", 'sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA"', "frontend/dist — dist dibangun saat rilis", "berkas pelindung"]) assert.ok(script.includes(s), s);
  assert.doesNotMatch(script, /prisma migrate deploy/, "rilis ini TIDAK menjalankan migrate deploy");
  assert.ok(script.includes("npx prisma migrate status"), "hanya memeriksa status");
  assert.match(script, /^GUARD_UNCHANGED=".*warehouseCorrection\.js.*gudangKoreksi\.js.*"$/m, "inti Koreksi Gudang dijaga identik");
});

test("urutan: preflight keluar sebelum backup; build image sebelum rehearsal kode; rehearsal kode sebelum pra-switch dan switch; smoke sesudah switch", () => {
  const i = (s) => script.indexOf(s);
  assert.ok(i('if [ "$PREFLIGHT_ONLY" = "1" ]') < i('PHASE="3-backup"'));
  assert.ok(i('PHASE="3-backup"') < i('PHASE="4-release-dir"') && i('PHASE="5-build-image"') < i('PHASE="5b-rehearsal-kode"') && i('PHASE="5b-rehearsal-kode"') < i('PHASE="6-pra-switch"') && i('PHASE="6-pra-switch"') < i('PHASE="7-switch"') && i('PHASE="7-switch"') < i('PHASE="8b-smoke"'));
  assert.ok(script.includes("restore ke DB sementara TIDAK bersih") && script.includes("pemeriksaan kode baru MENGUBAH isi tabel (harus baca-saja)") && script.includes("fp-all-sebelum") && script.includes("reh_drop"));
  assert.ok(script.includes("dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis"));
});

test("smoke dan rehearsal kode: baca-saja (tanpa create/update/delete/executeRaw); smoke menolak ringkasan tidak lulus", () => {
  const smoke = baca("scripts/lib/smoke-ux-gudang-tahap1.mjs"), reh = baca("scripts/lib/rehearsal-kode-ux-gudang.mjs");
  for (const f of [smoke, reh]) { assert.doesNotMatch(f, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/); assert.doesNotMatch(f, /\$executeRaw/); }
  for (const s of ["SMOKE_HASIL fail=", "kembali-draft", "batalkan-tiba", "buat-ulang", "UUID tidak valid → 400", "smoke tidak menulis"]) assert.ok(smoke.includes(s), s);
  assert.ok(script.includes("SMOKE_HASIL fail=0 skip="));
  assert.ok(reh.includes("REHEARSAL_KODE_BARU gagal="));
});

test("rollback: kode saja, tanpa pemulihan database; dokumen yang dipulihkan lewat UI tetap utuh", () => {
  const blok = script.match(/rollback_instructions\(\)[\s\S]*?\nEOF/)[0];
  assert.ok(blok.includes("TANPA perubahan database") && blok.includes("rollback-pre-uxg-") === false || blok.includes("TANPA perubahan database"));
  assert.doesNotMatch(blok, /psql|gzip -dc|DROP/);
  assert.ok(script.includes('ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-uxg-${DEPLOY_SHORT}"'));
});

test("skrip tersimpan identik pada templat sekarang dan bersintaks bash valid", { skip: !fs.existsSync(path.join(root, "scripts/release-ux-gudang-tahap1.sh")) }, () => {
  const tersimpan = baca("scripts/release-ux-gudang-tahap1.sh");
  const sha = (t) => require("node:crypto").createHash("sha256").update(t).digest("hex");
  assert.equal(sha(baca("scripts/templates/release-ux-gudang-tahap1.sh.tpl")).slice(0, 12), tersimpan.match(/templat sha256 ([0-9a-f]{12})…/)[1]);
  if (punyaBash) assert.equal(spawnSync("bash", ["-n", path.join(root, "scripts/release-ux-gudang-tahap1.sh")]).status, 0);
});
