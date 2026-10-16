// Tes skrip rilis scripts/release-atribusi-kpi-kode.sh (Fase 3.1, kode-saja) — TANPA menyentuh produksi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(root, "scripts/release-atribusi-kpi-kode.sh");
const src = fs.readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");
const lf = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const sha = (t) => createHash("sha256").update(t).digest("hex");
const punyaBash = spawnSync("bash", ["-c", "exit 0"]).status === 0;

function kodeBersih() {
  const out = []; let akhir = null;
  for (const l of src.split("\n")) {
    if (akhir) { if (l === akhir) akhir = null; continue; }
    const h = /<<'([A-Z0-9_]+)'/.exec(l);
    if (h) akhir = h[1];
    if (l.trimStart().startsWith("#")) continue;
    out.push(l);
  }
  return out.join("\n");
}
const kode = kodeBersih();

test("sintaks bash valid, LF, tanpa placeholder pin", { skip: !punyaBash }, () => {
  assert.equal(spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" }).status, 0);
  assert.ok(!fs.readFileSync(scriptPath, "utf8").includes("\r"));
  assert.ok(!/__PIN_/.test(src));
});

test("pin sha256 cocok pohon kerja; backend/src = BACKEND_SRC_EXPECT", () => {
  const pins = [...src.matchAll(/\["(backend\/[^"]+)"\]="([0-9a-f]{64})"/g)];
  assert.equal(pins.length, 2);
  for (const m of pins) assert.equal(sha(lf(m[1])), m[2], `pin ${m[1]} basi`);
  const be = /BACKEND_SRC_EXPECT="([^"]+)"/.exec(src)[1].split(" ").sort();
  assert.deepEqual(pins.map((m) => m[1]).sort(), be);
});

test("TANPA migrasi/skema, tanpa tulis data, tanpa env/flag, tanpa push/hapus, tanpa Meta", () => {
  for (const [re, nama] of [
    [/\bprisma\s+migrate\s+(deploy|dev|reset|resolve)/, "migrate"], [/\bDROP\s+(TABLE|DATABASE|SCHEMA|COLUMN)/i, "DROP"], [/\bALTER\s+TABLE/i, "ALTER"],
    [/\b(INSERT\s+INTO|UPDATE\s+["a-z_]+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i, "SQL tulis"], [/\bgit\b[^\n]*\bpush\b/, "git push"], [/\brm\s+-[a-zA-Z]*r/, "rm -r"],
    [/\bdocker\s+(image\s+)?rmi?\b/, "docker rmi"], [/\bprune\b/, "prune"], [/\bsudo\b/, "sudo"], [/>>?\s*"?\$?\{?PERSIST\}?\/backend\/\.env/, ".env"], [/\bsed\s+-i[^\n]*\.env/, "sed -i .env"],
    [/SPEND_SYNC_ENABLED=(true|"true")/, "sync ON"], [/graph\.facebook\.com|api\.windsor\.ai/i, "panggilan Meta"], [/curl[^\n]*(-X\s*POST|--data|-d\s)/i, "curl POST"], [/crontab/i, "cron"],
  ]) assert.ok(!re.test(kode), `perintah terlarang: ${nama}`);
});

test("allowlist: hanya berkas Fase 3.1; prisma/paket/compose/campaign automation/berkas lain ditolak", () => {
  const re = new RegExp(/ALLOWED_RE='([^']+)'/.exec(src)[1]);
  for (const ok of ["backend/src/services/attribution/biayaKpi.js", "backend/src/services/attribution/iklanReport.js", "backend/tests/fixtures/windsorSpend20261015.js", "frontend/src/features/laporan/iklanCampaignLogic.js", "docs/ATRIBUSI-SPEND-KPI-FASE3.md", "scripts/release-atribusi-kpi-kode.sh", "scripts/release-atribusi-spend.sh"]) assert.ok(re.test(ok), ok);
  for (const no of ["backend/prisma/schema.prisma", "backend/prisma/migrations/20261202000000_x/migration.sql", "backend/package.json", "docker-compose.release.yml", "backend/src/index.js", "backend/src/routes/attributionAds.js", "backend/src/services/attribution/spend.js", "backend/src/services/attribution/spendSyncMeta.js", "frontend/src/pages/Laporan.jsx", "backend/src/services/meta/campaignAutomation.js", "backend/.env"]) assert.ok(!re.test(no), no);
});

test("gerbang kunci ada: baseline, disk, backup, pin, himpunan migrasi sama, data tidak berubah, reach tidak tampil, rollback tanpa hapus data", () => {
  for (const [re, nama] of [
    [/BUKAN baseline \$\{BASE_SHORT\}; produksi bergeser/, "baseline"], [/MIN_FREE_KB=\$\(\(5 \* 1024 \* 1024\)\)/, "disk"], [/pg_dump -U/, "pg_dump"], [/sha256sum -c /, "checksum"],
    [/himpunan migrasi kandidat ≠ produksi/, "tanpa migrasi"], [/prisma\/paket\/Docker\/dist\/\.env berubah/, "tanpa skema"], [/keadaan data BERUBAH selama rilis/, "data tidak ditulis"],
    [/laporan memuat reach/, "reach"], [/SEBELUM_ATRIBUSI/, "status sebelum atribusi"], [/TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI/, "evaluasi"], [/CPL\/CPA\/ROAS CRM harus null sebelum atribusi/, "null"],
    [/\$\{FLAG_SYNC\}=true/, "sync OFF"], [/migrate status \(image baru\) TIDAK 'up to date'/, "migrate status"], [/MODE=rollback/, "rollback"], [/tidak dihapus/, "rollback tanpa hapus"],
  ]) assert.ok(re.test(src), `gerbang hilang: ${nama}`);
  const p = (x) => src.indexOf(x);
  assert.ok(p('PHASE="3-backup"') < p('PHASE="5-build-image"') && p('PHASE="5-build-image"') < p('PHASE="7-switch"'));
});

test("SMOKE_JS valid sintaks dan hanya membaca", () => {
  const m = /read -r -d '' SMOKE_JS <<'JS' \|\| true\n([\s\S]*?)\nJS\n/.exec(src);
  assert.ok(m);
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || "/tmp", "atri3b-"));
  try { const f = path.join(tmp, "s.cjs"); fs.writeFileSync(f, m[1]); assert.equal(spawnSync(process.execPath, ["--check", f], { encoding: "utf8" }).status, 0); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.ok(!/method:\s*["']POST|\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/.test(m[1]));
});
