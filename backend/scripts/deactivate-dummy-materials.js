// Nonaktifkan 15 material DUMMY lama (dibuat 19 Agustus 2026, sebelum
// katalog real dari stock opname diimpor 11 Sept 2026 — lihat
// import-warehouse-materials.js). TIDAK dihapus (reversibel), cuma
// active=false, supaya tidak numpuk di material picker bersama 301
// material real. Aman: 0 stock_movements/stock_count_lines mereferensikan
// material dummy ini (diverifikasi sebelum menjalankan script ini).
//
// DEFAULT DRY-RUN:
//   docker compose exec backend node scripts/deactivate-dummy-materials.js
//   docker compose exec backend node scripts/deactivate-dummy-materials.js --apply
import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");
const DUMMY_CODES = [
  "SPR-POCKET-STD", "SPR-BONNEL-STD", "FOAM-HD-D26", "FOAM-REBOND-D50",
  "FOAM-LATEX-D80", "PE-ENCASEMENT", "PAD-HARDPAD", "PAD-COTTONSHEET",
  "PAD-COCONUT", "FAB-KNIT-QUILT", "FAB-BORDER", "ADH-GLUE",
  "THR-SPOOL", "ZIP-HEAVY", "PKG-PLASTIC",
];

async function main() {
  const dummies = await prisma.material.findMany({ where: { code: { in: DUMMY_CODES } } });
  console.log(`${dummies.length} material dummy ditemukan.`);

  for (const m of dummies) {
    const [movementCount, countLineCount] = await Promise.all([
      prisma.stockMovement.count({ where: { materialId: m.id } }),
      prisma.stockCountLine.count({ where: { materialId: m.id } }),
    ]);
    if (movementCount > 0 || countLineCount > 0) {
      console.log(`⚠️ [DILEWATI - ADA AKTIVITAS] ${m.code} — ${movementCount} movement, ${countLineCount} count line. TIDAK dinonaktifkan.`);
      continue;
    }
    console.log(`[AKAN DINONAKTIFKAN] ${m.code} — ${m.name}`);
    if (APPLY) {
      await prisma.material.update({ where: { id: m.id }, data: { active: false } });
    }
  }

  if (!APPLY) console.log("\nIni DRY-RUN — jalankan ulang dengan --apply untuk benar-benar menulis.");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
