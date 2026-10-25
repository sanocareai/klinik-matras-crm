// Tes generator + skrip rilis UX Gudang Tahap 3 — TANPA menyentuh produksi, tanpa jaringan. Mengunci: rilis TANPA migrasi/skema/dependensi, ancestry live (Tahap 1 + manifest wajib leluhur), berkas pelindung (ledger, jurnal, izin, Produksi),
// urutan (preflight → [rehearsal-only] → backup → build → kode-baru-terhadap-restore → pra-switch → switch → smoke), smoke/rehearsal baca-saja, sidik jari beku mencakup stok/movement/reservasi/dokumen/koreksi/Finance/Produksi, dan rollback tanpa pemulihan database.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { bangkitkan } = require(path.join(root, "scripts/gen-release-ux-gudang-tahap3.cjs"));
const lf = (t) => t.replace(/\r\n/g, "\n");
const baca = (rel) => lf(fs.readFileSync(path.join(root, rel), "utf8"));
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
const berkasUji = ["backend/src/routes/goodsReceipt.js", "backend/src/services/penerimaanStatus.js", "frontend/src/features/warehouse/penerimaan/PenerimaanDetail.jsx", "frontend/src/api.js"];
const masukan = (o = {}) => ({
  tplSrc: baca("scripts/templates/release-ux-gudang-tahap3.sh.tpl"), berkasList: berkasUji, liveMigTerakhir: "20261220090000_gudang_koreksi_dokumen", liveMigJumlah: 260,
  liveAncestors: ["1".repeat(40), "2".repeat(40)], rehNode: baca("scripts/lib/rehearsal-kode-ux-gudang-tahap3.mjs"), smokeNode: baca("scripts/lib/smoke-ux-gudang-tahap3.mjs"), ...o,
});
const { script, ringkasan } = bangkitkan(masukan());

test("generator: deterministik, tanpa placeholder tersisa, pin migrasi live = 260 (tanpa migrasi baru)", () => {
  assert.equal(bangkitkan(masukan()).script, script);
  assert.ok(!/@@[A-Z_]+@@/.test(script));
  assert.match(script, /^LIVE_MIG_TERAKHIR="20261220090000_gudang_koreksi_dokumen"; LIVE_MIG_JUMLAH="260"$/m);
  assert.equal(ringkasan.liveMigJumlah, 260);
});

test("generator menolak masukan tidak aman: prisma/migrasi, dependensi, berkas pelindung (ledger, jurnal posting, izin, Produksi command, Koreksi)", () => {
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "backend/prisma/schema.prisma"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "backend/prisma/migrations/20261230000000_x/migration.sql"] })), /prisma/);
  assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, "frontend/package.json"] })), /dependensi/);
  for (const f of ["backend/src/services/inventoryLedger.js", "backend/src/services/finance/posting/inventory.js", "backend/src/constants/permissions.js", "backend/src/services/productionMaterialIssueCommandService.js", "backend/src/services/warehouseCorrection.js", "backend/src/services/inventorySegregation.js"])
    assert.throws(() => bangkitkan(masukan({ berkasList: [...berkasUji, f] })), /pelindung/, f);
});

test("allowlist: berkas UX Tahap 3 lolos; migrasi/schema/dist/ledger/package tidak", () => {
  const re = new RegExp(script.match(/^ALLOWED_RE='(.*)'$/m)[1]);
  for (const f of [...berkasUji, "scripts/release-ux-gudang-tahap3.sh"]) assert.ok(re.test(f), f);
  for (const f of ["backend/prisma/schema.prisma", "backend/prisma/migrations/20261230000000_x/migration.sql", "frontend/dist/index.html", "backend/src/services/inventoryLedger.js", "backend/package.json", "frontend/package-lock.json"]) assert.ok(!re.test(f), f);
});

test("gerbang: ancestry live, TANPA prisma/dependensi/Docker, pohon prisma identik, terpasang == kandidat (0 pending), hotfix Stock Count, pelindung identik", () => {
  for (const s of ['for A in $LIVE_ANCESTORS', 'sg merge-base --is-ancestor "$BASE_SHA" "$DEPLOY_SHA"', "backend/prisma berubah — rilis ini TANPA migrasi", 'sg rev-parse "${BASE_SHA}:backend/prisma"', "TIDAK sama dengan migrasi kandidat (harus 0 pending dan 0 berlebih)",
    "dependensi (package.json/lock) berubah", 'sg merge-base --is-ancestor "$HOTFIX_STOCK_COUNT" "$DEPLOY_SHA"', "frontend/dist — dist dibangun saat rilis", "release aktif (${PREV_COMMIT}) BUKAN baseline"]) assert.ok(script.includes(s), s);
  assert.doesNotMatch(script, /prisma migrate deploy/, "rilis ini TIDAK menjalankan migrate deploy");
  assert.ok(script.includes("npx prisma migrate status"));
  assert.match(script, /^GUARD_UNCHANGED=".*inventoryLedger\.js.*finance\/posting\/inventory\.js.*productionMaterialIssueCommandService\.js.*"$/m);
  assert.match(script, /^LIVE_ANCESTORS="1{40} 2{40}"$/m);
});

