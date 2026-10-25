// NILAI RESMI BAHAN — SATU sumber nilai per stok dan periode (Okt 2026). C1: urutan tanggal dimodelkan EKSPLISIT, kuantitas 1 Sep dan 30 Sep TIDAK disamakan membuta.
//
//   1 Sep  baseline (CC-01092026-BASELINE)  →  1–30 Sep  ISSUE (tidak ada penerimaan di September)  →  30 Sep  saldo sistem  →  Okt  penerimaan + pemakaian
//
//   Pemakaian SEBELUM cutover (≤ 30 Sep): lapisan = kuantitas BASELINE 1 Sep × harga PSA ("harga PSA berlaku untuk lapisan baseline" — keputusan Finance 1A, menunggu). Hanya bila bahan TERCAKUP:
//       baseline > 0 DAN saldo 30 Sep ≥ 0 (semua pemakaian September punya stok fisik). Selain itu GAP — tidak diberi harga: TANPA_LAPISAN_BASELINE / SALDO_30SEP_NEGATIF.
//       Nilai ini INFORMASI biaya per order; pemakaian sebelum cutover tidak pernah dijurnal sendiri (tercakup jurnal Persediaan Awal).
//   Pemakaian MULAI cutover (≥ 1 Okt): lapisan = kuantitas BARIS PSA × harga PSA + penerimaan berharga sejak cutover — rumus SAMA dengan jalur jurnal (dasarHargaRataRata). Kuantitas baris PSA WAJIB = saldo sistem 30 Sep
//       (bila tidak: GAP PSA_QTY_BEDA; bila PSA belum resmi: GAP PSA_BELUM_RESMI). Lapisan baseline TIDAK ditambahkan lagi di sini → satu lapisan stok tidak dinilai dua kali.
//   Tanpa pengaturan cutover: perilaku lama (lapisan baseline + semua penerimaan).
//
// Prioritas: (1) nilai beku DINILAI dari penerimaan berharga TIDAK PERNAH diganti otomatis; (2) resolver ini untuk pergerakan yang belum bernilai; (3) tidak ada sumber → tetap TANPA_HARGA (bukan Rp0), dengan KODE GAP.
// Status PSA: DIPERIKSA/DIPOSTING dihitung untuk PRATINJAU; NILAI HANYA DITULIS bila PSA berstatus DIPOSTING (Paket A; menunggu keputusan Finance).
import { Decimal, ZERO } from "./money.js";
import { dasarHargaRataRata } from "./posting/inventory.js";
import { ambilKebijakanPersediaan } from "./inventoryMethod.js";
import { awalCutover } from "./persediaanAwal.js";

export const OPNAME_PEMBUKA = "CC-01092026-BASELINE";
export const STATUS_PSA_RESMI = ["DIPERIKSA", "DIPOSTING"];
export const STATUS_PSA_TULIS = ["DIPOSTING"];
export const STATUS_PO_DISETUJUI = ["DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI"];
export const GAP = Object.freeze({
  TANPA_LAPISAN_BASELINE: "Bahan tidak punya baseline 1 Sep — tidak ada lapisan stok yang bisa dinilai",
  SALDO_30SEP_NEGATIF: "Pemakaian September melebihi baseline (saldo 30 Sep negatif) — stok perlu dijelaskan Gudang, bukan diberi harga",
  PSA_BELUM_RESMI: "Persediaan Awal untuk bahan ini belum ada baris yang diperiksa/diposting",
  PSA_QTY_BEDA: "Kuantitas baris Persediaan Awal tidak sama dengan saldo sistem 30 Sep",
});
const D = (v) => new Decimal(String(v ?? 0));

