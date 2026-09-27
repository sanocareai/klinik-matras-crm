#!/usr/bin/env node
// Ops tool: rollback custody Gudang V2 (P1–P2) untuk cohort unit yang writer-nya sedang dimatikan.
// Membatalkan (CANCELLED) SELURUH handoff berstatus OFFERED milik unit yang diminta. TIDAK menghapus histori,
// TIDAK menyentuh handoff yang sudah ACCEPTED/REJECTED. Idempoten: aman dijalankan ulang (no-op untuk baris
// yang sudah tidak OFFERED); dengan --confirm-key yang SAMA, dijalankan ulang mengembalikan hasil identik (replay).
//
// Dokumentasi: docs/PRODUCTION-WAREHOUSE-V2-P1P2-INBOUND-CUSTODY.md § Rollback.
//   node scripts/production-delivery-v2/rollback-unit-custody-offers.js --unit-ids=<id1>,<id2> --reason="..." --confirm-key=<key> --apply
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { jsonForOutput, parseArgs, writeReport } from "./common.js";
import { rollbackUnitCustodyOffers } from "../../src/services/unitCustodyCommandService.js";

async function main() {
  const args = parseArgs();
  const unitIds = String(args["unit-ids"] || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!unitIds.length) throw new Error("--unit-ids wajib diisi (dipisah koma)");
  const reason = args.reason;
  if (!reason) throw new Error("--reason wajib diisi");
  const confirmKey = args["confirm-key"];
  if (!confirmKey) throw new Error("--confirm-key wajib diisi (dipakai sebagai Idempotency-Key; ulangi nilai yang sama untuk replay aman)");

  const prisma = new PrismaClient();
  try {
    const dryCount = await prisma.unitCustodyHandoff.count({ where: { unitId: { in: unitIds }, status: "OFFERED" } });
    const report = { reportType: "unit-custody-rollback", generatedAt: new Date().toISOString(), unitIds, reason, mode: args.apply ? "APPLY" : "DRY_RUN", offeredBeforeApply: dryCount };
    if (args.apply) {
      report.result = await rollbackUnitCustodyOffers(prisma, {
        unitIds, actorId: args["actor-id"] || "OWNER_OPS", idempotencyKey: `rollback-custody:${confirmKey}`, reason,
      });
    }
    writeReport(args.output, report);
    console.log(jsonForOutput(report));
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
