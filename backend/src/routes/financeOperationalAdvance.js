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
  uangMukaInclude, bentukUangMuka, AdvanceError,
} from "../services/finance/operationalAdvance.js";

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
    const { status, holderId, q, lewatTempo } = req.query;
    const rows = await prisma.finOperationalAdvance.findMany({
      where: {
        ...(status && { status }),
        ...(holderId && { holderId }),
        ...(q && { OR: [
          { advanceNumber: { contains: String(q), mode: "insensitive" } },
          { purpose: { contains: String(q), mode: "insensitive" } },
          { holder: { name: { contains: String(q), mode: "insensitive" } } },
        ] }),
      },
      include: uangMukaInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    const hariIni = todayBookDateWIB();
    let items = rows.map((a) => bentukUangMuka(a, { hariIni }));
    if (lewatTempo === "1") items = items.filter((a) => a.lewatTempo);

    const aktif = items.filter((a) => ["AKTIF", "SEBAGIAN"].includes(a.status));
    const perPemegang = new Map();
    for (const a of aktif) {
      const p = perPemegang.get(a.holderId) || { holderId: a.holderId, nama: a.holder?.name || "—", jumlah: 0, saldo: 0, lewatTempo: 0 };
      p.jumlah += 1; p.saldo += a.saldo; p.lewatTempo += a.lewatTempo ? 1 : 0;
      perPemegang.set(a.holderId, p);
    }
    res.json({
      items,
      ringkasan: {
        jumlahAktif: aktif.length,
        totalSaldoAktif: aktif.reduce((s, a) => s + a.saldo, 0),
        jumlahLewatTempo: aktif.filter((a) => a.lewatTempo).length,
        perPemegang: [...perPemegang.values()].sort((a, b) => b.saldo - a.saldo),
      },
    });
  } catch (e) { handleFinanceError(e, res); }
});

// ─── Riwayat (pemberian, pertanggungjawaban, pengembalian, pembatalan) ────
financeUangMukaRouter.get("/uang-muka/riwayat", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const advances = await prisma.finOperationalAdvance.findMany({
      include: { holder: { select: { id: true, name: true } }, settlements: { include: { expense: { select: { expenseNumber: true, description: true } } } } },
      orderBy: { createdAt: "desc" }, take: 300,
    });
    const baris = [];
    for (const a of advances) {
      baris.push({ tanggal: a.date, waktu: a.createdAt, jenis: "DIBERIKAN", advanceId: a.id, advanceNumber: a.advanceNumber, pemegang: a.holder?.name, nominal: moneyToNumber(a.amount), keterangan: a.purpose, status: a.status === "DIBATALKAN" ? "DIBATALKAN" : "AKTIF", alasan: a.cancelReason || null });
      for (const s of a.settlements) {
        baris.push({
          tanggal: s.date, waktu: s.createdAt, jenis: s.type, advanceId: a.id, advanceNumber: a.advanceNumber, pemegang: a.holder?.name,
          nominal: moneyToNumber(s.amount), status: s.status === "CANCELLED" ? "DIBATALKAN" : "AKTIF", alasan: s.cancelReason || null,
          keterangan: s.expense ? `${s.expense.expenseNumber} — ${s.expense.description}` : (s.note || "Pengembalian sisa"),
          settlementId: s.id,
        });
      }
    }
    baris.sort((x, y) => new Date(y.waktu) - new Date(x.waktu));
    res.json({ items: baris.slice(0, 500) });
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
