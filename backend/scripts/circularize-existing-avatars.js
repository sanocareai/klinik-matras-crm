// Ubah foto profil LAMA (persegi, .jpg) jadi bulat+cincin putih (.png)
// SUPAYA ikon marker Live Tracking driver-mobile (VehicleMarker.js) juga
// tampil bulat untuk driver yang sudah pasang foto SEBELUM perubahan
// D-169 (19 September 2026) — kalau tidak dijalankan, avatar LAMA tetap
// persegi di peta selamanya sampai orangnya iseng ganti foto lagi.
// Upload BARU sudah otomatis bulat lewat services/avatarImage.js, script
// ini KHUSUS foto yang sudah ada sebelum perubahan itu.
//
// AMAN dijalankan berkali-kali (idempotent): pipeline baru SELALU
// menghasilkan nama file .png, pipeline lama SELALU .jpg — jadi
// avatarUrl yang sudah .png dilewati begitu saja (dianggap sudah pernah
// diproses), tidak pernah diproses dua kali.
//
// Jalankan:
//   docker compose exec backend node scripts/circularize-existing-avatars.js
//   docker compose exec backend node scripts/circularize-existing-avatars.js --apply

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { prisma } from "../src/db.js";
import { bulatkanFoto } from "../src/services/avatarImage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, "..");

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log("=== Bulatkan Foto Profil Lama ===");
  console.log(APPLY ? "MODE: APPLY (data akan diubah)" : "MODE: PRATINJAU (tidak ada yang diubah)");
  console.log("");

  const users = await prisma.user.findMany({
    where: { avatarUrl: { not: null } },
    select: { id: true, name: true, avatarUrl: true },
  });

  let sudahBulat = 0;
  let dikonversi = 0;
  let fileHilang = 0;
  let gagal = 0;

  for (const u of users) {
    if (u.avatarUrl.toLowerCase().endsWith(".png")) {
      sudahBulat += 1;
      continue;
    }

    const sourcePath = path.join(uploadsRoot, u.avatarUrl);
    if (!fs.existsSync(sourcePath)) {
      console.log(`⚠️  ${u.name} (${u.id}): file tidak ditemukan di disk (${u.avatarUrl}) — dilewati`);
      fileHilang += 1;
      continue;
    }

    console.log(`${APPLY ? "Mengonversi" : "Akan dikonversi"}: ${u.name} — ${u.avatarUrl}`);
    if (!APPLY) {
      dikonversi += 1;
      continue;
    }

    try {
      const buffer = fs.readFileSync(sourcePath);
      const png = await bulatkanFoto(buffer, 256, 10);

      const filename = `${u.id}-${Date.now()}.png`;
      const destPath = path.join(uploadsRoot, "uploads/avatars", filename);
      fs.writeFileSync(destPath, png);
      const newAvatarUrl = `/uploads/avatars/${filename}`;

      await prisma.user.update({ where: { id: u.id }, data: { avatarUrl: newAvatarUrl } });
      fs.unlink(sourcePath, () => {}); // fire-and-forget, sama pola dgn processAvatarUpload

      dikonversi += 1;
    } catch (err) {
      console.error(`❌  Gagal konversi ${u.name} (${u.id}):`, err.message);
      gagal += 1;
    }
  }

  console.log("");
  console.log(`Total avatar ditemukan : ${users.length}`);
  console.log(`Sudah bulat (dilewati) : ${sudahBulat}`);
  console.log(`${APPLY ? "Dikonversi" : "Akan dikonversi"}             : ${dikonversi}`);
  if (fileHilang > 0) console.log(`File hilang di disk    : ${fileHilang}`);
  if (gagal > 0) console.log(`Gagal konversi         : ${gagal}`);

  if (!APPLY && dikonversi > 0) {
    console.log("");
    console.log("──────────────────────────────────────────────────────────────");
    console.log("PRATINJAU — TIDAK ADA DATA YANG DIUBAH.");
    console.log("Kalau rencana di atas sudah benar, jalankan:");
    console.log("  docker compose exec backend node scripts/circularize-existing-avatars.js --apply");
    console.log("──────────────────────────────────────────────────────────────");
  }
}

main()
  .catch((e) => { console.error("Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
