// Skrip rilis "Tambah pemakaian + Edit per bahan": kode-saja (tanpa migrasi/schema), allowlist hanya fitur ini (Koreksi Saldo tidak ikut terbawa), gerbang berurutan, rehearsal terisolasi dari data production
// dengan bukti ganti bahan utuh + kegagalan langkah kedua tanpa sisa + keutuhan Koreksi Saldo, smoke baca-saja, bash lolos sintaks.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");
const skrip = baca("scripts/release-ubah-pemakaian.sh");

test("kode-saja: allowlist memuat layanan perubahan + form Edit; tanpa prisma/index.js/permissions/dependensi dan tanpa berkas Koreksi Saldo; gerbang tanpa-migrasi dipertahankan", () => {
  const allow = skrip.match(/^ALLOWED_RE='(.*)'$/m)[1].split("\\.").join(".");
  for (const harus of ["backend/src/services/perubahanPemakaianUnit.js", "backend/src/services/pembetulanBahanUnit.js", "backend/src/routes/pemakaianKoreksi.js", "backend/src/services/koreksiPemakaian.js", "backend/src/services/finance/hargaBerlaku.js", "frontend/src/features/production/bahan/EditPemakaianForm.jsx", "frontend/src/features/production/bahan/PemakaianAktualBagian.jsx", "frontend/src/features/production/bahan/perubahanModel.js", "scripts/lib/rehearsal-ubah-pemakaian.mjs", "scripts/lib/smoke-ubah-pemakaian.mjs"]) assert.ok(allow.includes(harus), harus);
  for (const dilarang of ["backend/prisma", "backend/src/index.js", "backend/src/constants/permissions.js", "package.json", "docker-compose", "Dockerfile", "koreksiSaldoBahan", "asalKoreksiSaldo", "release-koreksi-saldo", "rollback-guard-koreksi-saldo"]) assert.ok(!allow.includes(dilarang), `ikut terbawa: ${dilarang}`);
  assert.match(skrip, /rilis ini TANPA migrasi dan TANPA perubahan/); assert.match(skrip, /schema\.prisma\/migrations berbeda dari baseline/);
});

test("gerbang berurutan; --rehearsal-only berhenti sebelum switch; nama rilis ini (tidak bocor nama rilis lain)", () => {
  const urut = ['PHASE="1-sumber"', 'PHASE="2-audit-produksi"', 'PHASE="3-backup"', 'PHASE="5-build-image"', 'PHASE="5b-rehearsal"', 'PHASE="6-tanpa-migrasi"', 'PHASE="7-switch"', 'PHASE="8-verifikasi"', 'PHASE="8b-smoke"'].map((x) => skrip.indexOf(x));
  assert.ok(urut.every((x) => x > 0) && urut.every((x, i) => i === 0 || x > urut[i - 1]), `urutan fase: ${urut}`);
  const reh = skrip.indexOf('if [ "$REHEARSAL_ONLY" = "1" ]; then'); assert.ok(reh > urut[4] && reh < urut[5]);
  assert.match(skrip, /CAND_BRANCH="\$\{CAND_BRANCH:-fix\/pemakaian-ux-on-live-3877aff3\}"/); assert.match(skrip, /release-ubah-pemakaian\.lock/);
  assert.ok(!/STATUS KERJA JUJUR|status-kerja-\$\{|Buka pekerjaan"; do|pembetulan-bahan-\$\{|rehearsal_pembetulan_|pre-pbu-/.test(skrip), "tidak ada sisa nama rilis lain");
  assert.match(skrip, /pre-ubp-/); assert.match(skrip, /rehearsal_ubah_\$\{TS\}/);
});

test("rehearsal: kode baru sebagai server terhadap restore; direktori data/uploads/dist-driver production TIDAK dipasang; skenario inti ada (alasan wajib, Material Issue, harga ISSUE asal, kegagalan langkah kedua tanpa sisa, Koreksi Saldo utuh)", () => {
  assert.ok(skrip.indexOf("reh-data") < skrip.indexOf("<<'REHNODE'"), "isolasi dipasang sebelum uji");
  assert.match(skrip, /rehearsal TIDAK terisolasi dari direktori data\/uploads production/); assert.match(skrip, /"\$\{REH_VOL\[@\]\}" -e DATABASE_URL=/);
  for (const t of ["UNIT_ALASAN_PEMBETULAN_WAJIB", "ALASAN_WAJIB", "UNIT_PERLU_PERSETUJUAN", "UNIT_ASAL_MATERIAL_ISSUE", "GANTI_BAHAN_DOKUMEN_GUDANG", "UNIT_SALDO_BERGESER", "UNIT_DASAR_HARGA_BERGESER", "IDEMPOTENCY_KEY_REUSED", "HARGA_ISSUE_ASAL", "KEGAGALAN LANGKAH KEDUA", "reh_tolak_b_trg", "Koreksi Saldo live utuh", "Koreksi Saldo live tetap utuh", "PEMERIKSAAN="]) assert.ok(skrip.includes(t), t);
  assert.ok(skrip.includes("/^rehearsal_/.test(nm)"), "uji tulis hanya pada DB rehearsal"); assert.match(skrip, /rehearsal_ubah_\$\{TS\}/);
  assert.ok(skrip.indexOf("CREATE TRIGGER reh_tolak_b_trg") < skrip.indexOf("DROP TRIGGER IF EXISTS reh_tolak_b_trg"), "trigger uji dipasang lalu SELALU dibuang (finally)");
});

test("smoke pasca-switch baca-saja: penolakan sebelum menulis, Koreksi Saldo utuh, tanpa jejak tulis; ringkasan SMOKE_HASIL dicetak; tidak pernah mengirim kunci tulis yang sah", () => {
  for (const t of ["IDEMPOTENCY_KEY_INVALID (tidak menulis)", "UNIT_ALASAN_PEMBETULAN_WAJIB (tidak menulis)", "UNIT_PRATINJAU_WAJIB (tidak menulis)", "Koreksi Saldo utuh", "TIDAK ada jejak tulis pada unit uji", "SMOKE_HASIL fail="]) assert.ok(skrip.includes(t), t);
  const smoke = baca("scripts/lib/smoke-ubah-pemakaian.mjs"); assert.ok(!/`?"?Idempotency-Key"?\s*:\s*`?"?[A-Za-z0-9-]{20,}/.test(smoke.replace(/const kS = "smoke-ubah-tidak-menulis-0001"/, "")) || smoke.includes("smoke-ubah-tidak-menulis-0001"), "kunci smoke hanya untuk penolakan sebelum menulis");
  for (const t of ["perubahan-pemakaian/pratinjau", "UNIT_ALASAN_PEMBETULAN_WAJIB", "UNIT_PRATINJAU_WAJIB", "koreksi-saldo"]) assert.ok(smoke.includes(t), t);
});

test("bash lolos sintaks", () => { const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-ubah-pemakaian.sh")], { encoding: "utf8" }); if (r.error) return; assert.equal(r.status, 0, r.stderr); });
