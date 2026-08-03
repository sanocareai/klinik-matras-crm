import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { JENIS_LAYANAN, MERK_KASUR, UKURAN_KASUR } from "../constants/orderOptions.js";
import { prisma } from "../db.js";

export const masterDataRouter = express.Router();
masterDataRouter.use(requireAuth);

// Opsi dropdown form order (Jenis Layanan, Merk Kasur, Ukuran Kasur) — satu
// sumber dipakai frontend web (OrderSection.jsx) & mobile (OrderFormModal.js),
// supaya rename/tambah opsi tidak perlu duplikasi kode di 2 platform.
masterDataRouter.get("/order-options", (req, res) => {
  res.json({ jenisLayanan: JENIS_LAYANAN, merkKasur: MERK_KASUR, ukuranKasur: UKURAN_KASUR });
});

// GET /api/master-data/service-catalog — katalog layanan aktif (Production
// Tahap 2), untuk dropdown "tetapkan layanan" di detail unit
// (PATCH /units/:id/service). Sumbernya routing_stages/service_catalog yang
// SUDAH ter-seed sejak Phase 0 — endpoint ini cuma menyingkapnya, bukan
// data baru.
masterDataRouter.get("/service-catalog", async (req, res) => {
  try {
    const services = await prisma.serviceCatalog.findMany({
      where: { active: true },
      orderBy: [{ serviceLine: "asc" }, { sortOrder: "asc" }],
      select: { id: true, code: true, labelId: true, serviceLine: true },
    });
    res.json({ services });
  } catch (err) {
    res.status(500).json({ error: "Server error: " + err.message });
  }
});
