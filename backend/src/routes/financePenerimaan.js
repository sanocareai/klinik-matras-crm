// FINANCE WORKSPACE — verifikasi penerimaan uang atas order yang sudah
// ditandai LUNAS oleh sales. Penjelasan & alasan desain lengkap ada di
// services/finance/penerimaanOrder.js.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { daftarLunasBelumDicatat, verifikasiPenerimaan, tolakLunas } from "../services/finance/penerimaanOrder.js";
import { RECEIPTS_URL_PREFIX } from "../services/finance/receipts.js";
import { handleFinanceError } from "./finance.js";

export const financePenerimaanRouter = express.Router();
financePenerimaanRouter.use(requireAuth);
// Idempotency-Key untuk command uang (opsional di web, wajib di token mobile).
financePenerimaanRouter.use(idempotency);

function err(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function cekBukti(url) {
  if (url && !String(url).startsWith(`${RECEIPTS_URL_PREFIX}/`) && !String(url).startsWith("/media/payment-proofs/")) {
    throw err("Foto bukti harus diunggah lewat fitur upload");
  }
}

financePenerimaanRouter.get("/penerimaan/lunas-belum-dicatat", requirePermission(P.PAYMENT_READ), async (req, res) => {
  try {
    res.json(await daftarLunasBelumDicatat(prisma));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Verifikasi SATU order: rekening + tanggal + (opsional) foto bukti.
financePenerimaanRouter.post("/penerimaan/verifikasi", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    const { orderId, mode, method, cashAccountId, date, amount, proofPhotoUrl } = req.body;
    if (!orderId) throw err("Order wajib dipilih");
    cekBukti(proofPhotoUrl);
    const hasil = await prisma.$transaction((tx) =>
      verifikasiPenerimaan(tx, { orderId, mode, method, cashAccountId, date, amount, proofPhotoUrl, verifierId: req.user.id })
    );
    res.status(201).json(hasil);
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Banyak order sekaligus dengan rekening/metode yang sama. Tiap order
// transaksinya sendiri: satu yang gagal tidak membatalkan yang lain, dan
// hasil per-order dikembalikan supaya UI bisa menunjukkan mana yang perlu
// dilihat ulang. Tanggal tiap order = tanggal sales menandainya lunas.
financePenerimaanRouter.post("/penerimaan/verifikasi-massal", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    const { orderIds, mode, method, cashAccountId } = req.body;
    if (!Array.isArray(orderIds) || orderIds.length === 0) throw err("Pilih minimal satu order");
    if (orderIds.length > 500) throw err("Maksimal 500 order sekali proses");
    const hasil = [];
    for (const orderId of orderIds) {
      try {
        const r = await prisma.$transaction((tx) =>
          verifikasiPenerimaan(tx, { orderId, mode, method, cashAccountId, verifierId: req.user.id })
        );
        hasil.push({ orderId, ok: true, ...r });
      } catch (e) {
        hasil.push({ orderId, ok: false, error: e.message });
      }
    }
    res.status(201).json({ berhasil: hasil.filter((h) => h.ok).length, gagal: hasil.filter((h) => !h.ok).length, hasil });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Uang ternyata belum masuk — kembalikan status order.
financePenerimaanRouter.post("/penerimaan/tolak", requirePermission(P.PAYMENT_WRITE), async (req, res) => {
  try {
    const { orderId, reason } = req.body;
    if (!orderId) throw err("Order wajib dipilih");
    res.json(await prisma.$transaction((tx) => tolakLunas(tx, { orderId, reason, userId: req.user.id })));
  } catch (e) {
    handleFinanceError(e, res);
  }
});
