// NILAI PERSEDIAAN — laporan BACA-SAJA (Nov 2026). Tidak ada rute tulis di berkas ini.
//   GET /api/inventory/nilai-persediaan?waktu=<ISO>   izin inventory:read; NOMINAL (harga, nilai, saldo akun Finance, biaya rata-rata) hanya untuk pemegang finance:read (Finance/Owner/Admin).
// Satu waktu acuan dipakai untuk saldo stok DAN Harga Berlaku. Definisi & status rekonsiliasi ikut dikirim agar tampilan tidak menebak.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { hitungNilaiPersediaan } from "../services/nilaiPersediaan.js";

export const nilaiPersediaanRouter = express.Router();
nilaiPersediaanRouter.use(requireAuth);

nilaiPersediaanRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    let waktu = new Date();
    if (req.query.waktu !== undefined && String(req.query.waktu).trim() !== "") {
      const t = new Date(String(req.query.waktu));
      if (!Number.isFinite(t.getTime())) return res.status(400).json({ error: "Waktu acuan tidak valid (pakai format ISO lengkap dengan zona, mis. 2026-11-04T18:00:00+07:00)", code: "WAKTU_TIDAK_VALID" });
      if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(String(req.query.waktu).trim())) return res.status(400).json({ error: "Waktu acuan wajib menyertakan zona waktu", code: "ZONA_WAJIB" });
      if (t.getTime() > Date.now() + 60_000) return res.status(400).json({ error: "Waktu acuan tidak boleh di masa depan", code: "WAKTU_MASA_DEPAN" });
      waktu = t;
    }
    res.json(await hitungNilaiPersediaan(prisma, { waktu, bolehNominal: hasPermission(req.user, P.FINANCE_READ) }));
  } catch (e) {
    console.error("[nilai-persediaan]", e);
    res.status(500).json({ error: "Gagal menghitung nilai persediaan" });
  }
});
