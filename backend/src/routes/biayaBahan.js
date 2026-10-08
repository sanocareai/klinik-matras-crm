// JEJAK BIAYA BAHAN PER UNIT — read-model baca-saja (services/finance/biayaBahan.js). Dua pintu, satu sumber data:
//   • GET /api/units/:id/jejak-bahan            — Unit 360 (Produksi/Gudang/Finance: unit:material:write | inventory:read | finance:read). Nominal HANYA muncul bila pengguna punya finance:read; selain itu kuantitas & status saja.
//   • GET /api/finance/biaya-bahan/unit[/:id]   — Finance (finance:read), daftar unit + detail.
// Tidak ada rute tulis: stok keluar hanya lewat Material Issue/Gudang, dan pembekuan nilai terjadi di dalam postStockMovement.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, PERMISSIONS as P, hasPermission } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { bacaJejakUnit, daftarUnitBiaya } from "../services/finance/biayaBahan.js";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function galat(err, res) {
  console.error("[biaya-bahan]", err);
  res.status(500).json({ error: "Gagal membaca jejak biaya bahan" });
}

export const jejakBahanUnitRouter = express.Router();
jejakBahanUnitRouter.use(requireAuth);
// Hanya peran yang memang menangani bahan (Produksi: unit:material:write, Gudang: inventory:read) atau Finance — Sales (unit:read) tidak melihat jejak bahan/PO/supplier.
jejakBahanUnitRouter.get("/:id/jejak-bahan", requireAnyPermission(P.UNIT_MATERIAL_WRITE, P.INVENTORY_READ, P.FINANCE_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Unit tidak ditemukan" });
    const hasil = await bacaJejakUnit(prisma, req.params.id, { izinHarga: hasPermission(req.user, P.FINANCE_READ) });
    if (!hasil) return res.status(404).json({ error: "Unit tidak ditemukan" });
    res.json(hasil);
  } catch (e) { galat(e, res); }
});

export const biayaBahanFinanceRouter = express.Router();
biayaBahanFinanceRouter.use(requireAuth);
biayaBahanFinanceRouter.get("/unit", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    res.json({ units: await daftarUnitBiaya(prisma, { q: String(req.query.q ?? "").trim().slice(0, 60) }) });
  } catch (e) { galat(e, res); }
});
biayaBahanFinanceRouter.get("/unit/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Unit tidak ditemukan" });
    const hasil = await bacaJejakUnit(prisma, req.params.id, { izinHarga: true });
    if (!hasil) return res.status(404).json({ error: "Unit tidak ditemukan" });
    res.json(hasil);
  } catch (e) { galat(e, res); }
});
