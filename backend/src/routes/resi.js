// RESI GABUNGAN — Fase 1 ("Buat Resi"). Feature flag server-side: RESI_INPUT_AKTIF (fin_settings), DEFAULT MATI → POST menolak 403.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { idempotency, wajibIdempotencyKey } from "../middleware/idempotency.js";
import { resiAktif, buatResi, ResiError, DP_PERSEN, MAKS_ITEM_RESI } from "../services/resi.js";
import { resiPembayaranAktif, pratinjauPembayaranResi, catatPembayaranResi, klaimLunasResi, ResiBayarError } from "../services/resiPembayaran.js";

export const resiRouter = express.Router();
resiRouter.use(requireAuth);

// Klien bertanya apakah UI "Buat Resi" boleh tampil. Keputusan sebenarnya tetap di POST (server menolak bila mati).
resiRouter.get("/status", async (req, res) => {
  try {
    res.json({ aktif: await resiAktif(), pembayaranAktif: await resiPembayaranAktif(), dpPersen: DP_PERSEN, maksItem: MAKS_ITEM_RESI });
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

// ── Fase 3A: pembayaran/DP Resi (flag RESI_PEMBAYARAN_AKTIF, DEFAULT MATI; semua endpoint menolak 403 bila mati) ─────────────────────────────────────
function galatBayar(res, err, konteks) {
  if (err instanceof ResiBayarError || err?.statusCode) return res.status(err.statusCode || 400).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  console.error(`[resi] ${konteks}:`, err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

// Pratinjau alokasi (BACA-SAJA) — Sales/Finance. Server menghitung; penulisan menghitung ULANG di bawah kunci.
resiRouter.get("/:groupId/pembayaran/pratinjau", requireAnyPermission(P.ORDER_WRITE, P.PAYMENT_READ), async (req, res) => {
  try {
    res.json(await pratinjauPembayaranResi(prisma, { groupId: req.params.groupId, tipe: String(req.query.tipe || "TAGIHAN").toUpperCase(), nominal: req.query.nominal ?? null }));
  } catch (err) {
    galatBayar(res, err, "pratinjau pembayaran");
  }
});

// Catat pembayaran/DP Resi: SATU Payment anchor + alokasi otomatis ke child. Idempotency-Key WAJIB. Field `alokasi` dari klien DIABAIKAN.
resiRouter.post("/:groupId/pembayaran", requirePermission(P.ORDER_WRITE), wajibIdempotencyKey, idempotency, async (req, res) => {
  try {
    const { tipe = "TAGIHAN", nominal = null, method, cashAccountId = null, proofPhotoUrl = null } = req.body || {};
    const hasil = await catatPembayaranResi(prisma, { groupId: req.params.groupId, userId: req.user.id, tipe: String(tipe).toUpperCase(), nominal, method, cashAccountId, proofPhotoUrl });
    res.status(201).json(hasil);
  } catch (err) {
    galatBayar(res, err, "catat pembayaran");
  }
});

// Klaim Lunas Sales SEKALI di level Resi (semua child aktif). Tidak membuat Payment/jurnal; Finance memverifikasinya lewat satu antrean Resi.
resiRouter.post("/:groupId/klaim-lunas", requirePermission(P.ORDER_WRITE), wajibIdempotencyKey, idempotency, async (req, res) => {
  try {
    res.status(201).json(await klaimLunasResi(prisma, { groupId: req.params.groupId, userId: req.user.id }));
  } catch (err) {
    galatBayar(res, err, "klaim lunas");
  }
});