test("sidik jari beku mencakup stok, movement, reservasi (V1 per bahan + V2), dokumen Gudang & barisnya, koreksi, Finance (jurnal, valuasi, PO, tagihan, pembayaran), Produksi, aktivitas", () => {
  for (const k of ["pergerakan_stok", "saldo_per_bahan", "reservasi_v1_per_bahan", "reservasi_produksi_v2", "pengeluaran_material_baris", "transfer_stok_baris", "opname_baris", "restok", "barang_rusak", "retur", "penyesuaian", "koreksi", "jurnal_baris", "valuasi_pergerakan", "po", "tagihan_supplier", "pembayaran_supplier", "run_produksi_v2", "event_aktivitas"])
    assert.ok(script.includes(`select '${k}'`), k);
  assert.match(script, /^FPB_N=28$/m);
  const n = (script.match(/\nunion all select '/g) ?? []).length + (script.match(/\nselect 'pergerakan_stok'/g) ?? []).length;
  assert.equal(n, 28, "jumlah kelompok sidik jari = FPB_N");
});

test("urutan: preflight keluar sebelum backup; rehearsal-only (tanpa release dir/switch/tag latest) sebelum jalur penuh; build image sebelum rehearsal kode; rehearsal sebelum pra-switch dan switch; smoke sesudah switch", () => {
  const i = (s) => script.indexOf(s);
  assert.ok(i('if [ "$PREFLIGHT_ONLY" = "1" ]') < i('if [ "$REHEARSAL_ONLY" = "1" ]; then\n  PHASE="3-backup-rehearsal"'));
  assert.ok(i('PHASE="3-backup-rehearsal"') < i('PHASE="3-backup"') && i('PHASE="3-backup"') < i('PHASE="4-release-dir"') && i('PHASE="5-build-image"') < i("\nrehearsal_kode   #") && i("\nrehearsal_kode   #") < i('PHASE="6-pra-switch"') && i('PHASE="6-pra-switch"') < i('PHASE="7-switch"') && i('PHASE="7-switch"') < i('PHASE="8b-smoke"'));
  const blok = script.slice(i('PHASE="3-backup-rehearsal"'), i('PHASE="3-backup"'));
  assert.ok(blok.includes('docker build -q -t "$REH_IMG"') && blok.includes("tag latest bergeser") && blok.includes("exit 0"));
  assert.doesNotMatch(blok, /docker tag |compose[^\n]*\bup\b|mkdir "\$NEW_DIR"|docker compose[^\n]*build/, "rehearsal-only tidak menggeser latest, tidak membuat release dir, tidak switch");
  assert.ok(script.includes("restore ke DB sementara TIDAK bersih") && script.includes("pemeriksaan kode baru MENGUBAH isi tabel (harus baca-saja)") && script.includes("fp-all-sebelum") && script.includes("reh_drop"));
  assert.ok(script.includes("dokumen PEMBANDING (beku sebelum switch) BERUBAH selama rilis"));
});

test("smoke dan rehearsal kode: baca-saja (tanpa create/update/delete/executeRaw); menguji pintu baru tanpa menyentuh data; menolak ringkasan tidak lulus", () => {
  const smoke = baca("scripts/lib/smoke-ux-gudang-tahap3.mjs"), reh = baca("scripts/lib/rehearsal-kode-ux-gudang-tahap3.mjs");
  for (const f of [smoke, reh]) { assert.doesNotMatch(f, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/); assert.doesNotMatch(f, /\$executeRaw/); }
  for (const s of ["SMOKE_HASIL fail=", "/isi", "/kembalikan", "/buat-ulang", "/selisih", "REVISI_WAJIB", "JENIS_TIDAK_VALID", "ALASAN_TIDAK_VALID", "UUID tidak valid → 400", "dokumen tidak ada → 404", "smoke tidak menulis"]) assert.ok(smoke.includes(s), s);
  assert.ok(script.includes("SMOKE_HASIL fail=0 skip="));
  for (const s of ["REHEARSAL_KODE_BARU gagal=", "reserved dari kode baru", "selisih nyata terbuka", "milik Produksi V2"]) assert.ok(reh.includes(s), s);
});

test("rollback: kode saja, tanpa pemulihan database; tag rollback-pre-uxg3", () => {
  const blok = script.match(/rollback_instructions\(\)[\s\S]*?\nEOF/)[0];
  assert.ok(blok.includes("TANPA perubahan database")); assert.doesNotMatch(blok, /psql|gzip -dc|DROP/);
  assert.ok(script.includes('ROLLBACK_TAG="${IMG_NAME%%:*}:rollback-pre-uxg3-${DEPLOY_SHORT}"'));
});

test("skrip tersimpan identik pada templat sekarang dan bersintaks bash valid", { skip: !fs.existsSync(path.join(root, "scripts/release-ux-gudang-tahap3.sh")) }, () => {
  const tersimpan = baca("scripts/release-ux-gudang-tahap3.sh");
  const sha = (t) => require("node:crypto").createHash("sha256").update(t).digest("hex");
  assert.equal(sha(baca("scripts/templates/release-ux-gudang-tahap3.sh.tpl")).slice(0, 12), tersimpan.match(/templat sha256 ([0-9a-f]{12})…/)[1]);
  if (punyaBash) { const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), "cek-sintaks-")); const tmp = path.join(dirTmp, "rilis.sh"); try { fs.writeFileSync(tmp, tersimpan); assert.equal(spawnSync("bash", ["-n", tmp]).status, 0); } finally { fs.rmSync(dirTmp, { recursive: true, force: true }); } }
});
