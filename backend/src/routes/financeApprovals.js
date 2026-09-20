// INBOX PERSETUJUAN FINANCE — endpoint baca (Finance Mobile S4). Lihat services/finance/approvals.js untuk keputusan workflow.
// Read-only: keputusan (approve/reject) tetap lewat endpoint milik tiap jenis dokumen; item membawa `aksi` yang dihitung server.
//
//   GET /api/finance/approvals?tab=&jenis=&from=&to=&pemohonId=&q=&page=&limit=   daftar terpaginasi + jumlah per tab
//   GET /api/finance/approvals/ringkasan                                            jumlah menunggu (lencana)
//   GET /api/finance/approvals/pemohon                                              pilihan filter pemohon
//   GET /api/finance/approvals/:jenis/:id                                           detail + lampiran bertanda-tangan + riwayat

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { daftarPersetujuan, detailPersetujuan, pilihanPemohon, ringkasanMenunggu } from "../services/finance/approvals.js";
import { handleFinanceError } from "./finance.js";

export const financeApprovalsRouter = express.Router();
financeApprovalsRouter.use(requireAuth);

financeApprovalsRouter.get("/approvals/ringkasan", requirePermission(P.FINANCE_READ), async (_req, res) => {
  try {
    res.json(await ringkasanMenunggu(prisma));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeApprovalsRouter.get("/approvals/pemohon", requirePermission(P.FINANCE_READ), async (_req, res) => {
  try {
    res.json({ pemohon: await pilihanPemohon(prisma) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeApprovalsRouter.get("/approvals", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { tab, jenis, from, to, pemohonId, q, page, limit } = req.query;
    res.json(await daftarPersetujuan(prisma, req.user, { tab, jenis, from, to, pemohonId, q, page, limit }));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeApprovalsRouter.get("/approvals/:jenis/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const detail = await detailPersetujuan(prisma, req.user, req.params.jenis, req.params.id);
    if (!detail) return res.status(404).json({ error: "Dokumen tidak ditemukan di inbox persetujuan" });
    res.json(detail);
  } catch (e) {
    handleFinanceError(e, res);
  }
});
