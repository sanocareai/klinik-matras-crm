// Skrip rilis "Pembetulan Bahan Unit Terkirim": kode-saja (tanpa migrasi/schema), allowlist hanya fitur ini, gerbang berurutan, rehearsal terisolasi dari data production, smoke baca-saja, bash lolos sintaks.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");
const skrip = baca("scripts/release-pembetulan-bahan.sh");

test("kode-saja: allowlist tanpa prisma/index.js/permissions/dependensi; memuat layanan + panel + migrasi TIDAK ada; gerbang tanpa-migrasi dipertahankan", () => {
  const allow = skrip.match(/^ALLOWED_RE='(.*)'$/m)[1].split("\\.").join(".");
  for (const harus of ["backend/src/services/pembetulanBahanUnit.js", "backend/src/routes/units.js", "backend/src/routes/pemakaianKoreksi.js", "backend/src/services/unitProvisionalUsageService.js", "backend/src/services/productionComponentReuseService.js", "frontend/src/features/production/bahan/PembetulanUnitSelesai.jsx", "frontend/src/features/production/bahan/pembetulanModel.js", "scripts/lib/rehearsal-pembetulan-bahan.mjs", "backend/src/services/finance/hargaBerlaku.js", "backend/src/services/finance/export/biaya-bahan.js", "backend/src/services/productionAdoptionService.js", "backend/src/routes/productionAdopsi.js", "frontend/src/features/production/bahan/RiwayatBahanBaru.jsx"]) assert.ok(allow.includes(harus), harus);
  for (const dilarang of ["backend/prisma", "backend/src/index.js", "backend/src/constants/permissions.js", "package.json", "docker-compose", "Dockerfile", "koreksiSaldoBahan"]) assert.ok(!allow.includes(dilarang), `ikut terbawa: ${dilarang}`);
  assert.match(skrip, /rilis ini TANPA migrasi dan TANPA perubahan/); assert.match(skrip, /schema\.prisma\/migrations berbeda dari baseline/);
});

test("gerbang berurutan; --rehearsal-only berhenti sebelum switch; nama rilis ini (tidak bocor nama rilis lain)", () => {
  const urut = ['PHASE="1-sumber"', 'PHASE="2-audit-produksi"', 'PHASE="3-backup"', 'PHASE="5-build-image"', 'PHASE="5b-rehearsal"', 'PHASE="6-tanpa-migrasi"', 'PHASE="7-switch"', 'PHASE="8-verifikasi"', 'PHASE="8b-smoke"'].map((x) => skrip.indexOf(x));
  assert.ok(urut.every((x) => x > 0) && urut.every((x, i) => i === 0 || x > urut[i - 1]), `urutan fase: ${urut}`);
  const reh = skrip.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]; then'); assert.ok(reh > urut[4] && reh < urut[5]);
  assert.match(skrip, /CAND_BRANCH="\$\{CAND_BRANCH:-fix\/pemakaian-drawer-order\}"/); assert.match(skrip, /release-pembetulan-bahan\.lock/);
  assert.ok(!/STATUS KERJA JUJUR|status-kerja-\$\{|Buka pekerjaan"; do/.test(skrip), "tidak ada sisa nama rilis dasar");
});

test("rehearsal: kode baru sebagai server terhadap restore; direktori data/uploads/dist-driver production TIDAK dipasang (diperiksa kosong sebelum uji); skenario inti ada", () => {
  assert.ok(skrip.indexOf("reh-data") < skrip.indexOf("<<'REHNODE'"), "isolasi dipasang sebelum uji");
  assert.match(skrip, /rehearsal TIDAK terisolasi dari direktori data\/uploads production/); assert.match(skrip, /"\$\{REH_VOL\[@\]\}" -e DATABASE_URL=/);
  for (const t of ["UNIT_KEMUNGKINAN_GANDA", "UNIT_SALDO_BERGESER", "UNIT_ALASAN_PEMBETULAN_WAJIB", "UNIT_TANGGAL_PEMAKAIAN_WAJIB", "UNIT_PRATINJAU_WAJIB", "UNIT_DIBATALKAN", "UNIT_BELUM_TERKIRIM", "PEMERIKSAAN="]) assert.ok(skrip.includes(t), t);
  assert.ok(skrip.includes("/^rehearsal_/.test(nm)"), "uji tulis hanya pada DB rehearsal"); assert.match(skrip, /rehearsal_pembetulan_\$\{TS\}/);
});

test("smoke pasca-switch baca-saja: penolakan sebelum menulis, tanpa jejak tulis pada unit uji; ringkasan SMOKE_HASIL dicetak", () => {
  for (const t of ["UNIT_ALASAN_PEMBETULAN_WAJIB (tidak menulis)", "UNIT_TANGGAL_PEMAKAIAN_WAJIB (tidak menulis)", "UNIT_PRATINJAU_WAJIB (transaksi dibatalkan, tidak menulis)", "TIDAK ada jejak tulis pada unit uji", "SMOKE_HASIL fail="]) assert.ok(skrip.includes(t), t);
  const smoke = baca("scripts/lib/smoke-pembetulan-bahan.mjs"); assert.ok(!/["']Idempotency-Key["']s*:/.test(smoke), "smoke tidak pernah mengirim header kunci tulis");
});

test("bash lolos sintaks", () => { const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-pembetulan-bahan.sh")], { encoding: "utf8" }); if (r.error) return; assert.equal(r.status, 0, r.stderr); });
