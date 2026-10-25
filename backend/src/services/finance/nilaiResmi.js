// NILAI RESMI BAHAN — SATU sumber nilai per stok dan periode (Okt 2026).
//
//   Saldo pembuka efektif 1 September  → PERSEDIAAN AWAL (harga per bahan pada baris snapshot yang berstatus DIPERIKSA/DIPOSTING; draf TIDAK dihitung).
//   Penerimaan setelahnya               → GR dengan harga; "didukung bukti" hanya bila kedatangan tercatat DAN harga disetujui (PO berstatus disetujui).
//   Nilai pemakaian pada tanggal T      → rata-rata tertimbang lapisan pembuka + penerimaan berharga yang masuk stok s.d. T (metode yang sama dengan jurnal HPP; tanpa harga ketikan, tanpa referensi Agustus, tanpa harga hari ini).
//
// Prioritas (tidak ada jalur lain): (1) nilai beku DINILAI dari penerimaan berharga — TIDAK PERNAH diganti otomatis; (2) lapisan pembuka dari Persediaan Awal + penerimaan berharga (resolver ini) untuk pergerakan yang belum bernilai;
// (3) tidak ada sumber → tetap TANPA_HARGA (bukan Rp0). Setelah PSA diposting dan tanggal ≥ cutover, dasarHargaRataRata sudah memuat baris PSA sendiri → lapisan pembuka tidak ditambahkan dua kali.
import { Decimal, ZERO } from "./money.js";
import { dasarHargaRataRata } from "./posting/inventory.js";

export const OPNAME_PEMBUKA = "CC-01092026-BASELINE";
export const STATUS_PSA_RESMI = ["DIPERIKSA", "DIPOSTING"];
export const STATUS_PO_DISETUJUI = ["DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI"];
const D = (v) => new Decimal(String(v ?? 0));

/** Baris PSA resmi untuk bahan: snapshot DIPOSTING lebih dulu, lalu DIPERIKSA terbaru. Draf tidak pernah dihitung. */
export async function barisPembukaResmi(db, materialId) {
  const o = await db.finInventoryOpening.findMany({ where: { status: { in: STATUS_PSA_RESMI }, lines: { some: { materialId } } }, select: { id: true, number: true, status: true, cutoverDate: true, createdAt: true, lines: { where: { materialId }, select: { id: true, qty: true, unitCost: true, unit: true, priceSource: true, priceReference: true } } } });
  o.sort((a, b) => (a.status === "DIPOSTING" ? 0 : 1) - (b.status === "DIPOSTING" ? 0 : 1) || b.createdAt - a.createdAt);
  const s = o[0]; if (!s) return null; const l = s.lines[0];
  if (!(Number(l.qty) > 0) || !(Number(l.unitCost) > 0)) return null;
  return { openingId: s.id, nomor: s.number, status: s.status, lineId: l.id, harga: D(l.unitCost), satuan: l.unit, sumberHarga: l.priceSource, rujukanHarga: l.priceReference };
}

/** Kuantitas lapisan pembuka = saldo opname pembuka (CC-01092026-BASELINE) bahan itu yang sudah masuk s.d. asOf. */
async function qtyLapisanPembuka(db, materialId, asOf) {
  const r = await db.stockMovement.aggregate({ where: { materialId, type: "ADJUSTMENT", qty: { gt: 0 }, note: { startsWith: `Stock Count ${OPNAME_PEMBUKA}` }, ...(asOf ? { createdAt: { lte: asOf } } : {}) }, _sum: { qty: true } });
  return D(r._sum.qty ?? 0);
}

