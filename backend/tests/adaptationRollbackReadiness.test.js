// Skrip kesiapan rollback adaptasi: BACA-SAJA secara default; satu-satunya penulisan = command resmi finishProduction, hanya dengan --finish --yes + aktor ADMIN/OWNER; tak ada SQL/ORM tulis langsung.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "scripts", "production-delivery-v2", "adaptation-rollback-readiness.js"), "utf8");
const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

test("skrip kesiapan rollback: tanpa penulisan langsung (ORM/SQL); penulisan hanya lewat finishProduction di balik --finish + --yes + aktor ADMIN/OWNER", () => {
  assert.doesNotMatch(code, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/, "tanpa ORM tulis");
  assert.doesNotMatch(code, /\$executeRaw|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s|TRUNCATE/i, "tanpa SQL tulis");
  assert.equal((code.match(/finishProduction\(/g) || []).length, 1, "satu pemanggilan command resmi");
  assert.match(code, /if \(!FINISH\) \{[\s\S]*process\.exit\(table\.length \? 1 : 0\)/, "mode default berhenti sebelum penulisan");
  assert.match(code, /if \(!YES\) \{ console\.log\("  \(pratinjau saja/, "tanpa --yes = pratinjau");
  assert.match(code, /\["ADMIN", "OWNER"\]\.includes\(actor\.role\)/);
  assert.match(code, /LOCKED_UNDER_OLD_CODE/); assert.match(code, /CUSTODY_QC_NOT_SATISFIED/);
  assert.match(code, /idempotencyKey: `rollback-recovery-\$\{runId\}-\$\{prev\.revision\}`/, "idempoten per run+revisi");
});
