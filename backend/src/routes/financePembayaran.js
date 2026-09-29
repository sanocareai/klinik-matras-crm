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
//   POST /api/finance/pembayaran/:id/info     { reason, proofPhotoUrl?, notes?, referenceNumber?, internalNote? }   PAYMENT_KOREKSI (B3.7; tanpa jurnal)
//   POST /api/finance/pembayaran/:id/koreksi  { reason, amount?, tanggal?, cashAccountId?, method?, orderId?, alokasi?, preview? }
//                                             PAYMENT_KOREKSI + PIN step-up (kecuali preview); Idempotency-Key wajib (kecuali preview)
//   GET  /api/finance/pembayaran/:id/riwayat  FINANCE_READ  (rantai versi, audit, jurnal)

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency, wajibIdempotencyKey } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import {
  daftarPembayaran, detailPembayaran, opsiFilter, ringkasanMenunggu, ringkasanPeriode, tolakPembayaran, verifikasiPembayaran,
} from "../services/finance/pembayaran.js";
import { handleFinanceError } from "./finance.js";
import { koreksiPembayaran, editInfoPembayaran, riwayatPembayaran } from "../services/finance/koreksiPembayaran.js";
import { pastikanStepUp, PratinjauKoreksi } from "../services/finance/koreksiGate.js";

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
    const r = await prisma.$transaction((tx) => verifikasiPembayaran(tx, { paymentId: req.params.id, userId: req.user.id, cashAccountId: req.body?.cashAccountId, method: req.body?.method }));
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

// ── B3.7 Koreksi Pembayaran Masuk Terverifikasi ─────────────────────────────────────────────────────────────────
// Pratinjau (body.preview) menjalankan kode koreksi yang SAMA lalu ROLLBACK — tanpa PIN dan tanpa Idempotency-Key. Simpan sungguhan: keduanya wajib.
const kunciKecualiPratinjau = (req, res, next) => (req.body?.preview === true ? next() : wajibIdempotencyKey(req, res, next));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pastikanId = (req, res) => {
  if (UUID.test(req.params.id)) return true;
  res.status(404).json({ error: "Pembayaran tidak ditemukan" });
  return false;
};

financePembayaranRouter.post("/pembayaran/:id/info", requirePermission(P.PAYMENT_KOREKSI), wajibIdempotencyKey, async (req, res) => {
  if (!pastikanId(req, res)) return;
  try {
    const hasil = await prisma.$transaction(
      (tx) => editInfoPembayaran(tx, { paymentId: req.params.id, body: req.body, alasan: req.body?.reason, userId: req.user.id }),
      { maxWait: 15_000, timeout: 60_000 },
    );
    res.status(201).json(hasil);
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financePembayaranRouter.post("/pembayaran/:id/koreksi", requirePermission(P.PAYMENT_KOREKSI), kunciKecualiPratinjau, async (req, res) => {
  if (!pastikanId(req, res)) return;
  const preview = req.body?.preview === true;
  try {
    const hasil = await prisma.$transaction(
      (tx) => koreksiPembayaran(tx, {
        paymentId: req.params.id, body: req.body, alasan: req.body?.reason, userId: req.user.id, preview,
        stepUp: () => pastikanStepUp(prisma, req),
      }),
      { maxWait: 15_000, timeout: 60_000 },
    );
    res.status(201).json(hasil);
  } catch (e) {
    if (e instanceof PratinjauKoreksi) return res.json({ pratinjau: e.data });
    handleFinanceError(e, res);
  }
});

financePembayaranRouter.get("/pembayaran/:id/riwayat", requirePermission(P.FINANCE_READ), async (req, res) => {
  if (!pastikanId(req, res)) return;
  try {
    res.json(await riwayatPembayaran(prisma, req.params.id));
  } catch (e) {
    handleFinanceError(e, res);
  }
});
