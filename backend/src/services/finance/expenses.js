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
import { toMoney, moneyToNumber, ZERO } from "./money.js";
import { hasPermission } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { postExpenseApproved } from "./posting/expense.js";
import { pastikanNotaLengkap } from "./receipts.js";
import { terapkanKePengeluaran, sinkronStatusUangMuka } from "./operationalAdvance.js";
import { hitungBiayaTransfer, TransferFeeError, ringkasBiaya, pastikanTanpaBiayaSebelumBayar } from "./transferFee.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

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
  advance: { select: { id: true, advanceNumber: true } },
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
  paymentMethod, transferFeeType, transferFeeAmount,
  // Uang Muka Operasional: bila diisi, pengeluaran BERMODE UANG_MUKA (dipertanggungjawabkan dari
  // saldo uang muka itu, tanpa /pay). Izin "boleh memakai uang muka ini" divalidasi PEMANGGIL.
  advanceId,
  langsungAjukan, user,
  // Lolos guard "hanya boleh reimburse diri sendiri" di bawah TANPA butuh
  // FINANCE_POST — dipakai KHUSUS oleh ajukanPengajuan() (Pengajuan Biaya
  // Lintas Divisi) untuk kasus "catat atas nama": permission "boleh mencatat
  // untuk orang lain" SUDAH divalidasi terpisah di sana (lihat
  // service.js#buatPengajuan) SEBELUM sampai ke sini — pemanggil HTTP biasa
  // (routes/financeTransactions.js POST /expenses) tidak pernah mengirim ini,
  // jadi perlindungan lama (user biasa tidak bisa menaruh reimburseToId
  // sembarang orang di body request) tetap utuh.
  reimburseToOverrideAllowed = false,
  // C1 — Pengajuan Biaya Produksi/Gudang: pengaju non-Finance tidak dipaksa jadi REIMBURSEMENT; mode usulan (UTANG/REIMBURSEMENT) dihormati.
  // LANGSUNG tetap tidak pernah dari jalur ini (butuh rekening & hak FINANCE_POST).
  ikutiModeUsulan = false,
}) {
  if (!description?.trim()) throw new ExpenseInputError("Keterangan pengeluaran wajib diisi");
  if (!categoryId) throw new ExpenseInputError("Kategori biaya wajib dipilih");
  const nominal = toMoney(amount, { field: "Nominal pengeluaran" });
  if (nominal.lessThanOrEqualTo(0)) throw new ExpenseInputError("Nominal pengeluaran harus lebih dari 0");

  const kategori = await db.finExpenseCategory.findUnique({ where: { id: categoryId }, select: { id: true, active: true, division: true } });
  if (!kategori || !kategori.active) throw new ExpenseInputError("Kategori biaya tidak ditemukan atau sudah nonaktif", 404);

  const modeFinal = ["LANGSUNG", "REIMBURSEMENT", "UTANG"].includes(mode) ? mode : "LANGSUNG";
  const bolehPosting = hasPermission(user, P.FINANCE_POST);
  let uangMuka = null;
  if (advanceId) {
    uangMuka = await db.finOperationalAdvance.findUnique({ where: { id: advanceId }, select: { id: true, holderId: true, status: true, advanceNumber: true } });
    if (!uangMuka) throw new ExpenseInputError("Uang muka tidak ditemukan", 404);
    if (!["AKTIF", "SEBAGIAN"].includes(uangMuka.status)) {
      throw new ExpenseInputError(`Uang muka ${uangMuka.advanceNumber} berstatus ${uangMuka.status} — pilih uang muka yang masih aktif`, 409);
    }
  }
  const modeEfektif = uangMuka ? "UANG_MUKA" : (bolehPosting ? modeFinal : (ikutiModeUsulan && modeFinal !== "LANGSUNG" ? modeFinal : "REIMBURSEMENT"));

  if (modeEfektif === "LANGSUNG" && !cashAccountId) {
    throw new ExpenseInputError("Pengeluaran yang dibayar langsung wajib memilih rekening kas/bank sumber dananya");
  }

  // Biaya admin transfer hanya berlaku bila uang keluar SAAT dokumen ini diposting
  // (LANGSUNG). Mode REIMBURSEMENT/UTANG memilih cara bayar & biayanya di /pay.
  let biaya = { paymentMethod: null, transferFeeType: null, transferFeeAmount: 0 };
  {
    try {
      if (modeEfektif === "LANGSUNG") {
        biaya = await hitungBiayaTransfer(db, { cashAccountId, paymentMethod, transferFeeType, transferFeeAmount });
      } else {
        pastikanTanpaBiayaSebelumBayar({ paymentMethod, transferFeeType, transferFeeAmount });
      }
    } catch (e) {
      if (e instanceof TransferFeeError) throw new ExpenseInputError(e.message, e.statusCode);
      throw e;
    }
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
      reimburseToId: modeEfektif === "REIMBURSEMENT"
        ? (((bolehPosting || reimburseToOverrideAllowed) && reimburseToId) || user.id)
        : (uangMuka ? uangMuka.holderId : null),
      advanceId: uangMuka ? uangMuka.id : null,
      payeeName: payeeName?.trim() || null,
      orderId: orderId || null,
      unitId: unitId || null,
      receiptUrl: receiptUrl || null,
      notes: notes?.trim() || null,
      paymentMethod: biaya.paymentMethod,
      transferFeeType: biaya.transferFeeType,
      transferFeeAmount: biaya.transferFeeAmount,
      status: langsungAjukan === false ? "DRAFT" : "MENUNGGU_APPROVAL",
      submittedAt: langsungAjukan === false ? null : new Date(),
      createdById: user.id,
    },
    include: expenseInclude,
  });
}

