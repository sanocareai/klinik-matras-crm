// UANG MUKA OPERASIONAL — rute Finance.
//   Berikan Uang Muka        POST /uang-muka
//   Saldo Aktif              GET  /uang-muka
//   Pertanggungjawaban       POST /uang-muka/:id/pertanggungjawaban  (membuat pengeluaran mode UANG_MUKA;
//                            saldo baru terpakai SAAT pengeluaran itu DISETUJUI — tanpa /pay, tanpa mutasi kas)
//   Pengembalian             POST /uang-muka/:id/kembalikan
//   Riwayat                  GET  /uang-muka/riwayat
//   Pembatalan (reversal)    POST /uang-muka/:id/batal, POST /uang-muka/:id/pengembalian/:sid/batal
// Semua aksi: permission, alasan (untuk pembatalan), audit trail (recordActivity) dan idempotensi
// (header Idempotency-Key + kunci unik di DB).

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { handleFinanceError } from "./finance.js";
import { todayBookDateWIB } from "../services/finance/journal.js";
import { moneyToNumber, toMoney, sumMoney } from "../services/finance/money.js";
import { buatFinExpense, bentukExpense } from "../services/finance/expenses.js";
import {
  berikanUangMuka, kembalikanSisa, batalkanPengembalian, batalkanUangMuka,
  uangMukaInclude, bentukUangMuka, AdvanceError, ubahMetadataUangMuka,
} from "../services/finance/operationalAdvance.js";
import { ambilDaftarUangMuka, ambilRiwayatUangMuka } from "../services/finance/uangMukaRead.js";

export const financeUangMukaRouter = express.Router();
financeUangMukaRouter.use(requireAuth);
financeUangMukaRouter.use(idempotency);

const kunciIdem = (req) => {
  const k = req.get("Idempotency-Key");
  return k ? `${req.user.id}:${k}` : null;
};
const err = (m, c = 400) => new AdvanceError(m, c);

// ─── Saldo aktif & daftar ────────────────────────────────────────────────
financeUangMukaRouter.get("/uang-muka", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    // Query & ringkasan yang SAMA dipakai Export Excel (services/finance/uangMukaRead.js) — angka layar = angka berkas.
    res.json(await ambilDaftarUangMuka(prisma, req.query, { take: 500 }));
  } catch (e) { handleFinanceError(e, res); }
});

// ─── Riwayat (pemberian, pertanggungjawaban, pengembalian, pembatalan) ────
financeUangMukaRouter.get("/uang-muka/riwayat", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    res.json({ items: await ambilRiwayatUangMuka(prisma) });
  } catch (e) { handleFinanceError(e, res); }
});

financeUangMukaRouter.get("/uang-muka/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const a = await prisma.finOperationalAdvance.findUnique({ where: { id: req.params.id }, include: uangMukaInclude });
    if (!a) throw err("Uang muka tidak ditemukan", 404);
    res.json(bentukUangMuka(a));
  } catch (e) { handleFinanceError(e, res); }
});

// ─── Berikan ─────────────────────────────────────────────────────────────
financeUangMukaRouter.post("/uang-muka", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const b = req.body || {};
    const { advance, diulang } = await prisma.$transaction((tx) => berikanUangMuka(tx, { ...b, idempotencyKey: kunciIdem(req), user: req.user }));
    const lengkap = await prisma.finOperationalAdvance.findUnique({ where: { id: advance.id }, include: uangMukaInclude });
    if (diulang) res.set("Idempotent-Replayed", "true");
    res.status(diulang ? 200 : 201).json(bentukUangMuka(lengkap));
  } catch (e) {
    if (e?.code === "P2002") return handleFinanceError(Object.assign(new Error("Permintaan yang sama sudah diproses"), { statusCode: 409 }), res);
    handleFinanceError(e, res);
  }
});

// ─── Pertanggungjawaban: catat pengeluaran yang memakai uang muka ─────────
financeUangMukaRouter.post("/uang-muka/:id/pertanggungjawaban", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const b = req.body || {};
    const created = await prisma.$transaction((tx) => buatFinExpense(tx, {
      date: b.date, amount: b.amount, description: b.description, categoryId: b.categoryId, division: b.division,
      payeeName: b.payeeName, orderId: b.orderId, unitId: b.unitId, receiptUrl: b.receiptUrl, notes: b.notes,
      advanceId: req.params.id, user: req.user,
    }));
    res.status(201).json(bentukExpense(created));
  } catch (e) { handleFinanceError(e, res); }
});

// ─── Pengembalian sisa ───────────────────────────────────────────────────
financeUangMukaRouter.post("/uang-muka/:id/kembalikan", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const b = req.body || {};
    const { settlement, diulang } = await prisma.$transaction((tx) => kembalikanSisa(tx, {
      advanceId: req.params.id, amount: b.amount, cashAccountId: b.cashAccountId, date: b.date, note: b.note,
      receiptUrl: b.receiptUrl, idempotencyKey: kunciIdem(req), user: req.user,
    }));
    const a = await prisma.finOperationalAdvance.findUnique({ where: { id: req.params.id }, include: uangMukaInclude });
    if (diulang) res.set("Idempotent-Replayed", "true");
    res.status(diulang ? 200 : 201).json({ settlementId: settlement.id, uangMuka: bentukUangMuka(a) });
  } catch (e) {
    if (e?.code === "P2002") return handleFinanceError(Object.assign(new Error("Permintaan yang sama sudah diproses"), { statusCode: 409 }), res);
    handleFinanceError(e, res);
  }
});

// ─── Pembatalan (reversal resmi) ─────────────────────────────────────────
financeUangMukaRouter.post("/uang-muka/:id/pengembalian/:sid/batal", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    await prisma.$transaction((tx) => batalkanPengembalian(tx, { advanceId: req.params.id, settlementId: req.params.sid, reason: req.body?.reason, user: req.user }));
    const a = await prisma.finOperationalAdvance.findUnique({ where: { id: req.params.id }, include: uangMukaInclude });
    res.json(bentukUangMuka(a));
  } catch (e) { handleFinanceError(e, res); }
});

financeUangMukaRouter.post("/uang-muka/:id/batal", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    await prisma.$transaction((tx) => batalkanUangMuka(tx, { advanceId: req.params.id, reason: req.body?.reason, user: req.user }));
    const a = await prisma.finOperationalAdvance.findUnique({ where: { id: req.params.id }, include: uangMukaInclude });
    res.json(bentukUangMuka(a));
  } catch (e) { handleFinanceError(e, res); }
});

// ─── Edit metadata (tujuan, tenggat, catatan, bukti, divisi) — angka & rekening terkunci karena sudah masuk buku besar ───
financeUangMukaRouter.patch("/uang-muka/:id", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    await prisma.$transaction((tx) => ubahMetadataUangMuka(tx, { advanceId: req.params.id, body: req.body || {}, user: req.user }));
    const a = await prisma.finOperationalAdvance.findUnique({ where: { id: req.params.id }, include: uangMukaInclude });
    res.json(bentukUangMuka(a));
  } catch (e) { handleFinanceError(e, res); }
});
