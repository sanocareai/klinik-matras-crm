// Import katalog material REAL dari stock opname Excel milik owner (11 Sept
// 2026), menggantikan 15 material dummy lama — 0 stock_movements/stock_counts
// mereferensikan material dummy itu (diverifikasi langsung ke DB produksi
// sebelum kerja ini dimulai), jadi TIDAK ADA risiko kehilangan data dengan
// mengganti katalog.
//
// Sumber draf: scripts/data/warehouse-import/catalog-draft.json, dihasilkan
// oleh generate-catalog.mjs (baca-saja, sudah direview manusia).
//
// Dua mode kerja, keduanya idempotent:
//   1. Material yang code-nya BELUM ADA -> dibuat baru (semua field).
//   2. Material yang code-nya SUDAH ADA -> field REFERENSI (vendor,
//      itemGroup, referenceUnitCost/-Month, referenceStockValue/-Month)
//      di-UPDATE dari draf (12 Sept 2026 — field ini ditambahkan setelah
//      301 material pertama sudah masuk, jadi mereka belum pernah dapat
//      nilai ini). Field non-referensi (name/unit/category/active) TIDAK
//      disentuh untuk yang sudah ada — kalau sudah pernah diedit manual di
//      UI, jangan ditimpa diam-diam oleh re-run import.
//
// DEFAULT DRY-RUN:
//   docker compose exec backend node scripts/import-warehouse-materials.js
//   docker compose exec backend node scripts/import-warehouse-materials.js --apply
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

// Koreksi EKSPLISIT disetujui user (11 Sept 2026) — di luar backfill normal
// (yang cuma isi field yang masih kosong), karena sheet sumber diperbaiki
// pemiliknya SETELAH material ini sudah pernah di-backfill (nilai lama:
// harga Juni Rp79.803 — ternyata salah/kosong di sheet baru, koreksi
// bulan sumbernya jadi Mei). SENGAJA daftar terpisah & kecil supaya jelas
// ini timpa data yang SUDAH ADA, bukan backfill silent seperti field lain.
const FORCE_CORRECTIONS = {
  "KAIN-LAVA-PREMIUM-NATURAL": {
    referenceUnitCost: 85803, referenceUnitCostMonth: "2026-05",
    referenceStockValue: 2145075, referenceStockValueMonth: "2026-05",
  },
};

function referenceFields(m) {
  return {
    vendor: m.vendor || null,
    itemGroup: m.itemGroup || null,
    referenceUnitCost: m.referenceUnitCost ?? null,
    referenceUnitCostMonth: m.referenceUnitCostMonth ?? null,
    referenceStockValue: m.referenceStockValue ?? null,
    referenceStockValueMonth: m.referenceStockValueMonth ?? null,
    dataNote: m.dataNote ?? null,
  };
}

async function main() {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, "data/warehouse-import/catalog-draft.json"), "utf8")
  );
  console.log(`${catalog.length} material di draf.\n`);

  const existing = await prisma.material.findMany({
    select: { id: true, code: true, vendor: true, itemGroup: true, referenceUnitCost: true, referenceStockValue: true, dataNote: true },
  });
  const existingByCode = new Map(existing.map((m) => [m.code, m]));

  const toCreate = [];
  const toUpdate = [];

  for (const m of catalog) {
    const found = existingByCode.get(m.code);
    if (!found) {
      if (!m.unit) { console.log(`[DILEWATI - tanpa unit] ${m.name}`); continue; }
      toCreate.push({ code: m.code, name: m.name, unit: m.unit, category: m.category || null, active: true, ...referenceFields(m) });
      continue;
    }
    // Sudah ada — cek apakah field referensinya masih kosong (belum pernah
    // di-backfill) DAN draf punya sesuatu untuk diisi.
    const ref = referenceFields(m);
    const needsBackfill = (found.vendor == null && ref.vendor != null)
      || (found.itemGroup == null && ref.itemGroup != null)
      || (found.referenceUnitCost == null && ref.referenceUnitCost != null)
      || (found.referenceStockValue == null && ref.referenceStockValue != null)
      || (found.dataNote == null && ref.dataNote != null);
    if (needsBackfill) toUpdate.push({ id: found.id, code: m.code, ...ref });
  }

  const toCorrect = [];
  for (const [code, fields] of Object.entries(FORCE_CORRECTIONS)) {
    const found = existingByCode.get(code);
    if (found) toCorrect.push({ id: found.id, code, ...fields });
  }

  console.log(`Sudah ada (semua field): ${existingByCode.size - toUpdate.length}`);
  console.log(`Akan dibuat baru: ${toCreate.length}`);
  console.log(`Akan di-backfill (field referensi kosong): ${toUpdate.length}`);
  console.log(`Akan dikoreksi (timpa data lama, disetujui user): ${toCorrect.length}`);

  if (!APPLY) {
    console.log("\nIni DRY-RUN — jalankan ulang dengan --apply untuk benar-benar menulis.");
    console.log("Contoh 5 baris pertama yang akan dibuat:");
    for (const c of toCreate.slice(0, 5)) console.log(`  - [${c.code}] ${c.name} (${c.unit}, ${c.category || "tanpa kategori"})`);
    console.log("Contoh 5 baris pertama yang akan di-backfill:");
    for (const c of toUpdate.slice(0, 5)) console.log(`  - [${c.code}] vendor=${c.vendor} itemGroup=${c.itemGroup} cost=${c.referenceUnitCost} value=${c.referenceStockValue} dataNote=${c.dataNote}`);
    if (toCorrect.length) {
      console.log("Koreksi yang akan ditimpa:");
      for (const c of toCorrect) console.log(`  - [${c.code}] cost=${c.referenceUnitCost} (${c.referenceUnitCostMonth}) value=${c.referenceStockValue} (${c.referenceStockValueMonth})`);
    }
    return;
  }

  if (toCreate.length) {
    const result = await prisma.material.createMany({ data: toCreate, skipDuplicates: true });
    console.log(`Dibuat: ${result.count} material.`);
  }
  if (toUpdate.length) {
    let count = 0;
    for (const u of toUpdate) {
      const { id, code, ...data } = u;
      await prisma.material.update({ where: { id }, data });
      count++;
    }
    console.log(`Di-backfill: ${count} material.`);
  }
  if (toCorrect.length) {
    let count = 0;
    for (const u of toCorrect) {
      const { id, code, ...data } = u;
      await prisma.material.update({ where: { id }, data });
      count++;
    }
    console.log(`Dikoreksi: ${count} material.`);
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
