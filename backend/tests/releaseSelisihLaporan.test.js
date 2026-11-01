import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Skrip rilis Audit Selisih Laporan: kode saja, fail-closed, backup + rehearsal pada restore, gerbang kode live, smoke baca-saja pasca-switch, tanpa pembersihan otomatis.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const sh = baca("scripts/release-selisih-laporan.sh");

test("skrip: fail-fast, kandidat benar, TANPA migrasi/dependensi/compose, tanpa perintah destruktif atau sisa nama rilis lain", () => {
  assert.match(sh, /^#!\/usr\/bin\/env bash\n/); assert.match(sh, /set -Eeuo pipefail/);
  assert.match(sh, /CAND_BRANCH="\$\{CAND_BRANCH:-fix\/audit-selisih-laporan-okt-on-a0dbe2fb\}"/);
  assert.doesNotMatch(sh, /@@[A-Z_]+@@/, "tidak ada placeholder generator tersisa");
  assert.doesNotMatch(sh, /git (reset|stash|push --force|checkout --)|--force-with-lease|docker (system|volume) prune|rm -rf (\/|\$HOME|"\$HOME")(\s|$)/m);
  assert.doesNotMatch(sh, /po-barang-mirip|\bpbm\b|export-pkr|\bxpk\b/, "tidak ada sisa nama rilis lain");
  assert.match(sh, /pre-selisih-laporan-/); assert.match(sh, /rollback-pre-sel-/); assert.match(sh, /rehearsal_sel_/); assert.match(sh, /release-selisih-laporan\.lock/);
});

test("gerbang: preflight/rehearsal-only, backup + RESTORE rehearsal sebelum switch, gerbang identitas kode live, smoke baca-saja SETELAH switch, tanpa rollback otomatis dan tanpa pembersihan", () => {
  for (const kata of ["--preflight-only", "--rehearsal-only", "Backup produksi", "REHEARSAL", "IDENTITAS KODE LIVE", "7. Switch backend", "8b-smoke", "INSTRUKSI ROLLBACK"]) assert.ok(sh.toLowerCase().includes(kata.toLowerCase()), `gerbang hilang: ${kata}`);
  assert.match(sh, /die "uji audit selisih laporan terhadap salinan restore GAGAL/);
  assert.match(sh, /Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya/);
});

test("pustaka tertanam: rehearsal memakai DB rehearsal_ + server kode baru pada data nyata tanpa menulis; smoke baca-saja membandingkan API, Excel, dan SQL", () => {
  const reh = baca("scripts/lib/rehearsal-selisih-laporan.mjs"); const sm = baca("scripts/lib/smoke-selisih-laporan.mjs");
  assert.match(reh, /\^rehearsal_/); assert.match(reh, /spawnSync\(process\.execPath, \["--input-type=module", "-"\], \{ input: SMOKE_SRC/); assert.match(reh, /2026-10-01/); assert.match(reh, /identik persis/);
  assert.match(sm, /SMOKE_HASIL fail=/); assert.match(sm, /Dihitung ke Total\?/); assert.match(sm, /jembatan kohort menutup persis/); assert.match(sm, /TIDAK ada jejak tulis/); assert.match(sm, /SUM kolom 'Nilai yang Dihitung' = TOTAL Excel = total layar = SQL/);
  assert.doesNotMatch(sm, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|INSERT |UPDATE |DELETE /, "smoke produksi BACA-SAJA: tanpa pemanggilan tulis");
  assert.doesNotMatch(sm, /method:\s*"(PATCH|PUT|DELETE)"/, "smoke tidak memakai PATCH/PUT/DELETE");
  assert.deepEqual([...sm.matchAll(/method:\s*"(\w+)"/g)].map((x) => x[1]).filter((x, i, a) => a.indexOf(x) === i), ["POST"], "satu-satunya POST = unduh export (baca-saja)");
  assert.ok(sh.includes("SMOKE_HASIL fail="), "smoke tertanam di skrip rilis");
  assert.ok(sh.includes("PEMERIKSAAN=") || sh.includes("rehearsal"), "rehearsal tertanam");
});

test("allowlist: hanya berkas rilis ini (pemasukan, rekonsiliasi, export, kontrak metrik, laporan, tes, dokumen, skrip); tanpa migrasi, dependensi, index.js, atau berkas hotfix performa", () => {
  const allow = (sh.match(/^ALLOWED_RE='(.*)'$/m) ?? [])[1] ?? "";
  assert.ok(allow.includes("backend/src/services/finance/pemasukan"), "pemasukan"); assert.ok(allow.includes("rekonSalesFinance"), "rekon"); assert.ok(allow.includes("frontend/src/pages/finance/FinancePemasukan"), "halaman pemasukan");
  assert.ok(!/backend\/prisma/.test(allow), "tanpa migrasi/schema"); assert.ok(!/package(-lock)?/.test(allow), "tanpa dependensi"); assert.ok(!allow.includes("backend/src/index"), "tanpa index.js");
  assert.ok(!/routes\\\/(analytics|conversations)|cacheSingkat|pages\\\/Laporan/.test(allow), "tanpa berkas hotfix performa");
});

test("COUNT_SQL: dievaluasi bash menghasilkan SQL utuh (tanda kutip nama tabel \"Order\" ter-escape) — cacat ini pernah lolos bash -n dan baru tertangkap gerbang VPS", async () => {
  const { spawnSync } = await import("node:child_process");
  const baris = sh.split("\n").find((l) => l.startsWith("COUNT_SQL=")); assert.ok(baris, "baris COUNT_SQL ada");
  const r = spawnSync("bash", ["-c", `${baris}\nprintf '%s' "$COUNT_SQL"`], { encoding: "utf8" });
  if (r.error) return; // tanpa bash di lingkungan ini: tes dilewati (VPS selalu punya bash)
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /from "Order" union all/, "nama tabel Order berkutip utuh di SQL hasil evaluasi");
  assert.ok(r.stdout.startsWith("select 'payments'") && r.stdout.endsWith("from fin_penjualan_karyawan"), "SQL tidak terpotong");
});
