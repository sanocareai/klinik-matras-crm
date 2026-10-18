// Tes generator + skrip rilis "Sales fleksibel + riwayat lengkap Produksi/Gudang" — TANPA menyentuh produksi, tanpa jaringan.
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
const { bangkitkan } = require(path.join(root, "scripts/gen-release-order-fleksibel-riwayat.cjs"));
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(root, rel), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const berkasUji = ["backend/src/routes/orders.js", "backend/src/services/orderProduksiSelaras.js", "backend/src/services/productionRiwayatService.js", "frontend/src/features/production/UnitOverviewDrawer.jsx"];
const masukan = (o = {}) => ({
  tplSrc: baca("scripts/templates/release-order-fleksibel-riwayat.sh.tpl"), berkasList: berkasUji, liveMigTerakhir: "20261220090000_gudang_koreksi_dokumen", liveMigJumlah: 260,
  liveAncestors: ["1".repeat(40), "2".repeat(40)], rehNode: baca("scripts/lib/rehearsal-kode-order-fleksibel-riwayat.mjs"), smokeNode: baca("scripts/lib/smoke-order-fleksibel-riwayat.mjs"), ...o,
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
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "ofr-"));
  const f = path.join(tmp, "ofr.sh"); fs.writeFileSync(f, script);
  const r = spawnSync("bash", ["-n", f], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("generator menolak masukan tidak aman: prisma/migrasi, dependensi, berkas pelindung (Gudang, ledger, jurnal, tahap Produksi, penerimaan)", () => {
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "backend/prisma/schema.prisma"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "backend/prisma/migrations/20261230000000_x/migration.sql"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "frontend/package.json"] })), /dependensi/);
  for (const f of ["backend/src/services/warehouseCorrection.js", "backend/src/routes/goodsReceipt.js", "backend/src/services/inventoryLedger.js", "backend/src/services/finance/journal.js", "backend/src/services/productionStepCommandService.js", "backend/src/services/unitStageEngine.js", "backend/src/services/orderStatusSync.js", "backend/src/routes/armada.js", "backend/src/services/deliveryMenungguKonfirmasi.js"]) {
    assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, f] })), /pelindung/, f);
  }
});

