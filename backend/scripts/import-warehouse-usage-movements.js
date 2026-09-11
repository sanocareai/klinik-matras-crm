// Pemakaian bahan REAL per order (1-8 Sept 2026), dari rekap Excel owner —
// 254 StockMovement type ISSUE, terhubung ke Unit produksi ASLI (bukan data
// siloed): 34 order, SEMUA sudah diverifikasi 1:1 ke Unit lewat SQL langsung
// terhadap DB produksi (tidak ada order dengan >1 Unit, jadi unitId tidak
// ambigu). Peta koreksi nomor order (order-correction-map.json) memakai 3
// metode berjenjang (exact -> sisip dash -> rekonstruksi tahun) + 2 kasus
// dikonfirmasi manual lewat nama customer (CO25082026014 = Lydia Christine,
// RES300626163 = Ingke, keduanya dikonfirmasi user 11 Sept 2026).
//
// createdById SENGAJA null (migrasi data historis, bukan aksi user
// sungguhan). createdAt di-backdate ke "Tgl Selesai" asli per baris (WIB,
// lewat startOfDayWIB) — BUKAN waktu import.
//
// Sumber draf: scripts/data/warehouse-import/usage-import-draft.json,
// dihasilkan generate-usage-import.mjs (baca-saja, sudah direview).
//
// Idempotent: kalau SUDAH ADA StockMovement dengan note diawali
// "Impor pemakaian Sept 2026", script berhenti tanpa menulis apa pun lagi.
//
// DEFAULT DRY-RUN:
//   docker compose exec backend node scripts/import-warehouse-usage-movements.js
//   docker compose exec backend node scripts/import-warehouse-usage-movements.js --apply
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../src/db.js";
import { startOfDayWIB } from "../src/utils/wib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const NOTE_PREFIX = "Impor pemakaian Sept 2026";

async function main() {
  const movements = JSON.parse(
    fs.readFileSync(path.join(__dirname, "data/warehouse-import/usage-import-draft.json"), "utf8")
  );
  console.log(`${movements.length} movement ISSUE di draf.\n`);

  const already = await prisma.stockMovement.findFirst({ where: { note: { startsWith: NOTE_PREFIX } } });
  if (already) {
    console.log(`Sudah ada StockMovement dengan note "${NOTE_PREFIX}..." (id ${already.id}) — berhenti, tidak menulis apa pun lagi.`);
    return;
  }

  const materials = await prisma.material.findMany({
    where: { code: { in: [...new Set(movements.map((m) => m.materialCode))] } },
    select: { id: true, code: true },
  });
  const materialIdByCode = new Map(materials.map((m) => [m.code, m.id]));

  const unitIds = [...new Set(movements.map((m) => m.unitId))];
  const units = await prisma.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true } });
  const validUnitIds = new Set(units.map((u) => u.id));

  const missingMaterial = movements.filter((m) => !materialIdByCode.has(m.materialCode));
  const missingUnit = movements.filter((m) => !validUnitIds.has(m.unitId));
  if (missingMaterial.length) {
    console.log(`⚠️ ${missingMaterial.length} baris materialnya belum ada di DB (jalankan import-warehouse-materials.js --apply dulu):`);
    for (const m of missingMaterial.slice(0, 10)) console.log(`  - ${m.materialCode} (${m.materialName})`);
  }
  if (missingUnit.length) {
    console.log(`⚠️ ${missingUnit.length} baris unitId-nya tidak ditemukan di DB (order berubah/dihapus sejak snapshot):`);
    for (const m of missingUnit.slice(0, 10)) console.log(`  - ${m.realOrderNumber} (unitId ${m.unitId})`);
  }

  const validMovements = movements.filter((m) => materialIdByCode.has(m.materialCode) && validUnitIds.has(m.unitId));
  console.log(`\nMovement siap ditulis: ${validMovements.length} / ${movements.length}`);

  if (!APPLY) {
    console.log("\nIni DRY-RUN — jalankan ulang dengan --apply untuk benar-benar menulis.");
    console.log("Contoh 5 baris pertama:");
    for (const m of validMovements.slice(0, 5)) {
      console.log(`  - order ${m.realOrderNumber} | ${m.materialName} | qty ${m.qty} | tgl ${m.tglSelesai}`);
    }
    return;
  }

  const data = validMovements.map((m) => ({
    materialId: materialIdByCode.get(m.materialCode),
    type: "ISSUE",
    qty: m.qty,
    location: m.location,
    unitId: m.unitId,
    note: `${NOTE_PREFIX} — order asli: ${m.orderRaw} -> ${m.realOrderNumber}`,
    createdById: null,
    createdAt: startOfDayWIB(m.tglSelesai),
  }));

  const result = await prisma.stockMovement.createMany({ data });
  console.log(`Dibuat: ${result.count} StockMovement ISSUE.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
