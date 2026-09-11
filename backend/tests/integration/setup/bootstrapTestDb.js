#!/usr/bin/env node
// Bootstrap database TES sekali sebelum test integrasi jalan — dipanggil
// lewat "pretest:integration" di package.json (npm otomatis menjalankan
// pre<script> sebelum <script>). Idempotent: aman dijalankan berkali-kali.
//
//   1. Buat database (kalau belum ada) di server Postgres LOKAL yang sama
//      dengan dev (docker-compose.yml service "postgres") — TERPISAH dari
//      "klinik_matras" (dev) dan JELAS BUKAN database produksi (yang cuma
//      bisa diakses lewat VPS, tidak pernah dari mesin ini).
//   2. Jalankan `prisma migrate deploy` terhadap database itu — schema tes
//      SELALU persis sama dengan migration history sungguhan, bukan
//      `db push` yang bisa diam-diam beda dari apa yang benar-benar
//      di-deploy.
//
// SENGAJA pakai @prisma/client (sudah jadi dependency) untuk koneksi
// maintenance, BUKAN menambah paket `pg` baru cuma untuk satu script ini.
import "./env.js"; // set + validasi DATABASE_URL SEBELUM apa pun lain
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../..");

async function main() {
  const testUrl = new URL(process.env.DATABASE_URL);
  const dbName = testUrl.pathname.replace(/^\//, "");

  // Konek ke database "postgres" (maintenance DB bawaan) di server YANG
  // SAMA untuk CREATE DATABASE — tidak bisa CREATE DATABASE sambil
  // terkoneksi ke database yang mau dibuat sendiri.
  const maintenanceUrl = new URL(testUrl);
  maintenanceUrl.pathname = "/postgres";

  const admin = new PrismaClient({ datasources: { db: { url: maintenanceUrl.toString() } } });
  try {
    const rows = await admin.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = $1`, dbName);
    if (rows.length === 0) {
      console.log(`[bootstrapTestDb] Database "${dbName}" belum ada — membuat...`);
      // Identifier tidak bisa diparameterkan di Postgres — nama sudah
      // divalidasi mengandung "test" di env.js, tapi tetap escape kutip
      // ganda dengan benar, bukan asal concat string.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`[bootstrapTestDb] Database "${dbName}" dibuat.`);
    } else {
      console.log(`[bootstrapTestDb] Database "${dbName}" sudah ada, lanjut migrate.`);
    }
  } finally {
    await admin.$disconnect();
  }

  console.log("[bootstrapTestDb] Menjalankan prisma migrate deploy...");
  // shell:true WAJIB di Windows — "npx" sebenarnya "npx.cmd", dan
  // execFileSync tanpa shell tidak resolve ekstensi itu (ENOENT walau
  // "npx" jelas ada & jalan normal di terminal biasa). Node memperingatkan
  // shell:true berisiko kalau argumennya dari input tidak tepercaya —
  // di sini SEMUA argumen adalah literal hardcode di file ini sendiri,
  // tidak ada input eksternal yang masuk ke array ini, jadi aman.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "inherit",
    shell: true,
  });
  console.log("[bootstrapTestDb] Selesai — database tes siap dipakai.");
}

main().catch((err) => {
  console.error("[bootstrapTestDb] GAGAL:", err.message);
  process.exit(1);
});
