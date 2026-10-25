// Sementara — rehearsal staging Tahap 5 (dihapus setelah selesai).
// Mirip tmp-smoke-db.mjs tapi database STAGING (bukan sekali-pakai per-run) —
// nama tetap/deterministik, guard sama (loopback + nama mengandung "staging").
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";

const BASE = "postgresql://klinik:KlinikMatras2026Aman@localhost:5432/postgres";
const DB_NAME = "klinik_matras_staging_s5";

function guard() {
  const u = new URL(BASE);
  if (!["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error("refuse: host bukan loopback");
  if (!DB_NAME.includes("staging")) throw new Error("refuse: nama db harus mengandung 'staging'");
}

async function create() {
  guard();
  const admin = new PrismaClient({ datasources: { db: { url: BASE } } });
  try {
    const rows = await admin.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = $1`, DB_NAME);
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  } finally {
    await admin.$disconnect();
  }
  const dbUrl = new URL(BASE);
  dbUrl.pathname = `/${DB_NAME}`;
  process.stdout.write("RESULT:" + JSON.stringify({ dbName: DB_NAME, dbUrl: dbUrl.toString() }) + "\n");
}

async function migrate() {
  guard();
  const dbUrl = new URL(BASE);
  dbUrl.pathname = `/${DB_NAME}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: dbUrl.toString() },
    stdio: "inherit",
    shell: true,
  });
  process.stdout.write("RESULT:migrated\n");
}

async function drop() {
  guard();
  const admin = new PrismaClient({ datasources: { db: { url: BASE } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    process.stdout.write(`RESULT:dropped ${DB_NAME}\n`);
  } finally {
    await admin.$disconnect();
  }
}

const [, , cmd] = process.argv;
if (cmd === "create") await create();
else if (cmd === "migrate") await migrate();
else if (cmd === "drop") await drop();
else {
  console.error("usage: tmp-staging-db.mjs create|migrate|drop");
  process.exit(1);
}
