// Menyiapkan database QA lokal: buat DB (km_qa_manifest_test), prisma migrate deploy, seed akun QA + 3 job (3 unit tiap job).
//   QA_DATABASE_URL=postgresql://USER:PASS@localhost:5432/km_qa_manifest_test node scripts/qa-manifest/setup.mjs [--reset]
// Idempoten: tanpa --reset hanya menambah job baru; --reset menghapus database QA lalu membuatnya ulang.
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertQaDb, seedUsers, seedJob, aktifkanFlagV2, QA_DRIVER_EMAIL, QA_ADMIN_EMAIL } from "./lib.mjs";

const url = process.env.QA_DATABASE_URL;
if (!url) throw new Error("QA_DATABASE_URL wajib diisi.");
const nama = assertQaDb(url);
const admin = new URL(url); admin.pathname = "/postgres";
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ident = (n) => `"${n.replace(/"/g, '""')}"`;

const a = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
try {
  if (process.argv.includes("--reset")) await a.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(nama)} WITH (FORCE)`);
  const ada = await a.$queryRawUnsafe(`select 1 from pg_database where datname = '${nama}'`);
  if (!ada.length) await a.$executeRawUnsafe(`CREATE DATABASE ${ident(nama)}`);
} finally { await a.$disconnect(); }

execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy"], {
  cwd: backendRoot, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, DATABASE_URL: url },
});

const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const { driver } = await seedUsers(prisma);
await aktifkanFlagV2(prisma);
  const jobs = {};
  for (const label of ["A", "B", "C"]) jobs[label] = await seedJob(prisma, { driver, label });
  console.log(`\n[qa-manifest] DB ${nama} siap. Akun: ${QA_DRIVER_EMAIL} (driver), ${QA_ADMIN_EMAIL} (admin); kata sandi: lihat QA_PASSWORD di lib.mjs`);
  for (const [l, j] of Object.entries(jobs)) console.log(`  Job ${l}: ${j.order.orderNumber}  job=${j.job.id}  unit=${j.units.map((u) => u.unitCode.split("-").pop()).join("/")}`);
} finally { await prisma.$disconnect(); }
