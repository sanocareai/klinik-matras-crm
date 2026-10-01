// BACA KASBON — SATU sumber query untuk layar Kasbon (GET /api/finance/kasbon) dan Export Excel (services/finance/export/kasbon.js),
// supaya angka di berkas Excel tidak mungkin berbeda dari yang tampil di layar. Murni baca.

import { toBookDate } from "./journal.js";
import { toMoney, sumMoney, moneyToNumber, ZERO } from "./money.js";
import { ringkasBiaya } from "./transferFee.js";

export const kasbonInclude = {
  repayments: {
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: { createdBy: { select: { id: true, name: true } }, cashAccount: { select: { id: true, name: true } } },
  },
  cashAccount: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

export function bentukKasbon(k) {
  const aktif = k.repayments.filter((r) => !r.cancelledAt);
  const dariBaris = aktif.length ? sumMoney(aktif.map((r) => r.amount)) : ZERO;
  const amount = toMoney(k.amount);
  const lunas = k.status === "LUNAS";
  const sisa = k.status === "AKTIF" ? amount.minus(dariBaris) : ZERO;
  return {
    ...k,
    amount: moneyToNumber(amount),
    transferFeeAmount: moneyToNumber(k.transferFeeAmount ?? 0),
    ...ringkasBiaya(k),
    terlunasi: moneyToNumber(lunas ? amount : dariBaris),
    sisa: moneyToNumber(sisa),
    repayments: k.repayments.map((r) => ({ ...r, amount: moneyToNumber(r.amount) })),
  };
}

export function klausaCariKasbon(q) {
  const kata = String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return kata.map((k) => {
    const atau = ["kasbonNumber", "employeeName", "urgency", "notes"].map((f) => ({ [f]: { contains: k, mode: "insensitive" } }));
    const angka = k.replace(/\./g, "");
    if (/^\d{3,}$/.test(angka)) atau.push({ amount: Number(angka) });
    return { OR: atau };
  });
}

/** WHERE daftar kasbon menurut filter layar (q, status, karyawan, from, to) — dipakai daftar DAN ringkasan filter supaya angkanya pasti sama. */
export function whereKasbon({ q, status, karyawan, from, to } = {}) {
  return {
    ...(status && { status }),
    ...(karyawan && { employeeName: { equals: karyawan, mode: "insensitive" } }),
    ...((from || to) && { date: { ...(from && { gte: toBookDate(from) }), ...(to && { lte: toBookDate(to) }) } }),
    AND: klausaCariKasbon(q),
  };
}

/** Daftar kasbon menurut filter layar (q, status, karyawan, from, to). `take` membatasi jumlah baris; export memakai batas lebih besar. */
export async function ambilDaftarKasbon(db, filter = {}, { take = 500 } = {}) {
  return db.finKasbon.findMany({
    where: whereKasbon(filter),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
    include: kasbonInclude,
  });
}

/**
 * Ringkasan SEMUA kasbon yang cocok filter (bukan hanya baris yang dimuat): jumlah & nominal diberikan. Kasbon dibatalkan tidak dijumlahkan
 * kecuali filter status memang meminta Dibatalkan.
 */
export async function ringkasFilterKasbon(db, filter = {}) {
  const where = whereKasbon(filter);
  const a = await db.finKasbon.aggregate({
    where: filter.status ? where : { AND: [where, { status: { not: "DIBATALKAN" } }] },
    _count: { _all: true }, _sum: { amount: true },
  });
  return { jumlah: a._count._all, nominal: Number(a._sum.amount || 0) };
}
