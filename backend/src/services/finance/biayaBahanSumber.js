// JEJAK BIAYA BAHAN DARI SISI DOKUMEN SUMBER — PO (Finance) dan Penerimaan Barang (Gudang). Baca-saja.
//
// Sumber kebenaran SAMA dengan jejak per Unit (services/finance/biayaBahan.js): nilai yang dibekukan di fin_stock_movement_valuations.
// Karena harga stok memakai rata-rata tertimbang, satu pemakaian bisa berasal dari beberapa penerimaan. Porsi tiap penerimaan dihitung dari
// dasar harga yang DIBEKUKAN saat pergerakan diposting (basis.sumber[].qty / basis.totalQty) — dekomposisi yang persis menjumlah ke nilai pemakaian,
// bukan tebakan FIFO. Jadi angka "dipakai Produksi" di PO/Penerimaan dan total di Unit 360 berasal dari baris beku yang sama.
import { Decimal, ZERO, toMoney, moneyToNumber } from "./money.js";

const d = (v) => new Decimal(String(v ?? 0));
const STATUS_TAGIHAN_MASUK_BUKU = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];
const uang = (v) => (v == null ? null : moneyToNumber(toMoney(v)));

/** Baris beku DINILAI yang dasar harganya memuat salah satu penerimaan di `idPenerimaan`. */
async function valuasiDariPenerimaan(db, idPenerimaan) {
  if (idPenerimaan.length === 0) return [];
  return db.finStockMovementValuation.findMany({
    where: { status: "DINILAI", OR: idPenerimaan.map((id) => ({ basis: { path: ["sumber"], array_contains: [{ goodsReceiptId: id }] } })) },
    orderBy: [{ valuedAt: "asc" }, { id: "asc" }],
    select: {
      movementId: true, materialId: true, unitId: true, costKind: true, qty: true, value: true, basis: true, valuedAt: true,
      movement: { select: { createdAt: true, materialIssue: { select: { id: true, issueNumber: true } } } },
    },
  });
}

/** Porsi satu baris beku yang bersumber dari penerimaan-penerimaan tertentu: qty (positif) dan nilai (bertanda: positif menambah biaya). */
export function porsiDariPenerimaan(v, idSet) {
  const sumber = v.basis?.sumber ?? [];
  const totalQty = d(v.basis?.totalQty ?? 0);
  if (totalQty.lessThanOrEqualTo(0)) return [];
  const mutlak = d(v.qty).abs();
  const tanda = d(v.value).isNegative() ? -1 : 1;
  return sumber.filter((s) => s.goodsReceiptId && idSet.has(s.goodsReceiptId)).map((s) => {
    const qty = mutlak.times(d(s.qty)).dividedBy(totalQty);
    return { goodsReceiptId: s.goodsReceiptId, materialId: v.materialId, qty, nilai: qty.times(d(s.unitCost)).times(tanda) };
  });
}

const nolPorsi = () => ({ qty: ZERO, nilai: ZERO });
const tambah = (a, p) => { a.qty = a.qty.plus(p.qty); a.nilai = a.nilai.plus(p.nilai); };
const KIND = { PEMAKAIAN: "dipakai", RETUR: "retur", SUSUT: "waste", PENYESUAIAN: "penyesuaian" };

// ── PO (Finance) ─────────────────────────────────────────────────────────────────────────────────────────

