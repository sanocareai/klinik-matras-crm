// PEMBAYARAN PELANGGAN — endpoint Finance Mobile S5 (daftar, detail, verifikasi, penolakan). Aturan & keputusan workflow
// ada di services/finance/pembayaran.js. Command uang: Idempotency-Key (wajib untuk token mobile), transaksi atomik,
// row lock (FOR UPDATE) — dua tap / dua perangkat paralel tidak bisa memproses pembayaran yang sama dua kali.
//
//   GET  /api/finance/pembayaran?status=&q=&metode=&rekeningId=&from=&to=&limit=&cursor=   FINANCE_READ (bukan PAYMENT_READ: SALES memegangnya)
//   GET  /api/finance/pembayaran/ringkasan                                                  FINANCE_READ   (lencana)
//   GET  /api/finance/pembayaran/opsi                                                       FINANCE_READ   (pilihan filter)
//   GET  /api/finance/pembayaran/:id                                                        FINANCE_READ   (detail + bukti bertanda-tangan + audit)
//   POST /api/finance/pembayaran/:id/verifikasi                                             PAYMENT_WRITE (khusus FINANCE)
//   POST /api/finance/pembayaran/:id/tolak   { reason }                                     PAYMENT_WRITE (alasan wajib)

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import {
  daftarPembayaran, detailPembayaran, opsiFilter, ringkasanMenunggu, ringkasanPeriode, tolakPembayaran, verifikasiPembayaran,
} from "../services/finance/pembayaran.js";
import { handleFinanceError } from "./finance.js";

export const financePembayaranRouter = express.Router();
// Dibatasi ke /pembayaran: router ini satu prefix (/api/finance) dengan jalur media bertanda-tangan yang TIDAK memakai
// Bearer. `use(requireAuth)` tanpa path akan memblokir jalur-jalur di router yang ter-mount sesudahnya (401).
financePembayaranRouter.use("/pembayaran", requireAuth, idempotency);

financePembayaranRouter.get("/pembayaran/ringkasan", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to } = req.query;
    const [lencana, periode] = await Promise.all([ringkasanMenunggu(prisma), ringkasanPeriode(prisma, { from, to })]);
    res.json({ ...lencana, periode });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financePembayaranRouter.get("/pembayaran/opsi", requirePermission(P.FINANCE_READ), async (_req, res) => {
  try {
    res.json(await opsiFilter(prisma));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financePembayaranRouter.get("/pembayaran", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { status, q, metode, rekeningId, from, to, limit, cursor } = req.query;
    res.json(await daftarPembayaran(prisma, req.user, { status, q, metode, rekeningId, from, to, limit, cursor }));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financePembayaranRouter.get("/pembayaran/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const detail = await detailPembayaran(prisma, req.user, req.params.id);
    if (!detail) return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    res.json(detail);
  } catch (e) {
    handleFinanceError(e, res);
  }
});

/** Setelah commit: baca ulang hasil RESMI dari server (klien tidak menebak status). */
async function hasilResmi(req, paymentId, extra) {
  return { ok: true, ...extra, pembayaran: await detailPembayaran(prisma, req.user, paymentId) };
}

financePembayaranRouter.post("/pembayaran/:id/verifikasi", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    const r = await prisma.$transaction((tx) => verifikasiPembayaran(tx, { paymentId: req.params.id, userId: req.user.id }));
    res.status(201).json(await hasilResmi(req, r.paymentId, { orderIds: r.orderIds }));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financePembayaranRouter.post("/pembayaran/:id/tolak", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    const r = await prisma.$transaction((tx) => tolakPembayaran(tx, { paymentId: req.params.id, reason: req.body?.reason, userId: req.user.id }));
    res.json(await hasilResmi(req, r.paymentId, { orderIds: r.orderIds, status: r.status }));
  } catch (e) {
    handleFinanceError(e, res);
  }
});
