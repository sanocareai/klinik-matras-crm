import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Skrip rilis Export Excel Penjualan Karyawan: kode saja, fail-closed, backup + rehearsal pada restore, gerbang kode live, smoke baca-saja pasca-switch, tanpa pembersihan otomatis.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const sh = baca("scripts/release-export-pkr.sh");

test("skrip: fail-fast, kandidat benar, TANPA migrasi/dependensi/compose, tanpa perintah destruktif atau sisa nama rilis lain", () => {
  assert.match(sh, /^#!\/usr\/bin\/env bash\n/); assert.match(sh, /set -Eeuo pipefail/);
  assert.match(sh, /CAND_BRANCH="\$\{CAND_BRANCH:-feat\/finance-export-pkr\}"/);
  assert.doesNotMatch(sh, /@@[A-Z_]+@@/, "tidak ada placeholder generator tersisa");
  assert.doesNotMatch(sh, /git (reset|stash|push --force|checkout --)|--force-with-lease|docker (system|volume) prune|rm -rf (\/|\$HOME|"\$HOME")(\s|$)/m);
  assert.doesNotMatch(sh, /po-barang-mirip|\bpbm\b/, "tidak ada sisa nama rilis PO barang mirip");
  assert.match(sh, /pre-export-pkr-/); assert.match(sh, /rollback-pre-xpk-/); assert.match(sh, /rehearsal_xpk_/); assert.match(sh, /release-export-pkr\.lock/);
});

test("gerbang: preflight/rehearsal-only, backup + RESTORE rehearsal sebelum switch, gerbang identitas kode live, smoke baca-saja SETELAH switch, tanpa rollback otomatis dan tanpa pembersihan", () => {
  for (const kata of ["--preflight-only", "--rehearsal-only", "Backup produksi", "REHEARSAL", "IDENTITAS KODE LIVE", "7. Switch backend", "8b-smoke", "INSTRUKSI ROLLBACK"]) assert.ok(sh.toLowerCase().includes(kata.toLowerCase()), `gerbang hilang: ${kata}`);
  assert.ok(sh.indexOf("Switch backend") > sh.indexOf("REHEARSAL") || sh.indexOf("--rehearsal-only") > 0);
  assert.match(sh, /die "uji export PKR terhadap salinan restore GAGAL/);
  assert.match(sh, /Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya/);
});

test("pustaka tertanam: rehearsal memakai DB rehearsal_ + server kode baru; smoke baca-saja membandingkan Excel dengan tabel dan layar; keduanya menyebut batas 500 dan dokumen/pembayaran batal", () => {
  const reh = baca("scripts/lib/rehearsal-export-pkr.mjs"); const sm = baca("scripts/lib/smoke-export-pkr.mjs");
  assert.match(reh, /\^rehearsal_/); assert.match(reh, /524/); assert.match(reh, /Dibatalkan — tidak ditagih/); assert.match(reh, /spawnSync\(process\.execPath, \["--input-type=module", "-"\], \{ input: SMOKE_SRC/);
  assert.match(sm, /SMOKE_HASIL fail=/); assert.match(sm, /tanpa batas 500 layar/); assert.match(sm, /Dibatalkan — tidak ditagih/); assert.match(sm, /TIDAK ada jejak tulis/);
  assert.doesNotMatch(sm, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|INSERT |UPDATE |DELETE /, "smoke produksi BACA-SAJA: tanpa pemanggilan tulis");
  assert.ok(sh.includes("SMOKE_HASIL fail="), "smoke tertanam di skrip rilis");
  assert.ok(sh.includes("PEMERIKSAAN=") || sh.includes("rehearsal"), "rehearsal tertanam");
});

test("allowlist: hanya berkas rilis ini (export PKR, kontrak metrik, halaman PKR, tes, dokumen, skrip); tanpa migrasi, dependensi, atau index.js", () => {
  const allow = (sh.match(/^ALLOWED_RE='(.*)'$/m) ?? [])[1] ?? "";
  assert.ok(allow.includes("backend/src/services/finance/export/penjualan-karyawan"), "export PKR");
  assert.ok(allow.includes("frontend/src/pages/finance/FinancePenjualanKaryawan"), "halaman PKR");
  assert.ok(!/backend\/prisma/.test(allow), "tanpa migrasi/schema"); assert.ok(!/package(-lock)?/.test(allow), "tanpa dependensi"); assert.ok(!allow.includes("backend/src/index"), "tanpa index.js");
});
