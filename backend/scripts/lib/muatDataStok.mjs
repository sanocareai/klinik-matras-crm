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
  const ada = (n) => fs.existsSync(path.join(dir, `out_${n}.csv`));
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const grLines = ada("gr_detail") ? tabel("gr_detail").map((g) => ({ receiptNumber: g.receipt_number, status: g.status, arrivedDate: g.arrived || null, receivedDate: g.received || null, suratJalan: g.surat_jalan, buktiFoto: Number(g.bukti_foto), materialCode: g.material_code, orderedQty: num(g.ordered_qty), receivedQty: num(g.received_qty), acceptedQty: num(g.accepted_qty), poNumber: g.po_number })) : [];
  const issueLedger = ada("issue_ledger") ? tabel("issue_ledger").map((x) => ({ materialCode: x.material_code, qty: Number(x.qty), unitCode: x.unit_code, note: x.note, createdAt: new Date(x.created_at) })) : [];
  const poLines = ada("po_lines") ? tabel("po_lines").map((p) => ({ poNumber: p.po_number, status: p.status, supplier: p.supplier, materialCode: p.material_code, qty: Number(p.qty), unit: p.unit })) : [];
  const stempel = fs.existsSync(path.join(dir, "_stempel.txt")) ? fs.readFileSync(path.join(dir, "_stempel.txt"), "utf8").trim() : "";
  return { materials, ledger, pending, pendingFull, locations, grLines, issueLedger, poLines, stempel };
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
    const grRaw = await tx.$queryRaw`SELECT g.receipt_number AS "receiptNumber", g.status::text AS status, to_char(g.arrived_date,'YYYY-MM-DD') AS "arrivedDate", to_char(g.received_date,'YYYY-MM-DD') AS "receivedDate", COALESCE(g.delivery_note,'') AS "suratJalan", COALESCE(array_length(g.arrival_proof_urls,1),0)::int AS "buktiFoto", m.code AS "materialCode", l.ordered_qty::float AS "orderedQty", l.received_qty::float AS "receivedQty", l.accepted_qty::float AS "acceptedQty", COALESCE(po.po_number,'') AS "poNumber" FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.goods_receipt_id JOIN materials m ON m.id=l.material_id LEFT JOIN fin_purchase_orders po ON po.id=g.purchase_order_id ORDER BY g.created_at, m.code`;
    const issRaw = await tx.$queryRaw`SELECT m.code AS "materialCode", sm.qty::float AS qty, COALESCE(u.unit_code,'') AS "unitCode", COALESCE(sm.note,'') AS note, sm.created_at AS "createdAt" FROM stock_movements sm JOIN materials m ON m.id=sm.material_id LEFT JOIN units u ON u.id=sm.unit_id WHERE sm.type='ISSUE' ORDER BY sm.created_at`;
    const poRaw = await tx.$queryRaw`SELECT po.po_number AS "poNumber", po.status::text AS status, COALESCE(s.name,'') AS supplier, m.code AS "materialCode", l.qty::float AS qty, l.unit FROM fin_purchase_order_lines l JOIN fin_purchase_orders po ON po.id=l.purchase_order_id JOIN materials m ON m.id=l.material_id LEFT JOIN fin_suppliers s ON s.id=po.supplier_id ORDER BY po.created_at`;
    const grLines = grRaw.map((g) => ({ ...g, arrivedDate: g.arrivedDate || null, receivedDate: g.receivedDate || null }));
    const issueLedger = issRaw.map((x) => ({ ...x, createdAt: new Date(x.createdAt) }));
    const poLines = poRaw;
    return { grLines, issueLedger, poLines, materials, ledger, pendingFull, pending: pendingFull.map((p) => ({ materialCode: p.materialCode, dok: p.dok, status: p.status })), locations: locs.map((l) => ({ code: l.code, zone: l.zone, locationType: String(l.locationType), active: l.active })) };
  }, { timeout: 60_000 });
  await prisma.$disconnect();
  return { ...r, stempel: `db ${new Date().toISOString()}` };
}
