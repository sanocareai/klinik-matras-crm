// Publikasikan bundle baru APK Driver ke OTA self-hosted (9 September 2026)
// — lihat catatan panjang di routes/driverApp.js & schema.prisma
// DriverAppBundle. Dijalankan MANUAL (dispatcher/admin/saya lewat SSH),
// BUKAN endpoint upload HTTP — pola sama dengan seed-toll-roads.js (script
// CLI dry-run/--apply), publish bundle adalah aksi dev-time yang jarang,
// bukan fitur yang butuh UI admin.
//
// PRASYARAT: `frontend/dist-driver` SUDAH di-build lebih dulu
// (cd frontend && npm run build:capacitor:driver) — script ini TIDAK
// menjalankan build, cuma mem-zip hasil build yang sudah ada, supaya jelas
// terpisah "build kode" vs "publikasikan bundle" (dua langkah sadar, bukan
// satu tombol ajaib yang menyembunyikan apa yang sebenarnya terjadi).
//
// index.html WAJIB ada di ROOT zip (syarat plugin @capgo/capacitor-updater)
// — di-zip dari DALAM folder dist-driver (`zip -r ... .`), bukan folder
// dist-driver itu sendiri, supaya tidak ada folder pembungkus tambahan di
// dalam zip.
//
// PEMAKAIAN (dry-run dulu):
//   node scripts/publish-driver-bundle.js
//   node scripts/publish-driver-bundle.js --apply
//   node scripts/publish-driver-bundle.js --apply --channel=staging --notes="test tombol baru"

import { prisma } from "../src/db.js";
import { existsSync, mkdirSync, readFileSync, copyFileSync, createReadStream } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const channelArg = process.argv.find((a) => a.startsWith("--channel="));
const notesArg = process.argv.find((a) => a.startsWith("--notes="));
const channel = channelArg ? channelArg.split("=")[1] : "production";
const notes = notesArg ? notesArg.split("=").slice(1).join("=") : null;

const distDriverDir = path.join(__dirname, "../../frontend/dist-driver");
const bundlesDir = path.join(__dirname, "../data/driver-app-bundles");

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database + zip file)" : "DRY-RUN (cuma pratinjau)"}`);
  console.log(`Channel: ${channel}\n`);

  if (!existsSync(path.join(distDriverDir, "index.html"))) {
    throw new Error(
      `${distDriverDir}/index.html tidak ditemukan — jalankan dulu:\n  cd frontend && npm run build:capacitor:driver`
    );
  }

  const latest = await prisma.driverAppBundle.findFirst({
    where: { channel },
    orderBy: { buildNumber: "desc" },
  });
  const nextBuildNumber = (latest?.buildNumber || 0) + 1;
  const zipFilename = `driver-${channel}-build${nextBuildNumber}.zip`;
  const zipPath = path.join(bundlesDir, zipFilename);

  console.log(`Build #${nextBuildNumber} — ${zipFilename}`);

  if (!APPLY) {
    console.log("\nJalankan ulang dengan --apply untuk benar-benar mem-zip + menulis ke database.");
    return;
  }

  mkdirSync(bundlesDir, { recursive: true });
  // Zip ISI dist-driver (bukan foldernya sendiri) — cwd di dalam
  // dist-driver, target absolut di luar supaya tidak ikut ter-zip.
  execSync(`zip -r "${zipPath}" .`, { cwd: distDriverDir, stdio: "inherit" });

  const checksum = await sha256File(zipPath);
  console.log(`Checksum sha256: ${checksum}`);

  await prisma.$transaction(async (tx) => {
    await tx.driverAppBundle.updateMany({
      where: { channel, active: true },
      data: { active: false },
    });
    await tx.driverAppBundle.create({
      data: { buildNumber: nextBuildNumber, channel, zipFilename, checksum, notes },
    });
  });

  console.log(`\nSelesai — build #${nextBuildNumber} aktif di channel "${channel}".`);
  console.log(`Device akan menerima update ini begitu app driver dibuka lagi (autoUpdate: onLaunch).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
