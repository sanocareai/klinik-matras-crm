// BACA JURNAL UMUM — SATU sumber query untuk layar Jurnal Umum (GET /api/finance/journal) dan Export Excel
// (services/finance/export/jurnal-umum.js), supaya baris & angka berkas Excel tidak mungkin berbeda dari layar. Murni baca.

import { moneyToNumber, sumMoney } from "./money.js";

const akunRingkas = { select: { id: true, code: true, name: true } };

/** Include layar (ringan). `dimensi: true` (export) menambah dimensi tiap baris: order, pelanggan, supplier, rekening kas/bank. */
export function jurnalInclude({ dimensi = false } = {}) {
  return {
    lines: {
      orderBy: { lineNo: "asc" },
      include: {
        account: akunRingkas,
        ...(dimensi && {
          order: { select: { id: true, orderNumber: true } },
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          cashAccount: { select: { id: true, name: true } },
        }),
      },
    },
    createdBy: { select: { id: true, name: true } },
    reversedBy: { select: { id: true, entryNumber: true } },
    reversalOf: { select: { id: true, entryNumber: true } },
  };
}

/** Bentuk respons layar: nominal jadi number + totalDebit per jurnal. */
export function bentukJurnal(e) {
  return {
    ...e,
    totalDebit: moneyToNumber(sumMoney(e.lines.map((l) => l.debit))),
    lines: e.lines.map((l) => ({ ...l, debit: moneyToNumber(l.debit), credit: moneyToNumber(l.credit) })),
  };
}

/**
 * Daftar jurnal menurut filter layar. `from`/`to` = Date tanggal-buku (UTC tengah malam, hasil rentangDariQuery); `search` mencari nomor & keterangan.
 * `take`/`skip` membatasi baris (layar: maks 500 per halaman; export memakai batas lebih besar). Urutan: tanggal terbaru dulu.
 */
export async function ambilDaftarJurnal(db, { from, to, source, status, search } = {}, { take = 100, skip = 0, dimensi = false } = {}) {
  const where = {
    date: { gte: from, lte: to },
    ...(source && { source }),
    ...(status && { status }),
    ...(search && {
      OR: [
        { entryNumber: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ],
    }),
  };
  const [entries, total] = await Promise.all([
    db.finJournalEntry.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take, skip, include: jurnalInclude({ dimensi }) }),
    db.finJournalEntry.count({ where }),
  ]);
  return { entries, total };
}

// Label tampilan — SAMA dengan frontend/src/features/finance/shared.jsx (LABEL_SUMBER_JURNAL & status jurnal), dipakai Export Excel
// (Jurnal Umum & Buku Besar) supaya istilah di berkas identik dengan layar.
export const LABEL_SUMBER_JURNAL = {
  MANUAL: "Jurnal Manual", SALDO_AWAL: "Saldo Awal", PEMBAYARAN_ORDER: "Pembayaran Order", PENGAKUAN_PENDAPATAN: "Pengakuan Pendapatan", REFUND: "Refund",
  UANG_MUKA_OPERASIONAL: "Uang Muka Operasional", PENGELUARAN: "Pengeluaran", PEMBELIAN: "Pembelian", BIAYA_KENDARAAN: "Biaya Kendaraan", BIAYA_IKLAN: "Belanja Iklan",
  PEMASUKAN_LAIN: "Pemasukan Lain", TRANSFER_KAS: "Transfer Kas", TAGIHAN_SUPPLIER: "Tagihan Supplier", PEMBAYARAN_SUPPLIER: "Pembayaran Supplier",
  PEMAKAIAN_BAHAN: "Pemakaian Bahan", PENERIMAAN_BAHAN: "Penerimaan Bahan", KASBON: "Kasbon", REVERSAL: "Jurnal Balik",
};
export const labelSumberJurnal = (s) => LABEL_SUMBER_JURNAL[s] || s || "";
export const LABEL_STATUS_JURNAL = { DRAFT: "Draft", POSTED: "Terposting", REVERSED: "Dibalik" };
export const labelStatusJurnal = (s) => LABEL_STATUS_JURNAL[s] || s || "";
