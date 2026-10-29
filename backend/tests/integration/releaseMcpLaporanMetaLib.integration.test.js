// Menguji PUSTAKA rehearsal + smoke skrip rilis MCP laporan Meta Ads (scripts/lib/*-mcp-laporan-meta.mjs) sebagai subproses TERHADAP DB sekali pakai:
// server kode baru sungguhan (src/index.js) + tiga jalur auth (OAuth ChatGPT, OAuth Claude, token statis) + endpoint. Ini uji HANDLER/SERVER LOKAL, bukan discovery klien konektor.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

process.env.JWT_SECRET ||= "rahasia-uji-lib-rilis-mcp";
await import("./setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { testPrisma, truncateAll } = await import("./setup/testDb.js");
const { benihMetaAds, DARI, SAMPAI } = await import("./setup/metaAdsSeed.js");

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lib = (n) => fs.readFileSync(path.join(backend, "../scripts/lib", n), "utf8").replace(/\r\n/g, "\n");
const smokeSrc = lib("smoke-mcp-laporan-meta.mjs");
const rehSrc = lib("rehearsal-mcp-laporan-meta.mjs").replace('"@@SMOKE_SRC@@"', () => JSON.stringify(smokeSrc));

test.before(async () => {
  await truncateAll();
  for (const m of ["metaAdSpendRevision", "metaAdDailySpend", "metaSpendImport", "attributionKpiTarget", "attributionAlertState", "attributionTouch", "metaAdReference"]) await testPrisma[m].deleteMany({}).catch(() => {});
  const admin = await testPrisma.user.create({ data: { name: "Admin Lib", email: `adm-lib-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  await testPrisma.user.create({ data: { name: "Sales Lib", email: `sls-lib-${Date.now()}@example.test`, passwordHash: "x", role: "SALES" } });
  await benihMetaAds({ testPrisma, admin });
});
test.after(async () => { await testPrisma.$disconnect(); });

const env = (extra = {}) => ({ ...process.env, APP_DIR: backend, REH_DB_NAME: "rehearsal_lokal_uji", REH_PORT: String(4100 + Math.floor(Math.random() * 400)), SMOKE_DARI: DARI, SMOKE_SAMPAI: SAMPAI, ...extra });
const jalankan = (src, e) => spawnSync(process.execPath, ["--input-type=module", "-"], { input: src, cwd: backend, encoding: "utf8", timeout: 200_000, maxBuffer: 16 * 1024 * 1024, env: e });

test("pustaka REHEARSAL: server kode baru + smoke lewat tiga jalur auth lulus; tabel kunci identik; tidak ada SKIP", { timeout: 240_000 }, () => {
  const r = jalankan(rehSrc, env());
  const keluar = r.stdout + "\n" + r.stderr;
  assert.equal(r.status, 0, keluar.slice(-3000));
  assert.match(r.stdout, /PEMERIKSAAN=\d+ gagal=0/);
  assert.match(r.stdout, /OAuth ChatGPT, OAuth Claude, dan token statis/);
  assert.ok(!/^GAGAL/m.test(r.stdout), "ada pemeriksaan GAGAL");
  for (const kata of ["ChatGPT (OAuth ADMIN, audience /mcp-chatgpt)", "Claude (OAuth ADMIN, audience /mcp)", "Claude Code/Desktop (token statis)", "tepat sembilan tool aktif", "hasil tool == endpoint"]) assert.ok(r.stdout.includes(kata), `tidak terbukti: ${kata}`);
  assert.match(r.stdout, /SMOKE_HASIL fail=0 skip=0/);
});

test("SMOKE tanpa rahasia MCP: gagal keras (bukan lulus diam-diam) karena tidak ada jalur auth konektor yang bisa diuji", { timeout: 120_000 }, () => {
  // server uji dijalankan manual TANPA rahasia MCP; smoke harus melaporkan FAIL pada 'minimal satu jalur auth'
  const e = env({ MCP_API_TOKEN: "", MCP_OAUTH_JWT_SECRET: "", SMOKE_BASE: "http://127.0.0.1:9", BASE_TIDAK_SEIMBANG: "0", BASE_GANDA: "0", ORDER_N: "0", JOB_N: "0" });
  const r = jalankan(smokeSrc, e);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /FAIL\s+minimal satu jalur auth konektor/);
});
