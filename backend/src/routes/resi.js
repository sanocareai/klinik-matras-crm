// RESI GABUNGAN — Fase 1 ("Buat Resi"). Feature flag server-side: RESI_INPUT_AKTIF (fin_settings), DEFAULT MATI → POST menolak 403.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { resiAktif, buatResi, ResiError, DP_PERSEN, MAKS_ITEM_RESI } from "../services/resi.js";

export const resiRouter = express.Router();
resiRouter.use(requireAuth);

// Klien bertanya apakah UI "Buat Resi" boleh tampil. Keputusan sebenarnya tetap di POST (server menolak bila mati).
resiRouter.get("/status", async (req, res) => {
  try {
    res.json({ aktif: await resiAktif(), dpPersen: DP_PERSEN, maksItem: MAKS_ITEM_RESI });
  } catch (err) {
    res.status(500).json({ error: "Gagal membaca status Resi Gabungan" });
  }
});

resiRouter.post("/", requirePermission(P.ORDER_WRITE), async (req, res) => {
  try {
    const { customerId } = req.body || {};
    if (!customerId) return res.status(400).json({ error: "Customer wajib dipilih" });
    const hasil = await buatResi(String(customerId), req.body, req.user?.id);
    res.status(201).json(hasil);
  } catch (err) {
    if (err instanceof ResiError) return res.status(err.statusCode).json({ error: err.message });
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error("[resi] gagal membuat resi:", err);
    res.status(500).json({ error: "Resi gagal dibuat, tidak ada order yang tersimpan. Coba lagi." });
  }
});
