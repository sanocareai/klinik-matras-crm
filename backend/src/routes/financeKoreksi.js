// PIN step-up Finance + riwayat versi dokumen (Edit & Koreksi Transaksi Aman).
//   GET  /pin/status              status PIN pengguna (sudah diatur? terkunci?)
//   POST /pin                     atur/ganti PIN — wajib password login
//   POST /pin/verifikasi          verifikasi PIN -> token step-up 5 menit (dikirim di header X-Finance-Stepup)
//   GET  /riwayat-versi/:jenis/:id  siapa/kapan/alasan/perubahan + rantai jurnal (asli -> dibalik -> pengganti)

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { handleFinanceError } from "./finance.js";
import { statusPin, aturPin, verifikasiPin, riwayatVersi } from "../services/finance/koreksiGate.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const financeKoreksiRouter = express.Router();
// requireAuth dipasang PER RUTE (bukan router.use): router ini di-mount di /api/finance bersama router lain, dan
// router.use akan menjalankan requireAuth lagi untuk SETIAP request /api/finance/* yang lewat — limiter token mobile
// (120/menit) jadi menghitung dobel dan menolak permintaan sah (terbukti di tes Buku Besar).

financeKoreksiRouter.get("/pin/status", requireAuth, requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try { res.json(await statusPin(prisma, req.user.id)); } catch (e) { handleFinanceError(e, res); }
});

financeKoreksiRouter.post("/pin", requireAuth, requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    await aturPin(prisma, { userId: req.user.id, password: req.body?.password, pin: req.body?.pin });
    await recordActivity(prisma, {
      entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: req.user.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
      metadata: { aksi: "PIN Finance diatur/diganti" },
    });
    res.json({ ok: true, ...(await statusPin(prisma, req.user.id)) });
  } catch (e) { handleFinanceError(e, res); }
});

financeKoreksiRouter.post("/pin/verifikasi", requireAuth, requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try { res.json(await verifikasiPin(prisma, { userId: req.user.id, pin: req.body?.pin })); } catch (e) { handleFinanceError(e, res); }
});

financeKoreksiRouter.get("/riwayat-versi/:jenis/:id", requireAuth, requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json(await riwayatVersi(prisma, req.params.jenis, req.params.id)); } catch (e) { handleFinanceError(e, res); }
});
