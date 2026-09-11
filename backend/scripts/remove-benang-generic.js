// Hapus material "BENANG" generik — baris asli di stock-op-2026.csv row 7
// (vendor TOKO KUNING, harga 130.000, qty Agustus 0), tapi dikonfirmasi
// user (12 Sept 2026) sebagai entri tidak jelas/tidak ada di Excel yang
// sebenarnya — beda dari varian spesifik yang tetap ada (BENANG GUJIR,
// BENANG HALUS HITAM 40/2, dst). Aman DIHAPUS (bukan cuma dinonaktifkan):
// 0 stock_movements, 0 stock_count_lines mereferensikannya.
//
// DEFAULT DRY-RUN:
//   docker compose exec backend node scripts/remove-benang-generic.js
//   docker compose exec backend node scripts/remove-benang-generic.js --apply
import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const material = await prisma.material.findUnique({ where: { code: "BENANG" } });
  if (!material) { console.log("Material BENANG tidak ditemukan — mungkin sudah dihapus."); return; }

  const [movementCount, countLineCount] = await Promise.all([
    prisma.stockMovement.count({ where: { materialId: material.id } }),
    prisma.stockCountLine.count({ where: { materialId: material.id } }),
  ]);
  if (movementCount > 0 || countLineCount > 0) {
    console.log(`⚠️ ADA AKTIVITAS (${movementCount} movement, ${countLineCount} count line) — TIDAK dihapus, perlu ditinjau manual.`);
    return;
  }

  console.log(`[AKAN DIHAPUS] ${material.code} — ${material.name}`);
  if (APPLY) {
    await prisma.material.delete({ where: { id: material.id } });
    console.log("Dihapus.");
  } else {
    console.log("\nIni DRY-RUN — jalankan ulang dengan --apply untuk benar-benar menghapus.");
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