/**
 * Setujui SATU FinExpense — jurnal pengakuan beban (+ pembayaran sekaligus untuk mode
 * LANGSUNG). Diekstrak dari routes/financeTransactions.js POST /expenses/:id/approve
 * (24 September 2026) supaya jalur OTOMATIS (Pengajuan Biaya Lintas Divisi — biaya rutin
 * bernilai kecil, lihat config.js#bolehAutoApprove) memakai PERSIS logika yang sama dengan
 * persetujuan manual Finance — tidak ada cabang kedua yang bisa diam-diam berbeda dari
 * cabang pertama (pola yang sama dijaga blok PEMBELIAN vs PENGELUARAN di file itu).
 *
 * `autoApproved: true` — dipanggil SISTEM (bukan manusia), dari DALAM transaksi
 * ajukanPengajuan() yang sama dengan pembuatan dokumennya:
 *   - LEWATI guard "tidak boleh menyetujui pengajuan sendiri" (tidak relevan — tidak ada
 *     manusia yang menyetujui apa pun di sini).
 *   - FinExpense.approvedById TETAP null (SUNGGUHAN tidak ada manusia yang approve).
 *   - Log aktivitas & `catatanOtomatis` (audit trail ExpenseSubmission, ditulis pemanggil)
 *     tetap merekam SIAPA yang memicu (via `actor`) dan KEBIJAKAN yang dipakai — auto-approve
 *     tetap tertelusuri, bukan "tidak tercatat".
 * Nota tetap WAJIB diperiksa (pastikanNotaLengkap) — kebijakan auto-approve TIDAK
 * mengecualikan syarat bukti, cuma mengecualikan langkah klik manusia.
 */
export async function setujuiFinExpense(tx, { id, actor, autoApproved = false, catatanOtomatis = null }) {
  await lockRowForUpdate(tx, '"fin_expenses"', id);
  const e = await tx.finExpense.findUnique({ where: { id } });
  if (!e) throw new ExpenseInputError("Pengeluaran tidak ditemukan", 404);
  if (!["DRAFT", "MENUNGGU_APPROVAL"].includes(e.status)) {
    throw new ExpenseInputError(`Pengeluaran ini sudah berstatus ${e.status} — tidak bisa disetujui lagi`, 409);
  }

  const menyetujuiSendiri = !autoApproved && e.createdById === actor.id;
  if (menyetujuiSendiri && !hasPermission(actor, P.FINANCE_ADMIN)) {
    throw new ExpenseInputError(
      "Pengajuan Anda sendiri harus disetujui orang lain. Ini bukan soal kepercayaan — " +
      "persetujuan yang diberikan sendiri tidak punya nilai kontrol apa pun saat diaudit.",
      403
    );
  }

  const kat = await tx.finExpenseCategory.findUnique({ where: { id: e.categoryId }, select: { code: true } });
  await pastikanNotaLengkap(tx, {
    jenis: "expense", doc: e, categoryCode: kat?.code,
    err: (m, c) => Object.assign(new ExpenseInputError(m, c)),
  });

  // Uang Muka Operasional: saldo dipakai DI SINI, di bawah kunci baris uang muka. Melebihi saldo =
  // saldo habis dulu, selisihnya jadi utang reimbursement ke pemegang (tidak pernah saldo negatif).
  let applied = ZERO;
  let selisih = ZERO;
  if (e.mode === "UANG_MUKA") {
    const r = await terapkanKePengeluaran(tx, { expense: e, userId: autoApproved ? null : actor.id });
    applied = r.applied;
    selisih = r.sisa;
  }
  const langsungLunas = e.mode === "LANGSUNG" || (e.mode === "UANG_MUKA" && selisih.isZero());

  const updated = await tx.finExpense.update({
    where: { id: e.id },
    data: {
      status: langsungLunas ? "DIBAYAR" : "DISETUJUI",
      approvedAt: new Date(),
      approvedById: autoApproved ? null : actor.id,
      ...(e.mode === "UANG_MUKA" && { advanceAppliedAmount: applied }),
      ...(langsungLunas && { paidAt: new Date(), paidById: autoApproved ? null : actor.id }),
    },
  });

  await postExpenseApproved(tx, { expenseId: e.id, userId: autoApproved ? null : actor.id });
  if (e.mode === "UANG_MUKA") await sinkronStatusUangMuka(tx, e.advanceId);

  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_EXPENSE, entityId: e.id,
    eventType: EVENT_TYPES.DOCUMENT_APPROVED,
    actorId: autoApproved ? null : actor.id,
    actorType: autoApproved ? "SYSTEM" : "USER",
    metadata: {
      expenseNumber: e.expenseNumber, amount: String(e.amount), mode: e.mode,
      ...(e.mode === "UANG_MUKA" && { uangMukaDipakai: String(applied), selisihJadiUtang: String(selisih) }),
      ...(menyetujuiSendiri && { menyetujuiPengajuanSendiri: true }),
      ...(autoApproved && { otomatis: true, kebijakan: catatanOtomatis }),
    },
  });

  return updated;
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
  return { ...e, amount: moneyToNumber(e.amount), transferFeeAmount: moneyToNumber(e.transferFeeAmount ?? 0), ...ringkasBiaya(e) };
}
