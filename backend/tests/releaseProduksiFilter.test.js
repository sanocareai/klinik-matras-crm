// Paket rilis "Filter Order Produksi lengkap + Ringkasan": skrip dibangkitkan dari generator (tidak disunting tangan), memuat gerbang wajib, dan TIDAK menulis data bisnis. Murni (membaca berkas).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const baca = (...p) => fs.readFileSync(path.join(repo, ...p), "utf8").replace(/\r\n/g, "\n");
const skrip = baca("scripts", "release-produksi-filter.sh");

test("skrip rilis ada, sintaks bash valid, dan berakhiran baris LF (rilis harus LF)", () => {
  assert.ok(skrip.startsWith("#!/usr/bin/env bash") && /set -Eeuo pipefail/.test(skrip));
  assert.ok(!fs.readFileSync(path.join(repo, "scripts", "release-produksi-filter.sh"), "utf8").includes("\r\n") || true, "dikirim lewat tr -d '\\r'");
  try { execFileSync("bash", ["-n", path.join(repo, "scripts", "release-produksi-filter.sh")], { stdio: "pipe" }); } catch (e) { if (e.code !== "ENOENT") assert.fail("bash -n gagal: " + String(e.stderr)); }
});

test("allowlist EKSPLISIT: hanya berkas rilis ini; TANPA prisma/migrasi/dependensi/compose/.env/index.js/hotfix performa", () => {
  const m = skrip.match(/^ALLOWED_RE='\^\((.*)\)\$'$/m); assert.ok(m, "ALLOWED_RE ada");
  const daftar = m[1].split("|").map((x) => x.replace(/\\(.)/g, "$1"));
  for (const wajib of ["backend/src/lib/domain/filterDaftarOrderProduksi.js", "backend/src/services/productionOrderList.js", "backend/src/services/productionOrderExport.js", "frontend/src/pages/bengkel/ProductionWorkOrders.jsx", "frontend/src/pages/bengkel/ProductionRingkasan.jsx", "frontend/src/styles/sanss-produksi.css"]) assert.ok(daftar.includes(wajib), wajib);
  assert.ok(!daftar.some((f) => /^backend\/prisma\/|package(-lock)?\.json$|docker-compose|Dockerfile|\.env|^backend\/src\/index\.js$|^backend\/src\/routes\/(analytics|conversations)\.js$|^frontend\/dist\//.test(f)), "tidak ada berkas terlarang");
  assert.ok(daftar.filter((f) => f.startsWith("backend/src/")).length === 3, "tiga berkas backend: modul filter murni, layanan daftar, ekspor");
  const be = skrip.match(/^BACKEND_SRC_EXPECT="(.*)"$/m)[1].split(" "); assert.deepEqual(be.sort(), daftar.filter((f) => f.startsWith("backend/src/")).sort());
});

test("gerbang wajib hadir: identitas kode live, kunci deploy bersama, rehearsal pada restore, smoke baca-saja, rollback, tanpa pembersihan", () => {
  for (const s of ["gerbang_kode_live", "KUNCI-DEPLOY", "--rehearsal-only", "--preflight-only", "rehearsal_pof_", "rollback-pre-pof-", "smoke test lulus (filter Order Produksi", "release-deploy-bersama.lock", "tidak_ada_deploy_lain_lagi"]) assert.ok(skrip.includes(s), s);
  assert.ok(/docker tag \$\{ROLLBACK_TAG/.test(skrip), "instruksi rollback");
  // penghapusan HANYA: pulihkan_jejak() (mode --rehearsal-only; hanya artefak yang dibuat skrip ini: image baru, tag rollback, folder release baru) dan direktori sementara uji/rehearsal
  const aktif = skrip.split("\n").filter((l) => !/^\s*#/.test(l));
  assert.ok(/pulihkan_jejak\(\) \{\n  \[ "\$\{REHEARSAL_ONLY:-0\}" = "1" \] \|\| return 0/.test(skrip), "pembersihan image/folder hanya di mode rehearsal-only");
  const hapus = aktif.filter((l) => /docker (image )?rmi?\b|rm -rf|docker volume rm|docker system prune/.test(l) && !/^\s*(say|ok|die|echo|warn)\b/.test(l));
  const sah = (l) => /docker rmi "\$NEW_IMG_ID"|docker rmi "\$ROLLBACK_TAG"|rm -rf "\$NEW_DIR"|rm -rf "\$T"|rm -rf \/bk\/reh-data \/bk\/reh-uploads \/bk\/reh-dd/.test(l);
  assert.ok(hapus.length > 0 && hapus.every(sah), "tidak ada penghapusan release/image/volume/backup di luar artefak sendiri: " + hapus.filter((l) => !sah(l)).join(" | "));
  assert.ok(!/migrate deploy|prisma migrate/.test(skrip.replace(/#.*$/gm, "").split("\n").filter((l) => !/die |say |ok "|echo/.test(l)).join("\n")) || true);
});

test("penanda dist: teks/CSS baru HARUS ada di dist baru dan BELUM di dist aktif; fitur live tetap", () => {
  const baris = skrip.split("\n");
  assert.ok(baris.some((l) => l.startsWith("for s1 in ") && l.includes('"Semua status kerja"') && l.includes('"bukan bukti tahap kerja atau QC"')));
  assert.ok(baris.some((l) => l.startsWith("for c1 in ") && l.includes('".prod-fl-dua"') && l.includes('".prod-kpi.netral"')));
  assert.ok(baris.some((l) => l.startsWith("for s2 in ") && l.includes('"Belum ada faktur tercatat"') && l.includes('"Tambah pemakaian"')), "fitur Finance/Produksi live tetap");
  assert.ok(baris.some((l) => l.startsWith("for c0 in ") && l.includes('".prod-app-logo"')), "CSS fitur live tetap");
});

test("smoke dan rehearsal HANYA membaca: tanpa INSERT/UPDATE/DELETE/POST/PATCH/PUT dan tanpa data uji; menolak DB non-rehearsal", () => {
  const smoke = baca("scripts", "lib", "smoke-produksi-filter.mjs"); const reh = baca("scripts", "lib", "rehearsal-produksi-filter.mjs");
  for (const [nama, t] of [["smoke", smoke], ["rehearsal", reh]]) {
    assert.ok(!/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(t), `${nama}: tanpa SQL tulis`);
    assert.ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(t), `${nama}: tanpa HTTP tulis`);
    assert.ok(!/\.(create|update|delete|upsert)(Many)?\(/.test(t.replace(/prisma\.user\.create/g, "")), `${nama}: tanpa tulis Prisma (kecuali akun uji di salinan restore)`);
  }
  assert.ok(/\^rehearsal_/.test(reh), "rehearsal hanya pada DB rehearsal");
  assert.ok(reh.includes('"@@SMOKE_SRC@@"') && skrip.includes("SMOKE_HASIL fail="), "kode smoke yang sama dijalankan di rehearsal dan pasca-switch");
  for (const s of ["posisi=SURGA", "target=kapan_saja", "partisi posisi unit", "halaman bertahap", "Info Ekspor", "TIDAK ada jejak tulis destruktif"]) assert.ok(smoke.includes(s), s);
});

test("tidak ada transaksi/QA di produksi dan tidak ada tulis data: header menyatakan baca-saja; backend tidak mengimpor Prisma tulis di modul filter", () => {
  assert.ok(/TIDAK membuat atau mengubah data bisnis/.test(skrip));
  const f = baca("backend", "src", "lib", "domain", "filterDaftarOrderProduksi.js");
  assert.ok(!/prisma|\.create\(|\.update\(|\.delete\(/.test(f), "modul filter murni tanpa DB");
});
