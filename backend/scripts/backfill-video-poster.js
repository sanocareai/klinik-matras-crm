// Backfill poster (cover) + dimensi tampil untuk video yang SUDAH ada.
//
// Video yang masuk SEBELUM 17 Agt 2026 tersimpan tanpa thumbUrl/mediaWidth/
// mediaHeight, jadi di aplikasi tetap tampil kotak hitam dengan rasio
// landscape yang salah — sama seperti bug sebelum diperbaiki. Skrip ini
// membuat posternya sekali untuk semua video lama.
//
// AMAN dijalankan berkali-kali (idempotent): hanya memproses baris yang
// thumbUrl-nya masih null, dan hanya kalau file videonya benar-benar ada.
//
// DEFAULT dry-run — jalankan dengan --apply untuk benar-benar menulis.
//   docker compose exec backend node scripts/backfill-video-poster.js
//   docker compose exec backend node scripts/backfill-video-poster.js --apply
//
// Tidak ada penghapusan data apa pun, jadi tidak perlu backup dulu — paling
// buruk yang terjadi adalah file poster menumpuk di uploads/ (kecil, ~30-60 KB
// per video) tanpa terpakai.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../src/db.js";
import { buatPosterVideo } from "../src/utils/videoThumb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "../uploads");
const APPLY = process.argv.includes("--apply");

async function main() {
  const videos = await prisma.message.findMany({
    where: { mediaType: "video", mediaUrl: { not: null }, thumbUrl: null },
    select: { id: true, mediaUrl: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  console.log(`${videos.length} video tanpa poster.`);
  console.log(APPLY ? "MODE: APPLY (menulis perubahan)" : "MODE: dry-run (tidak menulis apa pun)");

  let berhasil = 0, fileHilang = 0, gagalFfmpeg = 0;

  for (const v of videos) {
    const absPath = path.join(uploadsDir, path.basename(v.mediaUrl));
    if (!fs.existsSync(absPath)) {
      fileHilang += 1;
      continue;
    }
    if (!APPLY) {
      // Dry-run tetap MEMBACA file (untuk melaporkan jumlah yang realistis),
      // tapi tidak menjalankan ffmpeg — supaya pratinjau cepat dan tidak
      // menulis file poster apa pun ke disk.
      berhasil += 1;
      continue;
    }
    const hasil = await buatPosterVideo(absPath);
    if (!hasil) {
      gagalFfmpeg += 1;
      continue;
    }
    await prisma.message.update({
      where: { id: v.id },
      data: {
        thumbUrl: `/uploads/${hasil.filename}`,
        mediaWidth: hasil.width,
        mediaHeight: hasil.height,
      },
    });
    berhasil += 1;
    if (berhasil % 25 === 0) console.log(`  ...${berhasil} selesai`);
  }

  console.log("");
  console.log(`Selesai. ${APPLY ? "Diperbarui" : "Akan diproses"}: ${berhasil}`);
  console.log(`File video hilang dari disk (dilewati): ${fileHilang}`);
  if (APPLY) console.log(`Gagal diproses ffmpeg (dilewati): ${gagalFfmpeg}`);
  if (!APPLY) console.log("\nJalankan ulang dengan --apply untuk menerapkan.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
