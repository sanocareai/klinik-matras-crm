// Tes generator + skrip rilis "Status produksi tidak menahan pengiriman (Route Planner)" — TANPA menyentuh produksi, tanpa jaringan.
// Mengunci: rilis TANPA migrasi/skema/dependensi, ancestry live (Gudang/Produksi/Finance wajib leluhur), berkas pelindung identik, urutan (preflight → backup → build → kode-baru-terhadap-restore → pra-switch → switch → smoke),
// smoke BACA-SAJA, rehearsal menulis HANYA di dalam transaksi yang selalu dibatalkan, guard rollback, dan konsistensi aturan (order PKR dikecualikan) di skrip, rehearsal, smoke, dan guard.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { bangkitkan } = require(path.join(root, "scripts/gen-release-route-planner-produksi.cjs"));
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(root, rel), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const berkasUji = ["backend/src/routes/armada.js", "backend/src/services/deliveryMenungguKonfirmasi.js", "frontend/src/pages/Armada.jsx"];
const masukan = (o = {}) => ({
  tplSrc: baca("scripts/templates/release-route-planner-produksi.sh.tpl"), berkasList: berkasUji, liveMigTerakhir: "20261220090000_gudang_koreksi_dokumen", liveMigJumlah: 260,
  liveAncestors: ["1".repeat(40), "2".repeat(40)], rehNode: baca("scripts/lib/rehearsal-kode-route-planner-produksi.mjs"), smokeNode: baca("scripts/lib/smoke-route-planner-produksi.mjs"), ...o,
});
const { script, ringkasan } = bangkitkan(masukan());

test("generator: deterministik, tanpa placeholder tersisa, pin migrasi live = 260 (tanpa migrasi baru)", () => {
  assert.equal(bangkitkan(masukan()).script, script);
  assert.ok(!/@@[A-Z_]+@@/.test(script));
  assert.match(script, /^LIVE_MIG_TERAKHIR="20261220090000_gudang_koreksi_dokumen"; LIVE_MIG_JUMLAH="260"$/m);
  assert.equal(ringkasan.liveMigJumlah, 260);
  assert.ok(!script.includes("\r"));
});

test("skrip hasil bangkitan: sintaks bash valid", { skip: !punyaBash }, () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "rpp-"));
  const f = path.join(tmp, "rpp.sh"); fs.writeFileSync(f, script);
  const r = spawnSync("bash", ["-n", f], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("generator menolak masukan tidak aman: prisma/migrasi, dependensi, berkas pelindung (Gudang, ledger, jurnal, tahap Produksi, penerimaan)", () => {
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "backend/prisma/schema.prisma"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "backend/prisma/migrations/20261230000000_x/migration.sql"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "frontend/package.json"] })), /dependensi/);
  for (const f of ["backend/src/services/warehouseCorrection.js", "backend/src/routes/goodsReceipt.js", "backend/src/services/inventoryLedger.js", "backend/src/services/finance/journal.js", "backend/src/services/productionStepCommandService.js", "backend/src/services/unitStageEngine.js", "backend/src/services/orderStatusSync.js"]) {
    assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, f] })), /pelindung/, f);
  }
});

