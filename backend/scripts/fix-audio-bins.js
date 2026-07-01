// Script one-time: rename file audio .bin → .ogg di disk + update database
// Root cause: WAHA download mengembalikan Content-Type: application/octet-stream
// sehingga file suara tersimpan dengan ekstensi .bin, browser tidak bisa play.
//
// Jalankan: docker compose exec backend node scripts/fix-audio-bins.js

import { prisma } from "../src/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "../uploads");

async function fixAudioBins() {
  console.log("Mencari pesan audio dengan ekstensi .bin...");

  const messages = await prisma.message.findMany({
    where: {
      mediaType: "audio",
      mediaUrl: { endsWith: ".bin" },
    },
    select: { id: true, mediaUrl: true },
  });

  console.log(`Ditemukan ${messages.length} pesan audio dengan ekstensi .bin`);

  let renamed = 0;
  let missing = 0;
  let errors  = 0;

  for (const msg of messages) {
    const oldPath = path.join(uploadsDir, path.basename(msg.mediaUrl));
    const newName = path.basename(msg.mediaUrl).replace(/\.bin$/, ".ogg");
    const newPath = path.join(uploadsDir, newName);
    const newUrl  = `/uploads/${newName}`;

    if (!fs.existsSync(oldPath)) {
      console.log(`  SKIP (file tidak ada): ${msg.mediaUrl}`);
      missing++;
      continue;
    }

    try {
      fs.renameSync(oldPath, newPath);
      await prisma.message.update({
        where: { id: msg.id },
        data:  { mediaUrl: newUrl },
      });
      console.log(`  OK: ${msg.mediaUrl} → ${newUrl}`);
      renamed++;
    } catch (err) {
      console.error(`  ERROR id=${msg.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nSelesai — renamed: ${renamed}, file tidak ada: ${missing}, error: ${errors}`);
  await prisma.$disconnect();
}

fixAudioBins().catch((e) => { console.error(e); process.exit(1); });
