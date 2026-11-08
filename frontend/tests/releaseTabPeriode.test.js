// Gerbang skrip rilis FRONTEND-SAJA "Scroll tab + periode Finance bersama" (scripts/release-tab-periode.sh): sintaks, allowlist persis, tanpa backend/Docker/package/.env. Tidak menjalankan skrip.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const script = baca("scripts/release-tab-periode.sh");
const allow = script.split("\n").find((l) => l.startsWith("ALLOWED_RE="));
const punyaBash = spawnSync("bash", ["-c", "true"]).status === 0;
// jalur seperti tertulis di ALLOWED_RE: titik diawali satu backslash
const keRegex = (f) => f.split(".").join(String.fromCharCode(92) + ".");

test("skrip: sintaks bash valid; allowlist memuat berkas inti dan tidak memuat backend/prisma/package/Docker/.env/dist", { skip: !punyaBash }, () => {
  const r = spawnSync("bash", ["-n", path.join(repo, "scripts/release-tab-periode.sh")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
  assert.ok(allow, "ALLOWED_RE ada");
  for (const f of ["TabbedContent.jsx", "posisiScrollTab.js", "periodeBersama.js", "FinancePayments.jsx"]) assert.ok(allow.includes(keRegex(f)), `allowlist memuat ${f}`);
  for (const t of ["backend/", "prisma", "package", "Dockerfile", "docker-compose", "frontend/dist", ".env"]) assert.ok(!allow.includes(t), `allowlist tidak boleh memuat ${t}`);
  assert.ok(!allow.includes("FinanceReceivables") && !allow.includes("LaporanDivisi"), "halaman yang sengaja tidak diikutkan");
});

test("allowlist aplikasi = tepat daftar yang disetujui; sumber dari git; rollback ke baseline; tanpa penghapusan docker", () => {
  const disetujui = baca("scripts/templates/release-tab-periode/allowlist.txt").split("\n").filter(Boolean);
  assert.equal(disetujui.length, 16);
  for (const f of disetujui) assert.ok(allow.includes(keRegex(f)), `allowlist skrip memuat ${f}`);
  assert.ok(script.includes('sg archive "$DEPLOY_SHA" | tar -x -C "$NEW_DIR"'), "git archive");
  assert.ok(script.includes("--rollback") && script.includes("/tmp/stp1.sh"), "rollback");
  assert.ok(script.includes('for s1 in "periode-finance:v1"'), "penanda baru hanya di dist baru");
  assert.ok(!/docker (rmi|image rm|system prune|builder prune|volume rm)/.test(script), "tanpa penghapusan docker");
  assert.ok(baca("scripts/gen-release-tab-periode.cjs").includes("rilis ini FRONTEND-SAJA"), "generator memaksa frontend-saja");
});
