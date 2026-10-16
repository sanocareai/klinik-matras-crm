// Memuat dokumen Gudang + "NIAT" pergerakannya untuk pratinjau/posting stok resmi. Murni BACA.
//   niat  = pergerakan yang akan/sudah terjadi: [{ materialId, material, qty (bertanda ledger), tipe, movementId|null, at }]
//   final = dokumen sudah menulis ledger (pergerakan ada) — hanya yang final yang bisa diposting.
// Aturan jenis (penolakan terstruktur) dihitung di sini supaya pratinjau dan posting memakai aturan yang SAMA.
import { JENIS, KODE, PESAN, akunBebanUntuk, StokResmiError } from "./matriks.js";
import { muatPergerakanSesi, selisihTersesuaikan } from "../../pergerakanSesiHitung.js";

const MATERIAL_SEL = { select: { id: true, code: true, name: true, unit: true } };
const tolak = (kode, extra = {}) => ({ kode, pesan: PESAN[kode], ...extra });
const num = (v) => Number(v ?? 0);

async function pergerakanNyata(db, movementWhere) {
  const rows = await db.stockMovement.findMany({
    where: movementWhere, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, materialId: true, type: true, qty: true, createdAt: true, unitId: true, material: MATERIAL_SEL },
  });
  return rows.map((m) => ({ materialId: m.materialId, material: m.material, qty: num(m.qty), tipe: m.type, movementId: m.id, at: m.createdAt, unitId: m.unitId }));
}