/** Status bukti tiap GR: LENGKAP hanya bila kedatangan tercatat (tanggal, penerima) DAN harga disetujui (PO berstatus disetujui). */
export async function statusBuktiGR(db, ids) {
  const peta = new Map(); const uniq = [...new Set(ids.filter(Boolean))]; if (!uniq.length) return peta;
  const gr = await db.goodsReceipt.findMany({ where: { id: { in: uniq } }, select: { id: true, receiptNumber: true, arrivedDate: true, arrivalReceiver: true, arrivalRecordedAt: true, purchaseOrder: { select: { poNumber: true, status: true } } } });
  for (const g of gr) {
    const kedatangan = !!(g.arrivedDate && g.arrivalReceiver && g.arrivalRecordedAt); const harga = !!(g.purchaseOrder && STATUS_PO_DISETUJUI.includes(g.purchaseOrder.status));
    peta.set(g.id, { nomor: g.receiptNumber, kedatangan, harga, lengkap: kedatangan && harga, alasan: [!kedatangan && "kedatangan belum tercatat (tanggal tiba/penerima)", !harga && "harga belum disetujui (PO tidak ada / belum disetujui)"].filter(Boolean) });
  }
  for (const id of uniq) if (!peta.has(id)) peta.set(id, { nomor: id.slice(0, 8), kedatangan: false, harga: false, lengkap: false, alasan: ["GR tidak ditemukan"] });
  return peta;
}
/** Tentatif bila ada GR sumber yang bukti kedatangan atau harganya belum lengkap. */
export function tentatifDariSumber(grIds, peta) {
  const kurang = [...new Set(grIds)].map((id) => peta.get(id)).filter((x) => x && !x.lengkap);
  return kurang.length ? { sebab: "BUKTI_GR_BELUM_LENGKAP", gr: kurang.map((x) => x.nomor), alasan: `Harga bersumber ${kurang.map((x) => `${x.nomor} (${x.alasan.join("; ")})`).join(", ")} — bukan nilai final` } : null;
}

/**
 * Harga resmi per SATUAN STOK untuk pemakaian bahan pada waktu asOf. Mengembalikan null bila tidak ada sumber resmi.
 * { harga: Decimal, sumber: { pembuka: {...}|null, penerimaan: [{ goodsReceiptId, qty, unitCost }] }, grIds, tentatif|null }
 */
export async function hargaResmi(db, materialId, asOf) {
  const d = await dasarHargaRataRata(db, materialId, { asOf });
  let totalQty = D(d.totalQty); let totalNilai = D(d.totalNilai); let pembuka = d.opening ? { dariPSADiposting: true, qty: String(d.opening.qty), harga: Number(d.opening.unitCost) } : null;
  if (!d.opening) {
    const psa = await barisPembukaResmi(db, materialId);
    if (psa) { const q = await qtyLapisanPembuka(db, materialId, asOf); if (q.greaterThan(0)) { totalQty = totalQty.plus(q); totalNilai = totalNilai.plus(q.times(psa.harga)); pembuka = { dariPSADiposting: false, persediaanAwal: psa.nomor, statusPSA: psa.status, lineId: psa.lineId, qty: q.toString(), harga: Number(psa.harga), sumberHarga: psa.sumberHarga, rujukanHarga: psa.rujukanHarga }; } }
  }
  if (!totalQty.greaterThan(0)) return null;
  const penerimaan = d.sumber.map((s) => ({ goodsReceiptId: s.goodsReceiptId ?? null, qty: String(s.qty), unitCost: s.unitCost }));
  const peta = await statusBuktiGR(db, penerimaan.map((x) => x.goodsReceiptId));
  return { harga: totalNilai.dividedBy(totalQty), sumber: { pembuka, penerimaan }, grIds: penerimaan.map((x) => x.goodsReceiptId).filter(Boolean), tentatif: tentatifDariSumber(penerimaan.map((x) => x.goodsReceiptId).filter(Boolean), peta) };
}

/** Cache per (bahan, tanggal) dalam satu operasi. */
export function penyelesaiHarga(db) { const c = new Map(); return async (materialId, asOf) => { const k = materialId + "|" + new Date(asOf).toISOString(); if (!c.has(k)) c.set(k, await hargaResmi(db, materialId, new Date(asOf))); return c.get(k); }; }
export { ZERO };
