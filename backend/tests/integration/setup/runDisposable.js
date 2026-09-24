#!/usr/bin/env node
// Jalankan suite integrasi pada database tes SEKALI-PAKAI (unik per run), bukan database bersama yang bisa drift.
//   npm run test:integration:clean                 -> semua *.integration.test.js, serial
//   npm run test:integration:clean -- tests/integration/financeBuku.integration.test.js   -> file tertentu
//   KEEP_TEST_DB=1 ...                              -> jangan hapus DB setelahnya (untuk investigasi)
//   TEST_RUNS=3 ...                                 -> ulangi (DB baru tiap run) — dipakai gate 3x berturut-turut
//
// Alur: buat DB `klinik_matras_test_run_<id>` -> `prisma migrate deploy` dari NOL (bukti migrasi history utuh) -> node --test
// --test-concurrency=1 -> DROP DATABASE. Pagar env.js tetap berlaku (nama harus mengandung "test").
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../..");
const BASE = process.env.TEST_DB_SERVER_URL || "postgresql://klinik:KlinikMatras2026Aman@localhost:5432/postgres";

function urlUntuk(nama) { const u = new URL(BASE); u.pathname = `/${nama}`; return u.toString(); }

function daftarTes(args) {
  if (args.length) return args;
  const dir = path.join(backendRoot, "tests/integration");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".integration.test.js")).sort().map((f) => `tests/integration/${f}`);
}

async function satuRun(args, nomor) {
  const nama = `klinik_matras_test_run_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const admin = new PrismaClient({ datasources: { db: { url: urlUntuk("postgres") } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${nama}"`);
  console.log(`[disposable] run ${nomor}: database ${nama}`);
  const env = { ...process.env, TEST_DATABASE_URL: urlUntuk(nama) };
  let kode = 1;
  try {
    const boot = spawnSync(process.execPath, [path.join(__dirname, "bootstrapTestDb.js")], { cwd: backendRoot, env, stdio: "inherit" });
    if (boot.status !== 0) { console.error("[disposable] migrate dari nol GAGAL"); return 1; }
    const t = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...daftarTes(args)], { cwd: backendRoot, env, stdio: "inherit" });
    kode = t.status ?? 1;
  } finally {
    if (process.env.KEEP_TEST_DB === "1") console.log(`[disposable] DB dipertahankan: ${nama}`);
    else {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nama}" WITH (FORCE)`).catch((e) => console.error("[disposable] gagal drop:", e.message));
      console.log(`[disposable] database ${nama} dihapus`);
    }
    await admin.$disconnect();
  }
  return kode;
}

const runs = Number(process.env.TEST_RUNS || 1);
let gagal = 0;
for (let i = 1; i <= runs; i++) { const k = await satuRun(process.argv.slice(2), i); console.log(`[disposable] run ${i}/${runs}: ${k === 0 ? "LULUS" : "GAGAL"}`); if (k !== 0) gagal++; }
process.exit(gagal ? 1 : 0);
