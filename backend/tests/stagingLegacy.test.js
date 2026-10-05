// P12B.5 — seeder unit NON-V2 staging: ber-prefix QA-PV2, TIDAK menambah cohort, TIDAK membuat Run/custody, hanya lewat endpoint asli untuk perubahan V1.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_SPECS } from "../scripts/staging/qaPv2Legacy.js";
import { PREFIX } from "../scripts/staging/qaPv2Safety.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, "..", "scripts", "staging", "qaPv2Legacy.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");

test("spesifikasi: tiga unit V1 (polos, berlayanan+prioritas, terblokir) dengan layanan Sales pada item order", () => {
  assert.equal(LEGACY_SPECS.length, 3);
  assert.deepEqual(LEGACY_SPECS.map((s) => [!!s.technical, !!s.blocked]), [[false, false], [true, false], [true, true]]);
  for (const s of LEGACY_SPECS) assert.ok(s.svc && s.cust);
});

test("keselamatan: kode/order ber-prefix QA-PV2; tidak menyentuh cohort/flag V2; tidak membuat Run/custody/job; V1 lewat endpoint asli", () => {
  assert.match(code, /qaCode\(`V1-\$\{/); assert.match(code, /qaCode\(`RES-V1\$\{/); assert.ok(PREFIX.startsWith("QA-PV2"));
  assert.doesNotMatch(code, /v2FeatureFlag|addToCohort|productionRun\.create|unitCustody|prisma\.job\.|prisma\.route\./);
  for (const ep of ["/service", "/production", "/stages/start", "/fail"]) assert.ok(code.includes(ep), ep);
  assert.match(code, /kit\.(patch|post)\(A\.(lead|meja1)/);
});

test("CLI: perintah 'legacy' terdaftar dan idempoten (dilewati bila unit sudah ada)", () => {
  const cli = fs.readFileSync(path.join(here, "..", "scripts", "staging", "qa-pv2.js"), "utf8");
  assert.match(cli, /cmd === "legacy"/); assert.match(cli, /seedLegacyUnits/);
  assert.match(code, /sudah ada — dilewati \(idempoten\)/);
});

test("lifecycle: unit uji berkode unik ber-prefix QA-PV2, dipilih lewat --lifecycle, tanpa artefak V2", () => {
  const cli = fs.readFileSync(path.join(here, "..", "scripts", "staging", "qa-pv2.js"), "utf8");
  assert.match(code, /export (async )?function seedLifecycleUnit/); assert.match(code, /qaCode\(`V1-L\$\{/);
  assert.match(cli, /--lifecycle/); assert.match(cli, /seedLifecycleUnit/);
});
