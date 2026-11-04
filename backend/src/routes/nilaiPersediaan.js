// NILAI PERSEDIAAN — laporan BACA-SAJA + pencatatan hasil SO berizin (Nov 2026).
//   GET  /api/inventory/nilai-persediaan?waktu=<ISO>              izin inventory:read; NOMINAL (harga, nilai, saldo akun Finance, biaya rata-rata, nilai parsial) hanya untuk pemegang finance:read.
//   POST /api/inventory/nilai-persediaan/hasil-so                 izin inventory:write + Idempotency-Key; mencatat hasil SO per bahan (pengamatan satuan lain / nol dikonfirmasi). TIDAK menulis stok/ledger/harga/valuasi/jurnal.
//   GET  /api/inventory/nilai-persediaan/hasil-so/:materialId     izin inventory:read; riwayat lengkap (termasuk koreksi) satu bahan.
// Satu waktu acuan dipakai untuk saldo stok DAN Harga Berlaku. Definisi & status rekonsiliasi ikut dikirim agar tampilan tidak menebak.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { hitungNilaiPersediaan } from "../services/nilaiPersediaan.js";
import { catatHasilSO, riwayatHasilSO, HasilSOError } from "../services/hasilSO.js";

export const nilaiPersediaanRouter = express.Router();
nilaiPersediaanRouter.use(requireAuth);
const galat = (e, res) => { if (e instanceof HasilSOError) return res.status(e.statusCode).json({ error: e.message, code: e.code }); console.error("[nilai-persediaan]", e); return res.status(500).json({ error: "Gagal memproses permintaan" }); };

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
  } catch (e) { galat(e, res); }
});

nilaiPersediaanRouter.post("/hasil-so", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try { const h = await catatHasilSO(prisma, req.user, req.body ?? {}, req.get("Idempotency-Key")); res.status(h.baru > 0 ? 201 : 200).json(h); } catch (e) { galat(e, res); }
});

nilaiPersediaanRouter.get("/hasil-so/:materialId", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try { res.json({ riwayat: await riwayatHasilSO(prisma, req.params.materialId) }); } catch (e) { galat(e, res); }
});