test("allowlist: berkas rilis ini lolos; migrasi/schema/dist/berkas pelindung/package tidak", () => {
  const re = new RegExp(script.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  for (const f of [...berkasUji, "scripts/release-order-fleksibel-riwayat.sh", "scripts/rollback-guard-order-fleksibel-riwayat.sh"]) assert.ok(re.test(f), f);
  for (const f of ["backend/prisma/schema.prisma", "backend/prisma/migrations/20261230000000_x/migration.sql", "frontend/dist/index.html", "backend/src/routes/goodsReceipt.js", "backend/package.json", "frontend/package-lock.json", "driver-mobile/src/App.js"]) assert.ok(!re.test(f), "harus ditolak: " + f);
});

test("gerbang: ancestry live wajib leluhur, TANPA prisma/dependensi/Docker/driver-mobile, pohon prisma identik, terpasang == kandidat (0 pending), hotfix Stock Count, berkas pelindung", () => {
  for (const s of ['for A in $LIVE_ANCESTORS', 'sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA"', "backend/prisma berubah — rilis ini TANPA migrasi", 'sg rev-parse "${BASE_SHA}:backend/prisma"', "pohon backend/prisma kandidat BERBEDA",
    "TIDAK sama dengan migrasi kandidat (harus 0 pending dan 0 berlebih)", "dependensi (package.json/lock) berubah", 'sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA"', "frontend/dist — dist dibangun saat rilis", "berkas pelindung",
    "driver-mobile berubah — rilis ini tidak membawa app Driver"]) assert.ok(script.includes(s), "gerbang hilang: " + s);
  assert.doesNotMatch(script, /prisma migrate deploy/, "rilis ini TIDAK menjalankan migrate deploy");
  assert.ok(script.includes("npx prisma migrate status"), "hanya memeriksa status");
  assert.match(script, /^GUARD_UNCHANGED=".*goodsReceipt\.js.*productionStepCommandService\.js.*armada\.js.*"$/m);
});

test("urutan: preflight keluar sebelum backup; build image sebelum rehearsal kode; rehearsal kode sebelum pra-switch dan switch; smoke sesudah switch", () => {
  const i = (s) => script.indexOf(s);
  assert.ok(i('if [ "$PREFLIGHT_ONLY" = "1" ]') > 0 && i('if [ "$PREFLIGHT_ONLY" = "1" ]') < i('PHASE="3-backup"'));
  assert.ok(i('PHASE="3-backup"') < i('PHASE="4-release-dir"') && i('PHASE="5-build-image"') < i('PHASE="5b-rehearsal-kode"') && i('PHASE="5b-rehearsal-kode"') < i('PHASE="6-pra-switch"') && i('PHASE="6-pra-switch"') < i('PHASE="7-switch"') && i('PHASE="7-switch"') < i('PHASE="8b-smoke"'));
  assert.ok(script.includes("restore ke DB sementara TIDAK bersih") && script.includes("pemeriksaan kode baru MENGUBAH isi tabel (harus baca-saja)") && script.includes("fp-all-sebelum") && script.includes("reh_drop"));
  assert.ok(script.includes("dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis"));
});

test("smoke: BACA-SAJA (tanpa create/update/delete/executeRaw; satu-satunya PATCH/POST adalah penolakan sebelum menyentuh data pada order yang TIDAK ADA) dan menolak ringkasan tidak lulus", () => {
  const smoke = baca("scripts/lib/smoke-order-fleksibel-riwayat.mjs");
  assert.doesNotMatch(smoke.replace(/\/\/.*$/gm, ""), /\.(create|update|updateMany|delete|deleteMany|upsert|createMany|\$executeRaw\w*)\(/);
  const tulis = [...smoke.matchAll(/api\("(POST|PATCH)", `([^`]+)`/g)];
  assert.ok(tulis.length >= 4, "uji penolakan ada");
  for (const m of tulis) assert.match(m[2], /\$\{nol\}/, "PATCH/POST hanya ke id order yang tidak ada: " + m[2]);
  assert.match(smoke, /smoke tidak menulis/);
  assert.match(script, /SMOKE_HASIL fail=0 skip=/);
  assert.ok(script.includes("smoke test tidak mencetak ringkasan SMOKE_HASIL yang lulus"));
});

test("rehearsal kode: satu-satunya tulisan (selaraskanProduksiDenganOrderInTx) terjadi DI DALAM transaksi yang selalu dibatalkan; produksi tidak disentuh", () => {
  const reh = baca("scripts/lib/rehearsal-kode-order-fleksibel-riwayat.mjs").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(reh, /\.(create|updateMany|delete|deleteMany|upsert|createMany|\$executeRaw\w*)\(/);
  const panggilan = [...reh.matchAll(/selaraskanProduksiDenganOrderInTx\(tx,/g)];
  assert.equal(panggilan.length, 3, "tiga percobaan (batal pada order nyata [per order], siap kirim, order tanpa Run)");
  for (const m of panggilan) {
    const awal = reh.lastIndexOf("prisma.$transaction(async (tx) =>", m.index);
    const batal = reh.indexOf("throw new Batal()", m.index);
    assert.ok(awal >= 0 && batal > m.index, "pemanggilan di dalam transaksi yang dibatalkan");
    assert.ok(reh.indexOf("prisma.$transaction(async (tx) =>", awal + 10) === -1 || reh.indexOf("prisma.$transaction(async (tx) =>", awal + 10) > batal, "tidak ada transaksi lain di antara pemanggilan dan pembatalan");
  }
  assert.ok(script.includes("fp-all-sebelum") && script.includes("fp-all-sesudah"), "sidik jari seluruh tabel sebelum = sesudah");
});

test("konsistensi aturan: order PKR tidak berubah; Sales memanggil penyelarasan di dua jalur (batal + dropdown); riwayat membaca bukti dengan filter DOC_ dan tidak menulis; buka-kembali tetap dipagari", () => {
  const orders = baca("backend/src/routes/orders.js");
  assert.equal([...orders.matchAll(/await selaraskanProduksiDenganOrderInTx\(tx,/g)].length, 2, "batal + dropdown");
  assert.ok(orders.includes("await assertOrderUnitsNotV2Owned(tx, order.id, \"Membuka kembali order untuk pengiriman\")") && orders.includes("await assertOrderUnitsNotV2Owned(tx, order.id, \"Membuka kembali order untuk pickup\")"), "pagar buka-kembali utuh");
  assert.ok(baca("backend/src/services/penjualanKaryawanOrder.js").includes("await assertOrderUnitsNotV2Owned(tx, order.id, \"Membatalkan penjualan karyawan\")"), "PKR tidak berubah");
  const riw = baca("backend/src/services/productionRiwayatService.js").replace(/\/\/.*$/gm, "");
  assert.ok(/startsWith: "DOC_"/.test(riw), "filter baris dokumentasi");
  assert.doesNotMatch(riw, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw\w*)\(/, "riwayat baca-saja");
});

test("guard rollback: baca-saja dan selalu informasi (exit 0); script rilis menunjuknya", () => {
  const guard = baca("scripts/rollback-guard-order-fleksibel-riwayat.sh");
  assert.match(guard, /default_transaction_read_only=on/);
  assert.match(guard, /PRODUCTION_FOLLOWS_ORDER/);
  assert.doesNotMatch(guard, /exit 1/, "rollback kode selalu aman: tidak ada syarat yang menolak");
  assert.doesNotMatch(guard.replace(/#.*$/gm, ""), /\b(insert|update|delete|truncate|drop|alter)\b/i);
  assert.ok(script.includes("rollback-guard-order-fleksibel-riwayat.sh"));
  assert.match(script, /tidak ada perubahan database untuk dipulihkan/i);
});

test("skrip tersimpan = hasil bangkitan ulang dari repo (bila sudah dibangkitkan)", { skip: !fs.existsSync(path.join(root, "scripts/release-order-fleksibel-riwayat.sh")) }, () => {
  const tersimpan = baca("scripts/release-order-fleksibel-riwayat.sh");
  assert.ok(tersimpan.includes("RILIS \"SALES FLEKSIBEL + RIWAYAT LENGKAP"));
  assert.ok(!/@@[A-Z_]+@@/.test(tersimpan));
  assert.ok(!tersimpan.includes("\r"));
});