export async function bacaJejakPO(db, poId, { izinHarga = true } = {}) {
  const po = await db.finPurchaseOrder.findUnique({
    where: { id: poId },
    select: { id: true, poNumber: true, status: true, lines: { select: { id: true, materialId: true, unitPrice: true, material: { select: { code: true, name: true, unit: true } } } } },
  });
  if (!po) return null;
  const penerimaan = await db.goodsReceipt.findMany({
    where: { purchaseOrderId: poId },
    select: {
      id: true, receiptNumber: true, status: true,
      lines: {
        select: {
          materialId: true, acceptedQty: true, purchaseOrderLine: { select: { unitPrice: true } },
          billAllocations: { where: { bill: { status: { in: STATUS_TAGIHAN_MASUK_BUKU } } }, select: { qty: true, billPoLine: { select: { invoiceUnitPrice: true } } } },
        },
      },
    },
  });
  const idPenerimaan = penerimaan.map((p) => p.id);
  const idSet = new Set(idPenerimaan);
  const selesai = penerimaan.filter((p) => p.status === "COMPLETED");

  // nilai diterima menurut harga PO + selisih harga faktur (tidak pernah masuk biaya persediaan)
  let nilaiDiterima = ZERO; let selisihFaktur = ZERO;
  for (const p of selesai) {
    for (const l of p.lines) {
      const harga = d(l.purchaseOrderLine?.unitPrice);
      nilaiDiterima = nilaiDiterima.plus(d(l.acceptedQty).times(harga));
      for (const a of l.billAllocations) selisihFaktur = selisihFaktur.plus(d(a.qty).times(d(a.billPoLine.invoiceUnitPrice).minus(harga)));
    }
  }

  const vals = await valuasiDariPenerimaan(db, idPenerimaan);
  const total = { dipakai: nolPorsi(), retur: nolPorsi(), waste: nolPorsi(), penyesuaian: nolPorsi() };
  const perUnit = new Map(); const perBahan = new Map();
  for (const v of vals) {
    const k = KIND[v.costKind];
    for (const p of porsiDariPenerimaan(v, idSet)) {
      tambah(total[k], p);
      const u = perUnit.get(v.unitId) ?? { unitId: v.unitId, dipakai: nolPorsi(), retur: nolPorsi(), waste: nolPorsi(), penyesuaian: nolPorsi() };
      tambah(u[k], p); perUnit.set(v.unitId, u);
      const b = perBahan.get(p.materialId) ?? { materialId: p.materialId, dipakai: nolPorsi(), retur: nolPorsi(), waste: nolPorsi(), penyesuaian: nolPorsi() };
      tambah(b[k], p); perBahan.set(p.materialId, b);
    }
  }
  const unitInfo = perUnit.size ? await db.unit.findMany({ where: { id: { in: [...perUnit.keys()] } }, select: { id: true, unitCode: true, order: { select: { orderNumber: true } } } }) : [];
  const infoU = new Map(unitInfo.map((u) => [u.id, u]));

  // bahan PO yang pernah keluar TANPA harga (di unit mana pun) — tidak bisa dikaitkan ke penerimaan karena memang tidak punya dasar harga
  const bahanIds = [...new Set(po.lines.map((l) => l.materialId))];
  const tanpaHarga = bahanIds.length
    ? await db.finStockMovementValuation.findMany({ where: { status: "TANPA_HARGA", materialId: { in: bahanIds } }, select: { materialId: true, unitId: true } })
    : [];

  const nilai = (x) => (izinHarga ? uang(x) : null);
  const lapor = (x) => ({ qty: Number(x.qty.toDecimalPlaces(4)), nilai: nilai(x.nilai) });
  const infoBahan = new Map(po.lines.map((l) => [l.materialId, l.material]));
  return {
    po: { id: po.id, poNumber: po.poNumber, status: po.status },
    izinHarga,
    ringkasan: {
      nilaiDiterima: nilai(nilaiDiterima),
      nilaiDipakai: nilai(total.dipakai.nilai), nilaiRetur: nilai(total.retur.nilai.negated()), nilaiWaste: nilai(total.waste.nilai),
      nilaiBersihDipakai: nilai(total.dipakai.nilai.plus(total.retur.nilai).plus(total.penyesuaian.nilai)),
      selisihHargaFaktur: nilai(selisihFaktur),
      jumlahTanpaHarga: tanpaHarga.length, jumlahUnitTerkait: perUnit.size,
      catatan: "Nilai menurut harga PO yang dibekukan saat Material Issue. Selisih harga faktur terpisah dan tidak mengubah nilai pemakaian historis.",
    },
    bahan: [...perBahan.values()].map((b) => ({
      materialId: b.materialId, kode: infoBahan.get(b.materialId)?.code ?? null, nama: infoBahan.get(b.materialId)?.name ?? null, satuan: infoBahan.get(b.materialId)?.unit ?? null,
      dipakai: lapor(b.dipakai), retur: lapor({ qty: b.retur.qty, nilai: b.retur.nilai.negated() }), waste: lapor(b.waste),
      tanpaHarga: tanpaHarga.filter((t) => t.materialId === b.materialId).length,
    })),
    unit: [...perUnit.values()].map((u) => ({
      unitId: u.unitId, unitCode: infoU.get(u.unitId)?.unitCode ?? null, orderNumber: infoU.get(u.unitId)?.order?.orderNumber ?? null,
      dipakai: lapor(u.dipakai), retur: lapor({ qty: u.retur.qty, nilai: u.retur.nilai.negated() }), waste: lapor(u.waste),
    })).sort((a, b) => String(a.unitCode).localeCompare(String(b.unitCode))),
    bahanTanpaHarga: [...new Set(tanpaHarga.map((t) => t.materialId))].map((id) => ({ materialId: id, kode: infoBahan.get(id)?.code ?? null, nama: infoBahan.get(id)?.name ?? null, pergerakan: tanpaHarga.filter((t) => t.materialId === id).length })),
  };
}

// ── Penerimaan Barang (Gudang) ───────────────────────────────────────────────────────────────────────────

const LANGKAH = ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"];

