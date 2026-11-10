import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const SCRIPT = path.join(root, "scripts/release-task-meeting-sso.sh");
const BASE = "e82899c02dd0d76286bb1275fcd30bb63e20d31b";
const src = fs.readFileSync(SCRIPT, "utf8");
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const val = (name) => src.match(new RegExp(`^${name}="([^"]*)"`, "m"))?.[1] ?? assert.fail(`${name} tidak ada`);
const lf = (s) => s.replace(/\r/g, "");

// Pemindai diambil dari skrip itu sendiri (bukan salinan) supaya tes menguji kode yang akan berjalan.
const scanner = src.slice(src.indexOf("scan_migrations() {"), src.indexOf('SCAN_EXPECT="'));
const scan = (input) => spawnSync("bash", ["-c", `${scanner}\nscan_migrations`], { input, encoding: "utf8" });

test("sintaks bash valid, LF, tanpa placeholder", () => {
  assert.equal(spawnSync("bash", ["-n", SCRIPT]).status, 0);
  assert.ok(!src.includes("\r"), "skrip harus LF");
  assert.doesNotMatch(src, /TODO|FIXME|<isi>/);
});

test("pin migrasi = sha256 isi berkas (LF) dan schema = tambahan yang dipin", () => {
  for (const [f, s] of [[val("MIG1"), val("MIG1_SHA")], [val("MIG2"), val("MIG2_SHA")]]) {
    assert.equal(sha(lf(git("show", `HEAD:${f}`))), s, f);
  }
  const diff = lf(git("diff", "-U0", BASE, "HEAD", "--", "backend/prisma/schema.prisma"));
  const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n") + "\n";
  assert.equal(sha(added), val("SCHEMA_ADD_SHA"));
  assert.ok(!diff.split("\n").some((l) => /^-[^-]/.test(l)), "schema harus murni penambahan");
});

test("allowlist mencakup persis berkas kandidat; backend/src sama dengan yang diaudit", () => {
  const allowed = src.match(/^ALLOWED_RE='([^']*)'/m)[1];
  const changed = git("diff", "--name-only", BASE, "HEAD").trim().split("\n");
  const rx = new RegExp(allowed);
  const luar = changed.filter((f) => !rx.test(f));
  assert.deepEqual(luar, []);
  const be = changed.filter((f) => f.startsWith("backend/src/")).sort().join(" ");
  assert.equal(be, val("BACKEND_SRC_EXPECT"));
  assert.deepEqual(changed.filter((f) => f.startsWith("backend/prisma/migrations/")), [val("MIG1"), val("MIG2")]);
  assert.ok(!changed.some((f) => !f.startsWith("docs/sso-stage5-rehearsal/") && /(^|\/)package(-lock)?\.json$|^docker-compose|Dockerfile/.test(f)), "dependensi/compose/Dockerfile aplikasi tidak boleh berubah");
});

test("pemindai: migrasi nyata = 6 pernyataan diizinkan; mutan ditolak", () => {
  const real = lf(git("show", `HEAD:${val("MIG1")}`)) + "\n" + lf(git("show", `HEAD:${val("MIG2")}`));
  const r = scan(real);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), val("SCAN_EXPECT"));
  for (const m of ['DROP TABLE "hub_handoffs";', 'ALTER TABLE "User" ADD COLUMN "x" TEXT;', "UPDATE \"User\" SET role = 'ADMIN';",
    "DELETE FROM user_roles;", "ALTER TYPE \"Role\" ADD VALUE IF NOT EXISTS 'ADMIN2';", 'CREATE INDEX "x" ON "User"("id");',
    'GRANT ALL ON "User" TO public;', real + '\nTRUNCATE "User";', ""]) {
    assert.notEqual(scan(m).status, 0, `mutan diterima: ${m.slice(-60)}`);
  }
});

test("pagar wajib tetap ada (provenance, lock, backup/restore, flag mati, smoke, rollback)", () => {
  for (const s of ["merge-base --is-ancestor \"$BASE_SHA\" \"$DEPLOY_SHA\"", "flock -n 9", "sha256sum -c", "PostgreSQL database dump complete",
    "rehearsal_tms1_", "^HUB_SSO_ENABLED=false$", "SMOKE_HASIL mode=after fail=0", "rollback-pre-task-meeting-sso-", "MIG_SEBELUM + 2",
    "to_regclass('public.hub_handoffs') is null", "--preflight-only"]) {
    assert.ok(src.includes(s), s);
  }
});
