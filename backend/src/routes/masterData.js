import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { JENIS_LAYANAN, MERK_KASUR, UKURAN_KASUR } from "../constants/orderOptions.js";

export const masterDataRouter = express.Router();
masterDataRouter.use(requireAuth);

// Opsi dropdown form order (Jenis Layanan, Merk Kasur, Ukuran Kasur) — satu
// sumber dipakai frontend web (OrderSection.jsx) & mobile (OrderFormModal.js),
// supaya rename/tambah opsi tidak perlu duplikasi kode di 2 platform.
masterDataRouter.get("/order-options", (req, res) => {
  res.json({ jenisLayanan: JENIS_LAYANAN, merkKasur: MERK_KASUR, ukuranKasur: UKURAN_KASUR });
});
