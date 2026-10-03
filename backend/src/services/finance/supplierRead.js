// BACA SUPPLIER & UTANG — SATU sumber query untuk layar Supplier & Utang (GET /bills, /supplier-payments, /suppliers,
// /bills/unbilled-receipts di routes/financeTransactions.js) dan Export Excel (services/finance/export/supplier-utang.js),
// supaya angka di berkas Excel tidak mungkin berbeda dari yang tampil di layar. Murni baca: tidak ada tulis ke database.
//
// Bentuk hasil SAMA PERSIS dengan respons endpoint layar (route hanya menambah `koreksi` untuk menu aksi tagihan).
// Mode `ids` (export dari baris yang tampil setelah filter sisi-klien): baris dimuat ulang lewat include & bentuk yang sama,
// dengan URUTAN mengikuti `ids` — id yang tidak ada dilewati.

import { jenisTampilan } from "./jenisTagihan.js";
import { toMoney, sumMoney, moneyToNumber, ZERO } from "./money.js";
import { ringkasBiaya } from "./transferFee.js";

/** Urutkan baris hasil query `id in (...)` mengikuti urutan `ids` (urutan layar). */
export function urutkanSesuaiIds(rows, ids) {
  const urut = new Map(ids.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => urut.get(a.id) - urut.get(b.id));
}

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** id yang bukan UUID membuat Prisma galat — cukup dilewati. */
export const idValid = (ids) => (ids || []).map(String).filter((id) => POLA_UUID.test(id));

// ── Tagihan supplier ────────────────────────────────────────────────────

export const billInclude = {
  supplier: { select: { id: true, code: true, name: true, paymentTermDays: true } },
  goodsReceipt: { select: { id: true, receiptNumber: true, supplier: true, receivedDate: true } },
  purchaseCategory: { select: { id: true, code: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  replaces: { select: { id: true, billNumber: true } },
  replacedBy: { select: { id: true, billNumber: true } },
  allocations: {
    where: { payment: { cancelledAt: null } },
    select: { amount: true, payment: { select: { id: true, paymentNumber: true, date: true } } },
  },
};

export function bentukBill(b) {
  const terbayar = b.allocations?.length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO;
  return {
    ...b,
    amount: moneyToNumber(b.amount),
    terbayar: moneyToNumber(terbayar),
    sisa: moneyToNumber(toMoney(b.amount).minus(terbayar)),
    allocations: b.allocations?.map((a) => ({ ...a, amount: moneyToNumber(a.amount) })),
    jenisTagihan: jenisTampilan(b),
  };
}

/**
 * Daftar tagihan menurut filter layar (status, supplierId, jatuhTempo=lewat). Mengembalikan baris MENTAH (belum `bentukBill`) supaya
 * route bisa menghitung menu koreksi dari id yang sama. `ids` (opsional) menggantikan filter: muat ulang baris itu berurutan.
 */
export async function ambilDaftarTagihan(db, { status, supplierId, jatuhTempo } = {}, { take = 300, ids = null } = {}) {
  if (ids) {
    const rows = await db.finSupplierBill.findMany({ where: { id: { in: idValid(ids) } }, include: billInclude });
    return urutkanSesuaiIds(rows, idValid(ids));
  }
  return db.finSupplierBill.findMany({
    where: {
      ...(status && { status }),
      ...(supplierId && { supplierId }),
      // "jatuhTempo=lewat" — tagihan yang sudah lewat jatuh tempo & belum lunas.
      ...(jatuhTempo === "lewat" && {
        dueDate: { lt: new Date() },
        status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] },
      }),
    },
    orderBy: [{ dueDate: "asc" }, { billDate: "desc" }],
    take,
    include: billInclude,
  });
}

// ── Pembayaran ke supplier ──────────────────────────────────────────────

export const pembayaranSupplierInclude = {
  supplier: { select: { id: true, name: true } },
  cashAccount: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  allocations: { include: { bill: { select: { id: true, billNumber: true } } } },
};

export function bentukPembayaranSupplier(p) {
  return {
    ...p,
    amount: moneyToNumber(p.amount),
    // biaya admin transfer + total keluar rekening dihitung SERVER (layar menampilkan total di daftar, rincian di panel)
    transferFeeAmount: moneyToNumber(p.transferFeeAmount ?? 0), ...ringkasBiaya(p),
    allocations: p.allocations.map((a) => ({ ...a, amount: moneyToNumber(a.amount) })),
  };
}

/** `rentang` = { from, to } (Date tanggal-buku, dari rentangDariQuery — layar tanpa parameter = bulan berjalan). */
export async function ambilDaftarPembayaranSupplier(db, { rentang, supplierId } = {}, { take = 200, ids = null } = {}) {
  if (ids) {
    const rows = await db.finSupplierPayment.findMany({ where: { id: { in: idValid(ids) } }, include: pembayaranSupplierInclude });
    return urutkanSesuaiIds(rows, idValid(ids)).map(bentukPembayaranSupplier);
  }
  const rows = await db.finSupplierPayment.findMany({
    where: { date: { gte: rentang.from, lte: rentang.to }, ...(supplierId && { supplierId }) },
    orderBy: { date: "desc" },
    take,
    include: pembayaranSupplierInclude,
  });
  return rows.map(bentukPembayaranSupplier);
}

// ── Master supplier ─────────────────────────────────────────────────────

const supplierInclude = {
  bills: {
    where: { status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] } },
    select: { amount: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
  },
};

export function bentukSupplier(s) {
  const sisa = s.bills.reduce((acc, b) => {
    const terbayar = b.allocations.length === 0 ? ZERO : sumMoney(b.allocations.map((a) => a.amount));
    return acc.plus(toMoney(b.amount).minus(terbayar));
  }, ZERO);
  return { ...s, bills: undefined, jumlahTagihanTerbuka: s.bills.length, sisaUtang: moneyToNumber(sisa) };
}

export async function ambilDaftarSupplier(db, { includeInactive = false } = {}, { ids = null } = {}) {
  if (ids) {
    const rows = await db.finSupplier.findMany({ where: { id: { in: idValid(ids) } }, include: supplierInclude });
    return urutkanSesuaiIds(rows, idValid(ids)).map(bentukSupplier);
  }
  const rows = await db.finSupplier.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { name: "asc" },
    include: supplierInclude,
  });
  return rows.map(bentukSupplier);
}

// ── Penerimaan barang yang belum ditagih ────────────────────────────────

/** Dokumen penerimaan barang yang BELUM pernah ditagih — dipakai UI saat membuat tagihan supplier & kartu ringkasan. */
export async function ambilPenerimaanBelumDitagih(db) {
  const receipts = await db.goodsReceipt.findMany({
    where: { status: "COMPLETED", finSupplierBills: { none: {} } },
    orderBy: { receivedDate: "desc" },
    take: 100,
    select: {
      id: true, receiptNumber: true, supplier: true, receivedDate: true, sourceReference: true,
      movements: { where: { type: "RECEIPT" }, select: { qty: true, unitCost: true } },
    },
  });
  return receipts.map((r) => {
    const berharga = r.movements.filter((m) => m.unitCost != null && m.unitCost > 0);
    const nilai = berharga.length === 0 ? ZERO : sumMoney(berharga.map((m) => toMoney(m.qty).times(toMoney(m.unitCost))));
    return {
      id: r.id, receiptNumber: r.receiptNumber, supplier: r.supplier,
      receivedDate: r.receivedDate, sourceReference: r.sourceReference,
      jumlahBaris: r.movements.length,
      barisTanpaHarga: r.movements.length - berharga.length,
      nilaiTerima: moneyToNumber(nilai),
    };
  });
}
