// Tes skrip rilis scripts/release-atribusi-kohort.sh — TANPA menyentuh produksi.
// Mengunci jaminan: kode saja, tanpa migrasi, env tidak diubah, capture CTWA tidak disentuh, tidak menghapus apa pun, tidak push,
// berhenti pada gerbang yang disebut, dan ada mode rollback bergerbang.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(root, "scripts/release-atribusi-kohort.sh");
const src = fs.readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");
const kode = src.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n"); // tanpa komentar

const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;

test("skrip rilis atribusi: sintaks bash valid dan berkas LF", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.readFileSync(scriptPath, "utf8").includes("\r"), "skrip harus LF");
});

test("skrip rilis atribusi: gerbang murni lulus selftest (disk 5 GiB, mount, snapshot, respons bersih)", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", [scriptPath], { encoding: "utf8", env: { ...process.env, ATRK_RELEASE_SELFTEST: "1" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!/^FAIL/m.test(r.stdout), r.stdout);
  assert.ok(/PASS\(gagal sesuai harapan\) gate_disk_kb 5242879/.test(r.stdout));
  assert.ok(/PASS\(gagal sesuai harapan\) respons_bersih \{"roas"/.test(r.stdout));
});

test("skrip rilis atribusi: TIDAK pernah menghapus, memangkas, mem-push, mengubah env, migrasi, atau menyentuh capture", () => {
  const terlarang = [
    [/\brm\s+-[a-zA-Z]*r/, "rm -r"], [/\bdocker\s+(image\s+)?rmi?\b/, "docker rmi/image rm"], [/\bprune\b/, "prune"],
    [/\bdocker\s+volume\s+(rm|prune)/, "docker volume rm"], [/\bgit\b[^\n]*\bpush\b/, "git push"], [/\bfind\b[^\n]*-delete/, "find -delete"],
    [/\bsudo\b/, "sudo"], [/>>\s*"?\$?\{?PERSIST\}?\/backend\/\.env/, "append ke .env"], [/\bsed\s+-i[^\n]*\.env/, "sed -i .env"],
    [/\bmigrate\s+(deploy|dev|reset|resolve)/, "migrate deploy/dev/reset/resolve"], [/\bnpm\s+(ci|install|run\s+build)/, "npm install/build"],
    [/\bDROP\s+(TABLE|SCHEMA|COLUMN)/i, "DROP TABLE/SCHEMA/COLUMN"], [/ctwa-capture-purge/, "purge capture"], [/CTWA_ATTRIBUTION_CAPTURE_ENABLED\s*=/, "mengubah flag capture"],
    [/\b(INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i, "SQL tulis"],
  ];
  for (const [re, nama] of terlarang) assert.ok(!re.test(kode), `skrip memuat perintah terlarang: ${nama}`);
  const drops = kode.match(/DROP DATABASE[^\n]*/gi) || [];
  assert.equal(drops.length, 1);
  assert.match(drops[0], /IF EXISTS \\"\$\{VERIFY_DB\}\\"/);
});

test("skrip rilis atribusi: gerbang yang dijanjikan ada (baseline, disk, backup+restore, pin, allowlist, .env, CTWA, migrasi, RBAC, SQL)", () => {
  const wajib = [
    [/BUKAN baseline \$\{BASE_SHORT\}; produksi bergeser/, "baseline live bergeser = berhenti"],
    [/MIN_FREE_KB=\$\(\(5 \* 1024 \* 1024\)\)/, "gerbang disk 5 GiB"],
    [/disk_gate "awal"/, "disk awal"], [/disk_gate "setelah backup\+verifikasi restore"/, "disk setelah backup"],
    [/disk_gate "sebelum build"/, "disk sebelum build"], [/disk_gate "sebelum switch"/, "disk sebelum switch"],
    [/pg_dump -U/, "pg_dump"], [/gzip -t /, "uji arsip"], [/sha256sum -c /, "checksum backup"], [/CREATE DATABASE \\"\$\{VERIFY_DB\}\\"/, "restore ke DB sementara"],
    [/DIST|frontend\/dist/, "dist disalin, bukan dibangun"],
    [/sg diff --name-only "\$BASE_SHA" "\$DEPLOY_SHA"/, "audit berkas berbeda dari baseline"], [/ALLOWED_RE/, "allowlist"], [/die "isi \$\{f\} di kandidat/, "pin sha256 kandidat"],
    [/migrate status[^\n]*\n?[^\n]*up to date/, "tanpa migration pending"], [/diff -rq "\$PREV_DIR\/backend\/prisma"/, "prisma identik"],
    [/ENV_BEFORE="\$\(env_sha\)"/, "hash .env sebelum"], [/\.env berubah setelah rilis/, "hash .env sesudah"],
    [/CTWA_BEFORE=/, "variabel CTWA_* sebelum"], [/capture CTWA tidak tersentuh/, "capture tidak tersentuh"],
    [/STATUS_NOAUTH/, "smoke 401"], [/STATUS_SALES/, "smoke 403"], [/STATUS_ADMIN/, "smoke ADMIN 200"],
    [/angka endpoint != SQL independen/, "pembanding SQL independen"],
    [/MODE=rollback/, "mode rollback"], [/rollback-pre-\$\{TAG_KODE\}-\$\{DEPLOY_SHORT\}/, "tag image rollback"],
  ];
  for (const [re, nama] of wajib) assert.ok(re.test(src), `gerbang hilang: ${nama}`);
});

test("skrip rilis atribusi: ref sumber UNIK (tidak berbagi refs/remotes/origin/cand dengan skrip rilis lain)", () => {
  assert.match(src, /CAND_REF="refs\/remotes\/origin\/cand-atrk"/);
  const tanpaKomentarInline = kode.split("\n").map((l) => l.replace(/\s#\s.*$/, "")).join("\n");
  assert.ok(!/refs\/remotes\/origin\/cand(?!-atrk)/.test(tanpaKomentarInline), "tidak boleh memakai ref bersama refs/remotes/origin/cand");
});

test("skrip rilis atribusi: pin sha256 sesuai isi berkas saat ini (basi = tinjau ulang)", () => {
  const pins = [...src.matchAll(/\["(backend\/[^"]+)"\]="([0-9a-f]{64})"/g)];
  assert.equal(pins.length, 6);
  for (const m of pins) {
    const isi = fs.readFileSync(path.join(root, m[1]), "utf8").replace(/\r\n/g, "\n");
    assert.equal(createHash("sha256").update(isi).digest("hex"), m[2], `pin ${m[1]} sudah basi — perbarui pin setelah meninjau perubahan`);
  }
});

test("skrip rilis atribusi: allowlist hanya Fase 1; area lain ditolak", () => {
  const re = new RegExp(/ALLOWED_RE='([^']+)'/.exec(src)[1]);
  for (const ok of [
    "backend/src/index.js", "backend/src/routes/attributionCohort.js", "backend/src/services/attribution/cohort.js", "backend/src/services/attribution/cohortLoader.js",
    "backend/tests/attributionCohort.test.js", "backend/tests/fixtures/attributionAuditShape.js", "backend/tests/integration/attributionCohort.integration.test.js",
    "docs/ATRIBUSI-COHORT-FASE1.md", "scripts/release-atribusi-kohort.sh",
  ]) assert.ok(re.test(ok), `harus diizinkan: ${ok}`);
  for (const no of [
    "backend/prisma/schema.prisma", "backend/prisma/migrations/x/migration.sql", "backend/package.json", "docker-compose.release.yml", "frontend/src/App.jsx",
    "backend/src/routes/analytics.js", "backend/src/routes/webhooks.js", "backend/src/services/ctwaCapture.js", "backend/src/services/attribution/touchContract.js",
    "backend/scripts/cohort-report.js", "backend/src/services/finance/allocation.js", "backend/src/services/paymentLedger.js", ".env", "backend/.env",
  ]) assert.ok(!re.test(no), `harus ditolak: ${no}`);
});
