// BACA PEMBELIAN — SATU sumber query untuk layar Pembelian (GET /api/finance/purchases) dan Export Excel
// (services/finance/export/pembelian.js). Pola identik dengan expenseRead.js. Murni baca.

import { toMoney, moneyToNumber, ZERO } from "./money.js";
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
// Status yang TIDAK dihitung sebagai pembelian nyata (sama dengan pengeluaran): dibatalkan (jurnal dibalik) dan ditolak (tidak pernah dibukukan).
export const STATUS_TIDAK_DIHITUNG = ["DIBATALKAN", "DITOLAK"];

export async function ambilDaftarPembelian(db, { rentang, status, division, categoryId, mode, q, bukti, cashAccountId } = {}, { user, take = 300 } = {}) {
  const where = {
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
  };
  const [purchases, perStatusMentah] = await Promise.all([
    db.finPurchase.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take, include: purchaseInclude }),
    // Fase 1 — Kontrak Angka: ringkasan dari SEMUA baris yang cocok filter (bukan hanya `take` baris yang dimuat), dan pembelian Dibatalkan/Ditolak dipisah dari
    // total aktif — sama dengan Pengeluaran. Sebelumnya "Total di Filter Ini" menjumlahkan semua status (termasuk yang dibatalkan) dan hanya 300 baris teratas.
    db.finPurchase.groupBy({ by: ["status"], where, _sum: { amount: true }, _count: { _all: true } }),
  ]);

  const perStatus = {};
  for (const g of perStatusMentah) perStatus[g.status] = { jumlah: g._count._all, nominal: moneyToNumber(g._sum.amount ?? ZERO) };
  const jumlahSemua = Object.values(perStatus).reduce((s, x) => s + x.jumlah, 0);
  const total = Object.values(perStatus).reduce((s, x) => s + x.nominal, 0);
  const tidakDihitung = STATUS_TIDAK_DIHITUNG.reduce((a, s) => ({ jumlah: a.jumlah + (perStatus[s]?.jumlah ?? 0), nominal: a.nominal + (perStatus[s]?.nominal ?? 0) }), { jumlah: 0, nominal: 0 });
  return {
    purchases: await perkaya(db, purchases),
    total, // SEMUA baris yang cocok filter, semua status
    ringkasan: {
      jumlahSemua, total,
      jumlahAktif: jumlahSemua - tidakDihitung.jumlah, totalAktif: total - tidakDihitung.nominal, // di luar dibatalkan/ditolak
      tidakDihitung, perStatus,
    },
    hanyaMilikSendiri: hanyaMilikSendiri(user),
    terpotong: jumlahSemua > purchases.length,
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
