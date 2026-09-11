// Saldo pembuka 1 September 2026 — backfill lewat StockCount/StockCountLine
// resmi (bukan raw StockMovement), meniru PERSIS logika endpoint
// POST /stock-counts/:id/complete di routes/stockCount.js: systemQty (di
// sini 0, katalog baru dibuat scripts/import-warehouse-materials.js) vs
// countedQty (saldo fisik 31 Agustus) -> selisih ditulis sebagai SATU
// StockMovement ADJUSTMENT per material dengan reason wajib.
//
// createdById SENGAJA null di semua tempat — ini migrasi data historis,
// bukan aksi user yang benar-benar melakukannya saat itu (prinsip atribusi
// jujur: jangan pura-pura ada orang yang mengklik tombol).
// Timestamp SENGAJA di-backdate ke 1 Sept 2026 WIB (bukan waktu import
// sungguhan) lewat startOfDayWIB() — dokumen ini MEWAKILI kejadian
// historis (SO dicek 3 Agustus 2026, jadi saldo pembuka 1 September).
//
// Sumber draf: scripts/data/warehouse-import/baseline-stock-draft.json,
// dihasilkan generate-baseline-stock.mjs (baca-saja, sudah direview).
//
// Idempotent: kalau countNumber ini sudah ada, script berhenti tanpa
// menulis apa pun lagi (mencegah dobel-ADJUSTMENT kalau tidak sengaja
// dijalankan 2x).
//
// DEFAULT DRY-RUN:
//   docker compose exec backend node scripts/import-warehouse-baseline-stock.js
//   docker compose exec backend node scripts/import-warehouse-baseline-stock.js --apply
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../src/db.js";
import { startOfDayWIB } from "../src/utils/wib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const COUNT_NUMBER = "CC-01092026-BASELINE";

async function main() {
  const draft = JSON.parse(
    fs.readFileSync(path.join(__dirname, "data/warehouse-import/baseline-stock-draft.json"), "utf8")
  );
  console.log(`${draft.lines.length} baris saldo pembuka di draf.\n`);

  const already = await prisma.stockCount.findUnique({ where: { countNumber: COUNT_NUMBER } });
  if (already) {
    console.log(`StockCount ${COUNT_NUMBER} SUDAH ADA (status ${already.status}, dibuat ${already.createdAt.toISOString()}) — berhenti, tidak menulis apa pun lagi.`);
    return;
  }

  const materials = await prisma.material.findMany({
    where: { code: { in: draft.lines.map((l) => l.materialCode) } },
    select: { id: true, code: true },
  });
  const materialIdByCode = new Map(materials.map((m) => [m.code, m.id]));

  const missing = draft.lines.filter((l) => !materialIdByCode.has(l.materialCode));
  if (missing.length) {
    console.log(`⚠️ ${missing.length} material di draf belum ada di DB (jalankan import-warehouse-materials.js --apply dulu):`);
    for (const m of missing) console.log(`  - ${m.materialCode} (${m.materialName})`);
    if (missing.length === draft.lines.length) return;
  }

  const validLines = draft.lines.filter((l) => materialIdByCode.has(l.materialCode));
  const backdatedAt = startOfDayWIB("2026-09-01");

  console.log(`Akan membuat StockCount ${COUNT_NUMBER} (status COMPLETED langsung, backdated ke ${backdatedAt.toISOString()})`);
  console.log(`${validLines.length} StockCountLine + ${validLines.length} StockMovement ADJUSTMENT.`);

  if (!APPLY) {
    console.log("\nIni DRY-RUN — jalankan ulang dengan --apply untuk benar-benar menulis.");
    console.log("Contoh 5 baris pertama:");
    for (const l of validLines.slice(0, 5)) console.log(`  - ${l.materialName}: saldo ${l.countedQty} ${l.unit}`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const count = await tx.stockCount.create({
      data: {
        countNumber: COUNT_NUMBER,
        countType: draft.countType,
        countMethod: draft.countMethod,
        scheduledDate: new Date(`${draft.scheduledDate}T00:00:00.000Z`),
        blindCount: draft.blindCount,
        notes: draft.notes,
        status: "COMPLETED",
        startedAt: backdatedAt,
        submittedAt: backdatedAt,
        completedAt: backdatedAt,
        createdAt: backdatedAt,
        createdById: null,
        reviewedById: null,
      },
    });

    for (const l of validLines) {
      const materialId = materialIdByCode.get(l.materialCode);
      await tx.stockCountLine.create({
        data: {
          stockCountId: count.id,
          materialId,
          systemQty: l.systemQty,
          countedQty: l.countedQty,
          reason: l.reason,
        },
      });
      if (l.variance !== 0) {
        await tx.stockMovement.create({
          data: {
            materialId,
            type: "ADJUSTMENT",
            qty: l.variance,
            reason: l.reason,
            note: `Stock Count ${count.countNumber}`,
            stockCountId: count.id,
            createdById: null,
            createdAt: backdatedAt,
          },
        });
      }
    }

    console.log(`Dibuat: StockCount ${count.id}, ${validLines.length} baris + movement ADJUSTMENT.`);
  });
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
