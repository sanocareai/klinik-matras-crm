// KOREKSI HARGA / VALUASI pergerakan stok bertaut unit — TERPISAH dari koreksi jumlah (Okt 2026).
//  • Valuasi asli (fin_stock_movement_valuations) TIDAK diubah. Koreksi = baris baru append-only: sebelum–sesudah, alasan, pelaku, waktu, hubungan ke pergerakan asal.
//  • Valuasi efektif = koreksi terbaru bila ada (dipakai jejak biaya bahan per unit). Koreksi berulang diperbolehkan; yang terakhir berlaku, yang lama tetap terbaca.
//  • TIDAK menulis jurnal dan tidak mengubah stok. Bila pergerakan sudah dijurnal, jejak biaya menandai "jurnal perlu penyesuaian" (keputusan Finance) — bukan diam-diam menganggap final.
//  • Pergerakan yang belum pernah dinilai (mis. 254 ISSUE September lama) boleh diberi harga lewat koreksi ini: nilai bertanda "harga manual (koreksi)", bukan harga perolehan.
import { Decimal, toMoney } from "./money.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { KoreksiError } from "../warehouseCorrection.js";
import { dasarHargaRataRata } from "./posting/inventory.js";
import { JENIS_BIAYA } from "./biayaBahan.js";

const alasanWajib = (a) => { const t = String(a ?? "").trim(); if (t.length < 5 || t.length > 500) throw new KoreksiError("Alasan koreksi harga wajib diisi (5–500 karakter)", 400, "ALASAN_WAJIB"); return t; };
const kunciValid = (k) => { const t = String(k ?? ""); if (t.length < 8 || t.length > 120) throw new KoreksiError("Idempotency-Key wajib (8–120 karakter)", 428, "IDEMPOTENCY_KEY_REQUIRED"); return t; };
const uang = (v) => toMoney(v);
const keSebelum = (x) => (x ? { status: x.status, unitCostBasis: x.unitCostBasis == null ? null : String(x.unitCostBasis), value: x.value == null ? null : String(x.value), sumber: x.sumber } : null);

/** Valuasi efektif satu pergerakan: koreksi terbaru, atau valuasi beku asli, atau tidak ada. */
export async function valuasiEfektif(db, movementId) {
  const [asli, koreksi] = await Promise.all([
    db.finStockMovementValuation.findUnique({ where: { movementId } }),
    db.finStockMovementValuationCorrection.findFirst({ where: { movementId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
  ]);
  if (koreksi) return { sumber: "KOREKSI", status: "DINILAI", unitCostBasis: koreksi.unitCostBasis, value: koreksi.value, koreksiId: koreksi.id };
  if (asli) return { sumber: "BEKU", status: asli.status, unitCostBasis: asli.unitCostBasis, value: asli.value };
  return null;
}

/** Koreksi harga satu pergerakan (harga per satuan stok). Idempoten per kunci. */
export async function koreksiValuasiPergerakan(prisma, { movementId, hargaBaru, alasan, kunci, aktor, sekarang = new Date() }) {
  const reason = alasanWajib(alasan); const idem = kunciValid(kunci);
  const harga = Number(hargaBaru);
  if (!Number.isFinite(harga) || harga < 0 || harga > 1_000_000_000) throw new KoreksiError("Harga per satuan harus angka 0 atau lebih", 400, "HARGA_TIDAK_VALID");
  const sudah = await prisma.finStockMovementValuationCorrection.findUnique({ where: { idempotencyKey: idem } });
  if (sudah) { if (sudah.movementId !== movementId) throw new KoreksiError("Idempotency-Key ini sudah dipakai untuk pergerakan lain", 409, "KUNCI_DIPAKAI_LAIN"); return { ulang: true, koreksi: tampil(sudah) }; }
  try {
    return await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "stock_movements", movementId);
      const mv = await tx.stockMovement.findUnique({ where: { id: movementId }, select: { id: true, type: true, qty: true, unitId: true, materialId: true, createdAt: true, material: { select: { code: true, unit: true } } } });
      if (!mv) throw new KoreksiError("Pergerakan stok tidak ditemukan", 404, "PERGERAKAN_TIDAK_ADA");
      if (!mv.unitId || !JENIS_BIAYA[mv.type]) throw new KoreksiError("Hanya pergerakan bertaut unit (pemakaian/retur/susut) yang punya valuasi untuk dikoreksi", 409, "BUKAN_PERGERAKAN_BERNILAI");
      const sebelumEfektif = await valuasiEfektif(tx, movementId);
      let sebelum = sebelumEfektif;
      if (!sebelum) { const d = await dasarHargaRataRata(tx, mv.materialId, { asOf: mv.createdAt }); sebelum = { sumber: "ESTIMASI", status: "ESTIMASI_HISTORIS", unitCostBasis: d.harga ?? null, value: d.harga == null ? null : uang(new Decimal(String(mv.qty)).abs().times(d.harga).times(Number(mv.qty) < 0 ? 1 : -1)) }; }
      const qty = new Decimal(String(mv.qty));
      const mutlak = uang(qty.abs().times(harga));
      const nilai = qty.isNegative() ? mutlak : mutlak.negated(); // + menambah biaya unit, − mengurangi (retur)
      if (sebelum.unitCostBasis != null && new Decimal(String(sebelum.unitCostBasis)).equals(new Decimal(harga)) && sebelum.sumber !== "ESTIMASI") throw new KoreksiError("Harga yang diminta sama dengan harga berlaku", 409, "TIDAK_ADA_PERUBAHAN");
      const jurnal = await tx.finJournalEntry.findFirst({ where: { idempotencyKey: { in: [`PEMAKAIAN_BAHAN_MOVEMENT:${mv.id}`] }, status: { in: ["POSTED", "REVERSED"] } }, select: { id: true } });
      const baris = await tx.finStockMovementValuationCorrection.create({ data: { movementId: mv.id, materialId: mv.materialId, unitId: mv.unitId, before: keSebelum(sebelum), after: { status: "DINILAI", unitCostBasis: String(harga), value: String(nilai), sumber: "HARGA_MANUAL_KOREKSI" }, unitCostBasis: harga, value: nilai.toString(), reason, createdById: aktor.id, idempotencyKey: idem, createdAt: sekarang } });
      return { ulang: false, koreksi: tampil(baris), jurnalPerluPenyesuaian: !!jurnal, bahan: mv.material.code, satuan: mv.material.unit };
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (e) {
    if (e?.code === "P2002") { const s = await prisma.finStockMovementValuationCorrection.findUnique({ where: { idempotencyKey: idem } }); if (s && s.movementId === movementId) return { ulang: true, koreksi: tampil(s) }; }
    throw e;
  }
}
const tampil = (k) => ({ id: k.id, movementId: k.movementId, sebelum: k.before, sesudah: k.after, hargaBaru: Number(k.unitCostBasis), nilaiBaru: Number(k.value), alasan: k.reason, oleh: k.createdById, waktu: k.createdAt });
/** Riwayat koreksi harga satu pergerakan (terlama → terbaru). */
export async function riwayatKoreksiValuasi(db, movementId) {
  return (await db.finStockMovementValuationCorrection.findMany({ where: { movementId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(tampil);
}
