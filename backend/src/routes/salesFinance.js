// REKONSILIASI SALES–FINANCE — endpoint (30 Sep 2026). Angka SEMUA dari services/finance/rekonSalesFinance.js (satu sumber, dipakai layar & Excel).
//
//   GET  /api/sales-finance/rekon?from=&to=            bridge Uang Masuk Terverifikasi → Nilai Order yang Menjadi Lunas (+ kartu)
//   GET  /api/sales-finance/sales-aktif                 daftar Sales aktif untuk dialog penugasan ulang (Admin)
//   POST /api/sales-finance/orders/:id/pemilik          penugasan ulang pemilik Sales order (Admin; alasan wajib; diaudit)
//
// Izin: bridge (angka) untuk ADMIN, Finance (finance:read), dan Sales. DAFTAR ORDER penyusun (nama pelanggan, pembayaran) hanya untuk ADMIN & Finance —
// Sales hanya melihat angka ringkasan (detailTersedia=false), supaya tidak membuka pelanggan/pembayaran milik Sales lain.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { hasPermission, rolesOf, PERMISSIONS as P } from "../middleware/authorize.js";
import { rekonSalesFinance } from "../services/finance/rekonSalesFinance.js";
import { tetapkanPemilikSales } from "../services/salesOwner.js";

export const salesFinanceRouter = express.Router();
salesFinanceRouter.use(requireAuth);

const TGL = /^\d{4}-\d{2}-\d{2}$/;
const adalahAdmin = (u) => rolesOf(u).includes("ADMIN");
const adalahSales = (u) => rolesOf(u).includes("SALES");

salesFinanceRouter.get("/rekon", async (req, res) => {
  try {
    const boleh = adalahAdmin(req.user) || hasPermission(req.user, P.FINANCE_READ) || adalahSales(req.user);
    if (!boleh) return res.status(403).json({ error: "Anda tidak punya izin melihat rekonsiliasi Sales–Finance." });
    const { from, to } = req.query;
    if (!TGL.test(String(from || "")) || !TGL.test(String(to || ""))) return res.status(400).json({ error: "Periode wajib diisi (from & to, format YYYY-MM-DD)." });
    const denganDetail = adalahAdmin(req.user) || hasPermission(req.user, P.FINANCE_READ);
    res.json(await rekonSalesFinance(prisma, { from: String(from), to: String(to), denganDetail }));
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error("sales-finance/rekon error:", e);
    res.status(500).json({ error: "Gagal memuat rekonsiliasi Sales–Finance" });
  }
});

salesFinanceRouter.get("/sales-aktif", async (req, res) => {
  if (!adalahAdmin(req.user)) return res.status(403).json({ error: "Hanya Admin yang boleh menetapkan pemilik Sales order." });
  const users = await prisma.user.findMany({ where: { active: true, role: "SALES" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  res.json({ sales: users });
});

salesFinanceRouter.post("/orders/:id/pemilik", async (req, res) => {
  try {
    if (!adalahAdmin(req.user)) return res.status(403).json({ error: "Hanya Admin yang boleh menetapkan pemilik Sales order." });
    const { userId, alasan } = req.body || {};
    const hasil = await prisma.$transaction((tx) => tetapkanPemilikSales(tx, { orderId: req.params.id, userIdBaru: userId || null, alasan, aktorId: req.user.id }));
    res.json({ ok: true, ...hasil });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error("sales-finance/pemilik error:", e);
    res.status(500).json({ error: "Gagal menetapkan pemilik Sales" });
  }
});
