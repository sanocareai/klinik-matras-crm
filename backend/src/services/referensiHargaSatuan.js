// HARGA REFERENSI AGUSTUS (Material.referenceUnitCost, snapshot impor Excel) dinyatakan per SATUAN ASAL bahan (satuan_lama transisi pertama). Sesudah transisi satuan, angka itu TIDAK berlaku untuk satuan baru:
// pembaca menandai satuan tidak cocok dan tidak menghasilkan angka pembanding. Modul ini sengaja tanpa impor (dipakai ledger/Finance tanpa risiko impor melingkar). Baca-saja.
/** Map(materialId → { satuanReferensi, satuanSekarang }) untuk bahan yang referensinya TIDAK cocok dengan satuan sekarang. materialIds=null → semua bahan bertransisi. */
export async function referensiTidakCocok(db, materialIds = null) {
  if (materialIds && !materialIds.length) return new Map();
  const ts = await db.materialUnitTransition.findMany({ where: materialIds ? { materialId: { in: materialIds } } : {}, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { materialId: true, fromUnit: true, toUnit: true } });
  if (!ts.length) return new Map();
  const awal = new Map(); const kini = new Map(); for (const t of ts) { if (!awal.has(t.materialId)) awal.set(t.materialId, t.fromUnit); kini.set(t.materialId, t.toUnit); }
  const peta = new Map(); for (const [id, a] of awal) if (kini.get(id) !== a) peta.set(id, { satuanReferensi: a, satuanSekarang: kini.get(id) });
  return peta;
}
export const TEKS_REFERENSI_TIDAK_COCOK = (r) => `Harga referensi Agustus dinyatakan per ${r.satuanReferensi}; tidak berlaku untuk satuan ${r.satuanSekarang} (satuan stok sudah berganti).`;

/** Satuan yang berlaku untuk tiap pergerakan: penanda eksplisit; pergerakan lama (NULL) = satuan_lama transisi pertama bahan itu, selain itu satuan master sekarang. Baca-saja. */
export async function satuanCatatanPer(db, rows) {
  const ids = [...new Set(rows.filter((r) => !r.unitAtEntry).map((r) => r.materialId))]; if (!ids.length) return (r) => r.unitAtEntry;
  const pertama = new Map((await db.materialUnitTransition.findMany({ where: { materialId: { in: ids } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { materialId: true, fromUnit: true } })).reverse().map((t) => [t.materialId, t.fromUnit]));
  const master = new Map((await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, unit: true } })).map((m) => [m.id, m.unit]));
  return (r) => r.unitAtEntry ?? pertama.get(r.materialId) ?? master.get(r.materialId) ?? null;
}
