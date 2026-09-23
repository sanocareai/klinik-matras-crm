// FinExpense — SATU-SATUNYA tempat yang menulis baris fin_expenses. Diekstrak dari
// routes/financeTransactions.js (POST /expenses) supaya bisa dipakai ulang oleh sistem
// lain di luar Finance (mis. Pengajuan Biaya Lintas Divisi, services/expenseSubmission/)
// TANPA menduplikasi aturan pembuatan dokumen — "satu sumber transaksi, satu ledger."
//
// Fungsi ini TIDAK memposting jurnal (dokumen dulu, jurnal belakangan — lihat pola #1 di
// kepala financeTransactions.js). Menerima `db` sebagai Prisma client ATAU transaction
// client (`tx`) — pemanggil yang menentukan apakah perlu transaksi lebih besar di
// sekelilingnya (mis. Pengajuan Biaya membungkus panggilan ini dalam transaksinya sendiri
// supaya penautan finExpenseId atomik dengan pembuatan barisnya).

import { generateDocumentNumber, toBookDate, todayBookDateWIB } from "./journal.js";
import { toMoney, moneyToNumber } from "./money.js";
import { hasPermission } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";

export class ExpenseInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ExpenseInputError";
    this.statusCode = statusCode;
  }
}

export const expenseInclude = {
  category: { select: { id: true, code: true, name: true, division: true, account: { select: { code: true, name: true } } } },
  cashAccount: { select: { id: true, name: true, kind: true } },
  supplier: { select: { id: true, name: true } },
  reimburseTo: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  paidBy: { select: { id: true, name: true } },
  order: { select: { id: true, orderNumber: true } },
};

function parseTanggal(value) {
  if (!value) return todayBookDateWIB();
  return toBookDate(value);
}

/**
 * Buat SATU FinExpense. `user` menentukan mode efektif (pemegang hanya
 * finance:expense:submit selalu REIMBURSEMENT, menalangi dirinya sendiri —
 * lihat aturan yang sama di POST /expenses).
 */
export async function buatFinExpense(db, {
  date, amount, description, categoryId, division, mode,
  cashAccountId, supplierId, reimburseToId, payeeName, orderId, unitId, receiptUrl, notes,
  langsungAjukan, user,
}) {
  if (!description?.trim()) throw new ExpenseInputError("Keterangan pengeluaran wajib diisi");
  if (!categoryId) throw new ExpenseInputError("Kategori biaya wajib dipilih");
  const nominal = toMoney(amount, { field: "Nominal pengeluaran" });
  if (nominal.lessThanOrEqualTo(0)) throw new ExpenseInputError("Nominal pengeluaran harus lebih dari 0");

  const kategori = await db.finExpenseCategory.findUnique({ where: { id: categoryId }, select: { id: true, active: true, division: true } });
  if (!kategori || !kategori.active) throw new ExpenseInputError("Kategori biaya tidak ditemukan atau sudah nonaktif", 404);

  const modeFinal = ["LANGSUNG", "REIMBURSEMENT", "UTANG"].includes(mode) ? mode : "LANGSUNG";
  const bolehPosting = hasPermission(user, P.FINANCE_POST);
  const modeEfektif = bolehPosting ? modeFinal : "REIMBURSEMENT";

  if (modeEfektif === "LANGSUNG" && !cashAccountId) {
    throw new ExpenseInputError("Pengeluaran yang dibayar langsung wajib memilih rekening kas/bank sumber dananya");
  }

  const tanggal = parseTanggal(date);
  const expenseNumber = await generateDocumentNumber(db, "EXP", tanggal);

  return db.finExpense.create({
    data: {
      expenseNumber,
      date: tanggal,
      amount: nominal,
      description: description.trim(),
      categoryId,
      division: division || kategori.division,
      mode: modeEfektif,
      cashAccountId: modeEfektif === "LANGSUNG" ? cashAccountId : (cashAccountId || null),
      supplierId: supplierId || null,
      reimburseToId: modeEfektif === "REIMBURSEMENT" ? ((bolehPosting && reimburseToId) || user.id) : null,
      payeeName: payeeName?.trim() || null,
      orderId: orderId || null,
      unitId: unitId || null,
      receiptUrl: receiptUrl || null,
      notes: notes?.trim() || null,
      status: langsungAjukan === false ? "DRAFT" : "MENUNGGU_APPROVAL",
      submittedAt: langsungAjukan === false ? null : new Date(),
      createdById: user.id,
    },
    include: expenseInclude,
  });
}

/** Tarik kembali pengeluaran yang MENUNGGU_APPROVAL ke DRAFT — kebalikan dari submit. Hanya sebelum diputuskan (belum ada jurnal). */
export async function tarikFinExpense(db, { id, user }) {
  const e = await db.finExpense.findUnique({ where: { id }, select: { id: true, status: true, createdById: true } });
  if (!e) throw new ExpenseInputError("Pengeluaran tidak ditemukan", 404);
  if (e.status !== "MENUNGGU_APPROVAL") throw new ExpenseInputError(`Pengeluaran berstatus ${e.status} — hanya yang menunggu persetujuan yang bisa ditarik`, 409);
  if (e.createdById !== user.id && !hasPermission(user, P.FINANCE_ADMIN)) {
    throw new ExpenseInputError("Hanya pengaju sendiri (atau admin keuangan) yang boleh menarik pengajuan ini", 403);
  }
  return db.finExpense.update({ where: { id }, data: { status: "DRAFT", submittedAt: null }, include: expenseInclude });
}

export function bentukExpense(e) {
  return { ...e, amount: moneyToNumber(e.amount) };
}
