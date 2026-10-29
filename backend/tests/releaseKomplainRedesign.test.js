import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Skrip rilis Redesign Kasus Komplain: kode saja, fail-closed, backup + rehearsal pada restore, gerbang kode live, smoke baca-saja pasca-switch, tanpa pembersihan otomatis.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const sh = baca("scripts/release-komplain-redesign.sh");

test("skrip: fail-fast, kandidat benar, TANPA migrasi/dependensi/compose, tanpa perintah destruktif atau sisa nama rilis lain", () => {
  assert.match(sh, /^#!\/usr\/bin\/env bash\n/); assert.match(sh, /set -Eeuo pipefail/);
  assert.match(sh, /CAND_BRANCH="\$\{CAND_BRANCH:-feat\/komplain-redesign\}"/);
  assert.doesNotMatch(sh, /@@[A-Z_]+@@/, "tidak ada placeholder generator tersisa");
  assert.doesNotMatch(sh, /git (reset|stash|push --force|checkout --)|--force-with-lease|docker (system|volume) prune|rm -rf (\/|\$HOME|"\$HOME")(\s|$)/m);
  assert.doesNotMatch(sh, /po-barang-mirip|\bpbm\b|export-pkr|\bxpk\b/, "tidak ada sisa nama rilis lain");
  assert.match(sh, /pre-komplain-redesign-/); assert.match(sh, /rollback-pre-kmp-/); assert.match(sh, /rehearsal_kmp_/); assert.match(sh, /release-komplain-redesign\.lock/);
});

test("gerbang: preflight/rehearsal-only, backup + RESTORE rehearsal sebelum switch, gerbang identitas kode live, smoke baca-saja SETELAH switch, tanpa rollback otomatis dan tanpa pembersihan", () => {
  for (const kata of ["--preflight-only", "--rehearsal-only", "Backup produksi", "REHEARSAL", "IDENTITAS KODE LIVE", "7. Switch backend", "8b-smoke", "INSTRUKSI ROLLBACK"]) assert.ok(sh.toLowerCase().includes(kata.toLowerCase()), `gerbang hilang: ${kata}`);
  assert.match(sh, /die "uji Komplain terhadap salinan restore GAGAL/);
  assert.match(sh, /Rilis ini TANPA migrasi dan TANPA tulisan data bisnis oleh skripnya/);
});

test("pustaka tertanam: rehearsal memakai DB rehearsal_ + server kode baru dan menguji total jujur >300 kasus serta gerbang konfirmasi; smoke baca-saja membandingkan API dengan tabel", () => {
  const reh = baca("scripts/lib/rehearsal-komplain-redesign.mjs"); const sm = baca("scripts/lib/smoke-komplain-redesign.mjs");
  assert.match(reh, /\^rehearsal_/); assert.match(reh, /hasMore=true/); assert.match(reh, /gerbang konfirmasi pelanggan tetap/); assert.match(reh, /spawnSync\(process\.execPath, \["--input-type=module", "-"\], \{ input: SMOKE_SRC/);
  assert.match(sm, /SMOKE_HASIL fail=/); assert.match(sm, /tidak lagi dipotong diam-diam/); assert.match(sm, /bukan 500/); assert.match(sm, /TIDAK ada jejak tulis/);
  assert.doesNotMatch(sm, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|INSERT |UPDATE |DELETE /, "smoke produksi BACA-SAJA: tanpa pemanggilan tulis");
  assert.doesNotMatch(sm, /method:\s*"(POST|PATCH|PUT|DELETE)"/, "smoke produksi hanya GET");
  assert.ok(sh.includes("SMOKE_HASIL fail="), "smoke tertanam di skrip rilis");
  assert.ok(sh.includes("PEMERIKSAAN=") || sh.includes("rehearsal"), "rehearsal tertanam");
});

test("allowlist: hanya berkas rilis ini (rute komplain, halaman/drawer/alur komplain, tes, dokumen, skrip); tanpa migrasi, dependensi, index.js, atau berkas hotfix performa", () => {
  const allow = (sh.match(/^ALLOWED_RE='(.*)'$/m) ?? [])[1] ?? "";
  assert.ok(allow.includes("backend/src/routes/complaints"), "rute komplain");
  assert.ok(allow.includes("frontend/src/pages/ComplaintCases"), "halaman komplain");
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
  assert.ok(r.stdout.startsWith("select 'complaint_cases'") && r.stdout.endsWith("from stock_movements"), "SQL tidak terpotong");
});
