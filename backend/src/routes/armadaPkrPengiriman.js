// ARMADA — PENGIRIMAN ORDER PENJUALAN KARYAWAN (job gabungan + pengiriman sebagian eksplisit).
//
// Router TAMBAHAN (pola sama dengan incentiveSnapshot): tidak mengubah armadaRouter yang besar. Di-mount di /api/armada.
//   GET  /pkr-pengiriman                         unit siap yang menunggu unit lain (belum ada job)   — job:read
//   GET  /pkr-pengiriman/:orderId                keadaan pengiriman satu order PKR                  — job:read
//   POST /pkr-pengiriman/:orderId/kirim-sebagian aksi eksplisit: pilih unit + alasan + Idempotency-Key — job:write
// Aturan & alasan: services/pkrPengirimanSebagian.js.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { PkrOrderError } from "../services/pkrGuard.js";
import { bacaPengirimanOrder, daftarMenunggu, kirimSebagian } from "../services/pkrPengirimanSebagian.js";

export const armadaPkrPengirimanRouter = express.Router();
const BASE = "/pkr-pengiriman";

function tangani(e, res) {
  if (e instanceof PkrOrderError || e?.statusCode) {
    return res.status(e.statusCode || 400).json({ error: e.message, ...(e.extra && typeof e.extra === "object" ? e.extra : {}), ...(typeof e.code === "string" && /^[A-Z_]+$/.test(e.code) ? { code: e.code } : {}) });
  }
  console.error("[armada pkr-pengiriman]", e);
  return res.status(500).json({ error: "Terjadi kesalahan pada server" });
}

armadaPkrPengirimanRouter.get(BASE, requireAuth, requirePermission(P.JOB_READ), async (_req, res) => {
  try { res.json({ menunggu: await daftarMenunggu(prisma) }); } catch (e) { tangani(e, res); }
});

armadaPkrPengirimanRouter.get(`${BASE}/:orderId`, requireAuth, requirePermission(P.JOB_READ), async (req, res) => {
  try { res.json(await bacaPengirimanOrder(prisma, req.params.orderId)); } catch (e) { tangani(e, res); }
});

armadaPkrPengirimanRouter.post(`${BASE}/:orderId/kirim-sebagian`, requireAuth, requirePermission(P.JOB_WRITE), async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => kirimSebagian(tx, {
      orderId: req.params.orderId, unitIds: req.body?.unitIds, alasan: req.body?.alasan, idempotencyKey: req.headers["idempotency-key"], userId: req.user.id,
    }), { timeout: 30000, maxWait: 10000 });
    res.status(hasil.replayed ? 200 : 201).json({ ...hasil, pengiriman: await bacaPengirimanOrder(prisma, req.params.orderId) });
  } catch (e) { tangani(e, res); }
});
