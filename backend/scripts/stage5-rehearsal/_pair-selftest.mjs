// Uji mandiri staging-pair.mjs pada DB sekali-pakai milik uji ini sendiri (bukan DB staging rehearsal).
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const S_ADMIN = "postgresql://klinik:KlinikMatras2026Aman@localhost:5432/postgres";
const H_ADMIN = "postgresql://sano:sano_local_dev@127.0.0.1:5434/postgres";
const SN = "pairtest_staging_sanss", HN = "pairtest_staging_hub";
const S_URL = `postgresql://klinik:KlinikMatras2026Aman@localhost:5432/${SN}`;
const H_URL = `postgresql://sano:sano_local_dev@127.0.0.1:5434/${HN}?schema=public`;
const HUB_DIR = process.argv[2];
const here = import.meta.dirname;
const sMig = fs.readdirSync(path.resolve(here, "../../prisma/migrations"), { withFileTypes: true }).find((e) => e.isDirectory()).name;
const hMig = fs.readdirSync(path.join(HUB_DIR, "prisma/migrations"), { withFileTypes: true }).find((e) => e.isDirectory()).name;

const q = async (url, sql) => { const c = new PrismaClient({ datasources: { db: { url } }, log: [] }); try { return await c.$executeRawUnsafe(sql); } finally { await c.$disconnect(); } };
const run = (...a) => { const r = spawnSync(process.execPath, [path.join(here, "staging-pair.mjs"), ...a], { encoding: "utf8" });
  const line = (r.stdout || "").split(/\r?\n/).find((l) => l.startsWith("RESULT:")); return { code: r.status, res: line ? JSON.parse(line.slice(7)) : null }; };
const exists = async (admin, n) => { const c = new PrismaClient({ datasources: { db: { url: admin } }, log: [] }); try { return (await c.$queryRawUnsafe(`select 1 from pg_database where datname=$1`, n)).length === 1; } finally { await c.$disconnect(); } };
let fail = 0; const ok = (n, c, d = "") => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const dropAll = async () => { await q(S_ADMIN, `DROP DATABASE IF EXISTS "${SN}" WITH (FORCE)`); await q(H_ADMIN, `DROP DATABASE IF EXISTS "${HN}" WITH (FORCE)`); };
const mk = async (admin, url, n, ddl) => { await q(admin, `CREATE DATABASE "${n}"`); for (const s of ddl) await q(url.replace("?schema=public", ""), s); };
const S_DDL = [`CREATE TABLE _prisma_migrations (migration_name text, rolled_back_at timestamptz)`, `INSERT INTO _prisma_migrations VALUES ('${sMig}', null)`, `CREATE TABLE "User" (id text)`, `INSERT INTO "User" VALUES ('u1')`];
const H_DDL = [`CREATE TABLE _prisma_migrations (migration_name text, rolled_back_at timestamptz)`, `INSERT INTO _prisma_migrations VALUES ('${hMig}', null)`, `CREATE TABLE external_identities (provider text, "externalId" text)`, `INSERT INTO external_identities VALUES ('SANS_SSO','u1')`];

try {
  await dropAll();
  let r = run("check", S_URL, H_URL, HUB_DIR); ok("kedua DB belum ada -> fresh", r.code === 0 && r.res?.state === "fresh", JSON.stringify(r.res));
  await mk(S_ADMIN, S_URL, SN, S_DDL);
  r = run("check", S_URL, H_URL, HUB_DIR); ok("hanya SANSS ada -> DITOLAK", r.code === 2, r.res?.reason);
  await mk(H_ADMIN, H_URL, HN, H_DDL);
  r = run("check", S_URL, H_URL, HUB_DIR); ok("keduanya ada tanpa penanda -> DITOLAK", r.code === 2 && /penanda/.test(r.res?.reason), r.res?.reason);
  r = run("reset", S_URL, H_URL); ok("reset TIDAK menghapus DB tanpa penanda", (await exists(S_ADMIN, SN)) && (await exists(H_ADMIN, HN)), JSON.stringify(r.res?.detail));
  r = run("mark", S_URL, H_URL); ok("mark memasang penanda sama", r.code === 0 && r.res?.state === "marked");
  r = run("mark", S_URL, H_URL); ok("mark kedua kali ditolak (tidak menimpa)", r.code !== 0);
  await q(H_ADMIN, `DROP DATABASE "${HN}" WITH (FORCE)`); await q(H_ADMIN, `CREATE DATABASE "${HN}"`);
  await q(H_ADMIN, `COMMENT ON DATABASE "${HN}" IS '${(await (async () => { const c = new PrismaClient({ datasources: { db: { url: S_ADMIN } }, log: [] }); try { return (await c.$queryRawUnsafe(`select shobj_description(oid,'pg_database') d from pg_database where datname=$1`, SN))[0].d; } finally { await c.$disconnect(); } })())}'`);
  r = run("check", S_URL, H_URL, HUB_DIR); ok("pasangan bertanda, HUB baru dibuat (belum bermigrasi) -> paired, bukan crash", r.code === 0 && r.res?.state === "paired", JSON.stringify(r.res));
  for (const sql of H_DDL) await q(H_URL.replace("?schema=public", ""), sql);
  r = run("check", S_URL, H_URL, HUB_DIR); ok("pasangan konsisten -> paired", r.code === 0 && r.res?.state === "paired", JSON.stringify(r.res));
  await q(S_URL, `INSERT INTO _prisma_migrations VALUES ('20261227090000_hub_handoff_sso', null)`);
  r = run("check", S_URL, H_URL, HUB_DIR); ok("migrasi nama lama di SANSS -> DITOLAK", r.code === 2 && /migrasi/.test(r.res?.reason), r.res?.reason);
  await q(S_URL, `DELETE FROM _prisma_migrations WHERE migration_name = '20261227090000_hub_handoff_sso'`);
  await q(H_URL.replace("?schema=public", ""), `INSERT INTO external_identities VALUES ('SANS_SSO','pengguna-lama')`);
  r = run("check", S_URL, H_URL, HUB_DIR); ok("identitas HUB menunjuk pengguna SANSS yang tidak ada -> DITOLAK", r.code === 2 && /identitas/.test(r.res?.reason), r.res?.reason);
  await q(S_ADMIN, `COMMENT ON DATABASE "${SN}" IS 'stage5-pair:lain'`);
  r = run("check", S_URL, H_URL, HUB_DIR); ok("penanda berbeda -> DITOLAK", r.code === 2 && /berbeda/.test(r.res?.reason), r.res?.reason);
  await q(H_ADMIN, `COMMENT ON DATABASE "${HN}" IS NULL`);
  r = run("reset", S_URL, H_URL); ok("reset: hapus yang bertanda, sisakan yang tidak", !(await exists(S_ADMIN, SN)) && (await exists(H_ADMIN, HN)), JSON.stringify(r.res?.detail));
  r = run("check", "postgresql://x:y@10.0.0.5:5432/prod_db", H_URL, HUB_DIR); ok("host non-loopback / nama tanpa 'staging' ditolak", r.code !== 0);
} finally {
  await dropAll();
}
console.log(fail ? `GAGAL ${fail}` : "SEMUA LULUS");
process.exit(fail ? 1 : 0);