export async function muatDokumen(db, jenis, id, { resolusi = null, sekarang = new Date() } = {}) {
  switch (jenis) {
    case JENIS.STOCK_COUNT: {
      const c = await db.stockCount.findUnique({ where: { id }, include: { lines: { include: { material: MATERIAL_SEL } } } });
      if (!c) return null;
      const final = c.status === "COMPLETED";
      const movementWhere = { stockCountId: id };
      let niat = [];
      if (final) niat = await pergerakanNyata(db, movementWhere);
      else if (["IN_PROGRESS", "WAITING_REVIEW"].includes(c.status) && c.lines.every((l) => l.countedQty != null)) {
        const { pergerakan } = await muatPergerakanSesi(db, c, { sampai: sekarang });
        const { baris } = selisihTersesuaikan(c.lines, pergerakan);
        const mat = new Map(c.lines.map((l) => [l.materialId, l.material]));
        niat = baris.filter((b) => b.berselisih).map((b) => ({ materialId: b.materialId, material: mat.get(b.materialId), qty: b.selisih, tipe: "ADJUSTMENT", movementId: null, at: sekarang, unitId: null }));
      }
      const aturan = [];
      if (/BASELINE/i.test(c.countNumber) || /^Backfill saldo pembuka/i.test(c.notes ?? "")) aturan.push(tolak(KODE.BASELINE_MIGRASI_TIDAK_DIJURNALKAN));
      return {
        jenis, id, nomor: c.countNumber, status: c.status, final, movementWhere, niat, aturan, tanggal: c.completedAt ?? c.startedAt ?? c.scheduledDate ?? sekarang,
        kunci: `SELISIH_OPNAME:${id}`, akunKey: akunBebanUntuk(jenis, c), windowDari: c.startedAt ?? c.createdAt, windowSampai: c.completedAt ?? sekarang,
        meta: { countType: c.countType, jumlahBaris: c.lines.length, tanggalHitung: c.scheduledDate, notes: c.notes ?? null }, namaEntitas: "stock_count",
      };
    }
    case JENIS.STOCK_ADJUSTMENT: {
      const r = await db.stockAdjustmentRequest.findUnique({ where: { id }, include: { material: MATERIAL_SEL } });
      if (!r) return null;
      const final = r.status === "POSTED";
      const movementWhere = { stockAdjustmentRequestId: id };
      const niat = final ? await pergerakanNyata(db, movementWhere)
        : ["APPROVED"].includes(r.status) ? [{ materialId: r.materialId, material: r.material, qty: num(r.adjustmentQty), tipe: "ADJUSTMENT", movementId: null, at: sekarang, unitId: null }] : [];
      const aturan = [];
      if (r.adjustmentType === "CONVERSION") aturan.push(tolak(KODE.KONVERSI_BUTUH_PASANGAN));
      return {
        jenis, id, nomor: r.adjustmentNumber, status: r.status, final, movementWhere, niat, aturan, tanggal: r.postedAt ?? r.approvedAt ?? sekarang,
        kunci: `SELISIH_PENYESUAIAN:${id}`, akunKey: akunBebanUntuk(jenis, r), adjustmentType: r.adjustmentType, windowDari: r.createdAt, windowSampai: r.postedAt ?? sekarang,
        meta: { adjustmentType: r.adjustmentType, beforeQty: num(r.beforeQty), adjustmentQty: num(r.adjustmentQty), reason: r.reason }, namaEntitas: "stock_adjustment",
      };
    }
    case JENIS.DAMAGED_STOCK: {
      const r = await db.damagedStockRecord.findUnique({ where: { id }, include: { material: MATERIAL_SEL } });
      if (!r) return null;
      const resolusiEfektif = r.resolution ?? resolusi;
      const final = r.status === "RESOLVED";
      const movementWhere = { damagedStockRecordId: id };
      const keluar = ["DISPOSE", "RETURN_TO_SUPPLIER"].includes(resolusiEfektif);
      const niat = final ? await pergerakanNyata(db, movementWhere)
        : keluar ? [{ materialId: r.materialId, material: r.material, qty: -num(r.qty), tipe: "WASTE", movementId: null, at: sekarang, unitId: null }] : [];
      const aturan = [];
      if (resolusiEfektif === "RETURN_TO_SUPPLIER") aturan.push(tolak(KODE.RETUR_SUPPLIER_BUKAN_SUSUT));
      return {
        jenis, id, nomor: r.recordNumber, status: r.status, final, movementWhere, niat, aturan, tanggal: r.resolvedAt ?? sekarang,
        kunci: `SUSUT_BARANG_RUSAK:${id}`, akunKey: akunBebanUntuk(jenis, r), windowDari: r.reportedAt, windowSampai: r.resolvedAt ?? sekarang,
        meta: { resolusi: resolusiEfektif ?? null, damageCategory: r.damageCategory, qty: num(r.qty) }, namaEntitas: "damaged_stock",
      };
    }
    case JENIS.RETURN_RECORD: {
      const r = await db.returnRecord.findUnique({ where: { id }, include: { material: MATERIAL_SEL } });
      if (!r) return null;
      const resolusiEfektif = r.resolution ?? resolusi;
      const final = r.status === "COMPLETED";
      const movementWhere = { returnRecordId: id };
      const niat = final ? await pergerakanNyata(db, movementWhere)
        : resolusiEfektif === "RETURN_TO_AVAILABLE" ? [{ materialId: r.materialId, material: r.material, qty: num(r.qty), tipe: "RETURN", movementId: null, at: sekarang, unitId: null }] : [];
      const aturan = [tolak(KODE.ASAL_RETUR_TIDAK_TERBUKTI, { returnType: r.returnType })];
      return {
        jenis, id, nomor: r.returnNumber, status: r.status, final, movementWhere, niat, aturan, tanggal: r.completedAt ?? sekarang,
        kunci: `RETUR_GUDANG:${id}`, akunKey: "SELISIH_STOK", windowDari: r.createdAt, windowSampai: r.completedAt ?? sekarang,
        meta: { returnType: r.returnType, resolusi: resolusiEfektif ?? null, reference: r.reference ?? null }, namaEntitas: "return_record",
      };
    }
    default:
      throw new StokResmiError(`Jenis dokumen tidak dikenal: ${jenis}`, 400, "JENIS_TIDAK_DIKENAL");
  }
}
