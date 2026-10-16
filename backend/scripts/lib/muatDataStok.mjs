// Pemuat data BACA-SAJA untuk alat stok (impor file, rekonsiliasi catatan Gudang): dari dump CSV (baca_segar) atau langsung dari DB (transaksi READ ONLY).
import fs from "node:fs";
import path from "node:path";
import { parseCsvText } from "../../src/services/stokFileImport.js";

export function dariDump(dir) {
  const tabel = (n) => { const r = parseCsvText(fs.readFileSync(path.join(dir, `out_${n}.csv`), "utf8")); const h = r[0]; return r.slice(1).filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
  const materials = tabel("materials").map((m) => ({ id: m.id, code: m.code, name: m.name, unit: m.unit, active: m.active === "t", storageHint: m.storage_hint || "" }));
  const idPer = new Map(materials.map((m) => [m.code, m.id])); const ledger = new Map();
  for (const x of tabel("mov_all")) {
    const id = idPer.get(x.material_code); if (!id) continue;
    (ledger.get(id) || ledger.set(id, []).get(id)).push({ id: x.id, type: x.type, qty: Number(x.qty), createdAt: new Date(x.created_at), dokumen: x.dokumen, grArrivedDate: x.gr_arrived || null, jalur: x.jalur });
  }
  const pendingFull = tabel("pending").map((p) => ({ jenis: p.jenis, dok: p.dok, status: p.status, materialCode: p.material_code, qty: Number(p.q3 || p.q2 || p.q1) || null }));
  const pending = pendingFull.map((p) => ({ materialCode: p.materialCode, dok: p.dok, status: p.status }));
  const locations = tabel("locations").map((l) => ({ code: l.code, zone: l.zone, locationType: l.location_type, active: l.active === "t" }));
  const stempel = fs.existsSync(path.join(dir, "_stempel.txt")) ? fs.readFileSync(path.join(dir, "_stempel.txt"), "utf8").trim() : "";
  return { materials, ledger, pending, pendingFull, locations, stempel };
}

export async function dariDb() {
  const { prisma } = await import("../../src/db.js");
  const { muatDokumenTertunda } = await import("../../src/services/opnameCutover.js");
  const r = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const materials = (await tx.material.findMany({ select: { id: true, code: true, name: true, unit: true, active: true, storageHint: true } })).map((m) => ({ ...m, unit: String(m.unit), storageHint: m.storageHint || "" }));
    const mv = await tx.stockMovement.findMany({ select: { id: true, materialId: true, type: true, qty: true, createdAt: true, goodsReceipt: { select: { receiptNumber: true, arrivedDate: true } }, materialIssueId: true, stockCountId: true, stockAdjustmentRequestId: true, unitId: true }, orderBy: { createdAt: "asc" } });
    const ledger = new Map();
    for (const x of mv) {
      (ledger.get(x.materialId) || ledger.set(x.materialId, []).get(x.materialId)).push({
        id: x.id, type: x.type, qty: Number(x.qty), createdAt: x.createdAt, dokumen: x.goodsReceipt?.receiptNumber || null,
        grArrivedDate: x.goodsReceipt?.arrivedDate ? x.goodsReceipt.arrivedDate.toISOString().slice(0, 10) : null,
        jalur: x.goodsReceipt ? "GR" : x.materialIssueId ? "ISSUE_DOK" : x.stockCountId ? "COUNT" : x.stockAdjustmentRequestId ? "ADJ_DOK" : x.unitId ? "UNIT_LEPAS" : "TANPA_DOKUMEN",
      });
    }
    const pendingFull = await muatDokumenTertunda(tx);
    const locs = await tx.storageLocation.findMany({ select: { code: true, zone: true, locationType: true, active: true } });
    return { materials, ledger, pendingFull, pending: pendingFull.map((p) => ({ materialCode: p.materialCode, dok: p.dok, status: p.status })), locations: locs.map((l) => ({ code: l.code, zone: l.zone, locationType: String(l.locationType), active: l.active })) };
  }, { timeout: 60_000 });
  await prisma.$disconnect();
  return { ...r, stempel: `db ${new Date().toISOString()}` };
}
