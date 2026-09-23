// FINANCE WORKSPACE — transaksi harian: pengeluaran & reimbursement,
// supplier (master, tagihan, pembayaran), kas (transfer, pemasukan lain),
// refund pelanggan, alokasi pembayaran, dan rekonsiliasi bank.
//
// Di-mount di prefix /api/finance yang SAMA dengan routes/finance.js —
// pemisahannya semata soal panjang file, bukan dua domain berbeda.
//
// ── POLA YANG BERLAKU DI SELURUH FILE INI ───────────────────────────────
//
// 1. DOKUMEN DULU, JURNAL BELAKANGAN. Membuat pengeluaran/tagihan TIDAK
//    menyentuh buku besar. Jurnal lahir saat DISETUJUI (beban/utang diakui)
//    dan saat DIBAYAR (uang keluar). Pengajuan yang belum tentu disetujui
//    bukan beban.
//
// 2. SATU TRANSAKSI PRISMA untuk dokumen + jurnal + audit. Kalau jurnalnya
//    gagal, persetujuannya ikut batal — tidak ada dokumen "disetujui" yang
//    diam-diam tidak pernah masuk buku.
//
// 3. PEMBATALAN LEWAT REVERSAL. Dokumen yang sudah diposting tidak pernah
//    dihapus atau diubah nominalnya.

import express from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, requireAnyPermission, PERMISSIONS as P, hasPermission } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import {
  postJournal, reverseJournal, generateDocumentNumber, toBookDate, todayBookDateWIB,
  findEntryByKey, JournalError,
} from "../services/finance/journal.js";
import { toMoney, sumMoney, moneyToNumber, ZERO, MoneyError } from "../services/finance/money.js";
import { saldoDariAplikasi, bentukAplikasiDp, daftarDpEligible, ringkasanDp } from "../services/finance/purchaseAdvanceRead.js";
import { AccountError } from "../services/finance/accounts.js";
import { SETTING_KEYS, getSettingRaw, parseIntOr, getVerificationGate } from "../services/finance/settings.js";
import { postExpenseApproved, postExpensePaid, KEY as EXPENSE_KEY } from "../services/finance/posting/expense.js";
import { postPurchaseApproved, postPurchasePaid, totalDpDiterapkan, KEY as PURCHASE_KEY } from "../services/finance/posting/purchase.js";
import { postAdvanceApplied } from "../services/finance/posting/purchaseAdvance.js";
import {
  postSupplierBill, postSupplierPayment, recomputeBillStatus, KEY as SUPPLIER_KEY,
} from "../services/finance/posting/supplier.js";
import { postCashTransfer, postOtherIncome, KEY as CASH_KEY } from "../services/finance/posting/cash.js";
import { postRefund, sisaBisaDirefund, KEY as ORDER_KEY } from "../services/finance/posting/orderRevenue.js";
import { setAllocations, AllocationError } from "../services/finance/allocation.js";
// Reuse SENGAJA lintas domain — lihat catatan yang sama di allocation.js
// soal kenapa lockRowForUpdate dipakai ulang, bukan disalin.
import { lockRowForUpdate } from "../services/inventoryLedger.js";
import { recomputeOrderPaymentStatus } from "../services/paymentLedger.js";
import { handleFinanceError, rentangDariQuery } from "./finance.js";
import { evaluasiSelesai, penyesuaianBukuPeriode, saldoBukuSampai, saldoBelumTeridentifikasi, LABEL_STATUS_REKON, LABEL_REKON_SEMENTARA, STATUS_DRAF_MENUNGGU } from "../services/finance/rekonBank.js";
import multer from "multer";
import {
  pastikanNotaLengkap, notaWajib, ambangNota, notaWajibDenganAmbang, simpanFotoBukti, cariPemakaiBukti,
  tanggalMulaiKebijakan, RECEIPTS_URL_PREFIX,
} from "../services/finance/receipts.js";
import { buatFinExpense, tarikFinExpense, setujuiFinExpense, expenseInclude, bentukExpense, ExpenseInputError } from "../services/finance/expenses.js";
// Sinkron dua arah FinExpense → ExpenseSubmission (Pengajuan Biaya Lintas
// Divisi) — no-op kalau FinExpense ini tidak berasal dari pengajuan divisi.
// Dipanggil di SETIAP transisi status FinExpense, DI DALAM transaksi yang
// sama dengan perubahan status itu (lihat services/expenseSubmission/service.js).
import { hitungBiayaTransfer, siapkanPerubahanBiaya, ringkasBiaya, pastikanTanpaBiayaSebelumBayar } from "../services/finance/transferFee.js";
import { batalkanPertanggungjawabanPengeluaran } from "../services/finance/operationalAdvance.js";
import { sinkronStatusDariFinExpense } from "../services/expenseSubmission/service.js";

export const financeTxRouter = express.Router();
financeTxRouter.use(requireAuth);
// Idempotency-Key untuk command uang (opsional di web, wajib di token mobile).
financeTxRouter.use(idempotency);

