// SELISIH TRANSFER STOK (UX Tahap 2) — kekurangan jumlah diterima dari jumlah dikirim. Aturan lama TIDAK diubah: dispatch mengurangi saldo sebesar jumlah dikirim, receive menambah sebesar jumlah diterima, jadi
// kekurangan sudah hilang dari saldo total. Yang ditambahkan: selisih DIHITUNG dari baris transfer (satu sumber), penyebabnya wajib dicatat saat Terima, dan ada jalur penyelesaian yang tercatat:
//   • DITEMUKAN — barang ternyata ada / terlambat tiba: saldo TOTAL bahan ditambah, pergerakan dicatat pada lokasi tujuan (satu pergerakan TRANSFER positif bertaut ke transfer);
//   • SUSUT     — diakui susut/hilang/rusak di perjalanan: tercatat saja (TANPA pergerakan stok; saldo sudah berkurang), BUKAN pemakaian produksi (tidak ada ISSUE, tidak ada unit, tidak ada HPP).
// Penyelesaian disimpan sebagai peristiwa aktivitas (append-only) pada transfer — tanpa perubahan skema. Murni di sini; query hanya di `selisihTransfer`/`saldoTransfer`.
import { ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { satuanCatatanPer } from "./referensiHargaSatuan.js";

const bulat = (n) => Math.round(Number(n) * 10000) / 10000;

/** Dari transfer (dengan lines+material) dan daftar peristiwa SELISIH_DISELESAIKAN → baris selisih. Hanya transfer COMPLETED. */
export function hitungSelisih(transfer, peristiwa = []) {
  if (!transfer || transfer.status !== "COMPLETED") return [];
  const baris = [];
  for (const l of transfer.lines) {
    const dikirim = Number(l.qtySent); const diterima = Number(l.qtyReceived ?? l.qtySent);
    const kurang = bulat(dikirim - diterima); const lebih = bulat(diterima - dikirim);
    if (kurang <= 0 && lebih <= 0) continue;
    const penyelesaian = peristiwa.filter((e) => e.metadata?.lineId === l.id).map((e) => ({ jenis: e.metadata.jenis, qty: Number(e.metadata.qty), alasan: e.metadata.alasan ?? null, kunci: e.metadata.kunci ?? null, waktu: e.createdAt, oleh: e.actorId ?? null }));
    const selesai = bulat(penyelesaian.reduce((a, p) => a + p.qty, 0));
    baris.push({ lineId: l.id, materialId: l.materialId, kode: l.material?.code, nama: l.material?.name, unit: l.material?.unit, dikirim, diterima, kurang: Math.max(0, kurang), lebih: Math.max(0, lebih), diselesaikan: selesai, sisa: Math.max(0, bulat(kurang - selesai)), penyelesaian });
  }
  return baris;
}
export const selisihTerbukaQty = (baris) => bulat(baris.reduce((a, b) => a + b.sisa, 0));

const pilihPeristiwa = (events) => events.filter((e) => e.eventType === EVENT_TYPES.DOCUMENT_EDITED && e.metadata?.aksi === "SELISIH_DISELESAIKAN");

/** Selisih satu transfer (query peristiwa). */
export async function selisihTransfer(db, transfer) {
  if (!transfer || transfer.status !== "COMPLETED") return [];
  const ev = await db.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.STOCK_TRANSFER, entityId: transfer.id, eventType: EVENT_TYPES.DOCUMENT_EDITED }, orderBy: { createdAt: "asc" } });
  const baris = hitungSelisih(transfer, pilihPeristiwa(ev));
  if (!baris.length) return baris;
  // jumlah kirim/terima dicatat dalam satuan SAAT transfer berjalan: label mengikuti pergerakan kirim, bukan satuan master sekarang
  const kirim = await db.stockMovement.findMany({ where: { stockTransferId: transfer.id, materialId: { in: baris.map((b) => b.materialId) }, qty: { lt: 0 } }, orderBy: { createdAt: "asc" }, select: { materialId: true, unitAtEntry: true } });
  const satuanDari = await satuanCatatanPer(db, kirim); const peta = new Map(); for (const k of kirim) if (!peta.has(k.materialId)) peta.set(k.materialId, satuanDari(k));
  return baris.map((b) => { const s = peta.get(b.materialId); return s && s !== b.unit ? { ...b, unit: s, satuanMaster: b.unit } : b; });
}

