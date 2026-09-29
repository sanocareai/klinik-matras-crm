// BACA PEMBELIAN — SATU sumber query untuk layar Pembelian (GET /api/finance/purchases) dan Export Excel
// (services/finance/export/pembelian.js). Pola identik dengan expenseRead.js. Murni baca.

import { toMoney, sumMoney, moneyToNumber, ZERO } from "./money.js";
import { ringkasBiaya } from "./transferFee.js";
import { klausaCari, klausaBukti, batasMilikSendiri, hanyaMilikSendiri, POLA_UUID } from "./expenseRead.js";

export const purchaseInclude = {
  category: { select: { id: true, code: true, name: true, account: { select: { code: true, name: true } } } },
  cashAccount: { select: { id: true, name: true, kind: true } },
  supplier: { select: { id: true, name: true } },
  reimburseTo: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  paidBy: { select: { id: true, name: true } },
};

export function bentukPurchase(p) {
  return { ...p, amount: moneyToNumber(p.amount), transferFeeAmount: moneyToNumber(p.transferFeeAmount ?? 0), ...ringkasBiaya(p) };
}

export const KOLOM_CARI_PEMBELIAN = ["purchaseNumber", "description", "payeeName", "notes", "category.name", "supplier.name", "reimburseTo.name"];

/**
 * Indikator "DP Rp…"/"Sisa Rp…" untuk daftar — dua agregat sekali jalan (bukan N+1 per baris). Sisi TUJUAN: pembelian
 * mode UTANG menerima DP → dpDiterapkan/sisaUtang. Sisi SUMBER: pembelian kategori Uang Muka Pembelian yang sudah
 * dipakai → dpDigunakan/dpTersedia. Baris di luar dua golongan itu tidak mendapat field tambahan.
 */
async function perkaya(db, purchases) {
  const idTujuan = purchases.filter((p) => p.mode === "UTANG" && p.category?.code !== "UANG_MUKA_PEMBELIAN").map((p) => p.id);
  const idSumber = purchases.filter((p) => p.category?.code === "UANG_MUKA_PEMBELIAN").map((p) => p.id);
  const [grupTujuan, grupSumber] = await Promise.all([
    idTujuan.length === 0 ? [] : db.finPurchaseAdvanceApplication.groupBy({
      by: ["targetPurchaseId"], where: { targetPurchaseId: { in: idTujuan }, status: "ACTIVE" }, _sum: { amount: true },
    }),
    idSumber.length === 0 ? [] : db.finPurchaseAdvanceApplication.groupBy({
      by: ["advancePurchaseId"], where: { advancePurchaseId: { in: idSumber }, status: "ACTIVE" }, _sum: { amount: true },
    }),
  ]);
  const dpTujuanMap = new Map(grupTujuan.map((g) => [g.targetPurchaseId, g._sum.amount]));
  const dpSumberMap = new Map(grupSumber.map((g) => [g.advancePurchaseId, g._sum.amount]));

  return purchases.map((p) => {
    const hasil = { ...bentukPurchase(p), notaWajib: true }; // pembelian SELALU wajib nota (aturan notaWajib)
    const dpKeTujuan = dpTujuanMap.get(p.id);
    if (dpKeTujuan != null) {
      const dp = toMoney(dpKeTujuan);
      hasil.dpDiterapkan = moneyToNumber(dp);
      hasil.sisaUtang = moneyToNumber(toMoney(p.amount).minus(dp));
    }
    const dpDipakai = dpSumberMap.get(p.id);
    if (dpDipakai != null) {
      const dp = toMoney(dpDipakai);
      hasil.dpDigunakan = moneyToNumber(dp);
      hasil.dpTersedia = moneyToNumber(toMoney(p.amount).minus(dp));
    }
    return hasil;
  });
}

/** Daftar pembelian menurut filter layar. Bentuk hasil sama persis dengan respons GET /purchases. */
export async function ambilDaftarPembelian(db, { rentang, status, division, categoryId, mode, q, bukti, cashAccountId } = {}, { user, take = 300 } = {}) {
  const purchases = await db.finPurchase.findMany({
    where: {
      date: { gte: rentang.from, lte: rentang.to },
      ...(status && { status }),
      ...(division && { division }),
      ...(categoryId && { categoryId }),
      ...(mode && { mode }),
      ...(cashAccountId && { cashAccountId }),
      ...klausaBukti(bukti),
      AND: [
        ...batasMilikSendiri(user),
        ...klausaCari(q, KOLOM_CARI_PEMBELIAN),
      ],
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
    include: purchaseInclude,
  });

  const total = purchases.length === 0 ? ZERO : sumMoney(purchases.map((p) => p.amount));
  return {
    purchases: await perkaya(db, purchases),
    total: moneyToNumber(total),
    hanyaMilikSendiri: hanyaMilikSendiri(user),
    terpotong: purchases.length === take,
  };
}

/** Muat ulang baris tertentu (urutan mengikuti `ids`) lewat bentuk & batasan izin yang sama dengan daftar layar. */
export async function ambilPembelianByIds(db, ids, { user } = {}) {
  const idValid = ids.filter((id) => POLA_UUID.test(id));
  const rows = await db.finPurchase.findMany({
    where: { id: { in: idValid }, AND: batasMilikSendiri(user) },
    include: purchaseInclude,
  });
  const urut = new Map(idValid.map((id, i) => [id, i]));
  rows.sort((a, b) => urut.get(a.id) - urut.get(b.id));
  return perkaya(db, rows);
}
