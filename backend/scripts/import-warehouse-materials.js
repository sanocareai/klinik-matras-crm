// Import katalog material REAL dari stock opname Excel milik owner (11 Sept
// 2026), menggantikan 15 material dummy lama — 0 stock_movements/stock_counts
// mereferensikan material dummy itu (diverifikasi langsung ke DB produksi
// sebelum kerja ini dimulai), jadi TIDAK ADA risiko kehilangan data dengan
// mengganti katalog.
//
// Sumber draf: scripts/data/warehouse-import/catalog-draft.json, dihasilkan
// oleh generate-catalog.mjs (baca-saja, sudah direview manusia). Script ini
// HANYA menulis Material baru — TIDAK menghapus/mengubah material lama.
//
// Idempotent: skip material yang code-nya sudah ada.
//
// DEFAULT DRY-RUN — pola sama dengan backfill-production-routes.js:
//   docker compose exec backend node scripts/import-warehouse-materials.js
//   docker compose exec backend node scripts/import-warehouse-materials.js --apply
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

async function main() {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, "data/warehouse-import/catalog-draft.json"), "utf8")
  );
  console.log(`${catalog.length} material di draf.\n`);

  const existingCodes = new Set((await prisma.material.findMany({ select: { code: true } })).map((m) => m.code));

  let sudahAda = 0, akanDibuat = 0, dibuat = 0;
  const toCreate = [];

  for (const m of catalog) {
    if (existingCodes.has(m.code)) { sudahAda++; continue; }
    if (!m.unit) { console.log(`[DILEWATI - tanpa unit] ${m.name}`); continue; }
    akanDibuat++;
    toCreate.push({
      code: m.code,
      name: m.name,
      unit: m.unit,
      category: m.category || null,
      active: true,
    });
  }

  console.log(`Sudah ada: ${sudahAda} | Akan dibuat: ${akanDibuat}`);

  if (APPLY && toCreate.length) {
    const result = await prisma.material.createMany({ data: toCreate, skipDuplicates: true });
    dibuat = result.count;
    console.log(`Dibuat: ${dibuat} material.`);
  } else if (!APPLY) {
    console.log("\nIni DRY-RUN — jalankan ulang dengan --apply untuk benar-benar menulis.");
    console.log("Contoh 5 baris pertama yang akan dibuat:");
    for (const c of toCreate.slice(0, 5)) console.log(`  - [${c.code}] ${c.name} (${c.unit}, ${c.category || "tanpa kategori"})`);
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
