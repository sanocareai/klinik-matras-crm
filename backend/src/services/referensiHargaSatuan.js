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

/**
 * PENJAGA SATUAN BERUBAH (Nov 2026): dokumen yang jumlahnya dicatat dalam satuan LAMA (penerimaan, retur, koreksi) tidak boleh menggerakkan saldo yang sudah berganti satuan dengan angka mentah.
 * Mengembalikan transisi satuan paling awal SESUDAH waktu `sejak` untuk bahan itu (null bila tidak ada). Tidak mengonversi apa pun. Baca-saja.
 */
export async function transisiSesudah(db, materialId, sejak) {
  if (!materialId || !sejak) return null;
  return db.materialUnitTransition.findFirst({ where: { materialId, createdAt: { gt: new Date(sejak) } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, fromUnit: true, toUnit: true, createdAt: true } });
}
export const KODE_SATUAN_BERUBAH = "SATUAN_BERUBAH_SEJAK_PENERIMAAN";
export const TEKS_SATUAN_BERUBAH = (bahan, dokumen, t) => `${bahan} pada ${dokumen} dicatat dalam satuan lama (${t.fromUnit}); satuan stok bahan sudah berganti ke ${t.toUnit} sejak transisi satuan. Jumlah tidak dikonversi otomatis, sehingga dokumen ini tidak diproses seperti biasa. Perlu penyelesaian khusus oleh penyetuju (mis. penyesuaian bersumber dokumen ini); retur dari penerimaan baru sesudah transisi tetap berjalan dalam ${t.toUnit}.`;