export async function bacaJejakPenerimaan(db, receiptId, { izinHarga = false } = {}) {
  const r = await db.goodsReceipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true, receiptNumber: true, status: true, supplier: true, purchaseOrderId: true, purchaseOrder: { select: { id: true, poNumber: true } },
      lines: { select: { materialId: true, orderedQty: true, receivedQty: true, acceptedQty: true, rejectedQty: true, material: { select: { code: true, name: true, unit: true } } } },
      movements: { where: { type: "RECEIPT" }, select: { location: true, materialId: true } },
    },
  });
  if (!r) return null;
  const idx = LANGKAH.indexOf(r.status);
  const disimpan = r.status === "COMPLETED";
  const vals = await valuasiDariPenerimaan(db, [r.id]);
  const idSet = new Set([r.id]);
  const perBahan = new Map(); const issues = new Map(); const returs = [];
  const bahan = (id) => { if (!perBahan.has(id)) perBahan.set(id, { dipakai: ZERO, waste: ZERO, retur: ZERO, nilaiDipakai: ZERO }); return perBahan.get(id); };
  const unitIds = [...new Set(vals.map((v) => v.unitId).filter(Boolean))];
  const unitInfo = unitIds.length ? new Map((await db.unit.findMany({ where: { id: { in: unitIds } }, select: { id: true, unitCode: true } })).map((u) => [u.id, u.unitCode])) : new Map();
  for (const v of vals) {
    for (const p of porsiDariPenerimaan(v, idSet)) {
      const b = bahan(p.materialId);
      if (v.costKind === "PEMAKAIAN") {
        b.dipakai = b.dipakai.plus(p.qty); b.nilaiDipakai = b.nilaiDipakai.plus(p.nilai);
        const mi = v.movement?.materialIssue;
        if (mi) { const x = issues.get(mi.id) ?? { materialIssueId: mi.id, nomor: mi.issueNumber, unitCode: unitInfo.get(v.unitId) ?? null, qty: ZERO }; x.qty = x.qty.plus(p.qty); issues.set(mi.id, x); }
      } else if (v.costKind === "SUSUT") b.waste = b.waste.plus(p.qty);
      else if (v.costKind === "RETUR") { b.retur = b.retur.plus(p.qty); returs.push({ unitCode: unitInfo.get(v.unitId) ?? null, materialId: p.materialId, qty: Number(p.qty.toDecimalPlaces(4)), diterimaPada: v.movement?.createdAt ?? v.valuedAt }); }
    }
  }
  // Retur Supplier untuk kredit: pergerakan SUPPLIER_RETURN bertaut penerimaan ini (keluar negatif, pembatalan positif) → jumlah NETO yang sudah keluar ke supplier.
  const returSup = await db.stockMovement.groupBy({ by: ["materialId"], where: { goodsReceiptId: r.id, type: "SUPPLIER_RETURN" }, _sum: { qty: true } });
  const returSupplierPerBahan = new Map(returSup.map((x) => [x.materialId, d(x._sum.qty).negated()]));
  const barisBahan = r.lines.map((l) => {
    const b = bahan(l.materialId); // jumlah sudah terakumulasi per bahan
    const baik = d(l.acceptedQty);
    const masukStok = disimpan ? baik : ZERO;
    const returSupplier = returSupplierPerBahan.get(l.materialId) ?? ZERO;
    const tersisa = masukStok.minus(returSupplier).minus(b.dipakai).minus(b.waste).plus(b.retur);
    return {
      materialId: l.materialId, kode: l.material.code, nama: l.material.name, satuan: l.material.unit,
      dipesan: l.orderedQty, diterima: l.receivedQty, baik: l.acceptedQty, ditolak: l.rejectedQty, masukStok: Number(masukStok),
      returSupplier: Number(returSupplier.toDecimalPlaces(4)), stokBersih: Number(masukStok.minus(returSupplier).toDecimalPlaces(4)),
      dipakaiProduksi: Number(b.dipakai.toDecimalPlaces(4)), waste: Number(b.waste.toDecimalPlaces(4)), returDiterima: Number(b.retur.toDecimalPlaces(4)),
      tersisa: Number(tersisa.toDecimalPlaces(4)),
      nilaiDipakai: izinHarga ? uang(b.nilaiDipakai) : null,
      lokasi: [...new Set(r.movements.filter((m) => m.materialId === l.materialId).map((m) => m.location))].join(", ") || null,
    };
  });
  const adaDipakai = barisBahan.some((b) => b.dipakaiProduksi > 0);
  return {
    penerimaan: { id: r.id, nomor: r.receiptNumber, status: r.status, supplier: r.supplier, po: r.purchaseOrder ? { id: r.purchaseOrder.id, poNumber: r.purchaseOrder.poNumber } : null },
    izinHarga,
    langkah: [
      { kunci: "DITERIMA", nama: "Diterima", selesai: idx >= 2 },
      { kunci: "DIPERIKSA", nama: "Diperiksa", selesai: idx >= 4 },
      { kunci: "DISIMPAN", nama: "Simpan ke Stok", selesai: disimpan },
      { kunci: "DIPAKAI", nama: "Dipakai Produksi / Tersisa", selesai: disimpan && adaDipakai },
    ],
    bahan: barisBahan,
    materialIssue: [...issues.values()].map((x) => ({ ...x, qty: Number(x.qty.toDecimalPlaces(4)) })),
    returDariProduksi: returs,
    catatan: "Porsi pemakaian dihitung dari dasar harga rata-rata tertimbang yang dibekukan saat Material Issue — perkiraan bagian penerimaan ini, bukan penunjukan lot fisik.",
  };
}