function err(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function parseTanggal(value, fallback = null) {
  if (!value) return fallback || todayBookDateWIB();
  return toBookDate(value);
}

/**
 * Balikkan jurnal AKTIF (status POSTED) untuk SATU KELUARGA idempotencyKey
 * (mis. semua "PENGELUARAN:<id>*", terlepas dari suffix koreksi) — dipakai
 * BERSAMA oleh /cancel (batal total) dan /koreksi (batal lalu posting ulang
 * dengan nilai baru).
 *
 * ⚠️ Dicari lewat PREFIX idempotencyKey, BUKAN source+sourceId polos.
 * Untuk expense, jurnal PENGAKUAN BEBAN dan jurnal PEMBAYARAN dua-duanya
 * memakai `source: "PENGELUARAN"` DAN `sourceId` yang SAMA (lihat
 * posting/expense.js) — cuma idempotencyKey-nya yang beda
 * ("PENGELUARAN:<id>" vs "PENGELUARAN_DIBAYAR:<id>"). Mencari lewat
 * source+sourceId polos akan mengembalikan SALAH SATU secara acak kalau
 * dua-duanya POSTED sekaligus (kasus nyata: expense DIBAYAR mode
 * REIMBURSEMENT/UTANG), meninggalkan satu jurnal aktif tidak terbalik —
 * itu sebabnya keyPrefix WAJIB dipisah per "keluarga" jurnal, dipanggil
 * SEKALI per keluarga oleh pemanggilnya.
 */
async function balikkanJurnalAktif(tx, { keyPrefix, alasan, userId }) {
  const entry = await tx.finJournalEntry.findFirst({
    where: { status: "POSTED", idempotencyKey: { startsWith: keyPrefix } },
  });
  if (entry) await reverseJournal(tx, { entryId: entry.id, reason: alasan, userId });
  return entry;
}

// Field yang MEMPENGARUHI isi jurnal. Perubahan yang HANYA menyentuh field di
// luar daftar ini (foto bukti, catatan) tidak perlu membalik & memposting ulang
// jurnal — cukup dicatat, supaya salah foto tidak menambah 3 jurnal di buku besar.
const FIELD_JURNAL = new Set([
  "date", "amount", "description", "categoryId", "division", "cashAccountId",
  "supplierId", "reimburseToId", "payeeName", "orderId", "unitId", "transferFeeAmount",
]);

/** Buang field yang nilainya SAMA dengan aslinya — form edit mengirim semua kolom. */
function bedaDenganAsli(asli, perubahan) {
  const beda = {};
  for (const [k, v] of Object.entries(perubahan)) {
    const lama = asli[k];
    let sama;
    if (k === "amount" || k === "transferFeeAmount") sama = toMoney(lama ?? 0).equals(v);
    else if (k === "date") sama = new Date(lama).toISOString().slice(0, 10) === new Date(v).toISOString().slice(0, 10);
    else sama = (lama ?? null) === (v ?? null);
    if (!sama) beda[k] = v;
  }
  return beda;
}

/** Verifikasi bukti gugur kalau yang diverifikasi (foto/nominal/tanggal) berubah. */
function resetVerifikasiBukti(perubahan) {
  return ["amount", "date", "receiptUrl"].some((k) => k in perubahan)
    ? { receiptVerifiedAt: null, receiptVerifiedById: null }
    : {};
}

/**
 * Klausa pencarian teks bebas untuk daftar pengeluaran/pembelian. Tiap KATA di
 * `q` harus cocok di salah satu kolom (AND antar kata, OR antar kolom), jadi
 * "kain oscar sep" menyempit dengan wajar. Kata berupa angka (mis. "150000"
 * atau "150.000") juga dicocokkan ke NOMINAL persis.
 */
function klausaCari(q, kolomTeks) {
  const kata = String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return kata.map((k) => {
    const atau = kolomTeks.map((path) => {
      const bagian = path.split(".");
      return bagian.reduceRight((isi, kunci, i) => (i === bagian.length - 1 ? { [kunci]: { contains: k, mode: "insensitive" } } : { [kunci]: isi }), null);
    });
    const angka = k.replace(/\./g, "");
    if (/^\d{3,}$/.test(angka)) atau.push({ amount: Number(angka) });
    return { OR: atau };
  });
}

/** Filter status bukti: ada | tanpa | terverifikasi | belum. */
function klausaBukti(bukti) {
  if (bukti === "ada") return { receiptUrl: { not: null } };
  if (bukti === "tanpa") return { receiptUrl: null };
  if (bukti === "terverifikasi") return { receiptVerifiedAt: { not: null } };
  if (bukti === "belum") return { receiptUrl: { not: null }, receiptVerifiedAt: null };
  return {};
}

/** Suffix idempotencyKey BARU untuk jurnal pengganti sebuah koreksi. */
function suffixKoreksi() {
  return `:KOREKSI:${randomUUID()}`;
}

// ═════════════════════════════════════════════════════════════════════════
// PENGELUARAN & REIMBURSEMENT
// ═════════════════════════════════════════════════════════════════════════

financeTxRouter.get("/expenses",
  requireAnyPermission(P.FINANCE_READ, P.FINANCE_EXPENSE_SUBMIT),
  async (req, res) => {
    try {
      const { from, to } = rentangDariQuery(req.query);
      const { status, division, categoryId, mode, q, bukti, cashAccountId } = req.query;

      // Pemegang finance:expense:submit TANPA finance:read hanya boleh
      // melihat pengajuannya SENDIRI. Pembatasan barisnya di query, persis
      // pola JOB_OWN_READ milik driver (lihat constants/permissions.js).
      const hanyaMilikSendiri = !hasPermission(req.user, P.FINANCE_READ);

      const expenses = await prisma.finExpense.findMany({
        where: {
          date: { gte: from, lte: to },
          ...(status && { status }),
          ...(division && { division }),
          ...(categoryId && { categoryId }),
          ...(mode && { mode }),
          ...(cashAccountId && { cashAccountId }),
          ...klausaBukti(bukti),
          AND: [
            ...(hanyaMilikSendiri ? [{ OR: [{ createdById: req.user.id }, { reimburseToId: req.user.id }] }] : []),
            ...klausaCari(q, ["expenseNumber", "description", "payeeName", "notes", "category.name", "supplier.name", "reimburseTo.name"]),
          ],
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 300,
        include: expenseInclude,
      });

      const total = expenses.length === 0 ? ZERO : sumMoney(expenses.map((e) => e.amount));
      // `notaWajib`: aturan yang sama dengan yang dipakai saat Setujui — supaya UI bisa memberi tahu SEBELUM tombol ditekan
      // (tanpa ini tombol tampak aktif tetapi server menolak 422 "wajib punya foto nota").
      const ambang = await ambangNota(prisma);
      res.json({
        expenses: expenses.map((e) => ({ ...bentukExpense(e), notaWajib: notaWajibDenganAmbang({ jenis: "expense", mode: e.mode, amount: e.amount, categoryCode: e.category?.code }, ambang) })),
        total: moneyToNumber(total),
        hanyaMilikSendiri,
        terpotong: expenses.length === 300,
      });
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

financeTxRouter.post("/expenses",
  requireAnyPermission(P.FINANCE_POST, P.FINANCE_EXPENSE_SUBMIT),
  async (req, res) => {
    try {
      // advanceId TIDAK diterima dari body publik: memakai uang muka hanya lewat jalur berizin
      // (POST /uang-muka/:id/pertanggungjawaban oleh Finance, atau Pengajuan Biaya yang memvalidasi pemilik).
      const { advanceId: _tidakDiterima, ...body } = req.body || {};
      const created = await prisma.$transaction((tx) => buatFinExpense(tx, { ...body, user: req.user }));
      res.status(201).json(bentukExpense(created));
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

// Pratinjau biaya admin transfer — memakai aturan & preset SERVER yang sama dengan
// saat menyimpan, supaya layar tidak menghitung sendiri. Tidak menulis apa pun.
financeTxRouter.post("/transfer-fee/preview",
  requireAnyPermission(P.FINANCE_READ, P.FINANCE_POST, P.FINANCE_EXPENSE_SUBMIT),
  async (req, res) => {
    try {
      const nominal = toMoney(req.body?.amount ?? 0, { field: "Nominal" });
      const biaya = await hitungBiayaTransfer(prisma, req.body || {});
      res.json({
        paymentMethod: biaya.paymentMethod, transferFeeType: biaya.transferFeeType,
        ...ringkasBiaya({ amount: nominal, transferFeeAmount: biaya.transferFeeAmount }),
      });
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

financeTxRouter.post("/expenses/:id/submit",
  requireAnyPermission(P.FINANCE_POST, P.FINANCE_EXPENSE_SUBMIT),
  async (req, res) => {
    try {
      const e = await prisma.finExpense.findUnique({ where: { id: req.params.id }, select: { status: true, createdById: true } });
      if (!e) throw err("Pengeluaran tidak ditemukan", 404);
      if (e.status !== "DRAFT") throw err("Hanya draft yang bisa diajukan", 409);
      const updated = await prisma.finExpense.update({
        where: { id: req.params.id },
        data: { status: "MENUNGGU_APPROVAL", submittedAt: new Date() },
        include: expenseInclude,
      });
      res.json(bentukExpense(updated));
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

// Tarik kembali pengajuan (MENUNGGU_APPROVAL → DRAFT) — kebalikan dari /submit. Dipakai
// baik oleh Finance langsung maupun oleh Pengajuan Biaya Lintas Divisi (services/expenseSubmission)
// sebelum keputusan disetujui/ditolak jatuh, lewat service bersama tarikFinExpense().
financeTxRouter.post("/expenses/:id/tarik",
  requireAnyPermission(P.FINANCE_POST, P.FINANCE_EXPENSE_SUBMIT),
  async (req, res) => {
    try {
      const updated = await tarikFinExpense(prisma, { id: req.params.id, user: req.user });
      res.json(bentukExpense(updated));
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

financeTxRouter.post("/expenses/:id/approve", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    // setujuiFinExpense (services/finance/expenses.js) — SATU-SATUNYA logika
    // persetujuan, dipakai ulang oleh jalur OTOMATIS Pengajuan Biaya Lintas
    // Divisi (biaya rutin bernilai kecil) supaya dua jalur itu tidak pernah
    // diam-diam berbeda (lock baris, larangan approve sendiri, nota wajib,
    // jurnal — semuanya SATU tempat).
    const hasil = await prisma.$transaction(async (tx) => {
      const updated = await setujuiFinExpense(tx, { id: req.params.id, actor: req.user });
      await sinkronStatusDariFinExpense(tx, updated.id);
      return updated;
    });
    const lengkap = await prisma.finExpense.findUnique({ where: { id: hasil.id }, include: expenseInclude });
    res.json(bentukExpense(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/expenses/:id/reject", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan penolakan wajib diisi");
    const hasil = await prisma.$transaction(async (tx) => {
      // Kunci baris dokumen: dua keputusan serempak (double-tap / dua penyetuju) diserialkan — yang kedua melihat status baru dan ditolak 409.
      await lockRowForUpdate(tx, '"fin_expenses"', req.params.id);
      const e = await tx.finExpense.findUnique({ where: { id: req.params.id } });
      if (!e) throw err("Pengeluaran tidak ditemukan", 404);
      if (!["DRAFT", "MENUNGGU_APPROVAL"].includes(e.status)) {
        throw err("Pengeluaran yang sudah disetujui tidak bisa ditolak — batalkan lewat jurnal balik", 409);
      }
      const updated = await tx.finExpense.update({
        where: { id: e.id },
        data: { status: "DITOLAK", rejectReason: reason, approvedById: req.user.id, approvedAt: new Date() },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_EXPENSE, entityId: e.id,
        eventType: EVENT_TYPES.DOCUMENT_REJECTED, actorId: req.user.id,
        metadata: { expenseNumber: e.expenseNumber, reason },
      });
      await sinkronStatusDariFinExpense(tx, e.id);
      return updated;
    });
    const lengkap = await prisma.finExpense.findUnique({ where: { id: hasil.id }, include: expenseInclude });
    res.json(bentukExpense(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Bayar pengeluaran mode REIMBURSEMENT/UTANG yang sudah disetujui.
financeTxRouter.post("/expenses/:id/pay", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { cashAccountId, paidAt } = req.body;
    if (!cashAccountId) throw err("Rekening sumber pembayaran wajib dipilih");

    const hasil = await prisma.$transaction(async (tx) => {
      const biaya = await hitungBiayaTransfer(tx, req.body);
      // Kunci baris dokumen: dua perintah serempak (double-tap / dua perangkat) diserialkan — yang kedua melihat status baru dan ditolak 409.
      await lockRowForUpdate(tx, '"fin_expenses"', req.params.id);
      const e = await tx.finExpense.findUnique({ where: { id: req.params.id } });
      if (!e) throw err("Pengeluaran tidak ditemukan", 404);
      if (e.status !== "DISETUJUI") {
        throw err(`Hanya pengeluaran berstatus Disetujui yang bisa dibayar (status sekarang: ${e.status})`, 409);
      }
      await tx.finExpense.update({
        where: { id: e.id },
        data: {
          status: "DIBAYAR",
          cashAccountId,
          paymentMethod: biaya.paymentMethod,
          transferFeeType: biaya.transferFeeType,
          transferFeeAmount: biaya.transferFeeAmount,
          paidAt: paidAt ? parseTanggal(paidAt) : new Date(),
          paidById: req.user.id,
        },
      });
      await postExpensePaid(tx, { expenseId: e.id, userId: req.user.id });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_EXPENSE, entityId: e.id,
        eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: { expenseNumber: e.expenseNumber, aksi: "dibayar", amount: String(e.amount) },
      });
      await sinkronStatusDariFinExpense(tx, e.id);
      return e;
    });

    const lengkap = await prisma.finExpense.findUnique({ where: { id: hasil.id }, include: expenseInclude });
    res.json(bentukExpense(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Batalkan pengeluaran yang SUDAH diposting — lewat reversal, bukan hapus.
financeTxRouter.post("/expenses/:id/cancel", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan pembatalan wajib diisi");

    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"fin_expenses"', req.params.id);
      const e = await tx.finExpense.findUnique({ where: { id: req.params.id } });
      if (!e) throw err("Pengeluaran tidak ditemukan", 404);
      if (e.status === "DIBATALKAN") throw err("Pengeluaran ini sudah dibatalkan", 409);

      // Balikkan jurnal AKTIF-nya — pembayaran dulu (kalau ada), baru
      // pengakuan beban. Lewat prefix (balikkanJurnalAktif), BUKAN key
      // persis: kalau dokumen ini sudah pernah dikoreksi (POST .../koreksi)
      // sebelumnya, key ASLI (tanpa suffix) sudah REVERSED — mencari key
      // persis di sini akan melewatkan jurnal PENGGANTI yang sebenarnya
      // masih aktif sekarang, dan /cancel akan menandai dokumen batal tanpa
      // benar-benar membalik uangnya.
      const alasanBatal = `Pengeluaran ${e.expenseNumber} dibatalkan — ${reason}`;
      await balikkanJurnalAktif(tx, { keyPrefix: EXPENSE_KEY.expensePaid(e.id), alasan: alasanBatal, userId: req.user.id });
      await balikkanJurnalAktif(tx, { keyPrefix: EXPENSE_KEY.expense(e.id), alasan: alasanBatal, userId: req.user.id });

      // Uang Muka Operasional: pertanggungjawabannya dibatalkan, saldo uang muka pulih (jurnal sudah dibalik di atas).
      if (e.mode === "UANG_MUKA") await batalkanPertanggungjawabanPengeluaran(tx, { expense: e, reason, userId: req.user.id });
      const updated = await tx.finExpense.update({
        where: { id: e.id },
        data: { status: "DIBATALKAN", rejectReason: reason },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_EXPENSE, entityId: e.id,
        eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: req.user.id,
        metadata: { expenseNumber: e.expenseNumber, reason },
      });
      await sinkronStatusDariFinExpense(tx, e.id);
      return updated;
    });
    res.json(bentukExpense(hasil));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

/**
 * Validasi & normalisasi payload edit/koreksi pengeluaran — dipakai DUA
 * jalur di bawah (PATCH pra-approval & POST .../koreksi pasca-posting),
 * field yang diterima SAMA dengan POST /expenses (create) MINUS `mode`
 * (lihat catatan di POST .../koreksi kenapa mode sengaja dikecualikan).
 */
async function siapkanPerubahanExpense(tx, body, modeSaatIni, asli) {
  const perubahan = {};
  if (body.date !== undefined) perubahan.date = parseTanggal(body.date);
  if (body.amount !== undefined) {
    const nominal = toMoney(body.amount, { field: "Nominal pengeluaran" });
    if (nominal.lessThanOrEqualTo(0)) throw err("Nominal pengeluaran harus lebih dari 0");
    perubahan.amount = nominal;
  }
  if (body.description !== undefined) {
    if (!body.description?.trim()) throw err("Keterangan pengeluaran wajib diisi");
    perubahan.description = body.description.trim();
  }
  if (body.categoryId !== undefined) {
    const kategori = await tx.finExpenseCategory.findUnique({ where: { id: body.categoryId }, select: { id: true, active: true } });
    if (!kategori || !kategori.active) throw err("Kategori biaya tidak ditemukan atau sudah nonaktif", 404);
    perubahan.categoryId = body.categoryId;
  }
  if (body.division !== undefined) perubahan.division = body.division;
  if (body.cashAccountId !== undefined) perubahan.cashAccountId = body.cashAccountId || null;
  if (body.supplierId !== undefined) perubahan.supplierId = body.supplierId || null;
  if (body.reimburseToId !== undefined) perubahan.reimburseToId = body.reimburseToId || null;
  if (body.payeeName !== undefined) perubahan.payeeName = body.payeeName?.trim() || null;
  if (body.orderId !== undefined) perubahan.orderId = body.orderId || null;
  if (body.unitId !== undefined) perubahan.unitId = body.unitId || null;
  if (body.receiptUrl !== undefined) perubahan.receiptUrl = body.receiptUrl || null;
  if (body.notes !== undefined) perubahan.notes = body.notes?.trim() || null;

  if (modeSaatIni === "LANGSUNG" && perubahan.cashAccountId === null) {
    throw err("Pengeluaran mode Langsung wajib punya rekening kas/bank sumber dananya");
  }
  if (asli) {
    Object.assign(perubahan, await siapkanPerubahanBiaya(tx, body, asli, perubahan.cashAccountId));
  }
  return perubahan;
}

// Edit LANGSUNG (tanpa reversal) — HANYA sah selama pengeluaran belum
// menyentuh buku besar sama sekali (DRAFT/MENUNGGU_APPROVAL). Admin-only
// atas permintaan eksplisit (17 Sept 2026: sistem baru mulai dipakai,
// wajar ada salah input, tapi perubahan tetap harus lewat satu pintu yang
// bisa diaudit, bukan siapa saja boleh menimpa punya orang lain).
financeTxRouter.patch("/expenses/:id", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const hasil = await prisma.$transaction(async (tx) => {
      const reason = req.body?.reason?.trim();
      if (!reason) throw err("Alasan perubahan wajib diisi");
      const e = await tx.finExpense.findUnique({ where: { id: req.params.id } });
      if (!e) throw err("Pengeluaran tidak ditemukan", 404);
      if (!["DRAFT", "MENUNGGU_APPROVAL"].includes(e.status)) {
        throw err(
          `Pengeluaran berstatus ${e.status} sudah menyentuh buku besar — pakai Koreksi, bukan edit langsung`,
          409
        );
      }
      const perubahan = bedaDenganAsli(e, await siapkanPerubahanExpense(tx, req.body, e.mode, e));
      if (Object.keys(perubahan).length === 0) throw err("Tidak ada perubahan yang dikirim");
      const updated = await tx.finExpense.update({
        where: { id: e.id }, data: { ...perubahan, ...resetVerifikasiBukti(perubahan) }, include: expenseInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_EXPENSE, entityId: e.id,
        eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: {
          expenseNumber: e.expenseNumber, status: e.status, reason,
          changes: Object.fromEntries(Object.keys(perubahan).map((k) => [k, { from: e[k], to: perubahan[k] }])),
        },
      });
      return updated;
    });
    res.json(bentukExpense(hasil));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Koreksi pengeluaran yang SUDAH diposting (DISETUJUI/DIBAYAR) — reversal
// jurnal lama + posting jurnal baru dengan nilai yang dikoreksi, SATU
// transaksi atomik. Beda dari /cancel: dokumennya TIDAK menjadi DIBATALKAN,
// statusnya tetap sama, cuma jurnal & field-nya yang diganti. `mode`
// SENGAJA tidak boleh diubah lewat sini (lihat EXPENSE_EDITABLE_FIELDS) —
// mengubah mode berarti mengubah seluruh struktur jurnal & alur pembayaran,
// itu kasus "batalkan lalu buat baru", bukan "koreksi angka yang salah"
// (lihat siapkanPerubahanExpense di atas untuk daftar field yang diterima).
financeTxRouter.post("/expenses/:id/koreksi", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan koreksi wajib diisi");

    const hasil = await prisma.$transaction(async (tx) => {
      const e = await tx.finExpense.findUnique({ where: { id: req.params.id } });
      if (!e) throw err("Pengeluaran tidak ditemukan", 404);
      if (!["DISETUJUI", "DIBAYAR"].includes(e.status)) {
        throw err(
          `Koreksi hanya untuk pengeluaran yang sudah diposting (status sekarang: ${e.status}) — pakai edit langsung kalau belum`,
          409
        );
      }

      const perubahan = bedaDenganAsli(e, await siapkanPerubahanExpense(tx, req.body, e.mode, e));
      if (Object.keys(perubahan).length === 0) throw err("Tidak ada perubahan yang dikirim");
      const menyentuhJurnal = Object.keys(perubahan).some((k) => FIELD_JURNAL.has(k));

      // Pengeluaran dari Uang Muka: angka/rekening/pemegang terkunci ke saldo uang muka & pertanggungjawabannya.
      // Yang boleh dikoreksi hanya metadata (bukti, catatan) dan biaya admin transfer selisih. Selebihnya:
      // batalkan (jurnal dibalik, saldo pulih) lalu catat ulang.
      if (e.mode === "UANG_MUKA") {
        const terlarang = Object.keys(perubahan).filter((k) => FIELD_JURNAL.has(k) && k !== "transferFeeAmount");
        if (terlarang.length > 0) {
          throw err("Pengeluaran dari uang muka tidak bisa dikoreksi angkanya — batalkan (saldo uang muka pulih dan jurnal dibalik) lalu catat ulang.", 409);
        }
      }

      // Balikkan jurnal PEMBAYARAN dulu (kalau ada), baru jurnal pengakuan
      // beban — urutan yang sama dengan /cancel. Dua keluarga key TERPISAH
      // (lihat komentar balikkanJurnalAktif) — tanpa ini, expense DIBAYAR
      // hanya salah satu jurnalnya yang terbalik. Dilewati kalau yang
      // dikoreksi cuma foto/catatan (tidak mengubah isi jurnal).
      const alasanKoreksi = `Koreksi ${e.expenseNumber} — ${reason}`;
      if (menyentuhJurnal) {
        await balikkanJurnalAktif(tx, { keyPrefix: EXPENSE_KEY.expensePaid(e.id), alasan: alasanKoreksi, userId: req.user.id });
        await balikkanJurnalAktif(tx, { keyPrefix: EXPENSE_KEY.expense(e.id), alasan: alasanKoreksi, userId: req.user.id });
      }

      const before = Object.fromEntries(Object.keys(perubahan).map((k) => [k, e[k]]));
      const updated = await tx.finExpense.update({ where: { id: e.id }, data: { ...perubahan, ...resetVerifikasiBukti(perubahan) } });

      if (menyentuhJurnal) {
        const suffix = suffixKoreksi();
        await postExpenseApproved(tx, { expenseId: e.id, userId: req.user.id, keySuffix: suffix });
        if (e.status === "DIBAYAR" && e.mode !== "LANGSUNG") {
          await postExpensePaid(tx, { expenseId: e.id, userId: req.user.id, keySuffix: suffix });
        }
      }

      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_EXPENSE, entityId: e.id,
        eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: req.user.id,
        metadata: {
          expenseNumber: e.expenseNumber, reason,
          before, after: perubahan,
        },
      });
      await sinkronStatusDariFinExpense(tx, e.id);
      return updated;
    });
    const lengkap = await prisma.finExpense.findUnique({ where: { id: hasil.id }, include: expenseInclude });
    res.json(bentukExpense(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// PEMBELIAN — bahan baku manual / aset tetap / aset tak berwujud / uang
// muka pembelian, TANPA tagihan resmi supplier. Pola SENGAJA identik 1:1
// dengan blok PENGELUARAN di atas (lihat services/finance/posting/purchase.js
// untuk penjelasan lengkap) — kalau memperbaiki bug di sini, cek juga blok
// Pengeluaran, dan sebaliknya, supaya dua alur kembar ini tidak drift diam-
// diam. Pembelian BERTAGIHAN resmi TETAP lewat blok SUPPLIER di bawah
// (FinSupplierBill) — tidak digantikan oleh blok ini.
// ═════════════════════════════════════════════════════════════════════════

const purchaseInclude = {
  category: { select: { id: true, code: true, name: true, account: { select: { code: true, name: true } } } },
  cashAccount: { select: { id: true, name: true, kind: true } },
  supplier: { select: { id: true, name: true } },
  reimburseTo: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  paidBy: { select: { id: true, name: true } },
};

function bentukPurchase(p) {
  return { ...p, amount: moneyToNumber(p.amount), transferFeeAmount: moneyToNumber(p.transferFeeAmount ?? 0), ...ringkasBiaya(p) };
}

financeTxRouter.get("/purchases",
  requireAnyPermission(P.FINANCE_READ, P.FINANCE_EXPENSE_SUBMIT),
  async (req, res) => {
    try {
      const { from, to } = rentangDariQuery(req.query);
      const { status, division, categoryId, mode, q, bukti, cashAccountId } = req.query;

      const hanyaMilikSendiri = !hasPermission(req.user, P.FINANCE_READ);

      const purchases = await prisma.finPurchase.findMany({
        where: {
          date: { gte: from, lte: to },
          ...(status && { status }),
          ...(division && { division }),
          ...(categoryId && { categoryId }),
          ...(mode && { mode }),
          ...(cashAccountId && { cashAccountId }),
          ...klausaBukti(bukti),
          AND: [
            ...(hanyaMilikSendiri ? [{ OR: [{ createdById: req.user.id }, { reimburseToId: req.user.id }] }] : []),
            ...klausaCari(q, ["purchaseNumber", "description", "payeeName", "notes", "category.name", "supplier.name", "reimburseTo.name"]),
          ],
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 300,
        include: purchaseInclude,
      });

      const total = purchases.length === 0 ? ZERO : sumMoney(purchases.map((p) => p.amount));

      // Indikator "DP Rp…"/"Sisa Rp…" untuk daftar — dua agregat sekali
      // jalan (bukan N+1 per baris). Sisi TUJUAN: pembelian mode UTANG
      // menerima DP → dpDiterapkan/sisaUtang. Sisi SUMBER: pembelian
      // kategori Uang Muka Pembelian yang sudah dipakai → dpDigunakan/
      // dpTersedia. Baris yang tidak masuk salah satu golongan ini tidak
      // dapat field tambahan sama sekali (tabel tidak makin sesak).
      const idTujuan = purchases.filter((p) => p.mode === "UTANG" && p.category?.code !== "UANG_MUKA_PEMBELIAN").map((p) => p.id);
      const idSumber = purchases.filter((p) => p.category?.code === "UANG_MUKA_PEMBELIAN").map((p) => p.id);
      const [grupTujuan, grupSumber] = await Promise.all([
        idTujuan.length === 0 ? [] : prisma.finPurchaseAdvanceApplication.groupBy({
          by: ["targetPurchaseId"], where: { targetPurchaseId: { in: idTujuan }, status: "ACTIVE" }, _sum: { amount: true },
        }),
        idSumber.length === 0 ? [] : prisma.finPurchaseAdvanceApplication.groupBy({
          by: ["advancePurchaseId"], where: { advancePurchaseId: { in: idSumber }, status: "ACTIVE" }, _sum: { amount: true },
        }),
      ]);
      const dpTujuanMap = new Map(grupTujuan.map((g) => [g.targetPurchaseId, g._sum.amount]));
      const dpSumberMap = new Map(grupSumber.map((g) => [g.advancePurchaseId, g._sum.amount]));

      res.json({
        purchases: purchases.map((p) => {
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
        }),
        total: moneyToNumber(total),
        hanyaMilikSendiri,
        terpotong: purchases.length === 300,
      });
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

financeTxRouter.post("/purchases",
  requireAnyPermission(P.FINANCE_POST, P.FINANCE_EXPENSE_SUBMIT),
  async (req, res) => {
    try {
      const {
        date, amount, description, categoryId, division, mode,
        cashAccountId, supplierId, reimburseToId, payeeName, receiptUrl, notes,
        langsungAjukan,
      } = req.body;

      if (!description?.trim()) throw err("Keterangan pembelian wajib diisi");
      if (!categoryId) throw err("Jenis pembelian wajib dipilih");
      const nominal = toMoney(amount, { field: "Nominal pembelian" });
      if (nominal.lessThanOrEqualTo(0)) throw err("Nominal pembelian harus lebih dari 0");

      const kategori = await prisma.finPurchaseCategory.findUnique({
        where: { id: categoryId }, select: { id: true, active: true },
      });
      if (!kategori || !kategori.active) throw err("Jenis pembelian tidak ditemukan atau sudah nonaktif", 404);

      const modeFinal = ["LANGSUNG", "REIMBURSEMENT", "UTANG"].includes(mode) ? mode : "LANGSUNG";

      // Sama seperti Pengeluaran: orang divisi (cuma finance:expense:submit)
      // selalu mengajukan REIMBURSEMENT, tidak pernah langsung bayar dari
      // kas perusahaan.
      const bolehPosting = hasPermission(req.user, P.FINANCE_POST);
      const modeEfektif = bolehPosting ? modeFinal : "REIMBURSEMENT";

      if (modeEfektif === "LANGSUNG" && !cashAccountId) {
        throw err("Pembelian yang dibayar langsung wajib memilih rekening kas/bank sumber dananya");
      }
      // Biaya admin transfer hanya untuk uang yang keluar saat dokumen diposting (LANGSUNG).
      if (modeEfektif !== "LANGSUNG") pastikanTanpaBiayaSebelumBayar(req.body);
      const biaya = modeEfektif === "LANGSUNG"
        ? await hitungBiayaTransfer(prisma, req.body)
        : { paymentMethod: null, transferFeeType: null, transferFeeAmount: 0 };

      const created = await prisma.finPurchase.create({
        data: {
          purchaseNumber: await prisma.$transaction((tx) => generateDocumentNumber(tx, "PUR", parseTanggal(date))),
          date: parseTanggal(date),
          amount: nominal,
          description: description.trim(),
          categoryId,
          division: division || "UMUM",
          mode: modeEfektif,
          cashAccountId: modeEfektif === "LANGSUNG" ? cashAccountId : (cashAccountId || null),
          supplierId: supplierId || null,
          reimburseToId: modeEfektif === "REIMBURSEMENT" ? ((bolehPosting && reimburseToId) || req.user.id) : null,
          payeeName: payeeName?.trim() || null,
          receiptUrl: receiptUrl || null,
          notes: notes?.trim() || null,
          paymentMethod: biaya.paymentMethod,
          transferFeeType: biaya.transferFeeType,
          transferFeeAmount: biaya.transferFeeAmount,
          status: langsungAjukan === false ? "DRAFT" : "MENUNGGU_APPROVAL",
          submittedAt: langsungAjukan === false ? null : new Date(),
          createdById: req.user.id,
        },
        include: purchaseInclude,
      });
      res.status(201).json(bentukPurchase(created));
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

financeTxRouter.post("/purchases/:id/submit",
  requireAnyPermission(P.FINANCE_POST, P.FINANCE_EXPENSE_SUBMIT),
  async (req, res) => {
    try {
      const p = await prisma.finPurchase.findUnique({ where: { id: req.params.id }, select: { status: true, createdById: true } });
      if (!p) throw err("Pembelian tidak ditemukan", 404);
      if (p.status !== "DRAFT") throw err("Hanya draft yang bisa diajukan", 409);
      const updated = await prisma.finPurchase.update({
        where: { id: req.params.id },
        data: { status: "MENUNGGU_APPROVAL", submittedAt: new Date() },
        include: purchaseInclude,
      });
      res.json(bentukPurchase(updated));
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

financeTxRouter.post("/purchases/:id/approve", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    const hasil = await prisma.$transaction(async (tx) => {
      // Kunci baris dokumen: dua keputusan serempak (double-tap / dua penyetuju) diserialkan — yang kedua melihat status baru dan ditolak 409.
      await lockRowForUpdate(tx, '"fin_purchases"', req.params.id);
      const p = await tx.finPurchase.findUnique({ where: { id: req.params.id } });
      if (!p) throw err("Pembelian tidak ditemukan", 404);
      if (!["DRAFT", "MENUNGGU_APPROVAL"].includes(p.status)) {
        throw err(`Pembelian ini sudah berstatus ${p.status} — tidak bisa disetujui lagi`, 409);
      }

      const menyetujuiSendiri = p.createdById === req.user.id;
      if (menyetujuiSendiri && !hasPermission(req.user, P.FINANCE_ADMIN)) {
        throw err(
          "Pengajuan Anda sendiri harus disetujui orang lain. Ini bukan soal kepercayaan — " +
          "persetujuan yang diberikan sendiri tidak punya nilai kontrol apa pun saat diaudit.",
          403
        );
      }

      await pastikanNotaLengkap(tx, { jenis: "purchase", doc: p, err });

      const updated = await tx.finPurchase.update({
        where: { id: p.id },
        data: {
          status: p.mode === "LANGSUNG" ? "DIBAYAR" : "DISETUJUI",
          approvedAt: new Date(),
          approvedById: req.user.id,
          ...(p.mode === "LANGSUNG" && { paidAt: new Date(), paidById: req.user.id }),
        },
      });

      await postPurchaseApproved(tx, { purchaseId: p.id, userId: req.user.id });

      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: p.id,
        eventType: EVENT_TYPES.DOCUMENT_APPROVED, actorId: req.user.id,
        metadata: {
          purchaseNumber: p.purchaseNumber, amount: String(p.amount), mode: p.mode,
          ...(menyetujuiSendiri && { menyetujuiPengajuanSendiri: true }),
        },
      });
      return updated;
    });

    const lengkap = await prisma.finPurchase.findUnique({ where: { id: hasil.id }, include: purchaseInclude });
    res.json(bentukPurchase(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/purchases/:id/reject", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan penolakan wajib diisi");
    const hasil = await prisma.$transaction(async (tx) => {
      // Kunci baris dokumen: dua keputusan serempak (double-tap / dua penyetuju) diserialkan — yang kedua melihat status baru dan ditolak 409.
      await lockRowForUpdate(tx, '"fin_purchases"', req.params.id);
      const p = await tx.finPurchase.findUnique({ where: { id: req.params.id } });
      if (!p) throw err("Pembelian tidak ditemukan", 404);
      if (!["DRAFT", "MENUNGGU_APPROVAL"].includes(p.status)) {
        throw err("Pembelian yang sudah disetujui tidak bisa ditolak — batalkan lewat jurnal balik", 409);
      }
      const updated = await tx.finPurchase.update({
        where: { id: p.id },
        data: { status: "DITOLAK", rejectReason: reason, approvedById: req.user.id, approvedAt: new Date() },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: p.id,
        eventType: EVENT_TYPES.DOCUMENT_REJECTED, actorId: req.user.id,
        metadata: { purchaseNumber: p.purchaseNumber, reason },
      });
      return updated;
    });
    const lengkap = await prisma.finPurchase.findUnique({ where: { id: hasil.id }, include: purchaseInclude });
    res.json(bentukPurchase(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Bayar pembelian mode REIMBURSEMENT/UTANG yang sudah disetujui.
financeTxRouter.post("/purchases/:id/pay", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { cashAccountId, paidAt } = req.body;

    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"fin_purchases"', req.params.id);
      const p = await tx.finPurchase.findUnique({ where: { id: req.params.id } });
      if (!p) throw err("Pembelian tidak ditemukan", 404);
      if (p.status !== "DISETUJUI") {
        throw err(`Hanya pembelian berstatus Disetujui yang bisa dibayar (status sekarang: ${p.status})`, 409);
      }

      // Rekening kas HANYA wajib kalau masih ada sisa yang benar-benar
      // dibayar tunai setelah DP aktif yang sudah diterapkan (lihat
      // postPurchasePaid) — kalau DP sudah menutupi seluruh utangnya, tidak
      // ada uang yang keluar sama sekali, jadi tidak ada rekening untuk
      // dipilih.
      const totalDp = await totalDpDiterapkan(tx, p.id);
      const sisaTunai = toMoney(p.amount).minus(totalDp);
      if (sisaTunai.greaterThan(0) && !cashAccountId) {
        throw err("Rekening sumber pembayaran wajib dipilih");
      }
      // Biaya admin hanya bila memang ada uang yang keluar (sisa tunai > 0).
      const biaya = sisaTunai.greaterThan(0)
        ? await hitungBiayaTransfer(tx, req.body)
        : { paymentMethod: null, transferFeeType: null, transferFeeAmount: 0 };

      await tx.finPurchase.update({
        where: { id: p.id },
        data: {
          status: "DIBAYAR",
          ...(sisaTunai.greaterThan(0) && { cashAccountId }),
          paymentMethod: biaya.paymentMethod,
          transferFeeType: biaya.transferFeeType,
          transferFeeAmount: biaya.transferFeeAmount,
          paidAt: paidAt ? parseTanggal(paidAt) : new Date(),
          paidById: req.user.id,
        },
      });
      await postPurchasePaid(tx, { purchaseId: p.id, userId: req.user.id });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: p.id,
        eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: {
          purchaseNumber: p.purchaseNumber, aksi: "dibayar", amount: String(p.amount),
          ...(totalDp.greaterThan(0) && { dpDiterapkan: totalDp.toFixed(2), sisaTunai: sisaTunai.toFixed(2) }),
        },
      });
      return p;
    });

    const lengkap = await prisma.finPurchase.findUnique({ where: { id: hasil.id }, include: purchaseInclude });
    res.json(bentukPurchase(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Batalkan pembelian yang SUDAH diposting — lewat reversal, bukan hapus.
financeTxRouter.post("/purchases/:id/cancel", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan pembatalan wajib diisi");

    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"fin_purchases"', req.params.id);
      const p = await tx.finPurchase.findUnique({ where: { id: req.params.id } });
      if (!p) throw err("Pembelian tidak ditemukan", 404);
      if (p.status === "DIBATALKAN") throw err("Pembelian ini sudah dibatalkan", 409);

      // Pembelian ini tidak boleh masih terkait penerapan DP AKTIF (sebagai
      // sumber DP ATAU sebagai penerima DP) — membatalkan salah satunya akan
      // meninggalkan baris FinPurchaseAdvanceApplication yang menunjuk ke
      // jurnal pengakuan/pelunasan yang sudah dibalik, tidak lagi masuk akal
      // secara akuntansi. Batalkan/reversal penerapan DP-nya dulu.
      const aplikasiAktif = await tx.finPurchaseAdvanceApplication.count({
        where: { status: "ACTIVE", OR: [{ advancePurchaseId: p.id }, { targetPurchaseId: p.id }] },
      });
      if (aplikasiAktif > 0) {
        throw err(
          `Pembelian ini masih terkait ${aplikasiAktif} penerapan uang muka yang aktif — batalkan penerapannya dulu (lihat Riwayat Penerapan DP) sebelum membatalkan pembelian ini`,
          409
        );
      }

      const alasanBatal = `Pembelian ${p.purchaseNumber} dibatalkan — ${reason}`;
      await balikkanJurnalAktif(tx, { keyPrefix: PURCHASE_KEY.purchasePaid(p.id), alasan: alasanBatal, userId: req.user.id });
      await balikkanJurnalAktif(tx, { keyPrefix: PURCHASE_KEY.purchase(p.id), alasan: alasanBatal, userId: req.user.id });

      const updated = await tx.finPurchase.update({
        where: { id: p.id },
        data: { status: "DIBATALKAN", rejectReason: reason },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: p.id,
        eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: req.user.id,
        metadata: { purchaseNumber: p.purchaseNumber, reason },
      });
      return updated;
    });
    res.json(bentukPurchase(hasil));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

/** Validasi & normalisasi payload edit/koreksi pembelian — pola persis siapkanPerubahanExpense. */
async function siapkanPerubahanPurchase(tx, body, modeSaatIni, asli) {
  const perubahan = {};
  if (body.date !== undefined) perubahan.date = parseTanggal(body.date);
  if (body.amount !== undefined) {
    const nominal = toMoney(body.amount, { field: "Nominal pembelian" });
    if (nominal.lessThanOrEqualTo(0)) throw err("Nominal pembelian harus lebih dari 0");
    perubahan.amount = nominal;
  }
  if (body.description !== undefined) {
    if (!body.description?.trim()) throw err("Keterangan pembelian wajib diisi");
    perubahan.description = body.description.trim();
  }
  if (body.categoryId !== undefined) {
    const kategori = await tx.finPurchaseCategory.findUnique({ where: { id: body.categoryId }, select: { id: true, active: true } });
    if (!kategori || !kategori.active) throw err("Jenis pembelian tidak ditemukan atau sudah nonaktif", 404);
    perubahan.categoryId = body.categoryId;
  }
  if (body.division !== undefined) perubahan.division = body.division;
  if (body.cashAccountId !== undefined) perubahan.cashAccountId = body.cashAccountId || null;
  if (body.supplierId !== undefined) perubahan.supplierId = body.supplierId || null;
  if (body.reimburseToId !== undefined) perubahan.reimburseToId = body.reimburseToId || null;
  if (body.payeeName !== undefined) perubahan.payeeName = body.payeeName?.trim() || null;
  if (body.receiptUrl !== undefined) perubahan.receiptUrl = body.receiptUrl || null;
  if (body.notes !== undefined) perubahan.notes = body.notes?.trim() || null;

  if (modeSaatIni === "LANGSUNG" && perubahan.cashAccountId === null) {
    throw err("Pembelian mode Langsung wajib punya rekening kas/bank sumber dananya");
  }
  if (asli) Object.assign(perubahan, await siapkanPerubahanBiaya(tx, body, asli, perubahan.cashAccountId));
  return perubahan;
}

// Edit LANGSUNG (tanpa reversal) — HANYA sah selama pembelian belum
// menyentuh buku besar sama sekali (DRAFT/MENUNGGU_APPROVAL).
financeTxRouter.patch("/purchases/:id", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const hasil = await prisma.$transaction(async (tx) => {
      const reason = req.body?.reason?.trim();
      if (!reason) throw err("Alasan perubahan wajib diisi");
      const p = await tx.finPurchase.findUnique({ where: { id: req.params.id } });
      if (!p) throw err("Pembelian tidak ditemukan", 404);
      if (!["DRAFT", "MENUNGGU_APPROVAL"].includes(p.status)) {
        throw err(
          `Pembelian berstatus ${p.status} sudah menyentuh buku besar — pakai Koreksi, bukan edit langsung`,
          409
        );
      }
      const perubahan = bedaDenganAsli(p, await siapkanPerubahanPurchase(tx, req.body, p.mode, p));
      if (Object.keys(perubahan).length === 0) throw err("Tidak ada perubahan yang dikirim");
      const updated = await tx.finPurchase.update({
        where: { id: p.id }, data: { ...perubahan, ...resetVerifikasiBukti(perubahan) }, include: purchaseInclude,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: p.id,
        eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: {
          purchaseNumber: p.purchaseNumber, status: p.status, reason,
          changes: Object.fromEntries(Object.keys(perubahan).map((k) => [k, { from: p[k], to: perubahan[k] }])),
        },
      });
      return updated;
    });
    res.json(bentukPurchase(hasil));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Koreksi pembelian yang SUDAH diposting — pola persis POST /expenses/:id/koreksi.
financeTxRouter.post("/purchases/:id/koreksi", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan koreksi wajib diisi");

    const hasil = await prisma.$transaction(async (tx) => {
      const p = await tx.finPurchase.findUnique({ where: { id: req.params.id } });
      if (!p) throw err("Pembelian tidak ditemukan", 404);
      if (!["DISETUJUI", "DIBAYAR"].includes(p.status)) {
        throw err(
          `Koreksi hanya untuk pembelian yang sudah diposting (status sekarang: ${p.status}) — pakai edit langsung kalau belum`,
          409
        );
      }

      const perubahan = bedaDenganAsli(p, await siapkanPerubahanPurchase(tx, req.body, p.mode, p));
      if (Object.keys(perubahan).length === 0) throw err("Tidak ada perubahan yang dikirim");
      const menyentuhJurnal = Object.keys(perubahan).some((k) => FIELD_JURNAL.has(k));

      if (menyentuhJurnal) {
        // Koreksi yang menyentuh jurnal membalik lalu memposting ULANG
        // jurnal pengakuan/pelunasan pembelian ini — kalau ada penerapan DP
        // AKTIF yang menempel (sebagai sumber ATAU tujuan), saldo DP/sisa
        // utang yang sudah dihitung berdasarkan nominal LAMA akan salah
        // begitu nominal barunya terposting. Batalkan/reversal penerapan
        // DP-nya dulu sebelum koreksi field yang mempengaruhi jurnal.
        const aplikasiAktif = await tx.finPurchaseAdvanceApplication.count({
          where: { status: "ACTIVE", OR: [{ advancePurchaseId: p.id }, { targetPurchaseId: p.id }] },
        });
        if (aplikasiAktif > 0) {
          throw err(
            `Pembelian ini masih terkait ${aplikasiAktif} penerapan uang muka yang aktif — batalkan penerapannya dulu sebelum koreksi yang mengubah nominal/kategori/dll`,
            409
          );
        }
      }

      const alasanKoreksi = `Koreksi ${p.purchaseNumber} — ${reason}`;
      if (menyentuhJurnal) {
        await balikkanJurnalAktif(tx, { keyPrefix: PURCHASE_KEY.purchasePaid(p.id), alasan: alasanKoreksi, userId: req.user.id });
        await balikkanJurnalAktif(tx, { keyPrefix: PURCHASE_KEY.purchase(p.id), alasan: alasanKoreksi, userId: req.user.id });
      }

      const before = Object.fromEntries(Object.keys(perubahan).map((k) => [k, p[k]]));
      const updated = await tx.finPurchase.update({ where: { id: p.id }, data: { ...perubahan, ...resetVerifikasiBukti(perubahan) } });

      if (menyentuhJurnal) {
        const suffix = suffixKoreksi();
        await postPurchaseApproved(tx, { purchaseId: p.id, userId: req.user.id, keySuffix: suffix });
        if (p.status === "DIBAYAR" && p.mode !== "LANGSUNG") {
          await postPurchasePaid(tx, { purchaseId: p.id, userId: req.user.id, keySuffix: suffix });
        }
      }

      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: p.id,
        eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: req.user.id,
        metadata: {
          purchaseNumber: p.purchaseNumber, reason,
          before, after: perubahan,
        },
      });
      return updated;
    });
    const lengkap = await prisma.finPurchase.findUnique({ where: { id: hasil.id }, include: purchaseInclude });
    res.json(bentukPurchase(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// TERAPKAN UANG MUKA — FinPurchaseAdvanceApplication
//
// Otomatisasi dari langkah yang sebelumnya manual lewat Jurnal Umum: DP
// (FinPurchase kategori UANG_MUKA_PEMBELIAN, sudah DIBAYAR) diterapkan
// mengurangi Utang Usaha pembelian TARGET (FinPurchase mode UTANG, status
// DISETUJUI, supplier yang SAMA). Lihat posting/purchaseAdvance.js untuk
// jurnalnya, dan komentar model FinPurchaseAdvanceApplication di schema.
// ═════════════════════════════════════════════════════════════════════════

/** Daftar DP eligible untuk diterapkan ke SATU pembelian tujuan (dipakai picker UI). */
financeTxRouter.get("/purchases/:id/advance-eligible",
  requireAnyPermission(P.FINANCE_READ, P.FINANCE_POST),
  async (req, res) => {
    try {
      const target = await prisma.finPurchase.findUnique({
        where: { id: req.params.id },
        include: { category: { select: { code: true } } },
      });
      if (!target) throw err("Pembelian tidak ditemukan", 404);

      res.json(await daftarDpEligible(prisma, target));
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

/** Ringkasan + histori penerapan DP untuk SATU pembelian (sisi sumber DP maupun sisi penerima). */
financeTxRouter.get("/purchases/:id/advance-summary",
  requireAnyPermission(P.FINANCE_READ, P.FINANCE_EXPENSE_SUBMIT),
  async (req, res) => {
    try {
      const p = await prisma.finPurchase.findUnique({
        where: { id: req.params.id },
        include: { category: { select: { code: true } } },
      });
      if (!p) throw err("Pembelian tidak ditemukan", 404);

      res.json(await ringkasanDp(prisma, p));
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

/** Terapkan sebagian/seluruh saldo DP ke satu pembelian tujuan. */
financeTxRouter.post("/purchases/advance-applications", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const idemKey = req.headers["idempotency-key"];
    if (!idemKey) {
      throw err(
        "Header Idempotency-Key wajib untuk menerapkan uang muka — mencegah penerapan ganda akibat double-click atau permintaan yang diulang",
        400
      );
    }

    const { advancePurchaseId, targetPurchaseId, amount } = req.body;
    if (!advancePurchaseId) throw err("Pembelian sumber (uang muka) wajib dipilih");
    if (!targetPurchaseId) throw err("Pembelian tujuan wajib dipilih");
    if (advancePurchaseId === targetPurchaseId) throw err("Sumber dan tujuan tidak boleh pembelian yang sama");
    const nominal = toMoney(amount, { field: "Nominal penerapan" });
    if (nominal.lessThanOrEqualTo(0)) throw err("Nominal penerapan harus lebih dari 0");

    const hasil = await prisma.$transaction(async (tx) => {
      // Kunci kedua baris pembelian TERURUT (id) — dua penerapan paralel yang
      // menyentuh pembelian yang sama (sebagai sumber ATAU tujuan) diserialkan,
      // pola persis lock tagihan supplier di /supplier-payments di atas.
      for (const id of [advancePurchaseId, targetPurchaseId].sort()) {
        await lockRowForUpdate(tx, '"fin_purchases"', id);
      }

      const [advance, target] = await Promise.all([
        tx.finPurchase.findUnique({ where: { id: advancePurchaseId }, include: { category: { select: { code: true } } } }),
        tx.finPurchase.findUnique({ where: { id: targetPurchaseId }, include: { category: { select: { code: true } } } }),
      ]);
      if (!advance) throw err("Pembelian sumber (uang muka) tidak ditemukan", 404);
      if (!target) throw err("Pembelian tujuan tidak ditemukan", 404);

      if (advance.category.code !== "UANG_MUKA_PEMBELIAN") {
        throw err(`${advance.purchaseNumber} bukan pembelian berkategori Uang Muka Pembelian`, 400);
      }
      if (advance.status !== "DIBAYAR") {
        throw err(`Uang muka ${advance.purchaseNumber} berstatus ${advance.status} — hanya uang muka yang sudah Dibayar yang bisa diterapkan`, 409);
      }
      if (target.category.code === "UANG_MUKA_PEMBELIAN") {
        throw err("Tidak bisa menerapkan uang muka ke pembelian uang muka lain", 400);
      }
      if (target.mode !== "UTANG") {
        throw err(`${target.purchaseNumber} bukan pembelian mode Utang — tidak ada Utang Usaha yang bisa dikurangi`, 400);
      }
      if (target.status !== "DISETUJUI") {
        throw err(`${target.purchaseNumber} berstatus ${target.status} — hanya pembelian Disetujui (belum dibayar) yang bisa menerima penerapan DP`, 409);
      }
      if (!advance.supplierId || !target.supplierId || advance.supplierId !== target.supplierId) {
        throw err("Uang muka dan pembelian tujuan harus dari supplier yang sama", 400);
      }

      const [aplikasiSumber, aplikasiTujuan] = await Promise.all([
        tx.finPurchaseAdvanceApplication.findMany({ where: { advancePurchaseId, status: "ACTIVE" }, select: { amount: true } }),
        tx.finPurchaseAdvanceApplication.findMany({ where: { targetPurchaseId, status: "ACTIVE" }, select: { amount: true } }),
      ]);
      const saldoTersedia = toMoney(advance.amount).minus(saldoDariAplikasi(aplikasiSumber));
      const sisaUtang = toMoney(target.amount).minus(saldoDariAplikasi(aplikasiTujuan));

      if (nominal.greaterThan(saldoTersedia)) {
        throw err(`Nominal (${nominal.toFixed(2)}) melebihi saldo uang muka tersedia (${saldoTersedia.toFixed(2)})`, 400);
      }
      if (nominal.greaterThan(sisaUtang)) {
        throw err(`Nominal (${nominal.toFixed(2)}) melebihi sisa utang pembelian tujuan (${sisaUtang.toFixed(2)})`, 400);
      }

      // Jurnal DULU (idempoten lewat kunci berbasis header, lihat komentar
      // panjang di purchaseAdvance.js soal kenapa BUKAN berbasis id baris
      // aplikasi) — baru baris aplikasinya, SAVEPOINT-guarded terhadap race
      // idempotencyKey. Kalau baris aplikasi ternyata sudah ada (request
      // kembar yang lolos ke sini), kembalikan baris yang MENANG race —
      // jangan buat baris/jurnal kedua.
      const applicationId = randomUUID();
      const { entry: journalEntry } = await postAdvanceApplied(tx, {
        idemKey: String(idemKey), sourceId: applicationId,
        advancePurchase: advance, targetPurchase: target, amount: nominal, userId: req.user.id,
      });

      await tx.$executeRawUnsafe("SAVEPOINT sp_advance_apply");
      let application;
      try {
        application = await tx.finPurchaseAdvanceApplication.create({
          data: {
            id: applicationId, advancePurchaseId, targetPurchaseId, amount: nominal,
            journalId: journalEntry.id, idempotencyKey: String(idemKey),
            status: "ACTIVE", createdById: req.user.id,
          },
        });
      } catch (e) {
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_advance_apply");
        if (e.code === "P2002") {
          const existing = await tx.finPurchaseAdvanceApplication.findUnique({ where: { idempotencyKey: String(idemKey) } });
          if (existing) { application = existing; }
          else throw e;
        } else {
          throw e;
        }
      }

      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: targetPurchaseId,
        eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: {
          aksi: "terapkan_dp", advancePurchaseNumber: advance.purchaseNumber, targetPurchaseNumber: target.purchaseNumber,
          amount: nominal.toFixed(2),
        },
      });

      return application;
    });

    res.status(201).json(bentukAplikasiDp({
      ...hasil,
      journal: await prisma.finJournalEntry.findUnique({ where: { id: hasil.journalId }, select: { id: true, entryNumber: true } }),
    }));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

/** Batalkan (reversal) satu penerapan DP — mengembalikan saldo DP tersedia & sisa utang target. */
financeTxRouter.post("/purchases/advance-applications/:id/cancel", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan pembatalan wajib diisi");

    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"fin_purchase_advance_applications"', req.params.id);
      const application = await tx.finPurchaseAdvanceApplication.findUnique({
        where: { id: req.params.id },
        include: {
          advancePurchase: { select: { purchaseNumber: true } },
          targetPurchase: { select: { id: true, purchaseNumber: true, status: true } },
        },
      });
      if (!application) throw err("Penerapan uang muka tidak ditemukan", 404);
      if (application.status === "REVERSED") throw err("Penerapan ini sudah dibatalkan sebelumnya", 409);

      // Kalau pembelian tujuan sudah DIBAYAR, pelunasan sisanya SUDAH
      // diposting berdasarkan sisa utang yang memperhitungkan DP ini —
      // membatalkan DP di titik ini akan membuat jurnal pelunasan lama
      // salah hitung secara retroaktif. Tolak; user koreksi/batalkan
      // pelunasannya dulu.
      if (application.targetPurchase.status === "DIBAYAR") {
        throw err(
          `${application.targetPurchase.purchaseNumber} sudah lunas — batalkan/koreksi pelunasannya dulu sebelum membatalkan penerapan DP ini`,
          409
        );
      }

      const reversal = await reverseJournal(tx, {
        entryId: application.journalId,
        reason: `Penerapan DP ${application.advancePurchase.purchaseNumber} → ${application.targetPurchase.purchaseNumber} dibatalkan — ${reason}`,
        userId: req.user.id,
      });

      const updated = await tx.finPurchaseAdvanceApplication.update({
        where: { id: application.id },
        data: {
          status: "REVERSED", reversalJournalId: reversal.id,
          reversedById: req.user.id, reversedAt: new Date(), reverseReason: reason,
        },
      });

      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: application.targetPurchase.id,
        eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: req.user.id,
        metadata: {
          aksi: "batalkan_penerapan_dp",
          advancePurchaseNumber: application.advancePurchase.purchaseNumber,
          targetPurchaseNumber: application.targetPurchase.purchaseNumber,
          amount: String(application.amount), reason,
        },
      });

      return updated;
    });

    res.json({ ...hasil, amount: moneyToNumber(hasil.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// SUPPLIER
// ═════════════════════════════════════════════════════════════════════════

financeTxRouter.get("/suppliers", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const suppliers = await prisma.finSupplier.findMany({
      where: req.query.includeInactive === "1" ? {} : { active: true },
      orderBy: { name: "asc" },
      include: {
        bills: {
          where: { status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] } },
          select: { amount: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
        },
      },
    });
    res.json({
      suppliers: suppliers.map((s) => {
        const sisa = s.bills.reduce((acc, b) => {
          const terbayar = b.allocations.length === 0 ? ZERO : sumMoney(b.allocations.map((a) => a.amount));
          return acc.plus(toMoney(b.amount).minus(terbayar));
        }, ZERO);
        return { ...s, bills: undefined, jumlahTagihanTerbuka: s.bills.length, sisaUtang: moneyToNumber(sisa) };
      }),
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/suppliers", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { code, name, phone, email, address, aliases, paymentTermDays, bankName, bankAccount, bankHolder, notes } = req.body;
    if (!name?.trim()) throw err("Nama supplier wajib diisi");

    // Kode dibuat otomatis kalau tidak diisi — supplier baru sering dicatat
    // buru-buru saat tagihan sudah di meja, dan memaksa memikirkan kode
    // dulu cuma memperlambat tanpa menambah apa pun.
    let kode = code?.trim().toUpperCase();
    if (!kode) {
      const jumlah = await prisma.finSupplier.count();
      kode = `SUP-${String(jumlah + 1).padStart(3, "0")}`;
    }

    const created = await prisma.finSupplier.create({
      data: {
        code: kode, name: name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        address: address?.trim() || null,
        aliases: Array.isArray(aliases) ? aliases.filter(Boolean).map((a) => String(a).trim()) : [],
        paymentTermDays: paymentTermDays ? Number(paymentTermDays) : null,
        bankName: bankName?.trim() || null,
        bankAccount: bankAccount?.trim() || null,
        bankHolder: bankHolder?.trim() || null,
        notes: notes?.trim() || null,
        createdById: req.user.id,
      },
    });
    res.status(201).json(created);
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.patch("/suppliers/:id", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { name, phone, email, address, aliases, paymentTermDays, bankName, bankAccount, bankHolder, notes, active } = req.body;
    const updated = await prisma.finSupplier.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(phone !== undefined && { phone: phone?.trim() || null }),
        ...(email !== undefined && { email: email?.trim() || null }),
        ...(address !== undefined && { address: address?.trim() || null }),
        ...(aliases !== undefined && { aliases: Array.isArray(aliases) ? aliases.filter(Boolean) : [] }),
        ...(paymentTermDays !== undefined && { paymentTermDays: paymentTermDays ? Number(paymentTermDays) : null }),
        ...(bankName !== undefined && { bankName: bankName?.trim() || null }),
        ...(bankAccount !== undefined && { bankAccount: bankAccount?.trim() || null }),
        ...(bankHolder !== undefined && { bankHolder: bankHolder?.trim() || null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(active !== undefined && { active: Boolean(active) }),
      },
    });
    res.json(updated);
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ── Tagihan supplier ────────────────────────────────────────────────────

const billInclude = {
  supplier: { select: { id: true, code: true, name: true, paymentTermDays: true } },
  goodsReceipt: { select: { id: true, receiptNumber: true, supplier: true, receivedDate: true } },
  approvedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  allocations: {
    where: { payment: { cancelledAt: null } },
    select: { amount: true, payment: { select: { id: true, paymentNumber: true, date: true } } },
  },
};

function bentukBill(b) {
  const terbayar = b.allocations?.length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO;
  return {
    ...b,
    amount: moneyToNumber(b.amount),
    terbayar: moneyToNumber(terbayar),
    sisa: moneyToNumber(toMoney(b.amount).minus(terbayar)),
    allocations: b.allocations?.map((a) => ({ ...a, amount: moneyToNumber(a.amount) })),
  };
}

financeTxRouter.get("/bills", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { status, supplierId, jatuhTempo } = req.query;
    const bills = await prisma.finSupplierBill.findMany({
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
      take: 300,
      include: billInclude,
    });
    res.json({ bills: bills.map(bentukBill) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/bills", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { supplierId, supplierRef, billDate, dueDate, amount, description, goodsReceiptId, expenseCategoryId, attachmentUrl } = req.body;
    if (!supplierId) throw err("Supplier wajib dipilih");
    if (!description?.trim()) throw err("Keterangan tagihan wajib diisi");
    const nominal = toMoney(amount, { field: "Nominal tagihan" });
    if (nominal.lessThanOrEqualTo(0)) throw err("Nominal tagihan harus lebih dari 0");
    if (!goodsReceiptId && !expenseCategoryId) {
      throw err("Pilih dokumen penerimaan barang ATAU kategori biaya — tagihan harus tahu akan dibebankan ke mana");
    }

    const supplier = await prisma.finSupplier.findUnique({
      where: { id: supplierId }, select: { id: true, paymentTermDays: true },
    });
    if (!supplier) throw err("Supplier tidak ditemukan", 404);

    const tglTagihan = parseTanggal(billDate);
    // Jatuh tempo dari termin supplier kalau tidak diisi manual. Kalau
    // supplier tidak punya termin baku, dibiarkan NULL apa adanya —
    // laporan umur utang akan menyebut acuannya "tanggal tagihan" secara
    // eksplisit, bukan mengarang tanggal jatuh tempo.
    let tglJatuhTempo = dueDate ? parseTanggal(dueDate) : null;
    if (!tglJatuhTempo && supplier.paymentTermDays) {
      tglJatuhTempo = new Date(tglTagihan.getTime() + supplier.paymentTermDays * 86400000);
    }

    const created = await prisma.finSupplierBill.create({
      data: {
        billNumber: await prisma.$transaction((tx) => generateDocumentNumber(tx, "BILL", tglTagihan)),
        supplierRef: supplierRef?.trim() || null,
        supplierId,
        billDate: tglTagihan,
        dueDate: tglJatuhTempo,
        amount: nominal,
        description: description.trim(),
        goodsReceiptId: goodsReceiptId || null,
        expenseCategoryId: goodsReceiptId ? null : expenseCategoryId,
        attachmentUrl: attachmentUrl || null,
        status: "MENUNGGU_APPROVAL",
        createdById: req.user.id,
      },
      include: billInclude,
    });
    res.status(201).json(bentukBill(created));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/bills/:id/approve", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    const hasil = await prisma.$transaction(async (tx) => {
      // Kunci baris dokumen: dua keputusan serempak (double-tap / dua penyetuju) diserialkan — yang kedua melihat status baru dan ditolak 409.
      await lockRowForUpdate(tx, '"fin_supplier_bills"', req.params.id);
      const b = await tx.finSupplierBill.findUnique({ where: { id: req.params.id } });
      if (!b) throw err("Tagihan tidak ditemukan", 404);
      if (!["DRAFT", "MENUNGGU_APPROVAL"].includes(b.status)) {
        throw err(`Tagihan ini sudah berstatus ${b.status}`, 409);
      }
      const updated = await tx.finSupplierBill.update({
        where: { id: b.id },
        data: { status: "DISETUJUI", approvedAt: new Date(), approvedById: req.user.id },
      });
      await postSupplierBill(tx, { billId: b.id, userId: req.user.id });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_SUPPLIER_BILL, entityId: b.id,
        eventType: EVENT_TYPES.DOCUMENT_APPROVED, actorId: req.user.id,
        metadata: { billNumber: b.billNumber, amount: String(b.amount) },
      });
      return updated;
    });
    const lengkap = await prisma.finSupplierBill.findUnique({ where: { id: hasil.id }, include: billInclude });
    res.json(bentukBill(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/bills/:id/reject", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan penolakan wajib diisi");
    const hasil = await prisma.$transaction(async (tx) => {
      // Kunci baris dokumen: dua keputusan serempak (double-tap / dua penyetuju) diserialkan — yang kedua melihat status baru dan ditolak 409.
      await lockRowForUpdate(tx, '"fin_supplier_bills"', req.params.id);
      const b = await tx.finSupplierBill.findUnique({ where: { id: req.params.id } });
      if (!b) throw err("Tagihan tidak ditemukan", 404);
      if (!["DRAFT", "MENUNGGU_APPROVAL"].includes(b.status)) {
        throw err("Tagihan yang sudah disetujui tidak bisa ditolak — batalkan lewat jurnal balik", 409);
      }
      const updated = await tx.finSupplierBill.update({
        where: { id: b.id }, data: { status: "DITOLAK", rejectReason: reason, approvedById: req.user.id, approvedAt: new Date() },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_SUPPLIER_BILL, entityId: b.id,
        eventType: EVENT_TYPES.DOCUMENT_REJECTED, actorId: req.user.id,
        metadata: { billNumber: b.billNumber, reason },
      });
      return updated;
    });
    const lengkap = await prisma.finSupplierBill.findUnique({ where: { id: hasil.id }, include: billInclude });
    res.json(bentukBill(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Dokumen penerimaan barang yang BELUM pernah ditagih — dipakai UI saat
// membuat tagihan supplier, supaya finance tidak perlu mencari manual.
financeTxRouter.get("/bills/unbilled-receipts", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const receipts = await prisma.goodsReceipt.findMany({
      where: { status: "COMPLETED", finSupplierBills: { none: {} } },
      orderBy: { receivedDate: "desc" },
      take: 100,
      select: {
        id: true, receiptNumber: true, supplier: true, receivedDate: true, sourceReference: true,
        movements: { where: { type: "RECEIPT" }, select: { qty: true, unitCost: true } },
      },
    });
    res.json({
      receipts: receipts.map((r) => {
        const berharga = r.movements.filter((m) => m.unitCost != null && m.unitCost > 0);
        const nilai = berharga.length === 0 ? ZERO : sumMoney(berharga.map((m) => toMoney(m.qty).times(toMoney(m.unitCost))));
        return {
          id: r.id, receiptNumber: r.receiptNumber, supplier: r.supplier,
          receivedDate: r.receivedDate, sourceReference: r.sourceReference,
          jumlahBaris: r.movements.length,
          barisTanpaHarga: r.movements.length - berharga.length,
          nilaiTerima: moneyToNumber(nilai),
        };
      }),
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ── Pembayaran ke supplier ──────────────────────────────────────────────

financeTxRouter.get("/supplier-payments", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to } = rentangDariQuery(req.query);
    const payments = await prisma.finSupplierPayment.findMany({
      where: { date: { gte: from, lte: to }, ...(req.query.supplierId && { supplierId: req.query.supplierId }) },
      orderBy: { date: "desc" },
      take: 200,
      include: {
        supplier: { select: { id: true, name: true } },
        cashAccount: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        allocations: { include: { bill: { select: { id: true, billNumber: true } } } },
      },
    });
    res.json({
      payments: payments.map((p) => ({
        ...p,
        amount: moneyToNumber(p.amount),
        allocations: p.allocations.map((a) => ({ ...a, amount: moneyToNumber(a.amount) })),
      })),
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/supplier-payments", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { supplierId, date, cashAccountId, reference, notes, attachmentUrl, allocations } = req.body;
    if (!supplierId) throw err("Supplier wajib dipilih");
    if (!cashAccountId) throw err("Rekening sumber pembayaran wajib dipilih");
    if (!Array.isArray(allocations) || allocations.length === 0) {
      throw err("Pilih minimal satu tagihan yang dibayar — pembayaran tanpa tagihan tujuan tidak bisa ditelusuri");
    }

    const hasil = await prisma.$transaction(async (tx) => {
      const bersih = allocations.map((a, i) => {
        if (!a?.billId) throw err(`Baris ke-${i + 1}: tagihan wajib dipilih`);
        const nominal = toMoney(a.amount, { field: `Nominal baris ke-${i + 1}` });
        if (nominal.lessThanOrEqualTo(0)) throw err(`Baris ke-${i + 1}: nominal harus lebih dari 0`);
        return { billId: a.billId, amount: nominal };
      });
      const total = sumMoney(bersih.map((b) => b.amount));
      const idTagihan = bersih.map((b) => b.billId);
      if (new Set(idTagihan).size !== idTagihan.length) throw err("Satu tagihan hanya boleh muncul sekali dalam satu pembayaran");
      // Kunci baris tagihan (urut id supaya tidak saling menunggu): dua pembayaran paralel untuk tagihan yang sama diserialkan, sehingga
      // yang kedua melihat sisa utang yang SUDAH berkurang — tanpa ini keduanya lolos dan Utang Usaha bersaldo debit.
      for (const id of [...idTagihan].sort()) await lockRowForUpdate(tx, '"fin_supplier_bills"', id);

      // Tiap alokasi TIDAK BOLEH melebihi sisa tagihannya. Tanpa cek ini,
      // Utang Usaha bisa jadi bersaldo debit (kita "berutang minus") yang
      // secara akuntansi tidak punya arti apa pun.
      for (const b of bersih) {
        const bill = await tx.finSupplierBill.findUnique({
          where: { id: b.billId },
          select: {
            id: true, billNumber: true, amount: true, status: true, supplierId: true,
            allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } },
          },
        });
        if (!bill) throw err(`Tagihan ${b.billId} tidak ditemukan`, 404);
        if (bill.supplierId !== supplierId) {
          throw err(`Tagihan ${bill.billNumber} bukan milik supplier yang dipilih`, 400);
        }
        if (!["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(bill.status)) {
          throw err(`Tagihan ${bill.billNumber} berstatus ${bill.status} — hanya tagihan yang sudah disetujui yang bisa dibayar`, 409);
        }
        const terbayar = bill.allocations.length === 0 ? ZERO : sumMoney(bill.allocations.map((a) => a.amount));
        const sisa = toMoney(bill.amount).minus(terbayar);
        if (b.amount.greaterThan(sisa)) {
          throw err(
            `Pembayaran untuk tagihan ${bill.billNumber} (${b.amount.toFixed(2)}) melebihi sisa utangnya (${sisa.toFixed(2)})`,
            400
          );
        }
      }

      const tgl = parseTanggal(date);
      // Biaya admin dihitung & divalidasi SERVER; bukan bagian alokasi tagihan.
      const biaya = await hitungBiayaTransfer(tx, req.body);
      const payment = await tx.finSupplierPayment.create({
        data: {
          paymentNumber: await generateDocumentNumber(tx, "PAYOUT", tgl),
          supplierId, date: tgl, amount: total, cashAccountId,
          paymentMethod: biaya.paymentMethod,
          transferFeeType: biaya.transferFeeType,
          transferFeeAmount: biaya.transferFeeAmount,
          reference: reference?.trim() || null,
          notes: notes?.trim() || null,
          attachmentUrl: attachmentUrl || null,
          createdById: req.user.id,
          allocations: { create: bersih.map((b) => ({ billId: b.billId, amount: b.amount })) },
        },
      });

      await postSupplierPayment(tx, { paymentId: payment.id, userId: req.user.id });
      for (const b of bersih) await recomputeBillStatus(tx, b.billId);

      return payment;
    });

    res.status(201).json({
      ...hasil, amount: moneyToNumber(hasil.amount), transferFeeAmount: moneyToNumber(hasil.transferFeeAmount),
      ...ringkasBiaya(hasil),
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/supplier-payments/:id/cancel", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan pembatalan wajib diisi");
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"fin_supplier_payments"', req.params.id);
      const p = await tx.finSupplierPayment.findUnique({
        where: { id: req.params.id },
        include: { allocations: { select: { billId: true } } },
      });
      if (!p) throw err("Pembayaran tidak ditemukan", 404);
      if (p.cancelledAt) throw err("Pembayaran ini sudah dibatalkan", 409);

      const entry = await findEntryByKey(tx, SUPPLIER_KEY.supplierPayment(p.id));
      if (entry && entry.status === "POSTED") {
        await reverseJournal(tx, { entryId: entry.id, reason: `Pembayaran ${p.paymentNumber} dibatalkan — ${reason}`, userId: req.user.id });
      }

      const updated = await tx.finSupplierPayment.update({
        where: { id: p.id },
        data: { cancelledAt: new Date(), cancelledById: req.user.id, cancelReason: reason },
      });
      // Status tagihan ikut mundur — alokasi dari pembayaran batal tidak
      // lagi dihitung (filter payment.cancelledAt di recomputeBillStatus).
      for (const a of p.allocations) await recomputeBillStatus(tx, a.billId);
      return updated;
    });
    res.json({ ...hasil, amount: moneyToNumber(hasil.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// KAS: TRANSFER & PEMASUKAN LAIN
// ═════════════════════════════════════════════════════════════════════════

financeTxRouter.get("/transfers", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to } = rentangDariQuery(req.query);
    const transfers = await prisma.finCashTransfer.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: "desc" },
      take: 200,
      include: {
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    res.json({
      transfers: transfers.map((t) => ({
        ...t, amount: moneyToNumber(t.amount), feeAmount: moneyToNumber(t.feeAmount),
      })),
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/transfers", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { date, fromAccountId, toAccountId, amount, feeAmount, reference, notes } = req.body;
    if (!fromAccountId || !toAccountId) throw err("Rekening asal & tujuan wajib dipilih");
    if (fromAccountId === toAccountId) throw err("Rekening asal dan tujuan tidak boleh sama");
    const nominal = toMoney(amount, { field: "Nominal transfer" });
    if (nominal.lessThanOrEqualTo(0)) throw err("Nominal transfer harus lebih dari 0");

    const hasil = await prisma.$transaction(async (tx) => {
      const tgl = parseTanggal(date);
      const t = await tx.finCashTransfer.create({
        data: {
          transferNumber: await generateDocumentNumber(tx, "TRF", tgl),
          date: tgl, amount: nominal,
          feeAmount: feeAmount ? toMoney(feeAmount, { field: "Biaya admin" }) : 0,
          fromAccountId, toAccountId,
          reference: reference?.trim() || null,
          notes: notes?.trim() || null,
          createdById: req.user.id,
        },
      });
      await postCashTransfer(tx, { transferId: t.id, userId: req.user.id });
      return t;
    });
    res.status(201).json({ ...hasil, amount: moneyToNumber(hasil.amount), feeAmount: moneyToNumber(hasil.feeAmount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/transfers/:id/cancel", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan pembatalan wajib diisi");
    const hasil = await prisma.$transaction(async (tx) => {
      const t = await tx.finCashTransfer.findUnique({ where: { id: req.params.id } });
      if (!t) throw err("Transfer tidak ditemukan", 404);
      if (t.cancelledAt) throw err("Transfer ini sudah dibatalkan", 409);
      await balikkanJurnalAktif(tx, {
        keyPrefix: CASH_KEY.transfer(t.id),
        alasan: `Transfer ${t.transferNumber} dibatalkan — ${reason}`, userId: req.user.id,
      });
      return tx.finCashTransfer.update({
        where: { id: t.id },
        data: { cancelledAt: new Date(), cancelledById: req.user.id, cancelReason: reason },
      });
    });
    res.json({ ...hasil, amount: moneyToNumber(hasil.amount), feeAmount: moneyToNumber(hasil.feeAmount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Transfer TIDAK punya tahap draft/approval (langsung posting saat
// dibuat), jadi cuma /koreksi yang relevan di sini, tidak ada PATCH
// pra-approval seperti expense.
function siapkanPerubahanTransfer(body) {
  const perubahan = {};
  if (body.date !== undefined) perubahan.date = parseTanggal(body.date);
  if (body.amount !== undefined) {
    const nominal = toMoney(body.amount, { field: "Nominal transfer" });
    if (nominal.lessThanOrEqualTo(0)) throw err("Nominal transfer harus lebih dari 0");
    perubahan.amount = nominal;
  }
  if (body.feeAmount !== undefined) perubahan.feeAmount = toMoney(body.feeAmount || 0, { field: "Biaya admin" });
  if (body.fromAccountId !== undefined) perubahan.fromAccountId = body.fromAccountId;
  if (body.toAccountId !== undefined) perubahan.toAccountId = body.toAccountId;
  if (body.reference !== undefined) perubahan.reference = body.reference?.trim() || null;
  if (body.notes !== undefined) perubahan.notes = body.notes?.trim() || null;

  const asal = body.fromAccountId ?? undefined;
  const tujuan = body.toAccountId ?? undefined;
  if (asal && tujuan && asal === tujuan) throw err("Rekening asal dan tujuan tidak boleh sama");
  return perubahan;
}

financeTxRouter.post("/transfers/:id/koreksi", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan koreksi wajib diisi");

    const hasil = await prisma.$transaction(async (tx) => {
      const t = await tx.finCashTransfer.findUnique({ where: { id: req.params.id } });
      if (!t) throw err("Transfer tidak ditemukan", 404);
      if (t.cancelledAt) throw err("Transfer yang sudah dibatalkan tidak bisa dikoreksi — buat transfer baru", 409);

      const perubahan = siapkanPerubahanTransfer(req.body);
      if (Object.keys(perubahan).length === 0) throw err("Tidak ada perubahan yang dikirim");

      const alasanKoreksi = `Koreksi ${t.transferNumber} — ${reason}`;
      await balikkanJurnalAktif(tx, { keyPrefix: CASH_KEY.transfer(t.id), alasan: alasanKoreksi, userId: req.user.id });

      const before = Object.fromEntries(Object.keys(perubahan).map((k) => [k, t[k]]));
      const updated = await tx.finCashTransfer.update({ where: { id: t.id }, data: perubahan });
      await postCashTransfer(tx, { transferId: t.id, userId: req.user.id, keySuffix: suffixKoreksi() });

      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_CASH_TRANSFER, entityId: t.id,
        eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: req.user.id,
        metadata: { transferNumber: t.transferNumber, reason, before, after: perubahan },
      });
      return updated;
    });
    res.json({ ...hasil, amount: moneyToNumber(hasil.amount), feeAmount: moneyToNumber(hasil.feeAmount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Akun pendapatan yang HANYA boleh diisi oleh alur order/pembayaran pelanggan (posting/orderRevenue.js). Pemasukan lain-lain tidak boleh
// dipakai sebagai jalan pintas mencatat uang pelanggan: itu melewati verifikasi pembayaran, invoice, dan status bayar order.
const AKUN_PENDAPATAN_ORDER = new Set(["PENDAPATAN_LAYANAN", "PENDAPATAN_PRODUK", "PENDAPATAN_SEWA", "PENDAPATAN_ONGKIR", "RETUR_PENJUALAN"]);
function tolakAkunPendapatanOrder(akun) {
  if (AKUN_PENDAPATAN_ORDER.has(akun.systemKey)) {
    throw err("Akun pendapatan penjualan/layanan hanya diisi lewat pembayaran order. Uang dari pelanggan dicatat di Pembayaran & Verifikasi, bukan sebagai Pemasukan Lain.");
  }
}

financeTxRouter.get("/other-income", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to } = rentangDariQuery(req.query);
    const incomes = await prisma.finOtherIncome.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: "desc" },
      take: 200,
      include: { cashAccount: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
    });
    const akunIds = [...new Set(incomes.map((i) => i.accountId))];
    const akun = await prisma.finAccount.findMany({
      where: { id: { in: akunIds } }, select: { id: true, code: true, name: true },
    });
    const peta = new Map(akun.map((a) => [a.id, a]));
    res.json({
      incomes: incomes.map((i) => ({ ...i, amount: moneyToNumber(i.amount), account: peta.get(i.accountId) || null })),
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/other-income", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { date, amount, description, accountId, cashAccountId, attachmentUrl, notes } = req.body;
    if (!description?.trim()) throw err("Keterangan pemasukan wajib diisi");
    if (!accountId) throw err("Akun pendapatan wajib dipilih");
    if (!cashAccountId) throw err("Rekening tujuan wajib dipilih");
    const nominal = toMoney(amount, { field: "Nominal pemasukan" });
    if (nominal.lessThanOrEqualTo(0)) throw err("Nominal pemasukan harus lebih dari 0");

    const akun = await prisma.finAccount.findUnique({ where: { id: accountId }, select: { type: true, isPostable: true, systemKey: true } });
    if (!akun) throw err("Akun pendapatan tidak ditemukan", 404);
    if (akun.type !== "PENDAPATAN") {
      throw err("Pemasukan lain-lain harus menunjuk akun bertipe Pendapatan — memilih akun lain akan merusak laba rugi");
    }
    tolakAkunPendapatanOrder(akun);

    const hasil = await prisma.$transaction(async (tx) => {
      const tgl = parseTanggal(date);
      const inc = await tx.finOtherIncome.create({
        data: {
          incomeNumber: await generateDocumentNumber(tx, "INC", tgl),
          date: tgl, amount: nominal, description: description.trim(),
          accountId, cashAccountId,
          attachmentUrl: attachmentUrl || null,
          notes: notes?.trim() || null,
          createdById: req.user.id,
        },
      });
      await postOtherIncome(tx, { incomeId: inc.id, userId: req.user.id });
      return inc;
    });
    res.status(201).json({ ...hasil, amount: moneyToNumber(hasil.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/other-income/:id/cancel", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan pembatalan wajib diisi");
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"fin_other_incomes"', req.params.id);
      const inc = await tx.finOtherIncome.findUnique({ where: { id: req.params.id } });
      if (!inc) throw err("Pemasukan tidak ditemukan", 404);
      if (inc.cancelledAt) throw err("Pemasukan ini sudah dibatalkan", 409);
      await balikkanJurnalAktif(tx, {
        keyPrefix: CASH_KEY.otherIncome(inc.id),
        alasan: `Pemasukan ${inc.incomeNumber} dibatalkan — ${reason}`, userId: req.user.id,
      });
      return tx.finOtherIncome.update({
        where: { id: inc.id },
        data: { cancelledAt: new Date(), cancelledById: req.user.id, cancelReason: reason },
      });
    });
    res.json({ ...hasil, amount: moneyToNumber(hasil.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Pemasukan lain TIDAK punya tahap draft/approval (langsung posting saat
// dibuat), sama seperti transfer — cuma /koreksi yang relevan di sini.
function siapkanPerubahanOtherIncome(body) {
  const perubahan = {};
  if (body.date !== undefined) perubahan.date = parseTanggal(body.date);
  if (body.amount !== undefined) {
    const nominal = toMoney(body.amount, { field: "Nominal pemasukan" });
    if (nominal.lessThanOrEqualTo(0)) throw err("Nominal pemasukan harus lebih dari 0");
    perubahan.amount = nominal;
  }
  if (body.description !== undefined) {
    if (!body.description?.trim()) throw err("Keterangan pemasukan wajib diisi");
    perubahan.description = body.description.trim();
  }
  if (body.accountId !== undefined) perubahan.accountId = body.accountId;
  if (body.cashAccountId !== undefined) perubahan.cashAccountId = body.cashAccountId;
  if (body.attachmentUrl !== undefined) perubahan.attachmentUrl = body.attachmentUrl || null;
  if (body.notes !== undefined) perubahan.notes = body.notes?.trim() || null;
  return perubahan;
}

financeTxRouter.post("/other-income/:id/koreksi", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan koreksi wajib diisi");

    const hasil = await prisma.$transaction(async (tx) => {
      const inc = await tx.finOtherIncome.findUnique({ where: { id: req.params.id } });
      if (!inc) throw err("Pemasukan tidak ditemukan", 404);
      if (inc.cancelledAt) throw err("Pemasukan yang sudah dibatalkan tidak bisa dikoreksi — buat pemasukan baru", 409);

      const perubahan = siapkanPerubahanOtherIncome(req.body);
      if (Object.keys(perubahan).length === 0) throw err("Tidak ada perubahan yang dikirim");

      if (perubahan.accountId) {
        const akun = await tx.finAccount.findUnique({ where: { id: perubahan.accountId }, select: { type: true, systemKey: true } });
        if (!akun) throw err("Akun pendapatan tidak ditemukan", 404);
        if (akun.type !== "PENDAPATAN") {
          throw err("Pemasukan lain-lain harus menunjuk akun bertipe Pendapatan — memilih akun lain akan merusak laba rugi");
        }
        tolakAkunPendapatanOrder(akun);
      }

      const alasanKoreksi = `Koreksi ${inc.incomeNumber} — ${reason}`;
      await balikkanJurnalAktif(tx, { keyPrefix: CASH_KEY.otherIncome(inc.id), alasan: alasanKoreksi, userId: req.user.id });

      const before = Object.fromEntries(Object.keys(perubahan).map((k) => [k, inc[k]]));
      const updated = await tx.finOtherIncome.update({ where: { id: inc.id }, data: perubahan });
      await postOtherIncome(tx, { incomeId: inc.id, userId: req.user.id, keySuffix: suffixKoreksi() });

      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_OTHER_INCOME, entityId: inc.id,
        eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: req.user.id,
        metadata: { incomeNumber: inc.incomeNumber, reason, before, after: perubahan },
      });
      return updated;
    });
    res.json({ ...hasil, amount: moneyToNumber(hasil.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// PIUTANG: VERIFIKASI PEMBAYARAN, ALOKASI, REFUND
// ═════════════════════════════════════════════════════════════════════════

// Antrean pembayaran pelanggan — dipakai halaman "Pembayaran & Verifikasi".
financeTxRouter.get("/customer-payments", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to } = rentangDariQuery(req.query);
    const { status } = req.query; // belum_verifikasi | terverifikasi | dibatalkan | semua

    const where = {
      createdAt: { gte: from, lt: new Date(to.getTime() + 86400000) },
      ...(status === "belum_verifikasi" && { cancelledAt: null, verifications: { none: {} } }),
      ...(status === "terverifikasi" && { cancelledAt: null, verifications: { some: {} } }),
      ...(status === "dibatalkan" && { cancelledAt: { not: null } }),
    };

    const [payments, gate] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 300,
        select: {
          id: true, amount: true, method: true, createdAt: true, proofPhotoUrl: true,
          cancelledAt: true, cancelReason: true, orderId: true,
          cashAccount: { select: { id: true, name: true } },
          recordedBy: { select: { id: true, name: true } },
          cancelledBy: { select: { id: true, name: true } },
          verifications: { select: { id: true, createdAt: true, verifiedBy: { select: { id: true, name: true } } } },
          finAllocations: { select: { id: true, orderId: true, amount: true, order: { select: { orderNumber: true } } } },
          order: {
            select: {
              id: true, orderNumber: true, value: true, paymentStatus: true,
              customer: { select: { id: true, name: true } },
            },
          },
          // Job TIDAK punya kolom "jobNumber" (bukan seperti Order.orderNumber
          // — lihat model Job di schema.prisma, tidak ada nomor dokumen
          // manusiawi untuknya). Field itu sebelumnya di sini menyebabkan
          // SELURUH endpoint ini gagal dengan PrismaClientValidationError
          // ("Unknown field `jobNumber`") — halaman Pembayaran & Verifikasi
          // tidak bisa memuat data sama sekali.
          job: { select: { id: true, type: true } },
        },
      }),
      getVerificationGate(prisma),
    ]);

    res.json({
      payments: payments.map((p) => ({
        ...p,
        terverifikasi: p.verifications.length > 0,
        finAllocations: p.finAllocations.map((a) => ({ ...a, amount: moneyToNumber(a.amount) })),
      })),
      gate,
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Alokasi satu pembayaran ke beberapa order.
financeTxRouter.post("/customer-payments/:id/allocations", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { allocations } = req.body;
    const hasil = await prisma.$transaction(async (tx) => {
      const orderIds = await setAllocations(tx, {
        paymentId: req.params.id, allocations, userId: req.user.id,
      });
      // Status bayar SEMUA order yang terdampak dihitung ulang — termasuk
      // order asal yang uangnya dipindah keluar.
      const status = [];
      for (const orderId of orderIds) {
        status.push({ orderId, ...(await recomputeOrderPaymentStatus(tx, orderId)) });
      }

      // Jurnal penerimaannya ikut disesuaikan: yang lama dibalik, yang baru
      // diposting dengan pembagian order yang benar. TIDAK diedit di
      // tempat — jurnal terposting tidak pernah diubah (aturan 4).
      const entry = await findEntryByKey(tx, ORDER_KEY.payment(req.params.id));
      if (entry && entry.status === "POSTED") {
        await reverseJournal(tx, {
          entryId: entry.id,
          reason: "Alokasi pembayaran ke order diubah",
          userId: req.user.id,
        });
        // Idempotency key lama sudah terpakai oleh jurnal yang baru
        // dibalik, jadi posting ulang otomatis akan dilewati. Jurnal
        // penggantinya dibuat MANUAL di sini dengan sumber yang sama
        // supaya tetap bisa ditelusuri ke pembayarannya.
        const { bukukanUlangAlokasi } = await import("../services/finance/posting/reallocate.js");
        await bukukanUlangAlokasi(tx, { paymentId: req.params.id, userId: req.user.id });
      }
      return status;
    });
    res.json({ ok: true, status: hasil });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ── Refund ──────────────────────────────────────────────────────────────

const refundInclude = {
  order: { select: { id: true, orderNumber: true, value: true, customer: { select: { id: true, name: true } } } },
  cashAccount: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

financeTxRouter.get("/refunds", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const refunds = await prisma.finRefund.findMany({
      where: req.query.status ? { status: req.query.status } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: refundInclude,
    });
    res.json({ refunds: refunds.map((r) => ({ ...r, amount: moneyToNumber(r.amount) })) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/refunds", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { orderId, date, amount, reason, cashAccountId, attachmentUrl } = req.body;
    if (!orderId) throw err("Order wajib dipilih");
    if (!reason?.trim()) throw err("Alasan refund wajib diisi");
    if (!cashAccountId) throw err("Rekening sumber pengembalian wajib dipilih");
    const nominal = toMoney(amount, { field: "Nominal refund" });
    if (nominal.lessThanOrEqualTo(0)) throw err("Nominal refund harus lebih dari 0");

    // Refund TIDAK BOLEH melebihi uang yang benar-benar pernah diterima
    // untuk order itu. Tanpa cek ini, "refund" jadi jalan mengeluarkan uang
    // perusahaan tanpa dokumen pengeluaran & tanpa approval yang sesuai.
    // (Cek ini DIULANG LAGI di dalam transaksi POST /refunds/:id/approve —
    // lihat komentar di sana soal kenapa satu kali cek di sini saja tidak
    // cukup untuk dua refund yang dibuat hampir bersamaan.)
    const gate = await getVerificationGate(prisma);
    const sisa = await sisaBisaDirefund(prisma, orderId, gate);
    if (nominal.greaterThan(sisa)) {
      throw err(
        `Refund ${nominal.toFixed(2)} melebihi uang yang pernah diterima untuk order ini ` +
        `(sisa yang bisa dikembalikan: ${sisa.toFixed(2)})`
      );
    }

    const tgl = parseTanggal(date);
    const biaya = await hitungBiayaTransfer(prisma, req.body);
    const created = await prisma.finRefund.create({
      data: {
        refundNumber: await prisma.$transaction((tx) => generateDocumentNumber(tx, "RFD", tgl)),
        orderId, date: tgl, amount: nominal, reason: reason.trim(),
        cashAccountId,
        paymentMethod: biaya.paymentMethod,
        transferFeeType: biaya.transferFeeType,
        transferFeeAmount: biaya.transferFeeAmount,
        attachmentUrl: attachmentUrl || null,
        status: "MENUNGGU_APPROVAL",
        createdById: req.user.id,
      },
      include: refundInclude,
    });
    res.status(201).json({
      ...created, amount: moneyToNumber(created.amount), transferFeeAmount: moneyToNumber(created.transferFeeAmount),
      ...ringkasBiaya(created),
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/refunds/:id/approve", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    const hasil = await prisma.$transaction(async (tx) => {
      // Kunci baris dokumen: dua keputusan serempak (double-tap / dua penyetuju) diserialkan — yang kedua melihat status baru dan ditolak 409.
      await lockRowForUpdate(tx, '"fin_refunds"', req.params.id);
      const r = await tx.finRefund.findUnique({ where: { id: req.params.id } });
      if (!r) throw err("Refund tidak ditemukan", 404);
      if (r.status !== "MENUNGGU_APPROVAL") throw err(`Refund ini sudah berstatus ${r.status}`, 409);

      // ⚠️ KUNCI baris Order SEBELUM menghitung sisa yang bisa direfund.
      //
      // Cek "tidak melebihi uang yang pernah diterima" DIULANG DI SINI
      // memakai `tx` (bukan cuma di POST /refunds yang memakai `prisma`
      // singleton di luar transaksi) — tapi tanpa lock ini, mengulang cek
      // itu SENDIRIAN TIDAK CUKUP: dua transaksi approve yang berjalan
      // BERSAMAAN untuk DUA refund BERBEDA pada order yang SAMA sama-sama
      // membaca `sisaBisaDirefund` SEBELUM salah satu sempat menulis
      // `tx.finRefund.update` di bawah (READ COMMITTED, default Postgres,
      // tidak memblokir SELECT biasa) — keduanya melihat sisa yang SAMA,
      // dua-duanya lolos, dua-duanya commit. Dibuktikan NYATA lewat
      // Promise.all di financeLedger.integration.test.js sebelum lock ini
      // ditambahkan (17 Sept 2026): dua refund yang bersama-sama melebihi
      // uang yang diterima, DUA-DUANYA berstatus fulfilled.
      //
      // Order.id BUKAN kolom uuid (String @default(cuid()), lihat
      // schema.prisma) — `cast: null` wajib, lihat komentar di
      // lockRowForUpdate soal kenapa cast salah = error 42883.
      await lockRowForUpdate(tx, '"Order"', r.orderId, { cast: null });

      const gate = await getVerificationGate(tx);
      const sisa = await sisaBisaDirefund(tx, r.orderId, gate);
      if (toMoney(r.amount).greaterThan(sisa)) {
        throw err(
          `Refund ${r.refundNumber} (${toMoney(r.amount).toFixed(2)}) melebihi sisa yang bisa dikembalikan untuk order ` +
          `ini sekarang (${sisa.toFixed(2)}) — kemungkinan ada refund lain untuk order yang sama sudah ` +
          "disetujui lebih dulu. Tolak salah satu, atau kurangi nominalnya.",
          409
        );
      }

      const updated = await tx.finRefund.update({
        where: { id: r.id },
        data: { status: "DISETUJUI", approvedAt: new Date(), approvedById: req.user.id },
      });
      await postRefund(tx, { refundId: r.id, userId: req.user.id });
      // Status bayar order ikut turun: uang yang dikembalikan bukan lagi
      // uang yang kita pegang.
      await recomputeOrderPaymentStatus(tx, r.orderId);
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_REFUND, entityId: r.id,
        eventType: EVENT_TYPES.DOCUMENT_APPROVED, actorId: req.user.id,
        metadata: { refundNumber: r.refundNumber, amount: String(r.amount), orderId: r.orderId },
      });
      return updated;
    });
    const lengkap = await prisma.finRefund.findUnique({ where: { id: hasil.id }, include: refundInclude });
    res.json({ ...lengkap, amount: moneyToNumber(lengkap.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/refunds/:id/reject", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan penolakan wajib diisi");
    const hasil = await prisma.$transaction(async (tx) => {
      // Kunci baris dokumen: dua keputusan serempak (double-tap / dua penyetuju) diserialkan — yang kedua melihat status baru dan ditolak 409.
      await lockRowForUpdate(tx, '"fin_refunds"', req.params.id);
      const r = await tx.finRefund.findUnique({ where: { id: req.params.id } });
      if (!r) throw err("Refund tidak ditemukan", 404);
      if (r.status !== "MENUNGGU_APPROVAL") throw err(`Refund ini sudah berstatus ${r.status}`, 409);
      const updated = await tx.finRefund.update({
        where: { id: r.id },
        data: { status: "DITOLAK", rejectReason: reason, approvedById: req.user.id, approvedAt: new Date() },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_REFUND, entityId: r.id,
        eventType: EVENT_TYPES.DOCUMENT_REJECTED, actorId: req.user.id,
        metadata: { refundNumber: r.refundNumber, reason },
      });
      return updated;
    });
    const lengkap = await prisma.finRefund.findUnique({ where: { id: hasil.id }, include: refundInclude });
    res.json({ ...lengkap, amount: moneyToNumber(lengkap.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// REKONSILIASI BANK
// ═════════════════════════════════════════════════════════════════════════

financeTxRouter.get("/bank-statements", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const statements = await prisma.finBankStatement.findMany({
      where: req.query.cashAccountId ? { cashAccountId: req.query.cashAccountId } : {},
      orderBy: { periodStart: "desc" },
      take: 50,
      include: {
        cashAccount: { select: { id: true, name: true, kind: true } },
        createdBy: { select: { id: true, name: true } },
        completedBy: { select: { id: true, name: true } },
        lines: { select: { id: true, status: true, amount: true } },
      },
    });
    const hasil = [];
    for (const s of statements) {
      const buku = await saldoBukuSampai(prisma, s.cashAccountId, s.periodEnd);
      const selisih = toMoney(s.closingBalance).minus(buku); // bank − buku
      hasil.push({
        ...s,
        openingBalance: moneyToNumber(s.openingBalance),
        closingBalance: moneyToNumber(s.closingBalance),
        statusLabel: LABEL_STATUS_REKON[s.status] ?? s.status,
        sementara: s.status === STATUS_DRAF_MENUNGGU,
        saldoBuku: moneyToNumber(buku),
        selisih: moneyToNumber(selisih),
        bukuLebihTinggi: moneyToNumber(buku.minus(toMoney(s.closingBalance))),
        jumlahBaris: s.lines.length,
        belumCocok: s.lines.filter((l) => l.status === "BELUM_COCOK").length,
        lines: undefined,
      });
    }
    res.json({ statements: hasil });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/bank-statements", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { cashAccountId, periodStart, periodEnd, openingBalance, closingBalance, note, lines } = req.body;
    if (!cashAccountId) throw err("Rekening wajib dipilih");
    if (!periodStart || !periodEnd) throw err("Periode koran bank wajib diisi");

    const created = await prisma.finBankStatement.create({
      data: {
        cashAccountId,
        periodStart: parseTanggal(periodStart),
        periodEnd: parseTanggal(periodEnd),
        openingBalance: toMoney(openingBalance ?? 0, { field: "Saldo awal" }),
        closingBalance: toMoney(closingBalance ?? 0, { field: "Saldo akhir" }),
        note: note?.trim() || null,
        createdById: req.user.id,
        ...(Array.isArray(lines) && lines.length > 0 && {
          lines: {
            create: lines.map((l, i) => ({
              date: parseTanggal(l.date),
              description: String(l.description || `Baris ${i + 1}`).trim(),
              reference: l.reference?.trim() || null,
              // BERTANDA apa adanya — transkrip koran bank, bukan transaksi
              // yang kita buat sendiri (lihat schema.prisma).
              amount: toMoney(l.amount, { field: `Nominal baris ke-${i + 1}` }),
            })),
          },
        }),
      },
      include: { cashAccount: { select: { id: true, name: true } } },
    });
    res.status(201).json({
      ...created,
      openingBalance: moneyToNumber(created.openingBalance),
      closingBalance: moneyToNumber(created.closingBalance),
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Detail rekonsiliasi: baris koran bank + KANDIDAT baris jurnal untuk
// dicocokkan + selisih saldo buku vs koran.
financeTxRouter.get("/bank-statements/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const s = await prisma.finBankStatement.findUnique({
      where: { id: req.params.id },
      include: {
        cashAccount: { select: { id: true, name: true, kind: true, accountId: true } },
        lines: {
          orderBy: { date: "asc" },
          include: {
            matchedLine: {
              select: {
                id: true, debit: true, credit: true, description: true,
                entry: { select: { id: true, entryNumber: true, date: true, description: true } },
              },
            },
            matchedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!s) return res.status(404).json({ error: "Koran bank tidak ditemukan" });

    const { STATUS_DIHITUNG } = await import("../services/finance/journal.js");

    // Baris jurnal rekening ini di periode yang sama — kandidat pencocokan.
    const kandidat = await prisma.finJournalLine.findMany({
      where: {
        cashAccountId: s.cashAccountId,
        // Penyesuaian buku (kalibrasi saldo riil & koreksi kas ganda, sumber
        // SALDO_AWAL) dan penyesuaian sementara rekonsiliasi (sumber
        // REKONSILIASI_SEMENTARA, akun 2-1700) BUKAN transaksi bank → tidak
        // pernah jadi kandidat pencocokan mutasi koran.
        entry: { status: { in: STATUS_DIHITUNG }, date: { gte: s.periodStart, lte: s.periodEnd }, source: { notIn: ["SALDO_AWAL", "REKONSILIASI_SEMENTARA"] } },
      },
      orderBy: [{ entry: { date: "asc" } }],
      select: {
        id: true, debit: true, credit: true, description: true,
        entry: { select: { id: true, entryNumber: true, date: true, description: true, source: true } },
        bankStatementLines: { select: { id: true } },
      },
    });
    const penyesuaianBuku = await penyesuaianBukuPeriode(prisma, { cashAccountId: s.cashAccountId, periodStart: s.periodStart, periodEnd: s.periodEnd });
    const danaBelumTeridentifikasi = await saldoBelumTeridentifikasi(prisma, { cashAccountId: s.cashAccountId });

    // Saldo menurut BUKU pada akhir periode (seluruh mutasi rekening ini
    // sampai periodEnd) vs saldo menurut KORAN BANK.
    const agregat = await prisma.finJournalLine.aggregate({
      where: {
        cashAccountId: s.cashAccountId,
        entry: { status: { in: STATUS_DIHITUNG }, date: { lte: s.periodEnd } },
      },
      _sum: { debit: true, credit: true },
    });
    const saldoBuku = toMoney(agregat._sum.debit || 0).minus(toMoney(agregat._sum.credit || 0));
    const selisih = toMoney(s.closingBalance).minus(saldoBuku);

    res.json({
      statement: {
        ...s,
        openingBalance: moneyToNumber(s.openingBalance),
        closingBalance: moneyToNumber(s.closingBalance),
        lines: s.lines.map((l) => ({
          ...l,
          amount: moneyToNumber(l.amount),
          matchedLine: l.matchedLine && {
            ...l.matchedLine,
            debit: moneyToNumber(l.matchedLine.debit),
            credit: moneyToNumber(l.matchedLine.credit),
          },
        })),
      },
      kandidat: kandidat
        .filter((k) => k.bankStatementLines.length === 0)
        .map((k) => ({
          id: k.id,
          nilai: moneyToNumber(toMoney(k.debit).minus(toMoney(k.credit))),
          description: k.description || k.entry.description,
          entryNumber: k.entry.entryNumber,
          tanggal: k.entry.date,
          source: k.entry.source,
        })),
      rekonsiliasi: {
        saldoBuku: moneyToNumber(saldoBuku),
        saldoKoran: moneyToNumber(s.closingBalance),
        selisih: moneyToNumber(selisih),
        bukuLebihTinggi: moneyToNumber(saldoBuku.minus(toMoney(s.closingBalance))),
        cocok: selisih.isZero(),
        belumCocok: s.lines.filter((l) => l.status === "BELUM_COCOK").length,
        sementara: s.status === STATUS_DRAF_MENUNGGU,
        statusLabel: LABEL_STATUS_REKON[s.status] ?? s.status,
        labelSementara: s.status === STATUS_DRAF_MENUNGGU ? LABEL_REKON_SEMENTARA : null,
        cutoff: { mulai: s.cutoffStartAt, selesai: s.cutoffEndAt },
        penyelesaian: evaluasiSelesai({
          status: s.status, jumlahBaris: s.lines.length, belumCocok: s.lines.filter((l) => l.status === "BELUM_COCOK").length,
          selisih, danaBelumTeridentifikasi: danaBelumTeridentifikasi.total,
        }),
      },
      penyesuaianBuku,
      danaBelumTeridentifikasi,
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/bank-statements/:id/lines", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { date, description, reference, amount } = req.body;
    if (!description?.trim()) throw err("Keterangan baris wajib diisi");
    const created = await prisma.$transaction(async (tx) => {
      const st = await tx.finBankStatement.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
      if (!st) throw err("Koran bank tidak ditemukan", 404);
      if (st.status === "SELESAI") throw err("Rekonsiliasi periode ini sudah ditutup — buka kembali kalau memang perlu diubah", 409);
      const baris = await tx.finBankStatementLine.create({
        data: {
          statementId: req.params.id,
          date: parseTanggal(date),
          description: description.trim(),
          reference: reference?.trim() || null,
          amount: toMoney(amount, { field: "Nominal baris" }),
        },
      });
      // Mutasi bank asli pertama masuk → periode sementara berubah jadi "sedang dicocokkan".
      if (st.status === STATUS_DRAF_MENUNGGU) await tx.finBankStatement.update({ where: { id: st.id }, data: { status: "DRAFT" } });
      return baris;
    });
    res.status(201).json({ ...created, amount: moneyToNumber(created.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/bank-lines/:id/match", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { journalLineId } = req.body;
    if (!journalLineId) throw err("Baris jurnal pasangannya wajib dipilih");

    const updated = await prisma.$transaction(async (tx) => {
      // Kunci baris koran & baris jurnal: dua pencocokan serempak tidak bisa memakai baris jurnal yang sama, dan double-tap tidak mencocokkan dua kali.
      await lockRowForUpdate(tx, '"fin_bank_statement_lines"', req.params.id);
      await lockRowForUpdate(tx, '"fin_journal_lines"', journalLineId);
      const baris = await tx.finBankStatementLine.findUnique({
        where: { id: req.params.id },
        include: { statement: { select: { cashAccountId: true, status: true } } },
      });
      if (!baris) throw err("Baris koran bank tidak ditemukan", 404);
      if (baris.status === "COCOK") throw err("Baris koran ini sudah dicocokkan", 409);
      const dipakai = await tx.finBankStatementLine.findFirst({ where: { matchedLineId: journalLineId, id: { not: baris.id } }, select: { id: true } });
      if (dipakai) throw err("Baris jurnal ini sudah dicocokkan dengan baris koran lain", 409);
      if (baris.statement.status === "SELESAI") {
        throw err("Rekonsiliasi periode ini sudah ditutup — buka kembali kalau memang perlu diubah", 409);
      }

      const jurnal = await tx.finJournalLine.findUnique({
        where: { id: journalLineId },
        select: { id: true, debit: true, credit: true, cashAccountId: true, entry: { select: { source: true } } },
      });
      if (!jurnal) throw err("Baris jurnal tidak ditemukan", 404);
      if (jurnal.entry?.source === "SALDO_AWAL") throw err("Itu Penyesuaian Buku (kalibrasi/koreksi saldo), bukan transaksi bank — tidak dicocokkan dengan mutasi koran", 400);
      if (jurnal.cashAccountId !== baris.statement.cashAccountId) {
        throw err("Baris jurnal itu bukan mutasi rekening yang sedang direkonsiliasi", 400);
      }

      // Nominal WAJIB sama persis, termasuk arahnya. Pencocokan yang
      // nominalnya beda bukan pencocokan — itu menyembunyikan selisih yang
      // justru jadi alasan rekonsiliasi dilakukan.
      const nilaiJurnal = toMoney(jurnal.debit).minus(toMoney(jurnal.credit));
      if (!nilaiJurnal.equals(toMoney(baris.amount))) {
        throw err(
          `Nominal tidak sama: koran bank ${toMoney(baris.amount).toFixed(2)} vs jurnal ${nilaiJurnal.toFixed(2)}. ` +
          "Kalau memang beda, catat penyesuaiannya sebagai jurnal tersendiri dulu."
        );
      }

      const hasilCocok = await tx.finBankStatementLine.update({
        where: { id: baris.id },
        data: { status: "COCOK", matchedLineId: journalLineId, matchedAt: new Date(), matchedById: req.user.id },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_BANK_STATEMENT, entityId: baris.statementId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { label: "Baris koran dicocokkan", catatan: `${baris.description} · ${toMoney(baris.amount).toFixed(2)}`, aksi: "cocokkan", barisId: baris.id, journalLineId },
      });
      return hasilCocok;
    });
    res.json({ ...updated, amount: moneyToNumber(updated.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Guard "rekonsiliasi sudah SELESAI" bersama — dipakai match (di atas) DAN
// unmatch/ignore (di bawah). SEBELUM ini match sudah menolak periode yang
// sudah ditutup, tapi unmatch/ignore TIDAK — jadi baris yang sudah
// direkonsiliasi & dikunci lewat POST /complete tetap bisa diam-diam
// dilepas/diabaikan ulang tanpa membuka kembali periodenya secara sadar
// lewat endpoint yang memang untuk itu. Satu aturan, tiga endpoint.
async function guardStatementBelumSelesai(tx, lineId) {
  const baris = await tx.finBankStatementLine.findUnique({
    where: { id: lineId },
    select: { statement: { select: { status: true } } },
  });
  if (!baris) throw err("Baris koran bank tidak ditemukan", 404);
  if (baris.statement.status === "SELESAI") {
    throw err("Rekonsiliasi periode ini sudah ditutup — buka kembali kalau memang perlu diubah", 409);
  }
}

financeTxRouter.post("/bank-lines/:id/unmatch", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"fin_bank_statement_lines"', req.params.id);
      await guardStatementBelumSelesai(tx, req.params.id);
      const sebelum = await tx.finBankStatementLine.findUnique({ where: { id: req.params.id }, select: { status: true, statementId: true, description: true, amount: true } });
      if (sebelum.status !== "COCOK") throw err("Baris koran ini tidak sedang dicocokkan", 409);
      const hasilLepas = await tx.finBankStatementLine.update({
        where: { id: req.params.id },
        data: { status: "BELUM_COCOK", matchedLineId: null, matchedAt: null, matchedById: null },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_BANK_STATEMENT, entityId: sebelum.statementId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { label: "Pencocokan baris koran dilepas", catatan: `${sebelum.description} · ${toMoney(sebelum.amount).toFixed(2)}`, aksi: "lepas", barisId: req.params.id },
      });
      return hasilLepas;
    });
    res.json({ ...updated, amount: moneyToNumber(updated.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/bank-lines/:id/ignore", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const note = req.body?.note?.trim();
    if (!note) throw err("Catatan wajib diisi — baris yang sengaja tidak dicocokkan harus punya penjelasan");
    const updated = await prisma.$transaction(async (tx) => {
      await guardStatementBelumSelesai(tx, req.params.id);
      return tx.finBankStatementLine.update({
        where: { id: req.params.id },
        data: { status: "DIABAIKAN", note, matchedById: req.user.id, matchedAt: new Date() },
      });
    });
    res.json({ ...updated, amount: moneyToNumber(updated.amount) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeTxRouter.post("/bank-statements/:id/complete", requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    const note = req.body?.note?.trim() || null;
    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.finBankStatement.findUnique({
        where: { id: req.params.id },
        include: { lines: { select: { status: true } } },
      });
      if (!s) throw err("Koran bank tidak ditemukan", 404);
      const belumCocok = s.lines.filter((l) => l.status === "BELUM_COCOK").length;
      // Aturan tunggal (services/finance/rekonBank.js): mutasi bank asli ada, semua baris dicocokkan/dijelaskan, selisih nol, status DRAFT, TIDAK ADA dana suspense (2-1700) yang masih menunggu identifikasi untuk rekening ini.
      const saldoBuku = await saldoBukuSampai(tx, s.cashAccountId, s.periodEnd);
      const suspense = await saldoBelumTeridentifikasi(tx, { cashAccountId: s.cashAccountId });
      const ev = evaluasiSelesai({
        status: s.status, jumlahBaris: s.lines.length, belumCocok,
        selisih: toMoney(s.closingBalance).minus(saldoBuku), danaBelumTeridentifikasi: suspense.total,
      });
      if (!ev.bisa) throw err(`Periode belum bisa diselesaikan: ${ev.alasan.join("; ")}.`, 409);
      return tx.finBankStatement.update({
        where: { id: s.id },
        data: { status: "SELESAI", completedAt: new Date(), completedById: req.user.id, note },
      });
    });
    res.json({
      ...updated,
      openingBalance: moneyToNumber(updated.openingBalance),
      closingBalance: moneyToNumber(updated.closingBalance),
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// BUKTI / NOTA — upload, pasang ke dokumen, verifikasi oleh orang lain,
// dan antrean tinjau. Kebijakannya dijelaskan di services/finance/receipts.js.
// ═════════════════════════════════════════════════════════════════════════

const uploadBukti = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // foto HP mentah; dikompres server sebelum disimpan
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Hanya file gambar (foto nota) yang diperbolehkan"));
    cb(null, true);
  },
});

const MODEL_BUKTI = { expenses: "finExpense", purchases: "finPurchase" };
const JENIS_BUKTI = { expenses: "expense", purchases: "purchase" };

// Upload bebas: foto dipilih SEBELUM dokumennya disimpan (satu langkah di
// form). Balikkan URL + daftar dokumen lain yang sudah memakai foto ini.
financeTxRouter.post("/receipts/upload",
  requireAnyPermission(P.FINANCE_POST, P.FINANCE_EXPENSE_SUBMIT),
  (req, res, next) => uploadBukti.single("receipt")(req, res, (e) => (e ? handleFinanceError(err(e.message), res) : next())),
  async (req, res) => {
    try {
      if (!req.file) throw err("File foto wajib disertakan");
      const { url, ukuranAsli, ukuranAkhir } = await simpanFotoBukti(req.file.buffer);
      res.status(201).json({ url, ukuranAsli, ukuranAkhir, dipakaiDi: await cariPemakaiBukti(prisma, url) });
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

// Pasang / ganti / lepas bukti pada dokumen yang sudah ada. Boleh di status
// apa pun kecuali DIBATALKAN — bukti tidak mengubah angka buku besar. Ganti
// foto = verifikasi lama gugur (yang diverifikasi adalah foto yang lama).
financeTxRouter.post("/:jenis(expenses|purchases)/:id/bukti",
  requireAnyPermission(P.FINANCE_POST, P.FINANCE_EXPENSE_SUBMIT),
  async (req, res) => {
    try {
      const model = prisma[MODEL_BUKTI[req.params.jenis]];
      const receiptUrl = req.body?.receiptUrl || null;
      if (receiptUrl && !String(receiptUrl).startsWith(`${RECEIPTS_URL_PREFIX}/`)) {
        throw err("Bukti harus diunggah lewat fitur upload nota");
      }
      const doc = await model.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, createdById: true, receiptUrl: true } });
      if (!doc) throw err("Dokumen tidak ditemukan", 404);
      const menggantiFoto = !!doc.receiptUrl && doc.receiptUrl !== receiptUrl;
      const alasanGanti = req.body?.reason?.trim();
      if (menggantiFoto && !alasanGanti) throw err("Alasan wajib diisi untuk mengganti atau melepas foto bukti yang sudah ada");
      if (doc.status === "DIBATALKAN") throw err("Dokumen yang sudah dibatalkan tidak bisa diubah buktinya", 409);
      if (!hasPermission(req.user, P.FINANCE_POST) && doc.createdById !== req.user.id) {
        throw err("Anda hanya bisa mengubah bukti pengajuan Anda sendiri", 403);
      }
      await prisma.$transaction(async (tx) => {
        await tx[MODEL_BUKTI[req.params.jenis]].update({
          where: { id: doc.id },
          data: { receiptUrl, receiptVerifiedAt: null, receiptVerifiedById: null },
        });
        if (menggantiFoto) {
          await recordActivity(tx, {
            entityType: req.params.jenis === "expenses" ? ENTITY_TYPES.FIN_EXPENSE : ENTITY_TYPES.FIN_PURCHASE,
            entityId: doc.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
            metadata: { aksi: "ganti_bukti", reason: alasanGanti, from: doc.receiptUrl, to: receiptUrl },
          });
        }
      });
      res.json({ ok: true, receiptUrl, dipakaiDi: receiptUrl ? await cariPemakaiBukti(prisma, receiptUrl, { kecuali: doc.id }) : [] });
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

// Verifikasi bukti — WAJIB orang lain (bukan pembuat), pemegang FINANCE_ADMIN.
financeTxRouter.post("/:jenis(expenses|purchases)/:id/verifikasi-bukti",
  requirePermission(P.FINANCE_ADMIN),
  async (req, res) => {
    try {
      const model = prisma[MODEL_BUKTI[req.params.jenis]];
      const doc = await model.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, createdById: true, receiptUrl: true } });
      if (!doc) throw err("Dokumen tidak ditemukan", 404);
      if (!doc.receiptUrl) throw err("Belum ada bukti yang bisa diverifikasi", 409);
      if (["DIBATALKAN", "DITOLAK"].includes(doc.status)) throw err("Dokumen ini sudah dibatalkan/ditolak", 409);
      if (doc.createdById === req.user.id) {
        throw err(
          "Bukti tidak boleh diverifikasi oleh pembuat transaksinya sendiri — minta owner/admin lain memeriksanya. " +
          "Verifikasi sendiri tidak punya nilai kontrol saat diaudit.",
          403
        );
      }
      await model.update({
        where: { id: doc.id },
        data: { receiptVerifiedAt: new Date(), receiptVerifiedById: req.user.id },
      });
      res.json({ ok: true });
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

// Antrean tinjau: transaksi baru (sejak RECEIPT_POLICY_SINCE) yang buktinya
// belum diverifikasi, atau yang WAJIB bernota tapi notanya belum ada.
financeTxRouter.get("/bukti-review",
  requirePermission(P.FINANCE_READ),
  async (req, res) => {
    try {
      const sejak = await tanggalMulaiKebijakan(prisma);
      const where = { createdAt: { gte: sejak }, status: { in: ["MENUNGGU_APPROVAL", "DISETUJUI", "DIBAYAR"] } };
      const [ex, pu] = await Promise.all([
        prisma.finExpense.findMany({
          where, orderBy: { createdAt: "desc" }, take: 200,
          include: { category: { select: { code: true, name: true } }, createdBy: { select: { id: true, name: true } } },
        }),
        prisma.finPurchase.findMany({
          where, orderBy: { createdAt: "desc" }, take: 200,
          include: { category: { select: { code: true, name: true } }, createdBy: { select: { id: true, name: true } } },
        }),
      ]);

      const items = [];
      const tambah = async (jenis, d, nomor) => {
        const wajib = await notaWajib(prisma, { jenis, mode: d.mode, amount: d.amount, categoryCode: d.category?.code });
        const adaNota = !!d.receiptUrl;
        if (adaNota && d.receiptVerifiedAt) return;   // beres
        if (!adaNota && !wajib) return;               // tidak wajib & tidak ada — bukan urusan antrean
        items.push({
          jenis: jenis === "expense" ? "expenses" : "purchases",
          id: d.id, nomor, date: d.date, description: d.description,
          amount: moneyToNumber(d.amount), status: d.status, kategori: d.category?.name,
          createdBy: d.createdBy, receiptUrl: d.receiptUrl,
          masalah: adaNota ? "BELUM_DIVERIFIKASI" : "TANPA_NOTA",
        });
      };
      for (const d of ex) await tambah("expense", d, d.expenseNumber);
      for (const d of pu) await tambah("purchase", d, d.purchaseNumber);

      items.sort((a, b) => new Date(b.date) - new Date(a.date));
      res.json({
        sejak,
        tanpaNota: items.filter((i) => i.masalah === "TANPA_NOTA").length,
        belumDiverifikasi: items.filter((i) => i.masalah === "BELUM_DIVERIFIKASI").length,
        items,
      });
    } catch (e) {
      handleFinanceError(e, res);
    }
  });

export default financeTxRouter;