test("allowlist: berkas rilis ini lolos; migrasi/schema/dist/berkas pelindung/package tidak", () => {
  const re = new RegExp(script.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  for (const f of [...berkasUji, "scripts/release-route-planner-produksi.sh", "scripts/rollback-guard-route-planner-produksi.sh"]) assert.ok(re.test(f), f);
  for (const f of ["backend/prisma/schema.prisma", "backend/prisma/migrations/20261230000000_x/migration.sql", "frontend/dist/index.html", "backend/src/routes/goodsReceipt.js", "backend/package.json", "frontend/package-lock.json", "driver-mobile/src/App.js"]) assert.ok(!re.test(f), "harus ditolak: " + f);
});

test("gerbang: ancestry live wajib leluhur, TANPA prisma/dependensi/Docker/driver-mobile, pohon prisma identik, terpasang == kandidat (0 pending), hotfix Stock Count, berkas pelindung", () => {
  for (const s of ['for A in $LIVE_ANCESTORS', 'sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA"', "backend/prisma berubah — rilis ini TANPA migrasi", 'sg rev-parse "${BASE_SHA}:backend/prisma"', "pohon backend/prisma kandidat BERBEDA",
    "TIDAK sama dengan migrasi kandidat (harus 0 pending dan 0 berlebih)", "dependensi (package.json/lock) berubah", 'sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA"', "frontend/dist — dist dibangun saat rilis", "berkas pelindung",
    "driver-mobile berubah — rilis ini tidak membawa app Driver"]) assert.ok(script.includes(s), "gerbang hilang: " + s);
  assert.doesNotMatch(script, /prisma migrate deploy/, "rilis ini TIDAK menjalankan migrate deploy");
  assert.ok(script.includes("npx prisma migrate status"), "hanya memeriksa status");
  assert.match(script, /^GUARD_UNCHANGED=".*goodsReceipt\.js.*productionStepCommandService\.js.*"$/m);
});

test("urutan: preflight keluar sebelum backup; build image sebelum rehearsal kode; rehearsal kode sebelum pra-switch dan switch; smoke sesudah switch", () => {
  const i = (s) => script.indexOf(s);
  assert.ok(i('if [ "$PREFLIGHT_ONLY" = "1" ]') > 0 && i('if [ "$PREFLIGHT_ONLY" = "1" ]') < i('PHASE="3-backup"'));
  assert.ok(i('PHASE="3-backup"') < i('PHASE="4-release-dir"') && i('PHASE="5-build-image"') < i('PHASE="5b-rehearsal-kode"') && i('PHASE="5b-rehearsal-kode"') < i('PHASE="6-pra-switch"') && i('PHASE="6-pra-switch"') < i('PHASE="7-switch"') && i('PHASE="7-switch"') < i('PHASE="8b-smoke"'));
  assert.ok(script.includes("restore ke DB sementara TIDAK bersih") && script.includes("pemeriksaan kode baru MENGUBAH isi tabel (harus baca-saja)") && script.includes("fp-all-sebelum") && script.includes("reh_drop"));
  assert.ok(script.includes("dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis"));
});

test("smoke: BACA-SAJA (tanpa create/update/delete/executeRaw; satu-satunya POST adalah penolakan sebelum menyentuh data) dan menolak ringkasan tidak lulus", () => {
  const smoke = baca("scripts/lib/smoke-route-planner-produksi.mjs");
  assert.doesNotMatch(smoke.replace(/\/\/.*$/gm, ""), /\.(create|update|updateMany|delete|deleteMany|upsert|createMany|\$executeRaw\w*)\(/);
  const post = [...smoke.matchAll(/api\("POST", "([^"]+)", ([^,]+),/g)];
  assert.ok(post.length >= 3, "uji penolakan ada");
  for (const m of post) assert.equal(m[1], "/api/armada/jobs", "POST hanya ke pembuatan job dengan token kosong/tanpa izin/unit tidak ada");
  assert.match(smoke, /unitIds: \[nol\]|unitIds: \[\]/, "penolakan memakai unit tidak ada/kosong");
  assert.match(smoke, /smoke tidak menulis/);
  assert.match(script, /SMOKE_HASIL fail=0 skip=/);
  assert.ok(script.includes("smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus"));
});

test("rehearsal kode: satu-satunya tulisan terjadi DI DALAM transaksi yang selalu dibatalkan; produksi tidak disentuh", () => {
  const reh = baca("scripts/lib/rehearsal-kode-route-planner-produksi.mjs").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(reh, /\.(create|updateMany|delete|deleteMany|upsert|createMany|\$executeRaw\w*)\(/);
  assert.ok(reh.includes("prisma.$transaction(async (tx) =>") && reh.includes("throw new Batal()"), "transaksi dibatalkan");
  const tulis = [...reh.matchAll(/tandaiRunDilepasKarenaDispatchInTx\(/g)].length;
  assert.equal(tulis, 2, "pelepasan Run hanya dipanggil dua kali, keduanya di dalam transaksi yang dibatalkan");
  const iTx = reh.indexOf("prisma.$transaction(async (tx) =>"), iBatal = reh.indexOf("throw new Batal()");
  for (const m of reh.matchAll(/tandaiRunDilepasKarenaDispatchInTx\(tx,/g)) assert.ok(m.index > iTx && m.index < iBatal, "pemanggilan di dalam transaksi");
  assert.ok(script.includes("fp-all-sebelum") && script.includes("fp-all-sesudah"), "sidik jari seluruh tabel sebelum = sesudah");
});

test("konsistensi aturan: order PKR dikecualikan (konfirmasi kesiapan fisik miliknya tetap satu-satunya jalur) di skrip, rehearsal, smoke, papan, dan pembuatan job", () => {
  assert.ok(script.includes("o.penjualan_karyawan_id is null"));
  assert.ok(baca("scripts/lib/smoke-route-planner-produksi.mjs").includes("o.penjualan_karyawan_id is null"));
  assert.ok(baca("scripts/lib/rehearsal-kode-route-planner-produksi.mjs").includes("penjualanKaryawanId: null"));
  const armada = baca("backend/src/routes/armada.js");
  assert.match(armada, /penjualanKaryawanId: null \} \}\] : \[\]\)/, "papan");
  assert.match(armada, /STATUS_PRODUKSI_BISA_DIKIRIM\.includes\(u\.status\) && !u\.order\?\.penjualanKaryawanId/, "pembuatan job");
  const siapFisik = baca("backend/src/services/deliverySiapFisik.js");
  assert.doesNotMatch(siapFisik, /"RECEIVED", "IN_PRODUCTION"/, "gerbang muat/POD PKR tidak dilonggarkan");
});

test("guard rollback: baca-saja, menolak bila ada Run dilepas karena dispatch atau job aktif berisi unit yang masih diproduksi; script rilis menunjuknya", () => {
  const guard = baca("scripts/rollback-guard-route-planner-produksi.sh");
  assert.match(guard, /default_transaction_read_only=on/);
  assert.match(guard, /DISPATCH_ROUTE_PLANNER/);
  assert.match(guard, /u\.status in \('RECEIVED','IN_PRODUCTION'\)/);
  assert.match(guard, /exit 1/);
  assert.doesNotMatch(guard.replace(/#.*$/gm, ""), /\b(insert|update|delete|truncate|drop|alter)\b/i);
  assert.ok(script.includes("rollback-guard-route-planner-produksi.sh"));
  assert.match(script, /Tidak ada perubahan database untuk dipulihkan/);
});

test("skrip tersimpan = hasil bangkitan ulang dari repo (bila sudah dibangkitkan)", { skip: !fs.existsSync(path.join(root, "scripts/release-route-planner-produksi.sh")) }, () => {
  const tersimpan = baca("scripts/release-route-planner-produksi.sh");
  assert.ok(tersimpan.includes("RILIS \"STATUS PRODUKSI TIDAK MENAHAN PENGIRIMAN"));
  assert.ok(!/@@[A-Z_]+@@/.test(tersimpan));
  assert.ok(!tersimpan.includes("\r"));
});
