// Sandbox#8 — Terpakai dihitung dari bukti tahap (6/7/10, payload.materials), bukan dari reservasi yang dikonsumsi Gudang.
import test from "node:test";
import assert from "node:assert/strict";
import { usedQtyByMaterial } from "../src/services/productionUnitOverviewService.js";

test("usedQtyByMaterial menjumlah qty bahan per tahap 6/7/10 (termasuk rework) dan mengabaikan tahap lain", () => {
  const m = usedQtyByMaterial([
    { stepNo: 6, payload: { materials: [{ materialId: "A", qty: 4 }, { materialId: "B", qty: 1.5 }] } },
    { stepNo: 7, payload: { materials: [{ materialId: "A", qty: 1 }] } },
    { stepNo: 7, payload: { materials: [{ materialId: "A", qty: 0.5 }] } }, // ulang (rework)
    { stepNo: 8, payload: { materials: [{ materialId: "A", qty: 99 }] } },   // bukan tahap bahan
    { stepNo: 5, payload: { diagnosis: "x" } },
    { stepNo: 10, payload: {} },
  ]);
  assert.equal(m.get("A"), 5.5); assert.equal(m.get("B"), 1.5);
  assert.equal(usedQtyByMaterial(null).size, 0);
});
