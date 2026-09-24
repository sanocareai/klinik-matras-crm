#!/usr/bin/env node
// Runner test integrasi dengan DATABASE UNIK PER RUN (24 September 2026).
//
// Masalah yang diselesaikan: beberapa sesi/pengembang menjalankan suite pada Postgres yang sama. Bila semuanya
// memakai database tes yang sama (klinik_matras_test), TRUNCATE satu sesi mengunci/menghapus data sesi lain
// (kegagalan acak, deadlock, P2028). Runner ini membuat database baru km_it_<waktu>_<pid>_test, menjalankan
// `prisma migrate deploy`, menjalankan suite SERIAL (--test-concurrency=1) terhadapnya, lalu MENGHAPUSNYA.
//
// Keamanan cleanup: DROP DATABASE hanya untuk nama yang (a) dibuat proses ini, dan (b) cocok pola
// /^km_it_[a-z0-9]+_\d+_test$/. Database lain (termasuk klinik_matras_test milik sesi lain) tidak pernah disentuh.
//
// Pemakaian:  node tests/integration/setup/runIsolated.js [berkas-tes ...]
//   tanpa argumen  -> tests/integration/*.integration.test.js
//   KEEP_TEST_DB=1 -> database tidak dihapus (untuk investigasi kegagalan)
import { TEST_DATABASE_URL } from "./env.js"; // validasi pagar keamanan + muat .env
import { PrismaClient } from "@prisma/client";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const POLA_AMAN = /^km_it_[a-z0-9]+_\d+_test$/;

const dbName = `km_it_${Date.now().toString(36)}_${process.pid}_test`;
if (!POLA_AMAN.test(dbName)) throw new Error(`Nama database tidak sesuai pola aman: ${dbName}`);

const dasar = new URL(TEST_DATABASE_URL);
const urlDb = new URL(dasar);
urlDb.pathname = `/${dbName}`;
const urlAdmin = new URL(dasar);
urlAdmin.pathname = "/postgres";

const ident = (n) => `"${n.replace(/"/g, '""')}"`;
let dibuat = false;
let anak = null;

async function admin(fn) {
  const c = new PrismaClient({ datasources: { db: { url: urlAdmin.toString() } } });
  try { return await fn(c); } finally { await c.$disconnect(); }
}

async function hapusDb() {
  if (!dibuat) return;
  if (process.env.KEEP_TEST_DB === "1") {
    console.log(`[runIsolated] KEEP_TEST_DB=1 — database ${dbName} DIPERTAHANKAN untuk investigasi.`);
    return;
  }
  if (!POLA_AMAN.test(dbName)) return;
  try {
    await admin((c) => c.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(dbName)} WITH (FORCE)`));
    console.log(`[runIsolated] Database ${dbName} dihapus.`);
  } catch (e) {
    console.error(`[runIsolated] PERINGATAN: gagal menghapus ${dbName}: ${e.message}`);
  }
  dibuat = false;
}

async function main() {
  const berkas = process.argv.slice(2);
  await admin((c) => c.$executeRawUnsafe(`CREATE DATABASE ${ident(dbName)}`));
  dibuat = true;
  console.log(`[runIsolated] Database unik ${dbName} dibuat; menjalankan migrate deploy...`);
  // shell:true wajib di Windows (npx = npx.cmd); semua argumen literal.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendRoot, env: { ...process.env, DATABASE_URL: urlDb.toString() }, stdio: "inherit", shell: true,
  });

  const target = berkas.length ? berkas : ["tests/integration/*.integration.test.js"];
  const kode = await new Promise((resolve) => {
    anak = spawn(process.execPath, ["--test", "--test-concurrency=1", ...target], {
      cwd: backendRoot, stdio: "inherit",
      env: { ...process.env, TEST_DATABASE_URL: urlDb.toString(), DATABASE_URL: urlDb.toString() },
    });
    anak.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  await hapusDb();
  process.exit(kode);
}

for (const sinyal of ["SIGINT", "SIGTERM"]) {
  process.on(sinyal, async () => {
    if (anak) anak.kill();
    await hapusDb();
    process.exit(130);
  });
}

main().catch(async (err) => {
  console.error("[runIsolated] GAGAL:", err.message);
  await hapusDb();
  process.exit(1);
});