/** Baris PSA resmi untuk bahan: snapshot DIPOSTING lebih dulu, lalu DIPERIKSA terbaru. Draf tidak pernah dihitung. */
export async function barisPembukaResmi(db, materialId) {
  const o = await db.finInventoryOpening.findMany({ where: { status: { in: STATUS_PSA_RESMI }, lines: { some: { materialId } } }, select: { id: true, number: true, status: true, cutoverDate: true, createdAt: true, lines: { where: { materialId }, select: { id: true, qty: true, unitCost: true, unit: true, priceSource: true, priceReference: true } } } });
  o.sort((a, b) => (a.status === "DIPOSTING" ? 0 : 1) - (b.status === "DIPOSTING" ? 0 : 1) || b.createdAt - a.createdAt);
  const s = o[0]; if (!s) return null; const l = s.lines[0];
  if (!(Number(l.qty) > 0) || !(Number(l.unitCost) > 0)) return null;
  return { openingId: s.id, nomor: s.number, status: s.status, lineId: l.id, qty: D(l.qty), harga: D(l.unitCost), satuan: l.unit, sumberHarga: l.priceSource, rujukanHarga: l.priceReference };
}

/** Kuantitas lapisan baseline = saldo opname pembuka (CC-01092026-BASELINE) bahan itu yang sudah masuk s.d. asOf. */
async function qtyLapisanBaseline(db, materialId, asOf) {
  const r = await db.stockMovement.aggregate({ where: { materialId, type: "ADJUSTMENT", qty: { gt: 0 }, note: { startsWith: `Stock Count ${OPNAME_PEMBUKA}` }, ...(asOf ? { createdAt: { lte: asOf } } : {}) }, _sum: { qty: true } });
  return D(r._sum.qty ?? 0);
}
/** Saldo sistem semua pergerakan SEBELUM tanggal (eksklusif). */
async function saldoSebelum(db, materialId, tgl) {
  const r = await db.stockMovement.aggregate({ where: { materialId, createdAt: { lt: tgl } }, _sum: { qty: true } });
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

const infoPembuka = (psa, lapisan, qty, dariPSADiposting) => ({ dariPSADiposting, lapisan, persediaanAwal: psa.nomor, statusPSA: psa.status, lineId: psa.lineId, qty: qty.toString(), harga: Number(psa.harga), sumberHarga: psa.sumberHarga, rujukanHarga: psa.rujukanHarga });

/**
 * Hitung harga resmi + KODE GAP bila tidak ada. { hasil, gap } — hasil null bila tidak ada sumber.
 * hasil: { harga: Decimal, sumber: { pembuka: {...}|null, penerimaan: [...] }, grIds, tentatif|null, menungguPSADiposting: boolean }
 */
export async function hitungResmi(db, materialId, asOf) {
  const k = await ambilKebijakanPersediaan(db); const mulai = k.cutover ? awalCutover(k.cutover) : null;
  const psa = await barisPembukaResmi(db, materialId);
  let totalQty; let totalNilai; let penerimaanSumber; let pembuka = null; let gap = null;
  const dariD = (d) => { totalQty = D(d.totalQty); totalNilai = D(d.totalNilai); penerimaanSumber = d.sumber.map((s) => ({ goodsReceiptId: s.goodsReceiptId ?? null, qty: String(s.qty), unitCost: s.unitCost })); };

  if (!mulai) { // tanpa cutover: perilaku lama
    const d = await dasarHargaRataRata(db, materialId, { asOf }); dariD(d);
    if (d.opening) pembuka = { dariPSADiposting: true, lapisan: "PSA_DIPOSTING", qty: String(d.opening.qty), harga: Number(d.opening.unitCost) };
    else if (psa) { const q = await qtyLapisanBaseline(db, materialId, asOf); if (q.greaterThan(0)) { totalQty = totalQty.plus(q); totalNilai = totalNilai.plus(q.times(psa.harga)); pembuka = infoPembuka(psa, "BASELINE_1SEP", q, false); } }
  } else if (asOf >= mulai) { // MULAI cutover: lapisan = baris PSA (kuantitas = saldo 30 Sep) + penerimaan sejak cutover
    const saldo30 = await saldoSebelum(db, materialId, mulai);
    let override = null;
    if (saldo30.greaterThan(0)) {
      if (!psa) gap = "PSA_BELUM_RESMI"; else if (!psa.qty.equals(saldo30)) gap = "PSA_QTY_BEDA";
      else override = { qty: psa.qty.toString(), unitCost: psa.harga.toString() };
    }
    if (!gap) {
      const d = await dasarHargaRataRata(db, materialId, { asOf, pembukaOverride: override }); dariD(d);
      if (d.opening && psa) pembuka = infoPembuka(psa, "PSA_30SEP", psa.qty, psa.status === "DIPOSTING");
    }
  } else { // SEBELUM cutover: lapisan = baseline 1 Sep × harga PSA, hanya bila bahan tercakup
    const baseline = await qtyLapisanBaseline(db, materialId, asOf); const saldo30 = await saldoSebelum(db, materialId, mulai);
    const d = await dasarHargaRataRata(db, materialId, { asOf }); dariD(d);
    if (!baseline.greaterThan(0)) { if (!d.totalQty.greaterThan(0)) gap = "TANPA_LAPISAN_BASELINE"; }
    else if (saldo30.lessThan(0)) gap = "SALDO_30SEP_NEGATIF";
    else if (!psa) { if (!d.totalQty.greaterThan(0)) gap = "PSA_BELUM_RESMI"; }
    else { totalQty = totalQty.plus(baseline); totalNilai = totalNilai.plus(baseline.times(psa.harga)); pembuka = infoPembuka(psa, "BASELINE_1SEP", baseline, false); }
    if (gap === "SALDO_30SEP_NEGATIF") { totalQty = ZERO; totalNilai = ZERO; penerimaanSumber = []; }
  }
  if (gap || !totalQty || !totalQty.greaterThan(0)) return { hasil: null, gap: gap ?? "BELUM_ADA_SUMBER" };
  const peta = await statusBuktiGR(db, penerimaanSumber.map((x) => x.goodsReceiptId));
  const grIds = penerimaanSumber.map((x) => x.goodsReceiptId).filter(Boolean);
  return { gap: null, hasil: { harga: totalNilai.dividedBy(totalQty), sumber: { pembuka, penerimaan: penerimaanSumber }, grIds, tentatif: tentatifDariSumber(grIds, peta), menungguPSADiposting: !!(pembuka && pembuka.statusPSA && !STATUS_PSA_TULIS.includes(pembuka.statusPSA)) } };
}

/** Harga resmi per SATUAN STOK pada waktu asOf, atau null bila tidak ada sumber resmi (gap). */
export async function hargaResmi(db, materialId, asOf) { return (await hitungResmi(db, materialId, asOf)).hasil; }

/** Cache per (bahan, tanggal) dalam satu operasi. f(materialId, asOf) → hasil|null; f.gap(materialId, asOf) → kode gap terakhir (setelah dipanggil). */
export function penyelesaiHarga(db) {
  const c = new Map();
  const f = async (materialId, asOf) => { const k = materialId + "|" + new Date(asOf).toISOString(); if (!c.has(k)) c.set(k, await hitungResmi(db, materialId, new Date(asOf))); return c.get(k).hasil; };
  f.gap = (materialId, asOf) => c.get(materialId + "|" + new Date(asOf).toISOString())?.gap ?? null;
  return f;
}

/**
 * REKONSILIASI KUANTITAS per bahan: baseline 1 Sep → penyesuaian lain/penerimaan/ISSUE September → saldo 30 Sep → penerimaan & pemakaian Okt → saldo kini, dan kecocokan baris PSA dengan saldo 30 Sep.
 * Baca-saja, tanpa harga. statusPSA: COCOK | BEDA | TIDAK_ADA_DI_PSA | SALDO_NEGATIF | TIDAK_PERLU (saldo 30 Sep 0) .
 */
export async function rekonsiliasiKuantitas(db, { materialIds = null, hanyaBerGerak = true } = {}) {
  const k = await ambilKebijakanPersediaan(db); if (!k.cutover) return { cutover: null, bahan: [] };
  const mulai = awalCutover(k.cutover);
  const rows = await db.$queryRawUnsafe(`
    select m.id::text id, m.code kode, m.unit satuan,
      coalesce(sum(s.qty) filter (where s.type = 'ADJUSTMENT' and s.note like 'Stock Count ${OPNAME_PEMBUKA}%'),0)::float baseline,
      coalesce(sum(s.qty) filter (where s.created_at < $1 and not (s.type = 'ADJUSTMENT' and s.note like 'Stock Count ${OPNAME_PEMBUKA}%') and s.type not in ('ISSUE','RECEIPT')),0)::float penyesuaian_lain_sep,
      coalesce(sum(s.qty) filter (where s.created_at < $1 and s.type = 'RECEIPT'),0)::float terima_sep,
      coalesce(-sum(s.qty) filter (where s.created_at < $1 and s.type = 'ISSUE'),0)::float issue_sep,
      (count(*) filter (where s.created_at < $1 and s.type = 'ISSUE'))::int issue_sep_trx,
      (count(*) filter (where s.created_at < $1 and s.type = 'ISSUE' and not exists (select 1 from fin_stock_movement_valuations v where v.movement_id = s.id)))::int issue_sep_belum_dinilai,
      coalesce(sum(s.qty) filter (where s.created_at < $1),0)::float saldo_30sep,
      coalesce(sum(s.qty) filter (where s.created_at >= $1 and s.qty > 0),0)::float masuk_okt,
      coalesce(-sum(s.qty) filter (where s.created_at >= $1 and s.qty < 0),0)::float keluar_okt,
      coalesce(sum(s.qty),0)::float saldo_kini
    from materials m join stock_movements s on s.material_id = m.id ${materialIds ? "where m.id = any($2::uuid[])" : ""} group by m.id, m.code, m.unit order by m.code`, mulai, ...(materialIds ? [materialIds] : []));
  const e = 1e-6; const hasil = [];
  for (const r of rows) {
    const saldoHitung = r.baseline + r.penyesuaian_lain_sep + r.terima_sep - r.issue_sep;
    if (hanyaBerGerak && r.issue_sep_trx === 0 && r.masuk_okt === 0 && r.keluar_okt === 0 && r.baseline === 0) continue;
    const psa = await barisPembukaResmi(db, r.id);
    const kelas = r.issue_sep_belum_dinilai === 0 ? "TIDAK_ADA_ISSUE_SEP_BELUM_DINILAI" : r.baseline <= e ? "GAP_TANPA_LAPISAN_BASELINE" : r.saldo_30sep < -e ? "GAP_MELAMPAUI_BASELINE" : "TERCAKUP_BASELINE";
    const statusPSA = r.saldo_30sep < -e ? "SALDO_NEGATIF" : r.saldo_30sep <= e ? "TIDAK_PERLU" : !psa ? "TIDAK_ADA_DI_PSA" : Math.abs(Number(psa.qty) - r.saldo_30sep) < e ? "COCOK" : "BEDA";
    hasil.push({ ...r, saldo30Hitung: Math.round(saldoHitung * 1e4) / 1e4, cekSaldo30: Math.abs(saldoHitung - r.saldo_30sep) < e, cekSaldoKini: Math.abs(r.saldo_30sep + r.masuk_okt - r.keluar_okt - r.saldo_kini) < e, klasifikasi: kelas, statusPSA, qtyPSA: psa ? Number(psa.qty) : null, statusDokumenPSA: psa?.status ?? null });
  }
  return { cutover: k.cutover, bahan: hasil };
}
export { ZERO };
