// Pergerakan ledger untuk PENYIAPAN data tes valuasi: memanggil postStockMovement (SATU-SATUNYA jalur tulis ledger, termasuk pembekuan valuasi unit)
// langsung di dalam transaksi. Dipakai karena rute jalur cepat /movements/receipt|return|waste ditutup permanen (410, Okt 2026) dan tes valuasi
// tidak menguji rute itu — hanya efek pergerakan yang bertaut unit. Bentuk hasil menyerupai respons HTTP supaya assertion lama tetap terbaca.
import { postStockMovement } from "../../../src/services/inventoryLedger.js";
import { testPrisma } from "./testDb.js";

export async function tulisPergerakanLedger({ materialId, type, qty, unitId, reason, note, unitCost, supplier, createdById }) {
  try {
    const m = await testPrisma.$transaction((tx) => postStockMovement(tx, { materialId, type, qty, unitId, reason, note, unitCost, supplier, createdById }));
    return { status: 201, body: m };
  } catch (e) {
    return { status: typeof e.statusCode === "number" ? e.statusCode : 500, body: { error: e.message } };
  }
}