/** Banyak transfer sekaligus (daftar): { [id]: selisihTerbukaQty } hanya untuk transfer COMPLETED yang punya kekurangan. */
export async function selisihTerbukaDaftar(db, transfers) {
  const kandidat = transfers.filter((t) => t.status === "COMPLETED" && t.lines.some((l) => Number(l.qtySent) > Number(l.qtyReceived ?? l.qtySent)));
  if (!kandidat.length) return {};
  const ev = await db.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.STOCK_TRANSFER, entityId: { in: kandidat.map((t) => t.id) }, eventType: EVENT_TYPES.DOCUMENT_EDITED }, orderBy: { createdAt: "asc" } });
  const peta = {};
  for (const t of kandidat) peta[t.id] = selisihTerbukaQty(hitungSelisih(t, pilihPeristiwa(ev.filter((e) => e.entityId === t.id))));
  return peta;
}

/**
 * Perjalanan saldo per bahan untuk transfer yang sudah dikirim: saldo total SEBELUM kirim, dikurangi saat kirim, ditambah saat terima (dan temuan selisih), dan saldo sekarang.
 * Saldo = total semua lokasi (sistem tidak menyimpan saldo per lokasi). `sebelumKirim` dihitung dari ledger sebelum pergerakan kirim.
 */
export async function saldoTransfer(db, transfer) {
  if (!transfer || !["IN_TRANSIT", "COMPLETED"].includes(transfer.status)) return [];
  const hasil = [];
  for (const l of transfer.lines) {
    const mov = await db.stockMovement.findMany({ where: { stockTransferId: transfer.id, materialId: l.materialId }, orderBy: { createdAt: "asc" }, select: { qty: true, createdAt: true, note: true, unitAtEntry: true } });
    const kirim = mov.find((m) => Number(m.qty) < 0); if (!kirim) continue;
    const sebelum = await db.stockMovement.aggregate({ where: { materialId: l.materialId, createdAt: { lt: kirim.createdAt } }, _sum: { qty: true } });
    const sekarang = await db.stockMovement.aggregate({ where: { materialId: l.materialId }, _sum: { qty: true } });
    const satuanKirim = (await satuanCatatanPer(db, [{ materialId: l.materialId, unitAtEntry: kirim.unitAtEntry ?? null }]))({ materialId: l.materialId, unitAtEntry: kirim.unitAtEntry ?? null }) ?? l.material?.unit; const satuanMaster = l.material?.unit; const lintas = !!satuanKirim && satuanKirim !== satuanMaster;
    const jumlah = (awalan) => bulat(mov.filter((m) => Number(m.qty) > 0 && String(m.note ?? "").startsWith(awalan)).reduce((a, m) => a + Number(m.qty), 0));
    hasil.push({ lineId: l.id, materialId: l.materialId, kode: l.material?.code, unit: lintas ? satuanKirim : l.material?.unit, ...(lintas ? { satuanMaster, sekarangTidakDapatDibandingkan: `Transfer ini dicatat dalam ${satuanKirim}; saldo sekarang dalam ${satuanMaster}. Tidak dapat dibandingkan langsung tanpa faktor satuan.` } : {}), sebelumKirim: bulat(Number(sebelum._sum.qty ?? 0)), dikirim: bulat(-Number(kirim.qty)), diterima: transfer.status === "COMPLETED" ? jumlah("Receive") : null, ditemukan: jumlah("Selisih ditemukan"), sekarang: lintas ? null : bulat(Number(sekarang._sum.qty ?? 0)) });
  }
  return hasil;
}
