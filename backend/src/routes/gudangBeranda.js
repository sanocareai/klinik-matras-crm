// BERANDA GUDANG & STOK YANG JUJUR — baca-saja (inventory:read).
//   GET /api/inventory/beranda        "yang perlu dikerjakan hari ini" (5 ringkasan + contoh bertautan)
//   GET /api/inventory/beranda/stok   Stok & Lokasi: saldo, satuan, lokasi penerimaan terakhir, sumber angka, keadaan (nol ≠ belum diketahui ≠ minus), batas minimum belum diatur
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { berandaGudang } from "../services/gudangBeranda.js";
import { stokLokasi } from "../services/stokLokasi.js";

export const gudangBerandaRouter = express.Router();
gudangBerandaRouter.use(requireAuth);

const galat = (err, res) => { console.error("Beranda gudang error:", err); return res.status(500).json({ error: pesanServerAman(err) }); };

gudangBerandaRouter.get("/", requirePermission(P.INVENTORY_READ), async (_req, res) => {
  try { res.json(await berandaGudang(prisma)); } catch (e) { galat(e, res); }
});
gudangBerandaRouter.get("/stok", requirePermission(P.INVENTORY_READ), async (_req, res) => {
  try { res.json(await stokLokasi(prisma)); } catch (e) { galat(e, res); }
});
